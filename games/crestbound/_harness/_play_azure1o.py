"""PLAYTEST — AZURE-1, segment O: the urn pound with hazards RUNNING (segment N
froze them, which could have been the reason nothing broke). Also one pound onto
a coin to prove the pound's shock is landing where I think it is.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_azlib import boot as azboot

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "azure-1.json")

with Play("azure1o") as P:
    azboot(P, "azure-1")
    rep = json.load(open(REPORT, encoding="utf-8"))

    P.say("hazards frozen?", P.js("() => !!CRESTBOUND.game.freezeHazards"))
    for label, xz in (("west urn", (-7.6, -15.4)), ("east urn", (7.6, -15.4)), ("north urn", (-9.0, -29.0))):
        P.tp(xz[0], 7.6, xz[1])
        P.wait(1500)
        s = P.state()
        P.say("  above %s: %s %s" % (label, s["pos"], s["pstate"]))
        for i in range(3):
            P.tap("SPACE", 130); P.wait(250); P.down("C"); P.wait(1500); P.up("C"); P.wait(800)
            st = P.js("() => CRESTBOUND.game.player.state")
            brk = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='breakable')
                .map(h=>({p:h.def.p, broken:!!h.broken}))""")
            P.say("   pound %d state=%s pos=%s -> %s" % (i, st, P.pos(), json.dumps(brk)))
        P.shot("01_%s" % label.replace(" ", "_"))

    brk = P.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='breakable')
        .map(h=>({p:h.def.p, broken:!!h.broken, keys:Object.keys(h).slice(0,18)}))""")
    P.say("FINAL breakables:", json.dumps(brk))
    P.dump("azure1o")
