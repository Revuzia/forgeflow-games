"""VERDANT-2 GNASHER FORT — the whole route a player takes, plus the crouch-lead
sweep that tells us whether the long jump is a window problem or a gate problem."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_verdant import boot, Play, RECORDER
from playwright.sync_api import sync_playwright

N, S, E, W = 0.0, math.pi, -math.pi / 2, math.pi / 2

with sync_playwright() as p:
    br, pg, pl, errs = boot(p, headed=("--headed" in sys.argv), tag="verdant2")
    pl.goto("verdant-2"); pl.wait(1500)
    pl.ev("""()=>{ const G=CRESTBOUND.game; G.__deaths=[];
        G.player.events.on('death',(c)=>G.__deaths.push({c:String(c),
            p:[+G.player.pos.x.toFixed(1),+G.player.pos.y.toFixed(1),+G.player.pos.z.toFixed(1)]})); return 1;}""")
    print("spawn:", json.dumps(pl.st())); pl.shot("spawn_gnasher_fort")

    def hold(label, x, y, z, yaw, ms, key="w", shot=None, samples=0):
        pl.tp(x, y, z, yaw); pl.wait(350); pl.rec_reset()
        pl.down(key)
        tr = []
        if samples:
            for i in range(samples):
                pl.wait(ms // samples); q = pl.st()
                tr.append((round(q["x"], 1), round(q["y"], 1), round(q["z"], 1), q["st"]))
        else:
            pl.wait(ms)
        pl.release_all(); pl.wait(500)
        s = pl.st(); r = pl.rec()
        print("   %-32s -> [%.1f %.1f %.1f] %s gr=%s  ev=%s" %
              (label, s["x"], s["y"], s["z"], s["st"], s["gr"], [e["e"] for e in r["events"]][:8]))
        if tr: print("        trail", tr)
        if shot: pl.shot(shot)
        return s, r

    print("\n=== BEAT 1-2: shore -> the causeway and the sinkers ===")
    hold("run north off the shore", 0, 2.6, 50, N, 4000, shot="causeway_run", samples=10)
    print("   deaths:", pl.ev("()=>CRESTBOUND.game.__deaths"))

    print("\n=== THE MOAT: swim it, and the metal hat at [0, -1.40, 39.5] ===")
    pl.tp(0, 0.6, 46.0, N); pl.wait(800)
    print("   in the moat:", json.dumps(pl.st()))
    pl.shot("moat_swim")
    pl.rec_reset(); pl.down("w")
    got = None
    for i in range(32):
        pl.wait(250); q = pl.st()
        if q["gr"] and not q["water"]: got = q; break
    pl.release_all(); pl.wait(400)
    print("   swim north out of the moat ->", json.dumps(got) if got else "NEVER GOT OUT: " + json.dumps(pl.st()))
    pl.shot("moat_exit")
    # sink to the moat floor with C, find the drowned crest hat
    pl.tp(0, 0.4, 39.5, N); pl.wait(500); pl.rec_reset()
    pl.down("c"); pl.wait(3000); pl.up("c"); pl.wait(600)
    s = pl.st(); print("   sank at the hat -> y %.2f sub %s crests %s" % (s["y"], s["sub"], s["crests"]))
    pl.shot("moat_floor_hat")

    print("\n=== BEAT 3: the two jaws on the causeway (gnashers at z 23, posts z 26.5) ===")
    pl.tp(0, 6.9, 30.0, S); pl.wait(600); pl.shot("jaws_from_the_north")
    print("   standing 7 m north of the posts, doing nothing 5 s")
    pl.rec_reset(); pl.wait(5000)
    s = pl.st(); print("   -> deaths %s state %s" % (s["deaths"], s["st"]))
    hold("walk the middle lane south", 0, 6.9, 30.0, S, 3500, shot="jaws_middle_lane")
    print("   deaths:", pl.ev("()=>CRESTBOUND.game.__deaths"))
    # try the west post
    for i in range(3):
        pl.tp(-7.0, 9.0, 26.5, N); pl.wait(400); pl.rec_reset()
        pl.wait(120); pl.down("c"); pl.wait(1400); pl.up("c"); pl.wait(600)
        r = pl.rec()
        print("   pound the west post %d -> %s" % (i + 1, [e["e"] for e in r["events"]][:6]))
    print("   crests %s  deaths %s" % (pl.st()["crests"], pl.ev("()=>CRESTBOUND.game.__deaths.length")))
    pl.shot("west_post_after")

    print("\n=== CHECKPOINTS: walk onto each pad ===")
    for cid, pos, yaw in (("cp-quay", (0, 1.55, 32.6), N), ("cp-bailey", (0, 6.55, 26.4), N),
                          ("cp-rampart", (0, 12.00, 21.7), S), ("cp-court", (-6.0, 19.00, 0.5), N)):
        pl.tp(pos[0], pos[1] + 0.7, pos[2] + 2.4, yaw); pl.wait(350); pl.rec_reset()
        pl.walk("w", 900); pl.wait(700)
        r = pl.rec(); s = pl.st()
        print("   %-12s -> cp %s  events %s" % (cid, s["cp"], [e["e"] for e in r["events"]][:5]))
    pl.shot("checkpoints_done")

    print("\n=== THE INNER COURT + THE WARDEN OF THE KEEP ===")
    pl.tp(-6.0, 19.6, 0.5, N); pl.wait(700); pl.shot("inner_court")
    hold("walk toward the keep", -6.0, 19.6, 0.5, N, 2200, shot="court_to_keep")
    pl.tp(0, 19.6, 6.0, N); pl.wait(600)
    pl.rec_reset(); pl.wait(6000)
    s = pl.st(); r = pl.rec()
    print("   stood in the warden's court 6 s -> deaths %s events %s" % (s["deaths"], [e["e"] for e in r["events"]][:8]))
    pl.shot("warden_court_6s")

    print("\n=== THE OPEN CREST — CREST ON THE FLAGPOLE [0, 28.60, -3] ===")
    pl.tp(0, 27.6, -3.0, N); pl.wait(700)
    print("   on the keep roof:", json.dumps(pl.st()))
    pl.shot("keep_roof")
    pl.rec_reset(); pl.down("w"); pl.wait(400); pl.tap("Space", 120); pl.wait(1600); pl.release_all(); pl.wait(2000)
    s = pl.st(); print("   crest attempt -> crests %s gs %s" % (s["crests"], s["gs"]))
    pl.shot("keep_crest")

    print("\n=== THE RACE (PORTCULLIS DASH) start [0, 18.30, 10.4] ===")
    vols = pl.ev("""()=>(CRESTBOUND.game.course.volumes||[]).map(v=>({k:v.kind,
        c:[+v.center.x.toFixed(1),+v.center.y.toFixed(1),+v.center.z.toFixed(1)], id:(v.props&&v.props.id)||null}))""")
    print("   volumes:", json.dumps(vols)[:900])

    print("\n=== CROUCH-LEAD SWEEP: how long must C be down before Space for a LONG JUMP? ===")
    for lead in (0, 40, 80, 140, 200, 300, 450):
        got = []
        for k in range(4):
            pl.tp(0, 12.6, 21.7, E); pl.wait(300); pl.rec_reset()
            pl.down("w"); pl.wait(900)
            pl.down("c"); pl.wait(lead); pl.tap("Space", 110); pl.wait(140); pl.up("c")
            pl.wait(1100); pl.release_all(); pl.wait(250)
            r = pl.rec()
            got.append("LJ" if any(e["e"] == "longjump" for e in r["events"]) else
                       ("BF" if any(e["e"] == "backflip" for e in r["events"]) else "-"))
        print("   crouch lead %3d ms -> %s" % (lead, got))

    print("\n   deaths:", pl.ev("()=>CRESTBOUND.game.__deaths"))
    print("ERRORS:", errs[:10])
    br.close()
