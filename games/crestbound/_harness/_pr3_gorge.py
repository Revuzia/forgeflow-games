"""BLIZZARD PEAK playtest - BEAT 3: THE GORGE. Read the bridge sign, cross the
sagging deck in the gust, jump deck -> pier -> deck, try the vanish ice, then
fall in on purpose and do ROUTE C: frozen floor, frozen fall, crevasse chimney."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run


def jump_to(g, x, z, runup=700, air=1500, tag="", keys=("W",)):
    g.face(x, z); g.down(*keys); g.wait(runup)
    pre = g.snap(); g.tap("SPACE", 100)
    t = 0; peak = (pre.get("p") or [0, 0, 0])[1]
    while t < air:
        g.wait(200); t += 200
        s = g.snap()
        if s.get("p"): peak = max(peak, s["p"][1])
        g.face(x, z)
    g.up(*keys); g.wait(800)
    s = g.snap(); p = s.get("p") or [0, 0, 0]
    d = math.hypot(p[0] - x, p[2] - z)
    g.say("   JUMP->(%.1f,%.1f) %s takeoff=%s sp=%.2f land=%s d=%.2f peakY=%.2f ps=%s gnd=%s deaths=%s"
          % (x, z, tag, pre.get("p"), pre.get("sp") or 0, p, d, peak, s.get("ps"), s.get("gnd"), s.get("deaths")))
    return s, d


def body(g):
    g.start("rime-3", cp=2)          # cp-gorge
    g.show("cp-gorge")
    g.shot("cp_gorge_start")

    g.say("== the bridge signs at (-32.4, 8.4 / 8.0, -9.0), facing -X ==")
    g.tp(-34.2, 6.9, -9.0); g.look(-32.4, -9.0); g.wait(900); g.shot("sign_bridge")

    g.say("== walk out onto span A (BR_A -36,6.6,-14.9 -> BR_A_END -33.6,6.3,-18.6) ==")
    g.tp(-36.0, 6.9, -12.0); g.wait(700)
    r = g.walk(-36.0, -14.9, tol=1.0, max_ms=9000, tag="bridge mouth")
    g.show("bridge mouth"); g.shot("bridge_mouth")
    r = g.walk(-33.6, -18.6, tol=1.2, max_ms=12000, tag="across span A in the gust")
    g.show("end of span A"); g.shot("span_a_end")

    g.say("== deck -> PIER (-30.8, 6.75, -22.5), a 3.00 m gap in a 10 m/s2 gust ==")
    s, d = jump_to(g, -30.8, -22.5, runup=650, air=1600, tag="A_END -> pier")
    g.shot("after_pier_jump")
    if d > 1.8 and not s.get("deaths"):
        g.say("   ** missed the pier - where did I end up?")
        g.show("after miss")
    if d <= 1.8:
        g.say("== PIER -> span B start (-28.2, 6.6, -26.6) ==")
        s, d = jump_to(g, -28.2, -26.6, runup=500, air=1600, tag="pier -> B")
        g.shot("after_spanB_jump")
        if d <= 2.0:
            g.walk(-23.9, -30.4, tol=1.4, max_ms=12000, tag="across span B to the far lip")
            g.show("far lip"); g.shot("far_lip")

    g.say("== THE VANISH ICE line: stand on tile 1 (-31.0, 6.90, -14.9) and watch a full cycle ==")
    g.tp(-31.0, 7.2, -14.9); g.wait(600)
    for i in range(12):
        s = g.show("vanish t=%.1f" % (i * 0.6))
        if s.get("deaths"):
            g.say("   *** died standing on vanish tile 1")
            break
        if i == 3: g.shot("vanish_tile1")
        g.wait(600)

    g.say("== ROUTE C: drop into the gorge on purpose from the bridge ==")
    g.tp(-31.5, 7.5, -20.0); g.wait(600)
    g.down("W"); g.face(-29.0, -21.0); g.wait(1500); g.up("W")
    for i in range(10):
        g.wait(500)
        s = g.snap()
        if s.get("gnd"): break
    g.show("bottom of the gorge"); g.shot("gorge_floor")

    g.say("== the frozen floor and the FROZEN FALL (breakable at -26.7, 1.60, -16.5) ==")
    g.tp(-27.6, -0.6, -19.0); g.wait(700)
    g.show("ice shelf in the gorge"); g.shot("gorge_shelf")
    r = g.walk(-26.7, -16.5, tol=1.6, max_ms=14000, tag="toward the frozen fall")
    g.show("at the frozen fall"); g.look(-26.7, -16.5); g.wait(400); g.shot("frozen_fall")
    g.say("   pounding the sheet: jump then C in the air")
    for attempt in range(3):
        g.tap("SPACE", 110); g.wait(300); g.tap("C", 140); g.wait(1200)
        s = g.show("pound %d" % attempt)
        if s.get("sig") or (s.get("coins") or 0) > 20:
            break
    g.shot("after_pound")
    g.say("   did the chamber open? walk into it")
    g.walk(-23.5, -16.5, tol=1.6, max_ms=12000, tag="into the ice chamber")
    g.show("inside the chamber"); g.shot("ice_chamber")

    g.say("== THE CREVASSE CHIMNEY (-19.5 slot, 4 wall kicks) ==")
    g.tp(-19.5, 3.8, -15.0); g.wait(700)
    g.show("chimney floor"); g.shot("chimney_floor")
    g.face(-21.2, -15.0)
    for k in range(5):
        g.tap("SPACE", 110)
        g.wait(320)
        s = g.snap()
        g.say("   kick %d -> p=%s ps=%s" % (k, s.get("p"), s.get("ps")))
        # alternate the wall we face
        g.face(-17.8 if k % 2 == 0 else -21.2, -15.0)
        g.wait(200)
    g.wait(1200)
    g.show("after the chimney attempt"); g.shot("chimney_after")


run("gorge", body)
