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

// (punch P02) game is drawn to a town's edge in a land already holding MAX_LAND_HERDS herds, and only where its hunters can
// walk. Before: gameToPeople returned at once on a full land (every grown world held 138-166 wild land herds against 90),
// and it counted game across a lake as near (seed 2's lakeside town of 74 sent no party in 25 years). twoTowns: Lune has
// land on foot all round; Aru stands on an islet (no dry cell past 300 m on foot) with land across the water.
test('balance: in a full land a far herd of game moves to the edge of a town where its hunters walk, never across the water (postrel P02)', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const w = twoTowns();
  const x = makeCtx(w.sim.u, w.sim.u.planets[0]);
  const aru = x.ps.settlement(w.st.id)!, lune = x.ps.settlement(w.lune.id)!;
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
  const ac = spawnHerd(x, deer, across, 8);
  // the rest of the land full of game far from every people
  for (let c = 0; c < p.count && x.ps.herds.length < MAX_LAND_HERDS + 5; c += 2) {
    if (p.f.water[c] > 0.05 || p.s.ocean[c] || peopleM(x, c) < 5000) continue;
    spawnHerd(x, deer, c, 6);
  }
  const game = () => x.ps.herds.filter((h) => h.owner < 0 && landGame(animalDef(x, h.species)));
  const before = game().length;
  assert.ok(before >= MAX_LAND_HERDS, `the land is full (${before} herds of game)`);
  const walkable = (st: typeof aru) => game().filter((h) => isGame(x, st, h, false, false) && distM(p, cellPos(p, h.cell), st.pos) <= GAME_NEAR_M && onFoot(x, st, st.pos, h.cell));
  assert.equal(walkable(lune).length, 0, 'no game Lune can walk to at the start');
  const nearAru = () => game().filter((h) => h !== ac && distM(p, cellPos(p, h.cell), aru.pos) <= GAME_NEAR_M).length;
  assert.equal(nearAru(), 0);
  herdArrivals(x);
  assert.ok(walkable(lune).length >= 1, 'a herd of game stands within a kilometre of Lune, where its hunters walk');
  assert.ok(game().length <= before, `a full land: a far herd moved, none made (${before} -> ${game().length})`);
  assert.equal(nearAru(), 0, 'nothing is set down across the water from Aru (no cell there is on foot)');
  assert.equal(ac.cell, across, 'the herd across the water stays where it is');
});

// (punch P02, "hunting known at the start of stone-age scenarios") every stone-age people of the scenarios that hunts on
// foot knows hunting when the game begins: "Two worlds" had it (sim-punch P02); the Living system's coastal folk did not.
test('balance: every stone-age people of the scenarios that can hunt knows hunting at the start (postrel P02)', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { ERAS } = await import('../src/sim/content.ts');
  for (const scenario of ['twoworlds', 'system']) {
    const sim = new Sim({ seed: 1, scenario });
    let seen = 0;
    for (const p of sim.u.planets) {
      const x = makeCtx(sim.u, p);
      const k = x.rt.byId.get('hunting')!;
      for (const st of p.people.settlements) {
        const sp = x.c.species.list[st.species].id;
        if (st.fallen >= 0 || !['plains-folk', 'coastal-folk', 'cold-folk'].includes(sp) || ERAS[st.era] !== 'stone') continue;
        seen++;
        assert.ok(st.library.includes(k), `${scenario}: the ${sp} of ${st.name} know hunting`);
      }
    }
    assert.ok(seen >= 1, `${scenario}: a stone-age people`);
  }
});
