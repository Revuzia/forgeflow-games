// core/ai/adaptive.js [identity lane] — opponent skill matched to the player.
// THREE-free, DOM-free, Node-safe, pure. INVISIBLE BY DESIGN: no UI, no
// setting, no text anywhere names or implies it. The only inputs are the
// device-saved performance record (core/meta/skill.js) and the match seed's
// (unused) slot — the tier is FIXED at match start and never changes mid-tick.
//
// ---------------------------------------------------------------- the mapping
// Per finished match (≥ 60 s of live play) the record stores four numbers:
//   kd   kills / max(1, deaths)        acc  shotsHit / shotsFired
//   spm  score per live minute          win  1 won / 0 lost (FFA: 1st place)
// matchPerf() folds them into ONE performance value p ∈ [0,1]:
//   p = 0.40·n(kd; 0.4→1.8) + 0.25·n(spm; 40→260) + 0.15·win + 0.20·n(acc; 0.10→0.38)
// (n(x; lo→hi) = clamp((x-lo)/(hi-lo), 0, 1)). The record keeps the last 10.
//
// The ESTIMATE e moves toward the mean of those ≤10 values, smoothed so one
// match never swings it far:
//   e' = e + clamp(0.35·(mean − e), −0.06, +0.06)        (e₀ = START_EST = 0.56)
//
// The TIER (0..4) follows e with hysteresis (±0.03 around each edge) and
// moves at most ONE step per match:
//   tier 4  e ≥ 0.66   "expert"   — exactly today's PVP profile (identity)
//   tier 3  e ≥ 0.50              — first-ever match starts HERE (a notch below)
//   tier 2  e ≥ 0.36
//   tier 1  e ≥ 0.22
//   tier 0  else       "competent" — still a good player: no forced bad play
// Every operator in the match — teammates AND opponents — plays the same tier,
// so the teams stay even. No saved record / no match driver → tier 4 for the
// headless selftests (sim.identity unset → botfsm is byte-identical).
//
// What a tier changes (multipliers on the resolved profile, TIER_PROFILE):
// reaction time, per-shot aim sigma, burst pause, turn rate, acquire settle,
// awareness fill-rate, lead error, think cadence, plus 0–2 forced early-miss
// rounds after a fresh confirm. Never HP, damage, ammo, speed or sight lines.

export const TIERS = 5;
export const EXPERT_TIER = 4;
export const START_TIER = 3;
export const START_EST = 0.56;
export const HISTORY_N = 10;
export const MAX_STEP = 0.06;     // largest estimate move per match
export const GAIN = 0.35;         // fraction of the gap closed per match
export const HYST = 0.03;
export const EDGES = [0.22, 0.36, 0.50, 0.66]; // lower edge of tiers 1..4

// tier → knob multipliers (1 = unchanged). Tier 4 is the identity.
export const TIER_PROFILE = [
  { react: 1.62, jitter: 1.55, pause: 1.40, turn: 0.72, acquire: 0.8, notice: 0.75, lead: 2.0, think: 1.6, miss: 2 },
  { react: 1.44, jitter: 1.40, pause: 1.30, turn: 0.79, acquire: 0.6, notice: 0.82, lead: 1.7, think: 1.4, miss: 1 },
  { react: 1.29, jitter: 1.26, pause: 1.20, turn: 0.86, acquire: 0.4, notice: 0.88, lead: 1.45, think: 1.25, miss: 1 },
  { react: 1.14, jitter: 1.12, pause: 1.10, turn: 0.93, acquire: 0.2, notice: 0.94, lead: 1.2, think: 1.1, miss: 0 },
  { react: 1, jitter: 1, pause: 1, turn: 1, acquire: 0, notice: 1, lead: 1, think: 1, miss: 0 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n01 = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1);

/** One match's performance value p ∈ [0,1]. */
export function matchPerf(m) {
  if (!m) return null;
  const kd = Number(m.kd) || 0, spm = Number(m.spm) || 0, acc = Number(m.acc) || 0;
  const win = m.win ? 1 : 0;
  return 0.40 * n01(kd, 0.4, 1.8) + 0.25 * n01(spm, 40, 260) + 0.15 * win + 0.20 * n01(acc, 0.10, 0.38);
}

/** Tier from an estimate, with hysteresis around `prevTier`, ≤1 step from it. */
export function tierFor(est, prevTier = START_TIER) {
  const prev = clamp(prevTier | 0, 0, TIERS - 1);
  let raw = 0;
  for (let i = 0; i < EDGES.length; i++) if (est >= EDGES[i]) raw = i + 1;
  if (raw > prev) {
    // climbing needs the estimate HYST past the edge of the next tier
    raw = est >= EDGES[prev] + HYST ? prev + 1 : prev;
  } else if (raw < prev) {
    raw = est < EDGES[prev - 1] - HYST ? prev - 1 : prev;
  }
  return raw;
}

/**
 * Fold one finished match into a record (pure: returns a NEW record).
 * record = { v:1, n, hist:[p...], est, tier }
 */
export function foldMatch(record, stats) {
  const r = normalise(record);
  const p = matchPerf(stats);
  if (p == null || !Number.isFinite(p)) return r;
  const hist = r.hist.concat([Math.round(p * 1e4) / 1e4]).slice(-HISTORY_N);
  const mean = hist.reduce((s, x) => s + x, 0) / hist.length;
  const est = clamp(r.est + clamp(GAIN * (mean - r.est), -MAX_STEP, MAX_STEP), 0, 1);
  const tier = tierFor(est, r.tier);
  return { v: 1, n: r.n + 1, hist, est: Math.round(est * 1e4) / 1e4, tier };
}

export function normalise(record) {
  const r = record && typeof record === "object" ? record : {};
  const hist = Array.isArray(r.hist) ? r.hist.filter((x) => Number.isFinite(x)).map((x) => clamp(x, 0, 1)).slice(-HISTORY_N) : [];
  const est = Number.isFinite(r.est) ? clamp(r.est, 0, 1) : START_EST;
  const tier = Number.isInteger(r.tier) ? clamp(r.tier, 0, TIERS - 1) : START_TIER;
  return { v: 1, n: Number.isInteger(r.n) && r.n >= 0 ? r.n : 0, hist, est, tier };
}

/** The tier a match starts at, given the saved record (null → first match). */
export function startTier(record) {
  if (!record) return START_TIER;
  return normalise(record).tier;
}

/**
 * Apply a tier to a resolved skill profile (returns a NEW object; tier 4 →
 * the SAME object, so expert play is byte-identical to before this lane).
 */
export function applyTier(k, tier) {
  const ti = tier == null ? EXPERT_TIER : clamp(tier | 0, 0, TIERS - 1);
  if (!k || ti === EXPERT_TIER) return k;
  const T = TIER_PROFILE[ti];
  const o = Object.assign({}, k);
  o.reactMin = k.reactMin * T.react;
  o.reactMax = k.reactMax * T.react;
  o.jitter = k.jitter * T.jitter;
  o.pauseMin = k.pauseMin * T.pause;
  o.pauseMax = k.pauseMax * T.pause;
  o.turnRate = k.turnRate * T.turn;
  o.acquire = (k.acquire != null ? k.acquire : 3) + T.acquire;
  o.notice = k.notice * T.notice;
  o.leadErr = k.leadErr * T.lead;
  o.thinkS = (k.thinkS != null ? k.thinkS : 0.15) * T.think;
  if (T.miss > (k.missRounds | 0)) {
    o.missRounds = T.miss;
    o.missMin = Math.max(k.missMin || 0, 1.0);
    o.missMax = Math.max(k.missMax || 0, 1.6);
  }
  o.tier = ti;
  return o;
}
