"""PLAYTEST — AZURE-1, segment N: does a GROUND POUND fire at all from the keys
a player has? Three input spellings, sampled at 100 ms, on flat terrace ground
and then on the urn. This decides whether 'breakables do not break' is a
breakable bug or a pound-input bug.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_azlib import boot as azboot

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "azure-1.json")


def load():
    return json.load(open(REPORT, encoding="utf-8"))


def flush(rep):
    json.dump(rep, open(REPORT, "w", encoding="utf-8"), indent=1)


def watch(P, ms=2600, step=100):
    out = []
    for _ in range(ms // step):
        P.wait(step)
        out.append(P.js("() => { const p=CRESTBOUND.game.player; return p.state + '@' + p.pos.y.toFixed(2); }"))
    # compress runs
    comp = []
    for v in out:
        if not comp or comp[-1][0] != v.split("@")[0]:
            comp.append([v.split("@")[0], v.split("@")[1], v.split("@")[1]])
        else:
            comp[-1][2] = v.split("@")[1]
    return comp


def main():
    rep = load()

    def D(**kw):
        rep["defects"].append(kw); flush(rep); print("  ** DEFECT: " + kw["what"], flush=True)

    def W(s):
        rep["worked"].append(s); flush(rep)

    with Play("azure1n") as P:
        azboot(P, "azure-1")
        P.js("() => CRESTBOUND.game.__dev.freezeHazards(true)")

        results = {}
        for name, keys in (("jump then TAP C", "tap"), ("jump then HOLD C", "hold"),
                           ("jump then HOLD Ctrl", "ctrl")):
            P.tp(0, 5.6, -18)
            P.wait(1400)
            P.tap("SPACE", 130)
            P.wait(240)
            if keys == "tap":
                P.tap("C", 110)
            elif keys == "hold":
                P.down("C")
            else:
                P.down("CTRL")
            seq = watch(P, 2600)
            P.up("C"); P.up("CTRL")
            P.wait(600)
            results[name] = seq
            P.say("  %-20s -> %s" % (name, seq))
            P.shot("01_%s" % keys)

        pounded = any(any(s[0].startswith("pound") for s in seq) for seq in results.values())
        P.say("  a pound state was observed:", pounded)

        if not pounded:
            D(what="A GROUND POUND never fires from the keyboard: jumping then tapping C, holding C or holding Ctrl all give a plain fall and land, no poundHang / poundFall / poundLand",
              where="azure-1 temple terrace, flat ground at (0, 5.00, -18), hazards frozen",
              did="jumped with Space, waited 240 ms, then (a) tapped C, (b) held C, (c) held Ctrl — sampling player.state every 100 ms for 2.6 s each time",
              happened="state sequences were %s" % json.dumps(results),
              should="CONTRACT 11: 'crouch/pound in air -> 0.2 s hang, then vy -40; on land: shock burst, breaks breakable colliders'. Without it the tide switch, the terrace urns, the tidewell coral wall and the secret crest are all dead content on this course",
              png="_shots/play_azure1n/01_hold.png")
        else:
            W("A ground pound fires from the air with C: %s" % json.dumps(results))

            # if the pound fires, re-test the urn honestly
            P.say("\n  pound fires — retesting the urn with the working spelling")
            c0 = P.js("() => { const c=CRESTBOUND.game._collectibles; return c? c.counts.coins : -1; }")
            P.tp(-7.6, 7.6, -15.4)
            P.wait(1400)
            P.tap("SPACE", 130); P.wait(240); P.down("C"); P.wait(1800); P.up("C"); P.wait(900)
            brk = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='breakable')
                .map(h=>({p:h.def.p, broken:!!h.broken}))""")
            c1 = P.js("() => { const c=CRESTBOUND.game._collectibles; return c? c.counts.coins : -1; }")
            P.say("  urns after a real pound:", json.dumps(brk), "coins", c0, "->", c1)
            P.shot("02_urn_realpound")

        flush(rep)
        P.dump("azure1n")


main()
