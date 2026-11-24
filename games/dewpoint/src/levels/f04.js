// Fire 4 - "Night Watch". The exam that closes chapter 1 (Pilot Light). Three lanterns keep the
// kiln door shut and each one asks for something different, across five areas:
//   The Watch Hall      lantern one: an ember lights it and it opens a door; stepping stones over a pool.
//   Drip Gallery        a causeway under timed drips, then a ferry across black water.
//   The Two Wicks       lantern two sits behind a gate that wants TWO cords' flames at once: light
//                       the long cord first, hop out to the short one's island, and let them meet.
//   The Boiling House   a blaze boils a wide pool (sizzling through two drips), goes back to an ember
//                       to duck a low beam, then boils a pool AND burns the plank dam inside it.
//   Canal Side          running water cannot be boiled: jump and flare across. Lantern three hangs high
//                       above a stair of ledges: flare again. A glow-stone sits on a boarded shelf.
// Forms: ember and blaze. Layout runs along +X; see LEVELS.md section 10.
//
// Each area is built in its own coordinates (x = 0 at the area's start) by a small function and
// slid into place by `o`, so an area can be lengthened without touching the others.

const sx = (o, b) => b.map((v, i) => (i === 0 || i === 3 ? v + o : v));    // a box [x0 y0 z0 x1 y1 z1], slid by o
const sp = (o, p) => [p[0] + o, p[1], p[2]];                                // a point, slid by o
const block = (o, mat, ...b) => ({ type: 'block', box: sx(o, b), mat });

/** The Watch Hall: a brazier, the first lantern and its door, a ledge with a glow-stone, a pool of four stones. */
function watchHall(o) {
  return [
    block(o, 'tile', -4, -1, -4, 13, 0, 4),
    block(o, 'brick', -4.5, 0, -4, -4, 0.8, 4),
    { type: 'prop', kind: 'kiln', pos: sp(o, [10.4, 0, -2.9]), rot: 0 },
    { type: 'prop', kind: 'pipe', pos: sp(o, [6.5, 0, -3.5]), rot: 0 },
    { type: 'prop', kind: 'pots', pos: sp(o, [1.2, 0, 3.1]), scale: 0.9 },
    { type: 'brazier', id: 'b1', pos: sp(o, [3, 0, 0]) },
    { type: 'hint', key: 'lamp', box: sx(o, [5, 0, -4, 11, 3, 4]) },
    { type: 'lantern', id: 'lamp1', pos: sp(o, [9, 0.95, 2.6]), emit: 'L1' },
    block(o, 'brick', 13, 0, -4, 13.5, 3.6, -1.2),
    block(o, 'brick', 13, 0, 1.2, 13.5, 3.6, 4),
    block(o, 'brick', 13, 3, -1.2, 13.5, 3.6, 1.2),
    { type: 'door', id: 'doorA', box: sx(o, [13.05, 0, -1.2, 13.45, 3, 1.2]), on: 'L1' },
    block(o, 'tile', 13.5, -1, -4, 20, 0, 4),
    block(o, 'cream', 15, 0, -4, 17, 1.3, -1.9),
    { type: 'shard', pos: sp(o, [16, 2.0, -3.0]) },
    { type: 'fuse', id: 'cord0', path: [sp(o, [18.6, 0.06, 3.3]), sp(o, [46.4, 0.06, 3.3]), sp(o, [46.4, 0.06, 1.4])], rate: 3.4, emit: 'cord0' },
    { type: 'hint', key: 'cord', box: sx(o, [16.4, 0, -4, 19.9, 3, 4]) },
    block(o, 'dark', 20, -1.2, -4, 34, -0.6, 4),
    { type: 'pool', id: 'pool1', box: sx(o, [20, -0.6, -4, 34, -0.1, 4]) },
    // three stones, each 2.4 m long and 3 m wide with 1.7 m between them (a gap under 1.6 m can be walked across); the middle one is 1.5 m to the side of the others (a keyboard has
    // eight directions: a straight run and jump from anywhere on a stone lands on the next)
    block(o, 'cream', 21.7, -1, -2.25, 24.1, 0, 0.75),
    block(o, 'cream', 25.8, -1, -0.75, 28.2, 0, 2.25),
    block(o, 'cream', 29.9, -1, -2.25, 32.3, 0, 0.75),
    block(o, 'tile', 34, -1, -4, 52, 0, 4),
    { type: 'prop', kind: 'pots', pos: sp(o, [34, 0, -3.3]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [38.4, 0, -3.5]) },
    block(o, 'brick', 47, 0, -4, 47.5, 3.6, -1.2),
    block(o, 'brick', 47, 0, 1.2, 47.5, 3.6, 4),
    block(o, 'brick', 47, 3, -1.2, 47.5, 3.6, 1.2),
    { type: 'door', id: 'doorB', box: sx(o, [47.05, 0, -1.2, 47.45, 3, 1.2]), on: 'cord0' },
  ];
}

/** Drip Gallery: a causeway under four pipes, an island with a brazier, a ferry across a moat. */
function dripGallery(o) {
  return [
    block(o, 'tile', 0, -1, -4, 4, 0, 4),
    { type: 'brazier', id: 'b2', pos: sp(o, [1.5, 0, 0]) },
    block(o, 'dark', 4, -1.2, -4, 16, -0.6, 4),
    block(o, 'cream', 4, -1, -0.75, 16, 0, 0.75),
    { type: 'pool', id: 'tankN', box: sx(o, [4, -0.6, 0.75, 16, -0.1, 4]) },
    { type: 'pool', id: 'tankS', box: sx(o, [4, -0.6, -4, 16, -0.1, -0.75]) },
    { type: 'drip', id: 'd1', pos: sp(o, [6.5, 3, 0]), period: 1.7, offset: 0 },
    { type: 'drip', id: 'd2', pos: sp(o, [9, 3, 0]), period: 1.7, offset: 0.57 },
    { type: 'drip', id: 'd3', pos: sp(o, [11.5, 3, 0]), period: 1.7, offset: 1.14 },
    { type: 'drip', id: 'd4', pos: sp(o, [14, 3, 0]), period: 1.7, offset: 0.3 },
    block(o, 'tile', 16, -1, -4, 19, 0, 4),
    { type: 'brazier', id: 'b3', pos: sp(o, [17.5, 0, 0]) },
    { type: 'hint', key: 'ferry', box: sx(o, [16.6, 0, -4, 19, 3, 4]) },
    block(o, 'dark', 19, -1.2, -4, 29, -0.6, 4),
    { type: 'pool', id: 'moat', box: sx(o, [19, -0.6, -4, 29, -0.1, 4]) },
    { type: 'mover', id: 'ferry', box: sx(o, [19, -0.4, -1.5, 22, 0, 1.5]), to: [7, 0, 0], speed: 2.2, pause: 1.2, mat: 'metal' },
    block(o, 'tile', 29, -1, -4, 32, 0, 4),
    { type: 'brazier', id: 'b3b', pos: sp(o, [30.5, 0, 0]) },
    block(o, 'dark', 32, -1.2, -4, 42, -0.6, 4),
    { type: 'pool', id: 'moat2', box: sx(o, [32, -0.6, -4, 42, -0.1, 4]) },
    { type: 'mover', id: 'ferry2', box: sx(o, [32, -0.4, -1.5, 35, 0, 1.5]), to: [7, 0, 0], speed: 2.2, pause: 1.2, mat: 'metal' },
    { type: 'prop', kind: 'pipe', pos: sp(o, [3, 0, 3.5]), rot: 0 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [2.5, 0, -3.5]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [30.4, 0, 3.0]), scale: 0.9 },
  ];
}

/** The Two Wicks: a long cord, a short cord on an island, a gate that wants both flames; lantern two behind it. */
function twoWicks(o) {
  return [
    block(o, 'tile', 0, -1, -0.9, 26, 0, 4),
    block(o, 'tile', 0, -1, -4, 11.4, 0, -0.9),
    block(o, 'tile', 15.6, -1, -4, 26, 0, -0.9),
    { type: 'brazier', id: 'b4', pos: sp(o, [1.6, 0, 0]) },
    { type: 'hint', key: 'wicks', box: sx(o, [2.2, 0, -4, 6.6, 3, 4]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [7.4, 0, 3.5]) },
    // glow-stone two: two ledges up the south wall
    block(o, 'cream', 3.1, 0, -4, 5.1, 1.1, -2.4),
    block(o, 'cream', 5.1, 0, -4, 7.1, 2.2, -2.4),
    { type: 'shard', pos: sp(o, [6.1, 2.9, -3.2]) },
    // the short cord's island, in a bay of black water
    block(o, 'dark', 11.4, -1.2, -4, 15.6, -0.6, -0.9),
    { type: 'pool', id: 'bay', box: sx(o, [11.4, -0.6, -4, 15.6, -0.1, -0.9]) },
    block(o, 'cream', 12.5, -1, -3.9, 14.5, 0, -2.6),
    // the long cord (8.5 s) along the north wall; the short cord (3 s) from the island along the south
    { type: 'fuse', id: 'wickA', path: [sp(o, [4, 0.06, 3.2]), sp(o, [19.4, 0.06, 3.2]), sp(o, [19.4, 0.06, 1.6])], rate: 2.0, regrow: 2.6, emit: 'wickA' },
    { type: 'fuse', id: 'wickB', path: [sp(o, [13.5, 0.06, -3.2]), sp(o, [19.4, 0.06, -3.2]), sp(o, [19.4, 0.06, -1.6])], rate: 2.4, regrow: 2.6, emit: 'wickB' },
    block(o, 'brick', 21, 0, -4, 21.5, 3.6, -1.2),
    block(o, 'brick', 21, 0, 1.2, 21.5, 3.6, 4),
    block(o, 'brick', 21, 3, -1.2, 21.5, 3.6, 1.2),
    { type: 'door', id: 'gate', box: sx(o, [21.05, 0, -1.2, 21.45, 3, 1.2]), on: 'gate' },
    { type: 'lantern', id: 'lamp2', pos: sp(o, [24.2, 0.95, 2.8]), emit: 'L2' },
    { type: 'prop', kind: 'pots', pos: sp(o, [23.6, 0, -3.2]), scale: 0.9 },
  ];
}

/** The Boiling House: a wide pool under two drips, a low beam, a pool with a plank dam inside it. */
function boilingHouse(o) {
  return [
    block(o, 'tile', 0, -1, -4, 5, 0, 4),
    { type: 'brazier', id: 'b5', pos: sp(o, [1, 0, -0.5]) },
    { type: 'hint', key: 'boil', box: sx(o, [0, 0, -4, 4.6, 3, 4]) },
    block(o, 'dark', 5, -1.3, -4, 13, -0.5, 4),
    { type: 'pool', id: 'pool2', box: sx(o, [5, -0.5, -4, 13, -0.08, 4]), boil: 3.4 },
    { type: 'drip', id: 'd5', pos: sp(o, [7.5, 3.2, 0]), period: 1.9, offset: 0.4 },
    { type: 'drip', id: 'd6', pos: sp(o, [10.2, 3.2, 0]), period: 1.9, offset: 1.2 },
    block(o, 'tile', 13, -1, -4, 29, 0, 4),
    block(o, 'tile', 38, -1, -4, 42, 0, 4),
    { type: 'brazier', id: 'b6', pos: sp(o, [15, 0, 0]) },
    { type: 'hint', key: 'beam', box: sx(o, [16.2, 0, -4, 18.8, 3, 4]) },
    block(o, 'brick', 19, 0.8, -4, 21, 3.6, 4),
    { type: 'prop', kind: 'shelf', pos: sp(o, [22.6, 0, 3.4]), rot: 0 },
    { type: 'brazier', id: 'b7', pos: sp(o, [24, 0, 0]) },
    { type: 'hint', key: 'dam', box: sx(o, [24.8, 0, -4, 28.4, 3, 4]) },
    block(o, 'dark', 29, -1.3, -4, 38, -0.5, 4),
    { type: 'pool', id: 'pool3', box: sx(o, [29, -0.5, -4, 38, -0.08, 4]), boil: 4.6 },
    { type: 'wood', id: 'dam', kind: 'plank', box: sx(o, [33, -0.5, -4, 33.4, 2.8, 4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [17, 0, -3.3]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [40, 0, 3.5]) },
  ];
}

/** Canal Side: running water, a stair of ledges, a hanging lantern, a boarded shelf, the kiln door. */
function canalSide(o) {
  return [
    block(o, 'tile', 0, -1, -4, 6, 0, 4),
    { type: 'brazier', id: 'b8', pos: sp(o, [1.5, 0, 0]) },
    { type: 'coal', pos: sp(o, [3.2, 0.5, 2.8]) },
    { type: 'hint', key: 'canal', box: sx(o, [2.2, 0, -4, 5.8, 3, 4]) },
    block(o, 'dark', 6, -1.6, -4, 12, -0.9, 4),
    { type: 'current', id: 'canal', box: sx(o, [6, -0.9, -4, 12, -0.1, 4]), flow: [0, 1.4] },
    { type: 'prop', kind: 'pipe', pos: sp(o, [3.2, 0, -3.5]), rot: 0 },
    block(o, 'tile', 12, -1, -4, 34, 0, 4),
    { type: 'brazier', id: 'b9', pos: sp(o, [14.5, 0, 0]) },
    { type: 'hint', key: 'high', box: sx(o, [15.6, 0, -4, 18.6, 3, 4]) },
    block(o, 'cream', 19, 0, -4, 22, 1.3, 4),
    block(o, 'cream', 22, 0, -4, 25, 2.6, 4),
    { type: 'coal', pos: sp(o, [22.8, 3.1, 2.9]) },
    { type: 'lantern', id: 'lamp3', pos: sp(o, [23.6, 5.9, 0]), r: 1.0, mount: 'hang', emit: 'L3' },
    { type: 'hint', key: 'shelf', box: sx(o, [22.2, 2.6, -4, 25, 6, 4]) },
    block(o, 'cream', 26.5, 0, -4, 30, 4.6, -1.5),
    { type: 'wood', id: 'boards', kind: 'block', box: sx(o, [28.4, 4.6, -3.9, 28.8, 6.8, -1.6]) },
    { type: 'shard', pos: sp(o, [29.4, 5.3, -2.7]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [17.4, 0, -3.5]) },
    block(o, 'brick', 33, 0, -4, 33.5, 3.6, 4),
    { type: 'exit', pos: sp(o, [30.8, 0, 1.2]), face: '-x', on: { and: ['L1', 'L2', 'L3'] } },
  ];
}

export default {
  id: 'f04',
  element: 'fire',
  name: 'Night Watch',
  chapter: 1,
  theme: 'pilot',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember', 'blaze'],
  hints: {
    start: 'Three lanterns keep the kiln door shut. Light every one of them, with everything the pilot light has taught you.',
    lamp: 'A cold lantern. Brush against it and it burns for good. This one is wired to the door ahead.',
    cord: 'A cord is strung across the water to that door. Light it, then hop the stones: the flame runs while you do.',
    ferry: 'The ferry shuttles to and fro. Step on when it touches this bank, and off when it touches the far one.',
    wicks: 'The gate wants both flames at once. The long cord is slow, the short one quick: let them meet at the gate.',
    boil: '{blaze} to boil the pool away for a few seconds and wade over. A drip costs a blaze a little heat.',
    beam: 'Too low for a flame. {ember} to settle into a coal and duck under the beam.',
    dam: 'A plank dam stands in the pool. Boil the water, burn the dam, and be across before the water returns.',
    canal: 'Running water cannot be boiled. Jump, then {flare} at the top of the arc to carry across.',
    high: 'That lantern hangs far above. Climb the ledges, jump, then {flare} in mid-air to reach it.',
    shelf: 'A glow-stone behind boards, on a shelf too high to jump. Jump, flare, then burn your way in.',
  },
  areas: [
    { name: 'The Watch Hall', box: [-4, -4, 52, 4] },
    { name: 'Drip Gallery', box: [52, -4, 94, 4] },
    { name: 'The Two Wicks', box: [94, -4, 120, 4] },
    { name: 'The Boiling House', box: [120, -4, 162, 4] },
    { name: 'Canal Side', box: [162, -4, 197, 4] },
  ],
  signals: {
    // the gate stays up for two seconds after the two flames have met
    gate: { hold: { and: ['wickA', 'wickB'] }, for: 2 },
  },
  pieces: [
    ...watchHall(0),
    ...dripGallery(52),
    ...twoWicks(94),
    ...boilingHouse(120),
    ...canalSide(162),
  ],
};
