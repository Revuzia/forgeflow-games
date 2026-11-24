// Level 1 - "First Drip". Teaches: move, jump, light plate + door, film under a low gap,
// then a timed door that needs both. Forms: liquid and film only.
// Layout runs along +X; see LEVELS.md for the format.

export default {
  id: 'l01',
  name: 'First Drip',
  chapter: 1,
  theme: 'slip',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['liquid', 'film'],
  hints: {
    start: 'Move with {move}. Jump with {jump}; hold it to jump higher.',
    plate: 'A glowing floor plate. Stand on it and see what wakes up.',
    film: 'Too low to squeeze under? {film} to flatten, {liquid} to gather back into a drop.',
    timer: 'This plate holds the far door only a few seconds. Hurry, and flatten on the way.',
  },
  signals: {
    doorA: { latch: 'p1' },
    doorB: { hold: 'p2', for: 5 },
  },
  pieces: [
    // --- start hall
    { type: 'block', box: [-4, -1, -4, 10, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [2.2, 0, -2.9], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [4.6, 0, 2.9] },
    { type: 'prop', kind: 'lamp', pos: [7.6, 0, -3.5] },
    // first gap, with the kiln fire far below
    { type: 'fire', box: [10, -6, -4, 12.6, -4.5, 4] },
    { type: 'block', box: [10, -7, -4, 12.6, -6, 4], mat: 'dark' },

    // --- hall B: a step to jump, a plate, a door
    { type: 'block', box: [12.6, -1, -4, 26, 0, 4], mat: 'tile' },
    { type: 'block', box: [15.5, 0, -4, 17, 1.2, 4], mat: 'cream' },
    { type: 'shard', pos: [16.25, 1.95, -2.5] },
    { type: 'hint', key: 'plate', box: [17.4, 0, -4, 21.5, 3, 4] },
    { type: 'plate', id: 'p1', pos: [20, 0, 2.2], size: [1.6, 1.6], emit: 'p1' },
    { type: 'block', box: [23, 0, -4, 23.5, 3.6, -1.2], mat: 'brick' },
    { type: 'block', box: [23, 0, 1.2, 23.5, 3.6, 4], mat: 'brick' },
    { type: 'block', box: [23, 3, -1.2, 23.5, 3.6, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorA', box: [23.05, 0, -1.2, 23.45, 3, 1.2], on: 'doorA' },
    { type: 'checkpoint', pos: [24.8, 0, 0] },
    { type: 'prop', kind: 'lamp', pos: [25.2, 0, 3.4] },

    // --- hall C: the low gap
    { type: 'block', box: [26, -1, -4, 50, 0, 4], mat: 'tile' },
    { type: 'hint', key: 'film', box: [26.5, 0, -4, 28.9, 3, 4] },
    { type: 'block', box: [29, 0.3, -4, 31, 3.6, 4], mat: 'brick' },
    // a shelf only film fits under, with a shard beneath it
    { type: 'block', box: [31, 0.3, 2.6, 34, 1.2, 4], mat: 'cream' },
    { type: 'shard', pos: [32.5, 0.2, 3.35] },
    { type: 'prop', kind: 'pots', pos: [32.4, 1.2, 3.2], scale: 0.9 },
    // timed plate -> second low gap -> door
    { type: 'hint', key: 'timer', box: [31.2, 0, -4, 33.6, 3, 1] },
    { type: 'plate', id: 'p2', pos: [32.5, 0, -2.2], size: [1.6, 1.6], emit: 'p2' },
    { type: 'block', box: [35, 0.3, -4, 36.5, 3.6, 4], mat: 'brick' },
    { type: 'block', box: [40, 0, -4, 40.5, 3.6, -1.2], mat: 'brick' },
    { type: 'block', box: [40, 0, 1.2, 40.5, 3.6, 4], mat: 'brick' },
    { type: 'block', box: [40, 3, -1.2, 40.5, 3.6, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorB', box: [40.05, 0, -1.2, 40.45, 3, 1.2], on: 'doorB' },

    // --- last room: two big steps up to the third shard, and the way out
    { type: 'block', box: [43, 0, -4, 44.5, 1.2, -2.5], mat: 'cream' },
    { type: 'block', box: [44.5, 0, -4, 46, 2.4, -2.5], mat: 'cream' },
    { type: 'shard', pos: [45.25, 3.2, -3.25] },
    { type: 'prop', kind: 'lamp', pos: [42, 0, 3.4] },
    { type: 'block', box: [50, 0, -4, 50.5, 3.6, 4], mat: 'brick' },
    { type: 'exit', pos: [48.6, 0, 0], face: '-x' },
  ],
};
