// Colosseum — inventory, economy and the ludus save.
//
// The gold loop is the spine of the single-player game: win a bout -> earn a
// purse -> buy steel you can SEE on your body -> survive a harder bout. So this
// module owns three things and keeps them consistent:
//
//   * what you own and what you are wearing (with the mobility cost of it)
//   * gold, purses and prices
//   * the versioned save, because losing a career to a schema change is the
//     worst bug this game could ship
//
// Pure data — no THREE, no DOM. The armoury UI renders it; the equipment layer
// makes it visible; the combat sim consumes the derived loadout.

import { WEAPONS, SHIELDS, ARMOUR, ARMATURAE, mobility, loadoutWeight } from "../data/weapons.js";

export const SAVE_KEY = "colosseum_save_v1";
export const SAVE_VERSION = 1;

/** Equipment slots the armoury exposes, in display order. */
export const SLOT_ORDER = ["weapon", "shield", "helmet", "arm", "legs", "torso"];

/** Which armour ids may occupy which slot — one piece per slot. */
export const SLOT_ARMOUR = {
  helmet: ["galea"],
  arm: ["manica"],
  legs: ["ocreae"],
  torso: ["lorica"],
};

/** Rank ladder. Historically grounded: the palus system plus tiro/veteranus. */
export const RANKS = [
  { id: "tiro", name: "Tiro", title: "The Untried", minWins: 0, purse: 60, desc: "Your first sand. Nobody knows your name yet." },
  { id: "gregarius", name: "Gregarius", title: "Of the Crowd", minWins: 3, purse: 110, desc: "One of the many. You have survived enough to be counted." },
  { id: "veteranus", name: "Veteranus", title: "The Proven", minWins: 8, purse: 190, desc: "You have lived through more bouts than most men see." },
  { id: "primus", name: "Primus Palus", title: "First Sword", minWins: 15, purse: 320, desc: "The first stake of the ludus. The crowd shouts for you now." },
  { id: "champion", name: "Champion", title: "Of the Flavian", minWins: 24, purse: 520, desc: "They paint your name on the walls of the city." },
  { id: "legend", name: "Legend", title: "Immortal", minWins: 36, purse: 800, desc: "Emperors have watched you fight. The rudis is within reach." },
];

/** Rank for a given win count. */
export function rankFor(wins) {
  let r = RANKS[0];
  for (const cand of RANKS) if (wins >= cand.minWins) r = cand;
  return r;
}

/** The AI skill band an opponent uses at a given rank index. */
export function skillForRank(rankId) {
  return { tiro: "tiro", gregarius: "gregarius", veteranus: "veteranus", primus: "primus", champion: "champion", legend: "legend" }[rankId] || "gregarius";
}

// ---------------------------------------------------------------------------

export class Inventory {
  constructor(save = null) {
    this.reset();
    if (save) this.load(save);
  }

  reset() {
    this.name = "Unnamed";
    this.gold = 150;
    this.wins = 0;
    this.losses = 0;
    this.kills = 0;
    this.matchesPlayed = 0;
    this.completed = {};          // matchId -> true
    // Everyone starts with the bare minimum: a gladius and a loincloth.
    this.owned = { weapon: ["gladius"], shield: ["none"], armour: [] };
    this.equipped = { weapon: "gladius", shield: "none", helmet: null, arm: null, legs: null, torso: null };
    this.settings = {};
    this.createdAt = null;        // stamped by the caller (no clock in here)
  }

  // -- derived ------------------------------------------------------------

  /** The armour id list the combat sim and the visual layer both consume. */
  armourList() {
    return ["helmet", "arm", "legs", "torso"]
      .map((s) => this.equipped[s])
      .filter(Boolean);
  }

  /** The loadout struct combat.Fighter expects. */
  loadout() {
    return {
      weapon: this.equipped.weapon || "gladius",
      shield: this.equipped.shield || "none",
      armour: this.armourList(),
    };
  }

  mobility() { return mobility(this.loadout()); }
  weight() { return loadoutWeight(this.loadout()); }
  rank() { return rankFor(this.wins); }

  /** Does this fighter's kit match a classical armatura? Flavour + titles. */
  matchedArmatura() {
    const lw = this.loadout();
    for (const id in ARMATURAE) {
      const a = ARMATURAE[id];
      if (a.weapon !== lw.weapon || a.shield !== lw.shield) continue;
      const want = [...a.armour].sort().join(",");
      const have = [...lw.armour].sort().join(",");
      if (want === have) return a;
    }
    return null;
  }

  // -- shop ---------------------------------------------------------------

  /** Everything purchasable, with owned/affordable/equipped state resolved. */
  catalogue() {
    const out = [];
    const push = (kind, slot, id, def) => {
      const owned = kind === "armour"
        ? this.owned.armour.includes(id)
        : this.owned[kind].includes(id);
      out.push({
        kind, slot, id,
        name: def.name, price: def.price ?? 0, tier: def.tier ?? 0,
        desc: def.desc || "", weight: def.weight ?? 0,
        owned, affordable: this.gold >= (def.price ?? 0),
        equipped: this.equipped[slot] === id,
        stats: this._statsFor(kind, id, def),
      });
    };
    for (const id in WEAPONS) push("weapon", "weapon", id, WEAPONS[id]);
    for (const id in SHIELDS) if (id !== "none") push("shield", "shield", id, SHIELDS[id]);
    for (const id in ARMOUR) {
      const slot = Object.keys(SLOT_ARMOUR).find((s) => SLOT_ARMOUR[s].includes(id));
      if (slot) push("armour", slot, id, ARMOUR[id]);
    }
    return out.sort((a, b) => a.tier - b.tier || a.price - b.price);
  }

  _statsFor(kind, id, def) {
    if (kind === "weapon") {
      return { Damage: def.damage, Reach: `${def.reach} m`, Speed: `${(1 / (def.windup + def.active + def.recover)).toFixed(2)}/s`, Weight: `${def.weight} kg` };
    }
    if (kind === "shield") {
      return { Block: `${Math.round(def.block * 100)}%`, Integrity: def.integrity, Covers: def.coverage.length, Weight: `${def.weight} kg` };
    }
    const protects = Object.entries(def.zones || {}).filter(([, v]) => v < 1)
      .map(([z, v]) => `${z} ${Math.round((1 - v) * 100)}%`).join(", ");
    return { Protects: protects || "—", Weight: `${def.weight} kg` };
  }

  /** Price of an item by kind+id. */
  priceOf(kind, id) {
    const table = kind === "weapon" ? WEAPONS : kind === "shield" ? SHIELDS : ARMOUR;
    return (table[id] && table[id].price) || 0;
  }

  /**
   * Buy an item. Returns {ok, reason, gold}.
   * Deliberately does NOT auto-equip — equipping is a separate, reversible
   * decision, and auto-equipping a heavy piece would silently slow the player
   * down right before a bout.
   */
  buy(kind, id) {
    const table = kind === "weapon" ? WEAPONS : kind === "shield" ? SHIELDS : ARMOUR;
    const def = table[id];
    if (!def) return { ok: false, reason: "no such item" };
    const list = kind === "armour" ? this.owned.armour : this.owned[kind];
    if (list.includes(id)) return { ok: false, reason: "already owned" };
    const price = def.price || 0;
    if (this.gold < price) return { ok: false, reason: "not enough gold", short: price - this.gold };
    this.gold -= price;
    list.push(id);
    return { ok: true, gold: this.gold, bought: id };
  }

  /** Equip an owned item into its slot. `null` clears the slot. */
  equip(slot, id) {
    if (!SLOT_ORDER.includes(slot)) return { ok: false, reason: "bad slot" };
    if (id === null) {
      if (slot === "weapon") return { ok: false, reason: "cannot fight bare-handed" };
      this.equipped[slot] = slot === "shield" ? "none" : null;
      return { ok: true, equipped: { ...this.equipped } };
    }
    const kind = slot === "weapon" ? "weapon" : slot === "shield" ? "shield" : "armour";
    const list = kind === "armour" ? this.owned.armour : this.owned[kind];
    if (!list.includes(id)) return { ok: false, reason: "not owned" };
    if (kind === "armour" && !(SLOT_ARMOUR[slot] || []).includes(id)) {
      return { ok: false, reason: `${id} does not go in ${slot}` };
    }
    this.equipped[slot] = id;
    return { ok: true, equipped: { ...this.equipped } };
  }

  /**
   * What equipping `id` would do to mobility — the numbers the UI shows on
   * hover so the protection/speed trade is legible BEFORE you commit.
   */
  previewEquip(slot, id) {
    const before = this.mobility();
    const saved = this.equipped[slot];
    this.equipped[slot] = id;
    const after = this.mobility();
    this.equipped[slot] = saved;
    const delta = {};
    for (const k of ["weight", "moveSpeed", "staminaMax", "staminaRegen", "dodgeDistance", "turnRate"]) {
      delta[k] = +(after[k] - before[k]).toFixed(2);
    }
    return { before, after, delta };
  }

  // -- rewards ------------------------------------------------------------

  /**
   * Settle a finished match.
   * @param {object} r { won, kills, flawless, crowdFavour 0..1, matchId, bonus }
   */
  settle({ won = false, kills = 0, flawless = false, crowdFavour = 0.5, matchId = null, bonus = 0 } = {}) {
    const rank = this.rank();
    let purse = won ? rank.purse : Math.round(rank.purse * 0.25);
    purse += kills * Math.round(rank.purse * 0.18);
    // The mob paid for spectacle, not efficiency — favour is real money.
    purse = Math.round(purse * (0.7 + crowdFavour * 0.6));
    if (flawless && won) purse = Math.round(purse * 1.35);
    purse += bonus;

    this.gold += purse;
    this.kills += kills;
    this.matchesPlayed++;
    if (won) this.wins++; else this.losses++;
    if (won && matchId) this.completed[matchId] = true;

    const newRank = this.rank();
    return {
      purse, gold: this.gold, won,
      rankUp: newRank.id !== rank.id ? newRank : null,
      rank: newRank,
    };
  }

  // -- persistence --------------------------------------------------------

  toJSON() {
    return {
      v: SAVE_VERSION,
      name: this.name, gold: this.gold,
      wins: this.wins, losses: this.losses, kills: this.kills,
      matchesPlayed: this.matchesPlayed, completed: this.completed,
      owned: this.owned, equipped: this.equipped,
      settings: this.settings, createdAt: this.createdAt,
    };
  }

  /**
   * Load a save, migrating older versions forward. Unknown item ids are
   * DROPPED rather than throwing — a rebalance that removes an item must not
   * brick an existing career.
   */
  load(data) {
    if (!data || typeof data !== "object") return { ok: false, reason: "empty" };
    const migrated = Inventory.migrate(data);

    this.name = migrated.name ?? "Unnamed";
    this.gold = Number.isFinite(migrated.gold) ? migrated.gold : 150;
    this.wins = migrated.wins | 0;
    this.losses = migrated.losses | 0;
    this.kills = migrated.kills | 0;
    this.matchesPlayed = migrated.matchesPlayed | 0;
    this.completed = migrated.completed || {};
    this.settings = migrated.settings || {};
    this.createdAt = migrated.createdAt || null;

    const validW = (migrated.owned?.weapon || ["gladius"]).filter((i) => WEAPONS[i]);
    const validS = (migrated.owned?.shield || ["none"]).filter((i) => SHIELDS[i]);
    const validA = (migrated.owned?.armour || []).filter((i) => ARMOUR[i]);
    this.owned = {
      weapon: validW.length ? validW : ["gladius"],
      shield: validS.length ? validS : ["none"],
      armour: validA,
    };

    const eq = migrated.equipped || {};
    this.equipped = {
      weapon: this.owned.weapon.includes(eq.weapon) ? eq.weapon : this.owned.weapon[0],
      shield: this.owned.shield.includes(eq.shield) ? eq.shield : "none",
      helmet: this.owned.armour.includes(eq.helmet) ? eq.helmet : null,
      arm: this.owned.armour.includes(eq.arm) ? eq.arm : null,
      legs: this.owned.armour.includes(eq.legs) ? eq.legs : null,
      torso: this.owned.armour.includes(eq.torso) ? eq.torso : null,
    };
    return { ok: true, version: migrated.v };
  }

  /** Forward-migrate a save blob. Add a case per schema bump; never mutate input. */
  static migrate(data) {
    const d = JSON.parse(JSON.stringify(data));
    let v = d.v || 0;
    // v0 -> v1: the pre-versioned prototype stored a flat `armour` array.
    if (v < 1) {
      if (Array.isArray(d.armour)) { d.owned = d.owned || {}; d.owned.armour = d.armour; delete d.armour; }
      v = 1;
    }
    d.v = v;
    return d;
  }

  /** Persist to localStorage. Returns false rather than throwing in private mode. */
  save(storage) {
    try {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!s) return false;
      s.setItem(SAVE_KEY, JSON.stringify(this.toJSON()));
      return true;
    } catch (e) { return false; }
  }

  static restore(storage) {
    try {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!s) return new Inventory();
      const raw = s.getItem(SAVE_KEY);
      return raw ? new Inventory(JSON.parse(raw)) : new Inventory();
    } catch (e) { return new Inventory(); }
  }
}
