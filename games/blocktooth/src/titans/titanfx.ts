// BLOCKTOOTH — titan-vs-titan status primitives (lane B-TITAN, online VS). THREE-free, deterministic, TYPES-ONLY imports
// (so titansim.ts, rivals.ts, bodies.ts and the VS lane can all import it without a cycle).
//
// A rival's hit lands as: pvpHit (src/vs/pvp.ts, B-VS: how MUCH it hurts) + one of these (what it DOES to the body):
//   knockTitan  a decaying shove (total displacement in metres), resolved against the city by stepTitan
//   slowTitan   walk-speed multiplier for a while
//   rootTitan   no own movement (and no new dash) for a while
//   pullTitan   an instant displacement toward a point (MOLO's vacuum)
// CC accounting (the 1.0 s cap, CLEARED) is B-VS's (pvpCc); these only APPLY an effect for seconds already granted.
// Numeric kit keys (sim_kbx / sim_kbz / sim_rootT) are read with `?? 0` by stepTitan and never initialised, so a solo
// titan's kit record stays byte-identical.

import type { TitanState, World } from '../core/types.ts';
import { hypot } from '../core/detmath.ts';

/** Knockback velocity decay per second (linear per tick): a shove of D metres starts at D × KB_DECAY m/s. */
export const KB_DECAY = 6;
/** a shove never exceeds this many metres in one application (a stack of hits cannot launch a titan across the city) */
export const KB_MAX_M = 400;

function seat(w: World, slot: number): TitanState | null {
  const p = w.players && w.players[slot];
  return p ? p.titan : null;
}

/** Shove titan `slot` away along (dirX, dirZ) by `distM` metres in total (decaying velocity; adds to a running shove). */
export function knockTitan(w: World, slot: number, dirX: number, dirZ: number, distM: number): void {
  const T = seat(w, slot);
  if (!T || !T.alive || !(distM > 0) || !Number.isFinite(distM)) return;
  const l = hypot(dirX, dirZ);
  if (!(l > 1e-9)) return;
  const v = Math.min(distM, KB_MAX_M) * KB_DECAY / l;
  const K = T.kit;
  K.sim_kbx = (K.sim_kbx ?? 0) + dirX * v;
  K.sim_kbz = (K.sim_kbz ?? 0) + dirZ * v;
}

/** Slow titan `slot` to `speedMul` (0.1..1) of its walk speed for `seconds`; the stronger / longer live slow wins. */
export function slowTitan(w: World, slot: number, speedMul: number, seconds: number): void {
  const T = seat(w, slot);
  if (!T || !T.alive || !(seconds > 0) || !Number.isFinite(seconds)) return;
  const m = Math.min(1, Math.max(0.1, speedMul));
  if (T.slowT > 0) { T.slowMul = Math.min(T.slowMul, m); T.slowT = Math.max(T.slowT, seconds); }
  else { T.slowMul = m; T.slowT = seconds; }
}

/** Root titan `slot` for `seconds`: no own walking, no new dash (an already running dash, shoves and pulls still move it). */
export function rootTitan(w: World, slot: number, seconds: number): void {
  const T = seat(w, slot);
  if (!T || !T.alive || !(seconds > 0) || !Number.isFinite(seconds)) return;
  T.kit.sim_rootT = Math.max(T.kit.sim_rootT ?? 0, seconds);
}

/** Displace titan `slot` up to `distM` metres toward (x, z), stopping `stop` metres short of it. Returns the metres moved. */
export function pullTitan(w: World, slot: number, x: number, z: number, distM: number, stop = 0): number {
  const T = seat(w, slot);
  if (!T || !T.alive || !(distM > 0)) return 0;
  const dx = x - T.x, dz = z - T.z;
  const d = hypot(dx, dz);
  const room = d - Math.max(0, stop);
  if (!(room > 1e-6)) return 0;
  const m = Math.min(distM, room);
  T.x += (dx / d) * m; T.z += (dz / d) * m;
  const B = w.city.bounds;
  T.x = Math.min(B.maxX, Math.max(B.minX, T.x));
  T.z = Math.min(B.maxZ, Math.max(B.minZ, T.z));
  return m;
}
