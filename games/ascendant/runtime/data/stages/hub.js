/**
 * ASCENDANT — THE SANCTUM  (hub)
 * runtime/data/stages/hub.js
 *
 * The lobby, built as a real place rather than a menu with a skybox.
 *
 * An octagonal sanctum ~47 m across floating in a cloud void. Three concentric floor
 * tiers (each step 0.45 m, under TUNE.stepUp 0.55, so you glide up them without ever
 * pressing jump), an inlaid emblem, a low balustrade around the rim, and four portal
 * arches at the cardinal points — one per world, each pre-tinted to its palette.
 *
 * It is also WALKABLE and deliberately a little bit fun before you commit to anything:
 *   - a warm-up jump ring curving around the north-west rim (five rising pads),
 *   - an optional ledge climb on the south-west rim up to an overlook above the
 *     balustrade — miss it and you land on the floor, so it costs nothing to try,
 *   - a PRACTICE SPUR jutting out over the void on the south-east side carrying one
 *     moving platform and one vanish platform, so a new player meets both mechanics
 *     somewhere that cannot punish them: fall off and you land on a cloud shelf ten
 *     metres below and a jump pad throws you back up.
 *
 * HUB CONTRACT NOTES (see also runtime/data/index.js):
 *   - `isHub: true` and `finish: null`. Stage/Game MUST skip finish-trigger
 *     construction when `finish` is null. There is nothing to clear here.
 *   - `portals: [{world, p, yaw}]` is a top-level array so Game can wire each arch to
 *     a world without pattern-matching the object list. `p` is where the trigger
 *     stands (feet height); `yaw` is the heading the player already has when they
 *     walk into it, i.e. straight out through the arch.
 *   - `coins: []`. Coins belong to stages and count toward the run total; a lobby
 *     coin would be free score.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, so a top surface is p[1] + s[1]/2.
 *   rot = Euler radians [x,y,z]. yaw = radians, 0 faces +X, +PI/2 faces +Z.
 *   `stripe: true` marks a surface the player must JUMP to reach — it gets the bright
 *   leading-edge highlight. Floors you merely walk along do not get one, otherwise the
 *   highlight stops meaning anything.
 *
 * FLOOR HEIGHTS (absolute, referenced constantly below):
 *   outer tier top  -0.90     r 15.5 .. 23.3
 *   mid tier top    -0.45     r  7.9 .. 15.7
 *   core top         0.00     octagon, inradius 8.2
 *   pedestal top     1.32     three 0.44 m steps up from the core
 */

/* ---------------------------------------------------------------------------------- */
/* geometry helpers — the sanctum is radial, so it is built radially                    */
/* ---------------------------------------------------------------------------------- */

const D2R = Math.PI / 180;

/** Point on a circle of radius r at compass angle `deg` (0 deg = +X, 90 deg = +Z). */
function at(deg, r, y) {
  const t = deg * D2R;
  return [Math.cos(t) * r, y, Math.sin(t) * r];
}

/** Yaw that makes a radially-placed object face the sanctum CENTRE. */
function facingIn(deg) {
  return -deg * D2R - Math.PI / 2;
}

/** Yaw that makes a radially-placed object face OUT over the rim (and at an arrival). */
function facingOut(deg) {
  return Math.PI / 2 - deg * D2R;
}

/**
 * A ring of `count` box segments forming an annulus tier.
 * Each segment's local +X is radial and local +Z is tangential, so
 *   s = [radialDepth, thickness, tangentialWidth]
 * and neighbouring segments are made to overlap (width > arc spacing) so the union is
 * a continuous floor with no seams for the collider to catch on.
 */
function tier({ count, radius, radial, width, top, thick, mat, glow, startDeg = 0 }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const deg = startDeg + (360 / count) * i;
    out.push({
      kind: 'platform',
      p: at(deg, radius, top - thick / 2),
      s: [radial, thick, width],
      rot: [0, -deg * D2R, 0],
      mat,
      glow,
    });
  }
  return out;
}

/**
 * One portal gate: two legs, a lintel, the tinted energy panel, a floor plate you
 * physically stand on, the world's name in the air above it, and a tinted point light
 * that throws the world's colour back across the sanctum floor. Nothing here is
 * landable — the lintel sits 5 m up and the legs are 1.1 m thick walls.
 */
function portalArch({ deg, tint, label, sub, floorTop }) {
  const t = deg * D2R;
  const ry = -t;
  const R = 21.0;
  // tangential unit vector, used to push the two legs apart
  const tx = -Math.sin(t);
  const tz = Math.cos(t);
  const cx = Math.cos(t) * R;
  const cz = Math.sin(t) * R;
  const leg = (sign) => [cx + tx * 2.9 * sign, floorTop + 2.45, cz + tz * 2.9 * sign];

  return [
    // structure
    { kind: 'deco', kindOf: 'pillar', p: leg(-1), s: [1.2, 4.9, 1.2], rot: [0, ry, 0], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: leg(+1), s: [1.2, 4.9, 1.2], rot: [0, ry, 0], mat: 'obsidian' },
    {
      kind: 'deco', kindOf: 'arch',
      p: [cx, floorTop + 5.35, cz], s: [1.5, 1.0, 7.6], rot: [0, ry, 0],
      mat: 'obsidian', tint,
    },
    // the gate itself
    {
      kind: 'deco', kindOf: 'panel',
      p: [cx, floorTop + 2.25, cz], s: [0.22, 4.3, 4.9], rot: [0, ry, 0],
      mat: 'emissive', tint,
    },
    // the plate you stand on to travel — flush with the floor, tinted, unmissable
    {
      kind: 'deco', kindOf: 'emblem',
      p: [cx - Math.cos(t) * 1.2, floorTop + 0.03, cz - Math.sin(t) * 1.2],
      s: [3.0, 0.06, 4.6], rot: [0, ry, 0], mat: 'emissive', tint,
    },
    // banners either side, hung from the lintel
    { kind: 'deco', kindOf: 'banner', p: [cx + tx * 2.9, floorTop + 3.5, cz + tz * 2.9], s: [0.12, 2.6, 1.5], rot: [0, ry, 0], tint },
    { kind: 'deco', kindOf: 'banner', p: [cx - tx * 2.9, floorTop + 3.5, cz - tz * 2.9], s: [0.12, 2.6, 1.5], rot: [0, ry, 0], tint },
    // signage, facing back into the sanctum so you can read it on approach
    { kind: 'text', p: [cx - Math.cos(t) * 0.9, floorTop + 4.15, cz - Math.sin(t) * 0.9], rot: [0, facingIn(deg), 0], text: label, size: 0.72, color: tint },
    { kind: 'text', p: [cx - Math.cos(t) * 0.9, floorTop + 3.45, cz - Math.sin(t) * 0.9], rot: [0, facingIn(deg), 0], text: sub, size: 0.3, color: 0x8ea9c9 },
    // light
    { kind: 'light', p: [cx - Math.cos(t) * 2.0, floorTop + 2.4, cz - Math.sin(t) * 2.0], color: tint, intensity: 11, distance: 26 },
  ];
}

/* Tier heights, named so the numbers below never drift apart. */
const OUTER = -0.90;
const MID = -0.45;
const CORE = 0.0;

/* World accents — duplicated from WORLDS in ../index.js on purpose: a stage def must
 * stay a pure leaf with no imports, so the harness can read it in isolation. */
const NEON = 0x7ef0ff;
const FOUNDRY = 0xff8a3c;
const SPIRE = 0xa8e4ff;
const TEMPLE = 0xffd27a;

/* The player arrives on the outer tier at 157.5 deg, looking straight at the pedestal. */
const ARRIVE_DEG = 157.5;
const ARRIVE = at(ARRIVE_DEG, 19.5, OUTER + 0.1);
/* Arrival heading, in the DATA convention this file documents above (yaw 0 faces
 * +X, +PI/2 faces +Z): from a point at ARRIVE_DEG on the ring, the heading that
 * looks back at the centre is simply ARRIVE_DEG + 180.
 *
 * This read `facingIn(ARRIVE_DEG) + Math.PI / 2`, which mixes two spaces:
 * facingIn() returns a MESH rotation.y (that is what it is used for — the `rot:`
 * on each plinth's text), and adding PI/2 to it collapses to -ARRIVE_DEG, i.e.
 * -157.5 deg. The comment beside it already stated the intended value, -22.5
 * deg; only the expression disagreed. Spawn yaw is read through Game._spawnFor,
 * which converts THIS convention into a controller heading, so the mismatch
 * aimed the arrival 135 deg away from the pedestal it is meant to face. */
const ARRIVE_YAW = (ARRIVE_DEG + 180) * D2R;   // 337.5 deg == -22.5 deg, i.e. inward

export default {
  id: 'hub',
  world: 'hub',
  theme: 'hub',
  name: 'THE SANCTUM',
  subtitle: 'Four gates, one long way down',
  isHub: true,
  difficulty: 0,
  par: null,

  spawn: { p: ARRIVE, yaw: ARRIVE_YAW },
  killY: -55, // falling off the rim costs a heartbeat and nothing else
  finish: null, // <- see HUB CONTRACT NOTES above
  coins: [],
  checkpoints: [{ p: ARRIVE, yaw: ARRIVE_YAW, clockOffset: 0 }],

  /** Game reads this to wire each arch. Order matches WORLDS. */
  portals: [
    { world: 'neon', p: [20.6, OUTER + 0.1, 0], yaw: 0 },
    { world: 'foundry', p: [0, OUTER + 0.1, 20.6], yaw: Math.PI / 2 },
    { world: 'spire', p: [-20.6, OUTER + 0.1, 0], yaw: Math.PI },
    { world: 'temple', p: [0, OUTER + 0.1, -20.6], yaw: -Math.PI / 2 },
  ],

  objects: [
    /* ============================================================================ */
    /* THE FLOOR — three tiers, each a 0.45 m auto-step above the last               */
    /* ============================================================================ */

    // Outer promenade. Twelve segments, 11.2 m wide against a 10.2 m arc spacing, so
    // they overlap and the walking surface has no seams.
    ...tier({ count: 12, radius: 19.4, radial: 7.9, width: 11.2, top: OUTER, thick: 1.4, mat: 'stone', glow: 0x2c4c6e }),

    // Mid ring.
    ...tier({ count: 12, radius: 11.8, radial: 7.9, width: 7.6, top: MID, thick: 1.4, mat: 'stone', glow: 0x36597e }),

    // Core: two squares crossed at 45 deg make a clean octagon, inradius 8.2.
    { kind: 'platform', p: [0, CORE - 0.7, 0], s: [16.4, 1.4, 16.4], mat: 'obsidian', glow: 0x4a7fb0 },
    { kind: 'platform', p: [0, CORE - 0.7, 0], s: [16.4, 1.4, 16.4], rot: [0, Math.PI / 4, 0], mat: 'obsidian', glow: 0x4a7fb0 },

    // The inlaid emblem — a flush plate, not a platform, so it can never be jumped to.
    { kind: 'deco', kindOf: 'emblem', p: [0, CORE + 0.02, 0], s: [15.2, 0.04, 15.2], mat: 'emissive', tint: 0x63b8ff },
    { kind: 'deco', kindOf: 'emblem', p: [0, CORE + 0.03, 0], s: [10.6, 0.04, 10.6], rot: [0, Math.PI / 4, 0], mat: 'emissive', tint: 0x2f6ea8 },

    /* ============================================================================ */
    /* BALUSTRADE — waist-high, with the four cardinal bays left open for the gates  */
    /* ============================================================================ */

    // Eight rail runs at 30 deg spacing, skipping 0/90/180/270 where the arches stand.
    ...[30, 60, 120, 150, 210, 240, 300, 330].map((deg) => ({
      kind: 'platform',
      p: at(deg, 22.5, OUTER + 0.575),
      s: [0.55, 1.15, 10.8],
      rot: [0, -deg * D2R, 0],
      mat: 'metal',
      glow: 0x4f86bd,
    })),

    // Twelve newel posts on the joints, so the rail reads as built rather than extruded.
    ...Array.from({ length: 12 }, (_, i) => {
      const deg = 15 + i * 30;
      return { kind: 'deco', kindOf: 'post', p: at(deg, 22.5, OUTER + 0.85), s: [0.7, 1.7, 0.7], rot: [0, -deg * D2R, 0], mat: 'metal' };
    }),

    // Buttresses under the rim, seen only from the void side — they give the sanctum
    // a bottom, which is what stops it reading as a floating disc.
    ...Array.from({ length: 8 }, (_, i) => {
      const deg = 22.5 + i * 45;
      return { kind: 'deco', kindOf: 'buttress', p: at(deg, 21.4, OUTER - 3.4), s: [3.2, 6.4, 2.4], rot: [0, -deg * D2R, 0], mat: 'obsidian' };
    }),

    /* ============================================================================ */
    /* COLONNADE — eight pillars on the outer tier carrying the world banners        */
    /* ============================================================================ */

    ...Array.from({ length: 8 }, (_, i) => {
      const deg = 22.5 + i * 45;
      return { kind: 'deco', kindOf: 'pillar', p: at(deg, 16.9, OUTER + 4.85), s: [1.5, 9.7, 1.5], rot: [0, -deg * D2R, 0], mat: 'obsidian' };
    }),
    ...Array.from({ length: 8 }, (_, i) => {
      const deg = 22.5 + i * 45;
      const tint = [NEON, FOUNDRY, FOUNDRY, SPIRE, SPIRE, TEMPLE, TEMPLE, NEON][i];
      return { kind: 'deco', kindOf: 'banner', p: at(deg, 16.9, OUTER + 6.3), s: [0.14, 4.6, 2.8], rot: [0, -deg * D2R, 0], tint };
    }),

    /* ============================================================================ */
    /* BRAZIERS — eight fires ringing the core, the only warm light in the sanctum   */
    /* ============================================================================ */

    ...Array.from({ length: 8 }, (_, i) => {
      const deg = i * 45;
      return { kind: 'deco', kindOf: 'brazier', p: at(deg, 10.4, MID + 0.75), s: [1.1, 1.5, 1.1], rot: [0, -deg * D2R, 0], mat: 'metal', tint: 0xffb066 };
    }),
    ...Array.from({ length: 8 }, (_, i) => {
      const deg = i * 45;
      return { kind: 'light', p: at(deg, 10.4, MID + 1.9), color: 0xffa85c, intensity: 7.5, distance: 15, flicker: 0.28 };
    }),

    /* ============================================================================ */
    /* THE PEDESTAL — three walkable 0.44 m steps and the shard that lights the room */
    /* ============================================================================ */

    // Each step is a SOLID block resting on the core floor, not a 0.44 m shelf stacked
    // on the one below it. Tops are unchanged (0.44 / 0.88 / 1.32, three 0.44 m risers
    // under TUNE.stepUp 0.55) and each smaller block leaves the ring of the one beneath
    // it exposed, so it reads exactly as before — but there is no longer a 0.44 m void
    // between the core deck and the underside of step 2, which geomcheck correctly read
    // as a ceiling 0.44 m over 30% of the core floor.
    { kind: 'platform', p: [0, CORE + 0.22, 0], s: [9.0, 0.44, 9.0], rot: [0, Math.PI / 8, 0], mat: 'obsidian', glow: 0x5aa8e6 },
    { kind: 'platform', p: [0, CORE + 0.44, 0], s: [6.4, 0.88, 6.4], rot: [0, Math.PI / 4, 0], mat: 'obsidian', glow: 0x5aa8e6 },
    { kind: 'platform', p: [0, CORE + 0.66, 0], s: [4.3, 1.32, 4.3], mat: 'obsidian', glow: 0x7ecdff },

    { kind: 'deco', kindOf: 'monolith', p: [0, CORE + 2.52, 0], s: [2.2, 2.4, 2.2], rot: [0, Math.PI / 4, 0], mat: 'obsidian', tint: 0x3d7fb8 },
    { kind: 'deco', kindOf: 'crystal', p: [0, CORE + 5.9, 0], s: [1.7, 3.1, 1.7], mat: 'crystal', tint: 0x9adcff },
    { kind: 'deco', kindOf: 'ring', p: [0, CORE + 5.9, 0], s: [4.6, 0.18, 4.6], rot: [0.32, 0, 0.14], mat: 'emissive', tint: 0x63b8ff },
    { kind: 'light', p: [0, CORE + 5.4, 0], color: 0x9adcff, intensity: 16, distance: 30 },

    // Title, hung so it reads from the arrival point.
    { kind: 'text', p: at(ARRIVE_DEG, 4.6, CORE + 3.9), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'ASCENDANT', size: 0.88, color: 0xdff1ff },
    { kind: 'text', p: at(ARRIVE_DEG, 4.6, CORE + 3.15), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'STEP THROUGH A GATE TO BEGIN', size: 0.26, color: 0x7f9dbd },

    /* ============================================================================ */
    /* THE FOUR GATES                                                               */
    /* ============================================================================ */

    ...portalArch({ deg: 0, tint: NEON, label: 'NEON DOJO', sub: 'RAIN AND REFLECTED LIGHT', floorTop: OUTER }),
    ...portalArch({ deg: 90, tint: FOUNDRY, label: 'LAVA FOUNDRY', sub: 'THE FLOOR IS RISING', floorTop: OUTER }),
    ...portalArch({ deg: 180, tint: SPIRE, label: 'FROZEN SPIRE', sub: 'NOTHING HERE HOLDS STILL', floorTop: OUTER }),
    ...portalArch({ deg: 270, tint: TEMPLE, label: 'SKY TEMPLE', sub: 'ALL OF IT AT ONCE', floorTop: OUTER }),

    /* ============================================================================ */
    /* TUTORIAL SIGNAGE — on the radial you are already walking down from the spawn  */
    /* ============================================================================ */

    { kind: 'text', p: at(ARRIVE_DEG, 15.6, OUTER + 1.95), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'MOVE   W A S D', size: 0.46, color: 0xcfe6ff },
    { kind: 'text', p: at(ARRIVE_DEG, 15.6, OUTER + 1.42), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'mouse to look', size: 0.24, color: 0x6f8dac },

    { kind: 'text', p: at(ARRIVE_DEG, 12.2, MID + 1.95), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'JUMP   SPACE', size: 0.46, color: 0xcfe6ff },
    { kind: 'text', p: at(ARRIVE_DEG, 12.2, MID + 1.42), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'hold it longer to jump higher', size: 0.24, color: 0x6f8dac },

    { kind: 'text', p: at(ARRIVE_DEG, 9.0, MID + 1.95), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'SPRINT   SHIFT', size: 0.46, color: 0xcfe6ff },
    { kind: 'text', p: at(ARRIVE_DEG, 9.0, MID + 1.42), rot: [0, facingOut(ARRIVE_DEG), 0], text: 'crouch CTRL   restart R', size: 0.24, color: 0x6f8dac },

    /* ============================================================================ */
    /* WARM-UP RING — five rising pads curving along the north-west rim              */
    /* Centre spacing 5.07 m on a 19.4 m arc, pads 2.2 wide -> 2.9 m edge gaps, and  */
    /* the crown pad is 1.8 m above the promenade. Falling off costs nothing.        */
    /* ============================================================================ */

    ...[
      { deg: 105, top: OUTER + 0.6, w: 2.2 },
      { deg: 120, top: OUTER + 1.2, w: 2.2 },
      { deg: 135, top: OUTER + 1.8, w: 2.5 },
      { deg: 150, top: OUTER + 1.2, w: 2.2 },
      { deg: 165, top: OUTER + 0.6, w: 2.2 },
    ].map((d) => ({
      kind: 'platform',
      p: at(d.deg, 19.4, d.top - 1.2),
      s: [d.w, 2.4, d.w],
      rot: [0, -d.deg * D2R, 0],
      mat: 'panel',
      glow: 0x7ef0ff,
      stripe: true,
    })),

    // A hoop over the crown pad, purely so there is something to aim through.
    { kind: 'deco', kindOf: 'ring', p: at(135, 19.4, OUTER + 4.0), s: [0.16, 3.4, 3.4], rot: [0, -135 * D2R, 0], mat: 'emissive', tint: 0x7ef0ff },
    { kind: 'text', p: at(139, 19.4, OUTER + 2.9), rot: [0, facingIn(139), 0], text: 'WARM UP', size: 0.34, color: 0x7ef0ff },

    /* ============================================================================ */
    /* LEDGE CLIMB + OVERLOOK — south-west rim, 16 deg apart on r 19.0, so every hop */
    /* is a 5.29 m chord minus the two tangential half-widths. Miss and you land on   */
    /* the promenade, which is the whole point of putting it here.                    */
    /*                                                                               */
    /* HEADROOM: the first two are PLINTHS — solid blocks sunk to OUTER-2.30, the     */
    /* same way the warm-up ring is built — because at 0.7 m thick their undersides   */
    /* hung 1.30 m over the promenade you walk along at deg 192-208, i.e. below head  */
    /* height on the main lobby floor. A plinth has no underside to duck. The upper    */
    /* two stay thin floating slabs: at 2.30 m and 3.75 m their undersides clear the   */
    /* promenade by 3.20 m and 4.65 m, which is roof enough to walk under upright.     */
    /*                                                                               */
    /* RHYTHM: rises now read +0.60, +1.40, +1.80, +1.40, +1.00 rather than four      */
    /* identical +1.4 steps, and each block is a different size. Every hop stays       */
    /* inside the run envelope (+1.8 m rise -> 3.0 m safe; the widest gap here is      */
    /* 2.79 m edge to edge).                                                          */
    /* ============================================================================ */

    ...[
      // radial depth + tangential width, the walkable top, and how far the block
      // reaches DOWN. base below OUTER = a plinth; base just under top = a slab.
      { deg: 192, top: OUTER + 0.60, base: OUTER - 2.30, radial: 2.9, width: 2.6 },
      { deg: 208, top: OUTER + 2.00, base: OUTER - 2.30, radial: 2.6, width: 2.4 },
      { deg: 224, top: OUTER + 3.80, base: OUTER + 3.20, radial: 2.4, width: 2.6 },
      { deg: 240, top: OUTER + 5.20, base: OUTER + 4.65, radial: 2.2, width: 2.4 },
    ].map((d) => ({
      kind: 'platform',
      p: at(d.deg, 19.0, (d.top + d.base) / 2),
      s: [d.radial, d.top - d.base, d.width],
      rot: [0, -d.deg * D2R, 0],
      mat: 'panel',
      glow: 0xa8e4ff,
      stripe: true,
    })),

    // The overlook itself: 5.3 m up, above the balustrade, the best view in the game.
    { kind: 'platform', p: at(254, 21.0, OUTER + 6.2 - 0.45), s: [3.6, 0.9, 3.6], rot: [0, -254 * D2R, 0], mat: 'panel', glow: 0xa8e4ff, stripe: true },
    { kind: 'deco', kindOf: 'beacon', p: at(254, 21.0, OUTER + 7.6), s: [0.5, 1.6, 0.5], rot: [0, -254 * D2R, 0], mat: 'emissive', tint: 0xa8e4ff },
    { kind: 'light', p: at(254, 21.0, OUTER + 7.8), color: 0xa8e4ff, intensity: 8, distance: 18 },
    { kind: 'text', p: at(250, 19.6, OUTER + 6.9), rot: [0, facingIn(250), 0], text: 'OVERLOOK', size: 0.32, color: 0xa8e4ff },

    /* ============================================================================ */
    /* PRACTICE SPUR — south-east, along the +X axis at z = -11.5 so the mover runs  */
    /* on a clean axis. Deck top 0.90. Three 0.45 m steps up from the mid tier.      */
    /* Everything past x = 20.3 hangs over the void; the cloud shelf ten metres below */
    /* catches you and a jump pad returns you. Nothing here can kill.                */
    /* ============================================================================ */

    { kind: 'platform', p: [4.8, -1.00, -11.5], s: [1.6, 2.0, 3.2], mat: 'stone', glow: 0x36597e }, // top  0.00
    { kind: 'platform', p: [6.4, -0.775, -11.5], s: [1.6, 2.45, 3.2], mat: 'stone', glow: 0x36597e }, // top 0.45
    { kind: 'platform', p: [8.0, -0.55, -11.5], s: [1.6, 2.9, 3.2], mat: 'stone', glow: 0x36597e }, // top 0.90

    // Briefing deck.
    { kind: 'platform', p: [11.6, -0.35, -11.5], s: [5.6, 2.5, 4.4], mat: 'panel', glow: 0x7ef0ff },
    { kind: 'text', p: [9.6, 2.55, -11.5], rot: [0, -Math.PI / 2, 0], text: 'PRACTICE', size: 0.52, color: 0x7ef0ff },
    { kind: 'text', p: [9.6, 1.95, -11.5], rot: [0, -Math.PI / 2, 0], text: 'one mover, one vanish tile, no consequences', size: 0.23, color: 0x6f8dac },

    // BEAT — the mover. Boards at x 17.0 (2.6 m from the deck edge at 14.4), carries
    // you 8 m out over the rim and dwells at both ends so you are never rushed.
    {
      kind: 'mover',
      p: [18.6, 0.40, -11.5],
      s: [3.2, 1.0, 3.6],
      mat: 'metal',
      motion: { type: 'linear', to: [26.6, 0.40, -11.5], period: 6.4, phase: 0, ease: 'sine', dwell: 0.9 },
    },

    // BEAT — the vanish tile. Gap 2.6 m from the mover's far edge at 28.2. Generous
    // 3.6 s on, 1.0 s warning, 1.8 s off: you can watch a full cycle before stepping.
    {
      kind: 'vanish',
      p: [32.4, 0.40, -11.5],
      s: [3.2, 1.0, 3.4],
      mat: 'panel',
      cycle: { on: 3.6, off: 1.8, warn: 1.0, phase: 0 },
    },

    // Landing. Gap 2.6 m.
    { kind: 'platform', p: [39.1, 0.40, -11.5], s: [5.0, 1.0, 5.0], mat: 'panel', glow: 0x7ef0ff, stripe: true },
    { kind: 'deco', kindOf: 'beacon', p: [39.1, 1.9, -11.5], s: [0.5, 2.0, 0.5], mat: 'emissive', tint: 0x7ef0ff },
    { kind: 'light', p: [39.1, 2.6, -11.5], color: 0x7ef0ff, intensity: 9, distance: 20 },
    { kind: 'text', p: [39.1, 3.5, -11.5], rot: [0, -Math.PI / 2, 0], text: 'READY', size: 0.42, color: 0x7ef0ff },

    // Guide rail along the spur so the eye has a line to follow out over the void.
    { kind: 'deco', kindOf: 'rail', p: [24.0, 1.3, -13.6], s: [26.0, 0.12, 0.12], mat: 'metal', tint: 0x4f86bd },
    { kind: 'deco', kindOf: 'rail', p: [24.0, 1.3, -9.4], s: [26.0, 0.12, 0.12], mat: 'metal', tint: 0x4f86bd },

    /* -- the cloud shelf that makes the spur consequence-free ------------------- */

    { kind: 'platform', p: [30.0, -9.90, -11.5], s: [32.0, 1.8, 18.0], mat: 'cloud', surface: 'bounce', props: { power: 1.2 } },
    { kind: 'jumppad', p: [22.0, -8.93, -11.5], s: [3.2, 0.14, 3.2], power: 11.5, dir: [0, 1, 0] },
    { kind: 'jumppad', p: [36.0, -8.93, -11.5], s: [3.2, 0.14, 3.2], power: 11.5, dir: [0, 1, 0] },
    { kind: 'text', p: [29.0, -7.4, -11.5], rot: [0, -Math.PI / 2, 0], text: 'THE CLOUDS CATCH YOU', size: 0.4, color: 0xa8c8e8 },
    { kind: 'light', p: [22.0, -7.6, -11.5], color: 0x7ef0ff, intensity: 6, distance: 16 },
    { kind: 'light', p: [36.0, -7.6, -11.5], color: 0x7ef0ff, intensity: 6, distance: 16 },

    /* ============================================================================ */
    /* THE VOID — everything below and beyond, so the sanctum reads as SUSPENDED     */
    /* All of it far outside the play corridor or far below it; none of it can be    */
    /* mistaken for something to land on.                                           */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'cloud', p: [0, -24, 0], s: [16, 3, 16], count: 18, spread: [150, 14, 150], seed: 1701, scale: 1.6, tint: 0x9fc4e8 },
    { kind: 'deco', kindOf: 'cloud', p: [0, -40, 0], s: [22, 4, 22], count: 12, spread: [220, 18, 220], seed: 90210, scale: 2.4, tint: 0x6d8fb4 },
    { kind: 'deco', kindOf: 'monolith', p: [0, -18, 0], s: [7, 22, 7], count: 9, spread: [190, 46, 190], seed: 4242, scale: 1.0, tint: 0x1d3550 },
    { kind: 'deco', kindOf: 'shard', p: [0, 16, 0], s: [2.2, 7, 2.2], count: 14, spread: [120, 30, 120], seed: 77, scale: 1.0, tint: 0x2b4f74 },

    // Four distant sky beacons on the diagonals, one per world tint, so the horizon
    // is not empty in any direction you might turn.
    { kind: 'deco', kindOf: 'beacon', p: at(45, 96, 22), s: [3, 30, 3], mat: 'emissive', tint: FOUNDRY },
    { kind: 'deco', kindOf: 'beacon', p: at(135, 104, 26), s: [3, 34, 3], mat: 'emissive', tint: SPIRE },
    { kind: 'deco', kindOf: 'beacon', p: at(225, 92, 18), s: [3, 26, 3], mat: 'emissive', tint: TEMPLE },
    { kind: 'deco', kindOf: 'beacon', p: at(315, 110, 30), s: [3, 32, 3], mat: 'emissive', tint: NEON },

    /* ============================================================================ */
    /* KEY LIGHTING — the theme supplies key/fill/rim; these are the practical lamps */
    /* ============================================================================ */

    { kind: 'light', p: [0, 12, 0], color: 0x9fd6ff, intensity: 22, distance: 60 },
    { kind: 'light', p: at(ARRIVE_DEG, 17.5, OUTER + 4.2), color: 0xbcd8f5, intensity: 8, distance: 22 },
    { kind: 'light', p: at(135, 19.4, OUTER + 3.4), color: 0x7ef0ff, intensity: 7, distance: 18, flicker: 0.06 },
    { kind: 'light', p: at(224, 19.0, OUTER + 4.4), color: 0xa8e4ff, intensity: 7, distance: 18 },
  ],

  /** Slightly cooler and further-reaching fog than a stage — you should see the void. */
  ambience: {
    fog: { near: 26, far: 190 },
    particles: { type: 'mote', rate: 0.55 },
  },
};
