// GENESIS — shared set-up for the god-layer tests: one small living world with a settled bronze-age town, built once
// per test file and CLONED for each case through save / load (a load costs ~0.1 s, a build several seconds), plus a
// measure of "what the world is like" that disasters must visibly change.
import assert from 'node:assert/strict';
import { Sim } from '../../src/sim/sim.ts';
import type { Command, CommandResult } from '../../src/sim/types.ts';
import type { Settlement } from '../../src/sim/people/state.ts';
import { BuildingFlag } from '../../src/sim/types.ts';

export interface Town {
  sim: Sim;
  st: Settlement;
}

let cache: { bytes: Uint8Array; sid: number } | null = null;

/** a town of ~30 bronze-age plains folk on a small sandbox world (vegetation grown), an hour after it was set down */
export function town(): Town {
  if (!cache) {
    const sim = new Sim({ seed: 20261008, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
    // a quiet world: natural disasters off unless a test turns them on
    must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
    const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true });
    const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
    must(sim, { k: 'settlement.rename', settlement: sid, name: 'Aru' });
    sim.step(60);
    cache = { bytes: sim.save(), sid };
  }
  const sim = Sim.load(cache.bytes);
  const st = sim.u.planets[0].people.settlement(cache.sid)!;
  assert.ok(st, 'the town exists');
  return { sim, st };
}

export interface TwoTowns extends Town {
  /** a second people of another kind 0.9–1.6 km from Aru (coastal folk) */
  lune: Settlement;
  /** a grown person of Aru, renamed Hesh */
  hesh: number;
}

let cache2: { bytes: Uint8Array; aru: number; lune: number; hesh: number } | null = null;

/**
 * Aru (30 bronze-age plains folk) and Lune (20 bronze-age coastal folk, 0.9–1.6 km away on dry land), Hesh a grown person
 * of Aru, the camera on Aru: the world the omnipotence audit ran its words on. Built once, cloned per case.
 */
export function twoTowns(): TwoTowns {
  if (!cache2) {
    const { sim, st } = town();
    const p = sim.u.planets[0];
    const g = p.grid;
    let best = -1, bs = -1;
    for (let c = 0; c < g.count; c++) {
      if (p.f.water[c] > 0.05) continue;
      const q = [g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]];
      const d = Math.acos(Math.max(-1, Math.min(1, q[0] * st.pos[0] + q[1] * st.pos[1] + q[2] * st.pos[2]))) * p.st.radius;
      if (d < 900 || d > 1600) continue;
      const v = p.f.fertility[c] + p.f.tree[c] * 0.3;
      if (v > bs) { bs = v; best = c; }
    }
    const r = must(sim, { k: 'life.spawn-people', species: 'coastal-folk', count: 20, era: 'bronze', settled: true, pos: [g.pos[best * 3], g.pos[best * 3 + 1], g.pos[best * 3 + 2]] });
    const lune = r.created!.find((e) => e.kind === 'settlement')!.id;
    must(sim, { k: 'settlement.rename', settlement: lune, name: 'Lune' });
    sim.step(30);
    must(sim, { k: 'focus', pos: st.pos });
    const ps = p.people;
    const members = ps.members.get(st.id) ?? [];
    const slot = members.find((m) => !(ps.agents.flags[m] & 1) && ps.agents.id[m] !== st.leader) ?? members[0];
    const hesh = ps.agents.id[slot];
    must(sim, { k: 'agent.rename', id: hesh, name: 'Hesh' });
    cache2 = { bytes: sim.save(), aru: st.id, lune, hesh };
  }
  const sim = Sim.load(cache2.bytes);
  const ps = sim.u.planets[0].people;
  return { sim, st: ps.settlement(cache2.aru)!, lune: ps.settlement(cache2.lune)!, hesh: cache2.hesh };
}

export function must(sim: Sim, cmd: Command): CommandResult {
  const r = sim.applyNow(cmd);
  assert.ok(r.ok, `${cmd.k}: ${r.msg}`);
  return r;
}

export function alive(sim: Sim, planet = 0): number {
  return sim.u.planets[planet].people.agents.count;
}

export function standing(sim: Sim, sid?: number, planet = 0): number {
  return sim.u.planets[planet].people.buildings.filter((b) => !(b.flags & BuildingFlag.ruined) && b.progress >= 1 && (sid === undefined || b.settlement === sid)).length;
}

export function ruined(sim: Sim, planet = 0): number {
  return sim.u.planets[planet].people.buildings.filter((b) => b.flags & BuildingFlag.ruined).length;
}

/** mean fear of the player god among a settlement's people */
export function meanFear(sim: Sim, st: Settlement, planet = 0): number {
  const ps = sim.u.planets[planet].people;
  const m = ps.members.get(st.id) ?? [];
  if (!m.length) return 0;
  return m.reduce((a, s) => a + ps.agents.fear[s * 4], 0) / m.length;
}

/** a summary of the world a disaster must visibly change (fields, people, herds, planet and star parameters) */
export function measure(sim: Sim, planet = 0): Record<string, number> {
  const p = sim.u.planets[planet];
  const f = p.f;
  const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const ps = p.people;
  let sick = 0, hurt = 0;
  for (let s = 0; s < ps.agents.hi; s++) if (ps.agents.alive[s]) { if (ps.agents.disease[s] >= 0) sick++; hurt += 1 - Math.min(1, ps.agents.health[s]); }
  return {
    alive: ps.agents.count, hurt, sick, ruined: ruined(sim, planet), damage: ps.buildings.reduce((a, b) => a + b.damage, 0),
    herds: ps.herds.reduce((a, h) => a + h.count, 0), items: ps.items.length, store: ps.settlements.reduce((a, st) => a + st.store.reduce((x, y) => x + y, 0), 0),
    crop: sum(f.crop), tree: sum(f.tree), grass: sum(f.grass), shrub: sum(f.shrub), water: p.waterVolume(), fire: sum(f.fire), lava: sum(f.lava), ash: sum(f.ash), sand: sum(f.sand),
    snow: sum(f.snow), rock: sum(f.rock), soil: sum(f.soil), moisture: sum(f.moisture), aquifer: sum(f.aquifer), radiation: sum(f.radiation), pollution: sum(f.pollution),
    blight: sum(f.blight), fertility: sum(f.fertility), road: sum(f.road), tpot: sum(p.s.tPot), dust: p.st.atmosphere.dust, light: p.st.lightScale, gravity: p.st.gravity,
    magnetism: p.st.magnetism, activity: sim.u.star.activity, climate: p.st.climateOffset, ecc: p.st.orbit.e, weather: p.weather.length, fear: ps.agents.fear.reduce((a, v) => a + v, 0),
    projectiles: sim.u.god.projectiles.length, moons: sim.u.planets.filter((q) => q.alive && q.st.orbit.parent === p.id).length,
  };
}

/** the measures that differ between two summaries (relative tolerance) */
export function changed(a: Record<string, number>, b: Record<string, number>, tol = 1e-6): string[] {
  const out: string[] = [];
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (Math.abs(x - y) > tol * Math.max(1, Math.abs(x), Math.abs(y))) out.push(k);
  }
  return out;
}
