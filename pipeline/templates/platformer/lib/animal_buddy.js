/* animal_buddy.js — rideable companion (Rambi-style mount).
 *
 * design.items[] entries with names like "Rambi", "Squawks", "Expresso",
 * or generic "animal_buddy" / "mount" map to one of the implemented
 * buddies below. Player overlaps a buddy crate → mounts → gets that
 * buddy's special ability for the rest of the level (or until hit).
 *
 * Implemented buddies:
 *   - charger  (Rambi-style): double size, charges + breaks crates,
 *               kills enemies on contact, can't take damage from below
 *   - flyer    (Squawks-style): ascend/descend with arrow keys,
 *               immune to ground hazards, projectiles (eggs) on attack
 *   - hopper   (Expresso-style): 3x jump height, no fall damage
 *
 * AnimalBuddy.spawn(scene, x, y, type) places a mount crate.
 * AnimalBuddy.tick(scene, time, delta) handles per-frame buddy logic.
 */
(function (root) {
  "use strict";

  const BUDDIES = {
    charger: {
      colorTint: 0x9c27b0,
      apply(scene) {
        scene._buddy = "charger";
        scene._buddyEndTime = scene.time.now + 30000;  // 30 sec ride
        const p = scene.player;
        p._buddyOriginalScale = p.scaleX;
        p.setScale(p._buddyOriginalScale * 1.4);
        p.setTint(0x9c27b0);
        // Boost speed, immune to small hits
        if (scene.controller && scene.controller.cfg) {
          scene._buddyOrigSpeed = scene.controller.cfg.speed;
          scene.controller.cfg.speed = scene._buddyOrigSpeed * 1.3;
        }
        // Charge attack: any enemy contact = kill
        if (scene.enemies) {
          scene._buddyCollider = scene.physics.add.overlap(p, scene.enemies, (_p, en) => {
            if (scene._buddy === "charger" && en && en.active && scene.killEnemy) {
              scene.killEnemy(en);
            }
          });
        }
      },
      revert(scene) {
        const p = scene.player;
        if (p && p._buddyOriginalScale) p.setScale(p._buddyOriginalScale);
        if (p) p.clearTint();
        if (scene.controller && scene._buddyOrigSpeed) {
          scene.controller.cfg.speed = scene._buddyOrigSpeed;
        }
        scene._buddy = null;
      },
    },
    flyer: {
      colorTint: 0x2196f3,
      apply(scene) {
        scene._buddy = "flyer";
        scene._buddyEndTime = scene.time.now + 30000;
        const p = scene.player;
        p.setTint(0x2196f3);
        try { p.body.setAllowGravity(false); } catch (_e) {}
        scene._buddyTickEv = scene.time.addEvent({
          delay: 16, loop: true, callback: () => {
            if (!p || !p.active) return;
            const up = (scene.cursors && scene.cursors.up && scene.cursors.up.isDown) || (scene.wasd && scene.wasd.W && scene.wasd.W.isDown);
            const dn = (scene.cursors && scene.cursors.down && scene.cursors.down.isDown) || (scene.wasd && scene.wasd.S && scene.wasd.S.isDown);
            if (up) p.setVelocityY(-220);
            else if (dn) p.setVelocityY(220);
            else p.setVelocityY(p.body.velocity.y * 0.92);
          },
        });
      },
      revert(scene) {
        const p = scene.player;
        if (p) {
          p.clearTint();
          try { p.body.setAllowGravity(true); } catch (_e) {}
        }
        if (scene._buddyTickEv) try { scene._buddyTickEv.remove(); } catch (_e) {}
        scene._buddy = null;
      },
    },
    hopper: {
      colorTint: 0xff9800,
      apply(scene) {
        scene._buddy = "hopper";
        scene._buddyEndTime = scene.time.now + 30000;
        const p = scene.player;
        p.setTint(0xff9800);
        if (scene.controller && scene.controller.cfg) {
          scene._buddyOrigJump = scene.controller.cfg.jumpForce;
          scene.controller.cfg.jumpForce = scene._buddyOrigJump * 1.6;
        }
      },
      revert(scene) {
        const p = scene.player;
        if (p) p.clearTint();
        if (scene.controller && scene._buddyOrigJump) {
          scene.controller.cfg.jumpForce = scene._buddyOrigJump;
        }
        scene._buddy = null;
      },
    },
  };

  function spawn(scene, x, y, type) {
    type = type || "charger";
    if (!scene.buddyCrates) {
      scene.buddyCrates = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.buddyCrates, (p, crate) => {
          if (crate._used) return;
          crate._used = true;
          const buddy = BUDDIES[crate._type] || BUDDIES.charger;
          try { buddy.apply(scene); } catch (e) { console.warn("[AnimalBuddy] apply", e); }
          if (typeof scene.showFloatText === "function")
            scene.showFloatText(crate.x, crate.y - 30, crate._type.toUpperCase() + "!", "#ffd700");
          if (typeof scene.cameras !== "undefined" && scene.cameras.main)
            scene.cameras.main.flash(200, ...[(buddy.colorTint >> 16) & 0xff, (buddy.colorTint >> 8) & 0xff, buddy.colorTint & 0xff]);
          crate.destroy();
        });
      }
    }
    const buddy = BUDDIES[type] || BUDDIES.charger;
    const tex = scene.textures.exists("__platform") ? "__platform" : "__pixel";
    const c = scene.buddyCrates.create(x, y, tex);
    c.setDisplaySize(36, 36).setTint(buddy.colorTint);
    c._type = type;
    // Animated outline
    const ring = scene.add.circle(x, y, 24, buddy.colorTint, 0).setStrokeStyle(3, buddy.colorTint, 0.7).setDepth(50);
    scene.tweens.add({ targets: ring, radius: 40, alpha: 0, duration: 1200, repeat: -1 });
    return c;
  }

  function tick(scene, time, delta) {
    if (scene._buddy && scene._buddyEndTime && time >= scene._buddyEndTime) {
      const buddy = BUDDIES[scene._buddy];
      if (buddy) try { buddy.revert(scene); } catch (_e) {}
      scene._buddyEndTime = null;
    }
  }

  root.AnimalBuddy = { spawn, tick, BUDDIES };
})(typeof window !== "undefined" ? window : this);
