// First run: prefers-reduced-motion seeds ui.reduceMotion; a stored choice is never overridden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedFirstRun, DEFAULT_PREFS, systemPrefersReducedMotion } from '../src/ui/prefs.ts';

test('first run follows the system request for reduced motion', () => {
  assert.equal(seedFirstRun(structuredClone(DEFAULT_PREFS), true).ui.reduceMotion, true);
  assert.equal(seedFirstRun(structuredClone(DEFAULT_PREFS), false).ui.reduceMotion, false);
  assert.equal(DEFAULT_PREFS.ui.reduceMotion, false, 'the shipped default is unchanged');
});

test('no matchMedia (node) reads as no request', () => { assert.equal(systemPrefersReducedMotion(), false); });

test('the power card line names the wrath word and what it means, neutrally', async () => {
  const { wrathScaleLine } = await import('../src/ui/powers.ts');
  assert.match(wrathScaleLine(0.3), /^Harm is scaled by wrath\. At survivable \(0\.30\): .*most live/);
  assert.ok(!/\b(kind|unkind|mercy|cruel)\b/i.test(wrathScaleLine(0.9)));
});
