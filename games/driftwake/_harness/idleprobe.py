#!/usr/bin/env python
"""Prove the idle animation actually plays while standing still.

Boots the game, waits for ready, then grabs N frames a fixed interval apart
and reports (a) the mixer's live state/weights via the SNOWFLOW global and
(b) mean |pixel delta| inside the character's screen box vs a same-size
background control box. Breathing idle => char delta well above control.

    python _harness/idleprobe.py [--url ...]
"""
import argparse, io, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops, ImageStat

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# 1280x720 third-person boot camera: character occupies roughly this box
# (measured off bootcheck.png); control = same-size box of plain snow.
CHAR_BOX = (490, 290, 620, 530)
CTRL_BOX = (900, 290, 1030, 530)

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8799/games/driftwake/index.html")
ap.add_argument("--frames", type=int, default=4)
ap.add_argument("--gap", type=float, default=1.2, help="seconds between frames")
a = ap.parse_args()

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.goto(a.url, wait_until="load", timeout=60_000)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(3000)  # settle: LAND from spawn drop fades out

    mix = pg.evaluate("""() => {
        const SF = globalThis.SNOWFLOW;
        const mc = SF && (SF.meshChar || SF.char || SF.rider);
        if (!mc) return {exposed: false};
        return {exposed: true,
                state: mc._state,
                weights: mc._weights ? Array.from(mc._weights).map(w => +w.toFixed(3)) : null,
                idleTime: mc._acts && mc._acts[0] ? +mc._acts[0].time.toFixed(2) : null,
                paused: mc._acts && mc._acts[0] ? mc._acts[0].paused : null};
    }""")
    print("mixer   ", mix)

    shots = []
    for i in range(a.frames):
        shots.append(Image.open(io.BytesIO(pg.screenshot())).convert("L"))
        if i < a.frames - 1:
            pg.wait_for_timeout(int(a.gap * 1000))
    idle_t2 = pg.evaluate("""() => {
        const SF = globalThis.SNOWFLOW;
        const mc = SF && (SF.meshChar || SF.char || SF.rider);
        return mc && mc._acts && mc._acts[0] ? +mc._acts[0].time.toFixed(2) : null;
    }""")
    br.close()

print(f"idle clip time advanced to {idle_t2}s over the capture window")
for i in range(1, len(shots)):
    d = ImageChops.difference(shots[i - 1], shots[i])
    cd = ImageStat.Stat(d.crop(CHAR_BOX)).mean[0]
    bd = ImageStat.Stat(d.crop(CTRL_BOX)).mean[0]
    print(f"frame {i-1}->{i}:  char-box delta {cd:6.2f}   control-box delta {bd:6.2f}")
print("VERDICT:", "IDLE ANIMATING" if any(
    ImageStat.Stat(ImageChops.difference(shots[i-1], shots[i]).crop(CHAR_BOX)).mean[0] >
    2.0 * max(0.05, ImageStat.Stat(ImageChops.difference(shots[i-1], shots[i]).crop(CTRL_BOX)).mean[0])
    for i in range(1, len(shots))) else "NO CHARACTER MOTION DETECTED")
