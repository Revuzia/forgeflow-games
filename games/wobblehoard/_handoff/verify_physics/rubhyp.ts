// Shell-faithful camera-plane rubs on every species (phys_verify): probe_softbody's slidePress (game camera, the shell's pressure
// profile capped at 0.7 while rubbing, a straight pointer slide in the screen plane, fresh camera ray each frame, outward drags skipped
// because the shell makes them pulls, lift at 1.2 s, 2.3 s of recovery), 4 contact points x 4 screen angles x {template, soft corner}.
// node rubset.ts [--shard k/n] [--sp 2.5] [--only id,..]
import { argOf, v3, makeFoldMeter, foldOf, minY, volumeOf } from '../verify_repair_a/common.ts';
import type { V3 } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = argOf('--root', S + '/head/games/wobblehoard');
const [shk, shn] = argOf('--shard', '0/1').split('/').map(Number);
const SP = Number(argOf('--sp', '2.5'));
const ONLY = argOf('--only', '') ? argOf('--only', '').split(',') : null;
const PRM = argOf('--params', '') ? JSON.parse(argOf('--params', '')) : null;
const GS = argOf('--genomes', 'tmpl,soft').split(',');
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { CATALOG, speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const { quantizeGenome } = await import(root + '/src/core/genome.ts');
const DT = 1 / 60;
const GAME_CAM = (R: number): V3 => { const k = R / 0.5125; return v3(0, 1.6 * k, 2.6 * k); };
const towards = (from: V3, p: V3): V3 => { const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z, l = Math.hypot(dx, dy, dz); return v3(dx / l, dy / l, dz / l); };
const shellPressure = (t: number, rub: boolean): number => { const x = Math.min(1, Math.max(0, (t - 0.18) / 0.9)), p = 0.55 + 0.45 * x * x * (3 - 2 * x); return rub && t > 0.15 ? Math.min(p, 0.7) : p; };
function slide(g: any, u: V3, ang: number, sp: number): any {
  const b: any = new SoftBody(g, PRM ? { params: PRM } : {});
  const m = makeFoldMeter(b);
  for (let i = 0; i < 30; i++) b.step(DT);
  const R = b.restRadius, c = b.center, cam = GAME_CAM(R), rv0 = volumeOf(b.restLocal, b.indices);
  const at = (q: V3): V3 => v3(c.x + q.x * R, q.y > 0 ? c.y + q.y * 1.3 * R : c.y + q.y * R, c.z + q.z * R);
  const res: any = { missed: false, pull: false, worst: 0, f120: 0, longest: 0, rest: 0, restN90: 0, bad: '' };
  const d0 = towards(cam, at(u)), h = b.raycast(cam, d0);
  if (!h) { res.missed = true; return res; }
  b.fingerDown(0, { point: h.point, normal: h.normal, dir: d0 });
  const rl = Math.hypot(d0.z, d0.x), right = v3(-d0.z / rl, 0, d0.x / rl);
  const up = v3(right.y * d0.z - right.z * d0.y, right.z * d0.x - right.x * d0.z, right.x * d0.y - right.y * d0.x);
  const a = (ang * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const mv = v3(right.x * ca + up.x * sa, right.y * ca + up.y * sa, right.z * ca + up.z * sa);
  const o = v3(h.point.x - c.x, h.point.y - c.y, h.point.z - c.z), ox = o.x * right.x + o.y * right.y + o.z * right.z, oy = o.x * up.x + o.y * up.y + o.z * up.z;
  if ((ca * ox + sa * oy) / (Math.hypot(ox, oy) || 1) > 0.2) { res.pull = true; return res; }
  let run = 0;
  for (let s = 0, t = 0; t < 3.5; s++) {
    if (t < 1.2) {
      b.fingerPressure(0, shellPressure(t, true));
      if (t > 0.15) { const k = sp * (t - 0.15), q = v3(h.point.x + mv.x * k, h.point.y + mv.y * k, h.point.z + mv.z * k), hq = b.raycast(cam, towards(cam, q)); if (hq) b.fingerMove(0, hq.point); }
    } else if (t < 1.2 + DT) b.fingerUp(0);
    b.step(DT); t = (s + 1) * DT;
    const f = foldOf(b, m);
    if (!Number.isFinite(f.worst)) { res.bad = 'NaN'; break; }
    if (f.worst > res.worst) res.worst = f.worst;
    if (f.worst > 120) { res.f120++; run++; if (run > res.longest) res.longest = run; } else run = 0;
    if (!(volumeOf(b.positions, b.indices) / rv0 > 0)) { res.bad = 'inverted'; break; }
    if (minY(b) < -0.01 * R) { res.bad = 'penetration'; break; }
  }
  const f = foldOf(b, m); res.rest = f.worst; res.restN90 = f.n90;
  return res;
}
const PTS: Array<[string, V3]> = [['top-front', v3(0.05, 0.83, 0.56)], ['front-mid', v3(0, 0.3, 0.95)], ['front-left', v3(-0.6, 0.45, 0.65)], ['front-right-low', v3(0.6, -0.1, 0.8)]];
const jobs: Array<[string, string]> = [];
for (const d of CATALOG) if (!ONLY || ONLY.includes(d.id)) for (const gn of GS) jobs.push([d.id, gn]);
for (let j = 0; j < jobs.length; j++) {
  if (j % shn !== shk) continue;
  const [id, gn] = jobs[j], t = speciesTemplateGenome(id);
  const g = gn === 'soft' ? quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 }) : t;
  const out: any[] = [];
  for (const [pl, u] of PTS) for (const ang of [0, 90, 180, 270]) { const r = slide(g, u, ang, SP); if (!r.pull) out.push({ p: pl, ang, ...r }); }
  const fam = (new SoftBody(g) as any).family;
  process.stdout.write(JSON.stringify({ id, g: gn, fam, sp: SP, rubs: out }) + '\n');
}
