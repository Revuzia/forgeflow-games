// The behaviours B01..B20 (LIFE.md 4) as a utility choice with the seeded noise and the running behaviour's bonus, the six scripts (4.1),
// the targets (5.7: free targets inside the bounds shrunk by R + 0.2 m and outside the keep-outs, use spots as laid, Home's targets on a
// segment between two framed points), HELD and the afterglow (5.5), quiet and autonomy off (5.6), and the pieces' group moves P01..P04 (9).
// Owned by PG_LIFE.
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../contracts.ts';
import { LIFE_FLAG, LIFE_EV, EMOTE, EXPR, REACT_KIND, TOUCH, USE_VERB, BRAIN, SPECIES_LIFE } from '../data/life.ts';
import { MECH, ZONE, PLACE_IDS } from '../data/places.ts';
import { SPECIES } from '../data/species.ts';
import type { LifeWorld } from './world.ts';
import { CAP, BEH, F, MAX_ZONES, USES_FULL, inAreaAt, pushEvent, pushIntent, rnd, U16, inBounds, clearOfThings, keepMm, shrinkMm, pairIdx, d2c, d2t, d2p, CM2, freeSpot, noLean, qT } from './world.ts';
import { gateStart, stopMove, travelTo, travelStep, emitHop, emitSquash, emitPose, clearPose, emitGaze, emitExpr, emitEmote, emitScoot, emitCancel, HELD_BITS, G_HOPS, groupCount, say } from './act.ts';
import { emitVoice, PHRASE, voice } from './voice.ts';
import { STYLE } from './attention.ts';
import { TRAIT } from './traits.ts';
import { WARMPOSE, TOAST, emitReact, leaderOf } from './looks.ts';
import { socialPick, beginPicked, updateMoment, startMoment, tryTeeter, abortFor, isFree, MOM, mem, tuneThing } from './social.ts';
import { wishThink, wishCheck, firstWishThink } from './wish.ts';
import { INTENT } from '../data/life.ts';
import { PIECES_USE } from '../data/quests.ts';

const FAV_PLACE = new Int8Array(SPECIES.length);
for (let i = 0; i < SPECIES.length; i++) FAV_PLACE[i] = PLACE_IDS.indexOf(SPECIES_LIFE[SPECIES[i]].place);
const FAM_FIRM = 8, FAM_POP = 9;
/** Per family: the mechanisms it likes (B04's family affinity, +0.15 each). */
import { FAMILY_REACT } from '../data/life.ts';
import { MATERIAL_FAMILY_IDS } from '../data/materials.ts';
const PREFS = new Uint32Array(12);
for (let f = 0; f < 12; f++) for (const m of FAMILY_REACT[MATERIAL_FAMILY_IDS[f]].mechPrefs) PREFS[f] |= 1 << m;

const ONCE = { LOVE: 1 << 16, BASKED: 1 << 17, ARRIVED: 1 << 18, HELLO: 1 << 19, SIGNATURE: 1 << 20, TOASTED: 1 << 21 } as const;

/* ───────────────────────────── helpers ───────────────────────────── */

/** Start behaviour b with its score (x 1000) for durMs ms (integers: a double argument is boxed, LF-02). */
function setBeh(w: LifeWorld, i: number, b: number, scoreMilli: number, durMs: number): void {
  const tb = w.f[F.NOW];
  w.beh[i] = b; w.ph[i] = 0; w.bT[i] = tb; w.bE[i] = tb + durMs * 0.001; w.bSc[i] = scoreMilli * 0.001;
}
function endBeh(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, coolS: number): void {
  const tb = w.f[F.NOW];
  const b = w.beh[i];
  if (coolS > 0) w.coo[i * 26 + b] = tb + coolS;
  if (w.mo[i]) stopMove(w, out, i);
  w.beh[i] = BEH.IDLE; w.ph[i] = 0; w.bT[i] = tb; w.bSc[i] = 0.1; w.tT[i] = -1; w.tC[i] = -1; w.ch[i] = 0;
}
function ready(w: LifeWorld, i: number, b: number): boolean {
  const tb = w.f[F.NOW]; return tb >= w.coo[i * 26 + b]; }
/** Thing k's live position (the snapshot's row) into w.f[F.X2], w.f[F.Z2]; false when it is not out now. */
function thingPos(w: LifeWorld, s: LifeSnapshot, k: number): boolean {
  const r = w.rOL[k];
  if (r >= 0) { w.f[F.X2] = s.thingX[r]; w.f[F.Z2] = s.thingZ[r]; return true; }
  if (w.home || s.nThings > 0) return false;
  w.f[F.X2] = w.tX[k]; w.f[F.Z2] = w.tZ[k];
  return true;
}

/** Is character i quiet (no new LIFE motion)? The cut group leaves the non-Hand-tool quiet 1 s after the swipe (D-73). */
export function quietFor(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  const tb = w.f[F.NOW];
  if (!s.quiet) return false;
  if (w.ki[i] !== 0) { const c = w.cT[w.gr[i] & 31]; if (c > -1e8 && tb >= c + 1) return false; }
  return true;
}
/** May character i start new motion by itself (quiet, autonomy off, the release grace)? Player-asked uses and rides pass `asked`. */
export function mayMove(w: LifeWorld, s: LifeSnapshot, i: number, asked: boolean): boolean {
  const tb = w.f[F.NOW];
  if (quietFor(w, s, i)) return false;
  if (!s.autonomy && !asked) return false;
  if (tb < w.gU[i] && !asked) return false;
  if (tb < w.pWT[i]) return false;
  return true;
}

/* ───────────────────────────── targets (5.7, LF-06) ───────────────────────────── */

/** Home's framed points: the home slots of the characters out and the use spots of the arrived things (and the ball while it is out). */
function framedPoint(w: LifeWorld, s: LifeSnapshot, idx: number): boolean {
  if (idx < CAP) { if (!w.ac[idx] || !(w.hX[idx] === w.hX[idx])) return false; w.f[F.X2] = w.hX[idx]; w.f[F.Z2] = w.hZ[idx]; return true; }
  const k = idx - CAP;
  if (k >= w.nTD || w.rOL[k] < 0) return false;
  if (w.tM[k] === MECH.ball) { const r = w.rOL[k]; w.f[F.X2] = s.thingX[r]; w.f[F.Z2] = s.thingZ[r]; return true; }
  if (!(w.tUX[k] === w.tUX[k])) return false;
  w.f[F.X2] = w.tUX[k]; w.f[F.Z2] = w.tUZ[k];
  return true;
}
/** A free target for character i into w.f[F.X], w.f[F.Z]: in a place inside the bounds shrunk by R + 0.2 m and clear of every thing's
 *  keep-out (0.4 m, and at least R + 0.05 m); at Home a point between two framed points (D-87). False when none was found. */
export function freeTarget(w: LifeWorld, s: LifeSnapshot, i: number, maxRMm: number): boolean {
  const maxR = maxRMm * 0.001;
  if (w.home) {
    let n = 0;
    for (let p = 0; p < CAP + w.nTD; p++) if (framedPoint(w, s, p)) n++;
    if (n < 2) return false;
    for (let tries = 0; tries < 6; tries++) {
      let a = (rnd(w, i) * n) >>> 16, b = (rnd(w, i) * n) >>> 16;
      if (a === b) b = (b + 1) % n;
      const u = rnd(w, i) * U16;
      let ax = 0, az = 0, bx = 0, bz = 0, q = 0;
      for (let p = 0; p < CAP + w.nTD; p++) {
        if (!framedPoint(w, s, p)) continue;
        if (q === a) { ax = w.f[F.X2]; az = w.f[F.Z2]; }
        if (q === b) { bx = w.f[F.X2]; bz = w.f[F.Z2]; }
        q++;
      }
      const x = ax + (bx - ax) * u, z = az + (bz - az) * u;
      w.f[F.PX] = x; w.f[F.PZ] = z;
      const d2 = d2p(w, s, i);
      if (d2 > maxR * maxR * CM2 || d2 < 0.04 * CM2) continue;
      w.f[F.X] = x; w.f[F.Z] = z;
      return true;
    }
    return false;
  }
  for (let tries = 0; tries < 8; tries++) {
    const ang = rnd(w, i) * U16 * Math.PI * 2, d = 0.4 + rnd(w, i) * U16 * (maxR - 0.4);
    const x = s.x[i] + Math.cos(ang) * d, z = s.z[i] + Math.sin(ang) * d;
    w.f[F.PX] = x; w.f[F.PZ] = z;
    if (!freeSpot(w, s, i)) continue;
    w.f[F.X] = x; w.f[F.Z] = z;
    return true;
  }
  return false;
}

/** Half of B03's wanders (in a place) go toward a party member it has not greeted this visit, else any: a free target 1.0 to 1.4 m from it
 *  (inside the shrunk bounds, outside the keep-outs), so a party meets and greets. At Home the framed segments already join the slots. */
function towardParty(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  if (w.home || w.ki[i] !== 0 || (rnd(w, i) & 1) === 0) return false;
  let pick = -1, ungreeted = -1;
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.ac[j] || w.ki[j] !== 0) continue;
    if ((w.pG[pairIdx(i, j)] & 1) === 0 && ungreeted < 0) ungreeted = j;
    if (pick < 0 || (rnd(w, i) & 3) === 0) pick = j;
  }
  const j = ungreeted >= 0 ? ungreeted : pick;
  if (j < 0) return false;
  for (let tries = 0; tries < 6; tries++) {
    const a = rnd(w, i) * U16 * Math.PI * 2, d = s.r[j] + s.r[i] + 0.15 + rnd(w, i) * U16 * 0.35;
    const x = s.x[j] + Math.cos(a) * d, z = s.z[j] + Math.sin(a) * d;
    w.f[F.PX] = x; w.f[F.PZ] = z;
    if (!freeSpot(w, s, i)) continue;
    w.f[F.X] = x; w.f[F.Z] = z;
    return true;
  }
  return false;
}

/* ───────────────────────────── the per-call pass: HELD, release, touch kinds, landings (5.5; LF-04) ───────────────────────────── */

export function touchPass(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents): void {
  const t = s.t;
  for (let i = 0; i < s.n && i < CAP; i++) {
    if (!w.ac[i]) continue;
    const fl = s.flags[i], held = (fl & HELD_BITS) !== 0;
    if (held && !w.he[i]) {
      w.he[i] = 1; w.tST[i] = t;
      emitCancel(w, out, i);
      emitGaze(w, out, i, 0); // the eyes go to the pointer
      if (w.mo[i]) { w.mo[i] = 0; w.movers = w.movers > 0 ? w.movers - 1 : 0; w.att.movers = w.movers; }
      if (w.moo[i] >= 0) abortFor(w, s, out, ev, i);
      // a touch turns a huff into a giggle: the happy squint now, the giggle bubble and voice at the release (no bubble while held, L2)
      if (w.beh[i] === BEH.HUFF) { emitExpr(w, out, i, EXPR.happy, 100); w.hF[i] = -2; }
      w.beh[i] = BEH.NONE; w.ph[i] = 0; w.bSc[i] = 0;
      w.sqS[i] = 1;
      if ((fl & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) !== 0) {
        w.pl[i] = Math.max(0, w.pl[i] - 0.2); w.co[i] = Math.max(0, w.co[i] - 0.3);
        // B13: others within 3 m watch it
        for (let j = 0; j < s.n; j++) {
          if (j === i || !w.ac[j] || w.ki[j] === 2 || (s.flags[j] & HELD_BITS) !== 0 || w.moo[j] >= 0 || w.beh[j] === BEH.NAP) continue;
          if (d2c(s, j, i) <= 9 * CM2) w.wD[j] = i;
        }
      }
    } else if (!held && w.he[i]) {
      w.he[i] = 0; w.rT[i] = t;
      w.gU[i] = t + 1.5 + BRAIN.graceS; // the 1.5 s afterglow, then 1.5 s of grace before any new LIFE motion
      if ((fl & LIFE_FLAG.RIDE) === 0) w.aD[i] = 1;
    }
    const tk = s.touchKind[i];
    if (tk >= 0) {
      w.lTo[i] = tk;
      if (tk === TOUCH.TOSS || tk === TOUCH.TOSS_HARD) {
        w.pl[i] = Math.max(0, w.pl[i] - 0.4);
        const o = i * 3; w.tT1[o + 2] = w.tT1[o + 1]; w.tT1[o + 1] = w.tT1[o]; w.tT1[o] = t;
        if (t - w.tT1[o + 2] <= BRAIN.dizzyWindowS) w.gU[i] = Math.max(w.gU[i], t + 5); // "a little dizzy": 5 s of rest
        if (tk === TOUCH.TOSS_HARD) say(w, s, out, i, EMOTE.swirl, 1, 0);
        for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.wD[j] === i) { say(w, s, out, j, EMOTE.wow, 2, 0); break; }
      }
      if (tk === TOUCH.CUT) {
        for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.ki[j] === 0 && d2c(s, j, i) <= 9 * CM2) { w.wD[j] = i; }
        // the most curious other whole walks over to look (9), once LIFE may move it (the Cut tool's quiet holds the wholes): within 20 s
        let cu = -1;
        for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.ki[j] === 0 && (cu < 0 || w.tr[j * 5 + TRAIT.curious] > w.tr[cu * 5 + TRAIT.curious])) cu = j;
        if (cu >= 0) { w.lA[cu] = i; w.lU[cu] = t + 20; }
        for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.ki[j] === 0) { say(w, s, out, j, EMOTE.wow, 2, 1); break; }
      }
      if ((tk === TOUCH.SQUEEZE_1S || tk === TOUCH.STRETCH_06)) wishCheck(w, s, out, ev, i);
    }
    // landings (B02 notices a land within 1.5 m; a nap wakes on a toss landing within 1 m)
    const air = (fl & LIFE_FLAG.AIRBORNE) !== 0 ? 1 : 0;
    // a landing worth noticing (B02) is the player's (a toss, a drop, a ride), never LIFE's own small gait or hello hop (my reading:
    // otherwise every step of a hopping neighbour is a "land within 1.5 m" and B02's 0.9 interrupts everything)
    if (w.aC[i] && !air && t - w.lHT[i] > 0.6) w.lT1[i] = t;
    w.aC[i] = air;
  }
}

/* ───────────────────────────── one character's think ───────────────────────────── */

export function behave(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  const fl = s.flags[i];
  if ((fl & HELD_BITS) !== 0) return; // HELD: its own brain does nothing (needs and looks still integrate)
  if (w.ki[i] === 2) { chunkThink(w, s, out, ev, i); return; }
  // the shell's scripts come before a running moment: B12 pose, B14 cheer (the moment ends for everyone in it)
  if ((w.pO && w.beh[i] !== BEH.POSE) || w.cD[i]) { if (w.moo[i] >= 0) abortFor(w, s, out, ev, i); }
  // a joint moment runs on its first member's think
  const m = w.moo[i];
  if (m >= 0) { if (mem(w, m, 0) === i) updateMoment(w, s, out, ev, m); return; }
  // the partner of an interrupted moment: "your turn" after 2 s
  if (w.pWT[i] > -1e8 && tb >= w.pWT[i]) {
    w.pWT[i] = -1e9;
    noLean(w);
    if (mayMove(w, s, i, false) && gateStart(w, s, i, 0, 0)) { if (!emitHop(w, s, out, i, 0, 600)) stopMove(w, out, i); else w.uS[i] = 9; }
  } else if (w.uS[i] === 9 && tb - w.lHT[i] > 0.6) { stopMove(w, out, i); w.uS[i] = 0; }

  // RIDE (B20): above every other choice but HELD
  if ((fl & LIFE_FLAG.RIDE) !== 0) { rideThink(w, s, out, ev, i); return; }
  if (w.rP[i]) { w.rP[i] = 0; w.rTh[i] = -1; if (w.beh[i] === BEH.RIDE) endBeh(w, s, out, i, 0); }

  // B08 afterglow after a release
  if (w.aD[i]) { w.aD[i] = 0; startAfterglow(w, s, out, ev, i); return; }
  // B12 pose (the Snap tool or "Pose!")
  if (w.pO) { if (w.beh[i] !== BEH.POSE) startPose(w, s, out, i); return; }
  if (w.beh[i] === BEH.POSE) { endBeh(w, s, out, i, 0); emitExpr(w, out, i, EXPR.none, 0); }
  // B09 arrive
  if (w.aP[i]) { w.aP[i] = 0; startArrive(w, s, out, ev, i); return; }
  // B14 cheer
  if (w.cD[i]) { w.cD[i] = 0; startCheer(w, s, out, i); return; }

  const asked = w.pW[i] >= 0;
  const canMove = mayMove(w, s, i, asked);

  // B11 come back after a toss
  if ((fl & LIFE_FLAG.TOSSED) !== 0 && (fl & LIFE_FLAG.AIRBORNE) === 0 && w.beh[i] !== BEH.COMEBACK && canMove && needsComeBack(w, s, i)) {
    if (comeBackTarget(w, s, i)) { endBeh(w, s, out, i, 0); if (travelTo(w, s, out, i, 0, 0)) { setBeh(w, i, BEH.COMEBACK, 1000, 15000); w.ph[i] = 1; return; } }
  }

  // LF-18 (S2): after 30 s in water (by itself, or set there by the player) it heads out to the nearest dry spot by SCOOT, a floater too
  // (scootTo glides a floating body; never moveTo); it never naps there (B06 starts nowhere in water)
  if (w.iWT[i] > -1e8 && tb - w.iWT[i] >= BRAIN.waterMaxS && w.beh[i] !== BEH.COMEBACK && canMove) {
    if (dryTarget(w, s, i)) {
      if (w.beh[i] !== BEH.IDLE && w.beh[i] !== BEH.NONE) endBeh(w, s, out, i, 0);
      if (travelTo(w, s, out, i, 0, 0)) { setBeh(w, i, BEH.COMEBACK, 1000, 20000); w.ph[i] = 1; return; }
    }
  }

  // a newcomer says hello within 5 s (B09's shy arrival: an S01 greet with the nearest party member, whatever the distance)
  if (w.iN[i] && (w.oV[i] & ONCE.HELLO) === 0 && tb - w.aT[i] >= 1 && tb - w.aT[i] < 5 && w.ki[i] === 0) {
    let best = -1, bd = 0x3fffffff;
    for (let j = 0; j < s.n; j++) {
      if (j === i || !w.ac[j] || w.ki[j] !== 0 || w.moo[j] >= 0 || (s.flags[j] & HELD_BITS) !== 0) continue;
      const d = d2c(s, i, j);
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) {
      if (w.beh[best] !== BEH.IDLE && w.beh[best] !== BEH.NONE) endBeh(w, s, out, best, 0);
      if (w.mo[i]) stopMove(w, out, i);
      if (startMoment(w, s, out, MOM.GREET, best, i, -1) >= 0) { w.oV[i] |= ONCE.HELLO; w.pG[pairIdx(i, best)] |= 1; updateMoment(w, s, out, ev, w.moo[best]); return; }
    }
  }

  // a family with toast hops back from the heat once its toast passes 0.6, whatever it is doing still (B05's verb, D-80; once a visit)
  if (TOAST[w.fa[i]] && w.lo[i * 6 + 5] > BRAIN.toastHopAt && w.zWK[i] >= 0 && (w.oV[i] & ONCE.TOASTED) === 0 && canMove && w.beh[i] !== BEH.BASK && w.beh[i] !== BEH.NAP) {
    w.oV[i] |= ONCE.TOASTED;
    if (w.beh[i] !== BEH.IDLE && w.beh[i] !== BEH.NONE) endBeh(w, s, out, i, 0);
    setBeh(w, i, BEH.BASK, 700, 30000); w.ph[i] = 3; w.tT[i] = w.zT[w.zWK[i]];
    runBask(w, s, out, ev, i);
    return;
  }
  // the running behaviour
  runBehaviour(w, s, out, ev, i);
  if (w.moo[i] >= 0) return;

  // pending one-shots that compete (B13 watch, B16 huff, B15 zone, B10 love) and the utility choice
  choose(w, s, out, ev, i, canMove);

  // the natural wish scheduler (and an open wish's re-glances) while idle: on every idle think, not only after a choice (round 1 ran it
  // only when a new behaviour had just failed to start, so natural wishes almost never came)
  if ((w.beh[i] === BEH.IDLE || w.beh[i] === BEH.NONE) && w.moo[i] < 0) wishThink(w, s, out, ev, i);
  // the idle look about and the mood on the face
  if (w.beh[i] === BEH.IDLE || w.beh[i] === BEH.NONE) idleLook(w, s, out, i);
}

/* ───────────────────────────── the choice ───────────────────────────── */

function choose(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number, canMove: boolean): void {
  const tb = w.f[F.NOW];
  const cur = w.beh[i], curScore = cur === BEH.IDLE || cur === BEH.NONE ? 0 : w.bSc[i] + BRAIN.keep;
  const tr = i * 5;
  let best = 0, bs = 0.1 + (rnd(w, i) * NZ - BRAIN.noise), bArg = -1;
  // B13 watch
  if (w.wD[i] >= 0) { const v = 0.6 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.WATCH; bArg = w.wD[i]; } }
  // B16 huff: a scene event (another squishy took its ball or its spot) stays a candidate for 3 s (30 thinks) at its 0.5 (LIFE 4)
  if (w.hD[i]) { w.hD[i]--; const v = 0.5 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.HUFF; bArg = w.hF[i]; } }
  // B15 zone reaction (first entry this visit)
  if (w.b1[i] > 0) { const v = 0.95 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.ZONE; bArg = w.b1[i] - 1; } }
  // B19 hold on: a wind gust (the wind zone's flag at its centre) while it is on the ground
  if (w.zWK2[i] >= 0 && (s.flags[i] & LIFE_FLAG.GROUNDED) !== 0 && w.beh[i] !== BEH.HOLDON && (s.zoneMask[i] & (1 << ZONE.wind)) !== 0) {
    const v = 0.8 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.HOLDON; }
  }
  // B10 love its place (its first 10 s there, once per visit)
  if ((w.oV[i] & ONCE.LOVE) === 0 && FAV_PLACE[w.species[i]] === w.placeIdx && w.ki[i] !== 2 && tb - w.fPT[i] < 10) {
    const v = 0.95 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.LOVE; }
  }
  // B02 notice
  const src = noticeCandidate(w, s, i);
  if (src >= 0) { const v = 0.9 + (rnd(w, i) * NZ - BRAIN.noise) + (src >= 1000 ? 0.2 : 0); if (v > bs) { bs = v; best = BEH.NOTICE; bArg = src; } }
  // B18 answer a thing (a tune starts: the Music Box, the kettle's whistle)
  if (s.musicBoxOn && tb - w.f[F.MUSIC_ON] < 3 && w.tr[tr + TRAIT.chatty] > 0.5 && ready(w, i, BEH.ANSWER) && w.beh[i] !== BEH.NAP) {
    const v = 0.7 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.ANSWER; }
  }
  // the forced next use (FIRST_PLAY, PLAY_WITH)
  const forced = w.nU[i] >= 0 ? w.nU[i] : w.pW[i];
  if (forced >= 0 && (canMove || w.pW[i] >= 0)) { const v = 1.2; if (v > bs) { bs = v; best = BEH.USE; bArg = forced; } }
  if (canMove) {
    // B04 use a thing
    if (w.pl[i] > 0.4 && ready(w, i, BEH.USE) && w.uV[i] < USES_FULL) {
      const k = useCandidate(w, s, i);
      if (k >= 0) { const v = w.f[F.A] + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.USE; bArg = k; } }
    }
    // P04 join in (9): the face piece copies a nearby whole's thing use as a group (its chunks follow and hop together: P01, P03)
    if (w.ki[i] === 1 && ready(w, i, BEH.USE)) {
      const k = joinCandidate(w, s, i);
      if (k >= 0) { const v = 0.9 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.USE; bArg = k; } }
    }
    // B05 bask or warm up
    if (ready(w, i, BEH.BASK)) { const v0 = baskScore(w, s, i); if (v0 > 0) { const v = v0 * 0.001 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.BASK; } } }
    // B06 nap (never in water)
    if (ready(w, i, BEH.NAP) && w.zWK1[i] < 0) {
      const dozy = w.tr[tr + TRAIT.dozy];
      // (my reading: the dozy trigger also needs some rest need, 0.6, so a dozy squishy that wakes on the basket does not nap again and
      // again: about two naps in five minutes, LF-09)
      if (w.re[i] > 0.75 || (dozy > 0.6 && w.re[i] > 0.6 && w.uV[i] < USES_FULL && napSpotWithin(w, s, i, 2))) { const v = 0.8 + 0.4 * dozy + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.NAP; } }
    }
    // B03 wander (not with one squishy on a portrait phone at Home)
    if (w.pl[i] > 0.3 && ready(w, i, BEH.WANDER) && !(w.home && w.layout === 1 && w.nO <= 1) && tb - w.tST[i] > 4 && !interestNear(w, s, i)) {
      const v = 0.3 + 0.4 * w.pl[i] * w.tr[tr + TRAIT.bouncy] + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.WANDER; }
    }
  }
  // B06 with autonomy off: it naps where it is (sleeping moves nothing, LIFE 5.6: so piles still form; not while LIFE is quiet)
  if (!canMove && !s.autonomy && !quietFor(w, s, i) && ready(w, i, BEH.NAP) && w.zWK1[i] < 0 && (w.re[i] > 0.75 || (w.tr[tr + TRAIT.dozy] > 0.6 && w.re[i] > 0.6 && napSpotWithin(w, s, i, 2)))) {
    const v = 0.8 + 0.4 * w.tr[tr + TRAIT.dozy] + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.NAP; }
  }
  // the most curious walks over to look at the cut squishy's pieces (9): a walk to beside its face piece, then B13's watch
  if (w.lA[i] >= 0 && canMove && w.beh[i] !== BEH.WATCH) {
    if (tb > w.lU[i]) w.lA[i] = -1;
    else if (lookTarget(w, s, i)) { const v = 0.75 + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = BEH.WATCH; bArg = 100; } }
  }
  // the moments (S01..S18)
  const mk = socialPick(w, s, i, canMove);
  if (mk !== 0) { const v = w.f[F.A] + (rnd(w, i) * NZ - BRAIN.noise); if (v > bs) { bs = v; best = 100 + mk; bArg = w.f[F.B] | 0; } }

  w.wD[i] = -1;
  if (best === 0 || bs <= curScore) return;
  // the running behaviour is never restarted by its own fresh score (it would never get past its first phase)
  if (best === cur && (best !== BEH.USE || bArg === w.tT[i])) return;
  // start it
  if (best >= 100) {
    w.f[F.B] = bArg;
    if (w.beh[i] !== BEH.IDLE && w.beh[i] !== BEH.NONE) endBeh(w, s, out, i, 0);
    beginPicked(w, s, out, ev, i, best - 100);
    if (w.moo[i] >= 0) updateMoment(w, s, out, ev, w.moo[i]);
    return;
  }
  if (w.beh[i] !== BEH.IDLE && w.beh[i] !== BEH.NONE) endBeh(w, s, out, i, 0);
  switch (best) {
    case BEH.WATCH:
      if (bArg === 100) { // the walk over after a cut: to beside the face piece, then the watch (runBehaviour)
        lookTarget(w, s, i);
        if (travelTo(w, s, out, i, 0, 0)) { setBeh(w, i, BEH.WATCH, 1000, 20000); w.ph[i] = 1; w.tC[i] = -1; } // it goes to look: little interrupts it
        else w.lU[i] -= 2; // no mover token now: it tries again, for a little less time
        break;
      }
      setBeh(w, i, BEH.WATCH, 600, 3000); w.tC[i] = bArg; w.f[F.X] = s.x[bArg]; w.f[F.Z] = s.z[bArg]; emitGaze(w, out, i, 1); break;
    case BEH.HUFF: startHuff(w, s, out, i, bArg); break;
    case BEH.ZONE: startZone(w, s, out, ev, i, bArg); break;
    case BEH.LOVE: startLove(w, s, out, ev, i); break;
    case BEH.HOLDON: {
      setBeh(w, i, BEH.HOLDON, 800, 2500);
      w.f[F.X2] = -0.08; w.f[F.Z2] = 0; w.f[F.A] = 0; w.f[F.B] = 0; emitPose(w, s, out, i, 0);
      emitExpr(w, out, i, EXPR.happy, 30);
      emitReact(w, s, ev, i, REACT_KIND.HOLD_ON, -1, 0);
      break;
    }
    case BEH.NOTICE: startNotice(w, s, out, i, bArg); break;
    case BEH.ANSWER: startAnswer(w, s, out, ev, i); break;
    case BEH.USE: startUse(w, s, out, ev, i, bArg, (bs * 1000) | 0); break;
    case BEH.BASK: startBask(w, s, out, i, (bs * 1000) | 0); break;
    case BEH.NAP: startNap(w, s, out, ev, i, (bs * 1000) | 0); break;
    case BEH.WANDER: if ((towardParty(w, s, i) || freeTarget(w, s, i, 2500)) && travelTo(w, s, out, i, 0, 0)) { setBeh(w, i, BEH.WANDER, (bs * 1000) | 0, 20000); w.ph[i] = 1; } else w.coo[i * 26 + BEH.WANDER] = tb + 2; break;
  }
}
/** The seeded noise of +-0.05 is written inline as (rnd(w, i) * NZ - BRAIN.noise): rnd returns a small int, so nothing is boxed (LF-02). */
const NZ = 2 * BRAIN.noise / 65536;


/* ───────────────────────────── running behaviours ───────────────────────────── */

function runBehaviour(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  const b = w.beh[i];
  switch (b) {
    case BEH.WATCH:
      if (w.ph[i] === 1) { // walking over to look after a cut: on arrival (or blocked) it watches the face piece for 3 s
        const r = travelStep(w, s, out, i, 120);
        if (r !== 0 || tb >= w.bE[i]) {
          stopMove(w, out, i); clearPose(w, s, out, i); w.ph[i] = 2; w.bE[i] = tb + 3;
          const j = lookPiece(w, i); w.lA[i] = -1;
          if (j >= 0) { w.tC[i] = j; w.f[F.X] = s.x[j]; w.f[F.Z] = s.z[j]; emitGaze(w, out, i, 1); say(w, s, out, i, EMOTE.wow, 2, 0); }
        }
        return;
      }
      // B13 lasts while the one it watches is touched (the touch ends it, 0.2 s later)
      if (w.tC[i] >= 0) { const j = w.tC[i]; if (j < s.n && (s.flags[j] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) !== 0) w.bE[i] = tb + 0.2; }
      if (tb >= w.bE[i]) endBeh(w, s, out, i, 0);
      return;
    case BEH.HOLDON:
      if (w.zWK2[i] < 0 || tb >= w.bE[i]) { clearPose(w, s, out, i); endBeh(w, s, out, i, 0); }
      return;
    case BEH.NOTICE: case BEH.LOVE: case BEH.CHEER: case BEH.ANSWER: case BEH.AFTERGLOW: case BEH.ARRIVE: case BEH.WISH:
      if ((b === BEH.CHEER || b === BEH.ARRIVE || b === BEH.WISH || b === BEH.AFTERGLOW) && w.mo[i] && tb - w.lHT[i] > 0.6) stopMove(w, out, i);
      if (tb >= w.bE[i]) { if (b === BEH.LOVE || b === BEH.NOTICE) clearPose(w, s, out, i); endBeh(w, s, out, i, b === BEH.NOTICE ? 4 : b === BEH.ANSWER ? 20 : 0); }
      return;
    case BEH.ZONE:
      if (tb >= w.bE[i]) { clearPose(w, s, out, i); if (w.zW[i] <= 0) emitSquash(w, s, out, i, 1000, 500); endBeh(w, s, out, i, 0); }
      return;
    case BEH.HUFF:
      if (tb >= w.bE[i]) { clearPose(w, s, out, i); endBeh(w, s, out, i, 300); }
      return;
    case BEH.WANDER: case BEH.COMEBACK: {
      const r = travelStep(w, s, out, i, 80);
      if (r !== 0 || tb >= w.bE[i]) { clearPose(w, s, out, i); endBeh(w, s, out, i, b === BEH.WANDER ? 6 : 0); }
      return;
    }
    case BEH.USE: runUse(w, s, out, ev, i); return;
    case BEH.BASK: runBask(w, s, out, ev, i); return;
    case BEH.NAP: runNap(w, s, out, ev, i); return;
    case BEH.POSE: return;
  }
}

/* B02 notice: a thing moving within 1.5 m, a body arriving, a land or bump within 1.5 m, a new thing or squishy within the perception radius
 * not seen this visit (once per target per visit; 4 s per source); a switch tap is always noticed within 1.5 m (5.3). Returns a source id:
 * 0..31 a thing, 32..47 a character; + 1000 for a switch tap (outside the once rule). -1 none. */
function noticeCandidate(w: LifeWorld, s: LifeSnapshot, i: number): number {
  const tb = w.f[F.NOW];
  if (w.ki[i] === 2 || w.beh[i] === BEH.NAP) return -1;
  const per = BRAIN.perceive0 + BRAIN.perceiveCurious * w.tr[i * 5 + TRAIT.curious], per2 = per * per * CM2, n15 = BRAIN.noticeR * BRAIN.noticeR * CM2;
  const mine = w.beh[i] === BEH.USE ? w.tT[i] : -1; // the ball it is going to boop is not news
  for (let k = 0; k < w.nTD; k++) {
    const r = w.rOL[k];
    if (r < 0 || k === mine) continue;
    const d2 = d2t(s, i, r);
    const moved = tb - w.tMT[k] < 0.35 && tb - w.nT[i * 48 + k] >= 4;
    if (moved && w.tSw[k] !== 0 && d2 <= n15) return 1000 + k; // a switch tap: always noticed within 1.5 m
    if (moved && d2 <= n15) return k;
    const seen = (w.sT[i * 2 + (k >>> 5)] & (1 << (k & 31))) !== 0;
    if (!seen && d2 <= per2 + w.tS[k] * CM2) return k;
  }
  for (let j = 0; j < s.n; j++) {
    if (j === i || !w.ac[j]) continue;
    const d2 = d2c(s, i, j);
    if ((w.sC[i] & (1 << j)) === 0 && d2 <= per2 + CM2) return 32 + j;
    if (tb - w.lT1[j] < 0.35 && d2 <= n15 && tb - w.nT[i * 48 + 32 + j] >= 4) return 32 + j;
    if (tb - w.bT1[j] < 0.35 && d2 <= n15 && tb - w.nT[i * 48 + 32 + j] >= 4 && w.bW[j] !== i) return 32 + j;
  }
  return -1;
}
function startNotice(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, src0: number): void {
  const tb = w.f[F.NOW];
  const src = src0 >= 1000 ? src0 - 1000 : src0;
  let x = 0, z = 0, first = 0;
  if (src < 32) {
    const r = w.rOL[src]; x = r >= 0 ? s.thingX[r] : w.tX[src]; z = r >= 0 ? s.thingZ[r] : w.tZ[src];
    const o = i * 2 + (src >>> 5), bit = 1 << (src & 31);
    if ((w.sT[o] & bit) === 0) { w.sT[o] |= bit; first = 1; }
  } else {
    const j = src - 32; x = s.x[j]; z = s.z[j];
    if ((w.sC[i] & (1 << j)) === 0) { w.sC[i] |= 1 << j; first = 1; }
  }
  w.nT[i * 48 + src] = tb; w.lNT[i] = tb; w.nTa[i] = src;
  setBeh(w, i, BEH.NOTICE, 900, 1500);
  if (w.mo[i]) stopMove(w, out, i);
  w.f[F.X] = x; w.f[F.Z] = z; emitGaze(w, out, i, 1);
  const dx = x - s.x[i], dz = z - s.z[i], d = Math.sqrt(dx * dx + dz * dz) || 1;
  w.f[F.X2] = dx / d * 0.06; w.f[F.Z2] = dz / d * 0.06; w.f[F.A] = 0; w.f[F.B] = 0;
  emitPose(w, s, out, i, 0);
  if (w.tr[i * 5 + TRAIT.curious] > 0.5) say(w, s, out, i, EMOTE.question, 2, first);
  voice(w, s, out, i, PHRASE.NOTICE, 150, 2);
}

function interestNear(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  for (let k = 0; k < w.nTD; k++) { const r = w.rOL[k]; if (r >= 0 && tbMoved(w, k) && d2t(s, i, r) < 2.25 * CM2) return true; }
  return false;
}
function tbMoved(w: LifeWorld, k: number): boolean { return w.f[F.LAST_T] - w.tMT[k] < 1; }

/* B04 use a thing: the score into w.f[F.A] and the thing; a free floor-usable thing within 3 m (the ball in S0 and S1). */
function useCandidate(w: LifeWorld, s: LifeSnapshot, i: number): number {
  let best = -1, bs = 0;
  const sp = w.species[i], fav = SPECIES_LIFE[SPECIES[sp]].thing;
  for (let k = 0; k < w.nTD; k++) {
    if (w.tM[k] !== MECH.ball) continue; // the floor uses LIFE starts by itself in S0 / S1 (pads, chimes, pools, turntables: S2 / S3)
    if (!thingPos(w, s, k)) continue;
    const r = w.rOL[k];
    if (r >= 0 && s.thingBusy[r]) continue;
    w.f[F.PX] = w.f[F.X2]; w.f[F.PZ] = w.f[F.Z2];
    // within B04's 3 m; (my reading of LIFE 3's "at 0.8: a thing use") a squishy whose play is over 0.8 goes to it from anywhere in the place
    if (d2p(w, s, i) > 9 * CM2 && w.pl[i] <= 0.8) continue;
    let v = 0.3 + 0.5 * w.pl[i] + ((PREFS[w.fa[i]] & (1 << w.tM[k])) !== 0 ? 0.15 : 0) - 0.12 * w.uV[i];
    if (w.def && w.def.things[k].id === fav) v += 0.3;
    if (v > bs) { bs = v; best = k; }
  }
  w.f[F.A] = bs;
  return best;
}

/** The cut squishy's face piece (or the whole, not cut yet) character i walks over to look at (-1 none). */
function lookPiece(w: LifeWorld, i: number): number {
  const g = w.lA[i];
  if (g < 0) return -1;
  for (let j = 0; j < CAP; j++) if (w.ac[j] && w.ki[j] === 1 && w.gr[j] === g) return j;
  return w.ac[g] && w.ki[g] === 0 && w.gr[g] === g ? g : -1;
}
/** Beside that piece (0.9 m between centres, more for big bodies) on the line toward i, inside the shrunk bounds and clear of the keep-outs,
 *  into w.f[F.X], w.f[F.Z]; never at Home (the segment rule: it watches from its slot). */
function lookTarget(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  const j = lookPiece(w, i);
  if (w.home || j < 0 || j >= s.n) return false;
  let dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j], d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.01) { dx = 1; dz = 0; d = 1; }
  const r = s.r[i] + s.r[j] + 0.3 > 0.9 ? s.r[i] + s.r[j] + 0.3 : 0.9;
  if (d <= r + 0.3) return false; // near enough already
  w.f[F.X] = s.x[j] + dx / d * r; w.f[F.Z] = s.z[j] + dz / d * r;
  qT(w);
  return freeSpot(w, s, i);
}
/** P04: a ball a whole squishy within 2 m of face piece i booped in the last 4 s (a use to copy; LIFE 9's 4 s window), or -1. */
function joinCandidate(w: LifeWorld, s: LifeSnapshot, i: number): number {
  for (let k = 0; k < w.nTD; k++) {
    const u = w.tU[k], r = w.rOL[k];
    if (u < 0 || r < 0 || w.ki[u] !== 0 || !w.ac[u] || w.tM[k] !== MECH.ball || w.f[F.NOW] - w.tUT[k] > 4) continue;
    if (d2c(s, i, u) <= 4 * CM2 && d2t(s, i, r) <= 9 * CM2) return k;
  }
  return -1;
}
function startUse(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number, k: number, score: number /* x 1000 */): void {
  const tb = w.f[F.NOW];
  const asked = w.pW[i] === k;
  // a ride the player asked for: the shell lifts it there (carryTo); LIFE never climbs
  if (w.tRi[k] && asked) {
    const q = pushIntent(w, out, INTENT.USE, i); if (q >= 0) out.a[q] = k;
    w.pW[i] = -1; w.nU[i] = -1;
    return;
  }
  setBeh(w, i, BEH.USE, score, 12000); w.tT[i] = k; w.uS[i] = asked ? 2 : 1;
  w.nU[i] = -1; w.pW[i] = -1;
  // notice it first (gaze and a question bubble), then go
  if (thingPos(w, s, k)) { w.f[F.X] = w.f[F.X2]; w.f[F.Z] = w.f[F.Z2]; emitGaze(w, out, i, 1); }
  const first = w.fP[i] ? 1 : 0;
  if (w.tr[i * 5 + TRAIT.curious] > 0.5 || first) emitEmote(w, s, out, i, EMOTE.question, STYLE.SAY, first ? 1 : 2, 0, 0, 1);
  voice(w, s, out, i, PHRASE.NOTICE, 100, 2);
  w.ph[i] = 0; w.bN[i] = tb + 0.6;
}

/** The ball's use point (behind the ball, toward where it should roll) into w.f[F.X], w.f[F.Z]; the roll direction into w.f[F.A], w.f[F.B]. */
function ballUsePoint(w: LifeWorld, s: LifeSnapshot, i: number, k: number, overlapMm: number): boolean {
  if (!thingPos(w, s, k)) return false;
  const bx = w.f[F.X2], bz = w.f[F.Z2];
  // at Home from its home slot through the ball (the segment between two framed points, D-87); in a place from where it stands
  const ox = w.home && w.hX[i] === w.hX[i] ? w.hX[i] : s.x[i], oz = w.home && w.hX[i] === w.hX[i] ? w.hZ[i] : s.z[i];
  let dx = bx - ox, dz = bz - oz, d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.01) { dx = 0; dz = -1; d = 1; }
  dx /= d; dz /= d;
  const back = s.r[i] + w.tS[k] + 0.03 - overlapMm * 0.001;
  w.f[F.X] = bx - dx * back; w.f[F.Z] = bz - dz * back; w.f[F.A] = dx; w.f[F.B] = dz;
  if (w.home && back > d) { w.f[F.X] = ox; w.f[F.Z] = oz; }
  qT(w);
  return w.home || inBounds(w, 0);
}

function runUse(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  const k = w.tT[i], asked = w.uS[i] === 2;
  if (k < 0 || !thingPos(w, s, k)) { endBeh(w, s, out, i, 15); return; }
  // another squishy took the ball it was chasing: B16 huff (a squishy-to-squishy scene event only)
  const row = w.rOL[k];
  if (w.ki[i] === 0 && w.ph[i] <= 1 && takenBy(w, i, k) >= 0) { // (a piece group joining in, P04, follows the whole's use: not a take)
    const o = takenBy(w, i, k);
    endBeh(w, s, out, i, 15); clearPose(w, s, out, i);
    huffScene(w, i, o);
    return;
  }
  if (w.ph[i] === 0) {
    if (tb < w.bN[i]) return;
    if (!ballUsePoint(w, s, i, k, 0)) { endBeh(w, s, out, i, 15); return; }
    if (!mayMove(w, s, i, asked)) { if (tb - w.bT[i] > 6) endBeh(w, s, out, i, 5); return; }
    qT(w);
    if (d2p(w, s, i) < 36) { w.ph[i] = 2; w.bN[i] = tb; return; }
    if (travelTo(w, s, out, i, 0, 0)) { w.ph[i] = 1; w.bN[i] = tb; }
    else if (tb - w.bT[i] > 8) endBeh(w, s, out, i, 5);
    return;
  }
  if (w.ph[i] === 1) {
    const r = travelStep(w, s, out, i, 70);
    if (r === 2) { endBeh(w, s, out, i, 15); return; }
    if (r === 1) { w.ph[i] = 2; w.bN[i] = tb; }
    if (tb - w.bT[i] > 12) endBeh(w, s, out, i, 15);
    return;
  }
  if (w.ph[i] === 2) {
    // the boop: a hop into it and the last centimetres through it (the ball rolls on; physics)
    if (!ballUsePoint(w, s, i, k, 60)) { endBeh(w, s, out, i, 15); return; }
    if (!gateStart(w, s, i, 0, 0)) { if (tb - w.bT[i] > 12) endBeh(w, s, out, i, 5); return; }
    const dx = w.f[F.A], dz = w.f[F.B];
    if (thingPos(w, s, k)) {
      const bx = w.f[F.X2], bz = w.f[F.Z2], reach = s.r[i] + w.tS[k] - 0.06;
      w.f[F.X] = bx - dx * reach; w.f[F.Z] = bz - dz * reach;
    }
    qT(w);
    if (w.home || inBounds(w, 0)) emitScoot(w, out, i, 300, 0);
    w.f[F.X2] = dx; w.f[F.Z2] = dz;
    emitHop(w, s, out, i, 400, 1000);
    emitEmote(w, s, out, i, w.tI[k] || EMOTE.ball, STYLE.SAY, 2, 0, 0, w.fP[i]);
    voice(w, s, out, i, PHRASE.JOY, 200, 2);
    pushEvent(ev, LIFE_EV.USE, w.tV[k] || USE_VERB.ROLL, i, asked ? 254 : -1, 1, w.tG[k]);
    w.tU[k] = i; w.tUT[k] = tb;
    if (w.ki[i] !== 0) pieceUse(w, s, ev, i, k);
    w.pl[i] = Math.max(0, w.pl[i] - 0.3); w.lJT[i] = tb; w.fP[i] = 0; w.uV[i]++;
    w.ph[i] = 3; w.bN[i] = tb + 1.6;
    return;
  }
  if (w.ph[i] === 3 && tb >= w.bN[i]) { clearPose(w, s, out, i); endBeh(w, s, out, i, 15); }
}
/** Who else is booping ball k now (a squishy-to-squishy take), or -1. */
function takenBy(w: LifeWorld, i: number, k: number): number {
  for (let j = 0; j < CAP; j++) if (j !== i && w.ac[j] && w.beh[j] === BEH.USE && w.tT[j] === k && w.ph[j] >= 2) return j;
  const u = w.tU[k];
  if (u >= 0 && u !== i && w.f[F.NOW] - w.tUT[k] < 1.5) return u;
  return -1;
}
/** B16's only triggers (LF-13): HUFF_TRIGGERS. Never from the player's act, absence or time; never in a session's first 60 s; 5 min apart. */
export const HUFF_TRIGGERS = ['another squishy took the ball it was chasing', 'another squishy took the seat or spot it was walking to'] as const;
export function huffScene(w: LifeWorld, i: number, other: number): void {
  const tb = w.f[F.NOW];
  if (w.ki[i] !== 0 || other < 0 || w.ki[other] === 2) return;
  if (!(tb - w.f[F.T0] >= BRAIN.huffQuietS)) return; // NaN (no session yet) is never 60 s
  if (tb < w.coo[i * 26 + BEH.HUFF]) return;
  w.hD[i] = 30; w.hF[i] = other;
}
function startHuff(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, o: number): void {
  const tb = w.f[F.NOW];
  setBeh(w, i, BEH.HUFF, 500, BRAIN.huffMaxS * 1000);
  w.hD[i] = 0; w.hT[i] = tb;
  const dx = s.x[i] - s.x[o], dz = s.z[i] - s.z[o], d = Math.sqrt(dx * dx + dz * dz) || 1;
  w.f[F.X2] = dx / d * 0.08; w.f[F.Z2] = dz / d * 0.08; w.f[F.A] = 0; w.f[F.B] = 0;
  emitPose(w, s, out, i, 0);
  say(w, s, out, i, EMOTE.puff, 2, 0);
  voice(w, s, out, i, PHRASE.HUFF, 0, 2);
  w.coo[i * 26 + BEH.HUFF] = tb + 300;
}

/* B05 bask or warm up */
function baskScore(w: LifeWorld, s: LifeSnapshot, i: number): number {
  let near3 = false, near2 = false, unvisited = false;
  for (let k = 0; k < w.nZ; k++) {
    if (w.zK[k] !== ZONE.warm) continue;
    const t = w.zT[k];
    if (w.home && t >= 0 && w.rOL[t] < 0) continue;
    const dx = s.x[i] - w.zX[k], dz = s.z[i] - w.zZ[k], d = Math.sqrt(dx * dx + dz * dz) - (w.zSh[k] === 0 ? w.zR[k] : Math.max(w.zH[k], w.zHZ[k]));
    if (d <= 3) { near3 = true; if ((w.oV[i] & (1 << k)) === 0) unvisited = true; }
    if (d <= 2) near2 = true;
  }
  if (!near3) return 0;
  const comfort = w.lo[i * 6] > 0.5 || w.lo[i * 6 + 1] > 0.5 || w.lo[i * 6 + 2] > 0.5;
  if (comfort || (near2 && w.tr[i * 5 + TRAIT.dozy] > 0.5)) return 700;
  if (unvisited) return 500;
  return 0;
}
function startBask(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, score: number): void {
  const tb = w.f[F.NOW];
  // the warm zone's thing's use spot (the Warm Lamp), else the warmest free spot sampled near the zone's centre
  let zk = -1, bd = 0x3fffffff;
  for (let k = 0; k < w.nZ; k++) {
    if (w.zK[k] !== ZONE.warm) continue;
    const t = w.zT[k];
    if (w.home && t >= 0 && w.rOL[t] < 0) continue;
    w.f[F.PX] = w.zX[k]; w.f[F.PZ] = w.zZ[k];
    const d = d2p(w, s, i);
    if (d < bd) { bd = d; zk = k; }
  }
  if (zk < 0) { w.coo[i * 26 + BEH.BASK] = tb + 5; return; }
  w.oV[i] |= 1 << zk;
  const t = w.zT[zk];
  let ok = false;
  if (t >= 0 && w.tUX[t] === w.tUX[t]) { w.f[F.X] = w.tUX[t]; w.f[F.Z] = w.tUZ[t]; ok = true; }
  else if (!w.home) {
    let bestS = 0, bx = 0, bz = 0;
    for (let n = 0; n < 12; n++) {
      const a = rnd(w, i) * U16 * Math.PI * 2, r = 0.3 + rnd(w, i) * U16 * 1.0;
      const x = w.zX[zk] + Math.cos(a) * r, z = w.zZ[zk] + Math.sin(a) * r;
      w.f[F.PX] = x; w.f[F.PZ] = z;
      if (!freeSpot(w, s, i)) continue;
      const dx = x - w.zX[zk], dz = z - w.zZ[zk], d = Math.sqrt(dx * dx + dz * dz);
      const st = w.zF0[zk] >= 0 && d > w.zF0[zk] ? 1 - (1 - w.zF1[zk]) * (d - w.zF0[zk]) / (w.zR[zk] - w.zF0[zk]) : 1;
      if (st > bestS) { bestS = st; bx = x; bz = z; }
    }
    if (bestS > 0) { w.f[F.X] = bx; w.f[F.Z] = bz; ok = true; }
  }
  if (!ok) { w.coo[i * 26 + BEH.BASK] = tb + 5; return; }
  w.tx[i] = w.f[F.X]; w.tz[i] = w.f[F.Z];
  setBeh(w, i, BEH.BASK, score, TOAST[w.fa[i]] ? 40000 : 30000); w.tT[i] = t;
  qT(w);
  if (d2p(w, s, i) < 100) { w.ph[i] = 2; w.bN[i] = tb; return; }
  if (travelTo(w, s, out, i, 0, 0)) w.ph[i] = 1; else { w.beh[i] = BEH.IDLE; w.coo[i * 26 + BEH.BASK] = tb + 3; }
}
function runBask(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  const f = w.fa[i];
  if (w.ph[i] === 1) {
    const r = travelStep(w, s, out, i, 80);
    if (r === 2 || tb - w.bT[i] > 20) { endBeh(w, s, out, i, 20); return; }
    if (r === 1) { stopMove(w, out, i); w.ph[i] = 2; }
    return;
  }
  if (w.ph[i] === 2) { // the family's warm pose (memory families only when converged), the bubble, the deep breaths of the firm ones
    w.ph[i] = 3; w.bN[i] = tb + 15;
    if (WARMPOSE[f] !== 1 && emitSquash(w, s, out, i, (WARMPOSE[f] * 1000) | 0, 1500)) w.pT2[i] = tb;
    clearPose(w, s, out, i);
    if (f === FAM_FIRM || f === FAM_POP) { noLean(w); w.f[F.A] = 0.02; w.f[F.B] = 0.25; emitPose(w, s, out, i, 0); }
    const t = w.tT[i], fire = t >= 0 && w.tSw[t] === 6;
    emitEmote(w, s, out, i, fire ? EMOTE.flame : EMOTE.sun, STYLE.SAY, 2, 0, 0, 0);
    emitExpr(w, out, i, EXPR.happy, 60);
    return;
  }
  if (w.ph[i] === 3) {
    // a family with toast hops back from the heat once its toast passes 0.6, and basks on there (D-80)
    if (TOAST[f] && w.lo[i * 6 + 5] > BRAIN.toastHopAt && w.zWK[i] >= 0) {
      w.oV[i] |= ONCE.TOASTED;
      const k = w.zWK[i], dx = s.x[i] - w.zX[k], dz = s.z[i] - w.zZ[k], d = Math.sqrt(dx * dx + dz * dz) || 1;
      if (gateStart(w, s, i, 0, 0)) {
        w.f[F.X2] = dx / d; w.f[F.Z2] = dz / d;
        emitHop(w, s, out, i, 500, 1000);
        w.f[F.X] = s.x[i] + dx / d * BRAIN.toastHop; w.f[F.Z] = s.z[i] + dz / d * BRAIN.toastHop;
        qT(w);
        if (!w.home && !inBounds(w, shrinkMm(s, i))) { w.f[F.X] = s.x[i]; w.f[F.Z] = s.z[i]; }
        emitScoot(w, out, i, 250, 0);
        say(w, s, out, i, EMOTE.flame, 2, 1);
        w.ph[i] = 4; w.bN[i] = tb + 1.5; w.bE[i] = tb + 6;
      }
      return;
    }
    const comfortDone = w.lo[i * 6] < 0.1 && w.lo[i * 6 + 1] < 0.1 && w.lo[i * 6 + 2] < 0.1;
    if ((tb >= w.bN[i] && (!TOAST[f] || w.zW[i] <= 0)) || (tb >= w.bN[i] && comfortDone && !TOAST[f]) || tb >= w.bE[i]) {
      emitSquash(w, s, out, i, 1000, 800); clearPose(w, s, out, i); endBeh(w, s, out, i, 20);
    }
    return;
  }
  if (w.ph[i] === 4) {
    if (tb >= w.bN[i] && w.mo[i]) stopMove(w, out, i);
    if (tb >= w.bE[i]) { emitSquash(w, s, out, i, 1000, 800); endBeh(w, s, out, i, 20); }
  }
}

/* B06 nap: a rug, a ring (by its gap's waypoint), Home's rug spot or its own slot, or beside a sleeping friend; the body sleeps */
function napSpotWithin(w: LifeWorld, s: LifeSnapshot, i: number, r: number): boolean {
  for (let k = 0; k < w.nP; k++) {
    if (!w.pN[k]) continue;
    const t = w.pT[k];
    if (w.home && t >= 0 && w.rOL[t] < 0) continue;
    w.f[F.PX] = w.pX[k]; w.f[F.PZ] = w.pZ[k];
    if (Math.sqrt(d2p(w, s, i) / CM2) - w.pR[k] <= r) return true;
  }
  for (let k = 0; k < w.nTD; k++) {
    if (w.tM[k] !== MECH.ring) continue;
    w.f[F.PX] = w.tX[k]; w.f[F.PZ] = w.tZ[k];
    if (Math.sqrt(d2p(w, s, i) / CM2) - w.tS[k] <= r) return true;
  }
  return false;
}
/** The squishy now napping in ring k, or settled inside it, other than i (-1 none). */
function ringTaker(w: LifeWorld, s: LifeSnapshot, i: number, k: number): number {
  w.f[F.PX] = w.tX[k]; w.f[F.PZ] = w.tZ[k];
  const r = w.tS[k] - 0.1;
  for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.ki[j] === 0 && ((w.beh[j] === BEH.NAP && w.tT[j] === k && w.ph[j] >= 2) || d2p(w, s, j) < r * r * CM2)) return j;
  return -1;
}
function ringFree(w: LifeWorld, s: LifeSnapshot, i: number, k: number): boolean {
  w.f[F.PX] = w.tX[k]; w.f[F.PZ] = w.tZ[k];
  const r = w.tS[k] - 0.1;
  for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && ((w.beh[j] === BEH.NAP && w.tT[j] === k) || d2p(w, s, j) < r * r * CM2)) return false;
  return true;
}
function startNap(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number, score: number): void {
  setBeh(w, i, BEH.NAP, score, 30000 + ((rnd(w, i) * 60000) >>> 16)); w.tT[i] = -1; w.tC[i] = -1;
  let ok = false;
  if (w.home) {
    // the play body naps at its own slot (the rug's centre is within 0.65 m of slot 0); the second napper at the rug's use spot
    let rug = -1;
    for (let k = 0; k < w.nTD; k++) if (w.tM[k] === 0 && w.tPa[k] >= 0 && w.pN[w.tPa[k]] && w.rOL[k] >= 0) rug = k;
    let napperOnRug = false;
    for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.beh[j] === BEH.NAP && w.tT[j] === rug && rug >= 0) napperOnRug = true;
    if (rug >= 0 && napperOnRug && w.tUX[rug] === w.tUX[rug]) { w.f[F.X] = w.tUX[rug]; w.f[F.Z] = w.tUZ[rug]; w.tT[i] = rug; ok = true; }
    else if (w.hX[i] === w.hX[i]) { w.f[F.X] = w.hX[i]; w.f[F.Z] = w.hZ[i]; w.tT[i] = rug; ok = true; }
  } else {
    // a ring within 3 m that is free: first to its gap's waypoint (0.6 m outside the mouth), then in
    for (let k = 0; k < w.nTD && !ok; k++) {
      if (w.tM[k] !== MECH.ring) continue;
      w.f[F.PX] = w.tX[k]; w.f[F.PZ] = w.tZ[k];
      if (d2p(w, s, i) > (9 + w.tS[k] * 6) * CM2 || !ringFree(w, s, i, k)) continue;
      w.f[F.X] = w.tWX[k]; w.f[F.Z] = w.tWZ[k]; w.tT[i] = k; w.uS[i] = 1; ok = true;
    }
    // beside a sleeping friend (the contact approach)
    if (!ok) for (let j = 0; j < s.n && !ok; j++) {
      if (j === i || !w.ac[j] || w.beh[j] !== BEH.NAP || w.ph[j] < 2 || d2c(s, i, j) > 9 * CM2) continue;
      const dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j], d = Math.sqrt(dx * dx + dz * dz) || 1, r = s.r[i] + s.r[j] + 0.08;
      w.f[F.X] = s.x[j] + dx / d * r; w.f[F.Z] = s.z[j] + dz / d * r;
      qT(w);
      if (inBounds(w, 0)) { w.tC[i] = j; w.tT[i] = w.tT[j]; ok = true; }
    }
    // a nap patch (a rug)
    if (!ok) for (let k = 0; k < w.nP && !ok; k++) {
      if (!w.pN[k]) continue;
      for (let n = 0; n < 6 && !ok; n++) {
        const a = rnd(w, i) * U16 * Math.PI * 2, r = rnd(w, i) * U16 * Math.max(0, w.pR[k] - 0.3);
        const x = w.pX[k] + Math.cos(a) * r, z = w.pZ[k] + Math.sin(a) * r;
        w.f[F.PX] = x; w.f[F.PZ] = z;
        if (!inBounds(w, shrinkMm(s, i)) || !clearOfThings(w, s, 400)) continue;
        w.f[F.X] = x; w.f[F.Z] = z; w.tT[i] = w.pT[k]; ok = true;
      }
    }
  }
  if (!ok) { w.f[F.X] = s.x[i]; w.f[F.Z] = s.z[i]; }
  w.tx[i] = w.f[F.X]; w.tz[i] = w.f[F.Z];
  qT(w);
  if (d2p(w, s, i) < 100 || !mayMove(w, s, i, false)) { w.ph[i] = 2; settleNap(w, s, out, ev, i); return; }
  if (travelTo(w, s, out, i, w.tC[i] >= 0 ? 0 : 0, 0)) w.ph[i] = 1; else { w.ph[i] = 2; settleNap(w, s, out, ev, i); }
}
function settleNap(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  if (w.mo[i]) stopMove(w, out, i);
  w.ph[i] = 2; w.bN[i] = tb;
  emitExpr(w, out, i, EXPR.sleepy, 100);
  clearPose(w, s, out, i);
  // one zzz per pile: none when joining a napping friend
  let joined = false;
  for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.beh[j] === BEH.NAP && w.ph[j] >= 2 && touching(s, i, j, 150)) joined = true;
  if (!joined) emitEmote(w, s, out, i, EMOTE.zzz, w.ki[i] === 0 ? STYLE.SAY : STYLE.GROUP, 2, 0, 0, 0);
  voice(w, s, out, i, PHRASE.SLEEPY, 0, 3);
  // a nap on a nap thing (the Snug Basket, the Snooze Rug) is a use of it (USE NAP)
  const k = w.tT[i];
  if (k >= 0 && (w.tM[k] === MECH.ring || (w.tPa[k] >= 0 && w.pN[w.tPa[k]])) && (w.oN[i] >= 0 || w.tM[k] === MECH.ring)) {
    pushEvent(ev, LIFE_EV.USE, USE_VERB.NAP, i, -1, 1, w.tG[k]);
    if (w.uV[i] < 255) w.uV[i]++;
    if (w.ki[i] !== 0) pieceUse(w, s, ev, i, k);
  }
}
function touching(s: LifeSnapshot, i: number, j: number, slackMm: number): boolean {
  const dx = s.x[j] - s.x[i], dz = s.z[j] - s.z[i], r = s.r[i] + s.r[j] + slackMm * 0.001;
  return dx * dx + dz * dz <= r * r;
}
function runNap(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  if (w.ph[i] === 1) {
    // another squishy took the ring it was walking to (B16's second scene event): it gives up this nap; the huff may show
    const kr = w.tT[i];
    if (kr >= 0 && w.tM[kr] === MECH.ring && w.tC[i] < 0) {
      const o = ringTaker(w, s, i, kr);
      if (o >= 0) { endBeh(w, s, out, i, 5); clearPose(w, s, out, i); huffScene(w, i, o); return; }
    }
    const r = travelStep(w, s, out, i, 80);
    if (r === 0 && tb - w.bT[i] < 25) return;
    const k = w.tT[i];
    if (r === 1 && w.uS[i] === 1 && k >= 0 && w.tM[k] === MECH.ring) { // in through the gap to the inner spot
      w.uS[i] = 0; w.f[F.X] = w.tUX[k]; w.f[F.Z] = w.tUZ[k];
      stopMove(w, out, i);
      if (travelTo(w, s, out, i, 0, 0)) return;
    }
    if (r === 1 && w.tC[i] >= 0) { // the last centimetres to a sleeping friend at 0.04 m/s (it stays asleep)
      const j = w.tC[i];
      if (!touching(s, i, j, 30)) { w.tC[i] = -1; const dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j], d = Math.sqrt(dx * dx + dz * dz) || 1, rr = s.r[i] + s.r[j];
        w.f[F.X] = s.x[j] + dx / d * rr; w.f[F.Z] = s.z[j] + dz / d * rr; stopMove(w, out, i); if (travelTo(w, s, out, i, 1, 0)) return; }
    }
    settleNap(w, s, out, ev, i);
    return;
  }
  // asleep: a pile (S08) when it touches another napper; one island
  if (w.ph[i] === 2) {
    for (let j = 0; j < s.n; j++) {
      if (j === i || !w.ac[j] || w.beh[j] !== BEH.NAP || w.ph[j] < 2 || !touching(s, i, j, 150)) continue;
      const p = pairIdx(i, j);
      if (w.pNe[p] & 2) continue;
      w.pNe[p] |= 2;
      let n = 1, thing = -1;
      for (let q = 0; q < s.n; q++) if (q !== i && w.ac[q] && w.beh[q] === BEH.NAP && w.ph[q] >= 2 && touching(s, i, q, 150)) n++;
      // the pile counts for a ring when any napper's centre is inside it (D-76), for a rug when one lies on it
      for (let q = 0; q < s.n && thing < 0; q++) {
        if (!w.ac[q] || w.beh[q] !== BEH.NAP || w.ph[q] < 2 || !(q === i || touching(s, i, q, 150))) continue;
        const t = w.tT[q];
        if (t >= 0 && w.tM[t] === MECH.ring) {
          w.f[F.PX] = w.tX[t]; w.f[F.PZ] = w.tZ[t];
          const ri = w.tS[t] - w.tS1[t];
          if (d2p(w, s, q) < ri * ri * CM2) thing = w.tG[t];
        }
        if (thing < 0 && w.oN[q] >= 0 && w.pT[w.oN[q]] >= 0) thing = w.tG[w.pT[w.oN[q]]];
      }
      pushEvent(ev, LIFE_EV.SOCIAL, MOM_SUB_PILE, i, j, n, thing);
      w.co[i] = Math.max(0, w.co[i] - 0.5); w.co[j] = Math.max(0, w.co[j] - 0.5);
      break;
    }
    // wakes: rest under 0.1 after its 30..90 s; a toss landing within 1 m (it wakes with a blink)
    let wake = tb >= w.bE[i] && w.re[i] < 0.1;
    for (let j = 0; j < s.n && !wake; j++) if (j !== i && w.ac[j] && tb - w.lT1[j] < 0.3 && (s.flags[j] & LIFE_FLAG.TOSSED) !== 0 && d2c(s, i, j) < (1 + s.r[i] + s.r[j]) * CM2) wake = true;
    if (tb - w.bT[i] > 150) wake = true;
    if (wake) { emitExpr(w, out, i, EXPR.none, 0); endBeh(w, s, out, i, 30); for (let j = 0; j < CAP; j++) w.pNe[pairIdx(i, j)] &= ~2; }
  }
}
const MOM_SUB_PILE = 9;

/* B15 zone reaction, B10 love, B18 answer, B08 afterglow, B09 arrive, B12 pose, B14 cheer */
function startZone(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number, k: number): void {
  const tb = w.f[F.NOW];
  w.b1[i] = 0;
  setBeh(w, i, BEH.ZONE, 950, 2000 + ((rnd(w, i) * 2000) >>> 16));
  const kind = w.zK[k], f = w.fa[i];
  let icon: number = EMOTE.droplet;
  if (kind === ZONE.warm) {
    const t = w.zT[k];
    icon = t >= 0 && w.tSw[t] === 6 ? EMOTE.flame : EMOTE.sun;
    if (WARMPOSE[f] !== 1 && emitSquash(w, s, out, i, (WARMPOSE[f] * 1000) | 0, 1500)) w.pT2[i] = tb;
  } else if (kind === ZONE.cold) {
    icon = EMOTE.snowflake;
    noLean(w); w.f[F.A] = 0.015; w.f[F.B] = 7; emitPose(w, s, out, i, 0);
  } else if (kind === ZONE.water) icon = (s.flags[i] & LIFE_FLAG.GROUNDED) === 0 ? EMOTE.bubbles : EMOTE.droplet;
  else if (kind === ZONE.wind) icon = 0;
  if (icon) say(w, s, out, i, icon, 2, 1);
}
function startLove(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  w.oV[i] |= ONCE.LOVE;
  setBeh(w, i, BEH.LOVE, 950, 2000);
  noLean(w); w.f[F.A] = 0.05; w.f[F.B] = s.calm || s.reducedMotion ? 2 : 3; emitPose(w, s, out, i, 0);
  say(w, s, out, i, EMOTE.sparkle, 2, 1);
  voice(w, s, out, i, PHRASE.JOY, 0, 2);
  emitReact(w, s, ev, i, REACT_KIND.LOVE, -1, 0);
  w.lJT[i] = tb;
}
function startAnswer(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  setBeh(w, i, BEH.ANSWER, 700, 2500);
  const k = tuneThing(w, s);
  if (k >= 0 && thingPos(w, s, k)) { w.f[F.X] = w.f[F.X2]; w.f[F.Z] = w.f[F.Z2]; emitGaze(w, out, i, 1); }
  voice(w, s, out, i, PHRASE.THING, 300, 2);
  if (k >= 0) pushEvent(ev, LIFE_EV.USE, USE_VERB.LISTEN, i, -1, 1, w.tG[k]);
}
function startAfterglow(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  if (w.mo[i]) stopMove(w, out, i);
  setBeh(w, i, BEH.AFTERGLOW, 1000, 1500);
  emitGaze(w, out, i, 2);
  const t = w.lTo[i], sig = w.si[i];
  const loved = (sig === 1 && t === TOUCH.POKE) || (sig === 2 && (t === TOUCH.SQUEEZE || t === TOUCH.SQUEEZE_1S)) || (sig === 3 && (t === TOUCH.STRETCH || t === TOUCH.STRETCH_06));
  if (loved) {
    say(w, s, out, i, EMOTE.sparkle, 1, 1);
    emitExpr(w, out, i, EXPR.happy, 100);
    voice(w, s, out, i, PHRASE.LOVED, 0, 1);
    w.pl[i] = Math.max(0, w.pl[i] - 0.4); w.lJT[i] = tb;
    if ((w.oV[i] & ONCE.SIGNATURE) === 0 && w.ki[i] === 0) { w.oV[i] |= ONCE.SIGNATURE; pushEvent(ev, LIFE_EV.SIGNATURE, t < 0 ? 0 : t, i, -1, 1, -1); }
  } else if (w.hF[i] === -2 || rnd(w, i) * U16 < 0.4) {
    say(w, s, out, i, EMOTE.giggle, 1, 0);
    voice(w, s, out, i, PHRASE.GIGGLE, 0, 1);
  }
  w.lTo[i] = -1; w.hF[i] = -1;
}
function startArrive(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  setBeh(w, i, BEH.ARRIVE, 1000, 1000);
  if (FAV_PLACE[w.species[i]] === w.placeIdx) w.fPT[i] = tb;
  // one arrival hop for those that get a mover token (through the gate); the others a happy squint
  noLean(w);
  const can = mayMove(w, s, i, false) && G_HOPS[w.fa[i]] && gateStart(w, s, i, 0, 0);
  if (!(can && emitHop(w, s, out, i, 0, 800))) { if (w.mo[i]) stopMove(w, out, i); emitExpr(w, out, i, EXPR.happy, 70); }
  if (w.iN[i]) { w.sU[i] = tb + BRAIN.shyS; emitExpr(w, out, i, EXPR.shy, 60); }
  // one shared sparkle for the party
  let shared = false;
  for (let j = 0; j < CAP; j++) if (j !== i && w.ac[j] && w.beh[j] === BEH.ARRIVE && tb - w.bT[j] < 1) shared = true;
  if (!shared) say(w, s, out, i, EMOTE.sparkle, 2, 1);
}
function startPose(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number): void {
  if (w.mo[i]) stopMove(w, out, i);
  setBeh(w, i, BEH.POSE, 1000, 1e9);
  emitGaze(w, out, i, 2); emitExpr(w, out, i, EXPR.happy, 100); clearPose(w, s, out, i);
  say(w, s, out, i, EMOTE.sparkle, 2, 0);
}
function startCheer(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number): void {
  const tb = w.f[F.NOW];
  if (w.beh[i] !== BEH.IDLE && w.beh[i] !== BEH.NONE && w.beh[i] !== BEH.NAP) endBeh(w, s, out, i, 0);
  setBeh(w, i, BEH.CHEER, 1000, 1200);
  noLean(w);
  if (!(mayMove(w, s, i, false) && gateStart(w, s, i, 0, 0) && emitHop(w, s, out, i, 0, 700)) && w.mo[i]) stopMove(w, out, i);
  say(w, s, out, i, EMOTE.star, 1, 0);
  voice(w, s, out, i, PHRASE.JOY, 0, 1);
  w.lJT[i] = tb;
}

/* B20 ride */
function rideThink(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  if (!w.rP[i] || w.beh[i] !== BEH.RIDE) {
    w.rP[i] = 1;
    if (w.mo[i]) stopMove(w, out, i);
    setBeh(w, i, BEH.RIDE, 1000, BRAIN.rideS * 1000); w.rU[i] = tb + BRAIN.rideS;
    // the ride it sits on: the nearest ride thing
    let best = -1, bd = 0x3fffffff;
    for (let k = 0; k < w.nTD; k++) {
      if (!w.tRi[k]) continue;
      const r = w.rOL[k];
      w.f[F.PX] = r >= 0 ? s.thingX[r] : w.tX[k]; w.f[F.PZ] = r >= 0 ? s.thingZ[r] : w.tZ[k];
      const d = d2p(w, s, i);
      if (d < bd) { bd = d; best = k; }
    }
    w.rTh[i] = best; w.rST[i] = -1e9;
    say(w, s, out, i, EMOTE.swirl, 1, 0);
    wishCheck(w, s, out, ev, i);
  }
  if (w.moo[i] >= 0) return;
  if (tryTeeter(w, s, out, i)) { updateMoment(w, s, out, ev, w.moo[i]); return; }
  // a lone rider on a two-rider ride shows a star bubble, "Ride with me!" (P1)
  const k = w.rTh[i];
  if (k >= 0 && w.tM[k] === MECH.seesaw && tb - w.rST[i] > 8) {
    let other = false;
    for (let j = 0; j < s.n; j++) if (j !== i && w.ac[j] && w.rTh[j] === k && (s.flags[j] & LIFE_FLAG.RIDE) !== 0) other = true;
    if (!other) { emitEmote(w, s, out, i, EMOTE.star, STYLE.SAY, 1, 0, 0, w.rST[i] < -1e8 ? 1 : 0); w.rST[i] = tb; }
  }
}

/** The nearest dry spot for character i into w.f[F.X], w.f[F.Z]: out of every water zone by its radius + 0.1 m, inside the bounds shrunk
 *  by R + 0.2 m, clear of the keep-outs; 16 directions x 7 distances, deterministic (no draw). False when none. */
function dryTarget(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  const grow = ((s.r[i] + 0.1) * 1000) | 0;
  let best = 1e9;
  for (let a = 0; a < 16; a++) {
    const ang = a * Math.PI / 8, cx = Math.cos(ang), cz = Math.sin(ang);
    for (let k = 1; k <= 7; k++) {
      const d = k * 0.5;
      if (d >= best) break;
      const x = s.x[i] + cx * d, z = s.z[i] + cz * d;
      w.f[F.PX] = x; w.f[F.PZ] = z;
      if (!freeSpot(w, s, i)) continue;
      let wet = false;
      for (let q = 0; q < w.nZ && !wet; q++) if (w.zK[q] === ZONE.water && inAreaAt(w, 0, q, grow)) wet = true;
      if (wet) continue;
      best = d; w.f[F.X] = x; w.f[F.Z] = z;
      break;
    }
  }
  return best < 1e9;
}

/* B11 come back */
function needsComeBack(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  if (w.home) {
    // a toss that lands more than 0.5 m from every segment between framed points (here: from its home slot and the arrived use spots)
    if (!(w.hX[i] === w.hX[i])) return false;
    let best = 1e9;
    for (let p = 0; p < CAP + w.nTD; p++) {
      if (!framedPoint(w, s, p)) continue;
      const ax = w.f[F.X2], az = w.f[F.Z2];
      for (let q = p; q < CAP + w.nTD; q++) {
        if (!framedPoint(w, s, q)) continue;
        const bx = w.f[F.X2], bz = w.f[F.Z2], vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz;
        let u = L > 0 ? ((s.x[i] - ax) * vx + (s.z[i] - az) * vz) / L : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.sqrt((s.x[i] - ax - vx * u) ** 2 + (s.z[i] - az - vz * u) ** 2);
        if (d < best) best = d;
      }
    }
    return best > 0.5;
  }
  w.f[F.PX] = s.x[i]; w.f[F.PZ] = s.z[i];
  return !inBounds(w, 400);
}
function comeBackTarget(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  if (w.home) { if (!(w.hX[i] === w.hX[i])) return false; w.f[F.X] = w.hX[i]; w.f[F.Z] = w.hZ[i]; return true; }
  // toward the middle, to the first point inside the bounds shrunk by R + 0.2 m
  for (let k = 1; k <= 10; k++) {
    const u = k / 10, x = s.x[i] + (w.bx - s.x[i]) * u, z = s.z[i] + (w.bz - s.z[i]) * u;
    w.f[F.PX] = x; w.f[F.PZ] = z;
    if (inBounds(w, shrinkMm(s, i))) { w.f[F.X] = x; w.f[F.Z] = z; return true; }
  }
  return false;
}

/* the idle look about (every 2.2..5.8 s) and the mood (happy, sleepy, playful, curious, content) on the face */
function idleLook(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number): void {
  const tb = w.f[F.NOW];
  if (tb >= w.bN[i]) {
    w.bN[i] = tb + 2.2 + 3.6 * (rnd(w, i) * U16);
    const tgt = (rnd(w, i) * (s.n + w.nTD + 1)) >>> 16;
    if (tgt < s.n && tgt !== i && w.ac[tgt]) { w.f[F.X] = s.x[tgt]; w.f[F.Z] = s.z[tgt]; emitGaze(w, out, i, 1); }
    else if (tgt >= s.n && tgt - s.n < w.nTD && thingPos(w, s, tgt - s.n)) { w.f[F.X] = w.f[F.X2]; w.f[F.Z] = w.f[F.Z2]; emitGaze(w, out, i, 1); }
    else if (tb < w.sU[i]) { w.f[F.X] = s.x[i]; w.f[F.Z] = s.z[i] + 0.6; emitGaze(w, out, i, 1); } // the shy one looks down between glances
    else emitGaze(w, out, i, 0);
  }
  // the mood, for the face only (never a word)
  if (tb < w.sU[i]) emitExpr(w, out, i, EXPR.shy, 50);
  else if (tb - w.lJT[i] < 8) emitExpr(w, out, i, EXPR.happy, 80);
  else if (w.re[i] > 0.7) emitExpr(w, out, i, EXPR.sleepy, 60);
  else if (w.pl[i] > 0.6) emitExpr(w, out, i, EXPR.happy, 40);
  else if (tb - w.lNT[i] < 4) emitExpr(w, out, i, EXPR.surprised, 30);
  else emitExpr(w, out, i, EXPR.none, 0);
}

/* ───────────────────────────── pieces (9): P01 follow, P02 huddle, P03 hop together, P04 join in ───────────────────────────── */

function chunkThink(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  const lead = leaderOf(w, i);
  if (lead === i || !w.ac[lead] || lead >= s.n) return;
  const canMove = mayMove(w, s, i, false);
  if (w.beh[i] === BEH.FOLLOW || w.beh[i] === BEH.HUDDLE) {
    const r = travelStep(w, s, out, i, 80);
    if (r !== 0 || tb >= w.bE[i]) endBeh(w, s, out, i, 0);
    return;
  }
  if (w.beh[i] === BEH.HOPTOG || w.beh[i] === BEH.ZONE) { if (tb >= w.bE[i]) { if (w.beh[i] === BEH.ZONE) clearPose(w, s, out, i); endBeh(w, s, out, i, 0); } return; }
  // B15 (W F C): a chunk reacts to its first entry into a zone too (its bubble merges into the group's)
  if (w.b1[i] > 0) { startZone(w, s, out, ev, i, w.b1[i] - 1); return; }
  if (w.beh[lead] === BEH.NAP && w.ph[lead] >= 2 && w.beh[i] !== BEH.NAP) { setBeh(w, i, BEH.NAP, 800, 1e9); w.ph[i] = 2; emitExpr(w, out, i, EXPR.sleepy, 100); return; }
  if (w.beh[i] === BEH.NAP) { if (w.beh[lead] !== BEH.NAP) endBeh(w, s, out, i, 0); return; }
  if (!canMove) return;
  const d = Math.sqrt(d2c(s, i, lead) / CM2) - s.r[i] - s.r[lead];
  // P03 hop together: the face piece hopped; the chunks follow in a jiggle wave, staggered 0.12 s by rank
  if (tb - w.lHT[lead] < 0.25 && tb - w.lHT[i] > 0.8) {
    let rank = 0; for (let j = 0; j < i; j++) if (w.ac[j] && w.ki[j] === 2 && w.gr[j] === w.gr[i]) rank++;
    if (tb - w.lHT[lead] >= 0.12 * (rank + 1) - 0.1 && gateStart(w, s, i, 0, 0)) {
      noLean(w);
      if (emitHop(w, s, out, i, 0, 800)) { setBeh(w, i, BEH.HOPTOG, 600, 600); pieceUse(w, s, ev, i, -1); return; }
      stopMove(w, out, i);
    }
  }
  // P01 follow: more than 0.6 m from the face piece, it scoots up behind it (a little line, like ducklings)
  // P02 huddle: the face piece idle for 20 s, the pieces gather within 0.6 m
  const leadIdle = w.beh[lead] === BEH.IDLE && tb - w.bT[lead] > 20;
  if (d > 0.6 || (leadIdle && d > 0.25)) {
    const dx = s.x[i] - s.x[lead], dz = s.z[i] - s.z[lead], L = Math.sqrt(dx * dx + dz * dz) || 1, rr = s.r[i] + s.r[lead] + (leadIdle ? 0.08 : 0.3);
    w.f[F.X] = s.x[lead] + dx / L * rr; w.f[F.Z] = s.z[lead] + dz / L * rr;
    qT(w);
    if (!w.home && !inBounds(w, ((s.r[i] + 0.1) * 1000) | 0)) { w.f[F.X] = s.x[lead]; w.f[F.Z] = s.z[lead]; }
    if (travelTo(w, s, out, i, 0, 0)) setBeh(w, i, d > 0.6 ? BEH.FOLLOW : BEH.HUDDLE, 500, 8000);
  }
}

/** A piece's use counts for its group's PIECES record (the pieces that used the thing within 4 s, at a new high; D-73). */
export function pieceUse(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, i: number, k: number): void {
  const tb = w.f[F.NOW];
  if (w.ki[i] === 0) return;
  w.pUT[i] = tb;
  if (k < 0) return;
  let n = 0;
  for (let j = 0; j < CAP; j++) if (w.ac[j] && w.ki[j] !== 0 && w.gr[j] === w.gr[i] && tb - w.pUT[j] <= 4) n++;
  const g = w.gr[i] & 31, key = 200 + w.tV[k], o = g * 8;
  let slot = -1;
  for (let j = 0; j < 8; j++) { if (w.gHK[o + j] === key) { slot = j; break; } if (slot < 0 && w.gHK[o + j] < 0) slot = j + 100; }
  if (slot >= 100) { slot -= 100; w.gHK[o + slot] = key; w.gHN[o + slot] = 0; }
  if (slot < 0 || n <= w.gHN[o + slot]) return;
  w.gHN[o + slot] = n;
  pushEvent(ev, LIFE_EV.PIECES, PIECES_USE + w.tV[k], leaderOf(w, i), -1, n, w.tG[k]); // a use's sub is PIECES_USE + verb
}
export { groupCount, isFree };
