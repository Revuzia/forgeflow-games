"""PLAYTEST - VERDANT-3, part B: terraces + hay belts, granary + breakable floor, mills, pendulums."""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _wmlib import install

with Play("wm_b") as pl:
    install(pl)
    pl.enter("verdant-3")

    def full():
        return pl.js("""()=>{const G=CRESTBOUND.game,P=G.player;return {p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
            st:P.state, sp:+P.speed.toFixed(2), gr:!!P.grounded, surf:P.surface||null,
            vy:+P.vel.y.toFixed(2), cam:{d:+G.cam.dist.toFixed(2),p:+G.cam.pitch.toFixed(3),y:+G.cam.yaw.toFixed(3),
            wp:[+G.cam.position.x.toFixed(1),+G.cam.position.y.toFixed(1),+G.cam.position.z.toFixed(1)]}};}""")

    # ---- PROBE 1: is the keyboard camera elevation inverted? --------------
    pl.say("=== PROBE  keyboard camera elevation (R = orbitUp, V = orbitDown) ===")
    pl.tap("Z"); pl.wait(600)
    a = full(); pl.say("  rest:", json.dumps(a)); pl.shot("cam_rest")
    pl.hold(["R"], 900); b = full(); pl.say("  after R (orbitUp):", json.dumps(b)); pl.shot("cam_R_up")
    pl.tap("Z"); pl.wait(600)
    pl.hold(["V"], 900); c = full(); pl.say("  after V (orbitDown):", json.dumps(c)); pl.shot("cam_V_down")
    pl.say("  camera WORLD Y: rest %.1f  after R %.1f  after V %.1f  (hero y %.2f)"
           % (a["cam"]["wp"][1], b["cam"]["wp"][1], c["cam"]["wp"][1], a["p"][1]))
    pl.tap("Z"); pl.wait(500)

    # ---- PROBE 2: what is the ground run speed, really? -------------------
    pl.say("=== PROBE  ground run speed on the open meadow (TUNE.speedRun = 9.0) ===")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-14, 2.4, 52]); pl.wait(700)
    pl.aim(-14, 30)
    pl.down("W")
    sp = []
    for i in range(12):
        pl.wait(260); q = full(); sp.append([q["p"], q["sp"], q["st"], q["surf"]])
    pl.up("W"); pl.wait(400)
    pl.say("  run samples:", json.dumps(sp))
    pl.say("  MAX speed seen: %.2f" % max(x[1] for x in sp))

    # ---- PROBE 3: the bale material colour --------------------------------
    pl.say("=== PROBE  bale stack material (mat 'cloth', tint 0xd7b45a WHEAT) ===")
    mats = pl.js("""()=>{const G=CRESTBOUND.game, out=[]; const T=CRESTBOUND.THREE; const v=new T.Vector3();
        G.course.group.traverse(o=>{ if(!o.isMesh||!o.material) return; o.getWorldPosition(v);
          if (Math.abs(v.x+9)>6 || Math.abs(v.z-46)>6) return;
          const m=Array.isArray(o.material)?o.material[0]:o.material;
          out.push({n:o.name||'?', p:[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)],
            mat:m.name||m.type, col:m.color?('#'+m.color.getHexString()):null}); });
        return out.slice(0,14); }""")
    pl.say("  meshes near the bale stack:", json.dumps(mats))
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-9, 5.0, 51]); pl.wait(800)
    pl.aim(-9, 46); pl.wait(400); pl.shot("bales_closeup")

    # ================================================== BEAT 3 the belts
    pl.say("")
    pl.say("=== BEAT 3  THE WHEAT TERRACES AND THE HAY BELTS ===")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [0, 3.4, 20.4]); pl.wait(800)
    pl.say("  north jetty (cp2):", json.dumps(full())); pl.shot("jetty")
    pl.go(0, 8.0, tol=2.0, max_ms=18000, tag="climb the north bank cart track")
    pl.say("  events", pl.ev(), "snap", json.dumps(pl.snap()))
    pl.shot("bank_climb")
    pl.go(0, 1.5, tol=2.0, max_ms=12000, tag="the lower wheat field (millrace start)")
    pl.shot("wheat_field"); pl.say("  ", json.dumps(full()), "events", pl.ev())

    pl.say("  --- LOWER BELT [7, 11.15, -2], dir +Z (south, downhill), power 5.0 ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [7.0, 11.7, -4.5]); pl.wait(1000)
    pl.say("  dropped on the belt's north end:", json.dumps(full()))
    pl.shot("belt_on")
    pl.watch(10, 400, "carried by the belt, NO input")
    pl.say("  events", pl.ev(), "deaths", pl.deaths())
    pl.shot("belt_carried")

    pl.say("  --- RUN AGAINST it (north): design says 9.0 - 5.0 = 4.0 m/s net ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [7.0, 11.7, 1.6]); pl.wait(800)
    pl.aim(7.0, -20)
    pl.down("W")
    tr = []
    for i in range(12):
        pl.wait(400); q = full(); tr.append([q["p"], q["sp"], q["st"]])
    pl.up("W"); pl.wait(500)
    pl.say("  run-against:", json.dumps(tr))
    pl.say("  ->", json.dumps(full()), "snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("belt_against")

    pl.say("  --- THE JUMP PAD [-9, 11.14, -3] power 4.0 ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-9.0, 11.9, 0.5]); pl.wait(700)
    pl.shot("jumppad_before")
    pl.aim(-9.0, -6)
    pl.down("W")
    tr = []
    for i in range(12):
        pl.wait(220); q = full(); tr.append([q["p"], q["st"]])
    pl.up("W"); pl.wait(1000)
    pl.say("  jump pad trail:", json.dumps(tr))
    pl.say("  ->", json.dumps(full()), "events", pl.ev())
    pl.shot("jumppad_after")

    pl.say("  --- THE TERRACE STAIR [-3, 11.0, -6.2], 9 risers 11.00 -> 12.80 ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-3.0, 11.8, -3.2]); pl.wait(700)
    pl.shot("stair_foot")
    pl.aim(-3.0, -14)
    pl.down("W")
    tr = []
    for i in range(10):
        pl.wait(350); q = full(); tr.append([q["p"], q["st"], q["gr"]])
    pl.up("W"); pl.wait(600)
    pl.say("  stair climb:", json.dumps(tr))
    pl.say("  ->", json.dumps(full()), "events", pl.ev())
    pl.shot("stair_top")

    pl.say("  --- SIGIL 3 [12, 13.65, -4] far end of the UPPER hay deck ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [12.0, 13.2, 1.0]); pl.wait(800)
    pl.say("  ", json.dumps(full()))
    pl.go(12.0, -4.0, tol=1.5, max_ms=16000, tag="sigil 3")
    pl.wait(700)
    pl.say("  snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("sigil3")

    # ================================================== BEAT 4 granary
    pl.say("")
    pl.say("=== BEAT 4  THE GRANARY, THE GNASHER, MILL 1 ===")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [4, 14.3, -14]); pl.wait(900)
    pl.say("  cp-granary:", json.dumps(full()), "snap", json.dumps(pl.snap()))
    pl.shot("cp_granary")

    pl.say("  --- THE GNASHER: post [-7, 13.6, -9.6], chain 5.5. Walk into its disc. ---")
    pl.go(-3.5, -10.5, tol=1.4, max_ms=14000, tag="edge of the gnasher disc")
    pl.wait(900)
    pl.say("  ", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("gnasher_edge")
    pl.say("  standing STILL 6 s inside the disc:")
    pl.watch(12, 500, "still inside gnasher reach")
    pl.say("  events", pl.ev(), "deaths", pl.deaths())
    pl.shot("gnasher_still")
    pl.say("  walking right up to the post:")
    pl.go(-6.5, -9.8, tol=1.2, max_ms=10000, tag="onto the gnasher post")
    pl.wait(900)
    pl.say("  ", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("gnasher_post")

    pl.say("  --- THE SIGILS PEDESTAL [5, 13.6, -21.5] ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [5, 14.3, -17]); pl.wait(700)
    pl.go(5.0, -21.5, tol=1.6, max_ms=12000, tag="sigils pedestal")
    pl.shot("sigils_pedestal"); pl.say("  ", json.dumps(full()))

    pl.say("  --- THE SACK STAIR: 13.60 -> 21.60 in five 1.60 m steps ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-0.4, 14.3, -22.0]); pl.wait(800)
    pl.shot("sackstair_foot")
    for i, (x, z, top) in enumerate([(-0.4, -19.6, 15.20), (-0.4, -17.6, 16.80), (-0.4, -15.6, 18.40),
                                     (-0.4, -13.6, 20.00), (-1.6, -12.0, 21.60)]):
        pl.aim(x, z)
        pl.down("W"); pl.wait(380)
        pl.down("SPACE"); pl.wait(240); pl.up("SPACE")
        pl.wait(750); pl.up("W"); pl.wait(700)
        q = full()
        ok = abs(q["p"][1] - top) < 0.7
        pl.say("   step %d -> %s %s  want y~%.2f  %s" % (i + 1, q["p"], q["st"], top, "OK" if ok else "MISS"))
        if not ok:
            pl.shot("sackstair_miss%d" % (i + 1))
            break
    pl.shot("sackstair_end"); pl.say("  events", pl.ev(), "deaths", pl.deaths())

    pl.say("  --- GRANARY ROOF (21.60) + SIGIL 4 [-8, 23.0, -16] ---")
    pl.go(-8.0, -16.0, tol=2.0, max_ms=16000, tag="granary roof / sigil 4")
    pl.wait(800)
    pl.say("  ", json.dumps(full()), "snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("granary_roof")

    pl.say("  --- INSIDE: camera behaviour in an interior (owner P10) ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-8, 18.2, -16]); pl.wait(1200)
    pl.say("  on the mezzanine:", json.dumps(full()))
    pl.shot("interior_00")
    for i in range(4):
        pl.hold(["E"], 800)
        q = full()
        pl.say("   orbit E #%d -> camDist %.2f camYaw %.3f camWorld %s" % (i + 1, q["cam"]["d"], q["cam"]["y"], q["cam"]["wp"]))
        pl.shot("interior_orbit%d" % i)
    pl.say("  walking around inside:")
    for tgt in ((-12, -18), (-4, -14), (-8, -19)):
        r = pl.go(tgt[0], tgt[1], tol=1.4, max_ms=8000, reaim_ms=450, tag="interior walk %s" % (tgt,))
        q = full()
        pl.say("    camDist %.2f  hero %s" % (q["cam"]["d"], q["p"]))
    pl.shot("interior_walk")

    pl.say("  --- POUND THE FLOOR (breakable at 17.20, trigger granary-floor) ---")
    pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [-8, 18.2, -16]); pl.wait(900)
    before = pl.snap()
    pl.tap("SPACE", 150); pl.wait(300)
    pl.down("C"); pl.wait(1100); pl.up("C"); pl.wait(1600)
    pl.say("  after pound:", json.dumps(full()), "events", pl.ev(), "snap", json.dumps(pl.snap()), "was", json.dumps(before))
    pl.shot("pound_floor")
    pl.wait(2500)
    pl.say("  2.5 s later:", json.dumps(full()), "snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("cellar")
    pl.say("  looking for the secret crest at [-8, 15.0, -16]:")
    pl.go(-8.0, -16.0, tol=1.5, max_ms=8000, reaim_ms=450, tag="secret crest")
    pl.wait(900)
    pl.say("  snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("cellar_crest")
    pl.say("  can I get OUT of the cellar? walking to the south door:")
    r = pl.go(-8.0, -11.0, tol=2.0, max_ms=14000, reaim_ms=500, tag="cellar -> south door")
    pl.say("  ", json.dumps(full()))
    pl.shot("cellar_exit")

    pl.say("  --- MILL 1 [-18, 21.60, -16], 4 arms, period 10.5, yaw PI/2 ---")
    dk = pl.js("""()=>{const C=CRESTBOUND.game.course; let best=null;
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='mill') continue;
          if (Math.abs(d.p[0]+18)>1.5 || Math.abs(d.p[2]+16)>1.5) continue;
          for (const c of (h.colliders||[])) { if(c.half.y>1.0) continue;
            if(!best||c.center.y<best[1]) best=[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2),+c.half.y.toFixed(2)]; } }
        return best; }""")
    pl.say("  lowest gondola:", json.dumps(dk))
    if dk:
        pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [dk[0], dk[1] + dk[3] + 0.35, dk[2]]); pl.wait(700)
        pl.shot("mill1_board")
        tr = pl.watch(18, 400, "riding mill 1 (no input)")
        pl.say("  events", pl.ev(), "deaths", pl.deaths())
        pl.shot("mill1_ride")

    pl.dump("wm_b")
    pl.say("CONSOLE:", json.dumps(pl.console[:25]))
