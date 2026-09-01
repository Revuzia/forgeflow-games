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

/* ======================================================================================
   FACTORY RESOLUTION
   ====================================================================================== */

const MODULE_FILES = new Map([
  [moversMod, './movers.js'],
  [rotorsMod, './rotors.js'],
  [vanishMod, './vanish.js'],
  [crushersMod, './crushers.js'],
  [pendulumMod, './pendulum.js'],
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
  pendulum:   { p: 'vec3', len: 'number', amp: 'number', period: 'number' },
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

  ice:        { p: 'vec3', s: 'vec3' },
  conveyor:   { p: 'vec3', s: 'vec3', dir: 'vec3', power: 'number' },
  jumppad:    { p: 'vec3', power: 'number' },
  speedpad:   { p: 'vec3', dir: 'vec3' },
  wind:       { p: 'vec3', s: 'vec3', dir: 'vec3', power: 'number' },
  sticky:     { p: 'vec3', s: 'vec3' },
};

/** Extra checks that a type table cannot express. */
const SEMANTIC = {
  laser(def, fail) {
    if (sameVec(def.a, def.b)) fail("'a' and 'b' are the same point — a laser needs length");
  },
  lasergrid(def, fail) {
    if (sameVec(def.a, def.b)) fail("'a' and 'b' are the same point — a laser grid needs length");
    if (def.count !== undefined && !(isNum(def.count) && def.count >= 1)) fail("'count' must be a number >= 1");
  },
  chase(def, fail) {
    if (def.from === def.to) fail("'from' equals 'to' — the chase would never move");
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
  },
};

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
  const extra = SEMANTIC[kind];
  if (extra) {
    extra(def, (msg) => {
      throw new HazardDefError(`hazard '${kind}': ${msg} — ${where()}`, def);
    });
  }
  return true;
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
