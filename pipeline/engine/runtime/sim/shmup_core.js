/**
 * FFG sim — sim/shmup_core.js
 * PURE logic for a vertical scrolling shoot-em-up ("Starlance"). NO Phaser, no
 * DOM, no rendering. Deterministic given (dt, input): the renderer drives it and
 * a headless feel-gate can fast-simulate it to a win/lose with autoResolve().
 *
 * Coordinate space: a virtual play field WxH (top-left origin, y grows DOWN).
 * Player sits near the bottom and fires UP (-y). Enemies descend (+y) and fire
 * DOWN. step() returns the list of events that happened this tick so the
 * renderer can spawn juice (muzzle, explosion, shockwave, hitstop, score pops).
 *
 * CAMPAIGN STRUCTURE: the game is a SIX-WORLD campaign. Each world = a set of
 * escalating waves culminating in a BOSS, then the next world begins. Worlds
 * ramp enemy count/speed/fire-density and boss HP/phases/patterns world->world
 * (world 1 eases the player in; world 6 is a real gauntlet). Final victory only
 * after world 6's boss dies. Driven by content.worlds[] (each {waves[],boss{}}).
 * Backward compatible: legacy content with a flat content.waves[] is wrapped as a
 * single world. Per-world speed/fire scalars let early worlds play slower.
 *
 * Exposes window.FFG.sim.Shmup AND module.exports (Node-requireable).
 *
 * Determinism: a tiny seeded LCG (mulberry-ish) drives every random choice
 * (enemy x-spawn, drop chance, boss burst spread). Same seed + same input
 * stream => identical run. autoResolve() relies on this.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};
  FFG.sim = FFG.sim || {};

  // ── deterministic RNG ──────────────────────────────────────────────────────
  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ── tuning defaults (overridable via content.config) ───────────────────────
  var DEF = {
    width: 720,
    height: 900,
    lives: 3,
    playerSpeed: 420,        // px/sec keyboard
    playerRadius: 14,
    playerY: 0.86,           // fraction of height
    fireCooldown: 0.135,     // sec between player shots (held fire)
    bulletSpeed: 760,        // player bullets px/sec (up)
    bulletRadius: 6,
    enemyBulletSpeed: 230,   // px/sec (down) — BASE; per-world fireScale tunes it
    enemyBulletRadius: 7,
    maxWeapon: 4,            // weapon level cap (1=single,2=double,3=triple,4=spread5)
    pickupSpeed: 120,
    pickupRadius: 16,
    dropChance: 0.16,        // chance an enemy drops a pickup on death
    invuln: 1.8,             // sec of i-frames after a hit
    comboWindow: 2.2,        // sec to keep the combo alive
    bossHpBase: 140,         // boss hp (used if a world's boss omits hp)
    seed: 1337,
  };

  // Per-world DIFFICULTY scalars (multiply the base tuning). World 1 eases the
  // player in (slow descent, lazy fire, sparse spawns); each later world ramps
  // descent speed, enemy fire rate, and bullet velocity. Index 0 == world 1.
  // A world's content may override its own scalars via world.scale{}.
  var DEF_WORLD_SCALE = [
    { speed: 0.70, fireRate: 0.62, fireSpeed: 0.82, spawnGap: 1.55 }, // W1 — gentle on-ramp
    { speed: 0.82, fireRate: 0.74, fireSpeed: 0.90, spawnGap: 1.30 }, // W2
    { speed: 0.92, fireRate: 0.86, fireSpeed: 0.98, spawnGap: 1.12 }, // W3
    { speed: 1.02, fireRate: 1.00, fireSpeed: 1.06, spawnGap: 0.98 }, // W4
    { speed: 1.14, fireRate: 1.16, fireSpeed: 1.14, spawnGap: 0.88 }, // W5
    { speed: 1.28, fireRate: 1.34, fireSpeed: 1.24, spawnGap: 0.80 }, // W6 — gauntlet
  ];

  // Wave script: each entry spawns a formation. count enemies of a kind, a
  // movement pattern + a fire pattern. (Used only as the legacy single-world
  // fallback if content provides neither worlds[] nor waves[].)
  var DEF_WAVES = [
    { kind: "grunt",  count: 6, hp: 1, pattern: "sineDrift", fire: "aimedSlow", gap: 0.45, delay: 0.6, score: 100 },
    { kind: "grunt",  count: 7, hp: 1, pattern: "swoopV",    fire: "straight",  gap: 0.30, delay: 0.5, score: 100 },
    { kind: "darter", count: 5, hp: 2, pattern: "zigzag",    fire: "aimedSlow", gap: 0.40, delay: 0.7, score: 160 },
  ];

  // Normalize content -> a worlds[] array. Each world: {name?, waves[], boss{},
  // scale{}}. Accepts (in priority order): content.worlds, content.waves(+boss),
  // or the built-in DEF_WAVES single world.
  function buildWorlds(content) {
    var worlds;
    if (content.worlds && content.worlds.length) {
      worlds = content.worlds;
    } else {
      var w = (content.waves && content.waves.length) ? content.waves : DEF_WAVES;
      worlds = [{ name: "ASTEROID FRINGE", waves: w, boss: content.boss || null }];
    }
    return worlds.map(function (wd, i) {
      var scale = Object.assign({}, DEF_WORLD_SCALE[Math.min(i, DEF_WORLD_SCALE.length - 1)], wd.scale || {});
      return {
        name: wd.name || ("WORLD " + (i + 1)),
        waves: (wd.waves && wd.waves.length) ? wd.waves : DEF_WAVES,
        boss: wd.boss || null,
        scale: scale,
      };
    });
  }

  function Shmup(content) {
    content = content || {};
    var cfg = Object.assign({}, DEF, content.config || {});
    cfg.width  = (content.view && content.view.width)  || cfg.width;
    cfg.height = (content.view && content.view.height) || cfg.height;

    this.cfg = cfg;
    this.worlds = buildWorlds(content);
    this.totalWorlds = this.worlds.length;
    this.reset();
  }

  Shmup.prototype.reset = function () {
    var cfg = this.cfg;
    this.rng = makeRng(cfg.seed);
    this.t = 0;
    this.frame = 0;
    this.status = "playing";     // playing | won | lost
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;

    this.player = {
      x: cfg.width / 2,
      y: cfg.height * cfg.playerY,
      lives: cfg.lives,
      weapon: 1,
      fireT: 0,
      invulnT: 1.0,            // brief spawn protection
      alive: true,
    };

    this.pbullets = [];        // player bullets {x,y,vx,vy,r}
    this.ebullets = [];        // enemy bullets  {x,y,vx,vy,r}
    this.enemies = [];         // {id,x,y,hp,maxHp,kind,pat,fire,fireT,phase,baseX,t,r,score}
    this.pickups = [];         // {x,y,vy,kind,r}  kind: 'power'|'spread'
    this.boss = null;

    this._eid = 1;
    // ── world / wave director state ──
    this._worldIndex = 0;          // 0-based; world 1 == index 0
    this._world = this.worlds[0];
    this._waves = this._world.waves;
    this._waveIndex = 0;
    this._waveTimer = ((this._waves[0] && this._waves[0].delay) || 0.6) + 1.1; // world-1 intro beat
    this._spawnLeft = 0;           // enemies still to spawn in current wave
    this._spawnGap = 0;
    this._spawnTimer = 0;
    this._curWave = null;
    this._bossSpawned = false;     // boss spawned for the CURRENT world
    this._interWorldTimer = 0;     // >0 = "WORLD n CLEARED" pause before next world
    this._pendingWorld = false;    // waiting to fire the next-world banner

    this.events = [];
  };

  // Public snapshot for the renderer (no internal churn references leaked).
  Shmup.prototype.state = function () {
    return {
      t: this.t,
      status: this.status,
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      player: this.player,
      pbullets: this.pbullets,
      ebullets: this.ebullets,
      enemies: this.enemies,
      pickups: this.pickups,
      boss: this.boss,
      wave: this._waveIndex,
      totalWaves: this._waves.length,
      world: this._worldIndex,            // 0-based current world
      worldNum: this._worldIndex + 1,     // 1-based for HUD
      totalWorlds: this.totalWorlds,
      worldName: this._world ? this._world.name : "",
      interWorld: this._interWorldTimer > 0,
      cfg: this.cfg,
    };
  };

  Shmup.prototype._emit = function (type, data) {
    var e = data || {};
    e.type = type;
    this.events.push(e);
  };

  // current world's difficulty scalars (always defined; reset() sets _world)
  Shmup.prototype._scale = function () {
    return (this._world && this._world.scale) || { speed: 1, fireRate: 1, fireSpeed: 1, spawnGap: 1 };
  };

  // ── spawning ───────────────────────────────────────────────────────────────
  Shmup.prototype._spawnEnemy = function (wave) {
    var cfg = this.cfg;
    var sc = this._scale();
    var margin = 60;
    var x = margin + this.rng() * (cfg.width - margin * 2);
    var baseVy = wave.kind === "tank" ? 60 : (wave.kind === "darter" ? 130 : 90);
    var e = {
      id: this._eid++,
      kind: wave.kind,
      x: x, baseX: x, y: -40 - this.rng() * 60,
      hp: wave.hp, maxHp: wave.hp,
      pat: wave.pattern, fire: wave.fire,
      // initial fire delay also eased by the world's fire-rate scalar (slower
      // worlds wait longer before their first shot)
      fireT: (0.5 + this.rng() * 1.2) / Math.max(0.25, sc.fireRate),
      t: this.rng() * Math.PI * 2,     // per-enemy phase so a formation isn't lockstep
      r: wave.kind === "tank" ? 22 : (wave.kind === "darter" ? 14 : 16),
      score: wave.score,
      vy: baseVy * sc.speed,            // per-world descent speed
      amp: wave.kind === "weaver" ? 130 : 70,
    };
    this.enemies.push(e);
  };

  Shmup.prototype._spawnBoss = function () {
    var cfg = this.cfg;
    var bdef = (this._world && this._world.boss) || {};
    var hp = bdef.hp || cfg.bossHpBase;
    var maxPhase = bdef.phases || 3;
    this.boss = {
      x: cfg.width / 2, y: -120,
      hp: hp, maxHp: hp,
      r: bdef.r || 64,
      phase: 1, maxPhase: maxPhase,
      // pattern set for this world's boss (drives _bossFire). Later worlds layer
      // on extra patterns (rings, spirals, curtains) for distinct, tougher bosses.
      patterns: (bdef.patterns && bdef.patterns.length) ? bdef.patterns : ["fan3", "ring8", "spray5"],
      name: bdef.name || "DREADNOUGHT",
      // fire cadence scaled by the world (later worlds fire faster)
      fireScale: bdef.fireScale || 1,
      sweepAmp: bdef.sweepAmp != null ? bdef.sweepAmp : 0.27,
      entering: true,
      fireT: 1.4,
      sweepT: 0,
      spiralA: 0,
      t: 0,
      hitFlash: 0,
    };
    this._bossSpawned = true;
    this._emit("bossWarn", { world: this._worldIndex + 1, name: this.boss.name, phases: maxPhase });
  };

  // Begin world `idx` (0-based): reset the wave director onto that world's
  // waves and clear any leftover bullets so a new world starts clean. Fires a
  // "worldStart" event for the renderer's "WORLD n" banner.
  Shmup.prototype._startWorld = function (idx) {
    this._worldIndex = idx;
    this._world = this.worlds[idx];
    this._waves = this._world.waves;
    this._waveIndex = 0;
    this._curWave = null;
    this._spawnLeft = 0;
    this._spawnTimer = 0;
    this._bossSpawned = false;
    this._waveTimer = ((this._waves[0] && this._waves[0].delay) || 0.7) + 0.8; // intro beat
    this.ebullets.length = 0;     // wipe the previous boss's bullet storm
    this._emit("worldStart", { world: idx + 1, total: this.totalWorlds, name: this._world.name });
  };

  // ── enemy movement ───────────────────────────────────────────────────────
  Shmup.prototype._moveEnemy = function (e, dt) {
    e.t += dt;
    e.y += e.vy * dt;
    switch (e.pat) {
      case "sineDrift":
        e.x = e.baseX + Math.sin(e.t * 1.8) * e.amp;
        break;
      case "zigzag":
        e.x = e.baseX + (((e.t * 2.4) % 2 < 1) ? 1 : -1) * Math.min(e.amp, e.t * 60) ;
        e.x = e.baseX + Math.sin(e.t * 3.3) * e.amp; // smoother zigzag
        break;
      case "swoopV":
        e.x = e.baseX + Math.sin(e.t * 1.2) * (e.amp * 1.4);
        e.vy = 70 + Math.max(0, Math.sin(e.t * 1.2)) * 90;
        break;
      case "marchDown":
        e.x = e.baseX + Math.sin(e.t * 0.9) * 26;
        break;
      default:
        e.x = e.baseX + Math.sin(e.t * 1.5) * e.amp;
    }
    e.x = clamp(e.x, 24, this.cfg.width - 24);
  };

  // ── enemy fire patterns ──────────────────────────────────────────────────
  Shmup.prototype._enemyFire = function (e) {
    var cfg = this.cfg, p = this.player;
    var es = cfg.enemyBulletSpeed * this._scale().fireSpeed;   // per-world bullet velocity
    var spawn = function (vx, vy) {
      this.ebullets.push({ x: e.x, y: e.y + e.r * 0.5, vx: vx, vy: vy, r: cfg.enemyBulletRadius });
    }.bind(this);
    var aim = function (sp) {
      var dx = p.x - e.x, dy = (p.y) - e.y;
      var d = Math.hypot(dx, dy) || 1;
      return { vx: dx / d * sp, vy: dy / d * sp };
    };
    switch (e.fire) {
      case "straight":
        spawn(0, es); break;
      case "aimedSlow": {
        var a = aim(es * 0.95); spawn(a.vx, a.vy); break;
      }
      case "aimedFast": {
        var b = aim(es * 1.35); spawn(b.vx, b.vy); break;
      }
      case "spread3": {
        spawn(-es * 0.4, es * 0.9); spawn(0, es); spawn(es * 0.4, es * 0.9); break;
      }
      case "spread5": {
        var aim5 = aim(es); var ang = Math.atan2(aim5.vy, aim5.vx);
        for (var k = -2; k <= 2; k++) { var th = ang + k * 0.20; spawn(Math.cos(th) * es, Math.sin(th) * es); }
        break;
      }
      default: spawn(0, es);
    }
    this._emit("enemyFire", { x: e.x, y: e.y });
  };

  // ── boss fire (PATTERN-driven bullet hell) ──────────────────────────────────
  // The boss carries an ordered patterns[] list (one per phase). HP fraction
  // selects the active phase -> the active pattern. Every pattern keeps the
  // praised "fair but tense" feel: aimed fans have real threadable gaps, rings
  // are downward-biased so there's always an escape lane, spirals rotate slowly.
  // Later worlds compose tougher pattern sets (more phases, denser patterns) so
  // each boss is distinct without becoming an unwinnable wall.
  Shmup.prototype._bossFire = function (b) {
    var cfg = this.cfg, p = this.player;
    var maxPhase = b.maxPhase || 3;
    var hpFrac = b.hp / b.maxHp;
    // phase = ramp from 1..maxPhase as HP drops (last phase below 1/maxPhase HP)
    var phase = Math.min(maxPhase, Math.max(1, Math.ceil((1 - hpFrac) * maxPhase) + (hpFrac >= 1 ? 1 : 0)));
    if (hpFrac >= 0.999) phase = 1;
    b.phase = phase;
    var pats = b.patterns || ["fan3", "ring8", "spray5"];
    var pat = pats[Math.min(phase - 1, pats.length - 1)];

    var s = cfg.enemyBulletSpeed * this._scale().fireSpeed;
    var push = function (vx, vy) {
      this.ebullets.push({ x: b.x, y: b.y + 40, vx: vx, vy: vy, r: cfg.enemyBulletRadius });
    }.bind(this);
    var aimAng = function () {
      var dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
      return Math.atan2(dy / d, dx / d);
    };

    switch (pat) {
      case "fan3": {                 // aimed 3-shot fan (gentle opener)
        var a = aimAng();
        for (var k = -1; k <= 1; k++) { var th = a + k * 0.22; push(Math.cos(th) * s * 1.02, Math.sin(th) * s * 1.02); }
        break;
      }
      case "fan5": {                 // wider aimed 5-shot fan
        var a5 = aimAng();
        for (var j = -2; j <= 2; j++) { var t5 = a5 + j * 0.17; push(Math.cos(t5) * s * 1.08, Math.sin(t5) * s * 1.08); }
        break;
      }
      case "ring8": {                // rotating 8-spoke ring, biased downward (real gaps)
        b.sweepT += 0.55;
        for (var i = 0; i < 8; i++) { var r8 = (i / 8) * Math.PI * 2 + b.sweepT; push(Math.cos(r8) * s * 0.85, Math.sin(r8) * s * 0.75 + s * 0.4); }
        break;
      }
      case "ring12": {               // denser 12-spoke ring, downward-biased
        b.sweepT += 0.42;
        for (var i2 = 0; i2 < 12; i2++) { var r12 = (i2 / 12) * Math.PI * 2 + b.sweepT; push(Math.cos(r12) * s * 0.82, Math.sin(r12) * s * 0.70 + s * 0.45); }
        break;
      }
      case "spiral": {               // slow rotating spiral arm (thread the rotation)
        b.spiralA += 0.55;
        for (var sa = 0; sa < 3; sa++) {
          var ang = b.spiralA + sa * (Math.PI * 2 / 3);
          push(Math.cos(ang) * s * 0.92, Math.abs(Math.sin(ang)) * s * 0.5 + s * 0.5);
        }
        break;
      }
      case "spray5": {               // wide aimed spray + a downward curtain shot
        var base = aimAng();
        for (var m = -2; m <= 2; m++) { var am = base + m * 0.16; push(Math.cos(am) * s * 1.15, Math.sin(am) * s * 1.15); }
        push((-2 + this.rng() * 4) * 30, s * 1.1);
        break;
      }
      case "spray7": {               // brutal wide aimed spray + twin curtains (W6)
        var base7 = aimAng();
        for (var m7 = -3; m7 <= 3; m7++) { var a7 = base7 + m7 * 0.14; push(Math.cos(a7) * s * 1.18, Math.sin(a7) * s * 1.18); }
        push((-3 + this.rng() * 2) * 30, s * 1.05); push((1 + this.rng() * 2) * 30, s * 1.05);
        break;
      }
      case "cross": {                // aimed shot + 4-way cross of curtains
        var ac = aimAng(); push(Math.cos(ac) * s * 1.1, Math.sin(ac) * s * 1.1);
        push(-s * 0.5, s * 0.9); push(s * 0.5, s * 0.9); push(-s * 0.25, s); push(s * 0.25, s);
        break;
      }
      default: {
        var ad = aimAng();
        for (var kk = -1; kk <= 1; kk++) { var thd = ad + kk * 0.22; push(Math.cos(thd) * s * 1.02, Math.sin(thd) * s * 1.02); }
      }
    }
    this._emit("bossFire", { x: b.x, y: b.y, phase: phase, pattern: pat });
  };

  // ── circle collision ───────────────────────────────────────────────────────
  function hit(ax, ay, ar, bx, by, br) {
    var dx = ax - bx, dy = ay - by, rr = ar + br;
    return dx * dx + dy * dy <= rr * rr;
  }

  Shmup.prototype._addScore = function (n, x, y) {
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = this.cfg.comboWindow;
    var mult = 1 + Math.floor((this.combo - 1) / 4) * 0.5; // every 4 kills +0.5x
    var gained = Math.round(n * mult);
    this.score += gained;
    this._emit("score", { x: x, y: y, amount: gained, combo: this.combo, mult: mult });
  };

  Shmup.prototype._maybeDrop = function (x, y) {
    if (this.rng() < this.cfg.dropChance) {
      var kind = this.rng() < 0.5 ? "power" : "spread";
      this.pickups.push({ x: x, y: y, vy: this.cfg.pickupSpeed, kind: kind, r: this.cfg.pickupRadius });
    }
  };

  Shmup.prototype._damagePlayer = function () {
    var p = this.player;
    if (p.invulnT > 0 || this.status !== "playing") return;
    p.lives -= 1;
    p.invulnT = this.cfg.invuln;
    p.weapon = Math.max(1, p.weapon - 1); // lose a weapon level on hit
    this.combo = 0; this.comboTimer = 0;
    this._emit("playerHit", { x: p.x, y: p.y, lives: p.lives });
    if (p.lives <= 0) {
      p.alive = false;
      this.status = "lost";
      this._emit("lose", { x: p.x, y: p.y, score: this.score });
    }
  };

  // ── player fire (weapon levels) ─────────────────────────────────────────────
  Shmup.prototype._playerFire = function () {
    var cfg = this.cfg, p = this.player;
    var sp = cfg.bulletSpeed, r = cfg.bulletRadius;
    var add = function (vx, vy, ox) {
      this.pbullets.push({ x: p.x + (ox || 0), y: p.y - 18, vx: vx, vy: vy, r: r });
    }.bind(this);
    switch (p.weapon) {
      case 1: add(0, -sp); break;
      case 2: add(0, -sp, -9); add(0, -sp, 9); break;
      case 3: add(0, -sp); add(-sp * 0.22, -sp * 0.97, -10); add(sp * 0.22, -sp * 0.97, 10); break;
      default: // 4+ : 5-way spread
        add(0, -sp);
        add(-sp * 0.18, -sp * 0.98, -8); add(sp * 0.18, -sp * 0.98, 8);
        add(-sp * 0.38, -sp * 0.92, -16); add(sp * 0.38, -sp * 0.92, 16);
    }
    p.fireT = cfg.fireCooldown;
    this._emit("muzzle", { x: p.x, y: p.y - 18, weapon: p.weapon });
  };

  // ── main step ───────────────────────────────────────────────────────────────
  // input: { left, right, up, down, fire, moveTo:{x,y}|null }
  Shmup.prototype.step = function (dt, input) {
    this.events = [];
    if (this.status !== "playing") return this.events;
    dt = clamp(dt, 0, 0.05);   // cap to keep determinism + stability
    this.t += dt; this.frame++;
    input = input || {};
    var cfg = this.cfg, p = this.player;

    // combo decay
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }

    // ── player movement ──
    if (p.alive) {
      if (input.moveTo) {
        // pointer steering: ease toward target
        var tx = clamp(input.moveTo.x, cfg.playerRadius, cfg.width - cfg.playerRadius);
        var ty = clamp(input.moveTo.y, cfg.height * 0.45, cfg.height - cfg.playerRadius);
        p.x += (tx - p.x) * Math.min(1, dt * 16);
        p.y += (ty - p.y) * Math.min(1, dt * 16);
      } else {
        var mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        var my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        if (mx && my) { var inv = 0.7071; mx *= inv; my *= inv; }
        p.x = clamp(p.x + mx * cfg.playerSpeed * dt, cfg.playerRadius, cfg.width - cfg.playerRadius);
        p.y = clamp(p.y + my * cfg.playerSpeed * dt, cfg.height * 0.45, cfg.height - cfg.playerRadius);
      }
      if (p.invulnT > 0) p.invulnT -= dt;
      // fire (held)
      p.fireT -= dt;
      if (input.fire && p.fireT <= 0) this._playerFire();
    }

    // ── world / wave / boss director ──
    // Inter-world pause: after a boss dies (and more worlds remain) we hold a
    // beat on the "WORLD n CLEARED" banner, then start the next world's intro.
    if (this._interWorldTimer > 0) {
      this._interWorldTimer -= dt;
      if (this._interWorldTimer <= 0) this._startWorld(this._worldIndex + 1);
    } else if (!this._bossSpawned) {
      var sc = this._scale();
      if (this._curWave === null) {
        // waiting to start next wave
        this._waveTimer -= dt;
        if (this._waveTimer <= 0) {
          if (this._waveIndex < this._waves.length) {
            this._curWave = this._waves[this._waveIndex];
            this._spawnLeft = this._curWave.count;
            this._spawnGap = (this._curWave.gap || 0.4) * sc.spawnGap;  // slower cadence early
            this._spawnTimer = 0;
          } else {
            // all waves done -> this world's BOSS
            this._spawnBoss();
          }
        }
      } else {
        // spawning the current wave
        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0 && this._spawnLeft > 0) {
          this._spawnEnemy(this._curWave);
          this._spawnLeft--;
          this._spawnTimer = this._spawnGap;
        }
        // wave considered done when all spawned AND board cleared of this wave
        if (this._spawnLeft <= 0 && this.enemies.length === 0) {
          this._waveIndex++;
          this._curWave = null;
          this._waveTimer = ((this._waves[this._waveIndex] && this._waves[this._waveIndex].delay) || 0.8) * sc.spawnGap;
          this._emit("waveClear", { wave: this._waveIndex, world: this._worldIndex + 1 });
        }
      }
    }

    // ── move enemies + their fire ──
    var fireRate = this._scale().fireRate;   // per-world fire frequency (early worlds < 1)
    for (var ei = this.enemies.length - 1; ei >= 0; ei--) {
      var e = this.enemies[ei];
      this._moveEnemy(e, dt);
      if (e.y > cfg.height + 60) { this.enemies.splice(ei, 1); continue; } // off-screen, gone
      if (e.y > 20) { // only fire once on screen
        e.fireT -= dt;
        if (e.fireT <= 0) {
          this._enemyFire(e);
          // slower worlds reload more slowly (divide cooldown by fireRate<1 => longer)
          e.fireT = ((e.kind === "tank" ? 1.3 : 1.7) + this.rng() * 0.6) / Math.max(0.25, fireRate);
        }
      }
    }

    // ── boss update ──
    if (this.boss) {
      var b = this.boss;
      b.t += dt;
      if (b.hitFlash > 0) b.hitFlash -= dt;
      if (b.entering) {
        b.y += 90 * dt;
        if (b.y >= cfg.height * 0.18) { b.y = cfg.height * 0.18; b.entering = false; }
      } else {
        // sweep side to side, faster as hp drops
        var spd = 0.9 + (1 - b.hp / b.maxHp) * 1.4;
        b.x = cfg.width / 2 + Math.sin(b.t * spd) * (cfg.width * b.sweepAmp);
        b.fireT -= dt;
        // cadence by phase, then scaled by the world boss's fireScale (>1 = faster)
        var maxP = b.maxPhase || 3;
        var baseRate = 1.08 - (b.phase - 1) / Math.max(1, maxP - 1) * 0.5;  // 1.08 -> ~0.58
        var rate = baseRate / Math.max(0.3, b.fireScale);
        if (b.fireT <= 0) { this._bossFire(b); b.fireT = rate; }
      }
    }

    // ── advance bullets ──
    var i, bdat;
    for (i = this.pbullets.length - 1; i >= 0; i--) {
      bdat = this.pbullets[i];
      bdat.x += bdat.vx * dt; bdat.y += bdat.vy * dt;
      if (bdat.y < -20 || bdat.x < -20 || bdat.x > cfg.width + 20) this.pbullets.splice(i, 1);
    }
    for (i = this.ebullets.length - 1; i >= 0; i--) {
      bdat = this.ebullets[i];
      bdat.x += bdat.vx * dt; bdat.y += bdat.vy * dt;
      if (bdat.y > cfg.height + 20 || bdat.y < -40 || bdat.x < -30 || bdat.x > cfg.width + 30) this.ebullets.splice(i, 1);
    }

    // ── advance pickups ──
    for (i = this.pickups.length - 1; i >= 0; i--) {
      var pk = this.pickups[i];
      pk.y += pk.vy * dt;
      if (pk.y > cfg.height + 30) { this.pickups.splice(i, 1); continue; }
      if (p.alive && hit(pk.x, pk.y, pk.r, p.x, p.y, cfg.playerRadius + 6)) {
        if (pk.kind === "power" || pk.kind === "spread") p.weapon = Math.min(cfg.maxWeapon, p.weapon + 1);
        this._emit("pickup", { x: pk.x, y: pk.y, kind: pk.kind, weapon: p.weapon });
        this.pickups.splice(i, 1);
      }
    }

    // ── player bullets vs enemies + boss ──
    for (i = this.pbullets.length - 1; i >= 0; i--) {
      bdat = this.pbullets[i];
      var consumed = false;
      for (var j = this.enemies.length - 1; j >= 0; j--) {
        var en = this.enemies[j];
        if (hit(bdat.x, bdat.y, bdat.r, en.x, en.y, en.r)) {
          en.hp -= 1;
          this._emit("hit", { x: bdat.x, y: bdat.y, target: "enemy" });
          this.pbullets.splice(i, 1); consumed = true;
          if (en.hp <= 0) {
            this._addScore(en.score, en.x, en.y);
            this._maybeDrop(en.x, en.y);
            this._emit("kill", { x: en.x, y: en.y, kind: en.kind });
            this.enemies.splice(j, 1);
          }
          break;
        }
      }
      if (consumed) continue;
      if (this.boss && !this.boss.entering && hit(bdat.x, bdat.y, bdat.r, this.boss.x, this.boss.y, this.boss.r)) {
        this.boss.hp -= 1;
        this.boss.hitFlash = 0.06;
        this._emit("hit", { x: bdat.x, y: bdat.y, target: "boss" });
        this.pbullets.splice(i, 1);
        if (this.boss.hp <= 0) {
          var bx = this.boss.x, by = this.boss.y;
          this._emit("bossKill", { x: bx, y: by, world: this._worldIndex + 1 });
          // boss reward scales with world (later bosses are worth more)
          this.score += 3000 + this._worldIndex * 1500;
          this.boss = null;
          if (this._worldIndex >= this.totalWorlds - 1) {
            // FINAL world cleared -> victory
            this.status = "won";
            this._emit("win", { x: p.x, y: p.y, score: this.score, world: this._worldIndex + 1 });
          } else {
            // more worlds remain -> "WORLD n CLEARED", then start the next world
            this._emit("worldClear", { world: this._worldIndex + 1, total: this.totalWorlds });
            this._interWorldTimer = 2.4;   // pause on the cleared banner
          }
        }
      }
    }

    // ── enemy bullets vs player ──
    if (p.alive && p.invulnT <= 0) {
      for (i = this.ebullets.length - 1; i >= 0; i--) {
        bdat = this.ebullets[i];
        if (hit(bdat.x, bdat.y, bdat.r, p.x, p.y, cfg.playerRadius)) {
          this.ebullets.splice(i, 1);
          this._damagePlayer();
          break;
        }
      }
    }
    // body-block: enemy/boss touching player also hurts
    if (p.alive && p.invulnT <= 0) {
      for (i = this.enemies.length - 1; i >= 0; i--) {
        var ce = this.enemies[i];
        if (hit(ce.x, ce.y, ce.r, p.x, p.y, cfg.playerRadius)) {
          this._emit("kill", { x: ce.x, y: ce.y, kind: ce.kind });
          this.enemies.splice(i, 1);
          this._damagePlayer();
          break;
        }
      }
    }

    return this.events;
  };

  // ── deterministic AI bot input (shared by autoResolve + test fastForward) ────
  // A competent player: picks a DPS target (leads the boss so straight-up shots
  // connect; else nearest enemy / a nearby pickup) then does DIRECTIONAL
  // LOOKAHEAD dodging — it evaluates the 9 moves it can make THIS frame, sims
  // each forward ~0.23s against straight-line bullet paths, and chooses the move
  // with the largest safety margin. Safety is a THRESHOLD: once a move is "safe
  // enough", aggression (aim + low hold line) decides, so it lands hits while
  // dodging. With NO real input this reliably defeats the boss.
  Shmup.prototype._botInput = function () {
    var cfg = this.cfg, p = this.player, dt = 1 / 60;
    var targetX = p.x, pickupX = null;
    if (this.boss && !this.boss.entering) {
      var bz = this.boss;
      var tTravel = (p.y - bz.y) / cfg.bulletSpeed;
      var bspd = 0.9 + (1 - bz.hp / bz.maxHp) * 1.4;
      var bvx = Math.cos(bz.t * bspd) * (cfg.width * bz.sweepAmp) * bspd;
      targetX = clamp(bz.x + bvx * tTravel * 0.9, cfg.playerRadius, cfg.width - cfg.playerRadius);
    } else if (this.enemies.length) {
      var best = null, bestD = 1e9;
      for (var k = 0; k < this.enemies.length; k++) {
        var e = this.enemies[k];
        var d = Math.abs(e.x - p.x) + (e.y < p.y ? 0 : 600);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) targetX = best.x;
    }
    for (var pu = 0; pu < this.pickups.length; pu++) {
      var pk = this.pickups[pu];
      if (pk.y > p.y - 320 && pk.y < p.y + 40 && Math.abs(pk.x - p.x) < 180) { pickupX = pk.x; break; }
    }

    var aimX = (pickupX != null) ? pickupX : targetX;
    var holdY = cfg.height * 0.84;
    var spd = cfg.playerSpeed, R = cfg.playerRadius;
    var look = 14;
    var dirs = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    var bestDir = dirs[0], bestScore = -Infinity;
    var lo = R, hi = cfg.width - R, yTop = cfg.height * 0.45, yBot = cfg.height - R;
    for (var di = 0; di < dirs.length; di++) {
      var dvx = dirs[di][0], dvy = dirs[di][1];
      if (dvx && dvy) { dvx *= 0.7071; dvy *= 0.7071; }
      var minMargin = 1e9;
      for (var f = 1; f <= look; f++) {
        var tf = f * dt;
        var sx = clamp(p.x + dvx * spd * tf, lo, hi);
        var sy = clamp(p.y + dvy * spd * tf, yTop, yBot);
        for (var bi = 0; bi < this.ebullets.length; bi++) {
          var bb = this.ebullets[bi];
          var bx = bb.x + bb.vx * tf, by = bb.y + bb.vy * tf;
          var ddx = bx - sx, ddy = by - sy;
          var margin = Math.sqrt(ddx * ddx + ddy * ddy) - (R + bb.r);
          if (margin < minMargin) minMargin = margin;
        }
      }
      var SAFE = 46;
      var endX = clamp(p.x + dvx * spd * (look * dt), lo, hi);
      var endY = clamp(p.y + dvy * spd * (look * dt), yTop, yBot);
      var safety = Math.min(minMargin, SAFE) * 6;
      var aggression = -Math.abs(endX - aimX) * 0.9 - Math.abs(endY - holdY) * 0.5;
      var score = safety + aggression - (dvx === 0 && dvy === 0 ? 0 : 0.5);
      if (score > bestScore) { bestScore = score; bestDir = [dirs[di][0], dirs[di][1]]; }
    }
    return {
      left: bestDir[0] < 0, right: bestDir[0] > 0,
      up: bestDir[1] < 0, down: bestDir[1] > 0,
      fire: true, moveTo: null,
    };
  };

  // ── headless fast-resolve for the feel-gate ─────────────────────────────────
  // Plays the WHOLE six-world campaign with the deterministic AI bot until it
  // beats world 6's boss (win) or dies (lose), with NO real input. Proves the
  // campaign is playable end to end. ALWAYS terminates: capped at maxSeconds of
  // fixed steps. Default budget scales with the number of worlds (a full clean
  // 6-world run is long), but the loop also exits the instant status changes.
  Shmup.prototype.autoResolve = function (maxSeconds) {
    // ~110s/world headroom (doubled waves + a multi-phase boss + inter-world
    // beat each take real game-time), min 150s. A clean bot 6-world run lands
    // around ~575s, so 660s leaves comfortable margin.
    if (maxSeconds == null) maxSeconds = Math.max(150, this.totalWorlds * 110);
    var dt = 1 / 60;
    var steps = Math.floor(maxSeconds / dt);
    for (var n = 0; n < steps && this.status === "playing"; n++) {
      this.step(dt, this._botInput());
    }
    return {
      ended: this.status !== "playing",
      victory: this.status === "won",
      status: this.status,
      world: this._worldIndex + 1,        // 1-based world the run reached
      totalWorlds: this.totalWorlds,
      score: this.score,
      bestCombo: this.bestCombo,
      seconds: this.t,
      frames: this.frame,
      timedOut: this.status === "playing", // true only if it hit the iteration cap
    };
  };

  Shmup.makeRng = makeRng; // exported for tests/determinism checks

  FFG.sim.Shmup = Shmup;
  if (typeof module !== "undefined" && module.exports) module.exports = Shmup;
})(typeof window !== "undefined" ? window : globalThis);
