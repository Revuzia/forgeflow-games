"""BLIZZARD PEAK: (a) WHAT kills a player standing on cp-bridge, (b) is the
ice-shelf stair climbable when you start ON shelf 1, (c) does the mill gondola
carry you, (d) the crusher hammers and beam tripwires from inside the cave."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

CAUSE = r"""() => { const G=CRESTBOUND.game, P=G.player;
  const L=(G.course&&G.course.critters)||[];
  return { deaths:G.deaths, cause:P?P.deathCause:null, pstate:P?P.state:null,
    critters: L.map(c=>({k:c.kind||c.type, st:c.state||null,
      p:c.pos?[+c.pos.x.toFixed(1),+c.pos.y.toFixed(1),+c.pos.z.toFixed(1)]:null,
      d: c.pos&&P ? +Math.hypot(c.pos.x-P.pos.x, c.pos.y-P.pos.y, c.pos.z-P.pos.z).toFixed(1) : null }))
      .filter(x=>x.d!==null && x.d<25) }; }"""


def body(g):
    g.say("== (a) WHAT kills a player standing on cp-bridge (-23.8, 8.0, -30.7)? ==")
    g.start("rime-3", cp=3)
    g.say("   at load:", json.dumps(g.js(CAUSE)))
    d0 = g.snap().get("deaths")
    for i in range(24):
        g.wait(400)
        s = g.snap()
        if (s.get("deaths") or 0) > d0:
            g.say("   *** DIED after %.1f s standing still. %s" % (i * 0.4, json.dumps(g.js(CAUSE))))
            g.shot("cpbridge_death")
            d0 = s.get("deaths")
            if i > 4:
                break
        if i in (3, 10):
            g.say("   t=%.1f s  %s" % (i * 0.4, json.dumps(g.js(CAUSE))))
    g.say("   total deaths standing still on cp-bridge for ~10 s:", g.snap().get("deaths"))

    g.say("== (b) the ice-shelf stair, starting ON shelf IS1 (26.2, 15.20, -12.0) ==")
    g.tp(26.2, 15.4, -12.0); g.wait(1200)
    s = g.show("standing on IS1?")
    g.shot("on_IS1")
    hops = [(26.4, -8.4, 16.80, "IS2"), (26.2, -3.6, 18.40, "IS3"), (25.0, -1.6, 19.60, "IS4/terrace lip")]
    for (tx, tz, top, name) in hops:
        g.face(tx, tz)
        g.down("W"); g.wait(330); g.tap("SPACE", 110); g.wait(1200); g.up("W"); g.wait(700)
        s = g.show("hop -> %s (want y ~%.2f)" % (name, top))
    g.shot("stair_isolated")

    g.say("== (c) THE MILL LIFT: stand at the bottom of the east mill's sweep (30, -6) ==")
    g.tp(30.0, 12.9, -6.0); g.wait(1500)
    s = g.show("at the gondola boarding spot")
    y0 = (s.get("p") or [0, 0, 0])[1]
    best = y0
    for i in range(22):
        g.wait(700)
        s = g.snap()
        y = (s.get("p") or [0, 0, 0])[1]
        best = max(best, y)
        if i % 4 == 0:
            g.say("   t=%.1f s  p=%s ps=%s surf=%s" % (i * 0.7, s.get("p"), s.get("ps"), s.get("surf")))
        if i == 8: g.shot("mill_wait")
    g.say("   after 15 s at the boarding spot: best y %.2f (start %.2f). Terrace is 19.60." % (best, y0))
    g.shot("mill_after")

    g.say("== (d) INSIDE the crusher cave: drop in past the gnasher, walk the hammers ==")
    g.tp(19.5, 20.0, -2.0); g.wait(1200)
    s = g.show("between hammers 2 and 3")
    g.shot("cave_in")
    d0 = g.snap().get("deaths")
    for i in range(14):
        g.wait(700)
        s = g.snap()
        if (s.get("deaths") or 0) > d0:
            g.say("   *** the cave killed me standing still at t=%.1f s: %s" % (i * 0.7, json.dumps(g.js(CAUSE))[:400]))
            g.shot("cave_kill")
            break
        if i in (2, 7):
            g.say("   t=%.1f  p=%s ps=%s" % (i * 0.7, s.get("p"), s.get("ps")))
    else:
        g.say("   survived 10 s standing between the hammers")
    g.say("   now walk the coin line west through all three hammers and both beams")
    d0 = g.snap().get("deaths")
    for tx in (18.0, 16.5, 15.2):
        r = g.walk(tx, -2.0, tol=1.0, max_ms=9000, tag="cave -> x=%.1f" % tx)
        if r.get("died"):
            g.say("   *** died in the cave walking to x=%.1f" % tx)
            break
    g.show("cave walk end"); g.shot("cave_walk_end")
    g.say("   deaths %s -> %s, coins %s" % (d0, g.snap().get("deaths"), g.snap().get("coins")))

    g.say("== the rotten ice panel at (17.0, 20.60, -4.2): can I pound it for 6 coins? ==")
    g.tp(17.0, 20.0, -3.0); g.wait(900)
    c0 = g.snap().get("coins")
    for k in range(3):
        g.tap("SPACE", 120); g.wait(300); g.tap("C", 160); g.wait(1400)
        s = g.show("pound panel %d" % k)
    g.say("   coins %s -> %s" % (c0, g.snap().get("coins")))
    g.shot("breakable_panel")


run("east3", body)
