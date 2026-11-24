// Level 10 - "Quench". Frost zones force ice, and the level goes down into the cellars to use it.
//   1. A frost-lined slide: the cold freezes you at the top, gravity does the rest, and the speed
//      smashes the glass at the bottom (safe: nothing to get wrong, and no way back up).
//   2. The cold store: frost fills the room, so you stay ice - and a grate in the far wall wants steam.
//      A plate switches the frost off, but only a crate can hold it down while you change shape.
//   3. The quench tank: curtains of kiln flame hang across the water. A drop floats into them; ice sinks
//      underneath and walks the bottom.
// Layout runs along +X and DOWN: hall 1 (floor 0), the cold store and the tank (floor -3, water -3.2).

export default {
  id: 'l10',
  name: 'Quench',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  hints: {
    start: 'The quench tank, where fired ware was cooled. The cold down there will not ask what you want to be.',
    frost: 'Frost freezes you solid until you leave it. Ice slides, shoves crates, and smashes cracked glass if fast.',
    store: 'The far wall is a steam grate. Something here must switch the frost off. Stuck? {restart}.',
    thaw: 'That plate shuts the frost off only while the crate sits on it. Leave it there; then you can be a cloud again.',
    tank: 'Flames hang across the water and a drop floats straight into them. Ice sinks beneath; the bottom does not move.',
    pool: 'Calm water at last. {liquid} and a melted drop floats back up to the surface.',
  },
  signals: {},
  pieces: [
    // --- hall 1 (floor 0): racks, a kiln, and the top of the slide
    { type: 'block', box: [-4, -1, -4, 12, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [0.8, 0, -3.0], rot: 0 },
    { type: 'prop', kind: 'shelf', pos: [4.2, 0, -3.5], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [6.6, 0, -3.4] },
    { type: 'prop', kind: 'pots', pos: [-2.2, 0, 3.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [6.2, 0, 3.4] },
    { type: 'prop', kind: 'lamp', pos: [9.4, 0, -3.4] },
    { type: 'checkpoint', pos: [7.6, 0, 0] },
    { type: 'hint', key: 'frost', box: [8.2, 0, -4, 10.6, 4, 4] },
    { type: 'shard', pos: [11.2, 0.7, 1.0] },

    // --- the slide: 3 m down over 6 m, walled in, ending at a cracked pane
    { type: 'ramp', box: [12, -3, -3, 18, 0, 3], up: '-x', mat: 'cream' },
    { type: 'block', box: [12, -4, -3.4, 20.3, 1.2, -3], mat: 'brick' },
    { type: 'block', box: [12, -4, 3, 20.3, 1.2, 3.4], mat: 'brick' },
    { type: 'block', box: [20, -3, -5.8, 20.3, 3.5, -3], mat: 'brick' },
    { type: 'block', box: [20, -3, 3, 20.3, 3.5, 5.8], mat: 'brick' },
    { type: 'block', box: [20, 0.6, -3, 20.3, 3.5, 3], mat: 'brick' },
    { type: 'pane', id: 'seal', box: [20.03, -3, -3, 20.27, 0.6, 3], speed: 9 },

    // --- the cold store (floor -3): a crate, a plate that stops the frost, a grate
    { type: 'block', box: [18, -4, -5.8, 36.4, -3, 5.8], mat: 'tile' },
    { type: 'block', box: [20.3, -3, -5.8, 36.4, 3.5, -5.4], mat: 'brick' },
    { type: 'block', box: [20.3, -3, 5.4, 36.4, 3.5, 5.8], mat: 'brick' },
    { type: 'block', box: [36, -3, -5.4, 36.4, 3.5, -1.5], mat: 'brick' },
    { type: 'block', box: [36, -3, 1.5, 36.4, 3.5, 5.4], mat: 'brick' },
    { type: 'block', box: [36, 2.5, -1.5, 36.4, 3.5, 1.5], mat: 'brick' },
    { type: 'grate', id: 'vent', box: [36.05, -3, -1.5, 36.35, 2.5, 1.5] },
    { type: 'frost', id: 'cold', box: [10, -3, -5.8, 36, 3.5, 5.8], on: '!thaw' },
    { type: 'checkpoint', pos: [22, -3, -4.1] },
    { type: 'hint', key: 'store', box: [21, -3, -5.4, 24, 3, 5.4] },
    { type: 'crate', id: 'crate', pos: [24.5, -3, -2.5] },
    { type: 'plate', id: 'thawPlate', pos: [32.5, -3, 2.5], size: [1.6, 1.6], emit: 'thaw' },
    { type: 'hint', key: 'thaw', box: [31, -3, 0.6, 34, 3, 4.8] },
    { type: 'prop', kind: 'shelf', pos: [27.5, -3, -5.0], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [30.6, -3, -5.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [22.6, -3, 5.0] },
    { type: 'prop', kind: 'lamp', pos: [34.6, -3, -5.0] },
    // a ledge high up the wall: a shard for whoever can rise once the frost is gone
    { type: 'block', box: [33.8, 0.4, 3.2, 35.9, 1.0, 5.4], mat: 'cream' },
    { type: 'shard', pos: [34.8, 1.7, 4.3] },

    // --- the quench tank: flooded wall to wall, with curtains of flame across it
    { type: 'block', box: [36.4, -4.4, -5.8, 41.5, -3, 5.8], mat: 'tile' },
    { type: 'checkpoint', pos: [38.4, -3, 0] },
    { type: 'prop', kind: 'lamp', pos: [38.0, -3, -4.6] },
    { type: 'prop', kind: 'lamp', pos: [38.0, -3, 4.6] },
    { type: 'prop', kind: 'pots', pos: [40.2, -3, 4.1], scale: 0.9 },
    { type: 'hint', key: 'tank', box: [37.2, -3, -5.4, 41, 2, 5.4] },
    { type: 'block', box: [41.5, -5.4, -5.8, 60, -4.4, 5.8], mat: 'dark' },
    { type: 'block', box: [41.5, -5.4, -5.8, 60, 3.5, -5.4], mat: 'brick' },
    { type: 'block', box: [41.5, -5.4, 5.4, 60, 3.5, 5.8], mat: 'brick' },
    { type: 'current', id: 'flow', box: [41.5, -4.4, -5.4, 56, -3.2, 5.4], flow: [2.2, 0] },
    { type: 'current', id: 'pool', box: [56, -4.4, -5.4, 60, -3.2, 5.4], flow: [0, 0] },
    // three curtains of flame across the whole tank, from the water's surface up out of reach of any cloud
    { type: 'fire', id: 'flamesA', box: [46.6, -3.2, -5.4, 47.4, 14, 5.4] },
    { type: 'fire', id: 'flamesB', box: [50.6, -3.2, -5.4, 51.4, 14, 5.4] },
    { type: 'fire', id: 'flamesC', box: [54.6, -3.2, -5.4, 55.4, 14, 5.4] },
    { type: 'block', box: [46, 3.2, -5.4, 56, 3.5, 5.4], mat: 'metal' },                  // a burner gantry overhead, for show
    { type: 'shard', pos: [51, -4.05, -4.6] },
    { type: 'hint', key: 'pool', box: [56.4, -4.4, -5, 59.6, -3, 5] },
    { type: 'block', box: [60, -4.4, -5.8, 69, -3, 5.8], mat: 'tile' },
    { type: 'block', box: [60, -3, -5.8, 69, 0, -5.4], mat: 'brick' },
    { type: 'block', box: [60, -3, 5.4, 69, 0, 5.8], mat: 'brick' },
    { type: 'checkpoint', pos: [61.6, -3, 0] },
    { type: 'prop', kind: 'lamp', pos: [61.4, -3, -4.4] },
    { type: 'prop', kind: 'lamp', pos: [61.4, -3, 4.4] },
    { type: 'prop', kind: 'kiln', pos: [64, -3, 3.4], rot: 180 },
    { type: 'block', box: [67.4, -3, -5.4, 68, 2, 5.4], mat: 'brick' },
    { type: 'exit', pos: [66, -3, 0], face: '-x' },
  ],
};
