"""VERDANT-1 leg C: brook -> climb -> fort -> the shaft -> the open crest."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2   # yaw facing -Z, +Z, +X, -X

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant1c")
    pl.goto("verdant-1"); pl.wait(1200)

    def leg(label, x, y, z, yaw, keys="w", ms=1500, jumps=(), shot=None, wait_after=500):
        pl.tp(x, y, z, yaw); pl.wait(300); pl.rec_reset()
        pl.down("w") if "w" in keys else None
        for k in keys:
            if k != "w": pl.down(k)
        t = 0
        for at in sorted(jumps):
            if at > t: pl.wait(at - t); t = at
            pl.tap("Space", 110); t += 110
        if ms > t: pl.wait(ms - t)
        pl.release_all(); pl.wait(wait_after)
        s = pl.st(); r = pl.rec()
        print("   %-34s -> [%.1f %.1f %.1f] %s gr=%s  ev=%s" %
              (label, s["x"], s["y"], s["z"], s["st"], s["gr"],
               [e["e"] for e in r["events"]][:8]))
        if shot: pl.shot(shot)
        return s, r

    print("\n=== BEAT 2 THE BROOK ===")
    # jump the lip, run the deck, jump the 3.50 m hole
    leg("lip jump then the hole", 0, 2.6, 34, N, "w", 3600, jumps=(560, 1500), shot="brook_hole_attempt")
    # deliberately fall in the brook and try to get out
    s, r = leg("fall in the brook on purpose", 0, 3.2, 22, N, "w", 2600, shot="in_the_brook")
    print("      in water:", s["water"], "state", s["st"])
    # swim north to the bank and climb out
    pl.rec_reset(); pl.down("w")
    out = None
    for i in range(28):
        pl.wait(250); q = pl.st()
        if q["gr"] and not q["water"]: out = q; break
    pl.release_all(); pl.wait(500)
    print("   swim out of the brook             ->", json.dumps(out) if out else "STILL IN THE WATER after 7 s: " + json.dumps(pl.st()))
    pl.shot("brook_climb_out")

    print("\n=== CHECKPOINT 2 (cp-brook) ===")
    pl.tp(0, 5.2, 13, N); pl.wait(300); pl.rec_reset()
    pl.walk("w", 1400); pl.wait(600)
    r = pl.rec(); s = pl.st()
    print("   walk onto cp-brook pad -> cp %s  events %s" % (s["cp"], [e["e"] for e in r["events"]]))
    pl.shot("cp_brook")

    print("\n=== BEAT 3 THE CLIMB + THE OLD OAK ===")
    leg("climb the slope to the fort gate", 0, 5.0, 8, N, "w", 4000, shot="climb_to_gate")
    # the oak at [14, ~, 32] — climbable?
    pl.tp(14.0, 2.6, 35.0, N); pl.wait(300); pl.rec_reset()
    pl.down("w"); pl.wait(1400)
    q1 = pl.st()
    pl.wait(1400); q2 = pl.st(); pl.release_all(); pl.wait(400)
    r = pl.rec()
    print("   press into the oak: y %.2f -> %.2f  state %s  events %s" %
          (q1["y"], q2["y"], q2["st"], [e["e"] for e in r["events"]][:6]))
    pl.shot("oak_climb")
    # jump at the trunk then hold w (the usual way to grab a pole)
    pl.tp(14.0, 2.6, 34.6, N); pl.wait(300); pl.rec_reset()
    pl.down("w"); pl.wait(500); pl.tap("Space", 120); pl.wait(2400); pl.release_all(); pl.wait(400)
    s = pl.st(); r = pl.rec()
    print("   jump into the oak:  y %.2f state %s events %s" % (s["y"], s["st"], [e["e"] for e in r["events"]][:8]))
    pl.shot("oak_jump_climb")

    print("\n=== BEAT 4 THE FORT ===")
    pl.tp(0, 9.6, -13, N); pl.wait(400); pl.shot("fort_gateway")
    leg("gateway -> courtyard", 0, 9.6, -13, N, "w", 2600, shot="fort_courtyard")
    s = pl.st()
    # the crate stack + sigil 3 at [-5.5, 13.50, -17.2]
    pl.tp(-5.5, 9.6, -13.5, N); pl.wait(300)
    leg("run at the crate stack", -5.5, 9.6, -13.5, N, "w", 2600, jumps=(700, 1350, 1980), shot="crate_stack")
    # the courtyard pedestal (sigils crest spawn point)
    pl.tp(0, 9.6, -20.0, N); pl.wait(300)
    leg("walk to the courtyard pedestal", 0, 9.6, -20.0, N, "w", 1800, shot="courtyard_pedestal")

    print("\n=== ROUTE B — THE WALL-KICK SHAFT (west tower, 3.30 m clear) ===")
    # inside the shaft, alternate kicks
    pl.tp(-9.2, 9.4, -32.8, N); pl.wait(500); pl.shot("shaft_bottom")
    print("   at the shaft floor:", json.dumps(pl.st()))
    pl.rec_reset()
    pl.down("w"); pl.wait(260); pl.tap("Space", 110); pl.wait(280)
    for i in range(6):
        pl.up("w"); pl.down("s"); pl.wait(120); pl.tap("Space", 110); pl.wait(260)
        pl.up("s"); pl.down("w"); pl.wait(120); pl.tap("Space", 110); pl.wait(260)
    pl.release_all(); pl.wait(900)
    s = pl.st(); r = pl.rec()
    print("   after 12 alternating kicks -> y %.2f state %s  events %s" %
          (s["y"], s["st"], [e["e"] for e in r["events"]][:14]))
    pl.shot("shaft_after_kicks")

    print("\n=== THE OPEN CREST — CREST ON THE RAMPARTS ===")
    # walk the rampart to the east tower and take the crest at 19.30
    pl.tp(10.0, 14.8, -26.0, N); pl.wait(400); pl.shot("rampart_walk")
    leg("rampart walk north to the tower", 10.0, 14.8, -26.0, N, "w", 2600, shot="rampart_to_tower")
    # stand under the crest and jump for it
    pl.tp(9.2, 18.6, -30.5, N); pl.wait(400)
    print("   under the crest:", json.dumps(pl.st()))
    pl.rec_reset(); pl.down("w"); pl.wait(500); pl.tap("Space", 120); pl.wait(1400); pl.release_all(); pl.wait(1500)
    s = pl.st(); r = pl.rec()
    print("   crest attempt -> crests %s  events %s  gs %s" % (s["crests"], [e["e"] for e in r["events"]][:8], s["gs"]))
    pl.shot("crest_attempt")
    pl.wait(3000); pl.shot("crest_celebration")
    print("   after celebration:", json.dumps(pl.st()))

    print("\nERRORS:", errs[:10])
    br.close()
