// Fire 3 - "Kindling". Introduces BLAZE in five rooms of the works, each opened by a brazier:
//   1 The Tinder Store   teach: a blaze burns wood. A plank barricade, a stack of kindling that burns
//                        piece by piece, a boarded-up nook with a glow-stone, and coal for fuel.
//   2 The Rafter Hall    practise: a flame is too tall for a low beam (back to a coal to duck under),
//                        too weak to be a coal at a plank wall. And a plank catwalk no flame may enter.
//   3 The Rope Bridge    twist: two gaps, each bridged by a platform that hangs from a rope. Burn the
//                        rope, the bridge comes down. The second rope hangs higher.
//   4 The Boil Basin     heat: a flame boils a pool away for a few seconds, for a bite of heat.
//                        A small pool (and a glow-stone under its pier) then a wide one.
//   5 The Kiln Chamber   combine: the flare, a jump and a push of your own updraft, over a gap and up a
//                        ledge, then the kiln, bricked up with kindling. Burn it and the kiln opens.
// Heat is the price of everything. Forms: ember and blaze. Layout runs along +X (LEVELS.md section 10).
//
// Burnt wood is permanent, so every wood piece here is a BARRIER the route has to burn (planks, the
// stack, the nook boards, the ropes, the kindling at the kiln) except the catwalk planks: those are
// the floor of a gatehouse whose doors are 0.8 m high. A blaze is 1.05 m tall and cannot get in, so
// the only way across can never be burnt by the player (tests/levels-f01-f03.test.js proves it).

// ---------------------------------------------------------------------------- little builders
const floor = (x0, x1, y = 0, mat = 'tile') => ({ type: 'block', box: [x0, y - 1, -5, x1, y, 5], mat });
const walls = (x0, x1, h = 3.6, mat = 'brick') => [
  { type: 'block', box: [x0, 0, -5.5, x1, h, -5], mat },
  { type: 'block', box: [x0, 0, 5, x1, h, 5.5], mat },
];
/** A doorway across the hall: two piers and a lintel leaving a 3 m x 3 m opening. `t` is the pier depth. */
const frame = (x, t = 0.5) => [
  { type: 'block', box: [x, 0, -5, x + t, 3.6, -1.5], mat: 'brick' },
  { type: 'block', box: [x, 0, 1.5, x + t, 3.6, 5], mat: 'brick' },
  { type: 'block', box: [x, 3, -1.5, x + t, 3.6, 1.5], mat: 'brick' },
];
/** A wall with a 0.8 m high slot through it: a coal passes, a flame does not. */
const beam = (x, t = 0.6) => [{ type: 'block', box: [x, 0.8, -5, x + t, 3.6, 5], mat: 'brick' }];
/** A wall across the hall with a slot 2.4 m wide and 0.8 m high at the floor. */
const flap = (x, t = 0.6) => [
  { type: 'block', box: [x, 0.8, -5, x + t, 3.6, 5], mat: 'brick' },
  { type: 'block', box: [x, 0, -5, x + t, 0.8, -1.2], mat: 'brick' },
  { type: 'block', box: [x, 0, 1.2, x + t, 0.8, 5], mat: 'brick' },
];
/** A stack of kindling filling a 3 x 3 m doorway: nine pieces that catch from one another. */
const stack = (id, x, t = 0.6, burn = 1.4) => {
  const out = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    out.push({ type: 'wood', id: `${id}${row}${col}`, kind: 'block', box: [x, row, -1.5 + col, x + t, row + 1, -0.5 + col], burn });
  }
  return out;
};

export default {
  id: 'f03',
  element: 'fire',
  name: 'Kindling',
  chapter: 1,
  theme: 'pilot',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember', 'blaze'],
  hints: {
    start: 'Planks bar the way. {blaze} to flare up into a flame: a blaze burns wood, and burns through heat.',
    nook: 'A nook boarded up with planks, and a glow-stone gleaming behind them.',
    fuel: 'Burning wood pays a little heat back. Coal pays more, and a brazier fills the gauge.',
    pile: 'A stack of kindling. Light one piece and the fire spreads through the rest.',
    beam: 'A flame stands too tall for this beam. {ember} to settle back into a coal and duck under.',
    walk: 'Dry planks over a drop. A flame would burn them away, so cross as a coal.',
    rope: 'The bridge hangs from that rope. A blaze will burn it through.',
    rope2: 'This rope hangs higher. Climb the ledge, then burn it from there.',
    boil: 'A blaze boils a pool to steam, for a moment and a bite of heat. Wade over before it rains back.',
    big: 'A wider pool means a longer wade. Do not dawdle, or the water comes back on you.',
    flare: 'Too far, even for a flame. Jump, then {flare} in mid-air to ride your own updraft.',
    ledge: 'A ledge too high even for a flame. Jump, then {flare} at the top of the jump and land on it.',
    kiln: 'The kiln is bricked up with kindling. Burn it, and the kiln will know a flame has come.',
  },
  areas: [
    { name: 'The Tinder Store', box: [-4, -5, 48, 5] },
    { name: 'The Rafter Hall', box: [48, -5, 106, 5] },
    { name: 'The Rope Bridge', box: [106, -5, 148, 5] },
    { name: 'The Boil Basin', box: [148, -5, 196, 5] },
    { name: 'The Kiln Chamber', box: [196, -5, 252, 5] },
  ],
  signals: {
    hsLatched: { latch: 'hs' },
  },
  pieces: [
    // ======================================================== 1. The Tinder Store (x -4..48)
    floor(-4, 48),
    { type: 'block', box: [-4.5, 0, -5, -4, 0.8, 5], mat: 'brick' },
    ...walls(2, 48),
    { type: 'brazier', id: 'b1', pos: [3, 0, 0] },
    { type: 'prop', kind: 'shelf', pos: [-0.5, 0, 4.6], rot: 0 },
    // the nook, walled up with boards (a glow-stone behind them)
    { type: 'hint', key: 'nook', box: [4, 0, -5, 9, 3, 2.2] },
    { type: 'block', box: [5, 0, 2.2, 5.4, 3.6, 5], mat: 'brick' },
    { type: 'block', box: [7.6, 0, 2.2, 8, 3.6, 5], mat: 'brick' },
    { type: 'block', box: [5.4, 2.4, 2.2, 7.6, 3.6, 5], mat: 'brick' },
    { type: 'wood', id: 'nook', kind: 'block', box: [5.4, 0, 2.2, 7.6, 2.4, 2.6] },
    { type: 'shard', pos: [6.5, 0.7, 3.5] },
    { type: 'prop', kind: 'pots', pos: [10.5, 0, -3.9] },
    // the first barricade: planks
    ...frame(16),
    { type: 'wood', id: 'barricade', kind: 'plank', box: [16.05, 0, -1.5, 16.45, 3, 1.5] },
    // a room of kindling and coal, then the stack
    { type: 'hint', key: 'fuel', box: [18, 0, -5, 26, 3, 5] },
    { type: 'coal', pos: [24, 0.5, -2.6] },
    { type: 'prop', kind: 'pots', pos: [20, 0, 3.9], scale: 0.9 },
    { type: 'prop', kind: 'shelf', pos: [28, 0, -4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [31, 0, 3.9] },
    { type: 'hint', key: 'pile', box: [30, 0, -5, 35.5, 3, 5] },
    ...frame(36, 0.8),
    ...stack('pile', 36.1),
    { type: 'prop', kind: 'kiln', pos: [41, 0, -3.9], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [44, 0, 4.6] },

    // ======================================================== 2. The Rafter Hall (x 48..106)
    floor(48, 94.6),
    { type: 'brazier', id: 'b2', pos: [50, 0, 0] },
    ...walls(48, 106),
    { type: 'prop', kind: 'pipe', pos: [52, 0, -4.6], rot: 0 },
    { type: 'hint', key: 'beam', box: [52.6, 0, -5, 56.6, 3, 5] },
    ...beam(57),
    { type: 'prop', kind: 'pots', pos: [62, 0, 3.9] },
    ...frame(68),
    { type: 'wood', id: 'planks2', kind: 'plank', box: [68.05, 0, -1.5, 68.45, 3, 1.5] },
    { type: 'prop', kind: 'shelf', pos: [72, 0, -4.6], rot: 0 },
    ...beam(77),
    { type: 'prop', kind: 'pipe', pos: [82, 0, 4.6], rot: 0 },
    ...frame(88),
    { type: 'wood', id: 'planks3', kind: 'plank', box: [88.05, 0, -1.5, 88.45, 3, 1.5] },
    // the gatehouse: a plank catwalk over a drop, behind a slot only a coal fits through
    { type: 'hint', key: 'walk', box: [90, 0, -5, 93.6, 3, 5] },
    ...flap(94),
    { type: 'block', box: [94.6, -3, -5, 104, 3.6, -1.2], mat: 'brick' },
    { type: 'block', box: [94.6, -3, 1.2, 104, 3.6, 5], mat: 'brick' },
    { type: 'wood', id: 'walk1', kind: 'plank', box: [94.6, -0.3, -1.2, 97, 0, 1.2], spread: false },
    { type: 'wood', id: 'walk2', kind: 'plank', box: [97, -0.3, -1.2, 99.4, 0, 1.2], spread: false },
    { type: 'wood', id: 'walk3', kind: 'plank', box: [99.4, -0.3, -1.2, 101.8, 0, 1.2], spread: false },
    { type: 'wood', id: 'walk4', kind: 'plank', box: [101.8, -0.3, -1.2, 104, 0, 1.2], spread: false },
    ...flap(104),

    // ======================================================== 3. The Rope Bridge (x 106..148)
    floor(104.6, 118),
    { type: 'brazier', id: 'b3', pos: [107.5, 0, 0] },
    ...walls(106, 148),
    { type: 'prop', kind: 'pots', pos: [110, 0, -3.9] },
    { type: 'hint', key: 'rope', box: [111.5, 0, -5, 116.6, 3, 5] },
    { type: 'wood', id: 'rope1', kind: 'rope', from: [116.8, 0.15, 2.2], to: [118.3, 3.4, 1.3], emit: 'cut1' },
    { type: 'mover', id: 'bridge1', box: [118, 3, -1.5, 127, 3.4, 1.5], to: [0, -3.4, 0], speed: 2.6, mode: 'toggle', on: 'cut1', mat: 'metal' },
    floor(127, 133),
    { type: 'brazier', id: 'b3b', pos: [129.5, 0, 1.5] },
    { type: 'hint', key: 'rope2', box: [127.4, 0, -5, 131.4, 3, 0.5] },
    { type: 'block', box: [129, -1, -5, 131.4, 1.3, -1.8], mat: 'cream' },
    { type: 'wood', id: 'rope2', kind: 'rope', from: [129.8, 2.3, -2.6], to: [132.4, 2.5, -2.6], emit: 'cut2' },
    { type: 'mover', id: 'bridge2', box: [133, 3, -1.5, 142, 3.4, 1.5], to: [0, -3.4, 0], speed: 2.6, mode: 'toggle', on: 'cut2', mat: 'metal' },
    floor(142, 162),
    { type: 'prop', kind: 'lamp', pos: [144, 0, 4.6] },

    // ======================================================== 4. The Boil Basin (x 148..196)
    ...walls(148, 196),
    { type: 'brazier', id: 'b4', pos: [150, 0, 0] },
    { type: 'prop', kind: 'pipe', pos: [152, 0, -4.6], rot: 0 },
    { type: 'coal', pos: [155, 0.5, -2.6] },
    { type: 'hint', key: 'boil', box: [157, 0, -5, 161.5, 3, 5] },
    { type: 'block', box: [162, -1.3, -5, 168, -0.5, 5], mat: 'dark' },
    { type: 'pool', id: 'pool1', box: [162, -0.5, -5, 168, -0.08, 5], boil: 3.5 },
    { type: 'block', box: [164, 0.3, 2.2, 166.5, 3.6, 5], mat: 'brick' },
    { type: 'shard', pos: [165.25, -0.05, 3.1] },
    floor(168, 178),
    { type: 'brazier', id: 'b4b', pos: [171, 0, 0] },
    { type: 'hint', key: 'big', box: [172, 0, -5, 177.5, 3, 5] },
    { type: 'coal', pos: [174, 0.5, -2.6] },
    { type: 'prop', kind: 'shelf', pos: [173, 0, 4.6], rot: 0 },
    { type: 'block', box: [178, -1.3, -5, 189, -0.5, 5], mat: 'dark' },
    { type: 'pool', id: 'pool2', box: [178, -0.5, -5, 189, -0.08, 5], boil: 4 },
    floor(189, 206),
    { type: 'prop', kind: 'pots', pos: [192, 0, 3.9] },
    { type: 'prop', kind: 'kiln', pos: [194, 0, -3.9], rot: 0 },

    // ======================================================== 5. The Kiln Chamber (x 196..252)
    { type: 'brazier', id: 'b5', pos: [198, 0, 0] },
    ...walls(196, 252),
    { type: 'hint', key: 'flare', box: [200, 0, -5, 205.6, 3, 5] },
    floor(211.8, 252),
    { type: 'brazier', id: 'b5b', pos: [214, 0, 0] },
    { type: 'block', box: [217, 0, -5, 219.5, 2.1, -1.8], mat: 'cream' },
    { type: 'shard', pos: [218.25, 2.8, -2.9] },
    { type: 'hint', key: 'ledge', box: [214.6, 0, -5, 217, 3, 0] },
    { type: 'brazier', id: 'b5c', pos: [230.5, 0, 0] },
    { type: 'prop', kind: 'pots', pos: [224, 0, 3.9] },
    { type: 'prop', kind: 'lamp', pos: [228, 0, -4.6] },
    { type: 'hint', key: 'kiln', box: [229, 0, -5, 235, 3, 5] },
    ...frame(238, 0.8),
    ...stack('pyre', 238.1, 0.6, 2.4),
    { type: 'heatsensor', id: 'hs', box: [238.6, 0, -1.5, 241.5, 2.4, 1.5], emit: 'hs' },
    { type: 'block', box: [245, 0, -5, 245.5, 3.6, 5], mat: 'brick' },
    { type: 'exit', pos: [242.6, 0, 0], face: '-x', on: 'hsLatched' },
  ],
};
