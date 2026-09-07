"""rime-1 — what exactly is under the ice plug, and what crushes a player stood on it."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _r1step import Step

OUT = os.path.join(HERE, "_r1ice.txt")
_l = []


def P(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    _l.append(s)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(_l))


Q = r"""([x0,z0,x1,z1]) => { const T = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase;
  const box = new T.Box3(new T.Vector3(x0, -3, z0), new T.Vector3(x1, 5, z1));
  const out = []; bp.query(box, out);
  return out.map(c => ({
    kind: (c.props && c.props.kind) || (c.ref && c.ref.kind) || '?',
    surface: c.surface, breakable: !!(c.props && c.props.breakable),
    c: [+c.center.x.toFixed(2), +c.center.y.toFixed(2), +c.center.z.toFixed(2)],
    h: [+c.half.x.toFixed(2), +c.half.y.toFixed(2), +c.half.z.toFixed(2)],
    zspan: [+(c.center.z - c.half.z).toFixed(2), +(c.center.z + c.half.z).toFixed(2)],
    xspan: [+(c.center.x - c.half.x).toFixed(2), +(c.center.x + c.half.x).toFixed(2)],
    top: +(c.center.y + c.half.y).toFixed(2),
    active: !!c.active, solid: !!c.solid })); }"""

if __name__ == "__main__":
    with Step("rime1ice") as p:
        p.boot("rime-1")

        P("== every collider in the plug's footprint (x 3..7, z 39..45) ==")
        for c in p.js(Q, [3.0, 39.0, 7.0, 45.0]):
            P("   ", json.dumps(c))

        P("\n== stand on the plug and watch the crush, frame by frame ==")
        p.js("() => { const G = CRESTBOUND.game; if (!G.__dh) { G.__deaths = [];"
             " const o = G.onDeath.bind(G); G.onDeath = function (c) { G.__deaths.push({cause:String(c),"
             " p:[+G.player.pos.x.toFixed(2),+G.player.pos.y.toFixed(2),+G.player.pos.z.toFixed(2)],"
             " res: G.player._lastRes ? {crushed: !!G.player._lastRes.crushed, walls: (G.player._lastRes.walls||[]).length,"
             " ceiling: !!G.player._lastRes.ceiling, surface: G.player._lastRes.surface} : null }); return o(c); }; G.__dh = 1; }"
             " CRESTBOUND.game.__deaths.length = 0; }")
        p.place(5.0, 1.60, 42.0, 0.0)
        s = p.run(360, 20)
        P("  track:", json.dumps([(q["i"], q["st"], q["p"], q["g"], q["sur"]) for q in s]))
        P("  deaths:", json.dumps(p.js("() => CRESTBOUND.game.__deaths")))

        P("\n== the same, 1 m NORTH of the plug (5, 44.5) — outside the overlap? ==")
        p.js("() => { CRESTBOUND.game.__deaths.length = 0; }")
        p.place(5.0, 1.60, 44.5, 0.0)
        s = p.run(360, 40)
        P("  track:", json.dumps([(q["i"], q["st"], q["p"], q["g"]) for q in s]))
        P("  deaths:", json.dumps(p.js("() => CRESTBOUND.game.__deaths")))

        P("\n== the same, on the west slab (-5, 44) ==")
        p.js("() => { CRESTBOUND.game.__deaths.length = 0; }")
        p.place(-5.0, 1.60, 44.0, 0.0)
        s = p.run(360, 40)
        P("  track:", json.dumps([(q["i"], q["st"], q["p"], q["g"]) for q in s]))
        P("  deaths:", json.dumps(p.js("() => CRESTBOUND.game.__deaths")))

        P("\n== now POUND the plug straight away and see if the hole opens ==")
        p.js("() => { CRESTBOUND.game.__deaths.length = 0; }")
        p.place(5.0, 1.60, 42.0, 0.0)
        p.run(10, 10)
        p.press("Space"); p.run(9, 9); p.release("Space"); p.run(6, 6)
        p.press("KeyC"); p.run(8, 8); p.release("KeyC")
        s = p.run(70, 7)
        P("  pound track:", json.dumps([(q["i"], q["st"], q["p"], q["g"], q["water"]) for q in s]))
        P("  breakables:", json.dumps(p.brk()))
        P("  flags:", json.dumps(p.js("() => ['ice-hole-open'].map(k => [k, CRESTBOUND.game.save.flags.get(k)])")))
        P("  colliders in the footprint AFTER the pound:")
        for c in p.js(Q, [3.0, 39.0, 7.0, 45.0]):
            P("   ", json.dumps(c))
        s = p.run(200, 20)
        P("  after 200 more frames:", json.dumps([(q["i"], q["st"], q["p"], q["water"], q["sub"]) for q in s]))
        P("  deaths:", json.dumps(p.js("() => CRESTBOUND.game.__deaths")))
        P("  collectibles:", json.dumps(p.snapc()))
        p.shotnow("ice_after_pound")

        P("\n== what is over the lake? critters ==")
        P(json.dumps(p.js(
            "() => (CRESTBOUND.game.course.critters||[]).map(c => ({k: c.kind || (c.def && c.def.kind),"
            " p: c.mesh ? [+c.mesh.position.x.toFixed(2), +c.mesh.position.y.toFixed(2), +c.mesh.position.z.toFixed(2)] : null,"
            " kills: (c.kills||[]).length, cols: (c.colliders||[]).length }))")))
