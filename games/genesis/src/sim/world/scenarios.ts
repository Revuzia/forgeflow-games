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
import { initClimate, seedRiparian } from '../fields/climate.ts';
import { initVegetation } from '../fields/vegetation.ts';
import { initBiomes } from '../fields/biomes.ts';
import { markInitialFirsts } from '../chronicle.ts';
import { makeCtx } from '../people/ctx.ts';
import { initHerds } from '../life/herds.ts';
import { spawnPeople } from '../people/spawn.ts';
import { siteScore } from '../people/settlement.ts';
import { ERAS } from '../content.ts';

/** a scenario's people entry (scenarios.json "peoples") */
interface PeopleEntry {
  phase?: number;
  species: string;
  planet: number;
  count: number;
  era?: string;
  /** several settlements of this people: 'village' | 'town' | 'city' each (eras step up toward the last) */
  settlements?: string[];
}

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
  /** planet ids of the scenario's top-level planets, in its order (moons take ids in between) */
  const topIds: number[] = [];

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
    if (!parent) topIds.push(id);
    const pseed = hash32(seed, id, hashStr(def.name));
    const { planet } = generatePlanet(content, { id, name: def.name, seed: pseed, kind: def.kind, orbit, overrides });
    u.addPlanet(planet);
    made.push({ p: planet, vegetation: kind.vegetation });
    for (const m of def.moons ?? []) add(m, planet);
  };
  for (const pl of sc.planets) add(pl, null);

  // like `peoples[].planet`, `focus` counts the scenario's own planets (moons take ids in between)
  const focus = topIds[sc.focus ?? 0] ?? 0;
  for (const { p, vegetation } of made) {
    const sun = u.sun(p, 0);
    const hour = p.id === focus ? sc.startHour ?? 9.5 : 11;
    p.st.spin0 = spinForHour(hour, sun.lon);
    p.st.spinTick0 = 0;
    computeOcean(p, p.st.seaLevel);
    for (let c = 0; c < p.count; c++) if (p.s.ocean[c]) p.f.water[c] = Math.max(0, p.st.seaLevel - p.f.surface[c]);
    initClimate(u, p);
    initHydrology(u, p);
    seedRiparian(p);
    initVegetation(u, p, vegetation);
    initBiomes(u, p);
    markInitialFirsts(p);
    p.hydro.sourced = 0; // conservation accounting starts from the generated state
  }
  // life: herds on living worlds, then the scenario's peoples (CONTRACT §6.5)
  for (const { p } of made) initHerds(makeCtx(u, p));
  for (const raw of sc.peoples as PeopleEntry[]) {
    // "planet" counts the scenario's own planets (moons are not counted)
    const p = u.planet(topIds[raw.planet] ?? -1);
    if (!p || !raw.species) continue;
    const sizes = raw.settlements && raw.settlements.length ? raw.settlements : [null];
    const era = Math.max(0, ERAS.indexOf((raw.era ?? 'stone') as (typeof ERAS)[number]));
    const weight = (sz: string | null) => (sz === 'city' ? 2 : sz === 'town' ? 1.2 : 1);
    const total = sizes.reduce((a, sz) => a + weight(sz), 0);
    sizes.forEach((sz, i) => {
      // several settlements of one people stand at different eras: the last at the scenario's era
      const e = Math.max(0, era - (sizes.length - 1 - i));
      spawnPeople(u, p, {
        species: raw.species, count: Math.max(4, Math.round((raw.count * weight(sz)) / total)), era: ERAS[e],
        settled: true, size: sz ?? undefined,
      });
    });
  }
  const fp = u.planet(focus) ?? u.planets[0];
  if (fp) {
    const P = fp.grid.pos;
    // default "here" (until a client sends `focus`): a land cell facing the morning sun near the equator where a people
    // set down could live (water, food, gentle ground: the plains folk's site score), else the first cell. Without the
    // habitability term a band spawned with no place given could land in waterless dunes and die there.
    const x = makeCtx(u, fp);
    const live = content.species.size > 0 && fp.airy;
    let best = 0, bs = -Infinity;
    for (let c = 0; c < fp.count; c += 7) {
      const land = fp.f.water[c] < 0.1 ? 1 : 0;
      let sc2 = land * 2 - Math.abs(P[c * 3 + 1]) + P[c * 3 + 2];
      if (live && land && sc2 > 1.2) sc2 += 0.25 * Math.max(-1, Math.min(8, siteScore(x, 0, c)));
      if (sc2 > bs) { bs = sc2; best = c; }
    }
    u.focus = { planet: fp.id, pos: [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]] };
  }
  return u;
}
