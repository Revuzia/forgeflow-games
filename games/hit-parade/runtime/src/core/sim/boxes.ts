// HIT PARADE — box geometry in world U (CONTRACT §4.3.2-3). Rects are [x0, x1, y0, y1].
// Hurtboxes: posture box (stand / crouch / air, width centred on x, height from the feet) plus the
// running move's hurtExt boxes. Hitboxes: move boxes are centred on (x fwd, y up), mirrored by facing.

import { F, FL, ST } from './layout.ts';
import { fb } from './state.ts';
import type { Match } from './state.ts';
import type { CMove } from './compile.ts';

export const POSTURE = { STAND: 0, CROUCH: 1, AIR: 2 } as const;

export function posture(m: Match, i: number): number {
  const s = m.s;
  const b = fb(i);
  const st = s[b + F.st];
  if ((s[b + F.flags] & FL.AIRBORNE) !== 0 || st === ST.AIR || st === ST.JUGGLE) return POSTURE.AIR;
  if ((s[b + F.flags] & FL.CROUCHING) !== 0) return POSTURE.CROUCH;
  return POSTURE.STAND;
}

/** Writes the hurt rects of fighter `i` into `out` (4 ints each); returns the count. */
export function hurtRects(m: Match, i: number, out: Int32Array): number {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const x = s[b + F.x];
  const y = s[b + F.y];
  const p = posture(m, i);
  const box = p === POSTURE.AIR ? cf.hurtAir : p === POSTURE.CROUCH ? cf.hurtCrouch : cf.hurtStand;
  let bw = box[0];
  let bh = box[1];
  let by = 0;
  const k = s[b + F.mv];
  if (k >= 0 && s[b + F.st] === ST.ATTACK) {
    const mv = cf.moves[k];
    const f = s[b + F.mvF];
    for (let j = 0; j < mv.nHurtOv; j++) {
      const o = j * 5;
      if (f < mv.hurtOv[o] || f > mv.hurtOv[o + 1]) continue;
      bw = mv.hurtOv[o + 2];
      bh = mv.hurtOv[o + 3];
      by = mv.hurtOv[o + 4];
      break;
    }
  }
  const hw = bw >> 1;
  out[0] = x - hw;
  out[1] = x + hw;
  out[2] = y + by;
  out[3] = y + by + bh;
  let n = 1;
  if (k >= 0 && s[b + F.st] === ST.ATTACK) {
    const mv = cf.moves[k];
    const f = s[b + F.mvF];
    const fc = s[b + F.facing];
    for (let j = 0; j < mv.nHurt && n < 6; j++) {
      const o = j * 6;
      if (f < mv.hurt[o] || f > mv.hurt[o + 1]) continue;
      const cx = x + fc * mv.hurt[o + 2];
      const cy = y + mv.hurt[o + 3];
      const w2 = mv.hurt[o + 4] >> 1;
      const h2 = mv.hurt[o + 5] >> 1;
      const q = n * 4;
      out[q] = cx - w2;
      out[q + 1] = cx + w2;
      out[q + 2] = cy - h2;
      out[q + 3] = cy + h2;
      n++;
    }
  }
  return n;
}

/** World rect of box `j` of move `mv` for fighter `i` into out[o..o+3]. */
export function hitRect(m: Match, i: number, mv: CMove, j: number, out: Int32Array, o: number): void {
  const s = m.s;
  const b = fb(i);
  const q = j * 7;
  const cx = s[b + F.x] + s[b + F.facing] * mv.boxes[q + 2];
  const cy = s[b + F.y] + mv.boxes[q + 3];
  const w2 = mv.boxes[q + 4] >> 1;
  const h2 = mv.boxes[q + 5] >> 1;
  out[o] = cx - w2;
  out[o + 1] = cx + w2;
  out[o + 2] = cy - h2;
  out[o + 3] = cy + h2;
}

export function rectsOverlap(a: Int32Array, ao: number, bArr: Int32Array, bo: number): boolean {
  return a[ao] < bArr[bo + 1] && bArr[bo] < a[ao + 1] && a[ao + 2] < bArr[bo + 3] && bArr[bo + 2] < a[ao + 3];
}

/**
 * Body resolution after both fighters moved (CONTRACT §4.3.1): push-box separation (no overlap),
 * stage walls at +-wall (fighter centre clamped by its push half-width), separation cap (camera
 * wall: whoever moved away this frame is pulled back; split by how far each moved away).
 * `px0` / `px1` = positions at the start of the frame.
 */
export function resolveBodies(m: Match, px0: number, px1: number): void {
  const s = m.s;
  const b0 = fb(0);
  const b1 = fb(1);
  const cf0 = m.cf[0];
  const cf1 = m.cf[1];
  const st0 = s[b0 + F.st];
  const st1 = s[b1 + F.st];
  const lim0 = m.sys.wall - cf0.pushHalf;
  const lim1 = m.sys.wall - cf1.pushHalf;
  const collide = st0 !== ST.THROWN && st1 !== ST.THROWN && st0 !== ST.CINEMATIC && st1 !== ST.CINEMATIC;
  if (collide) {
    const y0 = s[b0 + F.y];
    const y1 = s[b1 + F.y];
    const yOverlap = y0 < y1 + cf1.pushH && y1 < y0 + cf0.pushH;
    if (yOverlap) {
      const x0 = s[b0 + F.x];
      const x1 = s[b1 + F.x];
      const minD = cf0.pushHalf + cf1.pushHalf;
      const dist = Math.abs(x0 - x1);
      if (dist < minD) {
        const ov = minD - dist;
        const zeroLeft = x0 < x1 || (x0 === x1 && s[b0 + F.facing] > 0);
        const l = zeroLeft ? b0 : b1;
        const r = zeroLeft ? b1 : b0;
        const limL = zeroLeft ? lim0 : lim1;
        const limR = zeroLeft ? lim1 : lim0;
        let xl = s[l + F.x] - (ov - (ov >> 1));
        let xr = s[r + F.x] + (ov >> 1);
        if (xl < -limL) {
          xr += -limL - xl;
          xl = -limL;
        }
        if (xr > limR) {
          xl -= xr - limR;
          xr = limR;
          if (xl < -limL) xl = -limL;
        }
        s[l + F.x] = xl;
        s[r + F.x] = xr;
      }
    }
  }
  // walls
  if (s[b0 + F.x] > lim0) s[b0 + F.x] = lim0;
  else if (s[b0 + F.x] < -lim0) s[b0 + F.x] = -lim0;
  if (s[b1 + F.x] > lim1) s[b1 + F.x] = lim1;
  else if (s[b1 + F.x] < -lim1) s[b1 + F.x] = -lim1;
  // separation cap
  const x0 = s[b0 + F.x];
  const x1 = s[b1 + F.x];
  const dist = Math.abs(x0 - x1);
  const cap = m.sys.cap;
  if (dist > cap) {
    const excess = dist - cap;
    const zeroLeft = x0 < x1;
    const lb = zeroLeft ? b0 : b1;
    const rb = zeroLeft ? b1 : b0;
    const plx = zeroLeft ? px0 : px1;
    const prx = zeroLeft ? px1 : px0;
    const awayL = Math.max(0, plx - s[lb + F.x]);
    const awayR = Math.max(0, s[rb + F.x] - prx);
    let shL: number;
    if (awayL + awayR === 0) shL = excess >> 1;
    else shL = Math.trunc((excess * awayL) / (awayL + awayR));
    const shR = excess - shL;
    s[lb + F.x] += shL;
    s[rb + F.x] -= shR;
  }
}
