// HIT PARADE — the simulation API (CONTRACT §4.1, §4.6, §17, §18.2). THREE-free, DOM-free,
// clock-free: step(m, in1, in2) advances exactly one frame and is pure over (state, inputs, data).
// All mutable sim state lives in m.s (one Int32Array, layout.ts); save/load copy it, checksum
// hashes it. Snapshots (readFighter / readMatch) are the only thing the view / UI read.
//
// CHANGED(SIM3D) (CONTRACT §35): the 3D ring. createMatch reads the stage's ring / spawnAxisDeg / cameraSideDeg
// (ring.ts), each fight frame hands every fighter its opponent point (fighter.ts OPP) from the START-of-frame positions,
// and after the bodies / hits / throws settled it updates the camera basis camN (continuity: the perpendicular of
// P2 - P1 closest to the previous one) and each fighter's screen-side facing sign (the input mapping, §4.4).

import type { FighterSnap, GameData, MatchPhase, MatchSnap } from '../types.ts';
import { ACT, BUF, F, FL, MODE_CODES, P, PH, PH_NAMES, PROJ_CAP, ST, ST_NAMES, STATE_INTS, STATE_INTS_BRAWL, STATE_VERSION, W, projBase } from './layout.ts';
import { EventRing, EV } from './events.ts';
import { UK, compileBrawl, compileFighter, compileSystem } from './compile.ts';
import { recordInput, parseAction } from './inputs.ts';
import { fighterUpdate, freezeBufferRule, enterKnockdown, PROX_THREAT, proxThreat, setOpp } from './fighter.ts';
import { clampToRing, hurtCyls, pushCircle, resolveBodies } from './boxes.ts';
import { ballPost, projectilesTick } from './projectiles.ts';
import { applyDamage, comboStep, resolveHits, scaledDamage } from './hits.ts';
import { resolveThrows } from './throws.ts';
import { metersTick } from './meters.ts';
import { animTick } from './anim.ts';
import { initRound, startKO, startTimeover } from './rounds.ts';
import { hashInts } from './hash.ts';
import { M } from './units.ts';
import { clearMove, emit, fb, gainNerve, isFreeState, nerveMax, setSt, updateCamN } from './state.ts';
import { KDF } from './throwpose.ts';
import { checkPhases, initUniques, uniquesPost } from './uniques.ts';
import { brawlFightStep, brawlInit, isBonus, readBrawl } from './brawl.ts';
import type { Match, MatchCfg, PlayerCfg, Scheme } from './state.ts';
import { ringFromState, stageRingDef, writeRing, RING_POLY } from './ring.ts';
import { Q, alongYaw, cosQ, mulQ, sinQ, yawToRad } from './fx3d.ts';

export type { Match, MatchCfg, PlayerCfg, Scheme };
export { STATE_VERSION };

// ------------------------------------------------------------------ create
export function createMatch(cfg: MatchCfg, data: GameData): Match {
  const brawl = cfg.mode === 'brawl' || cfg.mode === 'heckler';
  // CHANGED(SIM) P2 (CONTRACT §28.4): in a bonus round p[1] is only compiled (an unknown id falls back to p[0]'s)
  const p1Id = brawl && !data.fighters[cfg.p[1].fighter] ? cfg.p[0].fighter : cfg.p[1].fighter;
  const cf0 = compileFighter(data, cfg.p[0].fighter);
  const cf1 = compileFighter(data, p1Id);
  const sys = compileSystem(data.system);
  const s = new Int32Array(brawl ? STATE_INTS_BRAWL : STATE_INTS);
  const events = new EventRing(s, W.evSeq);
  const training = cfg.mode === 'training';
  // CHANGED(SIM3D) (CONTRACT §35.11 / §35.12): the stage's ring + spawn axis + camera side, into the world block
  writeRing(s, stageRingDef(data, cfg.stage, sys.ringR, sys.spawnAxis));
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
    bonus: brawl ? compileBrawl(data) : null,
    ring: ringFromState(s),
  };
  s[W.ver] = STATE_VERSION | 0;
  s[W.seed] = cfg.seed | 0;
  s[W.rng] = cfg.seed | 0;
  s[W.mode] = Math.max(0, MODE_CODES.indexOf(cfg.mode));
  s[W.roundsNeed] = Math.max(1, cfg.rounds ?? data.system.round.rounds);
  s[W.maxRounds] = Math.max(s[W.roundsNeed] * 2 - 1, data.system.round.maxRounds);
  s[W.timerSetting] = training ? 0 : cfg.timer ?? data.system.round.timer;
  if (brawl && m.bonus) s[W.timerSetting] = cfg.timer ?? (cfg.mode === 'heckler' ? m.bonus.hSeconds : m.bonus.seconds);
  s[W.round] = 1;
  s[W.winner] = -1;
  s[W.roundWinner] = -1;
  for (let i = 0; i < 2; i++) s[fb(i) + F.animId] = 0;
  initUniques(m); // CHANGED(SIM) P2
  initRound(m);
  if (brawl) brawlInit(m); // CHANGED(SIM) P2
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
    for (let i = 0; i < 2; i++) if (s[fb(i) + F.st] !== ST.ABSENT) setSt(m, i, ST.IDLE);
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
    // CHANGED(SIM) P2 (§26.1 request): the cinematic already laid the victim down - no second fall from standing
    s[fb(d) + F.kdFace] = KDF.NOFALL | (mv.cinEndDown ? KDF.DOWN : 0);
    if (mv.cinEndGap >= 0) {
      // CHANGED(SIM3D): the victim ends endGapM along the attacker's yaw, clamped to the ring
      const bd = fb(d);
      const g2 = [0, 0];
      alongYaw(mv.cinEndGap, s[ba + F.yaw], g2);
      s[bd + F.x] = s[ba + F.x] + g2[0];
      s[bd + F.z] = s[ba + F.z] + g2[1];
      clampToRing(m, d);
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
    uniquesPost(m);
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
    uniquesPost(m); // CHANGED(SIM) P2: the phase-lock countdown (unique[1]) runs during its freeze
    if (s[W.freeze] === 0) s[W.freezeKind] = 0;
    animTick(m, 0, false);
    animTick(m, 1, false);
    return;
  }
  const x0 = s[b0 + F.x];
  const z0 = s[b0 + F.z];
  const x1 = s[b1 + F.x];
  const z1 = s[b1 + F.z];
  setOpp(0, x1, z1); // CHANGED(SIM3D): start-of-frame opponent points
  setOpp(1, x0, z0);
  PROX_THREAT[0] = proxThreat(m, 0) ? 1 : 0;
  PROX_THREAT[1] = proxThreat(m, 1) ? 1 : 0;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    if (s[b + F.hitstop] > 0) {
      s[b + F.hitstop]--;
      frozenScratch[i] = 1;
    } else {
      frozenScratch[i] = 0;
      fighterUpdate(m, i);
    }
  }
  resolveBodies(m, x0, z0, x1, z1);
  projectilesTick(m);
  resolveHits(m);
  resolveThrows(m);
  cameraTick(m); // CHANGED(SIM3D)
  // CHANGED(SIM) P2 (CONTRACT §28.2): the ball (knock-away / pickup / respawn), boss phases, unique snapshot mirrors
  ballPost(m);
  // (a KO this frame wins over a phase change: the KO itself is started by checkKO below, after the timer, as in P1)
  if (s[b0 + F.hp] > 0 && s[b1 + F.hp] > 0) checkPhases(m);
  uniquesPost(m);
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

/**
 * CHANGED(SIM3D) (CONTRACT §35.3): camera basis from the settled positions. The screen-side facing signs (the input
 * mapping) follow the yaw where the yaw is set - auto-face / tracking / round start - exactly as the old facing flipped
 * only when a free fighter re-faced (a fighter mid-move or in stun keeps its mapping).
 */
function cameraTick(m: Match): void {
  const s = m.s;
  const b0 = fb(0);
  const b1 = fb(1);
  updateCamN(s, s[b0 + F.x], s[b0 + F.z], s[b1 + F.x], s[b1 + F.z], m.sys.camMinSep);
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
  const z0 = s[fb(0) + F.z];
  const x1 = s[fb(1) + F.x];
  const z1 = s[fb(1) + F.z];
  setOpp(0, x1, z1);
  setOpp(1, x0, z0);
  PROX_THREAT[0] = 0;
  PROX_THREAT[1] = 0;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    if (s[b + F.hitstop] > 0) s[b + F.hitstop]--;
    fighterUpdate(m, i);
    const st = s[b + F.st];
    if (winPose && s[b + F.hp] > 0 && (st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B)) setSt(m, i, ST.WIN);
  }
  resolveBodies(m, x0, z0, x1, z1);
  if (!isBonus(m)) cameraTick(m);
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
      if (m.bonus) brawlFightStep(m, in1 | 0); // CHANGED(SIM) P2: BRAWL BREAK / HECKLER TOSS (CONTRACT §28.4)
      else fightStep(m, in1 | 0, in2 | 0);
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
  // CHANGED(SIM3D) (CONTRACT §35.2): the step state for the view / UI / AI
  const stepKind = st === ST.SIDESTEP ? 'sidestep' : st === ST.SIDEWALK ? 'sidewalk' : st === ST.STEP_END ? 'settle' : 'none';
  return {
    x: s[b + F.x] / M,
    y: s[b + F.y] / M,
    z: s[b + F.z] / M,
    yaw: yawToRad(s[b + F.yaw]),
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
    // CHANGED(fixer) D10: the snapshot never reports overkill (the state keeps it; checksums unchanged)
    hp: Math.max(0, s[b + F.hp]),
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
      stance: st === ST.STANCE ? 1 : 0, // CHANGED(SIM) P2 (§28.1): was unique[0] for every kind
      taunting: st === ST.TAUNT,
      ko: (s[b + F.flags] & FL.KO) !== 0,
    },
    unique: [s[b + F.uniq], s[b + F.uniq + 1], s[b + F.uniq + 2], s[b + F.uniq + 3]],
    // CHANGED(SIM) P2 (CONTRACT §28.1)
    install: Math.max(0, s[b + F.instF]),
    absent: st === ST.ABSENT,
    actionable: (isFreeState(st) || (st === ST.STANCE && cf.uk === UK.STANCE)) && s[b + F.hitstop] <= 0 && s[W.freeze] <= 0 && s[W.phase] === PH.FIGHT,
    step: {
      kind: stepKind,
      frame: stepKind === 'none' ? 0 : s[b + F.stF] + 1,
      side: stepKind === 'sidestep' || stepKind === 'sidewalk' ? (s[b + F.stepDir] > 0 ? -1 : 1) : 0,
      dir: stepKind === 'none' ? '' : s[b + F.stepIn] !== 0 ? 'in' : 'out',
      dist: cf.stepDist / M, // CHANGED(fix_core) D1: the fighter's own sidestep arc length (m)
    },
  };
}

export function readMatch(m: Match): MatchSnap {
  const s = m.s;
  const t = s[W.timer];
  // CHANGED(integrator): the live projectile list the view draws (§17.1 MatchSnap.proj request; was missing, so a
  // projectile special flew invisibly in the game)
  const proj: NonNullable<MatchSnap['proj']> = [];
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0) continue;
    const owner = s[pb + P.owner];
    const mv = owner === 0 || owner === 1 ? m.cf[owner]?.moves[s[pb + P.mv]] : undefined;
    const kind = s[pb + P.kind];
    proj.push({ slot: k, owner, x: s[pb + P.x] / M, y: s[pb + P.y] / M, vx: (s[pb + P.vx] * 60) / M, moveId: kind === 2 ? s[pb + P.mode] : mv ? mv.snapId : -1,
      kind, alive: true, obj: kind === 1 || kind === 2 ? s[pb + P.mode] : 0,
      // CHANGED(SIM3D)
      z: s[pb + P.z] / M, vz: (s[pb + P.vz] * 60) / M, yaw: yawToRad(s[pb + P.yaw]) });
  }
  const rg = m.ring;
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
    proj,
    // CHANGED(SIM3D) (CONTRACT §35.3): the camera basis + the ring
    camN: [s[W.camNX] / Q, s[W.camNZ] / Q],
    ring: { shape: rg.kind === RING_POLY ? 'poly' : 'circle', radius: rg.r / M, sides: rg.sides, rot: yawToRad(rg.rot), centre: [rg.cx / M, rg.cz / M] },
    ...(isBonus(m) && m.bonus ? { brawl: readBrawl(m) } : {}),
  };
}

// ------------------------------------------------------------------ boxes (CHANGED(SIM3D): the §27.1 readBoxes request)
/** World-space collision volumes of fighter i in metres (training overlay / debug; read-only). */
export interface BoxesSnap {
  /** vertical hurt cylinders */
  hurt: Array<{ x: number; z: number; r: number; y0: number; y1: number }>;
  /** active hit boxes: centre (x, z), yaw (radians), forward length `len`, lateral half-depth `lat`, heights */
  hit: Array<{ x: number; z: number; yaw: number; len: number; lat: number; y0: number; y1: number }>;
  /** push circle */
  push: { x: number; z: number; r: number };
}
const RB = new Int32Array(30);
const RP = new Int32Array(3);

export function readBoxes(m: Match, i: number): BoxesSnap {
  const s = m.s;
  const b = fb(i);
  const n = hurtCyls(m, i, RB);
  const hurt: BoxesSnap['hurt'] = [];
  for (let k = 0; k < n; k++) hurt.push({ x: RB[k * 5] / M, z: RB[k * 5 + 1] / M, r: RB[k * 5 + 2] / M, y0: RB[k * 5 + 3] / M, y1: RB[k * 5 + 4] / M });
  const hit: BoxesSnap['hit'] = [];
  const k = s[b + F.mv];
  if (k >= 0 && s[b + F.st] === ST.ATTACK) {
    const mv = m.cf[i].moves[k];
    const f = s[b + F.mvF];
    const yaw = s[b + F.yaw];
    for (let j = 0; j < mv.nBox; j++) {
      const q = j * 7;
      if (f < mv.boxes[q] || f > mv.boxes[q + 1]) continue;
      const fwd = mv.boxes[q + 2];
      hit.push({
        x: (s[b + F.x] + mulQ(fwd, sinQ(yaw))) / M, z: (s[b + F.z] + mulQ(fwd, cosQ(yaw))) / M, yaw: yawToRad(yaw),
        len: mv.boxes[q + 4] / M, lat: mv.lateral / M,
        y0: (s[b + F.y] + mv.boxes[q + 3] - (mv.boxes[q + 5] >> 1)) / M, y1: (s[b + F.y] + mv.boxes[q + 3] + (mv.boxes[q + 5] >> 1)) / M,
      });
    }
  }
  pushCircle(m, i, RP);
  return { hurt, hit, push: { x: RP[0] / M, z: RP[1] / M, r: RP[2] / M } };
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

