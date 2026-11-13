// core/sim/classes.js — PVP LOADOUT CLASSES + PERKS (data, validation, kits),
// THREE-free, DOM-free, deterministic. Shared by the sim (spawn kits, perk
// effects), the saved-class store (core/meta/loadouts.js) and the class UI
// (core/hud/loadout_ui.js), so the rules a class is validated against are the
// rules the sim enforces.
//
// A CLASS (what the player saves/edits):
//   { name, primary, secondary, lethal, tactical, perks:[tier1, tier2, tier3] }
// A KIT (what a body spawns with — a class resolved against the weapons table
// and the unlock gate):
//   { classId, name, primary, secondary, lethal, lethalCount, tactical, tacticalCount, perks:[...] }
// A body that spawned from a kit carries `body.kit` and `body.perks` ({id:true}
// map — JSON-safe for snapshots). Bodies without `perks` (campaign, pistol-start
// playlist, every pre-existing selftest) get no perk effect anywhere: every perk
// read is `hasPerk(body, id)`, which is false for them.
//
// OPPONENT CLASSES: every other operator in a class match spawns with a class
// too, chosen deterministically from (match seed, actorId, archetype) by an
// integer hash — no shared rng stream is consumed, so turning classes on never
// shifts any other draw in the match.

// ------------------------------------------------------------------ weapons
// Fixed choice lists. Ids only — display names come from weapon_data.js in the
// UI; the sim validates each id against its own weapons table at spawn.
export const PRIMARIES = ["warden", "vesper", "breaker", "corvus"];
export const SECONDARIES = ["pike"];

// ---------------------------------------------------------------- equipment
// LETHAL slot (frag | tripmine) and TACTICAL slot (flashbang | smoke |
// concussion). Effects + numbers: core/sim/equipment.js (EQUIP). A body carries
// its lethal count in `body.grenades` (the frozen frag field — a tripmine kit
// counts mines there) and its tactical count in `body.tactical`.
export const LETHALS = {
  frag: { id: "frag", name: "FRAG", count: 1, desc: "Cookable fragmentation grenade." },
  claymore: { id: "claymore", name: "TRIPMINE", count: 1,
    desc: "Directional mine, planted facing your aim. Fires on the first hostile through its cone. Two live at most; shoot one to clear it." },
};
export const TACTICALS = {
  flash: { id: "flash", name: "FLASHBANG", count: 2, desc: "Blinds and deafens anyone facing the burst for up to four seconds. Your squad gets a fraction." },
  smoke: { id: "smoke", name: "SMOKE", count: 2, desc: "Fifteen seconds of thick cover. Nothing sees or locks on through it." },
  stun:  { id: "stun",  name: "CONCUSSION", count: 2, desc: "Slows movement and aim and kills a sprint for a few seconds." },
};
// kept for older importers: nothing is "coming" any more
export const EQUIPMENT_COMING = [];
export const EQUIPMENT_NAMES = {
  frag: "FRAG", flash: "FLASHBANG", smoke: "SMOKE", stun: "CONCUSSION", claymore: "TRIPMINE",
};

// -------------------------------------------------------------------- perks
// Eight perks, three tiers, one pick per tier. Numbers live HERE (PERK_FX) and
// nowhere else — the sim modules read them through this table.
export const PERKS = {
  scavenger:   { id: "scavenger",   tier: 1, name: "SALVAGER",
    desc: "Strip a mag of ammo for every gun you carry, and restock your lethal, from each operator you drop." },
  flak:        { id: "flak",        tier: 1, name: "BLAST WEAVE",
    desc: "Take 40% less damage from grenades and call-in strikes." },
  doubleTime:  { id: "doubleTime",  tier: 1, name: "LONG STRIDE",
    desc: "Tactical sprint lasts twice as long. Crouch-walk 25% faster." },
  ghost:       { id: "ghost",       tier: 2, name: "COLD SIGNAL",
    desc: "Invisible to Signal Sweep recon drones." },
  hardline:    { id: "hardline",    tier: 2, name: "PRIORITY LINE",
    desc: "Every call-in needs one fewer kill (2 / 4 / 6 / 9)." },
  fastHands:   { id: "fastHands",   tier: 2, name: "DEFT HANDS",
    desc: "Reload and swap weapons 25% faster." },
  deadsilence: { id: "deadsilence", tier: 3, name: "SOFT STEP",
    desc: "Footsteps carry about a third as far. Hard to hear coming." },
  quickfix:    { id: "quickfix",    tier: 3, name: "STIM LACE",
    desc: "Health starts regenerating in half the time." },
};
export const PERK_IDS = Object.keys(PERKS);
export const PERKS_BY_TIER = [1, 2, 3].map((t) => PERK_IDS.filter((id) => PERKS[id].tier === t));

export const PERK_FX = {
  scavenger:   { mags: 1, lethal: 1 },            // per enemy kill: +1 mag every owned gun (cap reserve+mag), +1 lethal (cap kit count)
  flak:        { explosiveMult: 0.6 },            // grenade + call-in damage taken
  doubleTime:  { tacMult: 2.0, crouchMult: 1.25 },// tac-sprint 4 s -> 8 s; crouch-walk 2.4 -> 3.0 m/s
  ghost:       {},                                // skipped by the Signal Sweep contact list
  hardline:    { streakDiscount: 1 },             // 3/5/7/10 -> 2/4/6/9
  fastHands:   { timeMult: 0.75 },                // reload + swap take 75% of the time
  deadsilence: { hearMult: 0.35 },                // footstep hearing radius (14/7/2.5 m -> 4.9/2.45/0.88 m)
  quickfix:    { regenDelayMult: 0.5, botRetreatRegenMult: 1.5 },
};

export function hasPerk(body, id) {
  return !!(body && body.perks && body.perks[id]);
}

// ------------------------------------------------------------------ classes
export const CLASS_COUNT = 5;
export const NAME_MAX = 14;

export const DEFAULT_CLASSES = [
  { name: "ASSAULT",  primary: "warden",  secondary: "pike", lethal: "frag", tactical: "flash", perks: ["scavenger", "fastHands", "quickfix"] },
  { name: "RUNNER",   primary: "vesper",  secondary: "pike", lethal: "frag", tactical: "stun",  perks: ["doubleTime", "hardline", "deadsilence"] },
  { name: "MARKSMAN", primary: "corvus",  secondary: "pike", lethal: "frag", tactical: "smoke", perks: ["flak", "ghost", "quickfix"] },
  { name: "BREACHER", primary: "breaker", secondary: "pike", lethal: "frag", tactical: "flash", perks: ["doubleTime", "fastHands", "deadsilence"] },
  { name: "RECON",    primary: "warden",  secondary: "pike", lethal: "frag", tactical: "smoke", perks: ["scavenger", "ghost", "deadsilence"] },
];

export function cleanName(s, fallback) {
  const n = String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9 \-]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return n || fallback;
}

// Repair a stored class in place of trusting it: every field that is not a
// legal choice falls back to that slot's default. Returns a NEW object and a
// `fixed` count so the store can tell whether the record was dirty.
export function validateClass(c, index) {
  const def = DEFAULT_CLASSES[((index | 0) % CLASS_COUNT + CLASS_COUNT) % CLASS_COUNT];
  const src = c && typeof c === "object" ? c : {};
  let fixed = src === c ? 0 : 1;
  const name = cleanName(src.name, def.name);
  if (name !== src.name) fixed++;
  const primary = PRIMARIES.indexOf(src.primary) >= 0 ? src.primary : (fixed++, def.primary);
  const secondary = SECONDARIES.indexOf(src.secondary) >= 0 ? src.secondary : (fixed++, def.secondary);
  // null = an EMPTY lethal / perk slot — legal (a slot whose every option is
  // still locked resolves to null, and must not be "repaired" into a default
  // the player has not unlocked). Anything else unknown is repaired.
  const lethal = src.lethal === null ? null : LETHALS[src.lethal] ? src.lethal : (fixed++, def.lethal);
  // tactical slot (added after v1 records were saved: a record without one is
  // repaired to the slot default, exactly like any other missing field)
  const tactical = src.tactical === null ? null : TACTICALS[src.tactical] ? src.tactical : (fixed++, def.tactical);
  const inPerks = Array.isArray(src.perks) ? src.perks : [];
  const perks = [0, 1, 2].map((ti) => {
    const id = inPerks[ti];
    if (id === null && Array.isArray(src.perks) && src.perks.length === 3) return null;
    if (PERKS[id] && PERKS[id].tier === ti + 1) return id;
    fixed++;
    return def.perks[ti];
  });
  return { cls: { name, primary, secondary, lethal, tactical, perks }, fixed };
}

// Resolve a class into the kit a body spawns with. `isUnlocked(key)` is the
// progression gate ("weapon:<id>" / "perk:<id>" / "equip:<id>"); absent = all
// unlocked. A locked choice falls back to the first unlocked option in its
// list (a locked perk to the first unlocked perk of its tier, else none) so a
// class saved before an unlock rule changed can never smuggle it into a match.
export function resolveKit(cls, opts) {
  const o = opts || {};
  const ok = typeof o.isUnlocked === "function" ? (k) => { try { return !!o.isUnlocked(k); } catch (e) { return true; } } : () => true;
  const weapons = o.weapons || null;
  const have = (id) => !weapons || !!weapons[id];
  const v = validateClass(cls, o.index | 0).cls;
  const pickW = (id, list) => {
    if (ok("weapon:" + id) && have(id)) return id;
    for (const x of list) if (ok("weapon:" + x) && have(x)) return x;
    return null;
  };
  const primary = pickW(v.primary, PRIMARIES);
  const secondary = pickW(v.secondary, SECONDARIES);
  const lethal = v.lethal && ok("equip:" + v.lethal) ? v.lethal : null;
  const tactical = v.tactical && ok("equip:" + v.tactical) ? v.tactical : null;
  // three positions, one per tier; null = that tier is empty
  const perks = v.perks.map((id, ti) => {
    if (id && ok("perk:" + id)) return id;
    if (!id) return null;
    for (const x of PERKS_BY_TIER[ti]) if (ok("perk:" + x)) return x;
    return null;
  });
  return {
    classId: o.classId != null ? o.classId : null,
    name: v.name,
    primary, secondary, lethal,
    lethalCount: lethal ? LETHALS[lethal].count : 0,
    tactical,
    tacticalCount: tactical ? TACTICALS[tactical].count : 0,
    perks,
  };
}

export function perkMap(kit) {
  const m = {};
  for (const id of (kit && kit.perks) || []) if (PERKS[id]) m[id] = true;
  return m;
}

// ------------------------------------------------------- opponent classes
// 32-bit integer mix (splitmix-style) — pure function of its inputs.
export function hash32(a, b, c) {
  let h = (a | 0) ^ Math.imul((b | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((c | 0) + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

// The roles the roster hands out map onto believable class shapes — a pointman
// runs close-range guns, a marksman the DMR. Names are the class names a squad
// would actually save.
const ROLE_POOLS = {
  cqb:      [{ name: "BREACHER", primary: "breaker" }, { name: "RUNNER", primary: "vesper" }, { name: "CLOSE QUARTERS", primary: "vesper" }],
  rifleman: [{ name: "ASSAULT", primary: "warden" }, { name: "RECON", primary: "warden" }, { name: "SKIRMISHER", primary: "vesper" }, { name: "LINE", primary: "warden" }],
  marksman: [{ name: "MARKSMAN", primary: "corvus" }, { name: "OVERWATCH", primary: "corvus" }],
};

export function roleOf(archetype) {
  const base = String(archetype || "rifleman").replace(/_[ab]$/, "");
  return ROLE_POOLS[base] ? base : "rifleman";
}

// Equipment by role: entry men carry flashes and concussions, riflemen any
// tactical, marksmen smoke and concussions; a share of riflemen and most
// marksmen hold a flank with a tripmine instead of a frag.
const ROLE_TACTICAL = { cqb: ["flash", "stun", "flash"], rifleman: ["flash", "smoke", "stun"], marksman: ["smoke", "stun"] };
const ROLE_MINE_PCT = { cqb: 0, rifleman: 25, marksman: 55 };

// Deterministic class for operator `actorId` in a match seeded `seed`.
export function opponentClass(seed, actorId, archetype) {
  const role = roleOf(archetype);
  const pool = ROLE_POOLS[role];
  const h0 = hash32(seed, actorId, 1);
  const shape = pool[h0 % pool.length];
  const perks = PERKS_BY_TIER.map((ids, ti) => ids[hash32(seed, actorId, 11 + ti) % ids.length]);
  const tacs = ROLE_TACTICAL[role];
  const tactical = tacs[hash32(seed, actorId, 22) % tacs.length];
  const lethal = (hash32(seed, actorId, 21) % 100) < ROLE_MINE_PCT[role] ? "claymore" : "frag";
  return { name: shape.name, primary: shape.primary, secondary: "pike", lethal, tactical, perks };
}

// Integer index of a fixed STREAK threshold after perks.
export function streakAt(at, body) {
  return hasPerk(body, "hardline") ? Math.max(1, at - PERK_FX.hardline.streakDiscount) : at;
}
