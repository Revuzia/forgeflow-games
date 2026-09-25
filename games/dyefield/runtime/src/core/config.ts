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

// ───────────────────────── phases 3–5 (lane SIM, CONTRACT §10 / §10.4) ─────────────────────────

/** SLICK / WALL-SLICK (DESIGN §4, CONTRACT §10.1). Speeds live in MOVE. */
export const SLICK = {
  accel: 64,           // ground accel in SLICK (m/s²): 0 → 8.4 in ≈ 0.13 s
  surfaceTime: 0.12,   // releasing SHIFT (or leaving own dye) surfaces in this long; firing blocked meanwhile
  edgeGrace: 0.05,     // s a slicker may cross NEUTRAL texels (organic dye edges) before surfacing; enemy dye is instant
  hiddenSpeed: 1.5,    // SLICK not faster than this (m/s) → hidden…
  hiddenRange: 3,      // …from enemies beyond this range (m)
  // wall contact probe: a short sphere cast from the capsule centre along the push direction
  wallCastRadius: 0.28,   // < MOVE.radius so the cast never starts inside the wall the capsule touches
  wallCastDist: 0.25,     // m beyond the start (capsule radius − cast radius + skin ≈ 0.06 is the resting gap)
  wallMaxNy: 0.5,         // |normal.y| below this is a wall (steeper than 60°)
  wallPushDot: 0.5,       // stick · (−wall normal) above this = "pushing into the wall" (enter)
  wallHoldDot: -0.3,      // below this = pulling away (detach)
  wallTexelDist: 0.5,     // painter.surfaceAt(contact, 0.5, 'wall') — the dye at the contact
  wallPush: 1.0,          // m/s pressed into the wall while attached (keeps contact)
  wallStrafe: 0.5,        // sideways crawl speed factor (× MOVE.wallSlick)
  ledgePopVy: 4.5,        // m/s up when the wall ends under a climbing runner (pops onto the ledge)
  ledgePopForward: 3.0,   // m/s over the lip
  wallJumpVy: 6.0,        // jump off a wall: up …
  wallJumpOut: 4.5,       // … and away from it
  headroomMargin: 0.02,   // m extra clearance required before the capsule grows back
};

/** Tank economy (0–100, DESIGN §4). There is NO passive regen. */
export const TANK = {
  max: 100,
  refillPerSecond: 36, // only while SLICK on own dye / own pad: empty → full ≈ 2.78 s
  low: 20,             // tank ≤ this → 'tankLow' (once per dip)…
  lowRearm: 25,        // …re-armed when the tank climbs back above this
  dryCooldown: 0.25,   // s between dry clicks while fire is held with too little tank
};

/** HP (weapons.json has hp + respawnSeconds). */
export const HEALTH = {
  regenDelay: 1.2,     // s after the last hit with no regen
  regenPerSecond: 40,
};

/** Runner hit volume for projectiles (CONTRACT §10.1) — separate from the KCC capsule. */
export const HITBOX = {
  radius: 0.42,
  height: 1.2,
  slickHeight: 0.5,
  hitPuddleRadius: 0.55, // a hit splats a small puddle of the attacker's dye under the victim
  washBurstRadius: 1.5,  // a dye wash bursts the attacker's dye where the victim stood
};

/** Firing / projectiles. Kit numbers live in data/weapons.json. */
export const COMBAT = {
  muzzleHeight: 0.9,      // shots start on the capsule axis at this height above the feet
  poolCapacity: 512,
  maxLife: 2.5,           // s — a droplet older than this is dropped
  verticalSpreadScale: 0.4, // the spread disc is squashed vertically (a flat fan)
  minAimDist: 0.6,        // an aim point closer than this to the muzzle is ignored (aim along yaw/pitch)
  eyeHeight: 1.0,         // canSee: viewer eye height above the feet (tall form)…
  slickEyeHeight: 0.35,   // …and in slick form
  wallClampPad: 0.3,      // floor impact radius ≤ distance to a wall ahead + this (no bleed through thin walls)
  wallFloorPush: 0.45,    // wall impact: the companion floor splat sits this far out along the wall normal…
  wallFloorScale: 0.7,    // …with this fraction of the impact radius
  wallMinFacing: 0.35,    // wall impact paints only texels facing like the wall
  dripMaxDrop: 40,        // m — drip raycast length
};

/** Match flow (CONTRACT §10.1). */
export const MATCH = {
  durationS: 180,
  countdownS: 3,
  minuteHornS: 60,       // 'minute' horn when this many seconds are left
  finalHornS: 10,        // 'final10' horn
  padRadiusFallback: 2.2,
  padPushSpeed: 6,       // m/s an enemy inside your pad is shoved outward (plus its inward velocity is cancelled)
  spawnSlots: [-0.45, 0.45, -1.35, 1.35], // lateral offsets (m, along the pad's right vector) per team slot
  eventCap: 8192,        // queued events beyond this are dropped (counted in stats.eventsDropped)
  hardLandingSpeed: 9,   // m/s fall speed at touch-down that makes a 'land' event hard
};
