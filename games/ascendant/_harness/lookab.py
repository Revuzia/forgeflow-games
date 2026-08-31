#!/usr/bin/env python
"""ASCENDANT look A/B — the OLD post chain and the NEW one, same pose, same frame.

The cost of the chain rewrite is only acceptable if the image survives it, and
"I changed the bloom resolution and it looks fine to me" is not evidence. This
builds both chains against the same renderer in one session (see chainab.py),
poses the camera identically, and renders each chain to the canvas in turn so
the two screenshots differ ONLY by the post chain.

Writes _shots/ab_<stage>_<station>_old.png and _new.png.

    python lookab.py --stages neon-1 --per 2
"""
import argparse
import os
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shots import wait_ready, click_play, FLAGS, SHOTS  # noqa: E402
from chainab import BUILD  # noqa: E402

BASE = "http://localhost:8788/games/ascendant/index.html"

# Drive whichever chain is selected straight to the canvas, every frame, so the
# screenshot captures a live-composited image rather than a stale backbuffer
# (the renderer is created with preserveDrawingBuffer:false).
SHOW = "(which) => globalThis.__ab.select(which)"

# Hide every DOM layer over the canvas so the pair differs only by rendered
# pixels. This matters more than it sounds: losing pointer lock raises the
# "CLICK TO RESUME" veil, which is a full-screen backdrop-filter blur, and it
# washes the whole frame to near-white. Screenshots taken through it are
# useless for judging bloom -- that is what the first attempt captured, and it
# is why the project's own shots.py output looks blown out too.
HIDE_UI = """() => {
  const s = document.createElement('style');
  s.textContent = '#hud,#ui,.asc-dev,.asc-hud{display:none !important}' +
    '*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}';
  document.head.appendChild(s);
}"""

# shots.py's POSE_JS aims at checkpoint stations, which on neon-1 parks the
# camera inside the start cage where the viewmodel's own emissive glow fills the
# frame -- a useless view for judging bloom or edges. Stand just off spawn and
# look down the course instead.
POSE = """async ([dx, dy]) => {
  const P = ASCENDANT.game.player;
  if (!P || !P.__test) return {error: 'no player'};
  const v = P.pos.clone(); v.x += dx; v.y += dy;
  P.__test.teleport(v);
  P.__test.setVel(new (P.pos.constructor)(0, 0, 0));
  const frame = () => new Promise(r => requestAnimationFrame(r));
  for (let k = 0; k < 40; k++) await frame();
  return {x: +v.x.toFixed(1), y: +v.y.toFixed(1), z: +v.z.toFixed(1)};
}"""

ENTER = """async (sid) => {
  const g = ASCENDANT.game;
  if (!g.__dev) return 'no dev api (need ?dev=1)';
  await g.__dev.goto(sid);
  return ASCENDANT.game.stage && ASCENDANT.game.stage.id;
}"""

EXPOSE = r"""
() => {
  // chainab's BUILD keeps the composers in closures; re-expose them by name.
  const W = globalThis.__ab;
  return Object.keys(W.comps || {});
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="neon-1")
    ap.add_argument("--per", type=int, default=2)
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    os.makedirs(SHOTS, exist_ok=True)
    stages = [s.strip() for s in args.stages.split(",") if s.strip()]

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        for sid in stages:
            pg.goto(f"{BASE}?dev=1&quality={args.quality}&stage={sid}",
                    wait_until="load", timeout=60_000)
            if not wait_ready(pg):
                print(f"{sid}: stage never loaded")
                continue
            for _ in range(8):
                if pg.evaluate("()=>ASCENDANT.state") != "title":
                    break
                click_play(pg)
                pg.wait_for_timeout(1000)
            pg.wait_for_timeout(2500)
            loaded = pg.evaluate(ENTER, sid)
            pg.wait_for_timeout(2500)
            pg.evaluate(HIDE_UI)
            pg.evaluate(BUILD)
            print(f"{sid}: loaded stage {loaded!r}, chains ->", pg.evaluate(EXPOSE))

            for i in range(args.per):
                # Pose ONCE, then shoot both chains from the identical camera.
                # Re-posing between the two shots let the player drift (and on
                # one run fall back to the hub), so the pair no longer differed
                # only by the post chain -- which is the whole point of it.
                pose = pg.evaluate(POSE, [6 + i * 18, 1.2])
                for which in ("old", "new"):
                    pg.evaluate(SHOW, which)
                    pg.wait_for_timeout(900)
                    out = os.path.join(SHOTS, f"ab_{sid}_{i}_{which}.png")
                    pg.screenshot(path=out)
                    print(f"  {which:<4} station {i} {pose} -> {os.path.basename(out)}")
        br.close()
    print(f"\nshots in {os.path.abspath(SHOTS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
