// GENESIS — roads from traffic (CONTRACT.md §7 `road`, §8.5): every walking segment wears the cell it enters; worn
// cells become paths, then roads (the renderer picks trail -> dirt -> cobble -> paved from the settlement's knowledge);
// unused roads grass over (except the god's paving: a cell at exactly 1). Wear saturates (each step adds a share of what is left) and decays daily; the field is
// published at most hourly.

import type { PCtx } from './ctx.ts';

/** wear per traversal (share of the remaining headroom) */
const WEAR = 0.0018;
/** daily decay of unused roads */
const DECAY = 0.985;

export function wearRoad(x: PCtx, c: number): void {
  const r = x.p.f.road;
  r[c] = Math.fround(r[c] + WEAR * (1 - r[c]));
  x.ps.roadDirty = true;
}

/** daily: roads fade where nobody walks */
export function decayRoads(x: PCtx): void {
  const r = x.p.f.road;
  let any = false;
  for (let c = 0; c < r.length; c++) {
    // (a cell at exactly 1 is the god's paving, god/shaping.ts: wear only approaches 1, and a paved road does not fade)
    if (r[c] <= 0 || r[c] >= 1) continue;
    const v = r[c] * DECAY - 0.0004;
    r[c] = v > 0 ? Math.fround(v) : 0;
    any = true;
  }
  if (any) x.ps.roadDirty = true;
}

/** hourly: publish the road field if traffic changed it */
export function publishRoads(x: PCtx): void {
  if (!x.ps.roadDirty) return;
  x.ps.roadDirty = false;
  x.p.bump('road');
}
