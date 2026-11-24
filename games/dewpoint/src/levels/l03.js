// Level 3 - "Head of Steam". Steam: it rises, it runs on a gauge, it slips through grates, it rides fans and
// updrafts, and cold air turns it back to water. The works climb as you go. Five areas, one idea each:
//   1. The Boiler Floor  (teach)    two ledges only a cloud can climb; the gauge refills while you stand on solid ground.
//   2. The Grille Wall   (practise) a drop cannot fit through a grate, a cloud can: a low window, then a ledge and a high window.
//   3. The Great Fan     (twist)    a gap steam can drift across, then a chasm it cannot: the big fan carries it, cold air lands it.
//   4. The Condenser     (combine)  a plate starts a shaft fan; a film nook, a shard beside the updraft, and a cold ceiling to land under.
//   5. The Flue Top      (payoff)   a plate on the gallery starts a roaring gale: ride it across the whole works to the kiln door.
// Walls and cliffs that gate a cloud are higher than a drop can reach by jumping and then boiling (about 7.3 m on a full gauge,
// from whatever it can stand on) and the grate walls run the length of the hall, so a cloud cannot skip a gate. All four forms are available. Layout runs along +X; see LEVELS.md for the format.

const blk = (x0, y0, z0, x1, y1, z1, mat = 'tile') => ({ type: 'block', box: [x0, y0, z0, x1, y1, z1], mat });

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [-2, 0, -0.3],
  [15.5, 2.2, 0],
  [47.1, 7.4, 0],
  [144, 18.4, -0.1],
  [155.1, 27.6, 0.1],
  [159.7, 27.6, 3.6],
  [177.2, 27.6, 0.1],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l03',
  name: 'Head of Steam',
  chapter: 1,
  theme: 'slip',
  spawn: [-23, 0, 0],
  camYaw: -90,
  music: 'calm',
  areas: [
    { name: 'The Boiler Floor', box: [-32, -7, 30, 7] },
    { name: 'The Grille Wall', box: [30, -7, 64, 7] },
    { name: 'The Great Fan', box: [64, -7, 126, 7] },
    { name: 'The Condenser', box: [126, -7, 154, 7] },
    { name: 'The Flue Top', box: [154, -7, 231, 7] },
  ],
  hints: {
    start: '{steam} to boil. Steam drifts up until its gauge runs dry. {liquid} to rain down.',
    gauge: 'The gauge refills while you stand on solid ground. Wait for it, then rise again.',
    grate: 'A drop cannot fit through a grate. A cloud can.',
    drift: 'Too wide to jump. Float across as steam, then {liquid} above the far side to land.',
    fan: 'Too far to drift. The big fan carries whatever is light enough; as a drop, stay out of it.',
    cold: 'Cold air turns steam straight back into water.',
    nook: 'The plate is in a walled nook with only a low gap. Film fits through it.',
    updraft: 'The shaft fan is off. Find the plate that starts it, then ride it up as steam.',
    cell: 'The plate is behind iron bars. Float in as steam, then {liquid} to rain down onto it.',
    gale: 'The plate woke the great fan across the works. Steam rides it all the way to the kiln.',
  },
  signals: {
    shaftOn: { latch: 'p3' },
    shaft2On: { latch: 'p5' },
    galeOn: { latch: 'p4' },
  },
  pieces: [
    ...LAMPS,
    // ================================================================ 1. The Boiler Floor
    blk(-31, -1, -6, 10, 0, 6), blk(-31.5, 0, -6, -31, 0.8, 6, 'brick'),
    blk(10, -1, -6, 18, 2.2, 6, 'cream'),                 // ledge 1: 2.2 m, too high to jump
    blk(18, -1, -6, 46, 5, 6, 'tile'),                    // ledge 2: 2.8 m above ledge 1
    { type: 'shard', pos: [13.5, 2.95, -4.5] },
    { type: 'checkpoint', pos: [-21, 0, -0.8] },
    { type: 'checkpoint', pos: [31.5, 5, -0.8] },
    { type: 'prop', kind: 'kiln', pos: [2, 0, -4], rot: 0 },
    { type: 'prop', kind: 'kiln', pos: [-19, 0, -4], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [-27, 0, 4.8] },
    { type: 'prop', kind: 'pots', pos: [-27, 0, -3.8], scale: 0.9 },
    { type: 'prop', kind: 'pipe', pos: [-14, 0, 5.2], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [-11, 0, 4.8] },
    { type: 'prop', kind: 'pipe', pos: [-8, 0, -5.2], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [-18, 0, 3.6] },
    { type: 'prop', kind: 'pots', pos: [-3.5, 0, 3.6] },
    { type: 'prop', kind: 'lamp', pos: [6.4, 0, 4.6] },
    { type: 'prop', kind: 'pipe', pos: [6, 0, -5.2], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [11, 2.2, 5] },
    { type: 'prop', kind: 'pots', pos: [16, 2.2, 4.4], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [20, 5, -5] },
    { type: 'prop', kind: 'kiln', pos: [24.5, 5, 4.2], rot: 180 },
    { type: 'prop', kind: 'pipe', pos: [27, 5, -5.2], rot: 0 },
    { type: 'hint', key: 'gauge', box: [10, 2.2, -6, 18, 7, 6] },

    // ================================================================ 2. The Grille Wall
    // tall walls down both sides of the hall, so a cloud cannot fly round the gates
    blk(18, 5, -6.4, 58, 19, -6, 'metal'), blk(18, 5, 6, 58, 19, 6.4, 'metal'),
    // gate 1: a low window in an iron wall
    blk(40, 5, -6.4, 40.4, 19, -1.6, 'metal'), blk(40, 5, 1.6, 40.4, 19, 6.4, 'metal'), blk(40, 7.6, -1.6, 40.4, 19, 1.6, 'metal'),
    { type: 'grate', box: [40.05, 5, -1.6, 40.35, 7.6, 1.6] },
    { type: 'hint', key: 'grate', box: [33.5, 5, -6, 39.6, 9, 6] },
    // a ledge, and gate 2 on top of it: a window with a sill
    blk(46, -1, -6, 74, 7.4, 6, 'cream'),
    blk(56, 7.4, -6.4, 56.4, 19, -1.6, 'metal'), blk(56, 7.4, 1.6, 56.4, 19, 6.4, 'metal'),
    blk(56, 12.2, -1.6, 56.4, 19, 1.6, 'metal'), blk(56, 7.4, -1.6, 56.4, 9.6, 1.6, 'metal'),
    { type: 'grate', box: [56.05, 9.6, -1.6, 56.35, 12.2, 1.6] },
    { type: 'checkpoint', pos: [65.5, 7.4, -0.8] },
    { type: 'prop', kind: 'lamp', pos: [34, 5, 4.8] },
    { type: 'prop', kind: 'pots', pos: [36.4, 5, -4] },
    { type: 'prop', kind: 'lamp', pos: [43, 5, -5] },
    { type: 'prop', kind: 'pipe', pos: [43, 5, 5.2], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [49, 7.4, 5] },
    { type: 'prop', kind: 'kiln', pos: [52, 7.4, -4.2], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [60, 7.4, -5] },
    { type: 'prop', kind: 'pots', pos: [60.5, 7.4, 4.1] },

    // ================================================================ 3. The Great Fan
    // two gaps and an islet between them: steam drifts across each, and the islet is where the gauge refills
    blk(83, -1, -6, 89, 7.4, 6, 'cream'),
    blk(98, -1, -6, 108, 7.4, 6, 'cream'),
    { type: 'hint', key: 'drift', box: [66, 7.4, -6, 73, 11, 6] },
    { type: 'checkpoint', pos: [86, 7.4, -0.8] },
    { type: 'checkpoint', pos: [100, 7.4, -0.8] },
    { type: 'prop', kind: 'lamp', pos: [68, 7.4, -5] },
    { type: 'prop', kind: 'pots', pos: [70, 7.4, 4.4] },
    { type: 'prop', kind: 'lamp', pos: [84, 7.4, 5] },
    { type: 'prop', kind: 'kiln', pos: [102.5, 7.4, -4.2], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [106, 7.4, 5] },
    // the chasm: the big fan carries a cloud across, cold air brings it down on the far platform
    { type: 'hint', key: 'fan', box: [102, 7.4, -6, 107.5, 10, 6] },
    { type: 'fan', id: 'big', box: [108.5, 8.4, -3, 126, 12, 3], dir: '+x', strength: 8 },
    blk(126, -1, -6, 142, 7.4, 6, 'tile'),
    { type: 'cold', box: [127, 7.4, -6, 130.5, 19, 6] },
    { type: 'hint', key: 'cold', box: [130.6, 7.4, -6, 134, 10, 6] },

    // ================================================================ 4. The Condenser
    { type: 'checkpoint', pos: [132, 7.4, -0.8] },
    // a shelf only film fits under, with a shard beneath it
    blk(135, 7.7, 2.5, 138, 8.8, 4, 'cream'),
    { type: 'shard', pos: [136.5, 7.6, 3.3] },
    // plate 1 starts the first shaft; it lifts to a ledge, where cold air brings you down
    { type: 'plate', id: 'p3', pos: [136.5, 7.4, -4.7], size: [1.6, 1.6], emit: 'p3' },
    blk(134, 7.7, -3.2, 139, 9.8, -2.4, 'brick'), blk(134, 7.4, -6.4, 134.4, 9.8, -2.4, 'brick'),
    blk(138.6, 7.4, -6.4, 139, 9.8, -2.4, 'brick'), blk(134, 7.4, -6.4, 139, 9.8, -6, 'brick'),
    { type: 'hint', key: 'nook', box: [133.4, 7.4, -2.4, 139.6, 10, 2] },
    { type: 'hint', key: 'updraft', box: [139.6, 7.4, -6, 142, 10, 2] },
    { type: 'fan', id: 'shaft', box: [139.4, 7.4, -1.5, 142, 21, 1.5], dir: '+y', strength: 7, on: 'shaftOn' },
    blk(142, -1, -6, 153, 18.4, 6, 'brick'),
    { type: 'cold', box: [142.5, 18.4, -6, 146, 29, 6] },
    // plate 2, on the ledge, starts the second shaft up to the gallery
    { type: 'plate', id: 'p5', pos: [147.5, 18.4, -2.6], size: [1.6, 1.6], emit: 'p5' },
    { type: 'fan', id: 'shaft2', box: [150.4, 18.4, -1.5, 153, 31, 1.5], dir: '+y', strength: 7, on: 'shaft2On' },
    blk(153, -1, -6, 178, 27.6, 6, 'brick'),
    { type: 'shard', pos: [151.2, 21.8, -3.3] },
    { type: 'cold', box: [153.5, 27.6, -6, 157, 39, 6] },
    { type: 'prop', kind: 'lamp', pos: [128, 7.4, 5] },
    { type: 'prop', kind: 'pots', pos: [133, 7.4, -4.4] },
    { type: 'prop', kind: 'kiln', pos: [131.4, 7.4, 4.2], rot: 180 },
    { type: 'prop', kind: 'pipe', pos: [139.5, 7.4, -5.2], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [144, 18.4, 5] },
    { type: 'prop', kind: 'pots', pos: [149, 18.4, 4.4] },

    // ================================================================ 5. The Flue Top
    { type: 'checkpoint', pos: [158.6, 27.6, -0.8] },
    // the plate is inside an iron cage: a cloud floats in, rains onto the plate, and floats out again
    blk(161, 27.6, -3.4, 161.4, 31.2, -1.6, 'metal'), blk(161, 27.6, 1.6, 161.4, 31.2, 3.4, 'metal'), blk(161, 30.2, -1.6, 161.4, 31.2, 1.6, 'metal'),
    { type: 'grate', box: [161.05, 27.6, -1.6, 161.35, 30.2, 1.6] },
    blk(161, 27.6, -3.4, 168, 31.2, -3, 'metal'), blk(161, 27.6, 3, 168, 31.2, 3.4, 'metal'), blk(167.6, 27.6, -3, 168, 31.2, 3, 'metal'),
    { type: 'plate', id: 'p4', pos: [164.4, 27.6, 0], size: [1.8, 1.8], emit: 'p4' },
    { type: 'hint', key: 'cell', box: [155, 27.6, -6, 160.6, 30.8, 6] },
    { type: 'hint', key: 'gale', box: [169, 27.6, -6, 177, 30.8, 6] },
    { type: 'fan', id: 'gale', box: [179, 28.6, -3, 212, 32.3, 3], dir: '+x', strength: 8, on: 'galeOn' },
    blk(212, -1, -6, 230, 27.6, 6, 'tile'),
    { type: 'cold', box: [213, 27.6, -6, 216.5, 39, 6] },
    { type: 'prop', kind: 'lamp', pos: [156, 27.6, 5] },
    { type: 'prop', kind: 'lamp', pos: [170, 27.6, -5] },
    { type: 'prop', kind: 'lamp', pos: [176, 27.6, 5] },
    { type: 'prop', kind: 'lamp', pos: [220, 27.6, -4.6] },
    { type: 'prop', kind: 'lamp', pos: [220, 27.6, 4.6] },
    { type: 'prop', kind: 'pots', pos: [165.4, 27.6, 2.2], scale: 0.8, solid: false },
    blk(228.4, 27.6, -6.4, 229, 31.2, 6.4, 'brick'),
    { type: 'exit', pos: [225, 27.6, 0], face: '-x' },
  ],
};
