// GENESIS — the site listing (public/game_meta.json) and CONTROLS.md say what the game really does: their controls
// are generated from the keybind registry (src/ui/controlstext.ts; regenerate with node _harness/gen-controls.ts), the
// listing names the living world, and nothing in them is a leftover of an old binding or of the removed creature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { controlsMarkdown, metaKeyboard, metaGamepad } from '../src/ui/controlstext.ts';
import { ACTIONS, ACTION_BY_ID, SPEED_KEYS, comboLabel } from '../src/ui/keybinds.ts';

const root = new URL('../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('public/game_meta.json', root), 'utf8')) as Record<string, string>;
const REGEN = 'stale: run node _harness/gen-controls.ts';

test('game_meta.json controls are the generated ones (keyboard and gamepad)', () => {
  assert.equal(meta.controls_keyboard, metaKeyboard(), REGEN);
  assert.equal(meta.controls_gamepad, metaGamepad(), REGEN);
});

test('CONTROLS.md is the generated one and lists every action at its default keys', () => {
  const md = readFileSync(new URL('CONTROLS.md', root), 'utf8');
  assert.equal(md, controlsMarkdown(), REGEN);
  for (const a of ACTIONS) {
    if (['cam.menu', 'cam.follow', 'cam.dolly', 'cam.walk', 'cam.photo', 'cam.fly', 'cam.system', 'cam.home'].includes(a.id)) continue;
    assert.ok(md.includes(a.label), `CONTROLS.md lists ${a.id}`);
  }
});

test('the listing\'s key claims match the bindings (no stale P pause, Q/E turn, G system view, ",/." speed)', () => {
  const kb = meta.controls_keyboard;
  const key = (id: string) => comboLabel(ACTION_BY_ID.get(id)!.keys[0]!);
  assert.ok(kb.includes(`${key('time.pause')} pause`));
  assert.ok(kb.includes(`${key('cam.photo')} photo`));
  assert.ok(kb.includes(`${key('cam.turnLeft')} / ${key('cam.turnRight')} turn`));
  assert.ok(kb.includes(`${key('cam.system')} system view`));
  assert.ok(kb.includes(`${SPEED_KEYS[SPEED_KEYS.length - 1]![0]}×`), 'the deepest speed step is named');
  for (const stale of ['P pause', 'Q / E turn', 'G system view', 'slower / faster', 'creature', 'Creature']) assert.ok(!kb.includes(stale), stale);
  assert.ok(!/not yet supported/i.test(meta.controls_gamepad));
  for (const b of ['LT', 'RT', 'RS', 'Start']) assert.ok(meta.controls_gamepad.includes(b), b);
});

test('the listing describes the living world and ships a cover', () => {
  const text = `${meta.short_description} ${meta.description}`;
  for (const w of ['pray', 'prophet', 'sign', 'Touch', 'wrath', 'sigil']) assert.ok(text.includes(w), w);
  assert.ok(!/creature|disciple|\bhand\b/i.test(text), 'no creature, disciples or hand');
  assert.ok(['strategy', 'action', 'arcade', 'puzzle', 'adventure', 'platformer', 'rpg', 'racing', 'board_game'].includes(meta.genre), 'a genre with a category page on the site');
  assert.ok(existsSync(new URL('public/thumbnail.png', root)), 'public/thumbnail.png (the site cover)');
});
