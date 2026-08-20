// core/settings.js [A0] — the S object, SCHEMA, quality presets, persistence
// (architecture §3.18, amended R9: ALL FOV values are VERTICAL degrees,
// player-facing range 60–90, world default 74 per combat_spec §2.1).

const KEY = "blackridge.settings.v1";

export const SCHEMA = {
  quality: { kind: "enum", options: ["low", "med", "high"], default: "med" },
  fov:     { kind: "range", min: 60, max: 90, step: 1, default: 74 }, // VERTICAL deg (R9)
  sens:    { kind: "range", min: 0.2, max: 3.0, step: 0.05, default: 1.0 },
  bob:     { kind: "range", min: 0, max: 1, step: 0.05, default: 1.0 },
  music:   { kind: "range", min: 0, max: 1, step: 0.05, default: 0.4 },
  sfx:     { kind: "range", min: 0, max: 1, step: 0.05, default: 1.0 },
  ambience:{ kind: "range", min: 0, max: 1, step: 0.05, default: 0.8 },
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
