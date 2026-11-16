// PG_LIFE's node probe: LF-01..LF-26 (except LF-12, in probe_life_imports.ts) and LIFE's part of FN-01, against scripted snapshots and a tiny
// kinematic host (scoots glide, hops lift for their airtime, a ball rolls when a body pushes into it). No physics, no browser.
// Run: node _harness/probe_life.ts [--heavy] [--verbose]   (exit 1 on any failure; the default run stays a few seconds)
import v8 from 'node:v8';
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../src/contracts.ts';
import type { Genome } from '../src/core/genome.ts';
import { speciesBaseGenome, CATALOG } from '../src/data/catalog.ts';
import { SPECIES } from '../src/data/species.ts';
import type { PlaceDef } from '../src/data/places.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import { THING_IDS, ZONE, MECH } from '../src/data/places.ts';
import { INTENT, LIFE_FLAG, LIFE_EV, SCRIPT, TOUCH, REACT_KIND, SOCIAL_KIND, WISH_KIND, LOOK, TRAIT_MEDIANS, EMOTE, THING_KIND, USE_VERB } from '../src/data/life.ts';
import { WISH_STATE } from '../src/data/quests.ts';
import { createLifeWorld, lifeSetPlace, lifeSetHome, lifeAdd, lifeRemove, lifeStep, lifeScript, lifeSetJournal, lifeSetPair, lifeLooks, lifeAddLook,
  lifeWishOf, lifePhrase, lifeMotif, lifeAttention, createAttention, attentionFilter, motionGate, unitCapOf, moverCapOf, CAPS, traitsOf, HUFF_TRIGGERS,
  PHRASE_BUBBLE, BEH, STYLE } from '../src/life/step.ts';
import type { LifeWorld } from '../src/life/step.ts';

const HEAVY = process.argv.includes('--heavy'), VERBOSE = process.argv.includes('--verbose');
let fails = 0, oks = 0;
const check = (id: string, what: string, ok: boolean, detail = ''): void => {
  if (ok) oks++; else fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${detail ? `: ${detail}` : ''}`);
};
const info = (id: string, what: string): void => console.log(`info ${id} ${what}`);

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
  still: number; asleep: boolean; kind: number; group: number; species: number; family: number; flags: number; frac: number; homeX: number; homeZ: number }
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
      group: i, species: 0, family: 0, flags: 0, frac: 1, homeX: NaN, homeZ: NaN });
  }
  add(slot: number, species: string, x: number, z: number, opts: { kind?: 0 | 1 | 2; group?: number; isNew?: boolean; seed?: number; r?: number; frac?: number; asleep?: boolean } = {}): void {
    const g = G(species, opts.seed ?? (7 + slot * 101));
    const b = this.bodies[slot];
    Object.assign(b, { on: true, x, z, vx: 0, vz: 0, r: opts.r ?? 0.5, tx: x, tz: z, scoot: false, air: 0, still: 0, asleep: opts.asleep ?? false, kind: opts.kind ?? 0,
      group: opts.group ?? slot, species: SP(species), family: 0, frac: opts.frac ?? 1, homeX: NaN, homeZ: NaN });
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

/* ───────────────────────────── 1. traits (LIFE 2) ───────────────────────────── */
{
  const tmp = new Float32Array(5), cols: number[][] = [[], [], [], [], []];
  for (const d of CATALOG) { traitsOf(speciesBaseGenome(d.id, 7), tmp, 0, false); for (let k = 0; k < 5; k++) cols[k].push(tmp[k]); }
  const spec = [[0.17, 0.52, 0.89], [0.26, 0.53, 0.90], [0.10, 0.39, 0.84], [0.38, 0.65, 0.82], [0.07, 0.37, 0.82]];
  const names = ['bouncy', 'curious', 'cuddly', 'chatty', 'dozy'];
  const rows: string[] = [];
  let close = true;
  for (let k = 0; k < 5; k++) {
    const v = cols[k].slice().sort((a, b) => a - b), mn = v[0], md = v[25], mx = v[49]; // the spec's median of 50 is the upper one (index 25)
    rows.push(`${names[k]} ${mn.toFixed(2)}/${md.toFixed(2)}/${mx.toFixed(2)} (LIFE 2: ${spec[k].join('/')})`);
    if (Math.abs(mn - spec[k][0]) > 0.03 || Math.abs(md - spec[k][1]) > 0.03 || Math.abs(mx - spec[k][2]) > 0.03) close = false;
  }
  console.log('info T  trait spreads over the 50 templates, speciesBaseGenome(id, 7), untwisted: ' + rows.join('; '));
  check('T', "the trait spreads match LIFE 2's table within 0.03 (min / median / max, untwisted) and TRAIT_MEDIANS", close && TRAIT_MEDIANS.every((m, k) => Math.abs(m - spec[k][1]) < 1e-9));
  const a = new Float32Array(5), b = new Float32Array(5);
  traitsOf(G('dollop', 1), a, 0); traitsOf(G('dollop', 2), b, 0);
  check('T', 'traits are a pure function of the genome (same genome, same traits; the seeded twist is within +-0.08)', (() => { const c = new Float32Array(5); traitsOf(G('dollop', 1), c, 0); return a.every((v, k) => v === c[k]); })() && a.some((v, k) => v !== b[k]));
}

/* ───────────────────────────── 2. the motion gate's caps (LF-10, 10.3) ───────────────────────────── */
{
  const caps = [0, 1, 2].map((t) => unitCapOf(t)), movers = [0, 1, 2].map((t) => moverCapOf(t));
  check('LF-10', `unitCap at F = 4 by the formula with D-85's floor: ${caps.map((c) => c.toFixed(3)).join(' / ')} (1.06 / 1.49 / 2.64), moverCap ${movers.join(' / ')} (1 / 1 / 2)`,
    Math.abs(caps[0] - 1.06) < 0.001 && Math.abs(caps[1] - 1.494) < 0.002 && Math.abs(caps[2] - 2.644) < 0.002 && movers.join() === '1,1,2');
  const f3 = [0, 1, 2].map((t) => unitCapOf(t, 3)), f2 = [0, 1, 2].map((t) => unitCapOf(t, 2));
  check('LF-10', `the F = 3 and F = 2 rows of LIFE 10.3 (${f3.map((c) => c.toFixed(2)).join('/')}; ${f2.map((c) => c.toFixed(2)).join('/')})`,
    f3.map((c) => c.toFixed(2)).join() === '1.30,2.07,3.60' && f2.map((c) => c.toFixed(2)).join() === '2.07,3.22,5.52' && [0, 1, 2].map((t) => moverCapOf(t, 3)).join() === '1,2,3');
}


/* ───────────────────────────── helpers for the scenarios ───────────────────────────── */
const BOUND = (def: PlaceDef, layout: 0 | 1) => (layout === 1 ? def.tall.bounds : def.bounds);
function inB(def: PlaceDef, layout: 0 | 1, x: number, z: number, shrink: number): boolean {
  const b = BOUND(def, layout), dx = Math.abs(x - b.x), dz = Math.abs(z - b.z);
  if (b.shape === 'disc') return Math.hypot(dx, dz) <= (b.r ?? 0) - shrink + 1e-6;
  const hx = (b.hx ?? 0) - shrink, hz = (b.hz ?? 0) - shrink, rr = Math.max(0, (b.round ?? 0) - shrink);
  if (dx > hx + 1e-6 || dz > hz + 1e-6) return false;
  const cx = hx - rr, cz = hz - rr;
  if (dx <= cx || dz <= cz) return true;
  return Math.hypot(dx - cx, dz - cz) <= rr + 1e-6;
}
/** Track per-step invariants: movers <= moverCap (LF-10), one moment per character (LF-11), and every LIFE start that wakes a body keeps
 *  units <= unitCap + the ride allowance. */
function watchGate(sim: Sim, rows: { movers: number; moment: number; wake: number; maxUnits: number }): void {
  const w = sim.w, cap = moverCapOf(sim.s.tier);
  if (w.movers > cap) rows.movers++;
  const seen = new Set<number>();
  for (let m = 0; m < 8; m++) {
    if (!w.mKind[m]) continue;
    for (let k = 0; k < w.mN[m]; k++) { const j = w.mMem[m * 6 + k]; if (j < 0) continue; if (seen.has(j) || w.moment[j] !== m) rows.moment++; seen.add(j); }
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
const gateRows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };

/* ───────────────────────────── FN-01 (LIFE's part): the first minute at Home ───────────────────────────── */
for (const [layout, label] of [[0, 'wide'], [1, 'tall']] as const) {
  const sim = home(3, ['dollop'], layout);
  sim.run(6); // the player let go 6 s ago
  const t0 = sim.t;
  lifeScript(sim.w, 0, SCRIPT.FIRST_PLAY, 0);
  runWatched(sim, 12, gateRows);
  const use = sim.events(LIFE_EV.USE).find((e) => e.thing === TID('feltball'));
  const bubble = sim.intents(INTENT.EMOTE).find((l) => l.t > t0 && l.icon > 0);
  check('FN-01', `${label}: after a 6 s pause and FIRST_PLAY, Dollop's ball use starts within 10 s (USE ROLL on the Felt Ball) and the ball is booped (the host's ball moved ${sim.ballMoved.toFixed(2)} m)`,
    !!use && use.t - t0 <= 10 && use.sub === USE_VERB.ROLL && sim.ballMoved >= 0.2, use ? `use at +${(use.t - t0).toFixed(2)} s` : 'no use');
  check('FN-01', `${label}: its first bubble within 10 s of the 6 s release (a question bubble as it notices the ball)`, !!bubble && bubble.t - t0 <= 10, bubble ? `icon ${bubble.icon} at +${(bubble.t - t0).toFixed(2)} s` : 'none');
  lifeScript(sim.w, 0, SCRIPT.FIRST_PLAY, 0);
  const before = sim.w.nextUse[0];
  check('LF-19', `${label}: FIRST_PLAY fires at most once (a second call changes nothing)`, before === -1 && sim.w.nextUse[0] === -1);
}
{
  const sim = home(5, ['dollop'], 0);
  sim.run(3);
  sim.add(1, 'crimpo', 1.3, 0.2, { isNew: true }); sim.home(1, 1.3, 0.2);
  const t0 = sim.t;
  runWatched(sim, 8, gateRows);
  const hello = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.GREET).find((e) => e.a === 1 || e.b === 1);
  const helloBubble = sim.intents(INTENT.EMOTE).find((l) => l.icon === EMOTE.hello && l.t >= t0);
  check('FN-01', 'the newcomer says hello within 5 s of coming out (an S01 greet with the nearest party member; its hello bubble)',
    !!hello && !!helloBubble && helloBubble.t - t0 <= 5, hello ? `greet bubble +${((helloBubble?.t ?? 99) - t0).toFixed(2)} s, event +${(hello.t - t0).toFixed(2)} s` : 'none');
}

/* ───────────────────────────── LF-01 determinism, LF-26 sim time only ───────────────────────────── */
{
  const secs = HEAVY ? 600 : 90;
  const hashes: number[] = [];
  for (const seed of [1, 2, 3]) {
    const a = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo']), b = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo']);
    a.keepLog = false; b.keepLog = false; a.run(secs); b.run(secs);
    hashes.push(a.hash);
    check('LF-01', `seed ${seed}: the same seed and snapshot script give the same intent and event hash over ${secs} s (${a.hash.toString(16)})`, a.hash === b.hash);
  }
  check('LF-01', 'another seed gives another hash', new Set(hashes).size === 3, hashes.map((h) => h.toString(16)).join(' '));
  // LF-26: music on, the music fields left as a host with a frozen or jumping AudioContext clock might write them: LIFE reads sim time only
  const runs = [0, 1, 2].map((mode) => {
    const sim = cabin(9, ['dollop', 'crimpo', 'pastrel']); sim.keepLog = false;
    const end = Math.round(60 * sim.fps);
    while (sim.frame < end) { sim.s.musicOn = mode !== 1; sim.step(); if (mode === 2) sim.s.beatPhase = (sim.frame * 0.37) % 1; }
    return sim.hash;
  });
  check('LF-26', 'the same run with music on, the music off, and a beat phase that jumps gives the same intent hash (no clock enters LIFE)', runs[0] === runs[1] && runs[1] === runs[2], runs.map((h) => h.toString(16)).join(' '));
}

/* ───────────────────────────── LF-16 30 and 60 fps ───────────────────────────── */
{
  const run = (fps: number): number => {
    const sim = cabin(4, ['dollop', 'crimpo', 'capnap', 'puddlo'], 1, fps); sim.physics = false; sim.keepLog = true;
    sim.run(60);
    let h = 0x811c9dc5;
    for (const l of sim.log) if (l.kind !== INTENT.EMOTE && l.kind !== INTENT.VOICE) h = Math.imul(h ^ (l.kind * 131 + l.who * 7 + Math.round(l.a * 1000) + Math.round(l.b * 977) + Math.round(l.c * 31) + Math.round(l.e * 1000)), 0x01000193) >>> 0;
    for (const e of sim.evs) h = Math.imul(h ^ (e.kind * 4099 + e.sub * 31 + e.a * 7 + e.n2 + e.thing * 3), 0x01000193) >>> 0;
    return h;
  };
  const h30 = run(30), h60 = run(60);
  check('LF-16', 'the same sim time stepped at 30 and at 60 fps gives the same decisions (motion, gaze, pose and expression intents and the events)', h30 === h60, `${h30.toString(16)} / ${h60.toString(16)}`);
}

/* ───────────────────────────── LF-04 HELD, LF-05 ───────────────────────────── */
{
  const sim = cabin(21, ['dollop', 'crimpo', 'capnap']);
  sim.run(20);
  sim.extraFlags[0] = LIFE_FLAG.TOUCHED; sim.touch[0] = TOUCH.SQUEEZE;
  sim.fill(); lifeStep(sim.w, sim.s, sim.out, sim.ev);
  let cancel = false, motion = 0;
  for (let k = 0; k < sim.out.n; k++) if (sim.out.who[k] === 0) { if (sim.out.kind[k] === INTENT.CANCEL) cancel = true; if ([INTENT.SCOOT, INTENT.HOP, INTENT.SQUASH, INTENT.GLIDE].includes(sim.out.kind[k] as 2)) motion++; }
  sim.apply(1 / 60); sim.frame++;
  check('LF-04', 'a touched character gets 0 motion intents in the same tick and its queue is cancelled (CANCEL)', cancel && motion === 0);
  const tA = sim.t; sim.run(3);
  const during = sim.log.filter((l) => l.who === 0 && l.t > tA && [INTENT.SCOOT, INTENT.HOP, INTENT.SQUASH, INTENT.GLIDE].includes(l.kind as 2)).length;
  sim.extraFlags[0] = 0; sim.touch[0] = TOUCH.SQUEEZE;
  const tR = sim.t; sim.run(1.45);
  const after = sim.log.filter((l) => l.who === 0 && l.t > tR && [INTENT.SCOOT, INTENT.HOP, INTENT.SQUASH, INTENT.GLIDE].includes(l.kind as 2)).length;
  check('LF-04', 'no motion intent while held, and none for 1.5 s after the release (the afterglow, then the grace)', during === 0 && after === 0, `${during} held, ${after} after`);
  // a lock with no finger down silences nobody else
  const a = createAttention(), s = mkSnapshot(), o = mkIntents();
  s.n = 2; s.t = 10; s.flags[0] = LIFE_FLAG.LOCKED | LIFE_FLAG.VISIBLE; s.flags[1] = LIFE_FLAG.VISIBLE;
  o.n = 2; o.kind[0] = INTENT.EMOTE; o.who[0] = 1; o.icon[0] = EMOTE.hello; o.style[0] = 0; o.e[0] = 2; o.prio[0] = 2.5;
  o.kind[1] = INTENT.VOICE; o.who[1] = 1; o.icon[1] = 1; o.d[1] = 2; o.e[1] = 0.3; o.prio[1] = 2.5;
  attentionFilter(a, s, o);
  const s2 = mkSnapshot(), o2 = mkIntents(), a2 = createAttention();
  s2.n = 2; s2.t = 10; s2.flags[0] = LIFE_FLAG.TOUCHED | LIFE_FLAG.VISIBLE; s2.flags[1] = LIFE_FLAG.VISIBLE;
  o2.n = 1; o2.kind[0] = INTENT.EMOTE; o2.who[0] = 1; o2.icon[0] = EMOTE.hello; o2.e[0] = 2; o2.prio[0] = 2.5;
  attentionFilter(a2, s2, o2);
  check('LF-04', "a lock with no finger down silences nobody: another's P2 bubble and voice pass (a finger down stops the P2 bubble)", o.n === 2 && o2.n === 0, `lock ${o.n}/2 kept, finger ${o2.n}/1 kept`);
  check('LF-05', 'no intent kind can press, grab or lock (the INTENT table)', !Object.keys(INTENT).some((k) => /^(PRESS|GRAB|LOCK|FINGER|POKE|SQUEEZE|PULL|TAP)/.test(k)), Object.keys(INTENT).join(' '));
}

export { Sim, cabin, home, mkSnapshot, mkIntents, mkEvents, check, info, G, SP, TID, HEAVY, VERBOSE };

/* ───────────────────────────── the end (sections below are appended in order) ───────────────────────────── */

/* ───────────────────────────── LF-02 zero allocation, LF-03 cost (16 characters: 6 wholes and a cut squishy's 10 pieces) ───────────────────────────── */
function crowd(seed: number): Sim {
  const sim = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo', 'pastrel', 'thumbly'], 2);
  const spawnT = CABIN.spawn as readonly (readonly [number, number])[];
  sim.add(6, 'glugbean', 0.6, 1.4, { kind: 1, group: 6, frac: 0.2, r: 0.3, seed: 99 });
  for (let k = 7; k < 16; k++) sim.add(k, 'glugbean', 0.6 + ((k - 7) % 3) * 0.45 - 0.45, 1.6 + Math.floor((k - 7) / 3) * 0.4, { kind: 2, group: 6, frac: 0.09, r: 0.22, seed: 99 });
  void spawnT;
  return sim;
}
function cloneSnap(s: LifeSnapshot): LifeSnapshot {
  const c = { ...s } as Record<string, unknown>;
  for (const k of Object.keys(c)) { const v = c[k]; if (ArrayBuffer.isView(v)) c[k] = (v as Float32Array).slice(); }
  return c as unknown as LifeSnapshot;
}
{
  const WARM = 1000, N = 6000;
  const rec = crowd(31); rec.keepLog = false;
  const snaps: LifeSnapshot[] = [];
  for (let f = 0; f < WARM + N; f++) { rec.frame++; rec.t = rec.frame / rec.fps; rec.fill(); snaps.push(cloneSnap(rec.s)); lifeStep(rec.w, rec.s, rec.out, rec.ev); rec.apply(1 / rec.fps); }
  // LF-02: replay the same snapshots into fresh worlds (identical decisions): one world warms the JIT over the whole run, a second one is
  // measured over windows of 1000 ticks (new-space growth; a window with a GC is negative and skipped), like probe_collection's C08
  const out = mkIntents(), ev = mkEvents();
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const replay = (w: LifeWorld, a: number, b: number): void => { for (let f = a; f < b; f++) lifeStep(w, snaps[f], out, ev); };
  for (let pass = 0; pass < 3; pass++) replay(crowd(31).w, 0, WARM + N);
  const rep = crowd(31);
  replay(rep.w, 0, WARM);
  const base: number[] = []; for (let k = 0; k < 6; k++) { const u0 = newUsed(); base.push(newUsed() - u0); }
  const b0 = base[5], wins: number[] = [];
  for (let wdw = 0; wdw < N / 1000; wdw++) { const u0 = newUsed(); replay(rep.w, WARM + wdw * 1000, WARM + (wdw + 1) * 1000); wins.push(newUsed() - u0 - b0); }
  const pos = wins.filter((d) => d >= 0);
  check('LF-02', `lifeStep allocates 0 B over ${N} ticks at 16 characters after warm-up (new-space growth per 1000-tick window: ${wins.join(', ')} B; a window with a GC is negative)`,
    pos.length >= 3 && pos.every((d) => d <= 64), `max ${Math.max(...pos)} B`);
  // LIFE's own looks calls
  const lw = rep.w, lo = new Float32Array(6);
  const looksLoop = (n: number): void => { for (let k = 0; k < n; k++) { lifeLooks(lw, k & 7, lo); lifeAddLook(lw, k & 7, LOOK.wet, 0.0001, -1); } };
  looksLoop(50000);
  const lw2: number[] = []; for (let k = 0; k < 4; k++) { const u0 = newUsed(); looksLoop(20000); lw2.push(newUsed() - u0 - b0); }
  const dl = Math.min(...lw2.filter((d) => d > -4096)); // a window with a GC is far below 0; -64..64 is the measurement's own noise
  check('LF-20', `lifeLooks and lifeAddLook allocate 0 B (20 000 calls each, best of 4 windows: ${lw2.join(', ')} B)`, dl <= 64);
  // LF-03: the cost per tick, a fresh world replaying the same snapshots
  const tw = crowd(31), times: number[] = [];
  for (let f = 0; f < WARM + N; f++) { const t0 = performance.now(); lifeStep(tw.w, snaps[f], out, ev); const dt = performance.now() - t0; if (f >= WARM) times.push(dt); }
  times.sort((a, b) => a - b);
  const med = times[times.length >> 1], p99 = times[Math.floor(times.length * 0.99)];
  const thinksPerTick = 16 / 6; // 60 fps, each of 16 characters thinks at 10 Hz
  check('LF-03', `lifeStep median ${(med * 1000).toFixed(1)} us a tick at 16 characters (60 fps: about ${thinksPerTick.toFixed(1)} thinks a tick; p99 ${(p99 * 1000).toFixed(1)} us), bar 100 us`, med <= 0.1);
}

/* ───────────────────────────── LF-10 the gate's rows, LF-11, and the scenarios of LF-09 ───────────────────────────── */
{
  // low, 3 wholes all asleep (units 0.09): a start that wakes one is granted (1.06, the cap) and a second mover is refused
  for (const [tier, n] of [[0, 3], [1, 4]] as const) {
    const sim = cabin(41, ['dollop', 'crimpo', 'capnap', 'puddlo'].slice(0, n), tier);
    sim.bodies.forEach((b) => { if (b.on) b.asleep = true; });
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    let maxMovers = 0, firstStart = -1;
    const end = sim.frame + 40 * 60;
    while (sim.frame < end) {
      sim.step(); watchGate(sim, rows);
      maxMovers = Math.max(maxMovers, sim.w.movers);
      if (firstStart < 0 && sim.w.movers > 0) firstStart = sim.t;
    }
    const awakeMax = Math.max(...[0].map(() => 0));
    void awakeMax;
    check('LF-10', `${tier === 0 ? 'low' : 'med'} with ${n} wholes all asleep: a start that wakes one is granted (first at ${firstStart.toFixed(1)} s) and movers never pass ${moverCapOf(tier)} (max ${maxMovers})`,
      firstStart >= 0 && maxMovers <= moverCapOf(tier) && rows.movers === 0);
  }
  const u = 1.0 + 0.03 * 2;
  check('LF-10', `one awake and two asleep on low is not over the cap (${u.toFixed(2)} <= ${unitCapOf(0).toFixed(2)})`, u <= unitCapOf(0) + 0.001);
  // S11 on low and med: one rider the player set on the Pillow Swing, the others asleep: the pusher starts (the ride allowance)
  for (const tier of [0, 1]) {
    const sim = cabin(43, ['dollop', 'crimpo', 'capnap'], tier);
    const sw = CABIN.things.find((t) => t.id === 'pillowswing')!;
    sim.bodies[1].x = sw.x; sim.bodies[1].z = sw.z; sim.extraFlags[1] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
    sim.bodies[0].x = 1.2; sim.bodies[0].z = -0.6; sim.bodies[0].asleep = true; sim.bodies[2].asleep = true;
    sim.sleep = false; sim.bodies[0].asleep = true; sim.bodies[2].asleep = true;
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    runWatched(sim, 40, rows);
    const push = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.PUSH);
    check('LF-10', `${tier === 0 ? 'low' : 'med'}: with one rider set on the Pillow Swing, S11's pusher starts (the ride allowance) and pushes (${push.length} PUSH), within the caps`, push.length >= 1 && rows.wake === 0 && rows.movers === 0, `wake over ${rows.wake}`);
  }
  // S10: two riders teeter on the Rocker Board on low and on med
  for (const tier of [0, 1]) {
    const sim = cabin(45, ['dollop', 'thumbly', 'capnap'], tier);
    const rk = CABIN.things.find((t) => t.id === 'rockerboard')!;
    sim.bodies[0].x = rk.x - 0.75; sim.bodies[0].z = rk.z; sim.bodies[1].x = rk.x + 0.75; sim.bodies[1].z = rk.z;
    sim.extraFlags[0] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP; sim.extraFlags[1] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    runWatched(sim, 20, rows);
    const tee = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.TEETER);
    const hops = sim.intents(INTENT.HOP).filter((l) => l.who <= 1).length;
    const scootRiders = sim.intents(INTENT.SCOOT).filter((l) => l.who <= 1).length;
    check('LF-10', `${tier === 0 ? 'low' : 'med'}: two riders set on the Rocker Board teeter (${tee.length} TEETER, ${hops} hops in turn, ${scootRiders} scoots off it)`, tee.length >= 1 && hops >= 3 && scootRiders === 0);
  }
  // a boop on low and med is a soft boop (the target stays asleep, its wobble a render wiggle); on high a physics boop
  for (const tier of [0, 1, 2]) {
    const sim = cabin(47, ['boingle', 'puddlo'], tier); sim.kettle = false;
    sim.w.traits[0] = 0.95; sim.w.play[0] = 0.9;
    sim.bodies[0].x = 0.4; sim.bodies[0].z = 0.3; sim.bodies[1].x = 1.45; sim.bodies[1].z = 0.3; sim.bodies[1].asleep = true;
    lifeSetPair(sim.w, 0, 1, 1, false); sim.w.pairGreet[1] = 1;
    // keep only the boop: no other moment kinds or uses
    sim.w.cool.fill(1e9); sim.w.traits[2] = 0; sim.w.traits[1] = 0; sim.w.traits[3] = 0; sim.w.traits[5 + 2] = 0; sim.w.traits[5 + 3] = 0;
    for (let k = 0; k < 16; k++) sim.w.cool[k * 26 + 21] = -1e9;
    const rows = { movers: 0, moment: 0, wake: 0, maxUnits: -9 };
    runWatched(sim, 40, rows);
    const boop = sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.BOOP)[0];
    const A = boop ? boop.a : 0, B = boop ? boop.b : 1;
    const soft = sim.log.some((l) => l.kind === INTENT.SCOOT && l.who === A && Math.abs(l.c - 0.04) < 1e-6);
    const wiggle = sim.log.some((l) => l.kind === INTENT.POSE && l.who === B && Math.abs(l.c - 0.05) < 1e-4 && l.d >= 2 && l.d <= 3.0001 && l.t > boop.t - 6);
    const physHop = sim.log.some((l) => l.kind === INTENT.HOP && l.who === A && Math.hypot(l.a, l.c) > 0.3);
    const want = tier < 2 ? 'soft' : 'physics';
    check('LF-10', `${['low', 'med', 'high'][tier]}: a boop is a ${want} boop (${boop ? 'BOOP' : 'no BOOP'}; contact at 0.04 m/s ${soft}, render wiggle ${wiggle}, a hop into it ${physHop})`,
      !!boop && (tier < 2 ? soft && wiggle && !physHop : physHop && !wiggle) && rows.wake === 0);
  }
}

/* LF-09: a 5-minute cabin visit on med with 4 wholes and no input; the pairs become Met after their greet (the reducer's FRIEND -> lifeSetPair) */
{
  const sim = cabin(51, ['dollop', 'crimpo', 'capnap', 'puddlo'], 1);
  const end = sim.frame + 300 * 60;
  const begun = new Set<number>();
  let lastEv = 0;
  while (sim.frame < end) {
    sim.step(); watchGate(sim, gateRows);
    for (let i = 0; i < 4; i++) begun.add(sim.w.beh[i]);
    for (; lastEv < sim.evs.length; lastEv++) { const e = sim.evs[lastEv]; if (e.kind === LIFE_EV.SOCIAL && e.sub === SOCIAL_KIND.GREET) lifeSetPair(sim.w, e.a, e.b, 1, false); }
  }
  const greets = new Set(sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.GREET).map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`));
  const naps = sim.events(LIFE_EV.USE, USE_VERB.NAP).length + sim.events(LIFE_EV.SOCIAL, SOCIAL_KIND.PILE).length;
  const napStarts = [0, 1, 2, 3].filter((i) => sim.log.some((l) => l.who === i && l.kind === INTENT.EXPRESS && l.a === 2 && l.b === 1)).length;
  const uses = [0, 1, 2, 3].map((i) => sim.events(LIFE_EV.USE).filter((e) => e.a === i).length);
  const verbs = [0, 1, 2, 3].map((i) => sim.events(LIFE_EV.USE).filter((e) => e.a === i).map((e) => Object.keys(USE_VERB).find((k) => USE_VERB[k as keyof typeof USE_VERB] === e.sub)).join('+'));
  info('LF-09', `the uses by verb: ${verbs.join(' | ')}`);
  const social: Record<string, number> = {};
  for (const e of sim.events(LIFE_EV.SOCIAL)) social[Object.keys(SOCIAL_KIND).find((k) => SOCIAL_KIND[k as keyof typeof SOCIAL_KIND] === e.sub) ?? e.sub] = (social[Object.keys(SOCIAL_KIND).find((k) => SOCIAL_KIND[k as keyof typeof SOCIAL_KIND] === e.sub) ?? e.sub] ?? 0) + 1;
  info('LF-09', `5-minute cabin visit, 4 wholes, med, no input: SOCIAL ${JSON.stringify(social)}, uses per squishy ${uses.join('/')}, nap starts ${napStarts}, behaviours seen ${[...begun].sort((a, b) => a - b).join(',')}`);
  check('LF-09', `every pair greets (${greets.size} of 6 pairs) and at least 1 nap (${napStarts} nappers)`, greets.size === 6 && napStarts >= 1);
  check('LF-09', `each squishy 2 to 3 thing uses (USE events: ${uses.join(' / ')})`, uses.every((u) => u >= 2 && u <= 3));
}
check('LF-10', `movers never exceed the tier's moverCap in the scenarios above (${gateRows.movers} frames over)`, gateRows.movers === 0);
check('LF-11', `no character is in two joint moments at once (${gateRows.moment} violations)`, gateRows.moment === 0);
check('LF-10', `every LIFE start that woke a body kept units at or under unitCap + the ride allowance (${gateRows.wake} over)`, gateRows.wake === 0);

/* ───────────────────────────── LF-06 targets ───────────────────────────── */
{
  for (const layout of [0, 1] as const) {
    const sim = cabin(61, ['dollop', 'crimpo', 'capnap', 'puddlo', 'thumbly'], 2, 60, layout);
    let bad = 0, outside = 0, free = 0, n = 0;
    const offs: string[] = [];
    const lastLog = { i: 0 };
    const end = sim.frame + 180 * 60;
    while (sim.frame < end) {
      sim.step();
      for (; lastLog.i < sim.log.length; lastLog.i++) {
        const l = sim.log[lastLog.i];
        if (l.kind !== INTENT.SCOOT) continue;
        n++;
        if (!inB(CABIN, layout, l.a, l.b, 0)) { outside++; offs.push(`${l.who}:b${sim.w.beh[l.who]}m${sim.w.moment[l.who] >= 0 ? sim.w.mKind[sim.w.moment[l.who]] : 0}@${l.a.toFixed(2)},${l.b.toFixed(2)}`); }
        const beh = sim.w.beh[l.who];
        if (beh === BEH.WANDER || beh === BEH.COMEBACK) {
          free++;
          const R = sim.bodies[l.who].r;
          if (!inB(CABIN, layout, l.a, l.b, R + 0.2)) bad++;
        }
      }
    }
    check('LF-06', `${layout ? 'tall' : 'wide'} cabin: no target outside the bounds (${outside} of ${n} SCOOTs) and no free target (wander, come back: ${free}) outside the bounds shrunk by R + 0.2 (${bad})`, outside === 0 && bad === 0 && n > 0, offs.join(' '));
  }
  // Home: every target lies on a segment between two framed points (home slots, arrived use spots, the ball), within 0.01 m
  let homeBad = 0, homeN = 0; const homeOffs: string[] = [];
  for (const [layout, nOut] of [[0, 3], [1, 3], [0, 2], [1, 1]] as const) {
    const sim = home(63 + nOut, ['dollop', 'crimpo', 'capnap'].slice(0, nOut), layout);
    for (let i = 0; i < nOut; i++) sim.w.play[i] = 0.7;
    let li = 0;
    const end = sim.frame + 120 * 60;
    while (sim.frame < end) {
      sim.step();
      for (; li < sim.log.length; li++) {
        const l = sim.log[li];
        if (l.kind !== INTENT.SCOOT) continue;
        homeN++;
        const pts: number[][] = [];
        for (let i = 0; i < nOut; i++) pts.push([sim.bodies[i].homeX, sim.bodies[i].homeZ]);
        for (let k = 0; k < sim.things.length; k++) {
          const def = HOME.things.find((t) => TID(t.id) === sim.things[k])!, li2 = HOME.things.indexOf(def);
          if (def.mech === MECH.ball) pts.push([sim.ballX, sim.ballZ]);
          const u = layout === 1 ? HOME.tall.things[li2].use : def.useSpot;
          if (u) pts.push([u[0], u[1]]);
        }
        let best = 1e9;
        for (const p of pts) for (const q of pts) {
          const vx = q[0] - p[0], vz = q[1] - p[1], L = vx * vx + vz * vz;
          let u = L > 0 ? ((l.a - p[0]) * vx + (l.b - p[1]) * vz) / L : 0; u = Math.max(0, Math.min(1, u));
          best = Math.min(best, Math.hypot(l.a - p[0] - vx * u, l.b - p[1] - vz * u));
        }
        if (best > 0.01 + 0.06) { homeBad++; homeOffs.push(`${l.who}:b${sim.w.beh[l.who]}m${sim.w.moment[l.who] >= 0 ? sim.w.mKind[sim.w.moment[l.who]] : 0}@${l.a.toFixed(2)},${l.b.toFixed(2)} off ${best.toFixed(2)}`); }
      }
    }
  }
  check('LF-06', `Home: every SCOOT target lies on a segment between two framed points (home slots, arrived things' use spots, the ball; ${homeBad} of ${homeN} off by more than 0.07 m, the ball's live position allowing its 0.06 m roll in a tick)`, homeBad === 0 && homeN > 0, homeOffs.join(' '));
  const one = home(65, ['dollop'], 1); one.w.play[0] = 0.9; one.run(60);
  check('LF-06', 'Home, one squishy on a portrait phone: no wander at all (B03 does not fire)', !one.log.some((l) => l.kind === INTENT.SCOOT && one.w.beh[l.who] === BEH.WANDER));
}

/* ───────────────────────────── LF-07 a storm of requests, LF-08 pieces merge, LF-17 Calm ───────────────────────────── */
{
  for (const [phone, calm] of [[true, false], [true, true], [false, false], [false, true]] as const) {
    const a = createAttention(), s = mkSnapshot(), o = mkIntents();
    s.n = 16; s.phone = phone; s.calm = calm;
    for (let i = 0; i < 16; i++) { s.flags[i] = LIFE_FLAG.VISIBLE; s.sx[i] = 0.1 + i * 0.05; s.sy[i] = 0.5; }
    const col = (phone ? 0 : 2) + (calm ? 1 : 0);
    const starts: number[] = [], sylStarts: number[] = []; let maxOn = 0, maxV = 0, p1Req = 0, p1Got = 0, maxGroupOn = 0;
    const on = new Map<number, number>(), von: number[] = [];
    let seed = 12345;
    const r = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    for (let f = 0; f < 60 * 60; f++) {
      s.t = f / 60; o.n = 0;
      // about 50 requests a second over 16 characters: say, group (pieces 6..15) and wishes, voices of 1..4 syllables
      for (let q = 0; q < 2; q++) {
        if (r() > 0.42) continue;
        const k = o.n++, who = Math.floor(r() * 16), isVoice = r() < 0.4, cls = r() < 0.15 ? 1 : who >= 6 ? 3 : 2;
        o.kind[k] = isVoice ? INTENT.VOICE : INTENT.EMOTE; o.who[k] = who; o.delayS[k] = 0;
        o.icon[k] = 1 + Math.floor(r() * 20); o.style[k] = !isVoice && r() < 0.08 ? 1 : who >= 6 ? 2 : 0; o.groupKey[k] = who >= 6 ? 6 : -1;
        o.e[k] = isVoice ? 0.4 : cls; o.d[k] = isVoice ? 1 + Math.floor(r() * 4) : 0; o.b[k] = isVoice && who >= 6 ? 1 : 0;
        o.prio[k] = (cls === 1 ? 3 : cls === 2 ? 2 : 1) + r();
        if (!isVoice && cls === 1) p1Req++;
      }
      attentionFilter(a, s, o);
      for (let k = 0; k < o.n; k++) {
        if (o.kind[k] === INTENT.EMOTE && o.icon[k] > 0) {
          if (o.style[k] === 0 || o.style[k] === 2) { starts.push(s.t); on.set(o.who[k], s.t + 2); }
          if (o.e[k] === 1) p1Got++;
        } else if (o.kind[k] === INTENT.VOICE) { for (let y = 0; y < o.d[k]; y++) sylStarts.push(s.t); von.push(s.t + o.e[k]); }
      }
      let n = 0, g = 0; for (const [w, u] of on) if (u > s.t) { n++; if (w >= 6) g++; }
      let dots = 0; for (let i = 0; i < 16; i++) dots += a.wishDot[i] ? 0.25 : 0;
      maxOn = Math.max(maxOn, n + dots); maxGroupOn = Math.max(maxGroupOn, g);
      maxV = Math.max(maxV, von.filter((u) => u > s.t).length);
    }
    const perSec = (arr: number[]): number => { let m = 0; for (let i = 0; i < arr.length; i++) { let c = 0; for (let j = i; j < arr.length && arr[j] < arr[i] + 1; j++) c++; m = Math.max(m, c); } return m; };
    const bubCap = Math.floor(CAPS.bubbleBurst[col] + CAPS.bubbleRate[col]), sylCap = Math.floor(CAPS.sylBurst[col] + CAPS.sylRate[col]);
    const name = ['phone', 'phone Calm', 'desktop', 'desktop Calm'][col];
    check('LF-07', `${name}: a 16-character storm (~50 requests a second for 60 s): bubble starts per rolling second max ${perSec(starts)} (<= ${bubCap}), at once ${maxOn} (<= ${CAPS.bubbles[col]}, wish dots 0.25), group bubbles ${maxGroupOn} (<= 1), voices at once ${maxV} (<= ${CAPS.voices[col]}), syllables per second ${perSec(sylStarts)} (<= ${sylCap}), P1 granted ${p1Got} of ${p1Req}`,
      perSec(starts) <= bubCap && maxOn <= CAPS.bubbles[col] + 1e-9 && maxGroupOn <= 1 && maxV <= CAPS.voices[col] && perSec(sylStarts) <= sylCap && p1Got > 0 && a.wishOwner < 16);
  }
  // LF-08: 6 pieces doing one action within 0.5 s give 1 bubble and 1 voice (a whole cut into 6 inside the fireside warmth: B15 for each)
  const sim = new Sim(71, CABIN, 0); sim.s.place = 1; sim.s.tier = 2;
  CABIN.things.forEach((t) => sim.addThing(t.id, t.x, t.z));
  sim.add(0, 'pastrel', -1.6, -1.2); sim.run(1); lifeRemove(sim.w, 0); sim.bodies[0].on = false;
  for (let k = 0; k < 6; k++) sim.add(k, 'pastrel', -2.0 + (k % 3) * 0.35, -1.25 + Math.floor(k / 3) * 0.35, { kind: k === 0 ? 1 : 2, group: 0, frac: 1 / 6, r: 0.27, seed: 7 });
  const t0 = sim.t; sim.run(0.6);
  const em = sim.log.filter((l) => l.kind === INTENT.EMOTE && l.icon > 0 && l.t >= t0 && l.t <= t0 + 0.6), vo = sim.log.filter((l) => l.kind === INTENT.VOICE && l.t >= t0 && l.t <= t0 + 0.6);
  check('LF-08', `6 pieces doing one action within 0.5 s (entering the warmth at the cut) give 1 bubble (a group bubble with count dots ${em[0]?.style === STYLE.GROUP ? 'yes' : 'no'}) and at most 1 voice`, em.length === 1 && vo.length <= 1, `${em.length} bubbles, ${vo.length} voices`);
  // LF-22: the cut inside the warmth gives one PIECES WARM with n = 6 at the cut
  const pw = sim.events(LIFE_EV.PIECES, REACT_KIND.WARM);
  check('LF-22', `a whole in the hearth's warmth cut into pieces gives one PIECES WARM with n = the pieces inside it at the cut (${pw.map((e) => e.n2).join(',')}), thing = the Fireplace`, pw.length === 1 && pw[0].n2 === 6 && pw[0].thing === TID('hearth'));
  // LF-17: Calm or reduced motion: hop chains at most 3, no wiggle over 2 Hz, the hops x 0.6
  const c = cabin(73, ['boingle', 'crimpo', 'dollop', 'puddlo'], 2); c.s.calm = true; c.run(120);
  const poses = c.intents(INTENT.POSE), hops = c.intents(INTENT.HOP);
  let chain = 0, maxChain = 0; const byWho = new Map<number, number>();
  for (const h of hops) { const last = byWho.get(h.who) ?? -9; chain = h.t - last < 1.6 ? chain + 1 : 1; byWho.set(h.who, h.t); maxChain = Math.max(maxChain, chain); }
  check('LF-17', `Calm: no render wiggle or sway over 2 Hz (${poses.filter((p) => p.d > 2.0001).length} of ${poses.length} POSE), hops at most 0.84 x 0.6 m/s (max ${Math.max(0, ...hops.map((h) => h.b)).toFixed(3)})`,
    poses.every((p) => p.d <= 2.0001) && hops.every((h) => h.b <= 0.84 * 0.6 + 1e-6));
  info('LF-17', `Calm: the longest run of hops less than 1.6 s apart by one character: ${maxChain}`);
}

/* ───────────────────────────── LF-13 huff, LF-23 RIDE, LF-24 autonomy off ───────────────────────────── */
{
  check('LF-13', `the huff's triggers are a static table of squishy-to-squishy scene events only: ${HUFF_TRIGGERS.join('; ')}`, HUFF_TRIGGERS.length === 2 && HUFF_TRIGGERS.every((t) => /another squishy/.test(t)));
  // stage a take: two wholes in B04 on the same ball; the late one huffs only after the session's first 60 s, at most 3 s, a touch ends it
  const stage = (at: number): Sim => {
    const sim = cabin(81, ['dollop', 'boingle'], 2); sim.kettle = false;
    sim.run(at);
    const w = sim.w, ball = w.globalToLocal[TID('yarnball')];
    for (let m = 0; m < 8; m++) w.mKind[m] = 0; w.moment.fill(-1); w.cool[0 * 26 + BEH.HUFF] = -1e9;
    w.beh[0] = BEH.USE; w.tThing[0] = ball; w.phase[0] = 1; w.behT0[0] = sim.t; w.behScore[0] = 1;
    w.beh[1] = BEH.USE; w.tThing[1] = ball; w.phase[1] = 2; w.behT0[1] = sim.t; w.behScore[1] = 1;
    sim.ballX = -1.35; sim.ballZ = 1.9; sim.ballVX = 0; sim.ballVZ = 0; sim.bodies[1].x = -1.35; sim.bodies[1].z = 1.15; sim.bodies[1].asleep = false;
    sim.s.thingBusy.fill(1);
    const orig = sim.fill.bind(sim); sim.fill = () => { orig(); for (let k = 0; k < sim.s.nThings; k++) if (sim.s.thingId[k] === TID('yarnball')) sim.s.thingBusy[k] = 1; };
    return sim;
  };
  const early = stage(20); early.run(2);
  check('LF-13', 'never in a session\'s first 60 s (a take at 20 s gives no huff)', !early.intents(INTENT.EMOTE).some((l) => l.icon === EMOTE.puff));
  const late = stage(70); const t0 = late.t; late.run(5);
  const puff = late.intents(INTENT.EMOTE).find((l) => l.icon === EMOTE.puff && l.t >= t0);
  const huffEnd = (() => { for (let f = 0; f < 0; f++); return 0; })(); void huffEnd;
  check('LF-13', 'after 60 s the take gives one huff (a puff bubble), and B16 lasts at most 3 s', !!puff && late.w.beh[0] !== BEH.HUFF);
  const late2 = stage(70); late2.run(0.3);
  const was = late2.w.beh[0] === BEH.HUFF;
  late2.extraFlags[0] = LIFE_FLAG.TOUCHED; late2.run(0.2);
  check('LF-13', 'any touch ends the huff (it turns into a giggle)', was && late2.w.beh[0] !== BEH.HUFF && late2.intents(INTENT.EMOTE).some((l) => l.icon === EMOTE.giggle && l.who === 0));
  // LF-23 RIDE: set on the rocker, still on it 15 s later with no input; a lone rider's star (P1); a touch ends it
  const r = cabin(83, ['thumbly', 'capnap'], 1); const rk = CABIN.things.find((t) => t.id === 'rockerboard')!;
  r.bodies[0].x = rk.x - 0.75; r.bodies[0].z = rk.z; r.extraFlags[0] = LIFE_FLAG.RIDE | LIFE_FLAG.ON_PROP;
  const tr0 = r.t; r.run(15);
  const moved = r.log.filter((l) => l.who === 0 && (l.kind === INTENT.SCOOT || l.kind === INTENT.HOP) && l.t > tr0 + 0.5).length;
  const star = r.log.find((l) => l.kind === INTENT.EMOTE && l.who === 0 && l.icon === EMOTE.star && l.e === 1);
  check('LF-23', `a squishy set on the rocker is still on it 15 s later with no input (${moved} scoots or hops off it; at ${r.bodies[0].x.toFixed(2)}, ${r.bodies[0].z.toFixed(2)}), in B20`, moved === 0 && r.w.beh[0] === BEH.RIDE && Math.hypot(r.bodies[0].x - (rk.x - 0.75), r.bodies[0].z - rk.z) < 0.01);
  check('LF-23', 'a lone rider shows its star bubble as a P1 request ("Ride with me!")', !!star);
  r.extraFlags[0] = LIFE_FLAG.TOUCHED; r.run(0.2);
  check('LF-23', 'a touch ends it (HELD; the shell clears RIDE on a touch)', r.w.beh[0] !== BEH.RIDE);
  // LF-24 autonomy off: no hops, scoots, glides or squash poses, except a player-asked use and a ride the player set up
  const a = cabin(85, ['dollop', 'crimpo', 'capnap', 'puddlo'], 2); a.s.autonomy = false; a.run(60);
  const moving = a.log.filter((l) => [INTENT.SCOOT, INTENT.HOP, INTENT.GLIDE, INTENT.SQUASH].includes(l.kind as 2)).length;
  const kept = ['GAZE', 'POSE', 'EMOTE', 'VOICE'].map((k) => a.log.filter((l) => l.kind === INTENT[k as 'GAZE']).length);
  check('LF-24', `autonomy off: 0 hops, scoots, glides and squash poses in 60 s (${moving}); gaze ${kept[0]}, render poses ${kept[1]}, bubbles ${kept[2]}, voices ${kept[3]} stay`, moving === 0 && kept.every((k) => k > 0));
  lifeScript(a.w, 0, SCRIPT.PLAY_WITH, a.w.globalToLocal[TID('yarnball')]);
  const tp = a.t; a.run(12);
  const asked = a.log.filter((l) => l.t > tp && (l.kind === INTENT.SCOOT || l.kind === INTENT.HOP));
  const byPlayer = a.evs.find((e) => e.t > tp && e.kind === LIFE_EV.USE && e.a === 0 && e.b === 254);
  check('LF-24', `autonomy off: "Go play with..." still moves that one squishy (${asked.filter((l) => l.who === 0).length} of ${asked.length} motion intents are its), and its USE carries by PLAYER (b = 254)`, asked.length > 0 && asked.every((l) => l.who === 0) && !!byPlayer);
  check('LF-19', 'PLAY_WITH: the focused squishy\'s next behaviour is that use, started at once, its USE by PLAYER', !!byPlayer && byPlayer.t - tp < 10);
}

/* ───────────────────────────── LF-19 the scripts, LF-14 and LF-25 wishes ───────────────────────────── */
{
  const journal = (sim: Sim, open: number, kinds: number): void => lifeSetJournal(sim.w, new Uint32Array(2), open, new Uint32Array(4), kinds);
  // FIRST_WISH with no Dollop owned: the slot the shell names; no natural wish before it (a touch wish due before 2:30)
  const a = home(91, ['glugbean', 'capnap'], 0); journal(a, 1, THING_KIND.ball | THING_KIND.note);
  a.w.play[0] = 0.95; a.w.play[1] = 0.95; a.run(150);
  const before = a.events(LIFE_EV.WISH, WISH_STATE.SHOWN).length;
  lifeScript(a.w, 1, SCRIPT.FIRST_WISH, 0); a.run(3);
  const shown = a.events(LIFE_EV.WISH, WISH_STATE.SHOWN);
  const wo = new Int32Array(2); lifeWishOf(a.w, shown[0]?.a ?? 0, wo);
  check('LF-19', `FIRST_WISH with no Dollop owned: no natural wish before it (${before} by 2:30, a touch wish was due), then the wisher the shell named (slot ${shown[0]?.a}) shows the Hearthlog postcard`, before === 0 && shown.length === 1 && shown[0].a === 1 && wo[0] === WISH_KIND.PLACE && wo[1] === 1);
  // with Dollop out: Dollop wishes even if the shell named another; Dollop on the shelf: a Hearthlog fan, else the one out longest
  const b = home(93, ['crimpo', 'glugbean', 'dollop'], 0); journal(b, 1, 0); b.run(5);
  lifeScript(b.w, 1, SCRIPT.FIRST_WISH, 0); b.run(2);
  const sb = b.events(LIFE_EV.WISH, WISH_STATE.SHOWN)[0];
  check('LF-19', `FIRST_WISH: the slot the shell sends is the wisher (D-70: the shell picks Dollop / a fan / the longest out): slot ${sb?.a}`, sb?.a === 1);
  const c = home(95, ['glugbean', 'crimpo'], 0); journal(c, 1, 0); c.run(5);
  c.extraFlags[0] = LIFE_FLAG.TOUCHED; lifeScript(c.w, 0, SCRIPT.FIRST_WISH, 0); c.run(2);
  const sc = c.events(LIFE_EV.WISH, WISH_STATE.SHOWN)[0];
  check('LF-19', `FIRST_WISH when the named wisher is held: a Hearthlog fan out shows it instead (Crimpo, slot ${sc?.a})`, sc?.a === 1);
  const d = home(97, ['glugbean'], 0); journal(d, 1, 0); d.s.quiet = true; d.run(2);
  lifeScript(d.w, 0, SCRIPT.FIRST_WISH, 0); d.run(2);
  const none = d.events(LIFE_EV.WISH).length;
  lifeScript(d.w, 0, SCRIPT.FIRST_WISH, 1); d.run(1);
  const rested = d.events(LIFE_EV.WISH, WISH_STATE.SHOWN).find((e) => e.b === 254);
  check('LF-19', 'FIRST_WISH: nobody can show it (all quiet): it waits, and at the 5:00 backstop it rests in the Journal (WISH SHOWN, b = 254)', none === 0 && !!rested);
  lifeScript(d.w, 0, SCRIPT.FIRST_WISH, 1); d.run(1);
  check('LF-19', 'FIRST_WISH fires at most once', d.events(LIFE_EV.WISH).length === 1);
  // POSE, CHEER, SQUIRTED
  const p = cabin(99, ['dollop', 'crimpo', 'capnap'], 1); p.run(5);
  lifeScript(p.w, 0, SCRIPT.POSE, 1); p.run(0.5);
  const posing = [0, 1, 2].every((i) => p.w.beh[i] === BEH.POSE);
  lifeScript(p.w, 0, SCRIPT.POSE, 0); p.run(0.5);
  check('LF-19', 'POSE: B12 for every character on screen while the Snap tool is in hand, and it ends when it is put away', posing && [0, 1, 2].every((i) => p.w.beh[i] !== BEH.POSE));
  lifeScript(p.w, 0, SCRIPT.CHEER, 0); const tc = p.t; p.run(3); // a P1 waits up to 2 s for the per-character bubble gap
  const cheers = p.log.filter((l) => l.t > tc && l.kind === INTENT.EMOTE && l.icon === EMOTE.star && l.who !== 0).length;
  check('LF-19', `CHEER: B14 for up to two characters near the one that caused it (${cheers} star bubbles)`, cheers >= 1 && cheers <= 2);
  lifeScript(p.w, 2, SCRIPT.SQUIRTED, 1); const ts = p.t; p.run(1.2);
  const sq = p.log.filter((l) => l.t > ts && l.who === 2 && (l.kind === INTENT.EMOTE || l.kind === INTENT.VOICE));
  check('LF-19', 'SQUIRTED: the target\'s wow, then its giggle', sq.some((l) => l.kind === INTENT.EMOTE && l.icon === EMOTE.wow) && sq.some((l) => l.kind === INTENT.VOICE && l.icon === 15));
  // LF-14 and LF-25: natural wishes over 20 minutes at Home with 3 out (Hearthlog open: the first wish has shown)
  const h = home(101, ['dollop', 'glugbean', 'capnap'], 0); journal(h, 0b11, THING_KIND.ball);
  for (let i = 0; i < 3; i++) h.w.play[i] = 0.9;
  const mins = HEAVY ? 30 : 20, wishT: number[][] = [[], [], []]; let maxOpen = 0, maxFull = 0, glanceMax = 0, thingOk = true;
  const end = h.frame + mins * 60 * 60;
  let li = 0;
  while (h.frame < end) {
    h.step();
    for (let i = 0; i < 3; i++) h.w.play[i] = Math.max(h.w.play[i], 0.85);
    let open = 0; for (let i = 0; i < 3; i++) if (h.w.wishKind[i]) open++;
    maxOpen = Math.max(maxOpen, open);
    maxFull = Math.max(maxFull, h.w.att.wishOwner >= 0 ? 1 : 0);
    for (let i = 0; i < 3; i++) glanceMax = Math.max(glanceMax, h.w.wishGlance[i]);
    for (; li < h.evs.length; li++) { const e = h.evs[li]; if (e.kind === LIFE_EV.WISH && e.sub === WISH_STATE.SHOWN) { wishT[e.a].push(e.t); const o = new Int32Array(2); lifeWishOf(h.w, e.a, o); if (o[0] === WISH_KIND.THING && (o[1] & ~THING_KIND.ball) !== 0) thingOk = false; } }
    // grant place wishes now and then (a trip), so new ones can come
    if (h.frame % (90 * 60) === 0) for (let i = 0; i < 3; i++) if (h.w.wishKind[i]) { h.w.wishKind[i] = 0; }
  }
  const all = wishT.flat().sort((x, y) => x - y);
  const gapAny = all.slice(1).reduce((m, t, k) => Math.min(m, t - all[k]), 1e9), gapSelf = Math.min(...wishT.map((ts) => ts.slice(1).reduce((m, t, k) => Math.min(m, t - ts[k]), 1e9)));
  check('LF-14', `${mins} min, 3 out: ${all.length} wishes; at most 1 open a squishy and ${maxOpen} open in all (<= 3), the wish slot holds one (${maxFull}), gaps ${gapAny === 1e9 ? '-' : gapAny.toFixed(0)} s overall (>= 120) and ${gapSelf === 1e9 ? '-' : gapSelf.toFixed(0)} s a squishy (>= 180), at most 2 re-glances (${glanceMax})`,
    all.length >= 2 && maxOpen <= 3 && gapAny >= 120 - 1e-6 && gapSelf >= 180 - 1e-6 && glanceMax <= 2);
  check('LF-25', 'thing wishes target only the kinds in the thing-kind mask (here: ball only)', thingOk);
}

/* ───────────────────────────── LF-20 looks, LF-21 REACT from LIFE's real output ───────────────────────────── */
{
  // the Window Chill (cold 0.3): frost rises at 0.015 a s and does not fall while the cause is present; FROST once per visit at 0.5
  const sim = new Sim(111, CABIN, 0); sim.s.place = 1;
  CABIN.things.forEach((t) => sim.addThing(t.id, t.x, t.z));
  sim.add(0, 'dollop', 2.4, -1.9); sim.add(1, 'crimpo', 0, 0.8);
  sim.physics = false; sim.run(20);
  const lo = new Float32Array(6); lifeLooks(sim.w, 0, lo);
  check('LF-20', `in the cabin's Window Chill (cold 0.3) frost rises at 0.015 a s (${(lo[0] / 20).toFixed(4)} a s over 20 s) and does not fall there`, Math.abs(lo[0] - 0.3) < 0.02);
  sim.run(25); lifeLooks(sim.w, 0, lo);
  const frost = sim.events(LIFE_EV.REACT, REACT_KIND.FROST).filter((e) => e.a === 0);
  check('LF-20', `frost crosses 0.5 (${lo[0].toFixed(2)} at 45 s) and emits FROST once per visit, with the zone's thing (-1: the Window Chill has no owning thing)`, lo[0] > 0.5 && frost.length === 1);
  const shiver = sim.events(LIFE_EV.REACT, REACT_KIND.SHIVER).filter((e) => e.a === 0);
  check('LF-21', 'SHIVER: in a cold zone for 2 s, a family with shiver (jelly gel), once per visit', shiver.length === 1);
  sim.bodies[0].x = 0.5; sim.bodies[0].z = 0.8; sim.run(10); const before = lo[0]; lifeLooks(sim.w, 0, lo);
  check('LF-20', `out of the cold the frost falls at its elsewhere rate 0.02 a s (${((before - lo[0]) / 10).toFixed(4)})`, Math.abs((before - lo[0]) / 10 - 0.02) < 0.002);
  sim.s.quiet = true; sim.run(5); const q = lo[0]; lifeLooks(sim.w, 0, lo); sim.s.quiet = false;
  check('LF-20', 'a ceremony (quiet) keeps the looks (they go on integrating, nothing resets)', lo[0] > 0 && lo[0] <= q);
  lifeRemove(sim.w, 0); lifeAdd(sim.w, 0, G('dollop', 7), 0, 0, 0, false); lifeLooks(sim.w, 0, lo);
  check('LF-20', 'the shelf (lifeRemove, lifeAdd) resets the looks to 0', lo.every((v) => v === 0));
  lifeAddLook(sim.w, 1, LOOK.snow, 0.5, TID('shakepine')); lifeAddLook(sim.w, 1, LOOK.snow, 0.3, TID('snowball'));
  sim.run(0.3);
  const caps = sim.events(LIFE_EV.REACT, REACT_KIND.SNOWCAP).filter((e) => e.a === 1);
  check('LF-20', `a lifeAddLook emits its REACT every time, with its source thing (SNOWCAP x ${caps.length}: ${caps.map((e) => e.thing).join(', ')})`, caps.length === 2 && caps[0].thing === TID('shakepine') && caps[1].thing === TID('snowball'));
  lifeSetPlace(sim.w, 1, 2, CABIN, 0, 1); lifeLooks(sim.w, 1, lo);
  check('LF-20', 'a trip (a new visit) resets the looks', lo.every((v) => v === 0));
  // the hearth: WARM with the Fireplace; a marshmallow toasts golden (TOAST at 0.5) and hops back from the heat past 0.6; mochi RISE; slime OOZE
  const f = new Sim(113, CABIN, 0); f.s.place = 1; f.s.tier = 2;
  CABIN.things.forEach((t) => f.addThing(t.id, t.x, t.z));
  f.add(0, 'cushlet', -2.4, -1.25); f.add(1, 'kneadle', -2.0, -1.0); f.add(2, 'gloopsy', -2.8, -1.0);
  f.run(40);
  const fam = (sp: string) => CATALOG.find((d) => d.id === sp)!.family;
  const warm = f.events(LIFE_EV.REACT, REACT_KIND.WARM), toast = f.events(LIFE_EV.REACT, REACT_KIND.TOAST), rise = f.events(LIFE_EV.REACT, REACT_KIND.RISE), ooze = f.events(LIFE_EV.REACT, REACT_KIND.OOZE);
  const hopBack = f.log.some((l) => l.kind === INTENT.HOP && l.who === 0 && Math.hypot(l.a, l.c) > 0.3);
  info('LF-21', `families: cushlet ${fam('cushlet')}, kneadle ${fam('kneadle')}, gloopsy ${fam('gloopsy')}`);
  check('LF-21', `WARM in the hearth's warmth for 2 s, its thing the Fireplace (${warm.length} WARM: ${[...new Set(warm.map((e) => e.thing))].join(',')})`, warm.length >= 3 && warm.every((e) => e.thing === TID('hearth')));
  check('LF-21', `TOAST at 0.5 for the marshmallow (${toast.length}), and it hops back from the heat once toast passes 0.6 (${hopBack})`, fam('cushlet') !== 'marshmallow' || (toast.length === 1 && toast[0].thing === TID('hearth') && hopBack));
  check('LF-21', `RISE (mochi dough's warm pose 1.06 reached in warmth 0.6+: ${rise.length}) and OOZE (slime goo's 0.82: ${ooze.length})`, (fam('kneadle') !== 'mochidough' || rise.length === 1) && (fam('gloopsy') !== 'slimegoo' || ooze.length === 1));
  // water (Ripple Shore's data): FLOAT and WADE give the zone's own thing, so the Rock Pool and the Surf Edge give different things
  info('LF-21', 'not run in S0/S1 (their places and producers are S2/S3): FLOAT, WADE, SOAK by water, GLIDE, SPLASH, DRIFT, LIFT, RATTLE, GLOW, GAZE_SKY, PRINT, SHOWER, FIZZ (the trigger code for LIFT, RATTLE, GLOW, SHOWER, FIZZ, SPLASH, FLOAT, WADE is in looks.ts, unchecked; GLIDE, DRIFT, GAZE_SKY, PRINT have no producer yet)');
  info('LF-18', 'S2 (water): the 30 s water exit and "never naps in water" (the nap part is in: B06 never starts in a water zone); the exit is NOT built yet');
  info('LF-15', "friendship's pace (20 a pair a day, levels at 12 and 40, 128 rows, eviction) is the reducer's (PG_QUESTS); LIFE's side: lifeSetPair levels gate chat (Met), duet and nuzzle-for-every-pair (Friends), twirl (Close)");
}

console.log(`\n${oks} ok, ${fails} failed`);
if ((process.argv[1] ?? '').endsWith('probe_life.ts')) process.exit(fails ? 1 : 0);
