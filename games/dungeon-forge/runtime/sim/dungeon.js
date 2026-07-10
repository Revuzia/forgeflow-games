/**
 * Dungeon Forge — runtime/sim/dungeon.js
 * The headless dungeon MODEL: grid cells per floor, placeable objects, edit
 * ops (the exact packets multiplayer relays), validation + key/lock
 * solvability, loot tables, and the share codec. No three.js, no DOM — this
 * file runs in node for the selftest and is the single source of truth both
 * the builder and escape mode read.
 *
 * Grid: each floor is a sparse set of 4×4-unit cells addressed "x,z"
 * (0..SIZE-1). Walls are DERIVED: any floor-cell edge whose neighbor is not a
 * floor cell is a wall. Doors occupy a cell; rot 0/2 = passage along Z,
 * rot 1/3 = passage along X. Stairs climb from their cell toward rot to the
 * landing cell one floor up (the builder guarantees the landing exists).
 */

export const SIZE = 64;          // cells per side, per floor
export const MAX_FLOORS = 5;
export const CELL = 4;           // world units per cell
export const FLOOR_H = 5;        // vertical world units between floors

export const THEMES = ["fantasy", "scifi"];

// Cell types — every truthy cell is walkable floor; the type flavors it.
// 1 stone floor · 2 LAVA (burns players) · 3 WATER (slows) · 4 RAISED platform
export const CT = { FLOOR: 1, LAVA: 2, WATER: 3, RAISED: 4 };
export const RAISED_H = 1.1;           // world-units height of a legacy raised platform
export const LAVA_DPS = { dmg: 10 };   // per hit through the 0.45s i-frame gate
export const WATER_SLOW = 0.55;        // speed multiplier in water
export const HEIGHT_STEP = 0.55;       // world-units per raise/lower level (rolling terrain)
export const HEIGHT_MIN = -3, HEIGHT_MAX = 5;   // clamp on per-cell height levels

export function cellType(d, f, x, z) {
  const fl = d.floors[f];
  return fl ? (fl.cells[ck(x, z)] | 0) : 0;
}
/** Per-cell height LEVEL from raise/lower (integer; 0 = flat). */
export function cellLevel(d, f, x, z) {
  const fl = d.floors[f];
  return fl && fl.heights ? (fl.heights[ck(x, z)] | 0) : 0;
}
/** Walk-surface height of a cell: rolling height levels + legacy raised platforms. */
export function cellHeight(d, f, x, z) {
  let h = cellLevel(d, f, x, z) * HEIGHT_STEP;
  if (cellType(d, f, x, z) === CT.RAISED) h += RAISED_H;
  return h;
}

// Object kinds and their per-kind default props. `solid` objects block walking.
export const KINDS = {
  door:   { rotatable: true,  solid: true  }, // props: locked
  stairs: { rotatable: true,  solid: false },
  chest:  { rotatable: true,  solid: true  }, // props: opened(run-time)
  key:    { rotatable: false, solid: false },
  enemy:  { rotatable: true,  solid: false }, // props: etype
  trap:   { rotatable: false, solid: false }, // props: ttype (spikes|vent)
  torch:  { rotatable: true,  solid: false },
  light:  { rotatable: false, solid: false }, // props: color
  decor:  { rotatable: true,  solid: true  }, // props: dtype
  npc:    { rotatable: true,  solid: true  }, // props: stock (merchant) — buy with gold
  spawn:  { rotatable: true,  solid: false },
  exit:   { rotatable: false, solid: false },
};

// Merchant catalog — what an NPC vendor can sell (id → {label, price gold, icon}).
// The builder toggles which of these a given merchant offers (default: all).
export const SHOP = {
  potion: { label: "Health Potion", price: 25, icon: "🧪", desc: "+35 HP on use (Q)" },
  mana:   { label: "Energy Refill",  price: 18, icon: "🔷", desc: "Restore full mana" },
  weapon: { label: "Weapon Upgrade", price: 70, icon: "⚔", desc: "+1 weapon tier (more damage)" },
  armor:  { label: "Armor Upgrade",  price: 70, icon: "🛡", desc: "+1 armor tier (soak damage)" },
  charm:  { label: "Damage Charm",   price: 90, icon: "✨", desc: "+20% damage, whole run" },
};
export const SHOP_IDS = Object.keys(SHOP);

/**
 * NPC roles a dungeon builder can drop in. Each has a distinct interaction:
 *  - merchant: a general store (editable stock of consumables/upgrades)
 *  - blacksmith: weapons & armor only, 15% cheaper
 *  - sage: a one-time blessing (grants +25 max HP and a full heal per run)
 */
export const NPC_TYPES = {
  merchant:   { label: "Merchant",   icon: "🪙", tint: 0xffd769, sells: ["potion", "mana", "charm"] },
  blacksmith: { label: "Blacksmith", icon: "⚒",  tint: 0xff8a3c, sells: ["weapon", "armor"], discount: 0.85 },
  sage:       { label: "Sage",       icon: "📜", tint: 0x8f6bff, blessing: { maxHp: 25 } },
};
export const NPC_TYPE_IDS = Object.keys(NPC_TYPES);

// Enemy roster per theme: [id, hp, dmg, speed, aggroR, attackR, attackCd, xp]
export const ENEMIES = {
  fantasy: {
    spider:   { hp: 45,  dmg: 10, speed: 3.3, aggro: 8,  atkR: 1.5, cd: 1.1, gold: 6,  label: "Giant Spider" },
    skeleton: { hp: 60,  dmg: 13, speed: 2.7, aggro: 9,  atkR: 1.6, cd: 1.2, gold: 10, label: "Skeleton" },
    zombie:   { hp: 85,  dmg: 16, speed: 1.9, aggro: 8,  atkR: 1.6, cd: 1.5, gold: 12, label: "Zombie" },
    ghost:    { hp: 50,  dmg: 12, speed: 2.9, aggro: 10, atkR: 1.5, cd: 1.2, gold: 14, label: "Ghost" },
    slime:    { hp: 95,  dmg: 9,  speed: 1.7, aggro: 7,  atkR: 1.4, cd: 1.3, gold: 8,  label: "Slime" },
    orc:      { hp: 150, dmg: 22, speed: 2.3, aggro: 10, atkR: 1.8, cd: 1.4, gold: 30, label: "Orc Brute" },
    imp:      { hp: 55,  dmg: 14, speed: 3.4, aggro: 11, atkR: 1.5, cd: 1.0, gold: 14, label: "Imp" },
    myconid:  { hp: 110, dmg: 12, speed: 1.6, aggro: 7,  atkR: 1.5, cd: 1.4, gold: 16, label: "Myconid" },
    cultist:  { hp: 65,  dmg: 15, speed: 2.8, aggro: 10, atkR: 1.6, cd: 1.2, gold: 16, label: "Dark Cultist" },
    cyclops:  { hp: 175, dmg: 25, speed: 2.1, aggro: 10, atkR: 1.9, cd: 1.5, gold: 34, label: "Cyclops" },
    ogre:     { hp: 190, dmg: 27, speed: 2.0, aggro: 10, atkR: 2.0, cd: 1.5, gold: 40, label: "Ogre" },
    bat:      { hp: 30,  dmg: 8,  speed: 3.6, aggro: 9,  atkR: 1.4, cd: 0.9, gold: 6,  label: "Cave Bat", fly: true },
    skull:    { hp: 45,  dmg: 12, speed: 3.0, aggro: 10, atkR: 1.5, cd: 1.1, gold: 10, label: "Floating Skull" },
    wisp:     { hp: 40,  dmg: 10, speed: 3.2, aggro: 10, atkR: 1.4, cd: 1.0, gold: 10, label: "Wisp", fly: true },
    frog:     { hp: 70,  dmg: 13, speed: 2.6, aggro: 8,  atkR: 1.5, cd: 1.2, gold: 12, label: "Cave Toad" },
    cactoro:  { hp: 100, dmg: 12, speed: 1.7, aggro: 7,  atkR: 1.5, cd: 1.4, gold: 14, label: "Cactoro" },
    gargoyle: { hp: 90,  dmg: 16, speed: 2.9, aggro: 10, atkR: 1.6, cd: 1.2, gold: 18, label: "Gargoyle", fly: true },
    ninja:    { hp: 75,  dmg: 18, speed: 3.4, aggro: 11, atkR: 1.6, cd: 0.9, gold: 20, label: "Shadow Ninja" },
    cthulhu:  { hp: 120, dmg: 20, speed: 2.2, aggro: 11, atkR: 1.7, cd: 1.3, gold: 24, label: "Spawn of Cthulhu" },
    brute:    { hp: 150, dmg: 24, speed: 2.3, aggro: 10, atkR: 1.8, cd: 1.4, gold: 30, label: "Tribal Brute" },
    yeti:     { hp: 180, dmg: 26, speed: 2.0, aggro: 10, atkR: 1.9, cd: 1.5, gold: 36, label: "Yeti" },
    giant:    { hp: 240, dmg: 30, speed: 1.9, aggro: 10, atkR: 2.1, cd: 1.6, gold: 48, label: "Giant" },
    dragon:   { hp: 260, dmg: 30, speed: 2.6, aggro: 12, atkR: 2.0, cd: 1.5, gold: 70, label: "Young Dragon", fly: true, boss: true },
    demon:    { hp: 280, dmg: 30, speed: 2.1, aggro: 12, atkR: 2.0, cd: 1.6, gold: 80, label: "Demon Lord", boss: true },
  },
  scifi: {
    drone:    { hp: 35,  dmg: 9,  speed: 3.5, aggro: 9,  atkR: 1.5, cd: 1.0, gold: 6,  label: "Scout Drone", fly: true },
    robot:    { hp: 65,  dmg: 13, speed: 2.6, aggro: 9,  atkR: 1.7, cd: 1.2, gold: 10, label: "Security Bot" },
    android:  { hp: 90,  dmg: 16, speed: 2.0, aggro: 8,  atkR: 1.6, cd: 1.4, gold: 14, label: "Android" },
    turret:   { hp: 70,  dmg: 11, speed: 0,   aggro: 11, atkR: 10,  cd: 1.6, gold: 12, label: "Plasma Turret", ranged: true, static: true },
    mech:     { hp: 160, dmg: 24, speed: 2.2, aggro: 10, atkR: 2.0, cd: 1.4, gold: 32, label: "War Mech" },
    blob:     { hp: 100, dmg: 13, speed: 1.7, aggro: 8,  atkR: 1.5, cd: 1.3, gold: 12, label: "Ooze Alien" },
    cyborg:   { hp: 95,  dmg: 18, speed: 2.7, aggro: 10, atkR: 1.7, cd: 1.2, gold: 18, label: "Combat Cyborg" },
    warbot:   { hp: 150, dmg: 22, speed: 2.0, aggro: 10, atkR: 2.0, cd: 1.4, gold: 30, label: "War Bot" },
    xeno:     { hp: 175, dmg: 26, speed: 2.4, aggro: 11, atkR: 1.9, cd: 1.4, gold: 35, label: "Xeno Brute" },
    sentinel: { hp: 200, dmg: 26, speed: 1.9, aggro: 10, atkR: 2.0, cd: 1.5, gold: 42, label: "Sentinel Mech" },
    xenosmall:{ hp: 45,  dmg: 11, speed: 3.5, aggro: 11, atkR: 1.4, cd: 1.0, gold: 10, label: "Xeno Drone", fly: true },
    floater:  { hp: 60,  dmg: 13, speed: 3.0, aggro: 10, atkR: 1.5, cd: 1.1, gold: 12, label: "Void Floater", fly: true },
    striker:  { hp: 140, dmg: 22, speed: 2.5, aggro: 10, atkR: 1.8, cd: 1.2, gold: 28, label: "Strike Mech" },
    warframe: { hp: 160, dmg: 24, speed: 2.2, aggro: 10, atkR: 2.0, cd: 1.4, gold: 32, label: "Warframe" },
    xenobig:  { hp: 190, dmg: 27, speed: 2.2, aggro: 11, atkR: 1.9, cd: 1.4, gold: 38, label: "Xeno Brute" },
    alien:    { hp: 300, dmg: 32, speed: 2.2, aggro: 12, atkR: 2.0, cd: 1.6, gold: 85, label: "Hive Alien", boss: true },
  },
};

// Decor sets per theme (dtype → asset name; render layer decides the file)
export const DECOR = {
  fantasy: ["barrel", "crate", "bookshelf", "pillar", "coffin", "debris", "candles", "lantern"],
  scifi:   ["crate", "terminal", "barrier", "cables"],
};

export const TRAPS = ["spikes", "vent"];

// ─────────────────────────────────────────────────────────────────────────────
// model
// ─────────────────────────────────────────────────────────────────────────────

export function newDungeon(opts = {}) {
  return {
    v: 1,
    name: opts.name || "Untitled Dungeon",
    theme: THEMES.includes(opts.theme) ? opts.theme : "fantasy",
    difficulty: opts.difficulty || 1,      // 1 easy · 2 normal · 3 deadly
    author: opts.author || "anonymous",
    seed: opts.seed != null ? opts.seed : ((Math.random() * 0xffffffff) >>> 0),
    nid: 1,                                 // next object id
    floors: [emptyFloor()],
  };
}

export function emptyFloor() {
  return { cells: {}, heights: {}, objects: [] };  // cells: {"x,z":1}, heights: {"x,z":level}, objects: […]
}

export const ck = (x, z) => x + "," + z;
export const inBounds = (x, z) => x >= 0 && z >= 0 && x < SIZE && z < SIZE;

export function hasCell(d, f, x, z) {
  const fl = d.floors[f];
  return !!(fl && fl.cells[ck(x, z)]);
}

export function objsAt(d, f, x, z) {
  const fl = d.floors[f];
  if (!fl) return [];
  return fl.objects.filter((o) => o.x === x && o.z === z);
}

export function objById(d, id) {
  for (let f = 0; f < d.floors.length; f++) {
    const o = d.floors[f].objects.find((o) => o.id === id);
    if (o) return { obj: o, f };
  }
  return null;
}

export function findAll(d, kind) {
  const out = [];
  d.floors.forEach((fl, f) => fl.objects.forEach((o) => { if (o.kind === kind) out.push({ obj: o, f }); }));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// edit ops — the ONLY way state changes (local UI and the net relay both apply
// these), so single-player, co-build and the selftest share one code path.
// Every op returns {ok, ...} and mutates in place when ok.
// ─────────────────────────────────────────────────────────────────────────────

export function applyOp(d, op) {
  switch (op.t) {
    case "cell+": {
      if (!inBounds(op.x, op.z)) return { ok: false, err: "oob" };
      const fl = d.floors[op.f];
      if (!fl) return { ok: false, err: "nofloor" };
      const ct = op.ct && op.ct >= 1 && op.ct <= 4 ? op.ct | 0 : CT.FLOOR;
      fl.cells[ck(op.x, op.z)] = ct;
      return { ok: true };
    }
    case "cell-": {
      const fl = d.floors[op.f];
      if (!fl) return { ok: false, err: "nofloor" };
      delete fl.cells[ck(op.x, op.z)];
      // erase everything that stood on the cell
      fl.objects = fl.objects.filter((o) => !(o.x === op.x && o.z === op.z));
      if (fl.heights) delete fl.heights[ck(op.x, op.z)];
      return { ok: true };
    }
    case "raise": case "lower": {
      if (!inBounds(op.x, op.z)) return { ok: false, err: "oob" };
      const fl = d.floors[op.f];
      if (!fl) return { ok: false, err: "nofloor" };
      if (!fl.cells[ck(op.x, op.z)]) return { ok: false, err: "nocell" }; // only on existing floor
      fl.heights = fl.heights || {};
      const k = ck(op.x, op.z);
      const nv = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, (fl.heights[k] | 0) + (op.t === "raise" ? 1 : -1)));
      if (nv === 0) delete fl.heights[k]; else fl.heights[k] = nv;
      return { ok: true };
    }
    case "obj+": {
      const fl = d.floors[op.f];
      if (!fl) return { ok: false, err: "nofloor" };
      if (!KINDS[op.o.kind]) return { ok: false, err: "kind" };
      if (!inBounds(op.o.x, op.o.z)) return { ok: false, err: "oob" };
      if (!fl.cells[ck(op.o.x, op.o.z)]) return { ok: false, err: "nocell" };
      // one object per cell, except: key may share with chest/enemy; torch/light share with anything non-solid
      const here = objsAt(d, op.f, op.o.x, op.o.z);
      const kind = op.o.kind;
      const shareOK =
        (kind === "key" && here.every((h) => ["chest", "enemy", "torch", "light"].includes(h.kind))) ||
        (["torch", "light"].includes(kind) && here.every((h) => !KINDS[h.kind].solid || h.kind === "chest")) ||
        here.length === 0;
      if (!shareOK) return { ok: false, err: "occupied" };
      // singletons: spawn + exit (one each per dungeon)
      if (kind === "spawn" || kind === "exit") {
        d.floors.forEach((ffl) => { ffl.objects = ffl.objects.filter((o) => o.kind !== kind); });
      }
      const o = Object.assign({}, op.o);
      o.id = op.o.id || "o" + d.nid++;
      if (op.o.id) { const n = parseInt(op.o.id.slice(1), 10); if (n >= d.nid) d.nid = n + 1; }
      o.rot = o.rot || 0;
      if (kind === "door" && o.locked == null) o.locked = false;
      fl.objects.push(o);
      return { ok: true, id: o.id };
    }
    case "obj-": {
      const hit = objById(d, op.id);
      if (!hit) return { ok: false, err: "noobj" };
      const fl = d.floors[hit.f];
      fl.objects = fl.objects.filter((o) => o.id !== op.id);
      return { ok: true };
    }
    case "objEdit": {
      const hit = objById(d, op.id);
      if (!hit) return { ok: false, err: "noobj" };
      const ALLOW = ["x", "z", "rot", "locked", "etype", "ttype", "dtype", "color", "stock", "ntype"];
      for (const k of ALLOW) if (op.p && op.p[k] !== undefined) hit.obj[k] = op.p[k];
      return { ok: true };
    }
    case "floor+": {
      if (d.floors.length >= MAX_FLOORS) return { ok: false, err: "maxfloors" };
      d.floors.push(emptyFloor());
      return { ok: true };
    }
    case "floor-": {
      if (d.floors.length <= 1) return { ok: false, err: "minfloors" };
      if (op.f !== d.floors.length - 1) return { ok: false, err: "toponly" };
      // refuse if the top floor still has content
      const fl = d.floors[op.f];
      if (Object.keys(fl.cells).length || fl.objects.length) return { ok: false, err: "notempty" };
      d.floors.pop();
      return { ok: true };
    }
    case "meta": {
      if (op.p.name != null) d.name = String(op.p.name).slice(0, 40);
      if (op.p.theme != null && THEMES.includes(op.p.theme)) d.theme = op.p.theme;
      if (op.p.difficulty != null) d.difficulty = Math.max(1, Math.min(3, op.p.difficulty | 0));
      return { ok: true };
    }
    case "reset": {
      const fresh = op.d ? sanitize(op.d) : newDungeon({ theme: d.theme });
      if (!fresh) return { ok: false, err: "baddata" };
      Object.keys(d).forEach((k) => delete d[k]);
      Object.assign(d, fresh);
      return { ok: true };
    }
    default:
      return { ok: false, err: "unknown op " + op.t };
  }
}

// Room stamp helper (builder "room brush"): floors a w×h rect. Returns ops (already applied).
export function stampRoom(d, f, x0, z0, w, h, ct) {
  const ops = [];
  for (let x = x0; x < x0 + w; x++)
    for (let z = z0; z < z0 + h; z++)
      if (inBounds(x, z)) { const op = { t: "cell+", f, x, z, ct: ct || CT.FLOOR }; if (applyOp(d, op).ok) ops.push(op); }
  return ops;
}

// ─────────────────────────────────────────────────────────────────────────────
// derived geometry — walls + door passages (shared by render + collision)
// ─────────────────────────────────────────────────────────────────────────────

export const DIRS = [ // rot 0..3 → +Z,+X,-Z,-X (N here = +Z for consistency)
  { dx: 0, dz: 1 }, { dx: 1, dz: 0 }, { dx: 0, dz: -1 }, { dx: -1, dz: 0 },
];

/** Wall segments for a floor: [{x,z,side:0..3}] — side uses DIRS index. */
export function wallSegments(d, f) {
  const fl = d.floors[f];
  const out = [];
  if (!fl) return out;
  for (const key of Object.keys(fl.cells)) {
    const [x, z] = key.split(",").map(Number);
    for (let s = 0; s < 4; s++) {
      const nx = x + DIRS[s].dx, nz = z + DIRS[s].dz;
      if (!fl.cells[ck(nx, nz)]) out.push({ x, z, side: s });
    }
  }
  return out;
}

/** Can an actor pass from cell a to adjacent cell b on floor f (doors count)? */
/**
 * A door's pass-through axis, derived from its floor NEIGHBOURS (the doorway it
 * sits in) rather than a stored rotation — so a door always lets you through
 * along its corridor regardless of how it was placed. Returns 0 = passes E-W
 * (along X), 1 = passes N-S (along Z). Falls back to the door's rot if the
 * neighbourhood is ambiguous.
 */
export function doorAxis(d, f, x, z) {
  const ew = hasCell(d, f, x - 1, z) && hasCell(d, f, x + 1, z);
  const ns = hasCell(d, f, x, z - 1) && hasCell(d, f, x, z + 1);
  if (ew && !ns) return 0;
  if (ns && !ew) return 1;
  const door = objsAt(d, f, x, z).find((o) => o.kind === "door");
  return door && door.rot % 2 === 1 ? 0 : 1;
}

export function passable(d, f, ax, az, bx, bz, openDoors) {
  if (!hasCell(d, f, bx, bz)) return false;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) + Math.abs(dz) !== 1) return false;
  const moveX = dx !== 0;
  // door on either endpoint: you cross it only along its doorway axis, and only
  // when it's open (unlocked doors are pre-opened by the solvability checker).
  for (const [x, z] of [[ax, az], [bx, bz]]) {
    for (const o of objsAt(d, f, x, z)) {
      if (o.kind === "door") {
        if ((doorAxis(d, f, x, z) === 0) !== moveX) return false; // crossing the door's solid wall
        if (!(openDoors && openDoors.has(o.id))) return false;    // closed blocks its cell
      }
      if (o.kind === "decor" && KINDS.decor.solid && (x === bx && z === bz)) return false;
      if (o.kind === "chest" && (x === bx && z === bz)) return false;
    }
  }
  return true;
}

/** Stairs links: [{from:{f,x,z}, to:{f:f+1,x,z}, rot}] */
export function stairLinks(d) {
  const out = [];
  d.floors.forEach((fl, f) => {
    for (const o of fl.objects) {
      if (o.kind !== "stairs" || f + 1 >= d.floors.length) continue;
      const dir = DIRS[o.rot % 4];
      const lx = o.x + dir.dx, lz = o.z + dir.dz;
      if (hasCell(d, f + 1, lx, lz)) out.push({ from: { f, x: o.x, z: o.z }, to: { f: f + 1, x: lx, z: lz }, rot: o.rot, id: o.id });
    }
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// validation + solvability
// ─────────────────────────────────────────────────────────────────────────────

export function validate(d) {
  const problems = [];
  const spawns = findAll(d, "spawn");
  const exits = findAll(d, "exit");
  if (spawns.length !== 1) problems.push({ code: "spawn", msg: spawns.length ? "Multiple spawns" : "Place a player spawn" });
  if (exits.length !== 1) problems.push({ code: "exit", msg: exits.length ? "Multiple exits" : "Place an exit portal" });
  // stairs landings
  d.floors.forEach((fl, f) => {
    for (const o of fl.objects) {
      if (o.kind !== "stairs") continue;
      if (f + 1 >= d.floors.length) { problems.push({ code: "stairs", id: o.id, msg: "Stairs on the top floor lead nowhere" }); continue; }
      const dir = DIRS[o.rot % 4];
      if (!hasCell(d, f + 1, o.x + dir.dx, o.z + dir.dz))
        problems.push({ code: "stairs", id: o.id, msg: `Stairs need a floor tile above the landing (floor ${f + 2})` });
    }
  });
  const solv = spawns.length === 1 && exits.length === 1 ? solvability(d) : null;
  if (solv && !solv.solvable) problems.push({ code: "unsolvable", msg: solv.reason });
  return { ok: problems.length === 0, problems, solvability: solv };
}

/**
 * Key/lock solvability: flood-fill from spawn; generic keys open generic
 * locks. Keys live on the floor, inside chests, or on enemies — all count as
 * collectible when their cell is reached. Opening a door only ever grows the
 * reachable set, so greedy open-with-reflood is exact.
 */
export function solvability(d) {
  const spawn = findAll(d, "spawn")[0];
  const exit = findAll(d, "exit")[0];
  if (!spawn || !exit) return { solvable: false, reason: "missing spawn/exit" };

  const links = stairLinks(d);
  const opened = new Set();       // door ids treated as open
  const totalKeys = findAll(d, "key").length;
  const lockedDoors = () => { const m = new Map(); d.floors.forEach((fl) => fl.objects.forEach((o) => { if (o.kind === "door" && o.locked && !opened.has(o.id)) m.set(o.id, o); })); return m; };
  // unlocked doors are passable from the start
  d.floors.forEach((fl) => fl.objects.forEach((o) => { if (o.kind === "door" && !o.locked) opened.add(o.id); }));

  let keys = 0, used = 0;
  const collected = new Set();

  const flood = () => {
    const seen = new Set();
    const q = [[spawn.f, spawn.obj.x, spawn.obj.z]];
    seen.add(spawn.f + ":" + ck(spawn.obj.x, spawn.obj.z));
    const frontierDoors = new Set();
    while (q.length) {
      const [f, x, z] = q.shift();
      for (let s = 0; s < 4; s++) {
        const nx = x + DIRS[s].dx, nz = z + DIRS[s].dz;
        const k = f + ":" + ck(nx, nz);
        if (seen.has(k) || !hasCell(d, f, nx, nz)) continue;
        // doors: use passable() but track locked frontier separately
        if (passable(d, f, x, z, nx, nz, opened)) { seen.add(k); q.push([f, nx, nz]); continue; }
        // was it a locked door that blocked us along its (neighbour-derived) axis?
        const dCell = objsAt(d, f, nx, nz).find((o) => o.kind === "door") ? [nx, nz] : [x, z];
        const doorHere = objsAt(d, f, nx, nz).find((o) => o.kind === "door") || objsAt(d, f, x, z).find((o) => o.kind === "door");
        if (doorHere && doorHere.locked && !opened.has(doorHere.id)) {
          const moveX = (nx - x) !== 0;
          if ((doorAxis(d, f, dCell[0], dCell[1]) === 0) === moveX) frontierDoors.add(doorHere.id);
        }
      }
      // stairs from this cell (both directions)
      for (const L of links) {
        if (L.from.f === f && L.from.x === x && L.from.z === z) {
          const k = L.to.f + ":" + ck(L.to.x, L.to.z);
          if (!seen.has(k)) { seen.add(k); q.push([L.to.f, L.to.x, L.to.z]); }
        }
        if (L.to.f === f && L.to.x === x && L.to.z === z) {
          const k = L.from.f + ":" + ck(L.from.x, L.from.z);
          if (!seen.has(k)) { seen.add(k); q.push([L.from.f, L.from.x, L.from.z]); }
        }
      }
    }
    return { seen, frontierDoors };
  };

  // a key counts as collectible when its cell OR any adjacent cell is reached
  // (chest cells are solid — you loot them from beside, never standing on them)
  const keyReachable = (seen, f, x, z) => {
    if (seen.has(f + ":" + ck(x, z))) return true;
    for (let s = 0; s < 4; s++) if (seen.has(f + ":" + ck(x + DIRS[s].dx, z + DIRS[s].dz))) return true;
    return false;
  };

  for (let iter = 0; iter < 200; iter++) {
    const { seen, frontierDoors } = flood();
    // collect keys inside the reached region
    d.floors.forEach((fl, f) => fl.objects.forEach((o) => {
      if (o.kind === "key" && !collected.has(o.id) && keyReachable(seen, f, o.x, o.z)) { collected.add(o.id); keys++; }
    }));
    if (seen.has(exit.f + ":" + ck(exit.obj.x, exit.obj.z)))
      return { solvable: true, keysFound: keys, keysUsed: used, totalKeys };
    if (frontierDoors.size && keys - used > 0) {
      const id = frontierDoors.values().next().value;
      opened.add(id); used++;
      continue;
    }
    return {
      solvable: false,
      reason: frontierDoors.size
        ? `A locked door blocks the way and no more keys are reachable (${keys} key${keys === 1 ? "" : "s"} found, ${used} used)`
        : "The exit is not connected to the spawn — check floors, doors and stairs",
      keysFound: keys, keysUsed: used, totalKeys,
    };
  }
  return { solvable: false, reason: "solvability check overflow" };
}

// ─────────────────────────────────────────────────────────────────────────────
// loot — deterministic per (dungeon seed, chest id, run seed)
// ─────────────────────────────────────────────────────────────────────────────

export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Roll chest contents. boundKey = a key object bound to this chest (or null). */
export function rollLoot(d, chestId, runSeed, boundKey) {
  const rnd = mulberry((d.seed ^ hashStr(chestId) ^ (runSeed >>> 0)) >>> 0);
  const diff = d.difficulty || 1;
  const items = [];
  if (boundKey) items.push({ kind: "key" });
  items.push({ kind: "gold", n: Math.round((10 + rnd() * 22) * diff) });
  if (rnd() < 0.55) items.push({ kind: "potion" });
  if (rnd() < 0.45) items.push({ kind: "mana" });
  if (rnd() < 0.10 + 0.06 * diff) items.push({ kind: "charm" });                    // +20% damage, run-long
  if (rnd() < 0.14 + 0.05 * diff) items.push({ kind: "weapon", tier: 1 + (rnd() < 0.3 * diff ? 1 : 0) }); // visible weapon upgrade
  if (rnd() < 0.14 + 0.05 * diff) items.push({ kind: "armor", tier: 1 + (rnd() < 0.3 * diff ? 1 : 0) });  // visible armor
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// serialization + share codec
// ─────────────────────────────────────────────────────────────────────────────

export function serialize(d) {
  return JSON.stringify(d);
}

export function sanitize(raw) {
  try {
    const d = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!d || d.v !== 1 || !Array.isArray(d.floors) || !d.floors.length) return null;
    const out = newDungeon({ name: d.name, theme: d.theme, difficulty: d.difficulty, author: d.author, seed: d.seed });
    out.nid = Math.max(1, d.nid | 0);
    out.floors = [];
    for (const fl of d.floors.slice(0, MAX_FLOORS)) {
      const nf = emptyFloor();
      if (fl && fl.cells) for (const k of Object.keys(fl.cells)) {
        const [x, z] = k.split(",").map(Number);
        const ct = fl.cells[k] | 0;
        if (inBounds(x, z)) nf.cells[ck(x, z)] = ct >= 1 && ct <= 4 ? ct : 1;
      }
      if (fl && fl.heights) for (const k of Object.keys(fl.heights)) {
        const [x, z] = k.split(",").map(Number);
        const lv = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, fl.heights[k] | 0));
        if (inBounds(x, z) && lv !== 0 && nf.cells[ck(x, z)]) nf.heights[ck(x, z)] = lv;
      }
      if (fl && Array.isArray(fl.objects)) for (const o of fl.objects.slice(0, 4000)) {
        if (!o || !KINDS[o.kind] || !inBounds(o.x | 0, o.z | 0)) continue;
        const c = { id: String(o.id || "o" + out.nid++).slice(0, 12), kind: o.kind, x: o.x | 0, z: o.z | 0, rot: (o.rot | 0) % 4 };
        if (o.kind === "door") c.locked = !!o.locked;
        if (o.kind === "enemy") c.etype = String(o.etype || "").slice(0, 16);
        if (o.kind === "trap") c.ttype = TRAPS.includes(o.ttype) ? o.ttype : "spikes";
        if (o.kind === "decor") c.dtype = String(o.dtype || "").slice(0, 16);
        if (o.kind === "npc") {
          c.ntype = NPC_TYPES[o.ntype] ? o.ntype : "merchant";
          c.stock = Array.isArray(o.stock) ? o.stock.filter((s) => SHOP[s]).slice(0, 8) : SHOP_IDS.slice();
        }
        if (o.kind === "light" && o.color) c.color = String(o.color).slice(0, 9);
        const n = parseInt(c.id.slice(1), 10); if (!isNaN(n) && n >= out.nid) out.nid = n + 1;
        nf.objects.push(c);
      }
      out.floors.push(nf);
    }
    return out;
  } catch (e) { return null; }
}

const B64URL = { "+": "-", "/": "_", "=": "" };
function bufToB64url(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = (typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64"));
  return b64.replace(/[+/=]/g, (c) => B64URL[c]);
}
function b64urlToBuf(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Compress a dungeon into a URL-safe share string (CompressionStream, ~10× smaller). */
export async function encodeShare(d) {
  const json = new TextEncoder().encode(serialize(d));
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter();
  w.write(json); w.close();
  const packed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return "DF1." + bufToB64url(packed);
}

export async function decodeShare(code) {
  try {
    if (!code || !code.startsWith("DF1.")) return null;
    const packed = b64urlToBuf(code.slice(4));
    const ds = new DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter();
    w.write(packed); w.close();
    const json = await new Response(ds.readable).text();
    return sanitize(json);
  } catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// starter dungeon — what a fresh builder session opens with (also selftest fixture)
// ─────────────────────────────────────────────────────────────────────────────

export function starterDungeon(theme) {
  const d = newDungeon({ name: "New Dungeon", theme: theme || "fantasy" });
  stampRoom(d, 0, 28, 28, 8, 8);
  // spawn + exit at OPPOSITE corners (not lined up) — drag them anywhere you like.
  applyOp(d, { t: "obj+", f: 0, o: { kind: "spawn", x: 29, z: 29 } });
  applyOp(d, { t: "obj+", f: 0, o: { kind: "exit", x: 34, z: 34 } });
  applyOp(d, { t: "obj+", f: 0, o: { kind: "torch", x: 34, z: 29 } });
  applyOp(d, { t: "obj+", f: 0, o: { kind: "torch", x: 29, z: 34 } });
  return d;
}

/**
 * A handful of starter LAYOUTS to open a new build from — a blank room, two
 * halls joined by a corridor, or a two-floor tower with stairs. Each is a valid,
 * solvable jumping-off point; drag/edit freely from there.
 */
export const STARTER_TEMPLATES = [
  { kind: "room",  label: "Blank Room",  icon: "▦",  desc: "one room · spawn + exit" },
  { kind: "halls", label: "Twin Halls",  icon: "🏛", desc: "two rooms + corridor" },
  { kind: "tower", label: "Two Floors",  icon: "🪜",  desc: "stairs up to floor 2" },
];

export function starterTemplate(theme, kind) {
  theme = theme || "fantasy";
  if (kind === "halls") {
    const d = newDungeon({ name: "New Dungeon", theme });
    stampRoom(d, 0, 22, 28, 7, 8);
    stampRoom(d, 0, 35, 28, 7, 8);
    for (let x = 29; x < 35; x++) applyOp(d, { t: "cell+", f: 0, x, z: 31, ct: CT.FLOOR });
    applyOp(d, { t: "obj+", f: 0, o: { kind: "spawn", x: 23, z: 29 } });
    applyOp(d, { t: "obj+", f: 0, o: { kind: "exit", x: 40, z: 34 } });
    applyOp(d, { t: "obj+", f: 0, o: { kind: "torch", x: 23, z: 34 } });
    applyOp(d, { t: "obj+", f: 0, o: { kind: "torch", x: 40, z: 29 } });
    return d;
  }
  if (kind === "tower") {
    const d = newDungeon({ name: "New Dungeon", theme });
    stampRoom(d, 0, 28, 28, 8, 8);
    applyOp(d, { t: "obj+", f: 0, o: { kind: "spawn", x: 29, z: 29 } });
    applyOp(d, { t: "obj+", f: 0, o: { kind: "stairs", x: 34, z: 34 } });
    applyOp(d, { t: "obj+", f: 0, o: { kind: "torch", x: 29, z: 34 } });
    applyOp(d, { t: "floor+" });
    stampRoom(d, 1, 28, 28, 8, 8);
    applyOp(d, { t: "obj+", f: 1, o: { kind: "exit", x: 30, z: 30 } });
    applyOp(d, { t: "obj+", f: 1, o: { kind: "torch", x: 33, z: 29 } });
    return d;
  }
  return starterDungeon(theme);   // "room"
}
