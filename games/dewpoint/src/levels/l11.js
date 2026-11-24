// Level 11 - "Furnace Row". The old firing line: hot floors, kiln fire on timers, and plates wired together.
//   1. The Stoke Hall    teach: hot tiles melt ice and refuse to let you freeze, so the heavy plate sitting on them
//                        is out of your reach - a crate does not mind (safe: nothing here can hurt you).
//   2. The Furnace Dash  practise: a heavy plate puts the flames out for eight seconds after you step off it, and the
//                        hot tiles right behind it turn your ice into a runner. A second plate, midway, buys a
//                        second dash.
//   3. The Lift Hall     twist: beds of flame too wide to jump and too tall to hurdle. A crate on a pedal keeps the
//                        lift working; from the catwalk at the top a cloud floats across, rests, and floats over the
//                        second bed.
//   4. The Control Room  combine: film closes the posts that unshutter the room; then two plates must be down
//                        together - a crate holds each of the two near ones while you, as ice, press the far one
//                        behind a hot strip. The gate then stays open.
//   5. The Last Furnace  payoff: the last flames die only while BOTH timers run AND a crate holds its plate: set the
//                        crate first, then two heavy plates, a hot strip between them that melts you, and a dash.
// Signals used: hold (timed), and, latch, not. Layout runs along +X on one long floor.

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
/** Low kerbs along both edges: ice does not slide off the sides. */
const kerbs = (x0, x1, y = 0) => [blk(x0, y, -4, x1, y + 0.7, -3.6, 'brick'), blk(x0, y, 3.6, x1, y + 0.7, 4, 'brick')];
/** Flank walls on both sides of the hall. */
const flanks = (x0, x1, top, y = 0) => [blk(x0, y, -4.4, x1, top, -4, 'brick'), blk(x0, y, 4, x1, top, 4.4, 'brick')];
/** Place a list of pieces `ox` metres along +X. */
const at = (ox, list) => list.map((p) => {
  const q = { ...p };
  if (q.box) q.box = [q.box[0] + ox, q.box[1], q.box[2], q.box[3] + ox, q.box[4], q.box[5]];
  if (q.pos) q.pos = [q.pos[0] + ox, q.pos[1], q.pos[2]];
  return q;
});

/** Where each area starts (metres along +X). The proof scripts and the level tests read these. */
export const X = { stoke: 0, dash: 38.4, lift: 106.4, control: 181.4, last: 227.4 };

const stoke = [
  blk(-4, -1, -4, 38.4, 0, 4, 'tile'),
  blk(-4.5, 0, -4, -4, 0.8, 4, 'brick'),
  ...flanks(-4, 36, 2.6),
  ...flanks(18, 36, 12),
  prop('kiln', 1.0, 0, -2.6, { rot: 0 }),
  prop('pots', 2.6, 0, 2.6),
  prop('lamp', 4.6, 0, -3.0),
  prop('kiln', 11.4, 0, -3.0, { rot: 0 }),
  prop('lamp', 13.4, 0, -3.4),
  prop('pots', 18.6, 0, 3.0, { scale: 0.9 }),
  { type: 'checkpoint', pos: [2.6, 0, 0] },
  { type: 'shard', pos: [9.6, 0.7, 3.0] },
  { type: 'crate', id: 'crate1', pos: [7, 0, -2.2] },
  // two walls across the hall, each with a gap at one end: the crate has to weave through them
  blk(15, 0, -4, 15.4, 4, 0.9, 'brick'),
  blk(21, 0, -0.9, 21.4, 4, 4, 'brick'),
  { type: 'hint', key: 'hot', box: [22, 0, -3.6, 25.4, 3, 3.6] },
  { type: 'hotfloor', id: 'hot1', box: [26.9, 0, -4, 33, 0.3, 4] },
  { type: 'plate', id: 'p1', pos: [27.8, 0, -2.2], size: [1.6, 1.6], heavy: true, emit: 'p1' },
  prop('lamp', 30.6, 0, 3.3),
  prop('lamp', 34, 0, -3.3),
  ...gate('doorA', 36, 0, 14, 'p1'),
];

const dash = [
  blk(0, -1, -4, 68, 0, 4, 'tile'),
  ...flanks(0, 68, 3.8),
  { type: 'checkpoint', pos: [2.4, 0, 0] },
  { type: 'hint', key: 'dash', box: [0.6, 0, -4, 3.6, 3, 4] },
  prop('lamp', 1.4, 0, -3.3),
  prop('lamp', 1.4, 0, 3.3),
  // dash one: the plate holds the flames out for seven seconds after you step off it; the hot strip melts you on the way
  { type: 'plate', id: 'hp2', pos: [5.4, 0, 0], size: [2, 2], heavy: true, emit: 'hp2' },
  { type: 'hotfloor', id: 'hot2', box: [7.6, 0, -4, 10, 0.3, 4] },
  { type: 'fire', id: 'flames1', box: [11, 0, -4, 25, 3.4, 4], on: '!dash1' },
  // the middle platform: a second plate, a second seven seconds
  { type: 'plate', id: 'hp3', pos: [28.4, 0, 0], size: [2, 2], heavy: true, emit: 'hp3' },
  prop('lamp', 26.6, 0, -3.3),
  prop('pots', 30.2, 0, 3.0, { scale: 0.9 }),
  { type: 'hint', key: 'dash2', box: [25.4, 0, -4, 28, 3, 4] },
  { type: 'checkpoint', pos: [26.2, 0, 0.4] },
  { type: 'hotfloor', id: 'hot3', box: [31.6, 0, -4, 34, 0.3, 4] },
  // dash two: flames across the corridor, with a notch in the far corner holding a shard
  { type: 'fire', id: 'flames2a', box: [35.4, 0, -4, 47, 3.4, 2.4], on: '!dash2' },
  { type: 'fire', id: 'flames2b', box: [35.4, 0, 2.4, 40, 3.4, 4], on: '!dash2' },
  { type: 'fire', id: 'flames2c', box: [43.4, 0, 2.4, 47, 3.4, 4], on: '!dash2' },
  { type: 'shard', pos: [41.7, 0.7, 3.3] },
  // the pen: a safe pocket between the fields. The second field burns only WHILE the timer runs: wait for it to die
  { type: 'checkpoint', pos: [49, 0, 0] },
  { type: 'hint', key: 'pen', box: [47.4, 0, -4, 50.6, 3, 4] },
  prop('lamp', 48.4, 0, -3.3),
  prop('lamp', 48.4, 0, 3.3),
  { type: 'fire', id: 'flames2d', box: [51.6, 0, -4, 63.6, 3.4, 4], on: 'dash2' },
  prop('pots', 66, 0, 3.0, { scale: 0.9 }),
];

const lift = [
  blk(0, -1, -4, 75, 0, 4, 'tile'),
  ...flanks(0, 75, 3.8),
  ...kerbs(4, 20),
  { type: 'checkpoint', pos: [2.4, 0, 0] },
  prop('lamp', 1.4, 0, -3.3),
  prop('lamp', 1.4, 0, 3.3),
  prop('kiln', 9, 0, 3.0, { rot: 180 }),
  prop('pots', 13.6, 0, 3.0, { scale: 0.9 }),
  { type: 'hint', key: 'lift', box: [4.4, 0, -3.6, 9.6, 3, 3.6] },
  { type: 'crate', id: 'crate2', pos: [6.4, 0, -2.2] },
  { type: 'plate', id: 'pPump', pos: [16.4, 0, -2.2], size: [1.6, 1.6], emit: 'pump' },
  // the lift: rests at the floor, rises nine metres to the catwalk while the pedal is held down and someone is aboard
  blk(22, 0, -4, 25, 9, -1.5, 'brick'),
  blk(22, 0, 1.5, 25, 9, 4, 'brick'),
  { type: 'sensor', id: 'deckL', box: [23, -0.3, -1.2, 24.4, 0.6, 1.2], emit: 'deckL' },
  { type: 'mover', id: 'lift', box: [22, -0.4, -1.5, 25, 0, 1.5], to: [0, 9, 0], speed: 1.8, mode: 'toggle', on: { and: ['pump', { hold: 'deckL', for: 14 }] }, mat: 'metal' },
  blk(25, 0, -4, 31, 8.7, 4, 'brick'),
  blk(25, 8.7, -4, 31, 9, 4, 'cream'),
  blk(25, 9, -4, 31, 9.7, -3.6, 'brick'),
  blk(25, 9, 3.6, 31, 9.7, 4, 'brick'),
  { type: 'hint', key: 'catwalk', box: [25.4, 9, -3.6, 30.6, 13, 3.6] },
  prop('lamp', 26.4, 9, -3.2),
  { type: 'shard', pos: [27.6, 13.4, 2.4] },
  // two beds of flame, ten metres each and a rest between them. The flames stand on a tall plinth, a few metres below
  // the catwalk, so they are seen from it: a cloud rises over the first bed, rests (the gauge refills), and rises over the second
  { type: 'fire', id: 'bed', box: [31, 6.6, -4, 41, 8.2, 4] },
  blk(31, -1, -4, 41, 6.6, 4, 'dark'),
  blk(41, 0, -4, 47, 8.7, 4, 'brick'),
  blk(41, 8.7, -4, 47, 9, 4, 'cream'),
  blk(41, 9, -4, 47, 9.7, -3.6, 'brick'),
  blk(41, 9, 3.6, 47, 9.7, 4, 'brick'),
  { type: 'checkpoint', pos: [43, 9, 0] },
  { type: 'hint', key: 'rest', box: [41.4, 9, -3.6, 46.6, 13, 3.6] },
  prop('lamp', 44, 9, 3.2),
  { type: 'fire', id: 'bed2', box: [47, 6.6, -4, 57, 8.2, 4] },
  blk(47, -1, -4, 57, 6.6, 4, 'dark'),
  // the far gallery, and a ramp down to the floor
  blk(57, 0, -4, 63, 8.7, 4, 'brick'),
  blk(57, 8.7, -4, 63, 9, 4, 'cream'),
  blk(57, 9, -4, 63, 9.7, -3.6, 'brick'),
  blk(57, 9, 3.6, 63, 9.7, 4, 'brick'),
  prop('lamp', 60, 9, 3.2),
  { type: 'ramp', box: [63, 0, -4, 75, 9, 4], up: '-x', mat: 'cream' },
];

const control = [
  blk(0, -1, -4, 46, 0, 4, 'tile'),
  ...flanks(0, 46, 11),
  ...kerbs(14, 38),
  { type: 'checkpoint', pos: [2.4, 0, 0] },
  prop('lamp', 1.4, 0, -3.3),
  prop('lamp', 1.4, 0, 3.3),
  { type: 'hint', key: 'gap', box: [2.8, 0, -4, 4.8, 3, 4] },
  // a wall with a film-high gap, and the posts behind it that unshutter the next room
  blk(5.2, 0.3, -4, 6.6, 11, 4, 'brick'),
  { type: 'electrodes', id: 'eC', box: [8.4, 0, -0.7, 9.8, 0.4, 0.7], axis: 'x', emit: 'arcC' },
  prop('kiln', 9.6, 0, 3.2, { rot: 180, solid: false }),
  ...gate('doorS', 12, 0, 13, 'armed'),
  { type: 'hint', key: 'relay', box: [13, 0, -3.6, 15.8, 3, 3.6] },
  { type: 'crate', id: 'crate3', pos: [17.4, 0, -2.2] },
  { type: 'crate', id: 'crate3b', pos: [17.4, 0, 2.4] },
  { type: 'plate', id: 'pL', pos: [25, 0, 2.4], size: [1.6, 1.6], emit: 'pL' },
  { type: 'plate', id: 'pM', pos: [21.6, 0, 2.4], size: [1.6, 1.6], emit: 'pM' },
  prop('lamp', 16, 0, 3.3, { solid: false }),
  prop('pots', 19.6, 0, -3.8, { scale: 0.9, solid: false }),
  { type: 'hotfloor', id: 'hot4', box: [28.4, 0, -4, 31.4, 0.3, 4] },
  { type: 'plate', id: 'pH', pos: [35.6, 0, 0], size: [1.8, 1.8], heavy: true, emit: 'pH' },
  prop('lamp', 33, 0, -3.3),
  prop('pots', 36.8, 0, 3.0, { scale: 0.9 }),
  // the gate: a curtain of flame, too tall and wide to float over or round
  { type: 'fire', id: 'gate', box: [41, 0, -9, 42.6, 14, 9], on: '!gateOpen' },
  blk(41, -1, -9, 42.6, 0, 9, 'dark'),
];

const last = [
  blk(0, -1, -4, 58, 0, 4, 'tile'),
  ...flanks(0, 58, 8),
  ...kerbs(4, 26),
  { type: 'checkpoint', pos: [2.4, 0, 0] },
  prop('lamp', 1.4, 0, -3.3),
  prop('lamp', 1.4, 0, 3.3),
  { type: 'hint', key: 'last', box: [0.6, 0, -4, 3.8, 3, 4] },
  // two plates, hot strips between them, flames after: the flames stay out only while both timers run
  { type: 'crate', id: 'crate4', pos: [4.6, 0, -1.4] },
  { type: 'plate', id: 'pC', pos: [8.2, 0, 2.4], size: [1.6, 1.6], emit: 'pC' },
  { type: 'plate', id: 'hA', pos: [6.6, 0, -1.6], size: [1.8, 1.8], heavy: true, emit: 'hA' },
  { type: 'hotfloor', id: 'hot5', box: [9.6, 0, -4, 12.4, 0.3, 4] },
  prop('pots', 14.6, 0, -3.1, { scale: 0.9 }),
  prop('lamp', 22, 0, -3.3),
  { type: 'plate', id: 'hB', pos: [25, 0, 1.6], size: [1.8, 1.8], heavy: true, emit: 'hB' },
  { type: 'fire', id: 'last', box: [29, 0, -4, 45, 3.4, 4], on: '!dashF' },
  prop('lamp', 27.4, 0, -3.3),
  prop('lamp', 47.4, 0, -3.3),
  prop('lamp', 47.4, 0, 3.3),
  prop('kiln', 52, 0, 3.0, { rot: 180 }),
  blk(57.4, 0, -4, 58, 6, 4, 'brick'),
  { type: 'exit', pos: [55.6, 0, 0], face: '-x' },
];

// Extra lamp posts (world coordinates), so that a fall or a slip costs a few seconds and not a long walk back: along the reference
// route no stretch is more than about 20 m (4 s) from the last lit post. Every one stands on solid ground, clear of plates, doors and fire.
const LAMPS = [
  [25.7, 0, -0.1],
  [125.9, 0, 0.4],
  [166.4, 9, 0],
  [208.2, 0, 0],
  [236.8, 0, -1.1],
].map((pos) => ({ type: 'checkpoint', pos }));

export default {
  id: 'l11',
  name: 'Furnace Row',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  areas: [
    { name: 'The Stoke Hall', box: [-5, -5, X.dash, 5] },
    { name: 'The Furnace Dash', box: [X.dash, -5, X.lift, 5] },
    { name: 'The Lift Hall', box: [X.lift, -5, X.control, 5] },
    { name: 'The Control Room', box: [X.control, -5, X.last, 5] },
    { name: 'The Last Furnace', box: [X.last, -5, X.last + 58, 5] },
  ],
  hints: {
    start: 'Furnace Row. Hot tiles melt ice, flames never forgive, and some plates remember you a while after you leave.',
    hot: 'Hot tiles melt ice at once, and you cannot freeze on them. The heavy plate in there needs a crate.',
    dash: 'This plate puts the flames out for eight seconds after you step off. Hot tiles beyond turn ice into a runner. Go!',
    dash2: 'A second plate and a second eight seconds. Freeze on the platform, press it, step off and run.',
    pen: 'The next flames burn only while the timer runs. Wait here, safe, until they die; the ones behind you will relight.',
    lift: 'A bed of flame lies ahead, too wide to jump. The lift rises only while something rests on the pedal. Crates stay put.',
    catwalk: 'Flames are only so tall. From up here a cloud can float right over them. Keep an eye on the gauge.',
    rest: 'Solid ground refills the gauge. A second bed lies ahead, just as wide: rest, then float over again.',
    gap: 'A gap too low for a drop. {film} to crawl under, and lie across the two posts behind it.',
    relay: 'The gate flames die once all three plates have been down together a few seconds: two crates, and your own ice.',
    last: 'A crate on its plate, and two plates with timers: all three keep the flames out. Set the crate first.',
  },
  signals: {
    dash1: { hold: 'hp2', for: 8 },
    dash2: { hold: 'hp3', for: 8 },
    armed: { latch: 'arcC' },
    gateOpen: { latch: { delay: { and: ['pL', 'pM', 'pH'] }, for: 3 } },
    dashF: { and: [{ hold: 'hA', for: 18 }, { hold: 'hB', for: 12 }, 'pC'] },
  },
  pieces: [
    ...LAMPS,
    ...at(X.stoke, stoke),
    ...at(X.dash, dash),
    ...at(X.lift, lift),
    ...at(X.control, control),
    ...at(X.last, last),
  ],
};
