"""BLIZZARD PEAK - BEAT 7: the stair viaduct, the shrine gate sign, the prayer
wheels, the WARDEN fight and the open crest. Plus sigils 7 and 8 and the wing hat."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

WARDEN = r"""() => { const c=CRESTBOUND.game.course; const L=(c&&c.critters)||[];
  const w = L.filter(x => (x.kind||x.type)==='warden')[0]; if(!w) return null;
  return { st:w.state||null, hp:w.hp===undefined?null:w.hp, alive:w.alive,
           p:w.pos?[+w.pos.x.toFixed(1),+w.pos.y.toFixed(1),+w.pos.z.toFixed(1)]:null }; }"""


def body(g):
    g.start("rime-3", cp=5)                       # cp-gate, the shrine gate landing
    g.show("cp-gate")
    g.shot("cp_gate")

    g.say("== can I read THE SHRINE GATE board at (10.4, 36.4 / 36.0, -4.2)? ==")
    g.tp(13.0, 35.4, -4.2); g.look(10.4, -4.2); g.wait(1000); g.shot("gate_sign")
    g.tp(10.4, 35.4, -7.0); g.look(10.4, -4.2); g.wait(900); g.shot("gate_sign2")

    g.say("== BEAT 7: walk DOWN the viaduct from the gate to the chimney ledge, then back UP ==")
    g.tp(10.4, 35.4, -4.2); g.wait(800)
    g.walk(11.4, -6.4, tol=1.4, max_ms=12000, tag="onto flight P2")
    g.show("on P2"); g.shot("viaduct_p2")
    g.walk(12.4, -9.8, tol=1.4, max_ms=12000, tag="landing P")
    g.show("landing P"); g.shot("viaduct_landing")
    g.walk(13.8, -6.3, tol=1.6, max_ms=12000, tag="down flight P1")
    g.show("on P1")
    g.walk(15.0, -2.0, tol=1.6, max_ms=12000, tag="chimney exit ledge 27.70")
    s = g.show("chimney ledge"); g.shot("viaduct_bottom")
    g.say("   now CLIMB the viaduct the way a player would, from the ledge")
    for (tx, tz, name) in [(13.8, -6.3, "P1 flight"), (12.4, -9.8, "landing P"),
                           (11.4, -6.4, "P2 flight"), (10.4, -4.2, "the gate landing 35.10")]:
        r = g.walk(tx, tz, tol=1.5, max_ms=14000, tag="up -> " + name)
        g.show("at " + name)
    g.shot("viaduct_climb_end")

    g.say("== the cap: prayer wheels, the plinth and the open crest ==")
    g.tp(10.4, 35.4, -4.2); g.wait(700)
    g.walk(4.0, -4.0, tol=1.6, max_ms=14000, tag="step onto the cap")
    g.show("on the cap"); g.look(0, -4); g.wait(400); g.shot("cap")
    g.say("   walk into a prayer wheel at (4.6, 36.1, -8.6): does it shove or kill?")
    d0 = g.snap().get("deaths")
    r = g.walk(4.6, -8.6, tol=1.2, max_ms=10000, tag="into a prayer wheel")
    g.show("prayer wheel"); g.shot("prayer_wheel")
    g.say("   deaths %s -> %s" % (d0, g.snap().get("deaths")))

    g.say("== THE WARDEN ==")
    g.say("   warden before:", json.dumps(g.js(WARDEN)))
    g.tp(6.0, 35.6, -6.0); g.wait(800)
    d0 = g.snap().get("deaths")
    g.walk(0.0, -9.0, tol=2.5, max_ms=12000, tag="walk at the warden")
    g.show("engaged"); g.shot("warden_engage")
    g.say("   warden now:", json.dumps(g.js(WARDEN)))
    for round_ in range(6):
        w = g.js(WARDEN)
        s = g.snap()
        g.say("   round %d: hero %s ps=%s deaths=%s | warden %s" % (round_, s.get("p"), s.get("ps"), s.get("deaths"), json.dumps(w)))
        # jump the shockwave, then try to pound its back
        g.tap("SPACE", 110); g.wait(320); g.tap("C", 150); g.wait(1400)
        if round_ == 2: g.shot("warden_fight")
        if (s.get("deaths") or 0) > (d0 or 0):
            g.say("   *** the warden killed me")
            g.shot("warden_death")
            break
    g.say("   warden after:", json.dumps(g.js(WARDEN)))
    g.show("after the fight"); g.shot("warden_after")

    g.say("== the open crest at (0, 37.9, -4), plinth top 36.00 ==")
    g.tp(0.0, 36.4, -4.0); g.wait(900)
    g.show("on the plinth"); g.look(0, -4); g.wait(400); g.shot("plinth")
    for k in range(3):
        g.tap("SPACE", 120); g.wait(1100)
        s = g.show("jump for the crest %d" % k)
        if s.get("gs") in ("card", "clear"): break
    g.shot("crest_try")
    g.say("   game state now:", g.snap().get("gs"))

    g.say("== sigil 8 on the ice pinnacle (-6.0, 39.00, -9.0), pinnacle top 37.60 ==")
    g.tp(-4.0, 35.4, -9.0); g.wait(800)
    g.face(-6.0, -9.0)
    for k in range(3):
        g.down("W"); g.wait(350); g.tap("SPACE", 110); g.wait(1200); g.up("W"); g.wait(600)
        s = g.show("pinnacle try %d" % k)
    g.shot("pinnacle")

    g.say("== the wing hat at (2.0, 36.30, 4.0) ==")
    g.tp(2.0, 35.6, 6.0); g.wait(800)
    g.walk(2.0, 4.0, tol=1.0, max_ms=8000, tag="onto the wing hat")
    g.show("wing hat"); g.shot("wing_hat")
    g.say("   power:", g.js("() => { const p=CRESTBOUND.game.player; return {power:p.power||null, powerT:p.powerT||null}; }"))


run("shrine", body)
