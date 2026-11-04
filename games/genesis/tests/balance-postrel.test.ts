// GENESIS — post-release balance fixes (release item 4: punch P02 / P11 / P25 / P26). Each test failed on the tree
// before its fix; the 8-seed measurements are in _harness/scratch/postrel/balance.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PCtx } from '../src/sim/people/ctx.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { distM, cellPos } from '../src/sim/people/world.ts';
import { spawnHerd, reindexHerds, herdArrivals, animalDef, landGame, MAX_LAND_HERDS, GAME_NEAR_M } from '../src/sim/life/herds.ts';
import { isGame, onFoot, wetBetween } from '../src/sim/people/hunt.ts';

/** metres from cell c to the nearest standing settlement */
function peopleM(x: PCtx, c: number): number {
  let d = Infinity;
  for (const st of x.ps.settlements) if (st.fallen < 0) d = Math.min(d, distM(x.p, cellPos(x.p, c), st.pos));
  return d;
}

// (punch P02) a town whose only game near lies across the water, in a land already holding MAX_LAND_HERDS herds: game is
// drawn to its own shore. Before: gameToPeople returned at once on a full land (every grown world held 138-166 wild land
// herds against 90) and counted game across a lake as near (seed 2's lakeside town of 74 sent no party in 25 years).
test('balance: a town with game only across the water, in a full land, gets game it can walk to (postrel P02)', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const w = twoTowns();
  const x = makeCtx(w.sim.u, w.sim.u.planets[0]);
  const aru = x.ps.settlement(w.st.id)!;
  const p = x.p;
  x.ps.herds = x.ps.herds.filter((h) => h.owner >= 0);
  reindexHerds(x);
  x.ps.eco.immigration = true;
  const deer = x.c.animals.idx('deer');
  // game across the water within GAME_NEAR_M of Aru (the only game near it)
  let across = -1;
  for (let c = 0; c < p.count && across < 0; c++) {
    if (p.f.water[c] > 0.05 || p.s.ocean[c]) continue;
    const d = distM(p, cellPos(p, c), aru.pos);
    if (d >= 400 && d <= GAME_NEAR_M - 100 && wetBetween(x, aru.pos, cellPos(p, c)) && !onFoot(x, aru, aru.pos, c)) across = c;
  }
  assert.ok(across >= 0, 'land across the water within a kilometre of Aru');
  spawnHerd(x, deer, across, 8);
  // the rest of the land full of game far from every people
  for (let c = 0, n = 0; c < p.count && x.ps.herds.length < MAX_LAND_HERDS + 5; c += 2) {
    if (p.f.water[c] > 0.05 || p.s.ocean[c] || peopleM(x, c) < 5000) continue;
    spawnHerd(x, deer, c, 6); n++;
  }
  const game = () => x.ps.herds.filter((h) => h.owner < 0 && landGame(animalDef(x, h.species)));
  const before = game().length;
  assert.ok(before >= MAX_LAND_HERDS, `the land is full (${before} herds of game)`);
  const walkable = () => game().filter((h) => isGame(x, aru, h, false, false) && distM(p, cellPos(p, h.cell), aru.pos) <= GAME_NEAR_M && onFoot(x, aru, aru.pos, h.cell));
  assert.equal(walkable().length, 0, 'no game Aru can walk to at the start');
  herdArrivals(x);
  const got = walkable();
  assert.ok(got.length >= 1, 'a herd of game stands within a kilometre of Aru, on its own side of the water');
  assert.ok(game().length <= before, `a full land: a far herd moved, none made (${before} -> ${game().length})`);
});
