// GENESIS — sim fields → GPU data textures (CONTRACT.md §15.4).
//
// RGBA32F textures, 256 cells per row, cell c at texel (c & 255, c >> 8). The terrain / water vertex shaders fetch the
// three cells of each render vertex and interpolate. Packing (one texture each):
//   A  surface, rough (= roughOf(soil, sand, snow) from src/sim/grid/surface.ts — the SAME function the CPU ground
//      uses), waterLevel (see below), waterDepth
//   N  per-cell normal (body frame, from neighbour heights) and concavity (neighbours' mean height − own height, m:
//      > 0 in hollows and valleys, < 0 on ridges and peaks); both recomputed only when `surface` changes
//   M0 snow, sand, soil, ash          M1 lava, wetness, ice, burnt
//   V  grass, shrub, tree, crop       C  temperature, moisture, road, fire
//   F  flow velocity (m/s, body frame), salinity
//   S  treeSpecies, cropSpecies, light (night lights, reserved), biome
//   G  curvature gradient of `surface` (gx, gy, gz, gw) from surface.ts surfaceGradients — computed once per surface
//      change by the WorldView (pv.ground.grad, the array the CPU ground function reads) and uploaded as is
//   O  ore outcrops (LIVING H12): the cell's ore colour (ores.json `color` of its oreType) premultiplied by its showing
//      richness (ore × how plainly that deposit breaks the surface, ORE_SHOW) in rgb, that showing richness in a —
//      interpolated linearly, so neighbouring deposits of different ores blend their stains instead of switching type
//      along a sim-triangle edge
//   D  dune amplitude (surface.ts duneAmpOf of the raw sand depth), the ground function's dune term; surface wind
//      (m/s, body-frame tangent vector: the sea state of the water, ocean.ts) in yzw — a synthetic trade-wind / westerly
//      pattern with gusty variation where the source has no wind field (lookdev)
// Each texture is rebuilt only when one of its source fields' versions changed (WorldView bumps them per arrival).
//
// waterLevel: wet cells carry their true water surface; dry cells next to water carry the wet neighbours' mean level
// clamped just under their own ground, so the water sheet stays FLAT up to the true shoreline (the terrain's depth
// test draws the coast) instead of sloping up the beach; dry inland cells sit well under the ground (no water).
//
// The packing itself is fieldpack.ts (FieldPacker). After the first fill (synchronous, so the first frame has every
// texture) it runs in a helper module worker (fieldpack.worker.ts, one for all planets): the main thread only posts the
// changed source arrays and copies the packed arrays back into the textures — the same bytes, at most a frame or two
// later (macfix r1: the refills cost ~30% of a core at 100x and hitched every few seconds at 1x). One job per planet is
// in flight; changes that arrive meanwhile wait for it. Without module workers (node tests, ?packworker=0) it stays
// synchronous.

import { DataTexture, FloatType, NearestFilter, RGBAFormat, ClampToEdgeWrapping } from 'three';
import type { FieldName } from '../../sim/types.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { surfaceGradients } from '../../sim/grid/surface.ts';
import { CityLights } from './citylights.ts';
import { BASE_PACK } from '../../data/index.ts';
import { FIELD_ROW, FieldPacker, SOURCES, TEX_NAMES, type PackReply, type PackRequest, type TexName } from './fieldpack.ts';

export { FIELD_ROW };

/** linear-light colour of each ore (oreType − 1 indexes the content's ore list; the base pack's come first, invented
 * ores past it take a neutral mineral grey-green from their index) */
function hexRgb(hex: string | undefined): [number, number, number] {
  const h = String(hex ?? '#808080').replace('#', '');
  const v = (i: number) => { const c = (parseInt(h.slice(i, i + 2), 16) || 128) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [v(0), v(2), v(4)];
}
/**
 * How plainly a deposit breaks the surface (0..1, × its richness in O.a): the sim's `ore` field is the cell's RICHEST
 * deposit and lies over a third of the land above 0.3 (flint and glass sand under most plains), so outcrops by
 * richness alone would stain half the world. Metal ores, coal, sulfur, obsidian and salt crop out as stained rock and
 * crusts; clay as banks only where rich; flint nodules and glass sand do not show (they ARE the soil and the beach);
 * a deposit the god made (or a mod's) shows plainly — it is news.
 */
const ORE_SHOW: Record<string, number> = {
  flint: 0, clay: 0.4, copper: 1, tin: 0.85, iron: 1, coal: 0.85, gold: 0.8, silver: 0.8, sulfur: 1, obsidian: 1,
  saltpeter: 0.6, salt: 0.8, 'glass-sand': 0, oil: 0.45, uranium: 0.8, gems: 0.7,
};
const showOf = (id: string | undefined): number => (id && id in ORE_SHOW ? ORE_SHOW[id] : 0.9);
let ORE_RGB: [number, number, number][] = (BASE_PACK.ores ?? []).map((o) => hexRgb((o as { color?: string }).color));
let ORE_VIS: number[] = (BASE_PACK.ores ?? []).map((o) => showOf((o as { id?: string }).id));
let orePaletteVersion = 0;
/**
 * The live ore list (the sim's `ores` query: base pack, mods and the god's inventions, in content order) — so an
 * invented ore's outcrops take its own colour. Until it is called the base pack's colours stand (hook H12, for the
 * app: pass the query's rows as they come).
 */
export function setOrePalette(list: readonly { id?: string; color?: string }[]): void {
  const next = list.map((o) => hexRgb(o.color));
  const vis = list.map((o) => showOf(o.id));
  if (next.length === ORE_RGB.length && next.every((c, i) => c[0] === ORE_RGB[i][0] && c[1] === ORE_RGB[i][1] && c[2] === ORE_RGB[i][2] && vis[i] === ORE_VIS[i])) return;
  ORE_RGB = next;
  ORE_VIS = vis;
  orePaletteVersion++;
}

/** how FieldTextures reaches a packing worker (the browser's shared one; tests pass an in-process stand-in) */
export interface PackPort {
  send(m: PackRequest, transfer?: Transferable[]): void;
  listen(id: number, onReply: (r: PackReply) => void, onFail: () => void): void;
  unlisten(id: number): void;
}

let sharedPort: PackPort | null | undefined;
/** the shared helper worker, or null where there is none (made on first use; a worker that fails is not retried) */
function browserPort(): PackPort | null {
  if (sharedPort !== undefined) return sharedPort;
  sharedPort = null;
  try {
    if (typeof Worker === 'undefined' || typeof location === 'undefined') return null;
    if (new URLSearchParams(location.search).get('packworker') === '0') return null;
    const w = new Worker(new URL('./fieldpack.worker.ts', import.meta.url), { type: 'module', name: 'genesis-fieldpack' });
    const subs = new Map<number, { reply: (r: PackReply) => void; fail: () => void }>();
    const fail = (): void => {
      sharedPort = null;
      try { w.terminate(); } catch { /* gone */ }
      for (const s of [...subs.values()]) s.fail();
      subs.clear();
    };
    w.onmessage = (e: MessageEvent<PackReply>) => subs.get(e.data.id)?.reply(e.data);
    w.onerror = (e) => { console.warn('[genesis] field packing worker failed; packing on the main thread', e.message ?? e); fail(); };
    w.onmessageerror = fail;
    sharedPort = {
      send: (m, transfer) => w.postMessage(m, transfer ?? []),
      listen: (id, reply, onFail) => { subs.set(id, { reply, fail: onFail }); },
      unlisten: (id) => { subs.delete(id); },
    };
  } catch (e) {
    console.warn('[genesis] no field packing worker; packing on the main thread', e);
    sharedPort = null;
  }
  return sharedPort;
}

let nextId = 1;

export class FieldTextures {
  readonly rows: number;
  readonly tex: Record<TexName, DataTexture>;
  /** CPU copies used by the chunk system for bounds / water presence (same arrays as the textures) */
  readonly waterLevel: Float32Array;
  readonly waterDepth: Float32Array;
  /** per texture: its source fields' versions (+ light / ore palette version) at its last fill; NaN = never filled */
  private stamps = Object.fromEntries((Object.keys(SOURCES) as TexName[]).map((k) => [k, new Float64Array(SOURCES[k].length + 1).fill(NaN)])) as Record<TexName, Float64Array>;
  /** night light per cell, supplied by the life layer (lit buildings), packed into S.z; and its version */
  private light: Float32Array | null = null;
  private lightVersion = 0;
  /** bumped whenever A (heights / water) changes: the chunk system re-derives bounds */
  geomVersion = 0;
  private lavaVersion = 0;
  /**
   * night lights seen from afar, splatted from the lit buildings and the roads (citylights.ts); built once the life
   * layer supplies a light field, bound to the terrain's uCityTex by the renderer
   */
  cityLights: CityLights | null = null;
  private pv: PlanetView;
  /** the main thread's packer: writes straight into the textures (first fill, and whenever there is no worker) */
  private packer: FieldPacker;
  private port: PackPort | null;
  private readonly id = nextId++;
  private registered = false;
  /** the first fill done (it stays on this thread: the first frame draws every texture) */
  private primed = false;
  /** the job in flight: its sequence number, the textures it fills, what A / M1 / G need when it lands */
  private job: { seq: number; names: TexName[]; lava: number; grad: Float32Array | null } | null = null;
  private seq = 0;
  /** the version (and array) of each field the worker holds */
  private sent = new Map<FieldName, number>();
  private sentArr = new Map<FieldName, Float32Array>();
  /** jobs that landed (tests / probes) */
  landed = 0;

  /** `port`: the packing worker to use (default: the browser's shared one; null = always on this thread) */
  constructor(pv: PlanetView, port?: PackPort | null) {
    this.pv = pv;
    const count = pv.grid.count;
    this.rows = Math.ceil(count / FIELD_ROW);
    const mk = (): DataTexture => {
      const t = new DataTexture(new Float32Array(FIELD_ROW * this.rows * 4), FIELD_ROW, this.rows, RGBAFormat, FloatType);
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.flipY = false;
      t.needsUpdate = true;
      return t;
    };
    this.tex = { A: mk(), W: mk(), N: mk(), M0: mk(), M1: mk(), V: mk(), C: mk(), F: mk(), S: mk(), G: mk(), D: mk(), O: mk() };
    this.waterLevel = new Float32Array(count);
    this.waterDepth = new Float32Array(count);
    const out = Object.fromEntries(TEX_NAMES.map((k) => [k, this.tex[k].image.data as Float32Array])) as Record<TexName, Float32Array>;
    this.packer = new FieldPacker(pv.grid, pv.params.radius, out, this.waterLevel, this.waterDepth);
    this.port = port === undefined ? browserPort() : port;
  }

  /**
   * true (and the stamp taken) when any source of `name` changed since its last fill. Compared in place: it ran for 12
   * textures every frame and built a string each time (per-frame garbage, macfix smooth).
   */
  private restamp(name: TexName): boolean {
    const src = SOURCES[name], st = this.stamps[name];
    const extra = name === 'S' ? this.lightVersion : name === 'O' ? orePaletteVersion : 0;
    let same = st[src.length] === extra;
    for (let i = 0; i < src.length && same; i++) same = st[i] === (this.pv.fieldVersion.get(src[i]) ?? 0);
    if (same) return false;
    for (let i = 0; i < src.length; i++) st[i] = this.pv.fieldVersion.get(src[i]) ?? 0;
    st[src.length] = extra;
    return true;
  }

  /** the life layer's per-cell night light (render/life/buildings.ts lightField); uploaded with S when it changes */
  setLight(data: Float32Array | null, version: number): void {
    if (version === this.lightVersion && data === this.light) return;
    this.light = data;
    this.lightVersion = version;
  }

  /** pv.ground.grad, or derived here if a source never set it (the WorldView keeps it in step with `surface`) */
  private grad(): Float32Array | null {
    const n = this.pv.grid.count;
    const s = this.pv.fields.get('surface') ?? null;
    let g = this.pv.ground.grad as Float32Array | null | undefined;
    if (!g || g.length !== n * 4) g = s ? surfaceGradients(this.pv.grid, this.pv.params.radius, s) : null;
    return g ?? null;
  }

  /** a texture refilled: upload it, and tell the chunk system when the heights / water / lava moved */
  private landedTex(name: TexName, lava: number): void {
    this.tex[name].needsUpdate = true;
    if (name === 'A') this.geomVersion++;
    // (lava raises the terrain mesh by its depth: the chunk bounds follow a flow as they follow the ground)
    else if (name === 'M1' && lava !== this.lavaVersion) { this.lavaVersion = lava; this.geomVersion++; }
  }

  /** upload whatever changed since the last call (or land the worker's job); true if heights / water changed */
  update(): boolean {
    const g0 = this.geomVersion;
    if (!this.job) {
      const dirty: TexName[] = [];
      for (const name of TEX_NAMES) if (this.restamp(name)) dirty.push(name);
      if (dirty.length) {
        const lava = this.pv.fieldVersion.get('lava') ?? 0;
        const port = this.primed ? this.port : null;
        this.primed = true;
        if (port && this.post(port, dirty, lava)) { /* lands in onReply */ } else {
          const p = this.packer;
          p.fields = this.pv.fields;
          p.surfaceVersion = this.pv.fieldVersion.get('surface') ?? 0;
          p.light = this.light;
          p.palette = { rgb: ORE_RGB, vis: ORE_VIS };
          if (dirty.includes('G')) p.grad = this.grad();
          for (const name of dirty) { p.fill(name); this.landedTex(name, lava); }
        }
      }
    }
    if (this.light) {
      this.cityLights ??= new CityLights(this.pv.params.radius);
      this.cityLights.update(this.pv, this.light, this.lightVersion);
    }
    return this.geomVersion !== g0;
  }

  /** post a job for `dirty` (G stays here: a copy of pv.ground.grad when the job lands); false if it could not */
  private post(port: PackPort, dirty: TexName[], lava: number): boolean {
    try {
      if (!this.registered) {
        port.listen(this.id, (r) => this.onReply(r), () => this.onFail());
        port.send({ k: 'init', id: this.id, gridN: this.pv.grid.n, R: this.pv.params.radius });
        this.registered = true;
      }
      const remote = dirty.filter((n) => n !== 'G');
      const need = new Set<FieldName>();
      for (const n of remote) for (const f of SOURCES[n]) need.add(f);
      // only the arrays the worker does not hold yet (it keeps what it was sent: A refilled for a water arrival need
      // not carry surface, soil, sand and snow again — the clones were most of the main thread's remaining cost)
      const fields: [FieldName, Float32Array][] = [];
      for (const f of need) {
        const a = this.pv.fields.get(f);
        const v = this.pv.fieldVersion.get(f) ?? 0;
        if (a && (this.sent.get(f) !== v || this.sentArr.get(f) !== a)) { fields.push([f, a]); this.sent.set(f, v); this.sentArr.set(f, a); }
      }
      const seq = ++this.seq;
      this.job = { seq, names: dirty, lava, grad: dirty.includes('G') ? this.grad() : null };
      port.send({
        k: 'job', id: this.id, seq, names: remote, fields,
        surfaceVersion: this.pv.fieldVersion.get('surface') ?? 0,
        light: remote.includes('S') ? this.light : null,
        palette: remote.includes('O') ? { rgb: ORE_RGB, vis: ORE_VIS } : null,
      });
      return true;
    } catch (e) {
      console.warn('[genesis] field packing job failed to post; packing on the main thread', e);
      this.port = null;
      this.job = null;
      return false;
    }
  }

  private onReply(r: PackReply): void {
    const job = this.job;
    if (!job || r.seq !== job.seq) return;
    this.job = null;
    this.landed++;
    // (the packed arrays become the textures' data: transferred, nothing to copy)
    for (const [name, data] of r.out) { this.tex[name].image.data = data; this.packer.out[name] = data; }
    if (r.waterLevel && r.waterDepth) { this.waterLevel.set(r.waterLevel); this.waterDepth.set(r.waterDepth); }
    if (job.names.includes('G')) { this.packer.grad = job.grad; this.packer.fill('G'); }
    for (const name of job.names) this.landedTex(name, job.lava);
  }

  /** the worker died: forget the job (its textures refill here on the next update) and pack on this thread */
  private onFail(): void {
    this.port = null;
    if (this.job) for (const n of this.job.names) this.stamps[n].fill(NaN);
    this.job = null;
    this.registered = false;
    this.sent.clear();
    this.sentArr.clear();
  }

  dispose(): void {
    if (this.port && this.registered) { try { this.port.send({ k: 'drop', id: this.id }); this.port.unlisten(this.id); } catch { /* gone */ } }
    for (const t of Object.values(this.tex)) t.dispose();
    this.cityLights?.dispose();
  }
}
