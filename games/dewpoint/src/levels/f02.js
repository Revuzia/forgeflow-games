// Fire 2 - "Mind the Drip". Water as danger, in five wet rooms of the works. Ember only. Every
// piece of water is in plain view before it can hurt, and every one has an answer in sight.
// Layout runs along +X (see LEVELS.md section 10). Each area starts at a brazier:
//   1 The Leak Cellar    teach: a pool puts Cinder out. Walk round the puddles, jump a narrow one.
//   2 Stepping Stones    practise: a long pond crossed stone by stone (a side stone, a glow-stone).
//   3 Drip Gallery       read the rhythm: pipes drip over a causeway; wait for a drop to land, go.
//   4 The Sluice Room    sprays: one pulses on and off, one is a valve a fuse shuts for a moment.
//   5 The Boiler House   combine: stones under a drip, a pulsing spray, and then the boiler: light
//                        it and the whole basin boils away, and the kiln opens.
// The rooms are written in their own x numbers and then slid along the level by `at(dx, ...)`:
// the script in tests/solutions/f02.js keeps the same table (area 1 -4, 2 starts at 50, 3 at 110,
// 4 at 152, 5 at 196).

// ---------------------------------------------------------------------------- little builders
const fl = (x0, x1, z0 = -5, z1 = 5, mat = 'tile') => ({ type: 'block', box: [x0, -1, z0, x1, 0, z1], mat });
const walls = (x0, x1, h = 3.6, mat = 'brick') => [
  { type: 'block', box: [x0, 0, -5.5, x1, h, -5], mat },
  { type: 'block', box: [x0, 0, 5, x1, h, 5.5], mat },
];
/** A pool with its dark bed: the surface is 0.1 m below the rim. */
const pond = (x0, x1, z0, z1, id, extra = {}) => [
  { type: 'block', box: [x0, -1.2, z0, x1, -0.6, z1], mat: 'dark' },
  { type: 'pool', id, box: [x0, -0.6, z0, x1, -0.1, z1], ...extra },
];
/** Slide a group of pieces dx metres along +X (boxes, points and wick paths; a mover's `to` is an offset and stays). */
const at = (dx, list) => list.map((p) => {
  const q = { ...p };
  if (q.box) q.box = [q.box[0] + dx, q.box[1], q.box[2], q.box[3] + dx, q.box[4], q.box[5]];
  if (q.pos) q.pos = [q.pos[0] + dx, q.pos[1], q.pos[2]];
  if (q.path) q.path = q.path.map((v) => [v[0] + dx, v[1], v[2]]);
  return q;
});
/** A stepping stone standing in a pond (top `top` above the rim level). */
const stone = (x0, x1, z0, z1, top = 0) => ({ type: 'block', box: [x0, -1.2, z0, x1, top, z1], mat: 'cream' });

/** A pipe with two nozzles 0.8 m apart, so a 1 m causeway under it cannot be squeezed past: both drip together. */
const pipe2 = (id, x, period, offset, y = 3) => [
  { type: 'drip', id: id + 'a', pos: [x, y, -0.4], period, offset },
  { type: 'drip', id: id + 'b', pos: [x, y, 0.4], period, offset },
];

export default {
  id: 'f02',
  element: 'fire',
  name: 'Mind the Drip',
  chapter: 1,
  theme: 'pilot',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember'],
  hints: {
    start: 'Water puts Cinder out. An ember can clear a pool in one jump, but it can never wade.',
    leak: 'A leaking pipe drips into a basin. Anything wet is dangerous: keep clear of it.',
    column: 'Only the falling drop is dangerous, and it falls in a column. Watch one land, then step past.',
    pool: 'Walk round the puddles, or hop a narrow one. Too wide to go round? Take a run-up and jump.',
    stones: 'Too wide for one jump? Hop from stone to stone. The water between them is a respawn.',
    drip: 'The pipes drip in a rhythm. Watch a drop land, then go.',
    pad: 'A wide pad between two pipes. Wait on it for the next drop to land, then go on.',
    pulse: 'That spray pulses on and off. Wait until it stops, then run through.',
    valve: 'The spray never stops on its own. That fuse runs to its valve: light it, then be quick.',
    raft: 'The raft carries you while you stand on it. Board it as the spray stops, so you ride through dry.',
    boiler: 'Light the boiler. Hot enough, it will boil the whole basin away.',
  },
  areas: [
    { name: 'The Leak Cellar', box: [-4, -5, 50, 5] },
    { name: 'Stepping Stones', box: [50, -5, 110, 5] },
    { name: 'Drip Gallery', box: [110, -5, 152, 5] },
    { name: 'The Sluice Room', box: [152, -5, 196, 5] },
    { name: 'The Boiler House', box: [196, -5, 272, 5] },
  ],
  signals: {},
  pieces: [
    // ======================================================== 1. The Leak Cellar (x -4..50)
    fl(-4, 7),
    { type: 'block', box: [-4.5, 0, -5, -4, 0.8, 5], mat: 'brick' },
    ...walls(2, 50),
    ...walls(50, 110),
    ...walls(110, 152),
    ...walls(152, 196),
    ...walls(196, 272),
    fl(-4, 7),
    { type: 'block', box: [-4.5, 0, -5, -4, 0.8, 5], mat: 'brick' },
    { type: 'brazier', id: 'b1', pos: [4, 0, 0] },
    { type: 'prop', kind: 'pipe', pos: [2.6, 0, -4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [4.8, 0, 3.9] },
    // a leak into a basin in the corner: harmless to look at, a first sight of a falling drop
    { type: 'hint', key: 'leak', box: [5, 0, -5, 10, 3, 5] },
    ...pond(7, 9, -5, -3.4, 'basin'),
    { type: 'drip', id: 'leak', pos: [8, 3, -4.2], period: 1.7, offset: 0.3 },
    fl(7, 9, -3.4, 5),
    // a pipe over the middle of the hall: only the falling drop is dangerous, and it falls in a column
    fl(9, 12),
    fl(12, 22),
    { type: 'hint', key: 'column', box: [12.6, 0, -5, 15.6, 3, 5] },
    { type: 'drip', id: 'fdrip', pos: [17, 3, 0], period: 1.8, offset: 0.5 },
    { type: 'prop', kind: 'pipe', pos: [17, 0, 4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [15, 0, -4.0], scale: 0.9 },
    // from here the old rooms, slid along
    ...at(10, [
    // three puddles with a way round, then one that has to be jumped
    fl(9, 12),
    { type: 'hint', key: 'pool', box: [10, 0, -5, 12, 3, 5] },
    ...pond(12, 14.4, -5, 1.8, 'puddle1'), fl(12, 14.4, 1.8, 5),
    fl(14.4, 20),
    ...pond(20, 22.4, -1.8, 5, 'puddle2'), fl(20, 22.4, -5, -1.8),
    fl(22.4, 28),
    ...pond(28, 30.4, -5, 1.8, 'puddle3'), fl(28, 30.4, 1.8, 5),
    fl(30.4, 36),
    { type: 'brazier', id: 'b1b', pos: [33, 0, 0] },
    { type: 'prop', kind: 'shelf', pos: [17, 0, 4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [25, 0, -4.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [31.5, 0, -4.6] },
    ...pond(36, 39.2, -5, 5, 'pool1'),
    fl(39.2, 52),


    { type: 'brazier', id: 'b2', pos: [41.5, 0, 0] },
    { type: 'prop', kind: 'pipe', pos: [45, 0, -4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [47, 0, 3.9] },
    { type: 'hint', key: 'stones', box: [46, 0, -5, 52, 3, 5] },
    ...pond(52, 81.6, -5, 5, 'pool2'),
    // stepping stones 2.6 m long and 3 m wide with 2.0 m between them, each centred at most 0.8 m to one side of the one before: a
    // straight run and jump from anywhere on a stone lands on the next (a keyboard has eight directions and a tap moves a metre)
    stone(54, 56.6, -1.5, 1.5, 0),
    stone(58.6, 61.2, -2.3, 0.7, 0.4),
    stone(63.2, 65.8, -0.7, 2.3, 0.8),
    stone(66.2, 67.5, 3.0, 4.2, 0.4),                                   // the little one off to the side
    { type: 'shard', pos: [66.8, 1.1, 3.6] },
    stone(67.8, 70.4, -2.3, 0.7, 0.8),
    stone(72.4, 75.0, -0.7, 2.3, 0.4),
    stone(77, 79.6, -1.5, 1.5, 0),
    fl(81.6, 84),
    { type: 'brazier', id: 'b2b', pos: [82.8, 0, 0] },
    { type: 'prop', kind: 'lamp', pos: [82.4, 0, -4.6] },
    // the second pond: three pillars that climb like steps
    ...pond(84, 96, -5, 5, 'pool3'),
    stone(85.8, 88.0, -1.2, 1.2, 0.5),                                   // pillars 2.2 m, each 0.5 m higher, 1.6 m apart
    stone(89.6, 91.8, -1.7, 0.7, 1.0),
    stone(93.4, 95.6, -0.7, 1.7, 1.5),
    fl(96, 100),
    { type: 'prop', kind: 'pots', pos: [98, 0, 3.9] },


    ]),
    // ======================================================== 3. Drip Gallery
    ...at(22, [
    fl(88, 96),
    { type: 'brazier', id: 'b3', pos: [90.5, 0, 0] },
    { type: 'hint', key: 'drip', box: [92.5, 0, -2, 96, 3, 2] },
    { type: 'prop', kind: 'shelf', pos: [93, 0, 4.6], rot: 0 },
    // causeway one: three pipes, a quarter of a beat apart; an islet with a glow-stone under a fourth
    { type: 'block', box: [96, -1, -0.5, 107, 0, 0.5], mat: 'cream' },
    ...pond(96, 107, 0.5, 5, 'tankN'),
    ...pond(96, 107, -5, -0.5, 'tankS'),
    ...pipe2('d1', 98.5, 2.1, 0),
    ...pipe2('d2', 101, 2.1, 0.7),
    ...pipe2('d3', 103.5, 2.1, 1.4),
    { type: 'block', box: [102, -1, -3.0, 102.9, 0, -2.1], mat: 'cream' },
    { type: 'shard', pos: [102.45, 0.7, -2.55] },
    { type: 'drip', id: 'd4', pos: [102.45, 3, -2.55], period: 1.9, offset: 0.3 },
    // a landing, with a brazier
    fl(107, 112),
    { type: 'brazier', id: 'b3b', pos: [109.5, 0, 0] },
    { type: 'prop', kind: 'pots', pos: [109, 0, 4.0], scale: 0.9 },
    // causeway two: two slow pipes with a wide pad between them to wait on
    { type: 'hint', key: 'pad', box: [112.2, 0, -2, 115, 3, 2] },
    { type: 'block', box: [112, -1, -0.5, 126, 0, 0.5], mat: 'cream' },
    { type: 'block', box: [118, -1, -1.6, 121, 0, 1.6], mat: 'cream' },
    ...pond(112, 126, 0.5, 5, 'tankN2'),
    ...pond(112, 126, -5, -0.5, 'tankS2'),
    ...pipe2('e1', 115.5, 3, 0),
    ...pipe2('e2', 123.5, 3, 1.5),
    fl(126, 136),
    { type: 'prop', kind: 'pipe', pos: [128.4, 0, -4.6], rot: 0 },


    ]),
    // ======================================================== 4. The Sluice Room
    ...at(22, [
    { type: 'brazier', id: 'b4', pos: [132, 0, 0] },
    { type: 'prop', kind: 'pots', pos: [134, 0, 3.9] },
    { type: 'hint', key: 'pulse', box: [135, 0, -5, 139.6, 3, 5] },
    { type: 'block', box: [140, 3.4, -5, 142.4, 3.8, 5], mat: 'metal' },                 // the spray rail
    { type: 'sprinkler', id: 'pulsed', box: [140, 0, -5, 142.4, 3.4, 5], period: 3, duty: 0.45, offset: 1 },
    fl(136, 174),
    { type: 'brazier', id: 'b4b', pos: [146.5, 0, 0] },
    { type: 'prop', kind: 'shelf', pos: [145, 0, -4.6], rot: 0 },
    { type: 'hint', key: 'valve', box: [148.2, 0, -5, 150.4, 3, 0.6] },
    { type: 'block', box: [154, 0, -4, 154.8, 1.4, -3.4], mat: 'metal' },
    { type: 'fuse', id: 'fuseV', path: [[150, 0.06, -3.0], [153.8, 0.06, -3.0], [153.8, 0.06, -3.7], [153.98, 0.06, -3.7], [153.98, 1.46, -3.7], [154.4, 1.46, -3.7]], rate: 1.8, regrow: 2.4, emit: 'fuseV' },
    // a dead-end spray tunnel on the north side: in and out while the valve is shut, for a glow-stone
    { type: 'block', box: [151.3, 0, 1.8, 155.8, 3.6, 2.2], mat: 'brick' },
    { type: 'block', box: [155.7, 0, 1.8, 156.1, 3.6, 5], mat: 'brick' },
    { type: 'sprinkler', id: 'sprayT', box: [151.7, 0, 2.2, 155.7, 3.2, 5], on: '!fuseV' },
    { type: 'shard', pos: [155, 0.7, 3.1] },
    // the curtain across the way on
    { type: 'sprinkler', id: 'curtain', box: [156.1, 0, -5, 157.7, 3.4, 5], on: '!fuseV' },
    { type: 'block', box: [156.1, 3.4, -5, 157.7, 3.8, 5], mat: 'metal' },
    { type: 'prop', kind: 'lamp', pos: [160, 0, -4.6] },
    { type: 'prop', kind: 'pots', pos: [165, 0, 3.9] },


    ]),
    // ======================================================== 5. The Boiler House
    ...at(22, [
    { type: 'brazier', id: 'b5', pos: [176, 0, 0] },
    { type: 'prop', kind: 'pipe', pos: [179, 0, -4.6], rot: 0 },
    { type: 'prop', kind: 'shelf', pos: [183, 0, 4.6], rot: 0 },
    { type: 'hint', key: 'boiler', box: [180, 0, -5, 187, 3, 5] },
    fl(166, 188),
    // the flooded works: two stones (the second under a double pipe), a dock, a raft that rides
    // through the rain of a pulsing spray, and the island with the boiler. The water is not
    // crossable until the boiler is lit: the last stretch of the flood is ten metres wide.
    ...pond(188, 236, -5, 5, 'flood', { on: '!boiler' }),
    stone(190.4, 192.8, -1.2, 1.2, 0),
    stone(195.6, 198, -0.5, 0.5, 0),
    ...pipe2('dA', 196.8, 2.2, 0.4),
    stone(200.8, 203.6, -1.6, 1.6, 0),
    { type: 'hint', key: 'raft', box: [199.8, 0, -5, 203.6, 5, 5] },
    { type: 'sensor', box: [204.4, -0.3, -1.6, 219.2, 4, 1.6], emit: 'onRaft', visible: false },
    { type: 'mover', id: 'raft', box: [204, -0.4, -1.6, 207, 0, 1.6], to: [12.6, 0, 0], speed: 1.9, mode: 'toggle', on: 'onRaft', mat: 'metal' },
    { type: 'sprinkler', id: 'pulsedB', box: [208, 0, -2.6, 210.4, 3.4, 2.6], period: 6, duty: 0.3, offset: 0 },
    { type: 'block', box: [208, 3.4, -2.8, 210.4, 3.8, 2.8], mat: 'metal' },
    { type: 'block', box: [219.9, -1.2, -2.6, 226, 0, 2.6], mat: 'cream' },
    { type: 'prop', kind: 'kiln', pos: [224.6, 0, 0], rot: 270, scale: 1.3 },
    { type: 'lantern', id: 'boiler', pos: [221.8, 0.95, 1.7], emit: 'boiler' },
    fl(236, 250),
    { type: 'block', box: [248, 0, -5, 248.5, 3.6, 5], mat: 'brick' },
    { type: 'prop', kind: 'lamp', pos: [239, 0, 4.6] },
    { type: 'exit', pos: [245.5, 0, 0], face: '-x', on: 'boiler' },

    ]),
  ],
};
