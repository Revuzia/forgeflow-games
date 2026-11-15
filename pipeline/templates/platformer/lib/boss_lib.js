/* boss_lib.js — generic boss-fight runner driven by design.bosses[].
 *
 * design.bosses[i] = {
 *   name, phases: [{ phase_num, hp, attacks: [str...], tells: [str...], weakness }]
 * }
 *
 * BossLib.create(scene, designBoss) instantiates a "boss" object on the scene
 * with HP, phase tracking, and a per-frame tick that sequences attacks. The
 * attacks array is fuzzy-matched against a registry of pattern handlers; any
 * attack name that includes a known keyword fires the matching handler.
 *
 * Usage:
 *   const boss = BossLib.create(this, designBoss);
 *   ...
 *   update(time, delta) { boss.tick(time, delta); }
 *   ...
 *   on player projectile hit: boss.takeDamage(1);
 */
(function (root) {
  "use strict";

  function _norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
  function _onGround(p) {
    return p && p.body && (p.body.blocked.down || p.body.touching.down);
  }
  function _firePuff(scene, x, y, color, n) {
    if (!scene.add) return;
    for (let i = 0; i < (n || 6); i++) {
      const c = scene.add.circle(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, 4, color, 0.85);
      scene.tweens.add({ targets: c, alpha: 0, duration: 350, onComplete: () => c.destroy() });
    }
  }

  // ── Attack patterns ────────────────────────────────────────────────────
  const ATTACKS = [];

  // VINE WHIP / SLAM — two telegraphed slam columns that hurt on contact
  ATTACKS.push({
    keys: ["vine_whip", "vine", "slam", "whip", "arm"],
    fire(scene, boss) {
      const p = scene.player;
      if (!p) return;
      // Telegraph: glow column at player x for 600ms, then damage zone
      const targetX = p.x;
      const tele = scene.add.rectangle(targetX, 300, 60, 600, 0x4caf50, 0.35).setDepth(40);
      scene.tweens.add({ targets: tele, alpha: 0.6, duration: 600, yoyo: true });
      scene.time.delayedCall(700, () => {
        tele.destroy();
        const slam = scene.add.rectangle(targetX, 300, 60, 600, 0x33691e, 0.85).setDepth(45);
        if (scene.physics && scene.player && scene.physics.overlap(slam, scene.player) && !scene.isInvincible) {
          if (typeof scene.playerHit === "function") scene.playerHit();
        }
        scene.time.delayedCall(220, () => slam.destroy());
      });
    },
  });

  // SEED BARRAGE / SPREAD PROJECTILES — fire 8 projectiles in spread
  ATTACKS.push({
    keys: ["seed", "barrage", "spread", "shot", "projectile"],
    fire(scene, boss) {
      if (!boss._sprite) return;
      if (!boss._projectiles) {
        boss._projectiles = scene.physics.add.group();
        if (scene.player) {
          scene.physics.add.overlap(boss._projectiles, scene.player, (proj) => {
            if (!scene.isInvincible && typeof scene.playerHit === "function") scene.playerHit();
            proj.destroy();
          });
        }
      }
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI / 8) * (i - 3.5) - Math.PI / 2;
        const proj = boss._projectiles.create(boss._sprite.x, boss._sprite.y, "__projectile");
        proj.setTint(0x8d6e63);
        proj.body.setAllowGravity(true);
        proj.setVelocity(Math.cos(ang) * 250, Math.sin(ang) * 250 - 100);
        scene.time.delayedCall(3500, () => proj && proj.active && proj.destroy());
      }
    },
  });

  // ROOT CAGE / TRAP — spawn 3x3 grid of damage tiles around the player
  ATTACKS.push({
    keys: ["root_cage", "cage", "trap", "ensnare", "summon"],
    fire(scene, boss) {
      const p = scene.player;
      if (!p) return;
      const tile = 32;
      const traps = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const tx = p.x + dx * tile, ty = p.y + dy * tile;
          const r = scene.add.rectangle(tx, ty, tile - 4, tile - 4, 0x6d4c41, 0.7).setDepth(40);
          traps.push(r);
        }
      }
      // Damage tick
      const tickEv = scene.time.addEvent({
        delay: 100, repeat: 12, callback: () => {
          for (const t of traps) {
            if (!t.active) continue;
            if (Math.abs(scene.player.x - t.x) < 20 && Math.abs(scene.player.y - t.y) < 20) {
              if (!scene.isInvincible && typeof scene.playerHit === "function") scene.playerHit();
              break;
            }
          }
        },
      });
      scene.time.delayedCall(1500, () => { traps.forEach(t => t.destroy()); tickEv.remove(); });
    },
  });

  // FLAME BREATH / FIRE BEAM — horizontal sweeping beam
  ATTACKS.push({
    keys: ["flame", "fire", "breath", "beam", "burn"],
    fire(scene, boss) {
      if (!boss._sprite) return;
      const beam = scene.add.rectangle(boss._sprite.x - 200, boss._sprite.y, 400, 30, 0xff5722, 0.85).setDepth(40);
      scene.tweens.add({
        targets: beam, x: boss._sprite.x + 200, duration: 1200,
        onUpdate: () => {
          if (!scene.isInvincible && scene.physics && scene.physics.overlap(beam, scene.player)) {
            if (typeof scene.playerHit === "function") scene.playerHit();
          }
        },
        onComplete: () => beam.destroy(),
      });
    },
  });

  // METEOR SHOWER / FALLING ROCKS — drop 5-8 from above at telegraphed positions
  ATTACKS.push({
    keys: ["meteor", "rock", "fall", "shower", "barrage_rock"],
    fire(scene, boss) {
      const cam = scene.cameras && scene.cameras.main;
      if (!cam) return;
      const w = scene.map ? scene.map.widthInPixels : cam.width;
      const xs = [];
      for (let i = 0; i < 6; i++) xs.push(Math.random() * w);
      // Telegraph shadows
      for (const x of xs) {
        const shadow = scene.add.ellipse(x, scene.map ? (scene.map.height - 5) * 18 : cam.height - 60, 50, 12, 0x000000, 0.4).setDepth(38);
        scene.tweens.add({ targets: shadow, alpha: 0.7, duration: 700, yoyo: true });
        scene.time.delayedCall(800, () => {
          shadow.destroy();
          const rock = scene.physics.add.sprite(x, 0, "__projectile").setTint(0x6d4c41).setDisplaySize(28, 28);
          rock.body.setAllowGravity(true).setVelocityY(400);
          if (scene.player) {
            scene.physics.add.overlap(rock, scene.player, () => {
              if (!scene.isInvincible && typeof scene.playerHit === "function") scene.playerHit();
              rock.destroy();
            });
          }
          scene.time.delayedCall(3000, () => rock && rock.active && rock.destroy());
        });
      }
    },
  });

  // CHARGE / DASH — boss dashes across the arena
  ATTACKS.push({
    keys: ["charge", "dash", "rush", "trample", "leap"],
    fire(scene, boss) {
      if (!boss._sprite) return;
      const dir = scene.player && scene.player.x < boss._sprite.x ? -1 : 1;
      // Wind-up
      boss._sprite.setTint(0xff5252);
      scene.time.delayedCall(500, () => {
        boss._sprite.setVelocityX && boss._sprite.setVelocityX(dir * 600);
        scene.time.delayedCall(900, () => {
          if (!boss._sprite || !boss._sprite.active) return;
          boss._sprite.setVelocityX && boss._sprite.setVelocityX(0);
          boss._sprite.clearTint();
        });
      });
    },
  });

  // SHOCKWAVE / GROUND SLAM
  ATTACKS.push({
    keys: ["shockwave", "ground_slam", "stomp", "quake"],
    fire(scene, boss) {
      if (!boss._sprite) return;
      // Ring expanding from boss
      const ring = scene.add.circle(boss._sprite.x, boss._sprite.y + 40, 10, 0xffa726, 0).setDepth(40);
      ring.setStrokeStyle(4, 0xffa726, 1);
      scene.tweens.add({
        targets: ring, radius: 300, alpha: 0, duration: 800,
        onUpdate: () => {
          if (!scene.isInvincible && scene.player && Math.abs(scene.player.x - ring.x) < ring.radius && _onGround(scene.player)) {
            if (typeof scene.playerHit === "function") scene.playerHit();
            scene.tweens.killTweensOf(ring); ring.destroy();
          }
        },
        onComplete: () => ring.destroy(),
      });
    },
  });

  // ── Pattern resolution ────────────────────────────────────────────────
  function _resolveAttack(name) {
    const norm = _norm(name);
    for (const a of ATTACKS) {
      for (const k of a.keys) if (norm.includes(k)) return a;
    }
    // Default: charge
    return ATTACKS.find(a => a.keys.includes("charge"));
  }

  // ── Boss instance ─────────────────────────────────────────────────────
  function create(scene, designBoss, options) {
    options = options || {};
    const boss = {
      design: designBoss || { name: "Boss", phases: [{ hp: 10, attacks: ["charge"] }] },
      currentPhase: 0,
      hp: 0,
      maxHp: 0,
      lastAttackAt: 0,
      attackInterval: 1800,
      _sprite: null,
      _hpBar: null,
    };
    // Build sprite — use enemies_atlas if available, else __platform tinted big
    const atlasKey = (scene.textures && scene.textures.exists("enemies_atlas")) ? "enemies_atlas" : "__platform";
    const x = options.x || (scene.cameras && scene.cameras.main ? scene.cameras.main.width * 0.7 : 600);
    const y = options.y || (scene.cameras && scene.cameras.main ? scene.cameras.main.height * 0.5 : 300);
    boss._sprite = scene.physics.add.sprite(x, y, atlasKey, atlasKey === "enemies_atlas" ? "frog_idle" : 0);
    boss._sprite.setScale(2.5);
    boss._sprite.setTint(0x8b4513);
    boss._sprite.setCollideWorldBounds(true);
    if (boss._sprite.body) {
      boss._sprite.body.setAllowGravity(false);
      boss._sprite.body.setImmovable(true);
    }

    // Player ↔ boss collision = damage
    if (scene.player) {
      scene.physics.add.overlap(scene.player, boss._sprite, () => {
        if (!scene.isInvincible) {
          // Stomp from above kills 1 HP
          if (scene.player.body.velocity.y > 0 && scene.player.y < boss._sprite.y - 20) {
            boss.takeDamage(1);
            scene.player.setVelocityY(-300);
          } else if (typeof scene.playerHit === "function") {
            scene.playerHit();
          }
        }
      });
    }

    // HP bar at top
    const cam = scene.cameras && scene.cameras.main;
    if (cam) {
      boss._hpBarBg = scene.add.rectangle(cam.width / 2, 30, 400, 20, 0x000000, 0.7).setScrollFactor(0).setDepth(900);
      boss._hpBar = scene.add.rectangle(cam.width / 2 - 200, 30, 400, 16, 0xff3030).setOrigin(0, 0.5).setScrollFactor(0).setDepth(901);
      boss._nameTxt = scene.add.text(cam.width / 2, 10, boss.design.name || "BOSS",
        { fontSize: "16px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(902);
    }

    boss.maxHp = (boss.design.phases || []).reduce((s, p) => s + (p.hp || 10), 0);
    boss.hp = boss.maxHp;

    // ── Phase / attack sequencing ─────────────────────────────────────
    boss.tick = function (time, delta) {
      if (!boss._sprite || !boss._sprite.active) return;
      // Update HP bar
      if (boss._hpBar) {
        const ratio = Math.max(0, boss.hp / boss.maxHp);
        boss._hpBar.scaleX = ratio;
      }
      // Sequence attacks every attackInterval ms
      if (time - boss.lastAttackAt > boss.attackInterval) {
        boss.lastAttackAt = time;
        const phase = boss.design.phases[boss.currentPhase];
        if (!phase || !phase.attacks || !phase.attacks.length) return;
        const attackName = phase.attacks[Math.floor(Math.random() * phase.attacks.length)];
        const handler = _resolveAttack(attackName);
        if (handler) {
          try { handler.fire(scene, boss); } catch (e) { console.warn("[BossLib] attack failed:", attackName, e); }
        }
      }
    };

    boss.takeDamage = function (amount) {
      if (boss.hp <= 0) return;
      boss.hp = Math.max(0, boss.hp - (amount || 1));
      boss._sprite.setTint(0xffeb3b);
      scene.time.delayedCall(150, () => boss._sprite && boss._sprite.setTint(0x8b4513));
      _firePuff(scene, boss._sprite.x, boss._sprite.y, 0xffeb3b, 8);
      // Phase transition
      let cumulative = 0;
      for (let i = 0; i < boss.design.phases.length; i++) {
        cumulative += (boss.design.phases[i].hp || 10);
        if (boss.maxHp - boss.hp >= cumulative && boss.currentPhase < i + 1) {
          boss.currentPhase = i + 1;
          boss.attackInterval = Math.max(800, 1800 - boss.currentPhase * 250);
          if (typeof scene.cameras !== "undefined" && scene.cameras.main) scene.cameras.main.flash(200, 255, 255, 255);
          if (typeof scene.showFloatText === "function") {
            scene.showFloatText(boss._sprite.x, boss._sprite.y - 80, `PHASE ${boss.currentPhase + 1}!`, "#ffeb3b");
          }
        }
      }
      if (boss.hp <= 0) boss.kill();
    };

    boss.kill = function () {
      if (!boss._sprite) return;
      _firePuff(scene, boss._sprite.x, boss._sprite.y, 0xffd700, 30);
      if (typeof scene.cameras !== "undefined" && scene.cameras.main) scene.cameras.main.shake(400, 0.02);
      scene.tweens.add({
        targets: boss._sprite, alpha: 0, scale: 0.1, angle: 720,
        duration: 1000,
        onComplete: () => {
          boss._sprite && boss._sprite.destroy();
          boss._hpBar && boss._hpBar.destroy();
          boss._hpBarBg && boss._hpBarBg.destroy();
          boss._nameTxt && boss._nameTxt.destroy();
          // Notify scene to advance
          if (typeof scene.onBossDefeated === "function") scene.onBossDefeated(boss);
          else if (scene.scene) scene.scene.start("Win", { score: scene.score || 0 });
        },
      });
    };

    return boss;
  }

  root.BossLib = { create, _resolveAttack, ATTACKS };
})(typeof window !== "undefined" ? window : this);
