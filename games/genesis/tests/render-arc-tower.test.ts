// GENESIS — ARC §2.6 / §6.9: the tower drawn from TowerView (render/life/tower.ts) and skipped as a building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOWER_SETBACK, TOWER_TIER_M, towerBaseHalf, towerClearR, towerClearings, towerKey, towerLook, towerMesh, towerShape, towerYaw } from '../src/render/life/tower.ts';
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
  for (const col of [a, b, c]) { for (const x of col) assert.ok(x >= 0.29 && x <= 1); assert.ok(Math.max(...col) - Math.min(...col) >= 0.6); };
});

test('the site is cleared: no tree, shrub or ground cover on the base, the stair foot, the piles or the struck mound (owner #9)', () => {
  for (const goal of [24, 80, 120]) {
    const b0 = towerBaseHalf(goal);
    const struck = towerShape(towerLook(view({ goal, status: 'struck', height: 12, tiers: 6, ended: 0 }), 0, YEAR));
    const r = towerClearR(goal);
    assert.ok(r >= Math.SQRT2 * b0 + 4, 'past the base square\'s corners');
    assert.ok(r >= b0 + TOWER_TIER_M * 1.4, 'past the stair\'s foot');
    assert.ok(r >= struck.moundR * (1.18 + 0.1 * 1.03), 'past the struck mound\'s outer skirt (with its lobes)');
  }
  const c = towerClearings([view({ pos: [0, 3000, 0] }), view({ id: 4, pos: [3000, 0, 0] })]);
  assert.equal(c.at.length, 8);
  assert.deepEqual(c.at.slice(0, 3), [0, 1, 0]);
  // the signature changes when a tower is added, not when one rises or falls (no re-scatter of the forest)
  assert.equal(towerClearings([view({ height: 10 })]).sig, towerClearings([view({ height: 60, status: 'struck' })]).sig);
  assert.notEqual(towerClearings([view()]).sig, towerClearings([view(), view({ id: 9 })]).sig);
  const veg = readFileSync(new URL('../src/render/life/vegetation.ts', import.meta.url), 'utf8');
  assert.match(veg, /towerClearings\(pv\.towers\)/, 'trees and shrubs');
  const gc = readFileSync(new URL('../src/render/life/groundcover.ts', import.meta.url), 'utf8');
  assert.match(gc, /towerClearings\(pv\.towers\)/, 'ground cover');
  assert.match(gc, /inTowerSite\(dx, dy, dz, R\)/);
});

/** mean vertex colour of a mesh */
function meanCol(geo: { getAttribute(n: string): { array: ArrayLike<number>; count: number } }): [number, number, number] {
  const a = geo.getAttribute('color'), m: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < a.count; i++) for (let j = 0; j < 3; j++) m[j] += a.array[i * 3 + j] / a.count;
  return m;
}

test('a stone tower is warm stone in courses at every style, never blue-grey (owner #9)', () => {
  for (let style = 0; style < 8; style++) {
    const m = towerMesh(towerLook(view({ material: 'stone', style, status: 'finished', height: 60, goal: 60, tiers: 5 }), 0, YEAR));
    const c = meanCol(m.geo as never);
    assert.ok(c[0] > c[1] && c[1] > c[2], `style ${style}: warm (r > g > b): ${c.map((x) => x.toFixed(3))}`);
    assert.ok(c[0] - c[2] > 0.08, `style ${style}: not a grey: ${c.map((x) => x.toFixed(3))}`);
  }
  // coursed faces: many distinct shades on the walls, not one flat colour per tier
  const m = towerMesh(towerLook(view({ material: 'stone', style: 2, status: 'rising', height: 40 }), 0, YEAR));
  const a = (m.geo as never as { getAttribute(n: string): { array: ArrayLike<number>; count: number } }).getAttribute('color');
  const shades = new Set<number>();
  for (let i = 0; i < a.count; i++) shades.add(Math.round(a.array[i * 3] * 400));
  assert.ok(shades.size >= 20, `courses: ${shades.size} shades`);
});

test('the struck mound is a ragged, scorched heap of thrown blocks, not a neat ring (owner #9)', () => {
  const l = towerLook(view({ status: 'struck', height: 24, tiers: 6, ended: 0 }), 0, YEAR);
  const m = towerMesh(l);
  const geo = m.geo as never as { getAttribute(n: string): { array: ArrayLike<number>; count: number } };
  const p = geo.getAttribute('position'), col = geo.getAttribute('color');
  const s = towerShape(l), b0 = towerBaseHalf(l.goal);
  // the ground-level ring of the heap (y < 0.5, beyond the base): its radius varies by >= 15 % round the circle
  let rmin = 1e9, rmax = 0, dark = 0, n = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.array[i * 3], y = p.array[i * 3 + 1], z = p.array[i * 3 + 2];
    const r = Math.hypot(x, z);
    if (y < -1.4 && r > b0 * 1.2) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
    if (r > b0 * 1.05 && y > -0.5) { n++; if (col.array[i * 3] + col.array[i * 3 + 1] + col.array[i * 3 + 2] < 0.56) dark++; }
  }
  assert.ok(rmax / rmin > 1.3, `ragged outline ${rmin.toFixed(1)}..${rmax.toFixed(1)} (moundR ${s.moundR.toFixed(1)})`);
  assert.ok(dark / n > 0.3, `scorched: ${(100 * dark / n).toFixed(0)} % dark`);
  // every tier down: one heap closed over the middle (it read as a ring round an empty floor, a henge)
  const flat = towerMesh(towerLook(view({ status: 'struck', height: 0, tiers: 2, ended: 0 }), 0, YEAR));
  const fp = (flat.geo as never as { getAttribute(n: string): { array: ArrayLike<number>; count: number } }).getAttribute('position');
  let centre = 0;
  for (let i = 0; i < fp.count; i++) if (Math.hypot(fp.array[i * 3], fp.array[i * 3 + 2]) < 2 && fp.array[i * 3 + 1] > 3) centre++;
  assert.ok(centre > 0, 'a crown over the centre');
});

test('shaded walls take the sunlit ground\'s warm bounce, not the blue sky alone (owner #9: the tower read blue-grey)', () => {
  const src = readFileSync(new URL('../src/render/life/buildingmat.ts', import.meta.url), 'utf8');
  const amb = src.slice(src.indexOf('const FRAG_AMBIENT'));
  assert.match(amb, /iblIrradiance \+= eG \* vec3\(0\.17, 0\.13, 0\.085\)/);
  assert.match(amb, /0\.5 - 0\.5 \* dot\(nB, upB\)/, 'from the lower hemisphere only');
});
