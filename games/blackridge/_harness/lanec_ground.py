#!/usr/bin/env python
"""LANE C ground-glitch probe — reproduce, measure, ablate.

Drives the REAL game: boots the page, starts a mission, teleports the player
onto interior floors, holds the frame, and measures the floor band of the
frame for (a) z-fight speckle (per-pixel flicker between two consecutive
renders of the IDENTICAL camera pose) and (b) red/maroon pixels.

    python lanec_ground.py                 # measure all poses
    python lanec_ground.py --ablate ground # hide a named mesh and re-measure
"""
import argparse, json, os, sys, time
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

# eye poses: [name, x, y, z, yawDeg, pitchDeg]
POSES = [
    ["gallery_door_S",   20.0, 1.65, -16.0,  180,  -22],   # look INTO gallery over the r_cut seam
    ["gallery_seam",     20.0, 1.65, -24.0,    0,  -25],   # standing on the seam, look back S
    ["gallery_mid",      20.0, 1.65, -28.0,    0,  -20],
    ["arcade_door_S",   -32.0, 1.65, -14.0,  180,  -22],   # arcade / r_cs1 seam
    ["arcade_seam",     -32.0, 1.65, -20.5,    0,  -25],
    ["blvd_cye_seam",    37.0, 1.65, -36.0,  180,  -20],
    ["street_customs",   -6.0, 1.65, -37.0,  180,  -20],
]

# Grab the framebuffer straight out of the live renderer, twice, same pose.
GRAB = """(a) => {
  const F = globalThis.__FPS__;
  const gl = F.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let s = '';
  const CH = 8192;
  for (let i = 0; i < buf.length; i += CH)
    s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return { w, h, b64: btoa(s) };
}"""


def analyse(px, w, h):
    """px = RGBA bytes, GL bottom-left origin. Floor band = bottom 45% of frame."""
    y0, y1 = 0, int(h * 0.45)
    dark = red = tot = 0
    reds = []
    for y in range(y0, y1, 2):
        for x in range(0, w, 2):
            i = (y * w + x) * 4
            r, g, b = px[i], px[i + 1], px[i + 2]
            tot += 1
            if r + g + b < 24:
                dark += 1
            # red/maroon: r clearly dominant, not a neutral, not a bright light
            if r > 40 and r > g * 1.9 + 12 and r > b * 1.9 + 12:
                red += 1
                reds.append((x, h - 1 - y, r, g, b))
    return dark, red, tot, reds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=URL)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--hide", default="", help="comma list of mesh names to hide")
    ap.add_argument("--only", default="")
    ap.add_argument("--shots", default=os.path.join(HERE, "..", "_shots", "lanec"))
    args = ap.parse_args()
    ensure_server()
    os.makedirs(os.path.abspath(args.shots), exist_ok=True)

    import base64
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        gl_warn = []
        pg.on("console", lambda m: gl_warn.append(m.text) if "Feedback loop" in m.text else None)
        pg.goto(args.url, wait_until="load", timeout=60_000)
        t0 = time.time()
        while time.time() - t0 < 120 and not pg.evaluate(READY):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(2000)
        pg.evaluate("() => __FPS__.__test.startMission({seed: 7})")
        pg.wait_for_timeout(1500)
        pg.evaluate("() => { __FPS__.__test.god(true); __FPS__.__test.noTarget(true); __FPS__.__test.hud(false); }")

        if args.hide:
            n = pg.evaluate("""(names) => {
              let n = 0;
              __FPS__.scene.traverse(o => {
                if (o.isMesh && names.includes(o.name)) { o.visible = false; n++; }
              });
              return n;
            }""", args.hide.split(","))
            print(f"hidden {n} mesh(es) named {args.hide}")

        for name, x, y, z, yaw, pitch in POSES:
            if args.only and args.only != name:
                continue
            pg.evaluate("""(a) => {
              const T = __FPS__.__test;
              T.placePlayer(a.x, a.y, a.z, a.yaw * Math.PI / 180, a.pitch * Math.PI / 180);
            }""", {"x": x, "y": y, "z": z, "yaw": yaw, "pitch": pitch})
            pg.wait_for_timeout(500)
            tag = "_hide" if args.hide else ""
            # capture() renders + reads back in ONE task (a bare readPixels
            # after the frame returns a cleared buffer — measured: 100% black).
            res = pg.evaluate("""(n) => __FPS__.__test.capture(n, 1280, 720, {hudLayer:false})""",
                              f"lanec/{name}{tag}.png")
            print(json.dumps({"pose": name, "capture": res.get("server")}))
        print(f"feedback-loop console warnings during run: {len(gl_warn)}")
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
