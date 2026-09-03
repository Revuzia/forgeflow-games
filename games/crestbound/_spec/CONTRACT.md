# CRESTBOUND — Module Contract (v1)

Third-person ANALOG 3D platformer (1996-analog-masterpiece movement bible, modern showcase
visuals). Three.js r172, ES modules, no build step, served static from
`games/crestbound/`. **This file is the integration contract.** Every module MUST match
these signatures exactly. Do not rename exports. Do not add cross-module imports beyond
those listed. When the contract and a sibling module disagree, the contract wins and the
sibling is fixed.

Names (fixed — never use Nintendo names anywhere, code or copy):
- hero **NIM** · collectible **CREST** (7 per course) · marked coins **SIGILS** (8 per course →
  1 Crest) · plain **COINS** (100 per course → 1 Crest) · hub **THE KEEP** · a course is a
  **COURSE**, a group of courses is a **REALM**.
- Realms: `verdant` VERDANT BAILEY · `ember` EMBER FOUNDRY · `rime` RIME SPIRE ·
  `azure` AZURE SANCTUM. Theme id `keep` for the hub.
- Chain critter = **GNASHER** (not chain-chomp), waddling patroller = **BUMBLER**, flyer =
  **SKITTER**, course boss = **WARDEN**, keep caretaker NPC = **OLD FEN**.

Import map (in index.html):
  "three"           -> ./assets/vendor/three/build/three.module.js
  "three/addons/"   -> ./assets/vendor/three/examples/jsm/

Units: 1 unit = 1 metre. +Y up. Right-handed. Yaw 0 faces **−Z** (three.js forward);
+yaw turns counter-clockwise seen from above (standard `Object3D.rotation.y`).
**Every module that converts an authored yaw uses `headingFromYaw(yaw, out)` in
core/util.js — one conversion, one place.**

Heritage: `games/ascendant/runtime/**` is the same studio's first-person obby. Its
engine-level modules (collider, collide, materials, builders, post, particles, decals,
audio, settings, engine, util, sky, props, hazards) are the STARTING POINT for the
identically-named modules here — port by transliteration (copy, rename ASCENDANT→
CRESTBOUND, storage keys `crestbound.*`, then extend per this contract). Do NOT re-invent
what Ascendant already proved; do NOT keep Ascendant behaviour this contract changes
(first-person viewmodel, eye height, pointer-lock-only input, the FP camera).

Global debug handle: `globalThis.CRESTBOUND = { engine, game, THREE, version }` set by
boot.js. Every harness reads it.

---
## 0. Global tuning (runtime/core/tuning.js) — SOURCE OF TRUTH

```js
export const TUNE = {
  // --- body ---
  radius: 0.38, height: 1.5, crouchHeight: 0.95, stepUp: 0.45,
  // --- gravity (asymmetric: rise slow, fall fast — kills float) ---
  gravRise: 34, gravFall: 46, gravPoundFall: 0,     // pound sets vy directly
  terminal: 60,
  // --- analog ground movement ---
  speedWalk: 3.2,          // stick magnitude 0.15..0.55
  speedRun: 9.0,           // stick magnitude 1.0 (keyboard = 1.0, W+A diag normalised)
  accelGround: 42,         // m/s² from rest  (~0.25 s to full run)
  decelGround: 64,         // release -> stop  (< 0.16 s from full run)
  turnRateSlow: 14,        // rad/s below 3 m/s  (snappy)
  turnRateFast: 4.2,       // rad/s at full run   (wide arc)
  reverseSnapDot: -0.55,   // wish·vel below this at speed => pivot (stop + turn) instead of arc
  // --- air ---
  accelAir: 22, airTurnRate: 3.0, airDrag: 0.12,
  airSpeedCapBonus: 1.5,   // air speed cap = max(launchSpeed, speedWalk) + bonus
  // --- jump family (vertical launch speeds, m/s) ---
  jumpV: [11.4, 13.3, 15.6],   // single/double/triple: apex 1.91 / 2.60 / 3.58 m
  jumpCut: 0.5,                // vy *= jumpCut on early release while rising
  jumpHoldMin: 0.06,           // seconds the full jumpV is guaranteed regardless of release
  tripleWindow: 0.30,          // seconds after landing to chain the next jump
  tripleMinSpeed: 4.0,         // horizontal speed needed to chain
  coyote: 0.09, buffer: 0.11,
  landLag: 0.05, hardLandLag: 0.20, hardLandSpeed: 22,   // fall speed for a hard landing
  longJump: { vy: 8.5, fwd: 17.0, minSpeed: 5.5 },       // crouch+jump at speed
  backflip: { vy: 14.8, back: 4.0 },                      // crouch+jump from (near) rest
  sideflip: { vy: 14.3, lateral: 5.0, reverseDot: -0.6 }, // reverse stick + jump at speed
  wallKick: { vy: 12.0, away: 7.5, window: 0.15, lockout: 0.28, minFall: -1.0 },
  dive: { fwd: 13.5, vy: 4.5, minSpeed: 3.0, slideFriction: 6.0, slideMinTime: 0.18,
          hopV: 8.0 },                                    // jump-cancel from belly slide
  pound: { hang: 0.20, fall: 40, shockRadius: 2.2, bounceV: 14.0, jumpWindow: 0.15 },
  slope: { slideDeg: 38, iceSlideDeg: 20, accel: 22, maxSpeed: 16, recoverJumpV: 10.5 },
  swim: { speed: 4.5, accel: 8, rise: 3.2, sink: 1.2, surfaceJumpV: 9.0, drag: 2.2,
          diveV: 6.0 },
  climb: { speed: 2.6, kickV: [7.0, 11.0], radius: 0.55 },  // poles/nets/trees
  ice: { accel: 9, friction: 1.6 },
  conveyorMax: 8.0,
  bounceDefaultApex: 4.0,
  // --- camera ---
  cam: { dist: 6.8, minDist: 1.6, height: 1.55, shoulder: 0.35, fov: 58, fovRun: 63,
         lagPos: 9, lagYaw: 5, autoYaw: 1.3, pitchMin: -0.55, pitchMax: 0.95,
         defaultPitch: 0.22, orbitSpeedKey: 2.4, orbitSpeedMouse: 0.0024,
         collideRadius: 0.35, recenterTime: 0.35, peekFov: 70 },
};
```
Derived REACH (published in tuning.js as `REACH_TABLE`, computed by `simulateJump()`;
the numbers below are the design target — tuning.js prints the exact ones, and
`_harness/reachcheck.mjs` uses the exact ones):

| move | flat gap max | **safe (author to this)** | +up reach (safe) | needs run-up |
|---|---|---|---|---|
| single jump @ run | ~5.6 m | **4.6 m** | +1.6 m (1.4) | no |
| double jump | ~6.5 m | **5.4 m** | +2.3 m (2.0) | 1 landing |
| triple jump | ~7.7 m | **6.4 m** | +3.3 m (3.0) | 2 landings, ≥ 6 m straight |
| long jump | ~7.9 m | **6.8 m** (10 m on a −2 m drop) | +0.8 m | ≥ 6 m straight |
| backflip | 0 m | — | +3.0 m (2.6) | no (from rest) |
| sideflip | ~2 m | — | +2.8 m (2.5) | reverse |
| wall kick (per kick) | — | — | +2.0 m per kick, shaft ≤ 3.4 m wide | air + wall |
| pound-jump | — | — | +2.7 m | after pound |
| dive from run | +3.3 m onto a jump | extends any jump ~2.5 m | — | speed ≥ 3 |

Course authors: a REQUIRED path may only use single-jump-safe gaps unless the approach
gives the run-up in the last column. Optional/coin/crest lines may use anything in the
table. `reachcheck.mjs` enforces this on every course (it knows approach lengths).

### tuning.js exports
```js
export const TUNE;                                    // above
export const SIM_DT = 1/240;
export function applyGravity(vy, dt, rising?) -> vy;  // THE gravity function
export function simulateJump({v0, fwd, dy, drag?}) -> {gap, apex, airtime}; // exact integration
export const REACH_TABLE;   // {single:{rows:[{dy,max,safe}]}, double, triple, longjump, backflip, sideflip, wallkick, poundjump, dive}
export function bestGap(dy, runup) -> {move, safe, max};  // best legal move for a gap with `runup` metres of straight approach
export function apexFor(v0) -> metres;  export function launchVelocityForApex(m) -> v0;
export const LAND_SOFT = 8, LAND_HARD = TUNE.hardLandSpeed;
export function headingFromYaw(yaw, out) ; // re-exported from util for validators
```

---
## 1. runtime/core/util.js  (port Ascendant util.js verbatim, ADD:)
```js
export function headingFromYaw(yaw, out=new THREE.Vector3()) -> out.set(-sin(yaw), 0, -cos(yaw));
export function yawFromHeading(x, z) -> Math.atan2(-x, -z);
export function dampVec3(cur, target, lambda, dt);   // in place
export function moveTowardAngle(a, b, maxDelta);
export class Ring { constructor(n); push(v); at(i); length; }   // fixed ring buffer (death rewind)
```
Everything else exactly as Ascendant: clamp, lerp, damp, dampAngle, smoothstep, ease*,
mulberry32, hashString, Pool, Emitter, fmtTime, RollingAverage, numOr, …

## 2. runtime/core/settings.js  (port; storage key `crestbound.settings`)
```js
export const QUALITY = { low, medium, high, ultra };   // {dpr, shadowMap, bloom, smaa, ssao, particles, decor, shadowDistance, grass}
export const Settings = { get(), set(patch), quality(), on(fn), off(fn), reset() };
// fields: quality:'high', camSensX:1.0, camSensY:1.0, invertX:false, invertY:false,
//         camMode:'follow'|'free', master:0.8, music:0.6, sfx:0.9, showTimer:true,
//         hudScale:1, gamepadVibrate:true, reduceMotion:false
export function detectQuality();
```

## 3. runtime/core/save.js  (NEW schema, key `crestbound.save.v1`)
```js
export const Save = {
  load(), reset(), get persistent(), get recovered(),
  course(courseId) -> {crests:[crestId], coinsBest:int, cleared:bool, deaths:int, bestMs:{crestId:ms}},
  collectCrest(courseId, crestId), setCoinsBest(courseId, n), addDeath(courseId),
  setBestMs(courseId, crestId, ms),
  crestTotal() -> int,                 // gates unlock on this
  unlockedGates(keepDef) -> [gateIndex],
  totals() -> {crests, deaths, timeMs, coins, coursesCleared},
  checkpoint(courseId) -> int|null,   // last checkpoint of the CURRENT session only (not persisted across loads)
  setCheckpoint(courseId, idx), clearCheckpoint(courseId),
  flags: {get(k), set(k,v)},           // misc persisted flags (seenIntro, keepDoorOpen…)
};
```

## 4. runtime/core/input.js  (NEW — analog third-person)
```js
export const ACTIONS = ['jump','crouch','dive','pound','orbitLeft','orbitRight','orbitUp','orbitDown',
  'recenter','peek','interact','pause','restart','toCheckpoint','mute','fullscreen','dev','camToggle'];
export const DEFAULT_BINDINGS = { // KeyboardEvent.code
  moveForward:['KeyW','ArrowUp'], moveBack:['KeyS','ArrowDown'], moveLeft:['KeyA','ArrowLeft'], moveRight:['KeyD','ArrowRight'],
  jump:['Space'], crouch:['ControlLeft','KeyC','ShiftLeft'], dive:['KeyF','KeyX'], pound:['ControlLeft','KeyC'],  // pound = crouch while airborne
  orbitLeft:['KeyQ'], orbitRight:['KeyE'], orbitUp:['KeyR'], orbitDown:['KeyV'], recenter:['KeyZ'], peek:['KeyG'],
  interact:['KeyE'], pause:['Escape'], restart:['KeyR'], toCheckpoint:['KeyT'], mute:['KeyM'], fullscreen:['F11'], dev:['Backquote'], camToggle:['KeyB'],
};
export class Input {
  constructor(domElement);
  update(dt);                 // once per frame BEFORE player.update
  move: {x, y, mag}           // ANALOG stick vector in CAMERA-RELATIVE input space (x right, y forward), mag 0..1.
                              // Keyboard: keys ramp 0→1 over 0.09 s and 1→0 over 0.06 s (so tapping produces a WALK), diagonals normalised.
                              // Gamepad left stick with radial deadzone 0.15 and outer 0.95.
  look: {dx, dy}              // orbit delta THIS FRAME in radians (mouse drag / pointer lock / right stick / Q-E keys), already sens+invert scaled
  jump, jumpPressed, jumpReleased, jumpHeld
  crouch, crouchPressed, dive, divePressed, pound, poundPressed, recenterPressed, peek, interactPressed
  pausePressed, restartPressed, toCheckpointPressed, camTogglePressed
  gamepad: {connected, id}    // rumble(strong, weak, ms)
  pointerLocked; requestLock(); releaseLock();
  suspended;                  // menus open: gameplay actions read false, MENU actions still fire
  on(evt, fn);                // 'lock','unlock','gamepadconnected','anykey'
  bindings; rebind(action, codes);
  __test: { press(code), release(code), stick(x,y), look(dx,dy) }   // harness drives REAL KeyboardEvents where possible; stick() is the analog injection point
}
```
Mouse: left-drag orbits when not locked; clicking the canvas during play requests
pointer lock (optional — the game is fully playable without it). Right-stick / Q-E always work.

## 5. runtime/core/audio.js  (port Ascendant; procedural Web Audio; NO audio files)
```js
export class Audio {
  constructor(); init();                 // on a user gesture
  setTheme(themeId);                     // 'keep'|'verdant'|'ember'|'rime'|'azure' music bed crossfade 1.2 s
  setMood(mood);                         // 'explore'|'danger'|'underwater'|'clear'|'boss' — filter/intensity layer on the bed
  sfx(name, opts?);                      // names below
  setVolumes({master,music,sfx}); duck(ms); stopAll();
  stinger(name);                         // 'crest','courseClear','death','checkpoint','unlock','sigilsDone','coins100'
}
```
SFX names (all must exist): jump1 jump2 jump3 longjump backflip sideflip wallkick dive slide
pound_hang pound_land land_soft land_hard step_grass step_stone step_metal step_snow step_sand
step_wood step_ice splash swim_stroke surface coin sigil crest checkpoint death lava_bubble
crusher_slam bounce vanish_warn gnasher_bite bumbler_squish skitter warden_hit warden_roar
gate_open painting_enter ui_move ui_ok ui_back cannon_fire ring_pass wind

## 6. runtime/core/engine.js  (port; strip overlay/viewmodel; add shadow follow)
```js
export class Engine {
  constructor(container);
  renderer, scene, camera, composer, clock, size:{w,h}, post, sun (DirectionalLight, CSM-lite: follows the player), hemi, ambient;
  setTheme(theme);            // ThemeDef -> fog/bg/env/tonemap/grade/bloom/sun
  render(dt); resize(); onFrame(fn); offFrame(fn); start(loopFn);   // dt clamped <= 1/20
  followShadow(pos);          // moves the sun's shadow frustum with the player (every frame)
  stats: {fps, drawCalls, tris, frameMs, p99Ms}
}
```
Renderer: antialias:false, powerPreference 'high-performance', outputColorSpace SRGB,
ACESFilmic, shadowMap PCFSoft 2048 (high) / 1024 (medium), DPR ≤ 1.5.

## 7. runtime/fx/post.js  (port; remove ViewmodelPass)
Chain: RenderPass → Bloom (quality) → FinishPass (grade lift/gamma/gain, saturation, tint,
vignette, chroma, grain, flash pulse, damage vignette, heat shimmer, **underwater tint+wobble**)
→ FXAA|SMAA. API as Ascendant plus `setUnderwater(v01)`, `setSpeedLines(v01)`.

## 8. runtime/fx/particles.js + impacts.js + decals.js  (port; ADD presets)
Burst presets (all must exist): land, hardLand, jump, jump3, longjump, dive, slideDust,
pound, poundShock, wallkick, death, deathRewind, checkpoint, coin, sigil, crest,
crestGrand, courseClear, splash, bubbles, lavaPop, iceShard, dust, snowPuff, sandPuff,
spark, gateOpen, paintingRipple, gnasherBite, squish, ringPass, wingGust.
Ambient: ember, snow, mote, pollen, spray, sandDust, aurora, leaves.
```js
export class ParticleSystem { constructor(scene, quality); burst(preset, pos, opts?); ambient(preset, box, rate); update(dt, camPos); setQuality(q); dispose(); }
export class Trail { … }            // ribbon trail (long jump / dive / speed)
export class Impacts { constructor(ps, audio, camera, decals); land(v, surface, pos, normal); death(cause, pos); collect(kind, pos); pound(pos); … }
```

## 9. runtime/world/collider.js  (port; ADD Heightfield + raycast)
```js
export class Collider { … as Ascendant (oriented box, surface, ref, props, active, solid, group, aabb, update(), velocityAt()) }
export class KillVolume { … kind:'lava'|'void'|'spike'|'crush'|'saw'|'toxic'|'gnasher'|'warden' }
export class Volume  { constructor({center, half, quat?, kind:'water'|'quicksand'|'wind'|'current'|'ladder'|'checkpoint'|'trigger'|'coinsField', props}); contains(p); }
export class Heightfield {
  constructor({originX, originZ, sizeX, sizeZ, nx, nz, heights:Float32Array, surface='grass', id});
  heightAt(x, z) -> number|NaN;                  // bilinear; NaN outside
  normalAt(x, z, out) -> out;                    // analytic from neighbours
  raycast(origin, dir, maxDist, out) -> number|-1;  // march, for the camera
  aabb; active; surface; props; ref;
}
export class Broadphase {
  constructor(cellSize=6); add(c); remove(c); refresh(c); query(aabb, out) -> Collider[]; count;
  addHeightfield(h); heightfields:[Heightfield];
  raycast(origin, dir, maxDist, out:{t, normal, collider}) -> bool;   // boxes + heightfields, allocation-free (camera + probes)
}
export const Scratch;  export function inflatedHalf(c, playerHalf, out);
```

## 10. runtime/player/collide.js  (port; extend)
```js
export function moveAndCollide(state, world, dt) -> CollisionResult;
// state: {pos (FEET), vel, radius, height, crouching, grounded, jumped, poundFalling}
// world: {broadphase, killVolumes, volumes}
// CollisionResult = {grounded, groundNormal, groundCollider, groundHeightfield, groundSlopeDeg, ceiling,
//   walls:[{normal, collider}], platformVel, surface, surfaceProps, stepped, crushed, hitVel,
//   kill (KillVolume|null), inWater (Volume|null), waterSurfaceY, inQuicksand, wind (Volume|null), ladder (Volume|null), stepUpBlocked}
```
Rules as Ascendant (swept, per-axis, iterated, no tunnelling, seam-jitter-free, carry by
mover motion, crush) PLUS: heightfield ground = `max(boxFloor, hf.heightAt)` with
the heightfield's analytic normal; ground snap 0.18 m; steep ground (> slope.slideDeg
for the surface) reports grounded=true + `groundSlopeDeg` so the controller slides
rather than the resolver blocking; ceiling bonk cancels vy.

## 11. runtime/player/controller.js — THE GAME LIVES HERE
```js
export class Player {
  constructor(world, input, audio, fx, cameraRef);   // cameraRef.yaw gives camera-relative movement
  pos, vel, facing (yaw rad), grounded, dead, state, stateT, anim, animT, speed, jumpCount, wallN,
  onGround, inWater, submerged, surface, crouching, sliding, carried;
  spawn(pos, yaw); respawn(pos, yaw); update(dt); kill(cause); setWorld(world);
  events;   // Emitter: 'jump'(kind), 'land'(impactSpeed, surface, hard), 'step'(surface), 'death'(cause), 'wallkick', 'dive', 'pound'(pos), 'poundLand'(pos),
            //          'splash'(entering), 'surface', 'bounce', 'slide', 'longjump', 'backflip', 'sideflip', 'bonk'(pos, wallN), 'checkpoint'(idx), 'collect'(kind, id), 'climbStart', 'climbEnd', 'cannonEnter', 'ringPass'
  get renderPos();  get feetPos();  get headPos();  get capsule();
  history: Ring;   // last 0.4 s of {x,y,z,facing} at 60 Hz for the death rewind
  __test: { teleport(v), setVel(v), state(), setFacing(yaw), force(stateName) };
}
```
STATES (a real state machine; `anim` is what hero.js plays):
`idle run skid pivot bonk crouch crouchwalk jump1 jump2 jump3 longjump backflip sideflip fall
dive slide slideRecover wallslide wallkick poundHang poundFall poundLand land hardLand
slopeSlide swimIdle swim swimDive climb climbKick cannon fly dead`.

Movement bible — every line is measured by `_harness/feelcheck.py`:
- ANALOG: stick magnitude maps to speed continuously (walk ↔ run); turn rate scales with
  speed (slow = snappy, fast = wide arc); reversing at speed produces a `pivot` (skid dust,
  0.12 s) not a slow arc; keyboard taps walk. Braking uses `decelGround` whenever the stick
  asks for LESS than the current speed (not only at zero), so release-to-rest from a full
  run is ≤ 0.16 s even while a keyboard ramp-down decays the stick over 0.06 s.
  THE BRAKE POSE COVERS THE BRAKE: `skid` is entered on DECELERATION (the stick
  asking for materially less than the carried speed), not only at stick zero, and
  holds down to `SKID_SPEED` — the hero is never in `idle` while still moving
  faster than he can walk.
- MOMENTUM — A LAUNCH IS A COMMITMENT: airborne horizontal speed is CAPPED and
  FLOORED off the launch speed (`AIR_KEEP_FRAC`). The stick may steer at full
  `airTurnRate` and shed a little over half the launch, never the launch itself;
  only the world (a wall, a bonk, a pound) may take the rest. A mistimed jump is
  therefore punished and no jump is ever cancelled in mid-air.
- BONK: grounded and holding the stick into a wall that will not move (wish · −wallN ≥ 0.5)
  with the achieved speed collapsed under the stick's ask → the `bonk` state: a recoil, a
  palms-on-the-wall press with scuffing boots, impact dust and a thump. The run cycle never
  plays on the spot against a wall.
- TRIPLE: land → jump within `tripleWindow` with speed ≥ `tripleMinSpeed` chains 1→2→3;
  jump3 has a flip; any landing without a prompt jump resets the chain. Held jump = full
  height; release above `jumpHoldMin` cuts vy by `jumpCut`.
- LONG JUMP: crouch+jump with speed ≥ `longJump.minSpeed` → vy 8.5, horizontal set to
  `fwd` along facing; air control reduced (×0.35) so it never fights the camera.
- BACKFLIP: crouch+jump at speed < 2 → up 14.8, drift back 4. SIDEFLIP: stick reversed
  (dot < `sideflip.reverseDot`) + jump within 0.12 s of the reversal.
- WALL KICK: airborne, wall contact (|n.y| < 0.4) within `wallKick.window`, jump →
  vy 12, away 7.5, facing flips to the wall normal; `lockout` before another kick; spark VFX.
- DIVE: dive button with speed ≥ `dive.minSpeed` (ground or air) → fwd 13.5, vy 4.5,
  belly slide on land (friction 6); jump during slide → `hopV` bounce; slide into a wall
  → recover (0.25 s stun). Diving with the pound button held is NOT a pound.
- GROUND POUND: crouch/pound in air → 0.2 s hang (vel zeroed, spin), then vy −40; on
  land: shock burst, 0.12 s stun, breaks `breakable` colliders, bounces on `bounce`
  surfaces; jump within `pound.jumpWindow` → pound-jump vy 14.
- SLOPES: ground slope > `slideDeg` (or `iceSlideDeg` on ice) → `slopeSlide`: accelerate
  down-slope 22 m/s², max 16; jump recovers (vy 10.5, keeps slide speed).
- WATER: inside a 'water' Volume → swim: analog surface speed 4.5, jump = stroke (+rise),
  crouch = sink, surfaced + jump = `surfaceJumpV` hop; camera reports `underwater`.
- CLIMB: overlap a 'ladder' Volume (poles/nets/trees) while airborne or pressing into
  it → climb (speed 2.6 vertical, orbit around poles), jump → kick off (kickV).
- COYOTE 0.09 s, BUFFER 0.11 s, landing lag 0.05 s (0.20 s hard landing ≥ 22 m/s only
  from FALLS, never from the jump family).
- NEVER floaty: apex of a single jump ≤ 0.34 s after take-off.
- Fixed 1/120 s substep; `renderPos` interpolated; zero per-frame allocation.

## 12. runtime/player/camera.js  (NEW — third-person orbit)
```js
export class FollowCamera {
  constructor(camera, player, input, world, settings);
  yaw, pitch, dist, mode:'follow'|'free'|'peek'|'cinematic'|'death';
  update(dt);
  // orbit follow behind the hero with shoulder offset; position lag so the hero LEADS;
  // auto-yaw toward the run direction at `autoYaw` rad/s only when no manual orbit in last 1.2 s;
  // collision: broadphase.raycast from focus to desired pos, pull in to hit-collideRadius, ease back out over 0.6 s;
  // a SHAFT (blocked at every yaw at once — a chimney narrower than 2*minDist) is
  //   answered by TILTING, not by pulling in through the hero: over-the-head, then
  //   up-the-shaft, so `dist` stays >= minDist wherever any pose can hold it. The
  //   tilt is not frozen by the committed-move rule below — that rule is about YAW,
  //   which steers; elevation steers nothing, and wall kicks are where it is needed;
  // during longjump/dive/wallkick/pound: freeze auto-yaw (never fight the player);
  // recenter (Z / stick click): ease behind the hero in `recenterTime`;
  // peek (hold G / LB): first-person from the head, hero hidden, look with orbit input;
  // underwater: fov +4, murk; death: hold + slow orbit; cinematic(path) for course intro/crest celebrate.
  recenter(); shake(amount, ms); punch(amount); setCinematic(pathDef|null); setDeathCam(bool);
  get forwardFlat(); get yawForMovement();
}
```

## 13. runtime/player/hero.js  (NEW — procedural stylised rigged NIM)
```js
export class Hero {
  constructor(scene, mats, quality);
  root;                                       // THREE.Group at player.renderPos, rotation.y = facing
  update(dt, player);                         // pose blend from player.anim/animT/vel/grounded
  setTheme(theme); setVisible(v); setPower(powerId|null);
  shadowBlob;                                 // soft radial plane, projected onto the ground below
}
```
Nim is a stylised explorer (big round head ~0.5 m, goggles pushed up on the brow, scarf,
small backpack, chunky boots, mitten hands) built from bevelled/lathe/capsule PBR parts,
skinned via a bone hierarchy of Object3Ds (hips, spine, chest, neck, head, shoulders,
upper/lower arms, hands, upper/lower legs, feet). ANIMATION: procedural cycles per
state (run cycle phase = distance travelled; arm swing; head lean into turns; jump tuck;
jump3 somersault; long-jump superman stretch; backflip; sideflip cartwheel; dive belly;
slide; pound spin + fist; wall-slide brace; swim stroke; climb; idle breathe + look-
around after 4 s), blended with critically-damped springs; squash (land 0.85) / stretch
(jump 1.12); scarf = 7-link verlet chain with gravity + wind + velocity drag; eyes
blink. NO single-primitive hero (doctrine). Casts a real shadow AND has the blob.

## 14. runtime/world/materials.js  (port; ADD keys)
Keys (all must exist): stone metal panel grate ice glass emissive lava obsidian crystal
wood sand neon checker hazard rubber conveyor cloud **grass dirt plaster brick bark
leaves snow water gold cloth painting marble moss copper rope**.
`Mats.get(key, themeId)` cached+shared; world-space box projection as Ascendant;
`grass`/`snow`/`sand` are the heightfield materials and blend by slope (grass→dirt on
steep). `water` is a Gerstner/ripple ShaderMaterial (see water.js) — `Mats.get('water')`
returns the shared instance with `uTime`.

## 15. runtime/world/themes.js  (5 dioramas)
```js
export const THEMES = { keep, verdant, ember, rime, azure };
// ThemeDef = { id, name, fog:{color,near,far}, bg, sky:{type:'day'|'sunset'|'furnace'|'aurora'|'sanctum', params},
//   lights:{key:{color,intensity,dir}, fill, rim, ambient, hemi}, envIntensity, exposure,
//   grade:{lift,gamma,gain,saturation,vignette,chroma,tint}, bloom:{strength,radius,threshold},
//   palette:{safe, safeEdge, kill, killGlow, checkpoint, checkpointOn, crest, sigil, coin, accent, deco, water},
//   particles:{ambient:[{preset, rate}]}, materialOverrides:{}, music:{key, scale, bpm, mood},
//   timeOfDay: 'morning'|'noon'|'dusk'|'night'|'furnace' }
export function applyTheme(engine, themeId);
```
READABILITY LAW: walked surface ≥ 3.5:1 luminance contrast vs the fog band behind it
(measured by `_harness/contrastcheck.py`); kill surfaces hot-emissive and animated;
checkpoint / crest / sigil / coin each a unique, unmistakable silhouette + pulse.

## 16. runtime/world/sky.js  (port; add 'day','sunset','furnace','aurora','sanctum' domes + sun disc + clouds layer + god-ray sprite for Keep windows)

## 17. runtime/world/builders.js  (port verbatim + extend)
Adds: `buildStairs`, `buildRamp` (sloped collider), `buildTree` (trunk+canopy, climbable
option), `buildPole`, `buildNet`, `buildBridge` (planks+rope), `buildPainting` (frame +
shimmer material + course thumbnail canvas), `buildGateDoor`, `buildPedestal`,
`buildFence`, `buildRock`, `buildCannon`, `buildRing`. Every landable surface a jump
reaches gets `edgeStripe` in `palette.safeEdge`.

## 18. runtime/world/terrain.js  (NEW)
```js
export function buildTerrain(def, theme, mats, quality) -> {mesh, heightfield, grass:InstancedMesh|null, bounds};
// def = {kind:'terrain', origin:[x,z], size:[sx,sz], res:1.0, heights:'fn'|Float32Array|{seed, base, hills:[{p,r,h}], flats:[{p,r,h}], ridges:[…]}, surface:'grass'|'snow'|'sand', grass:{density, height, color}, paths:[{pts, w}]}
```
Grass = instanced quad-cross blades with wind sway shader (30k at high, 8k at low),
colour varied by heightfield sample; terrain material blends grass/dirt by slope.

## 19. runtime/world/water.js  (NEW)
```js
export function buildWater(def, theme, mats) -> {mesh, volume:Volume, surfaceY, update(t)};
// def = {kind:'water', p, s, flow?:[x,z], kind2:'lake'|'sea'|'pool'|'lava'?}  — lava uses hazards/lava.js, not this
```
Vertex Gerstner (3 waves) + fresnel + refraction tint + foam at shore (depth fade), caustic
scroll on the floor material below via `Mats.get('sand')` uniform.

## 20. runtime/world/props.js  (port; add keep props + realm deco kinds)

## 21. runtime/hazards/index.js
```js
export const HAZARDS = { mover, vanish, rotor, pendulum, crusher, lava, risinglava, spikes, jumppad, speedpad,
  conveyor, ice, wind, chase, beam, breakable, sinker, seesaw, cannon, rings, current, quicksand, flame, sandboard, mill };
export function makeHazard(kind, def, ctx) -> Hazard;
export class Hazard { mesh; colliders; kills; volumes; update(t, dt, player); reset(t); onStand(player); onPound(player); dispose(); }
```
DETERMINISM LAW as Ascendant: state is a pure function of the course clock `t` and `def`.
`reset(t)` places exactly where `update(t)` would.

## 22. runtime/entities/collectibles.js  (NEW)
```js
export class Collectibles {
  constructor(courseDef, ctx);   // builds coins (instanced), sigils (8), crests (7 — some hidden until spawned)
  update(dt, player);            // magnet radius 1.3 m coins, collect on capsule overlap, spin/bob, cull
  collect(kind, id); spawnCrest(crestId, pos); reset(); dispose();
  counts: {coins, coinsTotal, sigils, crests};
  events;  // 'coin'(n), 'sigil'(n), 'sigilsDone', 'coins100', 'crest'(crestDef)
}
```
Crest types (def.type): `open` (placed), `sigils` (spawns when 8 sigils collected),
`coins` (spawns at 100 coins — or def.threshold), `secret` (hidden/cage/box: spawns on
`trigger` id), `boss` (spawns when the Warden dies), `race` (timed: start pad → finish
pad in `limitMs`), `power` (needs the course's power hat active). Grand pedestal
celebration on every crest; the first crest of a course also marks it `cleared`.

## 23. runtime/entities/critters.js  (NEW)
```js
export const CRITTERS = { gnasher, bumbler, skitter, warden, fen };
export function makeCritter(def, ctx) -> Critter;  // {mesh, update(dt, player), kills, colliders, onPound(), onDive(), reset(), dispose()}
```
gnasher: chained to a post, lunges at the player inside its radius (telegraph: crouch 0.5 s
then lunge), chain length in def; pounding its post 3× frees it (secret trigger).
bumbler: waddling patroller on a path; touching it from the side = knockback 6 m/s + 0.4 s
stun (NO instant death — fair); landing on it or pounding = squish + 3 coins.
skitter: flying, sine path, swoops.
warden: 3-hit mini-boss with readable telegraphs (stomp shockwave: jump it; charge: sidestep;
dizzy 2.5 s after a charge hits a wall → pound its back). Dies → `boss` crest spawns.
Models: build procedurally (multi-part, articulated, doctrine) OR load a CC0 Quaternius
GLTF from `pipeline/assets/3d-models/quaternius/**` copied into `assets/critters/` (≤ 2 MB
each, strip embedded lights, repair materials).

## 24. runtime/world/course.js  (Stage → Course)
```js
export class Course {
  constructor(def, engine, ctx); static async load(def, engine, ctx) -> Course; static validate(def);
  group; broadphase; killVolumes; volumes; hazards; critters; collectibles; checkpoints; terrain; waters; gates (keep only); def; clock; bounds;
  update(dt, player); reset(); resetFrom(cpIndex); spawnFor(cpIndex) -> {pos, yaw}; dispose();
  nearestCheckpoint(pos); setPlayer(player);
}
```
Static geometry merged per material + chunk (`mergeStatic`), decor instanced, frustum cull
by chunk. Course load ≤ 1.5 s on the reference machine.

## 25. Course data format (runtime/data/courses/*.js)
```js
export default {
  id:'verdant-1', realm:'verdant', theme:'verdant', name:'BAILEY MEADOW', subtitle:'…', order:1,
  difficulty:1, par:{ open: 45000, … },                    // ms per crest id (optional)
  spawn:{p:[x,y,z], yaw:0}, killY:-30, bounds:{min:[…], max:[…]},
  intro:{cam:[{p, look, t}], text:'…'},                     // optional cinematic on first entry
  checkpoints:[ {p, yaw, id:'cp1'} … ],                     // ≥ 3 on a full course
  crests:[ {id:'open', type:'open', name:'CREST ON THE RAMPARTS', p:[…]},
           {id:'sigils', type:'sigils', name:'EIGHT SIGILS OF THE MEADOW', spawnAt:[…]},
           {id:'coins', type:'coins', name:'A HUNDRED COINS', threshold:100},
           {id:'secret', type:'secret', name:'…', trigger:'gnasher-freed', spawnAt:[…]},
           {id:'boss', type:'boss', name:'…', spawnAt:[…]},
           {id:'race', type:'race', name:'…', start:[…], finish:[…], limitMs:60000, spawnAt:[…]},
           {id:'wing', type:'power', name:'…', power:'wing', p:[…]} ],
  sigils:[ {p} ×8 ], coins:[ {p} | {ring:{c, r, n, y}} | {line:{a, b, n}} … ],   // ≥ 100 coins reachable
  terrain?: TerrainDef, waters?:[WaterDef],
  objects:[ ObjectDef… ],       // Ascendant §18 family + new kinds below
  critters:[ {kind:'gnasher', p, chain:6, post:[…]}, {kind:'bumbler', path:[…]}, {kind:'warden', p, arena:{c, r}} ],
  powers?:[ {kind:'wing'|'metal'|'vanish', p, duration:30 } ],
  music:'verdant', ambience:{…},
};
```
New ObjectDef kinds (on top of Ascendant's platform beam mover vanish rotor pendulum
crusher laser lava spikes jumppad speedpad conveyor ice wind chase deco text light):
```
{kind:'terrain', …}  {kind:'water', …}  {kind:'ramp', p, s, rot, mat}  {kind:'stairs', p, w, rise, run, n, mat}
{kind:'tree', p, h, r, climbable?}  {kind:'pole', p, h, r}  {kind:'net', p, s, rot}  {kind:'bridge', a, b, w, sag}
{kind:'painting', p, yaw, course, w, h, locked?}   (keep)   {kind:'gatedoor', p, yaw, w, h, requires:{crests:N}, course?}
{kind:'pedestal', p}  {kind:'fence', a, b}  {kind:'rock', p, r, seed}  {kind:'cannon', p, yaw, pitch, power, target?}
{kind:'rings', pts:[…], r}  {kind:'current', p, s, dir, power}  {kind:'quicksand', p, s}  {kind:'flame', p, cycle}
{kind:'sandboard', a, b, w}  {kind:'mill', p, arms, len, period}  {kind:'seesaw', p, s, axis}  {kind:'sinker', p, s, delay, speed}
{kind:'breakable', p, s, mat, drop?:'coins'|'crest'}  {kind:'beam', a, b, cycle}  {kind:'building', p, s, style:'fort'|'cottage'|'tower'|'temple'|'foundry', doors:[…]}
```
Coordinates: courses are OPEN dioramas (not linear +X). `bounds` is authoritative for
culling and the minimap. Every landable surface a player must jump to is
`stripe:true`; decorative geometry is never mistakable for a platform.

## 26. Keep data (runtime/data/keep.js)
`{ id:'keep', isHub:true, theme:'keep', spawn, checkpoints (room entrances), objects (lobby
hall, grand stair, upstairs wing, basement, courtyard, tower, at least 8 painting gates + 3
locked late gates + 1 finale gate), gates:[{course, p, yaw, kind:'painting'|'door'|'glass',
requires:{crests:N}}], npcs:[{kind:'fen', p, lines:[…]}], secrets:[…], coins: [] }`.
Walking into a painting (or through an unlocked door) shows the course card (ui) then
loads the course. Gates with `requires` above the save's crest total are sealed (visible,
readable "N crests" sign, shimmer locked).

## 27. runtime/ui/*
```js
export class HUD { constructor(root, game); update(dt, snap); toast(text, sub?, kind?); crestGet(def); checkpointFlash(); deathFlash(cause); courseClear(summary); setVisible(v); }
// snap = {courseName, realmName, crests, crestsTotal, crestIds:[{id, got}], coins, sigils, sigilsTotal, timeMs, sessionMs, deaths, cpIndex, cpCount, power:{id, t}|null, raceMs|null, warden:{hp}|null, speed}
export class Menu { constructor(root, game); open(page); close(); isOpen; }         // title|pause|settings|controls|credits|confirm
export class CourseCard { constructor(root, game); show(courseDef, save) -> Promise<'enter'|'cancel'>; }   // painting entry card with crest tally + best times
export class Transitions { constructor(root); fade(ms, color?) -> Promise; iris(ms); wipe(); }
```
HUD art direction: NOT a debug overlay. Rounded storybook-glass panels, Rajdhani
numerals, crest tally pips, coin counter with roll-up animation, checkpoint pip,
realm-tinted accents, entrance/exit transitions. Nothing that looks like dat.gui.

## 28. runtime/game.js
```js
export class Game {
  constructor(engine, container);
  async boot();
  state;   // 'loading'|'title'|'keep'|'playing'|'paused'|'dead'|'card'|'clear'|'cinematic'
  course, player, hero, cam, hud, menu, audio, fx, save, input, courseId, realmId;
  async loadCourse(id, opts?); async returnToKeep(opts?); respawn(); restartCourse(); restartSession();
  onDeath(cause); onCheckpoint(i); onCrest(def); onCourseClear(); enterGate(gate);
  timeMs, sessionMs, deaths; update(dt);
  __dev;   // {goto(courseId), tp(x,y,z), give(crestId), noclip(), skipCP(), state()} — gated by ?dev=1
}
```
Death → respawn: **rewind ghost of the last 0.4 s** (history ring) played backward over
220 ms with a desaturate + iris, hazards `resetFrom(cp)`, hero re-posed, input restored;
measured MEDIAN ≤ 700 ms, ceiling 950 ms. Never a course rebuild on respawn.
Course clear: crest pedestal celebrate (camera orbit 2.2 s, burst, stinger) → card
"STAY / RETURN TO KEEP".

## 29. runtime/data/index.js
```js
export const REALMS = [
  {id:'verdant', name:'VERDANT BAILEY', theme:'verdant', courses:['verdant-1','verdant-2','verdant-3']},
  {id:'ember',   name:'EMBER FOUNDRY',  theme:'ember',   courses:['ember-1','ember-2','ember-3','ember-4']},
  {id:'rime',    name:'RIME SPIRE',     theme:'rime',    courses:['rime-1','rime-2','rime-3']},
  {id:'azure',   name:'AZURE SANCTUM',  theme:'azure',   courses:['azure-1','azure-2','azure-3']},
];
export const COURSE_META = { 'verdant-1': {name, subtitle, difficulty, gateCrests}, … };   // static, for the Keep/UI without loading course modules
export const KEEP_ID = 'keep';
export async function getCourse(id);   // dynamic import of data/courses/<id>.js (keep.js for 'keep')
```
Course list (13) and their brief: verdant-1 BAILEY MEADOW (open hills + fort interior,
tutorial, gnasher, bumblers) · verdant-2 GNASHER FORT (fortress precision, moving
geometry) · verdant-3 WINDMILL HEIGHTS (mills, moving platforms, first race) · ember-1
MAGMA WORKS (lava, sinking platforms, catwalks) · ember-2 PISTON HALLS (crushers, pistons,
conveyors) · ember-3 CINDER CHASE (rising lava, rotating bars, cannon) · ember-4 SUNSCAR
NECROPOLIS (desert pyramid, quicksand, sandboard, cannon) · rime-1 FROST COTTAGE (snow,
slope slides, ice) · rime-2 GLACIER SLIDE (ice slide race, timed) · rime-3 BLIZZARD PEAK
(mountain, pendulums, mills, warden) · azure-1 TIDEWELL TEMPLE (water swim tunnels,
currents, timed) · azure-2 GEARHEART TOWER (clockwork rotating rooms, seesaws, beams) ·
azure-3 PRISM RIDE (sky rails, wing rings, air currents, rainbow-ride finale gauntlet
combining ≥ 4 families).

---
## Hard rules
1. **No naked primitives.** Every visible mesh is composed/bevelled/trimmed, procedural
   with real UVs, or a real GLB prop. Hero and critters are articulated multi-part.
2. **Readability beats beauty.** Bright leading-edge stripes on jump-critical surfaces;
   kill = hot emissive + animated; checkpoint / crest / sigil / coin unmistakable.
3. **Determinism.** Hazards and critters are functions of the course clock (critters may
   read the player but reset exactly on `reset(t)`).
4. **Perf.** ≤ 260 draw calls, ≤ 450k tris, one particle draw call, instanced
   grass/coins/decor, chunked frustum culling, and **≥ 55 fps at the quality tier's render
   scale** (see the RENDER SCALE rule below). MEASURED 2026-09-02 on the reference machine
   (ANGLE / Intel UHD 0x00009A60 / D3D11, quiet box, GPU timer query, both courses): the
   frame is GPU FILL-bound, cost fits `T = C + F·pixels` with F ≈ 78–91 % of the frame, and
   overdraw is 2.2–2.8 shaded fragments per screen pixel. Stacking EVERY non-feature-deleting
   cut (no bloom, 1-tap shadows, no point lights, no normal maps, aniso 1) still costs
   40.99 ms = 24.4 fps at native 1920×1080, while the FULL chain at quarter pixels costs
   19.71 ms = 50.7 fps. **Therefore native-1080p 55 fps is not reachable on this GPU for this
   scene class, and no fill cut reaches it.** The original "60 fps at native 1080p" line was
   authored from the Ascendant precedent without measurement; this is the corrected rule.

   **RENDER SCALE (the mechanism, not a loophole).** The renderer owns an internal render
   scale — the same lever as the pre-existing `DPR ≤ 1.5` cap, applied below 1.0. Tiers:
   low 0.60, medium 0.72, high 0.85, ultra 1.00. On top of that a DYNAMIC controller adjusts
   the scale within ±0.15 of the tier value to hold the fps target, changing by at most 0.05
   per second and never mid-jump (hysteresis: raise only after 2 s above target). This is
   what shipped console platformers do; it is legitimate because it trades pixels, which the
   player does not count, and never geometry, hazards, decor or draw distance, which the
   player does. Deleting content, decor, lights or draw distance to win fps remains
   forbidden. `ultra` may run under target on integrated graphics by design.
5. **No per-frame allocation** in update paths.
6. Every module ES-module, side-effect free at import except data.
7. **Syntax gate = `node _harness/modulecheck.mjs`**, never `node --check` (Node 22 green-
   lights `const b = ;` in any file with an import).
8. **Never run `claude -p`** from any agent (OAuth lock).
9. `?dev=1` gates `__dev`; production paths are what the gates verify.
10. Bump `boot.js?v=N` in index.html on every integration pass.

## The gates

| gate | command | proves |
|---|---|---|
| syntax + link | `node _harness/modulecheck.mjs` | every module parses, links and imports against real three |
| reach | `node _harness/reachcheck.mjs` | every course: spawn→checkpoints→every `open` crest→every sigil is joined by legal moves (REACH_TABLE + approach run-ups); ≥ 3 checkpoints, ≥ 100 coins, 8 sigils, 7 crests, ≥ 6 hazard/critter families on non-tutorial courses |
| boot | `python _harness/bootcheck.py [--headless]` | page boots clean: no console/page/shader errors; live engine state dumped; screenshot |
| core loop | `python _harness/loopcheck.py` | keep → every course: every checkpoint fires, death rewinds+respawns ≤ 700 ms median at that checkpoint, coins/sigils/crests collect and SAVE, crest celebration completes, return to keep, gate unlock by crest total, hazards bit-identical at the same clock after reset |
| feel | `python _harness/feelcheck.py` | §11 numbers driven through REAL KeyboardEvents (+ `__test.stick`): analog walk/run speeds, turn radius at speed, stop time, single/double/triple apexes + windows, long jump distance, backflip/sideflip apexes, wall kick, dive distance + slide, pound timing + pound-jump, coyote, buffer, swim speeds, slope slide, the brake POSE covering the brake (`idle_while_moving`), and the launch commitment against a full air reversal (`air_keep_frac`) |
| camera | `python _harness/camcheck.py` | no clipping through walls (raycast pull-in), hero never occluded > 0.3 s, no auto-yaw during longjump/dive, recenter time, peek, and the SHAFT station — a 3.30 m kick shaft (verdant-1 ROUTE B's own geometry) where every frame must hold `cam.dist >= TUNE.cam.minDist` with the hero outside the near plane and unfaded |
| contrast | `python _harness/contrastcheck.py` | walked-surface vs fog band ≥ 3.5:1 at every checkpoint station, every theme |
| perf | `python _harness/perfcheck.py` | ≤ 260 draws, ≤ 450k tris, ≥ 55 fps AND p99 ≤ 28 ms **at the tier render scale** (headed, reference machine, quiet box), warm course load ≤ 1.5 s. The gate also prints the native-1080p figure as INFO — it is not a pass condition. A run taken while other browser gates are running is not evidence: re-run quiet. |
| critic | `python _harness/shots.py` + a critic agent | screenshots at authored stations per course, judged against the AAA rubric (below) |

Critic rubric (blind, each slice): (1) does the moveset read as ANALOG 3D — momentum,
triple, long, dive, wall kick, pound — not a jump-cube; (2) camera: follows, leads, never
fights, never clips; (3) course shape: multiple routes, verticality, a secret, a set-piece;
(4) lighting: key+fill+rim, coloured bounce, time-of-day, fog depth; (5) materials: PBR
with variation, no flat grey MeshStandard; (6) readability: lips visible, kill saturated,
goal silhouette; (7) VFX/animation: land dust, dive splash, pound shock, collect burst;
(8) HUD: storybook glass, not dat.gui. REJECT on any floaty jump, locked camera, invisible
lip, 4-box course, missing mid-checkpoints, 40-identical-obstacles, muddy light.
