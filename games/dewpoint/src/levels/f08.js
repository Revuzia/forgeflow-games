// Fire 8 - "The Great Flue". The exam that closes chapter 2 (Flue). Everything the flue taught, in
// five rooms where each form has to be the right one at the right moment, and where the draught
// itself is the enemy of one of them:
//   The Draught Hall    a head wind blows down the hall: it drives a blaze back, an ember can still
//                       push through, smoke is pinned. The plank wall in the middle of the wind
//                       cannot be burnt by a blaze, so an ember lights a cord and the cord does it.
//   The Chandlery       a curtain of spray, then a block of wax with a crate on it over a plate. A
//                       blaze pays heat to cross the spray (or smoke goes over it) and to melt the wax.
//   The Valve Gallery   two flumes of running water under one roof, each with a head wind. A cord is
//                       the first valve: while it has burnt out the wind stops. Light it as an ember,
//                       rise as smoke, slide across in the calm. The second wind has no cord: a lantern
//                       an ember must light switches it off for good (smoke cannot light anything).
//   The Frost Gallery   a corridor of frost (a blaze becomes a coal inside it) with a heat sensor at
//                       the end of it. Boards laid from outside to the sensor carry the fire in, and a
//                       curtain of spray across the corridor has a cord for a valve.
//   The Kiln Gallery    the great wax wall (melt it in bites), a lantern hung out of reach of a jump
//                       (jump and flare), the sensor, a crate on wax over a plate, and one last head
//                       wind to push through as an ember. The kiln needs all three locks.
// Smoke is offered in every room but is only the answer in the valve gallery (the one roofed all the way);
// elsewhere a `cold` zone turns it back, so nothing can be flown over.
// Forms: ember, blaze and smoke. Layout runs along +X; see LEVELS.md section 10.
// Each area is built in its own coordinates (x = 0 at its start) by a function and slid into place by `o`.

const sx = (o, b) => b.map((v, i) => (i === 0 || i === 3 ? v + o : v));    // a box [x0 y0 z0 x1 y1 z1], slid by o
const sp = (o, p) => [p[0] + o, p[1], p[2]];                                // a point, slid by o
const block = (o, mat, ...b) => ({ type: 'block', box: sx(o, b), mat });
/** A doorway wall at x, thickness t, with a 2.4 m gap 3 m tall (the filling is left to the caller). */
const doorway = (o, x, t = 0.5) => [
  block(o, 'brick', x, 0, -4, x + t, 3.6, -1.2),
  block(o, 'brick', x, 0, 1.2, x + t, 3.6, 4),
  block(o, 'brick', x, 3, -1.2, x + t, 3.6, 1.2),
];
/** A walled niche with a heavy plate, open only toward -x and from above (see f06). `x` is its west edge. */
const niche = (o, x, id, emit) => [
  block(o, 'brick', x, 0, -1.4, x + 2.7, 3.2, -1.2),
  block(o, 'brick', x, 0, 1.2, x + 2.7, 3.2, 1.4),
  block(o, 'brick', x + 2.4, 0, -1.2, x + 2.7, 3.2, 1.2),
  { type: 'plate', id, pos: sp(o, [x + 1.2, 0, 0]), size: [2.4, 2.4], heavy: true, emit },
];

/** The Draught Hall: a head wind, a plank wall inside it, and a cord that burns the wall from afar. */
function draughtHall(o) {
  return [
    block(o, 'tile', -4, -1, -4, 46, 0, 4),
    block(o, 'brick', -4.5, 0, -4, -4, 0.8, 4),
    { type: 'prop', kind: 'chimney', pos: sp(o, [1, 0, -3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [-1.8, 0, 3.0]), scale: 0.9 },
    { type: 'brazier', id: 'b1', pos: sp(o, [3, 0, 0]) },
    { type: 'hint', key: 'draught', box: sx(o, [4.6, 0, -4, 7.8, 3, 4]) },
    // cold air all along the hall: smoke is not an option here (it would simply fly over the wall)
    { type: 'cold', box: sx(o, [-4, -20, -40, 46, 40, 40]) },
    { type: 'fan', id: 'headwind', box: sx(o, [8, 0, -4, 24, 3.2, 4]), dir: '-x', strength: 6 },
    { type: 'fuse', id: 'cord1', path: [sp(o, [9.2, 0.06, 3.2]), sp(o, [15.4, 0.06, 3.2]), sp(o, [15.4, 0.06, 1.4])], rate: 1.6, emit: 'cord1' },
    { type: 'shard', pos: sp(o, [12, 0.7, -3.0]) },
    { type: 'hint', key: 'wall', box: sx(o, [13.2, 0, -4, 15.8, 3, 4]) },
    ...doorway(o, 16, 0.5),
    { type: 'wood', id: 'draughtWall', kind: 'plank', box: sx(o, [16.05, 0, -1.2, 16.45, 3, 1.2]), on: 'cord1' },
    { type: 'brazier', id: 'b1b', pos: sp(o, [28, 0, 0]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [31, 0, 3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [35, 0, -3.3]), scale: 0.9 },
    { type: 'prop', kind: 'shelf', pos: sp(o, [41, 0, 3.5]), rot: 0 },
  ];
}

/** The Chandlery: a curtain of spray, then wax with a crate on it over a plate in a niche; a gate. */
function chandlery(o) {
  return [
    block(o, 'tile', 0, -1, -4, 50, 0, 4),
    { type: 'brazier', id: 'b2', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'curtain', box: sx(o, [2.4, 0, -4, 7, 3, 4]) },
    { type: 'prop', kind: 'pipe', pos: sp(o, [4, 0, -3.5]), rot: 0 },
    { type: 'sprinkler', id: 'sprayF', box: sx(o, [10, 0, -4, 14, 3.4, 4]) },
    { type: 'brazier', id: 'b2b', pos: sp(o, [16.5, 0, 0]) },
    // smoke may go over the curtain, but not past it: cold air from here on
    { type: 'cold', box: sx(o, [17.4, -20, -40, 50, 40, 40]) },
    // glow-stone two in a wax cube, just past the curtain
    { type: 'wax', id: 'waxCube2', box: sx(o, [18, 0, 2.6, 19.4, 1.4, 4]), melt: 2 },
    { type: 'shard', pos: sp(o, [18.7, 0.7, 3.3]) },
    { type: 'hint', key: 'chandler', box: sx(o, [18.6, 0, -2.2, 21, 3, 2.2]) },
    { type: 'wax', id: 'waxD', box: sx(o, [22, 0, -1.2, 24.4, 3, 1.2]), melt: 3 },
    { type: 'wood', id: 'dropE', kind: 'crate', pos: sp(o, [24.4, 3, 0]), size: 1.0 },
    ...niche(o, 24.4, 'plateE', 'pE'),
    ...doorway(o, 31, 0.4),
    { type: 'door', id: 'gateE', box: sx(o, [31.05, 0, -1.2, 31.45, 3, 1.2]), on: 'pEL' },
    { type: 'brazier', id: 'b2c', pos: sp(o, [35, 0, 0]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [40, 0, 3.4]) },
    // the last wall of the chandlery is ice: more heat than the brazier leaves you, so melt it in bites
    { type: 'hint', key: 'ice8', box: sx(o, [36.6, 0, -4, 41, 3, 4]) },
    { type: 'coal', pos: sp(o, [41.5, 0.5, -2.4]) },
    ...doorway(o, 44, 0.8),
    { type: 'iceblock', id: 'iceI', box: sx(o, [44.05, 0, -1.2, 44.75, 3, 1.2]), melt: 7 },
    { type: 'prop', kind: 'shelf', pos: sp(o, [47.6, 0, 3.5]), rot: 0 },
  ];
}

/** The Valve Gallery: two flumes under one roof, each with a head wind. A cord is the first valve; a lantern is the second. */
function valveGallery(o) {
  return [
    block(o, 'tile', 0, -1, -4, 12, 0, 4),
    { type: 'brazier', id: 'b3', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'valve', box: sx(o, [2.4, 0, -4, 5.4, 3, 4]) },
    // the valve: a short cord. While its flame has run out (emit) the wind is off, for a while
    { type: 'fuse', id: 'valve', path: [sp(o, [8, 0.06, 2.6]), sp(o, [10.4, 0.06, 2.6])], rate: 2.0, regrow: 8.5, emit: 'valve' },
    { type: 'prop', kind: 'pipe', pos: sp(o, [8, 0, -3.5]), rot: 0 },
    // flume one: sixteen metres, the wind stops while the cord is spent
    block(o, 'dark', 12, -1.6, -4, 28, -0.9, 4),
    { type: 'current', id: 'flume', box: sx(o, [12, -0.9, -4, 28, -0.1, 4]), flow: [0, 1.4] },
    { type: 'fan', id: 'flumeWind', box: sx(o, [12, 0.6, -4, 28, 3, 4]), dir: '-x', strength: 6, on: '!valve' },
    { type: 'shard', pos: sp(o, [20, 2.7, -3.2]) },
    // the island between them: a brazier, and the lantern that keeps the second wind off for good
    block(o, 'tile', 28, -1, -4, 36, 0, 4),
    { type: 'brazier', id: 'b4', pos: sp(o, [31, 0, 0]) },
    { type: 'hint', key: 'lamp2', box: sx(o, [31.6, 0, -4, 35, 3, 4]) },
    { type: 'lantern', id: 'calmLamp', pos: sp(o, [33.4, 0.95, 2.6]), emit: 'calm2' },
    { type: 'prop', kind: 'lamp', pos: sp(o, [29.6, 0, -3.4]) },
    // flume two: twenty metres; the wind blows until the lantern is lit
    block(o, 'dark', 36, -1.6, -4, 56, -0.9, 4),
    { type: 'current', id: 'flume2', box: sx(o, [36, -0.9, -4, 56, -0.1, 4]), flow: [0, 1.4] },
    { type: 'fan', id: 'flumeWind2', box: sx(o, [36, 0.6, -4, 56, 3, 4]), dir: '-x', strength: 6, on: '!calm2' },
    // one roof over the whole gallery, and walls too tall for a gauge of smoke to climb: nothing can be flown over or around
    block(o, 'dark', 0, 3, -4, 86, 3.4, 4),
    block(o, 'dark', 0, -1.6, -4.5, 86, 24, -4),
    block(o, 'dark', 0, -1.6, 4, 86, 24, 4.5),
    block(o, 'tile', 56, -1, -4, 86, 0, 4),
    { type: 'brazier', id: 'b4b', pos: sp(o, [60, 0, 0]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [64, 0, 3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [70, 0, -3.3]), scale: 0.9 },
    { type: 'prop', kind: 'chimney', pos: sp(o, [76, 0, 3.4]) },
    { type: 'prop', kind: 'shelf', pos: sp(o, [82, 0, -3.5]), rot: 0 },
  ];
}

/** The Frost Gallery: a frost corridor with a sensor at its end; boards from outside carry the fire in. */
function frostGallery(o) {
  const out = [
    block(o, 'tile', 0, -1, -4, 50, 0, 4),
    { type: 'brazier', id: 'b5', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'frost', box: sx(o, [2.4, 0, -4, 5.8, 3, 4]) },
    { type: 'cold', box: sx(o, [0, -20, -40, 50, 40, 40]) },
    { type: 'frost', box: sx(o, [10, 0, -4, 34, 4, 4]) },
    // a curtain of spray across the corridor, with a cord for its valve: an ember lights it from inside the frost and dashes through
    { type: 'fuse', id: 'valveF', path: [sp(o, [17.5, 0.06, 2.8]), sp(o, [18.9, 0.06, 2.8])], rate: 1.2, regrow: 4, emit: 'valveF' },
    { type: 'sprinkler', id: 'frostSpray', box: sx(o, [20.4, 0, -4, 23.4, 3.4, 4]), on: '!valveF' },
    { type: 'hint', key: 'frostValve', box: sx(o, [14.4, 0, -4, 17, 3, 4]) },
    { type: 'heatsensor', id: 'frostSensor', box: sx(o, [31, 0, -1.5, 34, 0.8, 1.5]), emit: 'hsF' },
    ...doorway(o, 35, 0.4),
    { type: 'door', id: 'gateF', box: sx(o, [35.05, 0, -1.2, 35.45, 3, 1.2]), on: 'hsFL' },
    { type: 'brazier', id: 'b6', pos: sp(o, [40, 0, 0]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [18, 0, -3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [24, 0, 3.2]), scale: 0.9 },
    { type: 'prop', kind: 'pipe', pos: sp(o, [28, 0, -3.5]), rot: 0 },
    { type: 'prop', kind: 'shelf', pos: sp(o, [45, 0, 3.5]), rot: 0 },
  ];
  // twenty-six metres of boards, from outside the frost (x 7) to the sensor
  const n = 33;
  for (let i = 0; i < n; i++) out.push({ type: 'wood', id: `row${i}`, kind: 'plank', box: sx(o, [7 + i * 0.8, 0, -0.5, 7.8 + i * 0.8, 0.2, 0.5]), burn: 0.55 });
  return out;
}

/** The Kiln Gallery: the great wax, a high lantern, the sensor, a crate on wax over a plate, and a last head wind. */
function kilnGallery(o) {
  return [
    block(o, 'tile', 0, -1, -4, 66, 0, 4),
    { type: 'cold', box: sx(o, [0, -20, -40, 66, 40, 40]) },
    { type: 'brazier', id: 'b7', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'great', box: sx(o, [2.4, 0, -4, 6, 3, 4]) },
    { type: 'coal', pos: sp(o, [9.4, 0.5, -2.4]) },
    ...doorway(o, 12, 1.6),
    { type: 'wax', id: 'waxG', box: sx(o, [12.05, 0, -1.2, 13.55, 3, 1.2]), melt: 6 },
    { type: 'brazier', id: 'b7b', pos: sp(o, [16, 0, 0]) },
    { type: 'hint', key: 'hang', box: sx(o, [18.6, 0, -4, 22.6, 3, 4]) },
    { type: 'lantern', id: 'hiLamp', pos: sp(o, [24, 3.7, 0]), r: 1.0, mount: 'hang', emit: 'hiLamp' },
    { type: 'brazier', id: 'b7c', pos: sp(o, [28, 0, 0]) },
    { type: 'hint', key: 'sensorK', box: sx(o, [30, 0, -4, 33, 3, 4]) },
    { type: 'heatsensor', id: 'kilnSensor2', box: sx(o, [34, 0, -1.5, 37, 2.4, 1.5]), emit: 'hsK' },
    // the third lock: a crate on wax over a plate in a niche
    { type: 'brazier', id: 'b7d', pos: sp(o, [39, 0, 0]) },
    { type: 'hint', key: 'weigh', box: sx(o, [37.6, 0, -4, 40.2, 3, 4]) },
    { type: 'wax', id: 'waxK', box: sx(o, [41, 0, -1.2, 43.4, 3, 1.2]), melt: 3 },
    { type: 'wood', id: 'dropK', kind: 'crate', pos: sp(o, [43.4, 3, 0]), size: 1.0 },
    ...niche(o, 43.4, 'plateK', 'pK'),
    { type: 'hint', key: 'last', box: sx(o, [47.4, 0, -4, 49.4, 3, 4]) },
    { type: 'fan', id: 'lastWind', box: sx(o, [50, 0, -4, 60, 3.2, 4]), dir: '-x', strength: 5 },
    { type: 'prop', kind: 'pots', pos: sp(o, [14, 0, 3.3]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [20, 0, -3.5]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [33, 0, 3.5]) },
    block(o, 'brick', 66, 0, -4, 66.5, 3.6, 4),
    { type: 'exit', pos: sp(o, [63.8, 0, 0]), face: '-x', on: 'kilnReady' },
  ];
}

export default {
  id: 'f08',
  element: 'fire',
  name: 'The Great Flue',
  chapter: 2,
  theme: 'flue',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember', 'blaze', 'smoke'],
  hints: {
    start: 'The great flue draws everything up. Use the right form in each room, and mind the draught.',
    draught: 'Cold air and a head wind. A blaze is driven back; smoke cannot rise here at all. A coal can push through.',
    wall: 'Planks in the wind: a blaze cannot stand here to burn them. A cord can do it for you.',
    curtain: 'Spray ahead. A blaze pays for crossing it in heat; smoke can rise over it, high enough, and a coal is put out.',
    ice8: 'Ice again, more than one gauge can melt. Coal is close: melt, refuel, finish. Melted ice stays melted.',
    chandler: 'Wax over a plate again, with a crate on top. Warm it from the side, and keep the flame off the crate.',
    valve: 'The wind along the flume stops while that cord has burnt out. Light it as a coal, rise as smoke, and slide across.',
    lamp2: 'Another flume, another wind. This one has no cord: a lantern lit by a coal switches it off for good. Smoke cannot.',
    frost: 'Frost turns a flame back to a coal. The sensor is inside it: boards from outside can carry the fire in.',
    frostValve: 'Spray across the frost. Its valve is a cord: light it as a coal, and the spray stops for a few seconds.',
    great: 'The great wax wants six seconds of flame: more than a gauge. Take the coal, and melt it in bites.',
    hang: 'The lantern hangs out of reach of a jump. Jump, then {flare} at the top of the arc.',
    sensorK: 'The kiln opens when the lantern burns, the sensor has seen a flame, and the crate is down. Each is kept.',
    weigh: 'A third lock: a crate on wax over a plate. Warm the wax from the side, and keep the flame off the crate.',
    last: 'One more head wind before the kiln. A flame cannot walk into it: {ember} to push through.',
  },
  areas: [
    { name: 'The Draught Hall', box: [-4, -4, 46, 4] },
    { name: 'The Chandlery', box: [46, -4, 96, 4] },
    { name: 'The Valve Gallery', box: [96, -4, 182, 4] },
    { name: 'The Frost Gallery', box: [182, -4, 232, 4] },
    { name: 'The Kiln Gallery', box: [232, -4, 298, 4] },
  ],
  signals: {
    pEL: { latch: 'pE' },
    hsFL: { latch: 'hsF' },
    pKL: { latch: 'pK' },
    kilnReady: { and: [{ latch: 'hiLamp' }, { latch: 'hsK' }, 'pKL'] },
  },
  pieces: [
    ...draughtHall(0),
    ...chandlery(46),
    ...valveGallery(96),
    ...frostGallery(182),
    ...kilnGallery(232),
  ],
};
