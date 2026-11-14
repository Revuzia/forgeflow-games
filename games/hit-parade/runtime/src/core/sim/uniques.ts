// HIT PARADE — fighter uniques: round reset, per-frame snapshot mirrors, boss phases (CHANGED(SIM) P2, CONTRACT §28.2).
// The unique MECHANICS live where they act: stance + teleport in fighter.ts, the ball in projectiles.ts, counters in
// hits.ts, charge keep in inputs.ts, armor-step ticks in fighter.ts (cancelAllowed), phase routing in compile.ts /
// inputs.ts. This module owns what is shared: the four F.uniq ints every snapshot shows (FighterSnap.unique) and the
// phase-2 trigger. All integer math over the state (rollback-safe).

import { BALL, F, MVF, PH, ST, W } from './layout.ts';
import { CUE, EV, EVX } from './events.ts';
import { UK } from './compile.ts';
import { emit, fb } from './state.ts';
import type { Match } from './state.ts';

/** Once per match (createMatch): the persistent unique ints (phase 1, no ball slot). */
export function initUniques(m: Match): void {
  const s = m.s;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    for (let k = 0; k < 4; k++) s[b + F.uniq + k] = 0;
    if (m.cf[i].uk === UK.PHASES) s[b + F.uniq] = 1;
    if (m.cf[i].uk === UK.BALL) s[b + F.uniq + 2] = -1;
  }
}

/** Every round start (rounds.ts initRound): per-round unique state resets; a boss phase persists for the bout. */
export function resetUniquesForRound(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const uk = m.cf[i].uk;
  if (uk === UK.PHASES) {
    s[b + F.uniq] = s[b + F.uniq] === 2 ? 2 : 1;
    s[b + F.uniq + 1] = 0;
    s[b + F.uniq + 2] = 0;
    s[b + F.uniq + 3] = 0;
    return;
  }
  for (let k = 0; k < 4; k++) s[b + F.uniq + k] = 0;
  if (uk === UK.BALL) {
    s[b + F.uniq] = BALL.FEET;
    s[b + F.uniq + 2] = -1;
  }
}

/**
 * End of every fight frame: the snapshot mirrors (charge, counter, armor step, stance flag). The ball mirrors itself in
 * projectiles.ts ballPost; teleport counts in fighter.ts; phases below.
 */
export function uniquesPost(m: Match): void {
  const s = m.s;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    const cf = m.cf[i];
    switch (cf.uk) {
      case UK.CHARGE: {
        const cap = cf.u.chargeF;
        s[b + F.uniq] = Math.min(cap, s[b + F.chB]);
        s[b + F.uniq + 1] = Math.min(cap, s[b + F.chD]);
        s[b + F.uniq + 2] = s[b + F.chBS] >= cap && s[b + F.chBR] <= cf.u.keepF ? 1 : 0;
        s[b + F.uniq + 3] = s[b + F.chDS] >= cap && s[b + F.chDR] <= cf.u.keepF ? 1 : 0;
        break;
      }
      case UK.COUNTER: {
        let on = 0;
        const k = s[b + F.mv];
        if (s[b + F.st] === ST.ATTACK && k >= 0) {
          const c = cf.moves[k].counter;
          const f = s[b + F.mvF];
          if (c && f >= c.f0 && f <= c.f1) on = 1;
        }
        s[b + F.uniq] = on;
        break;
      }
      case UK.ARMOR_STEP:
        s[b + F.uniq] = s[b + F.st] === ST.ATTACK ? s[b + F.armorLeft] : 0;
        s[b + F.uniq + 1] = s[b + F.st] === ST.ATTACK ? s[b + F.armorAbs] : 0;
        break;
      case UK.STANCE:
        if (s[b + F.st] !== ST.STANCE) {
          s[b + F.uniq] = 0;
          s[b + F.uniq + 1] = 0;
          s[b + F.uniq + 3] = 0;
        }
        break;
      case UK.PHASES:
        s[b + F.uniq + 1] = s[W.freezeKind] === 3 && s[W.freezeOwner] === i ? s[W.freeze] : 0;
        break;
      default:
        break;
    }
  }
}

/** A counter move's catch window is running now (for probes / AI; also mirrored in unique[0]). */
export function catching(m: Match, i: number): boolean {
  const s = m.s;
  const b = fb(i);
  const k = s[b + F.mv];
  if (s[b + F.st] !== ST.ATTACK || k < 0) return false;
  const c = m.cf[i].moves[k].counter;
  const f = s[b + F.mvF];
  return c !== undefined && f >= c.f0 && f <= c.f1 && (s[b + F.mvFlags] & MVF.CAUGHT) === 0;
}

/**
 * Boss phases (CONTRACT §28.2 phases): the first time a `phases` fighter's HP drops below thresholdPct % (not a KO) the
 * world freezes lockF frames (freeze kind 3, camera cue PHASE) and phase 2 routes from then on (every later round too).
 * Called after hits / throws every fight frame outside cinematics, so a phase change during a cinematic fires after it.
 */
export function checkPhases(m: Match): void {
  const s = m.s;
  if (s[W.phase] !== PH.FIGHT || s[W.cinActive] !== 0 || s[W.freeze] > 0) return;
  for (let i = 0; i < 2; i++) {
    const cf = m.cf[i];
    if (cf.uk !== UK.PHASES) continue;
    const b = fb(i);
    if (s[b + F.uniq] === 2) continue;
    const hp = s[b + F.hp];
    if (hp <= 0 || hp * 100 >= cf.hpMax * cf.u.threshold) continue;
    s[b + F.uniq] = 2;
    if (cf.u.lockF > 0) {
      s[W.freeze] = cf.u.lockF;
      s[W.freezeKind] = 3;
      s[W.freezeOwner] = i;
      s[b + F.uniq + 1] = cf.u.lockF;
    }
    emit(m, EVX.PHASE, i, 2, cf.u.lockF, 0);
    emit(m, EV.CAMERA_CUE, i, CUE.PHASE, 0, 0);
  }
}
