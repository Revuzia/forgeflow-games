"""PLAYTEST — AZURE-1, segment L: one careful walk into the TIDEWELL TEMPLE gate
from its own exit pad, with the gate unlocked. (Segment K's walk never reached
the gate — this one starts on the pad and walks 2 m.)
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

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

    with Play("azure1l") as P:
        for i in range(80):
            if P.js("() => typeof globalThis.CRESTBOUND === 'object' && !!CRESTBOUND.game"):
                break
            P.wait(500)
        for i in range(80):
            if P.js("() => CRESTBOUND.game.state !== 'loading'"):
                break
            P.wait(500)
        P.click_title(); P.wait(1500)
        P.js("() => { const S=CRESTBOUND.game.save; for (let i=0;i<40;i++) S.collectCrest('verdant-1','x'+i); CRESTBOUND.game._refreshGateState && CRESTBOUND.game._refreshGateState(); }")
        P.wait(800)
        g = [x for x in P.gates() if x["course"] == "azure-1"][0]
        P.say("gate:", json.dumps(g), "crests", P.js("() => CRESTBOUND.game.save.crestTotal()"))

        ex = g["exit"]
        P.tp(ex[0], ex[1] + 0.3, ex[2])
        P.wait(1600)
        s = P.state()
        P.say("standing on the gate's exit pad:", s["pos"], s["pstate"], "grounded", s["grounded"])
        P.shot("01_on_pad")

        # walk straight at the gate: from the exit pad toward the gate's x
        gp = g["pos"]
        P.face(gp[0], gp[2])
        P.down("W")
        trail = []
        for i in range(40):
            P.wait(250)
            P.face(gp[0], gp[2])
            st = P.state()
            trail.append((round(st["pos"][0], 2), round(st["pos"][1], 2), round(st["pos"][2], 2), st["gstate"], st["cardOpen"]))
            if i % 6 == 0:
                P.shot("02_in_%02d" % i)
            if st["cardOpen"] or st["gstate"] not in ("keep",):
                break
        P.up("W")
        P.wait(1500)
        s = P.state()
        P.say("trail:", trail[::3])
        P.say("after the walk-in:", s["gstate"], s["course"], s["pos"], "card", s["cardOpen"])
        P.shot("03_result")

        if s["cardOpen"] or s["gstate"] in ("card", "cinematic", "playing"):
            got = P.js("""() => { const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null);
                const e=b.find(x=>/ENTER|DIVE|PLAY|GO/i.test(x.textContent||'')); if(e){ if(e.__activate) e.__activate(); else e.click(); return (e.textContent||'').trim(); } return null; }""")
            P.say("card button:", got)
            for _ in range(60):
                P.wait(500)
                st = P.state()
                if st["course"] == "azure-1" and st["gstate"] == "playing":
                    break
            st = P.state()
            P.say("landed:", st["course"], st["gstate"], st["pos"])
            P.shot("04_landed")
            if st["course"] == "azure-1":
                W("With 40 crests the Keep's azure-1 glass gate is unlocked, walking into it raises the TIDEWELL TEMPLE card, and ENTER loads the course at its shore spawn.")
            else:
                D(what="The TIDEWELL TEMPLE card comes up at the Keep gate but ENTER does not load the course",
                  where="the Keep, azure-1 glass gate at %s, walked in from its exit pad %s with 40 crests" % (gp, ex),
                  did="walked into the gate, then clicked the card's enter button ('%s')" % got,
                  happened="still in %s / %s after 30 s" % (st["course"], st["gstate"]),
                  should="ENTER should load azure-1",
                  png="_shots/play_azure1l/04_landed.png")
        else:
            D(what="Walking into the unlocked TIDEWELL TEMPLE gate in the Keep raises nothing — no card, no load",
              where="the Keep, the azure-1 'glass' gate at %s (unlocked, requires 30 crests). Started on the gate's own exit pad at %s with 40 crests" % (gp, ex),
              did="stood on the exit pad and held W straight at the gate for up to 10 s, re-aiming the camera at it every 250 ms",
              happened="game state stayed 'keep' the whole time; the hero ended at %s and no course card appeared. Trail: %s" % (s["pos"], trail[:6]),
              should="an unlocked painting/door gate should raise the course card on a walk-in; the gate sits at y 2.4 while the hero stands at y 0, which may put its trigger above him",
              png="_shots/play_azure1l/03_result.png")

        flush(rep)
        P.dump("azure1l")


main()
