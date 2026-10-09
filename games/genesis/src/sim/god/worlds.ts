// GENESIS — worlds (CONTRACT.md §11.1 worlds, §12): birth a planet of any kind at an orbit, move a world, crack one
// (quake storms, rifts, moonlets thrown off, inhabitants suffer), erase one (anyone on it dies; the chronicle says so),
// add a moon, drop a moon (the moon-fall disaster), and seed a species across a world. A new world is generated and
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
import { markInitialFirsts } from '../chronicle.ts';
import { makeCtx } from '../people/ctx.ts';
import { initHerds, animalIdx, habitatFit, spawnHerd } from '../life/herds.ts';
import { spawnPeople } from '../people/spawn.ts';
import { bestSiteOnPlanet } from '../people/spawn.ts';
import { hash32, hashFloat, hashStr } from '../core/rng.ts';
import { DEATH } from '../people/defs.ts';
import { die } from '../people/lifecycle.ts';
import { spawnDisaster } from './disasters.ts';
import { cellPos3, fail, ok, r3 } from './util.ts';

const DEG = Math.PI / 180;
const NAMES = ['Ember', 'Thule', 'Oria', 'Kessa', 'Varun', 'Nimbus', 'Halcyon', 'Pell', 'Arkady', 'Sorrow', 'Morrow', 'Quill'];

/** make and initialise a planet (or moon, with a parent) */
export function birthPlanet(u: Universe, o: { kind: string; name?: string; distance?: number; yearDays?: number; parent?: Planet | null; moonDistance?: number; overrides?: Record<string, unknown> }): Planet | string {
  const c = u.content;
  if (!c.planetkinds.has(o.kind)) return `There is no kind of world called '${o.kind}'. Known: ${c.planetkinds.ids().join(', ')}.`;
  const id = u.planets.reduce((m, q) => Math.max(m, q.id), -1) + 1;
  const parent = o.parent ?? null;
  const name = o.name ?? `${NAMES[hash32(u.seed, id, 0x9a3) % NAMES.length]}${parent ? ' Minor' : ''}`;
  const overrides = { ...(o.overrides ?? {}) };
  if (parent && overrides.n === undefined) overrides.n = 16;
  else if (overrides.n === undefined) overrides.n = 40;
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
  initHydrology(u, p);
  seedRiparian(p);
  initVegetation(u, p, kind.vegetation);
  initBiomes(u, p);
  markInitialFirsts(p);
  p.hydro.sourced = 0;
  p.people.reindex(u.tick);
  initHerds(makeCtx(u, p));
  return p;
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
    const p = birthPlanet(u, { kind: String(a.kind), name: typeof a.name === 'string' ? a.name.slice(0, 30) : undefined, distance: a.distance as number | undefined, yearDays: a.yearDays as number | undefined, overrides: typeof a.n === 'number' ? { n: a.n } : undefined });
    if (typeof p === 'string') return fail(p);
    u.chronicleAdd(p, 'world', `A new world was born: ${p.name}, ${u.content.planetkinds.get(p.st.kind).name.toLowerCase()}, ${r3(p.st.orbit.a / AU)} AU from the star.`, 3);
    return ok(`${p.name} is born, ${r3(p.st.orbit.a / AU)} AU from the star.`, [{ kind: 'planet', id: p.id, planet: p.id }]);
  }, {
    desc: 'Birth a new world', category: 'Worlds',
    params: { kind: { type: 'enum', values: (u) => u.content.planetkinds.ids(), default: 'terran' }, name: { type: 'string' }, distance: { type: 'number', min: 0.1, max: 40, default: 1.5 }, yearDays: { type: 'number', min: 1, max: 1000 }, n: { type: 'int', min: 8, max: 96 } },
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
    if (typeof a.distance === 'number') {
      w.st.orbit.a = w.st.orbit.parent >= 0 ? a.distance * AU * 0.01 : a.distance * AU;
      msgs.push(`${r3(a.distance)} AU`);
    }
    if (typeof a.eccentricity === 'number') { w.st.orbit.e = a.eccentricity; msgs.push(`eccentricity ${r3(a.eccentricity)}`); }
    if (typeof a.inclination === 'number') { w.st.orbit.inc = a.inclination * DEG; msgs.push(`inclination ${r3(a.inclination)}°`); }
    if (!msgs.length) return fail('Move it how? Give a distance (AU), eccentricity or inclination.');
    resetClimateMemory(w);
    u.chronicleAdd(w, 'world', `${w.name} was moved to a new orbit (${msgs.join(', ')}).`, 2);
    return ok(`${w.name} swings out onto a new orbit: ${msgs.join(', ')}.`);
  }, { desc: 'Move a world to a new orbit', category: 'Worlds', params: { world: wArg, distance: { type: 'number', min: 0.05, max: 40 }, eccentricity: { type: 'number', min: 0, max: 0.9 }, inclination: { type: 'number', min: 0, max: 90 } } });
  r.register('world.crack', ({ u, p, cmd }, a) => {
    const w = planetArg(u, a, p);
    if (!w || !w.alive) return fail('There is no such world.');
    const g = typeof cmd.god === 'number' ? cmd.god : 0;
    // quake storms across the face of the world, rifts with lava, and moonlets thrown off into orbit
    let n = 0;
    for (let k = 0; k < 6; k++) {
      const c = Math.floor(hashFloat(w.seed, u.tick, k, 0xc4a) * w.count);
      const d = spawnDisaster(u, w, k % 2 ? 'quake' : 'rift', { pos: cellPos3(w, c), god: g, intensity: 1.3, quiet: true });
      if (typeof d !== 'string') n++;
    }
    const moonlets: string[] = [];
    if (w.st.orbit.parent < 0) for (let k = 0; k < 2; k++) {
      const m = birthPlanet(u, { kind: 'moon', parent: w, name: `${w.name} shard ${k + 1}`, overrides: { n: 12, radius: 300 + 300 * k } });
      if (typeof m !== 'string') moonlets.push(m.name);
    }
    w.st.atmosphere.dust = r3(w.st.atmosphere.dust + 0.8);
    w.firsts.cracked = u.tick;
    u.chronicleAdd(w, 'world', `${w.name} cracked. The ground split from pole to pole${moonlets.length ? `, and ${moonlets.length} shards of it now circle overhead` : ''}.`, 3);
    return ok(`${w.name} cracks: ${n} quakes and rifts, ${moonlets.length} moonlets.`);
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
    return ok(`${w.name} is gone${dead ? ` (${dead} dead)` : ''}.`);
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
