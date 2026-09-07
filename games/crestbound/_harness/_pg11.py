"""GNASHER FORT phase 11 — verify the two blocker claims from more angles."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk
from _pgrun import run

def g(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)], st:P.state,
      gr:!!P.grounded, d:G.deaths }; }""")

def push(pl, start, tz, secs=6, tag=""):
    pl.tp(*start); pl.wait(900)
    pl.face(start[0], tz)
    pl.down("W"); pl.wait(int(secs*1000)); pl.up("W"); pl.wait(400)
    s = g(pl)
    pl.say("  %-46s from %s -> %s" % (tag, list(start), json.dumps(s)))
    return s

def body(pl):
    rec_on(pl)
    pl.say("== A. OUTER WALL SOUTH GATEWAY: push north at several x, from the bailey ==")
    for x in (-2.0, -1.0, 0.0, 1.0, 2.0):
        push(pl, (x, 7.0, 25.5), -10.0, 6, "south door x=%+.1f (door is w 5.0 centred x 0)" % x)
    pl.shot("A_south_door")

    pl.say("== B. from INSIDE the outer wall, push SOUTH out through the same gateway ==")
    for x in (0.0, 1.5):
        push(pl, (x, 4.4, 18.0), 30.0, 6, "inside -> out, x=%+.1f" % x)
    pl.shot("B_inside_out")

    pl.say("== C. the outer wall's NORTH door (w 3.4, h 4.2) ==")
    push(pl, (0.0, 4.4, -18.0), -30.0, 6, "inside -> north door")
    pl.shot("C_north_door")
    push(pl, (0.0, 12.6, -26.0), 10.0, 6, "outside north -> in")
    pl.shot("C_north_out")

    pl.say("== D. THE PORTCULLIS from the COURT side (north -> south) ==")
    push(pl, (0.0, 19.3, 6.0), 20.0, 6, "court -> portcullis from the north")
    pl.shot("D_pc_from_court")
    f = pl.js("() => ({up: !!CRESTBOUND.game.save.flags.get('portcullis-up')})")
    pl.say("  flag:", json.dumps(f), "ev:", json.dumps(evsum(rec(pl))))

    pl.say("== E. the MIDDLE wall's south doorway (w 3.6 h 4.0, floor 17.20) ==")
    for y in (17.6, 18.4, 19.4):
        push(pl, (0.0, y, 12.0), -10.0, 6, "middle door at y=%.1f" % y)
    pl.shot("E_middle_door")

run("p11", body)
