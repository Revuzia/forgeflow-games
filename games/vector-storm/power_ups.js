/**
 * power_ups.js — Classic platformer power-up system (Mario-inspired).
 *
 * Provides: mushroom (grow), fire flower (shoot), star (invincibility),
 * feather (flight), speed boost, magnet (collect range), double jump pickup.
 *
 * PHASER API:
 *   PowerUps.attach(scene, player);
 *   scene.powerUps.grant("mushroom");   // triggers immediately
 *   scene.powerUps.hasFlag("invincible");  // check state
 *   scene.powerUps.spawn(x, y, "fire_flower");  // drop a pickup
 *   scene.powerUps.onPickup = (type) => { ... };  // override for UI updates
 */
const PowerUps = {
  DEFINITIONS: {
    mushroom:     { label: "Grow",        duration_ms: 0,      effect: "grow",        color: 0xff3333 },
    fire_flower:  { label: "Fire Flower", duration_ms: 0,      effect: "shoot",       color: 0xff8800 },
    star:         { label: "Star",        duration_ms: 8000,   effect: "invincible",  color: 0xffdd00 },
    feather:      { label: "Feather",     duration_ms: 12000,  effect: "flight",      color: 0xffffff },
    speed_boost:  { label: "Speed",       duration_ms: 6000,   effect: "fast",        color: 0x00ddff },
    magnet:       { label: "Magnet",      duration_ms: 10000,  effect: "attract",     color: 0xaa33ff },
    double_jump:  { label: "Double Jump", duration_ms: 0,      effect: "unlock_dj",   color: 0x66ff66 },
    ice_flower:   { label: "Ice Flower",  duration_ms: 0,      effect: "freeze",      color: 0x88ccff },
    shield:       { label: "Shield",      duration_ms: 15000,  effect: "invincible",  color: 0xaaaaaa },
  },

  attach(scene, player) {
    scene.powerUps = {
      _player: player,
      _flags: {},      // active flags (invincible, fast, flight, attract)
      _timers: {},     // timeout IDs per flag
      _definitions: PowerUps.DEFINITIONS,

      grant(type) {
        const def = PowerUps.DEFINITIONS[type];
        if (!def) return;

        if (scene.juice) {
          scene.juice.flash(def.color, 120);
          scene.juice.rippleText(def.label.toUpperCase() + "!", player.x, player.y - 80, {
            size: "40px", color: `#${def.color.toString(16).padStart(6, "0")}`,
            duration: 1500,
          });
        }

        if (def.effect === "grow") {
          player.setScale(player.scaleX * 1.5, player.scaleY * 1.5);
          scene.powerUps._flags.big = true;
        } else if (def.effect === "unlock_dj") {
          scene.powerUps._flags.can_double_jump = true;
        } else if (def.effect === "shoot") {
          scene.powerUps._flags.can_shoot = true;
        } else if (def.effect === "freeze") {
          scene.powerUps._flags.can_freeze = true;
        } else if (def.duration_ms > 0) {
          // Timed effect
          scene.powerUps._flags[def.effect] = true;
          if (scene.powerUps._timers[def.effect]) {
            clearTimeout(scene.powerUps._timers[def.effect]);
          }
          scene.powerUps._timers[def.effect] = setTimeout(() => {
            scene.powerUps._flags[def.effect] = false;
            if (scene.juice) scene.juice.flash(0xffffff, 80);
          }, def.duration_ms);
        }

        if (scene.sound && scene.sound.get("sfx_power_up")) {
          scene.sound.play("sfx_power_up", { volume: 0.6 });
        }
        if (scene.powerUps.onPickup) scene.powerUps.onPickup(type);
      },

      hasFlag(flag) {
        return !!scene.powerUps._flags[flag];
      },

      spawn(x, y, type) {
        const def = PowerUps.DEFINITIONS[type];
        if (!def) return null;
        const p = scene.add.rectangle(x, y, 24, 24, def.color);
        p.setStrokeStyle(2, 0x000000);
        scene.physics.add.existing(p);
        p.body.setAllowGravity(false);
        // Bobbing animation
        scene.tweens.add({
          targets: p, y: y - 6, duration: 400, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        });
        // Overlap with player = pickup
        scene.physics.add.overlap(player, p, () => {
          scene.powerUps.grant(type);
          p.destroy();
        });
        p.powerType = type;
        return p;
      },

      getActiveFlags() {
        return { ...scene.powerUps._flags };
      },

      onPickup: null,  // user can override
    };
  },
};

if (typeof window !== "undefined") {
  window.PowerUps = PowerUps;
}
