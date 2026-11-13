// VALE render — unit picking (CSS px → the unit under the cursor). Pure: a camera, the canvas size and the
// pickable units in, an id out (renderer.ts pickEntity feeds it the visible, alive, targetable actors).
//
// Each unit's hit box spans its body on screen: the model from the ground to its art height, as wide as its
// collision circle (+0.15 m) at the ground scale under it (never the vertical model scale, which is narrower
// at the camera's pitch), and down to the front edge of its selection ring (radius + 0.22 m). Overlapping
// boxes go to the box whose body axis (feet → head) is nearest the cursor; an exact tie goes to the unit
// nearer the camera, then the lower id. `filter` drops units before they compete (an enemies-only pick never
// returns you or an ally standing in front of the enemy); `slop` (px) accepts a near miss: with no box under
// the cursor, the box whose edge is nearest within `slop` wins.

import { type Camera, Vector3 } from 'three';
import type { EntityId, EntityView } from '../contracts/sim.ts';

/** pickEntity options: `filter` keeps only the units a command can use; `slop` (CSS px) accepts near misses */
export interface PickOptions { filter?: (v: EntityView) => boolean; slop?: number }
/** a unit that can be picked: sim x/y on the ground, h = ground height under it (world y) */
export interface Pickable { id: EntityId; x: number; y: number; h: number; artHeight: number; view: EntityView }

const _p = new Vector3();

export function pickUnit(cam: Camera, cssW: number, cssH: number, units: Iterable<Pickable>, x: number, y: number, opts?: PickOptions): EntityId | null {
  const filter = opts?.filter, slop = Math.max(0, opts?.slop ?? 0);
  const sx = (): number => (_p.x * 0.5 + 0.5) * cssW;
  const sy = (): number => (-_p.y * 0.5 + 0.5) * cssH;
  let best: EntityId | null = null, bestScore = Infinity, bestFy = -Infinity;
  let near: EntityId | null = null, nearGap = Infinity, nearFy = -Infinity;
  for (const a of units) {
    const v = a.view;
    if (filter && !filter(v)) continue;
    _p.set(a.x, a.h, a.y).project(cam);
    if (_p.z > 1) continue;
    const fx = sx(), fy = sy();
    _p.set(a.x, a.h + a.artHeight, a.y).project(cam);
    const hy = sy();
    // the ground scale under the unit: across (screen x) and in depth (towards / away from the camera)
    const rr = v.radius + 0.15, ring = v.radius + 0.22;
    _p.set(a.x + rr, a.h, a.y).project(cam);
    const rx = Math.max(16, Math.abs(sx() - fx));
    _p.set(a.x, a.h, a.y + ring).project(cam);
    const f1 = sy();
    _p.set(a.x, a.h, a.y - ring).project(cam);
    const f2 = sy();
    const top = Math.min(hy, fy - 24) - 6;
    const bottom = Math.max(fy + rx * 0.6, f1, f2);
    const dx = Math.abs(x - fx);
    const outX = Math.max(0, dx - rx), outY = y < top ? top - y : y > bottom ? y - bottom : 0;
    if (outX === 0 && outY === 0) {
      // distance from the cursor to the body axis (feet → head); the vertical part damped (tall bodies)
      const axisY = y < hy ? hy - y : y > fy ? y - fy : 0;
      const score = dx + axisY * 0.5;
      if (score < bestScore - 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && (fy > bestFy || (fy === bestFy && best !== null && a.id < best)))) {
        bestScore = score; best = a.id; bestFy = fy;
      }
    } else if (slop > 0 && best === null) {
      const gap = Math.hypot(outX, outY);
      if (gap <= slop && (gap < nearGap - 1e-6 || (Math.abs(gap - nearGap) <= 1e-6 && (fy > nearFy || (fy === nearFy && near !== null && a.id < near))))) {
        nearGap = gap; near = a.id; nearFy = fy;
      }
    }
  }
  return best ?? near;
}
