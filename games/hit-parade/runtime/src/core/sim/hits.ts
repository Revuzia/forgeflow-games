// HIT PARADE — per-frame hit resolution (CONTRACT §4.3 items 3-8, 10, 12).
// All strike and projectile contacts of the frame are COLLECTED from the pre-hit state first
// (so trades are symmetric: both hit, both counter-hit), then applied in a fixed order
// (fighter 0's strike, fighter 1's strike, projectiles by slot). Throws resolve afterwards in
// throws.ts, so a strike landing on the same frame as a throw wins.

import { CF, F, FL, MVF, P, PROJ_CAP, ST, W, projBase } from './layout.ts';
import { EV, CUE, SC } from './events.ts';
import { GD } from './compile.ts';
import type { CMove } from './compile.ts';
import { hitRect, hurtRects, pushExt, rectsOverlap } from './boxes.ts';
import { IN } from './inputs.ts';
import {
  addShowtime, clearMove, drainNerve, emit, fb, gainNerve, isAirborne, setSt,
} from './state.ts';
import type { Match } from './state.ts';
import { enterKnockdown } from './fighter.ts';
import { killProjectile } from './projectiles.ts';

export const OUT = { NONE: 0, HIT: 1, BLOCK: 2, PARRY: 3, PPARRY: 4, ARMOR: 5, CLASH: 6 } as const;

// ------------------------------------------------------------------ scratch records (rewritten every frame)
const R_CAP = 16;
const rAtt = new Int32Array(R_CAP);
const rVic = new Int32Array(R_CAP);
const rMove = new Int32Array(R_CAP);
const rHid = new Int32Array(R_CAP);
const rCy = new Int32Array(R_CAP);
const rProj = new Int32Array(R_CAP);
const rInst = new Int32Array(R_CAP);
const rFlags = new Int32Array(R_CAP);
const rDir = new Int32Array(R_CAP);
const rOut = new Int32Array(R_CAP);
const rCounter = new Int32Array(R_CAP);
const rAttX = new Int32Array(R_CAP);
let rN = 0;

const HURT = new Int32Array(24);
const HR = new Int32Array(4);
const PR = new Int32Array(4);

function inRange(inv: Int32Array, o: number, f: number): boolean {
  return inv[o] > 0 && f >= inv[o] && f <= inv[o + 1];
}

/** Can fighter `d` be touched by a strike (proj = false) or projectile (proj = true) of move `mv` now? */
function vulnerable(m: Match, d: number, mv: CMove, attackerAir: boolean, proj: boolean): boolean {
  const s = m.s;
  const bd = fb(d);
  const st = s[bd + F.st];
  switch (st) {
    case ST.INTRO:
    case ST.KO:
    case ST.WIN:
    case ST.LOSE:
    case ST.CINEMATIC:
    case ST.KNOCKDOWN:
    case ST.THROWN:
    case ST.TECH:
      return false;
    default:
      break;
  }
  if (s[bd + F.invS] > 0) return false;
  if (proj && s[bd + F.invP] > 0) return false;
  if (st === ST.ATTACK) {
    const dmv = m.cf[d].moves[s[bd + F.mv]];
    const f = s[bd + F.mvF];
    if (inRange(dmv.inv, 0, f)) return false;
    if (proj && inRange(dmv.inv, 6, f)) return false;
    if (attackerAir && inRange(dmv.inv, 4, f)) return false;
  }
  if (st === ST.JUGGLE && mv.jl < s[bd + F.jc]) return false;
  return true;
}

function push(att: number, vic: number, move: number, hid: number, cy: number, proj: number, inst: number, flags: number, dir: number, attX: number): void {
  if (rN >= R_CAP) return;
  rAtt[rN] = att;
  rVic[rN] = vic;
  rMove[rN] = move;
  rHid[rN] = hid;
  rCy[rN] = cy;
  rProj[rN] = proj;
  rInst[rN] = inst;
  rFlags[rN] = flags;
  rDir[rN] = dir;
  rAttX[rN] = attX;
  rOut[rN] = OUT.NONE;
  rCounter[rN] = 0;
  rN++;
}

function collectStrike(m: Match, a: number): void {
  const s = m.s;
  const ba = fb(a);
  if (s[ba + F.st] !== ST.ATTACK) return;
  const mv = m.cf[a].moves[s[ba + F.mv]];
  if (!mv.isStrike || (s[ba + F.mvFlags] & MVF.CIN) !== 0) return;
  const d = 1 - a;
  const f = s[ba + F.mvF];
  if (!vulnerable(m, d, mv, isAirborne(s, ba), false)) return;
  const nh = hurtRects(m, d, HURT);
  for (let j = 0; j < mv.nBox; j++) {
    const o = j * 7;
    if (f < mv.boxes[o] || f > mv.boxes[o + 1]) continue;
    const hid = mv.boxes[o + 6];
    if (mv.multi > 0) {
      if (s[ba + F.hitCount] > 0 && f - s[ba + F.lastHitF] < mv.multi) continue;
    } else if ((s[ba + F.hitMask] & (1 << hid)) !== 0) continue;
    hitRect(m, a, mv, j, HR, 0);
    for (let r = 0; r < nh; r++) {
      if (!rectsOverlap(HR, 0, HURT, r * 4)) continue;
      push(a, d, mv.idx, hid, mv.boxes[o + 3], -1, s[ba + F.mvInst], s[ba + F.mvFlags], s[ba + F.facing], s[ba + F.x]);
      return;
    }
  }
}

function collectProjectiles(m: Match): void {
  const s = m.s;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0 || s[pb + P.hitCd] > 0) continue;
    const o = s[pb + P.owner];
    const d = 1 - o;
    const mv = m.cf[o].moves[s[pb + P.mv]];
    if (!vulnerable(m, d, mv, false, true)) continue;
    const w2 = s[pb + P.w] >> 1;
    const h2 = s[pb + P.h] >> 1;
    PR[0] = s[pb + P.x] - w2;
    PR[1] = s[pb + P.x] + w2;
    PR[2] = s[pb + P.y] - h2;
    PR[3] = s[pb + P.y] + h2;
    const nh = hurtRects(m, d, HURT);
    for (let r = 0; r < nh; r++) {
      if (!rectsOverlap(PR, 0, HURT, r * 4)) continue;
      const dir = s[pb + P.vx] >= 0 ? 1 : -1;
      push(o, d, mv.idx, 0, s[pb + P.y] - s[fb(d) + F.y], k, s[pb + P.inst], s[pb + P.flags], dir, s[pb + P.x]);
      break;
    }
  }
}

/** Would defender `d` block move `mv` coming from world x `fromX` (pre-hit state)? */
export function canBlock(m: Match, d: number, mv: CMove, fromX: number): boolean {
  if (mv.guard === 0) return false;
  const s = m.s;
  const bd = fb(d);
  if (isAirborne(s, bd)) return false;
  const st = s[bd + F.st];
  if (st !== ST.IDLE && st !== ST.WALK_F && st !== ST.WALK_B && st !== ST.CROUCH && st !== ST.BLOCKSTUN && st !== ST.PARRY_REC) return false;
  const raw = s[bd + F.raw];
  const dx = s[bd + F.x] - fromX;
  const awayRight = dx > 0 || (dx === 0 && s[bd + F.facing] < 0);
  const back = awayRight ? (raw & IN.RIGHT) !== 0 && (raw & IN.LEFT) === 0 : (raw & IN.LEFT) !== 0 && (raw & IN.RIGHT) === 0;
  const crouchG = (raw & IN.DOWN) !== 0 && (raw & IN.UP) === 0;
  if (st === ST.BLOCKSTUN) {
    // auto-guard inside a true blockstring: mids and overheads; lows still need crouch-block
    return !(mv.guard === GD.CROUCH && !crouchG);
  }
  if (!back) return false;
  return (mv.guard & (crouchG ? GD.CROUCH : GD.STAND)) !== 0;
}

/** 0 normal, 1 counter hit, 2 punish counter (pre-hit state of `d`). */
export function counterKind(m: Match, d: number, mv: CMove | null): number {
  const s = m.s;
  const bd = fb(d);
  const st = s[bd + F.st];
  if (st === ST.ATTACK) {
    const dmv = m.cf[d].moves[s[bd + F.mv]];
    if (mv && mv.isImpact && dmv.isImpact) return 2;
    return s[bd + F.mvF] <= dmv.lastActive ? 1 : 2;
  }
  if (st === ST.PARRY_REC || st === ST.RECOVER || st === ST.TAUNT) return 2;
  if (st === ST.DASH_B) {
    const cf = m.cf[d];
    const moving = Math.round((cf.dashBFrames * m.sys.raw.movement.dashMovePct) / 100);
    if (s[bd + F.stF] + 1 > moving) return 2;
  }
  return 0;
}

function outcomeOf(m: Match, r: number): number {
  const s = m.s;
  const a = rAtt[r];
  const d = rVic[r];
  const bd = fb(d);
  const mv = m.cf[a].moves[rMove[r]];
  const st = s[bd + F.st];
  if (st === ST.PARRY) return s[bd + F.parryF] <= m.sys.raw.parry.perfectFrames ? OUT.PPARRY : OUT.PARRY;
  if (st === ST.ATTACK) {
    const dmv = m.cf[d].moves[s[bd + F.mv]];
    const f = s[bd + F.mvF];
    if (rProj[r] < 0 && mv.isImpact && dmv.isImpact) {
      // IMPACT vs IMPACT on the same frame: clash (the other side's record exists too)
      for (let q = 0; q < rN; q++) if (q !== r && rAtt[q] === d && rProj[q] < 0 && m.cf[d].moves[rMove[q]].isImpact) return OUT.CLASH;
    } else if (s[bd + F.armorLeft] > 0 && f >= dmv.armorF0 && f <= dmv.armorF1 && !mv.armorBreak) {
      return OUT.ARMOR;
    }
  }
  if (canBlock(m, d, mv, rAttX[r])) return OUT.BLOCK;
  return OUT.HIT;
}

// ------------------------------------------------------------------ damage + combo bookkeeping
/** Counts an attack into the defender's combo; returns the scaling percent for this hit. */
export function comboStep(m: Match, d: number, inst: number, lightStarter: boolean): number {
  const s = m.s;
  const bd = fb(d);
  const sc = m.sys.raw.scaling;
  if (s[bd + F.cCount] === 0) {
    s[bd + F.cStep] = 0;
    s[bd + F.cStarter] = lightStarter ? 1 : 0;
    s[bd + F.cFlags] = 0;
    s[bd + F.cDamage] = 0;
    s[bd + F.cLastInst] = -1;
    if (s[bd + F.st] === ST.DIZZY) {
      s[bd + F.cStarter] = 1; // STAGE FRIGHT stun: combos start at 80%
      s[bd + F.cStep] = 1;
    }
  }
  if (s[bd + F.ppPending] !== 0) {
    s[bd + F.cFlags] |= CF.PP;
    s[bd + F.ppPending] = 0;
  }
  if (inst !== s[bd + F.cLastInst]) {
    s[bd + F.cStep]++;
    s[bd + F.cLastInst] = inst;
  }
  const step = Math.min(s[bd + F.cStep], 10) - 1;
  const t = s[bd + F.cStarter] !== 0 ? sc.light : sc.general;
  return t[step < 0 ? 0 : step];
}

export function scaledDamage(m: Match, d: number, mv: CMove, base: number, pct: number, counter: number, simple: boolean, isThrow: boolean): number {
  const s = m.s;
  const bd = fb(d);
  const sys = m.sys.raw;
  let p = pct;
  if (mv.isSuper) p = Math.max(p, mv.level === 3 ? sys.scaling.superMinPct.super3 : sys.scaling.superMinPct.super1);
  let dmg = Math.trunc((base * p) / 100);
  if (counter !== 0) dmg = Math.trunc((dmg * (isThrow ? sys.counter.pcThrowDamagePct : counter === 1 ? sys.counter.chDamagePct : sys.counter.pcDamagePct)) / 100);
  if (simple) dmg = Math.trunc((dmg * sys.simple.damagePct) / 100);
  const cf = s[bd + F.cFlags];
  if ((cf & CF.PP) !== 0) dmg = Math.trunc((dmg * sys.scaling.perfectParryPct) / 100);
  if ((cf & CF.RUSH) !== 0) dmg = Math.trunc((dmg * sys.scaling.rushPct) / 100);
  if (base > 0 && dmg < 1) dmg = 1;
  return dmg;
}

/** Applies damage to `d`: real (clears grey) or grey (recoverable). Training keeps HP >= 1. */
export function applyDamage(m: Match, d: number, dmg: number, grey: boolean): void {
  const s = m.s;
  const bd = fb(d);
  s[bd + F.hp] -= dmg;
  if (grey) {
    s[bd + F.grey] += dmg;
    s[bd + F.greyDelay] = 0;
  } else {
    s[bd + F.grey] = 0;
    s[bd + F.greyDelay] = 0;
  }
  if (m.training && s[bd + F.hp] < 1) s[bd + F.hp] = 1;
  s[bd + F.lastDmg] = dmg;
  s[bd + F.cDamage] += dmg;
}

function nearWall(m: Match, d: number, dir: number, range: number): boolean {
  const s = m.s;
  const bd = fb(d);
  const wallX = dir > 0 ? m.sys.wall : -m.sys.wall;
  // CHANGED(fixer) D2: the victim's push-box edge on the wall side
  return Math.abs(wallX - s[bd + F.x]) - pushExt(m, d, dir > 0 ? 1 : -1) <= range;
}

function toJuggle(m: Match, d: number, vx: number, vy: number): void {
  const s = m.s;
  const bd = fb(d);
  clearMove(m, d);
  setSt(m, d, ST.JUGGLE);
  s[bd + F.flags] = (s[bd + F.flags] | FL.AIRBORNE) & ~(FL.CROUCHING | FL.PROX | FL.BLOCKING);
  s[bd + F.vx] = vx;
  s[bd + F.vy] = vy;
  s[bd + F.stun] = 0;
  s[bd + F.pushF] = 0;
  s[bd + F.pushLeft] = 0;
}

function toWallSplat(m: Match, a: number, d: number, dir: number): void {
  const s = m.s;
  const bd = fb(d);
  clearMove(m, d);
  setSt(m, d, ST.WALL_SPLAT);
  s[bd + F.stun] = m.sys.raw.wallSplat.frames;
  s[bd + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING);
  s[bd + F.x] = (dir > 0 ? m.sys.wall : -m.sys.wall) - dir * pushExt(m, d, dir > 0 ? 1 : -1); // CHANGED(fixer) D2
  s[bd + F.vx] = 0;
  s[bd + F.vy] = 0;
  s[bd + F.pushF] = 0;
  s[bd + F.pushLeft] = 0;
  s[bd + F.cFlags] |= CF.SPLAT;
  s[bd + F.jc] = 0;
  emit(m, EV.WALL_SPLAT, d, dir > 0 ? 1 : 0, 0, 0);
  emit(m, EV.CAMERA_CUE, a, CUE.WALL_SPLAT, 0, 0);
}

function toCrumple(m: Match, d: number): void {
  const s = m.s;
  const bd = fb(d);
  clearMove(m, d);
  setSt(m, d, ST.CRUMPLE);
  s[bd + F.stun] = m.sys.raw.crumple.frames;
  s[bd + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING);
  s[bd + F.jc] = 0;
  emit(m, EV.CRUMPLE, d, 0, 0, 0);
}

function toDizzy(m: Match, d: number): void {
  const s = m.s;
  const bd = fb(d);
  clearMove(m, d);
  setSt(m, d, ST.DIZZY);
  s[bd + F.stun] = m.sys.raw.stageFright.cornerImpactStun;
  s[bd + F.flags] &= ~(FL.AIRBORNE | FL.CROUCHING);
  emit(m, EV.CRUMPLE, d, 1, 0, 0);
}

function attackerContact(m: Match, a: number, r: number, kind: number): void {
  if (rProj[r] >= 0) return;
  const s = m.s;
  const ba = fb(a);
  if (s[ba + F.mv] !== rMove[r]) return; // interrupted by a trade this frame
  if (s[ba + F.contact] === 0) s[ba + F.contactF] = s[ba + F.mvF];
  if (kind === 1 || s[ba + F.contact] === 0) s[ba + F.contact] = kind;
  s[ba + F.hitMask] |= 1 << rHid[r];
  s[ba + F.hitCount]++;
  s[ba + F.lastHitF] = s[ba + F.mvF];
}

function setHitstop(m: Match, a: number, d: number, r: number, hs: number): void {
  const s = m.s;
  const bd = fb(d);
  if (s[bd + F.hitstop] < hs) s[bd + F.hitstop] = hs;
  if (rProj[r] < 0) {
    const ba = fb(a);
    if (s[ba + F.hitstop] < hs) s[ba + F.hitstop] = hs;
  }
}

function projHit(m: Match, r: number): void {
  const k = rProj[r];
  if (k < 0) return;
  const s = m.s;
  const pb = projBase(k);
  s[pb + P.hitCd] = 12;
  if (--s[pb + P.hits] <= 0) killProjectile(m, k);
}

function cm(y: number): number {
  return Math.trunc(y / 1000);
}

// ------------------------------------------------------------------ outcomes
export function startCinematic(m: Match, a: number, d: number, mv: CMove): void {
  const s = m.s;
  const ba = fb(a);
  const bd = fb(d);
  if (!mv.cin) return;
  s[W.cinActive] = 1;
  s[W.cinFighter] = a;
  s[W.cinMove] = mv.idx;
  s[W.cinFrame] = 0;
  s[W.cinLen] = mv.cin.frames;
  s[W.cinHit] = 0;
  s[ba + F.mvFlags] |= MVF.CIN;
  if (s[ba + F.contact] === 0) s[ba + F.contactF] = s[ba + F.mvF];
  s[ba + F.contact] = 1;
  setSt(m, a, ST.CINEMATIC);
  clearMove(m, d);
  setSt(m, d, ST.CINEMATIC);
  s[bd + F.pushF] = 0;
  s[bd + F.pushLeft] = 0;
  emit(m, EV.HIT, a, d, SC.SUPER, Math.trunc((mv.nBox > 0 ? mv.boxes[3] : 120000) / 1000));
  emit(m, EV.CINEMATIC_START, a, mv.snapId, 0, 0);
  emit(m, EV.CAMERA_CUE, a, CUE.CINEMATIC, 0, 0);
}

function applyHit(m: Match, r: number): void {
  const s = m.s;
  const sys = m.sys.raw;
  const a = rAtt[r];
  const d = rVic[r];
  const ba = fb(a);
  const bd = fb(d);
  const mv = m.cf[a].moves[rMove[r]];
  const proj = rProj[r] >= 0;
  const counter = rCounter[r];
  const dir = rDir[r];
  if (mv.cin && !proj) {
    startCinematic(m, a, d, mv);
    return;
  }
  const dst = s[bd + F.st];
  const wasAir = isAirborne(s, bd) || dst === ST.JUGGLE;
  const wasJumping = wasAir && dst !== ST.JUGGLE;
  const freeJuggle = dst === ST.WALL_SPLAT || dst === ST.CRUMPLE;
  const pct = comboStep(m, d, rInst[r] + (proj ? 1 << 20 : 0), mv.lightStarter);
  if ((rFlags[r] & MVF.RUSH) !== 0 && s[bd + F.cCount] > 0) s[bd + F.cFlags] |= CF.RUSH;
  const hid = rHid[r];
  // CONTRACT 20.2 multi-hit: non-final hits hold the defender until the next hit's first frame + 2;
  // stun / onHit / pushback of the move apply to the final hit
  const nonFinal = !proj && hid < mv.nHid - 1;
  const base = proj ? mv.damage : mv.hidDmg[hid];
  const dmg = scaledDamage(m, d, mv, base, pct, counter, (rFlags[r] & MVF.SIMPLE) !== 0, false);
  applyDamage(m, d, dmg, mv.isShove); // SHOVE damage is grey HP only (FIGHTING_DESIGN 2f)
  s[bd + F.cCount]++;
  s[bd + F.counterFlag] = counter;
  // meters
  addShowtime(m, a, mv.gainShow);
  addShowtime(m, d, Math.trunc((mv.gainShow * sys.showtime.defHitPct) / 100));
  gainNerve(m, a, sys.nerve.hitGain);
  if (counter === 2) drainNerve(m, d, mv.nerveDrain);
  // hitstop
  let hs = mv.hitstop;
  if (!proj && mv.hidHs[hid] >= 0) hs = mv.hidHs[hid];
  else if (mv.isSuper && hid === mv.nHid - 1) hs = Math.max(hs, sys.hitstop.superLast);
  if (counter === 2 && mv.str === 2 && mv.isNormalCat) hs += sys.hitstop.pcHeavyBonus;
  const bonus = (counter === 1 ? sys.counter.chFrames : counter === 2 ? sys.counter.pcFrames : 0) + ((rFlags[r] & MVF.RUSH) !== 0 ? sys.rush.advBonus : 0);
  // victim reaction
  const frightCorner = mv.isImpact && s[bd + F.fright] !== 0 && nearWall(m, d, dir, m.sys.frightCorner);
  let grounded = false;
  if (nonFinal && !wasAir) {
    clearMove(m, d);
    setSt(m, d, ST.HITSTUN);
    s[bd + F.stun] = Math.max(1, mv.hidF0[hid + 1] + 2 - s[fb(a) + F.mvF]);
    s[bd + F.lastStun] = s[bd + F.stun];
    s[bd + F.stunKind] = mv.guard === GD.CROUCH ? 3 : rCy[r] < 100000 ? 2 : mv.str === 2 ? 1 : 0;
  } else if (nonFinal) {
    const jc = s[bd + F.jc];
    toJuggle(m, d, dir * (m.sys.popVx >> 1), m.sys.popVy >> 1);
    s[bd + F.jc] = jc;
    s[bd + F.kd] = Math.max(s[bd + F.kd], 1);
  } else if (frightCorner) {
    toDizzy(m, d);
  } else if (mv.isImpact && (s[bd + F.armorAbs] > 0 || counter === 2) && !wasAir) {
    toCrumple(m, d);
  } else if (mv.wallSplat && (s[bd + F.cFlags] & CF.SPLAT) === 0 && nearWall(m, d, dir, m.sys.splatRange)) {
    toWallSplat(m, a, d, dir);
  } else if (mv.isImpact && !wasAir && nearWall(m, d, dir, m.sys.impactSplat) && (s[bd + F.cFlags] & CF.SPLAT) === 0) {
    toWallSplat(m, a, d, dir);
  } else if (mv.crumple && !wasAir) {
    toCrumple(m, d);
  } else if (mv.groundBounce && (s[bd + F.cFlags] & CF.BOUNCE) === 0) {
    const jc = wasAir ? s[bd + F.jc] + mv.ji : mv.js;
    toJuggle(m, d, dir * m.sys.popVx, -m.sys.popVy);
    s[bd + F.bounce] = 1;
    s[bd + F.cFlags] |= CF.BOUNCE;
    s[bd + F.jc] = jc;
    s[bd + F.kd] = Math.max(s[bd + F.kd], mv.kd, 1);
  } else if (mv.launchVy > 0) {
    const jc = wasAir ? s[bd + F.jc] + mv.ji : mv.js;
    toJuggle(m, d, dir * mv.launchVx, mv.launchVy);
    s[bd + F.jc] = jc;
    s[bd + F.kd] = Math.max(s[bd + F.kd], mv.kd || 1);
  } else if (wasJumping) {
    toJuggle(m, d, dir * m.sys.airResetVx, m.sys.airResetVy);
    s[bd + F.jc] = mv.js;
    s[bd + F.kd] = mv.kd;
  } else if (wasAir || freeJuggle) {
    const jc = wasAir ? s[bd + F.jc] + mv.ji : mv.js;
    toJuggle(m, d, dir * m.sys.popVx, m.sys.popVy);
    s[bd + F.jc] = jc;
    s[bd + F.kd] = Math.max(s[bd + F.kd], mv.kd, 1);
  } else if (mv.kd > 0) {
    const total = Math.max(mv.hitstun, sys.kd.fallFrames + sys.kd.wakeupFrames + 1, sys.kd.minTotal);
    enterKnockdown(m, d, total, mv.kd);
    grounded = true;
  } else {
    clearMove(m, d);
    setSt(m, d, ST.HITSTUN);
    s[bd + F.stun] = mv.hitstun + bonus;
    s[bd + F.lastStun] = s[bd + F.stun];
    s[bd + F.stunKind] = mv.guard === GD.CROUCH ? 3 : rCy[r] < 100000 ? 2 : mv.str === 2 ? 1 : 0;
    grounded = true;
  }
  if (grounded && !nonFinal) {
    s[bd + F.pushLeft] = dir * mv.pushHit;
    s[bd + F.pushF] = sys.pushback.frames;
    if (!proj) s[bd + F.flags] |= FL.PUSHX;
    else s[bd + F.flags] &= ~FL.PUSHX;
  }
  setHitstop(m, a, d, r, hs);
  attackerContact(m, a, r, 1);
  projHit(m, r);
  const sc = proj ? SC.PROJECTILE : mv.sc;
  emit(m, EV.HIT, a, d, sc, cm(rCy[r]));
  if (proj) emit(m, EV.PROJ_HIT, a, d, sc, cm(rCy[r]));
  if (counter === 1) emit(m, EV.COUNTER, a, d, sc, cm(rCy[r]));
  else if (counter === 2) emit(m, EV.PUNISH, a, d, sc, cm(rCy[r]));
  if (mv.isSuper) emit(m, EV.SUPER_HIT, a, d, SC.SUPER, cm(rCy[r]));
  void ba;
}

function applyBlock(m: Match, r: number): void {
  const s = m.s;
  const sys = m.sys.raw;
  const a = rAtt[r];
  const d = rVic[r];
  const bd = fb(d);
  const mv = m.cf[a].moves[rMove[r]];
  const proj = rProj[r] >= 0;
  const dir = rDir[r];
  const fright = s[bd + F.fright] !== 0;
  const crouchG = (s[bd + F.raw] & IN.DOWN) !== 0 && (s[bd + F.raw] & IN.UP) === 0;
  const hid = rHid[r];
  const nonFinal = !proj && hid < mv.nHid - 1;
  const base = proj ? mv.damage : mv.hidDmg[hid];
  clearMove(m, d);
  setSt(m, d, ST.BLOCKSTUN);
  s[bd + F.stun] = nonFinal
    ? Math.max(1, mv.hidF0[hid + 1] + 2 - s[fb(a) + F.mvF])
    : mv.blockstun + (fright ? sys.stageFright.blockstunBonus : 0) + ((rFlags[r] & MVF.RUSH) !== 0 ? sys.rush.advBonus : 0);
  s[bd + F.lastStun] = s[bd + F.stun];
  s[bd + F.stunKind] = crouchG ? 1 : 0;
  s[bd + F.flags] = (s[bd + F.flags] & ~FL.PROX) | FL.BLOCKING;
  if (crouchG) s[bd + F.flags] |= FL.CROUCHING;
  else s[bd + F.flags] &= ~FL.CROUCHING;
  // chip: specials / supers / projectiles
  if (mv.isSpecialCat || mv.isSuper || proj) {
    if (fright) applyDamage(m, d, Math.trunc((base * sys.stageFright.chipPct) / 100), false);
    else if (mv.chipPct > 0) applyDamage(m, d, Math.trunc((base * mv.chipPct) / 100), true);
  }
  s[bd + F.nerveBlk] = sys.nerve.blockRegenStop;
  if (!nonFinal) {
    drainNerve(m, d, mv.nerveDrain);
    addShowtime(m, a, Math.trunc((mv.gainShow * sys.showtime.blockPct) / 100));
    addShowtime(m, d, Math.trunc((mv.gainShow * sys.showtime.defBlockPct) / 100));
    s[bd + F.pushLeft] = dir * mv.pushBlock;
    s[bd + F.pushF] = sys.pushback.frames;
    if (!proj) s[bd + F.flags] |= FL.PUSHX;
    else s[bd + F.flags] &= ~FL.PUSHX;
  }
  if (mv.isImpact) {
    if (fright && nearWall(m, d, dir, m.sys.frightCorner)) toDizzy(m, d);
    else if (nearWall(m, d, dir, m.sys.impactSplat) && (s[bd + F.cFlags] & CF.SPLAT) === 0) toWallSplat(m, a, d, dir);
  }
  setHitstop(m, a, d, r, mv.hitstop);
  attackerContact(m, a, r, 2);
  projHit(m, r);
  emit(m, EV.BLOCK, a, d, proj ? SC.PROJECTILE : mv.sc, cm(rCy[r]));
  if (proj) emit(m, EV.PROJ_HIT, a, d, SC.PROJECTILE, cm(rCy[r]));
}

function applyParry(m: Match, r: number, perfect: boolean): void {
  const s = m.s;
  const sys = m.sys.raw;
  const a = rAtt[r];
  const d = rVic[r];
  const ba = fb(a);
  const bd = fb(d);
  const mv = m.cf[a].moves[rMove[r]];
  const proj = rProj[r] >= 0;
  const dir = rDir[r];
  const refund = proj ? sys.parry.refund.projectile : mv.isSuper || mv.isImpact ? sys.parry.refund.super : sys.parry.refund.strike;
  gainNerve(m, d, refund);
  s[bd + F.parryOk] = 1;
  const sc = proj ? SC.PROJECTILE : mv.sc;
  if (perfect && proj) {
    setSt(m, d, ST.PARRY_REC);
    s[bd + F.stun] = sys.parry.projPerfectRecovery;
    s[bd + F.invT] = Math.max(s[bd + F.invT], sys.parry.projPerfectRecovery);
    killProjectile(m, rProj[r]);
    emit(m, EV.PERFECT_PARRY, a, d, sc, cm(rCy[r]));
    return;
  }
  if (perfect) {
    s[W.freeze] = sys.parry.perfectFreeze;
    s[W.freezeKind] = 2;
    s[W.freezeOwner] = d;
    setSt(m, d, ST.IDLE);
    s[bd + F.stun] = 0;
    const inv = sys.parry.perfectInvulnAfter;
    s[bd + F.invS] = Math.max(s[bd + F.invS], inv);
    s[bd + F.invT] = Math.max(s[bd + F.invT], inv);
    s[bd + F.invP] = Math.max(s[bd + F.invP], inv);
    s[ba + F.mvFlags] |= MVF.NOCANCEL;
    s[ba + F.ppPending] = 1;
    attackerContact(m, a, r, 2);
    emit(m, EV.PERFECT_PARRY, a, d, sc, cm(rCy[r]));
    emit(m, EV.CAMERA_CUE, d, CUE.PERFECT_PARRY, 0, 0);
    return;
  }
  setSt(m, d, ST.BLOCKSTUN);
  s[bd + F.stun] = mv.blockstun;
  s[bd + F.lastStun] = mv.blockstun;
  s[bd + F.stunKind] = 4;
  const half = mv.pushBlock >> 1;
  s[bd + F.pushLeft] = dir * (proj ? mv.pushBlock : half);
  s[bd + F.pushF] = sys.pushback.frames;
  s[bd + F.flags] &= ~FL.PUSHX;
  if (!proj && !isAirborne(s, ba)) {
    s[ba + F.pushLeft] = -dir * (mv.pushBlock - half);
    s[ba + F.pushF] = sys.pushback.frames;
    s[ba + F.flags] &= ~FL.PUSHX;
  }
  setHitstop(m, a, d, r, mv.hitstop);
  attackerContact(m, a, r, 2);
  projHit(m, r);
  emit(m, EV.PARRY, a, d, sc, cm(rCy[r]));
}

function applyArmor(m: Match, r: number): void {
  const s = m.s;
  const sys = m.sys.raw;
  const a = rAtt[r];
  const d = rVic[r];
  const bd = fb(d);
  const mv = m.cf[a].moves[rMove[r]];
  s[bd + F.armorLeft]--;
  s[bd + F.armorAbs]++;
  applyDamage(m, d, rProj[r] >= 0 ? mv.damage : mv.hidDmg[rHid[r]], true);
  addShowtime(m, a, Math.trunc((mv.gainShow * sys.showtime.blockPct) / 100));
  setHitstop(m, a, d, r, mv.hitstop);
  attackerContact(m, a, r, 1);
  projHit(m, r);
  emit(m, EV.IMPACT_ARMOR, d, a, rProj[r] >= 0 ? SC.PROJECTILE : mv.sc, cm(rCy[r]));
}

function applyClash(m: Match, r: number): void {
  const s = m.s;
  const sys = m.sys.raw;
  const a = rAtt[r];
  if (a !== 0) return; // one record handles both fighters
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    gainNerve(m, i, sys.nerve.impactCost);
    clearMove(m, i);
    setSt(m, i, ST.RECOVER);
    s[b + F.stun] = 20;
    s[b + F.pushLeft] = -s[b + F.facing] * (m.cf[i].moves[m.cf[i].impact].pushBlock >> 1);
    s[b + F.pushF] = sys.pushback.frames;
    s[b + F.flags] &= ~FL.PUSHX;
    if (s[b + F.hitstop] < sys.impact.hitstop) s[b + F.hitstop] = sys.impact.hitstop;
  }
  emit(m, EV.IMPACT_CLASH, 0, 1, SC.IMPACT, 0);
}

/** Collects and applies every strike / projectile contact of this frame. */
export function resolveHits(m: Match): void {
  rN = 0;
  collectStrike(m, 0);
  collectStrike(m, 1);
  collectProjectiles(m);
  if (rN === 0) return;
  for (let r = 0; r < rN; r++) {
    rOut[r] = outcomeOf(m, r);
    rCounter[r] = rOut[r] === OUT.HIT ? counterKind(m, rVic[r], m.cf[rAtt[r]].moves[rMove[r]]) : 0;
  }
  for (let r = 0; r < rN; r++) {
    // a victim knocked into a cinematic / KO by an earlier record this frame takes nothing more
    const vst = m.s[fb(rVic[r]) + F.st];
    if (vst === ST.CINEMATIC && rOut[r] !== OUT.CLASH) continue;
    switch (rOut[r]) {
      case OUT.HIT:
        applyHit(m, r);
        break;
      case OUT.BLOCK:
        applyBlock(m, r);
        break;
      case OUT.PARRY:
        applyParry(m, r, false);
        break;
      case OUT.PPARRY:
        applyParry(m, r, true);
        break;
      case OUT.ARMOR:
        applyArmor(m, r);
        break;
      case OUT.CLASH:
        applyClash(m, r);
        break;
      default:
        break;
    }
  }
}
