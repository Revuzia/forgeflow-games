// HIT PARADE — bonus rounds (CHANGED(SIM) P2, CONTRACT §4.3.14 / §28.4): BRAWL BREAK (the player fighter vs waves of
// studio goons) and HECKLER TOSS (objects thrown from the crowd; parry = points). Offline only; the state is the versus
// state plus the BR header and the G goon blocks (layout.ts STATE_INTS_BRAWL). Fighter 1 is ABSENT (never on the set).
//
// Goons: one shared 3-move kit (system.json brawl.moves = ordinary Move objects, startup >= telegraphMinF), shared hit
// reactions, simple juggle physics, attack tokens (<= brawl.tokens holders, grants >= tokenSpacingF apart, released on
// the attack's first active frame or when hit), approach / attack rings, a wave director spawning from both sides.
// Scoring: points x the RATINGS multiplier (7 bands), idle decay, -2 grades when hit, combo cash-out, crowd hits.
// Everything is integer math over the state array + compiled tables; randomness = mulberry32 on BR.rng (rollback-safe).

import {
  ACT, BR, BRAWL_BASE, BUF, F, FL, G, GOON_CAP, GOON_INTS, GS, GS_NAMES, MVF, P, PH, PROJ_CAP, ST, W, goonBase, projBase,
} from './layout.ts';
import { EV, SC, SCORE_WHY, EVX } from './events.ts';
import { K } from './compile.ts';
import type { CBrawl, CMove } from './compile.ts';
import { recordInput, parseAction } from './inputs.ts';
import { fighterUpdate, freezeBufferRule, PROX_THREAT, startMove } from './fighter.ts';
import { hitRect, hurtRects, pushExt, rectsOverlap, resolveBodies, clampToWalls } from './boxes.ts';
import { projectilesTick, ballPost, killProjectile, freeProjectile, PK } from './projectiles.ts';
import { canBlock } from './hits.ts';
import { metersTick } from './meters.ts';
import { animTick } from './anim.ts';
import { addShowtime, clearMove, emit, fb, gainNerve, isAirborne, setSt } from './state.ts';
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
  absentFighter(m);
}

/** Fighter 1 is not on the set (state ABSENT, parked far off the fight line; hits / throws / bodies ignore it). */
export function absentFighter(m: Match): void {
  const s = m.s;
  const b = fb(1);
  clearMove(m, 1);
  setSt(m, 1, ST.ABSENT);
  s[b + F.x] = 0;
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
function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
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
function goonHurt(m: Match, k: number, out: Int32Array): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const b = gb(k);
  const hw = cb.hurtW >> 1;
  out[0] = s[b + G.x] - hw;
  out[1] = s[b + G.x] + hw;
  out[2] = s[b + G.y];
  out[3] = s[b + G.y] + cb.hurtH;
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
  const lim = m.sys.wall - cb.pushHalf - 20000;
  let side = rngInt(s, RNG, 2) === 0 ? -1 : 1;
  // prefer the side with fewer goons (both sides of the line fill up)
  let left = 0;
  let right = 0;
  for (let k = 0; k < GOON_CAP; k++) {
    if (!alive(s, k)) continue;
    if (s[gb(k) + G.x] < px) left++;
    else right++;
  }
  if (left < right) side = -1;
  else if (right < left) side = 1;
  let x = px + side * cb.spawnDist;
  if (x > lim || x < -lim) {
    side = -side;
    x = px + side * cb.spawnDist;
  }
  if (x > lim) x = lim;
  if (x < -lim) x = -lim;
  const b = gb(slot);
  for (let j = 0; j < GOON_INTS; j++) s[b + j] = 0;
  s[b + G.act] = 1;
  s[b + G.kind] = kind;
  s[b + G.x] = x;
  s[b + G.facing] = x < px ? 1 : -1;
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
/** Distance from goon k's centre to the player's hurtbox edge that faces it (U, >= 0). */
function gapToPlayer(m: Match, k: number): number {
  const s = m.s;
  const px = s[fb(0) + F.x];
  const gx = s[gb(k) + G.x];
  const dir = gx >= px ? 1 : -1; // the player's side facing the goon
  const edge = px + dir * (dir * s[fb(0) + F.facing] > 0 ? m.cf[0].hurtFS : m.cf[0].hurtBS);
  return Math.max(0, Math.abs(gx - edge));
}

function chooseMove(m: Match, k: number): number {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const gap = gapToPlayer(m, k);
  const n = cb.moves.length;
  // lunge when still far, else jab / haymaker by roll
  if (n >= 3 && gap > cb.moveRange[1] + 40000) return 2;
  const r = rngInt(s, RNG, 100);
  if (n >= 2 && r < 40) return 1;
  return 0;
}

function goonThink(m: Match, k: number): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const b = gb(k);
  const px = s[fb(0) + F.x];
  const x = s[b + G.x];
  const dir = px >= x ? 1 : -1;
  const st = s[b + G.st];
  const walk = cb.kindWalk[s[b + G.kind]];
  const gap = gapToPlayer(m, k);
  s[b + G.stF]++;
  if (st === GS.ENTER || st === GS.WAIT || st === GS.APPROACH) s[b + G.facing] = dir;
  switch (st) {
    case GS.ENTER: {
      if (gap <= cb.ringApproach[1]) {
        setGs(m, k, GS.WAIT);
        break;
      }
      s[b + G.x] += dir * walk;
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
      // hold the approach ring
      if (gap < cb.ringApproach[0]) {
        s[b + G.x] -= dir * ((walk * 3) >> 2);
        s[b + G.target] = -1;
      } else if (gap > cb.ringApproach[1]) {
        s[b + G.x] += dir * walk;
        s[b + G.target] = 1;
      }
      break;
    }
    case GS.APPROACH: {
      const mv = s[b + G.mv] >= 0 ? cb.moves[s[b + G.mv]] : cb.moves[0];
      const range = cb.moveRange[mv.idx] ?? cb.ringAttack[1];
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
      s[b + G.x] += dir * walk;
      s[b + G.target] = 1;
      break;
    }
    case GS.ATTACK: {
      const mv = cb.moves[s[b + G.mv]];
      const f = ++s[b + G.mvF];
      if (f > mv.total) {
        s[b + G.mv] = -1;
        s[b + G.mvF] = 0;
        s[b + G.think] = rr(m, cb.thinkMin, cb.thinkMax);
        setGs(m, k, GS.WAIT);
        break;
      }
      const d = mv.curve[f] - mv.curve[f - 1];
      if (d !== 0) s[b + G.x] += s[b + G.facing] * d;
      if (f === mv.startup) releaseToken(m, k); // released when the attack's active frames start (Amalur)
      break;
    }
    case GS.HIT:
    case GS.BLOCK: {
      s[b + G.x] += s[b + G.vx];
      s[b + G.vx] = Math.trunc((s[b + G.vx] * 3) / 4);
      if (--s[b + G.stun] <= 0) {
        s[b + G.vx] = 0;
        s[b + G.think] = rr(m, cb.thinkMin, cb.thinkMax);
        setGs(m, k, GS.WAIT);
      }
      break;
    }
    case GS.JUGGLE:
    case GS.DOWN: {
      if (s[b + G.y] > 0 || s[b + G.vy] > 0) {
        s[b + G.x] += s[b + G.vx];
        s[b + G.y] += s[b + G.vy];
        s[b + G.vy] -= cb.g;
        if (s[b + G.y] <= 0) {
          s[b + G.y] = 0;
          s[b + G.vy] = 0;
          s[b + G.vx] = 0;
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

/** Goons never overlap the player (they step back) or each other (split evenly, slot order); walls clamp. */
function goonBodies(m: Match): void {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const px = s[fb(0) + F.x];
  const lim = m.sys.wall - cb.pushHalf;
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (!alive(s, k) || s[b + G.y] > 0) continue;
    const gx = s[b + G.x];
    const dir = gx >= px ? 1 : -1;
    const minD = pushExt(m, 0, dir) + cb.pushHalf;
    if (Math.abs(gx - px) < minD && (s[fb(0) + F.flags] & FL.AIRBORNE) === 0) s[b + G.x] = px + dir * minD;
  }
  for (let a = 0; a < GOON_CAP; a++) {
    if (!alive(s, a) || s[gb(a) + G.y] > 0) continue;
    for (let c = a + 1; c < GOON_CAP; c++) {
      if (!alive(s, c) || s[gb(c) + G.y] > 0) continue;
      const xa = s[gb(a) + G.x];
      const xc = s[gb(c) + G.x];
      const d = Math.abs(xa - xc);
      const minD = cb.pushHalf * 2;
      if (d >= minD) continue;
      const ov = minD - d;
      const aLeft = xa < xc || (xa === xc && a < c);
      s[gb(a) + G.x] += (aLeft ? -1 : 1) * (ov - (ov >> 1));
      s[gb(c) + G.x] += (aLeft ? 1 : -1) * (ov >> 1);
    }
  }
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (s[b + G.act] === 0) continue;
    if (s[b + G.x] > lim) s[b + G.x] = lim;
    if (s[b + G.x] < -lim) s[b + G.x] = -lim;
  }
}

// ------------------------------------------------------------------ player -> goons
const HR = new Int32Array(4);
const GR = new Int32Array(4);
const PRR = new Int32Array(24);
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

/** Applies a player hit (move `mv`, hit id `hid`) to goon k. Returns true when it KO'd the goon. */
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
    s[b + G.vx] = dir * cb.koVx;
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
    s[b + G.vx] = dir * (mv.launchVx > 0 ? mv.launchVx : cb.launchVx);
    s[b + G.vy] = mv.launchVy > 0 ? mv.launchVy : wasAir ? cb.launchVy >> 1 : cb.launchVy;
    s[b + G.y] = Math.max(s[b + G.y], 1);
    if (wasAir) s[b + G.jc]++;
    setGs(m, k, GS.JUGGLE);
    return false;
  }
  s[b + G.stun] = Math.max(cb.hitstunF, mv.hitstun);
  s[b + G.vx] = Math.trunc((dir * mv.pushHit) / 3);
  s[b + G.facing] = -dir;
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
          hitRect(m, 0, mv, j, HR, 0);
          if (!rectsOverlap(HR, 0, GR, 0)) continue;
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
        const dir = s[gb0 + G.x] >= s[b0 + F.x] ? 1 : -1;
        damageGoon(m, k, mv, hitHid[q], hitCy[q], dir, false, false, s[b0 + F.mvFlags]);
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
    // throws / command grabs: the nearest goon in front within reach
    if (mv.isGrab && s[b0 + F.contact] === 0 && f >= mv.startup && f <= mv.lastActive) {
      let best = -1;
      let bestD = 1 << 30;
      const fc = s[b0 + F.facing];
      const reach = mv.grabGap >= 0 ? mv.grabGap : mv.grabReach;
      for (let k = 0; k < GOON_CAP; k++) {
        if (!goonVulnerable(m, k) || s[gb(k) + G.y] > 0) continue;
        const dxF = (s[gb(k) + G.x] - s[b0 + F.x]) * fc;
        if (dxF < 0) continue;
        const gap = dxF - pushExt(m, 0, fc) - cb.pushHalf;
        if (gap <= reach && dxF < bestD) {
          best = k;
          bestD = dxF;
        }
      }
      if (best >= 0) {
        s[b0 + F.contact] = 1;
        s[b0 + F.contactF] = f;
        damageGoon(m, best, mv, 0, 100000, fc, false, true, s[b0 + F.mvFlags]);
      }
    }
  }
  // player projectiles (and the ball) vs goons
  for (let p = 0; p < PROJ_CAP; p++) {
    const pb = projBase(p);
    if (s[pb + P.act] === 0 || s[pb + P.owner] !== 0 || s[pb + P.kind] === PK.HECKLE || s[pb + P.hits] <= 0 || s[pb + P.hitCd] > 0) continue;
    const w2 = s[pb + P.w] >> 1;
    const h2 = s[pb + P.h] >> 1;
    HR[0] = s[pb + P.x] - w2;
    HR[1] = s[pb + P.x] + w2;
    HR[2] = s[pb + P.y] - h2;
    HR[3] = s[pb + P.y] + h2;
    for (let k = 0; k < GOON_CAP; k++) {
      if (!goonVulnerable(m, k)) continue;
      goonHurt(m, k, GR);
      if (!rectsOverlap(HR, 0, GR, 0)) continue;
      const mv = m.cf[0].moves[s[pb + P.mv]];
      const dir = s[pb + P.vx] >= 0 ? 1 : -1;
      damageGoon(m, k, mv, 0, s[pb + P.y], dir, true, false, s[pb + P.flags]);
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
    const mv = cb.moves[s[b + G.mv]];
    const f = s[b + G.mvF];
    if (f < mv.startup || f > mv.lastActive) continue;
    if (!playerVulnerable(m)) continue;
    const n = hurtRects(m, 0, PRR);
    let hitBox = -1;
    for (let j = 0; j < mv.nBox && hitBox < 0; j++) {
      const o = j * 7;
      if (f < mv.boxes[o] || f > mv.boxes[o + 1]) continue;
      const cx = s[b + G.x] + s[b + G.facing] * mv.boxes[o + 2];
      const cy = s[b + G.y] + mv.boxes[o + 3];
      HR[0] = cx - (mv.boxes[o + 4] >> 1);
      HR[1] = cx + (mv.boxes[o + 4] >> 1);
      HR[2] = cy - (mv.boxes[o + 5] >> 1);
      HR[3] = cy + (mv.boxes[o + 5] >> 1);
      for (let r = 0; r < n; r++) if (rectsOverlap(HR, 0, PRR, r * 4)) hitBox = j;
    }
    if (hitBox < 0) continue;
    const cy = mv.boxes[hitBox * 7 + 3];
    const ev = GOON_EV + k;
    s[b + G.contact] = 1;
    const dir = s[b0 + F.x] >= s[b + G.x] ? 1 : -1;
    // counter moves catch goon strikes too (CONTRACT §28.2 counter)
    if (st0 === ST.ATTACK && s[b0 + F.mv] >= 0) {
      const pmv = m.cf[0].moves[s[b0 + F.mv]];
      const pf = s[b0 + F.mvF];
      const cc = pmv.counter;
      if (cc && cc.strike && pf >= cc.f0 && pf <= cc.f1) {
        s[b + G.hitstop] = m.cf[0].u.catchHitstop;
        s[b + G.mvF] = Math.max(s[b + G.mvF], mv.lastActive);
        emit(m, EVX.CATCH, 0, ev, mv.sc, 0);
        if (cc.follow >= 0) startMove(m, 0, cc.follow, 0, s[b + G.x]);
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
    if (canBlock(m, 0, mv, s[b + G.x])) {
      const crouchG = (s[b0 + F.raw] & 2) !== 0 && (s[b0 + F.raw] & 1) === 0;
      clearMove(m, 0);
      setSt(m, 0, ST.BLOCKSTUN);
      s[b0 + F.stun] = mv.blockstun;
      s[b0 + F.lastStun] = mv.blockstun;
      s[b0 + F.stunKind] = crouchG ? 1 : 0;
      s[b0 + F.flags] = (s[b0 + F.flags] & ~FL.PROX) | FL.BLOCKING;
      if (crouchG) s[b0 + F.flags] |= FL.CROUCHING;
      s[b0 + F.pushLeft] = dir * mv.pushBlock;
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
    s[b0 + F.vx] = dir * m.sys.airResetVx;
    s[b0 + F.vy] = m.sys.airResetVy;
    s[b0 + F.kd] = 0;
    s[b0 + F.stun] = 0;
  } else {
    setSt(m, 0, ST.HITSTUN);
    s[b0 + F.stun] = stun;
    s[b0 + F.lastStun] = stun;
    s[b0 + F.stunKind] = kind;
    s[b0 + F.pushLeft] = dir * push;
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
  let side = rngInt(s, RNG, 2) === 0 ? -1 : 1;
  const px = s[fb(0) + F.x];
  const dist = hk.distMin + rngInt(s, RNG, Math.max(1, hk.distMax - hk.distMin));
  const lim = m.sys.wall - 30000;
  let x0 = px + side * dist;
  if (x0 > lim || x0 < -lim) {
    side = -side;
    x0 = px + side * dist;
  }
  if (x0 > lim) x0 = lim;
  if (x0 < -lim) x0 = -lim;
  const T = Math.max(8, hk.objFlight[type]);
  const tx = px;
  const vx = Math.trunc((tx - x0) / T);
  const vy = Math.trunc((hk.aimY - hk.spawnY + Math.trunc((hk.g * T * (T - 1)) / 2)) / T);
  const pb = projBase(slot);
  s[pb + P.act] = 1;
  s[pb + P.owner] = CROWD_EV;
  s[pb + P.mv] = type;
  s[pb + P.x] = x0;
  s[pb + P.y] = hk.spawnY;
  s[pb + P.vx] = vx;
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
  const lim = m.sys.wall;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0 || s[pb + P.kind] !== PK.HECKLE) continue;
    if (s[pb + P.age]++ > 0) {
      s[pb + P.x] += s[pb + P.vx];
      s[pb + P.y] += s[pb + P.vy];
      s[pb + P.vy] -= s[pb + P.g];
    }
    const floor = s[pb + P.h] >> 1;
    if (s[pb + P.y] <= floor || --s[pb + P.life] <= 0 || s[pb + P.x] > lim || s[pb + P.x] < -lim) {
      freeProjectile(m, k); // it misses and breaks on the floor
      continue;
    }
    if (!playerVulnerable(m)) continue;
    const w2 = s[pb + P.w] >> 1;
    const h2 = s[pb + P.h] >> 1;
    HR[0] = s[pb + P.x] - w2;
    HR[1] = s[pb + P.x] + w2;
    HR[2] = s[pb + P.y] - h2;
    HR[3] = s[pb + P.y] + h2;
    const n = hurtRects(m, 0, PRR);
    let touch = false;
    for (let r = 0; r < n && !touch; r++) touch = rectsOverlap(HR, 0, PRR, r * 4);
    if (!touch) continue;
    const cy = cmOf(s[pb + P.y] - s[b0 + F.y]);
    const dir = s[pb + P.vx] >= 0 ? 1 : -1;
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
    // blocked: grounded, able to guard, holding back from the object's travel direction
    const raw = s[b0 + F.raw];
    const backBit = dir > 0 ? 8 : 4; // the object flies toward +x: holding RIGHT (away) guards
    const guardState = st0 === ST.IDLE || st0 === ST.WALK_F || st0 === ST.WALK_B || st0 === ST.CROUCH || st0 === ST.BLOCKSTUN;
    if (guardState && !isAirborne(s, b0) && (raw & backBit) !== 0 && (raw & (dir > 0 ? 4 : 8)) === 0) {
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
function nearestGoonX(m: Match): number {
  const s = m.s;
  const b0 = fb(0);
  const px = s[b0 + F.x];
  let best = px + s[b0 + F.facing] * 100000;
  let bestD = 1 << 30;
  for (let k = 0; k < GOON_CAP; k++) {
    if (!alive(s, k)) continue;
    const d = Math.abs(s[gb(k) + G.x] - px);
    if (d < bestD) {
      bestD = d;
      best = s[gb(k) + G.x];
    }
  }
  return best === px ? px + s[b0 + F.facing] : best;
}

function goonThreat(m: Match): boolean {
  const s = m.s;
  const cb = m.bonus as CBrawl;
  const px = s[fb(0) + F.x];
  for (let k = 0; k < GOON_CAP; k++) {
    const b = gb(k);
    if (s[b + G.act] === 0 || s[b + G.st] !== GS.ATTACK) continue;
    const mv = cb.moves[s[b + G.mv]];
    if (s[b + G.mvF] > mv.lastActive) continue;
    if (Math.abs(s[b + G.x] - px) <= mv.maxReach + m.sys.proxGuard + pushExt(m, 0, s[b + G.x] >= px ? 1 : -1)) return true;
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
  let pFrozen = false;
  if (s[b0 + F.hitstop] > 0) {
    s[b0 + F.hitstop]--;
    pFrozen = true;
  } else fighterUpdate(m, 0, heckler ? x0 + s[b0 + F.facing] : nearestGoonX(m));
  resolveBodies(m, x0, s[fb(1) + F.x]);
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
  clampToWalls(m, 0);
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
    const mv = mvI >= 0 && mvI < cb.moves.length ? cb.moves[mvI] : null;
    const kind = s[b + G.kind];
    goons.push({
      slot: k,
      kind: cb.kindIds[kind] ?? '',
      kindIdx: kind,
      x: s[b + G.x] / M,
      y: s[b + G.y] / M,
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
  };
}
