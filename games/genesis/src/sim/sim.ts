// GENESIS — class Sim (CONTRACT.md §6.2): the one door into the simulation for the worker and the tests.
//
//   step(ticks)      whole ticks; at each tick boundary queued commands run (and are logged with the tick), then every
//                    planet's systems run on their cadences (below), then the tick advances; keyframes every 2 days
//   apply(cmd)       validate now, run at the next boundary          applyNow(cmd)  validate + run now (logged)
//   parse(text)      freeform preview (no effect)                    snapshot(opts) renderer view, fields when changed
//   save() / Sim.load(bytes)  binary GNSS container; round trip preserves hash()
//   hash()           stable hash of the whole state                  query(q, args) inspector data
//   rewind(tick)     restore the nearest keyframe <= tick and replay the command log up to it
//
// Cadences (ticks; CONTRACT §6.3 — each planet's slow passes are staggered by its id so worlds never spike together):
//   hydrology 2 · fire 5 · weather 10 · terrain (lava, talus, sand, ash) 10 · climate 60 · vegetation 60 (+30)
//   chronicle firsts 60 (+45) · groundwater/seepage/salt 720 · biomes 720 (+360) · keyframe 2880
// Snow melt and freezing run inside the hourly climate pass (temperature only changes hourly).

import type { Command, CommandResult, FieldName, PlanetSnap, SimEvent, Snapshot } from './types.ts';
import { BASE_PACK } from '../data/index.ts';
import { loadContent, type Content, type ContentPack } from './content.ts';
import { Universe } from './world/universe.ts';
import { buildScenario } from './world/scenarios.ts';
import { PUBLISHED_FIELDS, planetArrays, planetFromJson, planetToJson, type Planet, type PlanetJson } from './world/planet.ts';
import { makeStar, starView, type StarState } from './world/star.ts';
import { buildRegistry, type CommandRegistry } from './god/commands.ts';
import { parseFreeform } from './god/freeform.ts';
import { listParams } from './god/params.ts';
import { Hasher, sameBytes, type TypedArray } from './core/hash.ts';
import { SaveWriter, readSave } from './core/serialize.ts';
import { IdAllocator } from './core/ids.ts';
import type { RngState } from './core/rng.ts';
import { climateStep, CLIMATE_CADENCE } from './fields/climate.ts';
import { hydroStep, hydroSlowStep, HYDRO_CADENCE, HYDRO_SLOW_CADENCE } from './fields/hydrology.ts';
import { weatherStep, weatherViews, WEATHER_CADENCE } from './fields/weather.ts';
import { fireStep, FIRE_CADENCE, heatAt } from './fields/fire.ts';
import { terrainStep, TERRAIN_CADENCE } from './fields/terrain.ts';
import { vegetationStep, VEG_CADENCE, VEG_OFFSET } from './fields/vegetation.ts';
import { biomeStep, BIOME_CADENCE } from './fields/biomes.ts';
import { chronicleCheck, CHRONICLE_CADENCE, CHRONICLE_OFFSET } from './chronicle.ts';
import { meanAnomaly } from './world/orbits.ts';

export interface SimOptions {
  seed: number;
  scenario: string;
  /** mod packs merged over the base pack */
  content?: ContentPack[];
  /** applied to every planet's kind (tests: { n: 24 }) */
  overrides?: Record<string, unknown>;
}

export interface SnapshotOptions {
  /** every field, regardless of versions */
  full?: boolean;
  /** only fields changed after this stamp (Snapshot planets carry the stamp as fieldVersion) */
  since?: number;
  /** per (planet, field) gate (the worker's fast/slow throttle) */
  include?: (planet: number, field: FieldName) => boolean;
  /** drain pending events and new chronicle entries into the snapshot (default true) */
  drain?: boolean;
}

interface Keyframe {
  tick: number;
  header: string;
  blobs: Map<string, TypedArray>;
}

const KEYFRAME_EVERY = 2880;
const KEYFRAME_RING = 16;

export class Sim {
  readonly content: Content;
  u: Universe;
  readonly registry: CommandRegistry;
  /** worker-side pacing info, reported in snapshots */
  speed = 1;
  achievedSpeed = 0;
  msPerTick = 0;
  keyframeEvery = KEYFRAME_EVERY;
  keyframeRing = KEYFRAME_RING;
  private queue: Command[] = [];
  private keyframes: Keyframe[] = [];
  private chronicleSent = 0;

  constructor(opts: SimOptions, restored?: { universe: Universe; content: Content }) {
    if (restored) {
      this.content = restored.content;
      this.u = restored.universe;
    } else {
      this.content = loadContent([BASE_PACK, ...(opts.content ?? [])]);
      this.u = buildScenario(this.content, opts.scenario, opts.seed >>> 0, { overrides: opts.overrides });
    }
    this.registry = buildRegistry();
    this.registry.register('freeform', ({ u }, a) => {
      const r = parseFreeform(u, this.registry, String(a.text ?? ''));
      if (!r.ok || !r.resolved?.length) return { ok: false, msg: r.msg ?? 'Nothing to do.', resolved: r.resolved };
      const msgs: string[] = [];
      let okAll = true;
      for (const c of r.resolved) {
        const res = this.registry.dispatch(u, c);
        okAll = okAll && res.ok;
        if (res.msg) msgs.push(res.msg);
      }
      return { ok: okAll, msg: msgs.join(' '), resolved: r.resolved };
    }, { desc: 'Do what the words say', category: 'Meta', params: { text: { type: 'string', required: true } } });
    this.chronicleSent = this.u.chronicle.length;
    this.keyframe();
  }

  get tick(): number {
    return this.u.tick;
  }

  get scenario(): string {
    return this.u.scenario;
  }

  // ───────────────────────────── stepping ─────────────────────────────

  step(ticks: number): void {
    const n = Math.max(0, Math.floor(ticks));
    for (let i = 0; i < n; i++) this.tickOnce();
  }

  private tickOnce(): void {
    const u = this.u;
    const t = u.tick;
    if (this.queue.length) {
      const q = this.queue;
      this.queue = [];
      for (const c of q) this.exec(c);
    }
    for (const p of u.planets) if (p.alive) runPlanet(u, p, t);
    u.tick = t + 1;
    if (u.tick % this.keyframeEvery === 0) this.keyframe();
  }

  private exec(cmd: Command): CommandResult {
    const clean = JSON.parse(JSON.stringify(cmd)) as Command;
    this.u.log.push({ tick: this.u.tick, cmd: clean });
    return this.registry.dispatch(this.u, clean);
  }

  apply(cmd: Command): CommandResult {
    const v = this.registry.validate(this.u, cmd);
    if (!v.ok) return { ok: false, msg: v.msg, tick: this.u.tick };
    this.queue.push(JSON.parse(JSON.stringify(cmd)) as Command);
    return { ok: true, msg: 'queued for the next tick', tick: this.u.tick };
  }

  applyNow(cmd: Command): CommandResult {
    const v = this.registry.validate(this.u, cmd);
    if (!v.ok) return { ok: false, msg: v.msg, tick: this.u.tick };
    return this.exec(cmd);
  }

  parse(text: string): CommandResult {
    return parseFreeform(this.u, this.registry, text);
  }

  drainEvents(): SimEvent[] {
    const e = this.u.events;
    this.u.events = [];
    return e;
  }

  // ───────────────────────────── snapshot ─────────────────────────────

  snapshot(opts: SnapshotOptions = {}): Snapshot {
    const u = this.u;
    const since = opts.full ? -1 : opts.since ?? -1;
    const planets: PlanetSnap[] = [];
    for (const p of u.planets) {
      const sun = u.sun(p, u.tick);
      const snap: PlanetSnap = {
        id: p.id, name: p.name, gridN: p.n, seed: p.seed, params: p.paramsAt(u.tick, sun.lon), alive: p.alive,
        fieldVersion: u.stamp,
        weather: weatherViews(u, p), disasters: [], settlements: [], population: [],
      };
      const fields: Partial<Record<FieldName, Float32Array>> = {};
      let any = false;
      for (const name of PUBLISHED_FIELDS) {
        const ver = p.fieldVer[name] ?? 0;
        if (!opts.full && ver <= since) continue;
        if (opts.include && !opts.include(p.id, name)) continue;
        fields[name] = fieldCopy(p, name);
        any = true;
      }
      if (any) snap.fields = fields;
      planets.push(snap);
    }
    const drain = opts.drain !== false;
    const events = drain ? this.drainEvents() : [];
    const chronicle = drain ? u.chronicle.slice(this.chronicleSent) : [];
    if (drain) this.chronicleSent = u.chronicle.length;
    return {
      tick: u.tick, speed: this.speed, achievedSpeed: this.achievedSpeed, star: starView(u.star), planets,
      ships: [], creatures: [], hand: null, events, chronicle, content: this.content.packs, msPerTick: this.msPerTick,
      restraint: u.settings.restraint, worship: [0],
    };
  }

  // ───────────────────────────── save / load / hash ─────────────────────────────

  private header(withLog: boolean): Record<string, unknown> {
    const u = this.u;
    const h: Record<string, unknown> = {
      format: 'genesis-save',
      scenario: u.scenario,
      seed: u.seed,
      tick: u.tick,
      content: this.content.packs,
      star: u.star,
      settings: u.settings,
      focus: u.focus,
      ids: u.ids.save(),
      rng: u.rng.save().map((x) => x >>> 0),
      chronicle: u.chronicle,
      stamp: u.stamp,
      planets: u.planets.map(planetToJson),
    };
    if (withLog) h.log = u.log;
    return h;
  }

  save(): Uint8Array {
    const w = new SaveWriter();
    for (const p of this.u.planets) for (const [name, arr] of planetArrays(p)) w.blob(`p${p.id}.${name}`, arr);
    return w.finish(this.header(true));
  }

  static load(bytes: Uint8Array, content?: ContentPack[]): Sim {
    const file = readSave(bytes);
    const c = loadContent([BASE_PACK, ...(content ?? [])]);
    const need = (file.header.content as string[] | undefined) ?? ['base'];
    const missing = need.filter((x) => !c.packs.includes(x));
    if (missing.length) throw new Error(`This save needs the content pack${missing.length > 1 ? 's' : ''} ${missing.map((m) => `'${m}'`).join(', ')}.`);
    const u = universeFromHeader(c, file.header, file.blobs, true);
    return new Sim({ seed: u.seed, scenario: u.scenario }, { universe: u, content: c });
  }

  /** stable hash of the whole simulation state (not the command log, events or field versions) */
  hash(): string {
    const h = new Hasher();
    const hdr = this.header(false);
    delete hdr.stamp;
    for (const pj of hdr.planets as PlanetJson[]) delete (pj as Partial<PlanetJson>).fieldVer;
    h.json(hdr);
    for (const p of this.u.planets) {
      for (const [name, arr] of planetArrays(p)) {
        h.str(name);
        h.typed(arr);
      }
    }
    return h.hex();
  }

  // ───────────────────────────── keyframes / rewind ─────────────────────────────

  private keyframe(): void {
    const prev = this.keyframes[this.keyframes.length - 1];
    const blobs = new Map<string, TypedArray>();
    for (const p of this.u.planets) {
      for (const [name, arr] of planetArrays(p)) {
        const key = `p${p.id}.${name}`;
        const old = prev?.blobs.get(key);
        // unchanged arrays are shared with the previous keyframe (rock, ores, pins rarely change)
        blobs.set(key, old && sameBytes(old, arr) ? old : (arr.slice() as TypedArray));
      }
    }
    const kf: Keyframe = { tick: this.u.tick, header: JSON.stringify(this.header(false)), blobs };
    if (prev && prev.tick === kf.tick) this.keyframes[this.keyframes.length - 1] = kf;
    else this.keyframes.push(kf);
    while (this.keyframes.length > this.keyframeRing) this.keyframes.shift();
  }

  /** ticks that can be rewound to (oldest keyframe .. now) */
  rewindRange(): [number, number] {
    return [this.keyframes.length ? this.keyframes[0].tick : this.u.tick, this.u.tick];
  }

  rewind(tick: number): boolean {
    const target = Math.floor(tick);
    if (target > this.u.tick || target < 0) return false;
    let kf: Keyframe | undefined;
    for (const k of this.keyframes) if (k.tick <= target) kf = k;
    if (!kf) return false;
    const log = this.u.log;
    const keep = log.filter((e) => e.tick < kf!.tick);
    const replay = log.filter((e) => e.tick >= kf!.tick && e.tick < target);
    const header = JSON.parse(kf.header) as Record<string, unknown>;
    this.u = universeFromHeader(this.content, header, kf.blobs, false);
    this.u.log = keep;
    this.keyframes = this.keyframes.filter((k) => k.tick <= kf!.tick);
    this.queue = [];
    let ri = 0;
    while (this.u.tick < target) {
      while (ri < replay.length && replay[ri].tick === this.u.tick) this.exec(replay[ri++].cmd);
      this.tickOnce();
    }
    while (ri < replay.length && replay[ri].tick === this.u.tick) this.exec(replay[ri++].cmd);
    this.u.events = [];
    this.u.emit({ t: 'rewind', a: target });
    this.chronicleSent = Math.min(this.chronicleSent, this.u.chronicle.length);
    return true;
  }

  // ───────────────────────────── queries ─────────────────────────────

  query(q: string, args: Record<string, unknown> = {}): unknown {
    const u = this.u;
    const p = u.planetFor(args.planet);
    switch (q) {
      case 'cell': {
        if (!p) return null;
        let c = typeof args.cell === 'number' ? Math.floor(args.cell) : -1;
        if (c < 0 && Array.isArray(args.pos)) c = p.cellAt(args.pos as number[]);
        if (c < 0 && typeof args.lat === 'number' && typeof args.lon === 'number') {
          const la = (args.lat * Math.PI) / 180, lo = (args.lon * Math.PI) / 180;
          c = p.grid.nearestCell(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
        }
        if (c < 0 && u.focus && u.focus.planet === p.id) c = p.cellAt(u.focus.pos);
        if (c < 0 || c >= p.count) return null;
        return cellInfo(this, p, c);
      }
      case 'planet': {
        if (!p) return null;
        return planetInfo(this, p);
      }
      case 'planets':
        return u.planets.map((pl) => ({ id: pl.id, name: pl.name, kind: pl.st.kind, gridN: pl.n, alive: pl.alive, parent: pl.st.orbit.parent }));
      case 'params':
        return p ? listParams(u, p) : [];
      case 'commands':
        return this.registry.kinds().map((k) => ({ k, ...this.registry.schema(k)!, params: Object.fromEntries(Object.entries(this.registry.schema(k)!.params).map(([n, s]) => [n, { ...s, values: typeof s.values === 'function' ? s.values(u) : s.values }])) }));
      case 'chronicle':
        return u.chronicle;
      case 'scenario':
        return { scenario: u.scenario, seed: u.seed, tick: u.tick, rewind: this.rewindRange() };
      case 'weather':
        return this.content.weather.list;
      case 'plants':
        return this.content.plants.list;
      case 'biomes':
        return this.content.biomes.list;
      case 'stars':
        return this.content.stars.list;
      case 'hash':
        return this.hash();
      default:
        return { error: `unknown query '${q}'`, known: ['cell', 'planet', 'planets', 'params', 'commands', 'chronicle', 'scenario', 'weather', 'plants', 'biomes', 'stars', 'hash'] };
    }
  }
}

// ───────────────────────────── helpers ─────────────────────────────

/** the systems of one planet at tick t, on their cadences */
export function runPlanet(u: Universe, p: Planet, t: number): void {
  const off = p.id * 13; // stagger slow passes between worlds
  const ts = t + off;
  if (ts % CLIMATE_CADENCE === 0) climateStep(u, p);
  if (ts % WEATHER_CADENCE === 0) weatherStep(u, p);
  if (t % HYDRO_CADENCE === 0) {
    hydroStep(u, p);
    if (p.springs.length) {
      let expired = false;
      for (const s of p.springs) if (s.life > 0) { s.life = Math.max(0, s.life - HYDRO_CADENCE); if (s.life === 0) expired = true; }
      if (expired) p.springs = p.springs.filter((s) => s.life !== 0);
    }
  }
  if (t % FIRE_CADENCE === 0) fireStep(u, p);
  if ((ts + 5) % TERRAIN_CADENCE === 0) terrainStep(u, p);
  if (ts % VEG_CADENCE === VEG_OFFSET) vegetationStep(u, p);
  if (ts % CHRONICLE_CADENCE === CHRONICLE_OFFSET) chronicleCheck(u, p);
  if (ts % HYDRO_SLOW_CADENCE === 120) hydroSlowStep(u, p);
  if (ts % BIOME_CADENCE === 360) biomeStep(u, p);
}

/** a Float32 copy of a published field (ice = ground ice + floating ice) */
function fieldCopy(p: Planet, name: FieldName): Float32Array {
  if (name === 'ice') {
    const out = new Float32Array(p.count);
    const a = p.f.ice, b = p.s.seaIce;
    for (let c = 0; c < p.count; c++) out[c] = a[c] + b[c];
    return out;
  }
  const src = (p.f as unknown as Record<string, Float32Array | Float64Array>)[name];
  return new Float32Array(src);
}

function universeFromHeader(content: Content, h: Record<string, unknown>, blobs: Map<string, TypedArray>, withLog: boolean): Universe {
  const starJ = h.star as StarState;
  const star = makeStar(content.stars.find(starJ.def) ?? content.stars.list[0], starJ.name);
  Object.assign(star, starJ);
  const u = new Universe(content, h.seed as number, h.scenario as string, star);
  u.tick = h.tick as number;
  u.settings = { ...(h.settings as Universe['settings']) };
  u.focus = (h.focus as Universe['focus']) ?? null;
  u.ids = IdAllocator.load(h.ids as Record<string, number>);
  u.rng.load(h.rng as RngState);
  u.chronicle = ((h.chronicle as Universe['chronicle']) ?? []).map((e) => ({ ...e }));
  if (withLog) u.log = ((h.log as Universe['log']) ?? []).map((e) => ({ tick: e.tick, cmd: e.cmd }));
  u.setStamp((h.stamp as number) ?? 0);
  for (const pj of h.planets as PlanetJson[]) {
    const prefixed = new Map<string, TypedArray>();
    for (const [k, v] of blobs) if (k.startsWith(`p${pj.id}.`)) prefixed.set(k, v);
    const p = planetFromJson(pj, prefixed);
    u.addPlanet(p);
  }
  // the restored stamp must stay above every field version
  let maxVer = u.stamp;
  for (const p of u.planets) for (const v of Object.values(p.fieldVer)) if (v > maxVer) maxVer = v;
  u.setStamp(maxVer);
  return u;
}

function cellInfo(sim: Sim, p: Planet, c: number): Record<string, unknown> {
  const u = sim.u;
  const f = p.f;
  const P = p.grid.pos;
  const content = sim.content;
  const sp = (v: number, list: { name: string }[]) => (v >= 0 && list[v] ? list[v].name : null);
  const fields: Record<string, number> = {};
  for (const name of PUBLISHED_FIELDS) {
    if (name === 'ice') fields.ice = f.ice[c] + p.s.seaIce[c];
    else fields[name] = (f as unknown as Record<string, ArrayLike<number>>)[name][c];
  }
  const lat = (Math.asin(P[c * 3 + 1]) * 180) / Math.PI;
  const lon = (Math.atan2(P[c * 3], P[c * 3 + 2]) * 180) / Math.PI;
  const biome = content.biomes.list[f.biome[c]];
  const ore = f.oreType[c] > 0 ? content.ores.list[f.oreType[c] - 1] : null;
  return {
    planet: p.id, cell: c, pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], lat, lon,
    altitude: f.surface[c] - p.st.seaLevel,
    biome: biome ? { id: biome.id, name: biome.name } : null,
    pinnedBiome: p.s.pinnedBiome[c] >= 0 ? content.biomes.list[p.s.pinnedBiome[c]].id : null,
    ocean: !!p.s.ocean[c],
    seaIce: p.s.seaIce[c],
    tempMean: p.s.tempMean[c],
    light: p.s.lightMean[c],
    heat: heatAt(p, c),
    species: {
      grass: sp(f.grassSpecies[c], content.plants.list), shrub: sp(f.shrubSpecies[c], content.plants.list),
      tree: sp(f.treeSpecies[c], content.plants.list), crop: sp(f.cropSpecies[c], content.plants.list),
    },
    ore: ore ? { id: ore.id, name: ore.name, richness: f.ore[c] } : null,
    precipKind: ['none', 'rain', 'snow', 'hail', 'ash', 'acid', 'blood', 'sand'][f.precipType[c]] ?? 'none',
    fields,
    tick: u.tick,
  };
}

function planetInfo(sim: Sim, p: Planet): Record<string, unknown> {
  const u = sim.u;
  const f = p.f;
  let tSum = 0, tMin = Infinity, tMax = -Infinity, area = 0, veg = 0, fires = 0, wet = 0, snow = 0;
  for (let c = 0; c < p.count; c++) {
    const a = p.grid.area[c];
    const t = f.temperature[c];
    tSum += t * a; area += a;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    veg += (f.grass[c] + f.shrub[c] + f.tree[c] + f.crop[c]) * a;
    if (f.fire[c] > 0) fires++;
    if (f.water[c] > 0.05) wet++;
    if (f.snow[c] > 0.05) snow++;
  }
  const sun = u.sun(p, u.tick);
  return {
    id: p.id, name: p.name, kind: p.st.kind, gridN: p.n, cells: p.count, radius: p.st.radius,
    params: p.paramsAt(u.tick, sun.lon),
    stats: {
      meanTemperature: tSum / area, minTemperature: tMin, maxTemperature: tMax,
      waterVolume: p.waterVolume(), oceanCells: p.hydro.oceanCells, wetCells: wet, snowCells: snow,
      vegetationCover: veg / area, fires, weatherSystems: p.weather.length, springs: p.springs.length,
      activeWaterCells: countFlags(p.s.hAct), seaNow: p.hydro.seaNow, insolation: sun.flux,
      yearPhase: (meanAnomaly(p.st.orbit, u.tick) / (2 * Math.PI)) % 1,
    },
  };
}

function countFlags(a: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) n++;
  return n;
}
