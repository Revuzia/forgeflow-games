#!/usr/bin/env python
"""SCRATCH PROBE (not a gate). Replays one route segment hand-stepped and dumps
the camera's FULL internal state every frame (yawSlide, focusDrop, limitFrame /
limitCeil / limitLens, focus, dist), then prints a window around the worst
single-frame pull-in. Answers "what actually changed in the frame the lens
collapsed" instead of inferring it."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camshots as CS
from playwright.sync_api import sync_playwright

COURSE = sys.argv[1] if len(sys.argv) > 1 else "verdant-1"
SEG    = sys.argv[2] if len(sys.argv) > 2 else "brook"
ROUTE  = [s for s in CS.ROUTES[COURSE] if s["name"] == SEG]

PROBE = r"""() => {
  const G = CRESTBOUND.game, cam = G.cam || G.camera, P = G.player;
  const s = cam.__test.state();
  return {d: +s.dist.toFixed(4), ys: +s.yawSlide.toFixed(4), fd: +s.focusDrop.toFixed(3),
          lf: !!s.limitFrame, lc: !!s.limitCeil, ll: +(cam._limitLens || 0).toFixed(3),
          da: +(cam._distAdapt || 0).toFixed(3),
          yaw: +s.yaw.toFixed(3), pit: +s.pitch.toFixed(3), fade: +s.heroFade.toFixed(2),
          fx: +s.focus[0].toFixed(3), fy: +s.focus[1].toFixed(3), fz: +s.focus[2].toFixed(3),
          sh: +s.shoulder.toFixed(3), st: P.state,
          sp: +Math.hypot(P.vel.x, P.vel.z).toFixed(2)};
}"""

def main():
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=CS.FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(CS.DEFAULT_URL, wait_until="load", timeout=180000)
        for _ in range(40):
            if pg.evaluate(CS.STATE_JS) in ("keep", "playing"): break
            pg.evaluate(CS.CLICK_JS); pg.wait_for_timeout(600)
        for _ in range(60):
            if pg.evaluate(CS.READY_JS): break
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        if COURSE != "keep":
            pg.evaluate("(id) => CRESTBOUND.game.__dev.goto(id)", COURSE)
            for _ in range(60):
                if pg.evaluate(CS.STATE_JS) == "playing" and pg.evaluate("CRESTBOUND.game.courseId") == COURSE: break
                pg.wait_for_timeout(200)
            pg.wait_for_timeout(1200)
        print("driver:", pg.evaluate(CS.DRIVER_JS, ROUTE))
        rows = []
        while True:
            r = pg.evaluate("(n) => __CAM.step(n)", 1)
            rows.append(pg.evaluate(PROBE))
            if r["done"]: break
        br.close()
    worst, wi = 0, 0
    for i in range(1, len(rows)):
        dd = rows[i]["d"] - rows[i - 1]["d"]
        if dd < worst: worst, wi = dd, i
    print("worst single-frame dDist %.3f at frame %d of %d" % (worst, wi, len(rows)))
    print(" fr    dist    dDist   ys     fd    ll     da    yaw    pit  fade  focus(x,y,z)            sh    state    sp")
    for i in range(max(0, wi - 14), min(len(rows), wi + 8)):
        r = rows[i]; dd = r["d"] - rows[i - 1]["d"] if i else 0
        print("%4d %7.3f %7.3f %6.3f %5.2f %6.2f %6.2f %6.3f %6.3f %5.2f (%7.2f,%6.2f,%7.2f) %5.2f %-8s %5.2f  %s%s" % (
            i, r["d"], dd, r["ys"], r["fd"], r["ll"], r["da"], r["yaw"], r["pit"], r["fade"],
            r["fx"], r["fy"], r["fz"], r["sh"], r["st"], r["sp"],
            "FRAME " if r["lf"] else "", "CEIL" if r["lc"] else ""))

main()
