// Lane F: the music duck returns to 1 on a fake clock, and news reach attenuates with distance and altitude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duckTarget, newsReach } from '../src/audio/duck.ts';

test('duck: held at 0.45 while the hold lasts, then glides back to exactly 1', () => {
  let until = 0;
  const bump = (now: number, secs: number): void => { until = Math.max(until, now + secs); };
  assert.deepEqual(duckTarget(0, until), { gain: 1, glide: 1.2 });
  bump(10, 3.5);
  assert.equal(duckTarget(10.1, until).gain, 0.45);
  assert.equal(duckTarget(10.1, until).glide, 0.12);
  assert.equal(duckTarget(13.4, until).gain, 0.45);
  assert.equal(duckTarget(13.5, until).gain, 1, 'released at the deadline');
  // a longer second hit extends, a shorter one never shortens
  bump(11, 9); bump(11.5, 1);
  assert.equal(until, 20);
  // fake clock sweep: never stuck low after the last deadline
  for (let t = 20; t < 60; t += 0.5) assert.equal(duckTarget(t, until).gain, 1);
});

test('news reach: nearer is louder, altitude widens hearing, floor 0.3 on planet', () => {
  const near = newsReach(true, true, 100, 1000, 0).mul;
  const mid = newsReach(true, true, 1500, 1000, 0).mul;
  const far = newsReach(true, true, 50000, 1000, 0).mul;
  assert.ok(near > mid && mid > far);
  assert.equal(far, 0.3, 'floor on the same planet');
  assert.ok(newsReach(true, true, 3000, 1000, 2000).mul > newsReach(true, true, 3000, 1000, 0).mul, 'high above hears further');
  assert.ok(near <= 1);
});

test('news reach: spread widens past reach; other planet or unplaced is a quiet unplaced bulletin', () => {
  assert.equal(newsReach(true, true, 500, 1000, 0).spread, 0.15);
  assert.equal(newsReach(true, true, 1500, 1000, 0).spread, 0.45);
  assert.deepEqual(newsReach(true, false, 10, 1000, 0), { mul: 0.28, spread: null });
  assert.deepEqual(newsReach(false, true, 10, 1000, 0), { mul: 0.28, spread: null });
});
