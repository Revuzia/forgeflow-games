// Level 11 - "Furnace Row". The old firing line: hot floors, kiln fire, and plates wired together.
//   1. Hot tiles melt ice and refuse to let you freeze, so the heavy plate sitting on them is out of
//      your reach - a crate does not mind (safe: nothing here can hurt you).
//   2. The furnace dash: a heavy plate puts the flames out for six seconds after you step off it, and
//      the hot tiles right behind it turn your ice into a runner at exactly the moment you need one.
//   3. The relay gate: the last flames die only when two plates are down at once - a crate holds the
//      near one while you, as ice, press the far one behind a hot strip. The gate then stays open.
// Signals used: hold (timed), and, latch, not. Layout runs along +X on one long floor.

export default {
  id: 'l11',
  name: 'Furnace Row',
  chapter: 3,
  theme: 'kiln',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'tense',
  hints: {
    start: 'Furnace Row. Hot tiles melt ice, flames never forgive, and some plates remember you a while after you leave.',
    hot: 'Hot tiles melt ice at once, and you cannot freeze on them. The heavy plate in there needs a crate.',
    dash: 'This plate puts the flames out for six seconds after you step off. Hot tiles beyond turn ice into a runner. Go!',
    relay: 'Flames stay lit until BOTH plates are down. The far one is heavy, behind hot tiles; a crate can hold the near one.',
  },
  signals: {
    dash: { hold: 'hp2', for: 6 },
    gateOpen: { latch: { and: ['pL', 'pH'] } },
  },
  pieces: [
    // --- hall 1: a crate, a hot patch with a heavy plate in it, a door
    { type: 'block', box: [-4, -1, -4, 15.4, 0, 4], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -4, -4, 0.8, 4], mat: 'brick' },
    { type: 'block', box: [-4, 0, -4, 15, 0.7, -3.6], mat: 'brick' },                // kerbs for the ice
    { type: 'block', box: [-4, 0, 3.6, 15, 0.7, 4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [1.0, 0, -2.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [2.6, 0, 2.5] },
    { type: 'prop', kind: 'lamp', pos: [4.6, 0, -3.0] },
    { type: 'prop', kind: 'lamp', pos: [13.4, 0, 3.0] },
    { type: 'shard', pos: [4.2, 0.7, 2.4] },
    { type: 'crate', id: 'crate1', pos: [6.2, 0, 0] },
    { type: 'hint', key: 'hot', box: [6.6, 0, -3.6, 8.4, 3, 3.6] },
    { type: 'hotfloor', id: 'hot1', box: [9, 0, -2.4, 12.6, 0.3, 2.4] },
    { type: 'plate', id: 'p1', pos: [10.3, 0, 0], size: [1.6, 1.6], heavy: true, emit: 'p1' },
    { type: 'block', box: [15, -1, -9, 15.4, 8, -1.2], mat: 'brick' },
    { type: 'block', box: [15, -1, 1.2, 15.4, 8, 9], mat: 'brick' },
    { type: 'block', box: [15, 3, -1.2, 15.4, 8, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorA', box: [15.03, 0, -1.2, 15.37, 3, 1.2], on: 'p1' },
    { type: 'checkpoint', pos: [16.8, 0, 0] },

    // --- hall 2: the furnace dash
    { type: 'block', box: [15.4, -1, -4, 34, 0, 4], mat: 'tile' },
    { type: 'prop', kind: 'lamp', pos: [16.8, 0, 3.4] },
    { type: 'hint', key: 'dash', box: [16.4, 0, -4, 18.2, 3, 4] },
    { type: 'plate', id: 'hp2', pos: [18.5, 0, 0], size: [1.6, 1.6], heavy: true, emit: 'hp2' },
    { type: 'hotfloor', id: 'hot2', box: [19.3, 0, -4, 21.3, 0.3, 4] },
    // flames across the whole corridor, with a notch in the far corner holding a shard
    { type: 'fire', id: 'flamesA', box: [22, 0, -4, 34, 3.4, 2.6], on: '!dash' },
    { type: 'fire', id: 'flamesB', box: [22, 0, 2.6, 27, 3.4, 4], on: '!dash' },
    { type: 'fire', id: 'flamesC', box: [30, 0, 2.6, 34, 3.4, 4], on: '!dash' },
    { type: 'shard', pos: [28.5, 0.7, 3.3] },
    // a catwalk above the flames: only a cloud that rose during the dash gets up there
    { type: 'block', box: [30, 4.2, -1.5, 34.4, 4.5, 1.5], mat: 'cream' },
    { type: 'shard', pos: [32, 5.2, 0] },

    // --- hall 3: the relay
    { type: 'block', box: [34, -1, -4, 66, 0, 4], mat: 'tile' },
    { type: 'block', box: [34.4, 0, -4, 66, 0.7, -3.6], mat: 'brick' },
    { type: 'block', box: [34.4, 0, 3.6, 66, 0.7, 4], mat: 'brick' },
    { type: 'checkpoint', pos: [36.4, 0, 0] },
    { type: 'prop', kind: 'lamp', pos: [35.8, 0, 3.0] },
    { type: 'prop', kind: 'kiln', pos: [41.6, 0, 2.6], rot: 180 },
    { type: 'hint', key: 'relay', box: [37, 0, -3.6, 39, 3, 3.6] },
    { type: 'crate', id: 'crate2', pos: [40, 0, -2.2] },
    { type: 'plate', id: 'pL', pos: [45.5, 0, -2.2], size: [1.6, 1.6], emit: 'pL' },
    { type: 'hotfloor', id: 'hot3', box: [48.5, 0, -4, 51, 0.3, 4] },
    { type: 'plate', id: 'pH', pos: [53, 0, 0], size: [1.6, 1.6], heavy: true, emit: 'pH' },
    { type: 'prop', kind: 'pots', pos: [55.4, 0, -3.0], scale: 0.9 },
    { type: 'prop', kind: 'lamp', pos: [56.6, 0, 3.0] },
    { type: 'fire', id: 'gate', box: [59.4, 0, -9, 61, 14, 9], on: '!gateOpen' },        // a curtain: too tall and wide to float over or round
    { type: 'block', box: [64.4, 0, -4, 65, 6, 4], mat: 'brick' },
    { type: 'exit', pos: [63, 0, 0], face: '-x' },
  ],
};
