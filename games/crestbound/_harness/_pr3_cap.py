"""Is the shrine cap a plateau? Drop the hero onto a grid of cap points, let him
settle 3 s with NO input, and record where he ends up. Also: does the warden ever
wake, and does flight P2 let a player reach the gate landing?"""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

WARDEN = r"""() => { const c=CRESTBOUND.game.course; const L=(c&&c.critters)||[];
  const w=L.filter(x=>(x.kind||x.type)==='warden')[0]; if(!w) return null;
  return {st:w.state||null, hp:w.hp, alive:w.alive,
          p:w.pos?[+w.pos.x.toFixed(1),+w.pos.y.toFixed(1),+w.pos.z.toFixed(1)]:null}; }"""


def body(g):
    g.start("rime-3", cp=5)
    g.say("== drop-grid over the shrine cap (SUMMIT_Y 35.20, arena c=[0,-4] r=7.0) ==")
    g.say("   x     z    landed_y  settled_at              slid   surface")
    for z in (0, -2, -4, -6, -8, -10, -12):
        for x in (-6, -3, 0, 3, 6):
            g.js("() => { CRESTBOUND.game.deaths = CRESTBOUND.game.deaths; }")
            g.tp(x, 40.0, z)
            g.wait(2600)
            s = g.snap()
            p = s.get("p") or [0, 0, 0]
            slid = math.hypot(p[0] - x, p[2] - z)
            g.say("  %5.1f %5.1f   %6.2f   [%6.2f,%6.2f,%6.2f]   %5.2f  %s %s"
                  % (x, z, p[1], p[0], p[1], p[2], slid, s.get("surf"), s.get("ps")))
    g.shot("cap_grid_end")

    g.say("== does the warden ever wake? stand in its arena and wait ==")
    g.tp(0.0, 36.5, -6.0); g.wait(2500)
    g.show("in the arena")
    for i in range(10):
        g.wait(1000)
        s = g.snap()
        w = g.js(WARDEN)
        g.say("   t=%ds hero=%s ps=%s | warden %s" % (i + 1, s.get("p"), s.get("ps"), json.dumps(w)))
        if w and w.get("st") not in ("idle", "dormant"):
            g.say("   *** the warden woke up: %s" % w.get("st"))
            g.shot("warden_awake")
            break
    else:
        g.say("   *** the warden never left dormant/idle in 10 s of standing in its arena")
    g.shot("warden_dormant")
    g.say("   now hit it: walk at it and pound")
    for k in range(4):
        g.walk(0.0, -9.0, tol=1.6, max_ms=5000, tag="at the warden")
        g.tap("SPACE", 120); g.wait(300); g.tap("C", 160); g.wait(1300)
        g.say("   after pound %d: hero=%s warden=%s" % (k, g.snap().get("p"), json.dumps(g.js(WARDEN))))
    g.shot("warden_pound")

    g.say("== flight P2: can a player climb from landing P (31.10) to the gate landing (35.10)? ==")
    g.tp(12.4, 31.5, -9.8); g.wait(1000)
    g.show("landing P")
    r = g.walk(10.4, -4.2, tol=1.2, max_ms=16000, tag="landing P -> gate landing")
    g.show("end of the climb"); g.shot("p2_climb")
    g.say("   trying again with jumps")
    g.tp(12.4, 31.5, -9.8); g.wait(900)
    g.face(10.4, -4.2)
    g.down("W")
    for k in range(8):
        g.wait(500); g.tap("SPACE", 100)
        s = g.snap()
        g.say("   jumpclimb %d: %s ps=%s" % (k, s.get("p"), s.get("ps")))
    g.up("W"); g.wait(900)
    g.show("after jump-climb"); g.shot("p2_jumpclimb")


run("cap", body)
