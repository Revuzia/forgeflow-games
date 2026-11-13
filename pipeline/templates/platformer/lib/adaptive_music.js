/* adaptive_music.js — context-aware music switching.
 *
 * Switches music based on game state:
 *   - normal exploration  → music_level
 *   - boss phase 1        → music_boss
 *   - boss phase 2 (low HP) → music_boss_rage (faster pitch shift)
 *   - low player health   → adds urgent rumble
 *   - victory             → music_victory
 *
 * Genre-agnostic. Falls back to whatever music tracks are loaded.
 */
(function (root) {
  "use strict";

  function attach(scene) {
    if (scene._musicWired) return;
    scene._musicWired = true;
    scene._currentMusicKey = null;
    scene._musicTickEv = scene.time.addEvent({
      delay: 800, loop: true, callback: () => _evaluate(scene),
    });
  }

  function _evaluate(scene) {
    let target = "music_level";
    // Boss active?
    if (scene.boss && scene.boss._sprite && scene.boss._sprite.active) {
      const ratio = scene.boss.hp / scene.boss.maxHp;
      target = ratio < 0.4 ? "music_boss_rage" : "music_boss";
    } else if (scene.lives !== undefined && scene.lives <= 1) {
      // Low health urgency
      target = "music_urgent";
    }
    if (target !== scene._currentMusicKey) {
      _switchTo(scene, target);
    }
  }

  function _switchTo(scene, key) {
    if (!scene.sound) return;
    if (!scene.cache.audio.exists(key)) {
      // No track for that key — fall back to music_level if exists
      if (scene._currentMusicKey === "music_level" || !scene.cache.audio.exists("music_level")) return;
      key = "music_level";
    }
    try {
      scene.sound.stopAll();
      const cfg = (window.GAME_CONFIG && window.GAME_CONFIG.audio) || {};
      scene.sound.play(key, { loop: true, volume: cfg.musicVolume || 0.3 });
      scene._currentMusicKey = key;
    } catch (_e) {}
  }

  root.AdaptiveMusic = { attach };
})(typeof window !== "undefined" ? window : this);
