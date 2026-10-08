// GENESIS — WorldView: the main thread's mirror of the sim (CONTRACT.md §14).
//
// Snapshots arrive sparsely (fields only when they changed, at most every ~100–500 ms); the WorldView keeps the latest
// copy of everything, per-field LOCAL version counters (so the renderer uploads only what changed), a GroundSource for
// CPU ground queries (picking, camera collision) built from the same arrays, and the interpolated render clock.
//
// Nothing here imports three.js: the renderer reads the WorldView, it never writes it.

import type {
  BuildingBlock, ChronicleEntry, CreatureView, DisasterView, FieldName, HandView, MoverBlock, PlanetParams, PlanetSnap,
  SettlementView, ShipView, SimEvent, Snapshot, StarView, WeatherView,
} from '../sim/types.ts';
import { TICKS_PER_SECOND_1X } from '../sim/types.ts';
import { getGrid, type IcoGrid } from '../sim/grid/icogrid.ts';
import { Noise3 } from '../sim/grid/noise.ts';
import { groundHeight, type GroundSource } from '../sim/grid/surface.ts';
import { bodyQuat, orbitOffset, spinAt, type D3, type DQ } from './orbits.ts';

export interface PlanetView {
  id: number;
  name: string;
  gridN: number;
  seed: number;
  grid: IcoGrid;
  noise: Noise3;
  params: PlanetParams;
  /** tick of the snapshot that carried `params` (spin is advanced from here) */
  paramsTick: number;
  alive: boolean;
  fields: Map<FieldName, Float32Array>;
  /** local version per field: bumped every time a new array for that field arrives */
  fieldVersion: Map<FieldName, number>;
  /** bumped when any field arrives */
  anyFieldVersion: number;
  ground: GroundSource;
  /** min / max of `surface` (metres above datum) — bounds for culling, picking and the camera */
  minSurface: number;
  maxSurface: number;
  agents?: MoverBlock;
  animals?: MoverBlock;
  buildings?: BuildingBlock;
  settlements: SettlementView[];
  weather: WeatherView[];
  disasters: DisasterView[];
  population: number[];
  /** derived each frame by WorldView.update(): system-frame centre (m) and body orientation */
  center: D3;
  quat: DQ;
  spin: number;
}

const ZERO_FIELDS = new Map<number, Float32Array>();
function zeros(count: number): Float32Array {
  let z = ZERO_FIELDS.get(count);
  if (!z) { z = new Float32Array(count); ZERO_FIELDS.set(count, z); }
  return z;
}

export class WorldView {
  /** tick of the latest snapshot */
  snapTick = 0;
  /** real time (ms, performance clock) the latest snapshot arrived */
  snapAt = 0;
  speed = 1;
  achievedSpeed = 0;
  msPerTick = 0;
  restraint = false;
  worship: number[] = [];
  content: string[] = [];
  star: StarView = {
    name: 'Sun', kind: 'G', luminosity: 1, temperature: 5800, radius: 10000, color: [1, 0.95, 0.88], activity: 0,
  };
  planets: PlanetView[] = [];
  ships: ShipView[] = [];
  creatures: CreatureView[] = [];
  hand: HandView | null = null;
  chronicle: ChronicleEntry[] = [];
  /** events not yet consumed by the presentation layer (FX, toasts) */
  pendingEvents: SimEvent[] = [];
  snapshots = 0;
  /** the smoothed, interpolated render clock (fractional ticks) */
  renderTick = 0;
  private lastFrameAt = -1;

  planet(id: number): PlanetView | undefined {
    for (const p of this.planets) if (p.id === id) return p;
    return undefined;
  }

  /** Merge a snapshot into the mirror. Field arrays are adopted (they were transferred to us), not copied. */
  apply(snap: Snapshot, now: number): void {
    this.snapTick = snap.tick;
    this.snapAt = now;
    this.speed = snap.speed;
    this.achievedSpeed = snap.achievedSpeed;
    this.msPerTick = snap.msPerTick;
    this.restraint = snap.restraint;
    this.worship = snap.worship;
    if (snap.content?.length) this.content = snap.content;
    if (snap.star) this.star = snap.star;
    this.ships = snap.ships ?? [];
    this.creatures = snap.creatures ?? [];
    this.hand = snap.hand ?? null;
    if (snap.events?.length) {
      for (const e of snap.events) this.pendingEvents.push(e);
      if (this.pendingEvents.length > 512) this.pendingEvents.splice(0, this.pendingEvents.length - 512);
    }
    if (snap.chronicle?.length) {
      for (const c of snap.chronicle) this.chronicle.push(c);
      if (this.chronicle.length > 4000) this.chronicle.splice(0, this.chronicle.length - 4000);
    }
    const seen = new Set<number>();
    for (const ps of snap.planets) {
      seen.add(ps.id);
      let pv = this.planet(ps.id);
      if (!pv || pv.gridN !== ps.gridN || pv.seed !== ps.seed) {
        if (pv) this.planets.splice(this.planets.indexOf(pv), 1);
        pv = this.createPlanet(ps);
        this.planets.push(pv);
        this.planets.sort((a, b) => a.id - b.id);
      }
      this.mergePlanet(pv, ps, snap.tick);
    }
    // planets missing from a snapshot keep their last state unless the sim marks them dead; a planet erased by the sim
    // arrives with alive = false first, then disappears
    for (let i = this.planets.length - 1; i >= 0; i--) {
      if (!seen.has(this.planets[i].id) && !this.planets[i].alive) this.planets.splice(i, 1);
    }
    if (this.snapshots === 0) this.renderTick = snap.tick;
    this.snapshots++;
  }

  private createPlanet(ps: PlanetSnap): PlanetView {
    const grid = getGrid(ps.gridN);
    const z = zeros(grid.count);
    const noise = new Noise3(ps.seed);
    return {
      id: ps.id, name: ps.name, gridN: ps.gridN, seed: ps.seed, grid, noise, params: ps.params, paramsTick: 0,
      alive: ps.alive, fields: new Map(), fieldVersion: new Map(), anyFieldVersion: 0,
      ground: { grid, radius: ps.params.radius, noise, surface: z, soil: z, sand: z, snow: z },
      minSurface: 0, maxSurface: 0, settlements: [], weather: [], disasters: [], population: [],
      center: [0, 0, 0], quat: [0, 0, 0, 1], spin: ps.params.spin,
    };
  }

  private mergePlanet(pv: PlanetView, ps: PlanetSnap, tick: number): void {
    pv.name = ps.name;
    pv.params = ps.params;
    pv.paramsTick = tick;
    pv.alive = ps.alive;
    pv.ground.radius = ps.params.radius;
    if (ps.fields) {
      let any = false;
      for (const k of Object.keys(ps.fields) as FieldName[]) {
        const arr = ps.fields[k];
        if (!arr || arr.length !== pv.grid.count) continue;
        pv.fields.set(k, arr);
        pv.fieldVersion.set(k, (pv.fieldVersion.get(k) ?? 0) + 1);
        any = true;
      }
      if (any) {
        pv.anyFieldVersion++;
        const z = zeros(pv.grid.count);
        pv.ground.surface = pv.fields.get('surface') ?? z;
        pv.ground.soil = pv.fields.get('soil') ?? z;
        pv.ground.sand = pv.fields.get('sand') ?? z;
        pv.ground.snow = pv.fields.get('snow') ?? z;
        if (ps.fields.surface) {
          let lo = Infinity, hi = -Infinity;
          const s = ps.fields.surface;
          for (let i = 0; i < s.length; i++) { const v = s[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
          pv.minSurface = lo;
          pv.maxSurface = hi;
        }
      }
    }
    if (ps.agents) pv.agents = ps.agents;
    if (ps.animals) pv.animals = ps.animals;
    if (ps.buildings) pv.buildings = ps.buildings;
    if (ps.settlements) pv.settlements = ps.settlements;
    if (ps.weather) pv.weather = ps.weather;
    if (ps.disasters) pv.disasters = ps.disasters;
    if (ps.population) pv.population = ps.population;
  }

  fieldVersionOf(pv: PlanetView, f: FieldName): number {
    return pv.fieldVersion.get(f) ?? 0;
  }

  /**
   * Advance the render clock and every body's frame. The clock runs at the sim's speed from the last snapshot tick and
   * is gently pulled toward (snapTick + elapsed · ticks/s) so irregular snapshot arrival never makes motion jitter or
   * run backwards (CONTRACT.md §14).
   */
  update(now: number): void {
    const tps = this.speed * TICKS_PER_SECOND_1X;
    if (this.lastFrameAt < 0) this.lastFrameAt = now;
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    const elapsed = Math.max(0, (now - this.snapAt) / 1000);
    // never extrapolate more than ~0.6 s of sim time past the last snapshot (a stalled worker freezes the world)
    const target = this.snapTick + Math.min(elapsed, 0.6) * tps;
    let t = this.renderTick + dt * tps;
    const err = target - t;
    if (Math.abs(err) > Math.max(30, tps * 1.5)) t = target; // big jumps (step, load, rewind): snap
    else t += err * Math.min(1, dt * 4);
    if (t < this.renderTick && Math.abs(err) <= Math.max(30, tps * 1.5)) t = this.renderTick; // monotonic
    this.renderTick = t;
    this.updateBodies(t);
  }

  /** compute every planet's centre and orientation at fractional tick `t` (moons after their parents) */
  updateBodies(t: number): void {
    const done = new Set<number>();
    const off: D3 = [0, 0, 0];
    const place = (pv: PlanetView, depth: number): void => {
      if (done.has(pv.id) || depth > 4) return;
      const o = pv.params.orbit;
      orbitOffset(o, t, off);
      let cx = off[0], cy = off[1], cz = off[2];
      if (o.parent >= 0) {
        const parent = this.planet(o.parent);
        if (parent) {
          place(parent, depth + 1);
          cx += parent.center[0]; cy += parent.center[1]; cz += parent.center[2];
        }
      }
      pv.center[0] = cx; pv.center[1] = cy; pv.center[2] = cz;
      pv.spin = spinAt(pv.params, pv.paramsTick, t);
      bodyQuat(pv.params, pv.spin, pv.quat);
      done.add(pv.id);
    };
    for (const pv of this.planets) place(pv, 0);
  }

  /** distance of the ground from the planet centre at a body-frame unit vector */
  groundRadius(pv: PlanetView, x: number, y: number, z: number): number {
    return groundHeight(pv.ground, x, y, z);
  }

  /** fractional tick → planet calendar */
  calendar(pv: PlanetView, tick = this.renderTick): { year: number; day: number; hour: number; season: string; yearFrac: number } {
    const p = pv.params;
    const dt = tick - pv.paramsTick;
    let hour = p.hourAtLon0 + (p.sunFrozen ? 0 : dt / 60);
    let dayOfYear = p.dayOfYear;
    let year = p.year;
    const yearDays = Math.max(1, p.yearDays);
    while (hour >= p.dayHours) { hour -= p.dayHours; dayOfYear++; }
    while (hour < 0) { hour += p.dayHours; dayOfYear--; }
    while (dayOfYear >= yearDays) { dayOfYear -= yearDays; year++; }
    while (dayOfYear < 0) { dayOfYear += yearDays; year--; }
    const yearFrac = (dayOfYear + hour / Math.max(1, p.dayHours)) / yearDays;
    const seasonIdx = p.seasonPinned != null ? p.seasonPinned : Math.floor(yearFrac * 4) % 4;
    const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
    return { year, day: dayOfYear + 1, hour, season: seasons[((seasonIdx % 4) + 4) % 4], yearFrac };
  }
}
