// The level loader must reject malformed data loudly (with the piece index). The "cannot be cheesed" tests of
// l01-l03 live in tests/levels-v2-l01-l04.test.js.

import { test, assert, eq, throws, near } from './lib/harness.js';
import { Sim } from '../src/sim/sim.js';
import { PIECE_TYPES } from '../src/sim/level.js';
import { mini, run } from './lib/mini.js';
import { play } from './lib/play.js';
import { FORMS } from '../src/sim/constants.js';

const bad = (pieces, pattern, extra) => throws(() => new Sim(mini(pieces, extra)), pattern);

test('loader: top-level fields are validated', () => {
  throws(() => new Sim(null), /not an object/);
  throws(() => new Sim({ name: 'x', spawn: [0, 0, 0], pieces: [] }), /missing string id/);
  throws(() => new Sim({ id: 'a', spawn: [0, 0, 0], pieces: [] }), /missing name/);
  throws(() => new Sim({ id: 'a', name: 'A', spawn: [0, 0], pieces: [] }), /"spawn" must be \[x, y, z\]/);
  throws(() => new Sim({ id: 'a', name: 'A', spawn: [0, 0, 0] }), /pieces must be an array/);
  throws(() => new Sim({ id: 'a', name: 'A', spawn: [0, 0, 0], pieces: [] }), /exactly one "exit"/);
  throws(() => new Sim(mini([], { forms: ['ice'] })), /must include "liquid"/);
  throws(() => new Sim(mini([], { forms: ['liquid', 'plasma'] })), /unknown form "plasma"/);
});

test('loader: errors name the piece index, id and type', () => {
  const e = bad([{ type: 'block', id: 'floor2', box: [0, 0, 0, 1, 1] }], /"box" must be/);
  assert(/piece #2 "floor2" \(block\)/.test(e.message), e.message);
  bad([{ type: 'blok', box: [0, 0, 0, 1, 1, 1] }], /unknown type/);
});

test('loader: per-piece validation', () => {
  bad([{ type: 'block', box: [0, 0, 0, 1, 1, 0] }], /zero size/);
  bad([{ type: 'block', box: [0, 0, 0, 4, 0.05, 4] }], /thinner than 0.1/);
  bad([{ type: 'ramp', box: [0, 0, 0, 4, 2, 4], up: 'north' }], /"up" must be/);
  bad([{ type: 'mover', box: [0, 0, 0, 2, 0.4, 2], to: [0, 0, 0] }], /non-zero/);
  bad([{ type: 'mover', box: [0, 0, 0, 2, 0.4, 2], to: [0, 3, 0], speed: 9 }], /above 6/);
  bad([{ type: 'mover', box: [0, 0, 0, 2, 0.4, 2], to: [0, 3, 0], mode: 'toggle' }], /needs "on"/);
  bad([{ type: 'door', box: [0, 0, 0, 0.4, 3, 2] }], /needs "on"/);
  bad([{ type: 'door', box: [0, 0, 0, 0.4, 3, 2], on: 'x', slide: 'sideways' }], /slide must be/);
  bad([{ type: 'plate', pos: [0, 0, 0] }], /needs "emit"/);
  bad([{ type: 'plate', pos: [0, 0, 0], emit: 'a', size: 2 }], /size must be/);
  bad([{ type: 'crate', pos: [0, 0, 0], size: 0.2 }], /at least 0.4/);
  bad([{ type: 'fan', box: [0, 0, 0, 2, 2, 2], dir: 'up' }], /"dir" must be/);
  bad([{ type: 'current', box: [0, 0, 0, 2, 2, 2], flow: [1] }], /flow must be/);
  bad([{ type: 'sprout', pos: [0, 0, 0], height: 0.2 }], /height must be/);
  bad([{ type: 'hint', box: [0, 0, 0, 2, 2, 2], key: 'nope' }], /must name an entry of level.hints/);
  bad([{ type: 'prop', pos: [0, 0, 0], kind: 'statue' }], /prop kind must be/);
  bad([{ type: 'exit', pos: [1, 0, 1] }], /exactly one "exit"/);
  bad([{ type: 'shard', pos: [1, 1, 1] }, { type: 'shard', pos: [2, 1, 1] }, { type: 'shard', pos: [3, 1, 1] }, { type: 'shard', pos: [4, 1, 1] }], /at most 3 shards/);
  bad([{ type: 'door', box: [0, 0, 0, 0.4, 3, 2], on: { nand: ['a'] } }], /exactly one of/);
});

test('loader: boxes may be given in either corner order; every piece type is accepted', () => {
  const sim = new Sim(mini([{ type: 'block', id: 'b', box: [4, 2, 3, 1, 0, -1] }]));
  eq(sim.level.pieces.find((p) => p.id === 'b').box, [1, 0, -1, 4, 2, 3]);
  eq(PIECE_TYPES.length, 25);
  const all = new Sim({
    id: 'sink', name: 'Sink', spawn: [0, 0, 0], hints: { k: 'hello' }, signals: { both: { and: ['pa', 'pb'] } },
    pieces: [
      { type: 'block', box: [-6, -1, -9, 34, 0, 9] }, { type: 'ramp', box: [-5, 0, 4, -1, 2, 8], up: '-x' },
      { type: 'mover', box: [6, 0, -8, 8, 0.4, -6], to: [0, 3, 0] }, { type: 'door', box: [5, 0, 5, 5.4, 3, 8], on: 'both' },
      { type: 'crate', pos: [4, 0, 0] }, { type: 'pane', box: [9, 0, -2, 9.2, 3, 2] }, { type: 'ember', box: [11, 0, 3, 13, 1, 5] },
      { type: 'grate', box: [11, 0, -6, 11.3, 3, -3] }, { type: 'slot', box: [14, 0, -6, 17, 0.25, -3] }, { type: 'sprout', pos: [15, 0, 4] },
      { type: 'plate', pos: [2, 0, 3], emit: 'pa' }, { type: 'plate', pos: [2, 0, -3], heavy: true, emit: 'pb' },
      { type: 'electrodes', box: [18, 0, 3, 19.4, 0.4, 4], emit: 'el' }, { type: 'sensor', box: [18, 0, 6, 20, 2, 8], emit: 'se' },
      { type: 'fan', box: [20, 0, -8, 30, 3, -5], dir: '+x' }, { type: 'heatvent', box: [23, 0, 1, 25, 3, 3] },
      { type: 'frost', box: [26, 0, 1, 29, 3, 4] }, { type: 'cold', box: [26, 0, 5, 29, 4, 8] }, { type: 'hotfloor', box: [22, 0, 5, 25, 0.3, 8] },
      { type: 'fire', box: [30, 0, 2, 33, 1, 5] }, { type: 'current', box: [-5, 0, -8, 0, 0.8, -5], flow: [2, 0] },
      { type: 'checkpoint', pos: [1, 0, 6] }, { type: 'shard', pos: [3, 1, 6] }, { type: 'hint', box: [0, 0, 0, 1, 1, 1], key: 'k' },
      { type: 'prop', kind: 'lamp', pos: [7, 0, 7] }, { type: 'exit', pos: [32, 0, -7], face: '-x' },
    ],
  });
  eq(new Set(all.level.pieces.map((p) => p.type)).size, PIECE_TYPES.length, 'one of each type');
  for (let i = 0; i < 600; i++) all.step({ mx: 1, mz: 0.2, jump: i % 50 < 20 });
  assert(Number.isFinite(all.player.x + all.player.y + all.player.z), 'state stays finite');
});

test('props are solid unless solid:false', () => {
  const r = run([{ type: 'prop', kind: 'kiln', pos: [4, 0, 0] }]);
  r.move(1, 0, 2);
  assert(r.p.x <= 4 - 1.05 - FORMS.liquid.r + 1e-6, `walked into a kiln: x=${r.p.x}`);
  const q = run([{ type: 'prop', kind: 'kiln', pos: [4, 0, 0], solid: false }]);
  q.move(1, 0, 2);
  assert(q.p.x > 8, 'solid:false props do not collide');
});
