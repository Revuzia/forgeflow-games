// HIT PARADE — wall splat against the ring boundary (CHANGED(SIM3D), CONTRACT §35.2): shared by hits.ts (moves with
// onHit.wallSplat, IMPACT against the wall) and fighter.ts (a launched body flying into the boundary).
//
// WALL_SPLAT event payload (CONTRACT §35.13): a = victim, b = wall index (circle: sector 0..15, poly: side) + 256 *
// the wall's INWARD normal in whole degrees (yaw convention, 0..359), c = contact x (cm), d = contact z (cm).
// Consumers: index = b & 255, normalDeg = b >> 8.

import { CF, F, FL, ST } from './layout.ts';
import { CUE, EV } from './events.ts';
import { clearMove, emit, fb, setSt } from './state.ts';
import type { Match } from './state.ts';
import { pushCircle } from './boxes.ts';
import { ringClamp, ringRay, ringWall } from './ring.ts';
import { Q, cosQ, divRound, sinQ } from './fx3d.ts';

const PC = new Int32Array(3);
const RC = new Int32Array(2);
const WL = new Int32Array(4);

/**
 * Victim d splats on the ring wall it is against (after being driven along yaw `dirYaw`): its push circle is placed
 * touching the boundary on that side, stun = wallSplat.frames, one splat per combo (CF.SPLAT). `a` = the attacker (camera
 * cue), -1 = none.
 */
export function wallSplat(m: Match, a: number, d: number, dirYaw: number): void {
  const s = m.s;
  const bd = fb(d);
  clearMove(m, d);
  setSt(m, d, ST.WALL_SPLAT);
  s[bd + F.stun] = m.sys.raw.wallSplat.frames;
  s[bd + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING);
  // drive the body along the attack direction until its push circle touches the boundary (ray), then a ring clamp
  pushCircle(m, d, PC);
  const ux = sinQ(dirYaw);
  const uz = cosQ(dirYaw);
  const t = Math.max(0, ringRay(m.ring, PC[0], PC[1], ux, uz) - PC[2]);
  ringClamp(m.ring, PC[0] + divRound(ux * t, Q), PC[1] + divRound(uz * t, Q), PC[2], RC);
  s[bd + F.x] += RC[0] - PC[0];
  s[bd + F.z] += RC[1] - PC[1];
  s[bd + F.y] = 0;
  s[bd + F.vx] = 0;
  s[bd + F.vz] = 0;
  s[bd + F.vy] = 0;
  s[bd + F.pushF] = 0;
  s[bd + F.pushLeft] = 0;
  s[bd + F.cFlags] |= CF.SPLAT;
  s[bd + F.jc] = 0;
  ringWall(m.ring, RC[0], RC[1], WL);
  const deg = Math.trunc((WL[1] * 360) / 65536) % 360;
  emit(m, EV.WALL_SPLAT, d, WL[0] + 256 * deg, Math.trunc(WL[2] / 1000), Math.trunc(WL[3] / 1000));
  emit(m, EV.CAMERA_CUE, a >= 0 ? a : 1 - d, CUE.WALL_SPLAT, 0, 0);
}
