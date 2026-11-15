/* completion.js — 100% completion tracker + hard-mode toggle.
 *
 * Tracks per-level: BLITZ letters, puzzle pieces, level cleared.
 * Persists via SaveLoad (localStorage).
 *
 * Shows top-right HUD addition: completion % for current world.
 * On Win scene: shows full completion summary.
 *
 * Hard mode: read from localStorage `hard_mode` flag. When on:
 *   - All enemy speeds × 1.3
 *   - Player lives capped at 1
 *   - No checkpoints (DK Barrel becomes decorative only)
 *
 * Genre-agnostic.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "ff_completion";
  const HARD_KEY = "ff_hard_mode";

  function _load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s) : {};
    } catch (_e) { return {}; }
  }
  function _save(d) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (_e) {}
  }
  function isHardMode() {
    try { return localStorage.getItem(HARD_KEY) === "1"; } catch (_e) { return false; }
  }
  function setHardMode(on) {
    try { localStorage.setItem(HARD_KEY, on ? "1" : "0"); } catch (_e) {}
  }

  function attach(scene) {
    scene._completion = _load();
    scene._completionLevelKey = `level_${scene.currentLevel || 0}`;
    if (!scene._completion[scene._completionLevelKey]) {
      scene._completion[scene._completionLevelKey] = {
        cleared: false, letters: 0, pieces: 0,
      };
    }
    // Apply hard mode if enabled
    if (isHardMode()) {
      scene._hardMode = true;
      scene.lives = 1;
      // Boost enemy speed
      if (scene.enemies && scene.enemies.children) {
        scene.enemies.children.iterate(en => {
          if (en && en.speed !== undefined) en.speed = Math.round(en.speed * 1.3);
        });
      }
    }
  }

  function recordLetterCollected(scene, letter) {
    if (!scene._completion) return;
    const ent = scene._completion[scene._completionLevelKey];
    if (!ent.collectedLetters) ent.collectedLetters = {};
    if (!ent.collectedLetters[letter]) {
      ent.collectedLetters[letter] = true;
      ent.letters = Object.keys(ent.collectedLetters).length;
      _save(scene._completion);
    }
  }
  function recordPieceCollected(scene) {
    if (!scene._completion) return;
    const ent = scene._completion[scene._completionLevelKey];
    ent.pieces = (ent.pieces || 0) + 1;
    _save(scene._completion);
  }
  function recordLevelClear(scene) {
    if (!scene._completion) return;
    const ent = scene._completion[scene._completionLevelKey];
    ent.cleared = true;
    _save(scene._completion);
  }

  function summary() {
    const c = _load();
    const totalLevels = Object.keys(c).length || 0;
    let cleared = 0, letters = 0, pieces = 0;
    Object.values(c).forEach(e => {
      if (e.cleared) cleared++;
      letters += (e.letters || 0);
      pieces += (e.pieces || 0);
    });
    return { totalLevels, cleared, letters, pieces };
  }

  root.Completion = {
    attach, recordLetterCollected, recordPieceCollected, recordLevelClear,
    isHardMode, setHardMode, summary,
  };
})(typeof window !== "undefined" ? window : this);
