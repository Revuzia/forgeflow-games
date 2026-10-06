// Hop check: a top press (x + 0.1 R, straight down) held 1.2 s, then released; max lift of the LOWEST particle off the table (a hop) during
// the press and in the 2 s after. Profiles: 'instant' = pressure 1 from the touch (physview family_demo), 'shell' = the shell's ramp.
import { SoftBody, CATALOG, speciesTemplateGenome, quantizeGenome, shellP } from './attack_lib.ts';
const DT = 1 / 60, out: string[] = [];
let n = 0;
for (const d of CATALOG) for (const gn of ['tmpl', 'soft', 'hard']) for (const prof of ['instant', 'shell']) {
  const t = speciesTemplateGenome(d.id);
  const g = gn === 'soft' ? quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 }) : gn === 'hard' ? quantizeGenome({ ...t, firmness: 1, bounce: 0, stretch: 0, size: 0 }) : t;
  const b: any = new SoftBody(g);
  for (let i = 0; i < 30; i++) b.step(DT);
  const R = b.restRadius, h = b.raycast({ x: b.center.x + 0.1 * R, y: 6 * R, z: b.center.z }, { x: 0, y: -1, z: 0 });
  if (!h) continue;
  b.fingerDown(0, { point: h.point, normal: h.normal, dir: { x: 0, y: -1, z: 0 } });
  let during = 0, after = 0;
  for (let s = 0, tt = 0; tt < 3.2; s++) {
    if (tt < 1.2) b.fingerPressure(0, prof === 'instant' ? 1 : shellP(tt)); else if (tt < 1.2 + DT) b.fingerUp(0);
    b.step(DT); tt = (s + 1) * DT;
    let my = 1e9; for (let i = 1; i < b.positions.length; i += 3) if (b.positions[i] < my) my = b.positions[i];
    if (tt < 1.2) during = Math.max(during, my); else after = Math.max(after, my);
  }
  n++;
  if (during > 0.01 || after > 0.01) out.push(`${d.id.padEnd(10)} ${gn.padEnd(4)} ${d.family.padEnd(13)} ${prof.padEnd(7)} lift during press ${(during * 1000).toFixed(0)} mm, after release ${(after * 1000).toFixed(0)} mm (R ${R.toFixed(2)})`);
}
console.log(`${n} presses; lowest particle more than 10 mm off the table in ${out.length}:`);
for (const l of out) console.log('  ' + l);
