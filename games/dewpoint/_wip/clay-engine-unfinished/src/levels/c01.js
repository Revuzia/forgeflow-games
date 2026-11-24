// Clay 1 - "Hessian Hands". Dab is soft clay, and soft clay STICKS. Five rooms of the wedging works,
// each opened by a lamp post, each one idea (EASY tier, DESIGN-V2.md section 1):
//   1 The Damp Cellar    teach: a rough wall can be climbed - walk into it and keep pushing. A low
//                        one, a taller one, then one whose rough patch is off to the side (smooth
//                        brick is just a wall).
//   2 Hessian Stair      practise: two terraces climbed one after the other; grip comes back on every
//                        floor. The second is capped: climb, then move ALONG the wall to the open end.
//                        A rough pillar off to the side holds a maker's mark.
//   3 The Drying Racks   twist: the racks overhead are rough underneath. Jump up, hang on, cross the
//                        drop hand over hand, let go. Fall, and a rough wall leads back up.
//   4 Kneading Hall      combine: climb a plinth to stand on the plate that opens the shutter; climb a
//                        terrace to reach the next rack.
//   5 The Wedging Yard   payoff: two last climbs to the kiln on the top terrace. (A pillar beside a
//                        rough panel holds the clever mark: climb, then jump off the wall onto it.)
// Forms: clay only. Layout runs along +X (LEVELS.md section 11). Every gate is a wall across the
// whole hall, smooth except for its rough panel, and taller than Dab can jump (1.35 m): the only
// way up is the panel. tests/levels-c01-c03.test.js proves each one.

const floor = (x0, x1, y = 0, mat = 'tile') => ({ type: 'block', box: [x0, y - 1, -5, x1, y, 5], mat });
/** Side walls of a stretch of hall, from y0 up to `top`. */
const walls = (x0, x1, top, mat = 'brick', y0 = -1) => [
  { type: 'block', box: [x0, y0, -5.5, x1, top, -5], mat },
  { type: 'block', box: [x0, y0, 5, x1, top, 5.5], mat },
];
/** A wall right across the hall at x (`t` thick, `h` tall from y) whose middle (z -w..w) is rough. */
const climbWall = (x, h, { y = 0, t = 1, w = 1.6, mat = 'brick' } = {}) => [
  { type: 'rough', box: [x, y, -w, x + t, y + h, w] },
  { type: 'block', box: [x, y, -5, x + t, y + h, -w], mat },
  { type: 'block', box: [x, y, w, x + t, y + h, 5], mat },
];
/** A step up to a higher floor: a 0.6 m face at x (rough in the middle), the floor at y1 from x to x1, solid down to y0. */
const terrace = (x, y0, y1, x1, { w = 1.6, mat = 'cream' } = {}) => [
  { type: 'rough', box: [x, y0, -w, x + 0.6, y1, w] },
  { type: 'block', box: [x, y0, -5, x + 0.6, y1, -w], mat },
  { type: 'block', box: [x, y0, w, x + 0.6, y1, 5], mat },
  { type: 'block', box: [x + 0.6, y0, -5, x1, y1, 5], mat: 'tile' },
];
/** The face of a ledge over a drop, at x (0.4 thick), rough in the middle so a fall can be climbed back. */
const pitWall = (x, y0, y1, w = 1.6) => [
  { type: 'rough', box: [x, y0, -w, x + 0.4, y1, w] },
  { type: 'block', box: [x, y0, -5, x + 0.4, y1, -w], mat: 'cream' },
  { type: 'block', box: [x, y0, w, x + 0.4, y1, 5], mat: 'cream' },
];
/** A drying rack: a rough board overhead (its underside at y), from x0 to x1. */
const rack = (x0, x1, y, w = 1.6) => ({ type: 'rough', box: [x0, y, -w, x1, y + 0.4, w], mat: 'dark' });

export default {
  id: 'c01',
  element: 'clay',
  name: 'Hessian Hands',
  chapter: 1,
  theme: 'wedge',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['clay'],
  hints: {
    start: 'Dab is soft clay, and soft clay sticks. Walk into the rough patch of that wall and keep pushing to climb.',
    tall: 'A taller wall takes longer. Keep pushing until Dab hauls itself over the top.',
    side: 'Smooth brick will not hold. Find the rough patch: this one is off to the side.',
    rest: 'Grip runs out while Dab hangs on. Standing on firm floor brings it back, so rest on every ledge.',
    post: 'No rough patch on this wall. Climb the rough post beside it, then jump across to the top.',
    along: 'This wall is capped. Climb to the top, then push along the wall to where there is room to pull over.',
    hang: 'The racks are rough underneath. Jump up into one to hang on, cross hand over hand, and let go with {jump}.',
    fell: 'Fell? The near wall of the drop is rough: climb back up and try again.',
    plate: 'The shutter answers to the plate up on the plinth. Jump onto the step, climb, and stand on the plate.',
    combo: 'Climb up first: the next rack is too high to reach from the floor.',
  },
  areas: [
    { name: 'The Damp Cellar', box: [-9, -5.5, 32, 5.5] },
    { name: 'Hessian Stair', box: [32, -5.5, 66, 5.5] },
    { name: 'The Drying Racks', box: [66, -5.5, 102, 5.5] },
    { name: 'Kneading Hall', box: [102, -5.5, 135, 5.5] },
    { name: 'The Wedging Yard', box: [135, -5.5, 175, 5.5] },
  ],
  signals: {
    gateA: { latch: 'plateA' },
  },
  pieces: [
    // ======================================================== 1. The Damp Cellar (x -9..32)
    floor(-8.5, 40),
    { type: 'block', box: [-9, 0, -5, -8.5, 0.8, 5], mat: 'brick' },
    ...walls(-9, 32, 4.6),
    { type: 'checkpoint', pos: [2.5, 0, 0] },
    { type: 'prop', kind: 'shelf', pos: [-3, 0, 4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [4.5, 0, -3.9] },
    // an easy mark on a low bench: a jump up
    { type: 'block', box: [6, 0, 3, 8.4, 1.0, 5], mat: 'cream' },
    { type: 'shard', pos: [7.2, 1.7, 4] },
    { type: 'prop', kind: 'lamp', pos: [10, 0, -4.6] },
    ...climbWall(13, 2.0),
    { type: 'prop', kind: 'pipe', pos: [17.5, 0, 4.6], rot: 0 },
    { type: 'hint', key: 'tall', box: [18.5, 0, -5, 20.9, 3, 5] },
    ...climbWall(21, 2.6),
    { type: 'prop', kind: 'pots', pos: [24.5, 0, -3.9] },
    // the third wall: its rough patch is off to one side
    { type: 'hint', key: 'side', box: [24, 0, -2.5, 26.9, 3, 5] },
    { type: 'rough', box: [27, 0, 2.0, 28, 2.2, 4.4] },
    { type: 'block', box: [27, 0, -5, 28, 2.2, 2.0], mat: 'brick' },
    { type: 'block', box: [27, 0, 4.4, 28, 2.2, 5], mat: 'brick' },
    { type: 'prop', kind: 'shelf', pos: [31, 0, -4.6], rot: 0 },

    // ======================================================== 2. Hessian Stair (x 32..66)
    ...walls(32, 66, 7.6),
    { type: 'checkpoint', pos: [34, 0, 0] },
    { type: 'hint', key: 'rest', box: [36, 0, -5, 39.9, 3, 5] },
    { type: 'prop', kind: 'pots', pos: [37, 0, -3.9] },
    ...terrace(40, 0, 1.8, 48),
    // a rough pillar off to the side, with a mark on top
    { type: 'rough', box: [43.4, 1.8, 2.4, 44.6, 4.4, 3.6] },
    { type: 'shard', pos: [44, 5.1, 3] },
    { type: 'prop', kind: 'lamp', pos: [46.5, 1.8, -4.6] },
    // the capped wall: rough all along, a coping over most of its top - pull over at the open end
    { type: 'hint', key: 'along', box: [45.4, 1.8, -5, 47.9, 4.8, 5] },
    { type: 'rough', box: [48, 0, -1.6, 48.6, 3.6, 4.6] },
    { type: 'block', box: [48, 0, -5, 48.6, 3.6, -1.6], mat: 'cream' },
    { type: 'block', box: [48, 0, 4.6, 48.6, 3.6, 5], mat: 'cream' },
    { type: 'block', box: [48.6, 0, -5, 73.6, 3.6, 5], mat: 'tile' },
    { type: 'block', box: [48, 3.6, -5, 49.4, 4.6, 2.4], mat: 'brick' },
    // a smooth wall with no rough patch: climb the rough post beside it and jump across to its top
    { type: 'hint', key: 'post', box: [52, 3.6, -5, 55.9, 6.6, 5] },
    { type: 'rough', box: [56, 3.6, -1.6, 57.2, 6.2, -0.4] },
    { type: 'block', box: [58, 3.6, -5, 59, 6.0, 5], mat: 'brick' },
    { type: 'prop', kind: 'shelf', pos: [54, 3.6, 4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [62, 3.6, -3.9] },

    // ======================================================== 3. The Drying Racks (x 66..102)
    ...walls(66, 102, 8.6),
    { type: 'checkpoint', pos: [68, 3.6, 0] },
    { type: 'hint', key: 'hang', box: [69.5, 3.6, -5, 73.4, 6.6, 5] },
    // the first drop: 3.2 m across (a jump makes 2.8), a rack over it, a rough wall back up out of it
    ...pitWall(73.6, 0, 3.6),
    floor(74, 77.2, 0, 'dark'),
    { type: 'hint', key: 'fell', box: [74, 0, -5, 77.2, 2, 5] },
    rack(72.6, 78.6, 5.3),
    { type: 'block', box: [77.2, 0, -5, 80.6, 3.6, 5], mat: 'tile' },
    { type: 'prop', kind: 'pots', pos: [78.6, 3.6, 3.9] },
    // a gap to jump (2.2 m: a running jump makes 2.8), rough on the near side again
    ...pitWall(80.6, 0, 3.6),
    floor(81, 83.2, 0, 'dark'),
    { type: 'block', box: [83.2, 0, -5, 87.6, 3.6, 5], mat: 'tile' },
    { type: 'prop', kind: 'lamp', pos: [85, 3.6, -4.6] },
    // the second drop, the same again
    ...pitWall(87.6, 0, 3.6),
    floor(88, 91.2, 0, 'dark'),
    rack(86.6, 92.6, 5.3),
    { type: 'block', box: [91.2, 0, -5, 96, 3.6, 5], mat: 'tile' },
    { type: 'prop', kind: 'shelf', pos: [94, 3.6, 4.6], rot: 0 },

    // ======================================================== 4. Kneading Hall (x 102..135)
    { type: 'block', box: [96, -1, -5, 131.2, 2.4, 5], mat: 'tile' },
    ...walls(102, 135, 8.6),
    { type: 'checkpoint', pos: [103.5, 2.4, 0] },
    { type: 'prop', kind: 'kiln', pos: [106, 2.4, -3.9], rot: 0 },
    { type: 'hint', key: 'plate', box: [107, 2.4, -5, 110.8, 5.4, 5] },
    // the plinth: a step to jump onto, a rough face above it, a plate on top
    { type: 'block', box: [110.6, 2.4, -0.6, 114, 3.4, 1.6], mat: 'cream' },
    { type: 'block', box: [111, 2.4, 2.0, 113.6, 5.6, 4.6], mat: 'cream' },
    { type: 'rough', box: [111, 3.4, 1.6, 113.6, 5.6, 2.0] },
    { type: 'plate', pos: [112.3, 5.6, 3.2], emit: 'plateA' },
    // the shutter, in a wall right across the hall
    { type: 'block', box: [121, 2.4, -5, 121.6, 8.6, -1.5], mat: 'brick' },
    { type: 'block', box: [121, 2.4, 1.5, 121.6, 8.6, 5], mat: 'brick' },
    { type: 'block', box: [121, 5.4, -1.5, 121.6, 8.6, 1.5], mat: 'brick' },
    { type: 'door', id: 'shutter', box: [121.05, 2.4, -1.5, 121.55, 5.4, 1.5], on: 'gateA' },
    { type: 'hint', key: 'combo', box: [122, 2.4, -5, 124.9, 5.4, 5] },
    ...terrace(125, 2.4, 4.4, 127.6),
    ...pitWall(127.6, 2.4, 4.4),
    rack(127, 132.4, 6.1),
    { type: 'prop', kind: 'pots', pos: [123, 2.4, 3.9] },

    // ======================================================== 5. The Wedging Yard (x 135..175)
    { type: 'block', box: [131.2, 0, -5, 146.6, 4.4, 5], mat: 'tile' },
    ...walls(135, 175, 13),
    { type: 'checkpoint', pos: [139.5, 4.4, 0] },
    // the clever mark: a pillar a step out from a rough panel on the wall. Climb high, jump off the panel onto it.
    { type: 'rough', box: [143, 4.4, -5, 146.4, 7.6, -4.6] },
    { type: 'block', box: [144, 4.4, -3.4, 145.6, 6.4, -2.4], mat: 'cream' },
    { type: 'shard', pos: [144.8, 7.1, -2.9] },
    // one last rack, over the yard's drain
    ...pitWall(146.6, 1.4, 4.4),
    floor(147, 150.2, 1.4, 'dark'),
    rack(146, 151.4, 6.1),
    { type: 'block', box: [150.2, 0, -5, 154, 4.4, 5], mat: 'tile' },
    ...terrace(154, 4.4, 6.8, 160),
    { type: 'prop', kind: 'lamp', pos: [158, 6.8, -4.6] },
    ...terrace(160, 6.8, 9.2, 174.5),
    { type: 'prop', kind: 'kiln', pos: [166, 9.2, 3.6], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [168, 9.2, -4.6] },
    { type: 'block', box: [173.2, 9.2, -5, 173.7, 12.4, 5], mat: 'brick' },
    { type: 'exit', pos: [171.6, 9.2, 0], face: '-x' },
    { type: 'prop', kind: 'chimney', pos: [164, 9.2, -4], solid: false },
  ],
};
