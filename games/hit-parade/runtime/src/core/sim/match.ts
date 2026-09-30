// HIT PARADE — the simulation API (CONTRACT §4.1, §4.6, §17, §18.2). THREE-free, DOM-free,
// clock-free: step(m, in1, in2) advances exactly one frame and is pure over (state, inputs, data).
// All mutable sim state lives in m.s (one Int32Array, layout.ts); save/load copy it, checksum
// hashes it. Snapshots (readFighter / readMatch) are the only thing the view / UI read.

import type { FighterSnap, GameData, MatchPhase, MatchSnap } from '../types.ts';
import { ACT, BUF, F, FL, MODE_CODES, PH, PH_NAMES, ST, ST_NAMES, STATE_INTS, STATE_INTS_BRAWL, STATE_VERSION, W } from './layout.ts';
import { EventRing, EV } from './events.ts';
import { compileFighter, compileSystem } from './compile.ts';
import { recordInput, parseAction } from './inputs.ts';
import { fighterUpdate, freezeBufferRule, enterKnockdown, PROX_THREAT, proxThreat } from './fighter.ts';
import { resolveBodies } from './boxes.ts';
import { projectilesTick } from './projectiles.ts';
import { applyDamage, comboStep, resolveHits, scaledDamage } from './hits.ts';
import { resolveThrows } from './throws.ts';
import { metersTick } from './meters.ts';
import { animTick } from './anim.ts';
import { initRound, startKO, startTimeover } from './rounds.ts';
import { hashInts } from './hash.ts';
import { M } from './units.ts';
import { clearMove, emit, fb, gainNerve, nerveMax, setSt } from './state.ts';
import type { Match, MatchCfg, PlayerCfg, Scheme } from './state.ts';

export type { Match, MatchCfg, PlayerCfg, Scheme };
export { STATE_VERSION };

// ------------------------------------------------------------------ create
export function createMatch(cfg: MatchCfg, data: GameData): Match {
  const cf0 = compileFighter(data, cfg.p[0].fighter);
  const cf1 = compileFighter(data, cfg.p[1].fighter);
  const sys = compileSystem(data.system);
  const brawl = cfg.mode === 'brawl' || cfg.mode === 'heckler';
  const s = new Int32Array(brawl ? STATE_INTS_BRAWL : STATE_INTS);
  const events = new EventRing(s, W.evSeq);
  const training = cfg.mode === 'training';
  const m: Match = {
    cfg,
    s,
    frame: () => s[W.frame],
    events,
    data,
    sys,
    cf: [cf0, cf1],
    tab: { sfx: sys.sfx, anims: [data.anims[cf0.id] ?? [], data.anims[cf1.id] ?? []] },
    training,
    arcade: cfg.mode === 'arcade',
  };
  s[W.ver] = STATE_VERSION | 0;
  s[W.seed] = cfg.seed | 0;
  s[W.rng] = cfg.seed | 0;
  s[W.mode] = Math.max(0, MODE_CODES.indexOf(cfg.mode));
  s[W.roundsNeed] = Math.max(1, cfg.rounds ?? data.system.round.rounds);
  s[W.maxRounds] = Math.max(s[W.roundsNeed] * 2 - 1, data.system.round.maxRounds);
  s[W.timerSetting] = training ? 0 : cfg.timer ?? data.system.round.timer;
  s[W.round] = 1;
  s[W.winner] = -1;
  s[W.roundWinner] = -1;
  for (let i = 0; i < 2; i++) s[fb(i) + F.animId] = 0;
  initRound(m);
  return m;
}

// ------------------------------------------------------------------ step
const frozenScratch = new Int32Array(2);

function introStep(m: Match): void {
  const s = m.s;
  if (s[W.phaseF] === 0) emit(m, EV.ROUND_INTRO, s[W.round], 0, 0, 0);
  s[W.phaseF]++;
  animTick(m, 0, true);
  animTick(m, 1, true);
  if (s[W.phaseF] >= m.sys.raw.round.introFrames) {
    s[W.phase] = PH.FIGHT;
    s[W.phaseF] = 0;
    for (let i = 0; i < 2; i++) setSt(m, i, ST.IDLE);
    emit(m, EV.FIGHT, s[W.round], 0, 0, 0);
  }
}

function cinematicTick(m: Match): void {
  const s = m.s;
  const a = s[W.cinFighter];
  const d = 1 - a;
  const ba = fb(a);
  const mv = m.cf[a].moves[s[W.cinMove]];
  const cin = mv.cin;
  const f = s[W.cinFrame];
  if (cin) {
    while (s[W.cinHit] < cin.hitF.length && cin.hitF[s[W.cinHit]] === f) {
      const dmgBase = cin.hitD[s[W.cinHit]];
      const pct = comboStep(m, d, s[ba + F.mvInst], false);
      const dmg = scaledDamage(m, d, mv, dmgBase, pct, 0, (s[ba + F.mvFlags] & 1) !== 0, false);
      applyDamage(m, d, dmg, false);
      s[fb(d) + F.cCount]++;
      emit(m, EV.SUPER_HIT, a, d, 4, 120);
      s[W.cinHit]++;
    }
  }
  s[W.cinFrame] = f + 1;
  if (s[W.cinFrame] >= s[W.cinLen]) {
    s[W.cinActive] = 0;
    emit(m, EV.CINEMATIC_END, a, mv.snapId, 0, 0);
    clearMove(m, a);
    setSt(m, a, ST.RECOVER);
    const rec = m.sys.raw.cinematic.attackerRecover;
    s[ba + F.stun] = rec;
    const vkd = mv.cinEndAdv > -100000 ? rec + mv.cinEndAdv : m.sys.raw.cinematic.victimKd;
    enterKnockdown(m, d, vkd, 2);
    if (mv.cinEndGap >= 0) {
      const bd = fb(d);
      const lim = m.sys.wall - m.cf[d].pushHalf;
      s[bd + F.x] = Math.max(-lim, Math.min(lim, s[ba + F.x] + s[ba + F.facing] * mv.cinEndGap));
    }
  }
}

function fightStep(m: Match, in1: number, in2: number): void {
  const s = m.s;
  const b0 = fb(0);
  const b1 = fb(1);
  const worldFrozen = s[W.freeze] > 0 || s[W.cinActive] !== 0;
  recordInput(m, 0, in1, worldFrozen || s[b0 + F.hitstop] > 0);
  recordInput(m, 1, in2, worldFrozen || s[b1 + F.hitstop] > 0);
  const pre0 = s[b0 + F.bufA] * 65536 + s[b0 + F.bufM];
  const pre1 = s[b1 + F.bufA] * 65536 + s[b1 + F.bufM];
  parseAction(m, 0);
  parseAction(m, 1);
  if (s[W.cinActive] !== 0) {
    cinematicTick(m);
    animTick(m, 0, false);
    animTick(m, 1, false);
    checkKO(m);
    return;
  }
  if (s[W.freeze] > 0) {
    // hold-to-buffer: presses made during the freeze stay buffered only while held
    if (s[b0 + F.bufA] * 65536 + s[b0 + F.bufM] !== pre0) s[b0 + F.bufF] |= BUF.FROZEN;
    if (s[b1 + F.bufA] * 65536 + s[b1 + F.bufM] !== pre1) s[b1 + F.bufF] |= BUF.FROZEN;
    freezeBufferRule(m, 0);
    freezeBufferRule(m, 1);
    s[W.freeze]--;
    if (s[W.freeze] === 0) s[W.freezeKind] = 0;
    animTick(m, 0, false);
    animTick(m, 1, false);
    return;
  }
  const x0 = s[b0 + F.x];
  const x1 = s[b1 + F.x];
  PROX_THREAT[0] = proxThreat(m, 0) ? 1 : 0;
  PROX_THREAT[1] = proxThreat(m, 1) ? 1 : 0;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    if (s[b + F.hitstop] > 0) {
      s[b + F.hitstop]--;
      frozenScratch[i] = 1;
    } else {
      frozenScratch[i] = 0;
      fighterUpdate(m, i, i === 0 ? x1 : x0);
    }
  }
  resolveBodies(m, x0, x1);
  projectilesTick(m);
  resolveHits(m);
  resolveThrows(m);
  if (frozenScratch[0] === 0) metersTick(m, 0);
  if (frozenScratch[1] === 0) metersTick(m, 1);
  if (s[W.timer] > 0) {
    s[W.timer]--;
    if (s[W.timer] === 0 && s[W.cinActive] === 0) {
      if (!checkKO(m)) startTimeover(m);
      animTick(m, 0, frozenScratch[0] === 0);
      animTick(m, 1, frozenScratch[1] === 0);
      return;
    }
  }
  checkKO(m);
  animTick(m, 0, frozenScratch[0] === 0);
  animTick(m, 1, frozenScratch[1] === 0);
}

/** KO check (never during a cinematic, never in training). Returns true when a KO started. */
function checkKO(m: Match): boolean {
  const s = m.s;
  if (m.training || s[W.cinActive] !== 0 || s[W.phase] !== PH.FIGHT) return false;
  const k0 = s[fb(0) + F.hp] <= 0;
  const k1 = s[fb(1) + F.hp] <= 0;
  if (!k0 && !k1) return false;
  startKO(m, k0 && k1 ? 2 : k0 ? 1 : 0);
  return true;
}

function quietInputs(m: Match): void {
  const s = m.s;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    s[b + F.prevRaw] = 0;
    s[b + F.raw] = 0;
    s[b + F.bufA] = ACT.NONE;
  }
}

function outroUpdate(m: Match, winPose: boolean): void {
  const s = m.s;
  quietInputs(m);
  const x0 = s[fb(0) + F.x];
  const x1 = s[fb(1) + F.x];
  PROX_THREAT[0] = 0;
  PROX_THREAT[1] = 0;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    if (s[b + F.hitstop] > 0) s[b + F.hitstop]--;
    fighterUpdate(m, i, i === 0 ? x1 : x0);
    const st = s[b + F.st];
    if (winPose && s[b + F.hp] > 0 && (st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B)) setSt(m, i, ST.WIN);
  }
  resolveBodies(m, x0, x1);
  animTick(m, 0, true);
  animTick(m, 1, true);
}

function koStep(m: Match): void {
  const s = m.s;
  const sys = m.sys.raw;
  if (s[W.koStop] > 0) {
    s[W.koStop]--;
    animTick(m, 0, false);
    animTick(m, 1, false);
    return;
  }
  if (s[W.slowmo] > 0) {
    s[W.slowmo]--;
    s[W.slowTick]++;
    if (s[W.slowTick] % sys.round.koSlowmoEvery === 0) outroUpdate(m, false);
    else {
      animTick(m, 0, false);
      animTick(m, 1, false);
    }
    return;
  }
  s[W.phaseF]++;
  outroUpdate(m, true);
  if (s[W.phaseF] >= sys.round.koOutroFrames) {
    s[W.phase] = PH.ROUND_END;
    s[W.phaseF] = 0;
  }
}

function timeoverStep(m: Match): void {
  const s = m.s;
  s[W.phaseF]++;
  animTick(m, 0, true);
  animTick(m, 1, true);
  if (s[W.phaseF] >= m.sys.raw.round.timeoverOutroFrames) {
    s[W.phase] = PH.ROUND_END;
    s[W.phaseF] = 0;
  }
}

function roundEndStep(m: Match): void {
  const s = m.s;
  emit(m, EV.ROUND_END, s[W.roundWinner], s[W.round], 0, 0);
  if (s[W.matchDeciding] !== 0) {
    s[W.phase] = PH.MATCH_END;
    s[W.phaseF] = 0;
    emit(m, EV.MATCH_END, s[W.winner], s[W.draw], s[W.wins0], s[W.wins1]);
    return;
  }
  s[W.round]++;
  initRound(m);
}

/** Advances exactly one frame. `in1` / `in2` = §4.4 input words of P1 / P2. */
export function step(m: Match, in1: number, in2: number): void {
  const s = m.s;
  s[W.frame]++;
  switch (s[W.phase]) {
    case PH.INTRO:
      introStep(m);
      break;
    case PH.FIGHT:
      fightStep(m, in1 | 0, in2 | 0);
      break;
    case PH.KO:
      koStep(m);
      break;
    case PH.TIMEOVER:
      timeoverStep(m);
      break;
    case PH.ROUND_END:
      roundEndStep(m);
      break;
    default:
      s[W.phaseF]++;
      animTick(m, 0, true);
      animTick(m, 1, true);
      break;
  }
}

// ------------------------------------------------------------------ rollback support
export function save(m: Match, slot: Int32Array): void {
  slot.set(m.s);
}
export function load(m: Match, slot: Int32Array): void {
  m.s.set(slot.length === m.s.length ? slot : slot.subarray(0, m.s.length));
}
export function checksum(m: Match): number {
  return hashInts(m.s);
}

// ------------------------------------------------------------------ snapshots
function pwl(pts: [number, number][], f: number): number {
  if (f <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (f <= pts[i][0]) {
      const [f0, v0] = pts[i - 1];
      const [f1, v1] = pts[i];
      return f1 === f0 ? v1 : v0 + ((v1 - v0) * (f - f0)) / (f1 - f0);
    }
  }
  return pts[pts.length - 1][1];
}

function animSeconds(m: Match, i: number, id: number, frame: number): number {
  const ref = m.tab.anims[i][id];
  if (!ref) return frame / 60;
  let t = ref.warp && ref.warp.length > 0 ? pwl(ref.warp, frame) : frame / 60;
  const clip = m.data.clips[m.cf[i].id]?.clips[ref.clip];
  if (clip && clip.dur > 0) t = ref.loop ? t % clip.dur : Math.min(t, clip.dur);
  return t;
}

const SYS_NAMES: Record<string, string> = { __impact: 'impact', __shove: 'shove', __throw_f: 'throw_f', __throw_b: 'throw_b' };

function inRange(inv: Int32Array, o: number, f: number): boolean {
  return inv[o] > 0 && f >= inv[o] && f <= inv[o + 1];
}

export function readFighter(m: Match, i: number): FighterSnap {
  const s = m.s;
  const b = fb(i);
  const bo = fb(1 - i);
  const cf = m.cf[i];
  const k = s[b + F.mv];
  const mv = k >= 0 ? cf.moves[k] : null;
  const st = s[b + F.st];
  const f = s[b + F.mvF];
  let moveName = '';
  if (mv) moveName = mv.snapId >= 0 ? mv.id : (SYS_NAMES[mv.id] ?? mv.id);
  else if (st === ST.PARRY || st === ST.PARRY_REC) moveName = 'parry';
  else if (st === ST.RUSH) moveName = 'rush';
  const invuln = s[b + F.invS] > 0 || st === ST.KNOCKDOWN || (mv !== null && inRange(mv.inv, 0, f));
  const armor = mv !== null && s[b + F.armorLeft] > 0 && f >= mv.armorF0 && f <= mv.armorF1;
  const animId = s[b + F.animId];
  const animF = s[b + F.animF];
  return {
    x: s[b + F.x] / M,
    y: s[b + F.y] / M,
    facing: s[b + F.facing],
    state: st,
    stateName: ST_NAMES[st] ?? '',
    moveId: mv ? mv.snapId : -1,
    moveName,
    moveKind: mv ? mv.kindStr : '',
    moveFrame: f,
    animId,
    animFrame: animF,
    prevAnimId: s[b + F.pAnimId],
    prevAnimFrame: s[b + F.pAnimF],
    blendT: Math.min(1, s[b + F.blendT] / 6),
    animSec: animSeconds(m, i, animId, animF),
    hp: s[b + F.hp],
    hpMax: cf.hpMax,
    greyHp: s[b + F.grey],
    showtime: s[b + F.showtime],
    nerve: s[b + F.nerve],
    stageFright: s[b + F.fright] !== 0,
    combo: s[bo + F.cCount],
    comboDamage: s[bo + F.cDamage],
    lastDamage: s[b + F.lastDmg],
    hitstop: s[b + F.hitstop],
    stun: s[b + F.stun],
    airborne: (s[b + F.flags] & FL.AIRBORNE) !== 0,
    crouching: (s[b + F.flags] & FL.CROUCHING) !== 0,
    flags: {
      invuln,
      armor,
      counter: s[b + F.counterFlag] !== 0,
      stance: s[b + F.uniq],
      taunting: st === ST.TAUNT,
      ko: (s[b + F.flags] & FL.KO) !== 0,
    },
    unique: [s[b + F.uniq], s[b + F.uniq + 1], s[b + F.uniq + 2], s[b + F.uniq + 3]],
  };
}

export function readMatch(m: Match): MatchSnap {
  const s = m.s;
  const t = s[W.timer];
  return {
    frame: s[W.frame],
    phase: (PH_NAMES[s[W.phase]] ?? 'fight') as MatchPhase,
    phaseFrame: s[W.phaseF],
    round: s[W.round],
    timer: t < 0 ? -1 : Math.ceil(t / 60),
    wins: [s[W.wins0], s[W.wins1]],
    cinematic: {
      active: s[W.cinActive] !== 0,
      fighter: s[W.cinActive] !== 0 ? s[W.cinFighter] : -1,
      cueId: s[W.cinActive] !== 0 ? m.cf[s[W.cinFighter]].moves[s[W.cinMove]].snapId : -1,
      frame: s[W.cinFrame],
      frames: s[W.cinLen],
    },
    winner: s[W.winner],
    draw: s[W.draw] !== 0,
    roundWinner: s[W.roundWinner],
    slowmo: s[W.phase] === PH.KO && s[W.koStop] === 0 && s[W.slowmo] > 0,
    freeze: s[W.freeze],
  };
}

// ------------------------------------------------------------------ dev (test surface only, §18.2)
export function devSet(m: Match, p: 0 | 1, key: 'hp' | 'showtime' | 'nerve', v: number): void {
  const s = m.s;
  const b = fb(p);
  const n = Math.trunc(v);
  if (key === 'hp') s[b + F.hp] = Math.max(1, Math.min(m.cf[p].hpMax, n));
  else if (key === 'showtime') s[b + F.showtime] = Math.max(0, Math.min(m.sys.raw.showtime.bar * m.sys.raw.showtime.bars, n));
  else {
    const max = nerveMax(m);
    s[b + F.nerve] = Math.max(0, Math.min(max, n));
    if (s[b + F.nerve] >= max && s[b + F.fright] !== 0) gainNerve(m, p, 0);
  }
}

