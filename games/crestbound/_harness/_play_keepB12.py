"""KEEP playtest pass B, run 12 — Old Fen up close, the middle flight, the
gallery loop blockage, and where the balcony actually is.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB12") as P:
    P.click_title(); P.wait(1500)

    # ---------- OLD FEN, right next to him ----------
    P.say("--- Old Fen at [17, 6.35, -21] ---")
    fen = P.js("""() => { const n = CRESTBOUND.game.course.def.npcs[0];
        const c = (CRESTBOUND.game.course.critters||[]).find(c => c.kind === 'fen' || (c.def&&c.def.kind==='fen'));
        return {def: n, hasCritter: !!c, lines: n.lines ? n.lines.length : null,
                firstLine: n.lines ? n.lines[0] : null}; }""")
    P.say("  fen def:", json.dumps(fen)[:400])
    for d, tag in [(1.2, "1.2m"), (2.0, "2.0m"), (3.5, "3.5m")]:
        P.tp(17.0 + d, 6.5, -21.0); P.wait(700)
        P.face(17.0, -21.0); P.wait(400)
        prompt = P.js("""() => [...document.querySelectorAll('.cb-prompt, .cb-prompt *')]
            .filter(e => e.offsetParent !== null && e.children.length === 0)
            .map(e => (e.textContent||'').trim()).filter(Boolean)""")
        P.say("  at %s from Fen: prompt=%s" % (tag, json.dumps(prompt)))
        P.shot("fen_at_" + tag)
        P.tap("E", 140); P.wait(1200)
        after = P.js("""() => ({ prompt: [...document.querySelectorAll('.cb-prompt, .cb-prompt *, .cb-dialog, .cb-dialog *, .cb-toast, .cb-toast *')]
            .filter(e => e.offsetParent !== null && e.children.length === 0)
            .map(e => (e.textContent||'').trim()).filter(Boolean),
            state: CRESTBOUND.game.state })""")
        P.say("     after E:", json.dumps(after))
        P.shot("fen_afterE_" + tag)

    # ---------- the middle flight's collider stack ----------
    P.say("--- the middle flight of the grand stair (x -4.5..4.5, z -9..-2) ---")
    cols = P.js("""() => { const T = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase, hits = [];
        bp.query(new T.Box3(new T.Vector3(-5,1.5,-9.5), new T.Vector3(5,7.5,-2)), hits);
        return hits.map(c => ({y:+c.aabb.max.y.toFixed(2), z:[+c.aabb.min.z.toFixed(2),+c.aabb.max.z.toFixed(2)],
                               x:[+c.aabb.min.x.toFixed(2),+c.aabb.max.x.toFixed(2)]}))
                   .sort((a,b)=>a.z[0]-b.z[0]); }""")
    for c in cols:
        P.say("   top y %5.2f   z %6.2f..%6.2f   x %6.2f..%6.2f" % (c["y"], c["z"][0], c["z"][1], c["x"][0], c["x"][1]))
    # walk it from the gallery end downward
    P.tp(0, 6.5, -2.4); P.wait(700)
    P.say("  standing at the gallery end of the middle flight:", json.dumps(P.state()))
    P.shot("midflight_top")
    P.face(0, -9.0)
    s = P.hold(["W"], 3600, sample_ms=360, tag="walking north down the middle flight")
    P.say("  ys:", [round(x["pos"][1], 2) for x in s])
    P.shot("midflight_after")
    # and from the landing end upward
    P.tp(0, 2.9, -8.0); P.wait(700)
    P.say("  standing on the landing:", json.dumps(P.state()))
    P.shot("landing")
    P.face(0, -2.0)
    s = P.hold(["W"], 3600, sample_ms=360, tag="walking south up the middle flight")
    P.say("  ys:", [round(x["pos"][1], 2) for x in s])
    P.say("  ended:", json.dumps(P.state()))
    P.shot("landing_after")

    # ---------- the gallery loop's south leg ----------
    P.say("--- what blocks the gallery's south leg at x -5.7, z -3.5? ---")
    blockers = P.js("""() => { const T = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase, hits = [];
        bp.query(new T.Box3(new T.Vector3(-8,6,-5), new T.Vector3(8,9,-2)), hits);
        return hits.map(c => ({y:[+c.aabb.min.y.toFixed(2),+c.aabb.max.y.toFixed(2)],
            x:[+c.aabb.min.x.toFixed(2),+c.aabb.max.x.toFixed(2)],
            z:[+c.aabb.min.z.toFixed(2),+c.aabb.max.z.toFixed(2)]})); }""")
    for b in blockers:
        P.say("   y %5.2f..%5.2f  x %6.2f..%6.2f  z %6.2f..%6.2f" % (
            b["y"][0], b["y"][1], b["x"][0], b["x"][1], b["z"][0], b["z"][1]))
    P.tp(-8.0, 6.5, -3.5); P.wait(600)
    P.shot("south_leg_blocked")
    P.face(8.0, -3.5)
    P.hold(["W"], 2600, sample_ms=650, tag="east along the south leg")
    P.say("  ended:", json.dumps(P.state()))
    P.shot("south_leg_after")

    # ---------- where IS the balcony? ----------
    bal = P.js("""() => (CRESTBOUND.game.course.def.objects||[])
        .filter(o => o.p && o.p[1] > 4.5 && o.p[1] < 8.5 && o.p[2] > 12 && o.p[2] < 28)
        .map(o => ({kind:o.kind, p:o.p, s:o.s||null, text:o.text||null}))""")
    P.say("everything at gallery height between z 12 and 28 (the balcony + loft):")
    for b in bal:
        P.say("   ", json.dumps(b))
    P.dump("keepB12")
