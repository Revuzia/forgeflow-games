"""PLAYTEST - VERDANT-3: is the REQUIRED north bank (cp-northbank -> the wheat terraces) walkable?

The course header claims 'the bank -> the terraces 24.8 deg' and 'TUNE.slope.slideDeg is 38, so
nothing required slides'. A held W out of cp-northbank measured slopeSlide and 20 'slide' events.
This driver settles it: real keys, several lines up the bank, with and without a jump, plus the
heightfield's own slope read straight off the live Heightfield.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _wmlib import install

with Play("wm_bank") as pl:
    install(pl)
    pl.enter("verdant-3")

    def full():
        return pl.js("""()=>{const G=CRESTBOUND.game,P=G.player;return {p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
            st:P.state, sp:+P.speed.toFixed(2), gr:!!P.grounded, surf:P.surface||null};}""")

    def tp(x, y, z):
        pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [x, y, z]); pl.wait(700)

    pl.say("=== THE LIVE HEIGHTFIELD along the cart track x = 0, z = 22 -> 0 ===")
    prof = pl.js("""()=>{const C=CRESTBOUND.game.course; const hfs=(C.broadphase&&C.broadphase.heightfields)||[];
        const out=[]; for (let z=22; z>=-1.001; z-=0.5) { let y=NaN;
          for (const h of hfs) { const v=h.heightAt(0,z); if (v===v) { y=v; break; } }
          out.push([z, y===y?+y.toFixed(2):null]); } return out; }""")
    pl.say("  " + json.dumps(prof))
    worst = None
    for i in range(1, len(prof)):
        z0, y0 = prof[i - 1]; z1, y1 = prof[i]
        if y0 is None or y1 is None:
            continue
        deg = math.degrees(math.atan2(y1 - y0, 0.5))
        if worst is None or deg > worst[0]:
            worst = (deg, z0, z1, y0, y1)
    if worst:
        pl.say("  STEEPEST 0.5 m step on the required cart track: %.1f deg  (z %.1f -> %.1f, y %.2f -> %.2f).  TUNE.slope.slideDeg = 38."
               % worst)
    pl.say("  bands over 38 deg:")
    for i in range(1, len(prof)):
        z0, y0 = prof[i - 1]; z1, y1 = prof[i]
        if y0 is None or y1 is None:
            continue
        deg = math.degrees(math.atan2(y1 - y0, 0.5))
        if deg > 38:
            pl.say("    z %.1f -> %.1f   %.2f -> %.2f   %.1f deg" % (z0, z1, y0, y1, deg))

    pl.say("")
    pl.say("=== ATTEMPT 1  stand on cp-northbank and just hold W (what a player does) ===")
    tp(0, 3.3, 20.4)
    pl.say("  start:", json.dumps(full())); pl.shot("bank_start")
    pl.aim(0, 0)
    pl.down("W")
    tr = []
    for i in range(20):
        pl.wait(400); q = full(); tr.append([q["p"], q["st"], q["sp"]])
    pl.up("W"); pl.wait(700)
    pl.say("  8 s of held W:", json.dumps(tr))
    pl.say("  ->", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("bank_holdW")

    pl.say("")
    pl.say("=== ATTEMPT 2  run at it and JUMP (slope.recoverJumpV = 10.5) ===")
    tp(0, 3.3, 20.4)
    pl.aim(0, 0)
    pl.down("W")
    tr = []
    for i in range(20):
        pl.wait(320)
        if i % 3 == 0:
            pl.down("SPACE"); pl.wait(120); pl.up("SPACE")
        q = full(); tr.append([q["p"], q["st"]])
    pl.up("W"); pl.wait(700)
    pl.say("  jumping up it:", json.dumps(tr))
    pl.say("  ->", json.dumps(full()), "events", pl.ev())
    pl.shot("bank_jump")

    pl.say("")
    pl.say("=== ATTEMPT 3  try either side of the track: x = -8 and x = +8 ===")
    for x in (-8.0, 8.0, -16.0, 16.0):
        tp(x, 3.3, 21.0)
        pl.aim(x, 2.0)
        pl.down("W"); pl.wait(6500); pl.up("W"); pl.wait(700)
        q = full()
        pl.say("  x=%+5.1f -> %s  (needs z < 10 and grounded to count)" % (x, json.dumps(q)))
        pl.shot("bank_x%+d" % int(x))

    pl.say("")
    pl.say("=== ATTEMPT 4  from the top down: is it a one-way slide? ===")
    tp(0, 11.0, 6.0)
    pl.say("  wheat field:", json.dumps(full()))
    pl.aim(0, 22)
    pl.down("W"); pl.wait(5000); pl.up("W"); pl.wait(900)
    pl.say("  walking DOWN the bank ->", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("bank_down")
    pl.say("  now turn round and walk back UP:")
    pl.aim(0, 0)
    pl.down("W"); pl.wait(8000); pl.up("W"); pl.wait(900)
    pl.say("  ->", json.dumps(full()), "events", pl.ev())
    pl.shot("bank_backup")


    pl.say("")
    pl.say("=== ARE THE MILLS ACTUALLY TURNING? sample every mill's lowest deck twice ===")
    def mills():
        return pl.js("""()=>{const C=CRESTBOUND.game.course; const out=[];
            for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='mill') continue;
              let lo=null; for (const c of (h.colliders||[])) { if(c.half.y>1.0) continue;
                if(!lo||c.center.y<lo[1]) lo=[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)]; }
              out.push({axis:d.p, period:d.period, lowest:lo, ncol:(h.colliders||[]).length}); }
            return {clock:+C.clock.toFixed(2), mills:out}; }""")
    a = mills(); pl.say("  t0: " + json.dumps(a))
    pl.wait(2500)
    b = mills(); pl.say("  t1: " + json.dumps(b))
    for i, (m0, m1) in enumerate(zip(a["mills"], b["mills"])):
        if m0["lowest"] and m1["lowest"]:
            d = math.dist(m0["lowest"], m1["lowest"])
            pl.say("   mill %d axis %s period %s : lowest deck moved %.2f m in %.2f s" %
                   (i + 1, m0["axis"], m0["period"], d, b["clock"] - a["clock"]))

    pl.say("")
    pl.say("=== RIDE MILL 1 THE WAY A PLAYER WOULD: stand where its deck passes and wait ===")
    lo = mills()["mills"][0]["lowest"]
    pl.say("  mill 1 lowest deck now at " + json.dumps(lo))
    tp(lo[0], lo[1] + 0.9, lo[2])
    tr = []
    for i in range(20):
        pl.wait(400); q = full(); tr.append([q["p"], q["st"], q["gr"]])
    pl.say("  8 s on mill 1: " + json.dumps(tr))
    pl.say("  ->", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("mill1_ride")

    pl.dump("wm_bank")
    pl.say("CONSOLE:", json.dumps(pl.console[:20]))
