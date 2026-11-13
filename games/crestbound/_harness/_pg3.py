"""GNASHER FORT phase 3 — the moat: metal hat, the drowned crest, getting OUT."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_gnasher import enter, enter_direct, DIRECT, rec_on, rec, evsum
from _pgutil import walk, critters, jump, pound, look

def snap(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      v:[+P.vel.x.toFixed(2),+P.vel.y.toFixed(2),+P.vel.z.toFixed(2)],
      st:P.state, gr:!!P.grounded, w:!!P.inWater, sub:!!P.submerged,
      power:P.power, pt: G.power ? +G.power.t.toFixed(1) : null }; }""")

from _pgrun import run

def body(pl):
    rec_on(pl)

    # ---------- A. swim WITHOUT the hat: where do I float, can I get out?
    pl.say("== A. NO HAT: drop into the moat at (0,3,40) ==")
    pl.tp(0, 3.0, 40.0); pl.wait(2500)
    for i in range(5):
        pl.wait(600); pl.say("   ", json.dumps(snap(pl)))
    pl.shot("A_swim_nohat")
    pl.say("  -- hold SPACE (swim up) 3 s --")
    pl.down("SPACE"); pl.wait(3000); pl.up("SPACE"); pl.wait(400)
    pl.say("   after space:", json.dumps(snap(pl)))
    pl.say("  -- hold C (dive) 4 s --")
    pl.down("C"); pl.wait(4000); pl.up("C"); pl.wait(400)
    pl.say("   after dive:", json.dumps(snap(pl)))
    pl.shot("A_dive_nohat")
    pl.say("  -- swim SOUTH to the shore (0,49) and try to climb out --")
    r = walk(pl, 0, 50.0, tol=2.0, max_ms=30000, tag="swim south")
    pl.shot("A_shore_out")
    pl.say("   ", json.dumps(snap(pl)), json.dumps(evsum(rec(pl))))
    # try jumping out at the shore
    for i in range(4):
        pl.down("W"); pl.wait(400); pl.tap("SPACE", 200); pl.wait(900); pl.up("W"); pl.wait(300)
        pl.say("   jump-out try %d: %s" % (i, json.dumps(snap(pl))))
    pl.shot("A_jump_out")

    # ---------- B. WITH the hat
    pl.say("== B. WITH THE IRON HAT ==")
    pl.tp(0, 2.3, 53); pl.wait(1200)
    r = walk(pl, 4.6, 46.8, tol=1.2, max_ms=14000, tag="iron hat")
    pl.say("   ", json.dumps(snap(pl)))
    pl.say("  -- now walk north off the quay into the water --")
    r = walk(pl, 0, 43.0, tol=1.5, max_ms=10000, tag="into the moat")
    for i in range(8):
        pl.wait(700); pl.say("   ", json.dumps(snap(pl)))
    pl.shot("B_metal_in_water")
    pl.say("  -- with the hat on, walk to the DROWNED CREST (0,-1.40,39.5) --")
    r = walk(pl, 0, 39.5, tol=1.6, max_ms=16000, tag="drowned crest")
    pl.say("   ", json.dumps(snap(pl)), json.dumps(evsum(rec(pl))))
    pl.shot("B_drowned_crest_try")
    pl.say("  -- dive (hold C) toward it --")
    pl.down("C"); pl.wait(3000)
    for i in range(4):
        pl.wait(700); pl.say("   diving:", json.dumps(snap(pl)))
    pl.up("C"); pl.wait(600)
    pl.say("   ", json.dumps(evsum(rec(pl))))
    pl.shot("B_dive_for_crest")
    crest = pl.js("""() => { const C=CRESTBOUND.game.course.collectibles; if(!C) return null;
        return (C.crests||[]).map(c=>({id:c.def&&c.def.id, taken:!!c.taken, active:c.active===undefined?null:!!c.active,
          p:c.pos?[+c.pos.x.toFixed(2),+c.pos.y.toFixed(2),+c.pos.z.toFixed(2)]:null})); }""")
    pl.say("   crests:", json.dumps(crest))


run("p3", body)
