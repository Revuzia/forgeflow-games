// HIT PARADE — anim cursor in the state (CONTRACT §4.2, §17 rules 2-4). The sim decides WHICH
// clip each fighter shows and how far into it (sim frames); the view only samples. animF never
// advances during hitstop / super freeze (`advance` = false), so rollback re-poses identically.
// For move anims animFrame == moveFrame (1 on the move's first frame): the warp point
// [startup, contact] therefore shows the impact pose exactly on the first active frame.

import { F, FL, ST, W } from './layout.ts';
import { SHARED_CLIPS } from '../data.ts';
import { fb } from './state.ts';
import type { Match } from './state.ts';
import { knockdownPose, victimPose } from './throwpose.ts';

// shared clip ids (§17 rule 2)
export const A = {
  idle: 0, walk_f: 1, walk_b: 2, crouch: 3, crouch_idle: 4, jump_up: 5, jump_f: 6, jump_b: 7, land: 8,
  dash_f: 9, dash_b: 10, block_high: 11, block_low: 12, hit_high_s: 13, hit_high_l: 14, hit_body: 15,
  hit_low: 16, hit_air: 17, crumple: 18, kd_fall_b: 19, kd_fall_f: 20, kd_ground_b: 21, kd_ground_f: 22,
  wake_b: 23, wake_f: 24, wall_splat: 25, thrown_f: 26, thrown_b: 27, dizzy: 28, ko_fall: 29,
  timeover_lose: 30, parry: 31, impact_windup: 32, shove: 33,
} as const;
export const SHARED_COUNT = SHARED_CLIPS.length;

const KIND_MOVE = 1;
const KIND_HIT = 2;
const KIND_LOCO = 3;

let lastKind = 0;

/** The anim id fighter `i` should show now (sets `lastKind` for the blend rule). */
export function desiredAnim(m: Match, i: number): number {
  const s = m.s;
  const b = fb(i);
  const cf = m.cf[i];
  const st = s[b + F.st];
  const sys = m.sys.raw;
  lastKind = 0;
  switch (st) {
    case ST.INTRO:
      return cf.def.intro ? cf.animIntro : A.idle;
    case ST.IDLE:
      lastKind = KIND_LOCO;
      return (s[b + F.flags] & FL.PROX) !== 0 ? A.block_high : A.idle;
    case ST.CROUCH:
      lastKind = KIND_LOCO;
      if ((s[b + F.flags] & FL.PROX) !== 0) return A.block_low;
      return s[b + F.stF] < sys.movement.crouchTransFrames ? A.crouch : A.crouch_idle;
    case ST.WALK_F:
      lastKind = KIND_LOCO;
      return A.walk_f;
    case ST.WALK_B:
      lastKind = KIND_LOCO;
      return A.walk_b;
    case ST.PREJUMP:
    case ST.AIR: {
      const jd = s[b + F.jumpDir];
      return jd > 0 ? A.jump_f : jd < 0 ? A.jump_b : A.jump_up;
    }
    case ST.LAND:
      return A.land;
    case ST.DASH_F:
    case ST.RUSH:
      return A.dash_f;
    case ST.DASH_B:
      return A.dash_b;
    case ST.ATTACK:
    case ST.CINEMATIC: {
      const k = s[b + F.mv];
      if (k < 0) {
        lastKind = KIND_HIT;
        return A.hit_air;
      }
      lastKind = KIND_MOVE;
      return cf.moves[k].animId;
    }
    case ST.HITSTUN:
      lastKind = KIND_HIT;
      return A.hit_high_s + Math.min(3, Math.max(0, s[b + F.stunKind]));
    case ST.BLOCKSTUN:
      lastKind = KIND_HIT;
      if (s[b + F.stunKind] === 4) return A.parry;
      return (s[b + F.flags] & FL.CROUCHING) !== 0 ? A.block_low : A.block_high;
    case ST.JUGGLE:
      lastKind = KIND_HIT;
      return A.hit_air;
    case ST.KNOCKDOWN: {
      if ((s[b + F.wake] & 2) !== 0) return A.wake_b;
      return s[b + F.stF] < sys.kd.fallFrames && s[b + F.after] === 0 ? A.kd_fall_b : A.kd_ground_b;
    }
    case ST.THROWN:
      lastKind = KIND_HIT;
      return s[fb(1 - i) + F.throwDir] === 1 ? A.thrown_b : A.thrown_f;
    case ST.TECH:
      lastKind = KIND_HIT;
      return A.block_high;
    case ST.PARRY:
    case ST.PARRY_REC:
      return A.parry;
    case ST.CRUMPLE:
      lastKind = KIND_HIT;
      return A.crumple;
    case ST.WALL_SPLAT:
      lastKind = KIND_HIT;
      return A.wall_splat;
    case ST.DIZZY:
      lastKind = KIND_HIT;
      return A.dizzy;
    case ST.TAUNT:
      return cf.def.taunt ? cf.animTaunt : A.idle;
    case ST.KO:
      lastKind = KIND_HIT;
      return A.ko_fall;
    case ST.WIN:
      return (cf.def.win ?? []).length > 0 ? cf.animWin : A.idle;
    case ST.LOSE:
      return A.timeover_lose;
    case ST.GRAB: {
      const k = s[b + F.mv];
      const g = k >= 0 ? cf.moves[k].grab : null;
      lastKind = KIND_MOVE;
      return g && g.animId >= 0 ? g.animId : k >= 0 ? cf.moves[k].animId : A.idle;
    }
    default:
      return A.idle;
  }
}

const TP = new Int32Array(6);

/**
 * CHANGED(fixer) D3: THROWN / KNOCKDOWN show shared clips at a sim-chosen clip time (throwpose.ts): the anim frame is a
 * VIRTUAL frame = round(clip seconds * 60), so the view's animFrame / 60 (§17 rule 3) samples that time. A new victim
 * segment (e.g. a second body shot) restarts with a blend like any anim switch.
 */
function timedTick(m: Match, i: number, advance: boolean, want: number, vf: number, inst: number): void {
  const s = m.s;
  const b = fb(i);
  if (want !== s[b + F.animId] || s[b + F.animInst] !== inst) {
    const an = m.sys.raw.anim;
    s[b + F.pAnimId] = s[b + F.animId];
    s[b + F.pAnimF] = s[b + F.animF];
    s[b + F.animId] = want;
    s[b + F.animF] = vf;
    s[b + F.animInst] = inst;
    s[b + F.blendStep] = an.blendHit;
    s[b + F.blendT] = an.blendHit >= 6 ? 6 : 0;
    return;
  }
  s[b + F.animF] = vf;
  if (advance && s[b + F.blendT] < 6) s[b + F.blendT] = Math.min(6, s[b + F.blendT] + s[b + F.blendStep]);
}

/** Updates the anim cursor of fighter `i` (end of every step). */
export function animTick(m: Match, i: number, advance: boolean): void {
  const s = m.s;
  const b = fb(i);
  const st = s[b + F.st];
  if (st === ST.THROWN && victimPose(m, i, TP)) {
    timedTick(m, i, advance, TP[0], TP[1], -1000 - TP[2]);
    return;
  }
  if (st === ST.KNOCKDOWN) {
    knockdownPose(m, i, TP);
    timedTick(m, i, advance, TP[0], TP[1], -2000 - TP[2]);
    return;
  }
  const want = desiredAnim(m, i);
  const kind = lastKind;
  const moveAnim = kind === KIND_MOVE;
  const st0 = s[b + F.st];
  const mvF = st0 === ST.CINEMATIC && s[W.cinFighter] === i ? s[b + F.mvF] + s[W.cinFrame] : st0 === ST.GRAB ? s[b + F.stF] : s[b + F.mvF];
  const restart = moveAnim && s[b + F.animInst] !== s[b + F.mvInst];
  if (want !== s[b + F.animId] || restart) {
    const an = m.sys.raw.anim;
    s[b + F.pAnimId] = s[b + F.animId];
    s[b + F.pAnimF] = s[b + F.animF];
    s[b + F.animId] = want;
    s[b + F.animF] = moveAnim ? mvF : 0;
    s[b + F.animInst] = s[b + F.mvInst];
    const step = kind === KIND_MOVE ? an.blendAttack : kind === KIND_HIT ? an.blendHit : kind === KIND_LOCO ? an.blendLoco : an.blendDefault;
    s[b + F.blendStep] = step;
    s[b + F.blendT] = step >= 6 ? 6 : 0;
    return;
  }
  if (!advance) return;
  s[b + F.animF] = moveAnim ? mvF : s[b + F.animF] + 1;
  if (s[b + F.blendT] < 6) s[b + F.blendT] = Math.min(6, s[b + F.blendT] + s[b + F.blendStep]);
}
