// Fire 11 - "Slow Match". Fuses are timers you can see. A fuse sets a pocket off when its flame
// arrives (so you can be standing in it), holds a door open for a window, or has to be lit in an
// order so that three flames land together. Five areas:
//   1. The Match Room   light a fuse, run to the pocket, wait for the flame, and be thrown (twice: a
//                       chasm, then a pool).
//   2. The Shutter Run  the fuse starts the clock; a shutter opens for six seconds when it ends. Three
//                       wires over three chasms get a spark there on time.
//   3. The Sync Hall    three fuses of three lengths: the furnace opens only when all three flames
//                       arrive together, so the longest is lit first.
//   4. The Countdown    one long fuse and a cannon at the far end. Three lanterns (ember, spark,
//                       blaze) stand between you and the cannon; the stone is a blaze's.
//   5. The Kiln Mouth   the last shutter, and a last wire.
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
export const O = { match: 0, shutter: 64, sync: 128, count: 198, mouth: 390, end: 459 };

// ==================================================================== 1. the Match Room (x -4..64)
const match = [
  { type: 'block', box: [-4, -1, -4, 24, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
  { type: 'prop', kind: 'pots', pos: [2, 0, -3.3] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'prop', kind: 'pipe', pos: [14, 0, -3.6], rot: 0 },
  { type: 'brazier', id: 'b1', pos: [3, 0, 0] },
  { type: 'hint', key: 'fuse', box: [8, 0, -4, 13, 3, 4] },
  { type: 'fuse', id: 'fuseA', path: [[11.5, 0.06, 2.4], [20.5, 0.06, 2.4]], rate: 2.0, regrow: 4, emit: 'fuseA' },
  { type: 'hint', key: 'pocket', box: [15, 0, -4, 20, 3, 4] },
  { type: 'gas', id: 'gasA', box: [21, 0.78, -1, 23, 2.2, 1], launch: [14, 12, 0], radius: 0.5, refill: 3, on: 'fuseA' },
  // the chasm (x 24..31) and the landing
  { type: 'block', box: [31, -1, -4, 48, 0, 4], mat: 'tile' },
  { type: 'block', box: [55, -1, -4, 64, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b1b', pos: [34, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [33, 0, -3.5] },
  { type: 'prop', kind: 'kiln', pos: [40, 0, 3.4], rot: 0, solid: false },
  // the second pocket, and a pool (x 48..55) that the flight must clear
  { type: 'hint', key: 'pool', box: [37, 0, -4, 41, 3, 4] },
  { type: 'fuse', id: 'fuseB', path: [[36, 0.06, -2.6], [44, 0.06, -2.6]], rate: 2.2, regrow: 4, emit: 'fuseB' },
  { type: 'gas', id: 'gasB', box: [45, 0.78, -1, 47, 2.2, 1], launch: [14, 12, 0], radius: 0.5, refill: 3, on: 'fuseB' },
  { type: 'block', box: [48, -1.3, -4, 55, -0.5, 4], mat: 'dark' },
  { type: 'pool', id: 'pool', box: [48, -0.5, -4, 55, -0.08, 4] },
  { type: 'prop', kind: 'lamp', pos: [58, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [61, 0, -3.3] },
];

// ==================================================================== 2. the Shutter Run (x 64..128)
const shutter = shift(O.shutter, [
  { type: 'block', box: [0, -1, -4, 12, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'shutter', box: [3.4, 0, -4, 9, 3, 4] },
  // one fuse, twelve metres, six seconds: it opens the shutter at the far end when it burns out
  { type: 'fuse', id: 'fuseC', path: [[8, 0.06, -2.6], [8, 0.06, 3.4], [14, 0.06, 3.4]], rate: 2.0, regrow: 6, emit: 'fuseC' },
  // three islands, three wires
  { type: 'terminal', id: 'p1a', pos: [11, 0, 0] },
  { type: 'terminal', id: 'p1b', pos: [19, 0, 0] },
  { type: 'wire', id: 'w1', from: 'p1a', to: 'p1b', speed: 10, via: [[11.6, 2.4, 0], [14, 3.0, 0], [18.4, 2.4, 0]] },
  { type: 'block', box: [18, -1, -3, 24, 0, 3], mat: 'cream' },
  { type: 'terminal', id: 'p2a', pos: [23, 0, 0] },
  { type: 'terminal', id: 'p2b', pos: [31, 0, 0] },
  { type: 'wire', id: 'w2', from: 'p2a', to: 'p2b', speed: 10, via: [[23.6, 2.4, 0], [26, 3.0, 0], [30.4, 2.4, 0]] },
  { type: 'block', box: [30, -1, -3, 36, 0, 3], mat: 'cream' },
  { type: 'terminal', id: 'p3a', pos: [35, 0, 0] },
  { type: 'terminal', id: 'p3b', pos: [43, 0, 0] },
  { type: 'wire', id: 'w3', from: 'p3a', to: 'p3b', speed: 10, via: [[35.6, 2.4, 0], [38, 3.0, 0], [42.4, 2.4, 0]] },
  { type: 'block', box: [42, -1, -4, 50, 0, 4], mat: 'tile' },
  { type: 'coal', pos: [20.8, 0.5, 0.3] },
  { type: 'coal', pos: [33.2, 0.5, 0.3] },
  { type: 'coal', pos: [46, 0.5, 0.4] },
  ...gate('shutter', 50, 'fuseC', 1),
  { type: 'block', box: [50.4, -1, -4, 64, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2b', pos: [54, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [52, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [58, 0, -3.3] },
]);

// ==================================================================== 3. the Sync Hall (x 128..198)
const sync = shift(O.sync, [
  { type: 'block', box: [0, -1, -4, 70, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b3', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'sync', box: [4, 0, -4, 8, 3, 4] },
  // three fuses of three lengths, all running toward the furnace gate at x = 48
  { type: 'fuse', id: 'f1', path: [[8, 0.06, -3.2], [38, 0.06, -3.2]], rate: 2.4, regrow: 5.5, emit: 'f1' },
  { type: 'fuse', id: 'f2', path: [[20, 0.06, 0], [40, 0.06, 0]], rate: 2.4, regrow: 5.5, emit: 'f2' },
  { type: 'fuse', id: 'f3', path: [[32, 0.06, 3.2], [42, 0.06, 3.2]], rate: 2.4, regrow: 5.5, emit: 'f3' },
  { type: 'prop', kind: 'kiln', pos: [44, 0, -3.4], rot: 0, solid: false },
  ...gate('furnace', 48, { and: ['f1', 'f2', 'f3'] }, 1.5),
  { type: 'brazier', id: 'b3b', pos: [52, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [56, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [60, 0, -3.3] },
  { type: 'prop', kind: 'pipe', pos: [66, 0, 3.6], rot: 0 },
  // a niche behind a cracked wall, and the little pocket (and match) that opens it
  { type: 'hint', key: 'niche', box: [54, 0, -4, 60, 3, 0] },
  { type: 'fuse', id: 'fuseW', path: [[57, 0.06, -3.0], [59.4, 0.06, -3.0]], rate: 2.4, regrow: 4, emit: 'fuseW' },
  { type: 'gas', id: 'gasW', box: [60.8, 0, -3.4, 62.8, 1.5, -1.8], launch: [0, 0, 0], radius: 2.5, refill: 3, on: 'fuseW' },
  { type: 'weakwall', id: 'nicheWall', box: [64, 0, -4, 64.4, 3.6, -1.6] },
  { type: 'block', box: [64, 0, -1.6, 70, 3.6, -1.4], mat: 'brick' },
  { type: 'block', box: [69.6, 0, -4, 70, 3.6, -1.6], mat: 'brick' },
  { type: 'shard', pos: [67, 0.7, -2.8] },                                    // 2: behind the cracked wall
]);

// ==================================================================== 4. the Countdown (x 198..390)
// The first stretch (x 0..134) is four lanterns' worth of obstacles; the second (shifted by 38) is the pool, the
// rail and the cannon. The long fuse starts beside the brazier after the second lantern (the first two are free); it burns for about 91 s, so a slow player on a keyboard still has a fifth in hand; a player who is late finds the cannon harmless and relights a second, short fuse beside the pool.
const countA = [
  { type: 'block', box: [0, -1, -4, 134, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b4', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'count', box: [52, 0, -4, 57, 3, 4] },
  // the long fuse runs along the south wall (and over the rail) to the cannon
  { type: 'fuse', id: 'fuseE', path: [[58, 0.06, -3.6], [163, 0.06, -3.6], [163, 2.6, -3.6], [173, 2.6, -3.6], [173, 0.06, -3.6], [181, 0.06, -3.6], [181, 0.06, -1]], rate: 2.0, regrow: 6, emit: 'fuseE' },
  // lantern one, on a ledge (ember)
  { type: 'block', box: [18, 0, 1.4, 21, 1.2, 3.8], mat: 'cream' },
  { type: 'lantern', id: 'lampE', pos: [19.5, 2.15, 2.6], emit: 'lampE' },
  ...gate('doorE', 28, 'lampE', 1.5),
  // lantern two, in a pinhole alcove (spark)
  { type: 'block', box: [36, 0, 1.6, 38.275, 3.6, 1.8], mat: 'brick' },
  { type: 'block', box: [38.725, 0, 1.6, 42, 3.6, 1.8], mat: 'brick' },
  { type: 'block', box: [38.275, 0.45, 1.6, 38.725, 3.6, 1.8], mat: 'brick' },
  { type: 'block', box: [36, 0, 1.8, 36.2, 3.6, 3.8], mat: 'brick' },
  { type: 'block', box: [41.8, 0, 1.8, 42, 3.6, 3.8], mat: 'brick' },
  { type: 'block', box: [36, 0, 3.8, 42, 3.6, 4.0], mat: 'brick' },
  // two low stops beside the pinhole, outside and inside: a spark run along the partition into one stops in line with the hole
  { type: 'block', box: [38.665, 0, 1.1, 39.4, 0.9, 1.6], mat: 'cream' },
  { type: 'block', box: [37.4, 0, 1.8, 38.31, 0.9, 2.5], mat: 'cream' },
  { type: 'lantern', id: 'lampS', pos: [40.6, 0.95, 2.8], r: 1.5, emit: 'lampS' },
  { type: 'coal', pos: [37.2, 0.5, 2.8] },
  { type: 'coal', pos: [38.5, 0.5, 2.5] },                                       // straight through the pinhole
  { type: 'coal', pos: [39.8, 0.5, 3.5] },                                       // on the way along the far wall to the lantern
  { type: 'coal', pos: [40.2, 0.5, 2.1] },                                       // along the partition on the way back to the pinhole
  { type: 'brazier', id: 'b4a', pos: [33, 0, 0] },
  ...gate('doorS', 50, 'lampS', 1.5),
  // the planks (blaze) with the third lantern behind them
  { type: 'brazier', id: 'b4b', pos: [56, 0, 0] },
  { type: 'wood', id: 'planks', kind: 'plank', box: [66, 0, -4, 66.4, 3, 4] },
  { type: 'prop', kind: 'pots', pos: [62, 0, 3.3] },
  { type: 'lantern', id: 'lampB', pos: [72, 0.95, 1.2], emit: 'lampB' },
  ...gate('doorB', 80, 'lampB', 1.5),
  { type: 'brazier', id: 'b4c', pos: [86, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [90, 0, 3.5] },
  // a crawlspace under a long shelf, with a lantern at its end: only a spark fits (four seconds of heat; the door waits for it)
  { type: 'hint', key: 'crawl', box: [90, 0, -4, 94, 3, 4] },
  { type: 'block', box: [94, 0.45, 1.8, 108, 1.0, 4], mat: 'brick' },
  { type: 'block', box: [94, 0, 3.8, 108, 1.0, 4], mat: 'brick' },
  { type: 'block', box: [107.6, 0, 1.8, 108, 1.0, 4], mat: 'brick' },
  { type: 'lantern', id: 'lampT', pos: [106.6, 0.3, 3.0], mount: 'wall', emit: 'lampT' },
  { type: 'coal', pos: [91.6, 0.5, 1.0] },                                      // on the way to the crawlspace: the spark is half spent when it gets there
  { type: 'coal', pos: [96, 0.5, 3.0] },
  { type: 'coal', pos: [101.5, 0.5, 3.0] },                                      // deeper in the crawlspace, on the way to the lantern
  ...gate('doorT', 112, 'lampT', 1.5),
  // a heat sensor in front of the last door: a flame on it, for good
  { type: 'hint', key: 'sensorD', box: [113, 0, -4, 116, 3, 4] },
  { type: 'heatsensor', id: 'hsD', box: [117, 0, -1.4, 120, 2.4, 1.4], emit: 'hotD' },
  { type: 'brazier', id: 'b4e', pos: [114, 0, -2.6] },
  ...gate('doorD', 124, 'openD', 1.5),
  { type: 'prop', kind: 'lamp', pos: [128, 0, -3.5] },
  { type: 'coal', pos: [129.4, 0.5, 0.3] },                                        // before the pool: a blaze that has done the sensor door is short of the boil
];
const countB = shift(38, [
  { type: 'prop', kind: 'kiln', pos: [92, 0, -3.4], rot: 0, solid: false },
  // a pool a blaze can boil, then a rail over a chasm for a spark
  { type: 'hint', key: 'boil', box: [92, 0, -4, 95.6, 3, 4] },
  { type: 'block', box: [96, -1.3, -4, 104, -0.5, 4], mat: 'dark' },
  { type: 'pool', id: 'poolB', box: [96, -0.5, -4, 104, -0.08, 4], boil: 3.5 },
  { type: 'block', box: [104, -1, -4, 126, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b4d', pos: [108, 0, 0] },
  { type: 'hint', key: 'rope', box: [112, 0, -4, 118, 3, 4] },
  { type: 'terminal', id: 'ra', pos: [124.4, 0, 0] },
  { type: 'terminal', id: 'rb', pos: [135.6, 0, 0] },
  { type: 'wire', id: 'rail', from: 'ra', to: 'rb', speed: 10, via: [[125, 2.4, 0], [128, 3.2, 0], [133, 3.2, 0], [135, 2.4, 0]] },
  { type: 'block', box: [134, -1, -4, 146, 0, 4], mat: 'tile' },
  { type: 'coal', pos: [137.4, 0.5, 2.4] },
  // the cannon (x 142..144): a cloud of gas hanging head-high. An ember or a blaze standing under it is thrown when the flame
  // arrives; a spark, even jumping, never reaches it, so no spark can set it off early. A glow-stone hangs high on its arc
  { type: 'hint', key: 'cannon', box: [138, 0, -4, 141.4, 3, 4] },
  { type: 'gas', id: 'cannon', box: [141.8, 0.78, -1.2, 144, 2.2, 1.2], launch: [16, 12, 0], radius: 0.5, refill: 4, on: { or: ['fuseE', 'fuseE2'] } },
  // a player who is late finds the cannon went off by itself, harmlessly: this second fuse starts beside the brazier before the rail and burns the
  // last forty metres in 21 s, so the retry is the short stretch (rail, then the pocket), not the whole countdown
  { type: 'hint', key: 'again', box: [109, 0, -4, 114, 3, 4] },
  { type: 'fuse', id: 'fuseE2', path: [[110, 0.06, -3.6], [125, 0.06, -3.6], [125, 2.6, -3.6], [135, 2.6, -3.6], [135, 0.06, -3.6], [143, 0.06, -3.6], [143, 0.06, -1]], rate: 2.0, regrow: 6, emit: 'fuseE2' },
  // the annex: a corridor off the landing, fifty-five metres out, with a glow-stone at its end. The fuse burns for a long time: this is what to do with it
  { type: 'hint', key: 'annex', box: [138, 0, 0, 142, 3, 6] },
  { type: 'block', box: [138, -1, 4, 142, 0, 59], mat: 'tile' },
  { type: 'block', box: [137.6, 0, 4, 138, 1.2, 59.4], mat: 'brick' },
  { type: 'block', box: [142, 0, 4, 142.4, 1.2, 59.4], mat: 'brick' },
  { type: 'block', box: [137.6, 0, 59, 142.4, 1.2, 59.4], mat: 'brick' },
  { type: 'shard', pos: [140, 0.7, 56.6] },                                      // 1: a long walk, and it is only a walk
  { type: 'shard', pos: [158.4, 4.8, 0] },                                     // 3: only a blaze rides high enough
]);
const count = shift(O.count, [...countA, ...countB]);

// ==================================================================== 5. the Kiln Mouth (x 352..422)
const mouth = shift(O.mouth, [
  { type: 'block', box: [0, -1, -4, 36, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b5', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [16, 0, 3.3] },
  { type: 'hint', key: 'mouth', box: [3.4, 0, -4, 9, 3, 4] },
  // the last timer: eight metres of fuse, four seconds, and a kiln door that opens for 10 s when it ends
  { type: 'fuse', id: 'fuseF', path: [[6, 0.06, -2.6], [6, 0.06, 3.4], [8, 0.06, 3.4]], rate: 2.0, regrow: 10, emit: 'fuseF' },
  { type: 'coal', pos: [14, 0.5, 0.2] },
  { type: 'coal', pos: [24, 0.5, 0.4] },                                       // on the straight line to the wire: a spark that started at the frayed end has the heat for the run
  { type: 'terminal', id: 'qa', pos: [34.4, 0, 0] },
  { type: 'terminal', id: 'qb', pos: [53, 0, 0] },
  { type: 'block', box: [36, -1.2, -4, 52, -0.6, 4], mat: 'dark' },
  { type: 'pool', id: 'poolF', box: [36, -0.6, -4, 52, -0.1, 4] },
  { type: 'wire', id: 'wf', from: 'qa', to: 'qb', speed: 12, via: [[35, 2.6, 0], [38, 3.4, 0], [50, 3.4, 0], [52.4, 2.6, 0]] },
  { type: 'block', box: [52, -1, -4, 70, 0, 4], mat: 'tile' },
  { type: 'coal', pos: [56, 0.5, 2.6] },
  { type: 'prop', kind: 'lamp', pos: [58, 0, -3.5] },
  { type: 'prop', kind: 'kiln', pos: [63, 0, 3.4], rot: 0, solid: false },
  { type: 'block', box: [68.4, 0, -4, 69, 3.6, 4], mat: 'brick' },
  { type: 'exit', pos: [66, 0, 0], face: '-x', on: 'fuseF' },
]);

export default {
  id: 'f11',
  element: 'fire',
  name: 'Slow Match',
  chapter: 3,
  theme: 'wire',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  forms: ['ember', 'blaze', 'spark'],
  killY: -9,
  areas: [
    { name: 'The Match Room', box: [-4, -4, O.shutter, 4] },
    { name: 'The Shutter Run', box: [O.shutter, -4, O.sync, 4] },
    { name: 'The Sync Hall', box: [O.sync, -4, O.count, 4] },
    { name: 'The Countdown', box: [O.count, -4, O.mouth, 4] },
    { name: 'The Kiln Mouth', box: [O.mouth, -4, O.end, 4] },
  ],
  hints: {
    start: 'A fuse is a timer you can watch. Touch its frayed end and see where the flame goes.',
    fuse: 'This fuse runs to a pocket of gas. Light it, then stand in the pocket and wait for the flame.',
    pocket: 'Stay in the pocket. The flame sets it off and the blast throws you across the chasm.',
    pool: 'Same trick over a pool. Be in the pocket when the flame arrives: a short wait.',
    shutter: 'The shutter opens for six seconds when this fuse burns out. A spark can be there on time.',
    sync: 'The furnace opens only while all three flames have arrived. Longer fuses must be lit first.',
    niche: 'A cracked wall, a small pocket beside it and a short match. You do not have to stand in this one.',
    count: 'One fuse, and a cannon at the far end. Six obstacles stand between: take your time, but the flame does not wait.',
    boil: 'A pool, eight metres wide. A blaze boils it: wade across, then climb out before the rain returns.',
    rope: 'A rail across the chasm, and the fuse runs along it. A spark rides faster than the flame.',
    crawl: 'A crawlspace under the shelf, a lantern at its end, and a door that waits for it. Only a spark fits.',
    sensorD: 'The last door opens for good when a flame stands on the sensor. {blaze}, wait a moment, then go on.',
    annex: 'A long side corridor. A glow-stone waits at the end of it. The flame is a long way off: you have time.',
    again: 'Too late? The cannon goes off alone. Light this fuse, run the rail and stand in the cannon: twenty seconds.',
    cannon: 'The cannon is a cloud, head-high. Stand under it as an ember or a blaze; a spark runs under it unharmed.',
    mouth: 'The kiln door opens for ten seconds when this fuse burns out. Water between: be a spark, and ride.',
  },
  signals: { openD: { latch: 'hotD' } },
  pieces: [...match, ...shutter, ...sync, ...count, ...mouth],
};
