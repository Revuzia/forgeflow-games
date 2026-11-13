/* score_combo.js — chain-kill multiplier system.
 *
 * Each enemy kill within COMBO_WINDOW (1500ms) of the previous kill
 * increments the multiplier (1× → 2× → 3× ... up to 16×). Score for
 * each enemy is base * current multiplier. Multiplier decays to 1 if
 * no kills for COMBO_WINDOW.
 *
 * Visual: large multiplier text in HUD top-right. Pulses on increment.
 */
(function (root) {
  "use strict";

  const COMBO_WINDOW = 1500;
  const MAX_MULT = 16;

  function attach(scene) {
    if (scene._comboWired) return;
    scene._comboWired = true;
    scene._mult = 1;
    scene._lastKillAt = 0;
    const cam = scene.cameras.main;
    scene._multText = scene.add.text(cam.width - 16, 16, "x1", {
      fontSize: "32px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(900);
    // Decay tick
    scene._comboDecayEv = scene.time.addEvent({
      delay: 100, loop: true, callback: () => {
        if (scene._mult > 1 && scene.time.now - scene._lastKillAt > COMBO_WINDOW) {
          scene._mult = 1;
          scene._multText.setText("x1").setColor("#ffffff").setScale(1);
        }
      },
    });
  }

  function recordKill(scene, baseScore) {
    if (!scene._comboWired) return baseScore;
    if (scene.time.now - scene._lastKillAt < COMBO_WINDOW) {
      scene._mult = Math.min(MAX_MULT, scene._mult + 1);
    }
    scene._lastKillAt = scene.time.now;
    const earned = (baseScore || 50) * scene._mult;
    scene.score = (scene.score || 0) + earned;
    if (scene._multText) {
      const colors = ["#ffffff", "#ffffff", "#ffeb3b", "#ff9800", "#ff5252", "#ff00ff"];
      const ci = Math.min(colors.length - 1, Math.floor(scene._mult / 4));
      scene._multText.setText("x" + scene._mult).setColor(colors[ci]);
      scene.tweens.add({ targets: scene._multText, scale: 1.4, duration: 120, yoyo: true });
    }
    if (typeof scene.updateHUD === "function") scene.updateHUD();
    return earned;
  }

  root.ScoreCombo = { attach, recordKill, COMBO_WINDOW, MAX_MULT };
})(typeof window !== "undefined" ? window : this);
