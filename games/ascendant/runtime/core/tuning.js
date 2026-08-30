/**
 * ASCENDANT — runtime/core/tuning.js
 * ---------------------------------------------------------------------------
 * SOURCE OF TRUTH for every movement number in the game.
 *
 * Nothing in here may be duplicated elsewhere: the player controller, the
 * camera, the hazards and the stage reach-validator all read from this file so
 * that "what the designer authored" and "what the player can actually do" can
 * never drift apart.
 *
 * This module is pure data + pure functions. No imports, no side effects other
 * than the frozen-by-convention constant tables below.
 *
 * Units: 1 unit = 1 metre, seconds, metres/second, metres/second^2. +Y is up.
 */

/* ===========================================================================
 * 0. Global tuning — CONTRACT SECTION 0 (verbatim)
 * ======================================================================== */

export const TUNE = {
  // gravity is asymmetric: falls faster than it rises (kills float)
  gravRise: 38, gravFall: 54, gravWallSlide: 9,
  jumpV: 12.6,            // apex 2.09 m at full hold
  jumpCut: 0.45,          // vy *= jumpCut when jump released while rising
  coyote: 0.11, buffer: 0.13,
  speedRun: 8.6, speedSprint: 12.2, speedCrouch: 4.2, speedAirCap: 12.6,
  accelGround: 95, accelAir: 42, friction: 13, airDrag: 0.35,
  terminal: 65,
  stepUp: 0.55,           // auto step height
  radius: 0.35, height: 1.8, eye: 1.62, crouchHeight: 1.05, crouchEye: 0.92,
  wallSlideMax: 6.0, wallJumpV: [7.4, 11.0], // [away-from-wall, up]
  iceFriction: 1.4, iceAccel: 26,
  conveyorMax: 9.0,
  fovBase: 82, fovSprint: 90, fovKick: 4,
};

/* ===========================================================================
 * 1. Published reach envelope — the authoring limits stages must respect
 * ======================================================================== */

/**
 * The design envelope quoted in the contract. These are ROUNDED, published
 * numbers with a sliver of designer margin baked in; `simulateJump()` below is
 * the exact integration and will read very slightly tighter (~0.5 %) on the
 * flat-gap cases. Validators should treat REACH as the headline budget and
 * `simulateJump()` as the authority when the two disagree.
 */
export const REACH = {
  runFlat: 5.29,      // max horizontal gap, run speed, level landing
  runSafe: 4.4,       // the number a stage should actually be authored to
  sprintFlat: 7.50,   // max horizontal gap, sprint speed, level landing
  sprintSafe: 6.4,    // ditto, authoring target
  airtime: 0.615,     // maximum time off the ground on a full-hold jump
  apex: 2.09,         // peak height above the take-off surface
};

/**
 * The full authoring table from the contract, expressed as data so the stage
 * validator does not have to re-type it. `dy` is the height of the landing
 * surface relative to the take-off surface.
 */
export const REACH_TABLE = {
  run: {
    speed: TUNE.speedRun,
    rows: [
      { dy: 0.0, max: 5.29, safe: 4.4 },
      { dy: 1.0, max: 4.58, safe: 3.8 },
      { dy: 1.8, max: 3.75, safe: 3.0 },
      { dy: -2.0, max: 6.20, safe: 5.2 },
    ],
  },
  sprint: {
    speed: TUNE.speedSprint,
    rows: [
      { dy: 0.0, max: 7.50, safe: 6.4 },
      { dy: 1.0, max: 6.50, safe: 5.4 },
      { dy: 1.8, max: 5.31, safe: 4.4 },
      { dy: -2.0, max: 8.79, safe: 7.4 },
    ],
  },
};

/**
 * Fraction of the theoretical maximum a stage may use before it is "unfair".
 *
 * Chosen so that `safeGap()` is never TIGHTER than any published `safe` value
 * in REACH_TABLE — a stage authored exactly to the contract's table can never
 * be rejected by the smooth helper. (Every row clears it with >= 13 % margin.)
 */
export const SAFE_FRACTION = 0.87;

/** Integration step used by `simulateJump`. Also the step the controller uses. */
export const SIM_DT = 1 / 240;

/* ===========================================================================
 * 2. The canonical jump maths
 * ======================================================================== */

/**
 * Advance a vertical velocity by one step of the game's asymmetric gravity.
 *
 * This is THE gravity function. The player controller must call this rather
 * than integrating gravity itself, otherwise the reach validator and the game
 * disagree and stages become subtly unclearable.
 *
 * @param {number} vy      current vertical velocity (m/s, +up)
 * @param {number} dt      timestep in seconds
 * @param {boolean} [rising]  true => use gravRise. Defaults to `vy > 0`.
 * @returns {number} the new vertical velocity, clamped to terminal velocity.
 */
export function applyGravity(vy, dt, rising) {
  const up = rising === undefined ? vy > 0 : !!rising;
  const g = up ? TUNE.gravRise : TUNE.gravFall;
  let out = vy - g * dt;
  if (out < -TUNE.terminal) out = -TUNE.terminal;
  return out;
}

/**
 * Wall-slide gravity: a much gentler pull, plus a hard cap on slide speed.
 * Exposed here so the controller and any predictive tool agree.
 *
 * @param {number} vy
 * @param {number} dt
 * @returns {number}
 */
export function applyWallSlideGravity(vy, dt) {
  let out = vy - TUNE.gravWallSlide * dt;
  if (out < -TUNE.wallSlideMax) out = -TUNE.wallSlideMax;
  return out;
}

/**
 * Exact fixed-step integration of a single jump.
 *
 * Semi-implicit (symplectic) Euler at dt = 1/240 — the same ordering the player
 * controller uses per physics sub-step:
 *
 *     vy = applyGravity(vy, h, vy > 0);
 *     y += vy * h;
 *
 * The final partial step is linearly interpolated so the returned time is not
 * quantised to 1/240 s; that keeps gap measurements stable when a designer
 * nudges a platform by a few centimetres.
 *
 * @param {object}  opt
 * @param {number} [opt.speed=TUNE.speedRun]  constant horizontal speed (m/s)
 * @param {number} [opt.holdMs=Infinity]      how long jump is held, ms. When the
 *                                            hold ends while still rising the
 *                                            velocity is cut by TUNE.jumpCut.
 * @param {number} [opt.dyTarget=0]           landing height relative to take-off
 * @param {number} [opt.v0=TUNE.jumpV]        launch velocity (jump pads override)
 * @param {number} [opt.dt=SIM_DT]            integration step
 * @param {number} [opt.maxT=8]               safety cut-off in seconds
 * @returns {{t:number, dx:number, apex:number, reached:boolean, vyImpact:number, steps:number}}
 *          t        — airtime in seconds until the landing plane is crossed
 *          dx       — horizontal distance covered in that time
 *          apex     — greatest height reached above the take-off surface
 *          reached  — false when the apex never gets up to dyTarget
 *          vyImpact — vertical velocity at the moment of landing
 *          steps    — whole integration steps taken
 */
export function simulateJump(opt) {
  const o = opt || {};
  const speed = num(o.speed, TUNE.speedRun);
  const dyTarget = num(o.dyTarget, 0);
  const v0 = num(o.v0, TUNE.jumpV);
  const h = num(o.dt, SIM_DT) > 1e-6 ? num(o.dt, SIM_DT) : SIM_DT;
  const maxT = num(o.maxT, 8);

  let holdS = o.holdMs === undefined || o.holdMs === null ? Infinity : Number(o.holdMs) / 1000;
  if (!(holdS >= 0)) holdS = Infinity;   // NaN / negative => treat as full hold

  let t = 0;
  let y = 0;
  let vy = v0;
  let apex = 0;
  let steps = 0;
  let cutDone = false;
  let reached = dyTarget <= 0;
  let vyImpact = 0;

  // A floor well below the target so an impossible jump still terminates.
  const floor = dyTarget - 400;

  while (t < maxT) {
    // Variable jump height: releasing the button while rising truncates the arc.
    if (!cutDone && t >= holdS) {
      if (vy > 0) vy *= TUNE.jumpCut;
      cutDone = true;
    }

    const prevY = y;
    const prevT = t;

    vy = applyGravity(vy, h, vy > 0);
    y += vy * h;
    t += h;
    steps++;

    if (y > apex) apex = y;
    if (y >= dyTarget) reached = true;

    if (vy < 0 && y <= dyTarget && prevY > dyTarget) {
      const span = prevY - y;
      const frac = span > 1e-12 ? (prevY - dyTarget) / span : 1;
      t = prevT + h * (frac < 0 ? 0 : frac > 1 ? 1 : frac);
      y = dyTarget;
      vyImpact = vy;
      break;
    }

    if (y < floor) { vyImpact = vy; break; }
  }

  return { t, dx: speed * t, apex, reached, vyImpact, steps };
}

/**
 * Maximum horizontal gap that can be crossed from a standing-start jump at
 * `speed` onto a surface `dy` metres above (negative = below) the take-off.
 * This is the exact number; `safeGap()` applies the authoring margin.
 *
 * @param {number} speed
 * @param {number} [dy=0]
 * @returns {number} metres (0 when the landing height is unreachable)
 */
export function maxGap(speed, dy) {
  const r = simulateJump({ speed, dyTarget: dy || 0 });
  return r.reached ? r.dx : 0;
}

/**
 * The gap a stage should actually be authored to — `maxGap` with the margin
 * that turns "theoretically possible" into "feels good on the fifth attempt".
 *
 * @param {number} speed
 * @param {number} [dy=0]
 * @returns {number} metres
 */
export function safeGap(speed, dy) {
  return maxGap(speed, dy) * SAFE_FRACTION;
}

/**
 * Peak height above the take-off surface for a given hold length and launch
 * velocity. Used by the validator to check ceiling clearances and by jump pads
 * to convert a desired apex into a launch velocity.
 *
 * @param {number} [holdMs=Infinity]
 * @param {number} [v0=TUNE.jumpV]
 * @returns {number} metres
 */
export function jumpApex(holdMs, v0) {
  return simulateJump({ speed: 0, holdMs, v0 }).apex;
}

/**
 * Inverse of `jumpApex` for the launch impulse of bounce pads: the exact
 * velocity that produces a given apex under gravRise, with the tiny correction
 * for the discrete integrator so a pad's apex is deterministic to the
 * centimetre (contract §13: "bounce pad: exact, deterministic apex").
 *
 * @param {number} apexMetres  target apex height in metres above the pad
 * @returns {number} launch velocity in m/s
 */
export function launchVelocityForApex(apexMetres) {
  const target = apexMetres > 0 ? apexMetres : 0;
  if (target <= 0) return 0;

  // Analytic seed, then two Newton-ish refinements against the real integrator.
  let v = Math.sqrt(2 * TUNE.gravRise * target);
  for (let i = 0; i < 6; i++) {
    const got = simulateJump({ speed: 0, v0: v }).apex;
    const err = got - target;
    if (Math.abs(err) < 1e-4) break;
    // dApex/dv = v / g  =>  dv = -err * g / v
    const dv = -err * (TUNE.gravRise / Math.max(v, 0.5));
    v += dv;
    if (!(v > 0) || !isFinite(v)) { v = Math.sqrt(2 * TUNE.gravRise * target); break; }
  }
  return v;
}

/**
 * Time until a body launched at `v0` falls back to `dy` — the fair-warning
 * budget hazards use when they need to know how long a player is committed to
 * an arc (rotors phase themselves against this).
 *
 * @param {number} [v0=TUNE.jumpV]
 * @param {number} [dy=0]
 * @returns {number} seconds
 */
export function airtimeFor(v0, dy) {
  return simulateJump({ speed: 0, v0: v0 === undefined ? TUNE.jumpV : v0, dyTarget: dy || 0 }).t;
}

/**
 * How far a body falls, straight down from rest, in `t` seconds — used to size
 * void planes and to check that a death pit is actually deep enough to read as
 * a death rather than as a mistake.
 *
 * @param {number} t seconds
 * @returns {number} metres fallen (positive)
 */
export function fallDistance(t) {
  let y = 0;
  let vy = 0;
  const h = SIM_DT;
  const n = Math.max(0, Math.round((t || 0) / h));
  for (let i = 0; i < n; i++) {
    vy = applyGravity(vy, h, false);
    y += vy * h;
  }
  return -y;
}

/* ===========================================================================
 * 3. Derived constants other systems want (computed once, at import)
 * ======================================================================== */

/** Player eye height while standing / crouching, as a ratio of body height. */
export const EYE_RATIO = TUNE.eye / TUNE.height;
export const CROUCH_EYE_RATIO = TUNE.crouchEye / TUNE.crouchHeight;

/** Impact speed at which a landing reads as "heavy" (camera dip + dust). */
export const LAND_SOFT = 9.0;
export const LAND_HARD = 20.0;
export const LAND_MAX = TUNE.terminal;

/** Speed above which the sprint FOV / viewmodel pump is fully engaged. */
export const SPRINT_FOV_SPEED = TUNE.speedRun + 1.2;

/** Convenience: the exact integrated envelope, computed once at module load. */
export const EXACT = {
  apex: round3(jumpApex()),
  airtime: round3(simulateJump({ speed: 0 }).t),
  runFlat: round3(maxGap(TUNE.speedRun, 0)),
  sprintFlat: round3(maxGap(TUNE.speedSprint, 0)),
  runUp1: round3(maxGap(TUNE.speedRun, 1.0)),
  runUp18: round3(maxGap(TUNE.speedRun, 1.8)),
  runDown2: round3(maxGap(TUNE.speedRun, -2.0)),
  sprintUp1: round3(maxGap(TUNE.speedSprint, 1.0)),
  sprintUp18: round3(maxGap(TUNE.speedSprint, 1.8)),
  sprintDown2: round3(maxGap(TUNE.speedSprint, -2.0)),
};

/* ===========================================================================
 * internals
 * ======================================================================== */

function num(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
