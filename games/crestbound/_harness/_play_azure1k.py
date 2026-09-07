"""PLAYTEST — AZURE-1, segment K: the Keep gate for TIDEWELL TEMPLE, checked
properly — sealed state, dev unlock, crest-count unlock, and a real walk-in.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_azlib import drive

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "azure-1.json")


def load():
    return json.load(open(REPORT, encoding="utf-8"))


def flush(rep):
    json.dump(rep, open(REPORT, "w", encoding="utf-8"), indent=1)


def gate(P):
    gs = P.gates()
    for g in gs:
        if g.get("course") == "azure-1":
            return g
    return None


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1k") as P:
        for i in range(80):
            if P.js("() => typeof globalThis.CRESTBOUND === 'object' && !!CRESTBOUND.game"):
                break
            P.wait(500)
        for i in range(80):
            if P.js("() => CRESTBOUND.game.state !== 'loading'"):
                break
            P.wait(500)
        P.click_title(); P.wait(1500)

        P.say("gate at a fresh save:", json.dumps(gate(P)))
        meta = P.js("() => { const m = CRESTBOUND.game._gates.map(g=>({c:g.course, req:g.requires, u:g.unlocked, s:g.sealed})); return m; }")
        P.say("all gates:", json.dumps(meta))

        P.say("\n-- dev unlockAll --")
        P.js("() => CRESTBOUND.game.__dev.unlockAll()")
        P.wait(800)
        g = gate(P)
        P.say("gate after unlockAll:", json.dumps(g))
        flags = P.js("() => { const f = CRESTBOUND.game.save.flags; return f.get('gateOpen:azure-1'); }")
        P.say("save flag gateOpen:azure-1 =", flags)

        if not g["unlocked"]:
            D(what="__dev.unlockAll() does not unlock the azure-1 gate: the save flag is set but the gate still reads unlocked=false, sealed=true",
              where="the Keep, the azure-1 'glass' gate at (26, 2.4, 30) (requires: %s)" % json.dumps(g.get("req")),
              did="clicked NEW GAME, called CRESTBOUND.game.__dev.unlockAll(), then read game._gates",
              happened="save.flags.get('gateOpen:azure-1') = %s but the gate object still says unlocked=%s sealed=%s" % (flags, g["unlocked"], g["sealed"]),
              should="unlockAll is the dev tool every playtest and harness uses to reach a late course; it must actually open the gate",
              png="")

        P.say("\n-- walk into the gate anyway --")
        gp = g["pos"]
        P.tp(gp[0] + 2.6, gp[1] - 1.6, gp[2])
        P.wait(1500)
        P.shot("01_at_gate")
        e = drive(P, gp[0], gp[2], 8, tag="02_walkin", every=4)
        P.wait(2000)
        s = P.state()
        P.say("after walk-in:", s["gstate"], s["course"], s["pos"], "card", s["cardOpen"])
        P.shot("03_after_walkin")

        if s["gstate"] == "keep" and not s["cardOpen"]:
            P.say("-- give crests until it opens --")
            for n in (5, 10, 20, 40, 60, 91):
                P.js("(k) => { const S=CRESTBOUND.game.save; for (let i=0;i<k;i++) S.collectCrest('verdant-1','x'+i); CRESTBOUND.game._refreshGateState && CRESTBOUND.game._refreshGateState(); }", n)
                P.wait(600)
                gg = gate(P)
                P.say("  crests=%s -> gate unlocked=%s sealed=%s" %
                      (P.js("() => CRESTBOUND.game.save.crestTotal()"), gg["unlocked"], gg["sealed"]))
                if gg["unlocked"]:
                    break
            gg = gate(P)
            if gg["unlocked"]:
                P.tp(gp[0] + 2.6, gp[1] - 1.6, gp[2])
                P.wait(1200)
                e = drive(P, gp[0], gp[2], 8, tag="04_walkin2", every=4)
                P.wait(2500)
                s = P.state()
                P.say("  after walking in with the gate open:", s["gstate"], s["course"], "card", s["cardOpen"])
                P.shot("05_open_walkin")
                if s["cardOpen"] or s["gstate"] in ("card", "cinematic", "playing"):
                    W("Once the azure-1 gate is unlocked (by crest total), walking into it raises the TIDEWELL TEMPLE course card.")
                else:
                    D(what="Even with the azure-1 gate showing unlocked, walking into it raises nothing",
                      where="the Keep, azure-1 'glass' gate at %s" % (gp,),
                      did="raised the crest total until the gate read unlocked, then held W into it for 8 s from 2.6 m away",
                      happened="game state stayed '%s', no course card, player at %s" % (s["gstate"], s["pos"]),
                      should="an unlocked gate should raise the course card",
                      png="_shots/play_azure1k/05_open_walkin.png")
            else:
                D(what="The azure-1 gate never unlocks — not by __dev.unlockAll(), and not at any crest total up to 91",
                  where="the Keep, the azure-1 'glass' gate at %s, requires %s" % (gp, json.dumps(gg.get("req"))),
                  did="called unlockAll, then granted crests in steps up to the game's full 91 and re-read the gate each time",
                  happened="unlocked stayed %s, sealed stayed %s" % (gg["unlocked"], gg["sealed"]),
                  should="TIDEWELL TEMPLE has to be enterable from the Keep — it is the whole realm's first course",
                  png="_shots/play_azure1k/03_after_walkin.png")

        flush(rep)
        P.dump("azure1k")


main()
