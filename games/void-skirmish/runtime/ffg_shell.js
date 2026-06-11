/**
 * FFG runtime — ffg_shell.js
 * The STANDARD game shell every FFG game gets for free: title/start menu,
 * difficulty select, How-to-Play (tutorial), Settings (music/SFX volume),
 * pause (Esc) + Resume/Restart, win/lose end screen, and looping background
 * music. Engine-agnostic — it's DOM overlaid on the canvas, so 2D (Phaser) and
 * 3D (three.js) games use the exact same shell.
 *
 * A genre wires it with lifecycle hooks; it owns NONE of the gameplay:
 *   const shell = new FFG.Shell({
 *     parent, title, tagline, music, menuImage,
 *     difficulties: ["easy","normal","hard"], defaultDifficulty: "normal",
 *     howTo: [{h:"Goal", p:"Sink the enemy fleet."}, ...],   // tutorial content
 *     onPlay: (difficulty) => { ...start gameplay... },
 *     onPause: () => { ...freeze... }, onResume: () => { ...unfreeze... },
 *   });
 *   shell.start();                 // shows the menu
 *   ...later, when the match ends:
 *   shell.end(true, "Enemy fleet destroyed · 12 turns");
 *
 * Audio: the shell owns the music element and publishes the SFX volume on
 * window.FFG.sfxVolume so engines (kernel.playSound) scale effects to the
 * player's Settings without any per-genre wiring.
 *
 * Loaded as a classic <script> (2D) or side-effect import (3D); sets FFG.Shell.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};
  var LS = "ffg_settings";

  function el(tag, css, html) {
    var e = root.document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function loadSettings() {
    try { return JSON.parse(root.localStorage.getItem(LS)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) { try { root.localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} }

  function Shell(opts) {
    this.o = opts || {};
    this.parent = this.o.parent || root.document.body;
    this.phase = "menu"; // menu | playing | paused | ended
    this.difficulty = this.o.defaultDifficulty || (this.o.difficulties && this.o.difficulties[0]) || "normal";
    this._music = null;
    var s = loadSettings();
    this.musicVolume = s.music != null ? s.music : (this.o.musicVolume != null ? this.o.musicVolume : 0.3);
    this.sfxVolume = s.sfx != null ? s.sfx : 1.0;
    FFG.sfxVolume = this.sfxVolume; // engines read this to scale SFX
    this._build();
    var self = this;
    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); self.togglePause(); }
    });
    // Hooks for the page-level control bar (game_controls.js: Fullscreen / Mute /
    // Pause). Lets the shared bar drive FFG pause + audio the way the other games' do.
    try {
      FFG.shell = self;
      root.__PAUSE__ = {
        toggle: function () { self.togglePause(); },
        pause: function () { if (self.phase === "playing") self.pause(); },
        resume: function () { if (self.phase === "paused") self.resume(); },
      };
      root.addEventListener("mutechange", function (e) {
        var m = !!(e.detail && e.detail.muted);
        FFG.sfxVolume = m ? 0 : self.sfxVolume;       // kernel.playSound scales by this
        if (self._music) { try { self._music.muted = m; } catch (x) {} }
      });
    } catch (e) {}
  }

  Shell.prototype._build = function () {
    if (root.getComputedStyle(this.parent).position === "static") this.parent.style.position = "relative";
    // Cinematic vignette: dark at edges, clear in the centre, so the live game
    // scene (the orbiting 3D ocean / 2D board) reads as the menu backdrop.
    var bg = this.o.menuImage
      ? "background:linear-gradient(rgba(6,14,26,.55),rgba(6,14,26,.78)),url('" + this.o.menuImage + "') center/cover no-repeat;"
      : "background:radial-gradient(ellipse at center,rgba(6,14,26,0.32) 0%,rgba(5,11,20,0.82) 100%);";
    this.ov = el("div",
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "flex-direction:column;gap:14px;z-index:60;" + bg +
      "color:#eaf3ff;font-family:'Segoe UI',system-ui,monospace;text-align:center");
    this.ov.className = "ffg-shell-overlay"; // tagged so a restarting scene can clean up orphans
    this.parent.appendChild(this.ov);
  };

  Shell.prototype._btn = function (label, onClick, primary) {
    var b = el("button", "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;" +
      "min-width:200px;letter-spacing:1px;border-radius:7px;transition:transform .08s,box-shadow .12s;" +
      (primary
        ? "color:#062018;background:linear-gradient(#9dffb6,#4fe084);border:1px solid #7CFC9A;box-shadow:0 4px 18px rgba(80,224,132,.35)"
        : "color:#dfeaff;background:rgba(28,49,72,.85);border:1px solid #3a6c8c"), label);
    b.onmouseenter = function () { b.style.transform = "translateY(-1px)"; };
    b.onmouseleave = function () { b.style.transform = "none"; };
    b.onclick = onClick;
    return b;
  };
  Shell.prototype._smallBtn = function (label, onClick) {
    var b = this._btn(label, onClick, false);
    b.style.minWidth = "150px"; b.style.padding = "9px 18px"; b.style.fontSize = "13px";
    return b;
  };

  Shell.prototype._show = function () { this.ov.style.display = "flex"; };
  Shell.prototype.hide = function () { this.ov.style.display = "none"; this.ov.innerHTML = ""; };

  Shell.prototype.start = function () { this.menu(); };

  Shell.prototype.menu = function () {
    this.phase = "menu"; this.ov.dataset.ended = ""; this.ov.innerHTML = "";
    var self = this;
    this.ov.appendChild(el("div", "text-align:center", '<div style="font-size:clamp(46px,8vw,88px);font-weight:900;letter-spacing:10px;' +
      "font-family:Georgia,'Times New Roman',serif;" +
      'background:linear-gradient(180deg,#fff0c8 0%,#f0c065 55%,#c98a32 100%);-webkit-background-clip:text;background-clip:text;color:transparent;' +
      'text-shadow:0 4px 26px rgba(0,0,0,.65),0 0 46px rgba(224,162,60,.28);padding:0 8px">' +
      (this.o.title || "FFG GAME").toUpperCase() + '</div>' +
      (this.o.tagline ? '<div style="font-size:16px;opacity:.88;margin-top:10px;letter-spacing:2px;color:#dfe8f4;text-shadow:0 2px 10px #000">' + this.o.tagline + '</div>' : "")));
    // PLAY first (top of the menu), difficulty selector beneath it.
    this.ov.appendChild(el("div", "height:8px"));
    this.ov.appendChild(this._btn("▶  PLAY", function () {
      self.hide(); self.phase = "playing"; self._playMusic();
      if (self.o.onPlay) self.o.onPlay(self.difficulty);
    }, true));
    var diffs = this.o.difficulties || [];
    if (diffs.length) {
      this.ov.appendChild(el("div", "font-size:12px;opacity:.7;margin-top:14px;letter-spacing:2px", "DIFFICULTY"));
      var row = el("div", "display:flex;gap:8px;margin-top:2px");
      diffs.forEach(function (d) {
        var b = self._btn(d.toUpperCase(), function () { self.difficulty = d; mark(); }, false);
        b.dataset.diff = d; b.style.minWidth = "104px"; b.style.padding = "9px 16px"; row.appendChild(b);
      });
      function mark() { Array.prototype.forEach.call(row.children, function (b) { b.style.outline = b.dataset.diff === self.difficulty ? "2px solid #7CFC9A" : "none"; }); }
      this.ov.appendChild(row); mark();
    }
    var sub = el("div", "display:flex;gap:8px;margin-top:14px");
    if (this.o.howTo) sub.appendChild(this._smallBtn("HOW TO PLAY", function () { self.tutorial(); }));
    sub.appendChild(this._smallBtn("SETTINGS", function () { self.settings(); }));
    this.ov.appendChild(sub);
    this._show();
  };

  // How-to-Play / tutorial panel — content supplied by the genre via opts.howTo
  // (array of {h, p} sections, or a raw HTML string). No more rules jammed into
  // a HUD corner; the player opens this deliberately.
  Shell.prototype.tutorial = function () {
    var self = this; this.ov.innerHTML = "";
    this.ov.appendChild(el("div", "font-size:34px;font-weight:800;letter-spacing:3px;margin-bottom:4px", "HOW TO PLAY"));
    var body;
    if (typeof this.o.howTo === "string") {
      body = el("div", "max-width:560px;font-size:14px;line-height:1.7;opacity:.92;text-align:left", this.o.howTo);
    } else {
      var html = (this.o.howTo || []).map(function (s) {
        return '<div style="margin:10px 0"><div style="color:#7CFC9A;font-weight:700;font-size:14px;letter-spacing:1px">' +
          (s.h || "") + '</div><div style="font-size:14px;line-height:1.6;opacity:.9">' + (s.p || "") + '</div></div>';
      }).join("");
      body = el("div", "max-width:560px;text-align:left;background:rgba(8,18,32,.6);padding:18px 22px;border-radius:10px;border:1px solid #244", html);
    }
    this.ov.appendChild(body);
    this.ov.appendChild(this._btn("← BACK", function () { self.menu(); }, false));
    this._show();
  };

  Shell.prototype.settings = function () {
    var self = this; this.ov.innerHTML = "";
    this.ov.appendChild(el("div", "font-size:34px;font-weight:800;letter-spacing:3px;margin-bottom:6px", "SETTINGS"));
    var panel = el("div", "min-width:360px;background:rgba(8,18,32,.6);padding:20px 24px;border-radius:10px;border:1px solid #244;text-align:left");
    function slider(label, value, onInput) {
      var wrap = el("div", "margin:14px 0");
      var lab = el("div", "display:flex;justify-content:space-between;font-size:13px;letter-spacing:1px;opacity:.9");
      var pct = el("span", "", Math.round(value * 100) + "%");
      lab.appendChild(el("span", "", label)); lab.appendChild(pct);
      wrap.appendChild(lab);
      var s = el("input"); s.type = "range"; s.min = "0"; s.max = "100"; s.value = String(Math.round(value * 100));
      s.style.cssText = "width:100%;accent-color:#7CFC9A;margin-top:8px";
      s.oninput = function () { var v = (+s.value) / 100; pct.textContent = s.value + "%"; onInput(v); };
      wrap.appendChild(s);
      return wrap;
    }
    panel.appendChild(slider("MUSIC", this.musicVolume, function (v) {
      self.musicVolume = v; if (self._music) self._music.volume = v; self._persist();
    }));
    panel.appendChild(slider("SOUND FX", this.sfxVolume, function (v) {
      self.sfxVolume = v; FFG.sfxVolume = v; self._persist();
    }));
    this.ov.appendChild(panel);
    this.ov.appendChild(this._btn("← BACK", function () { self.menu(); }, false));
    this._show();
  };
  Shell.prototype._persist = function () { saveSettings({ music: this.musicVolume, sfx: this.sfxVolume }); };

  Shell.prototype.togglePause = function () {
    if (this.phase === "playing") this.pause();
    else if (this.phase === "paused") this.resume();
  };

  Shell.prototype.pause = function () {
    if (this.phase !== "playing") return;
    this.phase = "paused"; this.ov.innerHTML = "";
    var self = this;
    this.ov.appendChild(el("div", "font-size:42px;font-weight:800;letter-spacing:3px", "PAUSED"));
    this.ov.appendChild(this._btn("RESUME", function () { self.resume(); }, true));
    this.ov.appendChild(this._smallBtn("SETTINGS", function () { self._pauseReturn = true; self.settings(); }));
    this.ov.appendChild(this._smallBtn("RESTART", function () { root.location.reload(); }));
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
    this.ov.appendChild(el("div", "", '<div style="font-size:62px;font-weight:800;letter-spacing:4px;color:' +
      (victory ? "#7CFC9A" : "#ff5a5a") + ';text-shadow:0 3px 22px rgba(0,0,0,.7)">' + (victory ? "VICTORY" : "DEFEAT") + '</div>' +
      (subtitle ? '<div style="font-size:15px;opacity:.88;margin-top:10px">' + subtitle + '</div>' : "")));
    this.ov.appendChild(this._btn("▶  PLAY AGAIN", function () { root.location.reload(); }, true));
    this._show();
    this._stopMusic();
  };

  // Music — own HTMLAudio loop (engine-agnostic). Started on Play (a user
  // gesture), so browser autoplay is permitted.
  Shell.prototype._playMusic = function () {
    if (!this.o.music) return;
    try {
      this._stopMusic();
      var a = new root.Audio(this.o.music); a.loop = true; a.volume = this.musicVolume;
      var p = a.play(); if (p && p.catch) p.catch(function () {});
      this._music = a;
    } catch (e) {}
  };
  Shell.prototype._stopMusic = function () { try { if (this._music) { this._music.pause(); this._music = null; } } catch (e) {} };

  FFG.Shell = Shell;
  if (typeof module !== "undefined" && module.exports) module.exports = { Shell: Shell };
})(typeof window !== "undefined" ? window : globalThis);
