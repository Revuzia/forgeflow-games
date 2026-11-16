// orch1 controls r4 VERIFIER: mid-windup re-press (new press, not held) at a point that no longer means the windup's target
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, fighterEnt, makeWorld } from './fixtures/sim_fixture.ts';
import { computeStats } from '../src/sim/stats.ts';
const cat = buildCatalog({ fighters: [
  fighter('r4_blade', { base: { ad: 40, attackSpeed: 1.0, moveSpeed: 3.3 }, attack: { range: 1.8, windup: 0.3 } }),
  fighter('r4_archer', { base: { ad: 40, attackSpeed: 1.0, moveSpeed: 3.3 }, attack: { range: 6, windup: 0.3, projectileSpeed: 15 } }),
  fighter('r4_target', { base: { ad: 0, attackSpeed: 0.1, moveSpeed: 0, hp: 50000 }, attack: { range: 1.5, windup: 0.3 } }) ] });
for (const who of ['r4_blade', 'r4_archer']) for (const z of [false, true]) for (const first of ['attackAt', 'attack']) {
  const w = makeWorld(cat, [{ fighter: who, team: 0, x: 10, y: 20 }, { fighter: 'r4_target', team: 1, x: 40, y: 50 }]);
  const h = fighterEnt(w, 0); computeStats(w, h);
  const wick = addUnit(w, 'fx_dummy', 1, 11.8, 20);
  w.command(0, first === 'attackAt' ? { type: 'attackAt', x: 11.8, y: 20, target: wick.id } : { type: 'attack', target: wick.id } as never);
  w.step(); w.step();
  const wu = h.atkWindup;
  w.command(0, { type: 'attackAt', x: 10, y: 14, ...(z ? { fighters: true } : {}) });   // straight away from the Wick (90 deg+)
  let hits = 0; for (let k = 0; k < 40; k++) for (const e of w.step()) if (e.e === 'damage' && e.src === h.id && e.dst === wick.id) hits++;
  console.log(`${who} first=${first} newPress z=${z}: windup at re-press ${wu.toFixed(3)} -> Wick hits ${hits}`);
}
// cadence: a plain attack order vs attackAt held, AS 1.0
for (const kind of ['attack', 'attackAt']) {
  const w = makeWorld(cat, [{ fighter: 'r4_blade', team: 0, x: 10, y: 20 }, { fighter: 'r4_target', team: 1, x: 40, y: 50 }]);
  const h = fighterEnt(w, 0); computeStats(w, h); const wick = addUnit(w, 'fx_dummy', 1, 11.8, 20);
  const ts: number[] = [];
  for (let k = 0; k < 300; k++) { if (kind === 'attack') { if (k === 0) w.command(0, { type: 'attack', target: wick.id } as never); } else w.command(0, { type: 'attackAt', x: 11.8, y: 20, target: wick.id, ...(k ? { held: true } : {}) });
    for (const e of w.step()) if (e.e === 'attack' && e.src === h.id) ts.push(Math.round(e.t * 30)); }
  console.log(kind, 'attack ticks gaps', ts.slice(1).map((t, i) => t - ts[i]).join(','));
}
