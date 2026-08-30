/**
 * ASCENDANT — LAVA FOUNDRY 2 : "PRESSURE"
 * runtime/data/stages/foundry-2.js
 *
 * HEADER NUMBERS ARE PLACEHOLDERS UNTIL THE MEASURE PASS — see the bottom of this
 * comment. Do not quote them before re-running the harness.
 */

// Theme palette (runtime/world/themes.js -> THEMES.foundry.palette), quoted here so a
// stage never invents a colour the world does not own.
const EMBER = 0xffb44a; // palette.accent       — lit trim, signage, coin markers
const MOLTEN = 0xff4a10; // palette.kill        — ONLY things that are trying to kill you
const EDGE = 0xa8e6ff; // palette.safeEdge      — every landable surface you must jump to
const IRON = 0x8b94a4; // palette.safe          — landable surfaces you walk onto
const MINT = 0x56ffd0; // palette.checkpointOn  — the ten checkpoint decks, nothing else
const VIOLET = 0xc9a6ff; // palette.finish      — the cooling floor, nothing else
const SLAG = 0x2a2320; // palette.deco          — unlit background mass
const RUST = 0x9a7b62; // sub-headline text

export default {
  id: 'foundry-2',
  world: 'foundry',
  name: 'PRESSURE',
  subtitle: 'The machines were here first',
  par: 205000,
  difficulty: 6,

  spawn: { p: [-3.0, 6.1, 0], yaw: 0 },
  killY: -25,

  checkpoints: [
    { p: [8.4, 6.1, 0], yaw: 0, clockOffset: 0 },
    { p: [35.6, 5.5, 0.8], yaw: 0, clockOffset: 0 },
    { p: [61.0, 6.7, 2.0], yaw: 0, clockOffset: 0.9 },
    { p: [83.0, 8.9, 1.2], yaw: 0 },
    { p: [111.5, 7.5, 1.2], yaw: 0 },
    { p: [138.3, 11.1, 0.6], yaw: 0 },
    { p: [171.1, 9.5, -8.4], yaw: 0 },
    { p: [203.7, 11.4, -6.6], yaw: 0 },
    { p: [265.8, 11.0, -1.0], yaw: 0 },
    { p: [295.9, 11.0, 0.6], yaw: 0 },
  ],

  finish: { p: [306.4, 15.0, 0], yaw: 0 },

  coins: [
    { p: [41.1, 6.9, -5.8] },
    { p: [61.0, 8.2, 1.4] },
    { p: [115.1, 5.5, -7.0] },
    { p: [215.0, 10.2, 6.0] },
  ],

  objects: [
    /* BEAT 1 — THE CHARGING FLOOR */
    { kind: 'platform', p: [2, 5.5, 0], s: [16, 1, 14], mat: 'stone', glow: MINT },
    { kind: 'platform', p: [-1.4, 6.2, 5.0], s: [2.4, 1, 2.4], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [1.8, 6.8, 5.0], s: [2.2, 1, 2.2], mat: 'metal', glow: EDGE, stripe: true },

    { kind: 'text', p: [5.0, 9.2, -4.4], rot: [0, -Math.PI / 2, 0], text: 'PRESSURE', size: 0.82, color: EMBER },
    { kind: 'text', p: [5.0, 8.55, -4.4], rot: [0, -Math.PI / 2, 0], text: 'LAVA FOUNDRY  ·  II', size: 0.28, color: RUST },
    { kind: 'text', p: [5.0, 8.0, -4.4], rot: [0, -Math.PI / 2, 0], text: 'the machines were here first', size: 0.24, color: RUST },
    { kind: 'text', p: [9.6, 8.4, 0.6], rot: [0, -Math.PI / 2, 0], text: 'CASTING FLOOR  ·  NOTHING HERE HOLDS', size: 0.3, color: MOLTEN },

    { kind: 'deco', kindOf: 'girders', p: [11.6, 11.4, 0], s: [1.2, 1.0, 15.0], count: 3, spread: [1, 2, 14], seed: 6011, mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'pillar', p: [11.6, 8.6, 6.8], s: [1.3, 6.4, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [11.6, 8.6, -6.8], s: [1.3, 6.4, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'brazier', p: [6.4, 6.9, -6.0], s: [1.0, 1.4, 1.0], mat: 'metal', tint: MOLTEN },
    { kind: 'light', p: [6.4, 8.0, -6.0], color: MOLTEN, intensity: 8, distance: 16, flicker: 0.34 },
    { kind: 'light', p: [2, 9.4, 0], color: 0xffd2a0, intensity: 9, distance: 26 },

    /* BEAT 2 — THE CASTING SHELLS */
    {
      kind: 'mover', p: [15.2, 5.9, 0], s: [3.6, 1, 3.6], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.34, sinkSpeed: 5.0, sinkDepth: 7, respawnAfter: 3.2, to: [15.2, -1.1, 0] },
    },
    {
      kind: 'mover', p: [21.5, 5.3, -3.0], s: [3.0, 1, 3.2], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.28, sinkSpeed: 6.0, sinkDepth: 7, respawnAfter: 3.0, to: [21.5, -1.7, -3.0] },
    },
    {
      kind: 'mover', p: [28.4, 6.1, -0.6], s: [3.2, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.24, sinkSpeed: 6.5, sinkDepth: 7, respawnAfter: 3.0, to: [28.4, -0.9, -0.6] },
    },

    { kind: 'platform', p: [35.6, 4.9, 0.8], s: [4.4, 1, 4.6], mat: 'stone', glow: MINT, stripe: true },

    {
      kind: 'mover', p: [41.1, 5.5, -5.8], s: [2.6, 1, 2.6], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.18, sinkSpeed: 7.5, sinkDepth: 7, respawnAfter: 3.6, to: [41.1, -1.5, -5.8] },
    },
    {
      kind: 'mover', p: [41.3, 5.7, -3.4], s: [2.8, 1, 2.8], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.30, sinkSpeed: 5.5, sinkDepth: 7, respawnAfter: 3.4, to: [41.3, -1.3, -3.4] },
    },
    {
      kind: 'mover', p: [47.8, 5.3, 0.2], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.22, sinkSpeed: 7.0, sinkDepth: 7, respawnAfter: 3.4, to: [47.8, -1.7, 0.2] },
    },
    {
      kind: 'mover', p: [53.6, 6.5, 3.0], s: [2.6, 1, 2.6], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.20, sinkSpeed: 8.0, sinkDepth: 7, respawnAfter: 3.4, to: [53.6, -0.5, 3.0] },
    },

    { kind: 'platform', p: [61.0, 6.1, 2.0], s: [8.0, 1, 8.4], mat: 'stone', glow: MINT, stripe: true },

    { kind: 'lava', p: [32.5, 0.5, 0], s: [47, 3, 26] },

    { kind: 'deco', kindOf: 'ring', p: [41.1, 7.6, -5.8], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'light', p: [41.1, 7.8, -5.8], color: EMBER, intensity: 7, distance: 14 },
    { kind: 'text', p: [12.6, 9.4, 0.0], rot: [0, -Math.PI / 2, 0], text: 'DO NOT STOP', size: 0.56, color: MOLTEN },
    { kind: 'text', p: [12.6, 8.8, 0.0], rot: [0, -Math.PI / 2, 0], text: 'the shells only hold once', size: 0.24, color: RUST },
    { kind: 'deco', kindOf: 'pillar', p: [35.6, 9.6, 0.8], s: [1.0, 8.0, 1.0], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [35.6, 14.2, 0.8], s: [0.7, 2.4, 0.7], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'pipes', p: [30, 12.4, 9.4], s: [40, 0.7, 0.7], count: 4, spread: [40, 1.4, 1.6], seed: 6021, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'pipes', p: [30, 13.1, -9.8], s: [40, 0.7, 0.7], count: 4, spread: [40, 1.4, 1.6], seed: 6022, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'vent', p: [19.0, 6.6, 8.4], s: [2.0, 1.6, 2.0], mat: 'metal' },
    { kind: 'deco', kindOf: 'vent', p: [45.0, 6.4, -8.6], s: [1.6, 1.2, 1.6], mat: 'metal' },
    { kind: 'light', p: [22, 3.4, 0], color: MOLTEN, intensity: 14, distance: 30, flicker: 0.13 },
    { kind: 'light', p: [46, 3.4, 0], color: MOLTEN, intensity: 14, distance: 30, flicker: 0.13 },
    { kind: 'light', p: [35.6, 7.8, 0.8], color: MINT, intensity: 8, distance: 20 },

    /* BEAT 3 — THE WRECKING BALL */
    {
      kind: 'pendulum', p: [61.0, 15.9, 1.4], len: 7.4, amp: 0.95, period: 3.6, phase: 0,
      axis: [1, 0, 0], mode: 'ball', radius: 1.2, blade: { w: 2.4, h: 2.4, d: 2.4 },
    },

    { kind: 'platform', p: [69.6, 6.9, 4.6], s: [2.8, 1, 2.8], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [75.0, 7.7, 1.2], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [83.0, 8.3, 1.2], s: [5.4, 1, 6.4], mat: 'panel', glow: MINT, stripe: true },

    { kind: 'lava', p: [71.0, 0.5, 0], s: [30, 3, 26] },

    { kind: 'text', p: [56.4, 10.4, 1.6], rot: [0, -Math.PI / 2, 0], text: 'IT IS ONLY LOW IN THE MIDDLE', size: 0.3, color: MOLTEN },
    { kind: 'deco', kindOf: 'buttress', p: [61.0, 17.2, 7.2], s: [1.6, 3.2, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [61.0, 17.2, -4.4], s: [1.6, 3.2, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cable', p: [63, 16.8, 1.4], s: [22, 0.1, 0.1], mat: 'metal', tint: SLAG },
    { kind: 'light', p: [61.0, 12.8, 1.4], color: EMBER, intensity: 11, distance: 24 },
    { kind: 'light', p: [61.0, 8.6, 1.4], color: MOLTEN, intensity: 6, distance: 14, flicker: 0.1 },

    /* BEAT 4 — THE POUR */
    { kind: 'platform', p: [90.7, 6.1, -2.6], s: [4.0, 1, 4.4], mat: 'grate', glow: EDGE, stripe: true },
    { kind: 'platform', p: [98.1, 6.5, 1.4], s: [3.6, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true },
    { kind: 'platform', p: [103.9, 6.1, -1.8], s: [3.2, 1, 3.4], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [111.5, 6.9, 1.2], s: [4.4, 1, 5.0], mat: 'stone', glow: MINT, stripe: true },
    {
      kind: 'vanish', p: [118.3, 7.4, -1.6], s: [3.6, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true,
      cycle: { on: 2.4, off: 1.2, warn: 0.6, phase: 0.2 },
    },
    { kind: 'platform', p: [125.0, 8.3, 1.6], s: [3.4, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true },
    { kind: 'platform', p: [130.8, 9.0, -1.2], s: [3.0, 1, 3.4], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [138.3, 10.5, 0.6], s: [5.6, 1, 6.4], mat: 'stone', glow: MINT, stripe: true },

    { kind: 'platform', p: [109.7, 4.5, -6.4], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [115.1, 4.1, -7.0], s: [2.6, 1, 2.6], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [120.8, 5.7, -4.8], s: [2.8, 1, 2.8], mat: 'metal', glow: EDGE, stripe: true },

    { kind: 'risinglava', p: [110.0, 0.5, 0], s: [48, 3, 26], rising: { from: 2.0, to: 6.2, speed: 0.30, delay: 44 } },

    { kind: 'deco', kindOf: 'ring', p: [115.1, 6.2, -7.0], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'light', p: [115.1, 6.6, -7.0], color: EMBER, intensity: 7, distance: 14 },
    { kind: 'text', p: [79.6, 11.0, 1.2], rot: [0, -Math.PI / 2, 0], text: 'THE POUR IS COMING UP', size: 0.5, color: MOLTEN },
    { kind: 'text', p: [79.6, 10.4, 1.2], rot: [0, -Math.PI / 2, 0], text: 'the sump goes under first', size: 0.24, color: RUST },
    { kind: 'deco', kindOf: 'buttress', p: [96.0, 13.4, 6.6], s: [1.6, 2.8, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [118.0, 13.4, -6.6], s: [1.6, 2.8, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cable', p: [110, 15.4, 0], s: [46, 0.09, 0.09], mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'screen', p: [108, 12.4, -12.0], s: [0.4, 4.4, 6.0], mat: 'emissive', tint: MOLTEN },
    { kind: 'deco', kindOf: 'slabs', p: [100.0, 3.0, 11.4], s: [3.0, 2.0, 3.0], count: 5, spread: [40, 1.2, 3], seed: 6041, tint: SLAG },
    { kind: 'light', p: [94, 4.4, 0], color: MOLTEN, intensity: 16, distance: 32, flicker: 0.16 },
    { kind: 'light', p: [126, 4.4, 0], color: MOLTEN, intensity: 16, distance: 32, flicker: 0.16 },
    { kind: 'light', p: [138.3, 13.0, 0.6], color: MINT, intensity: 9, distance: 22 },

    /* BEAT 5 — THE TRANSFER */
    { kind: 'platform', p: [145.1, 9.3, 0.6], s: [2.0, 1, 4.6], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'conveyor', p: [150.6, 9.3, 0.6], s: [9.0, 1, 4.6], dir: [-1, 0, 0], power: 9.0, mat: 'metal' },
    {
      kind: 'laser', a: [150.6, 10.15, -2.8], b: [150.6, 10.15, 4.0], radius: 0.16,
      cycle: { on: 1.4, off: 2.0, warn: 0.5, phase: 0 }, color: MOLTEN,
    },
    {
      kind: 'laser', a: [150.6, 11.45, -2.8], b: [150.6, 11.45, 4.0], radius: 0.16,
      cycle: { on: 1.4, off: 2.0, warn: 0.5, phase: 0 }, color: MOLTEN,
    },
    { kind: 'platform', p: [159.5, 8.9, 0.6], s: [4.4, 1, 5.0], mat: 'panel', glow: EDGE, stripe: true },

    { kind: 'platform', p: [165.3, 8.9, 4.0], s: [2.0, 1, 4.0], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'conveyor', p: [171.1, 8.9, -0.6], s: [9.6, 1, 9.6], dir: [0, 0, -1], power: 9.0, mat: 'metal' },
    { kind: 'crusher', p: [171.1, 12.5, -0.6], s: [3.0, 1.5, 5.0], axis: [0, -1, 0], travel: 2.35, period: 3.3, phase: 0.35, dwell: 0.6 },
    { kind: 'platform', p: [171.1, 8.9, -8.4], s: [5.0, 1, 6.0], mat: 'stone', glow: MINT, stripe: true },

    { kind: 'lava', p: [167.0, 0.5, 0], s: [66, 3, 32] },

    { kind: 'text', p: [143.4, 12.0, 0.6], rot: [0, -Math.PI / 2, 0], text: 'THE BELT RUNS AT YOU', size: 0.44, color: MOLTEN },
    { kind: 'text', p: [143.4, 11.45, 0.6], rot: [0, -Math.PI / 2, 0], text: '9.0 m/s against you  ·  SPRINT', size: 0.24, color: RUST },
    { kind: 'text', p: [163.6, 11.6, 3.0], rot: [0, -Math.PI / 2, 0], text: 'TRANSFER  ·  IT TAKES YOU LEFT', size: 0.32, color: EMBER },
    { kind: 'deco', kindOf: 'buttress', p: [150.6, 13.4, 4.6], s: [1.6, 3.0, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [150.6, 13.4, -3.4], s: [1.6, 3.0, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [171.1, 15.0, 5.6], s: [1.6, 2.8, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [151, 10.6, -2.2], s: [12, 0.09, 0.09], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'monolith', p: [160, 12.0, -19.0], s: [7, 22, 7], mat: 'obsidian', tint: SLAG },
    { kind: 'light', p: [150.6, 12.2, 0.6], color: MOLTEN, intensity: 10, distance: 22, flicker: 0.12 },
    { kind: 'light', p: [171.1, 11.4, -0.6], color: MOLTEN, intensity: 9, distance: 20, flicker: 0.1 },
    { kind: 'light', p: [171.1, 11.4, -8.4], color: MINT, intensity: 9, distance: 22 },

    /* BEAT 6 — THE SLAG STAIR AND THE TURN */
    { kind: 'platform', p: [179.0, 9.7, -8.4], s: [4.0, 1, 4.4], mat: 'panel', glow: EDGE, stripe: true },
    { kind: 'platform', p: [185.6, 10.9, -5.0], s: [3.6, 1, 4.0], mat: 'panel', glow: EDGE, stripe: true },
    { kind: 'beam', p: [193.5, 11.35, -2.0], s: [7.0, 0.7, 1.0], mat: 'metal', glow: EDGE },
    { kind: 'beam', p: [197.55, 11.55, -5.0], s: [1.1, 0.7, 6.4], mat: 'metal', glow: EDGE },
    { kind: 'platform', p: [203.7, 10.8, -6.6], s: [6.4, 1, 7.0], mat: 'stone', glow: MINT, stripe: true },

    { kind: 'text', p: [188.6, 13.0, -3.4], rot: [0, -Math.PI / 2, 0], text: 'NARROW  ·  AND IT TURNS', size: 0.3, color: EMBER },
    { kind: 'deco', kindOf: 'rail', p: [193.5, 12.8, -1.2], s: [7.0, 0.08, 0.08], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'rail', p: [198.4, 13.0, -5.0], s: [0.08, 0.08, 6.4], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'lantern', p: [190.4, 12.6, -1.2], s: [0.6, 0.9, 0.6], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'lantern', p: [198.4, 12.8, -8.6], s: [0.6, 0.9, 0.6], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'girders', p: [186.0, 5.0, -14.0], s: [10, 4.0, 3.0], count: 5, spread: [18, 5, 4], seed: 6061, mat: 'metal', tint: SLAG },
    { kind: 'light', p: [195.4, 13.4, -3.4], color: EMBER, intensity: 9, distance: 22 },

    /* BEAT 7 — THE LADLE GANTRY */
    { kind: 'platform', p: [214.3, 10.2, 1.4], s: [10, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true },
    {
      kind: 'rotor', p: [214.3, 14.05, 1.4], style: 'windmill', arms: 2, len: 3.0, thick: 0.5,
      period: 2.2, phase: 0, axis: [0, 0, 1], tilt: 0,
    },

    { kind: 'platform', p: [212.5, 8.8, 5.6], s: [2.4, 1, 2.2], mat: 'obsidian', glow: EDGE, stripe: true },
    { kind: 'platform', p: [217.6, 9.2, 6.4], s: [2.4, 1, 2.2], mat: 'obsidian', glow: EDGE, stripe: true },

    { kind: 'platform', p: [224.0, 11.4, -1.0], s: [3.4, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [229.6, 12.6, 1.8], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true },
    { kind: 'platform', p: [238.5, 13.2, 0.2], s: [8.0, 1, 2.4], mat: 'panel', glow: EDGE, stripe: true },
    { kind: 'platform', p: [248.0, 11.8, -2.2], s: [3.4, 1, 3.4], mat: 'metal', glow: EDGE, stripe: true },

    { kind: 'platform', p: [256.3, 11.0, 0.6], s: [8.0, 1, 2.6], mat: 'grate', glow: EDGE, stripe: true },
    {
      kind: 'pendulum', p: [256.3, 19.24, 0.6], len: 6.4, amp: 0.7, period: 3.3, phase: Math.PI / 3,
      axis: [0, 0, 1], mode: 'blade', blade: { w: 2.6, h: 1.8, d: 0.28 },
    },

    { kind: 'platform', p: [265.8, 10.4, -1.0], s: [5.0, 1, 5.0], mat: 'stone', glow: MINT, stripe: true },

    {
      kind: 'vanish', p: [273.4, 10.0, 1.0], s: [3.4, 1, 3.2], mat: 'grate', glow: EDGE, stripe: true,
      cycle: { on: 2.2, off: 1.1, warn: 0.5, phase: 0.0 },
    },
    { kind: 'crusher', p: [276.6, 11.9, 4.6], s: [2.2, 2.2, 1.8], axis: [0, 0, -1], travel: 3.6, period: 3.3, phase: 0.4, dwell: 0.9 },
    {
      kind: 'vanish', p: [279.8, 10.0, 1.0], s: [3.4, 1, 3.2], mat: 'grate', glow: EDGE, stripe: true,
      cycle: { on: 2.2, off: 1.1, warn: 0.5, phase: 0.5 },
    },
    { kind: 'platform', p: [286.8, 10.6, -0.6], s: [5.0, 1, 4.6], mat: 'stone', glow: EDGE, stripe: true },

    { kind: 'spikes', p: [235.0, 8.2, 1.6], s: [54, 1.2, 14], dir: [0, 1, 0] },

    { kind: 'text', p: [207.6, 13.4, 1.4], rot: [0, -Math.PI / 2, 0], text: 'THE LADLE GANTRY', size: 0.62, color: MOLTEN },
    { kind: 'text', p: [207.6, 12.7, 1.4], rot: [0, -Math.PI / 2, 0], text: 'four machines  ·  no two alike', size: 0.26, color: RUST },
    { kind: 'text', p: [250.6, 14.2, 0.6], rot: [0, -Math.PI / 2, 0], text: 'IT SWINGS AT YOU, NOT ACROSS', size: 0.3, color: MOLTEN },
    { kind: 'text', p: [269.8, 12.6, 1.0], rot: [0, -Math.PI / 2, 0], text: 'ONE HALF AT A TIME', size: 0.3, color: EMBER },
    { kind: 'deco', kindOf: 'ladle', p: [238.5, 6.6, 0.2], s: [9.0, 9.0, 9.0], mat: 'obsidian', tint: SLAG },
    { kind: 'deco', kindOf: 'ring', p: [215.0, 10.2, 6.0], s: [0.12, 2.0, 2.0], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'buttress', p: [214.3, 15.6, 5.0], s: [1.5, 3.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [238.5, 17.0, -4.4], s: [1.5, 3.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [276.6, 13.8, 7.2], s: [1.5, 3.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'grate', p: [240.0, 23.0, 0], s: [70, 0.2, 6.0], mat: 'grate', tint: SLAG },
    { kind: 'deco', kindOf: 'rail', p: [214.3, 11.9, -0.7], s: [10, 0.09, 0.09], mat: 'metal', tint: MOLTEN },
    { kind: 'deco', kindOf: 'rail', p: [256.3, 12.2, 2.1], s: [8, 0.09, 0.09], mat: 'metal', tint: MOLTEN },
    { kind: 'light', p: [214.3, 13.2, 1.4], color: MOLTEN, intensity: 11, distance: 24, flicker: 0.09 },
    { kind: 'light', p: [238.5, 16.0, 0.2], color: EMBER, intensity: 10, distance: 24 },
    { kind: 'light', p: [256.3, 14.0, 0.6], color: MOLTEN, intensity: 11, distance: 24, flicker: 0.09 },
    { kind: 'light', p: [276.6, 12.8, 1.0], color: EMBER, intensity: 9, distance: 20 },
    { kind: 'light', p: [203.7, 13.0, -6.6], color: MINT, intensity: 9, distance: 22 },
    { kind: 'light', p: [265.8, 13.0, -1.0], color: MINT, intensity: 9, distance: 22 },

    /* BEAT 8 — THE TAP */
    { kind: 'platform', p: [295.9, 10.4, 0.6], s: [6.0, 1, 7.0], mat: 'stone', glow: MINT, stripe: true },
    { kind: 'jumppad', p: [297.4, 10.97, 0.6], s: [3, 0.14, 3], power: 7.2, dir: [0, 1, 0] },
    { kind: 'platform', p: [306.4, 14.4, 0], s: [10, 1, 11], mat: 'obsidian', glow: VIOLET, stripe: true },

    { kind: 'lava', p: [250.0, 0.5, 0], s: [100, 3, 32] },

    { kind: 'text', p: [291.4, 12.8, 0.6], rot: [0, -Math.PI / 2, 0], text: 'THE TAP', size: 0.62, color: VIOLET },
    { kind: 'text', p: [291.4, 12.2, 0.6], rot: [0, -Math.PI / 2, 0], text: 'walk on  ·  it does the rest', size: 0.24, color: RUST },
    { kind: 'text', p: [303.4, 17.2, 0], rot: [0, -Math.PI / 2, 0], text: 'PRESSURE', size: 0.44, color: VIOLET },
    { kind: 'deco', kindOf: 'arch', p: [306.4, 20.4, 0], s: [1.4, 1.0, 11.4], mat: 'obsidian', tint: VIOLET },
    { kind: 'deco', kindOf: 'pillar', p: [306.4, 17.8, 5.4], s: [1.3, 5.8, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [306.4, 17.8, -5.4], s: [1.3, 5.8, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [310.6, 17.0, 0], s: [0.7, 3.0, 0.7], mat: 'emissive', tint: VIOLET },
    { kind: 'light', p: [306.4, 18.4, 0], color: VIOLET, intensity: 20, distance: 34 },
    { kind: 'light', p: [295.9, 12.8, 0.6], color: MINT, intensity: 10, distance: 22 },

    /* THE FOUNDRY — everything outside the play corridor */
    { kind: 'deco', kindOf: 'monolith', p: [50, 6.0, 27], s: [9, 30, 9], count: 7, spread: [120, 14, 20], seed: 6091, tint: SLAG },
    { kind: 'deco', kindOf: 'monolith', p: [50, 4.0, -27], s: [9, 30, 9], count: 7, spread: [120, 14, 20], seed: 6092, tint: SLAG },
    { kind: 'deco', kindOf: 'monolith', p: [220, 6.0, 29], s: [11, 36, 11], count: 8, spread: [170, 16, 22], seed: 6093, tint: 0x33221a },
    { kind: 'deco', kindOf: 'monolith', p: [220, 4.0, -29], s: [11, 36, 11], count: 8, spread: [170, 16, 22], seed: 6094, tint: 0x33221a },

    { kind: 'deco', kindOf: 'pipes', p: [150, 20.0, 14.5], s: [260, 0.9, 0.9], count: 5, spread: [260, 2, 2], seed: 6095, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'pipes', p: [150, 21.4, -14.5], s: [260, 0.9, 0.9], count: 5, spread: [260, 2, 2], seed: 6096, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'cable', p: [150, 24.0, 0], s: [290, 0.1, 0.1], mat: 'metal', tint: 0x1a1310 },
    { kind: 'deco', kindOf: 'antennae', p: [150, 14, 33], s: [0.7, 18, 0.7], count: 7, spread: [280, 6, 12], seed: 6097, tint: SLAG },

    { kind: 'deco', kindOf: 'emblem', p: [86, 15.6, 12.8], s: [0.4, 3.4, 3.4], mat: 'emissive', tint: MOLTEN },
    { kind: 'deco', kindOf: 'banner', p: [180, 14.0, 13.4], s: [0.14, 6.0, 3.2], mat: 'panel', tint: MOLTEN },
    { kind: 'deco', kindOf: 'banner', p: [244, 15.0, -13.4], s: [0.14, 6.0, 3.2], mat: 'panel', tint: EMBER },
    { kind: 'deco', kindOf: 'rocks', p: [150, 0.4, 18], s: [3, 2, 3], count: 14, spread: [290, 1.4, 14], seed: 6098, tint: 0x1c1310 },
    { kind: 'deco', kindOf: 'rocks', p: [150, 0.4, -18], s: [3, 2, 3], count: 14, spread: [290, 1.4, 14], seed: 6099, tint: 0x1c1310 },

    { kind: 'light', p: [10, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [72, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [186, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [232, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [284, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
  ],
};
