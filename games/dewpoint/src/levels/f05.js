// Fire 5 - "Tinderbox". Chapter 2 (Flue) begins: wood, and a fire that spreads. A blaze burns what
// it touches, and anything that touches burning wood catches too. Five areas, each a different
// way of using (or being caught out by) that one rule:
//   The Wood Store    an ember lights a cord and the cord burns a plank wall from afar; a stack of
//                     crates is a wall a blaze lights once and the whole stack follows.
//   The Plank Walk    a plank bridge over a wide pool, with a plank wall touching its far end:
//                     light the wall and the fire runs back and burns the bridge behind you. A
//                     glow-stone sits on an island off the bridge: take it first, or boil the pool.
//   The Flue Mouth    a tunnel too low for a flame, a heat sensor at its far end, and a chain of
//                     boards between: the fire you start at the mouth carries itself to the sensor
//                     (and to the boards that wall off a glow-stone) while an ember follows it in.
//   The Cooperage     plank wall, low beam (back to an ember), and a crate on a wooden pillar: burn
//                     the pillar and the crate drops onto the heavy plate that opens the gate. Then a
//                     slalom: a cord lit by an ember burns the crates a beam keeps a blaze away from.
//   The Long Fuse     a pool with a dam in it (boil, burn, cross), then a long line of boards that is a fuse to the rope that
//                     holds the kiln door shut: light it and race the flame.
// Forms: ember and blaze. Layout runs along +X; see LEVELS.md section 10.
// Each area is built in its own coordinates (x = 0 at its start) by a function and slid into place by `o`.

const sx = (o, b) => b.map((v, i) => (i === 0 || i === 3 ? v + o : v));    // a box [x0 y0 z0 x1 y1 z1], slid by o
const sp = (o, p) => [p[0] + o, p[1], p[2]];                                // a point, slid by o
const block = (o, mat, ...b) => ({ type: 'block', box: sx(o, b), mat });
/** A doorway wall at x with a 2.4 m gap, 3.6 m tall: posts and a lintel (the gap itself is left to the caller). */
const doorway = (o, x, t = 0.5) => [
  block(o, 'brick', x, 0, -4, x + t, 3.6, -1.2),
  block(o, 'brick', x, 0, 1.2, x + t, 3.6, 4),
  block(o, 'brick', x, 3, -1.2, x + t, 3.6, 1.2),
];
/** A row of touching planks along +x (each `len` long, `w` wide, `h` tall), from x0 to x1, centred on z. */
function boards(o, idp, x0, x1, z, w, h, burn, len = 0.8, y = 0, emit) {
  const out = [], n = Math.round((x1 - x0) / len);
  for (let i = 0; i < n; i++) {
    const p = { type: 'wood', id: `${idp}${i}`, kind: 'plank', box: sx(o, [x0 + i * len, y, z - w / 2, x0 + (i + 1) * len, y + h, z + w / 2]), burn };
    if (emit && i === n - 1) p.emit = emit;
    out.push(p);
  }
  return out;
}

/** The Wood Store: a cord burns a far plank wall while a blaze burns a stack of crates. */
function woodStore(o) {
  const out = [
    block(o, 'tile', -4, -1, -4, 22, 0, 4),
    block(o, 'tile', 34, -1, -4, 44, 0, 4),
    block(o, 'brick', -4.5, 0, -4, -4, 0.8, 4),
    { type: 'prop', kind: 'shelf', pos: sp(o, [1.5, 0, -3.5]), rot: 0 },
    { type: 'prop', kind: 'pots', pos: sp(o, [-1.8, 0, 3.0]), scale: 0.9 },
    { type: 'brazier', id: 'b1', pos: sp(o, [3, 0, 0]) },
    // a cord strung down the whole hall to a plank wall: an ember lights it, the flame runs, the planks catch
    { type: 'hint', key: 'cord', box: sx(o, [3.4, 0, -4, 6.6, 3, 4]) },
    { type: 'fuse', id: 'cord0', path: [sp(o, [4.2, 0.06, 3.0]), sp(o, [37.6, 0.06, 3.0]), sp(o, [37.6, 0.06, 1.4])], rate: 4.2, emit: 'cord0' },
    // glow-stone one: a ledge by the start
    block(o, 'cream', 8, 0, -4, 10, 1.3, -2.4),
    { type: 'shard', pos: sp(o, [9, 2.0, -3.2]) },
    { type: 'brazier', id: 'b1b', pos: sp(o, [11, 0, 0]) },
    { type: 'hint', key: 'stack', box: sx(o, [11.6, 0, -4, 13.6, 3, 4]) },
    // the stack: six crates, two wide and three high, filling a doorway
    block(o, 'brick', 13.9, 0, -4, 14.7, 4.2, -1.2),
    block(o, 'brick', 13.9, 0, 1.2, 14.7, 4.2, 4),
    block(o, 'brick', 13.9, 3.6, -1.2, 14.7, 4.2, 1.2),
    { type: 'coal', pos: sp(o, [18, 0.5, -2.6]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [20.6, 0, -3.3]), scale: 0.9 },
    // wooden stepping stones in a pool: an ember hops them; a blaze burns what it stands on
    { type: 'hint', key: 'stones', box: sx(o, [18.4, 0, -4, 21.8, 3, 4]) },
    block(o, 'dark', 22, -1.3, -4, 34, -0.5, 4),
    { type: 'pool', id: 'woodPool', box: sx(o, [22, -0.5, -4, 34, -0.08, 4]), boil: 4.4 },
    ...doorway(o, 38),
    { type: 'wood', id: 'wall0', kind: 'plank', box: sx(o, [38.05, 0, -1.2, 38.45, 3, 1.2]), on: 'cord0' },
    { type: 'prop', kind: 'lamp', pos: sp(o, [35.4, 0, 3.4]) },
    { type: 'prop', kind: 'shelf', pos: sp(o, [41.2, 0, -3.5]), rot: 0 },
  ];
  // three rafts of crates, each 2.6 m long and 3 m wide with 1.05 m between them, the middle one 1.5 m to the side of the others
  [[24.35, -0.75], [28.0, 0.75], [31.65, -0.75]].forEach(([x, z], i) => out.push({ type: 'wood', id: `stone${i}`, kind: 'crate', pos: sp(o, [x, -0.5, z]), size: [2.6, 1.2, 3.0] }));
  for (let k = 0; k < 3; k++) for (const z of [-0.6, 0.6]) out.push({ type: 'wood', id: `crate${k}${z > 0 ? 'n' : 's'}`, kind: 'crate', pos: sp(o, [14.3, 1.2 * k, z]), size: [0.6, 1.2, 1.2] });
  return out;
}

/** The Plank Walk: a bridge of planks, a plank wall touching its end, a stone on an island. */
function plankWalk(o) {
  const out = [
    block(o, 'tile', 0, -1, -4, 6, 0, 4),
    { type: 'brazier', id: 'b2', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'walk', box: sx(o, [2.2, 0, -4, 5.8, 3, 4]) },
    { type: 'prop', kind: 'pipe', pos: sp(o, [3, 0, -3.5]), rot: 0 },
    block(o, 'dark', 6, -1.3, -4, 19, -0.5, 4),
    { type: 'pool', id: 'moat', box: sx(o, [6, -0.5, -4, 19, -0.08, 4]), boil: 6 },
    // the island with glow-stone two, a hop off the bridge
    block(o, 'cream', 11, -1, -3.3, 12.6, 0, -1.9),
    { type: 'shard', pos: sp(o, [11.8, 0.8, -2.6]) },
    // the sunk landing: two more boards on stone, then the wall that touches them
    block(o, 'dark', 19, -1, -4, 21.4, -0.2, 4),
    { type: 'hint', key: 'wall', box: sx(o, [17.6, 0, -4, 20.6, 3, 4]) },
    ...doorway(o, 21, 0.4),
    { type: 'wood', id: 'wall', kind: 'plank', box: sx(o, [21, 0, -1.2, 21.4, 3, 1.2]) },
    { type: 'brazier', id: 'b2b', pos: sp(o, [20.2, -0.2, 0]) },
    // beyond the wall a plank walkway over a second pit: the wall touches it, so the fire follows you
    { type: 'hint', key: 'race', box: sx(o, [21.6, 0, -4, 24, 3, 4]) },
    block(o, 'dark', 21.4, -1.3, -4, 31.4, -0.5, 4),
    { type: 'pool', id: 'pit', box: sx(o, [21.4, -0.5, -4, 31.4, -0.08, 4]), boil: 4.4 },
    block(o, 'tile', 31.4, -1, -4, 46, 0, 4),
    { type: 'brazier', id: 'b3', pos: sp(o, [34, 0, 0]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [37, 0, 3.2]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [40, 0, -3.5]) },
    { type: 'prop', kind: 'shelf', pos: sp(o, [43, 0, 3.5]), rot: 0 },
  ];
  out.push({ type: 'drip', id: 'dw1', pos: sp(o, [9, 3.2, 0]), period: 1.8, offset: 0 });
  out.push({ type: 'drip', id: 'dw2', pos: sp(o, [13.5, 3.2, 0]), period: 1.8, offset: 0.6 });
  out.push({ type: 'drip', id: 'dw3', pos: sp(o, [17, 3.2, 0]), period: 1.8, offset: 1.2 });
  // thirteen planks of the bridge, two of the landing, ten of the walkway (all burn 1 s, all touch)
  for (let i = 0; i < 15; i++) out.push({ type: 'wood', id: `deck${i}`, kind: 'plank', box: sx(o, [6 + i, -0.2, -0.9, 7 + i, 0, 0.9]) });
  for (let i = 0; i < 10; i++) out.push({ type: 'wood', id: `way${i}`, kind: 'plank', box: sx(o, [21.4 + i, -0.2, -0.9, 22.4 + i, 0, 0.9]) });
  return out;
}

/** The Flue Mouth: a tunnel only an ember fits, a chain of boards that carries the fire in, a heat sensor. */
function flueMouth(o) {
  return [
    block(o, 'tile', 0, -1, -4, 40, 0, 4),
    { type: 'brazier', id: 'b4', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'flue', box: sx(o, [2.6, 0, -4, 7, 3, 4]) },
    { type: 'prop', kind: 'chimney', pos: sp(o, [4, 0, -3.4]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [3.4, 0, 3.2]), scale: 0.9 },
    // the tunnel: a low roof, 0.8 m clear
    block(o, 'brick', 8, 0.8, -3.6, 23.4, 3.6, 1.6),
    block(o, 'dark', 8, 0, 1.6, 23.4, 3.6, 4),          // solid wall either side, so the mouth reads as a hole in a wall
    block(o, 'dark', 8, 0, -4, 23.4, 3.6, -3.6),
    // the chain of boards on its floor, and a branch to the walled-off nook
    ...boards(o, 'chain', 8, 23.2, 0, 1.0, 0.2, 0.55),
    { type: 'wood', id: 'branch', kind: 'plank', box: sx(o, [13.6, 0, -1.8, 14.4, 0.2, -0.5]), burn: 0.55 },
    { type: 'hint', key: 'nook', box: sx(o, [11.6, 0, -4, 15.6, 0.8, 0]) },
    block(o, 'cream', 12.8, 0, -3.9, 13, 0.8, -1.9),
    block(o, 'cream', 15, 0, -3.9, 15.2, 0.8, -1.9),
    block(o, 'cream', 12.8, 0, -3.9, 15.2, 0.8, -3.7),
    { type: 'wood', id: 'nookWall', kind: 'block', box: sx(o, [13, 0, -2.0, 15, 0.75, -1.8]), burn: 0.6 },
    { type: 'shard', pos: sp(o, [14, 0.4, -2.9]) },
    { type: 'heatsensor', id: 'hs', box: sx(o, [21.8, 0, -1.5, 23.4, 0.8, 1.5]), emit: 'hs' },
    ...doorway(o, 25),
    { type: 'door', id: 'flueGate', box: sx(o, [25.05, 0, -1.2, 25.45, 3, 1.2]), on: 'hsL' },
    { type: 'brazier', id: 'b5', pos: sp(o, [28, 0, 0]) },
    { type: 'prop', kind: 'lamp', pos: sp(o, [31, 0, 3.5]) },
    { type: 'prop', kind: 'shelf', pos: sp(o, [35, 0, -3.5]), rot: 0 },
  ];
}

/** The Cooperage: a plank wall (blaze), a low beam (ember), a crate on a pillar over a heavy plate. */
function cooperage(o) {
  return [
    block(o, 'tile', 0, -1, -4, 64, 0, 4),
    { type: 'brazier', id: 'b6', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'coop', box: sx(o, [2.4, 0, -4, 5.4, 3, 4]) },
    ...doorway(o, 6, 0.4),
    { type: 'wood', id: 'wall1', kind: 'plank', box: sx(o, [6.05, 0, -1.2, 6.35, 3, 1.2]) },
    block(o, 'brick', 9, 0.8, -4, 13, 3.6, 4),
    { type: 'prop', kind: 'shelf', pos: sp(o, [7.6, 0, 3.4]), rot: 0 },
    { type: 'brazier', id: 'b7', pos: sp(o, [15, 0, 0]) },
    { type: 'hint', key: 'pillar', box: sx(o, [15.6, 0, -4, 17.6, 3, 4]) },
    // a crate on a wooden pillar, half over a heavy plate
    { type: 'wood', id: 'pillar', kind: 'block', box: sx(o, [18, 0, -0.6, 19.2, 4.2, 0.6]), burn: 0.8 },
    { type: 'wood', id: 'dropA', kind: 'crate', pos: sp(o, [19.2, 4.2, 0]), size: 1.0, spread: false },
    { type: 'plate', id: 'weight', pos: sp(o, [20.4, 0, 0]), size: [2.4, 2.4], heavy: true, emit: 'weight' },
    // a second wall, with a second pillar and crate standing right behind it: lighting the wall lights the pillar
    { type: 'hint', key: 'wall2', box: sx(o, [21.8, 0, -4, 23.6, 3, 4]) },
    ...doorway(o, 24, 0.4),
    { type: 'wood', id: 'wall2', kind: 'plank', box: sx(o, [24.05, 0, -1.2, 24.45, 3, 1.2]) },
    { type: 'wood', id: 'pillar2', kind: 'block', box: sx(o, [24.45, 0, -0.6, 25.65, 4.2, 0.6]), burn: 0.8 },
    { type: 'wood', id: 'dropB', kind: 'crate', pos: sp(o, [25.6, 4.2, 0]), size: 1.0, spread: false },
    { type: 'plate', id: 'weight2', pos: sp(o, [26.8, 0, 0]), size: [2.4, 2.4], heavy: true, emit: 'weight2' },
    ...doorway(o, 31),
    { type: 'door', id: 'coopGate', box: sx(o, [31.05, 0, -1.2, 31.45, 3, 1.2]), on: 'weighed' },
    { type: 'brazier', id: 'b8', pos: sp(o, [34, 0, 0]) },
    // the slalom: a cord for a stack of crates that a blaze cannot reach (a long low beam runs right up to it),
    // a plank wall for a blaze, and a beam for an ember. Light the cord first, or you wait for it at the end.
    { type: 'hint', key: 'slalom', box: sx(o, [34.8, 0, -4, 37.6, 3, 4]) },
    { type: 'fuse', id: 'cord3', path: [sp(o, [36.2, 0.06, 3.2]), sp(o, [51.6, 0.06, 3.2]), sp(o, [51.6, 0.06, 1.4])], rate: 3.6, emit: 'cord3' },
    ...doorway(o, 40, 0.4),
    { type: 'wood', id: 'wall3', kind: 'plank', box: sx(o, [40.05, 0, -1.2, 40.35, 3, 1.2]) },
    block(o, 'brick', 44, 0.8, -4, 52, 3.6, 4),
    block(o, 'brick', 52, 0, -4, 52.8, 4.2, -1.2),
    block(o, 'brick', 52, 0, 1.2, 52.8, 4.2, 4),
    block(o, 'brick', 52, 3.6, -1.2, 52.8, 4.2, 1.2),
    { type: 'brazier', id: 'b8b', pos: sp(o, [55, 0, 0]) },
    ...doorway(o, 59, 0.4),
    { type: 'wood', id: 'wall4', kind: 'plank', box: sx(o, [59.05, 0, -1.2, 59.35, 3, 1.2]) },
    { type: 'prop', kind: 'pots', pos: sp(o, [42, 0, -3.2]), scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [38, 0, 3.5]) },
    { type: 'prop', kind: 'shelf', pos: sp(o, [62, 0, 3.4]), rot: 0 },
    ...[0, 1, 2].flatMap((k) => [-0.6, 0.6].map((z) => ({ type: 'wood', id: `sack${k}${z > 0 ? 'n' : 's'}`, kind: 'crate', pos: sp(o, [52.4, 1.2 * k, z]), size: [0.6, 1.2, 1.2], on: 'cord3' }))),
  ];
}

/** The Long Fuse: a pool to boil, then twenty metres of boards leading the fire to the rope that holds the kiln door. */
function longFuse(o) {
  return [
    block(o, 'tile', 0, -1, -4, 12, 0, 4),
    { type: 'brazier', id: 'b9', pos: sp(o, [1.5, 0, 0]) },
    { type: 'hint', key: 'pool', box: sx(o, [2.4, 0, -4, 5.4, 3, 4]) },
    // a ten-metre pool with a plank dam standing in it: boil, burn the dam, and be across before the water returns
    block(o, 'dark', 12, -1.3, -4, 22, -0.5, 4),
    { type: 'pool', id: 'lastPool', box: sx(o, [12, -0.5, -4, 22, -0.08, 4]), boil: 4.8 },
    { type: 'wood', id: 'lastDam', kind: 'plank', box: sx(o, [16.8, -0.5, -4, 17.2, 2.8, 4]) },
    block(o, 'tile', 22, -1, -4, 60, 0, 4),
    { type: 'brazier', id: 'b10', pos: sp(o, [24, 0, 0]) },
    { type: 'coal', pos: sp(o, [23.2, 0.5, -1.0]) },
    { type: 'hint', key: 'fuse', box: sx(o, [24.6, 0, -4, 27.2, 3, 4]) },
    ...boards(o, 'line', 28, 56, 2.5, 1.0, 0.2, 0.55),
    { type: 'wood', id: 'rope', kind: 'rope', from: sp(o, [56, 0.2, 2.5]), to: sp(o, [56, 3.4, 2.5]), emit: 'ropeGone' },
    { type: 'prop', kind: 'pipe', pos: sp(o, [34, 0, -3.5]), rot: 0 },
    { type: 'prop', kind: 'lamp', pos: sp(o, [38, 0, -3.5]) },
    { type: 'prop', kind: 'chimney', pos: sp(o, [50, 0, -3.4]) },
    block(o, 'brick', 60, 0, -4, 60.5, 3.6, 4),
    { type: 'exit', pos: sp(o, [58.2, 0, -0.6]), face: '-x', on: 'ropeGone' },
  ];
}

export default {
  id: 'f05',
  element: 'fire',
  name: 'Tinderbox',
  chapter: 2,
  theme: 'flue',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember', 'blaze'],
  hints: {
    start: 'Wood burns, and a flame spreads to whatever touches it. Choose where a fire starts, and what you still need.',
    cord: 'A cord is a fuse for wood, too. An ember lights it; when the flame arrives, the planks catch.',
    stack: '{blaze} to burn the crates. One lit crate lights every crate that touches it.',
    stones: 'Crates make stepping stones in the pool. An ember hops them safely; a blaze burns whatever it stands on.',
    walk: 'A plank bridge under dripping pipes. An ember crosses without a spark; a blaze would burn the bridge away.',
    wall: 'Burn this wall and the fire runs both ways along every plank that touches it. Is all you need ahead of you?',
    race: 'The walkway beyond is wood too, and the fire is coming. Do not dawdle on boards that are burning.',
    flue: 'Too low for a flame. Light the first board as a blaze, then {ember} and follow the fire in.',
    nook: 'Boards wall off a glow-stone. The fire that runs down the tunnel can burn what a blaze cannot reach.',
    coop: 'Beams are low and walls are wood: the right form for each, and a brazier between them.',
    wall2: 'Another pillar and crate stand right behind this wall. What touches the wall will touch them.',
    pillar: 'A crate rests on a wooden pillar over a heavy plate. Burn the pillar, and the crate falls into place.',
    pool: 'A pool with a dam standing in it. Boil the water, burn the dam, and be across before the water returns.',
    slalom: 'A cord can burn what you cannot reach. Light it first as a coal, then deal with the wall and the beam.',
    fuse: 'A line of boards runs to the rope that holds the kiln door. Light it, and race the flame.',
  },
  areas: [
    { name: 'The Wood Store', box: [-4, -4, 44, 4] },
    { name: 'The Plank Walk', box: [44, -4, 90, 4] },
    { name: 'The Flue Mouth', box: [90, -4, 130, 4] },
    { name: 'The Cooperage', box: [130, -4, 194, 4] },
    { name: 'The Long Fuse', box: [194, -4, 255, 4] },
  ],
  signals: {
    hsL: { latch: 'hs' },
    // each plate is remembered on its own: a crate that is burnt later must never undo the other
    weighed: { and: [{ latch: 'weight' }, { latch: 'weight2' }] },
  },
  pieces: [
    ...woodStore(0),
    ...plankWalk(44),
    ...flueMouth(90),
    ...cooperage(130),
    ...longFuse(194),
  ],
};
