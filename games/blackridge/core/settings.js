// core/settings.js [A0] — the S object, SCHEMA, quality presets, persistence
// (architecture §3.18, amended R9: ALL FOV values are VERTICAL degrees,
// player-facing range 60–90, world default 74 per combat_spec §2.1).

const KEY = "blackridge.settings.v1";

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
  // Default 1.00 IS the spec: pure zoom-proportional, muscle memory preserved
  // through the right-click. The slider exists because the owner asked for it
  // by name; the spec's "no separate slider in v1" line is superseded by that
  // request, and defaulting to 1.00 means the shipped feel is still the spec's.
  adsSens: { kind: "range", min: 0.2, max: 2.0, step: 0.01, default: 1.0 },
  // Render scale — the ONE lever that changes how smooth aiming actually
  // feels on integrated graphics (dynres.js header: cost(s) = 0.10 + 0.90·s²).
  // Default 1.00 = pixel-for-pixel native, IDENTICAL to the build before this
  // setting existed. Nothing softens unless the player moves this slider; the
  // sharpness/smoothness trade is theirs to make, not a lane's. dynres.js
  // subscribes and pins the renderer DPR to the chosen value.
  renderScale: { kind: "range", min: 0.6, max: 1.0, step: 0.05, default: 1.0 },
  bob:     { kind: "range", min: 0, max: 1, step: 0.05, default: 1.0 },
  music:   { kind: "range", min: 0, max: 1, step: 0.05, default: 0.4 },
  sfx:     { kind: "range", min: 0, max: 1, step: 0.05, default: 1.0 },
  ambience:{ kind: "range", min: 0, max: 1, step: 0.05, default: 0.8 },
  // ---- lane PAD (2026-11): controller, touch aim assist, invert Y --------------
  // invertY applies to mouse, stick and touch drags alike.
  invertY:    { kind: "enum", options: ["off", "on"], default: "off" },
  // Aim assist acts ONLY for gamepad / touch (never the mouse) — core/aim_assist.js.
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
};

// Quality presets are consumed by A6 (rain counts, planar reflection, post
// tiers) and A3 (prop density). Names frozen: low | med | high.
export const QUALITY_PRESETS = {
  low:  { rainCount: 900,  splashCount: 60,  planarReflection: false, postTier: "low"  },
  med:  { rainCount: 1800, splashCount: 140, planarReflection: true,  postTier: "med"  },
  high: { rainCount: 2800, splashCount: 220, planarReflection: true,  postTier: "high" },
};

function defaults() {
  const o = {};
  for (const k of Object.keys(SCHEMA)) o[k] = SCHEMA[k].default;
  return o;
}

function clampToSchema(key, val) {
  const s = SCHEMA[key];
  if (!s) return val;
  if (s.kind === "enum") return s.options.includes(val) ? val : s.default;
  if (s.kind === "range") {
    const n = Number(val);
    if (!Number.isFinite(n)) return s.default;
    return Math.min(s.max, Math.max(s.min, n));
  }
  return val;
}

export const S = defaults();

// Load persisted values (clamped through the schema so a stale or hand-edited
// localStorage blob can never smuggle an out-of-range value into the game).
try {
  const raw = typeof localStorage !== "undefined" && localStorage.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    for (const k of Object.keys(SCHEMA)) {
      if (k in saved) S[k] = clampToSchema(k, saved[k]);
    }
  }
} catch (e) { /* first run / private mode — defaults stand */ }

const listeners = new Map(); // key → [fn]

export function onChange(key, fn) {
  let list = listeners.get(key);
  if (!list) { list = []; listeners.set(key, list); }
  list.push(fn);
}

export function set(key, val) {
  const v = clampToSchema(key, val);
  if (S[key] === v) return;
  S[key] = v;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) { /* persistence best-effort */ }
  const list = listeners.get(key);
  if (list) for (const fn of list) fn(v, key);
}

// ---------------------------------------------------------------------------
// LIVE-INSTANCE HANDLE — the dual-instance guard.
//
// boot.js imports every module with a `?v=N` cache-busting query. An ES module
// is keyed by its FULL URL, so a module that does `import { S } from
// "../settings.js"` with no query gets a SECOND, completely independent copy:
// its own S object, its own listener map. Writes through the game's settings
// never reach it and its onChange handlers never fire. weather.js's
// "// const table — dual-instance safe" note is about exactly this hazard; it
// gets away with it because QUALITY_PRESETS is a frozen table.
//
// MEASURED this wave (_harness/settingsprobe.py): dynres.js imported the bare
// specifier to read the new Render scale setting. Driving the real slider set
// __FPS__.settings.renderScale to 0.75 while dynres's copy still read 1, so the
// renderer stayed at pixel ratio 1 and the setting did nothing until the page
// was reloaded (at which point the persisted value took effect through the
// versioned instance and the buffer correctly became 960x540). Silent, and
// invisible to anything that only checks the setting object.
//
// FIRST INSTANCE WINS, and boot AWAITS `settings.js?v=N` in phase 1 before any
// phase-2 module can pull a bare copy — so the handle always points at the
// instance the game actually reads. Consumers that need LIVE values (not const
// tables) read this instead of importing.
if (!globalThis.__BR_SETTINGS__) {
  globalThis.__BR_SETTINGS__ = { S, SCHEMA, set, onChange };
}
