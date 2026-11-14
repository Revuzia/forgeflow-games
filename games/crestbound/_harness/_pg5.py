"""GNASHER FORT phase 5 — the causeway sinkers, the stair, the gnasher gate, the secret cage."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk, critters, dismiss_card, st2, trail, collstate
from _pgrun import run

def body(pl):
    rec_on(pl)

    # ---- 1. THE CAUSEWAY: actually run it, jumping the sinkers
    pl.say("== 1. THE CAUSEWAY: run the two sinkers south->north ==")
    pl.tp(0, 1.55, 47.0); pl.wait(1200)
    pl.face(0, 30)
    pl.shot("1_causeway_from_quay")
    pl.down("W"); pl.wait(500)
    pl.tap("SPACE", 200); pl.wait(600)            # quay -> sinker A
    a = st2(pl); pl.say("  after jump1:", json.dumps(a))
    pl.shot("1_on_sinkerA")
    pl.wait(700)
    pl.tap("SPACE", 200); pl.wait(700)            # A -> B
    b = st2(pl); pl.say("  after jump2:", json.dumps(b))
    pl.shot("1_on_sinkerB")
    pl.tap("SPACE", 200); pl.wait(900)            # B -> north quay
    c = st2(pl); pl.up("W"); pl.wait(400)
    pl.say("  after jump3:", json.dumps(st2(pl)))
    pl.shot("1_north_quay")
    pl.say("  ev:", json.dumps(evsum(rec(pl))))

    # ---- 2. the stair up to the bailey
    pl.say("== 2. THE CAUSEWAY STAIR (quay 1.55 -> bailey 6.25) ==")
    pl.tp(0, 1.55, 32.6); pl.wait(1000)
    pl.shot("2_stair_from_quay")
    r = walk(pl, 0, 25.6, tol=1.5, max_ms=16000, tag="up the stair")
    pl.say("   ", json.dumps(st2(pl)))
    pl.shot("2_top_of_stair")
    pl.say("  ev:", json.dumps(evsum(rec(pl))))

    # ---- 3. THE GNASHER GATE: stand in the middle lane, do they reach me?
    pl.say("== 3. GNASHER GATE: stand in the 3 m lane at (0, 6.5, 25) for 14 s ==")
    pl.tp(0, 6.6, 25.0); pl.wait(1200)
    pl.face(0, 18)
    pl.shot("3_gate_lane")
    for i in range(10):
        pl.wait(1400)
        s = st2(pl)
        cr = critters(pl, 16)
        pl.say("   t=%d %s d=%d near=%s" % (i, s["p"], s["d"], json.dumps(cr)))
    pl.shot("3_gate_lane_after")
    pl.say("  ev:", json.dumps(evsum(rec(pl))))

    # ---- 4. walk INTO the west gnasher's disc deliberately
    pl.say("== 4. walk into the WEST gnasher's reach (-7, 23) ==")
    pl.tp(0, 6.6, 26.0); pl.wait(1000)
    r = walk(pl, -6.0, 24.0, tol=1.5, max_ms=9000, tag="into the west jaw", die_ok=True)
    pl.wait(2500)
    pl.say("   ", json.dumps(st2(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("4_west_jaw")

    # ---- 5. POUND THE WEST POST three times
    pl.say("== 5. POUND THE WEST POST (-7.0, 5.40, 26.5) x3 ==")
    pl.tp(0, 6.6, 26.4); pl.wait(900)
    for k in range(5):
        pl.tp(-7.0, 8.6, 26.5); pl.wait(700)
        pl.tap("SPACE", 160); pl.wait(280)
        pl.down("C"); pl.wait(900); pl.up("C"); pl.wait(1100)
        s = st2(pl)
        ev = evsum(rec(pl))
        pl.say("   pound %d -> %s ev=%s" % (k + 1, json.dumps(s), json.dumps(ev)))
        pl.shot("5_pound_%d" % (k + 1))
        flags = pl.js("() => { const f=CRESTBOUND.game.save.flags; return {freed: !!f.get('gnasher-freed'), east: !!f.get('gnasher-east-freed')}; }")
        pl.say("   flags:", json.dumps(flags))
        if flags["freed"]:
            break

    # ---- 6. the secret cage under the stair (-4.2, 4.60, 29.8)
    pl.say("== 6. THE SECRET CAGE (-4.2, 4.60, 29.8) ==")
    pl.tp(-4.2, 7.0, 31.5); pl.wait(1200)
    pl.shot("6_cage_before")
    pl.say("   ", json.dumps(st2(pl)))
    r = walk(pl, -4.2, 29.8, tol=1.4, max_ms=9000, tag="to the cage")
    pl.shot("6_cage_at")
    # pound the cage
    for k in range(3):
        pl.tap("SPACE", 160); pl.wait(280)
        pl.down("C"); pl.wait(900); pl.up("C"); pl.wait(1200)
        pl.say("   cage pound %d: %s ev=%s" % (k+1, json.dumps(st2(pl)), json.dumps(evsum(rec(pl)))))
    pl.shot("6_cage_after")
    pl.say("  coll:", json.dumps(collstate(pl)))
    dismiss_card(pl)

run("p5", body)
