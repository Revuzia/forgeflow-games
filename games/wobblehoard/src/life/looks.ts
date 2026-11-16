// Needs (LIFE.md 3), looks (3.1, LOOK_RATES) and the REACT events by REACT_TRIGGERS (4.2; D-72, D-73): integrated on every think of every
// character whatever behaviour wins (LF-20, LF-21). A piece's REACT becomes its group's PIECES record at each new high of the group's count
// (9, LF-22). Owned by PG_LIFE.
import type { LifeSnapshot, LifeEvents } from '../contracts.ts';
import { LOOK, LOOK_RATES, NEEDS, FAMILY_REACT, REACT_TRIGGERS, REACT_COND, REACT_KIND, LIFE_EV, LIFE_FLAG } from '../data/life.ts';
import { ZONE } from '../data/places.ts';
import { MATERIAL_FAMILY_IDS } from '../data/materials.ts';
import type { LifeWorld } from './world.ts';
import { CAP, F, inArea, zoneStrengthAt, pushEvent, MAX_ZONES } from './world.ts';
import { TRAIT } from './traits.ts';

/** Per family: soak rate, toast, shiver, warm pose (flat). */
const SOAK = new Float32Array(12), TOAST = new Uint8Array(12), SHIVER = new Uint8Array(12), WARMPOSE = new Float32Array(12);
for (let f = 0; f < 12; f++) {
  const r = FAMILY_REACT[MATERIAL_FAMILY_IDS[f]];
  SOAK[f] = r.soakRate; TOAST[f] = r.toast ? 1 : 0; SHIVER[f] = r.shiver ? 1 : 0; WARMPOSE[f] = r.warmPose;
}
export { WARMPOSE, TOAST, SHIVER };
const FAM_MOCHI = MATERIAL_FAMILY_IDS.indexOf('mochidough'), FAM_SLIME = MATERIAL_FAMILY_IDS.indexOf('slimegoo'), FAM_BEADS = MATERIAL_FAMILY_IDS.indexOf('beadsqueeze');
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

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ───────────────────────────── zone sensing ───────────────────────────── */

/** Which zones character i stands in (its centre), how warm, cold and wet it is there, and a B15 entry due (first entry this visit). */
export function senseZones(w: LifeWorld, s: LifeSnapshot, i: number, tb: number): void {
  const x = s.x[i], z = s.z[i], mask = s.zoneMask[i];
  let warm = 0, cold = 0, wet = 0, wk = -1, ck = -1, wat = -1, wind = -1, up = -1;
  for (let k = 0; k < w.nZones && k < MAX_ZONES; k++) {
    zoneStrengthAt(w, k, x, z);
    const st = w.f[F.S], o = i * MAX_ZONES + k, kind = w.zoneKind[k];
    const inside = st > 0 || (inArea(w.zoneShape[k], w.zoneX[k], w.zoneZ[k], w.zoneR[k], w.zoneHX[k], w.zoneHZ[k], w.zoneYaw[k], x, z, 0) && (mask & (1 << kind)) !== 0);
    if (!inside) { w.zoneInT[o] = -1e9; continue; }
    if (w.zoneInT[o] < -1e8) {
      w.zoneInT[o] = w.enterAtOnce[i] ? tb - 100 : tb;
      const bit = 1 << k;
      if ((w.zoneSeen[i] & bit) === 0 && (kind === ZONE.warm || kind === ZONE.cold || kind === ZONE.wet || kind === ZONE.water || kind === ZONE.wind)) {
        w.zoneSeen[i] |= bit; w.b15Zone[i] = k + 1;
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
  w.zWarm[i] = warm; w.zCold[i] = cold; w.zWet[i] = wet; w.zWarmK[i] = wk; w.zColdK[i] = ck; w.zWaterK[i] = wat; w.zWindK[i] = wind; w.zUpK[i] = up;
  // the nap patch or sand patch under it
  let nap = -1, sand = 0;
  for (let k = 0; k < w.nPatches; k++) {
    if (!inArea(w.patchShape[k], w.patchX[k], w.patchZ[k], w.patchR[k], w.patchHX[k], w.patchHZ[k], w.patchYaw[k], x, z, 0)) continue;
    if (w.patchNap[k] && nap < 0) nap = k;
    if (w.patchSand[k]) sand = 1;
  }
  w.onNap[i] = nap; w.onSand[i] = sand;
  w.enterAtOnce[i] = 0;
}

/** The place-global thing that owns the zone (or patch) the REACT happened in: the snapshot's zoneThing / patchThing first, else ours. */
function zoneThingOf(w: LifeWorld, s: LifeSnapshot, i: number, k: number): number {
  if (s.zoneThing[i] >= 0) return s.zoneThing[i];
  if (k >= 0 && w.zoneThing[k] >= 0) return w.thingGlobal[w.zoneThing[k]];
  return -1;
}

/* ───────────────────────────── REACT events ───────────────────────────── */

/** Has character i fired REACT `kind` with `thing` this visit? */
export function reacted(w: LifeWorld, i: number, kind: number, thing: number): boolean {
  const key = kind * 64 + thing + 1, o = i * 48;
  for (let j = 0; j < w.reactN[i]; j++) if (w.reactKey[o + j] === key) return true;
  return false;
}
function markReacted(w: LifeWorld, i: number, kind: number, thing: number): void {
  if (w.reactN[i] >= 48) return;
  w.reactKey[i * 48 + w.reactN[i]++] = kind * 64 + thing + 1;
}

/** Emit REACT `kind` for character i with `thing` (once per visit per thing, or per event after its cooldown; force = a lifeAddLook or a
 *  scripted start that always emits). A piece's REACT becomes a PIECES record at each new high of its group's count. Returns true when the
 *  character's REACT happened (emitted or counted). */
export function emitReact(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, i: number, kind: number, thing: number, tb: number, force: number): boolean {
  const tr = TRIGGER_OF[kind];
  const visit = tr >= 0 ? TR_VISIT[tr] : 1;
  if (!force) {
    if (visit) { if (reacted(w, i, kind, thing)) return false; }
    else if (tb < w.reactCool[i * 24 + (kind & 23)]) return false;
  }
  if (visit) { if (!reacted(w, i, kind, thing)) markReacted(w, i, kind, thing); }
  else w.reactCool[i * 24 + (kind & 23)] = tb + (tr >= 0 ? TR_COOL[tr] : 0);
  if (w.kind[i] === 0) { pushEvent(ev, LIFE_EV.REACT, kind, i, -1, 1, thing); return true; }
  // a piece: count the group's pieces that have this REACT this visit; emit at a new high (D-73)
  const g = w.group[i];
  let n = 0;
  for (let j = 0; j < CAP; j++) if (w.active[j] && w.kind[j] !== 0 && w.group[j] === g && (j === i || reacted(w, j, kind, thing))) n++;
  piecesHigh(w, ev, i, kind, thing, n);
  return true;
}

/** Emit a PIECES record for group of piece i when n is a new high for (kind, thing) this visit. */
export function piecesHigh(w: LifeWorld, ev: LifeEvents, i: number, kind: number, thing: number, n: number): void {
  const g = w.group[i] & 31, key = kind * 64 + thing + 1, o = g * 8;
  let slot = -1;
  for (let j = 0; j < 8; j++) { if (w.groupHighKey[o + j] === key) { slot = j; break; } if (slot < 0 && w.groupHighKey[o + j] < 0) slot = j + 100; }
  if (slot >= 100) { slot -= 100; w.groupHighKey[o + slot] = key; w.groupHighN[o + slot] = 0; }
  if (slot < 0) slot = 7;
  if (n <= w.groupHighN[o + slot]) return;
  w.groupHighN[o + slot] = n;
  pushEvent(ev, LIFE_EV.PIECES, kind, leaderOf(w, i), -1, n, thing);
}

/** The face piece (or the whole) that leads character i's group. */
export function leaderOf(w: LifeWorld, i: number): number {
  if (w.kind[i] === 0) return i;
  const g = w.group[i];
  for (let j = 0; j < CAP; j++) if (w.active[j] && w.kind[j] === 1 && w.group[j] === g) return j;
  return i;
}

/** Does REACT trigger row tr's place condition hold for character i now (ignoring its time)? The zone index goes to w.f[F.C]. */
function condHolds(w: LifeWorld, s: LifeSnapshot, i: number, tr: number): boolean {
  const fl = s.flags[i], cond = TR_COND[tr];
  w.f[F.C] = -1;
  if (TR_FAM[tr] >= 0 && w.family[i] !== TR_FAM[tr]) return false;
  switch (cond) {
    case REACT_COND.IN_WATER_FLOAT: w.f[F.C] = w.zWaterK[i]; return (w.zWaterK[i] >= 0 || (fl & LIFE_FLAG.IN_WATER) !== 0) && (fl & LIFE_FLAG.GROUNDED) === 0;
    case REACT_COND.IN_WATER_WADE: { const k = w.zWaterK[i]; w.f[F.C] = k;
      return (k >= 0 ? w.zoneSurf[k] >= TR_MIN[tr] : (fl & LIFE_FLAG.IN_WATER) !== 0) && (fl & LIFE_FLAG.GROUNDED) !== 0; }
    case REACT_COND.IN_ZONE: {
      if (TR_SHIVER[tr] && !SHIVER[w.family[i]]) return false;
      if (TR_ARG[tr] === ZONE.warm) { w.f[F.C] = w.zWarmK[i]; return w.zWarm[i] >= TR_MIN[tr] && w.zWarm[i] > 0; }
      if (TR_ARG[tr] === ZONE.cold) { w.f[F.C] = w.zColdK[i]; return w.zCold[i] > 0 && w.zCold[i] >= TR_MIN[tr]; }
      return (s.zoneMask[i] & (1 << TR_ARG[tr])) !== 0;
    }
    case REACT_COND.POSE_AT: w.f[F.C] = w.zWarmK[i]; return w.zWarm[i] >= TR_MIN[tr] && Math.abs(w.sqS[i] - TR_ARG[tr] * 0.01) < 0.005;
    case REACT_COND.GLOW_WATER: { const k = w.zWaterK[i]; w.f[F.C] = k; return k >= 0 && w.zoneGlow[k] === 1; }
    case REACT_COND.UPDRAFT: w.f[F.C] = w.zUpK[i]; return w.zUpK[i] >= 0 && (fl & LIFE_FLAG.AIRBORNE) !== 0;
    case REACT_COND.UNDER_DRIP: return w.zWet[i] > 0 && (s.zoneMask[i] & (1 << ZONE.wet)) !== 0;
    case REACT_COND.FIZZ_ZONE: { for (let k = 0; k < w.nZones; k++) { const t = w.zoneThing[k]; if (t >= 0 && w.thingGlobal[t] === 36 && w.zoneInT[i * MAX_ZONES + k] > -1e8) { w.f[F.C] = k; return true; } } return false; }
    case REACT_COND.NEAR_MAGNET: {
      if (w.family[i] !== FAM_BEADS) return false;
      for (let k = 0; k < w.nZones; k++) if (w.zoneKind[k] === ZONE.magnet && (s.zoneMask[i] & (1 << ZONE.magnet)) !== 0) {
        const dx = s.x[i] - w.zoneX[k], dz = s.z[i] - w.zoneZ[k];
        if (dx * dx + dz * dz <= (TR_MIN[tr] + s.r[i]) * (TR_MIN[tr] + s.r[i])) { w.f[F.C] = k; return true; }
      }
      return false;
    }
    default: return false;
  }
}

/** The time-bound REACT triggers (zone stays, water, airborne, poses): fire whatever behaviour wins (LF-21). LOOK_UP crossings are in
 *  integrateLooks; BEHAVIOUR rows (HOLD_ON, LOVE) are emitted by the behaviour that starts. */
export function reactZones(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, i: number, tb: number): void {
  for (let tr = 0; tr < NT; tr++) {
    const cond = TR_COND[tr];
    if (cond === REACT_COND.LOOK_UP || cond === REACT_COND.BEHAVIOUR || cond === REACT_COND.LOOK_DRY || cond === REACT_COND.GLIDE ||
      cond === REACT_COND.LAND_SHALLOW || cond === REACT_COND.CURRENT || cond === REACT_COND.SKY || cond === REACT_COND.FIRST_PRINT) continue;
    if (!condHolds(w, s, i, tr)) continue;
    const k = w.f[F.C] | 0;
    const since = k >= 0 ? w.zoneInT[i * MAX_ZONES + k] : (cond === REACT_COND.IN_WATER_FLOAT || cond === REACT_COND.IN_WATER_WADE ? w.inWaterT[i] : w.airT[i]);
    if (cond === REACT_COND.POSE_AT) { if (tb - w.poseT[i] < 3) continue; }
    else if (TR_FOR[tr] > 0 && (since < -1e8 || tb - since < TR_FOR[tr] - 1e-6)) continue;
    const thing = TR_THING[tr] === 0 ? zoneThingOf(w, s, i, k) : TR_THING[tr] === 1 ? s.patchThing[i] : -1;
    emitReact(w, s, ev, i, TR_KIND[tr], thing, tb, 0);
  }
  // a landing in shallow water (SPLASH)
  const air = (s.flags[i] & LIFE_FLAG.AIRBORNE) !== 0 ? 1 : 0;
  if (w.prevAir[i] && !air && w.zWaterK[i] >= 0 && w.zoneSurf[w.zWaterK[i]] < 0.12) emitReact(w, s, ev, i, REACT_KIND.SPLASH, zoneThingOf(w, s, i, w.zWaterK[i]), tb, 0);
  w.prevAir[i] = air;
}

/* ───────────────────────────── needs and looks ───────────────────────────── */

/** Integrate character i's needs and looks over dt (s of sim time) and emit the looks' REACT crossings (LIFE 3, 3.1). */
export function integrate(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, i: number, tb: number, dt: number): void {
  const fl = s.flags[i], held = (fl & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.LOCKED)) !== 0;
  const t5 = i * 5, napping = w.beh[i] === 6 && w.phase[i] >= 2;
  const fam = w.family[i];
  // water and airborne timers
  const inWater = w.zWaterK[i] >= 0 || (fl & LIFE_FLAG.IN_WATER) !== 0;
  if (inWater) { if (w.inWaterT[i] < -1e8) w.inWaterT[i] = tb; } else w.inWaterT[i] = -1e9;
  if ((fl & LIFE_FLAG.AIRBORNE) !== 0) { if (w.airT[i] < -1e8) w.airT[i] = tb; } else w.airT[i] = -1e9;
  if (w.kind[i] !== 2 && !(w.kind[i] === 1 && w.cutT[w.group[i] & 31] > tb - 2)) {
    // play
    if (!held && !napping) w.play[i] = clamp01(w.play[i] + NEEDS.play.rise * (0.5 + w.traits[t5 + TRAIT.bouncy]) * dt);
    // company: nobody within 2 m
    let near = false;
    for (let j = 0; j < CAP; j++) {
      if (j === i || !w.active[j] || j >= s.n) continue;
      const dx = s.x[j] - s.x[i], dz = s.z[j] - s.z[i];
      if (dx * dx + dz * dz < 4) { near = true; break; }
    }
    if (!near) w.company[i] = clamp01(w.company[i] + NEEDS.company.rise * (0.5 + w.traits[t5 + TRAIT.chatty]) * dt);
  }
  // rest: x1.5 in a warm zone or on a nap spot; napping falls (twice as fast on a nap spot)
  if (napping) w.rest[i] = clamp01(w.rest[i] + NEEDS.rest.nap * (w.onNap[i] >= 0 ? 2 : 1) * dt);
  else if (!held) {
    const active = w.moving[i] ? NEEDS.rest.riseActive : NEEDS.rest.rise;
    const k = w.zWarm[i] > 0 || w.onNap[i] >= 0 ? NEEDS.rest.warmFactor : 1;
    w.rest[i] = clamp01(w.rest[i] + active * (0.5 + w.traits[t5 + TRAIT.dozy]) * k * dt);
  }
  // looks (only while the rising cause is absent does a look fall)
  const o = i * 6, warm = w.zWarm[i], cold = w.zCold[i], moving = Math.abs(s.vx[i]) + Math.abs(s.vz[i]) > 0.05;
  const L = w.looks;
  const before0 = L[o], before2 = L[o + 2], before4 = L[o + 4], before5 = L[o + 5], before1 = L[o + 1];
  // frost
  if (cold > 0) L[o] = Math.min(LOOK_RATES.frost.cap, L[o] + LOOK_RATES.frost.rise * cold * dt);
  else L[o] = Math.max(0, L[o] - (warm > 0 ? LOOK_RATES.frost.fallWarm : LOOK_RATES.frost.fall) * dt);
  // wet: rain, a shower, a splash spot or water
  const wetCause = w.zWet[i] > 0 || inWater;
  if (wetCause) L[o + 1] = Math.min(1, L[o + 1] + LOOK_RATES.wet.rise * dt);
  else L[o + 1] = Math.max(0, L[o + 1] - (warm > 0 ? LOOK_RATES.wet.fallWarm : LOOK_RATES.wet.fall) * dt);
  // soak (foams) in water or rain
  if (SOAK[fam] > 0 && wetCause) L[o + 2] = Math.min(1, L[o + 2] + SOAK[fam] * dt);
  else L[o + 2] = Math.max(0, L[o + 2] - (warm > 0 ? LOOK_RATES.soak.fallWarm : LOOK_RATES.soak.fall) * dt);
  // sand: on sand while moving
  if (w.onSand[i] && moving) L[o + 3] = Math.min(LOOK_RATES.sand.cap, L[o + 3] + LOOK_RATES.sand.rise * dt);
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
  if (before0 < 0.5 && L[o] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.FROST, zoneThingOf(w, s, i, w.zColdK[i]), tb, 0);
  if (before2 < 0.5 && L[o + 2] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.SOAK, w.zWet[i] > 0 && w.zWaterK[i] < 0 ? -1 : zoneThingOf(w, s, i, w.zWaterK[i]), tb, 0);
  if (before4 < 0.5 && L[o + 4] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.SNOWCAP, -1, tb, 0);
  if (before5 < 0.5 && L[o + 5] >= 0.5) emitReact(w, s, ev, i, REACT_KIND.TOAST, zoneThingOf(w, s, i, w.zWarmK[i]), tb, 0);
  // DRY: soak or wet falls under 0.1 inside a warm zone after reaching 0.5
  if (L[o + 1] >= 0.5) w.lookHigh[i] |= 2;
  if (L[o + 2] >= 0.5) w.lookHigh[i] |= 4;
  if (warm > 0 && (((w.lookHigh[i] & 2) && before1 >= 0.1 && L[o + 1] < 0.1) || ((w.lookHigh[i] & 4) && before2 >= 0.1 && L[o + 2] < 0.1))) {
    emitReact(w, s, ev, i, REACT_KIND.DRY, zoneThingOf(w, s, i, w.zWarmK[i]), tb, 0);
  }
  if (FAM_MOCHI < 0 || FAM_SLIME < 0) return;
}

/** lifeAddLook (3.1): add to a look now; its REACT is emitted at the next lifeStep, every time, with the source thing. */
export function addLook(w: LifeWorld, slot: number, look: number, amount: number, thing: number): void {
  if (slot < 0 || slot >= CAP || look < 0 || look > 5) return;
  const o = slot * 6 + look, cap = look === LOOK.sand ? LOOK_RATES.sand.cap : 1;
  const before = w.looks[o];
  w.looks[o] = Math.max(0, Math.min(cap, before + amount));
  if (amount > 0 && LOOK_REACT[look] > 0 && w.pendN < 16) {
    const p = w.pendN++;
    w.pendSlot[p] = slot; w.pendKind[p] = LOOK_REACT[look]; w.pendThing[p] = thing;
  }
}

/** Reset a character's needs and looks (it came out: a trip or the shelf; never a ceremony). */
export function resetNeedsLooks(w: LifeWorld, i: number): void {
  w.play[i] = NEEDS.start.play; w.company[i] = NEEDS.start.company; w.rest[i] = NEEDS.start.rest;
  for (let j = 0; j < 6; j++) w.looks[i * 6 + j] = 0;
  w.lookHigh[i] = 0;
}

/** The cut inside a zone (D-73): at the cut, each zone REACT the new group stands in, once, as PIECES with the pieces inside it. */
export function cutReacts(w: LifeWorld, s: LifeSnapshot, ev: LifeEvents, g: number, tb: number): void {
  let lead = -1;
  for (let j = 0; j < CAP; j++) if (w.active[j] && w.kind[j] !== 0 && w.group[j] === g && j < s.n) { senseZonesAtOnce(w, s, j, tb); if (lead < 0 || w.kind[j] === 1) lead = j; }
  if (lead < 0) return;
  for (let tr = 0; tr < NT; tr++) {
    const cond = TR_COND[tr];
    if (cond !== REACT_COND.IN_ZONE && cond !== REACT_COND.IN_WATER_FLOAT && cond !== REACT_COND.IN_WATER_WADE && cond !== REACT_COND.GLOW_WATER && cond !== REACT_COND.FIZZ_ZONE) continue;
    let n = 0, thing = -1;
    for (let j = 0; j < CAP; j++) {
      if (!w.active[j] || w.kind[j] === 0 || w.group[j] !== g || j >= s.n) continue;
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
function senseZonesAtOnce(w: LifeWorld, s: LifeSnapshot, j: number, tb: number): void {
  w.enterAtOnce[j] = 1;
  senseZones(w, s, j, tb);
}
