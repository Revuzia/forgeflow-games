// GENESIS — scenario construction (CONTRACT.md §6.5): scenarios.json -> a ready Universe.
//
// For each planet (and its moons): resolve the kind + overrides, derive the orbit (AU -> metres, degrees -> radians,
// year length in the planet's days -> ticks), generate geology, then bring the world to life in dependency order:
//   sea (mask + fill) -> climate equilibrium -> lakes / rivers / springs -> vegetation -> biomes -> firsts.
// The start hour is applied to the focus world (others start late morning). `overrides` (tests, tools) apply to every
// planet, e.g. { n: 24 } for fast test worlds.

import type { Content, ScenarioPlanetDef } from '../content.ts';
import { suggest } from '../content.ts';
import type { OrbitParams } from '../types.ts';
import { hash32, hashStr } from '../core/rng.ts';
import { Universe } from './universe.ts';
import { generatePlanet, resolveKind, type Planet } from './planet.ts';
import { makeStar } from './star.ts';
import { AU, spinForHour } from './orbits.ts';
import { computeOcean, initHydrology } from '../fields/hydrology.ts';
import { initClimate } from '../fields/climate.ts';
import { initVegetation } from '../fields/vegetation.ts';
import { initBiomes } from '../fields/biomes.ts';
import { markInitialFirsts } from '../chronicle.ts';

const DEG = Math.PI / 180;

export interface BuildOptions {
  /** applied to every planet's kind (n, radius, vegetation, climateOffset, atmosphere: {...}, ...) */
  overrides?: Record<string, unknown>;
}

export function buildScenario(content: Content, scenarioId: string, seed: number, opts: BuildOptions = {}): Universe {
  const sc = content.scenarios.find(scenarioId);
  if (!sc) {
    const hint = suggest(scenarioId, content.scenarios.ids());
    throw new Error(`Unknown scenario '${scenarioId}'${hint ? ` — did you mean '${hint}'?` : ''} (have: ${content.scenarios.ids().join(', ')}).`);
  }
  const starDef = content.stars.get(sc.star);
  const u = new Universe(content, seed, sc.id, makeStar(starDef, sc.starName ?? starDef.name));
  let nextId = 0;
  const made: { p: Planet; vegetation: number }[] = [];

  const add = (def: ScenarioPlanetDef, parent: Planet | null): void => {
    const id = nextId++;
    const overrides = { ...(def.overrides ?? {}), ...(opts.overrides ?? {}) };
    const kind = resolveKind(content, def.kind, overrides);
    const o = def.orbit;
    let period: number;
    if (parent) period = Math.max(60, (o.periodDays ?? 2) * parent.st.dayHours * 60);
    else period = Math.max(60, (o.yearDays ?? 12) * kind.dayHours * 60);
    const orbit: OrbitParams = {
      parent: parent ? parent.id : -1,
      a: parent ? o.a : o.a * AU,
      e: o.e ?? 0,
      inc: (o.inc ?? 0) * DEG,
      phase0: (o.phase0 ?? 0) * DEG,
      period,
      node: (o.node ?? 0) * DEG,
    };
    const pseed = hash32(seed, id, hashStr(def.name));
    const { planet } = generatePlanet(content, { id, name: def.name, seed: pseed, kind: def.kind, orbit, overrides });
    u.addPlanet(planet);
    made.push({ p: planet, vegetation: kind.vegetation });
    for (const m of def.moons ?? []) add(m, planet);
  };
  for (const pl of sc.planets) add(pl, null);

  const focus = sc.focus ?? 0;
  for (const { p, vegetation } of made) {
    const sun = u.sun(p, 0);
    const hour = p.id === focus ? sc.startHour ?? 9.5 : 11;
    p.st.spin0 = spinForHour(hour, sun.lon);
    p.st.spinTick0 = 0;
    computeOcean(p, p.st.seaLevel);
    for (let c = 0; c < p.count; c++) if (p.s.ocean[c]) p.f.water[c] = Math.max(0, p.st.seaLevel - p.f.surface[c]);
    initClimate(u, p);
    initHydrology(u, p);
    initVegetation(u, p, vegetation);
    initBiomes(u, p);
    markInitialFirsts(p);
    p.hydro.sourced = 0; // conservation accounting starts from the generated state
  }
  const fp = u.planet(focus) ?? u.planets[0];
  if (fp) {
    const P = fp.grid.pos;
    // default "here": a land cell facing the morning sun near the equator, else the first cell
    let best = 0, bs = -Infinity;
    for (let c = 0; c < fp.count; c += 7) {
      const land = fp.f.water[c] < 0.1 ? 1 : 0;
      const sc2 = land * 2 - Math.abs(P[c * 3 + 1]) + P[c * 3 + 2];
      if (sc2 > bs) { bs = sc2; best = c; }
    }
    u.focus = { planet: fp.id, pos: [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]] };
  }
  return u;
}
