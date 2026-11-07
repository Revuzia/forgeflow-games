// GENESIS — ARC §6.5 free text: the tower's four answers ("confuse their tongues", "strike down the tower", "warn the
// builders", "let the tower stand"), a negation never does the act, size words set a strike's wrath, and the questions
// "what are they building" (query('towers') words) and "what do they feel" (the hearts, in words, no numbers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';

let cached: Uint8Array | null = null;
function babel(): Sim {
  if (!cached) {
    const sim = new Sim({ seed: 2, scenario: 'babel', overrides: { n: 20 } });
    sim.step(3 * 1440);
    assert.ok(sim.u.god.rel?.towers?.length, 'a tower is rising');
    cached = sim.save();
  }
  return Sim.load(cached);
}

test('§6.5 the four answers in words resolve to the tower commands', () => {
  const sim = babel();
  const want: [string, string][] = [
    ['confuse their tongues', 'tower.confuse'], ['confound their speech', 'tower.confuse'], ['scatter the builders', 'tower.confuse'],
    ['make them speak different languages', 'tower.confuse'], ['give them many tongues', 'tower.confuse'],
    ['let them not understand each other', 'tower.confuse'],
    ['strike down the tower', 'tower.strike'], ['topple the tower', 'tower.strike'], ['bring the tower down', 'tower.strike'],
    ['destroy the tower', 'tower.strike'], ['throw down the tower', 'tower.strike'],
    ['warn the builders', 'tower.warn'], ['tell them to stop building', 'tower.warn'], ['send a prophet to warn them', 'tower.warn'],
    ['let the tower stand', 'tower.let'], ['let them build', 'tower.let'], ['leave them be', 'tower.let'], ['let them reach the sky', 'tower.let'],
  ];
  const fails: string[] = [];
  for (const [text, k] of want) {
    const r = sim.parse(text);
    if (!r.ok || !r.resolved?.length) fails.push(`"${text}": not understood (${r.msg})`);
    else if (r.resolved[0].k !== k) fails.push(`"${text}": ${r.resolved[0].k}, wanted ${k}`);
  }
  assert.deepEqual(fails, [], fails.join('\n'));
  const big = sim.parse('strike down the tower with great wrath');
  assert.equal(big.resolved?.[0].k, 'tower.strike');
  assert.ok(typeof big.resolved?.[0].wrath === 'number' && big.resolved[0].wrath >= 0.5, 'size words set the wrath');
});

test('§6.5 a negation never strikes or confuses', () => {
  const sim = babel();
  for (const text of ['do not strike down the tower', "don't confuse their tongues"]) {
    const r = sim.parse(text);
    assert.ok(!(r.resolved ?? []).some((c) => c.k === 'tower.strike' || c.k === 'tower.confuse'), `${text}: ${JSON.stringify(r.resolved)}`);
  }
});

test('§6.5 "what are they building" and "what do they feel" are answered in words', () => {
  const sim = babel();
  const tw = sim.parse('what are they building?');
  assert.match(tw.msg ?? '', /tower/i);
  assert.ok(!(tw.resolved ?? []).length, 'a question does nothing');
  const feel = sim.parse('what do they feel?');
  assert.match(feel.msg ?? '', /^In /);
  assert.doesNotMatch(feel.msg ?? '', /\d/, 'no numbers in the voice');
  const town = sim.u.planets[0].people.settlements[0].name;
  const one = sim.parse(`how do the people of ${town} feel?`);
  assert.ok((one.msg ?? '').includes(town), one.msg);
  // with no tower, the four answers refuse cleanly
  const bare = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 12 } });
  const r = bare.applyNow({ k: 'freeform', text: 'confuse their tongues' } as never);
  assert.match(r.msg ?? '', /Nobody is building a tower/);
});
