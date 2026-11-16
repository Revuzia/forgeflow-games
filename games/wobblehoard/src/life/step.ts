// The LIFE step interface (LIFE.md 12; D-57, D-59, D-87, D-89): createLifeWorld, lifeSetPlace, lifeSetHome, lifeAdd, lifeRemove, lifeStep,
// lifeScript, lifeSetJournal, lifeSetPair, lifeLooks, lifeAddLook, lifeWishOf, lifePhrase, lifeMotif, createAttention, attentionFilter,
// motionGate. Pure (L1, LF-12): sim time from the snapshot only (LF-26); zero allocation in lifeStep after createLifeWorld (LF-02).
// Every character thinks when sim time crosses its next 0.1 s boundary, offset by slot x 0.1 / 16, in boundary order (LF-16).
//
// For the host (PG_SHELL): the snapshot's per-character rows are indexed BY CHARACTER SLOT (row i = slot i; n = the highest slot + 1; a slot
// LIFE does not hold is skipped). lifeStep runs the attention filter itself on lifeAttention(w): do not filter its intents again. A ceremony's
// stash and restore is not "coming out": do not lifeRemove / lifeAdd for it (needs and looks are kept through quiet). For a cut, lifeRemove the
// whole and lifeAdd each piece with group = the whole's old slot (the face piece takes its needs, looks and wish).
// Event conventions beyond the contract's comment: a USE by PLAYER ("Go play with...") has b = 254; FIRST_WISH resting in the Journal at the
// 5:00 backstop is a WISH SHOWN with b = 254 and n2 = 0. Owned by PG_LIFE.
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { pitchRatio } from '../core/genome.ts';
import type { PlaceDef } from '../data/places.ts';
import { THING_IDS } from '../data/places.ts';
import { SCRIPT, LIFE_FLAG, SPECIES_LIFE } from '../data/life.ts';
import { speciesIdx, familyOf } from '../data/catalog.ts';
import { MATERIAL_FAMILY_IDS } from '../data/materials.ts';
import type { LifeWorld } from './world.ts';
import { CAP, BEH, F, THINK_S, STAGGER_S, MAX_ZONES, MAX_MOMENTS, MAX_MEMBERS, createLifeWorld, copyPlace, seedChar, pairIdx } from './world.ts';
import { traitsOf, signatureCode } from './traits.ts';
import { senseZones, integrate, reactZones, addLook, resetNeedsLooks, emitReact, cutReacts } from './looks.ts';
import { touchPass, behave } from './brain.ts';
import { wishCheck, wishFromEvents, firstWishThink, wishOf, THING_ICON_KIND } from './wish.ts';
import { attentionFilter, moverCapOf, unitCapOf, UNIT_CAP, WAKE } from './attention.ts';
import type { Attention } from './attention.ts';
import { emitEmote } from './act.ts';
import { emitVoice, PHRASE as PH } from './voice.ts';
import { EMOTE } from '../data/life.ts';

export { createLifeWorld };
export type { LifeWorld };
export { lifePhrase, lifeMotif, PHRASE, PHRASE_BUBBLE } from './voice.ts';
export { createAttention, attentionFilter, motionGate, motionGateWake, unitCapOf, moverCapOf, CHAR_CAP, CAPS, UNIT, WAKE, PHONE_FACTOR,
  attentionSound, attentionParticles, STYLE } from './attention.ts';
export type { Attention } from './attention.ts';
export { traitsOf } from './traits.ts';
export { HUFF_TRIGGERS } from './brain.ts';
export { BEH } from './world.ts';

/** The world's own Attention (the shell's motion gate, over-budget rule, auto sounds and particles use it). */
export function lifeAttention(w: LifeWorld): Attention { return w.att; }

/* ───────────────────────────── the place ───────────────────────────── */

/** On travel (a new visit number: visit-scoped state resets, and needs and looks reset: a trip is coming out) and on a re-lay after a rotation
 *  (the same visit: only the layout changes). Copies the layout's bounds and every spot into the world's arrays (never per tick). */
export function lifeSetPlace(w: LifeWorld, placeIdx: number, visit: number, def: PlaceDef, layout: 0 | 1, bodyScale: number): void {
  const newVisit = visit !== w.visit || placeIdx !== w.placeIdx || w.def === null;
  w.placeIdx = placeIdx; w.visit = visit; w.layout = layout; w.bodyScale = bodyScale > 0 ? bodyScale : 1; w.def = def;
  w.home = placeIdx === 0; w.night = def.night;
  copyPlace(w, def, layout);
  for (let k = 0; k < w.nThingDefs; k++) if (w.thingGlobal[k] >= 0) THING_ICON_KIND[w.thingGlobal[k]] = w.thingKind[k];
  w.rowOfLocal.fill(-1); w.thingPrevX.fill(NaN); w.thingPrevZ.fill(NaN); w.thingPrevS.fill(NaN); w.thingMovedT.fill(-1e9);
  if (!newVisit) return;
  for (let m = 0; m < MAX_MOMENTS; m++) { w.mKind[m] = 0; w.mN[m] = 0; }
  w.groupHighKey.fill(-1); w.groupHighN.fill(0);
  w.pairGreet.fill(0); w.pairChats.fill(0); w.pairNear.fill(0);
  w.movers = 0; w.att.movers = 0; w.att.allowance = 0;
  for (let i = 0; i < CAP; i++) {
    w.moment[i] = -1; w.moving[i] = 0;
    if (!w.active[i]) continue;
    visitReset(w, i);
    resetNeedsLooks(w, i);
    w.addPending[i] = 1;
    if (w.kind[i] !== 2) w.arrivePending[i] = 1;
  }
}
function visitReset(w: LifeWorld, i: number): void {
  w.seenThings[i * 2] = 0; w.seenThings[i * 2 + 1] = 0; w.seenChars[i] = 0;
  w.reactN[i] = 0; w.zoneSeen[i] = 0; w.onceVisit[i] = 0; w.enterAtOnce[i] = 1; w.b15Zone[i] = 0;
  for (let k = 0; k < MAX_ZONES; k++) w.zoneInT[i * MAX_ZONES + k] = -1e9;
  for (let k = 0; k < 24; k++) w.reactCool[i * 24 + k] = -1e9;
  w.beh[i] = BEH.NONE; w.phase[i] = 0; w.behScore[i] = 0; w.favPlaceT[i] = -1e9; w.tThing[i] = -1; w.tChar[i] = -1; w.usesVisit[i] = 0;
  seedChar(w, i);
}

/** At Home: a character's home slot (its stage.matLayout slot in use); NaN x clears it (D-87). Sent at spawn and on a party or frame change. */
export function lifeSetHome(w: LifeWorld, slot: number, x: number, z: number): void {
  if (slot < 0 || slot >= CAP) return;
  w.homeX[slot] = x; w.homeZ[slot] = x === x ? z : NaN;
}

/* ───────────────────────────── characters ───────────────────────────── */

/** At spawn, cut and join. kind 0 whole, 1 face piece, 2 chunk; group = the slot of its owning whole (itself for a whole). */
export function lifeAdd(w: LifeWorld, slot: number, genome: Genome, kind: 0 | 1 | 2, group: number, warmth: number, isNew: boolean): void {
  if (slot < 0 || slot >= CAP) return;
  const i = slot;
  const parent = kind !== 0 && group >= 0 && group < CAP && group !== i ? group : -1;
  w.active[i] = 1; w.kind[i] = kind; w.group[i] = kind === 0 ? i : group;
  w.species[i] = speciesIdx(genome.species); w.family[i] = MATERIAL_FAMILY_IDS.indexOf(familyOf(genome.species));
  w.gseed[i] = genome.seed >>> 0; w.warmth[i] = warmth; w.isNew[i] = isNew ? 1 : 0; w.signature[i] = signatureCode(genome);
  w.pitch[i] = pitchRatio(genome);
  traitsOf(genome, w.traits, i * 5);
  if (parent >= 0 && w.gseed[parent] === w.gseed[i]) {
    // a piece of a cut squishy: it keeps the whole's needs and looks (the face piece leads with its brain, 9)
    w.play[i] = w.play[parent]; w.company[i] = w.company[parent]; w.rest[i] = w.rest[parent];
    for (let j = 0; j < 6; j++) w.looks[i * 6 + j] = w.looks[parent * 6 + j];
    if (kind === 1) { w.wishKind[i] = w.wishKind[parent]; w.wishTarget[i] = w.wishTarget[parent]; w.wishT[i] = w.wishT[parent]; }
    const g = group & 31;
    if (!w.cutPending[g]) { w.cutPending[g] = 1; w.cutT[g] = NaN; }
  } else { resetNeedsLooks(w, i); w.wishKind[i] = 0; w.wishTarget[i] = -1; }
  visitReset(w, i);
  if (parent >= 0 && w.gseed[parent] === w.gseed[i]) { // a piece has seen what its whole saw (it does not notice the place anew)
    w.seenThings[i * 2] = w.seenThings[parent * 2]; w.seenThings[i * 2 + 1] = w.seenThings[parent * 2 + 1]; w.seenChars[i] = w.seenChars[parent] | (1 << parent);
    for (let j = 0; j < CAP; j++) if (w.active[j] && w.kind[j] !== 0 && w.group[j] === group) { w.seenChars[i] |= 1 << j; w.seenChars[j] |= 1 << i; }
  }
  w.lookHigh[i] = 0; w.held[i] = 0; w.moving[i] = 0; w.moment[i] = -1; w.addPending[i] = 1; w.arrivePending[i] = kind === 0 ? 1 : 0;
  w.releaseT[i] = -1e9; w.graceUntil[i] = -1e9; w.lastTouch[i] = -1; w.touchStartT[i] = -1e9; w.afterglowDue[i] = 0; w.watchDue[i] = -1;
  w.cheerDue[i] = 0; w.huffDue[i] = 0; w.huffFrom[i] = -1; w.rideUntil[i] = -1e9; w.rideThing[i] = -1; w.ridePrev[i] = 0; w.useStage[i] = 0;
  w.playWith[i] = -1; w.nextUse[i] = -1; w.firstPlay[i] = 0; w.shyUntil[i] = -1e9; w.partnerWaitT[i] = -1e9; w.wishLastNewT[i] = -1e9;
  w.lastHopT[i] = -1e9; w.lastJoyT[i] = -1e9; w.lastNoticeT[i] = -1e9; w.expr[i] = 0; w.exprAmt[i] = 0; w.sqS[i] = 1; w.squirtDue[i] = 0;
  for (let j = 0; j < 4; j++) w.poseKey[i * 4 + j] = 0;
  for (let j = 0; j < CAP; j++) {
    const p = pairIdx(i, j); w.pairLevel[p] = 0; w.pairBest[p] = 0; w.pairGreet[p] = 0; w.pairChats[p] = 0; w.pairNear[p] = 0; w.pairCool[p] = -1e9;
    w.seenChars[j] &= ~(1 << i);
  }
  for (let j = 0; j < 26; j++) w.cool[i * 26 + j] = -1e9;
}

/** It went back to the shelf, was cut (the whole), or joined (the pieces). Its open wish rests in the Journal (the shell's). */
export function lifeRemove(w: LifeWorld, slot: number): void {
  if (slot < 0 || slot >= CAP || !w.active[slot]) return;
  const m = w.moment[slot];
  if (m >= 0) {
    for (let k = 0; k < w.mN[m]; k++) { const j = w.mMem[m * MAX_MEMBERS + k]; if (j >= 0) { w.moment[j] = -1; w.beh[j] = BEH.IDLE; w.moving[j] = 0; } }
    w.mKind[m] = 0; w.mN[m] = 0;
  }
  w.active[slot] = 0; w.moving[slot] = 0; w.moment[slot] = -1; w.wishKind[slot] = 0;
  if (w.att.wishOwner === slot) w.att.wishOwner = -1;
  w.att.wishDot[slot] = 0;
  w.homeX[slot] = NaN; w.homeZ[slot] = NaN;
}

/* ───────────────────────────── the step ───────────────────────────── */

const MAX_CATCHUP = 5;

export function lifeStep(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents): void {
  out.n = 0; ev.n = 0;
  w.perChar.fill(0);
  const t = s.t;
  if (!(w.sessionT0 === w.sessionT0)) w.sessionT0 = t;
  // newly added characters start thinking from now; a cut's time is now
  w.nOut = 0;
  for (let i = 0; i < CAP; i++) {
    if (!w.active[i]) continue;
    if (w.kind[i] === 0) w.nOut++;
    if (w.addPending[i]) {
      // its first think is its first boundary after the previous call (not after this call's time), so the frame rate never shifts it (LF-16)
      w.addPending[i] = 0;
      const off = i * STAGGER_S;
      if (w.lastT === w.lastT) w.tick[i] = Math.floor((w.lastT - off) / THINK_S + 1e-9) + 1;
      else w.tick[i] = t < THINK_S + off ? 0 : Math.ceil((t - off) / THINK_S - 1e-9); // added before the first call: from the grid's start
      w.lastThink[i] = -1e9;
      w.addT[i] = w.tick[i] * THINK_S + off;
    }
  }
  for (let g = 0; g < 32; g++) if (w.cutPending[g] && !(w.cutT[g] === w.cutT[g])) w.cutT[g] = t;
  // the things out now: rows, and whether each moved or switched since the last call (B02)
  w.rowOfLocal.fill(-1);
  for (let r = 0; r < s.nThings && r < 32; r++) {
    const g = s.thingId[r];
    if (g < 0 || g >= w.globalToLocal.length) continue;
    const k = w.globalToLocal[g];
    if (k < 0) continue;
    w.rowOfLocal[k] = r;
    const px = w.thingPrevX[k], pz = w.thingPrevZ[k], ps = w.thingPrevS[k];
    if (px === px && (Math.abs(s.thingX[r] - px) > 0.02 || Math.abs(s.thingZ[r] - pz) > 0.02 || Math.abs(s.thingState[r] - ps) > 0.05)) w.thingMovedT[k] = t;
    w.thingPrevX[k] = s.thingX[r]; w.thingPrevZ[k] = s.thingZ[r]; w.thingPrevS[k] = s.thingState[r];
  }
  if (s.musicBoxOn && !w.musicPrev) w.musicOnT = t;
  w.musicPrev = s.musicBoxOn ? 1 : 0;
  for (let b = 0; b < s.nBumps; b++) {
    const a = s.bumpA[b], c = s.bumpB[b];
    if (a >= 0 && a < CAP) { w.bumpT[a] = t; w.bumpWith[a] = c; }
    if (c >= 0 && c < CAP) { w.bumpT[c] = t; w.bumpWith[c] = a; }
  }
  // movers (a piece group counts 1) and the wakes LIFE claimed that the snapshot does not show yet
  let movers = 0, groups = 0;
  w.unitsAdd = 0;
  for (let i = 0; i < CAP; i++) {
    if (!w.active[i]) { w.moving[i] = 0; continue; }
    if (w.moving[i]) {
      if (w.kind[i] === 0) movers++;
      else { const bit = 1 << (w.group[i] & 31); if ((groups & bit) === 0) { groups |= bit; movers++; } }
    }
    if (i < s.n && t - w.wakeClaimT[i] < 0.3 && (s.flags[i] & LIFE_FLAG.ASLEEP) !== 0) w.unitsAdd += w.kind[i] === 0 ? WAKE.whole : WAKE.piece;
  }
  w.movers = movers;
  const a = w.att;
  a.movers = movers; a.moverCap = moverCapOf(s.tier); a.unitCap = UNIT_CAP[s.tier < 0 ? 0 : s.tier > 2 ? 2 : s.tier | 0];
  let anyRideMoment = false;
  for (let m = 0; m < MAX_MOMENTS; m++) if (w.mKind[m] === 10 || w.mKind[m] === 11) anyRideMoment = true;
  if (!anyRideMoment) a.allowance = 0;
  // every brain function reads the time from w.f[F.NOW] (LF-02): the per-call passes run at the snapshot's t, each think at its boundary
  w.f[F.NOW] = t;
  // lifeAddLook's REACTs (every time, with the source thing)
  for (let p = 0; p < w.pendN; p++) {
    const i = w.pendSlot[p];
    if (i >= 0 && i < CAP && w.active[i]) emitReact(w, s, ev, i, w.pendKind[p], w.pendThing[p], 1);
  }
  w.pendN = 0;
  // the player's touch (HELD in the same step), releases, touch kinds, landings
  touchPass(w, s, out, ev);
  // a cut inside a zone: one PIECES record per zone REACT the new group stands in, at the cut
  for (let g = 0; g < 32; g++) if (w.cutPending[g]) { w.cutPending[g] = 0; cutReacts(w, s, ev, g); }
  // deferred scripts: CHEER (up to two near the cause), SQUIRTED (the target's wow, then its giggle)
  if (w.cheerCause >= 0) { cheerNear(w, s, w.cheerCause); w.cheerCause = -1; }
  for (let i = 0; i < s.n && i < CAP; i++) if (w.squirtDue[i]) {
    w.squirtDue[i] = 0;
    if (!w.active[i]) continue;
    emitEmote(w, s, out, i, EMOTE.wow, 0, 1, 0, 0, 1);
    emitVoice(w, s, out, i, PH.NOTICE, 0, -1, 0, 1, 0);
    emitVoice(w, s, out, i, PH.GIGGLE, 800, -1, 0, 1, 0);
  }
  // the thinks, in boundary order (LF-16)
  for (let guard = 0; guard < CAP * (MAX_CATCHUP + 1); guard++) {
    let best = -1, bt = 1e300;
    for (let i = 0; i < CAP; i++) {
      if (!w.active[i] || i >= s.n) continue;
      const tb = w.tick[i] * THINK_S + i * STAGGER_S;
      if (tb <= t + 1e-9 && tb < bt) { bt = tb; best = i; }
    }
    if (best < 0) break;
    w.f[F.NOW] = bt;
    think(w, s, out, ev, best);
    w.tick[best]++;
    const off = best * STAGGER_S;
    if (t - (w.tick[best] * THINK_S + off) > MAX_CATCHUP * THINK_S) w.tick[best] = Math.ceil((t - off) / THINK_S - 1e-9);
  }
  // thing and song wishes granted by this tick's events
  w.f[F.NOW] = t;
  wishFromEvents(w, s, out, ev);
  attentionFilter(a, s, out);
  w.lastT = t;
}

function think(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW], last = w.lastThink[i];
  w.f[F.DT] = last > -1e8 ? Math.min(0.5, tb - last) : THINK_S;
  w.lastThink[i] = tb;
  senseZones(w, s, i);
  integrate(w, s, ev, i);
  reactZones(w, s, ev, i);
  if (w.firstWishPending) firstWishThink(w, s, out, ev);
  wishCheck(w, s, out, ev, i);
  behave(w, s, out, ev, i);
}

function cheerNear(w: LifeWorld, s: LifeSnapshot, cause: number): void {
  if (cause < 0 || cause >= s.n) return;
  let a = -1, b = -1, da = 1e9, db = 1e9;
  for (let j = 0; j < s.n; j++) {
    if (j === cause || !w.active[j] || w.kind[j] === 2) continue;
    const dx = s.x[j] - s.x[cause], dz = s.z[j] - s.z[cause], d = dx * dx + dz * dz;
    if (d < da) { db = da; b = a; da = d; a = j; } else if (d < db) { db = d; b = j; }
  }
  if (a >= 0) w.cheerDue[a] = 1;
  if (b >= 0) w.cheerDue[b] = 1;
}

/* ───────────────────────────── scripts, the journal, pairs, looks, wishes ───────────────────────────── */

/** LIFE 4.1's six scripts (SCRIPT ids). FIRST_PLAY: slot = the play body; FIRST_WISH: slot = the wisher (D-70), arg 1 = the 5:00 backstop;
 *  PLAY_WITH: arg = the place-local thing index (a global THING_IDS index is accepted too); POSE: arg 1 picked, 0 put away; CHEER: arg = the
 *  slot that caused it; SQUIRTED: slot = the target. */
export function lifeScript(w: LifeWorld, slot: number, script: number, arg: number): void {
  switch (script) {
    case SCRIPT.FIRST_PLAY: {
      if (w.firstPlayDone || slot < 0 || slot >= CAP || !w.active[slot]) return;
      w.firstPlayDone = 1;
      if (w.play[slot] < 0.6) w.play[slot] = 0.6;
      let ball = w.globalToLocal[THING_IDS.indexOf('feltball')];
      if (ball < 0) for (let k = 0; k < w.nThingDefs; k++) if (w.thingMech[k] === 13) { ball = k; break; }
      w.nextUse[slot] = ball; w.firstPlay[slot] = 1;
      return;
    }
    case SCRIPT.FIRST_WISH:
      if (w.firstWishDone) return;
      w.firstWishPending = 1; w.firstWishSlot = slot; if (arg) w.firstWishDeadline = 1;
      return;
    case SCRIPT.PLAY_WITH: {
      if (slot < 0 || slot >= CAP) return;
      let k = arg;
      if (k >= w.nThingDefs && k < w.globalToLocal.length) k = w.globalToLocal[k];
      if (k >= 0 && k < w.nThingDefs) { w.playWith[slot] = k; w.graceUntil[slot] = -1e9; }
      return;
    }
    case SCRIPT.POSE: w.poseOn = arg ? 1 : 0; return;
    case SCRIPT.CHEER: w.cheerCause = arg >= 0 ? arg : slot; return;
    case SCRIPT.SQUIRTED: if (slot >= 0 && slot < CAP) w.squirtDue[slot] = 1; return;
  }
}

/** The wish scheduler's only inputs from the Journal (on a journal change, never per frame). */
export function lifeSetJournal(w: LifeWorld, owned: Uint32Array, openPlaces: number, favKnown: Uint32Array, thingKinds: number): void {
  for (let j = 0; j < 2; j++) w.owned[j] = owned[j] ?? 0;
  for (let j = 0; j < 4; j++) w.favKnown[j] = favKnown[j] ?? 0;
  w.openPlaces = openPlaces >>> 0; w.thingKinds = thingKinds | 0;
  if ((w.openPlaces & 2) !== 0 && !w.firstWishPending) w.firstWishDone = 1;
}

/** 0 none, 1 Met, 2 Friends, 3 Close friends; best = an authored best-friend pair. At spawn, cut and join, and on a FRIEND event. */
export function lifeSetPair(w: LifeWorld, slotA: number, slotB: number, level: number, best: boolean): void {
  if (slotA < 0 || slotB < 0 || slotA >= CAP || slotB >= CAP || slotA === slotB) return;
  const p = pairIdx(slotA, slotB);
  w.pairLevel[p] = level < 0 ? 0 : level > 3 ? 3 : level; w.pairBest[p] = best ? 1 : 0;
}

/** frost, wet, soak, sand, snow, toast (3.1) into out[0..5]. Zero allocation. */
export function lifeLooks(w: LifeWorld, slot: number, out: Float32Array): void {
  for (let j = 0; j < 6; j++) out[j] = slot >= 0 && slot < CAP ? w.looks[slot * 6 + j] : 0;
}

/** A host event adds to a look and emits that look's REACT with `thing` at the next lifeStep, every time (3.1). Zero allocation. */
export function lifeAddLook(w: LifeWorld, slot: number, look: number, amount: number, thing: number): void { addLook(w, slot, look, amount, thing); }

/** Its open wish: [WISH_KIND, target idx]. */
export function lifeWishOf(w: LifeWorld, slot: number, out: Int32Array): boolean { return wishOf(w, slot, out); }

/** Dev hook (DebugHook.life): brain states, needs, behaviours, the attention counters and the gate (allocates: dev only). */
export function lifeDebug(w: LifeWorld): unknown {
  const chars: unknown[] = [];
  for (let i = 0; i < CAP; i++) if (w.active[i]) chars.push({ slot: i, kind: w.kind[i], species: w.species[i], beh: w.beh[i], phase: w.phase[i],
    moment: w.moment[i] >= 0 ? w.mKind[w.moment[i]] : 0, play: +w.play[i].toFixed(3), company: +w.company[i].toFixed(3), rest: +w.rest[i].toFixed(3),
    traits: Array.from(w.traits.subarray(i * 5, i * 5 + 5), (v) => +v.toFixed(2)), looks: Array.from(w.looks.subarray(i * 6, i * 6 + 6), (v) => +v.toFixed(2)),
    wish: w.wishKind[i] ? [w.wishKind[i], w.wishTarget[i]] : null, moving: w.moving[i] });
  return { place: w.placeIdx, visit: w.visit, layout: w.layout, chars, movers: w.movers, moverCap: w.att.moverCap, unitCap: +w.att.unitCap.toFixed(3),
    allowance: w.att.allowance, granted: w.att.granted, dropped: w.att.dropped, favourites: SPECIES_LIFE.dollop.place };
}
