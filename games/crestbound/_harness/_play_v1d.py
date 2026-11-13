"""VERDANT-1 leg D: gnasher, pond, cave, mill, race, warden, bumblers,
plus the moves a player is told to use (C-crouch long jump / backflip) and look."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant1d")
    pl.goto("verdant-1"); pl.wait(1200)

    print("\n=== P1/P2 LOOK: does the mouse looking UP look UP? ===")
    before = pl.ev("()=>({pitch:+CRESTBOUND.game.cam.pitch.toFixed(3), yaw:+CRESTBOUND.game.cam.yaw.toFixed(3)})")
    pg.mouse.move(640, 400); pg.mouse.down(); pg.mouse.move(640, 250, steps=12); pg.mouse.up()
    pl.wait(500)
    after = pl.ev("()=>({pitch:+CRESTBOUND.game.cam.pitch.toFixed(3), yaw:+CRESTBOUND.game.cam.yaw.toFixed(3)})")
    print("   drag mouse UP 150 px: pitch %s -> %s   (pitchMax=+0.95 is LOOKING DOWN-from-above? check the shot)" % (before, after))
    pl.shot("look_after_dragging_up")
    pg.mouse.move(640, 250); pg.mouse.down(); pg.mouse.move(640, 480, steps=12); pg.mouse.up(); pl.wait(500)
    print("   drag mouse DOWN 230 px: pitch ->", pl.ev("()=>+CRESTBOUND.game.cam.pitch.toFixed(3)"))
    pl.shot("look_after_dragging_down")
    # Q / E orbit
    pl.ev("()=>{CRESTBOUND.game.cam.recenter(); return 1;}"); pl.wait(500)
    y0 = pl.ev("()=>+CRESTBOUND.game.cam.yaw.toFixed(3)")
    pl.walk("q", 700); pl.wait(300)
    y1 = pl.ev("()=>+CRESTBOUND.game.cam.yaw.toFixed(3)")
    pl.walk("e", 700); pl.wait(300)
    y2 = pl.ev("()=>+CRESTBOUND.game.cam.yaw.toFixed(3)")
    print("   Q orbit %.3f -> %.3f ; E orbit -> %.3f" % (y0, y1, y2))

    print("\n=== P3 CROUCH COMBOS ON C ===")
    def combo(label, x, y, z, yaw, run_ms, crouch_first=False):
        pl.tp(x, y, z, yaw); pl.wait(350); pl.rec_reset()
        if run_ms: pl.down("w"); pl.wait(run_ms)
        pl.down("c"); pl.wait(70); pl.tap("Space", 110); pl.wait(120); pl.up("c")
        pl.wait(1400); pl.release_all(); pl.wait(500)
        r = pl.rec(); s = pl.st()
        print("   %-26s -> events %s  apex %.2f  dz %.2f  states %s" %
              (label, [e["e"] for e in r["events"]][:6], r["maxY"] - y,
               abs(s["z"] - z), [q["s"] for q in r["states"]][:8]))
        return r
    combo("LONG JUMP (run + C + Space)", 0, 2.6, 44, S, 1100)
    combo("BACKFLIP (still + C + Space)", 0, 2.6, 44, S, 0)
    # ctrl should still work
    pl.tp(0, 2.6, 44, S); pl.wait(350); pl.rec_reset()
    pl.down("w"); pl.wait(1100); pl.down("Control"); pl.wait(70); pl.tap("Space", 110); pl.wait(120)
    pl.up("Control"); pl.wait(1400); pl.release_all(); pl.wait(400)
    r = pl.rec(); print("   %-26s -> events %s" % ("LONG JUMP on Ctrl", [e["e"] for e in r["events"]][:6]))
    # ground pound on C
    pl.tp(0, 2.6, 44, S); pl.wait(350); pl.rec_reset()
    pl.tap("Space", 130); pl.wait(300); pl.down("c"); pl.wait(900); pl.up("c"); pl.wait(700)
    r = pl.rec(); print("   %-26s -> events %s" % ("POUND on C (jump then C)", [e["e"] for e in r["events"]][:6]))

    print("\n=== BEAT 5 THE GNASHER ===")
    pl.tp(-8.0, 8.0, -12.0, N); pl.wait(500); pl.shot("gnasher_from_outside")
    print("   standing 5 m outside the chain, doing nothing for 4 s...")
    pl.rec_reset(); pl.wait(4000)
    r = pl.rec(); s = pl.st()
    print("   -> deaths %d  events %s  state %s" % (s["deaths"], [e["e"] for e in r["events"]][:6], s["st"]))
    # walk into its reach
    pl.rec_reset(); pl.walk("w", 1400); pl.wait(2500)
    s = pl.st(); r = pl.rec()
    print("   walked into the disc -> pos [%.1f %.1f] deaths %d  events %s" %
          (s["x"], s["z"], s["deaths"], [e["e"] for e in r["events"]][:8]))
    pl.shot("gnasher_in_reach")
    # pound the post 3x
    print("   pounding the post at [-8, 7.40, -7] three times")
    for i in range(4):
        pl.tp(-8.0, 10.4, -7.0, N); pl.wait(400); pl.rec_reset()
        pl.tap("Space", 130); pl.wait(260); pl.down("c"); pl.wait(1100); pl.up("c"); pl.wait(600)
        r = pl.rec()
        print("      pound %d -> events %s" % (i + 1, [e["e"] for e in r["events"]][:6]))
    pl.wait(800); pl.shot("gnasher_after_pounds")
    print("   crests now:", pl.st()["crests"], " flags:",
          pl.ev("()=>{const t=CRESTBOUND.game.course&&CRESTBOUND.game.course.triggers; return t?Object.keys(t):null;}"))

    print("\n=== BEAT 6 THE POND ===")
    pl.tp(-28.0, 3.2, -8.0, W); pl.wait(400); pl.shot("pond_beach")
    pl.rec_reset(); pl.down("w"); pl.wait(2600)
    s1 = pl.st(); print("   waded west 2.6 s -> [%.1f %.1f %.1f] water=%s state %s" % (s1["x"], s1["y"], s1["z"], s1["water"], s1["st"]))
    pl.wait(2600); s2 = pl.st(); pl.release_all(); pl.wait(400)
    print("   kept swimming    -> [%.1f %.1f %.1f] water=%s state %s" % (s2["x"], s2["y"], s2["z"], s2["water"], s2["st"]))
    pl.shot("pond_swimming")
    # dive for sigil 5 at [-40, -0.45, -9] (floor -1.00, surface 1.40)
    pl.tp(-40.0, 1.2, -9.0, W); pl.wait(600)
    print("   floating over sigil 5:", json.dumps(pl.st()))
    pl.rec_reset(); pl.down("c"); pl.wait(2600); pl.up("c"); pl.wait(600)
    s = pl.st(); r = pl.rec()
    print("   held C to sink -> y %.2f sub=%s sigils %s events %s" % (s["y"], s["sub"], s["sig"], [e["e"] for e in r["events"]][:6]))
    pl.shot("pond_dive")
    # surface and get out
    pl.rec_reset()
    for i in range(10): pl.tap("Space", 100); pl.wait(240)
    pl.down("d"); pl.wait(3000); pl.release_all(); pl.wait(600)
    s = pl.st(); print("   stroke up + swim east -> [%.1f %.1f %.1f] water=%s gr=%s state %s" % (s["x"], s["y"], s["z"], s["water"], s["gr"], s["st"]))
    pl.shot("pond_exit")

    print("\nERRORS:", errs[:10])
    br.close()
