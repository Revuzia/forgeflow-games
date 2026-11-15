// The arc's commands (tower answers, covenant vows, defiance answers) have neutral wheel entries, each mapped to a real
// handler; the Chronicle has a "What you did" tab that shows only the god's own acts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../src/sim/sim.ts';
import { validatePowers } from '../src/sim/god/powers.ts';
import { isGodAct } from '../src/ui/chronicle.ts';

const ARC = ['tower-confuse', 'tower-strike', 'tower-warn', 'tower-let', 'vow-no-flood', 'vow-spare-the-many', 'vow-gentle', 'vow-warn-first', 'vow-none',
  'answer-wrath', 'answer-mercy', 'answer-sign', 'answer-patience'];

test('every arc command has a Signs power with a registered handler', () => {
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 12 } });
  assert.deepEqual(validatePowers(sim.registry, sim.content), []);
  for (const id of ARC) {
    const pw = sim.content.powers.get(id);
    assert.ok(pw, id);
    assert.equal(pw.category, 'Signs', id);
    assert.ok(sim.registry.kinds().includes(pw.command), `${id}: ${pw.command}`);
    assert.ok(pw.synonyms.length >= 1 && pw.desc, id);
  }
});

test('their names and descriptions are neutral (no kind, cruel, merciful, punish, reward, forgive)', () => {
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 12 } });
  for (const id of ARC) {
    const pw = sim.content.powers.get(id)!;
    assert.ok(!/\b(kind|unkind|cruel|merciful|mercy|punish|reward|forgive|good|evil)\b/i.test(`${pw.name} ${pw.desc}`), id);
  }
});

test('the vow and answer powers carry their vow or answer, and the answers take a town', () => {
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 12 } });
  assert.equal(sim.content.powers.get('vow-gentle')!.params.vow, 'gentle');
  assert.equal(sim.content.powers.get('answer-patience')!.params.how, 'patience');
  assert.equal(sim.content.powers.get('answer-patience')!.target, 'settlement');
});

test('the chronicle has a "What you did" tab that keeps only the god\'s acts', () => {
  assert.equal(isGodAct({ kind: 'god' }), true);
  assert.equal(isGodAct({ kind: 'war' }), false);
  const s = readFileSync(new URL('../src/ui/chronicle.ts', import.meta.url), 'utf8');
  assert.match(s, /'did', 'What you did'/);
  assert.match(s, /this\.tab === 'did' \? isGodAct\(e\)/);
});
