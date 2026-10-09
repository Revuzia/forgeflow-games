// GENESIS — Universe: everything the sim owns (CONTRACT.md §6.2): the star, planets (each with grid, fields, stores),
// tick, RNG streams, ids, chronicle, command log, focus and global settings. Later phases add ships, creatures, gods.
//
// The Universe is plain state plus small helpers (planet lookup, orbit queries, event emission). Systems live in
// fields/*.ts and god/*.ts and take (universe, planet); `Sim` (sim.ts) orchestrates cadences, commands, snapshots,
// save/load and rewind. Keyframes are owned by Sim (they are not part of the state hash).

import type { ChronicleEntry, Command, EntityRef, SimEvent, UnitVec } from '../types.ts';
import type { Content } from '../content.ts';
import { Rng, type RngState } from '../core/rng.ts';
import { IdAllocator } from '../core/ids.ts';
import type { Planet } from './planet.ts';
import type { StarState } from './star.ts';
import type { LapseState } from '../perf/lapse.ts';
import { GodState } from '../god/state.ts';
import { AU, bodyCenter, orbitOffsetAtYearFraction, seasonYearFraction, sunDirBody, sunLongitude, spinAt, type D3 } from './orbits.ts';

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

export interface Settings {
  maxAgents: number;
  restraint: boolean;
  /** SIM perf push 2: the time-lapse level from the logged speed preset (perf/lapse.ts; absent = level 0) */
  lapse?: LapseState;
}

/** Solar geometry of a planet at a tick (the climate, plants and the calendar read it). */
export interface SunInfo {
  /** unit vector toward the star, planet BODY frame */
  dir: D3;
  /** top-of-atmosphere flux, W/m² */
  flux: number;
  /** distance to the star, m */
  dist: number;
  /** star longitude in the equatorial non-spinning frame (calendar hour) */
  lon: number;
  /** solar declination (rad) */
  decl: number;
  /** the planet's rotation angle at that tick (Universe.spinOf) */
  spin: number;
}

export const SOLAR_CONSTANT = 1361;

/**
 * Replace the declination of a body-frame sun direction (in place) by the one with sine `sinDecl`, keeping its hour
 * angle (azimuth about the spin axis). `fallback` supplies the azimuth when the real sun stands exactly over a pole.
 * The client (src/client/worldview.ts) applies the same formula to light what the sim heats.
 */
export function pinDeclination(dir: D3, sinDecl: number, fallback: ArrayLike<number>): D3 {
  let hx = dir[0], hz = dir[2];
  let hl = Math.hypot(hx, hz);
  if (hl < 1e-9) {
    hx = fallback[0]; hz = fallback[2]; hl = Math.hypot(hx, hz);
    if (hl < 1e-9) { hx = 1; hz = 0; hl = 1; }
  }
  const cd = Math.sqrt(Math.max(0, 1 - sinDecl * sinDecl));
  dir[0] = (hx / hl) * cd;
  dir[1] = sinDecl;
  dir[2] = (hz / hl) * cd;
  return dir;
}

export class Universe {
  /** replaced (never mutated) when the god layer adds runtime content (god/runtime.ts) */
  content: Content;
  readonly seed: number;
  scenario: string;
  tick = 0;
  star: StarState;
  planets: Planet[] = [];
  rng: Rng;
  ids: IdAllocator;
  chronicle: ChronicleEntry[] = [];
  /** commands with the tick they were applied at (rewind / replay) */
  log: LoggedCommand[] = [];
  /** events emitted since the last drain (transient: not saved, not hashed) */
  events: SimEvent[] = [];
  /** camera focus (the 'focus' command): "here" for the parser, cohort promotion later */
  focus: { planet: number; pos: UnitVec } | null = null;
  settings: Settings = { maxAgents: 4000, restraint: false };
  /** the god layer: disasters, the hand, creatures, gods, laws, runtime content (god/state.ts; saved in the header) */
  god: GodState = new GodState();
  /** global change stamp: field versions are stamps so 'since' queries are one comparison */
  private stampCounter = 0;

  constructor(content: Content, seed: number, scenario: string, star: StarState) {
    this.content = content;
    this.seed = seed >>> 0;
    this.scenario = scenario;
    this.star = star;
    this.rng = new Rng(this.seed);
    this.ids = new IdAllocator();
    this.god.rng = this.rng.fork('god');
  }

  get stamp(): number {
    return this.stampCounter;
  }

  nextStamp(): number {
    return ++this.stampCounter;
  }

  setStamp(v: number): void {
    this.stampCounter = v;
  }

  addPlanet(p: Planet): void {
    p.stamp = () => this.nextStamp();
    this.planets.push(p);
    this.planets.sort((a, b) => a.id - b.id);
  }

  planet(id: number): Planet | undefined {
    for (const p of this.planets) if (p.id === id) return p;
    return undefined;
  }

  /** the planet a command addresses: explicit id, else the focus planet, else the first */
  planetFor(id: unknown): Planet | undefined {
    if (typeof id === 'number') return this.planet(id);
    if (this.focus) { const p = this.planet(this.focus.planet); if (p) return p; }
    return this.planets[0];
  }

  /** system-frame centre of a planet at a tick */
  centerOf(p: Planet, tick: number, out: D3 = [0, 0, 0]): D3 {
    return bodyCenter((id) => this.planet(id)?.st.orbit, p.id, tick, out);
  }

  /**
   * Sun geometry for a planet at a (fractional) tick. A pinned season keeps the REAL geometry for the hour angle (the
   * time of day, the calendar, the meridian the renderer lights) and replaces only the solar declination with the one
   * at the middle of the pinned season. (Moving the star to that point of its orbit instead also moved the solar
   * longitude: the sim then heated a different hour — up to half a day off — than the one drawn lit.) The renderer
   * applies the same replacement to its star direction from PlanetParams.sunDir.
   */
  sun(p: Planet, tick: number, out?: SunInfo): SunInfo {
    const o = out ?? { dir: [0, 1, 0], flux: 0, dist: AU, lon: 0, decl: 0, spin: 0 };
    const c: D3 = [0, 0, 0];
    this.centerOf(p, tick, c);
    let dist = Math.hypot(c[0], c[1], c[2]);
    if (p.st.orbit.parent >= 0) {
      // a moon: the star direction is set by the parent's place on its orbit
      const parent = this.planet(p.st.orbit.parent);
      if (parent) dist = Math.hypot(...this.centerOf(parent, tick, [0, 0, 0]));
    }
    o.lon = sunLongitude(c, p.st.orbit, p.st.axialTilt);
    const spin = this.spinOf(p, tick, o.lon);
    o.spin = spin;
    sunDirBody(c, p.st.orbit, p.st.axialTilt, spin, o.dir);
    if (p.st.seasonPinned != null) {
      const yf = seasonYearFraction(p.st.seasonPinned);
      const root = p.st.orbit.parent >= 0 ? this.planet(p.st.orbit.parent) ?? p : p;
      const fake = orbitOffsetAtYearFraction(root.st.orbit, yf, [0, 0, 0]);
      const fd = sunDirBody(fake, p.st.orbit, p.st.axialTilt, spin, [0, 0, 0]);
      pinDeclination(o.dir, Math.max(-1, Math.min(1, fd[1])), fd);
    }
    o.dist = Math.max(dist, 1);
    o.flux = SOLAR_CONSTANT * this.star.luminosity * (AU / o.dist) ** 2 * p.st.lightScale;
    o.decl = Math.asin(Math.max(-1, Math.min(1, o.dir[1])));
    return o;
  }

  /**
   * The planet's rotation angle at a tick. A frozen sun STANDS STILL in the sky: the planet then turns once per orbit
   * (spin follows the star's longitude), so the hour holds instead of drifting by a day per year. `lonNow` = the
   * star's equatorial longitude at `tick` when the caller already has it.
   */
  spinOf(p: Planet, tick: number, lonNow?: number): number {
    // `dayHours` is the SOLAR day (CONTRACT §5: a 24 h day is 1 440 ticks; the calendar, sleep, crops and shots count
    // solar days): the rotation follows the star's longitude and adds one turn per day on top, so noon comes back every
    // dayHours exactly. (Spinning once per dayHours made that the sidereal day: on a 12-day year the sun returned
    // ~2.2 h later each day.) A frozen sun is the same without the daily turn.
    const st = p.st;
    let d = (lonNow ?? this.sunLonAt(p, tick)) - this.sunLonAt(p, st.spinTick0);
    d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    return spinAt(st.spin0 + d, st.spinTick0, st.dayHours, st.sunFrozen, tick);
  }

  /** the star's longitude in a planet's equatorial frame at a tick (no cache: orbits are edited in place) */
  private sunLonAt(p: Planet, tick: number): number {
    return sunLongitude(this.centerOf(p, tick, this._c), p.st.orbit, p.st.axialTilt);
  }
  private readonly _c: D3 = [0, 0, 0];

  /**
   * The rotation rate (rad per tick) at a tick, for clients that extrapolate the spin between snapshots
   * (PlanetParams.spinRate): one turn per solar day plus the star's drift in longitude.
   */
  spinRateOf(p: Planet, tick: number): number {
    const h = 30;
    let d = this.sunLonAt(p, tick + h) - this.sunLonAt(p, tick - h);
    d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    const drift = d / (2 * h);
    return p.st.sunFrozen ? drift : drift + (2 * Math.PI) / (Math.max(1e-6, p.st.dayHours) * 60);
  }

  /** queue a presentation event (FX, sound, toast) */
  emit(e: Omit<SimEvent, 'tick'> & { tick?: number }): void {
    const ev: SimEvent = { ...e, tick: e.tick ?? this.tick };
    this.events.push(ev);
    if (this.events.length > 4096) this.events.splice(0, this.events.length - 4096);
  }

  /** append a chronicle entry dated with the planet's calendar (and emit a 'chronicle' event) */
  chronicleAdd(planet: Planet | null, kind: string, text: string, weight = 1, refs?: EntityRef[]): ChronicleEntry {
    const p = planet ?? this.planets[0];
    const cal = p ? p.calendar(this.tick) : { year: 1, day: 1 };
    // dated in the planet's own calendar: "Year 1. Air came to the world."
    const full = `Year ${cal.year}. ${text}`;
    const entry: ChronicleEntry = { tick: this.tick, planet: p ? p.id : -1, year: cal.year, day: cal.day, kind, text: full, weight };
    if (refs) entry.refs = refs;
    this.chronicle.push(entry);
    this.emit({ t: 'chronicle', planet: entry.planet, text: full, a: weight, data: { kind } });
    return entry;
  }

  rngState(): RngState {
    return this.rng.save();
  }
}
