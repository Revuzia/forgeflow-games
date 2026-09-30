// HIT PARADE — throws and command grabs (CONTRACT §4.3.8, FIGHTING_DESIGN §3c).
// Runs after strikes each frame (a strike on the thrower the same frame already interrupted it:
// strike beats throw). Two throws connecting on the same frame = tech. On connect the victim is
// locked (THROWN) until the thrower's move ends (active + recovery), then lies in a knockdown for
// hitstun - (active + recovery) frames, so on-hit advantage = hitstun - (active + recovery) like
// every other move. Tech window 9 frames (normal throws only); punish-counter throws (+70%,
// hard knockdown, 1 NERVE bar drained) and command grabs are untechable.

import { ACT, F, FL, ST } from './layout.ts';
import { EV, SC } from './events.ts';
import { K } from './compile.ts';
import type { CMove } from './compile.ts';
import { addShowtime, clearMove, drainNerve, emit, fb, isAirborne, setSt } from './state.ts';
import type { Match } from './state.ts';
import { applyDamage, comboStep } from './hits.ts';
import { pushExt } from './boxes.ts';

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
  const dx = Math.abs(s[ba + F.x] - s[fb(d) + F.x]);
  // CHANGED(fixer) D2: the push-box edges that face each other (asymmetric boxes)
  const toD = s[fb(d) + F.x] >= s[ba + F.x] ? 1 : -1;
  const eA = pushExt(m, a, toD);
  const eD = pushExt(m, d, -toD);
  if (mv.grabGap >= 0) {
    // CONTRACT 20.2: pushbox front to pushbox front within rangeM (throws: throwRangeM)
    if (dx - eA - eD > mv.grabGap) return null;
  } else if (dx > mv.grabReach + eD) return null;
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
  s[bd + F.kdFace] = 0;
  s[bd + F.thrDisp] = 0;
  s[bd + F.thrMv] = s[ba + F.mv];
  s[bd + F.thrSlam] = g ? g.hitF : s[ba + F.throwDmgF];
  if (mv.throwBack) {
    const d0 = Math.abs(s[bd + F.x] - s[ba + F.x]);
    // clear of both FRONTS: once the victim is up it turns to face the thrower (no push-apart pop at that turn)
    const after = Math.max(m.sys.backThrowOff, m.cf[a].pushFS + m.cf[d].pushFS + 2000);
    s[bd + F.thrDisp] = d0 + after;
  }
  s[bd + F.after] = Math.max(1, g ? g.adv : mv.hitstun - (mv.active + mv.recovery));
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
  const dirA = s[bd + F.x] >= s[ba + F.x] ? 1 : -1;
  s[ba + F.pushLeft] = -dirA * m.sys.techPush;
  s[bd + F.pushLeft] = dirA * m.sys.techPush;
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
