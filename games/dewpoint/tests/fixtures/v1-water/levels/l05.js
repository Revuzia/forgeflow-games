// Level 5 - "Hung Out to Dry". Chapter 2 opens in the Drying Loft. Teaches moving platforms.
//   1. A ferry shuttles across a chasm: step on, ride, step off.
//   2. A rack-bridge slides out across a second chasm while a heavy plate is held. Ice shoves a
//      crate onto the plate (two legs) and the crate holds the bridge out for good.
//   3. A tall chimney: a lift carries you part of the way, and a grate in the ceiling stops a drop
//      but not a cloud. Neither the lift alone nor steam alone gets you through.
// Optional: a lift up to a rack (shard), and a barred cage only a cloud can enter (shard).
// Layout runs along +X; see LEVELS.md for the format.

export default {
  id: 'l05',
  name: 'Hung Out to Dry',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  hints: {
    start: 'The Drying Loft: racks, rails and a very long drop. Anything that moves carries you with it.',
    ferry: 'The platform shuttles across the gap. Step on when it docks, ride over, step off.',
    bridge: 'The heavy plate slides the bridge out. Shove the crate on as ice. Jammed? {restart}.',
    cage: 'Bars stop a drop, not a cloud. Something glitters inside the cage.',
    hatch: 'A ceiling grate, too high from the floor. The platform gets you part of the way.',
  },
  signals: {},
  pieces: [
    // ------------------------------------------------------------------ hall A: the arrival rack
    { type: 'block', box: [-4, -1, -4, 10, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4.4, -4, 0.8, 4.4], mat: 'brick' },
    { type: 'block', box: [-4.5, 0, -4.4, 10, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [-4.5, 0, 4, 10, 0.7, 4.4], mat: 'brick' },
    { type: 'prop', kind: 'shelf', pos: [-2.0, 0, -3.5], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [1.6, 0, -3.1], scale: 0.9 },
    { type: 'prop', kind: 'kiln', pos: [3.0, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'chimney', pos: [-2.2, 0, 7.5], solid: false },
    { type: 'prop', kind: 'chimney', pos: [6.5, 0, -8.0], solid: false, scale: 1.3 },
    { type: 'prop', kind: 'lamp', pos: [8.6, 0, -3.5] },
    // easy shard: on a stack of drying boards beside the path
    { type: 'block', box: [6.0, 0, 2.4, 7.6, 1.2, 4.0], mat: 'cream' },
    { type: 'shard', pos: [6.8, 1.95, 3.2] },
    { type: 'hint', key: 'ferry', box: [7.4, 0, -4, 10, 3, 4] },

    // ------------------------------------------------------------------ chasm 1: the ferry
    { type: 'fire', box: [10, -6, -4.4, 17, -4.5, 4.4] },
    { type: 'block', box: [10, -7, -4.4, 17, -6, 4.4], mat: 'dark' },
    { type: 'mover', id: 'ferry', box: [10, -0.4, -1.5, 13, 0, 1.5], to: [4, 0, 0], speed: 2.2, pause: 1.5, mat: 'metal' },

    // ------------------------------------------------------------------ hall B: the plate and the bridge
    { type: 'block', box: [17, -1, -4, 40, 0, 4], mat: 'tile' },
    { type: 'block', box: [17, 0, -4.4, 40, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [17, 0, 4, 26, 0.7, 4.4], mat: 'brick' },
    { type: 'block', box: [29.5, 0, 4, 40, 0.7, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [18.6, 0, 0] },
    { type: 'prop', kind: 'lamp', pos: [18.2, 0, -3.5] },
    { type: 'prop', kind: 'pots', pos: [19.4, 0, 3.0], scale: 0.9 },
    { type: 'prop', kind: 'kiln', pos: [20.8, 0, -3.0], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [38.6, 0, -3.6] },
    { type: 'prop', kind: 'chimney', pos: [34, 0, -9], solid: false, scale: 1.5 },
    // the crate starts north of its lane; the plate is south-east
    { type: 'crate', id: 'crate', pos: [24, 0, -1.8] },
    { type: 'plate', id: 'hp', pos: [36.5, 0, 1.8], size: [1.7, 1.7], heavy: true, emit: 'hp' },
    { type: 'hint', key: 'bridge', box: [30, 0, -1, 36, 3, 4] },
    // optional lift up to a rack (shard)
    { type: 'mover', id: 'lift', box: [29.5, -0.4, -4, 32, 0, -1.9], to: [0, 3.4, 0], speed: 1.6, pause: 2, mat: 'metal' },
    { type: 'block', box: [32, 3.0, -4, 35.6, 3.4, -1.9], mat: 'cream' },
    { type: 'block', box: [34.9, 0, -4, 35.6, 3.0, -1.9], mat: 'brick' },
    { type: 'shard', pos: [34.0, 4.1, -3.0] },
    // optional cage in the south wall: bars in the window, a shard on the floor inside
    { type: 'block', box: [26, 0, 4, 29.5, 0.5, 4.4], mat: 'brick' },
    { type: 'block', box: [26, 3.1, 4, 29.5, 4.0, 4.4], mat: 'brick' },
    { type: 'block', box: [26, 0.5, 4, 26.6, 3.1, 4.4], mat: 'brick' },
    { type: 'block', box: [28.9, 0.5, 4, 29.5, 3.1, 4.4], mat: 'brick' },
    { type: 'grate', box: [26.6, 0.5, 4.05, 28.9, 3.1, 4.35] },
    { type: 'block', box: [26, -1, 4.4, 29.5, 0, 7.4], mat: 'dark' },
    { type: 'block', box: [25.6, 0, 4.4, 26, 4.0, 7.8], mat: 'brick' },
    { type: 'block', box: [29.5, 0, 4.4, 29.9, 4.0, 7.8], mat: 'brick' },
    { type: 'block', box: [25.6, 0, 7.4, 29.9, 4.0, 7.8], mat: 'brick' },
    { type: 'block', box: [25.6, 4.0, 4, 29.9, 4.4, 7.8], mat: 'brick' },
    { type: 'shard', pos: [27.75, 1.5, 5.5] },
    { type: 'hint', key: 'cage', box: [25.5, 0, 0.8, 30, 3, 4] },

    // ------------------------------------------------------------------ chasm 2: the rack-bridge
    { type: 'fire', box: [40, -6, -4.4, 48, -4.5, 4.4] },
    { type: 'block', box: [40, -7, -4.4, 48, -6, 4.4], mat: 'dark' },
    // retracted inside hall B's floor; slides out to touch the far ledge while the plate is held
    { type: 'mover', id: 'bridge', box: [31.6, -0.5, -1.4, 40, -0.1, 1.4], to: [8.2, 0, 0], speed: 2.5, mode: 'toggle', on: 'hp', mat: 'clay' },

    // ------------------------------------------------------------------ hall C: the chimney
    { type: 'block', box: [48, -1, -4, 75, 0, 4], mat: 'tile' },
    { type: 'block', box: [48, 0, -4.4, 62, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [48, 0, 4, 62, 0.7, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [49.8, 0, 0] },
    { type: 'prop', kind: 'lamp', pos: [50.4, 0, -3.5] },
    { type: 'prop', kind: 'shelf', pos: [53.5, 0, 3.5], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [56.2, 0, -3.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [58.6, 0, 3.5] },
    { type: 'prop', kind: 'chimney', pos: [55, 0, -9], solid: false, scale: 1.2 },
    { type: 'hint', key: 'hatch', box: [58, 0, -4, 62.4, 3, 4] },
    // the chimney breast: a solid tower with a 3 m shaft cut into its west face, a lift inside it,
    // and a grate hatch in the roof of the shaft. The gallery is the tower's top.
    { type: 'block', box: [62, 0, -4, 65.4, 7.4, -1.5], mat: 'brick' },
    { type: 'block', box: [62, 0, 1.5, 65.4, 7.4, 4], mat: 'brick' },
    { type: 'block', box: [65, 0, -1.5, 65.4, 7.4, 1.5], mat: 'brick' },
    { type: 'mover', id: 'elevator', box: [62, -0.45, -1.5, 65, -0.05, 1.5], to: [0, 4.2, 0], speed: 1.8, pause: 2.5, mat: 'metal' },
    { type: 'grate', box: [62, 7.0, -1.5, 65, 7.4, 1.5] },
    { type: 'block', box: [65.4, 0, -4, 75, 7.4, 4], mat: 'tile' },
    { type: 'block', box: [65.4, 7.4, -4, 75, 8.1, -3.6], mat: 'brick' },
    { type: 'block', box: [65.4, 7.4, 3.6, 75, 8.1, 4], mat: 'brick' },
    { type: 'prop', kind: 'lamp', pos: [67.4, 7.4, -3.2] },
    { type: 'prop', kind: 'pots', pos: [68.8, 7.4, 2.6], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [70.6, 7.4, 3.2] },
    { type: 'block', box: [74.5, 7.4, -4, 75, 11, 4], mat: 'brick' },
    { type: 'exit', pos: [72.4, 7.4, 0], face: '-x' },
  ],
};
