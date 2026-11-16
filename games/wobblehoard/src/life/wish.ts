// The wish scheduler (QUESTS.md 8; LIFE.md 4 B07, 4.1 FIRST_WISH, 7.2): inputs from lifeSetJournal only (owned species, open places,
// known favourites, the thing-kind mask), never a clock but sim time. At most 1 open wish a squishy, 3 open among the party, 180 s per squishy
// and 120 s overall between new ones, the scripted first wish first (no natural wish before it, D-70), a thing wish only for a kind in the
// mask and a favourite only once its place is open (LF-25), at most 2 re-glances (8 s, 30 s), one wish bubble on screen (the budget's wish
// slot). A friend wish takes its candidates from lifeSetFriends (round 2) and is granted by a greet or a nuzzle with that species. Owned by PG_LIFE.
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../contracts.ts';
import { WISH_KIND, LIFE_EV, LIFE_FLAG, EMOTE, SPECIES_LIFE, THING_KIND, SOCIAL_KIND } from '../data/life.ts';
import { PLACE_IDS, THING_IDS, MECH } from '../data/places.ts';
import { WISH_STATE } from '../data/quests.ts';
import { SPECIES } from '../data/species.ts';
import type { LifeWorld } from './world.ts';
import { CAP, BEH, F, pushEvent, rnd, U16, noLean } from './world.ts';
import { emitEmote, emitClear, emitGaze, emitHop, gateStart, stopMove, HELD_BITS, say } from './act.ts';
import { emitVoice, PHRASE, voice } from './voice.ts';
import { STYLE } from './attention.ts';
import { TRAIT } from './traits.ts';

/** Per species: favourite place idx and favourite thing (global idx) and its kind bit. */
const FAV_PLACE = new Int8Array(SPECIES.length), FAV_THING = new Int16Array(SPECIES.length);
for (let i = 0; i < SPECIES.length; i++) {
  const l = SPECIES_LIFE[SPECIES[i]];
  FAV_PLACE[i] = PLACE_IDS.indexOf(l.place); FAV_THING[i] = THING_IDS.indexOf(l.thing);
}
export const WISH = { gapSelfS: 180, gapAnyS: 120, kept: 3, reglance1: 8, reglance2: 30, touchEveryS: 600, warmForS: 20 } as const;
const HEARTHLOG = 1, DOLLOP = 0;
/** A thing-kind bit's glyph. */
function kindIcon(bit: number): number {
  return bit === THING_KIND.ball ? EMOTE.ball : bit === THING_KIND.bell ? EMOTE.bell : bit === THING_KIND.droplet ? EMOTE.droplet :
    bit === THING_KIND.note ? EMOTE.note : bit === THING_KIND.flame ? EMOTE.flame : EMOTE.sun;
}
/** The glyph of an open wish (its think bubble). */
export function wishIcon(w: LifeWorld, i: number): number {
  switch (w.wK[i]) {
    case WISH_KIND.PLACE: return EMOTE.postcard;
    case WISH_KIND.THING: return kindIcon(w.wT[i]);
    case WISH_KIND.RIDE: return EMOTE.star;
    case WISH_KIND.FRIEND: return EMOTE.snug;
    case WISH_KIND.TOUCH: return w.si[i] === 2 ? EMOTE.squeeze : EMOTE.stretch;
    case WISH_KIND.NAP: return EMOTE.zzz;
    case WISH_KIND.SONG: return EMOTE.note;
    case WISH_KIND.WARM: return w.lo[i * 6] > w.lo[i * 6 + 2] ? EMOTE.flame : EMOTE.sun;
    default: return 0;
  }
}

function openCount(w: LifeWorld): number { let n = 0; for (let j = 0; j < CAP; j++) if (w.ac[j] && w.wK[j] !== 0) n++; return n; }
function favKnownBit(w: LifeWorld, sp: number, bit: number): boolean { const b = sp * 2 + bit; return (w.fK[b >>> 5] & (1 << (b & 31))) !== 0; }
function placeOpen(w: LifeWorld, p: number): boolean { return p >= 0 && (w.oP & (1 << p)) !== 0; }
/** The kinds of thing standing here now (THING_KIND bits). */
function kindsHere(w: LifeWorld): number {
  let m = 0;
  for (let k = 0; k < w.nTD; k++) if (!w.home || w.rOL[k] >= 0) m |= w.tK[k];
  return m;
}

/** Can character i show a wish now (not held, not quiet, on screen, a whole or a face piece, not in a moment)? */
export function canShow(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  return i >= 0 && i < s.n && w.ac[i] === 1 && w.ki[i] !== 2 && (s.flags[i] & HELD_BITS) === 0 && !s.quiet && w.moo[i] < 0 &&
    s.sx[i] === s.sx[i];
}

/** Show wish (kind, target) on character i: B07 (face the camera, one small hop or a still pulse), the think bubble (P1), the asking phrase. */
export function showWish(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number, kind: number, target: number): void {
  const tb = w.f[F.NOW];
  w.wK[i] = kind; w.wT[i] = target; w.wT1[i] = tb; w.wG[i] = 0; w.wLNT[i] = tb; w.f[F.NEW_WISH] = tb;
  if (kind === WISH_KIND.TOUCH) w.tWT[i] = tb;
  if (w.mo[i]) stopMove(w, out, i);
  w.beh[i] = BEH.WISH; w.ph[i] = 0; w.bT[i] = tb; w.bE[i] = tb + 2; w.bSc[i] = 0.7;
  emitGaze(w, out, i, 2);
  noLean(w);
  if (gateStart(w, s, i, 0, 0)) { if (!emitHop(w, s, out, i, 0, 700)) stopMove(w, out, i); else w.ph[i] = 1; }
  emitEmote(w, s, out, i, wishIcon(w, i), STYLE.THINK, 1, 0, 0, 1);
  voice(w, s, out, i, PHRASE.WISH, 0, 1);
  pushEvent(ev, LIFE_EV.WISH, WISH_STATE.SHOWN, i, -1, 1, kind === WISH_KIND.RIDE ? target : -1);
}

/** The natural wish scheduler for character i (QUESTS 8). True when it showed one. */
export function wishThink(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): boolean {
  const tb = w.f[F.NOW];
  // re-glances (8 s and 30 s after showing; then the still dot)
  if (w.wK[i] !== 0) {
    const age = tb - w.wT1[i];
    if ((w.wG[i] === 0 && age >= WISH.reglance1) || (w.wG[i] === 1 && age >= WISH.reglance2)) {
      w.wG[i]++;
      if ((s.flags[i] & HELD_BITS) === 0) emitEmote(w, s, out, i, wishIcon(w, i), STYLE.THINK, 1, 0, 0, 0);
    }
    return false;
  }
  // no natural wish before the scripted first one (D-70; Hearthlog open means it has shown in an earlier session)
  if (!w.fWD && (w.oP & (1 << HEARTHLOG)) === 0) return false;
  if (w.fWP) return false;
  if (!canShow(w, s, i)) return false;
  if (tb - w.wLNT[i] < WISH.gapSelfS || tb - w.f[F.NEW_WISH] < WISH.gapAnyS || tb - w.aT[i] < WISH.gapSelfS) return false;
  if (openCount(w) >= WISH.kept) return false;
  const tr = i * 5, sp = w.species[i];
  rnd(w, i);
  const u = w.f[F.G];
  // touch: play > 0.6, its loved touch is a squeeze or a pull, at most once per 10 min
  if (w.pl[i] > 0.6 && w.si[i] >= 2 && tb - w.tWT[i] >= WISH.touchEveryS && u < 0.5) { showWish(w, s, out, ev, i, WISH_KIND.TOUCH, w.si[i]); return true; }
  // warm up or dry off: frost or soak over 0.7 for 20 s
  if (w.lo[i * 6] > 0.7 || w.lo[i * 6 + 2] > 0.7) { if (w.wLT[i] < -1e8) w.wLT[i] = tb; } else w.wLT[i] = -1e9;
  if (w.wLT[i] > -1e8 && tb - w.wLT[i] >= WISH.warmForS) { showWish(w, s, out, ev, i, WISH_KIND.WARM, 0); return true; }
  // a nap: rest > 0.8, no nap spot within 2 m
  if (w.re[i] > 0.8 && !napSpotNear(w, s, i)) { showWish(w, s, out, ev, i, WISH_KIND.NAP, 0); return true; }
  // a ride: play > 0.7 next to a ride, at most one ride wish open in a place
  if (w.pl[i] > 0.7) {
    const r = rideNear(w, s, i);
    if (r >= 0 && !rideWishOpen(w)) { showWish(w, s, out, ev, i, WISH_KIND.RIDE, w.tG[r]); return true; }
  }
  if (w.pl[i] > 0.8) {
    // a place (40% its favourite while undiscovered and open) or a kind of thing (only kinds in the mask)
    const fp = FAV_PLACE[sp], favPlaceOpen = placeOpen(w, fp);
    if (u < 0.5) {
      let target = -1;
      if (favPlaceOpen && fp !== w.placeIdx && !favKnownBit(w, sp, 0) && rnd(w, i) * U16 < 0.4) target = fp;
      else target = pickOpenPlace(w, i);
      if (target >= 0) { showWish(w, s, out, ev, i, WISH_KIND.PLACE, target); return true; }
    } else {
      const here = kindsHere(w);
      const ft = FAV_THING[sp], fl = ft >= 0 ? w.gTL[ft] : -1;
      let bit = 0;
      // its favourite thing (its kind), only once its favourite place is open, 40% while undiscovered
      if (favPlaceOpen && !favKnownBit(w, sp, 1) && rnd(w, i) * U16 < 0.4) bit = favKindBit(ft) & w.tKi;
      if (bit === 0) bit = pickKind(w, i, w.tKi & ~here);
      if (bit !== 0 || fl >= 0) { if (bit === 0) bit = w.tK[fl] & w.tKi; if (bit !== 0) { showWish(w, s, out, ev, i, WISH_KIND.THING, bit); return true; } }
    }
  }
  // a friend: company > 0.8, a species at Friends or closer with it (or its best friend once F3 is found: lifeSetFriends), owned, not out
  if (w.co[i] > 0.8 && w.ki[i] === 0) {
    const f = pickFriend(w, s, i);
    if (f >= 0) { showWish(w, s, out, ev, i, WISH_KIND.FRIEND, f); return true; }
  }
  // a song: chatty > 0.6, company > 0.5
  if (w.tr[tr + TRAIT.chatty] > 0.6 && w.co[i] > 0.5 && u > 0.7) { showWish(w, s, out, ev, i, WISH_KIND.SONG, 0); return true; }
  return false;
}

/** The kind bit of a favourite thing (by its place's data when loaded; else the ThingDef icon is unknown here: 0). */
function favKindBit(globalThing: number): number {
  // the favourite thing's kind is only known for the current place's things; a thing in another place: its icon via THING_ICON
  return globalThing >= 0 && globalThing < THING_ICON_KIND.length ? THING_ICON_KIND[globalThing] : 0;
}
/** Each thing's kind bit (from THING_KINDS' meaning: the glyph kinds of each place's things), filled by lifeSetPlace for the places seen. */
export const THING_ICON_KIND = new Uint8Array(THING_IDS.length);

function pickOpenPlace(w: LifeWorld, i: number): number {
  let n = 0;
  for (let p = 0; p < PLACE_IDS.length; p++) if (p !== w.placeIdx && placeOpen(w, p)) n++;
  if (n === 0) return -1;
  let k = (rnd(w, i) * n) >>> 16;
  for (let p = 0; p < PLACE_IDS.length; p++) if (p !== w.placeIdx && placeOpen(w, p)) { if (k === 0) return p; k--; }
  return -1;
}
function pickKind(w: LifeWorld, i: number, mask: number): number {
  let n = 0;
  for (let b = 1; b <= 32; b <<= 1) if (mask & b) n++;
  if (n === 0) return 0;
  let k = (rnd(w, i) * n) >>> 16;
  for (let b = 1; b <= 32; b <<= 1) if (mask & b) { if (k === 0) return b; k--; }
  return 0;
}
/** A species character i may wish to see: in its lifeSetFriends mask, owned, not out now; one of them at random (-1 none). */
function pickFriend(w: LifeWorld, s: LifeSnapshot, i: number): number {
  const sp = w.species[i];
  if (sp >= 64) return -1;
  let n = 0;
  for (let k = 0; k < 64; k++) if (friendOk(w, s, sp, k)) n++;
  if (n === 0) return -1;
  let r = (rnd(w, i) * n) >>> 16;
  for (let k = 0; k < 64; k++) if (friendOk(w, s, sp, k)) { if (r === 0) return k; r--; }
  return -1;
}
function friendOk(w: LifeWorld, s: LifeSnapshot, sp: number, k: number): boolean {
  if (k === sp || (w.fr[sp * 2 + (k >>> 5)] & (1 << (k & 31))) === 0 || (w.ow[k >>> 5] & (1 << (k & 31))) === 0) return false;
  for (let j = 0; j < s.n; j++) if (w.ac[j] && w.species[j] === k) return false; // it is out: no wish for it
  return true;
}
function napSpotNear(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  for (let k = 0; k < w.nP; k++) if (w.pN[k]) {
    const t = w.pT[k];
    if (w.home && t >= 0 && w.rOL[t] < 0) continue;
    const dx = s.x[i] - w.pX[k], dz = s.z[i] - w.pZ[k];
    if (dx * dx + dz * dz <= (2 + w.pR[k]) * (2 + w.pR[k])) return true;
  }
  for (let k = 0; k < w.nTD; k++) if (w.tM[k] === MECH.ring) {
    const dx = s.x[i] - w.tX[k], dz = s.z[i] - w.tZ[k];
    if (dx * dx + dz * dz <= 4 + w.tS[k]) return true;
  }
  return false;
}
function rideNear(w: LifeWorld, s: LifeSnapshot, i: number): number {
  for (let k = 0; k < w.nTD; k++) {
    if (!w.tRi[k] || (w.home && w.rOL[k] < 0)) continue;
    const dx = s.x[i] - w.tX[k], dz = s.z[i] - w.tZ[k];
    if (dx * dx + dz * dz <= 2.25 + w.tS[k] * 2) return k;
  }
  return -1;
}
function rideWishOpen(w: LifeWorld): boolean { for (let j = 0; j < CAP; j++) if (w.ac[j] && w.wK[j] === WISH_KIND.RIDE) return true; return false; }

/** Grant character i's open wish: the WISH GRANTED event, the thank-you trill and a sparkle; the think bubble clears. */
export function grantWish(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  if (w.wK[i] === 0) return;
  pushEvent(ev, LIFE_EV.WISH, WISH_STATE.GRANTED, i, -1, 1, w.wK[i] === WISH_KIND.RIDE ? w.wT[i] : -1);
  w.wK[i] = 0; w.wT[i] = -1; w.lJT[i] = tb;
  emitClear(w, out, i, STYLE.THINK);
  if (i < s.n) {
    say(w, s, out, i, EMOTE.sparkle, 1, 1);
    voice(w, s, out, i, PHRASE.GRANTED, 300, 1);
  }
}

/** Check the grant conditions that LIFE can see on its own (nap, song, warm-up, touch, ride, a thing of the kind used or reacted to). */
export function wishCheck(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const k = w.wK[i];
  if (k === 0) return;
  let ok = false;
  if (k === WISH_KIND.NAP) ok = w.beh[i] === BEH.NAP && w.ph[i] >= 2;
  else if (k === WISH_KIND.WARM) ok = w.lo[i * 6] < 0.1 && w.lo[i * 6 + 2] < 0.1;
  else if (k === WISH_KIND.TOUCH) { const t = s.touchKind[i]; ok = t === 5 || t === 6; }
  else if (k === WISH_KIND.RIDE) ok = (s.flags[i] & LIFE_FLAG.RIDE) !== 0 && w.rTh[i] >= 0 && w.tG[w.rTh[i]] === w.wT[i];
  else if (k === WISH_KIND.PLACE) ok = w.placeIdx === w.wT[i];
  if (ok) grantWish(w, s, out, ev, i);
}

/** After the tick's events: a thing wish is granted by any USE or REACT of that character whose thing has the kind; a song wish by a SING. */
export function wishFromEvents(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents): void {
  const n = ev.n;
  for (let e = 0; e < n; e++) {
    const kd = ev.kind[e];
    if (kd === LIFE_EV.USE || kd === LIFE_EV.REACT) {
      const i = ev.a[e];
      if (i >= CAP || w.wK[i] !== WISH_KIND.THING || ev.thing[e] < 0) continue;
      const loc = w.gTL[ev.thing[e]];
      if (loc >= 0 && (w.tK[loc] & w.wT[i]) !== 0) grantWish(w, s, out, ev, i);
    } else if (kd === LIFE_EV.SOCIAL && (ev.sub[e] === SOCIAL_KIND.GREET || ev.sub[e] === SOCIAL_KIND.NUZZLE)) {
      // a friend wish is granted when the wisher greets or nuzzles a squishy of that species (QUESTS 8)
      const a = ev.a[e], b = ev.b[e];
      if (a < CAP && b < CAP) {
        if (w.wK[a] === WISH_KIND.FRIEND && w.species[b] === w.wT[a]) grantWish(w, s, out, ev, a);
        if (w.wK[b] === WISH_KIND.FRIEND && w.species[a] === w.wT[b]) grantWish(w, s, out, ev, b);
      }
    } else if (kd === LIFE_EV.SOCIAL && ev.sub[e] === 7) {
      for (let j = 0; j < CAP; j++) if (w.ac[j] && w.wK[j] === WISH_KIND.SONG && w.moo[j] >= 0 && w.mK[w.moo[j]] === 6) grantWish(w, s, out, ev, j);
      const a = ev.a[e];
      if (a < CAP && w.wK[a] === WISH_KIND.SONG) grantWish(w, s, out, ev, a);
    }
  }
}

/** FIRST_WISH (D-70): the wisher the shell named, else Dollop if out, else a Hearthlog fan out, else the party member out longest; it ignores
 *  the 120 s and 180 s gaps. At the 5:00 backstop (deadline) with nobody able to show it, it rests in the Journal at once: a WISH SHOWN
 *  record with b = 254 (rested, not shown) so the shell opens Hearthlog all the same. */
export function firstWishThink(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents): void {
  if (!w.fWP) return;
  // the wisher the shell named (D-70) shows it; if it is only busy in a moment it waits; it is replaced only when held, gone or off screen
  const named = w.fWS;
  let who = canShow(w, s, named) ? named : -1;
  if (who < 0 && named >= 0 && named < s.n && w.ac[named] && (s.flags[named] & HELD_BITS) === 0 && !s.quiet && w.moo[named] >= 0) return;
  if (who < 0) for (let j = 0; j < s.n; j++) if (w.ac[j] && w.ki[j] === 0 && w.species[j] === DOLLOP && canShow(w, s, j)) { who = j; break; }
  if (who < 0) for (let j = 0; j < s.n; j++) if (w.ac[j] && w.ki[j] === 0 && FAV_PLACE[w.species[j]] === HEARTHLOG && canShow(w, s, j)) { who = j; break; }
  if (who < 0) { let best = -1, bt = 1e18; for (let j = 0; j < s.n; j++) if (w.ac[j] && w.ki[j] === 0 && canShow(w, s, j) && w.aT[j] < bt) { bt = w.aT[j]; best = j; } who = best; }
  if (who >= 0) {
    if (w.wK[who] !== 0) { emitClear(w, out, who, STYLE.THINK); w.wK[who] = 0; }
    showWish(w, s, out, ev, who, WISH_KIND.PLACE, HEARTHLOG);
    w.fWP = 0; w.fWD = 1;
    return;
  }
  if (w.fWDe) {
    pushEvent(ev, LIFE_EV.WISH, WISH_STATE.SHOWN, w.fWS >= 0 ? w.fWS : 255, 254, 0, -1);
    w.fWP = 0; w.fWD = 1;
  }
}

/** lifeWishOf: character slot's open wish into out [WISH_KIND, target] (place idx, THING_KIND bit, ride thing's global idx, species idx or
 *  the touch code); false when it has none. */
export function wishOf(w: LifeWorld, slot: number, out: Int32Array): boolean {
  if (slot < 0 || slot >= CAP || w.wK[slot] === 0) { out[0] = 0; out[1] = -1; return false; }
  out[0] = w.wK[slot]; out[1] = w.wT[slot];
  return true;
}
