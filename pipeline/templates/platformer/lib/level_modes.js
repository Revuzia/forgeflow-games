/* level_modes.js — non-standard level modes (auto-run, flight, swim).
 *
 * design.special_level_modes[] from research lists modes like
 * "barrel_rocket_run", "underwater_depths", "minecart_chase". This lib
 * implements them generically. The level synthesizer can flag a level
 * with `mode: "minecart"` etc. and the GameScene calls
 * LevelModes.applySetup(scene, mode) in createPlayer + LevelModes.tick
 * in update.
 *
 * Modes implemented:
 *   - "minecart"      auto-run right at high speed; player can only jump
 *   - "rocket_barrel" auto-fly with arrow-key altitude; obstacles damage
 *   - "underwater"    floaty physics + swim controls (via WorldMechanics)
 *   - "standard"      default (no override)
 *
 * Scene contract:
 *   levelData.mode             — "standard" | "minecart" | "rocket_barrel" | "underwater"
 *   scene.levelMode            — set by createLevel from levelData.mode
 *   scene.applyLevelModeSetup  — called by template; we hook here
 *   scene.applyLevelModeMovement — per-frame override; returns true to skip default movement
 */
(function (root) {
  "use strict";

  const MODES = {
    minecart: {
      setup(scene) {
        scene._mcAutoVx = 320;
        // Visual: turn player slightly to indicate "in minecart"
        if (scene.player) scene.player.setTint(0x9e9e9e);
      },
      onMove(scene, ctx) {
        // Override horizontal: always run right
        if (!scene.player || !scene.player.body) return false;
        if (ctx && ctx.onGround) {
          scene.player.setVelocityX(scene._mcAutoVx);
        }
        return true;  // signal to controller: skip horizontal input
      },
      tick(scene, time, delta) {
        // Speed up over time (DKC pattern: cart accelerates)
        if (scene._mcAutoVx < 480) scene._mcAutoVx += delta * 0.02;
      },
      revert(scene) { if (scene.player) scene.player.clearTint(); },
    },

    rocket_barrel: {
      setup(scene) {
        if (!scene.player) return;
        scene.player.setTint(0xff8a00);
        try { scene.player.body.setAllowGravity(false); } catch (_e) {}
        scene._rbAutoVx = 360;
      },
      onMove(scene) {
        if (!scene.player || !scene.player.body) return false;
        scene.player.setVelocityX(scene._rbAutoVx);
        const up = (scene.cursors && scene.cursors.up && scene.cursors.up.isDown) ||
                   (scene.spaceKey && scene.spaceKey.isDown);
        if (up) scene.player.setVelocityY(-200);
        else    scene.player.setVelocityY(scene.player.body.velocity.y * 0.92 + 80);
        return true;
      },
      tick() {},
      revert(scene) {
        if (scene.player) {
          scene.player.clearTint();
          try { scene.player.body.setAllowGravity(true); } catch (_e) {}
        }
      },
    },

    underwater: {
      setup(scene) {
        if (scene.physics && scene.physics.world && scene.physics.world.gravity) {
          scene._uwGrav = scene.physics.world.gravity.y;
          scene.physics.world.gravity.y = scene._uwGrav * 0.4;
        }
        if (scene.cameras && scene.cameras.main) {
          scene._uwOverlay = scene.add.rectangle(0, 0, scene.cameras.main.width, scene.cameras.main.height,
            0x0066aa, 0.18).setOrigin(0, 0).setScrollFactor(0).setDepth(800);
        }
      },
      onMove() { return false; },
      tick(scene) {
        const up = (scene.cursors && scene.cursors.up && scene.cursors.up.isDown) ||
                   (scene.wasd && scene.wasd.W && scene.wasd.W.isDown);
        if (up && scene.player && scene.player.body) {
          scene.player.body.velocity.y = Math.max(scene.player.body.velocity.y - 8, -180);
        }
      },
      revert(scene) {
        if (scene._uwGrav && scene.physics && scene.physics.world) {
          scene.physics.world.gravity.y = scene._uwGrav;
        }
        try { scene._uwOverlay && scene._uwOverlay.destroy(); } catch (_e) {}
      },
    },
  };

  function applySetup(scene, mode) {
    if (!mode || mode === "standard") return;
    const m = MODES[mode];
    if (m) try { m.setup(scene); scene._activeLevelMode = mode; } catch (_e) {}
  }

  function applyMovement(scene, mode, ctx) {
    if (!mode || mode === "standard") return false;
    const m = MODES[mode];
    if (m && m.onMove) return !!m.onMove(scene, ctx);
    return false;
  }

  function tick(scene, time, delta) {
    const mode = scene._activeLevelMode;
    if (!mode) return;
    const m = MODES[mode];
    if (m && m.tick) try { m.tick(scene, time, delta); } catch (_e) {}
  }

  // Auto-wire scene.applyLevelModeSetup + applyLevelModeMovement so the
  // template's existing hook calls land here without per-game code.
  function attach(scene) {
    scene.applyLevelModeSetup = function (mode) { applySetup(scene, mode); };
    scene.applyLevelModeMovement = function (mode, ctx) { return applyMovement(scene, mode, ctx); };
  }

  root.LevelModes = { applySetup, applyMovement, tick, attach, MODES };
})(typeof window !== "undefined" ? window : this);
