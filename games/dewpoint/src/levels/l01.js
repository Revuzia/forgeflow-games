// Level 1 - "First Drip". Chapter 1 opens in the slip room, a gentle tutorial that is a journey:
//   1. The Drip Tray      (teach)     move, jump, the camera: two hurdles, a stack of slabs up to a kiln-fire gap, a plinth with a shard.
//   2. The Plate Gallery  (practise)  climb two big steps onto a gallery, hop its gap, stand on a plate: a door wakes up.
//   3. The Squeeze        (twist)     the first taste of another form: film slips under a low wall, into a walled cell to reach a plate, and under a shelf.
//   4. The Quick Door     (combine)   a plate that holds the far door only for a while: hop three islands, flatten under a wall, run.
//   5. The Kiln Steps     (payoff)    three big steps up to a porch; a plate there opens the kiln door. A pillar holds the last shard.
// Forms: liquid and film only. Layout runs along +X; see LEVELS.md for the format.

const blk = (x0, y0, z0, x1, y1, z1, mat = 'tile') => ({ type: 'block', box: [x0, y0, z0, x1, y1, z1], mat });
// parapets along the corridor: 1.9 m, too high for a hop (a jump tops out at 1.65 m), so nobody leaves the level by accident
const rails = (x0, x1) => [blk(x0, 0, -6.4, x1, 1.9, -6, 'brick'), blk(x0, 0, 6, x1, 1.9, 6.4, 'brick')];
/** The same parapets on a raised stretch whose top is at `top`. */
const topRails = (x0, x1, top) => [blk(x0, 0, -6.4, x1, top + 1.9, -6, 'brick'), blk(x0, 0, 6, x1, top + 1.9, 6.4, 'brick')];
/** A wall across the room (x0..x1 thick) with an open doorway 3.2 m wide and 2.6 m tall. */
const doorway = (x0, x1, mat = 'brick') => [
  blk(x0, 0, -6.4, x1, 3.6, -1.6, mat), blk(x0, 0, 1.6, x1, 3.6, 6.4, mat), blk(x0, 2.6, -1.6, x1, 3.6, 1.6, mat),
];
/** A wall across the room with a 2.4 m wide, 3 m tall slot for a door. */
const doorWall = (x0, x1) => [
  blk(x0, 0, -6.4, x1, 3.6, -1.2, 'brick'), blk(x0, 0, 1.2, x1, 3.6, 6.4, 'brick'), blk(x0, 3, -1.2, x1, 3.6, 1.2, 'brick'),
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [100.9, 0, -0.3],
  [181.1, 3.6, 0],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l01',
  name: 'First Drip',
  chapter: 1,
  theme: 'slip',
  spawn: [-30, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['liquid', 'film'],
  areas: [
    { name: 'The Drip Tray', box: [-39, -7, 40, 7] },
    { name: 'The Plate Gallery', box: [40, -7, 80, 7] },
    { name: 'The Squeeze', box: [80, -7, 125, 7] },
    { name: 'The Quick Door', box: [125, -7, 162, 7] },
    { name: 'The Kiln Steps', box: [162, -7, 221, 7] },
  ],
  hints: {
    start: 'Move with {move}. Jump with {jump}; hold it to jump higher.',
    gap: 'Kiln fire glows far below. Take a run-up, jump, and land on the far side.',
    climb: 'Too tall for one hop? Climb the big steps: hold {jump} for the highest jump.',
    plate: 'A glowing floor plate. Stand on it and see what wakes up.',
    film: 'Too low to squeeze under? {film} to flatten, {liquid} to gather back into a drop.',
    timer: 'This plate holds the far door only for a while. Hurry, and flatten on the way.',
    cell: 'A plate in a walled cell, with only a low gap to reach it. Flatten, press it, then crawl back out.',
    steps: 'The kiln door waits at the top of the steps. Anything glittering is worth a detour.',
    porch: 'The kiln door is shuttered. The plate on the porch should wake it.',
  },
  signals: {
    doorA: { latch: 'p1' },
    doorB: { hold: 'p2', for: 16 },
    doorC: { latch: 'p3' },
    kilnOpen: { latch: 'pe' },
  },
  pieces: [
    ...LAMPS,
    // ================================================================ 1. The Drip Tray
    blk(-38, -1, -6, 25, 0, 6), blk(27.6, -1, -6, 40, 0, 6),
    blk(-38.5, 0, -6.4, -38, 0.8, 6.4, 'brick'), ...rails(-38, 25), ...rails(27.6, 40),
    // a gentle ramp up to a landing, then a small drop: ramps are walkable, edges are not dangerous
    { type: 'ramp', box: [-15.5, 0, -6, -10.5, 0.9, 6], up: '+x', mat: 'cream' },
    blk(-10.5, 0, -6, -8, 0.9, 6, 'cream'),
    blk(-15.5, 0.7, -6.4, -8, 1.0, -6, 'brick'), blk(-15.5, 0.7, 6, -8, 1.0, 6.4, 'brick'),
    // three slabs up to a ledge, then the first gap with kiln fire far below
    blk(18.4, 0, -6, 20, 0.45, 6, 'cream'), blk(20, 0, -6, 21.6, 0.9, 6, 'cream'), blk(21.6, 0, -6, 25, 1.35, 6, 'cream'),
    { type: 'fire', box: [25, -6, -6, 27.6, -4.5, 6] },
    blk(25, -7, -6, 27.6, -6, 6, 'dark'),
    // two hurdles to hop
    blk(9, 0, -6, 10, 0.5, 6, 'cream'),
    blk(15.5, 0, -6, 16.7, 0.9, 6, 'cream'),
    // plinth with the easy shard
    blk(31, 0, -6, 32.6, 1.2, -3, 'cream'),
    { type: 'shard', pos: [31.8, 1.95, -4.4] },
    { type: 'checkpoint', pos: [-27.5, 0, 1] },
    // (more lamp posts along the way: a fall at a fire gap costs seconds, not a long walk back)
    { type: 'checkpoint', pos: [-9.2, 0.9, 0] },
    { type: 'checkpoint', pos: [6.5, 0, 0] },
    { type: 'checkpoint', pos: [17, 0, 0] },
    { type: 'checkpoint', pos: [30, 0, 0] },
    { type: 'checkpoint', pos: [52, 2.4, -4.5] },
    { type: 'checkpoint', pos: [62.3, 3.6, -4.5] },
    { type: 'checkpoint', pos: [75, 0, -1.2] },
    { type: 'checkpoint', pos: [108.8, 0, 0] },
    { type: 'checkpoint', pos: [151.8, 0, 0] },
    { type: 'checkpoint', pos: [186.5, 3.6, 0] },
    { type: 'checkpoint', pos: [196, 3.6, 0] },
    // a slalom of kilns to steer round
    { type: 'prop', kind: 'kiln', pos: [-22.5, 0, -0.6], rot: 0 },
    { type: 'prop', kind: 'kiln', pos: [-18.5, 0, 1.1], rot: 180 },
    { type: 'prop', kind: 'pots', pos: [-29, 0, 3.6] },
    { type: 'prop', kind: 'lamp', pos: [-35, 0, -5.2] },
    { type: 'prop', kind: 'kiln', pos: [-34, 0, 3.9], rot: 180 },
    { type: 'prop', kind: 'lamp', pos: [-12, 0, -5.2] },
    { type: 'prop', kind: 'kiln', pos: [-3.6, 0, 1.2], rot: 180 },
    { type: 'prop', kind: 'pots', pos: [3, 0, 3.4] },
    { type: 'prop', kind: 'kiln', pos: [4.4, 0, -4.2], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [7, 0, 5.2] },
    { type: 'prop', kind: 'lamp', pos: [12.5, 0, 5.2] },
    { type: 'prop', kind: 'lamp', pos: [18, 0, -5.2] },
    { type: 'prop', kind: 'shelf', pos: [30, 0, 5.2], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [34, 0, 4] },
    { type: 'prop', kind: 'kiln', pos: [36, 0, -4.3], rot: 0 },
    { type: 'hint', key: 'gap', box: [17, 0, -6, 18.3, 3, 6] },
    ...doorway(39.5, 40),

    // ================================================================ 2. The Plate Gallery
    blk(40, -1, -6, 80.4, 0, 6, 'tile'), ...rails(40, 43.8), blk(40, 0, 6, 80, 0.7, 6.4, 'brick'),
    // two big steps, then the gallery along the north wall: a gap, then one more big step up to the plate
    blk(43.8, 0, -6.4, 46.2, 1.2, -2.6, 'cream'),
    blk(46.2, 0, -6.4, 54, 2.4, -2.6, 'cream'),
    blk(55.8, 0, -6.4, 61, 2.4, -2.6, 'cream'),
    blk(61, 0, -6.4, 63.8, 3.6, -2.6, 'cream'), blk(65.6, 0, -6.4, 70.4, 3.6, -2.6, 'cream'),
    blk(43.8, 0, -6.8, 46.2, 3.1, -6.4, 'brick'), blk(46.2, 0, -6.8, 61, 4.3, -6.4, 'brick'), blk(61, 0, -6.8, 70.4, 5.5, -6.4, 'brick'),
    blk(46.2, 2.4, -2.9, 54, 3.0, -2.6, 'brick'),
    blk(55.8, 2.4, -2.9, 61, 3.0, -2.6, 'brick'),
    blk(61, 3.6, -2.9, 63.8, 4.2, -2.6, 'brick'), blk(65.6, 3.6, -2.9, 70.4, 4.2, -2.6, 'brick'),
    { type: 'plate', id: 'p1', pos: [68.6, 3.6, -4.5], size: [1.6, 1.6], emit: 'p1' },
    ...doorWall(78, 78.5),
    { type: 'door', id: 'doorA', box: [78.05, 0, -1.2, 78.45, 3, 1.2], on: 'doorA' },
    { type: 'checkpoint', pos: [41.8, 0, -0.8] },
    { type: 'prop', kind: 'kiln', pos: [50, 0, 4.3], rot: 180 },
    { type: 'prop', kind: 'pots', pos: [60, 0, 4.2] },
    { type: 'prop', kind: 'lamp', pos: [66, 0, 3.8] },
    { type: 'prop', kind: 'lamp', pos: [44.6, 0, 4.6] },
    { type: 'prop', kind: 'shelf', pos: [73, 0, 5.1], rot: 0 },
    { type: 'hint', key: 'climb', box: [41, 0, -6, 43.6, 3, 6] },
    { type: 'hint', key: 'plate', box: [62, 3.6, -6.4, 70, 7, -2.6] },

    // ================================================================ 3. The Squeeze
    blk(80, -1, -6, 126, 0, 6), ...rails(80, 126),
    blk(88, 0.3, -6.4, 93.5, 3.6, 6.4, 'brick'),
    // a shelf only film fits under, with a shard beneath it
    blk(94, 0.3, 2.6, 98.4, 1.2, 6, 'cream'),
    { type: 'shard', pos: [96.2, 0.2, 4.3] },
    { type: 'prop', kind: 'pots', pos: [96, 1.2, 4.6], scale: 0.9 },
    // a walled cell off the path: a low gap in its front wall, a plate inside
    blk(99, 0, -6.4, 99.4, 2.6, -1.8, 'brick'), blk(106.6, 0, -6.4, 107, 2.6, -1.8, 'brick'),
    blk(99, 0.3, -3, 107, 2.6, -1.8, 'brick'), blk(99, 2.6, -6.4, 107, 2.9, -1.8, 'brick'),
    { type: 'plate', id: 'p3', pos: [103, 0, -5.0], size: [1.6, 1.6], emit: 'p3' },
    { type: 'prop', kind: 'lamp', pos: [100.2, 0, -5.4] },
    // door C, held shut until the cell's plate is pressed; a big step right behind it
    ...doorWall(112, 112.5),
    { type: 'door', id: 'doorC', box: [112.05, 0, -1.2, 112.45, 3, 1.2], on: 'doorC' },
    blk(116.4, 0, -6, 119, 1.2, 6, 'cream'), blk(119, 0, -6, 121.6, 2.4, 6, 'cream'),
    { type: 'checkpoint', pos: [82, 0, -0.8] },
    { type: 'prop', kind: 'lamp', pos: [84, 0, -5] },
    { type: 'prop', kind: 'pots', pos: [85.5, 0, 4.5] },
    { type: 'prop', kind: 'kiln', pos: [96.4, 0, -4.2], rot: 0 },
    { type: 'prop', kind: 'pipe', pos: [103, 0, 5.3], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [109.5, 0, 5.2] },
    { type: 'prop', kind: 'pots', pos: [117.2, 1.2, -4.6], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [123, 0, -5.2] },
    { type: 'hint', key: 'film', box: [83, 0, -6, 86.6, 3, 6] },
    { type: 'hint', key: 'cell', box: [100, 0, -1.8, 107, 3, 6] },
    ...doorway(124.6, 125.1),

    // ================================================================ 4. The Quick Door
    blk(125, -1, -6, 134, 0, 6), ...rails(125, 134),
    // three islands over a trough of kiln fire (1.8 m between them)
    { type: 'fire', box: [134, -6, -6, 150, -4.5, 6] },
    blk(134, -7, -6, 150, -6, 6, 'dark'),
    blk(135.8, -1, -6, 138.7, 0, 6, 'cream'), blk(140.5, -1, -6, 143.5, 0, 6, 'cream'), blk(145.3, -1, -6, 148.2, 0, 6, 'cream'),
    blk(150, -1, -6, 162.5, 0, 6), ...rails(150, 162),
    blk(153, 0.3, -6.4, 156.6, 3.6, 6.4, 'brick'),
    ...doorWall(161, 161.5),
    { type: 'door', id: 'doorB', box: [161.05, 0, -1.2, 161.45, 3, 1.2], on: 'doorB' },
    { type: 'plate', id: 'p2', pos: [131.6, 0, -3.2], size: [1.6, 1.6], emit: 'p2' },
    { type: 'checkpoint', pos: [127, 0, -0.8] },
    { type: 'prop', kind: 'lamp', pos: [129, 0, 5] },
    { type: 'prop', kind: 'kiln', pos: [128.6, 0, -4.2], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [151.5, 0, 4.4] },
    { type: 'prop', kind: 'lamp', pos: [158, 0, -5.2] },
    { type: 'hint', key: 'timer', box: [129.5, 0, -6, 134, 3, 6] },

    // ================================================================ 5. The Kiln Steps
    blk(162.5, -1, -6, 172, 0, 6), ...rails(162.5, 172),
    blk(172, 0, -6, 176, 1.2, 6, 'cream'),
    blk(176, 0, -6, 180, 2.4, 6, 'cream'),
    blk(180, 0, -6, 184, 3.6, 6, 'cream'),
    blk(184, 0, -6, 203, 3.6, 6, 'tile'), blk(204.8, 0, -6, 220, 3.6, 6, 'tile'),
    ...topRails(172, 176, 1.2), ...topRails(176, 180, 2.4), ...topRails(180, 184, 3.6), ...topRails(184, 203, 3.6), ...topRails(204.8, 218.4, 3.6),
    // the last leap, over kiln fire, to the kiln door
    { type: 'fire', box: [203, -2.4, -6, 204.8, -0.9, 6] },
    blk(203, -3.4, -6, 204.8, -2.4, 6, 'dark'),
    blk(181, 3.6, -6, 184, 4.8, -3.4, 'cream'),
    { type: 'shard', pos: [182.5, 5.55, -4.7] },
    { type: 'plate', id: 'pe', pos: [188.6, 3.6, 0], size: [1.8, 1.8], emit: 'pe' },
    blk(218.4, 3.6, -6.4, 219, 7.2, 6.4, 'brick'),
    { type: 'checkpoint', pos: [164.5, 0, -0.8] },
    { type: 'prop', kind: 'lamp', pos: [174, 1.2, 5.2] },
    { type: 'prop', kind: 'lamp', pos: [178, 2.4, 5.2] },
    { type: 'prop', kind: 'lamp', pos: [182, 3.6, 5.2] },
    { type: 'prop', kind: 'lamp', pos: [194.5, 3.6, -5] },
    { type: 'prop', kind: 'lamp', pos: [194.5, 3.6, 5] },
    { type: 'prop', kind: 'lamp', pos: [199, 3.6, -5] },
    { type: 'prop', kind: 'lamp', pos: [199, 3.6, 5] },
    { type: 'prop', kind: 'lamp', pos: [213, 3.6, -4.5] },
    { type: 'prop', kind: 'lamp', pos: [213, 3.6, 4.5] },
    { type: 'prop', kind: 'pots', pos: [166, 0, -4.4] },
    { type: 'prop', kind: 'kiln', pos: [168, 0, 4.4], rot: 180 },
    { type: 'hint', key: 'steps', box: [168, 0, -6, 172, 3, 6] },
    { type: 'hint', key: 'porch', box: [186, 3.6, -6, 193, 7, 6] },
    { type: 'exit', pos: [216, 3.6, 0], face: '-x', on: 'kilnOpen' },
  ],
};
