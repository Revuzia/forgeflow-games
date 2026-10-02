// Verifier: does a single tap/hold from above leave a PERMANENT fold? Sweeps hit offset x and genome.
import { SoftBody } from '../src/physics/softbody.ts';
import { genomeFromParam, quantizeGenome } from '../src/core/genome.ts';
import type { V3 } from '../src/contracts.ts';
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function edgesOf(b: SoftBody) {
  const m = new Map<string, number[]>(); const I = b.indices;
  for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], c = I[t * 3 + (k + 1) % 3]; const key = a < c ? a + '_' + c : c + '_' + a; const l = m.get(key); if (l) l.push(t); else m.set(key, [t]); }
  return [...m.values()].filter((v) => v.length === 2);
}
function fold(b: SoftBody, E: number[][]) {
  const P = b.positions, I = b.indices, nt = I.length / 3, N = new Float64Array(nt * 3); let inward = 0;
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1e-12; nx /= l; ny /= l; nz /= l;
    N[t * 3] = nx; N[t * 3 + 1] = ny; N[t * 3 + 2] = nz;
    const cx = (P[a] + P[c] + P[d]) / 3 - b.center.x, cy = (P[a + 1] + P[c + 1] + P[d + 1]) / 3 - b.center.y, cz = (P[a + 2] + P[c + 2] + P[d + 2]) / 3 - b.center.z;
    if (nx * cx + ny * cy + nz * cz < 0) inward++;
  }
  let mx = 0, n90 = 0;
  for (const [t1, t2] of E) { const dot = N[t1 * 3] * N[t2 * 3] + N[t1 * 3 + 1] * N[t2 * 3 + 1] + N[t1 * 3 + 2] * N[t2 * 3 + 2]; const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI; if (ang > mx) mx = ang; if (ang > 90) n90++; }
  return { mx, n90, inward };
}
function run(label: string, ov: Record<string, number>, px: number, pz: number, mode: 'tap' | 'hold', tilt = 0) {
  const g = quantizeGenome({ ...genomeFromParam(null), ...ov });
  const b = new SoftBody(g, { detail: 3 }); const E = edgesOf(b);
  let d = 0, u = 0; let worst = 0, worstN = 0;
  const T = mode === 'tap' ? 6 : 7;
  for (let s = 0, t = 0; t < T; s++) {
    if (t >= 0.3 && !d) { d = 1; const dir = v3(Math.sin(tilt), -Math.cos(tilt), 0); const o = v3(px - dir.x * 3, 3, pz); const h = b.raycast(o, dir); if (h) { b.fingerDown(0, { point: h.point, normal: h.normal, dir }); } else console.log('MISS'); }
    if (d && !u) { if (mode === 'tap') b.fingerPressure(0, 0.6); else b.fingerPressure(0, clamp01((t - 0.3) / 0.9)); }
    if (!u && t >= (mode === 'tap' ? 0.42 : 1.4)) { u = 1; b.fingerUp(0); }
    b.step(1 / 60); t = (s + 1) / 60;
    const f = fold(b, E); if (f.mx > worst) { worst = f.mx; worstN = f.n90; }
  }
  const f = fold(b, E);
  console.log(`${label.padEnd(34)} ${mode} x=${px.toFixed(2)} tilt=${(tilt * 57.3).toFixed(0)}  worst ${worst.toFixed(0)} deg | AT REST: maxDihedral ${f.mx.toFixed(0)} edges>90 ${f.n90} inwardTris ${f.inward}`);
}
const G: Array<[string, Record<string, number>]> = [['default', {}], ['soft', { firmness: 0.1 }], ['firm', { firmness: 0.9 }], ['bouncy big', { bounce: 1, size: 1 }], ['stretchy small', { stretch: 1, size: 0 }]];
for (const [n, ov] of G) for (const px of [0, 0.04, 0.1, 0.2]) run(n, ov, px, 0, 'tap');
for (const px of [0, 0.1, 0.25]) run('default', {}, px, 0, 'hold');
run('default', {}, 0, 0, 'tap', 0.4);
run('default', {}, 0.1, 0.1, 'tap');
