// HIT PARADE — per-fighter state machine (CONTRACT §4.3 items 1, 2, 5, 8, 9, 10; CHANGED(SIM3D) §35.2 / §35.4).
// One call of fighterUpdate() = one non-frozen frame of that fighter. Hitstop / world freeze
// frames never reach it (match.ts skips them), so timers, buffers and anim frames do not age then.
//
// Frame conventions (SF6, FIGHTING_DESIGN §1b): a move started on frame t has mvF = 1 on t;
// startup counts the first active frame; the move ends after mvF = startup + active + recovery - 1
// and the fighter acts again on the next frame. Hitstun / blockstun / knockdown = frames from the
// hit frame until the defender can act, so on-hit advantage = stun - (active + recovery).
//
// CHANGED(SIM3D) 3D ring (CONTRACT §35): positions (x, z) + yaw. The "opponent point" of each fighter this frame is the
// scratch OPP (set by match.ts / brawl.ts from START-of-frame positions before either fighter updates, so slot order never
// matters). Neutral states (idle, walk, crouch, block pose, dash, landing, sidestep / sidewalk) AUTO-FACE the opponent
// every frame; attacks follow the move's tracking (track.until / rate, homing, linear); hitstun / knockdown keep the yaw.
// Walks, dashes, jumps, rushes and authored move travel run along the fighter's forward (= the line to the opponent in
// neutral). STEP_IN / STEP_OUT: SIDESTEP (tap, 15 f arc around the opponent) -> SIDEWALK (held) -> STEP_END (release).

import { ACT, BUF, CF, F, FL, MVF, ST, W } from './layout.ts';
import { EV, CUE, EVX } from './events.ts';
import { BACT, K, STK, TPD, UK } from './compile.ts';
import type { CMove } from './compile.ts';
import { IN, curDir, dirOf, prejumpCancelable, projOk, stepBits } from './inputs.ts';
import {
  addShowtime, canAfford, canNerve, clearMove, emit, fb, isAirborne, moveAlong, moveFwd, setSt, setVelAlong, spendNerve, updateFacing,
} from './state.ts';
import type { Match } from './state.ts';
import { ballLaunch, spawnProjectile } from './projectiles.ts';
import { clampToRing, pushCircle } from './boxes.ts';
import { KDF, endsFaceDown, holdPos, victimPose } from './throwpose.ts';
import { Q, YAW_HALF, alongYaw, cosQ, divRound, dirToYaw, isqrt, mulQ, sinQ, turnToward } from './fx3d.ts';

const AY = new Int32Array(2);
import { ringClamp, ringGap, ringRay } from './ring.ts';
import { wallSplat } from './splat.ts';

export const CTX = { FREE: 0, CANCEL: 1, AIR: 2, PREJUMP: 3, BLOCKSTUN: 4, PARRY: 5, RUSH: 6, STANCE: 7, STEP: 8 } as const;

/**
 * CHANGED(SIM3D): the opponent point per fighter for this frame, U: [x0, z0, x1, z1] (fighter i reads OPP[2i], OPP[2i+1]).
 * Scratch, rewritten every frame from the state before use (match.ts fightStep / outroUpdate, brawl.ts, hits.ts catch).
 */
export const OPP = new Int32Array(4);

/** Sets fighter i's opponent point (U). */
export function setOpp(i: number, x: number, z: number): void {
  OPP[2 * i] = x;
  OPP[2 * i + 1] = z;
}

function clearBuf(s: Int32Array, b: number): void {
  s[b + F.bufA] = ACT.NONE;
  s[b + F.bufM] = -1;
  s[b + F.bufAge] = 0;
  s[b + F.bufF] = 0;
}

// ------------------------------------------------------------------ facing (CHANGED(SIM3D))
/** Yaw from fighter i toward its opponent point, or its current yaw when they coincide. */
export function yawToOpp(m: Match, i: number): number {
  const s = m.s;
  const b = fb(i);
  const dx = OPP[2 * i] - s[b + F.x];
  const dz = OPP[2 * i + 1] - s[b + F.z];
  if (dx === 0 && dz === 0) return s[b + F.yaw];
  return dirToYaw(dx, dz);
}

/** AUTO-FACE (CONTRACT §35.2): snap the yaw toward the opponent; the input-mapping facing sign follows at once. */
export function autoFace(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  s[b + F.yaw] = yawToOpp(m, i);
  updateFacing(s, b);
}

/** Tracking (CONTRACT §35.4): turn toward the opponent by at most `rate` yaw units (0 = full re-face). */
function trackOpp(m: Match, i: number, rate: number): void {
  const s = m.s;
  const b = fb(i);
  const want = yawToOpp(m, i);
  s[b + F.yaw] = rate > 0 ? turnToward(s[b + F.yaw], want, rate) : want;
  updateFacing(s, b);
}

// ------------------------------------------------------------------ entry points to states
/** The fighter becomes actionable on the ground this frame (and may act on it). */
export function enterFree(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  if (s[b + F.cCount] !== 0 || s[b + F.jc] !== 0) {
    s[b + F.cCount] = 0;
    s[b + F.cStep] = 0;
    s[b + F.cFlags] = 0;
    s[b + F.cLastInst] = -1;
    s[b + F.jc] = 0;
  }
  s[b + F.kd] = 0;
  s[b + F.wake] = 0;
  s[b + F.bounce] = 0;
  s[b + F.ppPending] = 0;
  s[b + F.stun] = 0;
  s[b + F.after] = 0;
  clearMove(m, i);
  s[b + F.flags] &= ~(FL.AIRBORNE | FL.PROX | FL.BLOCKING | FL.CROUCHING);
  s[b + F.y] = 0;
  s[b + F.vx] = 0;
  s[b + F.vz] = 0;
  s[b + F.vy] = 0;
  setSt(m, i, ST.IDLE);
  freeTick(m, i);
}

/**
 * Proximity-guard threat per fighter, computed from START-of-frame state by match.ts before either
 * fighter updates (so slot order never matters). Scratch, rewritten every frame.
 */
export const PROX_THREAT = new Int32Array(2);

function proxGuard(m: Match, i: number): boolean {
  return PROX_THREAT[i] !== 0;
}

const PC0 = new Int32Array(3);
const PC1 = new Int32Array(3);

/** Is an opponent strike in startup/active within reach of fighter `i` (proximity guard)? */
export function proxThreat(m: Match, i: number): boolean {
  const s = m.s;
  const o = 1 - i;
  const bo = fb(o);
  if (s[bo + F.st] !== ST.ATTACK) return false;
  const k = s[bo + F.mv];
  if (k < 0) return false;
  const mv = m.cf[o].moves[k];
  if (!mv.isStrike || s[bo + F.mvF] > mv.lastActive) return false;
  // CHANGED(SIM3D): 3D distance root -> the defender's push circle edge (on the line = the old push-box edge)
  pushCircle(m, i, PC0);
  const dx = PC0[0] - s[bo + F.x];
  const dz = PC0[1] - s[bo + F.z];
  const d = isqrt(dx * dx + dz * dz) - PC0[2];
  return d <= mv.maxReach + m.sys.proxGuard;
}

/** Free grounded fighter: act from the buffer, or move by the held direction. */
export function freeTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const sys = m.sys.raw;
  autoFace(m, i);
  s[b + F.flags] &= ~(FL.AIRBORNE | FL.PROX | FL.BLOCKING);
  if (tryAct(m, i, CTX.FREE)) return;
  const dir = dirOf(s[b + F.raw], s[b + F.facing]);
  const st = s[b + F.st];
  if (dir >= 7) {
    s[b + F.jumpDir] = dir === 9 ? 1 : dir === 7 ? -1 : 0;
    s[b + F.flags] &= ~FL.CROUCHING;
    setSt(m, i, ST.PREJUMP);
    return;
  }
  if (dir <= 3) {
    if (st !== ST.CROUCH) setSt(m, i, ST.CROUCH);
    if (s[b + F.stF] >= sys.movement.crouchHurtFrame) s[b + F.flags] |= FL.CROUCHING;
    if (dir === 1 && proxGuard(m, i)) s[b + F.flags] |= FL.PROX | FL.CROUCHING;
    return;
  }
  s[b + F.flags] &= ~FL.CROUCHING;
  // CHANGED(SIM3D) (CONTRACT §35.2): a held STEP (not with back: back = block) circles; forward + STEP = the step
  const sb = stepBits(s[b + F.raw]);
  if (sb !== 0 && dir !== 4) {
    startSidestep(m, i, sb > 0);
    return;
  }
  if (dir === 6) {
    if (st !== ST.WALK_F) setSt(m, i, ST.WALK_F);
    const wf = walkPct(m, i, cf.walkF);
    const sp = s[b + F.stF] === 0 ? Math.trunc((wf * sys.movement.walkFirstFramePct) / 100) : wf;
    moveFwd(s, b, sp);
    return;
  }
  if (dir === 4) {
    if (proxGuard(m, i)) {
      if (st !== ST.IDLE) setSt(m, i, ST.IDLE);
      s[b + F.flags] |= FL.PROX;
      return;
    }
    if (st !== ST.WALK_B) setSt(m, i, ST.WALK_B);
    const wb = walkPct(m, i, cf.walkB);
    const sp = s[b + F.stF] === 0 ? Math.trunc((wb * sys.movement.walkFirstFramePct) / 100) : wb;
    moveFwd(s, b, -sp);
    return;
  }
  if (st !== ST.IDLE) setSt(m, i, ST.IDLE);
}

// ------------------------------------------------------------------ STEP_IN / STEP_OUT (CHANGED(SIM3D), CONTRACT §35.2)
/**
 * Starts a SIDESTEP: 15 frames along the circle around the opponent (distance kept), STEP_IN toward -camN (away from the
 * camera), STEP_OUT toward +camN. The circling sense is latched here (F.stepDir).
 */
export function startSidestep(m: Match, i: number, isIn: boolean): void {
  const s = m.s;
  const b = fb(i);
  s[b + F.flags] &= ~(FL.CROUCHING | FL.PROX | FL.BLOCKING);
  const ox = s[b + F.x] - OPP[2 * i];
  const oz = s[b + F.z] - OPP[2 * i + 1];
  // tangent of stepDir +1 = (-oz, ox); its side of the camera decides the sense
  let side = -oz * s[W.camNX] + ox * s[W.camNZ];
  if (side === 0) side = 1;
  const plusIsIn = side < 0; // the +1 tangent points away from the camera
  s[b + F.stepDir] = plusIsIn === isIn ? 1 : -1;
  s[b + F.stepIn] = isIn ? 1 : 0;
  setSt(m, i, ST.SIDESTEP);
  autoFace(m, i);
  // CHANGED(fix_core) D1 (CONTRACT §35.20): the fighter's own arc (step.distM from its measured body), same 15 f curve
  const cv = m.cf[i].stepCurve;
  arcMove(m, i, cv[1] - cv[0]);
  autoFace(m, i);
}

/**
 * Moves fighter i `amount` U along the circle around its opponent point (sense F.stepDir), keeping the distance (the
 * tangent step is renormalised to the start radius).
 */
function arcMove(m: Match, i: number, amount: number): void {
  if (amount === 0) return;
  const s = m.s;
  const b = fb(i);
  const px = OPP[2 * i];
  const pz = OPP[2 * i + 1];
  const ox = s[b + F.x] - px;
  const oz = s[b + F.z] - pz;
  const r = isqrt(ox * ox + oz * oz);
  const sd = s[b + F.stepDir] >= 0 ? 1 : -1;
  if (r < 1000) {
    // on top of the opponent (should not happen with push bodies): step sideways along the own right
    moveAlong(s, b, s[b + F.yaw] + (sd > 0 ? -16384 : 16384), amount);
    return;
  }
  const tx = -oz * sd;
  const tz = ox * sd;
  const nx = ox + divRound(tx * amount, r);
  const nz = oz + divRound(tz * amount, r);
  const l = isqrt(nx * nx + nz * nz);
  s[b + F.x] = px + divRound(nx * r, l);
  s[b + F.z] = pz + divRound(nz * r, l);
}

/** Is fighter i still holding the STEP button of its running step (SOCD: both = released)? */
function stepHeld(s: Int32Array, b: number): boolean {
  const sb = stepBits(s[b + F.raw]);
  return sb !== 0 && (sb > 0) === (s[b + F.stepIn] !== 0);
}

/** One SIDESTEP frame: arc travel by the step curve; actions from attackF (step-attacks); the end -> SIDEWALK or free. */
function sidestepTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const sys = m.sys;
  const k = s[b + F.stF] + 1; // step frame (1 on the entry frame)
  if (k > sys.stepFrames) {
    if (stepHeld(s, b)) {
      setSt(m, i, ST.SIDEWALK);
      sidewalkTick(m, i);
    } else enterFree(m, i);
    return;
  }
  if (k >= sys.stepAttackF && tryAct(m, i, CTX.STEP)) return;
  autoFace(m, i);
  const cv = m.cf[i].stepCurve; // CHANGED(fix_core) D1: per-fighter arc length
  arcMove(m, i, cv[k] - cv[k - 1]);
  autoFace(m, i);
}

/**
 * One SIDEWALK frame (the held STEP, CONTRACT §35.2): 1.8 m/s tangential around the opponent. Back (block), down or up
 * leave to the free state at once; releasing the STEP button = STEP_END (settle). Attacks come out from it.
 */
function sidewalkTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const dir = dirOf(s[b + F.raw], s[b + F.facing]);
  if (dir !== 5 && dir !== 6) {
    enterFree(m, i);
    return;
  }
  if (!stepHeld(s, b)) {
    setSt(m, i, ST.STEP_END);
    s[b + F.stun] = m.sys.stepSettle;
    autoFace(m, i);
    return;
  }
  if (tryAct(m, i, CTX.STEP)) return;
  autoFace(m, i);
  arcMove(m, i, walkPct(m, i, m.sys.sidewalk));
  autoFace(m, i);
}

// ------------------------------------------------------------------ moves
/** Starts move `idx` this frame (mvF = 1) and runs its first frame. */
export function startMove(m: Match, i: number, idx: number, flags: number): void {
  const s = m.s;
  const b = fb(i);
  const mv = m.cf[i].moves[idx];
  const airborne = isAirborne(s, b);
  clearMove(m, i);
  s[b + F.mv] = idx;
  s[b + F.mvF] = 1;
  s[b + F.mvInst] = (s[b + F.mvInst] + 1) | 0;
  s[b + F.mvFlags] = flags;
  s[b + F.armorLeft] = mv.armorHits;
  s[b + F.flags] &= ~(FL.PROX | FL.BLOCKING | FL.TAUNTING);
  setSt(m, i, ST.ATTACK);
  if (!airborne) {
    s[b + F.vx] = 0;
    s[b + F.vz] = 0;
    s[b + F.vy] = 0;
    s[b + F.y] = 0;
    if (mv.isNormalCat && !mv.inAir && mv.inDir <= 3) s[b + F.flags] |= FL.CROUCHING;
    else s[b + F.flags] &= ~FL.CROUCHING;
  } else if (mv.isNormalCat) {
    s[b + F.flags] |= FL.AIR_USED;
  }
  if (mv.isSuper) {
    s[W.freeze] = mv.level === 3 ? m.sys.raw.super.freeze3 : m.sys.raw.super.freeze1;
    s[W.freezeKind] = 1;
    s[W.freezeOwner] = i;
    emit(m, EV.SUPER_FREEZE, i, mv.level, 0, 0);
    emit(m, EV.CAMERA_CUE, i, CUE.SUPER_FREEZE, 0, 0);
  }
  if (mv.isImpact) emit(m, EV.IMPACT_START, i, 0, 0, 0);
  if (mv.isShove) emit(m, EV.SHOVE, i, 0, 0, 0);
  if (mv.install) {
    // CHANGED(SIM) P2 (CONTRACT §28.2 installs)
    s[b + F.instF] = mv.install.frames;
    s[b + F.instMv] = idx;
    emit(m, EVX.INSTALL, i, mv.install.frames, mv.snapId, 0);
  }
  moveTick(m, i);
}

/** CHANGED(SIM) P2: walk speed under an install (walkPct). */
function walkPct(m: Match, i: number, v: number): number {
  const s = m.s;
  const b = fb(i);
  if (s[b + F.instF] <= 0 || s[b + F.instMv] < 0) return v;
  const ins = m.cf[i].moves[s[b + F.instMv]].install;
  return ins ? Math.trunc((v * ins.walkPct) / 100) : v;
}

/** Pays the move's costs, then starts it. */
function execMove(m: Match, i: number, idx: number, flags: number): void {
  const mv = m.cf[i].moves[idx];
  if (mv.costShow > 0) addShowtime(m, i, -mv.costShow);
  if (mv.costNerve > 0) spendNerve(m, i, mv.costNerve);
  startMove(m, i, idx, flags);
}

function cancelAllowed(m: Match, i: number, cur: CMove, f: number, t: CMove, bufF: number): boolean {
  const s = m.s;
  const b = fb(i);
  if ((s[b + F.mvFlags] & MVF.NOCANCEL) !== 0) return false;
  const grace = m.sys.raw.cancel.graceAfterActive;
  const contact = s[b + F.contact] !== 0;
  const inWindow = contact ? f > s[b + F.contactF] && f <= cur.lastActive + grace : cur.cWhiff && f >= cur.startup && f <= cur.lastActive + grace;
  if (inWindow) {
    if ((bufF & BUF.CHAIN) !== 0 && cur.chains.indexOf(t.idx) >= 0) return true;
    if (t.isSpecialCat && cur.cSpecial) return true;
    if (t.isSuper && cur.cSuper) return true;
    // CHANGED(SIM) P2 (CONTRACT §28.2 armorStep): a step also cancels into the grounded "tick" normal (2L / 5L)
    const tk = m.cf[i].u.tickStr;
    if (cur.armorStep && tk >= 0 && t.isNormalCat && !t.inAir && !t.chainOnly && t.str === tk) return true;
  }
  // chord replacement: a throw / super right after a normal or one-button special started (<= 1 frame)
  if (f <= 2 && s[b + F.contact] === 0 && (cur.isNormalCat || (s[b + F.mvFlags] & MVF.SIMPLE) !== 0)) {
    if (t.isGrab && t.kind === K.throw && cur.isNormalCat) return true;
    if (t.isSuper && (s[b + F.mvFlags] & MVF.SIMPLE) !== 0) return true;
  }
  return false;
}

/**
 * Tries to execute the buffered action in context `ctx`. Returns true if the fighter started
 * something this frame (the buffer is consumed).
 */
export function tryAct(m: Match, i: number, ctx: number): boolean {
  const s = m.s;
  const b = fb(i);
  const a = s[b + F.bufA];
  if (a === ACT.NONE) return false;
  if (s[b + F.bufAge] > s[b + F.bufWin]) {
    clearBuf(s, b);
    return false;
  }
  const cf = m.cf[i];
  const bufF = s[b + F.bufF];
  const mvFlags = (bufF & BUF.SIMPLE) !== 0 ? MVF.SIMPLE : 0;
  switch (ctx) {
    case CTX.FREE:
    case CTX.STEP: {
      if (a === ACT.MOVE) {
        const t = cf.moves[s[b + F.bufM]];
        if (t.airOnly || t.chainOnly || !canAfford(m, i, t)) return false;
        if (t.stepAtk && ctx !== CTX.STEP) return false; // CHANGED(SIM3D): step-attacks only out of a step
        if (!projOk(m, i, t)) return false;
        clearBuf(s, b);
        autoFace(m, i); // CHANGED(SIM3D): a move from neutral / a step starts facing the opponent
        execMove(m, i, t.idx, mvFlags);
        return true;
      }
      if (a === ACT.PARRY) {
        if (!canNerve(m, i)) return false;
        clearBuf(s, b);
        startParry(m, i);
        return true;
      }
      if (a === ACT.DASH_F || a === ACT.DASH_B) {
        clearBuf(s, b);
        startDash(m, i, a === ACT.DASH_B);
        return true;
      }
      if (a === ACT.TAUNT) {
        clearBuf(s, b);
        setSt(m, i, ST.TAUNT);
        s[b + F.flags] |= FL.TAUNTING;
        emit(m, EV.TAUNT, i, 0, 0, 0);
        return true;
      }
      if (a === ACT.ROUTE && cf.assist.length > 0) {
        clearBuf(s, b);
        s[b + F.assistStep] = 0;
        autoFace(m, i);
        execMove(m, i, cf.assist[0], MVF.ROUTE);
        return true;
      }
      if (a === ACT.STEP && ctx === CTX.FREE) {
        // CHANGED(SIM3D): a buffered STEP tap (from a step the next one waits until the running one ends)
        const isIn = s[b + F.bufM] === 1;
        clearBuf(s, b);
        startSidestep(m, i, isIn);
        return true;
      }
      return false;
    }
    case CTX.CANCEL: {
      const cur = cf.moves[s[b + F.mv]];
      const f = s[b + F.mvF];
      if (a === ACT.ROUTE) {
        const k = s[b + F.assistStep];
        if ((s[b + F.mvFlags] & MVF.ROUTE) === 0 || k + 1 >= cf.assist.length) return false;
        if (cf.assist[k] !== cur.idx || s[b + F.contact] === 0) return false;
        if ((s[b + F.mvFlags] & MVF.NOCANCEL) !== 0) return false;
        if (f <= s[b + F.contactF] || f > cur.lastActive + m.sys.raw.cancel.graceAfterActive) return false;
        const t = cf.moves[cf.assist[k + 1]];
        if (!canAfford(m, i, t)) return false;
        clearBuf(s, b);
        s[b + F.assistStep] = k + 1;
        execMove(m, i, t.idx, MVF.ROUTE);
        return true;
      }
      if (a === ACT.PARRY) {
        if (f <= 2 && s[b + F.contact] === 0 && cur.isNormalCat && canNerve(m, i) && !isAirborne(s, b)) {
          clearBuf(s, b);
          clearMove(m, i);
          startParry(m, i);
          return true;
        }
        return false;
      }
      if (a !== ACT.MOVE) return false;
      const t = cf.moves[s[b + F.bufM]];
      if (isAirborne(s, b) ? !t.usableAir : t.airOnly) return false;
      if (!canAfford(m, i, t)) return false;
      if (!projOk(m, i, t)) return false;
      if (!cancelAllowed(m, i, cur, f, t, bufF)) return false;
      clearBuf(s, b);
      // CHANGED(SIM) P2: a teleport cancelled after its jump re-faces the opponent first (EX vanish -> special)
      if (cur.teleport && f >= cur.teleport.f) autoFace(m, i);
      execMove(m, i, t.idx, mvFlags | (s[b + F.mvFlags] & MVF.RUSH));
      return true;
    }
    case CTX.AIR: {
      if (a !== ACT.MOVE) return false;
      const t = cf.moves[s[b + F.bufM]];
      if (!(t.inAir || t.usableAir) || !canAfford(m, i, t)) return false;
      if (t.isNormalCat && (s[b + F.flags] & FL.AIR_USED) !== 0) return false;
      if (!projOk(m, i, t)) return false;
      clearBuf(s, b);
      execMove(m, i, t.idx, mvFlags);
      return true;
    }
    case CTX.PREJUMP: {
      if (a !== ACT.MOVE) return false;
      const t = cf.moves[s[b + F.bufM]];
      if (t.airOnly || !prejumpCancelable(t) || !canAfford(m, i, t)) return false;
      if (!projOk(m, i, t)) return false;
      clearBuf(s, b);
      execMove(m, i, t.idx, mvFlags);
      return true;
    }
    case CTX.BLOCKSTUN: {
      if (a !== ACT.PARRY || !canNerve(m, i)) return false;
      clearBuf(s, b);
      s[b + F.stun] = 0;
      execMove(m, i, cf.shove, 0);
      return true;
    }
    case CTX.PARRY: {
      if (a !== ACT.DASH_F || !canNerve(m, i)) return false;
      clearBuf(s, b);
      spendNerve(m, i, m.sys.raw.nerve.rushCost);
      setSt(m, i, ST.RUSH);
      s[b + F.rushF] = 0;
      return true;
    }
    case CTX.RUSH: {
      if (a !== ACT.MOVE) return false;
      const t = cf.moves[s[b + F.bufM]];
      if (t.airOnly || !(t.isNormalCat || t.kind === K.throw)) return false;
      clearBuf(s, b);
      execMove(m, i, t.idx, mvFlags | MVF.RUSH);
      return true;
    }
    case CTX.STANCE: {
      // CHANGED(SIM) P2 (CONTRACT §28.2 stance): follow-ups at once; specials / supers / throws / IMPACT / PARRY leave it
      if (a === ACT.PARRY) {
        if (!canNerve(m, i)) return false;
        clearBuf(s, b);
        startParry(m, i);
        return true;
      }
      if (a !== ACT.MOVE) return false;
      const t = cf.moves[s[b + F.bufM]];
      const follow = (bufF & BUF.STANCE) !== 0 && t.stanceKind === STK.FOLLOW;
      if (!follow && (t.chainOnly || t.airOnly || !(t.isSpecialCat || t.isSuper || t.isGrab || t.isImpact))) return false;
      if (!canAfford(m, i, t) || !projOk(m, i, t)) return false;
      clearBuf(s, b);
      execMove(m, i, t.idx, mvFlags);
      return true;
    }
    default:
      return false;
  }
}

/** One frame of the running move (mvF already advanced). */
export function moveTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const mv = cf.moves[s[b + F.mv]];
  const f = s[b + F.mvF];
  const diving = mv.hasAirVel && f >= mv.startup && isAirborne(s, b) && !mv.yCurve;
  if (f > mv.total && !diving) {
    finishMove(m, i);
    return;
  }
  if (s[b + F.bufA] !== ACT.NONE && tryAct(m, i, CTX.CANCEL)) return;
  // CHANGED(SIM3D) (CONTRACT §35.4): tracking - frames 1..trackUntil re-face the opponent (homing: through the active
  // frames; linear: frame 1 only), at most trackRate per frame; later frames keep the yaw (a step off the line whiffs)
  if (f <= mv.trackUntil) trackOpp(m, i, mv.trackRate);
  if (mv.yCurve) {
    // scripted root height (moveY): airborne while above the floor, never ballistic
    const fy = f < mv.yCurve.length ? f : mv.yCurve.length - 1;
    s[b + F.y] = mv.yCurve[fy];
    if (s[b + F.y] > 0) s[b + F.flags] = (s[b + F.flags] | FL.AIRBORNE) & ~FL.CROUCHING;
    else s[b + F.flags] &= ~FL.AIRBORNE;
    const d = mv.curve[f] - mv.curve[f - 1];
    if (d !== 0) moveFwd(s, b, d);
  } else if (isAirborne(s, b)) {
    if (mv.hasAirVel && f >= mv.startup) {
      // dive: constant airVel along the forward from startup until landing, then `recovery` landing frames
      if (f === mv.startup) {
        setVelAlong(s, b, s[b + F.yaw], mv.airVelX);
        s[b + F.vy] = mv.airVelY;
      }
      s[b + F.x] += s[b + F.vx];
      s[b + F.z] += s[b + F.vz];
      s[b + F.y] += s[b + F.vy];
      if (s[b + F.y] <= 0) {
        s[b + F.y] = 0;
        land(m, i);
        s[b + F.stun] = Math.max(1, mv.recovery);
        return;
      }
    } else if (airStep(s, b, cf.g)) {
      land(m, i);
      return;
    }
  } else {
    const d = mv.curve[f] - mv.curve[f - 1];
    if (d !== 0) moveFwd(s, b, d);
  }
  if (mv.proj && f === mv.startup && (s[b + F.mvFlags] & MVF.SPAWNED) === 0) {
    s[b + F.mvFlags] |= MVF.SPAWNED;
    // CHANGED(SIM) P2: ball moves kick / flick / re-kick the one ball (CONTRACT §28.2 ball)
    if (mv.ballAct === BACT.SHOOT || mv.ballAct === BACT.HOVER) ballLaunch(m, i, mv);
    else spawnProjectile(m, i, mv);
  }
  if (mv.teleport && f === mv.teleport.f) teleport(m, i, mv);
  for (let k = 0; k < mv.sfxF.length; k++) if (mv.sfxF[k] === f) emit(m, EV.SFX_CUE, i, mv.sfxI[k], mv.snapId, 0);
  if (f === mv.lastActive + 1 && s[b + F.contact] === 0 && (mv.isStrike || mv.isGrab) && (s[b + F.mvFlags] & MVF.WHIFFED) === 0) {
    s[b + F.mvFlags] |= MVF.WHIFFED;
    emit(m, EV.WHIFF, i, 1 - i, mv.sc, 0);
  }
}

function finishMove(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const k = s[b + F.mv];
  if (k >= 0 && m.cf[i].moves[k].yCurve) {
    s[b + F.y] = 0;
    s[b + F.flags] &= ~FL.AIRBORNE;
  }
  const enterStance = k >= 0 && m.cf[i].uk === UK.STANCE && m.cf[i].moves[k].stanceKind === STK.ENTER;
  clearMove(m, i);
  if (isAirborne(s, b)) {
    setSt(m, i, ST.AIR);
    return;
  }
  if (s[b + F.after] > 0 && s[b + F.st] === ST.ATTACK) {
    // CHANGED(SIM) P2 (CONTRACT §28.5d): the thrower of a grab-less throw holds while its victim lies (lying hold)
    const h = s[b + F.after];
    s[b + F.after] = 0;
    setSt(m, i, ST.RECOVER);
    s[b + F.stun] = h;
    return;
  }
  if (enterStance) {
    // CHANGED(SIM) P2 (CONTRACT §28.2 stance): the enter move put the fighter in the stance
    s[b + F.flags] &= ~(FL.CROUCHING | FL.PROX | FL.BLOCKING);
    s[b + F.uniq] = 1;
    s[b + F.uniq + 1] = 0;
    s[b + F.uniq + 2] = m.cf[i].u.stMaxF;
    s[b + F.uniq + 3] = 0;
    s[b + F.assistStep] = 0;
    s[b + F.ucnt] = 0;
    setSt(m, i, ST.STANCE);
    stanceTick(m, i);
    return;
  }
  enterFree(m, i);
}

// ------------------------------------------------------------------ uniques (CHANGED(SIM) P2, CONTRACT §28.2)
/**
 * One frame in STANCE: buffered follow-ups / specials first, then down = exit, maxF = timeout exit, holding back walks
 * back and leaves after blockExitF frames, forward walks. uniq: u1 frames in stance, u3 anim (0 idle 1 walk_f 2 walk_b);
 * F.assistStep counts the back-hold frames while in the stance (unused by assist routes there).
 */
function stanceTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const u = m.cf[i].u;
  s[b + F.uniq + 1]++;
  if (tryAct(m, i, CTX.STANCE)) return;
  const dir = dirOf(s[b + F.raw], s[b + F.facing]);
  const down = dir === 1 || dir === 2 || dir === 3;
  // down held stExitHoldF frames exits (a motion special rolls through down faster and starts from the stance instead)
  s[b + F.ucnt] = down ? s[b + F.ucnt] + 1 : 0;
  if (down && s[b + F.ucnt] >= u.stExitHoldF && u.stExit2 >= 0) {
    s[b + F.ucnt] = 0;
    startMove(m, i, u.stExit2, 0);
    return;
  }
  if (down) return;
  if (s[b + F.uniq + 1] >= u.stMaxF && u.stExitT >= 0) {
    startMove(m, i, u.stExitT, 0);
    return;
  }
  if (dir === 4) {
    s[b + F.assistStep]++;
    if (s[b + F.assistStep] >= u.stBlockExitF) {
      s[b + F.assistStep] = 0;
      enterFree(m, i);
      return;
    }
    moveFwd(s, b, -u.stWalkB);
    s[b + F.uniq + 3] = 2;
    return;
  }
  s[b + F.assistStep] = 0;
  if (dir === 6) {
    moveFwd(s, b, u.stWalkF);
    s[b + F.uniq + 3] = 1;
    return;
  }
  s[b + F.uniq + 3] = 0;
}

/**
 * Teleport on the move's teleport frame (CONTRACT §20.2 / §28.2, CHANGED(SIM3D)): along the line from him to the
 * opponent - behind = opponent + u * gap (the far side), front = opponent - u * gap, home = the ring boundary behind him
 * (seen from the opponent) moved gap inward; clamped to the ring.
 */
function teleport(m: Match, i: number, mv: CMove): void {
  const s = m.s;
  const b = fb(i);
  const tp = mv.teleport;
  if (!tp) return;
  const x0 = s[b + F.x];
  const z0 = s[b + F.z];
  const ox = OPP[2 * i];
  const oz = OPP[2 * i + 1];
  const yaw = ox === x0 && oz === z0 ? s[b + F.yaw] : dirToYaw(ox - x0, oz - z0);
  const ux = sinQ(yaw);
  const uz = cosQ(yaw);
  let nx = x0;
  let nz = z0;
  if (tp.to === TPD.BEHIND) {
    alongYaw(tp.gap, yaw, AY);
    nx = ox + AY[0];
    nz = oz + AY[1];
  } else if (tp.to === TPD.FRONT) {
    alongYaw(tp.gap, yaw, AY);
    nx = ox - AY[0];
    nz = oz - AY[1];
  } else {
    // home: from the opponent back through me to the wall, then gap inward
    const t = ringRay(m.ring, ox, oz, -ux, -uz);
    const d = Math.max(0, t - tp.gap);
    alongYaw(d, yaw, AY);
    nx = ox - AY[0];
    nz = oz - AY[1];
  }
  s[b + F.x] = nx;
  s[b + F.z] = nz;
  clampToRing(m, i);
  // CHANGED(fix_core) D8 (CONTRACT §35.20): arrive FACING the opponent (its start-of-frame point, like every auto-face): a
  // behind teleport used to keep the old yaw - his back to the opponent for the rest of the move (vanish_l 23 frames) and
  // then a 180-degree snap in the free state. The input-mapping sign follows the yaw (it is set where the yaw is set). The
  // opponent is untouched here: it re-faces him by its own auto-face (next frame, from his new start-of-frame position).
  autoFace(m, i);
  s[b + F.pushF] = 0;
  s[b + F.pushLeft] = 0;
  if (m.cf[i].uk === UK.TELEPORT) s[b + F.uniq]++;
  emit(m, EVX.TELEPORT, i, Math.trunc(x0 / 1000), Math.trunc(s[b + F.x] / 1000), tp.to);
}

// ------------------------------------------------------------------ movement helpers
/** One ballistic step (x += vx; z += vz; y += vy; vy -= g). Returns true when the fighter touched down. */
export function airStep(s: Int32Array, b: number, g: number): boolean {
  s[b + F.x] += s[b + F.vx];
  s[b + F.z] += s[b + F.vz];
  s[b + F.y] += s[b + F.vy];
  s[b + F.vy] -= g;
  if (s[b + F.y] <= 0 && s[b + F.vy] < 0) {
    s[b + F.y] = 0;
    return true;
  }
  return false;
}

/** Landing from a jump or an air move: jump.landing frames of recovery. */
function land(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  clearMove(m, i);
  s[b + F.flags] &= ~(FL.AIRBORNE | FL.AIR_USED);
  s[b + F.y] = 0;
  s[b + F.vx] = 0;
  s[b + F.vz] = 0;
  s[b + F.vy] = 0;
  setSt(m, i, ST.LAND);
  s[b + F.stun] = Math.max(1, m.cf[i].landing);
}

function takeoff(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  setSt(m, i, ST.AIR);
  s[b + F.flags] = (s[b + F.flags] | FL.AIRBORNE) & ~(FL.AIR_USED | FL.CROUCHING);
  const jd = s[b + F.jumpDir];
  // CHANGED(SIM3D): the jump arc runs along the line to the opponent (the yaw the prejump faced)
  setVelAlong(s, b, s[b + F.yaw], jd * (jd >= 0 ? cf.vxF : cf.vxB));
  s[b + F.vy] = cf.vy0;
  if (airStep(s, b, cf.g)) land(m, i);
}

function startDash(m: Match, i: number, back: boolean): void {
  const s = m.s;
  const b = fb(i);
  s[b + F.flags] &= ~FL.CROUCHING;
  setSt(m, i, back ? ST.DASH_B : ST.DASH_F);
  dashMove(m, i, 1);
}

function dashMove(m: Match, i: number, k: number): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const back = s[b + F.st] === ST.DASH_B;
  const c = back ? cf.dashB : cf.dashF;
  const d = c[k] - c[k - 1];
  autoFace(m, i); // CHANGED(SIM3D): dashes run along the line to the opponent (auto-face every frame)
  moveFwd(s, b, (back ? -1 : 1) * d);
}

function startParry(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  clearMove(m, i);
  setSt(m, i, ST.PARRY);
  s[b + F.parryF] = 1;
  s[b + F.parryOk] = 0;
  s[b + F.flags] &= ~FL.CROUCHING;
}

function endParry(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const p = m.sys.raw.parry;
  setSt(m, i, ST.PARRY_REC);
  s[b + F.stun] = p.recovery;
  s[b + F.nerveCd] = s[b + F.parryOk] !== 0 ? m.sys.raw.nerve.spendCooldown : m.sys.raw.nerve.whiffParryCooldown;
}

function parryTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const p = m.sys.raw.parry;
  const f = ++s[b + F.parryF];
  if (f === p.costStartFrame) spendNerve(m, i, p.costStart);
  else if (f >= p.drainFromFrame) spendNerve(m, i, p.drainPerFrame);
  if (s[b + F.fright] !== 0) {
    endParry(m, i);
    return;
  }
  if (tryAct(m, i, CTX.PARRY)) return;
  const raw = s[b + F.raw];
  const held = (raw & IN.PARRY) !== 0 || ((raw & IN.M) !== 0 && (raw & IN.H) !== 0);
  if (!held && f >= p.active) endParry(m, i);
}

function rushTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const r = m.sys.raw.rush;
  const f = ++s[b + F.rushF];
  if (f >= r.startup && tryAct(m, i, CTX.RUSH)) return;
  if (f > r.frames) {
    setSt(m, i, ST.RECOVER);
    s[b + F.stun] = r.recovery;
    return;
  }
  moveFwd(s, b, m.sys.rushSpeed);
}

const JC = new Int32Array(3);
const JR = new Int32Array(2);

function juggleTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const sys = m.sys.raw;
  const landed = airStep(s, b, m.sys.gJuggle);
  if (!landed) {
    // CHANGED(SIM3D) (CONTRACT §35.2): a launched body reaching the ring boundary = WALL_SPLAT (once per combo), else it
    // slides along the wall
    pushCircle(m, i, JC);
    if (ringGap(m.ring, JC[0], JC[1], JC[2]) < 0) {
      const vx = s[b + F.vx];
      const vz = s[b + F.vz];
      if ((s[b + F.cFlags] & CF.SPLAT) === 0 && (vx !== 0 || vz !== 0)) {
        wallSplat(m, 1 - i, i, dirToYaw(vx, vz));
        return;
      }
      ringClamp(m.ring, JC[0], JC[1], JC[2], JR);
      s[b + F.x] += JR[0] - JC[0];
      s[b + F.z] += JR[1] - JC[1];
      s[b + F.vx] = 0;
      s[b + F.vz] = 0;
    }
    return;
  }
  if (s[b + F.bounce] !== 0) {
    s[b + F.bounce] = 0;
    s[b + F.vy] = m.sys.bounceVy;
    s[b + F.vx] = Math.trunc(s[b + F.vx] / 2);
    s[b + F.vz] = Math.trunc(s[b + F.vz] / 2);
    emit(m, EV.GROUND_BOUNCE, i, 0, 0, 0);
    return;
  }
  s[b + F.flags] &= ~FL.AIRBORNE;
  s[b + F.vx] = 0;
  s[b + F.vz] = 0;
  s[b + F.vy] = 0;
  if (s[b + F.kd] === 0) {
    setSt(m, i, ST.LAND);
    s[b + F.stun] = sys.kd.airResetLand;
    return;
  }
  setSt(m, i, ST.KNOCKDOWN);
  s[b + F.stun] = s[b + F.kd] === 2 ? sys.kd.hardLandTotal : sys.kd.softLandTotal;
  s[b + F.tot] = s[b + F.stun]; // CHANGED(fixer) D3: KD presentation (throwpose.ts): a juggle LANDS (floor-impact part)
  s[b + F.kdFace] = KDF.LANDED;
  s[b + F.wake] = 0;
  emit(m, EV.KNOCKDOWN, i, s[b + F.kd], 0, 0);
}

/** Enters a grounded knockdown for `total` frames (fall + lying + wakeup). */
export function enterKnockdown(m: Match, i: number, total: number, kind: number): void {
  const s = m.s;
  const b = fb(i);
  clearMove(m, i);
  s[b + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING);
  s[b + F.y] = 0;
  s[b + F.vx] = 0;
  s[b + F.vz] = 0;
  s[b + F.vy] = 0;
  setSt(m, i, ST.KNOCKDOWN);
  s[b + F.stun] = Math.max(1, total);
  s[b + F.tot] = s[b + F.stun]; // CHANGED(fixer) D3: KD presentation (throwpose.ts); callers may set F.kdFace after
  s[b + F.kdFace] = 0;
  s[b + F.kd] = kind;
  s[b + F.wake] = 0;
  emit(m, EV.KNOCKDOWN, i, kind, 0, 0);
}

function kdTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const sys = m.sys.raw;
  const wf = sys.kd.wakeupFrames;
  s[b + F.stun]--;
  const left = s[b + F.stun];
  if ((s[b + F.wake] & 2) === 0 && left <= wf) {
    const raw = s[b + F.raw];
    const n = ((raw & IN.L) !== 0 ? 1 : 0) + ((raw & IN.M) !== 0 ? 1 : 0) + ((raw & IN.H) !== 0 ? 1 : 0) + ((raw & IN.S) !== 0 ? 1 : 0);
    const back = s[b + F.kd] !== 2 && n >= 2 ? 1 : 0;
    s[b + F.wake] = 2 | back;
    emit(m, EV.WAKEUP, i, back, 0, 0);
  }
  // CHANGED(fixer) D3: back rise = away from the opponent; CHANGED(SIM3D): along the line from the opponent
  if ((s[b + F.wake] & 1) !== 0 && left < wf) {
    const away = (yawToOpp(m, i) + YAW_HALF) & 65535;
    moveAlong(s, b, away, Math.trunc(m.sys.backRise / wf));
  }
  if (left <= 0) {
    s[b + F.invT] = Math.max(s[b + F.invT], sys.throw.wakeupInvuln);
    enterFree(m, i);
  }
}

const VP = new Int32Array(6);
const HP = new Int32Array(3);

/**
 * CHANGED(fixer) D3: the throw carry - the victim follows its lock segments' clip root travel (throwpose.ts) from the
 * anchor at the connect frame. CHANGED(SIM3D) (CONTRACT §35.4): along the THROWER's yaw at the connect (victim forward =
 * -dir(thrower yaw)), clamped to the ring. Runs every lock frame.
 * CHANGED(fix_core) D4 (CONTRACT §35.20): throwpose.ts holdPos - the anchor slides onto the HOLD point (push fronts touching,
 * on the thrower's forward line) over throw.pullF frames, or the victim follows the grab's root path (grab supers: hugged,
 * spun, lifted - F.y carries the lift) instead of standing where the grab caught it.
 */
function throwCarry(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  if (!victimPose(m, i, VP)) return;
  const tot = Math.max(1, s[b + F.tot]);
  holdPos(m, i, Math.max(0, Math.min(tot, tot - s[b + F.stun])), VP[3], HP);
  s[b + F.x] = HP[0];
  s[b + F.z] = HP[1];
  s[b + F.y] = HP[2];
  clampToRing(m, i);
}

/**
 * Throw lock over for the victim: knockdown remainder. CHANGED(fixer) D3: no teleport - the carry already put the victim
 * where its clip landed (behind the thrower on a side swap); the victim keeps its facing while it lies (its body lies the
 * way the clip threw it; the free state re-faces it after the wake-up); face-down endings lie / rise face down; the
 * victim is already on the floor, so the knockdown shows no fall.
 */
function throwRelease(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const lastClip = victimPose(m, i, VP) ? VP[5] : -1;
  throwCarry(m, i);
  const kd = s[b + F.kd] || 1;
  // CHANGED(SIM) P2 (CONTRACT §28.5d): an early release hands its lock frames to the knockdown (same advantage)
  const early = Math.max(0, s[b + F.stun]);
  s[b + F.thrRel] = 0;
  enterKnockdown(m, i, Math.max(s[b + F.after], 1) + early, kd);
  s[b + F.kdFace] = KDF.NOFALL | (lastClip >= 0 && endsFaceDown(lastClip) ? KDF.DOWN : 0);
}

// ------------------------------------------------------------------ pushback
const AP = new Int32Array(3);
const AR = new Int32Array(2);

/**
 * CHANGED(SIM3D): the pending pushback moves the fighter along F.pushYaw (F.pushLeft >= 0 U over F.pushF frames). The
 * part the ring blocks (the defender against the wall) transfers to the opponent (melee hits, FL.PUSHX) - pushed back
 * along the same direction.
 */
function applyPush(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const pf = s[b + F.pushF];
  if (pf <= 0) return;
  const amt = Math.trunc(s[b + F.pushLeft] / pf);
  s[b + F.pushLeft] -= amt;
  s[b + F.pushF] = pf - 1;
  const yaw = s[b + F.pushYaw];
  const ux = sinQ(yaw);
  const uz = cosQ(yaw);
  let excess = 0;
  if (amt !== 0) {
    pushCircle(m, i, AP);
    const wantX = AP[0] + mulQ(amt, ux);
    const wantZ = AP[1] + mulQ(amt, uz);
    if (ringClamp(m.ring, wantX, wantZ, AP[2], AR)) {
      // how much of the push the wall ate (along the push direction)
      excess = Math.max(0, divRound((wantX - AR[0]) * ux + (wantZ - AR[1]) * uz, Q));
    }
    s[b + F.x] += AR[0] - AP[0];
    s[b + F.z] += AR[1] - AP[1];
  }
  if (excess > 0 && (s[b + F.flags] & FL.PUSHX) !== 0) {
    const o = 1 - i;
    const bo = fb(o);
    const ost = s[bo + F.st];
    if (!isAirborne(s, bo) && ost !== ST.THROWN && ost !== ST.KNOCKDOWN && ost !== ST.ABSENT) {
      moveAlong(s, bo, yaw, -excess);
      clampToRing(m, o);
    }
  }
  if (s[b + F.pushF] === 0) {
    s[b + F.pushLeft] = 0;
    s[b + F.flags] &= ~FL.PUSHX;
  }
}

// ------------------------------------------------------------------ the per-frame update
export function fighterUpdate(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  if (s[b + F.invS] > 0) s[b + F.invS]--;
  if (s[b + F.invT] > 0) s[b + F.invT]--;
  if (s[b + F.invP] > 0) s[b + F.invP]--;
  if (s[b + F.instF] > 0 && --s[b + F.instF] === 0) s[b + F.instMv] = -1; // CHANGED(SIM) P2: install timer
  s[b + F.stF]++;
  const st = s[b + F.st];
  switch (st) {
    case ST.ABSENT:
      return; // CHANGED(SIM) P2: bonus rounds
    case ST.STANCE:
      stanceTick(m, i); // CHANGED(SIM) P2
      break;
    case ST.IDLE:
    case ST.CROUCH:
    case ST.WALK_F:
    case ST.WALK_B:
      freeTick(m, i);
      break;
    case ST.SIDESTEP:
      sidestepTick(m, i); // CHANGED(SIM3D)
      break;
    case ST.SIDEWALK:
      sidewalkTick(m, i); // CHANGED(SIM3D)
      break;
    case ST.STEP_END:
      autoFace(m, i);
      if (--s[b + F.stun] <= 0) enterFree(m, i);
      break;
    case ST.PREJUMP:
      if (tryAct(m, i, CTX.PREJUMP)) break;
      if (s[b + F.stF] >= cf.prejump) takeoff(m, i);
      break;
    case ST.AIR:
      if (tryAct(m, i, CTX.AIR)) break;
      if (airStep(s, b, cf.g)) land(m, i);
      break;
    case ST.LAND:
      autoFace(m, i); // CHANGED(SIM3D): landing is a neutral state (CONTRACT §35.2)
      if (--s[b + F.stun] <= 0) enterFree(m, i);
      break;
    case ST.TECH:
    case ST.PARRY_REC:
    case ST.RECOVER:
    case ST.DIZZY:
      if (--s[b + F.stun] <= 0) enterFree(m, i);
      break;
    case ST.DASH_F:
    case ST.DASH_B: {
      const k = s[b + F.stF] + 1;
      const frames = st === ST.DASH_F ? cf.dashFFrames : cf.dashBFrames;
      if (k > frames) enterFree(m, i);
      else dashMove(m, i, k);
      break;
    }
    case ST.ATTACK:
      s[b + F.mvF]++;
      moveTick(m, i);
      break;
    case ST.HITSTUN:
      if (--s[b + F.stun] <= 0) {
        s[b + F.invT] = Math.max(s[b + F.invT], m.sys.raw.throw.postStunInvuln);
        enterFree(m, i);
      }
      break;
    case ST.BLOCKSTUN:
      if (tryAct(m, i, CTX.BLOCKSTUN)) break;
      if (--s[b + F.stun] <= 0) {
        s[b + F.invT] = Math.max(s[b + F.invT], m.sys.raw.throw.postStunInvuln);
        enterFree(m, i);
      }
      break;
    case ST.JUGGLE:
      juggleTick(m, i);
      break;
    case ST.KNOCKDOWN:
      kdTick(m, i);
      break;
    case ST.THROWN:
      if (s[b + F.techWin] > 0) s[b + F.techWin]--;
      // CHANGED(fixer) D3: the carry every lock frame; CHANGED(SIM) P2: release early by F.thrRel frames (§28.5d)
      if (--s[b + F.stun] <= s[b + F.thrRel] && s[b + F.techWin] <= 0) throwRelease(m, i);
      else throwCarry(m, i);
      break;
    case ST.PARRY:
      parryTick(m, i);
      break;
    case ST.CRUMPLE:
      if (--s[b + F.stun] <= 0) {
        enterKnockdown(m, i, m.sys.raw.kd.softLandTotal, 1);
        s[b + F.kdFace] = KDF.NOFALL | KDF.DOWN; // CHANGED(fixer) D3: the crumple clip already put the body face down
      }
      break;
    case ST.WALL_SPLAT:
      if (--s[b + F.stun] <= 0) enterKnockdown(m, i, m.sys.raw.wallSplat.fallTotal, 1);
      break;
    case ST.RUSH:
      rushTick(m, i);
      break;
    case ST.GRAB:
      if (--s[b + F.stun] <= 0) {
        // CHANGED(SIM3D): no facing flip after a side-swap grab - the free state auto-faces the victim behind him
        s[b + F.flags] &= ~FL.THROWING;
        enterFree(m, i);
      }
      break;
    case ST.TAUNT:
      if (s[b + F.stF] >= cf.tauntFrames) enterFree(m, i);
      break;
    case ST.KO:
      if (isAirborne(s, b) && airStep(s, b, m.sys.gJuggle)) {
        s[b + F.flags] &= ~FL.AIRBORNE;
        s[b + F.vx] = 0;
        s[b + F.vz] = 0;
        s[b + F.vy] = 0;
      }
      break;
    default:
      break;
  }
  applyPush(m, i);
  if (s[b + F.bufA] !== ACT.NONE) {
    s[b + F.bufAge]++;
    if (s[b + F.bufAge] > s[b + F.bufWin]) clearBuf(s, b);
  }
  if (isFreeStateNow(s, b)) s[b + F.neutralF]++;
  else s[b + F.neutralF] = 0;
}

function isFreeStateNow(s: Int32Array, b: number): boolean {
  const st = s[b + F.st];
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}

/** Drops a buffered action whose button was released during a world freeze (hold-to-buffer rule). */
export function freezeBufferRule(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  if (s[b + F.bufA] !== ACT.MOVE || (s[b + F.bufF] & BUF.FROZEN) === 0 || (s[b + F.bufF] & BUF.NEG) !== 0) return;
  if ((s[b + F.raw] & (IN.L | IN.M | IN.H | IN.S)) === 0) clearBuf(s, b);
}

export { curDir };
