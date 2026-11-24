// DEWPOINT simulation constants. Pure data: no DOM, no three.js.
// Every number a level designer relies on lives here and is echoed (measured) in LEVELS.md.

export const DT = 1 / 120;          // fixed simulation step, seconds
export const GRAVITY = 26;          // m/s^2
export const TERMINAL = 24;         // max fall speed, m/s
export const EPS = 1e-4;            // contact tolerance, metres
export const MAX_SUBSTEP = 0.08;    // max distance moved per collision substep, metres
export const MIN_SOLID = 0.1;       // thinnest solid the collision code guarantees against tunnelling

export const COYOTE_TIME = 0.10;    // s after leaving ground during which a jump still works
export const JUMP_BUFFER = 0.12;    // s a jump press is remembered before landing
export const FORM_COOLDOWN = 0.12;  // s between voluntary form changes
export const FORM_BUFFER = 0.5;     // s a form request is remembered while there is no room for it yet
export const RESPAWN_FREEZE = 0.45; // s of frozen control after a respawn
export const GROUND_SNAP = 0.22;    // m: grounded bodies stick to ground that drops by up to this per step

export const STEAM_MAX = 4.0;       // s of steam
export const STEAM_REFILL = 2.0;    // gauge seconds regained per second (grounded, non-steam)
export const STEAM_MIN_START = 0.4; // gauge needed to switch into steam voluntarily

export const FORM_NAMES = ['liquid', 'ice', 'steam', 'film'];

export const FORMS = {
  liquid: {
    r: 0.38, h: 0.70,
    speed: 5.2, accel: 55, decel: 45, airAccel: 20, airDecel: 3,
    jump: 9.0, step: 0.35, airStep: 0.15,
    fallMul: 1.35,    // extra gravity while falling (snappier arc)
    cutMul: 2.8,      // extra gravity while rising with jump released (variable height)
  },
  ice: {
    r: 0.38, h: 0.76,
    speed: 6.5,       // top speed reachable from input alone
    accel: 9,         // sluggish: momentum
    friction: 2.4,    // m/s^2 of slide friction with no input
    airAccel: 3,
    jump: 5.4, step: 0.15, airStep: 0.05,
    maxSpeed: 15,     // hard cap (slopes can exceed `speed`)
    fallMul: 1.0, cutMul: 1.0,
    launchMin: 1.5,   // m/s of upward slope speed needed to launch off a ramp crest
    waterGravity: 0.45,
  },
  steam: {
    r: 0.38, h: 0.70,
    speed: 3.4, accel: 9, drag: 5,
    rise: 1.4, riseAccel: 10,
    windAccel: 22,    // how hard a fan drags steam to wind speed
    step: 0, airStep: 0,
  },
  film: {
    r: 0.38, h: 0.12,
    speed: 2.2, accel: 30, decel: 30, airAccel: 6, airDecel: 2,
    step: 0.12, airStep: 0.04,
    fallMul: 1.0,
  },
};

export const LIQUID_WIND_FACTOR = 0.75;  // liquid is carried at this fraction of fan strength (horizontal)
export const LIQUID_UPDRAFT_ACCEL = 0.9; // m/s^2 of lift on airborne/any liquid per m/s of vertical fan strength
export const CRATE_PUSH_SPEED = 2.4;     // m/s max speed of ice while shoving a crate
export const PANE_BREAK_SPEED = 5.5;     // default m/s (along the contact normal) for ice to smash a pane
export const WATER_FLOAT_DEPTH = { liquid: 0.28, film: 0.05 }; // how far below the surface the feet float
export const WATER_SPEED_FACTOR = 0.6;   // swim control multiplier
export const SPROUT_GROW_TIME = 1.0;     // s from watering to solid leaves
export const DOOR_TIME = 0.6;            // default s for a door to open/close
