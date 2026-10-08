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
import { AU, bodyCenter, orbitOffsetAtYearFraction, seasonYearFraction, sunDirBody, sunLongitude, spinAt, type D3 } from './orbits.ts';

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

export interface Settings {
  maxAgents: number;
  restraint: boolean;
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
}

export const SOLAR_CONSTANT = 1361;

export class Universe {
  readonly content: Content;
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
  /** global change stamp: field versions are stamps so 'since' queries are one comparison */
  private stampCounter = 0;

  constructor(content: Content, seed: number, scenario: string, star: StarState) {
    this.content = content;
    this.seed = seed >>> 0;
    this.scenario = scenario;
    this.star = star;
    this.rng = new Rng(this.seed);
    this.ids = new IdAllocator();
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
   * Sun geometry for a planet at a (fractional) tick. A pinned season puts the star where it would be at that point of
   * the year (the planet itself keeps orbiting for the renderer).
   */
  sun(p: Planet, tick: number, out?: SunInfo): SunInfo {
    const o = out ?? { dir: [0, 1, 0], flux: 0, dist: AU, lon: 0, decl: 0 };
    const c: D3 = [0, 0, 0];
    this.centerOf(p, tick, c);
    let dist = Math.hypot(c[0], c[1], c[2]);
    if (p.st.orbit.parent >= 0) {
      // a moon: the star direction is set by the parent's place on its orbit
      const parent = this.planet(p.st.orbit.parent);
      if (parent) dist = Math.hypot(...this.centerOf(parent, tick, [0, 0, 0]));
    }
    let geomCenter: D3 = c;
    if (p.st.seasonPinned != null) {
      const yf = seasonYearFraction(p.st.seasonPinned);
      const root = p.st.orbit.parent >= 0 ? this.planet(p.st.orbit.parent) ?? p : p;
      geomCenter = orbitOffsetAtYearFraction(root.st.orbit, yf, [0, 0, 0]);
      const l = Math.hypot(geomCenter[0], geomCenter[1], geomCenter[2]) || 1;
      geomCenter = [geomCenter[0] / l * dist, geomCenter[1] / l * dist, geomCenter[2] / l * dist];
    }
    const spin = spinAt(p.st.spin0, p.st.spinTick0, p.st.dayHours, p.st.sunFrozen, tick);
    sunDirBody(geomCenter, p.st.orbit, p.st.axialTilt, spin, o.dir);
    o.lon = sunLongitude(geomCenter, p.st.orbit, p.st.axialTilt);
    o.dist = Math.max(dist, 1);
    o.flux = SOLAR_CONSTANT * this.star.luminosity * (AU / o.dist) ** 2 * p.st.lightScale;
    o.decl = Math.asin(Math.max(-1, Math.min(1, o.dir[1])));
    return o;
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
