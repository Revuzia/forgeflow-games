// Isolate which ceremony / hostile ingredient leaves a plastic family creased. node cer_iso.ts --id kneadle --g soft
import { argOf, v3, makeFoldMeter, foldOf, shapeFit } from '../verify_repair_a/common.ts';
import { SoftBody, speciesTemplateGenome, quantizeGenome, CATALOG, evalShape, norm } from './attack_lib.ts';
const id = argOf('--id', 'kneadle'), gname = argOf('--g', 'soft'), fam = argOf('--fam', ''), settleS = Number(argOf('--settle', '12'));
const DT = 1 / 60;
const t = speciesTemplateGenome(id);
const g = quantizeGenome(gname === 'soft' ? { ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 } : gname === 'hard' ? { ...t, firmness: 1, bounce: 0, stretch: 0, size: 0 } : t);
const d = CATALOG.find((x: any) => x.id === id);
const only = argOf('--only', '');
const mk = (): any => { const b: any = new SoftBody(g, fam ? { family: fam } : {}); for (let i = 0; i < 30; i++) b.step(DT); return b; };
const ray = (b: any, u: any): any => { const c = b.center, R = b.restRadius, r = Math.min(1.9, evalShape(d.shape, u.x, u.y, u.z)) + 3; const o = v3(c.x + u.x * r * R, Math.max(0.02, c.y + u.y * r * R), c.z + u.z * r * R); const tg = v3(c.x + u.x * 0.5 * R, c.y + u.y * 0.5 * R, c.z + u.z * 0.5 * R); const dir = norm(tg.x - o.x, tg.y - o.y, tg.z - o.z); const h = b.raycast(o, dir); return h ? { h, dir } : null; };
type Sc = { name: string; fingers: boolean; frames: number; each: (b: any, k: number) => void };
const SC: Sc[] = [
  { name: 'fingers only (pressure 1, 4.5 s)', fingers: true, frames: 270, each: () => {} },
  { name: 'fold toggle /5 frames, no fingers', fingers: false, frames: 270, each: (b, k) => { if (k % 5 === 0) b.setFold((k / 5) % 2 === 0 ? 1 : 0); } },
  { name: 'fold toggle /5 frames + fingers', fingers: true, frames: 270, each: (b, k) => { if (k % 5 === 0) b.setFold((k / 5) % 2 === 0 ? 1 : 0); } },
  { name: 'setFold(1) held 2 s + fingers', fingers: true, frames: 120, each: (b) => b.setFold(1) },
  { name: 'burstOpen(1) /10 frames + fingers', fingers: true, frames: 270, each: (b, k) => { if (k % 10 === 0) b.burstOpen(1); } },
  { name: 'burstOpen(1) every frame x20, no fingers', fingers: false, frames: 20, each: (b) => b.burstOpen(1) },
  { name: 'burstOpen(1) once, no fingers', fingers: false, frames: 1, each: (b) => b.burstOpen(1) },
  { name: 'burstOpen(1) once + fingers', fingers: true, frames: 270, each: (b, k) => { if (k === 30) b.burstOpen(1); } },
  { name: 'burstOpen(0.45) once + fingers', fingers: true, frames: 270, each: (b, k) => { if (k === 30) b.burstOpen(0.45); } },
  { name: 'tremble(1) + fingers', fingers: true, frames: 270, each: (b) => b.tremble(1) },
  { name: 'moveTo far and back + fingers', fingers: true, frames: 270, each: (b, k) => b.moveTo(k < 90 ? v3(6, 0.5, -4) : v3(0, 0.5, 0), 4) },
  { name: 'nudge 40 m/s + fingers', fingers: true, frames: 60, each: (b, k) => { if (k === 0) b.nudge(v3(40, 3, -40)); } },
];
for (const sc of SC) {
  if (only && !sc.name.startsWith(only)) continue;
  const b = mk(), m = makeFoldMeter(b);
  if (sc.fingers) {
    const ht = ray(b, v3(0.03, 1, 0.05)), hf = ray(b, v3(1, 0, 0));
    if (ht) b.fingerDown(0, { point: ht.h.point, normal: ht.h.normal, dir: ht.dir });
    if (hf) b.fingerDown(1, { point: hf.h.point, normal: hf.h.normal, dir: hf.dir });
    b.fingerPressure(0, 1); b.fingerPressure(1, 1);
  }
  let worst = 0, f120 = 0;
  for (let k = 0; k < sc.frames; k++) { sc.each(b, k); b.step(DT); const f = foldOf(b, m).worst; worst = Math.max(worst, f); if (f > 120) f120++; }
  b.setFold(0); b.tremble(0); b.moveTo(null); b.fingerUp(0); b.fingerUp(1);
  const trace: string[] = [];
  let f120a = 0;
  for (let k = 0; k < settleS * 60; k++) { b.step(DT); const f = foldOf(b, m).worst; if (f > 120) f120a++; if (k % 120 === 119) trace.push(f.toFixed(0)); }
  const fe = foldOf(b, m);
  console.log(`${sc.name.padEnd(42)} during: worst ${worst.toFixed(0)} f120 ${f120} | after release: f120 ${f120a}, fold every 2 s ${trace.join(' ')} | end fold ${fe.worst.toFixed(0)} n90 ${fe.n90} shape ${shapeFit(b).toFixed(3)} R kin ${b.metrics.kinetic.toFixed(4)}`);
}
