"""BLIZZARD PEAK playtest - BEAT 1 -> 2: walk out of camp, up the trodden track,
into the gale, and hop the four carved shelves. Real keys only."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run


def jump_to(g, x, z, runup=700, air=1300, tag="", keys=("W",)):
    """Run up facing the target, jump, keep holding forward through the air."""
    g.face(x, z)
    g.down(*keys)
    g.wait(runup)
    pre = g.snap()
    g.tap("SPACE", 100)
    t = 0
    peak = pre["p"][1] if pre.get("p") else 0
    while t < air:
        g.wait(200); t += 200
        s = g.snap()
        if s.get("p"):
            peak = max(peak, s["p"][1])
        g.face(x, z)
    g.up(*keys)
    g.wait(700)
    s = g.snap()
    p = s.get("p") or [0, 0, 0]
    d = math.hypot(p[0] - x, p[2] - z)
    g.say("   JUMP->(%.1f,%.1f) %s  takeoff=%s sp=%.2f  land=%s d=%.2f peakY=%.2f ps=%s gnd=%s"
          % (x, z, tag, pre.get("p"), pre.get("sp") or 0, p, d, peak, s.get("ps"), s.get("gnd")))
    return s, d


def body(g):
    g.start("rime-3")
    g.show("start (cp-camp)")

    # ---- BEAT 1: walk the trodden track out of camp, on foot, collecting coins
    g.say("== BEAT 1: the trodden track out of camp ==")
    g.walk(0, 42.0, tol=1.2, tag="trail head")
    g.walk(-8, 39.0, tol=1.5, max_ms=14000, tag="trail 2"); g.show("trail 2")
    g.walk(-16, 36.0, tol=1.5, max_ms=16000, tag="trail 3"); g.show("trail 3"); g.shot("trail3")
    g.walk(-24, 33.0, tol=1.6, max_ms=18000, tag="trail 4"); g.show("trail 4"); g.shot("trail4")

    # ---- cp-westface
    g.walk(-25.2, 32.0, tol=1.0, max_ms=9000, tag="cp-westface pad")
    g.show("on cp-westface"); g.shot("cp_westface")
    g.say("   sign 'LEAN WEST' is authored at (-25.2, 5.2, 29.6) rot 2.55 - can I read it?")
    g.look(-25.2, 29.6); g.wait(500); g.shot("sign_leanwest")

    # ---- THE WIND: stand perfectly still inside the first wind volume
    g.say("== THE GALE: stand still, hands off the keys, for 8 s ==")
    g.tp(-28.0, 4.2, 25.0); g.wait(900)
    a = g.show("wind: t=0")
    for i in range(4):
        g.wait(2000); g.show("wind: t=%d" % (2 * (i + 1)))
    b = g.snap()
    if a.get("p") and b.get("p"):
        g.say("   drift over 8 s standing still: dx=%.2f dz=%.2f  (total %.2f m)"
              % (b["p"][0] - a["p"][0], b["p"][2] - a["p"][2],
                 math.hypot(b["p"][0] - a["p"][0], b["p"][2] - a["p"][2])))
    g.shot("wind_standing")

    # ---- walking straight north across the gale: how far do I get pushed?
    g.say("== walking N across the gale with W held, no correction ==")
    g.tp(-28.0, 4.2, 26.0); g.wait(800)
    g.js("() => { const G=CRESTBOUND.game; G.player.__test.setFacing(0); if(G.cam){G.cam.yaw=0;} }")
    g.down("W"); g.wait(2500); s1 = g.snap(); g.wait(2500); s2 = g.snap(); g.up("W"); g.wait(300)
    g.say("   after 5 s of pure W from (-28,26): %s ps=%s" % (s2.get("p"), s2.get("ps")))
    g.shot("wind_walking")

    # ---- BEAT 2: the four carved shelves, hopped for real
    g.say("== BEAT 2: shelf A -> B -> C -> D ==")
    g.tp(-29.0, 4.4, 26.0); g.wait(900)
    g.show("on shelf A"); g.shot("shelfA")
    s, d = jump_to(g, -32.6, 20.0, runup=800, air=1600, tag="A->B (1.80 m at +1.05)")
    g.shot("after_A_to_B")
    if d > 2.0:
        g.say("   ** did not land on B - retrying with a longer run-up")
        g.tp(-29.0, 4.4, 26.0); g.wait(700)
        s, d = jump_to(g, -32.6, 20.0, runup=1400, air=1800, tag="A->B retry")
    if d <= 2.0:
        s, d = jump_to(g, -35.4, 13.5, runup=900, air=1800, tag="B->C (2.50 m at +1.15)")
        g.shot("after_B_to_C")
    if d <= 2.0:
        s, d = jump_to(g, -36.4, 6.5, runup=1000, air=2000, tag="C->D (3.00 m at +1.15)")
        g.shot("after_C_to_D")
    g.show("end of the shelf chain")

    # ---- down the carved shelves to the gorge lip
    g.walk(-36.0, -2.0, tol=2.0, max_ms=20000, tag="down the shelf line to (-36,-2)")
    g.show("gorge lip"); g.shot("gorge_lip")
    g.walk(-36.0, -9.0, tol=1.2, max_ms=12000, tag="cp-gorge pad")
    g.show("on cp-gorge"); g.shot("cp_gorge")


run("west", body)
