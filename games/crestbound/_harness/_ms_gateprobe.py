#!/usr/bin/env python
"""Missions lane: re-drive gatecheck's FAILED rows HAND-STEPPED, to tell load from defect.

gatecheck.py waits on the WALL clock (900 ms after a drop, a 3.4 s walk budget). On a box
at 100 % CPU a live frame took ~4 s, so a drop "ended" 0.37 m above the floor and a walk
never left its spot. This runs the same rows on the SHIPPING build with gatecheck's own
JS (DROP / LANDED / AIM / place / SET_CRESTS), but advances the game with
game.update(1/60) while the engine is stopped, and drives the walk with a REAL held W
(Playwright keyboard) and the cancel with a REAL Escape.

    python _harness/_ms_gateprobe.py --url URL --gates ember-3,ember-4,rime-2,azure-1,azure-2,azure-3
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gatecheck as GC  # noqa: E402

STEP = r"""(n) => { const A = CRESTBOUND, G = A.game, E = A.engine; E.stop();
  for (let i = 0; i < n; i++) G.update(1 / 60); E.render(1 / 60);
  return { state: G.state, grounded: !!G.player.grounded, pstate: G.player.state,
           pos: [+G.player.pos.x.toFixed(2), +G.player.pos.y.toFixed(2), +G.player.pos.z.toFixed(2)] }; }"""

WALK = r"""([course, offset, maxFrames]) => { const A = CRESTBOUND, G = A.game, E = A.engine; E.stop();
  const g = (G._gates || []).find(x => x.course === course);
  let i = 0;
  for (i = 0; i < maxFrames; i++) {
    const lx = Math.cos(g.yaw), lz = -Math.sin(g.yaw);
    const tx = g.pos.x + lx * offset * 0.35, tz = g.pos.z + lz * offset * 0.35;
    const dx = tx - G.player.pos.x, dz = tz - G.player.pos.z;
    if (dx * dx + dz * dz > 1e-4) { const slide = (typeof G.cam._yawSlide === 'number') ? G.cam._yawSlide : 0;
      G.cam.yaw = Math.atan2(-dx, -dz) - slide; G.cam._rcHoldT = 0; }
    G.update(1 / 60);
    if (G.state === 'card') break;
  }
  return { frames: i, state: G.state, pstate: G.player.state,
           pos: [+G.player.pos.x.toFixed(2), +G.player.pos.y.toFixed(2), +G.player.pos.z.toFixed(2)] }; }"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=GC.BASE)
    ap.add_argument("--gates", default="ember-3,ember-4,rime-2,azure-1,azure-2,azure-3")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    want = [g.strip() for g in args.gates.split(",") if g.strip()]
    rows = []
    errors = []

    def ok(name, cond, detail):
        rows.append({"name": name, "ok": bool(cond), "detail": detail})
        print(("  ok    " if cond else "  FAIL  ") + name + "   " + str(detail), flush=True)

    with sync_playwright() as p:
        try:
            br = p.chromium.launch(channel="chrome", headless=True, args=GC.FLAGS)
        except Exception:
            br = p.chromium.launch(headless=True, args=GC.HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        pg.goto(args.url + "?quality=low&autoscale=0", wait_until="load", timeout=180000)
        GC.wait_ready(pg, timeout=600)
        pg.wait_for_timeout(1500)
        print("title ->", pg.evaluate(GC.CLICK_TITLE), flush=True)
        for _ in range(240):
            if pg.evaluate("() => CRESTBOUND.game.state === 'keep' && !CRESTBOUND.game._loading"):
                break
            pg.wait_for_timeout(500)
        print("state", pg.evaluate("() => CRESTBOUND.game.state"), flush=True)

        # ---- the floor in front of each gate (gatecheck: DROP, wait 900 ms, LANDED) ----
        pg.evaluate(GC.SET_CRESTS, 0)
        for course in want:
            d = pg.evaluate(GC.DROP, course)
            s = pg.evaluate(STEP, 90)          # 1.5 s of game time, hand-stepped
            ok("%s: floor in front (dropped 0.6 m at %s, 90 hand-stepped frames)" % (course, d),
               s["grounded"], json.dumps(s))

        # ---- walk-ins and cancels, every gate open ----
        pg.evaluate(GC.SET_CRESTS, 99)
        pg.evaluate("() => { const E = CRESTBOUND.engine; E.start(E._loopFn); return true; }")
        pg.wait_for_timeout(2000)
        for course in want:
            off = 0.6 if course == "azure-3" else 1.0
            for a in (0.0, -off, off):
                GC.place(pg, course, a)
                pg.keyboard.down("w")
                w = pg.evaluate(WALK, [course, a, 600])
                pg.keyboard.up("w")
                raised = w["state"] == "card"
                ok("%s: walk-in (offset %+.1f m) raises the card [real W, hand-stepped]" % (course, a), raised, json.dumps(w))
                if not raised:
                    pg.evaluate("() => { const E = CRESTBOUND.engine; E.start(E._loopFn); return true; }")
                    continue
                opened = False
                for _ in range(120):
                    if pg.evaluate("() => !!document.querySelector('.cb-card.on')"):
                        opened = True
                        break
                    pg.wait_for_timeout(250)
                pg.wait_for_timeout(400)
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(700)
                s = pg.evaluate(STEP, 30)
                ok("%s: real Escape on the card (offset %+.1f m) returns control" % (course, a),
                   s["state"] == "keep", "card shown %s -> %s" % (opened, json.dumps(s)))
                pg.evaluate("() => { const E = CRESTBOUND.engine; E.start(E._loopFn); return true; }")
                pg.wait_for_timeout(600)
        br.close()
    n_fail = sum(1 for r in rows if not r["ok"])
    print("PROBE: %d rows, %d failed, page errors %d" % (len(rows), n_fail, len(errors)), flush=True)
    for e in errors[:5]:
        print("   pageerror", e)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"rows": rows, "errors": errors}, f, indent=1)
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
