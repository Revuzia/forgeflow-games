/**
 * FFG runtime — ffg_shell.js
 * The STANDARD game shell every FFG game gets for free: title/start menu,
 * difficulty select, pause (Esc) + Resume/Restart, win/lose end screen, and
 * looping background music. Engine-agnostic — it's DOM overlaid on the canvas,
 * so 2D (Phaser) and 3D (three.js) games use the exact same shell.
 *
 * A genre wires it with lifecycle hooks; it owns NONE of the gameplay:
 *   const shell = new FFG.Shell({
 *     parent, title, tagline, music,
 *     difficulties: ["easy","normal","hard"], defaultDifficulty: "normal",
 *     onPlay: (difficulty) => { ...start gameplay... },
 *     onPause: () => { ...freeze... }, onResume: () => { ...unfreeze... },
 *   });
 *   shell.start();                 // shows the menu
 *   ...later, when the match ends:
 *   shell.end(true, "Enemy fleet destroyed · 12 turns");
 *
 * Loaded as a classic <script> (2D) or side-effect import (3D); sets FFG.Shell.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};

  function el(tag, css, html) {
    var e = root.document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function Shell(opts) {
    this.o = opts || {};
    this.parent = this.o.parent || root.document.body;
    this.phase = "menu"; // menu | playing | paused | ended
    this.difficulty = this.o.defaultDifficulty || (this.o.difficulties && this.o.difficulties[0]) || "normal";
    this._music = null;
    this._build();
    var self = this;
    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); self.togglePause(); }
    });
  }

  Shell.prototype._build = function () {
    if (root.getComputedStyle(this.parent).position === "static") this.parent.style.position = "relative";
    this.ov = el("div",
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "flex-direction:column;gap:14px;z-index:60;background:rgba(6,14,26,0.84);" +
      "color:#dfeaff;font-family:monospace;text-align:center");
    this.parent.appendChild(this.ov);
  };

  Shell.prototype._btn = function (label, onClick, primary) {
    var b = el("button", "font:bold 16px monospace;padding:10px 22px;cursor:pointer;min-width:160px;" +
      "border:1px solid #3a6c8c;border-radius:6px;" +
      (primary ? "color:#0a1622;background:#7CFC9A" : "color:#dfeaff;background:#1c3148"), label);
    b.onclick = onClick;
    return b;
  };

  Shell.prototype._show = function () { this.ov.style.display = "flex"; };
  Shell.prototype.hide = function () { this.ov.style.display = "none"; this.ov.innerHTML = ""; };

  Shell.prototype.start = function () { this.menu(); };

  Shell.prototype.menu = function () {
    this.phase = "menu"; this.ov.dataset.ended = ""; this.ov.innerHTML = "";
    var self = this;
    this.ov.appendChild(el("div", "", '<div style="font-size:46px;font-weight:bold;letter-spacing:3px">' +
      (this.o.title || "FFG GAME").toUpperCase() + '</div>' +
      (this.o.tagline ? '<div style="font-size:14px;opacity:.8;margin-top:6px">' + this.o.tagline + '</div>' : "")));
    var diffs = this.o.difficulties || [];
    if (diffs.length) {
      this.ov.appendChild(el("div", "font-size:12px;opacity:.7;margin-top:6px", "Difficulty"));
      var row = el("div", "display:flex;gap:8px");
      diffs.forEach(function (d) {
        var b = self._btn(d.toUpperCase(), function () { self.difficulty = d; mark(); }, false);
        b.dataset.diff = d; b.style.minWidth = "96px"; row.appendChild(b);
      });
      function mark() { Array.prototype.forEach.call(row.children, function (b) { b.style.outline = b.dataset.diff === self.difficulty ? "2px solid #7CFC9A" : "none"; }); }
      this.ov.appendChild(row); mark();
    }
    this.ov.appendChild(this._btn("▶ PLAY", function () {
      self.hide(); self.phase = "playing"; self._playMusic();
      if (self.o.onPlay) self.o.onPlay(self.difficulty);
    }, true));
    this._show();
  };

  Shell.prototype.togglePause = function () {
    if (this.phase === "playing") this.pause();
    else if (this.phase === "paused") this.resume();
  };

  Shell.prototype.pause = function () {
    if (this.phase !== "playing") return;
    this.phase = "paused"; this.ov.innerHTML = "";
    var self = this;
    this.ov.appendChild(el("div", "font-size:40px;font-weight:bold", "PAUSED"));
    this.ov.appendChild(this._btn("RESUME", function () { self.resume(); }, true));
    this.ov.appendChild(this._btn("RESTART", function () { root.location.reload(); }, false));
    this._show();
    if (this.o.onPause) this.o.onPause();
  };

  Shell.prototype.resume = function () {
    if (this.phase !== "paused") return;
    this.phase = "playing"; this.hide();
    if (this.o.onResume) this.o.onResume();
  };

  Shell.prototype.end = function (victory, subtitle) {
    if (this.ov.dataset.ended === "1") return;
    this.ov.dataset.ended = "1"; this.phase = "ended"; this.ov.innerHTML = "";
    this.ov.appendChild(el("div", "", '<div style="font-size:54px;font-weight:bold;color:' +
      (victory ? "#7CFC9A" : "#ff5a5a") + '">' + (victory ? "VICTORY" : "DEFEAT") + '</div>' +
      (subtitle ? '<div style="font-size:14px;opacity:.85;margin-top:8px">' + subtitle + '</div>' : "")));
    this.ov.appendChild(this._btn("▶ PLAY AGAIN", function () { root.location.reload(); }, true));
    this._show();
    this._stopMusic();
  };

  // Music — own HTMLAudio loop (engine-agnostic). Started on Play (a user
  // gesture), so browser autoplay is permitted.
  Shell.prototype._playMusic = function () {
    if (!this.o.music) return;
    try {
      this._stopMusic();
      var a = new root.Audio(this.o.music); a.loop = true; a.volume = this.o.musicVolume != null ? this.o.musicVolume : 0.3;
      var p = a.play(); if (p && p.catch) p.catch(function () {});
      this._music = a;
    } catch (e) {}
  };
  Shell.prototype._stopMusic = function () { try { if (this._music) { this._music.pause(); this._music = null; } } catch (e) {} };

  FFG.Shell = Shell;
  if (typeof module !== "undefined" && module.exports) module.exports = { Shell: Shell };
})(typeof window !== "undefined" ? window : globalThis);
