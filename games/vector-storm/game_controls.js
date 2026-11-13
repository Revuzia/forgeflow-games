/* ForgeFlow Games — game_controls.js
 * Page-level control bar (OUTSIDE game canvas): Fullscreen, Mute, Report Bug.
 *
 * Why not inside game canvas: the canvas can obscure, resize, or break event
 * hit-testing for on-canvas overlays. A page-fixed button bar always reachable.
 *
 * Layout: floating bar top-right of the VIEWPORT (not canvas). Icons only,
 * semi-transparent, tooltips on hover.
 *
 * Integrates with:
 *   - pause.js (auto-pauses on fullscreen change for safety)
 *   - deep_audit.js (Report Bug → window.__AUDIT__.reportBug(msg))
 *   - Any <audio> or AudioContext in the game (global mute toggle)
 *
 * Can be hidden via: window.GAME_CONFIG.hide_controls = true
 * Bug button specifically hidden via: window.GAME_CONFIG.hide_bug_button = true
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.__CONTROLS__) return;

  const CFG = window.GAME_CONFIG || {};
  if (CFG.hide_controls === true) return;

  const state = {
    muted: false,
    prevVolumes: new WeakMap(),
  };

  // ─── Build the bar ──────────────────────────────────────────────
  function _makeBar() {
    const bar = document.createElement("div");
    bar.id = "__ff_controls__";
    // 2026-04-17: moved to bottom-right + smaller so top HUD (score/lives/hearts) is unobstructed
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
    bar.addEventListener("mouseenter", () => { bar.style.opacity = "1"; });
    bar.addEventListener("mouseleave", () => { bar.style.opacity = "0.65"; });
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
    b.addEventListener("mouseenter", () => { b.style.background = "rgba(255,255,255,0.2)"; });
    b.addEventListener("mouseleave", () => { b.style.background = "rgba(255,255,255,0.08)"; });
    b.addEventListener("mousedown",  () => { b.style.transform = "scale(0.94)"; });
    b.addEventListener("mouseup",    () => { b.style.transform = "scale(1)"; });
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

  // ─── Fullscreen ─────────────────────────────────────────────────
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

  // ─── Mute ───────────────────────────────────────────────────────
  // Covers 3 audio strategies:
  //   1. <audio>/<video> elements in DOM (querySelectorAll)
  //   2. Detached `new Audio(...)` instances registered via window.__GAME_AUDIO__ (array)
  //   3. AudioContext at window.__AUDIO_CTX__
  //   4. Custom games listening for 'mutechange' event (dispatched below)
  function toggleMute() {
    state.muted = !state.muted;
    try {
      // Strategy 1: DOM audio/video
      document.querySelectorAll("audio, video").forEach(function (a) {
        a.muted = state.muted;
      });
      // Strategy 2: detached Audio instances registered by the game
      if (Array.isArray(window.__GAME_AUDIO__)) {
        window.__GAME_AUDIO__.forEach(function (a) {
          if (!a) return;
          try { a.muted = state.muted; } catch (e) {}
        });
      }
      // Strategy 3: Web Audio context
      if (window.__AUDIO_CTX__) {
        if (state.muted && window.__AUDIO_CTX__.state === "running") window.__AUDIO_CTX__.suspend();
        else if (!state.muted && window.__AUDIO_CTX__.state === "suspended") window.__AUDIO_CTX__.resume();
      }
      // Strategy 4: broadcast — games implement their own response
      window.dispatchEvent(new CustomEvent("mutechange", { detail: { muted: state.muted } }));
    } catch (e) {}
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
    pause: _makeBtn("Pause (ESC)",    SVG.pause,   function () {
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

  // Keyboard shortcuts: F = fullscreen, M = mute (avoid conflict with game inputs by ignoring when typing)
  window.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.code === "KeyF") { toggleFullscreen(); e.preventDefault(); }
    else if (e.code === "KeyM") { toggleMute(); e.preventDefault(); }
  });

  // Sync fullscreen icon when user presses F11 or ESC
  document.addEventListener("fullscreenchange", function () {
    btns.fs.innerHTML = isFullscreen() ? SVG.fsExit : SVG.fsEnter;
    // Auto-pause on exiting fullscreen if game was mid-play
    if (!isFullscreen() && window.__PAUSE__ && typeof window.__PAUSE__.pause === "function") {
      // only if something was actively running
      try { window.__PAUSE__.pause(); } catch (e) {}
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
    reportBug: reportBug,
  };
})();
