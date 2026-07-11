/**
 * Dungeon Forge — runtime/sim/escape_sim.js
 * Headless ESCAPE-RUN state machine: continuous-space players on the cell
 * grid, enemy AI (patrol → chase → attack), melee/bolt combat, traps, chests,
 * keys + locked doors, stairs, the exit portal and run timing. Deterministic
 * given (dungeon, runSeed, inputs) — the selftest drives it in node, and in
 * multiplayer each client runs the same sim, owning its player while the host
 * owns enemies (coilnet model).
 *
 * Units: world units (CELL=4 per cell). Y is handled as the current floor
 * index + a visual climb fraction on stairs — physics is 2D per floor.
 */

import {
  CELL, DIRS, ENEMIES, ck, hasCell, objsAt, findAll, stairLinks,
  mulberry, hashStr, rollLoot, cellType, cellHeight, CT, LAVA_DPS, WATER_SLOW, RAISED_H,
  SHOP, SHOP_IDS, NPC_TYPES, doorAxis, BREAKABLE_DECOR, EXPLOSIVE_DECOR, BARREL, makeItem, itemScore,
  edgeWall, edgeMid,
} from "./dungeon.js";

export const PLAYER = {
  hp: 100, speed: 4.6, sprint: 6.6, radius: 0.42,
  meleeDmg: 30, meleeRange: 2.0, meleeArc: Math.PI * 0.62, meleeCd: 0.55,
  boltDmg: 16, boltSpeed: 15, boltCd: 0.32, boltMana: 12,
  mana: 100, manaRegen: 9, potionHeal: 35, manaPotRestore: 60, respawnS: 5,
};

// ── XP & leveling ───────────────────────────────────────────────────────────
// Kills grant XP; enough XP raises the player's level, which adds max-HP and a
// small damage bonus (folded into combatMul). Level gates future class skills.
export const LEVELING = { maxLevel: 30, hpPerLevel: 12, dmgPerLevel: 0.04, baseXp: 45, growth: 1.35 };
export function xpToNext(lvl) { return Math.round(LEVELING.baseXp * Math.pow(LEVELING.growth, Math.max(0, (lvl || 1) - 1))); }
export function xpFromEnemy(K) {
  const base = Math.max(5, Math.round((K.hp || 30) * 0.4 + (K.dmg || 5) * 1.1));
  return K.boss ? base * 3 : base;
}
export function gainXp(st, p, amount) {
  if (!p || amount <= 0 || p.level >= LEVELING.maxLevel) return;
  p.xp = (p.xp || 0) + amount;
  let leveled = false;
  while (p.level < LEVELING.maxLevel && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    p.baseMaxHp = (p.baseMaxHp || 100) + LEVELING.hpPerLevel;
    leveled = true;
  }
  if (p.level >= LEVELING.maxLevel) p.xp = 0;          // capped: bar shows full/maxed
  if (leveled) { recomputeMaxHp(p); p.hp = p.maxHp; emit(st, "levelup", { id: p.id, level: p.level }); }
}

// Aggregate offensive multiplier: charms + found-weapon tier + gear affixes + level.
// Single source so every attack (melee/bolt/special/frost/chain) scales uniformly.
export function combatMul(p) {
  return (1 + 0.2 * (p.charms || 0)) * (1 + 0.12 * (p.weaponTier || 0)) *
         (1 + (p.gearDmg || 0)) * (1 + LEVELING.dmgPerLevel * ((p.level || 1) - 1));
}

/**
 * CLASSES — four industry-standard kits. LMB always drives the 3-hit melee
 * combo (per-stage damage, finisher bonus); RMB is the class special; the
 * Sorceress additionally casts FROST on R. Shield/2H/spells/poison per class.
 * dmg arrays are [stage1, stage2, finisher].
 */
export const CLASSES = {
  knight: {
    label: "Knight", hp: 120, speed: 4.4,
    melee: { dmg: [24, 26, 40], range: 2.0, arc: 1.75, cd: 0.5 },
    shield: { reduce: 0.45, frontArc: 1.05 },          // blocks 45% from the front
    special: { kind: "bash", dmg: 18, stun: 1.2, range: 2.3, cd: 5 },
  },
  barbarian: {
    label: "Barbarian", hp: 110, speed: 4.5,
    melee: { dmg: [34, 36, 55], range: 2.35, arc: 2.3, cd: 0.72, twoHanded: true },
    special: { kind: "crush", dmgMul: 2.2, range: 2.5, cd: 3 },
  },
  sorceress: {
    label: "Sorceress", hp: 85, speed: 4.6,
    melee: { dmg: [14, 14, 22], range: 1.9, arc: 1.6, cd: 0.5 },
    special: { kind: "fire", dmg: 20, burn: { dps: 5, dur: 3 }, cd: 0.55, mana: 16, speed: 15 },
    frost: { dmg: 12, slow: { mul: 0.45, dur: 2.5 }, cd: 0.7, mana: 14, speed: 13 },
  },
  rogue: {
    label: "Rogue", hp: 90, speed: 5.2,
    melee: { dmg: [13, 13, 24], range: 1.8, arc: 1.5, cd: 0.34, poison: { dps: 6, dur: 4, maxStacks: 3 } },
    special: { kind: "knife", dmg: 10, poison: { dps: 6, dur: 4, maxStacks: 3 }, cd: 1.4, speed: 17 },
  },
};
export const CLASS_ORDER = ["knight", "barbarian", "sorceress", "rogue"];
const COMBO_WINDOW = 0.9; // seconds after cooldown to continue the chain

export const TRAPK = {
  spikes: { period: 2.9, warn: 0.5, active: 1.0, dmg: 25, jitter: 1.8 }, // jitter: random re-arm delay (owner: spikes pop RANDOMLY)
  vent:   { period: 4.2, warn: 0.6, active: 1.5, dmg: 12, tick: 0.4 },
  firejet:{ period: 4.4, warn: 0.8, active: 1.5, dmg: 14, reach: 3 },    // wall FLAME JET: cone of fire down the facing dir
  javelin:{ cooldown: 2.6, dmg: 42, speed: 22 },                          // tripwire: a javelin flies across the room
  pit:    { arm: 0.35 },                                                  // secret floor HOLE: tile falls away → death
};
// facing → cell step (rot 0..3 = +Z, +X, -Z, -X — matches placement rot)
const TRAP_DIR = [[0, 1], [1, 0], [0, -1], [-1, 0]];

const EV = [];
function emit(st, type, d) { st.events.push(Object.assign({ type }, d)); }

export const w2c = (v) => Math.floor(v / CELL);
export const c2w = (c) => c * CELL + CELL / 2;

// ─────────────────────────────────────────────────────────────────────────────
// run construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a run state. players: [{id, name, skin}] — index 0 is "me" by
 * convention of the caller; every sim instance simulates ALL players'
 * movement from their inputs, but in MP remote players are driven by
 * network position feeds instead (their input stays zero).
 */
export function newRun(d, runSeed, players) {
  const spawn = findAll(d, "spawn")[0];
  const exit = findAll(d, "exit")[0];
  if (!spawn || !exit) throw new Error("dungeon needs spawn+exit");
  const rnd = mulberry(runSeed >>> 0);

  const st = {
    d, runSeed: runSeed >>> 0, time: 0, over: false, result: null,
    events: [],                    // drained by render/net each tick
    openDoors: new Set(),          // door ids currently open (unlocked+used)
    unlockedDoors: new Set(),      // locked doors that have been unlocked
    openedChests: new Set(),
    takenItems: new Set(),         // key/loot pickup ids
    brokenDecor: new Set(),        // smashed breakable decor ids
    exit: { f: exit.f, x: exit.obj.x, z: exit.obj.z },
    spawn: { f: spawn.f, x: spawn.obj.x, z: spawn.obj.z, rot: spawn.obj.rot || 0 },
    players: [],
    enemies: [],
    bolts: [],                     // {id, owner, f, x, z, vx, vz, ttl, dmg}
    traps: [],                     // {id, f, x, z, ttype, phase}
    stairs: stairLinks(d),
    nextBolt: 1,
  };

  players.forEach((p, i) => {
    const cls = CLASSES[CLASS_ORDER[(p.skin || 0) % CLASS_ORDER.length]];
    st.players.push({
      id: p.id, name: p.name || "Player", skin: p.skin || 0, slot: i,
      cls: CLASS_ORDER[(p.skin || 0) % CLASS_ORDER.length],
      maxHp: cls.hp, combo: 0, comboT: 0, specialT: 0, frostT: 0, chainT: 0, stunT: 0,
      f: spawn.f, x: c2w(spawn.obj.x) + (i % 2) * 0.9 - 0.45, z: c2w(spawn.obj.z) + Math.floor(i / 2) * 0.9 - 0.45,
      yaw: (spawn.obj.rot || 0) * Math.PI / 2, hp: cls.hp, mana: PLAYER.mana,
      alive: true, escaped: false, deaths: 0, gold: 40, keys: 0, potions: 1, manaPots: 0, charms: 0,
      level: 1, xp: 0,             // progression: gainXp() raises level → +maxHp +dmg
      weaponTier: 0, armorTier: 0, // derived from equipped items (see recomputeGear)
      baseMaxHp: cls.hp, blessHp: 0, equipped: { weapon: null, armor: null }, inventory: [], gearDmg: 0, gearMaxHp: 0,
      meleeT: 0, boltT: 0, hurtT: 0, respawnT: 0, climb: null, stairLock: null, airborne: false, // climb: {t, from, to}
      input: { mx: 0, mz: 0, sprint: false, melee: false, bolt: false, interact: false, potion: false, yaw: 0 },
      remote: !!p.remote, stepAcc: 0,
    });
  });

  // enemies from spawn markers (host authoritative in MP)
  let eid = 1;
  d.floors.forEach((fl, f) => fl.objects.forEach((o) => {
    if (o.kind !== "enemy") return;
    const roster = ENEMIES[d.theme] || ENEMIES.fantasy;
    const base = roster[o.etype] || roster[Object.keys(roster)[0]];
    // per-placement stat overrides (hp/dmg/speed) set by the builder, else defaults
    const K = (o.stats && typeof o.stats === "object") ? { ...base, ...o.stats } : base;
    const boundKey = fl.objects.find((k) => k.kind === "key" && k.x === o.x && k.z === o.z);
    st.enemies.push({
      id: "e" + eid++, src: o.id, etype: o.etype, f, K,
      x: c2w(o.x), z: c2w(o.z), yaw: (o.rot || 0) * Math.PI / 2,
      hp: K.hp * (0.85 + 0.15 * (d.difficulty || 1)), alive: true,
      state: "patrol", atkT: 0, repathT: 0, path: null, home: { x: c2w(o.x), z: c2w(o.z) },
      patrolT: 1 + rnd() * 2, target: null, hurtT: 0,
      key: boundKey ? boundKey.id : null,
      droppedKey: null,
    });
  }));

  // traps (rot = facing for firejet/javelin; pit/javelin carry their own state)
  d.floors.forEach((fl, f) => fl.objects.forEach((o) => {
    if (o.kind !== "trap") return;
    st.traps.push({ id: o.id, f, x: o.x, z: o.z, ttype: o.ttype || "spikes", rot: o.rot || 0,
                    phase: rnd() * 2, cd: 0, open: false, armT: 0 });
  }));

  // explosive barrels: barrel/canister decor becomes a live pushable entity
  st.barrels = [];
  d.floors.forEach((fl, f) => fl.objects.forEach((o) => {
    if (o.kind !== "decor" || !EXPLOSIVE_DECOR.has(o.dtype)) return;
    st.barrels.push({ id: "brl" + o.id, src: o.id, f, x: c2w(o.x), z: c2w(o.z), hp: BARREL.hp, alive: true });
  }));

  return st;
}

/** Drop-in join: add a player to a running escape (multiplayer). */
export function addPlayer(st, p) {
  const i = st.players.length;
  const cls = CLASSES[CLASS_ORDER[(p.skin || 0) % CLASS_ORDER.length]];
  const np = {
    id: p.id, name: p.name || "Player", skin: p.skin || 0, slot: i,
    cls: CLASS_ORDER[(p.skin || 0) % CLASS_ORDER.length],
    maxHp: cls.hp, combo: 0, comboT: 0, specialT: 0, frostT: 0, chainT: 0, stunT: 0,
    f: st.spawn.f, x: c2w(st.spawn.x) + (i % 2) * 0.9 - 0.45, z: c2w(st.spawn.z) + Math.floor(i / 2) * 0.9 - 0.45,
    yaw: 0, hp: cls.hp, mana: PLAYER.mana,
    alive: true, escaped: false, deaths: 0, gold: 40, keys: 0, potions: 1, manaPots: 0, charms: 0,
    level: 1, xp: 0,
    weaponTier: 0, armorTier: 0,
    baseMaxHp: cls.hp, blessHp: 0, equipped: { weapon: null, armor: null }, inventory: [], gearDmg: 0, gearMaxHp: 0,
    meleeT: 0, boltT: 0, hurtT: 0, respawnT: 0, climb: null,
    input: { mx: 0, mz: 0, sprint: false, melee: false, bolt: false, interact: false, potion: false, yaw: 0 },
    remote: !!p.remote, stepAcc: 0,
  };
  st.players.push(np);
  return np;
}

// ─────────────────────────────────────────────────────────────────────────────
// collision — circle vs derived walls/doors/solid objects, axis-separated slide
// ─────────────────────────────────────────────────────────────────────────────

function cellBlocked(st, f, cx, cz, forEnemy) {
  const d = st.d;
  if (!hasCell(d, f, cx, cz)) return true;
  for (const o of objsAt(d, f, cx, cz)) {
    if (o.kind === "door" && !st.openDoors.has(o.id)) return true;
    if (o.kind === "decor") {
      if (st.brokenDecor.has(o.id)) continue;            // smashed decor no longer blocks
      if (EXPLOSIVE_DECOR.has(o.dtype)) continue;        // barrels are PUSHED, not walls
      return true;
    }
    if (o.kind === "chest" || o.kind === "npc") return true;
    if (forEnemy && o.kind === "door") return true; // enemies never path through doors (even open? open ok)
  }
  return false;
}

// door cells restrict crossing to their axis even when open; interior EDGE
// walls block their line outright (edge DOORS block until opened). This is the
// single edge-crossing gate — movement, enemies, bolts, LOS and A* all route
// through it, so manual walls "just work" everywhere.
function doorAxisBlocks(st, f, fromX, fromZ, toX, toZ) {
  const moveX = Math.sign(toX - fromX) !== 0;
  for (const [x, z] of [[fromX, fromZ], [toX, toZ]]) {
    for (const o of objsAt(st.d, f, x, z)) {
      if (o.kind !== "door") continue;
      if ((doorAxis(st.d, f, x, z) === 0) !== moveX) return true; // crossing the door's solid wall
    }
  }
  const w = edgeWall(st.d, f, fromX, fromZ, toX, toZ);
  if (w) {
    if (!w.door) return true;                 // solid interior wall
    if (!st.openDoors.has(w.id)) return true; // closed/locked edge door
  }
  return false;
}

/** Move a circle at (x,z) by (mx,mz) on floor f with wall sliding. */
export function moveCircle(st, f, x, z, mx, mz, r, forEnemy) {
  // axis-separated: X then Z, sampling the 3 relevant cell borders each axis
  let nx = x + mx, nz = z;
  if (blockedAt(st, f, nx, nz, r, x, z, forEnemy)) nx = x;
  let nz2 = nz + mz;
  if (blockedAt(st, f, nx, nz2, r, nx, nz, forEnemy)) nz2 = nz;
  return { x: nx, z: nz2, hitX: nx === x && mx !== 0, hitZ: nz2 === nz && mz !== 0 };
}

function blockedAt(st, f, x, z, r, fromX, fromZ, forEnemy) {
  const minCx = w2c(x - r), maxCx = w2c(x + r), minCz = w2c(z - r), maxCz = w2c(z + r);
  const fcx = w2c(fromX), fcz = w2c(fromZ);
  for (let cx = minCx; cx <= maxCx; cx++)
    for (let cz = minCz; cz <= maxCz; cz++) {
      if (cellBlocked(st, f, cx, cz, false)) return true;
      if ((cx !== fcx || cz !== fcz) && doorAxisBlocks(st, f, fcx, fcz, cx, cz)) return true;
    }
  return false;
}

// grid A* (per floor, door-aware). Small maps → cheap.
export function findPath(st, f, sx, sz, tx, tz) {
  const d = st.d;
  const start = ck(w2c(sx), w2c(sz)), goal = ck(w2c(tx), w2c(tz));
  if (start === goal) return [];
  const open = new Map([[start, 0]]);
  const came = new Map(), g = new Map([[start, 0]]);
  const h = (k) => { const [x, z] = k.split(",").map(Number); const [gx, gz] = goal.split(",").map(Number); return Math.abs(x - gx) + Math.abs(z - gz); };
  let guard = 0;
  while (open.size && guard++ < 4000) {
    let bk = null, bv = Infinity;
    for (const [k, v] of open) if (v < bv) { bv = v; bk = k; }
    open.delete(bk);
    if (bk === goal) {
      const path = [];
      let cur = goal;
      while (cur !== start) { const [x, z] = cur.split(",").map(Number); path.unshift({ x: c2w(x), z: c2w(z) }); cur = came.get(cur); }
      return path;
    }
    const [x, z] = bk.split(",").map(Number);
    for (let s = 0; s < 4; s++) {
      const nx = x + DIRS[s].dx, nz = z + DIRS[s].dz, nk = ck(nx, nz);
      if (cellBlocked(st, f, nx, nz, false)) continue;
      if (doorAxisBlocks(st, f, x, z, nx, nz)) continue;
      const ng = g.get(bk) + 1;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, bk); open.set(nk, ng + h(nk)); }
    }
  }
  return null;
}

/** Grid-cell LOS (Bresenham over cells; walls/closed doors block). */
export function hasLOS(st, f, x0, z0, x1, z1) {
  let cx = w2c(x0), cz = w2c(z0);
  const tx = w2c(x1), tz = w2c(z1);
  let guard = 0;
  while ((cx !== tx || cz !== tz) && guard++ < 200) {
    const dx = Math.sign(tx - cx), dz = Math.sign(tz - cz);
    // prefer the dominant axis for a fatter, forgiving line
    const ex = Math.abs(tx - cx), ez = Math.abs(tz - cz);
    const step = ex >= ez ? [dx, 0] : [0, dz];
    const nx = cx + step[0], nz = cz + step[1];
    if (cellBlocked(st, f, nx, nz, false)) return false;
    if (doorAxisBlocks(st, f, cx, cz, nx, nz)) return false;
    cx = nx; cz = nz;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// interactions
// ─────────────────────────────────────────────────────────────────────────────

function nearestInteractable(st, p) {
  const d = st.d;
  const cx = w2c(p.x), cz = w2c(p.z);
  // 4.75 covers the center of an orthogonally-adjacent cell (4.0) plus
  // approach jitter, while excluding diagonal neighbors (5.66)
  let best = null, bestD = 4.75;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const x = cx + dx, z = cz + dz;
    for (const o of objsAt(d, p.f, x, z)) {
      if (!["door", "chest", "key"].includes(o.kind)) continue;
      if (o.kind === "key") {
        if (st.takenItems.has(o.id)) continue;
        // keys bound to chest/enemy are not floor pickups
        if (objsAt(d, p.f, x, z).some((c) => c.kind === "chest") ) continue;
        if (st.enemies.some((e) => e.key === o.id && e.alive)) continue;
      }
      if (o.kind === "chest" && st.openedChests.has(o.id)) continue;
      // no looting through walls: a non-door target in another cell must be
      // reachable across that edge (chest cells are solid → check the edge
      // geometry only, so pass the chest's own cell as openable)
      if (o.kind !== "door" && (dx !== 0 || dz !== 0)) {
        if (Math.abs(dx) + Math.abs(dz) !== 1) continue;           // orthogonal only
        const wall = wallBetween(st, p.f, cx, cz, x, z);
        if (wall) continue;
      }
      const dist = Math.hypot(c2w(x) - p.x, c2w(z) - p.z);
      if (dist < bestD) { bestD = dist; best = o; }
    }
  }
  // dropped keys (from enemies) are dynamic
  for (const e of st.enemies) {
    if (e.droppedKey && !st.takenItems.has(e.droppedKey) && e.f === p.f) {
      const dist = Math.hypot(e.x - p.x, e.z - p.z);
      if (dist < bestD) { bestD = dist; best = { id: e.droppedKey, kind: "key", dropped: true, x: w2c(e.x), z: w2c(e.z) }; }
    }
  }
  // EDGE doors (doors on the wall line): door-shaped, so interactHint/doInteract
  // treat them exactly like cell doors (open/close/unlock by id).
  const fl = d.floors[p.f];
  if (fl && fl.walls) for (const k of Object.keys(fl.walls)) {
    const w = fl.walls[k];
    if (!w.door) continue;
    const [ex, ez, es] = k.split(",").map(Number);
    if (Math.abs(ex - cx) > 1 || Math.abs(ez - cz) > 1) continue;   // near cells only
    const mid = edgeMid(ex, ez, es);
    const dist = Math.hypot(mid.x - p.x, mid.z - p.z);
    if (dist < Math.min(bestD, 3.4)) { bestD = dist; best = { id: w.id, kind: "door", locked: !!w.locked, edge: true, ex, ez, es }; }
  }
  return best;
}

/** Is there a wall edge between two orthogonally-adjacent cells (both may
 *  contain solid objects — only the shared EDGE matters here)? */
function wallBetween(st, f, ax, az, bx, bz) {
  if (!hasCell(st.d, f, ax, az) || !hasCell(st.d, f, bx, bz)) return true;
  // a closed door in either cell blocks its axis exactly like passable()
  return doorAxisBlocks(st, f, ax, az, bx, bz);
}

/** What E would do right now — used by HUD prompt + the actual press. */
export function interactHint(st, p) {
  const o = nearestInteractable(st, p);
  if (!o) return null;
  if (o.kind === "door") {
    if (st.openDoors.has(o.id)) return { obj: o, verb: "Close" };
    if (o.locked && !st.unlockedDoors.has(o.id)) return { obj: o, verb: p.keys > 0 ? "Unlock" : "Locked — need a key", need: p.keys <= 0 };
    return { obj: o, verb: "Open" };
  }
  if (o.kind === "chest") return { obj: o, verb: "Open chest" };
  if (o.kind === "key") return { obj: o, verb: "Take key" };
  return null;
}

export function doInteract(st, p) {
  const hint = interactHint(st, p);
  if (!hint || hint.need) { if (hint && hint.need) emit(st, "denied", { id: hint.obj.id, by: p.id }); return false; }
  const o = hint.obj;
  if (o.kind === "door") {
    if (st.openDoors.has(o.id)) { st.openDoors.delete(o.id); emit(st, "door", { id: o.id, open: false, by: p.id }); return true; }
    if (o.locked && !st.unlockedDoors.has(o.id)) {
      p.keys--; st.unlockedDoors.add(o.id);
      emit(st, "unlock", { id: o.id, by: p.id });
    }
    st.openDoors.add(o.id); emit(st, "door", { id: o.id, open: true, by: p.id });
    return true;
  }
  if (o.kind === "chest") {
    st.openedChests.add(o.id);
    const boundKey = objsAt(st.d, p.f, o.x, o.z).find((k) => k.kind === "key" && !st.takenItems.has(k.id));
    const items = rollLoot(st.d, o.id, st.runSeed, boundKey);
    if (boundKey) st.takenItems.add(boundKey.id);
    for (const it of items) grantLoot(st, p, it);
    emit(st, "chest", { id: o.id, by: p.id, items });
    return true;
  }
  if (o.kind === "key") {
    st.takenItems.add(o.id);
    p.keys++;
    emit(st, "keyTake", { id: o.id, by: p.id, dropped: !!o.dropped });
    return true;
  }
  return false;
}

/** The merchant NPC nearest to a player (adjacent cell), or null. */
export function nearestMerchant(st, p) {
  const cx = w2c(p.x), cz = w2c(p.z);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const o of objsAt(st.d, p.f, cx + dx, cz + dz)) {
      if (o.kind === "npc") {
        const dist = Math.hypot(c2w(o.x) - p.x, c2w(o.z) - p.z);
        if (dist < 4.6) return o;
      }
    }
  }
  return null;
}

/** What a given NPC sells (merchant honours its editable stock; others fixed). */
export function npcSells(o) {
  const T = NPC_TYPES[(o && o.ntype) || "merchant"] || NPC_TYPES.merchant;
  if (T.sells) return T.sells.filter((s) => SHOP[s]);
  return (o && o.stock && o.stock.length) ? o.stock.filter((s) => SHOP[s]) : SHOP_IDS.slice();
}
export function npcPrice(o, itemId) {
  const T = NPC_TYPES[(o && o.ntype) || "merchant"] || NPC_TYPES.merchant;
  return Math.round(((SHOP[itemId] || {}).price || 0) * (T.discount || 1));
}

/** Buy from a merchant/blacksmith: checks gold, deducts (with the NPC's
 *  discount), grants. Returns result. */
export function buyItem(st, p, itemId, npc) {
  const S = SHOP[itemId];
  if (!S) return { ok: false, err: "noitem" };
  // tier caps: can't buy past III
  if (itemId === "weapon" && (p.weaponTier || 0) >= 3) return { ok: false, err: "maxed" };
  if (itemId === "armor" && (p.armorTier || 0) >= 3) return { ok: false, err: "maxed" };
  const price = npcPrice(npc, itemId);
  if (p.gold < price) return { ok: false, err: "poor" };
  p.gold -= price;
  // weapon/armor are tier UPGRADES (+1 from current); others are a plain grant
  if (itemId === "weapon") grantLoot(st, p, { kind: "weapon", tier: (p.weaponTier || 0) + 1 });
  else if (itemId === "armor") grantLoot(st, p, { kind: "armor", tier: (p.armorTier || 0) + 1 });
  else grantLoot(st, p, { kind: itemId, n: 1 });
  emit(st, "bought", { id: p.id, item: itemId, price });
  return { ok: true, gold: p.gold };
}

/** Sage NPC: one-time blessing per run (grants +max HP and a full heal). */
export function blessPlayer(st, p, npc) {
  const T = NPC_TYPES[npc && npc.ntype];
  if (!T || !T.blessing) return { ok: false, err: "notype" };
  st.usedNpcs = st.usedNpcs || {};
  if (st.usedNpcs[npc.id]) return { ok: false, err: "used" };
  st.usedNpcs[npc.id] = true;
  const b = T.blessing;
  if (b.maxHp) { p.blessHp = (p.blessHp || 0) + b.maxHp; recomputeMaxHp(p); p.hp = p.maxHp; }
  emit(st, "blessed", { id: p.id, npc: npc.id, maxHp: b.maxHp || 0 });
  return { ok: true };
}

/** maxHp = base + Sage blessing + gear affixes; keeps hp in range. */
function recomputeMaxHp(p) {
  p.maxHp = (p.baseMaxHp || 100) + (p.blessHp || 0) + (p.gearMaxHp || 0);
  if (p.hp > p.maxHp) p.hp = p.maxHp;
}
/** Derive weaponTier/armorTier + affix bonuses from the equipped items. */
export function recomputeGear(p) {
  p.weaponTier = p.equipped.weapon ? p.equipped.weapon.tier : 0;
  p.armorTier = p.equipped.armor ? p.equipped.armor.tier : 0;
  let dmg = 0, hp = 0;
  for (const slot of ["weapon", "armor"]) {
    const it = p.equipped[slot];
    if (it) for (const a of it.affixes) { if (a.stat === "dmg") dmg += a.val; else if (a.stat === "maxHp") hp += a.val; }
  }
  p.gearDmg = dmg / 100;   // % damage bonus (multiplier)
  p.gearMaxHp = hp;        // flat max-HP bonus
  recomputeMaxHp(p);
}
/** Equip an item if it out-scores the current one; else bank it in inventory. */
function equipItem(st, p, item) {
  const slot = item.slot, cur = p.equipped[slot];
  if (itemScore(item) > itemScore(cur)) {
    if (cur) p.inventory.push(cur);
    p.equipped[slot] = item;
    recomputeGear(p);
    emit(st, "equip", { id: p.id, slot, tier: item.tier, item });
    return true;
  }
  p.inventory.push(item);
  emit(st, "loot", { id: p.id, item });
  return false;
}

export function grantLoot(st, p, it) {
  if (it.kind === "gold") p.gold += it.n || 10;
  else if (it.kind === "potion") p.potions++;
  else if (it.kind === "mana") p.manaPots = (p.manaPots || 0) + 1; // stored, drink with X
  else if (it.kind === "charm") p.charms++;
  else if (it.kind === "key") p.keys++;
  else if (it.kind === "weapon" || it.kind === "armor") {
    // chest loot ships a pre-rolled item; shop/buy has none, so roll one deterministically
    const item = it.item || makeItem(it.kind, it.tier | 0, mulberry(((st.runSeed || 0) ^ ((st.itemSeq = (st.itemSeq || 0) + 1) * 2654435761)) >>> 0));
    equipItem(st, p, item);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// combat
// ─────────────────────────────────────────────────────────────────────────────

/** Hit an explosive barrel — enough damage and it goes off. */
export function damageBarrel(st, b, dmg, byId) {
  if (!b || !b.alive) return;
  b.hp -= dmg;
  if (b.hp <= 0) explodeBarrel(st, b, byId);
}

/** BOOM: AoE hurts enemies AND players (friendly fire!), chains to nearby barrels. */
export function explodeBarrel(st, b, byId) {
  if (!b.alive) return;
  b.alive = false;
  st.brokenDecor.add(b.src);                     // the decor object is gone for good
  emit(st, "boom", { id: b.id, src: b.src, by: byId, f: b.f, x: b.x, z: b.z });
  const R = BARREL.boomR;
  for (const p of st.players) {
    if (!p.alive || p.escaped || p.f !== b.f) continue;
    const d2 = Math.hypot(p.x - b.x, p.z - b.z);
    if (d2 < R) damagePlayer(st, p, BARREL.boomDmgP * (1 - 0.6 * d2 / R), "explosion", { x: b.x, z: b.z });
  }
  for (const e of st.enemies) {
    if (!e.alive || e.f !== b.f) continue;
    const d2 = Math.hypot(e.x - b.x, e.z - b.z);
    if (d2 < R) damageEnemy(st, e, BARREL.boomDmgE * (1 - 0.6 * d2 / R), byId, "fire");
  }
  for (const nb of st.barrels) {                 // chain reaction
    if (!nb.alive || nb.f !== b.f) continue;
    if (Math.hypot(nb.x - b.x, nb.z - b.z) < R) damageBarrel(st, nb, 999, byId);
  }
}

export function damageEnemy(st, e, dmg, byId, elem) {
  if (!e.alive) return;
  e.hp -= dmg; e.hurtT = 0.25;
  emit(st, "ehit", { id: e.id, hp: e.hp, by: byId, dmg, elem });
  if (e.hp <= 0) {
    e.alive = false;
    if (e.key) { e.droppedKey = e.key; e.key = null; }
    const p = st.players.find((pl) => pl.id === byId);
    if (p) { p.gold += e.K.gold; gainXp(st, p, xpFromEnemy(e.K)); }
    emit(st, "edied", { id: e.id, by: byId, key: e.droppedKey, gold: e.K.gold, xp: xpFromEnemy(e.K), x: e.x, z: e.z, f: e.f });
    return;
  }
  // Retaliate: any hit aggros the enemy onto its attacker — even a projectile
  // from across the room or a sneak strike with no line of sight. This is what
  // makes ranged pokes and stealth openers actually provoke the enemy.
  if (byId && st.players.some((pl) => pl.id === byId && pl.alive)) {
    if (e.state !== "chase") emit(st, "aggro", { id: e.id });
    e.state = "chase"; e.target = byId; e.repathT = 0;
  }
}

export function damagePlayer(st, p, dmg, src, srcPos) {
  if (!p.alive || p.escaped || st.over) return;
  if (p.hurtT > 0) return;                 // brief i-frames
  dmg = dmg * (1 - 0.1 * (p.armorTier || 0)); // found armor soaks 10%/tier
  // Knight shield: blocks a chunk of damage arriving inside the frontal arc
  const cls = CLASSES[p.cls];
  if (cls && cls.shield && srcPos) {
    const ang = Math.atan2(srcPos.x - p.x, srcPos.z - p.z);
    let dd = ang - p.yaw;
    while (dd > Math.PI) dd -= Math.PI * 2;
    while (dd < -Math.PI) dd += Math.PI * 2;
    if (Math.abs(dd) <= cls.shield.frontArc) { dmg *= (1 - cls.shield.reduce); emit(st, "blocked", { id: p.id }); }
  }
  dmg = Math.round(dmg);
  p.hp -= dmg; p.hurtT = 0.45;
  emit(st, "phit", { id: p.id, hp: p.hp, dmg, src });
  if (p.hp <= 0) {
    p.alive = false; p.deaths++; p.respawnT = PLAYER.respawnS;
    emit(st, "pdied", { id: p.id, src });
  }
}

function meleeHits(st, p, range, arc) {
  const out = [];
  for (const e of st.enemies) {
    if (!e.alive || e.f !== p.f) continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range + 0.4) continue;
    const ang = Math.atan2(dx, dz);
    let dd = ang - p.yaw;
    while (dd > Math.PI) dd -= Math.PI * 2;
    while (dd < -Math.PI) dd += Math.PI * 2;
    if (Math.abs(dd) <= arc / 2 + 0.25) out.push(e);
  }
  return out;
}

/** Apply/refresh an elemental status on an enemy (host/solo authority applies
 *  the DoT; everyone plays the FX via the estatus event). */
export function applyStatus(st, e, kind, cfg, byId) {
  e.status = e.status || {};
  if (kind === "poison") {
    const cur = e.status.poison;
    e.status.poison = { t: cfg.dur, dps: cfg.dps, by: byId, stacks: Math.min(cfg.maxStacks || 3, (cur ? cur.stacks : 0) + 1), acc: cur ? cur.acc : 0 };
  } else if (kind === "burn") {
    e.status.burn = { t: cfg.dur, dps: cfg.dps, by: byId, acc: (e.status.burn && e.status.burn.acc) || 0 };
  } else if (kind === "frost") {
    e.status.frost = { t: cfg.dur, mul: cfg.mul };
  }
  emit(st, "estatus", { id: e.id, kind, dur: cfg.dur });
}

/** 3-hit combo melee: hold LMB to chain 1 → 2 → finisher. */
/** Smash a breakable decor: mark it broken, drop a little gold, emit the event. */
function breakDecor(st, o, f, byId) {
  if (st.brokenDecor.has(o.id)) return;
  st.brokenDecor.add(o.id);
  const gold = 3 + (hashStr(o.id + "g") % 6); // 3–8 gold, deterministic per prop (MP-safe)
  const pl = st.players.find((x) => x.id === byId);
  if (pl) pl.gold += gold;
  emit(st, "decorBreak", { id: o.id, x: c2w(o.x), z: c2w(o.z), f, dtype: o.dtype, gold, by: byId });
}
/** Break any breakable decor within `range` of the player (melee smash). */
function breakDecorInRange(st, p, range, byId) {
  const fl = st.d.floors[p.f]; if (!fl) return;
  const r2 = (range + 1.3) ** 2;
  for (const o of fl.objects) {
    if (o.kind !== "decor" || !BREAKABLE_DECOR.has(o.dtype) || st.brokenDecor.has(o.id)) continue;
    if ((c2w(o.x) - p.x) ** 2 + (c2w(o.z) - p.z) ** 2 <= r2) breakDecor(st, o, p.f, byId);
  }
}

function playerMelee(st, p) {
  if (p.meleeT > 0 || p.stunT > 0) return;
  const cls = CLASSES[p.cls] || CLASSES.knight;
  // Sorceress NORMAL attack (LMB) = shooting an ARCANE BOLT, not a staff swing
  // (owner spec). Free (no mana), quick cooldown — her bread-and-butter ranged poke.
  if (p.cls === "sorceress") {
    p.meleeT = PLAYER.boltCd;
    const vx = Math.sin(p.yaw), vz = Math.cos(p.yaw);
    st.bolts.push({
      id: "b" + st.nextBolt++, owner: p.id, f: p.f, elem: "arcane",
      x: p.x + vx * 0.6, z: p.z + vz * 0.6, vx: vx * PLAYER.boltSpeed, vz: vz * PLAYER.boltSpeed,
      ttl: 1.4, dmg: PLAYER.boltDmg * combatMul(p),
    });
    emit(st, "cast", { id: p.id, kind: "arcane" });
    return;
  }
  const M = cls.melee;
  // chain bookkeeping: continue if the last swing was recent, else restart
  p.combo = (st.time - p.comboT) < (M.cd + COMBO_WINDOW) ? (p.combo % 3) + 1 : 1;
  p.comboT = st.time;
  p.meleeT = M.cd * (p.combo === 3 ? 1.25 : 1); // finisher recovers a touch slower
  emit(st, "swing", { id: p.id, stage: p.combo });
  const dmg = M.dmg[p.combo - 1] * combatMul(p);
  for (const e of meleeHits(st, p, M.range, M.arc)) {
    damageEnemy(st, e, dmg, p.id);
    if (M.poison && e.alive) applyStatus(st, e, "poison", M.poison, p.id);
  }
  breakDecorInRange(st, p, M.range, p.id); // smash nearby crates/pots
  // whacking an explosive barrel sets it off
  for (const b of st.barrels) {
    if (!b.alive || b.f !== p.f) continue;
    if (Math.hypot(b.x - p.x, b.z - p.z) <= M.range + BARREL.radius) damageBarrel(st, b, dmg, p.id);
  }
}

/** RMB class special: bash (stun), crush (heavy), fire bolt, poison knife. */
function playerSpecial(st, p) {
  if (p.specialT > 0 || p.stunT > 0) return;
  const cls = CLASSES[p.cls] || CLASSES.knight;
  const S = cls.special;
  if (!S) return;
  if (S.kind === "bash") {
    p.specialT = S.cd;
    emit(st, "bash", { id: p.id });
    for (const e of meleeHits(st, p, S.range, 1.9)) {
      damageEnemy(st, e, S.dmg, p.id);
      if (e.alive) { e.stunT = S.stun; emit(st, "estatus", { id: e.id, kind: "stun", dur: S.stun }); }
    }
    return;
  }
  if (S.kind === "crush") {
    p.specialT = S.cd;
    emit(st, "crush", { id: p.id });
    const dmg = cls.melee.dmg[2] * S.dmgMul * 0.6 * combatMul(p);
    for (const e of meleeHits(st, p, S.range, 2.6)) damageEnemy(st, e, dmg, p.id);
    return;
  }
  if (S.kind === "fire" || S.kind === "knife") {
    if (S.mana && p.mana < S.mana) return;
    p.specialT = S.cd;
    if (S.mana) p.mana -= S.mana;
    const vx = Math.sin(p.yaw), vz = Math.cos(p.yaw);
    st.bolts.push({
      id: "b" + st.nextBolt++, owner: p.id, f: p.f, elem: S.kind === "fire" ? "fire" : "knife",
      x: p.x + vx * 0.6, z: p.z + vz * 0.6, vx: vx * S.speed, vz: vz * S.speed,
      ttl: 1.5, dmg: S.dmg * combatMul(p),
      status: S.kind === "fire" ? { kind: "burn", cfg: S.burn } : { kind: "poison", cfg: S.poison },
    });
    emit(st, "cast", { id: p.id, kind: S.kind });
    return;
  }
}

/** R: the Sorceress frost bolt. */
function playerFrost(st, p) {
  const cls = CLASSES[p.cls] || CLASSES.knight;
  if (!cls.frost || p.frostT > 0 || p.stunT > 0) return;
  const F = cls.frost;
  if (p.mana < F.mana) return;
  p.frostT = F.cd;
  p.mana -= F.mana;
  const vx = Math.sin(p.yaw), vz = Math.cos(p.yaw);
  st.bolts.push({
    id: "b" + st.nextBolt++, owner: p.id, f: p.f, elem: "frost",
    x: p.x + vx * 0.6, z: p.z + vz * 0.6, vx: vx * F.speed, vz: vz * F.speed,
    ttl: 1.5, dmg: F.dmg * combatMul(p),
    status: { kind: "frost", cfg: F.slow },
  });
  emit(st, "cast", { id: p.id, kind: "frost" });
}

/** C: Sorceress chain lightning — arcs to up to 3 nearby enemies (−20%/jump) + micro-stun. */
function castChain(st, p) {
  if (p.cls !== "sorceress" || (p.chainT || 0) > 0 || p.stunT > 0 || p.mana < 22) return;
  const R2 = 9 * 9;   // range increased 6.5 → 9 (owner request)
  const cand = st.enemies.filter((e) => e.alive && e.f === p.f && ((e.x - p.x) ** 2 + (e.z - p.z) ** 2) <= R2)
    .sort((a, b) => ((a.x - p.x) ** 2 + (a.z - p.z) ** 2) - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2))
    .slice(0, 3);
  if (!cand.length) return;
  p.chainT = 3; p.mana -= 22;
  const base = 22 * combatMul(p);
  const pts = [{ x: p.x, z: p.z, f: p.f }];
  cand.forEach((e, i) => {
    damageEnemy(st, e, base * Math.pow(0.8, i), p.id, "lightning");
    if (e.alive) { e.stunT = Math.max(e.stunT || 0, 0.3); emit(st, "estatus", { id: e.id, kind: "stun", dur: 0.3 }); }
    pts.push({ x: e.x, z: e.z, f: e.f });
  });
  emit(st, "chain", { id: p.id, pts, elem: "arc" });
}

/** The player's action hotbar (ordered) — shared by the HUD (render) and the
 *  escape input (Digit1-N routing). Each slot: {act, icon, label, key, cd, max, count}. */
export function hotbar(p) {
  // The NORMAL attack lives on LMB (melee; sorceress = arcane bolt) and is NOT a
  // hotbar slot (owner spec). Slots are class abilities + consumables:
  // sorceress → 1 Fireball · 2 Frost · 3 Chain · 4 Health pot · 5 Mana pot.
  const cls = CLASSES[p.cls] || CLASSES.knight;
  const k = cls.special && cls.special.kind;
  const sName = { bash: "Shield Bash", crush: "Crush", fire: "Fireball", knife: "Poison Knife" }[k] || "Special";
  const sIcon = { bash: "🛡", crush: "💥", fire: "🔥", knife: "🗡️" }[k] || "✦";
  const slots = [
    { act: "special", icon: sIcon, label: sName, key: "RMB", cd: p.specialT || 0, max: cls.special ? cls.special.cd : 1 },
  ];
  if (cls.frost) slots.push({ act: "frost", icon: "❄️", label: "Frost Shard", key: "R", cd: p.frostT || 0, max: cls.frost.cd });
  if (p.cls === "sorceress") slots.push({ act: "chain", icon: "⚡", label: "Chain Lightning", key: "C", cd: p.chainT || 0, max: 3 });
  slots.push({ act: "potion", icon: "🧪", label: "Health Potion", key: "Q", count: p.potions });
  slots.push({ act: "mana",   icon: "🔷", label: "Mana Potion",   key: "X", count: p.manaPots || 0 });
  return slots;
}


// ─────────────────────────────────────────────────────────────────────────────
// enemy AI
// ─────────────────────────────────────────────────────────────────────────────

function stepEnemy(st, e, dt, rnd, simEnemies) {
  if (!e.alive) return;
  if (!simEnemies) return; // MP guest: enemies are net-fed
  const K = e.K;
  e.atkT = Math.max(0, e.atkT - dt);
  e.hurtT = Math.max(0, e.hurtT - dt);
  // elemental statuses: burn/poison DoT (half-second ticks), frost timer, stun
  if (e.status) {
    for (const kind of ["burn", "poison"]) {
      const s = e.status[kind];
      if (!s) continue;
      s.t -= dt;
      s.acc = (s.acc || 0) + dt;
      if (s.acc >= 0.5) {
        s.acc -= 0.5;
        const mult = kind === "poison" ? (s.stacks || 1) : 1;
        damageEnemy(st, e, s.dps * 0.5 * mult, s.by, kind);
        if (!e.alive) return;
      }
      if (s.t <= 0) delete e.status[kind];
    }
    if (e.status.frost) { e.status.frost.t -= dt; if (e.status.frost.t <= 0) delete e.status.frost; }
  }
  if (e.stunT > 0) { e.stunT -= dt; return; } // stunned: no thinking, no moving

  // pick target: nearest alive player on my floor with LOS or close
  let target = null, tDist = Infinity;
  for (const p of st.players) {
    if (!p.alive || p.escaped || p.f !== e.f) continue;
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    if (dist < tDist) { tDist = dist; target = p; }
  }
  const seesTarget = target && (tDist < 4.6 || (tDist < K.aggro && hasLOS(st, e.f, e.x, e.z, target.x, target.z)));

  if (e.state === "patrol") {
    e.patrolT -= dt;
    if (seesTarget) { e.state = "chase"; e.target = target.id; emit(st, "aggro", { id: e.id }); }
    else if (!K.static) {
      if (e.patrolT <= 0) {
        e.patrolT = 1.6 + rnd() * 2.4;
        const ang = rnd() * Math.PI * 2;
        e.wander = { x: e.home.x + Math.sin(ang) * CELL * 1.4, z: e.home.z + Math.cos(ang) * CELL * 1.4 };
      }
      if (e.wander) walkToward(st, e, e.wander.x, e.wander.z, K.speed * 0.45, dt);
    }
    return;
  }
  if (e.state === "chase") {
    if (!target || !target.alive || target.f !== e.f) { e.state = "patrol"; e.path = null; return; }
    const distHome = Math.hypot(e.x - e.home.x, e.z - e.home.z);
    if (tDist > K.aggro * 2.2 || distHome > CELL * 12) { e.state = "patrol"; e.path = null; return; }

    if (K.ranged) {
      // turret: aim + shoot when LOS
      if (tDist < K.atkR && hasLOS(st, e.f, e.x, e.z, target.x, target.z)) {
        e.yaw = Math.atan2(target.x - e.x, target.z - e.z);
        if (e.atkT <= 0) {
          e.atkT = K.cd;
          const vx = (target.x - e.x) / tDist, vz = (target.z - e.z) / tDist;
          const bid = "b" + st.nextBolt++;
          st.bolts.push({ id: bid, owner: e.id, hostile: true, f: e.f, x: e.x + vx * 0.7, z: e.z + vz * 0.7, vx: vx * 10, vz: vz * 10, ttl: 1.6, dmg: K.dmg });
          // carries the bolt so MP guests can spawn the visual locally
          emit(st, "eshoot", { id: e.id, bid, f: e.f, x: e.x + vx * 0.7, z: e.z + vz * 0.7, vx: vx * 10, vz: vz * 10 });
        }
      }
      return;
    }

    if (tDist <= K.atkR) {
      e.yaw = Math.atan2(target.x - e.x, target.z - e.z);
      if (e.atkT <= 0) { e.atkT = K.cd; emit(st, "eattack", { id: e.id }); damagePlayer(st, target, K.dmg * (0.9 + 0.1 * (st.d.difficulty || 1)), e.etype, { x: e.x, z: e.z }); }
      return;
    }
    // path toward target (repath at 3Hz or on arrival)
    e.repathT -= dt;
    if (!e.path || e.repathT <= 0) { e.path = findPath(st, e.f, e.x, e.z, target.x, target.z); e.repathT = 0.34; }
    if (e.path && e.path.length) {
      const wp = e.path[0];
      if (Math.hypot(wp.x - e.x, wp.z - e.z) < 0.5) e.path.shift();
      else walkToward(st, e, wp.x, wp.z, K.speed, dt);
      if (!e.path.length) walkToward(st, e, target.x, target.z, K.speed, dt);
    } else {
      walkToward(st, e, target.x, target.z, K.speed, dt); // straight-line fallback
    }
  }
}

function walkToward(st, e, tx, tz, speed, dt) {
  const dx = tx - e.x, dz = tz - e.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return;
  if (cellType(st.d, e.f, w2c(e.x), w2c(e.z)) === CT.WATER && !e.K.fly) speed *= WATER_SLOW;
  if (e.status && e.status.frost) speed *= e.status.frost.mul;
  const mx = (dx / dist) * speed * dt, mz = (dz / dist) * speed * dt;
  const r = moveCircle(st, e.f, e.x, e.z, mx, mz, 0.42, true);
  e.x = r.x; e.z = r.z;
  e.yaw = Math.atan2(dx, dz);
  e.moving = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// main tick
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advance the run. opts: { simEnemies: bool (host/solo), localIds: Set —
 * players whose input we integrate (others are position-fed via netFeed) }.
 */
export function tick(st, dt, opts = {}) {
  if (st.over) return;
  dt = Math.min(dt, 0.1);
  st.time += dt;
  const rnd = mulberry((st.runSeed ^ Math.floor(st.time * 37)) >>> 0);
  const simEnemies = opts.simEnemies !== false;

  // players
  for (const p of st.players) {
    p.meleeT = Math.max(0, p.meleeT - dt);
    p.boltT = Math.max(0, p.boltT - dt);
    p.specialT = Math.max(0, p.specialT - dt);
    p.frostT = Math.max(0, p.frostT - dt);
    p.chainT = Math.max(0, (p.chainT || 0) - dt);
    p.stunT = Math.max(0, (p.stunT || 0) - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.mana = Math.min(PLAYER.mana, p.mana + PLAYER.manaRegen * dt);

    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        p.alive = true; p.hp = Math.round((p.maxHp || PLAYER.hp) * 0.6);
        p.f = st.spawn.f; p.x = c2w(st.spawn.x); p.z = c2w(st.spawn.z); p.climb = null; p.stairLock = null;
        emit(st, "respawn", { id: p.id });
      }
      continue;
    }
    if (p.escaped) continue;
    if (opts.localIds && !opts.localIds.has(p.id)) continue; // net-fed

    // stairs climb tween (sim-side: instant floor switch at half point)
    if (p.climb) {
      p.climb.t += dt / 0.6;
      const k = Math.min(1, p.climb.t);
      p.x = p.climb.fx + (p.climb.tx - p.climb.fx) * k;
      p.z = p.climb.fz + (p.climb.tz - p.climb.fz) * k;
      if (k >= 0.5 && p.f !== p.climb.tf) { p.f = p.climb.tf; emit(st, "floor", { id: p.id, f: p.f }); }
      if (k >= 1) p.climb = null;
      continue;
    }

    p.yaw = p.input.yaw;
    const ctHere = cellType(st.d, p.f, w2c(p.x), w2c(p.z));
    let sp = p.input.sprint ? PLAYER.sprint : PLAYER.speed;
    if (ctHere === CT.WATER) sp *= WATER_SLOW;         // wading is slow
    let mx = p.input.mx, mz = p.input.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-4) {
      mx = (mx / ml) * sp * dt; mz = (mz / ml) * sp * dt;
      const r = moveCircle(st, p.f, p.x, p.z, mx, mz, PLAYER.radius, false);
      p.x = r.x; p.z = r.z;
      p.stepAcc += Math.hypot(mx, mz);
      if (p.stepAcc > 2.2) { p.stepAcc = 0; emit(st, "step", { id: p.id, wet: ctHere === CT.WATER }); }
      // shove explosive barrels you walk into (the barbarian bullies them hardest)
      const pushMul = p.cls === "barbarian" ? 2.1 : 1.0;
      for (const b of st.barrels) {
        if (!b.alive || b.f !== p.f) continue;
        const dx = b.x - p.x, dz = b.z - p.z;
        const dist = Math.hypot(dx, dz), overlap = (PLAYER.radius + BARREL.radius) - dist;
        if (overlap <= 0 || dist < 1e-4) continue;
        const nx = b.x + (dx / dist) * overlap * pushMul, nz = b.z + (dz / dist) * overlap * pushMul;
        if (!cellBlocked(st, b.f, w2c(nx), w2c(nz), false)) { b.x = nx; b.z = nz; b.moved = true; }
      }
    }
    // LAVA burns anyone standing in it (the 0.45s i-frame gate paces the DoT)
    if (ctHere === CT.LAVA) damagePlayer(st, p, LAVA_DPS.dmg, "lava");

    // stairs: BIDIRECTIONAL — stepping onto EITHER end transports you to the
    // other, no key needed. Anti-bounce: the cell you just arrived at is locked
    // until you step off it, so you don't ping-pong (climb up → land → the
    // landing sends you back down → …). Both ends are walk-triggered because the
    // landing renders its own down-stair marker, so it reads as a staircase too.
    const cx = w2c(p.x), cz = w2c(p.z);
    const hereKey = p.f + "," + cx + "," + cz;
    if (p.stairLock && p.stairLock !== hereKey) p.stairLock = null;  // stepped off → re-arm
    // pressing interact on a stair endpoint always transports, even while the
    // anti-bounce lock is held — the manual escape hatch so a player on a
    // dead-end landing (walled-in alcove) can never be permanently soft-locked.
    if (!p.stairLock || p.input.interactDown) {
      for (const L of st.stairs) {
        const onFrom = L.from.f === p.f && L.from.x === cx && L.from.z === cz;
        const onTo = L.to.f === p.f && L.to.x === cx && L.to.z === cz;
        if (!onFrom && !onTo) continue;
        const dst = onFrom ? L.to : L.from;
        p.climb = { t: 0, fx: p.x, fz: p.z, tx: c2w(dst.x), tz: c2w(dst.z), tf: dst.f, up: onFrom };
        p.stairLock = dst.f + "," + dst.x + "," + dst.z;   // don't re-trigger on arrival
        emit(st, "climb", { id: p.id, up: onFrom });
        break;
      }
    }

    if (p.input.melee) playerMelee(st, p);
    if (p.input.special || p.input.bolt) playerSpecial(st, p);   // RMB (bolt kept as alias)
    if (p.input.frost) playerFrost(st, p);                        // R — sorceress only
    if (p.input.chain) castChain(st, p);                          // C — sorceress chain lightning
    if (p.input.interactDown) { doInteract(st, p); }
    const maxHp = p.maxHp || PLAYER.hp;
    if (p.input.potionDown && p.potions > 0 && p.hp < maxHp) {
      p.potions--; p.hp = Math.min(maxHp, p.hp + PLAYER.potionHeal); // heal up to maxHp (Sage blessing counts)
      emit(st, "potion", { id: p.id, hp: p.hp });
    }
    if (p.input.manaDown && (p.manaPots || 0) > 0 && p.mana < PLAYER.mana) {
      p.manaPots--; p.mana = Math.min(PLAYER.mana, p.mana + PLAYER.manaPotRestore);
      emit(st, "manapot", { id: p.id, mana: p.mana });
    }
    p.input.interactDown = false; p.input.potionDown = false; p.input.manaDown = false;

    // exit portal
    if (p.f === st.exit.f && cx === st.exit.x && cz === st.exit.z) {
      p.escaped = true;
      emit(st, "escape", { id: p.id, t: st.time });
    }
  }

  // enemies
  for (const e of st.enemies) stepEnemy(st, e, dt, rnd, simEnemies);

  // bolts
  for (const b of st.bolts) {
    b.ttl -= dt;
    const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
    // player bolts smash breakable decor they fly into (host-authoritative)
    if (!b.hostile && simEnemies) {
      const bcx = w2c(nx), bcz = w2c(nz), bfl = st.d.floors[b.f];
      if (bfl) for (const o of bfl.objects) {
        if (o.kind === "decor" && o.x === bcx && o.z === bcz && BREAKABLE_DECOR.has(o.dtype) && !st.brokenDecor.has(o.id)) {
          breakDecor(st, o, b.f, b.owner); b.ttl = 0; emit(st, "boltHit", { x: nx, z: nz, f: b.f }); break;
        }
      }
      if (b.ttl <= 0) continue;
    }
    if (cellBlocked(st, b.f, w2c(nx), w2c(nz), false) || doorAxisBlocks(st, b.f, w2c(b.x), w2c(b.z), w2c(nx), w2c(nz))) { b.ttl = 0; emit(st, "boltHit", { x: b.x, z: b.z, f: b.f, wall: true }); continue; }
    b.x = nx; b.z = nz;
    // any projectile detonates explosive barrels — spells, javelins, enemy plasma
    if (simEnemies) for (const brl of st.barrels) {
      if (!brl.alive || brl.f !== b.f) continue;
      if (Math.hypot(brl.x - b.x, brl.z - b.z) < BARREL.radius + 0.25) {
        damageBarrel(st, brl, Math.max(b.dmg, BARREL.hp), b.hostile ? null : b.owner);
        b.ttl = 0; emit(st, "boltHit", { x: b.x, z: b.z, f: b.f, elem: b.elem }); break;
      }
    }
    if (b.ttl <= 0) continue;
    if (b.hostile) {
      // hostile-bolt damage is HOST authority (guests' copies are visual-only;
      // victims receive the relayed phit and apply it to themselves)
      if (simEnemies) for (const p of st.players) {
        if (!p.alive || p.escaped || p.f !== b.f) continue;
        if (Math.hypot(p.x - b.x, p.z - b.z) < 0.55) { damagePlayer(st, p, b.dmg, "bolt", { x: b.x - b.vx * 0.1, z: b.z - b.vz * 0.1 }); b.ttl = 0; break; }
      }
      // TRAP projectiles (javelins) skewer enemies too — lure a foe into the line of fire
      if (b.trap && b.ttl > 0 && simEnemies) for (const e of st.enemies) {
        if (!e.alive || e.f !== b.f) continue;
        if (Math.hypot(e.x - b.x, e.z - b.z) < 0.7) { damageEnemy(st, e, b.dmg, null); b.ttl = 0; emit(st, "boltHit", { x: b.x, z: b.z, f: b.f, elem: b.elem }); break; }
      }
    } else if (simEnemies) {
      for (const e of st.enemies) {
        if (!e.alive || e.f !== b.f) continue;
        if (Math.hypot(e.x - b.x, e.z - b.z) < 0.7) {
          damageEnemy(st, e, b.dmg, b.owner);
          if (b.status && e.alive) applyStatus(st, e, b.status.kind, b.status.cfg, b.owner);
          b.ttl = 0; emit(st, "boltHit", { x: b.x, z: b.z, f: b.f, elem: b.elem }); break;
        }
      }
    }
  }
  st.bolts = st.bolts.filter((b) => b.ttl > 0);

  // traps — periodic (spikes/vent/firejet), tripwire (javelin), secret pit
  st._trng = st._trng || mulberry((st.runSeed ^ 0xb00b1e5) >>> 0);
  const localPlayers = st.players.filter((p) => p.alive && !p.escaped && (!opts.localIds || opts.localIds.has(p.id)));
  for (const t of st.traps) {
    const K = TRAPK[t.ttype] || TRAPK.spikes;
    if (t.ttype === "javelin") {
      // tripwire: stepping on the cell looses a javelin down the facing dir
      t.cd = Math.max(0, (t.cd || 0) - dt);
      if (t.cd <= 0) {
        const tripper = localPlayers.find((p) => p.f === t.f && w2c(p.x) === t.x && w2c(p.z) === t.z);
        if (tripper) {
          t.cd = K.cooldown;
          const [dx, dz] = TRAP_DIR[(t.rot || 0) % 4];
          // launch a step AHEAD of the plate: the tripper feels the whoosh but the
          // dart flies on across the room (and skewers whatever stands in the line)
          st.bolts.push({
            id: "b" + st.nextBolt++, owner: "trap:" + t.id, hostile: true, trap: true, f: t.f, elem: "javelin",
            x: c2w(t.x) + dx * 0.8, z: c2w(t.z) + dz * 0.8, vx: dx * K.speed, vz: dz * K.speed, ttl: 2.2, dmg: K.dmg,
          });
          emit(st, "javelin", { id: t.id, f: t.f, x: c2w(t.x), z: c2w(t.z), rot: t.rot || 0 });
        }
      }
      continue;
    }
    if (t.ttype === "pit") {
      if (t.open) {
        // anything standing on an open pit falls in — players die, enemies too
        // (a JUMPing player clears the hole — airborne skips the plunge)
        for (const p of localPlayers) if (p.f === t.f && w2c(p.x) === t.x && w2c(p.z) === t.z && !p.airborne) {
          p.hurtT = 0;                       // a pit ignores hit i-frames
          emit(st, "fell", { id: p.id, trap: t.id });
          damagePlayer(st, p, 9999, "pit");
        }
        if (opts.simEnemies !== false) for (const e of st.enemies) {
          if (e.alive && e.f === t.f && w2c(e.x) === t.x && w2c(e.z) === t.z) { emit(st, "fell", { id: e.id, trap: t.id }); damageEnemy(st, e, 9999, null); }
        }
      } else if (t.armT > 0) {
        t.armT -= dt;
        if (t.armT <= 0) { t.open = true; emit(st, "pitOpen", { id: t.id, f: t.f, x: t.x, z: t.z }); }
      } else {
        // a secret tile: the first footstep starts the collapse (a jump won't trip it)
        if (localPlayers.some((p) => p.f === t.f && w2c(p.x) === t.x && w2c(p.z) === t.z && !p.airborne)) { t.armT = K.arm; emit(st, "pitWarn", { id: t.id, f: t.f, x: t.x, z: t.z }); }
      }
      continue;
    }
    // periodic traps: spikes / vent / firejet
    t.phase = (t.phase + dt);
    const period = t.period || K.period;
    if (t.phase >= period) {
      t.phase %= period;
      // owner spec: spikes pop at RANDOM intervals — re-roll each cycle
      if (K.jitter) t.period = K.period + st._trng() * K.jitter;
    }
    const activeFrom = (t.period || K.period) - K.active;
    t.state = t.phase >= activeFrom ? "on" : (t.phase >= activeFrom - K.warn ? "warn" : "off");
    if (t.state === "on") {
      // firejet burns a CONE of cells down its facing dir; others hit their own cell
      const cells = [[t.x, t.z]];
      if (t.ttype === "firejet") {
        const [dx, dz] = TRAP_DIR[(t.rot || 0) % 4];
        for (let i = 1; i < (K.reach || 1); i++) cells.push([t.x + dx * i, t.z + dz * i]);
      }
      for (const p of localPlayers) {
        if (p.f !== t.f) continue;
        // spikes/vent erupt from the FLOOR — a jump clears them; firejet is a wall
        // trap at body height, so airborne players still get scorched.
        if (p.airborne && (t.ttype === "spikes" || t.ttype === "vent")) continue;
        if (cells.some(([cx, cz]) => w2c(p.x) === cx && w2c(p.z) === cz)) damagePlayer(st, p, K.dmg, t.ttype);
      }
    }
  }

  // run end: everyone escaped, or everyone perma-out (co-op respawns, so only escape ends it)
  const alive = st.players.filter((p) => !p.escaped);
  if (!alive.length && st.players.length) {
    st.over = true;
    st.result = {
      time: st.time,
      players: st.players.map((p) => ({ id: p.id, name: p.name, deaths: p.deaths, gold: p.gold, escaped: p.escaped })),
    };
    emit(st, "runOver", { time: st.time });
  }
}

export function drainEvents(st) {
  const out = st.events;
  st.events = [];
  return out;
}

// convenience for tests + bots: aim yaw from a toward b
export function yawTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }

/** Walk-surface height under an actor (raised platforms). */
export function surfaceH(st, f, x, z) { return cellHeight(st.d, f, w2c(x), w2c(z)); }

/**
 * Soft target lock: the best enemy in the player's facing cone.
 * Nearest-angle wins, distance breaks ties — feels like a D&D "engaged" target.
 */
export function pickTarget(st, p, maxDist = 13) {
  let best = null, bestScore = Infinity;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  for (const e of st.enemies) {
    if (!e.alive || e.f !== p.f) continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist || dist < 0.01) continue;
    const dot = (dx * fx + dz * fz) / dist;
    if (dot < 0.35) continue;                     // ~70° half-cone
    const score = (1 - dot) * 8 + dist * 0.25;    // angle-dominant scoring
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}
