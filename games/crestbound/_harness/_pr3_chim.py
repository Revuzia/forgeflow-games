"""BLIZZARD PEAK: the crevasse chimney wall-kick ladder, the frozen-fall pound,
and a census of the critters that can reach a standing player."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

CRIT = r"""() => { const c = CRESTBOUND.game.course; const L = (c && c.critters) || [];
  return L.map(x => ({ k: x.kind || x.type, alive: x.alive === undefined ? null : x.alive,
    st: x.state || null,
    p: x.pos ? [+x.pos.x.toFixed(1), +x.pos.y.toFixed(1), +x.pos.z.toFixed(1)] : null })); }"""


def kick_ladder(g, floor, wallA, wallB, label, presses=8):
    """One jump, then alternate: press INTO a wall, tap jump on contact."""
    g.tp(floor[0], floor[1], floor[2]); g.wait(900)
    st = g.show(label + " floor")
    y0 = (st.get("p") or [0, 0, 0])[1]
    best = y0
    g.face(*wallA)
    g.down("W")
    g.tap("SPACE", 110)
    g.wait(380)
    rows = []
    for k in range(presses):
        w = wallA if k % 2 == 0 else wallB
        g.face(*w)
        g.wait(170)
        a = g.snap()
        g.tap("SPACE", 100)
        g.wait(230)
        b = g.snap()
        y = (b.get("p") or [0, 0, 0])[1]
        best = max(best, y)
        rows.append((k, a.get("ps"), round((a.get("p") or [0, 0, 0])[1], 2), b.get("ps"), round(y, 2)))
        g.say("   %s kick %d: %s y=%.2f -> %s y=%.2f" % (label, k, a.get("ps"), (a.get("p") or [0, 0, 0])[1], b.get("ps"), y))
    g.up("W"); g.wait(1400)
    g.say("   %s: wallKicks=%s  best y=%.2f (floor %.2f, gain %.2f)"
          % (label, g.js("() => CRESTBOUND.game.player.stats.wallKicks"), best, y0, best - y0))
    return best


def body(g):
    g.start("rime-3", cp=2)
    g.say("== critter census on rime-3 ==")
    g.say(json.dumps(g.js(CRIT)))

    g.say("== THE CREVASSE CHIMNEY: floor 3.60 -> exit ledge 13.00 (9.40 m) ==")
    best = kick_ladder(g, (-19.5, 3.8, -15.0), (-21.2, -15.0), (-17.8, -15.0), "crevasse")
    g.shot("crevasse_kicks")
    g.say("   sign at (-19.5, 5.4, -13.0) says KICK ONE WALL, THEN THE OTHER")
    g.tp(-19.5, 3.8, -15.0); g.look(-19.5, -13.0); g.wait(900); g.shot("crevasse_sign")

    g.say("== THE FROZEN FALL: jump the 0.90 m lip, then pound the sheet ==")
    g.tp(-27.6, -0.6, -19.0); g.wait(700)
    g.face(-26.7, -16.5)
    for k in range(3):
        g.down("W"); g.wait(300); g.tap("SPACE", 110); g.wait(1000); g.up("W"); g.wait(600)
        s = g.show("hop %d" % k)
    g.shot("on_fall_ledge")
    g.walk(-26.7, -16.5, tol=1.0, max_ms=6000, tag="up against the sheet")
    g.show("at the sheet"); g.shot("at_the_sheet")
    g.say("   pound it: jump then C")
    for k in range(4):
        g.tap("SPACE", 110); g.wait(280); g.tap("C", 160); g.wait(1400)
        s = g.show("pound %d" % k)
    g.shot("after_pound")
    g.say("   walk into the chamber")
    g.walk(-23.5, -16.5, tol=1.6, max_ms=10000, tag="into the chamber")
    g.show("chamber"); g.shot("chamber")
    g.say("   flags:", g.js("() => { const s=CRESTBOUND.game.save; try{ return [...s.flags.keys()].slice(0,25);}catch(e){ return String(e).slice(0,80);} }"))

    g.say("== THE CAVE CHIMNEY (crusher cave): floor 19.60 -> ledge 27.70 (8.10 m) ==")
    best2 = kick_ladder(g, (15.0, 19.9, -2.0), (15.0, -3.9), (15.0, -0.1), "cave", presses=8)
    g.shot("cave_chimney_kicks")


run("chim", body)
