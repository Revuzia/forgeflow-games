// Level 2 - "Cold Shoulder". Teaches ice: it shoves crates, presses heavy plates, builds speed
// downhill and smashes cracked glass, and melts on hot floor. Finale mixes film and ice.

export default {
  id: 'l02',
  name: 'Cold Shoulder',
  chapter: 1,
  theme: 'slip',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['liquid', 'film', 'ice'],
  hints: {
    start: '{ice} to freeze. Ice is heavy, slippery, and strong enough to shove a crate.',
    heavy: 'A heavy plate ignores a mere drop. It wants ice - or something that stays put.',
    slide: 'Ice gathers speed downhill. Fast ice goes straight through cracked glass.',
    hot: 'Hot tiles melt ice back into a drop.',
    lock: 'The kiln door is shut. Something heavy on the far side of that wall might open it.',
  },
  signals: {
    exitOpen: { latch: 'hp2' },
  },
  pieces: [
    // --- hall A: crate + heavy plate hold the door
    { type: 'block', box: [-4, -1, -5, 12, 0, 5], mat: 'tile' },
    { type: 'block', box: [-4.5, 0, -5, -4, 0.8, 5], mat: 'brick' },
    // kerbs: ice cannot hop them (it clears 0.55 m at most), so a slide never ends in the void
    { type: 'block', box: [-4.5, 0, -5.4, 12, 0.7, -5], mat: 'brick' },
    { type: 'block', box: [-4.5, 0, 5, 12, 0.7, 5.4], mat: 'brick' },
    { type: 'prop', kind: 'kiln', pos: [0.6, 0, -3.8], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [5.6, 0, -4.4] },
    { type: 'crate', id: 'crate', pos: [4, 0, 2.5] },
    { type: 'hint', key: 'heavy', box: [5.5, 0, 0.5, 10.5, 3, 5] },
    { type: 'plate', id: 'hp1', pos: [8, 0, 2.5], size: [1.7, 1.7], heavy: true, emit: 'hp1' },
    { type: 'shard', pos: [8, 3.05, 2.5] },
    { type: 'block', box: [12, 0, -5, 12.5, 3.6, -1.2], mat: 'brick' },
    { type: 'block', box: [12, 0, 1.2, 12.5, 3.6, 5], mat: 'brick' },
    { type: 'block', box: [12, 3, -1.2, 12.5, 3.6, 1.2], mat: 'brick' },
    { type: 'door', id: 'doorA', box: [12.05, 0, -1.2, 12.45, 3, 1.2], on: 'hp1' },

    // --- up the ramp to the slide
    { type: 'block', box: [12, -1, -5, 16, 0, 5], mat: 'tile' },
    { type: 'ramp', box: [16, 0, -3, 22, 3, 3], up: '+x', mat: 'cream' },
    { type: 'block', box: [22, -1, -5, 28, 3, 5], mat: 'tile' },
    { type: 'checkpoint', pos: [24, 3, 0] },
    { type: 'block', box: [25, 3, -4.6, 26.4, 4.2, -3.2], mat: 'cream' },
    { type: 'shard', pos: [25.7, 5.0, -3.9] },
    { type: 'prop', kind: 'lamp', pos: [23, 3, 4.3] },
    { type: 'hint', key: 'slide', box: [22.5, 3, -3, 27.5, 6, 3] },
    { type: 'block', box: [28, -1, -5, 62, 0, 5], mat: 'tile' },
    { type: 'ramp', box: [28, 0, -3, 36, 3, 3], up: '-x', mat: 'cream' },
    { type: 'block', box: [28, 0, -5.4, 62, 0.7, -5], mat: 'brick' },
    { type: 'block', box: [28, 0, 5, 62, 0.7, 5.4], mat: 'brick' },
    // cracked pane across the run-out
    { type: 'block', box: [40, 0, -5, 40.3, 3.6, -2], mat: 'brick' },
    { type: 'block', box: [40, 0, 2, 40.3, 3.6, 5], mat: 'brick' },
    { type: 'pane', id: 'pane', box: [40.03, 0, -2, 40.27, 3.6, 2], speed: 9 },
    // hot tiles
    { type: 'hint', key: 'hot', box: [41, 0, -5, 43.6, 3, 5] },
    { type: 'hotfloor', box: [44, 0, -5, 47, 0.3, 5] },

    // --- finale: locked exit this side, heavy plate beyond the low wall
    { type: 'hint', key: 'lock', box: [47.6, 0, -5, 51.5, 3, 5] },
    { type: 'exit', pos: [49.6, 0, -3.9], face: '+z', on: 'exitOpen' },
    { type: 'block', box: [48, 0, -5, 51.2, 3.6, -4.7], mat: 'brick' },
    { type: 'block', box: [52, 0.3, -5, 53.5, 3.6, 5], mat: 'brick' },
    { type: 'plate', id: 'hp2', pos: [56.2, 0, 0], size: [1.7, 1.7], heavy: true, emit: 'hp2' },
    { type: 'block', box: [58.5, 0, -5, 59, 3.6, 5], mat: 'brick' },
    // third shard: up two steps in the plate room
    { type: 'block', box: [54, 0, 3.4, 55.4, 1.2, 5], mat: 'cream' },
    { type: 'block', box: [55.4, 0, 3.4, 56.8, 2.4, 5], mat: 'cream' },
    { type: 'shard', pos: [56.1, 3.2, 4.2] },
    { type: 'prop', kind: 'pots', pos: [57.6, 0, -4] },
    { type: 'prop', kind: 'lamp', pos: [57.8, 0, 4.2] },
  ],
};
