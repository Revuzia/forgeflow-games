/* ForgeFlow Games — game_controls.js  (v2, 2026-07-10)
 * Page-level control bar (OUTSIDE game canvas): Fullscreen, Mute, Pause, Report Bug.
 *
 * Layout: floating bar BOTTOM-RIGHT of the viewport — the one place that never
 * obscures a game HUD (score/hearts live top). This is the ONLY fullscreen
 * button; the portal's old top-right overlay is removed (owner 2026-07-10).
 *
 * v2 additions (owner batch 2026-07-10):
 *  - UNIVERSAL MUTE: Audio + AudioContext constructors are wrapped at load
 *    (this script runs before any game code), so every music/SFX instance in
 *    every game responds to the mute button — no per-game wiring needed.
 *    While muted, a game's own ctx.resume() calls are held off.
 *  - ESC KEYBOARD LOCK: in fullscreen we request Keyboard Lock on Escape
 *    (Chromium): a TAP of ESC reaches the game (pause menu) and only
 *    PRESS-AND-HOLD exits fullscreen. Other browsers keep default behavior.
 *  - RIGHT-CLICK: context menu is blocked page-wide (games use right-drag).
 *  - Pause button drives window.__PAUSE__.toggle() (game menu) when exposed.
 *
 * Config: window.GAME_CONFIG.hide_controls / .hide_bug_button / .fs_hotkey=false
 * (set fs_hotkey:false when the game itself binds the F key).
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.__CONTROLS__) return;

  const CFG = window.GAME_CONFIG || {};

  const state = {
    muted: false,
    audioEls: [],        // every Audio()/DOM-discovered element
    ctxs: [],            // every AudioContext, with .__ffResume original
  };

  // ─── Universal audio capture (must run before game code) ───────
  try {
    const NativeAudio = window.Audio;
    if (NativeAudio) {
      const WrappedAudio = function (src) {
        const el = src === undefined ? new NativeAudio() : new NativeAudio(src);
        state.audioEls.push(el);
        if (state.muted) el.muted = true;
        return el;
      };
      WrappedAudio.prototype = NativeAudio.prototype;
      window.Audio = WrappedAudio;
    }
    ["AudioContext", "webkitAudioContext"].forEach(function (name) {
      const Native = window[name];
      if (!Native) return;
      const Wrapped = function () {
        const ctx = new Native();
        ctx.__ffResume = ctx.resume.bind(ctx);
        ctx.resume = function () { return state.muted ? Promise.resolve() : ctx.__ffResume(); };
        state.ctxs.push(ctx);
        if (state.muted) { try { ctx.suspend(); } catch (e) {} }
        return ctx;
      };
      Wrapped.prototype = Native.prototype;
      window[name] = Wrapped;
    });
  } catch (e) {}

  // ─── Right-click: no context menu anywhere on a game page ──────
  window.addEventListener("contextmenu", function (e) { e.preventDefault(); }, { capture: true });

  if (CFG.hide_controls === true) return;

  // ─── Build the bar ──────────────────────────────────────────────
  function _makeBar() {
    const bar = document.createElement("div");
    bar.id = "__ff_controls__";
    // DRIFTWAKE-local: `_harness/shoot.py`'s `__sfChrome()` hides
    // `#boot, #hint, #overlay, .overlay, #perf` before every comparison shot.
    // The bar is z-index 2147483600 and lives in the bottom-right corner, so
    // without a matching selector it would be baked into all fourteen battery
    // frames and every one of them would differ from the WebGPU reference.
    bar.className = "overlay";
    bar.style.cssText = [
      "position:fixed", "bottom:8px", "right:8px", "z-index:2147483600",
      "display:flex", "gap:4px", "align-items:center",
      "padding:4px 5px", "border-radius:9px",
      "background:rgba(0,0,0,0.5)", "backdrop-filter:blur(6px)",
      "box-shadow:0 2px 10px rgba(0,0,0,0.3)",
      "font-family:system-ui,-apple-system,sans-serif", "user-select:none",
      "pointer-events:auto",
      "opacity:0.65", "transition:opacity .15s",
    ].join(";");
    bar.addEventListener("mouseenter", function () { bar.style.opacity = "1"; });
    bar.addEventListener("mouseleave", function () { bar.style.opacity = "0.65"; });
    return bar;
  }

  function _makeBtn(title, svgInner, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.style.cssText = [
      "width:26px", "height:26px", "padding:0",
      "border:none", "border-radius:6px", "cursor:pointer",
      "background:rgba(255,255,255,0.08)", "color:#fff",
      "display:flex", "align-items:center", "justify-content:center",
      "transition:background .15s, transform .1s",
    ].join(";");
    b.innerHTML = svgInner;
    b.addEventListener("mouseenter", function () { b.style.background = "rgba(255,255,255,0.2)"; });
    b.addEventListener("mouseleave", function () { b.style.background = "rgba(255,255,255,0.08)"; });
    b.addEventListener("mousedown",  function () { b.style.transform = "scale(0.94)"; });
    b.addEventListener("mouseup",    function () { b.style.transform = "scale(1)"; });
    b.addEventListener("click", onClick);
    return b;
  }

  const SVG = {
    fsEnter: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4"/></svg>',
    fsExit:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v4H4M16 3v4h4M16 21v-4h4M8 21v-4H4"/></svg>',
    volOn:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>',
    volOff:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
    bug:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 7l-3 2M5 7l3 2M19 13h-3M5 13h3M19 19l-3-2M5 19l3-2M12 2v4"/></svg>',
    pause:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>',
  };

  // ─── Fullscreen (+ ESC keyboard lock where supported) ───────────
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }
  function toggleFullscreen() {
    const target = document.documentElement;
    if (isFullscreen()) {
      const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (fn) fn.call(document);
    } else {
      const fn = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
      if (fn) fn.call(target);
    }
  }
  function lockEsc() {
    // Chromium Keyboard Lock: ESC tap goes to the game (pause menu); only
    // press-and-hold exits fullscreen. No-op on Firefox/Safari.
    try {
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(["Escape"]).catch(function () {});
    } catch (e) {}
  }
  function unlockEsc() {
    try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) {}
  }

  // ─── Mute (universal via the constructor wraps + legacy paths) ──
  function applyMute() {
    try {
      document.querySelectorAll("audio, video").forEach(function (a) { a.muted = state.muted; });
      state.audioEls.forEach(function (a) { try { a.muted = state.muted; } catch (e) {} });
      if (Array.isArray(window.__GAME_AUDIO__)) {
        window.__GAME_AUDIO__.forEach(function (a) { if (a) { try { a.muted = state.muted; } catch (e) {} } });
      }
      state.ctxs.forEach(function (c) {
        try {
          if (state.muted && c.state === "running") c.suspend();
          else if (!state.muted && c.state === "suspended") c.__ffResume();
        } catch (e) {}
      });
      if (window.__AUDIO_CTX__) {
        if (state.muted && window.__AUDIO_CTX__.state === "running") window.__AUDIO_CTX__.suspend();
        else if (!state.muted && window.__AUDIO_CTX__.state === "suspended") window.__AUDIO_CTX__.resume();
      }
      window.dispatchEvent(new CustomEvent("mutechange", { detail: { muted: state.muted } }));
    } catch (e) {}
  }
  function toggleMute() {
    state.muted = !state.muted;
    applyMute();
    try { localStorage.setItem("ff_muted", state.muted ? "1" : "0"); } catch (e) {}
    btns.mute.innerHTML = state.muted ? SVG.volOff : SVG.volOn;
    btns.mute.title = state.muted ? "Unmute (M)" : "Mute (M)";
  }

  // ─── Bug report ─────────────────────────────────────────────────
  function reportBug() {
    const msg = window.prompt("Describe the bug (what happened, what you expected):");
    if (!msg || !msg.trim()) return;
    try {
      if (window.__AUDIT__ && typeof window.__AUDIT__.reportBug === "function") {
        const result = window.__AUDIT__.reportBug(msg.trim());
        if (result && result.then) {
          result.then(function () { alert("Thanks — bug report submitted."); })
                .catch(function () { alert("Bug saved locally; will retry when online."); });
        } else {
          alert("Thanks — bug report submitted.");
        }
      } else {
        alert("Bug reporting not available on this game.");
      }
    } catch (e) {
      alert("Bug save failed: " + (e.message || e));
    }
  }

  // ─── Build + mount ──────────────────────────────────────────────
  const bar = _makeBar();
  const btns = {
    fs:    _makeBtn("Fullscreen (F)", SVG.fsEnter, toggleFullscreen),
    mute:  _makeBtn("Mute (M)",       SVG.volOn,   toggleMute),
    pause: _makeBtn("Pause / Menu",   SVG.pause,   function () {
      if (window.__PAUSE__ && window.__PAUSE__.toggle) window.__PAUSE__.toggle();
    }),
    bug:   _makeBtn("Report a bug",   SVG.bug,     reportBug),
  };
  bar.appendChild(btns.fs);
  bar.appendChild(btns.mute);
  bar.appendChild(btns.pause);
  if (CFG.hide_bug_button !== true) bar.appendChild(btns.bug);

  function mount() {
    if (!document.body) { setTimeout(mount, 50); return; }
    if (!document.getElementById("__ff_controls__")) document.body.appendChild(bar);
  }
  mount();

  // Keyboard shortcuts: F = fullscreen (unless the game claims F), M = mute
  window.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.code === "KeyF" && CFG.fs_hotkey !== false) { toggleFullscreen(); e.preventDefault(); }
    else if (e.code === "KeyM") { toggleMute(); e.preventDefault(); }
  });

  // Sync fullscreen icon on change (F11/ESC too) + ESC lock lifecycle
  document.addEventListener("fullscreenchange", function () {
    const fs = isFullscreen();
    btns.fs.innerHTML = fs ? SVG.fsExit : SVG.fsEnter;
    if (fs) lockEsc();
    else {
      unlockEsc();
      // Auto-pause on exiting fullscreen if game was mid-play
      if (window.__PAUSE__ && typeof window.__PAUSE__.pause === "function") {
        try { window.__PAUSE__.pause(); } catch (e) {}
      }
    }
  });

  // Restore mute preference on load
  try {
    if (localStorage.getItem("ff_muted") === "1") toggleMute();
  } catch (e) {}

  // Public API
  window.__CONTROLS__ = {
    toggleFullscreen: toggleFullscreen,
    toggleMute: toggleMute,
    isMuted: function () { return state.muted; },
    isFullscreen: isFullscreen,
    reportBug: reportBug,
  };
})();
