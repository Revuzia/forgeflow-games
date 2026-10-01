// HIT PARADE — throws and command grabs (CONTRACT §4.3.8, FIGHTING_DESIGN §3c).
// Runs after strikes each frame (a strike on the thrower the same frame already interrupted it:
// strike beats throw). Two throws connecting on the same frame = tech. On connect the victim is
// locked (THROWN) until the thrower's move ends (active + recovery), then lies in a knockdown for
// hitstun - (active + recovery) frames, so on-hit advantage = hitstun - (active + recovery) like
// every other move. Tech window 9 frames (normal throws only); punish-counter throws (+70%,
// hard knockdown, 1 NERVE bar drained) and command grabs are untechable.
//
// CHANGED(SIM3D) (CONTRACT §35.4): a grab connects when the defender is within range (push circle to push circle, the
// old push-box front to front on the line) AND inside the thrower's front arc +- throw.frontArcDeg (70); the victim's
// carry runs along the thrower's yaw (fighter.ts throwCarry), a back throw lands it behind along -forward.
// CHANGED(fix_core) D4 (CONTRACT §35.20): on the connect the victim is pulled onto the thrower's forward line, push fronts
// touching (throw.pullF frames; throwpose.ts holdPos), or follows grab.path (grab supers) - it was held where it was caught,
// up to 1.4 m out of reach of the grab clip (bruno FINAL DELIVERY hugged, spun and lifted air).

import { ACT, F, FL, ST } from './layout.ts';
import { EV, SC } from './events.ts';
import { K } from './compile.ts';
import type { CMove } from './compile.ts';
import { addShowtime, clearMove, drainNerve, emit, fb, isAirborne, setSt } from './state.ts';
import type { Match } from './state.ts';
import { applyDamage, comboStep } from './hits.ts';
import { pushCircle } from './boxes.ts';
import { holdDist, throwEarlyRelease, throwWakeNeed } from './throwpose.ts';
import { Q, YAW_HALF, cosQ, divRound, dirToYaw, isqrt, sinQ } from './fx3d.ts';

function inRange(inv: Int32Array, o: number, f: number): boolean {
  return inv[o] > 0 && f >= inv[o] && f <= inv[o + 1];
}

export function throwable(m: Match, d: number): boolean {
  const s = m.s;
  const bd = fb(d);
  const st = s[bd + F.st];
  switch (st) {
    case ST.HITSTUN:
    case ST.BLOCKSTUN:
    case ST.JUGGLE:
    case ST.AIR:
    case ST.PREJUMP:
    case ST.KNOCKDOWN:
    case ST.THROWN:
    case ST.TECH:
    case ST.CINEMATIC:
    case ST.KO:
    case ST.WIN:
    case ST.LOSE:
    case ST.INTRO:
    case ST.ABSENT:
      return false;
    default:
      break;
  }
  if (isAirborne(s, bd) || s[bd + F.invT] > 0) return false;
  if (st === ST.ATTACK) {
    const dmv = m.cf[d].moves[s[bd + F.mv]];
    if (inRange(dmv.inv, 2, s[bd + F.mvF])) return false;
  }
  if (st === ST.DASH_B) {
    const r = m.sys.raw.movement.backDashThrowInvuln;
    const k = s[bd + F.stF] + 1;
    if (k >= r[0] && k <= r[1]) return false;
  }
  return true;
}

/** Air grabs (grab.air) catch airborne opponents only: jumping / air attacks, not juggles. */
function airGrabbable(m: Match, d: number): boolean {
  const s = m.s;
  const bd = fb(d);
  const st = s[bd + F.st];
  if (!isAirborne(s, bd) || s[bd + F.invT] > 0) return false;
  if (st !== ST.AIR && st !== ST.ATTACK) return false;
  if (st === ST.ATTACK && inRange(m.cf[d].moves[s[bd + F.mv]].inv, 2, s[bd + F.mvF])) return false;
  return true;
}

const GA = new Int32Array(3);
const GD2 = new Int32Array(3);

/**
 * CHANGED(SIM3D): is defender d inside attacker a's front arc (+- throw.frontArcDeg around dir(yaw))? Root to root.
 */
export function inFrontArc(m: Match, a: number, d: number): boolean {
  const s = m.s;
  const ba = fb(a);
  const bd = fb(d);
  const rx = s[bd + F.x] - s[ba + F.x];
  const rz = s[bd + F.z] - s[ba + F.z];
  const dist = isqrt(rx * rx + rz * rz);
  if (dist === 0) return true;
  const yaw = s[ba + F.yaw];
  return rx * sinQ(yaw) + rz * cosQ(yaw) >= m.sys.frontArcCos * dist;
}

function grabCandidate(m: Match, a: number): CMove | null {
  const s = m.s;
  const ba = fb(a);
  if (s[ba + F.st] !== ST.ATTACK || s[ba + F.contact] !== 0) return null;
  const mv = m.cf[a].moves[s[ba + F.mv]];
  if (!mv.isGrab) return null;
  const f = s[ba + F.mvF];
  if (f < mv.startup || f > mv.lastActive) return null;
  const d = 1 - a;
  if (mv.grab && mv.grab.air ? !airGrabbable(m, d) : !throwable(m, d)) return null;
  // CHANGED(SIM3D): the front arc, then the reach between the push circles (on the line = the old facing box edges)
  if (!inFrontArc(m, a, d)) return null;
  pushCircle(m, a, GA);
  pushCircle(m, d, GD2);
  if (mv.grabGap >= 0) {
    // CONTRACT 20.2: pushbox front to pushbox front within rangeM (throws: throwRangeM)
    const dx = GD2[0] - GA[0];
    const dz = GD2[1] - GA[1];
    if (isqrt(dx * dx + dz * dz) - GA[2] - GD2[2] > mv.grabGap) return null;
  } else {
    // box-reach grabs: attacker root to the defender's body edge
    const dx = GD2[0] - s[ba + F.x];
    const dz = GD2[1] - s[ba + F.z];
    if (isqrt(dx * dx + dz * dz) - GD2[2] > mv.grabReach) return null;
  }
  return mv;
}

function isPunishState(m: Match, d: number): boolean {
  const s = m.s;
  const bd = fb(d);
  const st = s[bd + F.st];
  if (st === ST.PARRY || st === ST.PARRY_REC || st === ST.TAUNT || st === ST.RECOVER) return true;
  if (st === ST.ATTACK) {
    const dmv = m.cf[d].moves[s[bd + F.mv]];
    return s[bd + F.mvF] > dmv.lastActive;
  }
  if (st === ST.DASH_B) {
    const cf = m.cf[d];
    const moving = Math.round((cf.dashBFrames * m.sys.raw.movement.dashMovePct) / 100);
    return s[bd + F.stF] + 1 > moving;
  }
  return false;
}

function connect(m: Match, a: number, mv: CMove): void {
  const s = m.s;
  const sys = m.sys.raw;
  const d = 1 - a;
  const ba = fb(a);
  const bd = fb(d);
  const pc = isPunishState(m, d);
  const untech = pc || mv.kind === K.cmdgrab || (mv.grab !== null && !mv.grab.techable);
  const f = s[ba + F.mvF];
  let dmg = mv.damage;
  if (pc) dmg = Math.trunc((dmg * sys.counter.pcThrowDamagePct) / 100);
  if (s[bd + F.cCount] > 0) dmg = Math.trunc((dmg * sys.scaling.comboThrowPct) / 100);
  if ((s[ba + F.mvFlags] & 1) !== 0) dmg = Math.trunc((dmg * sys.simple.damagePct) / 100);
  s[ba + F.contact] = 1;
  s[ba + F.contactF] = f;
  s[ba + F.flags] |= FL.THROWING;
  s[ba + F.throwDir] = mv.throwBack ? 1 : 0;
  s[ba + F.throwDmg] = dmg;
  const g = mv.grab;
  if (g) {
    // CONTRACT 20.2: both lock `frames`, damage on lock frame hitF, release at +adv
    setSt(m, a, ST.GRAB);
    s[ba + F.stun] = g.frames;
    s[ba + F.throwDmgF] = g.hitF;
    s[ba + F.vx] = 0;
    s[ba + F.vy] = 0;
  } else {
    s[ba + F.throwDmgF] = Math.max(1, Math.min(sys.throw.damageFrame, mv.total - f));
  }
  clearMove(m, d);
  setSt(m, d, ST.THROWN);
  s[bd + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING | FL.PROX | FL.BLOCKING);
  s[bd + F.stun] = g ? g.frames : mv.total - f + 1;
  // CHANGED(fixer) D3: the carry (throwpose.ts): anchor + lock length; a side-swap throw ends the victim behind the
  // thrower clear of both push-box fronts (the thrower turns to face it; the lying victim keeps its facing until it rises)
  s[bd + F.tot] = s[bd + F.stun];
  s[bd + F.thrX] = s[bd + F.x];
  s[bd + F.thrZ] = s[bd + F.z];
  // CHANGED(SIM3D) (CONTRACT §35.4): the victim faces the thrower and its carry runs along the thrower's yaw; the
  // victim's own root sits on the thrower's forward line from here on (the carry anchor is its position at the connect)
  s[bd + F.thrYaw] = s[ba + F.yaw];
  s[bd + F.yaw] = (s[ba + F.yaw] + YAW_HALF) & 65535;
  // CHANGED(fix_core) D4 (CONTRACT §35.20): the thrower's root at the connect = the origin of the hold point / grab.path
  // (throwpose.ts holdPos: the victim is pulled into contact or follows the path instead of staying where it was caught)
  s[bd + F.thrAX] = s[ba + F.x];
  s[bd + F.thrAZ] = s[ba + F.z];
  s[bd + F.kdFace] = 0;
  s[bd + F.thrDisp] = 0;
  s[bd + F.thrMv] = s[ba + F.mv];
  s[bd + F.thrSlam] = g ? g.hitF : s[ba + F.throwDmgF];
  if (mv.throwBack) {
    const ddx = s[bd + F.x] - s[ba + F.x];
    const ddz = s[bd + F.z] - s[ba + F.z];
    // CHANGED(fix_core) D4: with the pull, the side-swap carry starts from the HOLD point (holdDist ahead of the thrower)
    const d0 = m.sys.throwPullF > 0 && !(g && g.path) ? holdDist(m, d) : isqrt(ddx * ddx + ddz * ddz);
    // clear of both FRONTS: once the victim is up it turns to face the thrower (no push-apart pop at that turn)
    const after = Math.max(m.sys.backThrowOff, m.cf[a].pushFS + m.cf[d].pushFS + 2000);
    s[bd + F.thrDisp] = d0 + after;
  }
  s[bd + F.after] = Math.max(1, g ? g.adv : mv.hitstun - (mv.active + mv.recovery));
  // CHANGED(SIM) P2 (CONTRACT §28.5d): leave the lock early (once on the floor) so the knockdown plays the whole wake
  s[bd + F.thrRel] = throwEarlyRelease(m, d, g ? g.hitF : s[ba + F.throwDmgF]);
  // still short of a whole wake: a LYING HOLD - the victim lies the missing frames longer and the thrower holds its final
  // grab pose as long (the advantage is unchanged; the connected throw lasts longer)
  const hold = Math.max(0, throwWakeNeed(m, d) - (s[bd + F.after] + s[bd + F.thrRel]));
  if (hold > 0) {
    s[bd + F.after] += hold;
    if (g) s[ba + F.stun] += hold;
    else s[ba + F.after] = hold; // a throw without a grab block: RECOVER for `hold` after its move (fighter.ts finishMove)
  }
  s[bd + F.kd] = pc ? 2 : mv.kd || 1;
  s[bd + F.techWin] = untech || (g !== null && !g.techable) ? 0 : sys.throw.techWindow;
  s[bd + F.counterFlag] = pc ? 2 : 0;
  s[bd + F.pushF] = 0;
  s[bd + F.pushLeft] = 0;
  s[bd + F.vx] = 0;
  s[bd + F.vy] = 0;
  s[bd + F.y] = 0;
  s[bd + F.bufA] = ACT.NONE;
  if (pc) drainNerve(m, d, sys.nerve.bar);
  emit(m, EV.THROW, a, d, pc ? 1 : 0, mv.kind === K.cmdgrab ? 1 : 0);
  if (pc) emit(m, EV.PUNISH, a, d, SC.THROW, 100);
}

function tech(m: Match, a: number): void {
  const s = m.s;
  const sys = m.sys.raw;
  const d = 1 - a;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    clearMove(m, i);
    setSt(m, i, ST.TECH);
    s[b + F.stun] = sys.throw.techFrames;
    s[b + F.flags] &= ~(FL.THROWING | FL.AIRBORNE | FL.CROUCHING);
    s[b + F.techWin] = 0;
    s[b + F.bufA] = ACT.NONE;
    s[b + F.pushF] = sys.pushback.frames;
    s[b + F.flags] &= ~FL.PUSHX;
  }
  const ba = fb(a);
  const bd = fb(d);
  // CHANGED(SIM3D): the tech pushes both apart along the line between them
  const dx = s[bd + F.x] - s[ba + F.x];
  const dz = s[bd + F.z] - s[ba + F.z];
  const yawAD = dx === 0 && dz === 0 ? s[ba + F.yaw] : dirToYaw(dx, dz);
  s[ba + F.pushLeft] = m.sys.techPush;
  s[ba + F.pushYaw] = (yawAD + YAW_HALF) & 65535;
  s[bd + F.pushLeft] = m.sys.techPush;
  s[bd + F.pushYaw] = yawAD;
  void Q;
  void divRound;
  addShowtime(m, d, sys.showtime.techGain);
  emit(m, EV.THROW_TECH, a, d, 0, 0);
}

/** A throw input the victim made (buffered or this frame) — the tech input. */
function techInput(m: Match, d: number): boolean {
  const s = m.s;
  const bd = fb(d);
  if (s[bd + F.bufA] !== ACT.MOVE || s[bd + F.bufAge] > s[bd + F.bufWin]) return false;
  const t = m.cf[d].moves[s[bd + F.bufM]];
  return t.kind === K.throw;
}

export function resolveThrows(m: Match): void {
  const s = m.s;
  const g0 = grabCandidate(m, 0);
  const g1 = grabCandidate(m, 1);
  if (g0 && g1) tech(m, 0);
  else if (g0) connect(m, 0, g0);
  else if (g1) connect(m, 1, g1);
  // tech window
  for (let d = 0; d < 2; d++) {
    const bd = fb(d);
    if (s[bd + F.st] !== ST.THROWN || s[bd + F.techWin] <= 0) continue;
    if (techInput(m, d)) tech(m, 1 - d);
  }
  // throw damage lands on the thrower's damage frame
  for (let a = 0; a < 2; a++) {
    const ba = fb(a);
    if ((s[ba + F.flags] & FL.THROWING) === 0 || s[ba + F.hitstop] > 0) continue;
    if (s[ba + F.throwDmgF] <= 0) continue;
    if (--s[ba + F.throwDmgF] > 0) continue;
    if (s[ba + F.st] !== ST.ATTACK && s[ba + F.st] !== ST.GRAB) continue;
    const d = 1 - a;
    const bd = fb(d);
    if (s[bd + F.st] !== ST.THROWN) continue;
    const mv = m.cf[a].moves[s[ba + F.mv] >= 0 ? s[ba + F.mv] : 0];
    comboStep(m, d, s[ba + F.mvInst], false);
    applyDamage(m, d, s[ba + F.throwDmg], false);
    s[bd + F.cCount]++;
    s[bd + F.techWin] = 0;
    addShowtime(m, a, mv.gainShow);
    addShowtime(m, d, Math.trunc((mv.gainShow * m.sys.raw.showtime.defHitPct) / 100));
    emit(m, EV.HIT, a, d, SC.THROW, 100);
  }
}
