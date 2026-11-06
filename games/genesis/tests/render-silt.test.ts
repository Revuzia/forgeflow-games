// GENESIS — ARC §10: the river runs brown before a flood (render/planet/silt.ts → the water shader's silt zones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector4 } from 'three';
import { makeSiltState, SILT_MAX, siltTarget, updateSilt } from '../src/render/planet/silt.ts';
import type { DisasterView } from '../src/sim/types.ts';

const flood = (params: Record<string, number>, id = 7): DisasterView => ({ id, kind: 'flood', planet: 0, pos: [0, 0, 1], radius: 500, intensity: 1, progress: 0, frozen: false, params });
const slots = () => ({ out: Array.from({ length: SILT_MAX }, () => new Vector4()), k: new Array<number>(SILT_MAX).fill(0) });

test('a warned flood browns its river, deepening as it rises; other kinds never do', () => {
  assert.equal(siltTarget({ ...flood({}), kind: 'tsunami' }), 0);
  const early = siltTarget(flood({ warning: 1, rise: 0, silt: 1 }));
  const late = siltTarget(flood({ warning: 1, rise: 1, silt: 1 }));
  assert.ok(early > 0.3 && late > early && late <= 1, `${early} → ${late}`);
  assert.equal(siltTarget(flood({})), 1, 'the flood itself is brown water');
});

test('zones ease in, sit at the flood, and clear slowly after it ends', () => {
  const st = makeSiltState(), s = slots();
  updateSilt(st, [flood({ warning: 1, rise: 1, silt: 1 })], 3000, 0, s.out, s.k);
  assert.equal(s.k[0], 0, 'no jump on the first frame');
  for (let i = 0; i < 60; i++) updateSilt(st, [flood({ warning: 1, rise: 1, silt: 1 })], 3000, 0.25, s.out, s.k);
  assert.ok(s.k[0] > 0.9, `eased in (${s.k[0]})`);
  assert.deepEqual([s.out[0].x, s.out[0].y, s.out[0].z], [0, 0, 3000]);
  assert.ok(s.out[0].w >= 500, 'covers the flood\'s reach');
  assert.equal(s.out[1].w, 0, 'empty slots are marked');
  updateSilt(st, [], 3000, 2, s.out, s.k);
  assert.ok(s.k[0] > 0.5, 'the silt settles slowly');
  for (let i = 0; i < 200; i++) updateSilt(st, [], 3000, 1, s.out, s.k);
  assert.equal(s.out[0].w, 0, 'and is gone');
  assert.equal(st.zones.size, 0);
});

test('the water shader reads the zones (fixed-size arrays: no variant, nothing compiled late)', () => {
  const src = readFileSync(new URL('../src/render/planet/ocean.ts', import.meta.url), 'utf8');
  assert.match(src, new RegExp(`uniform vec4 uSilt\\[${SILT_MAX}\\]`));
  assert.match(src, new RegExp(`uniform float uSiltK\\[${SILT_MAX}\\]`));
  const pv = readFileSync(new URL('../src/render/planet/planetview.ts', import.meta.url), 'utf8');
  assert.ok(pv.indexOf('sharedRec.uSilt') < pv.indexOf('this.lod = new ChunkLOD'), 'uniforms exist before the water materials copy them');
});
