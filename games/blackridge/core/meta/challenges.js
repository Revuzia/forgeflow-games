// core/meta/challenges.js — BLACKRIDGE daily / weekly / career challenges (2026-11-13).
//
// VIEW/META LAYER ONLY. Like progression.js it listens to the sim's bridge events
// and never touches sim state. It keeps ONE versioned save record of its own in
// localStorage ("blackridge.challenges.v1") and pays XP through
// progression.award("challenge", n, label) — exactly once per completion.
//
//   DAILY   3 active, chosen deterministically from the LOCAL calendar date
//           (same set all day; one free swap per day); reset at local midnight.
//   WEEKLY  3 active, chosen from the local ISO week (Monday 00:00 reset).
//   CAREER  long-term tracks with tiers (lifetime counters).
//
// Completion is auto-claimed: the moment a challenge's target is reached its XP
// is awarded and the slot is marked claimed (claim() is idempotent, so a replayed
// event or a reload can never pay twice).
//
// How a raw bridge event becomes something a challenge can count: handlers below
// turn events into FACTS ({k:"kill", weapon, headshot, dist, stance, impaired,
// via, mode}, {k:"matchEnd", won, kills, deaths, ...}). Every challenge is DATA:
// {fact, where, target, mode:"count"|"best"} and matchFact() evaluates `where`.
//
// THREE-free and DOM-free: core/meta/challenges.selftest.cjs runs it in node.
// PVP wording rule: opponents are operators — no bots / AI / NPC / difficulty.

// ===========================================================================
// DATA — catalogue
// ===========================================================================

export const WEAPON_NAMES = {
  warden: "Warden", vesper: "Vesper", breaker: "Breaker", corvus: "Corvus", pike: "Pike",
};
export const MODE_NAMES = { tdm: "Skirmish", ctf: "Capture the Flag", ffa: "Free-for-All", dom: "Stronghold" };
const MULTI = ["DOUBLE KILL", "TRIPLE KILL", "QUAD KILL", "MULTI KILL"];
const MULTI3 = ["TRIPLE KILL", "QUAD KILL", "MULTI KILL"];
export const LONGSHOT_M = 40;

// t(id, group, name, desc, fact, where, target, xp, extra)
function t(id, group, name, desc, fact, where, target, xp, extra) {
  return Object.assign({ id, group, name, desc, fact, where: where || {}, target, xp, mode: "count", req: null }, extra || {});
}

// Daily: easy 1,000 · standard 1,250-1,500 · hard 2,000-2,500 XP.
// (Level 2 = 800 XP; a full match earns roughly 4-8k, so a full daily set is
// worth about one match.)
export const DAILY = [
  // ---- combat
  t("d_sweep", "combat", "Clean Sweep", "Eliminate 15 operators", "kill", {}, 15, 1000),
  t("d_heads", "combat", "Sharp Eye", "Get 8 headshot eliminations", "kill", { headshot: true }, 8, 1500),
  t("d_long", "combat", "Long Watch", "Get 3 eliminations from beyond 40 m", "kill", { minDist: LONGSHOT_M }, 3, 1500),
  t("d_close", "combat", "Arm's Length", "Get 6 eliminations within 6 m", "kill", { maxDist: 6 }, 6, 1250),
  t("d_crouch", "movement", "Low Profile", "Get 3 eliminations while crouched", "kill", { stance: "crouch" }, 3, 1250),
  t("d_slide", "movement", "Hard Slide", "Get 2 eliminations while sliding", "kill", { stance: "slide" }, 2, 1500),
  t("d_air", "movement", "Airtime", "Get 2 eliminations while airborne", "kill", { stance: "air" }, 2, 1500),
  t("d_multi", "combat", "Double Tap", "Earn 3 Double Kill or better medals", "medal", { medalAny: MULTI }, 3, 1500),
  t("d_first", "combat", "Opening Act", "Draw first blood in a match", "medal", { medalAny: ["FIRST BLOOD"] }, 1, 1500),
  t("d_revenge", "combat", "Payback", "Earn 3 Revenge medals", "medal", { medalAny: ["REVENGE"] }, 3, 1250),
  t("d_streak5", "combat", "Unbroken", "Reach a 5-elimination streak in one life", "lifeStreak", {}, 5, 1500, { mode: "best" }),
  t("d_survivor", "combat", "Steady Hand", "Finish a match with 8+ eliminations and 3 or fewer deaths", "matchEnd", { completed: true, minKills: 8, maxDeaths: 3 }, 1, 2000),
  // ---- [melee] the knife
  t("d_knife", "combat", "Cold Steel", "Get 3 melee eliminations", "kill", { via: "melee" }, 3, 1500),
  t("d_knife_low", "movement", "Quiet Blade", "Get 2 melee eliminations while crouched", "kill", { via: "melee", stance: "crouch" }, 2, 2000),
  t("d_assist", "team", "Covering Fire", "Earn 5 assists", "assist", {}, 5, 1000),
  // ---- weapons (gated by the unlock table)
  t("d_warden", "weapon", "Warden Drill", "Get 10 eliminations with the Warden", "kill", { weapon: "warden" }, 10, 1250, { req: "weapon:warden" }),
  t("d_vesper", "weapon", "Vesper Drill", "Get 10 eliminations with the Vesper", "kill", { weapon: "vesper" }, 10, 1250, { req: "weapon:vesper" }),
  t("d_breaker", "weapon", "Breaker Drill", "Get 8 eliminations with the Breaker", "kill", { weapon: "breaker" }, 8, 1250, { req: "weapon:breaker" }),
  t("d_corvus", "weapon", "Corvus Drill", "Get 6 eliminations with the Corvus", "kill", { weapon: "corvus" }, 6, 1250, { req: "weapon:corvus" }),
  t("d_pike", "weapon", "Sidearm Drill", "Get 5 eliminations with the Pike", "kill", { weapon: "pike" }, 5, 1500, { req: "weapon:pike" }),
  t("d_corvus_hs", "weapon", "Glass Line", "Get 4 headshot eliminations with the Corvus", "kill", { weapon: "corvus", headshot: true }, 4, 2000, { req: "weapon:corvus" }),
  t("d_breaker_pb", "weapon", "Point Blank", "Get 5 Breaker eliminations within 8 m", "kill", { weapon: "breaker", maxDist: 8 }, 5, 1500, { req: "weapon:breaker" }),
  t("d_warden_hs", "weapon", "Warden Precision", "Get 5 headshot eliminations with the Warden", "kill", { weapon: "warden", headshot: true }, 5, 1500, { req: "weapon:warden" }),
  // ---- equipment & call-ins
  t("d_trip", "gear", "Wired Shut", "Get 2 tripmine eliminations", "kill", { via: "claymore" }, 2, 2000, { req: "equip:claymore" }),
  t("d_frag", "gear", "Pin Pulled", "Get 2 frag grenade eliminations", "kill", { via: "frag" }, 2, 1500, { req: "equip:frag" }),
  t("d_flash", "gear", "Lights Out", "Eliminate 2 blinded operators", "kill", { impaired: "flashed" }, 2, 1500, { req: "equip:flash" }),
  t("d_stun", "gear", "Rattled", "Eliminate 2 concussed operators", "kill", { impaired: "stunned" }, 2, 1500, { req: "equip:stun" }),
  t("d_callins", "gear", "Call It In", "Earn 2 call-ins", "callin", {}, 2, 1250),
  t("d_airstrike", "gear", "Wings Over", "Earn the Airstrike call-in", "callin", { id: ["airstrike", "orbital"] }, 1, 2500),
  // ---- objectives & modes
  t("d_flagcap", "objective", "Flag Runner", "Capture 2 flags", "flag", { state: "captured" }, 2, 2000),
  t("d_flagret", "objective", "Home Guard", "Return 3 flags", "flag", { state: "returned" }, 3, 1250),
  t("d_zonecap", "objective", "Ground Taken", "Capture 4 Stronghold zones", "zone", { state: "captured" }, 4, 1500),
  t("d_zonedef", "objective", "Hold the Line", "Defend Stronghold zones 5 times", "zone", { state: "defended" }, 5, 1500),
  t("d_wins", "match", "Field Win", "Win 2 matches", "matchEnd", { won: true }, 2, 1500),
  t("d_tdmwin", "match", "Skirmish Victor", "Win a Skirmish match", "matchEnd", { won: true, mode: "tdm" }, 1, 1250),
  t("d_ffa", "match", "Lone Operator", "Complete 2 Free-for-All matches", "matchEnd", { completed: true, mode: "ffa" }, 2, 1000),
  t("d_matches", "match", "Full Shift", "Complete 3 matches", "matchEnd", { completed: true }, 3, 1000),
  t("d_ops", "match", "Field Orders", "Complete 3 operation objectives", "objective", {}, 3, 1250),
];

// Weekly: 5,000-9,000 XP.
export const WEEKLY = [
  t("w_kills", "combat", "Week of Steel", "Eliminate 150 operators", "kill", {}, 150, 6000),
  t("w_heads", "combat", "Marksman's Week", "Get 60 headshot eliminations", "kill", { headshot: true }, 60, 7000),
  t("w_long", "combat", "Long Horizon", "Get 20 eliminations from beyond 40 m", "kill", { minDist: LONGSHOT_M }, 20, 7500),
  t("w_wins", "match", "Victory Ledger", "Win 10 matches", "matchEnd", { won: true }, 10, 8000),
  t("w_matches", "match", "Standard Issue", "Complete 15 matches", "matchEnd", { completed: true }, 15, 5000),
  t("w_zones", "objective", "Ground Control", "Capture 25 Stronghold zones", "zone", { state: "captured" }, 25, 7000),
  t("w_flags", "objective", "Colours Taken", "Capture 10 flags", "flag", { state: "captured" }, 10, 8000),
  t("w_pike", "weapon", "Sidearm Week", "Get 30 eliminations with the Pike", "kill", { weapon: "pike" }, 30, 6000, { req: "weapon:pike" }),
  t("w_corvus", "weapon", "Patient Rifle", "Get 40 eliminations with the Corvus", "kill", { weapon: "corvus" }, 40, 7000, { req: "weapon:corvus" }),
  t("w_callins", "gear", "Heavy Ordnance", "Earn 8 call-ins", "callin", {}, 8, 6000),
  t("w_impaired", "gear", "Tactician", "Eliminate 10 blinded or concussed operators", "kill", { impaired: "any" }, 10, 7500, { req: "equip:flash" }),
  t("w_multi", "combat", "Chain Reaction", "Earn 15 Double Kill or better medals", "medal", { medalAny: MULTI }, 15, 7000),
  t("w_streak10", "combat", "Unshaken", "Reach a 10-elimination streak in one life", "lifeStreak", {}, 10, 9000, { mode: "best" }),
  t("w_domwins", "match", "Stronghold Week", "Win 5 Stronghold matches", "matchEnd", { won: true, mode: "dom" }, 5, 8000),
  t("w_trip", "gear", "Trapper", "Get 10 tripmine eliminations", "kill", { via: "claymore" }, 10, 8000, { req: "equip:claymore" }),
  t("w_knife", "combat", "Edge Work", "Get 20 melee eliminations", "kill", { via: "melee" }, 20, 7000), // [melee]
  t("w_campaign", "match", "Operation Ready", "Complete 2 operations", "opEnd", { won: true }, 2, 6000),
];

// Career: tracks of tiers over lifetime counters. tiers: [target, xp].
function track(id, name, desc, metric, tiers, extra) {
  return Object.assign({ id, name, desc, metric, tiers: tiers.map(([n, xp]) => ({ n, xp })), best: false }, extra || {});
}
export const CAREER = [
  track("c_kills", "Eliminations", "Lifetime eliminations", "kills", [[50, 500], [250, 1500], [1000, 4000], [2500, 8000], [5000, 12000]]),
  track("c_heads", "Headhunter", "Lifetime headshot eliminations", "heads", [[25, 750], [100, 2000], [400, 5000], [1000, 10000]]),
  track("c_long", "Far Sight", "Eliminations from beyond 40 m", "longshots", [[10, 750], [50, 2500], [150, 5000], [400, 10000]]),
  track("c_warden", "Warden Service", "Eliminations with the Warden", "kills_warden", [[100, 1500], [500, 4000], [1500, 8000]]),
  track("c_vesper", "Vesper Service", "Eliminations with the Vesper", "kills_vesper", [[100, 1500], [500, 4000], [1500, 8000]]),
  track("c_breaker", "Breaker Service", "Eliminations with the Breaker", "kills_breaker", [[100, 1500], [500, 4000], [1500, 8000]]),
  track("c_corvus", "Corvus Service", "Eliminations with the Corvus", "kills_corvus", [[100, 1500], [500, 4000], [1500, 8000]]),
  track("c_pike", "Pike Service", "Eliminations with the Pike", "kills_pike", [[50, 1500], [250, 4000], [750, 8000]]),
  track("c_wins", "Victor", "Matches won", "wins", [[5, 750], [25, 2500], [100, 6000], [250, 12000]]),
  track("c_matches", "Veteran", "Matches completed", "matches", [[10, 500], [50, 2000], [200, 5000], [500, 10000]]),
  track("c_flags", "Standard Bearer", "Flags captured", "flagCaps", [[5, 750], [25, 2500], [100, 6000]]),
  track("c_zones", "Holdfast", "Stronghold zones captured", "zoneCaps", [[10, 750], [50, 2500], [200, 6000]]),
  track("c_callins", "Fire Support", "Call-ins earned", "callins", [[10, 750], [50, 2500], [150, 6000]]),
  track("c_multi", "Chain Gang", "Triple Kill or better medals", "multis", [[5, 1000], [25, 3000], [100, 7000]]),
  track("c_trip", "Tripwire", "Tripmine eliminations", "tripKills", [[5, 1000], [25, 3000], [100, 7000]]),
  track("c_impaired", "Blindside", "Eliminations on blinded or concussed operators", "impairedKills", [[10, 1000], [50, 3000], [150, 7000]]),
  track("c_ops", "Meridian Service", "Operations completed", "operations", [[1, 1000], [5, 3000], [15, 7000]]),
  track("c_streak", "Untouchable", "Best elimination streak in one life", "bestStreak", [[5, 750], [10, 2500], [15, 5000], [20, 10000]], { best: true }),
];
export const CAREER_TIERS = CAREER.reduce((s, tr) => s + tr.tiers.length, 0);
export const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

export const ACTIVE_COUNT = 3;

// ===========================================================================
// Pure helpers — calendar, selection, predicate matching (exported for tests)
// ===========================================================================

// Local calendar day -> integer day number (days since 1970-01-01 of the LOCAL
// date). Date.UTC on the local Y/M/D makes it DST-proof (every day is 1 apart).
export function dayNumber(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
// Weeks start Monday. Day 4 (1970-01-05) was a Monday.
export function weekOfDay(day) { return Math.floor((day - 4) / 7); }
export function weekStartDay(week) { return week * 7 + 4; }
// local midnight (ms) at the START of day number `day`
export function dayStartMs(day) {
  const u = new Date(day * 86400000); // UTC midnight of that Y/M/D
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime();
}
export function dayKey(day) {
  const u = new Date(day * 86400000);
  return u.toISOString().slice(0, 10);
}

// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
// deterministic order of every template id for a period
export function periodOrder(list, seed) {
  const ids = list.map((x) => x.id);
  const r = rng(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }
  return ids;
}
export const daySeed = (day) => (Math.imul(day, 2654435761) ^ 0x5bd1e995) >>> 0;
export const weekSeed = (week) => (Math.imul(week + 7777, 2246822519) ^ 0x27d4eb2f) >>> 0;

// choose n ids from `order`, eligible only, preferring distinct groups
export function pickSet(list, order, n, eligible, exclude) {
  const byId = {};
  for (const x of list) byId[x.id] = x;
  const ex = new Set(exclude || []);
  const cand = order.filter((id) => byId[id] && !ex.has(id) && (!eligible || eligible(byId[id])));
  const out = [], groups = new Set();
  for (const id of cand) {
    if (out.length >= n) break;
    if (groups.has(byId[id].group)) continue;
    out.push(id); groups.add(byId[id].group);
  }
  for (const id of cand) { if (out.length >= n) break; if (out.indexOf(id) < 0) out.push(id); }
  return out;
}

// does fact f satisfy `where`?
export function matchFact(where, f) {
  for (const k of Object.keys(where || {})) {
    const w = where[k];
    switch (k) {
      case "minDist": if (!(f.dist >= w)) return false; break;
      case "maxDist": if (!(f.dist != null && f.dist <= w)) return false; break;
      case "minKills": if (!((f.kills | 0) >= w)) return false; break;
      case "maxDeaths": if (!((f.deaths | 0) <= w)) return false; break;
      case "medalAny": {
        const tx = String(f.text || "").toUpperCase();
        if (!w.some((p) => tx.indexOf(p) === 0)) return false;
        break;
      }
      case "impaired": {
        const im = f.impaired || {};
        if (w === "any" ? !(im.flashed || im.stunned) : !im[w]) return false;
        break;
      }
      default: {
        const v = f[k];
        if (Array.isArray(w)) { if (w.indexOf(v) < 0) return false; }
        else if (typeof w === "boolean") { if (!!v !== w) return false; }
        else if (v !== w) return false;
      }
    }
  }
  return true;
}

// fact -> career metric increments ({metric: n}) and best values ({metric: v})
export function careerDelta(f) {
  const inc = {}, best = {};
  const add = (k, n) => { inc[k] = (inc[k] || 0) + (n || 1); };
  if (f.k === "kill") {
    add("kills");
    if (f.headshot) add("heads");
    if (f.dist >= LONGSHOT_M) add("longshots");
    if (f.weapon) add("kills_" + f.weapon);
    if (f.via === "claymore") add("tripKills");
    if (f.impaired && (f.impaired.flashed || f.impaired.stunned)) add("impairedKills");
  } else if (f.k === "lifeStreak") best.bestStreak = f.value | 0;
  else if (f.k === "medal" && matchFact({ medalAny: MULTI3 }, f)) add("multis");
  else if (f.k === "callin") add("callins");
  else if (f.k === "flag" && f.state === "captured") add("flagCaps");
  else if (f.k === "zone" && f.state === "captured") add("zoneCaps");
  else if (f.k === "matchEnd") { if (f.completed) add("matches"); if (f.won) add("wins"); }
  else if (f.k === "opEnd" && f.won) add("operations");
  return { inc, best };
}

// ===========================================================================
// Save record
// ===========================================================================

export const SAVE_KEY = "blackridge.challenges";
export const SAVE_VERSION = 1;
const MAX_SLOT_ITEMS = 6;

function num(v, max) {
  v = Number(v);
  if (!isFinite(v) || v < 0) return 0;
  return Math.min(Math.floor(v), max == null ? 1e12 : max);
}

export function blankRecord() {
  return {
    v: SAVE_VERSION,
    maxDay: 0,                                                   // highest local day seen (clock-back guard)
    day: { n: -1, ids: [], prog: {}, swapped: false, out: [] },   // prog: id -> {p, done}
    week: { n: -1, ids: [], prog: {} },
    career: { c: {}, tier: {} },                                 // c: metric -> value; tier: trackId -> tiers paid
    seeded: false,
    totals: { daily: 0, weekly: 0, career: 0, xp: 0 },
    updated: 0,
  };
}

const TPL = {};
for (const x of DAILY) TPL[x.id] = Object.assign({ scope: "daily" }, x);
for (const x of WEEKLY) TPL[x.id] = Object.assign({ scope: "weekly" }, x);
const TRACK = {};
for (const x of CAREER) TRACK[x.id] = x;

function sanitizeSlot(s, list, withSwap) {
  const ids = Array.isArray(s && s.ids) ? s.ids.filter((id) => typeof id === "string" && list[id]).slice(0, MAX_SLOT_ITEMS) : [];
  const prog = {};
  const src = (s && s.prog && typeof s.prog === "object") ? s.prog : {};
  for (const id of ids) {
    const p = src[id] || {};
    const tgt = list[id].target;
    prog[id] = { p: Math.min(num(p.p), tgt), done: !!p.done };
    if (prog[id].p >= tgt) prog[id].done = true;
  }
  const out = { n: Number.isFinite(Number(s && s.n)) ? Math.floor(Number(s.n)) : -1, ids, prog };
  if (out.n < -1 || out.n > 1e7) out.n = -1;
  if (withSwap) {
    out.swapped = !!(s && s.swapped);
    out.out = Array.isArray(s && s.out) ? s.out.filter((id) => typeof id === "string" && list[id]).slice(0, 8) : [];
  }
  return out;
}

export function sanitize(r) {
  const out = blankRecord();
  if (!r || typeof r !== "object") return out;
  out.maxDay = num(r.maxDay, 1e7);
  out.day = sanitizeSlot(r.day, TPL, true);
  out.week = sanitizeSlot(r.week, TPL, false);
  if (r.career && typeof r.career === "object") {
    const c = r.career.c || {};
    for (const k of Object.keys(c)) if (/^[a-z0-9_]{1,32}$/i.test(k)) out.career.c[k] = num(c[k], 1e9);
    const tier = r.career.tier || {};
    for (const k of Object.keys(tier)) if (TRACK[k]) out.career.tier[k] = Math.min(num(tier[k]), TRACK[k].tiers.length);
  }
  out.seeded = !!r.seeded;
  if (r.totals && typeof r.totals === "object") for (const k of Object.keys(out.totals)) out.totals[k] = num(r.totals[k]);
  out.updated = num(r.updated);
  return out;
}

// MIGRATIONS[n] upgrades a version-n record to n+1. v0 = a hypothetical
// pre-release shape {career:{metric:n}, paid:{trackId:n}} (template for future bumps).
export const MIGRATIONS = {
  0(r) {
    const out = blankRecord();
    if (r.career && typeof r.career === "object") for (const k of Object.keys(r.career)) out.career.c[k] = num(r.career[k], 1e9);
    if (r.paid && typeof r.paid === "object") for (const k of Object.keys(r.paid)) out.career.tier[k] = num(r.paid[k]);
    out.seeded = true;
    return out;
  },
};

export function parseRecord(raw) {
  if (raw == null || raw === "") return { rec: blankRecord(), status: "fresh" };
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { rec: blankRecord(), status: "corrupt" }; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { rec: blankRecord(), status: "corrupt" };
  let v = typeof obj.v === "number" && isFinite(obj.v) ? Math.floor(obj.v) : 0;
  if (v > SAVE_VERSION) return { rec: sanitize(obj), status: "future" };
  let migrated = false;
  try {
    while (v < SAVE_VERSION) {
      const m = MIGRATIONS[v];
      if (!m) return { rec: blankRecord(), status: "corrupt" };
      obj = m(obj);
      v = typeof obj.v === "number" ? obj.v : v + 1;
      migrated = true;
    }
  } catch (e) { return { rec: blankRecord(), status: "corrupt" }; }
  return { rec: sanitize(obj), status: migrated ? "migrated" : "ok" };
}

// a clock wound back by more than this many days is treated as a clock
// CORRECTION (adopt the real date); a smaller step back keeps the current set
export const CLOCK_BACK_TOLERANCE_DAYS = 2;

// ===========================================================================
// The challenges instance
// ===========================================================================

export function createChallenges(ctx, progression, opts) {
  ctx = ctx || {};
  opts = opts || {};
  const P = progression || null;
  const storage = opts.storage !== undefined ? opts.storage
    : (typeof localStorage !== "undefined" ? localStorage : null);
  const nowMs = opts.now || (() => Date.now());
  const KEY = SAVE_KEY + ".v" + SAVE_VERSION;
  const LEGACY_KEYS = [SAVE_KEY];

  let rec = blankRecord();
  let loadStatus = "fresh";
  let readOnly = false;
  let saveFailed = false;

  function load() {
    let raw = null, fromKey = KEY;
    try {
      if (storage) {
        raw = storage.getItem(KEY);
        if (raw == null) for (const k of LEGACY_KEYS) { const r = storage.getItem(k); if (r != null) { raw = r; fromKey = k; break; } }
      }
    } catch (e) { raw = null; }
    const res = parseRecord(raw);
    rec = res.rec;
    loadStatus = res.status;
    readOnly = res.status === "future";
    if (res.status === "corrupt") {
      try { storage && storage.setItem(KEY + ".corrupt", String(raw).slice(0, 20000)); } catch (e) { /* quota */ }
    }
    if (res.status === "migrated" && fromKey !== KEY) { try { storage.removeItem(fromKey); } catch (e) { /* no-op */ } }
  }
  function save() {
    if (readOnly || !storage) return false;
    rec.updated = nowMs();
    try { storage.setItem(KEY, JSON.stringify(rec)); saveFailed = false; return true; }
    catch (e) {
      try { storage.removeItem(KEY + ".corrupt"); storage.setItem(KEY, JSON.stringify(rec)); saveFailed = false; return true; }
      catch (e2) { saveFailed = true; return false; }
    }
  }

  // ---- listeners ---------------------------------------------------------
  const eventFns = new Set(), changeFns = new Set();
  function notify(ev) { for (const fn of eventFns) { try { fn(ev); } catch (e) { /* listener */ } } }
  function notifyChange() { for (const fn of changeFns) { try { fn(api); } catch (e) { /* listener */ } } }

  // ---- seeding career from the existing progression profile -----------------
  // Seeded tiers are marked as already reached WITHOUT paying XP (a returning
  // player would otherwise get a lump of retroactive XP on first load).
  function seedCareer() {
    if (rec.seeded) return;
    rec.seeded = true;
    if (!P) return;
    let life = null, st = null;
    try { life = P.lifetime; } catch (e) { /* old build */ }
    try { st = P.state; } catch (e) { /* old build */ }
    const c = rec.career.c;
    if (life) {
      c.kills = Math.max(c.kills || 0, num(life.kills));
      c.heads = Math.max(c.heads || 0, num(life.heads));
      c.matches = Math.max(c.matches || 0, num(life.matches));
      c.wins = Math.max(c.wins || 0, num(life.wins));
      c.bestStreak = Math.max(c.bestStreak || 0, num(life.bestStreak));
    }
    if (st && st.weapons) for (const w of Object.keys(st.weapons)) {
      c["kills_" + w] = Math.max(c["kills_" + w] || 0, num(st.weapons[w] && st.weapons[w].kills));
    }
    for (const tr of CAREER) {
      const v = c[tr.metric] || 0;
      let n = 0;
      while (n < tr.tiers.length && v >= tr.tiers[n].n) n++;
      rec.career.tier[tr.id] = Math.max(rec.career.tier[tr.id] || 0, n);
    }
  }

  // ---- calendar ---------------------------------------------------------------
  function today() { return dayNumber(nowMs()); }
  // effective day: the clock may step back a little (DST, timezone travel, a
  // manual nudge) without reopening yesterday's set; a big step back is a
  // clock correction and the real date wins.
  function effectiveDay() {
    const d = today();
    if (d >= rec.maxDay) return d;
    if (rec.maxDay - d > CLOCK_BACK_TOLERANCE_DAYS) return d;
    return rec.maxDay;
  }
  function eligible(tpl) {
    if (!tpl.req || !P || typeof P.isUnlocked !== "function") return true;
    try { return P.isUnlocked(tpl.req) !== false; } catch (e) { return true; }
  }
  function dailyFor(day) { return pickSet(DAILY, periodOrder(DAILY, daySeed(day)), ACTIVE_COUNT, eligible); }
  function weeklyFor(week) { return pickSet(WEEKLY, periodOrder(WEEKLY, weekSeed(week)), ACTIVE_COUNT, eligible); }

  // roll the daily / weekly sets when the period changed. Returns true if anything changed.
  function refresh() {
    const day = effectiveDay();
    let changed = false;
    if (day !== rec.maxDay) { rec.maxDay = day; changed = true; }
    if (rec.day.n !== day) {
      const ids = dailyFor(day);
      const prog = {};
      for (const id of ids) prog[id] = { p: 0, done: false };
      rec.day = { n: day, ids, prog, swapped: false, out: [] };
      changed = true;
    }
    const wk = weekOfDay(day);
    if (rec.week.n !== wk) {
      const ids = weeklyFor(wk);
      const prog = {};
      for (const id of ids) prog[id] = { p: 0, done: false };
      rec.week = { n: wk, ids, prog };
      changed = true;
    }
    if (changed) { save(); notifyChange(); }
    return changed;
  }

  // ---- session ledger (this match / operation) -----------------------------
  let sess = null;
  function beginSession(kind, mode) {
    sess = {
      kind, mode: mode || null, kills: 0, deaths: 0, life: 0,
      ledger: {},      // key -> {key, scope, name, desc, from, to, target, done, xp}
      xp: 0, ended: false, toasts: 0,
    };
    lastShotW = null; lastShotT = -9; blast = null; impaired = {};
  }
  let lastSession = null;
  function ledgerTouch(key, scope, name, desc, from, to, target, done, xp) {
    if (!sess) return null;
    const L = sess.ledger[key] || (sess.ledger[key] = { key, scope, name, desc, from, to: from, target, done: false, xp: 0 });
    L.to = to; L.target = target;
    if (done && !L.done) { L.done = true; L.xp += xp || 0; }
    return L;
  }

  // ---- XP -------------------------------------------------------------------
  function pay(amount, label) {
    rec.totals.xp += amount;
    if (sess) sess.xp += amount;
    if (P && typeof P.award === "function") { try { P.award("challenge", amount, label); } catch (e) { /* never break */ } }
  }

  // ---- applying a fact -------------------------------------------------------
  function applyTo(slot, scope, f) {
    for (const id of slot.ids) {
      const tpl = TPL[id];
      const pr = slot.prog[id] || (slot.prog[id] = { p: 0, done: false });
      if (pr.done || tpl.fact !== f.k || !matchFact(tpl.where, f)) continue;
      const before = pr.p;
      if (tpl.mode === "best") pr.p = Math.min(tpl.target, Math.max(pr.p, f.value | 0));
      else pr.p = Math.min(tpl.target, pr.p + (f.n || 1));
      if (pr.p === before) continue;
      const done = pr.p >= tpl.target;
      if (done) claimSlot(slot, scope, id);
      const L = ledgerTouch(id, scope, tpl.name, tpl.desc, before, pr.p, tpl.target, done, tpl.xp);
      notify({ type: done ? "complete" : "progress", scope, id, name: tpl.name, desc: tpl.desc, from: before, to: pr.p, target: tpl.target, xp: done ? tpl.xp : 0, entry: L });
    }
  }
  // idempotent: pays once, ever, per slot item
  function claimSlot(slot, scope, id) {
    const pr = slot.prog[id];
    if (!pr || pr.done) return 0;
    const tpl = TPL[id];
    if (pr.p < tpl.target) return 0;
    pr.done = true;
    rec.totals[scope] = (rec.totals[scope] || 0) + 1;
    pay(tpl.xp, (scope === "daily" ? "Daily: " : "Weekly: ") + tpl.name);
    return tpl.xp;
  }
  function applyCareer(f) {
    const { inc, best } = careerDelta(f);
    const c = rec.career.c;
    const touched = new Set();
    for (const k of Object.keys(inc)) { c[k] = (c[k] || 0) + inc[k]; touched.add(k); }
    for (const k of Object.keys(best)) if (best[k] > (c[k] || 0)) { c[k] = best[k]; touched.add(k); }
    if (!touched.size) return;
    for (const tr of CAREER) {
      if (!touched.has(tr.metric)) continue;
      const v = c[tr.metric] || 0;
      let paid = rec.career.tier[tr.id] || 0;
      while (paid < tr.tiers.length && v >= tr.tiers[paid].n) {
        const tier = tr.tiers[paid];
        paid++;
        rec.career.tier[tr.id] = paid;
        rec.totals.career++;
        const name = tr.name + " " + ROMAN[paid - 1];
        pay(tier.xp, "Career: " + name);
        const L = ledgerTouch(tr.id + ":" + paid, "career", name, tr.desc + ": " + tier.n, tier.n, tier.n, tier.n, true, tier.xp);
        notify({ type: "complete", scope: "career", id: tr.id, tier: paid, name, desc: tr.desc, from: v, to: v, target: tier.n, xp: tier.xp, entry: L });
      }
    }
  }
  function apply(f) {
    if (!f) return;
    refreshIfStale();
    applyTo(rec.day, "daily", f);
    applyTo(rec.week, "weekly", f);
    applyCareer(f);
    dirty = true;
  }
  let dirty = false;
  function flush() { if (dirty) { dirty = false; save(); notifyChange(); } }
  // outside a session the period can roll over; inside one we keep counting into
  // the set that was live when it began (finishing a match after midnight still
  // credits the set you were playing for)
  function refreshIfStale() { if (!sess || sess.ended) refresh(); }

  // ---- raw event -> fact ------------------------------------------------------
  let lastShotW = null, lastShotT = -9;
  let blast = null;            // {who, source, t}
  let pendingDetonate = null;  // grenade detonate who, waiting for its explosion
  let impaired = {};           // operator id -> {flash: untilT, stun: untilT}
  let lastKill = null;         // test seam: the last derived kill fact
  const sim = () => (ctx.sim ? ctx.sim() : null);
  const simTime = () => { const s = sim(); return s && s.state ? s.state.time : 0; };
  const curMode = () => (sess && sess.mode) || null;
  function isEnemy(victim) {
    const s = sim();
    try { if (s && s.match && s.match.sameTeam) return !s.match.sameTeam("P", victim); } catch (e) { /* campaign */ }
    return true;
  }
  function playerStance() {
    const s = sim();
    const p = s && s.state && s.state.player;
    if (!p) return "stand";
    if (p._m && p._m.sliding) return "slide";
    if (p.grounded === false) return "air";
    if (p.stance === "crouch") return "crouch";
    return "stand";
  }
  function distTo(pos) {
    const s = sim();
    const p = s && s.state && s.state.player;
    if (!pos || !p || !p.pos) return null;
    return Math.hypot(pos[0] - p.pos[0], pos[1] - p.pos[1], pos[2] - p.pos[2]);
  }
  function ensureSess() {
    if (!sess || sess.ended) {
      const s = sim();
      beginSession(s && s.match ? "match" : "campaign", s && s.match && s.state && s.state.match ? s.state.match.modeId : null);
    }
    return sess;
  }

  const handlers = {
    "match:start"(d) { refresh(); beginSession("match", d && d.mode); },
    "mission:start"(d) {
      const id = d && d.missionId ? String(d.missionId) : "";
      if (id.indexOf("match:") === 0 && sess && sess.kind === "match" && !sess.ended) return;
      refresh();
      beginSession("campaign", "campaign");
    },
    shot(d) {
      if (d && d.shooter === "P" && !d.impactOnly && !d.pen && d.weaponId) { lastShotW = d.weaponId; lastShotT = simTime(); }
    },
    grenade(d) { if (d && d.phase === "detonate") pendingDetonate = d.who; },
    explosion(d) {
      if (!d) return;
      const who = d.who != null ? d.who : pendingDetonate;
      pendingDetonate = null;
      blast = { who, source: d.source || "grenade", t: simTime() };
    },
    equip(d) {
      if (!d || d.who == null) return;
      if (d.phase !== "flashed" && d.phase !== "stunned") return;
      const t = simTime();
      const until = t + Math.max(0.5, Number(d.dur) || 1.5);
      const im = impaired[d.who] || (impaired[d.who] = { flash: -1, stun: -1 });
      if (d.phase === "flashed") im.flash = Math.max(im.flash, until); else im.stun = Math.max(im.stun, until);
    },
    death(d) {
      if (!d) return;
      const s = ensureSess();
      if (s.ended) return;
      if (d.victim === "P") { s.deaths++; s.life = 0; return; }
      if (d.attacker !== "P" || d.victim == null || !isEnemy(d.victim)) return;
      const t = simTime();
      let via = null, weapon = null;
      if (d.melee) via = "melee"; // [melee] the knife (weapon stays null: no gun gets the credit)
      else if (blast && blast.who === "P" && Math.abs(t - blast.t) < 1e-6) {
        via = blast.source === "claymore" ? "claymore" : blast.source === "streak" ? "streak" : "frag";
      } else if (lastShotW && t - lastShotT <= 1.0) { via = "gun"; weapon = lastShotW; }
      const im = impaired[d.victim];
      const f = {
        k: "kill", weapon, via, headshot: !!d.headshot, dist: distTo(d.pos), stance: playerStance(),
        impaired: { flashed: !!(im && im.flash >= t), stunned: !!(im && im.stun >= t) },
        mode: curMode(), pvp: s.kind === "match",
      };
      s.kills++;
      lastKill = f;
      apply(f);
      if (via !== "streak") { s.life++; apply({ k: "lifeStreak", value: s.life }); }
      flush();
    },
    medal(d) { if (d && d.text) { ensureSess(); apply({ k: "medal", text: String(d.text).toUpperCase() }); flush(); } },
    streak(d) { if (d && d.phase === "earned") { ensureSess(); apply({ k: "callin", id: d.id }); flush(); } },
    flag(d) {
      if (!d || d.byWho !== "P") return;
      if (d.state !== "captured" && d.state !== "returned") return;
      ensureSess(); apply({ k: "flag", state: d.state, mode: curMode() }); flush();
    },
    zonecap(d) {
      if (!d || !Array.isArray(d.byWho) || d.byWho.indexOf("P") < 0) return;
      ensureSess(); apply({ k: "zone", state: d.state, mode: curMode() }); flush();
    },
    objective(d) {
      const s = sim();
      if (!d || d.state !== "done" || (s && s.match)) return;
      ensureSess(); apply({ k: "objective" }); flush();
    },
  };

  // match / operation end: through progression's pre-report hook so challenge XP
  // lands in THIS match's after-action ledger; a bridge fallback covers a
  // progression build without the hook.
  function onEnd(d) {
    if (!d) return;
    const s = ensureSess();
    if (s.ended) return;
    if (d.match) {
      const r = d.match.result;
      apply({ k: "matchEnd", mode: d.match.modeId || s.mode, won: d.result === "won", result: r,
        completed: r !== "forfeit", kills: s.kills, deaths: s.deaths });
    } else {
      apply({ k: "opEnd", won: d.result === "won" });
    }
    s.ended = true;
    lastSession = sess;
    save(); dirty = false;
    notify({ type: "sessionEnd", session: summary(s) });
    notifyChange();
  }
  let hookedEnd = false;
  if (P && typeof P.onSessionEnd === "function") { P.onSessionEnd((d) => onEnd(d)); hookedEnd = true; }
  if (P && typeof P.onEvent === "function") {
    P.onEvent((e) => { if (e && e.type === "xp" && e.cat === "assist") { ensureSess(); apply({ k: "assist" }); flush(); } });
  }

  function summary(s) {
    if (!s) return null;
    const items = Object.keys(s.ledger).map((k) => Object.assign({}, s.ledger[k]))
      .filter((x) => x.to > x.from || x.done);
    const ord = { daily: 0, weekly: 1, career: 2 };
    items.sort((a, b) => (b.done - a.done) || (ord[a.scope] - ord[b.scope]));
    return { kind: s.kind, mode: s.mode, xp: s.xp, items };
  }

  // ---- views -------------------------------------------------------------------
  function slotView(slot, scope) {
    return slot.ids.map((id, i) => {
      const tpl = TPL[id], pr = slot.prog[id] || { p: 0, done: false };
      return { slot: i, id, scope, name: tpl.name, desc: tpl.desc, group: tpl.group, p: pr.p, target: tpl.target, done: pr.done, xp: tpl.xp };
    });
  }
  function careerView() {
    return CAREER.map((tr) => {
      const v = rec.career.c[tr.metric] || 0;
      const paid = rec.career.tier[tr.id] || 0;
      const next = tr.tiers[paid] || null;
      return {
        id: tr.id, name: tr.name, desc: tr.desc, value: v, tier: paid, tiers: tr.tiers.length,
        target: next ? next.n : tr.tiers[tr.tiers.length - 1].n, xp: next ? next.xp : 0,
        prevTarget: paid > 0 ? tr.tiers[paid - 1].n : 0, best: tr.best, maxed: !next,
      };
    });
  }

  // ---- public ------------------------------------------------------------------
  load();
  seedCareer();
  if (loadStatus === "corrupt" || loadStatus === "migrated" || loadStatus === "fresh") save();
  refresh();

  const api = {
    // views always roll the period (they are read from menus, between matches)
    daily() { refresh(); return slotView(rec.day, "daily"); },
    weekly() { refresh(); return slotView(rec.week, "weekly"); },
    career: careerView,
    careerSummary() {
      let done = 0;
      for (const tr of CAREER) done += rec.career.tier[tr.id] || 0;
      return { done, total: CAREER_TIERS };
    },
    // swap one unfinished daily for another (once per day)
    canReroll(slot) {
      refresh();
      const id = rec.day.ids[slot];
      return !!id && !rec.day.swapped && !(rec.day.prog[id] && rec.day.prog[id].done);
    },
    get rerollUsed() { return !!rec.day.swapped; },
    reroll(slot) {
      if (!api.canReroll(slot)) return null;
      const old = rec.day.ids[slot];
      const others = rec.day.ids.filter((x, i) => i !== slot);
      const order = periodOrder(DAILY, daySeed(rec.day.n) ^ 0x9e3779b9);
      const groups = new Set(others.map((x) => TPL[x].group));
      const exclude = rec.day.ids.concat(rec.day.out);
      const pick = pickSet(DAILY, order, 1, (tp) => eligible(tp) && !groups.has(tp.group), exclude)[0]
        || pickSet(DAILY, order, 1, eligible, exclude)[0];
      if (!pick) return null;
      rec.day.ids[slot] = pick;
      delete rec.day.prog[old];
      rec.day.prog[pick] = { p: 0, done: false };
      rec.day.out.push(old);
      rec.day.swapped = true;
      save(); notifyChange();
      return pick;
    },
    // ms until the daily / weekly reset (local midnight / Monday 00:00)
    resets() {
      const now = nowMs();
      const day = rec.day.n >= 0 ? rec.day.n : effectiveDay();
      const wk = rec.week.n >= 0 ? rec.week.n : weekOfDay(day);
      return {
        daily: Math.max(0, dayStartMs(day + 1) - now),
        weekly: Math.max(0, dayStartMs(weekStartDay(wk + 1)) - now),
        day, week: wk, dayKey: dayKey(day),
      };
    },
    refresh,
    get session() { return summary(sess && !sess.ended ? sess : lastSession); },
    get lastSession() { return summary(lastSession); },
    get totals() { return Object.assign({}, rec.totals); },
    get status() { return { load: loadStatus, readOnly, saveFailed, hookedEnd }; },
    onEvent(fn) { if (typeof fn === "function") eventFns.add(fn); return () => eventFns.delete(fn); },
    onChange(fn) { if (typeof fn === "function") changeFns.add(fn); return () => changeFns.delete(fn); },
    attach(bridge) {
      for (const k of Object.keys(handlers)) {
        bridge.register(k, (d) => { try { handlers[k](d); } catch (e) { /* never break the frame */ } });
      }
      if (!hookedEnd) bridge.register("mission:end", (d) => { try { onEnd(d); } catch (e) { /* no-op */ } });
    },
    save,
    // test seams
    _fact(f) { ensureSess(); apply(f); flush(); },
    _end(d) { onEnd(d); },
    get _lastKill() { return lastKill ? JSON.parse(JSON.stringify(lastKill)) : null; },
    get state() { return JSON.parse(JSON.stringify(rec)); },
    _reload() { load(); refresh(); notifyChange(); },
  };
  return api;
}
