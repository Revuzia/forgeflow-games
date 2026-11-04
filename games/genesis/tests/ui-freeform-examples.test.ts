// GENESIS — the free-form box's example lines are things this world can really do (release minor 3: "invent telepathy"
// read as fantasy, and the sim refuses it: a real world has no telepathy). Every example that invents something must be a
// real idea the sim accepts and turns into a new craft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { town, must } from './helpers/god.ts';

const src = readFileSync(new URL('../src/ui/freeform.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const EXAMPLES = ['), src.indexOf('];', src.indexOf('const EXAMPLES = [')));
const EXAMPLES = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const lex = JSON.parse(readFileSync(new URL('../src/data/lexicon.json', import.meta.url), 'utf8'));

test('no free-form example names a fantasy idea', () => {
  assert.ok(EXAMPLES.length > 10, 'the examples were read');
  const fantasy: string[] = lex.fantasyIdeas;
  for (const ex of EXAMPLES) for (const f of fantasy) assert.ok(!new RegExp(`\\b${f}\\b`, 'i').test(ex), `"${ex}" names ${f}`);
});

test('every "invent ..." example is a real idea the sim carries out', () => {
  const inv = EXAMPLES.filter((e) => /^invent\b/i.test(e));
  assert.ok(inv.length >= 1, 'there is an invention example');
  for (const text of inv) {
    const base = town();
    const sim = base.sim;
    must(sim, { k: 'focus', planet: 0, pos: base.st.pos });
    const n0 = sim.u.content.recipes.list.length;
    const r = sim.applyNow({ k: 'freeform', text: text.replace('{town}', 'Aru') });
    assert.ok(r.ok, `${text}: ${r.msg}`);
    assert.ok(sim.u.content.recipes.list.length > n0, `${text}: a new craft or idea exists`);
  }
});
