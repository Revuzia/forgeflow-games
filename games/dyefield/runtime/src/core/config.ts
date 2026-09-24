// DYEFIELD — movement / camera tuning truth (CONTRACT §4.8). THREE-free, DOM-free.
// Numbers come from DESIGN §4 (movement states) and the DESIGN §2 camera table. Code reads these;
// it never hard-codes a speed, a jump or a camera distance of its own.
//
// Extra fields beyond the CONTRACT §4.8 shape (additive, nothing removed): MOVE.decel, airDrag,
// turnRate, aimTurnRate, coyote, jumpBuffer, groundStick, skin; CAMERA.pivotLag, easeOutSpeed;
// DEV_BRUSH.minFacing. They are tuning knobs of the same systems.

/** Fixed sim step (60 Hz). The render loop interpolates between ticks. */
export const TICK = 1 / 60;
/** At most this many sim steps per rendered frame; any remaining debt is dropped. */
export const MAX_STEPS_PER_FRAME = 5;

export const MOVE = {
  // ── speeds (m/s) — DESIGN §4 movement table ──
  walk: 5.2,          // WALK: neutral floor
  slog: 2.0,          // SLOG: enemy dye underfoot (phase 3)
  slick: 8.4,         // SLICK: SHIFT on own dye (phase 3)
  wallSlick: 5.2,     // WALL-SLICK climb speed (phase 3)
  // ── acceleration (m/s²) ──
  accel: 48,          // ground: 0 → walk in ≈ 0.11 s (toy-snappy, not floaty)
  decel: 36,          // ground: walk → 0 in ≈ 0.14 s when the stick is released
  airAccel: 14,       // AIR: limited air control
  airDrag: 0.6,       // AIR: 1/s horizontal drag with no input (keeps a jump's carry, kills drift)
  // ── vertical ──
  jump: 6.2,          // WALK jump take-off (m/s) → apex v²/2g ≈ 1.28 m
  jumpSlog: 3.8,
  jumpSlick: 7.0,
  gravity: 15,        // AIR: m/s²
  maxFall: 30,        // terminal fall speed (m/s)
  coyote: 0.1,        // s after leaving a ledge during which a jump still counts
  jumpBuffer: 0.12,   // s a jump press is remembered before landing
  groundStick: 0,     // m/s downward bias while grounded. 0: a grounded sweep that grazes the floor snags on internal triangle edges (measured: 90 one-tick stalls per 6600 ticks at 2 m/s, 0 at 0); snap-to-ground (0.3 m) keeps contact on descents
  // ── capsule (Rapier capsule: halfHeight = half the segment; total = 2·(halfHeight + radius)) ──
  radius: 0.32,
  halfHeight: 0.255,  // 2·(0.255 + 0.32) = 1.15 m tall
  slickHalfHeight: 0.05, // SLICK: 2·(0.05 + 0.32) = 0.74 m — the crest-fin height (phase 3)
  stepHeight: 0.35,   // autostep over curbs / lips up to 35 cm
  maxSlopeDeg: 46,    // steeper than this is a wall
  skin: 0.02,         // Rapier KCC offset (gap kept to the surroundings)
  // ── facing ──
  turnRate: 14,       // 1/s exponential yaw rate toward the move direction
  aimTurnRate: 22,    // 1/s while brushing / aiming (faces the camera yaw)
};

export const CAMERA = {
  fovDeg: 68,          // vertical FOV
  pivotY: 1.35,        // pivot height above the feet
  distance: 4.3,       // boom length
  shoulder: 0.42,      // right-shoulder offset (m)
  restPitchDeg: -14,   // look 14° down at rest
  minPitchDeg: -65,
  maxPitchDeg: 40,
  slickPivotY: 0.8,    // SLICK tucks the pivot down…
  slickDistance: 3.8,  // …and pulls the boom in (phase 3)
  collideRadius: 0.22, // sphere-cast radius of the boom collision pull-in
  sensitivity: 0.0022, // radians per mouse pixel (pointer lock movementX/Y)
  pivotLag: 0.05,      // s time-constant of the vertical pivot smoothing (steps, landings); ≤ 0.15 s lag
  easeOutSpeed: 6,     // m/s the boom relaxes back to full length after an obstruction clears (pull-in is instant)
};

/** Phase-2 dev brush: HOLD LMB dyes the floor under the runner's feet (team = the runner's team). */
export const DEV_BRUSH = {
  radius: 1.0,
  perSecond: 12,
  minFacing: 0.3,      // only texels facing up (dot(n, +Y) > 0.3): floors and ramps, never walls
};
