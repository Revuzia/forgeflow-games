// Fire 7 - "Chimney Sweep". Chapter 2 (Flue): SMOKE. Smoke has no weight: it rises until it meets a
// ceiling and then slides along it, as far as its heat lasts. A ceiling is its road, so every
// smoke section here is roofed, and the road runs over things nothing else can cross. It passes
// grates, cannot light anything, and falls back to a coal the moment it is asked to. Five areas:
//   The Soot Hall       a grate in a doorway (smoke slips through), then a pool twenty metres wide
//                       under a low ceiling: rise, slide along the roof, drop out on the far bank.
//   The Sprinkler Run   curtains of spray from floor to three metres, a ceiling at four: slide over
//                       them. Heat for twenty metres at a time, so a platform with a brazier between.
//                       A glow-stone sits above a grate hatch in the roof.
//   The Smokehouse      three sealed chambers (one roof, walls too tall to climb) with a grated window and a lit brazier each: be
//                       smoke to get in, a coal to warm up, smoke again to get on, smoke over a
//                       curtain of spray in the last one, and a blaze to burn the final wall. The form
//                       you need changes in every room.
//   The Lantern Duct    a pool thirty-four metres wide: more than a gauge of smoke, unless a draught
//                       blows along the roof. Two lanterns start it (one over a ledge), and both must
//                       be lit by an ember first: smoke cannot light anything. Order matters.
//   The Kiln Stack      a sealed tower: up a grated hatch on an updraft, over a curtain of spray, a
//                       lantern (lit by a coal) that opens a roof hatch, a second climb, and a flame
//                       for the heat sensor that opens the kiln.
// Forms: ember, blaze and smoke. Layout runs along +X; see LEVELS.md section 10.
// Each area is built in its own coordinates (x = 0 at its start) by a function and slid into place by `o`.

const sx = (o, b) => b.map((v, i) => (i === 0 || i === 3 ? v + o : v));    // a box [x0 y0 z0 x1 y1 z1], slid by o
const sp = (o, p) => [p[0] + o, p[1], p[2]];                                // a point, slid by o
const block = (o, mat, ...b) => ({ type: 'block', box: sx(o, b), mat });
/**
 * Seal the space above a roof: a cap across each end and a wall along each side, all too tall for a gauge of smoke
 * to climb (a roof that can be flown onto is a road for a coal). `top` is the roof's top face.
 */
const sealTop = (o, x0, x1, top) => [
  block(o, 'dark', x0, top, -4.5, x0 + 0.4, 26, 4.5),
  block(o, 'dark', x1 - 0.4, top, -4.5, x1, 26, 4.5),
  block(o, 'dark', x0, top, -4.5, x1, 26, -4),
  block(o, 'dark', x0, top, 4, x1, 26, 4.5),
];
/** A wall across a roofed hall at x (thickness t) with a grated window, 6 m wide, from y = 0.2 up to the roof at 4. */
const windowWall = (o, x, t = 0.4) => [
  block(o, 'brick', x, 0, -4, x + t, 4, -3),
  block(o, 'brick', x, 0, 3, x + t, 4, 4),
  block(o, 'brick', x, 0, -3, x + t, 0.2, 3),
  { type: 'grate', box: sx(o, [x + 0.05, 0.2, -3, x + t - 0.05, 4, 3]) },
];
/** A doorway wall at x with a 2.4 m gap 3 m tall (the filling is left to the caller). */
const doorway = (o, x, t = 0.5, top = 3.6) => [
  block(o, 'brick', x, 0, -4, x + t, top, -1.2),
  block(o, 'brick', x, 0, 1.2, x + t, top, 4),
  block(o, 'brick', x, 3, -1.2, x + t, top, 1.2),
];

/** The Soot Hall: a grate in a doorway, then a wide pool under a low ceiling. */
function sootHall(o) {
  return [
    block(o, 'tile', -4, -1, -4, 22, 0, 4),
    block(o, 'brick', -4.5, 0, -4, -4, 0.8, 4),
    { type: 'prop', kind: 'chimney', pos: sp(o, [1, 0, -3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [-1.8, 0, 3.0]), scale: 0.9 },
    { type: 'brazier', id: 'b1', pos: sp(o, [3, 0, 0]) },
    { type: 'hint', key: 'grate', box: sx(o, [5.4, 0, -4, 11.6, 3, 4]) },
    // a grate fills the doorway: smoke slips through, nothing else can
    block(o, 'brick', 12, 0, -4, 12.4, 3.6, -1.2),
    block(o, 'brick', 12, 0, 1.2, 12.4, 3.6, 4),
    block(o, 'brick', 12, 3, -1.2, 12.4, 3.6, 1.2),
    { type: 'grate', id: 'doorGrate', box: sx(o, [12.05, 0, -1.2, 12.35, 3, 1.2]) },
    // glow-stone one, just behind it
    { type: 'shard', pos: sp(o, [13.6, 1.5, 0.3]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [16, 0, 3.4]) },
    { type: 'brazier', id: 'b1a', pos: sp(o, [19, 0, 0]) },
    { type: 'hint', key: 'crawl', box: sx(o, [19.8, 0, -4, 22, 3, 4]) },
    // the pool, under a ceiling 2.8 m above the floor
    block(o, 'dark', 22, -1.2, -4, 42, -0.5, 4),
    { type: 'pool', id: 'sootPool', box: sx(o, [22, -0.5, -4, 42, -0.08, 4]), boil: 2.2 },
    block(o, 'dark', 20, 2.8, -4, 44, 3.2, 4),
    ...sealTop(o, 20, 44, 3.2),
    block(o, 'tile', 42, -1, -4, 64, 0, 4),
    { type: 'brazier', id: 'b1b', pos: sp(o, [46, 0, 0]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [50, 0, -3.3]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [53, 0, 3.5]) },
    { type: 'prop', kind: 'shelf', pos: sp(o, [58, 0, -3.5]), rot: 0 },
  ];
}

/** The Sprinkler Run: spray to three metres under a roof at four; a platform with a brazier between the zones. */
function sprinklerRun(o) {
  return [
    block(o, 'tile', 0, -1, -4, 66, 0, 4),
    { type: 'brazier', id: 'b2', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'spray', box: sx(o, [2.4, 0, -4, 6.6, 3, 4]) },
    // the roof, with a grate hatch over the middle platform
    block(o, 'dark', 4, 4.2, -4, 27, 4.6, 4),
    block(o, 'dark', 27, 4.2, -4, 29, 4.6, -1.2),
    block(o, 'dark', 27, 4.2, 1.2, 29, 4.6, 4),
    block(o, 'dark', 29, 4.2, -4, 64, 4.6, 4),
    ...sealTop(o, 4, 64, 4.6),
    // glow-stone two, above the hole under a cap, in a pocket on top of the roof (the only way out of it is back down the hole)
    block(o, 'dark', 25, 4.6, -4, 25.4, 26, 4),
    block(o, 'dark', 30.6, 4.6, -4, 31, 26, 4),
    { type: 'hint', key: 'hatch', box: sx(o, [24.4, 0, -4, 27, 3, 4]) },
    block(o, 'dark', 25, 6.6, -3, 31, 7, 3),
    { type: 'shard', pos: sp(o, [28, 5.9, 0]) },
    // zone one
    { type: 'sprinkler', id: 'sprayA', box: sx(o, [9, 0, -4, 12, 3, 4]) },
    { type: 'sprinkler', id: 'sprayB', box: sx(o, [17, 0, -4, 20, 3, 4]) },
    { type: 'brazier', id: 'b3', pos: sp(o, [28, 0, 0]) },
    // zone two
    { type: 'sprinkler', id: 'sprayC', box: sx(o, [38, 0, -4, 41, 3, 4]) },
    { type: 'sprinkler', id: 'sprayD', box: sx(o, [45, 0, -4, 48, 3, 4]) },
    { type: 'brazier', id: 'b3b', pos: sp(o, [55, 0, 0]) },
    { type: 'prop', kind: 'pipe', pos: sp(o, [4, 0, -3.5]), rot: 0 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [24, 0, 3.4]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [33, 0, -3.5]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [59, 0, 3.2]), scale: 0.9 },
    { type: 'prop', kind: 'shelf', pos: sp(o, [62, 0, -3.5]), rot: 0 },
  ];
}

/** The Smokehouse: two sealed chambers, each with a grated window and a lit brazier; a plank wall to finish. */
function smokehouse(o) {
  return [
    block(o, 'tile', 0, -1, -4, 68, 0, 4),
    { type: 'brazier', id: 'b4', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'house', box: sx(o, [2.4, 0, -4, 6.4, 3, 4]) },
    { type: 'prop', kind: 'chimney', pos: sp(o, [4, 0, 3.4]) },
    ...windowWall(o, 8),
    // one roof over the whole smokehouse and walls too tall for a gauge of smoke to climb: no way over or around
    block(o, 'dark', 0, 4, -4, 68, 4.4, 4),
    block(o, 'dark', 0, -1, -4.5, 68, 26, -4),
    block(o, 'dark', 0, -1, 4, 68, 26, 4.5),
    // chamber one: a lit brazier, and a shelf with glow-stone three
    { type: 'brazier', id: 'b5', pos: sp(o, [12, 0, 0]), lit: true },
    block(o, 'cream', 14.4, 0, -4, 17.4, 2, -2.2),
    { type: 'shard', pos: sp(o, [15.9, 3.2, -3.1]) },
    { type: 'hint', key: 'inside', box: sx(o, [9, 0, -4, 13, 3.2, 4]) },
    ...windowWall(o, 24),
    // chamber two
    { type: 'brazier', id: 'b6', pos: sp(o, [28, 0, 0]), lit: true },
    ...windowWall(o, 40),
    // chamber three: a lit brazier, a curtain of spray to three metres (the roof is at four: rise first, then slide), a second brazier, the plank wall
    { type: 'brazier', id: 'b6b', pos: sp(o, [44, 0, 0]), lit: true },
    { type: 'sprinkler', id: 'sprayG', box: sx(o, [48, 0, -4, 51, 3, 4]) },
    { type: 'brazier', id: 'b6c', pos: sp(o, [54, 0, 0]), lit: true },
    { type: 'hint', key: 'burn', box: sx(o, [55, 0, -4, 57.4, 3.2, 4]) },
    ...doorway(o, 58, 0.5, 4),
    { type: 'wood', id: 'smokeWall', kind: 'plank', box: sx(o, [58.05, 0, -1.2, 58.45, 3, 1.2]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [63, 0, 3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [66, 0, -3.3]), scale: 0.9 },
  ];
}

/** The Lantern Duct: a pool too wide for a gauge of smoke, and a draught along the roof that a lantern switches on. */
function lanternDuct(o) {
  return [
    block(o, 'tile', 0, -1, -4, 10, 0, 4),
    { type: 'brazier', id: 'b7', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'draught', box: sx(o, [2.4, 0, -4, 5.4, 3, 4]) },
    { type: 'lantern', id: 'draughtLamp', pos: sp(o, [6.6, 0.95, 2.6]), emit: 'lamp1' },
    // the second lantern hangs over a ledge: a coal climbs it, smoke cannot light it
    block(o, 'cream', 2.2, 0, -4, 4.4, 1.3, -2.4),
    { type: 'lantern', id: 'draughtLamp2', pos: sp(o, [3.3, 2.3, -3.0]), mount: 'wall', emit: 'lamp2' },
    { type: 'prop', kind: 'pipe', pos: sp(o, [3, 0, -3.5]), rot: 0 },
    block(o, 'dark', 10, -1.2, -4, 44, -0.5, 4),
    { type: 'pool', id: 'ductPool', box: sx(o, [10, -0.5, -4, 44, -0.08, 4]), boil: 2 },
    block(o, 'dark', 8, 3, -4, 46, 3.4, 4),
    ...sealTop(o, 8, 46, 3.4),
    { type: 'fan', id: 'draughtFan', box: sx(o, [11, 1, -4, 43, 3, 4]), dir: '+x', strength: 6, on: 'draught' },
    block(o, 'tile', 44, -1, -4, 64, 0, 4),
    { type: 'brazier', id: 'b7b', pos: sp(o, [48, 0, 0]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [52, 0, 3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [56, 0, -3.3]), scale: 0.9 },
    { type: 'prop', kind: 'chimney', pos: sp(o, [60, 0, 3.4]) },
  ];
}

/** The Kiln Stack: a sealed tower. Up a hatch on an updraft, over a curtain of spray, a lantern that opens a roof hatch, a second climb, a flame for the sensor. */
function kilnStack(o) {
  return [
    block(o, 'tile', 0, -1, -4, 56, 0, 4),
    { type: 'brazier', id: 'b8', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'stack', box: sx(o, [2.4, 0, -4, 5.4, 3, 4]) },
    { type: 'prop', kind: 'chimney', pos: sp(o, [3.6, 0, -3.4]) },
    // the tower: walls too tall for a gauge of smoke to climb, with a doorway at the bottom for a coal
    block(o, 'dark', 5.6, 3.7, -4.5, 6, 30, 4.5),
    block(o, 'dark', 6, -1, -4.5, 56, 30, -4),
    block(o, 'dark', 6, -1, 4, 56, 30, 4.5),
    block(o, 'dark', 56, -1, -4.5, 56.5, 30, 4.5),
    { type: 'fan', id: 'updraft', box: sx(o, [10, 0, -1.5, 13, 7.4, 1.5]), dir: '+y', strength: 4 },
    // the first gallery floor, with a grate hatch over the updraft
    block(o, 'dark', 6, 7.4, -4, 10, 7.8, 4),
    block(o, 'dark', 10, 7.4, -4, 13, 7.8, -1.5),
    block(o, 'dark', 10, 7.4, 1.5, 13, 7.8, 4),
    { type: 'grate', id: 'stackHatch', box: sx(o, [10, 7.4, -1.5, 13, 7.8, 1.5]) },
    block(o, 'cream', 13, 7.4, -4, 56, 7.8, 4),
    // the first gallery: a roof with a shut hatch, a brazier, a curtain, a lantern
    block(o, 'dark', 6, 11.2, -4, 38, 11.6, 4),
    block(o, 'dark', 38, 11.2, -4, 41, 11.6, -1.5),
    block(o, 'dark', 38, 11.2, 1.5, 41, 11.6, 4),
    block(o, 'dark', 41, 11.2, -4, 56, 11.6, 4),
    { type: 'door', id: 'topHatch', box: sx(o, [38, 11.2, -1.5, 41, 11.6, 1.5]), on: 'lampTop', slide: '+x' },
    { type: 'hint', key: 'gallery', box: sx(o, [13, 7.8, -4, 17, 11, 4]) },
    { type: 'brazier', id: 'b9', pos: sp(o, [16, 7.8, 0]) },
    { type: 'sprinkler', id: 'sprayE', box: sx(o, [24, 7.8, -4, 27, 10, 4]) },
    { type: 'brazier', id: 'b9b', pos: sp(o, [30, 7.8, 0]) },
    { type: 'hint', key: 'topdoor', box: sx(o, [31, 7.8, -4, 37, 11, 4]) },
    { type: 'lantern', id: 'topLamp', pos: sp(o, [33.5, 8.75, 2.6]), emit: 'lampTop' },
    { type: 'prop', kind: 'lamp', pos: sp(o, [20, 7.8, 3.4]) },
    // the top gallery: its floor is the first gallery's roof. A brazier, the heat sensor, the kiln
    block(o, 'dark', 6, 15.2, -4, 56, 15.6, 4),
    { type: 'hint', key: 'sensor', box: sx(o, [42, 11.6, -4, 46, 15, 4]) },
    { type: 'brazier', id: 'b10', pos: sp(o, [45, 11.6, 0]) },
    { type: 'heatsensor', id: 'kilnSensor', box: sx(o, [47, 11.6, -1.5, 50, 14, 1.5]), emit: 'kilnHot' },
    { type: 'prop', kind: 'lamp', pos: sp(o, [43, 11.6, -3.4]) },
    { type: 'exit', pos: sp(o, [53.2, 11.6, 0]), face: '-x', on: 'kilnLit' },
  ];
}

export default {
  id: 'f07',
  element: 'fire',
  name: 'Chimney Sweep',
  chapter: 2,
  theme: 'flue',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember', 'blaze', 'smoke'],
  hints: {
    start: 'Smoke climbs to a roof and slides along it. {smoke} to rise; {ember} to drop back.',
    grate: 'Bars stop a coal but not smoke. {smoke} to slip through, then {ember} to land beyond.',
    crawl: 'Too wide for a coal or a flame. Smoke slides along the roof while its heat lasts: refuel, rise, mind the gauge.',
    spray: 'Spray from floor to three metres, a roof at four. Rise to the roof first, then slide: smoke goes over the spray.',
    hatch: 'A hole in the roof, and a glow-stone above it. Smoke rises through it; a coal can only drop back down.',
    house: 'The windows are high and grated. Smoke goes in; a lit brazier inside will warm you up again.',
    inside: 'Sealed in. {ember} to land, warm up at the brazier, and find the next window, or a wall wood can burn.',
    burn: 'Planks! {blaze} burns them. Heat comes from the brazier: smoke and blaze both spend it.',
    draught: 'More roof than a gauge of smoke can cross. Two lanterns start a draught that carries you. Smoke cannot light them.',
    stack: 'Up the stack. An updraft below the grate lifts smoke fast, but a flame cannot get through the bars.',
    topdoor: 'A hatch in the roof, shut. A lantern opens it, and a coal must light the lantern: smoke cannot.',
    gallery: 'The gallery roof is your road again. Spray ahead: slide over it, or burn through it if you have the heat.',
    sensor: 'The kiln door wakes to heat. A blaze in front of that sensor opens it for good. Smoke is not hot enough.',
  },
  areas: [
    { name: 'The Soot Hall', box: [-4, -4, 64, 4] },
    { name: 'The Sprinkler Run', box: [64, -4, 130, 4] },
    { name: 'The Smokehouse', box: [130, -4, 198, 4] },
    { name: 'The Lantern Duct', box: [198, -4, 262, 4] },
    { name: 'The Kiln Stack', box: [262, -4, 319, 4] },
  ],
  signals: {
    draught: { and: ['lamp1', 'lamp2'] },
    kilnLit: { latch: 'kilnHot' },
  },
  pieces: [
    ...sootHall(0),
    ...sprinklerRun(64),
    ...smokehouse(130),
    ...lanternDuct(198),
    ...kilnStack(262),
  ],
};
