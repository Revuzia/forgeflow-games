// Joint moments (LIFE.md 6.1): S01 greet, S02 chat, S03 boop (a soft boop where its two bodies do not fit, D-85), S04 nuzzle, S05 copy and
// parade, S06 sing together (sim-time bars, D-66), S07 snuggle (a behaviour: gathers 3+ into a row, D-75), S09 comfort, S10 teeter, S11 push
// the swing (the ride allowance, D-85), S12 pass the ball, S13 peekaboo (the two peek spots, D-75), S15 twin dance, S17 duet, S18 twirl. A
// moment reserves every member at its start (no character is in two at once, LF-11) and moves ONE character at a time (LF-10); only S15 and
// S18 move two together, and only where moverCap is 2 or more. Points are the reducer's: LIFE emits SOCIAL events with a, b, n2. Owned by PG_LIFE.
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../contracts.ts';
import { SOCIAL_KIND, LIFE_EV, LIFE_FLAG, EMOTE, SOCIAL } from '../data/life.ts';
import { MECH } from '../data/places.ts';
import type { LifeWorld } from './world.ts';
import { CAP, F, MAX_MOMENTS, MAX_MEMBERS, BEH, USES_FULL, pushEvent, pairIdx, rnd, U16, dmm, inBounds, shrinkMm, keepMm, clearOfThings, noLean, qT, freeSpot } from './world.ts';
import { gateStart, gateFits, stopMove, travelTo, travelStep, emitHop, emitPose, clearPose, emitGaze, emitEmote, emitExpr, emitScoot, emitSquash, HELD_BITS, say } from './act.ts';
import { MOVER_CAP, tierOf, UNIT, WAKE, STYLE } from './attention.ts';
import { emitVoice, PHRASE, toNextBarMs, BAR_S, voice } from './voice.ts';
import { TRAIT } from './traits.ts';

export const S = SOCIAL_KIND;
const WISH_FRIEND = 4; // WISH_KIND.FRIEND
/** Moment ids (S01..S18 = 1..18), as LIFE 6.1 numbers them; the SOCIAL event's sub is SOCIAL[id - 1].kind (S05 is COPY or PARADE). */
export const MOM = { GREET: 1, CHAT: 2, BOOP: 3, NUZZLE: 4, COPY: 5, SING: 6, SNUGGLE: 7, PILE: 8, COMFORT: 9, TEETER: 10, PUSH: 11, PASS: 12,
  PEEK: 13, SQUIRT: 14, MIRROR: 15, ECHO: 16, DUET: 17, TWIRL: 18, PARADE: 19 } as const;
/** (round 4, my reading of PLACES 4.2's finale "the fire swells and everyone sings with the music") S06's score at a tune: 0.95, above a
 *  dozy nap's trigger or a favourite ball (round 2's 0.8 lost the fire's song to them about one time in four). The two chatty friends' song
 *  stays 0.45. */
const SONG_AT_TUNE = 0.95;
/** Pair bits of the once-per-visit moments. */
const PB = { GREET: 1, MIRROR: 2, DUET: 4, TWIRL: 8 } as const;

export function mem(w: LifeWorld, m: number, k: number): number { return w.mM[m * MAX_MEMBERS + k]; }

/** Is character j free to join a moment (not HELD, not in a moment, idle-ish, not napping, not on a ride unless allowed)? */
export function isFree(w: LifeWorld, s: LifeSnapshot, j: number, rideOk: boolean): boolean {
  if (j < 0 || j >= s.n || !w.ac[j] || w.moo[j] >= 0) return false;
  if ((s.flags[j] & HELD_BITS) !== 0) return false;
  if (!rideOk && (s.flags[j] & LIFE_FLAG.RIDE) !== 0) return false;
  const b = w.beh[j];
  // the still, short behaviours (notice, watch, answer) give way to a moment; a wander stops for it
  return b === BEH.NONE || b === BEH.IDLE || b === BEH.WANDER || b === BEH.NOTICE || (b === BEH.WATCH && w.ph[j] !== 1) || b === BEH.ANSWER || (rideOk && b === BEH.RIDE);
}

function freeSlot(w: LifeWorld): number {
  for (let m = 0; m < MAX_MOMENTS; m++) if (w.mK[m] === 0) return m;
  return -1;
}

/** Start moment `kind` with members a, b (and c..f, -1 for none): reserves them all at once or nothing (LF-11). Returns the moment or -1. */
export function startMoment(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, kind: number, a: number, b: number, c: number): number {
  const tb = w.f[F.NOW];
  const m = freeSlot(w);
  if (m < 0) return -1;
  if (a < 0 || w.moo[a] >= 0 || (b >= 0 && w.moo[b] >= 0) || (c >= 0 && w.moo[c] >= 0)) return -1;
  w.mK[m] = kind; w.mN[m] = 0; w.mT0[m] = tb; w.mE[m] = tb + 60; w.mP[m] = 0; w.mT[m] = 0; w.mNe[m] = tb; w.mS[m] = 0;
  w.mTh[m] = -1; w.mSo[m] = 0; w.mR[m] = 0; w.mC[m] = 0;
  for (let k = 0; k < MAX_MEMBERS; k++) w.mM[m * MAX_MEMBERS + k] = -1;
  addMember(w, out, m, a);
  if (b >= 0) addMember(w, out, m, b);
  if (c >= 0) addMember(w, out, m, c);
  return m;
}
export function addMember(w: LifeWorld, out: LifeIntents, m: number, j: number): boolean {
  const tb = w.f[F.NOW];
  if (j < 0 || w.moo[j] >= 0 || w.mN[m] >= MAX_MEMBERS) return false;
  if (w.mo[j]) stopMove(w, out, j);
  w.mM[m * MAX_MEMBERS + w.mN[m]++] = j; w.moo[j] = m; w.beh[j] = BEH.MOMENT; w.ph[j] = 0; w.bT[j] = tb;
  return true;
}

/** End moment m: release its members (stop their motion, clear their poses), optionally emitting its SOCIAL event. */
export function endMoment(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, m: number, emit: boolean): void {
  const tb = w.f[F.NOW];
  const kind = w.mK[m];
  if (kind === 0) return;
  const n = w.mN[m], a = mem(w, m, 0), b = n > 1 ? mem(w, m, 1) : -1;
  if (emit) {
    const sub = kind === MOM.PARADE ? S.PARADE : SOCIAL[kind - 1].kind;
    pushEvent(ev, LIFE_EV.SOCIAL, sub, a, b, n, kind === MOM.GREET && w.mSo[m] === 2 ? -2 : w.mTh[m] >= 0 ? w.tG[w.mTh[m]] : -1);
    for (let k = 0; k < n; k++) { const j = mem(w, m, k); if (j >= 0) { w.co[j] = Math.max(0, w.co[j] - 0.5); w.lJT[j] = tb; } }
    if (a >= 0 && b >= 0) w.pCo[pairIdx(a, b)] = tb + 20;
  } else if (a >= 0 && b >= 0) {
    // a once-per-visit moment that never happened (its walk-up found no mover token, a touch ended it) is not spent
    const pi = pairIdx(a, b);
    if (kind === MOM.GREET && w.mSo[m] !== 2) w.pG[pi] &= ~PB.GREET;
    else if (kind === MOM.MIRROR) w.pG[pi] &= ~PB.MIRROR;
    else if (kind === MOM.DUET) w.pG[pi] &= ~PB.DUET;
    else if (kind === MOM.TWIRL) w.pG[pi] &= ~PB.TWIRL;
  }
  for (let k = 0; k < n; k++) {
    const j = mem(w, m, k);
    if (j < 0) continue;
    if (w.mo[j]) stopMove(w, out, j);
    if ((s.flags[j] & HELD_BITS) === 0) clearPose(w, s, out, j);
    w.moo[j] = -1; w.beh[j] = BEH.IDLE; w.ph[j] = 0; w.bT[j] = tb; w.bSc[j] = 0.1;
    if ((s.flags[j] & LIFE_FLAG.RIDE) !== 0 && (kind === MOM.TEETER || kind === MOM.PUSH)) { w.beh[j] = BEH.RIDE; w.rU[j] = tb; }
  }
  if (kind === MOM.PUSH || kind === MOM.TEETER) w.att.allowance = 0;
  w.mK[m] = 0; w.mN[m] = 0;
}

/** A member was touched (HELD): the moment ends for everyone; the others wait 2 s, then a small "your turn" hop (5.5). */
export function abortFor(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, j: number): void {
  const tb = w.f[F.NOW];
  const m = w.moo[j];
  if (m < 0) return;
  for (let k = 0; k < w.mN[m]; k++) { const o = mem(w, m, k); if (o >= 0 && o !== j) w.pWT[o] = tb + 2; }
  endMoment(w, s, out, ev, m, false);
}

/* ───────────────────────────── choosing a moment (scores feed the brain's utility choice) ───────────────────────────── */

function idle(w: LifeWorld, j: number): boolean { const b = w.beh[j]; return b === BEH.IDLE || b === BEH.NONE || b === BEH.WANDER || b === BEH.NOTICE || b === BEH.WATCH; }

/** The best moment character i could start now: its id (0 none); score into w.f[F.A], partner into w.f[F.B], a third member into w.f[F.C]. */
export function socialPick(w: LifeWorld, s: LifeSnapshot, i: number, canMove: boolean): number {
  const tb = w.f[F.NOW];
  w.f[F.A] = 0; w.f[F.B] = -1; w.f[F.C] = -1;
  if (w.ki[i] === 2 || !isFree(w, s, i, false)) return 0;
  const tr = i * 5, whole = w.ki[i] === 0;
  let best = 0, bs = 0, bp = -1, nIdle = 0, happy = tb - w.lJT[i] < 8;
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.ac[j]) continue;
    // S11 push the swing: any other squishy within 2.5 m of a rider the player set on a swing (the rider is RIDE, not free)
    if (canMove && (s.flags[j] & LIFE_FLAG.RIDE) !== 0 && w.moo[j] < 0 && (s.flags[j] & HELD_BITS) === 0 && dmm(s, i, j) < 3300) {
      const rt = w.rTh[j];
      if (rt >= 0 && w.tM[rt] === MECH.swing && w.tPX[rt] === w.tPX[rt] && 0.8 > bs) { bs = 0.8; best = MOM.PUSH; bp = j; }
      continue;
    }
    if (!isFree(w, s, j, false)) continue;
    const d = dmm(s, i, j) * 0.001, p = pairIdx(i, j), lvl = w.pL[p], cool = tb < w.pCo[p];
    if (d < 2.5 && idle(w, j) && w.ki[j] !== 2) { nIdle++; if (tb - w.lJT[j] < 8) happy = true; }
    if (w.ki[j] === 2) continue;
    let sc = 0, k = 0;
    // S01 greet: another whole within 1.6 m (+0.5 m for a shy newcomer), not greeted this visit
    // (my reading: in the first 60 s of a visit the party says hello before anything else, so every pair greets; a pair farther than 1.6 m
    // walks over first, one mover at a time)
    const early = tb - w.aT[i] < 60 && tb - w.aT[j] < 60 ? 1 : 0;
    const ungreeted = whole && w.ki[j] === 0 && (w.pG[p] & PB.GREET) === 0;
    // the friend wish (QUESTS 8): the wisher goes to greet the squishy it wished to see, from anywhere in the place; when this pair has
    // greeted already this visit, that greet comes once more (the grant greet: no friendship points, SOCIAL thing = -2 for the host)
    // (round 4: a greet that needs a walk-up is a candidate only while a mover token is free: a joint moment reserves its tokens and units
    // together or does not start (PG_LIFE brief 7); round 2's walk-up waited reserved for up to 6 s, and with moverCap 1 two such waits
    // kept the walkers' partners in moments no one could join for half a minute: three set beside the kettle missed its whistle)
    const walk = canMove && gateFits(w, s, i, 0, 0);
    const wished = whole && w.ki[j] === 0 && w.wK[i] === WISH_FRIEND && w.wT[i] === w.species[j];
    if (wished && (d < 1.6 || walk)) { sc = 1.2; k = MOM.GREET; }
    else if (ungreeted && d < 1.6 + (tb < w.sU[i] || tb < w.sU[j] ? 0.5 : 0)) { sc = early ? 1.15 : 0.85; k = MOM.GREET; }
    else if (ungreeted && walk && d < 1.2 + 1.0 * w.tr[tr + TRAIT.curious] + 2.6 && idle(w, j) && tb >= w.sU[i]) { sc = early ? 1.1 : 0.6; k = MOM.GREET; }
    // (my reading of S01: two wholes say hello before they play together, so an ungreeted pair starts no other pair moment; LF-09)
    if (!cool && !ungreeted && idle(w, i) && idle(w, j)) {
      // S15 twin dance
      if (whole && w.ki[j] === 0 && w.species[j] === w.species[i] && d < 2 && (w.pG[p] & PB.MIRROR) === 0 && 0.9 > sc) { sc = 0.9; k = MOM.MIRROR; }
      // S02 chat
      if (whole && w.ki[j] === 0 && lvl >= 1 && d < 1.5 && w.pC[p] < 3) { const v = 0.35 + 0.3 * w.tr[tr + TRAIT.chatty]; if (v > sc) { sc = v; k = MOM.CHAT; } }
      // S03 boop
      if (w.tr[tr + TRAIT.bouncy] > 0.6 && d < 1.2 && canMove) { const v = 0.35 + 0.3 * w.tr[tr + TRAIT.bouncy] * w.pl[i]; if (v > sc) { sc = v; k = MOM.BOOP; } }
      // S04 nuzzle
      if (d < 1.0 + s.r[i] + s.r[j] - 0.9 + 0.9 && d < 1.0 + 0.2 && (lvl >= 2 || w.tr[tr + TRAIT.cuddly] >= 0.6 || w.tr[j * 5 + TRAIT.cuddly] >= 0.6) && canMove) {
        const v = 0.4 + 0.3 * w.tr[tr + TRAIT.cuddly]; if (v > sc) { sc = v; k = MOM.NUZZLE; } }
      // S17 duet / S18 twirl (once per visit)
      if (whole && w.ki[j] === 0 && lvl >= 2 && (w.pG[p] & PB.DUET) === 0 && d < 2.5 && 0.5 > sc) { sc = 0.5; k = MOM.DUET; }
      if (whole && w.ki[j] === 0 && lvl >= 3 && (w.pG[p] & PB.TWIRL) === 0 && d < 2 && 0.55 > sc) { sc = 0.55; k = MOM.TWIRL; }
      // S05 copy: a curious one sees a hop within 2 m; with a third idle whole near a leader with bouncy >= 0.6, a little parade (in a place)
      if (w.tr[tr + TRAIT.curious] > 0.5 && d < 2 && tb - w.lHT[j] < 1 && canMove) {
        const v = 0.45 + 0.3 * w.tr[tr + TRAIT.curious];
        if (v > sc) { sc = v; k = MOM.COPY; }
        if (!w.home && whole && w.ki[j] === 0 && w.tr[j * 5 + TRAIT.bouncy] >= 0.6 && paradeThird(w, s, i, j) >= 0 && v + 0.1 > sc) { sc = v + 0.1; k = MOM.PARADE; }
      }
      // S12 pass the ball: two within 2.5 m of a ball, one bouncy > 0.5
      if (canMove && (w.tr[tr + TRAIT.bouncy] > 0.5 || w.tr[j * 5 + TRAIT.bouncy] > 0.5) && w.pl[i] > 0.4 && w.uV[i] < USES_FULL && w.uV[j] < USES_FULL) {
        const ball = ballNear(w, s, i, j);
        if (ball >= 0) { const v = 0.5 + 0.3 * w.pl[i]; if (v > sc) { sc = v; k = MOM.PASS; } }
      }
      // S13 peekaboo
      if (canMove && whole && d < 3) { const pk = peekThing(w, s, i, j); if (pk >= 0) { const v = 0.4 + 0.3 * w.tr[tr + TRAIT.curious]; if (v > sc) { sc = v; k = MOM.PEEK; } } }
    }
    // S09 comfort (B17): a Met-or-closer friend within 2.5 m chilly, soaked or just huffed; cuddly > 0.4
    if (whole && lvl >= 1 && d < 2.5 && w.tr[tr + TRAIT.cuddly] > 0.4 && tb >= w.coo[i * 26 + BEH.COMFORT] && canMove &&
      (w.lo[j * 6] > 0.5 || w.lo[j * 6 + 2] > 0.5 || tb - w.hT[j] < 5) && 0.85 > sc) { sc = 0.85; k = MOM.COMFORT; }
    if (k !== 0 && sc > bs) { bs = sc; best = k; bp = j; }
  }
  // S06 sing together: a tune plays (the Music Box, the kettle's whistle, a tapped chime row, the fire puff) and 2+ idle within 2.5 m of it,
  // or 2 chatty friends, once per 2 min per place. (round 4) The singers are the idle ones within 2.5 m of the TUNE (LIFE 6.1; round 2
  // gathered them around the first singer), and a squishy answering the tune (B18, a still, short behaviour) sings with them.
  if (tb - w.f[F.SONG] >= 120 && idle(w, i)) {
    let v = 0;
    const tk = tunePlaying(w, s);
    if (tk !== -1 && tuneNear(w, s, i, tk) && singersNear(w, s, i, tk) >= 2) v = SONG_AT_TUNE;
    else if (nIdle >= 1 && w.tr[tr + TRAIT.chatty] > 0.6 && friendChattyNear(w, s, i)) v = 0.45;
    if (v > bs) { bs = v; best = MOM.SING; bp = -1; }
  }
  // (round 4) a song that has not reached its first bar line yet takes a latecomer near its tune who just became free (its greet or chat
  // ended while the kettle whistled): it joins the shared song (bp = -2 - the moment)
  if (SONG_AT_TUNE > bs && canSing(w, s, i)) {
    for (let m = 0; m < MAX_MOMENTS; m++) {
      if (w.mK[m] !== MOM.SING || w.mP[m] !== 1 || w.mN[m] >= MAX_MEMBERS || tb >= w.mE[m] - 2 * BAR_S - 0.05) continue;
      const tk = w.mTh[m], a = mem(w, m, 0);
      if (w.home ? a >= 0 && dmm(s, i, a) < 4500 : tk >= 0 && tuneNear(w, s, i, tk)) { bs = SONG_AT_TUNE; best = MOM.SING; bp = -2 - m; break; }
    }
  }
  // S07 snuggle: 3 or more idle (not napping) within 2.5 m, any one of them happy
  if (canMove && nIdle >= 2 && happy && idle(w, i) && 0.55 > bs && tb >= w.coo[i * 26 + BEH.MOMENT]) { bs = 0.55; best = MOM.SNUGGLE; bp = -1; }
  w.f[F.A] = bs; w.f[F.B] = bp;
  return best;
}

/** Another idle, free whole within 2.5 m of the leader j (not i), or -1: a parade needs 3 or more (S05). */
function paradeThird(w: LifeWorld, s: LifeSnapshot, i: number, j: number): number {
  for (let k = 0; k < s.n; k++) if (k !== i && k !== j && w.ki[k] === 0 && isFree(w, s, k, false) && idle(w, k) && dmm(s, j, k) < 2500) return k;
  return -1;
}
function ballNear(w: LifeWorld, s: LifeSnapshot, i: number, j: number): number {
  for (let k = 0; k < w.nTD; k++) {
    if (w.tM[k] !== MECH.ball) continue;
    const r = w.rOL[k];
    if (r < 0) continue;
    const bx = s.thingX[r], bz = s.thingZ[r];
    const di = Math.sqrt((s.x[i] - bx) * (s.x[i] - bx) + (s.z[i] - bz) * (s.z[i] - bz)), dj = Math.sqrt((s.x[j] - bx) * (s.x[j] - bx) + (s.z[j] - bz) * (s.z[j] - bz));
    if (di < 2.5 && dj < 2.5 && !s.thingBusy[r]) return k;
  }
  return -1;
}
function peekThing(w: LifeWorld, s: LifeSnapshot, i: number, j: number): number {
  for (let k = 0; k < w.nTD; k++) {
    if (!(w.tP[k * 4] === w.tP[k * 4])) continue;
    if (w.home && w.rOL[k] < 0) continue;
    const tx = w.tX[k], tz = w.tZ[k];
    const di = Math.sqrt((s.x[i] - tx) * (s.x[i] - tx) + (s.z[i] - tz) * (s.z[i] - tz)), dj = Math.sqrt((s.x[j] - tx) * (s.x[j] - tx) + (s.z[j] - tz) * (s.z[j] - tz));
    if (di < 3 && dj < 3) return k;
  }
  return -1;
}
export function tuneThing(w: LifeWorld, s: LifeSnapshot): number {
  for (let k = 0; k < w.nTD; k++) if (w.tSw[k] === 3 && (!w.home || w.rOL[k] >= 0)) return k;
  return -1;
}
/** The tune playing now for S06: the snapshot's Music Box or kettle tune (its thing, or -2 at Home with no Music Box row: the tune is
 *  wherever it stands in view), else a tapped thing's tune (lifeThingTap: the fire puff, a chime row) while it lasts; -1 none. */
export function tunePlaying(w: LifeWorld, s: LifeSnapshot): number {
  if (s.musicBoxOn) { const k = tuneThing(w, s); return k >= 0 ? k : w.home ? -2 : -1; }
  if (w.tnK >= 0 && w.f[F.NOW] < w.f[F.TUNE_U]) return w.tnK;
  return -1;
}
/** Is character j within 2.5 m of tune tk (Home: anywhere in view, 4.5 m of the first singer as before)? */
function tuneNear(w: LifeWorld, s: LifeSnapshot, j: number, tk: number): boolean {
  if (tk < 0) return w.home;
  const r = w.rOL[tk], tx = r >= 0 ? s.thingX[r] : w.tX[tk], tz = r >= 0 ? s.thingZ[r] : w.tZ[tk];
  return (s.x[j] - tx) * (s.x[j] - tx) + (s.z[j] - tz) * (s.z[j] - tz) < 2.5 * 2.5 + (w.home ? 4 : 0);
}
/** May character j sing in S06 now? (round 4, my reading of "idle" in S06 as S07 spells it out: "idle (not napping)") Any squishy that is
 *  not napping, not using a thing, not walking somewhere on purpose, not in a moment, not held and not riding: idle, looking about, watching,
 *  noticing, answering the tune (B18), still after a touch (B08), reacting to a zone (B15), loving its place (B10), arriving, cheering, or
 *  basking in its warm pose (B05: "everyone sings with the music" by the fire, PLACES 4.2's finale), or about to use a thing but still waiting
 *  for its mover token (B04's first phase). Not a chunk (its piece group sings
 *  through its face piece). */
function canSing(w: LifeWorld, s: LifeSnapshot, j: number): boolean {
  if (j >= s.n || w.ac[j] !== 1 || w.ki[j] === 2 || w.moo[j] >= 0) return false;
  if ((s.flags[j] & HELD_BITS) !== 0 || (s.flags[j] & LIFE_FLAG.RIDE) !== 0) return false;
  const b = w.beh[j];
  return b === BEH.NONE || b === BEH.IDLE || b === BEH.WANDER || b === BEH.NOTICE || (b === BEH.WATCH && w.ph[j] !== 1) || b === BEH.ANSWER ||
    b === BEH.AFTERGLOW || b === BEH.ZONE || b === BEH.LOVE || b === BEH.ARRIVE || b === BEH.CHEER || (b === BEH.BASK && w.ph[j] >= 2) ||
    (b === BEH.USE && w.ph[j] === 0 && !w.mo[j]); // a use still waiting for its mover token has not set off yet
}
/** Character j joins song m: its sway on the beat and its two bars from the song's first bar line (the first `voiced` singers voice it;
 *  phone 2, desktop 3, D-59's voice cap); a basker sits up out of its warm pose to sing. */
function joinSong(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, m: number, j: number): void {
  const tb = w.f[F.NOW];
  const wasBask = w.beh[j] === BEH.BASK;
  if (!addMember(w, out, m, j)) return;
  if (wasBask) emitSquash(w, s, out, j, 1000, 600);
  sway(w, s, out, j, 30, 1100, 1);
  const k = w.mN[m] - 1, waitMs = ((w.mE[m] - 2 * BAR_S - tb) * 1000) | 0;
  if (k < (s.phone ? 2 : 3) && waitMs >= 0) {
    emitVoice(w, s, out, j, PHRASE.SING, waitMs, -1, k, 2, 0);
    emitVoice(w, s, out, j, PHRASE.SING, waitMs + ((BAR_S * 1000) | 0), -1, k + 16, 2, 0);
  }
}
/** How many may sing with i at tune tk (i included): within 2.5 m of the tune (Home: within 4.5 m of i); (round 4, engineer 5) one inside
 *  a snuggle or a peekaboo counts (a song at a tune calls it away: inYielding). */
function singersNear(w: LifeWorld, s: LifeSnapshot, i: number, tk: number): number {
  let n = 1;
  for (let j = 0; j < s.n; j++) if (j !== i && (canSing(w, s, j) || inYielding(w, s, j)) && (w.home ? dmm(s, i, j) < 4500 : tuneNear(w, s, j, tk))) n++;
  return n;
}
/** (round 4, engineer 5) Is j inside a running S07 snuggle or S13 peekaboo that a song at a tune calls it away from? Both are behaviours
 *  (D-75), so LIFE 4's utility choice holds for them while they run: the running one keeps its score + 0.15 (a snuggle 0.55 + 0.15, a
 *  peekaboo at most 0.7 + 0.15) and a song at a tune scores 0.95 (SONG_AT_TUNE). Only one that may sing: a whole or a face piece, not held,
 *  not riding. (The two chatty friends' song, 0.45, calls nobody away.) */
function inYielding(w: LifeWorld, s: LifeSnapshot, j: number): boolean {
  const q = w.moo[j];
  return q >= 0 && (w.mK[q] === MOM.SNUGGLE || w.mK[q] === MOM.PEEK) && w.ki[j] !== 2 && (s.flags[j] & (HELD_BITS | LIFE_FLAG.RIDE)) === 0;
}
/** End the snuggle or peekaboo q a song calls its members away from: a snuggle whose row had formed happened (its SOCIAL goes out); one
 *  still gathering, or a peekaboo, did not. */
function yieldToSong(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, q: number): void {
  endMoment(w, s, out, ev, q, w.mK[q] === MOM.SNUGGLE && w.mP[q] === 2);
}
/** (round 4, engineer 5) Does a tune call the members of running snuggle or peekaboo m to sing, when none outside it starts the song (all
 *  near the tune are inside it)? A member that may sing stands near the playing tune, and either a song at that tune is still before its
 *  first bar line (they join it as latecomers) or a new song may start there (once per 2 min a place) with 2+ singers: the members near
 *  the tune and the free singers near it. */
function songCalls(w: LifeWorld, s: LifeSnapshot, m: number): boolean {
  const tk = tunePlaying(w, s), tb = w.f[F.NOW];
  if (tk === -1) return false;
  let near = 0;
  for (let k = 0; k < w.mN[m]; k++) {
    const j = mem(w, m, k);
    if (j >= 0 && j < s.n && inYielding(w, s, j) && tuneNear(w, s, j, tk)) near++;
  }
  if (near === 0) return false;
  for (let q = 0; q < MAX_MOMENTS; q++) {
    if (w.mK[q] === MOM.SING && w.mP[q] === 1 && w.mN[q] < MAX_MEMBERS && tb < w.mE[q] - 2 * BAR_S - 0.05 && (w.home || w.mTh[q] === tk)) return true;
  }
  if (tb - w.f[F.SONG] < 120) return false;
  for (let j = 0; j < s.n; j++) if (canSing(w, s, j) && tuneNear(w, s, j, tk)) near++;
  return near >= 2;
}
function friendChattyNear(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.ac[j] || w.ki[j] !== 0) continue;
    if (w.pL[pairIdx(i, j)] >= 2 && w.tr[j * 5 + TRAIT.chatty] > 0.6 && dmm(s, i, j) < 2500 && idle(w, j)) return true;
  }
  return false;
}

/** Start the moment socialPick chose (kind, partner in w.f[F.B]); gathers the group members for SING and SNUGGLE. */
export function beginPicked(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number, kind: number): boolean {
  const tb = w.f[F.NOW];
  const p = w.f[F.B] | 0;
  let m = -1;
  if (kind === MOM.SING && p <= -2) { // a latecomer joins a song before its first bar line
    m = -2 - p;
    if (m >= MAX_MOMENTS || w.mK[m] !== MOM.SING || w.mN[m] >= MAX_MEMBERS) return false;
    joinSong(w, s, out, m, i);
    return w.moo[i] === m;
  }
  if (kind === MOM.SING || kind === MOM.SNUGGLE) {
    m = startMoment(w, s, out, kind, i, -1, -1);
    if (m < 0) return false;
    const maxN = kind === MOM.SING ? 6 : 4, tp = tunePlaying(w, s), tk = kind === MOM.SING ? tp : -1;
    for (let j = 0; j < s.n && w.mN[m] < maxN; j++) {
      // (round 4, engineer 5) a song at a tune calls a singer near it out of a snuggle or a peekaboo (inYielding: LIFE 4's choice, 0.95
      // against the running behaviour's score + 0.15); that moment ends first, then it sings
      if (kind === MOM.SING && j !== i && tk !== -1 && !canSing(w, s, j) && inYielding(w, s, j) && (w.home ? dmm(s, i, j) < 4500 : tuneNear(w, s, j, tk))) yieldToSong(w, s, out, ev, w.moo[j]);
      if (j === i || (kind === MOM.SING ? !canSing(w, s, j) : (!w.ac[j] || w.ki[j] === 2 || !isFree(w, s, j, false) || !idle(w, j)))) continue;
      // (round 4) a snuggle does not take one who would rather sing: a tune plays near it with another singer (its own best, 0.95 > 0.55)
      if (kind === MOM.SNUGGLE && tp !== -1 && !w.home && tuneNear(w, s, j, tp) && singersNear(w, s, j, tp) >= 2) continue;
      // a tune's singers stand within 2.5 m of the tune; two chatty friends' song gathers within 2.5 m of the first (Home: 4.5 m)
      if (kind === MOM.SING && tk !== -1 && !w.home ? tuneNear(w, s, j, tk) : dmm(s, i, j) < (kind === MOM.SING && w.home ? 4500 : 2500)) {
        const wasBask = w.beh[j] === BEH.BASK;
        if (addMember(w, out, m, j) && wasBask) emitSquash(w, s, out, j, 1000, 600);
      }
    }
    if (w.mN[m] < (kind === MOM.SNUGGLE ? 3 : 2)) { endMoment(w, s, out, ev, m, false); return false; }
    if (kind === MOM.SING) { w.f[F.SONG] = tb; w.mTh[m] = tk >= 0 ? tk : -1; } // (round 4) two chatty friends' song names no thing
    return true;
  }
  if (p < 0) return false;
  if (kind === MOM.PARADE) { // the leader first (member 0), then the curious one, then up to two more idle wholes near the leader
    m = startMoment(w, s, out, kind, p, i, paradeThird(w, s, i, p));
    if (m < 0) return false;
    const q = paradeThird(w, s, i, p);
    if (q >= 0) addMember(w, out, m, q);
    return true;
  }
  if (kind === MOM.PUSH) { m = startMoment(w, s, out, kind, i, p, -1); if (m >= 0) { w.mTh[m] = w.rTh[p]; w.mR[m] = 1; } return m >= 0; }
  m = startMoment(w, s, out, kind, i, p, -1);
  if (m < 0) return false;
  if (kind === MOM.PASS) w.mTh[m] = ballNear(w, s, i, p);
  if (kind === MOM.PEEK) w.mTh[m] = peekThing(w, s, i, p);
  const pi = pairIdx(i, p);
  if (kind === MOM.GREET) { if ((w.pG[pi] & PB.GREET) !== 0) w.mSo[m] = 2; else w.pG[pi] |= PB.GREET; } // mSoft 2: the grant greet
  if (kind === MOM.MIRROR) w.pG[pi] |= PB.MIRROR;
  if (kind === MOM.DUET) w.pG[pi] |= PB.DUET;
  if (kind === MOM.TWIRL) w.pG[pi] |= PB.TWIRL;
  if (kind === MOM.CHAT) w.pC[pi]++;
  if (kind === MOM.COMFORT) w.coo[i * 26 + BEH.COMFORT] = tb + 30;
  return true;
}

/* ───────────────────────────── running a moment (on its first member's think) ───────────────────────────── */

function face(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, j: number): void {
  w.f[F.X] = s.x[j]; w.f[F.Z] = s.z[j]; emitGaze(w, out, i, 1);
}
function leanTo(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, j: number, ampMilli: number): void {
  const dx = s.x[j] - s.x[i], dz = s.z[j] - s.z[i], d = Math.sqrt(dx * dx + dz * dz) || 1;
  w.f[F.X2] = dx / d * ampMilli * 0.001; w.f[F.Z2] = dz / d * ampMilli * 0.001; w.f[F.A] = 0; w.f[F.B] = 0;
  emitPose(w, s, out, i, 0);
}
function sway(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, ampMilli: number, hzMilli: number, beat: number): void {
  noLean(w); w.f[F.A] = ampMilli * 0.001; w.f[F.B] = hzMilli * 0.001;
  emitPose(w, s, out, i, beat);
}
/** Put the approach point beside j (gap mm between the bodies) on the line from j to i into w.f[F.X], w.f[F.Z]. At Home it lies on the
 *  segment between the two home slots (framed points, D-87); in a place, inside the bounds (else on the side toward the middle). */
function besides(w: LifeWorld, s: LifeSnapshot, i: number, j: number, gapMm: number): void {
  const r = s.r[i] + s.r[j] + gapMm * 0.001;
  if (w.home && w.hX[i] === w.hX[i] && w.hX[j] === w.hX[j]) {
    const dx = w.hX[i] - w.hX[j], dz = w.hZ[i] - w.hZ[j], d = Math.sqrt(dx * dx + dz * dz);
    if (d <= r || d < 1e-6) { w.f[F.X] = w.hX[i]; w.f[F.Z] = w.hZ[i]; return; }
    w.f[F.X] = w.hX[j] + dx / d * r; w.f[F.Z] = w.hZ[j] + dz / d * r;
    return;
  }
  let dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j], d = Math.sqrt(dx * dx + dz * dz) || 1;
  w.f[F.X] = s.x[j] + dx / d * r; w.f[F.Z] = s.z[j] + dz / d * r;
  qT(w);
  if (!inBounds(w, 0)) {
    dx = w.bx - s.x[j]; dz = w.bz - s.z[j]; d = Math.sqrt(dx * dx + dz * dz) || 1;
    w.f[F.X] = s.x[j] + dx / d * r; w.f[F.Z] = s.z[j] + dz / d * r;
  }
}
const WAKE_WHOLE_MILLI = (WAKE.whole * 1000 + 0.5) | 0, WAKE_PIECE_MILLI = (WAKE.piece * 1000 + 0.5) | 0;
function asleepUnitsMilli(w: LifeWorld, s: LifeSnapshot, j: number): number {
  return (s.flags[j] & LIFE_FLAG.ASLEEP) !== 0 ? (w.ki[j] === 0 ? WAKE_WHOLE_MILLI : WAKE_PIECE_MILLI) : 0;
}

/** The ride allowance of moment m's riders (D-85: their units are added to unitCap while it runs), x 1000. */
function rideAllowance(w: LifeWorld, s: LifeSnapshot, m: number): number {
  let a = 0;
  for (let k = 0; k < w.mN[m]; k++) { const j = mem(w, m, k); if (j >= 0 && (s.flags[j] & LIFE_FLAG.RIDE) !== 0) a += w.ki[j] === 0 ? 1000 : 220; }
  return a;
}

/** Advance moment m (called on its first member's think). Moves one character at a time. */
export function updateMoment(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, m: number): void {
  const tb = w.f[F.NOW];
  const kind = w.mK[m], a = mem(w, m, 0), b = w.mN[m] > 1 ? mem(w, m, 1) : -1, n = w.mN[m];
  if (tb >= w.mE[m]) { endMoment(w, s, out, ev, m, w.mP[m] >= 1 && w.mS[m] !== 1); return; }
  // (round 4, engineer 5) S07 snuggle and S13 peekaboo are behaviours (D-75): a song at a tune near a member beats them by LIFE 4's
  // utility choice (inYielding). A song a free singer starts takes them itself (beginPicked); when everyone near the tune is inside this
  // moment, it ends here and they start the song on their next think. Before this, three set beside the kettle 10 s before its whistle
  // were inside a snuggle when it whistled (probe_pg_lifequests' cabin finale, C8).
  if ((kind === MOM.SNUGGLE || kind === MOM.PEEK) && songCalls(w, s, m)) { yieldToSong(w, s, out, ev, m); return; }
  // a traveller (one mover at a time) keeps checking its arrival
  if (w.mS[m] === 1) {
    const j = mem(w, m, w.mT[m]);
    if (j >= 0) { const r = travelStep(w, s, out, j, contactMm(w, s, m, j)); if (r !== 0) { stopMove(w, out, j); w.mS[m] = 2; w.mNe[m] = tb; } }
    if (w.mS[m] === 1) return;
  }
  if (tb < w.mNe[m]) return;
  switch (kind) {
    case MOM.GREET: {
      if (w.mP[m] === 0 && w.mS[m] === 0 && dmm(s, a, b) > 1650) {
        besides(w, s, a, b, 300);
        w.mT[m] = 0;
        if (travelTo(w, s, out, a, 0, 0)) { w.mS[m] = 1; w.mE[m] = tb + 15; return; }
        // no mover token after all (the candidate test saw one free): it does not start; the pair's bit comes back (endMoment)
        endMoment(w, s, out, ev, m, false);
        return;
      }
      if (w.mP[m] === 0) {
        face(w, s, out, a, b); face(w, s, out, b, a);
        emitEmote(w, s, out, a, EMOTE.hello, STYLE.SAY, w.iN[a] || w.iN[b] ? 1 : 2, 0, 0, 1);
        emitEmote(w, s, out, b, EMOTE.hello, STYLE.SAY, w.iN[a] || w.iN[b] ? 1 : 2, 0, 0, 1);
        voice(w, s, out, a, PHRASE.GREET, 0, 2);
        const call = w.f[F.T];
        rnd(w, a);
        emitVoice(w, s, out, b, PHRASE.ANSWER, ((call + 0.35 + 0.35 * w.f[F.G]) * 1000) | 0, a, rnd(w, b) & 1, 2, 0);
        // one hello hop toward it (or a lean)
        const dx = s.x[b] - s.x[a], dz = s.z[b] - s.z[a], d = Math.sqrt(dx * dx + dz * dz) || 1;
        w.f[F.X2] = dx / d; w.f[F.Z2] = dz / d;
        if (gateStart(w, s, a, 0, 0) && emitHop(w, s, out, a, 0, 1000)) w.mS[m] = 3; else { stopMove(w, out, a); leanTo(w, s, out, a, b, 60); }
        w.mP[m] = 1; w.mE[m] = tb + 2.5; w.mNe[m] = tb + 0.8;
      } else if (w.mS[m] === 3) { stopMove(w, out, a); w.mS[m] = 0; }
      return;
    }
    case MOM.CHAT: {
      if (w.mP[m] === 0) {
        leanTo(w, s, out, a, b, 50); leanTo(w, s, out, b, a, 50); face(w, s, out, a, b); face(w, s, out, b, a);
        say(w, s, out, a, EMOTE.hello, 2, 0);
        const turns = 2 + (rnd(w, a) & 1);
        let at = 0;
        for (let k = 0; k < turns; k++) {
          emitVoice(w, s, out, k & 1 ? b : a, PHRASE.CHAT, (at * 1000) | 0, k & 1 ? a : b, rnd(w, a) & 1, 2, 0);
          at += w.f[F.T] + 0.45;
        }
        w.mP[m] = 1; w.mE[m] = tb + Math.max(3, Math.min(5, at + 0.5)); w.mNe[m] = w.mE[m];
      }
      return;
    }
    case MOM.BOOP: {
      if (w.mP[m] === 0) { // physics boop only where both bodies and their touching pair fit (D-85); else a soft boop
        const extra = asleepUnitsMilli(w, s, b) + 250;
        w.mSo[m] = gateFits(w, s, a, extra, 0) ? 0 : 1;
        face(w, s, out, a, b);
        besides(w, s, a, b, w.mSo[m] ? 50 : 150);
        if (!travelTo(w, s, out, a, 0, 0)) { endMoment(w, s, out, ev, m, false); return; }
        w.mP[m] = 1; w.mS[m] = 1; w.mT[m] = 0; w.mE[m] = tb + 12; w.mNe[m] = tb + 0.1;
        voice(w, s, out, a, PHRASE.NOTICE, 0, 2);
        return;
      }
      if (w.mP[m] === 1 && w.mS[m] === 2) {
        if (w.mSo[m]) { // the last centimetres at 0.04 m/s: the target stays asleep
          besides(w, s, a, b, 0);
          travelTo(w, s, out, a, 1, 0);
          w.mP[m] = 2; w.mS[m] = 1; w.mNe[m] = tb + 0.1; w.mE[m] = tb + 4;
        } else {
          const dx = s.x[b] - s.x[a], dz = s.z[b] - s.z[a], d = Math.sqrt(dx * dx + dz * dz) || 1;
          w.f[F.X2] = dx / d; w.f[F.Z2] = dz / d;
          w.f[F.UNITS] += asleepUnitsMilli(w, s, b) * 0.001 + UNIT.pair;
          if (gateStart(w, s, a, 0, 0)) emitHop(w, s, out, a, 400, 1000);
          w.mP[m] = 3; w.mNe[m] = tb + 0.5;
        }
        return;
      }
      if (w.mP[m] === 2 && w.mS[m] === 2) w.mP[m] = 3;
      if (w.mP[m] === 3) {
        stopMove(w, out, a);
        // the target's wobble: physics (it was hit) or a render wiggle of 0.05 R at 3 Hz (2 Hz Calm) for 0.6 s
        if (w.mSo[m]) sway(w, s, out, b, 50, s.calm || s.reducedMotion ? 2000 : 3000, 0);
        say(w, s, out, b, EMOTE.giggle, 2, 0);
        voice(w, s, out, a, PHRASE.NOTICE, 0, 2);
        voice(w, s, out, b, PHRASE.GIGGLE, 300, 2);
        w.mP[m] = 4; w.mE[m] = tb + 0.7; w.mNe[m] = w.mE[m];
      }
      return;
    }
    case MOM.NUZZLE: case MOM.COMFORT: {
      if (w.mP[m] === 0) {
        face(w, s, out, a, b); face(w, s, out, b, a);
        besides(w, s, a, b, 60);
        if (!travelTo(w, s, out, a, 0, 0)) { endMoment(w, s, out, ev, m, false); return; }
        w.mP[m] = 1; w.mS[m] = 1; w.mT[m] = 0; w.mE[m] = tb + 15; w.mNe[m] = tb + 0.1;
        return;
      }
      if (w.mP[m] === 1 && w.mS[m] === 2) { besides(w, s, a, b, 0); travelTo(w, s, out, a, 1, 0); w.mP[m] = 2; w.mS[m] = 1; w.mNe[m] = tb + 0.1; return; }
      if (w.mP[m] === 2 && w.mS[m] === 2) {
        leanTo(w, s, out, a, b, 100); leanTo(w, s, out, b, a, 100);
        const p = pairIdx(a, b), badge = w.pB[p] || w.pL[p] >= 3 ? 1 : 0;
        emitEmote(w, s, out, a, EMOTE.snug, STYLE.SAY, 2, badge, w.pL[p] >= 2 ? 1 : 0, 0);
        if (kind === MOM.NUZZLE) { emitVoice(w, s, out, a, PHRASE.PURR, 0, b, 0, 2, 0); emitVoice(w, s, out, b, PHRASE.PURR, 400, a, w.pL[p] >= 2 ? 1 : 0, 2, 0); }
        else { emitVoice(w, s, out, a, PHRASE.COMFORT, 0, b, 0, 2, 0); emitVoice(w, s, out, b, PHRASE.HUM, 600, a, 1, 2, 0); }
        w.mP[m] = 3; w.mE[m] = tb + (kind === MOM.COMFORT ? 3 : 3 + 3 * (rnd(w, a) * U16)); w.mNe[m] = tb + (kind === MOM.COMFORT ? 2.4 : 99);
        return;
      }
      if (w.mP[m] === 3 && kind === MOM.COMFORT) { emitEmote(w, s, out, b, EMOTE.sparkle, STYLE.SAY, 2, 0, 1, 0); w.mNe[m] = 1e9; }
      return;
    }
    case MOM.MIRROR: case MOM.TWIRL: {
      if (w.mP[m] === 0) {
        emitEmote(w, s, out, a, kind === MOM.MIRROR ? EMOTE.sparkle : EMOTE.snug, STYLE.SAY, 2, kind === MOM.TWIRL ? 1 : 0, 1, 1);
        if (kind === MOM.MIRROR) emitEmote(w, s, out, b, EMOTE.sparkle, STYLE.SAY, 2, 0, 1, 1);
        emitVoice(w, s, out, a, kind === MOM.MIRROR ? PHRASE.HUM : PHRASE.DUET, 0, b, 0, 2, 0);
        emitVoice(w, s, out, b, kind === MOM.MIRROR ? PHRASE.HUM : PHRASE.DUET, 0, a, kind === MOM.MIRROR ? 0 : 1, 2, 0);
        // together only where moverCap is 2 or more and both fit; otherwise a mirrored render sway (it still counts)
        const two = MOVER_CAP[tierOf(s)] >= 2 && gateFits(w, s, a, asleepUnitsMilli(w, s, b), 0) && gateStart(w, s, a, asleepUnitsMilli(w, s, b), 0) && gateStart(w, s, b, 0, 0);
        if (two) {
          noLean(w); emitHop(w, s, out, a, 0, 800); emitHop(w, s, out, b, 0, 800); w.mSo[m] = 0;
        } else { stopMove(w, out, a); stopMove(w, out, b); sway(w, s, out, a, 40, 1500, 1); sway(w, s, out, b, 40, 1500, 1); w.mSo[m] = 1; }
        w.mP[m] = 1; w.mE[m] = tb + (kind === MOM.MIRROR ? 4 : 3); w.mNe[m] = tb + 1;
        return;
      }
      if (!w.mSo[m] && w.mP[m] < 3) { noLean(w); emitHop(w, s, out, a, 0, 800); emitHop(w, s, out, b, 0, 800); w.mP[m]++; w.mNe[m] = tb + 1; }
      else if (!w.mSo[m]) { stopMove(w, out, a); stopMove(w, out, b); w.mNe[m] = 1e9; }
      return;
    }
    case MOM.DUET: {
      if (w.mP[m] === 0) {
        const wait = toNextBarMs(w) * 0.001;
        sway(w, s, out, a, 30, 1100, 1); sway(w, s, out, b, 30, 1100, 1);
        emitEmote(w, s, out, a, EMOTE.snug, STYLE.SAY, 2, w.pB[pairIdx(a, b)], 1, 1);
        emitVoice(w, s, out, a, PHRASE.DUET, toNextBarMs(w), b, 0, 2, 0);
        emitVoice(w, s, out, b, PHRASE.DUET, toNextBarMs(w), a, 1, 2, 0);
        w.mP[m] = 1; w.mE[m] = tb + wait + 2 * BAR_S; w.mNe[m] = w.mE[m];
      }
      return;
    }
    case MOM.SING: {
      if (w.mP[m] === 0) {
        const waitMs = toNextBarMs(w), wait = waitMs * 0.001, voiced = s.phone ? 2 : 3;
        say(w, s, out, a, EMOTE.note, 2, 1);
        for (let k = 0; k < n; k++) {
          const j = mem(w, m, k);
          sway(w, s, out, j, 30, 1100, 1);
          if (k < voiced) {
            emitVoice(w, s, out, j, PHRASE.SING, waitMs, -1, k, 2, 0);
            emitVoice(w, s, out, j, PHRASE.SING, waitMs + ((BAR_S * 1000) | 0), -1, k + 16, 2, 0);
          }
        }
        w.mP[m] = 1; w.mE[m] = tb + wait + 2 * BAR_S; w.mNe[m] = w.mE[m];
      }
      return;
    }
    case MOM.SNUGGLE: {
      // gather into a row, one mover at a time (each a glide to beside the one before, then a contact approach at 0.04 m/s)
      if (w.mP[m] === 0) { say(w, s, out, a, EMOTE.snug, 2, 1); w.mP[m] = 1; w.mT[m] = 1; w.mS[m] = 0; w.mE[m] = tb + 40; }
      if (w.mP[m] === 1) {
        const k = w.mT[m];
        if (k >= n) { // the row formed: lean in contact 6 s (render)
          for (let q = 0; q < n; q++) { const j = mem(w, m, q), o = mem(w, m, q > 0 ? q - 1 : 1); if (o >= 0) leanTo(w, s, out, j, o, 60); }
          voice(w, s, out, a, PHRASE.HUM, 0, 2);
          w.mP[m] = 2; w.mE[m] = tb + 8; w.mNe[m] = 1e9;
          return;
        }
        const j = mem(w, m, k), prev = mem(w, m, k - 1);
        if (w.mS[m] === 0) {
          // beside the previous one along x (the row runs across the view)
          const side = k & 1 ? 1 : -1, r = s.r[j] + s.r[prev] + 0.06;
          w.f[F.X] = s.x[prev] + side * r; w.f[F.Z] = s.z[prev];
          qT(w);
          if (!w.home && !inBounds(w, shrinkMm(s, j))) { w.f[F.X] = s.x[prev] - side * r; w.f[F.PX] = w.f[F.X]; }
          if (!w.home && !inBounds(w, shrinkMm(s, j))) { // neither side fits: toward the middle
            const mx = w.bx - s.x[prev], mz = w.bz - s.z[prev], md = Math.sqrt(mx * mx + mz * mz) || 1;
            w.f[F.X] = s.x[prev] + mx / md * r; w.f[F.Z] = s.z[prev] + mz / md * r;
          }
          if (w.home) { w.mS[m] = 2; return; } // Home: everyone already sits at a framed spot; the row leans in place (no scoot, D-87)
          if (travelTo(w, s, out, j, 0, 0)) { w.mS[m] = 1; w.mNe[m] = tb + 0.1; } else w.mNe[m] = tb + 0.5;
          return;
        }
        if (w.mS[m] === 2) { w.mT[m] = k + 1; w.mS[m] = 0; w.mNe[m] = tb + 0.1; }
      }
      return;
    }
    case MOM.COPY: {
      // the copier repeats the leader's hop 0.6 s later, 3 copies, one mover at a time
      if (w.mP[m] === 0) { say(w, s, out, a, EMOTE.star, 2, 1); w.mP[m] = 1; w.mC[m] = 0; }
      const c = w.mC[m];
      if (c >= 6) { w.mE[m] = tb; w.mP[m] = 2; return; }
      const j = c & 1 ? a : b; // b leads (it hopped first), a copies
      stopMove(w, out, c & 1 ? b : a);
      noLean(w);
      if (gateStart(w, s, j, 0, 0)) { emitHop(w, s, out, j, 0, 700); emitVoice(w, s, out, j, PHRASE.NOTICE, 0, -1, c & 1, 2, 0); }
      w.mC[m] = c + 1; w.mNe[m] = tb + (c & 1 ? 1.0 : 0.6); w.mE[m] = tb + 4;
      return;
    }
    case MOM.PARADE: {
      // a little parade (S05), turn by turn: the leader glides about 1.2 m on, then each in turn glides up behind the one in front (0.7 m
      // between centres, never overlapping), a chirp at each turn; two legs, the heading turning 60 degrees a leg; one mover at a time
      if (w.mP[m] === 0) { say(w, s, out, a, EMOTE.star, 2, 1); w.mP[m] = 1; w.mT[m] = 0; w.mS[m] = 0; w.mC[m] = 0; w.mE[m] = tb + 45; }
      if (w.mS[m] === 2) {
        w.mS[m] = 0; w.mT[m]++;
        if (w.mT[m] >= n) { w.mT[m] = 0; if (++w.mC[m] >= 2) { w.mE[m] = tb; return; } }
      }
      const t = w.mT[m], j = mem(w, m, t);
      if (t === 0) {
        // the leader's leg: from the last one in the line through the leader, turned 60 degrees a leg; the first free spot of 6 headings
        const last = mem(w, m, n - 1);
        let hx = s.x[a] - s.x[last], hz = s.z[a] - s.z[last], hl = Math.sqrt(hx * hx + hz * hz);
        if (hl < 0.01) { hx = 1; hz = 0; hl = 1; }
        let ok = false;
        for (let q = 0; q < 24 && !ok; q++) { // 12 headings from the turned one (30 degrees apart), 1.2 m then 0.8 m
          const ang = Math.atan2(hz, hx) + w.mC[m] * Math.PI / 3 + (q % 12) * Math.PI / 6, l = q < 12 ? 1.2 : 0.8;
          w.f[F.X] = s.x[a] + Math.cos(ang) * l; w.f[F.Z] = s.z[a] + Math.sin(ang) * l;
          qT(w);
          ok = freeSpot(w, s, a);
          for (let o = 0; o < s.n && ok; o++) if (o !== a && w.ac[o]) { const ox = s.x[o] - w.f[F.X], oz = s.z[o] - w.f[F.Z], rr = s.r[o] + s.r[a] + 0.1; if (ox * ox + oz * oz < rr * rr) ok = false; }
        }
        if (!ok) { if (w.mC[m] === 0) endMoment(w, s, out, ev, m, false); else w.mE[m] = tb; return; } // no room: a parade that never went is no parade
      } else {
        const fr = mem(w, m, t - 1), gap = s.r[fr] + s.r[j] + 0.1 > 0.7 ? s.r[fr] + s.r[j] + 0.1 : 0.7;
        let dx = s.x[j] - s.x[fr], dz = s.z[j] - s.z[fr], dl = Math.sqrt(dx * dx + dz * dz);
        if (dl < 0.01) { dx = -1; dz = 0; dl = 1; }
        w.f[F.X] = s.x[fr] + dx / dl * gap; w.f[F.Z] = s.z[fr] + dz / dl * gap;
        qT(w);
        if (!inBounds(w, shrinkMm(s, j))) { w.mS[m] = 2; return; } // no room behind: it waits its turn where it is
      }
      w.mT[m] = t;
      if (travelTo(w, s, out, j, 0, 0)) { w.mS[m] = 1; emitVoice(w, s, out, j, PHRASE.NOTICE, 0, -1, t & 1, 3, 0); }
      w.mNe[m] = tb + 0.3;
      return;
    }
    case MOM.PASS: {
      const k = w.mTh[m], row = k >= 0 ? w.rOL[k] : -1;
      if (row < 0 || w.mC[m] >= 3) { w.mE[m] = tb; if (w.mC[m] >= 1) w.mP[m] = 1; return; }
      const j = w.mC[m] & 1 ? b : a, o = j === a ? b : a;
      if (w.mS[m] === 0) {
        if (w.mC[m] === 0) say(w, s, out, a, EMOTE.ball, 2, 1);
        const bx = s.thingX[row], bz = s.thingZ[row], br = w.tS[k];
        // toward the partner; at Home along the segment from its home slot through the ball (framed points, D-87)
        const fx = w.home && w.hX[j] === w.hX[j] ? bx + (bx - w.hX[j]) : s.x[o], fz = w.home && w.hX[j] === w.hX[j] ? bz + (bz - w.hZ[j]) : s.z[o];
        const dx = fx - bx, dz = fz - bz, d = Math.sqrt(dx * dx + dz * dz) || 1;
        w.f[F.X] = bx - dx / d * (s.r[j] + br + 0.03); w.f[F.Z] = bz - dz / d * (s.r[j] + br + 0.03);
        qT(w);
        if (!w.home && !inBounds(w, 0)) { w.mC[m] = 3; return; }
        w.mT[m] = j === a ? 0 : 1;
        if (travelTo(w, s, out, j, 0, 0)) { w.mS[m] = 1; w.mNe[m] = tb + 0.1; w.mP[m] = 1; w.mE[m] = tb + 25; } else w.mNe[m] = tb + 0.5;
        return;
      }
      if (w.mS[m] === 2) {
        const bx = s.thingX[row], bz = s.thingZ[row];
        const fx = w.home && w.hX[j] === w.hX[j] ? bx + (bx - w.hX[j]) : s.x[o], fz = w.home && w.hX[j] === w.hX[j] ? bz + (bz - w.hZ[j]) : s.z[o];
        const dx = fx - bx, dz = fz - bz, d = Math.sqrt(dx * dx + dz * dz) || 1;
        w.f[F.X2] = dx / d; w.f[F.Z2] = dz / d;
        if (gateStart(w, s, j, 0, 0) && !emitHop(w, s, out, j, 400, 1000)) {
          // a non-hopper glides the last centimetres into it (to the ball's centre: the far end of its framed segment at Home)
          w.f[F.X] = bx - dx / d * (s.r[j] + w.tS[k] - 0.06); w.f[F.Z] = bz - dz / d * (s.r[j] + w.tS[k] - 0.06);
          qT(w);
          if (w.home || inBounds(w, 0)) emitScoot(w, out, j, 300, 0);
        }
        voice(w, s, out, j, PHRASE.NOTICE, 0, 3);
        pushEvent(ev, LIFE_EV.USE, w.tV[k], j, -1, 1, w.tG[k]);
        if (w.uV[j] < 255) w.uV[j]++;
        w.mC[m]++; w.mS[m] = 3; w.mNe[m] = tb + 2.5;
        return;
      }
      if (w.mS[m] === 3) { stopMove(w, out, j); w.mS[m] = 0; }
      return;
    }
    case MOM.PEEK: {
      const k = w.mTh[m];
      if (k < 0) { w.mE[m] = tb; return; }
      if (w.mP[m] === 0) { say(w, s, out, a, EMOTE.question, 2, 1); w.mP[m] = 1; w.mT[m] = 0; w.mS[m] = 0; w.mE[m] = tb + 40; }
      if (w.mP[m] === 1) {
        const t = w.mT[m];
        if (t >= 2) { w.mP[m] = 2; w.mC[m] = 0; w.mNe[m] = tb; w.mE[m] = tb + 4.2; emitVoice(w, s, out, a, PHRASE.NOTICE, 0, -1, 1, 2, 0); return; }
        const j = t === 0 ? a : b;
        if (w.mS[m] === 0) {
          w.f[F.X] = w.tP[k * 4 + t * 2]; w.f[F.Z] = w.tP[k * 4 + t * 2 + 1];
          if (travelTo(w, s, out, j, 0, 0)) { w.mS[m] = 1; w.mNe[m] = tb + 0.1; } else w.mNe[m] = tb + 0.5;
          return;
        }
        if (w.mS[m] === 2) { w.mT[m] = t + 1; w.mS[m] = 0; w.mNe[m] = tb; }
        return;
      }
      // lean out and back, 2 or 3 times (render), then a sparkle and a giggle
      const c = w.mC[m];
      if (c < 6) { const dir = c & 1 ? 0 : 80; w.f[F.X2] = dir * 0.001; w.f[F.Z2] = 0; w.f[F.A] = 0; w.f[F.B] = 0; emitPose(w, s, out, a, 0); w.f[F.X2] = -dir * 0.001; emitPose(w, s, out, b, 0); w.mC[m] = c + 1; w.mNe[m] = tb + 0.6; }
      else { say(w, s, out, b, EMOTE.sparkle, 2, 0); voice(w, s, out, b, PHRASE.GIGGLE, 0, 2); w.mNe[m] = 1e9; }
      return;
    }
    case MOM.TEETER: {
      // small hops in turn (both already awake on a moving prop: only a mover token, no body to wake)
      if (w.mP[m] === 0) { say(w, s, out, a, EMOTE.swirl, 2, 1); w.mP[m] = 1; w.mE[m] = tb + 6 + 6 * (rnd(w, a) * U16); w.mC[m] = 0; }
      const j = w.mC[m] & 1 ? b : a;
      stopMove(w, out, j === a ? b : a);
      noLean(w);
      if (gateStart(w, s, j, 0, rideAllowance(w, s, m)) && emitHop(w, s, out, j, 0, 700)) voice(w, s, out, j, PHRASE.GIGGLE, 0, 3);
      w.mC[m]++; w.mNe[m] = tb + 1.1;
      return;
    }
    case MOM.PUSH: {
      // the pusher (a) walks to the swing's push spot (it wakes on the ride allowance) and pushes the seat 3 times
      const k = w.mTh[m];
      if (k < 0 || (s.flags[b] & LIFE_FLAG.RIDE) === 0) { w.mE[m] = tb; return; }
      { const al = rideAllowance(w, s, m) * 0.001; if (w.att.allowance !== al) w.att.allowance = al; }
      if (w.mP[m] === 0) {
        say(w, s, out, a, EMOTE.star, 2, 1);
        w.f[F.X] = w.tPX[k]; w.f[F.Z] = w.tPZ[k];
        if (!travelTo(w, s, out, a, 0, rideAllowance(w, s, m))) { w.mNe[m] = tb + 0.5; if (tb - w.mT0[m] > 10) w.mE[m] = tb; return; }
        w.mP[m] = 1; w.mS[m] = 1; w.mT[m] = 0; w.mE[m] = tb + 30; w.mNe[m] = tb + 0.1;
        return;
      }
      if (w.mS[m] === 2) {
        if (w.mC[m] >= 3) { w.mE[m] = tb; return; }
        // a push: glide 0.55 m toward the pivot as the seat comes back, then back to the spot
        const px = w.tPX[k], pz = w.tPZ[k], dx = w.tX[k] - px, dz = w.tZ[k] - pz, d = Math.sqrt(dx * dx + dz * dz) || 1;
        const out1 = (w.mC[m] & 1) === 0 && w.mSo[m] === 0;
        w.f[F.X] = out1 ? px + dx / d * 0.55 : px; w.f[F.Z] = out1 ? pz + dz / d * 0.55 : pz;
        emitScoot(w, out, a, 350, 0);
        if (out1) { voice(w, s, out, b, PHRASE.COMFORT, 400, 3); w.mSo[m] = 1; }
        else { w.mSo[m] = 0; w.mC[m]++; }
        w.mNe[m] = tb + 1.2;
      }
      return;
    }
    default: w.mE[m] = tb;
  }
}

function contactMm(w: LifeWorld, s: LifeSnapshot, m: number, j: number): number {
  return w.mK[m] === MOM.PUSH ? 80 : 60;
}

/** S10 teeter: two characters the player set on the same seesaw (both RIDE) start it from either rider's think. */
export function tryTeeter(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number): boolean {
  const k = w.rTh[i];
  if (k < 0 || w.tM[k] !== MECH.seesaw || w.moo[i] >= 0) return false;
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.ac[j] || w.moo[j] >= 0 || w.rTh[j] !== k || (s.flags[j] & LIFE_FLAG.RIDE) === 0) continue;
    if ((s.flags[j] & HELD_BITS) !== 0) continue;
    const m = startMoment(w, s, out, MOM.TEETER, i, j, -1);
    if (m >= 0) { w.mTh[m] = k; w.mR[m] = 1; return true; }
  }
  return false;
}
