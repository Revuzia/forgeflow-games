/**
 * CRESTBOUND — THE KEEP  (runtime/data/keep.js)
 * ===========================================================================
 * CONTRACT §26. The hub, authored as a real castle you would want to walk
 * through rather than a menu with a skybox behind it.
 *
 * WHAT IS HERE
 * ------------
 *   LOBBY HALL      40 x 26 m, 14 m to the coffered ceiling. A grand double
 *                   stair (two flights up the flanks to a landing, one wide
 *                   flight up the middle) climbs to the gallery. Four banner
 *                   pillars, a crest mosaic inlaid in the floor, five tall
 *                   windows down the east wall that throw god rays across the
 *                   room, and the three VERDANT paintings hanging in the west
 *                   aisle. Nim spawns on the mosaic looking straight at them.
 *   GALLERY         y 6.30, a full loop of walkway around the lobby void plus
 *                   a long hall running north and a library nook where OLD FEN
 *                   sits among the bookcases and explains the moveset. The
 *                   three RIME paintings hang here. A balcony pushes out over
 *                   the courtyard and stops 6.0 m short of a garden loft —
 *                   the long-jump practice gap, with a coin arc over it.
 *   UNDERCROFT      y -8.00. Brick, torchlight and four EMBER paintings.
 *                   Reached down a 23-step spiral stair, or by ground-pounding
 *                   the secret grate in the lobby floor and landing in the hay.
 *                   An iron door (10 crests) opens on the WYRM STAIR.
 *   WYRM STAIR      The west turret: a 540 deg walking ramp spirals up the
 *                   inside of the drum from the undercroft to a chute mouth
 *                   17 m up, and a second, tighter corkscrew of sandboard
 *                   chute drops back down its middle and shoots you out
 *                   through an arch into the lobby. Three coins per run.
 *   COURTYARD       Open air through the lobby's south doors. A gentle grass
 *                   heightfield, a square water parterre deep enough to swim
 *                   in, climbable trees, a cloister, the two AZURE stained
 *                   glass gates, a small tower whose 3.0 m shaft is a wall-kick
 *                   climb to the roof and the AZURE SANCTUM door, and — sealed
 *                   behind the fountain — THE CRESTWAY, 60 crests.
 *
 * NOTHING IN THE KEEP CAN KILL YOU. `killY` sits far below the undercroft
 * floor, there are no hazards, and every fall — including the 12 m off the
 * tower — lands on grass or hay. That is deliberate: the hub is where the
 * player experiments.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (see runtime/data/index.js and CONTRACT §23/§25)
 * ---------------------------------------------------------------------------
 *   1 unit = 1 metre. +Y up. p = CENTRE of a thing, s = its FULL size.
 *   rot = Euler radians [x, y, z].
 *   YAW: 0 faces -Z, +yaw turns counter-clockwise seen from above, exactly as
 *        THREE.Object3D.rotation.y. heading(yaw) = (-sin yaw, 0, -cos yaw).
 *        NORTH = 0 (-Z) . EAST = -PI/2 (+X) . SOUTH = PI (+Z) . WEST = PI/2 (-X)
 *   `stripe: true` marks a surface a jump must reach; it gets the bright
 *        leading-edge highlight. Walk-on floors never get one, or the highlight
 *        stops meaning anything.
 *
 * This module is a PURE LEAF: no imports at all, so `reachcheck.mjs`,
 * `loopcheck.py` and plain `node -e` can read it in isolation, and so
 * data/index.js can dynamic-import it without a cycle.
 *
 * ---------------------------------------------------------------------------
 * FLOOR HEIGHTS  (absolute; every number below is derived from these)
 * ---------------------------------------------------------------------------
 *   undercroft floor        -8.00      ceiling  -3.20
 *   lobby floor              0.00      ceiling  14.00
 *   grand-stair landing      2.70      (9 risers of 0.30 — TUNE.stepUp is 0.45)
 *   gallery / long hall      6.30      ceiling  11.80  (undersides at 5.60)
 *   courtyard apron          0.00      lawn 0.00 .. 2.20 (heightfield)
 *   balcony + garden loft    6.30
 *   tower ledges       3.40 / 6.60 / 9.80        tower roof   12.60
 *   wyrm-stair chute mouth   9.00      run-out   0.50 -> 0.05
 *
 * REACH NOTES (tuning.js REACH_TABLE; safe = the authoring limit)
 *   The only jump the Keep ever ASKS for is optional. Every required route is
 *   stairs, ramps or level floor.
 *     . balcony -> garden loft   6.00 m flat   long jump safe 6.42 (run-up 8 m
 *       of straight gallery behind the door) or triple safe 6.11.
 *     . tower shaft              3.00 m wide, ledges +3.40 / +3.20 / +3.20 /
 *       +2.80 — a wall kick is +2.12 apex per kick off a shaft <= 3.4 m.
 *     . fountain rim  1.10 m from the lawn (single jump apex 1.91), and back
 *       out from the water on a surface hop (apex 1.19 above the surface at
 *       0.95, i.e. 2.14 — the rim is 1.10).
 * ===========================================================================
 */

/* ===========================================================================
 * 0. Tiny authoring toolkit — every box in this file is built by box().
 * ======================================================================== */

const D2R = Math.PI / 180;

/** Headings, in the yaw convention above. */
const NORTH = 0;
const EAST = -Math.PI / 2;
const SOUTH = Math.PI;
const WEST = Math.PI / 2;

/** Unit heading for an authored yaw (the one conversion, mirrored from util). */
function heading(yaw) { return [-Math.sin(yaw), 0, -Math.cos(yaw)]; }

/**
 * An axis-aligned solid from its MIN/MAX corners — far harder to get wrong
 * than centre+size when you are fitting walls to each other.
 * @param {number[]} xs [xMin, xMax]
 * @param {number[]} ys [yMin, yMax]
 * @param {number[]} zs [zMin, zMax]
 * @param {string} mat material key (materials.js)
 * @param {object} [extra] merged over the def (glow, stripe, surface, props...)
 */
function box(xs, ys, zs, mat, extra) {
  const d = {
    kind: 'platform',
    p: [(xs[0] + xs[1]) / 2, (ys[0] + ys[1]) / 2, (zs[0] + zs[1]) / 2],
    s: [xs[1] - xs[0], ys[1] - ys[0], zs[1] - zs[0]],
    mat,
  };
  if (extra) for (const k in extra) d[k] = extra[k];
  return d;
}

/** Decorative solid — never landable, never mistakable for a platform. */
function deco(kindOf, p, s, extra) {
  const d = { kind: 'deco', kindOf, p, s };
  if (extra) for (const k in extra) d[k] = extra[k];
  return d;
}

/** A practical lamp. */
function lamp(p, color, intensity, distance, flicker) {
  const d = { kind: 'light', p, color, intensity, distance };
  if (flicker) d.flicker = flicker;
  return d;
}

/** Floating signage. `yaw` is the direction the READER is walking. */
function sign(p, yaw, text, size, color) {
  return { kind: 'text', p, rot: [0, yaw + Math.PI, 0], text, size, color };
}

/**
 * A straight flight of steps.
 *   p    = centre of the flight's XZ FOOTPRINT, p[1] = the y it LEAVES FROM
 *   yaw  = the heading the flight CLIMBS toward (yaw 0 climbs toward -Z)
 *   top  = p[1] + n*rise   len = n*run   (both published so buildStairs can assert)
 * Every riser is checked against TUNE.stepUp (0.45) by the geometry check.
 */
function stairs(p, w, rise, run, n, yaw, mat, extra) {
  const d = {
    kind: 'stairs', p, w, rise, run, n, rot: [0, yaw, 0], mat,
    top: +(p[1] + n * rise).toFixed(3), len: +(n * run).toFixed(3),
  };
  if (extra) for (const k in extra) d[k] = extra[k];
  return d;
}

/**
 * A sloped slab between two points. The slab's local -Z axis runs from `from`
 * to `to`, so rot[0] = +pitch raises the -Z (far) end: one formula climbs and
 * descends. `from`/`to` are points on the WALKING SURFACE.
 */
function ramp(from, to, w, thick, mat, extra) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const run = Math.hypot(dx, dz);
  const len = Math.hypot(run, dy);
  const yaw = Math.atan2(-dx, -dz);          // -Z points from `from` to `to`
  const pitch = Math.atan2(dy, run);         // +ve => the far end is higher
  const nrm = thick / 2 / Math.max(0.2, Math.cos(pitch));
  const d = {
    kind: 'ramp',
    p: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - nrm, (from[2] + to[2]) / 2],
    s: [w, thick, len],
    rot: [pitch, yaw, 0],
    mat,
  };
  if (extra) for (const k in extra) d[k] = extra[k];
  return d;
}

/**
 * One tread of a spiral stair: a radial plank, rotated so its local +X is the
 * radius. Treads overlap tangentially so the collider sees one continuous run.
 */
function spiralStep(cx, cz, rIn, rOut, deg, topY, thick, arcW, mat) {
  const a = deg * D2R, rM = (rIn + rOut) / 2;
  return {
    kind: 'platform',
    p: [cx + Math.cos(a) * rM, topY - thick / 2, cz + Math.sin(a) * rM],
    s: [rOut - rIn, thick, arcW],
    rot: [0, -a, 0],
    mat,
  };
}

/** Point on a circle: 0 deg = +X, 90 deg = +Z. */
function at(cx, cz, r, deg, y) {
  const a = deg * D2R;
  return [cx + Math.cos(a) * r, y || 0, cz + Math.sin(a) * r];
}

/**
 * A helical run of straight chords (the wyrm stair and its chute).
 * `emit(a0, y0, a1, y1, k)` receives each chord's start/end angle (deg) and
 * walking-surface height, and returns the object def.
 */
function helix(deg0, sweepDeg, y0, y1, segs, emit) {
  const out = [];
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs, t1 = (k + 1) / segs;
    out.push(emit(deg0 + sweepDeg * t0, y0 + (y1 - y0) * t0,
      deg0 + sweepDeg * t1, y0 + (y1 - y0) * t1, k));
  }
  return out;
}

/**
 * A parabolic string of coins from `a` to `b`, peaking `rise` above the chord.
 * KEEP COINS only (see the `keepCoins` field): they never count toward a course.
 */
function coinArc(a, b, rise, n, tag) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const bell = 4 * t * (1 - t);
    out.push({
      p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + rise * bell, a[2] + (b[2] - a[2]) * t],
      tag,
    });
  }
  return out;
}

/* ===========================================================================
 * 1. Named levels and room extents — nothing below hard-codes a height twice.
 * ======================================================================== */

const UNDER = -8.00;          // undercroft walking floor
const UNDER_CEIL = -3.20;     // its vault soffit
const LOBBY = 0.00;           // lobby walking floor
const LOBBY_CEIL = 14.00;
const LAND = 2.70;            // grand-stair mid landing (9 x 0.30)
const GAL = 6.30;             // gallery / long hall / balcony / loft
const GAL_UNDER = GAL - 0.70; // gallery slab soffit = the aisle ceiling
const HALL_CEIL = 11.80;
const ROOF = 12.60;           // courtyard tower roof deck
const CHUTE = 9.00;           // wyrm-stair chute mouth

/* Lobby shell, in wall-face coordinates (the masonry is 1.2 m thick, outside). */
const LX0 = -20.0, LX1 = 20.0;      // west / east inner faces
const LZ0 = -13.8, LZ1 = 13.8;      // north / south inner faces
const WALL = 1.2;

/* Gallery walkway is 4.0 m deep; the void it rings is what you look down into. */
const GIN = 16.0;                    // |x| of the gallery's inner edge
const VOID_Z0 = -2.82;               // top of the grand stair == void north edge
const VOID_Z1 = 8.80;                // south run's inner edge

/* Undercroft footprint (inner faces). */
const UX0 = -17.5, UX1 = 17.5, UZ0 = -11.0, UZ1 = 11.0;

/* Long hall + library nook (first floor, north wing). */
const HX0 = -12.0, HX1 = 12.0, HZ0 = -34.6, HZ1 = -13.8;
const NX0 = 12.0, NX1 = 20.0, NZ0 = -25.6, NZ1 = -16.4;

/* Courtyard (lawn extent; the perimeter wall stands just outside it). */
const YX0 = -24.0, YX1 = 26.0, YZ0 = 13.0, YZ1 = 48.0;

/* Spiral stair to the undercroft, and the grate that skips it. */
const SPIN = [-13.5, 7.5];           // centre
const SP_RI = 0.90, SP_RO = 3.60;
const GRATE = [-13.5, 1.0];

/* West turret (the WYRM STAIR). */
const TC = [-27.0, 8.0];             // drum centre
const T_RIN = 6.20, T_ROUT = 7.20;   // shell faces
const WALK_R = 4.60, WALK_W = 2.60;  // the walking helix
const SLIDE_R = 1.80, SLIDE_W = 1.80;// the chute corkscrew inside it

/* Courtyard tower (the wall-kick shaft). */
const KX0 = -19.8, KX1 = -14.2, KZ0 = 33.2, KZ1 = 38.8;   // drum interior
const SH_X0 = -18.5, SH_X1 = -15.5;                        // shaft: 3.00 m wide
const SH_Z0 = 33.2, SH_Z1 = 36.5;                          // shaft: 3.30 m deep

/* The fountain: a square water parterre so the water Volume fits it exactly. */
const FZ = 30.0;                     // centre z (x is 0)
const FOUNT_IN = 4.20, FOUNT_OUT = 5.20;
const WATER_TOP = 0.95, WATER_BOT = -1.30;

/* Palette — realm accents duplicated from REALMS in ./index.js on purpose: a
   data leaf must not import, and these are the only four numbers that matter. */
const VERDANT = 0x8ee06a;
const EMBER = 0xff8a3c;
const RIME = 0xa8e4ff;
const AZURE = 0x6ec0ff;
const KEEPGOLD = 0xf3d489;     // the Keep's own accent — candle gold
const TORCH = 0xffa85c;        // torch / candle flame
const DAYLIGHT = 0xdCEBFF;     // what comes through the east windows

/* ===========================================================================
 * 2. Gates — the one place where a painting, a door and the save file agree.
 * ---------------------------------------------------------------------------
 * A gate is authored ONCE and produces two records:
 *   - an OBJECT (kind 'painting' / 'gatedoor') that builders.js renders, with
 *     its locked shimmer and its "N CRESTS" plate;
 *   - a GATES entry (contract §26) that game.js turns into the walk-in trigger.
 * `requires.crests` is Save.crestTotal(), and every number here is the same
 * number COURSE_META[<id>].gateCrests carries in runtime/data/index.js, so the
 * plate on the door, the course card and Save.unlockedGates() can never drift.
 *
 * GEOMETRY. `p` is the point ON THE WALL FACE at picture height — that is what
 * game.js expects (it drops the returning player to the floor beneath it), and
 * the walk-in test is XZ-only within 1.45 m with a -3.5 .. +4.5 m y band, so
 * every gate below hangs no more than 2.5 m above the floor it is entered from.
 * `yaw` is the heading the player HAS while walking into it (contract §26), so
 * heading(yaw) points INTO the wall and -heading(yaw) points back into the room:
 * `exitP` / `exitYaw` publish that reversal explicitly for the integrator.
 * ======================================================================== */

/**
 * @param {object} o
 * @param {string} o.course   course id (must exist in data/index.js)
 * @param {number} o.crests   crest total that unlocks it (= COURSE_META.gateCrests)
 * @param {number[]} o.p      [x, y, z] ON the wall face, at picture centre height
 * @param {number} o.yaw      heading the player walks in with
 * @param {number} o.floor    walking floor in front of it (for the exit stand)
 * @param {'painting'|'door'|'glass'} o.kind
 */
function makeGate(o) {
  const h = heading(o.yaw);
  const w = o.w || 3.4, hh = o.h || 3.8;
  const exitP = [o.p[0] - h[0] * 1.9, o.floor + 0.05, o.p[2] - h[2] * 1.9];
  const exitYaw = o.yaw + Math.PI;
  const locked = o.crests > 0;
  const obj = o.kind === 'painting'
    ? {
      kind: 'painting', p: o.p, yaw: o.yaw, course: o.course, w, h: hh,
      locked, requires: { crests: o.crests }, tint: o.tint, label: o.label,
      plate: o.crests > 0 ? o.crests + ' CREST' + (o.crests === 1 ? '' : 'S') : '',
      stripe: false,
    }
    : {
      kind: 'gatedoor', p: o.p, yaw: o.yaw, course: o.course, w, h: hh,
      style: o.kind, locked, requires: { crests: o.crests }, tint: o.tint,
      label: o.label,
      plate: o.crests > 0 ? o.crests + ' CREST' + (o.crests === 1 ? '' : 'S') : '',
    };
  const gate = {
    course: o.course, kind: o.kind, p: o.p.slice(), yaw: o.yaw,
    requires: { crests: o.crests }, exitP, exitYaw, tint: o.tint, label: o.label,
  };
  return { obj, gate };
}

/**
 * A gate that opens no course: the iron door to the wyrm stair and THE
 * CRESTWAY behind the fountain. It is authored as an object only — game.js's
 * _resolveGates skips entries without a valid `course`, which is exactly right
 * — and is listed in `secrets` so the integrator can wire its own reveal.
 */
function makeSeal(o) {
  return {
    kind: 'gatedoor', p: o.p, yaw: o.yaw, w: o.w, h: o.h, style: o.style || 'door',
    id: o.id, label: o.label, sub: o.sub || '', tint: o.tint,
    locked: true, requires: { crests: o.crests }, opens: o.opens,
    plate: o.crests + ' CREST' + (o.crests === 1 ? '' : 'S'),
  };
}

/* --- the thirteen course gates, in progression order ---------------------- */

const G = [
  /* VERDANT BAILEY — lobby, west aisle, straight ahead of the spawn mosaic. */
  makeGate({ course: 'verdant-1', crests: 0, p: [LX0, LOBBY + 2.5, -6.0], yaw: WEST, floor: LOBBY, kind: 'painting', tint: VERDANT, label: 'BAILEY MEADOW' }),
  makeGate({ course: 'verdant-2', crests: 1, p: [LX0, LOBBY + 2.5, -1.0], yaw: WEST, floor: LOBBY, kind: 'painting', tint: VERDANT, label: 'GNASHER FORT' }),
  makeGate({ course: 'verdant-3', crests: 3, p: [LX0, LOBBY + 2.5, 4.0], yaw: WEST, floor: LOBBY, kind: 'painting', tint: VERDANT, label: 'WINDMILL HEIGHTS' }),

  /* EMBER FOUNDRY — undercroft, north wall, lit by torches. ember-4 is one of
     the three late seals: visible, readable, and shut until 30 crests. */
  makeGate({ course: 'ember-1', crests: 6, p: [-12.0, UNDER + 2.5, UZ0], yaw: NORTH, floor: UNDER, kind: 'painting', tint: EMBER, label: 'MAGMA WORKS', w: 3.0, h: 3.2 }),
  makeGate({ course: 'ember-2', crests: 10, p: [-4.5, UNDER + 2.5, UZ0], yaw: NORTH, floor: UNDER, kind: 'painting', tint: EMBER, label: 'PISTON HALLS', w: 3.0, h: 3.2 }),
  makeGate({ course: 'ember-3', crests: 14, p: [4.5, UNDER + 2.5, UZ0], yaw: NORTH, floor: UNDER, kind: 'painting', tint: EMBER, label: 'CINDER CHASE', w: 3.0, h: 3.2 }),
  makeGate({ course: 'ember-4', crests: 30, p: [12.0, UNDER + 2.5, UZ0], yaw: NORTH, floor: UNDER, kind: 'painting', tint: EMBER, label: 'SUNSCAR NECROPOLIS', w: 3.0, h: 3.2 }),

  /* RIME SPIRE — the long hall upstairs; rime-3 seals its far end. */
  makeGate({ course: 'rime-1', crests: 18, p: [HX0, GAL + 2.5, -20.0], yaw: WEST, floor: GAL, kind: 'painting', tint: RIME }),
  makeGate({ course: 'rime-2', crests: 22, p: [HX0, GAL + 2.5, -28.0], yaw: WEST, floor: GAL, kind: 'painting', tint: RIME }),
  makeGate({ course: 'rime-3', crests: 36, p: [0.0, GAL + 2.5, HZ0], yaw: NORTH, floor: GAL, kind: 'painting', tint: RIME, w: 4.2, h: 4.4 }),

  /* AZURE SANCTUM — out in the courtyard, in stained glass and stone. */
  makeGate({ course: 'azure-1', crests: 26, p: [YX1, 2.40, 30.0], yaw: EAST, floor: 0, kind: 'glass', tint: AZURE, w: 3.2, h: 4.4, label: 'TIDEWELL TEMPLE' }),
  makeGate({ course: 'azure-2', crests: 42, p: [YX0, 2.40, 22.0], yaw: WEST, floor: 0, kind: 'glass', tint: AZURE, w: 3.2, h: 4.4, label: 'GEARHEART TOWER' }),
  /* azure-3 is set into the BACK wall of the roof aedicule (z 38.40), not its
     mouth, so the door has 1.20 m of masonry behind it and the player walks a
     step and a half into the niche before it triggers — no accidental entries
     while circling the parapet. */
  makeGate({ course: 'azure-3', crests: 50, p: [-17.0, ROOF + 1.70, 38.4], yaw: SOUTH, floor: ROOF, kind: 'door', tint: AZURE, w: 2.8, h: 3.4, label: 'PRISM RIDE' }),
];

const GATE_OBJECTS = G.map((g) => g.obj);
const GATES = G.map((g) => g.gate);

/* --- the two seals that open no course ----------------------------------- */

const IRON_DOOR = makeSeal({
  id: 'wyrmstair', crests: 10, p: [UX0, UNDER + 2.1, 8.0], yaw: WEST,
  w: 2.8, h: 4.2, style: 'door', tint: EMBER, opens: 'wyrmstair',
  label: 'THE WYRM STAIR', sub: 'SOMETHING BEHIND THIS DOOR IS STILL MOVING',
});

const CRESTWAY = makeSeal({
  id: 'finale', crests: 60, p: [0.0, 2.80, YZ1], yaw: SOUTH,
  w: 6.4, h: 6.4, style: 'glass', tint: KEEPGOLD, opens: 'crestway',
  label: 'THE CRESTWAY', sub: 'WHAT THE KEEP WAS BUILT AROUND',
});

/* ===========================================================================
 * 3. THE LOBBY HALL — 40 x 26 m, 14 m tall
 * ---------------------------------------------------------------------------
 * The floor is authored as seven slabs rather than one, because two holes go
 * through it: the spiral stair down to the undercroft (x -17..-10, z 4..11)
 * and the secret grate (x -14.7..-12.3, z -0.2..2.2). Everything else about
 * the room hangs off the four inner wall faces LX0/LX1/LZ0/LZ1.
 * ======================================================================== */

const LOBBY_SHELL = [
  /* --- floor (top 0.00, 1.4 m of masonry beneath) ----------------------- */
  box([-21.2, -17.0], [-1.4, 0], [-15.0, 15.0], 'marble'),
  box([-17.0, -10.0], [-1.4, 0], [-15.0, -0.2], 'marble'),
  box([-17.0, -14.7], [-1.4, 0], [-0.2, 2.2], 'marble'),
  box([-12.3, -10.0], [-1.4, 0], [-0.2, 2.2], 'marble'),
  box([-17.0, -10.0], [-1.4, 0], [2.2, 4.0], 'marble'),
  box([-17.0, -10.0], [-1.4, 0], [11.0, 15.0], 'marble'),
  box([-10.0, 21.2], [-1.4, 0], [-15.0, 15.0], 'marble'),

  /* --- west wall: solid, bar the run-out arch the wyrm chute spits through */
  box([-21.2, -20.0], [0, 14.0], [-15.0, 6.6], 'stone'),
  box([-21.2, -20.0], [0, 14.0], [9.4, 15.0], 'stone'),
  box([-21.2, -20.0], [4.6, 14.0], [6.6, 9.4], 'stone'),

  /* --- east wall: a base band, five tall windows between six piers, header */
  box([20.0, 21.2], [0, 1.3], [-15.0, 15.0], 'stone'),
  box([20.0, 21.2], [10.8, 14.0], [-15.0, 15.0], 'stone'),
  box([20.0, 21.2], [1.3, 10.8], [-15.0, -10.7], 'stone'),
  box([20.0, 21.2], [1.3, 10.8], [-7.86, -6.06], 'stone'),
  box([20.0, 21.2], [1.3, 10.8], [-3.22, -1.42], 'stone'),
  box([20.0, 21.2], [1.3, 10.8], [1.42, 3.22], 'stone'),
  box([20.0, 21.2], [1.3, 10.8], [6.06, 7.86], 'stone'),
  box([20.0, 21.2], [1.3, 10.8], [10.7, 15.0], 'stone'),

  /* --- north wall: solid below, open at gallery height into the long hall  */
  box([-21.2, -9.0], [0, 14.0], [-15.0, -13.8], 'stone'),
  box([9.0, 21.2], [0, 14.0], [-15.0, -13.8], 'stone'),
  box([-9.0, 9.0], [0, 6.3], [-15.0, -13.8], 'stone'),
  box([-9.0, 9.0], [11.3, 14.0], [-15.0, -13.8], 'stone'),

  /* --- south wall: the courtyard doors, and above them the balcony door -- */
  box([-21.2, -4.0], [0, 14.0], [13.8, 15.0], 'stone'),
  box([4.0, 21.2], [0, 14.0], [13.8, 15.0], 'stone'),
  box([-4.0, 4.0], [5.2, 6.3], [13.8, 15.0], 'stone'),
  box([-4.0, -3.0], [6.3, 9.7], [13.8, 15.0], 'stone'),
  box([3.0, 4.0], [6.3, 9.7], [13.8, 15.0], 'stone'),
  box([-4.0, 4.0], [9.7, 14.0], [13.8, 15.0], 'stone'),

  /* --- roof slab (the coffers below it are deco) ------------------------- */
  box([-21.2, 21.2], [14.0, 15.0], [-15.0, 15.0], 'wood'),
];

/* ===========================================================================
 * 3b. THE OUTSIDE OF THE BUILDING
 * ---------------------------------------------------------------------------
 * ROUND 3 (critic, `_shots/keep/vista-sw.png` / `vista-nw.png` / `vista-ne.png`):
 * "the hub is a cluster of dark brown untextured BOXES and one cylinder, with
 * glowing edge strips run along every corner. No roof, no crenellations, no
 * window openings, no buttresses, no stone read at all - it is a greybox with
 * neon piping, and it is 90 % of the frame in three of the four establishing
 * shots."
 *
 * Three of those are fixed elsewhere and one is fixed here:
 *   - the neon piping was `stripeFaces` marking EVERY platform's +X face by
 *     default, including walls and roof slabs (builders.js, round 3);
 *   - the "untextured" read was the stone bake, which was a crazy-paving worley
 *     crack network at a 2.9 m tile (materials.js, round 3: coursed ashlar at
 *     1.39 m, plus a facing term so walls are not the same value as decks);
 *   - the SILHOUETTE is this block. A castle is read at distance by its
 *     skyline, and the Keep had none: the roof slab simply stopped at
 *     y = 15.00 with a flat edge all the way round.
 *
 * So: a projecting cornice on all four sides, a crenellated parapet standing on
 * it (merlon / embrasure / merlon, 2.8 m pitch), and buttresses down the two
 * long walls with weathered offsets. Every piece is a `box()` on the shared
 * `stone` material, so course.js's static merge folds them into the chunk that
 * already exists - the skyline costs triangles, not draw calls.
 *
 * `stripe: false` on every one of them: these are architecture, and a leading
 * edge highlight on a merlon is exactly the noise the critic was reading.
 * ======================================================================== */

const RX0 = -21.2, RX1 = 21.2;      // roof slab edges
const RZ0 = -15.0, RZ1 = 15.0;
const CORN = 14.60, CORN_T = 15.30; // cornice bottom / top
const MERL = 16.55;                 // merlon top
const EMBR = 15.75;                 // embrasure (the gap) top
const OVER = 0.55;                  // how far the cornice oversails the wall

const KEEP_SKYLINE = [
  /* --- the cornice: one oversailing course all the way round ------------- */
  box([RX0 - OVER, RX1 + OVER], [CORN, CORN_T], [RZ0 - OVER, RZ0], 'stone', { stripe: false, plain: true }),
  box([RX0 - OVER, RX1 + OVER], [CORN, CORN_T], [RZ1, RZ1 + OVER], 'stone', { stripe: false, plain: true }),
  box([RX0 - OVER, RX0], [CORN, CORN_T], [RZ0, RZ1], 'stone', { stripe: false, plain: true }),
  box([RX1, RX1 + OVER], [CORN, CORN_T], [RZ0, RZ1], 'stone', { stripe: false, plain: true }),
];

/* the parapet: a continuous low wall with merlons standing on it */
for (const [z0, z1] of [[RZ0 - 0.45, RZ0 + 0.25], [RZ1 - 0.25, RZ1 + 0.45]]) {
  KEEP_SKYLINE.push(box([RX0 - 0.45, RX1 + 0.45], [CORN_T, EMBR], [z0, z1], 'stone', { stripe: false, plain: true }));
}
for (const [x0, x1] of [[RX0 - 0.45, RX0 + 0.25], [RX1 - 0.25, RX1 + 0.45]]) {
  KEEP_SKYLINE.push(box([x0, x1], [CORN_T, EMBR], [RZ0 + 0.25, RZ1 - 0.25], 'stone', { stripe: false, plain: true }));
}
/* merlons along the two long (x) edges */
for (let x = RX0 + 0.6; x <= RX1 - 1.6; x += 2.8) {
  for (const [z0, z1] of [[RZ0 - 0.45, RZ0 + 0.25], [RZ1 - 0.25, RZ1 + 0.45]]) {
    KEEP_SKYLINE.push(box([x, x + 1.4], [EMBR, MERL], [z0, z1], 'stone', { stripe: false, plain: true }));
  }
}
/* merlons along the two short (z) edges */
for (let z = RZ0 + 1.4; z <= RZ1 - 2.4; z += 2.8) {
  for (const [x0, x1] of [[RX0 - 0.45, RX0 + 0.25], [RX1 - 0.25, RX1 + 0.45]]) {
    KEEP_SKYLINE.push(box([x0, x1], [EMBR, MERL], [z, z + 1.4], 'stone', { stripe: false, plain: true }));
  }
}
/* corner turrets: a little extra mass where two walls meet, which is what
   stops a crenellated box reading as a crenellated box */
for (const [cx0, cx1] of [[RX0 - 0.9, RX0 + 0.7], [RX1 - 0.7, RX1 + 0.9]]) {
  for (const [cz0, cz1] of [[RZ0 - 0.9, RZ0 + 0.7], [RZ1 - 0.7, RZ1 + 0.9]]) {
    KEEP_SKYLINE.push(box([cx0, cx1], [CORN, MERL + 0.7], [cz0, cz1], 'stone', { stripe: false, plain: true }));
    KEEP_SKYLINE.push(box([cx0 - 0.2, cx1 + 0.2], [MERL + 0.7, MERL + 1.05], [cz0 - 0.2, cz1 + 0.2], 'stone', { stripe: false, plain: true }));
  }
}
/* buttresses down the two long walls, with one weathered set-off each */
for (const bz of [-10.4, -3.6, 3.6, 10.4]) {
  for (const [bx0, bx1, dir] of [[RX0 - 1.15, RX0, -1], [RX1, RX1 + 1.15, 1]]) {
    KEEP_SKYLINE.push(box([bx0, bx1], [0, 8.2], [bz - 0.8, bz + 0.8], 'stone', { stripe: false, plain: true }));
    KEEP_SKYLINE.push(box([bx0 - dir * 0.42, bx1 - dir * 0.42], [8.2, 13.4], [bz - 0.7, bz + 0.7], 'stone', { stripe: false, plain: true }));
    KEEP_SKYLINE.push(box([bx0 - dir * 0.42 - 0.12, bx1 - dir * 0.42 + 0.12], [13.4, 13.75], [bz - 0.82, bz + 0.82], 'stone', { stripe: false, plain: true }));
  }
}
/* a string course two thirds up, so 15 m of wall has a horizontal to read */
KEEP_SKYLINE.push(box([RX0 - 0.30, RX1 + 0.30], [9.30, 9.72], [RZ0 - 0.30, RZ0], 'stone', { stripe: false, plain: true }));
KEEP_SKYLINE.push(box([RX0 - 0.30, RX1 + 0.30], [9.30, 9.72], [RZ1, RZ1 + 0.30], 'stone', { stripe: false, plain: true }));
KEEP_SKYLINE.push(box([RX0 - 0.30, RX0], [9.30, 9.72], [RZ0, RZ1], 'stone', { stripe: false, plain: true }));
KEEP_SKYLINE.push(box([RX1, RX1 + 0.30], [9.30, 9.72], [RZ0, RZ1], 'stone', { stripe: false, plain: true }));

/* --- the crest mosaic Nim spawns on ------------------------------------- */
const MOSAIC = [
  deco('emblem', [0, LOBBY + 0.02, -1.0], [13.6, 0.04, 13.6], { mat: 'marble', tint: 0x2b3a52 }),
  deco('emblem', [0, LOBBY + 0.03, -1.0], [9.6, 0.04, 9.6], { rot: [0, Math.PI / 4, 0], mat: 'gold', tint: KEEPGOLD }),
  deco('emblem', [0, LOBBY + 0.04, -1.0], [4.4, 0.04, 4.4], { mat: 'emissive', tint: KEEPGOLD }),
  deco('emblem', [0, LOBBY + 0.05, -1.0], [2.1, 0.04, 2.1], { rot: [0, Math.PI / 4, 0], mat: 'copper', tint: 0xd8a45c }),
];

/* --- four banner pillars standing in the lobby void --------------------- */
const PILLARS = [];
for (const px of [-9, 9]) {
  for (const pz of [-1, 6]) {
    PILLARS.push(deco('pillar', [px, LOBBY + 7.0, pz], [1.9, 14.0, 1.9], { mat: 'stone' }));
    PILLARS.push(deco('banner', [px + (px < 0 ? 1.05 : -1.05), LOBBY + 9.1, pz], [0.14, 4.6, 2.6],
      { rot: [0, px < 0 ? EAST : WEST, 0], tint: pz < 0 ? VERDANT : AZURE }));
    PILLARS.push(deco('torch', [px + (px < 0 ? 1.15 : -1.15), LOBBY + 3.5, pz], [0.42, 1.0, 0.42], { mat: 'copper' }));
    PILLARS.push(lamp([px + (px < 0 ? 1.5 : -1.5), LOBBY + 4.0, pz], TORCH, 5.2, 13, 0.24));
  }
}

/* --- the five east windows: glazing, tracery, and the shafts they throw --
 *
 * ROUND 1 VISUAL FIX — "the Keep is blown out" (owner-observed,
 * `_shots/verify_keep.png`: mean luminance 0.640, 13.9 % of the frame over
 * 0.90, 4.5 % clipped over 0.97, mean saturation 0.111 — a near-monochrome
 * white frame where the contract asks for warm stone with amber window light
 * and a cool blue fill). Four emitters stacked on one wall:
 *
 *   1. the glazing at `emissive: 0.55` over 9.5 m x 2.8 m, five times over;
 *   2. three DAYLIGHT practicals at intensity 10 / range 26 sitting 1.4 m off
 *      that same wall, so the wall itself was the brightest thing in the room;
 *   3. five god-ray columns hanging 6.4 m ABOVE the floor (see procGodray:
 *      they were vertical, not raked, so they never reached the floor and
 *      instead stacked into a bank of horizontal white slats across the frame);
 *   4. all of it under exposure 1.05 with a bloom threshold of 1.02.
 *
 * Here: the glazing drops to a plausible bright-but-not-molten value, the
 * practicals move INTO the room and lose two thirds of their intensity (they
 * are meant to be the bounce off the sill, not a second sun), and the shafts
 * are re-hung from the window down to the floor with a rake that matches the
 * theme key `dir` [-0.82, 0.42, 0.38] — a shaft now lands about 6 m inside the
 * hall, which is what casts the long bars the theme comment promises.
 * Exposure / bloom / ambient are in themes.js. */
const WINDOWS = [];
let WIN_LIT = 0;
for (const [z0, z1] of [[-10.7, -7.86], [-6.06, -3.22], [-1.42, 1.42], [3.22, 6.06], [7.86, 10.7]]) {
  const zc = (z0 + z1) / 2, w = z1 - z0;
  WINDOWS.push(deco('panel', [20.6, 6.05, zc], [0.30, 9.5, w - 0.16], { mat: 'glass', tint: DAYLIGHT, emissive: 0.18 }));
  WINDOWS.push(deco('archway', [20.15, 6.05, zc], [0.28, 9.5, w], { rot: [0, EAST, 0], mat: 'stone' }));
  /* the shaft: top pinned at the window (y 8.6), foot on the floor ~6 m west.
   * `params.tilt` is metres of westward slide per metre of drop. */
  WINDOWS.push(deco('godray', [19.4, 0.04, zc - 0.4], [w * 1.05, 8.6, 7.4],
    /* gain 0.075 -> 0.16. At 0.075 the shafts were mathematically present and
     * visually absent — the critic found "zero shafts" in spawn, cp1 and cp3
     * despite themes.js declaring godRays: true and CONTRACT SS16 promising
     * them. Two crossed additive quads at 0.16 sum to 0.32 where they cross,
     * which is under the 0.25-per-quad ceiling procGodray documents and is
     * legible against the Keep's (now darker) interior. */
    /* ROUND 4: 0.16 -> 0.27. The critic looked for these again this round
       ("there are no sun shafts anywhere on either course although CONTRACT
       SS16 promises a god-ray sprite for Keep windows") and still could not
       find one. They ARE built — the defs are right here — but the theme's
       interior went materially darker AND warmer since 0.16 was chosen, and a
       pale DAYLIGHT shaft at 0.16 over a 0.95-exposure amber hall lands under
       the bloom threshold and inside the fog, so it reads as a slightly less
       dark patch of air. Two crossed quads at 0.27 sum to 0.54 where they
       cross, which is the read this feature exists for. */
    { rot: [0, EAST, 0], theme: 'keep', tint: DAYLIGHT, opacity: 0.27,
      params: { tilt: 0.72, spread: 2.35 } }));
  /* one practical per OTHER bay: five would be five real-time lights for one
     wall, and the shafts already carry the read. */
  if (WIN_LIT++ % 2 === 0) WINDOWS.push(lamp([17.2, 6.6, zc], DAYLIGHT, 3.4, 15));
}

/* ===========================================================================
 * 4. THE GRAND DOUBLE STAIR and THE GALLERY
 * ---------------------------------------------------------------------------
 * An imperial stair: two 9-riser flights climb the flanks to a landing that
 * runs the width of the north end, then one 12-riser flight nine metres wide
 * climbs back out of it up the middle to the gallery. Every riser is 0.30 m —
 * two thirds of TUNE.stepUp (0.45) — so Nim glides up without ever pressing
 * jump, and the slot the upper flight rises through is left open in the north
 * deck so the flight never runs into its own soffit (2.90 m of headroom over
 * the landing, 4.40 m under the arcade).
 * ======================================================================== */

const GRAND_STAIR = [
  stairs([-13.0, LOBBY, -6.27], 4.0, 0.30, 0.46, 9, NORTH, 'marble', { rail: 'both' }),
  stairs([13.0, LOBBY, -6.27], 4.0, 0.30, 0.46, 9, NORTH, 'marble', { rail: 'both' }),

  /* the landing (top LAND = 2.70), carried on an arcade so the north end of
     the lobby stays a colonnaded undercroft rather than a solid plinth */
  box([-15.6, 15.6], [2.00, LAND], [-15.0, -8.34], 'marble'),

  /* the upper flight, through the open slot in the north deck */
  stairs([0, LAND, -5.58], 9.0, 0.30, 0.46, 12, SOUTH, 'marble', { rail: 'both' }),
];

for (const px of [-14.2, -9.4, -4.6, 4.6, 9.4, 14.2]) {
  GRAND_STAIR.push(deco('pillar', [px, LOBBY + 1.0, -10.6], [1.1, 2.0, 1.1], { mat: 'stone' }));
  GRAND_STAIR.push(deco('archway', [px, LOBBY + 1.05, -8.6], [4.4, 2.1, 0.5], { mat: 'stone' }));
}

/* Balustrades: 1.05 m of turned stone along every edge that overlooks the
   void, plus the two runs that fence the stair slot. */
const RAILS = [
  box([-16.3, -16.0], [GAL, GAL + 1.05], [VOID_Z0, VOID_Z1], 'marble'),
  box([16.0, 16.3], [GAL, GAL + 1.05], [VOID_Z0, VOID_Z1], 'marble'),
  box([-16.0, 16.0], [GAL, GAL + 1.05], [VOID_Z1, VOID_Z1 + 0.3], 'marble'),
  box([-16.0, -5.0], [GAL, GAL + 1.05], [VOID_Z0 - 0.3, VOID_Z0], 'marble'),
  box([5.0, 16.0], [GAL, GAL + 1.05], [VOID_Z0 - 0.3, VOID_Z0], 'marble'),
  box([-5.3, -5.0], [GAL, GAL + 1.05], [-8.34, VOID_Z0], 'marble'),
  box([5.0, 5.3], [GAL, GAL + 1.05], [-8.34, VOID_Z0], 'marble'),
];
for (let i = 0; i < 9; i++) {
  const z = VOID_Z0 + (VOID_Z1 - VOID_Z0) * (i / 8);
  RAILS.push(deco('post', [-16.15, GAL + 0.62, z], [0.5, 1.24, 0.5], { mat: 'marble' }));
  RAILS.push(deco('post', [16.15, GAL + 0.62, z], [0.5, 1.24, 0.5], { mat: 'marble' }));
}
for (let i = 0; i < 9; i++) {
  const x = -16 + 4 * i;
  RAILS.push(deco('post', [x, GAL + 0.62, VOID_Z1 + 0.15], [0.5, 1.24, 0.5], { mat: 'marble' }));
}

/* The gallery deck itself: a full loop around the void, 4 m wide, its soffit
   at 5.60 forming the aisle ceiling the paintings hang under. */
const GALLERY = [
  box([-20.0, -16.0], [GAL_UNDER, GAL], [-13.8, 13.8], 'marble'),
  box([16.0, 20.0], [GAL_UNDER, GAL], [-13.8, 13.8], 'marble'),
  box([-16.0, 16.0], [GAL_UNDER, GAL], [VOID_Z1, 13.8], 'marble'),
  box([-16.0, -5.0], [GAL_UNDER, GAL], [-13.8, VOID_Z0], 'marble'),
  box([5.0, 16.0], [GAL_UNDER, GAL], [-13.8, VOID_Z0], 'marble'),
  /* The stair slot is only open where the upper flight actually rises through
     it (z -8.34 .. -2.82). North of that the deck closes back up, so the hall
     doorway at x -9 .. 9 has a floor and the landing below keeps 2.90 m of
     headroom (5.60 soffit against a 2.70 landing). */
  box([-5.0, 5.0], [GAL_UNDER, GAL], [-13.8, -8.34], 'marble'),
];

/* ===========================================================================
 * 5. LOBBY DRESSING — the props, lamps and signage that make it a room
 * ======================================================================== */

const LOBBY_DRESS = [
  /* candle-wheel over the mosaic: the room's key practical light */
  deco('chandelier', [0, 10.4, -1.0], [5.4, 2.2, 5.4], { mat: 'copper', tint: KEEPGOLD }),
  lamp([0, 9.6, -1.0], KEEPGOLD, 28, 40, 0.05),

  /* the west aisle, where the three VERDANT paintings hang */
  deco('bench', [-18.0, LOBBY + 0.32, -8.6], [2.2, 0.64, 0.72], { rot: [0, WEST, 0], mat: 'wood' }),
  deco('bench', [-18.0, LOBBY + 0.32, 1.6], [2.2, 0.64, 0.72], { rot: [0, WEST, 0], mat: 'wood' }),
  deco('lantern', [-19.1, LOBBY + 1.55, -3.5], [0.42, 0.72, 0.42], { mat: 'copper' }),
  deco('lantern', [-19.1, LOBBY + 1.55, 1.5], [0.42, 0.72, 0.42], { mat: 'copper' }),
  lamp([-18.4, LOBBY + 2.1, -3.5], TORCH, 8.0, 15, 0.2),
  lamp([-18.4, LOBBY + 2.1, 1.5], TORCH, 8.0, 15, 0.2),

  /* the east aisle, under the windows */
  deco('bench', [18.2, LOBBY + 0.32, -6.0], [2.4, 0.64, 0.72], { rot: [0, EAST, 0], mat: 'wood' }),
  deco('bench', [18.2, LOBBY + 0.32, 6.0], [2.4, 0.64, 0.72], { rot: [0, EAST, 0], mat: 'wood' }),
  deco('statue', [18.6, LOBBY, 0.0], [1.5, 2.4, 1.5], { rot: [0, EAST, 0], mat: 'marble' }),
  deco('chest', [18.9, LOBBY + 0.34, 11.4], [1.1, 0.68, 0.72], { rot: [0, EAST, 0], mat: 'wood' }),
  deco('barrel', [19.0, LOBBY + 0.44, -11.4], [0.76, 0.88, 0.76], { mat: 'wood' }),
  deco('crate', [18.1, LOBBY + 0.38, -12.2], [0.76, 0.76, 0.76], { rot: [0, 0.4, 0], mat: 'wood' }),
  deco('stool', [17.4, LOBBY + 0.26, -10.6], [0.44, 0.52, 0.44], { mat: 'wood' }),

  /* by the courtyard doors */
  deco('barrel', [-5.4, LOBBY + 0.44, 12.6], [0.76, 0.88, 0.76], { mat: 'wood' }),
  deco('crate', [5.6, LOBBY + 0.38, 12.7], [0.86, 0.76, 0.86], { rot: [0, -0.3, 0], mat: 'wood' }),
  deco('torch', [-4.9, LOBBY + 3.0, 13.1], [0.42, 1.0, 0.42], { mat: 'copper' }),
  deco('torch', [4.9, LOBBY + 3.0, 13.1], [0.42, 1.0, 0.42], { mat: 'copper' }),
  lamp([0, LOBBY + 3.6, 12.9], TORCH, 8.0, 16, 0.26),

  /* ROUND 4 — DECOR DENSITY, WHERE THE CAMERA ACTUALLY LOOKS.
   * Critic, `_shots/keep/spawn.png` and `cp1.png`: "the Keep's main hall is a
   * ~30x20 m room containing a floor, walls, a stair block and nothing else —
   * no furniture, no banners, no braziers, no clutter at human scale, so it
   * reads as a transit concourse rather than a hub anyone lives in". The hall
   * was NOT undressed — benches, chests, barrels, a statue and eight torches
   * were already here — but every one of them sits at |x| >= 17.4, in the
   * aisles, and the third-person camera looks straight down the middle. So the
   * dressing moves inboard, onto the pier line and the stair flanks, where it
   * is in frame. Props carry no colliders (props.js builds none), so none of
   * this narrows a route; the spawn pad at [0, 0, -1] and the doorway lane at
   * x -9..9 are both left clear. */
  deco('brazier', [-7.6, LOBBY + 0.52, -7.4], [1.05, 1.15, 1.05], { mat: 'copper' }),
  deco('brazier', [7.6, LOBBY + 0.52, -7.4], [1.05, 1.15, 1.05], { mat: 'copper' }),
  lamp([-7.6, LOBBY + 1.5, -7.4], TORCH, 9.0, 15, 0.32),
  lamp([7.6, LOBBY + 1.5, -7.4], TORCH, 9.0, 15, 0.32),
  /* banners on the arcade piers — the vertical cloth accent a stone hall needs
     to stop reading as a car park, and the one place a realm colour belongs
     indoors. */
  ...[[-14.2, VERDANT], [-9.4, AZURE], [9.4, EMBER], [14.2, RIME]].map(([px, tint]) =>
    deco('banner', [px, LOBBY + 4.3, -10.15], [1.5, 2.9, 0.2], { mat: 'cloth', tint })),
  /* a refectory table with its stools, off the walking lane but inside it */
  deco('bench', [-10.6, LOBBY + 0.40, 3.6], [3.4, 0.80, 1.10],
    { rot: [0, NORTH, 0], mat: 'wood', params: { heavy: true } }),
  deco('stool', [-9.0, LOBBY + 0.26, 2.4], [0.46, 0.52, 0.46], { mat: 'wood' }),
  deco('stool', [-9.2, LOBBY + 0.26, 4.9], [0.46, 0.52, 0.46], { rot: [0, 0.6, 0], mat: 'wood' }),
  deco('crate', [-11.9, LOBBY + 0.38, 6.4], [0.82, 0.76, 0.82], { rot: [0, 0.3, 0], mat: 'wood' }),
  deco('barrel', [11.6, LOBBY + 0.44, 4.2], [0.78, 0.88, 0.78], { mat: 'wood' }),
  deco('barrel', [12.4, LOBBY + 0.44, 5.3], [0.78, 0.88, 0.78], { mat: 'wood' }),
  deco('bookcase', [12.6, LOBBY + 1.25, -4.4], [2.4, 2.5, 0.55], { rot: [0, EAST, 0], mat: 'wood' }),
  deco('statue', [-12.6, LOBBY, 8.6], [1.4, 2.3, 1.4], { rot: [0, SOUTH, 0], mat: 'marble' }),

  /* coffers under the roof slab, so 14 m of ceiling is not a blank plane */
  deco('beam', [0, 13.6, -1.0], [40.0, 0.7, 0.7], { mat: 'wood', count: 9, spread: [0, 0, 24], seed: 2201 }),
  deco('beam', [0, 13.2, -1.0], [0.6, 0.6, 27.0], { mat: 'wood', count: 7, spread: [34, 0, 0], seed: 2202 }),

  /* signage — the only tutorial text the Keep needs downstairs */
  sign([0, LOBBY + 5.9, -12.9], SOUTH, 'THE KEEP', 1.05, 0xf6e6c2),
  sign([0, LOBBY + 5.1, -12.9], SOUTH, 'EVERY PAINTING IS A DOOR', 0.30, 0x9c8a6e),
  sign([-19.5, LOBBY + 4.9, -1.0], WEST, 'VERDANT BAILEY', 0.46, VERDANT),
  sign([0, LOBBY + 5.9, 13.4], NORTH, 'TO THE COURTYARD', 0.40, 0xbfd9c2),
  sign([-13.5, LOBBY + 2.3, 4.4], SOUTH, 'THE UNDERCROFT', 0.36, EMBER),
  sign([-13.5, LOBBY + 1.8, 4.4], SOUTH, 'mind the stair', 0.20, 0x8d7a5e),
];

/* ===========================================================================
 * 6. THE UPSTAIRS WING — long hall, library nook, balcony, garden loft
 * ---------------------------------------------------------------------------
 * North through the gallery's opening is a 21 m hall with the three RIME
 * paintings, rime-3 sealing its far end so the corridor always has a
 * destination you cannot reach yet. Off its east side, the library nook: the
 * one soft room in the building, and where OLD FEN sits.
 *
 * The wing stands on solid masonry from the courtyard grade up to the gallery
 * soffit — it is a real wing of the castle, not a floating slab.
 * ======================================================================== */

const LONG_HALL = [
  box([-13.2, 13.2], [-1.4, GAL_UNDER], [-35.8, -13.8], 'stone'),          // the wing's base
  box([-13.2, 13.2], [GAL_UNDER, GAL], [-35.8, -13.8], 'marble'),          // hall floor
  box([-13.2, -12.0], [GAL, HALL_CEIL], [-35.8, -13.8], 'plaster'),        // west wall
  box([12.0, 13.2], [GAL, HALL_CEIL], [-35.8, -25.6], 'plaster'),          // east wall, north of the nook
  box([12.0, 13.2], [GAL, HALL_CEIL], [-16.4, -13.8], 'plaster'),          // east wall, south of it
  box([12.0, 13.2], [10.3, HALL_CEIL], [-25.6, -16.4], 'plaster'),         // nook doorway head
  box([-13.2, 13.2], [GAL, HALL_CEIL], [-35.8, -34.6], 'plaster'),         // north end wall
  box([-13.2, 13.2], [HALL_CEIL, HALL_CEIL + 0.8], [-35.8, -13.8], 'wood'),// ceiling

  /* a vaulted rhythm down the hall so 21 m does not read as a tube */
  ...[-17.5, -22.5, -27.5, -32.5].flatMap((z) => [
    deco('archway', [0, GAL, z], [24.4, 5.5, 0.7], { mat: 'stone' }),
    deco('pillar', [-11.4, GAL + 2.75, z], [1.0, 5.5, 1.0], { mat: 'stone' }),
    deco('pillar', [11.4, GAL + 2.75, z], [1.0, 5.5, 1.0], { mat: 'stone' }),
    deco('lantern', [-11.2, GAL + 2.4, z], [0.42, 0.72, 0.42], { mat: 'copper' }),
  ]),
  lamp([-10.4, GAL + 2.7, -19.5], TORCH, 7.0, 16, 0.18),
  lamp([-10.4, GAL + 2.7, -29.5], TORCH, 7.0, 16, 0.18),

  /* rime-3 gets a proper terminus: a lit alcove at the end of the hall */
  deco('archway', [0, GAL, -34.5], [7.4, 5.4, 0.8], { mat: 'stone', tint: RIME }),
  deco('brazier', [-3.9, GAL + 0.75, -33.4], [1.05, 1.5, 1.05], { mat: 'metal', tint: RIME }),
  deco('brazier', [3.9, GAL + 0.75, -33.4], [1.05, 1.5, 1.05], { mat: 'metal', tint: RIME }),
  lamp([0, GAL + 2.2, -33.4], 0x9fd8ff, 11, 20, 0.22),
  lamp([0, GAL + 3.4, -21.0], 0xffe0b0, 12, 24),

  sign([0, GAL + 4.6, -14.4], NORTH, 'RIME SPIRE', 0.52, RIME),
  sign([-11.7, GAL + 4.6, -24.0], WEST, 'THE LONG HALL', 0.34, 0x9c8a6e),
];

const LIBRARY = [
  box([12.0, 21.2], [-1.4, GAL_UNDER], [-26.8, -15.2], 'stone'),
  box([12.0, 21.2], [GAL_UNDER, GAL], [-26.8, -15.2], 'wood'),
  box([20.0, 21.2], [GAL, 10.3], [-26.8, -15.2], 'plaster'),
  box([12.0, 21.2], [GAL, 10.3], [-26.8, -25.6], 'plaster'),
  box([12.0, 21.2], [GAL, 10.3], [-16.4, -15.2], 'plaster'),
  box([12.0, 21.2], [10.3, 11.1], [-26.8, -15.2], 'wood'),

  /* bookcases along three walls, a reading table, and Fen's chair */
  ...[-24.4, -22.4, -20.4, -18.4, -16.6].map((z) =>
    deco('bookcase', [19.4, GAL + 1.25, z], [0.55, 2.5, 1.8], { rot: [0, EAST, 0], mat: 'wood' })),
  deco('bookcase', [14.0, GAL + 1.25, -25.2], [1.8, 2.5, 0.55], { mat: 'wood' }),
  deco('bookcase', [16.6, GAL + 1.25, -25.2], [1.8, 2.5, 0.55], { mat: 'wood' }),
  deco('bench', [15.4, GAL + 0.32, -18.4], [2.2, 0.64, 0.72], { mat: 'wood' }),
  deco('stool', [17.0, GAL + 0.26, -22.4], [0.46, 0.52, 0.46], { mat: 'wood' }),
  deco('stool', [15.7, GAL + 0.26, -21.4], [0.46, 0.52, 0.46], { mat: 'wood' }),
  deco('chest', [13.2, GAL + 0.34, -17.2], [1.1, 0.68, 0.72], { mat: 'wood' }),
  deco('lantern', [17.0, GAL + 1.9, -21.0], [0.5, 0.8, 0.5], { mat: 'copper' }),
  deco('panel', [20.7, GAL + 2.5, -19.0], [0.26, 3.0, 2.4], { mat: 'glass', tint: DAYLIGHT, emissive: 0.4 }),
  lamp([17.6, GAL + 2.4, -20.4], 0xffd79a, 12, 20, 0.12),
  sign([16.6, GAL + 3.3, -25.3], SOUTH, 'THE READING NOOK', 0.30, 0xc0a97e),
];

/* ===========================================================================
 * 7. THE BALCONY AND THE GARDEN LOFT — the long-jump lesson
 * ---------------------------------------------------------------------------
 * Out of the gallery's south door onto a balcony over the courtyard. Its lip
 * is at z 17.20; the garden loft's lip is at z 23.20. That is 6.00 m edge to
 * edge, chosen against REACH_TABLE: long jump safe 6.42 m (and triple safe
 * 6.11 m), with 8 m of straight gallery behind the door for the run-up the
 * long jump needs. Miss it and you land on grass six metres below — the whole
 * reason the lesson lives here and not in a course.
 * ======================================================================== */

const BALCONY = [
  box([-4.5, 4.5], [GAL_UNDER, GAL], [13.8, 17.2], 'stone', { stripe: true, glow: KEEPGOLD }),
  box([-4.8, -4.5], [GAL, GAL + 0.85], [13.8, 17.2], 'marble'),
  box([4.5, 4.8], [GAL, GAL + 0.85], [13.8, 17.2], 'marble'),
  deco('post', [-4.65, GAL + 0.72, 17.05], [0.62, 1.44, 0.62], { mat: 'marble' }),
  deco('post', [4.65, GAL + 0.72, 17.05], [0.62, 1.44, 0.62], { mat: 'marble' }),
  deco('banner', [-4.3, GAL + 2.4, 15.0], [0.12, 3.0, 1.6], { rot: [0, EAST, 0], tint: AZURE }),
  deco('banner', [4.3, GAL + 2.4, 15.0], [0.12, 3.0, 1.6], { rot: [0, WEST, 0], tint: AZURE }),
  sign([0, GAL + 2.3, 14.6], SOUTH, 'LONG JUMP', 0.44, KEEPGOLD),
  sign([0, GAL + 1.75, 14.6], SOUTH, 'crouch, then jump, at a full run', 0.22, 0x9c8a6e),

  /* the loft, its piers, and the net you climb back up (or down) */
  box([-4.5, 4.5], [GAL_UNDER, GAL], [23.2, 27.2], 'stone', { stripe: true, glow: KEEPGOLD }),
  box([-4.8, -4.5], [GAL, GAL + 0.85], [23.2, 27.2], 'marble'),
  box([4.5, 4.8], [GAL, GAL + 0.85], [23.2, 27.2], 'marble'),
  box([-4.8, 4.8], [GAL, GAL + 0.85], [27.2, 27.5], 'marble'),
  ...[[-3.4, 24.2], [3.4, 24.2], [-3.4, 26.2], [3.4, 26.2]].map(([x, z]) =>
    deco('pillar', [x, 2.8, z], [1.15, 5.6, 1.15], { mat: 'stone' })),
  { kind: 'net', p: [4.66, 3.35, 25.2], s: [3.6, 5.9, 0.22], rot: [0, WEST, 0], face: [1, 0, 0], climb: true, mat: 'rope' },
  deco('bench', [-2.6, GAL + 0.32, 25.6], [2.2, 0.64, 0.72], { rot: [0, EAST, 0], mat: 'wood' }),
  deco('lantern', [3.6, GAL + 1.6, 26.6], [0.48, 0.78, 0.48], { mat: 'copper' }),
  deco('chest', [2.4, GAL + 0.34, 24.0], [1.1, 0.68, 0.72], { rot: [0, SOUTH, 0], mat: 'wood' }),
  lamp([0, GAL + 2.2, 25.2], TORCH, 8, 16, 0.16),
  sign([0, GAL + 2.1, 26.9], NORTH, 'THE GARDEN LOFT', 0.32, KEEPGOLD),
];

/* Eight KEEP COINS strung over the practice gap. They are `keepCoins`, never
   `coins`: nothing in the hub may add to a course total. */
const ARC_COINS = coinArc([0, GAL + 0.6, 17.6], [0, GAL + 0.6, 22.8], 1.0, 8, 'balcony');

/* ===========================================================================
 * 8. THE UNDERCROFT — brick, torchlight and the four EMBER paintings
 * ---------------------------------------------------------------------------
 * Two ways in. The spiral stair in the lobby's west quarter is the honest one:
 * 23 treads of 0.3333 m (TUNE.stepUp is 0.45), one and a half turns down a
 * 7.2 m drum. The other is the grate: a `breakable` flush with the lobby floor
 * that only a ground pound opens, dropping 6.8 m onto a hay pile with a
 * `bounce` surface so the landing is a joke rather than a punishment.
 *
 * Nothing down here kills. The vault soffit sits at -3.20 and the floor at
 * -8.00, so the room is 4.80 m tall — enough that a triple jump has somewhere
 * to go and the paintings can hang at a readable 2.50 m.
 * ======================================================================== */

const UNDERCROFT = [
  box([-18.5, 18.5], [UNDER - 0.7, UNDER], [-12.0, 12.0], 'brick'),

  /* walls (the west wall carries the iron door at z 6.6 .. 9.4) */
  box([-18.5, -17.5], [UNDER, UNDER_CEIL], [-12.0, 6.6], 'brick'),
  box([-18.5, -17.5], [UNDER, UNDER_CEIL], [9.4, 12.0], 'brick'),
  box([-18.5, -17.5], [-3.8, UNDER_CEIL], [6.6, 9.4], 'brick'),
  box([17.5, 18.5], [UNDER, UNDER_CEIL], [-12.0, 12.0], 'brick'),
  box([-18.5, 18.5], [UNDER, UNDER_CEIL], [-12.0, -11.0], 'brick'),
  box([-18.5, 18.5], [UNDER, UNDER_CEIL], [11.0, 12.0], 'brick'),

  /* vault, pierced by the spiral shaft and by the grate shaft */
  box([-18.5, -17.0], [UNDER_CEIL, -1.4], [-12.0, 12.0], 'brick'),
  box([-17.0, -10.0], [UNDER_CEIL, -1.4], [-12.0, -0.2], 'brick'),
  box([-17.0, -14.7], [UNDER_CEIL, -1.4], [-0.2, 2.2], 'brick'),
  box([-12.3, -10.0], [UNDER_CEIL, -1.4], [-0.2, 2.2], 'brick'),
  box([-17.0, -10.0], [UNDER_CEIL, -1.4], [2.2, 4.0], 'brick'),
  box([-17.0, -10.0], [UNDER_CEIL, -1.4], [11.0, 12.0], 'brick'),
  box([-10.0, 18.5], [UNDER_CEIL, -1.4], [-12.0, 12.0], 'brick'),

  /* groin arches so 35 m of brick vault has a rhythm */
  ...[-8.0, -3.0, 2.0, 7.0].flatMap((z) => [
    deco('archway', [-8.5, UNDER, z], [17.0, 4.8, 0.7], { mat: 'brick' }),
    deco('archway', [8.5, UNDER, z], [17.0, 4.8, 0.7], { mat: 'brick' }),
    deco('pillar', [0, UNDER + 2.4, z], [1.15, 4.8, 1.15], { mat: 'brick' }),
  ]),

  /* the hay that catches whoever pounds the grate.
   * ROUND 5 — MATERIAL CHOICE. Critic, crop `_shots/_r3_keep_cp2_bar.png`:
   * "the blue slab's surface is an unfiltered high-frequency blue/dark weave
   * that aliases into visible moire at 8 m ... it reads as upholstery, not as
   * anything in a warm stone Keep". It was 'cloth', and the Keep's cloth
   * override is 0xc8d8e8 (a cool pale blue, correct for the arcade BANNERS this
   * hall also has and wrong for a hay bed), and cloth's 1 m weave tile is the
   * highest-frequency albedo in the library. 'rope' is the fibre material —
   * twisted strands at a coarser pitch — and the Keep tints it 0xe0c89c, which
   * is straw. */
  box([-15.2, -11.8], [-7.8, -6.8], [-0.7, 2.7], 'rope',
    { surface: 'bounce', props: { power: 0.5 }, glow: 0xc8a04a, tint: 0xd8b45c }),
  deco('debris', [-13.5, -6.6, 1.0], [3.6, 0.5, 3.6], { mat: 'rope', count: 7, spread: [3.0, 0.3, 3.0], seed: 4410, tint: 0xd8b45c }),

  /* torch line along both long walls */
  ...[-8.5, -3.5, 1.5, 6.5].flatMap((z) => [
    deco('torch', [-17.1, UNDER + 2.6, z], [0.44, 1.05, 0.44], { rot: [0, WEST, 0], mat: 'copper' }),
    deco('torch', [17.1, UNDER + 2.6, z], [0.44, 1.05, 0.44], { rot: [0, EAST, 0], mat: 'copper' }),
    /* one practical per bay, alternating walls — eight point lights in one
       cellar is a shader cost, not a lighting design */
    lamp([z < -1 ? -16.4 : 16.4, UNDER + 3.0, z], TORCH, 9.0, 17, 0.3),
  ]),
  lamp([0, UNDER + 3.6, -9.4], EMBER, 11, 22, 0.16),

  /* ROUND 4 — the cellar measured "31.3 % of the frame below 0.06 luminance,
     mean luminance 0.130 ... a black box read only by its neon trim"
     (`_shots/keep/cp2.png`). The four wall practicals are all at |x| = 16.4,
     so the middle two thirds of a 35 m vault has no source at all. Two
     braziers ON the floor put light where a player stands and give the frame
     a warm anchor at human scale; they cost two point lights in a room that
     was carrying five. */
  deco('brazier', [-6.4, UNDER + 0.52, 2.2], [1.0, 1.1, 1.0], { mat: 'copper' }),
  deco('brazier', [6.4, UNDER + 0.52, -4.2], [1.0, 1.1, 1.0], { mat: 'copper' }),
  lamp([-6.4, UNDER + 1.5, 2.2], TORCH, 10.0, 16, 0.34),
  lamp([6.4, UNDER + 1.5, -4.2], TORCH, 10.0, 16, 0.34),

  /* cellar clutter — a working undercroft, not a museum */
  deco('barrel', [14.6, UNDER + 0.44, -8.4], [0.78, 0.9, 0.78], { mat: 'wood' }),
  deco('barrel', [15.6, UNDER + 0.44, -7.4], [0.78, 0.9, 0.78], { mat: 'wood' }),
  deco('barrel', [14.2, UNDER + 1.34, -8.0], [0.78, 0.9, 0.78], { rot: [0, 0.5, 0], mat: 'wood' }),
  deco('crate', [15.9, UNDER + 0.4, 4.4], [0.82, 0.8, 0.82], { rot: [0, 0.3, 0], mat: 'wood' }),
  deco('crate', [15.2, UNDER + 0.4, 5.6], [0.82, 0.8, 0.82], { mat: 'wood' }),
  deco('crate', [15.6, UNDER + 1.2, 5.0], [0.82, 0.8, 0.82], { rot: [0, -0.4, 0], mat: 'wood' }),
  deco('chest', [-15.6, UNDER + 0.34, -6.0], [1.15, 0.7, 0.76], { rot: [0, WEST, 0], mat: 'wood' }),
  deco('chest', [11.0, UNDER + 0.34, 9.6], [1.15, 0.7, 0.76], { rot: [0, SOUTH, 0], mat: 'wood' }),
  deco('bench', [-6.0, UNDER + 0.32, 9.4], [2.4, 0.64, 0.74], { mat: 'wood' }),
  deco('stool', [-4.0, UNDER + 0.26, 8.6], [0.46, 0.52, 0.46], { mat: 'wood' }),
  deco('shelf', [6.0, UNDER + 1.1, -10.4], [2.6, 2.2, 0.5], { mat: 'wood' }),
  deco('cage', [-9.4, UNDER + 0.9, 6.4], [1.5, 1.8, 1.5], { mat: 'metal' }),
  deco('chain', [-9.4, UNDER + 2.6, 6.4], [0.9, 1.8, 0.9], { mat: 'metal', fit: 'max' }),
  deco('lantern', [2.0, UNDER + 1.5, 8.8], [0.44, 0.74, 0.44], { mat: 'copper' }),

  sign([0, UNDER + 4.0, -10.8], NORTH, 'EMBER FOUNDRY', 0.48, EMBER),
  sign([-17.2, UNDER + 3.6, 8.0], WEST, 'SEALED', 0.34, 0x8c5f3a),
];

/* --- the spiral stair down (23 treads, 1.5 turns, 8.00 m) ---------------- */
const SPIRAL = [];
for (let i = 1; i <= 23; i++) {
  SPIRAL.push(spiralStep(SPIN[0], SPIN[1], SP_RI, SP_RO, -22.5 * i, LOBBY - i * (8 / 24), 0.5, 1.15, 'stone'));
}
SPIRAL.push(deco('pillar', [SPIN[0], UNDER + 4.2, SPIN[1]], [1.8, 8.4, 1.8], { mat: 'stone' }));
SPIRAL.push(deco('rail', [SPIN[0], LOBBY + 0.55, SPIN[1]], [SP_RO * 2 + 0.4, 1.1, SP_RO * 2 + 0.4], { mat: 'metal', hollow: true }));
SPIRAL.push(lamp([SPIN[0], LOBBY - 3.2, SPIN[1]], TORCH, 12, 22, 0.22));

/* --- the secret grate: only a ground pound opens it ---------------------- */
const GRATE_OBJ = {
  kind: 'breakable', p: [GRATE[0], -0.15, GRATE[1]], s: [2.4, 0.30, 2.4],
  mat: 'grate', pound: true, secret: 'keep-grate', drop: null, glow: 0x6a5a3a,
};

/* ===========================================================================
 * 9. THE WYRM STAIR — the Keep's secret, behind the 10-crest iron door
 * ---------------------------------------------------------------------------
 * The west turret is a 14.4 m drum with two helices inside it, one nested in
 * the other:
 *
 *   THE WALK.  A ramp 2.60 m wide at radius 4.60 climbs 540 deg from the
 *              undercroft (-7.80) to a chute mouth at 9.19 — an arc of 43.4 m
 *              for 17.0 m of rise, i.e. 21.5 deg. TUNE.slope.slideDeg is 38,
 *              so it is a walk, not a slide, all the way up.
 *   THE RIDE.  A sandboard chute 1.80 m wide at radius 1.80 corkscrews 540 deg
 *              back down through the middle of it, 9.00 -> 0.50 at 27 deg, and
 *              a run-out ramp fires you east through an arch in the lobby's
 *              west wall. Three coins on the way down; the Save flag
 *              `keep.wyrmRun` is set the first time you finish it.
 *
 * The two helices never touch: the walk occupies radius 3.30 .. 5.90 and the
 * chute 0.90 .. 2.70. The run-out passes under the walk's second lap (which
 * crosses 0 deg at 3.53 m, giving 2.3 m of headroom) and out through the one
 * gap in the shell.
 * ======================================================================== */

const TURRET = [
  box([TC[0] - 7.2, TC[0] + 7.2], [-8.6, UNDER], [TC[1] - 7.2, TC[1] + 7.2], 'stone'),

  /* the corridor from the undercroft's iron door to the foot of the walk */
  box([-22.0, -17.5], [UNDER - 0.7, UNDER], [6.4, 9.6], 'brick'),
  box([-22.0, -17.5], [UNDER, UNDER_CEIL], [6.4, 6.6], 'brick'),
  box([-22.0, -17.5], [UNDER, UNDER_CEIL], [9.4, 9.6], 'brick'),
  box([-22.0, -17.5], [-3.8, UNDER_CEIL], [6.4, 9.6], 'brick'),
  deco('torch', [-19.8, UNDER + 2.5, 6.9], [0.44, 1.05, 0.44], { mat: 'copper' }),
  lamp([-19.8, UNDER + 3.0, 7.2], EMBER, 7, 12, 0.34),

  /* the chute mouth landing where the walk hands over to the ride */
  box([TC[0] - 5.2, TC[0] - 1.2], [8.70, 9.05], [TC[1] - 1.6, TC[1] + 1.6], 'wood', { stripe: true, glow: EMBER }),
  deco('archway', [TC[0] - 2.6, 9.05, TC[1]], [3.0, 2.9, 0.7], { rot: [0, EAST, 0], mat: 'stone', tint: EMBER }),
  lamp([TC[0] - 3.2, 10.4, TC[1]], EMBER, 12, 20, 0.2),
  sign([TC[0] - 3.4, 10.9, TC[1]], EAST, 'THE WYRM STAIR', 0.36, EMBER),

  /* conical cap and a lamp at the top so the drum reads from the courtyard */
  deco('archway', [TC[0], 12.6, TC[1]], [14.4, 4.6, 14.4], { mat: 'wood', tint: 0x6b4a2e }),
  deco('flagpole', [TC[0], 17.4, TC[1]], [0.5, 4.4, 0.5], { mat: 'metal', tint: KEEPGOLD }),
  lamp([TC[0], 11.0, TC[1]], TORCH, 10, 22, 0.14),
];

/* the drum: sixteen wall segments, with the one at 0 deg split so the
   corridor (below) and the run-out arch (above) can pass through it */
for (let i = 0; i < 16; i++) {
  const deg = i * 22.5, a = deg * D2R, rM = (T_RIN + T_ROUT) / 2;
  const p = [TC[0] + Math.cos(a) * rM, 0, TC[1] + Math.sin(a) * rM];
  const seg = (y0, y1) => ({
    kind: 'platform',
    p: [p[0], (y0 + y1) / 2, p[2]],
    s: [T_ROUT - T_RIN, y1 - y0, 2.9],
    rot: [0, -a, 0],
    mat: 'stone',
  });
  if (i === 0) { TURRET.push(seg(-8.6, UNDER), seg(-3.8, 0.0), seg(4.6, 11.8)); }
  else TURRET.push(seg(-8.6, 11.8));
  if (i % 8 === 0) TURRET.push(lamp([TC[0] + Math.cos(a) * (T_RIN - 0.9), 2.4, TC[1] + Math.sin(a) * (T_RIN - 0.9)], TORCH, 8, 15, 0.3));
}

/* THE WALK — 24 chords, endpoints nudged 1 deg past each other so the joints
   overlap and the collider sees one continuous ramp. */
const WYRM_WALK = helix(0, 540, -7.80, 9.19, 24, (a0, y0, a1, y1) => {
  const ext = (a1 - a0) * 0.06;
  const s = at(TC[0], TC[1], WALK_R, a0 - ext, y0 - (y1 - y0) * 0.06);
  const e = at(TC[0], TC[1], WALK_R, a1 + ext, y1 + (y1 - y0) * 0.06);
  return ramp(s, e, WALK_W, 0.35, 'stone', { glow: EMBER });
});

/* THE RIDE — ONE sandboard whose `pts` trace 12 chords back down the middle.
   Authored as twelve separate `kind:'sandboard'` objects until 2026-09-02; the
   run is geometrically identical either way (SandboardHazard emits one OBB per
   segment for both spellings) but twelve hazards meant twelve decks, twelve
   berm banks, twelve marker rows, twelve stripe meshes and twelve spray
   InstancedMeshes — 60 draw calls out of a 260-call frame budget, measured with
   _harness/drawprobe.py. One multi-segment sandboard merges all of that into
   five meshes and runs one hazard update instead of twelve. */
const WYRM_CHUTE = [{
  kind: 'sandboard',
  pts: helix(180, -540, 9.00, 0.50, 12,
    (a0, y0) => at(TC[0], TC[1], SLIDE_R, a0, y0))
    .concat([at(TC[0], TC[1], SLIDE_R, 180 - 540, 0.50)]),
  w: SLIDE_W,
  mat: 'wood',
  glow: EMBER,
}];

/* the run-out: through the shell, through the lobby's west arch, onto marble */
WYRM_CHUTE.push(ramp([-25.2, 0.50, 8.0], [-17.8, 0.05, 8.0], 3.0, 0.4, 'wood', { glow: EMBER, stripe: true }));
WYRM_CHUTE.push(deco('archway', [-20.6, 0.0, 8.0], [3.4, 4.6, 1.4], { rot: [0, EAST, 0], mat: 'stone' }));
WYRM_CHUTE.push(lamp([-19.0, 2.6, 8.0], EMBER, 8, 14, 0.2));

/* three KEEP COINS on the ride, floating a metre over the chute */
const CHUTE_COINS = [0.18, 0.5, 0.82].map((t) => {
  const p = at(TC[0], TC[1], SLIDE_R, 180 - 540 * t, 9.00 - 8.5 * t + 1.0);
  return { p, tag: 'wyrm' };
});

/* ===========================================================================
 * 10. THE COURTYARD — grass, water, trees, a cloister and a tower
 * ---------------------------------------------------------------------------
 * Out of the lobby's south doors onto a paved apron, then a gentle grass
 * heightfield 50 x 35 m ringed by an 8 m curtain wall. The parterre in the
 * middle is 2.25 m deep — the swim tutorial — with a rim you clear on a single
 * jump (1.10 m against an apex of 1.91) and hop back out of on a surface jump.
 * The AZURE gates are stained glass set into the east and west walls; THE
 * CRESTWAY is sealed in the south wall directly behind the fountain, so it is
 * the first thing you see when you walk out and the last thing you open.
 * ======================================================================== */

const COURTYARD = [
  /* apron at the doors, flush with the lobby floor */
  box([-13.0, 13.0], [-0.7, 0.0], [13.8, 19.0], 'stone'),
  box([-3.2, 3.2], [-0.72, -0.02], [19.0, 24.0], 'stone'),                  // the path to the water

  /* curtain wall */
  box([26.0, 27.2], [0.0, 8.0], [13.8, 49.2], 'stone'),
  box([-25.2, -24.0], [0.0, 8.0], [19.0, 49.2], 'stone'),
  box([-25.2, -3.2], [0.0, 8.0], [48.0, 49.2], 'stone'),
  box([3.2, 27.2], [0.0, 8.0], [48.0, 49.2], 'stone'),
  box([-3.2, 3.2], [6.4, 8.0], [48.0, 49.2], 'stone'),

  /* cloister: an arcade down both long walls so the yard has an edge you can
     read from the balcony six metres up */
  ...[16.5, 20.5, 24.5, 28.5, 32.5, 36.5, 40.5, 44.5].flatMap((z) => [
    deco('pillar', [24.9, 1.7, z], [1.0, 3.4, 1.0], { mat: 'stone' }),
    deco('archway', [24.9, 3.4, z + 2.0], [0.9, 2.2, 3.6], { rot: [0, EAST, 0], mat: 'stone' }),
  ]),
  ...[20.5, 24.5, 28.5, 40.5, 44.5].flatMap((z) => [
    deco('pillar', [-22.9, 1.7, z], [1.0, 3.4, 1.0], { mat: 'stone' }),
    deco('archway', [-22.9, 3.4, z + 2.0], [0.9, 2.2, 3.6], { rot: [0, WEST, 0], mat: 'stone' }),
  ]),
  ...[18.0, 26.0, 34.0, 42.0].map((z) => deco('lantern', [24.6, 2.9, z], [0.5, 0.82, 0.5], { mat: 'copper' })),
  lamp([24.2, 3.4, 22.0], TORCH, 9, 20, 0.2),
  lamp([24.2, 3.4, 38.0], TORCH, 9, 20, 0.2),
  lamp([-22.6, 3.4, 32.0], TORCH, 8, 18, 0.2),

  /* --- the parterre ---------------------------------------------------- */
  box([-5.2, 5.2], [-1.80, WATER_BOT], [24.8, 35.2], 'marble'),
  box([-5.2, 5.2], [WATER_BOT, 1.10], [24.8, 25.8], 'marble'),
  box([-5.2, 5.2], [WATER_BOT, 1.10], [34.2, 35.2], 'marble'),
  box([-5.2, -4.2], [WATER_BOT, 1.10], [25.8, 34.2], 'marble'),
  box([4.2, 5.2], [WATER_BOT, 1.10], [25.8, 34.2], 'marble'),
  box([-1.2, 1.2], [WATER_BOT, 0.60], [28.8, 31.2], 'marble'),               // the jet plinth
  deco('statue', [0, 0.60, FZ], [2.0, 3.2, 2.0], { mat: 'marble', tint: 0xdfe9f2 }),
  deco('crystal', [0, 4.3, FZ], [0.9, 1.4, 0.9], { mat: 'crystal', tint: AZURE }),
  ...[[-5.2, 24.8], [5.2, 24.8], [-5.2, 35.2], [5.2, 35.2]].map(([x, z]) =>
    deco('brazier', [x, 1.5, z], [1.0, 1.4, 1.0], { mat: 'copper', tint: TORCH })),
  lamp([0, 3.2, FZ], AZURE, 16, 28, 0.1),
  sign([0, 2.5, 25.4], SOUTH, 'THE PARTERRE', 0.36, AZURE),
  sign([0, 2.0, 25.4], SOUTH, 'deep enough to swim — crouch to dive', 0.20, 0x7f9dbd),

  /* --- planting, rocks and fences -------------------------------------- */
  { kind: 'tree', p: [-13.0, 0.0, 20.0], h: 7.6, r: 0.52, climbable: true, mat: 'bark' },
  { kind: 'tree', p: [13.5, 0.0, 19.4], h: 8.2, r: 0.56, climbable: true, mat: 'bark' },
  { kind: 'tree', p: [7.8, 0.0, 25.6], h: 8.4, r: 0.54, climbable: true, mat: 'bark' },
  { kind: 'tree', p: [-9.4, 0.0, 43.0], h: 9.0, r: 0.62, climbable: true, mat: 'bark' },
  { kind: 'tree', p: [11.4, 0.0, 41.5], h: 8.4, r: 0.56, climbable: true, mat: 'bark' },
  { kind: 'pole', p: [-8.0, 0.0, 21.0], h: 6.4, r: 0.16, mat: 'metal' },
  { kind: 'rock', p: [18.0, 0.0, 34.0], r: 1.5, seed: 771 },
  { kind: 'rock', p: [20.4, 0.0, 36.6], r: 0.9, seed: 772 },
  { kind: 'rock', p: [-12.6, 0.0, 46.0], r: 1.7, seed: 773 },
  { kind: 'fence', a: [8.0, 0.0, 44.0], b: [20.0, 0.0, 44.0], mat: 'wood' },
  { kind: 'fence', a: [20.0, 0.0, 44.0], b: [20.0, 0.0, 38.0], mat: 'wood' },
  deco('flowerbed', [14.0, 0.15, 41.5], [10.0, 0.4, 4.4], { count: 26, spread: [10.0, 0.2, 4.0], seed: 9012, tint: 0xe8709a }),
  deco('bush', [-16.0, 0.3, 24.0], [1.6, 1.1, 1.6], { count: 7, spread: [8.0, 0, 8.0], seed: 9013 }),
  deco('bush', [17.0, 0.3, 22.0], [1.6, 1.1, 1.6], { count: 6, spread: [7.0, 0, 6.0], seed: 9014 }),
  deco('bench', [-6.4, 0.32, 22.6], [2.4, 0.64, 0.74], { rot: [0, SOUTH, 0], mat: 'wood' }),
  deco('bench', [6.4, 0.32, 37.6], [2.4, 0.64, 0.74], { rot: [0, NORTH, 0], mat: 'wood' }),
  deco('barrel', [22.6, 0.44, 17.0], [0.78, 0.9, 0.78], { mat: 'wood' }),
  deco('crate', [21.6, 0.4, 17.8], [0.82, 0.8, 0.82], { rot: [0, 0.4, 0], mat: 'wood' }),

  sign([0, 5.4, 47.6], SOUTH, 'THE CRESTWAY', 0.56, KEEPGOLD),
  sign([25.6, 5.0, 30.0], EAST, 'AZURE SANCTUM', 0.34, AZURE),
];

/* --- the courtyard tower: a 3.00 m wall-kick shaft to the roof ------------ */
const TOWER = [
  box([-21.0, -19.8], [0, ROOF], [32.0, 40.0], 'stone'),
  box([-14.2, -13.0], [0, ROOF], [32.0, 40.0], 'stone'),
  box([-21.0, -18.4], [0, ROOF], [32.0, 33.2], 'stone'),
  box([-15.6, -13.0], [0, ROOF], [32.0, 33.2], 'stone'),
  box([-18.4, -15.6], [3.2, ROOF], [32.0, 33.2], 'stone'),                  // door head
  box([-21.0, -13.0], [0, ROOF], [38.8, 40.0], 'stone'),
  /* the liner that narrows the drum to a 3.00 x 3.30 m shaft */
  box([-19.8, -18.5], [0, ROOF], [33.2, 38.8], 'stone'),
  box([-15.5, -14.2], [0, ROOF], [33.2, 38.8], 'stone'),
  box([-18.5, -15.5], [0, ROOF], [36.5, 38.8], 'stone'),

  /* the three ledges, alternating walls: +3.40, +3.20, +3.20, then +2.80 to
     the roof. Each hop is one wall kick (apex 2.12) off a jump (apex 1.91). */
  box([-18.5, -15.5], [3.05, 3.40], [35.4, 36.5], 'stone', { stripe: true, glow: AZURE }),
  box([-18.5, -15.5], [6.25, 6.60], [33.2, 34.3], 'stone', { stripe: true, glow: AZURE }),
  box([-18.5, -15.5], [9.45, 9.80], [35.4, 36.5], 'stone', { stripe: true, glow: AZURE }),

  /* roof deck, open over the shaft so you arrive through the hatch */
  box([-21.0, -13.0], [12.25, ROOF], [32.0, 33.2], 'stone', { stripe: true, glow: AZURE }),
  box([-21.0, -13.0], [12.25, ROOF], [36.5, 40.0], 'stone', { stripe: true, glow: AZURE }),
  box([-21.0, -18.5], [12.25, ROOF], [33.2, 36.5], 'stone', { stripe: true, glow: AZURE }),
  box([-15.5, -13.0], [12.25, ROOF], [33.2, 36.5], 'stone', { stripe: true, glow: AZURE }),

  /* parapet */
  box([-21.0, -13.0], [ROOF, ROOF + 0.95], [32.0, 32.4], 'stone'),
  box([-21.0, -20.6], [ROOF, ROOF + 0.95], [32.0, 40.0], 'stone'),
  box([-13.4, -13.0], [ROOF, ROOF + 0.95], [32.0, 40.0], 'stone'),
  box([-21.0, -13.0], [ROOF, ROOF + 0.95], [39.6, 40.0], 'stone'),

  /* the aedicule on the roof that holds the azure-3 door */
  box([-19.6, -18.4], [ROOF, 16.2], [36.9, 39.6], 'stone'),
  box([-15.6, -14.4], [ROOF, 16.2], [36.9, 39.6], 'stone'),
  box([-19.6, -14.4], [ROOF, 16.2], [38.4, 39.6], 'stone'),
  box([-19.6, -14.4], [16.2, 17.0], [36.9, 39.6], 'stone'),

  deco('banner', [-19.4, ROOF + 2.0, 34.8], [0.12, 3.0, 1.6], { rot: [0, EAST, 0], tint: AZURE }),
  deco('banner', [-14.6, ROOF + 2.0, 34.8], [0.12, 3.0, 1.6], { rot: [0, WEST, 0], tint: AZURE }),
  /* ROUND 3 (critic, `_shots/_vz_herohead.png`: "under the Keep courtyard key
     the head is a flat blown cream circle ... it is the single brightest object
     in frame"). The cause was not the hero material: `cp-tower` stands at
     (-19.70, ROOF, 33.00) and this brazier stood at (-20.2, ROOF + 0.7, 32.9) —
     0.5 m away and 0.65 m up, i.e. Nim was standing INSIDE a lit brazier, with
     an 11-intensity practical 2.7 m from his skull. Both braziers move to the
     aedicule end of the roof where they flank the azure door (which is what a
     pair of braziers is for), and the practical loses a third of its punch. */
  deco('brazier', [-20.2, ROOF + 0.7, 38.6], [1.0, 1.4, 1.0], { mat: 'copper', tint: TORCH }),
  deco('brazier', [-13.8, ROOF + 0.7, 38.6], [1.0, 1.4, 1.0], { mat: 'copper', tint: TORCH }),
  lamp([-17.0, ROOF + 1.9, 38.6], TORCH, 7.5, 18, 0.28),
  lamp([-17.0, 6.0, 35.0], AZURE, 7, 12),
  lamp([-17.0, ROOF + 2.6, 37.4], AZURE, 11, 18),
  sign([-17.0, 2.2, 31.6], SOUTH, 'WALL KICK', 0.40, AZURE),
  sign([-17.0, 1.7, 31.6], SOUTH, 'jump at a wall, then jump again', 0.20, 0x7f9dbd),
];

/* --- the sealed vault behind THE CRESTWAY (visible through the glass) ----- */
const CRESTWAY_VAULT = [
  box([-7.6, 7.6], [-0.7, 0.0], [48.0, 59.2], 'marble'),
  box([-7.6, -6.4], [0.0, 7.2], [49.2, 59.2], 'marble'),
  box([6.4, 7.6], [0.0, 7.2], [49.2, 59.2], 'marble'),
  box([-7.6, 7.6], [0.0, 7.2], [58.0, 59.2], 'marble'),
  box([-7.6, 7.6], [7.2, 8.0], [48.0, 59.2], 'marble'),
  { kind: 'pedestal', p: [0, 0.0, 54.0], mat: 'gold', tint: KEEPGOLD },
  deco('crystal', [0, 2.6, 54.0], [1.2, 2.0, 1.2], { mat: 'crystal', tint: KEEPGOLD }),
  lamp([0, 4.2, 54.0], KEEPGOLD, 16, 22, 0.08),
  ...[-4.6, 4.6].map((x) => deco('pillar', [x, 2.6, 52.0], [1.1, 5.2, 1.1], { mat: 'marble' })),
];

/* ===========================================================================
 * 11. TERRAIN AND WATER
 * ---------------------------------------------------------------------------
 * The lawn is the only heightfield in the Keep (contract §18): a gentle
 * 50 x 35 m field, flat wherever something stands on it — the apron, the
 * parterre, the tower, the loft piers, the two gate approaches and the walk to
 * the Crestway — and rising to about 2.2 m in the far corners so the curtain
 * wall has something to sit against. Nothing on it is steeper than TUNE.slope
 * .slideDeg, so you can run anywhere without sliding.
 * ======================================================================== */

const TERRAIN = {
  kind: 'terrain',
  origin: [YX0, YZ0],
  size: [YX1 - YX0, YZ1 - YZ0],
  res: 1.0,
  surface: 'grass',
  heights: {
    seed: 8801,
    base: 0.0,
    hills: [
      { p: [-15.0, 45.0], r: 11.0, h: 1.9 },
      { p: [18.0, 45.0], r: 12.0, h: 2.2 },
      { p: [21.0, 17.5], r: 8.5, h: 1.1 },
      { p: [-19.0, 24.0], r: 7.0, h: 0.8 },
    ],
    flats: [
      { p: [0.0, 16.5], r: 13.0, h: 0.0 },      // the apron and the doors
      { p: [0.0, 30.0], r: 10.5, h: 0.0 },      // the parterre
      { p: [0.0, 25.2], r: 7.0, h: 0.0 },       // under the garden loft
      { p: [-17.0, 36.0], r: 8.0, h: 0.0 },     // the tower's footing
      { p: [0.0, 45.0], r: 7.5, h: 0.0 },       // the walk to the Crestway
      { p: [23.0, 30.0], r: 5.5, h: 0.0 },      // azure-1's approach
      { p: [-22.0, 22.0], r: 5.5, h: 0.0 },     // azure-2's approach
      { p: [-22.5, 15.5], r: 5.0, h: 0.0 },     // the wyrm turret's skirt
    ],
    ridges: [],
  },
  /* ROUND 2: camera-local ring (terrain.js). `density` is blades/m2 and sizes
   * the wrapping tile; `cross: false` halves the field's triangles — a crossed
   * card buys nothing at this blade size and the Keep was 27 k triangles over
   * the perf budget with it on. */
  grass: { count: 9000, density: 26, height: 0.22, cross: false, color: 0x548036 },
  paths: [
    { pts: [[0, 14], [0, 24], [0, 25.8]], w: 3.4 },
    { pts: [[0, 35.2], [0, 41], [0, 47]], w: 3.4 },
    { pts: [[-5.6, 30], [-12, 32], [-17, 34]], w: 2.6 },
    { pts: [[5.6, 30], [16, 30], [23, 30]], w: 2.4 },
    { pts: [[-5.6, 26], [-14, 23], [-22, 22]], w: 2.4 },
  ],
};

const FOUNTAIN_WATER = {
  kind: 'water',
  p: [0, (WATER_TOP + WATER_BOT) / 2, FZ],
  s: [8.4, WATER_TOP - WATER_BOT, 8.4],
  kind2: 'pool',
  surfaceY: WATER_TOP,
};

/* ===========================================================================
 * 12. CHECKPOINTS, NPCS AND SECRETS
 * ---------------------------------------------------------------------------
 * Five checkpoints, one per room, each standing where you ARRIVE in that room
 * and facing what the room is for. The Keep cannot kill, so these are pure
 * convenience: `?cp=` and the Save's session checkpoint use them, and
 * loopcheck.py walks them in order.
 * ======================================================================== */

const CHECKPOINTS = [
  { id: 'cp-lobby', name: 'THE LOBBY HALL', p: [0.0, LOBBY + 0.05, -1.0], yaw: WEST },
  { id: 'cp-gallery', name: 'THE GALLERY', p: [0.0, GAL + 0.05, -11.0], yaw: NORTH },
  { id: 'cp-undercroft', name: 'THE UNDERCROFT', p: [-14.0, UNDER + 0.05, 4.0], yaw: NORTH },
  { id: 'cp-courtyard', name: 'THE COURTYARD', p: [0.0, 0.05, 16.4], yaw: SOUTH },
  { id: 'cp-tower', name: 'THE TOWER ROOF', p: [-19.7, ROOF + 0.05, 33.0], yaw: EAST },
];

/**
 * OLD FEN, the Keep's caretaker. Six lines, one per press of INTERACT, cycled
 * by game.js (`save.flags.fenLine`). `{crests}` is substituted with the current
 * crest total. Every line teaches one move and nothing else — the Keep has no
 * tutorial pop-ups.
 */
const FEN_LINES = [
  'Walk it first. Push the stick gently and you stroll; push it home and you run. Your boots know the difference even when you do not.',
  'Land and jump again straight away, then again. Three jumps, each one taller than the last, and the third one turns you over.',
  'Already moving? Crouch, then jump. That sends you far instead of high. It is called a long jump and it is how you cross the balcony.',
  'Standing still? Crouch, then jump. Straight up and a little backwards. Useful under a low ledge, and it looks wonderful.',
  'Off a wall, jump again before you slide down it. Two walls facing each other will carry you to any roof in this Keep — the tower shaft being the obvious one.',
  'Crouch while you are in the air and you come down like a dropped anvil. Grates give way. So does my patience. You have {crests} crests, by the way.',
];

const NPCS = [
  { kind: 'fen', name: 'OLD FEN', p: [17.0, GAL + 0.05, -21.0], yaw: WEST, lines: FEN_LINES },
];

/* Old Fen also needs a body: critters.js builds the model, game.js pairs it
   with the dialogue above by kind. */
const CRITTERS = [
  { kind: 'fen', p: [17.0, GAL + 0.05, -21.0], yaw: WEST, idle: 'read' },
];

/**
 * The three things the Keep hides. `kind` says how each is opened; `flag` is
 * the Save.flags key the integrator sets when it is. Nothing here is required
 * to finish the game — they are the reasons to keep walking around the hub.
 */
const SECRETS = [
  {
    id: 'keep-grate', kind: 'pound', p: [GRATE[0], LOBBY, GRATE[1]],
    flag: 'keep.grateOpen', target: [GRATE[0], UNDER, GRATE[1]],
    name: 'THE GRATE', hint: 'Something under the lobby floor rattles when you land hard.',
  },
  {
    id: 'wyrmstair', kind: 'door', p: IRON_DOOR.p.slice(), requires: { crests: 10 },
    flag: 'keep.wyrmOpen', name: 'THE WYRM STAIR',
    hint: 'The iron door in the undercroft opens at ten crests.',
    reward: { coins: 3, flag: 'keep.wyrmRun', style: 'race' },
  },
  {
    id: 'crestway', kind: 'glass', p: CRESTWAY.p.slice(), requires: { crests: 60 },
    flag: 'keep.crestwayOpen', name: 'THE CRESTWAY',
    hint: 'Sixty crests. Behind the fountain. That is all anyone will say.',
  },
];

/* Keep coins: the balcony arc and the wyrm ride. They are deliberately NOT in
   `coins` — contract §26 says the hub has none, because a hub coin would be
   free score against a course total. These live in their own field so the
   integrator can spawn them with Collectibles and score them nowhere. */
const KEEP_COINS = ARC_COINS.concat(CHUTE_COINS);

/* ===========================================================================
 * 13. THE DEFINITION
 * ======================================================================== */

export default {
  id: 'keep',
  isHub: true,
  theme: 'keep',
  name: 'THE KEEP',
  subtitle: 'Every painting is a door',
  difficulty: 0,
  order: 0,
  par: null,

  /* Nim arrives on the crest mosaic looking west, straight down the aisle at
     the three VERDANT paintings — the first thing a new player sees is the
     first thing they can do. */
  spawn: { p: [0.0, LOBBY + 0.05, -1.0], yaw: WEST },

  /* Nothing in the Keep kills. This sits 32 m below the undercroft floor and
     exists only so a `?dev=1` noclip that leaves the building still recovers. */
  killY: -40,
  finish: null,
  coins: [],
  keepCoins: KEEP_COINS,

  bounds: { min: [-36, -14, -40], max: [30, 24, 62] },

  checkpoints: CHECKPOINTS,
  gates: GATES,
  npcs: NPCS,
  critters: CRITTERS,
  secrets: SECRETS,
  terrain: TERRAIN,
  waters: [FOUNTAIN_WATER],

  objects: [
    ...LOBBY_SHELL,
    ...KEEP_SKYLINE,
    ...MOSAIC,
    ...PILLARS,
    ...WINDOWS,
    ...GRAND_STAIR,
    ...GALLERY,
    ...RAILS,
    ...LOBBY_DRESS,
    ...LONG_HALL,
    ...LIBRARY,
    ...BALCONY,
    ...UNDERCROFT,
    ...SPIRAL,
    GRATE_OBJ,
    ...TURRET,
    ...WYRM_WALK,
    ...WYRM_CHUTE,
    ...COURTYARD,
    ...TOWER,
    ...CRESTWAY_VAULT,
    ...GATE_OBJECTS,
    IRON_DOOR,
    CRESTWAY,
    TERRAIN,
    FOUNTAIN_WATER,
  ],

  /* Morning light, long shadows, dust in the window shafts. */
  music: 'keep',
  ambience: {
    fog: { near: 22, far: 240 },
    particles: [
      { preset: 'mote', rate: 0.55, box: { p: [0, 6, 0], s: [40, 13, 26] } },
      { preset: 'pollen', rate: 0.35, box: { p: [0, 3, 30], s: [48, 8, 34] } },
    ],
    wind: 0.35,
  },
};
