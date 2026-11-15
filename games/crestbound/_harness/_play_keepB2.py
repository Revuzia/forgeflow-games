"""KEEP playtest pass B, run 2 — the lobby and THE GRAND STAIRCASE (P6).

Owner: "the images have odd stairs but i cant reach the main stairs".
Walk it like a player: to the foot of the west flight, hold W north, sample y.
Then the east flight, then the middle flight up out of the landing.
Also: the E prompt that appears at spawn, and the lobby's stray props.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

LOBBY = 0.0
with Play("keep") as P:
    P.click_title(); P.wait(1200)
    P.say("state:", json.dumps(P.state()))

    # ---- the E prompt that is on screen at spawn ----
    prompt = P.js("""() => { const els = [...document.querySelectorAll('*')].filter(e =>
        e.children.length === 0 && /OLD FEN|FIND THE PAINTINGS/i.test(e.textContent||''));
        return els.map(e => { const r = e.getBoundingClientRect();
          return {txt:(e.textContent||'').trim().slice(0,60), cls:e.className, x:Math.round(r.x), y:Math.round(r.y)}; }); }""")
    P.say("on-screen prompt at spawn:", json.dumps(prompt))
    fen = P.js("() => { const n = CRESTBOUND.game.course.def.npcs[0]; const p = CRESTBOUND.game.player.pos; return {fen:n.p, dist:+Math.hypot(n.p[0]-p.x, n.p[1]-p.y, n.p[2]-p.z).toFixed(2)}; }")
    P.say("distance from spawn to OLD FEN:", json.dumps(fen))
    P.tap("E", 120); P.wait(900)
    P.say("after pressing E at spawn:", json.dumps(P.state()))
    P.shot("spawn_pressE")

    # ---- look around the lobby: 4 yaws from the spawn pad ----
    for name, yaw in [("north", 0.0), ("east", -1.5708), ("south", 3.1416), ("west", 1.5708)]:
        P.js("(y) => { CRESTBOUND.game.cam.yaw = y; CRESTBOUND.game.player.__test.setFacing(y); }", yaw)
        P.wait(700)
        P.shot("lobby_look_" + name)

    # ================= THE GRAND STAIRCASE =================
    def climb(tag, foot, top, walk_z):
        P.say("--- %s: from foot %s toward %s ---" % (tag, foot, top))
        P.tp(foot[0], foot[1], foot[2]); P.wait(500)
        # walk the last 2 m to the foot on foot so we see what a player sees
        P.walk_to(foot[0], foot[2] + (1.6 if walk_z > 0 else -1.6), tol=0.8, max_ms=3000, tag=tag + " approach")
        P.shot(tag + "_at_foot")
        y0 = P.pos()[1]
        samples = P.hold(["W"], 4200, sample_ms=350, tag=tag + " climbing")
        ys = [s["pos"][1] for s in samples]
        end = P.state()
        P.shot(tag + "_after_climb")
        P.say("  %s: y %.2f -> %.2f (want %.2f). ys=%s pstate=%s pos=%s" % (
            tag, y0, end["pos"][1], top, [round(y, 2) for y in ys], end["pstate"], end["pos"]))
        return {"tag": tag, "y0": y0, "y1": end["pos"][1], "want": top, "pos": end["pos"], "pstate": end["pstate"]}

    res = []
    # west flight: footprint z -4.20 (foot, y0) .. -8.34 (top, y 2.70), climbs -Z
    P.js("() => { const G = CRESTBOUND.game; G.cam.yaw = 0; G.player.__test.setFacing(0); }")
    res.append(climb("stairW", [-13.0, 0.2, -3.2], 2.70, -1))
    P.js("() => { const G = CRESTBOUND.game; G.cam.yaw = 0; G.player.__test.setFacing(0); }")
    res.append(climb("stairE", [13.0, 0.2, -3.2], 2.70, -1))

    # the exact geometry of the west flight, as the collider sees it
    cols = P.js("""() => { const bp = CRESTBOUND.game.course.broadphase, out = [];
        const box = new CRESTBOUND.THREE.Box3(new CRESTBOUND.THREE.Vector3(-16,-1,-10),
                                              new CRESTBOUND.THREE.Vector3(-10,4,-2));
        const hits = []; bp.query(box, hits);
        for (const c of hits) { const b = c.aabb; out.push({
            min:[+b.min.x.toFixed(2),+b.min.y.toFixed(2),+b.min.z.toFixed(2)],
            max:[+b.max.x.toFixed(2),+b.max.y.toFixed(2),+b.max.z.toFixed(2)],
            surf: c.surface }); }
        return out.sort((a,b) => a.min.z - b.min.z); }""")
    P.say("colliders in the west-flight box (sorted by z):")
    for c in cols:
        P.say("   y %5.2f..%5.2f   z %6.2f..%6.2f   x %6.2f..%6.2f  %s" % (
            c["min"][1], c["max"][1], c["min"][2], c["max"][2], c["min"][0], c["max"][0], c["surf"]))

    P.say("RESULTS:", json.dumps(res))
    P.dump("keepB2")
