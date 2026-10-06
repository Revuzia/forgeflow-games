import { SoftBody, speciesTemplateGenome, shellP } from './attack_lib.ts';
const id = process.argv[2] ?? 'ambrosel';
const b: any = new SoftBody(speciesTemplateGenome(id));
for (let i = 0; i < 30; i++) b.step(1 / 60);
const R = b.restRadius, h = b.raycast({ x: b.center.x + 0.1 * R, y: 6 * R, z: b.center.z }, { x: 0, y: -1, z: 0 });
b.fingerDown(0, { point: h.point, normal: h.normal, dir: { x: 0, y: -1, z: 0 } });
const ev: any[] = []; const rows: string[] = [];
for (let s = 0, t = 0; t < 3.2; s++) {
  if (t < 1.2) b.fingerPressure(0, shellP(t)); else if (t < 1.2 + 1 / 60) b.fingerUp(0);
  b.step(1 / 60); t = (s + 1) / 60; b.drainEvents(ev);
  let my = 1e9; for (let i = 1; i < b.positions.length; i += 3) my = Math.min(my, b.positions[i]);
  if (s % 6 === 0 && t > 1.1 && t < 2.2) rows.push(`t ${t.toFixed(2)} lowest ${(my * 1000).toFixed(0)} mm centre y ${b.center.y.toFixed(3)} grounded ${b.metrics.grounded} comp ${b.metrics.compression.toFixed(2)}`);
}
console.log(`${id} family ${b.family} R ${R.toFixed(3)}\n` + rows.join('\n') + '\nevents ' + ev.map((e: any) => `${e.kind}:${e.intensity.toFixed(2)}`).join(' '));
