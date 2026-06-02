/**
 * FFG runtime — ffg_kernel.js
 * Genre-agnostic shared services every FFG game uses. Loaded once via <script>.
 * Fixed + versioned — NOT regenerated per game. Browser-only (uses Phaser).
 *
 * Exposes window.FFG:
 *   FFG.genres            registry { genreName: (content) => Phaser.Scene class }
 *   FFG.register(name, f) genre runtimes call this to register their scene factory
 *   FFG.text(scene,...)   sharp HUD/label text (resolution:2, never blurry)
 *   FFG.audio             tiny audio bus (sfx/music with graceful no-asset fallback)
 *   FFG.color(hex)        helpers
 *   FFG.boot(content)     build the Phaser.Game from a validated content object
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};
  FFG.sim = FFG.sim || {};
  FFG.genres = FFG.genres || {};
  FFG.VERSION = "2.0.0";

  FFG.register = function (name, sceneFactory) { FFG.genres[name] = sceneFactory; };

  // Sharp text — wraps scene.add.text with resolution:2 + sane defaults so HUD
  // never renders blurry (the shroud-font bug, fixed once, here, for everyone).
  FFG.text = function (scene, x, y, str, opts) {
    opts = opts || {};
    var style = {
      fontFamily: opts.font || "monospace",
      fontSize: (opts.size || 12) + "px",
      color: opts.color || "#ffffff",
      align: opts.align || "left",
      resolution: 2,
    };
    if (opts.stroke) { style.stroke = opts.stroke; style.strokeThickness = opts.strokeThickness || 2; }
    if (opts.wrap) style.wordWrap = { width: opts.wrap };
    if (opts.bg) style.backgroundColor = opts.bg;
    if (opts.padding) style.padding = opts.padding;
    var t = scene.add.text(x, y, str, style);
    if (opts.origin != null) t.setOrigin(opts.origin, opts.originY != null ? opts.originY : opts.origin);
    if (opts.depth != null) t.setDepth(opts.depth);
    return t;
  };

  // Audio bus — plays keyed sfx/music if loaded; silently no-ops otherwise so a
  // game with no audio assets never throws.
  FFG.audio = {
    _scene: null,
    bind: function (scene) { this._scene = scene; },
    sfx: function (key, vol) {
      try { if (this._scene && this._scene.cache.audio.exists(key)) this._scene.sound.play(key, { volume: vol == null ? 0.6 : vol }); } catch (e) {}
    },
    music: function (key, vol) {
      try {
        if (!this._scene || !this._scene.cache.audio.exists(key)) return;
        if (this._music) this._music.stop();
        this._music = this._scene.sound.add(key, { volume: vol == null ? 0.4 : vol, loop: true });
        this._music.play();
      } catch (e) {}
    },
  };

  FFG.color = function (hex) { return (typeof hex === "string") ? parseInt(hex.replace("#", "0x")) : hex; };

  // ── PALETTES ───────────────────────────────────────────────────────────────
  // Cohesive color schemes so every 2D game looks DESIGNED, not random-hex. A genre
  // picks one (or content.palette overrides) and themes its whole scene from it.
  FFG.palettes = {
    abyss: { bg: "#040810", bg2: "#0a1426", primary: 0x3aa0ff, accent: 0x00ffd5, good: 0x5dff8f, danger: 0xff5a6e, warn: 0xffd23b, ink: 0xeaf3ff },
    neon:  { bg: "#0a0612", bg2: "#170a2a", primary: 0x00ffd5, accent: 0xff2e88, good: 0x5dff8f, danger: 0xff3b3b, warn: 0xffd23b, ink: 0xeafcff },
    ember: { bg: "#120806", bg2: "#241008", primary: 0xff7a18, accent: 0xffd23b, good: 0x8fff5d, danger: 0xff2e2e, warn: 0xffae3b, ink: 0xfff0e0 },
    toxic: { bg: "#070f06", bg2: "#0e2010", primary: 0x9dff3b, accent: 0x00ffd5, good: 0xc8ff5d, danger: 0xff4ed1, warn: 0xffd23b, ink: 0xf0ffe0 },
    candy: { bg: "#1a0a16", bg2: "#2a0e26", primary: 0xff5db8, accent: 0x5de1ff, good: 0x9dff8f, danger: 0xff3b6e, warn: 0xffe05d, ink: 0xfff0fa },
    mono:  { bg: "#0b0d12", bg2: "#161a24", primary: 0xc8d4e0, accent: 0x7fd0f0, good: 0x8fffb0, danger: 0xff7a6a, warn: 0xffd28a, ink: 0xffffff },
  };
  FFG.palette = function (name) { return FFG.palettes[name] || FFG.palettes.abyss; };
  // lighten/darken a 0xRRGGBB by t in [-1,1]
  FFG.shade = function (hex, t) {
    var c = (typeof hex === "string") ? FFG.color(hex) : hex;
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, f = t < 0 ? 0 : 255, p = Math.abs(t);
    r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
    return (r << 16) | (g << 8) | b;
  };

  // ── FX — the JUICE layer ─────────────────────────────────────────────────────
  // Glow, particle bursts, screen shake/flash, hit-stop, squash-pops, shockwaves,
  // floating combat text, parallax starfields, gradients + vignette. This is what
  // turns a flat 2D scene into one that FEELS AAA. Every method is a safe no-op if
  // the renderer can't do it (Canvas fallback), so a game never throws for juice.
  // Usage in a genre scene's create(): FFG.fx.bind(this);  then FFG.fx.burst(x,y,...)
  FFG.fx = {
    _scene: null, _webgl: false,
    bind: function (scene) {
      this._scene = scene;
      try { this._webgl = scene.sys.game.renderer.type === root.Phaser.WEBGL; } catch (e) { this._webgl = false; }
      this._ensureTextures(scene);
      return this;
    },
    _ensureTextures: function (scene) {
      try {
        if (!scene.textures.exists("__fx_dot")) {
          var g = scene.make.graphics({ x: 0, y: 0, add: false });
          g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 7);
          g.fillStyle(0xffffff, 0.55); g.fillCircle(8, 8, 4);
          g.generateTexture("__fx_dot", 16, 16); g.destroy();
        }
        if (!scene.textures.exists("__fx_spark")) {
          var s = scene.make.graphics({ x: 0, y: 0, add: false });
          s.fillStyle(0xffffff, 1); s.fillRect(0, 5, 14, 2); s.fillRect(6, 0, 2, 12);
          s.generateTexture("__fx_spark", 14, 12); s.destroy();
        }
      } catch (e) {}
    },
    // soft outer glow on a game object (WebGL only; harmless no-op on Canvas)
    glow: function (obj, color, outer) {
      try { if (obj && this._webgl && obj.postFX) obj.postFX.addGlow(color == null ? 0xffffff : color, outer == null ? 4 : outer, 0, false, 0.1, 10); } catch (e) {}
      return obj;
    },
    // whole-scene bloom (call once after building the scene)
    bloom: function (strength) {
      try { if (this._webgl && this._scene) this._scene.cameras.main.postFX.addBloom(0xffffff, 1, 1, 1.05, strength == null ? 1.1 : strength, 6); } catch (e) {}
    },
    shake: function (dur, intensity) {
      try { if (this._scene) this._scene.cameras.main.shake(dur == null ? 180 : dur, intensity == null ? 0.006 : intensity); } catch (e) {}
    },
    flash: function (color, dur) {
      try { var c = root.Phaser.Display.Color.IntegerToColor(color == null ? 0xffffff : color); this._scene.cameras.main.flash(dur == null ? 130 : dur, c.red, c.green, c.blue); } catch (e) {}
    },
    // quick zoom-in-and-back impact punch
    zoomPunch: function (amount, dur) {
      try { var cam = this._scene.cameras.main, z0 = cam.zoom; this._scene.tweens.add({ targets: cam, zoom: z0 * (1 + (amount == null ? 0.04 : amount)), duration: dur == null ? 90 : dur, yoyo: true, ease: "Quad.out" }); } catch (e) {}
    },
    // brief time-slow on a big hit (game feel). Restores automatically.
    hitstop: function (ms) {
      try {
        var sc = this._scene; ms = ms == null ? 55 : ms;
        if (sc.physics && sc.physics.world) sc.physics.world.timeScale = 5; // inverse: higher = slower
        sc.tweens.timeScale = 0.18;
        sc.time.delayedCall(ms, function () { try { if (sc.physics && sc.physics.world) sc.physics.world.timeScale = 1; sc.tweens.timeScale = 1; } catch (e) {} });
      } catch (e) {}
    },
    // squash-and-stretch pop (spawn / hit emphasis)
    pop: function (obj, scale, dur) {
      try { if (!obj) return obj; var sx = obj.scaleX, sy = obj.scaleY, k = scale == null ? 1.32 : scale; obj.setScale(sx * k, sy * (2 - k)); this._scene.tweens.add({ targets: obj, scaleX: sx, scaleY: sy, duration: dur == null ? 220 : dur, ease: "Back.out" }); } catch (e) {}
      return obj;
    },
    // one-shot additive particle burst
    burst: function (x, y, opts) {
      opts = opts || {};
      try {
        var n = opts.count || 14;
        var em = this._scene.add.particles(x, y, opts.spark ? "__fx_spark" : "__fx_dot", {
          speed: { min: opts.speedMin || 50, max: opts.speed || 220 },
          angle: opts.angle != null ? opts.angle : { min: 0, max: 360 },
          scale: { start: opts.scale || 0.75, end: 0 },
          lifespan: opts.life || 460, tint: opts.color != null ? opts.color : 0xffffff,
          blendMode: "ADD", gravityY: opts.gravityY || 0, emitting: false,
        });
        em.setDepth(opts.depth != null ? opts.depth : 60); em.explode(n);
        this._scene.time.delayedCall((opts.life || 460) + 120, function () { try { em.destroy(); } catch (e) {} });
      } catch (e) {}
    },
    // expanding ring (impact / pickup / spawn)
    shockwave: function (x, y, opts) {
      opts = opts || {};
      try {
        var col = opts.color != null ? opts.color : 0xffffff, th = opts.thickness || 3;
        var c = this._scene.add.circle(x, y, opts.r0 || 4).setStrokeStyle(th, col, 1).setDepth(opts.depth != null ? opts.depth : 59).setFillStyle();
        this.glow(c, col, 3);
        this._scene.tweens.add({ targets: c, radius: opts.r1 || 56, alpha: 0, duration: opts.dur || 380, ease: "Cubic.out", onComplete: function () { try { c.destroy(); } catch (e) {} } });
      } catch (e) {}
    },
    // rising, fading combat text
    float: function (x, y, text, opts) {
      opts = opts || {};
      try {
        var t = FFG.text(this._scene, x, y, String(text), { size: opts.size || 16, color: opts.colorStr || "#ffffff", stroke: "#000000", strokeThickness: 4, origin: 0.5, depth: opts.depth != null ? opts.depth : 90 });
        this._scene.tweens.add({ targets: t, y: y - (opts.rise || 34), alpha: 0, duration: opts.dur || 880, ease: "Quad.out", onComplete: function () { try { t.destroy(); } catch (e) {} } });
      } catch (e) {}
    },
    // scrolling parallax starfield background (depth -40)
    starfield: function (scene, opts) {
      opts = opts || {};
      try {
        var W = scene.scale.width, H = scene.scale.height, n = opts.count || 90, stars = [];
        for (var i = 0; i < n; i++) { var d = Math.random(); var s = scene.add.circle(Math.random() * W, Math.random() * H, 0.5 + d * 1.8, opts.color || 0xffffff, 0.35 + d * 0.5).setDepth(opts.depth != null ? opts.depth : -40); s._spd = 6 + d * (opts.speed || 56); stars.push(s); }
        scene.events.on("update", function (t, dt) { var dy = dt / 1000; for (var j = 0; j < stars.length; j++) { var st = stars[j]; st.y += st._spd * dy; if (st.y > H + 2) { st.y = -2; st.x = Math.random() * W; } } });
        return stars;
      } catch (e) { return []; }
    },
    // vertical gradient background (depth -100)
    gradient: function (scene, top, bottom) {
      try { var W = scene.scale.width, H = scene.scale.height, g = scene.add.graphics().setDepth(-100); g.fillGradientStyle(top, top, bottom, bottom, 1, 1, 1, 1); g.fillRect(0, 0, W, H); return g; } catch (e) {}
    },
    // dark vignette edges (depth -8)
    vignette: function (scene, strength) {
      try {
        var W = scene.scale.width, H = scene.scale.height, d = Math.min(190, H * 0.32), a = strength == null ? 0.5 : strength, vg = scene.add.graphics().setDepth(-8);
        vg.fillGradientStyle(0, 0, 0, 0, a, a, 0, 0); vg.fillRect(0, 0, W, d);
        vg.fillGradientStyle(0, 0, 0, 0, 0, 0, a, a); vg.fillRect(0, H - d, W, d);
        vg.fillGradientStyle(0, 0, 0, 0, a, 0, a, 0); vg.fillRect(0, 0, d, H);
        vg.fillGradientStyle(0, 0, 0, 0, 0, a, 0, a); vg.fillRect(W - d, 0, d, H);
        return vg;
      } catch (e) {}
    },
  };

  // Boot: pick the genre scene factory, build the Phaser game at the content's
  // declared resolution, hand the content to the scene.
  FFG.boot = function (content) {
    if (!root.Phaser) { console.error("[FFG] Phaser not loaded"); return null; }
    var genre = content.genre;
    var factory = FFG.genres[genre];
    if (!factory) { console.error("[FFG] no runtime registered for genre:", genre, "have:", Object.keys(FFG.genres)); return null; }
    var SceneClass = factory(content);
    var view = content.view || {};
    var W = view.width || 960, H = view.height || 600;
    var testMode = (typeof location !== "undefined" && location.search && location.search.indexOf("test=1") >= 0);
    // ?canvas=1 forces the Canvas2D renderer — a fallback for machines whose WebGL is
    // broken/blocklisted, and the only path that screenshots reliably in headless
    // (WebGL's drawing buffer reads back blank). postFX glow/bloom are WebGL-only, so
    // Canvas mode just skips them (FFG.fx already feature-detects); everything else renders.
    var forceCanvas = (typeof location !== "undefined" && location.search && location.search.indexOf("canvas=1") >= 0);
    var game = new root.Phaser.Game({
      type: forceCanvas ? root.Phaser.CANVAS : root.Phaser.AUTO,
      width: W, height: H,
      parent: content.parent || "game-container",
      backgroundColor: view.background || "#0a0e1a",
      pixelArt: !!view.pixelArt,
      antialias: view.pixelArt ? false : true,
      scale: { mode: root.Phaser.Scale.FIT, autoCenter: root.Phaser.Scale.CENTER_BOTH },
      physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
      fps: testMode ? { forceSetTimeOut: true, target: 60 } : undefined,
      scene: [SceneClass],
    });
    root.__FFG_GAME__ = game;
    root.__FFG_CONTENT__ = content;
    return game;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = FFG;
})(typeof window !== "undefined" ? window : globalThis);
