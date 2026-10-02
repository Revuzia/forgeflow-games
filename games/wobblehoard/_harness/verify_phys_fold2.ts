// Verifier: fold sweep over many contact points / directions; reports transient worst dihedral and the rest state 4 s later.
import { SoftBody } from '../src/physics/softbody.ts';
import { genomeFromParam } from '../src/core/genome.ts';
import type { V3 } from '../src/contracts.ts';
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function edgesOf(b: SoftBody) { const m = new Map<string, number[]>(); const I = b.indices; for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], c = I[t * 3 + (k + 1) % 3]; const key = a < c ? a + '_' + c : c + '_' + a; const l = m.get(key); if (l) l.push(t); else m.set(key, [t]); } return [...m.values()].filter((v) => v.length === 2); }
function fold(b: SoftBody, E: number[][]) {
  const P = b.positions, I = b.indices, nt = I.length / 3, N = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) { const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3; const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1e-12; N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l; }
  let mx = 0, n90 = 0; for (const [t1, t2] of E) { const dot = N[t1 * 3] * N[t2 * 3] + N[t1 * 3 + 1] * N[t2 * 3 + 1] + N[t1 * 3 + 2] * N[t2 * 3 + 2]; const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI; if (ang > mx) mx = ang; if (ang > 90) n90++; }
  return { mx, n90 };
}
const detail = Number(process.env.DETAIL ?? 3), fps = Number(process.env.FPS ?? 60);
const cases: Array<[string, V3, V3]> = [
  ['top x=0.00', v3(0, 3, 0), v3(0, -1, 0)], ['top x=0.15', v3(0.15, 3, 0), v3(0, -1, 0)], ['top x=0.30', v3(0.3, 3, 0), v3(0, -1, 0)],
  ['top x=0.40', v3(0.4, 3, 0), v3(0, -1, 0)], ['top z=0.2', v3(0, 3, 0.2), v3(0, -1, 0)], ['top tilt(cam-like)', v3(-1.2, 3, 0), v3(0.38, -0.92, 0)],
  ['side y=0.9 (peak flank)', v3(3, 0.9, 0), v3(-1, 0, 0)], ['side y=0.7', v3(3, 0.7, 0), v3(-1, 0, 0)], ['side y=0.5', v3(3, 0.5, 0), v3(-1, 0, 0)],
  ['side y=0.25', v3(3, 0.25, 0), v3(-1, 0, 0)], ['oblique y=0.8 from above', v3(3, 2.2, 0), v3(-0.8, -0.6, 0)],
];
for (const [name, o, d] of cases) for (const mode of ['tap', 'hold']) {
  const b = new SoftBody(genomeFromParam(null), { detail }); const E = edgesOf(b);
  const h = b.raycast(o, d); if (!h) { console.log(name, 'MISS'); continue; }
  const dt = 1 / fps; let worst = 0, up = false, down = false;
  for (let s = 0, t = 0; t < (mode === 'tap' ? 5 : 6.5); s++) {
    if (t >= 0.3 && !down) { down = true; b.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(d.x / Math.hypot(d.x, d.y, d.z), d.y / Math.hypot(d.x, d.y, d.z), d.z / Math.hypot(d.x, d.y, d.z)) }); }
    if (down && !up) b.fingerPressure(0, mode === 'tap' ? 0.6 : clamp01((t - 0.3) / 0.9));
    if (down && !up && t >= (mode === 'tap' ? 0.42 : 1.4)) { up = true; b.fingerUp(0); }
    b.step(dt); t = (s + 1) * dt; const f = fold(b, E); if (f.mx > worst) worst = f.mx;
  }
  const f = fold(b, E);
  const top = Math.max(...Array.from({ length: b.vertexCount }, (_, i) => b.positions[i * 3 + 1]));
  console.log(`${name.padEnd(26)} ${mode}: transient worst ${worst.toFixed(0).padStart(3)} deg | rest: dihedral ${f.mx.toFixed(0).padStart(3)} edges>90 ${f.n90} topY ${top.toFixed(3)}`);
}
