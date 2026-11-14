/**
 * FFG runtime — ffg_shmup.js
 * Renderer for the vertical SHMUP "Starlance". Registers a Phaser.Scene that
 * drives the PURE sim (sim/shmup_core.js -> FFG.sim.Shmup) and paints it with
 * heavy juice: glowing additive bullets, muzzle pops, chunky explosions
 * (particle burst + shockwave + shake), boss-death hitstop + flash, a fast
 * parallax rushing starfield, gradient + vignette backdrop, floating score, and
 * combo popping. Keyboard (arrows/WASD + space) and pointer steering. HUD with
 * score / lives / weapon and a boss HP bar. Win/lose overlay + restart.
 *
 * JUICE LAYER: the 2D kernel (v2.0.0) exposes only register/text/audio/color/
 * boot — it does NOT ship the FFG.fx / FFG.palette helpers some genres assume.
 * So this renderer carries its OWN self-contained FX module (glow/bloom/shake/
 * flash/zoomPunch/hitstop/pop/burst/shockwave/float/starfield/gradient/vignette)
 * built on Phaser primitives, and transparently DEFERS to FFG.fx / FFG.palette
 * if a future kernel provides them. Nothing here touches the shared kernel.
 *
 * window.__test = { start(), autoResolve() } is exposed for the headless
 * feel-gate: autoResolve() fast-simulates to a resolution with no real input.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};
  FFG.sim = FFG.sim || {};

  // ── palettes (used if FFG.palette absent) ───────────────────────────────────
  var PALETTES = {
    abyss: { bg: "#040810", bg2: "#0a1830", primary: "#36e0ff", accent: "#ff3bd4", good: "#54ffb0", danger: "#ff4d5e", warn: "#ffd166", ink: "#dff6ff" },
    neon:  { bg: "#0a0312", bg2: "#1a0a2e", primary: "#00e5ff", accent: "#ff2bd6", good: "#8cff5a", danger: "#ff3860", warn: "#ffe066", ink: "#f4eaff" },
  };
  function getPalette(name) {
    if (typeof FFG.palette === "function") { try { var p = FFG.palette(name); if (p) return p; } catch (e) {} }
    return PALETTES[name] || PALETTES.abyss;
  }
  function hexNum(h) { return (typeof h === "string") ? parseInt(h.replace("#", "0x")) : h; }
  function shade(hex, f) {
    if (typeof FFG.shade === "function") { try { return FFG.shade(hex, f); } catch (e) {} }
    var n = hexNum(hex), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
    var c = function (v) { return Math.max(0, Math.min(255, v | 0)); };
    return (c(r) << 16) | (c(g) << 8) | c(b);
  }

  // ── self-contained juice (deferring to FFG.fx if present) ────────────────────
  function makeFX(scene) {
    if (FFG.fx && typeof FFG.fx.bind === "function") {
      try { return FFG.fx.bind(scene); } catch (e) {}
    }
    var supportsPostFX = !!(scene.sys.renderer && scene.sys.renderer.type === Phaser.WEBGL);
    var FX = {
      _scene: scene,
      _frozen: false,

      // additive glow on a game object. WebGL: real postFX bloom-ish glow.
      // Canvas fallback: nothing (the ADD blend + soft texture already glow).
      glow: function (obj, color, outer) {
        if (!obj) return obj;
        if (supportsPostFX && obj.postFX && obj.postFX.addGlow) {
          try { obj.postFX.addGlow(color != null ? hexNum(color) : 0xffffff, outer || 4, 0, false, 0.08, 4); } catch (e) {} // quality 12->4 (per-entity glow FPS)
        }
        return obj;
      },
      // scene-wide bloom on the main camera (subtle — additive overdraw does
      // most of the glow, so keep the bloom blur cheap: few steps).
      bloom: function (strength) {
        if (!supportsPostFX) return;
        try {
          var cam = scene.cameras.main;
          if (cam.postFX && cam.postFX.addBloom) cam.postFX.addBloom(0xffffff, 1, 1, 0.7, strength == null ? 0.55 : Math.min(strength, 0.6), 1); // steps 4->1 (full-screen bloom FPS)
        } catch (e) {}
      },
      shake: function (dur, intensity) { scene.cameras.main.shake(dur || 160, intensity == null ? 0.006 : intensity); },
      flash: function (color, dur) {
        var n = color != null ? hexNum(color) : 0xffffff;
        scene.cameras.main.flash(dur || 120, (n >> 16) & 255, (n >> 8) & 255, n & 255);
      },
      zoomPunch: function (amt, dur) {
        var cam = scene.cameras.main, z = cam.zoom;
        scene.tweens.add({ targets: cam, zoom: z * (1 + (amt == null ? 0.04 : amt)), duration: (dur || 120) / 2, yoyo: true, ease: "Quad.easeOut" });
      },
      hitstop: function (ms) {
        if (FX._frozen) return;
        FX._frozen = true;
        var prevTw = scene.tweens.timeScale;
        scene.tweens.timeScale = 0.0001;
        scene.time.delayedCall(ms || 60, function () { scene.tweens.timeScale = prevTw; FX._frozen = false; });
      },
      pop: function (obj, scale, dur) {
        if (!obj) return;
        var sx = obj.scaleX, sy = obj.scaleY, s = scale == null ? 1.35 : scale;
        scene.tweens.add({ targets: obj, scaleX: sx * s, scaleY: sy * s, duration: (dur || 130) / 2, yoyo: true, ease: "Quad.easeOut" });
      },
      // particle burst built from pooled soft sprites with ADD blend
      burst: function (x, y, o) {
        o = o || {};
        var count = o.count == null ? 14 : o.count;
        var color = o.color != null ? hexNum(o.color) : 0xffffff;
        var speed = o.speed == null ? 220 : o.speed;
        var scale = o.scale == null ? 1 : o.scale;
        var life = o.life == null ? 480 : o.life;
        var spark = !!o.spark;
        var gravityY = o.gravityY || 0;
        var baseAngle = o.angle == null ? null : o.angle;   // radians; null = full circle
        var spread = o.spread == null ? Math.PI * 2 : o.spread;
        for (var i = 0; i < count; i++) {
          var ang = baseAngle != null ? (baseAngle - spread / 2 + Math.random() * spread) : (Math.random() * Math.PI * 2);
          var sp = speed * (0.4 + Math.random() * 0.8);
          var key = spark ? "fx_spark" : "fx_dot";
          var pcl = scene.add.image(x, y, key).setBlendMode(Phaser.BlendModes.ADD).setDepth(60);
          pcl.setTint(color);
          var ps = (spark ? 0.5 : 0.8) * scale * (0.6 + Math.random() * 0.8);
          pcl.setScale(ps);
          if (spark) pcl.setRotation(ang);
          var vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
          var ttl = life * (0.7 + Math.random() * 0.6);
          (function (pcl, vx, vy, ttl) {
            var startX = pcl.x, startY = pcl.y;
            scene.tweens.add({
              targets: pcl, duration: ttl, ease: "Quad.easeOut",
              alpha: 0, scale: spark ? ps * 0.3 : 0,
              onUpdate: function (tw) {
                var t = tw.progress;
                pcl.x = startX + vx * (ttl / 1000) * t;
                pcl.y = startY + vy * (ttl / 1000) * t + 0.5 * gravityY * Math.pow((ttl / 1000) * t, 2);
              },
              onComplete: function () { pcl.destroy(); },
            });
          })(pcl, vx, vy, ttl);
        }
      },
      // expanding ring shockwave
      shockwave: function (x, y, o) {
        o = o || {};
        var color = o.color != null ? hexNum(o.color) : 0xffffff;
        var r0 = o.r0 == null ? 6 : o.r0;
        var r1 = o.r1 == null ? 90 : o.r1;
        var dur = o.dur == null ? 420 : o.dur;
        var thickness = o.thickness == null ? 4 : o.thickness;
        var ring = scene.add.circle(x, y, r0).setStrokeStyle(thickness, color, 1).setFillStyle()
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(58);
        ring.setData("r", r0);
        scene.tweens.add({
          targets: ring, duration: dur, ease: "Cubic.easeOut", alpha: 0,
          onUpdate: function (tw) {
            var rr = r0 + (r1 - r0) * tw.progress;
            ring.setRadius(rr);
            ring.setStrokeStyle(thickness * (1 - tw.progress * 0.7), color, 1 - tw.progress);
          },
          onComplete: function () { ring.destroy(); },
        });
      },
      float: function (x, y, text, o) {
        o = o || {};
        var t = FFG.text(scene, x, y, text, {
          size: o.size || 16, color: o.colorStr || "#ffffff", font: "monospace",
          stroke: "#000000", strokeThickness: 3, origin: 0.5, depth: 80,
        });
        var rise = o.rise == null ? 46 : o.rise;
        t.setScale(0.6);
        scene.tweens.add({ targets: t, scale: 1, duration: 120, ease: "Back.easeOut" });
        scene.tweens.add({ targets: t, y: y - rise, alpha: 0, duration: o.dur || 760, delay: 90, ease: "Cubic.easeOut", onComplete: function () { t.destroy(); } });
        return t;
      },
    };
    return FX;
  }

  // ── small runtime textures (generated once per scene; no external assets) ───
  function makeTextures(scene) {
    var g = scene.add.graphics();
    function radial(key, size, inner) {
      if (scene.textures.exists(key)) return;
      var rt = scene.add.renderTexture(0, 0, size, size).setVisible(false);
      var steps = 14, cx = size / 2;
      for (var i = steps; i >= 1; i--) {
        var r = (cx) * (i / steps);
        var a = inner * Math.pow(1 - (i / steps), 1.6);
        g.clear(); g.fillStyle(0xffffff, a); g.fillCircle(cx, cx, r);
        rt.draw(g, 0, 0);
      }
      rt.saveTexture(key); rt.destroy();
    }
    // soft round dot (bullets, particles, glows)
    radial("fx_dot", 48, 0.5);
    // tiny bright spark
    if (!scene.textures.exists("fx_spark")) {
      var s = scene.add.renderTexture(0, 0, 16, 16).setVisible(false);
      g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(6, 0, 4, 16);
      g.fillStyle(0xffffff, 0.5); g.fillRect(4, 2, 8, 12);
      s.draw(g, 0, 0); s.saveTexture("fx_spark"); s.destroy();
    }
    // a star pixel
    if (!scene.textures.exists("fx_star")) {
      var st = scene.add.renderTexture(0, 0, 4, 4).setVisible(false);
      g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(2, 2, 1.6);
      st.draw(g, 0, 0); st.saveTexture("fx_star"); st.destroy();
    }
    g.destroy();
  }

  // ── parallax rushing starfield ──────────────────────────────────────────────
  // WHITE / cool-neutral stars ONLY. The enemy bullets are MAGENTA/pink, so the
  // starfield must never share that hue or the bullets vanish into it (owner
  // feedback: "hard to see the pink enemy attacks because of all the green
  // stars"). Far layer = faint cool blue-white, near layers = white. No accent
  // (pink) and no good (green) tint anywhere in the field.
  function makeStarfield(scene, W, H, pal) {
    var FAR = 0x9fb4d8;   // faint cool blue-white (depth)
    var MID = 0xdfe8f5;   // cool neutral white
    var NEAR = 0xffffff;  // pure white (closest, brightest)
    // DIMMED hard (user: stars were still too prominent) — low alpha + smaller +
    // fewer, so they read as faint depth and never compete with the pink bullets.
    var layers = [
      { n: 44, speed: 90,  scale: 0.45, alpha: 0.16, tint: FAR },
      { n: 34, speed: 180, scale: 0.65, alpha: 0.26, tint: MID },
      { n: 18, speed: 340, scale: 0.95, alpha: 0.40, tint: NEAR },
    ];
    var stars = [];
    layers.forEach(function (L) {
      for (var i = 0; i < L.n; i++) {
        var s = scene.add.image(Math.random() * W, Math.random() * H, "fx_star")
          .setScale(L.scale).setAlpha(L.alpha).setTint(L.tint).setDepth(2).setBlendMode(Phaser.BlendModes.ADD);
        stars.push({ s: s, speed: L.speed, scale: L.scale });
      }
    });
    return {
      update: function (dt, boost) {
        var b = boost || 1;
        for (var i = 0; i < stars.length; i++) {
          var st = stars[i];
          st.s.y += st.speed * dt * b;
          // streak when boosting
          st.s.scaleY = st.scale * (1 + (b - 1) * 2.2);
          if (st.s.y > H + 4) { st.s.y = -4; st.s.x = Math.random() * W; }
        }
      },
    };
  }

  function registerShmup() {
    FFG.register("shmup", function (content) {
      var view = content.view || {};
      var W = view.width || 720, H = view.height || 900;
      var pal = getPalette(content.palette || "abyss");
      var theme = content.theme || {};
      var COL = {
        ship: hexNum(theme.ship || pal.primary),
        shipGlow: hexNum(theme.shipGlow || pal.good),
        pbullet: hexNum(theme.bullet || pal.good),
        ebullet: hexNum(theme.enemyBullet || pal.accent),
        enemy: hexNum(theme.enemy || pal.accent),
        tank: hexNum(theme.tank || pal.warn),
        boss: hexNum(theme.boss || pal.danger),
        bossGlow: hexNum(theme.bossGlow || pal.accent),
        powerPickup: hexNum(pal.good),
        spreadPickup: hexNum(pal.warn),
        ink: hexNum(pal.ink),
      };

      return class ShmupScene extends Phaser.Scene {
        constructor() { super("shmup"); }

        create() {
          var self = this;
          this.W = W; this.H = H; this.pal = pal; this.COL = COL;
          this.started = false;
          this.over = false;

          makeTextures(this);
          this.fx = makeFX(this);
          FFG.audio.bind(this);

          // backdrop: vertical gradient + vignette
          this._gradient();
          this.starfield = makeStarfield(this, W, H, pal);
          this._vignette();

          // sim
          var Shmup = FFG.sim.Shmup;
          if (!Shmup) { console.error("[FFG shmup] sim FFG.sim.Shmup missing"); return; }
          this.sim = new Shmup(content);

          // object pools / containers ------------------------------------------
          this.gPbullets = this.add.group();
          this.gEbullets = this.add.group();
          this.gEnemies = this.add.group();
          this.gPickups = this.add.group();
          this._enemyMap = {};   // id -> sprite
          this._pbSprites = [];
          this._ebSprites = [];
          this._pkSprites = [];

          // player ship (drawn as a glowing arrowhead via graphics->texture)
          this._makeShipTexture();
          this.ship = this.add.image(this.sim.player.x, this.sim.player.y, "ship_tex").setDepth(40);
          this.fx.glow(this.ship, COL.shipGlow, 6);
          // engine flame
          this.flame = this.add.image(this.ship.x, this.ship.y + 18, "fx_dot").setTint(COL.shipGlow)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(39).setScale(0.7);

          // boss container (built on spawn)
          this.bossGfx = null;

          // bloom over everything
          this.fx.bloom(1.0);

          // HUD ----------------------------------------------------------------
          this._buildHUD();

          // input --------------------------------------------------------------
          // Arrow keys + mouse only — WASD removed (redundant; user asked to drop it).
          this.keys = this.input.keyboard.addKeys({
            up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT",
            fire: "SPACE", restart: "R",
          });
          this._pointer = null;
          this.input.on("pointermove", function (p) { if (self.started && !self.over) self._pointer = { x: p.x, y: p.y }; });
          this.input.on("pointerdown", function (p) {
            if (!self.started) { self._begin(); }
            else if (self.over) { self.scene.restart(); }
            else self._pointer = { x: p.x, y: p.y };
          });
          this.input.keyboard.on("keydown-R", function () { if (self.over) self.scene.restart(); });

          // ── MENU + PAUSE — the STANDARD FFG shell (title / difficulty / how-to /
          // settings / Esc-pause / win-lose). It owns window.__PAUSE__ + Escape and the
          // control-bar Mute; we just freeze/thaw the Phaser scene on its hooks and start
          // the run (+ procedural music) on Play. Replaces the old in-canvas title.
          var shellParent = (this.game && this.game.canvas && this.game.canvas.parentNode) || document.body;
          // Drop any orphaned overlay left by a previous scene.restart() (death → replay).
          try { var _olds = shellParent.querySelectorAll(".ffg-shell-overlay"); for (var _oi = 0; _oi < _olds.length; _oi++) _olds[_oi].remove(); } catch (e) {}
          this.shell = new FFG.Shell({
            parent: shellParent,
            title: content.title || "Starlance",
            tagline: content.subtitle || "Vertical bullet storm",
            music: null, // procedural SPACE synth loop (FFG.createSpaceMusic), started on Play
            difficulties: ["Cadet", "Pilot", "Ace"],
            defaultDifficulty: "Pilot",
            howTo: [
              { h: "GOAL", p: "Fly up through " + ((this.sim && this.sim.totalWorlds) || 6) + " hostile sectors. Clear every wave, then destroy the sector boss to advance." },
              { h: "MOVE", p: "<b>Arrow keys</b> to fly — or just steer with the <b>mouse</b>; the ship follows your cursor." },
              { h: "FIRE", p: "<b>Hold Space</b> (or hold the mouse button) to fire. Release to stop — there is no auto-shoot." },
              { h: "POWER", p: "Grab glowing pickups to upgrade your cannon and spread. A hit costs a life — don't get clipped." },
            ],
            onPlay: function (d) { self._difficulty = d; self._begin(); self._startMusic(); },
            onPause: function () { try { self.scene.pause(); } catch (e) {} },
            onResume: function () { try { self.scene.resume(); } catch (e) {} },
          });
          this.shell.start();

          // expose test hooks
          this._wireTestHooks();

          this._acc = 0;
          this._lastNow = null;
        }

        // ── backdrop helpers ──
        _gradient() {
          var top = hexNum(this.pal.bg), bot = hexNum(this.pal.bg2);
          var g = this.add.graphics().setDepth(0);
          var bands = 64;
          for (var i = 0; i < bands; i++) {
            var t = i / (bands - 1);
            var c = Phaser.Display.Color.Interpolate.ColorWithColor(
              Phaser.Display.Color.IntegerToColor(top),
              Phaser.Display.Color.IntegerToColor(bot), bands - 1, i);
            g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
            g.fillRect(0, Math.floor(this.H * t), this.W, Math.ceil(this.H / bands) + 1);
          }
          // faint nebula blobs for depth — COOL hues only (cyan / deep indigo).
          // Magenta/pink is reserved exclusively for ENEMY FIRE so bullets read.
          var nebTints = [hexNum(this.pal.primary), 0x2a4a8c, 0x1c6f8c];
          for (var k = 0; k < 5; k++) {
            var nb = this.add.image(Math.random() * this.W, Math.random() * this.H, "fx_dot")
              .setScale(6 + Math.random() * 6).setAlpha(0.06)
              .setTint(nebTints[k % nebTints.length])
              .setBlendMode(Phaser.BlendModes.ADD).setDepth(1);
          }
        }
        _vignette() {
          var g = this.add.graphics().setDepth(90);
          var steps = 18;
          for (var i = 0; i < steps; i++) {
            var a = 0.5 * Math.pow(i / steps, 2.4);
            g.lineStyle((this.W) * (1 - i / steps) * 0.06 + 6, 0x000000, a);
            g.strokeRect(-4 + i * 2, -4 + i * 2, this.W + 8 - i * 4, this.H + 8 - i * 4);
          }
        }

        _makeShipTexture() {
          if (this.textures.exists("ship_tex")) return;
          var g = this.add.graphics();
          var c = this.COL.ship, c2 = shade(c, 0.5), edge = shade(c, -0.3);
          // arrowhead pointing up, 34x40
          g.fillStyle(edge, 1); g.fillTriangle(17, 0, 0, 38, 34, 38);
          g.fillStyle(c, 1); g.fillTriangle(17, 4, 4, 34, 30, 34);
          g.fillStyle(c2, 1); g.fillTriangle(17, 9, 12, 30, 22, 30);
          // wing pods
          g.fillStyle(shade(c, -0.15), 1); g.fillRect(2, 24, 6, 12); g.fillRect(26, 24, 6, 12);
          g.fillStyle(this.COL.pbullet, 1); g.fillCircle(17, 18, 3);
          g.generateTexture("ship_tex", 34, 40);
          g.destroy();
        }

        // Distinct hue per enemy kind (drawn from the world palette so it stays
        // cohesive) — so each world's roster reads as its OWN species, not a recolor.
        _enemyColor(kind) {
          var m = {
            tank: this.COL.tank,
            darter: hexNum(this.pal.warn),
            weaver: hexNum(this.pal.accent),
            reaver: hexNum(this.pal.primary),
            lancer: hexNum(this.pal.danger),
            saucer: hexNum(this.pal.good),
            wisp: 0xc89cff,
          };
          return m[kind] != null ? m[kind] : this.COL.enemy;
        }

        _makeEnemyTexture(kind, color) {
          var key = "enemy_" + kind;
          if (this.textures.exists(key)) return key;
          var g = this.add.graphics();
          var c = hexNum(color), c2 = shade(c, 0.45), edge = shade(c, -0.35);
          if (kind === "reaver") {
            // heavy interceptor — broad hexagonal hull with twin prongs
            g.fillStyle(edge, 1); g.fillRoundedRect(2, 6, 40, 30, 7);
            g.fillStyle(c, 1); g.fillRoundedRect(7, 10, 30, 20, 5);
            g.fillStyle(edge, 1); g.fillTriangle(2, 6, 2, 36, -6, 21); g.fillTriangle(42, 6, 42, 36, 50, 21);
            g.fillStyle(c2, 1); g.fillCircle(22, 20, 6);
            g.fillStyle(this.COL.ebullet, 1); g.fillCircle(22, 33, 3);
            g.generateTexture(key, 46, 44); g.destroy(); return key;
          }
          if (kind === "lancer") {
            // fast spear — long narrow dart, swept fins
            g.fillStyle(edge, 1); g.fillTriangle(9, 34, 3, 8, 15, 8);
            g.fillStyle(c, 1); g.fillTriangle(9, 30, 5, 11, 13, 11);
            g.fillStyle(edge, 1); g.fillTriangle(3, 16, 0, 26, 6, 20); g.fillTriangle(15, 16, 18, 26, 12, 20);
            g.fillStyle(c2, 1); g.fillRect(8, 4, 2, 8);
            g.generateTexture(key, 18, 36); g.destroy(); return key;
          }
          if (kind === "saucer") {
            // big lazy disc — wide ellipse with a dome + rim lights
            g.fillStyle(edge, 1); g.fillEllipse(24, 18, 46, 20);
            g.fillStyle(c, 1); g.fillEllipse(24, 17, 38, 15);
            g.fillStyle(c2, 1); g.fillCircle(24, 12, 8);
            g.fillStyle(0xffffff, 0.9); g.fillCircle(24, 11, 3);
            g.fillStyle(this.COL.ebullet, 1); g.fillCircle(9, 19, 2); g.fillCircle(24, 22, 2); g.fillCircle(39, 19, 2);
            g.generateTexture(key, 48, 32); g.destroy(); return key;
          }
          if (kind === "wisp") {
            // small erratic ghost — soft diamond core with trailing wings
            g.fillStyle(edge, 1); g.fillTriangle(12, 0, 0, 12, 12, 24); g.fillTriangle(12, 0, 24, 12, 12, 24);
            g.fillStyle(c, 1); g.fillTriangle(12, 4, 4, 12, 12, 20); g.fillTriangle(12, 4, 20, 12, 12, 20);
            g.fillStyle(0xffffff, 0.85); g.fillCircle(12, 12, 3);
            g.generateTexture(key, 24, 24); g.destroy(); return key;
          }
          if (kind === "tank") {
            g.fillStyle(edge, 1); g.fillRoundedRect(0, 0, 46, 40, 8);
            g.fillStyle(c, 1); g.fillRoundedRect(4, 4, 38, 30, 6);
            g.fillStyle(c2, 1); g.fillRoundedRect(12, 8, 22, 12, 4);
            g.fillStyle(this.COL.ebullet, 1); g.fillCircle(23, 30, 4);
            g.generateTexture(key, 46, 44); g.destroy(); return key;
          }
          if (kind === "darter") {
            g.fillStyle(edge, 1); g.fillTriangle(14, 28, 0, 0, 28, 0);
            g.fillStyle(c, 1); g.fillTriangle(14, 24, 4, 3, 24, 3);
            g.fillStyle(c2, 1); g.fillCircle(14, 9, 4);
            g.generateTexture(key, 28, 30); g.destroy(); return key;
          }
          if (kind === "weaver") {
            g.fillStyle(edge, 1); g.fillCircle(16, 16, 15);
            g.fillStyle(c, 1); g.fillCircle(16, 16, 11);
            g.fillStyle(c2, 1); g.fillCircle(16, 13, 5);
            g.fillStyle(this.COL.ebullet, 1); g.fillRect(2, 14, 28, 3);
            g.generateTexture(key, 32, 32); g.destroy(); return key;
          }
          // grunt — inverted small ship
          g.fillStyle(edge, 1); g.fillTriangle(16, 30, 0, 2, 32, 2);
          g.fillStyle(c, 1); g.fillTriangle(16, 26, 5, 5, 27, 5);
          g.fillStyle(c2, 1); g.fillCircle(16, 11, 4);
          g.generateTexture(key, 32, 32); g.destroy(); return key;
        }

        _buildBossGfx() {
          var b = this.sim.boss;
          var cont = this.add.container(b.x, b.y).setDepth(45);
          var g = this.add.graphics();
          var shape = (b && b.shape) || 1;
          var wn = (this.sim.state && this.sim.state().worldNum) || shape;
          // each world's flagship reads as its OWN ship: distinct hue + distinct hull.
          var BOSSPAL = [0xff4d5e, 0xffa53b, 0x9b6bff, 0x3ad1ff, 0x49e08a, 0xff3bd4];
          var c = BOSSPAL[(wn - 1) % BOSSPAL.length], c2 = shade(c, 0.4), edge = shade(c, -0.4), core = shade(c, 0.55);
          var key = "boss_tex_" + wn + "_" + shape;
          if (!this.textures.exists(key)) {
            // All variants stay inside shape-1's proven 160x90 envelope (x:[-78,78],
            // y:[-36,32]) so texture capture + placement are identical across worlds.
            if (shape === 2) {           // GRINDER — twin forward pincers
              g.fillStyle(edge, 1); g.fillRoundedRect(-64, -30, 128, 56, 10);
              g.fillStyle(c, 1); g.fillRoundedRect(-56, -24, 112, 42, 8);
              g.fillStyle(edge, 1); g.fillTriangle(-64, -30, -64, 26, -78, -2); g.fillTriangle(64, -30, 64, 26, 78, -2);
              g.fillStyle(c2, 1); g.fillRect(-10, -28, 20, 50);
            } else if (shape === 3) {    // SIEGE-CORE — hexagonal fortress
              g.fillStyle(edge, 1); g.fillPoints([{ x: -40, y: -32 }, { x: 40, y: -32 }, { x: 74, y: 0 }, { x: 40, y: 32 }, { x: -40, y: 32 }, { x: -74, y: 0 }], true);
              g.fillStyle(c, 1); g.fillPoints([{ x: -32, y: -24 }, { x: 32, y: -24 }, { x: 58, y: 0 }, { x: 32, y: 24 }, { x: -32, y: 24 }, { x: -58, y: 0 }], true);
              g.fillStyle(c2, 1); g.fillRoundedRect(-30, -13, 60, 26, 6);
            } else if (shape === 4) {    // STORMBRINGER — swept arrowhead with wings
              g.fillStyle(edge, 1); g.fillTriangle(0, -36, 76, 30, -76, 30);
              g.fillStyle(c, 1); g.fillTriangle(0, -26, 60, 24, -60, 24);
              g.fillStyle(c2, 1); g.fillTriangle(0, -14, 28, 18, -28, 18);
            } else if (shape === 5) {    // VOID HIEROPHANT — monolith with halo arms
              g.fillStyle(edge, 1); g.fillRoundedRect(-28, -36, 56, 68, 10);
              g.fillStyle(c, 1); g.fillRoundedRect(-20, -28, 40, 54, 8);
              g.fillStyle(edge, 1); g.fillRoundedRect(-78, -8, 30, 16, 6); g.fillRoundedRect(48, -8, 30, 16, 6);
              g.fillStyle(c2, 1); g.fillCircle(0, -14, 9);
            } else if (shape === 6) {    // OMEGA DREADNOUGHT — layered battleship
              g.fillStyle(edge, 1); g.fillRoundedRect(-78, -34, 156, 64, 12);
              g.fillStyle(c, 1); g.fillRoundedRect(-70, -28, 140, 50, 10);
              g.fillStyle(c2, 1); g.fillRoundedRect(-54, -20, 108, 24, 8);
              g.fillStyle(edge, 1); g.fillRect(-46, 22, 18, 10); g.fillRect(28, 22, 18, 10);
              g.fillStyle(c2, 1); g.fillTriangle(0, -36, 16, -22, -16, -22);
            } else {                     // WARDEN (1) — crescent dreadnought (original)
              g.fillStyle(edge, 1); g.fillRoundedRect(-70, -36, 140, 64, 14);
              g.fillStyle(c, 1); g.fillRoundedRect(-62, -30, 124, 50, 12);
              g.fillStyle(c2, 1); g.fillRoundedRect(-44, -22, 88, 20, 8);
            }
            // side cannons + core — common to every hull
            g.fillStyle(edge, 1); g.fillRect(-78, -6, 16, 34); g.fillRect(62, -6, 16, 34);
            g.fillStyle(c2, 1); g.fillRect(-74, 18, 8, 14); g.fillRect(66, 18, 8, 14);
            g.fillStyle(core, 1); g.fillCircle(0, 0, 16);
            g.fillStyle(0xffffff, 0.9); g.fillCircle(0, 0, 7);
            g.generateTexture(key, 160, 90);
          }
          g.destroy();
          var body = this.add.image(0, 0, key);
          var coreGlow = this.add.image(0, 0, "fx_dot").setTint(core).setBlendMode(Phaser.BlendModes.ADD).setScale(2.2).setAlpha(0.8);
          cont.add([body, coreGlow]);
          this.fx.glow(body, core, 8);
          this._bossBody = body; this._bossCoreGlow = coreGlow;
          // pulsing core
          this.tweens.add({ targets: coreGlow, scale: 2.7, alpha: 0.55, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
          this.bossGfx = cont;
        }

        // ── HUD ──
        _buildHUD() {
          var pad = 14;
          // top backing strip so the HUD stays readable over the bullet-storm
          var bar = this.add.graphics().setDepth(95).setScrollFactor(0);
          bar.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.62, 0.62, 0, 0); bar.fillRect(0, 0, this.W, 56);
          this.hudScore = FFG.text(this, pad, pad, "SCORE 0", { size: 20, color: "#ffffff", stroke: "#000", strokeThickness: 3, depth: 100 });
          this.hudCombo = FFG.text(this, pad, pad + 26, "", { size: 14, color: this.pal.warn, stroke: "#000", strokeThickness: 3, depth: 100 });
          this.hudLives = FFG.text(this, this.W - pad, pad, "", { size: 18, color: this.pal.danger, stroke: "#000", strokeThickness: 3, origin: 1, originY: 0, depth: 100 });
          this.hudWeapon = FFG.text(this, this.W - pad, pad + 24, "", { size: 14, color: this.pal.good, stroke: "#000", strokeThickness: 3, origin: 1, originY: 0, depth: 100 });
          // centre column: WORLD x/6 (bright) over WAVE n/m
          this.hudWorld = FFG.text(this, this.W / 2, pad - 1, "", { size: 16, color: "#ffffff", stroke: "#000", strokeThickness: 3, origin: 0.5, originY: 0, depth: 100 });
          this.hudWave = FFG.text(this, this.W / 2, pad + 21, "", { size: 12, color: this.pal.ink, stroke: "#000", strokeThickness: 3, origin: 0.5, originY: 0, depth: 100 });
          // boss bar (hidden until boss)
          this.bossBarBg = this.add.rectangle(this.W / 2, 66, this.W - 120, 16, 0x000000, 0.55).setStrokeStyle(2, hexNum(this.pal.danger), 0.9).setDepth(100).setVisible(false);
          this.bossBarFill = this.add.rectangle(this.W / 2 - (this.W - 124) / 2, 66, this.W - 124, 12, hexNum(this.pal.danger), 1).setOrigin(0, 0.5).setDepth(101).setVisible(false);
          this.bossBarLabel = FFG.text(this, this.W / 2, 66, "BOSS", { size: 11, color: "#ffffff", stroke: "#000", strokeThickness: 3, origin: 0.5, depth: 102 });
          this.bossBarLabel.setVisible(false);
          this._updateHUD();
        }
        _updateHUD() {
          var s = this.sim.state();
          this.hudScore.setText("SCORE " + s.score);
          this.hudCombo.setText(s.combo > 1 ? (s.combo + "x COMBO") : "");
          var hearts = "";
          for (var i = 0; i < s.player.lives; i++) hearts += "◆ ";
          this.hudLives.setText(hearts.trim());
          var wn = ["", "SINGLE", "DOUBLE", "TRIPLE", "SPREAD-5"][Math.min(4, s.player.weapon)];
          this.hudWeapon.setText("WPN " + wn);
          // always show the current world; only show WAVE while clearing waves
          this.hudWorld.setText("WORLD " + s.worldNum + " / " + s.totalWorlds);
          if (s.boss) {
            this.hudWave.setText("BOSS");
          } else if (s.interWorld) {
            this.hudWave.setText("CLEARED");
          } else {
            this.hudWave.setText("WAVE " + Math.min(s.wave + 1, s.totalWaves) + " / " + s.totalWaves);
          }
        }

        // ── overlays ──
        _begin() {
          if (this.started) return;
          this.started = true;
          // Hide the shell menu (also covers the direct test-harness __test.start() path).
          try { if (this.shell) { this.shell.hide(); this.shell.phase = "playing"; } } catch (e) {}
          this.fx.flash(this.pal.primary, 180);
          this.fx.shake(140, 0.004);
        }

        // Procedural SPACE background score (Web Audio, no asset) — started on Play so
        // browser autoplay is allowed. Honors the control-bar Mute + the shell volume.
        _startMusic() {
          try {
            if (this._music || !(window.FFG && window.FFG.createSpaceMusic)) return;
            var base = (this.shell && this.shell.musicVolume != null) ? this.shell.musicVolume : 0.3;
            this._music = window.FFG.createSpaceMusic(base);
            this._music.start();
            var self = this;
            window.addEventListener("mutechange", function (e) {
              var m = !!(e.detail && e.detail.muted);
              if (self._music) self._music.setVolume(m ? 0 : ((self.shell && self.shell.musicVolume != null) ? self.shell.musicVolume : base));
            });
          } catch (e) {}
        }
        _stopMusic() { try { if (this._music) { this._music.stop(); this._music = null; } } catch (e) {} }

        _endOverlay(victory) {
          var self = this;
          this.over = true;
          this._stopMusic();
          var s = this.sim.state();
          this.endC = this.add.container(0, 0).setDepth(130);
          var dim = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.6);
          var title = victory ? "CAMPAIGN CLEAR" : "SHIP DOWN";
          var col = victory ? this.pal.good : this.pal.danger;
          var tt = FFG.text(this, this.W / 2, this.H * 0.4, title, { size: victory ? 46 : 56, color: col, stroke: "#000", strokeThickness: 6, origin: 0.5 });
          tt.setScale(0);
          this.tweens.add({ targets: tt, scale: 1, duration: 420, ease: "Back.easeOut" });
          var subLine = victory
            ? ("ALL " + s.totalWorlds + " WORLDS CLEARED")
            : ("REACHED WORLD " + s.worldNum + " / " + s.totalWorlds);
          var ws = FFG.text(this, this.W / 2, this.H * 0.4 + 40, subLine, { size: 16, color: this.pal.ink, origin: 0.5 });
          var sc = FFG.text(this, this.W / 2, this.H * 0.4 + 72, "SCORE  " + s.score, { size: 24, color: "#ffffff", stroke: "#000", strokeThickness: 3, origin: 0.5 });
          var cb = FFG.text(this, this.W / 2, this.H * 0.4 + 104, "BEST COMBO  " + s.bestCombo + "x", { size: 16, color: this.pal.warn, origin: 0.5 });
          var rs = FFG.text(this, this.W / 2, this.H * 0.62, "CLICK / press R to fly again", { size: 18, color: "#ffffff", stroke: "#000", strokeThickness: 3, origin: 0.5 });
          this.tweens.add({ targets: rs, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
          this.endC.add([dim, tt, ws, sc, cb, rs]);
          if (victory) { this.fx.flash(this.pal.good, 240); }
          else { this.fx.flash(this.pal.danger, 220); this.fx.shake(360, 0.012); }
        }

        // ── input gather ──
        // HOLD TO FIRE (user: no auto-shoot): the ship only fires while SPACE is held
        // or the mouse/touch is pressed. Keyboard takes priority over pointer steering.
        _gatherInput() {
          var k = this.keys;
          var firing = !!(k.fire && k.fire.isDown) || !!(this.input && this.input.activePointer && this.input.activePointer.isDown);
          var inp = { left: false, right: false, up: false, down: false, fire: firing, moveTo: null };
          if (this._pointer) inp.moveTo = this._pointer;
          var L = k.left.isDown, R = k.right.isDown;
          var U = k.up.isDown, D = k.down.isDown;
          if (L || R || U || D) {
            inp.moveTo = null;        // keyboard overrides pointer steering
            inp.left = L; inp.right = R; inp.up = U; inp.down = D;
          }
          return inp;
        }

        // ── per-event juice ──
        _spawnJuiceForEvents(events) {
          for (var i = 0; i < events.length; i++) {
            var e = events[i];
            switch (e.type) {
              case "muzzle":
                this.fx.burst(e.x, e.y, { color: this.COL.pbullet, count: 4, speed: 120, scale: 0.5, life: 160, angle: -Math.PI / 2, spread: 0.7, spark: true });
                this.fx.pop(this.ship, 1.12, 90);
                FFG.audio.sfx("shoot", 0.25);
                break;
              case "enemyFire":
                this.fx.burst(e.x, e.y, { color: this.COL.ebullet, count: 3, speed: 90, scale: 0.4, life: 150, angle: Math.PI / 2, spread: 0.8 });
                break;
              case "hit":
                this.fx.burst(e.x, e.y, { color: e.target === "boss" ? this.COL.bossGlow : "#ffffff", count: 5, speed: 160, scale: 0.5, life: 220, spark: true });
                if (e.target === "boss" && this._bossBody) this.fx.pop(this._bossBody, 1.03, 60);
                break;
              case "kill":
                this._explode(e.x, e.y, e.kind);
                break;
              case "score":
                this.fx.float(e.x, e.y - 12, "+" + e.amount, { colorStr: e.mult > 1 ? "#" + this.COL.spreadPickup.toString(16) : "#ffffff", size: e.mult > 1 ? 18 : 14, rise: 50 });
                break;
              case "pickup":
                this.fx.burst(e.x, e.y, { color: e.kind === "power" ? this.COL.powerPickup : this.COL.spreadPickup, count: 14, speed: 200, scale: 0.7, life: 420 });
                this.fx.shockwave(e.x, e.y, { color: e.kind === "power" ? this.COL.powerPickup : this.COL.spreadPickup, r0: 6, r1: 56, dur: 360, thickness: 3 });
                this.fx.float(e.x, e.y - 20, e.kind === "power" ? "POWER UP" : "SPREAD UP", { colorStr: "#ffffff", size: 14, rise: 40 });
                this.fx.pop(this.ship, 1.3, 160);
                FFG.audio.sfx("pickup", 0.5);
                break;
              case "playerHit":
                this._playerExplode(e.x, e.y);
                break;
              case "bossWarn":
                this._bossWarn(e.name);
                break;
              case "bossKill":
                this._bossDeath(e.x, e.y);
                break;
              case "worldStart":
                this._worldBanner("WORLD " + e.world, (this.sim._world && this.sim._world.name) || "", this.pal.primary);
                break;
              case "worldClear":
                this._worldBanner("WORLD " + e.world + " CLEARED", "stand by — next sector inbound", this.pal.good);
                this.fx.flash(this.pal.good, 200);
                break;
              case "win":
                // win overlay deferred until boss death animation reads nicely
                this.time.delayedCall(900, function () { if (!this.over) this._endOverlay(true); }.bind(this));
                break;
              case "lose":
                this.time.delayedCall(500, function () { if (!this.over) this._endOverlay(false); }.bind(this));
                break;
              case "waveClear":
                if (e.wave > 0 && e.wave <= this.sim.state().totalWaves) {
                  this.fx.float(this.W / 2, this.H * 0.3, "WAVE CLEAR", { colorStr: "#" + this.COL.shipGlow.toString(16), size: 22, rise: 30, dur: 900 });
                }
                break;
            }
          }
        }

        // big centred "WORLD n" / "WORLD n CLEARED" banner between worlds
        _worldBanner(title, sub, color) {
          var c = "#" + hexNum(color).toString(16).padStart(6, "0");
          var t1 = FFG.text(this, this.W / 2, this.H * 0.40, title, { size: 44, color: "#ffffff", stroke: "#000", strokeThickness: 6, origin: 0.5, depth: 115 });
          t1.setTint(hexNum(color));
          t1.setScale(0.5); t1.setAlpha(0);
          this.tweens.add({ targets: t1, scale: 1, alpha: 1, duration: 320, ease: "Back.easeOut" });
          var t2 = null;
          if (sub) {
            t2 = FFG.text(this, this.W / 2, this.H * 0.40 + 40, sub, { size: 15, color: c, origin: 0.5, depth: 115 });
            t2.setAlpha(0);
            this.tweens.add({ targets: t2, alpha: 1, duration: 320, delay: 120 });
          }
          var targets = t2 ? [t1, t2] : [t1];
          this.tweens.add({ targets: targets, alpha: 0, y: "-=20", delay: 1500, duration: 420, ease: "Cubic.easeIn",
            onComplete: function () { t1.destroy(); if (t2) t2.destroy(); } });
        }

        _explode(x, y, kind) {
          var big = kind === "tank";
          var c = kind === "tank" ? this.COL.tank : this.COL.enemy;
          this.fx.burst(x, y, { color: c, count: big ? 26 : 16, speed: big ? 300 : 230, scale: big ? 1.2 : 0.9, life: 520, spark: false, gravityY: 60 });
          this.fx.burst(x, y, { color: "#ffffff", count: big ? 14 : 8, speed: big ? 360 : 270, scale: 0.6, life: 340, spark: true });
          this.fx.shockwave(x, y, { color: c, r0: 6, r1: big ? 120 : 80, dur: big ? 460 : 380, thickness: big ? 5 : 3 });
          // bright flash sprite
          var fl = this.add.image(x, y, "fx_dot").setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setScale(big ? 2.4 : 1.6).setDepth(62);
          this.tweens.add({ targets: fl, scale: 0, alpha: 0, duration: 220, ease: "Quad.easeOut", onComplete: function () { fl.destroy(); } });
          this.fx.shake(big ? 160 : 90, big ? 0.008 : 0.004);
          if (big) this.fx.zoomPunch(0.02, 120);
          FFG.audio.sfx(big ? "explode_big" : "explode", 0.5);
        }

        _playerExplode(x, y) {
          this.fx.burst(x, y, { color: this.COL.shipGlow, count: 24, speed: 280, scale: 1.0, life: 520, spark: false });
          this.fx.burst(x, y, { color: "#ffffff", count: 14, speed: 340, scale: 0.6, life: 360, spark: true });
          this.fx.shockwave(x, y, { color: this.COL.danger || this.COL.boss, r0: 6, r1: 120, dur: 460, thickness: 5 });
          this.fx.flash(this.pal.danger, 160);
          this.fx.shake(280, 0.012);
          this.fx.hitstop(70);
          FFG.audio.sfx("explode_big", 0.6);
        }

        _bossWarn(name) {
          var t = FFG.text(this, this.W / 2, this.H * 0.42, "!! WARNING !!", { size: 34, color: "#" + this.COL.boss.toString(16), stroke: "#000", strokeThickness: 5, origin: 0.5, depth: 110 });
          var t2 = FFG.text(this, this.W / 2, this.H * 0.42 + 36, (name || "DREADNOUGHT") + " INBOUND", { size: 16, color: this.pal.warn, origin: 0.5, depth: 110 });
          t.setScale(0.6);
          this.tweens.add({ targets: t, scale: 1.05, duration: 200, yoyo: true, repeat: 2, ease: "Sine.easeInOut" });
          this.tweens.add({ targets: [t, t2], alpha: 0, delay: 1400, duration: 400, onComplete: function () { t.destroy(); t2.destroy(); } });
          this.fx.flash(this.pal.danger, 160);
          this.fx.shake(220, 0.006);
        }

        _bossDeath(x, y) {
          var self = this;
          this.fx.hitstop(260);
          this.fx.zoomPunch(0.06, 240);
          // staged explosion cascade
          var stages = 7;
          for (var i = 0; i < stages; i++) {
            (function (i) {
              self.time.delayedCall(i * 90, function () {
                var ox = x + (Math.random() - 0.5) * 130, oy = y + (Math.random() - 0.5) * 70;
                self.fx.burst(ox, oy, { color: i % 2 ? self.COL.bossGlow : self.COL.boss, count: 22, speed: 320, scale: 1.1, life: 520 });
                self.fx.burst(ox, oy, { color: "#ffffff", count: 10, speed: 380, scale: 0.6, life: 320, spark: true });
                self.fx.shockwave(ox, oy, { color: self.COL.bossGlow, r0: 8, r1: 150, dur: 480, thickness: 5 });
                self.fx.shake(120, 0.01);
              });
            })(i);
          }
          this.time.delayedCall(stages * 90 + 60, function () {
            self.fx.flash("#ffffff", 260);
            self.fx.shockwave(x, y, { color: self.COL.bossGlow, r0: 10, r1: 320, dur: 700, thickness: 8 });
            self.fx.burst(x, y, { color: "#ffffff", count: 48, speed: 460, scale: 1.2, life: 720, spark: true });
            self.fx.shake(360, 0.016);
          });
          if (this.bossGfx) {
            this.tweens.add({ targets: this.bossGfx, alpha: 0, scaleX: 1.3, scaleY: 1.3, angle: 12, duration: 420, onComplete: function () { if (self.bossGfx) { self.bossGfx.destroy(); self.bossGfx = null; } } });
          }
          this.bossBarBg.setVisible(false); this.bossBarFill.setVisible(false); this.bossBarLabel.setVisible(false);
          FFG.audio.sfx("explode_big", 0.8);
        }

        // ── sync sprites to sim state ──
        _sync() {
          var s = this.sim.state();
          // player
          this.ship.setPosition(s.player.x, s.player.y);
          this.ship.setVisible(s.player.alive);
          // i-frame blink
          if (s.player.invulnT > 0) this.ship.setAlpha(0.4 + 0.4 * Math.sin(this.time.now * 0.04));
          else this.ship.setAlpha(1);
          this.flame.setPosition(s.player.x, s.player.y + 18).setVisible(s.player.alive);
          this.flame.setScale(0.55 + Math.random() * 0.35, 0.8 + Math.random() * 0.5);

          // player bullets — distinct BRIGHT CYAN/GREEN so they never blend with
          // the pink enemy fire (owner note). Green halo + solid green disc core,
          // with only a small white-hot tip (a vertical streak shape via scaleY).
          this._reconcile(this._pbSprites, s.pbullets, function (b) {
            var img = this.add.image(b.x, b.y, "fx_dot").setTint(this.COL.pbullet).setBlendMode(Phaser.BlendModes.ADD).setDepth(35);
            img.setScale(0.6, 0.95);
            img._disc = this.add.circle(b.x, b.y, Math.max(3, b.r * 0.8), this.COL.pbullet, 1).setDepth(36);
            // small white-hot tip keeps player shots crisp; player bullets travel
            // fast & upward so a touch of white reads as a tracer, not confusion.
            img._core = this.add.image(b.x, b.y, "fx_dot").setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(37).setScale(0.18);
            return img;
          }.bind(this), function (img, b) {
            img.setPosition(b.x, b.y); img.setScale(0.6, 0.95);
            if (img._disc) img._disc.setPosition(b.x, b.y);
            if (img._core) img._core.setPosition(b.x, b.y);
          }, function (img) { if (img._disc) img._disc.destroy(); if (img._core) img._core.destroy(); img.destroy(); });

          // enemy bullets — MUST read clearly as PINK against the white stars
          // (owner's #1 note). So: a wide MAGENTA additive halo + a SOLID magenta
          // disc core (not a white core — a white core made them read white and
          // vanish into the starfield). A small hot-pink highlight keeps them
          // punchy without washing out to white.
          this._reconcile(this._ebSprites, s.ebullets, function (b) {
            var img = this.add.image(b.x, b.y, "fx_dot").setTint(this.COL.ebullet).setBlendMode(Phaser.BlendModes.ADD).setDepth(33);
            img.setScale(0.85);                       // bigger magenta glow halo
            // solid opaque magenta disc so the bullet body itself is unmistakably pink
            img._disc = this.add.circle(b.x, b.y, Math.max(4, b.r), this.COL.ebullet, 1).setDepth(34);
            // small hot highlight (light pink, NOT white) for a bright center
            img._core = this.add.image(b.x, b.y, "fx_dot").setTint(shade(this.COL.ebullet, 0.55)).setBlendMode(Phaser.BlendModes.ADD).setDepth(35).setScale(0.28);
            return img;
          }.bind(this), function (img, b) {
            img.setPosition(b.x, b.y);
            if (img._disc) img._disc.setPosition(b.x, b.y);
            if (img._core) img._core.setPosition(b.x, b.y);
          }, function (img) { if (img._disc) img._disc.destroy(); if (img._core) img._core.destroy(); img.destroy(); });

          // pickups
          this._reconcile(this._pkSprites, s.pickups, function (pk) {
            var col = pk.kind === "power" ? this.COL.powerPickup : this.COL.spreadPickup;
            var c = this.add.container(pk.x, pk.y).setDepth(37);
            var halo = this.add.image(0, 0, "fx_dot").setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(1.1).setAlpha(0.8);
            var core = this.add.circle(0, 0, 8, col, 1).setStrokeStyle(2, 0xffffff, 0.9);
            var letter = FFG.text(this, 0, -1, pk.kind === "power" ? "P" : "S", { size: 11, color: "#000000", origin: 0.5 });
            c.add([halo, core, letter]);
            this.tweens.add({ targets: halo, scale: 1.5, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
            return c;
          }.bind(this), function (c, pk) { c.setPosition(pk.x, pk.y); c.setRotation(Math.sin(this.time.now * 0.005) * 0.2); }.bind(this),
            function (c) { c.destroy(); });

          // enemies (keyed by id)
          var seen = {};
          for (var i = 0; i < s.enemies.length; i++) {
            var en = s.enemies[i];
            seen[en.id] = true;
            var spr = this._enemyMap[en.id];
            if (!spr) {
              var color = this._enemyColor(en.kind);
              var key = this._makeEnemyTexture(en.kind, color);
              spr = this.add.image(en.x, en.y, key).setDepth(38);
              // cheap additive halo behind the enemy reads as a glow WITHOUT a
              // per-object postFX shader pass (those are costly on weak GPUs and
              // tank the framerate under software rendering).
              var big = (en.kind === "tank" || en.kind === "reaver" || en.kind === "saucer");
              spr._halo = this.add.image(en.x, en.y, "fx_dot").setTint(color)
                .setBlendMode(Phaser.BlendModes.ADD).setDepth(37).setScale(big ? 1.4 : 1.0).setAlpha(0.45);
              spr.setScale(0);
              this.tweens.add({ targets: spr, scale: 1, duration: 220, ease: "Back.easeOut" });
              this._enemyMap[en.id] = spr;
            }
            spr.setPosition(en.x, en.y);
            if (spr._halo) spr._halo.setPosition(en.x, en.y);
            // damage tint flicker when hurt
            if (en.hp < en.maxHp) spr.setAlpha(0.85 + 0.15 * Math.sin(this.time.now * 0.02));
          }
          for (var id in this._enemyMap) {
            if (!seen[id]) { var es = this._enemyMap[id]; if (es._halo) es._halo.destroy(); es.destroy(); delete this._enemyMap[id]; }
          }

          // boss
          if (s.boss) {
            if (!this.bossGfx) this._buildBossGfx();
            this.bossGfx.setPosition(s.boss.x, s.boss.y);
            if (s.boss.hitFlash > 0 && this._bossBody) this._bossBody.setTintFill(0xffffff);
            else if (this._bossBody) this._bossBody.clearTint();
            // boss bar
            this.bossBarBg.setVisible(true); this.bossBarFill.setVisible(true); this.bossBarLabel.setVisible(true);
            var frac = Math.max(0, s.boss.hp / s.boss.maxHp);
            var fullW = this.W - 124;
            this.bossBarFill.width = fullW * frac;
            var barCol = frac > 0.5 ? hexNum(this.pal.danger) : frac > 0.25 ? hexNum(this.pal.warn) : 0xff2222;
            this.bossBarFill.setFillStyle(barCol, 1);
            this.bossBarLabel.setText((s.boss.name || "DREADNOUGHT") + "  P" + s.boss.phase + "/" + (s.boss.maxPhase || 3));
          }
        }

        // generic pool reconcile by index (bullets share no stable id; index works
        // because the sim arrays are compacted with splice and we rebuild visuals)
        _reconcile(sprites, models, create, update, destroy) {
          // grow
          while (sprites.length < models.length) sprites.push(create(models[sprites.length]));
          // shrink
          while (sprites.length > models.length) { destroy(sprites.pop()); }
          for (var i = 0; i < models.length; i++) update(sprites[i], models[i]);
        }

        update(time, delta) {
          // Phaser SMOOTHS/clamps `delta` toward the target frame time, so on a
          // slow GPU it reports ~16.7ms even when the real frame took 120ms —
          // which would make gameplay crawl in slow-motion. Use the REAL wall
          // clock instead so the sim always advances at true real-time.
          var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : (this.time.now || time);
          if (this._lastNow == null) this._lastNow = now;
          var frameDt = Math.min(0.1, (now - this._lastNow) / 1000);  // clamp huge spikes
          this._lastNow = now;

          // starfield always rushes; faster once started + boss fight
          var boost = this.started ? (this.sim.state().boss ? 1.7 : 1.25) : 1.0;
          this.starfield.update(frameDt, boost);

          if (!this.started || this.over) { return; }

          // FIXED-TIMESTEP accumulator: step the sim in fixed 1/60 increments so
          // gameplay runs at real speed regardless of render fps (no slow-mo on
          // weak GPUs / lag), while a per-frame step cap prevents a death spiral.
          var STEP = 1 / 60, MAX_STEPS = 12;
          this._acc += frameDt;
          var input = this._gatherInput();
          var steps = 0, allEvents = null;
          while (this._acc >= STEP && steps < MAX_STEPS) {
            var ev = this.sim.step(STEP, input);
            if (ev.length) { allEvents = allEvents || []; for (var ii = 0; ii < ev.length; ii++) allEvents.push(ev[ii]); }
            this._acc -= STEP; steps++;
            if (this.sim.state().status !== "playing") break;
          }
          if (this._acc > STEP * MAX_STEPS) this._acc = 0; // shed backlog if we fell far behind
          this._sync();
          if (allEvents && allEvents.length) this._spawnJuiceForEvents(allEvents);
          this._updateHUD();
        }

        // ── test hooks ──
        _wireTestHooks() {
          var self = this;
          root.__test = root.__test || {};
          root.__test.start = function () { self._begin(); return true; };
          root.__test.autoResolve = function (maxSeconds) {
            // Run the PURE sim through the FULL six-world campaign with no
            // rendering / no real input. Returns {ended, victory, world, score,
            // totalWorlds, ...}. The default budget scales with world count so a
            // clean 6-world bot run completes; it always terminates (capped).
            var fresh = new (FFG.sim.Shmup)(content);
            var r = fresh.autoResolve(maxSeconds);   // undefined => sim picks 110s/world
            // surface the headline fields the feel-gate asserts on
            return {
              ended: r.ended, victory: r.victory, world: r.world,
              totalWorlds: r.totalWorlds, score: r.score, status: r.status,
              bestCombo: r.bestCombo, seconds: r.seconds, timedOut: r.timedOut,
            };
          };
          root.__test.state = function () { return self.sim.state(); };
          root.__test.scene = self;
          self.__test = root.__test; // the standard feel-gate finds __test ON THE SCENE (window.__FFG_GAME__.scene.scenes.find(sc=>sc.__test))
          // TEST-ONLY: advance the LIVE rendered sim by `seconds` of fixed steps
          // and re-sync sprites, so a slow headless (software-GL) renderer can be
          // fast-forwarded to a frame with real on-screen combat for screenshots.
          // Drives the same deterministic dodge-bot as autoResolve for input.
          // Does nothing to normal gameplay (only callable from the test page).
          root.__test.fastForward = function (seconds) {
            if (!self.started) self._begin();
            var STEP = 1 / 60, total = Math.floor((seconds || 2) / STEP);
            var allEvents = [];
            for (var i = 0; i < total && self.sim.status === "playing"; i++) {
              var inp = self.sim._botInput ? self.sim._botInput() : { fire: true };
              var ev = self.sim.step(STEP, inp);
              for (var j = 0; j < ev.length; j++) allEvents.push(ev[j]);
            }
            self._sync();
            // only fire a trimmed set of juice so we don't spawn thousands of tweens
            self._spawnJuiceForEvents(allEvents.slice(-12));
            self._updateHUD();
            return self.sim.state();
          };
        }
      };
    });
  }

  // register now (kernel is loaded before us) and also expose a manual hook
  if (root.Phaser) registerShmup();
  else { var iv = setInterval(function () { if (root.Phaser) { clearInterval(iv); registerShmup(); } }, 30); }
  FFG._registerShmup = registerShmup;

})(typeof window !== "undefined" ? window : globalThis);
