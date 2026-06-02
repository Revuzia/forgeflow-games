/**
 * FFG runtime — ffg_arcade.js
 * The juicy renderer + input + FEEL layer for the brick-breaker genre. Drives the
 * PURE sim (FFG.sim.Arcade) and turns its event stream into AAA polish: glowing
 * paddle/ball/bricks (postFX glow + bloom), a particle burst + shockwave + small
 * screen-shake + a floating combo number on every brick break, a parallax neon
 * starfield + gradient + vignette background, squash-stretch pops, hit-stop on
 * the last brick & power-up grabs, and a clean HUD + win/lose + restart.
 *
 * Registers itself as the "arcade" genre. NOT regenerated per game — games supply
 * only content.json (palette name, rows/cols, title, etc.).
 *
 * Self-contained FX: the spec's FFG.fx / FFG.palette / FFG.shade helpers are
 * INSTALLED here onto window.FFG if they aren't already present, so this renderer
 * is fully juicy with only ffg_kernel.js loaded — and is a no-op if a newer
 * kernel already provides them.
 *
 * Exposes window.__test = { start(), autoResolve() } so the feel-gate / play-bot
 * can start gameplay and fast-resolve a play-through headlessly (no real input).
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};

  // ───────────────────────────────────────────────────────────────────────────
  // SELF-CONTAINED FX ENGINE  (installed only if a kernel hasn't provided it)
  // Matches the documented API: FFG.fx.bind(scene) -> {glow,bloom,shake,flash,
  // zoomPunch,hitstop,pop,burst,shockwave,float,starfield,gradient,vignette}.
  // Everything degrades gracefully where a Phaser feature is unavailable.
  // ───────────────────────────────────────────────────────────────────────────
  function installFx() {
    if (FFG.palette && FFG.fx && FFG.shade && FFG.color && typeof FFG.color === "function") return;

    var PALETTES = {
      neon:   { bg: "#0a0612", bg2: "#160a28", primary: "#19f0ff", accent: "#ff2bd6", good: "#39ff88", danger: "#ff3b6b", warn: "#ffd23f", ink: "#eafcff" },
      sunset: { bg: "#150a14", bg2: "#2a0f1e", primary: "#ff7a18", accent: "#ff2d6f", good: "#ffd166", danger: "#ef476f", warn: "#ffd166", ink: "#fff3e6" },
      aqua:   { bg: "#04141a", bg2: "#062734", primary: "#22e3c3", accent: "#3ad1ff", good: "#7CFC9B", danger: "#ff5c6c", warn: "#ffd166", ink: "#e6ffff" },
      mono:   { bg: "#0b0b0f", bg2: "#16161d", primary: "#cfd2ff", accent: "#8aa0ff", good: "#9CFFB0", danger: "#ff6b6b", warn: "#ffd166", ink: "#f2f3ff" },
    };
    FFG.palette = FFG.palette || function (name) { return PALETTES[name] || PALETTES.neon; };

    // Keep any existing FFG.color; otherwise install one.
    if (typeof FFG.color !== "function") {
      FFG.color = function (hex) { return (typeof hex === "string") ? parseInt(hex.replace("#", "0x")) : hex; };
    }

    function _c8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
    FFG.shade = FFG.shade || function (hex, t) {
      var n = (typeof hex === "string") ? parseInt(hex.replace("#", ""), 16) : hex;
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      if (t >= 0) { r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
      else { r *= (1 + t); g *= (1 + t); b *= (1 + t); }
      return (_c8(r) << 16) | (_c8(g) << 8) | _c8(b);
    };

    // FFG.text passthrough is already in the kernel; if absent, add a minimal one.
    if (typeof FFG.text !== "function") {
      FFG.text = function (scene, x, y, str, o) {
        o = o || {};
        var t = scene.add.text(x, y, str, {
          fontFamily: o.font || "monospace", fontSize: (o.size || 14) + "px",
          color: o.color || "#fff", resolution: 2,
          stroke: o.stroke, strokeThickness: o.strokeThickness || 0,
        });
        if (o.origin != null) t.setOrigin(o.origin, o.originY != null ? o.originY : o.origin);
        if (o.depth != null) t.setDepth(o.depth);
        return t;
      };
    }

    function toInt(c) { return (typeof c === "string") ? FFG.color(c) : c; }

    FFG.fx = {
      bind: function (scene) {
        var P = root.Phaser;
        var api = {
          scene: scene,
          _pool: [],

          // Soft glow via postFX (WebGL). Falls back to a duplicated, blurred,
          // additive "halo" rectangle/arc behind the object on Canvas.
          glow: function (obj, color, outer) {
            try {
              if (obj && obj.postFX && obj.postFX.addGlow) {
                obj.postFX.addGlow(toInt(color != null ? color : 0xffffff), outer != null ? outer : 6, 0, false, 0.08, 12);
                return obj;
              }
            } catch (e) {}
            // Canvas fallback: tint + additive blend reads as a glow at small sizes.
            try { if (obj && obj.setBlendMode) obj.setBlendMode(P.BlendModes.ADD); } catch (e) {}
            return obj;
          },

          // Whole-scene bloom (additive). No-op if postFX unavailable.
          bloom: function (strength) {
            try {
              var cam = scene.cameras.main;
              if (cam.postFX && cam.postFX.addBloom) {
                cam.postFX.addBloom(0xffffff, 1, 1, strength != null ? strength : 1.1, 1.0);
                this._bloomed = true;
              }
            } catch (e) {}
            return this;
          },

          shake: function (dur, intensity) {
            try { scene.cameras.main.shake(dur || 120, intensity != null ? intensity : 0.006); } catch (e) {}
            return this;
          },

          // SPARINGLY — full-screen color flash.
          flash: function (color, dur) {
            try {
              var n = toInt(color != null ? color : 0xffffff);
              scene.cameras.main.flash(dur || 120, (n >> 16) & 255, (n >> 8) & 255, n & 255);
            } catch (e) {}
            return this;
          },

          zoomPunch: function (amt, dur) {
            try {
              var cam = scene.cameras.main, z = cam.zoom;
              scene.tweens.add({ targets: cam, zoom: z * (1 + (amt != null ? amt : 0.04)), duration: (dur || 110) / 2, yoyo: true, ease: "Quad.easeOut", onComplete: function () { cam.setZoom(z); } });
            } catch (e) {}
            return this;
          },

          // Brief global freeze — sells big impacts. Restores time scale after ms.
          hitstop: function (ms) {
            try {
              if (this._hitstopOn) return this;
              this._hitstopOn = true;
              var prevP = (scene.physics && scene.physics.world) ? scene.physics.world.timeScale : 1;
              scene.tweens.timeScale = 0;
              scene.__ffgHitstop = true;
              var self = this;
              scene.time.delayedCall(ms || 60, function () {
                scene.tweens.timeScale = 1;
                scene.__ffgHitstop = false;
                self._hitstopOn = false;
              });
            } catch (e) {}
            return this;
          },

          // Squash-stretch pop.
          pop: function (obj, scale, dur) {
            if (!obj || !obj.setScale) return this;
            var sx = obj.scaleX, sy = obj.scaleY, s = scale != null ? scale : 0.28;
            try {
              scene.tweens.add({ targets: obj, scaleX: sx * (1 + s), scaleY: sy * (1 - s * 0.6), duration: (dur || 130) / 2, yoyo: true, ease: "Quad.easeOut", onComplete: function () { obj.setScale(sx, sy); } });
            } catch (e) {}
            return this;
          },

          // Particle burst. spark=true -> streaky line particles; else soft dots.
          burst: function (x, y, o) {
            o = o || {};
            var count = o.count != null ? o.count : 14;
            var color = toInt(o.color != null ? o.color : 0xffffff);
            var speed = o.speed != null ? o.speed : 220;
            var scale = o.scale != null ? o.scale : 1;
            var life = o.life != null ? o.life : 480;
            var gravityY = o.gravityY != null ? o.gravityY : 0;
            var angBase = o.angle != null ? o.angle : null; // radians, directional cone
            for (var i = 0; i < count; i++) {
              var ang = angBase != null ? (angBase + (Math.random() - 0.5) * 1.1) : (Math.random() * Math.PI * 2);
              var sp = speed * (0.5 + Math.random() * 0.6);
              var vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
              var size = (o.spark ? 3 : 4) * scale * (0.7 + Math.random() * 0.7);
              var p;
              if (o.spark) {
                p = scene.add.rectangle(x, y, size * 3, size, color);
                p.setRotation(ang);
              } else {
                p = scene.add.circle(x, y, size, color);
              }
              p.setDepth(o.depth != null ? o.depth : 60);
              try { p.setBlendMode(P.BlendModes.ADD); } catch (e) {}
              var ex = x + vx * (life / 1000);
              var ey = y + vy * (life / 1000) + gravityY * Math.pow(life / 1000, 2) * 0.5;
              scene.tweens.add({
                targets: p, x: ex, y: ey, alpha: 0, scale: o.spark ? 0.2 : 0,
                duration: life * (0.7 + Math.random() * 0.5), ease: "Quad.easeOut",
                onComplete: function () { try { this.destroy(); } catch (e) {} }.bind(p),
              });
            }
            return this;
          },

          // Expanding ring shockwave.
          shockwave: function (x, y, o) {
            o = o || {};
            var color = toInt(o.color != null ? o.color : 0xffffff);
            var r0 = o.r0 != null ? o.r0 : 4;
            var r1 = o.r1 != null ? o.r1 : 60;
            var dur = o.dur != null ? o.dur : 340;
            var thick = o.thickness != null ? o.thickness : 3;
            var ring = scene.add.circle(x, y, r0);
            ring.setStrokeStyle(thick, color, 1);
            ring.setFillStyle(0, 0);
            ring.setDepth(o.depth != null ? o.depth : 55);
            try { ring.setBlendMode(P.BlendModes.ADD); } catch (e) {}
            scene.tweens.add({
              targets: ring, radius: r1, alpha: 0,
              duration: dur, ease: "Cubic.easeOut",
              onUpdate: function () { try { ring.setStrokeStyle(thick, color, ring.alpha); } catch (e) {} },
              onComplete: function () { try { ring.destroy(); } catch (e) {} },
            });
            return this;
          },

          // Floating text (combo numbers, "+250", "EXTRA LIFE").
          float: function (x, y, text, o) {
            o = o || {};
            var t = FFG.text(scene, x, y, text, {
              size: o.size || 20, color: o.colorStr || "#ffffff",
              origin: 0.5, depth: o.depth != null ? o.depth : 80,
              stroke: "#000000", strokeThickness: 4, font: o.font || "monospace",
            });
            t.setScale(0.4);
            try { t.setBlendMode(P.BlendModes.NORMAL); } catch (e) {}
            scene.tweens.add({ targets: t, scale: 1, duration: 130, ease: "Back.easeOut" });
            scene.tweens.add({
              targets: t, y: y - (o.rise != null ? o.rise : 48), alpha: 0,
              delay: 120, duration: o.dur || 620, ease: "Cubic.easeOut",
              onComplete: function () { try { t.destroy(); } catch (e) {} },
            });
            return t;
          },

          // Parallax neon starfield (3 depth layers). Returns an updater the scene
          // calls each frame to drift the stars (cheap; reuses Graphics).
          starfield: function (sc, o) {
            o = o || {};
            var W = sc.scale.width, H = sc.scale.height;
            var count = o.count != null ? o.count : 110;
            var baseColor = toInt(o.color != null ? o.color : 0x66e0ff);
            var speed = o.speed != null ? o.speed : 14;
            var stars = [];
            var g = sc.add.graphics();
            g.setDepth(o.depth != null ? o.depth : -8);
            try { g.setBlendMode(P.BlendModes.ADD); } catch (e) {}
            for (var i = 0; i < count; i++) {
              var layer = (i % 3); // 0 far .. 2 near
              stars.push({
                x: Math.random() * W, y: Math.random() * H,
                z: layer, r: 0.6 + layer * 0.7 + Math.random() * 0.6,
                tw: Math.random() * Math.PI * 2,
              });
            }
            var draw = function (dt) {
              g.clear();
              for (var k = 0; k < stars.length; k++) {
                var s = stars[k];
                s.y += speed * (0.4 + s.z * 0.5) * (dt || 0.016);
                if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
                s.tw += dt ? dt * 4 : 0.05;
                var a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(s.tw));
                g.fillStyle(baseColor, a);
                g.fillCircle(s.x, s.y, s.r);
              }
            };
            draw(0);
            return { update: draw, gfx: g };
          },

          // Vertical gradient backdrop (filled at the very back).
          gradient: function (sc, topHex, bottomHex) {
            var W = sc.scale.width, H = sc.scale.height;
            var top = (typeof topHex === "string") ? parseInt(topHex.replace("#", ""), 16) : topHex;
            var bot = (typeof bottomHex === "string") ? parseInt(bottomHex.replace("#", ""), 16) : bottomHex;
            var g = sc.add.graphics();
            g.setDepth(-10);
            var bands = 64;
            for (var i = 0; i < bands; i++) {
              var t = i / (bands - 1);
              var r = ((top >> 16 & 255) * (1 - t) + (bot >> 16 & 255) * t) | 0;
              var gg = ((top >> 8 & 255) * (1 - t) + (bot >> 8 & 255) * t) | 0;
              var b = ((top & 255) * (1 - t) + (bot & 255) * t) | 0;
              g.fillStyle((r << 16) | (gg << 8) | b, 1);
              g.fillRect(0, Math.floor(H * i / bands), W, Math.ceil(H / bands) + 1);
            }
            return g;
          },

          // Dark vignette frame to focus the play area.
          vignette: function (sc, strength) {
            var W = sc.scale.width, H = sc.scale.height;
            strength = strength != null ? strength : 0.6;
            var g = sc.add.graphics();
            g.setDepth(70);
            var steps = 26, max = Math.min(W, H) * 0.62;
            for (var i = 0; i < steps; i++) {
              var t = i / (steps - 1);
              var a = strength * Math.pow(t, 2.2) * 0.16;
              g.lineStyle(Math.ceil(max / steps) + 2, 0x000000, a);
              g.strokeRect(-max * t, -max * t, W + max * 2 * t, H + max * 2 * t);
            }
            return g;
          },
        };
        return api;
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE ARCADE SCENE
  // ───────────────────────────────────────────────────────────────────────────
  FFG.register("arcade", function (content) {
    installFx();
    var Phaser = root.Phaser;
    var pal = FFG.palette(content.palette || "neon");

    // Brick color ramp keyed by row (top = hottest). Cohesive with the palette.
    function brickRowColor(row, rows) {
      var t = rows <= 1 ? 0 : row / (rows - 1); // 0 top .. 1 bottom
      // Blend accent (hot, top) -> primary (cool, bottom), then lift each row a bit.
      var hot = (typeof pal.accent === "string") ? parseInt(pal.accent.replace("#", ""), 16) : pal.accent;
      var cool = (typeof pal.primary === "string") ? parseInt(pal.primary.replace("#", ""), 16) : pal.primary;
      var r = ((hot >> 16 & 255) * (1 - t) + (cool >> 16 & 255) * t) | 0;
      var g = ((hot >> 8 & 255) * (1 - t) + (cool >> 8 & 255) * t) | 0;
      var b = ((hot & 255) * (1 - t) + (cool & 255) * t) | 0;
      return (r << 16) | (g << 8) | b;
    }

    var POWER_COLORS = {
      expand: pal.good, multi: pal.primary, slow: pal.warn,
      life: pal.danger, laser: pal.accent, score: pal.warn,
    };
    var POWER_LABEL = { expand: "WIDE", multi: "MULTI", slow: "SLOW", life: "+1UP", laser: "LASER", score: "+250" };

    function Scene() { Phaser.Scene.call(this, { key: "FFGArcade" }); }
    Scene.prototype = Object.create(Phaser.Scene.prototype);
    Scene.prototype.constructor = Scene;

    Scene.prototype.preload = function () {
      var a = content.assets || {};
      var self = this;
      (a.images || []).forEach(function (im) { try { self.load.image(im.key, im.url); } catch (e) {} });
      (a.audio || []).forEach(function (au) { try { self.load.audio(au.key, au.url); } catch (e) {} });
    };

    Scene.prototype.create = function () {
      var self = this;
      this.W = this.scale.width;
      this.H = this.scale.height;
      FFG.audio.bind(this);
      this.fx = FFG.fx.bind(this);

      // ── Background: gradient + starfield + vignette + bloom (the whole scene).
      this.fx.gradient(this, content.view && content.view.background || pal.bg, pal.bg2);
      this._stars = this.fx.starfield(this, { count: content.starCount || 120, speed: 16, color: FFG.shade(pal.primary, 0.1) });
      // a faint second, faster layer for depth
      this._stars2 = this.fx.starfield(this, { count: 46, speed: 40, color: pal.accent, depth: -7 });
      this.fx.vignette(this, 0.7);
      this.fx.bloom(content.bloom != null ? content.bloom : 1.15);

      // ── Sim.
      this._buildSim();

      // ── Visual layers.
      this._brickViews = [];
      this._ballViews = [];
      this._dropViews = [];
      this._drawWalls();
      this._drawBricks();
      this._drawPaddle();
      this._syncBalls();

      // ── HUD + overlays + input + test hooks.
      this._buildHUD();
      this._wireInput();
      this._exposeTest();

      // ── Title / start gate (Play to begin). The feel-gate calls __test.start().
      this._started = false;
      this._buildStartOverlay();

      // Resolve flag so we only fire the win/lose overlay once.
      this._resolved = false;
    };

    Scene.prototype._buildSim = function () {
      var v = content.view || {};
      var cfg = {
        width: this.W, height: this.H,
        rows: content.rows || 6,
        cols: content.cols || 11,
        brickTop: content.brickTop || 84,
        sideMargin: content.sideMargin || 34,
        paddleW: content.paddleW || 130,
        paddleY: content.paddleY || (this.H - 44),
        ballSpeed: content.ballSpeed || 380,
        lives: content.lives || 3,
        dropChance: content.dropChance != null ? content.dropChance : 0.16,
        seed: content.seed != null ? content.seed : 1337,
      };
      this._cfg = cfg;
      this.sim = new FFG.sim.Arcade(cfg);
    };

    // ── DRAW: static neon side/top rails so the play-field reads as a cabinet.
    Scene.prototype._drawWalls = function () {
      var g = this.add.graphics();
      g.setDepth(2);
      var col = FFG.color(pal.primary);
      g.lineStyle(2, col, 0.5);
      g.strokeRect(1, 1, this.W - 2, this.H - 2);
      // top accent bar
      g.fillStyle(col, 0.06);
      g.fillRect(0, 0, this.W, (content.brickTop || 84) - 8);
      try { g.setBlendMode(Phaser.BlendModes.ADD); } catch (e) {}
    };

    Scene.prototype._drawBricks = function () {
      var self = this;
      var rows = this._cfg.rows;
      var st = this.sim.state();
      st.bricks.forEach(function (br) {
        var color = brickRowColor(br.row, rows);
        var body = self.add.rectangle(br.x, br.y, br.w - 2, br.h - 2, FFG.shade(color, -0.12));
        body.setStrokeStyle(2, FFG.shade(color, 0.45), 1);
        body.setDepth(6);
        // inner glossy highlight line
        var gloss = self.add.rectangle(br.x, br.y - br.h * 0.22, br.w - 8, 2, FFG.shade(color, 0.6), 0.55);
        gloss.setDepth(7);
        self.fx.glow(body, color, 5);
        self._brickViews.push({ br: br, body: body, gloss: gloss, color: color });
      });
    };

    Scene.prototype._drawPaddle = function () {
      var st = this.sim.state();
      var p = st.paddle;
      var col = FFG.color(pal.primary);
      this._paddle = this.add.rectangle(p.x, p.y, p.w, p.h, FFG.shade(pal.primary, -0.05));
      this._paddle.setStrokeStyle(2, FFG.shade(pal.primary, 0.6), 1);
      this._paddle.setDepth(20);
      this.fx.glow(this._paddle, col, 8);
      // bright core line
      this._paddleCore = this.add.rectangle(p.x, p.y, p.w * 0.7, 3, 0xffffff, 0.85);
      this._paddleCore.setDepth(21);
      try { this._paddleCore.setBlendMode(Phaser.BlendModes.ADD); } catch (e) {}
    };

    Scene.prototype._makeBall = function (b) {
      var col = FFG.color(pal.good);
      var core = this.add.circle(b.x, b.y, b.r, 0xffffff);
      core.setDepth(31);
      var halo = this.add.circle(b.x, b.y, b.r + 3, col, 0.35);
      halo.setDepth(30);
      try { halo.setBlendMode(Phaser.BlendModes.ADD); } catch (e) {}
      this.fx.glow(core, col, 8);
      return { core: core, halo: halo, trail: [] };
    };

    Scene.prototype._syncBalls = function () {
      var st = this.sim.state();
      // create views to match ball count
      while (this._ballViews.length < st.balls.length) this._ballViews.push(this._makeBall(st.balls[this._ballViews.length] || { x: this.W / 2, y: this.H / 2, r: 8 }));
      while (this._ballViews.length > st.balls.length) {
        var v = this._ballViews.pop();
        try { v.core.destroy(); v.halo.destroy(); v.trail.forEach(function (t) { t.destroy(); }); } catch (e) {}
      }
      for (var i = 0; i < st.balls.length; i++) {
        var b = st.balls[i], view = this._ballViews[i];
        view.core.setPosition(b.x, b.y);
        view.halo.setPosition(b.x, b.y);
      }
    };

    // ── HUD: score / lives / combo, top corners, sharp text.
    Scene.prototype._buildHUD = function () {
      var pad = 14;
      this._hudScore = FFG.text(this, pad, 12, "SCORE 0", { size: 18, color: pal.ink, depth: 90, stroke: "#000", strokeThickness: 4 });
      this._hudLives = FFG.text(this, this.W - pad, 12, "", { size: 18, color: pal.danger, origin: 0, originY: 0, depth: 90, stroke: "#000", strokeThickness: 4 });
      this._hudLives.setOrigin(1, 0);
      this._hudCombo = FFG.text(this, this.W / 2, 12, "", { size: 16, color: pal.warn, origin: 0.5, originY: 0, depth: 90, stroke: "#000", strokeThickness: 4 });
      this._hudCombo.setOrigin(0.5, 0);
      this._title = FFG.text(this, this.W / 2, this.H - 16, (content.title || "NEON BREAKOUT").toUpperCase(), { size: 11, color: FFG.shade(pal.primary, 0.1), origin: 0.5, depth: 5 });
      this._title.setOrigin(0.5, 1).setAlpha(0.5);
      this._refreshHUD();
    };

    Scene.prototype._refreshHUD = function () {
      var st = this.sim.state();
      this._hudScore.setText("SCORE " + st.score);
      // lives as hearts/blocks
      var hearts = "";
      for (var i = 0; i < st.lives; i++) hearts += "◆";
      this._hudLives.setText("LIVES " + (hearts || "-"));
      if (st.combo >= 2) {
        this._hudCombo.setText(st.combo + "x COMBO");
        this._hudCombo.setAlpha(1);
      } else {
        this._hudCombo.setAlpha(0);
      }
    };

    // ── INPUT: mouse/touch move paddle; arrows for keyboard; click/space launch.
    Scene.prototype._wireInput = function () {
      var self = this;
      this._wantX = this.sim.state().paddle.x;
      this._keyLeft = false; this._keyRight = false;

      this.input.on("pointermove", function (p) {
        if (!self._started) return;
        self._wantX = p.worldX;
      });
      this.input.on("pointerdown", function () {
        if (!self._started) { self._beginPlay(); return; }
        self.sim.launch();
      });

      var kb = this.input.keyboard;
      if (kb) {
        this._cursors = kb.createCursorKeys();
        kb.on("keydown-SPACE", function () { if (!self._started) self._beginPlay(); else self.sim.launch(); });
        kb.on("keydown-LEFT", function () { self._keyLeft = true; });
        kb.on("keyup-LEFT", function () { self._keyLeft = false; });
        kb.on("keydown-RIGHT", function () { self._keyRight = true; });
        kb.on("keyup-RIGHT", function () { self._keyRight = false; });
        kb.on("keydown-A", function () { self._keyLeft = true; });
        kb.on("keyup-A", function () { self._keyLeft = false; });
        kb.on("keydown-D", function () { self._keyRight = true; });
        kb.on("keyup-D", function () { self._keyRight = false; });
        kb.on("keydown-R", function () { if (self.sim.state().ended) self.scene.restart(); });
      }
    };

    Scene.prototype._buildStartOverlay = function () {
      var self = this;
      this._startLayer = this.add.container(0, 0).setDepth(200);
      var scrim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.55);
      var t1 = FFG.text(this, this.W / 2, this.H / 2 - 56, (content.title || "NEON BREAKOUT").toUpperCase(), { size: 44, color: pal.ink, origin: 0.5, stroke: "#000", strokeThickness: 6 });
      try { t1.setBlendMode(Phaser.BlendModes.NORMAL); } catch (e) {}
      var t2 = FFG.text(this, this.W / 2, this.H / 2 + 2, "CLICK / SPACE TO PLAY", { size: 18, color: pal.primary, origin: 0.5, stroke: "#000", strokeThickness: 4 });
      var t3 = FFG.text(this, this.W / 2, this.H / 2 + 40, "MOUSE or ← → move   •   catch power-ups   •   build combos", { size: 13, color: FFG.shade(pal.ink, -0.25), origin: 0.5 });
      this.fx.glow(t1, FFG.color(pal.accent), 4);
      this.tweens.add({ targets: t2, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
      this._startLayer.add([scrim, t1, t2, t3]);
    };

    Scene.prototype._beginPlay = function () {
      if (this._started) return;
      this._started = true;
      if (this._startLayer) {
        var l = this._startLayer;
        this.tweens.add({ targets: l, alpha: 0, duration: 250, onComplete: function () { try { l.destroy(); } catch (e) {} } });
      }
      this.sim.launch();
      FFG.audio.music("music", 0.35);
    };

    // ── EVENT -> JUICE mapping. The heart of the feel.
    Scene.prototype._applyEvents = function (events) {
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.t === "brick") this._onBrick(e);
        else if (e.t === "paddle") this._onPaddle(e);
        else if (e.t === "wall") this._onWall(e);
        else if (e.t === "drop") this._onDrop(e);
        else if (e.t === "power") this._onPower(e);
        else if (e.t === "life") this._onLife(e);
        else if (e.t === "win" || e.t === "lose") this._onResolve(e.t === "win");
      }
    };

    Scene.prototype._brickViewAt = function (x, y) {
      for (var i = 0; i < this._brickViews.length; i++) {
        var bv = this._brickViews[i];
        if (bv.br.x === x && bv.br.y === y) return bv;
      }
      return null;
    };

    Scene.prototype._onBrick = function (e) {
      var bv = this._brickViewAt(e.x, e.y);
      var color = bv ? bv.color : FFG.color(pal.accent);
      if (e.destroyed) {
        // POP: particle burst + shockwave + combo float + small shake.
        this.fx.burst(e.x, e.y, { color: color, count: e.last ? 26 : 16, speed: e.last ? 300 : 230, scale: e.last ? 1.4 : 1, life: 520, gravityY: 120, spark: true });
        this.fx.burst(e.x, e.y, { color: 0xffffff, count: 6, speed: 140, scale: 0.8, life: 340 });
        this.fx.shockwave(e.x, e.y, { color: color, r0: 4, r1: e.last ? 110 : 54, dur: e.last ? 420 : 320, thickness: 3 });
        this.fx.shake(e.last ? 240 : 70, e.last ? 0.012 : 0.004);
        if (e.combo >= 2) {
          this.fx.float(e.x, e.y - 8, e.combo + "x", { colorStr: this._comboColor(e.combo), size: 16 + Math.min(e.combo, 12), rise: 44 });
        } else {
          this.fx.float(e.x, e.y - 8, "+" + e.points, { colorStr: "#ffffff", size: 14, rise: 36 });
        }
        FFG.audio.sfx("brick", 0.5);
        if (bv) {
          this.tweens.add({ targets: [bv.body, bv.gloss], scale: 0, alpha: 0, duration: 120, ease: "Back.easeIn", onComplete: function () { try { bv.body.destroy(); bv.gloss.destroy(); } catch (x) {} } });
          this._brickViews.splice(this._brickViews.indexOf(bv), 1);
        }
        // Hit-stop on the LAST brick — punctuate the clear.
        if (e.last) { this.fx.hitstop(90); this.fx.zoomPunch(0.05, 220); this.fx.flash(FFG.shade(color, 0.4), 90); }
      } else {
        // Chip hit on a multi-hp brick: pop + small spark, darken-to-light by hp.
        if (bv) {
          this.fx.pop(bv.body, 0.18, 110);
          var lift = 1 - (e.hp / Math.max(1, e.maxHp));
          bv.body.setFillStyle(FFG.shade(bv.color, -0.12 + lift * 0.3));
        }
        this.fx.burst(e.x, e.y, { color: color, count: 6, speed: 150, scale: 0.7, life: 280, spark: true });
        FFG.audio.sfx("brick", 0.3);
      }
    };

    Scene.prototype._comboColor = function (c) {
      if (c >= 12) return "#ff3bd6";
      if (c >= 8) return "#ff6b6b";
      if (c >= 5) return "#ffd23f";
      return "#39ff88";
    };

    Scene.prototype._onPaddle = function (e) {
      this.fx.pop(this._paddle, 0.22, 120);
      this.fx.burst(e.x, e.y, { color: FFG.color(pal.primary), count: 7, speed: 150, scale: 0.7, life: 280, angle: -Math.PI / 2, spark: true });
      FFG.audio.sfx("paddle", 0.4);
    };

    Scene.prototype._onWall = function (e) {
      this.fx.burst(e.x, e.y, { color: FFG.color(pal.primary), count: 4, speed: 110, scale: 0.5, life: 220 });
    };

    Scene.prototype._onDrop = function (e) {
      // view created/maintained in _syncDrops; nothing extra here.
    };

    Scene.prototype._onPower = function (e) {
      var col = FFG.color(POWER_COLORS[e.kind] || pal.good);
      // Big satisfying grab: pop the paddle, burst, shockwave, label float, hitstop.
      this.fx.pop(this._paddle, 0.34, 160);
      this.fx.burst(e.x, e.y, { color: col, count: 22, speed: 240, scale: 1.1, life: 520, spark: true });
      this.fx.shockwave(e.x, e.y, { color: col, r0: 6, r1: 70, dur: 380, thickness: 3 });
      this.fx.float(this._paddle.x, this._paddle.y - 34, POWER_LABEL[e.kind] || "POWER", { colorStr: "#" + col.toString(16).padStart(6, "0"), size: 22, rise: 52 });
      this.fx.hitstop(55);
      this.fx.shake(90, 0.005);
      FFG.audio.sfx("powerup", 0.55);
      if (e.kind === "expand") this.fx.glow(this._paddle, col, 12);
      if (e.kind === "life") this.fx.flash(FFG.shade(pal.danger, 0.3), 100);
    };

    Scene.prototype._onLife = function (e) {
      this.fx.flash(FFG.shade(pal.danger, -0.1), 160);
      this.fx.shake(260, 0.012);
      this.fx.float(this.W / 2, this.H / 2, e.lives > 0 ? "BALL LOST" : "", { colorStr: "#" + FFG.color(pal.danger).toString(16).padStart(6, "0"), size: 30, rise: 30, dur: 800 });
      FFG.audio.sfx("death", 0.6);
    };

    Scene.prototype._onResolve = function (victory) {
      if (this._resolved) return;
      this._resolved = true;
      var self = this;
      if (victory) { this.fx.flash(FFG.shade(pal.good, 0.2), 200); this.fx.zoomPunch(0.08, 400); }
      else { this.fx.flash(FFG.shade(pal.danger, -0.1), 220); }
      // Build overlay after a short beat so the final burst reads.
      this.time.delayedCall(victory ? 260 : 360, function () { self._buildEndOverlay(victory); });
    };

    Scene.prototype._buildEndOverlay = function (victory) {
      var self = this;
      var st = this.sim.state();
      var layer = this.add.container(0, 0).setDepth(210);
      var scrim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.62);
      var head = victory ? "YOU CLEARED IT!" : "GAME OVER";
      var hc = victory ? pal.good : pal.danger;
      var t1 = FFG.text(this, this.W / 2, this.H / 2 - 64, head, { size: 46, color: hc, origin: 0.5, stroke: "#000", strokeThickness: 6 });
      this.fx.glow(t1, FFG.color(hc), 6);
      var t2 = FFG.text(this, this.W / 2, this.H / 2 - 8, "SCORE  " + st.score, { size: 26, color: pal.ink, origin: 0.5, stroke: "#000", strokeThickness: 4 });
      var t3 = FFG.text(this, this.W / 2, this.H / 2 + 28, "BEST COMBO  " + st.maxCombo + "x", { size: 16, color: pal.warn, origin: 0.5, stroke: "#000", strokeThickness: 3 });
      var btn = this.add.rectangle(this.W / 2, this.H / 2 + 86, 230, 52, FFG.shade(hc, -0.2));
      btn.setStrokeStyle(2, FFG.color(hc), 1).setDepth(211).setInteractive({ useHandCursor: true });
      this.fx.glow(btn, FFG.color(hc), 8);
      var bt = FFG.text(this, this.W / 2, this.H / 2 + 86, "PLAY AGAIN", { size: 20, color: "#ffffff", origin: 0.5, depth: 212 });
      var restart = function () { self.scene.restart(); };
      btn.on("pointerdown", restart);
      this.tweens.add({ targets: btn, scaleX: 1.05, scaleY: 1.05, duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      layer.add([scrim, t1, t2, t3, btn, bt]);
      t1.setScale(0.6); this.tweens.add({ targets: t1, scale: 1, duration: 320, ease: "Back.easeOut" });
      // Victory confetti.
      if (victory) {
        for (var i = 0; i < 5; i++) {
          (function (d) {
            self.time.delayedCall(d, function () {
              self.fx.burst(self.W * (0.2 + Math.random() * 0.6), self.H * 0.3, { color: [pal.good, pal.primary, pal.accent, pal.warn].map(FFG.color)[i % 4], count: 18, speed: 260, scale: 1.2, life: 900, gravityY: 220, spark: true });
            });
          })(i * 120);
        }
      }
    };

    // ── Maintain falling power-up capsule views each frame.
    Scene.prototype._syncDrops = function () {
      var st = this.sim.state();
      // remove views whose drop is gone
      for (var i = this._dropViews.length - 1; i >= 0; i--) {
        var dv = this._dropViews[i];
        var still = null;
        for (var j = 0; j < st.drops.length; j++) { if (st.drops[j] === dv.ref || (st.drops[j].x === dv.lastX && st.drops[j].kind === dv.kind && Math.abs(st.drops[j].y - dv.lastY) < 30)) { still = st.drops[j]; break; } }
        if (!still) {
          var capsule = dv.capsule, label = dv.label;
          try { dv.capsule.destroy(); dv.label.destroy(); if (dv.glow) dv.glow.destroy(); } catch (e) {}
          this._dropViews.splice(i, 1);
        } else {
          dv.capsule.setPosition(still.x, still.y);
          if (dv.glow) dv.glow.setPosition(still.x, still.y);
          dv.label.setPosition(still.x, still.y);
          dv.ref = still; dv.lastX = still.x; dv.lastY = still.y;
          dv.capsule.rotation += 0.05;
        }
      }
      // add views for new drops
      for (var k = 0; k < st.drops.length; k++) {
        var d = st.drops[k];
        var exists = false;
        for (var m = 0; m < this._dropViews.length; m++) { if (this._dropViews[m].ref === d) { exists = true; break; } }
        if (exists) continue;
        var col = FFG.color(POWER_COLORS[d.kind] || pal.good);
        var glow = this.add.circle(d.x, d.y, d.r + 5, col, 0.3); glow.setDepth(14);
        try { glow.setBlendMode(Phaser.BlendModes.ADD); } catch (e) {}
        var cap = this.add.rectangle(d.x, d.y, d.r * 2.2, d.r * 1.5, FFG.shade(col, -0.1));
        cap.setStrokeStyle(2, FFG.shade(col, 0.5), 1).setDepth(15);
        this.fx.glow(cap, col, 6);
        var lbl = FFG.text(this, d.x, d.y, (POWER_LABEL[d.kind] || "?").slice(0, 4), { size: 9, color: "#ffffff", origin: 0.5, depth: 16 });
        this._dropViews.push({ ref: d, kind: d.kind, capsule: cap, glow: glow, label: lbl, lastX: d.x, lastY: d.y });
      }
    };

    // ── Ball trail (cheap fading ghosts) for that arcade streak.
    Scene.prototype._updateTrails = function () {
      var st = this.sim.state();
      for (var i = 0; i < this._ballViews.length && i < st.balls.length; i++) {
        var b = st.balls[i], view = this._ballViews[i];
        if (b.stuck) continue;
        if ((this._frame % 2) === 0) {
          var g = this.add.circle(b.x, b.y, b.r * 0.8, FFG.color(pal.good), 0.4);
          g.setDepth(29);
          try { g.setBlendMode(Phaser.BlendModes.ADD); } catch (e) {}
          this.tweens.add({ targets: g, alpha: 0, scale: 0.2, duration: 240, onComplete: function () { try { this.destroy(); } catch (e) {} }.bind(g) });
        }
      }
    };

    // ── MAIN LOOP.
    Scene.prototype.update = function (time, delta) {
      this._frame = (this._frame || 0) + 1;
      var dt = Math.min(delta / 1000, 0.05);

      // Drift parallax stars even before play starts (alive backdrop). The kernel's
      // FFG.fx.starfield self-animates + returns an ARRAY (no .update); the embedded
      // fallback returns an {update} object. Guard so either works (was throwing
      // "this._stars.update is not a function" every frame on the kernel path).
      if (this._stars && this._stars.update) this._stars.update(dt);
      if (this._stars2 && this._stars2.update) this._stars2.update(dt);

      if (!this._started) { return; }
      if (this.__ffgHitstop) { /* time frozen for tweens; sim still steps lightly */ }

      // Resolve desired paddle X from keyboard or pointer.
      var st0 = this.sim.state();
      var px = this._wantX != null ? this._wantX : st0.paddle.x;
      var kb = this._cursors;
      var speed = 760;
      if (this._keyLeft || (kb && kb.left && kb.left.isDown)) px = st0.paddle.x - speed * dt;
      if (this._keyRight || (kb && kb.right && kb.right.isDown)) px = st0.paddle.x + speed * dt;
      this._wantX = px;

      // Step sim (skip while a heavy hitstop is on so the freeze reads).
      var stepDt = this.__ffgHitstop ? dt * 0.15 : dt;
      var events = this.sim.step(stepDt, px);
      this._applyEvents(events);

      // Sync visuals.
      var st = this.sim.state();
      this._paddle.setSize ? this._paddle.setSize(st.paddle.w, st.paddle.h) : (this._paddle.width = st.paddle.w);
      this._paddle.setPosition(st.paddle.x, st.paddle.y);
      this._paddle.displayWidth = st.paddle.w;
      this._paddleCore.setPosition(st.paddle.x, st.paddle.y);
      this._paddleCore.displayWidth = st.paddle.w * 0.7;
      this._syncBalls();
      this._syncDrops();
      this._updateTrails();
      this._refreshHUD();
    };

    // ── TEST HOOKS for the headless feel-gate / play-bot.
    Scene.prototype._exposeTest = function () {
      var self = this;
      this.__test = {
        start: function () { self._beginPlay(); return true; },
        // Fast, headless resolve using the PURE sim's own AI (no rendering input).
        autoResolve: function (opts) {
          // Resolve on a FRESH sim seeded identically so the on-screen game is
          // untouched (the gate just wants a definitive ended result).
          var probe = new FFG.sim.Arcade(self._cfg);
          var r = probe.autoResolve(opts);
          return r;
        },
        // Optional: drive the LIVE on-screen sim to resolution (visible play-through).
        autoPlayLive: function (opts) {
          self._beginPlay();
          self._autoLive = true;
          return true;
        },
        state: function () { return self.sim.state(); },
      };
      // Global mirror so a page can call window.__test without reaching the scene.
      root.__test = this.__test;
      root.__FFG_ARCADE_SCENE__ = this;
    };

    return Scene;
  });
})(typeof window !== "undefined" ? window : globalThis);
