// GENESIS — what the Touch holds and hurls reads on screen (render/fx/present.ts; the art review: "a thrown rock in
// flight could not be captured", a 2.6 t boulder was ~5 px inside a 19 m hand). Pure arithmetic: no WebGL.
//   * a flight is never drawn under FLIGHT_MIN_PX at god-camera distances, for the whole flight but its last moment
//   * held and released things are drawn at least HELD_SHARE of the Touch, and land at their true size
//   * the Touch's size follows the camera distance within its bounds (from orbit it is not a weather system)
//   * every sigil of LIVING §3.6 has a stroke, evenly sampled

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLIGHT_MIN_PX, HELD_SHARE, TOUCH_MAX, TOUCH_MIN, flightDrawSize, flightTime, pixelSize, presentScale, touchSize,
} from '../src/render/fx/present.ts';
import { SIGIL_IDS, SIGIL_OF_MIRACLE, sigilStroke } from '../src/render/fx/sigils.ts';

test('a hurled boulder stays readable on screen through its flight at god-camera distances', () => {
  const H = 540, fov = 55;
  // a 2.6 t boulder is ~1.2 m across; from a street to the god's height and beyond
  for (const dist of [40, 120, 260, 600, 1500, 3000]) {
    const touch = touchSize(dist);
    for (let p = 0; p <= 0.92; p += 0.02) {
      const s = flightDrawSize(1.24, touch, p, dist, H, fov);
      const px = pixelSize(s, dist, H, fov);
      assert.ok(px >= FLIGHT_MIN_PX - 1e-6, `at ${dist} m, progress ${p.toFixed(2)}: ${px.toFixed(1)} px`);
    }
  }
});

test('held things are drawn in proportion to the Touch, and land at their true size', () => {
  for (const touch of [3.2, 10, 36, 220]) {
    const held = presentScale(1.24, touch, -1);
    assert.ok(held >= HELD_SHARE * touch - 1e-9 && held >= 1.24);
    // at release (progress 0) the same as held: no pop when the Touch lets go
    assert.equal(presentScale(1.24, touch, 0), held);
    // eases over the last third, true size at the end
    assert.equal(presentScale(1.24, touch, 0.6), held);
    assert.ok(Math.abs(presentScale(1.24, touch, 1) - 1.24) < 1e-9);
    const mid = presentScale(1.24, touch, 0.83);
    assert.ok(mid <= held && mid >= 1.24);
  }
  // the very end of a flight is its true size even far away (the crater must match the sim)
  assert.ok(Math.abs(flightDrawSize(1.24, 36, 1, 260, 540, 55) - 1.24) < 1e-9);
});

test("the Touch's size follows the camera within its bounds", () => {
  assert.equal(touchSize(1), TOUCH_MIN);
  assert.equal(touchSize(1e6), TOUCH_MAX);
  let last = 0;
  for (const d of [5, 20, 80, 260, 900, 2000]) { const s = touchSize(d); assert.ok(s >= last); last = s; }
  // from orbit (9 km) it is a few hundred metres at most on a 3 km world
  assert.ok(touchSize(9000) <= 150);
});

test('a ballistic flight time estimate', () => {
  // straight up at 20 m/s from the ground under 9.8: 4.08 s
  assert.ok(Math.abs(flightTime(20, 0, 9.8) - 40 / 9.8) < 1e-9);
  // dropped from 20 m: sqrt(2h/g)
  assert.ok(Math.abs(flightTime(0, 20, 9.8) - Math.sqrt(40 / 9.8)) < 1e-9);
});

test('every sigil has an even stroke, and every miracle a sigil', () => {
  for (const id of SIGIL_IDS) {
    const s = sigilStroke(id, 64);
    assert.equal(s.length, 128);
    let total = 0, maxSeg = 0;
    for (let i = 1; i < 64; i++) {
      const d = Math.hypot(s[i * 2] - s[i * 2 - 2], s[i * 2 + 1] - s[i * 2 - 1]);
      total += d; maxSeg = Math.max(maxSeg, d);
      assert.ok(Math.abs(s[i * 2]) <= 1.2 && Math.abs(s[i * 2 + 1]) <= 1.2, `${id} stays in its box`);
    }
    // equal arc length per sample (within the Catmull–Rom's own unevenness)
    assert.ok(maxSeg < (total / 63) * 1.6, `${id}: segments even`);
  }
  for (const k of Object.keys(SIGIL_OF_MIRACLE)) assert.ok(SIGIL_IDS.includes(SIGIL_OF_MIRACLE[k]), k);
  // an unknown sigil draws the spiral, never nothing
  assert.equal(sigilStroke('no-such-sigil', 32).length, 64);
});
