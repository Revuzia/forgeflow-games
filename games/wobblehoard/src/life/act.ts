// The primitives as intents (LIFE.md 5.1, 5.2, 5.4): SCOOT (scootTo, the travel driver: never moveTo, D-63), HOP (with its anticipation
// squash), SQUASH poses (an identical pose is never re-sent), POSE (render lean and sway, the phase from sim time in `e`), GAZE, EXPRESS,
// EMOTE (with its class, group key and count dots), SETTLE and CANCEL; and the motion gate's start test for one character (10.3). No intent
// presses, grabs or locks (L3, LF-05). Owned by PG_LIFE.
//
// Intent argument layout (the host applies them; documented for PG_SHELL):
//   SCOOT  a, b = target x, z (m, place space); c = speed m/s (0.04..0.5); d = 1 for a contact approach (stop at the first contact).
//   HOP    a, b, c = vx, vy, vz (m/s; vy within the slice cap); d = the anticipation squash the host sets 0.12 s before the impulse (1 = none).
//   SQUASH a = target s (1 releases it); b = tau s.
//   POSE   a, b = lean x, z (rest radii); c = sway amplitude (rest radii); d = sway Hz; e = sway phase (radians, from sim time).
//   GLIDE  a, b = the nudge's vx, vz (m/s).
//   GAZE   a, b, c = world point; d = weight (0 hands the eyes back to the pointer); a = NaN: look at the camera.
//   EXPRESS a = EXPR id; b = amount 0..1.
//   EMOTE  icon, style (0 say, 1 think, 2 group; 3 = a wish's still dot, set by the budget), prio, groupKey, dots; a = flags (bit 0 the
//          sparkle badge); e = the class (1 P1, 2 P2, 3 P3). icon 0 clears that character's bubble of that style.
//   VOICE  icon = PHRASE id; a = the phrase handle for lifePhrase; b = register (0 whole, 1 piece group); c = group voice count 1..3;
//          d = syllables; e = length s. delayS = the sim-time start offset (the host maps it onto musicClock after LIFE decided).
//   SETTLE release the travel driver (scootTo NaN); poses stay (a converged pose may sleep).
//   CANCEL drop this character's queued intents and ease every LIFE driver out (HELD, 5.5).
//   USE    a = the place-local thing index of a player-asked use the shell performs (a ride: carryTo).
import type { LifeSnapshot, LifeIntents } from '../contracts.ts';
import { INTENT, LIFE_FLAG, GAITS, HOP, EMOTE, FAMILY_REACT } from '../data/life.ts';
import type { Gait } from '../data/life.ts';
import { MATERIAL_FAMILY_IDS } from '../data/materials.ts';
import type { LifeWorld } from './world.ts';
import { pushIntent, F, CAP } from './world.ts';
import { WAKE, UNIT, GATE_TOL, moverCapOf, unitCapOf, UNIT_CAP, STYLE } from './attention.ts';

export const HELD_BITS = LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.LOCKED;
const TWO_PI = Math.PI * 2;

/** Per family (MATERIAL_FAMILY_IDS order): the gait numbers as flat arrays. */
export const G_SQUASH = new Float32Array(12), G_VY = new Float32Array(12), G_STEPS = new Float32Array(12), G_GLIDE = new Float32Array(12);
export const G_HOPS = new Uint8Array(12), G_MEM = new Uint8Array(12), G_GAP = new Float32Array(12);
for (let f = 0; f < 12; f++) {
  const g: Gait = GAITS[MATERIAL_FAMILY_IDS[f]];
  G_SQUASH[f] = g.squash; G_VY[f] = Math.min(g.vyS1, HOP.capS1); G_STEPS[f] = g.stepsPerS; G_GLIDE[f] = g.glide; G_HOPS[f] = g.hops ? 1 : 0;
  G_MEM[f] = g.memoryGated ? 1 : 0; G_GAP[f] = g.maxHopsPerMin ? Math.max(HOP.minGapS, 60 / g.maxHopsPerMin) : HOP.minGapS;
}

/* ───────────────────────────── the motion gate for one start (10.3) ───────────────────────────── */

/** Is character i a member of a piece group that already holds a mover token? */
function groupMoving(w: LifeWorld, i: number): boolean {
  if (w.kind[i] === 0) return false;
  const g = w.group[i];
  for (let j = 0; j < CAP; j++) if (j !== i && w.active[j] && w.kind[j] !== 0 && w.group[j] === g && w.moving[j]) return true;
  return false;
}

/** Try to start moving character i: a mover token (a piece group counts 1) and, if its body sleeps, the wake within unitCap (+ the ride
 *  allowance, D-85; `extraMilli` = more units the start wakes, x 1000, e.g. a boop target 970 + its pair 250). True = it may move now. */
export function gateStart(w: LifeWorld, s: LifeSnapshot, i: number, extraMilli: number, allowanceMilli: number): boolean {
  if (w.moving[i]) return true;
  const inGroup = groupMoving(w, i);
  const moverCap = moverCapOf(s.tier);
  if (!inGroup && w.movers + 1 > moverCap) return false;
  let delta = extraMilli * 0.001;
  if ((s.flags[i] & LIFE_FLAG.ASLEEP) !== 0) delta += w.kind[i] === 0 ? WAKE.whole : WAKE.piece;
  if (delta > 0) {
    const cap = UNIT_CAP[s.tier < 0 ? 0 : s.tier > 2 ? 2 : s.tier | 0] + allowanceMilli * 0.001;
    if (s.units + w.unitsAdd + delta > cap + GATE_TOL) return false;
    w.unitsAdd += delta;
    if ((s.flags[i] & LIFE_FLAG.ASLEEP) !== 0) w.wakeClaimT[i] = s.t;
  }
  w.moving[i] = 1;
  if (!inGroup) w.movers++;
  w.att.movers = w.movers;
  return true;
}
/** Would a start that also wakes `extraMilli` more fit? (no state change) */
export function gateFits(w: LifeWorld, s: LifeSnapshot, i: number, extraMilli: number, allowanceMilli: number): boolean {
  const moverCap = moverCapOf(s.tier);
  if (!w.moving[i] && !groupMoving(w, i) && w.movers + 1 > moverCap) return false;
  let delta = extraMilli * 0.001;
  if (!w.moving[i] && (s.flags[i] & LIFE_FLAG.ASLEEP) !== 0) delta += w.kind[i] === 0 ? WAKE.whole : WAKE.piece;
  if (delta <= 0) return true;
  return s.units + w.unitsAdd + delta <= UNIT_CAP[s.tier < 0 ? 0 : s.tier > 2 ? 2 : s.tier | 0] + allowanceMilli * 0.001 + GATE_TOL;
}
/** Release character i's mover token and its travel driver. */
export function stopMove(w: LifeWorld, out: LifeIntents, i: number): void {
  if (!w.moving[i]) return;
  w.moving[i] = 0;
  if (!groupMoving(w, i)) { w.movers--; if (w.movers < 0) w.movers = 0; }
  w.att.movers = w.movers;
  const k = pushIntent(w, out, INTENT.SETTLE, i);
  if (k >= 0) out.a[k] = 0;
}
export { UNIT };

/* ───────────────────────────── motion intents ───────────────────────────── */

/** May character i get a new physics motion now? Not while LIFE is quiet (the cut group leaves the non-Hand-tool quiet 1 s after the
 *  swipe, D-73) or with "Squishies move on their own" off, except a use the player asked for and a ride the player set up (5.6, D-79). */
export function motionAllowed(w: LifeWorld, s: LifeSnapshot, i: number): boolean {
  const asked = w.playWith[i] >= 0 || w.useStage[i] === 2 || (s.flags[i] & LIFE_FLAG.RIDE) !== 0;
  if (s.quiet) { if (w.kind[i] === 0) return false; const c = w.cutT[w.group[i] & 31]; if (!(c > -1e8 && s.t >= c + 1)) return false; }
  if (!s.autonomy && !asked) {
    // a moment with a rider the player set (S10, S11) moves on: the ride is the player's
    const m = w.moment[i];
    if (m < 0 || !w.mRide[m]) return false;
  }
  return true;
}

/** SCOOT to (w.f[F.X], w.f[F.Z]) at speedMilli / 1000 m/s (contact = 1: the last centimetres at 0.04 m/s). */
export function emitScoot(w: LifeWorld, out: LifeIntents, i: number, speedMilli: number, contact: number): boolean {
  const k = pushIntent(w, out, INTENT.SCOOT, i);
  if (k < 0) return false;
  out.a[k] = w.f[F.X]; out.b[k] = w.f[F.Z]; out.c[k] = speedMilli * 0.001; out.d[k] = contact;
  w.tx[i] = w.f[F.X]; w.tz[i] = w.f[F.Z]; w.tSpeed[i] = speedMilli * 0.001;
  return true;
}

/** A hop of character i toward the direction (w.f[F.X2], w.f[F.Z2]) (unit or zero) at horizontal speed hMilli / 1000 m/s; vy from its gait,
 *  x scaleMilli / 1000 (pieces x 0.8, Calm x 0.6). False (no intent) when its family never hops, its memory is busy, or within its hop gap. */
export function emitHop(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, hMilli: number, scaleMilli: number): boolean {
  const tb = w.f[F.NOW];
  const f = w.family[i];
  if (!G_HOPS[f]) return false;
  if (!motionAllowed(w, s, i)) return false;
  if (G_MEM[f] && (s.flags[i] & LIFE_FLAG.MEMORY_BUSY) !== 0) return false;
  if ((s.flags[i] & LIFE_FLAG.AIRBORNE) !== 0) return false;
  if (tb - w.lastHopT[i] < G_GAP[f]) return false;
  const k = pushIntent(w, out, INTENT.HOP, i);
  if (k < 0) return false;
  let sc = scaleMilli * 0.001;
  if (w.kind[i] !== 0) sc *= HOP.pieceVy;
  if (s.calm || s.reducedMotion) sc *= HOP.calmScale;
  const h = hMilli * 0.001 * (w.kind[i] !== 0 ? Math.cbrt(s.frac[i] > 0 ? s.frac[i] : 1) : 1);
  out.a[k] = w.f[F.X2] * h; out.b[k] = Math.min(HOP.capS1, G_VY[f] * sc); out.c[k] = w.f[F.Z2] * h; out.d[k] = G_SQUASH[f];
  w.lastHopT[i] = tb;
  return true;
}

/** A squash pose (setSquash) at sMilli / 1000 with tau tauMilli / 1000; never re-sent identical; refused for a busy memory family. */
export function emitSquash(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, sMilli: number, tauMilli: number): boolean {
  const v = Math.fround(sMilli * 0.001);
  if (w.sqS[i] === v) return true;
  if (!s.autonomy && v !== 1 && w.playWith[i] < 0) return false; // autonomy off: no squash pose (LF-24)
  if (G_MEM[w.family[i]] && (s.flags[i] & LIFE_FLAG.MEMORY_BUSY) !== 0) return false;
  const k = pushIntent(w, out, INTENT.SQUASH, i);
  if (k < 0) return false;
  out.a[k] = v; out.b[k] = tauMilli * 0.001; w.sqS[i] = v;
  return true;
}

/** A render pose: lean (w.f[F.X2], w.f[F.Z2]) rest radii, sway amplitude w.f[F.A] at w.f[F.B] Hz, phase from sim time (or the beat when
 *  beat = 1). Never re-sent identical. Calm or reduced motion: no wiggle or sway above 2 Hz (LF-17). */
export function emitPose(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, beat: number): boolean {
  const tb = w.f[F.NOW];
  let lx = w.f[F.X2], lz = w.f[F.Z2], amp = w.f[F.A], hz = w.f[F.B];
  const L = Math.sqrt(lx * lx + lz * lz);
  if (L > 0.1) { lx *= 0.1 / L; lz *= 0.1 / L; }
  if (amp > 0.05 && hz < 6) amp = 0.05;
  if ((s.calm || s.reducedMotion) && hz > 2) hz = 2;
  if (hz > 7) hz = 7;
  const o = i * 4;
  if (w.poseKey[o] === Math.fround(lx) && w.poseKey[o + 1] === Math.fround(lz) && w.poseKey[o + 2] === Math.fround(amp) && w.poseKey[o + 3] === Math.fround(hz)) return true;
  const k = pushIntent(w, out, INTENT.POSE, i);
  if (k < 0) return false;
  out.a[k] = lx; out.b[k] = lz; out.c[k] = amp; out.d[k] = hz;
  const ph = beat ? (tb * 66 / 60) % 1 : (tb * hz) % 1;
  out.e[k] = ph * TWO_PI;
  w.poseKey[o] = lx; w.poseKey[o + 1] = lz; w.poseKey[o + 2] = amp; w.poseKey[o + 3] = hz;
  return true;
}
/** Release the render pose (all 0). */
export function clearPose(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number): void {
  const tb = w.f[F.NOW];
  w.f[F.X2] = 0; w.f[F.Z2] = 0; w.f[F.A] = 0; w.f[F.B] = 0;
  emitPose(w, s, out, i, 0);
}

/** Gaze: kind 0 = back to the pointer, 1 = at the point (w.f[F.X], w.f[F.Z]) at height 0.4, 2 = at the camera. */
export function emitGaze(w: LifeWorld, out: LifeIntents, i: number, kind: number): void {
  if (w.kind[i] === 2) return; // chunks have no face
  const k = pushIntent(w, out, INTENT.GAZE, i);
  if (k < 0) return;
  if (kind === 0) { out.a[k] = 0; out.b[k] = 0; out.c[k] = 0; out.d[k] = 0; }
  else if (kind === 2) { out.a[k] = NaN; out.b[k] = 0; out.c[k] = 0; out.d[k] = 1; }
  else { out.a[k] = w.f[F.X]; out.b[k] = 0.4; out.c[k] = w.f[F.Z]; out.d[k] = 0.8; }
  w.gazeKind[i] = kind;
}

/** An eyes-only expression (EXPR id) at amountPct / 100; never re-sent identical. */
export function emitExpr(w: LifeWorld, out: LifeIntents, i: number, expr: number, amountPct: number): void {
  if (w.kind[i] === 2) return;
  const amt = Math.fround(amountPct * 0.01);
  if (w.expr[i] === expr && w.exprAmt[i] === amt) return;
  const k = pushIntent(w, out, INTENT.EXPRESS, i);
  if (k < 0) return;
  out.a[k] = expr; out.b[k] = amt; w.expr[i] = expr; w.exprAmt[i] = amt;
}

export function emitCancel(w: LifeWorld, out: LifeIntents, i: number): void {
  pushIntent(w, out, INTENT.CANCEL, i);
  w.sqS[i] = 1;
  for (let j = 0; j < 4; j++) w.poseKey[i * 4 + j] = 0;
}

/** Count the pieces of character i's group (itself included). */
export function groupCount(w: LifeWorld, i: number): number {
  if (w.kind[i] === 0) return 1;
  let n = 0;
  const g = w.group[i];
  for (let j = 0; j < CAP; j++) if (w.active[j] && w.kind[j] !== 0 && w.group[j] === g) n++;
  return n;
}

/** A squishmoji request (LIFE 7, 10.2): class 1 P1, 2 P2, 3 P3; pieces use the group bubble (style 2, one per group, count dots) and piece
 *  events within 0.5 s merge into it (LF-08). flags bit 0 = the sparkle badge; friend 1 = a friend pair (+0.3); first 1 = a first-time event
 *  (+0.2). The budget (attention.ts) decides. */
export function emitEmote(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, icon: number, style: number, cls: number, flags: number,
  friend: number, first: number): boolean {
  const tb = w.f[F.NOW];
  if ((s.flags[i] & HELD_BITS) !== 0 && cls !== 1) return false;
  let st = style, key = -1, dots = 0, c = cls;
  if (w.kind[i] !== 0) {
    const g = w.group[i] & 31;
    if (tb - w.groupEmoteT[g] < 0.5) return true; // merged into the group's bubble
    w.groupEmoteT[g] = tb;
    if (style !== STYLE.THINK) { st = STYLE.GROUP; key = w.group[i]; dots = Math.min(3, groupCount(w, i)); if (c === 2) c = 3; }
  }
  const k = pushIntent(w, out, INTENT.EMOTE, i);
  if (k < 0) return false;
  out.icon[k] = icon; out.style[k] = st; out.groupKey[k] = key; out.dots[k] = dots; out.a[k] = flags; out.e[k] = c;
  let p = c === 1 ? 3 : c === 2 ? 2 : 1;
  const sx = s.sx[i], sy = s.sy[i];
  if (sx === sx) p += 1 - Math.min(1, Math.sqrt((sx - 0.5) * (sx - 0.5) + (sy - 0.5) * (sy - 0.5)) / 0.7071);
  if (friend) p += 0.3;
  if (first) p += 0.2;
  if (tb - w.iconT[i * 25 + icon] < 10) p -= 0.5;
  out.prio[k] = p;
  w.iconT[i * 25 + icon] = tb; w.lastEmoteT[i] = tb; w.lastEmoteIcon[i] = icon;
  return true;
}
/** Clear character i's bubble of a style (0 say, 1 think). */
export function emitClear(w: LifeWorld, out: LifeIntents, i: number, style: number): void {
  const k = pushIntent(w, out, INTENT.EMOTE, i);
  if (k < 0) return;
  out.icon[k] = 0; out.style[k] = style; out.e[k] = 1; out.prio[k] = 10;
}
export { EMOTE };

/* ───────────────────────────── travel (SCOOT with the gait overlay, 5.1) ───────────────────────────── */

/** Start travelling character i to (w.f[F.X], w.f[F.Z]) at its gait's glide speed (contact = 1: the contact approach at 0.04 m/s). Asks the
 *  motion gate (with `allowanceMilli` of ride allowance); false = no token now (nothing emitted). */
export function travelTo(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, contact: number, allowanceMilli: number): boolean {
  const tb = w.f[F.NOW];
  if (!motionAllowed(w, s, i)) return false;
  if (!gateStart(w, s, i, 0, allowanceMilli)) return false;
  const tx = w.f[F.X], tz = w.f[F.Z];
  let sp = contact ? 40 : (G_GLIDE[w.family[i]] * 1000) | 0;
  if (!contact && w.zCold[i] > 0) sp = (sp * COLD_SPEED[w.family[i]]) | 0;
  if (sp < 40) sp = 40;
  if (!emitScoot(w, out, i, sp, contact)) return false;
  const dx = tx - s.x[i], dz = tz - s.z[i], d = Math.sqrt(dx * dx + dz * dz);
  w.progD[i] = d; w.progT[i] = tb; w.hopNextT[i] = tb + 0.3;
  if (d > 0.01) { w.f[F.X2] = dx / d * 0.05; w.f[F.Z2] = dz / d * 0.05; } else { w.f[F.X2] = 0; w.f[F.Z2] = 0; }
  w.f[F.A] = 0; w.f[F.B] = 0;
  emitPose(w, s, out, i, 0);
  w.f[F.X] = tx; w.f[F.Z] = tz;
  return true;
}

/** Each think while travelling: 0 going, 1 arrived (within `arriveMm` mm of the target), 2 blocked (no 2 cm of progress in 2 s). The gait
 *  overlay: a small hop per step for hopping families (never closer than the hop gap; Calm: a chain of at most 3). */
export function travelStep(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, i: number, arriveMm: number): number {
  const tb = w.f[F.NOW];
  const dx = w.tx[i] - s.x[i], dz = w.tz[i] - s.z[i], d = Math.sqrt(dx * dx + dz * dz);
  if (d <= arriveMm * 0.001) return 1;
  if (tb - w.progT[i] >= 2) {
    if (w.progD[i] - d < 0.02) return 2;
    w.progD[i] = d; w.progT[i] = tb;
  }
  const f = w.family[i];
  if (G_HOPS[f] && w.tSpeed[i] > 0.05 && tb >= w.hopNextT[i] && d > 0.15) {
    const step = G_STEPS[f] > 0 ? 1 / G_STEPS[f] : 2;
    w.f[F.X2] = 0; w.f[F.Z2] = 0;
    const calmChain = (s.calm || s.reducedMotion) && w.chain[i] >= HOP.calmChain;
    if (!calmChain && emitHop(w, s, out, i, 0, 600)) w.chain[i]++;
    w.hopNextT[i] = tb + (step > G_GAP[f] ? step : G_GAP[f]);
  }
  return 0;
}
const COLD_SPEED = new Float32Array(12);
for (let f = 0; f < 12; f++) COLD_SPEED[f] = FAMILY_REACT[MATERIAL_FAMILY_IDS[f]].coldSpeed;
