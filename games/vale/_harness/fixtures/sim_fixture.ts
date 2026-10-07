// Probe helpers for lane SIM: worlds from the synthetic catalog, stepping, PASS/FAIL reporting.

import type { CatalogT } from '../../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../../src/contracts/sim.ts';
import { TICK_HZ } from '../../src/contracts/sim.ts';
import { createWorld } from '../../src/sim/core.ts';
import type { Entity } from '../../src/sim/entity.ts';
import { spawnUnit } from '../../src/sim/spawn.ts';
import type { World } from '../../src/sim/world.ts';

export interface SeatSpec { fighter: string; team: number; x?: number; y?: number; spells?: string[]; boons?: string[]; name?: string }

export function makeSetup(seats: SeatSpec[], o: { seed?: number; queue?: string; practice?: MatchSetup['practice'] } = {}): MatchSetup {
  return {
    matchId: 'fx_match', seed: o.seed ?? 12345, queue: o.queue ?? 'fx_queue', mode: 'fx_mode', map: 'fx_map',
    catalogVersion: '2026.10.0', practice: o.practice,
    seats: seats.map((s, i): SeatSetup => ({
      player: i, team: s.team, name: s.name ?? `P${i}`, fighter: s.fighter, skin: `${s.fighter}_skin`,
      loadout: { spells: s.spells ?? ['fx_spell_blink', 'fx_spell_heal'], boons: s.boons ?? [] },
      controller: 'bot', colorIndex: i,
    })),
  };
}

/** world with core systems; fighters spawned and moved to the requested positions */
export function makeWorld(catalog: CatalogT, seats: SeatSpec[], o: { seed?: number; queue?: string; practice?: MatchSetup['practice'] } = {}): World {
  const w = createWorld(catalog, makeSetup(seats, o));
  seats.forEach((s, i) => {
    const e = w.players[i].ent!;
    if (s.x !== undefined && s.y !== undefined) { e.x = s.x; e.y = s.y; }
    e.autoAttack = false; // probes opt in explicitly
  });
  w.hashDirty = true;
  w.vision.update(w.entities, w.tick);
  return w;
}

export function fighterEnt(w: World, player: number): Entity { return w.players[player].ent!; }

export function addUnit(w: World, unitId: string, team: number, x: number, y: number): Entity {
  const u = spawnUnit(w, unitId, team, x, y);
  u.autoAttack = false;
  w.vision.update(w.entities, w.tick);
  return u;
}

/** step n ticks, returning all events */
export function stepN(w: World, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) for (const ev of w.step()) all.push(ev);
  return all;
}
export function stepSec(w: World, s: number): SimEvent[] { return stepN(w, Math.round(s * TICK_HZ)); }

export function ofType<K extends SimEvent['e']>(evs: SimEvent[], k: K): Extract<SimEvent, { e: K }>[] {
  return evs.filter((e): e is Extract<SimEvent, { e: K }> => e.e === k);
}

// ── reporting ───────────────────────────────────────────────────────────────────────────────────
let failures = 0;
let passes = 0;
export function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) { passes++; console.log(`PASS ${name}`); }
  else { failures++; console.log(`FAIL ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
export function near(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) <= eps; }
/** run a named section; an exception counts as a FAIL instead of aborting the probe */
export function section(name: string, fn: () => void): void {
  try { fn(); } catch (err) { failures++; console.log(`FAIL ${name} threw: ${(err as Error).stack ?? err}`); }
}
export function finish(probe: string): void {
  console.log(`${probe}: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}
