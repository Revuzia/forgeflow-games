// Level 2 - "Cold Shoulder". Ice: it is heavy, it slides, it shoves crates, it smashes cracked glass and it
// melts on hot tiles. Five areas, one idea each:
//   1. The Rink           (teach)     freeze and steer a slide round two kerbs; ice is heavy enough for a heavy plate, and fast enough
//                                     to shatter a cracked pane. Easy shard on a pedestal.
//   2. The Crate Gallery  (practise)  shove a crate in two legs onto a heavy plate; the crate holds the door open (shard above it).
//   3. The Chute          (twist)     up a ramp to a deck, freeze at the top and slide down fast enough for a tougher pane, into hot tiles.
//   4. The Double Weight  (combine)   two crates, two heavy plates, one shutter; the second crate is behind cracked glass.
//   5. The Locked Kiln    (payoff)    the kiln door is shut: film under a low wall, ice on the heavy plate beyond, then back out.
// Forms: liquid, film and ice. Layout runs along +X; see LEVELS.md for the format.

const blk = (x0, y0, z0, x1, y1, z1, mat = 'tile') => ({ type: 'block', box: [x0, y0, z0, x1, y1, z1], mat });
/** Kerbs along both sides (ice cannot hop 0.7 m: a slide never ends in the void). */
const kerbs = (x0, x1, y = 0) => [blk(x0, y, -5.4, x1, y + 0.7, -5, 'brick'), blk(x0, y, 5, x1, y + 0.7, 5.4, 'brick')];
/** A wall across the hall (x0..x1 thick) with an open doorway 3.2 m wide and 2.6 m tall. */
const doorway = (x0, x1) => [
  blk(x0, 0, -5.4, x1, 3.6, -1.6, 'brick'), blk(x0, 0, 1.6, x1, 3.6, 5.4, 'brick'), blk(x0, 2.6, -1.6, x1, 3.6, 1.6, 'brick'),
];
/** A wall across the hall with a 2.4 m wide, 3 m tall slot for a door. */
const doorWall = (x0, x1) => [
  blk(x0, 0, -5.4, x1, 3.6, -1.2, 'brick'), blk(x0, 0, 1.2, x1, 3.6, 5.4, 'brick'), blk(x0, 3, -1.2, x1, 3.6, 1.2, 'brick'),
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [58.5, 0, 1.1],
  [95.8, 0, 0],
  [124, 0, 1.2],
  [149.9, 0, 0],
  [141.8, 0, -1.8],
  [11.8, 0, -4.6],
  [30.9, 0, 0.7],
  [101.6, 0, 3.4],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l02',
  name: 'Cold Shoulder',
  chapter: 1,
  theme: 'slip',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['liquid', 'film', 'ice'],
  areas: [
    { name: 'The Rink', box: [-9, -6, 40, 6] },
    { name: 'The Crate Gallery', box: [40, -6, 64.5, 6] },
    { name: 'The Chute', box: [64.5, -6, 100.5, 6] },
    { name: 'The Double Weight', box: [100.5, -6, 129, 6] },
    { name: 'The Locked Kiln', box: [129, -6, 160, 6] },
  ],
  hints: {
    start: '{ice} to freeze. Ice is heavy and slippery: it slides on, so steer early and let the kerbs help.',
    heavy: 'A heavy plate ignores a mere drop. It wants ice - or something that stays put.',
    glass: 'Cracked glass. Ice at a run shatters it; a slow shove or a drop only makes it creak.',
    crate: 'A crate moves only when ice shoves it, and it cannot be pulled. Jammed? {restart}.',
    slide: 'Ice gathers speed downhill. Fast ice goes straight through cracked glass.',
    hot: 'Hot tiles melt ice back into a drop.',
    twin: 'Two heavy plates, one shutter. The second crate waits behind cracked glass.',
    lock: 'The kiln door is shut. Something heavy on the far side of that wall might open it.',
  },
  signals: {
    doorR: { latch: 'p0' },
    bothWeights: { and: ['hpA', 'hpB'] },
    exitOpen: { latch: 'hp2' },
  },
  pieces: [
    ...LAMPS,
    // ================================================================ 1. The Rink
    blk(-8, -1, -5, 40.5, 0, 5), ...kerbs(-8.5, 40.5), blk(-8.5, 0, -5.4, -8, 0.8, 5.4, 'brick'),
    // two kerbs to steer round: a drop hops them, ice cannot
    blk(8, 0, -5, 8.5, 0.7, 1.4, 'brick'),
    blk(13, 0, -1.4, 13.5, 0.7, 5, 'brick'),
    // a heavy plate in the open, and the shutter it lifts for good
    { type: 'plate', id: 'p0', pos: [18.5, 0, 0], size: [2.8, 2.8], heavy: true, emit: 'p0' },
    ...doorWall(24, 24.5),
    { type: 'door', id: 'doorR', box: [24.05, 0, -1.2, 24.45, 3, 1.2], on: 'doorR' },
    // a wall of cracked glass: ice with a run-up goes through
    blk(33, 0, -5.4, 33.5, 3.6, -2, 'brick'), blk(33, 0, 2, 33.5, 3.6, 5.4, 'brick'),
    { type: 'pane', id: 'pane1', box: [33.03, 0, -2, 33.47, 3.6, 2] },
    // the easy shard: a pedestal beside the way out
    blk(35.2, 0, -5, 37.2, 1.2, -3, 'cream'),
    { type: 'shard', pos: [36.2, 1.95, -4] },
    { type: 'checkpoint', pos: [3, 0, -0.8] },
    { type: 'prop', kind: 'kiln', pos: [-4, 0, -3.9], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [-4, 0, 3.4] },
    { type: 'prop', kind: 'lamp', pos: [5, 0, -4.6] },
    { type: 'prop', kind: 'lamp', pos: [20, 0, 4.6] },
    { type: 'prop', kind: 'lamp', pos: [29, 0, -4.6] },
    { type: 'prop', kind: 'pipe', pos: [29.5, 0, 4.7], rot: 0 },
    { type: 'hint', key: 'heavy', box: [14, 0, -5, 22, 3, 5] },
    { type: 'hint', key: 'glass', box: [26, 0, -5, 32, 3, 5] },
    ...doorway(39.5, 40),

    // ================================================================ 2. The Crate Gallery
    blk(40, -1, -5, 64.5, 0, 5), ...kerbs(40, 64.5),
    { type: 'crate', id: 'crate1', pos: [46, 0, -3.2] },
    { type: 'plate', id: 'hp1', pos: [56, 0, 2.6], size: [1.9, 1.9], heavy: true, emit: 'hp1' },
    { type: 'shard', pos: [56, 3.05, 2.6] },
    ...doorWall(64, 64.5),
    { type: 'door', id: 'doorA', box: [64.05, 0, -1.2, 64.45, 3, 1.2], on: 'hp1' },
    { type: 'checkpoint', pos: [42, 0, -0.8] },
    { type: 'prop', kind: 'kiln', pos: [42.4, 0, -3.9], rot: 0 },
    { type: 'prop', kind: 'shelf', pos: [47, 0, 4.6], rot: 0, solid: false },
    { type: 'prop', kind: 'lamp', pos: [51, 0, -4.6] },
    { type: 'prop', kind: 'pots', pos: [60, 0, -3.6] },
    { type: 'prop', kind: 'lamp', pos: [61, 0, 4.6] },
    { type: 'hint', key: 'crate', box: [41, 0, -5, 49, 3, 5] },

    // ================================================================ 3. The Chute
    blk(64.5, -1, -5, 68, 0, 5), ...kerbs(64.5, 68),
    { type: 'ramp', box: [68, 0, -3, 74, 3, 3], up: '+x', mat: 'cream' },
    blk(68, -1, -5, 74, 0, 5), ...kerbs(68, 74),
    blk(74, -1, -5, 80, 3, 5, 'tile'), blk(74, 3, -5.4, 80, 3.7, -5, 'brick'), blk(74, 3, 5, 80, 3.7, 5.4, 'brick'),
    { type: 'checkpoint', pos: [76, 3, 0] },
    { type: 'checkpoint', pos: [66, 0, -0.8] },
    { type: 'prop', kind: 'lamp', pos: [75, 3, 4.3] },
    { type: 'hint', key: 'slide', box: [74.5, 3, -3, 79.5, 6, 3] },
    blk(80, -1, -5, 100.5, 0, 5, 'tile'), ...kerbs(80, 100.5),
    { type: 'ramp', box: [80, 0, -3, 88, 3, 3], up: '-x', mat: 'cream' },
    // a tougher pane across the run-out: only a long downhill run breaks it
    blk(92, 0, -5.4, 92.3, 3.6, -2, 'brick'), blk(92, 0, 2, 92.3, 3.6, 5.4, 'brick'),
    { type: 'pane', id: 'pane2', box: [92.03, 0, -2, 92.27, 3.6, 2], speed: 9 },
    { type: 'hint', key: 'hot', box: [93, 0, -5, 95.6, 3, 5] },
    { type: 'hotfloor', box: [96, 0, -5, 99, 0.3, 5] },
    { type: 'prop', kind: 'lamp', pos: [84, 0, -4.6] },
    { type: 'prop', kind: 'pots', pos: [86, 0, 4.3] },
    { type: 'prop', kind: 'pipe', pos: [96.5, 0, -4.7], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [66.5, 0, 4.6] },
    ...doorway(100, 100.5),

    // ================================================================ 4. The Double Weight
    blk(100.5, -1, -5, 129, 0, 5), ...kerbs(100.5, 129),
    { type: 'checkpoint', pos: [102.5, 0, -0.8] },
    { type: 'crate', id: 'crate2', pos: [105, 0, -3.4] },
    { type: 'plate', id: 'hpA', pos: [115, 0, -3.4], size: [1.9, 1.9], heavy: true, emit: 'hpA' },
    // a stall for the second crate, shut at its near end by cracked glass; it is only a crate wide, behind a 2.4 m mouth
    // (the mouth with the glass is 2.4 m wide, so a drop-sized ice can be lined up on it with a keyboard; behind it the stall is
    // a crate wide, so ice from the open end still cannot squeeze past the crate)
    blk(107, 0, 2.0, 109, 3.6, 2.3, 'brick'), blk(107, 0, 4.7, 109, 3.6, 5.4, 'brick'),
    blk(109, 0, 2.4, 117.4, 3.6, 2.7, 'brick'), blk(109, 0, 4.3, 117.4, 3.6, 5.4, 'brick'),
    { type: 'pane', id: 'pane3', box: [107.03, 0, 2.3, 107.27, 3.6, 4.7] },
    { type: 'crate', id: 'crate3', pos: [111.5, 0, 3.5] },
    { type: 'plate', id: 'hpB', pos: [122, 0, 3.5], size: [1.9, 1.9], heavy: true, emit: 'hpB' },
    ...doorWall(128.5, 129),
    { type: 'door', id: 'doorW', box: [128.55, 0, -1.2, 128.95, 3, 1.2], on: 'bothWeights' },
    { type: 'prop', kind: 'lamp', pos: [102.6, 0, -4.6] },
    { type: 'prop', kind: 'shelf', pos: [121, 0, -4.8], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [125.4, 0, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [126, 0, 4.6] },
    { type: 'prop', kind: 'lamp', pos: [102.6, 0, 4.6] },
    { type: 'hint', key: 'twin', box: [101, 0, -5, 106, 3, 5] },

    // ================================================================ 5. The Locked Kiln
    blk(129, -1, -5, 160, 0, 5), ...kerbs(129, 160),
    { type: 'checkpoint', pos: [131, 0, -0.8] },
    // the kiln door is right here by the entrance, and shut
    { type: 'exit', pos: [133.4, 0, -3.9], face: '+z', on: 'exitOpen' },
    blk(131.8, 0, -5.4, 135, 3.6, -4.7, 'brick'),
    { type: 'hint', key: 'lock', box: [130, 0, -5, 138, 3, 5] },
    // the way to the weight: a low wall, and a heavy plate beyond it
    blk(152, 0.3, -5.4, 153.5, 3.6, 5.4, 'brick'),
    { type: 'plate', id: 'hp2', pos: [156.2, 0, 0], size: [1.7, 1.7], heavy: true, emit: 'hp2' },
    blk(154, 0, 3.4, 155.4, 1.2, 5, 'cream'), blk(155.4, 0, 3.4, 156.8, 2.4, 5, 'cream'),
    { type: 'shard', pos: [156.1, 3.2, 4.2] },
    blk(158.5, 0, -5.4, 159, 3.6, 5.4, 'brick'),
    { type: 'prop', kind: 'pots', pos: [158, 0, -3.9] },
    { type: 'prop', kind: 'lamp', pos: [158.2, 0, 4.2] },
    { type: 'prop', kind: 'lamp', pos: [131.4, 0, 4.4] },
    { type: 'prop', kind: 'kiln', pos: [139, 0, 3.9], rot: 180 },
    { type: 'prop', kind: 'shelf', pos: [143.4, 0, -4.7], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [140, 0, -4.6] },
    { type: 'prop', kind: 'pots', pos: [145, 0, 3.8] },
    { type: 'prop', kind: 'pipe', pos: [135.5, 0, 4.7], rot: 0 },
  ],
};
