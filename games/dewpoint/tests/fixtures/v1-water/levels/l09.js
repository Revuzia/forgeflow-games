// Level 9 - "Heat Haze". Chapter 3 opens: the Great Kiln's flue works, where heat takes the choice away.
// A heat vent boils any drop that touches it and holds the steam gauge full while it is inside.
//   1. A vent against a cliff: let it lift you (safe, nothing to get wrong).
//   2. A pressure plate sitting inside a vent: a drop that steps in boils and is too light to press it,
//      so the crate has to do it - ice shoves it in from outside the haze. (Forced steam is still
//      steam, though: the same vent is a lift onto the cap above, where a shard waits.)
//   3. A chasm too wide for one gauge, with a vent floating in the middle to refill it.
// Layout runs along +X: hall 1 (floor 0), hall 2 and hall 3 (y 4.8), the far side (y 8.4).

export default {
  id: 'l09',
  name: 'Heat Haze',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  hints: {
    start: 'The Great Kiln has gone cold; only its flues still run. Heat vents will not ask if you want to boil.',
    vent: 'A heat vent turns whatever touches it to steam, and you cannot be anything else in there. Let it carry you up.',
    plate: 'The plate sits in the haze, and steam is too light to press it. A crate does not mind: ice can shove one in.',
    chasm: 'Steam runs dry after four seconds. Inside a heat vent the gauge stays full, so hop from one haze to the next.',
  },
  signals: {},
  pieces: [
    // --- hall 1: a cliff, and a vent standing against it
    { type: 'block', box: [-4, -1, -4, 9, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [1.8, 0, -3.0], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [1.8, 0, 3.0] },
    { type: 'prop', kind: 'lamp', pos: [4.2, 0, -3.5] },
    { type: 'prop', kind: 'lamp', pos: [4.2, 0, 3.5] },
    { type: 'prop', kind: 'pipe', pos: [6.8, 0, -3.6], rot: 0 },
    { type: 'hint', key: 'vent', box: [2.6, 0, -4, 5.4, 4, 4] },
    { type: 'heatvent', id: 'v1', box: [6, 0, -1.8, 9, 10.5, 1.8] },

    // --- hall 2 (y 4.8): a crate, a plate in a vent, a door
    { type: 'block', box: [9, -1, -4, 25, 4.6, 4], mat: 'brick' },
    { type: 'block', box: [9, 4.6, -4, 25, 4.8, 4], mat: 'tile' },
    { type: 'shard', pos: [10.3, 5.6, 0] },
    { type: 'block', box: [9, 4.8, -4, 25, 5.5, -3.6], mat: 'brick' },               // kerbs: ice does not slide off the sides
    { type: 'block', box: [9, 4.8, 3.6, 25, 5.5, 4], mat: 'brick' },
    { type: 'prop', kind: 'lamp', pos: [10.2, 4.8, -3.0] },
    { type: 'prop', kind: 'pots', pos: [19.6, 4.8, -2.6], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [19.8, 4.8, 3.0] },
    { type: 'hint', key: 'plate', box: [11.2, 4.8, -3.6, 13.2, 8, 3.6] },
    { type: 'crate', id: 'crate', pos: [11.8, 4.8, 0] },
    { type: 'plate', id: 'p1', pos: [15.3, 4.8, 0], size: [1.6, 1.6], emit: 'p1' },
    { type: 'heatvent', id: 'v2', box: [14, 4.8, -1.6, 17.2, 7.4, 1.6] },
    // a low cap over the vent keeps the steam under it, and gives the shard somewhere to sit
    { type: 'block', box: [13.6, 7.2, -2.2, 17.8, 7.5, 2.2], mat: 'cream' },
    { type: 'block', box: [13.6, 4.8, -2.2, 14, 7.2, -1.8], mat: 'brick' },
    { type: 'block', box: [13.6, 4.8, 1.8, 14, 7.2, 2.2], mat: 'brick' },
    { type: 'block', box: [17.4, 4.8, -2.2, 17.8, 7.2, -1.8], mat: 'brick' },
    { type: 'block', box: [17.4, 4.8, 1.8, 17.8, 7.2, 2.2], mat: 'brick' },
    { type: 'shard', pos: [15.5, 8.2, 0] },
    // the door, in a wall far too tall and wide to float over or round
    { type: 'block', box: [25, -1, -9, 25.4, 13.6, -1.2], mat: 'brick' },
    { type: 'block', box: [25, -1, 1.2, 25.4, 13.6, 9], mat: 'brick' },
    { type: 'block', box: [25, 7.8, -1.2, 25.4, 13.6, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorA', box: [25.03, 4.8, -1.2, 25.37, 7.8, 1.2], on: 'p1' },
    { type: 'checkpoint', pos: [10.6, 4.8, 2.4] },

    // --- hall 3 and the chasm
    { type: 'block', box: [25.4, -1, -4, 32, 4.6, 4], mat: 'brick' },
    { type: 'block', box: [25.4, 4.6, -4, 32, 4.8, 4], mat: 'tile' },
    { type: 'prop', kind: 'lamp', pos: [26.4, 4.8, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [26.4, 4.8, 3.4] },
    { type: 'checkpoint', pos: [27.6, 4.8, 0] },
    { type: 'hint', key: 'chasm', box: [27.2, 4.8, -4, 29.6, 9, 4] },
    { type: 'heatvent', id: 'v3', box: [30, 4.8, -1.8, 32, 8, 1.8] },
    { type: 'fire', box: [32, -6, -8, 52, -4.5, 8] },
    { type: 'block', box: [32, -7, -8, 52, -6, 8], mat: 'dark' },
    { type: 'heatvent', id: 'v4', box: [41.5, 5, -2.2, 45, 17, 2.2] },
    { type: 'shard', pos: [43.2, 14.8, 1.0] },

    // --- the far side, a step higher
    { type: 'block', box: [52, -1, -4, 66, 8.2, 4], mat: 'brick' },
    { type: 'block', box: [52, 8.2, -4, 66, 8.4, 4], mat: 'tile' },
    { type: 'checkpoint', pos: [53.8, 8.4, 0] },
    { type: 'prop', kind: 'lamp', pos: [55.4, 8.4, -3.4] },
    { type: 'prop', kind: 'lamp', pos: [55.4, 8.4, 3.4] },
    { type: 'prop', kind: 'kiln', pos: [59.4, 8.4, -2.8], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [60.2, 8.4, 2.6], scale: 0.9 },
    { type: 'block', box: [64.4, 8.4, -4, 65, 12.6, 4], mat: 'brick' },
    { type: 'exit', pos: [63, 8.4, 0], face: '-x' },
  ],
};
