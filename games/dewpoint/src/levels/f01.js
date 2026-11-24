// Fire 1 - "First Light". The opening of the Pilot Light chapter: a gentle, five-room tutorial
// walk through the cold stove rooms of the works. Ember only; no water yet. Layout runs along +X
// (see LEVELS.md section 10). Each area starts at a brazier and teaches one thing:
//   1 The Cold Stove Room  move, and light things by touching them. Three cold lanterns (the last
//                          on a plinth: the first little jump) and the door they open.
//   2 The Pot Shelves      jump: steps up (hold to go higher), stepping slabs over a void, then a
//                          rail platform that shuttles across a gap too wide to jump.
//   3 Lantern Gallery      reach: a lantern on a high ledge and one hung too high for the floor;
//                          the lift to the upper works wakes when all three burn and rides you up.
//   4 The Wick Walk        the first fuse: touch its frayed end, the flame runs to a gate. A
//                          short regrowing fuse and a door that will not wait guard a glow-stone.
//   5 The Kiln Hall        light both lanterns and a flame runs the length of the hall to the
//                          kindling that bricks up the kiln: it burns away and the kiln opens.
// The kiln-door pyre is lit by a signal, never by Cinder, so nothing can be burnt out of reach.
// Area origins (x): 1 -4, 2 34.5, 3 82, 4 114 (upper floor, y 3), 5 166. tests/solutions/f01.js
// uses the same numbers.

// ---------------------------------------------------------------------------- little builders
const floor = (x0, x1, y = 0, mat = 'tile', z0 = -5, z1 = 5) => ({ type: 'block', box: [x0, y - 1, z0, x1, y, z1], mat });
const walls = (x0, x1, y = 0, h = 3.6, mat = 'brick') => [
  { type: 'block', box: [x0, y, -5.5, x1, y + h, -5], mat },
  { type: 'block', box: [x0, y, 5, x1, y + h, 5.5], mat },
];
/** A doorway across the hall: two piers, a lintel and a door (3 m wide, 3 m tall). */
const gate = (x, y, id, on, time = 0.6) => [
  { type: 'block', box: [x, y, -5, x + 0.5, y + 3.6, -1.5], mat: 'brick' },
  { type: 'block', box: [x, y, 1.5, x + 0.5, y + 3.6, 5], mat: 'brick' },
  { type: 'block', box: [x, y + 3, -1.5, x + 0.5, y + 3.6, 1.5], mat: 'brick' },
  { type: 'door', id, box: [x + 0.05, y, -1.5, x + 0.45, y + 3, 1.5], on, time },
];

/** The saggar stacks of area 4: [x0, x1, top] steps up the hill and down the far side. */
const RIDGE = [[125, 128, 4.3], [128, 131, 5.6], [131, 134, 6.9], [134, 137, 8.2], [137, 140, 6.9], [140, 143, 5.6], [143, 146, 4.3]];
/** A wick laid up the front of every step and down the back (0.08 m off the faces), then along the floor to xEnd, then in to the gate. */
function wickPath(z, xStart, xEnd, base, steps) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const pts = [[xStart, base + 0.06, z]];
  let y = base + 0.06;
  for (const [x0, x1, top] of steps) {
    const ty = r2(top + 0.06);
    if (ty > y) { pts.push([r2(x0 - 0.08), y, z], [r2(x0 - 0.08), ty, z]); } else if (ty < y) { pts.push([r2(x0 + 0.08), y, z], [r2(x0 + 0.08), ty, z]); }
    y = ty;
  }
  const last = steps[steps.length - 1];
  pts.push([r2(last[1] + 0.08), y, z], [r2(last[1] + 0.08), base + 0.06, z], [xEnd, base + 0.06, z], [xEnd, base + 0.06, -1.45]);
  return pts;
}

export default {
  id: 'f01',
  element: 'fire',
  name: 'First Light',
  chapter: 1,
  theme: 'pilot',
  spawn: [0, 0, 0],
  camYaw: -90,
  music: 'calm',
  forms: ['ember'],
  hints: {
    start: 'Cinder is a live coal. Move with {move}; jump with {jump} and hold it to go higher.',
    lamp: 'A cold lantern. Brush against it: an ember lights whatever it touches.',
    brazier: 'Light the brazier. If Cinder is ever put out, it wakes here again, heat restored.',
    door: 'This door stays shut until every lantern in the room is burning.',
    shelf: 'Shelves ahead. Hold {jump} to go higher, and run at a gap to go further.',
    void: 'Fall off an edge and Cinder wakes at the last brazier. Take a run-up and jump across.',
    ferry: 'Too wide to jump. Hop on the rail platform: it carries you across while you stand on it.',
    trench: 'A gap in the gallery floor. Run at it and jump: you cannot fall further than the last brazier.',
    high: 'That lantern hangs too high to reach from the floor. Climb the ledge, then jump.',
    lift: 'The lift wakes when every lantern in the gallery burns. Step on it and it carries you up.',
    fuse: 'The frayed end of a fuse. Touch it, then watch where the flame runs.',
    dash: 'A short fuse, and a far door that will not wait. Light it and run.',
    kiln: 'The kiln is bricked up with kindling. Light both lanterns and see what happens.',
  },
  areas: [
    { name: 'The Cold Stove Room', box: [-4, -5, 34.5, 5] },
    { name: 'The Pot Shelves', box: [34.5, -5, 82, 5] },
    { name: 'Lantern Gallery', box: [82, -5, 114, 5] },
    { name: 'The Wick Walk', box: [114, -5, 166, 5] },
    { name: 'The Kiln Hall', box: [166, -5, 203, 5] },
  ],
  signals: {
    roomLit: { and: ['lampA1', 'lampA2', 'lampA3', 'lampA4'] },
    galleryLit: { and: ['lampG1', 'lampG2', 'lampG3'] },
    kilnLit: { and: ['lampK1', 'lampK2'] },
  },
  pieces: [
    // ======================================================== 1. The Cold Stove Room (x -4..34.5)
    floor(-4, 43),
    { type: 'block', box: [-4.5, 0, -5, -4, 0.8, 5], mat: 'brick' },
    ...walls(-4, 34.5),                                                            // side walls from the very start: nobody steps off the first screen
    { type: 'brazier', id: 'b1', pos: [4, 0, 0] },
    { type: 'hint', key: 'brazier', box: [2, 0, -5, 6, 3, 5] },
    { type: 'prop', kind: 'shelf', pos: [4.8, 0, 4.6], rot: 0 },
    { type: 'prop', kind: 'kiln', pos: [8.6, 0, -3.9], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [15, 0, 3.9] },
    { type: 'prop', kind: 'pipe', pos: [23, 0, -4.6], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [32, 0, 4.6] },
    { type: 'hint', key: 'lamp', box: [7, 0, -5, 13, 3, 5] },
    { type: 'lantern', id: 'lampA1', pos: [11, 0.95, 2.4], emit: 'lampA1' },
    { type: 'lantern', id: 'lampA2', pos: [17.5, 0.95, -2.4], emit: 'lampA2' },
    { type: 'block', box: [22.8, -1, 1.2, 25.2, 0.5, 3.6], mat: 'cream' },          // a plinth: the first little jump
    { type: 'lantern', id: 'lampA3', pos: [24, 1.45, 2.4], emit: 'lampA3' },
    { type: 'block', box: [28.8, -1, -3.6, 31.2, 1.0, -1.2], mat: 'cream' },        // a pedestal: hold jump a little longer
    { type: 'lantern', id: 'lampA4', pos: [30, 1.95, -2.4], emit: 'lampA4' },
    { type: 'hint', key: 'door', box: [31.6, 0, -5, 33.5, 3, 5] },
    ...gate(34, 0, 'doorA', 'roomLit', 2.4),

    // ======================================================== 2. The Pot Shelves (x 34.5..82)
    { type: 'brazier', id: 'b2', pos: [37.5, 0, 0] },
    ...walls(34.5, 82),
    { type: 'prop', kind: 'shelf', pos: [40.6, 0, -4.6], rot: 0 },
    { type: 'prop', kind: 'pots', pos: [38.6, 0, 3.9] },
    { type: 'hint', key: 'shelf', box: [39.5, 0, -5, 43, 3, 5] },
    { type: 'block', box: [43, -1, -5, 45.5, 0.5, 5], mat: 'cream' },
    { type: 'block', box: [45.5, -1, -5, 48, 1.0, 5], mat: 'cream' },
    { type: 'block', box: [48, -1, -5, 51, 1.4, 5], mat: 'cream' },
    { type: 'shard', pos: [49.2, 2.1, -3.9] },
    { type: 'hint', key: 'void', box: [49, 0, -5, 51, 5, 5] },
    { type: 'block', box: [54, -1, -2, 57.5, 1.4, 2], mat: 'tile' },
    { type: 'block', box: [60.3, -1, -5, 63.5, 1.0, -1.2], mat: 'tile' },
    { type: 'brazier', id: 'b2b', pos: [61.4, 1.0, -3.4] },                          // a waystation before the rail
    { type: 'hint', key: 'ferry', box: [59.5, 1, -5, 63.5, 5, 1] },
    { type: 'sensor', box: [64.2, 0.5, -4.6, 80.3, 4, -1.4], emit: 'onFerry', visible: false },
    { type: 'mover', id: 'ferry', box: [63.8, 0.6, -4.6, 67.0, 1.0, -1.4], to: [13.5, 0, 0], speed: 1.8, mode: 'toggle', on: 'onFerry', mat: 'metal' },
    { type: 'block', box: [80.8, -1, -5, 82, 1.0, 5], mat: 'tile' },
    { type: 'prop', kind: 'pots', pos: [81.2, 1.0, 3.6], scale: 0.6, solid: false },
    { type: 'prop', kind: 'pots', pos: [55.4, 1.4, 0.2], scale: 0.6, solid: false },

    // ======================================================== 3. Lantern Gallery (x 82..114)
    floor(82, 95),
    floor(97.8, 111),                                                              // a 2.8 m trench to jump
    { type: 'hint', key: 'trench', box: [92, 0, -5, 95, 3, 5] },
    { type: 'block', box: [111, -1, -5, 114, 0, -1.5], mat: 'tile' },
    { type: 'block', box: [111, -1, 1.5, 114, 0, 5], mat: 'tile' },
    { type: 'block', box: [111, -2, -1.5, 114, -0.6, 1.5], mat: 'dark' },            // the pit the lift rests in
    ...walls(82, 114, 0, 8.4),                                                      // the lantern blocks (top y 2.6) are far below the wall top
    { type: 'brazier', id: 'b3', pos: [84.5, 0, 0] },
    { type: 'prop', kind: 'pots', pos: [86, 0, -4.0], scale: 0.9 },
    { type: 'prop', kind: 'pipe', pos: [94, 0, 4.6], rot: 0 },
    { type: 'lantern', id: 'lampG1', pos: [93, 0.95, 2.6], emit: 'lampG1' },
    { type: 'block', box: [99, -1, -5, 102, 1.3, -1.3], mat: 'cream' },
    { type: 'block', box: [102, -1, -5, 105, 2.6, -1.3], mat: 'cream' },
    { type: 'lantern', id: 'lampG2', pos: [103.5, 3.55, -3.1], emit: 'lampG2' },
    { type: 'block', box: [106, -1, 1.3, 110, 1.3, 5], mat: 'cream' },
    { type: 'hint', key: 'high', box: [103, 0, 0, 110, 5, 5] },
    { type: 'lantern', id: 'lampG3', pos: [108, 3.9, 3.0], mount: 'hang', emit: 'lampG3' },
    { type: 'prop', kind: 'shelf', pos: [97, 0, 4.6], rot: 0 },
    { type: 'prop', kind: 'lamp', pos: [84, 0, 4.6] },
    // the lift: it rises while Cinder stands on it and sits down again when Cinder leaves
    { type: 'hint', key: 'lift', box: [108.5, 0, -5, 111.4, 3, 1.5] },
    { type: 'sensor', id: 'onLift', box: [111.4, -0.3, -1.4, 114, 6.5, 1.4], emit: 'onLift', visible: false },
    { type: 'mover', id: 'lift', box: [111, -0.5, -1.5, 114, 0, 1.5], to: [0, 3, 0], speed: 1.0, mode: 'toggle', on: { and: ['galleryLit', 'onLift'] }, mat: 'metal' },
    { type: 'block', box: [110.8, -1, -2, 114, 6.6, -1.5], mat: 'brick' },
    { type: 'block', box: [110.8, -1, 1.5, 114, 6.6, 2], mat: 'brick' },
    { type: 'block', box: [110.8, 3, -1.5, 111, 6.6, 1.5], mat: 'brick' },          // no stepping back off the top

    // ======================================================== 4. The Wick Walk (x 114..166, floor y 3)
    floor(114, 166, 3),
    ...walls(114, 166, 3, 8.4),
    { type: 'brazier', id: 'b4', pos: [117.5, 3, 0] },
    { type: 'hint', key: 'fuse', box: [118.5, 3, -5, 122.5, 6, 0] },
    // the saggar stacks: a hill of stacked firing boxes to climb and drop over. The wick climbs it too.
    ...RIDGE.map(([x0, x1, top]) => ({ type: 'block', box: [x0, 2, -5, x1, top, 5], mat: 'cream' })),
    { type: 'fuse', id: 'fuseC', path: wickPath(-3.8, 121, 147.4, 3, RIDGE), rate: 4.8, emit: 'fuseC' },
    { type: 'prop', kind: 'pots', pos: [122, 3, 3.9] },
    { type: 'prop', kind: 'shelf', pos: [118.6, 3, 4.6], rot: 0 },
    ...gate(148, 3, 'doorC', 'fuseC'),
    // past the gate: a short fuse, a door that will not wait, a glow-stone
    { type: 'prop', kind: 'lamp', pos: [151, 3, -4.6] },
    { type: 'hint', key: 'dash', box: [148.6, 3, 1.8, 153, 6, 5] },
    { type: 'fuse', id: 'fuseG', path: [[151, 3.06, 3.3], [154.3, 3.06, 3.3]], rate: 2.2, regrow: 2.2, emit: 'fuseG' },
    { type: 'block', box: [155.5, 3, 1.8, 156.3, 4.2, 5], mat: 'cream' },
    { type: 'block', box: [159, 3, 1.8, 163.4, 6.6, 2.2], mat: 'brick' },
    { type: 'block', box: [163, 3, 2.2, 163.4, 6.6, 5], mat: 'brick' },
    { type: 'block', box: [159, 6, 2.2, 159.4, 6.6, 5], mat: 'brick' },
    { type: 'door', id: 'doorG', box: [159.05, 3, 2.2, 159.35, 6, 5], on: { or: ['fuseG', 'inG'] } },
    { type: 'sensor', box: [159.4, 3, 2.2, 163, 6, 5], emit: 'inG', visible: false },   // it will not shut Cinder in
    { type: 'shard', pos: [161.4, 3.7, 3.4] },
    { type: 'prop', kind: 'shelf', pos: [157, 3, -4.6], rot: 0 },

    // ======================================================== 5. The Kiln Hall (x 166..203, floor y 3)
    floor(166, 172, 3),
    floor(174.8, 203, 3),                                                          // a 2.8 m trench to jump
    ...walls(166, 203, 3, 8.4),                                                     // 8.4 m: the ledge lanterns (top y 6.9) must not reach the wall top
    { type: 'brazier', id: 'b5', pos: [168.5, 3, 0] },
    { type: 'prop', kind: 'pots', pos: [170, 3, -3.9] },
    { type: 'hint', key: 'kiln', box: [169.6, 3, -5, 172, 6, 5] },
    { type: 'lantern', id: 'lampK1', pos: [177.5, 3.95, 3.0], emit: 'lampK1' },
    { type: 'block', box: [178.5, 2, -5, 181.5, 4.3, -1.8], mat: 'cream' },
    { type: 'block', box: [181.5, 2, -5, 184, 5.6, -1.8], mat: 'cream' },
    { type: 'block', box: [184, 2, -5, 186.5, 6.9, -1.8], mat: 'cream' },
    { type: 'lantern', id: 'lampK2', pos: [185.3, 7.85, -3.1], emit: 'lampK2' },
    { type: 'block', box: [189.9, 6.5, -5, 191.4, 6.9, -3.5], mat: 'cream' },
    { type: 'shard', pos: [190.65, 7.6, -4.25] },
    { type: 'prop', kind: 'pipe', pos: [182, 3, 4.6], rot: 0 },
    { type: 'prop', kind: 'shelf', pos: [187, 3, 4.6], rot: 0 },
    // the kiln mouth, bricked up with kindling. A flame from the two lanterns runs to it.
    { type: 'block', box: [189, 3, -3, 195, 6.6, -2.5], mat: 'brick' },
    { type: 'block', box: [189, 3, 2.5, 195, 6.6, 3], mat: 'brick' },
    { type: 'block', box: [195, 3, -3, 195.5, 6.6, 3], mat: 'brick' },
    { type: 'block', box: [189, 6, -2.5, 195, 6.6, 2.5], mat: 'brick' },
    { type: 'fuse', id: 'wickK', path: [[180, 3.06, -0.9], [185.4, 3.06, -0.9], [185.4, 3.06, 3.4], [187.6, 3.06, 3.4], [187.6, 3.06, -0.9], [188.6, 3.06, -0.9], [188.6, 3.06, 0]], rate: 4, on: 'kilnLit', emit: 'wickEnd' },
    { type: 'wood', id: 'pyre', kind: 'block', box: [189.2, 3, -2.5, 190.6, 6, 2.5], burn: 4.0, on: 'wickEnd', emit: 'pyreGone' },
    { type: 'exit', pos: [193, 3, 0], face: '-x', on: 'pyreGone' },
  ],
};
