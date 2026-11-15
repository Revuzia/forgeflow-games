// The regard gauge's explanation is a focusable popover (not a title= tooltip) and is also on the F1 card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regardExplain } from '../src/ui/living.ts';
import { livingRows } from '../src/ui/controlstext.ts';
import { readFileSync } from 'node:fs';

test('the explanation text names the band and the range, neutrally', () => {
  assert.match(regardExplain(-0.6), /feared \(-0\.60/);
  assert.match(regardExplain(0.5), /trusted \(\+0\.50/);
  assert.ok(!/\b(kind|unkind|cruel|merciful)\b/i.test(regardExplain(0)));
});

test('the F1 card has a row for the regard gauge', () => {
  const r = livingRows(() => '').find(([k]) => k === 'regard gauge');
  assert.ok(r && /−1 to \+1/.test(r[1]));
});

test('regardGauge no longer carries the explanation in title=', () => {
  const src = readFileSync(new URL('../src/ui/living.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function regardGauge'), src.indexOf('let regardUid'));
  assert.ok(!/title:/.test(body));
  assert.match(body, /role: 'tooltip'/);
  assert.match(body, /'focus'/);
});
