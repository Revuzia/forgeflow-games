// GENESIS — ARC §6.5 in the free-form box: the hearts example the box offers is a question the sim answers in words, and
// the tower chips offered while a great tower rises are the phrases the sim reads as the tower's answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { town, must } from './helpers/god.ts';

const src = readFileSync(new URL('../src/ui/freeform.ts', import.meta.url), 'utf8');
const signs = readFileSync(new URL('../src/sim/god/freeform-signs.ts', import.meta.url), 'utf8');

test('the hearts example is answered in words (no numbers)', () => {
  assert.ok(src.includes("'how do the people of {town} feel?'"), 'the example is offered');
  const base = town();
  const sim = base.sim;
  must(sim, { k: 'focus', planet: 0, pos: base.st.pos });
  const name = sim.u.planets[0].settlements?.[0]?.name ?? 'Aru';
  const r = sim.applyNow({ k: 'freeform', text: `how do the people of ${name} feel?` });
  assert.ok(r.ok, r.msg);
  assert.ok(r.msg && r.msg.length > 10, `words: ${r.msg}`);
  assert.ok(!/\d+\s*%/.test(r.msg ?? ''), `no percentages: ${r.msg}`);
});

test('the tower chips match the sim\'s tower phrases', () => {
  const chips = ['confuse their tongues', 'warn the builders', 'let the tower stand'];
  for (const c of chips) assert.ok(src.includes(`'${c}'`), `${c} offered`);
  const re = (name: string) => new RegExp(signs.match(new RegExp(`const ${name} = /(.+)/;`))![1]);
  assert.ok(re('T_CONFUSE').test(chips[0]));
  assert.ok(re('T_WARN').test(chips[1]));
  assert.ok(re('T_LET').test(chips[2]));
});
