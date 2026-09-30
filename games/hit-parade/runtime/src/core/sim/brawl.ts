// HIT PARADE — bonus rounds (CHANGED(SIM) P2, CONTRACT §4.3.14 / §28.4): BRAWL BREAK (the player fighter vs waves of
// studio goons) and HECKLER TOSS (objects thrown from the crowd; parry = points). Offline only; the state is the versus
// state plus the BR header and the G goon blocks (layout.ts STATE_INTS_BRAWL). Fighter 1 is ABSENT (never on the set).
//
// Goons: one 3-move kit (system.json brawl.moves = ordinary Move objects, startup >= telegraphMinF: shove / haymaker /
// kick; CHANGED(ASSETS) P2: each goon kind swaps in its own measured boxes / root travel / start ranges / pick weights
// from data/goons.json, same frame data - CONTRACT §32), shared hit reactions, simple juggle physics, attack tokens (<= brawl.tokens holders, grants >= tokenSpacingF apart, released on
// the attack's first active frame or when hit), approach / attack rings, a wave director spawning from both sides.
// Scoring: points x the RATINGS multiplier (7 bands), idle decay, -2 grades when hit, combo cash-out, crowd hits.
// Everything is integer math over the state array + compiled tables; randomness = mulberry32 on BR.rng (rollback-safe).
//
// CHANGED(SIM3D) (CONTRACT §35.8): the bonus rounds on the 3D ring. Goons spawn around the player from every direction
// (the emptiest bearing first, clamped inside the ring), walk in along the line to the player, hold the approach ring
// spread out around him, and attack with goon-local boxes (their yaw); bodies are circles. The player's attacks auto-
// target a goon (soft lock, BR.target): the nearest one toward the stick direction (LEFT / RIGHT = screen sides by the
// camera basis, STEP_IN / STEP_OUT = away from / toward the camera) when an attack starts, else the current target, else
// the nearest; the player faces that goon and camN follows the pair (player, target). HECKLER TOSS objects arc in from
// the crowd on all sides (random bearing around the player) at his position.

import {
  ACT, BR, BRAWL_BASE, BUF, F, FL, G, GOON_CAP, GOON_INTS, GS, GS_NAMES, MVF, P, PH, PROJ_CAP, ST, W, goonBase, projBase,
} from './layout.ts';
import { EV, SC, SCORE_WHY, EVX } from './events.ts';
import { K } from './compile.ts';
import type { CBrawl, CMove } from './compile.ts';
import { recordInput, parseAction } from './inputs.ts';
import { fighterUpdate, freezeBufferRule, PROX_THREAT, setOpp, startMove } from './fighter.ts';
import { boxCyl, clampToRing, hurtCyls, moveBoxHits, pushCircle, resolveBodies } from './boxes.ts';
import { projectilesTick, ballPost, killProjectile, freeProjectile, PK } from './projectiles.ts';
import { canBlock, projHitsCyl } from './hits.ts';
import { metersTick } from './meters.ts';
import { animTick } from './anim.ts';
import { addShowtime, clearMove, emit, fb, gainNerve, isAirborne, setSt, setVelAlong, updateCamN } from './state.ts';
import { Q, YAW_HALF, alongYaw, cosQ, dirToYaw, divRound, isqrt, mulQ, sinQ, yawDelta, yawToRad } from './fx3d.ts';
import { ringClamp, ringGap } from './ring.ts';
import { inFrontArc } from './throws.ts';
import type { Match } from './state.ts';
import { rngInt } from '../rng.ts';
import { checkPhases, uniquesPost } from './uniques.ts';
import type { BrawlSnap, GoonSnap } from '../types.ts';
import { M } from './units.ts';

export const MODE_BRAWL = 4;
export const MODE_HECKLER = 5;
/** Goon indices in event fighter fields (CONTRACT §28.4): 8 + slot; 2 = a crowd object. */
export const GOON_EV = 8;
export const CROWD_EV = 2;

const RNG = BRAWL_BASE + BR.rng;
const H = (k: number): number => BRAWL_BASE + k;

export function isBonus(m: Match): boolean {
  const md = m.s[W.mode];
  return md === MODE_BRAWL || md === MODE_HECKLER;
}

function cmOf(u: number): number {
  return Math.trunc(u / 1000);
}

function rr(m: Match, lo: number, hi: number): number {
  return hi <= lo ? lo : lo + rngInt(m.s, RNG, hi - lo + 1);
}

// ------------------------------------------------------------------ setup
/** createMatch (after initRound): the bonus header, fighter 1 off the set, timer from the mode's seconds. */
export function brawlInit(m: Match): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  for (let k = BRAWL_BASE; k < s.length; k++) s[k] = 0;
  s[RNG] = (s[W.seed] ^ 0x5bd1e995) | 0;
  s[H(BR.ratings)] = cb.score.rStart;
  s[H(BR.waveLeft)] = cb.waves[0].length;
  s[H(BR.spawnCd)] = 30;
  s[H(BR.lastGrant)] = 1000;
  s[H(BR.heckleCd)] = cb.hk.firstF;
  s[H(BR.target)] = -1;
  absentFighter(m);
}

/** Fighter 1 is not on the set (state ABSENT, parked far off the fight line; hits / throws / bodies ignore it). */
export function absentFighter(m: Match): void {
  const s = m.s;
  const b = fb(1);
  clearMove(m, 1);
  setSt(m, 1, ST.ABSENT);
  s[b + F.x] = s[W.ringCX];
  s[b + F.z] = s[W.ringCZ];
  s[b + F.y] = 0;
  s[b + F.flags] = 0;
  s[b + F.hp] = m.cf[1].hpMax;
}

// ------------------------------------------------------------------ scoring
function grade(m: Match): number {
  return Math.max(0, Math.min(6, Math.trunc(m.s[H(BR.ratings)] / 10000)));
}
function mult(m: Match): number {
  return (m.bonus as CBrawl).score.mult[grade(m)] ?? 100;
}
function award(m: Match, points: number, why: number): void {
  const s = m.s;
  const pts = points >= 0 ? Math.trunc((points * mult(m)) / 100) : points;
  const total = Math.max(0, s[H(BR.score)] + pts);
  const delta = total - s[H(BR.score)];
  s[H(BR.score)] = total;
  emit(m, EV.SCORE, 0, delta, total, why);
}
function rate(m: Match, gainX100: number): void {
  const s = m.s;
  s[H(BR.ratings)] = Math.min(69999, s[H(BR.ratings)] + gainX100);
  s[H(BR.idle)] = 0;
}
/** Taking a hit drops 2 grades to that band's floor (DESIGN_RESEARCH §6b). */
function ratingsHit(m: Match): void {
  const s = m.s;
  const g = Math.max(0, grade(m) - 2);
  s[H(BR.ratings)] = g * 10000;
  s[H(BR.idle)] = 0;
  s[H(BR.combo)] = 0;
  s[H(BR.comboF)] = 0;
}
/** Combo cash-out bonus = round(5 x hits^1.5) (x the multiplier in award). */
export function comboBonus(hits: number): number {
  // hits^1.5 = hits * sqrt(hits); with 2 decimals from isqrt(hits * 10^4)
  const r = isqrt(hits * 10000); // sqrt(hits) x 100
  return Math.trunc((5 * hits * r + 50) / 100);
}
function scoringTick(m: Match): void {
  const s = m.s;
  const cs = (m.bonus as CBrawl).score;
  s[H(BR.idle)]++;
  if (s[H(BR.idle)] > cs.idleF && s[H(BR.ratings)] > 0) {
    // decay per frame (x1000 precision): use the frame counter to spread the fractional part deterministically
    const d = cs.decay[grade(m)] ?? 0;
    const whole = Math.trunc(d / 1000);
    const frac = d - whole * 1000;
    const extra = ((s[W.frame] * frac) % 1000) + frac >= 1000 ? 1 : 0;
    s[H(BR.ratings)] = Math.max(0, s[H(BR.ratings)] - whole - extra);
  }
  if (s[H(BR.combo)] > 0) {
    s[H(BR.comboF)]++;
    if (s[H(BR.comboF)] >= cs.comboCashF) cashCombo(m);
  }
}
function cashCombo(m: Match): void {
  const s = m.s;
  const n = s[H(BR.combo)];
  s[H(BR.combo)] = 0;
  s[H(BR.comboF)] = 0;
  if (n >= 2) award(m, comboBonus(n), SCORE_WHY.COMBO);
}

// ------------------------------------------------------------------ goons: helpers
function gb(k: number): number {
  return goonBase(k);
}
function alive(s: Int32Array, k: number): boolean {
  const b = gb(k);
  return s[b + G.act] !== 0 && s[b + G.st] !== GS.DOWN;
}
function goonCount(m: Match): number {
  let n = 0;
  for (let k = 0; k < GOON_CAP; k++) if (alive(m.s, k)) n++;
  return n;
}
function releaseToken(m: Match, k: number): void {
  const s = m.s;
  const b = gb(k);
  if (s[b + G.token] !== 0) {
    s[b + G.token] = 0;
    s[H(BR.tokens)] = Math.max(0, s[H(BR.tokens)] - 1);
  }
}
function setGs(m: Match, k: number, st: number): void {
  const s = m.s;
  const b = gb(k);
  s[b + G.st] = st;
  s[b + G.stF] = 0;
}
/** CHANGED(SIM3D): goon k's hurt cylinder -> out[o..o+4] = cx, cz, r, y0, y1. */
function goonHurt(m: Match, k: number, out: Int32Array, o = 0): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const b = gb(k);
  out[o] = s[b + G.x];
  out[o + 1] = s[b + G.z];
  out[o + 2] = cb.hurtW >> 1;
  out[o + 3] = s[b + G.y];
  out[o + 4] = s[b + G.y] + cb.hurtH;
}

/** CHANGED(SIM3D): yaw from goon k toward the player (its current yaw when they coincide). */
function yawToPlayer(m: Match, k: number): number {
  const s = m.s;
  const b = gb(k);
  const dx = s[fb(0) + F.x] - s[b + G.x];
  const dz = s[fb(0) + F.z] - s[b + G.z];
  return dx === 0 && dz === 0 ? s[b + G.yaw] : dirToYaw(dx, dz);
}

const GM2 = new Int32Array(2);

/** CHANGED(SIM3D): goon k walks `amt` U along yaw (negative = backward). */
function goonMove(s: Int32Array, b: number, yaw: number, amt: number): void {
  if (amt === 0) return;
  alongYaw(amt, yaw, GM2);
  s[b + G.x] += GM2[0];
  s[b + G.z] += GM2[1];
}

/** CHANGED(SIM3D): the goon's yaw + its screen-side facing sign (informational for the snapshot). */
function goonFace(s: Int32Array, b: number, yaw: number): void {
  s[b + G.yaw] = yaw & 65535;
  const d = sinQ(yaw) * s[W.camNZ] - cosQ(yaw) * s[W.camNX];
  if (d !== 0) s[b + G.facing] = d > 0 ? 1 : -1;
}
function goonVulnerable(m: Match, k: number): boolean {
  const s = m.s;
  const b = gb(k);
  if (s[b + G.act] === 0) return false;
  const st = s[b + G.st];
  if (st === GS.DOWN || st === GS.KD || st === GS.WAKE) return false;
  if (st === GS.JUGGLE && s[b + G.jc] >= (m.bonus as CBrawl).maxJuggle) return false;
  return true;
}

function spawnGoon(m: Match, kind: number): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  let slot = -1;
  for (let k = 0; k < GOON_CAP; k++) {
    if (s[gb(k) + G.act] === 0) {
      slot = k;
      break;
    }
  }
  if (slot < 0) return;
  const px = s[fb(0) + F.x];
  const pz = s[fb(0) + F.z];
  // CHANGED(SIM3D) (CONTRACT §35.8): from every direction - 8 bearings around the player, the one farthest from the
  // living goons (a random start sector breaks ties), the spawn point clamped inside the ring (they enter at its edge)
  const start = rngInt(s, RNG, 8);
  let bestYaw = 0;
  let bestScore = -1;
  for (let q = 0; q < 8; q++) {
    const yaw = (((start + q) & 7) * 8192 + rngInt(s, RNG, 2048) - 1024) & 65535;
    let near = 1 << 30;
    for (let k = 0; k < GOON_CAP; k++) {
      if (!alive(s, k)) continue;
      const gy = dirToYaw(s[gb(k) + G.x] - px, s[gb(k) + G.z] - pz);
      const d = Math.abs(yawDelta(yaw, gy));
      if (d < near) near = d;
    }
    // room: prefer bearings the ring leaves space on
    const cx = px + mulQ(cb.spawnDist, sinQ(yaw));
    const cz = pz + mulQ(cb.spawnDist, cosQ(yaw));
    const room = ringGap(m.ring, cx, cz, cb.pushHalf) >= 0 ? 16384 : 0;
    const score = Math.min(near, 32768) + room;
    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
    }
  }
  const SP = SPN;
  ringClamp(m.ring, px + mulQ(cb.spawnDist, sinQ(bestYaw)), pz + mulQ(cb.spawnDist, cosQ(bestYaw)), cb.pushHalf + 20000, SP);
  const x = SP[0];
  const z = SP[1];
  const side = (x - px) * s[W.camNZ] - (z - pz) * s[W.camNX] >= 0 ? 1 : -1; // screen side of the player it comes from
  const b = gb(slot);
  for (let j = 0; j < GOON_INTS; j++) s[b + j] = 0;
  s[b + G.act] = 1;
  s[b + G.kind] = kind;
  s[b + G.x] = x;
  s[b + G.z] = z;
  goonFace(s, b, dirToYaw(px - x, pz - z));
  s[b + G.orbit] = bestYaw;
  s[b + G.hp] = cb.kindHp[kind];
  s[b + G.mv] = -1;
  s[b + G.animId] = 1;
  s[b + G.pAnimId] = 1;
  s[b + G.blendT] = 6;
  s[b + G.hitInst] = -1;
  s[b + G.think] = rr(m, cb.thinkMin, cb.thinkMax);
  s[b + G.seq] = s[H(BR.spawned)];
  setGs(m, slot, GS.ENTER);
  s[H(BR.spawned)]++;
  emit(m, EV.GOON_SPAWN, GOON_EV + slot, kind, side, cmOf(x));
}

const SPN = new Int32Array(2);

function waveDirector(m: Match): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  if (s[H(BR.spawnCd)] > 0) s[H(BR.spawnCd)]--;
  const n = goonCount(m);
  if (s[H(BR.waveLeft)] > 0) {
    if (n < cb.maxActive && s[H(BR.spawnCd)] <= 0) {
      const wave = cb.waves[Math.min(s[H(BR.wave)], cb.waves.length - 1)];
      const kind = wave[wave.length - s[H(BR.waveLeft)]] ?? 0;
      spawnGoon(m, kind);
      s[H(BR.waveLeft)]--;
      s[H(BR.spawnCd)] = cb.spawnGap;
    }
    return;
  }
  if (n > 0) return;
  // wave cleared: the next one after the gap (the last wave repeats)
  s[H(BR.waveTimer)]++;
  if (s[H(BR.waveTimer)] >= cb.waveGap) {
    s[H(BR.waveTimer)] = 0;
    s[H(BR.wave)]++;
    const wave = cb.waves[Math.min(s[H(BR.wave)], cb.waves.length - 1)];
    s[H(BR.waveLeft)] = wave.length;
    s[H(BR.spawnCd)] = 0;
  }
}

// ------------------------------------------------------------------ goons: behaviour
const PH5 = new Int32Array(30);

/** Distance from goon k's centre to the player's hurt cylinder edge (U, >= 0). CHANGED(SIM3D): planar. */
function gapToPlayer(m: Match, k: number): number {
  const s = m.s;
  hurtCyls(m, 0, PH5);
  const dx = s[gb(k) + G.x] - PH5[0];
  const dz = s[gb(k) + G.z] - PH5[1];
  return Math.max(0, isqrt(dx * dx + dz * dz) - PH5[2]);
}

/** CHANGED(ASSETS) P2 (CONTRACT §32): goon k's own kit (data/goons.json via core/data.ts applyGoons), else the shared one. */
function kitOf(m: Match, k: number): CMove[] {
  const cb = m.bonus as CBrawl;
  return cb.kindMoves[m.s[gb(k) + G.kind]] ?? cb.moves;
}

/** CHANGED(ASSETS) P2: a weighted roll over the goon kind's pick weights (goons.json; equal without one). The goon then
 *  walks in to that move's start range (APPROACH). */
function chooseMove(m: Match, k: number): number {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const w = cb.kindWeights[s[gb(k) + G.kind]] ?? cb.kindWeights[0];
  let sum = 0;
  for (let i = 0; i < w.length; i++) sum += w[i];
  if (sum <= 0) return 0;
  let r = rngInt(s, RNG, sum);
  for (let i = 0; i < w.length; i++) {
    if (r < w[i]) return i;
    r -= w[i];
  }
  return 0;
}

/**
 * CHANGED(SIM3D): a waiting goon drifts sideways (around the player) away from the nearest other goon's bearing when
 * they crowd the same side (< 50 deg apart), so the approach ring fills up around him.
 */
function spreadStep(m: Match, k: number, walk: number): number {
  const s = m.s;
  const b = gb(k);
  const px = s[fb(0) + F.x];
  const pz = s[fb(0) + F.z];
  const my = dirToYaw(s[b + G.x] - px, s[b + G.z] - pz);
  let best = 1 << 30;
  let sign = 0;
  for (let c = 0; c < GOON_CAP; c++) {
    if (c === k || !alive(s, c)) continue;
    const oy = dirToYaw(s[gb(c) + G.x] - px, s[gb(c) + G.z] - pz);
    const d = yawDelta(oy, my);
    const ad = Math.abs(d);
    if (ad < best) {
      best = ad;
      sign = d >= 0 ? 1 : -1;
    }
  }
  if (best >= 9102 || sign === 0) return 0; // >= 50 deg: room enough
  // sideways = perpendicular to the line to the player, toward increasing bearing separation
  const side = (yawToPlayer(m, k) + (sign > 0 ? -16384 : 16384)) & 65535;
  goonMove(s, b, side, walk >> 1);
  return 1;
}

function goonThink(m: Match, k: number): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const b = gb(k);
  const st = s[b + G.st];
  const walk = cb.kindWalk[s[b + G.kind]];
  const gap = gapToPlayer(m, k);
  const toP = yawToPlayer(m, k);
  s[b + G.stF]++;
  if (st === GS.ENTER || st === GS.WAIT || st === GS.APPROACH) goonFace(s, b, toP);
  switch (st) {
    case GS.ENTER: {
      if (gap <= cb.ringApproach[1]) {
        setGs(m, k, GS.WAIT);
        break;
      }
      goonMove(s, b, toP, walk);
      s[b + G.target] = 1;
      break;
    }
    case GS.WAIT: {
      s[b + G.target] = 0;
      if (s[b + G.think] > 0) s[b + G.think]--;
      if (s[b + G.think] <= 0 && s[b + G.token] === 0 && s[H(BR.tokens)] < cb.tokens && s[H(BR.lastGrant)] >= cb.tokenSpacing) {
        s[b + G.token] = 1;
        s[H(BR.tokens)]++;
        s[H(BR.lastGrant)] = 0;
        s[b + G.mv] = chooseMove(m, k);
        s[b + G.appF] = 0;
        setGs(m, k, GS.APPROACH);
        break;
      }
      // hold the approach ring (spread around the player)
      if (gap < cb.ringApproach[0]) {
        goonMove(s, b, toP, -((walk * 3) >> 2));
        s[b + G.target] = -1;
      } else if (gap > cb.ringApproach[1]) {
        goonMove(s, b, toP, walk);
        s[b + G.target] = 1;
      } else if (spreadStep(m, k, walk) !== 0) s[b + G.target] = 1;
      break;
    }
    case GS.APPROACH: {
      const kit = kitOf(m, k);
      const mv = s[b + G.mv] >= 0 ? kit[s[b + G.mv]] : kit[0];
      const range = (cb.kindRange[s[b + G.kind]] ?? cb.moveRange)[mv.idx] ?? cb.ringAttack[1];
      s[b + G.appF]++;
      if (gap <= range) {
        startGoonMove(m, k, mv.idx);
        break;
      }
      if (s[b + G.appF] > 150) {
        releaseToken(m, k);
        s[b + G.think] = rr(m, cb.thinkMin, cb.thinkMax);
        setGs(m, k, GS.WAIT);
        break;
      }
      goonMove(s, b, toP, walk);
      s[b + G.target] = 1;
      break;
    }
    case GS.ATTACK: {
      const mv = kitOf(m, k)[s[b + G.mv]];
      const f = ++s[b + G.mvF];
      if (f > mv.total) {
        s[b + G.mv] = -1;
        s[b + G.mvF] = 0;
        s[b + G.think] = rr(m, cb.thinkMin, cb.thinkMax);
        setGs(m, k, GS.WAIT);
        break;
      }
      // CHANGED(SIM3D): goon attacks track the player through their telegraph (the move's track.until), then commit
      if (f <= mv.trackUntil) goonFace(s, b, toP);
      const d = mv.curve[f] - mv.curve[f - 1];
      if (d !== 0) goonMove(s, b, s[b + G.yaw], d);
      if (f === mv.startup) releaseToken(m, k); // released when the attack's active frames start (Amalur)
      break;
    }
    case GS.HIT:
    case GS.BLOCK: {
      s[b + G.x] += s[b + G.vx];
      s[b + G.z] += s[b + G.vz];
      s[b + G.vx] = Math.trunc((s[b + G.vx] * 3) / 4);
      s[b + G.vz] = Math.trunc((s[b + G.vz] * 3) / 4);
      if (--s[b + G.stun] <= 0) {
        s[b + G.vx] = 0;
        s[b + G.vz] = 0;
        s[b + G.think] = rr(m, cb.thinkMin, cb.thinkMax);
        setGs(m, k, GS.WAIT);
      }
      break;
    }
    case GS.JUGGLE:
    case GS.DOWN: {
      if (s[b + G.y] > 0 || s[b + G.vy] > 0) {
        s[b + G.x] += s[b + G.vx];
        s[b + G.z] += s[b + G.vz];
        s[b + G.y] += s[b + G.vy];
        s[b + G.vy] -= cb.g;
        if (s[b + G.y] <= 0) {
          s[b + G.y] = 0;
          s[b + G.vy] = 0;
          s[b + G.vx] = 0;
          s[b + G.vz] = 0;
          if (st === GS.JUGGLE) {
            s[b + G.jc] = 0;
            s[b + G.stun] = cb.kdF;
            setGs(m, k, GS.KD);
            emit(m, EV.KNOCKDOWN, GOON_EV + k, 1, 0, 0);
          }
        }
      }
      if (st === GS.DOWN && s[b + G.stF] >= cb.downF) {
        s[b + G.act] = 0; // fades out; the slot frees
      }
      break;
    }
    case GS.KD: {
      if (--s[b + G.stun] <= 0) {
        s[b + G.stun] = cb.wakeF;
        setGs(m, k, GS.WAKE);
      }
      break;
    }
    case GS.WAKE: {
      if (--s[b + G.stun] <= 0) {
        s[b + G.think] = rr(m, cb.thinkMin, cb.thinkMax);
        setGs(m, k, GS.WAIT);
      }
      break;
    }
    default:
      break;
  }
}

function startGoonMove(m: Match, k: number, idx: number): void {
  const s = m.s;
  const b = gb(k);
  s[b + G.mv] = idx;
  s[b + G.mvF] = 1;
  s[b + G.contact] = 0;
  s[b + G.appF] = 0;
  setGs(m, k, GS.ATTACK);
}

const PB3 = new Int32Array(3);
const GC2 = new Int32Array(2);

/**
 * Goons never overlap the player (they step back along the line to him) or each other (split evenly); the ring clamps.
 * CHANGED(SIM3D): circle bodies in the plane.
 */
function goonBodies(m: Match): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  pushCircle(m, 0, PB3);
  const air0 = (s[fb(0) + F.flags] & FL.AIRBORNE) !== 0;
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (!alive(s, k) || s[b + G.y] > 0 || air0) continue;
    const dx = s[b + G.x] - PB3[0];
    const dz = s[b + G.z] - PB3[1];
    const minD = PB3[2] + cb.pushHalf;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD) continue;
    const d = isqrt(d2);
    const yaw = d === 0 ? (s[b + G.yaw] + YAW_HALF) & 65535 : dirToYaw(dx, dz);
    s[b + G.x] = PB3[0] + mulQ(minD, sinQ(yaw));
    s[b + G.z] = PB3[1] + mulQ(minD, cosQ(yaw));
  }
  for (let a = 0; a < GOON_CAP; a++) {
    if (!alive(s, a) || s[gb(a) + G.y] > 0) continue;
    for (let c = a + 1; c < GOON_CAP; c++) {
      if (!alive(s, c) || s[gb(c) + G.y] > 0) continue;
      const dx = s[gb(c) + G.x] - s[gb(a) + G.x];
      const dz = s[gb(c) + G.z] - s[gb(a) + G.z];
      const minD = cb.pushHalf * 2;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = isqrt(d2);
      const ov = minD - d;
      const yaw = d === 0 ? (a < c ? 16384 : 49152) : dirToYaw(dx, dz); // a -> c
      goonMove(s, gb(a), yaw, -(ov - (ov >> 1)));
      goonMove(s, gb(c), yaw, ov >> 1);
    }
  }
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (s[b + G.act] === 0) continue;
    ringClamp(m.ring, s[b + G.x], s[b + G.z], cb.pushHalf, GC2);
    s[b + G.x] = GC2[0];
    s[b + G.z] = GC2[1];
  }
}

// ------------------------------------------------------------------ player -> goons
const GR = new Int32Array(5);
const PRR = new Int32Array(30);
const hitGoon = new Int32Array(GOON_CAP);
const hitHid = new Int32Array(GOON_CAP);
const hitCy = new Int32Array(GOON_CAP);

function pointsFor(m: Match, mv: CMove): [number, number] {
  const cs = (m.bonus as CBrawl).score;
  if (mv.isSuper) return [cs.super, cs.gSuper];
  if (mv.kind === K.throw || mv.kind === K.cmdgrab || mv.grab) return [cs.throw, cs.gThrow];
  if (mv.isSpecialCat) return [cs.special, cs.gSpecial];
  const str = Math.max(0, Math.min(2, mv.str));
  return [cs.hit[str] ?? 10, cs.gHit[str] ?? 400];
}

/**
 * Applies a player hit (move `mv`, hit id `hid`) to goon k. Returns true when it KO'd the goon. CHANGED(SIM3D): `dir` =
 * the hit direction yaw (knockback / launch along it; the goon turns to face where it came from).
 */
function damageGoon(m: Match, k: number, mv: CMove, hid: number, cy: number, dir: number, proj: boolean, throwHit: boolean, flags: number): boolean {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const b = gb(k);
  let dmg = throwHit ? mv.damage : mv.cin ? mv.hitsTotal : proj ? mv.damage : mv.hidDmg[hid] ?? mv.damage;
  if ((flags & MVF.SIMPLE) !== 0) dmg = Math.trunc((dmg * m.sys.raw.simple.damagePct) / 100);
  if (dmg < 1) dmg = 1;
  s[b + G.hp] -= dmg;
  releaseToken(m, k);
  s[b + G.mv] = -1;
  s[b + G.mvF] = 0;
  const wasAir = s[b + G.y] > 0 || s[b + G.st] === GS.JUGGLE;
  const sc = proj ? SC.PROJECTILE : throwHit ? SC.THROW : mv.sc;
  if (throwHit) emit(m, EV.THROW, 0, GOON_EV + k, 0, mv.kind === K.cmdgrab ? 1 : 0);
  else emit(m, EV.HIT, 0, GOON_EV + k, sc, cmOf(cy));
  if (proj) emit(m, EV.PROJ_HIT, 0, GOON_EV + k, sc, cmOf(cy));
  const [pts, rg] = pointsFor(m, mv);
  award(m, pts, SCORE_WHY.HIT);
  rate(m, rg);
  s[H(BR.combo)]++;
  s[H(BR.comboF)] = 0;
  const hs = throwHit ? 0 : mv.hitstop;
  if (s[b + G.hitstop] < hs) s[b + G.hitstop] = hs;
  if (s[b + G.hp] <= 0) {
    s[b + G.hp] = 0;
    s[b + G.vx] = mulQ(cb.koVx, sinQ(dir));
    s[b + G.vz] = mulQ(cb.koVx, cosQ(dir));
    s[b + G.vy] = cb.koVy;
    s[b + G.y] = Math.max(s[b + G.y], 1);
    setGs(m, k, GS.DOWN);
    s[H(BR.downed)]++;
    const koPts = Math.trunc((cb.score.ko * mult(m)) / 100);
    emit(m, EV.GOON_DOWN, GOON_EV + k, s[b + G.kind], koPts, cmOf(s[b + G.x]));
    award(m, cb.score.ko, SCORE_WHY.KO);
    rate(m, cb.score.gKo);
    return true;
  }
  if (throwHit || mv.kd > 0 || mv.launchVy > 0 || wasAir || mv.isSuper) {
    const vh = mv.launchVx > 0 ? mv.launchVx : cb.launchVx;
    s[b + G.vx] = mulQ(vh, sinQ(dir));
    s[b + G.vz] = mulQ(vh, cosQ(dir));
    s[b + G.vy] = mv.launchVy > 0 ? mv.launchVy : wasAir ? cb.launchVy >> 1 : cb.launchVy;
    s[b + G.y] = Math.max(s[b + G.y], 1);
    if (wasAir) s[b + G.jc]++;
    setGs(m, k, GS.JUGGLE);
    return false;
  }
  s[b + G.stun] = Math.max(cb.hitstunF, mv.hitstun);
  s[b + G.vx] = mulQ(Math.trunc(mv.pushHit / 3), sinQ(dir));
  s[b + G.vz] = mulQ(Math.trunc(mv.pushHit / 3), cosQ(dir));
  goonFace(s, b, (dir + YAW_HALF) & 65535);
  setGs(m, k, GS.HIT);
  return false;
}

function playerVsGoons(m: Match): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const b0 = fb(0);
  if (s[b0 + F.st] === ST.ATTACK && s[b0 + F.mv] >= 0 && s[b0 + F.hitstop] === 0) {
    const mv = m.cf[0].moves[s[b0 + F.mv]];
    const f = s[b0 + F.mvF];
    const inst = s[b0 + F.mvInst];
    // strikes: every goon once per hit id (a crowd hit when several)
    if (mv.isStrike) {
      let n = 0;
      for (let k = 0; k < GOON_CAP; k++) {
        if (!goonVulnerable(m, k)) continue;
        const gb0 = gb(k);
        goonHurt(m, k, GR);
        for (let j = 0; j < mv.nBox; j++) {
          const o = j * 7;
          if (f < mv.boxes[o] || f > mv.boxes[o + 1]) continue;
          const hid = mv.boxes[o + 6];
          if (s[gb0 + G.hitInst] === inst && (s[gb0 + G.hitMask] & (1 << hid)) !== 0) continue;
          if (moveBoxHits(m, 0, mv, j, GR, 1) < 0) continue;
          hitGoon[n] = k;
          hitHid[n] = hid;
          hitCy[n] = mv.boxes[o + 3];
          n++;
          break;
        }
      }
      for (let q = 0; q < n; q++) {
        const k = hitGoon[q];
        const gb0 = gb(k);
        if (s[gb0 + G.hitInst] !== inst) {
          s[gb0 + G.hitInst] = inst;
          s[gb0 + G.hitMask] = 0;
        }
        s[gb0 + G.hitMask] |= 1 << hitHid[q];
        damageGoon(m, k, mv, hitHid[q], hitCy[q], s[b0 + F.yaw], false, false, s[b0 + F.mvFlags]);
      }
      if (n > 0) {
        if (s[b0 + F.contact] === 0) s[b0 + F.contactF] = f;
        s[b0 + F.contact] = 1;
        s[b0 + F.hitMask] |= 1 << hitHid[0];
        s[b0 + F.hitCount]++;
        s[b0 + F.lastHitF] = f;
        if (s[b0 + F.hitstop] < mv.hitstop) s[b0 + F.hitstop] = mv.hitstop;
        addShowtime(m, 0, mv.gainShow);
        gainNerve(m, 0, m.sys.raw.nerve.hitGain);
        if (n >= 2) {
          award(m, cb.score.crowd * (n - 1), SCORE_WHY.CROWD);
          rate(m, cb.score.gCrowd);
        }
      }
    }
    // throws / command grabs: the nearest goon inside the front arc within reach (CHANGED(SIM3D))
    if (mv.isGrab && s[b0 + F.contact] === 0 && f >= mv.startup && f <= mv.lastActive) {
      let best = -1;
      let bestD = 1 << 30;
      const yaw = s[b0 + F.yaw];
      const reach = mv.grabGap >= 0 ? mv.grabGap : mv.grabReach;
      pushCircle(m, 0, PB3);
      for (let k = 0; k < GOON_CAP; k++) {
        if (!goonVulnerable(m, k) || s[gb(k) + G.y] > 0) continue;
        const rx = s[gb(k) + G.x] - s[b0 + F.x];
        const rz = s[gb(k) + G.z] - s[b0 + F.z];
        const dist = isqrt(rx * rx + rz * rz);
        if (dist > 0 && rx * sinQ(yaw) + rz * cosQ(yaw) < m.sys.frontArcCos * dist) continue;
        const cx = s[gb(k) + G.x] - PB3[0];
        const cz = s[gb(k) + G.z] - PB3[1];
        const gap = isqrt(cx * cx + cz * cz) - PB3[2] - cb.pushHalf;
        if (gap <= reach && dist < bestD) {
          best = k;
          bestD = dist;
        }
      }
      if (best >= 0) {
        s[b0 + F.contact] = 1;
        s[b0 + F.contactF] = f;
        damageGoon(m, best, mv, 0, 100000, yaw, false, true, s[b0 + F.mvFlags]);
      }
    }
  }
  // player projectiles (and the ball) vs goons
  for (let p = 0; p < PROJ_CAP; p++) {
    const pb = projBase(p);
    if (s[pb + P.act] === 0 || s[pb + P.owner] !== 0 || s[pb + P.kind] === PK.HECKLE || s[pb + P.hits] <= 0 || s[pb + P.hitCd] > 0) continue;
    const pmv = m.cf[0].moves[s[pb + P.mv]];
    const lat = pmv.proj ? pmv.proj.lat : s[pb + P.w] >> 1;
    for (let k = 0; k < GOON_CAP; k++) {
      if (!goonVulnerable(m, k)) continue;
      goonHurt(m, k, GR);
      if (!projHitsCyl(s, pb, lat, GR, 1)) continue;
      const mv = pmv;
      damageGoon(m, k, mv, 0, s[pb + P.y], s[pb + P.yaw], true, false, s[pb + P.flags]);
      s[pb + P.hitCd] = 12;
      if (--s[pb + P.hits] <= 0) killProjectile(m, p);
      break;
    }
  }
}

// ------------------------------------------------------------------ goons -> player
function goonsVsPlayer(m: Match): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const b0 = fb(0);
  const st0 = s[b0 + F.st];
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (s[b + G.act] === 0 || s[b + G.st] !== GS.ATTACK || s[b + G.contact] !== 0 || s[b + G.hitstop] > 0) continue;
    const mv = kitOf(m, k)[s[b + G.mv]];
    const f = s[b + G.mvF];
    if (f < mv.startup || f > mv.lastActive) continue;
    if (!playerVulnerable(m)) continue;
    const n = hurtCyls(m, 0, PRR);
    let hitBox = -1;
    // CHANGED(SIM3D): the goon's box in its own local frame (G.yaw) vs the player's hurt cylinders
    const gyaw = s[b + G.yaw];
    const gfx = sinQ(gyaw);
    const gfz = cosQ(gyaw);
    for (let j = 0; j < mv.nBox && hitBox < 0; j++) {
      const o = j * 7;
      if (f < mv.boxes[o] || f > mv.boxes[o + 1]) continue;
      const cy = s[b + G.y] + mv.boxes[o + 3];
      const h2 = mv.boxes[o + 5] >> 1;
      for (let r = 0; r < n && hitBox < 0; r++) {
        const q = r * 5;
        if (boxCyl(s[b + G.x], s[b + G.z], gfx, gfz, mv.boxes[o + 2], mv.boxes[o + 4] >> 1, mv.lateral, cy - h2, cy + h2, PRR[q], PRR[q + 1], PRR[q + 2], PRR[q + 3], PRR[q + 4])) hitBox = j;
      }
    }
    if (hitBox < 0) continue;
    const cy = mv.boxes[hitBox * 7 + 3];
    const ev = GOON_EV + k;
    s[b + G.contact] = 1;
    const dir = gyaw; // CHANGED(SIM3D): the goon's attack direction
    // counter moves catch goon strikes too (CONTRACT §28.2 counter)
    if (st0 === ST.ATTACK && s[b0 + F.mv] >= 0) {
      const pmv = m.cf[0].moves[s[b0 + F.mv]];
      const pf = s[b0 + F.mvF];
      const cc = pmv.counter;
      if (cc && cc.strike && pf >= cc.f0 && pf <= cc.f1) {
        s[b + G.hitstop] = m.cf[0].u.catchHitstop;
        s[b + G.mvF] = Math.max(s[b + G.mvF], mv.lastActive);
        emit(m, EVX.CATCH, 0, ev, mv.sc, 0);
        if (cc.follow >= 0) {
          setOpp(0, s[b + G.x], s[b + G.z]);
          startMove(m, 0, cc.follow, 0);
        }
        continue;
      }
      // armor absorbs
      if (s[b0 + F.armorLeft] > 0 && pf >= pmv.armorF0 && pf <= pmv.armorF1) {
        s[b0 + F.armorLeft]--;
        s[b0 + F.armorAbs]++;
        s[b0 + F.hp] = Math.max(1, s[b0 + F.hp] - mv.damage);
        s[b0 + F.grey] += mv.damage;
        s[b0 + F.greyDelay] = 0;
        s[b + G.hitstop] = mv.hitstop;
        s[b0 + F.hitstop] = Math.max(s[b0 + F.hitstop], mv.hitstop);
        emit(m, EV.IMPACT_ARMOR, 0, ev, mv.sc, cmOf(cy));
        continue;
      }
    }
    if (st0 === ST.PARRY) {
      const perfect = s[b0 + F.parryF] <= m.sys.raw.parry.perfectFrames;
      s[b0 + F.parryOk] = 1;
      gainNerve(m, 0, m.sys.raw.parry.refund.strike);
      s[b + G.hitstop] = mv.hitstop;
      s[b + G.mv] = -1;
      s[b + G.mvF] = 0;
      s[b + G.stun] = perfect ? cb.hitstunF * 3 : cb.hitstunF * 2;
      s[b + G.vx] = 0;
      s[b + G.vz] = 0;
      releaseToken(m, k);
      setGs(m, k, GS.HIT);
      if (perfect) {
        setSt(m, 0, ST.IDLE);
        s[b0 + F.invS] = Math.max(s[b0 + F.invS], m.sys.raw.parry.perfectInvulnAfter);
        s[b0 + F.invT] = Math.max(s[b0 + F.invT], m.sys.raw.parry.perfectInvulnAfter);
        emit(m, EV.PERFECT_PARRY, ev, 0, mv.sc, cmOf(cy));
        award(m, cb.score.perfect, SCORE_WHY.PERFECT);
        rate(m, cb.score.gPerfect);
        s[H(BR.perfects)]++;
      } else {
        setSt(m, 0, ST.BLOCKSTUN);
        s[b0 + F.stun] = mv.blockstun;
        s[b0 + F.stunKind] = 4;
        s[b0 + F.hitstop] = Math.max(s[b0 + F.hitstop], mv.hitstop);
        emit(m, EV.PARRY, ev, 0, mv.sc, cmOf(cy));
        award(m, cb.score.parry, SCORE_WHY.PARRY);
        rate(m, cb.score.gParry);
      }
      s[H(BR.parries)]++;
      continue;
    }
    if (canBlock(m, 0, mv, s[b + G.x], s[b + G.z])) {
      const crouchG = (s[b0 + F.raw] & 2) !== 0 && (s[b0 + F.raw] & 1) === 0;
      clearMove(m, 0);
      setSt(m, 0, ST.BLOCKSTUN);
      s[b0 + F.stun] = mv.blockstun;
      s[b0 + F.lastStun] = mv.blockstun;
      s[b0 + F.stunKind] = crouchG ? 1 : 0;
      s[b0 + F.flags] = (s[b0 + F.flags] & ~FL.PROX) | FL.BLOCKING;
      if (crouchG) s[b0 + F.flags] |= FL.CROUCHING;
      s[b0 + F.pushLeft] = mv.pushBlock;
      s[b0 + F.pushYaw] = dir;
      s[b0 + F.pushF] = m.sys.raw.pushback.frames;
      s[b0 + F.flags] &= ~FL.PUSHX;
      s[b0 + F.hitstop] = Math.max(s[b0 + F.hitstop], mv.hitstop);
      s[b + G.hitstop] = mv.hitstop;
      emit(m, EV.BLOCK, ev, 0, mv.sc, cmOf(cy));
      continue;
    }
    // hit: HP never below 1 (score round), RATINGS drop 2 grades
    playerHit(m, mv.damage, mv.hitstun, mv.hitstop, dir, mv.pushHit, mv.str === 2 ? 1 : 0);
    s[b + G.hitstop] = mv.hitstop;
    emit(m, EV.HIT, ev, 0, mv.sc, cmOf(cy));
  }
}

function playerVulnerable(m: Match): boolean {
  const s = m.s;
  const b0 = fb(0);
  const st = s[b0 + F.st];
  if (st === ST.KNOCKDOWN || st === ST.INTRO || st === ST.WIN || st === ST.LOSE || st === ST.THROWN || st === ST.TECH) return false;
  if (s[b0 + F.invS] > 0) return false;
  if (st === ST.ATTACK && s[b0 + F.mv] >= 0) {
    const mv = m.cf[0].moves[s[b0 + F.mv]];
    const f = s[b0 + F.mvF];
    if (mv.inv[0] > 0 && f >= mv.inv[0] && f <= mv.inv[1]) return false;
  }
  return true;
}

function playerHit(m: Match, dmg: number, stun: number, hs: number, dir: number, push: number, kind: number): void {
  const s = m.s;
  const b0 = fb(0);
  s[b0 + F.hp] = Math.max(1, s[b0 + F.hp] - dmg);
  s[b0 + F.lastDmg] = dmg;
  const air = isAirborne(s, b0);
  clearMove(m, 0);
  if (air) {
    setSt(m, 0, ST.JUGGLE);
    s[b0 + F.flags] = (s[b0 + F.flags] | FL.AIRBORNE) & ~(FL.CROUCHING | FL.PROX | FL.BLOCKING);
    setVelAlong(s, b0, dir, m.sys.airResetVx);
    s[b0 + F.vy] = m.sys.airResetVy;
    s[b0 + F.kd] = 0;
    s[b0 + F.stun] = 0;
  } else {
    setSt(m, 0, ST.HITSTUN);
    s[b0 + F.stun] = stun;
    s[b0 + F.lastStun] = stun;
    s[b0 + F.stunKind] = kind;
    s[b0 + F.pushLeft] = push;
    s[b0 + F.pushYaw] = dir;
    s[b0 + F.pushF] = m.sys.raw.pushback.frames;
    s[b0 + F.flags] &= ~FL.PUSHX;
  }
  s[b0 + F.hitstop] = Math.max(s[b0 + F.hitstop], hs);
  s[b0 + F.bufA] = ACT.NONE;
  s[H(BR.hitsTaken)]++;
  ratingsHit(m);
}

// ------------------------------------------------------------------ HECKLER TOSS
function heckleLive(m: Match): number {
  const s = m.s;
  let n = 0;
  for (let k = 0; k < PROJ_CAP; k++) if (s[projBase(k) + P.act] !== 0 && s[projBase(k) + P.kind] === PK.HECKLE) n++;
  return n;
}

function heckleSpawn(m: Match): void {
  const s = m.s;
  const hk = (m.bonus as CBrawl).hk;
  let slot = -1;
  for (let k = PROJ_CAP - 1; k >= 0; k--) {
    if (s[projBase(k) + P.act] === 0) {
      slot = k;
      break;
    }
  }
  if (slot < 0) return;
  const type = rngInt(s, RNG, hk.objIds.length);
  // CHANGED(SIM3D) (CONTRACT §35.8): from the crowd on all sides - a random bearing around the player
  const px = s[fb(0) + F.x];
  const pz = s[fb(0) + F.z];
  const dist = hk.distMin + rngInt(s, RNG, Math.max(1, hk.distMax - hk.distMin));
  const bearing = rngInt(s, RNG, 65536);
  const x0 = px + mulQ(dist, sinQ(bearing));
  const z0 = pz + mulQ(dist, cosQ(bearing));
  const T = Math.max(8, hk.objFlight[type]);
  const tx = px;
  const tz = pz;
  const vx = Math.trunc((tx - x0) / T);
  const vz = Math.trunc((tz - z0) / T);
  const vy = Math.trunc((hk.aimY - hk.spawnY + Math.trunc((hk.g * T * (T - 1)) / 2)) / T);
  const pb = projBase(slot);
  s[pb + P.act] = 1;
  s[pb + P.owner] = CROWD_EV;
  s[pb + P.mv] = type;
  s[pb + P.x] = x0;
  s[pb + P.z] = z0;
  s[pb + P.y] = hk.spawnY;
  s[pb + P.vx] = vx;
  s[pb + P.vz] = vz;
  s[pb + P.yaw] = dirToYaw(tx - x0, tz - z0);
  s[pb + P.vy] = vy;
  s[pb + P.g] = hk.g;
  s[pb + P.life] = T + 90;
  s[pb + P.hits] = 1;
  s[pb + P.w] = hk.objW[type];
  s[pb + P.h] = hk.objH[type];
  s[pb + P.age] = 0;
  s[pb + P.hitCd] = 0;
  s[pb + P.kind] = PK.HECKLE;
  s[pb + P.str] = 1;
  s[pb + P.inst] = s[H(BR.heckles)];
  s[pb + P.flags] = 0;
  s[pb + P.mode] = type;
  s[pb + P.aux] = tx;
  s[pb + P.ground] = 0;
  s[H(BR.heckles)]++;
  emit(m, EV.HECKLE_THROW, slot, type, cmOf(x0), cmOf(tx));
}

function heckleTick(m: Match): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const hk = cb.hk;
  // cadence: from startF to endF over the round, +- jitter
  if (s[H(BR.heckleCd)] > 0) s[H(BR.heckleCd)]--;
  if (s[H(BR.heckleCd)] <= 0 && heckleLive(m) < hk.maxLive) {
    heckleSpawn(m);
    const total = Math.max(1, s[W.timerSetting] * 60);
    const el = Math.max(0, Math.min(total, total - s[W.timer]));
    const base = hk.startF + Math.trunc(((hk.endF - hk.startF) * el) / total);
    s[H(BR.heckleCd)] = Math.max(12, base - hk.jitterF + rngInt(s, RNG, hk.jitterF * 2 + 1));
  }
  const b0 = fb(0);
  const far = m.ring.r + 800000; // the crowd stands outside the ring; farther than this = gone
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0 || s[pb + P.kind] !== PK.HECKLE) continue;
    if (s[pb + P.age]++ > 0) {
      s[pb + P.x] += s[pb + P.vx];
      s[pb + P.z] += s[pb + P.vz];
      s[pb + P.y] += s[pb + P.vy];
      s[pb + P.vy] -= s[pb + P.g];
    }
    const floor = s[pb + P.h] >> 1;
    const ox = s[pb + P.x] - m.ring.cx;
    const oz = s[pb + P.z] - m.ring.cz;
    if (s[pb + P.y] <= floor || --s[pb + P.life] <= 0 || ox * ox + oz * oz > far * far) {
      freeProjectile(m, k); // it misses and breaks on the floor
      continue;
    }
    if (!playerVulnerable(m)) continue;
    const n = hurtCyls(m, 0, PRR);
    if (!projHitsCyl(s, pb, s[pb + P.w] >> 1, PRR, n)) continue;
    const cy = cmOf(s[pb + P.y] - s[b0 + F.y]);
    const dir = s[pb + P.yaw];
    const st0 = s[b0 + F.st];
    if (st0 === ST.PARRY) {
      const perfect = s[b0 + F.parryF] <= m.sys.raw.parry.perfectFrames;
      s[b0 + F.parryOk] = 1;
      gainNerve(m, 0, m.sys.raw.parry.refund.projectile);
      emit(m, perfect ? EV.PERFECT_PARRY : EV.PARRY, CROWD_EV, 0, SC.PROJECTILE, cy);
      award(m, perfect ? hk.perfect : hk.parry, perfect ? SCORE_WHY.HECKLE_PERFECT : SCORE_WHY.HECKLE_PARRY);
      rate(m, perfect ? cb.score.gPerfect : cb.score.gParry);
      s[H(BR.parries)]++;
      if (perfect) s[H(BR.perfects)]++;
      freeProjectile(m, k);
      continue;
    }
    // blocked: grounded, able to guard, holding back from the object's travel direction. CHANGED(SIM3D): the travel
    // direction's screen side under the camera basis (it flies toward screen-right: holding RIGHT = away = guard)
    const raw = s[b0 + F.raw];
    const toRight = sinQ(dir) * s[W.camNZ] - cosQ(dir) * s[W.camNX] >= 0;
    const backBit = toRight ? 8 : 4;
    const guardState = st0 === ST.IDLE || st0 === ST.WALK_F || st0 === ST.WALK_B || st0 === ST.CROUCH || st0 === ST.BLOCKSTUN;
    if (guardState && !isAirborne(s, b0) && (raw & backBit) !== 0 && (raw & (toRight ? 4 : 8)) === 0) {
      setSt(m, 0, ST.BLOCKSTUN);
      s[b0 + F.stun] = hk.blockstun;
      s[b0 + F.lastStun] = hk.blockstun;
      s[b0 + F.stunKind] = (raw & 2) !== 0 ? 1 : 0;
      s[b0 + F.flags] |= FL.BLOCKING;
      s[b0 + F.hitstop] = Math.max(s[b0 + F.hitstop], hk.hitstop);
      emit(m, EV.BLOCK, CROWD_EV, 0, SC.PROJECTILE, cy);
      freeProjectile(m, k);
      continue;
    }
    playerHit(m, hk.objDamage[s[pb + P.mode]] ?? 200, hk.hitstun, hk.hitstop, dir, 20000, 0);
    emit(m, EV.HIT, CROWD_EV, 0, SC.PROJECTILE, cy);
    award(m, -hk.hitCost, SCORE_WHY.HECKLE_HIT);
    freeProjectile(m, k);
  }
}

// ------------------------------------------------------------------ the bonus FIGHT frame
/** Nearest living goon to the player (planar), -1 none. */
function nearestGoon(m: Match): number {
  const s = m.s;
  const b0 = fb(0);
  let best = -1;
  let bestD = 1 << 30;
  for (let k = 0; k < GOON_CAP; k++) {
    if (!alive(s, k)) continue;
    const dx = s[gb(k) + G.x] - s[b0 + F.x];
    const dz = s[gb(k) + G.z] - s[b0 + F.z];
    const d = isqrt(dx * dx + dz * dz);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * CHANGED(SIM3D) (CONTRACT §35.8): the stick direction as a world yaw from the raw word under the camera basis:
 * RIGHT / LEFT = +R / -R (screen-right R = (camN.z, -camN.x)), STEP_OUT / STEP_IN = +camN / -camN; -1 = no direction.
 */
function stickYaw(m: Match, raw: number): number {
  const s = m.s;
  let h = 0;
  if ((raw & 8) !== 0 && (raw & 4) === 0) h = 1;
  else if ((raw & 4) !== 0 && (raw & 8) === 0) h = -1;
  let v = 0;
  if ((raw & 16384) !== 0 && (raw & 8192) === 0) v = 1;
  else if ((raw & 8192) !== 0 && (raw & 16384) === 0) v = -1;
  if (h === 0 && v === 0) return -1;
  const nx = s[W.camNX];
  const nz = s[W.camNZ];
  // R = (nz, -nx)
  const x = h * nz + v * nx;
  const z = -h * nx + v * nz;
  return dirToYaw(x, z);
}

/**
 * CHANGED(SIM3D): soft lock. When an attack is about to start (a buffered move while free / stepping), the target becomes
 * the goon nearest the stick direction (within 60 deg the nearest by distance, else the smallest angle); otherwise the
 * current target while it lives, else the nearest goon.
 */
function softLock(m: Match): number {
  const s = m.s;
  const b0 = fb(0);
  let t = s[H(BR.target)];
  if (t >= 0 && !alive(s, t)) t = -1;
  const st = s[b0 + F.st];
  const starting = s[b0 + F.bufA] === ACT.MOVE && (st === ST.IDLE || st === ST.WALK_F || st === ST.WALK_B || st === ST.CROUCH || st === ST.SIDESTEP || st === ST.SIDEWALK);
  const sy = starting ? stickYaw(m, s[b0 + F.raw]) : -1;
  if (sy >= 0) {
    let best = -1;
    let bestKey = 1 << 30;
    for (let k = 0; k < GOON_CAP; k++) {
      if (!alive(s, k)) continue;
      const dx = s[gb(k) + G.x] - s[b0 + F.x];
      const dz = s[gb(k) + G.z] - s[b0 + F.z];
      const ang = Math.abs(yawDelta(sy, dirToYaw(dx, dz)));
      const dist = isqrt(dx * dx + dz * dz);
      // within 60 deg: nearest by distance (keys < 2^24); outside: by angle (keys >= 2^24)
      const key = ang <= 10923 ? Math.min(dist, (1 << 24) - 1) : (1 << 24) + ang;
      if (key < bestKey) {
        bestKey = key;
        best = k;
      }
    }
    if (best >= 0) t = best;
  }
  if (t < 0) t = nearestGoon(m);
  s[H(BR.target)] = t;
  return t;
}

function goonThreat(m: Match): boolean {
  const s = m.s;
  pushCircle(m, 0, PB3);
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (s[b + G.act] === 0 || s[b + G.st] !== GS.ATTACK) continue;
    const mv = kitOf(m, k)[s[b + G.mv]];
    if (s[b + G.mvF] > mv.lastActive) continue;
    const dx = s[b + G.x] - PB3[0];
    const dz = s[b + G.z] - PB3[1];
    if (isqrt(dx * dx + dz * dz) - PB3[2] <= mv.maxReach + m.sys.proxGuard) return true;
  }
  return false;
}

/** One FIGHT frame of a bonus round (replaces match.ts fightStep; input word 2 is ignored). */
export function brawlFightStep(m: Match, in1: number): void {
  const s = m.s;
  const b0 = fb(0);
  const cb = m.bonus as CBrawl;
  const heckler = s[W.mode] === MODE_HECKLER;
  const frozen = s[W.freeze] > 0;
  recordInput(m, 0, in1, frozen || s[b0 + F.hitstop] > 0);
  const pre = s[b0 + F.bufA] * 65536 + s[b0 + F.bufM];
  parseAction(m, 0);
  if (frozen) {
    if (s[b0 + F.bufA] * 65536 + s[b0 + F.bufM] !== pre) s[b0 + F.bufF] |= BUF.FROZEN;
    freezeBufferRule(m, 0);
    s[W.freeze]--;
    if (s[W.freeze] === 0) s[W.freezeKind] = 0;
    animTick(m, 0, false);
    goonAnims(m, false);
    return;
  }
  if (s[H(BR.lastGrant)] < 100000) s[H(BR.lastGrant)]++;
  PROX_THREAT[0] = !heckler && goonThreat(m) ? 1 : 0;
  PROX_THREAT[1] = 0;
  const x0 = s[b0 + F.x];
  const z0 = s[b0 + F.z];
  // CHANGED(SIM3D): the player's opponent point = the soft-lock goon (heckler / no goon: 1 m ahead of him)
  const tgt = heckler ? -1 : softLock(m);
  if (tgt >= 0) setOpp(0, s[gb(tgt) + G.x], s[gb(tgt) + G.z]);
  else setOpp(0, x0 + mulQ(100000, sinQ(s[b0 + F.yaw])), z0 + mulQ(100000, cosQ(s[b0 + F.yaw])));
  let pFrozen = false;
  if (s[b0 + F.hitstop] > 0) {
    s[b0 + F.hitstop]--;
    pFrozen = true;
  } else fighterUpdate(m, 0);
  resolveBodies(m, x0, z0, s[fb(1) + F.x], s[fb(1) + F.z]);
  projectilesTick(m);
  if (!heckler) {
    for (let k = 0; k < GOON_CAP; k++) {
      const b = gb(k);
      if (s[b + G.act] === 0) continue;
      if (s[b + G.hitstop] > 0) {
        s[b + G.hitstop]--;
        continue;
      }
      goonThink(m, k);
    }
    goonBodies(m);
    playerVsGoons(m);
    goonsVsPlayer(m);
    waveDirector(m);
  } else {
    heckleTick(m);
  }
  ballPost(m);
  checkPhases(m); // a phases fighter as the player (HP never below 1 here, so it is never a KO)
  uniquesPost(m); // the unique snapshot mirrors (stance flag, charge, counter, armor step)
  clampToRing(m, 0);
  // CHANGED(SIM3D): the camera basis follows the pair (player, soft-lock goon); facing signs follow it
  const t2 = s[H(BR.target)];
  if (t2 >= 0 && s[gb(t2) + G.act] !== 0) updateCamN(s, s[b0 + F.x], s[b0 + F.z], s[gb(t2) + G.x], s[gb(t2) + G.z], m.sys.camMinSep);
  if (!pFrozen) metersTick(m, 0);
  scoringTick(m);
  if (s[W.timer] > 0) {
    s[W.timer]--;
    if (s[W.timer] === 0) bonusTimeover(m);
  }
  animTick(m, 0, !pFrozen);
  goonAnims(m, true);
}

/** The bonus round ends on the timer: cash the combo, clear crowd objects, the result is the score. */
function bonusTimeover(m: Match): void {
  const s = m.s;
  cashCombo(m);
  for (let k = 0; k < PROJ_CAP; k++) if (s[projBase(k) + P.act] !== 0 && s[projBase(k) + P.kind] === PK.HECKLE) freeProjectile(m, k);
  s[W.roundWinner] = 0;
  s[W.wins0] = 1;
  s[W.wins1] = 0;
  s[W.winner] = 0;
  s[W.draw] = 0;
  s[W.matchDeciding] = 1;
  s[W.phase] = PH.TIMEOVER;
  s[W.phaseF] = 0;
  s[W.freeze] = 0;
  const b0 = fb(0);
  clearMove(m, 0);
  s[b0 + F.bufA] = ACT.NONE;
  s[b0 + F.hitstop] = 0;
  s[b0 + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING);
  s[b0 + F.y] = 0;
  s[b0 + F.vx] = 0;
  s[b0 + F.vz] = 0;
  s[b0 + F.vy] = 0;
  setSt(m, 0, ST.WIN);
  emit(m, EV.TIMEOVER, 0, 1, s[H(BR.score)], 0);
}

// ------------------------------------------------------------------ goon anims (§17 rule 2 layout on the goon table)
function goonDesired(m: Match, k: number): number {
  const s = m.s;
  const b = gb(k);
  switch (s[b + G.st]) {
    case GS.ENTER:
    case GS.APPROACH:
      return 1; // walk_f
    case GS.WAIT:
      return s[b + G.target] > 0 ? 1 : s[b + G.target] < 0 ? 2 : 0;
    case GS.ATTACK:
      return 34 + Math.max(0, s[b + G.mv]);
    case GS.HIT:
      return s[b + G.stun] > 20 ? 14 : 13; // hit_high_l / hit_high_s
    case GS.BLOCK:
      return 11;
    case GS.JUGGLE:
      return 17; // hit_air
    case GS.KD:
      return s[b + G.stF] < 16 ? 19 : 21; // kd_fall_b, kd_ground_b
    case GS.WAKE:
      return 23; // wake_b
    case GS.DOWN:
      return 29; // ko_fall
    default:
      return 0;
  }
}

function goonAnims(m: Match, advance: boolean): void {
  const s = m.s;
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (s[b + G.act] === 0) continue;
    const want = goonDesired(m, k);
    const atk = s[b + G.st] === GS.ATTACK;
    const key = atk ? s[b + G.seq] * 16 + s[b + G.mv] + (s[b + G.mvF] === 1 ? 8 : 0) : -1;
    if (want !== s[b + G.animId] || (atk && s[b + G.mvF] === 1 && s[b + G.animInst] !== key)) {
      s[b + G.pAnimId] = s[b + G.animId];
      s[b + G.pAnimF] = s[b + G.animF];
      s[b + G.animId] = want;
      s[b + G.animF] = atk ? s[b + G.mvF] : 0;
      s[b + G.animInst] = key;
      s[b + G.blendT] = 0;
      continue;
    }
    if (!advance || s[b + G.hitstop] > 0) continue;
    s[b + G.animF] = atk ? s[b + G.mvF] : s[b + G.animF] + 1;
    if (s[b + G.blendT] < 6) s[b + G.blendT] = Math.min(6, s[b + G.blendT] + 2);
  }
}

// ------------------------------------------------------------------ snapshot
export function readBrawl(m: Match): BrawlSnap {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const goons: GoonSnap[] = [];
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (s[b + G.act] === 0) continue;
    const st = s[b + G.st];
    const mvI = s[b + G.mv];
    const kit = kitOf(m, k);
    const mv = mvI >= 0 && mvI < kit.length ? kit[mvI] : null;
    const kind = s[b + G.kind];
    goons.push({
      slot: k,
      kind: cb.kindIds[kind] ?? '',
      kindIdx: kind,
      x: s[b + G.x] / M,
      y: s[b + G.y] / M,
      z: s[b + G.z] / M,
      yaw: yawToRad(s[b + G.yaw]),
      facing: s[b + G.facing],
      state: st,
      stateName: GS_NAMES[st] ?? '',
      animId: s[b + G.animId],
      animFrame: s[b + G.animF],
      prevAnimId: s[b + G.pAnimId],
      prevAnimFrame: s[b + G.pAnimF],
      blendT: Math.min(1, s[b + G.blendT] / 6),
      hp: Math.max(0, s[b + G.hp]),
      hpMax: cb.kindHp[kind] ?? 1,
      hitstop: s[b + G.hitstop],
      telegraph: st === GS.ATTACK && mv !== null && s[b + G.mvF] < mv.startup,
      token: s[b + G.token] !== 0,
      moveName: st === GS.ATTACK && mv ? cb.moveNames[mv.idx] ?? '' : '',
      down: st === GS.DOWN,
    });
  }
  const t = s[W.timer];
  return {
    mode: s[W.mode] === MODE_HECKLER ? 'heckler' : 'brawl',
    score: s[H(BR.score)],
    ratings: Math.trunc(s[H(BR.ratings)] / 100),
    grade: grade(m),
    mult: mult(m),
    timeLeft: t < 0 ? -1 : Math.ceil(t / 60),
    timeLeftF: t,
    wave: s[H(BR.wave)],
    spawned: s[H(BR.spawned)],
    downed: s[H(BR.downed)],
    combo: s[H(BR.combo)],
    parries: s[H(BR.parries)],
    perfects: s[H(BR.perfects)],
    hitsTaken: s[H(BR.hitsTaken)],
    goons,
    target: s[H(BR.target)],
  };
}
