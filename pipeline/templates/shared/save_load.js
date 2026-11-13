/**
 * save_load.js — Persistent game state via localStorage.
 *
 * Every generated game auto-gets save slots (3), autosave on level complete,
 * and a load menu. Stores: current level, lives, score, collected secrets,
 * unlocked worlds, power-up inventory, playtime.
 *
 * API:
 *   SaveLoad.init("game-slug");
 *   SaveLoad.save(slot, stateDict);
 *   SaveLoad.load(slot) -> stateDict | null
 *   SaveLoad.list() -> [{slot, summary, timestamp}, ...]
 *   SaveLoad.autoSave(stateDict);    // saves to slot 0 (autosave)
 */
const SaveLoad = {
  _prefix: "forgeflow_default_",
  _maxSlots: 4,  // 0 = autosave, 1-3 = manual

  init(gameSlug) {
    SaveLoad._prefix = `forgeflow_${gameSlug}_`;
  },

  save(slot, state) {
    if (slot < 0 || slot >= SaveLoad._maxSlots) return false;
    try {
      const payload = {
        ...state,
        timestamp: Date.now(),
        version: 1,
      };
      localStorage.setItem(`${SaveLoad._prefix}${slot}`, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn("Save failed:", e);
      return false;
    }
  },

  load(slot) {
    try {
      const raw = localStorage.getItem(`${SaveLoad._prefix}${slot}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  list() {
    const results = [];
    for (let i = 0; i < SaveLoad._maxSlots; i++) {
      const data = SaveLoad.load(i);
      if (data) {
        results.push({
          slot: i,
          isAutosave: i === 0,
          timestamp: data.timestamp,
          level: data.level ?? 1,
          score: data.score ?? 0,
          lives: data.lives ?? 3,
          playtime: data.playtime ?? 0,
          summary: `Level ${data.level ?? 1} — Score ${data.score ?? 0} — ${new Date(data.timestamp).toLocaleDateString()}`,
        });
      }
    }
    return results;
  },

  autoSave(state) {
    return SaveLoad.save(0, state);
  },

  clear(slot) {
    localStorage.removeItem(`${SaveLoad._prefix}${slot}`);
  },

  clearAll() {
    for (let i = 0; i < SaveLoad._maxSlots; i++) SaveLoad.clear(i);
  },

  // Settings (volume, controls, accessibility) — separate from save slots
  loadSettings() {
    try {
      const raw = localStorage.getItem(`${SaveLoad._prefix}settings`);
      return raw ? JSON.parse(raw) : SaveLoad.defaultSettings();
    } catch {
      return SaveLoad.defaultSettings();
    }
  },

  saveSettings(settings) {
    try {
      localStorage.setItem(`${SaveLoad._prefix}settings`, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  },

  defaultSettings() {
    return {
      musicVolume: 0.3,
      sfxVolume: 0.6,
      screenShake: true,
      colorBlindMode: "none",  // none | protanopia | deuteranopia | tritanopia
      subtitles: false,
      controls: { move: "ArrowKeys", jump: "Space", attack: "X", dash: "Shift" },
      highContrast: false,
      reducedMotion: false,
    };
  },
};

if (typeof window !== "undefined") {
  window.SaveLoad = SaveLoad;
}
