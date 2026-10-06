// Repro / trace of one attack scenario. node repro.ts --id puddlo --g soft --pt "flank270" --mode rub [--amp 1.5] [--w 2.5] [--lin 2.0] [--fam x] [--trace]
// --lin v: a straight rub at v m/s along t1 (shell-like) instead of the oscillating one.
import { argOf, v3, makeFoldMeter, foldOf } from '../verify_repair_a/common.ts';
import type { V3 } from '../verify_repair_a/common.ts';
import { pointsOf, SoftBody, CATALOG, speciesTemplateGenome, quantizeGenome, evalShape, shellP, tangents, norm } from './attack_lib.ts';
const id = argOf('--id', 'dollop'), gname = argOf('--g', 'soft'), ptl = argOf('--pt', 'top'), mode = argOf('--mode', 'rub');
const amp = Number(argOf('--amp', '1.5')), w = Number(argOf('--w', '2.5')), lin = Number(argOf('--lin', '0')), fam = argOf('--fam', '');
const TRACE = process.argv.includes('--trace');
const DT = 1 / 60;
const tmpl = speciesTemplateGenome(id);
const g = quantizeGenome(gname === 'soft' ? { ...tmpl, firmness: 0, bounce: 1, stretch: 1, size: 1 } : gname === 'hard' ? { ...tmpl, firmness: 1, bounce: 0, stretch: 0, size: 0 } : tmpl);
const d = CATALOG.find((x: any) => x.id === id);
const b: any = new SoftBody(g, fam ? { family: fam } : {});
for (let i = 0; i < 30; i++) b.step(DT);
const R = b.restRadius, m = makeFoldMeter(b);
const p = pointsOf(d).find((x) => x.label === ptl || x.label.startsWith(ptl));
if (!p) throw new Error('no point ' + ptl + ' in ' + pointsOf(d).map((x) => x.label).join(' | '));
const c = b.center, r = Math.min(1.9, evalShape(d.shape, p.u.x, p.u.y, p.u.z)) + 3;
const o = v3(c.x + p.u.x * r * R, Math.max(0.02, c.y + p.u.y * r * R), c.z + p.u.z * r * R), tgt = v3(c.x + p.u.x * 0.5 * R, c.y + p.u.y * 0.5 * R, c.z + p.u.z * 0.5 * R);
const dir = norm(tgt.x - o.x, tgt.y - o.y, tgt.z - o.z), h = b.raycast(o, dir);
console.log(`${id}/${gname} family ${b.family} R ${R.toFixed(3)} point ${p.label} u (${p.u.x.toFixed(2)},${p.u.y.toFixed(2)},${p.u.z.toFixed(2)}) hit ${h ? `(${h.point.x.toFixed(3)},${h.point.y.toFixed(3)},${h.point.z.toFixed(3)})` : 'MISS'}`);
if (!h) process.exit(0);
const [t1] = tangents(p.u);
const GRAB = mode === 'grab', PULL = Number(argOf('--pull', '3')), SIDE = Number(argOf('--side', '1'));
if (GRAB) b.grab(0, h.vertex, h.point); else b.fingerDown(0, { point: h.point, normal: h.normal, dir });
const P0 = h.point;
const T = mode === 'hold' || mode === 'rub' ? 1.2 : mode === 'shove' ? 0.3 : 0.12;
let worst = 0, f120 = 0, maxSp = 0, prevK = 0;
for (let s = 0, t = 0; t < (GRAB ? 4.2 : T + 1.5); s++) {
  if (GRAB) {
    if (t < 0.6) { const k = PULL * R * (t / 0.6); b.grabMove(0, v3(P0.x + p.u.x * k, Math.max(0.05, P0.y + p.u.y * k), P0.z + p.u.z * k)); }
    else if (t < 1.0) { const k = PULL * R, e = SIDE * R * ((t - 0.6) / 0.4); b.grabMove(0, v3(P0.x + p.u.x * k + t1.x * e, Math.max(0.05, P0.y + p.u.y * k + t1.y * e), P0.z + p.u.z * k + t1.z * e)); }
    else if (t >= 1.3 && t < 1.3 + DT) b.grabRelease(0);
  } else if (t < T) {
    b.fingerPressure(0, mode === 'hold' ? shellP(t) : mode === 'rub' ? shellP(t, true) : mode === 'shove' ? 1 : 0.6);
    if (mode === 'rub' && t > 0.15) {
      const k = lin !== 0 ? lin * (t - 0.15) : amp * (t - 0.15) * Math.cos(t * w);
      if (s > 10) maxSp = Math.max(maxSp, Math.abs(k - prevK) / DT); prevK = k;
      const q = v3(h.point.x + t1.x * k, h.point.y + t1.y * k, h.point.z + t1.z * k);
      const hq = b.raycast(v3(q.x - dir.x * 3, q.y - dir.y * 3, q.z - dir.z * 3), dir);
      if (hq) b.fingerMove(0, hq.point);
    }
  } else if (t < T + DT) b.fingerUp(0);
  b.step(DT); t = (s + 1) * DT;
  const f = foldOf(b, m);
  if (f.worst > worst) worst = f.worst;
  if (f.worst > 120) f120++;
  const tp = b.tip(0);
  if (TRACE || f.worst > 115) {
    // where is the worst hinge: centre of the two triangles vs tip and table
    const P = b.positions, I = b.indices, N = m.N; let mn = 1, at = -1;
    for (let k = 0; k < m.pairs.length; k += 2) { const t1_ = m.pairs[k] * 3, t2 = m.pairs[k + 1] * 3; const dd = N[t1_] * N[t2] + N[t1_ + 1] * N[t2 + 1] + N[t1_ + 2] * N[t2 + 2]; if (dd < mn) { mn = dd; at = m.pairs[k]; } }
    const a = I[at * 3] * 3, px = P[a], py = P[a + 1], pz = P[a + 2];
    const gv = GRAB ? Math.hypot(px - b.positions[h.vertex*3], py - b.positions[h.vertex*3+1], pz - b.positions[h.vertex*3+2]) / R : NaN;
    const dTip = tp ? Math.hypot(px - tp.x, py - tp.y, pz - tp.z) / tp.r : NaN;
    console.log(`t ${t.toFixed(3)} fold ${f.worst.toFixed(1)} n90 ${f.n90} | crease at (${px.toFixed(3)},${py.toFixed(3)},${pz.toFixed(3)}) y/R ${(py / R).toFixed(2)} ${tp ? `tip (${tp.x.toFixed(3)},${tp.y.toFixed(3)},${tp.z.toFixed(3)}) r ${tp.r.toFixed(3)} depth ${tp.depth.toFixed(2)} dist ${dTip.toFixed(2)} tip radii` : 'no tip'} ${GRAB ? `dist to grabbed vertex ${gv.toFixed(2)} R stretch ${b.metrics.stretch.toFixed(2)}` : ''} slosh ${(b.metrics.slosh ?? 0).toFixed(2)} vol ${b.metrics.volume.toFixed(3)}`);
  }
}
console.log(`worst ${worst.toFixed(1)}, frames over 120: ${f120}, max pointer speed ${maxSp.toFixed(2)} m/s, rest ${foldOf(b, m).worst.toFixed(1)}`);
