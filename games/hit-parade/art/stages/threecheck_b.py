"""HIT PARADE - three.js load check of a lane STAGES3D-B stage GLB from the CONTRACT 35.7 orbit camera (plain Python 3).

  python art/stages/threecheck_b.py rooftop|control_room [--shipped] [--fighter patch]

Serves forgeflow-games/games on a free local port (no Vite needed, so it can check the STAGED build before the swap),
opens art/stages/threecheck_b.html in headless Chrome (d3d11, the harness GPU flags) with the GLB + fragment + env HDR,
and writes per orbit shot _harness/_reports/stages/three_<id>_<shot>.png, 2x2 sheets three_<id>_<near|far>_<k>.png and
_harness/_reports/stages/three_<id>.json (draw calls + triangles per shot, crowd nodes, named nodes, lights in the GLB,
page errors). Default = the staged files in _harness/scratch/stages_cache/out3d/; --shipped = art/gltf/stages/ +
art/stages/<id>.stage.json. ASCII only.
"""
import base64
import functools
import http.server
import io
import json
import os
import socket
import sys
import threading

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))
GAMES = os.path.dirname(GAME)
REP = os.path.join(GAME, "_harness", "_reports", "stages")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization"]
FIGHTER = {"rooftop": "patch", "control_room": "krane"}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def url_of(path):
    rel = os.path.relpath(path, GAMES).replace("\\", "/")
    return "/" + rel


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sid = sys.argv[1] if len(sys.argv) > 1 else "rooftop"
    shipped = "--shipped" in sys.argv
    fid = FIGHTER.get(sid, "patch")
    if "--fighter" in sys.argv:
        fid = sys.argv[sys.argv.index("--fighter") + 1]
    stages_dir = os.path.join(GAME, "art", "gltf", "stages")
    out3d = os.path.join(GAME, "_harness", "scratch", "stages_cache", "out3d")
    if shipped:
        glb = os.path.join(stages_dir, sid + ".glb")
        frag = os.path.join(HERE, sid + ".stage.json")
        env_dir = stages_dir
    else:
        glb = os.path.join(out3d, sid + ".glb")
        if not os.path.exists(glb) and os.path.exists(glb + ".bak"):
            glb = glb + ".bak"
        frag = os.path.join(out3d, sid + ".stage.json")
        if not os.path.exists(frag) and os.path.exists(frag + ".bak"):
            frag = frag + ".bak"
        fd = json.load(open(frag, encoding="utf-8"))
        env = fd.get("environment", {}).get("hdr", "")
        env_dir = out3d if os.path.exists(os.path.join(out3d, env)) else stages_dir
    fighter = os.path.join(GAME, "art", "gltf", "fighters", fid + ".glb")
    port = free_port()
    H = functools.partial(Quiet, directory=GAMES)
    H.extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    H.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary",
                             ".bak": "model/gltf-binary", ".json": "application/json", ".hdr": "application/octet-stream",
                             ".webp": "image/webp"})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    q = "glb=%s&frag=%s&stagesDir=%s/&envDir=%s/&fighter=%s&w=960&h=540" % (
        url_of(glb), url_of(frag), url_of(stages_dir), url_of(env_dir), url_of(fighter))
    url = "http://127.0.0.1:%d%s?%s" % (port, url_of(os.path.join(HERE, "threecheck_b.html")), q)
    print("[three]", sid, "glb", os.path.relpath(glb, GAME), os.path.getsize(glb), "B; frag", os.path.relpath(frag, GAME),
          "; env dir", os.path.relpath(env_dir, GAME), "; fighter", fid, flush=True)
    errs = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 980, "height": 560})
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text)
              if m.type in ("error", "warning") and "Failed to load resource" not in m.text else None)
        pg.on("response", lambda rs: errs.append("HTTP %d %s" % (rs.status, rs.url))
              if rs.status >= 400 and not rs.url.endswith("/favicon.ico") else None)
        pg.goto(url)
        pg.wait_for_function("window.__RESULT__ !== null", timeout=300000)
        res = pg.evaluate("window.__RESULT__")
        br.close()
    srv.shutdown()
    os.makedirs(REP, exist_ok=True)
    try:
        fnt = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 20)
    except OSError:
        fnt = ImageFont.load_default()
    shots = res.get("shots", [])
    for s in shots:
        b = base64.b64decode(s.pop("png").split(",", 1)[1])
        p = os.path.join(REP, "three_%s_%s.png" % (sid, s["id"]))
        open(p, "wb").write(b)
        s["file"] = os.path.relpath(p, GAME).replace("\\", "/")
    for tag in ("near", "far"):
        grp = [s for s in shots if s["id"].endswith("_" + tag[0])]
        grp.sort(key=lambda s: s["deg"])
        for k in range(0, len(grp), 4):
            im = Image.new("RGB", (1920, 1080))
            d = ImageDraw.Draw(im)
            for i, s in enumerate(grp[k:k + 4]):
                t = Image.open(os.path.join(GAME, s["file"])).convert("RGB")
                x, y = (i % 2) * 960, (i // 2) * 540
                im.paste(t, (x, y))
                d.rectangle((x, y, x + 520, y + 28), fill=(0, 0, 0))
                d.text((x + 6, y + 4), "three.js %s  %d calls  %d tris" % (s["id"], s["calls"], s["triangles"]),
                       fill=(0, 255, 255), font=fnt)
            op = os.path.join(REP, "three_%s_%s_%d.png" % (sid, tag, k // 4))
            im.save(op)
            print("[three] sheet", os.path.relpath(op, GAME), flush=True)
    res["pageErrors"] = errs
    res["glbPath"] = os.path.relpath(glb, GAME).replace("\\", "/")
    jp = os.path.join(REP, "three_%s.json" % sid)
    with open(jp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(res, indent=2) + "\n")
    calls = [s["calls"] for s in shots]
    tris = [s["triangles"] for s in shots]
    print("[three] %s ok=%s shots=%d calls %s..%s tris %s..%s crowdNodes=%s lightsInGlb=%s meshes=%s materials=%s loadMs=%s" % (
        sid, res.get("ok"), len(shots), min(calls) if calls else None, max(calls) if calls else None,
        min(tris) if tris else None, max(tris) if tris else None, res.get("crowdNodes"), res.get("lightsInGlb"),
        res.get("meshes"), res.get("materials"), res.get("loadMs")), flush=True)
    print("[three] named nodes:", res.get("namedNodes"), flush=True)
    print("[three] errors:", res.get("errors"), "page:", errs[:10], flush=True)
    return 0 if res.get("ok") and not res.get("errors") else 1


if __name__ == "__main__":
    sys.exit(main())
