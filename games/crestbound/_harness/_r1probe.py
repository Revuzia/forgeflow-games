import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _playlib import Play

OUT = os.path.join(HERE, "_r1probe.txt")
lines = []


def P(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    lines.append(s)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


with Play("rime1probe") as p:
    p.click_title(); p.wait(800)
    p.js("() => CRESTBOUND.game.__dev.unlockAll()")
    p.js("() => CRESTBOUND.game.__dev.goto('rime-1')")
    for _ in range(60):
        p.wait(300)
        if p.state()["course"] == "rime-1" and p.state()["gstate"] == "playing":
            break
    p.wait(2500)

    P("== EVERY mesh whose world XZ is on the lake ice (|x|<12.5, |z-44|<12.5), y 1.2..4 ==")
    P(json.dumps(p.js("""() => {
      const out = []; const V = new CRESTBOUND.THREE.Vector3();
      CRESTBOUND.engine.scene.traverse(o => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        o.getWorldPosition(V);
        if (Math.abs(V.x) < 12.5 && Math.abs(V.z - 44) < 12.5 && V.y > 1.2 && V.y < 4.5)
          out.push([o.name || o.type, o.isInstancedMesh ? o.count : 1,
                    +V.x.toFixed(1), +V.y.toFixed(1), +V.z.toFixed(1),
                    (o.material && o.material.name) || '']);
      });
      return out; }""")))

    P("\n== INSTANCED meshes anywhere, with their instance count and material ==")
    P(json.dumps(p.js("""() => { const out = [];
      CRESTBOUND.engine.scene.traverse(o => { if (o.isInstancedMesh)
        out.push([o.name || 'inst', o.count, (o.material && o.material.name) || '', o.visible,
                  o.geometry ? o.geometry.attributes.position.count : 0]); });
      return out; }""")))

    P("\n== where are the first 40 instances of each instanced mesh with 'drift' or 'deco' in it? ==")
    P(json.dumps(p.js("""() => { const T = CRESTBOUND.THREE, out = [];
      const m = new T.Matrix4(), v = new T.Vector3();
      CRESTBOUND.engine.scene.traverse(o => {
        if (!o.isInstancedMesh) return;
        const pts = [];
        for (let i = 0; i < Math.min(o.count, 400); i++) {
          o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
          if (Math.abs(v.x) < 12.5 && Math.abs(v.z - 44) < 12.5)
            pts.push([+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)]);
        }
        if (pts.length) out.push([o.name || 'inst', o.count, pts.length, pts.slice(0, 12)]);
      });
      return out; }""")))

    P("\n== particle system objects ==")
    P(json.dumps(p.js("""() => { const out = [];
      CRESTBOUND.engine.scene.traverse(o => { if (o.isPoints || o.isSprite)
        out.push([o.name || o.type, o.type, o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0, o.visible]); });
      return out; }""")))

    P("\n== BREAKABLE hazards ==")
    P(json.dumps(p.js("""() => (CRESTBOUND.game.course.hazards || []).map((h, i) => ({
        i, kind: h.kind || (h.def && h.def.kind), p: h.def && h.def.p,
        drop: h.def && h.def.drop, trig: h.def && h.def.trigger,
        broken: !!h.broken, cols: (h.colliders || []).map(c => !!c.active),
        onPound: typeof h.onPound, keys: Object.keys(h).slice(0, 18) }))
      .filter(h => h.kind === 'breakable')""")))

    P("\n== hazard kinds ==")
    P(json.dumps(p.js("""() => { const m = {}; (CRESTBOUND.game.course.hazards||[]).forEach(h => {
        const k = h.kind || (h.def && h.def.kind) || '?'; m[k] = (m[k]||0)+1; }); return m; }""")))

    P("\n== water volumes ==")
    P(json.dumps(p.js("""() => (CRESTBOUND.game.course.volumes||[]).map(v => [v.kind,
       +v.center.x.toFixed(2), +v.center.y.toFixed(2), +v.center.z.toFixed(2),
       +v.half.x.toFixed(2), +v.half.y.toFixed(2), +v.half.z.toFixed(2)])""")))

    P("\n== POUND the plug dead centre ==")
    p.js("() => CRESTBOUND.game.__dev.tp(5, 2.0, 42.0)")
    p.wait(1400)
    P("  before:", json.dumps(p.state()))
    p.tap("SPACE", 140)
    p.wait(230)
    p.down("C")
    seq = []
    for _ in range(9):
        p.wait(130)
        s = p.state()
        seq.append(s["pstate"] + "@" + str(s["pos"][1]))
    p.up("C")
    for _ in range(8):
        p.wait(220)
        s = p.state()
        seq.append(s["pstate"] + "@" + str(s["pos"][1]))
    P("  sequence:", seq)
    P("  after:", json.dumps(p.state()))
    P("  breakable now:", json.dumps(p.js("""() => (CRESTBOUND.game.course.hazards||[])
      .filter(h => (h.kind||(h.def&&h.def.kind))==='breakable')
      .map(h => [h.def && h.def.p, !!h.broken, (h.colliders||[]).map(c => !!c.active), h.mesh ? h.mesh.visible : null])""")))
    P("  flags:", json.dumps(p.js("() => ['ice-hole-open','gnasher-freed','hay-wall-broken']"
                                  ".map(k => [k, CRESTBOUND.game.save.flags.get(k)])")))
    p.shot("probe_after_pound")

    P("\n== ring positions vs the ground under them ==")
    P(json.dumps(p.js("""() => { const hs = (CRESTBOUND.game.course.hazards||[])
        .filter(h => (h.kind||(h.def&&h.def.kind))==='rings');
      const bp = CRESTBOUND.game.course.broadphase;
      const hf = bp.heightfields && bp.heightfields[0];
      if (!hs.length) return 'no rings hazard';
      return hs.map(h => ((h.def && h.def.pts) || []).map(pt => ({
        pt, ground: hf ? +hf.heightAt(pt[0], pt[2]).toFixed(2) : null,
        clear: hf ? +(pt[1] - hf.heightAt(pt[0], pt[2])).toFixed(2) : null }))); }""")))

    P("\n== the FROST COTTAGE spawn sign: is it a collider the camera can see? ==")
    P(json.dumps(p.js("""() => { const T = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase;
      const box = new T.Box3(new T.Vector3(4.0, 0, 55.5), new T.Vector3(6.5, 5, 58.5));
      const out = []; bp.query(box, out);
      return out.map(c => [(c.props && c.props.kind) || '?', c.surface,
        [+c.center.x.toFixed(2), +c.center.y.toFixed(2), +c.center.z.toFixed(2)],
        [+c.half.x.toFixed(2), +c.half.y.toFixed(2), +c.half.z.toFixed(2)], !!c.solid]); }""")))
