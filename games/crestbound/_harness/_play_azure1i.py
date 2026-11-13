"""PLAYTEST — AZURE-1, segment I: the coral wall with a hat picked up by WALKING
onto it, plus a deliberate look at the things the owner named — the water rim
(P8), floating props (P6) and the temple's facade.
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_azlib import boot as azboot, drive

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "azure-1.json")


def load():
    return json.load(open(REPORT, encoding="utf-8"))


def flush(rep):
    json.dump(rep, open(REPORT, "w", encoding="utf-8"), indent=1)


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1i") as P:
        azboot(P, "azure-1")

        # ---------------------------------------- 1. hat -> coral, for real
        P.say("=== THE METAL HAT, WALKED ONTO, THEN STRAIGHT TO THE CORAL WALL ===")
        P.tp(26, 3.0, 24)
        P.wait(1000)
        drive(P, 26, 22, 4, tag="01_hat")
        pw = P.js("() => { const s=CRESTBOUND.game.__dev.state(); return s.power||null; }")
        P.say("  power after walking onto the hat:", json.dumps(pw))
        P.shot("02_hat_on")
        if pw:
            P.tp(-32, -5.9, -9.6)     # right at the coral doorway, inside the chamber mouth
            P.wait(500)
            st = P.state()
            P.say("  at the wall:", st["pos"], st["pstate"], "g", st["grounded"], "water", st["inWater"],
                  "power", json.dumps(P.js("() => { const s=CRESTBOUND.game.__dev.state(); return s.power||null; }")))
            P.shot("03_coral_with_hat")
            for i in range(4):
                P.tap("SPACE", 130); P.wait(240)
                P.down("C"); P.wait(1100); P.up("C")
                P.wait(500)
                b = P.js("""() => { for (const h of (CRESTBOUND.game.course.hazards||[]))
                    if (h.def && h.def.kind==='breakable' && h.def.trigger==='coral-broken') return !!h.broken;
                    return null; }""")
                pw2 = P.js("() => { const s=CRESTBOUND.game.__dev.state(); return s.power||null; }")
                P.say("   pound %d broken=%s pos %s power %s" % (i, b, P.pos(), json.dumps(pw2)))
                if b:
                    break
            P.shot("04_coral_result")
            broke = P.js("""() => { for (const h of (CRESTBOUND.game.course.hazards||[]))
                if (h.def && h.def.kind==='breakable' && h.def.trigger==='coral-broken') return !!h.broken;
                return null; }""")
            P.say("  FINAL broken =", broke)
            if broke:
                W("With the metal hat picked up by walking onto it, a pound at the tidewell coral wall breaks it open.")
        else:
            P.say("  (no power — cannot test the hat path)")

        # ---------------------------------------- 2. the water, looked at
        P.say("\n=== P8: LOOK AT THE WATER — the rim, the shore and the surface ===")
        stations = [
            (0, 1.1, 33.5, 0.0, "the wading shelf, standing at the waterline"),
            (0, 0.9, 12.5, 0.0, "the shoal edge, water on three sides"),
            (-26, 1.2, 24, -1.2, "the west reef pad, water below the rim"),
            (0, 5.4, -12.5, 0.0, "the terrace looking down the great stair into the sea"),
            (-32, -0.4, -6.0, 0.0, "floating over the tidewell mouth"),
            (12, 10.0, -25.0, 2.6, "the pier landing looking back over the lagoon"),
        ]
        for i, (x, y, z, yaw, label) in enumerate(stations):
            P.tp(x, y, z)
            P.js("(v) => { const G=CRESTBOUND.game; G.player.__test.setFacing(v); G.cam.yaw=v; G.cam._rcHoldT=0; }", yaw)
            P.wait(1600)
            s = P.state()
            p = P.shot("05_water_%02d" % i)
            P.say("  %-52s -> %s %s water=%s camdist=%s  %s" %
                  (label, s["pos"], s["pstate"], s["inWater"], s["camDist"], os.path.basename(p)))

        # ---------------------------------------- 3. the temple facade + props
        P.say("\n=== P6/P9: THE TEMPLE FACADE, FLOATING PROPS, SIGNS ===")
        looks = [
            (0, 3.2, 40, 0.0, "spawn, looking straight at the temple"),
            (-14, 5.4, -22, -1.6, "the terrace west flank (ROUTE B drums)"),
            (0, 2.0, -43, 0.0, "the inner court, looking at the Warden"),
            (-9, 2.2, -44, -1.57, "under the west water wheel"),
            (0, 5.4, -33, 0.0, "the tide switch, facing the pedestal"),
            (0, 15.0, -18, 0.0, "the sanctum roof, facing the shrine"),
        ]
        for i, (x, y, z, yaw, label) in enumerate(looks):
            P.tp(x, y, z)
            P.js("(v) => { const G=CRESTBOUND.game; G.player.__test.setFacing(v); G.cam.yaw=v; G.cam._rcHoldT=0; }", yaw)
            P.wait(1600)
            s = P.state()
            p = P.shot("06_look_%02d" % i)
            P.say("  %-46s -> %s camdist=%s  %s" % (label, s["pos"], s["camDist"], os.path.basename(p)))

        flush(rep)
        P.dump("azure1i")


main()
