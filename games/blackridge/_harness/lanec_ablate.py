#!/usr/bin/env python
"""LANE C ablation — capture the two repro poses with named meshes hidden.

    python lanec_ablate.py --hide wet_specular
    python lanec_ablate.py --hide ""            # baseline
"""
import argparse, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server  # noqa: E402

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"
W, H = 1280, 720

POSES = [
    ("neonwedge", 5.0, 1.65, 8.0, 240, -30),     # red/green wedge on the cobbles
    ("galdoor",  20.0, 1.65, -16.0, 0, -18),     # interior floor over the r_cut seam
    ("galseam",  20.0, 1.65, -20.0, 270, -18),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hide", default="")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()
    ensure_server()
    tag = args.tag or (("_no_" + args.hide.replace(",", "_")) if args.hide else "_base")
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": W, "height": H})
        pg.goto(URL, wait_until="load", timeout=60_000)
        t0 = time.time()
        while time.time() - t0 < 120 and not pg.evaluate(READY):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(2000)
        pg.evaluate("() => __FPS__.__test.startMission({seed: 7})")
        pg.wait_for_timeout(1500)
        pg.evaluate("() => { __FPS__.__test.god(true); __FPS__.__test.hud(false); }")
        if args.hide:
            n = pg.evaluate("""(names) => { let n = 0;
                __FPS__.scene.traverse(o => {
                  if ((o.isMesh || o.isPoints) && names.includes(o.name)) { o.visible = false; n++; }
                }); return n; }""", args.hide.split(","))
            print(f"hidden {n} mesh(es): {args.hide}")
        for name, x, y, z, yaw, pitch in POSES:
            pg.evaluate("""(a) => __FPS__.__test.placePlayer(a.x, a.y, a.z,
                             a.yaw * Math.PI / 180, a.pitch * Math.PI / 180)""",
                        {"x": x, "y": y, "z": z, "yaw": yaw, "pitch": pitch})
            pg.wait_for_timeout(200)
            r = pg.evaluate("(n) => __FPS__.__test.capture(n, %d, %d, {hudLayer:false})" % (W, H),
                            f"lanec_ab/{name}{tag}.png")
            print(name, r.get("server"))
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
