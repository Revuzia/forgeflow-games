// Fire 9 - "Brass Rail". Chapter 3 opens: SPARK and the wires. Cinder's smallest form is tiny, very
// fast and burns heat at twice the rate of a blaze, but it fits where nothing else does and a brass
// post will carry it down a wire. Five areas, each a new use of the same idea:
//   1. The Switchroom  an ember lights a lantern up on a ledge, a spark squeezes through a pinhole to
//                      light the other: the big door wants both (the safe lesson).
//   2. The Rail        a chasm with a wire across it; a socket that runs a lift for a few seconds
//                      (a spark powers it, an ember rides it: heat is for the part that needs it); a
//                      second wire from the gantry. A pier below holds a glow-stone.
//   3. The Cellar      drop through the grating, power a socket, ride the wire back up and run for the
//                      door before it shuts again (a `hold` signal is a timer).
//   4. The Gallery     drips to time, a fuse that shuts a valve, a lantern in the spray tunnel, a pool
//                      too wide to cross and two dead wires: one wakes with the lantern, the other
//                      with a socket out on the island.
//   5. The Kiln Door   two sockets with a pool between them: power the near one FIRST, ride over and
//                      power the far one, because the kiln door wants both windows open at once.
// Forms: ember and spark. Heat: a brazier at the start of every area, coal in every space an ember
// cannot leave. Layout runs along +X; areas are written in local coordinates and shifted into place.
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

// where each area starts (world x). The proof script imports these so that it never hard-codes a shifted number.
export const O = { sw: 0, rail: 52, cellar: 124, gallery: 152, kiln: 211, end: 314 };
const X2 = O.rail, X3 = O.cellar, X4 = O.gallery, X5 = O.kiln, XEND = O.end;

// ==================================================================== 1. the Switchroom (x -4..44)
const switchroom = [
  { type: 'block', box: [-4, -1, -4, 52, 0, 4], mat: 'tile' },
  { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
  { type: 'prop', kind: 'pots', pos: [2.2, 0, -3.3] },
  { type: 'prop', kind: 'lamp', pos: [0.6, 0, 3.4] },
  { type: 'prop', kind: 'shelf', pos: [16, 0, 3.55], rot: 0 },
  { type: 'prop', kind: 'kiln', pos: [42, 0, 3.3], rot: 0, solid: false },
  { type: 'prop', kind: 'lamp', pos: [30, 0, 3.5] },
  { type: 'brazier', id: 'b1', pos: [3, 0, 0] },
  { type: 'shard', pos: [6.6, 0.7, 2.8] },                                    // 1: easy, a step off the line
  // the first lantern: on a ledge an ember can jump to
  { type: 'hint', key: 'ledge', box: [7, 0, -4, 13, 3, 4] },
  { type: 'block', box: [11, 0, -3.8, 13.2, 1.2, -2.0], mat: 'cream' },
  { type: 'lantern', id: 'lamp0', pos: [12.1, 2.15, -2.9], emit: 'lamp0' },
  // the alcove: a partition with a pinhole 0.45 x 0.45, the second lantern, a lump of coal for a spark that runs dry
  { type: 'hint', key: 'pinhole', box: [19, 0, -2, 27, 3, 2.1] },
  { type: 'block', box: [21, 0, 2.0, 23.275, 3.6, 2.2], mat: 'brick' },
  { type: 'block', box: [23.725, 0, 2.0, 27, 3.6, 2.2], mat: 'brick' },
  { type: 'block', box: [23.275, 0.45, 2.0, 23.725, 3.6, 2.2], mat: 'brick' },
  // two low stops either side of the pinhole: a spark run along the partition into one of them stops with its middle in the hole's line,
  // so a key (which cannot nudge a spark 0.1 m) can line it up: it slides to the stop, then goes through
  { type: 'block', box: [23.665, 0, 1.5, 24.4, 0.9, 2.0], mat: 'cream' },
  { type: 'block', box: [22.4, 0, 2.2, 23.31, 0.9, 2.9], mat: 'cream' },
  { type: 'block', box: [21, 0, 2.2, 21.2, 3.6, 3.8], mat: 'brick' },
  { type: 'block', box: [26.8, 0, 2.2, 27, 3.6, 3.8], mat: 'brick' },
  { type: 'block', box: [21, 0, 3.8, 27, 3.6, 4.0], mat: 'brick' },
  { type: 'lantern', id: 'lamp1', pos: [25.6, 0.95, 3.0], r: 1.5, emit: 'lamp1' },
  { type: 'coal', pos: [22.2, 0.5, 3.5] },
  { type: 'coal', pos: [24.9, 0.5, 2.5] },                                    // along the partition on the way back to the pinhole: the last of the four lumps in here
  { type: 'coal', pos: [23.5, 0.5, 3.0] },                                    // straight through the pinhole: a spark that has just squeezed in gets heat for the lantern
  { type: 'coal', pos: [24.6, 0.5, 3.5] },                                    // a second lump on the way to the lantern: a spark in a room it cannot walk out of
  // the third lantern: on a switch cabinet three metres up. A wire climbs to it.
  { type: 'hint', key: 'rise', box: [27, 0, -4, 31.6, 3, 0] },
  { type: 'coal', pos: [28.8, 0.5, -1.5] },                                   // at the foot of the climb: a spark that has been through the alcove has heat for the wire
  { type: 'terminal', id: 'hA', pos: [30.2, 0, -2.2] },
  { type: 'terminal', id: 'hB', pos: [33.4, 3, -2.3] },
  { type: 'wire', id: 'climb', from: 'hA', to: 'hB', speed: 5, via: [[30.8, 1.5, -2.2], [32.2, 3.4, -2.3]] },
  { type: 'block', box: [32.2, 0, -3.8, 35.8, 3, -0.8], mat: 'metal' },
  { type: 'lantern', id: 'lamp2', pos: [34.8, 3.9, -2.3], r: 1.5, emit: 'lamp2' },
  // the fourth lantern: two towers, a wire between them. An ember climbs the first; a spark rides to the top of the second.
  { type: 'hint', key: 'tower', box: [37, 0, -4, 41, 3, 4] },
  { type: 'block', box: [40, 0, -3.8, 43, 1.2, -0.8], mat: 'cream' },
  { type: 'block', box: [45.5, 0, -3.8, 48.5, 3.4, -0.8], mat: 'metal' },
  { type: 'terminal', id: 'tA', pos: [41.4, 1.2, -2.3] },
  { type: 'terminal', id: 'tB', pos: [46.6, 3.4, -2.3] },
  { type: 'wire', id: 'towers', from: 'tA', to: 'tB', speed: 6, via: [[42, 2.2, -2.3], [44, 4.2, -2.3], [46, 4.3, -2.3]] },
  { type: 'lantern', id: 'lamp3', pos: [47.9, 4.35, -2.3], r: 1.5, emit: 'lamp3' },
  // the big door: slow, and it wants all four lanterns
  { type: 'hint', key: 'gate', box: [44, 0, -4, 47.6, 3, 4] },
  { type: 'block', box: [51.6, 0, -4, 52, 3.6, -1.2], mat: 'brick' },
  { type: 'block', box: [51.6, 0, 1.2, 52, 3.6, 4], mat: 'brick' },
  { type: 'block', box: [51.6, 3, -1.2, 52, 3.6, 1.2], mat: 'brick' },
  { type: 'door', id: 'door1', box: [51.63, 0, -1.2, 51.97, 3, 1.2], on: 'both', time: 3 },
];

// ==================================================================== 2. the Rail (x 44..104)
const rail = shift(X2, [
  { type: 'block', box: [0, -1, -4, 8, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2', pos: [3, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [2, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [2, 0, 3.5] },
  { type: 'hint', key: 'rail', box: [4.5, 0, -1.6, 8, 3, 1.6] },
  { type: 'hint', key: 'pier', box: [4.5, 0, -4, 8, 3, -1.8] },
  // the first chasm (x 8..18) and its rail
  { type: 'terminal', id: 'rA', pos: [7.2, 0, 0] },
  { type: 'terminal', id: 'rB', pos: [18.8, 0, 0] },
  { type: 'wire', id: 'rail', from: 'rA', to: 'rB', speed: 8, via: [[8.2, 2.3, 0], [10, 3.1, 0], [16, 3.1, 0], [17.8, 2.3, 0]] },
  // a pier hanging in the dark below, with a glow-stone, and a second post that leads to it
  { type: 'terminal', id: 'pA', pos: [7.2, 0, -2.7] },
  { type: 'terminal', id: 'pB', pos: [11.2, -3.5, -2.7] },
  { type: 'wire', id: 'pierWire', from: 'pA', to: 'pB', speed: 9, via: [[8.4, 0.9, -2.7], [10.2, -2.0, -2.7]] },
  { type: 'block', box: [10.4, -4.5, -3.7, 13, -3.5, -1.7], mat: 'cream' },
  { type: 'shard', pos: [12.3, -2.85, -2.7] },                                // 2: off the path, on the pier
  // the landing: a socket, a coal, and a lift that runs while the socket is (or just was) powered
  { type: 'block', box: [18, -1, -4, 21.4, 0, 4], mat: 'tile' },
  { type: 'block', box: [21.4, -1, -4, 24, 0, 0.7], mat: 'tile' },
  { type: 'block', box: [21.4, -1, 3.3, 24, 0, 4], mat: 'tile' },
  { type: 'block', box: [21.4, -1, 0.7, 24, -0.5, 3.3], mat: 'dark' },
  { type: 'block', box: [24, -1, -4, 28, 0, 4], mat: 'tile' },
  { type: 'mover', id: 'lift', box: [21.4, -0.4, 0.7, 24, 0, 3.3], to: [0, 6, 0], speed: 1.6, mode: 'toggle', on: 'liftUp', mat: 'metal' },
  { type: 'terminal', id: 'sockL', pos: [20.2, 0, -2.2], emit: 'sockL' },
  { type: 'coal', pos: [20.4, 0.5, -0.8] },
  { type: 'hint', key: 'lift', box: [18.4, 0, -4, 22.4, 3, 0.5] },
  { type: 'prop', kind: 'lamp', pos: [26, 0, -3.5] },
  { type: 'prop', kind: 'pots', pos: [26.4, 0, 3.2] },
  // the gantry: a catwalk at y 6 with a brazier, and the post of the second wire
  { type: 'block', box: [24, 5.6, 0.7, 38, 6, 3.3], mat: 'metal' },
  { type: 'brazier', id: 'b2g', pos: [27, 6, 2] },
  { type: 'terminal', id: 'gA', pos: [37, 6, 2] },
  { type: 'hint', key: 'gantry', box: [24.4, 6, 0.7, 30, 9, 3.3] },
  // the second chasm (x 28..40) and the landing beyond it
  { type: 'terminal', id: 'gB', pos: [41.4, 0, 2] },
  { type: 'wire', id: 'gantryWire', from: 'gA', to: 'gB', speed: 8, via: [[38, 6.8, 2], [40.4, 3.4, 2]] },
  { type: 'block', box: [40, -1, -4, 52, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b2h', pos: [43, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [42, 0, 3.5] },
  // a third chasm (x 52..62): its rail is dull until the lantern on the ledge is lit
  { type: 'hint', key: 'dull', box: [40.6, 0, -4, 47, 3, 4] },
  { type: 'block', box: [44, 0, -3.8, 46.2, 1.2, -2.0], mat: 'cream' },
  { type: 'lantern', id: 'lampR', pos: [45.1, 2.15, -2.9], emit: 'lampR' },
  { type: 'terminal', id: 'rC', pos: [50.4, 0, 0] },
  { type: 'terminal', id: 'rD', pos: [62.6, 0, 0] },
  { type: 'wire', id: 'rail3', from: 'rC', to: 'rD', speed: 8, on: 'lampR', via: [[51, 2.4, 0], [54, 3.2, 0], [60, 3.2, 0], [62, 2.4, 0]] },
  { type: 'block', box: [62, -1, -4, 72, 0, 4], mat: 'tile' },
  { type: 'prop', kind: 'pots', pos: [66, 0, 3.3] },
  { type: 'prop', kind: 'pipe', pos: [69, 0, -3.5], rot: 0 },
]);

/// ==================================================================== 3. the Cellar (x 124..152)
const cellar = shift(X3, [
  // the hall floor is a thin slab so there is a room under it; the middle of it is a grating
  { type: 'block', box: [0, -0.4, -4, 5.6, 0, 4], mat: 'tile' },
  { type: 'block', box: [11.6, -0.4, -4, 27.6, 0, 4], mat: 'tile' },
  { type: 'block', box: [5.6, -0.4, 2.5, 11.6, 0, 4], mat: 'tile' },
  { type: 'block', box: [5.6, -0.4, -4, 11.6, 0, -2.5], mat: 'tile' },
  { type: 'slot', id: 'grating', box: [5.6, -0.4, -2.5, 11.6, 0, 2.5] },
  { type: 'brazier', id: 'b3', pos: [2.6, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1.6, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1.6, 0, 3.5] },
  { type: 'prop', kind: 'pipe', pos: [18, 0, -3.5], rot: 0 },
  { type: 'prop', kind: 'pots', pos: [23, 0, 3.3] },
  { type: 'hint', key: 'cellar', box: [3.2, 0, -4, 5.6, 3, 4] },
  // the cellar: floor, walls, the brazier under the grating
  { type: 'block', box: [1.6, -4.5, -4.4, 26.6, -3.5, 4.4], mat: 'dark' },
  { type: 'block', box: [1.6, -3.5, -4.4, 26.6, -0.4, -4], mat: 'dark' },
  { type: 'block', box: [1.6, -3.5, 4, 26.6, -0.4, 4.4], mat: 'dark' },
  { type: 'block', box: [1.6, -3.5, -4, 2, -0.4, 4], mat: 'dark' },
  { type: 'block', box: [26.2, -3.5, -4, 26.6, -0.4, 4], mat: 'dark' },
  { type: 'brazier', id: 'b3c', pos: [8.6, -3.5, 0] },
  { type: 'terminal', id: 'sockW', pos: [6.4, -3.5, 2.6], emit: 'sockW' },
  { type: 'prop', kind: 'lamp', pos: [3.6, -3.5, -3.4] },
  { type: 'prop', kind: 'pots', pos: [4, -3.5, 3.2] },
  { type: 'hint', key: 'socket', box: [10, -3.5, -4, 13.4, -0.4, 4] },
  // the partition with two pinholes: south to the first socket, north to the second
  { type: 'block', box: [13.6, -3.5, -4, 13.9, -0.4, -2.225], mat: 'brick' },
  { type: 'block', box: [13.6, -3.5, -1.775, 13.9, -0.4, 1.775], mat: 'brick' },
  { type: 'block', box: [13.6, -3.5, 2.225, 13.9, -0.4, 4], mat: 'brick' },
  { type: 'block', box: [13.6, -3.05, -2.225, 13.9, -0.4, -1.775], mat: 'brick' },
  { type: 'block', box: [13.6, -3.05, 1.775, 13.9, -0.4, 2.225], mat: 'brick' },
  // stops beside each pinhole, on both faces of the partition: slide along the partition toward the outer wall, stop in line, go through
  { type: 'block', box: [12.6, -3.5, -4, 13.6, -0.4, -2.14], mat: 'brick' },
  { type: 'block', box: [12.6, -3.5, 2.14, 13.6, -0.4, 4], mat: 'brick' },
  { type: 'block', box: [13.9, -3.5, -4, 14.9, -0.4, -2.14], mat: 'brick' },
  { type: 'block', box: [13.9, -3.5, 2.14, 14.9, -0.4, 4], mat: 'brick' },
  { type: 'block', box: [13.9, -3.5, -0.1, 26.2, -0.4, 0.1], mat: 'brick' },
  // south chamber: the first socket (long window) and a lump of coal for a spark that runs dry
  { type: 'terminal', id: 'sockS', pos: [18.6, -3.5, -2], emit: 'sockS' },
  { type: 'coal', pos: [16.1, -3.0, -1.7] },
  { type: 'prop', kind: 'pots', pos: [24, -3.5, -3.2] },
  // north chamber: the second socket (short window), the post of the wire back up, a cage with a glow-stone
  { type: 'terminal', id: 'sockN', pos: [16.6, -3.5, 2.6], emit: 'sockN' },
  { type: 'coal', pos: [15.2, -3.0, 1.9] },
  { type: 'terminal', id: 'upA', pos: [19.6, -3.5, 1.0] },
  { type: 'terminal', id: 'upB', pos: [19.6, 0, 1.0] },
  { type: 'wire', id: 'up', from: 'upA', to: 'upB', speed: 8, via: [[19.6, 1.6, 1.0]] },
  { type: 'block', box: [22.1, -3.5, 0.1, 22.4, -0.4, 1.4], mat: 'brick' },
  { type: 'block', box: [22.1, -3.5, 2.6, 22.4, -0.4, 4], mat: 'brick' },
  { type: 'door', id: 'cage', box: [22.13, -3.5, 1.4, 22.37, -0.4, 2.6], on: { or: ['win2', 'inCage'] } },
  { type: 'sensor', box: [22.4, -3.5, 0.1, 26.2, -0.4, 4], emit: 'inCage', visible: false },   // it never shuts a spark in
  { type: 'coal', pos: [23.6, -3.0, 2.8] },
  { type: 'shard', pos: [24.4, -2.8, 2.0] },                                  // 3: behind the cage
  { type: 'coal', pos: [21.4, 0.3, 0.7] },                                    // just out of the wire in the hall, on the run for the door: the spark is nearly out by now
  // the hall door: both windows at once
  { type: 'block', box: [27.6, 0, -4, 28, 3.6, -1.2], mat: 'brick' },
  { type: 'block', box: [27.6, 0, 1.2, 28, 3.6, 4], mat: 'brick' },
  { type: 'block', box: [27.6, 3, -1.2, 28, 3.6, 1.2], mat: 'brick' },
  { type: 'door', id: 'door3', box: [27.63, 0, -1.2, 27.97, 3, 1.2], on: 'cellarOpen', time: 1.5 },
  { type: 'hint', key: 'socket2', box: [20.6, 0, -4, 27.2, 3, 4] },
]);

// ==================================================================== 4. the Gallery (x 152..211)
const gallery = shift(X4, [
  { type: 'block', box: [0, -1, -4, 4, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b4', pos: [2, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [1, 0, 3.5] },
  { type: 'hint', key: 'drip', box: [2.6, 0, -4, 4.8, 3, 4] },
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
  // the landing: two dead posts, a fuse that shuts a valve, and a spray tunnel with a lantern at the end
  { type: 'block', box: [19, -1, -4, 41, 0, 4], mat: 'tile' },
  { type: 'prop', kind: 'lamp', pos: [20, 0, -3.5] },
  { type: 'prop', kind: 'pipe', pos: [24, 0, -3.6], rot: 0 },
  { type: 'hint', key: 'dead', box: [19.4, 0, -3.4, 24, 3, 1.4] },
  { type: 'hint', key: 'valve', box: [24.4, 0, -4, 29, 3, 1.4] },
  { type: 'coal', pos: [22.6, 0.5, -0.7] },                                   // by the dead posts: heat for the second wire after the first has been used
  { type: 'terminal', id: 'pa', pos: [21.4, 0, -1.6] },
  { type: 'terminal', id: 'pb', pos: [21.4, 0, 0.2] },
  { type: 'fuse', id: 'fuseV', path: [[27.4, 0.06, -3.4], [27.4, 0.06, -0.4], [24.8, 0.06, -0.4]], rate: 2.2, regrow: 6, emit: 'fuseV' },
  { type: 'block', box: [20.6, 0, 1.8, 26.8, 3.6, 2.2], mat: 'brick' },
  { type: 'block', box: [26.6, 0, 2.2, 27, 3.6, 4], mat: 'brick' },
  { type: 'sprinkler', id: 'tunnel', box: [20.8, 0, 2.2, 26.6, 3.2, 4], on: '!fuseV' },
  { type: 'lantern', id: 'lampG', pos: [25.8, 0.95, 3.1], emit: 'lampG' },
  // the second lantern: at the end of a crawlspace a spark fits and an ember does not, under a spray that pulses
  // (nine seconds, dry for the last five): dash in, light it, dash out
  { type: 'hint', key: 'pulse', box: [29.4, 0, -4, 33, 3, 1.4] },
  { type: 'block', box: [30, 0.45, -4, 40.4, 1.0, -2.0], mat: 'brick' },
  { type: 'block', box: [30, 0, -2.2, 40.4, 1.0, -2.0], mat: 'brick' },
  { type: 'block', box: [40, 0, -4, 40.4, 1.0, -2.0], mat: 'brick' },
  { type: 'sprinkler', id: 'crawlSpray', box: [30, 0, -4, 40, 3.2, -2.0], period: 9, duty: 0.45, offset: 0 },
  { type: 'lantern', id: 'lampH', pos: [39.2, 0.3, -3.0], mount: 'wall', emit: 'lampH' },
  { type: 'coal', pos: [31.2, 0.5, 3.0] },
  // the pool (14 m) and the island with two terminals: the end of wire A, and a socket
  { type: 'block', box: [41, -1.2, -4, 55, -0.6, 4], mat: 'dark' },
  { type: 'pool', id: 'pool', box: [41, -0.6, -4, 55, -0.1, 4] },
  { type: 'block', box: [47, -1, -1.6, 51.4, 0, 1.6], mat: 'cream' },
  { type: 'coal', pos: [49.2, 0.5, -0.6] },                                   // on the island between the two posts: heat for the ride back and the second wire
  { type: 'terminal', id: 'm1', pos: [48, 0, 0] },
  { type: 'terminal', id: 'sockM', pos: [50.4, 0, 0], emit: 'sockM' },
  { type: 'terminal', id: 'fb', pos: [56.6, 0, 1.8] },
  { type: 'wire', id: 'wa', from: 'pa', to: 'm1', speed: 8, on: 'lampG', via: [[22, 2.4, -1.2], [26, 3.2, -0.6], [46.6, 3.2, 0], [48, 2.2, 0]] },
  { type: 'wire', id: 'wb', from: 'pb', to: 'fb', speed: 8, on: { and: ['liveB', 'lampH'] }, via: [[22, 2.4, 0.4], [26, 3.4, 1.0], [54.8, 3.4, 1.8], [56.6, 2.4, 1.8]] },
]);

// ==================================================================== 5. the Kiln Door (x 211..314)
const kiln = shift(X5, [
  { type: 'block', box: [-4, -1, -4, 12, 0, 4], mat: 'tile' },
  { type: 'brazier', id: 'b5', pos: [0.6, 0, 0] },
  { type: 'prop', kind: 'lamp', pos: [-1, 0, -3.5] },
  { type: 'prop', kind: 'lamp', pos: [-1, 0, 3.5] },
  { type: 'prop', kind: 'pots', pos: [4, 0, 3.3] },
  { type: 'hint', key: 'kiln', box: [-0.4, 0, -4, 7, 3, 4] },
  { type: 'terminal', id: 'sock1', pos: [3.5, 0, -2.5], emit: 'sock1' },
  // the gauntlet: one long spray that pulses, dry for 3 s in every 5, behind a slotted wall: a spark runs under the wall and across, an ember cannot even start
  { type: 'hint', key: 'spray', box: [8, 0, -4, 12.4, 3, 4] },
  { type: 'block', box: [12, -1, -4, 32, 0, 4], mat: 'tile' },
  // a wall with a slot 0.45 m high along its whole foot: an ember cannot get under it or over it, a spark runs under
  { type: 'block', box: [12.2, 0.45, -4, 12.6, 3.6, 4], mat: 'brick' },
  { type: 'sprinkler', id: 'gauntlet', box: [13, 0, -4, 27, 3.4, 4], period: 5, duty: 0.4, offset: 0 },
  { type: 'prop', kind: 'pipe', pos: [18, 0, -3.7], rot: 0 },
  { type: 'prop', kind: 'pipe', pos: [24, 0, 3.7], rot: 0 },
  { type: 'terminal', id: 'pw1', pos: [29.6, 0, 0] },
  // the first pool, and the second socket on the platform beyond it
  { type: 'block', box: [32, -1.2, -4, 44, -0.6, 4], mat: 'dark' },
  { type: 'pool', id: 'pool2', box: [32, -0.6, -4, 44, -0.1, 4] },
  { type: 'block', box: [44, -1, -4, 74, 0, 4], mat: 'tile' },
  { type: 'terminal', id: 'sock2', pos: [45.6, 0, 0], emit: 'sock2' },
  { type: 'coal', pos: [62, 0.5, 0.3] },                                       // in the second gauntlet, on the line: a spark that crosses it picks up heat on the way
  { type: 'terminal', id: 'pw2', pos: [66.6, 0, 0] },
  { type: 'coal', pos: [47.4, 0.5, 2.6] },
  { type: 'wire', id: 'wc', from: 'pw1', to: 'sock2', speed: 8, via: [[30.2, 2.6, 0], [32.5, 3.4, 0], [43, 3.4, 0], [45, 2.6, 0]] },
  { type: 'prop', kind: 'lamp', pos: [47, 0, -3.5] },
  { type: 'hint', key: 'rush', box: [44.4, 0, -4, 48, 3, 4] },
  // a second gauntlet, longer and on its own beat (five seconds, dry for two): the second window is waiting
  { type: 'hint', key: 'spray2', box: [48, 0, -4, 51, 3, 4] },
  { type: 'block', box: [50.2, 0.45, -4, 50.6, 3.6, 4], mat: 'brick' },
  { type: 'sprinkler', id: 'gauntlet2', box: [51, 0, -4, 65, 3.4, 4], period: 5, duty: 0.4, offset: 1.5 },
  { type: 'prop', kind: 'pipe', pos: [56, 0, -3.7], rot: 0 },
  { type: 'prop', kind: 'pipe', pos: [60, 0, 3.7], rot: 0 },
  // the second pool, and the third socket beside the kiln door
  { type: 'block', box: [74, -1.2, -4, 86, -0.6, 4], mat: 'dark' },
  { type: 'pool', id: 'pool3', box: [74, -0.6, -4, 86, -0.1, 4] },
  { type: 'block', box: [86, -1, -4, 104, 0, 4], mat: 'tile' },
  { type: 'terminal', id: 'sock3', pos: [87.6, 0, 0], emit: 'sock3' },
  { type: 'coal', pos: [89.2, 0.5, 0.3] },                                       // on the run for the kiln door: the third window is short and the spark nearly spent
  { type: 'wire', id: 'wd', from: 'pw2', to: 'sock3', speed: 8, via: [[67.2, 2.6, 0], [74.5, 3.4, 0], [85, 3.4, 0], [87, 2.6, 0]] },
  { type: 'prop', kind: 'lamp', pos: [91, 0, -3.5] },
  { type: 'prop', kind: 'kiln', pos: [96, 0, 3.4], rot: 0, solid: false },
  { type: 'prop', kind: 'lamp', pos: [99, 0, 3.5] },
  { type: 'block', box: [102.4, 0, -4, 103, 3.6, 4], mat: 'brick' },
  { type: 'exit', pos: [100.4, 0, 0], face: '-x', on: 'kilnOpen' },
]);

export default {
  id: 'f09',
  element: 'fire',
  name: 'Brass Rail',
  chapter: 3,
  theme: 'wire',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember', 'spark'],
  killY: -9,
  areas: [
    { name: 'The Switchroom', box: [-4, -4, X2, 4] },
    { name: 'The Rail', box: [X2, -4, X3, 4] },
    { name: 'The Cellar', box: [X3, -4.4, X4, 4.4] },
    { name: 'The Gallery', box: [X4, -4, X5, 4] },
    { name: 'The Kiln Door', box: [X5, -4, XEND, 4] },
  ],
  hints: {
    start: 'The works is wired. {spark} for a spark: tiny, quick and hungry for heat. An ember is free.',
    ledge: 'A cold lantern on a ledge. An ember jumps; hold {jump} for height.',
    pinhole: 'A pinhole, too small for an ember. A spark fits, and a lantern waits inside.',
    rise: 'A wire can climb as well as cross. The lantern on the cabinet is out of reach of anything that cannot ride up.',
    tower: 'The last lantern tops the second tower. An ember climbs the first; a spark rides the wire across.',
    gate: 'The big door is slow, and it wants all four lanterns lit.',
    rail: 'A brass post carries a spark down its wire, and nothing can touch it on the way. Walk a spark up to one.',
    pier: 'A second post, a second wire, and a stone on the pier below. A wire runs both ways: touch the far post to ride back.',
    lift: 'A socket powers the lift only while a spark sits on it, and a few seconds after. A lift costs an ember nothing.',
    gantry: 'A spark spends heat; an ember does not. Refuel at the brazier, then take the wire from the end of the catwalk.',
    cellar: 'Slats in the floor: a spark drops through. Below, three sockets open the hall door while a spark sits on them.',
    socket: 'Three sockets, three timers, longest first: the one by the brazier, then south, then north. Then run.',
    socket2: 'The door needs both windows open together. A stone cage waits below: the second socket opens it too.',
    dull: 'The next rail is dull: its lantern is on the ledge. An ember can jump to it.',
    pulse: 'A crawlspace under a pulsing spray, a lantern at its end. A spark is fast enough: wait for the dry half.',
    drip: 'The pipes drip in a rhythm again. Watch a drop land, then go.',
    dead: 'Dull wires have no current. Wire A wants the tunnel lantern; wire B wants the island socket and the crawl lantern.',
    valve: 'The spray never stops on its own. That fuse runs to its valve: light it, then be quick.',
    kiln: 'The kiln door wants three sockets, each held open a while. Power the nearest first and keep going.',
    spray: 'This spray pulses. Dry for two seconds: a spark is quick enough to cross it, an ember is not.',
    spray2: 'A longer spray on a different beat. Wait as an ember: a waiting spark burns heat. Coal lies beside the socket.',
    rush: 'Each window is shorter than the last. Ride the next wire at once.',
  },
  signals: {
    both: { and: ['lamp0', 'lamp1', 'lamp2', 'lamp3'] },
    lifting: { hold: 'sockL', for: 11 },     // the landing socket holds the lift for eleven seconds...
    liftUp: { delay: 'lifting', for: 3.5 },  // ...and it starts three and a half seconds after the power comes on, so there is time to step aboard (a coal on the way, a few steps)
    win0: { hold: 'sockW', for: 16 },        // the cellar's first socket, by the brazier: the longest window
    win1: { hold: 'sockS', for: 11 },        // the second: a long one
    win2: { hold: 'sockN', for: 5.5 },       // the third: a short one. The door needs all three open at once
    cellarOpen: { and: ['win0', 'win1', 'win2'] },
    liveB: { latch: 'sockM' },               // the island socket wakes the far wire for good
    h1: { hold: 'sock1', for: 30 },
    h2: { hold: 'sock2', for: 20 },
    h3: { hold: 'sock3', for: 6 },
    kilnOpen: { and: ['h1', 'h2', 'h3'] },
  },
  pieces: [...switchroom, ...rail, ...cellar, ...gallery, ...kiln],
};
