// Level 4 - "Slip Casting". Film, properly, and the chapter closes by asking for every form. Five areas:
//   1. The Mould Shelf    (teach)     low arches in a hall of plaster moulds: flatten to crawl under, stand up to hop a hurdle.
//   2. The Sieve Floor    (practise)  the floor is slats over a casting basin: film drops through, the basin runs under one
//                                     very tall wall and up a ramp. An optional casting pen has its own posts and shard.
//   3. The Posts          (twist)     lie across two posts to close a circuit: first behind a low wall to open a door, then
//                                     in two walled nooks at once (both circuits) to open the shutter.
//   4. The Glaze Tanks    (combine)   two slatted halls over tanks: dive in as film, close the posts in the middle tank to
//                                     open the shutter under the second wall, climb out by the ramp.
//   5. The Casting Hall   (payoff)    ice shoves a crate onto the heavy plate, film closes the last posts, the shutter
//                                     opens on the kiln chamber - and steam floats up to the kiln door on its ledge.
// Every wall is 12 m tall (a drop that jumps and boils climbs about 7.3 m, and may start from the 3.6 m nook walls) and runs the
// length of the level, so a cloud cannot skip a gate: steam only matters in the last chamber. All four forms are available. Layout runs along +X; see LEVELS.md.

const WT = 12;     // the tall walls: a drop that jumps and boils climbs ~7.3 m, and may start from a 3.6 m nook wall
const blk = (x0, y0, z0, x1, y1, z1, mat = 'tile') => ({ type: 'block', box: [x0, y0, z0, x1, y1, z1], mat });
/** The tall walls down both sides of a stretch of hall (floor top at y = 0 unless a different base is given). */
const sides = (x0, x1, y0 = -1) => [blk(x0, y0, -4.4, x1, WT, -4, 'brick'), blk(x0, y0, 4, x1, WT, 4.4, 'brick')];
/** A wall across the hall with an open doorway 3.2 m wide and 2.6 m tall. */
const doorway = (x0, x1) => [
  blk(x0, 0, -4.4, x1, WT, -1.6, 'brick'), blk(x0, 0, 1.6, x1, WT, 4.4, 'brick'), blk(x0, 2.6, -1.6, x1, WT, 1.6, 'brick'),
];
/** A wall across the hall with a 2.4 m wide, 3 m tall slot for a door. */
const doorWall = (x0, x1) => [
  blk(x0, 0, -4.4, x1, WT, -1.2, 'brick'), blk(x0, 0, 1.2, x1, WT, 4.4, 'brick'), blk(x0, 3, -1.2, x1, WT, 1.2, 'brick'),
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [-28.8, 0, 0],
  [-13.6, 0.9, 0],
  [15.6, -1.23, 0],
  [41.3, 0, -0.6],
  [51.3, 0, 0.7],
  [83.4, -1.6, 0],
  [110.5, 0, 0.6],
  [139.4, 9.8, 0],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l04',
  name: 'Slip Casting',
  chapter: 1,
  theme: 'slip',
  spawn: [-56, 0, 0],
  camYaw: -90,
  music: 'calm',
  areas: [
    { name: 'The Mould Shelf', box: [-65, -5, -4.5, 5] },
    { name: 'The Sieve Floor', box: [-4.5, -5, 20.6, 5] },
    { name: 'The Posts', box: [20.6, -5, 58.6, 5] },
    { name: 'The Glaze Tanks', box: [58.6, -5, 96, 5] },
    { name: 'The Casting Hall', box: [96, -5, 152, 5] },
  ],
  hints: {
    start: 'A slip room: moulds, pipes, tall walls. Film gets under things that a drop cannot.',
    arch: 'A wall with a low gap. {film} to flatten and crawl under, {liquid} to stand up again.',
    shelf: 'A plate under a low shelf. Film is thin enough to reach it; the shutter beyond will lift.',
    sieve: 'A slip room: moulds, pipes, one very tall wall. Look down through the slatted floor.',
    slot: 'Slats hold a drop up, but film slips between. {film}, then {liquid} to re-form below.',
    pen: 'Sealed in a casting pen? Lie flat across the two posts. Film closes a circuit.',
    spark: 'Film lying across two posts closes a circuit. Crawl under the wall and lie across them.',
    nooks: 'Two walled nooks, two circuits, one shutter. Both must be closed. Each can be done in either order.',
    tank: 'More slats, and the wall is shut tight. Dive in as film and close the posts in the middle tank.',
    gate: 'The shutter wants both: something heavy on the plate, something thin on the posts.',
    rise: 'The kiln door is high up. {steam} to rise onto a ledge, rest while the gauge refills, then rise again.',
  },
  signals: {
    doorO: { latch: 'pl0' },
    doorA: { latch: 'e1' },
    penDoor: { latch: 'e3' },
    nookA: { latch: 'e5' },
    nookB: { latch: 'e6' },
    nooksDone: { and: ['nookA', 'nookB'] },
    tankOpen: { latch: 'e4' },
    exitOpen: { and: ['hp', { latch: 'e2' }] },
  },
  pieces: [
    ...LAMPS,
    // ================================================================ 1. The Mould Shelf
    blk(-64, -1, -4, -4.5, 0, 4), blk(-64.5, 0, -4.4, -64, 0.8, 4.4, 'brick'), ...sides(-64, -4.5),
    blk(-4.5, -2.6, -4.4, -4, 0, 4.4, 'brick'),                          // west end of the casting basin, flush with the floor
    // two low arches; a plate under a low shelf (film presses it) lifts the shutter; a hurdle; a third arch
    blk(-44, 0.3, -4.4, -42.4, WT, 4.4, 'brick'),
    blk(-33, 0.3, -4.4, -29.4, WT, 4.4, 'brick'),
    blk(-26.5, 0.3, -4, -21.5, 1.4, -1.6, 'cream'),
    { type: 'plate', id: 'pl0', pos: [-24, 0, -3.0], size: [1.6, 1.6], emit: 'pl0' },
    ...doorWall(-18.4, -17.8),
    { type: 'door', id: 'doorO', box: [-18.35, 0, -1.2, -17.85, 3, 1.2], on: 'doorO' },
    blk(-15, 0, -4, -13.8, 0.9, 4, 'cream'),
    blk(-11, 0.3, -4.4, -9.4, WT, 4.4, 'brick'),
    ...doorway(-7, -6.6),
    // the easy shard: a stack of plaster moulds
    blk(-38, 0, -4, -36.4, 1.2, -2.4, 'cream'),
    { type: 'shard', pos: [-37.2, 1.95, -3.2] },
    { type: 'checkpoint', pos: [-52, 0, -0.8] },
    { type: 'prop', kind: 'kiln', pos: [-60, 0, -2.9], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [-58, 0, 3.4] },
    { type: 'prop', kind: 'pots', pos: [-52, 0, -2.8], scale: 0.9 },
    { type: 'prop', kind: 'shelf', pos: [-52, 0, 3.4], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [-46, 0, 3.4] },
    { type: 'prop', kind: 'pots', pos: [-40.4, 0, 2.6] },
    { type: 'prop', kind: 'shelf', pos: [-36, 0, 3.4], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [-34.4, 0, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [-27.6, 0, 3.4] },
    { type: 'prop', kind: 'kiln', pos: [-23.4, 0, 3.4], rot: 180 },
    { type: 'prop', kind: 'pots', pos: [-16.6, 0, -2.6], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [-16.2, 0, 3.4] },
    { type: 'prop', kind: 'pipe', pos: [-12.4, 0, -3.5], rot: 0 },
    { type: 'hint', key: 'arch', box: [-49, 0, -4, -44.6, 3, 4] },
    { type: 'hint', key: 'shelf', box: [-27.5, 0, -1.6, -20.5, 3, 4] },

    // ================================================================ 2. The Sieve Floor
    // The whole floor is slats over a casting basin (floor at y = -1.6).
    { type: 'slot', box: [-4, -0.4, -4, 13.4, 0, 4] },
    blk(-4, -2.6, -4, 14.6, -1.6, 4, 'dark'),                          // basin floor
    blk(-4.5, -1.6, -4.4, 20.6, WT, -4, 'brick'), blk(-4.5, -1.6, 4, 20.6, WT, 4.4, 'brick'),   // tall basin walls
    // the tall wall; the basin runs underneath it (1.2 m of headroom)
    blk(13.4, -0.4, -4.4, 14.6, WT, 4.4, 'brick'),
    { type: 'hint', key: 'sieve', box: [-3.6, 0, -4, 1.6, 3, 4] },
    { type: 'hint', key: 'slot', box: [4, 0, -4, 13, 3, 4] },
    // the way up on the far side of the wall
    { type: 'ramp', box: [14.6, -1.6, -4, 20.6, 0, 4], up: '+x', mat: 'cream' },
    { type: 'checkpoint', pos: [-2, 0, 0.8] },
    // dressing on the slats: moulds and pipes
    { type: 'prop', kind: 'shelf', pos: [-1.2, 0, 3.55], rot: 0 },
    { type: 'prop', kind: 'shelf', pos: [8.2, 0, 3.55], rot: 0 },
    { type: 'prop', kind: 'kiln', pos: [3.6, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'pots', pos: [-1, 0, -3.0] },
    { type: 'prop', kind: 'lamp', pos: [12.5, 0, 3.4] },
    // the basin below: lamps, pipes, a spill of pots
    { type: 'prop', kind: 'lamp', pos: [7.6, -1.6, 3.4] },
    { type: 'prop', kind: 'pipe', pos: [10.6, -1.6, 3.55], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [8.6, -1.6, -3.0] },
    { type: 'prop', kind: 'lamp', pos: [12.6, -1.6, -3.5] },
    // optional casting pen: brick rim flush with the floor, slats inside, door in the east wall
    blk(2.0, -1.6, -4.0, 2.4, 0, -0.6, 'brick'),
    blk(2.0, -1.6, -1.0, 5.4, 0, -0.6, 'brick'),
    blk(5.0, -1.6, -4.0, 5.4, 0, -3.4, 'brick'),
    blk(5.0, -1.6, -1.6, 5.4, 0, -1.0, 'brick'),
    { type: 'door', id: 'penDoor', box: [5.0, -1.6, -3.4, 5.4, 0, -1.6], on: 'penDoor' },
    { type: 'hint', key: 'pen', box: [2.4, -1.6, -4.0, 5.0, -0.9, -1.0] },
    { type: 'electrodes', id: 'e3', box: [3.1, -1.6, -2.6, 4.5, -1.2, -1.4], axis: 'x', emit: 'e3' },
    { type: 'shard', pos: [3.0, -0.9, -3.35] },

    // ================================================================ 3. The Posts
    // hall B: a low wall hides a pair of posts; lying across them throws the latch on the next door
    blk(20.6, -2.6, -4, 58.6, 0, 4, 'tile'), ...sides(20.6, 58.6),
    { type: 'checkpoint', pos: [22.4, 0, 0] },
    { type: 'prop', kind: 'kiln', pos: [24.6, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'lamp', pos: [21.4, 0, -3.5] },
    { type: 'prop', kind: 'pipe', pos: [24.4, 0, -3.5], rot: 0 },
    { type: 'hint', key: 'spark', box: [23.6, 0, -4, 26.5, 3, 4] },
    blk(27, 0.3, -4.4, 28.6, WT, 4.4, 'brick'),
    { type: 'electrodes', id: 'e1', box: [30.4, 0, -0.7, 31.8, 0.4, 0.7], axis: 'x', emit: 'e1' },
    { type: 'prop', kind: 'pots', pos: [32.4, 0, -3.1], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [29.8, 0, 3.4] },
    ...doorWall(35, 35.6),
    { type: 'door', id: 'doorA', box: [35.05, 0, -1.2, 35.55, 3, 1.2], on: 'doorA' },
    // two walled nooks off a corridor, each with a pair of posts; the shutter wants both circuits
    blk(39, 0, -4, 39.4, 3.6, -1.6, 'dark'), blk(44.6, 0, -4, 45, 3.6, -1.6, 'dark'), blk(39, 0.3, -3, 45, 3.6, -1.6, 'dark'),
    { type: 'electrodes', id: 'e5', box: [41.3, 0, -3.9, 42.7, 0.4, -3.1], axis: 'x', emit: 'e5' },
    blk(47, 0, 1.6, 47.4, 3.6, 4, 'cream'), blk(52.6, 0, 1.6, 53, 3.6, 4, 'cream'), blk(47, 0.3, 1.6, 53, 3.6, 3, 'cream'),
    { type: 'electrodes', id: 'e6', box: [49.3, 0, 3.1, 50.7, 0.4, 3.9], axis: 'x', emit: 'e6' },
    { type: 'hint', key: 'nooks', box: [36, 0, -1.6, 39, 3, 1.6] },
    { type: 'prop', kind: 'lamp', pos: [37.4, 0, -3.5] },
    { type: 'prop', kind: 'pots', pos: [37.4, 0, 3.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [46, 0, 3.5] },
    { type: 'prop', kind: 'kiln', pos: [49.8, 0, -3.0], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [55, 0, -3.5] },
    ...doorWall(58, 58.6),
    { type: 'door', id: 'doorN', box: [58.05, 0, -1.2, 58.55, 3, 1.2], on: 'nooksDone' },

    // ================================================================ 4. The Glaze Tanks
    // three tanks under slatted halls, walls between them; the basin runs under the first wall, a shutter closes the second
    { type: 'slot', box: [58.6, -0.4, -4, 70, 0, 4] }, { type: 'slot', box: [71.2, -0.4, -4, 80, 0, 4] }, { type: 'slot', box: [81.2, -0.4, -4, 90, 0, 4] },
    blk(58.6, -2.6, -4, 96, -1.6, 4, 'dark'),
    blk(58.6, -2.6, -4.4, 96, WT, -4, 'brick'), blk(58.6, -2.6, 4, 96, WT, 4.4, 'brick'),
    blk(70, -0.4, -4.4, 71.2, WT, 4.4, 'brick'),
    blk(80, -0.4, -4.4, 81.2, WT, 4.4, 'brick'),
    { type: 'door', id: 'doorT', box: [80.3, -1.6, -4, 80.9, -0.4, 4], on: 'tankOpen', slide: 'down' },
    { type: 'electrodes', id: 'e4', box: [74.9, -1.6, -0.7, 76.3, -1.2, 0.7], axis: 'x', emit: 'e4' },
    { type: 'ramp', box: [90, -1.6, -4, 96, 0, 4], up: '+x', mat: 'cream' },
    { type: 'checkpoint', pos: [60.6, 0, 0] },
    { type: 'hint', key: 'tank', box: [59, 0, -4, 66, 3, 4] },
    { type: 'prop', kind: 'lamp', pos: [62, 0, 3.4] },
    { type: 'prop', kind: 'kiln', pos: [66, 0, -2.9], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [68.6, 0, 3.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [65, -1.6, 3.4] },
    { type: 'prop', kind: 'pots', pos: [62.6, -1.6, -3.0] },
    { type: 'prop', kind: 'lamp', pos: [73, -1.6, -3.4] },
    { type: 'prop', kind: 'pipe', pos: [77.5, -1.6, 3.5], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [78.6, -1.6, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [84, -1.6, 3.4] },
    { type: 'prop', kind: 'pots', pos: [87, -1.6, -3.0] },

    // ================================================================ 5. The Casting Hall
    blk(96, -1, -4, 152, 0, 4, 'tile'), ...sides(96, 138), blk(138, -1, -4.4, 152, 14, -4, 'brick'), blk(138, -1, 4, 152, 14, 4.4, 'brick'),
    { type: 'checkpoint', pos: [99, 0, 0.8] },
    { type: 'prop', kind: 'kiln', pos: [97.8, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'lamp', pos: [103.6, 0, 3.5], solid: false },
    { type: 'hint', key: 'gate', box: [96.4, 0, -4, 99.4, 3, 1] },
    { type: 'crate', id: 'crate', pos: [100.9, 0, -1.5] },
    { type: 'plate', id: 'hp', pos: [107.9, 0, 2.0], size: [1.7, 1.7], heavy: true, emit: 'hp' },
    // off the path: a shelf only film fits under
    blk(103.4, 0.3, -4, 106.8, 1.2, -2.6, 'cream'),
    { type: 'shard', pos: [105.1, 0.2, -3.3] },
    { type: 'prop', kind: 'pots', pos: [105, 1.2, -3.4], scale: 0.9 },
    // low wall, then the last pair of posts
    blk(113.4, 0.3, -4.4, 115, WT, 4.4, 'brick'),
    { type: 'electrodes', id: 'e2', box: [116.8, 0, -0.7, 118.2, 0.4, 0.7], axis: 'x', emit: 'e2' },
    { type: 'prop', kind: 'lamp', pos: [119, 0, -3.6] },
    { type: 'prop', kind: 'pots', pos: [116.4, 0, 3.0], scale: 0.9 },
    // the shutter, and beyond it the kiln chamber: the door is up on a ledge only a cloud reaches
    ...doorWall(123, 123.6),
    { type: 'door', id: 'doorK', box: [123.05, 0, -1.2, 123.55, 3, 1.2], on: 'exitOpen' },
    blk(128, -1, -4, 133, 3, 4, 'cream'), blk(133, -1, -4, 138, 6.4, 4, 'cream'), blk(138, -1, -4, 152, 9.8, 4, 'cream'),
    blk(151.4, 9.8, -4.4, 152, 14, 4.4, 'brick'),
    { type: 'checkpoint', pos: [125.4, 0, 0.8] },
    { type: 'hint', key: 'rise', box: [124, 0, -4, 130, 3, 4] },
    { type: 'prop', kind: 'lamp', pos: [126, 0, -3.5] },
    { type: 'prop', kind: 'lamp', pos: [127, 0, 3.5] },
    { type: 'prop', kind: 'lamp', pos: [129.4, 3, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [129.4, 3, 3.4] },
    { type: 'prop', kind: 'lamp', pos: [134.4, 6.4, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [134.4, 6.4, 3.4] },
    { type: 'prop', kind: 'lamp', pos: [141, 9.8, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [141, 9.8, 3.4] },
    { type: 'prop', kind: 'lamp', pos: [148, 9.8, -3.4] },
    { type: 'exit', pos: [147.4, 9.8, 0], face: '-x' },
  ],
};
