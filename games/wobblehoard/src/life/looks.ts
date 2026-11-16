// Needs (LIFE.md 3), looks (3.1, LOOK_RATES) and the REACT events by REACT_TRIGGERS (4.2; D-72, D-73): integrated on every think of every
// character whatever behaviour wins (LF-20, LF-21). A piece's REACT becomes its group's PIECES record at each new high of the group's count
// (9, LF-22). Owned by PG_LIFE.
import type { LifeSnapshot, LifeEvents } from '../contracts.ts';
import { LOOK, LOOK_RATES, NEEDS, FAMILY_REACT, REACT_TRIGGERS, REACT_COND, REACT_KIND, LIFE_EV, LIFE_FLAG } from '../data/life.ts';
import { ZONE } from '../data/places.ts';
import { MATERIAL_FAMILY_IDS } from '../data/materials.ts';
import type { LifeWorld } from './world.ts';
import { CAP, F, inAreaAt, zoneStrengthAt, pushEvent, MAX_ZONES } from './world.ts';
import { TRAIT } from './traits.ts';

/** Per family: soak rate, toast, shiver, warm pose (flat). */
const SOAK = new Float32Array(12), TOAST = new Uint8Array(12), SHIVER = new Uint8Array(12), WARMPOSE = new Float32Array(12);
for (let f = 0; f < 12; f++) {
  const r = FAMILY_REACT[MATERIAL_FAMILY_IDS[f]];
  SOAK[f] = r.soakRate; TOAST[f] = r.toast ? 1 : 0; SHIVER[f] = r.shiver ? 1 : 0; WARMPOSE[f] = r.warmPose;
}
export { WARMPOSE, TOAST, SHIVER };
const FAM_BEADS = MATERIAL_FAMILY_IDS.indexOf('beadsqueeze');
/** The REACT kind a look's 0.5 crossing (or a lifeAddLook of it) emits; 0 = none (wet and sand have none). */
export const LOOK_REACT: readonly number[] = [REACT_KIND.FROST, 0, REACT_KIND.SOAK, 0, REACT_KIND.SNOWCAP, REACT_KIND.TOAST];
const NT = REACT_TRIGGERS.length;
const TR_KIND = new Uint8Array(NT), TR_COND = new Uint8Array(NT), TR_ARG = new Float32Array(NT), TR_MIN = new Float32Array(NT), TR_FOR = new Float32Array(NT);
const TR_FAM = new Int8Array(NT), TR_SHIVER = new Uint8Array(NT), TR_VISIT = new Uint8Array(NT), TR_COOL = new Float32Array(NT), TR_THING = new Uint8Array(NT);
for (let k = 0; k < NT; k++) {
  const r = REACT_TRIGGERS[k];
  TR_KIND[k] = r.kind; TR_COND[k] = r.cond; TR_ARG[k] = r.arg; TR_MIN[k] = r.min ?? 0; TR_FOR[k] = r.forS ?? 0;
  TR_FAM[k] = r.fam ? MATERIAL_FAMILY_IDS.indexOf(r.fam) : -1; TR_SHIVER[k] = r.shiverOnly ? 1 : 0; TR_VISIT[k] = r.once === 'visit' ? 1 : 0;
  TR_COOL[k] = r.cooldownS; TR_THING[k] = r.thing === 'zone' ? 0 : r.thing === 'patch' ? 1 : r.thing === 'source' ? 2 : 3;
}
/** The trigger row of a REACT kind (-1 none). */
export const TRIGGER_OF = new Int8Array(32).fill(-1);
for (let k = 0; k < NT; k++) TRIGGER_OF[TR_KIND[k]] = k;

/* ───────────────────────────── zone sensing ───────────────────────────── */

/** Which zones character i stands in (its centre), how warm, cold and wet it is there, and a B15 entry due (first entry this visit). */
export function senseZones(w: LifeWorld, s: LifeSnapshot, i: number): void {
  const tb = w.f[F.NOW];
  const mask = s.zoneMask[i];
  w.f[F.PX] = s.x[i]; w.f[F.PZ] = s.z[i];
  let warm = 0, cold = 0, wet = 0, wk = -1, ck = -1, wat = -1, wind = -1, up = -1;
  for (let k = 0; k < w.nZ && k < MAX_ZONES; k++) {
    zoneStrengthAt(w, k);
    const st = w.f[F.S], o = i * MAX_ZONES + k, kind = w.zK[k];
    const inside = st > 0 || (inAreaAt(w, 0, k, 0) && (mask & (1 << kind)) !== 0);
    if (!inside) { w.zIT[o] = -1e9; continue; }
    if (w.zIT[o] < -1e8) {
      w.zIT[o] = w.eAO[i] ? tb - 100 : tb;
      const bit = 1 << k;
      if ((w.zSe[i] & bit) === 0 && (kind === ZONE.warm || kind === ZONE.cold || kind === ZONE.wet || kind === ZONE.water || kind === ZONE.wind)) {
        w.zSe[i] |= bit; w.b1[i] = k + 1;
      }
    }
    if (kind === ZONE.warm && st > warm) { warm = st; wk = k; }
    else if (kind === ZONE.cold && st > cold) { cold = st; ck = k; }
    else if (kind === ZONE.wet && st > wet) wet = st;
    else if (kind === ZONE.water) wat = k;
    else if (kind === ZONE.wind) wind = k;
    else if (kind === ZONE.updraft) up = k;
  }
  // a zone the host reports at the centre with no geometry here (a test fixture, a whole-place cold) still counts, at strength 1
  if (warm === 0 && (mask & (1 << ZONE.warm)) !== 0) warm = 1;
  if (cold === 0 && (mask & (1 << ZONE.cold)) !== 0) cold = 1;
  if (wet === 0 && (mask & (1 << ZONE.wet)) !== 0) wet = 1;
  w.zW[i] = warm; w.zC[i] = cold; w.zWe[i] = wet; w.zWK[i] = wk; w.zCK[i] = ck; w.zWK1[i] = wat; w.zWK2[i] = wind; w.zUK[i] = up;
  // the nap patch or sand patch under it
  let nap = -1, sand = 0;
  for (let k = 0; k < w.nP; k++) {
    if (!inAreaAt(w, 1, k, 0)) continue;
    if (w.pN[k] && nap < 0) nap = k;
    if (w.pSa[k]) sand = 1;
  }
  w.oN[i] = nap; w.oS[i] = sand;
  w.eAO[i] = 0;
}

/** The place-global thing that owns the zone (or patch) the REACT happened in: the snapshot's zoneThing / patchThing first, else ours. */
function zoneThingOf(w: LifeWorld, s: LifeSnapshot, i: number, k: number): number {
  if (s.zoneThing[i] >= 0) return s.zoneThing[i];
  if (k >= 0 && w.zT[k] >= 0) return w.tG[w.zT[k]];
  return -1;
}

/* ───────────────────────────── REACT events ───────────────────────────── */

/** Has character i fired REACT `kind` with `thing` this visit? */
export function reacted(w: LifeWorld, i: number, kind: number, thing: number): boolean {
  const key = kind * 64 + thing + 1, o = i * 48;
  for (let j = 0; j < w.rN[i]; j++) if (w.rK[o + j] === key) return true;
  return false;
}
function markReacted(w: LifeWorld, i: number, kind: number, thing: number): void {
  if (w.rN[i] >= 48) return;
  w.rK[i * 48 + w.rN[i]++] = kind * 64 + thing + 1;
}

/** Emit REACT `kind` for character i with `thing` (once per visit per thing, or per event after its cooldown; force = a lifeAddLook or a
 *  scripted start that always emits). A piece's REACT becomes a PIECES record at each new high of its group's count. Returns true when the
 *  character's REACT happened (emitted or counted). */
export function emitReact(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, i: number, kind: number, thing: number, force: number): boolean {
  const tb = w.f[F.NOW];
  const tr = TRIGGER_OF[kind];
  const visit = tr >= 0 ? TR_VISIT[tr] : 1;
  if (!force) {
    if (visit) { if (reacted(w, i, kind, thing)) return false; }
    else if (tb < w.rC[i * 24 + (kind & 23)]) return false;
  }
  if (visit) { if (!reacted(w, i, kind, thing)) markReacted(w, i, kind, thing); }
  else w.rC[i * 24 + (kind & 23)] = tb + (tr >= 0 ? TR_COOL[tr] : 0);
  if (w.ki[i] === 0) { pushEvent(ev, LIFE_EV.REACT, kind, i, -1, 1, thing); return true; }
  // a piece: count the group's pieces that have this REACT this visit; emit at a new high (D-73)
  const g = w.gr[i];
  let n = 0;
  for (let j = 0; j < CAP; j++) if (w.ac[j] && w.ki[j] !== 0 && w.gr[j] === g && (j === i || reacted(w, j, kind, thing))) n++;
  piecesHigh(w, ev, i, kind, thing, n);
  return true;
}

/** Emit a PIECES record for group of piece i when n is a new high for (kind, thing) this visit. */
export function piecesHigh(w: LifeWorld, ev: LifeEvents, i: number, kind: number, thing: number, n: number): void {
  const g = w.gr[i] & 31, key = kind * 64 + thing + 1, o = g * 8;
  let slot = -1;
  for (let j = 0; j < 8; j++) { if (w.gHK[o + j] === key) { slot = j; break; } if (slot < 0 && w.gHK[o + j] < 0) slot = j + 100; }
  if (slot >= 100) { slot -= 100; w.gHK[o + slot] = key; w.gHN[o + slot] = 0; }
  if (slot < 0) slot = 7;
  if (n <= w.gHN[o + slot]) return;
  w.gHN[o + slot] = n;
  pushEvent(ev, LIFE_EV.PIECES, kind, leaderOf(w, i), -1, n, thing);
}

/** The face piece (or the whole) that leads character i's group. */
export function leaderOf(w: LifeWorld, i: number): number {
  if (w.ki[i] === 0) return i;
  const g = w.gr[i];
  for (let j = 0; j < CAP; j++) if (w.ac[j] && w.ki[j] === 1 && w.gr[j] === g) return j;
  return i;
}

/** Does REACT trigger row tr's place condition hold for character i now (ignoring its time)? The zone index goes to w.f[F.C]. */
function condHolds(w: LifeWorld, s: LifeSnapshot, i: number, tr: number): boolean {
  const fl = s.flags[i], cond = TR_COND[tr];
  w.f[F.C] = -1;
  if (TR_FAM[tr] >= 0 && w.fa[i] !== TR_FAM[tr]) return false;
  switch (cond) {
    case REACT_COND.IN_WATER_FLOAT: w.f[F.C] = w.zWK1[i]; return (w.zWK1[i] >= 0 || (fl & LIFE_FLAG.IN_WATER) !== 0) && (fl & LIFE_FLAG.GROUNDED) === 0;
    case REACT_COND.IN_WATER_WADE: { const k = w.zWK1[i]; w.f[F.C] = k;
      return (k >= 0 ? w.zSu[k] >= TR_MIN[tr] : (fl & LIFE_FLAG.IN_WATER) !== 0) && (fl & LIFE_FLAG.GROUNDED) !== 0; }
    case REACT_COND.IN_ZONE: {
      if (TR_SHIVER[tr] && !SHIVER[w.fa[i]]) return false;
      if (TR_ARG[tr] === ZONE.warm) { w.f[F.C] = w.zWK[i]; return w.zW[i] >= TR_MIN[tr] && w.zW[i] > 0; }
      if (TR_ARG[tr] === ZONE.cold) { w.f[F.C] = w.zCK[i]; return w.zC[i] > 0 && w.zC[i] >= TR_MIN[tr]; }
      return (s.zoneMask[i] & (1 << TR_ARG[tr])) !== 0;
    }
    case REACT_COND.POSE_AT: w.f[F.C] = w.zWK[i]; return w.zW[i] >= TR_MIN[tr] && Math.abs(w.sqS[i] - TR_ARG[tr] * 0.01) < 0.005;
    case REACT_COND.GLOW_WATER: { const k = w.zWK1[i]; w.f[F.C] = k; return k >= 0 && w.zG[k] === 1; }
    case REACT_COND.UPDRAFT: w.f[F.C] = w.zUK[i]; return w.zUK[i] >= 0 && (fl & LIFE_FLAG.AIRBORNE) !== 0;
    case REACT_COND.UNDER_DRIP: return w.zWe[i] > 0 && (s.zoneMask[i] & (1 << ZONE.wet)) !== 0;
    case REACT_COND.FIZZ_ZONE: { for (let k = 0; k < w.nZ; k++) { const t = w.zT[k]; if (t >= 0 && w.tG[t] === 36 && w.zIT[i * MAX_ZONES + k] > -1e8) { w.f[F.C] = k; return true; } } return false; }
    case REACT_COND.NEAR_MAGNET: {
      if (w.fa[i] !== FAM_BEADS) return false;
      for (let k = 0; k < w.nZ; k++) if (w.zK[k] === ZONE.magnet && (s.zoneMask[i] & (1 << ZONE.magnet)) !== 0) {
        const dx = s.x[i] - w.zX[k], dz = s.z[i] - w.zZ[k];
        if (dx * dx + dz * dz <= (TR_MIN[tr] + s.r[i]) * (TR_MIN[tr] + s.r[i])) { w.f[F.C] = k; return true; }
      }
      return false;
    }
    default: return false;
  }
}

/** The time-bound REACT triggers (zone stays, water, airborne, poses): fire whatever behaviour wins (LF-21). LOOK_UP crossings are in
 *  integrateLooks; BEHAVIOUR rows (HOLD_ON, LOVE) are emitted by the behaviour that starts. */
export function reactZones(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW];
  for (let tr = 0; tr < NT; tr++) {
    const cond = TR_COND[tr];
    if (cond === REACT_COND.LOOK_UP || cond === REACT_COND.BEHAVIOUR || cond === REACT_COND.LOOK_DRY || cond === REACT_COND.GLIDE ||
      cond === REACT_COND.LAND_SHALLOW || cond === REACT_COND.CURRENT || cond === REACT_COND.SKY || cond === REACT_COND.FIRST_PRINT) continue;
    if (!condHolds(w, s, i, tr)) continue;
    const k = w.f[F.C] | 0;
    const since = k >= 0 ? w.zIT[i * MAX_ZONES + k] : (cond === REACT_COND.IN_WATER_FLOAT || cond === REACT_COND.IN_WATER_WADE ? w.iWT[i] : w.aT1[i]);
    if (cond === REACT_COND.POSE_AT) { if (tb - w.pT2[i] < 3) continue; }
    else if (TR_FOR[tr] > 0 && (since < -1e8 || tb - since < TR_FOR[tr] - 1e-6)) continue;
    const thing = TR_THING[tr] === 0 ? zoneThingOf(w, s, i, k) : TR_THING[tr] === 1 ? s.patchThing[i] : -1;
    emitReact(w, s, ev, i, TR_KIND[tr], thing, 0);
  }
  // a landing in shallow water (SPLASH)
  const air = (s.flags[i] & LIFE_FLAG.AIRBORNE) !== 0 ? 1 : 0;
  if (w.pA[i] && !air && w.zWK1[i] >= 0 && w.zSu[w.zWK1[i]] < 0.12) emitReact(w, s, ev, i, REACT_KIND.SPLASH, zoneThingOf(w, s, i, w.zWK1[i]), 0);
  w.pA[i] = air;
}

/* ───────────────────────────── needs and looks ───────────────────────────── */

/** Integrate character i's needs and looks over dt (s of sim time) and emit the looks' REACT crossings (LIFE 3, 3.1). */
export function integrate(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, i: number): void {
  const tb = w.f[F.NOW], dt = w.f[F.DT];
  const fl = s.flags[i], held = (fl & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.LOCKED)) !== 0;
  const t5 = i * 5, napping = w.beh[i] === 6 && w.ph[i] >= 2;
  const fam = w.fa[i];
  // water and airborne timers
  const inWater = w.zWK1[i] >= 0 || (fl & LIFE_FLAG.IN_WATER) !== 0;
  if (inWater) { if (w.iWT[i] < -1e8) w.iWT[i] = tb; } else w.iWT[i] = -1e9;
  if ((fl & LIFE_FLAG.AIRBORNE) !== 0) { if (w.aT1[i] < -1e8) w.aT1[i] = tb; } else w.aT1[i] = -1e9;
  if (w.ki[i] !== 2 && !(w.ki[i] === 1 && w.cT[w.gr[i] & 31] > tb - 2)) {
    // play
    if (!held && !napping) w.pl[i] = Math.min(1, w.pl[i] + NEEDS.play.rise * (0.5 + w.tr[t5 + TRAIT.bouncy]) * dt);
    // company: nobody within 2 m
    let near = false;
    for (let j = 0; j < CAP; j++) {
      if (j === i || !w.ac[j] || j >= s.n) continue;
      const dx = s.x[j] - s.x[i], dz = s.z[j] - s.z[i];
      if (dx * dx + dz * dz < 4) { near = true; break; }
    }
    if (!near) w.co[i] = Math.min(1, w.co[i] + NEEDS.company.rise * (0.5 + w.tr[t5 + TRAIT.chatty]) * dt);
  }
  // rest: x1.5 in a warm zone or on a nap spot; napping falls (twice as fast on a nap spot)
  if (napping) w.re[i] = Math.max(0, w.re[i] + NEEDS.rest.nap * (w.oN[i] >= 0 ? 2 : 1) * dt);
  else if (!held) {
    const active = w.mo[i] ? NEEDS.rest.riseActive : NEEDS.rest.rise;
    const k = w.zW[i] > 0 || w.oN[i] >= 0 ? NEEDS.rest.warmFactor : 1;
    w.re[i] = Math.min(1, w.re[i] + active * (0.5 + w.tr[t5 + TRAIT.dozy]) * k * dt);
  }
  // looks (only while the rising cause is absent does a look fall)
  const o = i * 6, warm = w.zW[i], cold = w.zC[i], moving = Math.abs(s.vx[i]) + Math.abs(s.vz[i]) > 0.05;
  const L = w.lo;
  const before0 = L[o], before2 = L[o + 2], before4 = L[o + 4], before5 = L[o + 5], before1 = L[o + 1];
  // frost
  if (cold > 0) L[o] = Math.min(LOOK_RATES.frost.cap, L[o] + LOOK_RATES.frost.rise * cold * dt);
  else L[o] = Math.max(0, L[o] - (warm > 0 ? LOOK_RATES.frost.fallWarm : LOOK_RATES.frost.fall) * dt);
  // wet: rain, a shower, a splash spot or water
  const wetCause = w.zWe[i] > 0 || inWater;
  if (wetCause) L[o + 1] = Math.min(1, L[o + 1] + LOOK_RATES.wet.rise * dt);
  else L[o + 1] = Math.max(0, L[o + 1] - (warm > 0 ? LOOK_RATES.wet.fallWarm : LOOK_RATES.wet.fall) * dt);
  // soak (foams) in water or rain
  if (SOAK[fam] > 0 && wetCause) L[o + 2] = Math.min(1, L[o + 2] + SOAK[fam] * dt);
  else L[o + 2] = Math.max(0, L[o + 2] - (warm > 0 ? LOOK_RATES.soak.fallWarm : LOOK_RATES.soak.fall) * dt);
  // sand: on sand while moving
  if (w.oS[i] && moving) L[o + 3] = Math.min(LOOK_RATES.sand.cap, L[o + 3] + LOOK_RATES.sand.rise * dt);
  else L[o + 3] = Math.max(0, L[o + 3] - LOOK_RATES.sand.fall * dt);
  // snow: falls while moving and in a warm zone (rises only on snow, S2)
  if (moving) L[o + 4] = Math.max(0, L[o + 4] - LOOK_RATES.snow.fall * dt);
  else if (warm > 0) L[o + 4] = Math.max(0, L[o + 4] - LOOK_RATES.snow.fallWarm * dt);
  // toast: families with toast, up to 0.75 x the warmth where it stands
  if (TOAST[fam]) {
    if (warm > 0) { const cap = LOOK_RATES.toast.cap * warm; if (L[o + 5] < cap) L[o + 5] = Math.min(cap, L[o + 5] + LOOK_RATES.toast.rise * warm * dt); }
    else L[o + 5] = Math.max(0, L[o + 5] - LOOK_RATES.toast.fall * dt);
  }
  // REACT at the 0.5 crossing (once per visit, thing = its zone; SNOWCAP's natural crossing has no source: -1)
  if (before0 < 0.5 && L[o] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.FROST, zoneThingOf(w, s, i, w.zCK[i]), 0);
  if (before2 < 0.5 && L[o + 2] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.SOAK, w.zWe[i] > 0 && w.zWK1[i] < 0 ? -1 : zoneThingOf(w, s, i, w.zWK1[i]), 0);
  if (before4 < 0.5 && L[o + 4] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.SNOWCAP, -1, 0);
  if (before5 < 0.5 && L[o + 5] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.TOAST, zoneThingOf(w, s, i, w.zWK[i]), 0);
  // DRY: soak or wet falls under 0.1 inside a warm zone after reaching 0.5
  if (L[o + 1] >= 0.5) w.lH[i] |= 2;
  if (L[o + 2] >= 0.5) w.lH[i] |= 4;
  if (warm > 0 && (((w.lH[i] & 2) && before1 >= 0.1 && L[o + 1] < 0.1) || ((w.lH[i] & 4) && before2 >= 0.1 && L[o + 2] < 0.1))) {
    emitReact(w, s, ev, i, REACT_KIND.DRY, zoneThingOf(w, s, i, w.zWK[i]), 0);
  }
}

/** lifeAddLook (3.1): add to a look now; its REACT is emitted at the next lifeStep, every time, with the source thing. */
export function addLook(w: LifeWorld, slot: number, look: number, amount: number, thing: number): void {
  if (slot < 0 || slot >= CAP || look < 0 || look > 5) return;
  const o = slot * 6 + look, cap = look === LOOK.sand ? LOOK_RATES.sand.cap : 1;
  const before = w.lo[o];
  w.lo[o] = Math.max(0, Math.min(cap, before + amount));
  if (amount > 0 && LOOK_REACT[look] > 0 && w.pN1 < 16) {
    const p = w.pN1++;
    w.pSl[p] = slot; w.pKi[p] = LOOK_REACT[look]; w.pTh[p] = thing;
  }
}

/** Reset a character's needs and looks (it came out: a trip or the shelf; never a ceremony). */
export function resetNeedsLooks(w: LifeWorld, i: number): void {
  w.pl[i] = NEEDS.start.play; w.co[i] = NEEDS.start.company; w.re[i] = NEEDS.start.rest;
  for (let j = 0; j < 6; j++) w.lo[i * 6 + j] = 0;
  w.lH[i] = 0;
}

/** The cut inside a zone (D-73): at the cut, each zone REACT the new group stands in, once, as PIECES with the pieces inside it. */
export function cutReacts(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, g: number): void {
  let lead = -1;
  for (let j = 0; j < CAP; j++) if (w.ac[j] && w.ki[j] !== 0 && w.gr[j] === g && j < s.n) { senseZonesAtOnce(w, s, j); if (lead < 0 || w.ki[j] === 1) lead = j; }
  if (lead < 0) return;
  for (let tr = 0; tr < NT; tr++) {
    const cond = TR_COND[tr];
    if (cond !== REACT_COND.IN_ZONE && cond !== REACT_COND.IN_WATER_FLOAT && cond !== REACT_COND.IN_WATER_WADE && cond !== REACT_COND.GLOW_WATER && cond !== REACT_COND.FIZZ_ZONE) continue;
    let n = 0, thing = -1;
    for (let j = 0; j < CAP; j++) {
      if (!w.ac[j] || w.ki[j] === 0 || w.gr[j] !== g || j >= s.n) continue;
      if (!condHolds(w, s, j, tr)) continue;
      const k = w.f[F.C] | 0;
      const th = zoneThingOf(w, s, j, k);
      if (n === 0) thing = th;
      if (th !== thing) continue;
      n++;
      if (!reacted(w, j, TR_KIND[tr], th)) markReacted(w, j, TR_KIND[tr], th);
    }
    if (n > 0) piecesHigh(w, ev, lead, TR_KIND[tr], thing, n);
  }
}
function senseZonesAtOnce(w: LifeWorld, s: LifeSnapshot, j: number): void {
  w.eAO[j] = 1;
  senseZones(w, s, j);
}
