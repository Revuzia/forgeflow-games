"""PLAYTEST — THE KEEP, run 7: OLD FEN (does the interact prompt appear? does E
say anything?), and what a SEALED gate tells the player when he walks into it."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

VIS = """() => [...document.querySelectorAll('body *')]
    .filter(e => e.offsetParent !== null && e.children.length === 0 &&
                 (e.innerText||'').trim() && e.getBoundingClientRect().width > 0)
    .map(e => (e.className||'') + ' :: ' + (e.innerText||'').trim().slice(0,90))
    .slice(0, 30)"""

with Play("keep") as P:
    P.n = 130
    P.click_title(); P.wait(2500)

    P.say("=== A. WHAT THE HUD SHOWS AT THE SPAWN (baseline) ===")
    for l in P.js(VIS):
        P.say("   ", l)

    P.say("=== B. OLD FEN — npc record and the walk up to him ===")
    P.say("   npcs in the def:", P.js("() => (CRESTBOUND.game.course.def.npcs||[]).map(n=>({kind:n.kind,p:n.p,yaw:n.yaw,lines:(n.lines||[]).length}))"))
    P.say("   live critters:", P.js("""() => (CRESTBOUND.game.course.critters||[]).map(c=>({kind:c.kind||(c.def&&c.def.kind),
        p: c.mesh ? [+c.mesh.position.x.toFixed(1),+c.mesh.position.y.toFixed(1),+c.mesh.position.z.toFixed(1)] : null}))"""))
    P.tp(14.0, 6.40, -21.0); P.wait(600)
    for d in [3.0, 2.0, 1.4, 1.0]:
        P.walk_to(17.0 - d, -21.0, tol=0.45, max_ms=6000, tag="stand %.1f m from Fen" % d)
        P.face(17.0, -21.0); P.wait(500)
        vis = P.js(VIS)
        prompt = [v for v in vis if "FEN" in v.upper() or "TALK" in v.upper() or "  E " in v]
        P.say("   at %.1f m: prompt-ish -> %s" % (d, prompt or "NOTHING"))
        P.shot("fen_at_%.1fm" % d)
        P.tap("E", 150); P.wait(1600)
        after = P.js(VIS)
        new = [x for x in after if x not in vis]
        P.say("     after E:", new or "NO CHANGE ON SCREEN")
        P.shot("fen_after_E_%.1fm" % d)

    P.say("   walking right into him (does he block? is he solid?):")
    P.face(17.0, -21.0)
    s = P.hold(["W"], 2500, tag="push into Fen")
    P.say("     ended", P.pos(), "state", P.state()["pstate"])
    P.shot("fen_pushed_into")
    P.say("   flags.fenLine now:", P.js("() => CRESTBOUND.game.save.flags.get('fenLine')"))

    P.say("=== C. A SEALED GATE — what does the player learn? ===")
    P.tp(-6.0, 6.40, -20.0); P.wait(600)
    g = [x for x in P.gates() if x["course"] == "rime-1"][0]
    P.say("   rime-1 needs", P.js("() => CRESTBOUND.game.course.def.gates.find(g=>g.course==='rime-1').requires"))
    before = P.js(VIS)
    P.walk_to(g["exit"][0], g["exit"][2], tol=0.9, max_ms=8000, tag="up to the sealed rime-1")
    P.face(g["pos"][0], g["pos"][2]); P.wait(500)
    P.shot("sealed_standing_at_rime1")
    P.down("W"); P.wait(2600); P.up("W"); P.wait(1200)
    after = P.js(VIS)
    P.say("   ON SCREEN AFTER PUSHING INTO THE SEALED PAINTING:")
    for l in after:
        P.say("     ", l)
    P.say("   NEW vs baseline:", [x for x in after if x not in before])
    P.shot("sealed_after_push")
    P.say("   pos", P.pos(), "state", P.state()["gstate"])

    P.say("   -- now walk AWAY 12 m and see whether the readout clears --")
    P.walk_to(-4.0, -12.0, tol=1.5, max_ms=9000, tag="away from the gate")
    P.wait(1200)
    still = P.js(VIS)
    P.say("   12 m away, still on screen:", [x for x in still if x not in before])
    P.shot("sealed_after_walking_away")

    P.dump("keep7")
