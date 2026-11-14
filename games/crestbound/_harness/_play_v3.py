"""VERDANT-3 WINDMILL HEIGHTS — the route, the mills, the belts, the races, the cannon."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant3")
    pl.goto("verdant-3"); pl.wait(1500)
    pl.ev("""()=>{ const G=CRESTBOUND.game; G.__deaths=[];
        G.player.events.on('death',(c)=>G.__deaths.push({c:String(c),
            p:[+G.player.pos.x.toFixed(1),+G.player.pos.y.toFixed(1),+G.player.pos.z.toFixed(1)]})); return 1;}""")
    print("spawn:", json.dumps(pl.st())); pl.shot("spawn_windmill_heights")

    def hold(label, x, y, z, yaw, ms, key="w", shot=None, samples=0):
        pl.tp(x, y, z, yaw); pl.wait(350); pl.rec_reset()
        pl.down(key); tr = []
        if samples:
            for i in range(samples):
                pl.wait(ms // samples); q = pl.st()
                tr.append((round(q["x"], 1), round(q["y"], 1), round(q["z"], 1), q["st"]))
        else:
            pl.wait(ms)
        pl.release_all(); pl.wait(500)
        s = pl.st(); r = pl.rec()
        print("   %-32s -> [%.1f %.1f %.1f] %s gr=%s ev=%s" %
              (label, s["x"], s["y"], s["z"], s["st"], s["gr"], [e["e"] for e in r["events"]][:8]))
        if tr: print("        trail", tr)
        if shot: pl.shot(shot)
        return s, r

    print("\n=== BEAT 1: the south bank and the river logs ===")
    hold("run north to the river", 0, 2.4, 46, N, 3600, shot="river_run", samples=9)
    pl.tp(0, 1.0, 30, N); pl.wait(700)
    print("   dropped in the river:", json.dumps(pl.st()))
    pl.shot("in_the_river")
    pl.rec_reset(); pl.down("w")
    got = None
    for i in range(32):
        pl.wait(250); q = pl.st()
        if q["gr"] and not q["water"]: got = q; break
    pl.release_all(); pl.wait(400)
    print("   swim north out ->", json.dumps(got) if got else "NEVER GOT OUT: " + json.dumps(pl.st()))
    pl.shot("river_exit")

    print("\n=== THE JETTY + CHECKPOINTS ===")
    for cid, pos, yaw in (("cp-northbank", (0, 2.60, 20.4), N), ("cp-granary", (4, 13.60, -14), N),
                          ("cp-ridge", (-4, 19.20, -30), S), ("cp-yard", (22, 23.60, -44), N)):
        pl.tp(pos[0], pos[1] + 0.7, pos[2] + 2.6, yaw); pl.wait(350); pl.rec_reset()
        pl.walk("w", 1000); pl.wait(700)
        s = pl.st()
        print("   %-14s -> cp %s at [%.1f %.1f %.1f] %s" % (cid, s["cp"], s["x"], s["y"], s["z"], s["st"]))
    pl.shot("v3_checkpoints")

    print("\n=== THE HAY BELTS (conveyors, terrace) ===")
    pl.tp(7.0, 11.2, 2.0, N); pl.wait(700); pl.shot("belt_approach")
    print("   at the belt:", json.dumps(pl.st()))
    pl.rec_reset()
    tr = []
    for i in range(14):
        pl.wait(300); q = pl.st(); tr.append((round(q["x"], 1), round(q["y"], 1), round(q["z"], 1), q["st"]))
    print("   standing on the belt 4 s:", tr)
    pl.shot("belt_carried")

    print("\n=== THE MILLS — is a sail actually turning? ===")
    for tag in ("a", "b"):
        cols = pl.ev("""()=>{ const C=CRESTBOUND.game.course; const out=[];
            for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='mill') continue;
              const c=(h.colliders||[])[4]; if(c) out.push([+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)]); }
            return out; }""")
        print("   sample %s (t=%s): %s" % (tag, pl.ev("()=>+CRESTBOUND.game.course.clock.toFixed(2)"), json.dumps(cols)))
        pl.wait(2500)
    # ride the great mill's lowest gondola
    dk = pl.ev("""()=>{ const C=CRESTBOUND.game.course; let best=null;
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='mill') continue;
          for (const c of (h.colliders||[])) { if(c.half.y>1.0) continue;
            if(!best || c.center.y<best[1]) best=[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2),+c.half.y.toFixed(2)]; } }
        return best; }""")
    print("   lowest mill deck:", json.dumps(dk))
    if dk:
        pl.tp(dk[0], dk[1] + dk[3] + 0.25, dk[2], N); pl.wait(400)
        ride = []
        for i in range(16):
            pl.wait(350); q = pl.st(); ride.append((round(q["x"], 1), round(q["y"], 1), round(q["z"], 1), q["st"], q["gr"]))
        print("   rode it 5.6 s:", ride)
        pl.shot("mill_ride_v3")

    print("\n=== THE CANNON [14.0, 23.10, -40.0] ===")
    pl.tp(14.0, 23.8, -37.5, N); pl.wait(600); pl.shot("cannon_approach")
    pl.rec_reset(); pl.down("w"); pl.wait(1400); pl.release_all(); pl.wait(500)
    pl.tap("e", 120); pl.wait(2500)
    s = pl.st(); r = pl.rec()
    print("   walked in + pressed E -> [%.1f %.1f %.1f] %s events %s" % (s["x"], s["y"], s["z"], s["st"], [e["e"] for e in r["events"]][:8]))
    pl.shot("cannon_after")

    print("\n=== THE RACES: volumes on this course ===")
    vols = pl.ev("""()=>(CRESTBOUND.game.course.volumes||[]).map(v=>({k:v.kind,
        c:[+v.center.x.toFixed(1),+v.center.y.toFixed(1),+v.center.z.toFixed(1)], id:(v.props&&v.props.id)||null}))""")
    print("   ", json.dumps(vols)[:1400])
    print("   walk over the MILLRACE start [0, 10.20, 2.0]")
    pl.tp(0, 10.9, 6.0, N); pl.wait(400); pl.rec_reset()
    pl.walk("w", 1400); pl.wait(800)
    print("   -> raceMs", pl.ev("()=>CRESTBOUND.game.__dev.state().raceMs"), "events", [e["e"] for e in pl.rec()["events"]][:6])
    print("   walk over the BELL STAIR start [4, 19.60, -30.0]")
    pl.tp(4, 20.3, -26.0, S); pl.wait(400); pl.rec_reset()
    pl.walk("w", 1400); pl.wait(800)
    print("   -> raceMs", pl.ev("()=>CRESTBOUND.game.__dev.state().raceMs"), "events", [e["e"] for e in pl.rec()["events"]][:6])
    pl.shot("race_pads_v3")

    print("\n=== THE OPEN CREST — CREST ABOVE THE SAILS [47.0, 37.40, -48.0] ===")
    pl.tp(45.0, 36.4, -48.0, E); pl.wait(700); pl.shot("sky_platform")
    print("   on the sky platform:", json.dumps(pl.st()))
    pl.rec_reset(); pl.down("w"); pl.wait(500); pl.tap("Space", 120); pl.wait(1600); pl.release_all(); pl.wait(2200)
    s = pl.st(); print("   crest attempt -> crests %s gs %s" % (s["crests"], s["gs"]))
    pl.shot("sky_crest")

    print("\n   deaths:", pl.ev("()=>CRESTBOUND.game.__deaths"))
    print("ERRORS:", errs[:10])
    br.close()
