"""GNASHER FORT phase 6 — CAN YOU CLIMB THE STAIRS? four flights, measured."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk, dismiss_card, st2
from _pgrun import run

def gsnap(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      st:P.state, gr:!!P.grounded,
      n:[+P.groundNormal.x.toFixed(3),+P.groundNormal.y.toFixed(3),+P.groundNormal.z.toFixed(3)],
      deg:+ (Math.acos(Math.max(-1,Math.min(1,P.groundNormal.y)))*180/Math.PI).toFixed(1),
      sf:P.surface, d:G.deaths }; }""")

def climb(pl, name, start, target, secs=12, shotname=None):
    pl.say("== %s : from %s toward %s ==" % (name, start, target))
    pl.tp(*start); pl.wait(1000)
    pl.face(target[0], target[1])
    if shotname: pl.shot(shotname + "_before")
    pl.down("W")
    tr = []
    n = int(secs * 1000 / 300)
    for i in range(n):
        pl.wait(300)
        tr.append(gsnap(pl))
    pl.up("W"); pl.wait(400)
    ev = evsum(rec(pl))
    end = gsnap(pl)
    if shotname: pl.shot(shotname + "_after")
    ys = [t["p"][1] for t in tr]
    pl.say("  y: %.2f -> %.2f (max %.2f)  end=%s" % (start[1], end["p"][1], max(ys), json.dumps(end)))
    pl.say("  slopes seen (deg):", json.dumps(sorted(set(t["deg"] for t in tr))))
    pl.say("  states:", json.dumps(sorted(set(t["st"] for t in tr))))
    pl.say("  ev:", json.dumps(ev))
    pl.say("  trail:", json.dumps([[t["p"], t["st"], t["deg"]] for t in tr]))
    return end

def body(pl):
    rec_on(pl)
    # 1 — THE CAUSEWAY STAIR: cp-quay -> the bailey.  authored 38.66 deg
    climb(pl, "1 CAUSEWAY STAIR (38.66 deg)", (0, 1.60, 32.9), (0, 25.6), 12, "1_causeway_stair")
    # 2 — ROUTE A gate stair, bailey -> outer walk.  authored 35.17 deg
    climb(pl, "2 GATE STAIR route A (35.17 deg)", (10.0, 7.2, 24.4), (3.0, 24.4), 12, "2_gate_stair")
    # 3 — THE GRAND GATE STAIR, bailey -> the middle wall's door.  authored 38.98 deg
    climb(pl, "3 GRAND GATE STAIR (38.98 deg)", (0, 7.0, 24.2), (0, 10.4), 16, "3_grand_stair")
    # 4 — THE KEEP GALLERY STAIR, court -> gallery.  authored 40.04 deg
    climb(pl, "4 KEEP GALLERY STAIR (40.04 deg)", (6.4, 19.2, 4.4), (6.4, -1.0), 12, "4_gallery_stair")
    # 5 — the west bailey ring path, which pound-testing kept sliding off
    climb(pl, "5 BAILEY RING WEST path (-8,25)->(-16,18)", (-8.0, 6.6, 25.0), (-16.0, 18.0), 12, "5_bailey_ring")
    # 6 — walk INTO the fort's south doorway from the bailey
    climb(pl, "6 SOUTH GATEWAY of the outer wall", (0, 7.0, 26.0), (0, 18.0), 14, "6_south_gate")

run("p6", body)
