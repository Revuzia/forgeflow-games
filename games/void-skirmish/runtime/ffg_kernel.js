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
    var game = new root.Phaser.Game({
      type: root.Phaser.AUTO,
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
