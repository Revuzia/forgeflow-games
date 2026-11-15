/* partner_system.js — Diddy/Dixie-style partner companion.
 *
 * Player carries a partner. On hit, the partner is "lost" instead of
 * losing a life (effectively a 2-hit health system). Picking up a
 * partner_barrel restores them. Partner can grant a passive ability
 * based on their type (fast = +20% speed; high = +30% jump).
 *
 * Partner types come from design.protagonist.alt_characters[] or are
 * generic (fast/high/heavy). Fully genre-agnostic.
 */
(function (root) {
  "use strict";

  const TYPES = {
    fast:  { tint: 0x00bcd4, speedMul: 1.2, jumpMul: 1.0 },
    high:  { tint: 0xffeb3b, speedMul: 1.0, jumpMul: 1.3 },
    heavy: { tint: 0x795548, speedMul: 1.0, jumpMul: 1.0, extraHits: 1 },
  };

  function attach(scene) {
    if (scene._partnerWired) return;
    scene._partnerWired = true;
    scene.partnerActive = null;  // null | "fast" | "high" | "heavy"
    // Hook playerHit: if we have a partner, lose them instead of a life
    const origHit = scene.playerHit && scene.playerHit.bind(scene);
    if (origHit) {
      scene.playerHit = function () {
        if (scene.partnerActive) {
          // Lose partner only
          _removePartner(scene);
          if (typeof scene.cameras !== "undefined" && scene.cameras.main) scene.cameras.main.flash(150, 200, 200, 200);
          if (typeof scene.showFloatText === "function") scene.showFloatText(scene.player.x, scene.player.y - 30, "PARTNER LOST", "#ff5252");
          // Brief invuln
          scene.isInvincible = true;
          scene.time.delayedCall(800, () => { scene.isInvincible = false; });
          return;
        }
        return origHit.apply(scene, arguments);
      };
    }
  }

  function spawnBarrel(scene, x, y, type) {
    type = type || "fast";
    if (!scene.partnerBarrels) {
      scene.partnerBarrels = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.partnerBarrels, (p, b) => {
          if (b._used) return;
          b._used = true;
          _grantPartner(scene, b._type);
          b.destroy();
        });
      }
    }
    const tex = scene.textures.exists("__platform") ? "__platform" : "__pixel";
    const b = scene.partnerBarrels.create(x, y, tex);
    b.setDisplaySize(28, 28).setTint((TYPES[type] || TYPES.fast).tint);
    b._type = type;
    return b;
  }

  function _grantPartner(scene, type) {
    const t = TYPES[type] || TYPES.fast;
    scene.partnerActive = type;
    if (scene.controller && scene.controller.cfg) {
      scene._partnerOrigSpeed = scene.controller.cfg.speed;
      scene._partnerOrigJump = scene.controller.cfg.jumpForce;
      scene.controller.cfg.speed = scene._partnerOrigSpeed * t.speedMul;
      scene.controller.cfg.jumpForce = scene._partnerOrigJump * t.jumpMul;
    }
    if (scene.player) scene.player.setTint(t.tint);
    if (typeof scene.showFloatText === "function") scene.showFloatText(scene.player.x, scene.player.y - 30, type.toUpperCase() + "!", "#ffd700");
  }

  function _removePartner(scene) {
    if (!scene.partnerActive) return;
    if (scene.controller && scene._partnerOrigSpeed) {
      scene.controller.cfg.speed = scene._partnerOrigSpeed;
      scene.controller.cfg.jumpForce = scene._partnerOrigJump;
    }
    if (scene.player) scene.player.clearTint();
    scene.partnerActive = null;
  }

  root.PartnerSystem = { attach, spawnBarrel, TYPES };
})(typeof window !== "undefined" ? window : this);
