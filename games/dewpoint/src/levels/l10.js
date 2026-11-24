// Level 10 - "Quench". Frost zones force ice, and the level goes down into the cellars to use it.
//   1. The Icehouse    teach: frost freezes you the moment you step in. Ice is heavy, so the plate in the frost
//                      (which a drop could never press) opens the door; the next hall is crossed on a ferry (ice
//                      rides it), then the cold slide, and glass at the bottom.
//   2. The Cold Store  practise: frost fills the room, so you stay ice - and the far wall is a steam grate. Two plates
//                      switch the frost off, and only two crates can hold them down while you change shape.
//   3. The Skate Hall  twist: ice keeps its speed. A frost-lined chute drops into a bowl, climbs the far side and
//                      throws you off a kicker over a fire gap and through a second pane.
//   4. The Seed Cellar combine: a bud sits in the frost. A plate lifts the frost for a while after you step off:
//                      thaw, water the bud, climb its leaves before the cold comes back. On the gallery the cold
//                      returns: a second plate, a second bud, taller, and above it the cold is wanted: a heavy plate
//                      and a door.
//   5. The Quench Tank payoff: the tank is flooded and curtains of kiln flame hang across the water. A drop floats
//                      into them; ice sinks underneath and walks the bottom, shoving the crate that waits there along
//                      the floor to the plate that holds the sluice open, then melts in the calm pool beyond it.
// Layout runs along +X and DOWN: hall (floor 0), the cold store (-3), the bowl (-8, back up to -6.5), the cellar
// (-6.5, galleries 0.1 and 6.1), the tank (-6.5, water -6.7). Each area is written in its own coordinates and placed at X.

const blk = (x0, y0, z0, x1, y1, z1, mat = 'tile') => ({ type: 'block', box: [x0, y0, z0, x1, y1, z1], mat });
const prop = (kind, x, y, z, o = {}) => ({ type: 'prop', kind, pos: [x, y, z], ...o });
/** A wall across the hall with a door in it. */
const gate = (id, x, y, top, on, zw = 9) => [
  blk(x, y - 1, -zw, x + 0.4, top, -1.2, 'brick'),
  blk(x, y - 1, 1.2, x + 0.4, top, zw, 'brick'),
  blk(x, y + 3, -1.2, x + 0.4, top, 1.2, 'brick'),
  blk(x, y - 1, -1.2, x + 0.4, y, 1.2, 'brick'),
  { type: 'door', id, box: [x + 0.03, y, -1.2, x + 0.37, y + 3, 1.2], on },
];
/** Place a list of pieces `ox` metres along +X (boxes and positions; offsets such as a mover's `to` stay as they are). */
const at = (ox, list) => list.map((p) => {
  const q = { ...p };
  if (q.box) q.box = [q.box[0] + ox, q.box[1], q.box[2], q.box[3] + ox, q.box[4], q.box[5]];
  if (q.pos) q.pos = [q.pos[0] + ox, q.pos[1], q.pos[2]];
  return q;
});

/** Where each area starts (metres along +X). The proof scripts and the level tests read these. */
export const X = { icehouse: 0, store: 63.6, skate: 93.6, cellar: 147.5, tank: 202.5 };

const icehouse = [
  // the start hall (floor 0)
  blk(-4, -1, -4, 31, 0, 4, 'tile'),
  blk(-4.5, 0, -4, -4, 0.8, 4, 'brick'),
  blk(-4, 0, -4.4, 13, 2.6, -4, 'brick'),
  blk(-4, 0, 4, 13, 2.6, 4.4, 'brick'),
  prop('kiln', 0.8, 0, -3.0, { rot: 0 }),
  prop('shelf', 4.2, 0, -3.5, { rot: 0 }),
  prop('pots', 6.6, 0, -3.4),
  prop('pots', -2.2, 0, 3.0, { scale: 0.9 }),
  prop('lamp', 6.2, 0, 3.4),
  prop('lamp', 9.4, 0, -3.4),
  { type: 'checkpoint', pos: [7.6, 0, 0] },
  { type: 'hint', key: 'frost', box: [8.2, 0, -4, 12.6, 4, 4] },
  { type: 'shard', pos: [11.2, 0.7, 1.0] },
  // the frost hall: kerbs keep ice on the floor, tall walls keep every cloud out
  blk(13, 0, -4.4, 55, 9, -4, 'brick'),
  blk(13, 0, 4, 55, 9, 4.4, 'brick'),
  blk(13, 0, -4, 31, 0.7, -3.6, 'brick'),
  blk(13, 0, 3.6, 31, 0.7, 4, 'brick'),
  { type: 'frost', id: 'cold1', box: [13.4, -3.5, -4.4, 63.6, 9, 4.4] },
  { type: 'plate', id: 'h0', pos: [22.4, 0, 0], size: [2.4, 2.4], heavy: true, emit: 'h0' },
  prop('lamp', 17, 0, -3.2),
  prop('lamp', 27.6, 0, 3.2),
  ...gate('door0', 31, 0, 12, 'door0'),
  // the ferry hall: a gap too wide for ice, a platform that shuttles across it
  blk(31.4, -1, -4, 36, 0, 4, 'tile'),
  { type: 'checkpoint', pos: [33.4, 0, 0] },
  prop('lamp', 32.6, 0, -3.2),
  prop('lamp', 32.6, 0, 3.2),
  { type: 'hint', key: 'ferry', box: [31.6, 0, -4, 35.6, 4, 4] },
  { type: 'fire', box: [36, -6, -4, 50, -4.5, 4] },
  blk(36, -7, -4, 50, -6, 4, 'dark'),
  blk(36, -7, -4.4, 50, 9, -4, 'brick'),
  blk(36, -7, 4, 50, 9, 4.4, 'brick'),
  { type: 'sensor', id: 'deck', box: [37, -0.3, -1.2, 38.4, 0.6, 1.2], emit: 'deck' },
  { type: 'mover', id: 'ferry', box: [36, -0.4, -1.5, 39, 0, 1.5], to: [11, 0, 0], speed: 2, mode: 'toggle', on: { hold: 'deck', for: 12 }, mat: 'metal' },
  blk(50, -1, -4, 55, 0, 4, 'tile'),
  prop('lamp', 52, 0, -3.2),
  prop('pots', 53, 0, 3.0, { scale: 0.9 }),
  // the slide: 3 m down over 6 m, walled in, ending at a cracked pane
  { type: 'ramp', box: [55, -3, -3, 61, 0, 3], up: '-x', mat: 'cream' },
  blk(55, -4, -3.4, 63.6, 1.2, -3, 'brick'),
  blk(55, -4, 3, 63.6, 1.2, 3.4, 'brick'),
  blk(63.3, -3, -5.8, 63.6, 3.5, -3, 'brick'),
  blk(63.3, -3, 3, 63.6, 3.5, 5.8, 'brick'),
  blk(63.3, 0.6, -3, 63.6, 3.5, 3, 'brick'),
  { type: 'pane', id: 'seal', box: [63.33, -3, -3, 63.57, 0.6, 3], speed: 9 },
];

const store = [
  blk(-2.3, -4, -5.8, 30, -3, 5.8, 'tile'),
  blk(0, -3, -5.8, 30, 3.5, -5.4, 'brick'),
  blk(0, -3, 5.4, 30, 3.5, 5.8, 'brick'),
  blk(29.6, -3, -5.4, 30, 3.5, -1.5, 'brick'),
  blk(29.6, -3, 1.5, 30, 3.5, 5.4, 'brick'),
  blk(29.6, 2.5, -1.5, 30, 3.5, 1.5, 'brick'),
  { type: 'grate', id: 'vent', box: [29.65, -3, -1.5, 29.95, 2.5, 1.5] },
  { type: 'frost', id: 'cold', box: [0, -3, -5.8, 29.6, 3.5, 5.8], on: '!thaw' },
  { type: 'checkpoint', pos: [3.4, -3, -4.1] },
  { type: 'hint', key: 'store', box: [2.4, -3, -5.4, 6, 0, 5.4] },
  { type: 'crate', id: 'crate', pos: [8, -3, -2.5] },
  blk(15.8, -3, -5.4, 16.2, 3.5, 0.9, 'brick'),                     // a wall across the south half: the crate has to go round it
  { type: 'crate', id: 'crateB', pos: [8, -3, 3.2] },
  { type: 'plate', id: 'thawPlate', pos: [24.4, -3, -2.2], size: [1.6, 1.6], emit: 'thawA' },
  { type: 'plate', id: 'thawPlateB', pos: [24.4, -3, 3.2], size: [1.6, 1.6], emit: 'thawB' },
  { type: 'hint', key: 'thaw', box: [22.4, -3, -4.6, 26.2, 0, 4.6] },
  prop('shelf', 11.6, -3, -5.0, { rot: 0 }),
  prop('pots', 19.4, -3, -5.0, { scale: 0.9 }),
  prop('lamp', 5, -3, 5.0),
  prop('lamp', 13, -3, 5.0, { solid: false }),
  prop('lamp', 27.2, -3, -5.0),
  // a ledge high up the wall: a shard for whoever can rise once the frost is gone
  blk(26.6, 0.4, 3.2, 28.9, 1.0, 5.4, 'cream'),
  { type: 'shard', pos: [27.8, 1.7, 4.3] },
];

const skate = [
  // the bank above the chute
  blk(0, -4, -4, 7.6, -3, 4, 'tile'),
  blk(0, -3, -4.4, 7.6, 3, -4, 'brick'),
  blk(0, -3, 4, 7.6, 3, 4.4, 'brick'),
  { type: 'checkpoint', pos: [2.6, -3, 0] },
  prop('lamp', 1.6, -3, -3.4),
  prop('lamp', 1.6, -3, 3.4),
  prop('pots', 5, -3, 3.0, { scale: 0.9 }),
  { type: 'hint', key: 'chute', box: [3.2, -3, -4, 7.2, 0, 4] },
  // the chute: 5 m down over 14 m, a bowl, 1 m up over 10 m, then a kicker (1.5 m over 2.5 m)
  { type: 'frost', id: 'cold3', box: [7.6, -9, -4.4, 53.9, 8, 4.4] },
  { type: 'ramp', box: [7.6, -8, -4, 21.6, -3, 4], up: '-x', mat: 'cream' },
  blk(21.6, -9, -4, 27.6, -8, 4, 'tile'),
  { type: 'ramp', box: [27.6, -8, -4, 37.6, -7, 4], up: '+x', mat: 'cream' },
  { type: 'ramp', box: [37.6, -7, -4, 40.1, -5.5, 4], up: '+x', mat: 'clay' },
  blk(7.6, -9, -4.4, 53.9, 8, -4, 'brick'),
  blk(7.6, -9, 4, 53.9, 8, 4.4, 'brick'),
  // the gap: a fire bed far below, and the landing pad one metre lower than the crest
  { type: 'fire', box: [40.1, -12, -4, 44.6, -10.5, 4] },
  blk(40.1, -13, -4, 44.6, -12, 4, 'dark'),
  blk(44.6, -13, -4, 53.9, -6.7, 4, 'brick'),
  blk(44.6, -6.7, -4, 53.9, -6.5, 4, 'tile'),
  { type: 'checkpoint', pos: [46.6, -6.5, 0] },
  prop('lamp', 47, -6.5, -3.4),
  prop('lamp', 51, -6.5, 3.4),
  prop('pots', 49.6, -6.5, -3.0, { scale: 0.9 }),
  { type: 'pane', id: 'glass', box: [53.63, -6.5, -3, 53.87, -2.9, 3], speed: 7.2 },
  blk(53.6, -6.5, -4.4, 53.9, -2.9, -3, 'brick'),
  blk(53.6, -6.5, 3, 53.9, -2.9, 4.4, 'brick'),
  blk(53.6, -2.9, -4.4, 53.9, 8, 4.4, 'brick'),
];

const cellar = [
  // the cellar (floor -6.5): a bud in the frost, two film-high gaps, and a plate that thaws it all for a while
  blk(0, -7.5, -4.4, 55, -6.5, 4.4, 'tile'),
  blk(0, -6.5, -4.8, 20.2, 7, -4.4, 'brick'),
  blk(0, -6.5, 4.4, 20.2, 7, 4.8, 'brick'),
  { type: 'frost', id: 'cold4', box: [0, -6.5, -4.4, 20.8, 12, 4.4], on: '!thaw4' },
  { type: 'cold', id: 'cellarCold', box: [0, -3.6, -4.4, 28.4, 24, 4.4] },     // cold air over the cellar: a cloud climbs 3 m and no more
  { type: 'checkpoint', pos: [1.8, -6.5, -2.6] },
  { type: 'hint', key: 'cellar', box: [0.8, -6.5, -4.4, 4.8, -3.5, 4.4] },
  { type: 'plate', id: 'pT', pos: [5.0, -6.5, 2.4], size: [1.8, 1.8], emit: 'pT' },
  prop('lamp', 3.2, -6.5, 3.9),
  prop('shelf', 3.4, -6.5, -3.9, { rot: 0 }),
  prop('pots', 2.4, -6.5, 3.5, { scale: 0.9 }),
  blk(7.4, -6.2, -4.4, 8.4, 7, 4.4, 'brick'),                       // a film-high gap: only the thaw lets you crawl under it
  prop('lamp', 9.6, -6.5, -3.9),
  prop('pots', 10, -6.5, 3.4, { scale: 0.9 }),
  blk(13.4, -6.2, -4.4, 14.4, 7, 4.4, 'brick'),                     // and another
  prop('lamp', 16.6, -6.5, 3.9),
  { type: 'sprout', id: 'bud', pos: [19.4, -6.5, 0], height: 6.6, axis: 'z' },
  // gallery A (0.1), beyond the top leaf: the cold is back on it unless a second plate thaws it. A second bud, six
  // metres tall, leads on up to gallery B (6.1), where the cold is wanted again: a heavy plate and a door
  blk(20.2, -0.9, -4.4, 28, 0.1, 4.4, 'cream'),
  blk(20.2, 0.1, -4.8, 28, 14, -4.4, 'brick'),
  blk(20.2, 0.1, 4.4, 28, 14, 4.8, 'brick'),
  blk(20.2, -6.5, -4.4, 21, -0.9, 4.4, 'brick'),
  { type: 'frost', id: 'cold5', box: [20.4, 0.1, -4.4, 28.4, 14, 4.4], on: '!thaw5' },
  { type: 'checkpoint', pos: [21.6, 0.1, -2.8] },
  { type: 'hint', key: 'gallery', box: [20.8, 0.1, -4, 24.6, 3, 4] },
  { type: 'plate', id: 'pT2', pos: [22.8, 0.1, 2.4], size: [1.8, 1.8], emit: 'pT2' },
  prop('lamp', 21.4, 0.1, 3.4),
  prop('lamp', 25.4, 0.1, -3.4),
  { type: 'sprout', id: 'bud2', pos: [27.1, 0.1, 0], height: 6, axis: 'z' },
  blk(28, -0.9, -4.4, 39, 6.1, 4.4, 'cream'),
  blk(28, 6.1, -4.8, 39, 14, -4.4, 'brick'),
  blk(28, 6.1, 4.4, 39, 14, 4.8, 'brick'),
  { type: 'frost', id: 'cold6', box: [28.6, 6.1, -4.4, 39, 14, 4.4] },
  { type: 'hint', key: 'topgallery', box: [28.8, 6.1, -4, 31.6, 9, 4] },
  { type: 'plate', id: 'hg', pos: [33.4, 6.1, 0], size: [2.4, 2.4], heavy: true, emit: 'hg' },
  prop('lamp', 30.6, 6.1, -3.2),
  prop('lamp', 30.6, 6.1, 3.2),
  ...gate('doorG', 38, 6.1, 15.2, 'doorG'),
  { type: 'ramp', box: [39, -6.5, -4.4, 55, 6.1, 4.4], up: '-x', mat: 'cream' },
  blk(39, -6.5, -4.8, 55, 7.1, -4.4, 'brick'),
  blk(39, -6.5, 4.4, 55, 7.1, 4.8, 'brick'),
];

const tank = [
  // the bank (-6.5) and the flooded tank (water -6.7, bed -7.9), flame curtains across it, a crate on the bed, a sluice
  blk(0, -7.5, -5.8, 8, -6.5, 5.8, 'tile'),
  blk(0, -6.5, -5.8, 8, 1.5, -5.4, 'brick'),
  blk(0, -6.5, 5.4, 8, 1.5, 5.8, 'brick'),
  { type: 'checkpoint', pos: [2, -6.5, 0] },
  prop('lamp', 4, -6.5, -4.6),
  prop('lamp', 4, -6.5, 4.6),
  prop('pots', 6.2, -6.5, 4.1, { scale: 0.9 }),
  { type: 'hint', key: 'tank', box: [3.4, -6.5, -5.4, 7.4, -3.5, 5.4] },
  blk(8, -8.9, -5.8, 60, -7.9, 5.8, 'dark'),
  blk(8, -8.9, -5.8, 60, 2, -5.4, 'brick'),
  blk(8, -8.9, 5.4, 60, 2, 5.8, 'brick'),
  { type: 'current', id: 'flow', box: [8, -7.9, -5.4, 48, -6.7, 5.4], flow: [2.2, 0] },
  { type: 'current', id: 'pool', box: [48, -7.9, -5.4, 60, -6.7, 5.4], flow: [0, 0] },
  // curtains of flame across the whole tank, from the water's surface up out of reach of any cloud
  { type: 'fire', id: 'flamesA', box: [15.6, -6.7, -5.4, 16.4, 14, 5.4] },
  { type: 'fire', id: 'flamesB', box: [21.6, -6.7, -5.4, 22.4, 14, 5.4] },
  { type: 'fire', id: 'flamesC', box: [27.6, -6.7, -5.4, 28.4, 14, 5.4] },
  { type: 'fire', id: 'flamesD', box: [33.6, -6.7, -5.4, 34.4, 14, 5.4] },
  { type: 'fire', id: 'flamesE', box: [41.6, -6.7, -5.4, 42.4, 14, 5.4] },
  blk(15, 1.7, -5.4, 43, 2, 5.4, 'metal'),                       // a burner gantry overhead, for show
  // something sits on the tank floor, and a heavy plate waits by the sluice at the far end
  { type: 'crate', id: 'tankCrate', pos: [11.8, -7.9, 0] },
  { type: 'plate', id: 'pBed', pos: [52.4, -7.9, 0], size: [2.4, 2.4], heavy: true, emit: 'sluice' },
  { type: 'shard', pos: [24.6, -7.55, -4.6] },
  { type: 'hint', key: 'sluice', box: [44.4, -7.9, -5, 50, -6.5, 5] },
  blk(55.6, -8.9, -5.8, 56, 2, -1.6, 'brick'),
  blk(55.6, -8.9, 1.6, 56, 2, 5.8, 'brick'),
  blk(55.6, -4.9, -1.6, 56, 2, 1.6, 'brick'),
  { type: 'door', id: 'sluice', box: [55.63, -7.9, -1.6, 55.97, -4.9, 1.6], on: 'sluice' },
  { type: 'hint', key: 'pool', box: [56.4, -7.9, -5, 59.6, -6.5, 5] },
  blk(60, -8.9, -5.8, 70, -6.5, 5.8, 'tile'),
  blk(60, -6.5, -5.8, 70, -3.5, -5.4, 'brick'),
  blk(60, -6.5, 5.4, 70, -3.5, 5.8, 'brick'),
  { type: 'checkpoint', pos: [62, -6.5, 0] },
  prop('lamp', 62, -6.5, -4.4),
  prop('lamp', 62, -6.5, 4.4),
  prop('kiln', 66, -6.5, 3.4, { rot: 180 }),
  blk(69.4, -6.5, -5.4, 70, -1.5, 5.4, 'brick'),
  { type: 'exit', pos: [67.8, -6.5, 0], face: '-x' },
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [164.1, -6.5, 0],
  [188.4, 4.9, 0],
  [68.3, -3, 0],
  [227.0, -7.9, 0],
  [240.4, -7.9, 0],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l10',
  name: 'Quench',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  areas: [
    { name: 'The Icehouse', box: [-5, -6, X.store, 6] },
    { name: 'The Cold Store', box: [X.store, -6, X.skate, 6] },
    { name: 'The Skate Hall', box: [X.skate, -5, X.cellar, 5] },
    { name: 'The Seed Cellar', box: [X.cellar, -5, X.tank, 5] },
    { name: 'The Quench Tank', box: [X.tank, -6, X.tank + 71, 6] },
  ],
  hints: {
    start: 'The quench tank, where fired ware was cooled. The frost down there will not ask what you want to be.',
    frost: 'Frost freezes you solid until you leave it. Ice is heavy: it presses what a drop cannot.',
    ferry: 'A gap too wide to slide across. The ferry carries ice as well as anything, and leaves when you step aboard.',
    store: 'The far wall is a steam grate. Something here must switch the frost off. Stuck? {restart}.',
    thaw: 'Two plates, two crates: the frost stays off only while both rest on them. Leave them there; then be a cloud.',
    chute: 'Frost keeps you ice, and ice keeps its speed. Let the chute carry you up the far side and over the gap.',
    cellar: 'The plate thaws the frost for a while once you step off it. Crawl under the walls, water the bud, climb.',
    gallery: 'The cold is back, and the bud ahead is in it. Another plate thaws it for a while: thaw, water, climb.',
    topgallery: 'The cold is back, and a heavy plate wants exactly that: stand on it, and the door will stay open.',
    tank: 'Flames hang across the water and a drop floats straight into them. Ice sinks beneath; the bottom does not move.',
    sluice: 'The sluice stays shut while nothing heavy rests on the plate. The crate on the tank floor is heavy enough.',
    pool: 'Calm water at last. {liquid} and a melted drop floats back up to the surface.',
  },
  signals: {
    door0: { latch: 'h0' },                 // the plate in the frost opens the first door for good
    thaw: { and: ['thawA', 'thawB'] },       // both crates, both plates
    thaw4: { hold: 'pT', for: 20 },         // the cellar's frost stays off for a while after the plate is released
    thaw5: { hold: 'pT2', for: 14 },        // the same again on the gallery, for the second bud
    doorG: { latch: 'hg' },                 // the gallery's heavy plate opens its door for good
  },
  pieces: [
    ...LAMPS,
    ...at(X.icehouse, icehouse),
    ...at(X.store, store),
    ...at(X.skate, skate),
    ...at(X.cellar, cellar),
    ...at(X.tank, tank),
  ],
};
