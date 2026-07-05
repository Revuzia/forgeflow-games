/**
 * FFG runtime — sim/royale.js  (Last Circle)
 * Pure, deterministic battle-royale rules core. NO rendering, NO three.js —
 * the single source of truth consumed by the 3D genre module (ffg_royale3d.js),
 * the bot brains (royale/bots.js), and the node selftest.
 *
 * Owns: seeded RNG, the weapon/material/consumable tables, storm phase math,
 * damage resolution, the building grid (placement, support graph, cascade
 * destroy), loot rolls, harvesting, and match bookkeeping (alive count,
 * placements, kill feed entries).
 *
 * Design numbers come from forgeflow-games/state/research_battle_royale.json
 * (Fortnite building/storm, PUBG ballistics/loot, Apex shields/feedback,
 * Final Drop browser-BR formula).
 *
 * Dual export: Node require() and browser window.FFG.sim.Royale.
 */
(function (root) {
  "use strict";

  // ── deterministic PRNG (family shared with iron-tide/navalfree) ────────────
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist2d(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLES
  // ═══════════════════════════════════════════════════════════════════════════

  var RARITY = ["common", "uncommon", "rare", "epic", "legendary"];
  var RARITY_COLOR = { common: "#9da5b4", uncommon: "#3ec46d", rare: "#3fa9f5", epic: "#b05cf0", legendary: "#f2a33c" };
  var RARITY_DMG_MULT = [1.0, 1.08, 1.16, 1.24, 1.32];       // +8%/tier
  var RARITY_SPREAD_MULT = [1.0, 0.9, 0.81, 0.73, 0.66];     // -10%/tier

  // damage = body damage at full effect; falloff -> linear to 40% floor
  var WEAPONS = {
    pickaxe: { cls: "melee", damage: 20, headMult: 1.0, rpm: 67, mag: 0, reloadS: 0, ammo: null, rangeM: 2.6, harvest: true },
    pistol:  { cls: "pistol", damage: 24, headMult: 1.5, rpm: 400, mag: 16, reloadS: 1.3, ammo: "light", speed: 999, falloff: [25, 50], spreadDeg: 1.3 },
    smg:     { cls: "smg", damage: 17, headMult: 1.5, rpm: 720, mag: 30, reloadS: 2.0, ammo: "light", speed: 999, falloff: [18, 40], spreadDeg: 2.2, structMult: 1.6 },
    ar:      { cls: "ar", damage: 30, headMult: 1.5, rpm: 330, mag: 30, reloadS: 2.4, ammo: "medium", speed: 300, falloff: [60, 120], spreadDeg: 1.5 },
    shotgun: { cls: "shotgun", damage: 10, headMult: 1.75, rpm: 70, mag: 5, reloadS: 4.0, ammo: "shells", speed: 999, falloff: [8, 20], pellets: 9, spreadDeg: 4.0 },
    sniper:  { cls: "sniper", damage: 105, headMult: 2.5, rpm: 35, mag: 1, reloadS: 3.0, ammo: "heavy", speed: 500, gravity: true, falloff: [200, 400], spreadDeg: 0.15, scope: true },
    rocket:  { cls: "launcher", damage: 110, headMult: 1.0, rpm: 45, mag: 1, reloadS: 3.6, ammo: "rockets", speed: 40, splashR: 4, spreadDeg: 0.6, breaksAll: true },
    grenade: { cls: "throwable", damage: 100, headMult: 1.0, rpm: 60, mag: 0, reloadS: 0, ammo: null, fuseS: 2.5, splashR: 3.5, stack: 6, speed: 18 },
  };
  var WEAPON_IDS = ["pistol", "smg", "ar", "shotgun", "sniper", "rocket"]; // lootable guns

  var AMMO = {
    light:   { box: 24, max: 300 },
    medium:  { box: 20, max: 240 },
    shells:  { box: 8,  max: 60 },
    heavy:   { box: 6,  max: 36 },
    rockets: { box: 2,  max: 12 },
  };

  var CONSUMABLES = {
    bandage:     { heals: "hp", amount: 15, cap: 75, useS: 3, stack: 15 },
    medkit:      { heals: "hp", amount: 100, cap: 100, useS: 8, stack: 3 },
    mini_shield: { heals: "shield", amount: 25, cap: 50, useS: 2, stack: 6 },
    big_shield:  { heals: "shield", amount: 50, cap: 100, useS: 4, stack: 3 },
  };

  var MATERIALS = {
    wood:  { hpStart: 90,  hpFull: 150, buildS: 4 },
    brick: { hpStart: 100, hpFull: 300, buildS: 11 },
    metal: { hpStart: 110, hpFull: 500, buildS: 22 },
  };
  var MAT_IDS = ["wood", "brick", "metal"];
  var BUILD = {
    gridM: 4,           // cell size in meters (walls 4m wide × 4m tall)
    cost: 10,           // mats per piece
    editCost: 0,
    matCap: 500,
    turboMs: 150,
    harvestPerHit: 14,  // ~Fortnite scale: a tree (3-4 swings) ≈ 50 mats
    harvestCritBonus: 8,
  };

  var MOVE = {
    walk: 4.2, sprint: 6.5, crouch: 2.2, ads: 2.8,
    jumpV: 7.2, gravity: -22, accelT: 0.18, airControl: 0.35,
  };

  var PLAYERK = { hp: 100, shield: 100, radius: 0.45, height: 1.8, eyeY: 1.62, crouchHeight: 1.2 };

  // Storm phase tables per mode. radiusFrac × (map halfsize) = target radius.
  var STORM_PHASES = {
    standard: [
      { wait: 50, shrink: 60, radiusFrac: 0.62,  dps: 1 },
      { wait: 40, shrink: 50, radiusFrac: 0.44,  dps: 2 },
      { wait: 35, shrink: 45, radiusFrac: 0.30,  dps: 3 },
      { wait: 30, shrink: 40, radiusFrac: 0.18,  dps: 5 },
      { wait: 25, shrink: 35, radiusFrac: 0.10,  dps: 8 },
      { wait: 20, shrink: 30, radiusFrac: 0.045, dps: 10 },
      // final circle HOLDS at ~10m — closing to zero storm-killed every
      // survivor simultaneously and crowned a corpse; someone must WIN the fight
      { wait: 15, shrink: 40, radiusFrac: 0.012, dps: 12 },
    ],
    quick: [
      { wait: 25, shrink: 30, radiusFrac: 0.28, dps: 2 },
      { wait: 20, shrink: 25, radiusFrac: 0.17, dps: 4 },
      { wait: 15, shrink: 22, radiusFrac: 0.09, dps: 6 },
      { wait: 12, shrink: 20, radiusFrac: 0.04, dps: 10 },
      { wait: 10, shrink: 25, radiusFrac: 0.02, dps: 14 },
    ],
    practice: [],
  };
  // quick mode starts pre-shrunk:
  var MODE = {
    // 50 starting wood (everyone, humans included) primes the build economy —
    // playtests showed a mats starvation loop: nobody could afford the first
    // wall, so kills never dropped mats, so nobody EVER built.
    standard: { players: 50, startRadiusFrac: 1.35, lootMult: 1.0, startMats: { wood: 50, brick: 0, metal: 0 }, drop: "glider" },
    quick:    { players: 50, startRadiusFrac: 0.75, lootMult: 1.8, startMats: { wood: 100, brick: 0, metal: 0 }, drop: "ground" },
    practice: { players: 1,  startRadiusFrac: 1.35, lootMult: 1.0, startMats: { wood: 9999, brick: 9999, metal: 9999 }, drop: "ground" },
  };

  var LOOT_WEIGHTS = {
    floor: [40, 30, 18, 9, 3],
    chest: [15, 30, 30, 18, 7],
    supply: [0, 0, 10, 35, 55],
  };

  // AI skill tiers (1-indexed by tier-1)
  var BOT_TIERS = [
    { reactionMs: 600, aimErrDeg: 6.0, builds: 0, edits: false, buildMs: 900 },
    { reactionMs: 450, aimErrDeg: 4.0, builds: 1, edits: false, buildMs: 700 },
    { reactionMs: 350, aimErrDeg: 2.6, builds: 2, edits: true,  buildMs: 480 },
    { reactionMs: 280, aimErrDeg: 1.7, builds: 3, edits: true,  buildMs: 330 },
    { reactionMs: 220, aimErrDeg: 1.0, builds: 4, edits: true,  buildMs: 240 },
  ];
  var BOT_TIER_MIX = { standard: [8, 12, 14, 10, 5], quick: [6, 10, 14, 12, 7] };
  var BOT_PERSONALITIES = ["rusher", "builder", "camper", "loot_goblin", "rotator", "sniper"];

  var BOT_NAMES = [
    "Zephyx", "NoScopeNate", "CrackedTina", "BushWookie7", "DriftKing", "PixelPete", "QuietStorm",
    "RampRat", "MetaMike", "SoloQueueSue", "TiltedTy", "90sKid", "BoxedLikeAFish", "LaserLena",
    "CamperVan", "WKeyWarrior", "EditLord", "MatsForDays", "StormDodger", "GreyZone", "HotDropHank",
    "SniperSloth", "CrateCarl", "VendettaV", "MongoalMax", "PhaseRunner", "JitterJay", "OneShotOna",
    "TarpTown", "GoldenGoose", "FishstickFan", "RezMePls", "ZeroBuildZoe", "PumpPeek", "CraftyKat",
    "LlamaLarry", "StreamSniped", "AFKAndy", "ClutchClara", "BaitedBen", "TunnelTim", "HighGroundHera",
    "DoubleRampDan", "PrefireFreya", "GhostPeeker", "ShotgunSherpa", "MinigunMona", "BunnyHopBo",
    "SweatySteve", "DefaultDave", "CoachCarter", "PlateStacker", "RiftWalker", "EchoFox", "NadeParade",
    "TenaciousTee", "BlueprintBill", "StormSurferSam", "CozyCampfire", "FlickMaster", "JuiceBoxJin",
    "VaultedVicky", "OGSkinOtto", "PicklePlays", "TurboTess", "WallTaker", "KeyboardKai", "MildSalsa",
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // STORM
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Deterministic storm schedule. Built once from (seed, mode, map halfsize).
   * Query with stateAt(t) -> { center:{x,z}, radius, dps, phase, phaseState,
   * tToNext, closing } — pure function of time, so host and clients agree.
   */
  function Storm(opts) {
    this.mode = opts.mode || "standard";
    this.half = opts.half;                    // map half-size (m)
    this.phases = STORM_PHASES[this.mode] || [];
    var rng = mulberry32((opts.seed >>> 0) ^ 0x51f0c3);
    var startR = (MODE[this.mode] || MODE.standard).startRadiusFrac * this.half;
    // Precompute circle sequence: each target circle fully inside the previous.
    this.circles = [{ x: 0, z: 0, r: startR }];
    var prev = this.circles[0];
    for (var i = 0; i < this.phases.length; i++) {
      var r = this.phases[i].radiusFrac * this.half;
      var maxOff = Math.max(0, prev.r - r) * 0.8;   // stay well inside
      var ang = rng() * Math.PI * 2, off = rng() * maxOff;
      var cx = prev.x + Math.cos(ang) * off, cz = prev.z + Math.sin(ang) * off;
      // clamp inside map bounds
      cx = clamp(cx, -this.half + r, this.half - r);
      cz = clamp(cz, -this.half + r, this.half - r);
      var c = { x: cx, z: cz, r: r };
      this.circles.push(c);
      prev = c;
    }
    // Phase timeline: [waitEnd, shrinkEnd] pairs cumulative
    this.timeline = [];
    var t = 0;
    for (var j = 0; j < this.phases.length; j++) {
      var ph = this.phases[j];
      this.timeline.push({ waitStart: t, shrinkStart: t + ph.wait, end: t + ph.wait + ph.shrink });
      t += ph.wait + ph.shrink;
    }
    this.totalS = t;
  }

  Storm.prototype.stateAt = function (t) {
    if (!this.phases.length) {
      return { center: { x: 0, z: 0 }, radius: this.circles[0].r, dps: 0, phase: 0, phaseState: "idle", tToNext: Infinity, closing: false, done: false };
    }
    for (var i = 0; i < this.timeline.length; i++) {
      var tl = this.timeline[i], ph = this.phases[i];
      var from = this.circles[i], to = this.circles[i + 1];
      if (t < tl.shrinkStart) {
        return { center: { x: from.x, z: from.z }, radius: from.r, dps: i === 0 ? 0 : this.phases[i - 1].dps,
                 phase: i + 1, phaseState: "waiting", tToNext: tl.shrinkStart - t, closing: false, done: false,
                 nextCenter: { x: to.x, z: to.z }, nextRadius: to.r };
      }
      if (t < tl.end) {
        var k = (t - tl.shrinkStart) / (tl.end - tl.shrinkStart);
        return { center: { x: lerp(from.x, to.x, k), z: lerp(from.z, to.z, k) }, radius: lerp(from.r, to.r, k),
                 phase: i + 1, phaseState: "closing", dps: ph.dps, tToNext: tl.end - t, closing: true, done: false,
                 nextCenter: { x: to.x, z: to.z }, nextRadius: to.r };
      }
    }
    var last = this.circles[this.circles.length - 1];
    return { center: { x: last.x, z: last.z }, radius: last.r, dps: this.phases[this.phases.length - 1].dps,
             phase: this.phases.length, phaseState: "done", tToNext: Infinity, closing: false, done: true };
  };

  Storm.prototype.damageAt = function (t, x, z) {
    var s = this.stateAt(t);
    if (s.dps <= 0) return 0;
    var d = dist2d(x, z, s.center.x, s.center.z);
    return d > s.radius ? s.dps : 0;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DAMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Effective damage for one hit. */
  function hitDamage(weaponId, rarityTier, distM, isHead) {
    var w = WEAPONS[weaponId];
    if (!w) return 0;
    var dmg = w.damage * (RARITY_DMG_MULT[rarityTier || 0] || 1);
    if (w.falloff) {
      var f0 = w.falloff[0], f1 = w.falloff[1];
      if (distM > f0) dmg *= lerp(1, 0.4, clamp((distM - f0) / Math.max(1, f1 - f0), 0, 1));
    }
    if (isHead) dmg *= w.headMult;
    return Math.round(dmg);
  }

  /** Shield-first application. Returns { shield, hp, dealt, broke, dead, toShield, toHp }. */
  function applyDamage(shield, hp, dmg) {
    var toShield = Math.min(shield, dmg);
    var toHp = Math.min(hp, dmg - toShield);
    var ns = shield - toShield, nh = hp - toHp;
    return { shield: ns, hp: nh, dealt: toShield + toHp, broke: shield > 0 && ns === 0, dead: nh <= 0, toShield: toShield, toHp: toHp };
  }

  /** Splash damage scale by distance from blast center (linear to 25% at edge). */
  function splashScale(distM, splashR) {
    if (distM >= splashR) return 0;
    return lerp(1, 0.25, distM / splashR);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDING GRID
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Fortnite-style cell grid. Cell (ix,iy,iz) spans [ix*G,(ix+1)*G) etc.
   * Piece slots per cell: floor (bottom plane), wall × 4 faces (0=+X,1=-X,2=+Z,3=-Z),
   * ramp (1 per cell, dir 0..3), stair (1 per cell, dir 0..3; ramp+stair share slot).
   * Key: `${type}:${ix},${iy},${iz}:${dir}` (floor/ramp dir slot 0 unless ramp dir).
   *
   * Support: a piece is GROUNDED if groundedFn(piece) says its cell touches
   * terrain, else it must chain через face-adjacent pieces to a grounded one.
   * removePiece() cascades: pieces left without a chain die (returned list).
   */
  function BuildGrid(opts) {
    this.G = (opts && opts.gridM) || BUILD.gridM;
    this.pieces = new Map();
    this.groundedFn = (opts && opts.groundedFn) || function () { return true; };
  }

  BuildGrid.prototype.cellOf = function (x, y, z) {
    var G = this.G;
    return { ix: Math.floor(x / G), iy: Math.floor(y / G), iz: Math.floor(z / G) };
  };

  BuildGrid.prototype.key = function (type, ix, iy, iz, dir) {
    return type + ":" + ix + "," + iy + "," + iz + ":" + (dir || 0);
  };

  /** slotKey ignores dir for slot-exclusive types (ramp/stair share the cell slot). */
  BuildGrid.prototype.slotKey = function (type, ix, iy, iz, dir) {
    if (type === "ramp" || type === "stair") return "R:" + ix + "," + iy + "," + iz;
    if (type === "floor") return "F:" + ix + "," + iy + "," + iz;
    return "W:" + ix + "," + iy + "," + iz + ":" + dir;
  };

  BuildGrid.prototype.get = function (slotKey) { return this.pieces.get(slotKey) || null; };

  /** Place. Returns piece or null (occupied). Caller checks mats. */
  BuildGrid.prototype.place = function (type, ix, iy, iz, dir, mat, now) {
    var sk = this.slotKey(type, ix, iy, iz, dir);
    if (this.pieces.has(sk)) return null;
    var m = MATERIALS[mat] || MATERIALS.wood;
    var p = { type: type, ix: ix, iy: iy, iz: iz, dir: dir || 0, mat: mat, slotKey: sk,
              hp: m.hpStart, hpMax: m.hpFull, placedAt: now || 0, edit: null };
    this.pieces.set(sk, p);
    return p;
  };

  /** HP ramps from hpStart→hpFull over buildS. Call before damaging/showing. */
  BuildGrid.prototype.currentMaxHp = function (p, now) {
    var m = MATERIALS[p.mat];
    var k = clamp(((now || 0) - p.placedAt) / m.buildS, 0, 1);
    return Math.round(lerp(m.hpStart, m.hpFull, k));
  };

  BuildGrid.prototype.damagePiece = function (slotKey, dmg, now) {
    var p = this.pieces.get(slotKey);
    if (!p) return { destroyed: [], hit: null };
    var maxNow = this.currentMaxHp(p, now);
    p.hp = Math.min(p.hp, maxNow) - dmg;
    if (p.hp <= 0) return { destroyed: this.removePiece(slotKey), hit: p };
    return { destroyed: [], hit: p };
  };

  /** Neighbor slot keys that structurally connect to piece p. */
  BuildGrid.prototype._neighbors = function (p) {
    var out = [], ix = p.ix, iy = p.iy, iz = p.iz;
    var push = out.push.bind(out);
    // pieces in same cell always connect
    push("F:" + ix + "," + iy + "," + iz);
    push("R:" + ix + "," + iy + "," + iz);
    for (var d = 0; d < 4; d++) push("W:" + ix + "," + iy + "," + iz + ":" + d);
    // walls of adjacent cells that face into this cell + floors/ramps of face-adjacent cells
    var adj = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
    for (var i = 0; i < adj.length; i++) {
      var ax = ix + adj[i][0], ay = iy + adj[i][1], az = iz + adj[i][2];
      push("F:" + ax + "," + ay + "," + az);
      push("R:" + ax + "," + ay + "," + az);
      for (var d2 = 0; d2 < 4; d2++) push("W:" + ax + "," + ay + "," + az + ":" + d2);
    }
    var self = p.slotKey, res = [];
    for (var j = 0; j < out.length; j++) if (out[j] !== self && this.pieces.has(out[j])) res.push(out[j]);
    return res;
  };

  /** Remove a piece; flood from all grounded pieces; anything unreached dies too. */
  BuildGrid.prototype.removePiece = function (slotKey) {
    var gone = [];
    var p = this.pieces.get(slotKey);
    if (!p) return gone;
    this.pieces.delete(slotKey);
    gone.push(p);
    // flood-fill support from grounded pieces
    var reached = new Set();
    var queue = [];
    var self = this;
    this.pieces.forEach(function (q, k) { if (self.groundedFn(q)) { reached.add(k); queue.push(q); } });
    while (queue.length) {
      var cur = queue.pop();
      var nb = this._neighbors(cur);
      for (var i = 0; i < nb.length; i++) {
        if (!reached.has(nb[i])) { reached.add(nb[i]); queue.push(this.pieces.get(nb[i])); }
      }
    }
    var dead = [];
    this.pieces.forEach(function (q, k) { if (!reached.has(k)) dead.push(k); });
    for (var j = 0; j < dead.length; j++) {
      var dp = this.pieces.get(dead[j]);
      this.pieces.delete(dead[j]);
      gone.push(dp);
    }
    return gone;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOT
  // ═══════════════════════════════════════════════════════════════════════════

  function weightedIndex(rng, weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var roll = rng() * total;
    for (i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) return i; }
    return weights.length - 1;
  }

  function rollRarity(rng, table) { return weightedIndex(rng, LOOT_WEIGHTS[table] || LOOT_WEIGHTS.floor); }

  /** One floor-spawn item. kind: weapon|ammo|consumable|mats */
  function rollFloorItem(rng) {
    var r = rng();
    if (r < 0.42) {
      var wid = WEAPON_IDS[weightedIndex(rng, [18, 20, 24, 20, 10, 4, 4].slice(0, WEAPON_IDS.length))];
      return { kind: "weapon", id: wid, rarity: rollRarity(rng, "floor") };
    }
    if (r < 0.62) {
      var aid = ["light", "medium", "shells", "heavy", "rockets"][weightedIndex(rng, [30, 28, 22, 12, 8])];
      return { kind: "ammo", id: aid, count: AMMO[aid].box };
    }
    if (r < 0.72) return { kind: "weapon", id: "grenade", rarity: 0, count: 3 };
    if (r < 0.9) {
      var cid = ["bandage", "mini_shield", "medkit", "big_shield"][weightedIndex(rng, [32, 34, 18, 16])];
      return { kind: "consumable", id: cid, count: cid === "bandage" ? 5 : cid === "mini_shield" ? 3 : 1 };
    }
    var mid = MAT_IDS[weightedIndex(rng, [50, 30, 20])];
    return { kind: "mats", id: mid, count: 50 };
  }

  /** Chest burst: weapon + ammo for it + one extra. */
  function rollChest(rng) {
    var wid = WEAPON_IDS[weightedIndex(rng, [10, 18, 26, 20, 14, 6])];
    var w = WEAPONS[wid];
    var items = [{ kind: "weapon", id: wid, rarity: rollRarity(rng, "chest") }];
    if (w.ammo) items.push({ kind: "ammo", id: w.ammo, count: AMMO[w.ammo].box * 2 });
    var r = rng();
    if (r < 0.4) {
      var cid = ["mini_shield", "big_shield", "medkit", "bandage"][weightedIndex(rng, [34, 26, 20, 20])];
      items.push({ kind: "consumable", id: cid, count: cid === "bandage" ? 5 : cid === "mini_shield" ? 3 : 1 });
    } else if (r < 0.7) {
      items.push({ kind: "mats", id: MAT_IDS[weightedIndex(rng, [45, 33, 22])], count: 40 });
    } else {
      items.push({ kind: "ammo", id: ["light", "medium", "shells"][weightedIndex(rng, [34, 34, 32])], count: 20 });
    }
    return items;
  }

  function rollSupplyDrop(rng) {
    var wid = WEAPON_IDS[weightedIndex(rng, [0, 5, 30, 20, 25, 20])];
    return [
      { kind: "weapon", id: wid, rarity: rollRarity(rng, "supply") },
      { kind: "consumable", id: "big_shield", count: 2 },
      { kind: "mats", id: "metal", count: 100 },
      { kind: "ammo", id: WEAPONS[wid].ammo || "medium", count: (AMMO[WEAPONS[wid].ammo || "medium"] || AMMO.medium).box * 3 },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATCH BOOKKEEPING
  // ═══════════════════════════════════════════════════════════════════════════
  /** Tracks alive/placement/kills. Actors registered by id. */
  function Match(opts) {
    this.mode = (opts && opts.mode) || "standard";
    this.totalPlayers = (opts && opts.players) || 50;
    this.alive = new Set();
    this.placements = [];   // ids in elimination order (first died = index 0)
    this.kills = {};        // id -> count
    this.damage = {};       // id -> total damage dealt
    this.feed = [];         // {t, killer, victim, weapon}
    this.over = false;
    this.winner = null;
  }
  Match.prototype.register = function (id) { this.alive.add(id); this.kills[id] = 0; this.damage[id] = 0; };
  Match.prototype.aliveCount = function () { return this.alive.size; };
  Match.prototype.recordDamage = function (attackerId, amount) {
    if (attackerId != null && this.damage[attackerId] != null) this.damage[attackerId] += amount;
  };
  Match.prototype.eliminate = function (victimId, killerId, weaponId, t) {
    if (!this.alive.has(victimId) || this.over) return null;
    this.alive.delete(victimId);
    this.placements.push(victimId);
    if (killerId != null && killerId !== victimId && this.kills[killerId] != null) this.kills[killerId]++;
    this.feed.push({ t: t || 0, killer: killerId, victim: victimId, weapon: weaponId || "storm" });
    if (this.alive.size === 1) {
      this.over = true;
      this.winner = this.alive.values().next().value;
      this.placements.push(this.winner);
    }
    return { placement: this.totalPlayers - this.placements.length + 1 };
  };
  /** 1 = winner. For an id that died: position at elimination. */
  Match.prototype.placementOf = function (id) {
    var idx = this.placements.indexOf(id);
    if (idx < 0) return null;
    return this.totalPlayers - idx;
  };

  // exports -------------------------------------------------------------------
  var api = {
    mulberry32: mulberry32, clamp: clamp, dist2d: dist2d, lerp: lerp,
    RARITY: RARITY, RARITY_COLOR: RARITY_COLOR, RARITY_DMG_MULT: RARITY_DMG_MULT, RARITY_SPREAD_MULT: RARITY_SPREAD_MULT,
    WEAPONS: WEAPONS, WEAPON_IDS: WEAPON_IDS, AMMO: AMMO, CONSUMABLES: CONSUMABLES,
    MATERIALS: MATERIALS, MAT_IDS: MAT_IDS, BUILD: BUILD, MOVE: MOVE, PLAYERK: PLAYERK,
    STORM_PHASES: STORM_PHASES, MODE: MODE, LOOT_WEIGHTS: LOOT_WEIGHTS,
    BOT_TIERS: BOT_TIERS, BOT_TIER_MIX: BOT_TIER_MIX, BOT_PERSONALITIES: BOT_PERSONALITIES, BOT_NAMES: BOT_NAMES,
    Storm: Storm, BuildGrid: BuildGrid, Match: Match,
    hitDamage: hitDamage, applyDamage: applyDamage, splashScale: splashScale,
    weightedIndex: weightedIndex, rollRarity: rollRarity, rollFloorItem: rollFloorItem, rollChest: rollChest, rollSupplyDrop: rollSupplyDrop,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.Royale = api;
})(typeof window !== "undefined" ? window : globalThis);
