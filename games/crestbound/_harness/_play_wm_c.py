"""PLAYTEST - VERDANT-3, part C: ridge stair + pendulum sacks, rotor gates, mills 2/3 + wing nest,
the bell and its vanish staircase, THE GREAT MILL, the scaffold, the sky-platform crest, the cannon."""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play
from _wmlib import install

with Play("wm_c") as pl:
    install(pl)
    pl.enter("verdant-3")

    def full():
        return pl.js("""()=>{const G=CRESTBOUND.game,P=G.player;return {p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
            st:P.state, sp:+P.speed.toFixed(2), gr:!!P.grounded, surf:P.surface||null,
            cd:+G.cam.dist.toFixed(2), clk:+G.course.clock.toFixed(2)};}""")

    def tp(x, y, z):
        pl.js("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y,z)", [x, y, z]); pl.wait(800)

    pl.say("=== RE-VERIFY  the granary cellar stuck (claimed BLOCKER, must confirm) ===")
    tp(-8, 18.2, -16)
    pl.say("  on the mezzanine:", json.dumps(full()))
    pl.tap("SPACE", 150); pl.wait(300)
    pl.down("C"); pl.wait(1100); pl.up("C"); pl.wait(2500)
    pl.say("  after the pound:", json.dumps(full()), "events", pl.ev(), "snap", json.dumps(pl.snap()))
    pl.shot("cellar_after_pound")
    pl.watch(10, 500, "just standing in the cellar, no input")
    pl.say("  now WALK for the south door, 10 s of held W:")
    pl.aim(-8, -8)
    pl.down("W"); pl.wait(10000); pl.up("W"); pl.wait(800)
    pl.say("  ->", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("cellar_walk_out")
    pl.say("  and JUMP a few times:")
    for i in range(4):
        pl.tap("SPACE", 150); pl.wait(700)
    pl.say("  ->", json.dumps(full()), "events", pl.ev())
    pl.shot("cellar_jump")

    pl.say("=== PROBE  what is the big black mass on the granary terrace? ===")
    rocks = pl.js("""()=>{const C=CRESTBOUND.game.course, out=[];
        const bp=C.broadphase; const T=CRESTBOUND.THREE;
        const aabb=new T.Box3(new T.Vector3(-12,10,-30), new T.Vector3(10,40,-12));
        const hit=[]; bp.query(aabb, hit);
        for (const c of hit) out.push({half:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)],
          c:[+c.center.x.toFixed(1),+c.center.y.toFixed(1),+c.center.z.toFixed(1)],
          surf:c.surface||null, ref:(c.ref&&c.ref.kind)||(c.ref&&c.ref.kindOf)||null});
        out.sort((a,b)=>(b.half[0]*b.half[1]*b.half[2])-(a.half[0]*a.half[1]*a.half[2]));
        return out.slice(0,12); }""")
    pl.say("  biggest colliders on the granary terrace:", json.dumps(rocks))
    tp(2.0, 15.0, -22.0); pl.wait(600); pl.shot("terrace_blackmass")

    # ================================================== BEAT 5 ridge stair
    pl.say("=== BEAT 5  THE RIDGE STAIR UNDER THE SWINGING SACKS ===")
    tp(-6.0, 14.3, -19.5)
    pl.say("  stair foot:", json.dumps(full())); pl.shot("ridgestair_foot")
    pl.aim(-6.0, -34)
    pl.down("W")
    tr = []
    for i in range(18):
        pl.wait(380); q = full(); tr.append([q["p"], q["st"], q["sp"]])
    pl.up("W"); pl.wait(700)
    pl.say("  climb:", json.dumps(tr))
    pl.say("  ->", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("ridgestair_top")

    pl.say("  --- run it again to see whether a sack ever hits me ---")
    tp(-6.0, 14.3, -19.5)
    pl.aim(-6.0, -34)
    pl.down("W"); pl.wait(6500); pl.up("W"); pl.wait(700)
    pl.say("  2nd run ->", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("ridgestair_2nd")

    pl.say("  --- stand STILL under the first sack [-6, 22.60, -21.4] len 3.4 amp 46deg ---")
    tp(-6.0, 15.4, -21.4)
    pl.watch(14, 450, "standing under sack 1")
    pl.say("  events", pl.ev(), "deaths", pl.deaths())
    pl.shot("under_sack")

    pl.say("  --- THE CART RAMP at x=+9 (13.90 -> 19.10 over 9 m = 30deg) ---")
    tp(9.0, 14.5, -18.5)
    pl.aim(9.0, -30)
    pl.down("W")
    tr = []
    for i in range(14):
        pl.wait(400); q = full(); tr.append([q["p"], q["st"]])
    pl.up("W"); pl.wait(700)
    pl.say("  ramp:", json.dumps(tr)); pl.say("  ->", json.dumps(full()), "events", pl.ev())
    pl.shot("cart_ramp")

    pl.say("  --- SACK GULLY crags 9.6/-22 (17.70) -> 16/-26 (19.10) -> 22/-29.4 (20.30), SIGIL 5 at [16, 20.50, -26] ---")
    tp(9.6, 18.2, -22.0)
    pl.say("  crag 1:", json.dumps(full())); pl.shot("crag1")
    for (x, z, top) in ((16.0, -26.0, 19.10), (22.0, -29.4, 20.30)):
        pl.aim(x, z)
        pl.down("W"); pl.wait(400); pl.down("SPACE"); pl.wait(250); pl.up("SPACE")
        pl.wait(900); pl.up("W"); pl.wait(900)
        pl.say("   -> %s want y~%.2f" % (json.dumps(full()), top))
    pl.say("  snap", json.dumps(pl.snap()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("crag_gully")

    # ================================================== BEAT 6 ridge path
    pl.say("")
    pl.say("=== BEAT 6  THE RIDGE PATH, ROTOR GATES, MILLS 2 AND 3, THE WING NEST ===")
    tp(-4.0, 19.9, -30.0)
    pl.say("  cp-ridge:", json.dumps(full()), "snap", json.dumps(pl.snap())); pl.shot("cp_ridge")

    pl.say("  --- ROTOR GATE 1 [-11, 20.35, -32.6] style bar, 3 arms, period 7 ---")
    pl.go(-11.0, -32.6, tol=1.5, max_ms=14000, tag="walk into rotor gate 1")
    pl.wait(900)
    pl.say("  ", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("rotor1")
    pl.say("  standing STILL in the rotor's sweep for 8 s:")
    pl.watch(16, 500, "still in rotor 1")
    pl.say("  events", pl.ev(), "deaths", pl.deaths())
    pl.shot("rotor1_still")

    pl.say("  --- ridge path west to mill 3's jump pad [-30, 20.14, -44] power 7.0 ---")
    tp(-24.0, 20.6, -38.0)
    pl.go(-30.0, -44.0, tol=1.8, max_ms=18000, tag="mill 3 jump pad")
    pl.wait(700); pl.say("  ", json.dumps(full())); pl.shot("mill3_pad_approach")
    pl.aim(-30.0, -46)
    pl.down("W"); pl.wait(700)
    tr = []
    for i in range(14):
        pl.wait(230); q = full(); tr.append([q["p"], q["st"]])
    pl.up("W"); pl.wait(1200)
    pl.say("  jump pad launch:", json.dumps(tr)); pl.say("  ->", json.dumps(full()), "events", pl.ev())
    pl.shot("mill3_pad_launch")

    pl.say("  --- THE WING NEST [-34, 26.60, -44] on mill 3's balcony ---")
    tp(-34.0, 27.2, -44.0)
    pl.say("  on the balcony:", json.dumps(full()), "snap", json.dumps(pl.snap()))
    pl.shot("wing_nest")
    pl.go(-34.0, -44.0, tol=1.2, max_ms=7000, reaim_ms=400, tag="stand on the nest")
    pl.wait(1000)
    pl.say("  snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("wing_taken")

    pl.say("  --- SIGIL 7, mill 3's sail shelf [-30.08, 29.50, -44] : ride the sail ---")
    dk = pl.js("""()=>{const C=CRESTBOUND.game.course; const out=[];
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='mill') continue;
          if (Math.abs(d.p[0]+34)>1.5 || Math.abs(d.p[2]+44)>1.5) continue;
          for (const c of (h.colliders||[])) out.push([+c.center.x.toFixed(2),+c.center.y.toFixed(2),
            +c.center.z.toFixed(2),+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)]); }
        return out; }""")
    pl.say("  mill 3 colliders:", json.dumps(dk))

    pl.say("  --- THE BELL [4, 20.60, -30] breakable, trigger bell-rung ---")
    tp(4.0, 21.9, -32.5)
    pl.say("  at the bell:", json.dumps(full())); pl.shot("bell_approach")
    pl.say("  reading the bell sign from here")
    pl.go(4.0, -30.0, tol=1.3, max_ms=9000, reaim_ms=400, tag="up to the bell")
    pl.wait(600)
    pl.say("  ", json.dumps(full()), "events", pl.ev())
    pl.say("  JUMP + POUND the bell:")
    before = pl.snap()
    pl.tap("SPACE", 160); pl.wait(280)
    pl.down("C"); pl.wait(1100); pl.up("C"); pl.wait(1500)
    pl.say("  after pound:", json.dumps(full()), "events", pl.ev(), "snap", json.dumps(pl.snap()), "was", json.dumps(before))
    pl.shot("bell_pound")

    pl.say("  --- THE VANISH STAIRCASE: 5 flagstones 9.4/-30 (21.60) .. 31/-30 (28.00), crag 38/-30 (30.60) ---")
    vs = pl.js("""()=>{const C=CRESTBOUND.game.course; const out=[];
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='vanish') continue;
          const c=(h.colliders||[])[0];
          out.push({p:d.p, solid:!!(c&&c.active), vis:!!(h.mesh&&h.mesh.visible)}); }
        return out; }""")
    pl.say("  flagstones now:", json.dumps(vs))
    pl.aim(9.4, -30)
    pl.down("W")
    tr = []
    for i in range(6):
        pl.wait(330); q = full(); tr.append([q["p"], q["st"], q["gr"]])
    pl.say("  running for stone 1:", json.dumps(tr))
    steps = [(14.8, -30.0, 23.20), (20.2, -30.0, 24.80), (25.6, -30.0, 26.40), (31.0, -30.0, 28.00), (38.0, -30.0, 30.60)]
    for (x, z, top) in steps:
        pl.aim(x, z)
        pl.down("SPACE"); pl.wait(250); pl.up("SPACE"); pl.wait(800)
        q = full()
        pl.say("   -> %s want y~%.2f %s" % (json.dumps(q), top, "OK" if abs(q["p"][1] - top) < 0.8 else "MISS"))
        if q["p"][1] < 19.0:
            pl.say("   FELL OFF THE STAIR")
            break
    pl.up("W"); pl.wait(900)
    pl.say("  ->", json.dumps(full()), "snap", json.dumps(pl.snap()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("bell_stair")

    # ================================================== BEAT 7 the great mill
    pl.say("")
    pl.say("=== BEAT 7  THE GREAT MILL, THE SCAFFOLD, THE SKY PLATFORM ===")
    tp(22.0, 24.3, -44.0)
    pl.say("  cp-yard:", json.dumps(full()), "snap", json.dumps(pl.snap())); pl.shot("cp_yard")

    pl.say("  --- ROUTE A, THE SCAFFOLD: six ledges 24.60 .. 31.60, then gallery 32.04 ---")
    tp(17.0, 25.0, -44.2)
    pl.say("  ledge 1:", json.dumps(full())); pl.shot("scaffold_1")
    ledges = [(17.0, -39.4, 26.00), (22.8, -39.4, 27.40), (22.8, -44.2, 28.80),
              (28.6, -44.2, 30.20), (28.6, -39.4, 31.60)]
    okall = True
    for i, (x, z, top) in enumerate(ledges):
        pl.aim(x, z)
        pl.down("W"); pl.wait(330)
        pl.down("SPACE"); pl.wait(250); pl.up("SPACE")
        pl.wait(800); pl.up("W"); pl.wait(700)
        q = full()
        ok = abs(q["p"][1] - top) < 0.8
        okall = okall and ok
        pl.say("   ledge %d -> %s want y~%.2f %s" % (i + 2, json.dumps(q), top, "OK" if ok else "MISS"))
        if not ok:
            pl.shot("scaffold_miss%d" % (i + 2)); break
    pl.shot("scaffold_top")
    pl.say("  events", pl.ev(), "deaths", pl.deaths())

    pl.say("  --- THE GALLERY 32.04 + SIGIL 8 [28, 33.50, -48] ---")
    tp(28.0, 32.6, -44.0)
    pl.go(28.0, -48.0, tol=1.6, max_ms=12000, reaim_ms=450, tag="gallery / sigil 8")
    pl.wait(900)
    pl.say("  ", json.dumps(full()), "snap", json.dumps(pl.snap()), "events", pl.ev())
    pl.shot("gallery_sigil8")

    pl.say("  --- ROUTE B, THE SAIL RIDE: board the gondola at the bottom of the sweep ---")
    tp(22.0, 25.4, -48.0)
    pl.say("  boarding plinth (24.80):", json.dumps(full())); pl.shot("plinth")
    dk = pl.js("""()=>{const C=CRESTBOUND.game.course; let best=null;
        for (const h of (C.hazards||[])) { const d=h.def||{}; if(d.kind!=='mill') continue;
          if (Math.abs(d.p[0]-28)>1.5 || Math.abs(d.p[2]+48)>1.5) continue;
          for (const c of (h.colliders||[])) { if(c.half.y>1.0) continue;
            if(!best||c.center.y<best[1]) best=[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2),+c.half.y.toFixed(2)]; } }
        return best; }""")
    pl.say("  lowest great-mill gondola:", json.dumps(dk))
    if dk:
        tp(dk[0], dk[1] + dk[3] + 0.35, dk[2])
        pl.shot("gondola_board")
        tr = pl.watch(22, 400, "RIDING THE GREAT MILL (no input)")
        pl.say("  events", pl.ev(), "deaths", pl.deaths(), "snap", json.dumps(pl.snap()))
        pl.shot("gondola_ride")
        q = full()
        pl.say("  after 8.8 s of ride:", json.dumps(q))
        if q["p"][1] > 33:
            pl.say("  stepping EAST off the gondola onto the sky platform (1.60 m)")
            pl.aim(47, -48)
            pl.down("W"); pl.wait(600); pl.up("W"); pl.wait(1200)
            pl.say("  ->", json.dumps(full()))
            pl.shot("gondola_stepoff")

    pl.say("  --- THE SKY PLATFORM (35.90) and the OPEN CREST [47, 37.40, -48] ---")
    tp(41.0, 36.6, -48.0)
    pl.say("  on the deck:", json.dumps(full())); pl.shot("sky_deck")
    before = pl.snap()
    pl.go(47.0, -48.0, tol=1.4, max_ms=12000, reaim_ms=450, tag="walk to the crest")
    pl.wait(1200)
    pl.say("  ", json.dumps(full()), "snap", json.dumps(pl.snap()), "was", json.dumps(before), "events", pl.ev())
    pl.shot("sky_crest_walk")
    if pl.snap()["crests"] == before["crests"]:
        pl.say("  no crest on the walk - JUMPING at it (it sits 1.50 m over the deck)")
        pl.aim(47, -48)
        pl.jump(hold_ms=250, run_ms=400, n=8)
        pl.say("  ", json.dumps(full()), "snap", json.dumps(pl.snap()), "events", pl.ev())
        pl.shot("sky_crest_jump")
    pl.wait(3500)
    pl.say("  after the celebration:", json.dumps(pl.state()), "snap", json.dumps(pl.snap()))
    pl.shot("sky_crest_after")

    pl.say("  --- THE CHAFF CANNON [14, 23.10, -40], target = the sky platform ---")
    tp(14.0, 24.0, -37.0)
    pl.say("  at the cannon:", json.dumps(full())); pl.shot("cannon_approach")
    pl.go(14.0, -40.0, tol=1.2, max_ms=9000, reaim_ms=400, tag="into the cannon")
    pl.wait(600)
    pl.tap("E", 140); pl.wait(1200)
    pl.say("  pressed E ->", json.dumps(full()), "events", pl.ev())
    pl.shot("cannon_in")
    pl.tap("SPACE", 140); pl.wait(3000)
    pl.say("  pressed SPACE ->", json.dumps(full()), "events", pl.ev(), "deaths", pl.deaths())
    pl.shot("cannon_fired")

    pl.say("")
    pl.say("=== OVER-DRESSING CHECK: what the frame is made of at the yard ===")
    tp(22.0, 24.3, -44.0)
    pl.wait(1200)
    st = pl.js("""()=>{const e=CRESTBOUND.engine, s=e.stats; return {fps:+s.fps.toFixed(1),
        draws:s.drawCalls, tris:s.tris, p99:+s.p99Ms.toFixed(1)};}""")
    pl.say("  mill yard:", json.dumps(st))
    for name, p in (("sky platform", (47, 36.6, -48)), ("ridge path", (-4, 19.9, -30)),
                    ("granary terrace", (4, 14.3, -14)), ("spawn", (0, 2.6, 42))):
        tp(p[0], p[1], p[2]); pl.wait(1400)
        st = pl.js("""()=>{const s=CRESTBOUND.engine.stats; return {fps:+s.fps.toFixed(1),
            draws:s.drawCalls, tris:s.tris, p99:+s.p99Ms.toFixed(1)};}""")
        pl.say("  %-18s %s" % (name, json.dumps(st)))
        pl.shot("dress_" + name.replace(" ", "_"))

    pl.dump("wm_c")
    pl.say("CONSOLE:", json.dumps(pl.console[:25]))
