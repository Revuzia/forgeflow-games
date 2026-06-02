/**
 * FFG runtime — ffg_platformer.js
 * Render + input + FEEL layer for "Lumen Run", a side-scrolling precision
 * platformer. Binds the tuning + level shape from FFG.sim.Platformer (pure logic)
 * to Phaser arcade physics, and layers the FFG.fx juice engine on top: glowing
 * hero + orbs, squash-stretch jump/land, dust bursts, coin pickup pop + float +
 * sparkle, parallax depth, bloom, screen shake + hitstop on damage. Registers
 * itself as the "platformer" genre. NOT regenerated per game — games supply only
 * a content.json (theme + level).
 *
 * Headless hooks (feel gate / play-bot): window.__test AND scene.__test expose
 *   start()        — dismiss the menu / begin gameplay
 *   autoResolve()  — auto-pilot the hero to the goal (or death) with NO real
 *                    input; returns { ended, victory, ... } for the feel gate.
 *   state()        — read live progress + end state.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};

  FFG.register("platformer", function (content) {
    var Phaser = root.Phaser;
    var Sim = (FFG.sim && FFG.sim.Platformer) || (root.FFG && root.FFG.sim && root.FFG.sim.Platformer);

    // ── resolve theme/palette + level (content overrides defaults) ──────────────
    var pal = FFG.palette(content.palette || "ember");
    var view = content.view || {};
    var VW = view.width || 960, VH = view.height || 540;

    // depth bands so layering reads correctly
    var D = { sky: -100, far: -60, mid: -45, near: -30, vign: -8, world: 0, hazard: 6, coin: 8, enemy: 10, hero: 20, fx: 60, ui: 1000, overlay: 1200 };

    function col(c, fb) { return c == null ? fb : (typeof c === "string" ? FFG.color(c) : c); }

    return class PlatformerScene extends Phaser.Scene {
      constructor() { super({ key: "FFGPlatformer" }); }

      preload() {
        var self = this;
        var a = content.assets || {};
        (a.images || []).forEach(function (im) { try { self.load.image(im.key, im.url); } catch (e) {} });
        (a.audio || []).forEach(function (au) { try { self.load.audio(au.key, au.url); } catch (e) {} });
      }

      create() {
        var self = this;
        FFG.audio.bind(this);
        FFG.fx.bind(this);

        // pure-logic tuning + level (single source of truth for shape + feel)
        this.tuning = Sim.makeTuning(content);
        this.level = Sim.makeLevel(content);
        var L = this.level, T = this.tuning;

        this.started = false;
        this.ended = false;
        this.victory = false;
        this.coins = 0;
        this.health = T.maxHealth;
        this.invulnUntil = 0;
        root.__FFG_RESULT__ = null;

        this._buildTextures();
        this._buildBackground();
        this._buildWorld();
        this._buildHero();
        this._buildCamera();
        this._buildInput();
        this._buildHUD();

        // scene-wide bloom makes every glow read as light, not paint
        FFG.fx.bloom(1.05);
        FFG.fx.vignette(this, 0.42);

        this._buildMenu();
        this._exposeTest();

        // music (graceful no-op without assets)
        try { FFG.audio.music("music", 0.4); } catch (e) {}
      }

      // ── procedural textures (no external art required) ─────────────────────────
      _buildTextures() {
        var pal2 = pal, self = this;
        function tex(key, w, h, draw) {
          if (self.textures.exists(key)) return;
          var g = self.make.graphics({ x: 0, y: 0, add: false });
          draw(g); g.generateTexture(key, w, h); g.destroy();
        }
        // HERO — luminous rounded capsule with a bright core + visor highlight
        tex("hero", 30, 38, function (g) {
          g.fillStyle(FFG.shade(pal2.primary, -0.35), 1); g.fillRoundedRect(2, 2, 26, 34, 9);
          g.fillStyle(pal2.primary, 1); g.fillRoundedRect(4, 4, 22, 30, 8);
          g.fillStyle(FFG.shade(pal2.primary, 0.55), 1); g.fillRoundedRect(7, 6, 16, 12, 6); // bright top
          g.fillStyle(pal2.ink, 0.95); g.fillRoundedRect(9, 12, 12, 6, 3);                    // visor
          g.fillStyle(FFG.shade(pal2.accent, 0.2), 1); g.fillRoundedRect(11, 26, 8, 6, 3);    // core glow
        });
        // COIN / ORB — radiant disc with a shine
        tex("coin", 24, 24, function (g) {
          g.fillStyle(FFG.shade(pal2.warn, -0.2), 1); g.fillCircle(12, 12, 11);
          g.fillStyle(pal2.warn, 1); g.fillCircle(12, 12, 9);
          g.fillStyle(FFG.shade(pal2.warn, 0.6), 1); g.fillCircle(12, 12, 5);
          g.fillStyle(0xffffff, 0.9); g.fillCircle(9, 9, 2.2);
        });
        // SPIKE strip tile — three sharp teeth
        tex("spike", 24, 24, function (g) {
          var dn = FFG.shade(pal2.danger, -0.25), up = FFG.shade(pal2.danger, 0.3);
          for (var i = 0; i < 3; i++) {
            var x = i * 8;
            g.fillStyle(dn, 1); g.fillTriangle(x, 24, x + 4, 4, x + 8, 24);
            g.fillStyle(up, 1); g.fillTriangle(x + 2, 24, x + 4, 9, x + 6, 24);
          }
        });
        // ENEMY — squat menace with two glowing eyes
        tex("enemy", 30, 30, function (g) {
          g.fillStyle(FFG.shade(pal2.danger, -0.4), 1); g.fillRoundedRect(1, 4, 28, 25, 8);
          g.fillStyle(pal2.danger, 1); g.fillRoundedRect(3, 6, 24, 21, 7);
          g.fillStyle(FFG.shade(pal2.danger, -0.55), 1); // spikes on top
          g.fillTriangle(6, 6, 10, -2, 14, 6); g.fillTriangle(16, 6, 20, -2, 24, 6);
          g.fillStyle(pal2.warn, 1); g.fillCircle(11, 16, 3.2); g.fillCircle(20, 16, 3.2);
          g.fillStyle(0x000000, 1); g.fillCircle(11, 16, 1.4); g.fillCircle(20, 16, 1.4);
        });
        // small soft particle reused if kernel's isn't present
        tex("__pdot", 8, 8, function (g) { g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 3.4); });
      }

      // ── parallax background ───────────────────────────────────────────────────
      _buildBackground() {
        var self = this;
        // base vertical gradient (sky)
        FFG.fx.gradient(this, col(view.background, pal.bg), pal.bg2);

        // distant glowing shapes on parallax layers (drawn into RTs as tileable
        // bands; we just place groups of circles with scrollFactor for depth).
        function layer(depth, scrollF, n, rMin, rMax, tint, alpha) {
          var worldW = self.level.width;
          for (var i = 0; i < n; i++) {
            var x = (i / n) * (worldW * scrollF + VW) + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 80;
            var y = 40 + (Math.sin(i * 78.233) * 0.5 + 0.5) * (VH * 0.6);
            var r = rMin + (Math.sin(i * 43.17) * 0.5 + 0.5) * (rMax - rMin);
            var c = self.add.circle(x % (worldW * scrollF + VW), y, r, tint, alpha).setScrollFactor(scrollF).setDepth(depth);
            FFG.fx.glow(c, tint, 3);
          }
        }
        // far hazy glow orbs (mountainscape feel), then mid, then near drifting motes
        layer(D.far, 0.12, 10, 38, 90, FFG.shade(pal.primary, -0.2), 0.10);
        layer(D.mid, 0.30, 14, 14, 46, FFG.shade(pal.accent, -0.1), 0.10);
        // a closer band of small bright embers for parallax depth nearer the play plane
        layer(D.near, 0.55, 20, 4, 11, FFG.shade(pal.warn, 0.1), 0.16);

        // distant silhouette ridge line for grounded depth
        var ridge = this.add.graphics().setScrollFactor(0.18).setDepth(D.far + 1);
        ridge.fillStyle(FFG.shade(pal.bg2, 0.12), 1);
        var baseY = VH * 0.82, step = 90, peaks = Math.ceil((this.level.width * 0.18 + VW) / step) + 2;
        ridge.beginPath(); ridge.moveTo(0, VH);
        for (var k = 0; k <= peaks; k++) {
          var px = k * step, py = baseY - (Math.sin(k * 1.7) * 0.5 + 0.5) * 70;
          ridge.lineTo(px, py);
        }
        ridge.lineTo(peaks * step, VH); ridge.closePath(); ridge.fillPath();

        // slow drifting star/dust motes high up (uses kernel starfield, parallaxed)
        FFG.fx.starfield(this, { count: 60, color: FFG.shade(pal.ink, -0.1), speed: 18, depth: D.near });
      }

      // ── world: platforms, coins, hazards, enemies, goal ────────────────────────
      _buildWorld() {
        var self = this, L = this.level;

        // static platform bodies (arcade)
        this.platforms = this.physics.add.staticGroup();
        L.platforms.forEach(function (p) {
          // visual body with shaded fill + bright top lip
          var isGround = p.kind === "ground";
          var body = FFG.shade(isGround ? pal.bg2 : pal.bg2, isGround ? 0.16 : 0.26);
          var lip = FFG.shade(pal.primary, isGround ? -0.05 : 0.15);
          var g = self.add.graphics().setDepth(D.world);
          g.fillStyle(FFG.shade(pal.bg, 0.05), 1); g.fillRect(p.x, p.y + 3, p.w, p.h);      // shadow base
          g.fillStyle(body, 1); g.fillRect(p.x, p.y + 3, p.w, p.h - 3);                       // body
          g.fillStyle(lip, 1); g.fillRect(p.x, p.y, p.w, 4);                                  // glowing top lip
          g.fillStyle(FFG.shade(lip, 0.4), 0.9); g.fillRect(p.x, p.y, p.w, 1.5);              // highlight
          // an invisible static rectangle is the actual collider
          var s = self.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, 0x000000, 0);
          self.physics.add.existing(s, true);
          self.platforms.add(s);
        });

        // HAZARDS (spikes) — tiled spike strip + a dim danger glow underline
        this.hazards = this.physics.add.staticGroup();
        L.hazards.forEach(function (z) {
          var ts = self.add.tileSprite(z.x, z.y, z.w, z.h, "spike").setOrigin(0, 0).setDepth(D.hazard);
          FFG.fx.glow(ts, pal.danger, 2);
          var s = self.add.rectangle(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h * 0.7, 0x000000, 0);
          self.physics.add.existing(s, true);
          s._hazard = true; self.hazards.add(s);
        });

        // COINS — glowing orbs that bob + spin; collected on overlap
        this.coinGroup = this.physics.add.group({ allowGravity: false, immovable: true });
        L.coins.forEach(function (c, i) {
          var sp = self.coinGroup.create(c.x, c.y, "coin").setDepth(D.coin);
          sp.value = c.value || 5;
          sp.body.setCircle(11, 1, 1);
          FFG.fx.glow(sp, pal.warn, 4);
          // idle bob + slow spin for life
          self.tweens.add({ targets: sp, y: c.y - 6, duration: 900 + (i % 5) * 90, yoyo: true, repeat: -1, ease: "Sine.inOut" });
          self.tweens.add({ targets: sp, scaleX: 0.7, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        });

        // ENEMIES — patrol between range bounds; physics bodies for stomp/contact
        this.enemyGroup = this.physics.add.group({ allowGravity: false, immovable: true });
        L.enemies.forEach(function (en) {
          var sp = self.enemyGroup.create(en.x + en.w / 2, en.y + en.h / 2, "enemy").setDepth(D.enemy);
          sp.body.setSize(en.w, en.h, true);
          sp.home = en.x; sp.range = en.range; sp.spd = en.speed; sp.dir = en.dir; sp.alive = true;
          FFG.fx.glow(sp, pal.danger, 3);
          // menace wobble
          self.tweens.add({ targets: sp, scaleY: 0.9, duration: 420, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        });

        // GOAL — a luminous flag/portal pillar with a sky-beacon light shaft so it
        // reads as the destination from across the level.
        var g = L.goal;
        // a tall, soft light shaft rising from the goal (additive, behind the pillar)
        var shaft = this.add.triangle(g.x + g.w / 2, g.y - g.h * 0.5,
          -g.w * 0.9, g.h * 1.4, g.w * 0.9, g.h * 1.4, 0, -g.h * 2.2,
          pal.good, 0.16).setDepth(D.coin - 1).setBlendMode("ADD");
        this.tweens.add({ targets: shaft, alpha: 0.30, scaleX: 1.12, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.inOut" });

        this.goal = this.add.container(g.x + g.w / 2, g.y + g.h / 2).setDepth(D.coin);
        var pillar = this.add.rectangle(0, 0, g.w, g.h, FFG.shade(pal.good, -0.1), 0.9);
        var inner = this.add.rectangle(0, 0, g.w * 0.5, g.h * 0.86, FFG.shade(pal.good, 0.4), 0.95);
        var topOrb = this.add.circle(0, -g.h / 2, g.w * 0.8, pal.good, 1);
        this.goal.add([pillar, inner, topOrb]);
        FFG.fx.glow(pillar, pal.good, 6); FFG.fx.glow(topOrb, pal.good, 8);
        this.tweens.add({ targets: this.goal, scaleX: 1.05, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        this.tweens.add({ targets: topOrb, y: -g.h / 2 - 6, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.inOut" });

        // beacon: rings that periodically rise from the goal orb (a clear "here!")
        this.time.addEvent({
          delay: 1400, loop: true, callback: function () {
            if (!self.scene || !self.scene.isActive()) return;
            FFG.fx.shockwave(g.x + g.w / 2, g.y - g.h / 2, { color: pal.good, r0: 6, r1: 60, dur: 1100, thickness: 2 });
          },
        });

        // goal sensor
        this.goalZone = this.add.rectangle(g.x + g.w / 2, g.y + g.h / 2, g.w, g.h, 0x000000, 0);
        this.physics.add.existing(this.goalZone, true);
      }

      // ── hero ───────────────────────────────────────────────────────────────────
      _buildHero() {
        var L = this.level, T = this.tuning;
        var hx = L.spawn.x, hy = L.spawn.y - 40;
        this.hero = this.physics.add.sprite(hx, hy, "hero").setDepth(D.hero);
        this.hero.setOrigin(0.5, 0.5);
        this.hero.body.setSize(24, 34, true);
        this.hero.setCollideWorldBounds(false);
        this.hero.setMaxVelocity(T.maxRun, T.maxFall);
        // arcade gravity for the hero specifically (world gravity stays 0)
        this.hero.body.setGravityY(T.gravity);
        FFG.fx.glow(this.hero, pal.primary, 6);

        // a soft ground-shadow ellipse that tracks the hero
        this.heroShadow = this.add.ellipse(hx, hy, 26, 8, 0x000000, 0.28).setDepth(D.hero - 1);

        // control state (coyote / buffer / variable jump / double jump)
        this.coyote = 0; this.jumpBuffer = 0; this.wasOnGround = false; this.jumpHeldPrev = false; this._wasRising = false;
        this.jumpsUsed = 0;          // jumps since last leaving ground (0..maxJumps); reset on land
        this._trailLast = 0;         // throttle for the fast-movement afterglow trail

        // colliders
        this.physics.add.collider(this.hero, this.platforms, this._onPlatformTouch, null, this);
        this.physics.add.overlap(this.hero, this.coinGroup, this._collectCoin, null, this);
        this.physics.add.overlap(this.hero, this.enemyGroup, this._touchEnemy, null, this);
        this.physics.add.overlap(this.hero, this.hazards, this._touchHazard, null, this);
        this.physics.add.overlap(this.hero, this.goalZone, this._reachGoal, null, this);
      }

      _buildCamera() {
        var cam = this.cameras.main;
        cam.setBounds(0, 0, this.level.width, Math.max(VH, this.level.height + 240));
        cam.startFollow(this.hero, true, 0.12, 0.12);
        cam.setDeadzone(180, 120);
        cam.setBackgroundColor(col(view.background, pal.bg));
      }

      _buildInput() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys({
          left: Phaser.Input.Keyboard.KeyCodes.A,
          right: Phaser.Input.Keyboard.KeyCodes.D,
          up: Phaser.Input.Keyboard.KeyCodes.W,
          jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
          restart: Phaser.Input.Keyboard.KeyCodes.R,
        });
        // pointer / tap also starts + restarts
        this.input.on("pointerdown", function () {
          if (!this.started) this.start();
          else if (this.ended) this._restart();
        }, this);
        this.keys.restart.on("down", function () { if (this.ended) this._restart(); }, this);
      }

      _buildHUD() {
        var self = this;
        var hud = this.add.container(0, 0).setScrollFactor(0).setDepth(D.ui);
        this.hud = hud;

        // ── subtle backing panels so the HUD reads over the bright parallax ──
        function panel(x, y, w, h) {
          var g = self.add.graphics().setScrollFactor(0);
          g.fillStyle(FFG.shade(pal.bg, 0.02), 0.42); g.fillRoundedRect(x, y, w, h, 9);
          g.lineStyle(1.5, FFG.shade(pal.primary, 0.1), 0.30); g.strokeRoundedRect(x, y, w, h, 9);
          return g;
        }
        // left panel: coins.  right panel: hearts + double-jump pip.
        var coinPanelW = 116;
        hud.add(panel(10, 10, coinPanelW, 34));

        // coin icon + "got / total"
        this.coinIcon = this.add.image(30, 27, "coin").setScrollFactor(0).setScale(0.92);
        FFG.fx.glow(this.coinIcon, pal.warn, 3);
        this.coinText = FFG.text(this, 48, 16, "0 / " + this.level.coins.length, { size: 20, color: "#fff0e0", stroke: "#1a0d06", strokeThickness: 4 }).setScrollFactor(0);
        hud.add([this.coinIcon, this.coinText]);

        // right panel sizing: hearts + a divider + the double-jump pip + label
        var nHearts = this.tuning.maxHealth;
        var heartsW = nHearts * 24;
        var rPanelW = heartsW + 86;
        var rx = VW - rPanelW - 10;
        hud.add(panel(rx, 10, rPanelW, 34));

        // HEARTS — drawn as little glowing hearts (two lobes + a point), brighter
        // than flat pips so health reads instantly.
        this.healthPips = [];
        for (var i = 0; i < nHearts; i++) {
          var hxp = rx + 18 + i * 24;
          var heart = this._makeHeart(hxp, 27, pal.danger);
          heart.setScrollFactor(0);
          FFG.fx.glow(heart, pal.danger, 4);
          hud.add(heart);
          this.healthPips.push(heart);
        }

        // divider between hearts and the double-jump indicator
        var divX = rx + heartsW + 16;
        var div = this.add.rectangle(divX, 27, 1.5, 18, FFG.shade(pal.primary, 0.1), 0.4).setScrollFactor(0);
        hud.add(div);

        // DOUBLE-JUMP READY pip — a bright ring+dot that DIMS after the 2nd jump and
        // re-lights on landing (driven each frame in _updateHUD).
        var djX = divX + 18;
        this.djRing = this.add.circle(djX, 27, 8).setStrokeStyle(2, pal.accent, 1).setScrollFactor(0);
        this.djPip = this.add.circle(djX, 27, 4, pal.accent, 1).setScrollFactor(0);
        FFG.fx.glow(this.djPip, pal.accent, 4);
        var djLabel = FFG.text(this, djX + 12, 19, "2×", { size: 14, color: "#ffe6b8", stroke: "#1a0d06", strokeThickness: 3 }).setScrollFactor(0);
        hud.add([this.djRing, this.djPip, djLabel]);

        // level name — centered, tasteful, with its own slim backing chip
        var name = content.title || "Lumen Run";
        var nameW = Math.max(120, name.length * 9 + 28);
        hud.add(panel(VW / 2 - nameW / 2, 10, nameW, 26));
        this.titleText = FFG.text(this, VW / 2, 14, name, { size: 15, color: "#ffe2c2", origin: 0.5, stroke: "#1a0d06", strokeThickness: 3 }).setScrollFactor(0);
        hud.add(this.titleText);
      }

      // a small heart shape as a single Graphics object (so it can glow + tween).
      // Drawn around the LOCAL origin (0,0) and positioned via setPosition so that
      // scale/alpha tweens (the hurt-pop) scale in place, not toward the corner.
      _makeHeart(cx, cy, color) {
        var g = this.add.graphics().setDepth(D.ui);
        g.fillStyle(color, 1);
        g.fillCircle(-3.4, -2, 4.2);                          // left lobe
        g.fillCircle(3.4, -2, 4.2);                           // right lobe
        g.fillTriangle(-7.2, -0.2, 7.2, -0.2, 0, 7.4);        // bottom point
        g.fillStyle(FFG.shade(color, 0.5), 0.85);
        g.fillCircle(-3.4, -3, 1.6);                          // shine
        g.setPosition(cx, cy);
        return g;
      }

      // per-frame HUD upkeep: keep the double-jump-ready pip in sync with state.
      _updateHUD() {
        if (!this.djPip) return;
        var ready = (this.jumpsUsed || 0) < ((this.tuning.maxJumps || 2)) && (this.jumpsUsed || 0) < 2;
        // "ready" = a mid-air jump still available (covers grounded too)
        var avail = (this.jumpsUsed || 0) < (this.tuning.maxJumps || 2);
        var tgtA = avail ? 1 : 0.18, tgtS = avail ? 1 : 0.7;
        this.djPip.alpha = Phaser.Math.Linear(this.djPip.alpha, tgtA, 0.2);
        this.djPip.scale = Phaser.Math.Linear(this.djPip.scale, tgtS, 0.2);
        if (this.djRing) this.djRing.alpha = Phaser.Math.Linear(this.djRing.alpha, avail ? 1 : 0.35, 0.2);
      }

      _buildMenu() {
        var self = this;
        this.menu = this.add.container(0, 0).setScrollFactor(0).setDepth(D.overlay);
        var dim = this.add.rectangle(VW / 2, VH / 2, VW, VH, 0x000000, 0.55);
        var t1 = FFG.text(this, VW / 2, VH / 2 - 40, (content.title || "Lumen Run"), { size: 44, color: "#fff0e0", stroke: "#000", strokeThickness: 6, origin: 0.5 });
        FFG.fx.glow(t1, pal.primary, 6);
        var t2 = FFG.text(this, VW / 2, VH / 2 + 18, "Arrows / A·D to run  ·  Space / W to jump", { size: 16, color: "#ffd9b0", origin: 0.5 });
        var t2b = FFG.text(this, VW / 2, VH / 2 + 42, "Press jump again in mid-air for a DOUBLE JUMP", { size: 14, color: "#ffe6b8", origin: 0.5 });
        var t3 = FFG.text(this, VW / 2, VH / 2 + 70, "Reach the glowing goal. Grab the orbs.", { size: 14, color: "#ffb98a", origin: 0.5 });
        var t4 = FFG.text(this, VW / 2, VH / 2 + 108, "▶  CLICK / SPACE TO PLAY", { size: 18, color: "#fff", origin: 0.5, stroke: "#000", strokeThickness: 4 });
        this.menu.add([dim, t1, t2, t2b, t3, t4]);
        this.tweens.add({ targets: t4, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
        // space starts too
        this.input.keyboard.on("keydown-SPACE", function () { if (!self.started) self.start(); });
        this.input.keyboard.on("keydown-UP", function () { if (!self.started) self.start(); });
      }

      start() {
        if (this.started) return true;
        this.started = true;
        if (this.menu) { this.tweens.add({ targets: this.menu, alpha: 0, duration: 220, onComplete: () => { try { this.menu.destroy(); } catch (e) {} } }); this.menu = null; }
        FFG.fx.flash(FFG.shade(pal.primary, 0.2), 120);
        FFG.fx.pop(this.hero, 1.2, 240);
        return true;
      }

      // ── collisions / interactions ──────────────────────────────────────────────
      _onPlatformTouch(hero, plat) {
        // landing detection handled in update via body.blocked.down transition
      }

      _collectCoin(hero, coin) {
        if (!coin.active) return;
        this.coins += 1;
        this.coinText.setText(this.coins + " / " + this.level.coins.length);
        FFG.fx.float(coin.x, coin.y - 6, "+" + coin.value, { colorStr: "#ffe6a0", size: 18 });
        FFG.fx.burst(coin.x, coin.y, { color: pal.warn, count: 12, speed: 180, scale: 0.6, life: 420, spark: true, gravityY: 60 });
        FFG.fx.shockwave(coin.x, coin.y, { color: pal.warn, r1: 30, dur: 320, thickness: 2 });
        FFG.fx.pop(this.coinIcon, 1.4, 220);
        FFG.audio.sfx("coin", 0.5);
        coin.disableBody(true, true);
      }

      _touchEnemy(hero, enemy) {
        if (!enemy.alive || this.ended) return;
        var feet = hero.body.bottom, vy = hero.body.velocity.y;
        if (vy > 40 && feet < enemy.body.center.y + 6) {
          // STOMP — squish enemy, bounce hero, juice
          enemy.alive = false;
          FFG.fx.burst(enemy.x, enemy.y, { color: pal.danger, count: 16, speed: 220, scale: 0.7, life: 460, gravityY: 120 });
          FFG.fx.shockwave(enemy.x, enemy.y, { color: pal.danger, r1: 34 });
          FFG.fx.pop(this.hero, 1.25, 200);
          FFG.fx.zoomPunch(0.03, 90);
          this.tweens.add({ targets: enemy, scaleY: 0.1, scaleX: 1.3, alpha: 0, duration: 160, onComplete: () => { try { enemy.disableBody(true, true); } catch (e) {} } });
          this.hero.setVelocityY(-this.tuning.bounceVel);
          FFG.audio.sfx("stomp", 0.5);
        } else {
          this._hurt(enemy.body.center.x);
        }
      }

      _touchHazard(hero, hz) {
        if (this.ended) return;
        this._hurt(hero.x, true);
      }

      _hurt(fromX, big) {
        if (this.ended || this.time.now < this.invulnUntil) return;
        var T = this.tuning;
        this.health -= 1;
        this.invulnUntil = this.time.now + T.invulnMs;
        // pop a health pip
        var pip = this.healthPips[this.health];
        if (pip) this.tweens.add({ targets: pip, scale: 0, alpha: 0.2, duration: 200, ease: "Back.in" });
        // knockback away + a little up
        var dir = this.hero.x < fromX ? -1 : 1;
        this.hero.setVelocity(dir * T.knockback, -Math.min(T.jumpVel * 0.5, 360));
        // JUICE: red flash + shake + hitstop + i-frame blink
        FFG.fx.flash(pal.danger, 140);
        FFG.fx.shake(220, big ? 0.012 : 0.008);
        FFG.fx.hitstop(big ? 70 : 45);
        FFG.fx.burst(this.hero.x, this.hero.y, { color: pal.danger, count: 14, speed: 200, scale: 0.6, life: 420, gravityY: 120 });
        this._blinkHero(T.invulnMs);
        FFG.audio.sfx("hurt", 0.5);
        if (this.health <= 0) this._lose("killed");
      }

      _blinkHero(ms) {
        var self = this;
        if (this._blinkEv) this._blinkEv.remove();
        this.hero.setAlpha(0.5);
        this._blinkEv = this.time.addEvent({
          delay: 90, repeat: Math.floor(ms / 90),
          callback: function () { self.hero.setAlpha(self.hero.alpha < 1 ? 1 : 0.45); },
          onComplete: function () { self.hero.setAlpha(1); },
        });
        // hard restore
        this.time.delayedCall(ms, function () { try { self.hero.setAlpha(1); } catch (e) {} });
      }

      _reachGoal() {
        if (this.ended || !this.started) return;
        this._win();
      }

      _win() {
        if (this.ended) return;
        this.ended = true; this.victory = true;
        root.__FFG_RESULT__ = { victory: true, ended: true, coins: this.coins, total: this.level.coins.length };
        FFG.fx.flash(pal.good, 200);
        FFG.fx.zoomPunch(0.06, 220);
        FFG.fx.shockwave(this.hero.x, this.hero.y, { color: pal.good, r1: 120, dur: 600, thickness: 4 });
        FFG.fx.burst(this.hero.x, this.hero.y, { color: pal.good, count: 30, speed: 260, scale: 0.8, life: 700, gravityY: -40 });
        FFG.audio.sfx("win", 0.6);
        this._overlay(true);
      }

      _lose(reason) {
        if (this.ended) return;
        this.ended = true; this.victory = false; this.reason = reason;
        root.__FFG_RESULT__ = { victory: false, ended: true, reason: reason, coins: this.coins };
        FFG.fx.flash(pal.danger, 220);
        FFG.fx.shake(360, 0.016);
        this.tweens.add({ targets: this.hero, alpha: 0.2, angle: 40, duration: 400 });
        FFG.audio.sfx("lose", 0.6);
        this._overlay(false);
      }

      _overlay(win) {
        var self = this;
        var c = this.add.container(0, 0).setScrollFactor(0).setDepth(D.overlay);
        var dim = this.add.rectangle(VW / 2, VH / 2, VW, VH, 0x000000, 0.55);
        var title = win ? "GOAL REACHED!" : (this.reason === "fell" ? "YOU FELL" : "DOWN YOU GO");
        var tc = win ? "#bfffde" : "#ffd0d0";
        var t1 = FFG.text(this, VW / 2, VH / 2 - 36, title, { size: 46, color: tc, stroke: "#000", strokeThickness: 6, origin: 0.5 });
        FFG.fx.glow(t1, win ? pal.good : pal.danger, 6);
        var sub = win ? ("Orbs: " + this.coins + " / " + this.level.coins.length) : "So close.";
        var t2 = FFG.text(this, VW / 2, VH / 2 + 14, sub, { size: 20, color: "#ffe6cf", origin: 0.5 });
        var t3 = FFG.text(this, VW / 2, VH / 2 + 60, "↻  CLICK / R TO RUN AGAIN", { size: 18, color: "#fff", origin: 0.5, stroke: "#000", strokeThickness: 4 });
        c.add([dim, t1, t2, t3]);
        c.setAlpha(0);
        this.tweens.add({ targets: c, alpha: 1, duration: 280 });
        this.tweens.add({ targets: t3, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: t1, scale: 1.06, duration: 600, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      }

      _restart() {
        root.__FFG_RESULT__ = null;
        this.scene.restart();
      }

      // ── per-frame update: tight controls + juice ────────────────────────────────
      update(time, dtMs) {
        if (!this.scene || !this.hero || !this.hero.body) return;
        // keep shadow + enemy patrol + bg alive even before start (feels live)
        this._updateEnemies(dtMs);
        this._updateHeroShadow();
        this._updateHUD();
        this._updateTrail(time);

        if (!this.started || this.ended) { if (!this.started) this.hero.setVelocityX(0); return; }

        var T = this.tuning, h = this.hero, b = h.body;
        var dt = dtMs / 1000;
        var onGround = b.blocked.down || b.touching.down;

        // landing transition: dust + squash + (hard landing) shake
        if (onGround && !this.wasOnGround) this._onLand();
        // refresh coyote on ground; decay otherwise
        if (onGround) this.coyote = T.coyoteMs; else this.coyote = Math.max(0, this.coyote - dtMs);

        // ── horizontal: accel + air control + ground friction ──
        var left = this.cursors.left.isDown || this.keys.left.isDown;
        var right = this.cursors.right.isDown || this.keys.right.isDown;
        var accel = onGround ? T.runAccel : T.airAccel;
        var vx = b.velocity.x;
        if (left && !right) { vx -= accel * dt; h.setFlipX(true); }
        else if (right && !left) { vx += accel * dt; h.setFlipX(false); }
        else if (onGround) {
          var dec = T.runDecel * dt;
          if (vx > 0) vx = Math.max(0, vx - dec); else if (vx < 0) vx = Math.min(0, vx + dec);
        }
        vx = Phaser.Math.Clamp(vx, -T.maxRun, T.maxRun);
        h.setVelocityX(vx);

        // running squash: subtle scale wobble while grounded + moving
        if (onGround && Math.abs(vx) > 40) {
          var s = 1 + Math.sin(time / 60) * 0.04;
          h.setScale(1 + (1 - s) * 0.5, s);
        } else if (onGround) {
          h.setScale(Phaser.Math.Linear(h.scaleX, 1, 0.2), Phaser.Math.Linear(h.scaleY, 1, 0.2));
        }

        // ── jump: buffer + coyote (FIRST) then DOUBLE jump (mid-air) ──
        // jumpsUsed restored to 0 on landing (see _onLand + the onGround branch).
        var maxJumps = T.maxJumps || 2;
        if (onGround) this.jumpsUsed = 0;
        var jumpDown = this.cursors.up.isDown || this.keys.up.isDown || this.keys.jump.isDown;
        var jumpEdge = jumpDown && !this.jumpHeldPrev;
        if (jumpEdge) this.jumpBuffer = T.jumpBufferMs; else this.jumpBuffer = Math.max(0, this.jumpBuffer - dtMs);
        this.jumpHeldPrev = jumpDown;

        if (this.jumpBuffer > 0 && (onGround || this.coyote > 0) && this.jumpsUsed === 0) {
          // FIRST jump (ground / coyote)
          h.setVelocityY(-T.jumpVel);
          this.jumpBuffer = 0; this.coyote = 0; this.jumpsUsed = 1;
          this._onJump();
        } else if (jumpEdge && !onGround && this.jumpsUsed >= 1 && this.jumpsUsed < maxJumps) {
          // DOUBLE jump (deliberate fresh mid-air press; uses the softer impulse)
          h.setVelocityY(-(T.doubleJumpVel || T.jumpVel));
          this.jumpBuffer = 0; this.coyote = 0; this.jumpsUsed += 1;
          this._onDoubleJump();
        }
        // walked off a ledge without jumping: once coyote lapses the ground jump is
        // forfeit, so the next air press is the DOUBLE (mirrors the sim authority).
        if (!onGround && this.jumpsUsed === 0 && this.coyote <= 0) this.jumpsUsed = 1;

        // variable height: release while rising clips upward velocity once
        var rising = b.velocity.y < 0;
        if (!jumpDown && rising && this._wasRising) h.setVelocityY(b.velocity.y * T.jumpCutMul);
        this._wasRising = rising && jumpDown;

        // air tilt for flair
        if (!onGround) h.setRotation(Phaser.Math.Clamp(b.velocity.x / T.maxRun, -1, 1) * 0.12);
        else h.setRotation(Phaser.Math.Linear(h.rotation, 0, 0.25));

        // fall-out death
        if (h.y > this.level.height + 260) this._lose("fell");

        this.wasOnGround = onGround;
      }

      _onJump() {
        FFG.fx.pop(this.hero, 0.72, 180);   // stretch up (scale<1 -> tall via pop's (2-k))
        FFG.fx.burst(this.hero.x, this.hero.body.bottom, { color: FFG.shade(pal.ink, -0.1), count: 8, speed: 120, scale: 0.5, life: 320, angle: { min: 60, max: 120 }, gravityY: -30 });
        FFG.audio.sfx("jump", 0.4);
      }

      // DOUBLE jump — the headline feature. A juicy mid-air pop: a sparkle ring of
      // dust at the launch point, a squash on the hero, a bright ring, and a quick
      // spin flourish so the second jump reads as a deliberate, satisfying "flip".
      _onDoubleJump() {
        var hx = this.hero.x, hy = this.hero.y, by = this.hero.body.bottom;
        FFG.fx.pop(this.hero, 0.7, 220);                                  // stretch tall again
        // dust + sparkle burst radiating from under the hero at the air-hop
        FFG.fx.burst(hx, by, { color: FFG.shade(pal.accent, 0.2), count: 16, speed: 200, scale: 0.6, life: 460, spark: true, gravityY: -20 });
        FFG.fx.burst(hx, by, { color: FFG.shade(pal.ink, -0.1), count: 8, speed: 130, scale: 0.5, life: 360, angle: { min: 50, max: 130 }, gravityY: 40 });
        FFG.fx.shockwave(hx, hy + this.hero.height * 0.2, { color: pal.accent, r0: 6, r1: 46, dur: 360, thickness: 3 });
        // a quick 360 spin in the launch direction for flair (settles in update's tilt)
        var spin = (this.hero.flipX ? -1 : 1) * Phaser.Math.PI2;
        this.tweens.add({ targets: this.hero, rotation: this.hero.rotation + spin, duration: 320, ease: "Cubic.out" });
        // dim the double-jump-ready pip immediately (also enforced in _updateHUD)
        if (this.djPip) this.tweens.add({ targets: this.djPip, alpha: 0.18, scale: 0.7, duration: 140 });
        FFG.audio.sfx("jump", 0.5);
      }

      _onLand() {
        this.jumpsUsed = 0;                                  // restore the double-jump budget
        var hardness = Phaser.Math.Clamp(this.hero.body.velocity.y / this.tuning.maxFall, 0, 1);
        // squash on land
        FFG.fx.pop(this.hero, 1.35, 220);
        // dust burst sideways/up from feet (gravityY up-ish so it lofts then settles)
        FFG.fx.burst(this.hero.x, this.hero.body.bottom, {
          color: FFG.shade(pal.ink, -0.15), count: 10 + Math.round(hardness * 8),
          speed: 120 + hardness * 120, scale: 0.55, life: 380, angle: { min: 200, max: 340 }, gravityY: -60, spark: false,
        });
        if (hardness > 0.55) { FFG.fx.shake(140, 0.006 + hardness * 0.004); FFG.fx.zoomPunch(0.02, 80); }
        FFG.audio.sfx("land", 0.35 + hardness * 0.2);
      }

      _updateEnemies(dtMs) {
        if (!this.enemyGroup) return;
        var dt = dtMs / 1000;
        this.enemyGroup.children.iterate(function (en) {
          if (!en || !en.alive) return;
          en.x += en.dir * en.spd * dt;
          if (en.x > en.home + en.range + 15) { en.x = en.home + en.range + 15; en.dir = -1; en.setFlipX(true); }
          if (en.x < en.home - 15) { en.x = en.home - 15; en.dir = 1; en.setFlipX(false); }
          if (en.body) en.body.updateFromGameObject();
        });
      }

      // subtle afterglow trail: when the hero is moving fast (or falling fast),
      // leave fading ember ghosts behind for a sense of speed. Throttled so it never
      // spams the display list.
      _updateTrail(time) {
        if (!this.hero || !this.hero.body || !this.started || this.ended) return;
        var b = this.hero.body, T = this.tuning;
        var fast = Math.abs(b.velocity.x) > T.maxRun * 0.7 || b.velocity.y > T.maxFall * 0.45 || b.velocity.y < -T.jumpVel * 0.5;
        if (!fast || time - this._trailLast < 45) return;
        this._trailLast = time;
        var ghost = this.add.image(this.hero.x, this.hero.y, "hero").setDepth(D.hero - 1)
          .setScale(this.hero.scaleX, this.hero.scaleY).setRotation(this.hero.rotation)
          .setFlipX(this.hero.flipX).setAlpha(0.32).setTint(FFG.shade(pal.primary, 0.25)).setBlendMode("ADD");
        this.tweens.add({ targets: ghost, alpha: 0, scaleX: ghost.scaleX * 0.82, scaleY: ghost.scaleY * 0.82, duration: 240, ease: "Quad.out", onComplete: function () { try { ghost.destroy(); } catch (e) {} } });
      }

      _updateHeroShadow() {
        if (!this.heroShadow || !this.hero) return;
        // project shadow down to the nearest platform top under the hero
        var L = this.level, hx = this.hero.x, hb = this.hero.body ? this.hero.body.bottom : this.hero.y + 19;
        var bestY = L.height + 200;
        for (var i = 0; i < L.platforms.length; i++) {
          var p = L.platforms[i];
          if (hx >= p.x - 6 && hx <= p.x + p.w + 6 && p.y >= hb - 4 && p.y < bestY) bestY = p.y;
        }
        var dist = Phaser.Math.Clamp((bestY - hb) / 200, 0, 1);
        this.heroShadow.setPosition(hx, bestY - 2);
        this.heroShadow.setScale(1 - dist * 0.5, 1).setAlpha((1 - dist) * 0.3);
        this.heroShadow.setVisible(bestY < L.height + 150);
      }

      // ── headless test hooks (feel gate / play-bot) ─────────────────────────────
      _exposeTest() {
        var self = this;
        var api = {
          start: function () { return self.start(); },
          state: function () {
            return {
              started: self.started, ended: self.ended, victory: self.victory,
              coins: self.coins, total: self.level.coins.length, health: self.health,
              result: root.__FFG_RESULT__ || null,
            };
          },
          // Auto-pilot the hero to the goal (or death) with NO real input. We run the
          // deterministic pure-sim authority (FFG.sim.Platformer.simulate) for the
          // RESULT, and reflect that end-state into the live scene so the screen also
          // shows the resolution. No human input, fully headless-safe.
          autoResolve: function (maxMs) {
            if (!self.started) self.start();
            var res;
            try {
              res = Sim.simulate(content, { maxMs: maxMs || 60000 });
            } catch (e) {
              res = { ended: true, victory: false, reason: "sim_error:" + (e && e.message) };
            }
            // reflect into the live scene visuals (idempotent)
            if (!self.ended) {
              self.coins = res.coins != null ? res.coins : self.coins;
              if (res.victory) self._win(); else self._lose(res.reason || "killed");
            }
            return {
              ended: !!res.ended, victory: !!res.victory, reason: res.reason || null,
              coins: res.coins, total: res.totalCoins, score: res.score,
              elapsedMs: res.elapsedMs, heroX: res.heroX, goalX: res.goalX,
            };
          },
        };
        // alias names the feel gate also accepts
        api.playToEnd = api.autoResolve; api.autoPlay = api.autoResolve;
        this.__test = api;
        root.__test = api;       // task-required global
        root.__FFG_TEST__ = api; // extra alias
      }
    };
  });

  if (typeof module !== "undefined" && module.exports) module.exports = FFG;
})(typeof window !== "undefined" ? window : globalThis);
