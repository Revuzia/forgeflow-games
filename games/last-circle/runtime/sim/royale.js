/**
 * FFG runtime — sim/royale.js  (Last Circle)
 * Pure, deterministic battle-royale rules core. NO rendering, NO three.js —
 * the single source of truth consumed by the 3D genre module (ffg_royale3d.js),
 * the bot brains (royale/bots.js), and the node selftest.
 *
 * Owns: seeded RNG, the weapon/consumable tables, storm phase math, damage
 * resolution, loot rolls, and match bookkeeping (alive count, placements,
 * kill feed entries).
 *
 * !! NO BUILDING / NO HARVESTING — removed by owner decision; do NOT reintroduce.
 * There is no build grid, no support graph, no pickaxe and no materials, and the
 * exports below carry no build/harvest functions. Benchmark games (Fortnite, and
 * Final Drop, which does ship building) are NOT parity targets on this axis —
 * a parity pass must skip it. Historical CHANGELOG entries mentioning builds are
 * history, not a spec.
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
    pistol:   { cls: "pistol", damage: 24, headMult: 1.5, rpm: 400, mag: 16, reloadS: 1.3, ammo: "light", speed: 999, falloff: [25, 50], spreadDeg: 1.3, adsFov: 48 },
    smg:      { cls: "smg", damage: 17, headMult: 1.5, rpm: 720, mag: 30, reloadS: 2.0, ammo: "light", speed: 999, falloff: [18, 40], spreadDeg: 2.2, adsFov: 47 },
    ar:       { cls: "ar", damage: 30, headMult: 1.5, rpm: 330, mag: 30, reloadS: 2.4, ammo: "medium", speed: 300, falloff: [60, 120], spreadDeg: 1.5, adsFov: 42 },
    // Shotgun was 10 dmg / 70 rpm / 4.0 s reload = 90 per blast, 105 DPS: the WORST
    // gun in the table at its own 7 m preferred range (SMG 204, AR 165, pistol 160)
    // and 3 blasts to break a 200 EHP bar in 1.71 s vs the SMG's 0.92 s. 13 dmg is
    // 117 per blast — a clean 2-blast kill at 156 DPS, still under the SMG's sustained
    // lane. It also un-collapses the rarity ladder: hitDamage rounds PER PELLET, so
    // base 10 gave 10/11/12/12/13 (rare and epic identical); base 13 gives 13/14/15/16/17.
    shotgun:  { cls: "shotgun", damage: 13, headMult: 1.75, rpm: 80, mag: 5, reloadS: 3.0, ammo: "shells", speed: 999, falloff: [8, 20], pellets: 9, spreadDeg: 4.0, adsFov: 49 },
    sniper:   { cls: "sniper", damage: 105, headMult: 2.5, rpm: 35, mag: 1, reloadS: 3.0, ammo: "heavy", speed: 700, falloff: [200, 400], spreadDeg: 0.15, scope: true, adsFov: 20 },
    glauncher:{ cls: "launcher", damage: 95, headMult: 1.0, rpm: 55, mag: 4, reloadS: 3.2, ammo: "grenades", speed: 26, arc: true, fuseS: 2.0, splashR: 3.5, spreadDeg: 0.8, adsFov: 45 },
  };
  var WEAPON_IDS = ["pistol", "smg", "ar", "shotgun", "sniper", "glauncher"]; // lootable guns
  // Display names. The kill feed threw away the weaponId it was handed and the
  // death screen printed the raw internal id ("glauncher"), so the one place a
  // player learns what killed them showed them a variable name.
  var WEAPON_NAMES = {
    pistol: "Pistol", smg: "SMG", ar: "Assault Rifle",
    shotgun: "Shotgun", sniper: "Sniper", glauncher: "Grenade Launcher",
    storm: "the Storm",
  };
  function weaponName(id) { return WEAPON_NAMES[id] || String(id || "?"); }
  /** Rough sustained-DPS worth of a gun, rarity weighted. `damage` is PER PELLET,
   *  so a shotgun scores below a pistol without the pellet term. */
  function gunScore(id, rarity) {
    var d = WEAPONS[id];
    if (!d) return -1;
    return (d.damage * (d.pellets || 1) * d.rpm / 60) + (rarity || 0) * 20;
  }

  var AMMO = {
    light:    { box: 24, max: 300 },
    medium:   { box: 20, max: 240 },
    shells:   { box: 8,  max: 60 },
    heavy:    { box: 6,  max: 36 },
    grenades: { box: 4,  max: 20 },
  };
  // every actor spawns armed — a BR shooter, not a scavenger sim
  var START_LOADOUT = { weapon: "pistol", rarity: 0, ammo: { light: 36 } };

  var CONSUMABLES = {
    bandage:     { heals: "hp", amount: 15, cap: 75, useS: 3, stack: 15 },
    medkit:      { heals: "hp", amount: 100, cap: 100, useS: 8, stack: 3 },
    mini_shield: { heals: "shield", amount: 25, cap: 50, useS: 2, stack: 6 },
    big_shield:  { heals: "shield", amount: 50, cap: 100, useS: 4, stack: 3 },
  };

  // arcade-BR speeds (owner: "not industry standard" at 8.4 — browser BRs
  // like Final Drop run ~9-10 sprint with a strong FOV kick)
  var MOVE = {
    walk: 6.0, sprint: 9.6, ads: 3.8,
    swim: 4.0, swimSprint: 5.6,
    jumpV: 7.8, gravity: -22, accelT: 0.13, airControl: 0.4,
  };

  var PLAYERK = { hp: 100, shield: 100, radius: 0.45, height: 1.8, eyeY: 1.62, swimDepth: 1.1 };

  // Crouch: the one basic shooter verb the game did not have. Today it trades
  // 55% of your movement speed for a markedly tighter hipfire cone and a lower
  // camera.
  // heightMult is MEASURED off the shipped crouch clip, not chosen. Meshy action
  // 524 "Cautious_Crouch_Walk_Forward" puts the head bone at 1.34m (max 1.36
  // across the cycle) against 1.62m standing; the standing capsule sits 0.18m
  // above the head bone, so the crouched capsule is 1.36+0.18 = 1.54m -> 0.86.
  // An earlier guess of 0.62 would have been a lie: it is a cautious crouch
  // walk, not a deep tactical squat, and a capsule shorter than the visible
  // head means shots passing through a head the player can plainly see.
  // (A procedural leg-fold was tried first and rejected — captures showed the
  // character kneeling in mid-air; there is no IK here to plant the feet.)
  var CROUCH = { speedMult: 0.45, heightMult: 0.86, eyeMult: 0.60, spreadMult: 0.62 };
  // Drinking/bandaging used to be COMPLETELY free — you could chug an 8s medkit
  // at full sprint while closing on someone, so the heal carried no cost and no
  // tell. Using one now slows you to a walk-shuffle and locks sprint out for the
  // duration: you can still reposition behind cover, you just cannot run.
  var HEAL = { speedMult: 0.45, blocksSprint: true };
  /** Height of an actor's hit capsule. Only shrinks for an actor that actually
   *  HAS the crouch clip loaded — if a skin's clip failed to bake it still
   *  stands upright, and shrinking its capsule would reintroduce the lie. */
  function actorHeight(a) {
    return PLAYERK.height * (a && a.crouching && a.hasCrouchClip ? CROUCH.heightMult : 1);
  }
  /** Eye height, accounting for crouch (camera + muzzle origin). */
  function actorEyeY(a) { return PLAYERK.eyeY * (a && a.crouching ? CROUCH.eyeMult : 1); }

  /** The ONE movement basis for a given yaw: forward (f*) and strafe-right (r*).
   *  Ground movement and the glide each derived this inline, and the glide got
   *  the strafe sign wrong — it used (cos, +sin) where the ground uses
   *  (cos, -sin), so the two axes were not perpendicular (dot = -sin(2*yaw)) and
   *  A/D under the parachute pulled the wrong way at every non-cardinal heading.
   *  Sharing it here also makes the error testable from the node selftest. */
  /** The ONE spread model, in degrees. fire() computed this inline and the
   *  crosshair guessed at it with a different, much cruder formula that knew
   *  only about moving and ADS — so the reticle never showed crouch (a 38%
   *  tighter cone), airborne (a 2x penalty), rarity, first-shot accuracy (0.15x,
   *  the biggest term of all), or even the weapon's own base spread: a shotgun
   *  and a sniper drew the same reticle. The player was never shown when they
   *  were actually accurate. Both now read from here.
   *  st: {ads, moving, airborne, crouching, sinceLastShotS} */
  function effectiveSpread(weaponId, rarity, st) {
    var def = WEAPONS[weaponId];
    if (!def) return 1;
    st = st || {};
    var spread = (def.spreadDeg || 1) * (RARITY_SPREAD_MULT[rarity] || 1);
    if (st.ads) spread *= 0.5;
    // Movement penalty GRADED BY SPEED, not a binary "are you moving".
    // It used to be a flat 1.4x for anything over 1 m/s, which meant walking and
    // sprinting cost exactly the same accuracy — so sprint was free and plain
    // walking was a strictly dominated state with no reason to ever use it.
    // Now: still 1.00, crouch-walk (~2.7) 1.20, walk (6.0) 1.45, sprint (9.6) 1.72.
    var sp = st.speed != null ? st.speed : (st.moving ? MOVE.walk : 0);
    var movePen = 1 + Math.min(0.8, Math.max(0, sp) * 0.075);
    var airPen = st.airborne ? 2 : 1;
    spread *= movePen * airPen;
    if (st.crouching) spread *= CROUCH.spreadMult;
    // FIRST-SHOT ACCURACY: a deliberate single shot while standing still goes
    // exactly where the reticle points — no bloom lottery. Tolerance rather than
    // an exact compare now that movePen is continuous.
    if (def.cls !== "shotgun" && !st.airborne && sp < 0.6 && (st.sinceLastShotS || 0) > 0.5) spread *= 0.15;
    return spread;
  }

  function moveBasis(yaw) {
    var s = Math.sin(yaw), c = Math.cos(yaw);
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }

  // ── swept collision (bullets + bot line-of-sight) ──────────────────────────
  // Bullets used to test only whether a sub-step's END POINT landed inside a
  // box. Sub-steps are capped at 2.5 m, so a 0.32 m wall was missed roughly
  // 87% of the time and ramps (kind !== "box") were skipped outright: cover did
  // not stop bullets, and bot LOS shared the flaw. These are the swept tests
  // both paths now use — pure, so the node selftest can hold them honest.

  /** Segment (a→b) vs AABB, slab method. null on miss, else {t, tExit, nx,ny,nz}
   *  where t is the ENTRY fraction along a→b and n* the entry face normal
   *  (0,0,0 when the segment starts already inside). */
  function segmentBox(ax, ay, az, bx, by, bz, box) {
    var o = [ax, ay, az];
    var d = [bx - ax, by - ay, bz - az];
    var lo = [box.minX, box.minY, box.minZ];
    var hi = [box.maxX, box.maxY, box.maxZ];
    var tmin = 0, tmax = 1, axis = -1;
    for (var i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < lo[i] || o[i] > hi[i]) return null;   // parallel to the slab and outside it
        continue;
      }
      var inv = 1 / d[i];
      var t1 = (lo[i] - o[i]) * inv, t2 = (hi[i] - o[i]) * inv;
      if (t1 > t2) { var sw = t1; t1 = t2; t2 = sw; }
      if (t1 > tmin) { tmin = t1; axis = i; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    var n = [0, 0, 0];
    if (axis >= 0) n[axis] = d[axis] > 0 ? -1 : 1;
    return { t: tmin, tExit: tmax, nx: n[0], ny: n[1], nz: n[2] };
  }

  /** Top surface of a ramp collider at (x,z) — same formula the movement
   *  support test uses, shared so the two can never disagree. */
  function rampTopAt(c, x, z) {
    var f;
    if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
    else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
    return c.minY + (c.maxY - c.minY) * clamp(f, 0, 1);
  }

  /** Segment vs a sloped ramp: clip to the ramp's box, then walk the clipped
   *  span looking for the first sample under the sloped surface. */
  function segmentRamp(ax, ay, az, bx, by, bz, c, samples) {
    var box = segmentBox(ax, ay, az, bx, by, bz, c);
    if (!box) return null;
    var n = samples || 8;
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    for (var i = 0; i <= n; i++) {
      var t = box.t + (box.tExit - box.t) * (i / n);
      var x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (y <= rampTopAt(c, x, z) && y >= c.minY - 0.05) {
        return { t: t, nx: 0, ny: 1, nz: 0 };   // treat the slope as ground-ish
      }
    }
    return null;
  }

  /** First blocking collider along a segment. `cols` is any iterable of
   *  colliders (boxes and ramps). Returns the nearest {t, n*, c} or null. */
  function segmentColliders(ax, ay, az, bx, by, bz, cols) {
    var best = null;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c.dead) continue;
      var h = c.kind === "ramp"
        ? segmentRamp(ax, ay, az, bx, by, bz, c)
        : c.kind === "box" ? segmentBox(ax, ay, az, bx, by, bz, c) : null;
      if (h && (!best || h.t < best.t)) { best = h; best.c = c; }
    }
    return best;
  }

  // Storm phase tables per mode. radiusFrac × (map halfsize) = target radius.
  // Final Drop pacing (owner: circle "shrinks too much too quickly") —
  // gentler early cuts (~58-64% radius kept per phase vs ~46% before), longer
  // waits, one extra phase: ~13.5 min total on standard.
  var STORM_PHASES = {
    standard: [
      { wait: 80, shrink: 80, radiusFrac: 0.78,  dps: 1 },
      { wait: 60, shrink: 70, radiusFrac: 0.58,  dps: 1 },
      { wait: 50, shrink: 60, radiusFrac: 0.42,  dps: 2 },
      { wait: 45, shrink: 50, radiusFrac: 0.28,  dps: 3 },
      { wait: 40, shrink: 45, radiusFrac: 0.17,  dps: 5 },
      { wait: 30, shrink: 40, radiusFrac: 0.09,  dps: 7 },
      { wait: 25, shrink: 35, radiusFrac: 0.04,  dps: 9 },
      // final circle HOLDS at ~10m — closing to zero storm-killed every
      // survivor simultaneously and crowned a corpse; someone must WIN the fight
      { wait: 20, shrink: 45, radiusFrac: 0.012, dps: 12 },
    ],
    quick: [
      { wait: 30, shrink: 35, radiusFrac: 0.28, dps: 2 },
      { wait: 24, shrink: 30, radiusFrac: 0.17, dps: 4 },
      { wait: 18, shrink: 26, radiusFrac: 0.09, dps: 6 },
      { wait: 14, shrink: 22, radiusFrac: 0.04, dps: 10 },
      { wait: 12, shrink: 28, radiusFrac: 0.02, dps: 14 },
    ],
    practice: [],
  };
  // quick mode starts pre-shrunk:
  var MODE = {
    standard: { players: 50, startRadiusFrac: 1.35, lootMult: 1.0, drop: "glider" },
    quick:    { players: 50, startRadiusFrac: 0.75, lootMult: 1.8, drop: "ground" },
    practice: { players: 1,  startRadiusFrac: 1.35, lootMult: 1.0, drop: "ground" },
  };

  var LOOT_WEIGHTS = {
    floor: [40, 30, 18, 9, 3],
    chest: [15, 30, 30, 18, 7],
    supply: [0, 0, 10, 35, 55],
  };

  // AI skill tiers (1-indexed by tier-1) — wide spread so the lobby reads as
  // real players: beginners whiff constantly, experts are genuinely scary
  var BOT_TIERS = [
    { reactionMs: 700, aimErrDeg: 7.5 },
    { reactionMs: 500, aimErrDeg: 4.5 },
    { reactionMs: 380, aimErrDeg: 2.8 },
    { reactionMs: 300, aimErrDeg: 1.8 },
    { reactionMs: 210, aimErrDeg: 0.9 },
  ];
  var BOT_TIER_MIX = { standard: [8, 12, 14, 10, 5], quick: [6, 10, 14, 12, 7] };
  var BOT_PERSONALITIES = ["rusher", "flanker", "camper", "loot_goblin", "rotator", "sniper"];

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

  /** One floor-spawn item. kind: weapon|ammo|consumable */
  function rollFloorItem(rng) {
    var r = rng();
    if (r < 0.45) {
      var wid = WEAPON_IDS[weightedIndex(rng, [16, 22, 24, 20, 10, 8])];
      return { kind: "weapon", id: wid, rarity: rollRarity(rng, "floor") };
    }
    if (r < 0.7) {
      var aid = ["light", "medium", "shells", "heavy", "grenades"][weightedIndex(rng, [30, 28, 22, 12, 8])];
      return { kind: "ammo", id: aid, count: AMMO[aid].box };
    }
    var cid = ["bandage", "mini_shield", "medkit", "big_shield"][weightedIndex(rng, [32, 34, 18, 16])];
    return { kind: "consumable", id: cid, count: cid === "bandage" ? 5 : cid === "mini_shield" ? 3 : 1 };
  }

  /** Chest burst: weapon + ammo for it + one extra. */
  function rollChest(rng) {
    var wid = WEAPON_IDS[weightedIndex(rng, [8, 20, 26, 20, 14, 12])];
    var w = WEAPONS[wid];
    var items = [{ kind: "weapon", id: wid, rarity: rollRarity(rng, "chest") }];
    if (w.ammo) items.push({ kind: "ammo", id: w.ammo, count: AMMO[w.ammo].box * 2 });
    var r = rng();
    if (r < 0.55) {
      var cid = ["mini_shield", "big_shield", "medkit", "bandage"][weightedIndex(rng, [34, 26, 20, 20])];
      items.push({ kind: "consumable", id: cid, count: cid === "bandage" ? 5 : cid === "mini_shield" ? 3 : 1 });
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
      { kind: "consumable", id: "medkit", count: 1 },
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
    // Squads: optional teamOf(id) -> team key. Left null for solo, where every
    // player is their own team and _teamsAlive() collapses back to alive.size.
    this.teamOf = (opts && opts.teamOf) || null;
    this.winners = null;    // every surviving member of the winning squad
  }
  Match.prototype.register = function (id) { this.alive.add(id); this.kills[id] = 0; this.damage[id] = 0; };
  Match.prototype.aliveCount = function () { return this.alive.size; };
  /** Distinct squads still alive. Solo (no teamOf) = one squad per player. */
  Match.prototype._teamsAlive = function () {
    if (!this.teamOf) return this.alive.size;
    var seen = Object.create(null), n = 0, self = this;
    this.alive.forEach(function (id) {
      var t = self.teamOf(id);
      if (!seen[t]) { seen[t] = 1; n++; }
    });
    return n;
  };
  Match.prototype.recordDamage = function (attackerId, amount) {
    if (attackerId != null && this.damage[attackerId] != null) this.damage[attackerId] += amount;
  };
  Match.prototype.eliminate = function (victimId, killerId, weaponId, t) {
    if (!this.alive.has(victimId) || this.over) return null;
    this.alive.delete(victimId);
    this.placements.push(victimId);
    if (killerId != null && killerId !== victimId && this.kills[killerId] != null) this.kills[killerId]++;
    this.feed.push({ t: t || 0, killer: killerId, victim: victimId, weapon: weaponId || "storm" });
    if (this._teamsAlive() === 1) {
      this.over = true;
      // The whole surviving squad wins, so all of them go on the placement list.
      // winner stays the first survivor for callers that still read the scalar.
      this.winners = Array.from(this.alive);
      this.winner = this.winners[0];
      for (var i = 0; i < this.winners.length; i++) this.placements.push(this.winners[i]);
    }
    return { placement: this.totalPlayers - this.placements.length + 1 };
  };
  /** 1 = winner. For an id that died: position at elimination. */
  Match.prototype.placementOf = function (id) {
    // A winning squad shares placement 1. Without this the second member sits one
    // slot further down `placements` and would read as #0.
    if (this.winners && this.winners.indexOf(id) >= 0) return 1;
    var idx = this.placements.indexOf(id);
    if (idx < 0) return null;
    return this.totalPlayers - idx;
  };
  /** True for every member of the winning squad, not just the scalar winner. */
  Match.prototype.isWinner = function (id) {
    return this.winners ? this.winners.indexOf(id) >= 0 : this.winner === id;
  };

  // exports -------------------------------------------------------------------
  var api = {
    mulberry32: mulberry32, clamp: clamp, dist2d: dist2d, lerp: lerp,
    RARITY: RARITY, RARITY_COLOR: RARITY_COLOR, RARITY_DMG_MULT: RARITY_DMG_MULT, RARITY_SPREAD_MULT: RARITY_SPREAD_MULT,
    WEAPONS: WEAPONS, WEAPON_IDS: WEAPON_IDS, WEAPON_NAMES: WEAPON_NAMES, weaponName: weaponName, gunScore: gunScore, AMMO: AMMO, CONSUMABLES: CONSUMABLES, START_LOADOUT: START_LOADOUT,
    MOVE: MOVE, PLAYERK: PLAYERK, CROUCH: CROUCH, HEAL: HEAL, effectiveSpread: effectiveSpread,
    actorHeight: actorHeight, actorEyeY: actorEyeY, moveBasis: moveBasis,
    segmentBox: segmentBox, rampTopAt: rampTopAt, segmentRamp: segmentRamp,
    segmentColliders: segmentColliders,
    STORM_PHASES: STORM_PHASES, MODE: MODE, LOOT_WEIGHTS: LOOT_WEIGHTS,
    BOT_TIERS: BOT_TIERS, BOT_TIER_MIX: BOT_TIER_MIX, BOT_PERSONALITIES: BOT_PERSONALITIES, BOT_NAMES: BOT_NAMES,
    Storm: Storm, Match: Match,
    hitDamage: hitDamage, applyDamage: applyDamage, splashScale: splashScale,
    weightedIndex: weightedIndex, rollRarity: rollRarity, rollFloorItem: rollFloorItem, rollChest: rollChest, rollSupplyDrop: rollSupplyDrop,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.Royale = api;
})(typeof window !== "undefined" ? window : globalThis);
