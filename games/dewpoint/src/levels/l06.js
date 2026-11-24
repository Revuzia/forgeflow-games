// Level 6 - "Greenware". Teaches what a plain drop can do: put out embers and water sprouts - and
// what a cloud adds: rain from above. Only liquid and steam are on offer.
//   1. CLAY STORE (teach):      a doorway stuffed with embers: run into them as a drop. Just beyond, a
//                               thirsty bud grows a ladder of leaves up a 3 m cliff. Optional: an
//                               ember-stuffed nook (shard).
//   2. SLIP HOUSE (practise):   a roofed, three-floor slip house. A bud lifts you onto the mezzanine, a
//                               doorway high in the cross wall is stuffed with embers; a second bud and a
//                               second doorway take you to the attic. Put them out, walk on.
//   3. RAIN GALLERY (twist):    four embers on pillars, too high to jump to. Rise as steam from the floor,
//                               from a stone step, from the top of a bud's ladder, and from the top of a
//                               pillar you have already put out; hover over each and condense: the rain
//                               puts it out. All four out, and the gate opens.
//   4. GREENHOUSE (combine):    bars in the window, a bed of kiln fire for a floor, three benches in it
//                               and a bud at the far end. One cloud cannot make the crossing: land on a
//                               bench, refill, rise again. Rain beside the bud, climb to the roof catwalk.
//                               Optional: a shard in the rafters, only a cloud from the top leaf reaches it.
//   5. KILN GARDEN (payoff):    down the ramp, an 8 m pit and a ledge no jump can reach: cross as a cloud,
//                               water the last bud, climb 9 m of leaves, and put out the last embers in
//                               the doorway to the kiln.
// Every gate is enclosed: the walls round the embers and the greenhouse run floor to roof (or are taller
// than a cloud can climb from the highest place Mote can stand before the gate: 5.5 m from a standstill, but
// 7.3 m for a drop that jumps first and boils at the top), so a cloud can never go over or round them.
// Each area is written in its own local x (0 = where the previous one ended) and shifted into place.
// Layout runs along +X; see LEVELS.md for the format.

const kerbs = (x0, x1, y = 0, z = 4) => [
  { type: 'block', box: [x0, y, -z - 0.4, x1, y + 0.7, -z], mat: 'brick' },
  { type: 'block', box: [x0, y, z, x1, y + 0.7, z + 0.4], mat: 'brick' },
];

/** Side walls the full height of a gate section, so a cloud cannot go round it. */
const walls = (x0, x1, y0, y1, z = 4) => [
  { type: 'block', box: [x0, y0, -z - 0.4, x1, y1, -z], mat: 'brick' },
  { type: 'block', box: [x0, y0, z, x1, y1, z + 0.4], mat: 'brick' },
];

/** A cross wall from y0 to y1 with a doorway (z -1.4..1.4, from sill to head) stuffed with embers. */
const embered = (x, id, sill, head, y1) => [
  { type: 'block', box: [x, sill, -4.4, x + 0.6, head, -1.4], mat: 'brick' },
  { type: 'block', box: [x, sill, 1.4, x + 0.6, head, 4.4], mat: 'brick' },
  { type: 'block', box: [x, head, -4.4, x + 0.6, y1, 4.4], mat: 'brick' },
  { type: 'ember', id, box: [x - 0.1, sill, -1.4, x + 0.7, head, 1.4] },
];

const at = (dx, list) => list.map((p) => ({
  ...p,
  ...(p.box ? { box: [p.box[0] + dx, p.box[1], p.box[2], p.box[3] + dx, p.box[4], p.box[5]] } : {}),
  ...(p.pos ? { pos: [p.pos[0] + dx, p.pos[1], p.pos[2]] } : {}),
}));

const LEN = [34, 47, 40, 36.4, 78];
const O = LEN.map((n, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));

const clayStore = () => [
  { type: 'block', box: [-4, -1, -4, 34, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4.4, -4, 0.8, 4.4], mat: 'brick' },
  ...kerbs(-4.5, 8),
  // tall walls round the ember doorway (8.8 m: a cloud that jumps first and boils at the top climbs 7.3) so steam cannot go over or round it
  { type: 'block', box: [8, 0, 4, 34, 8.8, 4.4], mat: 'brick' },
  { type: 'block', box: [8, 0, -4.4, 28, 8.8, -4], mat: 'brick' },
  { type: 'block', box: [30, 0, -4.4, 34, 8.8, -4], mat: 'brick' },
  { type: 'block', box: [28, 2.4, -4.4, 30, 8.8, -4], mat: 'brick' },
  { type: 'prop', kind: 'kiln', pos: [2.6, 0, 2.9], rot: 180 },
  { type: 'prop', kind: 'shelf', pos: [-1.6, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'shelf', pos: [13.0, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [16.0, 0, 2.7], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [18.6, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [3.4, 0, -3.1], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [6.6, 0, -3.5] },
  { type: 'prop', kind: 'chimney', pos: [-2, 0, 7.5], solid: false },
  { type: 'prop', kind: 'chimney', pos: [9, 0, -8.5], solid: false, scale: 1.2 },
  { type: 'checkpoint', pos: [2.4, 0, -0.9] },
  // easy shard: on a stack of unfired moulds
  { type: 'block', box: [10.4, 0, 2.4, 12, 1.2, 4], mat: 'cream' },
  { type: 'shard', pos: [11.2, 1.95, 3.2] },
  { type: 'hint', key: 'ember', box: [8.4, 0, -4, 21, 3, 4] },
  // the doorway wall, stuffed with embers
  ...embered(22, 'doorEmbers', 0, 2.6, 8.8),
  // beyond it: racks, then the bud and the cliff
  { type: 'prop', kind: 'lamp', pos: [24.0, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [25.4, 0, 2.6], scale: 0.9 },
  { type: 'prop', kind: 'shelf', pos: [26.6, 0, -3.5], rot: 0 },
  { type: 'hint', key: 'sprout', box: [28, 0, -4, 32.4, 3, 4] },
  { type: 'sprout', id: 'bud1', pos: [33, 0, 0], height: 3, axis: 'z' },
  // optional nook in the north wall, stuffed with embers, a shard inside
  { type: 'ember', id: 'nookEmbers', box: [28, 0, -4.5, 30, 2.4, -3.8] },
  { type: 'block', box: [28, -1, -7.8, 30, 0, -4.4], mat: 'dark' },
  { type: 'block', box: [27.6, 0, -7.8, 28, 4, -4.4], mat: 'brick' },
  { type: 'block', box: [30, 0, -7.8, 30.4, 4, -4.4], mat: 'brick' },
  { type: 'block', box: [27.6, 0, -7.8, 30.4, 4, -7.4], mat: 'brick' },
  { type: 'block', box: [27.6, 4, -7.8, 30.4, 4.4, -4], mat: 'brick' },
  { type: 'prop', kind: 'lamp', pos: [28.5, 0, -7.0] },
  { type: 'shard', pos: [29.2, 0.8, -5.6] },
];

const slipHouse = () => [
  // the house: floor, walls, a timber roof - nothing gets in or out but through the doors
  { type: 'block', box: [0, -1, -4, 47, 3, 4], mat: 'tile' },
  ...walls(0, 47, 3, 16),
  { type: 'block', box: [0, 16, -4.4, 47, 16.5, 4.4], mat: 'brick' },
  { type: 'checkpoint', pos: [2.2, 3, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.4, 3, 3.4] },
  { type: 'prop', kind: 'kiln', pos: [4.6, 3, -2.9], rot: 0, scale: 0.8 },
  { type: 'prop', kind: 'pipe', pos: [5.0, 3, 3.5], rot: 0 },
  { type: 'hint', key: 'house', box: [0.5, 3, -4, 6, 6, 4] },
  // storey one: the bud in its planter, and the mezzanine its leaves climb to (a stack of slip sacks)
  { type: 'sprout', id: 'budB', pos: [8.0, 3, 0], height: 3.6, axis: 'x' },
  { type: 'block', box: [8.9, 3, -4, 23, 6.6, 4], mat: 'cream' },
  { type: 'prop', kind: 'lamp', pos: [10.4, 6.6, 3.4] },
  { type: 'prop', kind: 'pots', pos: [11.6, 6.6, -3.0], scale: 0.9 },
  { type: 'hint', key: 'houseEmbers', box: [10.4, 6.6, -4, 14.4, 9.6, 4] },
  ...embered(15, 'houseEmbers', 6.6, 9.2, 16),
  // storey two: past the first doorway, a second bud climbs to the attic
  { type: 'prop', kind: 'shelf', pos: [18.6, 6.6, -3.5], rot: 0 },
  { type: 'prop', kind: 'lamp', pos: [19.4, 6.6, 3.4] },
  { type: 'sprout', id: 'budC', pos: [21.8, 6.6, 0], height: 3, axis: 'z' },
  { type: 'block', box: [22.8, 3, -4, 36, 9.6, 4], mat: 'cream' },
  { type: 'hint', key: 'attic', box: [17.4, 6.6, -4, 21.4, 9.6, 4] },
  { type: 'prop', kind: 'lamp', pos: [24.0, 9.6, 3.4] },
  { type: 'prop', kind: 'pots', pos: [25.4, 9.6, -3.0], scale: 0.9 },
  ...embered(29, 'atticEmbers', 9.6, 12.2, 16),
  { type: 'prop', kind: 'shelf', pos: [32.2, 9.6, 3.5], rot: 0 },
  // down the ramp into the rain gallery
  { type: 'ramp', box: [34, 3, -4, 47, 9.6, 4], up: '-x', mat: 'cream' },
];

const rainGallery = () => [
  { type: 'block', box: [0, -1, -4, 40, 3, 4], mat: 'tile' },
  ...walls(0, 32.6, 3, 14.2),
  { type: 'block', box: [0, 14.2, -4.4, 32.6, 14.7, 4.4], mat: 'brick' },
  ...kerbs(32.6, 40, 3),
  { type: 'checkpoint', pos: [2.2, 3, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.4, 3, -3.5] },
  { type: 'prop', kind: 'pots', pos: [3.4, 3, 2.6], scale: 0.9 },
  { type: 'prop', kind: 'pipe', pos: [6.5, 3, 3.5], rot: 0 },
  { type: 'hint', key: 'rain', box: [3.5, 3, -4, 9, 6, 4] },
  // three embers on pillars. A: 2.2 m, from the floor. B: 3.2 m, from a stone step beside it. Each is a
  // short climb (about 2.5 m of cloud), so the gauge is never the hard part
  { type: 'block', box: [10, 3, -3, 12, 5.2, -1], mat: 'brick' },
  { type: 'ember', id: 'pillarA', box: [10.2, 5.2, -2.8, 11.8, 5.6, -1.2], emit: 'pa' },
  { type: 'block', box: [16, 3, 1, 18, 6.2, 3], mat: 'brick' },
  { type: 'ember', id: 'pillarB', box: [16.2, 6.2, 1.2, 17.8, 6.6, 2.8], emit: 'pb' },
  { type: 'block', box: [14.2, 3, 1.4, 15.8, 4.2, 3.0], mat: 'cream' },
  { type: 'prop', kind: 'lamp', pos: [8.6, 3, 3.5] },
  { type: 'prop', kind: 'lamp', pos: [13.6, 3, -3.5] },
  // C: 5 m - a long way for a cloud from the floor; a bud's leaves lift it high enough for a short climb
  { type: 'sprout', id: 'budD', pos: [21.4, 3, -2.0], height: 3.2, axis: 'x' },
  { type: 'hint', key: 'ladder', box: [18.4, 3, -4, 22.4, 6, 4] },
  { type: 'block', box: [25, 3, -3, 27, 8.0, -1], mat: 'brick' },
  { type: 'ember', id: 'pillarC', box: [25.2, 8.0, -2.8, 26.8, 8.4, -1.2], emit: 'pc' },
  // D: 7.2 m - out of reach of a cloud from the floor or the bud; the top of the pillar just put out is the way up
  { type: 'block', box: [28.6, 3, 1, 30.6, 10.2, 3], mat: 'brick' },
  { type: 'ember', id: 'pillarD', box: [28.8, 10.2, 1.2, 30.4, 10.6, 2.8], emit: 'pd' },
  { type: 'hint', key: 'tower', box: [24.4, 8.0, -3.4, 27.6, 10.5, -0.6] },
  { type: 'prop', kind: 'lamp', pos: [23.0, 3, 3.5] },
  { type: 'hint', key: 'gate', box: [28, 3, -4, 31.5, 6, 4] },
  // the gate they keep shut, and the walls and roof round the whole gallery: even a cloud standing on
  // the tallest pillar (8 m) cannot climb 5.5 m to the roof (14.2 m), so it cannot go over or round
  { type: 'block', box: [32, 3, -4.4, 32.6, 14.2, -1.2], mat: 'brick' },
  { type: 'block', box: [32, 3, 1.2, 32.6, 14.2, 4.4], mat: 'brick' },
  { type: 'block', box: [32, 6, -1.2, 32.6, 14.2, 1.2], mat: 'brick' },
  { type: 'door', id: 'gate', box: [32.05, 3, -1.2, 32.55, 6, 1.2], on: { and: ['pa', 'pb', 'pc', 'pd'] } },
  // past the gate: racks and a lamp, then the greenhouse
  { type: 'prop', kind: 'shelf', pos: [35.4, 3, 3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [36.6, 3, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [38.6, 3, 3.5] },
];

const greenhouse = () => [
  { type: 'block', box: [0, -1, -4, 10, 3, 4], mat: 'tile' },
  ...kerbs(0, 10, 3),
  { type: 'checkpoint', pos: [2.2, 3, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.6, 3, -3.5] },
  { type: 'prop', kind: 'pots', pos: [4.4, 3, 2.6], scale: 0.9 },
  { type: 'prop', kind: 'chimney', pos: [5, 3, -9], solid: false, scale: 1.2 },
  { type: 'hint', key: 'glass', box: [4, 3, -4, 9.8, 6.4, 4] },
  // the glasshouse: bars in the west window, timber walls and roof, an open top above the east wall
  { type: 'block', box: [10, 3, -4, 10.5, 3.5, 4], mat: 'brick' },
  { type: 'block', box: [10, 6.4, -4, 10.5, 18, 4], mat: 'brick' },
  { type: 'block', box: [10, 3.5, -4, 10.5, 6.4, -1.5], mat: 'brick' },
  { type: 'block', box: [10, 3.5, 1.5, 10.5, 6.4, 4], mat: 'brick' },
  { type: 'grate', box: [10.05, 3.5, -1.5, 10.45, 6.4, 1.5] },
  ...walls(10, 36.4, 3, 18),
  { type: 'block', box: [10, 18, -4.4, 36.4, 18.5, 4.4], mat: 'brick' },
  { type: 'block', box: [36, 3, -4, 36.4, 12.4, 4], mat: 'brick' },
  // the floor is a hot bed of kiln fire; three benches stand in it
  { type: 'fire', box: [10.5, -3.5, -4.4, 36, -1.5, 4.4] },
  { type: 'block', box: [10.5, -4.5, -4.4, 36, -3.5, 4.4], mat: 'dark' },
  { type: 'block', box: [10.5, -3.5, -4, 14.5, 3, 4], mat: 'cream' },
  { type: 'block', box: [20.5, -3.5, -4, 24.5, 3, 4], mat: 'cream' },
  { type: 'block', box: [30.5, -3.5, -4, 36, 3, 4], mat: 'cream' },
  { type: 'hint', key: 'bench', box: [11, 3, -4, 14.5, 7, 4] },
  { type: 'prop', kind: 'lamp', pos: [11.6, 3, -3.4] },
  { type: 'prop', kind: 'pots', pos: [13.2, 3, 2.7], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [21.4, 3, 3.4] },
  { type: 'prop', kind: 'pots', pos: [22.6, 3, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [31.4, 3, -3.4] },
  { type: 'sprout', id: 'budG', pos: [34.4, 3, 0], height: 9.6, axis: 'z' },
  // optional: a shard in the rafters above the top leaf - only a cloud from up there reaches it
  { type: 'shard', pos: [34.4, 15.6, 2.2] },
];

const kilnGarden = () => [
  // the roof catwalk the top leaf steps onto, and the long ramp down to the garden
  { type: 'block', box: [0, 3, -4, 8, 12.2, 4], mat: 'brick' },
  { type: 'block', box: [0, 12.2, -4, 8, 12.6, 4], mat: 'tile' },
  ...kerbs(0, 8, 12.6),
  { type: 'checkpoint', pos: [2.0, 12.6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.2, 12.6, 3.2] },
  { type: 'prop', kind: 'pots', pos: [5.2, 12.6, -2.9], scale: 0.9 },
  { type: 'hint', key: 'garden', box: [3, 12.6, -4, 8, 15.4, 4] },
  { type: 'ramp', box: [8, 3, -4, 30, 12.6, 4], up: '-x', mat: 'cream' },
  { type: 'block', box: [8, 3, -4.4, 30, 13.3, -4], mat: 'brick' },
  { type: 'block', box: [8, 3, 4, 30, 13.3, 4.4], mat: 'brick' },
  // the garden: a yard, an 8 m pit of kiln fire, and a ledge on the far side too high to jump to
  ...at(8, [
  { type: 'block', box: [22, -1, -4, 29, 3, 4], mat: 'tile' },
  ...kerbs(22, 29, 3),
  { type: 'checkpoint', pos: [23.4, 3, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [24.0, 3, 3.4] },
  { type: 'prop', kind: 'pots', pos: [26.6, 3, -2.9], scale: 0.9 },
  { type: 'prop', kind: 'chimney', pos: [25, 3, -9], solid: false, scale: 1.3 },
  { type: 'hint', key: 'bud', box: [25.6, 3, -4, 29, 6, 4] },
  { type: 'fire', box: [29, -4, -4.4, 45, -1.5, 4.4] },
  { type: 'block', box: [29, -5, -4.4, 45, -4, 4.4], mat: 'dark' },
  // a stone island in the middle of the pit: no cloud drifts 16 m, but one can land here and refill its gauge
  { type: 'block', box: [34, -5, -4, 40, 2.6, 4], mat: 'brick' },
  { type: 'block', box: [34, 2.6, -4, 40, 3, 4], mat: 'tile' },
  { type: 'prop', kind: 'lamp', pos: [35.0, 3, -3.3] },
  { type: 'hint', key: 'island', box: [33, 3, -4, 40, 6, 4] },
  ]),
  ...at(16, [
  { type: 'block', box: [37, -5, -4, 42, 5.2, 4], mat: 'brick' },
  { type: 'block', box: [37, 5.2, -4, 42, 5.6, 4], mat: 'tile' },
  ...kerbs(37, 42, 5.6),
  { type: 'sprout', id: 'bud2', pos: [41.0, 5.6, 0], height: 9.2, axis: 'z' },
  { type: 'prop', kind: 'lamp', pos: [38.4, 5.6, 3.3] },
  // the kiln platform (14.8 m: more than a cloud from the ledge can climb), and the last doorway before the kiln door
  { type: 'block', box: [42, -5, -4, 62, 14.4, 4], mat: 'brick' },
  { type: 'block', box: [42, 14.4, -4, 62, 14.8, 4], mat: 'tile' },
  ...walls(44, 62, 14.8, 23.4),
  { type: 'prop', kind: 'lamp', pos: [45.0, 14.8, -3.3] },
  { type: 'prop', kind: 'pots', pos: [47.0, 14.8, 2.6], scale: 0.9 },
  { type: 'hint', key: 'last', box: [45.6, 14.8, -4, 49.4, 17.8, 4] },
  ...embered(50, 'kilnEmbers', 14.8, 17.4, 23.4),
  { type: 'prop', kind: 'lamp', pos: [53.6, 14.8, -3.3] },
  { type: 'prop', kind: 'lamp', pos: [53.6, 14.8, 3.3] },
  { type: 'block', box: [61.4, 14.8, -4.4, 62, 23.4, 4.4], mat: 'brick' },
  { type: 'exit', pos: [59.4, 14.8, 0], face: '-x' },
  ]),
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [21.4, 0, 0],
  [49.6, 6.6, 0],
  [63.6, 9.6, 0],
  [94.1, 3, 0.7],
  [107.5, 8, -2],
  [116.1, 3, -0.1],
  [177.2, 7.6, -0.5],
  [213.4, 5.6, 0],
  [218.4, 14.8, 0],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l06',
  name: 'Greenware',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['liquid', 'steam'],
  areas: [
    { name: 'Clay Store', box: [-6, -12, O[1], 12] },
    { name: 'Slip House', box: [O[1], -12, O[2], 12] },
    { name: 'Rain Gallery', box: [O[2], -12, O[3], 12] },
    { name: 'Greenhouse', box: [O[3], -12, O[4], 12] },
    { name: 'Kiln Garden', box: [O[4], -12, O[4] + LEN[4] + 8, 12] },
  ],
  hints: {
    start: 'Raw clay waits for the kiln here. Warm things block the way; a drop of water is what they want.',
    ember: 'Embers block the way until water touches them. Run into them as a drop to put them out for good.',
    sprout: 'A thirsty bud. Stand close as a drop and it grows a ladder of leaves. Hop up beside the stalk.',
    house: 'The slip house is roofed and walled in. The bud by the sacks will lift you onto the mezzanine.',
    houseEmbers: 'Embers high in the cross wall. A drop that touches them puts them out, up here as well as down there.',
    attic: 'Another bud, another doorway: the same two moves one floor higher.',
    rain: 'Embers on pillars, too high to jump. {steam}, float over one, then {liquid} to rain on it.',
    ladder: 'This pillar is tall. Start higher: the leaves of a bud are a stair for a cloud.',
    tower: 'One pillar left, and taller. A pillar you put out is a place to stand: the gauge refills, and the climb starts here.',
    gate: 'The gate stays shut until every pillar is out. The gauge refills whenever you stand on something solid.',
    glass: 'Bars stop a drop, not a cloud. A bud waits inside. Condense beside it and it will grow.',
    bench: 'The floor is a bed of kiln fire. Land on a bench and the gauge refills while you stand there.',
    garden: 'The kiln door is up on the far tower, past the pit. Down the ramp first.',
    bud: 'A pit, and a ledge too high to jump. Clouds rise and drift. Land beside the bud and it will grow.',
    island: 'One cloud cannot cross the whole pit. Land on the island, let the gauge fill, then rise again.',
    last: 'The last doorway to the kiln is stuffed with embers. You know what to do.',
  },
  signals: {},
  pieces: [
    ...LAMPS,
    ...at(O[0], clayStore()),
    ...at(O[1], slipHouse()),
    ...at(O[2], rainGallery()),
    ...at(O[3], greenhouse()),
    ...at(O[4], kilnGarden()),
  ],
};
