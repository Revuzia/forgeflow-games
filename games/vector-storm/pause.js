/* ForgeFlow Games — pause.js
 * Universal pause system — injected into EVERY game.
 *
 * Triggers: ESC key, P key, or mobile pause button.
 * When paused:
 *   - Phaser 3 games: calls scene.scene.pause() / resume() for the active scene
 *   - Three.js games: stops the game's requestAnimationFrame loop (via window.__PAUSE_FLAG__)
 *   - 2D Canvas games: sets window.__PAUSE_FLAG__ = true; game loop must check it
 *   - Audio: pauses all <audio> elements + AudioContext
 *
 * Games can integrate by:
 *   a) Reading `window.__PAUSE_FLAG__` in their main loop (if true, skip update/render)
 *   b) Listening for `paused` / `resumed` DOM events dispatched on window
 *   c) Auto-detected for Phaser 3 (scene.scene.pause/resume)
 *
 * UI: overlay with "PAUSED" + "Resume (ESC)" button. Dismissable.
 * Accessibility: auto-pauses on tab/window blur (no progress lost).
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.__PAUSE__) return;  // already installed

  const state = {
    paused: false,
    overlay: null,
    suspendedAudioCtx: null,
  };

  window.__PAUSE_FLAG__ = false;

  // ─── Build overlay ──────────────────────────────────────────────
  function _buildOverlay() {
    const el = document.createElement("div");
    el.id = "__pause_overlay__";
    el.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483640",
      "display:none", "align-items:center", "justify-content:center",
      "flex-direction:column", "gap:18px",
      "background:rgba(0,0,0,0.72)", "backdrop-filter:blur(6px)",
      "font-family:system-ui,-apple-system,sans-serif", "color:#fff",
      "pointer-events:auto", "user-select:none",
    ].join(";");
    el.innerHTML =
      '<div style="font-size:56px;font-weight:900;letter-spacing:4px;text-shadow:0 2px 14px rgba(0,0,0,.5)">PAUSED</div>' +
      '<button id="__pause_resume__" style="padding:14px 40px;font-size:18px;font-weight:700;border:none;border-radius:12px;cursor:pointer;background:linear-gradient(135deg,#00d4ff,#00a8cc);color:#fff;box-shadow:0 4px 20px rgba(0,212,255,0.4)">Resume (ESC)</button>' +
      '<div style="font-size:13px;color:#aaa">Press <b>ESC</b> or <b>P</b> to resume</div>';
    el.addEventListener("click", function (e) {
      if (e.target.id === "__pause_resume__" || e.target === el) {
        resume();
      }
    });
    document.body.appendChild(el);
    return el;
  }

  // ─── Core pause / resume ────────────────────────────────────────
  function pause() {
    if (state.paused) return;
    state.paused = true;
    window.__PAUSE_FLAG__ = true;

    if (!state.overlay) state.overlay = _buildOverlay();
    state.overlay.style.display = "flex";

    // Phaser 3 auto-pause
    try {
      const game = window.game || window.phaserGame || window.__PHASER__;
      if (game && game.scene && game.scene.scenes) {
        for (const s of game.scene.scenes) {
          if (s && s.scene && s.scene.isActive && s.scene.isActive()) {
            s.scene.pause();
          }
        }
      }
    } catch (e) {}

    // Pause all <audio>
    try {
      document.querySelectorAll("audio").forEach(function (a) {
        if (!a.paused) { a._wasPlaying = true; a.pause(); }
      });
    } catch (e) {}

    // Suspend AudioContext if any game is using Web Audio
    try {
      if (window.__AUDIO_CTX__ && window.__AUDIO_CTX__.state === "running") {
        window.__AUDIO_CTX__.suspend();
        state.suspendedAudioCtx = window.__AUDIO_CTX__;
      }
    } catch (e) {}

    window.dispatchEvent(new CustomEvent("paused"));
  }

  function resume() {
    if (!state.paused) return;
    state.paused = false;
    window.__PAUSE_FLAG__ = false;

    if (state.overlay) state.overlay.style.display = "none";

    // Phaser 3 auto-resume
    try {
      const game = window.game || window.phaserGame || window.__PHASER__;
      if (game && game.scene && game.scene.scenes) {
        for (const s of game.scene.scenes) {
          if (s && s.scene && s.scene.isPaused && s.scene.isPaused()) {
            s.scene.resume();
          }
        }
      }
    } catch (e) {}

    // Resume audio
    try {
      document.querySelectorAll("audio").forEach(function (a) {
        if (a._wasPlaying) { a.play().catch(function () {}); a._wasPlaying = false; }
      });
    } catch (e) {}

    try {
      if (state.suspendedAudioCtx) {
        state.suspendedAudioCtx.resume();
        state.suspendedAudioCtx = null;
      }
    } catch (e) {}

    window.dispatchEvent(new CustomEvent("resumed"));
  }

  function toggle() { state.paused ? resume() : pause(); }

  // ─── Inputs ─────────────────────────────────────────────────────
  window.addEventListener("keydown", function (e) {
    if (e.code === "Escape" || e.code === "KeyP") {
      toggle();
      e.preventDefault();
    }
  });

  // Auto-pause on tab hide / window blur
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && !state.paused) pause();
  });
  window.addEventListener("blur", function () {
    if (!state.paused) pause();
  });

  // Gamepad Start button (button index 9 = Start on most controllers)
  let gpStartHeld = false;
  function _gpPoll() {
    try {
      const gps = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (const gp of gps) {
        if (!gp) continue;
        const pressed = gp.buttons[9] && gp.buttons[9].pressed;
        if (pressed && !gpStartHeld) { toggle(); gpStartHeld = true; }
        if (!pressed) gpStartHeld = false;
      }
    } catch (e) {}
    requestAnimationFrame(_gpPoll);
  }
  requestAnimationFrame(_gpPoll);

  // Public API
  window.__PAUSE__ = { pause: pause, resume: resume, toggle: toggle, isPaused: function () { return state.paused; } };
})();
