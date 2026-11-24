// Level 12 - "The Great Kiln". The finale: relight the kiln. Three burners wake in three rooms, then the draughts
// answer, the chimney draws, and the kiln itself takes you in. Every form is asked for, and every mechanism of the
// campaign comes back once:
//   1. The Stokehole    a crate and a heavy plate (ice) open the way in; liquid douses an ember bar; film crawls
//                       through the gap it guarded and closes an electrode circuit - twice, in two walls: burner A.
//                       A door lets you out.
//   2. The Culvert      the hall is walled off, but a grille in the floor drops film into a water channel that runs
//                       under the wall: burner B lights when you surface in the pool. (The shard on the channel bed
//                       wants ice, then a drop again.) Burner B starts the fan in the shaft: steam up through its lid,
//                       then a bud on the landing waters into a ladder of leaves up the last cliff.
//   3. The Cold Well    a ferry (it runs on burner A) over a pit; then a flooded well with frost over it: you freeze,
//                       sink onto the heavy plate at the bottom, the plate stops the frost, and a drop floats back
//                       up: burner C.
//   4. The Gale Gallery burner C wakes a gale. Drops and clouds are blown back; ice walks straight in, and glass
//                       at the end of the gale takes a run-up.
//   5. The Throat       with all three lit the chimney draws: a vent lifts you (forced steam) past jets of flame.
//                       A tray under each jet stops a cloud on the wrong side, so you rise to it, see the open lane
//                       and slide across: no reflex needed.
//   6. The Crown        the pilot light wants every form once (a drop, film, a cloud, ice); then, on the crown, frost
//                       freezes you and the slope does the rest: down the long slide, through two walls of glass, into the
//                       lit kiln.
// Signals: latch (burners), and (lit), not (frost off once C is lit). Layout runs along +X; floor 0 (the first
// rooms), 6.8 (the lid), 13.4 (the upper rooms), 41.4 (the crown), 27.4 (the kiln chamber at the foot of the slide).

const blk = (x0, y0, z0, x1, y1, z1, mat = 'tile') => ({ type: 'block', box: [x0, y0, z0, x1, y1, z1], mat });
const prop = (kind, x, y, z, o = {}) => ({ type: 'prop', kind, pos: [x, y, z], ...o });
/** A wall across the hall with a door in it: too tall and too wide to float over or round. */
const gate = (id, x, y, top, on, zw = 9) => [
  blk(x, y - 1, -zw, x + 0.4, top, -1.2, 'brick'),
  blk(x, y - 1, 1.2, x + 0.4, top, zw, 'brick'),
  blk(x, y + 3, -1.2, x + 0.4, top, 1.2, 'brick'),
  blk(x, y - 1, -1.2, x + 0.4, y, 1.2, 'brick'),
  { type: 'door', id, box: [x + 0.03, y, -1.2, x + 0.37, y + 3, 1.2], on },
];
/** Place a list of pieces `ox` along +X and `oy` up (boxes and positions; offsets such as a mover's `to` stay as they are). */
const at = (ox, list, oy = 0) => list.map((p) => {
  const q = { ...p };
  if (q.box) q.box = [q.box[0] + ox, q.box[1] + oy, q.box[2], q.box[3] + ox, q.box[4] + oy, q.box[5]];
  if (q.pos) q.pos = [q.pos[0] + ox, q.pos[1] + oy, q.pos[2]];
  return q;
});

/** Where each area starts: x along the level, y of its floor. The proof scripts and the level tests read these. */
export const X = { stoke: 0, culvert: 54, well: 132, gale: 200, throat: 242, crown: 257.4 };
export const Y = { stoke: 0, culvert: 0, well: 13.4, gale: 13.4, throat: 13.4, crown: 41.4, lid: 6.8 };

const stoke = [
  // the start hall (floor 0), then a pit: the crate has to cross it on the ferry (a cloud could carry you, never the crate)
  blk(-4, -1, -4, 8, 0, 4, 'tile'),
  blk(-4.5, 0, -4, -4, 0.8, 4, 'brick'),
  blk(-4, 0, -4.4, 8, 2.6, -4, 'brick'),
  blk(-4, 0, 4, 8, 2.6, 4.4, 'brick'),
  blk(16, 0, -4.4, 54, 10, -4, 'brick'),
  blk(16, 0, 4, 54, 10, 4.4, 'brick'),
  prop('kiln', -2, 0, -9.5, { rot: 0, scale: 3, solid: false }),         // the cold giant, off to one side
  prop('shelf', 3.4, 0, 3.55, { rot: 0 }),
  prop('pots', -2.4, 0, 3.2, { scale: 0.9 }),
  prop('lamp', 2.2, 0, -3.4),
  prop('lamp', 6.4, 0, 3.4),
  { type: 'checkpoint', pos: [3, 0, 0] },
  // a perch only a cloud reaches
  blk(4.8, 0, 2.2, 7.6, 4.2, 3.9, 'cream'),
  { type: 'shard', pos: [6.2, 4.95, 3.0] },
  { type: 'hint', key: 'weigh', box: [1.4, 0, -3.6, 6, 3, 3.6] },
  { type: 'crate', id: 'crate1', pos: [6.9, 0, 0] },
  { type: 'fire', box: [8, -6, -4, 16, -4.5, 4] },
  blk(8, -7, -4, 16, -6, 4, 'dark'),
  blk(8, -7, -4.4, 16, 2.6, -4, 'brick'),
  blk(8, -7, 4, 16, 2.6, 4.4, 'brick'),
  { type: 'sensor', id: 'deck1', box: [9.2, -0.3, -1.2, 10.8, 0.6, 1.2], emit: 'deck1' },
  { type: 'mover', id: 'ferry1', box: [8, -0.4, -1.5, 11, 0, 1.5], to: [5, 0, 0], speed: 2.4, mode: 'toggle', on: { hold: 'deck1', for: 7 }, mat: 'metal' },
  blk(16, -1, -4, 54, 0, 4, 'tile'),
  prop('lamp', 17.4, 0, -3.4),
  prop('lamp', 17.4, 0, 3.4),
  blk(17, 0, -4, 26, 0.7, -3.6, 'brick'),
  blk(17, 0, 3.6, 26, 0.7, 4, 'brick'),
  { type: 'plate', id: 'wp', pos: [23, 0, 0], size: [1.8, 1.8], heavy: true, emit: 'wp' },
  prop('pots', 20, 0, 3.0, { scale: 0.9 }),
  ...gate('doorW', 27, 0, 9, 'wp'),
  // the stokehole: the wall with an ember bar at its foot
  { type: 'checkpoint', pos: [30, 0, 0] },
  { type: 'hint', key: 'ember', box: [30.6, 0, -4.4, 34.4, 3, 4.4] },
  blk(36, 0, -4.4, 36.4, 9, -1.2, 'brick'),
  blk(36, 0, 1.2, 36.4, 9, 4.4, 'brick'),
  blk(36, 0.3, -1.2, 36.4, 9, 1.2, 'brick'),
  { type: 'ember', id: 'bar', box: [35.3, 0, -1.2, 36.4, 0.3, 1.2] },       // a pile of embers heaped in front of the gap
  // behind it: electrodes, and the first burner on the wall
  { type: 'hint', key: 'film', box: [36.8, 0, -4, 39, 3, 4] },
  { type: 'electrodes', id: 'arc', box: [39.3, 0, -0.5, 40.7, 0.4, 0.5], axis: 'x', emit: 'arc' },
  blk(39, 2.2, -4.4, 42.6, 2.6, -3.7, 'metal'),
  { type: 'fire', id: 'burnerA', box: [39.3, 2.6, -4.4, 42.3, 4.0, -3.7], on: 'burnA' },
  prop('pots', 37.6, 0, 3.4, { scale: 0.9 }),
  prop('lamp', 42.2, 0, 3.4),
  // a second wall, a second bar, a second pair of posts: both circuits must close before the burner catches
  { type: 'hint', key: 'second', box: [44.6, 0, -4, 47, 3, 4] },
  blk(44, 0, -4.4, 44.4, 9, -1.2, 'brick'),
  blk(44, 0, 1.2, 44.4, 9, 4.4, 'brick'),
  blk(44, 0.3, -1.2, 44.4, 9, 1.2, 'brick'),
  { type: 'ember', id: 'bar2', box: [43.3, 0, -1.2, 44.4, 0.3, 1.2] },
  { type: 'electrodes', id: 'arc2', box: [47.3, 0, -0.5, 48.7, 0.4, 0.5], axis: 'x', emit: 'arc2' },
  prop('lamp', 46, 0, -3.4),
  prop('lamp', 49.8, 0, 3.4),
  ...gate('doorA', 51, 0, 9, 'burnA'),
];

const culvertA = [
  // the entry hall, then a trench under the floor: a long grille over a water channel that runs under a wall
  blk(0, -1, -4, 14, 0, 4, 'tile'),
  blk(0, 0, -5.8, 78, 15, -5.4, 'brick'),
  blk(0, 0, 5.4, 78, 15, 5.8, 'brick'),
  { type: 'checkpoint', pos: [3, 0, 0] },
  { type: 'hint', key: 'culvert', box: [4, 0, -4.4, 13, 3, 4.4] },
  prop('lamp', 2, 0, -4.2),
  prop('lamp', 2, 0, 4.2),
  prop('pots', 8.4, 0, -4.0),
  blk(0, -5, -5.4, 14, -1, 5.4, 'dark'),
  blk(0, 0, -5.4, 14, 0.8, -4.4, 'brick'),
  blk(0, 0, 4.4, 14, 0.8, 5.4, 'brick'),
  blk(14, -5, -5.4, 40, 0, -2.5, 'tile'),
  blk(14, -5, 2.5, 40, 0, 5.4, 'tile'),
  blk(14, -5, -2.5, 40, -3.4, 2.5, 'dark'),
  { type: 'slot', id: 'grille', box: [14, -0.3, -2.5, 32, 0, 2.5] },       // one long grille over the channel: you can watch the water run under it
  { type: 'current', id: 'culvert', box: [14, -3.4, -2.5, 32, -1.6, 2.5], flow: [2.5, 0] },
  { type: 'current', id: 'pool', box: [32, -3.4, -2.5, 40, -0.2, 2.5], flow: [0, 0] },
  // a shelf with a film-high gap and a shard far under it: only film fits, and it is a long crawl
  blk(4.4, 0.3, 1.6, 10.4, 1.3, 3.9, 'cream'),
  { type: 'shard', pos: [9.6, 0.25, 2.8] },
  blk(26, 0, -5.4, 26.4, 12, 5.4, 'brick'),                                // the wall the water runs under
  prop('kiln', 21, 0, -3.9, { rot: 0 }),
  prop('lamp', 23, 0, 3.9),
  prop('lamp', 18, 0, -4.2),
  prop('pots', 29.4, 0, -4.0, { scale: 0.9 }),
  { type: 'sensor', id: 'poolSensor', box: [34, -0.8, -2.2, 38.4, 0.6, 2.2], emit: 'inPool', visible: false },
  // the second channel: open water, with curtains of flame across the whole hall. A drop is carried into them; ice
  // sinks, walks the floor beneath, and melts in the calm pool beyond
  blk(40, -5, -5.4, 62, 0, -2.5, 'tile'),
  blk(40, -5, 2.5, 62, 0, 5.4, 'tile'),
  blk(40, -5, -2.5, 62, -3.4, 2.5, 'dark'),
  { type: 'current', id: 'channel2', box: [40, -3.4, -2.5, 56, -0.2, 2.5], flow: [2.5, 0] },
  { type: 'current', id: 'pool2', box: [56, -3.4, -2.5, 62, -0.2, 2.5], flow: [0, 0] },
  { type: 'fire', id: 'flamesB1', box: [47, -0.2, -5.4, 47.8, 14, 5.4] },
  { type: 'fire', id: 'flamesB2', box: [52, -0.2, -5.4, 52.8, 14, 5.4] },
  { type: 'hint', key: 'channel', box: [40.4, -3.4, -2.4, 45, -0.2, 2.4] },
  prop('lamp', 43, 0, -4.4),
  prop('lamp', 58, 0, 4.4),
];

const culvertC = [
  // the far bank: burner B on the wall, and the shaft its fan draws up
  blk(40, -5, -5.4, 56, 0, 5.4, 'tile'),
  { type: 'checkpoint', pos: [42.4, 0, 0] },
  blk(44, 2.2, -5.4, 47.6, 2.6, -4.7, 'metal'),
  { type: 'fire', id: 'burnerB', box: [44.3, 2.6, -5.4, 47.3, 4.0, -4.7], on: 'burnB' },
  prop('lamp', 42, 0, 4.2),
  prop('pots', 45.6, 0, 4.0, { scale: 0.9 }),
  { type: 'hint', key: 'shaft', box: [40.6, 0, -5, 46, 3, 5] },
  { type: 'fan', id: 'shaft', box: [49, 0, -1.6, 53, 7.2, 1.6], dir: '+y', strength: 3, on: 'burnB' },
  blk(48.6, 0, -5.4, 53.4, 6.2, -1.6, 'brick'),
  blk(48.6, 0, 1.6, 53.4, 6.2, 5.4, 'brick'),
  blk(53, 0, -1.6, 53.4, 6.2, 1.6, 'brick'),
  blk(48.6, 6.2, -5.4, 49, 6.8, 5.4, 'cream'),
  blk(49, 6.2, -5.4, 53, 6.8, -1.6, 'cream'),
  blk(49, 6.2, 1.6, 53, 6.8, 5.4, 'cream'),
  { type: 'grate', id: 'lid', box: [49, 6.2, -1.6, 53, 6.8, 1.6] },
  blk(53, -5, -5.4, 56, 6.8, 5.4, 'brick'),
  { type: 'hint', key: 'bud', box: [53.4, 6.8, -4, 55.6, 9.8, 4] },
  { type: 'sprout', id: 'budU', pos: [54.9, 6.8, 0], height: 6.6, axis: 'z' },
  prop('lamp', 51.6, 6.8, -5.0),
  // cold air above the bank, inside the shaft while it is dark, and over everything from the lid to the ferry pit: a
  // cloud that jumps and boils at the top of the jump still climbs only a few metres here
  { type: 'cold', id: 'bankCold', box: [40, 4, -5.4, 48.6, 14, 5.4] },
  { type: 'cold', id: 'shaftCold', box: [49, 3.2, -1.6, 53, 10, 1.6], on: '!burnB' },
  { type: 'cold', id: 'wellCold', box: [48.6, 11, -5.8, 94, 60, 5.8] },
];

const culvert = [...culvertA, ...at(22, culvertC)];

const wellA = [
  // the ferry hall (floor 6): a pit too wide for any cloud; the ferry runs on burner A
  blk(0, -7, -5.4, 6, 0, 5.4, 'tile'),
  { type: 'checkpoint', pos: [2.4, 0, 0] },
  prop('lamp', 1.4, 0, -3.4),
  prop('lamp', 1.4, 0, 3.4),
  { type: 'hint', key: 'ferry', box: [0.6, 0, -4, 5.6, 4, 4] },
  { type: 'fire', box: [6, -6, -4, 21.5, -4.5, 4] },
  blk(6, -7, -4, 21.5, -6, 4, 'dark'),
  blk(6, -7, -4.4, 38, 15, -4, 'brick'),
  blk(6, -7, 4, 38, 15, 4.4, 'brick'),
  { type: 'sensor', id: 'deck2', box: [7, -0.3, -1.2, 8.4, 0.6, 1.2], emit: 'deck2' },
  { type: 'mover', id: 'ferry2', box: [6, -0.4, -1.5, 9, 0, 1.5], to: [12.5, 0, 0], speed: 3, mode: 'toggle', on: { and: ['burnA', { hold: 'deck2', for: 11 }] }, mat: 'metal' },
  blk(21.5, -1, -4, 38, 0, 4, 'tile'),
  { type: 'checkpoint', pos: [23.4, 0, 0] },
  prop('lamp', 22.6, 0, -3.4, { solid: false }),
  prop('pots', 28, 0, 3.4, { scale: 0.9, solid: false }),
  // the frost reaches back over the landing: you stay ice here, and ice can shove a crate. The plate holds the door only while it rests there
  { type: 'frost', id: 'coldV', box: [22.4, 0, -4.4, 37, 9, 4.4], on: '!burnC' },
  { type: 'hint', key: 'frostpush', box: [22.6, 0, -3.6, 27, 3, 3.6] },
  { type: 'crate', id: 'crateV', pos: [25.4, 0, -2.2] },
  { type: 'crate', id: 'crateV2', pos: [25.4, 0, 2.2] },
  { type: 'plate', id: 'pV', pos: [34, 0, -2.2], size: [1.8, 1.8], heavy: true, emit: 'pV' },
  { type: 'plate', id: 'pV2', pos: [34, 0, 2.2], size: [1.8, 1.8], heavy: true, emit: 'pV2' },
  ...gate('doorV', 37, 0, 15, { and: ['pV', 'pV2'] }),
];

const wellB = [
  // the well: flooded, with frost over it until the third burner is lit, and a heavy plate at the bottom
  blk(30, -5.2, -5, 37, 0, 5, 'tile'),
  { type: 'checkpoint', pos: [32.4, 0, 0] },
  { type: 'hint', key: 'well', box: [33.4, 0, -4.4, 36.4, 3, 4.4] },
  blk(37, -5.4, -5, 42.5, -4.2, 5, 'dark'),
  { type: 'current', id: 'wellWater', box: [37, -4.2, -5, 42.5, -0.4, 5], flow: [0, 0] },
  { type: 'frost', id: 'cold', box: [36.6, -4.2, -5, 42.9, 16, 5], on: '!burnC' },   // tall: a cloud that climbs first and floats over would still be frozen
  { type: 'plate', id: 'plateC', pos: [39.75, -4.2, 0], size: [2.4, 2.4], heavy: true, emit: 'plateC' },
  blk(42.5, -5.2, -5, 60, 0, 5, 'tile'),
  { type: 'checkpoint', pos: [46, 0, 0] },
  blk(48, 2.2, -5.4, 51.6, 2.6, -4.7, 'metal'),
  { type: 'fire', id: 'burnerC', box: [48.3, 2.6, -5.4, 51.3, 4.0, -4.7], on: 'burnC' },
  prop('lamp', 45.4, 0, -4.2),
  prop('lamp', 45.4, 0, 4.2),
  prop('shelf', 54, 0, 4.3, { rot: 0 }),
  prop('pots', 57, 0, -4.1),
  // the long flanks of the hall (also keep a cloud from floating round the walls)
  blk(30, -5.4, -5.8, 60, 15, -5.4, 'brick'),
  blk(30, -5.4, 5.4, 60, 15, 5.8, 'brick'),
];

const well = [...wellA, ...at(8, wellB)];

const gale = [
  // burner C wakes a gale that blows drops and clouds back; ice and film do not notice it. A sheltered nook with a
  // heavy plate between two stretches of it, and glass at the end.
  blk(0, -5.2, -4, 42, 0, 4, 'tile'),
  blk(0, 0, -4.4, 42, 12, -4, 'brick'),
  blk(0, 0, 4, 42, 12, 4.4, 'brick'),
  { type: 'checkpoint', pos: [2.4, 0, 0] },
  prop('lamp', 1.4, 0, -3.4),
  prop('lamp', 1.4, 0, 3.4),
  { type: 'hint', key: 'gale', box: [0.6, 0, -4, 3.8, 3, 4] },
  { type: 'fan', id: 'gale1', box: [4, 0, -4, 16, 12, 4], dir: '-x', strength: 9, on: 'burnC' },
  { type: 'checkpoint', pos: [18, 0, 0] },
  { type: 'hint', key: 'nook', box: [16.4, 0, -4, 21, 3, 4] },
  prop('lamp', 17.4, 0, -3.4),
  prop('lamp', 17.4, 0, 3.4),
  prop('pots', 20.6, 0, 3.2, { scale: 0.9 }),
  { type: 'crate', id: 'crate2', pos: [5.4, 0, 0] },
  { type: 'plate', id: 'hpN', pos: [22.6, 0, 0], size: [2.2, 2.2], heavy: true, emit: 'hpN' },
  ...gate('doorN', 26, 0, 9, 'hpN'),
  { type: 'fan', id: 'gale2', box: [26.4, 0, -4, 38.4, 12, 4], dir: '-x', strength: 9, on: 'burnC' },
  { type: 'pane', id: 'paneG', box: [38.6, 0, -4, 38.9, 3.6, 4], speed: 6 },
  blk(38.6, 3.6, -4, 38.9, 12, 4, 'brick'),
  prop('lamp', 40.6, 0, -3.4),
  prop('lamp', 40.6, 0, 3.4),
];

const throat = [
  // the foot of the chimney (floor 6), and the shaft: forced steam, five trays, five jets, a clear lane each time
  blk(0, -5.2, -4.8, 15.8, 0, 4.8, 'tile'),
  blk(0, 0, -5.4, 15.8, 31, -4.8, 'brick'),
  blk(0, 0, 4.8, 15.8, 31, 5.4, 'brick'),
  { type: 'checkpoint', pos: [6, 0, 0] },       // far enough in that the camera is clear of the glass wall behind
  prop('lamp', 1.4, 0, -3.4),
  prop('lamp', 1.4, 0, 3.4),
  prop('pots', 5.6, 0, -3.8, { scale: 0.9 }),
  { type: 'hint', key: 'throat', box: [3, 0, -4.4, 7.6, 3, 4.4] },
  { type: 'heatvent', id: 'chimney', box: [9.4, 0, -4.4, 15.4, 28.4, 4.4], on: 'lit' },
  blk(15.4, 0, -4.8, 15.8, 28, 4.8, 'brick'),
  // jet one burns on the west half (z < 0), jet two on the east half, and so on. The tray under each jet stops a
  // cloud on that side: it rises to the tray, and the open lane is right there
  blk(9.4, 3.2, -4.4, 15.4, 3.6, -0.4, 'metal'),
  { type: 'fire', id: 'jet1', box: [9.4, 3.6, -4.4, 15.4, 4.8, -1.0] },
  blk(9.4, 8.0, 0.4, 15.4, 8.4, 4.4, 'metal'),
  { type: 'fire', id: 'jet2', box: [9.4, 8.4, 1.0, 15.4, 9.6, 4.4] },
  blk(9.4, 12.8, -4.4, 15.4, 13.2, -0.4, 'metal'),
  { type: 'fire', id: 'jet3', box: [9.4, 13.2, -4.4, 15.4, 14.4, -1.0] },
  blk(9.4, 17.6, 0.4, 15.4, 18.0, 4.4, 'metal'),
  { type: 'fire', id: 'jet4', box: [9.4, 18.0, 1.0, 15.4, 19.2, 4.4] },
  blk(9.4, 22.4, -4.4, 15.4, 22.8, -0.4, 'metal'),
  { type: 'fire', id: 'jet5', box: [9.4, 22.8, -4.4, 15.4, 24.0, -1.0] },
  { type: 'shard', pos: [12.4, 7.5, -3.9] },
];

const crown = [
  // the crown (floor 34.6), on a mass of brick east of the shaft: the pilot light wants every form once, then the
  // cold begins and the slope does the rest
  blk(0, -8, -4, 36, -0.2, 4, 'brick'),
  blk(0, -0.2, -4, 36, 0, 4, 'tile'),
  blk(0, 0, -4.4, 36, 14, -4, 'brick'),
  blk(0, 0, 4, 36, 14, 4.4, 'brick'),
  { type: 'checkpoint', pos: [1.8, 0, 0] },
  prop('lamp', 1.2, 0, -3.2),
  prop('lamp', 1.2, 0, 3.2),
  { type: 'hint', key: 'pilot', box: [1.4, 0, -4, 5.4, 3, 4] },
  // the doorway of embers (a drop)
  blk(8, 0, -4.4, 8.4, 14, -1.2, 'brick'),
  blk(8, 0, 1.2, 8.4, 14, 4.4, 'brick'),
  blk(8, 2.6, -1.2, 8.4, 14, 1.2, 'brick'),
  { type: 'ember', id: 'pilotEmbers', box: [7.5, 0, -1.2, 8.5, 2.6, 1.2] },
  // the posts behind a low wall (film)
  { type: 'hint', key: 'posts', box: [9, 0, -4, 11.4, 3, 4] },
  blk(12, 0.3, -4, 13.4, 14, 4, 'brick'),
  { type: 'electrodes', id: 'eP', box: [15, 0, -0.7, 16.4, 0.4, 0.7], axis: 'x', emit: 'arcP' },
  // the ledge only a cloud reaches, with a sensor in the air above it (steam)
  { type: 'hint', key: 'cloud', box: [17.4, 0, -4, 19.4, 3, 4] },
  blk(20, 0, -4, 24.4, 4.2, -1.6, 'cream'),
  { type: 'sensor', id: 'pilotSteam', box: [20.2, 4.2, -3.8, 24.2, 5.6, -1.8], forms: ['steam'], emit: 'steamP' },
  // the heavy plate (ice)
  { type: 'plate', id: 'hpP', pos: [28.6, 0, 0], size: [2.2, 2.2], heavy: true, emit: 'hpP' },
  prop('lamp', 25.6, 0, 3.2),
  prop('pots', 30.6, 0, 3.0, { scale: 0.9 }),
  ...gate('doorP', 33, 0, 14, 'ignite'),
  // the plunge: fourteen metres down over twenty-eight, walled in, then two walls of glass, then the lit kiln
  { type: 'hint', key: 'plunge', box: [33.8, 0, -4, 37.6, 3, 4] },
  { type: 'frost', id: 'cold2', box: [34.6, -15, -4.4, 90, 8, 4.4] },
  blk(33.4, -8, -4, 38, -0.2, 4, 'brick'),
  blk(33.4, -0.2, -4, 38, 0, 4, 'tile'),
  { type: 'ramp', id: 'slide', box: [38, -14, -4, 66, 0, 4], up: '-x', mat: 'cream' },
  blk(33.4, -15, -4.4, 90, 3, -4, 'brick'),
  blk(33.4, -15, 4, 90, 3, 4.4, 'brick'),
  blk(66, -15, -4, 90, -14.2, 4, 'brick'),
  blk(66, -14.2, -4, 90, -14, 4, 'tile'),
  { type: 'pane', id: 'glass1', box: [67, -14, -4, 67.3, -10.4, 4], speed: 9 },
  blk(67, -10.4, -4, 67.3, 3, 4, 'brick'),
  { type: 'pane', id: 'glass2', box: [77, -14, -4, 77.3, -10.4, 4], speed: 11 },
  blk(77, -10.4, -4, 77.3, 3, 4, 'brick'),
  prop('lamp', 71, -14, -3.4),
  prop('lamp', 71, -14, 3.4),
  prop('lamp', 81, -14, -3.4),
  prop('lamp', 81, -14, 3.4),
  prop('kiln', 87.6, -14, 3.0, { rot: 180, scale: 1.4, solid: false }),
  blk(89.4, -14, -4, 90, -6, 4, 'brick'),
  { type: 'fire', id: 'roar', box: [88.8, -9.6, -4, 89.4, -8.2, 4] },           // the kiln roaring, out of reach
  { type: 'exit', pos: [86.4, -14, 0], face: '-x', on: 'lit' },
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [53.9, 0, 0],
  [130.3, 6.8, 0],
  [239.8, 13.4, -0.9],
  [283.8, 41.4, -2.8],
  [162.2, 13.4, 0.4],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l12',
  name: 'The Great Kiln',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  areas: [
    { name: 'The Stokehole', box: [-5, -5, X.culvert, 5] },
    { name: 'The Culvert', box: [X.culvert, -6, X.well, 6] },
    { name: 'The Cold Well', box: [X.well, -6, X.gale, 6] },
    { name: 'The Gale Gallery', box: [X.gale, -5, X.throat, 5] },
    { name: 'The Throat', box: [X.throat, -6, X.crown, 6] },
    { name: 'The Crown', box: [X.crown, -5, X.crown + 90, 5] },
  ],
  hints: {
    start: 'The Great Kiln has gone cold. Wake its three burners, climb the chimney, and let the heat take you in.',
    weigh: 'A pit, a heavy plate beyond it, and a crate. {ice} to shove the crate onto the ferry.',
    ember: 'A smouldering line across the wall foot. A drop puts it out, but the gap beneath is only film high.',
    film: 'Two posts and a bare strip: the circuit again. {film} closes it. The burner above wants more than one.',
    second: 'Another wall of embers, another gap, another pair of posts. Both circuits must be closed.',
    culvert: 'Film slips through the floor grille; the current beyond carries what floats. {liquid} once in open water.',
    shaft: 'Burner B draws the shaft. {steam} to rise in it, up through the lid, then {liquid} on top.',
    channel: 'Flames hang across the water ahead and the current carries a drop straight into them. Ice sinks beneath.',
    frostpush: 'The frost keeps you ice here, and ice can shove a crate. The door stays open only while both plates are held.',
    bud: 'A bud at the foot of the last cliff. Stand beside it as a drop, then hop up its leaves.',
    ferry: 'The ferry runs on the first burner and leaves when you step aboard. The pit is too wide for any cloud.',
    well: 'A flooded well with frost over it, and no way round. You will freeze and sink; something heavy waits below.',
    gale: 'Burner C wakes a gale. Drops and clouds are blown back; {ice} walks straight in.',
    nook: 'A sheltered nook and a heavy plate. A gale cannot move a crate; the shutter stays open while it rests there.',
    throat: 'The chimney lifts you whether you like it or not. A tray stops you under each jet: slide across to the open lane.',
    pilot: 'The pilot light wants every form once: a drop, film, a cloud and ice, in that order. Then the shutter lifts.',
    posts: 'Another low wall and two posts behind it. You know what lies across them.',
    cloud: 'A ledge no drop can reach, with a sensor hanging above it that only a cloud can trip.',
    plunge: 'The kiln mouth is sealed with glass far below. Step into the frost, and let the slope take you.',
  },
  signals: {
    burnA: { and: [{ latch: 'arc' }, { latch: 'arc2' }] },
    burnB: { latch: 'inPool' },
    burnC: { latch: 'plateC' },
    lit: { and: ['burnA', 'burnB', 'burnC'] },
    ignite: { and: [{ latch: 'arcP' }, { latch: 'steamP' }, { latch: 'hpP' }] },
  },
  pieces: [
    ...LAMPS,
    ...at(X.stoke, stoke, Y.stoke),
    ...at(X.culvert, culvert, Y.culvert),
    ...at(X.well, well, Y.well),
    ...at(X.gale, gale, Y.gale),
    ...at(X.throat, throat, Y.throat),
    ...at(X.crown, crown, Y.crown),
  ],
};
