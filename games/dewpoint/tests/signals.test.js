import { test, assert, eq, throws } from './lib/harness.js';
import { Signals } from '../src/sim/signals.js';
import { Sim } from '../src/sim/sim.js';
import { mini } from './lib/mini.js';

const DT = 1 / 120;

/** Feed a sequence of raw frames ({a:true,...}) and return the values of `watch` after each. */
function drive(sig, frames, watch) {
  const out = [];
  for (const f of frames) {
    for (const k of Object.keys(f)) if (f[k]) sig.emit(k);
    sig.evaluate(DT);
    out.push(sig.get(watch) ? 1 : 0);
  }
  return out.join('');
}
const A = { a: true }, B = { b: true }, AB = { a: true, b: true }, O = {};

function make(defs, emitters = ['a', 'b', 'c']) {
  const s = new Signals(defs);
  for (const e of emitters) s.declareEmitter(e);
  return s;
}

test('raw channels: true only on ticks where something emitted; several emitters OR together', () => {
  const s = make({});
  eq(drive(s, [O, A, A, O, A], 'a'), '01101');
  s.emit('a'); s.emit('a'); s.evaluate(DT);
  assert(s.get('a'));
  assert(!s.get('nonexistent'), 'unknown channels read false');
});

test('and / or / not / xor', () => {
  eq(drive(make({ x: { and: ['a', 'b'] } }), [O, A, B, AB, O], 'x'), '00010');
  eq(drive(make({ x: { or: ['a', 'b'] } }), [O, A, B, AB, O], 'x'), '01110');
  eq(drive(make({ x: { not: 'a' } }), [O, A, O], 'x'), '101');
  eq(drive(make({ x: { xor: ['a', 'b'] } }), [O, A, B, AB], 'x'), '0110');
  eq(drive(make({ x: '!a' }), [O, A, O], 'x'), '101');
  eq(drive(make({ x: { and: ['a', '!b'] } }), [O, A, AB, B], 'x'), '0100');
});

test('latch stays on; latch with reset can be cleared (reset wins)', () => {
  eq(drive(make({ x: { latch: 'a' } }), [O, A, O, O, B, O], 'x'), '011111');
  eq(drive(make({ x: { latch: 'a', reset: 'b' } }), [O, A, O, B, O, AB, A], 'x'), '0110001');
});

test('toggle flips on each rising edge only', () => {
  eq(drive(make({ x: { toggle: 'a' } }), [O, A, A, A, O, A, O, O, A], 'x'), '011110001');
});

test('hold keeps a pulse alive for N seconds; delay requires N seconds of continuous input', () => {
  const s = make({ h: { hold: 'a', for: 0.05 }, d: { delay: 'a', for: 0.05 } });
  const frames = [A, ...Array(10).fill(O)];
  const h = drive(s, frames, 'h');
  eq(h, '11111110000', 'hold: on for the pulse tick plus 6 ticks (0.05 s = 6 ticks at 120 Hz)');
  const s2 = make({ d: { delay: 'a', for: 0.05 } });
  eq(drive(s2, [A, A, A, A, A, A, A, A, O, A, A], 'd'), '00000111000', 'delay: needs 6 continuous ticks, resets on a gap');
});

test('nesting and references between derived channels, in any declaration order', () => {
  const s = make({
    open: { or: ['both', { latch: 'c' }] },
    both: { and: ['a', 'b'] },
  });
  eq(drive(s, [O, A, AB, O, { c: true }, O, O], 'open'), '0010111');
});

test('stateful nodes advance once per tick no matter how many readers they have', () => {
  const s = make({ t: { toggle: 'a' }, x: { and: ['t', 't'] }, y: { or: ['t', 'x'] } });
  eq(drive(s, [A, O, A, O, A], 'y'), '11001');
  eq(s.get('t'), true);
});

test('inline expressions compiled for actuators evaluate with the rest', () => {
  const s = make({});
  const node = s.compile({ and: ['a', { not: 'b' }] }, 'door');
  const plain = s.compile('a', 'door2');
  s.emit('a'); s.evaluate(DT);
  assert(s.read(node) && s.read(plain));
  s.emit('a'); s.emit('b'); s.evaluate(DT);
  assert(!s.read(node) && s.read(plain));
  s.evaluate(DT);
  assert(!s.read(plain));
});

test('errors: cycles, unknown operators, bad arity, emitting a derived channel', () => {
  throws(() => new Signals({ a: { not: 'b' }, b: { not: 'a' } }), /cycle/);
  throws(() => new Signals({ a: { nand: ['x', 'y'] } }), /exactly one of/);
  throws(() => new Signals({ a: { and: [] } }), /non-empty array/);
  throws(() => new Signals({ a: { xor: ['x'] } }), /exactly two/);
  throws(() => new Signals({ a: { hold: 'x' } }), /numeric "for"/);
  throws(() => new Signals({ a: { and: ['x'], or: ['y'] } }), /exactly one of/);
  throws(() => new Signals({ 'bad name': 'x' }), /bad channel name/);
  const s = new Signals({ d: { not: 'x' } });
  throws(() => s.declareEmitter('d'), /derived channel/);
});

test('dangling(): reports channels that are read but never emitted', () => {
  const s = new Signals({ x: { and: ['plateA', 'typo'] } });
  s.declareEmitter('plateA');
  eq(s.dangling(), ['typo']);
});

test('in the sim: two plates AND-ed and latched open a door for good', () => {
  const sim = new Sim(mini([
    { type: 'plate', pos: [2, 0, 0], emit: 'p1' },
    { type: 'plate', pos: [2, 0, 3], heavy: true, emit: 'p2' },
    { type: 'crate', pos: [2, 0.06, 3] },
    { type: 'door', id: 'd', box: [6, 0, -3, 6.4, 3, 3], on: 'gate' },
  ], { signals: { gate: { latch: { and: ['p1', 'p2'] } } } }));
  const door = sim.level.doors[0];
  for (let i = 0; i < 60; i++) sim.step();
  assert(sim.signals.get('p2') && !sim.signals.get('p1') && !sim.signals.get('gate'));
  eq(door.open, 0);
  for (let i = 0; i < 120; i++) sim.step({ mx: 1, mz: 0 });         // walk onto p1
  assert(sim.signals.get('gate'), 'both plates -> gate');
  for (let i = 0; i < 240; i++) sim.step({ mx: -1, mz: 0 });        // walk away
  assert(!sim.signals.get('p1') && sim.signals.get('gate'), 'latched');
  eq(door.open, 1);
});

test('in the sim: a level with a dangling signal reports a warning', () => {
  const sim = new Sim(mini([{ type: 'door', box: [6, 0, -3, 6.4, 3, 3], on: 'nobody' }]));
  assert(sim.level.warnings.some((w) => /nobody/.test(w)), 'expected a warning naming the channel');
});
