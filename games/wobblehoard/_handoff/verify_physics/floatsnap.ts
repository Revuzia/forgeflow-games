// float mode: a grab that drags the floating body 2 R reads a full-ish pull level; how much did it stretch?
import { SoftBody, speciesTemplateGenome } from './attack_lib.ts';
for (const grav of [true, false]) for (const id of ['dollop', 'boingle']) {
  const b: any = new SoftBody(speciesTemplateGenome(id)); b.gravity = grav;
  for (let i = 0; i < 120; i++) b.step(1 / 60);
  const R = b.restRadius, h = b.raycast({ x: b.center.x + 4 * R, y: b.center.y, z: b.center.z }, { x: -1, y: 0, z: 0 });
  b.grab(0, h.vertex, h.point); let st = 0; const c0 = { ...b.center };
  for (let k = 0; k < 90; k++) { b.grabMove(0, { x: h.point.x + 2 * R * Math.min(1, k / 45), y: h.point.y, z: h.point.z }); b.step(1 / 60); st = Math.max(st, b.metrics.stretch); }
  const moved = Math.hypot(b.center.x - c0.x, b.center.z - c0.z) / R;
  b.grabRelease(0); const ev: any[] = []; b.step(1 / 60); b.drainEvents(ev);
  console.log(`${grav ? 'table' : 'float'} ${id}: maxPull ${b.params.maxPull.toFixed(2)} R, target pulled 2 R, body centre moved ${moved.toFixed(2)} R, max stretch ${st.toFixed(3)}, snap ${ev.filter((e: any) => e.kind === 'snap').map((e: any) => e.intensity.toFixed(3)).join(',') || 'none'}`);
}
