// runtime/hazards/index.js
// ASCENDANT — the hazard registry (CONTRACT §16).
//
// `HAZARDS[kind](def, ctx) -> Hazard` for every hazard kind a stage can emit, plus `makeHazard`
// (lookup + validation with an error that names the offending stage object) and `HAZARD_META`
// (used by the stage validator and the HUD legend).
//
// This module is ALSO the routing authority: `KIND_ROUTE` / `routeOf(kind)` say whether a section-18
// kind is built here or by runtime/world/builders.js. Nothing downstream keeps its own kind lists —
// duplicating them is what let `ice` drift onto the static path and strand IceHazard/StickyHazard.
//
// IMPORT ORDER MATTERS. `./lasers.js` is requested FIRST, and `Hazard` is re-exported from it
// rather than declared here, so that a sibling doing `import { Hazard } from './index.js'` links
// against a binding that is already initialised when its own module body runs. Declaring the class
// in this file would put it in the temporal dead zone for any sibling that extends it at module
// scope — a cycle this package cannot afford, since half of it is written by another author.
export { Hazard } from './lasers.js';

import * as lasersMod from './lasers.js';
import * as lavaMod from './lava.js';
import * as spikesMod from './spikes.js';
import * as surfacesMod from './surfaces.js';
import * as chaseMod from './chase.js';

// Kinetic hazards — owned by another author. Imported as NAMESPACES on purpose: a namespace import
// yields `undefined` for an export that is not there, where a named import would be a hard link
// error that takes the whole game down. `resolve()` below turns a missing export into a precise,
// actionable message at build time instead.
import * as moversMod from './movers.js';
import * as rotorsMod from './rotors.js';
import * as vanishMod from './vanish.js';
import * as crushersMod from './crushers.js';
import * as pendulumMod from './pendulum.js';

// WORLD 5 (PRISM CROWN) light traps. Same namespace-import discipline as the
// kinetic modules: a missing export becomes a precise build-time message via
// resolve(), never a hard link error. bloom.js also owns SPEED_BY_BAND — the
// game-wide band->speed LAW that SEMANTIC.bloom enforces (brief §5/§6-3).
import * as prismgateMod from './prismgate.js';
import * as bloomMod from './bloom.js';

/* ======================================================================================
   FACTORY RESOLUTION
   ====================================================================================== */

const MODULE_FILES = new Map([
  [moversMod, './movers.js'],
  [rotorsMod, './rotors.js'],
  [vanishMod, './vanish.js'],
  [crushersMod, './crushers.js'],
  [pendulumMod, './pendulum.js'],
  [prismgateMod, './prismgate.js'],
  [bloomMod, './bloom.js'],
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
 * throws at the moment a stage actually asks for that hazard, naming the file and the export the
 * kinetic-hazard module is expected to provide.
 */
function unresolved(kind, mods, names) {
  const files = mods.map((m) => MODULE_FILES.get(m)).filter(Boolean).join(' or ');
  return function unresolvedFactory(def) {
    throw new HazardDefError(
      `hazard kind '${kind}' is declared in CONTRACT section 16 but no factory was found. `
      + `Expected ${files || 'a sibling hazard module'} to export one of: ${names.join(', ')}.`,
      def,
    );
  };
}

function bind(kind, mods, names) {
  return resolve(mods, names) || unresolved(kind, mods, names);
}

const mover = bind('mover', [moversMod], ['mover', 'makeMover', 'createMover', 'movingPlatform']);
const vanish = bind('vanish', [vanishMod], ['vanish', 'makeVanish', 'vanishing', 'vanishPlatform']);
const rotor = bind('rotor', [rotorsMod], ['rotor', 'makeRotor', 'createRotor']);
const pendulum = bind('pendulum', [pendulumMod], ['pendulum', 'makePendulum', 'createPendulum']);
const crusher = bind('crusher', [crushersMod], ['crusher', 'makeCrusher', 'createCrusher']);
const prismgate = bind('prismgate', [prismgateMod], ['prismgate', 'makePrismgate', 'createPrismgate']);
const bloom = bind('bloom', [bloomMod], ['bloom', 'makeBloom', 'createBloom']);

// `saw` is a rotor style in CONTRACT section 18 (`rotor.style: 'saw'`), so if rotors.js does not
// export a dedicated factory the rotor factory is driven with the style forced — a real
// implementation, not a stub.
const sawDirect = resolve([rotorsMod], ['saw', 'makeSaw', 'sawBlade']);
const saw = sawDirect || function sawViaRotor(def, ctx) {
  return rotor(Object.assign({}, def, { kind: 'rotor', style: 'saw' }), ctx);
};

// `turret` appears in the section 16 list but has no section 18 ObjectDef and was not assigned to
// the kinetic-hazard module; the beam module implements it. A sibling implementation wins if one
// turns up, so ownership can move without touching this file.
const turret = resolve([rotorsMod, moversMod, crushersMod], ['turret', 'makeTurret'])
  || lasersMod.turret;

/* ======================================================================================
   THE REGISTRY
   ====================================================================================== */

/**
 * Every hazard kind a stage may emit. Builder kinds ('platform', 'beam', 'deco', 'text', 'light')
 * are deliberately absent — they belong to runtime/world/builders.js. A stage loader routes with
 * `KIND_ROUTE` / `routeOf()` below, which is derived from this object plus HAZARD_META.
 */
export const HAZARDS = {
  // kinetic (movers.js / rotors.js / vanish.js / crushers.js / pendulum.js)
  mover,
  vanish,
  rotor,
  pendulum,
  crusher,
  saw,

  // fields and volumes (this half of the package)
  laser: lasersMod.laser,
  lasergrid: lasersMod.laserGrid,
  lasersweep: lasersMod.laserSweep,
  turret,
  lava: lavaMod.lava,
  risinglava: lavaMod.risinglava,
  spikes: spikesMod.spikes,
  chase: chaseMod.chase,

  // light traps — WORLD 5 PRISM CROWN (prismgate.js / bloom.js). Adding them
  // here routes them automatically via KIND_ROUTE — they can never be
  // silently unreachable (brief §8-2).
  prismgate,
  bloom,

  // surfaces
  ice: surfacesMod.ice,
  conveyor: surfacesMod.conveyor,
  jumppad: surfacesMod.jumppad,
  speedpad: surfacesMod.speedpad,
  wind: surfacesMod.wind,
  sticky: surfacesMod.sticky,
};

/**
 * Stage-validator and HUD-legend metadata.
 *   label     — human name for the legend / stage-select blurb
 *   killer    — can this kill the player outright?
 *   solid     — does it contribute standable colliders?
 *   telegraph — does it warn before it becomes dangerous? (a `false` here on a killer is a design
 *               smell the validator should flag unless the hazard is permanently lethal)
 *   builder   — true for section 18 kinds handled by runtime/world/builders.js, not by HAZARDS
 *   field     — true when it contributes non-solid influence volumes via `hazard.fields`
 */
export const HAZARD_META = {
  mover:      { label: 'Moving Platform',  killer: false, solid: true,  telegraph: false },
  vanish:     { label: 'Vanishing Tile',   killer: false, solid: true,  telegraph: true },
  rotor:      { label: 'Rotor Arm',        killer: true,  solid: true,  telegraph: false },
  pendulum:   { label: 'Pendulum Blade',   killer: true,  solid: false, telegraph: false },
  crusher:    { label: 'Crusher',          killer: true,  solid: true,  telegraph: true },
  saw:        { label: 'Saw Blade',        killer: true,  solid: false, telegraph: false },

  laser:      { label: 'Laser Beam',       killer: true,  solid: false, telegraph: true },
  lasergrid:  { label: 'Laser Grid',       killer: true,  solid: false, telegraph: true },
  lasersweep: { label: 'Sweeping Laser',   killer: true,  solid: false, telegraph: true },
  turret:     { label: 'Bolt Turret',      killer: true,  solid: true,  telegraph: true },
  lava:       { label: 'Lava',             killer: true,  solid: false, telegraph: false },
  risinglava: { label: 'Rising Lava',      killer: true,  solid: false, telegraph: true },
  spikes:     { label: 'Spikes',           killer: true,  solid: true,  telegraph: true },
  chase:      { label: 'Chase Wall',       killer: true,  solid: false, telegraph: true },

  // WORLD 5 light traps — killer + solid:false ON PURPOSE: a failed read is a
  // death, never a wall-bonk ambiguity, and reachcheck's LANDABLE set stays
  // untouched (neither contributes standable surface — brief §8-1).
  prismgate:  { label: 'Prism Gate',       killer: true,  solid: false, telegraph: true },
  bloom:      { label: 'Colour Bloom',     killer: true,  solid: false, telegraph: true },

  ice:        { label: 'Ice',              killer: false, solid: true,  telegraph: false },
  conveyor:   { label: 'Conveyor',         killer: false, solid: true,  telegraph: false },
  jumppad:    { label: 'Launch Pad',       killer: false, solid: true,  telegraph: false },
  speedpad:   { label: 'Speed Pad',        killer: false, solid: true,  telegraph: false },
  wind:       { label: 'Wind',             killer: false, solid: false, telegraph: true, field: true },
  sticky:     { label: 'Tar',              killer: false, solid: true,  telegraph: false },

  // Section 18 kinds that are NOT hazards. Listed so the stage validator can accept them and the
  // HUD legend can skip them; `makeHazard` refuses them with a routing message.
  platform:   { label: 'Platform',         killer: false, solid: true,  telegraph: false, builder: true },
  beam:       { label: 'Beam',             killer: false, solid: true,  telegraph: false, builder: true },
  deco:       { label: 'Decoration',       killer: false, solid: false, telegraph: false, builder: true },
  text:       { label: 'Signage',          killer: false, solid: false, telegraph: false, builder: true },
  light:      { label: 'Light',            killer: false, solid: false, telegraph: false, builder: true },
};

/**
 * Every kind `makeHazard` will build, as an ARRAY (for error messages and the HUD legend).
 *
 * Named `HAZARD_KIND_LIST`, not `HAZARD_KINDS`: a stage loader that wants a membership test
 * must use `KIND_ROUTE` / `routeOf` below. The old name invited a consumer to shadow it with a
 * local `Set` of the same name and drift — which is exactly how `ice` ended up routed to the
 * static builder path and `sticky` / `lasergrid` / `lasersweep` ended up unroutable.
 */
export const HAZARD_KIND_LIST = Object.keys(HAZARDS);

/**
 * THE ROUTING TABLE — the single source of truth for "who builds this kind".
 *
 *   'hazard'  -> makeHazard(def, ctx)                       (this module)
 *   'builder' -> runtime/world/builders.js via Stage._buildStatic
 *
 * Derived, never hand-listed: a kind is a builder only where HAZARD_META says so, and every
 * key of HAZARDS is a hazard. Adding a factory to HAZARDS routes it automatically, so a new
 * hazard can never be silently unreachable.
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
  return Object.freeze(table);
})();

/** @returns {'hazard'|'builder'|null} how `kind` must be built, or null if it is not a kind. */
export function routeOf(kind) {
  if (typeof kind !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(KIND_ROUTE, kind) ? KIND_ROUTE[kind] : null;
}

export function isHazardKind(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(HAZARDS, kind);
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
 * a stage author should be able to drop `{kind:'lava', p, s}` and get a good-looking pool.
 *   'vec3'   — [x,y,z] | {x,y,z}
 *   'number' — finite number
 *   'object' — a plain object (motion / cycle blocks)
 *   'axis'   — 'x' | 'y' | 'z'
 */
const REQUIRED = {
  mover:      { p: 'vec3', s: 'vec3', motion: 'object' },
  vanish:     { p: 'vec3', s: 'vec3' },   // `cycle` is mode-dependent — see SEMANTIC.vanish
  rotor:      { p: 'vec3', period: 'number' },
  // `amp` is RADIANS; pendulum.js:295 also reads `ampDeg` as the documented degrees
  // convenience, and four shipped pendulums (foundry-3 x2, spire-1, temple-2) author it.
  // Requiring `amp` here rejected them BEFORE the factory ran: Stage.validate passed the
  // stage, makeHazard threw, _buildHazard logged and dropped them — three stages shipped
  // with missing blades and every static gate stayed green. amp|ampDeg is SEMANTIC.pendulum.
  pendulum:   { p: 'vec3', len: 'number', period: 'number' },
  crusher:    { p: 'vec3', s: 'vec3', travel: 'number', period: 'number' },
  saw:        { p: 'vec3', period: 'number' },

  laser:      { a: 'vec3', b: 'vec3', cycle: 'object' },
  lasergrid:  { a: 'vec3', b: 'vec3', cycle: 'object' },
  lasersweep: { p: 'vec3', period: 'number' },
  turret:     { p: 'vec3', period: 'number' },
  lava:       { p: 'vec3', s: 'vec3' },
  risinglava: { p: 'vec3', s: 'vec3' },
  spikes:     { p: 'vec3', s: 'vec3' },
  chase:      { from: 'number', to: 'number', speed: 'number' },

  // WORLD 5 light traps. `seq` (prismgate) and `gaps` (bloom) are ARRAYS, and
  // this table's 'object' check is isObj(), which REJECTS arrays (see line
  // ~381 below) — so they validate in SEMANTIC, never here (brief §4, graft
  // J1-5: requiring them here would drop every gate the way REQUIRED.amp once
  // dropped four shipped pendulums).
  prismgate:  { p: 'vec3', s: 'vec3', period: 'number' },
  bloom:      { p: 'vec3', rmax: 'number', period: 'number' },

  ice:        { p: 'vec3', s: 'vec3' },
  conveyor:   { p: 'vec3', s: 'vec3', dir: 'vec3', power: 'number' },
  jumppad:    { p: 'vec3', power: 'number' },
  speedpad:   { p: 'vec3', dir: 'vec3' },
  wind:       { p: 'vec3', s: 'vec3', dir: 'vec3', power: 'number' },
  sticky:     { p: 'vec3', s: 'vec3' },
};

/**
 * Sanity every hazard kind shares — a zero period is an infinite loop or a NaN, a negative
 * cycle window is a phase that never comes. These used to live only in Stage.validate, which
 * meant the stage validator and this contract could (and did) drift apart; the stage
 * validator now delegates every hazard-routed object here, so this is the single owner.
 */
function commonSemantic(def, fail) {
  if (def.period !== undefined && !(isNum(def.period) && def.period > 0)) {
    fail(`'period' must be > 0, got ${brief(def.period)}`);
  }
  const m = def.motion;
  if (isObj(m)) {
    if (m.period !== undefined && !(isNum(m.period) && m.period > 0)) {
      fail(`'motion.period' must be > 0, got ${brief(m.period)}`);
    }
    if (m.to !== undefined && m.to !== null && !isVec(m.to)) fail("'motion.to' must be a finite [x,y,z]");
  }
  const c = def.cycle;
  if (c !== undefined && c !== null) {
    if (!isObj(c)) fail("'cycle' must be an object {on, off, warn, phase}");
    const on = +c.on, off = +c.off;
    if (c.on !== undefined && !(isNum(on) && on >= 0)) fail(`'cycle.on' must be a finite number >= 0, got ${brief(c.on)}`);
    if (c.off !== undefined && !(isNum(off) && off >= 0)) fail(`'cycle.off' must be a finite number >= 0, got ${brief(c.off)}`);
    if (c.on !== undefined && c.off !== undefined && on + off <= 0) fail("'cycle.on' + 'cycle.off' must be > 0 (the period would be zero)");
    if (c.warn !== undefined && !(isNum(c.warn) && c.warn >= 0)) fail("'cycle.warn' must be a finite number >= 0");
  }
}

/** Extra checks that a type table cannot express. */
const SEMANTIC = {
  rotor(def, fail) {
    // rotors.js:299 defaults `len` (6 m bar / 2.2 m saw); only a PRESENT len can be wrong.
    if (def.len !== undefined && !(isNum(def.len) && def.len > 0)) fail(`'len' must be > 0, got ${brief(def.len)}`);
    if (def.arms !== undefined && !(isNum(def.arms) && def.arms >= 1)) fail(`'arms' must be >= 1, got ${brief(def.arms)}`);
  },
  saw(def, fail) {
    if (def.len !== undefined && !(isNum(def.len) && def.len > 0)) fail(`'len' must be > 0, got ${brief(def.len)}`);
  },
  pendulum(def, fail) {
    // pendulum.js:295-297 — `ampDeg` (degrees) wins when present, else `amp` (radians).
    const hasDeg = def.ampDeg !== undefined && def.ampDeg !== null;
    const hasRad = def.amp !== undefined && def.amp !== null;
    if (!hasDeg && !hasRad) fail("needs a swing amplitude: 'amp' (radians) or 'ampDeg' (degrees)");
    if (hasDeg && !isNum(def.ampDeg)) fail(`'ampDeg' must be a finite number, got ${brief(def.ampDeg)}`);
    if (!hasDeg && hasRad && !isNum(def.amp)) fail(`'amp' must be a finite number, got ${brief(def.amp)}`);
    if (!(def.len > 0)) fail(`'len' must be > 0, got ${brief(def.len)}`);
  },
  crusher(def, fail) {
    if (def.travel === 0) fail("'travel' must be a non-zero finite number, got 0");
  },
  laser(def, fail) {
    if (sameVec(def.a, def.b)) fail("'a' and 'b' are the same point — a laser needs length");
  },
  lasergrid(def, fail) {
    if (sameVec(def.a, def.b)) fail("'a' and 'b' are the same point — a laser grid needs length");
    if (def.count !== undefined && !(isNum(def.count) && def.count >= 1)) fail("'count' must be a number >= 1");
  },
  chase(def, fail) {
    if (def.from === def.to) fail("'from' equals 'to' — the chase would never move");
    if (!(def.speed > 0)) fail(`'speed' must be > 0, got ${brief(def.speed)}`);
    if (def.axis !== undefined && !isAxis(def.axis)) fail("'axis' must be 'x', 'y' or 'z'");
    if (def.mat !== undefined && !['lava', 'void', 'wall'].includes(def.mat)) {
      fail("'mat' must be 'lava', 'void' or 'wall'");
    }
  },
  jumppad(def, fail) {
    if (!(def.power > 0)) fail("'power' is the TARGET APEX IN METRES and must be > 0");
  },
  risinglava(def, fail) {
    const r = def.rising || def;
    if (!isNum(r.from) || !isNum(r.to)) fail("rising lava needs numeric 'rising.from' and 'rising.to'");
    else if (r.to <= r.from) fail("'rising.to' must be above 'rising.from'");
  },
  spikes(def, fail) {
    if (def.mode !== undefined && !['static', 'retract', 'wall'].includes(def.mode)) {
      fail("'mode' must be 'static', 'retract' or 'wall'");
    }
    if (def.mode === 'retract' && def.cycle !== undefined && !isObj(def.cycle)) {
      fail("'cycle' must be an object {on, off, warn, phase}");
    }
  },
  vanish(def, fail) {
    const mode = String(def.mode || 'cycle').toLowerCase();
    if (!['cycle', 'flicker', 'crumble'].includes(mode)) {
      fail("'mode' must be 'cycle', 'flicker' or 'crumble'");
    }
    if (mode === 'crumble') return; // crumble ignores `cycle` — crackDelay/chunkLife drive it (vanish.js)
    if (!isObj(def.cycle)) fail(`mode '${mode}' requires 'cycle' as an object {on, off, warn, phase}`);
  },
  conveyor(def, fail) {
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
  },
  wind(def, fail) {
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
  },
  speedpad(def, fail) {
    if (isVec(def.dir) && vecLen(def.dir) < 1e-6) fail("'dir' has zero length");
    // surfaces.js:859 defaults `power` to the sprint speed; only a PRESENT power can be wrong.
    if (def.power !== undefined && !(isNum(def.power) && def.power > 0)) fail(`'power' must be > 0, got ${brief(def.power)}`);
  },
  // WORLD 5 §4 — every law here is a fairness bound with a measured number
  // behind it; see prismgate.js header for the update(t) maths they protect.
  prismgate(def, fail) {
    const seq = def.seq;
    if (!Array.isArray(seq) || seq.length === 0) {
      fail("'seq' must be a non-empty array of slot/band indices 0..6 — arrays cannot pass REQUIRED's isObj check, so seq is validated here (graft J1-5)");
    }
    for (let i = 0; i < seq.length; i++) {
      if (!Number.isInteger(seq[i]) || seq[i] < 0 || seq[i] > 6) {
        fail(`'seq[${i}]' must be an integer 0..6 (slot index = hue = position), got ${brief(seq[i])}`);
      }
    }
    const dwell = def.dwell === undefined ? 2.4 : def.dwell;
    const travel = def.travel === undefined ? 0.5 : def.travel;
    if (!(isNum(dwell) && dwell > 0)) fail(`'dwell' must be > 0, got ${brief(def.dwell)}`);
    if (!(isNum(travel) && travel > 0)) fail(`'travel' must be > 0, got ${brief(def.travel)}`);
    const w = def.window && def.window.w !== undefined ? def.window.w : 1.6;
    const h = def.window && def.window.h !== undefined ? def.window.h : 2.2;
    if (!(isNum(w) && w >= 1.6)) fail(`'window.w' must be >= 1.6 (player r 0.35 — a narrower window silently demands pixel-perfect lines), got ${brief(w)}`);
    if (!(isNum(h) && h >= 2.2)) fail(`'window.h' must be >= 2.2 (player h 1.8 — crouch is never silently required), got ${brief(h)}`);
    if (def.slots !== undefined && def.slots !== 'y' && def.slots !== 'z') fail("'slots' must be 'y' or 'z'");
    const d = vecAt(def.s, 0);
    if (!(isNum(d) && d > 0 && d <= 0.5)) fail(`'s[0]' (lattice thickness) must be 0 < d <= 0.5, got ${brief(d)}`);
    const span = vecAt(def.s, def.slots === 'y' ? 1 : 2);
    if (!(isNum(span) && span > w)) fail(`slot span ${brief(span)} must exceed 'window.w' ${brief(w)} — the aperture has to fit inside the lattice`);
    // the window is always chaseable AT PEAK, not on average: prismgate.js
    // update() slides the aperture with smoothstep (lerp(prev, cur,
    // smooth01(f/tf))), whose max slope is s'(0.5) = 1.5 — the slide PEAKS at
    // 1.5x the pitch/travel average. The old average-only bound (<= 6.4 m/s)
    // admitted peaks up to 9.6 > run 8.6: rainbow-1 gate 1's wrap 5->1
    // averaged 6.17 m/s but peaked 9.25, and live probes killed the 8.6 m/s
    // chaser at the 0.45 m tracking boundary (w/2 - r = 0.80 - 0.35) from a
    // ~0.25 m slip — 2 of 8 wrap chases died under 40-55 ms frames, while
    // in-sequence slides survived 8/8 with err <= 0.054 m. Law: peak
    // 1.5*pitch/travel <= run 8.6, i.e. average <= 5.73 m/s. Cyclic — the
    // wrap from seq's last stop back to its first is a real slide too.
    let maxStep = 0;
    for (let i = 0; i < seq.length; i++) {
      const dS = Math.abs(seq[i] - seq[(i - 1 + seq.length) % seq.length]);
      if (dS > maxStep) maxStep = dS;
    }
    const pitch = maxStep * (span - w) / 6;
    const peak = 1.5 * pitch / travel; // smoothstep peak dc/dt, NOT the average
    if (peak > 8.6 + 1e-9) {
      fail(`peak aperture speed ${peak.toFixed(2)} m/s exceeds run 8.6 (worst cyclic slot pitch ${pitch.toFixed(2)} m per ${travel} s smoothstep travel = ${(pitch / travel).toFixed(2)} m/s average x 1.5 peak) — the window must stay chaseable at PEAK speed, not on average`);
    }
    const want = seq.length * (dwell + travel);
    if (!isNum(def.period) || Math.abs(def.period - want) > 1e-6) {
      fail(`'period' must equal seq.length*(dwell+travel) = ${want} to 1e-6, got ${brief(def.period)} — the clock must never drift against the stop table`);
    }
    if (def.phase !== undefined && !(isNum(def.phase) && def.phase >= 0 && def.phase <= 1)) fail("'phase' must be 0..1 (a fraction of the period)");
    const rel = def.relay;
    if (rel !== undefined && rel !== null) {
      if (!isObj(rel)) fail("'relay' must be an object {group, index}");
      if (typeof rel.group !== 'string' || rel.group.length === 0) fail("'relay.group' must be a non-empty string");
      if (!Number.isInteger(rel.index) || rel.index < 0) fail("'relay.index' must be an integer >= 0");
    }
  },
  // WORLD 5 §5 — every threshold in SECONDS (the metres/seconds mixup both
  // judges flagged is dead: period >= rmax/speed + quiet compares s to s).
  bloom(def, fail) {
    const SBB = bloomSpeedTable();
    if (!Number.isInteger(def.band) || def.band < 0 || def.band > 6) {
      fail(`'band' must be an integer 0..6 (hue AND speed class in one field), got ${brief(def.band)}`);
    }
    if (def.speed !== undefined || def.speeds !== undefined || def.speedByBand !== undefined) {
      fail("band->speed is the game-wide SPEED_BY_BAND law (bloom.js) — a per-def override is refused (graft J2-3)");
    }
    const ring = def.ring === undefined ? 'low' : def.ring;
    if (ring !== 'low' && ring !== 'high') fail("'ring' must be 'low' (jump it) or 'high' (duck it)");
    if (ring === 'high' && def.ringH !== undefined) {
      fail("HIGH rings are fixed geometry (band 1.25..2.75 m, spheres r 0.75 at deck+2.00) — 'ringH' is refused");
    }
    if (ring === 'low') {
      const rh = def.ringH === undefined ? 1.0 : def.ringH;
      if (!(isNum(rh) && rh > 0 && rh <= 1.1)) {
        fail(`'ringH' must be 0 < ringH <= 1.1 (band top 1.1 vs full-hold apex 2.09 = the >= 0.9 m jump guarantee), got ${brief(def.ringH)}`);
      }
    }
    if (def.ringW !== undefined && !(isNum(def.ringW) && def.ringW > 0)) fail(`'ringW' must be > 0, got ${brief(def.ringW)}`);
    const quiet = def.quiet === undefined ? 1.2 : def.quiet;
    if (!(isNum(quiet) && quiet >= 0)) fail(`'quiet' must be a finite number >= 0, got ${brief(def.quiet)}`);
    if (!(isNum(def.rmax) && def.rmax > 0)) fail(`'rmax' must be > 0, got ${brief(def.rmax)}`);
    const speed = SBB[def.band];
    const life = def.rmax / speed;
    if (!isNum(def.period) || def.period < life + quiet - 1e-9) {
      fail(`'period' ${brief(def.period)} s < rmax/SPEED_BY_BAND[band] + quiet = ${(life + quiet).toFixed(3)} s — one emitter must never stack two live rings`);
    }
    if (life < 0.74 - 1e-9) {
      fail(`ring life rmax/speed = ${life.toFixed(3)} s < 0.74 s (1.2x the 0.615 s airtime) — the edge must stay jumpable`);
    }
    if (def.gaps !== undefined) {
      if (!Array.isArray(def.gaps)) {
        fail("'gaps' must be an array of {fromDeg, toDeg} shadow sectors — arrays cannot pass REQUIRED's isObj check, so gaps are validated here");
      }
      for (let i = 0; i < def.gaps.length; i++) {
        const g = def.gaps[i];
        if (!isObj(g) || !isNum(g.fromDeg) || !isNum(g.toDeg)) fail(`'gaps[${i}]' must be an object {fromDeg, toDeg}`);
        if (g.fromDeg < 0 || g.toDeg > 360 || g.toDeg <= g.fromDeg) fail(`'gaps[${i}]' must satisfy 0 <= fromDeg < toDeg <= 360 (non-inverted)`);
      }
    }
    if (def.phase !== undefined && !(isNum(def.phase) && def.phase >= 0 && def.phase <= 1)) fail("'phase' must be 0..1 (a fraction of the period)");
  },
};

/** The single game-wide band->speed table, or a loud failure if bloom.js lost it. */
function bloomSpeedTable() {
  const t = bloomMod && Array.isArray(bloomMod.SPEED_BY_BAND) ? bloomMod.SPEED_BY_BAND : null;
  if (!t || t.length !== 7) {
    throw new HazardDefError("bloom.js must export SPEED_BY_BAND[7] — the game-wide band->speed law (WORLD 5 §6-3) is missing", null);
  }
  return t;
}

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function isAxis(v) { return v === 'x' || v === 'y' || v === 'z'; }
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
    case 'number': return isNum(value);
    case 'object': return isObj(value);
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

/** Human locator for an offending stage object — stage id, index, id/name, then the raw def. */
export function describeDef(def, ctx) {
  const bits = [];
  const stageId = ctx && (ctx.stageId
    || (ctx.stage && ctx.stage.def && ctx.stage.def.id)
    || (ctx.def && ctx.def.id));
  if (stageId) bits.push(`stage '${stageId}'`);
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
 * Exported so the stage validator (`_harness`) can lint a stage file without building anything.
 */
export function validateHazardDef(def, ctx) {
  const where = () => describeDef(def, ctx);
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    throw new HazardDefError(`hazard def must be an object, received ${brief(def)}`, def);
  }
  const kind = def.kind;
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new HazardDefError(`hazard def is missing a string 'kind' — ${where()}`, def);
  }
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
        `hazard '${kind}' is missing required field(s) ${missing.join(', ')} — ${where()}`, def,
      );
    }
    if (wrong.length) {
      throw new HazardDefError(
        `hazard '${kind}' has malformed field(s): ${wrong.join('; ')} — ${where()}`, def,
      );
    }
  }
  const fail = (msg) => {
    throw new HazardDefError(`hazard '${kind}': ${msg} — ${where()}`, def);
  };
  if (spec) commonSemantic(def, fail);
  const extra = SEMANTIC[kind];
  if (extra) extra(def, fail);
  return true;
}

/* ======================================================================================
   SHARED-CLOCK LAWS — WORLD 5 §6 (group-level, so they cannot live in SEMANTIC's
   one-def-at-a-time view; the staging pass calls this with every def that shares
   one space: a relay group, a bloom pair, a gate court).
   ====================================================================================== */

function gcdInt(x, y) { while (y) { const t = x % y; x = y; y = t; } return x; }
function lcmInt(x, y) { return x / gcdInt(x, y) * y; }

/** Every dwell-open time (stage seconds, within [0, period)) for one prismgate def. */
function gateDwellOpens(def) {
  const seq = Array.isArray(def.seq) && def.seq.length ? def.seq : [0];
  const n = seq.length;
  const dwell = def.dwell === undefined ? 2.4 : def.dwell;
  const travel = def.travel === undefined ? 0.5 : def.travel;
  const P = def.period;
  const tfrac = travel / (dwell + travel);
  const phase = isNum(def.phase) ? def.phase : 0;
  const opens = [];
  // stop k spans u in [k/n, (k+1)/n); travel is the first tfrac of it, so the
  // dwell opens at u = (k + tfrac)/n, i.e. t = ((u - phase) mod 1) * P
  for (let k = 0; k < n; k++) {
    opens.push((((k + tfrac) / n - phase) % 1 + 1) % 1 * P);
  }
  return { opens, dwell, P };
}

/**
 * Law §6-2 dwellOverlap: the longest lead with which SOME dwell of gate `b`
 * opens before SOME dwell of gate `a` closes while still being open AT that
 * close (lead <= b.dwell) — i.e. the best guaranteed handoff for riding the
 * window a -> b. Gates share `period` (checked by the caller), so one cycle
 * covers every alignment.
 */
export function relayDwellOverlap(a, b) {
  const A = gateDwellOpens(a);
  const B = gateDwellOpens(b);
  const P = A.P;
  let best = 0;
  for (let i = 0; i < A.opens.length; i++) {
    const closeA = A.opens[i] + A.dwell;
    for (let j = 0; j < B.opens.length; j++) {
      // shift b's open onto the cycle so it lands in (closeA - P, closeA]
      let o = B.opens[j];
      while (o > closeA) o -= P;
      while (o <= closeA - P) o += P;
      const lead = closeA - o;
      if (lead > 0 && lead <= B.dwell + 1e-9 && lead > best) best = lead;
    }
  }
  return best;
}

/**
 * WORLD 5 §6 shared-clock laws over one court's defs.
 *   §6-1 rational superperiod (WARN): the composite pattern of every `period`
 *        in the court must repeat within 16 s (LCM at 1 ms resolution), or the
 *        compound rhythm is not learnable from one staging-deck observation.
 *   §6-2 relay spill (ERROR): consecutive gates in a relay.group share
 *        `period` to 1e-6 and hand off with dwellOverlap >= 0.4 s — riding the
 *        window through a relay is guaranteed walkable by DATA, never
 *        hand-tuned.
 *   (§6-3, the SPEED_BY_BAND override refusal, is per-def and lives in
 *   SEMANTIC.bloom; §6-4 warn-is-still-solid is vanish.js's own convention.)
 * @param {object[]} defs every hazard def sharing one space
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateSharedClockLaws(defs) {
  const errors = [];
  const warnings = [];
  const list = Array.isArray(defs) ? defs.filter((d) => d && typeof d === 'object') : [];

  // --- §6-1: superperiod <= 16 s, LCM over periods rounded to 1 ms ----------
  const ms = [];
  for (const d of list) if (isNum(d.period) && d.period > 0) ms.push(Math.max(1, Math.round(d.period * 1000)));
  if (ms.length > 1) {
    let l = ms[0];
    for (let i = 1; i < ms.length && l <= 16000; i++) l = lcmInt(l, ms[i]);
    if (l > 16000) {
      warnings.push(`superperiod ${l > 1e7 ? '>10000' : (l / 1000).toFixed(1)} s exceeds 16 s — the compound rhythm cannot be learned from one observation at the staging deck (law §6-1)`);
    }
  }

  // --- §6-2: relay spill ------------------------------------------------------
  const groups = new Map();
  for (const d of list) {
    if (d.kind !== 'prismgate' || !d.relay || typeof d.relay.group !== 'string') continue;
    let g = groups.get(d.relay.group);
    if (!g) { g = []; groups.set(d.relay.group, g); }
    g.push(d);
  }
  groups.forEach((gates, name) => {
    gates.sort((a, b) => (a.relay.index || 0) - (b.relay.index || 0));
    for (let i = 1; i < gates.length; i++) {
      const a = gates[i - 1], b = gates[i];
      if (b.relay.index === a.relay.index) {
        errors.push(`relay '${name}': two gates share index ${a.relay.index}`);
        continue;
      }
      if (!isNum(a.period) || !isNum(b.period) || Math.abs(a.period - b.period) > 1e-6) {
        errors.push(`relay '${name}': gates ${a.relay.index} and ${b.relay.index} must share 'period' to 1e-6 (got ${brief(a.period)} vs ${brief(b.period)})`);
        continue;
      }
      const ov = relayDwellOverlap(a, b);
      if (ov + 1e-9 < 0.4) {
        errors.push(`relay '${name}': dwellOverlap(gate ${a.relay.index} -> ${b.relay.index}) = ${ov.toFixed(3)} s < 0.4 s — the next window must open >= 0.4 s before the previous closes (law §6-2)`);
      }
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

/* ======================================================================================
   BUILD
   ====================================================================================== */

/**
 * Look up `def.kind`, validate the def, and build the hazard.
 *
 * @param {object} def  a stage ObjectDef (CONTRACT section 18)
 * @param {object} ctx  {mats, fx, audio, post, theme|themeId, quality, player?, stage?, stageId?,
 *                       objectIndex?} — every field is optional; hazards degrade rather than throw
 *                       when an optional service is absent.
 * @returns {import('./lasers.js').Hazard}
 * @throws {HazardDefError} naming the offending stage object.
 */
export function makeHazard(def, ctx) {
  validateHazardDef(def, ctx);
  const kind = def.kind;
  const factory = HAZARDS[kind];

  if (typeof factory !== 'function') {
    const meta = HAZARD_META[kind];
    if (meta && meta.builder) {
      throw new HazardDefError(
        `'${kind}' is a builder kind, not a hazard — route it to runtime/world/builders.js `
        + `(buildPlatform / buildBeam / buildDeco / buildPad / buildPillar) instead of makeHazard. `
        + `Offending object: ${describeDef(def, ctx)}`,
        def,
      );
    }
    throw new HazardDefError(
      `unknown hazard kind '${kind}'. Known kinds: ${HAZARD_KIND_LIST.join(', ')}. `
      + `Offending object: ${describeDef(def, ctx)}`,
      def,
    );
  }

  let hz;
  try {
    hz = factory(def, ctx || {});
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
      `factory for '${kind}' did not return a Hazard {mesh, colliders, kills, update, reset, `
      + `dispose}. Offending object: ${describeDef(def, ctx)}`,
      def,
    );
  }

  // Normalise the shape so a stage can iterate every hazard uniformly, whichever author built it.
  if (!Array.isArray(hz.colliders)) hz.colliders = [];
  if (!Array.isArray(hz.kills)) hz.kills = [];
  if (!Array.isArray(hz.fields)) hz.fields = [];
  if (typeof hz.reset !== 'function') hz.reset = function resetNoop(t) { this.update(t, 0); };
  if (typeof hz.dispose !== 'function') hz.dispose = function disposeNoop() {};
  if (hz.kind === undefined) hz.kind = kind;
  if (hz.def === undefined) hz.def = def;
  if (hz.meta === undefined) hz.meta = HAZARD_META[kind] || null;

  // Every collider and kill volume must point back at its owner: the player needs `ref` to fire
  // surface touch hooks and to attribute a death cause.
  for (const c of hz.colliders) { if (c && (c.ref === undefined || c.ref === null)) c.ref = hz; }
  for (const k of hz.kills) { if (k && (k.ref === undefined || k.ref === null)) k.ref = hz; }

  return hz;
}

export default HAZARDS;
