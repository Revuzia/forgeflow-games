/* time_attack.js — per-level timer + best-time tracking.
 *
 * Shows a timer in the HUD. On level clear, compares to best time
 * stored in localStorage. New best → "NEW RECORD" banner.
 *
 * Toggle via TimeAttack.setEnabled(true). When off, no UI appears.
 *
 * Genre-agnostic.
 */
(function (root) {
  "use strict";

  const KEY_BEST = "ff_best_times";
  const KEY_ENABLED = "ff_time_attack";

  function isEnabled() {
    try { return localStorage.getItem(KEY_ENABLED) === "1"; } catch (_e) { return false; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(KEY_ENABLED, on ? "1" : "0"); } catch (_e) {}
  }
  function _bests() {
    try { return JSON.parse(localStorage.getItem(KEY_BEST) || "{}"); }
    catch (_e) { return {}; }
  }
  function _saveBests(b) {
    try { localStorage.setItem(KEY_BEST, JSON.stringify(b)); } catch (_e) {}
  }

  function attach(scene) {
    if (!isEnabled() || scene._taWired) return;
    scene._taWired = true;
    scene._taStart = scene.time.now;
    const cam = scene.cameras.main;
    scene._taText = scene.add.text(cam.width / 2, 60, "0:00", {
      fontSize: "20px", color: "#ffffff", fontStyle: "bold",
      backgroundColor: "#000000aa", padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(910);
    scene._taTickEv = scene.time.addEvent({
      delay: 100, loop: true, callback: () => {
        const elapsed = (scene.time.now - scene._taStart) / 1000;
        const m = Math.floor(elapsed / 60);
        const s = Math.floor(elapsed % 60);
        scene._taText.setText(`${m}:${String(s).padStart(2, "0")}`);
      },
    });
  }

  function recordClear(scene) {
    if (!scene._taWired) return null;
    const elapsed = (scene.time.now - scene._taStart) / 1000;
    const lvlKey = `lv_${scene.currentLevel || 0}`;
    const bests = _bests();
    const prev = bests[lvlKey];
    const isNew = !prev || elapsed < prev;
    bests[lvlKey] = isNew ? elapsed : prev;
    _saveBests(bests);
    if (isNew) {
      // Banner
      const cam = scene.cameras.main;
      const banner = scene.add.text(cam.width / 2, cam.height / 2, "NEW RECORD!", {
        fontSize: "32px", color: "#ffd700", fontStyle: "bold",
        backgroundColor: "#000000aa", padding: { x: 16, y: 8 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);
      scene.tweens.add({ targets: banner, alpha: 0, y: cam.height / 2 - 80, duration: 2500, onComplete: () => banner.destroy() });
    }
    return { time: elapsed, isNew, prev };
  }

  root.TimeAttack = { attach, isEnabled, setEnabled, recordClear, _bests };
})(typeof window !== "undefined" ? window : this);
