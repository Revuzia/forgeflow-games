"""GNASHER FORT phase 2 — the real walk: shore -> causeway sinkers -> quay, plus water."""
import sys, os, json, math, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _play_gnasher import enter, rec_on, rec, evsum
from _pgutil import walk, critters, hazards, jump, pound, look

try:
  with Play("gnasher2") as pl:
    enter(pl)
    rec_on(pl)
    pl.shot("spawn")
    pl.say("CRITTERS near spawn:", json.dumps(critters(pl, 40)))
    pl.say("HAZARDS near spawn:", json.dumps(hazards(pl, 30)))

    # 1. walk the mown path to the south quay
    pl.say("== 1. spawn -> south quay deck (0, 46.8) ==")
    r = walk(pl, 0, 47.5, tol=1.6, max_ms=16000, tag="south quay")
    pl.shot("south_quay")
    pl.say("  ev:", json.dumps(evsum(rec(pl))))

    # 2. the IRON HAT (metal power) sits on the quay at 4.6,46.8
    pl.say("== 2. the iron hat (4.6, 1.60, 46.8) ==")
    r = walk(pl, 4.6, 46.8, tol=1.0, max_ms=10000, tag="iron hat")
    pw = pl.js("() => { const P=CRESTBOUND.game.player; return {power:P.power, powerT:P.powerT, powers: (CRESTBOUND.game.course.powers && (CRESTBOUND.game.course.powers.list||[]).map(x=>({k:x.kind,taken:x.taken,p:[x.pos&&+x.pos.x.toFixed(1),x.pos&&+x.pos.y.toFixed(1),x.pos&&+x.pos.z.toFixed(1)]}))) || null}; }")
    pl.say("  power:", json.dumps(pw), "ev:", json.dumps(evsum(rec(pl))))
    pl.shot("iron_hat")

    # 3. step onto sinker A and watch it sink
    pl.say("== 3. SINKER A at z 41.6 — stand on it and watch ==")
    walk(pl, 0, 44.0, tol=1.2, max_ms=8000, tag="quay lip")
    pl.face(0, 30)
    ys = []
    pl.down("W")
    for i in range(14):
        pl.wait(400)
        st = pl.state()
        ys.append((round(st["pos"][2],2), round(st["pos"][1],2), st["pstate"], st["surface"], st["inWater"]))
        if i == 4: pl.up("W")
    pl.up("W"); pl.wait(400)
    pl.say("  sinker trail z,y,state,surface,water:", json.dumps(ys))
    pl.shot("sinker_A")
    pl.say("  ev:", json.dumps(evsum(rec(pl))))

    # 4. deliberately fall in the moat — swim, look at the surface vs the rim, get out
    pl.say("== 4. THE MOAT: swim, surface height, can I get out? ==")
    pl.tp(6.0, 3.0, 40.0); pl.wait(1200)
    st = pl.state()
    pl.say("  dropped at (6,3,40) ->", json.dumps(st))
    pl.shot("moat_drop")
    for i in range(6):
        pl.wait(700)
        st = pl.state()
        pl.say("   t=%d %s %s water=%s sub=%s" % (i, st["pos"], st["pstate"], st["inWater"], st["submerged"]))
    pl.shot("moat_float")
    wy = pl.js("""() => { const C=CRESTBOUND.game.course; const w=(C.waters&&(C.waters.list||C.waters))||[];
        return (w.map ? w : []).map(x => ({y: x.surfaceY!==undefined?x.surfaceY:(x.y!==undefined?x.y:(x.pos&&x.pos.y)), keys:Object.keys(x).slice(0,25)})); }""")
    pl.say("  water objects:", json.dumps(wy))
    # swim to the shore and climb out
    pl.say("  -- swim to the south shore (0, 49) --")
    r = walk(pl, 0, 49.5, tol=2.0, max_ms=20000, tag="swim out")
    pl.shot("moat_climbout")
    pl.say("  ev:", json.dumps(evsum(rec(pl))))

    pl.dump("gnasher_p2")
    print("CONSOLE:", json.dumps(pl.console[:25]))
    print("DONE")
except Exception:
    traceback.print_exc(); print("DONE")
