// Fire 10 - "Firedamp". Gas: a spark sets a pocket off, or a signal does (a plate, a heat sensor, a
// socket, a fuse). The blast breaks cracked walls and glass, sets off the pockets next to it, and
// throws whoever stands in the pocket along the vector the designer chose: lighter forms fly higher,
// a blaze floats twice as far. Five areas:
//   1. The Gas Main      a spark flies up to a shelf and lights the lantern; a spark opens a cracked wall;
//                        a spark sets off one pocket and its neighbour breaks the wall behind (a chain).
//   2. The Pressure Pad  a plate inside a pocket: an ember stands on it and is thrown across a chasm,
//                        then up onto a gantry. Ember is the form that does not need the spark.
//   3. The Tank Farm     a blaze strikes a heat sensor inside a pocket and is thrown further than any
//                        jump; wooden planks, a pool to boil. A glow-stone hangs where only a flare
//                        at the top of the flight reaches.
//   4. The Relief Valve  a ladder of three launches, each wanting a different form: ember on a plate,
//                        spark on a socket, blaze on a sensor. A brazier on every rung.
//   5. The Standpipe     a spark relay: thrown through one pocket into the next, up the shaft.
// Forms: ember, blaze and spark. Layout runs along +X; areas are written in local coordinates and
// shifted into place. See LEVELS.md section 10.

/** Shift a list of pieces along +X (boxes, positions, fuse paths and wire `via` points). */
function shift(dx, list) {
  const sp = (a) => a.map((v, i) => (i === 0 ? v + dx : v));
  const sb = (b) => b.map((v, i) => (i === 0 || i === 3 ? v + dx : v));
  return list.map((q) => {
    const o = { ...q };
    if (o.box) o.box = sb(o.box);
    if (o.pos) o.pos = sp(o.pos);
    if (o.path) o.path = o.path.map(sp);
    if (o.via) o.via = o.via.map(sp);
    if (o.type === 'wood' && Array.isArray(o.from)) { o.from = sp(o.from); o.to = sp(o.to); }   // a rope's ends (a mover's `to` is an offset)
    return o;
  });
}

/** A wall across the hall (z -4..4) with a door in the middle, opened by signal `on`. */
function gate(id, x, on, time = 2) {
  return [
    { type: 'block', box: [x, 0, -4, x + 0.4, 3.6, -1.2], mat: 'brick' },
    { type: 'block', box: [x, 0, 1.2, x + 0.4, 3.6, 4], mat: 'brick' },
    { type: 'block', box: [x, 3, -1.2, x + 0.4, 3.6, 1.2], mat: 'brick' },
    { type: 'door', id, box: [x + 0.03, 0, -1.2, x + 0.37, 3, 1.2], on, time },
  ];
}

// where each area starts (world x). The proof script imports these.
export const O = { main: 0, pad: 112, tank: 198, valve: 312, pipe: 382, end: 492 };

// ==================================================================== 1. the Gas Main (x -4..64)
const main = [
  { type: 'block', box: [-4, -1, -4, 112, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
  { type: 'prop', kind: 'pipe', pos: [4, 0, -3.6], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [1.6, 0, 3.3] },
  { type: 'prop', kind: 'lamp', pos: [-1.6, 0, -3.5] },
  { type: 'prop', kind: 'kiln', pos: [20, 0, -3.4], rot: 0, solid: false },
  { type: 'brazier', id: 'b1', pos: [3, 0, 0] },
  { type: 'shard', pos: [6.4, 0.7, -2.8] },                                   // 1: easy
  // the first pocket: a spark is thrown up onto a shelf with a lantern
  { type: 'hint', key: 'launch', box: [5, 0, -4, 9, 3, 4] },
  { type: 'gas', id: 'gasA', box: [9.2, 0, -1, 10.8, 1.5, 1], launch: [5, 11.5, 0], radius: 0.5, refill: 3 },
  { type: 'block', box: [12.8, 0, -3, 26.4, 2.5, 3], mat: 'cream' },
  { type: 'lantern', id: 'lampA', pos: [18, 3.45, 0], emit: 'lampA' },
  ...gate('door1', 30, 'lampA', 3),
  // a cracked wall, and a pocket next to it
  { type: 'brazier', id: 'b1b', pos: [32.4, 0, -2.4] },
  { type: 'hint', key: 'crack', box: [31.2, 0, -4, 35, 3, 4] },
  { type: 'gas', id: 'gasB', box: [36, 0, -1, 37.6, 1.5, 1], launch: [0, 5, 0], radius: 2.5, refill: 3 },
  { type: 'weakwall', id: 'wall1', box: [40, 0, -4, 40.4, 3.6, 4] },
  { type: 'coal', pos: [34.4, 0.5, 2.8] },
  // a chain: the first pocket sets off the second, whose blast breaks the wall you cannot reach
  { type: 'hint', key: 'chain', box: [41, 0, -4, 45, 3, 4] },
  { type: 'gas', id: 'gasC', box: [46, 0, -1, 47.6, 1.5, 1], launch: [0, 5, 0], radius: 2.5, refill: 3 },
  { type: 'gas', id: 'gasD', box: [50, 0, -1, 51.6, 1.5, 1], launch: [0, 0, 0], radius: 2.5, refill: 3 },
  { type: 'weakwall', id: 'wall2', box: [53.6, 0, -4, 54, 3.6, 4] },
  { type: 'prop', kind: 'lamp', pos: [44, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [49, 0, -3.3] },
  { type: 'prop', kind: 'shelf', pos: [60, 0, 3.55], rot: 0 },
  { type: 'prop', kind: 'lamp', pos: [64, 0, -3.5] },
  // a double throw: a spark is thrown onto a low shelf, walks to the pocket on it, and is thrown again, up to a high shelf with a lantern
  { type: 'brazier', id: 'b1c', pos: [56.4, 0, -2.4] },
  { type: 'hint', key: 'double', box: [55, 0, -4, 58.6, 3, 4] },
  { type: 'gas', id: 'gasE1', box: [59.2, 0, -1, 60.8, 1.5, 1], launch: [5, 11.5, 0], radius: 0.5, refill: 3 },
  { type: 'block', box: [62.8, 0, -3, 80, 2.5, 3], mat: 'cream' },
  { type: 'gas', id: 'gasE2', box: [76, 2.5, -1, 77.6, 4, 1], launch: [8.5, 15, 0], radius: 0.5, refill: 3 },
  { type: 'coal', pos: [70, 3.0, 1.6] },
  { type: 'block', box: [87.4, 5.9, -3, 103, 6.3, 3], mat: 'metal' },
  { type: 'brazier', id: 'b1d', pos: [90, 6.3, 0] },
  { type: 'lantern', id: 'lampX', pos: [97, 7.25, 0], emit: 'lampX' },
  ...gate('doorX', 108, 'lampX', 2.5),
];

// ==================================================================== 2. the Pressure Pad (x 112..198)
const pad = shift(O.pad, [
  { type: 'block', box: [0, -1, -4, 12, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'pad', box: [4.5, 0, -4, 9, 3, 4] },
  { type: 'plate', id: 'plateA', pos: [10, 0, 0], size: [1.6, 1.6], emit: 'padA' },
  { type: 'gas', id: 'padGasA', box: [9, 0, -0.9, 11, 1.4, 0.9], launch: [12, 12, 0], radius: 0.5, refill: 3, on: { delay: 'padA', for: 0.8 } },
  // the chasm (x 12..18) and the landing
  { type: 'block', box: [18, -1, -4, 36, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2b', pos: [21, 0, 0] },
  { type: 'prop', kind: 'pipe', pos: [24, 0, -3.6], rot: 0 },
  { type: 'hint', key: 'gantry', box: [22.4, 0, -4, 28, 3, 4] },
  { type: 'plate', id: 'plateB', pos: [26, 0, 0], size: [1.6, 1.6], emit: 'padB' },
  { type: 'gas', id: 'padGasB', box: [25, 0, -0.9, 27, 1.4, 0.9], launch: [4, 16, 0], radius: 0.5, refill: 3, on: { delay: 'padB', for: 0.8 } },
  // the gantry over the landing, with the lantern that opens the next gate
  { type: 'block', box: [28, 3.6, -3, 35, 4, 3], mat: 'metal' },
  { type: 'lantern', id: 'lampB', pos: [32, 4.95, 0], emit: 'lampB' },
  ...gate('door2', 36, 'lampB', 3),
  { type: 'block', box: [36.4, -1, -4, 43, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2c', pos: [39, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [38, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [38.4, 0, 3.3] },
  { type: 'hint', key: 'pool2', box: [39.4, 0, -4, 43, 3, 4] },
  { type: 'plate', id: 'plateC', pos: [41, 0, 0], size: [1.6, 1.6], emit: 'padC' },
  { type: 'gas', id: 'padGasC', box: [40, 0, -0.9, 42, 1.4, 0.9], launch: [12, 12, 0], radius: 0.5, refill: 3, on: { delay: 'padC', for: 0.8 } },
  { type: 'block', box: [43, -1.3, -4, 49, -0.5, 4], mat: 'dark' },
  { type: 'pool', id: 'pool2', box: [43, -0.5, -4, 49, -0.08, 4], boil: 3.5 },
  { type: 'block', box: [49, -1, -4, 66.6, 0, 4], mat: 'tile' },
  { type: 'prop', kind: 'kiln', pos: [52, 0, -3.4], rot: 0, solid: false },
  { type: 'prop', kind: 'lamp', pos: [50.4, 0, 3.5] },
  // two pads in a row: the first throws an ember onto a raised slab, the pad on it throws it over a chasm
  { type: 'hint', key: 'twopads', box: [50, 0, -4, 53, 3, 4] },
  { type: 'plate', id: 'plateE', pos: [54, 0, 0], size: [1.6, 1.6], emit: 'padE' },
  { type: 'gas', id: 'padGasE', box: [53, 0, -0.9, 55, 1.4, 0.9], launch: [6, 13, 0], radius: 0.5, refill: 3, on: { delay: 'padE', for: 0.8 } },
  { type: 'block', box: [57.6, 2.2, -3, 66.6, 2.6, 3], mat: 'metal' },
  { type: 'plate', id: 'plateF', pos: [64, 2.6, 0], size: [1.6, 1.6], emit: 'padF' },
  { type: 'gas', id: 'padGasF', box: [63, 2.6, -0.9, 65, 4.0, 0.9], launch: [13, 12, 0], radius: 0.5, refill: 3, on: { delay: 'padF', for: 0.8 } },
  { type: 'block', box: [72.6, -1, -4, 86, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2d', pos: [75.6, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [74, 0, -3.5] },
  { type: 'prop', kind: 'pipe', pos: [80, 0, 3.6], rot: 0 },
]);

// ==================================================================== 3. the Tank Farm (x 136..238)
const tank = shift(O.tank, [
  { type: 'block', box: [0, -1, -4, 18, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b3', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'pipe', pos: [14, 0, 3.6], rot: 0 },
  { type: 'hint', key: 'burn', box: [4, 0, -4, 7.6, 3, 4] },
  { type: 'wood', id: 'planks', kind: 'plank', box: [8, 0, -4, 8.4, 3, 4] },
  { type: 'hint', key: 'sensor', box: [9, 0, -4, 12, 3, 4] },
  { type: 'heatsensor', id: 'hsG', box: [12, 0, -1.2, 14, 2.4, 1.2], emit: 'hotG' },
  { type: 'gas', id: 'gasG', box: [12, 0, -1.2, 14, 1.6, 1.2], launch: [10, 12, 0], radius: 0.5, refill: 3, on: { delay: 'hotG', for: 0.9 } },
  // the chasm (x 18..29): a glow-stone hangs in the air at the top of the flight
  { type: 'shard', pos: [30.2, 7.2, 0] },                                     // 2: needs the flare
  { type: 'block', box: [29, -1, -4, 54, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b3b', pos: [32, 0, 0] },
  { type: 'coal', pos: [34.4, 0.5, 2.8] },
  { type: 'prop', kind: 'kiln', pos: [38, 0, -3.4], rot: 0, solid: false },
  { type: 'hint', key: 'pool', box: [51, 0, -4, 53.6, 3, 4] },
  { type: 'block', box: [54, -1.3, -4, 62, -0.5, 4], mat: 'dark' },
  { type: 'pool', id: 'pool', box: [54, -0.5, -4, 62, -0.08, 4], boil: 3.5 },
  { type: 'block', box: [62, -1, -4, 80, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b3c', pos: [65, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [66, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [70, 0, -3.3] },
  // a gap of nine metres and a bridge that hangs from a rope: a blaze burns the rope, the bridge comes down
  { type: 'hint', key: 'rope', box: [72, 0, -4, 78.6, 3, 4] },
  { type: 'wood', id: 'rope', kind: 'rope', from: [78.2, 0.15, 2.4], to: [79.6, 3.4, 1.4], emit: 'ropeCut' },
  { type: 'mover', id: 'bridge', box: [80, 3, -1.5, 89, 3.4, 1.5], to: [0, -3.4, 0], speed: 4, mode: 'toggle', on: 'ropeCut', mat: 'metal' },
  { type: 'block', box: [89, -1, -4, 114, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b3d', pos: [92, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [94, 0, -3.5] },
  // two more blaze tasks, and one coal to carry the gauge through both: planks, then a wall of ice
  { type: 'hint', key: 'budget', box: [92.6, 0, -4, 95.6, 3, 4] },
  { type: 'wood', id: 'planks2', kind: 'plank', box: [96, 0, -4, 96.4, 3, 4] },
  { type: 'coal', pos: [100, 0.5, 2.6] },
  { type: 'iceblock', id: 'ice3', box: [104, 0, -4, 104.6, 3, 4], melt: 1.5 },
  { type: 'brazier', id: 'b3e', pos: [108, 0, 0] },
  { type: 'prop', kind: 'kiln', pos: [110, 0, 3.4], rot: 0, solid: false },
]);

// ==================================================================== 4. the Relief Valve (x 238..308)
const valve = shift(O.valve, [
  { type: 'block', box: [0, -1, -4, 70, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b4', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'ladder', box: [4.5, 0, -4, 9, 3, 4] },
  // rung 1: a plate in a pocket (ember)
  { type: 'plate', id: 'plateL', pos: [10, 0, 0], size: [1.6, 1.6], emit: 'padL' },
  { type: 'gas', id: 'gasL', box: [9, 0, -0.9, 11, 1.4, 0.9], launch: [5, 15, 0], radius: 0.5, refill: 3, on: { delay: 'padL', for: 0.8 } },
  { type: 'block', box: [14, 2.8, -3, 22, 3.2, 3], mat: 'metal' },
  { type: 'brazier', id: 'b4a', pos: [16, 3.2, 0] },
  { type: 'hint', key: 'socket', box: [14.4, 3.2, -3, 22, 6, 3] },
  // rung 2: a socket in a pocket (spark)
  { type: 'terminal', id: 't1', pos: [19.4, 3.2, 0], emit: 's1' },
  { type: 'gas', id: 'gasS', box: [18.4, 3.2, -1, 20.6, 4.6, 1], launch: [8.5, 15, 0], radius: 0.5, refill: 3, on: { delay: 's1', for: 0.6 } },
  { type: 'block', box: [30, 6.6, -3, 46, 7, 3], mat: 'metal' },
  { type: 'brazier', id: 'b4b', pos: [32, 7, 0] },
  { type: 'hint', key: 'sensor2', box: [36, 7, -3, 40, 10, 3] },
  // rung 3: a heat sensor in a pocket (blaze)
  { type: 'heatsensor', id: 'hsV', box: [41, 7, -1.2, 43, 9.4, 1.2], emit: 'hotV' },
  { type: 'gas', id: 'gasV', box: [41, 7, -1.2, 43, 8.6, 1.2], launch: [6.5, 15, 0], radius: 0.5, refill: 3, on: { delay: 'hotV', for: 0.9 } },
  { type: 'block', box: [52, 10.4, -4, 70, 10.8, 4], mat: 'metal' },
  { type: 'brazier', id: 'b4c', pos: [55, 10.8, 0] },
  // the way off the top is boarded up, then walled with ice: a blaze burns the boards and melts the wall
  { type: 'hint', key: 'boards', box: [55.4, 10.8, -4, 60, 14, 4] },
  { type: 'wood', id: 'planks3', kind: 'plank', box: [63, 10.8, -4, 63.4, 13.8, 4] },
  { type: 'iceblock', id: 'ice4', box: [66.4, 10.8, -4, 67, 13.8, 4], melt: 1.5 },
]);

// ==================================================================== 5. the Standpipe (x 308..354)
const pipe = shift(O.pipe, [
  { type: 'block', box: [0, 10.4, -4, 16, 10.8, 4], mat: 'metal' },
  { type: 'brazier', id: 'b5', pos: [3, 10.8, 0] },
  { type: 'hint', key: 'relay', box: [3.4, 10.8, -4, 8, 14, 4] },
  // a launch to the first gantry, a rail from there to the pocket on the top gantry, and a last launch
  { type: 'heatsensor', id: 'hsR', box: [8, 10.8, -1.2, 10.4, 13.2, 1.2], emit: 'hotR' },
  { type: 'gas', id: 'gasR1', box: [8, 10.8, -1.2, 10.4, 12.4, 1.2], launch: [4, 16, 0], radius: 0.5, refill: 3, on: { delay: 'hotR', for: 0.9 } },
  { type: 'block', box: [13, 15.6, -3, 34, 16, 3], mat: 'metal' },
  { type: 'brazier', id: 'b5b', pos: [30, 16, 0] },
  { type: 'hint', key: 'rail', box: [14, 16, -3, 22, 19, 3] },
  { type: 'terminal', id: 'tA', pos: [33, 16, 0] },
  { type: 'terminal', id: 'tR', pos: [60.4, 25, 0], emit: 'sR' },
  { type: 'wire', id: 'coaster', from: 'tA', to: 'tR', speed: 4.5, via: [[33.6, 17.2, 0], [37, 20, 0], [45, 23, 0], [55, 24.4, 0], [59.8, 26, 0]] },
  { type: 'shard', pos: [20.5, 21.8, 0] },                                       // 3: high over the first gantry, a blaze's
  { type: 'block', box: [57, 24.6, -3, 66, 25, 3], mat: 'metal' },
  { type: 'brazier', id: 'b5c', pos: [58, 25, 1.8] },
  { type: 'hint', key: 'pocket3', box: [57.2, 25, -3, 63, 28, 3] },
  { type: 'gas', id: 'gasR2', box: [59, 25, -1, 62, 26.5, 1], launch: [4, 18, 0], radius: 0.5, refill: 3, on: { delay: 'sR', for: 0.6 } },
  { type: 'block', box: [68, 30.6, -4, 88, 31, 4], mat: 'metal' },
  { type: 'brazier', id: 'b5d', pos: [70, 31, 0] },
  { type: 'hint', key: 'last', box: [70.4, 31, -4, 75, 34, 4] },
  // one more throw: the pocket on the top gantry throws a spark to the last platform, where the exit is
  { type: 'gas', id: 'gasR3', box: [82, 31, -1, 84, 32.5, 1], launch: [8.5, 15, 0], radius: 0.5, refill: 3 },
  { type: 'block', box: [93.6, 34.4, -4, 110, 34.8, 4], mat: 'metal' },
  { type: 'brazier', id: 'b5e', pos: [96, 34.8, 0] },
  { type: 'block', box: [109.6, 34.8, -4, 110, 38.4, 4], mat: 'brick' },
  { type: 'exit', pos: [106.4, 34.8, 0], face: '-x' },
]);

export default {
  id: 'f10',
  element: 'fire',
  name: 'Firedamp',
  chapter: 3,
  theme: 'wire',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  forms: ['ember', 'blaze', 'spark'],
  killY: -9,
  areas: [
    { name: 'The Gas Main', box: [-4, -4, O.pad, 4] },
    { name: 'The Pressure Pad', box: [O.pad, -4, O.tank, 4] },
    { name: 'The Tank Farm', box: [O.tank, -4, O.valve, 4] },
    { name: 'The Relief Valve', box: [O.valve, -4, O.pipe, 4] },
    { name: 'The Standpipe', box: [O.pipe, -4, O.end, 4] },
  ],
  hints: {
    start: 'Gas in the pipes. A spark sets a pocket off, and the blast throws whatever stands in it. {spark} to try.',
    launch: 'A pocket of gas. A spark that touches it is thrown along the arrow of the blast: look where it lands first.',
    crack: 'A cracked wall. Only a blast breaks it, and a blast reaches a few metres.',
    chain: 'Pockets close together set each other off. The far wall is out of reach of this one, but not of its neighbour.',
    pad: 'A plate inside a pocket: an ember standing on it sets the gas off after a moment. Stay put and be thrown.',
    gantry: 'A hotter blast, straight up. Stand on the plate and stay there; the gantry is the landing.',
    burn: 'Planks. {blaze} to burn them, and refuel from the flame you light.',
    sensor: 'A heat sensor sits in this pocket. A flame standing on it sets the gas off, and a flame floats far.',
    pool: 'A pool, eight metres wide. A blaze boils it for a moment: cross before the rain comes back.',
    rope: 'The bridge hangs from that rope. A blaze will burn it through; then walk across.',
    ladder: 'Three rungs, each lit by a different form. An ember on the plate goes first. Fall off and walk back: nothing is lost.',
    socket: 'A socket in a pocket: a spark sitting on it sets the gas off. {spark} to shrink, then sit.',
    sensor2: 'Last rung: a flame on the sensor. {blaze} to flare up, then stand still until you are thrown.',
    relay: 'The last climb is a spark: be thrown to the gantry, ride its wire, and let the pocket at the far end throw you again.',
    rail: 'Touch the post and the wire carries you, slowly, over the dark. The pocket on the far gantry is waiting.',
    pocket3: 'The last pocket: a spark that arrives in it is thrown to the top. Stay put and enjoy the view.',
    double: 'Two shelves, two pockets. Be thrown to the low one, walk to the pocket on it, and be thrown again.',
    budget: 'Planks, then ice, with coal between. A blaze burns heat all the way: take the coal if the gauge runs low.',
    last: 'One more throw, from the pocket on this gantry to the last platform. The kiln door is up there.',
    twopads: 'Two pads in a row. The first throws you onto the slab; the plate up there throws you across the chasm.',
    boards: 'Boards, then ice, bar the way off the rung. A blaze burns both and spends heat: fill the gauge at the brazier first.',
    pool2: 'A pool, six metres wide, and a plate in a pocket. Be thrown over it, or boil it as a blaze and wade.',
  },
  signals: {},
  pieces: [...main, ...pad, ...tank, ...valve, ...pipe],
};
