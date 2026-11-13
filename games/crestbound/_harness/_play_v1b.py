"""VERDANT-1 leg B: the bridge lip that stopped me dead, and a clean chain-rhythm sweep."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant1")
    pl.goto("verdant-1"); pl.wait(1500)
    print("in:", json.dumps(pl.st()))

    print("\n=== THE BRIDGE LIP ===")
    for (x, label, key, ms) in [(0.0, "centre, full run", "w", 2600),
                                (1.2, "east side, full run", "w", 2600),
                                (-1.2, "west side, full run", "w", 2600)]:
        pl.tp(x, 2.6, 36, 0)
        pl.rec_reset(); pl.walk(key, ms); pl.wait(500)
        s = pl.st()
        print("   %-22s -> z %.2f y %.2f state %s" % (label, s["z"], s["y"], s["st"]))
    # walk in slowly (taps) instead of running
    pl.tp(0, 2.6, 33, 0); pl.wait(400)
    pl.rec_reset()
    for i in range(14):
        pl.walk("w", 130); pl.wait(90)
    s = pl.st(); print("   %-22s -> z %.2f y %.2f state %s" % ("centre, tap-walk", s["z"], s["y"], s["st"]))
    pl.shot("bridge_lip_after_tapwalk")
    # jump the lip
    pl.tp(0, 2.6, 34, 0); pl.wait(300)
    pl.rec_reset(); pl.down("w"); pl.wait(500); pl.tap("Space", 110); pl.wait(1200); pl.up("w"); pl.wait(400)
    s = pl.st(); print("   %-22s -> z %.2f y %.2f state %s" % ("run + one jump", s["z"], s["y"], s["st"]))
    pl.shot("bridge_lip_after_jump")
    # already on the deck: can he walk the deck at all?
    pl.tp(0, 2.45, 30.0, 0); pl.wait(400)
    pl.rec_reset(); pl.walk("w", 1400); pl.wait(400)
    s = pl.st(); print("   %-22s -> z %.2f y %.2f state %s" % ("placed on deck, walk", s["z"], s["y"], s["st"]))
    pl.shot("bridge_deck_walk")
    # measure the geometry a player is asked to step over
    geom = pl.ev("""()=>{ const G=CRESTBOUND.game, C=G.course, T=CRESTBOUND.THREE;
        const hf=(C.broadphase.heightfields||[])[0];
        const gy=(z)=>hf?+hf.heightAt(0,z).toFixed(3):null;
        const box=new T.Box3(new T.Vector3(-2,1.0,30.4),new T.Vector3(2,4.0,31.9));
        const cols=C.broadphase.query(box,[]).map(c=>({c:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)],
            h:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)],
            top:+(c.center.y+c.half.y).toFixed(3), bot:+(c.center.y-c.half.y).toFixed(3)}));
        return {ground:{z32:gy(32),z31_5:gy(31.5),z31:gy(31),z30_5:gy(30.5)}, cols}; }""")
    print("   geometry:", json.dumps(geom))

    print("\n=== CLEAN CHAIN-RHYTHM SWEEP (open meadow, running SOUTH, nothing to hit) ===")
    import math
    for gap in (420, 480, 540, 600, 660, 720, 800, 900, 1000):
        pl.tp(0, 2.6, 34, math.pi)
        pl.wait(250)
        r = pl.human_jump_chain(3, run_ms=1200, gap_ms=gap)
        js = [e.get("d") for e in r["events"] if e["e"] == "jump"]
        print("   gap %4d ms -> jumpCount %d  %s  apex %.2f  maxSpeed %.1f" %
              (gap, r["maxJump"], js, r["maxY"] - 2.0, r["maxSpeed"]))
    pl.shot("chain_sweep_end")

    print("\n=== THE SIGN SAYS 'LAND AND JUMP AGAIN TO CHAIN A HIGHER ONE' — can I read it? ===")
    pl.tp(6.0, 2.6, 42.0, 0); pl.wait(300)
    pl.face_toward(9.5, 39.0)
    pl.wait(600); pl.shot("spawn_sign_from_a_players_feet")

    print("\nERRORS:", errs[:8])
    br.close()
