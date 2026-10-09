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
//
// Time-lapse (SIM perf push 2, perf/lapse.ts): the speed preset is a LOGGED input (`time.scale`, issued by the worker
// when the preset changes level; saved in settings.lapse, replayed by rewind). Level 0 (1x, 10x) is exactly the above.
// Level 1 (100x) / 2 (1000x): climate every 120 / 360 ticks and vegetation every 120 / 480 (each pass integrates the
// hours it stands for; the climate steps its energy balance hour by hour under each hour's sun), weather systems and
// rain batches every 20 / 30, hydrology every 2 / 4 — 4 only while the sea is calm (same per-step gain, half the
// per-step friction: same steady discharge; with waves on the sea, 2 as at 1x), thin overland sheet flow every 4 / 12,
// sand 20 / 30, biomes 720 / 1440, settlement re-planning ×2 / ×3, keyframes every 2880 / 5760; evaporation and
// infiltration of the land stay hourly (the soil hour below runs on the hours the climate pass skips). A step after a
// level change integrates exactly the time since that system last ran. Same seed + same log (speed changes included)
// => same hash. A dead world the camera is not on (no air, water, life, weather, lava, fire: perf/lapse.ts dormant)
// runs its climate and vegetation every 6 hours at any level. Measured against 1x (round 2, tests/perf-fidelity):
// temperatures, envelopes, soils, wetlands and the sea's recovery match; a downpour carves ~15 % more at 100x / 1000x.

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
import { Hasher, type TypedArray } from './core/hash.ts';
import { unpackArray, type PackedArray } from './core/kfcodec.ts';
import { packKeyframe } from './perf/kfpack.ts';
import { SaveWriter, readSave } from './core/serialize.ts';
import { readHistory, trimHistory, writeHistory, type SavedFrame } from './history.ts';
import { IdAllocator } from './core/ids.ts';
import type { RngState } from './core/rng.ts';
import { climateStep, soilHour, CLIMATE_CADENCE } from './fields/climate.ts';
import { hydroStep, hydroSlowStep, HYDRO_CADENCE, HYDRO_SLOW_CADENCE } from './fields/hydrology.ts';
import { weatherStep, weatherViews, WEATHER_CADENCE } from './fields/weather.ts';
import { fireStep, FIRE_CADENCE, heatAt } from './fields/fire.ts';
import { terrainStep, TERRAIN_CADENCE } from './fields/terrain.ts';
import { vegetationStep, VEG_CADENCE, VEG_OFFSET } from './fields/vegetation.ts';
import { biomeStep, BIOME_CADENCE } from './fields/biomes.ts';
import { chronicleCheck, CHRONICLE_CADENCE, CHRONICLE_OFFSET } from './chronicle.ts';
import { meanAnomaly } from './world/orbits.ts';
import { peopleStep } from './people/people.ts';
import { agentBlock, animalBlock, buildingBlock, populationBySpecies, settlementViews } from './people/snapshot.ts';
import { peopleQuery, PEOPLE_QUERIES } from './people/query.ts';
import { KEYFRAME_MULT, LAPSE_BIOME, LAPSE_CLIMATE, LAPSE_HYDRO, LAPSE_VEG, LAPSE_WEATHER, lapseDue, lapseLevel, registerTimeScale } from './perf/lapse.ts';
// the god layer (phase 3): its step, its snapshot parts, its save state, the time controls (god/index.ts)
import { godTick, godSnapPlanet, godSnapGlobal, godRestore, godQuery, GOD_QUERIES, installSimControls, runControl, controlRequested } from './god/index.ts';
import { validatePowers } from './god/powers.ts';
import { ContentError } from './content.ts';

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
  /** SIM perf pass: ship the ground's curvature data (PlanetSnap.grad) whenever `surface` is shipped */
  grad?: boolean;
}

/**
 * A rewind keyframe. The ring is a REVERSE delta chain: the newest keyframe's arrays are kept raw (`Sim.kfRaw`, needed
 * anyway to encode the next one), and each older keyframe stores its arrays XOR-encoded against the next newer one
 * (core/kfcodec.ts). Rewinding to a recent moment — the common case — decodes few links; dropping the oldest keyframe
 * needs nothing re-encoded because nothing depends on it.
 */
interface Keyframe {
  tick: number;
  header: string;
  /** encoded arrays (empty for the newest keyframe, whose arrays are Sim.kfRaw) */
  packed: Map<string, PackedArray>;
  /** raw arrays not encoded yet (the previous newest, re-encoded a few arrays per tick against `ref`) */
  pending?: Map<string, TypedArray>;
  ref?: Map<string, TypedArray>;
  /** encoded bytes held by this keyframe (header included; pending raw arrays are transient and not counted) */
  bytes: number;
}

const KEYFRAME_EVERY = 2880;
const KEYFRAME_RING = 16;
/** encoded bytes the ring may hold (plus one raw copy of the newest keyframe): older keyframes are dropped first */
const KEYFRAME_BUDGET = 64e6;
/** raw bytes of keyframe arrays re-encoded per tick (~6 ms of work): a whole 7-world system finishes within ~20 ticks */
const KEYFRAME_ENCODE_PER_TICK = 2e6;

export class Sim {
  readonly content: Content;
  u: Universe;
  readonly registry: CommandRegistry;
  /** worker-side pacing info, reported in snapshots */
  speed = 1;
  achievedSpeed = 0;
  msPerTick = 0;
  keyframeEvery = KEYFRAME_EVERY;
  /** at most this many keyframes ... */
  keyframeRing = KEYFRAME_RING;
  /** ... and at most this many encoded bytes (the newest keyframe's raw arrays come on top) */
  keyframeBudget = KEYFRAME_BUDGET;
  private queue: Command[] = [];
  private keyframes: Keyframe[] = [];
  /** raw arrays of the newest keyframe (copies; never aliased with live state) */
  private kfRaw = new Map<string, TypedArray>();
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
    registerTimeScale(this.registry); // SIM perf push 2: the logged speed level (perf/lapse.ts)
    this.registry.register('freeform', ({ u }, a) => {
      const r = parseFreeform(u, this.registry, String(a.text ?? ''));
      // (ok with nothing to do: a question answered from the world — the reply is the answer)
      if (!r.ok || !r.resolved?.length) return { ok: r.ok && !!r.msg, msg: r.msg ?? 'Nothing to do.', resolved: r.resolved };
      const msgs: string[] = [];
      let okAll = true;
      // what the acts made and the time / save controls they ask the host for travel with the result (god/freeform.ts)
      const created: NonNullable<CommandResult['created']> = [];
      let control: Record<string, number> | undefined;
      for (const c of r.resolved) {
        const res = this.registry.dispatch(u, c);
        okAll = okAll && res.ok;
        if (res.msg) msgs.push(res.msg);
        if (res.created) created.push(...res.created);
        if (res.control) control = { ...(control ?? {}), ...res.control };
      }
      return { ok: okAll, msg: msgs.join(' '), resolved: r.resolved, ...(created.length ? { created } : {}), ...(control ? { control } : {}) };
    }, { desc: 'Do what the words say', category: 'Meta', params: { text: { type: 'string', required: true } } });
    // the god layer: time controls act on this Sim; every power in the content must have a handler
    installSimControls(this);
    const badPowers = validatePowers(this.registry, this.content);
    if (badPowers.length) throw new ContentError(badPowers);
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
    for (let i = 0; i < n; i++) {
      this.tickOnce();
      // a queued time command (rewind, edit-past) runs between ticks, never inside one (god/index.ts)
      if (controlRequested(this)) runControl(this);
    }
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
    godTick(u, this.registry, t); // disasters, things in flight, creatures, rivals, natural disasters (god/index.ts)
    u.tick = t + 1;
    // (time-lapse spaces keyframes further apart at 1000x: perf/lapse.ts)
    if (u.tick % (this.keyframeEvery * KEYFRAME_MULT[lapseLevel(u)]) === 0) this.keyframe();
    else if (this.keyframes.length > 1) this.encodeKeyframes(KEYFRAME_ENCODE_PER_TICK);
  }

  private exec(cmd: Command): CommandResult {
    const clean = JSON.parse(JSON.stringify(cmd)) as Command;
    const entry = { tick: this.u.tick, cmd: clean };
    this.u.log.push(entry);
    const r = this.registry.dispatch(this.u, clean);
    // a time act (speed, step, rewind, edit-past) is not a world act: it is not part of the log (god/index.ts)
    if (controlRequested(this)) this.u.log = this.u.log.filter((e) => e !== entry);
    return r;
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
    const r = this.exec(cmd);
    const note = runControl(this);
    if (note) r.msg = `${r.msg ?? ''}${note}`;
    return r;
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
        id: p.id, name: p.name, gridN: p.n, seed: p.seed, params: { ...p.paramsAt(u.tick, sun), spinRate: u.spinRateOf(p, u.tick) }, alive: p.alive,
        fieldVersion: u.stamp,
        weather: weatherViews(u, p), disasters: [],
        settlements: settlementViews(u, p), population: populationBySpecies(u, p),
        agents: agentBlock(u, p), animals: animalBlock(u, p), buildings: buildingBlock(u, p),
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
      if (opts.grad && fields.surface) snap.grad = new Float32Array(p.ground().grad as Float32Array); // SIM perf pass
      godSnapPlanet(u, p, snap); // live disasters; people in the hand or in the air (god/index.ts)
      planets.push(snap);
    }
    const drain = opts.drain !== false;
    const events = drain ? this.drainEvents() : [];
    const chronicle = drain ? u.chronicle.slice(this.chronicleSent) : [];
    if (drain) this.chronicleSent = u.chronicle.length;
    return {
      tick: u.tick, speed: this.speed, achievedSpeed: this.achievedSpeed, star: starView(u.star), planets,
      ships: [], ...godSnapGlobal(u), events, chronicle, content: this.content.packs, msPerTick: this.msPerTick,
      restraint: u.settings.restraint, worship: worshipPool(u),
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
      god: u.god.toJson(), // the god layer: disasters, hand, creatures, gods, laws, inventions (god/state.ts)
      ids: u.ids.save(),
      rng: u.rng.save().map((x) => x >>> 0),
      chronicle: u.chronicle,
      stamp: u.stamp,
      planets: u.planets.map(planetToJson),
      // commands accepted by apply() but not yet run: they are part of the future (save, hash), not of the past (log)
      queue: this.queue,
    };
    if (withLog) h.log = u.log;
    return h;
  }

  save(): Uint8Array {
    const w = new SaveWriter();
    for (const p of this.u.planets) for (const [name, arr] of planetArrays(p)) w.blob(`p${p.id}.${name}`, arr);
    // the rewind ring goes with it (history.ts): a loaded world can still be rewound and its past edited
    const history = writeHistory(w, trimHistory(this.historyForSave()));
    return w.finish({ ...this.header(true), ...(history.length ? { history } : {}) });
  }

  /** the rewind ring as a save keeps it: older keyframes as they are, the newest encoded against the live arrays */
  private historyForSave(): SavedFrame[] {
    this.encodeKeyframes(Infinity);
    if (!this.keyframes.length) return [];
    const live = new Map<string, TypedArray>();
    for (const p of this.u.planets) for (const [name, arr] of planetArrays(p)) live.set(`p${p.id}.${name}`, arr);
    const newest = this.keyframes[this.keyframes.length - 1];
    const top: SavedFrame = { tick: newest.tick, header: newest.header, packed: new Map() };
    for (const [key, raw] of this.kfRaw) {
      const ref = live.get(key);
      const same = ref && ref.byteLength === raw.byteLength && ref.constructor === raw.constructor;
      top.packed.set(key, packKeyframe(raw, same ? ref : null));
    }
    return [...this.keyframes.slice(0, -1).map((k) => ({ tick: k.tick, header: k.header, packed: k.packed })), top];
  }

  /** after a load: the saved ring becomes the rewind ring again (behind the keyframe the constructor took) */
  private restoreHistory(frames: SavedFrame[]): void {
    const live = new Map<string, TypedArray>();
    for (const p of this.u.planets) for (const [name, arr] of planetArrays(p)) live.set(`p${p.id}.${name}`, arr);
    const top = frames[frames.length - 1];
    const topRaw = new Map<string, TypedArray>();
    for (const [key, pk] of top.packed) {
      const ref = pk.xor ? live.get(key) ?? null : null;
      const out = typedLike(ref ?? live.get(key) ?? null, pk.byteLength, key, top.header);
      unpackArray(pk, out, ref);
      topRaw.set(key, out);
    }
    const bytesOf = (f: SavedFrame) => { let b = f.header.length * 2; for (const pk of f.packed.values()) b += pk.bytes.byteLength; return b; };
    const older: Keyframe[] = frames.slice(0, -1).map((f) => ({ tick: f.tick, header: f.header, packed: f.packed, bytes: bytesOf(f) }));
    const cur = this.keyframes[this.keyframes.length - 1];
    const mid: Keyframe = { tick: top.tick, header: top.header, packed: new Map(), bytes: top.header.length * 2 };
    if (!cur || cur.tick === top.tick) {
      this.keyframes = [...older, mid];
      this.kfRaw = topRaw;
    } else {
      mid.pending = topRaw;
      mid.ref = this.kfRaw;
      this.keyframes = [...older, mid, cur];
    }
    this.trimKeyframes();
  }

  static load(bytes: Uint8Array, content?: ContentPack[]): Sim {
    const file = readSave(bytes);
    const c = loadContent([BASE_PACK, ...(content ?? [])]);
    const need = (file.header.content as string[] | undefined) ?? ['base'];
    const missing = need.filter((x) => !c.packs.includes(x));
    if (missing.length) throw new Error(`This save needs the content pack${missing.length > 1 ? 's' : ''} ${missing.map((m) => `'${m}'`).join(', ')}.`);
    const u = universeFromHeader(c, file.header, file.blobs, true);
    const sim = new Sim({ seed: u.seed, scenario: u.scenario }, { universe: u, content: c });
    const q = file.header.queue;
    if (Array.isArray(q)) sim.queue = (q as Command[]).map((cmd) => JSON.parse(JSON.stringify(cmd)) as Command);
    const hist = readHistory(file.header.history, file.blobs);
    if (hist) sim.restoreHistory(hist);
    return sim;
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
    // a previous re-encode still pending (only with very short test spacings): finish it first
    this.encodeKeyframes(Infinity);
    const prev = this.keyframes[this.keyframes.length - 1];
    const raw = new Map<string, TypedArray>();
    for (const p of this.u.planets) for (const [name, arr] of planetArrays(p)) raw.set(`p${p.id}.${name}`, arr.slice() as TypedArray);
    const kf: Keyframe = { tick: this.u.tick, header: JSON.stringify(this.header(false)), packed: new Map(), bytes: 0 };
    kf.bytes = kf.header.length * 2;
    if (prev && prev.tick === kf.tick) {
      // same tick again (constructor right after a rewind / load): replace the newest
      this.keyframes[this.keyframes.length - 1] = kf;
    } else {
      if (prev) {
        // the previous newest becomes a delta against the new one — encoded a few arrays per tick over the next ticks
        // (a 38 MB system took ~0.3 s in one go: a visible stall of the worker), its raw arrays held until then
        prev.pending = this.kfRaw;
        prev.ref = raw;
      }
      this.keyframes.push(kf);
    }
    this.kfRaw = raw;
    this.trimKeyframes();
  }

  /** drop the oldest keyframes beyond the count / byte budget (the newest two always stay) */
  private trimKeyframes(): void {
    let total = 0;
    for (const k of this.keyframes) total += k.bytes;
    while (this.keyframes.length > 2 && (this.keyframes.length > this.keyframeRing || total > this.keyframeBudget)) {
      total -= this.keyframes[0].bytes;
      this.keyframes.shift();
    }
  }

  /** encode pending keyframe arrays, about `budget` raw bytes' worth (Infinity = all) */
  private encodeKeyframes(budget: number): void {
    let done = 0;
    for (const k of this.keyframes) {
      if (!k.pending || !k.ref) continue;
      for (const [key, a] of k.pending) {
        if (done >= budget) return;
        const pk = packKeyframe(a, k.ref.get(key) ?? null); // (unchanged arrays skip the codec: perf/kfpack.ts)
        k.packed.set(key, pk);
        k.bytes += pk.bytes.byteLength;
        k.pending.delete(key);
        done += a.byteLength;
      }
      k.pending = undefined;
      k.ref = undefined;
      this.trimKeyframes();
    }
  }

  /** bytes held by the rewind ring: encoded deltas + the newest keyframe's raw arrays (perf HUD, STATUS numbers) */
  keyframeBytes(): { keyframes: number; encoded: number; raw: number; pending: number } {
    let encoded = 0, raw = 0, pending = 0;
    for (const k of this.keyframes) {
      encoded += k.bytes;
      if (k.pending) for (const a of k.pending.values()) pending += a.byteLength;
    }
    for (const a of this.kfRaw.values()) raw += a.byteLength;
    return { keyframes: this.keyframes.length, encoded, raw, pending };
  }

  /** decode the arrays of keyframe `idx` (walking the delta chain back from the newest) */
  private keyframeArrays(idx: number): Map<string, TypedArray> {
    this.encodeKeyframes(Infinity);
    let cur = new Map<string, TypedArray>();
    for (const [k, a] of this.kfRaw) cur.set(k, a.slice() as TypedArray);
    for (let i = this.keyframes.length - 2; i >= idx; i--) {
      const next = cur;
      cur = new Map();
      for (const [key, pk] of this.keyframes[i].packed) {
        const ref = next.get(key) ?? null;
        const out = typedLike(ref, pk.byteLength, key, this.keyframes[i].header);
        unpackArray(pk, out, pk.xor ? ref : null);
        cur.set(key, out);
      }
    }
    return cur;
  }

  /** ticks that can be rewound to (oldest keyframe .. now) */
  rewindRange(): [number, number] {
    return [this.keyframes.length ? this.keyframes[0].tick : this.u.tick, this.u.tick];
  }

  rewind(tick: number): boolean {
    const target = Math.floor(tick);
    if (target > this.u.tick || target < 0) return false;
    let idx = -1;
    for (let i = 0; i < this.keyframes.length; i++) if (this.keyframes[i].tick <= target) idx = i;
    if (idx < 0) return false;
    const kf = this.keyframes[idx];
    const arrays = this.keyframeArrays(idx);
    const log = this.u.log;
    const keep = log.filter((e) => e.tick < kf.tick);
    const replay = log.filter((e) => e.tick >= kf.tick && e.tick < target);
    const header = JSON.parse(kf.header) as Record<string, unknown>;
    this.u = universeFromHeader(this.content, header, arrays, false);
    this.u.log = keep;
    // the chosen keyframe becomes the newest: its arrays are the raw reference again (planetFromJson copied them)
    this.keyframes = this.keyframes.slice(0, idx + 1);
    kf.packed = new Map();
    kf.bytes = kf.header.length * 2;
    this.kfRaw = arrays;
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
        if (GOD_QUERIES.includes(q)) return godQuery(u, q, args); // powers, gestures, gods, creatures, disasters (god/index.ts)
        if (PEOPLE_QUERIES.includes(q)) return p ? peopleQuery(u, p, q, args) : null;
        return { error: `unknown query '${q}'`, known: ['cell', 'planet', 'planets', 'params', 'commands', 'chronicle', 'scenario', 'weather', 'plants', 'biomes', 'stars', 'hash', ...PEOPLE_QUERIES] };
    }
  }
}

// ───────────────────────────── helpers ─────────────────────────────

/** a fresh typed array of the same type as `like` (or, for an array the newer keyframe lacks, the type its name and
 * byte length imply from the planet's array list) */
function typedLike(like: TypedArray | null, byteLength: number, key: string, header: string): TypedArray {
  if (like) return new (like.constructor as new (n: number) => TypedArray)(byteLength / like.BYTES_PER_ELEMENT);
  // a planet that existed then but not later (erased world): rebuild its array list to learn the type
  const h = JSON.parse(header) as { planets: PlanetJson[] };
  for (const pj of h.planets) {
    if (!key.startsWith(`p${pj.id}.`)) continue;
    const probe = planetFromJson(pj, new Map());
    for (const [name, arr] of planetArrays(probe)) {
      if (`p${pj.id}.${name}` === key) return new (arr.constructor as new (n: number) => TypedArray)(byteLength / arr.BYTES_PER_ELEMENT);
    }
  }
  throw new Error(`keyframe: unknown array '${key}'`);
}

/** worship generated per god across every world (0 = the player); later phases spend it */
function worshipPool(u: Universe): number[] {
  const out = [0, 0, 0, 0];
  for (const p of u.planets) {
    const w = p.people?.worship;
    if (w) for (let g = 0; g < out.length; g++) out[g] = Math.round((out[g] + (w[g] ?? 0)) * 100) / 100;
  }
  return out;
}

/** the systems of one planet at tick t, on their cadences */
export function runPlanet(u: Universe, p: Planet, t: number): void {
  const off = p.id * 13; // stagger slow passes between worlds
  const ts = t + off;
  // SIM perf push 2 — time-lapse (perf/lapse.ts): climate, weather and vegetation run on the cadences of the logged
  // speed level, each handed the ticks it integrates (level 0: exactly the base cadences above)
  const dtC = lapseDue(u, p, LAPSE_CLIMATE, ts, 0);
  if (dtC) climateStep(u, p, t, dtC / CLIMATE_CADENCE);
  // (perf push 2 round 2: an hour the coarse schedule skips still soaks and dries the land hourly — climate.ts soilHour)
  else if (ts % CLIMATE_CADENCE === 0) soilHour(u, p);
  const dtW = lapseDue(u, p, LAPSE_WEATHER, ts, 0);
  if (dtW) weatherStep(u, p, dtW);
  const dtH = lapseDue(u, p, LAPSE_HYDRO, t, 0); // every HYDRO_CADENCE ticks (every 4 at 1000x)
  if (dtH) {
    hydroStep(u, p, dtH);
    if (p.springs.length) {
      let expired = false;
      for (const s of p.springs) if (s.life > 0) { s.life = Math.max(0, s.life - dtH); if (s.life === 0) expired = true; }
      if (expired) p.springs = p.springs.filter((s) => s.life !== 0);
    }
  }
  if (t % FIRE_CADENCE === 0) fireStep(u, p);
  if ((ts + 5) % TERRAIN_CADENCE === 0) terrainStep(u, p);
  const dtV = lapseDue(u, p, LAPSE_VEG, ts, VEG_OFFSET);
  if (dtV) vegetationStep(u, p, dtV / VEG_CADENCE);
  if (ts % CHRONICLE_CADENCE === CHRONICLE_OFFSET) chronicleCheck(u, p);
  if (ts % HYDRO_SLOW_CADENCE === 120) hydroSlowStep(u, p);
  const dtB = lapseDue(u, p, LAPSE_BIOME, ts, 360); // (daily at 1000x)
  if (dtB) biomeStep(u, p, dtB / BIOME_CADENCE);
  peopleStep(u, p, t);
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
  godRestore(u, h); // the god state, and the content its inventions made (before the planets: their people need it)
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
  // transient people indices (time wheel, buckets, members) rebuilt at the restored tick
  for (const p of u.planets) { p.people.contentRef = u.content; p.people.reindex(u.tick); }
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
    params: p.paramsAt(u.tick, sun),
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
