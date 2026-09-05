/**
 * CRESTBOUND — runtime/player/camera.js
 * ---------------------------------------------------------------------------
 * Third-person orbit-follow camera. CONTRACT §12.
 *
 *   export class FollowCamera {
 *     constructor(camera, player, input, world, settings);
 *     yaw, pitch, dist, mode:'follow'|'free'|'peek'|'cinematic'|'death';
 *     update(dt);
 *     recenter(); shake(amount, ms); punch(amount); setCinematic(pathDef|null); setDeathCam(bool);
 *     get forwardFlat(); get yawForMovement();
 *   }
 *
 * DESIGN — what a good third-person platformer camera has to get right, and
 * how each rule is implemented here:
 *
 *  1. THE HERO LEADS THE FRAME. The camera does not sit on the hero, it sits on
 *     a FOCUS point that chases the hero with framerate-independent exponential
 *     damping (`TUNE.cam.lagPos`). At full run the focus trails by ~1 m, so the
 *     hero is always slightly ahead of centre in the direction of travel and the
 *     player sees where they are going. Vertical lag is SLOWER while airborne
 *     (a single jump does not bob the frame) but a FALL — measured as metres
 *     below the peak of the current arc, which no hop can reach — catches up
 *     within 0.4 s, drops the focus and tips the lens down so the landing
 *     target is in frame for the whole descent. The focus also eases down from
 *     head height toward the chest as the lens closes, so a close camera
 *     centres the hero instead of letting him slide off the bottom edge.
 *
 *  2. NEVER FIGHT THE PLAYER. Auto-yaw (easing the camera behind the run
 *     direction) only runs in 'follow' mode, only above 4 m/s, only after 1.2 s
 *     with no manual orbit, never while the hero runs TOWARD the camera (the
 *     classic dead-zone — otherwise the camera whips around while you are
 *     looking at the hero's face), and is FROZEN during every committed move
 *     (long jump, dive, slide, wall kick, pound, side/back flip, cannon). Its
 *     rate ramps in with `TUNE.cam.lagYaw` so it starts and stops as an S-curve
 *     rather than a step. `yawForMovement` (what the controller steers by)
 *     holds the PREVIOUS yaw for 0.15 s after a recenter so a mid-air stick
 *     input never flips direction under the player.
 *
 *  3. NEVER CLIP — AND NEVER DELETE THE HERO. Seven whisker rays (five spread
 *     ±0.50 m along camera-right, plus a vertical pair at chest height and above
 *     the focus) are cast from the focus toward the desired camera position
 *     through `world.broadphase.raycast`. Three rays at focus height missed any
 *     occluder whose top sat between the chest and the focus, and any pillar
 *     narrower than the whisker gap; the fan and the vertical pair close both.
 *     A hit pulls the camera in to `t − collideRadius`, rate-limited so no
 *     single frame can swallow metres of distance; clearing eases back out over
 *     0.6 s so the camera never pumps. An eighth ray protects the shoulder
 *     offset itself, so pressing the hero into a wall cannot push the focus
 *     inside it.
 *
 *     Pull-in alone is NOT an occlusion response: past `TUNE.cam.frameMin` the
 *     hero stops being readable, so below that the solver re-casts the fan at
 *     yaw offsets (±0.18 / 0.36 / 0.55 rad, and ±0.75 / 1.05 / 1.35 when the
 *     alternative is erasing a hero who is moving too fast to orbit out of it
 *     himself) and eases onto the cheapest heading that frames him — sliding
 *     around a pillar rather than shoving the lens into his back. A heading step
 *     is only taken into air the lens can live in, so the ease can never sweep
 *     the lens through a post and dolly 5 m to it and back. When no heading
 *     clears (hero at rest, flat against a long wall) the tight pull-in still
 *     happens, floored only at the near plane, exactly as CONTRACT §12 requires.
 *     The pull-in itself EASES — over at most 0.1 s — and snaps whole only where
 *     the eased lens position would be inside a collider, which is the honest
 *     line between "the hero is hidden" (occlusion, budgeted) and "the lens is
 *     in a wall" (clipping, never). And as the lens closes, the position lag and
 *     the shoulder — what make the hero LEAD the frame at range — fade out, so a
 *     tight camera CENTRES him instead of leaving him behind its own near plane.
 *     The hero fades (`player.heroFade` 0..1, read by hero.js) only under 1.25 m,
 *     where the lens genuinely reaches the model, and the fade is CAPPED below 1
 *     outside peek/cinematic: a camera may ghost the player character, never
 *     erase it.
 *
 *  4. MOTION FEEL IN THE LENS. FOV eases from `fov` to `fovRun` with speed,
 *     +6° on long jump / dive, +4° underwater (and the post chain is told, for
 *     its tint + wobble), `peekFov` in peek. Impacts are analytic critically-
 *     damped springs (a 50 ms frame cannot blow them up): `punch()` on a pound
 *     landing dips the distance, kicks the FOV and nods the pitch; `shake()` is
 *     smooth lattice value-noise, never a random jitter.
 *
 *  5. MODES are explicit and exclusive: follow | free (no auto-yaw, no pitch
 *     return) | peek (first person from the head, hero hidden) | cinematic
 *     (Catmull-Rom path — course intro, crest celebration orbit) | death
 *     (focus frozen at the death point, slow orbit, 1.5 m pull-out). Leaving a
 *     cinematic blends back to the follow pose over 0.6 s; leaving death after
 *     a respawn snaps the focus to the hero and the yaw behind them, because a
 *     respawn must be crisp.
 *
 * Coordinate conventions (CONTRACT): yaw 0 faces −Z, +yaw is counter-clockwise
 * from above; `headingFromYaw` is the ONE conversion. `pitch` is the camera's
 * ELEVATION above the focus (positive = camera above, looking down).
 * `input.look` is in radians and already sens+invert scaled (CONTRACT §4).
 *
 * The camera is posed in WORLD space: it must be a root-level object (parent
 * = scene or none). No per-frame heap allocation: every temporary is hoisted.
 */

import * as THREE from 'three';
import { TUNE, headingFromYaw, yawFromHeading } from '../core/tuning.js';
import {
  clamp, lerp, damp, smoothstep, wrapAngle, shortestAngle,
  easeInOutSine, moveTowardAngle,
} from '../core/util.js';
import { Settings as SettingsSingleton } from '../core/settings.js';
import { Collider, rayBoxT } from '../world/collider.js';

/* ───────────────────────────── constants ───────────────────────────── */

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

// auto-yaw
const MANUAL_IDLE_S        = 1.2;    // s without manual orbit before auto-yaw may run
const AUTO_MIN_SPEED       = 4.0;    // m/s
const AUTO_TOWARD_DEADZONE = 2.55;   // rad: |delta| above this = running at the camera → hold
const AUTO_SOFT_DELTA      = 0.45;   // rad: rate scales down inside this so it never hunts

// pitch return
const PITCH_IDLE_S         = 3.0;
const PITCH_RETURN_RATE    = 0.25;   // rad/s

// focus lag
const AIR_LAG_V            = 3.5;    // vertical lambda while airborne (no bob on a hop)
const AIR_CATCHUP_DY       = 2.5;    // m: RISING beyond this vertical error, catch up fast
const AIR_CATCHUP_LAMBDA   = 7.5;    // e^-7.5·0.4 ≈ 5 % — settles within 0.4 s
// A FALL is not a hop, and "metres below the peak of the CURRENT arc" separates
// them exactly: the jump family never drops past its own apex, so a single jump
// (apex 1.911 m) barely enters the FALL_LOOK band and a tower-roof fall crosses
// it in ~0.35 s. Everything below ramps on that one measure, so nothing steps.
// Without it the focus trails a long fall by v/AIR_LAG_V ≈ 7 m and the hero
// rides the bottom edge for the whole descent (audit: fall arc at |ndcY| 0.95;
// measured after: the same rampart fall arc peaks at 0.649).
const FALL_CATCHUP_LAMBDA  = 14.0;   // vertical lambda at a FULL fall (lag = v/λ)
const FALL_LOOK_M0         = 1.4;    // m below peak: the look-down bias starts
const FALL_LOOK_M1         = 3.5;    // m below peak: the look-down bias is full
const FALL_FOCUS_DROP      = 0.90;   // m the focus drops on a full fall (see the landing)
const FALL_PITCH_LIFT      = 0.18;   // rad the lens tips down on a full fall
// A FALL IS ALSO WHAT IS UNDER YOU - and depth-below-peak alone reads it far
// too LATE. Depth is a CONSEQUENCE of the fall, so it can only be measured
// after the metres have been spent: with gravFall 46 the hero is 3.5 m below
// the peak (full fallK) 0.39 s into the arc, and the eased pitch needs another
// ~0.2 s on top. Measured before this fix: the keep tower-roof fall (0.75 s)
// showed the LANDING in 7 % of its frames and the verdant-1 rampart fall
// (0.517 s) in 10 %, the pitch leaving 0.220 rad only at t 27.85 of an arc
// that began at 27.58. A player who missed a ledge was blind for ~90 % of it.
// The honest question is not 'how far have you fallen' but 'how much air is
// under you', and ONE downward ray from the hero answers it on the FIRST
// descending frame. It separates a fall from the jump family on exactly the
// principle the depth measure uses, with more margin: over flat ground the
// air under a hero at the apex of his highest jump IS that apex (triple =
// 3.578 m from TUNE.jumpV[2] and gravRise), so a 4.0 m threshold can never
// fire on a hop - while a triple jump ACROSS a chasm reads the chasm, which
// is the frame the player wants. Gated on descending, so a rising jump never
// nods the lens.
const FALL_PROBE_M         = 26.0;   // m: how far below a descending hero to look
// M0 clears the HIGHEST thing the moveset can put under a hero over flat
// ground — the bounce pad's 4.0 m apex (TUNE.bounceDefaultApex), above the
// triple's 3.578 m — so no hop can reach it. M1 is set from the geometry of
// the shortest drop that actually needs the frame: verdant-1's rampart fall
// is ~6 m, and with the lens 6.8 m back the landing sits ~57 deg below the
// horizon, so the view centre has to reach ~30 deg to hold it — which is
// full FALL_PITCH_DEEP, not a fraction of it. (Measured at M1 = 12: that
// fall read deepK 0.10, pitch 0.383, landingInFramePct 19.)
const FALL_DROP_M0         = 4.0;    // m of air below: deep-fall framing starts (> every apex)
const FALL_DROP_M1         = 6.5;    // m of air below: deep-fall framing is full
// ...and it has to tip FAR, not politely. To put a landing 10 m down inside a
// 58 deg vertical fov with the lens 6.8 m back, the view centre has to sit
// ~45 deg below the horizon; FALL_PITCH_LIFT alone (0.18 rad on top of
// defaultPitch 0.22) reaches 23 deg and frames sky and wall. Suppressed under
// a ceiling for the same reason CLOSE_PITCH_LIFT is: raising the lens into
// the surface that is already limiting it is how a pull-in latches.
const FALL_PITCH_DEEP      = 0.48;   // rad added at a full deep fall (total <= pitchMax)

// collision
const WHISKER_M            = 0.25;   // lateral spacing of the horizontal fan
const WHISKER_N            = 2;      // → 5 horizontal rays at 0, ±0.25, ±0.50 m
const WHISKER_DOWN_M       = 0.70;   // vertical probe at ~chest height (focus − 0.70)
// The ceiling probe rides one collide-radius above the focus and reports its RAW
// hit distance: `t − collideRadius` is only the right sphere clearance for a
// surface square-on to the ray, and a ceiling is nearly PARALLEL to it, where the
// correct answer is the offset probe's own t. (The old three-ray fan had no
// ceiling probe at all and let the lens intersect any low roof it ducked under.)
const WHISKER_UP_M         = 0.35;   // = TUNE.cam.collideRadius
const COLLIDE_OUT_LAMBDA   = 5.0;    // 95 % of the way back out in 0.6 s
const COLLIDE_OUT_MAX_RATE = 12.0;   // m/s ceiling so a long pull-in never snaps out
// PULL-IN: EASED, EXCEPT WHERE EASING WOULD PUT THE LENS INSIDE A SOLID.
// The audit measured single frames deleting 6.08 m against a 1.5 m budget. The
// old note here argued the whole travel is "already behind the occluder", so
// easing it would render N frames from inside a wall — and that conflates two
// different things. A whisker hit says the hero is HIDDEN from the lens
// (occlusion, budgeted at 0.3 s by camcheck); it does NOT say the lens is inside
// geometry (clipping, never allowed). A post between hero and camera hides him
// while the lens sits in open air on the far side; a wall does both. So the
// pull-in eases, and the thing that makes it snap is the honest test of the
// distinction: `_lensEmbedded` asks the broadphase whether the lens would be
// INSIDE a collider at the eased distance, and if it would, the whole travel is
// illegal and the pull-in is taken in one frame exactly as before. camcheck's
// wall row is a snap (dt ≤ 0 resolve) and is unchanged either way.
// The ease closes any gap inside COLLIDE_IN_MAX_S so the occlusion it trades
// for stays far inside that 0.3 s budget, and the rate/step caps keep the
// worst single frame inside the audit's 1.5 m at any frame rate.
const COLLIDE_IN_MAX_RATE  = 24.0;   // m/s floor rate for a small gap
const COLLIDE_IN_MAX_STEP  = 1.00;   // m — hard per-frame ceiling (any dt)
const COLLIDE_IN_MAX_S     = 0.10;   // s — the whole gap is closed within this
// How long an eased pull-in may WAIT on the far side of a body that moved between
// the lens and the hero before it cuts to the fan's answer on the hero's side
// (see the STALL note in _updateDistance). Under the CONTRACT's 0.3 s occlusion
// budget with the cut itself and one frame of slack.
const COLLIDE_STALL_MAX_S  = 0.15;
// THE PULL-IN STAYS INSTANT, deliberately. The audit measured a single frame
// deleting 5.70 m against a 1.5 m budget, and the obvious reading is "rate-limit
// it" — but `want` IS the first blocked distance, so every metre between the
// current distance and `want` is a metre with the lens ALREADY behind the
// occluder. Easing that travel does not smooth a camera move, it renders N
// frames from inside a wall. (Tried and reverted: an eased pull-in also made
// camcheck's wall row unmeasurable, since the lens is inside the wall for the
// whole ease.) What actually produced the audit's number was the DESTINATION —
// 0.12 m, with the hero behind the lens, held for 1.6 s. The framing floor plus
// the yaw slide fix that: the destination is now ~frameMin wherever any bounded
// heading is clear, so the amplitude the player sees is bounded by the geometry
// rather than by a rate cap that would have to clip to be honoured.
// Floor for the COLLISION pull-in only. `TUNE.cam.minDist` is the orbit/zoom
// minimum — the closest the player may pull the camera themselves — and must
// NOT clamp the whisker result: a wall 0.4 m behind the hero (hero pressed flat
// against it) would then hold the lens 1.6 m back, i.e. on the far side of the
// wall. CONTRACT §12 says "pull in to hit − collideRadius" with no floor, so the
// only real floor is the renderer's near plane (engine DEFAULT_NEAR 0.05).
const COLLIDE_MIN_DIST     = 0.12;
const DIST_LAMBDA          = 6.0;    // base distance changes (death pull-out) ease

// A PROBE ORIGIN CAN START INSIDE A SOLID, and the fan used to take the answer
// literally. `Broadphase.raycast` reports an origin inside a box as the
// degenerate hit `t = 0, normal = −dir` (collider.js `rayBox`: "origin inside"),
// and a heightfield reports the same for an origin under the ground. The old fan
// turned that into `limit = 0 − collideRadius = −0.35` at EVERY candidate
// heading, so `want` floored to COLLIDE_MIN_DIST, the yaw-slide solver could
// never buy SLIDE_GAIN_MIN (every candidate scored the same 0), and the lens sat
// 0.12 m from the hero with a wall filling the frame. Measured before this fix:
// 8 of 288 swept headings at two authored checkpoints (keep cp-undercroft, a
// spiral-stair tread through the fan; verdant-1 cp-rampart, the chest probe
// inside the fort's upper slab), 2.96 s continuous in real play, and the same
// collapse underwater in the OPEN meadow where the swim focus drops under the
// lake bed. GEOMETRY THAT CONTAINS THE FOCUS CANNOT OCCLUDE IT: a probe now
// steps past the containing collider's own exit face and asks again, so the
// limit always comes from the first surface that is really BETWEEN the focus and
// the lens. A surface the focus merely TOUCHES (t ≈ 0, origin not inside) is
// still an honest occluder and still stops the probe — that is camcheck's wall
// row, and it must keep pulling the lens in.
const EMBED_EPS_M          = 1e-3;   // t at/below this + origin inside = degenerate
const EMBED_SKIP_MAX       = 8;      // containing shells stepped through, then give up
const EMBED_STEP_PAD       = 0.02;   // m past the exit face, so a step always leaves
const EMBED_HF_STEP        = 0.35;   // m per step when the container is a heightfield
const EMBED_FREE_N         = 8;      // samples when backing an embedded ease off a wall

// Framing floor + yaw slide. `TUNE.cam.frameMin` is the distance below which the
// hero stops being readable, so the solver treats a pull-in past it as a FAILURE
// to be resolved by moving the lens sideways rather than by swallowing the hero:
// it re-casts the fan at a handful of bounded yaw offsets and eases onto the
// cheapest heading that frames him. A slide is only taken when it actually buys
// clearance (SLIDE_GAIN_MIN), so the classic "hero flat against a long wall"
// case — where no bounded heading can clear — still pulls the lens in tight
// exactly as CONTRACT §12 requires, instead of spinning the world.
// TWO TIERS. The bounded three are what a camera should try for an ordinary
// pillar. The wide three exist for one measured case the bounded set cannot
// reach: the Keep lobby, hero running 8.6 m/s with his back to the aisle wall.
// Swept through this module's own `_clearance` at the jammed frame (probe:
// `_harness/_camnook.py`), every heading from −31° to +31° reads ≤ 0.19 m — and
// −50° reads 6.800 m, the full distance, in open hall. The camera was erasing
// the hero for 1.32 s while a 50° swing had him fully framed. So when the
// bounded set fails AND the pull-in would fade the hero AND he is moving fast
// enough that he cannot orbit out of it himself, the search widens.
//   * `c0 < FADE_START_DIST`: only where the alternative is a ghosted or erased
//     hero. Above that the tight pull-in is a legitimate close camera.
//   * `speed > AUTO_MIN_SPEED`: standing still, the player owns the orbit and a
//     70° unrequested swing (which also rotates `yawForMovement`) is the camera
//     spinning the world — the same threshold auto-yaw uses, for the same
//     reason. It is also what keeps the authored "hero flat against a long
//     wall" terminal case (CONTRACT §12, camcheck's wall row) exactly as it is:
//     that hero is at rest, so the wide tier never opens there.
const SLIDE_STEPS          = [0.18, 0.36, 0.55, 0.75, 1.05, 1.35];  // rad, nearest-first, both signs
const SLIDE_BOUNDED_N      = 3;      // the first N are always available
const SLIDE_RATE           = 3.2;    // rad/s onto an avoidance heading
const SLIDE_RELEASE_RATE   = 1.4;    // rad/s back to the player's heading
const SLIDE_GAIN_MIN       = 0.25;   // m — a slide must buy at least this much
const SLIDE_RELEASE_M      = 0.50;   // m hysteresis so the solver cannot hunt
// …and a second, sharper guard on the same failure. The hysteresis above is
// measured on the UN-SLID heading, which says nothing about the headings the
// ease PASSES THROUGH on its way home. Measured (probe `_harness/_camjam.py`,
// verdant-1 brook, hero standing still at zero speed with nothing in the world
// moving): `slideWant` alternated 0 / −0.55 rad across the hysteresis boundary,
// the ease swept the lens ±0.053 rad per frame, and one of those intermediate
// headings has a post in it — clearance 0.62 m against 6.80 m one step away. The
// lens dollied 5.19 → 0.62 m in a single frame and back out again: the audit's
// −4.90 m "pump", produced entirely by the camera's own heading sweep. So a
// heading step is only taken if the lens can actually LIVE at the heading it
// lands on. Refusing the step costs one fan (only while the slide is moving) and
// leaves the camera on a heading that already frames the hero.
const SLIDE_STEP_LOSS      = 0.60;   // m — a step may not cost more clearance than this

// ── THE SHAFT TIER: when NO yaw heading can give the lens minDist ────────────
// The yaw slide answers "go around the occluder". It cannot answer a SHAFT,
// because a shaft is blocked at every yaw at once. verdant-1's west tower
// (course def line 701, ROUTE B, an authored primary route) is 3.30 m clear:
// the hero stands 1.65 m from each wall, so with `collideRadius` 0.35 the
// widest legal HORIZONTAL lens offset is 1.30 m — below `minDist` 1.6 at every
// one of the 12 yaw candidates. The solver therefore fell through to the
// terminal "flat against a long wall" branch and pulled the lens to
// COLLIDE_MIN_DIST 0.12 m, i.e. inside Nim's head. MEASURED before this tier
// (`_harness/_r3_shaftcam.py` → `_r3_shaftcam.json`, the 200-frame kick
// ladder): camera-to-head min 0.246 m, `cam.dist` floored at 0.120, 73/200
// frames closer than minDist, 20 frames inside the 0.05 near plane, longest
// unbroken not-usably-visible run 0.883 s against the gate's 0.3 s. Occlusion
// read 0 % the whole time — the pull-in had DODGED the occlusion test by
// clipping through the hero. The one move that most needs the player to see
// which wall they are facing was performed blind.
//
// A shaft has clearance the yaw fan never asks for: the shaft is OPEN ALONG ITS
// AXIS. So when the yaw search bottoms out under `minDist`, the solver tilts —
// over-the-head (lens above, looking down the shaft) first, up-the-shaft (lens
// below, looking up) second — and re-runs the FULL fan at each candidate pitch.
// Geometry: at pitch p and distance d the lens sits d·cos p out and d·sin p up,
// so a 3.30 m shaft (1.30 m usable) admits d = 1.6 m at p ≥ 0.62 rad and
// d ≈ 2.2 m at p = 0.95 rad. The tier therefore buys real distance where the
// yaw fan can buy none, and it is the framing every 3D platformer uses in a
// chimney.
//
// NOT FROZEN DURING A COMMITTED MOVE, deliberately, and this is the whole point
// of choosing pitch. CONTRACT §12's freeze rule ("during longjump/dive/wallkick
// /pound: freeze auto-yaw") and camcheck's longjump/dive rows are about YAW:
// yaw rotates `yawForMovement` and therefore fights the player's steering. An
// elevation change rotates nothing the controller reads, and the states that
// need this tier most (wallkick, wallslide) are exactly the frozen ones.
//
// HOW STEEP, AND WHY. SWEPT with this module's own `_clearance` at the collapse
// frames of the ladder (`_harness/_r4_shaftsweep.py` -> `_r4_shaftsweep.json`,
// frame 36: hero (-9.20, 11.94, -31.53), i.e. pressed 0.38 m off the shaft's
// north wall, camera yaw 0 pointing straight at it):
//
//     posed pitch   0.00   0.30   0.60   0.90   1.10   1.25   1.40
//     clearance     0.03   0.05   0.11   0.27   0.49   0.86   1.90   (m)
//
// The curve is cot(pitch) x the 0.38 m the wall is away: it does not cross
// `minDist` 1.6 until ~1.36 rad, which is why a 1.25 cap measured as "the tier
// engaged and then gave up" (pitchWant fell back to 0 at frames 36-48 and the
// lens sat at 0.12-0.17 m). 1.40 rad is 80.2 degrees - steep, and deliberately
// still 9.8 degrees off the degenerate straight-down pose where `lookAt` with a
// +Y up vector has no defined roll. The steps have to be able to REACH the cap
// from a low aim pitch, hence the last two.
//
// The tilt-in is FAST and the release SLOW, the same safety-in/slow-out
// asymmetry as ADAPT_IN/OUT_LAMBDA and COLLIDE_IN_MAX_S, and for the same
// reason: the tilt is the response to a collapse that has already started, and
// a rescue that arrives a third of the way through the move is not a rescue.
// MEASURED on the ladder: at 4.5 rad/s the 0.66 rad it needs takes 0.15 s and
// the lens still bottomed at 0.604 m while the tilt caught up (min 0.246 m
// before the tier existed); the whole remaining deficit was ease lag, so the
// rate is set where the gap closes inside the pull-in's own 0.10 s window.
// PITCH_ARM_M buys the other half of it: the search may ARM a little above
// `minDist` (it can see the collapse coming a few frames earlier), while
// ADOPTION still demands a candidate that actually reaches `minDist` and buys
// PITCH_SLIDE_GAIN_MIN — so arming earlier can only make the rescue punctual,
// never make the camera tilt where it did not have to.
const PITCH_STEPS          = [0.22, 0.45, 0.68, 0.92, 1.20, 1.45];  // rad above the aim pitch
const PITCH_ABS_MAX        = 1.47;   // rad — hard cap on the posed pitch under this tier
const PITCH_ARM_M          = 0.35;   // m above minDist at which the search starts looking
// THE TIER TAKES THE CHEAPEST TILT THAT WORKS, and "works" is `minDist` plus a
// margin — NOT the framing floor. Searching to `frameMin` 2.4 m is what pushed
// the ladder to the 1.47 rad cap and produced a straight-down shot of the top of
// Nim's head (`_shots/feel_r4/kick_038.png`); the same ladder two frames earlier,
// at 1.07 rad and 2.02 m, frames him face-on between both walls with the shaft
// floor and the exit ledge in shot (`kick_030.png`). A shaft is a place the
// camera is ALLOWED to be close; it is not a place it may be blind.
const PITCH_TARGET_M       = 0.25;   // m above minDist — the tier's search target
// TRIED AND REVERTED — A POSE-ONLY SWING, with the measurement.
// At frames 38-46 the hero is pressed 0.38 m off the shaft's north wall with
// the camera yaw pointing at that same wall, where the clearance curve is
// cot(pitch) x 0.38 m: it does not reach the goal until ~1.43 rad, and that is
// a photograph of the top of Nim's head (`_shots/feel_r4/kick_042.png`) —
// visible, but steep. The shaft's OTHER axis is wide open (swept at that frame,
// `_r4_shaftsweep.json`: yaw +-1.75 rad reads 2.17-2.20 m at a comfortable 0.90
// rad pitch), so a swing was built: an offset folded into `_yawSlide` and
// subtracted back out of `yawForMovement`, so it rotated the LENS ONLY and
// could legally run during the frozen states. It made the ladder WORSE, and for
// the reason SLIDE_STEP_LOSS already records: the target heading is clear, but
// the headings the ease PASSES THROUGH are not. Measured with it in, tilt cap
// 1.05 rad: `dist` 0.12 m and `heroFade` 1.00 for frames 38-50 (against a
// 1.803 m minimum and fade 0.00 throughout with the tilt alone), because
// 1.75 rad at 4 rad/s takes 0.44 s to cross a 0.35 s collapse and the camera
// spends the transit inside the wall it is swinging around. A rescue that
// arrives after the move is not a rescue. The tilt has no transit problem — the
// shaft is open along the elevation axis for its whole length — so it is what
// ships.
const PITCH_SLIDE_RATE     = 9.0;    // rad/s onto a shaft framing
const PITCH_RELEASE_RATE   = 1.1;    // rad/s back to the player's pitch
const PITCH_SLIDE_GAIN_MIN = 0.35;   // m — a tilt must buy at least this much
const PITCH_RELEASE_M      = 0.45;   // m hysteresis, same role as SLIDE_RELEASE_M

// hero fade. This must NEVER reach 1 outside peek/cinematic: a camera that makes
// the player character 100 % invisible while the player still has full control is
// not shippable (audit: 3 of 24 orbit headings at a rampart settled at 1.5 m with
// heroFade 1.0 — a perfectly ordinary close camera, no near-plane risk at all).
// Fading now begins only where the lens is genuinely about to slice the model.
const FADE_START_DIST      = 1.25;   // m — above this the hero is fully solid
const FADE_FULL_DIST       = 0.45;   // m — at/below this the fade is at its cap
const HERO_FADE_MAX        = 0.75;   // ghosted, never gone
// …with ONE exception, below the model's own radius. The cap answers "never
// erase the character the player is steering", and at 0.45–1.25 m that is
// exactly right. Under ~0.3 m the lens is not near the hero, it is INSIDE his
// head, and a 75 %-opaque skull smeared across the whole frame is not a ghost —
// it is an opaque red slab over the left third of the image with nothing
// readable behind it (measured at keep cp-undercroft: dist 0.12, fade 0.75,
// hero NDC (−3.55, −1.29), i.e. the "ghost" was off-screen and only his body
// interior was on it). There the honest pose is a clean first person, the same
// thing `peek` renders, so the fade commits to 1 over this last band. It is a
// terminal case the collision solver now avoids at every authored station; this
// is what it looks like when the geometry leaves no other answer.
const FADE_FP_DIST         = 0.30;   // m — at/below this: committed first person

// adaptive framing: the focus rides at head height at range and eases down to the
// chest as the lens closes, so the hero is centred instead of sliding off the
// bottom of the frame exactly when he is hardest to see.
const FOCUS_LOW_D0         = 2.2;    // m — focus fully lowered at/below this dist
const FOCUS_LOW_D1         = 4.5;    // m — focus at full head height at/above this
const FOCUS_DROP_MAX       = 0.62;   // m (1.55 → 0.93, i.e. chest)
const PITCH_ADAPT_LAMBDA   = 6.0;    // eases the derived pitch offset
// Safety-in, slow-out - the same asymmetry as ADAPT_IN/OUT_LAMBDA and for the
// same reason: an offset that is GROWING is the frame catching up with
// something the player needs to see (the ground under a fall, a closing lens)
// and it must not arrive a third of the way through the event.
const PITCH_ADAPT_FAST     = 12.0;   // rad-offset lambda while the offset grows
const CLOSE_PITCH_LIFT     = 0.10;   // rad added as the lens closes (never under a ceiling)

// THE ADAPTIVE TERMS READ A ONE-WAY-EASED DISTANCE, NOT `this.dist`.
// Both of them (focus drop, pitch lift) are DRIVEN BY the collided distance and
// they FEED BACK INTO it — the drop moves the focus (the fan's origin) and the
// lift tips the fan up — so driving them from the raw distance closes a loop
// through the collision solver. The audit caught that loop oscillating with the
// hero STANDING STILL and nothing in the world moving: verdant-1 brook, the lens
// eased 1.01 → 5.83 m over 0.37 s and then slammed back to 1.009 m in one frame,
// the pump the module docstring promises never happens. Breaking it does not
// need a new mechanism, only a different clock: the terms follow the lens IN at
// once (framing safety — the hero must not slide off a closing frame) and let go
// SLOWLY, far slower than the solver's own 0.37 s cycle, so the loop has no gain
// left at the frequency it used to ring at.
const ADAPT_IN_LAMBDA      = 10.0;   // lens closing → the terms follow immediately
const ADAPT_OUT_LAMBDA     = 1.6;    // lens opening → ~1.9 s to release (no ring)

// CLOSE-RANGE HERO ANCHOR. The position lag and the shoulder offset are what
// make the hero LEAD the frame at range (docstring rule 1) — and they are
// exactly what push him OUT of it once geometry forces the lens in. At full run
// the focus trails the hero by v/lagPos ≈ 1 m, so a lens pinned at 0.12 m sits
// ~0.9 m in FRONT of the hero, who is then behind the near plane: measured in
// the Keep lobby with the hero running 7.7–9.0 m/s AT a wall-pinned lens, hero
// NDC (2.49, 1.54) rising to (3.33, 14.34) — off-screen, for 70 frames — while
// heroFade read 1.000 for 79. A 0.35 m shoulder is the same story: harmless at
// 6.8 m, a 71° lateral offset at 0.12 m. So as the lens closes, the focus eases
// onto the hero's own centre (shoulder included): whatever distance the geometry
// leaves, the hero is CENTRED in it rather than behind the lens.
const SHAFT_ANCHOR_RAD     = 0.60;   // rad of shaft tilt at which the focus is fully on the hero
const ANCHOR_D0            = 0.8;    // m — focus fully on the hero at/below this
const ANCHOR_D1            = 2.4;    // m — normal lag + shoulder at/above (= frameMin)

// AIM AT THE HERO, NOT AT THE FOCUS POINT. The focus is a COLLISION origin as
// much as a framing one - it rides at TUNE.cam.height 1.55 m, ABOVE the head
// of a 1.5 m hero, and every rule that would lower it (FOCUS_DROP, the anchor)
// also moves the whisker fan's origin, which is why _limitFrame has to switch
// the drop off (a focus lowered into a merlon blocks its own recovery signal).
// So the FRAMING correction belongs where it has no collision consequence at
// all: the LOOK POINT. _compose aims the lens between the focus and the hero's
// own chest as the lens closes; the lens POSITION, the fan origin and the
// posed pitch are untouched, so this cannot feed back into the solver.
// What it fixes, measured: the keep undercroft sat 162 of 276 frames pinned at
// the framing floor (the chest probe's floor, exactly 2.400 m) with the chest
// at |ndcY| median 0.449 - the back of Nim's head filling the frame - because
// at exactly frameMin the anchor is 0 and the lens still aimed 0.73 m OVER his
// chest. Worse at a collapse: at 0.609 m that same 0.73 m offset is 50 deg of
// look angle, which is how a hero at heroNdc (-0.713, -1.174) leaves the frame
// entirely while the camera is pointed 'at' him.
const LOOK_AIM_D0          = 1.0;    // m - aim fully at the hero's chest at/below this
const LOOK_AIM_D1          = 4.5;    // m - aim at the focus at/above this
const LOOK_AIM_H           = 0.82;   // m above the hero's feet = chest (TUNE.height x 0.55)

// fov
const FOV_LAMBDA           = 12;
const FOV_PEEK_LAMBDA      = 16;
const FOV_MOVE_BOOST       = 6;      // long jump / dive
const FOV_UNDERWATER       = 4;
const UNDERWATER_LAMBDA    = 8;

// recenter
const RECENTER_HOLD_S      = 0.15;   // yawForMovement keeps the old yaw this long

// death
const DEATH_ORBIT_RATE     = 0.3;    // rad/s
const DEATH_PULL_M         = 1.5;
const DEATH_PITCH_LIFT     = 0.12;   // rad, eased in
const RESPAWN_SNAP_DIST    = 3.0;    // m the hero moved during death → treat as respawn

// cinematic
const CINE_BLEND_S         = 0.6;

// peek
const PEEK_PITCH_MAX       = 1.25;   // rad
const PEEK_EYE_DROP        = 0.10;   // m below headPos

// punch (pound landing) — analytic critically-damped springs
const PUNCH_OMEGA          = 28;
const PUNCH_DIST_M         = 0.45;
const PUNCH_FOV_DEG        = 4.0;
const PUNCH_PITCH_RAD      = 2.5 * DEG;
const PUNCH_COALESCE_S     = 0.06;

// shake
const SHAKE_POS_M          = 0.06;
const SHAKE_ROLL_RAD       = 1.6 * DEG;
const SHAKE_PITCH_RAD      = 0.9 * DEG;
const SHAKE_FREQ_A         = 23;
const SHAKE_FREQ_B         = 47;

// numerics
const FOV_EPS              = 0.008;  // deg — below this the projection is not rebuilt
const DT_MAX               = 1 / 20;

/** States during which auto-yaw is frozen (never fight a committed move). */
const FREEZE_STATES = {
  longjump: 1, dive: 1, slide: 1, slideRecover: 1, wallkick: 1, wallslide: 1,
  poundHang: 1, poundFall: 1, poundLand: 1, sideflip: 1, backflip: 1, cannon: 1,
};
/** States that widen the lens. */
const FOV_BOOST_STATES = { longjump: 1, dive: 1 };

/* ───────────────────────────── scratch ───────────────────────────── */

const _fwd       = new THREE.Vector3();
const _right     = new THREE.Vector3();
const _focusT    = new THREE.Vector3();   // this frame's focus target
const _heroC     = new THREE.Vector3();   // hero centre (no shoulder)
const _desired   = new THREE.Vector3();
const _dir       = new THREE.Vector3();
const _origin    = new THREE.Vector3();
const _look      = new THREE.Vector3();
const _tmp       = new THREE.Vector3();
const _tmp2      = new THREE.Vector3();
const _fwdOut    = new THREE.Vector3();   // returned by `forwardFlat`
const _cFwd      = new THREE.Vector3();   // candidate heading (clearance solver)
const _cRight    = new THREE.Vector3();
const _cDir      = new THREE.Vector3();
const _cOrigin   = new THREE.Vector3();
const _pOrigin   = new THREE.Vector3();   // marching probe origin (embedded-start escape)
const _qA        = new THREE.Quaternion();
const _hit       = { t: 0, normal: new THREE.Vector3(), collider: null, heightfield: null };
const _DOWN      = new THREE.Vector3(0, -1, 0);   // never mutated (drop probe)
const _spring    = { x: 0, v: 0 };

/**
 * Exact free response of a critically damped 2nd-order system.
 *   x(t) = (x0 + (v0 + ω·x0)·t)·e^(-ω·t)
 * Analytic rather than integrated so a long frame can never blow it up.
 */
function critDamp(x, v, omega, dt, out) {
  const e = Math.exp(-omega * dt);
  const a = v + omega * x;
  out.x = (x + a * dt) * e;
  out.v = (v - a * omega * dt) * e;
  return out;
}

/** Integer lattice hash → [-1, 1]. Deterministic, allocation-free. */
function hash1(i, seed) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** 1-D smooth value noise (Perlin-style lattice + Hermite blend). */
function noise1(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i, seed), hash1(i + 1, seed), u);
}

/** Two-octave shake signal in [-1, 1]. */
function shakeNoise(t, seed) {
  return noise1(t * SHAKE_FREQ_A, seed) * 0.65 + noise1(t * SHAKE_FREQ_B, seed + 7) * 0.35;
}

/** Uniform Catmull-Rom on one axis. */
function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Read an [x,y,z] array or {x,y,z} object into a Float64Array slot. */
function readVec3(src, arr, k) {
  if (!src) { arr[k] = 0; arr[k + 1] = 0; arr[k + 2] = 0; return false; }
  if (Array.isArray(src) || ArrayBuffer.isView(src)) {
    arr[k] = +src[0] || 0; arr[k + 1] = +src[1] || 0; arr[k + 2] = +src[2] || 0;
    return true;
  }
  if (typeof src === 'object') {
    arr[k] = +src.x || 0; arr[k + 1] = +src.y || 0; arr[k + 2] = +src.z || 0;
    return true;
  }
  return false;
}

/**
 * Distance along (dx,dy,dz) from a point INSIDE oriented box `c` to its far
 * face — the slab test's `tmax`. Mirrors collider.js `rayBox`'s local transform
 * exactly (dot with the world-space local axes) so the two can never disagree.
 * Returns 0 for a degenerate direction; `Infinity` is impossible for a point
 * inside a finite box with a unit direction. Allocation-free.
 */
function boxExitT(c, ox, oy, oz, dx, dy, dz) {
  const px = ox - c.center.x, py = oy - c.center.y, pz = oz - c.center.z;
  let lx, ly, lz, ex, ey, ez;
  if (c.axisAligned) {
    lx = px; ly = py; lz = pz; ex = dx; ey = dy; ez = dz;
  } else {
    lx = px * c.ax.x + py * c.ax.y + pz * c.ax.z;
    ly = px * c.ay.x + py * c.ay.y + pz * c.ay.z;
    lz = px * c.az.x + py * c.az.y + pz * c.az.z;
    ex = dx * c.ax.x + dy * c.ax.y + dz * c.ax.z;
    ey = dx * c.ay.x + dy * c.ay.y + dz * c.ay.z;
    ez = dx * c.az.x + dy * c.az.y + dz * c.az.z;
  }
  let tmax = Infinity;
  if (ex > 1e-9 || ex < -1e-9) { const t = ((ex > 0 ? c.half.x : -c.half.x) - lx) / ex; if (t < tmax) tmax = t; }
  if (ey > 1e-9 || ey < -1e-9) { const t = ((ey > 0 ? c.half.y : -c.half.y) - ly) / ey; if (t < tmax) tmax = t; }
  if (ez > 1e-9 || ez < -1e-9) { const t = ((ez > 0 ? c.half.z : -c.half.z) - lz) / ez; if (t < tmax) tmax = t; }
  return tmax === Infinity || !(tmax > 0) ? 0 : tmax;
}

/** camera-right for a yaw about +Y: fwd × up. */
function rightFromFwd(fwd, out) {
  out.set(-fwd.z, 0, fwd.x);
  return out;
}

/* ───────────────────────────── CAMERA OCCLUDERS ─────────────────────────────
 * What the fan casts against is the course broadphase: every SOLID collider plus
 * the heightfields — exactly the set the PLAYER collides with. That set is not
 * what is DRAWN. Measured 2026-09-05 (_harness/_cam_probe.py, then the camcheck
 * station rows, before this block existed) at the S3 stations:
 *   azure-1 cp4          the lens INSIDE the sluice mover's batched body (odd
 *                        crossing parity on `cb.metal.azure#batched`): the mover's
 *                        collider is its 0.5 m deck, its drawn body is deck + skirt.
 *   verdant-3 crest-race a visual ray head→lens hit `cb.stone.verdant#batched#8`
 *                        (the mill tower drum) in 29/30 samples while the
 *                        broadphase ray was clear: mill.js authors the drum
 *                        collider at 0.80 R, so 0.2 R of curved stone stands
 *                        between the hero and a lens the fan believes is in air.
 *   ember-4 cp3          the lens in a slot between the tier slab (0.38 m) and
 *                        the sandboard rail's un-collided banks.
 * Rotor pedestals, mover skirts, mill drums, crusher housings — hazard bodies
 * whose drawn envelope is bigger than their collider — and large instanced props
 * with no collider at all are opaque to the player's eye and invisible to the
 * fan. This set closes that gap at the GENERATOR: it is rebuilt from the
 * course's own scene graph on every course change, so any hazard part that is
 * drawn opaque is a camera occluder without the hazard knowing about it.
 *
 * Records are real `Collider`s (group 'camera', solid:false) that are NEVER
 * registered in the broadphase: the player cannot block on them, and the fan's
 * embedded-origin logic (`containsPoint`, `boxExitT`) works on them unchanged.
 *   - batched hazard parts (hazards/batch.js BatchedMesh instances) of hazards
 *     that own at least one solid collider: an ORIENTED box from the geometry's
 *     local bounds and the instance matrix, re-posed on any frame the matrix
 *     changes (movers, rotors, mills), visibility mirrored (vanish, breakables).
 *     Non-solid hazards (rings, beams, lava) are skipped: a ring's box is mostly
 *     the air the hero flies through.
 *   - loose (un-batched) opaque hazard meshes up to OCC_LOOSE_MAX_M along their
 *     longest side: a bigger one is a world-authored rail or track whose axis
 *     box is mostly air (ember-4's sandboard measured 33 × 18 × 12 m).
 *   - instanced props (world/props.js) whose instance box is a THICK object.
 * A course that publishes `cameraOccluders` (Colliders, or {min,max} boxes) is
 * honoured first; the scene walk is the fallback that needs nothing from it.
 *
 * Per frame: `refresh()` re-poses moving records (a 16-double matrix compare,
 * no allocation), `cull()` keeps the records within the fan's reach of the
 * focus, `_ray()` tests those after the broadphase. Nothing here allocates after
 * `rebuild()`, which runs once per course change.
 */
const OCC_MIN_EXTENT_M     = 0.45;   // batched part: a longest side under this is a bolt/rung, never a wall
const OCC_LOOSE_MAX_M      = 6.0;    // loose mesh: a longest side over this is a rail/track (box mostly air)
const OCC_PROP_MAX_MIN_M   = 1.5;    // instanced prop: its longest side must reach this…
const OCC_PROP_MIN_MIN_M   = 0.45;   // …and its shortest side this (a fence panel is not a wall)
const OCC_NEAR_PAD_M       = 2.0;    // cull-radius slack over the fan's reach
// A hollow shape's box is mostly air. MEASURED 2026-09-05, verdant-3 cp-yard,
// yaw 1.83: the mill's four sails are ONE batched wood part whose box is
// 8.6 × 15.5 × 15 m — the whole sail disc — and it stood 1.71 m from the focus,
// so the camera tilted to 0.92 rad and pulled to 1.74 m against a wall of air
// (camsweep min 3.23 m before). The sails already have one collider per arm.
// A part CLAIMED by a hazard (Hazard API) is kept only while its box volume is
// under OCC_VOLUME_RATIO × the hazard's largest collider box (the drum part is
// 1.6 × its 0.80 R collider and stays; the sail disc is 4.0 × and goes); an
// UNCLAIMED part (a BatchRig body: mover decks, crusher heads, rotor hubs) is
// kept up to OCC_UNCLAIMED_MAX_M on its longest side.
const OCC_VOLUME_RATIO     = 3.0;
const OCC_UNCLAIMED_MAX_M  = 8.0;
const OCC_MIN_HALF_M       = 0.01;

// ── THE LENS SPHERE, not only the ray ────────────────────────────────────────
// The fan is rays: a box BESIDE the ray that never crosses it is invisible to it,
// and the lens sphere (collideRadius) can end up overlapping a slab corner in open
// air. Measured 2026-09-05, verdant-3 crest-sigils with the camera in front of the
// hero: the fan settled at 6.52 m (a hit at 6.87) with the lens 0.06 m outside a
// pedestal tier's +x face and 0.08 m under its bottom — 0.10 m from a 2.8 m slab,
// every frame, for a whole heading. `_sphereClear` asks the broadphase (and the
// occluder set) for the nearest oriented-box distance at the posed lens, and
// when it is under the radius `_deepestSphereClear` walks the pull-in inward to
// the deepest distance that is clear — floored at `frameMin` (the framing floor
// exists precisely so a chest-height obstacle cannot drag the focus down into a
// self-locking collapse), and falling back to the fan's own answer when nothing
// along the heading is clear, so it can never be worse than the fan.
const SPHERE_EPS_M         = 0.02;   // m — the sphere test asks for collideRadius minus this
const SPHERE_FREE_N        = 8;      // coarse samples from the fan's answer inward…
const SPHERE_BISECT_N      = 4;      // …then bisect the first clear/blocked pair (3 cm at 6 m)
const _sphBox    = new THREE.Box3();
const _sphCands  = [];

const _occM4   = new THREE.Matrix4();
const _occP    = new THREE.Vector3();
const _occQ    = new THREE.Quaternion();
const _occS    = new THREE.Vector3();
const _occBox  = new THREE.Box3();
const _occC    = new THREE.Vector3();
const _occN    = new THREE.Vector3();

/** Drawn with depth, no blending, no alpha: the eye cannot see through it. */
function matOpaque(m) {
  if (!m) return false;
  if (Array.isArray(m)) {
    if (!m.length) return false;
    for (let i = 0; i < m.length; i++) if (!matOpaque(m[i])) return false;
    return true;
  }
  return m.visible !== false && !m.transparent && m.depthWrite !== false && !m.wireframe &&
         (m.blending === undefined || m.blending === THREE.NormalBlending) &&
         (typeof m.opacity !== 'number' || m.opacity >= 0.99);
}

class CamOccluders {
  constructor() {
    this.course = null;
    /** @type {Collider[]} every record, static and dynamic */
    this.items = [];
    /** dynamic records {c, mesh, iid, lbox, cache}: batched instances re-posed per frame */
    this.dyn = [];
    /** indices into `items` within the fan's reach this frame (sized at rebuild) */
    this.near = null;
    this.nearCount = 0;
    /** true when the course published its own list */
    this.published = false;
    /** rebuild scratch: BatchedMesh → Map(instance id → owning hazard is solid) */
    this._claims = new Map();
  }

  /** Track the live course: rebuild on identity change only. */
  sync(course) {
    if (course === this.course) return;
    this.rebuild(course);
  }

  rebuild(course) {
    this.course = course || null;
    this.items.length = 0;
    this.dyn.length = 0;
    this.nearCount = 0;
    this.published = false;
    if (!course) { this.near = null; return; }
    const pub = course.cameraOccluders;
    if (Array.isArray(pub) && pub.length) {
      for (let i = 0; i < pub.length; i++) this._addPublished(pub[i]);
      this.published = true;
    } else {
      /* Two batching paths exist in hazards/: the Hazard API (`solidPart`, recorded
         in `h._batchParts` — mill, surfaces, launch, beams, lava, fluids, lasers,
         breakable) and hazards/batchkit.js BatchRig (movers, crushers, rotors,
         pendulum, vanish), whose rig is a closure local the hazard object never
         exposes. MEASURED 2026-09-05: azure-1's three sluice movers reported
         `_batchParts` 0 parts each, so a walk of the hazards alone left every mover
         deck OUT of this set and the fan blind to the body that hid the hero.
         So: the hazards CLAIM what they can (and a non-solid family — rings, beams,
         lava — takes its parts out), then every instance of every opaque batch in
         the course that nobody excluded is an occluder. An unclaimed instance is a
         BatchRig part, and every BatchRig family is a solid body. */
      const claimed = this._claims;
      claimed.clear();
      const hz = course.hazards;
      if (Array.isArray(hz)) for (let i = 0; i < hz.length; i++) this._addHazard(hz[i], claimed);
      if (course.group && typeof course.group.traverse === 'function') {
        course.group.traverse((o) => {
          if (!o.isBatchedMesh || !matOpaque(o.material)) return;
          const m = claimed.get(o);
          const info = o._instanceInfo || [];
          for (let iid = 0; iid < info.length; iid++) {
            if (!info[iid] || !info[iid].active) continue;
            const s = m ? m.get(iid) : undefined;
            if (s && !s.solid) continue;               // a non-solid family's part
            this._addBatched(o, iid, s ? s.vol : -1);
          }
        });
        this._addProps(course.group);
      }
      claimed.clear();
    }
    this.near = new Int32Array(this.items.length);
  }

  _addPublished(o) {
    if (!o) return;
    if (typeof o.containsPoint === 'function' && o.half && o.center) { this.items.push(o); return; }
    const mn = o.min, mx = o.max;
    if (!mn || !mx) return;
    const c = new Collider({
      center: [(mn.x + mx.x) * 0.5, (mn.y + mx.y) * 0.5, (mn.z + mx.z) * 0.5],
      half: [Math.max(OCC_MIN_HALF_M, (mx.x - mn.x) * 0.5), Math.max(OCC_MIN_HALF_M, (mx.y - mn.y) * 0.5),
             Math.max(OCC_MIN_HALF_M, (mx.z - mn.z) * 0.5)],
      group: 'camera', solid: false, surface: 'normal',
    });
    c.userData = 'cam-occluder';
    this.items.push(c);
  }

  /**
   * One course hazard record ({h, colliders, …} from world/course.js, or a bare
   * Hazard): CLAIM its Hazard-API batch parts in `claimed` (mesh → Map(iid →
   * solid)), so a non-solid family's parts are excluded from the batch walk in
   * `rebuild()`, and add its loose opaque meshes when it is a solid body.
   */
  _addHazard(rec, claimed) {
    const h = rec && (rec.h || rec);
    if (!h) return;
    const solids = (rec.colliders && rec.colliders.length) ? rec.colliders : h.colliders;
    let anySolid = false, volMax = 0;
    if (solids) {
      for (let i = 0; i < solids.length; i++) {
        const c = solids[i];
        if (!c || c.solid === false || !c.half) continue;
        anySolid = true;
        const v = 8 * c.half.x * c.half.y * c.half.z;
        if (v > volMax) volMax = v;
      }
    }
    const parts = h._batchParts;
    if (parts && claimed) {
      const claim = { solid: anySolid, vol: volMax };   // rebuild-time only
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const b = parts[i], iid = parts[i + 1];
        const mesh = b && b.mesh;
        if (!mesh || !(iid >= 0)) continue;
        let m = claimed.get(mesh);
        if (!m) { m = new Map(); claimed.set(mesh, m); }
        m.set(iid, claim);
      }
    }
    if (!anySolid) return;
    if (h.mesh && typeof h.mesh.traverse === 'function') {
      h.mesh.traverse((o) => {
        if (o.isMesh && !o.isInstancedMesh && !o.isBatchedMesh && o.visible && o.geometry && matOpaque(o.material)) this._addLoose(o);
      });
    }
  }

  /** `volMax`: the owning hazard's largest collider box volume (m³), or -1 when unclaimed. */
  _addBatched(mesh, iid, volMax) {
    const info = mesh._instanceInfo && mesh._instanceInfo[iid];
    if (!info || !info.active) return;
    let gid;
    try { gid = mesh.getGeometryIdAt(iid); mesh.getBoundingBoxAt(gid, _occBox); }
    catch (e) { return; }
    if (_occBox.isEmpty()) return;
    const sx = _occBox.max.x - _occBox.min.x, sy = _occBox.max.y - _occBox.min.y, sz = _occBox.max.z - _occBox.min.z;
    const mx = Math.max(sx, sy, sz);
    if (mx < OCC_MIN_EXTENT_M) return;
    // the local box ignores instance scale; hazard parts are authored at scale 1
    if (volMax >= 0 ? sx * sy * sz > OCC_VOLUME_RATIO * Math.max(volMax, 1) : mx > OCC_UNCLAIMED_MAX_M) return;
    const c = new Collider({ center: [0, 0, 0], half: [0.5, 0.5, 0.5], group: 'camera', solid: false, surface: 'normal' });
    c.userData = 'cam-occluder';
    c.ref = mesh; c.props = { iid };               // provenance for the harnesses
    const rec = { c, mesh, iid, lbox: _occBox.clone(), cache: new Float64Array(16) };
    rec.cache[0] = NaN;                          // never equal: the first refresh poses it
    this._poseBatched(rec);
    this.items.push(c);
    this.dyn.push(rec);
  }

  /** Re-pose one batched record from its instance matrix; no-op while the matrix holds. */
  _poseBatched(rec) {
    const mesh = rec.mesh, iid = rec.iid, c = rec.c;
    const info = mesh._instanceInfo && mesh._instanceInfo[iid];
    if (!info || !info.active || !mesh.visible) { c.active = false; return; }
    c.active = !!info.visible;
    if (!c.active) return;
    mesh.getMatrixAt(iid, _occM4);
    const e = _occM4.elements, cache = rec.cache;
    let same = true;
    for (let k = 0; k < 16; k++) if (cache[k] !== e[k]) { same = false; break; }
    if (same) return;
    for (let k = 0; k < 16; k++) cache[k] = e[k];
    _occM4.premultiply(mesh.matrixWorld);
    _occM4.decompose(_occP, _occQ, _occS);
    const lb = rec.lbox;
    _occC.set((lb.min.x + lb.max.x) * 0.5, (lb.min.y + lb.max.y) * 0.5, (lb.min.z + lb.max.z) * 0.5).applyMatrix4(_occM4);
    c.center.copy(_occC);
    c.half.set(
      Math.max(OCC_MIN_HALF_M, (lb.max.x - lb.min.x) * 0.5 * Math.abs(_occS.x)),
      Math.max(OCC_MIN_HALF_M, (lb.max.y - lb.min.y) * 0.5 * Math.abs(_occS.y)),
      Math.max(OCC_MIN_HALF_M, (lb.max.z - lb.min.z) * 0.5 * Math.abs(_occS.z)));
    c.quat.copy(_occQ);
    c.update();
  }

  /** A loose, un-batched opaque mesh (hazard hubs, doors, pedestals). Static. */
  _addLoose(o) {
    const g = o.geometry;
    if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (e) { return; } }
    const lb = g.boundingBox;
    if (!lb || lb.isEmpty()) return;
    o.updateWorldMatrix(true, false);
    _occM4.copy(o.matrixWorld).decompose(_occP, _occQ, _occS);
    const sx = (lb.max.x - lb.min.x) * Math.abs(_occS.x);
    const sy = (lb.max.y - lb.min.y) * Math.abs(_occS.y);
    const sz = (lb.max.z - lb.min.z) * Math.abs(_occS.z);
    const mx = Math.max(sx, sy, sz);
    if (mx < OCC_MIN_EXTENT_M || mx > OCC_LOOSE_MAX_M) return;
    this._pushStatic(lb, _occM4, sx, sy, sz);
  }

  /** Instanced props under the course group: only THICK objects. Static. */
  _addProps(group) {
    group.traverse((o) => {
      if (!o.isInstancedMesh || !o.visible || !o.geometry || !matOpaque(o.material)) return;
      const g = o.geometry;
      if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (e) { return; } }
      const lb = g.boundingBox;
      if (!lb || lb.isEmpty()) return;
      o.updateWorldMatrix(true, false);
      const n = o.count | 0;
      for (let i = 0; i < n; i++) {
        o.getMatrixAt(i, _occM4);
        _occM4.premultiply(o.matrixWorld);
        _occM4.decompose(_occP, _occQ, _occS);
        const sx = (lb.max.x - lb.min.x) * Math.abs(_occS.x);
        const sy = (lb.max.y - lb.min.y) * Math.abs(_occS.y);
        const sz = (lb.max.z - lb.min.z) * Math.abs(_occS.z);
        if (Math.max(sx, sy, sz) < OCC_PROP_MAX_MIN_M || Math.min(sx, sy, sz) < OCC_PROP_MIN_MIN_M) continue;
        this._pushStatic(lb, _occM4, sx, sy, sz);
      }
    });
  }

  /** `_occM4` is already decomposed into `_occQ`; `m` is the full world matrix of the box. */
  _pushStatic(lb, m, sx, sy, sz) {
    _occC.set((lb.min.x + lb.max.x) * 0.5, (lb.min.y + lb.max.y) * 0.5, (lb.min.z + lb.max.z) * 0.5).applyMatrix4(m);
    const c = new Collider({
      center: _occC,
      half: [Math.max(OCC_MIN_HALF_M, sx * 0.5), Math.max(OCC_MIN_HALF_M, sy * 0.5), Math.max(OCC_MIN_HALF_M, sz * 0.5)],
      quat: _occQ, group: 'camera', solid: false, surface: 'normal',
    });
    c.userData = 'cam-occluder';
    this.items.push(c);
  }

  /** Per frame: follow the moving parts. Allocation-free. */
  refresh() {
    const dyn = this.dyn;
    for (let i = 0; i < dyn.length; i++) this._poseBatched(dyn[i]);
  }

  /** Per frame: the records whose AABB lies within `radius` of (fx, fy, fz). Allocation-free. */
  cull(fx, fy, fz, radius) {
    const items = this.items, near = this.near;
    let n = 0;
    if (!near) { this.nearCount = 0; return; }
    const r2 = radius * radius;
    for (let i = 0; i < items.length; i++) {
      const c = items[i];
      if (!c.active) continue;
      const a = c.aabb;
      const dx = a.min.x > fx ? a.min.x - fx : (fx > a.max.x ? fx - a.max.x : 0);
      const dy = a.min.y > fy ? a.min.y - fy : (fy > a.max.y ? fy - a.max.y : 0);
      const dz = a.min.z > fz ? a.min.z - fz : (fz > a.max.z ? fz - a.max.z : 0);
      if (dx * dx + dy * dy + dz * dz <= r2) near[n++] = i;
    }
    this.nearCount = n;
  }
}

/* ───────────────────────────── FollowCamera ───────────────────────────── */

export class FollowCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera  the engine's main camera (root-level)
   * @param {object} player   runtime/player/controller.js Player
   * @param {object} input    runtime/core/input.js Input
   * @param {object} world    {broadphase, killVolumes, volumes} (or a Course — it has .broadphase)
   * @param {object} [settings] runtime/core/settings.js Settings (falls back to the singleton)
   */
  constructor(camera, player, input, world, settings) {
    this.camera   = camera || null;
    this.player   = player || null;
    this.input    = input || null;
    this.world    = world || null;
    this.settings = settings || SettingsSingleton;

    // ── public state ──────────────────────────────────────────────────────
    /** orbit yaw (rad), wraps in (-π, π] */
    this.yaw   = 0;
    /** camera elevation above the focus (rad), clamped pitchMin..pitchMax */
    this.pitch = TUNE.cam.defaultPitch;
    /** current (collided) camera distance from the focus (m) */
    this.dist  = TUNE.cam.dist;
    /** 'follow' | 'free' | 'peek' | 'cinematic' | 'death' */
    this.mode  = 'follow';
    /** applied vertical FOV (deg) */
    this.fov   = TUNE.cam.fov;

    // ── lagged focus ──────────────────────────────────────────────────────
    this._focus     = new THREE.Vector3();
    this._focusInit = false;
    this._pos       = new THREE.Vector3();     // final camera world position
    this._lookPt    = new THREE.Vector3();     // final look target
    this._shoulder  = TUNE.cam.shoulder;       // live (collision-reduced) shoulder

    // ── orbit / auto-yaw ──────────────────────────────────────────────────
    this._time         = 0;
    this._lastManualT  = -1e9;
    this._autoRate     = 0;                    // 0..1 ramp of the auto-yaw rate
    this._pitchIdleT   = 0;                    // s since last manual pitch
    this._camMode      = 'follow';             // Settings.camMode
    this._invertX      = false;
    this._invertY      = false;
    this._sensX        = 1;
    this._sensY        = 1;

    // ── distance / framing solver ─────────────────────────────────────────
    this._distBase   = TUNE.cam.dist;          // eased base (death pull-out)
    this._distColl   = TUNE.cam.dist;          // collision-limited distance
    this._stallT     = 0;                      // s the eased pull-in has waited behind a moved body
    this._yawSlide   = 0;                      // eased collision-avoidance yaw offset (rad)
    this._slideWant  = 0;                      // its target this frame
    this._pitchSlide = 0;                      // eased SHAFT-tier pitch offset (rad, see PITCH_STEPS)
    this._pitchWant  = 0;                      // its target this frame
    this._limitCeil  = false;                  // the limiting whisker hit an underside
    this._limitFrame = false;                  // the limiter was the CHEST (framing) probe
    this._limitLens  = TUNE.cam.dist;          // LENS-only limit (framing probe excluded)
    this._probeCeil  = false;                  // per-probe: that whisker hit an underside
    this._distAdapt  = TUNE.cam.dist;          // one-way-eased distance the adaptive terms read
    this._pitchAdapt = 0;                      // context-derived pitch offset (rad)
    this._focusDrop  = 0;                      // context-derived focus-height drop (m)
    this._airPeakY   = 0;                      // peak height of the current airborne arc
    this._fallDepth  = 0;                      // m below that peak (0 while grounded)
    this._dropBelow  = 0;                      // m of air under a descending hero (drop probe)
    this._fallLookK  = 0;                      // 0..1 fall framing driver (depth OR air below)
    this._lookAimK   = 0;                      // 0..1 blend of the look point onto the chest

    // ── recenter ──────────────────────────────────────────────────────────
    this._rcActive  = false;
    this._rcT       = 0;
    this._rcFrom    = 0;
    this._rcHoldT   = 0;
    this._rcHoldYaw = 0;

    // ── fov ───────────────────────────────────────────────────────────────
    this._fovBase    = TUNE.cam.fov;
    this._fovApplied = -1;
    this._underwater = 0;
    this._underwaterApplied = -1;

    // ── punch springs ─────────────────────────────────────────────────────
    this._pDistX = 0;  this._pDistV = 0;
    this._pFovX = 0;   this._pFovV = 0;
    this._pPitchX = 0; this._pPitchV = 0;
    this._lastPunchT = -1;

    // ── shake ─────────────────────────────────────────────────────────────
    this._shakeAmp = 0; this._shakeT = 0; this._shakeDur = 0; this._shakeSeed = 1;
    this._shakeX = 0; this._shakeY = 0; this._shakeRoll = 0; this._shakePitch = 0;

    // ── peek ──────────────────────────────────────────────────────────────
    this._peekOn    = false;
    this._peekPitch = 0;

    // ── death ─────────────────────────────────────────────────────────────
    this._deathOn    = false;
    this._deathT     = 0;
    this._deathFocus = new THREE.Vector3();
    this._deathHero  = new THREE.Vector3();

    // ── cinematic ─────────────────────────────────────────────────────────
    this._cine       = null;                   // normalised path (see setCinematic)
    this._cineT      = 0;
    this._cineDone   = false;
    this._cineBlendT = -1;                     // ≥ 0 while blending back to follow
    this._cinePos    = new THREE.Vector3();
    this._cineQuat   = new THREE.Quaternion();
    this._cineFov    = TUNE.cam.fov;
    this._yawMoveCine = 0;

    // ── outputs to siblings ───────────────────────────────────────────────
    this._heroFade = 0;
    this._post     = null;

    // ── settings ──────────────────────────────────────────────────────────
    this._onSettings = () => this._readSettings();
    this._readSettings();
    if (this.settings && typeof this.settings.on === 'function') this.settings.on(this._onSettings);

    // ── test surface ──────────────────────────────────────────────────────
    const self = this;
    /** camera occluders (see CamOccluders): the drawn envelopes the fan must also respect */
    this._occ = new CamOccluders();

    this.__test = {
      state() {
        return {
          occluders: self._occ.items.length, occNear: self._occ.nearCount, occPublished: self._occ.published,
          // `yaw`/`pitch` are the POSED lens angles (orbit value + the solver's
          // collision-avoidance slide / context-derived pitch), because that is
          // what an audit of framing has to measure. The raw orbit values the
          // player drives are reported alongside as yawOrbit/pitchOrbit.
          yaw: wrapAngle(self.yaw + self._yawSlide), pitch: self._pitchAim(),
          yawOrbit: self.yaw, pitchOrbit: self.pitch,
          yawSlide: self._yawSlide, pitchAdapt: self._pitchAdapt, focusDrop: self._focusDrop,
          pitchSlide: self._pitchSlide, pitchWant: self._pitchWant,
          limitCeil: self._limitCeil, limitFrame: self._limitFrame,
          fallDepth: self._fallDepth, dropBelow: self._dropBelow,
          fallLookK: self._fallLookK, lookAimK: self._lookAimK,
          dist: self.dist, mode: self.mode, fov: self.fov,
          yawForMovement: self.yawForMovement,
          focus: [self._focus.x, self._focus.y, self._focus.z],
          pos: [self._pos.x, self._pos.y, self._pos.z],
          look: [self._lookPt.x, self._lookPt.y, self._lookPt.z],
          distBase: self._distBase, distColl: self._distColl, shoulder: self._shoulder,
          autoRate: self._autoRate, autoFrozen: self._autoFrozen(),
          sinceManual: self._time - self._lastManualT,
          recentering: self._rcActive, recenterT: self._rcT, holdT: self._rcHoldT,
          heroFade: self._heroFade, underwater: self._underwater,
          peek: self._peekOn, death: self._deathOn,
          cinematic: !!self._cine, cinematicT: self._cineT, cinematicDone: self._cineDone,
          time: self._time,
        };
      },
      // A test placement is a SNAP, not a nudge: it re-solves the collision /
      // framing pose at dt = 0 so the very next frame is already settled,
      // instead of leaving the harness to wait out an ease it did not ask for.
      setYaw(y) {
        self.yaw = wrapAngle(+y || 0);
        self._autoRate = 0; self._rcActive = false;
        self._yawSlide = 0; self._slideWant = 0;
        self._resolveNow();
      },
      setPitch(p) {
        self.pitch = clamp(+p || 0, TUNE.cam.pitchMin, TUNE.cam.pitchMax);
        self._pitchAdapt = 0;
        self._resolveNow();
      },
    };

    this._snapToPlayer(true);
    this._compose(0);
  }

  /* ─────────────────────────── public API ─────────────────────────── */

  /** Swap the collision world (course load). Additive to the contract. */
  setWorld(world) { this.world = world || null; }

  /** Post chain for underwater tint. Resolved lazily from player.fx if not set. */
  setPost(post) { this._post = (post && typeof post.setUnderwater === 'function') ? post : null; }

  /** Ease the yaw to directly behind the hero over `TUNE.cam.recenterTime`. */
  recenter() {
    if (this._deathOn || this._cine) return;
    this._rcHoldYaw = this._rcActive ? this._rcHoldYaw : wrapAngle(this.yaw + this._yawSlide);
    this._rcHoldT   = RECENTER_HOLD_S;
    this._rcActive  = true;
    this._rcT       = 0;
    this._rcFrom    = this.yaw;
    this._autoRate  = 0;
  }

  /**
   * Additive decaying shake. `amount` 0..1-ish (0.3 = a stomp nearby, 1 = the
   * Warden's landing). Never cuts a bigger shake short.
   */
  shake(amount, ms) {
    const a = Math.max(0, +amount || 0);
    if (a <= 0) return;
    const remaining = this._shakeDur > 0 ? this._shakeAmp * (1 - this._shakeT / this._shakeDur) : 0;
    this._shakeAmp  = Math.max(a, remaining);
    this._shakeT    = 0;
    this._shakeDur  = Math.max(0.02, (+ms || 220) / 1000);
    this._shakeSeed = (this._shakeSeed + 17) % 4093;
  }

  /**
   * Impact punch (pound landing, hard landing): the distance dips in, the FOV
   * kicks wide and the pitch nods, all on critically-damped springs.
   * @param {number} amount 0..1 (1 = ground pound)
   */
  punch(amount) {
    const a = clamp(amount === undefined ? 1 : (+amount || 0), 0, 2);
    if (a <= 0) return;
    if (this._lastPunchT >= 0 && this._time - this._lastPunchT < PUNCH_COALESCE_S) return;
    this._lastPunchT = this._time;
    // impulse the velocity (a kick), not the position, so it reads as a hit.
    // A critically damped spring kicked from rest peaks at v0/(ω·e) after 1/ω s,
    // so scale by ω·e to make PUNCH_*_ constants the actual peak amplitudes.
    const k = PUNCH_OMEGA * Math.E * a;
    this._pDistV  -= PUNCH_DIST_M    * k;
    this._pFovV   += PUNCH_FOV_DEG   * k;
    this._pPitchV += PUNCH_PITCH_RAD * k;
    if (a >= 0.6) this.shake(0.35 * a, 180);
  }

  /**
   * Death cam. true → freeze the focus where the hero died, orbit slowly, pull
   * out 1.5 m. false → back to follow; if the hero has since moved (respawn) the
   * focus snaps to them and the yaw lands behind them — a respawn must be crisp.
   */
  setDeathCam(on) {
    const v = !!on;
    if (v === this._deathOn) return;
    this._deathOn = v;
    if (v) {
      this._deathT = 0;
      this._deathFocus.copy(this._focus);
      const src = this._heroSrc();
      if (src) this._deathHero.set(src.x, src.y, src.z);
      this._rcActive = false;
      this._peekOn = false;
      this.mode = 'death';
    } else {
      this._deathT = 0;
      const src = this._heroSrc();
      const moved = src ? _tmp.set(src.x, src.y, src.z).distanceTo(this._deathHero) : 0;
      this._clearTransients();
      if (!src || moved > RESPAWN_SNAP_DIST) this._snapToPlayer(true);
      else this._snapToPlayer(false);
      this.mode = this._camMode;
    }
  }

  /**
   * Cinematic path, or null to return to follow (blends back over 0.6 s).
   *
   * pathDef forms:
   *   {keys:[{p:[x,y,z], look:[x,y,z]|'player', t:seconds, fov?}, …], loop?, onDone?}
   *   [{p, look, t}, …]                                  (bare key array)
   *   {orbit:{center:[x,y,z], radius, height, duration, turns?, startYaw?, fov?}, onDone?}
   *     → a generated orbit (crest celebration: centre = pedestal, 2.2 s)
   * Key times are absolute seconds from the start of the path and must ascend.
   */
  setCinematic(pathDef) {
    if (!pathDef) {
      if (this._cine) {
        this._cine = null;
        this._cineBlendT = 0;                          // blend from the last cinematic pose
        this._cinePos.copy(this._pos);
        if (this.camera) this._cineQuat.copy(this.camera.quaternion);
        this.mode = this._deathOn ? 'death' : this._camMode;
      }
      return;
    }
    const cine = this._normalisePath(pathDef);
    if (!cine) return;
    this._cine = cine;
    this._cineT = 0;
    this._cineDone = false;
    this._cineBlendT = -1;
    this._yawMoveCine = this.yaw;
    this._rcActive = false;
    this._peekOn = false;
    this.mode = 'cinematic';
  }

  /** Unit XZ forward of the camera (the direction the lens faces, flattened). */
  get forwardFlat() {
    if (this.mode === 'cinematic' && this.camera) {
      // real lens direction while a path plays
      this.camera.getWorldDirection(_fwdOut);
      _fwdOut.y = 0;
      const l = _fwdOut.length();
      if (l > 1e-5) return _fwdOut.multiplyScalar(1 / l);
    }
    return headingFromYaw(this.yaw + this._yawSlide, _fwdOut);
  }

  /**
   * The yaw the controller resolves stick input against. Equals `yaw` except:
   * for 0.15 s after a recenter it keeps the pre-recenter yaw (a mid-air input
   * must not flip), and during a cinematic it keeps the yaw from before the
   * path started so movement stays predictable under a moving lens.
   */
  get yawForMovement() {
    if (this._rcHoldT > 0) return this._rcHoldYaw;
    if (this._cine) return this._yawMoveCine;
    // The collision slide rotates the LENS, so it must rotate the movement frame
    // with it or "forward" stops meaning "up the screen". It is frozen during a
    // committed move (see `_updateDistance`), so it can never steer one.
    return wrapAngle(this.yaw + this._yawSlide);
  }

  /** Camera world position (the value composed last frame). */
  get position() { return this._pos; }
  /** The lagged focus point. */
  get focus() { return this._focus; }
  /** 0..1 hero fade written to player.heroFade this frame. */
  get heroFade() { return this._heroFade; }
  get deathCam() { return this._deathOn; }
  get cinematicDone() { return this._cineDone; }

  /** Re-run the framing solver at dt = 0 and pose from it. */
  _resolveNow() {
    this._updateAdaptive(0);
    this._updateFocus(0);
    this._updateDistance(0);
    this._compose(0);
  }

  /**
   * Snap the focus to the hero and the yaw behind them (course load / respawn).
   * The collision solver runs once at dt = 0 so the snapped pose is already
   * resolved — a respawn must not start with the lens inside the nearest pillar
   * and then ease its way out.
   */
  snapToPlayer() {
    this._clearTransients();
    this._snapToPlayer(true);
    this._resolveNow();
  }

  /* ─────────────────────────── main update ─────────────────────────── */

  update(dt) {
    const d = clamp(+dt || 0, 0, DT_MAX);
    this._time += d;

    const input = this.input;
    const suspended = !!(input && input.suspended);

    // 1 ── mode toggle (B / camToggle) ---------------------------------------
    if (input && input.camTogglePressed && !suspended && !this._cine && !this._deathOn) {
      const next = this._camMode === 'free' ? 'follow' : 'free';
      if (this.settings && typeof this.settings.set === 'function') this.settings.set({ camMode: next });
      else this._camMode = next;
    }

    // 2 ── peek enter / exit --------------------------------------------------
    const wantPeek = !!(input && input.peek && !suspended && !this._cine && !this._deathOn);
    if (wantPeek !== this._peekOn) {
      this._peekOn = wantPeek;
      if (wantPeek) { this._peekPitch = 0; this._rcActive = false; }
      else { this._distColl = TUNE.cam.minDist; }   // ease back out from the head
    }

    // 3 ── resolve mode -------------------------------------------------------
    this.mode = this._cine ? 'cinematic' : (this._deathOn ? 'death' : (this._peekOn ? 'peek' : this._camMode));

    // 4 ── manual orbit ------------------------------------------------------
    this._consumeLook(d, suspended);

    // 5 ── recenter trigger --------------------------------------------------
    if (input && input.recenterPressed && !suspended && !this._peekOn) this.recenter();
    if (this._rcHoldT > 0) this._rcHoldT = Math.max(0, this._rcHoldT - d);

    // 6 ── yaw drivers: recenter > death orbit > auto-yaw --------------------
    if (this._rcActive) this._updateRecenter(d);
    else if (this._deathOn) this.yaw = wrapAngle(this.yaw + DEATH_ORBIT_RATE * d);
    else this._updateAutoYaw(d);

    // 7 ── pitch return ------------------------------------------------------
    this._updatePitchReturn(d);

    // 8 ── adaptive framing (focus height + derived pitch), then the focus lag --
    this._updateAdaptive(d);
    this._updateFocus(d);

    // 9 ── springs / shake ---------------------------------------------------
    this._updateSprings(d);
    this._updateShake(d);

    // 10 ── distance + collision --------------------------------------------
    this._updateDistance(d);

    // 11 ── cinematic clock --------------------------------------------------
    if (this._cine) this._updateCinematic(d);
    else if (this._cineBlendT >= 0) {
      this._cineBlendT += d;
      if (this._cineBlendT >= CINE_BLEND_S) this._cineBlendT = -1;
    }

    // 12 ── compose the camera ----------------------------------------------
    this._compose(d);

    // 13 ── lens + sibling outputs ------------------------------------------
    this._updateFov(d);
    this._updateOutputs(d);
  }

  /* ─────────────────────────── internals ─────────────────────────── */

  _readSettings() {
    const s = (this.settings && typeof this.settings.get === 'function')
      ? (this.settings.get() || {})
      : (this.settings || {});
    this._camMode = s.camMode === 'free' ? 'free' : 'follow';
    this._invertX = !!s.invertX;
    this._invertY = !!s.invertY;
    this._sensX = (typeof s.camSensX === 'number' && isFinite(s.camSensX)) ? clamp(s.camSensX, 0.05, 10) : 1;
    this._sensY = (typeof s.camSensY === 'number' && isFinite(s.camSensY)) ? clamp(s.camSensY, 0.05, 10) : 1;
    if (!this._cine && !this._deathOn && !this._peekOn) this.mode = this._camMode;
  }

  /** Player position source: renderPos (interpolated feet) → pos. */
  _heroSrc() {
    const p = this.player;
    if (!p) return null;
    return p.renderPos || p.pos || null;
  }

  _heroSpeed() {
    const p = this.player;
    if (!p) return 0;
    if (p.vel) return Math.hypot(+p.vel.x || 0, +p.vel.z || 0);
    return +p.speed || 0;
  }

  _autoFrozen() {
    const p = this.player;
    if (!p) return false;
    const st = p.state;
    return FREEZE_STATES[st] === 1;
  }

  _clearTransients() {
    this._pDistX = this._pDistV = 0;
    this._pFovX = this._pFovV = 0;
    this._pPitchX = this._pPitchV = 0;
    this._shakeAmp = 0; this._shakeDur = 0; this._shakeT = 0;
    this._shakeX = this._shakeY = this._shakeRoll = this._shakePitch = 0;
    this._rcActive = false; this._rcHoldT = 0;
    this._autoRate = 0;
    this._yawSlide = 0; this._slideWant = 0;
    this._pitchSlide = 0; this._pitchWant = 0;
    this._pitchAdapt = 0; this._focusDrop = 0;
    this._fallDepth = 0; this._limitCeil = false;
    this._limitFrame = false; this._limitLens = TUNE.cam.dist;
    this._distAdapt = TUNE.cam.dist;
    this._dropBelow = 0; this._fallLookK = 0; this._lookAimK = 0;
  }

  /** Put the focus on the hero now; optionally the yaw behind them too. */
  _snapToPlayer(withYaw) {
    const src = this._heroSrc();
    if (!src) return;
    const p = this.player;
    if (withYaw && p && typeof p.facing === 'number' && isFinite(p.facing)) {
      this.yaw = wrapAngle(p.facing);
      this.pitch = TUNE.cam.defaultPitch;
    }
    this._yawSlide = 0; this._slideWant = 0;
    this._pitchSlide = 0; this._pitchWant = 0;
    this._pitchAdapt = 0; this._focusDrop = 0;
    this._airPeakY = src.y; this._fallDepth = 0; this._limitCeil = false;
    this._limitFrame = false; this._limitLens = TUNE.cam.dist;
    this._distAdapt = TUNE.cam.dist;
    this._dropBelow = 0; this._fallLookK = 0; this._lookAimK = 0;
    headingFromYaw(this.yaw, _fwd);
    rightFromFwd(_fwd, _right);
    this._shoulder = TUNE.cam.shoulder;
    this._focus.set(src.x, src.y + TUNE.cam.height, src.z).addScaledVector(_right, this._shoulder);
    this._focusInit = true;
    this._distBase = TUNE.cam.dist;
    this._distColl = TUNE.cam.dist;
    this.dist = TUNE.cam.dist;
  }

  _consumeLook(dt, suspended) {
    const input = this.input;
    if (!input || !input.look) return;
    let dx = +input.look.dx || 0;
    let dy = +input.look.dy || 0;
    // The camera owns this frame's delta — consume it so nothing double-applies.
    input.look.dx = 0; input.look.dy = 0;
    if (dx === 0 && dy === 0) return;
    if (suspended || this._deathOn || this._cine || dt <= 0) return;

    // CONTRACT §4: input.look is already sens + invert scaled. Only an input
    // that explicitly flags itself raw gets the settings applied here.
    if (input.lookIsRaw === true) {
      dx *= this._sensX * (this._invertX ? -1 : 1);
      dy *= this._sensY * (this._invertY ? -1 : 1);
    }

    this._lastManualT = this._time;
    this._autoRate = 0;
    this._rcActive = false;

    if (this._peekOn) {
      this.yaw = wrapAngle(this.yaw - dx);
      this._peekPitch = clamp(this._peekPitch - dy, -PEEK_PITCH_MAX, PEEK_PITCH_MAX);
      return;
    }
    // mouse right → orbit right (camera swings clockwise seen from above = −yaw)
    this.yaw = wrapAngle(this.yaw - dx);
    // mouse forward (dy < 0) → camera rises (pitch up)
    if (dy !== 0) {
      this.pitch = clamp(this.pitch - dy, TUNE.cam.pitchMin, TUNE.cam.pitchMax);
      this._pitchIdleT = 0;
    }
  }

  _updateRecenter(dt) {
    const p = this.player;
    const target = (p && typeof p.facing === 'number' && isFinite(p.facing)) ? p.facing : this.yaw;
    this._rcT += dt;
    const k = clamp(this._rcT / Math.max(1e-3, TUNE.cam.recenterTime), 0, 1);
    const e = easeInOutSine(k);
    // interpolate from the start yaw toward the LIVE facing so a turning hero is tracked
    this.yaw = wrapAngle(this._rcFrom + shortestAngle(this._rcFrom, target) * e);
    if (k >= 1) { this.yaw = wrapAngle(target); this._rcActive = false; }
  }

  _updateAutoYaw(dt) {
    // eligibility — every rule in the header, in order
    let want = 0;
    let target = this.yaw;
    if (this.mode === 'follow' && !this._peekOn) {
      const speed = this._heroSpeed();
      const idle = this._time - this._lastManualT;
      if (speed > AUTO_MIN_SPEED && idle >= MANUAL_IDLE_S && !this._autoFrozen()) {
        const v = this.player.vel;
        const runYaw = v ? yawFromHeading(v.x, v.z) : this.yaw;
        const delta = shortestAngle(this.yaw, runYaw);
        if (Math.abs(delta) < AUTO_TOWARD_DEADZONE) { want = 1; target = runYaw; }
      }
    }
    // rate ramps in / out with lagYaw → S-curve start and stop, never a step
    this._autoRate = damp(this._autoRate, want, TUNE.cam.lagYaw, dt);
    if (this._autoRate < 1e-3) { this._autoRate = 0; return; }
    if (want === 0) return;
    const delta = shortestAngle(this.yaw, target);
    // soften inside AUTO_SOFT_DELTA so the camera settles instead of hunting
    const soft = smoothstep(0, AUTO_SOFT_DELTA, Math.abs(delta));
    const rate = TUNE.cam.autoYaw * this._autoRate * (0.25 + 0.75 * soft);
    this.yaw = moveTowardAngle(this.yaw, target, rate * dt);
  }

  _updatePitchReturn(dt) {
    if (this._peekOn || this._cine || this._deathOn) return;
    this._pitchIdleT += dt;
    if (this.mode !== 'follow') return;
    if (this._pitchIdleT < PITCH_IDLE_S) return;
    const d = TUNE.cam.defaultPitch - this.pitch;
    if (Math.abs(d) < 1e-4) { this.pitch = TUNE.cam.defaultPitch; return; }
    const step = PITCH_RETURN_RATE * dt;
    this.pitch += d > step ? step : (d < -step ? -step : d);
  }

  /**
   * The pitch the lens is actually posed at: the player's orbit pitch plus the
   * context-derived offset. CONTRACT §12 calls the camera's elevation `pitch`;
   * `this.pitch` stays the value the player drives (and that `_updatePitchReturn`
   * eases home), so manual orbit and adaptive framing never fight each other.
   */
  _pitchAim() {
    const C = TUNE.cam;
    const base = clamp(this.pitch + this._pitchAdapt, C.pitchMin, C.pitchMax);
    // The SHAFT tier rides OUTSIDE the player's orbit band on purpose: the band
    // is what the player may drive to, and the tier is the solver answering a
    // geometry the band has no legal pose in (see PITCH_STEPS). It is 0 in every
    // ordinary frame, so `pitchMin`/`pitchMax` still govern the camera the
    // player owns.
    if (this._pitchSlide === 0) return base;
    return clamp(base + this._pitchSlide, -PITCH_ABS_MAX, PITCH_ABS_MAX);
  }

  /**
   * Derive the focus height and the pitch offset from CONTEXT — collided
   * distance, how far the hero has fallen below the peak of this arc, and the
   * resulting hero-vs-focus height error — rather than holding pitch at a
   * constant `defaultPitch` forever (which put the chest at ndc −0.77 whenever
   * the lens closed, and let the hero ride the bottom edge through every long
   * fall). Both outputs are eased, so nothing steps.
   */
  _updateAdaptive(dt) {
    const p = this.player;
    const src = this._heroSrc();
    const grounded = !!(p && (p.grounded || p.onGround));
    const inWater  = !!(p && (p.inWater || p.submerged));

    // fall depth = metres below the peak of the CURRENT airborne arc. A hop can
    // never exceed its own apex, so this separates falls from the jump family.
    if (!src) {
      this._fallDepth = 0;
    } else if (grounded || inWater) {
      this._airPeakY = src.y;
      this._fallDepth = 0;
    } else {
      if (src.y > this._airPeakY) this._airPeakY = src.y;
      const fd = this._airPeakY - src.y;
      this._fallDepth = fd > 0 ? fd : 0;
    }

    const cinematicish = this._peekOn || !!this._cine || this._deathOn;

    // DROP PROBE — the air under a DESCENDING hero, asked directly (see
    // FALL_DROP_M0). One ray, through the same embedded-origin-honest cast the
    // whisker fan uses, and only while airborne and not rising: a jump never
    // fires it over flat ground (the air under its apex IS its apex, 3.578 m
    // at the highest) and a real fall fires it on its first descending frame
    // instead of 0.39 s in. Nothing below FALL_PROBE_M = a death pit: full.
    let dropBelow = 0;
    const descending = !!(p && p.vel && (+p.vel.y || 0) <= 0);
    if (src && descending && !grounded && !inWater && !cinematicish) {
      const bpd = this._broadphase();
      if (bpd) {
        _tmp.set(src.x, src.y + 0.05, src.z);
        const tDown = this._castOccluder(bpd, _tmp, _DOWN, FALL_PROBE_M);
        dropBelow = tDown >= 0 ? tDown : FALL_PROBE_M;
      }
    }
    this._dropBelow = dropBelow;
    const deepK = smoothstep(FALL_DROP_M0, FALL_DROP_M1, dropBelow);

    // ONE fall driver for the focus catch-up, the focus drop and the pitch:
    // whichever of the two measures says 'fall' first. They agree on what a
    // fall IS (a drop no member of the jump family can produce); they differ
    // only in how early they can say it.
    const fallK = Math.max(smoothstep(FALL_LOOK_M0, FALL_LOOK_M1, this._fallDepth), deepK);
    this._fallLookK = fallK;

    // The distance BOTH adaptive terms read: follows the lens in at once, lets
    // go slowly (see ADAPT_IN_LAMBDA — this is the cut in the feedback loop that
    // let the solver pump at a standstill). `_updateAdaptive` runs before
    // `_updateFocus` and `_updateDistance`, so the anchor below reads it too.
    const dNow = this.dist;
    this._distAdapt = dt > 0
      ? damp(this._distAdapt, dNow,
             dNow < this._distAdapt ? ADAPT_IN_LAMBDA : ADAPT_OUT_LAMBDA, dt)
      : dNow;
    const closeK = 1 - smoothstep(FOCUS_LOW_D0, FOCUS_LOW_D1, this._distAdapt);

    // focus: head height at range, chest as the lens closes, lower again on a fall
    // — but NEVER when the FRAMING probe is what closed the lens. That probe
    // reports geometry occupying the band between the chest and the focus (a
    // merlon, a stair tread, a parapet), and lowering the focus INTO that band
    // is what latched the collapse this rule was written for: at verdant-1
    // cp-rampart the chest probe pulled the lens to `frameMin`, the drop then
    // moved the focus from y 16.00 (clear, 0.2 m above the merlon) to 15.38
    // (inside it), the FAN went hard-blocked at 0.21 m, and the camera sat at
    // 0.12 m with the hero off-frame for as long as the player stood there —
    // it could not recover, because the recovery signal was the very thing the
    // drop had destroyed. Exactly the same shape as the `_limitCeil` rule below.
    const dropK = this._limitFrame ? 0 : closeK;
    let drop = cinematicish ? 0 : FOCUS_DROP_MAX * dropK + FALL_FOCUS_DROP * fallK;
    this._focusDrop = dt > 0 ? damp(this._focusDrop, drop, PITCH_ADAPT_LAMBDA, dt) : drop;

    // pitch: tip down into a fall, and lift as the lens closes — but NEVER when
    // the pull-in was a ceiling, which is the one case where raising the camera
    // drives it into the surface that is already limiting it.
    let pitchWant = cinematicish ? 0 : FALL_PITCH_LIFT * fallK;
    if (!cinematicish && !this._limitCeil) {
      pitchWant += CLOSE_PITCH_LIFT * closeK + FALL_PITCH_DEEP * deepK;
    }
    // grows fast (the landing has to be in frame from the top of the arc),
    // releases at the old rate so nothing snaps back on touchdown.
    this._pitchAdapt = dt > 0
      ? damp(this._pitchAdapt, pitchWant,
             pitchWant > this._pitchAdapt ? PITCH_ADAPT_FAST : PITCH_ADAPT_LAMBDA, dt)
      : pitchWant;

    // look-aim blend (see LOOK_AIM_D0): pure framing, consumed by `_compose`
    // only — it never reaches the fan, the focus or the posed pitch.
    const aimWant = cinematicish ? 0 : 1 - smoothstep(LOOK_AIM_D0, LOOK_AIM_D1, this._distAdapt);
    this._lookAimK = dt > 0 ? damp(this._lookAimK, aimWant, PITCH_ADAPT_LAMBDA, dt) : aimWant;
  }

  _updateFocus(dt) {
    const src = this._heroSrc();
    if (!src) return;
    const p = this.player;

    headingFromYaw(this.yaw, _fwd);
    rightFromFwd(_fwd, _right);

    // hero centre and shoulder-offset target
    _heroC.set(src.x, src.y + TUNE.cam.height - this._focusDrop, src.z);
    _focusT.copy(_heroC).addScaledVector(_right, this._shoulder);

    if (!this._focusInit) { this._focus.copy(_focusT); this._focusInit = true; return; }
    if (this._deathOn) { this._focus.copy(this._deathFocus); return; }
    if (dt <= 0) return;

    const grounded = !!(p && (p.grounded || p.onGround));
    const inWater  = !!(p && (p.inWater || p.submerged));
    const lam = TUNE.cam.lagPos;

    // horizontal: hero leads by v/lambda
    this._focus.x = damp(this._focus.x, _focusT.x, lam, dt);
    this._focus.z = damp(this._focus.z, _focusT.z, lam, dt);

    // vertical: slow in the air (no bob per hop), fast catch-up on a big fall / landing
    let lamY = lam;
    if (!grounded && !inWater) {
      const dy = _focusT.y - this._focus.y;
      // RISING: only a big error catches up fast, so a hop never bobs the frame.
      // FALLING: the vertical lambda ramps from AIR_LAG_V to FALL_CATCHUP_LAMBDA
      // with how far below this arc's peak the hero is — smooth, so there is no
      // step, and zero for the whole jump family (which never falls past its own
      // apex). At λ 14 a 25 m/s descent trails by 1.8 m instead of 7 m, which is
      // the difference between seeing the landing and reading the sky.
      lamY = dy > AIR_CATCHUP_DY
        ? AIR_CATCHUP_LAMBDA
        : lerp(AIR_LAG_V, FALL_CATCHUP_LAMBDA, this._fallLookK);
    }
    this._focus.y = damp(this._focus.y, _focusT.y, lamY, dt);

    // CLOSE-RANGE ANCHOR (see ANCHOR_D0): the lag and the shoulder are what make
    // the hero lead the frame at range and what throw him out of it up close, so
    // they fade out together as the lens closes. `_heroC` is the hero's own
    // centre — no shoulder — so at full anchor the focus IS the hero and he is
    // centred in whatever distance the geometry leaves. Read off `_distAdapt`,
    // which follows the lens in immediately, so the anchor is never late.
    // …AND THE SHAFT TIER ANCHORS TOO, for the same reason at a different angle.
    // MEASURED on the kick ladder with the tilt working (`_r4_shaftpitch.json`):
    // `cam.dist` never fell below 2.00 m — the tier had bought the distance —
    // yet camera-to-HEAD still dipped to 0.663 m. An overhead lens is offset
    // from the FOCUS, and the focus was 1.5 m below a hero climbing at 12 m/s
    // (the vertical lag is deliberately slow in the air so a hop never bobs the
    // frame), so the camera sat on the focus's head height while the hero rose
    // through it. Distance from a point the hero has left is not framing. While
    // the tilt is in, the focus rides the hero.
    let aK = 1 - smoothstep(ANCHOR_D0, ANCHOR_D1, this._distAdapt);
    const tiltK = smoothstep(0, SHAFT_ANCHOR_RAD, Math.abs(this._pitchSlide));
    if (tiltK > aK) aK = tiltK;
    if (aK > 0) {
      this._focus.x = lerp(this._focus.x, _heroC.x, aK);
      this._focus.y = lerp(this._focus.y, _heroC.y, aK);
      this._focus.z = lerp(this._focus.z, _heroC.z, aK);
    }
  }

  _updateSprings(dt) {
    if (dt <= 0) return;
    critDamp(this._pDistX, this._pDistV, PUNCH_OMEGA, dt, _spring);
    this._pDistX = _spring.x; this._pDistV = _spring.v;
    if (Math.abs(this._pDistX) < 1e-5 && Math.abs(this._pDistV) < 1e-4) { this._pDistX = 0; this._pDistV = 0; }

    critDamp(this._pFovX, this._pFovV, PUNCH_OMEGA, dt, _spring);
    this._pFovX = _spring.x; this._pFovV = _spring.v;
    if (Math.abs(this._pFovX) < 1e-4 && Math.abs(this._pFovV) < 1e-3) { this._pFovX = 0; this._pFovV = 0; }

    critDamp(this._pPitchX, this._pPitchV, PUNCH_OMEGA, dt, _spring);
    this._pPitchX = _spring.x; this._pPitchV = _spring.v;
    if (Math.abs(this._pPitchX) < 1e-6 && Math.abs(this._pPitchV) < 1e-5) { this._pPitchX = 0; this._pPitchV = 0; }
  }

  _updateShake(dt) {
    if (this._shakeDur <= 0) {
      this._shakeX = this._shakeY = this._shakeRoll = this._shakePitch = 0;
      return;
    }
    this._shakeT += dt;
    if (this._shakeT >= this._shakeDur) {
      this._shakeDur = 0; this._shakeAmp = 0;
      this._shakeX = this._shakeY = this._shakeRoll = this._shakePitch = 0;
      return;
    }
    const k = 1 - this._shakeT / this._shakeDur;
    const a = this._shakeAmp * k * k;
    const t = this._shakeT, s = this._shakeSeed;
    this._shakeX     = shakeNoise(t, s)      * a * SHAKE_POS_M;
    this._shakeY     = shakeNoise(t, s + 31) * a * SHAKE_POS_M * 0.8;
    this._shakeRoll  = shakeNoise(t, s + 59) * a * SHAKE_ROLL_RAD;
    this._shakePitch = shakeNoise(t, s + 83) * a * SHAKE_PITCH_RAD;
  }

  /**
   * Whisker fan for ONE candidate heading → the closest legal camera distance
   * along it. The FULL fan every time, candidates included: a cheaper ranking
   * fan lies, and a heading picked on a lie stalls the slide half-resolved
   * (measured — centre-ray-only ranking chose 0.18 rad against a 0.9 m pillar
   * whose lateral whiskers were still blocked, leaving the lens at 1.21 m).
   * `pose` records `_limitCeil` for the heading we will actually use.
   * Allocation-free.
   */
  _clearance(bp, yawOff, pitch, want, pose) {
    const R = TUNE.cam.collideRadius;
    headingFromYaw(this.yaw + yawOff, _cFwd);
    rightFromFwd(_cFwd, _cRight);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    _cDir.set(-_cFwd.x * cp, sp, -_cFwd.z * cp);
    const maxD = want + R;
    let limit = want;
    let ceil = false;
    let t;
    // The LENS-only answer, kept apart from the framing probe's: it is the
    // distance past which the lens sphere really would be inside geometry, and
    // it is reported for the harnesses and separates 'hero hidden' from
    // 'lens in a wall' (see COLLIDE_IN_MAX_RATE).
    let lensLimit = want;

    // ── LENS PROBES: the path the lens sphere actually sweeps. A hit here is
    // real clipping, so it has NO floor but the near plane (CONTRACT §12).
    for (let i = -WHISKER_N; i <= WHISKER_N; i++) {
      _cOrigin.copy(this._focus).addScaledVector(_cRight, i * WHISKER_M);
      t = this._castOccluder(bp, _cOrigin, _cDir, maxD);
      if (t >= 0 && t - R < limit) { limit = t - R; ceil = this._probeCeil; }
      if (t >= 0 && t - R < lensLimit) lensLimit = t - R;
    }
    // ceiling probe: offset by the collide radius — still the lens sphere, so
    // still unfloored — and reports its RAW hit distance (see WHISKER_UP_M).
    _cOrigin.copy(this._focus); _cOrigin.y += WHISKER_UP_M;
    t = this._castOccluder(bp, _cOrigin, _cDir, maxD);
    if (t >= 0 && t < limit) { limit = t; ceil = this._probeCeil; }
    if (t >= 0 && t < lensLimit) lensLimit = t;

    // ── FRAMING PROBE: chest height, 0.70 m BELOW the lens path — twice the
    // collide radius, so it is not the lens sphere and a hit on it is not a
    // clipping report. It catches an occluder whose TOP sits between the chest
    // and the focus (a merlon, a stair tread, a parapet): the lens sails over
    // it, but the hero's body would be hidden behind it. That is a FRAMING
    // problem and it gets the framing response — pull in to `frameMin` and let
    // the yaw slide go around — never the clipping response.
    //
    // Applying the raw hit was a real defect with a self-locking failure mode.
    // Measured at verdant-1 cp-rampart: the merlon at centre (10, 15.1, −27),
    // half (0.8, 0.7, 0.8), tops out at y 15.80 while the focus rides at 16.00,
    // i.e. the lens clears it by 0.2 m — but the chest probe at 15.30 hit it
    // 0.21 m back, so `limit = 0.21 − 0.35 = −0.14` floored to 0.12 m. And a
    // camera at 0.12 m drops the focus to chest height (FOCUS_DROP_MAX), which
    // moves the FOCUS itself into the merlon's y band, which blocks the fan
    // too — so the collapse latched and could not recover on any later frame.
    // Flooring this probe cannot cause clipping: whenever the obstacle is also
    // in the lens's path, the fan above reports it with no floor at all.
    const frameFloor = Math.min(TUNE.cam.frameMin, want);
    let frame = false;
    _cOrigin.copy(this._focus); _cOrigin.y -= WHISKER_DOWN_M;
    t = this._castOccluder(bp, _cOrigin, _cDir, maxD);
    if (t >= 0) {
      const framed = Math.max(t - R, frameFloor);
      if (framed < limit) { limit = framed; ceil = this._probeCeil; frame = true; }
    }

    if (pose) { this._limitCeil = ceil; this._limitFrame = frame; this._limitLens = lensLimit; }
    return limit;
  }

  /**
   * ONE whisker, honest about an origin that starts inside geometry.
   *
   * Returns the distance from `origin` to the first surface that can really
   * occlude the focus, or −1 when nothing along `maxD` can. `this._probeCeil`
   * records whether that surface was an underside (see EMBED_* above for why
   * this exists and what it measured). Allocation-free: one shared marching
   * origin, one shared hit record, no closure.
   */
  _castOccluder(bp, origin, dir, maxD) {
    let travelled = 0;
    _pOrigin.copy(origin);
    for (let i = 0; i <= EMBED_SKIP_MAX; i++) {
      const rem = maxD - travelled;
      if (!(rem > 0)) return -1;
      if (!this._ray(bp, _pOrigin, dir, rem, _hit)) return -1;
      if (_hit.t > EMBED_EPS_M) {
        this._probeCeil = _hit.normal.y < -0.5;
        return travelled + _hit.t;
      }
      // t ≈ 0 — two very different worlds. Either the origin is INSIDE this
      // collider (degenerate: step past its far face and ask the world again),
      // or it is a real surface the focus is touching, which is a genuine
      // occluder and must stop the probe exactly as it always did.
      let step = 0;
      const c = _hit.collider;
      if (c && typeof c.containsPoint === 'function' && c.containsPoint(_pOrigin)) {
        step = boxExitT(c, _pOrigin.x, _pOrigin.y, _pOrigin.z, dir.x, dir.y, dir.z) + EMBED_STEP_PAD;
      } else {
        const hf = _hit.heightfield;
        if (hf && typeof hf.heightAt === 'function') {
          const h = hf.heightAt(_pOrigin.x, _pOrigin.z);
          if (h === h && _pOrigin.y < h) step = EMBED_HF_STEP;   // under the ground
        }
      }
      if (!(step > 0)) {                                   // real contact at zero range
        this._probeCeil = _hit.normal.y < -0.5;
        return travelled + _hit.t;
      }
      travelled += step;
      _pOrigin.addScaledVector(dir, step);
    }
    return -1;    // still embedded after EMBED_SKIP_MAX shells — nothing honest to report
  }

  /**
   * Desired distance = eased base (+1.5 m on death) + punch dip, then the
   * whisker fan resolves it. THREE responses, in order of how little they cost
   * the player: (1) if the fan is clear past `TUNE.cam.frameMin`, nothing
   * happens; (2) if it is not, slide the lens sideways onto the cheapest
   * heading that IS clear, so the camera goes around the occluder instead of
   * into the hero's back; (3) when NO yaw heading reaches `minDist` — a SHAFT,
   * blocked at every yaw at once — tilt instead: over-the-head, then
   * up-the-shaft (PITCH_STEPS), which buys the distance the yaw fan cannot;
   * (4) only when neither a heading nor a tilt clears — the hero flat
   * against a long wall — pull in tight, floored at the near plane, which is what
   * CONTRACT §12 asks for and what `camcheck`'s wall row measures. The pull-in
   * eases (COLLIDE_IN_MAX_S) unless the eased lens position would be inside a
   * collider, in which case it is taken whole in one frame as it always was;
   * release eases out over 0.6 s so the camera never pumps.
   */
  _updateDistance(dt) {
    const C = TUNE.cam;
    // The camera-occluder set tracks the live course, follows its moving parts and
    // is culled to the fan's reach BEFORE any probe below asks the world (also on a
    // dt = 0 snap, so a respawn or test placement never solves against a stale set).
    this._syncOccluders();
    const baseWant = this._deathOn ? C.dist + DEATH_PULL_M : C.dist;
    this._distBase = dt > 0 ? damp(this._distBase, baseWant, DIST_LAMBDA, dt) : baseWant;

    if (this._peekOn || this._cine) {
      // peek/cinematic do not orbit — hold the collision state at minimum so the
      // return eases out from the head rather than popping to full distance
      if (this._peekOn) this._distColl = C.minDist;
      this._yawSlide = 0; this._slideWant = 0; this._limitCeil = false; this._limitFrame = false;
      this._pitchSlide = 0; this._pitchWant = 0;
        this.dist = Math.max(C.minDist, this._distColl);
      return;
    }

    let want = Math.max(C.minDist, this._distBase + this._pDistX);
    let pitch = this._pitchAim();

    const bp = this._broadphase();
    if (bp) {
      // (a) shoulder guard: hero centre → shoulder focus must be clear
      const src = this._heroSrc();
      if (src) {
        headingFromYaw(this.yaw + this._yawSlide, _fwd);
        rightFromFwd(_fwd, _right);
        _heroC.set(src.x, src.y + C.height - this._focusDrop, src.z);
        let sh = C.shoulder;
        if (sh !== 0) {
          _tmp.copy(_right).multiplyScalar(Math.sign(sh));
          // same embedded-origin rule as the fan: a slab the hero's chest is
          // sunk into must not collapse the shoulder offset to zero.
          const tSh = this._castOccluder(bp, _heroC, _tmp, Math.abs(sh) + C.collideRadius);
          if (tSh >= 0) sh = Math.sign(sh) * Math.max(0, tSh - C.collideRadius);
        }
        this._shoulder = dt > 0 ? damp(this._shoulder, sh, 14, dt) : sh;
      }

      // (b) the honest, un-slid pose
      const c0 = this._clearance(bp, 0, pitch, want, true);
      const frozen = this._autoFrozen();
      // (c) the framing floor never demands more than the distance we asked for
      const floor = Math.min(C.frameMin, want);
      // TRIED AND REVERTED, with the measurement: also triggering the slide when
      // the FRAMING probe is the limiter (`this._limitFrame`, lens clear but a
      // merlon at chest height between it and the hero's body), with a search
      // target of `floor + SLIDE_GAIN_MIN` so the floor it already stands on is
      // not accepted as the answer. It trades a mild chest occlusion for a hard
      // collapse: camsweep went from 0 bad headings on both courses to keep
      // heroFullyHidden 1 / offScreen 1 / lensInSolid 1 / minDist 0.12, because
      // the heading that clears the chest probe put the LENS inside the keep's
      // stairwell. A parapet across the hero's waist is the cheaper failure.
      let slideWant = 0;
      if (c0 < floor && !this._limitCeil && !frozen) {
        // The heading we are ALREADY on is the first candidate, not zero: while
        // the un-slid pose stays blocked, an avoidance heading that is still
        // working must not be dropped just because the search that found it
        // (the wide tier) is no longer open — releasing it there would slam the
        // lens straight back into the collapse it was solving.
        let bestOff = this._yawSlide, bestClear = c0;
        if (bestOff !== 0) {
          const held = this._clearance(bp, bestOff, pitch, want, false);
          if (held > bestClear + 1e-3) bestClear = held; else bestOff = 0;
        }
        // cheapest deviation first, both signs, stop at the first that frames him
        const wide = c0 < FADE_START_DIST && this._heroSpeed() > AUTO_MIN_SPEED;
        const nTry = wide ? SLIDE_STEPS.length : SLIDE_BOUNDED_N;
        for (let k = 0; k < nTry && bestClear < floor; k++) {
          for (let sg = 0; sg < 2 && bestClear < floor; sg++) {
            const off = sg === 0 ? SLIDE_STEPS[k] : -SLIDE_STEPS[k];
            const c = this._clearance(bp, off, pitch, want, false);   // ranking, not the pose
            if (c > bestClear + 1e-3) { bestClear = c; bestOff = off; }
          }
        }
        // a slide that buys nothing is just a camera spinning the world
        if (bestClear >= c0 + SLIDE_GAIN_MIN) slideWant = bestOff;
      } else if (this._yawSlide !== 0 && c0 < floor + SLIDE_RELEASE_M) {
        slideWant = this._yawSlide;                 // hysteresis: hold, never hunt
      }
      this._slideWant = slideWant;

      // (d) ease onto it — frozen during a committed move (CONTRACT §12).
      // A SNAP (dt <= 0: course load, respawn) takes the heading immediately, so
      // the very first frame after a respawn is already framed rather than
      // starting inside a pillar and easing out of it.
      if (dt <= 0) { this._yawSlide = slideWant; }
      else if (!frozen && slideWant !== this._yawSlide) {
        const rate = (slideWant === 0 ? SLIDE_RELEASE_RATE : SLIDE_RATE) * dt;
        const dOff = slideWant - this._yawSlide;
        const next = this._yawSlide + (dOff > rate ? rate : (dOff < -rate ? -rate : dOff));
        // only into air the lens can live in (see SLIDE_STEP_LOSS). MEASURED
        // AGAINST THE CLEARANCE WE HAVE, NOT AGAINST THE EASED LENS. `_distColl`
        // is where the lens IS, which lags where it may be by the whole pull-in
        // ease — so the test read 'is this step worse than the distance I have
        // not collapsed to yet', and the answer while the lens was still out at
        // 2.19 m was yes for every step. The slide that would have AVOIDED the
        // collapse was therefore refused until the collapse had happened and
        // dropped the bar: measured in the keep undercroft, yawSlide was exactly
        // 0.000 on the frame the lens fell 2.193 -> 0.609 m and only then ramped
        // 0.053 / 0.107 / 0.160 / 0.213 over the four frames after it. The
        // quantity SLIDE_STEP_LOSS is about is what the CANDIDATE HEADING costs
        // against the heading we are on (that is the pump it was written for:
        // 6.80 m one step, 0.62 m the next), so that is what it now compares.
        const cNext = this._clearance(bp, next, pitch, want, false);
        const cCur  = this._yawSlide === 0 ? c0 : this._clearance(bp, this._yawSlide, pitch, want, false);
        if (cNext >= floor || cNext >= cCur - SLIDE_STEP_LOSS) {
          this._yawSlide = next;
          if (Math.abs(this._yawSlide) < 1e-4) this._yawSlide = 0;
        }
      }

      // (d2) THE SHAFT TIER. The clearance on the heading we will actually pose
      // at — after the yaw ease, so the tier answers the pose and not a heading
      // the camera is only passing through.
      let cPose = this._yawSlide === 0 ? c0 : this._clearance(bp, this._yawSlide, pitch, want, true);
      let pitchWant = 0;
      if (cPose < C.minDist + PITCH_ARM_M) {
        // No yaw heading the slide may take can frame him: the geometry is a
        // SHAFT, not a wall, and the axes it is open along are the ones the
        // ordinary fan never asks about.
        const goal = C.minDist + PITCH_TARGET_M;
        // Over-the-head first (+), up-the-shaft second (−), smallest tilt first,
        // and stop at the first that reaches the goal: the tier takes the
        // CHEAPEST pose that works, never the steepest one available.
        let bestOff = 0, bestClear = cPose;
        for (let k = 0; k < PITCH_STEPS.length && bestClear < goal; k++) {
          for (let sg = 0; sg < 2 && bestClear < goal; sg++) {
            const off = sg === 0 ? PITCH_STEPS[k] : -PITCH_STEPS[k];
            const pc = clamp(pitch + off, -PITCH_ABS_MAX, PITCH_ABS_MAX);
            const real = pc - pitch;
            if (real > -1e-3 && real < 1e-3) continue;            // clamped to where we already are
            const c = this._clearance(bp, this._yawSlide, pc, want, false);
            if (c > bestClear + 1e-3) { bestClear = c; bestOff = real; }
          }
        }
        // A tilt or a swing that does not actually rescue the frame is just a
        // camera moving for its own sake: it must reach minDist AND buy real
        // clearance over the pose we are already in.
        if (bestClear >= C.minDist && bestClear >= cPose + PITCH_SLIDE_GAIN_MIN) {
          pitchWant = this._pitchSlide + bestOff;
        }
      } else if (this._pitchSlide !== 0 && cPose < floor + PITCH_RELEASE_M) {
        pitchWant = this._pitchSlide;               // hysteresis: hold, never hunt
      }
      this._pitchWant = pitchWant;
      if (dt <= 0) { this._pitchSlide = pitchWant; }
      else if (pitchWant !== this._pitchSlide) {
        const pr = (pitchWant === 0 ? PITCH_RELEASE_RATE : PITCH_SLIDE_RATE) * dt;
        const dP = pitchWant - this._pitchSlide;
        this._pitchSlide += dP > pr ? pr : (dP < -pr ? -pr : dP);
        if (this._pitchSlide > -1e-4 && this._pitchSlide < 1e-4) this._pitchSlide = 0;
      }
      // …and re-solve at the pitch we will POSE at, so the fan that decides the
      // distance and the fan the lens is placed by are never a frame apart.
      const pAim = this._pitchAim();
      if (pAim !== pitch) {
        pitch = pAim;
        cPose = this._clearance(bp, this._yawSlide, pitch, want, true);
      }

      // (e) the distance along the heading we will actually pose at
      want = Math.max(COLLIDE_MIN_DIST, cPose);
      // (f) the lens SPHERE at that distance, not only the ray to it (see
      // SPHERE_EPS_M): pull in to the deepest sphere-clear distance, never below
      // the framing floor and never past what the fan already answered.
      const sphFloor = Math.min(C.frameMin, want);
      if (want > sphFloor && !this._sphereClear(bp, want, pitch)) {
        want = this._deepestSphereClear(bp, sphFloor, want, pitch);
      }
    } else {
      this._limitLens = want;      // no broadphase: nothing limits the lens
    }
    if (dt <= 0) { this._distColl = want; }
    else if (want < this._distColl) {
      const gap = this._distColl - want;
      let step = COLLIDE_IN_MAX_RATE * dt;                 // floor rate for a small gap
      const need = gap * (dt / COLLIDE_IN_MAX_S);          // …and always done inside that window
      if (need > step) step = need;
      if (step > COLLIDE_IN_MAX_STEP) step = COLLIDE_IN_MAX_STEP;
      let next = this._distColl - step;
      if (next <= want) next = want;
      // NO EASE THROUGH A SOLID — but that is a reason to stop where the solid
      // starts, not a licence to spend the whole gap in one frame. The old
      // line jumped straight to `want`, which is the fan's answer MINUS the
      // collide radius and can sit far inside the framing floor: measured, one
      // frame moved the lens 2.193 -> 0.609 m (below both frameMin 2.4 and
      // minDist 1.6) on an occluder the ease was already handling, bypassing
      // COLLIDE_IN_MAX_STEP entirely. The honest destination is the DEEPEST
      // distance along this heading at which the lens is still in open air.
      else if (bp && this._lensEmbedded(bp, next, pitch)) {
        const free = this._deepestFree(bp, want, next, pitch);
        // A STALL: the deepest free distance is on the FAR side of a solid that
        // now stands between the lens and `want` — a body that moved INTO the line
        // of sight (measured 2026-09-05, azure-1 cp4 with the camera on the sluice
        // side: the mover deck rises through the focus→lens line and the eased
        // lens waited outside it for 0.82 s with the hero hidden; CONTRACT budgets
        // 0.3 s). Waiting is right for a crossing that clears in a few frames and
        // wrong past that: after COLLIDE_STALL_MAX_S the lens takes the fan's own
        // answer (`want`, on the hero's side of the body) in one cut. Inside a
        // solid is never an option; hidden for longer than the budget is not one
        // either.
        if (free > want + 1e-3) {
          this._stallT += dt;
          next = this._stallT >= COLLIDE_STALL_MAX_S ? want : free;
        } else {
          next = free;
        }
      } else {
        this._stallT = 0;
      }
      if (next <= want) this._stallT = 0;
      this._distColl = next;
    } else {
      this._stallT = 0;
      let next = damp(this._distColl, want, COLLIDE_OUT_LAMBDA, dt);              // ease back out
      const maxStep = COLLIDE_OUT_MAX_RATE * dt;
      if (next - this._distColl > maxStep) next = this._distColl + maxStep;
      // A body that moved INTO a resting lens (a sail sweeping past, a deck
      // rising under it, a slab the hero's head is sunk into so the fan's
      // embedded-origin rule skipped it — measured 2026-09-05, ember-4 cp3: the
      // lens sat INSIDE the sandboard's 6 × 0.5 m collider for 200 frames at
      // both flanks, `dist` 1.38..2.67) is not something the fan, which only
      // asks along the line from the focus, can see. One ray per frame at the
      // posed lens catches it, and the answer is the deepest open-air distance
      // on the hero's side — taken whole, because a lens inside a solid is worse
      // than a cut.
      if (bp && this._lensEmbedded(bp, next, pitch)) next = this._deepestFree(bp, COLLIDE_MIN_DIST, next, pitch);
      this._distColl = next;
    }
    this.dist = this._distColl;
  }

  /**
   * Would the lens be INSIDE a collider at distance `d` along the posed heading?
   * One ray, no allocation: `Broadphase.raycast` reports an origin inside a box
   * as the degenerate hit `t = 0, normal = −dir` (collider.js "origin inside"),
   * and a heightfield reports the same for an origin under the ground — the same
   * signal `_castOccluder` reads, asked at the lens instead of at the focus. A
   * surface merely NEAR the lens is not containment and does not answer true.
   */
  _lensEmbedded(bp, d, pitch) {
    headingFromYaw(this.yaw + this._yawSlide, _cFwd);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const px = this._focus.x - _cFwd.x * cp * d;
    const py = this._focus.y + sp * d;
    const pz = this._focus.z - _cFwd.z * cp * d;
    _pOrigin.set(px, py, pz);
    _cDir.set(0, -1, 0);
    if (!this._ray(bp, _pOrigin, _cDir, EMBED_EPS_M * 2, _hit)) return false;
    if (_hit.t > EMBED_EPS_M) return false;
    const c = _hit.collider;
    if (c && typeof c.containsPoint === 'function') return !!c.containsPoint(_pOrigin);
    const hf = _hit.heightfield;
    if (hf && typeof hf.heightAt === 'function') {
      const h = hf.heightAt(px, pz);
      return h === h && py < h;
    }
    return true;
  }

  /**
   * The largest distance in [lo, hi] at which the lens is NOT inside a
   * collider, sampled from `hi` downward. Called only on the rare frame where
   * the eased pull-in would end up embedded, so its cost is a handful of
   * single rays; allocation-free (`_lensEmbedded` reuses the hoisted temps).
   * Falls back to `lo` — the fan's own answer — when every sample is solid,
   * which is the thick-wall case the old unconditional snap assumed always
   * held.
   */
  _deepestFree(bp, lo, hi, pitch) {
    const span = hi - lo;
    if (!(span > 0)) return lo;
    let blocked = hi;
    for (let i = 1; i < EMBED_FREE_N; i++) {
      const d = hi - span * (i / EMBED_FREE_N);
      if (!this._lensEmbedded(bp, d, pitch)) {
        // The coarse sample is up to span/EMBED_FREE_N (0.8 m on a full pull-in)
        // deeper than the solid's face; bisect back toward the blocked sample so
        // the lens leaves the solid by centimetres, not by most of a metre
        // (measured 2026-09-05, rime-2 cp4 front heading: a one-frame dip to
        // 0.87 m from a 4.3 m pose when a yaw slide eased the lens into an ice
        // block's corner and the guard took the coarse sample).
        let free = d;
        for (let k = 0; k < SPHERE_BISECT_N; k++) {
          const mid = (blocked + free) * 0.5;
          if (this._lensEmbedded(bp, mid, pitch)) blocked = mid; else free = mid;
        }
        return free;
      }
      blocked = d;
    }
    return lo;
  }

  /**
   * Is the lens SPHERE at distance `d` along the posed heading clear of every
   * solid collider, every camera occluder and the ground? Oriented-box distance
   * (`Collider.distanceToPoint`) against the broadphase cells the sphere touches,
   * so a sail's mostly-air world AABB does not count. Allocation-free: one shared
   * query box and one shared candidate array, emptied before returning.
   */
  _sphereClear(bp, d, pitch) {
    headingFromYaw(this.yaw + this._yawSlide, _cFwd);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const px = this._focus.x - _cFwd.x * cp * d;
    const py = this._focus.y + sp * d;
    const pz = this._focus.z - _cFwd.z * cp * d;
    _pOrigin.set(px, py, pz);
    const R = TUNE.cam.collideRadius - SPHERE_EPS_M;
    _sphBox.min.set(px - R, py - R, pz - R);
    _sphBox.max.set(px + R, py + R, pz + R);
    let clear = true;
    if (typeof bp.query === 'function') {
      const cands = bp.query(_sphBox, _sphCands);
      for (let i = 0; i < cands.length && clear; i++) {
        const c = cands[i];
        if (!c || c.solid === false || !c.active || typeof c.distanceToPoint !== 'function') continue;
        if (c.distanceToPoint(_pOrigin) < R) clear = false;
      }
      _sphCands.length = 0;
    }
    if (clear) {
      const occ = this._occ, near = occ.near, items = occ.items;
      for (let k = 0; k < occ.nearCount && clear; k++) {
        if (items[near[k]].distanceToPoint(_pOrigin) < R) clear = false;
      }
    }
    if (clear) {
      const hfs = bp.heightfields;
      if (hfs) for (let i = 0; i < hfs.length && clear; i++) {
        const hf = hfs[i];
        if (!hf.active || typeof hf.heightAt !== 'function') continue;
        const h = hf.heightAt(px, pz);
        if (h === h && py - h < R) clear = false;
      }
    }
    return clear;
  }

  /**
   * The deepest distance in [lo, hi] at which the lens sphere is clear, walking
   * inward from `hi` (the fan's answer, known blocked) in SPHERE_FREE_N steps and
   * bisecting the first blocked/clear pair SPHERE_BISECT_N times so the result
   * does not step visibly as the hero moves. `hi` when nothing along the heading
   * is clear — the fan's answer is never made worse.
   */
  _deepestSphereClear(bp, lo, hi, pitch) {
    const span = hi - lo;
    if (!(span > 0)) return hi;
    let blocked = hi, clearD = -1;
    for (let i = 1; i <= SPHERE_FREE_N; i++) {
      const d = hi - span * (i / SPHERE_FREE_N);
      if (this._sphereClear(bp, d, pitch)) { clearD = d; break; }
      blocked = d;
    }
    if (clearD < 0) return hi;
    for (let i = 0; i < SPHERE_BISECT_N; i++) {
      const mid = (blocked + clearD) * 0.5;
      if (this._sphereClear(bp, mid, pitch)) clearD = mid; else blocked = mid;
    }
    return clearD;
  }

  _broadphase() {
    const w = this.world;
    if (!w) return null;
    const bp = w.broadphase || (w.course && w.course.broadphase) || null;
    return (bp && typeof bp.raycast === 'function') ? bp : null;
  }

  /**
   * THE camera's world query: the broadphase (every solid collider + heightfield —
   * what the player collides with) and then the camera-occluder set (what is
   * DRAWN opaque and bigger than, or without, a collider — see CamOccluders).
   * Same contract as `Broadphase.raycast`: `out.t` is the nearest hit or `maxD`,
   * an origin inside a box is the degenerate hit t = 0 with the normal back along
   * the ray. Every probe in this file goes through here. Allocation-free.
   */
  _ray(bp, origin, dir, maxD, out) {
    let hit = bp.raycast(origin, dir, maxD, out);
    const occ = this._occ;
    const n = occ.nearCount;
    if (n > 0) {
      const items = occ.items, near = occ.near;
      let best = hit ? out.t : maxD;
      for (let k = 0; k < n; k++) {
        const c = items[near[k]];
        const t = rayBoxT(c, origin, dir, best, _occN);
        if (t >= 0 && t < best) {
          best = t; hit = true;
          out.t = t; out.collider = c; out.heightfield = null;
          if (out.normal) out.normal.copy(_occN);
        }
      }
    }
    return hit;
  }

  /** Track the course, re-pose the moving occluders, cull to the fan's reach around the focus. */
  _syncOccluders() {
    const w = this.world;
    let course = null;
    if (w) course = (w.hazards && w.group && w.broadphase) ? w : (w.course || null);
    const occ = this._occ;
    occ.sync(course);
    if (!occ.items.length) { occ.nearCount = 0; return; }
    occ.refresh();
    const C = TUNE.cam;
    const reach = C.dist + DEATH_PULL_M + C.collideRadius + Math.abs(C.shoulder) +
                  WHISKER_N * WHISKER_M + WHISKER_DOWN_M + OCC_NEAR_PAD_M;
    occ.cull(this._focus.x, this._focus.y, this._focus.z, reach);
  }

  /**
   * PUBLIC occlusion probe — the same raycast the follow camera's whisker fan
   * uses, exposed so a CINEMATIC path can be STAGED with it.
   *
   * `setCinematic()` drives the lens from authored keys and deliberately skips
   * `_updateDistance` (a cinematic does not orbit, so it must not be pulled in
   * mid-shot). That is right for the move and wrong for the STAGING: a path
   * whose keys are computed purely geometrically can be placed inside a wall,
   * and nothing downstream will notice. MEASURED on verdant-1's 'open' crest:
   * the celebration orbit put every key inside the tower's copper spire (the
   * nearest mesh in front of the lens was 2.99 m at t=250 ms, 2.55 m at
   * t=500 ms) and Nim was off screen for the whole 2.2 s. Callers that build a
   * path now ask this before committing a key.
   *
   * @param {THREE.Vector3} origin  ray start (the SUBJECT, not the lens)
   * @param {THREE.Vector3} dir     unit direction toward the candidate key
   * @param {number} maxD           how far to look
   * @returns {number} distance to the first real occluder, or -1 when clear.
   *   Allocation-free; honest about an origin that starts inside geometry.
   */
  probeClear(origin, dir, maxD) {
    const bp = this._broadphase();
    if (!bp || !(maxD > 0)) return -1;
    // a staging probe starts wherever its subject is, not at the focus: cull the
    // occluder set around IT (the next _updateDistance re-culls around the focus)
    this._syncOccluders();
    if (this._occ.items.length) this._occ.cull(origin.x, origin.y, origin.z, maxD + TUNE.cam.collideRadius);
    return this._castOccluder(bp, origin, dir, maxD);
  }

  _updateCinematic(dt) {
    const c = this._cine;
    if (!c) return;
    if (!this._cineDone || c.loop) this._cineT += dt;
    const tEnd = c.times[c.n - 1];
    let t = this._cineT;
    if (c.loop && tEnd > 0) { t = t % tEnd; }
    else if (t >= tEnd) {
      t = tEnd;
      if (!this._cineDone) {
        this._cineDone = true;
        if (typeof c.onDone === 'function') { try { c.onDone(this); } catch (e) { console.error('[FollowCamera] onDone threw:', e); } }
      }
    }
    // locate the segment
    let i = 0;
    while (i < c.n - 2 && t >= c.times[i + 1]) i++;
    const t0 = c.times[i], t1 = c.times[Math.min(c.n - 1, i + 1)];
    const u = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 1;
    const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(c.n - 1, i + 1), i3 = Math.min(c.n - 1, i + 2);
    const P = c.pos, L = c.look;
    this._cinePos.set(
      catmull(P[i0 * 3], P[i1 * 3], P[i2 * 3], P[i3 * 3], u),
      catmull(P[i0 * 3 + 1], P[i1 * 3 + 1], P[i2 * 3 + 1], P[i3 * 3 + 1], u),
      catmull(P[i0 * 3 + 2], P[i1 * 3 + 2], P[i2 * 3 + 2], P[i3 * 3 + 2], u));
    if (c.lookPlayer[i1] === 1 || c.lookPlayer[i2] === 1) {
      _look.copy(this._focus);
    } else {
      _look.set(
        catmull(L[i0 * 3], L[i1 * 3], L[i2 * 3], L[i3 * 3], u),
        catmull(L[i0 * 3 + 1], L[i1 * 3 + 1], L[i2 * 3 + 1], L[i3 * 3 + 1], u),
        catmull(L[i0 * 3 + 2], L[i1 * 3 + 2], L[i2 * 3 + 2], L[i3 * 3 + 2], u));
    }
    this._cineFov = lerp(c.fov[i1], c.fov[i2], u);
    this._lookPt.copy(_look);
  }

  /** Pose the camera for the current mode. */
  _compose(dt) {
    const cam = this.camera;

    if (this._cine) {
      this._pos.copy(this._cinePos);
      if (cam) {
        cam.position.copy(this._pos);
        cam.up.copy(UP);
        cam.lookAt(this._lookPt);
        this._cineQuat.copy(cam.quaternion);
        cam.updateMatrixWorld(true);
      }
      return;
    }

    // the POSED heading: the orbit yaw plus the collision solver's slide
    headingFromYaw(this.yaw + this._yawSlide, _fwd);
    rightFromFwd(_fwd, _right);

    if (this._peekOn) {
      // first person from the head, looking along the orbit heading
      const p = this.player;
      const head = p && p.headPos;
      const src = this._heroSrc();
      if (head) this._pos.set(head.x, head.y - PEEK_EYE_DROP, head.z);
      else if (src) this._pos.set(src.x, src.y + TUNE.height - PEEK_EYE_DROP, src.z);
      const pp = this._peekPitch + this._shakePitch;
      const cpp = Math.cos(pp), spp = Math.sin(pp);
      this._lookPt.set(this._pos.x + _fwd.x * cpp, this._pos.y + spp, this._pos.z + _fwd.z * cpp);
    } else {
      // orbit: focus − fwd·cos(pitch)·dist + up·sin(pitch)·dist
      let pitch = this._pitchAim() + this._pPitchX + this._shakePitch;
      if (this._deathOn) {
        this._deathT = Math.min(1, this._deathT + dt / 0.5);
        pitch += DEATH_PITCH_LIFT * easeInOutSine(this._deathT);
      }
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      this._pos.set(
        this._focus.x - _fwd.x * cp * this.dist,
        this._focus.y + sp * this.dist,
        this._focus.z - _fwd.z * cp * this.dist);
      // AIM AT THE HERO, NOT AT THE FOCUS POINT (see LOOK_AIM_D0). Position,
      // fan origin and posed pitch are already decided above — this only
      // turns the lens, so it has no path back into the collision solver.
      const aimK = this._lookAimK;
      const aimSrc = aimK > 1e-3 ? this._heroSrc() : null;
      if (aimSrc) {
        this._lookPt.set(
          lerp(this._focus.x, aimSrc.x, aimK),
          lerp(this._focus.y, aimSrc.y + LOOK_AIM_H, aimK),
          lerp(this._focus.z, aimSrc.z, aimK));
      } else {
        this._lookPt.copy(this._focus);
      }
    }

    // shake translation in camera-right / up
    this._pos.addScaledVector(_right, this._shakeX);
    this._pos.y += this._shakeY;

    if (!cam) return;
    cam.position.copy(this._pos);
    cam.up.copy(UP);
    cam.lookAt(this._lookPt);
    if (this._shakeRoll !== 0) cam.rotateZ(this._shakeRoll);

    // blend out of a cinematic: slerp from the last path pose toward the follow pose
    if (this._cineBlendT >= 0) {
      const k = 1 - easeInOutSine(clamp(this._cineBlendT / CINE_BLEND_S, 0, 1));
      if (k > 1e-4) {
        _qA.copy(cam.quaternion);
        cam.quaternion.copy(_qA).slerp(this._cineQuat, k);
        _tmp2.copy(this._pos).lerp(this._cinePos, k);
        cam.position.copy(_tmp2);
        this._pos.copy(_tmp2);
      }
    }
    cam.updateMatrixWorld(true);
  }

  _updateFov(dt) {
    const cam = this.camera;
    const C = TUNE.cam;
    const p = this.player;

    let target, lam = FOV_LAMBDA;
    if (this._cine) {
      target = this._cineFov;
    } else if (this._peekOn) {
      target = C.peekFov; lam = FOV_PEEK_LAMBDA;
    } else {
      const speed = this._heroSpeed();
      const run = smoothstep(TUNE.speedWalk, TUNE.speedRun, speed);
      target = lerp(C.fov, C.fovRun, run);
      if (p && FOV_BOOST_STATES[p.state] === 1) target += FOV_MOVE_BOOST;
    }
    target += FOV_UNDERWATER * this._underwater;

    this._fovBase = dt > 0 ? damp(this._fovBase, target, lam, dt) : target;
    const wanted = this._fovBase + this._pFovX;
    this.fov = wanted;
    if (!cam || !cam.isPerspectiveCamera) return;
    if (Math.abs(wanted - this._fovApplied) > FOV_EPS) {
      cam.fov = wanted;
      cam.updateProjectionMatrix();
      this._fovApplied = wanted;
    }
  }

  _updateOutputs(dt) {
    const p = this.player;
    // Hero fade. Peek is the ONLY follow-family mode that may hide the hero
    // outright (it is first person — there is nothing to see but the inside of
    // his head). Everywhere else the fade is a ghost, capped below 1: the lens
    // may have to get closer than is comfortable, but a camera that leaves the
    // player in full control of a character they cannot see is not shippable.
    // It also starts far later than it used to — `minDist` (1.6 m) is the zoom
    // minimum, a perfectly ordinary framing distance with no near-plane risk,
    // and fading the hero to nothing there was the bug, not the safeguard.
    let fade = 0;
    if (this._peekOn) fade = 1;
    else if (!this._cine) {
      fade = HERO_FADE_MAX * (1 - smoothstep(FADE_FULL_DIST, FADE_START_DIST, this.dist));
      // …and inside the model itself, commit to first person (see FADE_FP_DIST).
      if (this.dist < FADE_FULL_DIST) {
        fade = lerp(HERO_FADE_MAX, 1, 1 - smoothstep(FADE_FP_DIST, FADE_FULL_DIST, this.dist));
      }
    }
    this._heroFade = fade;
    if (p) p.heroFade = fade;

    // underwater tell for the post chain
    const sub = !!(p && p.submerged);
    this._underwater = dt > 0 ? damp(this._underwater, sub ? 1 : 0, UNDERWATER_LAMBDA, dt) : (sub ? 1 : 0);
    if (this._underwater < 1e-3) this._underwater = 0;
    if (Math.abs(this._underwater - this._underwaterApplied) > 0.002) {
      const post = this._resolvePost();
      if (post) {
        this._underwaterApplied = this._underwater;
        try { post.setUnderwater(this._underwater); } catch (e) { this._post = null; }
      }
    }
  }

  _resolvePost() {
    if (this._post) return this._post;
    const p = this.player;
    const fx = p && p.fx;
    if (fx && typeof fx.setUnderwater === 'function') { this._post = fx; return fx; }
    if (fx && fx.post && typeof fx.post.setUnderwater === 'function') { this._post = fx.post; return fx.post; }
    const w = this.world;
    if (w && w.post && typeof w.post.setUnderwater === 'function') { this._post = w.post; return w.post; }
    return null;
  }

  /**
   * Normalise a pathDef into typed arrays (allocation happens here, at set
   * time — never per frame). Returns null on an unusable path.
   */
  _normalisePath(def) {
    let keys = null, loop = false, onDone = null;
    if (Array.isArray(def)) keys = def;
    else if (def.orbit) {
      const o = def.orbit;
      const n = 17;
      const c = [0, 0, 0]; readVec3(o.center, c, 0);
      const radius = +o.radius > 0 ? +o.radius : 4.0;
      const height = isFinite(+o.height) ? +o.height : 1.6;
      const dur = +o.duration > 0 ? +o.duration : 2.2;
      const turns = isFinite(+o.turns) ? +o.turns : 0.5;
      const y0 = isFinite(+o.startYaw) ? +o.startYaw : this.yaw;
      keys = new Array(n);
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const a = y0 + turns * Math.PI * 2 * k;
        headingFromYaw(a, _tmp);
        keys[i] = {
          p: [c[0] - _tmp.x * radius, c[1] + height, c[2] - _tmp.z * radius],
          look: [c[0], c[1] + height * 0.35, c[2]],
          t: dur * k, fov: o.fov,
        };
      }
      loop = !!def.loop; onDone = def.onDone || null;
    } else {
      keys = def.keys || def.cam || null;
      loop = !!def.loop; onDone = def.onDone || null;
    }
    if (!keys || keys.length === 0) return null;
    const n = Math.max(2, keys.length);
    const pos = new Float64Array(n * 3), look = new Float64Array(n * 3);
    const times = new Float64Array(n), fov = new Float64Array(n);
    const lookPlayer = new Uint8Array(n);
    let lastT = -1;
    for (let i = 0; i < n; i++) {
      const k = keys[Math.min(i, keys.length - 1)];
      readVec3(k.p || k.pos || k.position, pos, i * 3);
      const lk = k.look !== undefined ? k.look : k.lookAt;
      if (lk === 'player' || lk === undefined || lk === null) { lookPlayer[i] = 1; readVec3(null, look, i * 3); }
      else readVec3(lk, look, i * 3);
      let t = +k.t; if (!isFinite(t)) t = i * 1.0;
      if (i > 0 && t <= lastT) t = lastT + 1e-3;      // must ascend
      if (keys.length === 1 && i === 1) t = lastT + 1;
      times[i] = t; lastT = t;
      fov[i] = isFinite(+k.fov) ? +k.fov : TUNE.cam.fov;
    }
    // path times are relative to the first key
    const t0 = times[0];
    if (t0 !== 0) for (let i = 0; i < n; i++) times[i] -= t0;
    return { n, pos, look, times, fov, lookPlayer, loop, onDone };
  }

  /* ─────────────────────────── teardown ─────────────────────────── */

  dispose() {
    if (this.settings && typeof this.settings.off === 'function') {
      try { this.settings.off(this._onSettings); } catch (_) { /* no-op */ }
    }
    if (this.player && this.player.heroFade !== undefined) this.player.heroFade = 0;
    this._cine = null;
    this._post = null;
  }
}

export default FollowCamera;
