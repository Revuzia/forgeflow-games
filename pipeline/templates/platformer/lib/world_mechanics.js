/* world_mechanics.js — per-world environmental effects.
 *
 * design.worlds[i].unique_mechanic specifies a per-world environmental rule
 * (e.g. "vine_swing_momentum", "wind", "darkness", "low_gravity", "ice",
 * "underwater"). This module implements each as a scene-attached effect:
 *
 *   WorldMechanics.attach(scene, designWorld) — bind for the current world
 *   WorldMechanics.tick(scene, time, delta)   — call from GameScene.update
 *   WorldMechanics.dispose(scene)             — call on level/world transition
 *
 * Each mechanic is plain JS data + a tick function. New worlds just add
 * a string + a tick handler.
 */
(function (root) {
  "use strict";

  function _norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  // ── Mechanics (each: { match: [...names], apply, tick, revert }) ──────
  const MECHANICS = [];

  // VINE SWING MOMENTUM — emphasized by Verdant Canopy (World 1).
  // Already implemented as an ability; here we just ensure the level has
  // some vines if the level synthesizer didn't already place them.
  MECHANICS.push({
    match: ["vine_swing", "vine", "grapple", "swing"],
    apply(scene) {
      // Ensure a vine group exists; the synthesizer's set-piece pass
      // populates it. If the current level has no vines, add 3 along
      // the upper arc so the mechanic reads visually.
      if (!scene.vines) scene.vines = scene.physics.add.staticGroup();
      if (scene.vines.children && scene.vines.children.entries.length === 0 && scene.map) {
        const w = scene.map.widthInPixels;
        for (let i = 1; i <= 3; i++) {
          const x = (w * i) / 4;
          const y = 80;
          const v = scene.vines.create(x, y, "__pixel");
          v.setDisplaySize(4, 90).setTint(0x4caf50);
          v.isVine = true;
        }
      }
    },
    tick() { /* the vine_swing ability handles per-frame interaction */ },
    revert() { /* nothing to revert */ },
  });

  // WIND — periodic horizontal force pushes the player.
  MECHANICS.push({
    match: ["wind", "gusts", "typhoon", "storm"],
    apply(scene) {
      scene._wmWind = { dir: 1, lastSwap: scene.time.now, push: 60 };
    },
    tick(scene, time, delta) {
      const w = scene._wmWind;
      if (!w || !scene.player) return;
      // Swap direction every 4-6 seconds
      if (time - w.lastSwap > 4000 + Math.random() * 2000) {
        w.dir *= -1;
        w.lastSwap = time;
        if (typeof scene.cameras !== "undefined" && scene.cameras.main) {
          scene.cameras.main.shake(120, 0.003);
        }
      }
      // Apply gentle constant horizontal force when in air
      const inAir = !scene.player.body.blocked.down;
      if (inAir && scene.player.body) {
        scene.player.body.velocity.x += w.dir * w.push * (delta / 1000);
      }
    },
    revert() {},
  });

  // DARKNESS / SILHOUETTE — vignette + reduced visibility, foreground unchanged.
  MECHANICS.push({
    match: ["dark", "silhouette", "shadow", "blackout"],
    apply(scene) {
      if (!scene.cameras || !scene.cameras.main) return;
      scene._wmFog = scene.add.rectangle(0, 0, scene.cameras.main.width, scene.cameras.main.height, 0x000000, 0.55);
      scene._wmFog.setOrigin(0, 0).setScrollFactor(0).setDepth(900);
    },
    tick() {},
    revert(scene) { try { scene._wmFog && scene._wmFog.destroy(); } catch (_e) {} },
  });

  // LOW GRAVITY — reduces gravity by 40% so jumps feel floaty.
  MECHANICS.push({
    match: ["low_gravity", "moon", "float"],
    apply(scene) {
      if (!scene.physics || !scene.physics.world || !scene.physics.world.gravity) return;
      scene._wmGravPrev = scene.physics.world.gravity.y;
      scene.physics.world.gravity.y = Math.max(150, scene._wmGravPrev * 0.45);
    },
    tick() {},
    revert(scene) {
      if (scene._wmGravPrev && scene.physics && scene.physics.world && scene.physics.world.gravity) {
        scene.physics.world.gravity.y = scene._wmGravPrev;
      }
    },
  });

  // ICE — slippery floor: horizontal speed has friction near zero.
  MECHANICS.push({
    match: ["ice", "slip", "frozen", "frostbite"],
    apply(scene) {
      scene._wmIce = true;
      // Override controller's per-frame "no input → vx=0" via a tick that
      // restores momentum
      scene._wmIceTickHandle = scene.time.addEvent({
        delay: 16, loop: true, callback: () => {
          if (!scene.player || !scene.player.body) return;
          // If player on ground and not pressing left/right, decay vx slowly
          const left = (scene.cursors && scene.cursors.left && scene.cursors.left.isDown) ||
                       (scene.wasd && scene.wasd.A && scene.wasd.A.isDown);
          const right = (scene.cursors && scene.cursors.right && scene.cursors.right.isDown) ||
                        (scene.wasd && scene.wasd.D && scene.wasd.D.isDown);
          const onGround = scene.player.body.blocked.down || scene.player.body.touching.down;
          if (onGround && !left && !right) {
            // Re-apply previous velocity decayed by 1.5%
            scene.player.body.velocity.x = (scene._wmIcePrevVx || 0) * 0.985;
          } else {
            scene._wmIcePrevVx = scene.player.body.velocity.x;
          }
        },
      });
    },
    tick() {},
    revert(scene) { try { scene._wmIceTickHandle && scene._wmIceTickHandle.remove(); } catch (_e) {} },
  });

  // UNDERWATER — half-speed, low gravity, jump becomes "swim up".
  MECHANICS.push({
    match: ["underwater", "swim", "abyss", "ocean"],
    apply(scene) {
      if (!scene.controller || !scene.controller.cfg) return;
      scene._wmUwSpeed = scene.controller.cfg.speed;
      scene.controller.cfg.speed *= 0.7;
      if (scene.physics && scene.physics.world && scene.physics.world.gravity) {
        scene._wmUwGrav = scene.physics.world.gravity.y;
        scene.physics.world.gravity.y = scene._wmUwGrav * 0.35;
      }
      // Blue tint overlay
      if (scene.cameras && scene.cameras.main) {
        scene._wmUwOverlay = scene.add.rectangle(0, 0, scene.cameras.main.width, scene.cameras.main.height, 0x004080, 0.18);
        scene._wmUwOverlay.setOrigin(0, 0).setScrollFactor(0).setDepth(800);
      }
    },
    tick(scene) {
      // Continuous up-press = swim up
      const up = (scene.cursors && scene.cursors.up && scene.cursors.up.isDown) || (scene.wasd && scene.wasd.W && scene.wasd.W.isDown);
      if (up && scene.player && scene.player.body) {
        scene.player.body.velocity.y = Math.max(scene.player.body.velocity.y - 8, -180);
      }
    },
    revert(scene) {
      if (scene._wmUwSpeed && scene.controller && scene.controller.cfg) scene.controller.cfg.speed = scene._wmUwSpeed;
      if (scene._wmUwGrav && scene.physics && scene.physics.world && scene.physics.world.gravity) scene.physics.world.gravity.y = scene._wmUwGrav;
      try { scene._wmUwOverlay && scene._wmUwOverlay.destroy(); } catch (_e) {}
    },
  });

  // MINECART — auto-run forced; jump = duck/jump only.
  MECHANICS.push({
    match: ["minecart", "auto_run", "rail", "track"],
    apply(scene) {
      scene._wmMinecart = true;
    },
    tick(scene) {
      if (scene._wmMinecart && scene.player && scene.player.body && _onGround(scene.player)) {
        scene.player.body.velocity.x = 350;
      }
    },
    revert(scene) { scene._wmMinecart = false; },
  });

  // CLOCKWORK / GEARS — periodic gear-grind shockwaves push player up.
  MECHANICS.push({
    match: ["clockwork", "gear", "mechanical", "citadel"],
    apply(scene) {
      scene._wmCw = { lastShock: 0 };
    },
    tick(scene, time) {
      const cw = scene._wmCw;
      if (!cw || !scene.player) return;
      if (time - cw.lastShock > 6000) {
        cw.lastShock = time;
        // Brief upward push
        scene.player.body.velocity.y = Math.min(scene.player.body.velocity.y, -150);
        _firePuff(scene, scene.player.x, scene.player.y + 20, 0xb0a060, 12);
      }
    },
    revert() {},
  });

  // CASTLE / FORTRESS — bg_castle texture + dim torch flicker overlay.
  MECHANICS.push({
    match: ["castle", "fortress", "stronghold", "keep", "dungeon"],
    apply(scene) {
      // Layer the castle bg if available
      if (scene.textures && scene.textures.exists("bg_castle") && scene.map) {
        scene._wmCastleBg = scene.add.image(0, 0, "bg_castle")
          .setOrigin(0, 0)
          .setDisplaySize(scene.map.widthInPixels, scene.map.heightInPixels)
          .setScrollFactor(0.4)
          .setDepth(-8);
      }
      // Torch flicker overlay — slight ambient warm tint that pulses
      if (scene.cameras && scene.cameras.main) {
        scene._wmCastleFlicker = scene.add.rectangle(0, 0, scene.cameras.main.width, scene.cameras.main.height, 0xffaa00, 0.06);
        scene._wmCastleFlicker.setOrigin(0, 0).setScrollFactor(0).setDepth(800);
        scene.tweens.add({
          targets: scene._wmCastleFlicker, alpha: 0.14,
          duration: 1200 + Math.random() * 400, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        });
      }
    },
    tick() {},
    revert(scene) {
      try { scene._wmCastleBg && scene._wmCastleBg.destroy(); } catch (_e) {}
      try { scene._wmCastleFlicker && scene._wmCastleFlicker.destroy(); } catch (_e) {}
    },
  });

  // LAVA — pool of damage at bottom of level + occasional bubbling pop.
  // Uses lava.png + lava_top.png if present; otherwise red rectangles.
  MECHANICS.push({
    match: ["lava", "molten", "scorched", "volcanic", "magma"],
    apply(scene) {
      if (!scene.map) return;
      const tile = scene.map.tileWidth || 18;
      const lavaY = (scene.map.height - 2) * tile;
      const w = scene.map.widthInPixels;
      // Lava rect across the bottom
      const useTex = scene.textures && scene.textures.exists("lava_top");
      scene._wmLavaSprites = [];
      // Body of lava — damage zone
      scene._wmLava = scene.physics.add.staticGroup();
      // Surface tiles every 18px
      for (let lx = 0; lx < w; lx += tile) {
        const surf = scene._wmLava.create(lx + tile / 2, lavaY, useTex ? "lava_top" : "__pixel");
        if (!useTex) surf.setDisplaySize(tile, tile).setTint(0xff3d00);
        else surf.setDisplaySize(tile, tile);
      }
      // Damage on overlap
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene._wmLava, () => {
          if (!scene.isInvincible && typeof scene.playerHit === "function") scene.playerHit();
        });
      }
      // Bubble particle pops every 1.2s
      scene._wmLavaTickEv = scene.time.addEvent({
        delay: 1200, loop: true, callback: () => {
          const px = Math.random() * w;
          const bub = scene.add.circle(px, lavaY - 4, 6, 0xff5722, 0.9).setDepth(50);
          scene.tweens.add({ targets: bub, y: lavaY - 50, alpha: 0, duration: 700, onComplete: () => bub.destroy() });
        },
      });
    },
    tick() {},
    revert(scene) {
      try { scene._wmLavaTickEv && scene._wmLavaTickEv.remove(); } catch (_e) {}
      // Static sprites destroyed by scene shutdown
    },
  });

  // FIRE / EMBER — periodic falling embers that damage on contact.
  MECHANICS.push({
    match: ["fire", "ember", "burning", "scorch"],
    apply(scene) {
      if (!scene.cameras || !scene.cameras.main) return;
      scene._wmFireTickEv = scene.time.addEvent({
        delay: 1500, loop: true, callback: () => {
          if (!scene.player) return;
          const cam = scene.cameras.main;
          const x = scene.player.x + (Math.random() - 0.5) * cam.width;
          const ember = scene.physics.add.sprite(x, cam.scrollY - 20, "__pixel")
            .setDisplaySize(8, 12).setTint(0xff8a65);
          ember.body.setAllowGravity(true).setVelocityY(180);
          scene.physics.add.overlap(ember, scene.player, () => {
            if (!scene.isInvincible && typeof scene.playerHit === "function") scene.playerHit();
            ember.destroy();
          });
          scene.time.delayedCall(4000, () => ember && ember.active && ember.destroy());
        },
      });
    },
    tick() {},
    revert(scene) { try { scene._wmFireTickEv && scene._wmFireTickEv.remove(); } catch (_e) {} },
  });

  // ENRICHED UNDERWATER — adds bubble particles + slows enemies too.
  // (Replaces the basic underwater above for any keyword match — the ARRAY
  // ORDER means new entries don't override; instead we can extend this
  // mechanic's `apply` with extra effects. Future: refactor MECHANICS lookup
  // to allow chaining.)

  function _onGround(p) {
    return p && p.body && (p.body.blocked.down || p.body.touching.down);
  }
  function _firePuff(scene, x, y, color, n) {
    if (typeof scene.emitDust === "function") { try { scene.emitDust(x, y, n); return; } catch (_e) {} }
    if (!scene.add || !scene.add.circle) return;
    for (let i = 0; i < (n || 6); i++) {
      const c = scene.add.circle(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 16, 3, color, 0.8);
      scene.tweens.add({ targets: c, alpha: 0, duration: 280, onComplete: () => c.destroy() });
    }
  }

  function _resolve(name) {
    const norm = _norm(name);
    for (const m of MECHANICS) {
      for (const k of m.match) if (norm.includes(k)) return m;
    }
    return null;
  }

  function attach(scene, designWorld) {
    if (!designWorld) return null;
    const candidate = designWorld.unique_mechanic || designWorld.theme || designWorld.name;
    const mech = _resolve(candidate);
    if (!mech) return null;
    try { mech.apply(scene); scene._worldMechanic = mech; }
    catch (e) { console.warn("[WorldMechanics] apply failed for", candidate, e); }
    return mech;
  }
  function tick(scene, time, delta) {
    if (scene._worldMechanic && typeof scene._worldMechanic.tick === "function") {
      try { scene._worldMechanic.tick(scene, time, delta); } catch (_e) {}
    }
  }
  function dispose(scene) {
    if (scene._worldMechanic && typeof scene._worldMechanic.revert === "function") {
      try { scene._worldMechanic.revert(scene); } catch (_e) {}
    }
    scene._worldMechanic = null;
  }

  root.WorldMechanics = { attach, tick, dispose, _resolve, MECHANICS };
})(typeof window !== "undefined" ? window : this);
