// HIT PARADE — per-fighter state machine (CONTRACT §4.3 items 1, 2, 5, 8, 9, 10).
// One call of fighterUpdate() = one non-frozen frame of that fighter. Hitstop / world freeze
// frames never reach it (match.ts skips them), so timers, buffers and anim frames do not age then.
//
// Frame conventions (SF6, FIGHTING_DESIGN §1b): a move started on frame t has mvF = 1 on t;
// startup counts the first active frame; the move ends after mvF = startup + active + recovery - 1
// and the fighter acts again on the next frame. Hitstun / blockstun / knockdown = frames from the
// hit frame until the defender can act, so on-hit advantage = stun - (active + recovery).

import { ACT, BUF, F, FL, MVF, ST, W } from './layout.ts';
import { EV, CUE, EVX } from './events.ts';
import { BACT, K, STK, TPD, UK } from './compile.ts';
import type { CMove } from './compile.ts';
import { IN, curDir, dirOf, prejumpCancelable, projOk } from './inputs.ts';
import {
  addShowtime, canAfford, canNerve, clearMove, emit, fb, isAirborne, setSt, spendNerve,
} from './state.ts';
import type { Match } from './state.ts';
import { ballLaunch, spawnProjectile } from './projectiles.ts';
import { clampToWalls, pushExt, wallLimitX } from './boxes.ts';
import { KDF, endsFaceDown, victimPose } from './throwpose.ts';

export const CTX = { FREE: 0, CANCEL: 1, AIR: 2, PREJUMP: 3, BLOCKSTUN: 4, PARRY: 5, RUSH: 6, STANCE: 7 } as const;

function clearBuf(s: Int32Array, b: number): void {
  s[b + F.bufA] = ACT.NONE;
  s[b + F.bufM] = -1;
  s[b + F.bufAge] = 0;
  s[b + F.bufF] = 0;
}

// ------------------------------------------------------------------ entry points to states
/** The fighter becomes actionable on the ground this frame (and may act on it). */
export function enterFree(m: Match, i: number, oppX: number): void {
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
  s[b + F.vy] = 0;
  setSt(m, i, ST.IDLE);
  freeTick(m, i, oppX);
}

function faceOpponent(s: Int32Array, b: number, oppX: number): void {
  const dx = oppX - s[b + F.x];
  if (dx > 0) s[b + F.facing] = 1;
  else if (dx < 0) s[b + F.facing] = -1;
}

/**
 * Proximity-guard threat per fighter, computed from START-of-frame state by match.ts before either
 * fighter updates (so slot order never matters). Scratch, rewritten every frame.
 */
export const PROX_THREAT = new Int32Array(2);

function proxGuard(m: Match, i: number): boolean {
  return PROX_THREAT[i] !== 0;
}

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
  const dx = Math.abs(s[bo + F.x] - s[fb(i) + F.x]);
  // CHANGED(fixer) D2: the defender's push-box edge toward the attacker (asymmetric boxes)
  return dx <= mv.maxReach + m.sys.proxGuard + pushExt(m, i, s[bo + F.x] >= s[fb(i) + F.x] ? 1 : -1);
}

/** Free grounded fighter: act from the buffer, or move by the held direction. */
export function freeTick(m: Match, i: number, oppX: number): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const sys = m.sys.raw;
  faceOpponent(s, b, oppX);
  s[b + F.flags] &= ~(FL.AIRBORNE | FL.PROX | FL.BLOCKING);
  if (tryAct(m, i, CTX.FREE, oppX)) return;
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
  if (dir === 6) {
    if (st !== ST.WALK_F) setSt(m, i, ST.WALK_F);
    const wf = walkPct(m, i, cf.walkF);
    const sp = s[b + F.stF] === 0 ? Math.trunc((wf * sys.movement.walkFirstFramePct) / 100) : wf;
    s[b + F.x] += s[b + F.facing] * sp;
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
    s[b + F.x] -= s[b + F.facing] * sp;
    return;
  }
  if (st !== ST.IDLE) setSt(m, i, ST.IDLE);
}

// ------------------------------------------------------------------ moves
/** Starts move `idx` this frame (mvF = 1) and runs its first frame. */
export function startMove(m: Match, i: number, idx: number, flags: number, oppX: number): void {
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
  moveTick(m, i, oppX);
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
function execMove(m: Match, i: number, idx: number, flags: number, oppX: number): void {
  const mv = m.cf[i].moves[idx];
  if (mv.costShow > 0) addShowtime(m, i, -mv.costShow);
  if (mv.costNerve > 0) spendNerve(m, i, mv.costNerve);
  startMove(m, i, idx, flags, oppX);
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
export function tryAct(m: Match, i: number, ctx: number, oppX: number): boolean {
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
    case CTX.FREE: {
      if (a === ACT.MOVE) {
        const t = cf.moves[s[b + F.bufM]];
        if (t.airOnly || t.chainOnly || !canAfford(m, i, t)) return false;
        if (!projOk(m, i, t)) return false;
        clearBuf(s, b);
        execMove(m, i, t.idx, mvFlags, oppX);
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
        execMove(m, i, cf.assist[0], MVF.ROUTE, oppX);
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
        execMove(m, i, t.idx, MVF.ROUTE, oppX);
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
      if (cur.teleport && f >= cur.teleport.f) faceOpponent(s, b, oppX);
      execMove(m, i, t.idx, mvFlags | (s[b + F.mvFlags] & MVF.RUSH), oppX);
      return true;
    }
    case CTX.AIR: {
      if (a !== ACT.MOVE) return false;
      const t = cf.moves[s[b + F.bufM]];
      if (!(t.inAir || t.usableAir) || !canAfford(m, i, t)) return false;
      if (t.isNormalCat && (s[b + F.flags] & FL.AIR_USED) !== 0) return false;
      if (!projOk(m, i, t)) return false;
      clearBuf(s, b);
      execMove(m, i, t.idx, mvFlags, oppX);
      return true;
    }
    case CTX.PREJUMP: {
      if (a !== ACT.MOVE) return false;
      const t = cf.moves[s[b + F.bufM]];
      if (t.airOnly || !prejumpCancelable(t) || !canAfford(m, i, t)) return false;
      if (!projOk(m, i, t)) return false;
      clearBuf(s, b);
      execMove(m, i, t.idx, mvFlags, oppX);
      return true;
    }
    case CTX.BLOCKSTUN: {
      if (a !== ACT.PARRY || !canNerve(m, i)) return false;
      clearBuf(s, b);
      s[b + F.stun] = 0;
      execMove(m, i, cf.shove, 0, oppX);
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
      execMove(m, i, t.idx, mvFlags | MVF.RUSH, oppX);
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
      execMove(m, i, t.idx, mvFlags, oppX);
      return true;
    }
    default:
      return false;
  }
}

/** One frame of the running move (mvF already advanced). */
export function moveTick(m: Match, i: number, oppX: number): void {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const mv = cf.moves[s[b + F.mv]];
  const f = s[b + F.mvF];
  const diving = mv.hasAirVel && f >= mv.startup && isAirborne(s, b) && !mv.yCurve;
  if (f > mv.total && !diving) {
    finishMove(m, i, oppX);
    return;
  }
  if (s[b + F.bufA] !== ACT.NONE && tryAct(m, i, CTX.CANCEL, oppX)) return;
  if (mv.yCurve) {
    // scripted root height (moveY): airborne while above the floor, never ballistic
    const fy = f < mv.yCurve.length ? f : mv.yCurve.length - 1;
    s[b + F.y] = mv.yCurve[fy];
    if (s[b + F.y] > 0) s[b + F.flags] = (s[b + F.flags] | FL.AIRBORNE) & ~FL.CROUCHING;
    else s[b + F.flags] &= ~FL.AIRBORNE;
    const d = mv.curve[f] - mv.curve[f - 1];
    if (d !== 0) s[b + F.x] += s[b + F.facing] * d;
  } else if (isAirborne(s, b)) {
    if (mv.hasAirVel && f >= mv.startup) {
      // dive: constant airVel from startup until landing, then `recovery` landing frames
      if (f === mv.startup) {
        s[b + F.vx] = s[b + F.facing] * mv.airVelX;
        s[b + F.vy] = mv.airVelY;
      }
      s[b + F.x] += s[b + F.vx];
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
    if (d !== 0) s[b + F.x] += s[b + F.facing] * d;
  }
  if (mv.proj && f === mv.startup && (s[b + F.mvFlags] & MVF.SPAWNED) === 0) {
    s[b + F.mvFlags] |= MVF.SPAWNED;
    // CHANGED(SIM) P2: ball moves kick / flick / re-kick the one ball (CONTRACT §28.2 ball)
    if (mv.ballAct === BACT.SHOOT || mv.ballAct === BACT.HOVER) ballLaunch(m, i, mv);
    else spawnProjectile(m, i, mv);
  }
  if (mv.teleport && f === mv.teleport.f) teleport(m, i, mv, oppX);
  for (let k = 0; k < mv.sfxF.length; k++) if (mv.sfxF[k] === f) emit(m, EV.SFX_CUE, i, mv.sfxI[k], mv.snapId, 0);
  if (f === mv.lastActive + 1 && s[b + F.contact] === 0 && (mv.isStrike || mv.isGrab) && (s[b + F.mvFlags] & MVF.WHIFFED) === 0) {
    s[b + F.mvFlags] |= MVF.WHIFFED;
    emit(m, EV.WHIFF, i, 1 - i, mv.sc, 0);
  }
}

function finishMove(m: Match, i: number, oppX: number): void {
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
    stanceTick(m, i, oppX);
    return;
  }
  enterFree(m, i, oppX);
}

// ------------------------------------------------------------------ uniques (CHANGED(SIM) P2, CONTRACT §28.2)
/**
 * One frame in STANCE: buffered follow-ups / specials first, then down = exit, maxF = timeout exit, holding back walks
 * back and leaves after blockExitF frames, forward walks. uniq: u1 frames in stance, u3 anim (0 idle 1 walk_f 2 walk_b);
 * F.assistStep counts the back-hold frames while in the stance (unused by assist routes there).
 */
function stanceTick(m: Match, i: number, oppX: number): void {
  const s = m.s;
  const b = fb(i);
  const u = m.cf[i].u;
  s[b + F.uniq + 1]++;
  if (tryAct(m, i, CTX.STANCE, oppX)) return;
  const dir = dirOf(s[b + F.raw], s[b + F.facing]);
  const down = dir === 1 || dir === 2 || dir === 3;
  // down held stExitHoldF frames exits (a motion special rolls through down faster and starts from the stance instead)
  s[b + F.ucnt] = down ? s[b + F.ucnt] + 1 : 0;
  if (down && s[b + F.ucnt] >= u.stExitHoldF && u.stExit2 >= 0) {
    s[b + F.ucnt] = 0;
    startMove(m, i, u.stExit2, 0, oppX);
    return;
  }
  if (down) return;
  if (s[b + F.uniq + 1] >= u.stMaxF && u.stExitT >= 0) {
    startMove(m, i, u.stExitT, 0, oppX);
    return;
  }
  if (dir === 4) {
    s[b + F.assistStep]++;
    if (s[b + F.assistStep] >= u.stBlockExitF) {
      s[b + F.assistStep] = 0;
      enterFree(m, i, oppX);
      return;
    }
    s[b + F.x] -= s[b + F.facing] * u.stWalkB;
    s[b + F.uniq + 3] = 2;
    return;
  }
  s[b + F.assistStep] = 0;
  if (dir === 6) {
    s[b + F.x] += s[b + F.facing] * u.stWalkF;
    s[b + F.uniq + 3] = 1;
    return;
  }
  s[b + F.uniq + 3] = 0;
}

/** Teleport on the move's teleport frame (CONTRACT §20.2 / §28.2): behind / front / home, clamped to the walls. */
function teleport(m: Match, i: number, mv: CMove, oppX: number): void {
  const s = m.s;
  const b = fb(i);
  const tp = mv.teleport;
  if (!tp) return;
  const x0 = s[b + F.x];
  const dx = oppX - x0;
  const side = dx > 0 ? 1 : dx < 0 ? -1 : s[b + F.facing];
  let nx = x0;
  if (tp.to === TPD.BEHIND) nx = oppX + side * tp.gap;
  else if (tp.to === TPD.FRONT) nx = oppX - side * tp.gap;
  else nx = -side * m.sys.wall + side * tp.gap;
  s[b + F.x] = nx;
  clampToWalls(m, i);
  s[b + F.pushF] = 0;
  s[b + F.pushLeft] = 0;
  if (m.cf[i].uk === UK.TELEPORT) s[b + F.uniq]++;
  emit(m, EVX.TELEPORT, i, Math.trunc(x0 / 1000), Math.trunc(s[b + F.x] / 1000), tp.to);
}

// ------------------------------------------------------------------ movement helpers
/** One ballistic step (x += vx; y += vy; vy -= g). Returns true when the fighter touched down. */
export function airStep(s: Int32Array, b: number, g: number): boolean {
  s[b + F.x] += s[b + F.vx];
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
  s[b + F.vx] = jd * s[b + F.facing] * (jd >= 0 ? cf.vxF : cf.vxB);
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
  s[b + F.x] += (back ? -1 : 1) * s[b + F.facing] * d;
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

function parryTick(m: Match, i: number, oppX: number): void {
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
  if (tryAct(m, i, CTX.PARRY, oppX)) return;
  const raw = s[b + F.raw];
  const held = (raw & IN.PARRY) !== 0 || ((raw & IN.M) !== 0 && (raw & IN.H) !== 0);
  if (!held && f >= p.active) endParry(m, i);
}

function rushTick(m: Match, i: number, oppX: number): void {
  const s = m.s;
  const b = fb(i);
  const r = m.sys.raw.rush;
  const f = ++s[b + F.rushF];
  if (f >= r.startup && tryAct(m, i, CTX.RUSH, oppX)) return;
  if (f > r.frames) {
    setSt(m, i, ST.RECOVER);
    s[b + F.stun] = r.recovery;
    return;
  }
  s[b + F.x] += s[b + F.facing] * m.sys.rushSpeed;
}

function juggleTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const sys = m.sys.raw;
  if (!airStep(s, b, m.sys.gJuggle)) return;
  if (s[b + F.bounce] !== 0) {
    s[b + F.bounce] = 0;
    s[b + F.vy] = m.sys.bounceVy;
    s[b + F.vx] = Math.trunc(s[b + F.vx] / 2);
    emit(m, EV.GROUND_BOUNCE, i, 0, 0, 0);
    return;
  }
  s[b + F.flags] &= ~FL.AIRBORNE;
  s[b + F.vx] = 0;
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
  s[b + F.vy] = 0;
  setSt(m, i, ST.KNOCKDOWN);
  s[b + F.stun] = Math.max(1, total);
  s[b + F.tot] = s[b + F.stun]; // CHANGED(fixer) D3: KD presentation (throwpose.ts); callers may set F.kdFace after
  s[b + F.kdFace] = 0;
  s[b + F.kd] = kind;
  s[b + F.wake] = 0;
  emit(m, EV.KNOCKDOWN, i, kind, 0, 0);
}

function kdTick(m: Match, i: number, oppX: number): void {
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
  // CHANGED(fixer) D3: back rise = away from the opponent (a face-down victim after a back throw faces away from it)
  if ((s[b + F.wake] & 1) !== 0 && left < wf) s[b + F.x] += (s[b + F.x] >= oppX ? 1 : -1) * Math.trunc(m.sys.backRise / wf);
  if (left <= 0) {
    s[b + F.invT] = Math.max(s[b + F.invT], sys.throw.wakeupInvuln);
    enterFree(m, i, oppX);
  }
}

const VP = new Int32Array(6);

/**
 * CHANGED(fixer) D3: the throw carry - the victim's x follows its lock segments' clip root travel (throwpose.ts), from
 * the anchor at the connect frame, along the victim's own facing, clamped to the walls. Runs every lock frame.
 */
function throwCarry(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  if (!victimPose(m, i, VP)) return;
  s[b + F.x] = s[b + F.thrX] + s[b + F.facing] * VP[3];
  clampToWalls(m, i);
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

function applyPush(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const pf = s[b + F.pushF];
  if (pf <= 0) return;
  const amt = Math.trunc(s[b + F.pushLeft] / pf);
  s[b + F.pushLeft] -= amt;
  s[b + F.pushF] = pf - 1;
  let nx = s[b + F.x] + amt;
  // CHANGED(fixer) D2: per-side wall limits (asymmetric push boxes)
  const hi = wallLimitX(m, i, 1);
  const lo = wallLimitX(m, i, -1);
  let excess = 0;
  if (nx > hi) {
    excess = nx - hi;
    nx = hi;
  } else if (nx < lo) {
    excess = nx - lo;
    nx = lo;
  }
  s[b + F.x] = nx;
  if (excess !== 0 && (s[b + F.flags] & FL.PUSHX) !== 0) {
    const bo = fb(1 - i);
    const ost = s[bo + F.st];
    if (!isAirborne(s, bo) && ost !== ST.THROWN && ost !== ST.KNOCKDOWN) {
      s[bo + F.x] -= excess;
      clampToWalls(m, 1 - i);
    }
  }
  if (s[b + F.pushF] === 0) {
    s[b + F.pushLeft] = 0;
    s[b + F.flags] &= ~FL.PUSHX;
  }
}

// ------------------------------------------------------------------ the per-frame update
export function fighterUpdate(m: Match, i: number, oppX: number): void {
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
      stanceTick(m, i, oppX); // CHANGED(SIM) P2
      break;
    case ST.IDLE:
    case ST.CROUCH:
    case ST.WALK_F:
    case ST.WALK_B:
      freeTick(m, i, oppX);
      break;
    case ST.PREJUMP:
      if (tryAct(m, i, CTX.PREJUMP, oppX)) break;
      if (s[b + F.stF] >= cf.prejump) takeoff(m, i);
      break;
    case ST.AIR:
      if (tryAct(m, i, CTX.AIR, oppX)) break;
      if (airStep(s, b, cf.g)) land(m, i);
      break;
    case ST.LAND:
    case ST.TECH:
    case ST.PARRY_REC:
    case ST.RECOVER:
    case ST.DIZZY:
      if (--s[b + F.stun] <= 0) enterFree(m, i, oppX);
      break;
    case ST.DASH_F:
    case ST.DASH_B: {
      const k = s[b + F.stF] + 1;
      const frames = st === ST.DASH_F ? cf.dashFFrames : cf.dashBFrames;
      if (k > frames) enterFree(m, i, oppX);
      else dashMove(m, i, k);
      break;
    }
    case ST.ATTACK:
      s[b + F.mvF]++;
      moveTick(m, i, oppX);
      break;
    case ST.HITSTUN:
      if (--s[b + F.stun] <= 0) {
        s[b + F.invT] = Math.max(s[b + F.invT], m.sys.raw.throw.postStunInvuln);
        enterFree(m, i, oppX);
      }
      break;
    case ST.BLOCKSTUN:
      if (tryAct(m, i, CTX.BLOCKSTUN, oppX)) break;
      if (--s[b + F.stun] <= 0) {
        s[b + F.invT] = Math.max(s[b + F.invT], m.sys.raw.throw.postStunInvuln);
        enterFree(m, i, oppX);
      }
      break;
    case ST.JUGGLE:
      juggleTick(m, i);
      break;
    case ST.KNOCKDOWN:
      kdTick(m, i, oppX);
      break;
    case ST.THROWN:
      if (s[b + F.techWin] > 0) s[b + F.techWin]--;
      // CHANGED(fixer) D3: the carry every lock frame; CHANGED(SIM) P2: release early by F.thrRel frames (§28.5d)
      if (--s[b + F.stun] <= s[b + F.thrRel] && s[b + F.techWin] <= 0) throwRelease(m, i);
      else throwCarry(m, i);
      break;
    case ST.PARRY:
      parryTick(m, i, oppX);
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
      rushTick(m, i, oppX);
      break;
    case ST.GRAB:
      if (--s[b + F.stun] <= 0) {
        const swap = s[b + F.throwDir] === 1;
        s[b + F.flags] &= ~FL.THROWING;
        enterFree(m, i, oppX);
        if (swap) s[b + F.facing] = -s[b + F.facing];
      }
      break;
    case ST.TAUNT:
      if (s[b + F.stF] >= cf.tauntFrames) enterFree(m, i, oppX);
      break;
    case ST.KO:
      if (isAirborne(s, b) && airStep(s, b, m.sys.gJuggle)) {
        s[b + F.flags] &= ~FL.AIRBORNE;
        s[b + F.vx] = 0;
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
