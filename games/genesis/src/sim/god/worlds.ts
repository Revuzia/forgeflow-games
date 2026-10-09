// GENESIS — worlds (CONTRACT.md §11.1 worlds, §12): birth a planet of any kind at an orbit (optionally green, with
// herds and a people), move a world (its year follows Kepler, its climate follows the light), crack one (quake storms,
// rifts, a debris ring and moonlets thrown off, its people killed and its towns broken), erase one (anyone on it dies,
// ships bound for it drift stranded; the chronicle says so), add a moon, drop a moon (the moon-fall disaster: it spirals
// in over days, the tides grow, then it strikes), and seed a species across a world. A new world is generated and
// brought to life exactly as a scenario's are (geology -> sea -> climate equilibrium -> rivers -> vegetation -> biomes).

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { OrbitParams } from '../types.ts';
import type { V3 } from './state.ts';
import { generatePlanet, resolveKind } from '../world/planet.ts';
import { AU, spinForHour } from '../world/orbits.ts';
import { computeOcean, initHydrology } from '../fields/hydrology.ts';
import { initClimate, seedRiparian, resetClimateMemory } from '../fields/climate.ts';
import { initVegetation, plantArea } from '../fields/vegetation.ts';
import { initBiomes } from '../fields/biomes.ts';
import { markInitialFirsts, milestonesCheck } from '../chronicle.ts';
import { makeCtx } from '../people/ctx.ts';
import { initHerds, animalIdx, habitatFit, spawnHerd } from '../life/herds.ts';
import { spawnPeople } from '../people/spawn.ts';
import { bestSiteOnPlanet } from '../people/spawn.ts';
import { hash32, hashFloat, hashStr } from '../core/rng.ts';
import { DEATH, GODS } from '../people/defs.ts';
import { BuildingFlag } from '../types.ts';
import { die } from '../people/lifecycle.ts';
import { spawnDisaster } from './disasters.ts';
import { cellPos3, fail, ok, r3 } from './util.ts';
import { anchorSpin } from './params.ts';
import { meanAnomaly } from '../world/orbits.ts';
import { harmArea, damageArea } from '../people/people.ts';
import { worldErased } from '../space/index.ts';
import { breathable } from '../space/habitat.ts';
import { seasonTemps, siteScore } from '../people/settlement.ts';

const DEG = Math.PI / 180;
const NAMES = ['Ember', 'Thule', 'Oria', 'Kessa', 'Varun', 'Nimbus', 'Halcyon', 'Pell', 'Arkady', 'Sorrow', 'Morrow', 'Quill'];

/** make and initialise a planet (or moon, with a parent) */
export function birthPlanet(u: Universe, o: { kind: string; name?: string; distance?: number; yearDays?: number; parent?: Planet | null; moonDistance?: number; overrides?: Record<string, unknown>; vegetation?: number; tune?: boolean; fitFor?: number }): Planet | string {
  const c = u.content;
  if (!c.planetkinds.has(o.kind)) return `There is no kind of world called '${o.kind}'. Known: ${c.planetkinds.ids().join(', ')}.`;
  const id = u.planets.reduce((m, q) => Math.max(m, q.id), -1) + 1;
  const parent = o.parent ?? null;
  const name = o.name ?? `${NAMES[hash32(u.seed, id, 0x9a3) % NAMES.length]}${parent ? ' Minor' : ''}`;
  const overrides = { ...(o.overrides ?? {}) };
  if (parent && overrides.n === undefined) overrides.n = 16;
  else if (overrides.n === undefined) overrides.n = 40;
  // a world the god makes is what its kind means at whatever orbit it is put: its greenhouse is tuned to the light
  // there (a terran world at 1.5 AU is temperate, not a snowball) — about 80 % of the change in radiative equilibrium
  if (!parent && o.tune !== false && overrides.climateOffset === undefined && c.planetkinds.get(o.kind).atmosphere.pressure > 0.05) {
    const flux = u.star.luminosity / Math.max(0.01, (o.distance ?? 1.2) ** 2);
    overrides.climateOffset = Math.round((c.planetkinds.get(o.kind).climateOffset + 0.8 * 288 * (1 - Math.pow(Math.max(1e-4, flux), 0.25))) * 10) / 10;
  }
  const kind = resolveKind(c, o.kind, overrides);
  const yearDays = o.yearDays ?? Math.max(2, 12 * Math.pow(Math.max(0.05, o.distance ?? 1.2), 1.5));
  const orbit: OrbitParams = parent
    ? { parent: parent.id, a: o.moonDistance ?? 15000 + 5000 * hashFloat(u.seed, id, 1), e: 0.02, inc: 4 * DEG, phase0: hashFloat(u.seed, id, 2) * 6.283, period: Math.max(60, (1 + 2 * hashFloat(u.seed, id, 3)) * parent.st.dayHours * 60), node: hashFloat(u.seed, id, 4) * 6.283 }
    : { parent: -1, a: (o.distance ?? 1.2) * AU, e: 0.02, inc: 2 * DEG * hashFloat(u.seed, id, 5), phase0: hashFloat(u.seed, id, 6) * 6.283, period: Math.max(60, yearDays * kind.dayHours * 60), node: hashFloat(u.seed, id, 7) * 6.283 };
  const pseed = hash32(u.seed, id, hashStr(name));
  const { planet: p } = generatePlanet(c, { id, name, seed: pseed, kind: o.kind, orbit, overrides });
  u.addPlanet(p);
  const sun = u.sun(p, u.tick);
  p.st.spin0 = spinForHour(11, sun.lon);
  p.st.spinTick0 = u.tick;
  computeOcean(p, p.st.seaLevel);
  for (let cc = 0; cc < p.count; cc++) if (p.s.ocean[cc]) p.f.water[cc] = Math.max(0, p.st.seaLevel - p.f.surface[cc]);
  initClimate(u, p);
  // a world made for a people: its warmth tuned to theirs (the year's mean over its land at the middle of the range they
  // live well in — a methane people's world is far colder than a terran one at the same orbit)
  if (o.fitFor !== undefined && o.fitFor >= 0 && !parent) {
    const [, lo, hi] = c.species.list[o.fitFor].temp;
    for (let k = 0; k < 3; k++) {
      let sum = 0, area = 0;
      for (let cc = 0; cc < p.count; cc++) if (!p.s.ocean[cc]) { sum += p.s.tempYear[cc] * p.grid.area[cc]; area += p.grid.area[cc]; }
      const mean = area > 0 ? sum / area : (lo + hi) / 2;
      const delta = (lo + hi) / 2 - mean;
      if (Math.abs(delta) < 1.5) break;
      p.st.climateOffset = Math.round((p.st.climateOffset + delta) * 10) / 10;
      initClimate(u, p);
    }
  }
  initHydrology(u, p);
  seedRiparian(p);
  initVegetation(u, p, o.vegetation ?? kind.vegetation);
  initBiomes(u, p);
  markInitialFirsts(p);
  p.hydro.sourced = 0;
  p.people.reindex(u.tick);
  initHerds(makeCtx(u, p));
  return p;
}

/** the best place on a world for a people to live through its whole year (-1: every place would kill them) */
function livingSite(x: ReturnType<typeof makeCtx>, species: number, salt: number): number {
  const [tMin, , , tMax] = x.c.species.list[species].temp;
  let best = -1, bs = -Infinity;
  const step = Math.max(1, Math.floor(x.p.count / 2500));
  for (let c = salt % step; c < x.p.count; c += step) {
    if (x.p.f.water[c] > 0.15) continue;
    const t = seasonTemps(x, c);
    if (t.hot > tMax || t.cold < tMin) continue;
    const v = siteScore(x, species, c) + hashFloat(c, salt, 0x5173) * 0.6;
    if (v > bs) { bs = v; best = c; }
  }
  return best;
}

/** the kinds of world whose air a species breathes, in words */
function worldsFor(u: Universe, sp: { breathes: string }): string {
  const kinds = u.content.planetkinds.list.filter((k) => breathable(sp as Parameters<typeof breathable>[0], k.atmosphere)).map((k) => k.id);
  return kinds.length ? kinds.join(', ') : 'none yet';
}

function planetArg(u: Universe, a: Record<string, unknown>, fallback: Planet): Planet | undefined {
  if (typeof a.world === 'number') return u.planet(a.world);
  if (typeof a.world === 'string') { const n = a.world.toLowerCase(); return u.planets.find((q) => q.name.toLowerCase() === n || q.name.toLowerCase().startsWith(n)); }
  return fallback;
}

/** everyone on a world dies (erase) */
function killAll(u: Universe, p: Planet): number {
  if (!p.people) return 0;
  const x = makeCtx(u, p);
  let n = 0;
  for (let s = 0; s < x.A.hi; s++) if (x.A.alive[s]) { die(x, s, DEATH.god); n++; }
  for (const st of x.ps.settlements) n += Math.round(st.cohort.n[0] + st.cohort.n[1] + st.cohort.n[2]);
  return n;
}

const wArg: ParamSchema = { type: 'any', desc: 'a world (id or name); default: this one' };

export function registerWorldCommands(r: CommandRegistry): void {
  r.register('world.birth', ({ u }, a) => {
    const life = typeof a.life === 'number' ? a.life : a.life === true ? 1 : undefined;
    const fitFor = typeof a.people === 'string' && u.content.species.has(a.people) ? u.content.species.idx(a.people) : undefined;
    const p = birthPlanet(u, {
      kind: String(a.kind), name: typeof a.name === 'string' ? a.name.slice(0, 30) : undefined, distance: a.distance as number | undefined, yearDays: a.yearDays as number | undefined,
      overrides: typeof a.n === 'number' ? { n: a.n } : undefined, vegetation: life, fitFor,
    });
    if (typeof p === 'string') return fail(p);
    u.chronicleAdd(p, 'world', `A new world was born: ${p.name}, ${u.content.planetkinds.get(p.st.kind).name.toLowerCase()}, ${r3(p.st.orbit.a / AU)} AU from the star.`, 3);
    const created: { kind: 'planet' | 'settlement'; id: number; planet: number }[] = [{ kind: 'planet', id: p.id, planet: p.id }];
    // a people set down on it at once
    let peopled = '';
    if (typeof a.people === 'string' && a.people) {
      const id = a.people;
      if (!u.content.species.has(id)) return ok(`${p.name} is born, ${r3(p.st.orbit.a / AU)} AU from the star — but there is no people called '${id}' to set on it.`, created);
      const x = makeCtx(u, p);
      const sp = u.content.species.idx(id);
      const def = u.content.species.list[sp];
      const plural = def.plural.replace(/^the /, '');
      // a place they can live through the year, else they are not set down to die (said in words)
      const c = livingSite(x, sp, hash32(p.id, 0xb17));
      if (!breathable(def, p.st.atmosphere)) peopled = ` — but ${plural} cannot breathe its air, so none were set on it (a world of their own breath: ${worldsFor(u, def)})`;
      else if (c < 0) peopled = ` — but nowhere on it could ${plural} live through its year, so none were set on it`;
      else {
        const st = spawnPeople(u, p, { species: id, count: Math.max(4, Math.round(Number(a.count ?? 24))), pos: cellPos3(p, c), era: typeof a.era === 'string' ? a.era : 'stone', settled: typeof a.era === 'string' && a.era !== 'stone' });
        if (st) { created.push({ kind: 'settlement', id: st.id, planet: p.id }); peopled = `, and ${plural} live on it`; }
      }
    }
    milestonesCheck(u, p, true);
    return ok(`${p.name} is born, ${r3(p.st.orbit.a / AU)} AU from the star${life !== undefined && life > 0 ? ', green with life' : ''}${peopled}.`, created);
  }, {
    desc: 'Birth a new world', category: 'Worlds',
    params: {
      kind: { type: 'enum', values: (u) => u.content.planetkinds.ids(), default: 'terran' }, name: { type: 'string' }, distance: { type: 'number', min: 0.1, max: 40, default: 1.5 },
      yearDays: { type: 'number', min: 1, max: 1000 }, n: { type: 'int', min: 8, max: 96 },
      life: { type: 'any', desc: 'plants and herds: true, or a richness 0..3 (default: the kind\'s own)' },
      people: { type: 'string', desc: 'a people to set on it (species id)' }, count: { type: 'int', min: 4, max: 500 }, era: { type: 'enum', values: ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'] },
    },
  });
  r.register('world.moon-add', ({ u, p }, a) => {
    const host = planetArg(u, a, p);
    if (!host || !host.alive) return fail('There is no such world.');
    if (host.st.orbit.parent >= 0) return fail(`${host.name} is itself a moon.`);
    const m = birthPlanet(u, { kind: String(a.kind ?? 'moon'), name: typeof a.name === 'string' ? a.name.slice(0, 30) : undefined, parent: host, moonDistance: a.distance as number | undefined });
    if (typeof m === 'string') return fail(m);
    u.chronicleAdd(host, 'world', `A new moon, ${m.name}, rose over ${host.name}.`, 2);
    return ok(`${m.name} now circles ${host.name}.`, [{ kind: 'moon', id: m.id, planet: m.id }]);
  }, { desc: 'Give a world a new moon', category: 'Worlds', params: { world: wArg, kind: { type: 'enum', values: (u) => u.content.planetkinds.ids(), default: 'moon' }, name: { type: 'string' }, distance: { type: 'number', min: 4000, max: 200000 } } });
  r.register('world.moon-fall', ({ u, p, cmd }, a) => {
    const host = planetArg(u, a, p);
    if (!host || !host.alive) return fail('There is no such world.');
    const moon = typeof a.moon === 'number' ? u.planet(a.moon) : u.planets.find((q) => q.alive && q.st.orbit.parent === host.id);
    const d = spawnDisaster(u, host, 'moon-fall', { pos: (a.pos as V3 | null) ?? undefined, target: moon ? moon.id : -1, god: typeof cmd.god === 'number' ? cmd.god : 0 });
    if (typeof d === 'string') return fail(d);
    return ok(`${moon ? moon.name : 'A second moon'} begins to fall toward ${host.name}. It will strike in ${Math.round(d.life / 60 / host.st.dayHours)} days.`, [{ kind: 'disaster', id: d.id, planet: host.id }]);
  }, { desc: 'Drop a moon onto its world', category: 'Worlds', params: { world: wArg, moon: { type: 'int', min: 0 }, pos: { type: 'pos' } } });
  r.register('world.move', ({ u, p }, a) => {
    const w = planetArg(u, a, p);
    if (!w || !w.alive) return fail('There is no such world.');
    const msgs: string[] = [];
    // the day keeps its hour across the move (the spin is anchored now; the sun's longitude moves with the orbit)
    anchorSpin(u, w);
    const o = w.st.orbit;
    const M = meanAnomaly(o, u.tick);
    if (typeof a.distance === 'number') {
      const a0 = o.a;
      o.a = o.parent >= 0 ? a.distance * AU * 0.01 : a.distance * AU;
      // Kepler: the year follows the orbit (T ∝ a^1.5); the world stays where it is on it (mean anomaly kept)
      o.period = Math.max(60, Math.round(o.period * Math.pow(o.a / Math.max(1, a0), 1.5)));
      o.phase0 = M - (2 * Math.PI * u.tick) / o.period;
      msgs.push(`${r3(a.distance)} AU (a year of ${r3(o.period / (w.st.dayHours * 60))} days)`);
    }
    if (typeof a.eccentricity === 'number') { o.e = a.eccentricity; msgs.push(`eccentricity ${r3(a.eccentricity)}`); }
    if (typeof a.inclination === 'number') { o.inc = a.inclination * DEG; msgs.push(`inclination ${r3(a.inclination)}°`); }
    if (!msgs.length) return fail('Move it how? Give a distance (AU), eccentricity or inclination.');
    anchorSpin(u, w);
    resetClimateMemory(w);
    u.chronicleAdd(w, 'world', `${w.name} was moved to a new orbit (${msgs.join(', ')}).`, 2);
    return ok(`${w.name} swings out onto a new orbit: ${msgs.join(', ')}.`);
  }, { desc: 'Move a world to a new orbit', category: 'Worlds', params: { world: wArg, distance: { type: 'number', min: 0.05, max: 40 }, eccentricity: { type: 'number', min: 0, max: 0.9 }, inclination: { type: 'number', min: 0, max: 90 } } });
  r.register('world.crack', ({ u, p, cmd }, a) => {
    const w = planetArg(u, a, p);
    if (!w || !w.alive) return fail('There is no such world.');
    const g = typeof cmd.god === 'number' ? cmd.god : 0;
    const before = w.people ? w.people.agents.count : 0;
    // quake storms across the face of the world, rifts with lava, and moonlets thrown off into orbit
    let n = 0;
    for (let k = 0; k < 6; k++) {
      const c = Math.floor(hashFloat(w.seed, u.tick, k, 0xc4a) * w.count);
      const d = spawnDisaster(u, w, k % 2 ? 'quake' : 'rift', { pos: cellPos3(w, c), god: g, intensity: 1.3, quiet: true });
      if (typeof d !== 'string') n++;
    }
    // the first shock runs under every town at once: walls fall, and a third to three-fifths of its people die (the
    // world's own draw), the rest hurt and afraid
    let ruined = 0, broken = 0;
    const share = 0.3 + 0.3 * hashFloat(w.seed, u.tick, 0xc4c);
    let dead = 0;
    if (w.people) {
      const x = makeCtx(u, w);
      const A = x.A;
      for (let s = 0; s < A.hi; s++) {
        if (!A.alive[s]) continue;
        const r = hashFloat(A.id[s], u.tick, 0xc4b);
        if (r < share) { die(x, s, DEATH.disaster); dead++; continue; }
        A.health[s] = Math.max(0.05, A.health[s] - 0.35 * (1 - r));
        A.fear[s * GODS] = Math.min(1, A.fear[s * GODS] + 0.3);
      }
      for (const st of x.ps.settlements) {
        if (st.fallen >= 0) continue;
        const co = st.cohort;
        for (let k = 0; k < 3; k++) { const d = co.n[k] * share; co.n[k] = Math.max(0, Math.round((co.n[k] - d) * 1000) / 1000); dead += Math.round(d); }
      }
      const was = new Map(x.ps.buildings.map((b) => [b.id, b.damage]));
      for (const st of x.ps.settlements.filter((o) => o.fallen < 0)) ruined += damageArea(u, w, st.pos, Math.max(160, st.territory * 1.4), 0.75, 'the world cracked');
      for (const b of x.ps.buildings) if (b.flags & BuildingFlag.ruined || (b.damage >= 0.5 && (was.get(b.id) ?? 0) < 0.5)) broken++;
      broken = Math.max(broken, ruined);
    }
    void before; void harmArea;
    const moonlets: string[] = [];
    if (w.st.orbit.parent < 0) for (let k = 0; k < 2; k++) {
      const m = birthPlanet(u, { kind: 'moon', parent: w, name: `${w.name} shard ${k + 1}`, overrides: { n: 12, radius: 300 + 300 * k } });
      if (typeof m !== 'string') moonlets.push(m.name);
    }
    // what did not gather into moonlets circles as a ring of rubble
    const R = w.st.radius;
    const ring = w.st.ring ?? { inner: R * 1.6, outer: R * 2.4, density: 0 };
    w.st.ring = { inner: r3(Math.min(ring.inner, R * 1.6)), outer: r3(Math.max(ring.outer, R * 2.4)), density: r3(Math.min(1, ring.density + 0.6)) };
    w.st.atmosphere.dust = r3(w.st.atmosphere.dust + 0.8);
    w.firsts.cracked = u.tick;
    u.chronicleAdd(w, 'world', `${w.name} cracked. The ground split from pole to pole${dead ? `, and ${dead} died in the first shock` : ''}; a ring of rubble circles it now${moonlets.length ? `, and ${moonlets.length} shards of it ride overhead as moons` : ''}.`, 3);
    u.emit({ t: 'world.cracked', planet: w.id, a: dead, b: broken, data: { moonlets: moonlets.length, ring: w.st.ring, ruined } });
    return ok(`${w.name} cracks: ${n} quakes and rifts, ${dead} dead, ${broken} buildings broken (${ruined} in ruins), a debris ring and ${moonlets.length} moonlets.`);
  }, { desc: 'Crack a world', category: 'Worlds', params: { world: wArg } });
  r.register('world.erase', ({ u, p }, a) => {
    const w = planetArg(u, a, p);
    if (!w || !w.alive) return fail('There is no such world.');
    if (u.planets.filter((q) => q.alive).length <= 1) return fail(`${w.name} is the only world: there would be nothing left.`);
    const dead = killAll(u, w);
    w.alive = false;
    for (const m of u.planets) if (m.st.orbit.parent === w.id && m.alive) { killAll(u, m); m.alive = false; }
    u.god.disasters = u.god.disasters.filter((d) => d.planet !== w.id);
    u.god.creatures = u.god.creatures.filter((c) => c.planet !== w.id);
    for (const h of u.god.hands) if (h.planet === w.id) { h.held = null; const other = u.planets.find((q) => q.alive); if (other) h.planet = other.id; }
    if (u.focus && u.focus.planet === w.id) { const other = u.planets.find((q) => q.alive)!; u.focus = { planet: other.id, pos: [0, 0, 1] }; }
    u.chronicleAdd(w, 'world', `${w.name} was unmade${dead ? `, and ${dead} souls with it` : ''}. Where it turned there is only dark.`, 3);
    // ships bound for it drift on with nowhere to land; ships on it or around it go with it
    const ships = worldErased(u, w.id);
    for (const m of u.planets) if (m.st.orbit.parent === w.id) worldErased(u, m.id);
    u.emit({ t: 'world.erased', planet: w.id, a: dead, data: ships });
    return ok(`${w.name} is gone${dead ? ` (${dead} dead)` : ''}${ships.stranded ? `; ${ships.stranded} ship${ships.stranded === 1 ? '' : 's'} bound for it drift stranded` : ''}${ships.destroyed ? `; ${ships.destroyed} ship${ships.destroyed === 1 ? '' : 's'} went with it` : ''}.`);
  }, { desc: 'Erase a world', category: 'Worlds', params: { world: wArg } });
  r.register('world.seed-species', ({ u, p }, a) => {
    const w = planetArg(u, a, p);
    if (!w || !w.alive) return fail('There is no such world.');
    const id = String(a.species);
    const n = Math.max(1, Math.round(Number(a.count ?? 3)));
    const x = makeCtx(u, w);
    if (u.content.species.has(id)) {
      // a people: set down at the best places to live
      let made = 0;
      for (let k = 0; k < n; k++) {
        const c = bestSiteOnPlanet(x, u.content.species.idx(id), hash32(u.tick, k, 0x5eed));
        const st = spawnPeople(u, w, { species: id, count: Math.max(6, Math.round(Number(a.size ?? 20))), pos: cellPos3(w, c), era: 'stone', settled: false });
        if (st) made++;
      }
      return made ? ok(`${made} band${made === 1 ? '' : 's'} of ${u.content.species.get(id).plural.replace(/^the /, '')} are set down across ${w.name}.`) : fail(`${u.content.species.get(id).name} cannot be placed on ${w.name}.`);
    }
    const sp = animalIdx(x, id);
    if (sp >= 0) {
      let made = 0;
      for (let k = 0; k < n * 8 && made < n; k++) {
        const c = Math.floor(hashFloat(u.tick, k, 0x5eee) * w.count);
        if (habitatFit(x, sp, c) <= 0) continue;
        spawnHerd(x, sp, c, Math.max(2, Math.round(Number(a.size ?? 8))));
        made++;
      }
      return made ? ok(`${made} herds are loosed across ${w.name}.`) : fail(`Nowhere on ${w.name} suits that animal.`);
    }
    const pl = u.content.plants.idx(id);
    if (pl >= 0) {
      let cells = 0;
      for (let k = 0; k < n * 3; k++) {
        const c = Math.floor(hashFloat(u.tick, k, 0x5eef) * w.count);
        cells += plantArea(u, w, pl, cellPos3(w, c), 400, 0.5);
      }
      return cells ? ok(`${u.content.plants.list[pl].name} takes root across ${w.name} (${cells} cells).`) : fail(`${u.content.plants.list[pl].name} will not grow on ${w.name}.`);
    }
    return fail(`There is no species called '${id}' (a people, an animal or a plant).`);
  }, {
    desc: 'Seed a species across a world', category: 'Worlds',
    params: { world: wArg, species: { type: 'string', required: true }, count: { type: 'int', min: 1, max: 50, default: 3 }, size: { type: 'int', min: 1, max: 500 } },
  });
}
