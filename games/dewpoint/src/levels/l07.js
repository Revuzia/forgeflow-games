// Level 7 - "Crazing". The top of the Drying Loft. Teaches that fans do not move ice or film, and that
// ice going fast enough smashes cracked glass.
//   1. DRAUGHT HALL (teach):    a tail wind carries a drop over a pit (a jump no drop could make alone);
//                               a gale blows drops and clouds straight back, but ice does not notice it;
//                               the same gale goes on through a low tunnel where only film fits.
//   2. LOUVRE WALK (practise):  a narrow walkway over a pit in a crosswind that sweeps a drop or a cloud
//                               off. Ice sprints along it and smashes cracked glass on the pad; a long low
//                               tunnel beyond only film fits through. Ice first, then film.
//   3. CULLET CELLAR (twist):   a dead-end hall whose floor is cracked glass. A drop is too light; freeze
//                               at the top of a jump and the fall breaks it. Down in the cellar, a
//                               shaft with an updraft: ice and film stay put, a cloud rises.
//   4. CRAZED GLASS (combine):  a gale ends in cracked glass: ice with a run-up through the wind. Optional:
//                               a dead-end draught alcove (shard) and a glass floor over a pit (shard).
//                               Then a bud up a 6 m cliff.
//   5. THE GLASS RUN (payoff):  embers stuff the doorway at the crest; put them out, freeze, let go down
//                               the long slide, smashing three walls of glass, into the kiln door.
// Nothing here can be skipped as steam. A full gauge climbs 5.5 m from a standstill, but a drop that jumps
// first and boils at the top of the jump climbs about 7.3 m, so: cold air hangs over the dead-end room, the
// foot of the cliff and the crests of the glass run (a cloud made there condenses at once); the wall at the
// end of the room is wide enough that none goes round it; the cellar is 8.2 m deep, deeper than any cloud
// climbs; and the gales and the crosswind are far too strong for a cloud to fly through.
// Each area is written in its own local x (0 = where the previous one ended) and shifted into place.
// Layout runs along +X; see LEVELS.md for the format.

const kerbs = (x0, x1, y = 0, z = 4) => [
  { type: 'block', box: [x0, y, -z - 0.4, x1, y + 0.7, -z], mat: 'brick' },
  { type: 'block', box: [x0, y, z, x1, y + 0.7, z + 0.4], mat: 'brick' },
];

/** Tall side walls of a corridor (a fan fills it, so nothing can fly out over the top). */
const walls = (x0, x1, y0, y1, z = 4) => [
  { type: 'block', box: [x0, y0, -z - 0.4, x1, y1, -z], mat: 'brick' },
  { type: 'block', box: [x0, y0, z, x1, y1, z + 0.4], mat: 'brick' },
];

/** A pit of kiln fire under a gap from x0 to x1 (wide enough for a crosswind to blow a cloud into it). */
const pit = (x0, x1, z = 4.4, top = -4.5) => [
  { type: 'fire', box: [x0, top - 1.5, -z, x1, top, z] },
  { type: 'block', box: [x0, top - 2.5, -z, x1, top - 1.5, z], mat: 'dark' },
];

/** A cross wall to height y1 with a doorway (z -1.4..1.4, floor to y = head) stuffed with embers. */
const embered = (x, id, head, y1) => [
  { type: 'block', box: [x, 0, -4.4, x + 0.6, head, -1.4], mat: 'brick' },
  { type: 'block', box: [x, 0, 1.4, x + 0.6, head, 4.4], mat: 'brick' },
  { type: 'block', box: [x, head, -4.4, x + 0.6, y1, 4.4], mat: 'brick' },
  { type: 'ember', id, box: [x - 0.1, 0, -1.4, x + 0.7, head, 1.4] },
];

const at = (dx, list) => list.map((p) => ({
  ...p,
  ...(p.box ? { box: [p.box[0] + dx, p.box[1], p.box[2], p.box[3] + dx, p.box[4], p.box[5]] } : {}),
  ...(p.pos ? { pos: [p.pos[0] + dx, p.pos[1], p.pos[2]] } : {}),
}));

const LEN = [60, 60.3, 37, 34.8, 130.4];
const O = LEN.map((n, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));

const draughtHall = () => [
  // hall A: a kiln, racks, boards, and a tail wind that starts a few strides before the pit
  { type: 'block', box: [-4, -1, -4, 12, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4.4, -4, 0.8, 4.4], mat: 'brick' },
  ...kerbs(-4.5, 12),
  { type: 'prop', kind: 'kiln', pos: [2.8, 0, 2.9], rot: 180 },
  { type: 'prop', kind: 'shelf', pos: [-2.0, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [3.4, 0, -3.1], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [10.6, 0, -3.5] },
  { type: 'prop', kind: 'chimney', pos: [-2.5, 0, 8], solid: false, scale: 1.2 },
  { type: 'prop', kind: 'chimney', pos: [7, 0, -9], solid: false },
  { type: 'checkpoint', pos: [2.4, 0, -0.9] },
  // easy shard: on a stack of drying boards
  { type: 'block', box: [5.4, 0, 2.2, 7.0, 1.2, 3.8], mat: 'cream' },
  { type: 'shard', pos: [6.2, 1.95, 3.0] },
  { type: 'hint', key: 'tail', box: [7.5, 0, -4, 12, 3, 4] },
  // the pit: 4 m is too far to jump, but a tail wind carries a drop over
  ...pit(12, 16),
  { type: 'fan', id: 'tail', box: [7, 0.9, -4, 19.5, 5, 4], dir: '+x', strength: 8 },
  // hall B, then the first gale
  { type: 'block', box: [16, -1, -4, 26, 0, 4], mat: 'tile' },
  ...kerbs(16, 26),
  { type: 'prop', kind: 'lamp', pos: [19.6, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [23.0, 0, 2.8], scale: 0.9 },
  { type: 'hint', key: 'gale', box: [22.4, 0, -4, 26, 3, 4] },
  // one long gale: open to the sky for its first half (ice walks through it), then a tunnel too low for ice, where
  // only film fits - and wind does not move film either
  { type: 'block', box: [26, -1, -4, 66, 0, 4], mat: 'tile' },
  ...walls(26, 56, 0, 7),
  { type: 'prop', kind: 'lamp', pos: [39.4, 0, 3.4] },
  { type: 'prop', kind: 'pots', pos: [40.6, 0, -3.0], scale: 0.9 },
  { type: 'hint', key: 'beam', box: [38.4, 0, -4, 42, 3, 4] },
  { type: 'block', box: [42, 0.3, -4, 56, 0.9, 4], mat: 'brick' },
  { type: 'fan', id: 'gale1', box: [26, 0, -4, 56, 7, 4], dir: '-x', strength: 9 },
  ...kerbs(56, 66),
  { type: 'prop', kind: 'lamp', pos: [57.0, 0, -3.4] },
  { type: 'prop', kind: 'pots', pos: [59.4, 0, 2.8], scale: 0.9 },
  { type: 'prop', kind: 'shelf', pos: [62.4, 0, -3.5], rot: 0 },
];

const louvreWalk = () => [
  { type: 'block', box: [0, -1, -4, 8, 0, 4], mat: 'tile' },
  ...kerbs(0, 8),
  { type: 'checkpoint', pos: [2.2, 0, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.4, 0, 3.4] },
  { type: 'prop', kind: 'shelf', pos: [4.6, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [5.8, 0, 2.8], scale: 0.9 },
  { type: 'hint', key: 'cross', box: [3.4, 0, -4, 8, 3, 4] },
  // a long wall of louvres down the north side; the walkway runs between it and the pit
  { type: 'block', box: [8, -7, -4.6, 60.3, 4.4, -4.2], mat: 'brick' },
  ...pit(8, 20, 6),
  { type: 'block', box: [8, -1, -1.4, 20, 0, 1.4], mat: 'tile' },
  { type: 'fan', id: 'cross1', box: [8, 0, -4, 20, 3.5, 4], dir: '+z', strength: 9 },
  // the pad: no wind, room to run, and a wall of cracked glass across the way on
  { type: 'block', box: [20, -1, -4, 28, 0, 4], mat: 'tile' },
  ...kerbs(20, 28),
  { type: 'prop', kind: 'lamp', pos: [21.0, 0, 3.4] },
  { type: 'prop', kind: 'pots', pos: [24.0, 0, 2.7], scale: 0.9 },
  { type: 'hint', key: 'pad', box: [20.4, 0, -4, 25, 3, 4] },
  { type: 'block', box: [28, 0, -4, 28.3, 3.6, -1.4], mat: 'brick' },
  { type: 'block', box: [28, 0, 1.4, 28.3, 3.6, 4], mat: 'brick' },
  { type: 'block', box: [28, 3.0, -1.4, 28.3, 3.6, 1.4], mat: 'brick' },
  { type: 'pane', id: 'louvrePane', box: [28.03, 0, -1.4, 28.27, 3.0, 1.4], speed: 6 },
  // the far walkway: more wind, and a tunnel only film fits through
  ...pit(28.3, 54.3, 6),
  { type: 'block', box: [28.3, -1, -1.4, 54.3, 0, 1.4], mat: 'tile' },
  { type: 'fan', id: 'cross2', box: [28.3, 0, -4, 54.3, 3.5, 4], dir: '+z', strength: 9 },
  { type: 'block', box: [33, 0.3, -1.6, 51, 0.9, 1.6], mat: 'brick' },
  { type: 'hint', key: 'tunnel', box: [28.5, 0, -1.4, 33, 3, 1.4] },
  { type: 'block', box: [54.3, -1, -4, 60.3, 0, 4], mat: 'tile' },
  ...kerbs(54.3, 60.3),
  { type: 'prop', kind: 'lamp', pos: [55.4, 0, -3.4] },
  { type: 'prop', kind: 'pots', pos: [57.6, 0, 2.8], scale: 0.9 },
];

const culletCellar = () => [
  { type: 'block', box: [0, -1, -4, 14, 0, 4], mat: 'tile' },
  ...kerbs(0, 14),
  { type: 'checkpoint', pos: [2.2, 0, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.4, 0, -3.5] },
  { type: 'prop', kind: 'kiln', pos: [5.4, 0, 2.9], rot: 180, scale: 0.8 },
  { type: 'prop', kind: 'pots', pos: [9.2, 0, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'shelf', pos: [11.6, 0, 3.5], rot: 0 },
  { type: 'hint', key: 'floor', box: [9, 0, -4, 14, 3, 4] },
  // the glass floor, and a dead-end room beyond it; the cellar underneath runs the length of both
  { type: 'pane', id: 'floorGlass', box: [14, -0.3, -4, 22, 0, 4], speed: 6.5 },
  { type: 'block', box: [22, -1, -4, 30, 0, 4], mat: 'tile' },
  ...kerbs(14, 30),
  { type: 'prop', kind: 'lamp', pos: [23.0, 0, 3.4] },
  { type: 'prop', kind: 'pots', pos: [26.6, 0, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [29.0, 0, -3.5] },
  // the wall at the end of the room, wide enough that no cloud goes round it, and cold air over the whole hall and room
  // (a cloud that jumps first and boils at the top climbs 7.3 m, so a wall alone would not do): nothing floats there
  { type: 'block', box: [30, 0, -9.4, 30.4, 9.5, 9.4], mat: 'brick' },
  { type: 'cold', box: [-1, -0.5, -9, 30.8, 30, 9] },
  // the cellar: a dark floor, brick walls, a ceiling of floor slabs (it runs back under the hall, so the camera has room), and a hole at the far end with an updraft
  { type: 'block', box: [6, -9.2, -4, 35, -8.2, 4], mat: 'dark' },
  { type: 'block', box: [6, -8.2, -4.4, 35, 0, -4], mat: 'brick' },
  { type: 'block', box: [6, -8.2, 4, 35, 0, 4.4], mat: 'brick' },
  { type: 'block', box: [5.6, -8.2, -4.4, 6, 0, 4.4], mat: 'brick' },
  { type: 'block', box: [35, -8.2, -4.4, 35.4, 0, 4.4], mat: 'brick' },
  { type: 'block', box: [30.4, -1, -4, 31.2, 0, 4], mat: 'tile' },
  { type: 'block', box: [31.2, -1, -4, 34, 0, -1.5], mat: 'tile' },
  { type: 'block', box: [31.2, -1, 1.5, 34, 0, 4], mat: 'tile' },
  { type: 'block', box: [34, -1, -4, 37, 0, 4], mat: 'tile' },
  { type: 'fan', id: 'shaft', box: [31.2, -8.2, -1.5, 34, 3, 1.5], dir: '+y', strength: 10, on: { and: ['shaftPlate', 'shaftB'] } },
  { type: 'crate', id: 'cellarCrate', pos: [19.4, -8.2, -2.0] },
  { type: 'crate', id: 'cellarCrate2', pos: [19.4, -8.2, 2.9] },
  { type: 'plate', id: 'shaftPlateB', pos: [26.4, -8.2, 2.9], size: [1.7, 1.7], heavy: true, emit: 'shaftB' },
  { type: 'plate', id: 'shaftPlate', pos: [26.4, -8.2, 0], size: [1.7, 1.7], heavy: true, emit: 'shaftPlate' },
  { type: 'checkpoint', pos: [17.0, -8.2, -2.6] },
  { type: 'prop', kind: 'lamp', pos: [16.4, -8.2, 3.4] },
  { type: 'prop', kind: 'pots', pos: [23.6, -8.2, -3.3], scale: 0.8 },
  { type: 'prop', kind: 'lamp', pos: [29.0, -8.2, 3.4] },
  { type: 'prop', kind: 'pipe', pos: [28.4, -8.2, -3.5], rot: 0 },
  { type: 'hint', key: 'cellar', box: [14.4, -8.2, -4, 26, -3, 4] },
  { type: 'hint', key: 'updraft', box: [28, -8.2, -4, 31.2, -3, 4] },
  { type: 'prop', kind: 'lamp', pos: [35.0 - 0.6, 0, 3.4], solid: false },
];

const crazedGlass = () => [
  // the landing: the shaft comes out at the west end of a hall; a draughty alcove off its south side
  { type: 'block', box: [0, -1, -4, 12, 0, 4], mat: 'tile' },
  { type: 'block', box: [-6.6, 0, -4.4, 12, 0.7, -4], mat: 'brick' },
  { type: 'block', box: [-6.6, 0, 4, 4, 0.7, 4.4], mat: 'brick' },
  { type: 'block', box: [7, 0, 4, 12, 0.7, 4.4], mat: 'brick' },
  { type: 'checkpoint', pos: [1.2, 0, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [-0.2, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [1.6, 0, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'kiln', pos: [8.2, 0, -2.9], rot: 0 },
  { type: 'prop', kind: 'lamp', pos: [-0.6, 0, 3.4] },
  { type: 'block', box: [4, -1, 4, 7, 0, 9.4], mat: 'dark' },
  { type: 'block', box: [3.6, 0, 4, 4, 3.6, 9.8], mat: 'brick' },
  { type: 'block', box: [7, 0, 4, 7.4, 3.6, 9.8], mat: 'brick' },
  { type: 'block', box: [3.6, 0, 9.4, 7.4, 3.6, 9.8], mat: 'brick' },
  { type: 'fan', id: 'draught', box: [4, 0, 4, 7, 7, 9.4], dir: '-z', strength: 12 },
  { type: 'shard', pos: [5.5, 0.7, 8.4] },
  { type: 'hint', key: 'gale2', box: [7.4, 0, -4, 12, 3, 4] },
  // the second gale, ending in cracked glass
  { type: 'block', box: [12, -1, -4, 22.3, 0, 4], mat: 'tile' },
  ...walls(12, 22.3, 0, 7),
  { type: 'block', box: [12, 0.3, -4, 16, 7, 4], mat: 'brick' },
  { type: 'fan', id: 'gale2', box: [12, 0, -4, 21.4, 7, 4], dir: '-x', strength: 9 },
  { type: 'pane', id: 'paneA', box: [22, 0, -4, 22.3, 3.6, 4], speed: 5.5 },
  // hall C: a glass floor over a shallow pit (shard), then a cliff and a bud
  { type: 'block', box: [22.3, -2.2, -4, 25.5, 0, 4], mat: 'tile' },
  { type: 'block', box: [25.5, -2.2, -4, 29.5, 0, -2], mat: 'tile' },
  { type: 'block', box: [25.5, -2.2, 2, 29.5, 0, 4], mat: 'tile' },
  { type: 'block', box: [29.5, -2.2, -4, 34.8, 0, 4], mat: 'tile' },
  { type: 'block', box: [25.5, -2.2, -2, 29.5, -1.2, 2], mat: 'dark' },
  { type: 'pane', id: 'floorGlassB', box: [25.5, -0.3, -2, 29.5, 0, 2], speed: 6.5 },
  { type: 'shard', pos: [27.5, -0.5, 0] },
  { type: 'hint', key: 'pit', box: [23.4, 0, -4, 25.4, 3, 4] },
  { type: 'block', box: [22.3, 0, -4.4, 34.8, 0.7, -4], mat: 'brick' },
  { type: 'block', box: [22.3, 0, 4, 34.8, 0.7, 4.4], mat: 'brick' },
  { type: 'checkpoint', pos: [23.4, 0, 3.0] },
  { type: 'prop', kind: 'lamp', pos: [23.4, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [28.2, 0, 2.7], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [32.6, 0, -3.5] },
  // embers stuff the way to the bud (the cold air over this hall keeps a cloud out; a drop puts them out)
  ...embered(31, 'bayEmbers', 2.6, 4.2),
  { type: 'hint', key: 'bayEmbers', box: [27.6, 0, -4, 30.6, 3, 4] },
  { type: 'hint', key: 'sprout', box: [32, 0, -4, 33.8, 3, 4] },
  { type: 'sprout', id: 'bud', pos: [33.8, 0, 0], height: 6, axis: 'z' },
  { type: 'cold', box: [21.8, -3, -9, 35.2, 30, 9] },
];

const glassRun = () => [
  // the first crest: a platform on top of the cliff, with a second bud at its far end
  { type: 'block', box: [0, -1, -4, 13, 6, 4], mat: 'tile' },
  { type: 'block', box: [0, -1, -4.4, 13, 12.2, -4], mat: 'brick' },
  { type: 'block', box: [0, -1, 4, 13, 12.2, 4.4], mat: 'brick' },
  { type: 'checkpoint', pos: [2.0, 6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.2, 6, -3.4] },
  { type: 'prop', kind: 'pots', pos: [4.4, 6, 2.6], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [7.4, 6, 3.4] },
  { type: 'hint', key: 'cliff2', box: [3, 6, -4, 9.6, 9, 4] },
  { type: 'sprout', id: 'bud2', pos: [12.0, 6, 0], height: 6.6, axis: 'z' },
  // the high crest: the long slide, flanked by walls taller than a steam gauge can climb from up here
  { type: 'block', box: [13, -1, -4, 28, 12.6, 4], mat: 'tile' },
  { type: 'block', box: [13, -1, -4.4, 130.4, 19.4, -4], mat: 'brick' },
  { type: 'block', box: [13, -1, 4, 130.4, 19.4, 4.4], mat: 'brick' },
  { type: 'checkpoint', pos: [15.0, 12.6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [14.2, 12.6, 3.4] },
  { type: 'prop', kind: 'pots', pos: [17.6, 12.6, -2.9], scale: 0.9 },
  { type: 'hint', key: 'run', box: [15.6, 12.6, -4, 21.6, 15.6, 4] },
  // the doorway at the crest, stuffed with embers
  { type: 'block', box: [24, 12.6, -4, 25, 19.4, -1.2], mat: 'brick' },
  { type: 'block', box: [24, 12.6, 1.2, 25, 19.4, 4], mat: 'brick' },
  { type: 'block', box: [24, 15.2, -1.2, 25, 19.4, 1.2], mat: 'brick' },
  { type: 'ember', id: 'crestEmbers', box: [23.9, 12.6, -1.2, 25.1, 15.2, 1.2] },
  // three flights of the slide, each ending in a wall of glass that needs more speed than a flat run can give
  { type: 'ramp', box: [28, 8.6, -4, 40, 12.6, 4], up: '-x', mat: 'cream' },
  { type: 'block', box: [40, -1, -4, 52, 8.6, 4], mat: 'tile' },
  { type: 'pane', id: 'paneS1', box: [43, 8.6, -4, 43.3, 12.2, 4], speed: 10 },
  { type: 'ramp', box: [52, 4.6, -4, 64, 8.6, 4], up: '-x', mat: 'cream' },
  { type: 'block', box: [64, -1, -4, 76, 4.6, 4], mat: 'tile' },
  { type: 'pane', id: 'paneS2', box: [67, 4.6, -4, 67.3, 8.2, 4], speed: 11 },
  { type: 'ramp', box: [76, 0, -4, 88, 4.6, 4], up: '-x', mat: 'cream' },
  { type: 'block', box: [88, -1, -4, 130, 0, 4], mat: 'tile' },
  { type: 'pane', id: 'paneS3', box: [91, 0, -4, 91.3, 4.2, 4], speed: 12 },
  { type: 'prop', kind: 'lamp', pos: [46.0, 8.6, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [46.0, 8.6, 3.5] },
  { type: 'prop', kind: 'lamp', pos: [70.0, 4.6, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [70.0, 4.6, 3.5] },
  { type: 'pane', id: 'paneB', box: [112, 0, -4, 112.3, 13, 4], speed: 10.5 },
  { type: 'prop', kind: 'lamp', pos: [118.0, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [118.0, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [122.0, 0, 2.7], scale: 0.9 },
  // the kiln door sits behind a low lintel: ice has to give way to film for the last few metres
  { type: 'block', box: [124, 0.3, -4, 125.2, 19.4, 4], mat: 'brick' },
  { type: 'hint', key: 'squeeze', box: [117, 0, -4, 123.6, 3, 4] },
  { type: 'block', box: [129.8, 0, -4, 130.4, 19.4, 4], mat: 'brick' },
  { type: 'cold', box: [-0.4, 5, -9, 28.2, 40, 9] },
  { type: 'exit', pos: [128.2, 0, 0], face: '-x' },
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [20.3, 0, -0.6],
  [56.4, 0, 0],
  [117.3, 0, 0],
  [149.3, -8.2, 0.6],
  [180.5, 0, 0],
  [39.5, 0, 0.4],
  [307.9, 0, 0],
  [239.0, 8.6, 0.6],
  [263.0, 4.6, 0.6],
  [292.0, 0, 0.6],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l07',
  name: 'Crazing',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  areas: [
    { name: 'Draught Hall', box: [-6, -12, O[1], 12] },
    { name: 'Louvre Walk', box: [O[1], -12, O[2], 12] },
    { name: 'Cullet Cellar', box: [O[2], -12, O[3], 12] },
    { name: 'Crazed Glass', box: [O[3], -12, O[4], 12] },
    { name: 'The Glass Run', box: [O[4], -12, O[4] + LEN[4] + 8, 12] },
  ],
  hints: {
    start: 'The top of the Drying Loft. Great fans keep the air moving, and the rafter glass has crazed with age.',
    tail: 'A fan blowing your way carries a drop with it. Run at the pit and jump from the edge.',
    gale: 'A gale blows drops and clouds straight back; ice is too heavy to notice it. {ice}, then walk in.',
    beam: 'The tunnel in this gale is too low for ice. {film} and crawl through: wind cannot move film.',
    cross: 'A crosswind sweeps a drop or a cloud off the walkway. Ice and film do not feel it.',
    pad: 'Cracked glass across the way. A drop cannot break it; ice with a good run-up can. {ice} and sprint.',
    tunnel: 'A tunnel too low for ice. Film crawls under it, wind or no wind.',
    floor: 'This hall is a dead end, but the floor is cracked glass. A drop is too light; ice that has fallen is not.',
    cellar: 'No door, no stairs. The shaft at the far end is silent: it wants something heavy on BOTH plates.',
    updraft: 'An updraft lifts a cloud, not ice or film. {steam}, rise, then {liquid} on the floor above.',
    gale2: 'A low beam at the mouth of this gale, cracked glass at its far end. Film for the beam, then ice for the glass.',
    pit: 'Cracked glass underfoot. A drop is too light to break it; ice that has fallen from a height might.',
    bayEmbers: 'Embers stuff the way to the bud again. A drop puts them out; ice would just stop at them.',
    squeeze: 'The kiln door hides behind a lintel only film fits under. Ice has done its job: {film}.',
    sprout: 'The glass run is up there, and cold air hangs over the cliff: a cloud would only fall. A bud will get you up.',
    cliff2: 'A second cliff, a second bud. The crest of the glass run is higher still.',
    run: 'Embers in the doorway, then a long drop and four walls of glass: put them out, freeze, let go.',
  },
  signals: {},
  pieces: [
    ...LAMPS,
    ...at(O[0], draughtHall()),
    ...at(O[1], louvreWalk()),
    ...at(O[2], culletCellar()),
    ...at(O[3], crazedGlass()),
    ...at(O[4], glassRun()),
  ],
};
