// GENESIS — ARC §2.6 / §6.9 against the LIVE sim (not a stub): a league's real tower reaches the renderer through
// PlanetSnap.towers, the BuildingBlock's great-tower record is the one the building renderer skips (catalog id from the
// base pack), and a strike leaves a struck look with fallen tiers and a rubble mound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { distM, isLand } from '../src/sim/people/world.ts';
import { cellPos3 } from '../src/sim/god/util.ts';
import { buildingAt } from '../src/render/life/catalog.ts';
import { towerLook, towerShape } from '../src/render/life/tower.ts';
import type { PlanetSnap, TowerView } from '../src/sim/types.ts';

function league(): Sim {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  let best = -1;
  for (let c = 0; c < p.count; c++) {
    const d = distM(p, cellPos3(p, c), st.pos);
    if (d < 2500 || d > 4000 || !isLand(p, c) || p.f.water[c] > 0.05) continue;
    best = c; break;
  }
  assert.ok(best >= 0, 'a site for the kin town');
  const P = cellPos3(p, best);
  const l = Math.hypot(P[0], P[1], P[2]);
  must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true, pos: [P[0] / l, P[1] / l, P[2] / l] } as never);
  sim.step(60);
  must(sim, { k: 'tower.begin', settlement: st.id } as never);
  return sim;
}

const planet = (sim: Sim): PlanetSnap => (sim.snapshot() as unknown as { planets: PlanetSnap[] }).planets[0];
const YEAR = 1800 * 12;

test('a live tower: snapshot view -> rising look (scaffold, partial top); its building record is skipped as great-tower', () => {
  const sim = league();
  const day = makeCtx(sim.u, sim.u.planets[0]).day;
  sim.step(day * 6);
  const pl = planet(sim);
  const views: TowerView[] = pl.towers ?? [];
  assert.equal(views.length, 1);
  const v = views[0];
  assert.equal(v.status, 'rising');
  assert.ok(v.height > 0, `height ${v.height}`);
  const s = towerShape(towerLook(v, 0, YEAR));
  assert.ok(s.scaffold && s.piles && !s.fire);
  assert.ok(s.halves.length >= 1 && s.top <= v.height + 1e-9);
  const b = pl.buildings!;
  const ids: string[] = [];
  for (let i = 0; i < b.count; i++) ids.push(buildingAt(b.type[i]).id);
  assert.ok(ids.includes('great-tower'), 'the BuildingBlock carries the great-tower record the renderer skips');

  // strike: the struck look keeps the fallen tiers as a rubble mound
  sim.step(day * 20);
  must(sim, { k: 'tower.strike' } as never);
  const sv = planet(sim).towers!.find((t) => t.id === v.id)!;
  assert.equal(sv.status, 'struck');
  const ss = towerShape(towerLook(sv, sim.u.tick ?? 0, YEAR));
  assert.ok(ss.scorched && ss.crumbled && ss.moundR > 0 && ss.moundH > 0, 'rubble mound, scorched');
  assert.ok(!ss.scaffold && !ss.fire);
});
