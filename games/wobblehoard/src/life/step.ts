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
import { attentionFilter, MOVER_CAP, UNIT_CAP, tierOf, WAKE } from './attention.ts';
import type { Attention } from './attention.ts';
import { emitEmote } from './act.ts';
import { emitVoice, PHRASE as PH, voice } from './voice.ts';
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
  for (let k = 0; k < w.nTD; k++) if (w.tG[k] >= 0) THING_ICON_KIND[w.tG[k]] = w.tK[k];
  w.rOL.fill(-1); w.tPX1.fill(NaN); w.tPZ1.fill(NaN); w.tPS.fill(NaN); w.tMT.fill(-1e9);
  if (!newVisit) return;
  for (let m = 0; m < MAX_MOMENTS; m++) { w.mK[m] = 0; w.mN[m] = 0; }
  w.gHK.fill(-1); w.gHN.fill(0);
  w.pG.fill(0); w.pC.fill(0); w.pNe.fill(0);
  w.movers = 0; w.att.movers = 0; w.att.allowance = 0;
  for (let i = 0; i < CAP; i++) {
    w.moo[i] = -1; w.mo[i] = 0;
    if (!w.ac[i]) continue;
    visitReset(w, i);
    resetNeedsLooks(w, i);
    w.aPe[i] = 1;
    if (w.ki[i] !== 2) w.aP[i] = 1;
  }
}
function visitReset(w: LifeWorld, i: number): void {
  w.sT[i * 2] = 0; w.sT[i * 2 + 1] = 0; w.sC[i] = 0;
  w.rN[i] = 0; w.zSe[i] = 0; w.oV[i] = 0; w.eAO[i] = 1; w.b1[i] = 0;
  for (let k = 0; k < MAX_ZONES; k++) w.zIT[i * MAX_ZONES + k] = -1e9;
  for (let k = 0; k < 24; k++) w.rC[i * 24 + k] = -1e9;
  w.beh[i] = BEH.NONE; w.ph[i] = 0; w.bSc[i] = 0; w.fPT[i] = -1e9; w.tT[i] = -1; w.tC[i] = -1; w.uV[i] = 0;
  seedChar(w, i);
}

/** At Home: a character's home slot (its stage.matLayout slot in use); NaN x clears it (D-87). Sent at spawn and on a party or frame change. */
export function lifeSetHome(w: LifeWorld, slot: number, x: number, z: number): void {
  if (slot < 0 || slot >= CAP) return;
  w.hX[slot] = x; w.hZ[slot] = x === x ? z : NaN;
}

/* ───────────────────────────── characters ───────────────────────────── */

/** At spawn, cut and join. kind 0 whole, 1 face piece, 2 chunk; group = the slot of its owning whole (itself for a whole). */
export function lifeAdd(w: LifeWorld, slot: number, genome: Genome, kind: 0 | 1 | 2, group: number, warmth: number, isNew: boolean): void {
  if (slot < 0 || slot >= CAP) return;
  const i = slot;
  const parent = kind !== 0 && group >= 0 && group < CAP && group !== i ? group : -1;
  w.ac[i] = 1; w.ki[i] = kind; w.gr[i] = kind === 0 ? i : group;
  w.species[i] = speciesIdx(genome.species); w.fa[i] = MATERIAL_FAMILY_IDS.indexOf(familyOf(genome.species));
  w.gs[i] = genome.seed >>> 0; w.wa[i] = warmth; w.iN[i] = isNew ? 1 : 0; w.si[i] = signatureCode(genome);
  w.pi[i] = pitchRatio(genome);
  traitsOf(genome, w.tr, i * 5);
  if (parent >= 0 && w.gs[parent] === w.gs[i]) {
    // a piece of a cut squishy: it keeps the whole's needs and looks (the face piece leads with its brain, 9)
    w.pl[i] = w.pl[parent]; w.co[i] = w.co[parent]; w.re[i] = w.re[parent];
    for (let j = 0; j < 6; j++) w.lo[i * 6 + j] = w.lo[parent * 6 + j];
    if (kind === 1) { w.wK[i] = w.wK[parent]; w.wT[i] = w.wT[parent]; w.wT1[i] = w.wT1[parent]; }
    const g = group & 31;
    if (!w.cP[g]) { w.cP[g] = 1; w.cT[g] = NaN; }
  } else { resetNeedsLooks(w, i); w.wK[i] = 0; w.wT[i] = -1; }
  visitReset(w, i);
  if (parent >= 0 && w.gs[parent] === w.gs[i]) { // a piece has seen what its whole saw (it does not notice the place anew)
    w.sT[i * 2] = w.sT[parent * 2]; w.sT[i * 2 + 1] = w.sT[parent * 2 + 1]; w.sC[i] = w.sC[parent] | (1 << parent);
    for (let j = 0; j < CAP; j++) if (w.ac[j] && w.ki[j] !== 0 && w.gr[j] === group) { w.sC[i] |= 1 << j; w.sC[j] |= 1 << i; }
  }
  w.lH[i] = 0; w.he[i] = 0; w.mo[i] = 0; w.moo[i] = -1; w.aPe[i] = 1; w.aP[i] = kind === 0 ? 1 : 0;
  w.rT[i] = -1e9; w.gU[i] = -1e9; w.lTo[i] = -1; w.tST[i] = -1e9; w.aD[i] = 0; w.wD[i] = -1;
  w.cD[i] = 0; w.hD[i] = 0; w.hF[i] = -1; w.rU[i] = -1e9; w.rTh[i] = -1; w.rP[i] = 0; w.uS[i] = 0;
  w.pW[i] = -1; w.nU[i] = -1; w.fP[i] = 0; w.sU[i] = -1e9; w.pWT[i] = -1e9; w.wLNT[i] = -1e9;
  w.lHT[i] = -1e9; w.lJT[i] = -1e9; w.lNT[i] = -1e9; w.ex[i] = 0; w.eA[i] = 0; w.sqS[i] = 1; w.sD[i] = 0;
  for (let j = 0; j < 4; j++) w.pK[i * 4 + j] = 0;
  for (let j = 0; j < CAP; j++) {
    const p = pairIdx(i, j); w.pL[p] = 0; w.pB[p] = 0; w.pG[p] = 0; w.pC[p] = 0; w.pNe[p] = 0; w.pCo[p] = -1e9;
    w.sC[j] &= ~(1 << i);
  }
  for (let j = 0; j < 26; j++) w.coo[i * 26 + j] = -1e9;
}

/** It went back to the shelf, was cut (the whole), or joined (the pieces). Its open wish rests in the Journal (the shell's). */
export function lifeRemove(w: LifeWorld, slot: number): void {
  if (slot < 0 || slot >= CAP || !w.ac[slot]) return;
  const m = w.moo[slot];
  if (m >= 0) {
    for (let k = 0; k < w.mN[m]; k++) { const j = w.mM[m * MAX_MEMBERS + k]; if (j >= 0) { w.moo[j] = -1; w.beh[j] = BEH.IDLE; w.mo[j] = 0; } }
    w.mK[m] = 0; w.mN[m] = 0;
  }
  w.ac[slot] = 0; w.mo[slot] = 0; w.moo[slot] = -1; w.wK[slot] = 0;
  if (w.att.wishOwner === slot) w.att.wishOwner = -1;
  w.att.wishDot[slot] = 0;
  w.hX[slot] = NaN; w.hZ[slot] = NaN;
}

/* ───────────────────────────── the step ───────────────────────────── */

const MAX_CATCHUP = 5;

export function lifeStep(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents): void {
  out.n = 0; ev.n = 0;
  w.pCh.fill(0);
  const t = s.t;
  if (!(w.f[F.T0] === w.f[F.T0])) w.f[F.T0] = t;
  // newly added characters start thinking from now; a cut's time is now
  w.nO = 0;
  for (let i = 0; i < CAP; i++) {
    if (!w.ac[i]) continue;
    if (w.ki[i] === 0) w.nO++;
    if (w.aPe[i]) {
      // its first think is its first boundary after the previous call (not after this call's time), so the frame rate never shifts it (LF-16)
      w.aPe[i] = 0;
      const off = i * STAGGER_S;
      const lastT = w.f[F.LAST_T];
      if (lastT === lastT) w.ti[i] = Math.floor((lastT - off) / THINK_S + 1e-9) + 1;
      else w.ti[i] = t < THINK_S + off ? 0 : Math.ceil((t - off) / THINK_S - 1e-9); // added before the first call: from the grid's start
      w.lT[i] = -1e9;
      w.aT[i] = w.ti[i] * THINK_S + off;
    }
  }
  for (let g = 0; g < 32; g++) if (w.cP[g] && !(w.cT[g] === w.cT[g])) w.cT[g] = t;
  // the things out now: rows, and whether each moved or switched since the last call (B02)
  w.rOL.fill(-1);
  for (let r = 0; r < s.nThings && r < 32; r++) {
    const g = s.thingId[r];
    if (g < 0 || g >= w.gTL.length) continue;
    const k = w.gTL[g];
    if (k < 0) continue;
    w.rOL[k] = r;
    const px = w.tPX1[k], pz = w.tPZ1[k], ps = w.tPS[k];
    if (px === px && (Math.abs(s.thingX[r] - px) > 0.02 || Math.abs(s.thingZ[r] - pz) > 0.02 || Math.abs(s.thingState[r] - ps) > 0.05)) w.tMT[k] = t;
    w.tPX1[k] = s.thingX[r]; w.tPZ1[k] = s.thingZ[r]; w.tPS[k] = s.thingState[r];
  }
  if (s.musicBoxOn && !w.mPr) w.f[F.MUSIC_ON] = t;
  w.mPr = s.musicBoxOn ? 1 : 0;
  for (let b = 0; b < s.nBumps; b++) {
    const a = s.bumpA[b], c = s.bumpB[b];
    if (a >= 0 && a < CAP) { w.bT1[a] = t; w.bW[a] = c; }
    if (c >= 0 && c < CAP) { w.bT1[c] = t; w.bW[c] = a; }
  }
  // movers (a piece group counts 1) and the wakes LIFE claimed that the snapshot does not show yet
  let movers = 0, groups = 0;
  w.f[F.UNITS] = 0;
  for (let i = 0; i < CAP; i++) {
    if (!w.ac[i]) { w.mo[i] = 0; continue; }
    if (w.mo[i]) {
      if (w.ki[i] === 0) movers++;
      else { const bit = 1 << (w.gr[i] & 31); if ((groups & bit) === 0) { groups |= bit; movers++; } }
    }
    if (i < s.n && t - w.wCT[i] < 0.3 && (s.flags[i] & LIFE_FLAG.ASLEEP) !== 0) w.f[F.UNITS] += w.ki[i] === 0 ? WAKE.whole : WAKE.piece;
  }
  w.movers = movers;
  const a = w.att;
  a.movers = movers; a.moverCap = MOVER_CAP[tierOf(s)];
  if (a.unitCap !== UNIT_CAP[tierOf(s)]) a.unitCap = UNIT_CAP[tierOf(s)];
  let anyRideMoment = false;
  for (let m = 0; m < MAX_MOMENTS; m++) if (w.mK[m] === 10 || w.mK[m] === 11) anyRideMoment = true;
  if (!anyRideMoment && a.allowance !== 0) a.allowance = 0;
  // every brain function reads the time from w.f[F.NOW] (LF-02): the per-call passes run at the snapshot's t, each think at its boundary
  w.f[F.NOW] = t;
  // lifeAddLook's REACTs (every time, with the source thing)
  for (let p = 0; p < w.pN1; p++) {
    const i = w.pSl[p];
    if (i >= 0 && i < CAP && w.ac[i]) emitReact(w, s, ev, i, w.pKi[p], w.pTh[p], 1);
  }
  w.pN1 = 0;
  // the player's touch (HELD in the same step), releases, touch kinds, landings
  touchPass(w, s, out, ev);
  // a cut inside a zone: one PIECES record per zone REACT the new group stands in, at the cut
  for (let g = 0; g < 32; g++) if (w.cP[g]) { w.cP[g] = 0; cutReacts(w, s, ev, g); }
  // deferred scripts: CHEER (up to two near the cause), SQUIRTED (the target's wow, then its giggle)
  if (w.cC >= 0) { cheerNear(w, s, w.cC); w.cC = -1; }
  for (let i = 0; i < s.n && i < CAP; i++) if (w.sD[i]) {
    w.sD[i] = 0;
    if (!w.ac[i]) continue;
    emitEmote(w, s, out, i, EMOTE.wow, 0, 1, 0, 0, 1);
    voice(w, s, out, i, PH.NOTICE, 0, 1);
    voice(w, s, out, i, PH.GIGGLE, 800, 1);
  }
  // the thinks, in boundary order (LF-16)
  for (let guard = 0; guard < CAP * (MAX_CATCHUP + 1); guard++) {
    let best = -1, bt = 1e300;
    for (let i = 0; i < CAP; i++) {
      if (!w.ac[i] || i >= s.n) continue;
      const tb = w.ti[i] * THINK_S + i * STAGGER_S;
      if (tb <= t + 1e-9 && tb < bt) { bt = tb; best = i; }
    }
    if (best < 0) break;
    w.f[F.NOW] = bt;
    think(w, s, out, ev, best);
    w.ti[best]++;
    const off = best * STAGGER_S;
    if (t - (w.ti[best] * THINK_S + off) > MAX_CATCHUP * THINK_S) w.ti[best] = Math.ceil((t - off) / THINK_S - 1e-9);
  }
  // thing and song wishes granted by this tick's events
  w.f[F.NOW] = t;
  wishFromEvents(w, s, out, ev);
  attentionFilter(a, s, out);
  w.f[F.LAST_T] = t;
}

function think(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW], last = w.lT[i];
  if (last > -1e8) w.f[F.DT] = Math.min(0.5, tb - last); else w.f[F.DT] = THINK_S; // no phi with a tagged constant (a boxed double, LF-02)
  w.lT[i] = tb;
  senseZones(w, s, i);
  integrate(w, s, ev, i);
  reactZones(w, s, ev, i);
  if (w.fWP) firstWishThink(w, s, out, ev);
  wishCheck(w, s, out, ev, i);
  behave(w, s, out, ev, i);
}

function cheerNear(w: LifeWorld, s: LifeSnapshot, cause: number): void {
  if (cause < 0 || cause >= s.n) return;
  let a = -1, b = -1, da = 1e9, db = 1e9;
  for (let j = 0; j < s.n; j++) {
    if (j === cause || !w.ac[j] || w.ki[j] === 2) continue;
    const dx = s.x[j] - s.x[cause], dz = s.z[j] - s.z[cause], d = dx * dx + dz * dz;
    if (d < da) { db = da; b = a; da = d; a = j; } else if (d < db) { db = d; b = j; }
  }
  if (a >= 0) w.cD[a] = 1;
  if (b >= 0) w.cD[b] = 1;
}

/* ───────────────────────────── scripts, the journal, pairs, looks, wishes ───────────────────────────── */

/** LIFE 4.1's six scripts (SCRIPT ids). FIRST_PLAY: slot = the play body; FIRST_WISH: slot = the wisher (D-70), arg 1 = the 5:00 backstop;
 *  PLAY_WITH: arg = the place-local thing index (a global THING_IDS index is accepted too); POSE: arg 1 picked, 0 put away; CHEER: arg = the
 *  slot that caused it; SQUIRTED: slot = the target. */
export function lifeScript(w: LifeWorld, slot: number, script: number, arg: number): void {
  switch (script) {
    case SCRIPT.FIRST_PLAY: {
      if (w.fPD || slot < 0 || slot >= CAP || !w.ac[slot]) return;
      w.fPD = 1;
      if (w.pl[slot] < 0.6) w.pl[slot] = 0.6;
      let ball = w.gTL[THING_IDS.indexOf('feltball')];
      if (ball < 0) for (let k = 0; k < w.nTD; k++) if (w.tM[k] === 13) { ball = k; break; }
      w.nU[slot] = ball; w.fP[slot] = 1;
      return;
    }
    case SCRIPT.FIRST_WISH:
      if (w.fWD) return;
      w.fWP = 1; w.fWS = slot; if (arg) w.fWDe = 1;
      return;
    case SCRIPT.PLAY_WITH: {
      if (slot < 0 || slot >= CAP) return;
      let k = arg;
      if (k >= w.nTD && k < w.gTL.length) k = w.gTL[k];
      if (k >= 0 && k < w.nTD) { w.pW[slot] = k; w.gU[slot] = -1e9; }
      return;
    }
    case SCRIPT.POSE: w.pO = arg ? 1 : 0; return;
    case SCRIPT.CHEER: w.cC = arg >= 0 ? arg : slot; return;
    case SCRIPT.SQUIRTED: if (slot >= 0 && slot < CAP) w.sD[slot] = 1; return;
  }
}

/** The wish scheduler's only inputs from the Journal (on a journal change, never per frame). */
export function lifeSetJournal(w: LifeWorld, owned: Uint32Array, openPlaces: number, favKnown: Uint32Array, thingKinds: number): void {
  for (let j = 0; j < 2; j++) w.ow[j] = owned[j] ?? 0;
  for (let j = 0; j < 4; j++) w.fK[j] = favKnown[j] ?? 0;
  w.oP = openPlaces >>> 0; w.tKi = thingKinds | 0;
  if ((w.oP & 2) !== 0 && !w.fWP) w.fWD = 1;
}

/** The friend wish's input (QUESTS 8; additive, round 2): for species `speciesIdx` (catalog idx), the species it may wish to see, as a
 *  2-word bit mask by catalog idx: those at Friends or closer with it, and its authored best friend only once F3 is found (so a wish never
 *  gives the riddle away). On a journal change (a FRIEND level, F3 found, a load), never per frame; zero allocation. The wish itself also
 *  needs the friend owned (lifeSetJournal's `owned`) and not out. */
export function lifeSetFriends(w: LifeWorld, speciesIdx: number, friendMask: Uint32Array): void {
  if (speciesIdx < 0 || speciesIdx >= 64) return;
  w.fr[speciesIdx * 2] = friendMask[0] >>> 0; w.fr[speciesIdx * 2 + 1] = (friendMask[1] ?? 0) >>> 0;
}

/** S2's raised hops (LIFE 5.2, D-07): a bit per MATERIAL_FAMILY_IDS index for each family whose raised hop passed PH-01 (`auto` landings);
 *  0 keeps every family at the S1 cap (vy 0.84). The shell sets it with the slice (a build flag), never per frame. Pieces stay at the S1 cap. */
export function lifeSetHops(w: LifeWorld, raisedFamilies: number): void { w.hR = raisedFamilies & 0xfff; }

/** 0 none, 1 Met, 2 Friends, 3 Close friends; best = an authored best-friend pair. At spawn, cut and join, and on a FRIEND event. */
export function lifeSetPair(w: LifeWorld, slotA: number, slotB: number, level: number, best: boolean): void {
  if (slotA < 0 || slotB < 0 || slotA >= CAP || slotB >= CAP || slotA === slotB) return;
  const p = pairIdx(slotA, slotB);
  w.pL[p] = level < 0 ? 0 : level > 3 ? 3 : level; w.pB[p] = best ? 1 : 0;
}

/** frost, wet, soak, sand, snow, toast (3.1) into out[0..5]. Zero allocation. */
export function lifeLooks(w: LifeWorld, slot: number, out: Float32Array): void {
  for (let j = 0; j < 6; j++) out[j] = slot >= 0 && slot < CAP ? w.lo[slot * 6 + j] : 0;
}

/** A host event adds to a look and emits that look's REACT with `thing` at the next lifeStep, every time (3.1). Zero allocation. */
export function lifeAddLook(w: LifeWorld, slot: number, look: number, amount: number, thing: number): void { addLook(w, slot, look, amount, thing); }

/** Its open wish: [WISH_KIND, target idx]. */
export function lifeWishOf(w: LifeWorld, slot: number, out: Int32Array): boolean { return wishOf(w, slot, out); }

/** Dev hook (DebugHook.life): brain states, needs, behaviours, the attention counters and the gate (allocates: dev only). */
export function lifeDebug(w: LifeWorld): unknown {
  const chars: unknown[] = [];
  for (let i = 0; i < CAP; i++) if (w.ac[i]) chars.push({ slot: i, kind: w.ki[i], species: w.species[i], beh: w.beh[i], phase: w.ph[i],
    moment: w.moo[i] >= 0 ? w.mK[w.moo[i]] : 0, play: +w.pl[i].toFixed(3), company: +w.co[i].toFixed(3), rest: +w.re[i].toFixed(3),
    traits: Array.from(w.tr.subarray(i * 5, i * 5 + 5), (v) => +v.toFixed(2)), looks: Array.from(w.lo.subarray(i * 6, i * 6 + 6), (v) => +v.toFixed(2)),
    wish: w.wK[i] ? [w.wK[i], w.wT[i]] : null, moving: w.mo[i] });
  return { place: w.placeIdx, visit: w.visit, layout: w.layout, chars, movers: w.movers, moverCap: w.att.moverCap, unitCap: +w.att.unitCap.toFixed(3),
    allowance: w.att.allowance, granted: w.att.granted, dropped: w.att.dropped, favourites: SPECIES_LIFE.dollop.place };
}
