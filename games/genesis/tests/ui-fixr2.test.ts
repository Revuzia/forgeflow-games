// GENESIS — UI fix round 2 (#19): the sim hooks the player must see before acting — a planet-scale disaster's wrath
// need (the powers query's minWrath), a sign of warning (god.omen { warning }) — checked against the real sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PowerBook, buildCommand, castValues, wrathNeedWords, WRATH_DEFAULT } from '../src/ui/powers.ts';
import { town } from './helpers/god.ts';

const GATED = ['disaster-comet', 'disaster-supervolcano', 'disaster-gravity-slip', 'disaster-moon-fall'];

test('#19 minWrath: the four planet-scale disasters say they need the wrath at huge before the cast, and the sim agrees', () => {
  const { sim, st } = town();
  const book = new PowerBook();
  assert.ok(book.setFromSim(sim.query('powers')));
  book.setCommands(sim.query('commands'));
  book.wrathLaw = WRATH_DEFAULT;
  for (const id of GATED) {
    const p = book.get(id);
    assert.ok(p, id);
    assert.equal(p!.minWrath, 0.85, `${id} carries the query's minWrath`);
    assert.equal(book.wrathShort(p!), 0.85, `${id} is short at the law (0.3)`);
    assert.equal(book.wrathShort(p!, { wrath: 0.6 }), 0.85, `${id} is short at great`);
    assert.equal(book.wrathShort(p!, { wrath: 0.85 }), null, `${id} may fall with this cast's wrath at huge`);
  }
  assert.equal(wrathNeedWords(0.85), 'needs wrath: huge (0.85)');
  // the law raised: every cast left alone may fall
  book.wrathLaw = 0.9;
  for (const id of GATED) assert.equal(book.wrathShort(book.get(id)!), null);
  book.wrathLaw = WRATH_DEFAULT;
  // nothing else is gated
  const others = book.list.filter((p) => !GATED.includes(p.id) && book.minWrathOf(p) !== undefined).map((p) => p.id);
  assert.deepEqual(others, [], 'only the four');
  assert.equal(book.wrathShort(book.get('disaster-meteor')!), null);
  // what the card says is what the sim does: refused at the law, with the remedy the card offers
  const comet = book.get('disaster-comet')!;
  const c = buildCommand(comet, castValues(comet, {}), { hit: { planet: 0, dir: st.pos } }, 400, 0);
  assert.equal(c.wrath, undefined, 'the card sends no wrath until it is moved');
  const r = sim.applyNow(c);
  assert.ok(!r.ok && /huge/.test(String(r.msg)), String(r.msg));
  // the card's "raise this cast" sets the cast's own wrath to the need; the command then carries it
  const raised = buildCommand(comet, castValues(comet, { wrath: 0.85 }), { hit: { planet: 0, dir: st.pos } }, 400, 0);
  assert.equal(raised.wrath, 0.85);
});

test('#19 minWrath without the worker: the client catalogue knows the need from the disaster kinds', () => {
  const book = new PowerBook();
  const p = book.get('disaster-comet');
  assert.ok(p);
  assert.equal(book.minWrathOf(p!), 0.85);
  assert.equal(book.wrathShort(p!), 0.85);
  assert.equal(book.minWrathOf(book.get('disaster-meteor')!), undefined);
});

test('#19 a sign of warning: the omen card takes it, and the sim picks a sign that warns — never the rainbow', () => {
  const { sim, st } = town(20261103);
  const book = new PowerBook();
  assert.ok(book.setFromSim(sim.query('powers')));
  book.setCommands(sim.query('commands'));
  const omen = book.get('omen');
  assert.ok(omen);
  assert.equal(omen!.schema.warning?.type, 'boolean', 'the omen card offers "a sign of warning"');
  const c = buildCommand(omen!, { warning: true }, { refs: { settlement: st.id } }, null, 0);
  assert.equal(c.k, 'god.omen');
  assert.equal(c.warning, true);
  // what the sign picker sends over a town
  const r = sim.applyNow({ k: 'god.omen', settlement: st.id, warning: true, planet: 0 });
  assert.ok(r.ok, r.msg);
  const recent = (sim.query('omens', { planet: 0 }) as { recent: { kind: string }[] }).recent;
  assert.ok(recent.length >= 1);
  assert.notEqual(recent[recent.length - 1].kind, 'rainbow', 'a warning is no rainbow');
});
