// GENESIS — ARC §2.6 / §6.9: the tower drawn from TowerView (render/life/tower.ts) and skipped as a building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOWER_SETBACK, TOWER_TIER_M, towerKey, towerLook, towerMesh, towerShape, towerYaw } from '../src/render/life/tower.ts';
import type { TowerView } from '../src/sim/types.ts';

function view(o: Partial<TowerView> = {}): TowerView {
  return {
    id: 3, pos: [0, 0, 1], cell: 10, name: 'the Tower of Kel-Amar', host: 1, league: [1, 2, 3], height: 38, goal: 80,
    tiers: 4, material: 'mudbrick', style: 2, status: 'rising', builders: 9, begun: 0, ended: -1, answer: 'none',
    choiceOpen: false, canAnswer: ['confuse', 'strike', 'warn', 'let'], ...o,
  };
}
const YEAR = 1800 * 12;

test('tiers of 12 m, each set back x 0.82, a partial top while rising', () => {
  const s = towerShape(towerLook(view({ height: 38 }), 0, YEAR));
  assert.deepEqual(s.rises, [12, 12, 12, 2]);
  for (let i = 1; i < s.halves.length; i++) {
    if (s.rises[i - 1] === TOWER_TIER_M) assert.ok(Math.abs(s.halves[i] / s.halves[i - 1] - TOWER_SETBACK) < 1e-9);
  }
  assert.equal(s.top, 38);
  assert.ok(s.scaffold && s.piles && !s.fire && !s.crumbled);
});

test('each status draws its own stage', () => {
  const fin = towerShape(towerLook(view({ status: 'finished', height: 80 }), 0, YEAR));
  assert.ok(fin.fire && !fin.scaffold && !fin.crumbled);
  const st = towerShape(towerLook(view({ status: 'struck', height: 24, tiers: 7, ended: 100 }), 200, YEAR));
  assert.ok(st.scorched && st.crumbled && st.moundR > 0 && st.moundH > 0 && !st.scaffold);
  for (const status of ['scattered', 'abandoned'] as const) {
    const s = towerShape(towerLook(view({ status, ended: 0 }), 0, YEAR));
    assert.ok(s.crumbled && !s.scaffold && !s.fire && s.moundR === 0);
  }
});

test('weathering grows with the years since it ended; a rising tower does not weather', () => {
  const w = (y: number) => towerLook(view({ status: 'abandoned', ended: 0 }), y * YEAR, YEAR).weather;
  assert.deepEqual([w(0), w(2), w(10), w(40)], [0, 1, 2, 3]);
  assert.equal(towerLook(view(), 40 * YEAR, YEAR).weather, 0);
});

test('one mesh, the same geometry for the same look (deterministic), rebuilt per metre of height only', () => {
  const a = towerMesh(towerLook(view(), 0, YEAR)), b = towerMesh(towerLook(view(), 0, YEAR));
  const pa = a.geo.getAttribute('position').array, pb = b.geo.getAttribute('position').array;
  assert.equal(pa.length, pb.length);
  for (let i = 0; i < pa.length; i++) assert.equal(pa[i], pb[i]);
  assert.equal(towerKey(towerLook(view({ height: 38.2 }), 0, YEAR)), towerKey(towerLook(view({ height: 38.9 }), 0, YEAR)));
  assert.notEqual(towerKey(towerLook(view({ height: 38 }), 0, YEAR)), towerKey(towerLook(view({ height: 39 }), 0, YEAR)));
  assert.ok(a.height >= 38 && a.emitters.some((e) => e.kind === 0), 'dust off the work');
  const fin = towerMesh(towerLook(view({ status: 'finished', height: 80 }), 0, YEAR));
  assert.ok(fin.emitters.some((e) => e.kind === 5), 'the summit fire');
  // a 10-tier tower stays a modest mesh (one draw in the building batch)
  const big = towerMesh(towerLook(view({ status: 'rising', height: 119, goal: 120 }), 0, YEAR));
  assert.ok(big.geo.getAttribute('position').count < 40000, `${big.geo.getAttribute('position').count} verts`);
});

test('its stair faces the host town', () => {
  // tower on +Z, host a little north (toward +Y on the sphere): the stair yaw points north (0)
  const yaw = towerYaw(view({ pos: [0, 0, 1] }), [0, 0.01, 1]);
  assert.ok(Math.abs(yaw) < 1e-6, String(yaw));
  const east = towerYaw(view({ pos: [0, 0, 1] }), [0.01, 0, 1]);
  assert.ok(Math.abs(Math.abs(east) - Math.PI / 2) < 1e-6, String(east));
});

test('the BuildingBlock renderer skips great-tower and draws towers from PlanetSnap.towers (no quality knob)', () => {
  const src = readFileSync(new URL('../src/render/life/buildings.ts', import.meta.url), 'utf8');
  assert.match(src, /look\.id === 'great-tower'\) continue/);
  assert.match(src, /pv\.towers/);
  const t = readFileSync(new URL('../src/render/life/tower.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /from '\.\.\/quality|particleBudget|Math\.random/);
});

test('confused towns ease into their new style house by house (only a style change staggers)', async () => {
  const { sameButStyle } = await import('../src/render/life/buildings.ts');
  assert.equal(sameButStyle('3|1|2|4|0|0.1|0.2|0.3|0.000|1.00', '3|1|5|4|0|0.1|0.2|0.3|0.000|1.00'), true);
  assert.equal(sameButStyle('3|1|2|4|0|0.1|0.2|0.3|0.000|1.00', '3|1|2|4|0|0.1|0.2|0.3|0.000|1.00'), false);
  assert.equal(sameButStyle('3|1|2|4|0|0.1|0.2|0.3|0.000|1.00', '3|2|5|4|0|0.1|0.2|0.3|0.000|1.00'), false);
});

test('the confusion ring: 8 km, its light running round the colour wheel, soft (never saturated)', async () => {
  const { CONFUSE_RING_M, confuseHue } = await import('../src/render/signs/signs.ts');
  assert.equal(CONFUSE_RING_M, 8000);
  const a = confuseHue(0, 0), b = confuseHue(3, 0), c = confuseHue(0, 1);
  assert.notDeepEqual(a, b); assert.notDeepEqual(a, c);
  for (const col of [a, b, c]) for (const x of col) assert.ok(x >= 0.44 && x <= 1);
});
