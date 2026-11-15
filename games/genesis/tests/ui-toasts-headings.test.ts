// Toasts on a living (babel) world: chronicle kinds map to a fitting icon kind and heading; no "Custom" label; two at most.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOfChronicle, titleOfChronicle } from '../src/ui/toasts.ts';
import { readFileSync } from 'node:fs';

const view = { planet: () => ({ name: 'Gaia' }) } as never;

test('chronicle kinds the sim writes get a heading that fits, never "Custom"', () => {
  for (const k of ['culture', 'age', 'god', 'world', 'founding', 'plague', 'contact', 'trade', 'disaster', 'discovery']) {
    const t = titleOfChronicle(k, view, 0);
    assert.ok(!/custom/i.test(t), `${k}: ${t}`);
    assert.ok(!/^Chronicle/.test(t), `${k} has its own heading: ${t}`);
  }
  assert.equal(titleOfChronicle('culture', view, 0), 'Their ways · Gaia');
  assert.equal(titleOfChronicle('age', view, 0), 'A new age · Gaia');
  assert.equal(kindOfChronicle('age'), 'founding');
  assert.equal(kindOfChronicle('world'), 'nature', 'the world\'s firsts are not a ruin');
});

test('at most two toasts stand at once, by default and in the shell', () => {
  assert.match(readFileSync(new URL('../src/ui/toasts.ts', import.meta.url), 'utf8'), /const MAX_SHOWN = 2;/);
  assert.match(readFileSync(new URL('../src/ui/shell.ts', import.meta.url), 'utf8'), /toasts\.maxShown = 2;/);
});
