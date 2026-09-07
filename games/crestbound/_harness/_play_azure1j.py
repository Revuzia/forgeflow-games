"""PLAYTEST — AZURE-1, segment J: enter the course THROUGH ITS KEEP GATE (P11),
and re-measure the lagoon current honestly (steady-state velocity, game time).
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

    with Play("azure1j") as P:
        azboot(P)          # stay in the Keep
        P.say("state after title:", json.dumps(P.state()))
        gates = P.gates()
        az = [g for g in gates if g.get("course") == "azure-1"]
        P.say("azure-1 gate:", json.dumps(az))
        P.shot("01_keep")
        if not az:
            D(what="There is no gate in the Keep for azure-1 at all",
              where="the Keep, game._gates",
              did="unlocked every gate with __dev.unlockAll() and listed game._gates",
              happened="no entry with course 'azure-1'; gates present: %s" % ([g.get("course") for g in gates],),
              should="TIDEWELL TEMPLE needs a painting/door in the Keep",
              png="_shots/play_azure1j/01_keep.png")
        else:
            g = az[0]
            gp = g["pos"]
            P.say("  walking to the azure-1 gate at", gp)
            # stand a few metres in front of it and walk in
            P.tp(gp[0], gp[1] - 1.6, gp[2] + 3.0)
            P.wait(1500)
            P.shot("02_gate_front")
            e = drive(P, gp[0], gp[2], 8, tag="03_gate", every=4)
            P.wait(2500)
            s = P.state()
            P.say("  after walking into the gate:", json.dumps(s))
            P.shot("04_gate_walkin")
            if s["cardOpen"] or s["gstate"] in ("card", "playing", "cinematic"):
                # accept the card
                P.tap("SPACE", 130)
                P.wait(1200)
                got = P.js("""() => { const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null);
                    const e=b.find(x=>/ENTER|DIVE|PLAY|GO/i.test(x.textContent||'')); if(e){ if(e.__activate) e.__activate(); else e.click(); return (e.textContent||'').trim(); } return null; }""")
                P.say("  course card button:", got)
                for _ in range(60):
                    P.wait(500)
                    st = P.state()
                    if st["course"] == "azure-1" and st["gstate"] == "playing":
                        break
                st = P.state()
                P.say("  landed in:", st["course"], st["gstate"], st["pos"])
                P.shot("05_in_course")
                if st["course"] == "azure-1":
                    W("The Keep's azure-1 gate opens on a walk-in, raises the course card and loads TIDEWELL TEMPLE at its spawn.")
                else:
                    D(what="The azure-1 course card comes up but choosing ENTER does not load TIDEWELL TEMPLE",
                      where="the Keep, the azure-1 gate at %s" % (gp,),
                      did="walked into the gate, took the card, pressed the enter button",
                      happened="still in %s (state %s) after 30 s" % (st["course"], st["gstate"]),
                      should="the card's ENTER should load azure-1",
                      png="_shots/play_azure1j/05_in_course.png")
            else:
                D(what="Walking into the Keep's azure-1 gate does nothing — no course card, no load",
                  where="the Keep, the azure-1 gate at %s (unlocked=%s sealed=%s)" % (gp, g.get("unlocked"), g.get("sealed")),
                  did="stood 3 m in front of it and held W into it for 8 s",
                  happened="ended at %s, game state '%s', no card" % (s["pos"], s["gstate"]),
                  should="an unlocked gate should raise the course card and load TIDEWELL TEMPLE",
                  png="_shots/play_azure1j/04_gate_walkin.png")

        # ------------------------------------------------ current, honestly
        P.say("\n=== THE LAGOON CURRENT, RE-MEASURED ON GAME TIME ===")
        if P.state()["course"] != "azure-1":
            P.js("() => CRESTBOUND.game.__dev.goto('azure-1')")
            for _ in range(60):
                P.wait(500)
                if P.state()["course"] == "azure-1" and P.state()["gstate"] == "playing":
                    break
            P.wait(1500)

        def run(x, y, z, yaw, key, secs, label):
            P.tp(x, y, z)
            P.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")
            P.js("(v) => { const G=CRESTBOUND.game; G.player.__test.setFacing(v); G.cam.yaw=v; G.cam._rcHoldT=0; }", yaw)
            P.wait(900)
            t0 = P.js("() => CRESTBOUND.engine.elapsed")
            a = P.pos()
            if key:
                P.down(key)
            vx = []
            for _ in range(int(secs * 4)):
                P.wait(250)
                if key:
                    P.js("(v) => { const G=CRESTBOUND.game; G.player.__test.setFacing(v); G.cam.yaw=v; G.cam._rcHoldT=0; }", yaw)
                vx.append(P.js("() => +CRESTBOUND.game.player.vel.x.toFixed(2)"))
            if key:
                P.up(key)
            t1 = P.js("() => CRESTBOUND.engine.elapsed")
            b = P.pos()
            dt = max(0.001, t1 - t0)
            P.say("  %-34s dx %+6.2f m in %5.2f s game = %+5.2f m/s ; vel.x tail %s" %
                  (label, b[0] - a[0], dt, (b[0] - a[0]) / dt, vx[-5:]))
            return (b[0] - a[0]) / dt

        drift = run(0, -0.6, 24, 0.0, None, 6, "float, no input, in the current")
        P.shot("06_current_float")
        into = run(0, -0.6, 24, math.pi / 2, "W", 8, "swim WEST into the current")
        P.shot("07_current_into")
        cross = run(0, -0.6, 26, 0.0, "W", 6, "swim NORTH across the current")
        P.shot("08_current_cross")
        still = run(20, -0.6, 6, math.pi / 2, "W", 5, "swim WEST in still water")
        P.shot("09_still_west")

        if into > 0.3:
            D(what="You cannot swim back west through the lagoon's reef current: it carries a swimming player east at %+.2f m/s even while he swims straight into it" % into,
              where="azure-1 lagoon, the 46 x 9 m 'current' volume centred at (0, -1.4, 24), dir +X, power 3.2; the band a player must cross between the wading shelf and the shoal",
              did="zeroed velocity at (0, -0.6, 24) and held W due west for 8 s, timing off engine.elapsed (game time, not wall clock). Control runs: floating with no input drifted %+.2f m/s, swimming north across it %+.2f m/s of sideways drift, and the same swim in still water at (20,-0.6,6) made %+.2f m/s" % (drift, cross, still),
              happened="net %+.2f m/s EASTWARD while actively swimming west" % into,
              should="the swim tops out at 3.6 m/s and the current is authored at 3.2, so a determined swimmer should crawl west; as built the reef bar west of x 0 is a one-way trip and a player who overshoots the shoal cannot swim back to it",
              png="_shots/play_azure1j/07_current_into.png")
        else:
            W("A swimmer can make headway west against the lagoon current (%+.2f m/s)." % into)

        flush(rep)
        P.dump("azure1j")


main()
