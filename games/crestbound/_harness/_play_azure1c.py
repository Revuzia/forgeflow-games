"""PLAYTEST — AZURE-1, segment C. Frame-rate-independent swim measurements
(steady-state player.vel, and durations taken off engine.elapsed, per
HARNESS_NOTES) plus THE REQUIRED CROSSING: wading shelf -> shoal, on foot and
by hand, the way a player does it.
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
    P.click_title(); P.wait(1200); P.unlock_all()
    P.js("() => CRESTBOUND.game.__dev.goto('azure-1')")
    for _ in range(80):
        P.wait(500)
        s = P.state()
        if s["course"] == "azure-1" and s["gstate"] == "playing":
            break
    P.wait(2000)


def setyaw(P, yaw):
    P.js("(y) => { const G=CRESTBOUND.game; G.player.__test.setFacing(y); G.cam.yaw=y; G.cam._rcHoldT=0; }", yaw)


def hspeed(P):
    return P.js("() => { const v = CRESTBOUND.game.player.vel; return +Math.hypot(v.x, v.z).toFixed(3); }")


def steady(P, key, yaw, hold_ms=5000, tag=""):
    """Hold a key, sample horizontal speed; return the max and the last-second mean."""
    setyaw(P, yaw)
    P.down(key)
    samples = []
    n = hold_ms // 200
    for _ in range(n):
        P.wait(200)
        setyaw(P, yaw)
        samples.append(hspeed(P))
    P.up(key)
    tail = samples[-6:] if len(samples) >= 6 else samples
    mx = max(samples) if samples else 0
    mean = sum(tail) / max(1, len(tail))
    P.say("  %-30s max %.2f m/s  steady %.2f m/s   samples %s" % (tag, mx, mean,
          [round(s, 2) for s in samples[::3]]))
    return {"max": mx, "steady": mean, "samples": samples}


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1c") as P:
        boot(P)

        # ---------------------------------------------------- swim, honestly
        P.say("=== SWIM SPEED (steady-state player.vel, frame-rate independent) ===")
        P.tp(20, -0.6, 10)
        P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
        P.wait(800)
        surf = steady(P, "W", math.pi, 5000, "surface swim (W south)")
        P.shot("01_surface_speed")

        P.tp(20, -3.0, 10)
        P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
        P.down("C"); P.wait(1600); P.up("C"); P.wait(300)
        sub0 = P.state()
        P.say("  submerged =", sub0["submerged"], "y", sub0["pos"][1])
        subm = steady(P, "W", math.pi, 5000, "submerged swim (W south)")
        P.shot("02_submerged_speed")

        if surf["steady"] < 3.0:
            D(what="Surface swimming tops out at %.2f m/s — the analog swim never reaches the 3.64 m/s the controller's own comment says a held stick should pin" % surf["steady"],
              where="azure-1 open lagoon at (20, -0.6, 10), outside both current volumes, velocity zeroed first",
              did="held W for 5 s facing due south, re-aiming the camera every 200 ms, sampling player.vel horizontally",
              happened="steady horizontal speed %.2f m/s (peak %.2f)" % (surf["steady"], surf["max"]),
              should="controller.js _swimMove documents accel/drag = 3.64 m/s for a held stick; TUNE.swim.speed is 4.5",
              png="_shots/play_azure1c/01_surface_speed.png")
        else:
            W("Surface swimming holds %.2f m/s with a held stick — close to the documented 3.64 m/s." % surf["steady"])

        if subm["steady"] < surf["steady"] * 0.7:
            D(what="Swimming UNDER water is far slower than swimming on the surface (%.2f vs %.2f m/s) on the one course whose whole premise is going under" % (subm["steady"], surf["steady"]),
              where="azure-1 lagoon at (20, -3.0, 10), submerged by holding C first",
              did="held W for 5 s submerged, same aim discipline, sampling player.vel",
              happened="steady %.2f m/s submerged against %.2f m/s at the surface" % (subm["steady"], surf["steady"]),
              should="submerged travel should not be materially slower than surface travel — the course's sigils, coins and the tidewell are all down there",
              png="_shots/play_azure1c/02_submerged_speed.png")
        else:
            W("Submerged swimming holds %.2f m/s, comparable to the surface." % subm["steady"])

        # ---------------------------------------------------- the crossing
        P.say("\n=== THE REQUIRED CROSSING: wading shelf (0, 0.55, 33) -> shoal (0, 0.60, 12) ===")
        P.tp(0, 1.2, 34)
        P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
        P.wait(900)
        P.shot("03_crossing_start")
        setyaw(P, 0.0)
        P.down("W")
        track = []
        t0 = P.js("() => CRESTBOUND.engine.elapsed")
        for i in range(120):                      # up to 30 s of holding W due north
            P.wait(250)
            setyaw(P, 0.0)                        # a player holds the camera on the temple
            s = P.state()
            track.append((round(s["pos"][0], 1), round(s["pos"][1], 2), round(s["pos"][2], 1),
                          s["pstate"], s["inWater"]))
            if s["pos"][2] <= 12.5 and not s["inWater"]:
                break
            if i % 12 == 0:
                P.shot("04_cross_%02d" % i)
        P.up("W")
        t1 = P.js("() => CRESTBOUND.engine.elapsed")
        end = P.state()
        P.say("  crossing took %.1f s of GAME time; ended at %s (%s, inWater %s)" %
              (t1 - t0, end["pos"], end["pstate"], end["inWater"]))
        for t in track[::6]:
            P.say("    ", t)
        P.shot("05_crossing_end")

        offx = abs(end["pos"][0])
        if offx > 6.0:
            D(what="Holding W due north from the wading shelf never reaches the shoal — the reef current sweeps the player %.1f m off the line" % offx,
              where="azure-1, entered the lagoon at the wading shelf (0, ~1.2, 34) and swam for the shoal at (0, 0.60, 12), the REQUIRED spine of the course",
              did="zeroed velocity, aimed hero and camera due north at the temple, held W for %.0f s of game time without touching anything else" % (t1 - t0),
              happened="finished at %s — %.1f m east of the line, %s" % (end["pos"], offx, "still swimming" if end["inWater"] else "out of the water"),
              should="the required route is 'swim the lagoon to the shoal'; a player holding forward at the temple should arrive at the shoal, not be flushed onto the east reef",
              png="_shots/play_azure1c/05_crossing_end.png")
        elif end["pos"][2] > 14:
            D(what="Swimming north from the wading shelf stalls before the shoal (ended at z %.1f after %.0f s)" % (end["pos"][2], t1 - t0),
              where="azure-1 lagoon, wading shelf to shoal, the required spine",
              did="held W due north for %.0f s of game time" % (t1 - t0),
              happened="ended at %s" % (end["pos"],),
              should="21 m of open water should be swimmable in well under 30 s",
              png="_shots/play_azure1c/05_crossing_end.png")
        else:
            W("Holding W north from the wading shelf crosses the lagoon and lands the player on the shoal in %.0f s." % (t1 - t0))

        flush(rep)
        P.dump("azure1c")


main()
