"""GNASHER FORT phase 9 — portcullis attempts, the inner court + Warden, the keep shaft,
the roof crest, the orbit movers, the sigil pedestal."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk, dismiss_card, critters
from _pgrun import run

def g(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      st:P.state, gr:!!P.grounded,
      deg:+(Math.acos(Math.max(-1,Math.min(1,P.groundNormal.y)))*180/Math.PI).toFixed(1),
      sf:P.surface, d:G.deaths, gs:G.state, clk:+G.course.clock.toFixed(1) }; }""")

def watch(pl, secs, step=350, tag=""):
    out=[]
    for i in range(int(secs*1000/step)):
        pl.wait(step); out.append(g(pl))
    pl.say("  %s: %s" % (tag, json.dumps([[o["p"],o["st"],o["gr"]] for o in out])))
    return out

def pound(pl):
    pl.tap("SPACE", 170); pl.wait(300)
    pl.down("C"); pl.wait(850); pl.up("C"); pl.wait(1000)

def body(pl):
    rec_on(pl)

    # 1 — PORTCULLIS, harder: pound ON it from above, and dive into it
    pl.say("== 1. PORTCULLIS: pound from directly above (0, 21.6, 9.4) ==")
    pl.tp(0, 21.9, 9.4); pl.wait(1200)
    pound(pl); pound(pl)
    f = pl.js("() => ({up: !!CRESTBOUND.game.save.flags.get('portcullis-up')})")
    pl.say("  from above:", json.dumps(g(pl)), json.dumps(f), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("1_pc_above")
    pl.say("  -- dive into it from the pad --")
    pl.tp(0, 18.5, 11.4); pl.wait(900); pl.face(0, 9.4)
    pl.down("W"); pl.wait(500); pl.tap("SPACE", 150); pl.wait(160); pl.tap("F", 120)
    pl.wait(1200); pl.up("W"); pl.wait(600)
    f = pl.js("() => ({up: !!CRESTBOUND.game.save.flags.get('portcullis-up')})")
    pl.say("  dive:", json.dumps(g(pl)), json.dumps(f), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("1_pc_dive")

    # 2 — THE INNER COURT + THE WARDEN
    pl.say("== 2. THE INNER COURT (cp-court -6.0,19.0,0.5) and the WARDEN ==")
    pl.tp(-6.0, 19.3, 0.5); pl.wait(1500); pl.shot("2_court")
    pl.say("  ", json.dumps(g(pl)), "critters:", json.dumps(critters(pl, 20)))
    pl.say("  -- walk to the Warden at (0,19,3) --")
    r = walk(pl, 0.0, 3.0, tol=2.0, max_ms=12000, tag="to the Warden", die_ok=True)
    pl.wait(1500)
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("2_warden")
    pl.say("  -- stand still by it 10 s: does it attack? --")
    watch(pl, 10, tag="warden idle")
    pl.say("  ", json.dumps(g(pl)), "critters:", json.dumps(critters(pl, 20)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("2_warden_after")
    pl.say("  -- pound its back --")
    for k in range(3):
        pound(pl)
        pl.say("   pound %d: %s ev=%s" % (k+1, json.dumps(g(pl)), json.dumps(evsum(rec(pl)))))
    pl.shot("2_warden_pounded")

    # 3 — THE SIGIL PEDESTAL
    pl.say("== 3. sigil pedestal (0, 19.00, 5.0) ==")
    pl.tp(-2.0, 19.3, 5.0); pl.wait(1000); pl.shot("3_pedestal")
    pl.say("  ", json.dumps(g(pl)))

    # 4 — THE WALL-KICK SHAFT (route B) floor 18.60 exit 27.00
    pl.say("== 4. THE WALL-KICK SHAFT at (-7.4, 18.60, -7.4) ==")
    pl.tp(-7.4, 19.0, -7.4); pl.wait(1400); pl.shot("4_shaft_floor")
    pl.say("  ", json.dumps(g(pl)))
    for k in range(8):
        pl.face(-9.2 if k % 2 == 0 else -5.6, -7.4)
        pl.down("W"); pl.wait(220); pl.tap("SPACE", 170); pl.wait(420)
        s = g(pl); pl.say("   kick %d: %s" % (k+1, json.dumps(s)))
        pl.up("W")
    pl.wait(900)
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("4_shaft_top")

    # 5 — THE ROOF and the OPEN CREST at (0, 28.60, -3)
    pl.say("== 5. THE KEEP ROOF (0, 27.30, -3) and the crest at 28.60 ==")
    pl.tp(0, 27.6, -3.0); pl.wait(1500); pl.shot("5_roof")
    pl.say("  ", json.dumps(g(pl)))
    r = walk(pl, 0.0, -3.0, tol=1.0, max_ms=5000, tag="stand under the crest")
    pl.down("W"); pl.wait(300); pl.tap("SPACE", 220); pl.wait(1400); pl.up("W"); pl.wait(1200)
    pl.say("  after hop:", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("5_open_crest")
    dismiss_card(pl)
    pl.say("  ", json.dumps(g(pl)))

    # 6 — THE ORBIT MOVERS
    pl.say("== 6. THE ORBIT MOVERS around the keep ==")
    pl.tp(9.6, 21.7, -3.0); pl.wait(1400); pl.shot("6_orbit_board")
    watch(pl, 14, tag="stand on the middle walk where the outer ring passes")
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("6_orbit_after")

run("p9", body)
