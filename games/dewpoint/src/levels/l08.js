// Level 8 - "Bone Dry". The exam that closes chapter 2 (the Drying Loft). One climb up through the loft's
// racks, and every form is asked for once, in an order the level never explains twice:
//   1. PLANTER HALL (drop):     two doorways stuffed with embers, then a bud in a dry planter: a drop puts
//                               the embers out and waters the bud, and climbs its leaves onto deck one.
//   2. ELECTRODE DECK (film):   two pairs of posts under low shelves. Film crawls through the gap in a low
//                               wall to reach the second pair; both closed, and the tall door opens.
//                               Optional: a second bud beside the first shelf climbs onto it (shard).
//   3. FERRY GALLERY (ice/film): two ferries over a pit of kiln fire, in a crosswind that sweeps a drop or a
//                               cloud off the deck. Ice and film are not moved by it.
//   4. HATCH DECK (steam):      the loft is a floor above, with a grate hatch in it: rise as steam, float
//                               up through the hatch, and land on top. Optional: a cage only a cloud fits in.
//   5. THE LOFT (ice):          a crate on the loft, a long shove, and a drop onto the heavy plate that
//                               unshutters the kiln door - and the crate has to stay there.
// Every gate is enclosed: tall walls that run wider than a cloud can go round, or a fan too strong to cross.
// Each area is written in its own local x (0 = where the previous one ended) and shifted into place; the
// areas are side by side in x (the loft's west end belongs to the hatch deck, the rest to the last area).
// Layout runs along +X; see LEVELS.md for the format.

const kerbs = (x0, x1, y = 0, z = 4) => [
  { type: 'block', box: [x0, y, -z - 0.4, x1, y + 0.7, -z], mat: 'brick' },
  { type: 'block', box: [x0, y, z, x1, y + 0.7, z + 0.4], mat: 'brick' },
];

const walls = (x0, x1, y0, y1, z = 4) => [
  { type: 'block', box: [x0, y0, -z - 0.4, x1, y1, -z], mat: 'brick' },
  { type: 'block', box: [x0, y0, z, x1, y1, z + 0.4], mat: 'brick' },
];

/** A cross wall from sill to y1 with a doorway (z -1.4..1.4, sill to head) stuffed with embers. */
const embered = (x, id, sill, head, y1) => [
  { type: 'block', box: [x, sill, -4.4, x + 0.6, head, -1.4], mat: 'brick' },
  { type: 'block', box: [x, sill, 1.4, x + 0.6, head, 4.4], mat: 'brick' },
  { type: 'block', box: [x, head, -4.4, x + 0.6, y1, 4.4], mat: 'brick' },
  { type: 'ember', id, box: [x - 0.1, sill, -1.4, x + 0.7, head, 1.4] },
];

/** A pit of kiln fire under a gap from x0 to x1 (wide enough for a crosswind to blow a cloud into it). */
const pit = (x0, x1, z = 6, top = -2.5) => [
  { type: 'fire', box: [x0, top - 1.5, -z, x1, top, z] },
  { type: 'block', box: [x0, top - 2.5, -z, x1, top - 1.5, z], mat: 'dark' },
];

const at = (dx, list) => list.map((p) => ({
  ...p,
  ...(p.box ? { box: [p.box[0] + dx, p.box[1], p.box[2], p.box[3] + dx, p.box[4], p.box[5]] } : {}),
  ...(p.pos ? { pos: [p.pos[0] + dx, p.pos[1], p.pos[2]] } : {}),
}));

const LEN = [44, 52, 44, 30, 74];
const O = LEN.map((n, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));

const planterHall = () => [
  { type: 'block', box: [-4, -1, -4, 44, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4.4, -4, 0.8, 4.4], mat: 'brick' },
  ...kerbs(-4.5, 8),
  { type: 'prop', kind: 'kiln', pos: [1.6, 0, -3.0], rot: 0 },
  { type: 'prop', kind: 'shelf', pos: [5.4, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [-2.6, 0, 3.0], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [7.2, 0, 3.5] },
  { type: 'prop', kind: 'chimney', pos: [-2.5, 0, 8], solid: false, scale: 1.2 },
  { type: 'checkpoint', pos: [2.4, 0, -0.9] },
  // tall walls along the hall (8.8 m: a cloud that jumps first and boils at the top climbs 7.3) so a cloud cannot go over or round the doorways
  ...walls(8, 44, 0, 8.8),
  { type: 'hint', key: 'embers', box: [10.4, 0, -4, 15.4, 3, 4] },
  ...embered(16, 'embersA', 0, 2.6, 8.8),
  { type: 'prop', kind: 'lamp', pos: [17.6, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [18.8, 0, -3.1], scale: 0.9 },
  { type: 'prop', kind: 'shelf', pos: [22.4, 0, 3.5], rot: 0 },
  { type: 'prop', kind: 'lamp', pos: [25.6, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [27.0, 0, 3.0], scale: 0.9 },
  ...embered(30, 'embersB', 0, 2.6, 8.8),
  { type: 'prop', kind: 'lamp', pos: [31.6, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [33.0, 0, -3.3] },
  { type: 'hint', key: 'sprout', box: [35, 0, -4, 40, 3, 4] },
  { type: 'sprout', id: 'seedA', pos: [43.0, 0, 0], height: 3.6, axis: 'z' },
  { type: 'shard', pos: [43.0, 4.4, 0] },
];

const electrodeDeck = () => [
  { type: 'block', box: [0, -1, -4, 52, 3.6, 4], mat: 'tile' },
  ...kerbs(0, 52, 3.6),
  { type: 'checkpoint', pos: [2.0, 3.6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.4, 3.6, 3.4] },
  { type: 'hint', key: 'film', box: [2, 3.6, -4, 6.4, 6, 4] },
  // bay one: a low shelf, two posts under it, and a second bud beside it whose leaves lead onto the shelf
  { type: 'block', box: [6.2, 3.9, -4, 10.2, 5.1, -1.2], mat: 'cream' },
  { type: 'prop', kind: 'pots', pos: [6.8, 5.1, -3.2], scale: 0.8 },
  { type: 'electrodes', id: 'arc1', box: [7.4, 3.6, -3.4, 8.8, 3.9, -2.6], axis: 'x', emit: 'arc1' },
  { type: 'sprout', id: 'seedB', pos: [8.2, 3.6, -0.3], height: 1.5, axis: 'x' },
  { type: 'shard', pos: [9.4, 5.8, -2.8] },
  { type: 'prop', kind: 'shelf', pos: [3.4, 3.6, 3.4], rot: 0 },
  // a low wall across the deck: a 0.3 m gap under it, and the wall is taller and wider than a cloud can go round
  { type: 'block', box: [14, 3.9, -12, 14.6, 13.5, 12], mat: 'brick' },
  { type: 'hint', key: 'gap', box: [11, 3.6, -4, 14, 6, 4] },
  { type: 'prop', kind: 'lamp', pos: [12.8, 3.6, 3.4] },
  // bay two: a long bench with its own pair of posts
  { type: 'block', box: [25, 3.9, 1.6, 31.5, 5.1, 4], mat: 'cream' },
  { type: 'electrodes', id: 'arc2', box: [27.4, 3.6, 2.3, 28.8, 3.9, 3.1], axis: 'x', emit: 'arc2' },
  { type: 'prop', kind: 'pots', pos: [30.2, 5.1, 2.6], scale: 0.8 },
  { type: 'prop', kind: 'kiln', pos: [26.4, 3.6, -2.8], rot: 0, scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [20.0, 3.6, -3.4] },
  { type: 'prop', kind: 'shelf', pos: [22.0, 3.6, 3.4], rot: 0 },
  { type: 'prop', kind: 'lamp', pos: [33.0, 3.6, -3.4] },
  { type: 'hint', key: 'door', box: [33, 3.6, -4, 38.6, 7, 4] },
  // the door, in a wall too tall and too wide for a cloud to float over or round
  { type: 'block', box: [40, 3.6, -12, 40.4, 13.5, -1.2], mat: 'brick' },
  { type: 'block', box: [40, 3.6, 1.2, 40.4, 13.5, 12], mat: 'brick' },
  { type: 'block', box: [40, 6.6, -1.2, 40.4, 13.5, 1.2], mat: 'brick' },
  { type: 'door', id: 'doorA', box: [40.03, 3.6, -1.2, 40.37, 6.6, 1.2], on: 'doorA' },
  { type: 'checkpoint', pos: [42.4, 3.6, 0.9] },
  { type: 'prop', kind: 'lamp', pos: [44.6, 3.6, 3.5] },
  { type: 'prop', kind: 'pots', pos: [46.6, 3.6, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [49.6, 3.6, -3.5] },
];

const ferryGallery = () => [
  { type: 'block', box: [0, -1, -4, 10, 3.6, 4], mat: 'tile' },
  ...kerbs(0, 10, 3.6),
  { type: 'checkpoint', pos: [2.0, 3.6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.4, 3.6, 3.4] },
  { type: 'prop', kind: 'pots', pos: [4.6, 3.6, -3.0], scale: 0.9 },
  { type: 'hint', key: 'ferry', box: [3.4, 3.6, -4, 10, 6.4, 4] },
  // a wall of louvres along the north side; two ferries cross two pits in a crosswind
  { type: 'block', box: [10, -5, -4.6, 34, 8, -4.2], mat: 'brick' },
  ...pit(10, 18),
  { type: 'mover', id: 'ferryA', box: [10, 3.2, -1.5, 13, 3.6, 1.5], to: [5, 0, 0], speed: 3, pause: 2, delay: 1.8, on: { latch: 'goA' }, mat: 'metal' },
  { type: 'sensor', box: [5.6, 3.6, -2.6, 13, 5.4, 2.6], emit: 'goA', visible: false },
  { type: 'fan', id: 'crossA', box: [10, 3.6, -4, 18, 8, 4], dir: '+z', strength: 9 },
  // the island: 8 m of calm, and a wall of cracked glass across it - film got you here, but only ice breaks glass
  { type: 'block', box: [18, -5, -4, 26, 3.6, 4], mat: 'tile' },
  ...kerbs(18, 26, 3.6),
  { type: 'checkpoint', pos: [19.4, 3.6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [20.2, 3.6, 3.4] },
  { type: 'prop', kind: 'pots', pos: [22.0, 3.6, -3.0], scale: 0.8 },
  { type: 'hint', key: 'island', box: [18.2, 3.6, -4, 23, 6.4, 4] },
  { type: 'pane', id: 'islandPane', box: [21.65, 3.6, -4, 21.95, 12, 4], speed: 5.5 },
  { type: 'block', box: [21.6, 3.6, -12, 21.95, 12, -4], mat: 'brick' },
  { type: 'block', box: [21.6, 3.6, 4, 21.95, 12, 12], mat: 'brick' },
  ...pit(26, 34),
  { type: 'mover', id: 'ferryB', box: [26, 3.2, -1.5, 29, 3.6, 1.5], to: [5, 0, 0], speed: 3, pause: 2, delay: 1.8, on: { latch: 'goB' }, mat: 'metal' },
  { type: 'sensor', box: [24.2, 3.6, -2.6, 29, 5.4, 2.6], emit: 'goB', visible: false },
  { type: 'fan', id: 'crossB', box: [26, 3.6, -4, 34, 8, 4], dir: '+z', strength: 9 },
  { type: 'block', box: [34, -1, -4, 44, 3.6, 4], mat: 'tile' },
  ...kerbs(34, 44, 3.6),
  { type: 'prop', kind: 'lamp', pos: [35.4, 3.6, -3.4] },
  { type: 'prop', kind: 'pots', pos: [38.6, 3.6, 2.8], scale: 0.9 },
  { type: 'prop', kind: 'shelf', pos: [41.0, 3.6, -3.5], rot: 0 },
];

const hatchDeck = () => [
  // a short approach, then the deck proper
  { type: 'block', box: [0, -1, -4, 6, 3.6, 4], mat: 'tile' },
  ...kerbs(0, 6, 3.6),
  { type: 'checkpoint', pos: [2.0, 3.6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [1.4, 3.6, -3.5] },
  { type: 'prop', kind: 'pots', pos: [3.4, 3.6, 2.6], scale: 0.9 },
  { type: 'prop', kind: 'shelf', pos: [4.6, 3.6, -3.5], rot: 0 },
  ...at(6, [
  { type: 'block', box: [0, -1, -4, 24, 3.6, 4], mat: 'tile' },
  ...kerbs(0, 16, 3.6),
  // the cage in the south wall: bars in the window, a shard on the floor inside (a cloud fits, a drop does not)
  { type: 'block', box: [6.25, 3.6, 4, 9.75, 4.1, 4.4], mat: 'brick' },
  { type: 'block', box: [6.25, 6.7, 4, 9.75, 7.6, 4.4], mat: 'brick' },
  { type: 'block', box: [6.25, 4.1, 4, 6.85, 6.7, 4.4], mat: 'brick' },
  { type: 'block', box: [9.15, 4.1, 4, 9.75, 6.7, 4.4], mat: 'brick' },
  { type: 'grate', box: [6.85, 4.1, 4.05, 9.15, 6.7, 4.35] },
  { type: 'block', box: [6.25, 2.6, 4.4, 9.75, 3.6, 7.4], mat: 'dark' },
  { type: 'block', box: [5.85, 3.6, 4.4, 6.25, 7.6, 7.8], mat: 'brick' },
  { type: 'block', box: [9.75, 3.6, 4.4, 10.15, 7.6, 7.8], mat: 'brick' },
  { type: 'block', box: [5.85, 3.6, 7.4, 10.15, 7.6, 7.8], mat: 'brick' },
  { type: 'block', box: [5.85, 7.6, 4, 10.15, 8.0, 7.8], mat: 'brick' },
  { type: 'shard', pos: [8, 5.1, 5.5] },
  { type: 'hint', key: 'cage', box: [5.5, 3.6, 0.8, 10.5, 6.6, 4] },
  { type: 'prop', kind: 'chimney', pos: [12, 3.6, -9], solid: false, scale: 1.2 },
  { type: 'hint', key: 'hatch', box: [11, 3.6, -4, 15.6, 7, 4] },
  // the loft's west end, 4.2 m above the deck: a grate hatch in the floor, held up on pillars
  { type: 'block', box: [16, 3.6, -4, 16.5, 7.5, -3.5], mat: 'brick' },
  { type: 'block', box: [16, 3.6, 3.5, 16.5, 7.5, 4], mat: 'brick' },
  { type: 'block', box: [23.5, 3.6, -4, 24, 7.5, -3.5], mat: 'brick' },
  { type: 'block', box: [23.5, 3.6, 3.5, 24, 7.5, 4], mat: 'brick' },
  { type: 'block', box: [16.4, 7.5, -4, 17.2, 7.8, 4], mat: 'cream' },
  { type: 'block', box: [17.2, 7.5, -4, 19.6, 7.8, -1.2], mat: 'cream' },
  { type: 'block', box: [17.2, 7.5, 1.2, 19.6, 7.8, 4], mat: 'cream' },
  { type: 'block', box: [19.6, 7.5, -4, 24, 7.8, 4], mat: 'cream' },
  { type: 'grate', id: 'hatch', box: [17.2, 7.5, -1.2, 19.6, 7.8, 1.2] },
  { type: 'fan', id: 'hatchDraught', box: [16.9, 3.6, -1.6, 19.9, 9.4, 1.6], dir: '+y', strength: 7 },
  { type: 'block', box: [16.4, 7.8, -4.4, 24, 8.5, -4], mat: 'brick' },
  { type: 'block', box: [16.4, 7.8, 4, 24, 8.5, 4.4], mat: 'brick' },
  { type: 'block', box: [16.4, 7.8, -4, 16.8, 8.5, 4], mat: 'brick' },
  { type: 'prop', kind: 'kiln', pos: [19.8, 3.6, 2.7], rot: 180 },
  { type: 'prop', kind: 'lamp', pos: [21.6, 3.6, -3.4] },
  ]),
];

const theLoft = () => [
  // the loft: a long deck with kerbs, a crate at its west end, and nothing at its east edge but a drop
  { type: 'block', box: [0, 7.5, -4, 42, 7.8, 4], mat: 'cream' },
  { type: 'block', box: [0, 7.8, -4.4, 42, 8.5, -4], mat: 'brick' },
  { type: 'block', box: [0, 7.8, 4, 42, 8.5, 4.4], mat: 'brick' },
  { type: 'block', box: [11.5, 3.6, -4, 12, 7.5, -3.5], mat: 'brick' },
  { type: 'block', box: [11.5, 3.6, 3.5, 12, 7.5, 4], mat: 'brick' },
  { type: 'block', box: [22.5, 3.6, -4, 23, 7.5, -3.5], mat: 'brick' },
  { type: 'block', box: [22.5, 3.6, 3.5, 23, 7.5, 4], mat: 'brick' },
  { type: 'checkpoint', pos: [1.6, 7.8, 0.9] },
  { type: 'hint', key: 'crate', box: [0.5, 7.8, -3.6, 9, 10, 3.6] },
  { type: 'crate', id: 'crate', pos: [4.2, 7.8, -2.2] },
  { type: 'crate', id: 'crate2', pos: [30.0, 7.8, 3.0] },
  { type: 'hint', key: 'crate2', box: [26, 7.8, -3.6, 32, 10, 3.6] },
  { type: 'prop', kind: 'lamp', pos: [3.0, 7.8, 3.2] },
  { type: 'prop', kind: 'pots', pos: [9.6, 7.8, -3.3], scale: 0.8 },
  { type: 'prop', kind: 'lamp', pos: [14.6, 7.8, 3.2] },
  { type: 'prop', kind: 'pots', pos: [18.2, 7.8, 3.1], scale: 0.8 },
  { type: 'prop', kind: 'lamp', pos: [22.0, 7.8, -3.2] },
  { type: 'prop', kind: 'pots', pos: [27.0, 7.8, -3.1], scale: 0.8 },
  { type: 'prop', kind: 'lamp', pos: [30.6, 7.8, -3.2] },
  { type: 'prop', kind: 'pots', pos: [35.0, 7.8, -3.3], scale: 0.8 },
  { type: 'prop', kind: 'lamp', pos: [38.4, 7.8, -3.2], solid: false },
  // the yard below: the heavy plate under the loft's east edge, and the kiln door
  { type: 'block', box: [0, -1, -4, 70, 3.6, 4], mat: 'tile' },
  { type: 'block', box: [44, 3.6, -4.4, 70, 4.3, -4], mat: 'brick' },
  { type: 'block', box: [44, 3.6, 4, 70, 4.3, 4.4], mat: 'brick' },
  { type: 'plate', id: 'hp', pos: [42.4, 3.6, 0], size: [2.4, 2.4], heavy: true, emit: 'hp' },
  { type: 'plate', id: 'hp2', pos: [42.4, 3.6, 3.1], size: [1.6, 1.6], heavy: true, emit: 'hp2' },
  { type: 'hint', key: 'lock', box: [44.4, 3.6, -4, 49, 7, 4] },
  // warm air off the kiln by the loft edge: a way back up from the yard (a drop is hardly lifted by it)
  { type: 'fan', id: 'yardDraught', box: [42.3, 3.6, -3.9, 44.7, 8.6, -1.9], dir: '+y', strength: 4 },
  { type: 'hint', key: 'draught', box: [40.6, 3.6, -4, 44.4, 7, 0.4] },
  { type: 'prop', kind: 'lamp', pos: [51.0, 3.6, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [51.0, 3.6, 3.5] },
  { type: 'prop', kind: 'pots', pos: [54.4, 3.6, 3.0], scale: 0.9 },
  { type: 'prop', kind: 'kiln', pos: [59.0, 3.6, -2.8], rot: 0 },
  { type: 'block', box: [69.4, 3.6, -4, 70, 8, 4], mat: 'brick' },
  { type: 'exit', pos: [67.4, 3.6, 0], face: '-x', on: { and: ['hp', 'hp2'] } },
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [21.3, 0, 0],
  [41.3, 0, 0],
  [72.1, 3.6, 0.4],
  [134.2, 3.6, 0],
  [160.9, 3.6, -0.1],
  [215, 3.6, -0.3],
  [205.7, 7.8, -1.5],
  [217.7, 3.6, 1],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l08',
  name: 'Bone Dry',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  areas: [
    { name: 'Planter Hall', box: [-6, -12, O[1], 12] },
    { name: 'Electrode Deck', box: [O[1], -12, O[2], 12] },
    { name: 'Ferry Gallery', box: [O[2], -12, O[3], 12] },
    { name: 'Hatch Deck', box: [O[3], -12, O[4], 12] },
    { name: 'The Loft', box: [O[4], -12, O[4] + LEN[4] + 8, 12] },
  ],
  hints: {
    start: 'The kiln door at the top is shut. You will need everything you have learned: drop, ice, cloud, film.',
    embers: 'Embers stuff the doorways. A drop puts them out for good. Two of them: run into each.',
    sprout: 'A bud in a dry planter. Be a drop beside it and it grows a stair of leaves. Hop up beside the stalk.',
    film: 'A low shelf, two posts: film carries the current. {film}, crawl onto the strip, then {liquid}.',
    gap: 'The wall ahead is too tall to climb, with a gap only film fits. Both pairs of posts open the door.',
    door: 'The second pair of posts is under the bench. Crawl onto the strip; the tall door will open.',
    ferry: 'A crosswind sweeps a drop or a cloud off the ferries. Ice and film do not feel it.',
    island: 'Cracked glass across the island, and film cannot break it. {ice}, sprint, and the ferry beyond is yours.',
    hatch: 'Warm air rises through this grate. {steam} below it, float up, then {liquid} to land on top.',
    cage: 'A shard in a cage. A cloud fits through the grate and leaves the same way; the gauge refills while you stand.',
    crate: 'Crates can only be shoved, by ice. The plate you want is on the floor below the far edge. Mind the drop.',
    crate2: 'A second crate on the loft, a second plate below. Mote cannot hold both: the first crate stays where it fell.',
    draught: 'Warm air rises by the loft edge. {steam} in it, float up, then {liquid}. Missed? Land, refill.',
    lock: 'The kiln door stays shuttered until something heavy rests on BOTH plates - and keeps resting there.',
  },
  signals: {
    doorA: { and: [{ latch: 'arc1' }, { latch: 'arc2' }] },
  },
  pieces: [
    ...LAMPS,
    ...at(O[0], planterHall()),
    ...at(O[1], electrodeDeck()),
    ...at(O[2], ferryGallery()),
    ...at(O[3], hatchDeck()),
    ...at(O[4], theLoft()),
  ],
};
