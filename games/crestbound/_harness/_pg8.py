"""GNASHER FORT phase 8 — the vanish flight, the rotor bars, the mill, the portcullis."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk, dismiss_card, st2
from _pgrun import run

def g(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      st:P.state, gr:!!P.grounded,
      deg:+(Math.acos(Math.max(-1,Math.min(1,P.groundNormal.y)))*180/Math.PI).toFixed(1),
      sf:P.surface, d:G.deaths, clk:+G.course.clock.toFixed(1) }; }""")

def watch(pl, secs, step=350, tag=""):
    out=[]
    for i in range(int(secs*1000/step)):
        pl.wait(step); out.append(g(pl))
    pl.say("  %s: %s" % (tag, json.dumps([[o["p"],o["st"],o["gr"],o["clk"]] for o in out])))
    return out

def body(pl):
    rec_on(pl)
    pl.say("hazard object shape:", json.dumps(pl.js(
      "() => { const H = CRESTBOUND.game.course.hazards||[]; const h=H[3]; return h? Object.keys(h): 'none'; }")))

    # 1 — THE VANISH FLIGHT, east radius. flagstone tops 13.40 .. 20.90
    pl.say("== 1. THE VANISH FLIGHT (18.6,13.20,0) -> (10.6,20.70,0) ==")
    pl.tp(19.6, 14.2, 0.0); pl.wait(1400); pl.shot("1_vanish_bottom")
    watch(pl, 8, tag="stand on flagstone 1 (does it drop me?)")
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("1_vanish_stood")
    pl.say("  -- climb the flight, hopping west-up --")
    for i, (tx, ty) in enumerate([(17.0,14.7),(15.4,16.2),(13.8,17.7),(12.2,19.2),(10.6,20.7)]):
        pl.face(tx, 0.0)
        pl.down("W"); pl.wait(280); pl.tap("SPACE", 190); pl.wait(950); pl.up("W"); pl.wait(450)
        pl.say("   hop %d -> %s" % (i+1, json.dumps(g(pl))))
    pl.shot("1_vanish_top")
    pl.say("  ev:", json.dumps(evsum(rec(pl))))

    # 2 — THE ROTOR BARS on the middle walk (21.40)
    pl.say("== 2. ROTOR BARS on the middle walk ==")
    pl.tp(0, 21.7, -6.0); pl.wait(1400); pl.shot("2_rotor_before")
    pl.face(0, -12.0)
    pl.down("W")
    rt = watch(pl, 10, tag="walk into the north rotor at (0,21.95,-9)")
    pl.up("W"); pl.wait(400)
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("2_rotor_after")
    pl.say("  -- stand still inside the east rotor's sweep (9,21.7,0) --")
    pl.tp(9.0, 21.7, 0.0); pl.wait(1200)
    watch(pl, 9, tag="stand in the east rotor")
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("2_rotor_east")

    # 3 — THE MILL at (-16,20,0): board at the bottom, step off at the side
    pl.say("== 3. THE MILL (-16,20,0) arms 4 len 6.2 period 11 ==")
    pl.tp(-16.0, 13.4, 3.6); pl.wait(1400); pl.shot("3_mill_before")
    pl.face(-16.0, 0.0)
    pl.down("W")
    watch(pl, 14, tag="walk to the gondola at the bottom of the sweep")
    pl.up("W"); pl.wait(400)
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("3_mill_board")
    pl.say("  -- ride it (no input) 14 s --")
    watch(pl, 14, tag="riding")
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("3_mill_ride")

    # 4 — THE PORTCULLIS at (0,19.20,9.4): pound it
    pl.say("== 4. THE PORTCULLIS (breakable grate, 0,19.20,9.4) ==")
    pl.tp(0, 18.4, 11.4); pl.wait(1400); pl.shot("4_portcullis_before")
    pl.say("  ", json.dumps(g(pl)))
    pl.face(0, 9.4)
    pl.down("W"); pl.wait(700); pl.up("W"); pl.wait(400)
    pl.say("  walked into it:", json.dumps(g(pl)))
    for k in range(4):
        pl.tap("SPACE", 170); pl.wait(300)
        pl.down("C"); pl.wait(850); pl.up("C"); pl.wait(1100)
        pl.say("   pound %d: %s ev=%s" % (k+1, json.dumps(g(pl)), json.dumps(evsum(rec(pl)))))
        f = pl.js("() => ({up: !!CRESTBOUND.game.save.flags.get('portcullis-up')})")
        pl.say("   flag:", json.dumps(f))
        if f["up"]: break
    pl.shot("4_portcullis_after")
    pl.say("  -- can I get through now? --")
    r = walk(pl, 0, 6.0, tol=1.6, max_ms=10000, tag="through the portcullis")
    pl.say("  ", json.dumps(g(pl)))
    pl.shot("4_through")

run("p8", body)
