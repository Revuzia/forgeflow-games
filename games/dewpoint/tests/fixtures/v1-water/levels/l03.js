// Level 3 - "Head of Steam". Teaches steam: it rises, runs on a gauge, slips through grates,
// rides fans and updrafts, and is condensed by cold. All four forms are available.

export default {
  id: 'l03',
  name: 'Head of Steam',
  chapter: 1,
  theme: 'slip',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  hints: {
    start: '{steam} to boil. Steam drifts up until its gauge runs dry. {liquid} to rain down.',
    grate: 'A drop cannot fit through a grate. A cloud can.',
    fan: 'Too far to jump. The big fan carries whatever is light enough; as a drop, stay out of it.',
    cold: 'Cold air turns steam straight back into water.',
    updraft: 'The shaft fan is off. Find the plate that starts it, then ride it up as steam.',
  },
  signals: {
    shaftOn: { latch: 'p3' },
  },
  pieces: [
    // --- start: a cliff only steam can climb
    { type: 'block', box: [-4, -1, -4, 8, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [2.4, 0, 2.8], rot: 180 },
    { type: 'prop', kind: 'lamp', pos: [6.8, 0, -3.4] },
    { type: 'block', box: [8, -1, -4, 20, 3.6, 4], mat: 'tile' },
    { type: 'shard', pos: [11, 7.2, -2] },
    // wall with a grate window
    { type: 'hint', key: 'grate', box: [12.5, 3.6, -4, 15.8, 7, 4] },
    { type: 'block', box: [16, 3.6, -4, 16.4, 4.6, 4], mat: 'brick' },
    { type: 'block', box: [16, 4.6, -4, 16.4, 6.8, -1.6], mat: 'brick' },
    { type: 'block', box: [16, 4.6, 1.6, 16.4, 6.8, 4], mat: 'brick' },
    { type: 'block', box: [16, 6.8, -4, 16.4, 10.5, 4], mat: 'brick' },
    { type: 'grate', box: [16.05, 4.6, -1.6, 16.35, 6.8, 1.6] },
    { type: 'checkpoint', pos: [18.2, 3.6, 0] },

    // --- the chasm and the big fan
    { type: 'hint', key: 'fan', box: [17, 3.6, -4, 20, 6, 4] },
    { type: 'fan', box: [20.5, 4.6, -3, 38, 8.2, 3], dir: '+x', strength: 8 },
    { type: 'block', box: [38, -1, -4, 56, 3.6, 4], mat: 'tile' },
    { type: 'cold', box: [39, 3.6, -4, 42.5, 11, 4] },
    { type: 'hint', key: 'cold', box: [42.6, 3.6, -4, 46, 6, 4] },
    // shelf only film fits under
    { type: 'block', box: [43, 3.9, 2.5, 46, 5, 4], mat: 'cream' },
    { type: 'shard', pos: [44.5, 3.8, 3.3] },

    // --- the shaft
    { type: 'hint', key: 'updraft', box: [46.2, 3.6, -4, 49.9, 6, 2] },
    { type: 'plate', id: 'p3', pos: [45, 3.6, -2.6], size: [1.6, 1.6], emit: 'p3' },
    { type: 'fan', id: 'shaft', box: [47.4, 3.6, -1.5, 50, 15.6, 1.5], dir: '+y', strength: 7, on: 'shaftOn' },
    { type: 'block', box: [50, 3.6, -4, 56, 14, 4], mat: 'brick' },
    { type: 'shard', pos: [48.7, 11.6, -3.3] },
    { type: 'prop', kind: 'lamp', pos: [51, 14, 3.3] },
    { type: 'block', box: [56, 14, -4, 56.5, 17, 4], mat: 'brick' },
    { type: 'exit', pos: [54.4, 14, 0], face: '-x' },
  ],
};
