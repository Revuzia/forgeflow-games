// GENESIS — shared set-up for the worlds-and-space tests: the 'twoworlds-late' system (Gaia's plains folk with a
// launchpad and the rocket chain, Rust's hive in its electric age) at a small grid, built once per test file and CLONED
// per case through save / load; stepping until something happens; finding things by id.
import assert from 'node:assert/strict';
import { Sim } from '../../src/sim/sim.ts';
import type { Command, CommandResult } from '../../src/sim/types.ts';
import type { Settlement } from '../../src/sim/people/state.ts';
import type { ShipState } from '../../src/sim/space/state.ts';
import { makeCtx, type PCtx } from '../../src/sim/people/ctx.ts';

export const DAY = 1440;

let cache: Uint8Array | null = null;

/** the late two-world system (n = 24): natural disasters off, flights reliable unless a test says otherwise */
export function late(): Sim {
  if (!cache) {
    const sim = new Sim({ seed: 1, scenario: 'twoworlds-late', overrides: { n: 24 } });
    must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
    cache = sim.save();
  }
  return Sim.load(cache);
}

export function must(sim: Sim, cmd: Command): CommandResult {
  const r = sim.applyNow(cmd);
  assert.ok(r.ok, `${cmd.k}: ${r.msg}`);
  return r;
}

/** the first standing town of a planet (by index in u.planets order of ids) */
export function town(sim: Sim, planet: number): Settlement {
  const p = sim.u.planet(planet)!;
  const st = p.people.settlements.find((s) => s.fallen < 0 && !s.band);
  assert.ok(st, `a town on ${p.name}`);
  return st!;
}

export function ctx(sim: Sim, planet: number): PCtx {
  return makeCtx(sim.u, sim.u.planet(planet)!);
}

/** step hour by hour until pred holds (returns the game days it took) or fail after maxDays */
export function until(sim: Sim, pred: () => boolean, maxDays: number, what: string): number {
  const t0 = sim.tick;
  while (!pred()) {
    if (sim.tick - t0 > maxDays * DAY) assert.fail(`${what}: not within ${maxDays} days (${shipsLine(sim)})`);
    sim.step(60);
  }
  return (sim.tick - t0) / DAY;
}

export function shipsLine(sim: Sim): string {
  return sim.u.space.ships.map((s) => `${s.id}:${s.kind}:${s.phase}:${s.outcome}`).join(' ') || 'no ships';
}

export function ship(sim: Sim, id: number): ShipState {
  const sh = sim.u.space.ship(id);
  assert.ok(sh, `ship ${id}`);
  return sh!;
}

/** chronicle texts since entry index `from` */
export function told(sim: Sim, from = 0): string[] {
  return sim.u.chronicle.slice(from).map((e) => e.text);
}
