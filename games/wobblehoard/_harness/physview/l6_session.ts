// PHYS (CUT2 task P2, probe row L6 = X21 for the solver): scripted sessions on WHOLE bodies whose `stateHash` must never change when the cut machinery is added.
// The class is passed in so the same script runs against a snapshot of the committed solver (to record `l6_golden.json`) and against the live one.
//   wholeSession: settle, press, rub, release, pull + release, nudge, fold ceremony, burst, setFrac, then the first setNeck: 10 checkpoints.
//   pairSession: two whole bodies, the second dropped on the first and `collide` every frame for 7 s: 7 checkpoints (one per second) of both bodies' hashes.
import type { SoftBody } from '../../src/physics/softbody.ts';
import { speciesTemplateGenome } from '../../src/data/catalog.ts';

const DT = 1 / 60;
export type SoftBodyClass = new (g: never, o?: never) => SoftBody;

export function wholeSession(SB: SoftBodyClass, id: string): number[] {
  const b = new SB(speciesTemplateGenome(id as never) as never);
  const h: number[] = [], run = (k: number, each?: (i: number) => void): void => { for (let i = 0; i < k; i++) { each?.(i); b.step(DT); } };
  const R = b.restRadius;
  run(60); h.push(b.stateHash());                                                                    // 0 settle
  const hit = b.raycast({ x: b.center.x + 0.1 * R, y: 4, z: b.center.z }, { x: 0, y: -1, z: 0 })!;
  b.fingerDown(0, { point: hit.point, normal: hit.normal, dir: { x: 0, y: -1, z: 0 } }); b.fingerPressure(0, 0.8);
  run(30); h.push(b.stateHash());                                                                    // 1 press
  run(40, (i) => b.fingerMove(0, { x: hit.point.x + 0.02 * Math.sin(i * 0.3), y: hit.point.y, z: hit.point.z })); h.push(b.stateHash());   // 2 rub
  b.fingerUp(0); run(30); h.push(b.stateHash());                                                     // 3 release
  const gh = b.raycast({ x: b.center.x + 3 * R, y: b.center.y + 0.3 * R, z: 0 }, { x: -1, y: 0, z: 0 })!;
  b.grab(0, gh.vertex, gh.point); run(30, (i) => b.grabMove(0, { x: gh.point.x + i * 0.01, y: gh.point.y + i * 0.006, z: gh.point.z })); b.grabRelease(0); run(30); h.push(b.stateHash());   // 4 pull + release
  b.nudge({ x: 0.5, y: 0, z: 0.2 }); run(30); h.push(b.stateHash());                                // 5 nudge
  b.setFold!(1); run(40); b.setFold!(0); run(40); h.push(b.stateHash());                             // 6 fold ceremony
  b.burstOpen!(0.8); run(40); h.push(b.stateHash());                                                 // 7 burst
  b.setFrac!(0.7, 0.3); run(30); b.setFrac!(1, 0.3); run(30); h.push(b.stateHash());                 // 8 setFrac
  const c = b.center; for (let i = 0; i < 40; i++) { b.setNeck!({ point: { x: c.x, y: c.y, z: c.z }, normal: { x: 0, y: 0, z: 1 } }, Math.min(1, (i + 1) / 20)); b.step(DT); } h.push(b.stateHash());   // 9 neck (the first setNeck)
  return h;
}

export function pairSession(SB: SoftBodyClass, idA: string, idB: string): number[] {
  const a = new SB(speciesTemplateGenome(idA as never) as never);
  const b = new SB(speciesTemplateGenome(idB as never) as never, { piece: { frac: 1, chunk: false, at: { x: 0.04, y: 1.9 * a.restRadius, z: -0.03 } } } as never);
  const bodies = [a, b], h: number[] = [];
  for (let s = 0; s < 7; s++) {
    for (let i = 0; i < 60; i++) { for (const x of bodies) x.collide(bodies); for (const x of bodies) x.step(DT); }
    h.push(a.stateHash(), b.stateHash());
  }
  return h;
}
