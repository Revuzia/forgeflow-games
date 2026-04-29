/* hud_letters.js — top-right HUD slots for the protagonist's KONG-style
 * collectible letters. Lights up letters as collected. Triggers a reward
 * animation + extra life when all letters are collected.
 *
 * Uses scene.kongLetters group (created by GameScene._spawnSetPieces) and
 * scene._kongCollected map (set by overlap callback). Computes the full
 * letter sequence from window.GAME_DESIGN.protagonist.name.
 *
 * Generic across game types — the letter sequence is the protagonist's name
 * (last 4-5 letter word). Real DKC has K-O-N-G; we have BLITZ for Barrel
 * Blitz, MARIO for Mario, etc.
 */
(function (root) {
  "use strict";

  function _spellFromProto(name) {
    const raw = String(name || "KONG").trim();
    const words = raw.match(/[A-Za-z]+/g) || ["KONG"];
    // Prefer LAST word with 4-5 letters
    let chosen = null;
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].length >= 4 && words[i].length <= 5) { chosen = words[i]; break; }
    }
    if (!chosen) chosen = words.reduce((a, b) => a.length >= b.length ? a : b).slice(0, 5);
    return chosen.toUpperCase();
  }

  function attach(scene) {
    const design = window.GAME_DESIGN || {};
    const protoName = (design.protagonist && design.protagonist.name) || "KONG";
    const word = _spellFromProto(protoName);
    scene._hudLetters = { word, slots: [], collected: 0, rewardFired: false };

    const cam = scene.cameras.main;
    const slotSize = 28;
    const padding = 6;
    const totalW = word.length * (slotSize + padding) - padding;
    const startX = cam.width - totalW - 12;
    const y = 16;

    word.split("").forEach((letter, i) => {
      const x = startX + i * (slotSize + padding);
      // Empty slot: dim outline + letter
      const bg = scene.add.rectangle(x, y, slotSize, slotSize, 0x000000, 0.55)
        .setOrigin(0, 0).setScrollFactor(0).setDepth(900)
        .setStrokeStyle(2, 0x546e7a);
      const txt = scene.add.text(x + slotSize / 2, y + slotSize / 2, letter, {
        fontSize: "16px", color: "#546e7a", fontStyle: "bold",
      }).setOrigin(0.5).setScrollFactor(0).setDepth(901);
      scene._hudLetters.slots.push({ letter, bg, txt, lit: false });
    });
  }

  function tick(scene) {
    if (!scene._hudLetters || !scene._kongCollected) return;
    const hl = scene._hudLetters;
    let nowLit = 0;
    for (const slot of hl.slots) {
      const isCollected = !!scene._kongCollected[slot.letter];
      if (isCollected && !slot.lit) {
        slot.lit = true;
        slot.bg.setStrokeStyle(2, 0xffd700);
        slot.bg.setFillStyle(0xffd700, 0.85);
        slot.txt.setColor("#000000");
        // Pulse
        scene.tweens.add({
          targets: [slot.bg, slot.txt], scale: 1.4,
          duration: 200, yoyo: true,
        });
      }
      if (slot.lit) nowLit++;
    }
    hl.collected = nowLit;
    // Reward when all letters collected
    if (!hl.rewardFired && nowLit === hl.slots.length && hl.slots.length > 0) {
      hl.rewardFired = true;
      _fireReward(scene, hl.word);
    }
  }

  function _fireReward(scene, word) {
    // Flash + extra life + score bonus + on-screen banner
    if (scene.cameras && scene.cameras.main) {
      scene.cameras.main.flash(500, 255, 215, 0);
      scene.cameras.main.shake(300, 0.005);
    }
    // Extra life
    if (scene.lives !== undefined) {
      scene.lives = Math.min((scene.lives || 0) + 1, 9);
      if (typeof scene.updateHUD === "function") scene.updateHUD();
    }
    // Score bonus
    if (scene.score !== undefined) {
      scene.score += 1000;
      if (typeof scene.updateHUD === "function") scene.updateHUD();
    }
    // Banner
    const cam = scene.cameras.main;
    const banner = scene.add.text(cam.width / 2, cam.height / 2,
      `${word}!  +1 LIFE  +1000`, {
      fontSize: "32px", color: "#ffd700", fontStyle: "bold",
      backgroundColor: "#000000aa", padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2000);
    scene.tweens.add({
      targets: banner, alpha: 0, y: cam.height / 2 - 80,
      duration: 2500, onComplete: () => banner.destroy(),
    });
    if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
  }

  root.HudLetters = { attach, tick, _spellFromProto };
})(typeof window !== "undefined" ? window : this);
