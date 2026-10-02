// Verifier: mesh-fold analysis. Runs scripted scenes on SoftBody under node, per frame reports the sharpest dihedral angle
// (angle between adjacent triangle normals; rest max is ~35 deg at the peak), spike metric (vertex offset from neighbour mean
// relative to rest), and count of edges with dihedral > 70 deg.
import { SoftBody } from '../src/physics/softbody.ts';
import { genomeFromParam, quantizeGenome } from '../src/core/genome.ts';
import type { V3 } from '../src/contracts.ts';
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function mk(g?: string, ov?: Record<string, number>) {
  let genome = genomeFromParam(g ?? null);
  if (ov) genome = quantizeGenome({ ...genome, ...ov });
  return new SoftBody(genome, { detail: 3 });
}
function edgesOf(b: SoftBody) {
  const m = new Map<string, number[]>();
  const I = b.indices;
  for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = I[t * 3 + k], c = I[t * 3 + (k + 1) % 3];
    const key = a < c ? a + '_' + c : c + '_' + a;
    const l = m.get(key); if (l) l.push(t); else m.set(key, [t]);
  }
  return [...m.entries()].filter(([, v]) => v.length === 2).map(([k, v]) => [k.split('_').map(Number), v] as [number[], number[]]);
}
function analyse(b: SoftBody, E: ReturnType<typeof edgesOf>) {
  const P = b.positions, I = b.indices, nt = I.length / 3;
  const N = new Float64Array(nt * 3);
  let flipped = 0;
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
    const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1e-12; nx /= l; ny /= l; nz /= l;
    N[t * 3] = nx; N[t * 3 + 1] = ny; N[t * 3 + 2] = nz;
    // outward check: normal vs direction from body centre
    const cx = (P[a] + P[c] + P[d]) / 3 - b.center.x, cy = (P[a + 1] + P[c + 1] + P[d + 1]) / 3 - b.center.y, cz = (P[a + 2] + P[c + 2] + P[d + 2]) / 3 - b.center.z;
    if (nx * cx + ny * cy + nz * cz < 0) flipped++;
  }
  let maxD = 0, n70 = 0, n90 = 0;
  for (const [, [t1, t2]] of E) {
    const dot = N[t1 * 3] * N[t2 * 3] + N[t1 * 3 + 1] * N[t2 * 3 + 1] + N[t1 * 3 + 2] * N[t2 * 3 + 2];
    const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (ang > maxD) maxD = ang; if (ang > 70) n70++; if (ang > 90) n90++;
  }
  return { maxD, n70, n90, flipped };
}
type Scn = (t: number, b: SoftBody, c: Record<string, number>) => void;
function touch(b: SoftBody, id: 0 | 1, from: V3, dir: V3) { const h = b.raycast(from, dir); if (h) b.fingerDown(id, { point: h.point, normal: h.normal, dir }); return h; }
const SC: Record<string, { T: number; f: Scn }> = {
  peak_hold: { T: 2.2, f(t, b, c) { if (t >= .4 && !c.d) { c.d = 1; touch(b, 0, v3(0, 3, 0), v3(0, -1, 0)); } if (c.d && !c.u) b.fingerPressure(0, clamp01((t - .4) / .5)); if (t >= 1.2 && !c.u) { c.u = 1; b.fingerUp(0); } } },
  peak_poke: { T: Number(process.env.T ?? 1.4), f(t, b, c) { if (t >= .3 && !c.d) { c.d = 1; touch(b, 0, v3(0, 3, 0), v3(0, -1, 0)); b.fingerPressure(0, .6); } if (t >= .42 && !c.u) { c.u = 1; b.fingerUp(0); } } },
  dome_hold: { T: 2.4, f(t, b, c) { if (t >= .4 && !c.d) { c.d = 1; touch(b, 0, v3(0, 3, 0), v3(0, -1, 0)); } if (c.d && !c.u) b.fingerPressure(0, clamp01((t - .4) / .9)); if (t >= 1.4 && !c.u) { c.u = 1; b.fingerUp(0); } } },
  side_hold: { T: 2.4, f(t, b, c) { if (t >= .4 && !c.d) { c.d = 1; touch(b, 0, v3(3, 0.35, 0), v3(-1, 0, 0)); } if (c.d && !c.u) b.fingerPressure(0, clamp01((t - .4) / .9)); if (t >= 1.4 && !c.u) { c.u = 1; b.fingerUp(0); } } },
  pinch: { T: 2.0, f(t, b, c) { if (t >= .3 && !c.d) { c.d = 1; touch(b, 0, v3(-3, .34, 0), v3(1, 0, 0)); touch(b, 1, v3(3, .34, 0), v3(-1, 0, 0)); } if (c.d && !c.u) { const p = clamp01((t - .3) / .6) * .95; b.fingerPressure(0, p); b.fingerPressure(1, p); } if (t >= 1.1 && !c.u) { c.u = 1; b.fingerUp(0); b.fingerUp(1); } } },
};
const which = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const g = process.argv.find((a) => a.startsWith('--g='))?.slice(4);
const ov: Record<string, number> = {};
for (const k of ['firmness', 'bounce', 'stretch', 'size']) { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); if (a) ov[k] = Number(a.split('=')[1]); }
{
  const b0 = mk(g, ov); const E0 = edgesOf(b0); const r0 = analyse(b0, E0);
  console.log(`rest: maxDihedral ${r0.maxD.toFixed(1)} deg, edges>70: ${r0.n70}`);
}
for (const name of which.length ? which : Object.keys(SC)) {
  const b = mk(g, ov); const E = edgesOf(b); const { T, f } = SC[name]; const c: Record<string, number> = {};
  let worst = 0, worstT = 0, max70 = 0, tot90 = 0; const rows: string[] = [];
  for (let s = 0, t = 0; t < T; s++) {
    f(t, b, c); b.step(1 / 60); t = (s + 1) / 60;
    const a = analyse(b, E);
    if (a.maxD > worst) { worst = a.maxD; worstT = t; }
    max70 = Math.max(max70, a.n70); if (a.n90 > 0) tot90++;
    if (s % 6 === 0 && a.maxD > 60) rows.push(`   t=${t.toFixed(2)} maxD ${a.maxD.toFixed(0)} n70 ${a.n70} n90 ${a.n90} inwardTris ${a.flipped}`);
  }
  console.log(`${name.padEnd(10)} worst dihedral ${worst.toFixed(0)} deg @ t=${worstT.toFixed(2)}  max edges>70deg ${max70}  frames with >90deg ${tot90}`);
  for (const r of rows.filter((_, i) => i < 3 || i >= rows.length - 4)) console.log(r);
}
