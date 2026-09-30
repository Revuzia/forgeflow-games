// HIT PARADE — rounds (CONTRACT §4.3.11): intro, FIGHT, 99 s timer, KO sequence (KO hitstop,
// slow-mo = physics every 4th frame, outro), time-out verdict (strict HP fraction; exact tie =
// draw; ARCADE last-round tie = CPU wins), first to `rounds`, max rounds, meters carry
// (SHOWTIME) / reset (NERVE full, HP full), match end. The result is decided on the KO frame.

import { ACT, F, FIGHTER_INTS, FL, HIST, PH, PROJ_CAP, PROJ_INTS, ST, W, projBase } from './layout.ts';
import { EV, CUE } from './events.ts';
import { clearMove, emit, fb, nerveMax, setSt } from './state.ts';
import type { Match } from './state.ts';

/** Resets both fighters and the world for the next round (SHOWTIME, uniques, mvInst carry). */
export function initRound(m: Match): void {
  const s = m.s;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    const keepShow = s[b + F.showtime];
    const keepInst = s[b + F.mvInst];
    const u0 = s[b + F.uniq];
    const u1 = s[b + F.uniq + 1];
    const u2 = s[b + F.uniq + 2];
    const u3 = s[b + F.uniq + 3];
    const keepAnim = s[b + F.animId];
    const keepAnimF = s[b + F.animF];
    for (let k = 0; k < FIGHTER_INTS; k++) s[b + k] = 0;
    s[b + F.showtime] = keepShow;
    s[b + F.mvInst] = keepInst;
    s[b + F.uniq] = u0;
    s[b + F.uniq + 1] = u1;
    s[b + F.uniq + 2] = u2;
    s[b + F.uniq + 3] = u3;
    s[b + F.x] = (i === 0 ? -1 : 1) * m.sys.startHalf;
    s[b + F.facing] = i === 0 ? 1 : -1;
    s[b + F.hp] = m.cf[i].hpMax;
    s[b + F.nerve] = nerveMax(m);
    s[b + F.mv] = -1;
    s[b + F.bufM] = -1;
    s[b + F.bufA] = ACT.NONE;
    s[b + F.cLastInst] = -1;
    s[b + F.animId] = keepAnim;
    s[b + F.animF] = keepAnimF;
    s[b + F.animInst] = -1;
    s[b + F.blendT] = 6;
    for (let h = 0; h < HIST; h++) s[b + F.hist + h] = 0;
    setSt(m, i, ST.INTRO);
  }
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    for (let j = 0; j < PROJ_INTS; j++) s[pb + j] = 0;
  }
  s[W.phase] = PH.INTRO;
  s[W.phaseF] = 0;
  s[W.roundWinner] = -1;
  s[W.freeze] = 0;
  s[W.freezeKind] = 0;
  s[W.koStop] = 0;
  s[W.slowmo] = 0;
  s[W.slowTick] = 0;
  s[W.cinActive] = 0;
  s[W.cinFrame] = 0;
  s[W.cinLen] = 0;
  s[W.matchDeciding] = 0;
  const t = s[W.timerSetting];
  s[W.timer] = t > 0 ? t * 60 : -1;
}

function cpuSide(m: Match): number {
  const p = m.cfg.p;
  if (p[0].cpu >= 0 && p[1].cpu < 0) return 0;
  if (p[1].cpu >= 0 && p[0].cpu < 0) return 1;
  return -1;
}

/** Records the round result r (0 | 1 | 2 = draw); updates wins / winner / matchDeciding. */
export function decideRound(m: Match, rIn: number): void {
  const s = m.s;
  const need = s[W.roundsNeed];
  const max = s[W.maxRounds];
  const round = s[W.round];
  let r = rIn;
  if (r === 2 && m.arcade) {
    const cpu = cpuSide(m);
    const last = round >= max || s[W.wins0] === need - 1 || s[W.wins1] === need - 1;
    if (cpu >= 0 && last) r = cpu;
  }
  s[W.roundWinner] = r;
  let draw = false;
  if (r === 2) {
    if (s[W.wins0] + 1 >= need && s[W.wins1] + 1 >= need) {
      if (round >= max) draw = true; // no sudden death left: drawn match
      // else: sudden death, nobody scores
    } else {
      s[W.wins0]++;
      s[W.wins1]++;
    }
  } else if (r === 0) s[W.wins0]++;
  else s[W.wins1]++;
  const w0 = s[W.wins0];
  const w1 = s[W.wins1];
  const over = draw || w0 >= need || w1 >= need || round >= max;
  s[W.matchDeciding] = over ? 1 : 0;
  if (over) {
    if (draw || w0 === w1) {
      s[W.winner] = -1;
      s[W.draw] = 1;
    } else s[W.winner] = w0 > w1 ? 0 : 1;
  }
}

/** Time-out verdict: strict HP fraction (hp0/max0 vs hp1/max1), exact tie = draw (2). */
export function timeoverVerdict(m: Match): number {
  const s = m.s;
  const h0 = Math.max(0, s[fb(0) + F.hp]);
  const h1 = Math.max(0, s[fb(1) + F.hp]);
  const a = h0 * m.cf[1].hpMax;
  const c = h1 * m.cf[0].hpMax;
  return a > c ? 0 : c > a ? 1 : 2;
}

export function startKO(m: Match, r: number): void {
  const s = m.s;
  const sys = m.sys.raw;
  decideRound(m, r);
  s[W.phase] = PH.KO;
  s[W.phaseF] = 0;
  s[W.koStop] = sys.round.koHitstop;
  s[W.slowmo] = sys.round.koSlowmoFrames;
  s[W.slowTick] = 0;
  s[W.freeze] = 0;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    s[b + F.bufA] = ACT.NONE;
    s[b + F.hitstop] = 0;
    if (s[b + F.hp] > 0) continue;
    const wasAir = (s[b + F.flags] & FL.AIRBORNE) !== 0;
    const wx = s[fb(1 - i) + F.facing];
    clearMove(m, i);
    setSt(m, i, ST.KO);
    s[b + F.flags] |= FL.KO | FL.AIRBORNE;
    if (!wasAir) {
      s[b + F.vx] = wx * m.sys.popVx;
      s[b + F.vy] = m.sys.popVy;
    }
    s[b + F.pushF] = 0;
  }
  const winner = r === 2 ? -1 : r;
  const loser = r === 2 ? -1 : 1 - r;
  emit(m, EV.KO, winner, loser, s[W.matchDeciding], 0);
  emit(m, EV.CAMERA_CUE, winner < 0 ? 0 : winner, CUE.KO, 0, 0);
}

export function startTimeover(m: Match): void {
  const s = m.s;
  const r = timeoverVerdict(m);
  decideRound(m, r);
  s[W.phase] = PH.TIMEOVER;
  s[W.phaseF] = 0;
  s[W.freeze] = 0;
  const rw = s[W.roundWinner];
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    clearMove(m, i);
    s[b + F.bufA] = ACT.NONE;
    s[b + F.hitstop] = 0;
    s[b + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING);
    s[b + F.y] = 0;
    s[b + F.vx] = 0;
    s[b + F.vy] = 0;
    setSt(m, i, rw === i ? ST.WIN : ST.LOSE);
  }
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    for (let j = 0; j < PROJ_INTS; j++) s[pb + j] = 0;
  }
  emit(m, EV.TIMEOVER, rw, s[W.matchDeciding], 0, 0);
}
