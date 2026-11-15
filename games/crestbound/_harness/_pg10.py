"""GNASHER FORT phase 10 — retests where my own driver was the suspect:
proper wall kicks, orbit boarding on the right band, a pound that really fires,
and the camera inside the keep."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk, dismiss_card, critters
from _pgrun import run

def g(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player,C=G.cam; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      st:P.state, gr:!!P.grounded, sf:P.surface, d:G.deaths, gs:G.state,
      camd:C?+C.dist.toFixed(2):null, clk:+G.course.clock.toFixed(1) }; }""")

def realpound(pl, up=650, tag=""):
    """Jump, WAIT until airborne and past the apex, then crouch."""
    pl.tap("SPACE", 200)
    pl.wait(up)
    st = pl.js("() => CRESTBOUND.game.player.state")
    pl.down("C"); pl.wait(900); pl.up("C"); pl.wait(900)
    pl.say("   pound%s (airborne at crouch: %s) -> %s" % (tag, st, json.dumps(g(pl))))

def body(pl):
    rec_on(pl)

    # A — WALL KICKS done properly: run at a wall, jump, then jump AGAIN while wallsliding
    pl.say("== A. WALL-KICK SHAFT, kicking properly (-7.4, 18.60, -7.4) ==")
    pl.tp(-7.4, 18.8, -7.4); pl.wait(1400); pl.shot("A_shaft_floor")
    ymax = 18.6
    for k in range(10):
        tgt = -9.6 if k % 2 == 0 else -5.2
        pl.face(tgt, -7.4)
        pl.down("W"); pl.wait(240)
        pl.tap("SPACE", 160)          # jump at the wall
        pl.wait(260)
        s1 = pl.js("() => CRESTBOUND.game.player.state")
        pl.tap("SPACE", 160)          # the kick
        pl.wait(330)
        s = g(pl); ymax = max(ymax, s["p"][1])
        pl.up("W")
        pl.say("   kick %d (state at 2nd jump: %s) -> %s" % (k+1, s1, json.dumps(s)))
    pl.wait(800)
    pl.say("  max y %.2f (exit ledge is 27.00, floor 18.60)  ev: %s" % (ymax, json.dumps(evsum(rec(pl)))))
    pl.shot("A_shaft_after")

    # B — the ORBIT ring, boarded on the band the design names (east, |x| 7.60..10.40)
    pl.say("== B. ORBIT RING boarding at (8.2, 21.4, -3.0) ==")
    pl.tp(8.2, 21.7, -3.0); pl.wait(1400); pl.shot("B_orbit_wait")
    tr = []
    for i in range(50):
        pl.wait(400); tr.append(g(pl))
    pl.say("  y range: %.2f .. %.2f ; states %s" % (
        min(t["p"][1] for t in tr), max(t["p"][1] for t in tr),
        json.dumps(sorted(set(t["st"] for t in tr)))))
    pl.say("  carried? end=%s ev=%s" % (json.dumps(g(pl)), json.dumps(evsum(rec(pl)))))
    pl.shot("B_orbit_after")

    # C — a pound that really fires, next to the Warden
    pl.say("== C. THE WARDEN, with a pound that actually fires ==")
    pl.tp(0, 19.3, 5.5); pl.wait(1400)
    pl.say("  ", json.dumps(critters(pl, 12)))
    pl.shot("C_warden_before")
    for k in range(4):
        realpound(pl, 650, " %d" % (k+1))
        pl.say("    ev:", json.dumps(evsum(rec(pl))), "warden:", json.dumps(critters(pl, 12)[:1]))
    pl.shot("C_warden_after")
    pl.say("  -- now CHASE it: walk into it repeatedly for 12 s --")
    for i in range(6):
        w = pl.js("""() => { const L=CRESTBOUND.game.course.critters; const a=L.list||L.all||[];
            for (const c of a) if ((c.kind||c.type)==='warden') return [+c.pos.x.toFixed(2),+c.pos.z.toFixed(2), c.state, c.hp];
            return null; }""")
        pl.say("   warden at", json.dumps(w))
        if w: walk(pl, w[0], w[1], tol=0.8, max_ms=3000, tag="ram it", die_ok=True)
    pl.say("  ", json.dumps(g(pl)), "ev:", json.dumps(evsum(rec(pl))), json.dumps(critters(pl,12)[:1]))
    pl.shot("C_warden_rammed")

    # D — the camera inside the keep tower (owner P10)
    pl.say("== D. CAMERA INSIDE THE KEEP TOWER (0, 19.2, -3) ==")
    pl.tp(0, 19.4, -3.0); pl.wait(1600); pl.shot("D_inside_keep")
    pl.say("  ", json.dumps(g(pl)))
    for i in range(4):
        pl.tap("Q"); pl.wait(700); pl.shot("D_orbit_%d" % i)
        pl.say("   after Q: %s" % json.dumps(g(pl)))
    # walk around inside
    walk(pl, 2.5, -5.0, tol=1.0, max_ms=6000, tag="inside the keep")
    pl.shot("D_inside_walk")
    pl.say("  ", json.dumps(g(pl)))

    # E — look at the fort from outside, for stray geometry
    pl.say("== E. LOOK AT THE FORT ==")
    for name, pos, look in [
        ("E_from_south", (0, 14.0, 44.0), (0, -10)),
        ("E_from_east",  (40.0, 20.0, 0.0), (-10, 0)),
        ("E_from_north", (0, 24.0, -44.0), (0, 10)),
        ("E_from_west",  (-40.0, 20.0, 0.0), (10, 0)),
    ]:
        pl.js("([x,y,z]) => { const G=CRESTBOUND.game; G.__dev.noclip(true); G.__dev.tp(x,y,z); }", list(pos))
        pl.wait(900); pl.face(look[0], look[1]); pl.wait(900)
        pl.shot(name)
        pl.say("  ", name, json.dumps(g(pl)))
    pl.js("() => CRESTBOUND.game.__dev.noclip(false)")

run("p10", body)
