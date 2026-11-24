// Fire 12 - "The Great Chimney". The finale. The works' great chimney has gone cold; three burners
// have to be lit before it will draw, and then Cinder rides the draught to the top. Everything the
// road has taught is asked for once:
//   1. The Stokehole    ember and blaze: planks to burn, a low beam only an ember passes, an ice wall to
//                       melt, a pool to boil. The lantern at the end lights the FIRST burner.
//   2. The Wire Gallery drips to time, then a fuse starts a clock: a spark rides two wires over two pools
//                       and reaches the shutter while it is open. The socket behind it lights the SECOND.
//   3. The Flue         smoke: through a grate, up the flue on its draught, into the loft. A closet off
//                       the shaft holds a stone only smoke can reach.
//   4. The Cold Store   the ice house: its first room is frozen (no blaze lives in frost) until the boiler fuse
//                       lit back in the Wire Gallery has burned out. Then a stretch with no brazier: two
//                       six-metre pools, two thick walls of ice, one coal and a low beam. Heat is a budget.
//   5. The Gas Gallery  a ladder of launches, a form on every rung (ember on a plate, spark in a
//                       pocket, blaze on a sensor), then a lift that runs while a plate is held.
//   6. The Chimney      the last burner wants a blaze on the heat sensor. When it lights, the chimney
//                       draws and the blaze rises to a ledge, where a second sensor must be lit before the
//                       upper draught draws it to the rim.
// Layout runs along +X, then up; areas are written in local coordinates and shifted into place.
// See LEVELS.md section 10.

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
function gate(id, x, on, time = 2, y = 0) {
  return [
    { type: 'block', box: [x, y, -4, x + 0.4, y + 3.6, -1.2], mat: 'brick' },
    { type: 'block', box: [x, y, 1.2, x + 0.4, y + 3.6, 4], mat: 'brick' },
    { type: 'block', box: [x, y + 3, -1.2, x + 0.4, y + 3.6, 1.2], mat: 'brick' },
    { type: 'door', id, box: [x + 0.03, y, -1.2, x + 0.37, y + 3, 1.2], on, time },
  ];
}

// where each area starts (world x). The proof script imports these.
export const O = { stoke: 0, wire: 112, flue: 186, cold: 250, gas: 326, chim: 391, end: 440 };

// ==================================================================== 1. the Stokehole (x -4..112)
const stoke = [
  { type: 'block', box: [-4, -1, -4, 54, 0, 4], mat: 'tile' },
  { type: 'block', box: [62, -1, -4, 112, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
  { type: 'prop', kind: 'kiln', pos: [4, 0, -3.8], rot: 0, scale: 1.6, solid: false },
  { type: 'prop', kind: 'pots', pos: [1.6, 0, 3.3] },
  { type: 'prop', kind: 'lamp', pos: [-1.6, 0, -3.5] },
  { type: 'brazier', id: 'b1', pos: [3, 0, 0] },
  { type: 'shard', pos: [7, 0.7, 2.8] },                                      // 1: easy
  { type: 'hint', key: 'planks', box: [8, 0, -4, 11.6, 3, 4] },
  { type: 'wood', id: 'planks', kind: 'plank', box: [12, 0, -4, 12.4, 3, 4] },
  { type: 'brazier', id: 'b1b', pos: [17, 0, 0] },
  { type: 'prop', kind: 'pipe', pos: [20, 0, 3.6], rot: 0 },
  { type: 'hint', key: 'beam', box: [20, 0, -4, 23.6, 3, 4] },
  { type: 'block', box: [24, 0.8, -4, 26.4, 3.6, 4], mat: 'brick' },
  { type: 'brazier', id: 'b1c', pos: [32, 0, 0] },
  { type: 'coal', pos: [34, 0.5, 2.6] },
  { type: 'hint', key: 'ice', box: [34, 0, -4, 37.6, 3, 4] },
  { type: 'iceblock', id: 'ice', box: [40, 0, -4, 40.6, 3, 4], melt: 1.5 },
  { type: 'brazier', id: 'b1d', pos: [46, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [48, 0, -3.5] },
  { type: 'hint', key: 'pool', box: [48, 0, -4, 51.6, 3, 4] },
  { type: 'block', box: [54, -1.3, -4, 62, -0.5, 4], mat: 'dark' },
  { type: 'pool', id: 'pool', box: [54, -0.5, -4, 62, -0.08, 4], boil: 3.5 },
  { type: 'brazier', id: 'b1e', pos: [66, 0, 0] },
  { type: 'prop', kind: 'shelf', pos: [70, 0, 3.55], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [72, 0, -3.3] },
  // a second low beam and a second wall of ice: the same two lessons, one after the other
  { type: 'hint', key: 'beam2', box: [70, 0, -4, 73.6, 3, 4] },
  { type: 'block', box: [74, 0.8, -4, 76.4, 3.6, 4], mat: 'brick' },
  { type: 'brazier', id: 'b1f', pos: [80, 0, 0] },
  { type: 'iceblock', id: 'ice2', box: [86, 0, -4, 86.6, 3, 4], melt: 1.5 },
  { type: 'brazier', id: 'b1g', pos: [92, 0, 0] },
  { type: 'prop', kind: 'kiln', pos: [98, 0, -3.8], rot: 0, scale: 1.4, solid: false },
  { type: 'hint', key: 'burner', box: [92, 0, -4, 96, 3, 4] },
  { type: 'lantern', id: 'lampA', pos: [100, 0.95, 0], emit: 'lampA' },
  { type: 'fire', id: 'burnerA', box: [98, 0, 2.6, 106, 2.4, 4], on: 'burnA' },
  ...gate('doorA', 108, 'burnA', 2.5),
];

// ==================================================================== 2. the Wire Gallery (x 112..186)
const wire = shift(O.wire, [
  { type: 'block', box: [0, -1, -4, 4, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2', pos: [2, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'drip', box: [2.6, 0, -4, 4.8, 3, 4] },
  // the set-up: a long fuse is lit here and burns for about forty seconds along the wall, to the boiler. Its payoff is two areas on
  { type: 'hint', key: 'boiler', box: [0.2, 0, -4, 2.6, 3, 4] },
  { type: 'fuse', id: 'fuseW', path: [[3.2, 0.06, -1.4], [3.6, 0.06, -3.8], [3.6, 3.8, -3.9], [74, 3.8, -3.9]], rate: 2.0, regrow: 4, emit: 'fuseW' },
  // the causeway: a 1.5 m walkway between two tanks, under five dripping pipes
  { type: 'block', box: [4, -1.2, -4, 19, -0.6, 4], mat: 'dark' },
  { type: 'block', box: [4, -1, -0.75, 19, 0, 0.75], mat: 'cream' },
  { type: 'pool', id: 'tankN', box: [4, -0.6, 0.75, 19, -0.1, 4] },
  { type: 'pool', id: 'tankS', box: [4, -0.6, -4, 19, -0.1, -0.75] },
  { type: 'drip', id: 'd1', pos: [6.5, 3, 0], period: 1.6, offset: 0 },
  { type: 'drip', id: 'd2', pos: [9, 3, 0], period: 1.6, offset: 0.55 },
  { type: 'drip', id: 'd3', pos: [11.5, 3, 0], period: 1.6, offset: 1.1 },
  { type: 'drip', id: 'd4', pos: [14, 3, 0], period: 1.6, offset: 0 },
  { type: 'drip', id: 'd5', pos: [16.5, 3, 0], period: 1.6, offset: 0.55 },
  // the landing: a spray tunnel with a lantern (a fuse runs the valve), the shutter fuse, two wires over two pools
  { type: 'block', box: [19, -1, -4, 34, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2b', pos: [22, 0, -1.6] },
  { type: 'prop', kind: 'lamp', pos: [20, 0, -3.5] },
  { type: 'prop', kind: 'pipe', pos: [30, 0, 3.6], rot: 0 },
  { type: 'hint', key: 'valve2', box: [27.8, 0, -4, 31, 3, 1.4] },
  { type: 'fuse', id: 'fuseV', path: [[30, 0.06, -3.4], [30, 0.06, -0.6], [23.5, 0.06, -0.6]], rate: 2.4, regrow: 6, emit: 'fuseV' },
  { type: 'block', box: [21, 0, 1.8, 27.2, 3.6, 2.2], mat: 'brick' },
  { type: 'block', box: [27, 0, 2.2, 27.4, 3.6, 4], mat: 'brick' },
  { type: 'sprinkler', id: 'tunnel', box: [21.2, 0, 2.2, 27, 3.2, 4], on: '!fuseV' },
  { type: 'lantern', id: 'lampG', pos: [26.2, 0.95, 3.1], emit: 'lampG' },
  { type: 'hint', key: 'shutter', box: [28, 0, 1.6, 33, 3, 4] },
  { type: 'fuse', id: 'fuseS', path: [[32, 0.06, -3], [32, 0.06, 3], [34, 0.06, 3]], rate: 2.0, regrow: 6, emit: 'fuseS' },
  { type: 'terminal', id: 'q1a', pos: [33, 0, 0] },
  { type: 'terminal', id: 'q1b', pos: [41, 0, 0] },
  { type: 'block', box: [34, -1.2, -4, 40, -0.6, 4], mat: 'dark' },
  { type: 'pool', id: 'pool1', box: [34, -0.6, -4, 40, -0.1, 4] },
  { type: 'wire', id: 'w1', from: 'q1a', to: 'q1b', speed: 10, on: 'lampG', via: [[33.6, 2.4, 0], [36, 3.0, 0], [40.4, 2.4, 0]] },
  { type: 'block', box: [40, -1, -3, 46, 0, 3], mat: 'cream' },
  { type: 'terminal', id: 'q2a', pos: [45, 0, 0] },
  { type: 'terminal', id: 'q2b', pos: [53, 0, 0] },
  { type: 'block', box: [46, -1.2, -4, 52, -0.6, 4], mat: 'dark' },
  { type: 'pool', id: 'pool2', box: [46, -0.6, -4, 52, -0.1, 4] },
  { type: 'wire', id: 'w2', from: 'q2a', to: 'q2b', speed: 10, via: [[45.6, 2.4, 0], [48, 3.0, 0], [52.4, 2.4, 0]] },
  { type: 'block', box: [52, -1, -4, 56, 0, 4], mat: 'tile' },
  { type: 'coal', pos: [54.4, 0.5, 2.6] },
  ...gate('shutter', 56, 'fuseS', 1),
  // behind the shutter: the second burner's socket
  { type: 'block', box: [56.4, -1, -4, 74, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2c', pos: [59, 0, 2.4] },
  { type: 'terminal', id: 'sockB', pos: [63, 0, 0], emit: 'sockB' },
  { type: 'fire', id: 'burnerB', box: [64, 0, 2.6, 72, 2.4, 4], on: 'burnB' },
  { type: 'hint', key: 'socket', box: [59, 0, -4, 62, 3, 4] },
  { type: 'prop', kind: 'kiln', pos: [68, 0, -3.8], rot: 0, scale: 1.4, solid: false },
  ...gate('doorB', 70, 'burnB', 2.5),
]);

// ==================================================================== 3. the Flue (x 186..250)
const flue = shift(O.flue, [
  { type: 'block', box: [0, -1, -4, 64, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b3', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'smoke', box: [4, 0, -4, 10, 3, 4] },
  // the flue: walls, a grate at its foot (smoke passes, an ember does not), a draught from y 5.4 up
  { type: 'block', box: [14, 0, -1.5, 14.4, 10.4, -4], mat: 'brick' },
  { type: 'block', box: [14, 0, 1.5, 14.4, 10.4, 4], mat: 'brick' },
  { type: 'block', box: [14, 2.6, -1.5, 14.4, 10.4, 1.5], mat: 'brick' },
  { type: 'grate', id: 'footGrate', box: [14, 0, -1.5, 14.4, 2.6, 1.5] },
  { type: 'block', box: [14, 0, -4.4, 20, 10.4, -4], mat: 'brick' },
  { type: 'block', box: [14, 0, 4, 16, 10.4, 4.4], mat: 'brick' },
  { type: 'block', box: [18, 0, 4, 20, 10.4, 4.4], mat: 'brick' },
  { type: 'block', box: [16, 0, 4, 18, 2.2, 4.4], mat: 'brick' },
  { type: 'block', box: [16, 6.4, 4, 18, 10.4, 4.4], mat: 'brick' },
  { type: 'grate', id: 'closetGrate', box: [16, 2.2, 4, 18, 6.4, 4.4] },
  { type: 'block', box: [14, 10, -4.4, 20, 10.4, 4.4], mat: 'brick' },
  { type: 'block', box: [19.6, 0, -4, 20, 9, 4], mat: 'brick' },
  { type: 'block', box: [19.6, 10, -4, 20, 12.4, 4], mat: 'brick' },
  { type: 'grate', id: 'topGrate', box: [19.6, 9, -1.8, 20, 10, 1.8] },
  { type: 'block', box: [19.6, 9, -4, 20, 10, -1.8], mat: 'brick' },
  { type: 'block', box: [19.6, 9, 1.8, 20, 10, 4], mat: 'brick' },
  { type: 'fan', id: 'draught', box: [14.4, 5.4, -3.6, 19.6, 9.8, 3.6], dir: '+y', strength: 5 },
  { type: 'coal', pos: [16.5, 0.5, -2.4] },                                 // a smoke that runs dry in the flue falls to an ember in it: this gets it out again
  // the closet off the shaft: a stone, only smoke gets in
  { type: 'block', box: [15.6, 1.8, 4.4, 16, 6.8, 7.4], mat: 'brick' },
  { type: 'block', box: [18, 1.8, 4.4, 18.4, 6.8, 7.4], mat: 'brick' },
  { type: 'block', box: [15.6, 1.8, 7, 18.4, 6.8, 7.4], mat: 'brick' },
  { type: 'block', box: [15.6, 6.4, 4.4, 18.4, 6.8, 7.4], mat: 'brick' },
  { type: 'coal', pos: [17, 2.7, 6.6] },
  { type: 'block', box: [15.6, 1.8, 4.4, 18.4, 2.2, 7.4], mat: 'brick' },
  { type: 'shard', pos: [17, 5.2, 5.2] },                                     // 2: smoke only
  { type: 'hint', key: 'closet', box: [10, 0, -4, 13.6, 3, 4] },
  // the loft: a floor at y 9, a roof, a brazier, and a lantern that opens the way on
  { type: 'block', box: [20, 8.6, -4, 64, 9, 4], mat: 'metal' },
  { type: 'block', box: [20, 12, -4, 38, 12.4, 4], mat: 'metal' },
  { type: 'brazier', id: 'b3b', pos: [24, 9, 0] },
  { type: 'lantern', id: 'lampC', pos: [33, 9.95, 0], emit: 'lampC' },
  { type: 'fuse', id: 'fuseL', path: [[22.4, 9.06, -3.2], [28.4, 9.06, -3.2], [28.4, 9.06, -1.2]], rate: 2.0, regrow: 4, emit: 'fuseL' },
  { type: 'sprinkler', id: 'curtain', box: [29.6, 9, -4, 31.6, 12, 4], on: '!fuseL' },
  { type: 'hint', key: 'valve', box: [26, 9, -4, 29.4, 12, 4] },
  { type: 'hint', key: 'loft', box: [20.6, 9, -4, 25, 12, 4] },
  { type: 'block', box: [36, 9, -4, 36.4, 12, -1.2], mat: 'brick' },
  { type: 'block', box: [36, 9, 1.2, 36.4, 12, 4], mat: 'brick' },
  { type: 'door', id: 'doorC', box: [36.03, 9, -1.2, 36.37, 12, 1.2], on: 'lampC', time: 2 },
]);

// ==================================================================== 4. the Cold Store (x 250..326)
// The loft's floor runs on into the old ice house. Its first room is frozen (frost, until the boiler fuse from the Wire Gallery
// has burned out), then a stretch with no brazier: two six-metre pools, two thick walls of ice and one coal, a low beam to finish.
const cold = shift(O.cold, [
  { type: 'block', box: [-1, 8.6, -4, 40, 9, 4], mat: 'metal' },
  { type: 'block', box: [40, 7.7, -4, 46.4, 8.5, 4], mat: 'dark' },
  { type: 'pool', id: 'poolC1', box: [40, 8.5, -4, 46.4, 8.92, 4], boil: 3.5 },
  { type: 'block', box: [46.4, 8.6, -4, 58, 9, 4], mat: 'metal' },
  { type: 'block', box: [58, 7.7, -4, 64.4, 8.5, 4], mat: 'dark' },
  { type: 'pool', id: 'poolC2', box: [58, 8.5, -4, 64.4, 8.92, 4], boil: 3.5 },
  { type: 'block', box: [64.4, 8.6, -4, 77, 9, 4], mat: 'metal' },
  { type: 'brazier', id: 'bC', pos: [2, 9, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 9, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 9, 3.5] },
  { type: 'hint', key: 'cold', box: [3, 9, -4, 8, 12, 4] },
  // the frozen room: no flame lives in frost, and the ice at its far end wants a flame
  { type: 'frost', id: 'frost1', box: [8, 9, -4, 31.6, 12.4, 4], on: '!warm' },
  { type: 'prop', kind: 'pipe', pos: [14, 9, 3.6], rot: 0 },
  { type: 'prop', kind: 'shelf', pos: [20, 9, 3.55], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [26, 9, -3.3] },
  { type: 'hint', key: 'frost', box: [22, 9, -4, 28, 12, 4] },
  { type: 'iceblock', id: 'iceC1', box: [31, 9, -4, 31.6, 12, 4], melt: 1.5 },
  // the stretch: heat is all there is. A pool boils for two heat and a blaze spends heat crossing it; every wall takes a melt
  { type: 'brazier', id: 'bC2', pos: [35, 9, 0] },
  { type: 'hint', key: 'budget', box: [33, 9, -4, 38.4, 12, 4] },
  { type: 'coal', pos: [55.4, 9.5, 2.6], heat: 5 },
  { type: 'coal', pos: [65.8, 9.5, 2.6], heat: 5 },                            // the second lump, by the last wall of ice: a planner who is slow still finds it
  { type: 'iceblock', id: 'iceC2', box: [52, 9, -4, 52.6, 12, 4], melt: 3 },
  { type: 'iceblock', id: 'iceC3', box: [68, 9, -4, 68.6, 12, 4], melt: 3 },
  { type: 'block', box: [71.2, 9.8, -4, 73.6, 12.6, 4], mat: 'brick' },                  // a low beam: an ember passes, a blaze does not
  { type: 'prop', kind: 'kiln', pos: [74, 9, -3.8], rot: 0, scale: 1.2, solid: false },
]);

// ==================================================================== 5. the Gas Gallery (x 326..391)
const gas = shift(O.gas, [
  { type: 'block', box: [-1, 8.6, -4, 40, 9, 4], mat: 'metal' },
  { type: 'brazier', id: 'b4', pos: [3, 9, 0] },
  { type: 'hint', key: 'ladder', box: [4.5, 9, -4, 9, 12, 4] },
  // rung 1: a plate in a pocket (ember)
  { type: 'plate', id: 'plateL', pos: [10, 9, 0], size: [1.6, 1.6], emit: 'padL' },
  { type: 'gas', id: 'gasL', box: [9, 9, -0.9, 11, 10.4, 0.9], launch: [5, 15, 0], radius: 0.5, refill: 3, on: { delay: 'padL', for: 0.8 } },
  { type: 'block', box: [14, 11.8, -3, 22, 12.2, 3], mat: 'metal' },
  { type: 'brazier', id: 'b4a', pos: [16, 12.2, 0] },
  { type: 'hint', key: 'socket2', box: [14.4, 12.2, -3, 22, 15, 3] },
  // rung 2: a pocket with a socket in it (spark)
  { type: 'terminal', id: 't1', pos: [19.4, 12.2, 0], emit: 's1' },
  { type: 'gas', id: 'gasS', box: [18.4, 12.2, -1, 20.6, 13.6, 1], launch: [8.5, 15, 0], radius: 0.5, refill: 3, on: { delay: 's1', for: 0.6 } },
  { type: 'block', box: [30, 15.6, -3, 46, 16, 3], mat: 'metal' },
  { type: 'brazier', id: 'b4b', pos: [32, 16, 0] },
  { type: 'hint', key: 'sensor2', box: [36, 16, -3, 40, 19, 3] },
  // rung 3: a heat sensor in a pocket (blaze)
  { type: 'heatsensor', id: 'hsV', box: [41, 16, -1.2, 43, 18.4, 1.2], emit: 'hotV' },
  { type: 'gas', id: 'gasV', box: [41, 16, -1.2, 43, 17.6, 1.2], launch: [6.5, 15, 0], radius: 0.5, refill: 3, on: { delay: 'hotV', for: 0.9 } },
  // the top rung and the lift: stand on the plate, step on the deck, ride
  { type: 'block', box: [52, 19.4, -4, 62, 19.8, 4], mat: 'metal' },
  { type: 'block', box: [65, 19.4, -4, 70, 19.8, 4], mat: 'metal' },
  { type: 'block', box: [62, 19.4, -4, 65, 19.8, -1.5], mat: 'metal' },
  { type: 'block', box: [62, 19.4, 1.5, 65, 19.8, 4], mat: 'metal' },
  { type: 'block', box: [62, 18.6, -1.5, 65, 19.0, 1.5], mat: 'dark' },
  { type: 'brazier', id: 'b4c', pos: [55, 19.8, 0] },
  { type: 'plate', id: 'plateLift', pos: [58.6, 19.8, -2.4], size: [1.6, 1.6], emit: 'liftPlate' },
  { type: 'hint', key: 'lift', box: [53, 19.8, -4, 61, 23, 4] },
  { type: 'mover', id: 'lift', box: [62, 19.4, -1.5, 65, 19.8, 1.5], to: [0, 11.2, 0], speed: 1.2, mode: 'toggle', on: 'liftUp', mat: 'metal' },
]);

// ==================================================================== 6. the Chimney (x 391..440)
const chim = shift(O.chim, [
  { type: 'block', box: [0, 30.6, -6, 18, 31, 6], mat: 'metal' },
  { type: 'brazier', id: 'b5', pos: [2.4, 31, 3.4] },
  { type: 'hint', key: 'chimney', box: [0.4, 31, -6, 5, 34, 6] },
  { type: 'hint', key: 'burn', box: [5, 31, -6, 7, 34, 6] },
  // the throat: walls, a roof with an opening to the east at the top, and the sensor on the floor of it
  { type: 'block', box: [6, 31, -4.4, 14, 101, -4], mat: 'brick' },
  { type: 'block', box: [6, 31, 4, 14, 101, 4.4], mat: 'brick' },
  { type: 'block', box: [13.6, 31, -4, 14, 97, 4], mat: 'brick' },
  { type: 'block', box: [6, 101, -4.4, 14, 101.4, 4.4], mat: 'brick' },
  { type: 'block', box: [13.6, 101, -4, 14, 101.4, 4], mat: 'brick' },
  { type: 'heatsensor', id: 'hsC', box: [8, 31, -1.5, 12, 33.4, 1.5], emit: 'hotC' },
  // the lower draught lifts a blaze as far as a ledge (the stone is on the way); fires along it feed the blaze
  { type: 'fan', id: 'draw', box: [6.4, 31, -3.6, 13.6, 60, 3.6], dir: '+y', strength: 7.4, on: 'lit' },
  { type: 'fire', id: 'fireLo', box: [6.4, 33, -3.6, 13.6, 39, 3.6], on: 'lit' },
  { type: 'fire', id: 'fireMid', box: [6.4, 48, -3.6, 13.6, 54, 3.6], on: 'litMid' },
  { type: 'shard', pos: [7.2, 44, 3.0] },                                     // 3: in the throat, against the wall
  // the ledge: half the width of the throat, a brazier, and the SECOND sensor. The draught above only draws once it has lit.
  { type: 'block', box: [6, 59.6, -4, 14, 60, -0.4], mat: 'metal' },
  { type: 'brazier', id: 'b5c', pos: [11.8, 60, -3.2] },
  { type: 'hint', key: 'ledge', box: [6.4, 60, -4, 13.6, 63, -0.4] },
  { type: 'heatsensor', id: 'hsD', box: [10.4, 60, -4.0, 13.2, 62.4, -0.8], emit: 'hotD' },
  // the upper draught: taller, with two more fires and a spray to cross; it carries the blaze to the rim
  { type: 'fan', id: 'draw2', box: [6.4, 60, -3.6, 13.6, 100.6, 3.6], dir: '+y', strength: 7.4, on: 'liftB' },
  { type: 'fire', id: 'fireHi', box: [6.4, 64, -3.6, 13.6, 70, 3.6], on: 'liftB' },
  // the rain falls on the west two thirds of the throat; the east third (x 10.2-13.6) is dry, and a cold draught across the whole width turns smoke back,
  // so the dry column is a place for a falling ember to land, not a way for smoke to skip the climb
  { type: 'sprinkler', id: 'rain', box: [6.4, 74, -3.6, 10.2, 76, 3.6] },
  { type: 'cold', box: [6.4, 72, -3.6, 13.6, 78, 3.6] },
  { type: 'hint', key: 'rain', box: [6.4, 66, -3.6, 13.6, 73, 3.6] },
  { type: 'fire', id: 'fireTop', box: [6.4, 82, -3.6, 13.6, 88, 3.6], on: 'liftBMid' },
  // the rim: where the draught lets go
  { type: 'block', box: [14, 96.6, -4, 28, 97, 4], mat: 'metal' },
  { type: 'brazier', id: 'b5b', pos: [17, 97, 0] },
  { type: 'block', box: [27.6, 97, -4, 28, 100.6, 4], mat: 'brick' },
  { type: 'exit', pos: [24.4, 97, 0], face: '-x' },
]);

export default {
  id: 'f12',
  element: 'fire',
  name: 'The Great Chimney',
  chapter: 3,
  theme: 'wire',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  killY: -9,
  areas: [
    { name: 'The Stokehole', box: [-4, -4, O.wire, 4] },
    { name: 'The Wire Gallery', box: [O.wire, -4, O.flue, 4] },
    { name: 'The Flue', box: [O.flue, -4.4, O.cold, 7.4] },
    { name: 'The Cold Store', box: [O.cold, -4, O.gas, 4] },
    { name: 'The Gas Gallery', box: [O.gas, -4, O.chim, 4] },
    { name: 'The Chimney', box: [O.chim, -6, O.end, 6] },
  ],
  hints: {
    start: 'The great chimney has gone cold. Light its three burners, then ride the draught to the top.',
    planks: 'Planks bar the way. {blaze} to burn them: a blaze lives on what it lights.',
    beam: 'A beam too low for a flame. {ember} to settle back and duck under.',
    beam2: 'Another beam, and past it another wall of ice: ember to duck, blaze to melt.',
    ice: 'A wall of ice. A blaze melts it if it stands close enough, long enough.',
    pool: 'A pool, eight metres wide. A blaze boils it for a moment; wade across and climb out.',
    burner: 'The first burner waits on that lantern. Any flame but smoke will light it.',
    drip: 'Five pipes, five rhythms. Watch a drop land, then go.',
    valve2: 'A spray tunnel with a lantern at its end, and a fuse that runs to the valve. The lantern wakes the first wire.',
    shutter: 'Light this fuse: when it burns out the shutter opens for six seconds. Two wires and two pools between.',
    socket: 'The second burner draws from this socket. A spark sitting on it lights it for good.',
    smoke: '{smoke} to rise as smoke: it passes the grate and the draught up the flue takes it to the loft.',
    closet: 'A closet off the flue, a stone inside. Only smoke can slip through that grate.',
    loft: 'Smoke cannot light a lantern or a fuse. {ember} once you are in the loft.',
    valve: 'A curtain of spray before the lantern, and a fuse that runs to its valve. Light it and be quick.',
    boiler: 'A fuse starts here and runs the length of the gallery. Light it: it burns a long time, and its end is needed later.',
    cold: 'The ice house. Its first room is frozen: no flame lives in frost until the boiler is warm. Did the fuse burn out?',
    frost: 'No blaze lives in frost, and the ice at the far end wants one. The room thaws when the Wire Gallery fuse burns out.',
    budget: 'No brazier from here. Pools and ice want a blaze, and a blaze burns heat: be an ember between, take the coal when low.',
    ladder: 'Three rungs, three forms: an ember on the plate, a spark in the pocket, a blaze on the sensor.',
    socket2: 'The pocket holds a socket: a spark that enters it is thrown to the next rung.',
    sensor2: 'Last rung: a flame on the sensor sets the gas off. {blaze} and stand still.',
    lift: 'The lift runs while the plate is held, and for a few seconds after. Press the plate, then step aboard.',
    chimney: 'The last burner wants a real flame. {blaze} and stand on the sensor in the throat.',
    burn: 'When the third burner takes, the chimney draws. Let it carry you up; there is a ledge on the way.',
    rain: 'Rain falls on the west side of the throat. The east third is dry: if the flame gives out, fall there.',
    ledge: 'A ledge, a brazier, and a second sensor: the draught above will not draw until a blaze has lit it. Steer to the ledge.',
  },
  signals: {
    warm: { latch: 'fuseW' },
    burnA: { latch: 'lampA' },
    burnB: { latch: 'sockB' },
    burnC: { latch: 'hotC' },
    lit: { and: ['burnA', 'burnB', 'burnC'] },
    litMid: { delay: 'lit', for: 1.2 },
    burnD: { latch: 'hotD' },
    liftB: { and: ['lit', 'burnD'] },
    liftBMid: { delay: 'liftB', for: 1.2 },
    liftOn: { hold: 'liftPlate', for: 17 },
    liftUp: { delay: 'liftOn', for: 2.6 },
  },
  pieces: [...stoke, ...wire, ...flue, ...cold, ...gas, ...chim],
};
