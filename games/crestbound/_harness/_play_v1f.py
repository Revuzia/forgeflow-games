"""VERDANT-1 leg F: lily pads, race pad, the mill arm, the fort stairs, long-jump repeats."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant1f")
    pl.goto("verdant-1"); pl.wait(1200)
    pl.ev("""()=>{ const G=CRESTBOUND.game; G.__deaths=[];
        G.player.events.on('death',(c)=>G.__deaths.push({c:String(c),
            p:[+G.player.pos.x.toFixed(1),+G.player.pos.y.toFixed(1),+G.player.pos.z.toFixed(1)]})); return 1;}""")

    print("\n=== LILY PADS (sinkers at x -32.0 and -36.5, top 1.70, water 1.40) ===")
    pl.tp(-29.5, 1.9, -8.0, W); pl.wait(700)
    print("   floating at the pad edge:", json.dumps(pl.st()))
    pl.rec_reset(); pl.down("w")
    for i in range(5): pl.tap("Space", 110); pl.wait(500)
    pl.release_all(); pl.wait(700)
    s = pl.st(); print("   hop at the pad -> [%.2f %.2f %.2f] state %s gr %s water %s" % (s["x"], s["y"], s["z"], s["st"], s["gr"], s["water"]))
    pl.shot("lilypad_hop")
    # stand on a pad and see it sink
    pl.tp(-32.0, 2.1, -8.0, W); pl.wait(400)
    ys = []
    for i in range(16):
        pl.wait(250); q = pl.st(); ys.append((round(q["y"], 2), q["st"], q["water"]))
    print("   standing on pad 1 for 4 s:", ys)
    pl.shot("lilypad_sinking")

    print("\n=== THE RACE PAD — walk slowly right over [0, 9.00, -15.5] ===")
    pl.tp(0, 9.6, -12.0, N); pl.wait(500)
    pl.rec_reset()
    trail = []
    pl.down("w")
    for i in range(16):
        pl.wait(180); q = pl.st(); trail.append((round(q["z"], 1),))
    pl.release_all(); pl.wait(800)
    r = pl.rec()
    print("   z trail:", [t[0] for t in trail])
    print("   events:", [e["e"] for e in r["events"]][:10],
          " raceMs:", pl.ev("()=>{const s=CRESTBOUND.game.__dev.state(); return s.raceMs;}"))
    pl.shot("race_pad_walk")
    hz = pl.ev("""()=>{ const C=CRESTBOUND.game.course; const out=[];
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind==='rings'||d.kind==='jumppad'||d.kind==='mill') continue;
          }
        return (C.volumes||[]).map(v=>({kind:v.kind, c:[+v.center.x.toFixed(1),+v.center.y.toFixed(1),+v.center.z.toFixed(1)],
            h:[+v.half.x.toFixed(1),+v.half.y.toFixed(1),+v.half.z.toFixed(1)], id:(v.props&&v.props.id)||null})); }""")
    print("   volumes on the course:", json.dumps(hz)[:1200])

    print("\n=== THE MILL — hub [38, 25.50, -6], arms 4, len 9.50, period 11 s ===")
    pl.tp(38.0, 16.5, -6.0, N); pl.wait(800)
    print("   under the hub:", json.dumps(pl.st()))
    pl.shot("mill_under_hub")
    # find where a deck actually is right now
    dk = pl.ev("""()=>{ const C=CRESTBOUND.game.course; const out=[];
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='mill') continue;
          for (const c of (h.colliders||[])) out.push([+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2),
                                                       +c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)]); }
        return out; }""")
    print("   mill deck colliders now:", json.dumps(dk))
    if dk:
        low = sorted(dk, key=lambda c: c[1])[0]
        pl.tp(low[0], low[1] + low[4] + 0.3, low[2], N); pl.wait(400)
        ride = []
        for i in range(20):
            pl.wait(300); q = pl.st(); ride.append((round(q["x"], 1), round(q["y"], 1), round(q["z"], 1), q["st"], q["gr"]))
        print("   rode the lowest arm 6 s:", ride)
        pl.shot("mill_ride")

    print("\n=== THE FORT STAIRS [-7.6, 9.00, -16.4] rise 0.30 x 18 ===")
    pl.tp(-7.6, 9.6, -13.5, N); pl.wait(500); pl.shot("fort_stairs_foot")
    pl.rec_reset(); pl.down("w"); pl.wait(3200); pl.release_all(); pl.wait(600)
    s = pl.st(); print("   ran at the stairs -> [%.1f %.1f %.1f] state %s" % (s["x"], s["y"], s["z"], s["st"]))
    pl.shot("fort_stairs_after")

    print("\n=== LONG JUMP x4 EACH WAY (courtyard, speed 9) ===")
    for label, yaw in (("west", W), ("east", E), ("north", N), ("south", S)):
        got = []
        for k in range(3):
            pl.tp(0, 9.6, -24.0, yaw); pl.wait(350); pl.rec_reset()
            pl.down("w"); pl.wait(950)
            pl.down("c"); pl.wait(70); pl.tap("Space", 110); pl.wait(150); pl.up("c")
            pl.wait(1300); pl.release_all(); pl.wait(300)
            r = pl.rec()
            got.append("LJ" if any(e["e"] == "longjump" for e in r["events"]) else
                       ("BF" if any(e["e"] == "backflip" for e in r["events"]) else "plain"))
        print("   %-6s -> %s" % (label, got))

    print("\n   deaths:", pl.ev("()=>CRESTBOUND.game.__deaths"))
    print("ERRORS:", errs[:10])
    br.close()
