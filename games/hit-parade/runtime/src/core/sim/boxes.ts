// HIT PARADE — body / hit geometry in world U (CONTRACT §4.3.2-3, CHANGED(SIM3D) §35.2 / §35.4).
//
// 3D ring model (CHANGED(SIM3D)): the fight is on the (x, z) ground plane, y up. Every fighter has a yaw (F.yaw) and a
// forward f = dir(yaw) (fx3d.ts, Q14).
//   * PUSH body = a circle: centre = root + f * off, radius r, with off = (front - back) >> 1 and r = front - off, so the
//     extent along the facing is exactly `front` ahead and ~`back` behind (the measured asymmetric push box, §25.5).
//   * HURT = vertical cylinders (cx, cz, r, y0, y1): the posture cylinder from the measured front / back extents
//     (data/bodies.json, §28.5c) with the same off / r rule, hurtOverride / stance boxes as centred cylinders (r = w/2),
//     and the running move's hurtExt boxes as cylinders centred `x` ahead (r = w/2).
//   * HIT boxes = boxes in ATTACKER-LOCAL (forward, lateral, up): forward span x +- w/2, lateral +- the move's lateral
//     half-depth, height y +- h/2. Hit test = box vs circle in the attacker's local plane + height overlap (strict).
// On the spawn line (both fighters facing each other along one axis) every test reduces EXACTLY to the old 2.5D rects.
//
// hurtRects / hitRect / pushExt below are LEGACY 1D projections (x only, by F.facing) kept for the training overlay
// (ui/trainer.ts) until lane UI switches to readBoxes (match.ts).

import { F, FL, ST, W } from './layout.ts';
import { fb } from './state.ts';
import type { Match } from './state.ts';
import type { CMove } from './compile.ts';
import { Q, cosQ, divRound, isqrt, mulQ, sinQ } from './fx3d.ts';
import { ringClamp, ringRay } from './ring.ts';

export const POSTURE = { STAND: 0, CROUCH: 1, AIR: 2 } as const;

export function posture(m: Match, i: number): number {
  const s = m.s;
  const b = fb(i);
  const st = s[b + F.st];
  if ((s[b + F.flags] & FL.AIRBORNE) !== 0 || st === ST.AIR || st === ST.JUGGLE) return POSTURE.AIR;
  if ((s[b + F.flags] & FL.CROUCHING) !== 0) return POSTURE.CROUCH;
  return POSTURE.STAND;
}

// ------------------------------------------------------------------ push body
/** front / back push extents of fighter i (U): out[0] front (incl. the running move's pushExt lean), out[1] back. */
export function pushFB(m: Match, i: number, out: Int32Array): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const crouch = (s[b + F.flags] & FL.CROUCHING) !== 0 && (s[b + F.flags] & FL.AIRBORNE) === 0;
  let e = crouch ? cf.pushFC : cf.pushFS;
  const k = s[b + F.mv];
  if (k >= 0 && s[b + F.st] === ST.ATTACK) {
    const t = cf.moves[k].pushExt;
    if (t) e += t[Math.max(0, Math.min(t.length - 1, s[b + F.mvF]))];
  }
  out[0] = e;
  out[1] = crouch ? cf.pushBC : cf.pushBS;
}

const FB2 = new Int32Array(2);

/** CHANGED(SIM3D): push circle of fighter i -> out[0] cx, out[1] cz, out[2] radius (U). */
export function pushCircle(m: Match, i: number, out: Int32Array): void {
  const s = m.s;
  const b = fb(i);
  pushFB(m, i, FB2);
  const off = (FB2[0] - FB2[1]) >> 1;
  const yaw = s[b + F.yaw];
  out[0] = s[b + F.x] + mulQ(off, sinQ(yaw));
  out[1] = s[b + F.z] + mulQ(off, cosQ(yaw));
  out[2] = FB2[0] - off;
}

/**
 * LEGACY (1D, by F.facing): push extent of fighter `i` from its root toward world direction `dir` (+1 = +x, -1 = -x).
 * The 3D sim uses pushCircle; this stays for the training overlay and the old callers' semantics on the spawn line.
 */
export function pushExt(m: Match, i: number, dir: number): number {
  const s = m.s;
  const b = fb(i);
  pushFB(m, i, FB2);
  return s[b + F.facing] * dir > 0 ? FB2[0] : FB2[1];
}

// ------------------------------------------------------------------ hurt cylinders
/**
 * CHANGED(SIM3D): hurt cylinders of fighter i -> out[k * 5 .. + 4] = cx, cz, r, y0, y1 (U); returns the count (<= 6).
 */
export function hurtCyls(m: Match, i: number, out: Int32Array): number {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const x = s[b + F.x];
  const z = s[b + F.z];
  const y = s[b + F.y];
  const yaw = s[b + F.yaw];
  const fx = sinQ(yaw);
  const fz = cosQ(yaw);
  const p = posture(m, i);
  const box = p === POSTURE.AIR ? cf.hurtAir : p === POSTURE.CROUCH ? cf.hurtCrouch : cf.hurtStand;
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
    front = cf.u.stHurtW >> 1; // the stance lean = the enter move's last hurtOverride (centred)
    back = front;
    bh = cf.u.stHurtH;
    by = cf.u.stHurtY;
  }
  const off = (front - back) >> 1;
  out[0] = x + mulQ(off, fx);
  out[1] = z + mulQ(off, fz);
  out[2] = front - off;
  out[3] = y + by;
  out[4] = y + by + bh;
  let n = 1;
  if (k >= 0 && st === ST.ATTACK) {
    const mv = cf.moves[k];
    const f = s[b + F.mvF];
    for (let j = 0; j < mv.nHurt && n < 6; j++) {
      const o = j * 6;
      if (f < mv.hurt[o] || f > mv.hurt[o + 1]) continue;
      const q = n * 5;
      out[q] = x + mulQ(mv.hurt[o + 2], fx);
      out[q + 1] = z + mulQ(mv.hurt[o + 2], fz);
      out[q + 2] = mv.hurt[o + 4] >> 1;
      out[q + 3] = y + mv.hurt[o + 3] - (mv.hurt[o + 5] >> 1);
      out[q + 4] = y + mv.hurt[o + 3] + (mv.hurt[o + 5] >> 1);
      n++;
    }
  }
  return n;
}

/**
 * CHANGED(SIM3D): a box in an attacker's local frame vs a vertical cylinder (strict overlap, integer math).
 * Attacker root (ax, az), forward (fx, fz) Q14; box forward centre bx, half-width w2, lateral half-depth lat, world
 * heights [y0, y1]; cylinder (cx, cz, r, cy0, cy1).
 */
export function boxCyl(ax: number, az: number, fx: number, fz: number, bx: number, w2: number, lat: number, y0: number, y1: number,
  cx: number, cz: number, r: number, cy0: number, cy1: number): boolean {
  if (!(y0 < cy1 && cy0 < y1)) return false;
  const rx = cx - ax;
  const rz = cz - az;
  const lf = divRound(rx * fx + rz * fz, Q); // along the attacker's forward
  const ll = divRound(rz * fx - rx * fz, Q); // along its right (-fz, fx)
  const f0 = bx - w2;
  const f1 = bx + w2;
  const qf = lf < f0 ? f0 : lf > f1 ? f1 : lf;
  const ql = ll < -lat ? -lat : ll > lat ? lat : ll;
  const df = lf - qf;
  const dl = ll - ql;
  return df * df + dl * dl < r * r;
}

/**
 * Does box `j` of move `mv` of fighter `a` touch any of the `n` cylinders in cyl (5 ints each)? Returns the cylinder
 * index or -1.
 */
export function moveBoxHits(m: Match, a: number, mv: CMove, j: number, cyl: Int32Array, n: number): number {
  const s = m.s;
  const b = fb(a);
  const q = j * 7;
  const yaw = s[b + F.yaw];
  const fx = sinQ(yaw);
  const fz = cosQ(yaw);
  const cy = s[b + F.y] + mv.boxes[q + 3];
  const h2 = mv.boxes[q + 5] >> 1;
  for (let r = 0; r < n; r++) {
    const o = r * 5;
    if (boxCyl(s[b + F.x], s[b + F.z], fx, fz, mv.boxes[q + 2], mv.boxes[q + 4] >> 1, mv.lateral, cy - h2, cy + h2, cyl[o], cyl[o + 1], cyl[o + 2], cyl[o + 3], cyl[o + 4])) return r;
  }
  return -1;
}

// ------------------------------------------------------------------ LEGACY 1D rects (training overlay)
/** LEGACY: 1D hurt rects [x0, x1, y0, y1] of fighter `i` along world x by F.facing (ui/trainer.ts overlay). */
export function hurtRects(m: Match, i: number, out: Int32Array): number {
  const s = m.s;
  const b = fb(i);
  const n = hurtCyls(m, i, CY);
  const x = s[b + F.x];
  const fc = s[b + F.facing] >= 0 ? 1 : -1;
  for (let k = 0; k < n; k++) {
    // project each cylinder on the facing line: centre offset along the forward, +- r
    const dx = CY[k * 5] - x;
    const dz = CY[k * 5 + 1] - s[b + F.z];
    const yaw = s[b + F.yaw];
    const along = divRound(dx * sinQ(yaw) + dz * cosQ(yaw), Q) * fc;
    out[k * 4] = x + along - CY[k * 5 + 2];
    out[k * 4 + 1] = x + along + CY[k * 5 + 2];
    out[k * 4 + 2] = CY[k * 5 + 3];
    out[k * 4 + 3] = CY[k * 5 + 4];
  }
  return n;
}
const CY = new Int32Array(30);

/** LEGACY: world rect of box `j` of move `mv` for fighter `i` along world x by F.facing -> out[o..o+3]. */
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

// ------------------------------------------------------------------ ring contact
const PC = new Int32Array(3);
const RC = new Int32Array(2);

/**
 * CHANGED(SIM3D): keeps fighter i's push circle inside the ring (moves the root by the same correction). Returns the
 * correction length (U, 0 = it was inside).
 */
export function clampToRing(m: Match, i: number): number {
  const s = m.s;
  const b = fb(i);
  pushCircle(m, i, PC);
  if (!ringClamp(m.ring, PC[0], PC[1], PC[2], RC)) return 0;
  const dx = RC[0] - PC[0];
  const dz = RC[1] - PC[1];
  s[b + F.x] += dx;
  s[b + F.z] += dz;
  return isqrt(dx * dx + dz * dz);
}

/** Old name kept for callers (now the ring). */
export function clampToWalls(m: Match, i: number): void {
  clampToRing(m, i);
}

/**
 * CHANGED(SIM3D): free room (U) from fighter i's push circle to the ring boundary along the Q14 unit (ux, uz)
 * ("against the wall" tests: room <= range).
 */
export function wallRoom(m: Match, i: number, ux: number, uz: number): number {
  pushCircle(m, i, PC);
  return ringRay(m.ring, PC[0], PC[1], ux, uz) - PC[2];
}

/** CHANGED(SIM3D): gap between the two push circles (U; negative = overlap). */
export function pushGap(m: Match): number {
  pushCircle(m, 0, PC);
  const ax = PC[0];
  const az = PC[1];
  const ar = PC[2];
  pushCircle(m, 1, PC);
  const dx = PC[0] - ax;
  const dz = PC[1] - az;
  return isqrt(dx * dx + dz * dz) - ar - PC[2];
}

// ------------------------------------------------------------------ bodies
const C0 = new Int32Array(3);
const C1 = new Int32Array(3);

/**
 * Body resolution after both fighters moved (CONTRACT §4.3.1, CHANGED(SIM3D)): push-circle separation along the line
 * between the circles (split evenly; a side the ring blocks hands its share to the other, exactly the old corner rule on
 * the spawn line), the ring, then the separation cap on the 3D distance (whoever moved away this frame is pulled back,
 * split by how far each moved away). (px0, pz0) / (px1, pz1) = positions at the start of the frame.
 */
export function resolveBodies(m: Match, px0: number, pz0: number, px1: number, pz1: number): void {
  const s = m.s;
  const b0 = fb(0);
  const b1 = fb(1);
  const cf0 = m.cf[0];
  const cf1 = m.cf[1];
  const st0 = s[b0 + F.st];
  const st1 = s[b1 + F.st];
  if (st1 === ST.ABSENT || st0 === ST.ABSENT) {
    // CHANGED(SIM) P2: bonus rounds - fighter 1 is not on the set (goon bodies resolve in brawl.ts)
    if (st0 !== ST.ABSENT) clampToRing(m, 0);
    if (st1 !== ST.ABSENT) clampToRing(m, 1);
    return;
  }
  const collide = st0 !== ST.THROWN && st1 !== ST.THROWN && st0 !== ST.CINEMATIC && st1 !== ST.CINEMATIC;
  if (collide) {
    const y0 = s[b0 + F.y];
    const y1 = s[b1 + F.y];
    const yOverlap = y0 < y1 + cf1.pushH && y1 < y0 + cf0.pushH;
    if (yOverlap) {
      pushCircle(m, 0, C0);
      pushCircle(m, 1, C1);
      let dx = C1[0] - C0[0];
      let dz = C1[1] - C0[1];
      const minD = C0[2] + C1[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD) {
        let d = isqrt(d2);
        if (d === 0) {
          // stacked exactly: separate along fighter 0's forward (the old "facing decides" tie rule)
          const yaw = s[b0 + F.yaw];
          dx = sinQ(yaw);
          dz = cosQ(yaw);
          d = Q;
        }
        const ux = divRound(dx * Q, d);
        const uz = divRound(dz * Q, d);
        const ov = minD - Math.min(d, minD);
        // 0 moves along -u, 1 along +u; each only as far as the ring lets it (the rest goes to the other)
        const room0 = Math.max(0, ringRay(m.ring, C0[0], C0[1], -ux, -uz) - C0[2]);
        const room1 = Math.max(0, ringRay(m.ring, C1[0], C1[1], ux, uz) - C1[2]);
        let mv0 = ov - (ov >> 1);
        let mv1 = ov >> 1;
        if (mv0 > room0) {
          mv1 += mv0 - room0;
          mv0 = room0;
        }
        if (mv1 > room1) {
          mv0 += mv1 - room1;
          mv1 = room1;
          if (mv0 > room0) mv0 = room0;
        }
        s[b0 + F.x] -= mulQ(mv0, ux);
        s[b0 + F.z] -= mulQ(mv0, uz);
        s[b1 + F.x] += mulQ(mv1, ux);
        s[b1 + F.z] += mulQ(mv1, uz);
      }
    }
  }
  // the ring
  clampToRing(m, 0);
  clampToRing(m, 1);
  // separation cap (camera wall) on the 3D root distance
  const x0 = s[b0 + F.x];
  const z0 = s[b0 + F.z];
  const x1 = s[b1 + F.x];
  const z1 = s[b1 + F.z];
  const ddx = x1 - x0;
  const ddz = z1 - z0;
  const cap = m.sys.cap;
  const dd2 = ddx * ddx + ddz * ddz;
  if (dd2 > cap * cap) {
    const dist = isqrt(dd2);
    if (dist > cap) {
      const excess = dist - cap;
      const ux = divRound(ddx * Q, dist); // 0 -> 1
      const uz = divRound(ddz * Q, dist);
      // "away" = movement this frame along the outward direction of each (0 outward = -u, 1 outward = +u)
      const away0 = Math.max(0, -divRound((x0 - px0) * ux + (z0 - pz0) * uz, Q));
      const away1 = Math.max(0, divRound((x1 - px1) * ux + (z1 - pz1) * uz, Q));
      let sh0: number;
      if (away0 + away1 === 0) sh0 = excess >> 1;
      else sh0 = Math.trunc((excess * away0) / (away0 + away1));
      const sh1 = excess - sh0;
      s[b0 + F.x] += mulQ(sh0, ux);
      s[b0 + F.z] += mulQ(sh0, uz);
      s[b1 + F.x] -= mulQ(sh1, ux);
      s[b1 + F.z] -= mulQ(sh1, uz);
    }
  }
  void W;
}
