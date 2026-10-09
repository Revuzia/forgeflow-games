// GENESIS — shared set-up for the peoples' tests: a small living terran world, a people set down on it through the
// logged command (so every test exercises the same path a player does), and short accessors.
import assert from 'node:assert/strict';
import { Sim } from '../../src/sim/sim.ts';
import { makeCtx, type PCtx } from '../../src/sim/people/ctx.ts';
import type { Settlement } from '../../src/sim/people/state.ts';
import type { Command } from '../../src/sim/types.ts';

/** a small sandbox world with its vegetation grown (n = 24 is ~5 800 cells: quick, but rivers, seas and herds) */
export function world(n = 24, seed = 20261008): Sim {
  return new Sim({ seed, scenario: 'sandbox', overrides: { n, vegetation: 1 } });
}

/** apply a command now; it must succeed */
export function must(sim: Sim, cmd: Command): ReturnType<Sim['applyNow']> {
  const r = sim.applyNow(cmd);
  assert.ok(r.ok, `${cmd.k}: ${r.msg}`);
  return r;
}

/** set a people down through `life.spawn-people`; returns its settlement (a band unless settled / above stone) */
export function people(sim: Sim, species = 'plains-folk', count = 24, more: Record<string, unknown> = {}): Settlement {
  const r = must(sim, { k: 'life.spawn-people', species, count, ...more } as Command);
  const id = r.created?.find((e) => e.kind === 'settlement')?.id;
  assert.ok(id !== undefined, 'spawn-people names the new settlement');
  const st = sim.u.planets[0].people.settlement(id!);
  assert.ok(st);
  return st!;
}

/** a peoples context for planet 0 at the current tick */
export function ctx(sim: Sim, planet = 0): PCtx {
  return makeCtx(sim.u, sim.u.planets[planet]);
}

/** living member slots of a settlement (ascending id) */
export function membersOf(sim: Sim, st: Settlement, planet = 0): number[] {
  return (sim.u.planets[planet].people.members.get(st.id) ?? []).slice();
}

/** adults (not children) of a settlement */
export function adultsOf(sim: Sim, st: Settlement, planet = 0): number[] {
  const A = sim.u.planets[planet].people.agents;
  return membersOf(sim, st, planet).filter((s) => !(A.flags[s] & 1));
}

/** recipe index by id */
export function recipe(sim: Sim, id: string): number {
  const k = ctx(sim).rt.byId.get(id);
  assert.ok(k !== undefined, `recipe ${id}`);
  return k!;
}

/** chronicle texts added since entry index `from` */
export function chronicleSince(sim: Sim, from: number): string[] {
  return sim.u.chronicle.slice(from).map((e) => e.text);
}
