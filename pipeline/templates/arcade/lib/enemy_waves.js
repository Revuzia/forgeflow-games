/* enemy_waves.js — wave-based enemy spawning for twin-stick shooters.
 *
 * Geometry-Wars-style: arena stays static; enemies spawn in waves of
 * increasing density + variety. Wave clear → next wave (rest 2s).
 *
 * Enemy types (all generic geometric — works for any twin-stick game):
 *   chaser    — green diamond, slow direct chase
 *   wanderer  — blue square, random walk + slow follow on close
 *   splitter  — pink hexagon, splits into 2 small chasers on death
 *   snake     — yellow chain (head + 4 body segments), wavy chase
 *   bomb      — red circle, explodes on death (radial damage)
 *   sniper    — purple triangle, stationary, fires aimed shots
 *
 * Usage:
 *   EnemyWaves.start(scene, { wave: 1 });  // begin wave loop
 *   on enemy death:    EnemyWaves.notifyKill(scene)
 *   on wave clear:     auto-fires next wave
 */
(function (root) {
  "use strict";

  const TYPES = {
    chaser: {
      tint: 0x00ff66, size: 18, hp: 1, speed: 90, score: 50,
      tick(scene, en) {
        if (!scene.player) return;
        const ang = Math.atan2(scene.player.y - en.y, scene.player.x - en.x);
        en.body.setVelocity(Math.cos(ang) * 90, Math.sin(ang) * 90);
        en.rotation = ang;
      },
      onDeath() {},
    },
    wanderer: {
      tint: 0x42a5f5, size: 18, hp: 1, speed: 60, score: 75,
      tick(scene, en) {
        if (!scene.player) return;
        const d = Math.hypot(scene.player.x - en.x, scene.player.y - en.y);
        if (d < 160) {
          const ang = Math.atan2(scene.player.y - en.y, scene.player.x - en.x);
          en.body.setVelocity(Math.cos(ang) * 100, Math.sin(ang) * 100);
        } else {
          // Random wander
          if (!en._wanderTime || scene.time.now > en._wanderTime) {
            en._wanderTime = scene.time.now + 1200 + Math.random() * 800;
            const a = Math.random() * Math.PI * 2;
            en.body.setVelocity(Math.cos(a) * 60, Math.sin(a) * 60);
          }
        }
      },
      onDeath() {},
    },
    splitter: {
      tint: 0xff00aa, size: 24, hp: 2, speed: 70, score: 100,
      tick(scene, en) {
        if (!scene.player) return;
        const ang = Math.atan2(scene.player.y - en.y, scene.player.x - en.x);
        en.body.setVelocity(Math.cos(ang) * 70, Math.sin(ang) * 70);
        en.rotation = ang;
      },
      onDeath(scene, en) {
        // Spawn 2 small chasers
        for (let i = 0; i < 2; i++) {
          const offset = (i === 0 ? -20 : 20);
          spawn(scene, "chaser", en.x + offset, en.y);
        }
      },
    },
    bomb: {
      tint: 0xff5252, size: 22, hp: 1, speed: 120, score: 150,
      tick(scene, en) {
        if (!scene.player) return;
        const ang = Math.atan2(scene.player.y - en.y, scene.player.x - en.x);
        en.body.setVelocity(Math.cos(ang) * 120, Math.sin(ang) * 120);
      },
      onDeath(scene, en) {
        // Explosion: radial 80px damage
        const ring = scene.add.circle(en.x, en.y, 10, 0xff5252, 0)
          .setStrokeStyle(4, 0xff5252, 1).setDepth(45);
        scene.tweens.add({
          targets: ring, radius: 80, alpha: 0, duration: 400,
          onUpdate: () => {
            if (scene.player && Math.hypot(scene.player.x - en.x, scene.player.y - en.y) < ring.radius) {
              if (typeof scene.playerHit === "function" && !scene.isInvincible) scene.playerHit();
            }
          },
          onComplete: () => ring.destroy(),
        });
      },
    },
    snake: {
      tint: 0xffeb3b, size: 18, hp: 3, speed: 100, score: 200,
      tick(scene, en) {
        if (!scene.player) return;
        // Wavy approach
        const baseAng = Math.atan2(scene.player.y - en.y, scene.player.x - en.x);
        const wave = Math.sin(scene.time.now * 0.005) * 0.6;
        const ang = baseAng + wave;
        en.body.setVelocity(Math.cos(ang) * 100, Math.sin(ang) * 100);
        en.rotation = ang;
      },
      onDeath() {},
    },
    sniper: {
      tint: 0xab47bc, size: 20, hp: 2, speed: 0, score: 175,
      tick(scene, en) {
        // Fire aimed projectile every 2s
        if (!scene.player) return;
        en._lastShot = en._lastShot || 0;
        if (scene.time.now - en._lastShot > 2000) {
          en._lastShot = scene.time.now;
          if (!scene._enemyBullets) {
            scene._enemyBullets = scene.physics.add.group();
            if (scene.player) {
              scene.physics.add.overlap(scene.player, scene._enemyBullets, (p, b) => {
                if (typeof scene.playerHit === "function" && !scene.isInvincible) scene.playerHit();
                b.destroy();
              });
            }
          }
          const tex = scene.textures.exists("__bullet") ? "__bullet" : "__pixel";
          const b = scene._enemyBullets.create(en.x, en.y, tex);
          b.setDisplaySize(10, 10).setTint(0xab47bc);
          b.body.setAllowGravity && b.body.setAllowGravity(false);
          const ang = Math.atan2(scene.player.y - en.y, scene.player.x - en.x);
          b.body.setVelocity(Math.cos(ang) * 350, Math.sin(ang) * 350);
          scene.time.delayedCall(3000, () => b && b.active && b.destroy());
        }
      },
      onDeath() {},
    },
  };

  // Wave definitions: each is an array of (type, count) tuples
  const WAVES = [
    [["chaser", 5]],
    [["chaser", 8], ["wanderer", 2]],
    [["chaser", 6], ["wanderer", 4], ["splitter", 2]],
    [["chaser", 8], ["splitter", 3], ["sniper", 2]],
    [["chaser", 10], ["wanderer", 4], ["bomb", 3]],
    [["splitter", 5], ["snake", 2], ["sniper", 3]],
    [["chaser", 12], ["bomb", 4], ["snake", 3], ["sniper", 2]],
    [["splitter", 6], ["snake", 4], ["bomb", 5], ["sniper", 3]],
  ];

  function spawn(scene, type, x, y) {
    if (!scene.enemies) scene.enemies = scene.physics.add.group();
    const cfg = TYPES[type] || TYPES.chaser;
    const tex = scene.textures.exists("__pixel") ? "__pixel" : null;
    if (!tex) return;
    // Pick spawn position if not given (random edge of arena)
    if (x === undefined || y === undefined) {
      const cam = scene.cameras.main;
      const edge = Math.floor(Math.random() * 4);
      const margin = 30;
      if (edge === 0)      { x = Math.random() * cam.width;  y = -margin; }
      else if (edge === 1) { x = cam.width + margin; y = Math.random() * cam.height; }
      else if (edge === 2) { x = Math.random() * cam.width;  y = cam.height + margin; }
      else                 { x = -margin;            y = Math.random() * cam.height; }
    }
    const en = scene.enemies.create(x, y, tex);
    en.setDisplaySize(cfg.size, cfg.size).setTint(cfg.tint);
    en.body.setAllowGravity && en.body.setAllowGravity(false);
    en.body.setCircle(cfg.size / 2);
    en._type = type;
    en._cfg = cfg;
    en._hp = cfg.hp;
    en._scoreVal = cfg.score;
    return en;
  }

  function start(scene, opts) {
    opts = opts || {};
    scene._wave = opts.wave || 1;
    scene._waveActive = false;
    scene._enemiesAlive = 0;
    spawnWave(scene, scene._wave);
  }

  function spawnWave(scene, n) {
    const idx = (n - 1) % WAVES.length;
    const def = WAVES[idx];
    let count = 0;
    for (const [type, num] of def) {
      for (let i = 0; i < num; i++) {
        scene.time.delayedCall(i * 80, () => {
          spawn(scene, type);
          count++;
          scene._enemiesAlive++;
        });
      }
    }
    scene._waveActive = true;
    if (scene._waveText) scene._waveText.destroy();
    scene._waveText = scene.add.text(scene.cameras.main.width / 2, 30,
      `WAVE ${n}`, { fontSize: "24px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(900);
    scene.tweens.add({ targets: scene._waveText, alpha: 0, delay: 1500, duration: 800,
      onComplete: () => { scene._waveText && scene._waveText.destroy(); scene._waveText = null; }});
  }

  function notifyKill(scene) {
    scene._enemiesAlive = Math.max(0, (scene._enemiesAlive || 0) - 1);
    if (scene._enemiesAlive === 0 && scene._waveActive) {
      scene._waveActive = false;
      scene._wave = (scene._wave || 1) + 1;
      scene.time.delayedCall(2000, () => spawnWave(scene, scene._wave));
    }
  }

  function tick(scene, time, delta) {
    if (!scene.enemies) return;
    scene.enemies.children.iterate(en => {
      if (!en || !en.active) return;
      const t = TYPES[en._type] || TYPES.chaser;
      try { t.tick(scene, en); } catch (_e) {}
    });
  }

  root.EnemyWaves = { start, spawn, spawnWave, notifyKill, tick, TYPES, WAVES };
})(typeof window !== "undefined" ? window : this);
