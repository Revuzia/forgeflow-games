/* power_ups.js — power-up implementations driven by design.power_ups[].
 *
 * Pipeline researches game's power-ups and writes them to design.json with:
 *   { name, effect, duration_seconds, rarity }
 * The level synthesizer scatters power-up pickups in levels (see PowerUps.spawn).
 * On pickup, PowerUps.activate(scene, name) runs the effect for duration_seconds
 * and reverts cleanly.
 *
 * Each power-up has the same lifecycle:
 *   - apply(scene, durationMs)   — activate effect, schedule revert
 *   - revert(scene)              — restore prior state
 *
 * Resolution: design power-up names ("Barrel_Cannon_Boost", "Golden_Peel")
 * are matched via fuzzy substring to a small set of canonical effects:
 *   - invincible      → grants invuln + speed (Golden_Peel, Blitz_Spirit)
 *   - shield          → orbiting projectile blocker (Barrel_Shield)
 *   - speed_boost     → temp 1.6x speed (Barrel_Boost overlap)
 *   - giant           → 1.5x scale + double damage on stomp (Blitz_Spirit)
 *   - rapid_fire      → spawn projectile group on input (Banana_Hoard)
 *   - shockwave_slam  → ground_slam radius doubled (Thunder_Stomp)
 *   - flight          → reduced gravity + air control (Rocket_Barrel)
 *   - cannon          → autonomous high-speed dash (Barrel_Cannon_Boost)
 *
 * Unknown names degrade to a 5-second invuln + tint flash so pickups never
 * feel inert.
 */
(function (root) {
  "use strict";

  function _norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  // ── Effects ────────────────────────────────────────────────────────────
  const Effects = {};

  Effects.invincible = {
    apply(scene, dur, opts) {
      if (!scene.player) return;
      scene.isInvincible = true;
      scene.player.setTint((opts && opts.tint) || 0xffeb3b);
      scene._puBlinkTween = scene.tweens.add({
        targets: scene.player, alpha: { from: 1, to: 0.45 },
        duration: 120, yoyo: true, repeat: -1,
      });
      scene.time.delayedCall(dur, () => Effects.invincible.revert(scene));
    },
    revert(scene) {
      if (!scene.player) return;
      scene.isInvincible = false;
      try { scene._puBlinkTween && scene._puBlinkTween.stop(); } catch (_e) {}
      scene.player.clearTint();
      scene.player.setAlpha(1);
    },
  };

  Effects.shield = {
    apply(scene, dur) {
      if (!scene.player) return;
      // Spawn a small orbiting "barrel" sprite that destroys enemies on contact
      const orb = scene.physics.add.sprite(scene.player.x, scene.player.y, "__pixel");
      orb.setDisplaySize(20, 20).setTint(0x8b4513);
      orb.body.setAllowGravity(false);
      orb.setCircle(10);
      orb._angle = 0;
      orb._radius = 50;
      scene._shieldOrb = orb;
      scene._shieldTickHandle = scene.time.addEvent({
        delay: 16, loop: true, callback: () => {
          if (!orb.active || !scene.player.active) return;
          orb._angle += 0.12;
          orb.x = scene.player.x + Math.cos(orb._angle) * orb._radius;
          orb.y = scene.player.y + Math.sin(orb._angle) * orb._radius;
        },
      });
      // Damage enemies on contact
      if (scene.enemies) {
        scene._shieldOverlap = scene.physics.add.overlap(orb, scene.enemies, (_o, en) => {
          if (scene.killEnemy && en && en.active) scene.killEnemy(en);
        }, null, scene);
      }
      scene.time.delayedCall(dur, () => Effects.shield.revert(scene));
    },
    revert(scene) {
      try { scene._shieldOrb && scene._shieldOrb.destroy(); } catch (_e) {}
      try { scene._shieldTickHandle && scene._shieldTickHandle.remove(); } catch (_e) {}
      scene._shieldOrb = null; scene._shieldTickHandle = null;
    },
  };

  Effects.speed_boost = {
    apply(scene, dur) {
      if (!scene.controller || !scene.controller.cfg) return;
      scene._sbPrev = scene.controller.cfg.speed;
      scene.controller.cfg.speed = scene._sbPrev * 1.6;
      if (scene.player) scene.player.setTint(0x00e5ff);
      scene.time.delayedCall(dur, () => Effects.speed_boost.revert(scene));
    },
    revert(scene) {
      if (scene.controller && scene._sbPrev) scene.controller.cfg.speed = scene._sbPrev;
      if (scene.player) scene.player.clearTint();
    },
  };

  Effects.giant = {
    apply(scene, dur) {
      if (!scene.player) return;
      scene._giPrevScale = scene.player.scaleX;
      scene.player.setScale(scene._giPrevScale * 1.5);
      scene._giPrevDmg = scene.player._stompDamage || 1;
      scene.player._stompDamage = 3;
      scene.isInvincible = true;
      scene.time.delayedCall(dur, () => Effects.giant.revert(scene));
    },
    revert(scene) {
      if (!scene.player) return;
      if (scene._giPrevScale) scene.player.setScale(scene._giPrevScale);
      scene.player._stompDamage = scene._giPrevDmg || 1;
      scene.isInvincible = false;
    },
  };

  Effects.rapid_fire = {
    apply(scene, dur) {
      if (!scene.physics) return;
      // Allow spamming F to throw projectiles
      try { scene._rfKey = scene.input.keyboard.addKey("F"); } catch (_e) {}
      scene._rfActive = true;
      scene._rfLastShot = 0;
      scene._rfTickHandle = scene.time.addEvent({
        delay: 50, loop: true, callback: () => {
          if (!scene._rfActive || !scene.player) return;
          const now = scene.time.now;
          if (scene._rfKey && scene._rfKey.isDown && now - scene._rfLastShot > 150) {
            scene._rfLastShot = now;
            const dir = scene.player.flipX ? -1 : 1;
            // Lazy create group
            if (!scene._rfGroup) {
              scene._rfGroup = scene.physics.add.group();
              if (scene.enemies) {
                scene.physics.add.overlap(scene._rfGroup, scene.enemies, (proj, en) => {
                  if (scene.killEnemy && en.active) scene.killEnemy(en);
                  proj.destroy();
                });
              }
            }
            const proj = scene._rfGroup.create(scene.player.x + dir * 30, scene.player.y, "__projectile");
            proj.setTint(0xffeb3b);
            proj.body.setAllowGravity(false);
            proj.setVelocityX(dir * 600);
            scene.time.delayedCall(1500, () => proj && proj.destroy());
          }
        },
      });
      scene.time.delayedCall(dur, () => Effects.rapid_fire.revert(scene));
    },
    revert(scene) {
      scene._rfActive = false;
      try { scene._rfTickHandle && scene._rfTickHandle.remove(); } catch (_e) {}
    },
  };

  Effects.shockwave_slam = {
    apply(scene, dur) {
      // Just sets a flag the ground_slam ability can read for radius bump
      scene._slamRadiusMul = 2.0;
      scene.time.delayedCall(dur, () => Effects.shockwave_slam.revert(scene));
    },
    revert(scene) { scene._slamRadiusMul = 1.0; },
  };

  Effects.flight = {
    apply(scene, dur) {
      if (!scene.player) return;
      scene._flGravWasOn = true;
      try { scene.player.body.setAllowGravity(false); } catch (_e) {}
      scene._flTickHandle = scene.time.addEvent({
        delay: 16, loop: true, callback: () => {
          if (!scene.player || !scene.player.active) return;
          // Up arrow / W lifts; Down arrow / S sinks
          const upDown = (scene.cursors && scene.cursors.up && scene.cursors.up.isDown) || (scene.wasd && scene.wasd.W && scene.wasd.W.isDown);
          const dnDown = (scene.cursors && scene.cursors.down && scene.cursors.down.isDown) || (scene.wasd && scene.wasd.S && scene.wasd.S.isDown);
          if (upDown) scene.player.setVelocityY(-220);
          else if (dnDown) scene.player.setVelocityY(220);
          else scene.player.setVelocityY(scene.player.body.velocity.y * 0.92);
        },
      });
      scene.player.setTint(0xff8800);
      scene.isInvincible = true;
      scene.time.delayedCall(dur, () => Effects.flight.revert(scene));
    },
    revert(scene) {
      if (!scene.player) return;
      try { scene._flTickHandle && scene._flTickHandle.remove(); } catch (_e) {}
      try { scene.player.body.setAllowGravity(true); } catch (_e) {}
      scene.player.clearTint();
      scene.isInvincible = false;
    },
  };

  Effects.cannon = {
    apply(scene, dur) {
      // Auto-launch toward nearest enemy with high velocity, briefly
      if (!scene.player || !scene.enemies) return;
      const p = scene.player;
      // Find nearest enemy
      let nearest = null, nd = 9999;
      scene.enemies.children.iterate(en => {
        if (!en || !en.active) return;
        const d = Math.hypot(en.x - p.x, en.y - p.y);
        if (d < nd) { nearest = en; nd = d; }
      });
      if (!nearest) return Effects.invincible.apply(scene, dur, { tint: 0x8b4513 });
      const ang = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      p.setVelocity(Math.cos(ang) * 700, Math.sin(ang) * 700);
      scene.isInvincible = true;
      p.setTint(0x8b4513);
      // After 1.5s the launch wears off; remaining duration is invuln coast
      scene.time.delayedCall(1500, () => {
        scene.isInvincible = false;
        if (scene.player) scene.player.clearTint();
      });
      scene.time.delayedCall(dur, () => Effects.cannon.revert(scene));
    },
    revert(scene) {
      scene.isInvincible = false;
      if (scene.player) scene.player.clearTint();
    },
  };

  // ── Name → Effect mapping (fuzzy) ──────────────────────────────────────
  const MAPPING = [
    { match: ["invincib", "golden", "spirit", "blitz_spirit"], effect: "invincible" },
    { match: ["shield", "orbit", "barrier"], effect: "shield" },
    { match: ["speed", "boost", "fruit_boost", "vine_whip"], effect: "speed_boost" },
    { match: ["giant", "blitz_spirit", "huge"], effect: "giant" },
    { match: ["banana_hoard", "rapid", "rapid_fire", "fire"], effect: "rapid_fire" },
    { match: ["thunder_stomp", "shockwave", "stomp"], effect: "shockwave_slam" },
    { match: ["rocket_barrel", "flight", "fly"], effect: "flight" },
    { match: ["barrel_cannon", "cannon", "homing"], effect: "cannon" },
  ];

  function resolve(name) {
    const norm = _norm(name);
    for (const m of MAPPING) {
      for (const k of m.match) if (norm.includes(k)) return Effects[m.effect];
    }
    return Effects.invincible;  // safe default
  }

  // ── Public ─────────────────────────────────────────────────────────────
  function activate(scene, name, durationSeconds) {
    const eff = resolve(name);
    if (!eff) return false;
    const ms = Math.max(1, (durationSeconds || 8)) * 1000;
    try {
      eff.apply(scene, ms);
      if (typeof scene.showFloatText === "function") {
        scene.showFloatText(scene.player.x, scene.player.y - 40, name.replace(/_/g, " "), "#ffd700");
      }
      if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
      return true;
    } catch (e) {
      console.warn("[PowerUps] activate failed for", name, e);
      return false;
    }
  }

  // Spawn a power-up sprite at (x, y) backed by design.power_ups[index].
  // The sprite has .powerUpName so the GameScene's collect overlap can call
  // activate(scene, sprite.powerUpName, sprite.duration).
  function spawn(scene, x, y, design) {
    if (!scene.powerUps) {
      scene.powerUps = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.powerUps, (_p, pu) => {
          activate(scene, pu.powerUpName, pu.duration);
          pu.destroy();
        }, null, scene);
      }
    }
    const sprite = scene.powerUps.create(x, y, "__pixel");
    sprite.setDisplaySize(22, 22);
    sprite.setTint(_pickColor(design && design.rarity));
    sprite.powerUpName = (design && design.name) || "Power Up";
    sprite.duration = (design && design.duration_seconds) || 8;
    return sprite;
  }
  function _pickColor(rarity) {
    return rarity === "epic" ? 0xff00ff : rarity === "rare" ? 0x00bfff : 0xffeb3b;
  }

  root.PowerUps = { activate, spawn, resolve, Effects };
})(typeof window !== "undefined" ? window : this);
