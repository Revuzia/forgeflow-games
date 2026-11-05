// GENESIS test helper: the drought fixture of tests/drought-band.test.ts (LIVING.md §2.7) — a 30-person stone-age village
// on the n = 64 sandbox under a held dust bowl. Shared with helpers/dustbowl-worker.ts, which runs seeds in worker threads
// so the 16-seed total runs four seeds at a time (POSTREL SIMFIX r3: it was the gate's longest test, 905 s under load).
import assert from 'node:assert/strict';
import { Sim } from '../../src/sim/sim.ts';
import type { Settlement } from '../../src/sim/people/state.ts';
import { world, people, must } from './peoples.ts';
import { TASK } from '../../src/sim/people/defs.ts';
import { NEED_N, WATER } from '../../src/sim/people/needs.ts';
import { ROAD_W } from '../../src/sim/people/waterway.ts';

export interface DustBowl { sim: Sim; town: Settlement; fellH: number; deaths: Record<string, number>; alive: number; road: { keep: number; drink: number } }

/** the drought fixture set down: village, a day at 3000x; `dry` is the god holding the dust bowl (call it every hour) */
export function dustBowlStart(seed: number, radius = 1500, n = 30): { sim: Sim; town: Settlement; dry: (on: Sim) => void } {
  const sim = world(64, seed);
  people(sim, 'plains-folk', n, { era: 'stone', settled: true });
  must(sim, { k: 'time.scale', tps: 3000 });
  sim.step(1440);
  const town = sim.u.planets[0].people.settlements.find((s) => s.fallen < 0 && !s.band);
  assert.ok(town, `seed ${seed}: a village stands after a day`);
  const disc = sim.u.planets[0].cellsNear(town.pos.slice(), radius).slice();
  const dry = (on: Sim) => {
    const p = on.u.planets[0], f = p.f;
    for (const c of disc) { if (p.s.ocean[c]) continue; f.water[c] = 0; f.moisture[c] = 0; f.aquifer[c] = 0; f.wetness[c] = 0; f.precip[c] = 0; }
  };
  sim.drainEvents();
  return { sim, town, dry };
}

/** the drought fixture: the dust bowl held for `hold` h over the village, `hours` h watched; on the band's first day,
 * how many members with water to spare (>= ROAD_W) keep to the band's road and how many are off on drink trips */
export function dustBowl(seed: number, hours = 144, hold = 96, radius = 1500): DustBowl {
  const { sim, town, dry } = dustBowlStart(seed, radius);
  const ps = sim.u.planets[0].people, A = ps.agents;
  const deaths: Record<string, number> = {};
  const road = { keep: 0, drink: 0 };
  let fellH = -1;
  for (let h = 0; h < hours; h++) {
    if (h < hold) dry(sim);
    sim.step(60);
    for (const e of sim.drainEvents()) if (e.t === 'death') { const k = String((e.data as { cause?: string } | undefined)?.cause ?? '?'); deaths[k] = (deaths[k] ?? 0) + 1; }
    if (fellH < 0 && town.fallen >= 0) fellH = h + 1;
    if (fellH >= 0 && h + 1 - fellH < 24) {
      for (const b of ps.settlements) {
        if (!b.band || b.fallen >= 0) continue;
        for (const m of ps.members.get(b.id) ?? []) {
          if (A.needs[m * NEED_N + WATER] < ROAD_W) continue;
          if (A.task[m] === TASK.drink) road.drink++; else road.keep++;
        }
      }
    }
  }
  let alive = 0;
  for (const s of ps.settlements) if (s.fallen < 0) alive += ps.members.get(s.id)?.length ?? 0;
  return { sim, town, fellH, deaths, alive, road };
}

/** what a worker thread hands back for one seed of the 16-seed total (the Sim itself does not cross threads) */
export interface DustBowlRow { seed: number; thirst: number; fellH: number; alive: number; livesOn: boolean; road: { keep: number; drink: number } }

export function dustBowlRow(seed: number): DustBowlRow {
  const r = dustBowl(seed);
  const ps = r.sim.u.planets[0].people;
  const livesOn = ps.settlements.some((s) => s.fallen < 0 && (ps.members.get(s.id)?.length ?? 0) > 0);
  return { seed, thirst: r.deaths.thirst ?? 0, fellH: r.fellH, alive: r.alive, livesOn, road: r.road };
}
