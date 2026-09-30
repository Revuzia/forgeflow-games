// HIT PARADE - Lv3 "PRIME TIME" camera tracks (CONTRACT §7, §17 rule 5; FIGHTING_DESIGN §7b "Cinematics").
//
// A track is a list of keyed camera shots authored in the ATTACKER's frame: origin at the attacker's feet, +x toward
// the opponent (mirrored by facing), +y up, +z toward the default camera side. The track is driven ONLY by the sim's
// cinematic frame (MatchSnap.cinematic.frame, 0 .. cinematic.frames-1): the camera sequence lasts exactly
// `cinematic.frames` sim frames whatever the track was authored at (a mismatched track is time-scaled onto the sim's
// frame count, never the other way round), so both online clients show the same beats and rollback re-poses it.
// Keys interpolate with smoothstep; `cut: true` on a key = a hard cut AT that key (the previous shot holds until it).
// The 'short' cinematic setting only swaps the SHOTS (a track's `short` keys, else one steady wide), never the length.

import * as THREE from 'three';
import type { CinePose } from './camera.ts';

export type V3 = readonly [number, number, number];
export interface CineKey { f: number; pos: V3; look: V3; fov?: number; roll?: number; cut?: boolean }
export interface CineTrack { id: string; frames: number; keys: CineKey[]; short?: CineKey[] }

const DEG = Math.PI / 180;
const TRACKS = new Map<string, CineTrack>();

export function registerTrack(t: CineTrack): void {
  const keys = t.keys.slice().sort((a, b) => a.f - b.f);
  if (!keys.length || keys[0].f !== 0) throw new Error(`cinematic track ${t.id}: the first key must be at frame 0`);
  TRACKS.set(t.id, { ...t, keys, short: t.short?.slice().sort((a, b) => a.f - b.f) });
}

/** the sample Lv3 track (150 frames): face close-up -> strike dolly -> over-the-shoulder -> orbit -> impact close-up */
export const GENERIC_PRIME_TIME: CineTrack = {
  id: 'generic_prime_time',
  frames: 150,
  keys: [
    // 1. low close-up on the attacker's face, slow push (the "showtime" pose)
    { f: 0, pos: [0.9, 1.25, 1.55], look: [0.05, 1.55, 0], fov: 32, roll: -3 },
    { f: 28, pos: [0.75, 1.3, 1.25], look: [0.05, 1.58, 0], fov: 30, roll: -2 },
    // 2. CUT: side dolly tracking the first strikes
    { f: 30, pos: [0.4, 1.1, 3.1], look: [0.7, 1.2, 0], fov: 34, cut: true },
    { f: 58, pos: [1.2, 1.15, 2.8], look: [1.0, 1.2, 0], fov: 34 },
    // 3. CUT: over the attacker's shoulder toward the victim
    { f: 60, pos: [-1.1, 1.7, 0.9], look: [1.4, 1.2, -0.1], fov: 38, cut: true },
    { f: 98, pos: [-0.8, 1.6, 1.3], look: [1.4, 1.1, 0], fov: 36 },
    // 4. CUT: low wide orbit around both
    { f: 100, pos: [2.8, 0.5, 3.2], look: [0.8, 1.2, 0], fov: 40, roll: 4, cut: true },
    { f: 128, pos: [-0.2, 0.7, 3.9], look: [0.8, 1.25, 0], fov: 40, roll: -2 },
    // 5. CUT: the final blow on the victim, tight
    { f: 130, pos: [1.9, 1.35, 1.6], look: [1.0, 1.25, 0], fov: 30, cut: true },
    { f: 149, pos: [2.1, 1.4, 2.2], look: [1.0, 1.2, 0], fov: 33 },
  ],
  short: [
    { f: 0, pos: [0.7, 1.2, 4.2], look: [0.7, 1.15, 0], fov: 35 },
    { f: 149, pos: [0.7, 1.2, 3.8], look: [0.7, 1.15, 0], fov: 35 },
  ],
};
registerTrack(GENERIC_PRIME_TIME);

export function trackFor(cue: string | undefined): CineTrack {
  return (cue && TRACKS.get(cue)) || GENERIC_PRIME_TIME;
}

function smooth(t: number): number { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * The camera pose at sim cinematic frame `frame` of a cinematic `simFrames` long.
 * @param ax attacker x (m), @param facing +1 / -1 (toward the opponent)
 */
export function sampleTrack(track: CineTrack, frame: number, simFrames: number, ax: number, facing: number,
  short: boolean, out: CinePose): CinePose {
  const keys = short && track.short && track.short.length ? track.short : (short ? null : track.keys);
  const n = simFrames > 1 ? simFrames : track.frames;
  const tf = (Math.max(0, Math.min(n - 1, frame)) / Math.max(1, n - 1)) * (track.frames - 1);
  if (!keys) {                                            // 'short' without authored shorts: one steady wide
    out.pos.set(ax + facing * 0.7, 1.2, 4.2); out.look.set(ax + facing * 0.7, 1.15, 0); out.fov = 35; out.roll = 0;
    return out;
  }
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].f <= tf) i++;
  const k0 = keys[i];
  const k1 = i + 1 < keys.length ? keys[i + 1] : null;
  let u = 0;
  if (k1 && !k1.cut) u = smooth((tf - k0.f) / Math.max(1e-6, k1.f - k0.f));
  const pa = _a.set(k0.pos[0], k0.pos[1], k0.pos[2]), la = _b.set(k0.look[0], k0.look[1], k0.look[2]);
  let fov = k0.fov ?? 35, roll = k0.roll ?? 0;
  if (k1 && u > 0) {
    pa.lerp(_c.set(k1.pos[0], k1.pos[1], k1.pos[2]), u);
    la.lerp(_d.set(k1.look[0], k1.look[1], k1.look[2]), u);
    fov += ((k1.fov ?? fov) - fov) * u;
    roll += ((k1.roll ?? roll) - roll) * u;
  }
  out.pos.set(ax + facing * pa.x, pa.y, pa.z);
  out.look.set(ax + facing * la.x, la.y, la.z);
  out.fov = fov;
  out.roll = roll * DEG * facing;
  return out;
}

export function newPose(): CinePose {
  return { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 35, roll: 0 };
}
