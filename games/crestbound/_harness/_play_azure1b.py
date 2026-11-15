"""PLAYTEST — AZURE-1, segment B: swim mechanics measured carefully, the two
lagoon currents (are they a trap?), the sinking coral pads, the shoal + geyser
jumppad, the metal hat on the reef pad.
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "azure-1.json")


def load():
    if os.path.exists(REPORT):
        try:
            return json.load(open(REPORT, encoding="utf-8"))
        except Exception:
            pass
    return {"area": "azure-1", "played": "", "defects": [], "worked": [], "blocked": []}


def flush(rep):
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    json.dump(rep, open(REPORT, "w", encoding="utf-8"), indent=1)


def boot(P):
    for i in range(120):
        if P.js("() => typeof globalThis.CRESTBOUND === 'object' && !!CRESTBOUND.game"):
            break
        P.wait(500)
    for i in range(120):
        if P.js("() => CRESTBOUND.game.state !== 'loading'"):
            break
        P.wait(500)
    P.click_title()
    P.wait(1200)
    P.unlock_all()
    P.js("() => CRESTBOUND.game.__dev.goto('azure-1')")
    for _ in range(80):
        P.wait(500)
        s = P.state()
        if s["course"] == "azure-1" and s["gstate"] == "playing":
            break
    P.wait(2000)


def setyaw(P, yaw):
    """Point hero + camera at an absolute yaw (0 = -Z north)."""
    P.js("(y) => { const G=CRESTBOUND.game; G.player.__test.setFacing(y); G.cam.yaw=y; G.cam._rcHoldT=0; }", yaw)


def swim_run(P, x, y, z, yaw, key, secs, tag):
    P.tp(x, y, z)
    P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
    setyaw(P, yaw)
    P.wait(700)
    a = P.state()
    P.down(key)
    n = int(secs * 4)
    for _ in range(n):
        P.wait(250)
        setyaw(P, yaw)
    P.up(key)
    b = P.state()
    d = math.dist((a["pos"][0], a["pos"][2]), (b["pos"][0], b["pos"][2]))
    P.say("  %-28s %s -> %s   horiz %.2f m in %.1f s = %.2f m/s  (%s)" %
          (tag, a["pos"], b["pos"], d, secs, d / secs, b["pstate"]))
    return {"a": a, "b": b, "speed": d / secs}


def main():
    rep = load()
    D = lambda **kw: (rep["defects"].append(kw), flush(rep), print("  ** DEFECT: " + kw["what"], flush=True))
    W = lambda s: (rep["worked"].append(s), flush(rep))

    with Play("azure1b") as P:
        boot(P)
        tune = P.js("""() => { const T = CRESTBOUND.game.player.__test; return null; }""")
        sw = P.js("() => { const m = CRESTBOUND; return m.game.player ? JSON.parse(JSON.stringify((m.TUNE||{}).swim||{})) : null; }")
        P.say("CRESTBOUND.TUNE.swim:", sw)
        sw2 = P.pg.evaluate("""async () => { const m = await import('/games/crestbound/runtime/core/tuning.js');
            return JSON.parse(JSON.stringify(m.TUNE.swim)); }""")
        P.say("tuning.js TUNE.swim (live module):", sw2)

        # ============================================================ SWIM
        P.say("\n=== SWIM SPEED, open water, no current (x 20, z 10) ===")
        r_n = swim_run(P, 20, -0.6, 10, 0.0, "W", 4, "W (north)")
        P.shot("01_swim_W")
        r_s = swim_run(P, 20, -0.6, 10, math.pi, "W", 4, "W facing south")
        r_e = swim_run(P, 20, -0.6, 10, -math.pi / 2, "W", 4, "W facing east")
        P.shot("02_swim_E")

        best = max(r_n["speed"], r_s["speed"], r_e["speed"])
        P.say("best measured surface swim speed: %.2f m/s (contract TUNE.swim.speed 4.5)" % best)
        if best < 2.5:
            D(what="Surface swimming is ~%.2f m/s, roughly a third of the 4.5 m/s the tuning asks for — crossing the lagoon takes forever" % best,
              where="azure-1 open lagoon, teleported to (20, -0.6, 10), no current volume, zero velocity, camera pointed at the swim direction",
              did="held W for 4 s, three times, facing north / south / east, re-aiming the camera every 250 ms",
              happened="the swimmer travelled %.2f m in 4 s (%.2f m/s). North %.2f, south %.2f, east %.2f m/s" % (best*4, best, r_n["speed"], r_s["speed"], r_e["speed"]),
              should="TUNE.swim.speed is 4.5 m/s; the 30 m swim from the wading shelf to the shoal should take ~7 s, not ~90 s",
              png=P.shot("03_swim_speed"))
        else:
            W("Surface swimming moves at %.2f m/s, near the 4.5 m/s target." % best)

        # submerged speed
        P.say("\n=== SUBMERGED SWIM SPEED ===")
        P.tp(20, -3.0, 10)
        P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
        setyaw(P, 0.0)
        P.down("C"); P.wait(1500); P.up("C")
        s0 = P.state()
        P.say("  submerged?", s0["submerged"], s0["pos"])
        a = P.state()
        P.down("W")
        for _ in range(16):
            P.wait(250); setyaw(P, 0.0)
        P.up("W")
        b = P.state()
        d = math.dist((a["pos"][0], a["pos"][2]), (b["pos"][0], b["pos"][2]))
        P.say("  submerged W 4 s: %s -> %s  %.2f m = %.2f m/s" % (a["pos"], b["pos"], d, d / 4))
        P.shot("04_submerged_swim")

        # swimDive dash (F)
        P.say("\n=== SWIM DASH (F / dive button under water) ===")
        a = P.state()
        P.tap("F", 110); P.wait(1200)
        b = P.state()
        P.say("  dash: %s -> %s  (%.2f m)" % (a["pos"], b["pos"],
              math.dist((a["pos"][0], a["pos"][2]), (b["pos"][0], b["pos"][2]))))
        P.shot("05_dash")

        # ============================================================ CURRENT 1
        P.say("\n=== CURRENT 1 — the east reef current at z 24, dir +X, power 3.2 ===")
        P.tp(0, -0.6, 24)
        P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
        setyaw(P, 0.0)
        P.wait(600)
        a = P.state()
        P.say("  drop in and do nothing for 6 s")
        drift = []
        for _ in range(12):
            P.wait(500)
            drift.append(P.state()["pos"])
        b = P.state()
        P.say("  drifted %s -> %s" % (a["pos"], b["pos"]))
        P.shot("06_current_drift")
        for d0 in drift[::3]:
            P.say("    ", d0)

        P.say("  now try to swim WEST (against the current) for 8 s")
        P.tp(0, -0.6, 24)
        P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
        setyaw(P, math.pi / 2)          # face +X? yaw pi/2 -> heading (-sin, 0, -cos) = (-1, 0, 0) = -X (west)
        P.wait(500)
        a = P.state()
        P.down("W")
        for _ in range(32):
            P.wait(250); setyaw(P, math.pi / 2)
        P.up("W")
        b = P.state()
        P.say("  against current: %s -> %s   dx %.2f" % (a["pos"], b["pos"], b["pos"][0] - a["pos"][0]))
        P.shot("07_against_current")
        if b["pos"][0] - a["pos"][0] > 4.0:
            D(what="The lagoon current at z=24 carries the swimmer east faster than he can swim back — it is a one-way trap, not a ride",
              where="azure-1 lagoon, dropped in at (0, -0.6, 24) inside the 46 x 9 m 'current' volume (dir +X, power 3.2)",
              did="zeroed velocity, faced due west (into the current) and held W for 8 s",
              happened="net movement was +%.2f m EAST — the swimmer went backwards the whole time" % (b["pos"][0] - a["pos"][0]),
              should="swim speed 4.5 > current 3.2, so a player who swims against it should make (slow) headway west",
              png=P.shot("07b_current_trap"))
        else:
            W("A swimmer can make headway against the z=24 lagoon current (net %.2f m over 8 s)." % (b["pos"][0] - a["pos"][0]))

        # where does the current dump you?
        P.say("  ride the current to its end (20 s, no input)")
        P.tp(0, -0.6, 24)
        for _ in range(20):
            P.wait(1000)
        e = P.state()
        P.say("  ended at", e["pos"], e["pstate"], "inWater", e["inWater"])
        P.shot("08_current_end")

        rep["played"] = rep.get("played", "")
        flush(rep)
        P.dump("azure1b")


main()
