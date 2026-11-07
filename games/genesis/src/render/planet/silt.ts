// GENESIS — the river runs brown before a flood (ARC §10, render hook H5).
//
// During a flood's warning the sim raises the river in its channel (precursors.ts riverRise, drawn by the water field
// as it is) and marks the flood's DisasterView.params with `warning: 1`, `rise` 0..1 and `silt: 1`. The water shader
// (planet/ocean.ts) cannot see disasters, so each planet keeps up to SILT_MAX "silt zones" — a body-frame centre, a
// radius and a strength — that turn the water inside them a muddy brown: the rain upstream washing the soil down.
// The brown deepens as the river rises, stays while the flood is out (flood water is brown) and clears slowly after.
// One fixed-size uniform array: no shader variant, nothing compiled after t=0, the same at every quality preset.
import { Vector4 } from 'three';
import type { DisasterView } from '../../sim/types.ts';

export const SILT_MAX = 4;

export interface SiltState {
  /** per disaster id: the eased strength, its centre and radius (kept so a finished flood can clear slowly) */
  zones: Map<number, { k: number; x: number; y: number; z: number; r: number }>;
}

export function makeSiltState(): SiltState { return { zones: new Map() }; }

/** the strength a flood's water is drawn brown with (0 = clear) */
export function siltTarget(d: DisasterView): number {
  if (d.kind !== 'flood') return 0;
  const P = d.params ?? {};
  // the warning: brown from the first rain upstream, deepening as the river rises toward the flood
  if (P.warning) return (P.silt ?? 1) > 0 ? 0.45 + 0.55 * Math.min(1, Math.max(0, P.rise ?? 0)) : 0;
  // the flood itself is brown water
  return 1;
}

/** how far into its brown a flood already is when its zone is first seen (0: at the warning's very start) */
function lateStart(d: DisasterView): number {
  const P = d.params ?? {};
  if (P.warning) return Math.min(1, Math.max(0, (P.rise ?? 0) * 4));
  return Math.min(1, Math.max(0, (d.progress ?? 0) * 10));
}

/**
 * ease each flood's zone toward its target (`dt` real seconds) and write the strongest SILT_MAX into `out`
 * (xyz = body-frame centre in m, w = radius in m; w = 0 marks an empty slot) and their strengths into `k`
 */
export function updateSilt(st: SiltState, disasters: readonly DisasterView[], planetRadius: number, dt: number, out: Vector4[], k: number[]): void {
  const seen = new Set<number>();
  const rate = 1 - Math.exp(-Math.max(0, dt) / 2.5);
  for (const d of disasters) {
    const t = siltTarget(d);
    if (t <= 0 && !st.zones.has(d.id)) continue;
    seen.add(d.id);
    let z = st.zones.get(d.id);
    // (wider than the flood: the river runs brown along its reach, not only in the town's circle)
    const r = Math.max(400, d.radius * 1.6);
    // a zone first seen mid-way (a save loaded, the planet just came into view, frames held while the sim ran on: a
    // shot) starts where the river already is; only a warning seen from its start eases in from clear water
    if (!z) { z = { k: t * lateStart(d), x: 0, y: 0, z: 0, r }; st.zones.set(d.id, z); }
    z.x = d.pos[0] * planetRadius; z.y = d.pos[1] * planetRadius; z.z = d.pos[2] * planetRadius; z.r = r;
    z.k += (t - z.k) * rate;
  }
  // a finished flood's water clears more slowly (the silt settles)
  const clear = 1 - Math.exp(-Math.max(0, dt) / 12);
  for (const [id, z] of st.zones) {
    if (seen.has(id)) continue;
    z.k -= z.k * clear;
    if (z.k < 0.01) st.zones.delete(id);
  }
  const best = [...st.zones.values()].filter((z) => z.k >= 0.01).sort((a, b) => b.k - a.k);
  for (let i = 0; i < SILT_MAX; i++) {
    const z = best[i];
    if (z) { out[i].set(z.x, z.y, z.z, z.r); k[i] = Math.min(1, z.k); } else { out[i].set(0, 0, 0, 0); k[i] = 0; }
  }
}

/**
 * ARC §10: the god's eye over a warned river. While a flood's silt zone is active and the camera looks down on it from
 * the usual town view (a few hundred metres to ~1.5 km up), the cloud between the lens and the ground is cleared (a dense deck at even 5 % is still opaque over 300 m), so
 * the river rising brown and the people walking uphill can be seen; the rain, the overcast light and the clouds
 * further off (upstream, where the rain hangs) stay. Returns the clearing's reach (m along the view ray) and strength
 * 0..1 (k = 0: no clearing). `cam` is the camera in the body frame (m), `altitude` its height over the datum.
 */
export function siltLensClear(cam: ArrayLike<number>, altitude: number, zones: readonly Vector4[], k: readonly number[]): { r: number; k: number } {
  const cl = Math.hypot(cam[0], cam[1], cam[2]);
  if (!(cl > 0) || altitude <= 0 || altitude > 2500) return { r: 0, k: 0 };
  let best = 0;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i], zk = k[i] ?? 0;
    if (!(z.w > 0) || zk <= 0) continue;
    const zl = Math.hypot(z.x, z.y, z.z) || 1;
    // the ground point under the camera, against the zone's centre (great-circle chord, m)
    const g = zl / cl;
    const d = Math.hypot(cam[0] * g - z.x, cam[1] * g - z.y, cam[2] * g - z.z);
    // (the camera stands off from what it looks at: from the town view, 400-900 m out at ~40 deg, its ground point
    // lies up to ~1.5 altitudes from the river it frames)
    const near = 1 - Math.min(1, Math.max(0, (d - z.w - 1.5 * altitude) / (z.w * 0.7 + 300)));
    best = Math.max(best, Math.min(1, zk * 3) * near);
  }
  // fades out as the camera climbs toward a regional view (the deck is the weather there, not a veil over the town)
  const hk = 1 - Math.min(1, Math.max(0, (altitude - 1800) / 700));
  const kk = best * hk;
  // (reach: past the town the camera frames — at ~40 deg down its slant range is ~1.6 altitudes; inside a low deck
  // the cloud between lens and town is all of it)
  return kk > 0.005 ? { r: Math.min(2000, Math.max(250, altitude * 2.2)), k: kk } : { r: 0, k: 0 };
}
