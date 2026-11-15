"""BLIZZARD PEAK: the crusher cave interior (hammers, beam tripwires, the rotten
panel), a clean standing-jump measurement on IS1, and the gnasher's telegraph."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run


def tp_ok(g, x, y, z, tol=1.5, tries=6):
    for i in range(tries):
        g.tp(x, y, z)
        g.wait(700)
        p = g.snap().get("p") or [999, 999, 999]
        if math.hypot(p[0] - x, p[2] - z) < tol:
            return True
        g.wait(900)
    g.say("   !! could not place the hero at (%.1f,%.1f,%.1f) - last %s" % (x, y, z, p))
    return False


def body(g):
    g.start("rime-3", cp=4)                     # cp-terrace

    g.say("== standing-jump apex on IS1 (26.2, 15.20, -12.0): can a jump clear a 1.60 m step? ==")
    if tp_ok(g, 26.2, 15.4, -12.0):
        g.show("on IS1")
        for k in range(3):
            g.tap("SPACE", 120)
            peak = 15.20
            for i in range(8):
                g.wait(110)
                p = g.snap().get("p") or [0, 0, 0]
                peak = max(peak, p[1])
            g.wait(700)
            g.say("   standing jump %d apex y=%.2f (rise %.2f m; IS2 needs 1.60)" % (k, peak, peak - 15.20))
        g.say("   now jump EARLY then run: space first, W after")
        g.face(26.4, -8.4)
        g.tap("SPACE", 120); g.down("W"); g.wait(1200); g.up("W"); g.wait(800)
        g.show("early-jump hop to IS2"); g.shot("is1_early_jump")

    g.say("== the crusher cave interior ==")
    if tp_ok(g, 21.0, 20.0, -2.0):
        g.show("under hammer 2 (20.5, -2)")
        g.shot("cave_under_hammer")
        g.say("   stand still under the hammers for 12 s - do they crush a standing player?")
        d0 = g.snap().get("deaths")
        for i in range(12):
            g.wait(1000)
            s = g.snap()
            if (s.get("deaths") or 0) > (d0 or 0):
                g.say("   *** CRUSHED standing still at t=%ds, cause=%s"
                      % (i + 1, g.js("() => CRESTBOUND.game.player.deathCause")))
                g.shot("cave_crushed")
                break
            if i in (3, 8):
                g.say("   t=%ds p=%s ps=%s" % (i + 1, s.get("p"), s.get("ps")))
        else:
            g.say("   survived 12 s standing under the hammers")
        g.shot("cave_hammers")

    g.say("== the beam tripwires at x 21.8 and 19.2 (z -4.2 .. 0.2, y 20.40) ==")
    if tp_ok(g, 23.5, 20.0, -2.0):
        d0 = g.snap().get("deaths")
        r = g.walk(16.5, -2.0, tol=1.2, max_ms=20000, tag="the coin line, east -> west")
        g.show("cave crossing"); g.shot("cave_crossing")
        g.say("   deaths %s -> %s   coins %s" % (d0, g.snap().get("deaths"), g.snap().get("coins")))
        if r.get("died"):
            g.say("   died at %s, cause %s" % (r.get("trail", [])[-1:], g.js("() => CRESTBOUND.game.player.deathCause")))

    g.say("== the rotten ice panel at (17.0, 20.60, -4.2), drop 6 coins ==")
    if tp_ok(g, 17.0, 20.0, -3.2):
        c0 = g.snap().get("coins")
        g.face(17.0, -4.2)
        for k in range(4):
            g.tap("SPACE", 120); g.wait(280); g.tap("C", 170); g.wait(1500)
            s = g.show("pound %d" % k)
        g.say("   coins %s -> %s" % (c0, g.snap().get("coins")))
        g.shot("panel_pound")

    g.say("== the gnasher: does it telegraph before it bites? ==")
    if tp_ok(g, 16.0, 20.0, -2.0):
        g.say("   creeping east toward the post at (21,-2); sampling every 150 ms")
        d0 = g.snap().get("deaths")
        g.face(21.0, -2.0)
        g.down("W")
        for i in range(60):
            g.wait(150)
            s = g.snap()
            gn = g.js("""() => { const L=(CRESTBOUND.game.course&&CRESTBOUND.game.course.critters)||[];
              const g0=L.filter(c=>(c.kind||c.type)==='gnasher')[0]; if(!g0) return null;
              const P=CRESTBOUND.game.player;
              return {st:g0.state||null, d:+Math.hypot(g0.pos.x-P.pos.x,g0.pos.z-P.pos.z).toFixed(2)}; }""")
            if i % 4 == 0 or (gn and gn.get("st") not in ("idle", "patrol")):
                g.say("   t=%.1f hero=%s gnasher=%s" % (i * 0.15, s.get("p"), json.dumps(gn)))
            if (s.get("deaths") or 0) > (d0 or 0):
                g.say("   *** BITTEN at t=%.1f s, %s" % (i * 0.15, json.dumps(gn)))
                break
        g.up("W")
        g.shot("gnasher_bite")


    g.say("== does the hero FALL over the summit? drop from 40 m at several cap points ==")
    for (x, z) in [(0, -8), (0, -4), (0, 0), (-3, -2), (3, -6), (0, -12)]:
        g.tp(x, 40.0, z)
        rows = []
        for i in range(16):
            g.wait(250)
            s = g.snap()
            rows.append(((s.get("p") or [0,0,0])[1], (s.get("v") or [0,0,0])[1], s.get("ps")))
        g.say("   drop at (%s,%s): y %s -> %s   vy %s -> %s   ps %s"
              % (x, z, round(rows[0][0],2), round(rows[-1][0],2),
                 rows[0][1], rows[-1][1], rows[-1][2]))
    g.shot("gravity_probe")


run("east4", body)
