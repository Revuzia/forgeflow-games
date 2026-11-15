// The premise scenarios (shore, neighbours, coldforge, fewhands) load, run a stretch of days without error, say what to
// watch in neutral words, and each has a hand-written card in the new-world picker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { BASE_PACK } from '../src/data/index.ts';

const IDS = ['shore', 'neighbours', 'coldforge', 'fewhands'];

test('each premise scenario has a "what to watch" line, neutral in wording', () => {
  for (const id of IDS) {
    const s = BASE_PACK.scenarios?.find((x) => x.id === id) as unknown as { description: string; peoples: unknown[] } | undefined;
    assert.ok(s, id);
    assert.match(s.description, /What to watch: /, id);
    assert.ok(!/\b(kind|unkind|merciful|cruel|punish|reward)\b/i.test(s.description), `${id} neutral`);
    assert.ok(s.peoples.length >= 1, `${id} has a people`);
  }
});

test('each premise scenario builds a world with people and runs', () => {
  for (const id of IDS) {
    const sim = new Sim({ seed: 7, scenario: id, overrides: { n: 12 } });
    sim.step(200);
    const folk = sim.u.planets.reduce((n, pl) => n + [...pl.people.members.values()].reduce((m, l) => m + l.length, 0), 0);
    assert.ok(folk > 0, `${id}: people live after 200 steps`);
  }
});
