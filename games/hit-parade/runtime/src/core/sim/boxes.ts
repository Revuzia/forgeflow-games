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
  // CHANGED(SIM) P2 (CONTRACT §28.5c): the posture box is measured and asymmetric (front / back along the facing)
  let front = p === POSTURE.AIR ? cf.hurtFA : p === POSTURE.CROUCH ? cf.hurtFC : cf.hurtFS;
  let back = p === POSTURE.AIR ? cf.hurtBA : p === POSTURE.CROUCH ? cf.hurtBC : cf.hurtBS;
  let bh = box[1];
  let by = 0;
  const k = s[b + F.mv];
  const st = s[b + F.st];
  if (k >= 0 && st === ST.ATTACK) {
    const mv = cf.moves[k];
    const f = s[b + F.mvF];
    for (let j = 0; j < mv.nHurtOv; j++) {
      const o = j * 5;
      if (f < mv.hurtOv[o] || f > mv.hurtOv[o + 1]) continue;
      front = mv.hurtOv[o + 2] >> 1; // hurtOverride boxes stay centred (§20.2)
      back = front;
      bh = mv.hurtOv[o + 3];
      by = mv.hurtOv[o + 4];
      break;
    }
  } else if (st === ST.STANCE && cf.u.stHurtW > 0) {
    // CHANGED(SIM) P2: the stance lean = the enter move's last hurtOverride
    front = cf.u.stHurtW >> 1;
    back = front;
    bh = cf.u.stHurtH;
    by = cf.u.stHurtY;
  }
  if (s[b + F.facing] >= 0) {
    out[0] = x - back;
    out[1] = x + front;
  } else {
    out[0] = x - front;
    out[1] = x + back;
  }
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

/**
 * CHANGED(fixer) D2: push-box extent of fighter `i` from its root toward world direction `dir` (+1 = +x, -1 = -x), U.
 * The box is asymmetric: `front` along the facing, `back` behind (fighters/<id>.json `push`, measured on the baked
 * bodies; a hunched big body leans far ahead of its hips), crouching extents while crouched, plus the running move's
 * measured forward lean (`pushExt`) on the front. Without `push` data front = back = pushbox width / 2 (the old box).
 */
export function pushExt(m: Match, i: number, dir: number): number {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const crouch = (s[b + F.flags] & FL.CROUCHING) !== 0 && (s[b + F.flags] & FL.AIRBORNE) === 0;
  const front = s[b + F.facing] * dir > 0;
  if (!front) return crouch ? cf.pushBC : cf.pushBS;
  let e = crouch ? cf.pushFC : cf.pushFS;
  const k = s[b + F.mv];
  if (k >= 0 && s[b + F.st] === ST.ATTACK) {
    const t = cf.moves[k].pushExt;
    if (t) e += t[Math.max(0, Math.min(t.length - 1, s[b + F.mvF]))];
  }
  return e;
}

/** CHANGED(fixer) D2: the x limit of fighter `i` at the wall on side `dir` (+1 right wall, -1 left wall), U (signed) */
export function wallLimitX(m: Match, i: number, dir: number): number {
  return dir > 0 ? m.sys.wall - pushExt(m, i, 1) : -(m.sys.wall - pushExt(m, i, -1));
}

/** CHANGED(fixer) D2: clamp fighter `i` between its two wall limits */
export function clampToWalls(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const hi = wallLimitX(m, i, 1);
  const lo = wallLimitX(m, i, -1);
  if (s[b + F.x] > hi) s[b + F.x] = hi;
  else if (s[b + F.x] < lo) s[b + F.x] = lo;
}

/** CHANGED(fixer) D2: gap between the two push boxes' facing edges (U; negative = overlap), x only */
export function pushGap(m: Match): number {
  const s = m.s;
  const x0 = s[fb(0) + F.x];
  const x1 = s[fb(1) + F.x];
  const l = x0 <= x1 ? 0 : 1;
  const r = 1 - l;
  return Math.abs(x1 - x0) - pushExt(m, l, 1) - pushExt(m, r, -1);
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
  if (st1 === ST.ABSENT || st0 === ST.ABSENT) {
    // CHANGED(SIM) P2: bonus rounds - fighter 1 is not on the set (goon bodies resolve in brawl.ts)
    if (st0 !== ST.ABSENT) clampToWalls(m, 0);
    if (st1 !== ST.ABSENT) clampToWalls(m, 1);
    return;
  }
  const collide = st0 !== ST.THROWN && st1 !== ST.THROWN && st0 !== ST.CINEMATIC && st1 !== ST.CINEMATIC;
  if (collide) {
    const y0 = s[b0 + F.y];
    const y1 = s[b1 + F.y];
    const yOverlap = y0 < y1 + cf1.pushH && y1 < y0 + cf0.pushH;
    if (yOverlap) {
      const x0 = s[b0 + F.x];
      const x1 = s[b1 + F.x];
      const zeroLeft = x0 < x1 || (x0 === x1 && s[b0 + F.facing] > 0);
      const li = zeroLeft ? 0 : 1;
      const ri = 1 - li;
      // CHANGED(fixer) D2: asymmetric boxes - the left fighter's right edge vs the right fighter's left edge
      const minD = pushExt(m, li, 1) + pushExt(m, ri, -1);
      const dist = Math.abs(x0 - x1);
      if (dist < minD) {
        const ov = minD - dist;
        const l = fb(li);
        const r = fb(ri);
        const limL = wallLimitX(m, li, -1);
        const limR = wallLimitX(m, ri, 1);
        let xl = s[l + F.x] - (ov - (ov >> 1));
        let xr = s[r + F.x] + (ov >> 1);
        if (xl < limL) {
          xr += limL - xl;
          xl = limL;
        }
        if (xr > limR) {
          xl -= xr - limR;
          xr = limR;
          if (xl < limL) xl = limL;
        }
        s[l + F.x] = xl;
        s[r + F.x] = xr;
      }
    }
  }
  // walls
  clampToWalls(m, 0);
  clampToWalls(m, 1);
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
