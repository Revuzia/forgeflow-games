"""PLAYTEST - VERDANT-3 WINDMILL HEIGHTS, part A: meadow, river, logs, current, terraces, belts."""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _wmlib import install

with Play("wm_a") as pl:
    install(pl)
    pl.enter("verdant-3")
    pl.say("snap", json.dumps(pl.snap()))

    # ---- SANITY: does a plain held W actually run? -------------------------
    a = pl.pos()
    pl.aim(0, 30)          # north, down the cart track toward the quay
    pl.down("W"); pl.wait(2000); pl.up("W"); pl.wait(400)
    b = pl.pos()
    pl.say("SANITY held-W 2 s: %s -> %s  = %.2f m" % (a, b, math.hypot(b[0]-a[0], b[2]-a[2])))
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [0, 2.6, 42]); pl.wait(600)

    # ================================================== BEAT 1 RIVERMEAD
    pl.say("")
    pl.say("=== BEAT 1  RIVERMEAD ===")
    pl.shot("spawn_look")
    s0 = pl.state()
    pl.hold(["Q"], 1200); s1 = pl.state()
    pl.say("  orbit Q 1.2 s: camYaw %s -> %s   camPitch %s -> %s" % (s0["camYaw"], s1["camYaw"], s0["camPitch"], s1["camPitch"]))
    pl.hold(["E"], 2400); s2 = pl.state()
    pl.say("  orbit E 2.4 s: camYaw -> %s" % s2["camYaw"])
    pl.hold(["R"], 800); s3 = pl.state()
    pl.say("  orbit UP (R) 0.8 s: camPitch %s -> %s" % (s2["camPitch"], s3["camPitch"]))
    pl.hold(["V"], 1600); s4 = pl.state()
    pl.say("  orbit DOWN (V) 1.6 s: camPitch -> %s" % s4["camPitch"])
    pl.tap("Z"); pl.wait(700)
    pl.say("  recenter Z -> camYaw %s facing %s" % (pl.state()["camYaw"], pl.state()["facing"]))
    pl.shot("after_orbit")

    pl.say("  --- READ THE SIGN at [3.4, ~3.95, 51] (spawn board) ---")
    pl.go(2.0, 48.0, tol=1.6, max_ms=14000, tag="toward the spawn sign")
    pl.aim(3.4, 51); pl.wait(500)
    pl.shot("sign_windmill_heights")
    pl.say("  standing at", pl.pos(), "reading the board")

    pl.say("  --- the HUNDRED COINS pedestal [-6, 3.45, 51] + paddock ring [-12, 3.2, 50] ---")
    pl.go(-6.0, 51.0, tol=1.8, max_ms=15000, tag="coins pedestal")
    pl.shot("coins_pedestal"); pl.say("  snap", json.dumps(pl.snap()))
    pl.go(-12.0, 50.0, tol=2.0, max_ms=12000, tag="paddock coin ring")
    pl.wait(600)
    pl.say("  snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("paddock_ring")

    pl.say("  --- the BALE STACK at [-9, 2.75, 47] top 3.50, and [-9.2, 45..] ---")
    pl.go(-9.0, 49.0, tol=1.6, max_ms=10000, tag="approach bales")
    pl.aim(-9.0, 47.0)
    tr = pl.jump(hold_ms=240, run_ms=430, n=8)
    pl.say("  bale hop:", json.dumps(tr))
    pl.say("  ->", json.dumps(pl.state()))
    pl.shot("bale_hop")

    pl.say("  --- THE BUMBLER (meadow patrol) ---")
    b = pl.js("""()=>{const C=CRESTBOUND.game.course, out=[];
        for (const c of (C.critters||[])) { const d=c.def||{}; const m=c.mesh||c.root||c.group;
          let w=null; if(m&&m.getWorldPosition){const v=new CRESTBOUND.THREE.Vector3(); m.getWorldPosition(v);
            w=[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)];}
          out.push({k:d.kind, w:w, kills:(c.kills||[]).length, cols:(c.colliders||[]).length}); }
        return out; }""")
    pl.say("  critters:", json.dumps(b))
    bums = [c for c in b if c["k"] == "bumbler" and c["w"] and c["w"][2] > 30]
    if bums:
        bp = bums[0]["w"]
        pl.say("  meadow bumbler at", bp, "- walking straight into its side")
        before = pl.snap()
        r = pl.go(bp[0], bp[2], tol=0.8, max_ms=14000, tag="bumbler side contact")
        pl.wait(700)
        pl.say("  contact ->", json.dumps(pl.state()), "events", pl.ev(), "deaths", pl.deaths(),
               "snap", json.dumps(pl.snap()), "was", json.dumps(before))
        pl.shot("bumbler_contact")
        pl.say("  standing STILL 6 s next to it:")
        pl.watch(12, 500, "still beside bumbler")
        pl.say("  events", pl.ev(), "deaths", pl.deaths())
        pl.shot("bumbler_still")
        bp2 = pl.js("""()=>{const C=CRESTBOUND.game.course; const v=new CRESTBOUND.THREE.Vector3();
            for (const c of (C.critters||[])) { const d=c.def||{}; if(d.kind!=='bumbler') continue;
              const m=c.mesh||c.root; if(!m||!m.getWorldPosition) continue; m.getWorldPosition(v);
              if (v.z>30) return [+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]; } return null; }""")
        pl.say("  bumbler now at", bp2, "- trying to LAND ON IT (squish)")
        if bp2:
            pl.aim(bp2[0], bp2[2])
            tr = pl.jump(hold_ms=200, run_ms=620, n=10)
            pl.say("  squish attempt:", json.dumps(tr))
            pl.say("  ->", json.dumps(pl.snap()), "events", pl.ev(), "deaths", pl.deaths())
            pl.shot("bumbler_squish")

    # ================================================== BEAT 2 THE RIVER
    pl.say("")
    pl.say("=== BEAT 2  THE QUAY, THE LOGS, THE CURRENT ===")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [0, 2.6, 44]); pl.wait(600)
    r = pl.go(0, 41.0, tol=1.6, max_ms=12000, tag="walk to cp-riverbank [0,1.90,42]")
    pl.say("  snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("cp_riverbank")
    pl.go(0, 38.6, tol=1.2, max_ms=9000, tag="quay north edge z=37.5")
    pl.shot("quay_edge")
    pl.say("  reading the quay signs from here:", pl.pos())

    pl.say("  --- JUMP quay -> LOG A (top 1.20, z 30.7..34.3). Release the stick at the apex. ---")
    pl.aim(0, 30)
    tr = pl.jump(hold_ms=250, run_ms=560, n=10, release_at=340)
    pl.say("  jump trail:", json.dumps(tr))
    st = pl.state()
    pl.say("  landed:", json.dumps(st), "events", pl.ev())
    pl.shot("log_a_landing")

    if not st["inWater"]:
        pl.say("  --- STAND STILL on log A: does it sink (delay 1.5 s, speed 0.9, depth 5)? ---")
        pl.watch(14, 400, "sinking log A")
        pl.say("  events", pl.ev(), "deaths", pl.deaths())
        pl.shot("log_a_sinking")

    pl.say("  --- back on the quay, jump again and KEEP RUNNING to log B ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [0, 2.6, 38.4]); pl.wait(700)
    pl.aim(0, 24)
    tr = pl.jump(hold_ms=250, run_ms=560, n=6, release_at=300)
    pl.say("  hop 1:", json.dumps(tr))
    st = pl.state()
    if st["grounded"] and not st["inWater"]:
        tr = pl.jump(hold_ms=250, run_ms=300, n=8, release_at=300)
        pl.say("  hop 2 (to log B):", json.dumps(tr))
    pl.say("  ->", json.dumps(pl.state()), "events", pl.ev())
    pl.shot("log_b")

    pl.say("  --- FALL IN ON PURPOSE: can a player swim out? ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [0, 0.2, 29.0]); pl.wait(1200)
    pl.say("  in the river:", json.dumps(pl.state()))
    pl.shot("in_the_river")
    pl.say("  hold W toward the NORTH jetty [0, 2.60, 21] and swim:")
    r = pl.go(0, 21.0, tol=2.2, max_ms=22000, reaim_ms=600, tag="swim north to the jetty",
              stop_on=lambda s: (s["grounded"] and not s["inWater"]))
    pl.say("  ->", json.dumps(pl.state()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("swim_out_north")

    pl.say("  --- if that failed: let the current take me and try the east shallows ---")
    st = pl.state()
    if st["inWater"]:
        pl.watch(16, 600, "carried by the current, no input")
        pl.say("  now swim for the nearest bank:")
        p = pl.pos()
        r = pl.go(p[0], p[2] - 12, tol=2.5, max_ms=20000, reaim_ms=600, tag="swim to north bank",
                  stop_on=lambda s: (s["grounded"] and not s["inWater"]))
        pl.say("  ->", json.dumps(pl.state()))
        pl.shot("swim_out_east")
        if pl.state()["inWater"]:
            pl.say("  STILL in the water - trying JUMP (stroke) + W for 8 s")
            pl.down("W")
            for i in range(16):
                pl.tap("SPACE", 90); pl.wait(400)
            pl.up("W"); pl.wait(500)
            pl.say("  ->", json.dumps(pl.state()))
            pl.shot("swim_stroke_out")

    pl.say("  --- SIGIL 1 on the riverbed [-14, -3.30, 28] (bed -4.89): dive for it ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-14, 0.3, 28]); pl.wait(1000)
    pl.say("  at the deep pool:", json.dumps(pl.state()))
    pl.down("C"); pl.wait(3000); pl.up("C"); pl.wait(600)
    pl.say("  held crouch to sink ->", json.dumps(pl.state()), "snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("riverbed_dive")
    pl.aim(-14, 28)
    pl.down("C"); pl.down("W"); pl.wait(2500); pl.up("W"); pl.up("C"); pl.wait(800)
    pl.say("  swim about the bed ->", json.dumps(pl.state()), "snap", json.dumps(pl.snap()))
    pl.shot("riverbed_sigil")
    pl.say("  now SURFACE: hold jump")
    for i in range(10):
        pl.tap("SPACE", 90); pl.wait(350)
    pl.wait(600)
    pl.say("  ->", json.dumps(pl.state()), "events", pl.ev())
    pl.shot("surfaced")

    pl.dump("wm_a")
    pl.say("CONSOLE:", json.dumps(pl.console[:25]))
