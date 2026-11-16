// Joint moments (LIFE.md 6.1): S01 greet, S02 chat, S03 boop (a soft boop where its two bodies do not fit, D-85), S04 nuzzle, S05 copy and
// parade, S06 sing together (sim-time bars, D-66), S07 snuggle (a behaviour: gathers 3+ into a row, D-75), S09 comfort, S10 teeter, S11 push
// the swing (the ride allowance, D-85), S12 pass the ball, S13 peekaboo (the two peek spots, D-75), S15 twin dance, S17 duet, S18 twirl. A
// moment reserves every member at its start (no character is in two at once, LF-11) and moves ONE character at a time (LF-10); only S15 and
// S18 move two together, and only where moverCap is 2 or more. Points are the reducer's: LIFE emits SOCIAL events with a, b, n2. Owned by PG_LIFE.
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../contracts.ts';
import { SOCIAL_KIND, LIFE_EV, LIFE_FLAG, EMOTE, SOCIAL } from '../data/life.ts';
import { MECH } from '../data/places.ts';
import type { LifeWorld } from './world.ts';
import { CAP, F, MAX_MOMENTS, MAX_MEMBERS, BEH, pushEvent, pairIdx, rnd, U16, dmm, inBounds, shrinkMm } from './world.ts';
import { gateStart, gateFits, stopMove, travelTo, travelStep, emitHop, emitPose, clearPose, emitGaze, emitEmote, emitExpr, emitScoot,
  HELD_BITS } from './act.ts';
import { MOVER_CAP, tierOf, UNIT, STYLE } from './attention.ts';
import { emitVoice, PHRASE, toNextBarMs, BAR_S } from './voice.ts';
import { TRAIT } from './traits.ts';

export const S = SOCIAL_KIND;
/** Moment ids (S01..S18 = 1..18), as LIFE 6.1 numbers them; the SOCIAL event's sub is SOCIAL[id - 1].kind (S05 is COPY or PARADE). */
export const MOM = { GREET: 1, CHAT: 2, BOOP: 3, NUZZLE: 4, COPY: 5, SING: 6, SNUGGLE: 7, PILE: 8, COMFORT: 9, TEETER: 10, PUSH: 11, PASS: 12,
  PEEK: 13, SQUIRT: 14, MIRROR: 15, ECHO: 16, DUET: 17, TWIRL: 18 } as const;
/** Pair bits of the once-per-visit moments. */
const PB = { GREET: 1, MIRROR: 2, DUET: 4, TWIRL: 8 } as const;

export function mem(w: LifeWorld, m: number, k: number): number { return w.mMem[m * MAX_MEMBERS + k]; }

/** Is character j free to join a moment (not HELD, not in a moment, idle-ish, not napping, not on a ride unless allowed)? */
export function isFree(w: LifeWorld, s: LifeSnapshot, j: number, rideOk: boolean): boolean {
  if (j < 0 || j >= s.n || !w.active[j] || w.moment[j] >= 0) return false;
  if ((s.flags[j] & HELD_BITS) !== 0) return false;
  if (!rideOk && (s.flags[j] & LIFE_FLAG.RIDE) !== 0) return false;
  const b = w.beh[j];
  // the still, short behaviours (notice, watch, answer) give way to a moment; a wander stops for it
  return b === BEH.NONE || b === BEH.IDLE || b === BEH.WANDER || b === BEH.NOTICE || b === BEH.WATCH || b === BEH.ANSWER || (rideOk && b === BEH.RIDE);
}

function freeSlot(w: LifeWorld): number {
  for (let m = 0; m < MAX_MOMENTS; m++) if (w.mKind[m] === 0) return m;
  return -1;
}

/** Start moment `kind` with members a, b (and c..f, -1 for none): reserves them all at once or nothing (LF-11). Returns the moment or -1. */
export function startMoment(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, kind: number, a: number, b: number, c: number): number {
  const tb = w.f[F.NOW];
  const m = freeSlot(w);
  if (m < 0) return -1;
  if (a < 0 || w.moment[a] >= 0 || (b >= 0 && w.moment[b] >= 0) || (c >= 0 && w.moment[c] >= 0)) return -1;
  w.mKind[m] = kind; w.mN[m] = 0; w.mT0[m] = tb; w.mEnd[m] = tb + 60; w.mPhase[m] = 0; w.mTurn[m] = 0; w.mNext[m] = tb; w.mStep[m] = 0;
  w.mThing[m] = -1; w.mSoft[m] = 0; w.mRide[m] = 0; w.mCount[m] = 0;
  for (let k = 0; k < MAX_MEMBERS; k++) w.mMem[m * MAX_MEMBERS + k] = -1;
  addMember(w, out, m, a);
  if (b >= 0) addMember(w, out, m, b);
  if (c >= 0) addMember(w, out, m, c);
  return m;
}
export function addMember(w: LifeWorld, out: LifeIntents, m: number, j: number): boolean {
  const tb = w.f[F.NOW];
  if (j < 0 || w.moment[j] >= 0 || w.mN[m] >= MAX_MEMBERS) return false;
  if (w.moving[j]) stopMove(w, out, j);
  w.mMem[m * MAX_MEMBERS + w.mN[m]++] = j; w.moment[j] = m; w.beh[j] = BEH.MOMENT; w.phase[j] = 0; w.behT0[j] = tb;
  return true;
}

/** End moment m: release its members (stop their motion, clear their poses), optionally emitting its SOCIAL event. */
export function endMoment(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, m: number, emit: boolean): void {
  const tb = w.f[F.NOW];
  const kind = w.mKind[m];
  if (kind === 0) return;
  const n = w.mN[m], a = mem(w, m, 0), b = n > 1 ? mem(w, m, 1) : -1;
  if (emit) {
    let sub = SOCIAL[kind - 1].kind;
    if (kind === MOM.COPY && n >= 3) sub = S.PARADE;
    pushEvent(ev, LIFE_EV.SOCIAL, sub, a, b, n, w.mThing[m] >= 0 ? w.thingGlobal[w.mThing[m]] : -1);
    for (let k = 0; k < n; k++) { const j = mem(w, m, k); if (j >= 0) { w.company[j] = Math.max(0, w.company[j] - 0.5); w.lastJoyT[j] = tb; } }
    if (a >= 0 && b >= 0) w.pairCool[pairIdx(a, b)] = tb + 20;
  }
  for (let k = 0; k < n; k++) {
    const j = mem(w, m, k);
    if (j < 0) continue;
    if (w.moving[j]) stopMove(w, out, j);
    if ((s.flags[j] & HELD_BITS) === 0) clearPose(w, s, out, j);
    w.moment[j] = -1; w.beh[j] = BEH.IDLE; w.phase[j] = 0; w.behT0[j] = tb; w.behScore[j] = 0.1;
    if ((s.flags[j] & LIFE_FLAG.RIDE) !== 0 && (kind === MOM.TEETER || kind === MOM.PUSH)) { w.beh[j] = BEH.RIDE; w.rideUntil[j] = tb; }
  }
  if (kind === MOM.PUSH || kind === MOM.TEETER) w.att.allowance = 0;
  w.mKind[m] = 0; w.mN[m] = 0;
}

/** A member was touched (HELD): the moment ends for everyone; the others wait 2 s, then a small "your turn" hop (5.5). */
export function abortFor(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, j: number): void {
  const tb = w.f[F.NOW];
  const m = w.moment[j];
  if (m < 0) return;
  for (let k = 0; k < w.mN[m]; k++) { const o = mem(w, m, k); if (o >= 0 && o !== j) w.partnerWaitT[o] = tb + 2; }
  endMoment(w, s, out, ev, m, false);
}

/* ───────────────────────────── choosing a moment (scores feed the brain's utility choice) ───────────────────────────── */

function idle(w: LifeWorld, j: number): boolean { const b = w.beh[j]; return b === BEH.IDLE || b === BEH.NONE || b === BEH.WANDER || b === BEH.NOTICE || b === BEH.WATCH; }

/** The best moment character i could start now: its id (0 none); score into w.f[F.A], partner into w.f[F.B], a third member into w.f[F.C]. */
export function socialPick(w: LifeWorld, s: LifeSnapshot, i: number, canMove: boolean): number {
  const tb = w.f[F.NOW];
  w.f[F.A] = 0; w.f[F.B] = -1; w.f[F.C] = -1;
  if (w.kind[i] === 2 || !isFree(w, s, i, false)) return 0;
  const tr = i * 5, whole = w.kind[i] === 0;
  let best = 0, bs = 0, bp = -1, nIdle = 0, happy = tb - w.lastJoyT[i] < 8;
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.active[j]) continue;
    // S11 push the swing: any other squishy within 2.5 m of a rider the player set on a swing (the rider is RIDE, not free)
    if (canMove && (s.flags[j] & LIFE_FLAG.RIDE) !== 0 && w.moment[j] < 0 && (s.flags[j] & HELD_BITS) === 0 && dmm(s, i, j) < 3300) {
      const rt = w.rideThing[j];
      if (rt >= 0 && w.thingMech[rt] === MECH.swing && w.thingPushX[rt] === w.thingPushX[rt] && 0.8 > bs) { bs = 0.8; best = MOM.PUSH; bp = j; }
      continue;
    }
    if (!isFree(w, s, j, false)) continue;
    const d = dmm(s, i, j) * 0.001, p = pairIdx(i, j), lvl = w.pairLevel[p], cool = tb < w.pairCool[p];
    if (d < 2.5 && idle(w, j) && w.kind[j] !== 2) { nIdle++; if (tb - w.lastJoyT[j] < 8) happy = true; }
    if (w.kind[j] === 2) continue;
    let sc = 0, k = 0;
    // S01 greet: another whole within 1.6 m (+0.5 m for a shy newcomer), not greeted this visit
    // (my reading: in the first 60 s of a visit the party says hello before anything else, so every pair greets; a pair farther than 1.6 m
    // walks over first, one mover at a time)
    const early = tb - w.addT[i] < 60 && tb - w.addT[j] < 60 ? 1 : 0;
    if (whole && w.kind[j] === 0 && (w.pairGreet[p] & PB.GREET) === 0 && d < 1.6 + (tb < w.shyUntil[i] || tb < w.shyUntil[j] ? 0.5 : 0)) { sc = early ? 1.15 : 0.85; k = MOM.GREET; }
    else if (whole && canMove && w.kind[j] === 0 && (w.pairGreet[p] & PB.GREET) === 0 && d < 1.2 + 1.0 * w.traits[tr + TRAIT.curious] + 2.6 && idle(w, j) && tb >= w.shyUntil[i]) { sc = early ? 1.1 : 0.6; k = MOM.GREET; }
    if (!cool && idle(w, i) && idle(w, j)) {
      // S15 twin dance
      if (whole && w.kind[j] === 0 && w.species[j] === w.species[i] && d < 2 && (w.pairGreet[p] & PB.MIRROR) === 0 && 0.9 > sc) { sc = 0.9; k = MOM.MIRROR; }
      // S02 chat
      if (whole && w.kind[j] === 0 && lvl >= 1 && d < 1.5 && w.pairChats[p] < 3) { const v = 0.35 + 0.3 * w.traits[tr + TRAIT.chatty]; if (v > sc) { sc = v; k = MOM.CHAT; } }
      // S03 boop
      if (w.traits[tr + TRAIT.bouncy] > 0.6 && d < 1.2 && canMove) { const v = 0.35 + 0.3 * w.traits[tr + TRAIT.bouncy] * w.play[i]; if (v > sc) { sc = v; k = MOM.BOOP; } }
      // S04 nuzzle
      if (d < 1.0 + s.r[i] + s.r[j] - 0.9 + 0.9 && d < 1.0 + 0.2 && (lvl >= 2 || w.traits[tr + TRAIT.cuddly] >= 0.6 || w.traits[j * 5 + TRAIT.cuddly] >= 0.6) && canMove) {
        const v = 0.4 + 0.3 * w.traits[tr + TRAIT.cuddly]; if (v > sc) { sc = v; k = MOM.NUZZLE; } }
      // S17 duet / S18 twirl (once per visit)
      if (whole && w.kind[j] === 0 && lvl >= 2 && (w.pairGreet[p] & PB.DUET) === 0 && d < 2.5 && 0.5 > sc) { sc = 0.5; k = MOM.DUET; }
      if (whole && w.kind[j] === 0 && lvl >= 3 && (w.pairGreet[p] & PB.TWIRL) === 0 && d < 2 && 0.55 > sc) { sc = 0.55; k = MOM.TWIRL; }
      // S05 copy: a curious one sees a hop or a thing use within 2 m
      if (w.traits[tr + TRAIT.curious] > 0.5 && d < 2 && tb - w.lastHopT[j] < 1 && canMove) { const v = 0.45 + 0.3 * w.traits[tr + TRAIT.curious]; if (v > sc) { sc = v; k = MOM.COPY; } }
      // S12 pass the ball: two within 2.5 m of a ball, one bouncy > 0.5
      if (canMove && (w.traits[tr + TRAIT.bouncy] > 0.5 || w.traits[j * 5 + TRAIT.bouncy] > 0.5) && w.play[i] > 0.4) {
        const ball = ballNear(w, s, i, j);
        if (ball >= 0) { const v = 0.5 + 0.3 * w.play[i]; if (v > sc) { sc = v; k = MOM.PASS; } }
      }
      // S13 peekaboo
      if (canMove && whole && d < 3) { const pk = peekThing(w, s, i, j); if (pk >= 0) { const v = 0.4 + 0.3 * w.traits[tr + TRAIT.curious]; if (v > sc) { sc = v; k = MOM.PEEK; } } }
    }
    // S09 comfort (B17): a Met-or-closer friend within 2.5 m chilly, soaked or just huffed; cuddly > 0.4
    if (whole && lvl >= 1 && d < 2.5 && w.traits[tr + TRAIT.cuddly] > 0.4 && tb >= w.cool[i * 26 + BEH.COMFORT] && canMove &&
      (w.looks[j * 6] > 0.5 || w.looks[j * 6 + 2] > 0.5 || tb - w.huffT[j] < 5) && 0.85 > sc) { sc = 0.85; k = MOM.COMFORT; }
    if (k !== 0 && sc > bs) { bs = sc; best = k; bp = j; }
  }
  // S06 sing together: a tune plays (Music Box, the kettle) and 2+ idle within 2.5 m of it, or 2 chatty friends, once per 2 min per place
  if (tb - w.f[F.SONG] >= 120 && idle(w, i) && nIdle >= 1) {
    let v = 0;
    if (s.musicBoxOn && tuneNear(w, s, i)) v = 0.8;
    else if (w.traits[tr + TRAIT.chatty] > 0.6 && friendChattyNear(w, s, i)) v = 0.45;
    if (v > bs) { bs = v; best = MOM.SING; bp = -1; }
  }
  // S07 snuggle: 3 or more idle (not napping) within 2.5 m, any one of them happy
  if (canMove && nIdle >= 2 && happy && idle(w, i) && 0.55 > bs && tb >= w.cool[i * 26 + BEH.MOMENT]) { bs = 0.55; best = MOM.SNUGGLE; bp = -1; }
  w.f[F.A] = bs; w.f[F.B] = bp;
  return best;
}

function ballNear(w: LifeWorld, s: LifeSnapshot, i: number, j: number): number {
  for (let k = 0; k < w.nThingDefs; k++) {
    if (w.thingMech[k] !== MECH.ball) continue;
    const r = w.rowOfLocal[k];
    if (r < 0) continue;
    const bx = s.thingX[r], bz = s.thingZ[r];
    const di = Math.sqrt((s.x[i] - bx) * (s.x[i] - bx) + (s.z[i] - bz) * (s.z[i] - bz)), dj = Math.sqrt((s.x[j] - bx) * (s.x[j] - bx) + (s.z[j] - bz) * (s.z[j] - bz));
    if (di < 2.5 && dj < 2.5 && !s.thingBusy[r]) return k;
  }
  return -1;
}
function peekThing(w: LifeWorld, s: LifeSnapshot, i: number, j: number): number {
  for (let k = 0; k < w.nThingDefs; k++) {
    if (!(w.thingPeek[k * 4] === w.thingPeek[k * 4])) continue;
    if (w.home && w.rowOfLocal[k] < 0) continue;
    const tx = w.thingX[k], tz = w.thingZ[k];
    const di = Math.sqrt((s.x[i] - tx) * (s.x[i] - tx) + (s.z[i] - tz) * (s.z[i] - tz)), dj = Math.sqrt((s.x[j] - tx) * (s.x[j] - tx) + (s.z[j] - tz) * (s.z[j] - tz));
    if (di < 3 && dj < 3) return k;
  }
  return -1;
}
export function tuneThing(w: LifeWorld, s: LifeSnapshot): number {
  for (let k = 0; k < w.nThingDefs; k++) if (w.thingSwitch[k] === 3 && (!w.home || w.rowOfLocal[k] >= 0)) return k;
  return -1;
}
function tuneNear(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  const k = tuneThing(w, s);
  if (k < 0) return w.home; // Home: the Music Box is the tune wherever it stands in view
  const r = w.rowOfLocal[k], tx = r >= 0 ? s.thingX[r] : w.thingX[k], tz = r >= 0 ? s.thingZ[r] : w.thingZ[k];
  return (s.x[i] - tx) * (s.x[i] - tx) + (s.z[i] - tz) * (s.z[i] - tz) < 2.5 * 2.5 + (w.home ? 4 : 0);
}
function friendChattyNear(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.active[j] || w.kind[j] !== 0) continue;
    if (w.pairLevel[pairIdx(i, j)] >= 2 && w.traits[j * 5 + TRAIT.chatty] > 0.6 && dmm(s, i, j) < 2500 && idle(w, j)) return true;
  }
  return false;
}

/** Start the moment socialPick chose (kind, partner in w.f[F.B]); gathers the group members for SING and SNUGGLE. */
export function beginPicked(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number, kind: number): boolean {
  const tb = w.f[F.NOW];
  const p = w.f[F.B] | 0;
  let m = -1;
  if (kind === MOM.SING || kind === MOM.SNUGGLE) {
    m = startMoment(w, s, out, kind, i, -1, -1);
    if (m < 0) return false;
    const maxN = kind === MOM.SING ? 6 : 4;
    for (let j = 0; j < s.n && w.mN[m] < maxN; j++) {
      if (j === i || !w.active[j] || w.kind[j] === 2 || !isFree(w, s, j, false) || !idle(w, j)) continue;
      if (dmm(s, i, j) < (kind === MOM.SING && w.home ? 4500 : 2500)) addMember(w, out, m, j);
    }
    if (w.mN[m] < (kind === MOM.SNUGGLE ? 3 : 2)) { endMoment(w, s, out, ev, m, false); return false; }
    if (kind === MOM.SING) { w.f[F.SONG] = tb; w.mThing[m] = tuneThing(w, s); }
    return true;
  }
  if (p < 0) return false;
  if (kind === MOM.PUSH) { m = startMoment(w, s, out, kind, i, p, -1); if (m >= 0) { w.mThing[m] = w.rideThing[p]; w.mRide[m] = 1; } return m >= 0; }
  m = startMoment(w, s, out, kind, i, p, -1);
  if (m < 0) return false;
  if (kind === MOM.PASS) w.mThing[m] = ballNear(w, s, i, p);
  if (kind === MOM.PEEK) w.mThing[m] = peekThing(w, s, i, p);
  const pi = pairIdx(i, p);
  if (kind === MOM.GREET) w.pairGreet[pi] |= PB.GREET;
  if (kind === MOM.MIRROR) w.pairGreet[pi] |= PB.MIRROR;
  if (kind === MOM.DUET) w.pairGreet[pi] |= PB.DUET;
  if (kind === MOM.TWIRL) w.pairGreet[pi] |= PB.TWIRL;
  if (kind === MOM.CHAT) w.pairChats[pi]++;
  if (kind === MOM.COMFORT) w.cool[i * 26 + BEH.COMFORT] = tb + 30;
  return true;
}

/* ───────────────────────────── running a moment (on its first member's think) ───────────────────────────── */

function face(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, j: number): void {
  w.f[F.X] = s.x[j]; w.f[F.Z] = s.z[j]; emitGaze(w, out, i, 1);
}
function leanTo(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, j: number, ampMilli: number): void {
  const tb = w.f[F.NOW];
  const dx = s.x[j] - s.x[i], dz = s.z[j] - s.z[i], d = Math.sqrt(dx * dx + dz * dz) || 1;
  w.f[F.X2] = dx / d * ampMilli * 0.001; w.f[F.Z2] = dz / d * ampMilli * 0.001; w.f[F.A] = 0; w.f[F.B] = 0;
  emitPose(w, s, out, i, 0);
}
function sway(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, ampMilli: number, hzMilli: number, beat: number): void {
  const tb = w.f[F.NOW];
  w.f[F.X2] = 0; w.f[F.Z2] = 0; w.f[F.A] = ampMilli * 0.001; w.f[F.B] = hzMilli * 0.001;
  emitPose(w, s, out, i, beat);
}
/** Put the approach point beside j (gap mm between the bodies) on the line from j to i into w.f[F.X], w.f[F.Z]. At Home it lies on the
 *  segment between the two home slots (framed points, D-87); in a place, inside the bounds (else on the side toward the middle). */
function besides(w: LifeWorld, s: LifeSnapshot, i: number, j: number, gapMm: number): void {
  const r = s.r[i] + s.r[j] + gapMm * 0.001;
  if (w.home && w.homeX[i] === w.homeX[i] && w.homeX[j] === w.homeX[j]) {
    const dx = w.homeX[i] - w.homeX[j], dz = w.homeZ[i] - w.homeZ[j], d = Math.sqrt(dx * dx + dz * dz);
    if (d <= r || d < 1e-6) { w.f[F.X] = w.homeX[i]; w.f[F.Z] = w.homeZ[i]; return; }
    w.f[F.X] = w.homeX[j] + dx / d * r; w.f[F.Z] = w.homeZ[j] + dz / d * r;
    return;
  }
  let dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j], d = Math.sqrt(dx * dx + dz * dz) || 1;
  w.f[F.X] = s.x[j] + dx / d * r; w.f[F.Z] = s.z[j] + dz / d * r;
  w.f[F.PX] = w.f[F.X]; w.f[F.PZ] = w.f[F.Z];
  if (!inBounds(w, 0)) {
    dx = w.bx - s.x[j]; dz = w.bz - s.z[j]; d = Math.sqrt(dx * dx + dz * dz) || 1;
    w.f[F.X] = s.x[j] + dx / d * r; w.f[F.Z] = s.z[j] + dz / d * r;
  }
}
function asleepUnitsMilli(w: LifeWorld, s: LifeSnapshot, j: number): number {
  return (s.flags[j] & LIFE_FLAG.ASLEEP) !== 0 ? (w.kind[j] === 0 ? 970 : 190) : 0;
}

/** The ride allowance of moment m's riders (D-85: their units are added to unitCap while it runs), x 1000. */
function rideAllowance(w: LifeWorld, s: LifeSnapshot, m: number): number {
  let a = 0;
  for (let k = 0; k < w.mN[m]; k++) { const j = mem(w, m, k); if (j >= 0 && (s.flags[j] & LIFE_FLAG.RIDE) !== 0) a += w.kind[j] === 0 ? 1000 : 220; }
  return a;
}

/** Advance moment m (called on its first member's think). Moves one character at a time. */
export function updateMoment(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, m: number): void {
  const tb = w.f[F.NOW];
  const kind = w.mKind[m], a = mem(w, m, 0), b = w.mN[m] > 1 ? mem(w, m, 1) : -1, n = w.mN[m];
  if (tb >= w.mEnd[m]) { endMoment(w, s, out, ev, m, w.mPhase[m] >= 1 && w.mStep[m] !== 1); return; }
  // a traveller (one mover at a time) keeps checking its arrival
  if (w.mStep[m] === 1) {
    const j = mem(w, m, w.mTurn[m]);
    if (j >= 0) { const r = travelStep(w, s, out, j, contactMm(w, s, m, j)); if (r !== 0) { stopMove(w, out, j); w.mStep[m] = 2; w.mNext[m] = tb; } }
    if (w.mStep[m] === 1) return;
  }
  if (tb < w.mNext[m]) return;
  switch (kind) {
    case MOM.GREET: {
      if (w.mPhase[m] === 0 && w.mStep[m] === 0 && dmm(s, a, b) > 1650) {
        besides(w, s, a, b, 300);
        w.mTurn[m] = 0; w.mEnd[m] = tb + 15;
        if (travelTo(w, s, out, a, 0, 0)) { w.mStep[m] = 1; return; }
        endMoment(w, s, out, ev, m, false); return;
      }
      if (w.mPhase[m] === 0) {
        face(w, s, out, a, b); face(w, s, out, b, a);
        emitEmote(w, s, out, a, EMOTE.hello, STYLE.SAY, w.isNew[a] || w.isNew[b] ? 1 : 2, 0, 0, 1);
        emitEmote(w, s, out, b, EMOTE.hello, STYLE.SAY, w.isNew[a] || w.isNew[b] ? 1 : 2, 0, 0, 1);
        emitVoice(w, s, out, a, PHRASE.GREET, 0, -1, 0, 2, 0);
        const call = w.f[F.T];
        rnd(w, a);
        emitVoice(w, s, out, b, PHRASE.ANSWER, ((call + 0.35 + 0.35 * w.f[F.G]) * 1000) | 0, a, rnd(w, b) & 1, 2, 0);
        // one hello hop toward it (or a lean)
        const dx = s.x[b] - s.x[a], dz = s.z[b] - s.z[a], d = Math.sqrt(dx * dx + dz * dz) || 1;
        w.f[F.X2] = dx / d; w.f[F.Z2] = dz / d;
        if (gateStart(w, s, a, 0, 0) && emitHop(w, s, out, a, 0, 1000)) w.mStep[m] = 3; else { stopMove(w, out, a); leanTo(w, s, out, a, b, 60); }
        w.mPhase[m] = 1; w.mEnd[m] = tb + 2.5; w.mNext[m] = tb + 0.8;
      } else if (w.mStep[m] === 3) { stopMove(w, out, a); w.mStep[m] = 0; }
      return;
    }
    case MOM.CHAT: {
      if (w.mPhase[m] === 0) {
        leanTo(w, s, out, a, b, 50); leanTo(w, s, out, b, a, 50); face(w, s, out, a, b); face(w, s, out, b, a);
        emitEmote(w, s, out, a, EMOTE.hello, STYLE.SAY, 2, 0, 0, 0);
        const turns = 2 + (rnd(w, a) & 1);
        let at = 0;
        for (let k = 0; k < turns; k++) {
          emitVoice(w, s, out, k & 1 ? b : a, PHRASE.CHAT, (at * 1000) | 0, k & 1 ? a : b, rnd(w, a) & 1, 2, 0);
          at += w.f[F.T] + 0.45;
        }
        w.mPhase[m] = 1; w.mEnd[m] = tb + Math.max(3, Math.min(5, at + 0.5)); w.mNext[m] = w.mEnd[m];
      }
      return;
    }
    case MOM.BOOP: {
      if (w.mPhase[m] === 0) { // physics boop only where both bodies and their touching pair fit (D-85); else a soft boop
        const extra = asleepUnitsMilli(w, s, b) + 250;
        w.mSoft[m] = gateFits(w, s, a, extra, 0) ? 0 : 1;
        face(w, s, out, a, b);
        besides(w, s, a, b, w.mSoft[m] ? 50 : 150);
        if (!travelTo(w, s, out, a, 0, 0)) { endMoment(w, s, out, ev, m, false); return; }
        w.mPhase[m] = 1; w.mStep[m] = 1; w.mTurn[m] = 0; w.mEnd[m] = tb + 12; w.mNext[m] = tb + 0.1;
        emitVoice(w, s, out, a, PHRASE.NOTICE, 0, -1, 0, 2, 0);
        return;
      }
      if (w.mPhase[m] === 1 && w.mStep[m] === 2) {
        if (w.mSoft[m]) { // the last centimetres at 0.04 m/s: the target stays asleep
          besides(w, s, a, b, 0);
          travelTo(w, s, out, a, 1, 0);
          w.mPhase[m] = 2; w.mStep[m] = 1; w.mNext[m] = tb + 0.1; w.mEnd[m] = tb + 4;
        } else {
          const dx = s.x[b] - s.x[a], dz = s.z[b] - s.z[a], d = Math.sqrt(dx * dx + dz * dz) || 1;
          w.f[F.X2] = dx / d; w.f[F.Z2] = dz / d;
          w.f[F.UNITS] += asleepUnitsMilli(w, s, b) * 0.001 + UNIT.pair;
          if (gateStart(w, s, a, 0, 0)) emitHop(w, s, out, a, 400, 1000);
          w.mPhase[m] = 3; w.mNext[m] = tb + 0.5;
        }
        return;
      }
      if (w.mPhase[m] === 2 && w.mStep[m] === 2) w.mPhase[m] = 3;
      if (w.mPhase[m] === 3) {
        stopMove(w, out, a);
        // the target's wobble: physics (it was hit) or a render wiggle of 0.05 R at 3 Hz (2 Hz Calm) for 0.6 s
        if (w.mSoft[m]) sway(w, s, out, b, 50, s.calm || s.reducedMotion ? 2000 : 3000, 0);
        emitEmote(w, s, out, b, EMOTE.giggle, STYLE.SAY, 2, 0, 0, 0);
        emitVoice(w, s, out, a, PHRASE.NOTICE, 0, -1, 0, 2, 0);
        emitVoice(w, s, out, b, PHRASE.GIGGLE, 300, -1, 0, 2, 0);
        w.mPhase[m] = 4; w.mEnd[m] = tb + 0.7; w.mNext[m] = w.mEnd[m];
      }
      return;
    }
    case MOM.NUZZLE: case MOM.COMFORT: {
      if (w.mPhase[m] === 0) {
        face(w, s, out, a, b); face(w, s, out, b, a);
        besides(w, s, a, b, 60);
        if (!travelTo(w, s, out, a, 0, 0)) { endMoment(w, s, out, ev, m, false); return; }
        w.mPhase[m] = 1; w.mStep[m] = 1; w.mTurn[m] = 0; w.mEnd[m] = tb + 15; w.mNext[m] = tb + 0.1;
        return;
      }
      if (w.mPhase[m] === 1 && w.mStep[m] === 2) { besides(w, s, a, b, 0); travelTo(w, s, out, a, 1, 0); w.mPhase[m] = 2; w.mStep[m] = 1; w.mNext[m] = tb + 0.1; return; }
      if (w.mPhase[m] === 2 && w.mStep[m] === 2) {
        leanTo(w, s, out, a, b, 100); leanTo(w, s, out, b, a, 100);
        const p = pairIdx(a, b), badge = w.pairBest[p] || w.pairLevel[p] >= 3 ? 1 : 0;
        emitEmote(w, s, out, a, EMOTE.snug, STYLE.SAY, 2, badge, w.pairLevel[p] >= 2 ? 1 : 0, 0);
        if (kind === MOM.NUZZLE) { emitVoice(w, s, out, a, PHRASE.PURR, 0, b, 0, 2, 0); emitVoice(w, s, out, b, PHRASE.PURR, 400, a, w.pairLevel[p] >= 2 ? 1 : 0, 2, 0); }
        else { emitVoice(w, s, out, a, PHRASE.COMFORT, 0, b, 0, 2, 0); emitVoice(w, s, out, b, PHRASE.HUM, 600, a, 1, 2, 0); }
        w.mPhase[m] = 3; w.mEnd[m] = tb + (kind === MOM.COMFORT ? 3 : 3 + 3 * (rnd(w, a) * U16)); w.mNext[m] = tb + (kind === MOM.COMFORT ? 2.4 : 99);
        return;
      }
      if (w.mPhase[m] === 3 && kind === MOM.COMFORT) { emitEmote(w, s, out, b, EMOTE.sparkle, STYLE.SAY, 2, 0, 1, 0); w.mNext[m] = 1e9; }
      return;
    }
    case MOM.MIRROR: case MOM.TWIRL: {
      if (w.mPhase[m] === 0) {
        emitEmote(w, s, out, a, kind === MOM.MIRROR ? EMOTE.sparkle : EMOTE.snug, STYLE.SAY, 2, kind === MOM.TWIRL ? 1 : 0, 1, 1);
        if (kind === MOM.MIRROR) emitEmote(w, s, out, b, EMOTE.sparkle, STYLE.SAY, 2, 0, 1, 1);
        emitVoice(w, s, out, a, kind === MOM.MIRROR ? PHRASE.HUM : PHRASE.DUET, 0, b, 0, 2, 0);
        emitVoice(w, s, out, b, kind === MOM.MIRROR ? PHRASE.HUM : PHRASE.DUET, 0, a, kind === MOM.MIRROR ? 0 : 1, 2, 0);
        // together only where moverCap is 2 or more and both fit; otherwise a mirrored render sway (it still counts)
        const two = MOVER_CAP[tierOf(s)] >= 2 && gateFits(w, s, a, asleepUnitsMilli(w, s, b), 0) && gateStart(w, s, a, asleepUnitsMilli(w, s, b), 0) && gateStart(w, s, b, 0, 0);
        if (two) {
          w.f[F.X2] = 0; w.f[F.Z2] = 0; emitHop(w, s, out, a, 0, 800); emitHop(w, s, out, b, 0, 800); w.mSoft[m] = 0;
        } else { stopMove(w, out, a); stopMove(w, out, b); sway(w, s, out, a, 40, 1500, 1); sway(w, s, out, b, 40, 1500, 1); w.mSoft[m] = 1; }
        w.mPhase[m] = 1; w.mEnd[m] = tb + (kind === MOM.MIRROR ? 4 : 3); w.mNext[m] = tb + 1;
        return;
      }
      if (!w.mSoft[m] && w.mPhase[m] < 3) { w.f[F.X2] = 0; w.f[F.Z2] = 0; emitHop(w, s, out, a, 0, 800); emitHop(w, s, out, b, 0, 800); w.mPhase[m]++; w.mNext[m] = tb + 1; }
      else if (!w.mSoft[m]) { stopMove(w, out, a); stopMove(w, out, b); w.mNext[m] = 1e9; }
      return;
    }
    case MOM.DUET: {
      if (w.mPhase[m] === 0) {
        const wait = toNextBarMs(w) * 0.001;
        sway(w, s, out, a, 30, 1100, 1); sway(w, s, out, b, 30, 1100, 1);
        emitEmote(w, s, out, a, EMOTE.snug, STYLE.SAY, 2, w.pairBest[pairIdx(a, b)], 1, 1);
        emitVoice(w, s, out, a, PHRASE.DUET, toNextBarMs(w), b, 0, 2, 0);
        emitVoice(w, s, out, b, PHRASE.DUET, toNextBarMs(w), a, 1, 2, 0);
        w.mPhase[m] = 1; w.mEnd[m] = tb + wait + 2 * BAR_S; w.mNext[m] = w.mEnd[m];
      }
      return;
    }
    case MOM.SING: {
      if (w.mPhase[m] === 0) {
        const waitMs = toNextBarMs(w), wait = waitMs * 0.001, voiced = s.phone ? 2 : 3;
        emitEmote(w, s, out, a, EMOTE.note, STYLE.SAY, 2, 0, 0, 1);
        for (let k = 0; k < n; k++) {
          const j = mem(w, m, k);
          sway(w, s, out, j, 30, 1100, 1);
          if (k < voiced) {
            emitVoice(w, s, out, j, PHRASE.SING, waitMs, -1, k, 2, 0);
            emitVoice(w, s, out, j, PHRASE.SING, waitMs + ((BAR_S * 1000) | 0), -1, k + 16, 2, 0);
          }
        }
        w.mPhase[m] = 1; w.mEnd[m] = tb + wait + 2 * BAR_S; w.mNext[m] = w.mEnd[m];
      }
      return;
    }
    case MOM.SNUGGLE: {
      // gather into a row, one mover at a time (each a glide to beside the one before, then a contact approach at 0.04 m/s)
      if (w.mPhase[m] === 0) { emitEmote(w, s, out, a, EMOTE.snug, STYLE.SAY, 2, 0, 0, 1); w.mPhase[m] = 1; w.mTurn[m] = 1; w.mStep[m] = 0; w.mEnd[m] = tb + 40; }
      if (w.mPhase[m] === 1) {
        const k = w.mTurn[m];
        if (k >= n) { // the row formed: lean in contact 6 s (render)
          for (let q = 0; q < n; q++) { const j = mem(w, m, q), o = mem(w, m, q > 0 ? q - 1 : 1); if (o >= 0) leanTo(w, s, out, j, o, 60); }
          emitVoice(w, s, out, a, PHRASE.HUM, 0, -1, 0, 2, 0);
          w.mPhase[m] = 2; w.mEnd[m] = tb + 8; w.mNext[m] = 1e9;
          return;
        }
        const j = mem(w, m, k), prev = mem(w, m, k - 1);
        if (w.mStep[m] === 0) {
          // beside the previous one along x (the row runs across the view)
          const side = k & 1 ? 1 : -1, r = s.r[j] + s.r[prev] + 0.06;
          w.f[F.X] = s.x[prev] + side * r; w.f[F.Z] = s.z[prev];
          w.f[F.PX] = w.f[F.X]; w.f[F.PZ] = w.f[F.Z];
          if (!w.home && !inBounds(w, shrinkMm(s, j))) { w.f[F.X] = s.x[prev] - side * r; w.f[F.PX] = w.f[F.X]; }
          if (!w.home && !inBounds(w, shrinkMm(s, j))) { // neither side fits: toward the middle
            const mx = w.bx - s.x[prev], mz = w.bz - s.z[prev], md = Math.sqrt(mx * mx + mz * mz) || 1;
            w.f[F.X] = s.x[prev] + mx / md * r; w.f[F.Z] = s.z[prev] + mz / md * r;
          }
          if (w.home) { w.f[F.X] = s.x[j]; w.f[F.Z] = s.z[j]; } // Home: everyone already sits at a framed spot; the row leans in place
          if (travelTo(w, s, out, j, 0, 0)) { w.mStep[m] = 1; w.mNext[m] = tb + 0.1; } else w.mNext[m] = tb + 0.5;
          return;
        }
        if (w.mStep[m] === 2) { w.mTurn[m] = k + 1; w.mStep[m] = 0; w.mNext[m] = tb + 0.1; }
      }
      return;
    }
    case MOM.COPY: {
      // the copier repeats the leader's hop 0.6 s later, 3 copies, one mover at a time
      if (w.mPhase[m] === 0) { emitEmote(w, s, out, a, EMOTE.star, STYLE.SAY, 2, 0, 0, 1); w.mPhase[m] = 1; w.mCount[m] = 0; }
      const c = w.mCount[m];
      if (c >= 6) { w.mEnd[m] = tb; w.mPhase[m] = 2; return; }
      const j = c & 1 ? a : b; // b leads (it hopped first), a copies
      stopMove(w, out, c & 1 ? b : a);
      w.f[F.X2] = 0; w.f[F.Z2] = 0;
      if (gateStart(w, s, j, 0, 0)) { emitHop(w, s, out, j, 0, 700); emitVoice(w, s, out, j, PHRASE.NOTICE, 0, -1, c & 1, 2, 0); }
      w.mCount[m] = c + 1; w.mNext[m] = tb + (c & 1 ? 1.0 : 0.6); w.mEnd[m] = tb + 4;
      return;
    }
    case MOM.PASS: {
      const k = w.mThing[m], row = k >= 0 ? w.rowOfLocal[k] : -1;
      if (row < 0 || w.mCount[m] >= 3) { w.mEnd[m] = tb; if (w.mCount[m] >= 1) w.mPhase[m] = 1; return; }
      const j = w.mCount[m] & 1 ? b : a, o = j === a ? b : a;
      if (w.mStep[m] === 0) {
        if (w.mCount[m] === 0) emitEmote(w, s, out, a, EMOTE.ball, STYLE.SAY, 2, 0, 0, 1);
        const bx = s.thingX[row], bz = s.thingZ[row], br = w.thingS0[k];
        // toward the partner; at Home along the segment from its home slot through the ball (framed points, D-87)
        const fx = w.home && w.homeX[j] === w.homeX[j] ? bx + (bx - w.homeX[j]) : s.x[o], fz = w.home && w.homeX[j] === w.homeX[j] ? bz + (bz - w.homeZ[j]) : s.z[o];
        const dx = fx - bx, dz = fz - bz, d = Math.sqrt(dx * dx + dz * dz) || 1;
        w.f[F.X] = bx - dx / d * (s.r[j] + br + 0.03); w.f[F.Z] = bz - dz / d * (s.r[j] + br + 0.03);
        w.f[F.PX] = w.f[F.X]; w.f[F.PZ] = w.f[F.Z];
        if (!w.home && !inBounds(w, 0)) { w.mCount[m] = 3; return; }
        w.mTurn[m] = j === a ? 0 : 1;
        if (travelTo(w, s, out, j, 0, 0)) { w.mStep[m] = 1; w.mNext[m] = tb + 0.1; w.mPhase[m] = 1; w.mEnd[m] = tb + 25; } else w.mNext[m] = tb + 0.5;
        return;
      }
      if (w.mStep[m] === 2) {
        const bx = s.thingX[row], bz = s.thingZ[row];
        const fx = w.home && w.homeX[j] === w.homeX[j] ? bx + (bx - w.homeX[j]) : s.x[o], fz = w.home && w.homeX[j] === w.homeX[j] ? bz + (bz - w.homeZ[j]) : s.z[o];
        const dx = fx - bx, dz = fz - bz, d = Math.sqrt(dx * dx + dz * dz) || 1;
        w.f[F.X2] = dx / d; w.f[F.Z2] = dz / d;
        if (gateStart(w, s, j, 0, 0) && !emitHop(w, s, out, j, 400, 1000)) {
          // a non-hopper glides the last centimetres into it (to the ball's centre: the far end of its framed segment at Home)
          w.f[F.X] = bx - dx / d * (s.r[j] + w.thingS0[k] - 0.06); w.f[F.Z] = bz - dz / d * (s.r[j] + w.thingS0[k] - 0.06);
          w.f[F.PX] = w.f[F.X]; w.f[F.PZ] = w.f[F.Z];
          if (w.home || inBounds(w, 0)) emitScoot(w, out, j, 300, 0);
        }
        emitVoice(w, s, out, j, PHRASE.NOTICE, 0, -1, 0, 3, 0);
        pushEvent(ev, LIFE_EV.USE, w.thingVerb[k], j, -1, 1, w.thingGlobal[k]);
        w.mCount[m]++; w.mStep[m] = 3; w.mNext[m] = tb + 2.5;
        return;
      }
      if (w.mStep[m] === 3) { stopMove(w, out, j); w.mStep[m] = 0; }
      return;
    }
    case MOM.PEEK: {
      const k = w.mThing[m];
      if (k < 0) { w.mEnd[m] = tb; return; }
      if (w.mPhase[m] === 0) { emitEmote(w, s, out, a, EMOTE.question, STYLE.SAY, 2, 0, 0, 1); w.mPhase[m] = 1; w.mTurn[m] = 0; w.mStep[m] = 0; w.mEnd[m] = tb + 40; }
      if (w.mPhase[m] === 1) {
        const t = w.mTurn[m];
        if (t >= 2) { w.mPhase[m] = 2; w.mCount[m] = 0; w.mNext[m] = tb; w.mEnd[m] = tb + 4.2; emitVoice(w, s, out, a, PHRASE.NOTICE, 0, -1, 1, 2, 0); return; }
        const j = t === 0 ? a : b;
        if (w.mStep[m] === 0) {
          w.f[F.X] = w.thingPeek[k * 4 + t * 2]; w.f[F.Z] = w.thingPeek[k * 4 + t * 2 + 1];
          if (travelTo(w, s, out, j, 0, 0)) { w.mStep[m] = 1; w.mNext[m] = tb + 0.1; } else w.mNext[m] = tb + 0.5;
          return;
        }
        if (w.mStep[m] === 2) { w.mTurn[m] = t + 1; w.mStep[m] = 0; w.mNext[m] = tb; }
        return;
      }
      // lean out and back, 2 or 3 times (render), then a sparkle and a giggle
      const c = w.mCount[m];
      if (c < 6) { const dir = c & 1 ? 0 : 80; w.f[F.X2] = dir * 0.001; w.f[F.Z2] = 0; w.f[F.A] = 0; w.f[F.B] = 0; emitPose(w, s, out, a, 0); w.f[F.X2] = -dir * 0.001; emitPose(w, s, out, b, 0); w.mCount[m] = c + 1; w.mNext[m] = tb + 0.6; }
      else { emitEmote(w, s, out, b, EMOTE.sparkle, STYLE.SAY, 2, 0, 0, 0); emitVoice(w, s, out, b, PHRASE.GIGGLE, 0, -1, 0, 2, 0); w.mNext[m] = 1e9; }
      return;
    }
    case MOM.TEETER: {
      // small hops in turn (both already awake on a moving prop: only a mover token, no body to wake)
      if (w.mPhase[m] === 0) { emitEmote(w, s, out, a, EMOTE.swirl, STYLE.SAY, 2, 0, 0, 1); w.mPhase[m] = 1; w.mEnd[m] = tb + 6 + 6 * (rnd(w, a) * U16); w.mCount[m] = 0; }
      const j = w.mCount[m] & 1 ? b : a;
      stopMove(w, out, j === a ? b : a);
      w.f[F.X2] = 0; w.f[F.Z2] = 0;
      if (gateStart(w, s, j, 0, rideAllowance(w, s, m)) && emitHop(w, s, out, j, 0, 700)) emitVoice(w, s, out, j, PHRASE.GIGGLE, 0, -1, 0, 3, 0);
      w.mCount[m]++; w.mNext[m] = tb + 1.1;
      return;
    }
    case MOM.PUSH: {
      // the pusher (a) walks to the swing's push spot (it wakes on the ride allowance) and pushes the seat 3 times
      const k = w.mThing[m];
      if (k < 0 || (s.flags[b] & LIFE_FLAG.RIDE) === 0) { w.mEnd[m] = tb; return; }
      { const al = rideAllowance(w, s, m) * 0.001; if (w.att.allowance !== al) w.att.allowance = al; }
      if (w.mPhase[m] === 0) {
        emitEmote(w, s, out, a, EMOTE.star, STYLE.SAY, 2, 0, 0, 1);
        w.f[F.X] = w.thingPushX[k]; w.f[F.Z] = w.thingPushZ[k];
        if (!travelTo(w, s, out, a, 0, rideAllowance(w, s, m))) { w.mNext[m] = tb + 0.5; if (tb - w.mT0[m] > 10) w.mEnd[m] = tb; return; }
        w.mPhase[m] = 1; w.mStep[m] = 1; w.mTurn[m] = 0; w.mEnd[m] = tb + 30; w.mNext[m] = tb + 0.1;
        return;
      }
      if (w.mStep[m] === 2) {
        if (w.mCount[m] >= 3) { w.mEnd[m] = tb; return; }
        // a push: glide 0.55 m toward the pivot as the seat comes back, then back to the spot
        const px = w.thingPushX[k], pz = w.thingPushZ[k], dx = w.thingX[k] - px, dz = w.thingZ[k] - pz, d = Math.sqrt(dx * dx + dz * dz) || 1;
        const out1 = (w.mCount[m] & 1) === 0 && w.mSoft[m] === 0;
        w.f[F.X] = out1 ? px + dx / d * 0.55 : px; w.f[F.Z] = out1 ? pz + dz / d * 0.55 : pz;
        emitScoot(w, out, a, 350, 0);
        if (out1) { emitVoice(w, s, out, b, PHRASE.COMFORT, 400, -1, 0, 3, 0); w.mSoft[m] = 1; }
        else { w.mSoft[m] = 0; w.mCount[m]++; }
        w.mNext[m] = tb + 1.2;
      }
      return;
    }
    default: w.mEnd[m] = tb;
  }
}

function contactMm(w: LifeWorld, s: LifeSnapshot, m: number, j: number): number {
  return w.mKind[m] === MOM.PUSH ? 80 : 60;
}

/** S10 teeter: two characters the player set on the same seesaw (both RIDE) start it from either rider's think. */
export function tryTeeter(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number): boolean {
  const tb = w.f[F.NOW];
  const k = w.rideThing[i];
  if (k < 0 || w.thingMech[k] !== MECH.seesaw || w.moment[i] >= 0) return false;
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.active[j] || w.moment[j] >= 0 || w.rideThing[j] !== k || (s.flags[j] & LIFE_FLAG.RIDE) === 0) continue;
    if ((s.flags[j] & HELD_BITS) !== 0) continue;
    const m = startMoment(w, s, out, MOM.TEETER, i, j, -1);
    if (m >= 0) { w.mThing[m] = k; w.mRide[m] = 1; return true; }
  }
  return false;
}
