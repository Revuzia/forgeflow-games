// Input-aware hint wording (src/ui/prompts.js): every level hint is written with {tokens}, never
// with a key or button name, and every token resolves for keyboard, touch and gamepad.

import { test, assert, eq } from './lib/harness.js';
import { levels } from '../src/levels/index.js';
import { resolvePrompt, tokensIn, hardCodedControls, hintSeconds, TOKENS, INPUT_MODES, DISMISS_LABEL, HINT_MAX_CHARS } from '../src/ui/prompts.js';

test('prompts: every token has wording for every input method', () => {
  for (const [name, t] of Object.entries(TOKENS)) {
    for (const m of INPUT_MODES) assert(typeof t[m] === 'string' && t[m].length > 0, `token {${name}} has no wording for ${m}`);
  }
  for (const m of INPUT_MODES) assert(DISMISS_LABEL[m], `no dismiss label for ${m}`);
});

test('prompts: a token resolves per input method, and capitalises at a sentence start', () => {
  eq(resolvePrompt('Move with {move}.', 'keyboard'), 'Move with WASD.');
  eq(resolvePrompt('Move with {move}.', 'touch'), 'Move with the left stick.');
  eq(resolvePrompt('Move with {move}.', 'pad'), 'Move with the left stick.');
  eq(resolvePrompt('{ice} to freeze.', 'keyboard'), 'Press 2 to freeze.');
  eq(resolvePrompt('{ice} to freeze.', 'touch'), 'Tap the ice button to freeze.');
  eq(resolvePrompt('{ice} to freeze.', 'pad'), 'Press Y to freeze.');
  eq(resolvePrompt('Flat? {film}, then {liquid}.', 'touch'), 'Flat? Tap the film button, then tap the drop button.');
  eq(resolvePrompt('Jammed? {restart}.', 'keyboard'), 'Jammed? Press R.');
  eq(resolvePrompt('Jump with {jump}; hold it.', 'pad'), 'Jump with A; hold it.');
  eq(resolvePrompt('no tokens here', 'touch'), 'no tokens here');
  eq(resolvePrompt('{ice}', 'bogus-mode'), 'Press 2', 'an unknown mode falls back to the keyboard');
});

test('prompts: an unknown token stays visible, so a typo cannot go unnoticed', () => {
  eq(resolvePrompt('Press {nope}.', 'keyboard'), 'Press {nope}.');
});

test('prompts: the hard-coded-control detector flags key and button names', () => {
  for (const bad of ['Move with WASD', 'Press 2 to freeze', 'tap the ice button', 'Boil (3) first', 'click it', 'Use Space', 'push the stick']) {
    assert(hardCodedControls(bad).length > 0, `should flag: ${bad}`);
  }
  for (const ok of ['Steam is too light to press it.', 'Move with {move}.', 'A heavy plate ignores a mere drop.', 'six seconds']) {
    eq(hardCodedControls(ok), [], `should not flag: ${ok}`);
  }
});

for (const level of levels) {
  test(`${level.id}: hints name no keys or buttons, use only known tokens, and fit the phone card`, () => {
    for (const [key, raw] of Object.entries(level.hints)) {
      const where = `${level.id} hint "${key}"`;
      eq(hardCodedControls(raw), [], `${where} hard-codes a control (use a {token})`);
      for (const t of tokensIn(raw)) assert(TOKENS[t], `${where}: unknown token {${t}}`);
      for (const m of INPUT_MODES) {
        const text = resolvePrompt(raw, m);
        assert(!/[{}]/.test(text), `${where} on ${m} still has a brace: ${text}`);
        assert(text.length <= HINT_MAX_CHARS, `${where} is ${text.length} chars on ${m}: ${text}`);
        assert(/^[A-Z0-9]/.test(text), `${where} on ${m} must start with a capital: ${text}`);
      }
    }
  });
}

test('prompts: the same hint reads differently per input method (live switch)', () => {
  const raw = levels[0].hints.start;
  const k = resolvePrompt(raw, 'keyboard'), t = resolvePrompt(raw, 'touch'), p = resolvePrompt(raw, 'pad');
  assert(k !== t && t !== p && k !== p, 'keyboard, touch and pad wording should all differ');
  assert(/WASD/.test(k) && !/WASD/.test(t) && !/WASD/.test(p), 'only the keyboard version names WASD');
});

test('prompts: touch hints leave the screen sooner than long desktop ones, within sane bounds', () => {
  const short = hintSeconds('x'.repeat(40), 'touch'), long = hintSeconds('x'.repeat(118), 'touch');
  assert(short >= 4.5 && long <= 8 && long > short, `touch durations ${short}..${long}`);
  assert(hintSeconds('x'.repeat(100), 'keyboard') >= 7);
});
