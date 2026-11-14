"""VERDANT-1 leg E: the pond shelf, the deaths, the long jump on real ground,
the gnasher post, the mill ride, the race pad, the warden, a bumbler."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant1e")
    pl.goto("verdant-1"); pl.wait(1200)
    # watch every death cause
    pl.ev("""()=>{ const G=CRESTBOUND.game; G.__deaths=[];
        G.player.events.on('death',(c)=>G.__deaths.push({c:String(c),
            p:[+G.player.pos.x.toFixed(1),+G.player.pos.y.toFixed(1),+G.player.pos.z.toFixed(1)]}));
        return 1; }""")

    print("\n=== THE POND SHELF ===")
    pl.tp(-26.0, 3.4, -8.0, W); pl.wait(500)
    trail = []
    pl.rec_reset(); pl.down("w")
    for i in range(26):
        pl.wait(250); s = pl.st()
        trail.append((round(s["x"], 2), round(s["y"], 2), s["st"], s["gr"], s["water"], s["sp"]))
    pl.release_all(); pl.wait(400)
    print("   holding W west into the pond (x, y, state, grounded, inWater, speed):")
    for t in trail: print("     ", t)
    print("   deaths so far:", pl.ev("()=>CRESTBOUND.game.__deaths"))
    pl.shot("pond_shelf_stuck")
    # can jump get him off the shelf?
    pl.rec_reset(); pl.down("w")
    for i in range(6): pl.tap("Space", 110); pl.wait(500)
    pl.release_all(); pl.wait(500)
    s = pl.st(); print("   jumping while stuck -> [%.2f %.2f] state %s gr %s water %s" % (s["x"], s["y"], s["st"], s["gr"], s["water"]))
    pl.shot("pond_shelf_after_jumps")
    # from deep water, swim EAST back to the beach and try to walk out
    pl.tp(-40.0, 1.5, -8.0, E); pl.wait(700)
    pl.rec_reset(); pl.down("w")
    got_out = None
    for i in range(40):
        pl.wait(250); s = pl.st()
        if s["gr"] and not s["water"]: got_out = s; break
    pl.release_all(); pl.wait(400)
    print("   swim EAST out of the deep pond ->", json.dumps(got_out) if got_out else "NEVER GOT OUT in 10 s: " + json.dumps(pl.st()))
    pl.shot("pond_exit_east")
    print("   deaths:", pl.ev("()=>CRESTBOUND.game.__deaths"))

    print("\n=== LONG JUMP ON A REAL RUN-UP (fort courtyard, flat 9.00, 20 m of it) ===")
    for label, yaw in (("west across the courtyard", W), ("east across the courtyard", E)):
        pl.tp(0, 9.6, -24.0, yaw); pl.wait(400); pl.rec_reset()
        pl.down("w"); pl.wait(900)
        sp = pl.st()["sp"]
        pl.down("c"); pl.wait(70); pl.tap("Space", 110); pl.wait(120); pl.up("c")
        pl.wait(1500); pl.release_all(); pl.wait(400)
        r = pl.rec(); s = pl.st()
        print("   %-28s speed at press %.1f -> events %s  travelled %.2f m" %
              (label, sp, [e["e"] for e in r["events"]][:5], abs(s["x"] - 0.0)))
    pl.shot("longjump_courtyard")
    # dive too
    pl.tp(0, 9.6, -24.0, W); pl.wait(400); pl.rec_reset()
    pl.down("w"); pl.wait(900); pl.tap("f", 110); pl.wait(1600); pl.release_all(); pl.wait(400)
    r = pl.rec(); s = pl.st()
    print("   dive (F) -> events %s  travelled %.2f m  end state %s" % ([e["e"] for e in r["events"]][:6], abs(s["x"]), s["st"]))

    print("\n=== THE GNASHER POST ===")
    info = pl.ev("""()=>{ const C=CRESTBOUND.game.course; const out=[];
        for (const c of (C.critters||[])) out.push({kind:c.kind||c.def&&c.def.kind, p:c.def&&c.def.p,
            post:c.def&&c.def.post, hits:c.postHits, freed:c.freed, alive:c.alive});
        return out; }""")
    print("   critters:", json.dumps(info))
    pl.tp(-8.0, 8.0, -7.0, N); pl.wait(500); pl.shot("gnasher_post_standing")
    print("   standing on the post flat:", json.dumps(pl.st()))
    for i in range(4):
        pl.tp(-8.0, 11.5, -7.0, N); pl.wait(400); pl.rec_reset()
        pl.wait(150); pl.down("c"); pl.wait(1400); pl.up("c"); pl.wait(700)
        r = pl.rec()
        st2 = pl.ev("""()=>{ const C=CRESTBOUND.game.course; const g=(C.critters||[]).find(c=>(c.kind||(c.def&&c.def.kind))==='gnasher');
            return g? {hits:g.postHits, freed:g.freed, keys:Object.keys(g).slice(0,24)} : null; }""")
        print("      pound %d events %s -> %s" % (i + 1, [e["e"] for e in r["events"]][:5], json.dumps(st2)))
    print("   crests:", pl.st()["crests"])
    pl.shot("gnasher_post_after")

    print("\n=== A BUMBLER: can it hurt me while I stand still? ===")
    b = pl.ev("""()=>{ const C=CRESTBOUND.game.course; const out=[];
        for (const c of (C.critters||[])) if((c.kind||(c.def&&c.def.kind))==='bumbler')
            out.push({p:[+c.mesh.position.x.toFixed(1),+c.mesh.position.y.toFixed(1),+c.mesh.position.z.toFixed(1)]});
        return out; }""")
    print("   bumblers at:", json.dumps(b))
    if b:
        q = b[0]["p"]
        pl.tp(q[0], q[1] + 0.6, q[2] + 1.2, N); pl.wait(500); pl.shot("bumbler_face_to_face")
        pl.rec_reset(); pl.wait(6000)
        r = pl.rec(); s = pl.st()
        print("   stood next to it 6 s -> deaths %s events %s pos [%.1f %.1f]" %
              (s["deaths"], [e["e"] for e in r["events"]][:6], s["x"], s["z"]))
        pl.shot("bumbler_after_6s")

    print("\n=== THE MILL (set piece) — ride an arm to the island ===")
    pl.tp(30.0, 17.4, -2.0, N); pl.wait(600); pl.shot("mill_terrace")
    print("   on the mill terrace:", json.dumps(pl.st()))
    pl.rec_reset(); pl.down("w"); pl.wait(2400); pl.release_all(); pl.wait(2500)
    s = pl.st(); print("   walked toward the sails -> [%.1f %.1f %.1f] %s" % (s["x"], s["y"], s["z"], s["st"]))
    pl.shot("mill_after_walk")

    print("\n=== THE RACE PAD [0, 9.0, -15.5] ===")
    pl.tp(0, 9.6, -13.0, N); pl.wait(400); pl.rec_reset()
    pl.walk("w", 1200); pl.wait(900)
    r = pl.rec()
    race = pl.ev("()=>{const G=CRESTBOUND.game; return {raceMs:G.raceMs, snapRace:(G._snapshot&&G._snapshot().raceMs)};}")
    print("   ran over the race start -> events %s  race %s" % ([e["e"] for e in r["events"]][:6], json.dumps(race)))
    pl.shot("race_pad")

    print("\n=== THE WARDEN RING [-2, 16.40, -54] ===")
    pl.tp(-2, 17.2, -46, N); pl.wait(600); pl.shot("warden_ring_approach")
    pl.rec_reset(); pl.down("w"); pl.wait(2600); pl.release_all(); pl.wait(3000)
    s = pl.st(); r = pl.rec()
    print("   walked into the ring -> [%.1f %.1f %.1f] deaths %s events %s" %
          (s["x"], s["y"], s["z"], s["deaths"], [e["e"] for e in r["events"]][:8]))
    pl.shot("warden_ring")
    pl.rec_reset(); pl.wait(6000)
    s = pl.st(); r = pl.rec()
    print("   stood in the ring 6 s -> deaths %s events %s" % (s["deaths"], [e["e"] for e in r["events"]][:8]))
    pl.shot("warden_after_6s")
    print("   death log:", pl.ev("()=>CRESTBOUND.game.__deaths"))

    print("\nERRORS:", errs[:10])
    br.close()
