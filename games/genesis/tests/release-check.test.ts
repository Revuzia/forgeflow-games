import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUDGET, checkSizes, checkStamp, findStamp, validateMeta } from '../_harness/release-check.ts';

const meta = JSON.parse(readFileSync(new URL('../public/game_meta.json', import.meta.url), 'utf8')) as Record<string, unknown>;

test('the shipped game_meta.json passes the release check', () => {
  assert.deepEqual(validateMeta(meta), []);
  assert.equal(meta.has_mobile_support, false);
});

test('meta problems are named', () => {
  assert.ok(validateMeta({ ...meta, genre: 'god-game' }).some((p) => /genre/.test(p)));
  assert.ok(validateMeta({ ...meta, difficulty: 'normal' }).some((p) => /difficulty/.test(p)));
  assert.ok(validateMeta({ ...meta, has_mobile_support: undefined }).some((p) => /has_mobile_support/.test(p)));
  assert.ok(validateMeta({ ...meta, has_mobile_support: true }).some((p) => /desktop only/.test(p)));
  assert.ok(validateMeta({ ...meta, description: 'A game.' }).some((p) => /English only/.test(p)));
});

test('sizes: over budget is refused, within is not', () => {
  assert.deepEqual(checkSizes([{ path: 'assets/a.js', bytes: 3e6 }]).problems, []);
  assert.equal(checkSizes([{ path: 'assets/a.js', bytes: BUDGET.jsFileBytes + 1 }]).problems.length, 1);
  assert.equal(checkSizes([{ path: 'x.bin', bytes: BUDGET.totalBytes + 1 }]).problems.length, 1);
});

test('a dirty or unknown build stamp is refused', () => {
  const s = (x: string) => findStamp(`var a="${x}";`);
  assert.deepEqual(checkStamp(s('c8d721ac built 2026-11-15T09:00Z')), []);
  assert.equal(checkStamp(s('c8d721ac+dirty built 2026-11-15T09:00Z')).length, 1);
  assert.equal(checkStamp(s('unknown built 2026-11-15T09:00Z')).length, 1);
  assert.equal(checkStamp(null).length, 1);
});
