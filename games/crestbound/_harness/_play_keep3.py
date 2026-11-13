"""PLAYTEST — THE KEEP, run 3: nail the grand staircase (P6) down. Walk every
flight from BOTH ends; probe the colliders under the treads; and re-do the
verdant-1 approach cleanly (run 1's 'stuck' was my own re-aiming, not the game)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 40
    P.click_title(); P.wait(2500)

    # ------------------------------------------------ 1. verdant-1, cleanly
    P.say("=== 1. VERDANT-1, ONE HEADING, NO RE-AIMING (what a player does) ===")
    P.tp(0, 0.05, -1.0); P.wait(500)
    P.face(-20, -6)
    P.shot("v1_from_spawn_looking_at_it")
    P.down("W")
    hit = None
    for i in range(30):
        P.wait(200)
        st = P.state()
        if st["cardOpen"]:
            hit = i * 0.2
            break
    P.up("W"); P.wait(800)
    st = P.state()
    P.say("  card after %s s of holding W: %s  pos %s" % (hit, st["cardOpen"], st["pos"]))
    P.shot("v1_card_open")
    P.pg.keyboard.press("Escape"); P.wait(1500)
    P.say("  after ESC:", P.state()["gstate"], P.pos())

    # ------------------------------------------------------ 2. THE STAIRCASE
    P.say("=== 2. GRAND STAIRCASE — every flight, both ends ===")
    trials = [
        ("WEST flank, from the LOBBY (south, y0)",  (-13.0, 0.05, -3.4),  (-13.0, -30.0)),
        ("WEST flank, from the LANDING (north, y2.7)", (-13.0, 2.75, -8.8), (-13.0, 20.0)),
        ("EAST flank, from the LOBBY (south, y0)",  (13.0, 0.05, -3.4),   (13.0, -30.0)),
        ("EAST flank, from the LANDING (north, y2.7)", (13.0, 2.75, -8.8), (13.0, 20.0)),
        ("MIDDLE flight, from the LANDING (north, y2.7)", (0.0, 2.75, -8.8), (0.0, 20.0)),
        ("MIDDLE flight, from the GALLERY (south, y6.3)", (0.0, 6.35, -2.4), (0.0, -30.0)),
    ]
    for name, tp, aim in trials:
        P.tp(*tp); P.wait(500)
        p0 = P.pos()
        P.face(*aim)
        s = P.hold(["W"], 4500, sample_ms=250)
        p1 = P.pos()
        ys = sorted(set(round(x["pos"][1], 2) for x in s))
        states = sorted(set(x["pstate"] for x in s))
        dy = p1[1] - p0[1]
        P.say("  %-46s start %s -> end %s  dy %+.2f  y seen %s  states %s"
              % (name, p0, p1, dy, ys, states))
        P.shot("stair_" + name.split(",")[0].replace(" ", "").lower() + "_" +
               ("fromlobby" if "LOBBY" in name else "fromlanding" if "LANDING" in name else "fromgallery"))

    # ------------------------------- 3. what does the collider actually look like
    P.say("=== 3. WHAT IS UNDER THE TREADS — broadphase boxes around the west flight ===")
    boxes = P.js("""() => { const C = CRESTBOUND.game.course, out = [];
        const bp = C.broadphase; const list = bp.all || bp._all || bp.colliders || null;
        const seen = [];
        // query a box that covers the west flank flight
        const THREE = CRESTBOUND.THREE;
        const aabb = new THREE.Box3(new THREE.Vector3(-16,-1,-9.5), new THREE.Vector3(-10,4,-3.5));
        const res = []; bp.query(aabb, res);
        for (const c of res) {
          const b = c.aabb;
          out.push({ mat: c.surface||null, solid: c.solid!==false,
            min:[+b.min.x.toFixed(2),+b.min.y.toFixed(2),+b.min.z.toFixed(2)],
            max:[+b.max.x.toFixed(2),+b.max.y.toFixed(2),+b.max.z.toFixed(2)] });
        }
        return out.sort((a,b)=>a.min[2]-b.min[2]).slice(0,40); }""")
    for b in boxes:
        P.say("   ", b)

    P.say("=== 4. how the DEF says it should be ===")
    P.say("   stairs([-13.0, 0, -6.27], w 4.0, rise 0.30, run 0.46, n 9, yaw NORTH)")
    P.say("   => 9 treads, footprint z -8.34..-4.20, y 0.00 -> 2.70, top at z -8.34")

    P.dump("keep3")
