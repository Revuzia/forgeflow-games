// Level 7 - "Crazing". The top of the Drying Loft. Teaches that fans do not move ice or film.
//   1. A gale in a corridor blows drops and clouds straight back. Ice and film do not notice.
//   2. A second gale ends in cracked glass. Film cannot break it; ice with a run-up can.
//   3. The finale: a bud up a 6 m cliff (water it), embers in the doorway (a drop puts them out),
//      then freeze and let go down a long ramp into a wall of glass and the kiln door.
// Optional: a shard in a dead-end draught (ice or film only), and a shard in a pit under a glass
// floor (jump as a drop, freeze at the top of the jump, and land hard).
// The walls on the last run are taller than a steam gauge can climb, so steam cannot skip the gates.
// Layout runs along +X; see LEVELS.md for the format.

export default {
  id: 'l07',
  name: 'Crazing',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  hints: {
    start: 'The top of the Drying Loft. Great fans keep the air moving, and the rafter glass has crazed with age.',
    gale: 'A gale blows drops and clouds back; ice is too heavy to notice it. {ice}, then walk in.',
    gale2: 'This gale ends in cracked glass. Film is too gentle for it. Ice, with a little run-up, is not.',
    floor: 'Cracked glass underfoot. A drop is too light to break it; ice that has fallen from a height might.',
    sprout: 'The glass run is up there. A bud will get you up the cliff.',
    run: 'Embers in the doorway again. Then a long drop and a wall of glass: put them out, freeze, let go.',
  },
  signals: {},
  pieces: [
    // ------------------------------------------------------------------ hall A
    { type: 'block', box: [-4, -1, -4, 12, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4.4, -4, 0.8, 4.4], mat: 'brick' },
    { type: 'block', box: [-4.5, 0, -4.4, 12, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [-4.5, 0, 4, 12, 0.7, 4.4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [2.8, 0, 2.9], rot: 180 },
    { type: 'prop', kind: 'shelf', pos: [-2.0, 0, -3.5], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [3.4, 0, -3.1], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [10.6, 0, -3.5] },
    { type: 'prop', kind: 'chimney', pos: [-2.5, 0, 8], solid: false, scale: 1.2 },
    { type: 'prop', kind: 'chimney', pos: [7, 0, -9], solid: false },
    // easy shard: on a stack of drying boards
    { type: 'block', box: [8.2, 0, 2.2, 9.8, 1.2, 3.8], mat: 'cream' },
    { type: 'shard', pos: [9.0, 1.95, 3.0] },
    { type: 'hint', key: 'gale', box: [9.8, 0, -4, 12, 3, 4] },

    // ------------------------------------------------------------------ gale one (head wind, 12 m)
    { type: 'block', box: [12, -1, -4, 24, 0, 4], mat: 'tile' },
    { type: 'block', box: [12, 0, -4.4, 24, 7, -4], mat: 'brick' },
    { type: 'block', box: [12, 0, 4, 24, 7, 4.4], mat: 'brick' },
    { type: 'fan', id: 'gale1', box: [12, 0, -4, 24, 7, 4], dir: '-x', strength: 9 },

    // ------------------------------------------------------------------ hall B (and a draughty alcove)
    { type: 'block', box: [24, -1, -4, 34, 0, 4], mat: 'tile' },
    { type: 'block', box: [24, 0, -4.4, 34, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [24, 0, 4, 28, 0.7, 4.4], mat: 'brick' },
    { type: 'block', box: [31, 0, 4, 34, 0.7, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [25.4, 0, 0] },
    { type: 'prop', kind: 'lamp', pos: [25.0, 0, -3.5] },
    { type: 'prop', kind: 'pots', pos: [26.4, 0, -3.0], scale: 0.9 },
    { type: 'prop', kind: 'kiln', pos: [32.2, 0, -2.9], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [24.8, 0, 3.4] },
    { type: 'block', box: [28, -1, 4, 31, 0, 9.4], mat: 'dark' },
    { type: 'block', box: [27.6, 0, 4, 28, 3.6, 9.8], mat: 'brick' },
    { type: 'block', box: [31, 0, 4, 31.4, 3.6, 9.8], mat: 'brick' },
    { type: 'block', box: [27.6, 0, 9.4, 31.4, 3.6, 9.8], mat: 'brick' },
    { type: 'fan', id: 'draught', box: [28, 0, 4, 31, 7, 9.4], dir: '-z', strength: 12 },
    { type: 'shard', pos: [29.5, 0.7, 8.4] },
    { type: 'hint', key: 'gale2', box: [31, 0, -4, 34, 3, 4] },

    // ------------------------------------------------------------------ gale two, ending in cracked glass
    { type: 'block', box: [34, -1, -4, 44.3, 0, 4], mat: 'tile' },
    { type: 'block', box: [34, 0, -4.4, 44.3, 7, -4], mat: 'brick' },
    { type: 'block', box: [34, 0, 4, 44.3, 7, 4.4], mat: 'brick' },
    { type: 'fan', id: 'gale2', box: [34, 0, -4, 43.4, 7, 4], dir: '-x', strength: 9 },
    { type: 'pane', id: 'paneA', box: [44, 0, -4, 44.3, 3.6, 4], speed: 6 },

    // ------------------------------------------------------------------ hall C: a glass floor, a bud
    { type: 'block', box: [44.3, -2.2, -4, 47.5, 0, 4], mat: 'tile' },
    { type: 'block', box: [47.5, -2.2, -4, 51.5, 0, -2], mat: 'tile' },
    { type: 'block', box: [47.5, -2.2, 2, 51.5, 0, 4], mat: 'tile' },
    { type: 'block', box: [51.5, -2.2, -4, 56.8, 0, 4], mat: 'tile' },
    { type: 'block', box: [47.5, -2.2, -2, 51.5, -1.2, 2], mat: 'dark' },                   // pit floor
    { type: 'pane', id: 'floorGlass', box: [47.5, -0.3, -2, 51.5, 0, 2], speed: 6.5 },
    { type: 'shard', pos: [49.5, -0.5, 0] },
    { type: 'hint', key: 'floor', box: [45.4, 0, -4, 47.4, 3, 4] },
    { type: 'block', box: [44.3, 0, -4.4, 56.8, 0.7, -4], mat: 'brick' },
    { type: 'block', box: [44.3, 0, 4, 56.8, 0.7, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [45.4, 0, 3.0] },
    { type: 'prop', kind: 'lamp', pos: [45.4, 0, -3.5] },
    { type: 'prop', kind: 'pots', pos: [53.2, 0, 2.7], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [52.4, 0, -3.5] },
    { type: 'hint', key: 'sprout', box: [52, 0, -4, 54.6, 3, 4] },
    { type: 'sprout', id: 'bud', pos: [55.8, 0, 0], height: 6, axis: 'z' },

    // ------------------------------------------------------------------ the glass run
    { type: 'block', box: [56.8, -1, -4, 68, 6, 4], mat: 'tile' },
    { type: 'ramp', box: [68, 0, -4, 80, 6, 4], up: '-x', mat: 'cream' },
    { type: 'block', box: [80, -1, -4, 92, 0, 4], mat: 'tile' },
    // flanks: taller than a steam gauge can climb, all the way along
    { type: 'block', box: [56.8, -1, -4.4, 92.4, 12, -4], mat: 'brick' },
    { type: 'block', box: [56.8, -1, 4, 92.4, 12, 4.4], mat: 'brick' },
    { type: 'checkpoint', pos: [58.6, 6, 0] },
    { type: 'prop', kind: 'lamp', pos: [59.2, 6, -3.4] },
    { type: 'prop', kind: 'pots', pos: [61.0, 6, 2.6], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [64.0, 6, 3.4] },
    { type: 'hint', key: 'run', box: [60, 6, -4, 66, 9, 4] },
    // the doorway at the crest, stuffed with embers
    { type: 'block', box: [67, 6, -4, 68, 12, -1.2], mat: 'brick' },
    { type: 'block', box: [67, 6, 1.2, 68, 12, 4], mat: 'brick' },
    { type: 'block', box: [67, 8.6, -1.2, 68, 12, 1.2], mat: 'brick' },
    { type: 'ember', id: 'crestEmbers', box: [66.9, 6, -1.2, 68.1, 8.6, 1.2] },
    // the wall of glass at the foot of the slide, and the kiln door behind it
    { type: 'pane', id: 'paneB', box: [84, 0, -4, 84.3, 12, 4], speed: 11 },
    { type: 'prop', kind: 'lamp', pos: [86.4, 0, -3.5] },
    { type: 'prop', kind: 'lamp', pos: [86.4, 0, 3.5] },
    { type: 'block', box: [91.8, 0, -4, 92.4, 12, 4], mat: 'brick' },
    { type: 'exit', pos: [90.2, 0, 0], face: '-x' },
  ],
};
