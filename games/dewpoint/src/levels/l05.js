// Level 5 - "Hung Out to Dry". Chapter 2 opens in the Drying Loft. Teaches moving platforms, and
// combines them with what the Slip Room taught (crates, heavy plates, steam, grates).
//   1. DRYING RACKS (teach):    a tram shuttles over a slip trough (a fall only costs a walk back), then
//                               a ferry carries you over the kiln pit. Step on, ride, step off.
//   2. HOIST GALLERY (practise): a lift up the stack, a plate that wakes the gallery shuttle, a shuttle
//                               over a gap. Optional: a second lift up to a high rack (shard).
//   3. PRESSING ROOM (twist):   the heavy plate is across the pit and only a crate can hold it: ice shoves
//                               the crate onto the ferry, rides over with it, shoves it onto the plate;
//                               the plate slides the bridge out and the crate holds it there.
//   4. CHIMNEY STACK (combine): a lift carries you up a sealed shaft; its roof is a grate - the lift alone
//                               cannot pass it, steam alone cannot climb to it. Optional: a barred cage
//                               only a cloud can enter (shard).
//   5. ROOF GANTRY (payoff):    two ferries out over the pit, the second climbing up into the kiln door.
// A cold draught hangs over every gap, so a cloud can never simply float across one (a v1 chasm of 7-8 m was
// an easy float: a full gauge drifts 13 m). The gallery above the chimney is 8.4 m up and its shaft is sealed:
// a cloud that jumps first and boils at the top climbs only 7.3 m. (The hoist terrace is a convenience, not
// a gate: a cloud can climb to it, and the gap beyond it is what the draught guards.)
// Each area is written in its own local x (0 = where the previous area ended) and shifted into place.
// Layout runs along +X; see LEVELS.md for the format.

const kerbs = (x0, x1, y = 0, z = 4) => [
  { type: 'block', box: [x0, y, -z - 0.4, x1, y + 0.7, -z], mat: 'brick' },
  { type: 'block', box: [x0, y, z, x1, y + 0.7, z + 0.4], mat: 'brick' },
];

/** A pit of kiln fire (Mote's respawn) with a dark floor, under a gap from x0 to x1. */
const pit = (x0, x1, top = -4.5) => [
  { type: 'fire', box: [x0, top - 1.5, -4.4, x1, top, 4.4] },
  { type: 'block', box: [x0, top - 2.5, -4.4, x1, top - 1.5, 4.4], mat: 'dark' },
];

/** The cold draught over a gap: a cloud that enters it condenses and falls. Wide, tall, and a bit past each edge. */
const draught = (x0, x1) => ({ type: 'cold', box: [x0 - 1, -9, -13, x1 + 1, 22, 13] });

/** A dock sensor: it latches when Mote comes near a platform, and the platform sets off a moment later. */
const dock = (name, x0, x1, y, crates = false) => ({ type: 'sensor', box: [x0, y, -2.6, x1, y + 1.8, 2.6], emit: name, visible: false, ...(crates ? { crates: true } : {}) });

/** Shift a list of pieces east by dx (and up by dy). */
const at = (dx, list, dy = 0) => list.map((p) => ({
  ...p,
  ...(p.box ? { box: [p.box[0] + dx, p.box[1] + dy, p.box[2], p.box[3] + dx, p.box[4] + dy, p.box[5]] } : {}),
  ...(p.pos ? { pos: [p.pos[0] + dx, p.pos[1] + dy, p.pos[2]] } : {}),
}));

// how long each area is, and where it starts (world x)
const LEN = [36, 52, 56, 19.4, 39];
const O = LEN.map((n, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));

const dryingRacks = () => [
  { type: 'block', box: [-4, -3.2, -4, 10, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4.4, -4, 0.8, 4.4], mat: 'brick' },
  ...kerbs(-4.5, 10),
  { type: 'prop', kind: 'shelf', pos: [-2.0, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [1.6, 0, -3.1], scale: 0.9 },
  { type: 'prop', kind: 'kiln', pos: [3.0, 0, 2.9], rot: 180 },
  { type: 'prop', kind: 'chimney', pos: [-2.2, 0, 7.5], solid: false },
  { type: 'prop', kind: 'chimney', pos: [6.5, 0, -8.0], solid: false, scale: 1.3 },
  { type: 'prop', kind: 'lamp', pos: [8.6, 0, -3.5] },
  { type: 'checkpoint', pos: [2.4, 0, -0.9], emit: 'a1' },
  // easy shard: on a stack of drying boards beside the path
  { type: 'block', box: [5.2, 0, 2.4, 6.8, 1.2, 4.0], mat: 'cream' },
  { type: 'shard', pos: [6.0, 1.95, 3.2] },
  { type: 'hint', key: 'tram', box: [6.8, 0, -4, 10, 3, 4] },

  // the slip trough: 2.2 m deep, a ramp back out on the near side, a tram across
  { type: 'block', box: [10, -3.2, -4, 18, -2.2, 4], mat: 'dark' },
  ...kerbs(10, 18, -2.2).map((k) => ({ ...k, box: [k.box[0], -2.2, k.box[2], k.box[3], 0.7, k.box[5]] })),
  { type: 'ramp', box: [10, -2.2, 2.4, 15, 0, 4], up: '-x', mat: 'cream' },
  { type: 'mover', id: 'tram', box: [10, -0.4, -1.5, 13, 0, 1.5], to: [5, 0, 0], speed: 2.2, pause: 1.5, delay: 1.8, on: { latch: 'goTram' }, mat: 'metal' },
  dock('goTram', 5.4, 13, 0),
  draught(10, 18),

  // hall 2: a lamp-lit rack of moulds, then the pit
  { type: 'block', box: [18, -3.2, -4, 28, 0, 4], mat: 'tile' },
  ...kerbs(18, 28),
  { type: 'prop', kind: 'pots', pos: [19.6, 0, 2.7], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [19.8, 0, -3.5] },
  { type: 'prop', kind: 'shelf', pos: [24.0, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'chimney', pos: [23, 0, 8.5], solid: false, scale: 1.2 },
  { type: 'hint', key: 'ferry', box: [22, 0, -4, 27.6, 3, 4] },
  ...pit(28, 36),
  { type: 'mover', id: 'ferry', box: [28, -0.4, -1.5, 31, 0, 1.5], to: [5, 0, 0], speed: 2.2, pause: 1.5, delay: 1.8, on: { latch: 'goFerry' }, mat: 'metal' },
  dock('goFerry', 23.4, 31, 0),
  draught(28, 36),
];

const hoistGallery = () => [
  // the lower floor runs under the whole gallery, so a fall from it only costs a walk back
  { type: 'block', box: [0, -1, -4, 52, 0, 4], mat: 'tile' },
  ...kerbs(0, 12),
  { type: 'checkpoint', pos: [2.2, 0, -0.9], emit: 'a2' },
  { type: 'prop', kind: 'lamp', pos: [1.4, 0, 3.4] },
  { type: 'prop', kind: 'pipe', pos: [5.6, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [6.6, 0, 2.7], scale: 0.9 },
  { type: 'prop', kind: 'chimney', pos: [4, 0, -9], solid: false, scale: 1.4 },
  { type: 'hint', key: 'hoist', box: [4.5, 0, -4, 9, 3, 4] },
  // the hoist: a lift in a shaft cut into the terrace, 6 m up (taller than a cloud can climb)
  { type: 'block', box: [9, 0, -4, 12, 6, -1.5], mat: 'brick' },
  { type: 'block', box: [9, 0, 1.5, 12, 6, 4], mat: 'brick' },
  { type: 'mover', id: 'hoist', box: [9, -0.45, -1.5, 12, -0.05, 1.5], to: [0, 6.05, 0], speed: 2.0, pause: 1.5, delay: 1.8, on: { latch: 'goHoist' }, mat: 'metal' },
  dock('goHoist', 4.4, 12, 0),
  // the terrace
  { type: 'block', box: [12, 0, -4, 22, 6, 4], mat: 'tile' },
  ...kerbs(12, 22, 6),
  { type: 'checkpoint', pos: [14.2, 6, -0.9] },
  { type: 'prop', kind: 'lamp', pos: [13.4, 6, 3.4] },
  { type: 'prop', kind: 'pots', pos: [16.6, 6, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'shelf', pos: [18.0, 6, 3.4], rot: 0 },
  { type: 'hint', key: 'wake', box: [15, 6, -4, 19.6, 9, 4] },
  { type: 'plate', id: 'wakePlate', pos: [19.4, 6, -1.6], size: [1.6, 1.6], emit: 'wake' },
  // the gallery shuttle over a 7 m gap (asleep until the plate is trodden)
  { type: 'mover', id: 'shuttle', box: [22, 5.6, -1.5, 25, 6, 1.5], to: [4, 0, 0], speed: 2.0, pause: 1.5, delay: 2.2, on: 'shuttleOn', mat: 'metal' },
  draught(22, 29),
  ...kerbs(22, 29),
  // the far terrace, and a lift to a high rack (optional shard)
  { type: 'block', box: [29, 0, -4, 40, 6, 4], mat: 'tile' },
  ...kerbs(29, 40, 6),
  { type: 'prop', kind: 'lamp', pos: [30.4, 6, 3.4] },
  { type: 'prop', kind: 'pots', pos: [36.0, 6, 2.6], scale: 0.9 },
  { type: 'mover', id: 'rackLift', box: [32, 5.6, -4, 35, 6, -1.6], to: [0, 3.4, 0], speed: 1.8, pause: 1.5, delay: 1.8, on: { latch: 'goRack' }, mat: 'metal' },
  { type: 'sensor', box: [30, 6, -4, 35, 7.6, 0], emit: 'goRack', visible: false },
  { type: 'block', box: [35, 8.8, -4, 40, 9.4, -0.6], mat: 'cream' },
  { type: 'block', box: [35, 9.4, -4.4, 40, 10.1, -4], mat: 'brick' },
  { type: 'block', box: [35, 9.4, -0.6, 40, 10.1, -0.2], mat: 'brick' },
  { type: 'block', box: [39.6, 9.4, -4, 40, 10.1, -0.6], mat: 'brick' },
  { type: 'shard', pos: [38.2, 10.15, -2.3] },
  // down the long ramp to the pressing room
  { type: 'ramp', box: [40, 0, -4, 52, 6, 4], up: '-x', mat: 'cream' },
  { type: 'block', box: [40, 0, -4.4, 52, 6.7, -4], mat: 'brick' },
  { type: 'block', box: [40, 0, 4, 52, 6.7, 4.4], mat: 'brick' },
];

const pressingRoom = () => [
  { type: 'block', box: [0, -1, -4, 14, 0, 4], mat: 'tile' },
  ...kerbs(0, 14),
  { type: 'checkpoint', pos: [2.2, 0, -0.9], emit: 'a3' },
  { type: 'prop', kind: 'lamp', pos: [1.4, 0, -3.5] },
  { type: 'prop', kind: 'kiln', pos: [6.0, 0, 2.9], rot: 180 },
  { type: 'prop', kind: 'pots', pos: [10.6, 0, 2.8], scale: 0.9 },
  { type: 'prop', kind: 'chimney', pos: [8, 0, -9], solid: false, scale: 1.5 },
  { type: 'prop', kind: 'lamp', pos: [12.6, 0, 3.5] },
  { type: 'crate', id: 'crate', pos: [5.4, 0, -1.8] },
  { type: 'hint', key: 'crate', box: [3.6, 0, -4, 12, 3, 4] },
  ...pit(14, 22),
  { type: 'mover', id: 'barge', box: [14, -0.4, -1.5, 17, 0, 1.5], to: [5, 0, 0], speed: 2.2, pause: 3, delay: 3.4, on: { latch: 'goBarge' }, mat: 'metal' },
  dock('goBarge', 11.8, 17, 0, true),
  draught(14, 22),
  // the far side: the heavy plate, and the bridge hidden in the floor
  { type: 'block', box: [22, -1, -4, 36, 0, 4], mat: 'tile' },
  ...kerbs(22, 36),
  { type: 'plate', id: 'hp', pos: [27.5, 0, 0], size: [1.7, 1.7], heavy: true, emit: 'hp' },
  { type: 'hint', key: 'bridge', box: [23.6, 0, -4, 31, 3, 4] },
  { type: 'prop', kind: 'lamp', pos: [23.2, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [25.6, 0, -3.0], scale: 0.9 },
  { type: 'prop', kind: 'kiln', pos: [32.0, 0, -3.0], rot: 0 },
  { type: 'prop', kind: 'lamp', pos: [34.6, 0, 3.5] },
  ...pit(36, 44),
  { type: 'mover', id: 'bridge', box: [27.8, -0.5, -1.4, 36, -0.1, 1.4], to: [8.2, 0, 0], speed: 2.5, mode: 'toggle', on: 'hp', mat: 'clay' },
  draught(36, 44),
  // the second question: a second crate must cross the bridge (which stands only while the first crate holds
  // its plate) to a second heavy plate, and that plate opens the door to the chimney
  { type: 'crate', id: 'crate2', pos: [31.4, 0, 0] },
  { type: 'hint', key: 'crate2', box: [29.6, 0, -4, 35.6, 3, 4] },
  { type: 'block', box: [44, -1, -4, 56, 0, 4], mat: 'tile' },
  ...kerbs(44, 56),
  { type: 'plate', id: 'hp2', pos: [47.6, 0, 0], size: [1.7, 1.7], heavy: true, emit: 'hp2' },
  { type: 'prop', kind: 'lamp', pos: [45.2, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [54.6, 0, 2.4], scale: 0.9 },
  { type: 'prop', kind: 'kiln', pos: [50.6, 0, -3.0], rot: 0, scale: 0.9 },
  { type: 'block', box: [52, 0, -12, 52.4, 10, -1.2], mat: 'brick' },
  { type: 'block', box: [52, 0, 1.2, 52.4, 10, 12], mat: 'brick' },
  { type: 'block', box: [52, 3, -1.2, 52.4, 10, 1.2], mat: 'brick' },
  { type: 'door', id: 'doorC', box: [52.03, 0, -1.2, 52.37, 3, 1.2], on: 'hp2' },
  { type: 'prop', kind: 'lamp', pos: [55.0, 0, -3.4] },
];

const chimneyStack = () => [
  { type: 'block', box: [0, -1, -4, 12, 0, 4], mat: 'tile' },
  ...kerbs(0, 12),
  { type: 'checkpoint', pos: [2.2, 0, -0.9], emit: 'a4' },
  { type: 'prop', kind: 'lamp', pos: [1.6, 0, -3.5] },
  { type: 'prop', kind: 'shelf', pos: [8.5, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'chimney', pos: [6, 0, -9], solid: false, scale: 1.2 },
  { type: 'hint', key: 'hatch', box: [8.4, 0, -4, 11.6, 3, 4] },
  // optional cage in the south wall: bars in the window, a shard on the floor inside
  { type: 'block', box: [3.25, 0, 4, 6.75, 0.5, 4.4], mat: 'brick' },
  { type: 'block', box: [3.25, 3.1, 4, 6.75, 4.0, 4.4], mat: 'brick' },
  { type: 'block', box: [3.25, 0.5, 4, 3.85, 3.1, 4.4], mat: 'brick' },
  { type: 'block', box: [6.15, 0.5, 4, 6.75, 3.1, 4.4], mat: 'brick' },
  { type: 'grate', box: [3.85, 0.5, 4.05, 6.15, 3.1, 4.35] },
  { type: 'block', box: [3.25, -1, 4.4, 6.75, 0, 7.4], mat: 'dark' },
  { type: 'block', box: [2.85, 0, 4.4, 3.25, 4.0, 7.8], mat: 'brick' },
  { type: 'block', box: [6.75, 0, 4.4, 7.15, 4.0, 7.8], mat: 'brick' },
  { type: 'block', box: [2.85, 0, 7.4, 7.15, 4.0, 7.8], mat: 'brick' },
  { type: 'block', box: [2.85, 4.0, 4, 7.15, 4.4, 7.8], mat: 'brick' },
  { type: 'shard', pos: [5, 1.5, 5.5] },
  { type: 'hint', key: 'cage', box: [2.5, 0, 0.8, 7, 3, 4] },
  // the chimney breast: a sealed shaft (header over the doorway, walls all round, a grate for a roof). The gallery
  // is 8.4 m up: more than a cloud climbs from the floor, even one that jumps first and boils at the top (7.3 m)
  { type: 'block', box: [11.6, 2.6, -1.5, 12, 8.4, 1.5], mat: 'brick' },
  { type: 'block', box: [12, 0, -4, 15.4, 8.4, -1.5], mat: 'brick' },
  { type: 'block', box: [12, 0, 1.5, 15.4, 8.4, 4], mat: 'brick' },
  { type: 'block', box: [15, 0, -1.5, 15.4, 8.4, 1.5], mat: 'brick' },
  { type: 'block', box: [11.6, 0, -4.4, 12, 8.4, -1.5], mat: 'brick' },
  { type: 'block', box: [11.6, 0, 1.5, 12, 8.4, 4.4], mat: 'brick' },
  { type: 'mover', id: 'elevator', box: [12, -0.45, -1.5, 15, -0.05, 1.5], to: [0, 6.8, 0], speed: 2.0, pause: 1.5, delay: 1.8, on: { latch: 'goLift' }, mat: 'metal' },
  { type: 'sensor', box: [7.4, 0, -2.6, 15, 1.8, 2.6], emit: 'goLift', visible: false },
  { type: 'grate', box: [12, 8.0, -1.5, 15, 8.4, 1.5] },
  // the gallery on top of the stack
  { type: 'block', box: [15.4, 0, -4, 19.4, 8.4, 4], mat: 'tile' },
  ...kerbs(15.4, 19.4, 8.4),
  { type: 'prop', kind: 'lamp', pos: [16.8, 8.4, -3.2] },
  { type: 'prop', kind: 'pots', pos: [17.6, 8.4, 2.6], scale: 0.9 },
];

const roofGantry = () => [
  // the gallery's far end: the last checkpoint before the pit
  { type: 'block', box: [0, -1, -4, 4, 7.4, 4], mat: 'tile' },
  ...kerbs(0, 4, 7.4),
  { type: 'checkpoint', pos: [1.4, 7.4, -0.9], emit: 'a5' },
  { type: 'prop', kind: 'lamp', pos: [0.8, 7.4, 3.2] },
  { type: 'hint', key: 'gantry', box: [0.2, 7.4, -4, 4, 10, 4] },
  ...pit(4, 12),
  { type: 'mover', id: 'gantry1', box: [4, 7.0, -1.5, 7, 7.4, 1.5], to: [5, 0, 0], speed: 2.4, pause: 1.2, delay: 1.8, on: { latch: 'goG1' }, mat: 'metal' },
  dock('goG1', -0.4, 7, 7.4),
  draught(4, 12),
  // the hub: a brick pier standing in the pit
  { type: 'block', box: [12, -7, -4, 18, 7.0, 4], mat: 'brick' },
  { type: 'block', box: [12, 7.0, -4, 18, 7.4, 4], mat: 'tile' },
  ...kerbs(12, 18, 7.4),
  { type: 'prop', kind: 'lamp', pos: [13.4, 7.4, 3.3] },
  { type: 'prop', kind: 'pots', pos: [16.2, 7.4, -2.9], scale: 0.9 },
  ...pit(18, 27),
  { type: 'mover', id: 'gantry2', box: [18, 7.0, -1.5, 21, 7.4, 1.5], to: [6, 3.1, 0], speed: 2.2, pause: 1.5, delay: 1.8, on: { latch: 'goG2' }, mat: 'metal' },
  dock('goG2', 13.4, 21, 7.4),
  draught(18, 27),
  // the kiln tower
  { type: 'block', box: [27, -7, -4, 39, 10.1, 4], mat: 'brick' },
  { type: 'block', box: [27, 10.1, -4, 39, 10.5, 4], mat: 'tile' },
  ...kerbs(27, 39, 10.5),
  { type: 'prop', kind: 'lamp', pos: [29.0, 10.5, -3.2] },
  { type: 'prop', kind: 'pots', pos: [32.4, 10.5, 2.6], scale: 0.9 },
  { type: 'prop', kind: 'lamp', pos: [33.4, 10.5, -3.2] },
  { type: 'prop', kind: 'lamp', pos: [29.0, 10.5, 3.2] },
  { type: 'block', box: [38.5, 10.5, -4, 39, 15, 4], mat: 'brick' },
  { type: 'exit', pos: [36.6, 10.5, 0], face: '-x' },
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [21.8, 0, 0],
  [72.6, 6, 0],
  [135, 0, 2.6],
  [160.9, 8.4, 0],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l05',
  name: 'Hung Out to Dry',
  chapter: 2,
  theme: 'loft',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  areas: [
    { name: 'Drying Racks', box: [-6, -12, O[1], 12] },
    { name: 'Hoist Gallery', box: [O[1], -12, O[2], 12] },
    { name: 'Pressing Room', box: [O[2], -12, O[3], 12] },
    { name: 'Chimney Stack', box: [O[3], -12, O[4], 12] },
    { name: 'Roof Gantry', box: [O[4], -12, O[4] + LEN[4] + 8, 12] },
  ],
  hints: {
    start: 'The Drying Loft: racks, rails and a long drop. Anything that moves carries you with it.',
    tram: 'The slip trough is too wide to jump. The tram shuttles across: step on when it docks, ride, step off.',
    ferry: 'Over the kiln pit now. Cold air hangs over every gap in the loft, so a cloud would only fall.',
    hoist: 'The hoist climbs the stack. Ride it up and step off when it is level with the terrace.',
    wake: 'The gallery shuttle is asleep. The plate on the terrace wakes the rails for good.',
    crate2: 'A second crate and a second plate, across the bridge - and the bridge stands only while the first crate holds.',
    crate: 'A heavy plate waits across the pit. Ice can shove the crate on the ferry. Jammed? {restart}.',
    bridge: 'The plate slides the bridge out, and only while something heavy sits on it. A crate stays put.',
    hatch: 'A grate in the roof of the lift shaft. The lift gets you part of the way; a cloud does the rest.',
    cage: 'Bars stop a drop, not a cloud. Something glitters inside the cage.',
    gantry: 'The last stretch hangs over the pit. Ride the ferries out to the kiln door.',
  },
  signals: {
    shuttleOn: { latch: 'wake' },
  },
  pieces: [
    ...LAMPS,
    ...at(O[0], dryingRacks()),
    ...at(O[1], hoistGallery()),
    ...at(O[2], pressingRoom()),
    ...at(O[3], chimneyStack()),
    ...at(O[4], roofGantry(), 1),
  ],
};
