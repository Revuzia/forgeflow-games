// PG_LIFE's kinematic host for LIFE's node probes and LF-02's browser measurement (round 4: moved out of probe_life.ts unchanged so the browser
// page _harness/lifeview/lf02.html replays the very same crowd): scoots glide, hops lift for their airtime, a ball rolls when a body pushes into
// it, a GLIDE nudge coasts, a floater drifts round a disc's flow; it fills the snapshot (rows = slots) and logs every intent and event.
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../src/contracts.ts';
import type { Genome } from '../src/core/genome.ts';
import { speciesBaseGenome } from '../src/data/catalog.ts';
import { SPECIES } from '../src/data/species.ts';
import type { PlaceDef } from '../src/data/places.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import { THING_IDS, ZONE, MECH } from '../src/data/places.ts';
import { INTENT, LIFE_FLAG } from '../src/data/life.ts';
import { createLifeWorld, lifeSetPlace, lifeSetHome, lifeAdd, lifeStep, UNIT } from '../src/life/step.ts';
import type { LifeWorld } from '../src/life/step.ts';

export function mkSnapshot(): LifeSnapshot {
  const n = 16;
  return { n: 0, t: 0, place: 0, tier: 1, phone: false, calm: false, reducedMotion: false, autonomy: true, quiet: false, units: 0, musicField: 0, musicOn: true,
    musicBoxOn: false, beatPhase: 0, kind: new Uint8Array(n), group: new Int8Array(n), species: new Uint8Array(n), family: new Uint8Array(n),
    frac: new Float32Array(n).fill(1), r: new Float32Array(n).fill(0.5), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    vx: new Float32Array(n), vz: new Float32Array(n), sx: new Float32Array(n).fill(0.5), sy: new Float32Array(n).fill(0.5), flags: new Uint16Array(n),
    zoneMask: new Uint16Array(n), submerged: new Float32Array(n), warmth: new Uint8Array(n), zoneThing: new Int16Array(n).fill(-1),
    patchThing: new Int16Array(n).fill(-1), nThings: 0, thingId: new Int16Array(32), thingX: new Float32Array(32), thingZ: new Float32Array(32),
    thingState: new Float32Array(32), thingBusy: new Uint8Array(32), nBumps: 0, bumpA: new Int8Array(32), bumpB: new Int8Array(32), touchKind: new Int8Array(n).fill(-1) };
}
export function mkIntents(): LifeIntents {
  const n = 64;
  return { n: 0, kind: new Uint8Array(n), who: new Uint8Array(n), delayS: new Float32Array(n), a: new Float32Array(n), b: new Float32Array(n), c: new Float32Array(n),
    d: new Float32Array(n), e: new Float32Array(n), icon: new Uint8Array(n), style: new Uint8Array(n), prio: new Float32Array(n), groupKey: new Int16Array(n), dots: new Uint8Array(n) };
}
export function mkEvents(): LifeEvents {
  const n = 32;
  return { n: 0, kind: new Uint8Array(n), sub: new Uint8Array(n), a: new Uint8Array(n), b: new Uint8Array(n), n2: new Uint8Array(n), thing: new Int8Array(n) };
}
export const G = (id: string, seed = 7): Genome => speciesBaseGenome(id as Genome['species'], seed);
export const SP = (id: string): number => SPECIES.indexOf(id as (typeof SPECIES)[number]);
export const TID = (id: string): number => THING_IDS.indexOf(id as (typeof THING_IDS)[number]);

/** A tiny kinematic host: it applies SCOOT, HOP, SETTLE and CANCEL, rolls the ball, fills the snapshot (rows = slots), computes the units
 *  (LIFE's UNIT weights: an awake whole 1.0, a piece 0.26 since PF-00, a sleeper 0.03), puts still bodies to sleep after 1.5 s, and logs every
 *  intent and event. */
export interface Body { on: boolean; x: number; z: number; vx: number; vz: number; r: number; tx: number; tz: number; sp: number; scoot: boolean; air: number;
  still: number; asleep: boolean; kind: number; group: number; species: number; family: number; flags: number; frac: number; homeX: number; homeZ: number;
  /** in a water zone this body floats (not grounded), as the physics' float table says for its family (S2) */
  float: boolean;
  /** (round 4) a glide's velocity (LIFE's GLIDE nudge on ice: the ice carries it, decaying at the patch's drag) */
  gx: number; gz: number }
export interface Log { t: number; kind: number; who: number; a: number; b: number; c: number; d: number; e: number; icon: number; style: number; delay: number }
export interface EvLog { t: number; kind: number; sub: number; a: number; b: number; n2: number; thing: number }
export class Sim {
  w: LifeWorld; s = mkSnapshot(); out = mkIntents(); ev = mkEvents(); t = 0; frame = 0; fps: number;
  bodies: Body[] = []; def: PlaceDef; layout: 0 | 1; scale: number;
  ball = -1; ballX = 0; ballZ = 0; ballVX = 0; ballVZ = 0; ballMoved = 0; things: number[] = []; thingXY: number[][] = [];
  log: Log[] = []; evs: EvLog[] = []; keepLog = true; sleep = true; physics = true;
  kettle = false; hash = 0x811c9dc5; extraFlags: number[] = new Array(16).fill(0); touch: number[] = new Array(16).fill(-1);
  /** (round 4) zones the host reports off (a switchable zone: the magnet, the tap's swirl, the drip leaf), by id */
  zoneOff = new Set<string>();
  constructor(seed: number, def: PlaceDef, layout: 0 | 1, fps = 60, scale = 1) {
    this.w = createLifeWorld(seed, 16); this.def = def; this.layout = layout; this.fps = fps; this.scale = scale;
    lifeSetPlace(this.w, def.idx, 1, def, layout, scale);
    for (let i = 0; i < 16; i++) this.bodies.push({ on: false, x: 0, z: 0, vx: 0, vz: 0, r: 0.5, tx: 0, tz: 0, sp: 0, scoot: false, air: 0, still: 0, asleep: false, kind: 0,
      group: i, species: 0, family: 0, flags: 0, frac: 1, homeX: NaN, homeZ: NaN, float: false, gx: 0, gz: 0 });
  }
  add(slot: number, species: string, x: number, z: number, opts: { kind?: 0 | 1 | 2; group?: number; isNew?: boolean; seed?: number; r?: number; frac?: number; asleep?: boolean; float?: boolean } = {}): void {
    const g = G(species, opts.seed ?? (7 + slot * 101));
    const b = this.bodies[slot];
    Object.assign(b, { on: true, x, z, vx: 0, vz: 0, r: opts.r ?? 0.5, tx: x, tz: z, scoot: false, air: 0, still: 0, asleep: opts.asleep ?? false, kind: opts.kind ?? 0,
      group: opts.group ?? slot, species: SP(species), family: 0, frac: opts.frac ?? 1, homeX: NaN, homeZ: NaN, float: opts.float ?? false, gx: 0, gz: 0 });
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
        if (this.zoneOff.has(z.id)) continue;
        const dx = b.x - a.x * sc, dz = b.z - a.z * sc;
        const inside = a.shape === 'disc' ? dx * dx + dz * dz <= (a.r ?? 0) ** 2 : Math.abs(dx) <= (a.hx ?? 0) && Math.abs(dz) <= (a.hz ?? 0);
        if (!inside) continue;
        mask |= 1 << z.kind;
        if (z.strength > best) { best = z.strength; const ti = this.def.things.findIndex((t) => t.zone === z.id); zt = ti >= 0 ? TID(this.def.things[ti].id) : -1; }
      }
      s.zoneMask[i] = mask; s.zoneThing[i] = zt;
      if (b.on && (mask & (1 << ZONE.water)) !== 0) { s.flags[i] |= LIFE_FLAG.IN_WATER; if (b.float && b.air <= 0) s.flags[i] &= ~LIFE_FLAG.GROUNDED; }
      if (b.on) units += b.asleep ? UNIT.sleeper : b.kind === 0 ? UNIT.whole : UNIT.piece;
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
      else if (kd === INTENT.GLIDE) { b.gx = o.a[k]; b.gz = o.b[k]; b.asleep = false; b.still = 0; }
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
      // (round 4) a glide coasts and slows (the ice's drag); a floater in a water zone with a flow drifts round its centre at the flow
      if (Math.abs(b.gx) + Math.abs(b.gz) > 0.02) { b.x += b.gx * dt; b.z += b.gz * dt; vx += b.gx; vz += b.gz; const kk = Math.exp(-0.5 * dt); b.gx *= kk; b.gz *= kk; } else { b.gx = 0; b.gz = 0; }
      if (b.float && b.air <= 0) for (const z of this.def.zones) {
        if (z.kind !== ZONE.water || !z.flow || this.zoneOff.has(z.id) || z.shape !== 'disc') continue;
        const dx = b.x - z.x, dz = b.z - z.z, d = Math.hypot(dx, dz);
        if (d > (z.r ?? 0) || d < 0.05) continue;
        const ux = -dz / d * z.flow[0], uz = dx / d * z.flow[0]; b.x += ux * dt; b.z += uz * dt; vx += ux; vz += uz;
      }
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
export function cabin(seed: number, species: string[], tier = 1, fps = 60, layout: 0 | 1 = 0): Sim {
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
export function home(seed: number, species: string[], layout: 0 | 1 = 0, scale = 1, fps = 60): Sim {
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

/* LF-02's crowd (16 characters: 6 wholes and a cut squishy's 10 pieces in the cabin, high tier) and a deep copy of a snapshot */
export function crowd(seed: number): Sim {
  const sim = cabin(seed, ['dollop', 'crimpo', 'capnap', 'puddlo', 'pastrel', 'thumbly'], 2);
  const spawnT = CABIN.spawn as readonly (readonly [number, number])[];
  sim.add(6, 'glugbean', 0.6, 1.4, { kind: 1, group: 6, frac: 0.2, r: 0.3, seed: 99 });
  for (let k = 7; k < 16; k++) sim.add(k, 'glugbean', 0.6 + ((k - 7) % 3) * 0.45 - 0.45, 1.6 + Math.floor((k - 7) / 3) * 0.4, { kind: 2, group: 6, frac: 0.09, r: 0.22, seed: 99 });
  void spawnT;
  return sim;
}
export function cloneSnap(s: LifeSnapshot): LifeSnapshot {
  const c = { ...s } as Record<string, unknown>;
  for (const k of Object.keys(c)) { const v = c[k]; if (ArrayBuffer.isView(v)) c[k] = (v as Float32Array).slice(); }
  return c as unknown as LifeSnapshot;
}
