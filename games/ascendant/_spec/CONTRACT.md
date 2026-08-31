# ASCENDANT — Module Contract (v1)

First-person 3D obby. Three.js r172, ES modules, no build step. Served static.
**This file is the integration contract.** Every module MUST match these signatures
exactly. Do not rename exports. Do not add cross-module imports beyond those listed.

Import map (already in index.html):
  "three"           -> ./assets/vendor/three/build/three.module.js
  "three/addons/"   -> ./assets/vendor/three/examples/jsm/

Units: 1 unit = 1 metre. +Y up. Right-handed.

---
## 0. Global tuning (runtime/core/tuning.js) — SOURCE OF TRUTH

```js
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
```
**Derived reach envelope (authoring limits — a stage MUST NOT exceed these):**

| jump | flat gap max | safe design | +1.0 m up | +1.8 m up | -2.0 m down |
|---|---|---|---|---|---|
| run (8.6) | 5.29 m | **4.4 m** | 4.58 m (safe 3.8) | 3.75 m (safe 3.0) | 6.20 m (safe 5.2) |
| sprint (12.2) | 7.50 m | **6.4 m** | 6.50 m (safe 5.4) | 5.31 m (safe 4.4) | 8.79 m (safe 7.4) |

Max airtime 0.615 s. `_harness/reachcheck.mjs` enforces this on every stage.

---
## 1. runtime/core/util.js
```js
export function clamp(v,a,b); export function lerp(a,b,t); export function damp(a,b,lambda,dt);
export function smoothstep(e0,e1,x); export function easeOutCubic(t); export function easeInOutSine(t);
export function mulberry32(seed) -> ()=>float01;   // deterministic RNG
export function nowMs();                            // performance.now()
export class Pool { constructor(factory, reset, size); acquire(); release(o); }
export function fmtTime(sec) -> "M:SS.mmm";
```

## 2. runtime/core/settings.js
```js
export const QUALITY = { low:{...}, medium:{...}, high:{...}, ultra:{...} };
// each: {dpr, shadowMap, bloom:bool, smaa:bool, ssao:bool, particles:0..1, decor:0..1, shadowDistance}
export const Settings = {
  get(), set(patch), quality(),          // persisted to localStorage 'ascendant.settings'
  // fields: quality:'high', sens:1.0, fov:82, invertY:false, master:0.8, music:0.6, sfx:0.9,
  //         showTimer:true, showViewmodel:true, motionBlurDip:true, hudScale:1
  on(fn), off(fn),                       // change subscribers
};
```

## 3. runtime/core/save.js
```js
export const Save = {
  load(), reset(),
  stage(stageId) -> {best:ms|null, deaths:int, cleared:bool, coins:[idx], cpIndex:int},
  setBest(stageId, ms), addDeath(stageId), setCheckpoint(stageId, idx),
  clearStage(stageId, ms), collectCoin(stageId, idx),
  worldCleared(worldId) -> bool, totals() -> {deaths, timeMs, coins, cleared},
  unlockedWorlds() -> [worldId],
};
```

## 4. runtime/core/input.js
```js
export class Input {
  constructor(domElement);
  update(dt);                       // call once per frame BEFORE player.update
  // state
  move: {x,y}                       // -1..1 strafe/forward (normalised)
  look: {dx,dy}                     // mouse delta THIS FRAME (already sens-scaled), consumed by camera
  jump, jumpPressed, jumpReleased   // bool / edge
  sprint, crouch, interact, restart // bool / edge
  locked                            // pointer-lock active
  requestLock(); releaseLock();
  on(evt, fn)                       // 'lock','unlock','pause'
  bindings                          // remappable map
  suspended                         // set true when a menu is open (blocks game input)
}
```

## 5. runtime/core/audio.js
```js
export class Audio {
  constructor();  init();           // must be called on a user gesture
  setTheme(themeId);                // crossfade the procedural music bed (1.2 s)
  sfx(name, opts?);                 // name: jump land death checkpoint coin finish laser
                                    //       crush bounce vanish step_stone step_metal step_ice ui_move ui_ok
  setVolumes({master,music,sfx});
  duck(ms);                         // dip music (death/finish)
  stopAll();
}
```
All music is PROCEDURAL Web Audio (per-theme bed). NO shared audio files across games.
Guard every AudioParam ramp: no exponentialRamp to 0, clamp to finite, wrap scheduler in try/catch.

## 6. runtime/core/engine.js
```js
export class Engine {
  constructor(container);            // creates renderer, scene, camera, composer
  renderer, scene, camera, composer, clock, size:{w,h}
  post;                              // Post instance (fx/post.js)
  setTheme(theme);                   // ThemeDef -> fog/background/tonemap/post grade
  render(dt);
  resize();
  onFrame(fn); offFrame(fn);         // fixed-order frame callbacks
  start(loopFn);                     // rAF loop; loopFn(dt, elapsed); dt clamped <= 1/20
  stats: {fps, drawCalls, tris}
}
```
Renderer: WebGLRenderer{antialias:false, powerPreference:'high-performance'},
outputColorSpace SRGB, toneMapping ACESFilmic, shadowMap PCFSoft, DPR capped at
min(devicePixelRatio, 1.5) — see feedback_forgeflow_games_fps.

## 7. runtime/fx/post.js
```js
export class Post {
  constructor(renderer, scene, camera, size, quality);
  composer;
  setGrade({lift,gamma,gain,saturation,vignette,chroma,tint});  // ThemeDef.grade
  setBloom({strength,radius,threshold});
  pulse(amount, ms);        // screen flash (death / finish)
  setDamage(v01);           // red edge vignette on death
  resize(w,h); setQuality(q);
  render(dt);
}
```
Chain: RenderPass -> UnrealBloomPass -> GradePass (custom ShaderPass: lift/gamma/gain,
saturation, vignette, chromatic aberration, filmic dither) -> SMAAPass -> OutputPass.
SSAO is OFF by default at every quality below `ultra` (measured 2/3 of frame cost).

## 8. runtime/world/materials.js
```js
export const Mats = {
  init(renderer);                       // builds procedural textures once
  get(key, themeId) -> THREE.Material;  // CACHED + SHARED. never clone per-object.
  keys: 'stone','metal','panel','grate','ice','glass','emissive','lava','obsidian',
        'crystal','wood','sand','neon','checker','hazard','rubber','conveyor','cloud'
  tex(name) -> THREE.Texture;           // procedural: noise, grunge, tri-planar-ish
  dispose();
}
```
Every material is PBR with real roughness/metalness maps + normal maps generated
procedurally (canvas -> DataTexture). NO bare `new MeshStandardMaterial({color})`.

## 9. runtime/world/themes.js
```js
export const THEMES = {
  neon:   ThemeDef, foundry: ThemeDef, spire: ThemeDef, temple: ThemeDef, hub: ThemeDef
};
// ThemeDef = {
//   id, name, fog:{color,near,far,density}, bg, sky:{type,params},
//   lights:{key:{color,intensity,dir}, fill:{...}, rim:{...}, ambient:{color,intensity}, hemi:{...}},
//   grade:{lift,gamma,gain,saturation,vignette,chroma,tint}, bloom:{strength,radius,threshold},
//   palette:{safe, safeEdge, kill, killGlow, checkpoint, checkpointOn, finish, accent, deco},
//   particles:{type:'ember'|'snow'|'mote'|'spark', rate, color, size, drift},
//   materialOverrides:{stone:..., metal:...},
//   music:{key, scale, bpm, mood}
// }
export function applyTheme(engine, themeId);
```
**Readability law:** in every theme, `palette.safe` must have >= 3.5:1 luminance contrast
against `bg`/fog at 30 m, and `palette.kill` must be unmistakably hot/saturated vs everything.

## 10. runtime/world/builders.js
```js
export function buildPlatform(def, theme) -> {mesh, colliders:[Collider]};
// Never a naked BoxGeometry: chamfered top rail, inset panel, edge-glow trim strip,
// bevelled corners, and a bright leading-edge stripe on jump-critical faces.
export function buildBeam(def, theme);   export function buildRing(def, theme);
export function buildPad(def, theme);    export function buildPillar(def, theme);
export function buildDeco(def, theme);
export function edgeStripe(mesh, color, width); // adds the "you can land here" highlight
export const InstancedGroup = class { add(geoKey, matKey, matrix); commit() -> THREE.InstancedMesh[] };
```

## 11. Collider (shared struct — defined in runtime/world/collider.js)
```js
export class Collider {
  // solid box, arbitrary orientation
  constructor({center:Vec3, half:Vec3, quat?:Quaternion, surface='normal', ref=null, group='world'});
  surface: 'normal'|'ice'|'bounce'|'speed'|'conveyor'|'sticky'|'nostick'
  ref;      // owning hazard (for platform velocity / carry)
  props;    // {power, dir:Vec3, ...} surface params
  active;   // false => ignored this frame (vanished platforms)
  aabb;     // cached world AABB for broadphase
  update();               // recompute aabb after moving
  velocityAt(p, out);     // world velocity of the surface at point p (carry + rotation)
}
export class KillVolume {
  constructor({type:'box'|'sphere'|'capsule'|'plane', ... , kind:'lava'|'void'|'spike'|'laser'|'crush'|'saw', ref});
  active; hits(playerCapsule) -> bool;
}
export class Broadphase {
  constructor(cellSize=6); add(c); remove(c); refresh(c);
  query(aabb, out) -> Collider[];      // must be allocation-free per frame
}
```

## 12. runtime/player/collide.js
```js
export function moveAndCollide(state, world, dt) -> CollisionResult;
// state: {pos:Vec3, vel:Vec3, radius, height, crouching}
// world: {broadphase, killVolumes}
// Swept, per-axis, iterated (max 4). Handles: step-up (<= TUNE.stepUp), ground snap
// (0.12 m down-probe when grounded and moving), moving-platform carry, ceiling bonk,
// wall normals for wall-slide/wall-jump.
// CollisionResult = {grounded, groundNormal, groundCollider, ceiling, walls:[{normal,collider}],
//                    platformVel:Vec3, surface, surfaceProps, stepped, hitVel}
```
CORRECTNESS RULES: never tunnel (substep when |vel*dt| > radius*0.8); never jitter on
seams (resolve along axis of least penetration, epsilon 1e-4); a moving platform pushes
the player, it never eats them (if a mover would overlap the player, push out along the
mover's motion axis; if crushed against solid geometry -> report `crushed`).

## 13. runtime/player/controller.js — THE GAME LIVES HERE
```js
export class Player {
  constructor(world, input, audio, fx);
  pos, vel, grounded, coyoteT, bufferT, sprinting, crouching, wallSliding, dead;
  spawn(pos, yaw);
  update(dt);                    // full movement + collision + surface + hazard test
  kill(cause);                   // 'lava'|'void'|'spike'|'laser'|'crush'|'saw'|'manual'
  respawn(pos, yaw);
  events;                        // emitter: 'land'(impactSpeed,surface) 'jump' 'death'(cause)
                                 // 'step'(surface) 'checkpoint'(idx) 'coin'(idx) 'finish' 'bounce'
  get eyePos();  get yaw();  get pitch();
  stats: {airTime, maxSpeed, jumps}
  __test;                        // {teleport(v), setVel(v), state()} — dev harness hook
}
```
Feel requirements (non-negotiable, each is measurable in `_harness/feelcheck.py`):
- coyote time, jump buffering, variable jump height, air control that lets you SAVE a jump
- landing does NOT kill horizontal speed; no ground-snap "stick" when running off a ledge
- no sliding on flat ground after release (< 0.15 s to full stop)
- ice: accel 26, friction 1.4 — you drift but never lose authority
- bounce pad: exact, deterministic apex (`power` = target apex height in metres)
- head does not clip through geometry when crouching under a crusher

## 14. runtime/player/camera.js
```js
export class FPCamera {
  constructor(camera, player, input, settings);
  update(dt);
  // head bob (speed-scaled, disabled in air), landing dip (impact-scaled, <=120 ms),
  // strafe roll (<=1.6 deg), FOV kick on sprint + bounce, death cam (slow drop + desat),
  // checkpoint punch, recoil-free. Pitch clamp +/-89 deg. Look uses input.look, sens from Settings.
  shake(amount, ms);  dip(amount);  setDeathCam(bool);
}
```

## 15. runtime/player/viewmodel.js
```js
export class Viewmodel {
  constructor(scene, camera, theme);
  update(dt, player);     // sway from look delta, bob, jump tuck, land compress, sprint pump
  setTheme(theme);        // glove colour per world
  setVisible(v);
}
```
Two forearms + gloves, procedurally built (segmented, bevelled, PBR), rendered on a
SEPARATE overlay camera+scene layer so they never clip world geometry. Plus a fake
contact-shadow blob under the player (a soft radial-alpha plane that lands on the
ground collider) so the player has presence.

## 16. runtime/hazards/index.js
```js
export const HAZARDS = { mover, vanish, rotor, pendulum, crusher, laser, lava, risinglava,
                         spikes, jumppad, speedpad, conveyor, ice, saw, turret, wind, chase };
// each factory: (def, ctx) -> Hazard
export class Hazard {
  mesh;                 // THREE.Object3D added to stage group
  colliders;            // [Collider]  (solid parts)
  kills;                // [KillVolume]
  update(t, dt);        // t = STAGE CLOCK (deterministic, resets at stage start, NOT wall time)
  reset(t);             // called on respawn - hazard returns to phase for time t
  dispose();
}
```
**DETERMINISM LAW:** every hazard's state is a pure function of the stage clock `t`
and its `def` (period/phase/offset). Never integrate position frame-to-frame.
`reset(t)` must place it exactly where `update(t)` would. Muscle memory depends on this.

## 17. runtime/world/stage.js
```js
export class Stage {
  constructor(def, engine, ctx);     // ctx = {mats, fx, audio, save}
  static async load(def, engine, ctx) -> Stage;   // async: props/GLB
  group;  broadphase;  killVolumes;  hazards;  checkpoints;  finish;  coins;
  def;  clock;                        // stage clock (seconds, resets on stage start)
  update(dt);
  reset();                            // full stage reset (restart)
  resetFrom(cpIndex);                 // respawn: rewind clock so hazards are fair
  spawnFor(cpIndex) -> {pos, yaw};
  progress(playerPos) -> 0..1;        // distance along the checkpoint spline
  dispose();
  bounds;                             // Box3 for culling / minimap
}
```
`resetFrom` sets `clock = checkpoints[i].clockOffset ?? 0` so a hazard gauntlet always
presents the same phase after a death (this is what makes it learnable, not luck).

## 18. Stage data format (runtime/data/stages/*.js)
```js
export default {
  id:'neon-1', world:'neon', name:'FIRST LIGHT', subtitle:'...', par:38000,   // ms
  difficulty:1,                            // 1..10
  spawn:{p:[x,y,z], yaw:0},
  killY:-45,
  checkpoints:[ {p:[x,y,z], yaw:0, clockOffset:0} , ... ],   // ordered, >=2 on long stages
  finish:{p:[x,y,z], yaw:0},
  coins:[ {p:[x,y,z]} ],
  objects:[ ObjectDef... ],
  ambience:{ /* optional theme overrides */ }
};
```
ObjectDef (flat, discriminated by `kind`) — full list:
```
{kind:'platform', p, s, rot?, mat?, surface?, props?, glow?, stripe?}
{kind:'beam',     p, s, rot?, mat?}                              // thin precision beam
{kind:'mover',    p, s, mat?, surface?, motion:{type:'linear'|'circle'|'oscillate'|'sink'|'elevator'|'orbit',
                   to?:[x,y,z], radius?, axis?, period, phase?, ease?, dwell?, sinkDelay?, sinkSpeed?}}
{kind:'vanish',   p, s, mat?, cycle:{on, off, warn, phase}}
{kind:'rotor',    p, style:'bar'|'hammer'|'windmill'|'saw', arms, len, thick, period, phase?, axis?, tilt?}
{kind:'pendulum', p, len, amp, period, phase?, blade:{w,h,d}, axis?}
{kind:'crusher',  p, s, axis?, travel, period, phase?, dwell?}
{kind:'laser',    a, b, radius?, cycle:{on,off,warn,phase}, color?}
{kind:'lava',     p, s, rising?:{from,to,speed,delay}}
{kind:'spikes',   p, s, dir?}
{kind:'jumppad',  p, s?, power, dir?}                            // power = apex metres
{kind:'speedpad', p, s?, dir, power}
{kind:'conveyor', p, s, dir, power, mat?}
{kind:'ice',      p, s, rot?}
{kind:'wind',     p, s, dir, power}
{kind:'chase',    axis:'x'|'y'|'z', from, to, speed, delay, mat:'lava'|'void'|'wall'}
{kind:'deco',     p, s?, rot?, model?, kindOf?, scale?, count?, spread?, seed?}
{kind:'text',     p, rot?, text, size?, color?}                  // in-world signage/tutorial
{kind:'light',    p, color, intensity, distance, flicker?}
```
Coordinate convention: stages run along **+X** (start low X, finish high X) so the
progress bar, minimap and camera framing are consistent. Height climbs with +Y.

## 19. runtime/fx/particles.js + impacts.js
```js
export class ParticleSystem {                  // ONE InstancedMesh, GPU-updated, pooled
  constructor(scene, quality);
  burst(preset, pos, opts?);   // 'land','death','checkpoint','finish','coin','spark',
                               // 'lavaPop','iceShard','dust','wallScrape'
  ambient(preset, box, rate);  // theme ambience (embers/snow/motes)
  update(dt); setQuality(q); dispose();
}
export class Impacts { constructor(ps, audio, camera); land(v,surf,pos); death(cause,pos); ... }
```
Budget: <= 2000 live particles at high, one draw call. No per-frame allocation.

## 20. runtime/ui/*
```js
export class HUD {        // ui/hud.js — DOM overlay in #hud, NOT canvas
  constructor(root, game);
  update(dt, snapshot);   // {stageName, worldName, stageIdx, stageCount, timeMs, totalMs,
                          //  deaths, cpIndex, cpCount, progress01, coins, coinTotal, best, speed}
  toast(text, sub?, kind?); checkpointFlash(); deathFlash(cause); finish(summary);
  setVisible(v);
}
export class Menu { constructor(root, game); open(page); close(); isOpen; }   // title|pause|settings|controls|credits
export class StageSelect { constructor(root, game); open(); close(); }        // world/stage grid w/ best times
```
HUD art direction: NOT a debug overlay. Custom typeface stack, beveled glass panels,
animated numerals, subtle scanline, world-tinted accents, entrance/exit transitions.

## 21. runtime/game.js
```js
export class Game {
  constructor(engine, container);
  async boot();
  state;                   // 'loading'|'title'|'hub'|'playing'|'paused'|'dead'|'cleared'|'select'
                           // 'loading' is the construction state: it is set before the first
                           // stage exists and again for the duration of every loadStage().
  world, stage, player, hud, menu, audio, fx, save;
  async loadStage(stageId); async nextStage(); async returnToHub();
  respawn(); restartStage(); restartRun();
  onDeath(cause); onCheckpoint(i); onFinish();
  timeMs, totalMs, deaths;
  update(dt);
  __dev;                   // {skipCP(), noclip(), goto(stageId), tp(x,y,z)} — gated by ?dev=1
}
```
Death->respawn budget: **<= 620 ms** total (flash 90 / hold 180 / fade 140 / restore 210),
input restored the instant the camera is back. Never a full stage rebuild on respawn.

## 22. runtime/data/index.js
```js
export const WORLDS = [
  {id:'neon',    name:'NEON DOJO',    theme:'neon',    stages:['neon-1','neon-2','neon-3']},
  {id:'foundry', name:'LAVA FOUNDRY', theme:'foundry', stages:[...]},
  {id:'spire',   name:'FROZEN SPIRE', theme:'spire',   stages:[...]},
  {id:'temple',  name:'SKY TEMPLE',   theme:'temple',  stages:[...]},
];
export const HUB = { id:'hub', theme:'hub', ... };   // hub stage def w/ portals
export async function getStage(id);   // dynamic import
```

---
## Hard rules
1. **No naked primitives.** Every visible mesh is composed/bevelled/trimmed or a real GLB prop.
2. **Readability beats beauty.** Landable surfaces get a bright leading-edge stripe; kill
   surfaces are hot-emissive + animated; checkpoints pulse a unique colour.
3. **Determinism.** Hazards are pure functions of the stage clock.
4. **Perf.** <= 220 draw calls/frame, <= 350k tris, DPR<=1.5, one particle draw call,
   instance every repeated decor mesh. 60 fps at 1080p on integrated graphics.
5. **No per-frame allocation** in update paths (reuse scratch vectors).
6. Every module is ES-module, side-effect free at import except `tuning.js`/`themes.js` data.
7. **The syntax gate is `node _harness/modulecheck.mjs`, never `node --check`.** On Node 22
   `node --check` treats any file containing an `import` as an ES module and stops at a parse
   depth that green-lights broken code (`const b = ;` passes). modulecheck.mjs really parses
   AND links every module, so it catches both syntax errors and missing/renamed exports.
   Run it before every commit; `node _harness/reachcheck.mjs` validates the stage data and
   `python _harness/bootcheck.py` proves the page actually boots.

---
## 23. The gates

Nothing ships until all of these are green. Every one of them exists because a real defect
got past a human read. Absolute fps is machine-specific — the reference machine for this
project is Intel UHD Graphics integrated, which is the "mid laptop" the perf rule means.

| gate | command | proves |
|---|---|---|
| syntax + link | `node _harness/modulecheck.mjs` | every module really parses, links and imports (against the real three) |
| stage connectivity | `node _harness/reachcheck.mjs` | spawn → checkpoints → finish is joined by jumps inside the §0 envelope, plus the content floor: ≥45 gameplay objects, ≥150 m, ≥3 checkpoints, ≥8 hazards from ≥4 families |
| stage geometry | `node _harness/geomcheck.mjs` | headroom ≥ player height, no hazard buried in the deck it sweeps over, no required jump arc through solid geometry, no monotony (flat runs, repeated obstacles, uniform gaps) |
| boot | `python _harness/bootcheck.py` | the page actually boots: console/page/shader errors, live engine state |
| core loop | `python _harness/loopcheck.py` | every checkpoint fires, death respawns at it inside 620 ms, coins collect, the finish clears and saves, and hazards are bit-identical at the same stage clock across a reset |
| feel | `python _harness/feelcheck.py` | the §13 movement numbers are real, driven through actual KeyboardEvents: apex, airtime, run/sprint speed, gap distance, stop time, coyote, buffer, respawn |
| frame cost | `python _harness/frameprobe.py` | where the frame goes: GPU identity, composer config, light census, per-pass fps delta |
| budget | `python _harness/perfcheck.py` | ≤220 draws, ≤350k tris, ≥55 fps per stage |

**Two units traps that have already caused wrong "fixes":** pendulum `amp` is RADIANS
(`ampDeg` is the degrees convenience), and `vanish.cycle.phase` is a FRACTION of one cycle,
not seconds. Read the hazard factory before changing one of its numbers.
