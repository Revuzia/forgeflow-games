// punch P24: the opening's camera hold kept the lit face toward the eye while the ring marked a spot on the morning side
// (src/ui/opening.ts findSpot), up to ~100° away — at 1920×1080 the ring sat below the view. spotHold bounds the hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringWanted, spotHold } from '../src/ui/opening.ts';

type V = [number, number, number];
const norm = (v: V): V => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r: number) => (r * 180) / Math.PI;
/** the angle off the view's axis at which a ground point is seen from `dist` above the focus, looking down */
function viewAngle(focus: V, p: V, distOverR: number): number {
  const D = 1 + distOverR, c = dot(p, focus);
  const side = Math.hypot(p[0] - c * focus[0], p[1] - c * focus[1], p[2] - c * focus[2]);
  return Math.atan2(side, D - c);
}
/** app.ts afternoonLon + the hold's lat 14°: the lit face the hold eases toward */
function litTarget(sun: V, east = 32, latDeg = 14): V {
  const lon = Math.atan2(sun[0], sun[2]) + (east * Math.PI) / 180, lat = (latDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}
/** a deterministic spread of points on the sphere */
function* sphere(n: number): Generator<V> {
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y); yield [Math.cos(g * i) * r, y, Math.sin(g * i) * r]; }
}
/** findSpot's mask: the sun well up, and west of (or near) the sun's meridian */
const morning = (p: V, sun: V) => dot(p, sun) > 0.25 && p[0] * sun[2] - p[2] * sun[0] < 0.15;
const KEEP = 0.55 * ((21 * Math.PI) / 180);

test('the lit-face hold alone loses morning-side spots behind the limb (the bug)', () => {
  let lost = 0, n = 0;
  const limb = Math.acos(1 / 3.7);
  for (const sun of [norm([1, 0.2, 0.3]), norm([-0.4, -0.3, 1]), norm([0.2, 0.9, -0.3])]) {
    const lit = litTarget(sun);
    for (const p of sphere(2000)) { if (!morning(p, sun)) continue; n++; if (Math.acos(dot(lit, p)) > limb) lost++; }
  }
  assert.ok(n > 500 && lost > 0, `spots ${n}, lost ${lost}`);
});

test('spotHold keeps every morning-side spot within the middle of the view', () => {
  for (const dist of [1.25, 1.7, 2.7, 3.5, 6]) {
    let n = 0;
    for (const sun of [norm([1, 0.2, 0.3]), norm([-0.4, -0.3, 1]), norm([0.2, 0.9, -0.3]), norm([0, -1, 0.1])]) {
      const lit = litTarget(sun);
      for (const p of sphere(1500)) {
        if (!morning(p, sun)) continue;
        n++;
        const f = spotHold(lit, p, dist, KEEP);
        assert.ok(Math.abs(Math.hypot(...f) - 1) < 1e-9, 'unit focus');
        const va = viewAngle(f, p, dist);
        assert.ok(va <= KEEP + 1e-6, `dist ${dist}R: spot ${deg(va).toFixed(1)}° off the axis (keep ${deg(KEEP).toFixed(1)}°)`);
      }
    }
    assert.ok(n > 300);
  }
});

test('spotHold rests on the lit face when the spot is already near the middle, and moves no further than it must', () => {
  const sun = norm([0.3, 0.1, 1]);
  const lit = litTarget(sun);
  // a spot 5° from the lit face: the hold is the lit face itself
  const near = norm([lit[0] + 0.087 * lit[2], lit[1], lit[2] - 0.087 * lit[0]]);
  assert.deepEqual(spotHold(lit, near, 2.7, KEEP).map((x) => +x.toFixed(9)), lit.map((x) => +x.toFixed(9)));
  // no spot: the lit face
  assert.deepEqual(spotHold(lit, null, 2.7, KEEP), norm(lit));
  // a far spot: the focus lies on the great circle between them, exactly at the bound from the spot
  const far = norm([-lit[2], 0.2, lit[0]]);
  const f = spotHold(lit, far, 2.7, KEEP);
  const D = 3.7, bound = Math.asin(D * Math.sin(KEEP)) - KEEP;
  assert.ok(Math.abs(Math.acos(dot(f, far)) - bound) < 1e-6, 'at the bound');
  assert.ok(Math.abs(Math.acos(dot(f, far)) + Math.acos(dot(f, lit)) - Math.acos(dot(far, lit))) < 1e-6, 'on the great circle');
  // the lit face straight behind the spot: the spot itself (no NaN)
  const back = spotHold(lit, [-lit[0], -lit[1], -lit[2]], 2.7, KEEP);
  assert.ok(back.every(Number.isFinite) && dot(back, [-lit[0], -lit[1], -lit[2]]) > 0.999);
});

// the second half of P24: after "set them down" the camera falls to the spot (a 1.4 s blend; minutes on a software
// renderer) and mid-fall the ring swung off the bottom of the view with its label hidden (r4 'after Esc', 1920x1080:
// circle at y 1194-1264 of 1080, label gn-off). The ring waits for the camera to arrive.
test('the ring steps back while the camera falls to the spot, and returns once it has arrived', () => {
  // the people's whisper, the band held in the Touch, the camera mid-fall: no ring
  assert.equal(ringWanted('people', true, true, true), false);
  assert.equal(ringWanted('gone', false, false, true), false);
  // arrived: the ring guides the drop (the card stepped aside while the band is held)
  assert.equal(ringWanted('people', true, true, false), true);
  assert.equal(ringWanted('gone', false, false, false), true);
  // the card away under a window, nothing held: no ring; other beats never ring a spot
  assert.equal(ringWanted('people', false, true, false), false);
  assert.equal(ringWanted('wait', true, false, false), false);
  assert.equal(ringWanted(undefined, true, false, false), false);
});
