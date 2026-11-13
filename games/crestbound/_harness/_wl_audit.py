"""WATER LANE — audit every water body on the live page.

For each course with water: surfaceY vs the ground around the box perimeter
(raycast: boxes + heightfields), the Gerstner crest height the body can reach
(sum of the wave amplitudes x uAmp), the baked aShore attribute statistics,
the material's live uniforms/defines, and a station frame per body.

    python _wl_audit.py [--courses keep,verdant-3] [--tag name]
"""
import argparse, json, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

HERE = os.path.dirname(os.path.abspath(__file__))
WATER_COURSES = ["keep", "verdant-1", "verdant-2", "verdant-3", "ember-2", "rime-1", "rime-2", "azure-1"]

LOAD_JS = r"""async (id) => { const G=CRESTBOUND.game; const t0=performance.now();
  const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
  if (!live()) await G.__dev.goto(id);
  const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};requestAnimationFrame(f);setTimeout(f,60);});
  while(performance.now()<t0+40000&&!live()) await tick(); return live(); }"""

AUDIT_JS = r"""() => {
  const A = CRESTBOUND, G = A.game, C = G.course, THREE = A.THREE, bp = C.broadphase;
  const hfs = (bp && bp.heightfields) || [];
  const hfAt = (x, z) => { let best = NaN; for (const h of hfs) { const g = h.heightAt(x, z); if (g === g && !(best === best) || (g === g && g > best)) best = g; } return best; };
  const o = new THREE.Vector3(), d = new THREE.Vector3(0, -1, 0), hit = { t: 0, normal: new THREE.Vector3(), collider: null };
  const rayDown = (x, y0, z, maxD) => { o.set(x, y0, z); const ok = bp.raycast(o, d, maxD, hit); return ok ? y0 - hit.t : NaN; };
  const out = [];
  for (const w of (C.waters || [])) {
    const def = w.def || {}, v = w.volume, m = w.mesh, mat = m && m.material;
    const u = (mat && mat.uniforms) || {};
    const uv = (k) => (u[k] && u[k].value !== undefined) ? (u[k].value.isColor ? '#' + u[k].value.getHexString() : (u[k].value.isVector4 ? u[k].value.toArray() : (u[k].value.isVector2 ? u[k].value.toArray() : u[k].value))) : null;
    const amp = +uv('uAmp') || 0;
    let crest = 0;
    for (const k of ['uWaveA', 'uWaveB', 'uWaveC']) { const wv = uv(k); if (!wv) continue; const kk = 6.283185307 / Math.max(wv[3], 0.25); crest += Math.min(1, Math.max(0, wv[2])) * amp / kk; }
    const sy = w.surfaceY;
    const cx = v.center.x, cz = v.center.z, hx = v.half.x, hz = v.half.z;
    // perimeter: ON the edge and 0.6 m outside, 1 m steps
    const per = [];
    const pushPt = (x, z, where) => {
      const g = rayDown(x, sy + crest + 3.0, z, 40);
      const h = hfAt(x, z);
      const gg = (g === g) ? g : h;
      per.push({ x: +x.toFixed(1), z: +z.toFixed(1), g: (gg === gg) ? +gg.toFixed(2) : null, hf: (h === h) ? +h.toFixed(2) : null, where });
    };
    for (let x = cx - hx; x <= cx + hx + 1e-6; x += 1.0) { pushPt(x, cz - hz, 'S'); pushPt(x, cz + hz, 'N'); pushPt(x, cz - hz - 0.6, 'S+'); pushPt(x, cz + hz + 0.6, 'N+'); }
    for (let z = cz - hz; z <= cz + hz + 1e-6; z += 1.0) { pushPt(cx - hx, z, 'W'); pushPt(cx + hx, z, 'E'); pushPt(cx - hx - 0.6, z, 'W+'); pushPt(cx + hx + 0.6, z, 'E+'); }
    const known = per.filter(p => p.g !== null);
    const below = known.filter(p => p.g < sy + crest);
    const belowSurf = known.filter(p => p.g < sy);
    let minG = Infinity, minP = null;
    for (const p of known) if (p.g < minG) { minG = p.g; minP = p; }
    // interior: where is the ground vs the surface (a grid, 2 m)
    // TERRAIN-ONLY interior (pass 2, the wade release): the shaped volume answers
    // "water" only where the terrain under the point is >= wade below the surface
    const wade = (v.props && typeof v.props.wade === 'number') ? v.props.wade : 0;
    const relY = (typeof v.bedReleaseY === 'number') ? v.bedReleaseY : (sy - wade);
    let tN = 0, tNaN = 0, tWater = 0, tBank = 0, tDry = 0, tDeep = Infinity, tSum = 0;
    for (let x = cx - hx + 0.5; x < cx + hx; x += 1) for (let z = cz - hz + 0.5; z < cz + hz; z += 1) {
      const g = hfAt(x, z); tN++;
      if (!(g === g)) { tNaN++; continue; }
      tSum += g; if (g < tDeep) tDeep = g;
      if (g >= sy - 0.03) tDry++;
      if (g < relY) tWater++; else tBank++;
    }
    const terrainOnly = { n: tN, noTerrain: tNaN, water: tWater, bank: tBank, dry: tDry, deepest: (tDeep === Infinity ? null : +tDeep.toFixed(2)),
      mean: (tN - tNaN) ? +(tSum / (tN - tNaN)).toFixed(2) : null, wade, releaseY: +relY.toFixed(2), shaped: typeof v.bedReleaseY === 'number' };
    let nIn = 0, nDryIn = 0, nShallow = 0, deepest = Infinity, bedSum = 0;
    for (let x = cx - hx + 1; x < cx + hx; x += 2) for (let z = cz - hz + 1; z < cz + hz; z += 2) {
      const g = rayDown(x, sy + crest + 3.0, z, 60); if (!(g === g)) continue; nIn++; bedSum += g;
      if (g >= sy - 0.03) nDryIn++; else if (sy - g < 0.5) nShallow++;
      if (g < deepest) deepest = g;
    }
    // aShore stats
    let sh = null;
    if (m && m.geometry && m.geometry.attributes.aShore) {
      const a = m.geometry.attributes.aShore.array; const n = a.length / 2;
      let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9, xs = 0, ys = 0, yLt1 = 0, xGt5 = 0;
      for (let i = 0; i < n; i++) { const X = a[i*2], Y = a[i*2+1]; xs += X; ys += Y; if (X < xmin) xmin = X; if (X > xmax) xmax = X; if (Y < ymin) ymin = Y; if (Y > ymax) ymax = Y; if (Y < 1.0) yLt1++; if (X > 0.5) xGt5++; }
      sh = { n, xMin: +xmin.toFixed(3), xMax: +xmax.toFixed(3), xMean: +(xs/n).toFixed(3), yMin: +ymin.toFixed(2), yMax: +ymax.toFixed(2), yMean: +(ys/n).toFixed(2), fracYlt1: +(yLt1/n).toFixed(3), fracXgt05: +(xGt5/n).toFixed(3) };
    }
    out.push({
      id: def.id || null, kind2: def.kind2 || 'lake', p: def.p, s: def.s, res: def.res || null, flow: def.flow || null,
      surfaceY: sy, volTop: +(v.center.y + v.half.y).toFixed(3), volBot: +(v.center.y - v.half.y).toFixed(3),
      matName: mat && mat.name, defines: mat && mat.defines ? Object.keys(mat.defines) : null, envMap: !!(mat && mat.envMap),
      uAmp: amp, crestMax: +crest.toFixed(3),
      u: { uOpacity: uv('uOpacity'), uDepthFade: uv('uDepthFade'), uShoreWidth: uv('uShoreWidth'), uCrestFoam: uv('uCrestFoam'), uRipple: uv('uRipple'), uGloss: uv('uGloss'), uDeep: uv('uDeep'), uShallow: uv('uShallow'), uFoam: uv('uFoam'), uFlow: uv('uFlow') },
      perimeter: { n: per.length, known: known.length, minGround: (minP ? minP.g : null), minAt: minP, belowCrest: below.length, belowSurface: belowSurf.length,
                   worst: below.slice().sort((a, b) => a.g - b.g).slice(0, 6) },
      interior: { samples: nIn, dry: nDryIn, shallowLt05: nShallow, deepest: (deepest === Infinity ? null : +deepest.toFixed(2)), meanBed: nIn ? +(bedSum/nIn).toFixed(2) : null },
      terrainOnly,
      aShore: sh, tris: m && m.geometry ? (m.geometry.index ? m.geometry.index.count/3 : m.geometry.attributes.position.count/3) : null,
      hfCount: hfs.length,
    });
  }
  // duplicates: coincident water meshes
  const meshes = []; C.group.traverse(o => { if (o.isMesh && /^water\./.test(o.name || '')) meshes.push({ name: o.name, y: +o.position.y.toFixed(3), x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2) }); });
  const vols = (C.volumes || []).filter(v => v.kind === 'water' || v.kind === 'current').map(v => ({ kind: v.kind, c: [+v.center.x.toFixed(2), +v.center.y.toFixed(2), +v.center.z.toFixed(2)], h: [+v.half.x.toFixed(2), +v.half.y.toFixed(2), +v.half.z.toFixed(2)], id: v.props && v.props.id, power: v.props && v.props.power }));
  const R = A.engine.renderer;
  return { course: C.def.id, bodies: out, waterMeshes: meshes, waterVolumes: vols, draws: R.info.render.calls, tris: R.info.render.triangles,
           post: (A.engine.post && A.engine.post.uniforms && A.engine.post.uniforms.uUnderwater) ? A.engine.post.uniforms.uUnderwater.value : null };
}"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--courses", default=",".join(WATER_COURSES))
    ap.add_argument("--tag", default="wl_audit")
    ap.add_argument("--shots", action="store_true")
    a = ap.parse_args()
    courses = [c for c in a.courses.split(",") if c]
    results = {}
    with Play(a.tag) as P:
        P.click_title(); P.wait(1200)
        for cid in courses:
            ok = P.js(LOAD_JS, cid)
            P.wait(1500)
            if not ok:
                P.say("!! could not load", cid); results[cid] = {"error": "load"}; continue
            r = P.js(AUDIT_JS)
            results[cid] = r
            P.say("=== %s  draws %s tris %s  bodies %d  post.uUnderwater %s" % (cid, r["draws"], r["tris"], len(r["bodies"]), r["post"]))
            for b in r["bodies"]:
                P.say("  body %s kind2=%s surfaceY=%.2f vol[%.2f..%.2f] mat=%s defines=%s env=%s uAmp=%.2f crestMax=%.3f tris=%s" % (
                    b["id"], b["kind2"], b["surfaceY"], b["volBot"], b["volTop"], b["matName"], b["defines"], b["envMap"], b["uAmp"], b["crestMax"], b["tris"]))
                pm = b["perimeter"]
                P.say("    perimeter: %d/%d known, minGround %s at %s, below crest %d, below surface %d" % (pm["known"], pm["n"], pm["minGround"], json.dumps(pm["minAt"]), pm["belowCrest"], pm["belowSurface"]))
                if pm["worst"]:
                    P.say("    worst:", json.dumps(pm["worst"]))
                P.say("    interior:", json.dumps(b["interior"]), " aShore:", json.dumps(b["aShore"]))
                P.say("    terrain-only (wade release):", json.dumps(b.get("terrainOnly")))
                P.say("    u:", json.dumps(b["u"]))
            P.say("  meshes:", json.dumps(r["waterMeshes"]))
            P.say("  volumes:", json.dumps(r["waterVolumes"]))
    outp = os.path.join(HERE, "_%s.json" % a.tag)
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)
    print("wrote", outp)

if __name__ == "__main__":
    main()
