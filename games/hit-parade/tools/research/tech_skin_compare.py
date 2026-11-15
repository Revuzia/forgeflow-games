"""TECH_REUSE lane: render the same clip frame of several skinned GLB variants in headless Chrome (three 0.186 from
dyefield's node_modules) and compare them against the first (the source) pixel by pixel.
Usage:
  python tech_skin_compare.py --out <dir> --clip clip --times 0.3,1.0,1.6 <src.glb> <variant.glb> ...
GLB paths must live under forgeflow-games/games (served by a local static server on a free port).
Writes <dir>/skin_<variant>_t<t>.png, <dir>/skin_compare.json and a side-by-side sheet per time. ASCII only.
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

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

GAMES = "C:/Users/TestRun/Claude Claw/forgeflow-games/games"
PAGE = "/hit-parade/tools/research/tech_skin_view.html"
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--clip", default="clip")
    ap.add_argument("--times", default="0.3,1.0,1.6")
    ap.add_argument("--cam", default="0,1.1,3.6")
    ap.add_argument("--tgt", default="0,0.9,0")
    ap.add_argument("glbs", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    port = free_port()
    Handler = functools.partial(Quiet, directory=GAMES)
    Handler.extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    Handler.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".wasm": "application/wasm"})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    times = [float(t) for t in a.times.split(",")]
    results = {"port": port, "clip": a.clip, "times": times, "files": {}, "diff": {}}
    imgs = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        for g in a.glbs:
            rel = os.path.abspath(g).replace("\\", "/")
            if not rel.lower().startswith(GAMES.lower()):
                raise SystemExit("GLB must be under " + GAMES)
            url_glb = rel[len(GAMES):]
            name = os.path.splitext(os.path.basename(g))[0]
            results["files"][name] = {}
            for t in times:
                pg = br.new_page(viewport={"width": 640, "height": 800})
                errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type in ("error", "warning") else None)
                url = "http://127.0.0.1:%d%s?glb=%s&clip=%s&t=%s&cam=%s&tgt=%s" % (port, PAGE, url_glb, a.clip, t, a.cam, a.tgt)
                pg.goto(url)
                pg.wait_for_function("window.__RESULT__ !== null", timeout=60000)
                r = pg.evaluate("window.__RESULT__")
                pg.close()
                png = r.pop("png", None)
                r["pageErrors"] = errs
                results["files"][name]["t%.2f" % t] = r
                if not r.get("ok") or not png:
                    print("FAIL", name, t, r.get("error"), errs)
                    continue
                im = Image.open(io.BytesIO(base64.b64decode(png.split(",", 1)[1]))).convert("RGBA")
                p = os.path.join(a.out, "skin_%s_t%.2f.png" % (name, t))
                im.save(p)
                imgs[(name, t)] = np.asarray(im).astype(np.int16)
                print("OK", name, "t=%.2f" % t, "load %d ms" % r["loadMs"], "skinned", r["skinnedMeshes"], "bones", r["maxBones"], "box", r["box"])
        br.close()
    srv.shutdown()
    src = os.path.splitext(os.path.basename(a.glbs[0]))[0]
    for g in a.glbs[1:]:
        name = os.path.splitext(os.path.basename(g))[0]
        for t in times:
            A, B = imgs.get((src, t)), imgs.get((name, t))
            if A is None or B is None:
                continue
            ma, mb = A[..., 3] > 0, B[..., 3] > 0
            inter, union = int((ma & mb).sum()), int((ma | mb).sum())
            both = ma & mb
            rgb = np.abs(A[..., :3] - B[..., :3]).max(axis=2)
            d = {
                "silhouette_iou": round(inter / union, 5) if union else None,
                "silhouette_px_src": int(ma.sum()), "silhouette_px_var": int(mb.sum()),
                "silhouette_xor_px": int((ma ^ mb).sum()),
                "rgb_mean_absdiff_inside": round(float(rgb[both].mean()), 3) if both.any() else None,
                "rgb_px_over32_inside_pct": round(100.0 * float((rgb[both] > 32).mean()), 3) if both.any() else None,
            }
            results["diff"]["%s_vs_%s_t%.2f" % (name, src, t)] = d
            print("DIFF", name, "t=%.2f" % t, d)
    # side-by-side sheets
    names = [os.path.splitext(os.path.basename(g))[0] for g in a.glbs]
    for t in times:
        row = [Image.fromarray(imgs[(n, t)].astype(np.uint8), "RGBA") for n in names if (n, t) in imgs]
        if not row:
            continue
        sheet = Image.new("RGB", (640 * len(row), 800), (40, 40, 48))
        for i, im in enumerate(row):
            sheet.paste(im, (640 * i, 0), im)
        sp = os.path.join(a.out, "skin_sheet_t%.2f.png" % t)
        sheet.save(sp)
        print("SHEET", sp, "order", names)
    with open(os.path.join(a.out, "skin_compare.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)


if __name__ == "__main__":
    main()
