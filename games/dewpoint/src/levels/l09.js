// Level 9 - "Heat Haze". Chapter 3 opens: the Great Kiln's flue works, where heat takes the choice away.
// A heat vent boils any drop that touches it and holds the steam gauge full while it is inside.
//   1. The Flue Foot    teach: two vents lift you up a step and a cliff (safe, nothing to get wrong).
//   2. The Damper Room  practise: a plate sits inside a vent. Steam is too light to press it, so a crate must:
//                       ice shoves it in from outside the haze (two legs). The same vent, capped, hides a shard.
//   3. The Cold Walk    twist: a corridor is all haze, with the heavy plate that opens the way in the middle of it.
//                       A light plate at the near end shuts the vents off, but only a crate can hold it down: the
//                       crate cools the corridor, and you slide through it as ice.
//   4. The Boiler Hall  combine: a canyon with a fire bed. Vents refill the steam gauge, a band of cold air bars
//                       the low road (rise above it before you leave the vent), and a pier in the middle has a
//                       crate, a heavy plate and a bridge that is too long for any cloud.
//   5. The Great Draught payoff: embers in the doorway (a drop), then the draught the damper plate started lifts you
//                       up through a grate lid, and you land on the crown beside the kiln door.
// Layout runs along +X; floor 0 -> 6 (the halls) -> 9 (pier and far hall) -> 24 (the crown).

const blk = (x0, y0, z0, x1, y1, z1, mat = 'tile') => ({ type: 'block', box: [x0, y0, z0, x1, y1, z1], mat });
const prop = (kind, x, y, z, o = {}) => ({ type: 'prop', kind, pos: [x, y, z], ...o });
/** A hall: brick body under a tile skin, and two thin flank walls up to `top` (tall enough that a cloud cannot go over). */
const hall = (x0, x1, y, top, zw = 4, skin = 'tile') => [
  blk(x0, -1, -zw, x1, y - 0.2, zw, 'brick'),
  blk(x0, y - 0.2, -zw, x1, y, zw, skin),
  blk(x0, y, -zw - 0.4, x1, top, -zw, 'brick'),
  blk(x0, y, zw, x1, top, zw + 0.4, 'brick'),
];
/** Low kerbs along both edges: ice does not slide off the sides. */
const kerbs = (x0, x1, y, zw = 4) => [
  blk(x0, y, -zw, x1, y + 0.7, -zw + 0.4, 'brick'),
  blk(x0, y, zw - 0.4, x1, y + 0.7, zw, 'brick'),
];
/** A wall across the hall with a door in it: too tall and too wide to float over or round. */
const gate = (id, x, y, top, on, zw = 9) => [
  blk(x, -1, -zw, x + 0.4, top, -1.2, 'brick'),
  blk(x, -1, 1.2, x + 0.4, top, zw, 'brick'),
  blk(x, y + 3, -1.2, x + 0.4, top, 1.2, 'brick'),
  blk(x, -1, -1.2, x + 0.4, y, 1.2, 'brick'),                       // the sill the door sinks into
  { type: 'door', id, box: [x + 0.03, y, -1.2, x + 0.37, y + 3, 1.2], on },
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [51.8, 6, -0.4],
  [93.6, 6, 0],
  [81.1, 6, -1.4],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l09',
  name: 'Heat Haze',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  areas: [
    { name: 'The Flue Foot', box: [-5, -5, 17.5, 5] },
    { name: 'The Damper Room', box: [17.5, -5, 62.4, 5] },
    { name: 'The Cold Walk', box: [62.4, -5, 97.4, 5] },
    { name: 'The Boiler Hall', box: [97.4, -6, 152, 6] },
    { name: 'The Great Draught', box: [152, -6, 207, 6] },
  ],
  hints: {
    start: 'The Great Kiln has gone cold, but its flues still run. A heat vent boils whatever touches it.',
    vent: 'In a heat vent you are steam and nothing else. Let it carry you up, drift out, then {liquid}.',
    plate: 'The plate sits in the haze, and steam is too light to press it. A crate is not: {ice} to shove one in.',
    cap: 'A cap over the vent keeps the haze under it. Something glitters on top.',
    gap: 'A gap too low for a drop. {film} to flatten and crawl under: two posts wait behind the wall.',
    cool: 'A heavy plate lies in the haze. Something here switches the vents off: cool the corridor, then cross it.',
    cold: 'Cold air turns steam back into water. Stay in the vent until you are above the cold band.',
    ferry: 'The kiln mouth glows far below. The ferry leaves when you step aboard; it is too far for a cloud.',
    pier: 'The bridge slides out only while the heavy plate is held, and it is too long for a cloud. Shove the crate on.',
    draught: 'The Great Draught lifts whatever it boils. Rise through the grate lid, then {liquid} on top.',
    ember: 'Embers in the doorway again. A drop puts them out for good.',
  },
  signals: {
    doorC: { latch: 'arcC' },                  // the posts open the crate room for good
    flue: { latch: 'hh' },                     // the damper plate starts the Great Draught for good (and opens door B)
  },
  pieces: [
    ...LAMPS,
    // ================================================================ 1. the Flue Foot
    ...hall(-4, 8.4, 0, 2.6),
    blk(-4.5, 0, -4.4, -4, 0.8, 4.4, 'brick'),
    prop('kiln', 1.8, 0, -3.0, { rot: 0 }),
    prop('pots', 1.8, 0, 3.0),
    prop('lamp', 4.2, 0, -3.5),
    prop('lamp', 4.2, 0, 3.5),
    prop('pipe', 6.6, 0, -3.5, { rot: 0 }),
    { type: 'checkpoint', pos: [3, 0, 0] },
    { type: 'hint', key: 'vent', box: [4.6, 0, -4, 6, 4, 4] },
    { type: 'heatvent', id: 'v0', box: [6, 0, -1.8, 8.4, 4.2, 1.8] },
    // a step too high to jump, and the cliff behind it
    blk(8.4, -1, -4, 16.2, 1.8, 4, 'brick'),
    blk(8.4, 1.8, -4, 16.2, 2.0, 4, 'cream'),
    blk(8.4, 2.0, -4.4, 16.2, 9.6, -4, 'brick'),
    blk(8.4, 2.0, 4, 16.2, 9.6, 4.4, 'brick'),
    prop('pots', 10.2, 2.0, -3.1, { scale: 0.9 }),
    prop('lamp', 11.6, 2.0, 3.4),
    { type: 'shard', pos: [10.9, 2.75, 2.4] },
    { type: 'heatvent', id: 'v1', box: [13.4, 2.0, -1.8, 16.2, 9.0, 1.8] },
    blk(16.2, -1, -4, 24, 5.8, 4, 'brick'),

    // ================================================================ 2. the Damper Room (floor 6)
    ...hall(16.2, 62, 6, 14),
    ...kerbs(16.2, 62, 6),
    { type: 'checkpoint', pos: [19.6, 6, 0] },
    prop('lamp', 18.8, 6, 3.3),
    prop('pots', 22.6, 6, 3.0, { scale: 0.9 }),
    prop('kiln', 30.5, 6, 2.6, { rot: 180 }),
    prop('pipe', 36, 6, -3.4, { rot: 0, solid: false }),
    prop('lamp', 40.6, 6, 3.3),
    prop('pots', 44.4, 6, -3.4, { scale: 0.9, solid: false }),
    prop('lamp', 56, 6, -3.3),
    prop('lamp', 56, 6, 3.3),
    { type: 'hint', key: 'plate', box: [19, 6, -3.6, 24.4, 9, 3.6] },
    { type: 'crate', id: 'crate1', pos: [21.6, 6, -1.9] },
    { type: 'plate', id: 'p1', pos: [50, 6, 2.0], size: [1.6, 1.6], emit: 'p1' },
    { type: 'heatvent', id: 'v2', box: [48.6, 6, 1.2, 51.4, 9.2, 3.5] },
    // the cap: a roof over the vent with four short posts, a shard on top
    blk(48.2, 9.2, 0.0, 51.8, 9.5, 3.9, 'cream'),
    blk(48.2, 6, 0.0, 48.6, 9.2, 0.4, 'brick'),
    blk(51.4, 6, 0.0, 51.8, 9.2, 0.4, 'brick'),
    blk(48.2, 6, 3.5, 48.6, 9.2, 3.9, 'brick'),
    blk(51.4, 6, 3.5, 51.8, 9.2, 3.9, 'brick'),
    { type: 'hint', key: 'cap', box: [44.4, 6, 0.4, 47.6, 9, 3.6] },
    { type: 'shard', pos: [50, 10.25, 2.0] },
    ...gate('doorA', 62, 6, 20, 'p1'),

    // ================================================================ 3. the Cold Walk (floor 6)
    ...hall(62.4, 97, 6, 14),
    ...kerbs(62.4, 97, 6),
    { type: 'checkpoint', pos: [64.6, 6, 0] },
    prop('lamp', 63.6, 6, -3.3),
    prop('lamp', 63.6, 6, 3.3),
    prop('pots', 65.6, 6, 3.0, { scale: 0.9 }),
    { type: 'hint', key: 'gap', box: [64.6, 6, -4, 66.8, 9, 4] },
    // a wall with a film-high gap, and the posts behind it that open the crate room
    blk(67.6, 6.3, -4, 69, 14, 4, 'brick'),
    { type: 'electrodes', id: 'eC', box: [70.2, 6, -0.7, 71.6, 6.4, 0.7], axis: 'x', emit: 'arcC' },
    prop('lamp', 69.6, 6, -3.3),
    prop('shelf', 71.4, 6, 3.5, { rot: 0 }),
    ...gate('doorC', 73.6, 6, 20, 'doorC'),
    { type: 'crate', id: 'crate2', pos: [76.6, 6, 0] },
    { type: 'plate', id: 'pL', pos: [82.4, 6, 2.4], size: [1.6, 1.6], emit: 'cool' },
    { type: 'hint', key: 'cool', box: [74.6, 6, -3.6, 77, 9, 3.6] },
    prop('lamp', 75.4, 6, -3.3),
    prop('pots', 79.4, 6, 3.0, { scale: 0.9 }),
    { type: 'heatvent', id: 'v3', box: [85, 6, -4, 94.4, 9.6, 4], on: '!cool' },
    { type: 'plate', id: 'pH', pos: [91, 6, 0], size: [2.4, 2.4], heavy: true, emit: 'hh' },
    prop('lamp', 86.4, 6, -3.3),
    prop('lamp', 94.8, 6, 3.3),
    prop('pots', 94.6, 6, -3.0, { scale: 0.9 }),
    ...gate('doorB', 97, 6, 20, 'flue'),

    // ================================================================ 4. the Boiler Hall
    // start ledge (floor 6), a canyon with a fire bed, a pier (floor 9), a long gap, the far hall (floor 9)
    blk(97.4, -7, -5, 106, 5.8, 5, 'brick'),
    blk(97.4, 5.8, -5, 106, 6, 5, 'tile'),
    blk(97.4, 6, -5.4, 106, 30, -5, 'brick'),
    blk(97.4, 6, 5, 106, 30, 5.4, 'brick'),
    { type: 'checkpoint', pos: [100, 6, 0] },
    prop('lamp', 99.4, 6, -4.2),
    prop('lamp', 99.4, 6, 4.2),
    { type: 'heatvent', id: 'va', box: [103.4, 6, -1.8, 106, 27, 1.8] },
    { type: 'fire', box: [106, -6, -5, 152, -4.5, 5] },
    blk(106, -7, -5, 152, -6, 5, 'dark'),
    blk(106, -7, -5.4, 152, 30, -5, 'brick'),
    blk(106, -7, 5, 152, 30, 5.4, 'brick'),
    { type: 'hint', key: 'cold', box: [98.4, 6, -5, 103, 9, 5] },
    { type: 'cold', id: 'band', box: [106.2, 6.2, -5, 116.3, 16.2, 5] },
    prop('chimney', 117.8, -4.5, 0, { solid: false, scale: 1.6 }),
    { type: 'heatvent', id: 'vb', box: [116.4, -3, -1.8, 119.2, 38, 1.8] },
    { type: 'shard', pos: [117.8, 24.8, 3.7] },
    // the pier
    blk(121.5, -4.6, -4, 137, 8.8, 4, 'brick'),
    blk(121.5, 8.8, -4, 137, 9, 4, 'tile'),
    ...kerbs(121.5, 137, 9),
    { type: 'checkpoint', pos: [123.4, 9, 0] },
    prop('lamp', 123, 9, -3.2),
    prop('pots', 126, 9, 3.0, { scale: 0.9 }),
    { type: 'hint', key: 'pier', box: [124, 9, -3.6, 127, 12, 3.6] },
    { type: 'cold', id: 'gapCold', box: [137.6, 6, -5, 151.6, 60, 5] },                      // cold air over the long gap: a cloud cannot cross it
    { type: 'crate', id: 'crate3', pos: [126, 9, -1.9] },
    { type: 'plate', id: 'pB', pos: [132.8, 9, 1.9], size: [1.8, 1.8], heavy: true, emit: 'bridge' },
    // the rack-bridge rests inside the pier and slides out across the gap while the plate is held
    { type: 'mover', id: 'bridge', box: [121.6, 8.5, -1.4, 137, 8.9, 1.4], to: [15.2, 0, 0], speed: 3, mode: 'toggle', on: 'bridge', mat: 'clay' },
    // the far hall (floor 9)
    blk(152, -7, -5, 180, 8.8, 5, 'brick'),
    blk(152, 8.8, -5, 180, 9, 5, 'tile'),
    blk(152, 9, -5.4, 180, 24, -5, 'brick'),
    blk(152, 9, 5, 180, 24, 5.4, 'brick'),

    // ================================================================ 5. the Great Draught (floor 9, crown 28)
    { type: 'checkpoint', pos: [155, 9, 0] },
    prop('lamp', 154, 9, -4.2),
    prop('lamp', 154, 9, 4.2),
    { type: 'hint', key: 'ember', box: [156, 9, -4.4, 160, 12, 4.4] },
    // the doorway wall, stuffed with embers (tall and wide: no cloud gets round it)
    blk(162, 9, -5.4, 162.4, 36, -1.2, 'brick'),
    blk(162, 9, 1.2, 162.4, 36, 5.4, 'brick'),
    blk(162, 12, -1.2, 162.4, 36, 1.2, 'brick'),
    { type: 'ember', id: 'doorEmbers', box: [161.9, 9, -1.2, 162.5, 12, 1.2] },
    prop('pots', 165, 9, 3.4, { scale: 0.9 }),
    { type: 'hint', key: 'draught', box: [164, 9, -4.4, 170.6, 12, 4.4] },
    { type: 'heatvent', id: 'vd', box: [171.6, 9, -2, 175.6, 29.4, 2], on: 'flue' },
    // the crown: a gallery with a grate lid over the draught
    blk(168, 27.2, -5, 171.6, 28, 5, 'cream'),
    blk(175.6, 27.2, -5, 180, 28, 5, 'cream'),
    blk(171.6, 27.2, -5, 175.6, 28, -2, 'cream'),
    blk(171.6, 27.2, 2, 175.6, 28, 5, 'cream'),
    { type: 'grate', id: 'lid', box: [171.6, 27.2, -2, 175.6, 28, 2] },
    blk(178, 9, -5, 180, 27.2, 5, 'brick'),
    blk(168, 28, -5.4, 195, 29, -5, 'brick'),
    blk(168, 28, 5, 195, 29, 5.4, 'brick'),
    prop('lamp', 170, 28, -4.2),
    prop('lamp', 177.8, 28, 4.2),
    { type: 'checkpoint', pos: [178, 28, 0] },
    // the kiln mouth: a glowing floor far below, and a ferry that crosses it (15 m: too far for a cloud)
    { type: 'fire', box: [180, 18, -5, 195, 19.5, 5] },
    blk(180, 17, -5, 195, 18, 5, 'dark'),
    blk(180, 17, -5.4, 195, 29, -5, 'brick'),
    blk(180, 17, 5, 195, 29, 5.4, 'brick'),
    { type: 'sensor', id: 'deckF', box: [181, 27.4, -1.2, 182.6, 28.6, 1.2], emit: 'deckF' },
    { type: 'mover', id: 'ferry', box: [180, 27.6, -1.5, 183, 28, 1.5], to: [12, 0, 0], speed: 3, mode: 'toggle', on: { hold: 'deckF', for: 9 }, mat: 'metal' },
    { type: 'cold', id: 'mouthCold', box: [180.6, 24, -5, 194.6, 70, 5] },
    { type: 'hint', key: 'ferry', box: [176, 28, -4.4, 180, 31, 4.4] },
    blk(195, 17, -5, 206, 27.8, 5, 'brick'),
    blk(195, 27.8, -5, 206, 28, 5, 'tile'),
    blk(195, 28, -5.4, 206, 29, -5, 'brick'),
    blk(195, 28, 5, 206, 29, 5.4, 'brick'),
    prop('lamp', 197, 28, -4.2),
    prop('lamp', 197, 28, 4.2),
    prop('kiln', 200, 28, 3.0, { rot: 180, solid: false }),
    blk(205.4, 28, -5, 206, 32, 5, 'brick'),
    { type: 'exit', pos: [203.6, 28, 0], face: '-x' },
  ],
};
