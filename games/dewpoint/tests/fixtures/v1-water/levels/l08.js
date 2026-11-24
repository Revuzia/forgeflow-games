// Level 8 - "Bone Dry". The exam that closes chapter 2 (the Drying Loft). One climb up through
// the loft's racks and every form is asked for once, in an order the level never explains twice:
//   drop   - waters a sprout and climbs its leaves,
//   film   - crawls under a low shelf to close an electrode circuit that opens a door,
//   steam  - floats up through a grate set into a ceiling,
//   ice    - shoves a crate off the top deck so it falls onto the heavy plate that unshutters the exit.
// Layout runs along +X, stepping up as it goes: floor 0, deck 3.6 (two rooms), loft 7.8.

export default {
  id: 'l08',
  name: 'Bone Dry',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  hints: {
    start: 'The kiln door at the top is shut. You will need everything you have learned: drop, ice, cloud, film.',
    sprout: 'A bud in a dry planter. Be a drop beside it and it grows a stair of leaves. Hop up beside the stalk.',
    film: 'A low shelf, two posts: film carries the current. {film}, crawl onto the strip, then {liquid}.',
    mover: 'This platform shuttles across the gap. Wait until it is level with the ledge, then step on.',
    hatch: 'Warm air rises through this grate. {steam} below it, float up, then {liquid} to land on top.',
    cage: 'A shard in a cage. A cloud fits through the grate and leaves the same way; the gauge refills while you stand.',
    crate: 'Crates can only be shoved, by ice. The plate you want is on the floor below the far edge. Mind the drop.',
    lock: 'The kiln door stays shuttered until something heavy rests on that plate - and keeps resting there.',
  },
  signals: {
    doorA: { latch: 'arc' },
  },
  pieces: [
    // --- the start hall: floor 0, a wall of racks, a planter with a sprout
    { type: 'block', box: [-4, -1, -4, 8.4, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [1.6, 0, -3.0], rot: 0 },
    { type: 'prop', kind: 'shelf', pos: [5.4, 0, -3.5], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [7.2, 0, -3.3] },
    { type: 'prop', kind: 'pots', pos: [-2.6, 0, 3.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [7.7, 0, -3.5] },
    { type: 'prop', kind: 'lamp', pos: [7.7, 0, 3.5] },
    { type: 'hint', key: 'sprout', box: [3.2, 0, -4, 6, 3, 4] },
    { type: 'sprout', id: 'seedA', pos: [6.2, 0, 0], height: 3.6, axis: 'z' },
    { type: 'shard', pos: [6.2, 4.4, 0] },

    // --- deck 1 (y 3.6): a film nook, a door that wants it, a shuttling platform
    { type: 'block', box: [8.4, -1, -4, 19, 3.4, 4], mat: 'brick' },
    { type: 'block', box: [8.4, 3.4, -4, 19, 3.6, 4], mat: 'tile' },
    { type: 'hint', key: 'film', box: [8.7, 3.6, -4, 10.4, 6, 4] },
    { type: 'block', box: [10.2, 3.9, -4, 14.2, 5.1, -1.2], mat: 'cream' },          // the shelf, 0.3 m off the floor
    { type: 'prop', kind: 'pots', pos: [10.8, 5.1, -3.2], scale: 0.8 },
    { type: 'electrodes', id: 'arc', box: [11.4, 3.6, -3.4, 12.8, 3.9, -2.6], axis: 'x', emit: 'arc' },
    // a second bud beside the shelf: its leaves lead up onto the shelf top
    { type: 'sprout', id: 'seedB', pos: [12.2, 3.6, -0.3], height: 1.5, axis: 'x' },
    { type: 'shard', pos: [13.4, 5.8, -2.8] },
    // the door, in a wall too tall and too wide for a cloud to float over or round
    { type: 'block', box: [15, -1, -9, 15.4, 11.8, -1.2], mat: 'brick' },
    { type: 'block', box: [15, -1, 1.2, 15.4, 11.8, 9], mat: 'brick' },
    { type: 'block', box: [15, 6.6, -1.2, 15.4, 11.8, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorA', box: [15.03, 3.6, -1.2, 15.37, 6.6, 1.2], on: 'doorA' },
    { type: 'prop', kind: 'lamp', pos: [18.4, 3.6, 3.5] },
    { type: 'prop', kind: 'lamp', pos: [18.4, 3.6, -3.5] },
    { type: 'checkpoint', pos: [17.2, 3.6, 0] },
    { type: 'hint', key: 'mover', box: [15.8, 3.6, -4, 19, 6, 4] },
    // the gap: kiln fire far below
    { type: 'fire', box: [19, -6, -6, 27, -4.5, 6] },
    { type: 'block', box: [19, -7, -6, 27, -6, 6], mat: 'dark' },
    { type: 'mover', id: 'ferry', box: [19, 3.2, -1.5, 22, 3.6, 1.5], to: [5, 0, 0], speed: 2.5, pause: 1.2, mat: 'metal' },

    // --- deck 2 (y 3.6) under the loft: the hatch, a cage, the plate
    { type: 'block', box: [27, -1, -4, 47, 3.4, 4], mat: 'brick' },
    { type: 'block', box: [27, 3.4, -4, 47, 3.6, 4], mat: 'tile' },
    { type: 'checkpoint', pos: [28.4, 3.6, 0] },
    { type: 'prop', kind: 'lamp', pos: [28.6, 3.6, 3.5] },
    { type: 'hint', key: 'hatch', box: [28, 3.6, -4, 31.8, 7, 4] },
    // the loft floor (y 7.8) with a grate hatch in it, held up on pillars
    { type: 'block', box: [28.4, 7.5, -4, 29.2, 7.8, 4], mat: 'cream' },
    { type: 'block', box: [31.6, 7.5, -4, 38.4, 7.8, 4], mat: 'cream' },
    { type: 'block', box: [29.2, 7.5, -4, 31.6, 7.8, -1.2], mat: 'cream' },
    { type: 'block', box: [29.2, 7.5, 1.2, 31.6, 7.8, 4], mat: 'cream' },
    { type: 'grate', id: 'hatch', box: [29.2, 7.5, -1.2, 31.6, 7.8, 1.2] },
    { type: 'block', box: [28.4, 3.6, -4, 28.9, 7.5, -3.5], mat: 'brick' },
    { type: 'block', box: [28.4, 3.6, 3.5, 28.9, 7.5, 4], mat: 'brick' },
    { type: 'block', box: [33.1, 3.6, 3.5, 33.6, 7.5, 4], mat: 'brick' },
    { type: 'block', box: [37.9, 3.6, -4, 38.4, 7.5, -3.5], mat: 'brick' },
    { type: 'block', box: [37.9, 3.6, 3.5, 38.4, 7.5, 4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [31.6, 3.6, 2.7], rot: 180 },
    // a cage under the loft: grate on its front, shard inside
    { type: 'hint', key: 'cage', box: [32.6, 3.6, -1.1, 37.4, 7, 2] },
    { type: 'block', box: [33.0, 3.6, -4.3, 33.3, 6.1, -1.1], mat: 'metal' },
    { type: 'block', box: [36.7, 3.6, -4.3, 37.0, 6.1, -1.1], mat: 'metal' },
    { type: 'block', box: [33.0, 3.6, -4.3, 37.0, 6.1, -4.0], mat: 'metal' },
    { type: 'block', box: [33.0, 5.8, -4.3, 37.0, 6.1, -1.1], mat: 'metal' },
    { type: 'grate', id: 'cage', box: [33.3, 3.6, -1.4, 36.7, 5.8, -1.1] },
    { type: 'shard', pos: [35, 4.3, -2.8] },

    // --- the loft (y 7.8): a crate, a long push, and a drop
    { type: 'block', box: [28.4, 7.8, -4, 38.4, 8.5, -3.6], mat: 'brick' },           // kerbs: ice does not slide off the sides
    { type: 'block', box: [28.4, 7.8, 3.6, 38.4, 8.5, 4], mat: 'brick' },
    { type: 'block', box: [28.4, 7.8, -3.6, 28.8, 8.5, 3.6], mat: 'brick' },
    { type: 'checkpoint', pos: [32, 7.8, 0.9] },
    { type: 'hint', key: 'crate', box: [29.2, 7.8, -3.6, 34, 10, 3.6] },
    { type: 'crate', id: 'crate', pos: [35, 7.8, 0] },
    { type: 'prop', kind: 'lamp', pos: [34.4, 7.8, 3.2] },
    { type: 'prop', kind: 'pots', pos: [30.2, 7.8, -3.4], scale: 0.8 },

    // --- the way out: a heavy plate on the floor under the loft's far edge
    { type: 'plate', id: 'hp', pos: [38.9, 3.6, 0], size: [2.4, 2.4], heavy: true, emit: 'hp' },
    { type: 'hint', key: 'lock', box: [39.5, 3.6, -4, 43.5, 7, 4] },
    { type: 'prop', kind: 'lamp', pos: [42.6, 3.6, -3.5] },
    { type: 'prop', kind: 'lamp', pos: [42.6, 3.6, 3.5] },
    { type: 'prop', kind: 'pots', pos: [44.4, 3.6, 3.0], scale: 0.9 },
    { type: 'block', box: [46.4, 3.6, -4, 47, 8, 4], mat: 'brick' },
    { type: 'exit', pos: [45, 3.6, 0], face: '-x', on: 'hp' },
  ],
};
