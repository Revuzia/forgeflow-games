// Fire 6 - "Wax Resist". Chapter 2 (Flue): ice and wax, and the heat that melts them. A blaze
// melts only what it touches, and what it has melted stays melted: progress is kept when it
// steps away, so a hard job can be done in bites between a brazier and a lump of coal. Wax does
// not vanish: it sags, carrying down whatever stands on it. Five areas:
//   The Cold Store     an ice wall, a glow-stone frozen in a cube, and an ice wall too thick for one
//                      gauge: melt it in bites, with a lump of coal between.
//   The Candle Walk    a crate on a wax block over a heavy plate in a walled niche: warm the wax from
//                      the side, keep the flame off the crate, and the crate settles on the plate. A
//                      wax wall sags to a puddle you can step over.
//   The Chill Gallery  three ice walls, one gauge, two lumps of coal: spend the heat where it counts.
//                      A glow-stone frozen into a block above head height wants repeated jumps.
//   The Moulding Hall  two plates, two crates: one on an ice pillar, one on wax. Both must be down.
//   The Kiln Cellar    the great ice (seven seconds of flame), a frost corridor that turns a blaze
//                      back into an ember, and a heat sensor that wants a flame at the far end.
// Forms: ember and blaze. Layout runs along +X; see LEVELS.md section 10.
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
/**
 * A walled niche with a heavy plate in it, open only toward -x (where a block of wax or ice stands) and
 * from above. Nobody can walk in until the block has gone, so nothing can reach a crate that rests
 * over it. `x` is the niche's west edge; it is 2.7 m long.
 */
const niche = (o, x, id, emit) => [
  block(o, 'brick', x, 0, -1.4, x + 2.7, 3.2, -1.2),
  block(o, 'brick', x, 0, 1.2, x + 2.7, 3.2, 1.4),
  block(o, 'brick', x + 2.4, 0, -1.2, x + 2.7, 3.2, 1.2),
  { type: 'plate', id, pos: sp(o, [x + 1.2, 0, 0]), size: [2.4, 2.4], heavy: true, emit },
];

/** The Cold Store: an ice wall, a stone frozen in a cube, a wall too thick for one gauge. */
function coldStore(o) {
  return [
    block(o, 'tile', -4, -1, -4, 44, 0, 4),
    block(o, 'brick', -4.5, 0, -4, -4, 0.8, 4),
    { type: 'prop', kind: 'shelf', pos: sp(o, [1.5, 0, -3.5]), rot: 0 },
    { type: 'prop', kind: 'pots', pos: sp(o, [-1.8, 0, 3.0]), scale: 0.9 },
    { type: 'brazier', id: 'b1', pos: sp(o, [3, 0, 0]) },
    { type: 'hint', key: 'ice', box: sx(o, [4.4, 0, -4, 10.6, 3, 4]) },
    ...doorway(o, 12, 0.8),
    { type: 'iceblock', id: 'iceA', box: sx(o, [12.05, 0, -1.2, 12.75, 3, 1.2]), melt: 1.5 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [15, 0, 3.4]) },
    // glow-stone one, frozen into a cube: too far in to touch until the ice is gone
    { type: 'iceblock', id: 'cube', box: sx(o, [17, 0, -3.6, 18.4, 1.4, -2.2]), melt: 1.5 },
    { type: 'shard', pos: sp(o, [17.7, 0.7, -2.9]) },
    { type: 'brazier', id: 'b1b', pos: sp(o, [20, 0, 0]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [24, 0, -3.3]), scale: 0.9 },
    { type: 'hint', key: 'bite', box: sx(o, [28.6, 0, -4, 32.4, 3, 4]) },
    { type: 'coal', pos: sp(o, [30.6, 0.5, -2.4]) },
    ...doorway(o, 34, 0.8),
    { type: 'iceblock', id: 'iceB', box: sx(o, [34.05, 0, -1.2, 34.75, 3, 1.2]), melt: 6 },
    { type: 'prop', kind: 'shelf', pos: sp(o, [40, 0, 3.5]), rot: 0 },
  ];
}

/** The Candle Walk: a crate on wax over a plate; a wax wall that sags to a puddle. */
function candleWalk(o) {
  return [
    block(o, 'tile', 0, -1, -4, 44, 0, 4),
    { type: 'brazier', id: 'b2', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'wax', box: sx(o, [2.4, 0, -4, 6.4, 3, 4]) },
    { type: 'prop', kind: 'pipe', pos: sp(o, [4, 0, 3.5]), rot: 0 },
    // the wax block (taller than a flame can jump or flare) and a crate resting half over the niche
    { type: 'wax', id: 'waxA', box: sx(o, [10, 0, -1.2, 12.4, 3, 1.2]), melt: 3 },
    { type: 'wood', id: 'candle', kind: 'crate', pos: sp(o, [12.4, 3, 0]), size: 1.0 },
    // glow-stone two, set in a wax cube: it sags to a puddle and leaves the stone standing
    { type: 'wax', id: 'waxCube', box: sx(o, [15.6, 0, 2.6, 17, 1.4, 4]), melt: 2 },
    { type: 'shard', pos: sp(o, [16.3, 0.7, 3.3]) },
    ...niche(o, 12.4, 'plateA', 'pA'),
    ...doorway(o, 19, 0.4),
    { type: 'door', id: 'gateA', box: sx(o, [19.05, 0, -1.2, 19.45, 3, 1.2]), on: 'pAL' },
    { type: 'brazier', id: 'b3', pos: sp(o, [22, 0, 0]) },
    { type: 'hint', key: 'stub', box: sx(o, [24.6, 0, -4, 28, 3, 4]) },
    ...doorway(o, 30, 0.8),
    { type: 'wax', id: 'waxB', box: sx(o, [30.05, 0, -1.2, 30.75, 3, 1.2]), melt: 2.5 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [26, 0, 3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [35, 0, -3.3]), scale: 0.9 },
    { type: 'prop', kind: 'shelf', pos: sp(o, [39, 0, 3.5]), rot: 0 },
  ];
}

/** The Chill Gallery: three ice walls, one gauge, two lumps of coal; a stone frozen above head height. */
function chillGallery(o) {
  const out = [
    block(o, 'tile', 0, -1, -4, 46, 0, 4),
    { type: 'brazier', id: 'b4', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'chill', box: sx(o, [2.4, 0, -4, 6.4, 3, 4]) },
    { type: 'prop', kind: 'chimney', pos: sp(o, [5, 0, -3.4]) },
    { type: 'coal', pos: sp(o, [16.4, 0.5, 2.4]) },
    { type: 'coal', pos: sp(o, [26.4, 0.5, -2.4]) },
    { type: 'brazier', id: 'b5', pos: sp(o, [38, 0, 0]) },
    // glow-stone three: frozen into a block on a pillar, higher than a flame can stand
    { type: 'hint', key: 'high', box: sx(o, [39.4, 0, -4, 41.2, 3, 4]) },
    block(o, 'cream', 41.5, 0, -3.6, 42.9, 2.2, -2.4),
    { type: 'iceblock', id: 'iceTop', box: sx(o, [41.5, 2.2, -3.6, 42.9, 3.4, -2.4]), melt: 1.5 },
    { type: 'shard', pos: sp(o, [42.2, 2.8, -3.0]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [9, 0, 3.2]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [20, 0, -3.5]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [30, 0, 3.5]) },
  ];
  [12, 22, 32].forEach((x, i) => out.push(...doorway(o, x, 0.8), { type: 'iceblock', id: `iceC${i + 1}`, box: sx(o, [x + 0.05, 0, -1.2, x + 0.75, 3, 1.2]), melt: 1.5 }));
  return out;
}

/** The Moulding Hall: a crate on an ice pillar and a crate on wax, each over its own plate. */
function mouldingHall(o) {
  return [
    block(o, 'tile', 0, -1, -4, 46, 0, 4),
    { type: 'brazier', id: 'b6', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'mould', box: sx(o, [2.4, 0, -4, 6.4, 3, 4]) },
    { type: 'hint', key: 'pillar', box: sx(o, [6.4, 0, -4, 7.8, 3, 4]) },
    { type: 'iceblock', id: 'icePillar', box: sx(o, [8, 0, -1.2, 9.2, 4.2, 1.2]), melt: 1.5 },
    { type: 'wood', id: 'dropC', kind: 'crate', pos: sp(o, [9.2, 4.2, 0]), size: 1.0 },
    ...niche(o, 9.2, 'plateC', 'pC'),
    { type: 'coal', pos: sp(o, [14.6, 0.5, -2.4]) },
    { type: 'wax', id: 'waxC', box: sx(o, [20, 0, -1.2, 22.4, 3, 1.2]), melt: 3 },
    { type: 'wood', id: 'dropD', kind: 'crate', pos: sp(o, [22.4, 3, 0]), size: 1.0 },
    ...niche(o, 22.4, 'plateD', 'pD'),
    ...doorway(o, 29, 0.4),
    { type: 'door', id: 'gateM', box: sx(o, [29.05, 0, -1.2, 29.45, 3, 1.2]), on: 'moulded' },
    { type: 'brazier', id: 'b7', pos: sp(o, [33, 0, 0]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [14, 0, 3.3]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [17.5, 0, -3.5]) },
    { type: 'prop', kind: 'shelf', pos: sp(o, [37, 0, -3.5]), rot: 0 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [40, 0, 3.5]) },
  ];
}

/** The Kiln Cellar: the great ice, a frost corridor with a pool, and a heat sensor that opens the kiln. */
function kilnCellar(o) {
  return [
    block(o, 'tile', 0, -1, -4, 25.4, 0, 4),
    block(o, 'tile', 28.4, -1, -4, 52, 0, 4),
    { type: 'brazier', id: 'b8', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'great', box: sx(o, [2.4, 0, -4, 6, 3, 4]) },
    { type: 'coal', pos: sp(o, [11.8, 0.5, -2.4]) },
    { type: 'prop', kind: 'chimney', pos: sp(o, [11, 0, 3.4]) },
    ...doorway(o, 14, 2),
    { type: 'iceblock', id: 'iceG', box: sx(o, [14.05, 0, -1.2, 15.95, 3, 1.2]), melt: 7 },
    // beyond the ice: a corridor of frost (a blaze is turned back to an ember) with a pool to hop
    { type: 'hint', key: 'frost', box: sx(o, [17, 0, -4, 19.4, 3, 4]) },
    { type: 'frost', box: sx(o, [19.6, 0, -4, 36.6, 4, 4]) },
    block(o, 'dark', 25.4, -1.2, -4, 28.4, -0.6, 4),
    { type: 'pool', id: 'frostPool', box: sx(o, [25.4, -0.6, -4, 28.4, -0.1, 4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [21, 0, 3.2]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [22, 0, -3.5]) },
    { type: 'prop', kind: 'pipe', pos: sp(o, [32, 0, 3.5]), rot: 0 },
    { type: 'brazier', id: 'b9', pos: sp(o, [39, 0, 0]) },
    { type: 'hint', key: 'sensor', box: sx(o, [37.4, 0, -4, 41, 3, 4]) },
    { type: 'heatsensor', id: 'kilnSensor', box: sx(o, [42, 0, -1.5, 44.4, 2.4, 1.5]), emit: 'kilnHot' },
    { type: 'prop', kind: 'lamp', pos: sp(o, [45.5, 0, 3.5]) },
    block(o, 'brick', 52, 0, -4, 52.5, 3.6, 4),
    { type: 'exit', pos: sp(o, [49.8, 0, 0]), face: '-x', on: 'kilnLit' },
  ];
}

export default {
  id: 'f06',
  element: 'fire',
  name: 'Wax Resist',
  chapter: 2,
  theme: 'flue',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember', 'blaze'],
  hints: {
    start: 'Ice stops an ember cold. A blaze melts what it touches, and the heat it spends is the price.',
    ice: '{blaze} and stand against the ice: it melts while you touch it, and what is melted stays melted.',
    bite: 'Out of heat? Step away. Melting progress is kept: take coal or a brazier, then come back and finish it.',
    wax: 'Wax sags where a flame warms it and lowers whatever stands on it. Keep the flame off the crate.',
    stub: 'Wax sags to a low puddle, not to nothing. A puddle is easy to step over.',
    chill: 'Three walls of ice, and heat for one and a half. Look for coal, and spend your heat where it counts.',
    high: 'A glow-stone frozen in ice, above head height. A flame warms what it touches, even in mid-jump.',
    mould: 'Two plates, two crates. Both must come down: one rests on ice, one on wax.',
    pillar: 'An ice pillar holds the first crate. Melt its foot and the crate drops onto the plate.',
    great: 'The great ice wants seven seconds of flame, more than one gauge. Take coal, and melt it in bites.',
    frost: 'Frost turns a flame back into a coal. Cross as an ember; there is a brazier at the far end.',
    sensor: 'The kiln door answers to heat. Show the sensor a flame, and it opens for good.',
  },
  areas: [
    { name: 'The Cold Store', box: [-4, -4, 44, 4] },
    { name: 'The Candle Walk', box: [44, -4, 88, 4] },
    { name: 'The Chill Gallery', box: [88, -4, 134, 4] },
    { name: 'The Moulding Hall', box: [134, -4, 180, 4] },
    { name: 'The Kiln Cellar', box: [180, -4, 233, 4] },
  ],
  signals: {
    // each plate is remembered on its own: a crate that is burnt later can never undo the other
    pAL: { latch: 'pA' },
    moulded: { and: [{ latch: 'pC' }, { latch: 'pD' }] },
    kilnLit: { latch: 'kilnHot' },
  },
  pieces: [
    ...coldStore(0),
    ...candleWalk(44),
    ...chillGallery(88),
    ...mouldingHall(134),
    ...kilnCellar(180),
  ],
};
