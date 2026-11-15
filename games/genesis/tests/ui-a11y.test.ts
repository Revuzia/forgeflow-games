// Accessibility: window focus return, text size and high contrast, the regard gauge's second cue, the dialog roles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { focusReturnTarget } from '../src/ui/panel.ts';
import { DEFAULT_PREFS, TEXT_SIZE_MULT, effectiveScale } from '../src/ui/prefs.ts';

const src = (f: string) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');
const el = (o: Partial<{ isConnected: boolean; hidden: boolean }> = {}) => ({ focus() {}, ...o });

test('focus returns to the opener when focus is nowhere or inside the window', () => {
  const opener = el(), body = {}, inner = {};
  assert.equal(focusReturnTarget(opener, body, (x) => x === inner, body), opener);
  assert.equal(focusReturnTarget(opener, null, () => false, body), opener);
  assert.equal(focusReturnTarget(opener, inner, (x) => x === inner, body), opener);
});

test('focus is left alone when the player already moved it elsewhere, or the opener is gone', () => {
  const opener = el(), body = {}, other = {};
  assert.equal(focusReturnTarget(opener, other, () => false, body), null);
  assert.equal(focusReturnTarget(null, body, () => false, body), null);
  assert.equal(focusReturnTarget(el({ isConnected: false }), body, () => false, body), null);
  assert.equal(focusReturnTarget(el({ hidden: true }), body, () => false, body), null);
});

test('panels are dialogs, modal ones say so, and take and give back focus', () => {
  const s = src('panel.ts');
  assert.match(s, /role: 'dialog'/);
  assert.match(s, /modal: 'true'/);
  assert.match(s, /this\.root\.focus\(/);
  assert.match(s, /focusReturnTarget\(/);
});

test('text size steps grow the scale, stay in range, default to normal', () => {
  assert.equal(DEFAULT_PREFS.ui.textSize, 'normal');
  assert.equal(DEFAULT_PREFS.ui.highContrast, false);
  assert.equal(effectiveScale(1, 'normal'), 1);
  assert.ok(effectiveScale(1, 'large') > 1 && effectiveScale(1, 'larger') > effectiveScale(1, 'large'));
  assert.equal(effectiveScale(2, 'larger'), 2.5);
  assert.equal(effectiveScale(1, 'bogus' as never), 1);
  assert.deepEqual(Object.keys(TEXT_SIZE_MULT), ['normal', 'large', 'larger']);
});

test('the shell applies the high-contrast class and the settings offer both controls', () => {
  assert.match(src('shell.ts'), /toggle\('gn-high-contrast', u\.highContrast\)/);
  assert.match(src('shell.ts'), /effectiveScale\(/);
  const s = src('settings.ts');
  assert.match(s, /ui\.textSize/);
  assert.match(s, /ui\.highContrast/);
  assert.match(src('styles.css'), /body\.gn-high-contrast/);
});

test('the regard gauge shows the band as a word as well', () => {
  const s = src('living.ts');
  assert.match(s, /gn-regard-word', text: band/);
});
