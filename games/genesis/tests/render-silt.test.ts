// GENESIS — ARC §10: the river runs brown before a flood (render/planet/silt.ts → the water shader's silt zones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector4 } from 'three';
import { makeSiltState, SILT_MAX, siltLensClear, siltTarget, updateSilt } from '../src/render/planet/silt.ts';
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
  updateSilt(st, [flood({ warning: 1, rise: 0, silt: 1 })], 3000, 0, s.out, s.k);
  assert.equal(s.k[0], 0, 'no jump on the first frame of a warning seen from its start');
  // (arriving late — a load, a held shot — the river is already as brown as its rise says)
  const late = makeSiltState(), sl = slots();
  updateSilt(late, [flood({ warning: 1, rise: 0.33, silt: 1 }, 9)], 3000, 0, sl.out, sl.k);
  assert.ok(Math.abs(sl.k[0] - siltTarget(flood({ warning: 1, rise: 0.33, silt: 1 }))) < 1e-6, `late start ${sl.k[0]}`);
  for (let i = 0; i < 60; i++) updateSilt(st, [flood({ warning: 1, rise: 1, silt: 1 })], 3000, 0.25, s.out, s.k);
  assert.ok(s.k[0] > 0.9, `eased in (${s.k[0]})`);
  assert.deepEqual([s.out[0].x, s.out[0].y, s.out[0].z], [0, 0, 3000]);
  assert.ok(s.out[0].w >= 500, 'covers the flood\'s reach');
  // (owner #10, live r1i: a natural flood of 380 m; the town's own water ~500 m off its centre must be in the full-brown
  // core, which the shaders hold to 0.55 w)
  const nat = makeSiltState(), sn = slots();
  updateSilt(nat, [{ ...flood({ warning: 1, rise: 0.33, silt: 1 }, 4), radius: 380 }], 3000, 0, sn.out, sn.k);
  assert.ok(sn.out[0].w * 0.55 >= 500, `the town's water inside the full-brown core (w ${sn.out[0].w})`);
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

test('the banks read the same zones: the rising river wets and silts them above the old waterline (§10.3 "higher")', () => {
  const src = readFileSync(new URL('../src/render/planet/terrainmat.ts', import.meta.url), 'utf8');
  assert.match(src, new RegExp(`uniform vec4 uSilt\\[${SILT_MAX}\\]`));
  assert.match(src, new RegExp(`uniform float uSiltK\\[${SILT_MAX}\\]`));
  assert.match(src, /wLo = min\(wLo, -siltG/, 'the wet band climbs with the silt');
  // (looked at, stint 3: the pale shallows ARE the bank seen at play distance; they go under a brown film)
  assert.match(src, /floorC = mix\(floorC, [^;]*siltG/, 'the risen river covers its pale shallows');
  const oc = readFileSync(new URL('../src/render/planet/ocean.ts', import.meta.url), 'utf8');
  assert.match(oc, /cap = .*\(1\.0 \+ 2\.0 \* silt\)/, 'the in-scatter cap lifts for muddy water');
});

test('a silted river stays WATER: the body browns ~70 % but the sky reflection, glints and ripples stay on top (owner #10)', () => {
  const oc = readFileSync(new URL('../src/render/planet/ocean.ts', import.meta.url), 'utf8');
  const i = oc.indexOf('under = mix(under, mud, 0.72 * silt)');
  const j = oc.indexOf('vec3 col = mix(under, skyR, F) + glint;');
  assert.ok(i > 0 && j > i, 'the mud goes into the body before the Fresnel sky and the glints are added');
  assert.doesNotMatch(oc, /col = mix\(col, lumC/, 'no matte recolour of the final colour (it killed the sheen)');
  assert.match(oc.slice(i - 900, i), /vFlow/, 'silt streaks drawn out along the current');
});

test('the god\'s eye clears the deck over a warned river from the town view, not elsewhere or from high up (owner #10)', () => {
  const R = 300000;
  const zones = Array.from({ length: SILT_MAX }, () => new Vector4());
  const k = new Array<number>(SILT_MAX).fill(0);
  zones[0].set(0, 0, R, 1200); k[0] = 0.8;
  const at = (alt: number, off = 0): number[] => { const a = off / R; return [Math.sin(a) * (R + alt), 0, Math.cos(a) * (R + alt)]; };
  const town = siltLensClear(at(520), 520, zones, k);
  assert.ok(town.k > 0.95 && town.r >= 1.8 * 520 && town.r <= 2000, JSON.stringify(town));
  const z2 = zones.map((v) => v.clone()); z2[0].w = 608;
  const off = siltLensClear(at(382, 980), 382, z2, k);
  assert.ok(off.k > 0.5, `the live town view: camera ground point ~1 km off the zone centre (${JSON.stringify(off)})`);
  assert.equal(siltLensClear(at(520, 6000), 520, zones, k).k, 0, 'far from the warned river: the weather as it is');
  assert.equal(siltLensClear(at(3000), 3000, zones, k).k, 0, 'a regional view keeps the deck');
  k[0] = 0;
  assert.equal(siltLensClear(at(520), 520, zones, k).k, 0, 'no warning: no clearing');
  const cl = readFileSync(new URL('../src/render/sky/clouds.ts', import.meta.url), 'utf8');
  assert.match(cl, /uniform vec2 uLensClear/);
  assert.match(cl, /dens \*= 1\.0 - uLensClear\.y \*/);
  // (the screen haze too: the live warning shot stayed a blue-grey wall with the deck cleared — the rain painted at
  // intensity 3 laid 3x its fog)
  const wf = readFileSync(new URL('../src/render/fx/weatherfx.ts', import.meta.url), 'utf8');
  assert.match(wf, /fog = Math\.max\(fog, d\.fog \* Math\.min\(1, w\)\)/, 'a system\'s fog is capped at its intensity-1 strength');
  assert.match(wf, /\* \(1 - 0\.85 \* \(ctx\.lensClear \?\? 0\)\)/, 'the murk clears under the lens');
  const gf = readFileSync(new URL('../src/render/fx/godfx.ts', import.meta.url), 'utf8');
  assert.match(gf, /ctx\.lensClear = vis\.uniforms\.uSilt \? siltLensClear\(/);
});
