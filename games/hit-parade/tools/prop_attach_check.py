"""HIT PARADE - props in the hand, exactly as the game attaches them (lane ASSETS; CONTRACT 17.1 / 6.4).

  python tools/prop_attach_check.py --job <job.json> --out <prefix>     one job (see tools/prop_attach_check.html)
  python tools/prop_attach_check.py --suite [--only baton,cleaver]       every prop of art/gltf/props/props.json on
                                                                        each of its users' clips (game camera +
                                                                        hand close-ups) -> art/renders/props/attach/

Serves forgeflow-games/games on a free local port, opens tools/prop_attach_check.html in headless Chrome
(three 0.186 from this game's node_modules, GLTFLoader + MeshoptDecoder, the SHIPPED fighter + prop GLBs) and writes
<prefix>.png (labelled tiles) + <prefix>.json (per tile: clip time, prop world boxes; measure mode: finger landmarks
in the hand bone's scale-stripped frame). The attach math is a copy of view/fighters.ts attachProp + update.
ASCII only.
"""
import argparse
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

GAMES = "C:/Users/TestRun/Claude Claw/forgeflow-games/games"
GAME = GAMES + "/hit-parade"
PAGE = "/hit-parade/tools/prop_attach_check.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization"]


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


def game_url(path):
    """absolute game-tree path -> server URL"""
    p = os.path.abspath(path).replace("\\", "/")
    g = os.path.abspath(GAMES).replace("\\", "/")
    if not p.lower().startswith(g.lower()):
        raise SystemExit("not under the games tree: " + p)
    return p[len(g):]


def run_jobs(jobs):
    """jobs = [(job_dict, out_prefix)] -> list of results"""
    port = free_port()
    H = functools.partial(Quiet, directory=GAMES)
    H.extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    H.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary",
                             ".json": "application/json", ".hdr": "application/octet-stream"})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    out = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        for job, prefix in jobs:
            os.makedirs(os.path.dirname(prefix), exist_ok=True)
            jp = prefix + ".job.json"
            with open(jp, "w", encoding="utf-8", newline="\n") as fh:
                json.dump(job, fh, indent=1)
            pg = br.new_page(viewport={"width": 1500, "height": 1500})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            # ANGLE's D3D shader compiler prints X4122 precision notes for three's own shaders: not a page problem
            pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text)
                  if m.type in ("error", "warning") and "Failed to load resource" not in m.text
                  and "X4122" not in m.text else None)
            pg.on("response", lambda rs: errs.append("HTTP %d %s" % (rs.status, rs.url))
                  if rs.status >= 400 and not rs.url.endswith("/favicon.ico") else None)
            pg.goto("http://127.0.0.1:%d%s?job=%s" % (port, PAGE, game_url(jp)))
            try:
                pg.wait_for_function("window.__RESULT__ !== null", timeout=300000)
            except Exception:  # noqa
                print("[attach] TIMEOUT", prefix, errs[:5])
                out.append({"ok": False, "error": "timeout", "pageErrors": errs})
                pg.close()
                continue
            r = pg.evaluate("window.__RESULT__")
            pg.close()
            png = r.pop("png", None)
            r["pageErrors"] = errs
            if png:
                im = Image.open(io.BytesIO(base64.b64decode(png.split(",", 1)[1]))).convert("RGB")
                d = ImageDraw.Draw(im)
                tw, th = r["tile"]
                for i, (tile, ti) in enumerate(zip(job.get("tiles", []), r["tiles"])):
                    x, y = (i % r["cols"]) * tw, (i // r["cols"]) * th
                    lab = tile.get("label") or "%s %s t%.2f %s" % (job["fighter"], ti.get("clip"), ti.get("t", -1),
                                                                   ",".join(p["id"] for p in tile.get("props", [])))
                    d.text((x + 5, y + 4), lab, fill=(255, 225, 90), font=font)
                im.save(prefix + ".png")
            with open(prefix + ".json", "w", encoding="utf-8", newline="\n") as fh:
                json.dump(r, fh, indent=1)
            print("[attach]", "OK" if r.get("ok") and not errs else "FAIL", prefix, "load %sms" % r.get("loadMs"),
                  r.get("error", ""), errs[:3])
            out.append(r)
        br.close()
    srv.shutdown()
    return out


def suite(only):
    """every prop on its users' clips: game camera + hand close-up tiles, one sheet per (prop, fighter)."""
    meta = json.load(open(GAME + "/art/gltf/props/props.json", encoding="utf-8"))
    jobs = []
    for pid, p in meta["props"].items():
        if only and pid not in only:
            continue
        for u in p.get("check", []):
            fid = u["fighter"]
            tiles = []

            def spec(x):     # the fighter's own solve when props.json has one (fighters{}), else the GLB default
                a = (meta["props"].get(x, {}).get("fighters") or {}).get(fid)
                return {"id": x, "attach": a} if a else {"id": x}

            for clip, t in u["clips"]:
                props = [spec(pid)] + [spec(x) for x in u.get("with", [])]
                hand = (p.get("attach") or {}).get("bone", "RightHand")
                # the close-up camera looks at the attach bone (Hips for the gourd)
                tiles.append({"clip": clip, "t": t, "props": props, "cam": "game"})
                tiles.append({"clip": clip, "t": t, "props": props, "cam": "close", "hand": hand, "az": 25, "el": 12,
                              "dist": u.get("closeDist", 1.1)})
            jobs.append(({"fighter": fid, "clipsUrl": "/hit-parade/data/clips/%s.clips.json" % fid, "tiles": tiles,
                          "cols": 4, "tileW": 360, "tileH": 360,
                          # the stage IBL the game uses (data/stages.json environment), so metals read as in a bout
                          "envUrl": "/hit-parade/art/gltf/stages/rust_theater_env.hdr", "envIntensity": 0.8},
                         GAME + "/art/renders/props/attach/%s_%s" % (pid, fid)))
    return run_jobs(jobs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job")
    ap.add_argument("--out")
    ap.add_argument("--suite", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    if a.suite:
        rs = suite(set(x for x in a.only.split(",") if x))
    else:
        rs = run_jobs([(json.load(open(a.job, encoding="utf-8")), a.out)])
    sys.exit(0 if all(r.get("ok") and not r.get("pageErrors") for r in rs) else 1)


if __name__ == "__main__":
    main()
