"""HIT PARADE - load the SHIPPED fighter GLBs in headless Chrome with three 0.186 (lane ASSETS).

  python tools/glb_three_check.py johnny bruno          (reads art/gltf/fighters/<id>.glb + data/clips/<id>.clips.json)

Serves forgeflow-games/games on a free local port, opens tools/glb_three_check.html per fighter (GLTFLoader +
MeshoptDecoder, root yaw +90 = facing +X, the game camera), and writes art/renders/<id>/three_check.png +
three_check.json: every clips.json clip exists in the GLB (and nothing else), skinned bounding-box lowest
point per clip, the effector point as three sees it vs clips.json. Prints a one-line verdict per fighter.
ASCII only.
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

GAMES = "C:/Users/TestRun/Claude Claw/forgeflow-games/games"
GAME = GAMES + "/hit-parade"
PAGE = "/hit-parade/tools/glb_three_check.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization"]
# 58-63 clips per fighter since part 2 (part 1 had 34): precise skinned bounds per clip take longer
TIMEOUT_MS = int(os.environ.get("HP_THREE_TIMEOUT_S", "420")) * 1000


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


def main():
    ids = sys.argv[1:] or ["johnny", "bruno"]
    port = free_port()
    H = functools.partial(Quiet, directory=GAMES)
    H.extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    H.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary",
                             ".json": "application/json"})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    bad = 0
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 12)
    except OSError:
        font = ImageFont.load_default()
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        for fid in ids:
            pg = br.new_page(viewport={"width": 1300, "height": 1900})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text)
                  if m.type in ("error", "warning") and "Failed to load resource" not in m.text else None)
            # 404s are judged by URL (the browser's own /favicon.ico probe is not a failure)
            pg.on("response", lambda rs: errs.append("HTTP %d %s" % (rs.status, rs.url))
                  if rs.status >= 400 and not rs.url.endswith("/favicon.ico") else None)
            url = "http://127.0.0.1:%d%s?glb=/hit-parade/art/gltf/fighters/%s.glb&cj=/hit-parade/data/clips/%s.clips.json&cols=6" % (
                port, PAGE, fid, fid)
            pg.goto(url)
            try:
                pg.wait_for_function("window.__RESULT__ !== null", timeout=TIMEOUT_MS)
            except Exception as ex:  # noqa - report instead of a bare traceback
                print("[three]", fid, "TIMEOUT after %d s" % (TIMEOUT_MS // 1000), "page errors:", errs[:8])
                pg.close()
                bad += 1
                continue
            r = pg.evaluate("window.__RESULT__")
            pg.close()
            png = r.pop("png", None)
            r["pageErrors"] = errs
            out_dir = GAME + "/art/renders/" + fid
            os.makedirs(out_dir, exist_ok=True)
            if png:
                im = Image.open(io.BytesIO(base64.b64decode(png.split(",", 1)[1]))).convert("RGB")
                d = ImageDraw.Draw(im)
                tw, th = r["tile"]
                for i, n in enumerate(r["names"]):
                    c = r["clips"].get(n, {})
                    x, y = (i % r["cols"]) * tw, (i // r["cols"]) * th
                    d.text((x + 4, y + 3), "%s t%.2f" % (n, c.get("t", -1)), fill=(255, 220, 90), font=font)
                    d.text((x + 4, y + 17), "minY %+.3f" % c.get("minY", 9), fill=(210, 210, 220), font=font)
                im.save(out_dir + "/three_check.png")
            with open(out_dir + "/three_check.json", "w", encoding="utf-8") as fh:
                json.dump(r, fh, indent=1)
            if not r.get("ok"):
                print("[three]", fid, "FAIL", r.get("error"), errs)
                bad += 1
                continue
            lows = {n: c["minY"] for n, c in r["clips"].items() if "minY" in c}
            eff = {n: (c["effectorThree"], c["effectorJson"]) for n, c in r["clips"].items() if "effectorThree" in c}
            effd = max([abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in eff.values()] or [0.0])
            ok = (not r["missingInGlb"]) and (not r["extraInGlb"]) and r["skinnedMeshes"] >= 1 and not errs
            print("[three]", fid, "OK" if ok else "FAIL", "load %dms" % r["loadMs"], "anims", len(r["animations"]),
                  "missing", r["missingInGlb"], "extra", r["extraInGlb"], "skinned", r["skinnedMeshes"], "bones", r["maxBones"],
                  "minY range %.3f..%.3f" % (min(lows.values()), max(lows.values())),
                  "effector |three-json| max %.4f m" % effd, "materials", r["materials"], "errors", errs[:3])
            if not ok:
                bad += 1
        br.close()
    srv.shutdown()
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
