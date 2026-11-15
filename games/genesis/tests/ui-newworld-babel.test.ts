// The new-world picker offers "One speech" (babel) as its own card with its own icon and premise, not as a mod-pack extra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NewWorld } from '../src/ui/newworld.ts';
import { iconKeys } from '../src/ui/icons.ts';
import { BASE_PACK } from '../src/data/index.ts';

test('the picker has a babel card: named, with a premise, an icon that exists, listed once', () => {
  const nw = Object.create(NewWorld.prototype) as any;
  nw.deps = { dev: false };
  nw.offered = () => ({ scenarios: BASE_PACK.scenarios ?? [] });
  const cards = nw.cards() as { id: string; name: string; desc: string; icon: string }[];
  const babel = cards.filter((c) => c.id === 'babel');
  assert.equal(babel.length, 1);
  assert.equal(babel[0].name, 'One speech');
  assert.notEqual(babel[0].icon, 'mods');
  assert.ok(iconKeys().includes(babel[0].icon), 'icon exists');
  assert.match(babel[0].desc, /proud towns/);
  assert.ok(!/\b(kind|unkind|merciful|cruel)\b/i.test(babel[0].desc));
  // every base scenario that is not lookdev has a hand-written card (none falls through to the mod-pack icon)
  for (const s of BASE_PACK.scenarios ?? []) if (s.id !== 'lookdev') assert.ok(cards.some((c) => c.id === s.id && c.icon !== 'mods'), s.id);
});
