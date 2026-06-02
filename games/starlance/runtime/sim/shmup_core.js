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
    enemyBulletSpeed: 230,   // px/sec (down)
    enemyBulletRadius: 7,
    maxWeapon: 4,            // weapon level cap (1=single,2=double,3=triple,4=spread5)
    pickupSpeed: 120,
    pickupRadius: 16,
    dropChance: 0.16,        // chance an enemy drops a pickup on death
    invuln: 1.8,             // sec of i-frames after a hit
    comboWindow: 2.2,        // sec to keep the combo alive
    bossHpBase: 140,         // boss hp (scaled by phases)
    seed: 1337,
  };

  // Wave script: each entry spawns a formation. count enemies of a kind, a
  // movement pattern + a fire pattern. After the last wave, the BOSS arrives.
  var DEF_WAVES = [
    { kind: "grunt",  count: 6, hp: 1, pattern: "sineDrift", fire: "aimedSlow", gap: 0.45, delay: 0.6, score: 100 },
    { kind: "grunt",  count: 7, hp: 1, pattern: "swoopV",    fire: "straight",  gap: 0.30, delay: 0.5, score: 100 },
    { kind: "darter", count: 5, hp: 2, pattern: "zigzag",    fire: "aimedSlow", gap: 0.40, delay: 0.7, score: 160 },
    { kind: "weaver", count: 8, hp: 1, pattern: "sineDrift", fire: "spread3",   gap: 0.26, delay: 0.4, score: 120 },
    { kind: "tank",   count: 4, hp: 4, pattern: "marchDown", fire: "aimedFast", gap: 0.7,  delay: 0.8, score: 260 },
  ];

  function Shmup(content) {
    content = content || {};
    var cfg = Object.assign({}, DEF, content.config || {});
    cfg.width  = (content.view && content.view.width)  || cfg.width;
    cfg.height = (content.view && content.view.height) || cfg.height;
    var waves = (content.waves && content.waves.length) ? content.waves : DEF_WAVES;

    this.cfg = cfg;
    this.waves = waves;
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
    this._waveIndex = 0;
    this._waveTimer = (this.waves[0] && this.waves[0].delay) || 0.6;
    this._spawnLeft = 0;       // enemies still to spawn in current wave
    this._spawnGap = 0;
    this._spawnTimer = 0;
    this._curWave = null;
    this._bossSpawned = false;

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
      totalWaves: this.waves.length,
      cfg: this.cfg,
    };
  };

  Shmup.prototype._emit = function (type, data) {
    var e = data || {};
    e.type = type;
    this.events.push(e);
  };

  // ── spawning ───────────────────────────────────────────────────────────────
  Shmup.prototype._spawnEnemy = function (wave) {
    var cfg = this.cfg;
    var margin = 60;
    var x = margin + this.rng() * (cfg.width - margin * 2);
    var e = {
      id: this._eid++,
      kind: wave.kind,
      x: x, baseX: x, y: -40 - this.rng() * 60,
      hp: wave.hp, maxHp: wave.hp,
      pat: wave.pattern, fire: wave.fire,
      fireT: 0.4 + this.rng() * 1.1,
      t: this.rng() * Math.PI * 2,     // per-enemy phase so a formation isn't lockstep
      r: wave.kind === "tank" ? 22 : (wave.kind === "darter" ? 14 : 16),
      score: wave.score,
      vy: wave.kind === "tank" ? 60 : (wave.kind === "darter" ? 130 : 90),
      amp: wave.kind === "weaver" ? 130 : 70,
    };
    this.enemies.push(e);
  };

  Shmup.prototype._spawnBoss = function () {
    var cfg = this.cfg;
    var hp = cfg.bossHpBase;
    this.boss = {
      x: cfg.width / 2, y: -120,
      hp: hp, maxHp: hp,
      r: 64,
      phase: 1, maxPhase: 3,
      entering: true,
      fireT: 1.4,
      sweepT: 0,
      t: 0,
      hitFlash: 0,
    };
    this._bossSpawned = true;
    this._emit("bossWarn", {});
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
        spawn(0, cfg.enemyBulletSpeed); break;
      case "aimedSlow": {
        var a = aim(cfg.enemyBulletSpeed * 0.95); spawn(a.vx, a.vy); break;
      }
      case "aimedFast": {
        var b = aim(cfg.enemyBulletSpeed * 1.35); spawn(b.vx, b.vy); break;
      }
      case "spread3": {
        var s = cfg.enemyBulletSpeed;
        spawn(-s * 0.4, s * 0.9); spawn(0, s); spawn(s * 0.4, s * 0.9); break;
      }
      default: spawn(0, cfg.enemyBulletSpeed);
    }
    this._emit("enemyFire", { x: e.x, y: e.y });
  };

  // ── boss fire (phase-dependent bullet hell) ─────────────────────────────────
  Shmup.prototype._bossFire = function (b) {
    var cfg = this.cfg, p = this.player;
    var hpFrac = b.hp / b.maxHp;
    var phase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
    b.phase = phase;
    var s = cfg.enemyBulletSpeed;
    var push = function (vx, vy) {
      this.ebullets.push({ x: b.x, y: b.y + 40, vx: vx, vy: vy, r: cfg.enemyBulletRadius });
    }.bind(this);

    if (phase === 1) {
      // aimed 3-shot fan
      var dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
      var ax = dx / d, ay = dy / d;
      for (var k = -1; k <= 1; k++) {
        var ang = Math.atan2(ay, ax) + k * 0.22;
        push(Math.cos(ang) * s * 1.05, Math.sin(ang) * s * 1.05);
      }
    } else if (phase === 2) {
      // rotating ring (8 spokes, biased downward so there are real gaps to thread)
      b.sweepT += 0.55;
      var n = 8;
      for (var i = 0; i < n; i++) {
        var th = (i / n) * Math.PI * 2 + b.sweepT;
        push(Math.cos(th) * s * 0.85, Math.sin(th) * s * 0.75 + s * 0.4);
      }
    } else {
      // phase 3: wide aimed spray + downward curtain
      var dx2 = p.x - b.x, dy2 = p.y - b.y, d2 = Math.hypot(dx2, dy2) || 1;
      var base = Math.atan2(dy2 / d2, dx2 / d2);
      for (var j = -2; j <= 2; j++) {
        var a2 = base + j * 0.16;
        push(Math.cos(a2) * s * 1.15, Math.sin(a2) * s * 1.15);
      }
      var cx = -2 + this.rng() * 4;
      push(cx * 30, s * 1.1);
    }
    this._emit("bossFire", { x: b.x, y: b.y, phase: phase });
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

    // ── wave / boss director ──
    if (!this._bossSpawned) {
      if (this._curWave === null) {
        // waiting to start next wave
        this._waveTimer -= dt;
        if (this._waveTimer <= 0) {
          if (this._waveIndex < this.waves.length) {
            this._curWave = this.waves[this._waveIndex];
            this._spawnLeft = this._curWave.count;
            this._spawnGap = this._curWave.gap;
            this._spawnTimer = 0;
          } else {
            // all waves done -> boss
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
          this._waveTimer = (this.waves[this._waveIndex] && this.waves[this._waveIndex].delay) || 0.8;
          this._emit("waveClear", { wave: this._waveIndex });
        }
      }
    }

    // ── move enemies + their fire ──
    for (var ei = this.enemies.length - 1; ei >= 0; ei--) {
      var e = this.enemies[ei];
      this._moveEnemy(e, dt);
      if (e.y > cfg.height + 60) { this.enemies.splice(ei, 1); continue; } // off-screen, gone
      if (e.y > 20) { // only fire once on screen
        e.fireT -= dt;
        if (e.fireT <= 0) {
          this._enemyFire(e);
          e.fireT = (e.kind === "tank" ? 1.3 : 1.7) + this.rng() * 0.6;
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
        b.x = cfg.width / 2 + Math.sin(b.t * spd) * (cfg.width * 0.27);
        b.fireT -= dt;
        var rate = b.phase === 3 ? 0.62 : b.phase === 2 ? 0.95 : 1.05;
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
          this._emit("bossKill", { x: this.boss.x, y: this.boss.y });
          this.score += 5000;
          this.boss = null;
          this.status = "won";
          this._emit("win", { x: p.x, y: p.y, score: this.score });
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
      var bvx = Math.cos(bz.t * bspd) * (cfg.width * 0.27) * bspd;
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
  // Plays the whole game with the deterministic AI bot until win or lose, with
  // NO real input. Proves the game is winnable (boss death / win path).
  Shmup.prototype.autoResolve = function (maxSeconds) {
    maxSeconds = maxSeconds || 150;
    var dt = 1 / 60;
    var steps = Math.floor(maxSeconds / dt);
    for (var n = 0; n < steps && this.status === "playing"; n++) {
      this.step(dt, this._botInput());
    }
    return {
      ended: this.status !== "playing",
      victory: this.status === "won",
      status: this.status,
      score: this.score,
      bestCombo: this.bestCombo,
      seconds: this.t,
      frames: this.frame,
    };
  };

  Shmup.makeRng = makeRng; // exported for tests/determinism checks

  FFG.sim.Shmup = Shmup;
  if (typeof module !== "undefined" && module.exports) module.exports = Shmup;
})(typeof window !== "undefined" ? window : globalThis);
