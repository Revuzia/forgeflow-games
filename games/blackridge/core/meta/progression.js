// core/meta/progression.js — BLACKRIDGE device-saved player progression (2026-11-13).
//
// VIEW/META LAYER ONLY. Listens to the sim's bridge events (never touches sim
// state, so the 60 Hz deterministic sim and its selftests are unaffected) and
// keeps ONE versioned save record in localStorage:
//   - player XP -> player level 1..55 with a rank name per level
//   - per-weapon XP -> weapon level 1..20, from kills made with that weapon
//   - an UNLOCK TABLE (data, below) other systems query through a small API
//   - a per-match ledger -> the after-action report (core/hud/after_action.js)
//
// The expansion plan ruled "no XP" because there are no server writes; the owner
// overruled that 2026-11 for DEVICE-SAVED progress. Nothing here talks to a server.
//
// Stable API (loadouts and other lanes call it DEFENSIVELY):
//   progression.level() -> int 1..55          progression.xp() -> total XP
//   progression.weaponLevel(id) -> int 1..20  progression.isUnlocked(key) -> bool
//   progression.unlockLevel(key) -> number|null  (player level; for "attach:" keys
//                                               it is the WEAPON level)
//   progression.onChange(fn) -> unsubscribe fn
// Unknown keys are UNLOCKED (true) so nothing breaks before the other lanes land.
// Reachable as ctx.progression and window.__FPS__.progression (boot wiring).
//
// THREE-free and DOM-free: core/meta/progression.selftest.cjs runs it in node.
// PVP wording rule: nothing player-facing here may name opponents as anything but
// operators/players (no bots/AI/NPC/difficulty).

// ===========================================================================
// DATA — unlock table, XP table, curve, rank names. Plain objects on purpose.
// ===========================================================================

// Player-level unlocks. Key -> player level required.
export const UNLOCKS = {
  // weapons (pistol + AR from level 1)
  "weapon:warden": 1,
  "weapon:pike": 1,
  // (integration 2026-11-13) early ladder compressed: the five preset classes must
  // differ within the first few matches, not collapse to rifle + pistol until 12
  "weapon:vesper": 2,
  "weapon:breaker": 4,
  "weapon:corvus": 6,
  // equipment
  "equip:frag": 1,
  "equip:flash": 1,
  "equip:smoke": 3,
  "equip:stun": 6,
  "equip:claymore": 8,
  // perks
  // one perk per tier is open from level 1 so a class is a full class on day one
  "perk:scavenger": 1,
  "perk:fastHands": 1,
  "perk:quickfix": 1,
  "perk:doubleTime": 3,
  "perk:flak": 9,
  "perk:hardline": 12,
  "perk:deadsilence": 16,
  "perk:ghost": 22,
  // kill streaks: the default ladder is always available; CHOOSING your own
  // three call-ins is the unlock
  "streak:recon": 1,
  "streak:mortar": 1,
  "streak:airstrike": 1,
  "streak:orbital": 1,
  "feature:streakChoice": 7,
  // player-level camos
  "camo:harbour": 5,
  "camo:tidewater": 15,
  "camo:rustline": 25,
  "camo:slate": 35,
  "camo:ember": 45,
  "camo:blackridge": 55,
};

// Weapon-level unlocks: "attach:<weapon>:<id>" -> that WEAPON's level.
// Applies to every weapon; an id not listed here is unknown -> unlocked.
export const ATTACH_UNLOCKS = {
  reddot: 2,
  suppressor: 4,
  extmag: 6,
  grip: 8,
  holo: 10,
  laser: 12,
  compensator: 14,
  scope: 16,
  rapidfire: 18,
  // weapon camos ride the same ladder ("camo:<weapon>:<id>")
};
export const WEAPON_CAMO_UNLOCKS = { gunmetal: 10, nightglass: 15, lantern: 20 };

export const WEAPON_IDS = ["warden", "vesper", "breaker", "corvus", "pike"];
export const WEAPON_NAMES = {
  warden: "M-72 Warden", vesper: "KS-23 Vesper", breaker: "B-12 Breaker",
  corvus: "LR-1 Corvus", pike: "GS-9 Pike",
};

// Display names for the unlock list on the after-action screen.
export const UNLOCK_NAMES = {
  "weapon:warden": "M-72 Warden", "weapon:pike": "GS-9 Pike", "weapon:vesper": "KS-23 Vesper",
  "weapon:breaker": "B-12 Breaker", "weapon:corvus": "LR-1 Corvus",
  "equip:frag": "Frag grenade", "equip:flash": "Flash grenade", "equip:smoke": "Smoke grenade",
  "equip:stun": "Stun grenade", "equip:claymore": "Claymore",
  "perk:scavenger": "Salvager", "perk:quickfix": "Stim Lace", "perk:fastHands": "Deft Hands",
  "perk:doubleTime": "Long Stride", "perk:flak": "Blast Weave", "perk:hardline": "Priority Line",
  "perk:deadsilence": "Soft Step", "perk:ghost": "Cold Signal",
  "feature:streakChoice": "Call-in selection",
  "camo:harbour": "Harbour camo", "camo:tidewater": "Tidewater camo", "camo:rustline": "Rustline camo",
  "camo:slate": "Slate camo", "camo:ember": "Ember camo", "camo:blackridge": "Blackridge camo",
  reddot: "Red-dot sight", suppressor: "Suppressor", extmag: "Extended mag", grip: "Fore grip",
  holo: "Holo sight", laser: "Laser module", compensator: "Compensator", scope: "Variable scope",
  rapidfire: "Rapid fire", gunmetal: "Gunmetal camo", nightglass: "Nightglass camo", lantern: "Lantern camo",
};

// XP per event. Categories are what the after-action screen breaks down.
export const XP = {
  kill: 100,
  headshot: 50,          // on top of the kill
  assist: 25,
  flagCapture: 300,
  flagReturn: 100,
  flagTaken: 50,
  zoneCapture: 150,      // [lane dom] STRONGHOLD — you were in the ring when it flipped to you
  zoneNeutralise: 50,    // [lane dom] an enemy zone drained to neutral with you in it
  zoneDefend: 50,        // [lane dom] a kill at a zone your team holds (on top of the kill)
  objective: 250,        // campaign beat (objective done)
  medal: {               // medal text -> XP (HEADSHOT and "N KILL STREAK" medals are
    "FIRST BLOOD": 100,  // covered by the headshot / streak awards — not double-paid)
    "REVENGE": 50,
    "LONGSHOT": 50,
    "DOUBLE KILL": 50,
    "TRIPLE KILL": 100,
    "QUAD KILL": 150,
    "MULTI KILL": 200,   // 5+ ("MULTI KILL x5"...)
  },
  streak: { recon: 100, mortar: 200, airstrike: 300, orbital: 500 },
  matchComplete: 500,
  matchWin: 500,
  matchDraw: 200,
  missionComplete: 1500,
  missionFailed: 250,
  missionHard: 750,
  weaponKill: 100,       // weapon XP per kill with that weapon
  weaponHeadshot: 50,
};

export const CATEGORY_LABELS = {
  kill: "Eliminations", headshot: "Headshots", assist: "Assists", objective: "Objectives",
  medal: "Medals", streak: "Call-ins earned", completion: "Match completion", win: "Victory bonus",
  campaign: "Operation",
};

export const MAX_LEVEL = 55;
export const MAX_WEAPON_LEVEL = 20;

// XP needed to go from level L to L+1 (L in 1..54).
export function xpToNext(L) {
  const k = L - 1;
  return 800 + 120 * k + 6 * k * k;
}
// total XP at which level L begins
const LEVEL_FLOOR = [0, 0];
for (let L = 2; L <= MAX_LEVEL; L++) LEVEL_FLOOR[L] = LEVEL_FLOOR[L - 1] + xpToNext(L - 1);
export function levelFloor(L) { return LEVEL_FLOOR[Math.max(1, Math.min(MAX_LEVEL, L | 0))]; }
export function levelForXp(xp) {
  let L = 1;
  while (L < MAX_LEVEL && xp >= LEVEL_FLOOR[L + 1]) L++;
  return L;
}
export const MAX_XP = LEVEL_FLOOR[MAX_LEVEL];

export function weaponXpToNext(l) { return 400 + 100 * (l - 1); }
const WLEVEL_FLOOR = [0, 0];
for (let l = 2; l <= MAX_WEAPON_LEVEL; l++) WLEVEL_FLOOR[l] = WLEVEL_FLOOR[l - 1] + weaponXpToNext(l - 1);
export function weaponLevelFloor(l) { return WLEVEL_FLOOR[Math.max(1, Math.min(MAX_WEAPON_LEVEL, l | 0))]; }
export function weaponLevelForXp(xp) {
  let l = 1;
  while (l < MAX_WEAPON_LEVEL && xp >= WLEVEL_FLOOR[l + 1]) l++;
  return l;
}

// 11 ranks x 5 grades = 55 levels. Harbour / night-ops tone, original names.
export const RANKS = [
  "Deckhand", "Wharf Runner", "Lamplighter", "Tidewatch", "Breakwater",
  "Night Pilot", "Fogline", "Lantern Warden", "Black Tide", "Ridge Marshal", "Harbourmaster",
];
const ROMAN = ["I", "II", "III", "IV", "V"];
export function rankName(L) {
  L = Math.max(1, Math.min(MAX_LEVEL, L | 0));
  return RANKS[Math.floor((L - 1) / 5)] + " " + ROMAN[(L - 1) % 5];
}

// ===========================================================================
// Pure helpers (exported for the selftest)
// ===========================================================================

export function medalXp(text) {
  const t = String(text || "").toUpperCase();
  if (t in XP.medal) return XP.medal[t];
  if (t.indexOf("MULTI KILL") === 0) return XP.medal["MULTI KILL"];
  return 0;
}

// key -> {by:"player"|"weapon", level, weapon?} or null (unknown key)
export function unlockInfo(key) {
  key = String(key || "");
  if (key in UNLOCKS) return { by: "player", level: UNLOCKS[key] };
  const p = key.split(":");
  if (p[0] === "attach" && p.length === 3 && p[2] in ATTACH_UNLOCKS) {
    return { by: "weapon", weapon: p[1], level: ATTACH_UNLOCKS[p[2]] };
  }
  if (p[0] === "camo" && p.length === 3 && p[2] in WEAPON_CAMO_UNLOCKS) {
    return { by: "weapon", weapon: p[1], level: WEAPON_CAMO_UNLOCKS[p[2]] };
  }
  return null;
}

// ===========================================================================
// Save record
// ===========================================================================

export const SAVE_KEY = "blackridge.progress";
export const SAVE_VERSION = 1;

function num(v, max) {
  v = Number(v);
  if (!isFinite(v) || v < 0) return 0;
  return Math.min(Math.floor(v), max == null ? 1e12 : max);
}

export function blankRecord() {
  const weapons = {};
  for (const w of WEAPON_IDS) weapons[w] = { xp: 0, kills: 0, heads: 0 };
  return {
    v: SAVE_VERSION,
    xp: 0,
    weapons,
    life: { matches: 0, wins: 0, missions: 0, kills: 0, heads: 0, assists: 0, caps: 0, bestStreak: 0 },
    seen: [],          // unlock keys already announced (so "NEW" shows once)
    updated: 0,
  };
}

// Migration hook: MIGRATIONS[n] upgrades a version-n record to n+1.
// v0 = anything without a numeric `v` (a hypothetical pre-release shape that kept
// only {xp, weaponXp:{id:n}}); it is the template for future bumps.
export const MIGRATIONS = {
  0(r) {
    const out = blankRecord();
    out.xp = num(r.xp, MAX_XP);
    const wx = r.weaponXp || {};
    for (const w of Object.keys(wx)) out.weapons[w] = { xp: num(wx[w], 1e9), kills: 0, heads: 0 };
    out.v = 1;
    return out;
  },
};

// Sanitize any parsed object into a valid current-version record.
export function sanitize(r) {
  const out = blankRecord();
  if (!r || typeof r !== "object") return out;
  out.xp = num(r.xp, MAX_XP);
  if (r.weapons && typeof r.weapons === "object") {
    for (const w of Object.keys(r.weapons)) {
      if (!/^[a-z0-9_]{1,24}$/i.test(w)) continue;
      const s = r.weapons[w] || {};
      out.weapons[w] = { xp: num(s.xp, 1e9), kills: num(s.kills), heads: num(s.heads) };
    }
  }
  if (r.life && typeof r.life === "object") for (const k of Object.keys(out.life)) out.life[k] = num(r.life[k]);
  if (Array.isArray(r.seen)) out.seen = r.seen.filter((k) => typeof k === "string" && k.length < 64).slice(0, 400);
  out.updated = num(r.updated);
  return out;
}

// raw string -> {rec, status: "fresh"|"ok"|"migrated"|"corrupt"|"future"}
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

// ===========================================================================
// The progression instance
// ===========================================================================

export function createProgression(ctx, opts) {
  ctx = ctx || {};
  opts = opts || {};
  const storage = opts.storage !== undefined ? opts.storage
    : (typeof localStorage !== "undefined" ? localStorage : null);
  const KEY = SAVE_KEY + ".v" + SAVE_VERSION;
  const LEGACY_KEYS = [SAVE_KEY]; // un-versioned key a v0 record would live under

  let rec = blankRecord();
  let loadStatus = "fresh";
  let readOnly = false;   // a record from a NEWER build: never overwrite it
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
      // keep the bad bytes for diagnosis, then start clean
      try { storage && storage.setItem(KEY + ".corrupt", String(raw).slice(0, 20000)); } catch (e) { /* quota */ }
      save();
    } else if (res.status === "migrated") {
      save();
      if (fromKey !== KEY) { try { storage.removeItem(fromKey); } catch (e) { /* no-op */ } }
    }
  }

  function save() {
    if (readOnly || !storage) return false;
    rec.updated = Date.now();
    try {
      storage.setItem(KEY, JSON.stringify(rec));
      saveFailed = false;
      return true;
    } catch (e) {
      // quota / blocked: drop the bulkiest optional field and retry once
      try {
        rec.seen = rec.seen.slice(-60);
        try { storage.removeItem(KEY + ".corrupt"); } catch (_) { /* no-op */ }
        storage.setItem(KEY, JSON.stringify(rec));
        saveFailed = false;
        return true;
      } catch (e2) {
        saveFailed = true; // progress stays in memory for this session
        return false;
      }
    }
  }

  load();

  // ---- listeners -----------------------------------------------------------
  const changeFns = new Set();
  const eventFns = new Set();
  function notifyChange() { for (const fn of changeFns) { try { fn(api); } catch (e) { /* listener */ } } }
  function notify(ev) { for (const fn of eventFns) { try { fn(ev); } catch (e) { /* listener */ } } }

  // ---- queries -------------------------------------------------------------
  const level = () => levelForXp(rec.xp);
  const wrec = (id) => rec.weapons[id] || { xp: 0, kills: 0, heads: 0 };
  const weaponLevel = (id) => weaponLevelForXp(wrec(id).xp);

  function isUnlocked(key) {
    const info = unlockInfo(key);
    if (!info) return true;
    if (info.by === "player") return level() >= info.level;
    return weaponLevel(info.weapon) >= info.level;
  }
  function unlockLevel(key) {
    const info = unlockInfo(key);
    return info ? info.level : null;
  }
  // every player-level unlock reached at exactly level L
  function unlocksAtLevel(L) {
    return Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] === L && L > 1);
  }
  function weaponUnlocksAtLevel(w, l) {
    const out = [];
    for (const k of Object.keys(ATTACH_UNLOCKS)) if (ATTACH_UNLOCKS[k] === l) out.push("attach:" + w + ":" + k);
    for (const k of Object.keys(WEAPON_CAMO_UNLOCKS)) if (WEAPON_CAMO_UNLOCKS[k] === l) out.push("camo:" + w + ":" + k);
    return out;
  }

  // ---- the per-match ledger -------------------------------------------------
  let cur = null;      // live session
  let lastReport = null;

  function beginSession(kind, info) {
    cur = {
      kind,                               // "match" | "campaign"
      mode: (info && info.mode) || null,
      map: (info && info.map) || null,
      startXp: rec.xp,
      startLevel: level(),
      startWeapons: {},
      cats: {},                           // cat -> {xp, n}
      weapons: {},                        // id -> {kills, heads, xp}
      unlocks: [],
      levelUps: [],
      hl: { kills: 0, heads: 0, assists: 0, bestStreak: 0, streak: 0, medals: [], longshots: 0, caps: 0, calls: 0 },
      assistsSeen: 0,
      ended: false,
    };
    for (const w of Object.keys(rec.weapons)) cur.startWeapons[w] = rec.weapons[w].xp;
    // assists are read off the live roster: start from whatever it already holds
    const ha = humanActor();
    cur.assistsSeen = ha ? (ha.assists | 0) : 0;
  }
  function ensureSession() {
    if (!cur || cur.ended) beginSession(ctx.sim && ctx.sim() && ctx.sim().match ? "match" : "campaign", null);
    return cur;
  }

  // award(category, amount, label) — the single XP entry point
  function award(cat, amount, label) {
    amount = Math.max(0, Math.floor(amount || 0));
    if (!amount) return 0;
    const s = ensureSession();
    const before = level();
    rec.xp = Math.min(MAX_XP, rec.xp + amount);
    const c = s.cats[cat] || (s.cats[cat] = { xp: 0, n: 0 });
    c.xp += amount; c.n++;
    notify({ type: "xp", cat, amount, label: label || CATEGORY_LABELS[cat] || cat });
    const after = level();
    for (let L = before + 1; L <= after; L++) {
      const ul = unlocksAtLevel(L);
      s.levelUps.push(L);
      for (const k of ul) if (s.unlocks.indexOf(k) < 0) s.unlocks.push(k);
      for (const k of ul) if (rec.seen.indexOf(k) < 0) rec.seen.push(k);
      notify({ type: "levelup", level: L, rank: rankName(L), unlocks: ul });
    }
    return amount;
  }
  function awardWeapon(id, amount) {
    if (!id || !amount) return;
    const s = ensureSession();
    const w = rec.weapons[id] || (rec.weapons[id] = { xp: 0, kills: 0, heads: 0 });
    const before = weaponLevelForXp(w.xp);
    w.xp = Math.min(weaponLevelFloor(MAX_WEAPON_LEVEL), w.xp + amount);
    const sw = s.weapons[id] || (s.weapons[id] = { kills: 0, heads: 0, xp: 0 });
    sw.xp += amount;
    const after = weaponLevelForXp(w.xp);
    for (let l = before + 1; l <= after; l++) {
      const ul = weaponUnlocksAtLevel(id, l);
      for (const k of ul) if (s.unlocks.indexOf(k) < 0) s.unlocks.push(k);
      notify({ type: "weaponlevel", weapon: id, name: WEAPON_NAMES[id] || id, level: l, unlocks: ul });
    }
  }

  // ---- event handlers --------------------------------------------------------
  let lastShotW = null, lastShotT = -9;
  const sim = () => (ctx.sim ? ctx.sim() : null);
  const now = () => { const s = sim(); return s && s.state ? s.state.time : 0; };
  function isEnemy(victim) {
    const s = sim();
    try { if (s && s.match && s.match.sameTeam) return !s.match.sameTeam("P", victim); } catch (e) { /* campaign */ }
    return true;
  }
  function humanActor() {
    const s = sim();
    const m = s && s.state && s.state.match;
    if (!m || !Array.isArray(m.actors)) return null;
    return m.actors.find((a) => a.actorId === 0 || a.kind === "human") || null;
  }
  function syncAssists() {
    const a = humanActor();
    if (!a || !cur) return;
    const n = a.assists | 0;
    while (cur.assistsSeen < n) {
      cur.assistsSeen++;
      cur.hl.assists++;
      rec.life.assists++;
      award("assist", XP.assist, "Assist");
    }
  }
  let dirty = false;
  const touch = () => { dirty = true; };

  const handlers = {
    "match:start"(d) {
      beginSession("match", { mode: d && d.mode, map: d && d.map });
    },
    "mission:start"(d) {
      // a match also emits mission:start right after match:start — keep that session
      const id = d && d.missionId ? String(d.missionId) : "";
      if (id.indexOf("match:") === 0 && cur && cur.kind === "match" && !cur.ended) return;
      beginSession("campaign", { mode: "campaign", map: id || null });
    },
    shot(d) {
      if (d && d.shooter === "P" && !d.impactOnly && !d.pen && d.weaponId) { lastShotW = d.weaponId; lastShotT = now(); }
    },
    death(d) {
      if (!d) return;
      const s = ensureSession();
      if (s.ended) return;
      if (d.victim === "P") { s.hl.streak = 0; syncAssists(); touch(); return; }
      if (d.attacker !== "P" || d.victim == null) { syncAssists(); touch(); return; }
      if (!isEnemy(d.victim)) return;
      s.hl.kills++; rec.life.kills++;
      s.hl.streak++; if (s.hl.streak > s.hl.bestStreak) s.hl.bestStreak = s.hl.streak;
      if (s.hl.bestStreak > rec.life.bestStreak) rec.life.bestStreak = s.hl.bestStreak;
      award("kill", XP.kill, "Kill");
      if (d.headshot) { s.hl.heads++; rec.life.heads++; award("headshot", XP.headshot, "Headshot"); }
      // the weapon: the player's last fire-time shot within a second (call-in and
      // grenade kills without a recent shot earn no weapon XP)
      const w = lastShotW && now() - lastShotT <= 1.0 ? lastShotW : null;
      if (w) {
        const rw = rec.weapons[w] || (rec.weapons[w] = { xp: 0, kills: 0, heads: 0 });
        rw.kills++; if (d.headshot) rw.heads++;
        const sw = s.weapons[w] || (s.weapons[w] = { kills: 0, heads: 0, xp: 0 });
        sw.kills++; if (d.headshot) sw.heads++;
        awardWeapon(w, XP.weaponKill + (d.headshot ? XP.weaponHeadshot : 0));
      }
      syncAssists();
      touch();
    },
    medal(d) {
      if (!d || !d.text) return;
      const xp = medalXp(d.text);
      if (!xp) return;
      const s = ensureSession();
      const t = String(d.text).toUpperCase();
      s.hl.medals.push(t);
      if (t === "LONGSHOT") s.hl.longshots++;
      award("medal", xp, titleCase(t));
      touch();
    },
    streak(d) {
      if (!d) return;
      if (d.phase === "earned" && XP.streak[d.id]) {
        ensureSession().hl.calls++;
        award("streak", XP.streak[d.id], (d.name ? titleCase(d.name) : d.id) + " earned");
        touch();
      }
    },
    flag(d) {
      if (!d || d.byWho !== "P") return;
      if (d.state === "captured") { ensureSession().hl.caps++; rec.life.caps++; award("objective", XP.flagCapture, "Flag captured"); }
      else if (d.state === "returned") award("objective", XP.flagReturn, "Flag returned");
      else if (d.state === "taken") award("objective", XP.flagTaken, "Flag taken");
      else return;
      touch();
    },
    // [lane dom] STRONGHOLD zone events (byWho lists every operator credited)
    zonecap(d) {
      if (!d || !Array.isArray(d.byWho) || d.byWho.indexOf("P") < 0) return;
      if (d.state === "captured") { ensureSession().hl.caps++; rec.life.caps++; award("objective", XP.zoneCapture, "Zone " + d.label + " captured"); }
      else if (d.state === "neutralised") award("objective", XP.zoneNeutralise, "Zone " + d.label + " neutralised");
      else if (d.state === "defended") award("objective", XP.zoneDefend, "Zone " + d.label + " defended");
      else return;
      touch();
    },
    objective(d) {
      const s = sim();
      if (!d || d.state !== "done" || (s && s.match)) return; // campaign beats only
      award("objective", XP.objective, "Objective" + (d.label ? ": " + d.label : ""));
      touch();
    },
    "mission:end"(d) {
      if (!d) return;
      const s = ensureSession();
      if (s.ended) return;
      syncAssists();
      const won = d.result === "won";
      let result;
      if (d.match) {
        const r = d.match.result;
        result = r === "draw" ? "draw" : r === "forfeit" ? "forfeit" : won ? "won" : "lost";
        if (r !== "forfeit") award("completion", XP.matchComplete, "Match complete");
        if (won) award("win", XP.matchWin, "Victory");
        else if (r === "draw") award("win", XP.matchDraw, "Draw");
        rec.life.matches++;
        if (won) rec.life.wins++;
        const you = (d.match.actors || []).find((a) => a.actorId === 0);
        if (you && you.bestStreak > s.hl.bestStreak) s.hl.bestStreak = you.bestStreak;
        s.score = you ? you.score : null;
      } else {
        result = won ? "won" : "lost";
        award("campaign", won ? XP.missionComplete : XP.missionFailed, won ? "Operation complete" : "Operation attempted");
        const sm = sim();
        const diff = (sm && sm.mission && sm.mission.difficulty) || (ctx.content && ctx.content.difficultySelected) || null;
        if (won && diff === "hard") award("campaign", XP.missionHard, "Hard clear");
        rec.life.missions++;
      }
      s.ended = true;
      lastReport = buildReport(s, result);
      save();
      dirty = false;
      notify({ type: "report", report: lastReport });
      notifyChange();
    },
  };

  function titleCase(t) {
    return String(t).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }

  function buildReport(s, result) {
    const cats = Object.keys(s.cats).map((k) => ({ cat: k, label: CATEGORY_LABELS[k] || k, xp: s.cats[k].xp, n: s.cats[k].n }));
    const order = ["kill", "headshot", "assist", "objective", "medal", "streak", "campaign", "completion", "win"];
    cats.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
    const weapons = Object.keys(s.weapons).map((id) => {
      const fromXp = s.startWeapons[id] || 0;
      const toXp = (rec.weapons[id] || { xp: 0 }).xp;
      return {
        id, name: WEAPON_NAMES[id] || id, kills: s.weapons[id].kills, heads: s.weapons[id].heads,
        xp: toXp - fromXp, fromXp, toXp,
        fromLevel: weaponLevelForXp(fromXp), toLevel: weaponLevelForXp(toXp),
      };
    }).sort((a, b) => b.kills - a.kills);
    const total = rec.xp - s.startXp;
    return {
      kind: s.kind, mode: s.mode, map: s.map, result,
      total, fromXp: s.startXp, toXp: rec.xp,
      fromLevel: s.startLevel, toLevel: level(),
      cats, weapons, unlocks: s.unlocks.slice(), levelUps: s.levelUps.slice(),
      highlights: {
        kills: s.hl.kills, headshots: s.hl.heads, assists: s.hl.assists,
        bestStreak: s.hl.bestStreak, medals: s.hl.medals.slice(), longshots: s.hl.longshots,
        captures: s.hl.caps, callins: s.hl.calls, score: s.score == null ? null : s.score,
      },
      saved: !saveFailed && !readOnly,
    };
  }

  const api = {
    // ---- the stable API ----
    level,
    xp: () => rec.xp,
    weaponLevel,
    isUnlocked,
    unlockLevel,
    onChange(fn) { if (typeof fn === "function") changeFns.add(fn); return () => changeFns.delete(fn); },
    // ---- extras (view layer) ----
    rank: (L) => rankName(L == null ? level() : L),
    levelProgress() {
      const L = level();
      if (L >= MAX_LEVEL) return { level: L, into: 0, need: 0, frac: 1 };
      const into = rec.xp - levelFloor(L), need = xpToNext(L);
      return { level: L, into, need, frac: into / need };
    },
    weaponXp: (id) => wrec(id).xp,
    weaponProgress(id) {
      const x = wrec(id).xp, l = weaponLevelForXp(x);
      if (l >= MAX_WEAPON_LEVEL) return { level: l, into: 0, need: 0, frac: 1 };
      const into = x - weaponLevelFloor(l), need = weaponXpToNext(l);
      return { level: l, into, need, frac: into / need };
    },
    unlockInfo,
    unlockName(key) {
      const info = unlockInfo(key);
      const p = String(key).split(":");
      if (info && info.by === "weapon") return (WEAPON_NAMES[p[1]] || p[1]) + " — " + (UNLOCK_NAMES[p[2]] || p[2]);
      return UNLOCK_NAMES[key] || key;
    },
    nextUnlock() {
      const L = level();
      let best = null;
      for (const k of Object.keys(UNLOCKS)) if (UNLOCKS[k] > L && (!best || UNLOCKS[k] < UNLOCKS[best])) best = k;
      return best ? { key: best, level: UNLOCKS[best] } : null;
    },
    onEvent(fn) { if (typeof fn === "function") eventFns.add(fn); return () => eventFns.delete(fn); },
    get lastReport() { return lastReport; },
    get lifetime() { return JSON.parse(JSON.stringify(rec.life)); },
    get status() { return { load: loadStatus, readOnly, saveFailed }; },
    award(cat, amount, label) { const n = award(cat, amount, label); save(); notifyChange(); return n; },
    attach(bridge) {
      for (const k of Object.keys(handlers)) {
        bridge.register(k, (d) => {
          try { handlers[k](d); } catch (e) { /* never break the frame */ }
        });
      }
      // persist mid-match progress once per dispatch batch (cheap: one small JSON)
      bridge.register("death", () => { if (dirty) { dirty = false; save(); notifyChange(); } });
      bridge.register("medal", () => { if (dirty) { dirty = false; save(); notifyChange(); } });
      bridge.register("streak", () => { if (dirty) { dirty = false; save(); notifyChange(); } });
      bridge.register("flag", () => { if (dirty) { dirty = false; save(); notifyChange(); } });
      bridge.register("objective", () => { if (dirty) { dirty = false; save(); notifyChange(); } });
    },
    save,
    // test seams
    get state() { return JSON.parse(JSON.stringify(rec)); },
    _reset() { rec = blankRecord(); cur = null; lastReport = null; save(); notifyChange(); },
    _reload() { load(); notifyChange(); },
  };
  return api;
}
