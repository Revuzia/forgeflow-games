/* items.js — universal pickup items beyond coins/letters.
 *
 * Registers item types from design.items[] (research-driven). Each item
 * has a sprite + on-pickup effect.
 *
 * Items implemented:
 *   - heart            — restore 1 life (1 HP for HP-based games)
 *   - extra_life       — +1 life unconditionally (Red Balloon style)
 *   - full_heal        — restore lives to maxLives (Banana Juice style)
 *   - puzzle_piece     — increment scene._puzzlePieces (100% completion track)
 *   - crash_guard      — temporary 1-hit invuln for vehicle sections
 *   - invincibility    — short timed invincibility (Green Balloon style)
 *
 * Items.spawn(scene, x, y, type, opts) creates a sprite. Sprites bob and
 * have pickup overlap callbacks attached.
 *
 * Items.scatter(scene, count) randomly places `count` items across the
 * level — used by GameScene to add 1-2 items per level (typical DKC).
 */
(function (root) {
  "use strict";

  const HANDLERS = {
    heart: {
      tex: "hud_heartFull", color: 0xff4081, w: 22, h: 22,
      onPickup(scene) {
        if (scene.lives !== undefined) {
          scene.lives = Math.min((scene.lives || 0) + 1, scene.maxLives || 9);
          if (typeof scene.updateHUD === "function") scene.updateHUD();
        }
        if (typeof scene.showFloatText === "function")
          scene.showFloatText(scene.player.x, scene.player.y - 30, "+1", "#ff4081");
      },
    },
    extra_life: {
      tex: "star", color: 0xffd700, w: 24, h: 24,
      onPickup(scene) {
        if (scene.lives !== undefined) {
          scene.lives = Math.min((scene.lives || 0) + 1, 9);
          if (typeof scene.updateHUD === "function") scene.updateHUD();
        }
        if (typeof scene.showFloatText === "function")
          scene.showFloatText(scene.player.x, scene.player.y - 30, "1-UP", "#ffd700");
        if (typeof scene.cameras !== "undefined" && scene.cameras.main)
          scene.cameras.main.flash(200, 255, 215, 0);
      },
    },
    full_heal: {
      tex: "gemRed", color: 0xff4081, w: 22, h: 22,
      onPickup(scene) {
        if (scene.lives !== undefined) {
          scene.lives = scene.maxLives || (scene.GAME_CONFIG && scene.GAME_CONFIG.player && scene.GAME_CONFIG.player.maxLives) || 3;
          if (typeof scene.updateHUD === "function") scene.updateHUD();
        }
        if (typeof scene.showFloatText === "function")
          scene.showFloatText(scene.player.x, scene.player.y - 30, "FULL HEAL", "#ff4081");
      },
    },
    puzzle_piece: {
      tex: "gemBlue", color: 0x00bfff, w: 18, h: 18,
      onPickup(scene) {
        scene._puzzlePieces = (scene._puzzlePieces || 0) + 1;
        if (typeof scene.showFloatText === "function")
          scene.showFloatText(scene.player.x, scene.player.y - 30, "PIECE!", "#00bfff");
        scene.score = (scene.score || 0) + 250;
        if (typeof scene.updateHUD === "function") scene.updateHUD();
      },
    },
    crash_guard: {
      tex: "block_strong_empty", color: 0x607d8b, w: 24, h: 24,
      onPickup(scene) {
        scene._crashGuard = true;
        if (typeof scene.showFloatText === "function")
          scene.showFloatText(scene.player.x, scene.player.y - 30, "GUARD UP", "#607d8b");
      },
    },
    invincibility: {
      tex: "star", color: 0x00ff00, w: 24, h: 24,
      onPickup(scene) {
        if (window.PowerUps && window.PowerUps.activate) {
          window.PowerUps.activate(scene, "invincible", 8);
        }
      },
    },
  };

  function _safe(scene, key) {
    return scene.textures && scene.textures.exists(key) ? key : "__pixel";
  }

  function spawn(scene, x, y, type, opts) {
    const h = HANDLERS[type] || HANDLERS.heart;
    if (!scene.itemPickups) {
      scene.itemPickups = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.itemPickups, (p, item) => {
          if (item._collected) return;
          item._collected = true;
          try { item._handler.onPickup(scene); } catch (e) { console.warn("[Items]", e); }
          if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
          item.destroy();
        });
      }
    }
    const tex = _safe(scene, h.tex);
    const it = scene.itemPickups.create(x, y, tex);
    it.setDisplaySize(h.w, h.h);
    if (tex === "__pixel") it.setTint(h.color);
    it._handler = h;
    // Bob animation
    scene.tweens.add({
      targets: it, y: y - 6, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
    return it;
  }

  // Scatter standard items across the level: 1 heart, 1 puzzle piece, maybe 1 extra life
  function scatter(scene) {
    if (!scene.map) return;
    const w = scene.map.widthInPixels;
    const tile = scene.map.tileWidth || 18;
    const floorY = (scene.map.height - 4) * tile - 24;
    const seed = (scene.currentLevel || 0) * 9973;
    spawn(scene, w * 0.30, floorY - 80, "heart");
    spawn(scene, w * 0.55, floorY - 120, "puzzle_piece");  // hidden up high
    if ((scene.currentLevel || 0) % 4 === 3) {
      spawn(scene, w * 0.80, floorY - 60, "extra_life");
    }
  }

  root.Items = { spawn, scatter, HANDLERS };
})(typeof window !== "undefined" ? window : this);
