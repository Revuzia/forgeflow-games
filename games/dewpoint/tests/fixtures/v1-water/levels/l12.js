// Level 12 - "The Great Kiln". The finale: relight the kiln. Three burners wake in three rooms, then the
// chimney draws and the kiln itself takes you in. Every form is asked for once:
//   1. The Stokehole  - liquid douses an ember bar, film crawls through the gap it guarded and closes
//                       an electrode circuit: burner A. A door lets you out.
//   2. The Culvert    - the hall is walled off, but a grille in the floor drops film into a water channel
//                       that runs under the wall: burner B lights when you surface. (The shard on the
//                       channel bed wants ice, then a drop again: three forms in one dive.)
//   3. The Cold Well  - a flooded well with no way round and frost over it: you freeze, sink onto the heavy
//                       plate at the bottom, the plate stops the frost, and a drop floats back up: burner C.
//   4. The Throat     - with all three lit the chimney draws: a vent lifts you (forced steam) through
//                       jets of flame; steer to the clear side each time.
//   5. The Plunge     - on the crown, frost freezes you and the slope does the rest: down the long slide,
//                       through the glass, into the kiln.
// Signals: latch (burners), and (lit), not (frost off once C is lit). Layout runs along +X; floor 0, crown 14.

export default {
  id: 'l12',
  name: 'The Great Kiln',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  hints: {
    start: 'The Great Kiln has gone cold. Wake its three burners, climb the chimney, and let the heat take you in.',
    ember: 'A smouldering line across the wall foot. A drop puts it out, but the gap beneath is only film high.',
    film: 'Two posts and a bare strip: the circuit again. Film closes it and lights the first burner above.',
    culvert: 'Film slips through the floor grille; the current beyond carries what floats. {liquid} once in open water.',
    well: 'A flooded well with frost over it, and no way round. You will freeze and sink; something heavy waits below.',
    throat: 'The chimney lifts you whether you like it or not. Flames come from alternate walls: keep to the clear side.',
    plunge: 'The kiln mouth is sealed with glass far below. Step into the frost, and let the slope take you.',
  },
  signals: {
    burnA: { latch: 'arc' },
    burnB: { latch: 'inPool' },
    burnC: { latch: 'plateC' },
    lit: { and: ['burnA', 'burnB', 'burnC'] },
  },
  pieces: [
    // ================================================================ 1. the Stokehole
    { type: 'block', box: [-4, -1, -5, 30, 0, 5], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -5, -4, 0.8, 5], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [-2, 0, -9.5], rot: 0, scale: 3, solid: false },     // the cold giant, off to one side
    { type: 'prop', kind: 'shelf', pos: [3.4, 0, -4.3], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [6.2, 0, -4.2] },
    { type: 'prop', kind: 'lamp', pos: [2.2, 0, 4.2] },
    { type: 'prop', kind: 'lamp', pos: [8.6, 0, 4.2] },
    { type: 'prop', kind: 'pots', pos: [-2.6, 0, 3.4], scale: 0.9 },
    { type: 'shard', pos: [5, 0.7, 2.8] },
    { type: 'checkpoint', pos: [8.6, 0, 0] },
    { type: 'hint', key: 'ember', box: [7.4, 0, -4.4, 10.4, 3, 4.4] },
    // the wall with an ember bar at its foot
    { type: 'block', box: [11, 0, -5.4, 11.4, 9, -1.2], mat: 'brick' },
    { type: 'block', box: [11, 0, 1.2, 11.4, 9, 5.4], mat: 'brick' },
    { type: 'block', box: [11, 0.3, -1.2, 11.4, 9, 1.2], mat: 'brick' },
    { type: 'ember', id: 'bar', box: [10.3, 0, -1.2, 11.4, 0.3, 1.2] },          // a pile of embers heaped in front of the gap
    // behind it: electrodes, and the first burner on the wall
    { type: 'hint', key: 'film', box: [11.8, 0, -4.4, 13.8, 3, 4.4] },
    { type: 'electrodes', id: 'arc', box: [14.3, 0, -0.5, 15.7, 0.4, 0.5], axis: 'x', emit: 'arc' },
    { type: 'block', box: [14.2, 2.2, -5.4, 17.8, 2.6, -4.7], mat: 'metal' },
    { type: 'fire', id: 'burnerA', box: [14.5, 2.6, -5.4, 17.5, 4.0, -4.7], on: 'burnA' },
    { type: 'prop', kind: 'pots', pos: [12.4, 0, 3.8], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [19.0, 0, -4.2] },
    { type: 'prop', kind: 'lamp', pos: [19.0, 0, 4.2] },
    // the door out
    { type: 'block', box: [20, 0, -5.4, 20.4, 9, -1.2], mat: 'brick' },
    { type: 'block', box: [20, 0, 1.2, 20.4, 9, 5.4], mat: 'brick' },
    { type: 'block', box: [20, 3, -1.2, 20.4, 9, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorA', box: [20.03, 0, -1.2, 20.37, 3, 1.2], on: 'burnA' },

    // ================================================================ 2. the Culvert
    { type: 'checkpoint', pos: [27, 0, 0] },
    { type: 'hint', key: 'culvert', box: [22.4, 0, -4.4, 29, 3, 4.4] },
    { type: 'prop', kind: 'lamp', pos: [23.0, 0, -4.2] },
    { type: 'prop', kind: 'lamp', pos: [23.0, 0, 4.2] },
    { type: 'prop', kind: 'pots', pos: [25.6, 0, -4.0] },
    { type: 'block', box: [20.4, -5, -5, 30, -1, 5], mat: 'dark' },
    // the trench under the floor: strips either side, a bed, and a long grille over the channel
    { type: 'block', box: [30, -5, -5.4, 52, 0, -2.5], mat: 'tile' },
    { type: 'block', box: [30, -5, 2.5, 52, 0, 5.4], mat: 'tile' },
    { type: 'block', box: [30, -5, -2.5, 52, -3.4, 2.5], mat: 'dark' },
    { type: 'slot', id: 'grille', box: [30, -0.3, -2.5, 44, 0, 2.5] },                 // one long grille over the channel: you can watch the water run under it
    { type: 'current', id: 'culvert', box: [30, -3.4, -2.5, 44, -1.6, 2.5], flow: [2.5, 0] },
    { type: 'current', id: 'pool', box: [44, -3.4, -2.5, 52, -0.2, 2.5], flow: [0, 0] },
    { type: 'shard', pos: [35.6, -3.0, 0] },
    { type: 'block', box: [40, 0, -5.4, 40.4, 9, 5.4], mat: 'brick' },                       // the wall the water runs under
    { type: 'prop', kind: 'kiln', pos: [37, 0, -3.9], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [38.4, 0, 3.9] },
    { type: 'sensor', id: 'poolSensor', box: [46, -0.8, -2.2, 50.4, 0.6, 2.2], emit: 'inPool', visible: false },
    { type: 'block', box: [56, 2.2, -5.4, 59.6, 2.6, -4.7], mat: 'metal' },
    { type: 'fire', id: 'burnerB', box: [56.3, 2.6, -5.4, 59.3, 4.0, -4.7], on: 'burnB' },
    { type: 'prop', kind: 'lamp', pos: [42.4, 0, -4.2] },
    { type: 'prop', kind: 'pots', pos: [54.6, 0, 4.0], scale: 0.9 },

    // ================================================================ 3. the Cold Well
    { type: 'block', box: [52, -5.2, -5, 64, 0, 5], mat: 'tile' },
    { type: 'checkpoint', pos: [58, 0, 0] },
    { type: 'hint', key: 'well', box: [59.6, 0, -4.4, 62.6, 3, 4.4] },
    { type: 'block', box: [64, -5.4, -5, 69.5, -4.2, 5], mat: 'dark' },
    { type: 'current', id: 'wellWater', box: [64, -4.2, -5, 69.5, -0.4, 5], flow: [0, 0] },
    { type: 'frost', id: 'cold', box: [63.6, -4.2, -5, 69.9, 4, 5], on: '!burnC' },
    { type: 'plate', id: 'plateC', pos: [66.75, -4.2, 0], size: [2.4, 2.4], heavy: true, emit: 'plateC' },
    { type: 'block', box: [69.5, -5.2, -5, 97, 0, 5], mat: 'tile' },
    { type: 'checkpoint', pos: [73, 0, 0] },
    { type: 'block', box: [75, 2.2, -5.4, 78.6, 2.6, -4.7], mat: 'metal' },
    { type: 'fire', id: 'burnerC', box: [75.3, 2.6, -5.4, 78.3, 4.0, -4.7], on: 'burnC' },
    { type: 'prop', kind: 'lamp', pos: [72.4, 0, -4.2] },
    { type: 'prop', kind: 'lamp', pos: [72.4, 0, 4.2] },
    { type: 'prop', kind: 'shelf', pos: [81, 0, 4.3], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [84, 0, -4.1] },
    { type: 'checkpoint', pos: [88, 0, 0] },

    // the long flanks of the hall (also keep a cloud from floating round the walls)
    { type: 'block', box: [8, -5.4, -5.8, 90, 9, -5.4], mat: 'brick' },
    { type: 'block', box: [8, -5.4, 5.4, 90, 9, 5.8], mat: 'brick' },

    // ================================================================ 4. the Throat
    { type: 'hint', key: 'throat', box: [86, 0, -4.4, 89.6, 3, 4.4] },
    { type: 'block', box: [90, 0, -5.8, 97.4, 17, -5.4], mat: 'brick' },
    { type: 'block', box: [90, 0, 5.4, 97.4, 17, 5.8], mat: 'brick' },
    { type: 'heatvent', id: 'chimney', box: [90.4, 0, -4.8, 96.6, 14.8, 4.8], on: 'lit' },
    // three flame jets, from alternating walls: each fills one half of the shaft, so you keep to the other.
    // The shard hangs out wide in the clear gap after the first jet.
    { type: 'block', box: [90.4, 3.2, -5.4, 96.6, 3.6, 0], mat: 'metal' },
    { type: 'fire', id: 'jet1', box: [90.4, 3.6, -5.4, 96.6, 4.8, 0] },
    { type: 'block', box: [90.4, 6.6, 0, 96.6, 7.0, 5.4], mat: 'metal' },
    { type: 'fire', id: 'jet2', box: [90.4, 7.0, 0, 96.6, 8.2, 5.4] },
    { type: 'block', box: [90.4, 10, -5.4, 96.6, 10.4, 0], mat: 'metal' },
    { type: 'fire', id: 'jet3', box: [90.4, 10.4, -5.4, 96.6, 11.6, 0] },
    { type: 'shard', pos: [93.4, 7.0, -2.4] },

    // ================================================================ 5. the Crown and the Plunge
    { type: 'block', box: [97, -1, -5.4, 103, 13.6, 5.4], mat: 'brick' },
    { type: 'block', box: [97, 13.6, -5.4, 103, 14, 5.4], mat: 'tile' },
    { type: 'checkpoint', pos: [98.4, 14, 0] },
    { type: 'prop', kind: 'lamp', pos: [98.0, 14, -4.2] },
    { type: 'prop', kind: 'lamp', pos: [98.0, 14, 4.2] },
    { type: 'hint', key: 'plunge', box: [97.6, 14, -4.4, 99.2, 17, 4.4] },
    { type: 'frost', id: 'cold2', box: [99.4, 8, -5.4, 117, 17, 5.4] },
    { type: 'block', box: [103, -1, -5.4, 122, 8, 5.4], mat: 'brick' },
    { type: 'ramp', id: 'slide', box: [103, 8, -5, 115, 14, 5], up: '-x', mat: 'cream' },
    { type: 'block', box: [103, 8, -5.4, 117.3, 15.4, -5], mat: 'brick' },
    { type: 'block', box: [103, 8, 5, 117.3, 15.4, 5.4], mat: 'brick' },
    { type: 'block', box: [117, 8, -5.4, 117.3, 14, -5], mat: 'brick' },
    { type: 'block', box: [117, 8, 5, 117.3, 14, 5.4], mat: 'brick' },
    { type: 'block', box: [117, 11.6, -5, 117.3, 14, 5], mat: 'brick' },
    { type: 'pane', id: 'glass', box: [117.03, 8, -5, 117.27, 11.6, 5], speed: 9 },
    { type: 'block', box: [117.3, 8, -5.4, 121.6, 14, -5], mat: 'brick' },
    { type: 'block', box: [117.3, 8, 5, 121.6, 14, 5.4], mat: 'brick' },
    { type: 'block', box: [121, 8, -5, 121.6, 14, 5], mat: 'brick' },
    { type: 'exit', pos: [119.6, 8, 0], face: '-x', on: 'lit' },
  ],
};
