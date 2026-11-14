// core/settings.js [A0] — the S object, SCHEMA, quality presets, persistence
// (architecture §3.18, amended R9: ALL FOV values are VERTICAL degrees,
// player-facing range 60–90, world default 74 per combat_spec §2.1).
//
// [lane settings, 2026-11] ONE VERSIONED RECORD.
// Settings used to persist as a bare flat object under "blackridge.settings.v1"
// with no version field, so a schema change had nowhere to hang a migration.
// They now live in a single record under RECORD_KEY:
//     { v: 2, values: { <key>: <value>, ... }, savedAt: <ms> }
// Loading order (loadRecord): the v2 record if present → else the legacy v1
// flat object, MIGRATED (every known key carried across through the same
// schema clamp, the new graphics toggles derived from the saved quality
// preset so a returning "low" player keeps exactly the frame they had) and
// written back as a v2 record. The v1 key is LEFT IN PLACE (read-only from
// here on) so a rollback to an older build still finds its settings.
// Corrupt JSON never throws: defaults stand and the bad text is parked under
// CORRUPT_KEY for diagnosis. Everything is clamped through SCHEMA, so a stale
// or hand-edited blob cannot smuggle an out-of-range value into the game.
//
// Other device-saved keys (NOT settings, listed for the record — each owned by
// its module): blackridge.keybinds.v1 (input.js, included in export/import),
// blackridge.difficulty.v1 + blackridge.map.v1 (mode_select.js),
// blackridge.pvp.stats.v1 (scoreboard.js), blackridge.achv.v1 (achievements),
// blackridge.classes (meta/loadouts.js), blackridge.progress (progression.js).
//
// DOM-free: the pure functions below (validate / migrate / loadRecord /
// exportText / parseImport / presetValues / teamColorsFor) are exercised by
// core/settings.selftest.cjs with a fake storage object.

export const RECORD_KEY = "blackridge.settings";
export const LEGACY_KEY_V1 = "blackridge.settings.v1";
export const CORRUPT_KEY = "blackridge.settings.corrupt";
export const RECORD_VERSION = 2;

const ONOFF = ["on", "off"];

export const SCHEMA = {
  quality: { kind: "enum", options: ["low", "med", "high"], default: "med" },
  fov:     { kind: "range", min: 60, max: 90, step: 1, default: 74 }, // VERTICAL deg (R9)
  // ITER11 LANE E — the owner asked for aiming that is "easy to adjust".
  // sens was 0.20-3.00 in steps of 0.05: 57 stops, none of them below half
  // default, and no way to say what a stop meant. Now 0.05-5.00 in 0.01, and
  // settings_ui prints the px-per-360° each value buys (input.js
  // PX_PER_360_AT_SENS_1 = 2856 px at ×1.00). Existing persisted values stay
  // in range, so nobody's saved sensitivity moves.
  sens:    { kind: "range", min: 0.05, max: 5.0, step: 0.01, default: 1.0 },
  // ADS sensitivity multiplier ON TOP of the zoom-proportional scaling
  // input.js applies (combat_spec §2.4, monitor-distance coefficient 1.0).
  adsSens: { kind: "range", min: 0.2, max: 2.0, step: 0.01, default: 1.0 },
  // Render scale — the ONE lever that changes how smooth aiming actually
  // feels on integrated graphics (dynres.js header: cost(s) = 0.10 + 0.90·s²).
  // Default 1.00 = pixel-for-pixel native. With dynamic resolution ON it is the
  // CEILING the controller works under (dynres.js).
  renderScale: { kind: "range", min: 0.6, max: 1.0, step: 0.05, default: 1.0 },
  bob:     { kind: "range", min: 0, max: 1, step: 0.05, default: 1.0 },
  music:   { kind: "range", min: 0, max: 1, step: 0.05, default: 0.4 },
  sfx:     { kind: "range", min: 0, max: 1, step: 0.05, default: 1.0 },
  ambience:{ kind: "range", min: 0, max: 1, step: 0.05, default: 0.8 },
  // ---- lane PAD (2026-11): controller, touch aim assist, invert Y --------------
  invertY:    { kind: "enum", options: ["off", "on"], default: "off" },
  aimAssist:  { kind: "enum", options: ["off", "standard", "focused"], default: "standard" },
  padSensX:   { kind: "range", min: 0.2, max: 3.0, step: 0.05, default: 1.0 },  // x 195°/s
  padSensY:   { kind: "range", min: 0.2, max: 3.0, step: 0.05, default: 1.0 },  // x 137°/s
  padAdsSens: { kind: "range", min: 0.2, max: 2.0, step: 0.01, default: 1.0 },  // on top of zoom-proportional
  padCurve:   { kind: "enum", options: ["linear", "standard", "dynamic"], default: "standard" },
  padAccel:   { kind: "range", min: 0, max: 1, step: 0.05, default: 0.5 },     // look ramp at full push
  padDeadL:   { kind: "range", min: 0, max: 0.4, step: 0.01, default: 0.10 },  // stick drift tolerance
  padDeadR:   { kind: "range", min: 0, max: 0.4, step: 0.01, default: 0.10 },
  padTrigger: { kind: "range", min: 0.05, max: 0.9, step: 0.05, default: 0.25 },
  padSprint:  { kind: "enum", options: ["l3", "auto"], default: "l3" },
  padCrouch:  { kind: "enum", options: ["toggle", "hold"], default: "toggle" },
  padRumble:  { kind: "enum", options: ["on", "off"], default: "on" },

  // ---- [lane settings] GRAPHICS -------------------------------------------------
  // Film/bloom toggles. Their defaults FOLLOW the quality preset (presetValues):
  // picking a preset writes them, touching one makes the preset read "custom".
  bloom:      { kind: "enum", options: ONOFF, default: "on" },   // UnrealBloom + halation (post.js)
  grain:      { kind: "enum", options: ONOFF, default: "on" },   // animated film grain
  vignette:   { kind: "enum", options: ONOFF, default: "on" },   // base + ADS vignette (hp/suppression feedback stays)
  adsBlur:    { kind: "enum", options: ONOFF, default: "on" },   // ADS peripheral blur
  chromAb:    { kind: "enum", options: ONOFF, default: "on" },   // radial chromatic aberration + explosion CA pulse
  lampAtmos:  { kind: "enum", options: ONOFF, default: "on" },   // god-ray cones + sodium fog discs (lighting.js)
  shadows:    { kind: "enum", options: ["off", "low", "high"], default: "high" }, // moon map 0 / 512 / 1024
  rainDensity:{ kind: "range", min: 0, max: 1, step: 0.05, default: 1.0 },       // × the preset's rain/splash count
  dynRes:     { kind: "enum", options: ["off", "on"], default: "off" },          // auto render scale under renderScale
  dynResTarget:{ kind: "enum", options: ["30", "60", "120"], default: "60" },    // fps the controller defends
  fpsCap:     { kind: "enum", options: ["30", "60", "120", "uncapped"], default: "uncapped" },
  fpsCounter: { kind: "enum", options: ["off", "fps", "full"], default: "off" },
  vmFovAdj:   { kind: "range", min: -10, max: 15, step: 1, default: 0 },         // ° added to the 60° weapon camera

  // ---- [lane settings] INTERFACE ------------------------------------------------
  xhStyle:    { kind: "enum", options: ["cross", "circle", "dot", "off"], default: "cross" },
  xhDot:      { kind: "enum", options: ONOFF, default: "on" },
  xhColor:    { kind: "enum", options: ["white", "green", "cyan", "yellow", "magenta"], default: "white" },
  xhSize:     { kind: "range", min: 0.5, max: 2, step: 0.05, default: 1 },
  xhOpacity:  { kind: "range", min: 0.2, max: 1, step: 0.05, default: 0.9 },
  hitmarker:  { kind: "enum", options: ONOFF, default: "on" },
  hudScale:   { kind: "range", min: 0.75, max: 1.25, step: 0.05, default: 1 },
  hudOpacity: { kind: "range", min: 0.3, max: 1, step: 0.05, default: 1 },
  scoreFeed:  { kind: "enum", options: ONOFF, default: "on" },   // +score popups and XP feed
  minimap:    { kind: "enum", options: ONOFF, default: "on" },   // read by the minimap lane
  minimapSize:{ kind: "enum", options: ["small", "medium", "large"], default: "medium" },
  killcam:    { kind: "enum", options: ONOFF, default: "on" },   // read by render/killcam.js (hook)
  subtitles:  { kind: "enum", options: ONOFF, default: "on" },
  subSize:    { kind: "enum", options: ["small", "medium", "large"], default: "medium" },
  // [polish v149] where teammates' callouts appear: the team-chat strip
  // (default) OR the subtitle line (accessibility) — never both at once
  teamChat:   { kind: "enum", options: ["strip", "subtitles"], default: "strip" },

  // ---- [lane settings] ACCESSIBILITY --------------------------------------------
  colorblind: { kind: "enum", options: ["off", "protanopia", "deuteranopia", "tritanopia"], default: "off" },
  shake:      { kind: "range", min: 0, max: 1, step: 0.05, default: 1 },    // explosion / hurt camera shake
  flashIntensity: { kind: "range", min: 0.3, max: 1, step: 0.05, default: 1 }, // flash whiteout strength
  kbAds:      { kind: "enum", options: ["hold", "toggle"], default: "hold" },
  kbCrouch:   { kind: "enum", options: ["hold", "toggle"], default: "hold" },
  kbSprint:   { kind: "enum", options: ["hold", "toggle"], default: "hold" },
};

// Quality presets are consumed by A6 (rain counts, planar reflection, post
// tiers) and A3 (prop density). Names frozen: low | med | high.
export const QUALITY_PRESETS = {
  low:  { rainCount: 900,  splashCount: 60,  planarReflection: false, postTier: "low"  },
  med:  { rainCount: 1800, splashCount: 140, planarReflection: true,  postTier: "med"  },
  high: { rainCount: 2800, splashCount: 220, planarReflection: true,  postTier: "high" },
};

// The graphics toggles each preset implies. low = the old "tonemap only" tier
// (post.js tier 0: no bloom, no film stages); med/high = everything on. Keys
// NOT listed here (shadows, lamp atmosphere, rain density, dynamic res, caps)
// were never preset-driven and keep their own defaults, so picking a preset
// reproduces the pre-lane frame for that preset exactly.
export const GFX_PRESET_KEYS = ["bloom", "grain", "vignette", "adsBlur", "chromAb"];
export function presetValues(q) {
  const on = q === "low" ? "off" : "on";
  const o = {};
  for (const k of GFX_PRESET_KEYS) o[k] = on;
  return o;
}
/** "low" | "med" | "high" when every preset-driven toggle matches, else "custom". */
export function presetState(vals) {
  const q = vals.quality;
  const want = presetValues(q);
  for (const k of GFX_PRESET_KEYS) if (vals[k] !== want[k]) return "custom";
  return q;
}

// ---- colour-blind team palettes -------------------------------------------
// friend = the player's side (team 0 seat — soldiers.js rims teammates with
// teams[0].tint, match_hud prints "US" in it), enemy = the other side.
// Chosen by simulation, not by eye: Machado et al. 2009 full-severity CVD
// matrices on linear sRGB, CIELAB ΔE76 between the two simulated colours
// (core/settings.selftest.cjs re-runs this and gates ΔE ≥ 60 under the mode
// it targets AND under normal vision):
//   default  amber #d9a441 / slate #7c9fd0  normal 86 · protan 86 · deutan 88 · tritan 60
//   protan   blue  #3d9df2 / yellow #ffc93c normal 125 · protan 125
//   deutan   blue  #2f8cff / yellow #ffd23f normal 142 · deutan 145
//   tritan   cyan  #29c5f6 / coral  #ff6b5a normal 107 · tritan 117
// The enemy colour is the BRIGHTER one in every CVD pair (L* 84-86 vs 59-74),
// so the pair also separates by lightness for anyone the hue model misses.
export const CB_PALETTES = {
  off:          null, // authored team tints (roster.js AMBER / SLATE)
  protanopia:   { friend: "#3d9df2", enemy: "#ffc93c" },
  deuteranopia: { friend: "#2f8cff", enemy: "#ffd23f" },
  tritanopia:   { friend: "#29c5f6", enemy: "#ff6b5a" },
};
export const DEFAULT_TEAM_COLORS = { friend: "#d9a441", enemy: "#7c9fd0" };
export function teamColorsFor(mode) { return CB_PALETTES[mode] || null; }

// ---------------------------------------------------------------- pure core
export function defaults() {
  const o = {};
  for (const k of Object.keys(SCHEMA)) o[k] = SCHEMA[k].default;
  return o;
}

export function clampToSchema(key, val) {
  const s = SCHEMA[key];
  if (!s) return val;
  if (s.kind === "enum") {
    // tolerate numbers for the numeric enums ("60" vs 60) and case slips
    const v = typeof val === "number" ? String(val) : typeof val === "string" ? val.toLowerCase() : val;
    return s.options.includes(v) ? v : s.default;
  }
  if (s.kind === "range") {
    if (val === null || val === "" || typeof val === "boolean") return s.default;
    const n = Number(val);
    if (!Number.isFinite(n)) return s.default;
    return Math.min(s.max, Math.max(s.min, n));
  }
  return val;
}

/** Validate a flat {key: value} object into a COMPLETE settings object.
 *  Unknown keys are dropped; missing preset-driven toggles follow the saved
 *  quality preset (not the med default) so a "low" player stays tier 0. */
export function validate(flat) {
  const src = flat && typeof flat === "object" ? flat : {};
  const out = defaults();
  for (const k of Object.keys(SCHEMA)) if (k in src) out[k] = clampToSchema(k, src[k]);
  const pv = presetValues(out.quality);
  for (const k of GFX_PRESET_KEYS) if (!(k in src)) out[k] = pv[k];
  return out;
}

/** v1 (flat object, no version) → v2 values. Every v1 key exists in v2 with
 *  the same meaning and range, so this is a clamp-through copy; the new keys
 *  take defaults (preset-derived where the preset drives them). */
export function migrate(rec) {
  if (!rec || typeof rec !== "object") return { values: validate({}), from: "none" };
  if (typeof rec.v === "number" && rec.values && typeof rec.values === "object") {
    // v2 (or a NEWER build's record read by an older one): known keys only.
    return { values: validate(rec.values), from: "v" + rec.v };
  }
  return { values: validate(rec), from: "v1" };
}

export function makeRecord(values) {
  return { v: RECORD_VERSION, values: Object.assign({}, values), savedAt: Date.now() };
}

/** Read settings from a Storage-like object ({getItem,setItem}). Never throws.
 *  Returns {values, from: "v2"|"v1"|"none"|"corrupt", wrote:boolean}. */
export function loadRecord(storage) {
  if (!storage) return { values: validate({}), from: "none", wrote: false };
  let raw = null;
  try { raw = storage.getItem(RECORD_KEY); } catch (e) { raw = null; }
  if (raw) {
    try {
      const m = migrate(JSON.parse(raw));
      return { values: m.values, from: m.from, wrote: false };
    } catch (e) {
      try { storage.setItem(CORRUPT_KEY, String(raw).slice(0, 4000)); } catch (_) { /* full */ }
      // fall through to the legacy key: a corrupt v2 next to a good v1 recovers v1
    }
  }
  let legacy = null;
  try { legacy = storage.getItem(LEGACY_KEY_V1); } catch (e) { legacy = null; }
  if (legacy) {
    try {
      const m = migrate(JSON.parse(legacy));
      let wrote = false;
      try { storage.setItem(RECORD_KEY, JSON.stringify(makeRecord(m.values))); wrote = true; } catch (e) { /* private mode */ }
      return { values: m.values, from: "v1", wrote };
    } catch (e) { /* corrupt legacy: defaults */ }
  }
  return { values: validate({}), from: raw ? "corrupt" : "none", wrote: false };
}

/** Settings as shareable text. Only non-default values are written, so the
 *  string stays short; `binds` is input.js's keyboard map (optional). */
export function exportText(values, binds) {
  const d = defaults();
  const pv = presetValues(values.quality);
  const diff = {};
  for (const k of Object.keys(SCHEMA)) {
    const base = GFX_PRESET_KEYS.includes(k) ? pv[k] : d[k];
    if (values[k] !== base) diff[k] = values[k];
  }
  if (!("quality" in diff)) diff.quality = values.quality; // preset anchors the toggles
  const o = { blackridge: "settings", v: RECORD_VERSION, values: diff };
  if (binds && Object.keys(binds).length) o.binds = binds;
  return JSON.stringify(o);
}

/** Parse exported text. Returns {ok, values (complete, validated), binds, error}. */
export function parseImport(text) {
  let o;
  try { o = JSON.parse(String(text || "").trim()); } catch (e) { return { ok: false, error: "not valid settings text" }; }
  if (!o || typeof o !== "object") return { ok: false, error: "not valid settings text" };
  const flat = o.values && typeof o.values === "object" ? o.values : o;
  const known = Object.keys(flat).filter((k) => k in SCHEMA);
  if (!known.length) return { ok: false, error: "no recognised settings in that text" };
  const binds = {};
  if (o.binds && typeof o.binds === "object") {
    for (const [a, c] of Object.entries(o.binds)) if (typeof c === "string" && /^[A-Za-z0-9]{2,24}$/.test(c)) binds[a] = c;
  }
  return { ok: true, values: validate(flat), binds, count: known.length };
}

// ---------------------------------------------------------------- live state
const storage = (() => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
})();
const loaded = loadRecord(storage);
export const loadInfo = { from: loaded.from, migrated: loaded.from === "v1" && loaded.wrote };
if (loadInfo.migrated) console.info("[settings] migrated blackridge.settings.v1 → versioned record v" + RECORD_VERSION);

export const S = loaded.values;

/** True when this device had saved settings before this page load (any version). */
export function hasSaved() { return loaded.from !== "none"; }

const listeners = new Map(); // key → [fn]

export function onChange(key, fn) {
  let list = listeners.get(key);
  if (!list) { list = []; listeners.set(key, list); }
  list.push(fn);
}

function persist() {
  try { if (storage) storage.setItem(RECORD_KEY, JSON.stringify(makeRecord(S))); } catch (e) { /* best-effort */ }
}
function fire(key) {
  const list = listeners.get(key);
  if (list) for (const fn of list) { try { fn(S[key], key); } catch (e) { console.warn("[settings] listener for", key, "threw:", e && e.message); } }
}

/** Write several keys, persist ONCE, then fire listeners (in key order). */
export function setMany(obj) {
  const changed = [];
  for (const k of Object.keys(obj || {})) {
    if (!(k in SCHEMA)) continue;
    const v = clampToSchema(k, obj[k]);
    if (S[k] !== v) { S[k] = v; changed.push(k); }
  }
  if (changed.length) { persist(); for (const k of changed) fire(k); }
  return changed;
}

export function set(key, val) {
  // Picking a quality preset writes the toggles it implies (and so clears
  // "custom"); every caller — the settings row, menu.onQuality, boot's touch
  // first-run "low" — gets the same behaviour.
  if (key === "quality") {
    const q = clampToSchema("quality", val);
    return setMany(Object.assign({ quality: q }, presetValues(q))).length > 0;
  }
  return setMany({ [key]: val }).length > 0;
}

export function resetKeys(keys) {
  const d = defaults();
  const o = {};
  for (const k of keys) if (k in SCHEMA) o[k] = d[k];
  if ("quality" in o) Object.assign(o, presetValues(o.quality));
  return setMany(o);
}

/** Live colour-blind team colours, or null for the authored tints. */
export function teamColors() { return teamColorsFor(S.colorblind); }

// ---------------------------------------------------------------------------
// LIVE-INSTANCE HANDLE — the dual-instance guard.
//
// boot.js imports every module with a `?v=N` cache-busting query. An ES module
// is keyed by its FULL URL, so a module that does `import { S } from
// "../settings.js"` with no query gets a SECOND, completely independent copy:
// its own S object, its own listener map. Writes through the game's settings
// never reach it and its onChange handlers never fire.
//
// FIRST INSTANCE WINS, and boot AWAITS `settings.js?v=N` in phase 1 before any
// phase-2 module can pull a bare copy — so the handle always points at the
// instance the game actually reads. Consumers that need LIVE values (not const
// tables) read this instead of importing. [lane settings] teamColors() is on
// the handle so modules outside this lane can adopt the colour-blind palette
// with one line: `(globalThis.__BR_SETTINGS__?.teamColors?.() || {}).friend`.
if (typeof globalThis !== "undefined" && !globalThis.__BR_SETTINGS__) {
  globalThis.__BR_SETTINGS__ = { S, SCHEMA, set, setMany, onChange, resetKeys, teamColors,
    presetState: () => presetState(S), loadInfo, CB_PALETTES };
}
