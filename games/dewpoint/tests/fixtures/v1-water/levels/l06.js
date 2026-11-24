// Level 6 - "Greenware". Teaches what a plain drop can do: put out embers and water sprouts.
//   1. A doorway is stuffed with glowing embers. Only water puts them out. Just beyond, a thirsty
//      bud grows into a ladder of leaves up a 3 m cliff.
//   2. On the gallery, an ember sits on a pillar no jump can reach. Rise as steam, hover over it,
//      condense: the rain puts it out and the door it was holding shut opens.
//   3. A bud on a ledge only a cloud can reach. Steam up, condense beside it, and climb the plant
//      the rest of the way to the kiln door.
// Optional: an ember-stuffed nook (shard), and a barred greenhouse with a bud inside (shard).
// Walls around the gates are taller than a full steam gauge can climb (5.5 m), with tall flanks,
// so steam cannot go over or around them. Layout runs along +X; see LEVELS.md for the format.

export default {
  id: 'l06',
  name: 'Greenware',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['liquid', 'steam'],
  hints: {
    start: 'Raw clay waits for the kiln here. Warm things block the way; a drop of water is what they want.',
    ember: 'Embers block the way until water touches them. Run into them as a drop to put them out for good.',
    sprout: 'A thirsty bud. Stand close as a drop and it grows a ladder of leaves. Hop up beside the stalk.',
    rain: 'Too high to jump. {steam}, float over the embers, then {liquid} to rain down.',
    cage: 'Bars stop a drop, not a cloud. A bud waits inside. Condense beside it and it will grow.',
    bud: 'A bud on a ledge too high to jump. Clouds rise. Once you are a drop beside it, it will grow.',
  },
  signals: {},
  pieces: [
    // ------------------------------------------------------------------ hall A: the ember doorway
    { type: 'block', box: [-4, -1, -4, 14, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4.4, -4, 0.8, 4.4], mat: 'brick' },
    { type: 'block', box: [-4.5, 0, -4.4, 8, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [-4.5, 0, 4, 8, 0.7, 4.4], mat: 'brick' },
    // tall flanks around the doorway wall so steam cannot slip round it
    { type: 'block', box: [8, 0, 4, 22.2, 6.4, 4.4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [2.6, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'shelf', pos: [-1.6, 0, -3.5], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [3.4, 0, -3.1], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [6.6, 0, -3.5] },
    { type: 'prop', kind: 'chimney', pos: [-2, 0, 7.5], solid: false },
    // easy shard: on a stack of unfired moulds
    { type: 'block', box: [10.4, 0, 2.4, 12, 1.2, 4], mat: 'cream' },
    { type: 'shard', pos: [11.2, 1.95, 3.2] },
    { type: 'hint', key: 'ember', box: [8.4, 0, -4, 13.2, 3, 4] },
    // the doorway wall, stuffed with embers
    { type: 'block', box: [14, 0, -4.4, 14.6, 6.4, -1.2], mat: 'brick' },
    { type: 'block', box: [14, 0, 1.2, 14.6, 6.4, 4.4], mat: 'brick' },
    { type: 'block', box: [14, 2.6, -1.2, 14.6, 6.4, 1.2], mat: 'brick' },
    { type: 'ember', id: 'doorEmbers', box: [13.9, 0, -1.2, 14.7, 2.6, 1.2] },

    // ------------------------------------------------------------------ hall B: the bud and the nook
    { type: 'block', box: [14, -1, -4, 22.2, 0, 4], mat: 'tile' },
    { type: 'prop', kind: 'lamp', pos: [15.4, 0, 3.5] },
    { type: 'prop', kind: 'pots', pos: [16.4, 0, 2.6], scale: 0.9 },
    { type: 'hint', key: 'sprout', box: [16.6, 0, -4, 19.8, 3, 4] },
    { type: 'sprout', id: 'bud1', pos: [21.2, 0, 0], height: 3, axis: 'z' },
    // optional nook in the north wall, stuffed with embers, a shard inside
    { type: 'block', box: [8, 0, -4.4, 17, 6.4, -4], mat: 'brick' },
    { type: 'block', box: [19, 0, -4.4, 22.2, 6.4, -4], mat: 'brick' },
    { type: 'block', box: [17, 2.4, -4.4, 19, 6.4, -4], mat: 'brick' },
    { type: 'ember', id: 'nookEmbers', box: [17, 0, -4.5, 19, 2.4, -3.8] },
    { type: 'block', box: [17, -1, -7.8, 19, 0, -4.4], mat: 'dark' },
    { type: 'block', box: [16.6, 0, -7.8, 17, 4, -4.4], mat: 'brick' },
    { type: 'block', box: [19, 0, -7.8, 19.4, 4, -4.4], mat: 'brick' },
    { type: 'block', box: [16.6, 0, -7.8, 19.4, 4, -7.4], mat: 'brick' },
    { type: 'block', box: [16.6, 4, -7.8, 19.4, 4.4, -4], mat: 'brick' },
    { type: 'prop', kind: 'lamp', pos: [17.5, 0, -7.0] },
    { type: 'shard', pos: [18.2, 0.8, -5.6] },

    // ------------------------------------------------------------------ gallery: rain on the pillar
    { type: 'block', box: [22.2, -1, -4, 72, 3, 4], mat: 'tile' },
    { type: 'block', box: [22.2, 3, -4.4, 34, 3.7, -4], mat: 'brick' },
    { type: 'block', box: [22.2, 3, 4, 34, 3.7, 4.4], mat: 'brick' },
    { type: 'block', box: [34, 3, -4.4, 46, 9.4, -4], mat: 'brick' },
    { type: 'block', box: [46, 3, -4.4, 52, 3.7, -4], mat: 'brick' },
    { type: 'block', box: [47.5, 3, 4, 52, 3.7, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [24.2, 3, 0] },
    { type: 'prop', kind: 'lamp', pos: [23.8, 3, -3.5] },
    { type: 'prop', kind: 'pots', pos: [25.4, 3, 2.6], scale: 0.9 },
    { type: 'prop', kind: 'pipe', pos: [28.5, 3, 3.5], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [33.4, 3, 3.5] },
    { type: 'hint', key: 'rain', box: [25, 3, -4, 29, 6, 4] },
    // the ember on its pillar (3.2 m: too high to jump, easy for a cloud)
    { type: 'block', box: [30, 3, -3, 32, 6.2, -1], mat: 'brick' },
    { type: 'ember', id: 'pillarEmbers', box: [30.2, 6.2, -2.8, 31.8, 6.8, -1.2], emit: 'e2' },
    // the door it keeps shut: wall taller than a steam gauge can climb, flanks the same
    { type: 'block', box: [40, 3, -4.4, 40.6, 9.4, -1.2], mat: 'brick' },
    { type: 'block', box: [40, 3, 1.2, 40.6, 9.4, 4.4], mat: 'brick' },
    { type: 'block', box: [40, 6, -1.2, 40.6, 9.4, 1.2], mat: 'brick' },
    { type: 'door', id: 'gate', box: [40.05, 3, -1.2, 40.55, 6, 1.2], on: 'e2' },
    { type: 'block', box: [34, 3, 4, 43.5, 9.4, 4.4], mat: 'brick' },
    // greenhouse (optional): bars in the window, a bud inside, a shard on the top leaf
    { type: 'block', box: [43.5, 3, 4, 47.5, 3.5, 4.4], mat: 'brick' },
    { type: 'block', box: [43.5, 6.4, 4, 47.5, 9.4, 4.4], mat: 'brick' },
    { type: 'block', box: [43.5, 3.5, 4, 44.1, 6.4, 4.4], mat: 'brick' },
    { type: 'block', box: [46.9, 3.5, 4, 47.5, 6.4, 4.4], mat: 'brick' },
    { type: 'grate', box: [44.1, 3.5, 4.05, 46.9, 6.4, 4.35] },
    { type: 'block', box: [43.5, 2, 4.4, 47.5, 3, 7.6], mat: 'dark' },
    { type: 'block', box: [43.1, 3, 4.4, 43.5, 7.8, 7.6], mat: 'brick' },
    { type: 'block', box: [47.5, 3, 4.4, 47.9, 7.8, 7.6], mat: 'brick' },
    { type: 'block', box: [43.1, 3, 7.6, 47.9, 7.8, 8.0], mat: 'brick' },
    { type: 'block', box: [43.1, 7.8, 4, 47.9, 8.2, 8.0], mat: 'brick' },
    { type: 'sprout', id: 'budCage', pos: [45.5, 3, 6.0], height: 3, axis: 'x' },
    { type: 'shard', pos: [45.5, 6.75, 6.0] },
    { type: 'hint', key: 'cage', box: [43.3, 3, 0.6, 47.7, 6, 4] },
    { type: 'prop', kind: 'lamp', pos: [43.6, 3, -3.5] },
    { type: 'checkpoint', pos: [42.2, 3, 0] },

    // ------------------------------------------------------------------ the tower: a bud on a ledge
    { type: 'block', box: [52, 3, -4, 56.4, 6.4, 4], mat: 'brick' },
    { type: 'block', box: [56.4, 3, -4, 72, 13, 4], mat: 'tile' },
    { type: 'block', box: [52, 6.4, -4.4, 56.4, 7.1, -4], mat: 'brick' },
    { type: 'block', box: [52, 6.4, 4, 56.4, 7.1, 4.4], mat: 'brick' },
    { type: 'hint', key: 'bud', box: [48, 3, -4, 52, 6, 4] },
    { type: 'prop', kind: 'lamp', pos: [49.4, 3, 3.4] },
    { type: 'prop', kind: 'lamp', pos: [53.2, 6.4, -3.3] },
    { type: 'sprout', id: 'bud2', pos: [55.5, 6.4, 0], height: 6.6, axis: 'z' },
    // the kiln door on top
    { type: 'block', box: [56.4, 13, -4.4, 71, 13.7, -4], mat: 'brick' },
    { type: 'block', box: [56.4, 13, 4, 71, 13.7, 4.4], mat: 'brick' },
    { type: 'prop', kind: 'lamp', pos: [59.0, 13, -3.3] },
    { type: 'prop', kind: 'pots', pos: [61.4, 13, 2.6], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [64.4, 13, 3.3] },
    { type: 'block', box: [70.5, 13, -4.4, 71, 17, 4.4], mat: 'brick' },
    { type: 'exit', pos: [68.4, 13, 0], face: '-x' },
  ],
};
