// Full pulls as the shell makes them ("stretch it as far as it will go"): grab the surface point under the press, drag the target straight
// out along the surface direction to 1.1 x the body's maxPull over 0.8 s (clamped there by the physics), hold 0.7 s, release, 2 s after.
// Every species x {template, soft corner} x {top, flank +x, flank +z, each feature tip / the peak}. Fold meter every frame; where the
// sharpest crease sits (distance from the grabbed vertex, height above the table). node pullset.ts [--shard k/n] [--frac 1.1]
import { argOf, v3, makeFoldMeter, foldOf, minY, volumeOf } from '../verify_repair_a/common.ts';
const R_ = process.env.ROOT ?? '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify/head/games/wobblehoard'; const { SoftBody } = await import(R_ + '/src/physics/softbody.ts'); import { pointsOf, CATALOG, speciesTemplateGenome, quantizeGenome, evalShape, norm } from './attack_lib.ts';
const [shk, shn] = argOf('--shard', '0/1').split('/').map(Number);
const FRAC = Number(argOf('--frac', '1.1'));
const ONLY = argOf('--only', '') ? argOf('--only', '').split(',') : null;
const DT = 1 / 60;
function pull(g: any, d: any, p: any): any {
  const b: any = new SoftBody(g);
  for (let i = 0; i < 30; i++) b.step(DT);
  const R = b.restRadius, m = makeFoldMeter(b), rv0 = volumeOf(b.restLocal, b.indices), c = b.center;
  const r = Math.min(1.9, evalShape(d.shape, p.u.x, p.u.y, p.u.z)) + 3;
  const o = v3(c.x + p.u.x * r * R, Math.max(0.02, c.y + p.u.y * r * R), c.z + p.u.z * r * R), tg = v3(c.x + p.u.x * 0.5 * R, c.y + p.u.y * 0.5 * R, c.z + p.u.z * 0.5 * R);
  const h = b.raycast(o, norm(tg.x - o.x, tg.y - o.y, tg.z - o.z));
  if (!h) return { missed: true };
  const D = FRAC * b.params.maxPull * R, P0 = h.point;
  b.grab(0, h.vertex, P0);
  const res: any = { worst: 0, f120: 0, longest: 0, at: '', snap: -1, bad: '' };
  let run = 0;
  for (let s = 0, t = 0; t < 3.5; s++) {
    if (t < 0.8) { const k = D * (t / 0.8); b.grabMove(0, v3(P0.x + p.u.x * k, Math.max(0.03, P0.y + p.u.y * k), P0.z + p.u.z * k)); }
    else if (t >= 1.5 && t < 1.5 + DT) b.grabRelease(0);
    b.step(DT); t = (s + 1) * DT;
    const ev: any[] = []; b.drainEvents(ev); for (const e of ev) if (e.kind === 'snap') res.snap = Number(e.intensity.toFixed(3));
    const f = foldOf(b, m);
    if (!Number.isFinite(f.worst)) { res.bad = 'NaN'; break; }
    if (f.worst > 120) { res.f120++; run++; if (run > res.longest) res.longest = run; } else run = 0;
    if (f.worst > res.worst) {
      res.worst = f.worst;
      const P = b.positions, I = b.indices, N = m.N; let mn = 1, at = -1;
      for (let k = 0; k < m.pairs.length; k += 2) { const a = m.pairs[k] * 3, bb = m.pairs[k + 1] * 3; const dd = N[a] * N[bb] + N[a + 1] * N[bb + 1] + N[a + 2] * N[bb + 2]; if (dd < mn) { mn = dd; at = m.pairs[k]; } }
      const v = I[at * 3] * 3, gv = h.vertex * 3;
      res.at = `t ${t.toFixed(2)} ${t < 0.8 ? 'pulling' : t < 1.5 ? 'holding' : 'released'}: ${(Math.hypot(P[v] - P[gv], P[v + 1] - P[gv + 1], P[v + 2] - P[gv + 2]) / R).toFixed(2)} R from the grabbed vertex, y ${(P[v + 1] / R).toFixed(2)} R`;
    }
    if (!(volumeOf(b.positions, b.indices) / rv0 > 0)) { res.bad = 'inverted'; break; }
    if (minY(b) < -0.01 * R) { res.bad = 'penetration'; break; }
  }
  res.rest = foldOf(b, m).worst;
  return res;
}
const jobs: Array<[string, string]> = [];
for (const d of CATALOG) if (!ONLY || ONLY.includes(d.id)) for (const gn of ['tmpl', 'soft']) jobs.push([d.id, gn]);
for (let j = 0; j < jobs.length; j++) {
  if (j % shn !== shk) continue;
  const [id, gn] = jobs[j], t = speciesTemplateGenome(id), d = CATALOG.find((x: any) => x.id === id);
  const g = gn === 'soft' ? quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 }) : t;
  const pts = pointsOf(d).filter((p: any) => p.kind === 'top' || p.kind === 'tip' || p.kind === 'peak' || p.label === 'flank0' || p.label === 'flank90');
  const out = pts.map((p: any) => ({ p: p.label, ...pull(g, d, p) }));
  process.stdout.write(JSON.stringify({ id, g: gn, fam: (new SoftBody(g) as any).family, pulls: out }) + '\n');
}
