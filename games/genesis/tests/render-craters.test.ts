// GENESIS — Cinder's craters come in a real size distribution (punch P19, release minor 5). The sim stamps craters no
// smaller than 1.3 grid edges (src/sim/world/planet.ts craterAt), so on a 3 km barren world every small crater was the same
// ~70 m ring. The terrain shader fills in below that floor with hash-placed sub-grid craters (craterField): tiers whose
// largest crater meets the sim's floor and whose smallest are a few metres, ~8x more craters per tier a third the size
// (N(>r) ~ r^-2, as on the Moon), on airless ground only, shaded by an analytic gradient and with fresh bright haloes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IcoGrid } from '../src/sim/grid/icogrid.ts';

const TM = readFileSync(new URL('../src/render/planet/terrainmat.ts', import.meta.url), 'utf8');
const kinds = JSON.parse(readFileSync(new URL('../src/data/planetkinds.json', import.meta.url), 'utf8'));

test('sub-grid craters span from the sim\'s crater floor down to a few metres, in a power law (P19)', () => {
  const fn = /float craterField\(vec3 P, vec3 up, float fw, float dens, inout vec3 g\) \{([\s\S]*?)\n\}/.exec(TM);
  assert.ok(fn, 'terrainmat has a sub-grid crater field');
  const body = fn![1];
  const tiers = /float s = ([\s\S]*?);/.exec(body)![1].match(/\d+(?:\.\d+)?/g)!.map(Number).filter((v) => v > 4);
  assert.ok(tiers.length >= 3, `at least three size tiers (${tiers})`);
  const k = Number(/float rMax = (\d*\.\d+) \* s;/.exec(body)![1]);
  // the 8 cells round P must hold every crater that reaches it: the apron (1.8 rs) stays within half a cell
  assert.ok(k * 1.8 <= 0.5 + 1e-9, 'every crater reaching P lies in the 2x2x2 window');
  const barren = (kinds.kinds ?? kinds).find((x: { id: string }) => x.id === 'barren');
  const floorM = 1.3 * new IcoGrid(barren.n).meanEdgeAngle * barren.radius;
  const big = Math.max(...tiers) * k, small = Math.min(...tiers) * k;
  assert.ok(big >= 0.8 * floorM, `the largest sub-grid craters (${big.toFixed(0)} m) meet the sim's floor (${floorM.toFixed(0)} m)`);
  assert.ok(small <= 5, `the smallest tier reaches a few metres (${small.toFixed(1)} m)`);
  // a power law: each tier ~3x smaller with the same fill per cell -> ~(3^2) more craters per area
  const s = [...tiers].sort((a, b) => b - a);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1] / s[i] >= 2 && s[i - 1] / s[i] <= 4, `tier step ${s[i - 1]}/${s[i]}`);
  assert.match(body, /fresh/, 'the young ones are bright');
  assert.match(body, /g \+=/, 'shaded by an analytic gradient');
  // applied on airless ground, into the albedo and the shading gradient
  const call = TM.indexOf('craterField(P, up, fw,');
  assert.ok(call > 0 && /if \(airless\) \{[\s\S]{0,400}$/.test(TM.slice(0, call)), 'applied on airless worlds only');
  assert.match(TM.slice(call - 200, call + 200), /s\.microG \+= cg/, 'into the shading gradient');
});
