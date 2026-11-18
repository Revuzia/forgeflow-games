// PG_QUESTS round 3: the Journal rows that need PG_LIFE's real lifeStep (PLAYGROUND_BUILD 18: QU-13, QU-03's gate half, QU-08's producer half,
// the friend wish's reducer side, EC-02's LIFE part) on a KINEMATIC node host: no physics, no shell, no browser.
// The host below (Sim, watchGate, runWatched, cabin, home) is copied verbatim from PG_LIFE's _harness/probe_life.ts (round 2, engineer 3) so
// this probe drives LIFE exactly as LIFE's own rows do; what is new here is the ring writer (LIFE events -> the PlayEventRing, by the host
// conventions of PG_LIFE.md and PG_QUESTS.md) and the real collection + journal it feeds. What this host cannot show: real contacts (a ride
// the player sets is a flag, a ball roll is a push rule), the shell's own producers (VISIT, BRING, TOUCH, PHOTO, UI are written as the
// scripted player's records), real SoftBodies.
// QC (round 3, R3b): QU-14's LIFE half, the real lifeStep at the 8 S2 / S3 places against journal.ts PLACE_CAPS and THING_PLACE.
// Run: node _harness/probe_pg_lifequests.ts   (exit 1 on any failure; about 9 s)
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LifeSnapshot, LifeIntents, LifeEvents, PlayEventRing } from '../src/contracts.ts';
import type { Genome } from '../src/core/genome.ts';
import { speciesBaseGenome, CATALOG } from '../src/data/catalog.ts';
import { SPECIES } from '../src/data/species.ts';
import type { PlaceDef } from '../src/data/places.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import { THING_IDS, ZONE, MECH, PLACE_IDS, placeDropped } from '../src/data/places.ts';
import { PLACE_CAPS, THING_PLACE, PLACE_OPENS_AT } from '../src/collection/journal.ts';
import { PLACE as RIPPLE } from '../src/data/place_ripple.ts';
import { Sim as LSim } from './life_host.ts';
import { buildQuestDefs, createQuestState } from '../src/core/quests.ts';
import { LOOK, REACT_TRIGGERS, SOCIAL as SOCIAL_TABLE } from '../src/data/life.ts';
import { PIECES_USE } from '../src/data/quests.ts';
import { THING_KINDS, DROPPED_PLACE_MASK } from '../src/data/places.ts';
import { PLACE as LANTERNROOF_D } from '../src/data/place_lanternroof.ts';
import { PLACE as CLOUDLOFT_D } from '../src/data/place_cloudloft.ts';
import { INTENT, LIFE_FLAG, LIFE_EV, SCRIPT, TOUCH, REACT_KIND, SOCIAL_KIND, WISH_KIND, THING_KIND, USE_VERB, SPECIES_LIFE as SPECIES_LIFE_T } from '../src/data/life.ts';
import { WISH_STATE, EV, BY, QUESTS, FACT, UI_KIND, EV_FLAG, CHAPTERS } from '../src/data/quests.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';
import { createLifeWorld, lifeSetPlace, lifeSetHome, lifeAdd, lifeRemove, lifeStep, lifeScript, lifeSetJournal, lifeSetPair, lifeSetFriends, lifeWishOf,
  moverCapOf, unitCapOf } from '../src/life/step.ts';
import type { LifeWorld } from '../src/life/step.ts';
import { mulberry32 } from '../src/core/rng.ts';
import type { StorageLike } from '../src/core/settings.ts';
import { createCollection } from '../src/collection/index.ts';
import type { Collection, CollectionEvent } from '../src/collection/index.ts';
import { attachJournal } from '../src/collection/journal_store.ts';
import type { JournalRuntime } from '../src/collection/journal_store.ts';
import { SC, isDone, isShown, questProgress, markDone, friendMaskOf, AUTONOMY_ONLY_SOCIALS, createQuestOut, applyEventFields, setQuestDay, FR_ROWS } from '../src/core/quests.ts';

let fails = 0, oks = 0;
const check = (id: string, what: string, ok: boolean, detail = ''): void => {
  if (ok) oks++; else fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${detail ? `: ${detail}` : ''}`);
};

/* ───────────────────────────── fixtures ───────────────────────────── */

function mkSnapshot(): LifeSnapshot {
  const n = 16;
  return { n: 0, t: 0, place: 0, tier: 1, phone: false, calm: false, reducedMotion: false, autonomy: true, quiet: false, units: 0, musicField: 0, musicOn: true,
    musicBoxOn: false, beatPhase: 0, kind: new Uint8Array(n), group: new Int8Array(n), species: new Uint8Array(n), family: new Uint8Array(n),
    frac: new Float32Array(n).fill(1), r: new Float32Array(n).fill(0.5), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    vx: new Float32Array(n), vz: new Float32Array(n), sx: new Float32Array(n).fill(0.5), sy: new Float32Array(n).fill(0.5), flags: new Uint16Array(n),
    zoneMask: new Uint16Array(n), submerged: new Float32Array(n), warmth: new Uint8Array(n), zoneThing: new Int16Array(n).fill(-1),
    patchThing: new Int16Array(n).fill(-1), nThings: 0, thingId: new Int16Array(32), thingX: new Float32Array(32), thingZ: new Float32Array(32),
    thingState: new Float32Array(32), thingBusy: new Uint8Array(32), nBumps: 0, bumpA: new Int8Array(32), bumpB: new Int8Array(32), touchKind: new Int8Array(n).fill(-1) };
}
function mkIntents(): LifeIntents {
  const n = 64;
  return { n: 0, kind: new Uint8Array(n), who: new Uint8Array(n), delayS: new Float32Array(n), a: new Float32Array(n), b: new Float32Array(n), c: new Float32Array(n),
    d: new Float32Array(n), e: new Float32Array(n), icon: new Uint8Array(n), style: new Uint8Array(n), prio: new Float32Array(n), groupKey: new Int16Array(n), dots: new Uint8Array(n) };
}
function mkEvents(): LifeEvents {
  const n = 32;
  return { n: 0, kind: new Uint8Array(n), sub: new Uint8Array(n), a: new Uint8Array(n), b: new Uint8Array(n), n2: new Uint8Array(n), thing: new Int8Array(n) };
}
const G = (id: string, seed = 7): Genome => speciesBaseGenome(id as Genome['species'], seed);
const SP = (id: string): number => SPECIES.indexOf(id as (typeof SPECIES)[number]);
const TID = (id: string): number => THING_IDS.indexOf(id as (typeof THING_IDS)[number]);

/** A tiny kinematic host: it applies SCOOT, HOP, SETTLE and CANCEL, rolls the ball, fills the snapshot (rows = slots), computes the units
 *  (awake whole 1.0, piece 0.22, sleeper 0.03), puts still bodies to sleep after 1.5 s, and logs every intent and event. */
interface Body { on: boolean; x: number; z: number; vx: number; vz: number; r: number; tx: number; tz: number; sp: number; scoot: boolean; air: number;
  still: number; asleep: boolean; kind: number; group: number; species: number; family: number; flags: number; frac: number; homeX: number; homeZ: number;
  /** in a water zone this body floats (not grounded), as the physics' float table says for its family (S2) */
  float: boolean }
interface Log { t: number; kind: number; who: number; a: number; b: number; c: number; d: number; e: number; icon: number; style: number; delay: number }
interface EvLog { t: number; kind: number; sub: number; a: number; b: number; n2: number; thing: number }
class Sim {
  w: LifeWorld; s = mkSnapshot(); out = mkIntents(); ev = mkEvents(); t = 0; frame = 0; fps: number;
  bodies: Body[] = []; def: PlaceDef; layout: 0 | 1; scale: number;
  ball = -1; ballX = 0; ballZ = 0; ballVX = 0; ballVZ = 0; ballMoved = 0; things: number[] = []; thingXY: number[][] = [];
  log: Log[] = []; evs: EvLog[] = []; keepLog = true; sleep = true; physics = true;
  kettle = false; hash = 0x811c9dc5; extraFlags: number[] = new Array(16).fill(0); touch: number[] = new Array(16).fill(-1);
  constructor(seed: number, def: PlaceDef, layout: 0 | 1, fps = 60, scale = 1) {
    this.w = createLifeWorld(seed, 16); this.def = def; this.layout = layout; this.fps = fps; this.scale = scale;
    lifeSetPlace(this.w, def.idx, 1, def, layout, scale);
    for (let i = 0; i < 16; i++) this.bodies.push({ on: false, x: 0, z: 0, vx: 0, vz: 0, r: 0.5, tx: 0, tz: 0, sp: 0, scoot: false, air: 0, still: 0, asleep: false, kind: 0,
      group: i, species: 0, family: 0, flags: 0, frac: 1, homeX: NaN, homeZ: NaN, float: false });
  }
  add(slot: number, species: string, x: number, z: number, opts: { kind?: 0 | 1 | 2; group?: number; isNew?: boolean; seed?: number; r?: number; frac?: number; asleep?: boolean; float?: boolean } = {}): void {
    const g = G(species, opts.seed ?? (7 + slot * 101));
    const b = this.bodies[slot];
    Object.assign(b, { on: true, x, z, vx: 0, vz: 0, r: opts.r ?? 0.5, tx: x, tz: z, scoot: false, air: 0, still: 0, asleep: opts.asleep ?? false, kind: opts.kind ?? 0,
      group: opts.group ?? slot, species: SP(species), family: 0, frac: opts.frac ?? 1, homeX: NaN, homeZ: NaN, float: opts.float ?? false });
    lifeAdd(this.w, slot, g, opts.kind ?? 0, opts.group ?? slot, 0, opts.isNew ?? false);
  }
  home(slot: number, x: number, z: number): void { this.bodies[slot].homeX = x; this.bodies[slot].homeZ = z; lifeSetHome(this.w, slot, x, z); }
  addThing(id: string, x: number, z: number): void { this.things.push(TID(id)); this.thingXY.push([x, z]); if (id === 'feltball' || id === 'yarnball') { this.ball = this.things.length - 1; this.ballX = x; this.ballZ = z; } }
  /** Fill the snapshot from the bodies (rows = slots). */
  fill(): void {
    const s = this.s, n = this.bodies.reduce((m, b, i) => (b.on ? i + 1 : m), 0);
    s.n = n; s.t = this.t; s.beatPhase = (this.t * 66 / 60) % 1;
    if (this.kettle) s.musicBoxOn = this.t % 67 >= 40 && this.t % 67 < 43.6;
    let units = 0;
    for (let i = 0; i < 16; i++) {
      const b = this.bodies[i];
      s.kind[i] = b.kind; s.group[i] = b.group; s.species[i] = b.species; s.r[i] = b.r; s.frac[i] = b.frac;
      s.x[i] = b.x; s.z[i] = b.z; s.vx[i] = b.vx; s.vz[i] = b.vz; s.y[i] = b.air > 0 ? 0.03 : 0;
      let f = this.extraFlags[i] | LIFE_FLAG.VISIBLE;
      if (b.asleep) f |= LIFE_FLAG.ASLEEP;
      if (b.air > 0) f |= LIFE_FLAG.AIRBORNE; else f |= LIFE_FLAG.GROUNDED;
      s.flags[i] = b.on ? f : 0;
      s.touchKind[i] = this.touch[i]; this.touch[i] = -1;
      s.sx[i] = b.on ? 0.5 + b.x / 9 : NaN; s.sy[i] = 0.5 + b.z / 7;
      // zones at the centre (the place's own geometry, the layout in use)
      let mask = 0, zt = -1, best = 0;
      const zones = this.def.zones;
      for (let k = 0; k < zones.length; k++) {
        const z = zones[k], a = this.layout === 1 ? this.def.tall.zones[k] : z, sc = this.def.unit === 'slot' ? this.scale : 1;
        const dx = b.x - a.x * sc, dz = b.z - a.z * sc;
        const inside = a.shape === 'disc' ? dx * dx + dz * dz <= (a.r ?? 0) ** 2 : Math.abs(dx) <= (a.hx ?? 0) && Math.abs(dz) <= (a.hz ?? 0);
        if (!inside) continue;
        mask |= 1 << z.kind;
        if (z.strength > best) { best = z.strength; const ti = this.def.things.findIndex((t) => t.zone === z.id); zt = ti >= 0 ? TID(this.def.things[ti].id) : -1; }
      }
      s.zoneMask[i] = mask; s.zoneThing[i] = zt;
      if (b.on && (mask & (1 << ZONE.water)) !== 0) { s.flags[i] |= LIFE_FLAG.IN_WATER; if (b.float && b.air <= 0) s.flags[i] &= ~LIFE_FLAG.GROUNDED; }
      if (b.on) units += b.asleep ? 0.03 : b.kind === 0 ? 1 : 0.22;
    }
    s.units = units;
    s.nThings = this.things.length;
    for (let k = 0; k < this.things.length; k++) {
      s.thingId[k] = this.things[k];
      const isBall = k === this.ball;
      s.thingX[k] = isBall ? this.ballX : this.thingXY[k][0]; s.thingZ[k] = isBall ? this.ballZ : this.thingXY[k][1];
      s.thingState[k] = isBall ? Math.hypot(this.ballVX, this.ballVZ) : 0; s.thingBusy[k] = 0;
    }
  }
  apply(dt: number): void {
    const o = this.out;
    for (let k = 0; k < o.n; k++) {
      const b = this.bodies[o.who[k]], kd = o.kind[k];
      if (this.keepLog) this.log.push({ t: this.t, kind: kd, who: o.who[k], a: o.a[k], b: o.b[k], c: o.c[k], d: o.d[k], e: o.e[k], icon: o.icon[k], style: o.style[k], delay: o.delayS[k] });
      this.hash = Math.imul(this.hash ^ (kd * 131 + o.who[k] * 7 + Math.round(o.a[k] * 1000) + Math.round(o.b[k] * 977) + o.icon[k] * 13 + Math.round(o.delayS[k] * 100)), 0x01000193) >>> 0;
      if (!this.physics) continue;
      if (kd === INTENT.SCOOT) { b.tx = o.a[k]; b.tz = o.b[k]; b.sp = o.c[k]; b.scoot = true; b.asleep = false; b.still = 0; }
      else if (kd === INTENT.HOP) { b.air = 2 * o.b[k] / 10; b.asleep = false; b.still = 0; b.vx = o.a[k]; b.vz = o.c[k]; }
      else if (kd === INTENT.SETTLE || kd === INTENT.CANCEL) { b.scoot = false; }
    }
    for (let k = 0; k < this.ev.n; k++) {
      const e = { t: this.t, kind: this.ev.kind[k], sub: this.ev.sub[k], a: this.ev.a[k], b: this.ev.b[k], n2: this.ev.n2[k], thing: this.ev.thing[k] };
      this.evs.push(e);
      this.hash = Math.imul(this.hash ^ (e.kind * 4099 + e.sub * 31 + e.a * 7 + e.n2 + e.thing * 3), 0x01000193) >>> 0;
    }
    if (!this.physics) return;
    // kinematics
    for (const b of this.bodies) {
      if (!b.on) continue;
      let vx = 0, vz = 0;
      if (b.scoot && !(this.extraFlags[this.bodies.indexOf(b)] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.LOCKED))) {
        const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
        if (d < 1e-3) b.scoot = false;
        else { const st = Math.min(d, b.sp * dt); vx = dx / d * b.sp; vz = dz / d * b.sp; b.x += dx / d * st; b.z += dz / d * st; }
      }
      if (b.air > 0) { b.x += b.vx * dt; b.z += b.vz * dt; b.air -= dt; if (b.air <= 0) { b.air = 0; b.vx = 0; b.vz = 0; } else { vx += b.vx; vz += b.vz; } }
      b.vx = b.air > 0 ? b.vx : vx; b.vz = b.air > 0 ? b.vz : vz;
      const moving = Math.hypot(vx, vz) > 0.01 || b.air > 0;
      b.still = moving ? 0 : b.still + dt;
      if (this.sleep && b.still > 1.5) b.asleep = true;
      // the ball: a body moving into it pushes it on
      if (this.ball >= 0) {
        const dx = this.ballX - b.x, dz = this.ballZ - b.z, d = Math.hypot(dx, dz), br = this.def.things.find((t) => t.mech === MECH.ball)?.size[0] ?? 0.22;
        if (d < b.r + br && moving && (vx * dx + vz * dz) > 0) {
          const push = Math.max(0.3, Math.hypot(vx, vz)) * 1.6;
          this.ballVX = dx / d * push; this.ballVZ = dz / d * push;
          this.ballX = b.x + dx / d * (b.r + br + 0.001); this.ballZ = b.z + dz / d * (b.r + br + 0.001);
        }
      }
    }
    if (this.ball >= 0) {
      const v = Math.hypot(this.ballVX, this.ballVZ);
      if (v > 1e-4) { this.ballX += this.ballVX * dt; this.ballZ += this.ballVZ * dt; this.ballMoved += v * dt; const k = Math.exp(-0.6 * dt); this.ballVX *= k; this.ballVZ *= k; if (v < 0.01) { this.ballVX = 0; this.ballVZ = 0; } }
      // in a place the ball stays inside the layout's rounded bounds: the walls and the rim bounce of 0.35 (PLACES P5 and P7, PH-05); at Home
      // the host leaves it free (the corral rectangle is the shell's)
      if (this.def.unit !== 'slot') {
        const bd = this.layout === 1 ? this.def.tall.bounds : this.def.bounds, br = this.def.things.find((t) => t.mech === MECH.ball)?.size[0] ?? 0.22;
        const hx = (bd.hx ?? 3.4) - br, hz = (bd.hz ?? 2.4) - br;
        if (Math.abs(this.ballX - bd.x) > hx) { this.ballX = bd.x + Math.sign(this.ballX - bd.x) * hx; this.ballVX *= -0.35; }
        if (Math.abs(this.ballZ - bd.z) > hz) { this.ballZ = bd.z + Math.sign(this.ballZ - bd.z) * hz; this.ballVZ *= -0.35; }
      }
    }
  }
  step(): void {
    this.frame++;
    this.t = this.frame / this.fps;
    this.fill();
    lifeStep(this.w, this.s, this.out, this.ev);
    this.apply(1 / this.fps);
  }
  run(seconds: number): void { const end = this.frame + Math.round(seconds * this.fps); while (this.frame < end) this.step(); }
  events(kind: number, sub = -1): EvLog[] { return this.evs.filter((e) => e.kind === kind && (sub < 0 || e.sub === sub)); }
  intents(kind: number, who = -1): Log[] { return this.log.filter((l) => l.kind === kind && (who < 0 || l.who === who)); }
}
/** A cabin party: wide layout, spawn spots, the cabin's things out. */
function cabin(seed: number, species: string[], tier = 1, fps = 60, layout: 0 | 1 = 0): Sim {
  const sim = new Sim(seed, CABIN, layout, fps);
  sim.s.place = 1; sim.s.tier = tier;
  const lay = layout === 1 ? CABIN.tall : CABIN;
  const spawn = lay.spawn as readonly (readonly [number, number])[];
  species.forEach((sp, i) => sim.add(i, sp, spawn[i % spawn.length][0], spawn[i % spawn.length][1], { seed: seed * 1000 + i * 101 }));
  CABIN.things.forEach((t, k) => { const p = layout === 1 ? CABIN.tall.things[k] : t; sim.addThing(t.id, p.x, p.z); });
  sim.kettle = true;
  return sim;
}
/** Home with n out at simple slot positions (a row), the Felt Ball and the things that show from n out. */
function home(seed: number, species: string[], layout: 0 | 1 = 0, scale = 1, fps = 60): Sim {
  const sim = new Sim(seed, HOME, layout, fps, scale);
  sim.s.place = 0;
  const n = species.length;
  species.forEach((sp, i) => { const x = (i - (n - 1) / 2) * 1.3 * scale, z = 0.2 * scale; sim.add(i, sp, x, z); sim.home(i, x, z); });
  HOME.things.forEach((t, k) => {
    const sp = layout === 1 ? HOME.tall.things[k] : t, from = (layout === 1 ? HOME.tall.things[k].fromN : t.fromN) ?? 1;
    if (t.id === 'bouncepad' || t.id === 'keepsakeshelf') return;
    if (n >= from) sim.addThing(t.id, sp.x * scale, sp.z * scale);
  });
  return sim;
}
/** Track per-step invariants: movers <= moverCap (LF-10), one moment per character (LF-11), and every LIFE start that wakes a body keeps
 *  units <= unitCap + the ride allowance. */
function watchGate(sim: Sim, rows: { movers: number; moment: number; wake: number; maxUnits: number }): void {
  const w = sim.w, cap = moverCapOf(sim.s.tier);
  if (w.movers > cap) rows.movers++;
  const seen = new Set<number>();
  for (let m = 0; m < 8; m++) {
    if (!w.mK[m]) continue;
    for (let k = 0; k < w.mN[m]; k++) { const j = w.mM[m * 6 + k]; if (j < 0) continue; if (seen.has(j) || w.moo[j] !== m) rows.moment++; seen.add(j); }
  }
}
function runWatched(sim: Sim, seconds: number, rows: { movers: number; moment: number; wake: number; maxUnits: number }): void {
  const end = sim.frame + Math.round(seconds * sim.fps);
  while (sim.frame < end) {
    const asleep = sim.bodies.map((b) => b.asleep);
    sim.step();
    watchGate(sim, rows);
    // a LIFE start that woke a sleeping body: the units after it must fit unitCap + the ride allowance
    let woke = false;
    for (let i = 0; i < 16; i++) if (sim.bodies[i].on && asleep[i] && !sim.bodies[i].asleep && !(sim.extraFlags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED))) woke = true;
    if (woke) {
      let u = 0;
      for (const b of sim.bodies) if (b.on) u += b.asleep ? 0.03 : b.kind === 0 ? 1 : 0.22;
      rows.maxUnits = Math.max(rows.maxUnits, u - sim.w.att.allowance - unitCapOf(sim.s.tier));
      if (u > unitCapOf(sim.s.tier) + sim.w.att.allowance + 0.001) rows.wake++;
    }
  }
}

/* ═══════════════════════════════════════ the quest side: a real collection + journal fed by the host's ring ═══════════════════════════════════════ */
const DAY = 86_400_000;
let T = 20407 * DAY + 3_600_000;
const now = (): number => T;
interface Mem extends StorageLike { map: Map<string, string> }
const mem = (): Mem => { const map = new Map<string, string>(); return { map, getItem: (k) => (map.has(k) ? map.get(k)! : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } }; };
const noTimers = { setTimer: (): unknown => 0, clearTimer: (): void => undefined };
const Q = (id: string): number => QUESTS.findIndex((q) => q.id === id);
const famOf = (sp: number): number => (sp < CATALOG.length ? MATERIAL_FAMILY_IDS.indexOf(CATALOG[sp].family) : 255);
const mkRing = (cap = 64): PlayEventRing => ({ n: 0, dropped: 0, kind: new Uint8Array(cap), sub: new Uint8Array(cap), place: new Uint8Array(cap), thing: new Int16Array(cap),
  a: new Uint8Array(cap), b: new Uint8Array(cap), fam: new Uint8Array(cap), n2: new Uint8Array(cap), by: new Uint8Array(cap), flag: new Uint8Array(cap), v: new Float32Array(cap) });

/** The quest host the shell will be (PLAYGROUND_BUILD 7; the conventions in PG_LIFE.md round 2 and PG_QUESTS.md round 1 "Ring conventions"):
 *  LIFE's events this frame -> ring records (slots -> species, the wish kind from lifeWishOf at SHOWN, a friend wish's grant by PLAYER, a
 *  grant greet (thing -2) as v = -1), the scripted player's records, then collection.feedPlay once a frame; FRIEND moments back into LIFE
 *  (lifeSetPair) and the friend wish's mask (collection.friendMask -> lifeSetFriends). */
class QHost {
  readonly storage = mem();
  readonly c: Collection;
  readonly rt: JournalRuntime;
  readonly ring = mkRing(64);
  sim!: Sim;
  place = 0;
  private evAt = 0;
  private readonly wishKind = new Int32Array(16);
  private readonly wishTarget = new Int32Array(16).fill(-1);
  readonly records: Array<{ kind: number; sub: number; a: number; b: number; thing: number; n2: number; by: number; v: number; place: number }> = [];
  readonly qEvents: CollectionEvent[] = [];
  readonly mask = new Uint32Array(2);
  friendMaskCalls = 0;
  constructor(seed: number) {
    this.c = createCollection({ storage: this.storage, now, random: mulberry32(seed), ...noTimers, throttleMs: 2000 });
    this.rt = attachJournal(this.c, { storage: this.storage, ...noTimers, throttleMs: 2000 })!;
    this.c.onEvent((e) => {
      this.qEvents.push(e);
      if (!this.sim) return;
      // a friendship level reached: LIFE's pair rows (as LF-09's host does) and, from Friends on, the friend wish's mask for both species
      if (e.type === 'friend') {
        for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
          const bi = this.sim.bodies[i], bj = this.sim.bodies[j];
          if (i < j && bi.on && bj.on && bi.kind === 0 && bj.kind === 0 && ((bi.species === e.a && bj.species === e.b) || (bi.species === e.b && bj.species === e.a))) lifeSetPair(this.sim.w, i, j, e.level, CATALOG_FRIEND[e.a] === e.b);
        }
        if (e.level >= 2) { this.pushMask(e.a); this.pushMask(e.b); }
      }
      if (e.type === 'fact' && e.fact === FACT.FRIEND) this.pushMask(e.species);
    });
  }
  pushMask(sp: number): void { this.friendMaskCalls++; this.c.friendMask!(sp, this.mask); lifeSetFriends(this.sim.w, sp, this.mask); }
  /** Enter a place with this sim (a trip: VISIT by PLAYER, the journal's party). */
  /** a tier for every place entered (QU-03's low-tier run), else the sim's own */
  tier = -1;
  /** LF-10's gate counters, watched on every step when set (QU-03's gate half) */
  gate: { movers: number; moment: number; wake: number; maxUnits: number } | null = null;
  enter(sim: Sim, placeIdx: number, visitBy: number = BY.PLAYER): void {
    if (this.tier >= 0) sim.s.tier = this.tier;
    this.sim = sim; this.evAt = 0; this.place = placeIdx; this.wishKind.fill(0); this.wishTarget.fill(-1);
    const owned = new Uint32Array(2);
    for (const b of sim.bodies) if (b.on) owned[b.species >>> 5] |= 1 << (b.species & 31);
    for (const s of this.extraOwned) owned[s >>> 5] |= 1 << (s & 31);
    lifeSetJournal(sim.w, owned, this.rt.store.journal.st.sc[SC.PL] | 1, new Uint32Array(4), THING_KIND.ball | THING_KIND.bell | THING_KIND.note | THING_KIND.flame);
    for (let s = 0; s < 50; s++) if ((owned[s >>> 5] & (1 << (s & 31))) !== 0) this.pushMask(s);   // at load / a trip: every owned species
    const first = sim.bodies.find((b) => b.on)!;
    this.write(EV.VISIT, 0, -1, first.species, 255, sim.bodies.filter((b) => b.on && b.kind === 0).length, visitBy);
    this.flushRing();
  }
  extraOwned: number[] = [];
  write(kind: number, sub: number, thing: number, a: number, b: number, n2: number, by: number, v = 0, flag = 0): void {
    const r = this.ring;
    if (r.n >= r.kind.length) { this.flushRing(); }
    const i = r.n++;
    r.kind[i] = kind; r.sub[i] = sub; r.place[i] = this.place; r.thing[i] = thing; r.a[i] = a; r.b[i] = b; r.fam[i] = famOf(a); r.n2[i] = n2; r.by[i] = by; r.flag[i] = flag; r.v[i] = v;
    this.records.push({ kind, sub, a, b, thing, n2, by, v, place: this.place });
  }
  flushRing(): void { if (this.ring.n > 0) { this.c.feedPlay!(this.ring, T); this.ring.n = 0; } }
  private spOf(slot: number): number { return slot < 16 && this.sim.bodies[slot].on ? this.sim.bodies[slot].species : 255; }
  /** LIFE's events since the last pump -> ring records. */
  pump(): void {
    const sim = this.sim, wo = new Int32Array(2);
    for (; this.evAt < sim.evs.length; this.evAt++) {
      const e = sim.evs[this.evAt];
      const a = e.a === 255 ? 255 : this.spOf(e.a), b = e.b >= 254 ? 255 : this.spOf(e.b);
      switch (e.kind) {
        case LIFE_EV.SOCIAL:
          if (e.thing === -2) this.write(EV.SOCIAL, e.sub, -1, a, b, e.n2, BY.SELF, -1);          // the friend wish's grant greet: no points
          else this.write(EV.SOCIAL, e.sub, e.thing, a, b, e.n2, BY.SELF);
          break;
        case LIFE_EV.USE: this.write(EV.USE, e.sub, e.thing, a, 255, e.n2, e.b === 254 ? BY.PLAYER : BY.SELF); break;
        case LIFE_EV.REACT: this.write(EV.REACT, e.sub, e.thing, a, 255, e.n2, BY.SELF); break;
        case LIFE_EV.PIECES: this.write(EV.PIECES, e.sub, e.thing, a, 255, e.n2, BY.SELF, 0, EV_FLAG.PIECE); break;
        case LIFE_EV.SIGNATURE: this.write(EV.SIGNATURE, e.sub, e.thing, a, 255, e.n2, BY.SELF); break;
        case LIFE_EV.WISH:
          if (e.sub === WISH_STATE.SHOWN) {
            let kind = 0, target = e.thing;
            if (e.a < 16 && lifeWishOf(sim.w, e.a, wo)) { kind = wo[0]; target = wo[1]; this.wishKind[e.a] = kind; this.wishTarget[e.a] = target; }
            if (e.b === 254 && e.n2 === 0) { kind = WISH_KIND.PLACE; target = 1; }   // FIRST_WISH resting at the 5:00 backstop
            this.write(EV.WISH, WISH_STATE.SHOWN, target, e.b === 254 && e.n2 === 0 && e.a >= 16 ? 255 : a, 255, e.n2, BY.SELF, kind);
          } else if (e.sub === WISH_STATE.GRANTED && e.a < 16) {
            const kind = this.wishKind[e.a];
            this.write(EV.WISH, WISH_STATE.GRANTED, this.wishTarget[e.a], a, 255, 1, kind === WISH_KIND.FRIEND || kind === WISH_KIND.PLACE || kind === WISH_KIND.RIDE || kind === WISH_KIND.TOUCH ? BY.PLAYER : BY.SELF, kind);   // QUESTS 8: the player brought the friend, took it there, set the ride, gave the touch
            this.wishKind[e.a] = 0; this.wishTarget[e.a] = -1;
          }
          break;
        default: break;
      }
    }
  }
  /** Run the sim with the ring drained once a frame (the clock moves with it). */
  run(seconds: number, each?: () => void): void {
    const end = this.sim.frame + Math.round(seconds * this.sim.fps);
    while (this.sim.frame < end) {
      const sim = this.sim, g = this.gate, asleep = g ? sim.bodies.map((b) => b.asleep) : null;
      sim.step(); this.pump(); this.flushRing(); T += 1000 / sim.fps;
      if (g && asleep) {
        watchGate(sim, g);
        let woke = false;
        for (let i = 0; i < 16; i++) if (sim.bodies[i].on && asleep[i] && !sim.bodies[i].asleep && !(sim.extraFlags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED))) woke = true;
        if (woke) {
          let u = 0; for (const b of sim.bodies) if (b.on) u += b.asleep ? 0.03 : b.kind === 0 ? 1 : 0.22;
          g.maxUnits = Math.max(g.maxUnits, u - sim.w.att.allowance - unitCapOf(sim.s.tier));
          if (u > unitCapOf(sim.s.tier) + sim.w.att.allowance + 0.001) { g.wake++; if (process.argv.includes('--verbose')) console.log(`  wake over: place ${this.place} t ${sim.t.toFixed(1)} units ${u.toFixed(2)} cap ${unitCapOf(sim.s.tier).toFixed(2)} allowance ${sim.w.att.allowance} awake ${sim.bodies.filter((b) => b.on && !b.asleep).length}/${sim.bodies.filter((b) => b.on).length} woke ${sim.bodies.map((b, i) => (b.on && asleep[i] && !b.asleep ? i : -1)).filter((i) => i >= 0).join(',')} beh ${[0, 1, 2].map((i) => sim.w.beh[i]).join(',')} last intents ${JSON.stringify(sim.log.slice(-3).map((l) => [l.kind, l.who]))}`); }
        }
      }
      if (each) each();
    }
  }
  done(id: string): boolean { return isDone(this.rt.store.journal.st, Q(id)); }
  count(kind: number, sub = -1): number { return this.records.filter((r) => r.kind === kind && (sub < 0 || r.sub === sub)).length; }
}
const CATALOG_FRIEND: number[] = CATALOG.map((c) => { const f = (SPECIES_LIFE_T as Record<string, { friend: string }>)[c.id]?.friend; return f ? CATALOG.findIndex((x) => x.id === f) : 255; });

const SPI = (id: string): number => CATALOG.findIndex((c) => c.id === id);
const has = (m: Uint32Array, sp: number): boolean => (m[sp >>> 5] & (1 << (sp & 31))) !== 0;

/* ═══════════════ FM: the friend wish's reducer side (lifeSetFriends' mask, PG_LIFE round 2 step 4; QUESTS 8) ═══════════════ */
{
  const h = new QHost(3);
  const st = h.rt.store.journal.st, d = h.rt.defs, out = createQuestOut(256), m = new Uint32Array(2);
  setQuestDay(st, Math.floor(T / DAY));
  const crimpo = SPI('crimpo'), dollop = SPI('dollop'), puddlo = SPI('puddlo'), capnap = SPI('capnap'), boingle = SPI('boingle');
  const soc = (sub: number, a: number, b: number): void => { applyEventFields(st, d, out, EV.SOCIAL, sub, 0, -1, a, b, famOf(a), 2, BY.SELF, 0, 0); };
  const empty0 = !friendMaskOf(st, d, crimpo, m) && m[0] === 0 && m[1] === 0;
  soc(SOCIAL_KIND.GREET, puddlo, capnap);                   // Met only (1 point)
  const metOnly = (friendMaskOf(st, d, puddlo, m), !has(m, capnap));
  for (let k = 0; k < 6; k++) soc(SOCIAL_KIND.NUZZLE, puddlo, capnap);   // 1 + 6 x 2 = 13 >= 12: Friends
  friendMaskOf(st, d, puddlo, m); const friendsA = has(m, capnap) && !has(m, puddlo);
  friendMaskOf(st, d, capnap, m); const friendsB = has(m, puddlo);
  // the authored best pair (Dollop and Crimpo): a nuzzle (points, but no F3 yet) does not name the best friend before its riddle is solved
  soc(SOCIAL_KIND.NUZZLE, dollop, crimpo);
  friendMaskOf(st, d, crimpo, m); const hiddenBf = !has(m, dollop);
  soc(SOCIAL_KIND.GREET, crimpo, dollop);                   // their greet finds F3 for both
  const f3 = (st.fx[crimpo] & (1 << FACT.FRIEND)) !== 0;
  friendMaskOf(st, d, crimpo, m); const bfShown = has(m, dollop);
  friendMaskOf(st, d, boingle, m); const other = m[0] === 0 && m[1] === 0;
  check('FM', 'friendMaskOf: empty on a fresh journal; a Met-only pair is not named; a pair at Friends (13 points) names each other, never itself',
    empty0 && metOnly && friendsA && friendsB, `empty ${empty0}, met-only hidden ${metOnly}, friends ${friendsA}/${friendsB}`);
  check('FM', 'the authored best friend is named only once F3 is found (a wish never gives the riddle away); an unrelated species has an empty mask',
    hiddenBf && f3 && bfShown && other, `before F3 hidden ${hiddenBf}, F3 ${f3}, after ${bfShown}`);
  const viaC = new Uint32Array(2); const okC = h.c.friendMask!(crimpo, viaC); friendMaskOf(st, d, crimpo, m);
  const bare = createCollection({ storage: null, now, random: mulberry32(1), ...noTimers }); const z = new Uint32Array([7, 7]); const okBare = bare.friendMask!(crimpo, z); bare.dispose();
  check('FM', 'collection.friendMask answers the same mask through the collection, and (false, 0, 0) before the journal is attached', okC && viaC[0] === m[0] && viaC[1] === m[1] && !okBare && z[0] === 0 && z[1] === 0);
  // zero allocation in the call (it runs on journal changes, never per frame, but it must not allocate either): QU-01's new-space method
  const newUsed = (): number => { for (const s of v8.getHeapSpaceStatistics()) if (s.space_name === 'new_space') return s.space_used_size; return NaN; };
  const runM = (n: number): void => { for (let k = 0; k < n; k++) friendMaskOf(st, d, k % 50, m); };
  runM(20000);
  const base: number[] = []; for (let k = 0; k < 6; k++) { const u = newUsed(); base.push(newUsed() - u); }
  let best = Infinity;
  for (let w = 0; w < 6; w++) { const u = newUsed(); runM(10000); const dd = newUsed() - u - base[5]; if (dd >= 0 && dd < best) best = dd; }
  check('FM', `friendMaskOf allocates 0 B over 10 000 calls after warm-up (QU-01's new-space method)`, best === 0, `${best} B`);
  h.c.dispose();
}
/* FM, round 5 (FIX5_DATA): the same 0 B bar BEFORE V8 optimizes the call. The row above passes only once TurboFan has compiled friendMaskOf; on a loaded
 * machine its windows can still run the unoptimized code (VERDICT_PG measured 32 B), where every non-integer Float32Array read (a best pair's 4.5 points) and
 * every 32-bit mask word of 2^30 or more is boxed into a HeapNumber. A child node process with TurboFan off (--no-opt: Ignition and Sparkplug only) runs
 * 10 000 calls over all 64 species against rows at 13, 4.5, 12.5, 40.25 and 11.99 points, two of them on the mask's 2^30 / 2^31 bits and one in the high
 * word, and checks the masks too. (HEAD f271a93b1's friendMaskOf: 814 976 B there.) */
{
  const code = `const v8 = await import('node:v8'), R = process.argv[1];
const Q = await import(R + 'src/core/quests.ts'), J = await import(R + 'src/collection/journal.ts');
const d = J.journalDefs(), st = Q.createQuestState(d), m = new Uint32Array(2);
const rows = [[3, 21, 13], [0, 10, 4.5], [30, 31, 12.5], [47, 63, 40.25], [5, 31, 11.99]];
rows.forEach(([lo, hi, p], r) => { st.frLo[r] = lo; st.frHi[r] = hi; st.frPts[r] = p; }); st.sc[Q.SC.FRN] = rows.length;
const newUsed = () => { for (const s of v8.getHeapSpaceStatistics()) if (s.space_name === 'new_space') return s.space_used_size; return NaN; };
const runM = (n) => { for (let k = 0; k < n; k++) Q.friendMaskOf(st, d, k % 64, m); };
runM(2000);
const base = []; for (let k = 0; k < 6; k++) { const u = newUsed(); base.push(newUsed() - u); }
let best = Infinity; for (let w = 0; w < 6; w++) { const u = newUsed(); runM(10000); const dd = newUsed() - u - base[5]; if (dd >= 0 && dd < best) best = dd; }
const mk = (sp) => { Q.friendMaskOf(st, d, sp, m); return (m[0] >>> 0) + ',' + (m[1] >>> 0); };
console.log(JSON.stringify({ best, masks: [3, 30, 31, 63, 5, 0].map(mk).join(' ') }));`;
  const r = spawnSync(process.execPath, ['--no-opt', '--input-type=module', '-e', code, pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/').href], { encoding: 'utf8', timeout: 120_000 });
  let got: { best?: number; masks?: string } = {};
  try { got = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}'); } catch { got = {}; }
  const want = '2097152,0 2147483648,0 1073741824,0 0,32768 0,0 0,0';
  check('FM', 'friendMaskOf allocates 0 B over 10 000 calls with V8\'s optimizing tier off (a child node --no-opt; mask words on bits 30, 31 and the high word; the masks right)',
    got.best === 0 && got.masks === want, `${got.best ?? 'no result: ' + (r.stderr || '').slice(0, 200)} B; masks ${got.masks === want ? 'right' : got.masks}`);
}

/* ═══════════════ FW: the friend wish end to end (the reducer's mask -> LIFE -> the host's ring -> the reducer) ═══════════════ */
{
  const h = new QHost(5);
  const st = h.rt.store.journal.st, d = h.rt.defs, out = createQuestOut(256);
  setQuestDay(st, Math.floor(T / DAY));
  const crimpo = SPI('crimpo'), dollop = SPI('dollop');
  applyEventFields(st, d, out, EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE);              // the scripted first wish was shown (Hearthlog open)
  applyEventFields(st, d, out, EV.SOCIAL, SOCIAL_KIND.GREET, 0, -1, crimpo, dollop, famOf(crimpo), 2, BY.SELF, 0, 0);   // F3 found earlier
  markDone(st, d, Q('H8'), out); markDone(st, d, Q('C8'), out);                                                          // two finales: Friends Everywhere is open
  h.extraOwned = [dollop];                                   // Dollop on the shelf, not out
  const sim = home(121, ['crimpo', 'glugbean'], 0);
  h.enter(sim, 0, BY.SELF);
  const wg0 = st.sc[SC.WG], x10 = Q('X10');
  let shownAt = -1;
  h.run(400, () => { sim.w.co[0] = 0.95; sim.w.pl[0] = 0.2; sim.w.re[0] = 0.1; sim.w.co[1] = 0.1; sim.w.pl[1] = 0.2; if (shownAt < 0 && h.records.some((r) => r.kind === EV.WISH && r.sub === WISH_STATE.SHOWN && r.v === WISH_KIND.FRIEND)) { shownAt = sim.t; sim.frame = 1e9; } });
  const shown = h.records.find((r) => r.kind === EV.WISH && r.sub === WISH_STATE.SHOWN && r.v === WISH_KIND.FRIEND);
  check('FW', `Crimpo wishes to see Dollop from the mask the reducer gave LIFE (collection.friendMask at the trip -> lifeSetFriends, ${h.friendMaskCalls} calls): the ring's WISH SHOWN has v = FRIEND, thing = Dollop`,
    !!shown && shown.thing === dollop && shown.a === crimpo, shown ? `at +${shownAt.toFixed(0)} s` : 'no friend wish in 400 s');
  // the player brings Dollop out: a BRING by PLAYER, LIFE adds it, the greet grants the wish
  sim.frame = Math.round(sim.t * sim.fps);
  sim.add(2, 'dollop', 1.6, 0.2); sim.home(2, 1.6, 0.2);
  h.write(EV.BRING, 0, -1, dollop, 255, 1, BY.PLAYER); h.flushRing();
  h.run(60);
  const granted = h.records.find((r) => r.kind === EV.WISH && r.sub === WISH_STATE.GRANTED && r.a === crimpo);
  const pr = new Int32Array(2); questProgress(st, d, x10, pr); const x10c = pr[0];
  check('FW', 'brought out, the greet grants it: the ring\'s WISH GRANTED (kind FRIEND) is by PLAYER (QUESTS 8), the reducer counts a wish come true (Wish Jar +1, X10 1 of 5) and finds F10 for Crimpo',
    !!granted && granted.by === BY.PLAYER && st.sc[SC.WG] === wg0 + 1 && x10c === 1 && (st.fx[crimpo] & (1 << FACT.WISH)) !== 0, granted ? `X10 ${x10c} of 5` : 'not granted');
  h.c.dispose();
}

/* ═══════════════ AU: AUTONOMY_ONLY_SOCIALS (QU-16) against LIFE's real autonomy-off behaviour (LF-24; PG_LIFE round 2 step 9) ═══════════════ */
{
  const kinds = (on: boolean, seed: number): Map<number, number> => {
    const h = new QHost(seed);
    const sim = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo'], 2);
    sim.s.autonomy = on;
    h.enter(sim, 1);
    h.run(240);
    const m = new Map<number, number>();
    for (const r of h.records) if (r.kind === EV.SOCIAL) m.set(r.sub, (m.get(r.sub) ?? 0) + 1);
    h.c.dispose();
    return m;
  };
  const name = (k: number): string => Object.keys(SOCIAL_KIND).find((q) => SOCIAL_KIND[q as keyof typeof SOCIAL_KIND] === k) ?? String(k);
  const off: Map<number, number>[] = [], on: Map<number, number>[] = [];
  for (const seed of [61, 62, 63]) { off.push(kinds(false, seed)); on.push(kinds(true, seed)); }
  const offBad: string[] = [], offSeen = new Set<number>(), onSeen = new Set<number>();
  for (const m of off) for (const [k, n] of m) { offSeen.add(k); if (AUTONOMY_ONLY_SOCIALS & (1 << k)) offBad.push(`${name(k)} x${n}`); }
  for (const m of on) for (const k of m.keys()) onSeen.add(k);
  check('AU', `with "Squishies move on their own" off, LIFE's real cabin party (3 seeds x 4 min, 4 wholes, high tier) produces no SOCIAL kind in AUTONOMY_ONLY_SOCIALS (${[...offSeen].map(name).join(' ') || 'no socials'} seen)`,
    offBad.length === 0, offBad.join(', '));
  const autoSeenOn = [...onSeen].filter((k) => AUTONOMY_ONLY_SOCIALS & (1 << k)).map(name);
  console.log(`info AU autonomy on, the same runs: SOCIAL kinds ${[...onSeen].map(name).join(' ')}; of AUTONOMY_ONLY_SOCIALS seen: ${autoSeenOn.join(' ') || 'none'}`);
}

/** The player carries bodies 0..n-1 to these spots, one after another, as the shell reports it to LIFE (TOUCHED + CARRIED while held, the
 *  CARRY touch kind on the first frame, then the release): LIFE cancels what each was doing (LF-04) and it is idle where it was set down. */
function carryTo(sim: Sim, spots: number[][], stepFn: () => void = () => sim.step()): void {
  spots.forEach(([x, z], k) => {
    const b = sim.bodies[k];
    sim.touch[k] = TOUCH.CARRY;
    for (let f = 0; f < 18; f++) { sim.extraFlags[k] = LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED; b.x += (x - b.x) * 0.3; b.z += (z - b.z) * 0.3; b.scoot = false; b.asleep = false; b.still = 0; stepFn(); }
    b.x = x; b.z = z; b.tx = x; b.tz = z; sim.extraFlags[k] = 0;
  });
}

/* ═══════════════ SG (diagnostic for C8): how many sing together by the kettle on LIFE's real output ═══════════════ */
{
  const hist: Record<number, number> = {}; let listens = 0, whistles = 0; const busy: Record<string, number> = {};
  for (const seed of [171, 172, 173, 174, 175]) {
    const sim = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo', 'glugbean'], 2);
    const kt = CABIN.things.find((t) => t.id === 'kettle')!;
    for (let cyc = 0; cyc < 9; cyc++) {
      // 5 s before each whistle (40 s into each 67 s): four set down beside the kettle, awake and still
      const tw = cyc * 67 + 35; while (sim.t < tw) sim.step();
      carryTo(sim, [[kt.x - 0.7, kt.z + 0.5], [kt.x - 0.2, kt.z + 0.9], [kt.x - 1.0, kt.z - 0.1], [kt.x - 1.2, kt.z + 0.7]]);
      whistles++;
      const e0 = sim.evs.length;
      while (sim.t < tw + 12) { sim.step(); }
      for (const e of sim.evs.slice(e0)) {
        if (e.kind === LIFE_EV.SOCIAL && e.sub === SOCIAL_KIND.SING) hist[e.n2] = (hist[e.n2] ?? 0) + 1;
        if (e.kind === LIFE_EV.USE && e.sub === USE_VERB.LISTEN) listens++;
      }
    }
    void busy;
  }
  const maxN = Math.max(0, ...Object.keys(hist).map(Number));
  console.log(`info SG ${whistles} kettle whistles with four set beside it (5 seeds, high tier): SING by members ${JSON.stringify(hist)}, max ${maxN}; ${listens} USE LISTEN (B18 answering the tune) in the same windows`);
}

/* ═══════════════ QU-13: every shown S1 quest from a scripted session of the REAL lifeStep and the host's ring writes ═══════════════
 * One journal, one clock, the visits in a regular player's order. LIFE produces every SOCIAL, USE by SELF, REACT, PIECES and WISH record
 * below; the host writes only what the shell's own producers write for the player (marked PLAYER: a squeeze, a stretch, a capsule, an emote
 * tap, the wish card's tap, three flicks of the Felt Ball, Travel, a BRING, the Fireplace's switch, the ride the player sets, the cut). */
interface Session { h: QHost; qu13: { id: string; at: string }[]; c8StoodIn: boolean; gate: { movers: number; moment: number; wake: number; maxUnits: number } }
function session(tier: number): Session {
  const qu13: { id: string; at: string }[] = [];
  let C8_STOOD_IN = false;
  T = 20420 * DAY + 9 * 3_600_000;
  const h = new QHost(13); h.tier = tier; h.gate = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
  const st = h.rt.store.journal.st;
  const nm = (k: number): string => Object.keys(SOCIAL_KIND).find((q) => SOCIAL_KIND[q as keyof typeof SOCIAL_KIND] === k) ?? String(k);
  let recAt = 0;
  const mark = (label: string): void => {
    if (process.argv.includes('--verbose')) { const m: Record<string, number> = {}; for (const r of h.records.slice(recAt)) { const k = r.kind === EV.SOCIAL ? nm(r.sub) + (r.n2 > 2 ? r.n2 : '') : r.kind === EV.USE ? 'use' + r.sub + ':' + r.thing : r.kind === EV.REACT ? 'react' + r.sub : 'ev' + r.kind; m[k] = (m[k] ?? 0) + 1; } recAt = h.records.length; console.log(`  [${label}] ${JSON.stringify(m)}`); } for (const q of QUESTS) if (isShown(h.rt.defs, q.idx) && isDone(st, q.idx) && !qu13.some((x) => x.id === q.id)) qu13.push({ id: q.id, at: label }); };
  const P = (kind: number, sub: number, thing: number, a: number, v = 0, n2 = 1): void => { h.write(kind, sub, thing, a, 255, n2, BY.PLAYER, v); h.flushRing(); };
  const TIDg = (id: string): number => THING_IDS.indexOf(id as (typeof THING_IDS)[number]);
  // 1. Home, three out
  const home1 = home(131, ['dollop', 'crimpo', 'capnap'], 0);
  h.enter(home1, 0, BY.SELF);
  P(EV.TOUCH, TOUCH.SQUEEZE, -1, SPI('dollop'), 1.0);                // PLAYER: a 1 s squeeze
  P(EV.TOUCH, TOUCH.STRETCH, -1, SPI('crimpo'), 0.5);                // PLAYER: a pull to level 0.5
  P(EV.CAPSULE, 0, -1, 255);                                         // PLAYER: a capsule opened
  P(EV.UI, UI_KIND.EMOTE_TAP, -1, SPI('dollop'));                    // PLAYER: a bubble tapped
  h.run(60);
  lifeScript(home1.w, 0, SCRIPT.FIRST_WISH, 0);                      // the shell's FIRST_WISH, 60 s after the first capsule
  h.run(5);
  P(EV.WISH, WISH_STATE.SEEN, 1, SPI('dollop'), WISH_KIND.PLACE);    // PLAYER: the wish card is read
  for (let k = 0; k < 3; k++) { P(EV.USE, USE_VERB.ROLL, TIDg('feltball'), SPI('dollop')); h.run(2); }   // PLAYER: three flicks of the Felt Ball
  // no input now; a nap pile on the Snooze Rug (H10) is LIFE's alone: run minute by minute until it comes (a regular player's Home time is
  // spread over sessions), at most 30 minutes
  let homeMin = 1;
  for (; homeMin <= 30 && !h.done('H10'); homeMin++) h.run(60);
  const homeLabel = `Home ${Math.round(home1.t / 60)} min`;
  if (process.argv.includes('--verbose')) console.log('  piles', JSON.stringify(h.records.filter((r) => r.kind === EV.SOCIAL && r.sub === SOCIAL_KIND.PILE)));
  mark(homeLabel);
  // 2. Travel to Hearthlog Cabin with five (the marshmallow and the mochi set down by the hearth by the player)
  const cab = cabin(132, ['dollop', 'crimpo', 'capnap', 'cushlet', 'kneadle'], 1);
  cab.bodies[3].x = -2.4; cab.bodies[3].z = -1.25; cab.bodies[4].x = -2.0; cab.bodies[4].z = -1.0;
  h.enter(cab, 1, BY.PLAYER);
  h.run(480);
  mark('cabin 8 min');
  // 3. The rides the player sets: one rider on the Pillow Swing (S11 push), then two on the Rocker Board (S10 teeter)
  {
    const sim = cabin(43, ['dollop', 'crimpo', 'capnap'], 1);
    const sw = CABIN.things.find((t) => t.id === 'pillowswing')!;
    sim.bodies[1].x = sw.x; sim.bodies[1].z = sw.z; sim.extraFlags[1] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
    sim.bodies[0].x = 1.2; sim.bodies[0].z = -0.6; sim.sleep = false; sim.bodies[0].asleep = true; sim.bodies[2].asleep = true;
    h.enter(sim, 1, BY.PLAYER); h.run(40);
    const sim2 = cabin(45, ['dollop', 'thumbly', 'capnap'], 1);
    const rk = CABIN.things.find((t) => t.id === 'rockerboard')!;
    sim2.bodies[0].x = rk.x - 0.75; sim2.bodies[0].z = rk.z; sim2.bodies[1].x = rk.x + 0.75; sim2.bodies[1].z = rk.z;
    sim2.extraFlags[0] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP; sim2.extraFlags[1] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
    // a rider on a rocking board is never still (the board moves it), so this host does not put the riders to sleep between their hops; with
    // the host's still-for-1.5 s sleep rule they "woke" on every hop, 4 starts over unitCap + allowance 0 (reported in PG_QUESTS.md round 3)
    sim2.sleep = false;
    h.enter(sim2, 1, BY.PLAYER); h.run(20);
    mark('cabin rides');
  }
  // 4. A cut inside the hearth's warmth (PLAYER: the Cut tool): the pieces warm up together
  {
    const sim = new Sim(71, CABIN, 0); sim.s.place = 1; sim.s.tier = 2;
    CABIN.things.forEach((t) => sim.addThing(t.id, t.x, t.z));
    sim.add(0, 'pastrel', -1.6, -1.2);
    h.enter(sim, 1, BY.PLAYER); h.run(1);
    P(EV.CUT, 0, -1, SPI('pastrel'), 0, 6);
    lifeRemove(sim.w, 0); sim.bodies[0].on = false;
    for (let k = 0; k < 6; k++) sim.add(k, 'pastrel', -2.0 + (k % 3) * 0.35, -1.25 + Math.floor(k / 3) * 0.35, { kind: k === 0 ? 1 : 2, group: 0, frac: 1 / 6, r: 0.27, seed: 7 });
    h.run(3);
    mark('cut in the warmth');
  }
  // 5. The cabin's finale: the player lights the Fireplace, then a song of three or more by the kettle's whistle
  {
    const sim = cabin(150, ['dollop', 'crimpo', 'capnap', 'puddlo', 'glugbean'], 1);
    h.enter(sim, 1, BY.PLAYER);
    P(EV.USE, USE_VERB.SWITCH, TIDg('hearth'), SPI('dollop'));         // PLAYER: the Fireplace's switch
    h.run(30);
    // PLAYER: three set down by the kettle before its whistle (the sim's kettle whistles at 40 s of every 67; the shell's every 45 to 90 s)
    const kt = CABIN.things.find((t) => t.id === 'kettle')!;
    carryTo(sim, [[kt.x - 0.7, kt.z + 0.5], [kt.x - 0.2, kt.z + 0.9], [kt.x - 1.0, kt.z - 0.1]], () => { sim.step(); h.pump(); h.flushRing(); T += 1000 / sim.fps; });
    h.run(330);
    if (process.argv.includes('--verbose')) console.log('  sings', JSON.stringify(h.records.filter((r) => r.kind === EV.SOCIAL && r.sub === SOCIAL_KIND.SING)));
    mark('cabin finale run');
  }
  // STAND-IN (not LIFE's): when C8's song of three did not come (see SG), the probe marks C8 done so Friends Everywhere opens and its
  // quests are still checked on LIFE's output; the QU-13 row below still reports C8 as not done by LIFE.
  if (!h.done('C8')) { C8_STOOD_IN = true; markDone(st, h.rt.defs, Q('C8'), createQuestOut(64)); }
  // 6. Friends Everywhere (open after two finales): a new best pair (Puddlo and Boingle: the first gifts), friendship over three days, four families' reacts
  for (let day = 0; day < 3; day++) {
    T += DAY;
    const sim = cabin(160 + day, ['puddlo', 'boingle', 'dollop', 'cushlet'], 1);
    sim.bodies[3].x = -2.4; sim.bodies[3].z = -1.25;
    h.enter(sim, 1, BY.PLAYER);
    h.run(420);
    mark(`Friends Everywhere day ${day + 1}`);
  }
  // 7. X10: five wishes the player grants (friend wishes: the friend brought out from the shelf, as the FW row)
  {
    let granted = 0;
    for (let k = 0; k < 8 && granted < 5; k++) {
      T += 6 * 60_000;
      const pairs: [string, string][] = [['crimpo', 'dollop'], ['boingle', 'puddlo'], ['dollop', 'crimpo'], ['puddlo', 'boingle']];
      const [wisher, friend] = pairs[k % pairs.length];
      h.extraOwned = [SPI(friend)];
      const sim = home(200 + k, [wisher, 'glugbean'], 0);
      h.enter(sim, 0, BY.PLAYER);
      let shown = false;
      h.run(400, () => { sim.w.co[0] = 0.95; sim.w.pl[0] = 0.2; sim.w.re[0] = 0.1; sim.w.co[1] = 0.1; sim.w.pl[1] = 0.2; if (!shown && h.records.length && h.records[h.records.length - 1].kind === EV.WISH && h.records[h.records.length - 1].sub === WISH_STATE.SHOWN) { shown = true; sim.frame = 1e9; } });
      sim.frame = Math.round(sim.t * sim.fps);
      const before = st.sc[SC.WG];
      sim.add(2, friend, 1.6, 0.2); sim.home(2, 1.6, 0.2);
      h.write(EV.BRING, 0, -1, SPI(friend), 255, 1, BY.PLAYER); h.flushRing();
      h.run(60);
      if (st.sc[SC.WG] > before) granted++;
    }
    h.extraOwned = [];
    mark('five wishes');
  }
  // QU-03 "reachable at low caps": what the long session did not reach, tried once more as a player would, with fewer out (the caps fit
  // one mover) and four families carried to the hearth's warmth
  if (tier === 0 && (!h.done('C4') || !h.done('X6') || !h.done('C8'))) {
    const sim = cabin(180, ['dollop', 'crimpo', 'capnap'], 0);
    h.enter(sim, 1, BY.PLAYER); h.run(600);
    const sim2 = cabin(181, ['cushlet', 'kneadle', 'gloopsy', 'puddlo'], 0);
    h.enter(sim2, 1, BY.PLAYER);
    carryTo(sim2, [[-2.4, -1.25], [-2.0, -1.0], [-2.8, -1.0], [-2.2, -1.5]], () => { sim2.step(); h.pump(); h.flushRing(); T += 1000 / sim2.fps; });
    h.run(120);
    mark('low retry (3 out, then four families by the hearth)');
  }
  return { h, qu13, c8StoodIn: C8_STOOD_IN, gate: h.gate };
}
// (RE-SPECIFIED in round 7, R7_LIFE: these rows said "every shown S1 quest"; from round 7 the build also ships Ripple Shore, Frostbell Ridge and Rainleaf
// Garden (the orchestrator's brief: R6_SHELL_open_s2.patch), whose 30 quests and Friends Everywhere's X4, X5, X7, X8, X9 are shown too, but this scripted
// session plays Home and the cabin only (a regular player's first hour). So the rows check the quests of the S1 places as before: Home's 10, Hearthlog's 10
// and X1, X2, X3, X6, X10 whenever they are shown (in every build that ships them); the S2 places' quests have their own rows (QC: LIFE's kinds at those
// places; R7: the squirt by ordinary play; QL: every clause's producer; probe_life_selfuse SU-01: what the squishies use there by themselves).)
const S1_QUESTS = new Set([...Array.from({ length: 10 }, (_, k) => `H${k + 1}`), ...Array.from({ length: 10 }, (_, k) => `C${k + 1}`), 'X1', 'X2', 'X3', 'X6', 'X10']);
for (const tier of [1, 0]) {
  const S = session(tier), h = S.h, qu13 = S.qu13, C8_STOOD_IN = S.c8StoodIn, st = h.rt.store.journal.st, d = h.rt.defs;
  const TN = tier === 0 ? 'low' : 'med';
  const shown = QUESTS.filter((q) => isShown(d, q.idx) && S1_QUESTS.has(q.id)).map((q) => q.id);
  const miss = shown.filter((id) => !qu13.some((x) => x.id === id) || (id === 'C8' && C8_STOOD_IN));
  const pr = new Int32Array(2);
  const missText = miss.map((id) => { questProgress(st, d, Q(id), pr); return `${id} ${pr[0]}/${pr[1]}`; }).join(', ');
  const lifeMade = h.records.filter((r) => r.by === BY.SELF).length, player = h.records.filter((r) => r.by === BY.PLAYER).length;
  console.log(`info QU-13 ${TN}: completed (where): ${qu13.map((x) => `${x.id} @${x.at}`).join(', ')}`);
  const kinds: Record<string, number> = {};
  for (const r of h.records) { const k = `${Object.keys(EV).find((q) => EV[q as keyof typeof EV] === r.kind)}${r.by === BY.PLAYER ? '(P)' : ''}`; kinds[k] = (kinds[k] ?? 0) + 1; }
  if (tier === 1) console.log(`info QU-13 ring records: ${lifeMade} by LIFE (SELF), ${player} by the scripted player; ${JSON.stringify(kinds)}`);
  if (tier === 1) check('QU-13', `every shown S1 quest (${shown.length}: H1-H10, C1-C10, X1 X2 X3 X6 X10) completes from the real lifeStep's events through the host's ring, with the player writing only the shell's own records`,
    miss.length === 0, miss.length ? `not done by LIFE: ${missText}${C8_STOOD_IN ? ' (C8 stood in by the probe so the X rows run)' : ''}` : `${qu13.length} of ${shown.length}`);
  if (tier === 0) check('QU-13', `(low) the same session on the low tier: every shown S1 quest completes from LIFE's real events`, miss.length === 0, miss.length ? `not done by LIFE: ${missText}` : `${qu13.length} of ${shown.length}, C8 by LIFE ${!C8_STOOD_IN}`);
  if (tier === 1) {
    // QU-08's producer half for LIFE's kinds: for every shown S1 clause on SOCIAL, USE by SELF, REACT, PIECES or WISH, LIFE's real records
    // in this session include one that matches every field the clause reads (sub, place, thing, minN, by; v for a wish kind)
    const LIFE_KINDS: number[] = [EV.SOCIAL, EV.USE, EV.REACT, EV.PIECES, EV.WISH];
    const unmatched: string[] = [];
    let clauses = 0;
    for (const q of QUESTS) {
      if (!isShown(d, q.idx) || !S1_QUESTS.has(q.id)) continue;   // (round 7: the S1 places' quests, see above)
      for (const c of q.clauses) {
        if (!LIFE_KINDS.includes(c.ev) || c.by === BY.PLAYER) continue;
        if (c.ev === EV.WISH && c.sub && c.sub[0] !== WISH_STATE.GRANTED) continue;   // SEEN is the card's tap (the player)
        if (q.id === 'H8') continue;   // the scripted first wish's grant is the reducer's own on the first arrival (QUESTS 8, QU-15), not LIFE's
        clauses++;
        const ok = h.records.some((r) => r.kind === c.ev && (r.by === BY.SELF || c.ev === EV.WISH) && (!c.sub || c.sub.includes(r.sub)) && (c.place === undefined || (c.place === 'away' ? r.place !== 0 : r.place === c.place))
          && (c.thing === undefined || r.thing === c.thing) && (c.minN === undefined || r.n2 >= c.minN) && (c.v === undefined || c.ev !== EV.WISH || r.v === c.v));
        if (!ok) unmatched.push(q.id);
      }
    }
    check('QU-08', `(the producer half, LIFE's kinds) every shown S1 clause on SOCIAL / USE by itself / REACT / PIECES / WISH GRANTED (${clauses}; H8's scripted grant is the reducer's) is matched field by field (sub, place, thing, minN, v) by a record LIFE really produced in the med session`,
      unmatched.length === 0, unmatched.length ? `unmatched: ${unmatched.join(' ')}` : '');
  }
  if (tier === 0) {
    const g = S.gate;
    check('QU-03', `(the gate half) the same session on LOW (moverCap ${moverCapOf(0)}, unitCap ${unitCapOf(0).toFixed(2)}): every shown S1 quest LIFE completed on med completes on low too, under LF-10's gate watched on every step (movers over the cap, a character in two moments, a start that woke a body over unitCap + the ride allowance)`,
      miss.length === 0 && g.movers === 0 && g.moment === 0 && g.wake === 0, `${miss.length ? `not done by LIFE: ${missText}; ` : ''}gate: movers over ${g.movers}, double moments ${g.moment}, wakes over ${g.wake}`);
  } else {
    const g = S.gate;
    console.log(`info QU-13 med gate: movers over ${g.movers}, double moments ${g.moment}, wakes over ${g.wake}`);
  }
}

/* ═══════════════ EC-02 (LIFE's part on the real lifeStep): a no-input hour ═══════════════
 * 30 sim minutes at Home and 30 at the cabin (the dev hook's travel, by SELF), four out, no input at all: LIFE's real records through the
 * host's ring into the real collection. The shell rig half (4 moving mock bodies, haptics, the camera, the feedback spy: EC-02 / EC-03
 * proper) needs PG_SHELL's rig and is NOT RUN here. */
{
  T = 20500 * DAY + 10 * 3_600_000;
  const h = new QHost(29);
  const m0 = h.c.meter(), tasks0 = JSON.stringify(h.c.tasks().map((t) => [t.progress, t.done])), opened0 = h.c.practice().opened;
  const st = h.rt.store.journal.st, d = h.rt.defs, out = createQuestOut(64);
  applyEventFields(st, d, out, EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE);   // the first wish already shown (Hearthlog open)
  const hm = home(301, ['dollop', 'crimpo', 'capnap', 'puddlo'], 0);
  h.enter(hm, 0, BY.SELF); h.run(1800);
  const cb = cabin(302, ['dollop', 'crimpo', 'capnap', 'puddlo'], 1);
  h.enter(cb, 1, BY.SELF); h.run(1800);
  const m1 = h.c.meter(), tasks1 = JSON.stringify(h.c.tasks().map((t) => [t.progress, t.done]));
  const quests = h.qEvents.filter((e) => e.type === 'quest') as Extract<CollectionEvent, { type: 'quest' }>[];
  const ready = (h.c.journal!()?.gifts ?? []).filter((g) => g.state === 'ready').length;
  const byP = h.records.filter((r) => r.by === BY.PLAYER).length;
  check('EC-02', `(LIFE's part, real lifeStep) a no-input hour, 30 min at Home + 30 at the cabin, 4 out: 0 SP, 0 task progress, 0 capsules, 0 gifts claimable, 0 by-PLAYER records, while quest moments played (${quests.length}: ${quests.map((e) => QUESTS[e.quest].id).join(' ')})`,
    m1.sp === m0.sp && m1.credits === m0.credits && tasks1 === tasks0 && h.c.practice().opened === opened0 && ready === 0 && byP === 0 && quests.length > 0 && quests.every((e) => !e.byPlayer),
    `${h.records.length} LIFE records; SP ${m0.sp} -> ${m1.sp}, credits ${m0.credits} -> ${m1.credits}, gifts ready ${ready}`);
  h.c.dispose();
}

/* ═══════════════ QC: QU-14's LIFE half on every PlaceDef (S2 / S3 included: PG_DATA's finished defs) ═══════════════
 * journal.ts PLACE_CAPS says what can happen at each place (QU-14 recomputes it from the defs in probe_quests). Here the REAL lifeStep runs at
 * every place on this kinematic host (wide layout, all its things out, five of different families with the place's lovers first; every 15 s
 * the host sets each body down in the next zone or at the next thing, as a carry would) and the check is the other direction: every REACT,
 * SOCIAL and USE that LIFE emits at a place is inside that place's caps, and every thing it names is THING_PLACE's for that place. A LIFE kind
 * outside the caps would mean the shown set hides a quest LIFE can do there (or the tracker skips it). The coverage line (info) lists the
 * chapter's clauses LIFE produced on this host; what it did not produce is not evidence of a problem (no contacts, no real water or riding). */
{
  // (round 6, D-96: by place idx, the dropped three's slots null: they have no PlaceDef and are skipped)
  const PLACE_MODS: (PlaceDef | null)[] = [];
  for (const id of PLACE_IDS) PLACE_MODS.push(placeDropped(id) ? null : ((await import(`../src/data/place_${id}.ts`)) as { PLACE: PlaceDef }).PLACE);
  const bitOf = (k: number): number => 1 << k;
  const famFirst = MATERIAL_FAMILY_IDS.map((f) => CATALOG.find((c) => c.family === f)!.id);
  const outside: string[] = [], cover: string[] = [];
  let totalEv = 0;
  for (let p = 2; p < PLACE_MODS.length; p++) {
    const def = PLACE_MODS[p], caps = PLACE_CAPS[p];
    if (!def) continue;
    const lovers = Object.entries(SPECIES_LIFE_T as Record<string, { place: string }>).filter(([, l]) => l.place === def.id).map(([id]) => id);
    const party: string[] = [];
    for (const id of [...lovers, ...famFirst]) if (party.length < 5 && !party.includes(id) && !party.some((q) => CATALOG.find((c) => c.id === q)!.family === CATALOG.find((c) => c.id === id)!.family && !lovers.includes(id))) party.push(id);
    const seen = { react: new Set<number>(), social: new Set<number>(), use: new Set<string>() };
    for (const seed of [5, 6]) {
      const sim = new Sim(seed, def, 0, 30);
      sim.s.place = p; sim.s.tier = 2;
      const spawn = (Array.isArray(def.spawn) ? def.spawn : [[0, 0]]) as readonly (readonly [number, number])[];
      party.forEach((sp, i) => sim.add(i, sp, spawn[i % spawn.length][0], spawn[i % spawn.length][1], { seed: seed * 1000 + i * 101, float: i % 2 === 0 }));
      def.things.forEach((t) => sim.addThing(t.id, t.x, t.z));
      const spots: number[][] = [...def.zones.map((z) => [z.x, z.z]), ...def.things.map((t) => [t.x, t.z])];
      for (let k = 0; k < 16; k++) {
        party.forEach((_, i) => { const sp2 = spots[(k + i * 3) % spots.length], b = sim.bodies[i]; b.x = sp2[0] + 0.15 * i; b.z = sp2[1]; b.scoot = false; b.asleep = false; b.still = 0; });
        sim.run(15);
      }
      for (const e of sim.evs) {
        if (e.kind !== LIFE_EV.REACT && e.kind !== LIFE_EV.SOCIAL && e.kind !== LIFE_EV.USE && e.kind !== LIFE_EV.PIECES) continue;
        totalEv++;
        const tag = `${def.id}:${e.kind === LIFE_EV.REACT ? 'REACT' : e.kind === LIFE_EV.SOCIAL ? 'SOCIAL' : e.kind === LIFE_EV.USE ? 'USE' : 'PIECES'} ${e.sub}${e.thing >= 0 ? ' ' + THING_IDS[e.thing] : ''}`;
        if (e.kind === LIFE_EV.REACT) { seen.react.add(e.sub); if (!(caps.reacts & bitOf(e.sub))) outside.push(tag); }
        if (e.kind === LIFE_EV.SOCIAL) { seen.social.add(e.sub); if (!(caps.socials & bitOf(e.sub))) outside.push(tag); }
        if (e.kind === LIFE_EV.USE) { seen.use.add(`${e.sub}:${e.thing}`); if (!(caps.verbs & bitOf(e.sub))) outside.push(tag); }
        if (e.thing >= 0 && THING_PLACE[e.thing] !== p) outside.push(`${tag} (thing of place ${THING_PLACE[e.thing]})`);
      }
    }
    // coverage: the chapter's REACT / SOCIAL / USE clauses LIFE produced here (by sub and, when named, thing)
    const ch = CHAPTERS.findIndex((c) => c.place === p);
    const want: string[] = [], got: string[] = [];
    for (const q of QUESTS) {
      if (q.chapter !== ch) continue;
      for (const c of q.clauses) {
        if (c.ev !== EV.REACT && c.ev !== EV.SOCIAL && c.ev !== EV.USE) continue;
        const subs: readonly number[] = c.sub ?? [];
        const th = c.thing ?? -1;
        if ((c.by ?? 0) === 1) continue;   // the player's own (set on, ring): not LIFE's
        want.push(q.id);
        const hit = c.ev === EV.REACT ? (subs.length === 0 ? seen.react.size > 0 : subs.some((x) => seen.react.has(x))) : c.ev === EV.SOCIAL ? (subs.length === 0 ? seen.social.size > 0 : subs.some((x) => seen.social.has(x)))
          : [...seen.use].some((u) => { const [v, t] = u.split(':').map(Number); return (subs.length === 0 || subs.includes(v)) && (th < 0 || t === th); });
        if (hit) got.push(q.id);
      }
    }
    cover.push(`${def.id} ${got.length}/${want.length}${want.filter((x) => !got.includes(x)).length ? ' (not on this host: ' + want.filter((x) => !got.includes(x)).join(' ') + ')' : ''}`);
  }
  check('QC', `(QU-14's LIFE half) at the 5 S2 / S3 places (round 6, D-96: was 8) the real lifeStep (2 seeds x 4 min each, five out, set down zone by zone) emits only REACT / SOCIAL / USE kinds inside journal.ts PLACE_CAPS, and names only that place's things (THING_PLACE)`,
    outside.length === 0 && totalEv > 0, outside.length ? [...new Set(outside)].join(', ') : `${totalEv} LIFE events`);
  console.log(`info QC the chapters' REACT / SOCIAL / USE clauses LIFE produced on this host: ${cover.join('; ')}`);
}

/* ── (round 6, R6_DATA item 3) R7 "A squirt for a friend" by ordinary play: the real lifeStep at Ripple Shore, an S2 build's rules ──
 * The player sets a marshmallow (Wisplet) in the Rock Pool and a friend (Dollop) on the sand beside it, autonomy off so neither walks away (the
 * same with it on, only slower to stage); the foam soaks in the water (LIFE's soak look, 0.06 / s for a marshmallow); once soaked (0.5, the
 * SOAK record) the player squeezes it 0.6 s (a squeeze, not a tap: QUESTS Q3). LIFE's events go to the reducer as the host's ring writer
 * writes them (src/shell/later-life.ts pumpEvents: a SOCIAL event -> EV.SOCIAL at the current place). R7 is SOCIAL{SQUIRT, place ripple} x1. */
{
  const dS2 = buildQuestDefs({ placeIds: PLACE_IDS, thingIds: THING_IDS, shipped: PLACE_IDS.map((_, i) => i <= 4), opensAt: PLACE_OPENS_AT, thingPlace: THING_PLACE, caps: PLACE_CAPS });
  const st = createQuestState(dS2), out = createQuestOut(64); st.sc[SC.FW] = 1; st.sc[SC.PL] = 0b11111;
  const r = new LSim(191, RIPPLE, 0); r.s.place = 2; r.s.tier = 1; r.s.autonomy = false; RIPPLE.things.forEach((t) => r.addThing(t.id, t.x, t.z));
  const pool = RIPPLE.zones[0];
  r.add(0, 'wisplet', pool.x - 0.3, pool.z + 0.2, { float: true }); r.add(1, 'dollop', pool.x - (pool.r ?? 1.3) - 0.45, pool.z + 0.2); r.physics = false;
  let soakT = -1; for (let k = 0; k < 60 && soakT < 0; k++) { r.run(0.5); if (r.w.lo[LOOK.soak] >= 0.5) soakT = r.t; }
  const soakRec = r.events(LIFE_EV.REACT, REACT_KIND.SOAK).filter((e) => e.a === 0).length;
  r.extraFlags[0] = LIFE_FLAG.TOUCHED; r.run(0.6); r.extraFlags[0] = 0; r.touch[0] = TOUCH.SQUEEZE; r.run(1.0);
  const R7 = QUESTS.findIndex((q) => q.id === 'R7'), shown = isShown(dS2, R7);
  for (const e of r.evs) if (e.kind === LIFE_EV.SOCIAL) {
    const a = r.bodies[e.a]?.species ?? 255, b = e.b < 16 ? r.bodies[e.b].species : 255;
    applyEventFields(st, dS2, out, EV.SOCIAL, e.sub, 2, e.thing, a, b, a < CATALOG.length ? MATERIAL_FAMILY_IDS.indexOf(CATALOG[a].family) : 255, e.n2, BY.SELF, 0, 0);
  }
  const arcs = r.events(LIFE_EV.SQUIRT);
  check('R7', `(round 6) "A squirt for a friend" by ordinary play (an S2 build, the real lifeStep at Ripple Shore): the marshmallow soaks in the Rock Pool (0.5 at ${soakT.toFixed(1)} s, SOAK ${soakRec}), the player's 0.6 s squeeze squirts at Dollop (arc ${arcs.map((e) => `b ${e.b}`).join(',') || 'none'}), R7 shown ${shown}, done ${isDone(st, R7)}`,
    shown && soakT > 0 && soakT < 20 && arcs.length === 1 && arcs[0].b === 1 && isDone(st, R7));
}

/* ── (round 6, R6_DATA item 5) Lanternroof and Cloudloft complete: every clause of their chapters has a producer in the data LIFE and the shell read ──
 * REACT: a REACT_TRIGGERS row for the kind and the place's caps; SOCIAL: a SOCIAL table row and the caps, its named thing at the place with the
 * mechanism the moment needs (PUSH a swing, COPY pads, PASS a ball, PARADE an arch, PILE a ring); USE: the named thing at the place with that verb
 * (a "distinct part" count no larger than its parts); PIECES: the kind's trigger or a thing of the verb there; DISCOVER F1: fans of the place
 * (SPECIES_LIFE); VISIT: an opening count. Wishes: the place takes a THING wish (THING_KINDS) and is never masked from LIFE's wish places (D-96).
 * The LIFE producers themselves are probe_life's LF-21 / LF-22 rows (wide) and LF-24 (the re-laid tall layouts). */
{
  const MECH_OF: Record<number, number> = { [SOCIAL_KIND.PUSH]: MECH.swing, [SOCIAL_KIND.COPY]: MECH.pad, [SOCIAL_KIND.PASS]: MECH.ball, [SOCIAL_KIND.PARADE]: MECH.bar, [SOCIAL_KIND.PILE]: MECH.ring };
  const bad: string[] = [], seen: string[] = [];
  for (const def of [LANTERNROOF_D, CLOUDLOFT_D]) {
    const p = def.idx, caps = PLACE_CAPS[p], ch = CHAPTERS.findIndex((c) => c.place === p);
    const fans = Object.values(SPECIES_LIFE_T as Record<string, { place: string }>).filter((l) => l.place === def.id).length;
    let n = 0;
    for (const q of QUESTS) {
      if (q.chapter !== ch || q.dropped) continue;
      for (const c of q.clauses) {
        n++;
        const subs: readonly number[] = c.sub ?? [], th = c.thing ?? -1, tk = th >= 0 ? def.things.findIndex((t) => t.id === THING_IDS[th]) : -1, tdef = tk >= 0 ? def.things[tk] : null;
        const why = (w: string): void => { bad.push(`${q.id}: ${w}`); };
        if (th >= 0 && (THING_PLACE[th] !== p || !tdef)) why(`its thing ${THING_IDS[th]} is not ${def.id}'s`);
        if (c.ev === EV.VISIT) { if (!(PLACE_OPENS_AT[p] > 0)) why('no opening count'); }
        else if (c.ev === EV.REACT) { for (const k of subs) { if (!REACT_TRIGGERS.some((t) => t.kind === k)) why(`REACT ${k} has no trigger`); if (!(caps.reacts & (1 << k))) why(`REACT ${k} outside the caps`); } }
        else if (c.ev === EV.SOCIAL) { for (const k of subs) { if (!SOCIAL_TABLE.some((r) => r.kind === (k === SOCIAL_KIND.PARADE ? SOCIAL_KIND.COPY : k))) why(`SOCIAL ${k} has no row`);   // PARADE is S05 COPY with 3 or more (LIFE 6.1) if (!(caps.socials & (1 << k))) why(`SOCIAL ${k} outside the caps`);
          if (tdef && MECH_OF[k] !== undefined && tdef.mech !== MECH_OF[k]) why(`SOCIAL ${k} at ${tdef.id} (mech ${tdef.mech}, wants ${MECH_OF[k]})`); if (tdef && k === SOCIAL_KIND.PARADE && !tdef.p.arch) why('PARADE under no arch'); } }
        else if (c.ev === EV.USE) { if (!tdef) why('USE names no thing'); else { if (!subs.includes(tdef.verb)) why(`${tdef.id}'s verb ${tdef.verb} is not ${subs.join('/')}`); if (!(caps.verbs & (1 << tdef.verb))) why('USE outside the caps');
          if (c.distinct === 'part' && (tdef.p.n ?? 1) < c.count) why(`${c.count} distinct parts of ${tdef.p.n ?? 1}`); } }
        else if (c.ev === EV.PIECES) { for (const k of subs) { if (k >= PIECES_USE ? !def.things.some((t) => t.verb === k - PIECES_USE) : !REACT_TRIGGERS.some((t) => t.kind === k)) why(`PIECES ${k} has no producer here`); } }
        else if (c.ev === EV.DISCOVER) { if (fans < 1) why('no fan of the place (F1)'); }
        else why(`clause ev ${c.ev} not covered by this row`);
      }
    }
    if (!(THING_KINDS[def.id as keyof typeof THING_KINDS] > 0)) bad.push(`${def.id}: no THING wish kind`);
    if (DROPPED_PLACE_MASK & (1 << p)) bad.push(`${def.id}: masked from LIFE's wish places`);
    seen.push(`${def.id} ${n} clauses, ${fans} fans, THING_KINDS ${THING_KINDS[def.id as keyof typeof THING_KINDS]}`);
  }
  check('QL', `(round 6) Lanternroof and Cloudloft complete: every clause of L1..L10 and U1..U10 has its producer in the data (${seen.join('; ')})`, bad.length === 0, bad.join(' | '));
}

console.log(`\n${fails === 0 ? `all ${oks} checks passed` : `${fails} FAILED, ${oks} ok`}`);
process.exit(fails ? 1 : 0);
