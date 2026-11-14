"""KEEP playtest pass B, run 9 — the rest of the courtyard.

lobby/courtyard overlap, the fountain statue, the climbable trees, the
wall-kick tower and its roof, the two AZURE stained-glass gates, the CRESTWAY.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB9") as P:
    P.click_title(); P.wait(1500)

    def look(tag, p, target, pitch=0.12):
        P.tp(p[0], p[1], p[2]); P.wait(500)
        P.face(target[0], target[1]); P.wait(200)
        P.js("(v) => { CRESTBOUND.game.cam.pitch = v; }", pitch)
        P.wait(500)
        P.shot(tag)
        P.say("  %s from %s -> %s" % (tag, P.pos(), json.dumps(P.state()["pstate"])))

    # ---------- 1. does the courtyard terrain grow through the lobby floor? ----------
    P.say("--- the lobby's south end (terrain hf covers z 13..48; the lobby floor runs to z 15) ---")
    look("lobby_south_end", [0, 0.3, 10.0], [0, 16.0], 0.0)
    look("lobby_south_end_down", [0, 0.3, 13.0], [0, 16.0], -0.45)
    look("lobby_se_corner", [8.0, 0.3, 12.0], [-6.0, 14.5], -0.30)
    grass = P.js("""() => { const G = CRESTBOUND.game, C = G.course, T = CRESTBOUND.THREE;
        const hf = (C.broadphase.heightfields||[])[0];
        const rows = [];
        for (const z of [12, 13, 13.5, 14, 14.5, 15, 16]) {
          const y = hf ? hf.heightAt(0, z) : NaN;
          rows.push({z, hf: Number.isNaN(y) ? null : +y.toFixed(3)}); }
        return rows; }""")
    P.say("  heightfield sampled under the lobby's south end:", json.dumps(grass))

    # ---------- 2. the fountain statue ----------
    look("statue_from_south", [0, 0.4, 27.4], [0, 30.0], 0.10)
    look("statue_from_east", [3.6, 0.4, 30.0], [0, 30.0], 0.10)

    # ---------- 3. the climbable trees ----------
    P.say("--- the trees: walk PAST one, does it grab me? ---")
    P.tp(-13.0, 0.3, 24.0); P.wait(600)
    P.shot("tree_before")
    r = P.walk_to(-13.0, 16.0, tol=1.4, max_ms=9000, tag="walking past the tree at [-13,0,20]")
    st = P.state()
    P.say("  walking past the tree ended: %s state=%s climbing=%s" % (st["pos"], st["pstate"], st["climbing"]))
    P.shot("tree_walked_past")
    # deliberately climb it
    P.tp(-13.0, 0.3, 21.6); P.wait(500)
    P.face(-13.0, 20.0)
    P.hold(["W"], 2600, sample_ms=500, tag="into the tree")
    st = P.state()
    P.say("  pressing into the trunk: %s state=%s" % (st["pos"], st["pstate"]))
    P.shot("tree_climb")
    if st["pstate"] == "climb":
        P.hold(["W"], 2500, sample_ms=500, tag="climbing up")
        P.say("  climbed to:", P.pos())
        P.shot("tree_climbed_up")
        P.tap("SPACE", 200); P.wait(1400)
        P.say("  after kicking off:", P.pos(), P.state()["pstate"])
        P.shot("tree_kickoff")

    # ---------- 4. the tower ----------
    towers = P.js("""() => (CRESTBOUND.game.course.def.objects||[])
        .filter(o => o.p && o.p[0] < -14 && o.p[2] > 28 && o.p[1] > 0 && o.p[1] < 14)
        .map(o => ({kind:o.kind, p:o.p, s:o.s||null, text:o.text||null, of:o.of||o.mat||null})).slice(0,40)""")
    P.say("objects around the tower (x<-14, z>28):")
    for t in towers:
        P.say("   ", json.dumps(t))
    look("tower_from_the_lawn", [-13.0, 0.3, 31.0], [-19.0, 33.0], 0.25)
    P.say("--- wall-kick up the tower shaft ---")
    P.tp(-19.0, 0.3, 33.0); P.wait(700)
    P.shot("tower_inside_shaft")
    P.say("  in the shaft:", json.dumps(P.state()))
    best = P.pos()[1]
    for i in range(6):
        P.face(-17.4, 33.0)
        P.down("W"); P.wait(260); P.tap("SPACE", 200); P.wait(300)
        P.face(-20.6, 33.0)
        P.tap("SPACE", 200); P.wait(320)
        P.up("W")
        st = P.state()
        best = max(best, st["pos"][1])
        P.say("   kick pair %d -> y=%.2f %s %s" % (i, st["pos"][1], st["pstate"], st["pos"]))
        P.wait(400)
    P.shot("tower_after_kicks")
    P.say("  wall kick reached y=%.2f (first ledge 3.40, roof 12.60)" % best)
    # look at the roof and the azure-3 door
    look("tower_roof", [-19.7, 12.9, 33.0], [-17.0, 38.4], 0.0)
    look("azure3_door", [-17.0, 12.9, 36.0], [-17.0, 38.4], 0.10)

    # ---------- 5. the azure glass gates + the crestway ----------
    look("azure1_gate", [22.0, 0.4, 30.0], [26.0, 30.0], 0.28)
    look("azure2_gate", [-20.0, 0.4, 22.0], [-24.0, 22.0], 0.28)
    look("crestway", [0, 0.4, 42.0], [0, 48.0], 0.22)
    P.dump("keepB9")
