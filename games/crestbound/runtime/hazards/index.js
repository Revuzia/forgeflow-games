// runtime/hazards/index.js
// CRESTBOUND — the hazard registry (CONTRACT §21).
//
// `HAZARDS[kind](def, ctx) -> Hazard` for every hazard kind a course may emit, plus
// `makeHazard` (alias resolution + validation with an error that names the offending course
// object), `HAZARD_META` (course validator + HUD legend) and `KIND_ROUTE` (who builds what).
//
// IMPORT ORDER MATTERS. `./lasers.js` is requested FIRST, and `Hazard` is re-exported from it
// rather than declared here, so that a sibling doing `import { Hazard } from './index.js'`
// links against a binding that is already initialised when its own module body runs. Declaring
// the class in this file would put it in the temporal dead zone for any sibling that extends it
// at module scope.
//
// ==========================================================================================
//  README — EVERY KIND, EVERY FIELD, EVERY UNIT
// ==========================================================================================
// Units throughout: metres, seconds, m/s, m/s², RADIANS. `p` is a world CENTRE, `s` is a FULL
// extent (never a half extent), `a`/`b` are world endpoints. THE THREE ASCENDANT TRAPS, stated
// once and obeyed everywhere below:
//
//   TRAP 1 — `phase` is NOT one thing. On `cycle:{…}` blocks (beam, flame, spikes, vanish,
//            laser family) `cycle.phase` is in SECONDS and shifts the cycle EARLIER. On the
//            spinners and slammers (mover.motion.phase, rotor.phase, crusher.phase, mill.phase)
//            it is a FRACTION OF ONE CYCLE, 0..1. Every entry below says which.
//   TRAP 2 — angles are RADIANS. Every kind that takes one also accepts the `…Deg` twin
//            (`ampDeg`, `tiltDeg`, `yawDeg`, `pitchDeg`, `maxDeg`) and the DEGREES twin WINS
//            when present.
//   TRAP 3 — `power` is not a velocity everywhere. jumppad `power` = TARGET APEX IN METRES.
//            speedpad / conveyor / wind / current `power` = m/s (wind is m/s²). cannon `power`
//            = launch SPEED in m/s. Every entry below says which.
//
// A `cycle` block is `{on, off, warn, phase}` in SECONDS: dangerous/solid for `on`, dormant for
// `off`, and `warn` is the TAIL of the off window — the telegraph immediately before the next
// `on`. A kill volume NEVER arms during `warn`; the telegraph is always survivable.
//
// ------------------------------------------------------------------------------------------
//  KINETIC (movers.js / vanish.js / rotors.js / pendulum.js / crushers.js / mill.js)
// ------------------------------------------------------------------------------------------
//  mover      {p, s, mat?, surface?, kill?, motion:{type:'linear'|'circle'|'orbit'|'oscillate'
//             |'sink'|'elevator', to:[x,y,z], radius:M, axis:[x,y,z]|'x'|'y'|'z', amp:M,
//             period:SEC, phase:FRACTION 0..1, ease:'linear'|'sine'|'inout'|'snap', dwell:SEC,
//             dir:±1, sinkDelay:SEC, sinkSpeed:M/S, sinkDepth:M, respawnAfter:SEC,
//             travel:M, speed:M/S, hold:SEC}}
//             Carries a rider (linVel, or angVel about the orbit centre for 'circle').
//  vanish     {p, s, mode?:'cycle'|'flicker'|'crumble', cycle:{on,off,warn,phase} SEC,
//             crackDelay?:SEC, chunkLife?:SEC, mat?, surface?, seed?}
//             'crumble' ignores `cycle` and runs off crackDelay/chunkLife.
//  rotor      {p, style?:'bar'|'hammer'|'windmill'|'saw', arms?:int, len:M (blade RADIUS for
//             'saw'), thick?:M, height?:M, period:SEC PER REV, phase?:FRACTION 0..1,
//             axis?:[x,y,z]|'x'|'y'|'z', tilt?:RAD | tiltDeg?:DEG, dir?:±1, mount?:M,
//             kill?:true|'spike'|'saw'|…}
//             'bar' is a rideable solid unless `kill`; hammer/windmill/saw are lethal.
//             `kind:'saw'` is accepted as an alias for `{kind:'rotor', style:'saw'}`.
//  pendulum   {p:PIVOT, len:M, amp:RAD | ampDeg:DEG, period:SEC, phase?:RAD | phaseCycles?:0..1,
//             axis?:'z'|[x,y,z], mode?:'axe'|'blade'|'ball', blade?:{w,h,d} M, radius?:M}
//             THE CHAIN IS SAFE — only the head kills. A 'ball' is solid and only lethal
//             above a threshold tip speed.
//  crusher    {p:RETRACTED CENTRE, s, axis?:CRUSH DIRECTION (default [0,-1,0]), travel:M,
//             period:SEC, phase?:FRACTION 0..1, dwell?:SEC, mode?:'single'|'pair'|'wall',
//             gap?:M, mat?, surface?}
//             Lethal ONLY on the crushing face and ONLY while it is driving forward; parked, it
//             is a safe platform that carries you.
//  mill       {p:AXLE (the tower hangs `tower` metres BELOW it), arms?:int (4), len?:M (7),
//             period:SEC PER REV, phase?:FRACTION 0..1, dir?:±1, yaw?:RAD | yawDeg?:DEG,
//             axis?:[x,y,z], chord?|w?:M, thick?:M, inner?:M, tower?:M (0 = no tower),
//             towerR?:M}
//             Every sail is a SOLID rideable shelf whose face leads into the travel; the tower
//             drum and its gallery balcony are solid too. One deep tick per revolution.
//
// ------------------------------------------------------------------------------------------
//  FIELDS AND FRONTS (lasers.js / beams.js / lava.js / chase.js / spikes.js)
// ------------------------------------------------------------------------------------------
//  beam       {a, b, cycle:{on,off,warn,phase} SEC, mode?:'single'|'grid'|'sweep', radius?:M,
//             color?, count?:int, spacing?:M, offset?:[x,y,z], stagger?:SEC,
//             p?, len?:M, axis?, arc?:RAD, period?:SEC, phase?:SEC (sweep)}
//             Analytic kill CAPSULE per beam, armed only while 'on'. `kind:'laser'` /
//             'lasergrid' / 'lasersweep' are accepted as aliases for the three modes.
//  flame      {p:VENT, dir?:[x,y,z] (default +Y), len?:M, radius?:M, cycle:{…} SEC, color?}
//             The kill capsule tracks the VISIBLE jet and only arms past 22 % reach.
//  lava       {p, s (s.y = pool DEPTH), rising?:{from:M, to:M, speed:M/S, delay:SEC}}
//             A def carrying `rising` is built as `risinglava`.
//  risinglava {p, s, rising:{from, to, speed, delay}} — surface y = from + clamp((t - delay) *
//             speed, 0, to - from). Exposes `heightAt(t)` and a `hud` danger block.
//  spikes     {p, s, dir?:[x,y,z] (which way the points face), mode?:'static'|'retract'|'wall',
//             cycle?:{…} SEC, spikeRadius?:M}
//             The base plate is SOLID and standable; only the volume above it kills, and in
//             'retract' only past 34 % extension.
//  chase      {axis:'x'|'y'|'z', from:POSITION ON AXIS, to:POSITION ON AXIS, speed:M/S,
//             delay:SEC, mat?:'lava'|'void'|'wall', p?:[lateral centre], s?:[cross-section],
//             w?:M, h?:M, color?}
//             Everything at or behind the front is lethal. Exposes `frontAt(t)`, `warn01`, `hud`.
//
// ------------------------------------------------------------------------------------------
//  SURFACES (surfaces.js)
// ------------------------------------------------------------------------------------------
//  ice        {p, s, rot?:[rx,ry,rz] RAD, color?}     surface 'ice', props {slick:1}
//  conveyor   {p, s, dir:[x,y,z]|'x'|'-z', power:M/S SIGNED, clamped to ±TUNE.conveyorMax}
//             surface 'conveyor', props {dir, power}
//  jumppad    {p, s?, power:TARGET APEX IN METRES (default TUNE.bounceDefaultApex = 4), dir?,
//             aim?}   surface 'bounce', props {power:METRES, launchV:M/S, dir}
//             The ghost arc is drawn with the real asymmetric gravity, so it is where you land.
//  speedpad   {p, s?, dir:[x,y,z], power?:M/S (default TUNE.speedRun = 9)}
//             surface 'speed', props {dir, power}
//  wind       {p, s, dir:[x,y,z], power:M/S²}
//             Publishes a `Volume` of kind 'wind' with props {dir, power} — NEVER a collider.
//
// ------------------------------------------------------------------------------------------
//  RIDER-DRIVEN AND FLUID (breakable.js / launch.js / fluids.js)
// ------------------------------------------------------------------------------------------
//  breakable  {p, s, mat?, rot?:RAD, drop?:'coins'|'crest'|'none', dropCount?:int,
//             trigger?:string, respawn?:SEC (0 = stays broken until the checkpoint reset)}
//             Collider carries `props.breakable = true` (CONTRACT §9/§10). onPound shatters it;
//             a dive or slide contact does too.
//  sinker     {p, s, delay?:SEC (0.45), speed?:M/S (2.2), rise?:M/S, depth?:M (6), mat?}
//             Sinks after `delay` of being stood on, rises the moment you step off. A pound
//             skips the delay.
//  seesaw     {p:PIVOT, s:[LENGTH, thickness, width], axis?:TILT AXIS 'z'|[x,y,z],
//             maxDeg?:DEG (22) | maxTilt?:RAD, spring?:RATE (5), mat?}
//             Tilt is a pure function of the rider's offset along the plank; springs to level.
//  cannon     {p:BREECH, yaw?:RAD | yawDeg?:DEG, pitch?:RAD | pitchDeg?:DEG (default 45 deg),
//             power:LAUNCH SPEED M/S, target?:[x,y,z], r?:M, len?:M, cooldown?:SEC,
//             autoFire?:SEC (0 = the player fires), id?}
//             A `target` overrides yaw AND power: the speed is SOLVED against the asymmetric
//             gravity. Publishes `aim`, `launchSpeed`, `launchVelocity(out)`, `mouth`,
//             `landing`, `flightTime`, and a trigger Volume with `props.cannon = true`
//             carrying `enter(player)` / `fire(player)`. The CONTROLLER owns the `cannon` state.
//  rings      {pts:[[x,y,z], …], r?:M (2.2), limitMs?:MS | time?:SEC, trigger?, id?,
//             flyRefresh?:SEC (3)}
//             Ordered pass detection is a PLANE CROSSING, so a hoop cannot be tunnelled at any
//             flight speed. Emits `ringPass(id, index, hazard)` per hoop and `ringsDone(id,
//             hazard)` + the named trigger on completion; a pass in the `fly` state refreshes
//             the flight.
//  current    {p, s, dir:[x,y,z], power:M/S}
//             Publishes a `Volume` of kind 'current' with props {dir, power}. Never a collider.
//  quicksand  {p, s (s.y = DEPTH), sink?:M/S (1.1), escapeJumpV?:M/S, color?}
//             Publishes a `Volume` of kind 'quicksand' with props {sink, escapeJumpV,
//             surfaceY}. The sand surface ripples out from wherever the hero is standing.
//  sandboard  {a:[top], b:[bottom] | pts:[[x,y,z], …], w?:M (6), h?:DECK THICKNESS M,
//             minSpeed?:M/S (0.85 x TUNE.speedRun), friction?, berm?:M}
//             Rotated 'sand' colliders with `props {board:true, slick, minSpeed, friction,
//             slopeDeg}`; berm walls on both sides are colliders too.
//
// ------------------------------------------------------------------------------------------
//  EVERY HAZARD IMPLEMENTS
// ------------------------------------------------------------------------------------------
//    mesh, colliders[], kills[], volumes[]
//    update(t, dt, player)   reset(t)   onStand(player, collider)   onPound(player)
//    onTouch(info)           dispose()
//  Kinetic solids additionally publish `linVel`, `angVel`, `angAxis`, `angCenter` and
//  `velocityAtPoint(p, out)` for the CONTRACT §10 carry.
//
// DETERMINISM LAW (CONTRACT §21): state is a pure function of the course clock `t` and `def`,
// and `reset(t)` places the hazard exactly where `update(t)` would with every one-shot effect
// suppressed. The four legitimately rider-driven hazards (`mover` type sink/elevator, `sinker`,
// `seesaw`, `rings`) hold their state ON THE COURSE CLOCK and return to the pristine pose on
// `reset(t)`; nothing else in the course can observe a difference.
// ==========================================================================================

export { Hazard } from './lasers.js';

import * as lasersMod from './lasers.js';
import * as beamsMod from './beams.js';
import * as lavaMod from './lava.js';
import * as spikesMod from './spikes.js';
import * as surfacesMod from './surfaces.js';
import * as chaseMod from './chase.js';
import * as moversMod from './movers.js';
import * as rotorsMod from './rotors.js';
import * as vanishMod from './vanish.js';
import * as crushersMod from './crushers.js';
import * as pendulumMod from './pendulum.js';
import * as breakableMod from './breakable.js';
import * as launchMod from './launch.js';
import * as fluidsMod from './fluids.js';
import * as millMod from './mill.js';

/* ======================================================================================
   FACTORY RESOLUTION
   ======================================================================================
   Every sibling is imported as a NAMESPACE on purpose: a namespace import yields `undefined`
   for an export that is not there, where a named import would be a hard link error that takes
   the whole game down. `resolve()` turns a missing export into a precise, actionable message at
   the moment a course asks for that hazard, instead of a blank page. */

const MODULE_FILES = new Map([
  [lasersMod, './lasers.js'], [beamsMod, './beams.js'], [lavaMod, './lava.js'],
  [spikesMod, './spikes.js'], [surfacesMod, './surfaces.js'], [chaseMod, './chase.js'],
  [moversMod, './movers.js'], [rotorsMod, './rotors.js'], [vanishMod, './vanish.js'],
  [crushersMod, './crushers.js'], [pendulumMod, './pendulum.js'],
  [breakableMod, './breakable.js'], [launchMod, './launch.js'],
  [fluidsMod, './fluids.js'], [millMod, './mill.js'],
]);

/** First function matching any of `names` across `mods` (checking a default-export map too). */
function resolve(mods, names) {
  for (const m of mods) {
    if (!m) continue;
    for (const n of names) {
      if (typeof m[n] === 'function') return m[n];
    }
    const d = m.default;
    if (d && typeof d === 'object') {
      for (const n of names) {
        if (typeof d[n] === 'function') return d[n];
      }
    }
  }
  return null;
}

/**
 * Placeholder factory for a kind whose module did not export it. It never silently no-ops: it
 * throws at the moment a course actually asks for that hazard, naming the file and the export
 * the module is expected to provide.
 */
function unresolved(kind, mods, names) {
  const files = mods.map((m) => MODULE_FILES.get(m)).filter(Boolean).join(' or ');
  return function unresolvedFactory(def) {
    throw new HazardDefError(
      `hazard kind '${kind}' is declared in CONTRACT section 21 but no factory was found. `
      + `Expected ${files || 'a sibling hazard module'} to export one of: ${names.join(', ')}.`,
      def,
    );
  };
}

function bind(kind, mods, names) {
  return resolve(mods, names) || unresolved(kind, mods, names);
}

/* ======================================================================================
   THE REGISTRY — exactly the CONTRACT §21 key list, in its order
   ====================================================================================== */

export const HAZARDS = {
  // kinetic
  mover: bind('mover', [moversMod], ['mover', 'makeMover', 'createMover', 'movingPlatform']),
  vanish: bind('vanish', [vanishMod], ['vanish', 'makeVanish', 'vanishing', 'vanishPlatform']),
  rotor: bind('rotor', [rotorsMod], ['rotor', 'makeRotor', 'createRotor']),
  pendulum: bind('pendulum', [pendulumMod], ['pendulum', 'makePendulum', 'createPendulum']),
  crusher: bind('crusher', [crushersMod], ['crusher', 'makeCrusher', 'createCrusher']),

  // molten
  lava: bind('lava', [lavaMod], ['lava', 'makeLava']),
  risinglava: bind('risinglava', [lavaMod], ['risinglava', 'risingLava', 'makeRisingLava']),

  // beds and pads
  spikes: bind('spikes', [spikesMod], ['spikes', 'makeSpikes']),
  jumppad: bind('jumppad', [surfacesMod], ['jumppad', 'jumpPad', 'makeJumpPad']),
  speedpad: bind('speedpad', [surfacesMod], ['speedpad', 'speedPad', 'makeSpeedPad']),
  conveyor: bind('conveyor', [surfacesMod], ['conveyor', 'makeConveyor']),
  ice: bind('ice', [surfacesMod], ['ice', 'makeIce']),
  wind: bind('wind', [surfacesMod], ['wind', 'makeWind']),

  // fronts and fields
  chase: bind('chase', [chaseMod], ['chase', 'makeChase']),
  beam: bind('beam', [beamsMod, lasersMod], ['beam', 'makeBeam', 'laser']),

  // rider-driven
  breakable: bind('breakable', [breakableMod], ['breakable', 'makeBreakable']),
  sinker: bind('sinker', [breakableMod, moversMod], ['sinker', 'makeSinker']),
  seesaw: bind('seesaw', [breakableMod], ['seesaw', 'makeSeesaw']),

  // launch
  cannon: bind('cannon', [launchMod], ['cannon', 'makeCannon']),
  rings: bind('rings', [launchMod], ['rings', 'makeRings', 'ringChain']),

  // fluid
  current: bind('current', [fluidsMod], ['current', 'makeCurrent']),
  quicksand: bind('quicksand', [fluidsMod], ['quicksand', 'makeQuicksand']),
  flame: bind('flame', [beamsMod], ['flame', 'makeFlame']),
  sandboard: bind('sandboard', [fluidsMod], ['sandboard', 'makeSandboard']),
  mill: bind('mill', [millMod], ['mill', 'makeMill']),
};

/**
 * Kinds a course may author that are BUILT AS another kind. Resolved before validation, so the
 * alias and its target are validated against the SAME rules. This exists so `HAZARDS` can stay
 * exactly the §21 key list while nothing an author might reasonably type is unbuildable.
 *   fn(def) -> a NEW def (never a mutation of the author's object).
 */
export const KIND_ALIAS = Object.freeze({
  saw: (d) => Object.assign({}, d, { kind: 'rotor', style: 'saw' }),
  windmill: (d) => Object.assign({}, d, { kind: 'rotor', style: 'windmill' }),
  hammer: (d) => Object.assign({}, d, { kind: 'rotor', style: 'hammer' }),
  laser: (d) => Object.assign({}, d, { kind: 'beam', mode: d.mode || 'single' }),
  lasergrid: (d) => Object.assign({}, d, { kind: 'beam', mode: 'grid' }),
  lasersweep: (d) => Object.assign({}, d, { kind: 'beam', mode: 'sweep' }),
  jumppads: (d) => Object.assign({}, d, { kind: 'jumppad' }),
  ring: (d) => Object.assign({}, d, { kind: 'rings' }),
});

/** Resolve a kind alias once. Returns the def unchanged when it is not an alias. */
export function resolveAlias(def) {
  if (!def || typeof def !== 'object') return def;
  const fn = Object.prototype.hasOwnProperty.call(KIND_ALIAS, def.kind) ? KIND_ALIAS[def.kind] : null;
  return fn ? fn(def) : def;
}

/**
 * Course-validator and HUD-legend metadata.
 *   label     — human name for the legend / course-select blurb
 *   killer    — can this kill the player outright?
 *   solid     — does it contribute standable colliders?
 *   carries   — does a standing player get carried by it (CONTRACT §10 platformVel)?
 *   telegraph — does it warn before it becomes dangerous? (`false` on a killer is a design
 *               smell the validator should flag unless the hazard is permanently lethal)
 *   volume    — does it contribute non-solid influence volumes via `hazard.volumes`?
 *   family    — the hazard FAMILY, for the "at least 6 families on a non-tutorial course"
 *               rule the reach gate enforces
 *   builder   — true for §25 kinds handled by runtime/world/builders.js, not by HAZARDS
 */
export const HAZARD_META = {
  mover: { label: 'Moving Platform', killer: false, solid: true, carries: true, telegraph: false, family: 'kinetic' },
  vanish: { label: 'Vanishing Tile', killer: false, solid: true, carries: false, telegraph: true, family: 'kinetic' },
  rotor: { label: 'Rotor Arm', killer: true, solid: true, carries: true, telegraph: false, family: 'kinetic' },
  pendulum: { label: 'Pendulum Blade', killer: true, solid: false, carries: true, telegraph: false, family: 'kinetic' },
  crusher: { label: 'Crusher', killer: true, solid: true, carries: true, telegraph: true, family: 'kinetic' },
  mill: { label: 'Windmill', killer: false, solid: true, carries: true, telegraph: false, family: 'kinetic' },

  lava: { label: 'Lava', killer: true, solid: false, carries: false, telegraph: false, family: 'molten' },
  risinglava: { label: 'Rising Lava', killer: true, solid: false, carries: false, telegraph: true, family: 'molten' },
  flame: { label: 'Flame Vent', killer: true, solid: true, carries: false, telegraph: true, family: 'molten' },
  chase: { label: 'Chase Front', killer: true, solid: false, carries: false, telegraph: true, family: 'chase' },
  beam: { label: 'Pulse Beam', killer: true, solid: false, carries: false, telegraph: true, family: 'beam' },
  spikes: { label: 'Spike Bed', killer: true, solid: true, carries: false, telegraph: true, family: 'spikes' },

  ice: { label: 'Ice', killer: false, solid: true, carries: false, telegraph: false, family: 'surface' },
  conveyor: { label: 'Conveyor', killer: false, solid: true, carries: false, telegraph: false, family: 'surface' },
  jumppad: { label: 'Launch Pad', killer: false, solid: true, carries: false, telegraph: false, family: 'surface' },
  speedpad: { label: 'Speed Pad', killer: false, solid: true, carries: false, telegraph: false, family: 'surface' },
  sandboard: { label: 'Sand Chute', killer: false, solid: true, carries: false, telegraph: false, family: 'surface' },

  wind: { label: 'Wind', killer: false, solid: false, carries: false, telegraph: true, volume: true, family: 'field' },
  current: { label: 'Current', killer: false, solid: false, carries: false, telegraph: true, volume: true, family: 'field' },
  quicksand: { label: 'Quicksand', killer: false, solid: false, carries: false, telegraph: true, volume: true, family: 'field' },

  breakable: { label: 'Breakable Crate', killer: false, solid: true, carries: false, telegraph: true, family: 'rider' },
  sinker: { label: 'Sinking Platform', killer: false, solid: true, carries: true, telegraph: true, family: 'rider' },
  seesaw: { label: 'Seesaw', killer: false, solid: true, carries: true, telegraph: false, family: 'rider' },

  cannon: { label: 'Cannon', killer: false, solid: true, carries: false, telegraph: true, volume: true, family: 'launch' },
  rings: { label: 'Ring Chain', killer: false, solid: false, carries: false, telegraph: true, volume: true, family: 'launch' },

  // §25 kinds that are NOT hazards. Listed so the course validator accepts them and the HUD
  // legend can skip them; `makeHazard` refuses them with a routing message.
  platform: { label: 'Platform', builder: true, killer: false, solid: true },
  ramp: { label: 'Ramp', builder: true, killer: false, solid: true },
  stairs: { label: 'Stairs', builder: true, killer: false, solid: true },
  tree: { label: 'Tree', builder: true, killer: false, solid: true },
  pole: { label: 'Pole', builder: true, killer: false, solid: true },
  net: { label: 'Net', builder: true, killer: false, solid: true },
  bridge: { label: 'Bridge', builder: true, killer: false, solid: true },
  painting: { label: 'Painting Gate', builder: true, killer: false, solid: false },
  gatedoor: { label: 'Gate Door', builder: true, killer: false, solid: true },
  pedestal: { label: 'Pedestal', builder: true, killer: false, solid: true },
  fence: { label: 'Fence', builder: true, killer: false, solid: true },
  rock: { label: 'Rock', builder: true, killer: false, solid: true },
  building: { label: 'Building', builder: true, killer: false, solid: true },
  terrain: { label: 'Terrain', builder: true, killer: false, solid: true },
  water: { label: 'Water', builder: true, killer: false, solid: false },
  deco: { label: 'Decoration', builder: true, killer: false, solid: false },
  text: { label: 'Signage', builder: true, killer: false, solid: false },
  light: { label: 'Light', builder: true, killer: false, solid: false },
};

/**
 * Every kind `makeHazard` will build, as an ARRAY (for error messages and the HUD legend).
 *
 * Named `HAZARD_KIND_LIST`, not `HAZARD_KINDS`: a course loader that wants a membership test
 * must use `KIND_ROUTE` / `routeOf` below. The old name invited a consumer to shadow it with a
 * local `Set` of the same name and drift — which is exactly how a kind ends up routed to the
 * static builder path and its hazard stranded.
 */
export const HAZARD_KIND_LIST = Object.keys(HAZARDS);

/** The alias kinds a course may also author, for the same error messages. */
export const HAZARD_ALIAS_LIST = Object.keys(KIND_ALIAS);

/**
 * THE ROUTING TABLE — the single source of truth for "who builds this kind".
 *
 *   'hazard'  -> makeHazard(def, ctx)                       (this module)
 *   'builder' -> runtime/world/builders.js via Course._buildStatic
 *
 * Derived, never hand-listed: a kind is a builder only where HAZARD_META says so, every key of
 * HAZARDS is a hazard, and every alias routes to a hazard. Adding a factory to HAZARDS routes
 * it automatically, so a new hazard can never be silently unreachable.
 */
export const KIND_ROUTE = (() => {
  const table = {};
  for (const k in HAZARD_META) {
    if (!Object.prototype.hasOwnProperty.call(HAZARD_META, k)) continue;
    table[k] = HAZARD_META[k].builder === true ? 'builder' : 'hazard';
  }
  for (const k in HAZARDS) {
    if (!Object.prototype.hasOwnProperty.call(HAZARDS, k)) continue;
    if (table[k] !== 'builder') table[k] = 'hazard';
  }
  for (const k in KIND_ALIAS) {
    if (!Object.prototype.hasOwnProperty.call(KIND_ALIAS, k)) continue;
    if (table[k] === undefined) table[k] = 'hazard';
  }
  return Object.freeze(table);
})();

/** @returns {'hazard'|'builder'|null} how `kind` must be built, or null if it is not a kind. */
export function routeOf(kind) {
  if (typeof kind !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(KIND_ROUTE, kind) ? KIND_ROUTE[kind] : null;
}

export function isHazardKind(kind) {
  if (typeof kind !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(HAZARDS, kind)
    || Object.prototype.hasOwnProperty.call(KIND_ALIAS, kind);
}

/** The §21 family a kind belongs to (for the "≥ 6 families" course rule), or null. */
export function familyOf(kind) {
  const resolved = Object.prototype.hasOwnProperty.call(KIND_ALIAS, kind)
    ? KIND_ALIAS[kind]({ kind }).kind : kind;
  const meta = HAZARD_META[resolved];
  return meta && meta.family ? meta.family : null;
}

/* ======================================================================================
   VALIDATION
   ====================================================================================== */

export class HazardDefError extends Error {
  constructor(message, def, cause) {
    super(message);
    this.name = 'HazardDefError';
    this.def = def || null;
    if (cause) this.cause = cause;
  }
}

/**
 * Fields with no sensible default. Everything else falls back inside the factory, deliberately:
 * a course author should be able to drop `{kind:'lava', p, s}` and get a good-looking pool.
 *   'vec3'   — [x,y,z] | {x,y,z}
 *   'dir'    — a 'vec3', or one of the axis strings 'x'|'y'|'z'|'-x'|'-y'|'-z' that
 *              `dirVec()` in ./lasers.js accepts. Requiring 'vec3' here would reject
 *              `dir:'x'`, which every hazard in the package actually supports.
 *   'number' — finite number
 *   'object' — a plain object (motion / cycle blocks)
 *   'array'  — a non-empty array
 *   'axis'   — 'x' | 'y' | 'z'
 */
const REQUIRED = {
  mover: { p: 'vec3', s: 'vec3', motion: 'object' },
  vanish: { p: 'vec3', s: 'vec3' },              // `cycle` is mode-dependent — see SEMANTIC
  rotor: { p: 'vec3', period: 'number' },
  // `amp` is RADIANS; pendulum.js also reads `ampDeg` as the documented degrees convenience.
  // Requiring `amp` here would reject every def that authors only `ampDeg` BEFORE the factory
  // ran — see SEMANTIC.pendulum, which accepts either.
  pendulum: { p: 'vec3', len: 'number', period: 'number' },
  crusher: { p: 'vec3', s: 'vec3', travel: 'number', period: 'number' },
  mill: { p: 'vec3', period: 'number' },

  lava: { p: 'vec3', s: 'vec3' },
  risinglava: { p: 'vec3', s: 'vec3' },
  flame: { p: 'vec3' },
  // `beam` deliberately has NO required field here: 'single'/'grid' need a+b, 'sweep' needs
  // p+period. Requiring a/b would reject every legal sweep BEFORE SEMANTIC.beam could look at
  // the mode — the same shape of bug that stranded three Ascendant pendulums on `ampDeg`.
  beam: {},
  spikes: { p: 'vec3', s: 'vec3' },
  chase: { from: 'number', to: 'number', speed: 'number' },

  ice: { p: 'vec3', s: 'vec3' },
  conveyor: { p: 'vec3', s: 'vec3', dir: 'dir', power: 'number' },
  jumppad: { p: 'vec3', power: 'number' },
  speedpad: { p: 'vec3', dir: 'dir' },
  wind: { p: 'vec3', s: 'vec3', dir: 'dir', power: 'number' },

  breakable: { p: 'vec3', s: 'vec3' },
  sinker: { p: 'vec3', s: 'vec3' },
  seesaw: { p: 'vec3', s: 'vec3' },

  cannon: { p: 'vec3' },
  rings: { pts: 'array' },
  current: { p: 'vec3', s: 'vec3', dir: 'dir', power: 'number' },
  quicksand: { p: 'vec3', s: 'vec3' },
  sandboard: {},                                  // a/b OR pts — see SEMANTIC.sandboard
};

/**
 * Sanity every hazard kind shares — a zero period is an infinite loop or a NaN, a negative
 * cycle window is a phase that never comes. These used to live only in the course validator,
 * which meant the two could (and did) drift apart; the course validator delegates every
 * hazard-routed object here, so this is the single owner.
 */
function commonSemantic(def, fail) {
  if (def.period != null && !(isNum(def.period) && def.period > 0)) {
    fail(`'period' must be > 0, got ${brief(def.period)}`);
  }
  const m = def.motion;
  if (isObj(m)) {
    if (m.period != null && !(isNum(m.period) && m.period > 0)) {
      fail(`'motion.period' must be > 0, got ${brief(m.period)}`);
    }
    if (m.to != null && m.to !== null && !isVec(m.to)) fail("'motion.to' must be a finite [x,y,z]");
  }
  const c = def.cycle;
  if (c != null && c !== null) {
    if (!isObj(c)) fail("'cycle' must be an object {on, off, warn, phase} in SECONDS");
    const on = +c.on, off = +c.off;
    if (c.on != null && !(isNum(on) && on >= 0)) fail(`'cycle.on' must be a finite number >= 0, got ${brief(c.on)}`);
    if (c.off != null && !(isNum(off) && off >= 0)) fail(`'cycle.off' must be a finite number >= 0, got ${brief(c.off)}`);
    if (c.on != null && c.off != null && on + off <= 0) fail("'cycle.on' + 'cycle.off' must be > 0 (the period would be zero)");
    if (c.warn != null && !(isNum(c.warn) && c.warn >= 0)) fail("'cycle.warn' must be a finite number >= 0 (it is the TAIL of 'off')");
    if (c.warn != null && c.off != null && +c.warn > off + 1e-6) {
      fail(`'cycle.warn' (${c.warn}) is longer than 'cycle.off' (${c.off}) — the telegraph must fit inside the dormant window`);
    }
  }
}

/** Extra checks that a type table cannot express. */
const SEMANTIC = {
  rotor(def, fail) {
    if (def.len != null && !(isNum(def.len) && def.len > 0)) fail(`'len' must be > 0, got ${brief(def.len)}`);
    if (def.arms != null && !(isNum(def.arms) && def.arms >= 1)) fail(`'arms' must be >= 1, got ${brief(def.arms)}`);
    if (def.style != null && !['bar', 'hammer', 'windmill', 'saw'].includes(String(def.style))) {
      fail("'style' must be 'bar', 'hammer', 'windmill' or 'saw'");
    }
  },
  pendulum(def, fail) {
    // `ampDeg` (DEGREES) wins when present, else `amp` (RADIANS). This is TRAP 2.
    const hasDeg = def.ampDeg != null && def.ampDeg !== null;
    const hasRad = def.amp != null && def.amp !== null;
    if (!hasDeg && !hasRad) fail("needs a swing amplitude: 'amp' (RADIANS) or 'ampDeg' (DEGREES)");
    if (hasDeg && !isNum(def.ampDeg)) fail(`'ampDeg' must be a finite number, got ${brief(def.ampDeg)}`);
    if (!hasDeg && hasRad && !isNum(def.amp)) fail(`'amp' must be a finite number, got ${brief(def.amp)}`);
    if (!(def.len > 0)) fail(`'len' must be > 0, got ${brief(def.len)}`);
    if (def.mode != null && !['axe', 'blade', 'ball'].includes(String(def.mode))) {
      fail("'mode' must be 'axe', 'blade' or 'ball'");
    }
  },
  crusher(def, fail) {
    if (def.travel === 0) fail("'travel' must be a non-zero finite number, got 0");
    if (def.mode != null && !['single', 'pair', 'wall'].includes(String(def.mode))) {
      fail("'mode' must be 'single', 'pair' or 'wall'");
    }
    if (def.dwell != null && !(isNum(def.dwell) && def.dwell >= 0)) fail("'dwell' must be >= 0 SECONDS");
  },
  mill(def, fail) {
    if (def.arms != null && !(isNum(def.arms) && def.arms >= 1)) fail(`'arms' must be >= 1, got ${brief(def.arms)}`);
    if (def.len != null && !(isNum(def.len) && def.len > 0)) fail(`'len' must be > 0, got ${brief(def.len)}`);
    if (def.tower != null && !(isNum(def.tower) && def.tower >= 0)) fail("'tower' must be >= 0 METRES (0 means no tower)");
  },
  beam(def, fail) {
    const mode = String(def.mode || 'single');
    if (!['single', 'grid', 'sweep'].includes(mode)) fail("'mode' must be 'single', 'grid' or 'sweep'");
    if (mode === 'sweep') {
      // A sweep is authored from its pivot: p + len + period, swinging through `arc` RADIANS.
      if (!isVec(def.p)) fail("mode 'sweep' needs 'p' (the pivot) as a finite [x,y,z]");
      if (!(isNum(def.period) && def.period > 0)) fail("mode 'sweep' needs 'period' > 0 SECONDS");
      if (def.len != null && !(isNum(def.len) && def.len > 0)) fail("'len' must be > 0 METRES");
      if (def.arc != null && !isNum(def.arc)) fail("'arc' must be a finite number in RADIANS");
      return;
    }
    if (!isVec(def.a) || !isVec(def.b)) fail(`mode '${mode}' needs 'a' and 'b' as finite [x,y,z] endpoints`);
    else if (sameVec(def.a, def.b)) fail("'a' and 'b' are the same point — a beam needs length");
    if (def.count != null && !(isNum(def.count) && def.count >= 1)) fail("'count' must be a number >= 1");
  },
  flame(def, fail) {
    if (def.len != null && !(isNum(def.len) && def.len > 0)) fail("'len' must be > 0 METRES");
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
  },
  chase(def, fail) {
    if (def.from === def.to) fail("'from' equals 'to' — the chase would never move");
    if (!(def.speed > 0)) fail(`'speed' must be > 0, got ${brief(def.speed)}`);
    if (def.axis != null && !isAxis(def.axis)) fail("'axis' must be 'x', 'y' or 'z'");
    if (def.mat != null && !['lava', 'void', 'wall'].includes(def.mat)) {
      fail("'mat' must be 'lava', 'void' or 'wall'");
    }
  },
  jumppad(def, fail) {
    if (!(def.power > 0)) fail("'power' is the TARGET APEX IN METRES and must be > 0");
  },
  risinglava(def, fail) {
    const r = def.rising || def;
    if (!isNum(r.from) || !isNum(r.to)) fail("rising lava needs numeric 'rising.from' and 'rising.to' (METRES)");
    else if (r.to <= r.from) fail("'rising.to' must be above 'rising.from'");
    if (r.speed != null && !(isNum(r.speed) && r.speed > 0)) fail("'rising.speed' must be > 0 M/S");
  },
  lava(def, fail) {
    if (def.rising) SEMANTIC.risinglava(def, fail);
  },
  spikes(def, fail) {
    if (def.mode != null && !['static', 'retract', 'wall'].includes(def.mode)) {
      fail("'mode' must be 'static', 'retract' or 'wall'");
    }
    if (def.mode === 'retract' && def.cycle != null && !isObj(def.cycle)) {
      fail("'cycle' must be an object {on, off, warn, phase} in SECONDS");
    }
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
  },
  vanish(def, fail) {
    const mode = String(def.mode || 'cycle').toLowerCase();
    if (!['cycle', 'flicker', 'crumble'].includes(mode)) {
      fail("'mode' must be 'cycle', 'flicker' or 'crumble'");
    }
    if (mode === 'crumble') return;   // crumble ignores `cycle` — crackDelay/chunkLife drive it
    if (!isObj(def.cycle)) fail(`mode '${mode}' requires 'cycle' as an object {on, off, warn, phase} in SECONDS`);
  },
  conveyor(def, fail) {
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
    if (def.power === 0) fail("'power' is the belt speed in M/S and must be non-zero");
  },
  wind(def, fail) {
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
  },
  current(def, fail) {
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
    if (!(def.power > 0)) fail("'power' is the flow speed in M/S and must be > 0");
  },
  speedpad(def, fail) {
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
    // surfaces.js defaults `power` to TUNE.speedRun; only a PRESENT power can be wrong.
    if (def.power != null && !(isNum(def.power) && def.power > 0)) fail(`'power' must be > 0 M/S, got ${brief(def.power)}`);
  },
  quicksand(def, fail) {
    if (def.sink != null && !(isNum(def.sink) && def.sink > 0)) fail("'sink' must be > 0 M/S");
  },
  breakable(def, fail) {
    if (def.drop != null && !['coins', 'crest', 'none'].includes(String(def.drop))) {
      fail("'drop' must be 'coins', 'crest' or 'none'");
    }
    // `openOn` also names a trigger this crate is wired to (the INPUT direction: a cage some
    // other object unlocks). breakable.js reads all three, and derives a stable positional id
    // when none is given, so a nameless crate is legal — only a crest with NO wiring at all is
    // worth refusing.
    if (String(def.drop) === 'crest' && !def.trigger && !def.id && !def.openOn) {
      fail("drop:'crest' needs a 'trigger', 'openOn' (or 'id') naming the trigger a `secret` crest is wired to");
    }
    if (def.respawn != null && !(isNum(def.respawn) && def.respawn >= 0)) fail("'respawn' must be >= 0 SECONDS");
  },
  sinker(def, fail) {
    if (def.speed != null && !(isNum(def.speed) && def.speed > 0)) fail("'speed' must be > 0 M/S");
    if (def.delay != null && !(isNum(def.delay) && def.delay >= 0)) fail("'delay' must be >= 0 SECONDS");
    if (def.depth != null && !(isNum(def.depth) && def.depth > 0)) fail("'depth' must be > 0 METRES");
  },
  seesaw(def, fail) {
    if (def.maxDeg != null && !(isNum(def.maxDeg) && def.maxDeg > 0)) fail("'maxDeg' must be > 0 DEGREES");
    if (def.maxTilt != null && !(isNum(def.maxTilt) && def.maxTilt > 0)) fail("'maxTilt' must be > 0 RADIANS");
    if (def.spring != null && !(isNum(def.spring) && def.spring > 0)) fail("'spring' must be > 0");
    if (def.axis != null && !isAxis(def.axis) && !isVec(def.axis)) fail("'axis' must be 'x'|'y'|'z' or a finite [x,y,z]");
  },
  cannon(def, fail) {
    const hasTarget = def.target != null && def.target !== null;
    if (hasTarget && !isVec(def.target)) fail("'target' must be a finite [x,y,z]");
    if (!hasTarget && !(isNum(def.power) && def.power > 0)) {
      fail("a cannon needs 'power' (the launch SPEED in M/S) or a 'target' to solve for");
    }
    if (def.pitch != null && !isNum(def.pitch)) fail("'pitch' must be a finite number in RADIANS (use 'pitchDeg' for degrees)");
    if (def.pitchDeg != null && !isNum(def.pitchDeg)) fail("'pitchDeg' must be a finite number in DEGREES");
    if (def.cooldown != null && !(isNum(def.cooldown) && def.cooldown > 0)) fail("'cooldown' must be > 0 SECONDS");
  },
  rings(def, fail) {
    if (!Array.isArray(def.pts) || def.pts.length < 2) fail("'pts' must be an array of at least 2 [x,y,z] points");
    else {
      for (let i = 0; i < def.pts.length; i++) {
        if (!isVec(def.pts[i])) { fail(`'pts[${i}]' must be a finite [x,y,z], got ${brief(def.pts[i])}`); break; }
      }
    }
    if (def.r != null && !(isNum(def.r) && def.r > 0)) fail("'r' must be > 0 METRES");
    if (def.limitMs != null && !(isNum(def.limitMs) && def.limitMs >= 0)) fail("'limitMs' must be >= 0 MILLISECONDS");
  },
  sandboard(def, fail) {
    const hasPts = Array.isArray(def.pts) && def.pts.length >= 2;
    if (!hasPts) {
      if (!isVec(def.a) || !isVec(def.b)) fail("needs 'a' and 'b' (the top and bottom of the chute) or a 'pts' polyline of >= 2 points");
      else if (sameVec(def.a, def.b)) fail("'a' and 'b' are the same point — a chute needs length");
    } else {
      for (let i = 0; i < def.pts.length; i++) {
        if (!isVec(def.pts[i])) { fail(`'pts[${i}]' must be a finite [x,y,z], got ${brief(def.pts[i])}`); break; }
      }
    }
    if (def.w != null && !(isNum(def.w) && def.w > 0)) fail("'w' must be > 0 METRES");
    if (def.minSpeed != null && !(isNum(def.minSpeed) && def.minSpeed > 0)) fail("'minSpeed' must be > 0 M/S");
  },
  mover(def, fail) {
    const m = def.motion || {};
    const type = String(m.type || 'linear').toLowerCase();
    if (!['linear', 'circle', 'orbit', 'oscillate', 'sink', 'elevator'].includes(type)) {
      fail("'motion.type' must be 'linear', 'circle', 'orbit', 'oscillate', 'sink' or 'elevator'");
    }
    if ((type === 'linear' || type === 'oscillate') && m.to === undefined && m.amp === undefined) {
      fail(`'motion.type' '${type}' needs 'motion.to' (a world point) or 'motion.amp' (METRES)`);
    }
    if ((type === 'circle' || type === 'orbit') && m.radius != null && !(isNum(m.radius) && m.radius > 0)) {
      fail("'motion.radius' must be > 0 METRES");
    }
    if (m.phase != null && !isNum(m.phase)) fail("'motion.phase' must be a finite FRACTION of a cycle (0..1)");
  },
};

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function isAxis(v) { return v === 'x' || v === 'y' || v === 'z'; }
/** 'x'|'y'|'z' with an optional leading sign — the shorthand `dirVec()` accepts. */
function isDirString(v) {
  return typeof v === 'string' && /^[+-]?[xyz]$/i.test(v.trim());
}
function isVec(v) {
  if (Array.isArray(v)) return v.length >= 3 && isNum(v[0]) && isNum(v[1]) && isNum(v[2]);
  return !!v && typeof v === 'object' && isNum(v.x) && isNum(v.y) && isNum(v.z);
}
function vecAt(v, i) { return Array.isArray(v) ? v[i] : v[['x', 'y', 'z'][i]]; }
function vecLen(v) {
  const x = vecAt(v, 0), y = vecAt(v, 1), z = vecAt(v, 2);
  return Math.sqrt(x * x + y * y + z * z);
}
function sameVec(a, b) {
  if (!isVec(a) || !isVec(b)) return false;
  for (let i = 0; i < 3; i++) if (Math.abs(vecAt(a, i) - vecAt(b, i)) > 1e-6) return false;
  return true;
}

function typeOk(kindOfType, value) {
  switch (kindOfType) {
    case 'vec3': return isVec(value);
    case 'dir': return isVec(value) || isDirString(value);
    case 'number': return isNum(value);
    case 'object': return isObj(value);
    case 'array': return Array.isArray(value) && value.length > 0;
    case 'axis': return isAxis(value);
    default: return value !== undefined;
  }
}

function brief(def) {
  try {
    const s = JSON.stringify(def);
    if (typeof s !== 'string') return String(def);
    return s.length > 260 ? s.slice(0, 257) + '...' : s;
  } catch (e) {
    return '[def could not be serialised]';
  }
}

/** Human locator for an offending course object — course id, index, id/name, then the raw def. */
export function describeDef(def, ctx) {
  const bits = [];
  const courseId = ctx && (ctx.courseId
    || (ctx.course && ctx.course.def && ctx.course.def.id)
    || (ctx.stageId)
    || (ctx.def && ctx.def.id));
  if (courseId) bits.push(`course '${courseId}'`);
  let index;
  if (def && def.__index !== undefined) index = def.__index;
  else if (ctx && ctx.objectIndex !== undefined) index = ctx.objectIndex;
  else if (ctx && ctx.index !== undefined) index = ctx.index;
  if (index !== undefined) bits.push(`objects[${index}]`);
  if (def && def.id !== undefined) bits.push(`id '${def.id}'`);
  else if (def && def.name !== undefined) bits.push(`name '${def.name}'`);
  bits.push(`kind '${def ? def.kind : def}'`);
  return bits.join(' / ') + ' :: ' + brief(def);
}

/**
 * Throw a HazardDefError unless `def` carries everything its kind needs.
 * Aliases are resolved first, so `{kind:'saw'}` is validated as a rotor.
 * Exported so `_harness/reachcheck.mjs` can lint a course file without building anything.
 */
export function validateHazardDef(rawDef, ctx) {
  if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) {
    throw new HazardDefError(`hazard def must be an object, received ${brief(rawDef)}`, rawDef);
  }
  if (typeof rawDef.kind !== 'string' || rawDef.kind.length === 0) {
    throw new HazardDefError(`hazard def is missing a string 'kind' — ${describeDef(rawDef, ctx)}`, rawDef);
  }
  const def = resolveAlias(rawDef);
  const where = () => describeDef(rawDef, ctx);
  const kind = def.kind;

  const spec = REQUIRED[kind];
  if (spec) {
    const missing = [];
    const wrong = [];
    for (const field in spec) {
      const want = spec[field];
      const value = def[field];
      if (value === undefined || value === null) { missing.push(`${field}:${want}`); continue; }
      if (!typeOk(want, value)) wrong.push(`${field} should be ${want}, got ${brief(value)}`);
    }
    if (missing.length) {
      throw new HazardDefError(
        `hazard '${kind}' is missing required field(s) ${missing.join(', ')} — ${where()}`, rawDef,
      );
    }
    if (wrong.length) {
      throw new HazardDefError(
        `hazard '${kind}' has malformed field(s): ${wrong.join('; ')} — ${where()}`, rawDef,
      );
    }
  }
  const fail = (msg) => {
    throw new HazardDefError(`hazard '${kind}': ${msg} — ${where()}`, rawDef);
  };
  if (spec) commonSemantic(def, fail);
  const extra = SEMANTIC[kind];
  if (extra) extra(def, fail);
  return true;
}

/* ======================================================================================
   BUILD
   ====================================================================================== */

/**
 * Look up `def.kind` (resolving aliases), validate the def, and build the hazard.
 *
 * @param {object} def  a course ObjectDef (CONTRACT §25)
 * @param {object} ctx  {mats, fx, audio, post, cam, theme|themeId, quality, broadphase,
 *                       player?, course?, courseId?, events?, collectibles?, objectIndex?}
 *                      — every field is optional; hazards degrade rather than throw when an
 *                      optional service is absent.
 * @returns {import('./lasers.js').Hazard}
 * @throws {HazardDefError} naming the offending course object.
 */
export function makeHazard(def, ctx) {
  validateHazardDef(def, ctx);
  const resolved = resolveAlias(def);
  const kind = resolved.kind;
  const factory = HAZARDS[kind];

  if (typeof factory !== 'function') {
    const meta = HAZARD_META[kind];
    if (meta && meta.builder) {
      throw new HazardDefError(
        `'${kind}' is a builder kind, not a hazard — route it to runtime/world/builders.js `
        + `instead of makeHazard. Offending object: ${describeDef(def, ctx)}`,
        def,
      );
    }
    throw new HazardDefError(
      `unknown hazard kind '${kind}'. Known kinds: ${HAZARD_KIND_LIST.join(', ')} `
      + `(aliases: ${HAZARD_ALIAS_LIST.join(', ')}). Offending object: ${describeDef(def, ctx)}`,
      def,
    );
  }

  let hz;
  try {
    hz = factory(resolved, ctx || {});
  } catch (err) {
    if (err instanceof HazardDefError) throw err;
    throw new HazardDefError(
      `failed to build ${describeDef(def, ctx)} — ${err && err.message ? err.message : String(err)}`,
      def,
      err,
    );
  }

  if (!hz || typeof hz !== 'object' || !hz.mesh || typeof hz.update !== 'function') {
    throw new HazardDefError(
      `factory for '${kind}' did not return a Hazard {mesh, colliders, kills, volumes, update, `
      + `reset, onStand, onPound, dispose}. Offending object: ${describeDef(def, ctx)}`,
      def,
    );
  }

  // Normalise the shape so a Course can iterate every hazard uniformly, whichever author built
  // it and whether it is a Hazard subclass or a plain factory object.
  if (!Array.isArray(hz.colliders)) hz.colliders = [];
  if (!Array.isArray(hz.kills)) hz.kills = [];
  if (!Array.isArray(hz.volumes)) hz.volumes = [];
  if (!Array.isArray(hz.fields)) hz.fields = [];
  if (typeof hz.reset !== 'function') hz.reset = function resetFallback(t) { this.update(t, 0, null); };
  if (typeof hz.onStand !== 'function') hz.onStand = function onStandNoop() {};
  if (typeof hz.onPound !== 'function') hz.onPound = function onPoundNoop() {};
  if (typeof hz.onTouch !== 'function') hz.onTouch = function onTouchNoop() {};
  if (typeof hz.dispose !== 'function') hz.dispose = function disposeNoop() {};
  if (hz.enabled === undefined) hz.enabled = true;
  if (hz.kind === undefined) hz.kind = kind;
  if (hz.def === undefined) hz.def = resolved;
  if (hz.meta === undefined) hz.meta = HAZARD_META[kind] || null;

  // Every collider, kill volume and influence volume must point back at its owner: the player
  // needs `ref` to fire surface hooks and to attribute a death cause.
  for (const c of hz.colliders) { if (c && (c.ref === undefined || c.ref === null)) c.ref = hz; }
  for (const k of hz.kills) { if (k && (k.ref === undefined || k.ref === null)) k.ref = hz; }
  for (const v of hz.volumes) { if (v && (v.ref === undefined || v.ref === null)) v.ref = hz; }

  return hz;
}

export default HAZARDS;
