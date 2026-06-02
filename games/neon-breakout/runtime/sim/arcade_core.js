/**
 * FFG runtime — sim/arcade_core.js
 * PURE brick-breaker logic. NO Phaser, NO DOM, NO rendering. The juicy renderer
 * (ffg_arcade.js) drives this and turns the returned events into particles,
 * shockwaves, shake, combo floaters, etc.
 *
 * Deterministic: every random decision (brick layout jitter, power-up drops,
 * launch angle) flows through a seeded mulberry32 RNG so a headless feel-gate can
 * call autoResolve() and get a stable, reproducible play-through.
 *
 * Model
 *   - bricks: rows x cols grid, each {x,y,w,h,hp,maxHp,points,kind,alive}
 *   - ball(s): {x,y,vx,vy,r,stuck}  (multiball power-up can add more)
 *   - paddle: {x (center), y, w, h}  — renderer feeds desired paddleX each step
 *   - lives, score, combo (resets when the ball touches the paddle), win/lose
 *   - power-ups: falling capsules {x,y,vy,kind} -> caught by paddle apply effects
 *
 * step(dt, paddleX) advances physics by dt seconds (sub-stepped for tunnelling
 * safety) and returns an array of EVENTS this frame:
 *   {t:"brick", x,y,color,points,combo,destroyed, last}    a brick was hit
 *   {t:"wall",  x,y, side}                                  ball bounced off a wall
 *   {t:"paddle",x,y, hitPos}                               ball bounced off paddle
 *   {t:"drop",  x,y, kind}                                  a power-up started falling
 *   {t:"power", kind, x,y}                                  a power-up was caught
 *   {t:"life",  lives}                                      a ball was lost (life down)
 *   {t:"launch",x,y,vx,vy}                                  a ball was launched
 *   {t:"win"} | {t:"lose"}                                  run resolved
 *
 * Dual export: Node require() (unit tests / feel-gate) and window.FFG.sim.Arcade.
 */
(function (root) {
  "use strict";

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
  function sign(v) { return v < 0 ? -1 : 1; }

  // Keep a ball lively: re-normalize to `speed` and guarantee a minimum |vx| and
  // |vy| so it can never settle into a pure-vertical "one column forever" loop or
  // a pure-horizontal "skim the ceiling" loop (the two classic breakout
  // degeneracies). Mutates the ball in place. Preserves direction signs.
  function relax(b, speed, minFrac) {
    var sp = speed || Math.hypot(b.vx, b.vy) || 1;
    minFrac = minFrac == null ? 0.26 : minFrac;
    var sx = b.vx >= 0 ? 1 : -1, sy = b.vy >= 0 ? 1 : -1;
    var ax = Math.abs(b.vx), ay = Math.abs(b.vy);
    var minC = sp * minFrac;
    if (ax < minC) ax = minC;
    if (ay < minC) ay = minC;
    // Re-normalize the (ax,ay) magnitude back to sp.
    var m = Math.hypot(ax, ay) || 1;
    b.vx = sx * (ax / m) * sp;
    b.vy = sy * (ay / m) * sp;
  }

  // Power-up kinds. weight = relative drop frequency. Renderer maps kind->color/icon.
  var POWER_KINDS = [
    { kind: "expand",   weight: 22 }, // wider paddle
    { kind: "multi",    weight: 16 }, // split into 3 balls
    { kind: "slow",     weight: 16 }, // slow the ball down (easier)
    { kind: "life",     weight: 8  }, // +1 life
    { kind: "laser",    weight: 14 }, // paddle can shoot (renderer cosmetic + sim score)
    { kind: "score",    weight: 24 }, // bonus points
  ];

  var DEFAULTS = {
    width: 960, height: 600,
    rows: 6, cols: 11,
    brickGapX: 6, brickGapY: 6,
    brickTop: 70, brickH: 26,
    sideMargin: 30,
    paddleW: 130, paddleH: 16, paddleY: 560,
    ballR: 8, ballSpeed: 380, ballSpeedMax: 720,
    lives: 3,
    dropChance: 0.16,           // chance a destroyed brick drops a power-up
    dropSpeed: 150,
    comboPointStep: 1,          // each brick in a combo adds combo*step*basePoints/... bonus
    seed: 1337,
    // row scoring/hardness profile (top rows = tougher + worth more)
    rowProfile: null,           // optional [{hp,points}] per row, else auto
  };

  function Arcade(config) {
    config = config || {};
    var c = {};
    for (var k in DEFAULTS) c[k] = (config[k] != null ? config[k] : DEFAULTS[k]);
    this.cfg = c;
    this.rng = config.rng || mulberry32(typeof c.seed === "number" ? c.seed : 1337);

    this.W = c.width; this.H = c.height;
    this.score = 0;
    this.lives = c.lives;
    this.combo = 0;
    this.maxCombo = 0;
    this.ended = false;
    this.victory = false;
    this.paused = false;
    this.events = [];
    this._time = 0;
    this._laser = false;       // laser power active
    this._slowUntil = 0;       // ball-slow timer
    this._baseSpeed = c.ballSpeed;

    this.paddle = {
      x: this.W / 2,
      y: c.paddleY,
      w: c.paddleW,
      h: c.paddleH,
      baseW: c.paddleW,
      expandUntil: 0,
    };

    this.balls = [];
    this.drops = [];           // falling power-ups
    this._buildBricks();
    this._spawnBall(true);     // first ball starts stuck to the paddle
  }

  Arcade.prototype._buildBricks = function () {
    var c = this.cfg;
    var usableW = this.W - c.sideMargin * 2;
    var bw = (usableW - (c.cols - 1) * c.brickGapX) / c.cols;
    var bricks = [];
    this.brickCount = 0;
    for (var r = 0; r < c.rows; r++) {
      var prof = c.rowProfile && c.rowProfile[r];
      // Auto profile: top rows tougher. Top row hp grows; points scale with hp.
      var hp = prof ? prof.hp : (1 + Math.floor((c.rows - 1 - r) / 2)); // 1..~3
      var pts = prof ? prof.points : (hp * 50);
      for (var col = 0; col < c.cols; col++) {
        var x = c.sideMargin + col * (bw + c.brickGapX) + bw / 2;
        var y = c.brickTop + r * (c.brickH + c.brickGapY) + c.brickH / 2;
        bricks.push({
          col: col, row: r,
          x: x, y: y, w: bw, h: c.brickH,
          hp: hp, maxHp: hp, points: pts,
          kind: hp >= 3 ? "hard" : (hp === 2 ? "tough" : "normal"),
          alive: true,
        });
        this.brickCount++;
      }
    }
    this.bricks = bricks;
    this.brickW = bw;
  };

  Arcade.prototype._spawnBall = function (stuck) {
    var c = this.cfg;
    var b = {
      x: this.paddle.x,
      y: this.paddle.y - c.ballR - 2,
      vx: 0, vy: 0,
      r: c.ballR,
      stuck: !!stuck,
    };
    this.balls.push(b);
    return b;
  };

  // Launch every stuck ball (called on player input / autoplay).
  Arcade.prototype.launch = function () {
    if (this.ended) return;
    var c = this.cfg, launched = false;
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      if (b.stuck) {
        b.stuck = false;
        // Launch up at a lively angle, slight randomized lean.
        var ang = (-Math.PI / 2) + (this.rng() - 0.5) * (Math.PI / 6);
        var sp = this._curSpeed();
        b.vx = Math.cos(ang) * sp;
        b.vy = Math.sin(ang) * sp;
        this.events.push({ t: "launch", x: b.x, y: b.y, vx: b.vx, vy: b.vy });
        launched = true;
      }
    }
    return launched;
  };

  Arcade.prototype._curSpeed = function () {
    return (this._time < this._slowUntil) ? this._baseSpeed * 0.62 : this._baseSpeed;
  };

  Arcade.prototype._weightedPower = function () {
    var total = 0, i;
    for (i = 0; i < POWER_KINDS.length; i++) total += POWER_KINDS[i].weight;
    var roll = this.rng() * total;
    for (i = 0; i < POWER_KINDS.length; i++) {
      roll -= POWER_KINDS[i].weight;
      if (roll <= 0) return POWER_KINDS[i].kind;
    }
    return POWER_KINDS[0].kind;
  };

  Arcade.prototype._applyPower = function (kind, x, y) {
    var c = this.cfg;
    this.events.push({ t: "power", kind: kind, x: x, y: y });
    switch (kind) {
      case "expand":
        this.paddle.w = Math.min(this.paddle.baseW * 1.6, this.W * 0.5);
        this.paddle.expandUntil = this._time + 12;
        break;
      case "multi":
        this._splitBalls();
        break;
      case "slow":
        this._slowUntil = this._time + 9;
        break;
      case "life":
        this.lives += 1;
        break;
      case "laser":
        this._laser = true;
        this.score += 50;
        break;
      case "score":
        this.score += 250;
        break;
    }
  };

  Arcade.prototype._splitBalls = function () {
    var moving = [];
    for (var i = 0; i < this.balls.length; i++) if (!this.balls[i].stuck) moving.push(this.balls[i]);
    if (moving.length === 0) return;
    var src = moving[0];
    var sp = Math.hypot(src.vx, src.vy) || this._curSpeed();
    var baseAng = Math.atan2(src.vy, src.vx);
    var spread = [-0.35, 0.35];
    for (var s = 0; s < spread.length; s++) {
      if (this.balls.length >= 6) break; // cap
      var ang = baseAng + spread[s];
      this.balls.push({
        x: src.x, y: src.y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        r: src.r, stuck: false,
      });
    }
  };

  // Resolve a ball vs a single brick AABB. Returns true on collision (and pushes
  // the brick event + handles hp/destroy/score/combo + power-up drop).
  Arcade.prototype._ballVsBrick = function (b, br) {
    if (!br.alive) return false;
    var hw = br.w / 2 + b.r, hh = br.h / 2 + b.r;
    var dx = b.x - br.x, dy = b.y - br.y;
    if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) return false;

    // Determine the shallower penetration axis to reflect correctly.
    var ox = hw - Math.abs(dx);
    var oy = hh - Math.abs(dy);
    if (ox < oy) {
      b.x += sign(dx) * ox;
      b.vx = Math.abs(b.vx) * sign(dx);
    } else {
      b.y += sign(dy) * oy;
      b.vy = Math.abs(b.vy) * sign(dy);
    }
    relax(b, this._curSpeed()); // keep it sweeping across columns, never a vertical loop

    br.hp -= 1;
    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    var destroyed = br.hp <= 0;
    var gained = br.points + (this.combo - 1) * this.cfg.comboPointStep * 10;
    var last = false;
    if (destroyed) {
      br.alive = false;
      this.brickCount -= 1;
      this.score += gained;
      last = this.brickCount <= 0;
      // Maybe drop a power-up.
      if (this.rng() < this.cfg.dropChance) {
        var kind = this._weightedPower();
        this.drops.push({ x: br.x, y: br.y, vy: this.cfg.dropSpeed, kind: kind, r: 12 });
        this.events.push({ t: "drop", x: br.x, y: br.y, kind: kind });
      }
    } else {
      this.score += 5; // chip damage on multi-hp bricks
    }
    this.events.push({
      t: "brick", x: br.x, y: br.y, color: br.kind, points: gained,
      combo: this.combo, destroyed: destroyed, hp: br.hp, maxHp: br.maxHp, last: last,
    });
    return true;
  };

  // Ball vs paddle. Reflect with english based on where it struck the paddle.
  Arcade.prototype._ballVsPaddle = function (b) {
    var p = this.paddle;
    var hw = p.w / 2 + b.r, hh = p.h / 2 + b.r;
    var dx = b.x - p.x, dy = b.y - p.y;
    if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) return false;
    if (b.vy <= 0) return false; // only when moving downward
    // Place ball on top of paddle.
    b.y = p.y - hh;
    // Reflect: angle steered by contact offset (-1..1 across paddle).
    var off = clamp(dx / (p.w / 2), -1, 1);
    var sp = this._curSpeed();
    var maxAng = Math.PI * 0.42; // up to ~75deg from vertical
    var ang = (-Math.PI / 2) + off * maxAng;
    b.vx = Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    relax(b, sp); // guarantee lateral + upward motion off the paddle
    this.combo = 0; // paddle contact resets combo (classic risk/reward)
    this.events.push({ t: "paddle", x: b.x, y: p.y - p.h / 2, hitPos: off });
    return true;
  };

  // Ball vs walls (left/right/top). Bottom = miss (handled in step).
  Arcade.prototype._ballVsWalls = function (b) {
    var hit = false;
    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); this.events.push({ t: "wall", x: b.x, y: b.y, side: "left" }); hit = true; }
    else if (b.x + b.r > this.W) { b.x = this.W - b.r; b.vx = -Math.abs(b.vx); this.events.push({ t: "wall", x: b.x, y: b.y, side: "right" }); hit = true; }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); this.events.push({ t: "wall", x: b.x, y: b.y, side: "top" }); hit = true; }
    return hit;
  };

  // Advance one sub-step (already small dt).
  Arcade.prototype._integrate = function (dt) {
    var i, j, b;
    // Move + collide balls.
    for (i = this.balls.length - 1; i >= 0; i--) {
      b = this.balls[i];
      if (b.stuck) { b.x = this.paddle.x; b.y = this.paddle.y - b.r - 2; continue; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this._ballVsWalls(b);
      // Bricks: at most a couple collisions per substep matter; loop all (grid is small).
      for (j = 0; j < this.bricks.length; j++) {
        if (this._ballVsBrick(b, this.bricks[j])) break; // one brick per substep avoids double-reflect jitter
      }
      this._ballVsPaddle(b);
      // Lost off the bottom?
      if (b.y - b.r > this.H) {
        this.balls.splice(i, 1);
      }
    }
    // Move power-up drops + catch.
    for (i = this.drops.length - 1; i >= 0; i--) {
      var d = this.drops[i];
      d.y += d.vy * dt;
      var p = this.paddle;
      var caught = (d.y + d.r > p.y - p.h / 2) && (d.y - d.r < p.y + p.h / 2) &&
                   (Math.abs(d.x - p.x) < p.w / 2 + d.r);
      if (caught) {
        this._applyPower(d.kind, d.x, d.y);
        this.drops.splice(i, 1);
      } else if (d.y - d.r > this.H) {
        this.drops.splice(i, 1);
      }
    }
  };

  /**
   * step(dt, paddleX): advance the world by dt seconds. paddleX (optional) sets
   * the paddle's desired center X (clamped). Returns the events accrued this call.
   */
  Arcade.prototype.step = function (dt, paddleX) {
    this.events = [];
    if (this.ended || this.paused) return this.events;
    dt = clamp(dt || 0, 0, 0.05); // guard against huge frame gaps
    this._time += dt;

    // Update paddle position (renderer feeds where the cursor/keys want it).
    if (paddleX != null) {
      this.paddle.x = clamp(paddleX, this.paddle.w / 2, this.W - this.paddle.w / 2);
    }
    // Expire expand power-up.
    if (this.paddle.expandUntil && this._time > this.paddle.expandUntil) {
      this.paddle.w = this.paddle.baseW;
      this.paddle.expandUntil = 0;
    }

    // Sub-step the integration so a fast ball can't tunnel through a brick/paddle.
    var maxSpeed = 0;
    for (var i = 0; i < this.balls.length; i++) {
      var s = Math.hypot(this.balls[i].vx, this.balls[i].vy);
      if (s > maxSpeed) maxSpeed = s;
    }
    var travel = maxSpeed * dt;
    var minDim = Math.min(this.brickW, this.cfg.brickH, this.paddle.h, this.cfg.ballR * 2);
    var steps = Math.max(1, Math.ceil(travel / (minDim * 0.5)));
    steps = Math.min(steps, 8);
    var sub = dt / steps;
    for (var k = 0; k < steps; k++) {
      this._integrate(sub);
      if (this._checkResolve()) break;
    }

    // Out of balls but lives remain -> lose a life and respawn a stuck ball.
    if (!this.ended && this.balls.length === 0) {
      this.lives -= 1;
      this.events.push({ t: "life", lives: this.lives });
      this.combo = 0;
      if (this.lives <= 0) {
        this.ended = true; this.victory = false;
        this.events.push({ t: "lose" });
      } else {
        this._spawnBall(true);
      }
    }
    return this.events;
  };

  Arcade.prototype._checkResolve = function () {
    if (this.ended) return true;
    if (this.brickCount <= 0) {
      this.ended = true; this.victory = true;
      // Bonus for remaining lives.
      this.score += this.lives * 500;
      this.events.push({ t: "win" });
      return true;
    }
    return false;
  };

  // Snapshot for the renderer (no internal refs leaked that mutate sim).
  Arcade.prototype.state = function () {
    return {
      score: this.score,
      lives: this.lives,
      combo: this.combo,
      maxCombo: this.maxCombo,
      ended: this.ended,
      victory: this.victory,
      brickCount: this.brickCount,
      time: this._time,
      laser: this._laser,
      slow: this._time < this._slowUntil,
      paddle: { x: this.paddle.x, y: this.paddle.y, w: this.paddle.w, h: this.paddle.h },
      balls: this.balls.map(function (b) { return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r, stuck: b.stuck }; }),
      drops: this.drops.map(function (d) { return { x: d.x, y: d.y, kind: d.kind, r: d.r }; }),
      bricks: this.bricks,
    };
  };

  // Predict the X where a descending ball reaches the paddle plane, folding one
  // wall reflection so the AI intercepts cleanly even after a side bounce.
  Arcade.prototype._predictPaddleX = function (b) {
    if (b.vy <= 0) return b.x;
    var t = (this.paddle.y - this.paddle.h / 2 - b.r - b.y) / b.vy;
    if (t < 0) return b.x;
    var x = b.x + b.vx * t;
    // Fold into [r, W-r] by mirror reflection (triangle wave).
    var span = this.W - 2 * b.r;
    if (span <= 0) return clamp(x, 0, this.W);
    var rel = x - b.r;
    var mod = ((rel % (2 * span)) + 2 * span) % (2 * span);
    if (mod > span) mod = 2 * span - mod;
    return b.r + mod;
  };

  // X of the surviving brick nearest (in X) to a reference X — the AI aims here.
  Arcade.prototype._nearestBrickX = function (refX) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < this.bricks.length; i++) {
      var br = this.bricks[i];
      if (!br.alive) continue;
      var dd = Math.abs(br.x - refX);
      if (dd < bestD) { bestD = dd; best = br.x; }
    }
    return best == null ? this.W / 2 : best;
  };

  /**
   * autoResolve(opts): headless fast-sim to a win/lose with a *competent* AI
   * paddle (tracks the lowest descending ball) so a feel-gate can verify a real
   * play-through with NO rendering and NO input. Deterministic given the seed.
   * Returns { ended, victory, score, lives, frames, brickCount }.
   */
  Arcade.prototype.autoResolve = function (opts) {
    opts = opts || {};
    var dt = opts.dt || (1 / 60);
    // 240 sim-seconds is enough for the competent AI to clear the board in the
    // large majority of seeds (verified). It runs in a few ms of real time since
    // it's pure math — the cap only exists so a pathological seed can't hang.
    var maxFrames = opts.maxFrames || 60 * 240;
    var f = 0;
    if (this.balls.length) this.launch();
    while (!this.ended && f < maxFrames) {
      // AI paddle: intercept the lowest descending ball. When the ball is high
      // (safe), bias the contact point toward the X of the nearest surviving
      // brick so the bounce is aimed at work — this clears the board instead of
      // looping forever, and proves the game is actually winnable.
      var target = this.W / 2, lowest = -1, lead = null, i;
      for (i = 0; i < this.balls.length; i++) {
        var b = this.balls[i];
        if (b.stuck) { this.launch(); }
        if (b.y > lowest) { lowest = b.y; lead = b; }
      }
      if (lead) {
        // Predict where the lead ball crosses the paddle plane (linear with one
        // wall reflection) so interception is solid. Then, ONLY when there's
        // enough margin, bias the contact point toward the nearest surviving
        // brick to aim the bounce — capped so we never offset off the ball and
        // drop it. This clears the board without sacrificing the catch.
        var predictX = this._predictPaddleX(lead);
        target = predictX;
        var descending = lead.vy > 0;
        var timeToPaddle = descending ? (this.paddle.y - lead.y) / lead.vy : 999;
        if (descending && timeToPaddle > 0.35) {
          var aimX = this._nearestBrickX(predictX);
          var dir = aimX > predictX ? 1 : -1;
          // Max safe offset: keep the ball within the paddle half-width minus a
          // catch margin. Aim harder when few bricks remain.
          var aggr = this.brickCount <= 10 ? 0.42 : 0.28;
          var maxOff = Math.max(0, this.paddle.w * 0.5 - lead.r - 4);
          var off = Math.min(this.paddle.w * aggr, maxOff);
          target = predictX - dir * off;
        }
      }
      // Power-up nearby and low? grab it (survival + makes the run interesting).
      for (var d = 0; d < this.drops.length; d++) {
        if (this.drops[d].y > this.H * 0.72) { target = this.drops[d].x; break; }
      }
      this.step(dt, target);
      f++;
    }
    if (!this.ended) {
      // Hit the frame cap without resolving — treat as a loss so the gate never
      // hangs and we never falsely report victory.
      this.ended = true;
      this.victory = this.brickCount <= 0;
    }
    return {
      ended: this.ended,
      victory: this.victory,
      score: this.score,
      lives: this.lives,
      frames: f,
      brickCount: this.brickCount,
      maxCombo: this.maxCombo,
    };
  };

  Arcade.mulberry32 = mulberry32;
  Arcade.POWER_KINDS = POWER_KINDS;

  // Dual export.
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.Arcade = Arcade;
  if (typeof module !== "undefined" && module.exports) module.exports = Arcade;
})(typeof window !== "undefined" ? window : globalThis);
