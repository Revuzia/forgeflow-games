/* ForgeFlow Games — game_controls.js  (v3, 2026-09-15)
 * Page-level control layer (OUTSIDE the game canvas): device detection,
 * touch controls, and the Fullscreen / Mute / Pause / Report-Bug bar.
 *
 * Layout: floating bar BOTTOM-RIGHT of the viewport — the one place that never
 * obscures a game HUD (score/hearts live top). This is the ONLY fullscreen
 * button; the portal's old top-right overlay is removed (owner 2026-07-10).
 *
 * ── HISTORY ────────────────────────────────────────────────────────────
 * v1 (2026-04-17): bar with Fullscreen / Mute / Pause / Bug; mute reached
 *   only <audio> elements, window.__GAME_AUDIO__ and window.__AUDIO_CTX__.
 * v2 (2026-07-10, owner batch):
 *  - UNIVERSAL MUTE: Audio + AudioContext constructors are wrapped at load
 *    (this script runs before any game code), so every music/SFX instance in
 *    every game responds to the mute button — no per-game wiring needed.
 *    While muted, a game's own ctx.resume() calls are held off.
 *  - ESC KEYBOARD LOCK: in fullscreen we request Keyboard Lock on Escape
 *    (Chromium): a TAP of ESC reaches the game (pause menu) and only
 *    PRESS-AND-HOLD exits fullscreen. Other browsers keep default behavior.
 *  - RIGHT-CLICK: context menu is blocked page-wide (games use right-drag).
 *  - Pause button drives window.__PAUSE__.toggle() (game menu) when exposed.
 *  NOTE: v2 shipped into games/ but was never back-ported to this pipeline
 *  copy, which sat at v1 until 2026-09-15. Anything added here must stay a
 *  SUPERSET of v2, or vendoring this file would silently delete v2 from 35
 *  games. Do not "simplify" the audio wrap or the ESC lock out of it.
 * v3 (2026-09-15, owner ask "games differentiate between pc and mobile"):
 *  - DEVICE SIGNAL: window.FFG_DEVICE + html.ffg-touch / .ffg-desktop and
 *    .ffg-portrait / .ffg-landscape classes, set BEFORE any game code runs.
 *  - TOUCH CONTROL LAYER: a virtual thumbstick, action buttons and an
 *    optional look zone that SYNTHESIZE the same keyboard/mouse events a
 *    desktop player produces, so already-shipped games become playable on a
 *    phone with zero per-game code changes.
 *  - PROFILE TABLE: per-game touch layout keyed by URL slug, held HERE so no
 *    game file has to be edited (house rule: fixes are pipeline-level).
 *  - DESKTOP-HINT HIDING: a stylesheet convention games can adopt to drop
 *    "press WASD" text on phones.
 *
 * ── CONVENTIONS THIS FILE ESTABLISHES (games may adopt; none are required) ─
 *  window.FFG_DEVICE = { touch, mobile, coarse, portrait, maxTouchPoints }
 *      Authoritative, set at load. `touch` means "the PRIMARY pointer is
 *      coarse" — i.e. a phone/tablet, NOT a touchscreen laptop with a mouse.
 *  'ffg:device'  CustomEvent on window (detail = FFG_DEVICE) for late loaders.
 *  'ffg:orientation' CustomEvent on window when portrait/landscape flips.
 *  html.ffg-touch / html.ffg-desktop / html.ffg-portrait / html.ffg-landscape
 *  data-desktop-only | class="desktop-only" | class="kbd-hint"
 *      -> hidden on touch devices. Put keyboard hints ("WASD · mouse · space")
 *         in one of these and phones stop being told to press keys they lack.
 *  data-touch-only  | class="touch-only"
 *      -> hidden on desktop. The mirror image, for "drag to look" hints.
 *
 * ── CONFIG (window.GAME_CONFIG) ────────────────────────────────────────
 *  .hide_controls   true  -> no bar AND no touch overlay (device signal stays)
 *  .hide_bug_button true  -> bar without the bug button
 *  .fs_hotkey       false -> the game itself binds F; do not steal it
 *  .slug            'x'   -> override the auto-detected game slug
 *  .touch           false -> HARD opt-out: no touch overlay at all
 *  .touch = {             -> per-game overrides; see TOUCH CONFIG CONTRACT
 *      stick: 'wasd'|'arrows'|'both'|false,   // default 'both'
 *      stickKeys: {up,down,left,right},       // explicit codes, beats `stick`
 *      stickAxis: 'both'|'x'|'y',             // default 'both'
 *      look: true|false,                      // default false
 *      lookSensitivity: 1.0,
 *      buttons: [{ label:'JUMP', key:'Space', side:'right' }],
 *      tapToClick: true|false,                // default true
 *      deadzone: 0.30,
 *      enabled: true|false,                   // profile-level kill switch
 *      force: true|false                      // show the overlay on desktop
 *    }
 *  Precedence: GAME_CONFIG.touch  >  PROFILES[slug]  >  DEFAULT_TOUCH.
 *  Debug: ?ffg_touch=1 forces the overlay on a desktop browser;
 *         ?ffg_touch=0 disables it; ?ffg_slug=<slug> borrows another profile.
 *
 * ── WHY SYNTHESIZED EVENTS ─────────────────────────────────────────────
 * The published games are already shipped and must not be edited one by one.
 * The only input contract every one of them already honours is "a keyboard
 * and a mouse". So the thumbstick does not expose an API for games to read —
 * it dispatches real KeyboardEvents, and the look zone dispatches real
 * mouse/pointer moves. A game written in 2026-04 responds without knowing
 * this file exists.
 *
 * ── WHY ONE DISPATCH, NOT TWO ──────────────────────────────────────────
 * Keyboard events are dispatched ONCE, on document.body, with bubbles:true.
 * A bubbling event from body reaches listeners on body, document AND window
 * (Window is the last entry in the propagation path), so both `window.on-
 * keydown` games and `document.onkeydown` games are covered. Dispatching
 * separately on window AND document would deliver TWO keydowns to every
 * window-listening game — a double-fire that reads as doubled/stuck input.
 *
 * ── WHY tapToClick DOES NOT FORWARD EVERY TAP ──────────────────────────
 * Browsers already synthesize mousedown/mouseup/click from a tap that nobody
 * calls preventDefault() on, and the 3D games here take `pointerdown`, which
 * fires natively for touch. The overlay container is pointer-events:none, so
 * taps on the game surface are never swallowed and never need replacing.
 * Forwarding them anyway would give every board game TWO clicks per tap
 * (select a piece, then instantly "click" its destination). So tapToClick
 * only replays taps the overlay itself consumed — i.e. taps that land in the
 * LOOK zone, the one region with pointer-events:auto over game surface.
 * Everywhere else, the browser is already correct.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.__CONTROLS__) return;
  /* v3: hide_controls returns early, before __CONTROLS__ is published, so the
     old guard alone let a second copy of this script re-wrap Audio. */
  if (window.__FFG_CONTROLS_LOADED__) return;
  window.__FFG_CONTROLS_LOADED__ = true;

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
  // Also kills the Android long-press callout, which otherwise fires
  // mid-drag on the thumbstick.
  window.addEventListener("contextmenu", function (e) { e.preventDefault(); }, { capture: true });

  // ════════════════════════════════════════════════════════════════
  //  v3 §1 — DEVICE DIFFERENTIATION
  //  Runs before the hide_controls bail-out: a game that hides the bar
  //  still deserves to know what it is running on.
  // ════════════════════════════════════════════════════════════════
  function _mq(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; }
  }

  /* Is the PRIMARY pointer coarse — a phone or a tablet?
   *
   * Only `(pointer: coarse)` answers that. `ontouchstart` and
   * navigator.maxTouchPoints say the machine CAN take touch, which every
   * touchscreen laptop can, and is no reason to take the mouse away from
   * someone using one. (Same reasoning, and the same bug it prevents, as
   * games/ascendant/runtime/core/input.js::_detectCoarsePointer.)
   */
  const COARSE = _mq("(pointer: coarse)");

  /* Does SOME attached pointer report as fine — a mouse, a trackpad, a
   * stylus? Every laptop answers yes, no phone does. A hybrid (coarse
   * primary pointer AND a real mouse — a tablet with a bluetooth mouse, a
   * convertible in tablet mode) answers yes too, and must NOT be forced into
   * touch mode: see MOUNT_MODE below. */
  const ANY_FINE = _mq("(any-pointer: fine)");

  const MAX_TOUCH = (function () {
    try { return navigator.maxTouchPoints || (("ontouchstart" in window) ? 1 : 0); } catch (e) { return 0; }
  })();

  function _isPortrait() {
    if (window.matchMedia) {
      if (_mq("(orientation: portrait)")) return true;
      if (_mq("(orientation: landscape)")) return false;
    }
    return (window.innerHeight || 0) >= (window.innerWidth || 0);
  }

  const DEVICE = {
    touch: COARSE,                 // authoritative "this is a touch device"
    mobile: COARSE && !ANY_FINE,   // a phone/tablet, not a touchscreen laptop
    coarse: COARSE,                // the raw media query, for game-side logic
    portrait: _isPortrait(),
    maxTouchPoints: MAX_TOUCH,
  };
  window.FFG_DEVICE = DEVICE;

  /* MOUNT_MODE — when does the on-screen overlay actually appear?
   *   'now'     real phone/tablet: coarse primary pointer, no fine pointer.
   *   'onTouch' hybrid: coarse AND fine. Wait for a real touchstart, exactly
   *             as ascendant's input.js arms its own touch UI. A player
   *             holding the mouse never sees the overlay; the moment they put
   *             a finger on the glass, it appears.
   *   'never'   desktop. FFG_DEVICE.touch is false and nothing is built.
   */
  const MOUNT_MODE = DEVICE.mobile ? "now" : (COARSE ? "onTouch" : "never");

  function _retry(fn) {
    // documentElement/head/body may not exist yet if this is injected at
    // document start (they do exist for the normal <script> in <body> case).
    if (fn()) return;
    setTimeout(function () { _retry(fn); }, 20);
  }

  function _fire(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  }

  /* `var`, deliberately: the resize handler below can fire while
     hide_controls has already returned out of this IIFE, in which case the
     `const touch` overlay object further down was never evaluated and
     touching it would throw a TDZ ReferenceError on every resize. */
  var _layoutHook = null;

  function _syncOrientation(quiet) {
    const p = _isPortrait();
    const changed = p !== DEVICE.portrait;
    DEVICE.portrait = p;
    const el = document.documentElement;
    if (el) {
      el.classList.add(p ? "ffg-portrait" : "ffg-landscape");
      el.classList.remove(p ? "ffg-landscape" : "ffg-portrait");
    }
    if (changed && !quiet) {
      _fire("ffg:orientation", { portrait: p, device: DEVICE });
      if (_layoutHook) _layoutHook();
    }
  }

  _retry(function applyDeviceClasses() {
    const el = document.documentElement;
    if (!el) return false;
    const cl = el.classList;
    cl.add(DEVICE.touch ? "ffg-touch" : "ffg-desktop");
    cl.remove(DEVICE.touch ? "ffg-desktop" : "ffg-touch");
    if (DEVICE.mobile) cl.add("ffg-mobile");
    _syncOrientation(true);
    return true;
  });

  window.addEventListener("resize", function () { _syncOrientation(false); });
  window.addEventListener("orientationchange", function () {
    // iOS reports the OLD innerWidth/innerHeight for a beat after the event.
    setTimeout(function () { _syncOrientation(false); }, 120);
  });

  // Fired now for anything already listening, and again at DOMContentLoaded
  // for a game whose <script> had not run yet. Idempotent: the detail is the
  // same object every time, and the authoritative read is window.FFG_DEVICE.
  _fire("ffg:device", DEVICE);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { _fire("ffg:device", DEVICE); }, { once: true });
  }

  // ─── Stylesheet: hint hiding + touch page hygiene + overlay chrome ──
  _retry(function injectCss() {
    const head = document.head || document.documentElement;
    if (!head) return false;
    if (document.getElementById("__ffg_device_css__")) return true;
    const s = document.createElement("style");
    s.id = "__ffg_device_css__";
    s.textContent = [
      /* The convention documented in the header: a game marks its keyboard
         hints and they vanish on a phone. We deliberately do NOT guess at
         arbitrary game text — hiding every element containing "WASD" would
         take HUDs with it. */
      "html.ffg-touch [data-desktop-only],html.ffg-touch .desktop-only,html.ffg-touch .kbd-hint{display:none!important}",
      "html.ffg-desktop [data-touch-only],html.ffg-desktop .touch-only{display:none!important}",
      /* Touch page hygiene: double-tap zoom, rubber-band scroll, the iOS
         selection callout and the grey tap flash all make a game feel broken.
         Scoped to touch devices, so desktop rendering is untouched. */
      "html.ffg-touch,html.ffg-touch body{touch-action:manipulation;overscroll-behavior:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}",
      "html.ffg-touch input,html.ffg-touch textarea{-webkit-user-select:auto;user-select:auto}",
      /* Overlay chrome. The container never takes a tap (pointer-events:none)
         so the game canvas underneath stays fully reachable; only the
         controls themselves opt back in. */
      "#__ffg_touch__{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483500;pointer-events:none;touch-action:none;-webkit-user-select:none;user-select:none;font-family:system-ui,-apple-system,sans-serif}",
      "#__ffg_touch__ .ffgt{position:fixed;pointer-events:auto;touch-action:none}",
      "#__ffg_touch__ .ffgt-stick{border-radius:50%;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.10),rgba(255,255,255,.045) 62%,rgba(255,255,255,0) 64%);border:2px solid rgba(255,255,255,.22);box-shadow:0 2px 14px rgba(0,0,0,.35)}",
      "#__ffg_touch__ .ffgt-knob{position:absolute;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.45);box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none;transition:transform .05s linear}",
      "#__ffg_touch__ .ffgt-btn{display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.13);border:2px solid rgba(255,255,255,.3);color:#fff;font-weight:700;letter-spacing:.02em;text-shadow:0 1px 3px rgba(0,0,0,.6);box-shadow:0 2px 12px rgba(0,0,0,.35)}",
      "#__ffg_touch__ .ffgt-btn.ffgt-on{background:rgba(255,255,255,.34);transform:scale(.93)}",
      "#__ffg_touch__ .ffgt-look{background:transparent;border:0}",
    ].join("\n");
    head.appendChild(s);
    return true;
  });

  if (CFG.hide_controls === true) return;

  // ─── Build the bar ──────────────────────────────────────────────
  function _makeBar() {
    const bar = document.createElement("div");
    bar.id = "__ff_controls__";
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

  // ════════════════════════════════════════════════════════════════
  //  v3 §2 — SYNTHETIC INPUT
  //  Everything below is inert unless the touch overlay mounts.
  // ════════════════════════════════════════════════════════════════

  /* Key table. `keyCode` is legacy but plenty of game code here still reads
     it, so every synthesized event carries a correct one. Some engines drop
     keyCode/which from the KeyboardEvent init dict, which is why _mkKey
     re-installs them with defineProperty when they did not stick. */
  const NAMED_KEYS = {
    space: { key: " ", code: "Space", keyCode: 32 },
    enter: { key: "Enter", code: "Enter", keyCode: 13 },
    tab: { key: "Tab", code: "Tab", keyCode: 9 },
    escape: { key: "Escape", code: "Escape", keyCode: 27 },
    esc: { key: "Escape", code: "Escape", keyCode: 27 },
    backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    "delete": { key: "Delete", code: "Delete", keyCode: 46 },
    shift: { key: "Shift", code: "ShiftLeft", keyCode: 16, mod: "shiftKey" },
    shiftleft: { key: "Shift", code: "ShiftLeft", keyCode: 16, mod: "shiftKey" },
    control: { key: "Control", code: "ControlLeft", keyCode: 17, mod: "ctrlKey" },
    ctrl: { key: "Control", code: "ControlLeft", keyCode: 17, mod: "ctrlKey" },
    controlleft: { key: "Control", code: "ControlLeft", keyCode: 17, mod: "ctrlKey" },
    alt: { key: "Alt", code: "AltLeft", keyCode: 18, mod: "altKey" },
    altleft: { key: "Alt", code: "AltLeft", keyCode: 18, mod: "altKey" },
    arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  };

  function _letterKey(c) {
    const up = c.toUpperCase();
    return { key: c.toLowerCase(), code: "Key" + up, keyCode: up.charCodeAt(0) };
  }
  function _digitKey(d) {
    return { key: String(d), code: "Digit" + d, keyCode: 48 + Number(d) };
  }

  /** 'Space' | 'KeyW' | 'w' | 'ArrowUp' | 'Digit1' | '1' | 'Shift' -> descriptor */
  function _keySpec(spec) {
    if (!spec) return null;
    const low = String(spec).toLowerCase();
    if (NAMED_KEYS[low]) return NAMED_KEYS[low];
    let m = /^key([a-z])$/.exec(low);
    if (m) return _letterKey(m[1]);
    m = /^digit([0-9])$/.exec(low);
    if (m) return _digitKey(m[1]);
    if (/^[a-z]$/.test(low)) return _letterKey(low);
    if (/^[0-9]$/.test(low)) return _digitKey(low);
    return null;
  }

  /** 'Mouse0' | 'LMB' | 'Mouse2' | 'RMB' -> button number, else -1 */
  function _mouseSpec(spec) {
    if (!spec) return -1;
    const low = String(spec).toLowerCase();
    if (low === "lmb" || low === "mouse0" || low === "click") return 0;
    if (low === "mmb" || low === "mouse1") return 1;
    if (low === "rmb" || low === "mouse2") return 2;
    return -1;
  }

  // Modifier keys currently held by a touch button, mirrored onto every
  // synthesized event so `if (e.shiftKey)` sprint checks still work.
  const mods = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

  /* The one element keyboard events are dispatched at. document.body bubbles
     to document AND window (see header). If a game focused a canvas with
     tabindex, real key events would target that — but the ForgeFlow games
     listen on window or document, so body is the safe common ancestor. */
  function _keyTarget() { return document.body || document.documentElement || document; }

  /** The game's drawing surface, for mouse/pointer events. */
  function _surface() {
    if (touch.surface && touch.surface.isConnected) return touch.surface;
    touch.surface = document.querySelector("canvas") || document.body || document.documentElement;
    return touch.surface;
  }

  function _mkKey(type, k) {
    const init = {
      key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode,
      bubbles: true, cancelable: true, composed: true, view: window,
      shiftKey: mods.shiftKey || k.mod === "shiftKey",
      ctrlKey: mods.ctrlKey || k.mod === "ctrlKey",
      altKey: mods.altKey || k.mod === "altKey",
      metaKey: false,
    };
    let e;
    try {
      e = new KeyboardEvent(type, init);
    } catch (err) {
      e = document.createEvent("Event");
      e.initEvent(type, true, true);
      e.key = k.key; e.code = k.code;
    }
    if (e.keyCode !== k.keyCode) {
      try { Object.defineProperty(e, "keyCode", { get: function () { return k.keyCode; } }); } catch (x) {}
      try { Object.defineProperty(e, "which", { get: function () { return k.keyCode; } }); } catch (x) {}
    }
    try { e.__ffgSynthetic = true; } catch (x) {}
    return e;
  }

  const heldKeys = Object.create(null);   // code -> descriptor

  function pressKey(spec) {
    const k = _keySpec(spec);
    if (!k || heldKeys[k.code]) return false;
    heldKeys[k.code] = k;
    if (k.mod) mods[k.mod] = true;
    _keyTarget().dispatchEvent(_mkKey("keydown", k));
    return true;
  }
  function releaseKey(spec) {
    const k = _keySpec(spec);
    if (!k || !heldKeys[k.code]) return false;
    delete heldKeys[k.code];
    if (k.mod) mods[k.mod] = false;
    _keyTarget().dispatchEvent(_mkKey("keyup", k));
    return true;
  }
  /* The worst failure mode of a synthetic stick is a key that never comes
     back up: the player's character walks into a wall forever. Every exit
     path funnels through here. */
  function releaseAllKeys() {
    const codes = Object.keys(heldKeys);
    for (let i = 0; i < codes.length; i++) releaseKey(codes[i]);
    releaseAllMouse();
  }

  // ─── Mouse / pointer synthesis ──────────────────────────────────
  const heldMouse = Object.create(null);   // button -> true
  const lookPos = { x: 0, y: 0, has: false };

  function _btnMask() {
    let m = 0;
    if (heldMouse[0]) m |= 1;
    if (heldMouse[2]) m |= 2;
    if (heldMouse[1]) m |= 4;
    return m;
  }

  function _mkMouse(type, x, y, button, dx, dy) {
    const init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: button < 0 ? 0 : button, buttons: _btnMask(),
      movementX: dx || 0, movementY: dy || 0,
      shiftKey: mods.shiftKey, ctrlKey: mods.ctrlKey, altKey: mods.altKey,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      width: 1, height: 1, pressure: button >= 0 ? 0.5 : 0,
    };
    let e;
    const wantPointer = type.indexOf("pointer") === 0;
    try {
      e = (wantPointer && window.PointerEvent) ? new PointerEvent(type, init) : new MouseEvent(type, init);
    } catch (err) {
      try { e = new MouseEvent(type.replace("pointer", "mouse"), init); } catch (x2) { return null; }
    }
    if (e.movementX !== init.movementX) {
      try { Object.defineProperty(e, "movementX", { get: function () { return init.movementX; } }); } catch (x) {}
      try { Object.defineProperty(e, "movementY", { get: function () { return init.movementY; } }); } catch (x) {}
    }
    try { e.__ffgSynthetic = true; } catch (x) {}
    return e;
  }

  function _emitMouse(types, x, y, button, dx, dy, target) {
    const t = target || _surface();
    for (let i = 0; i < types.length; i++) {
      const ev = _mkMouse(types[i], x, y, button, dx, dy);
      if (ev) t.dispatchEvent(ev);
    }
  }

  // Where an aim-less action button "clicks": wherever the look finger last
  // was, else the middle of the screen — which is where a mouse-look game's
  // crosshair sits anyway.
  function _defaultAimX() { return lookPos.has ? lookPos.x : Math.round((window.innerWidth || 0) / 2); }
  function _defaultAimY() { return lookPos.has ? lookPos.y : Math.round((window.innerHeight || 0) / 2); }

  function pressMouse(button, x, y) {
    if (heldMouse[button]) return;
    heldMouse[button] = true;
    _emitMouse(["pointerdown", "mousedown"], x == null ? _defaultAimX() : x, y == null ? _defaultAimY() : y, button, 0, 0);
  }
  function releaseMouse(button, x, y) {
    if (!heldMouse[button]) return;
    delete heldMouse[button];
    _emitMouse(["pointerup", "mouseup"], x == null ? _defaultAimX() : x, y == null ? _defaultAimY() : y, button, 0, 0);
  }
  function releaseAllMouse() {
    Object.keys(heldMouse).forEach(function (b) { releaseMouse(Number(b)); });
  }

  /** Replay a tap the overlay swallowed onto whatever is really underneath. */
  function forwardTap(x, y) {
    let under = null;
    const root = touch.root;
    if (root) {
      // elementFromPoint would return the look zone itself; step out of the
      // way for exactly one hit-test.
      const prevRoot = root.style.pointerEvents;
      const prevLook = touch.lookEl ? touch.lookEl.style.pointerEvents : null;
      root.style.pointerEvents = "none";
      if (touch.lookEl) touch.lookEl.style.pointerEvents = "none";
      try { under = document.elementFromPoint(x, y); } catch (e) {}
      root.style.pointerEvents = prevRoot;
      if (touch.lookEl) touch.lookEl.style.pointerEvents = prevLook;
    }
    const t = under || _surface();
    heldMouse[0] = true;
    _emitMouse(["pointerdown", "mousedown"], x, y, 0, 0, 0, t);
    delete heldMouse[0];
    _emitMouse(["pointerup", "mouseup", "click"], x, y, 0, 0, 0, t);
  }

  // ════════════════════════════════════════════════════════════════
  //  v3 §3 — PER-GAME PROFILES
  //  The table lives HERE, not in 29 game files: one pipeline edit
  //  configures every game and no game source is touched.
  //  Schemes transcribed from the registry's controls_keyboard field.
  // ════════════════════════════════════════════════════════════════
  function B(label, key, side) { return { label: label, key: key, side: side || "right" }; }

  const DEFAULT_TOUCH = {
    stick: "both",          // emit WASD *and* arrows: a game bound to either responds
    stickKeys: null,
    stickAxis: "both",
    look: false,
    lookSensitivity: 1,
    buttons: [B("␣", "Space")],   // U+2423 OPEN BOX — one primary action
    tapToClick: true,
    deadzone: 0.30,
    enabled: true,
    force: false,
  };

  /* Archetypes. Grouping beats 29 bespoke blocks: a fix to "shooter" fixes
     every shooter. `enabled:false` means the game already ships its OWN touch
     UI and the universal overlay must stay out of its way. */
  const ARCHETYPES = {
    // The game has its own on-screen controls — do not add a second stick.
    native:       { enabled: false },

    /* Pointer-driven 3D board games. They already work on a phone and the
       overlay must not "help": their canvas takes `pointerdown` (which fires
       natively for touch) and their camera is THREE.OrbitControls, which has
       built-in one-finger rotate and two-finger dolly. A stick, or a
       synthesized right-drag, would double-drive that camera. */
    board:        { stick: false, look: false, buttons: [], tapToClick: true },

    // Tower defence / build-and-place: taps already work, so supply only the
    // keys that are unreachable by touch.
    strategy:     { stick: false, look: false,
                    buttons: [B("WAVE", "Space"), B("UPG", "KeyU"), B("SELL", "KeyX")] },

    // Sandbox builders: WASD pans the camera, taps place.
    builder:      { stick: "wasd", stickAxis: "both", look: false, buttons: [] },

    // Platformers: move + jump, nothing else.
    platformer:   { stick: "both", buttons: [B("JUMP", "Space")] },

    // Paddle games: horizontal only, so a thumb slide never nudges Y.
    paddle:       { stick: "both", stickAxis: "x", buttons: [B("GO", "Space")] },

    // Side-view action with mouse aiming. The look zone carries clientX/Y as
    // well as movementX/Y, so absolute aim works too.
    sidescroller: { stick: "both", stickAxis: "x", look: true,
                    buttons: [B("USE", "Mouse0"), B("JUMP", "Space"), B("INV", "KeyI")] },

    // Twin-stick: left thumb moves, right thumb aims, one button fires.
    twinstick:    { stick: "both", look: true, buttons: [B("FIRE", "Mouse0")] },

    // FPS/TPS: move + look + fire/jump/reload. Deliberately 3 buttons, not 9.
    shooter:      { stick: "wasd", look: true,
                    buttons: [B("FIRE", "Mouse0"), B("JUMP", "Space"), B("RELOAD", "KeyR")] },

    // Melee action whose orbit camera is bound to the RIGHT mouse button,
    // which a finger cannot express — no look zone, so the camera stays put
    // rather than being half-driven.
    action:       { stick: "wasd", look: false,
                    buttons: [B("ATK", "Mouse0"), B("1", "Digit1"), B("2", "Digit2"), B("DODGE", "Shift")] },

    // Driving: steering on the stick's X axis, throttle/brake as hold buttons.
    racer:        { stick: "both", stickAxis: "x",
                    buttons: [B("GAS", "KeyW"), B("BRK", "KeyS"), B("JUMP", "Space"), B("ITEM", "KeyE")] },

    // Sailing: W/S throttle and A/D helm both live on the one stick.
    sailer:       { stick: "wasd", look: false,
                    buttons: [B("FIRE", "Space"), B("DOCK", "KeyE")] },

    // Open-world adventure: drag-to-look plus attack/jump/run.
    adventure:    { stick: "wasd", look: true,
                    buttons: [B("ATK", "Mouse0"), B("JUMP", "Space"), B("RUN", "Shift")] },
  };

  /* slug -> archetype name, or [archetype, {overrides}] for the handful of
     games needing one or two different buttons. The 29 published games as of
     2026-09-15; an unknown slug falls back to DEFAULT_TOUCH.
     Games with many number keys (1-8 towers, 1-6 weapons) get the one or two
     that matter for basic play — a nine-key pad on a phone is unusable. */
  const PROFILES = {
    // ── already ship their own touch UI (verified in their source) ──
    "ascendant": "native",        // runtime/core/input.js builds a stick + buttons
    "cosmic-coils": "native",     // runtime/3d/hud.js builds a stick
    "thronedrift": "native",      // runtime/ui/hud.js pipes a joystick into input.js

    // ── tap-driven board games (OrbitControls camera + pointerdown picks) ──
    "checkers": "board",
    "backgammon": "board",
    "dominoes": "board",
    "rummikub": "board",
    "warboard-chess": "board",
    "mahjong": ["board", { buttons: [B("HINT", "KeyH"), B("MIX", "KeyS")] }],
    "iron-tide": ["board", { buttons: [B("ROT", "KeyR"), B("AUTO", "KeyA")] }],
    "tide-breakers": ["board", { buttons: [B("↺", "KeyQ"), B("↻", "KeyE")] }],
    "arcane-realms": ["board", { buttons: [B("PHASE", "Space")] }],

    // ── build / place ──
    "bastion-realms": "strategy",
    "siegeheart": "strategy",
    "dungeon-forge": ["builder", { buttons: [B("USE", "Mouse0"), B("ROT", "KeyR"), B("FLOOR", "Tab")] }],
    "luminascape": "builder",

    // ── platformers / paddles ──
    "skybattle": "platformer",
    "block-breaker": ["paddle", { buttons: [B("LAUNCH", "Space")] }],
    "edge-keeper": ["paddle", { buttons: [B("1", "Digit1"), B("2", "Digit2"), B("3", "Digit3")] }],
    "understone": "sidescroller",

    // ── shooters / action ──
    "vector-storm": "twinstick",
    "last-circle": "shooter",
    "blackridge": "shooter",
    "neon-veil": ["shooter", { buttons: [B("FIRE", "Mouse0"), B("BURN", "Mouse2"), B("SHLD", "KeyF")] }],
    "ember-sanctum": "action",
    "ashwall-nights": ["shooter", { buttons: [B("ATK", "Mouse0"), B("Q", "KeyQ"), B("E", "KeyE")] }],

    // ── vehicles / open world ──
    "grid-rush": "racer",
    "pirates-cove": "sailer",
    "wanderwild": "adventure",
  };

  /** Slug from /games/<slug>/index.html (CDN and local shotserver agree). */
  function _detectSlug() {
    try {
      const qs = (window.location.search || "").match(/[?&]ffg_slug=([A-Za-z0-9_-]+)/);
      if (qs) return qs[1];
      const cfgNow = window.GAME_CONFIG || CFG;
      if (cfgNow && cfgNow.slug) return String(cfgNow.slug);
      const path = window.location.pathname || "";
      const m = /\/games\/([^\/?#]+)/.exec(path);
      if (m) return decodeURIComponent(m[1]);
      // Fallback: last directory segment (a game served at its own root).
      const parts = path.split("/").filter(function (p) { return p && p.indexOf(".") === -1; });
      if (parts.length) return decodeURIComponent(parts[parts.length - 1]);
    } catch (e) {}
    return null;
  }

  function _assign(dst, src) {
    if (!src) return dst;
    for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k];
    return dst;
  }

  /* Read the config LATE (at mount), not at IIFE time: a game's inline
     <script> setting GAME_CONFIG may run after this file in some page
     layouts, and the overlay does not exist until the DOM does anyway. */
  function _resolveTouchConfig() {
    const slug = _detectSlug();
    const cfgNow = window.GAME_CONFIG || CFG;
    const cfg = _assign({}, DEFAULT_TOUCH);
    cfg.slug = slug;
    cfg.profile = "default";

    let entry = slug ? PROFILES[slug] : null;
    if (typeof entry === "string") entry = [entry, null];
    if (entry) {
      const arch = ARCHETYPES[entry[0]];
      if (arch) { _assign(cfg, arch); cfg.profile = entry[0]; }
      if (entry[1]) _assign(cfg, entry[1]);
    }
    // A game's own GAME_CONFIG.touch always wins over the table.
    const own = cfgNow ? cfgNow.touch : undefined;
    if (own === false) { cfg.enabled = false; cfg.profile += "+off"; }
    else if (own && typeof own === "object") { _assign(cfg, own); cfg.profile += "+config"; }
    if (cfgNow && cfgNow.hide_controls === true) cfg.enabled = false;
    try {
      const q = window.location.search || "";
      if (/[?&]ffg_touch=1/.test(q)) cfg.force = true;
      if (/[?&]ffg_touch=0/.test(q)) cfg.enabled = false;
    } catch (e) {}
    return cfg;
  }

  // ════════════════════════════════════════════════════════════════
  //  v3 §4 — THE TOUCH OVERLAY
  // ════════════════════════════════════════════════════════════════
  const touch = {
    root: null, stickEl: null, knobEl: null, lookEl: null, btnWrap: null,
    surface: null, cfg: null, active: false,
    stickTouch: null, lookTouch: null,
    stickCx: 0, stickCy: 0, stickR: 56,
    lookX: 0, lookY: 0, lookStartX: 0, lookStartY: 0, lookStartT: 0, lookMoved: false,
    dirs: { up: false, down: false, left: false, right: false },
    layout: null,
  };

  function _stickCodes(cfg) {
    if (cfg.stickKeys) {
      return [{
        up: cfg.stickKeys.up, down: cfg.stickKeys.down,
        left: cfg.stickKeys.left, right: cfg.stickKeys.right,
      }];
    }
    const wasd = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" };
    const arrows = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
    if (cfg.stick === "wasd") return [wasd];
    if (cfg.stick === "arrows") return [arrows];
    return [wasd, arrows];   // 'both' — a game bound to either responds
  }

  function _touchById(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  function buildOverlay(cfg) {
    if (touch.root) return;
    touch.cfg = cfg;

    const root = document.createElement("div");
    root.id = "__ffg_touch__";
    touch.root = root;

    /* Contain the overlay's OWN native pointer/mouse traffic. A finger on the
       thumbstick still produces a real pointerdown on that div, which bubbles
       all the way to window — and a game that fires on `window` pointerdown
       (vector-storm, checkers' audio arm) would then fire every time the
       player steers. Stop propagation at the container: the only events that
       escape this overlay are the ones we deliberately synthesize, which are
       dispatched outside it. preventDefault is NOT called here — the controls'
       own touch handlers still need their default behaviour. */
    ["pointerdown", "pointerup", "pointermove", "pointercancel",
     "mousedown", "mouseup", "mousemove", "click", "dblclick"].forEach(function (t) {
      root.addEventListener(t, function (e) { e.stopPropagation(); });
    });

    // ── LOOK zone first, so buttons drawn on top of it win a tap ──
    if (cfg.look) {
      const look = document.createElement("div");
      look.className = "ffgt ffgt-look";
      look.style.cssText = "top:0;right:0;bottom:0;width:60%";
      touch.lookEl = look;
      root.appendChild(look);
      look.addEventListener("touchstart", onLookStart, { passive: false });
    }

    // ── thumbstick, bottom-left ──
    if (cfg.stick !== false || cfg.stickKeys) {
      const st = document.createElement("div");
      st.className = "ffgt ffgt-stick";
      const knob = document.createElement("div");
      knob.className = "ffgt-knob";
      st.appendChild(knob);
      touch.stickEl = st; touch.knobEl = knob;
      root.appendChild(st);
      st.addEventListener("touchstart", onStickStart, { passive: false });
    }

    // ── action buttons, bottom-right, clear of the #__ff_controls__ bar ──
    const list = cfg.buttons || [];
    if (list.length) {
      const wrap = document.createElement("div");
      wrap.className = "ffgt";
      // bottom:54px — the control bar occupies roughly y 8..42. Never overlap it.
      wrap.style.cssText = "right:12px;bottom:54px;display:flex;flex-direction:row-reverse;flex-wrap:wrap-reverse;justify-content:flex-start;gap:10px;width:154px;background:none;pointer-events:none";
      touch.btnWrap = wrap;
      for (let i = 0; i < list.length; i++) wrap.appendChild(makeTouchBtn(list[i]));
      root.appendChild(wrap);
    }

    _retry(function () {
      if (!document.body) return false;
      if (!document.getElementById("__ffg_touch__")) document.body.appendChild(root);
      layout();
      return true;
    });

    touch.layout = layout;
    _layoutHook = layout;
    touch.active = true;
    _fire("ffg:touch", { config: cfg });
  }

  function makeTouchBtn(spec) {
    const b = document.createElement("div");
    b.className = "ffgt-btn";
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", spec.label || spec.key);
    b.textContent = spec.label || "";
    const big = (spec.label || "").length <= 2;
    b.style.cssText = "width:66px;height:66px;font-size:" + (big ? "22px" : "13px") + ";pointer-events:auto;touch-action:none";
    const mouseBtn = _mouseSpec(spec.key);

    function down(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (b.__ffgHeld) return;
      b.__ffgHeld = true;
      b.classList.add("ffgt-on");
      if (mouseBtn >= 0) pressMouse(mouseBtn);
      else pressKey(spec.key);
    }
    function up(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (!b.__ffgHeld) return;
      b.__ffgHeld = false;
      b.classList.remove("ffgt-on");
      if (mouseBtn >= 0) releaseMouse(mouseBtn);
      else releaseKey(spec.key);
    }
    b.addEventListener("touchstart", down, { passive: false });
    b.addEventListener("touchend", up, { passive: false });
    b.addEventListener("touchcancel", up, { passive: false });
    b.__ffgRelease = up;
    return b;
  }

  function layout() {
    const cfg = touch.cfg;
    if (!cfg) return;
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    if (touch.stickEl) {
      // Scale with the SMALLER viewport edge, so a phone held in landscape
      // does not get a stick that eats a third of the screen.
      const size = Math.max(104, Math.min(150, Math.round(Math.min(vw, vh) * 0.34)));
      const pad = Math.round(size * 0.14);
      touch.stickEl.style.width = size + "px";
      touch.stickEl.style.height = size + "px";
      touch.stickEl.style.left = pad + "px";
      touch.stickEl.style.bottom = pad + "px";
      const kn = Math.round(size * 0.42);
      touch.knobEl.style.width = kn + "px";
      touch.knobEl.style.height = kn + "px";
      touch.knobEl.style.left = Math.round(size / 2 - kn / 2) + "px";
      touch.knobEl.style.top = Math.round(size / 2 - kn / 2) + "px";
      touch.stickR = size / 2;
      const r = touch.stickEl.getBoundingClientRect();
      touch.stickCx = r.left + r.width / 2;
      touch.stickCy = r.top + r.height / 2;
    }
  }

  // ─── thumbstick ─────────────────────────────────────────────────
  function onStickStart(e) {
    if (touch.stickTouch !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    e.preventDefault();
    touch.stickTouch = t.identifier;
    const r = touch.stickEl.getBoundingClientRect();
    touch.stickCx = r.left + r.width / 2;
    touch.stickCy = r.top + r.height / 2;
    updateStick(t.clientX, t.clientY);
  }

  function updateStick(x, y) {
    const cfg = touch.cfg;
    let dx = (x - touch.stickCx) / touch.stickR;
    let dy = (y - touch.stickCy) / touch.stickR;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    if (cfg.stickAxis === "x") dy = 0;
    if (cfg.stickAxis === "y") dx = 0;

    if (touch.knobEl) {
      touch.knobEl.style.transform = "translate(" + (dx * touch.stickR * 0.62).toFixed(1) + "px," + (dy * touch.stickR * 0.62).toFixed(1) + "px)";
    }

    // Per-AXIS threshold rather than a radial deadzone: a radial one makes
    // diagonals — the useful part of an 8-way stick — hard to hold.
    const dz = cfg.deadzone;
    setDir("left", dx < -dz);
    setDir("right", dx > dz);
    setDir("up", dy < -dz);
    setDir("down", dy > dz);
  }

  function setDir(dir, on) {
    if (touch.dirs[dir] === on) return;
    touch.dirs[dir] = on;
    const maps = _stickCodes(touch.cfg);
    for (let i = 0; i < maps.length; i++) {
      const code = maps[i][dir];
      if (!code) continue;
      if (on) pressKey(code); else releaseKey(code);
    }
  }

  function endStick() {
    if (touch.stickTouch === null) return;
    touch.stickTouch = null;
    if (touch.knobEl) touch.knobEl.style.transform = "translate(0,0)";
    setDir("up", false); setDir("down", false); setDir("left", false); setDir("right", false);
  }

  // ─── look zone ──────────────────────────────────────────────────
  function onLookStart(e) {
    if (touch.lookTouch !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    e.preventDefault();
    touch.lookTouch = t.identifier;
    touch.lookX = t.clientX; touch.lookY = t.clientY;
    touch.lookStartX = t.clientX; touch.lookStartY = t.clientY;
    touch.lookStartT = Date.now();
    touch.lookMoved = false;
    lookPos.x = t.clientX; lookPos.y = t.clientY; lookPos.has = true;
  }

  function updateLook(t) {
    const s = touch.cfg.lookSensitivity || 1;
    const dx = (t.clientX - touch.lookX) * s;
    const dy = (t.clientY - touch.lookY) * s;
    touch.lookX = t.clientX; touch.lookY = t.clientY;
    lookPos.x = t.clientX; lookPos.y = t.clientY; lookPos.has = true;
    if (Math.abs(t.clientX - touch.lookStartX) > 8 || Math.abs(t.clientY - touch.lookStartY) > 8) touch.lookMoved = true;
    if (!dx && !dy) return;
    _emitMouse(["pointermove", "mousemove"], t.clientX, t.clientY, -1, dx, dy);
  }

  function endLook(cancelled) {
    if (touch.lookTouch === null) return;
    const wasTap = !touch.lookMoved && (Date.now() - touch.lookStartT) < 400;
    touch.lookTouch = null;
    if (!cancelled && wasTap && touch.cfg.tapToClick !== false) {
      // The look zone is the ONLY place the overlay swallows a game-surface
      // tap, so it is the only place a tap has to be replayed. See header.
      forwardTap(touch.lookStartX, touch.lookStartY);
    }
  }

  // ─── global touch routing ───────────────────────────────────────
  function onDocMove(e) {
    let used = false;
    const ch = e.changedTouches;
    if (touch.stickTouch !== null) {
      const t = _touchById(ch, touch.stickTouch);
      if (t) { updateStick(t.clientX, t.clientY); used = true; }
    }
    if (touch.lookTouch !== null) {
      const t = _touchById(ch, touch.lookTouch);
      if (t) { updateLook(t); used = true; }
    }
    // Only fight the browser for gestures we actually own; a game doing its
    // own pinch or scroll elsewhere on the page is left alone.
    if (used && e.cancelable) e.preventDefault();
  }

  function onDocEnd(e) {
    const ch = e.changedTouches;
    const cancelled = e.type === "touchcancel";
    if (touch.stickTouch !== null && _touchById(ch, touch.stickTouch)) endStick();
    if (touch.lookTouch !== null && _touchById(ch, touch.lookTouch)) endLook(cancelled);
    // A touchcancel means the OS took the gesture away mid-drag (a call, a
    // system swipe). Nothing else will tell us those fingers are gone, so
    // drop EVERY held key, not just the tracked ones.
    if (cancelled) panicRelease();
  }

  function panicRelease() {
    endStick();
    if (touch.lookTouch !== null) endLook(true);
    if (touch.btnWrap) {
      const kids = touch.btnWrap.children;
      for (let i = 0; i < kids.length; i++) if (kids[i].__ffgRelease) kids[i].__ffgRelease(null);
    }
    releaseAllKeys();
  }

  function attachTouchRouting() {
    document.addEventListener("touchmove", onDocMove, { passive: false });
    document.addEventListener("touchend", onDocEnd, { passive: false });
    document.addEventListener("touchcancel", onDocEnd, { passive: false });
    // Every way a finger can stop existing without a touchend. A stuck "W" is
    // the worst bug this layer can ship, so all of them release.
    window.addEventListener("blur", panicRelease);
    window.addEventListener("pagehide", panicRelease);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) panicRelease();
    });
  }

  // ─── decide whether to mount ────────────────────────────────────
  const touchCfg = _resolveTouchConfig();

  /* A profile can resolve to "no controls at all" — the board games, whose
     native pointer/OrbitControls handling is already correct. Build nothing
     in that case: an empty container is harmless but the non-passive
     document touchmove listener it comes with is a needless tax on every
     swipe of a game that does its own panning. */
  function _hasControls(cfg) {
    return !!((cfg.stick !== false || cfg.stickKeys) || cfg.look || (cfg.buttons && cfg.buttons.length));
  }

  function startTouchLayer() {
    if (touch.root || !touchCfg.enabled) return;
    if (!_hasControls(touchCfg)) return;
    buildOverlay(touchCfg);
    attachTouchRouting();
  }

  if (touchCfg.enabled) {
    if (MOUNT_MODE === "now" || touchCfg.force) {
      startTouchLayer();
    } else if (MOUNT_MODE === "onTouch") {
      // Hybrid device: arm on the first real touch. Never take the mouse away
      // from someone who is still using one.
      const arm = function () {
        window.removeEventListener("touchstart", arm, true);
        startTouchLayer();
      };
      window.addEventListener("touchstart", arm, true);
    }
  }
  // MOUNT_MODE 'never' (a desktop): none of the above runs, and the only
  // trace this whole section leaves is window.FFG_DEVICE plus the
  // html.ffg-desktop class.

  // ─── Public API ─────────────────────────────────────────────────
  window.FFG_TOUCH = {
    config: touchCfg,
    device: DEVICE,
    isActive: function () { return !!touch.active; },
    press: pressKey,
    release: releaseKey,
    releaseAll: releaseAllKeys,
    heldKeys: function () { return Object.keys(heldKeys); },
    heldMouse: function () { return Object.keys(heldMouse).map(Number); },
    show: function () { touchCfg.enabled = true; startTouchLayer(); },
    hide: function () {
      panicRelease();
      if (touch.root && touch.root.parentNode) touch.root.parentNode.removeChild(touch.root);
      touch.root = null; touch.active = false;
    },
  };

  window.__CONTROLS__ = {
    toggleFullscreen: toggleFullscreen,
    toggleMute: toggleMute,
    isMuted: function () { return state.muted; },
    isFullscreen: isFullscreen,
    reportBug: reportBug,
    device: DEVICE,
    touch: window.FFG_TOUCH,
  };
})();
