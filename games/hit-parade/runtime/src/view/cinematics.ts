// HIT PARADE - Lv3 "PRIME TIME" camera shots (CONTRACT §7, §17 rule 5, §20.2 `cinematic.shots`; FIGHTING_DESIGN §7b).
//
// A PRIME TIME track is the move's `cinematic.shots` list ([[frame, shotName], ...], shot names = the _spec/ROSTER.md
// vocabulary) compiled by view/prime.ts: every shot starts with a HARD CUT and moves a little inside itself (a push, a
// snap zoom, an orbit sweep). A shot is a pure function of (progress u in the shot, the attacker / victim layout in the
// ATTACKER's frame): origin at the attacker's feet, +x toward the opponent (mirrored by facing), +y up, +z toward the
// default camera side. The whole track is driven ONLY by the sim's cinematic frame (MatchSnap.cinematic.frame), lasts
// exactly `cinematic.frames` frames, and re-poses identically after a rollback.
// Per-fighter authoring = per-shot `ShotParams` overrides in view/prime.ts (CUES), never a different frame count.
// The 'short' cinematic setting swaps the shots for one steady wide (prime.ts), never the length.
//
// Legacy API (P1): `CineTrack` keyed tracks + `sampleTrack` stay for tracks authored as raw keys (GENERIC_PRIME_TIME is
// the fallback for a super3 without a `shots` list).

import * as THREE from 'three';
import type { CinePose } from './camera.ts';

export type V3 = readonly [number, number, number];
export interface CineKey { f: number; pos: V3; look: V3; fov?: number; roll?: number; cut?: boolean }
export interface CineTrack { id: string; frames: number; keys: CineKey[]; short?: CineKey[] }

const DEG = Math.PI / 180;

// ───────────────────────────────────────── the shot vocabulary ─────────────────────────────────────────

export const SHOT_NAMES = ['side_close', 'punch_in', 'front_low', 'low_angle_up', 'top_down', 'over_shoulder', 'orbit', 'crowd_pop',
  'wide', 'slowmo_hold', 'host_cam', 'spotlight'] as const;
export type ShotName = typeof SHOT_NAMES[number];

/** per-fighter shot tuning (all optional; metres / degrees in the attacker's frame) */
export interface ShotParams {
  /** what the shot frames: attacker, victim or both (default per shot) */
  focus?: 'att' | 'vic' | 'mid';
  /** camera distance scale (1 = the shot's own) */
  dist?: number;
  /** camera height offset (m) */
  lift?: number;
  /** look-at height offset (m) */
  aim?: number;
  fov?: number;
  roll?: number;
  /** orbit sweep in degrees (orbit) / pan (crowd_pop) */
  sweep?: number;
  /** -1 puts the camera on the far (-z) side where a shot allows it (never behind the crowd line) */
  side?: number;
  /** extra forward offset of the framing centre (m) */
  shift?: number;
}

/** the layout a shot frames, in the attacker's frame */
export interface ShotCtx {
  /** 0..1 progress inside this shot */
  u: number;
  /** shot length (frames) */
  n: number;
  /** victim root, forward from the attacker (m) */
  vx: number;
  /** victim root height (m) */
  vy: number;
  /** attacker root height (m; leaps) */
  ay: number;
  /** body heights (m) */
  hA: number;
  hV: number;
  /** crowd focus, in the attacker's frame (x fwd, y, z); null = none known */
  crowd: V3 | null;
  p?: ShotParams;
}

export interface LocalPose { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll: number }

function smooth(t: number): number { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); }
function easeOut(t: number): number { const x = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - (1 - x) * (1 - x) * (1 - x); }

function focusX(c: ShotCtx, dflt: 'att' | 'vic' | 'mid'): number {
  const f = c.p?.focus ?? dflt;
  const x = f === 'att' ? 0.1 : f === 'vic' ? c.vx : c.vx * 0.5;
  return x + (c.p?.shift ?? 0);
}

/**
 * The camera for shot `name` at progress `c.u`, in the attacker's frame (x fwd, y up, z camera side).
 * `prev` = the previous shot's final pose (slowmo_hold holds it and pushes in).
 */
export function sampleShot(name: string, c: ShotCtx, out: LocalPose, prev: LocalPose | null): LocalPose {
  const p = c.p ?? {};
  const k = p.dist ?? 1;
  const lift = p.lift ?? 0, aim = p.aim ?? 0;
  const sA = c.hA / 1.8, sV = c.hV / 1.8;
  const u = c.u;
  let fov = 35, roll = 0;
  switch (name as ShotName) {
    case 'side_close': {                                   // tight side two-shot, slow push
      const x = focusX(c, 'mid');
      const d = (2.35 - 0.35 * smooth(u)) * k * Math.max(1, 0.55 + c.vx * 0.35);
      out.pos.set(x - 0.15, 1.3 * Math.max(sA, sV) + lift + 0.08 * u, d);
      out.look.set(x, 1.2 * Math.max(sA, sV) + aim + c.vy * 0.5, 0);
      fov = 31; roll = -1.5;
      break;
    }
    case 'punch_in': {                                     // snap zoom onto the victim's upper body
      const x = focusX(c, 'vic');
      const z = easeOut(u / 0.22);
      out.pos.set(x - 0.55, 1.42 * sV + lift + c.vy * 0.8, 2.7 * k);
      out.look.set(x - 0.05, (0.74 * c.hV) + c.vy + aim, 0);
      fov = 38 - 16 * z - 2 * smooth((u - 0.22) / 0.78);
      roll = 4 - 2 * u;
      break;
    }
    case 'front_low': {                                    // low 3/4 front on the attacker's face, victim foreground
      const x = focusX(c, 'att');
      out.pos.set(c.vx + 1.05 * k, 0.45 + lift, (1.75 - 0.25 * smooth(u)) * k);
      out.look.set(x + 0.05, 0.64 * c.hA + c.ay + aim, 0);
      fov = 40; roll = 2;
      break;
    }
    case 'low_angle_up': {                                 // from the floor, looking up at the launch
      const x = focusX(c, 'vic');
      out.pos.set(x - 0.95 * k, 0.16 + lift, 1.95 * k);
      out.look.set(x, 1.0 + c.vy * 0.85 + aim, 0);
      fov = 44 - 4 * smooth(u); roll = -3;
      break;
    }
    case 'top_down': {                                     // high overhead on the slam
      const x = focusX(c, 'vic');
      out.pos.set(x * 0.8 - 0.1, (4.5 - 0.35 * smooth(u)) * k + lift, 1.35 * k);
      out.look.set(x * 0.9, 0.25 + aim, 0);
      fov = 46; roll = 0;
      break;
    }
    case 'over_shoulder': {                                // behind the attacker's shoulder toward the victim
      const x = focusX(c, 'vic');
      out.pos.set(-0.8 * k, 0.96 * c.hA + c.ay + lift, (0.72 + 0.22 * smooth(u)) * k);
      out.look.set(x, 0.62 * c.hV + c.vy + aim, -0.1);
      fov = 38; roll = 0;
      break;
    }
    case 'orbit': {                                        // sweep around both (never behind the fight plane)
      const x = focusX(c, 'mid');
      const sw = (p.sweep ?? 110) * DEG;
      const a = -sw / 2 + sw * smooth(u);
      const r = 3.1 * k;
      out.pos.set(x + Math.sin(a) * r, 1.45 + lift, Math.max(0.9, Math.cos(a) * r));
      out.look.set(x, 1.1 + c.vy * 0.5 + aim, 0);
      fov = 38; roll = 0;
      break;
    }
    case 'crowd_pop': {                                    // cut to the house going wild (fighters in the foreground)
      const x = focusX(c, 'mid');
      const cw = c.crowd ?? [x + 0.8, 2.6, -7.0];
      const pan = (p.sweep ?? 14) * DEG * (u - 0.5);
      out.pos.set(x + 0.4, 1.05 + lift, 2.3 * k);
      const dx = cw[0] - out.pos.x, dz = cw[2] - out.pos.z;
      const ca = Math.cos(pan), sa = Math.sin(pan);
      out.look.set(out.pos.x + dx * ca - dz * sa, cw[1] + aim + 0.3, out.pos.z + dx * sa + dz * ca);
      fov = 42; roll = 3 * (0.5 - u);
      break;
    }
    case 'wide': {                                         // pull back: the whole set, slow dolly out
      const x = focusX(c, 'mid');
      out.pos.set(x, 1.75 + lift, (6.6 + 0.8 * smooth(u)) * k);
      out.look.set(x, 1.05 + aim + c.vy * 0.3, 0);
      fov = 36; roll = 0;
      break;
    }
    case 'host_cam': {                                     // the host's own camera: frontal medium, handheld wobble
      const x = focusX(c, 'att');
      const t = u * c.n / 60;
      out.pos.set(x + 0.55 + 0.02 * Math.sin(t * 3.1), 0.88 * c.hA + lift + 0.015 * Math.sin(t * 4.3 + 1), 2.35 * k);
      out.look.set(x + 0.12, 0.82 * c.hA + aim + 0.01 * Math.sin(t * 2.7), 0);
      fov = 27; roll = 1.2 * Math.sin(t * 1.9);
      break;
    }
    case 'spotlight': {                                    // set dark, one light on the star (dim + shaft in prime.ts)
      const x = focusX(c, 'att');
      out.pos.set(x + 0.7, 1.3 + lift, (3.3 - 0.4 * smooth(u)) * k);
      out.look.set(x + 0.05, 0.62 * c.hA + aim, 0);
      fov = 33; roll = -2;
      break;
    }
    case 'slowmo_hold': {                                  // hold the previous frame, creep in while time crawls
      if (prev) {
        out.pos.copy(prev.pos).lerp(prev.look, 0.1 * smooth(u));
        out.look.copy(prev.look);
        fov = prev.fov * (1 - 0.06 * smooth(u)); roll = prev.roll;
      } else {
        const x = focusX(c, 'vic');
        out.pos.set(x - 0.4, 1.2, 2.4 * k); out.look.set(x, 1.0 + c.vy, 0); fov = 32;
      }
      break;
    }
    default: {                                             // unknown name: a safe medium two-shot
      const x = focusX(c, 'mid');
      out.pos.set(x, 1.4 + lift, 3.4 * k); out.look.set(x, 1.1 + aim, 0); fov = 35;
    }
  }
  if (p.side === -1 && name !== 'crowd_pop') { out.pos.z = Math.max(0.9, out.pos.z * 0.55); }
  out.fov = p.fov ?? fov;
  out.roll = (p.roll ?? roll) * DEG;
  return out;
}

export function newLocalPose(): LocalPose { return { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 35, roll: 0 }; }

// ───────────────────────────────────────── legacy keyed tracks (P1) ─────────────────────────────────────────

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
    { f: 0, pos: [0.9, 1.25, 1.55], look: [0.05, 1.55, 0], fov: 32, roll: -3 },
    { f: 28, pos: [0.75, 1.3, 1.25], look: [0.05, 1.58, 0], fov: 30, roll: -2 },
    { f: 30, pos: [0.4, 1.1, 3.1], look: [0.7, 1.2, 0], fov: 34, cut: true },
    { f: 58, pos: [1.2, 1.15, 2.8], look: [1.0, 1.2, 0], fov: 34 },
    { f: 60, pos: [-1.1, 1.7, 0.9], look: [1.4, 1.2, -0.1], fov: 38, cut: true },
    { f: 98, pos: [-0.8, 1.6, 1.3], look: [1.4, 1.1, 0], fov: 36 },
    { f: 100, pos: [2.8, 0.5, 3.2], look: [0.8, 1.2, 0], fov: 40, roll: 4, cut: true },
    { f: 128, pos: [-0.2, 0.7, 3.9], look: [0.8, 1.25, 0], fov: 40, roll: -2 },
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

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * The camera pose at sim cinematic frame `frame` of a cinematic `simFrames` long (keyed legacy track).
 * @param ax attacker x (m), @param facing +1 / -1 (toward the opponent)
 */
export function sampleTrack(track: CineTrack, frame: number, simFrames: number, ax: number, facing: number,
  short: boolean, out: CinePose): CinePose {
  const keys = short && track.short && track.short.length ? track.short : (short ? null : track.keys);
  const n = simFrames > 1 ? simFrames : track.frames;
  const tf = (Math.max(0, Math.min(n - 1, frame)) / Math.max(1, n - 1)) * (track.frames - 1);
  if (!keys) {
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
