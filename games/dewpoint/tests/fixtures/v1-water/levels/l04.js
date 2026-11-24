// Level 4 - "Slip Casting". Film, properly: it slips between the slats of a slotted floor, crawls
// under low walls, and lying across a pair of electrodes closes a circuit.
//   1. The sieve floor: a wall bars the hall, but the floor is slats over a casting basin. Film drops
//      through, and the basin runs under the wall to a ramp on the far side.
//   2. A low wall hides a pair of electrodes; lying across them throws the latch on the next door.
//   3. The last room mixes in ice: shove a crate onto a heavy plate, then crawl under the low wall
//      to close the second circuit. Both together unseal the kiln door.
// Optional: a brick-rimmed casting pen in the basin holds a shard and its own electrodes.
// Layout runs along +X; see LEVELS.md for the format. Steam is locked so the walls mean something.

export default {
  id: 'l04',
  name: 'Slip Casting',
  chapter: 1,
  theme: 'slip',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['liquid', 'film', 'ice'],
  hints: {
    start: 'A slip room: moulds, pipes, one very tall wall. Look down through the slatted floor.',
    slot: 'Slats hold a drop up, but film slips between. {film}, then {liquid} to re-form below.',
    pen: 'Sealed in a casting pen? Lie flat across the two posts. Film closes a circuit.',
    spark: 'Film lying across two posts closes a circuit. Crawl under the wall and lie across them.',
    gate: 'The shutter wants both: something heavy on the plate, something thin on the posts.',
  },
  signals: {
    doorA: { latch: 'e1' },
    penDoor: { latch: 'e3' },
    exitOpen: { and: ['hp', { latch: 'e2' }] },
  },
  pieces: [
    // ------------------------------------------------------------------ hall A: the sieve floor
    // The whole floor is slats over a casting basin (floor at y = -1.6). Spawn stands on them.
    { type: 'slot', box: [-4, -0.4, -4, 13.4, 0, 4] },
    { type: 'block', box: [-4, -2.6, -4, 14.6, -1.6, 4], mat: 'dark' },                 // basin floor
    { type: 'block', box: [-4.5, -1.6, -4.4, -4, 0.8, 4.4], mat: 'brick' },             // west parapet
    { type: 'block', box: [-4.5, -1.6, -4.4, 20.6, 0.7, -4], mat: 'brick' },            // north basin wall
    { type: 'block', box: [-4.5, -1.6, 4, 20.6, 0.7, 4.4], mat: 'brick' },              // south basin wall
    // the tall wall; the basin runs underneath it (1.2 m of headroom)
    { type: 'block', box: [13.4, -0.4, -4.4, 14.6, 3.6, 4.4], mat: 'brick' },
    { type: 'hint', key: 'slot', box: [4, 0, -4, 13, 3, 4] },
    // the way up on the far side of the wall
    { type: 'ramp', box: [14.6, -1.6, -4, 20.6, 0, 4], up: '+x', mat: 'cream' },

    // dressing on the slats: moulds and pipes
    { type: 'prop', kind: 'shelf', pos: [-1.2, 0, 3.55], rot: 0 },
    { type: 'prop', kind: 'shelf', pos: [8.2, 0, 3.55], rot: 0 },
    { type: 'prop', kind: 'kiln', pos: [3.6, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'pots', pos: [-1, 0, -3.0] },
    { type: 'prop', kind: 'lamp', pos: [12.5, 0, 3.4] },
    // easy shard: a stack of plaster moulds beside the wall
    { type: 'block', box: [10, 0, -4, 11.5, 1.2, -2.5], mat: 'cream' },
    { type: 'shard', pos: [10.75, 1.95, -3.25] },

    // the basin below: lamps, pipes, a spill of pots
    { type: 'prop', kind: 'lamp', pos: [7.6, -1.6, 3.4] },
    { type: 'prop', kind: 'pipe', pos: [10.6, -1.6, 3.55], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [8.6, -1.6, -3.0] },
    { type: 'prop', kind: 'lamp', pos: [12.6, -1.6, -3.5] },

    // optional casting pen: brick rim flush with the floor, slats inside, door in the east wall
    { type: 'block', box: [2.0, -1.6, -4.0, 2.4, 0, -0.6], mat: 'brick' },
    { type: 'block', box: [2.0, -1.6, -1.0, 5.4, 0, -0.6], mat: 'brick' },
    { type: 'block', box: [5.0, -1.6, -4.0, 5.4, 0, -3.4], mat: 'brick' },
    { type: 'block', box: [5.0, -1.6, -1.6, 5.4, 0, -1.0], mat: 'brick' },
    { type: 'door', id: 'penDoor', box: [5.0, -1.6, -3.4, 5.4, 0, -1.6], on: 'penDoor' },
    { type: 'hint', key: 'pen', box: [2.4, -1.6, -4.0, 5.0, -0.9, -1.0] },
    { type: 'electrodes', id: 'e3', box: [3.1, -1.6, -2.6, 4.5, -1.2, -1.4], axis: 'x', emit: 'e3' },
    { type: 'shard', pos: [3.0, -0.9, -3.35] },

    // ------------------------------------------------------------------ hall B: the posts
    { type: 'block', box: [20.6, -1, -4, 35.6, 0, 4], mat: 'tile' },
    { type: 'block', box: [20.6, 0, -4.4, 35.6, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [20.6, 0, 4, 35.6, 0.7, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [22.4, 0, 0] },
    { type: 'prop', kind: 'kiln', pos: [24.6, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'lamp', pos: [21.4, 0, -3.5] },
    { type: 'prop', kind: 'pipe', pos: [24.4, 0, -3.5], rot: 0 },
    { type: 'hint', key: 'spark', box: [23.6, 0, -4, 26.5, 3, 4] },
    // low wall with a 0.3 m gap, electrodes behind it
    { type: 'block', box: [27, 0.3, -4.4, 28.6, 3.6, 4.4], mat: 'brick' },
    { type: 'electrodes', id: 'e1', box: [30.4, 0, -0.7, 31.8, 0.4, 0.7], axis: 'x', emit: 'e1' },
    { type: 'prop', kind: 'pots', pos: [32.4, 0, -3.1], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [29.8, 0, 3.4] },
    // shutter wall with a door the posts open
    { type: 'block', box: [35, 0, -4.4, 35.6, 3.6, -1.2], mat: 'brick' },
    { type: 'block', box: [35, 0, 1.2, 35.6, 3.6, 4.4], mat: 'brick' },
    { type: 'block', box: [35, 3, -1.2, 35.6, 3.6, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorA', box: [35.05, 0, -1.2, 35.55, 3, 1.2], on: 'doorA' },

    // ------------------------------------------------------------------ room C: heavy and thin
    { type: 'block', box: [35.6, -1, -4, 64, 0, 4], mat: 'tile' },
    { type: 'block', box: [35.6, 0, -4.4, 64, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [35.6, 0, 4, 64, 0.7, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [38.6, 0, 0.8] },
    { type: 'prop', kind: 'kiln', pos: [37.0, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'lamp', pos: [43.2, 0, 3.5] },
    { type: 'hint', key: 'gate', box: [36, 0, -4, 39, 3, 1] },
    { type: 'crate', id: 'crate', pos: [40.5, 0, -1.5] },
    { type: 'plate', id: 'hp', pos: [47.5, 0, 2.0], size: [1.7, 1.7], heavy: true, emit: 'hp' },
    // off the path: a shelf only film fits under
    { type: 'block', box: [43, 0.3, -4, 46.4, 1.2, -2.6], mat: 'cream' },
    { type: 'shard', pos: [44.7, 0.2, -3.3] },
    { type: 'prop', kind: 'pots', pos: [44.6, 1.2, -3.4], scale: 0.9 },
    // low wall, then the second pair of posts, then the kiln door
    { type: 'block', box: [53, 0.3, -4.4, 54.6, 3.6, 4.4], mat: 'brick' },
    { type: 'electrodes', id: 'e2', box: [56.4, 0, -0.7, 57.8, 0.4, 0.7], axis: 'x', emit: 'e2' },
    { type: 'prop', kind: 'lamp', pos: [58.6, 0, -3.6] },
    { type: 'prop', kind: 'pots', pos: [56.0, 0, 3.0], scale: 0.9 },
    { type: 'block', box: [63.4, 0, -4.4, 64, 3.6, 4.4], mat: 'brick' },
    { type: 'exit', pos: [61.6, 0, 0], face: '-x', on: 'exitOpen' },
  ],
};
