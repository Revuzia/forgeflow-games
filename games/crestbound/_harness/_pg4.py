"""GNASHER FORT phase 4 — the moat, carefully: current strength, can you get out,
does the iron hat sink you, is the drowned crest and the moat-floor sigil gettable."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_gnasher import rec_on, rec, evsum
from _pgutil import walk, critters
from _pgrun import run

def snap(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      v:[+P.vel.x.toFixed(2),+P.vel.y.toFixed(2),+P.vel.z.toFixed(2)],
      st:P.state, gr:!!P.grounded, w:!!P.inWater, sub:!!P.submerged,
      power:P.power, pt: G.power ? +G.power.t.toFixed(1) : null, d:G.deaths }; }""")

def coll(pl):
    return pl.js("""() => { const C=CRESTBOUND.game.course.collectibles; if(!C) return null;
      return { counts: C.counts,
        crests: (C.crests||[]).map(c=>({id:c.id, present:!!c.present, ghost:!!c.ghost,
          taken: !!(c.taken||c.collected||c.done), home: c.home?[+c.home.x.toFixed(2),+c.home.y.toFixed(2),+c.home.z.toFixed(2)]:null})) }; }""")

def body(pl):
    rec_on(pl)
    pl.say("collectibles at start:", json.dumps(coll(pl)))

    # ---- 1. WALK off the north end of the south quay into the moat, like a missed sinker
    pl.say("== 1. miss the first sinker: run north off the south quay ==")
    pl.tp(0, 1.55, 46.0); pl.wait(900)
    pl.face(0, 30)
    pl.down("W")
    tr = []
    for i in range(30):
        pl.wait(300); s = snap(pl); tr.append([s["p"], s["st"], s["gr"], s["w"], s["d"]])
        if i == 8: pl.up("W")
    pl.up("W"); pl.wait(300)
    pl.say("  trail:", json.dumps(tr))
    pl.shot("1_fell_in")

    # ---- 2. current strength with NO input, sampled
    pl.say("== 2. CURRENT with zero input, 8 s ==")
    pl.tp(-8.0, 0.5, 39.5); pl.wait(2500)
    xs = []
    for i in range(16):
        pl.wait(500); s = snap(pl); xs.append([s["p"][0], s["p"][1], s["p"][2], s["st"]])
    pl.say("  drift:", json.dumps(xs))
    pl.shot("2_current_drift")

    # ---- 3. can I swim WEST, against the current?
    pl.say("== 3. swim WEST against the current from (8,-0.9,39.5) ==")
    pl.tp(8.0, 0.2, 39.5); pl.wait(2200)
    pl.face(-40, 39.5)
    pl.down("W")
    ws = []
    for i in range(20):
        pl.wait(400); s = snap(pl); ws.append([s["p"][0], s["p"][1], s["p"][2], s["st"]])
    pl.up("W"); pl.wait(300)
    pl.say("  westward:", json.dumps(ws))
    pl.shot("3_swim_west")

    # ---- 4. GET OUT: swim south to the shore and climb the bank
    pl.say("== 4. GET OUT of the moat onto the south shore ==")
    pl.tp(0, 0.2, 42.0); pl.wait(2200)
    r = walk(pl, 0, 50.0, tol=2.5, max_ms=25000, tag="swim to south shore")
    pl.say("   ", json.dumps(snap(pl)))
    pl.shot("4_at_shore")
    pl.say("  -- push W + SPACE into the bank, sampling --")
    pl.face(0, 56)
    out = []
    for i in range(10):
        pl.down("W"); pl.wait(500); pl.tap("SPACE", 160); pl.wait(700)
        s = snap(pl); out.append([s["p"], s["st"], s["gr"], s["w"]])
        if not s["w"] and s["gr"]: break
    pl.up("W"); pl.wait(400)
    pl.say("  climb-out:", json.dumps(out))
    pl.shot("4_climbed_out")

    # ---- 5. the IRON HAT: does it sink me?
    pl.say("== 5. IRON HAT: take it, then step into the water ==")
    pl.tp(0, 2.3, 53); pl.wait(1000)
    walk(pl, 4.6, 46.8, tol=1.2, max_ms=12000, tag="hat")
    pl.say("   after hat:", json.dumps(snap(pl)))
    pl.tp(0, 1.55, 45.5); pl.wait(800)
    pl.face(0, 30)
    pl.down("W")
    mt = []
    for i in range(18):
        pl.wait(400); s = snap(pl); mt.append([s["p"], s["st"], s["gr"], s["sub"], s["power"], s["pt"]])
        if i == 6: pl.up("W")
    pl.up("W"); pl.wait(300)
    pl.say("  metal-in-water:", json.dumps(mt))
    pl.shot("5_metal_water")

    # ---- 6. the DROWNED CREST at (0,-1.40,39.5) — swim to it
    pl.say("== 6. DROWNED CREST (0,-1.40,39.5) ==")
    pl.tp(-6.0, -1.0, 39.5); pl.wait(1500)
    pl.down("C")     # dive
    pl.face(0, 39.5)
    pl.down("W")
    ct = []
    for i in range(14):
        pl.wait(350); s = snap(pl); ct.append([s["p"], s["st"], s["sub"]])
    pl.up("W"); pl.up("C"); pl.wait(600)
    pl.say("  approach:", json.dumps(ct))
    pl.say("  ev:", json.dumps(evsum(rec(pl))), "coll:", json.dumps(coll(pl)))
    pl.shot("6_drowned_crest")

    # ---- 7. MOAT SIGIL 1 at (14.0,-1.00,34.0)
    pl.say("== 7. MOAT SIGIL 1 (14,-1.00,34) ==")
    pl.tp(14.0, -0.6, 36.5); pl.wait(1500)
    pl.down("C"); pl.face(14, 34)
    pl.down("W")
    for i in range(12):
        pl.wait(350)
    pl.up("W"); pl.up("C"); pl.wait(600)
    pl.say("   ", json.dumps(snap(pl)), "ev:", json.dumps(evsum(rec(pl))))
    pl.say("   sigil count:", json.dumps(coll(pl)["counts"]))
    pl.shot("7_moat_sigil")

run("p4", body)
