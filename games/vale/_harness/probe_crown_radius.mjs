// VALE harness — the ruling-7 crown metric (owner_rulings.md §7) over GLBs: the crown fit radius of the head's soft
// covering, R = ((min(width, depth) / 2)² + d²) / (2d) at d = 1, 3 and 5 cm under the top, the method of
// _harness/_reports/closing_vashil_tools/geo2.mjs (closing_critic_crown_radius.txt): the BODY mesh's triangles skinned
// mostly to the 'head' joint (all three corners), in bind space; width = x extent, depth = z extent of the EXACT
// section of those triangles by the plane at that height (geo2 took the vertices within ±8 mm, which a 300-triangle
// Wick hood samples too sparsely). A static model (no skin: the Hooded Lamp ward) uses its mesh named *_hood.
//
// A HARD part on the crown (a chalk knob, a stone finial: ruling 7 "hard parts … are not soft head coverings. They need
// only the visual check") sets the raw top. HARD lists the ones the builders make (part, material, height over the
// dome); R is then reported again under that cap ("soft crown"), which is what the gate reads for those models. Never
// auto-detected: a heuristic step test also fired on sharp soft hoods (Kemdo), and only a named hard part is exempt.
// Also the dome-width ratio: min(width, depth) at 5 cm under the top / the head region's max min(width, depth).
//
//   node _harness/probe_crown_radius.mjs <glb...> [--json out.json] [--profile] [--hard name.glb=cm,...]
// Gate (ruling 7): R(3 cm) >= 10 cm for a soft covering whose top is the head's highest point.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(HERE, '..', 'package.json'));
const { NodeIO } = await import(req.resolve('@gltf-transform/core'));
const { ALL_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions'));
const THREE = await import(join(HERE, '..', 'node_modules', 'three', 'build', 'three.module.js'));
const args = process.argv.slice(2);
const ji = args.indexOf('--json');
const JSON_OUT = ji >= 0 ? args[ji + 1] : null;
const PROFILE = args.includes('--profile');
// hard parts on the crown (builder source; the height is the part's top over the soft dome's top, read off --profile)
const HARD = {
  'shieldwick_aubade.glb': { cm: 6.5, part: 'chalk knob (wick_shieldwick.py knob_prof: 6.5 cm over the dome)' },
  'glimwick_aubade.glb': { cm: 4.5, part: 'chalk ball knob on a short neck (wick_glimwick.py `knob`)' },
  'greatwick_aubade.glb': { cm: 5.5, part: 'chalk bun knob (wick_greatwick.py `knob`)' },
  'hooded_lamp.glb': { cm: 6.5, part: 'stone ball knob on a neck (small_units.py ward, owner ruling 5)' },
};
const hi_ = args.indexOf('--hard');
if (hi_ >= 0) for (const kv of args[hi_ + 1].split(',')) { const [k, v] = kv.split('='); HARD[k] = { cm: Number(v), part: 'given on the command line' }; }
let cur = '';
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--json', '--hard'].includes(args[i - 1])));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const R_of = (w, d) => ((w / 2) ** 2 + d * d) / (2 * d);
/** P: triangles [[a, b, c], ...] of [x, y, z]; the section of the mesh by the plane y = top - dy */
function profile(P, cap = Infinity) {
  let top = -Infinity;
  for (const t of P) for (const v of t) if (v[1] <= cap) top = Math.max(top, v[1]);
  const secAt = (y) => {
    const xs = [], zs = [];
    for (const t of P) for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      const u = (y - a[1]) / (b[1] - a[1]);
      xs.push(a[0] + (b[0] - a[0]) * u); zs.push(a[2] + (b[2] - a[2]) * u);
    }
    if (xs.length < 2) return null;
    return { w: Math.max(...xs) - Math.min(...xs), dp: Math.max(...zs) - Math.min(...zs) };
  };
  return { top, sec: (dy) => secAt(top - dy), secAt };
}
function crown(P) {
  const { top, sec, secAt } = profile(P);
  const at = (d) => { const s = sec(d); return s ? { d, w: +s.w.toFixed(3), dp: +s.dp.toFixed(3), R: +(R_of(Math.min(s.w, s.dp), d) * 100).toFixed(1) } : null; };
  let maxMin = 0;
  for (let dy = 0.005; dy < 0.30; dy += 0.005) { const s = sec(dy); if (s) maxMin = Math.max(maxMin, Math.min(s.w, s.dp)); }
  const s5 = sec(0.05);
  const out = { top: +top.toFixed(3), r1: at(0.01), r3: at(0.03), r5: at(0.05), domeRatio: s5 && maxMin ? +(Math.min(s5.w, s5.dp) / maxMin).toFixed(2) : null };
  const hard = HARD[cur];
  if (hard) {
    const knob = hard.cm / 100;
    const at2 = (d) => { const s = secAt(top - knob - d); return s ? { d, w: +s.w.toFixed(3), dp: +s.dp.toFixed(3), R: +(R_of(Math.min(s.w, s.dp), d) * 100).toFixed(1) } : null; };
    out.knob = { height: knob, part: hard.part, r1: at2(0.01), r3: at2(0.03), r5: at2(0.05) };
  }
  return out;
}

const rows = [];
for (const f of files) {
  const doc = await io.read(f);
  const root = doc.getRoot(), nodes = root.listNodes(), parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  const W = (n) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(...n.getTranslation()), new THREE.Quaternion(...n.getRotation()), new THREE.Vector3(...n.getScale())); const p = parent.get(n); return p ? W(p).multiply(m) : m; };
  const P = [];
  let how = '';
  for (const n of nodes) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const skin = n.getSkin();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() === 'accent') continue;
      const pos = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), Wt = prim.getAttribute('WEIGHTS_0');
      const v = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      if (skin && J) {
        const jn = skin.listJoints(), hk = jn.findIndex((x) => x.getName() === 'head');
        if (hk < 0) continue;
        const ibm = skin.getInverseBindMatrices().getArray();
        const M = W(jn[hk]).clone().multiply(new THREE.Matrix4().fromArray(Array.from(ibm.slice(hk * 16, hk * 16 + 16))));
        const V = [], hd = [];
        for (let i = 0; i < pos.getCount(); i++) {
          J.getElement(i, j); Wt.getElement(i, w);
          let jb = -1, wb = 0;
          for (let k = 0; k < 4; k++) if (w[k] > wb) { wb = w[k]; jb = j[k]; }
          hd.push(jb === hk);
          pos.getElement(i, v);
          const p = new THREE.Vector3(...v).applyMatrix4(M);
          V.push([p.x, p.y, p.z]);
        }
        const I = prim.getIndices().getArray();
        for (let t = 0; t < I.length; t += 3) if (hd[I[t]] && hd[I[t + 1]] && hd[I[t + 2]]) P.push([V[I[t]], V[I[t + 1]], V[I[t + 2]]]);
        how = 'head-weighted body';
      } else if (!skin && /_hood$/.test(n.getName())) {
        const M = W(n), V = [];
        for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const p = new THREE.Vector3(...v).applyMatrix4(M); V.push([p.x, p.y, p.z]); }
        const I = prim.getIndices().getArray();
        for (let t = 0; t < I.length; t += 3) P.push([V[I[t]], V[I[t + 1]], V[I[t + 2]]]);
        how = `static mesh ${n.getName()}`;
      }
    }
  }
  if (!P.length) { rows.push({ glb: basename(f), error: 'no head-weighted / hood vertices' }); continue; }
  cur = basename(f);
  const c = crown(P);
  if (PROFILE) {
    const { sec } = profile(P);
    console.log(`${basename(f)} profile (cm under the top: min(width, depth) cm):`, Array.from({ length: 16 }, (_, i) => { const s_ = sec(i * 0.01 + 0.0025); return `${i}:${s_ ? (Math.min(s_.w, s_.dp) * 100).toFixed(1) : '-'}`; }).join(' '));
  }
  const r = { glb: basename(f), how, tris: P.length, ...c, gate3cm: c.r3 ? (c.r3.R >= 10 ? 'PASS' : 'FAIL') : 'n/a' };
  // the gate a model with a named hard crown part reads: its soft crown under that part
  r.gate = c.knob ? (c.knob.r3 ? (c.knob.r3.R >= 10 ? 'PASS' : 'FAIL') : 'n/a') : r.gate3cm;
  rows.push(r);
  const f_ = (x) => (x ? `w${x.w.toFixed(3)} dp${x.dp.toFixed(3)} R ${String(x.R).padStart(5)}cm` : '-'.padEnd(26));
  console.log(`${basename(f).padEnd(28)} d1 ${f_(c.r1)}  d3 ${f_(c.r3)}  d5 ${f_(c.r5)}  dome ${c.domeRatio}  ${c.knob ? `(raw top: the hard knob)` : r.gate3cm}` +
    (c.knob ? `\n${''.padEnd(28)} soft crown under the ${(c.knob.height * 100).toFixed(1)} cm hard knob: d1 ${f_(c.knob.r1)}  d3 ${f_(c.knob.r3)}  d5 ${f_(c.knob.r5)}  ${r.gate}` : ''));
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ tool: '_harness/probe_crown_radius.mjs', rule: 'owner ruling 7: R(3 cm) >= 10 cm', rows }, null, 1));
