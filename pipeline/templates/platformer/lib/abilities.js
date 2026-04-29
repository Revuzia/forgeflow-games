/* abilities.js — protagonist ability implementations.
 *
 * The pipeline researches each game and writes design.protagonist.abilities[]
 * as plain English ("Barrel Roll", "Ground Slam", "Vine Swing", "Barrel Boost",
 * "Wall Cling", "Dash", "Double Jump"). This file maps each ability NAME to a
 * concrete behaviour and exposes a single Abilities.attach(scene) entry point
 * that wires the right inputs and per-frame ticks for every ability listed.
 *
 * Every ability has the same lifecycle:
 *   - bind(scene)       — register input keys, internal state
 *   - tick(scene, delta) — per-frame update (called from GameScene.update)
 *   - dispose(scene)    — cleanup if scene shuts down (Phaser handles tweens)
 *
 * Each ability degrades gracefully if its required inputs/sprites are missing.
 *
 * The set of implemented abilities is intentionally a SUPERSET of any one
 * game's needs — design.protagonist.abilities filters down to what the
 * current game enables. Adding a new game just means adding a string; adding
 * a new ability means adding a new entry in IMPLEMENTATIONS below.
 */
(function (root) {
  "use strict";

  // ── Match a free-text ability name to a registered key. Tolerant to case,
  // whitespace, hyphens, and partial substrings ("Barrel Roll Attack" still
  // matches "barrel_roll"). Returns null if no implementation matches.
  function _normaliseName(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  // ── Common helpers ─────────────────────────────────────────────────────
  function _onGround(player) {
    if (!player || !player.body) return false;
    const b = player.body;
    return !!(b.blocked && b.blocked.down) || !!(b.touching && b.touching.down) ||
           (typeof b.onFloor === "function" && b.onFloor());
  }
  function _firePuff(scene, x, y, color, count) {
    // Use scene.emitDust if available; otherwise small local particles
    if (typeof scene.emitDust === "function") {
      try { scene.emitDust(x, y, count || 6); return; } catch (_e) { /* fall through */ }
    }
    if (!scene.add || !scene.add.circle) return;
    for (let i = 0; i < (count || 4); i++) {
      const c = scene.add.circle(x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12,
                                  3 + Math.random() * 2, color || 0xffffff, 0.8);
      c.setDepth(50);
      scene.tweens.add({
        targets: c, alpha: 0, scale: 0,
        duration: 300 + Math.random() * 200, onComplete: () => c.destroy(),
      });
    }
  }

  // ── BARREL ROLL ────────────────────────────────────────────────────────
  // Hold SHIFT while moving to spin up momentum (cap at 2.5x base speed).
  // Release SHIFT to launch a high-speed bouncing attack that one-shots
  // small enemies on contact and plays back to normal in 0.6s.
  const barrelRoll = {
    key: "barrel_roll",
    bind(scene) {
      scene._brState = { charging: false, charge: 0, launching: false, launchEnd: 0, lastTint: null };
    },
    tick(scene, time, delta) {
      const p = scene.player;
      const st = scene._brState;
      if (!p || !p.body || !st) return;
      const shiftDown = scene.shiftKey && scene.shiftKey.isDown;
      const moving = Math.abs(p.body.velocity.x) > 30;

      if (st.launching) {
        if (time >= st.launchEnd) {
          // 2026-04-29 BUGFIX: clear angularVelocity + rotation EVERY launch
          // end. Was leaving spin enabled — character spun forever.
          st.launching = false;
          if (st.lastTint != null) p.clearTint();
          st.lastTint = null;
          if (p.setAngularVelocity) p.setAngularVelocity(0);
          if (p.setRotation) p.setRotation(0);
        } else {
          if (scene.enemies && scene.physics) {
            scene.enemies.children && scene.enemies.children.iterate(function (en) {
              if (!en || !en.active) return;
              if (scene.physics.overlap(p, en) && scene.killEnemy) {
                scene.killEnemy(en);
              }
            });
          }
        }
        return;
      }

      if (shiftDown && moving && _onGround(p)) {
        st.charging = true;
        st.charge = Math.min(1.0, st.charge + delta / 600);
        const dir = p.flipX ? -1 : 1;
        const baseV = 200, maxV = 500;
        p.setVelocityX(dir * (baseV + (maxV - baseV) * st.charge));
        p.setTint(0xffaa44);
        st.lastTint = 0xffaa44;
        if (p.setAngularVelocity) p.setAngularVelocity(dir * 720);
      } else if (st.charging && !shiftDown) {
        st.charging = false;
        st.launching = true;
        st.launchEnd = time + 600;
        const dir = p.flipX ? -1 : 1;
        p.setVelocityX(dir * 600);
        p.setVelocityY(-200);
        if (typeof scene.playSound === "function") scene.playSound("sfx_jump");
        _firePuff(scene, p.x, p.y, 0xffaa44, 10);
        st.charge = 0;
      } else {
        // 2026-04-29 BUGFIX: ALWAYS clear spin/tint when not charging or
        // launching. Was conditional on (charging || charge > 0) which left
        // residual angularVelocity from prior frames. Now: hard reset every
        // tick when neither charging nor launching.
        if (st.charging) st.charging = false;
        st.charge = 0;
        if (st.lastTint != null) {
          p.clearTint();
          st.lastTint = null;
        }
        if (p.setAngularVelocity && p.body && p.body.angularVelocity !== 0) {
          p.setAngularVelocity(0);
        }
        if (p.setRotation && p.rotation !== 0) {
          p.setRotation(0);
        }
      }
    },
  };

  // ── GROUND SLAM / GROUND POUND ──────────────────────────────────────────
  // Press DOWN while in air → slam down hard, killing enemies on contact and
  // breaking crumble tiles directly below.
  const groundSlam = {
    key: "ground_slam",
    bind(scene) {
      scene._gsState = { slamming: false };
    },
    tick(scene, time, delta) {
      const p = scene.player;
      const st = scene._gsState;
      if (!p || !p.body || !st) return;
      const downDown =
        (scene.cursors && scene.cursors.down && scene.cursors.down.isDown) ||
        (scene.wasd && scene.wasd.S && scene.wasd.S.isDown);

      if (st.slamming) {
        if (_onGround(p)) {
          // Land — shockwave
          st.slamming = false;
          if (typeof scene.cameras !== "undefined" && scene.cameras.main) {
            scene.cameras.main.shake(180, 0.012);
          }
          _firePuff(scene, p.x, p.y + 12, 0xaaaaaa, 14);
          // Kill any enemy within 80px
          if (scene.enemies && scene.enemies.children) {
            scene.enemies.children.iterate(function (en) {
              if (!en || !en.active) return;
              const d = Math.hypot(en.x - p.x, en.y - p.y);
              if (d < 80 && scene.killEnemy) scene.killEnemy(en);
            });
          }
          if (typeof scene.playSound === "function") scene.playSound("sfx_hit");
        }
        return;
      }
      if (downDown && !_onGround(p) && p.body.velocity.y < 600) {
        st.slamming = true;
        p.setVelocityY(700);
        p.setVelocityX(0);
      }
    },
  };

  // ── VINE SWING ─────────────────────────────────────────────────────────
  // When the player jumps near a "vine" sprite (any sprite with .isVine),
  // they grab and pendulum from the vine's anchor point. Releasing JUMP
  // launches them off with conserved momentum.
  // Vines are placed by the level synthesizer / set-piece pass.
  const vineSwing = {
    key: "vine_swing",
    bind(scene) {
      scene._vsState = { attached: null, anchorX: 0, anchorY: 0, length: 0, angle: 0, omega: 0 };
    },
    tick(scene, time, delta) {
      const p = scene.player;
      const st = scene._vsState;
      if (!p || !p.body || !st || !scene.vines) return;

      if (st.attached) {
        // Pendulum: angular acceleration = -(g/L) * sin(theta)
        const g = (scene.physics && scene.physics.world && scene.physics.world.gravity)
          ? scene.physics.world.gravity.y : 800;
        const dt = (delta || 16) / 1000;
        const alpha = -(g / Math.max(40, st.length)) * Math.sin(st.angle);
        st.omega += alpha * dt;
        st.omega *= 0.99;  // damping
        st.angle += st.omega * dt;
        const x = st.anchorX + st.length * Math.sin(st.angle);
        const y = st.anchorY + st.length * Math.cos(st.angle);
        p.setPosition(x, y);
        p.body.setVelocity(0, 0);
        p.body.setAllowGravity(false);

        // Release on jump (spaceKey just-pressed)
        const jumpJust = scene.spaceKey && Phaser.Input.Keyboard.JustDown(scene.spaceKey);
        if (jumpJust) {
          // Tangential velocity = omega * length, direction perpendicular to rope
          const vx = st.omega * st.length * Math.cos(st.angle);
          const vy = -st.omega * st.length * Math.sin(st.angle) - 200;  // boost upward
          p.body.setAllowGravity(true);
          p.setVelocity(vx * 1.4, vy);  // momentum amplified for fun
          st.attached = null;
          if (typeof scene.playSound === "function") scene.playSound("sfx_jump");
        }
        return;
      }

      // Look for a vine to grab when in air + near
      if (_onGround(p)) return;
      let nearest = null, nd = 60;
      scene.vines.children && scene.vines.children.iterate(function (vine) {
        if (!vine || !vine.active) return;
        const d = Math.hypot(vine.x - p.x, (vine.y + 20) - p.y);  // grab a bit below the top
        if (d < nd) { nearest = vine; nd = d; }
      });
      if (nearest) {
        st.attached = nearest;
        st.anchorX = nearest.x;
        st.anchorY = nearest.y;
        st.length = Math.max(60, nearest.displayHeight || 80);
        // Initial angle = where player is relative to anchor
        const dx = p.x - st.anchorX;
        const dy = p.y - st.anchorY;
        st.angle = Math.atan2(dx, dy);
        st.omega = (p.body.velocity.x || 0) / Math.max(40, st.length);  // seed momentum
        if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
      }
    },
  };

  // ── BARREL BOOST ───────────────────────────────────────────────────────
  // Press E to consume N collected fruits → 3-second speed surge with afterimages.
  const barrelBoost = {
    key: "barrel_boost",
    bind(scene) {
      scene._bbState = { boosting: false, boostEnd: 0, lastEmit: 0 };
      try {
        scene._bbKey = scene.input.keyboard.addKey("E");
      } catch (_e) { scene._bbKey = null; }
    },
    tick(scene, time, delta) {
      const p = scene.player;
      const st = scene._bbState;
      if (!p || !st) return;
      // Activate
      if (scene._bbKey && Phaser.Input.Keyboard.JustDown(scene._bbKey) && !st.boosting) {
        // Fruit gate — needs 5 fruits to activate. If GAME_CONFIG has fruits, use it.
        const cur = (scene.fruits || 0);
        const cost = 5;
        if (cur >= cost) {
          scene.fruits = cur - cost;
          st.boosting = true;
          st.boostEnd = time + 3000;
          // Boost speed by 1.7x (controller config + body cap both bumped)
          if (scene.controller && scene.controller.cfg) {
            scene._bbPrevSpeed = scene.controller.cfg.speed;
            scene.controller.cfg.speed = scene._bbPrevSpeed * 1.7;
          }
          p.setTint(0xffeb3b);
          if (typeof scene.updateHUD === "function") scene.updateHUD();
          if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
        }
      }
      if (st.boosting) {
        // Afterimage every 60ms
        if (time - st.lastEmit > 60 && p && p.x !== undefined) {
          st.lastEmit = time;
          const ghost = scene.add.image(p.x, p.y, p.texture.key, p.frame.name);
          ghost.setAlpha(0.4); ghost.setTint(0xffeb3b); ghost.setScale(p.scaleX, p.scaleY);
          ghost.setDepth(p.depth - 1);
          scene.tweens.add({ targets: ghost, alpha: 0, duration: 220, onComplete: () => ghost.destroy() });
        }
        if (time >= st.boostEnd) {
          st.boosting = false;
          if (scene.controller && scene._bbPrevSpeed) {
            scene.controller.cfg.speed = scene._bbPrevSpeed;
          }
          p.clearTint();
        }
      }
    },
  };

  // ── WALL CLING ─────────────────────────────────────────────────────────
  // When player presses against a wall in midair, slow the fall (slide).
  // After 2 seconds, release.
  const wallCling = {
    key: "wall_cling",
    bind(scene) {
      scene._wcState = { clinging: false, clingStart: 0 };
    },
    tick(scene, time, delta) {
      const p = scene.player;
      const st = scene._wcState;
      if (!p || !p.body || !st) return;
      const blockedLeft = p.body.blocked && p.body.blocked.left;
      const blockedRight = p.body.blocked && p.body.blocked.right;
      const pushingLeft = scene.cursors && scene.cursors.left && scene.cursors.left.isDown;
      const pushingRight = scene.cursors && scene.cursors.right && scene.cursors.right.isDown;
      const inAir = !_onGround(p);

      const wallContact = inAir && ((blockedLeft && pushingLeft) || (blockedRight && pushingRight));

      if (wallContact) {
        if (!st.clinging) {
          st.clinging = true;
          st.clingStart = time;
        }
        if (time - st.clingStart < 2000) {
          // Slow descent
          if (p.body.velocity.y > 60) p.setVelocityY(60);
        } else {
          // Slip off after 2s
          st.clinging = false;
        }
      } else {
        st.clinging = false;
      }
    },
  };

  // ── DASH (sometimes registered as separate ability) ────────────────────
  // Already implemented in PlatformerController2D — just enable via cfg.
  const dash = {
    key: "dash",
    bind(scene) {
      if (scene.controller && scene.controller.cfg) {
        scene.controller.cfg.enableDash = true;
      }
    },
    tick(scene, time, delta) { /* handled in controller */ },
  };

  // ── DOUBLE JUMP (likewise) ─────────────────────────────────────────────
  const doubleJump = {
    key: "double_jump",
    bind(scene) {
      if (scene.controller && scene.controller.cfg) {
        scene.controller.cfg.enableDoubleJump = true;
      }
    },
    tick(scene, time, delta) { /* handled in controller */ },
  };

  // ── REGISTRY ───────────────────────────────────────────────────────────
  // Map normalised name → implementation. Aliases handled via array of names.
  const REGISTRY = [
    { names: ["barrel_roll", "roll", "spin_attack"], impl: barrelRoll },
    { names: ["ground_slam", "ground_pound", "slam"], impl: groundSlam },
    { names: ["vine_swing", "vine", "grapple"], impl: vineSwing },
    { names: ["barrel_boost", "boost", "fruit_boost", "speed_surge"], impl: barrelBoost },
    { names: ["wall_cling", "wall_slide", "cling"], impl: wallCling },
    { names: ["dash", "sprint"], impl: dash },
    { names: ["double_jump", "double"], impl: doubleJump },
  ];

  function _resolve(name) {
    const norm = _normaliseName(name);
    for (const entry of REGISTRY) {
      for (const n of entry.names) {
        if (norm === n || norm.includes(n)) return entry.impl;
      }
    }
    return null;
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────
  // Abilities.attach(scene): inspect design.protagonist.abilities, bind each.
  // Returns an array of resolved ability impls; scene.update() should call
  // Abilities.tick(scene, time, delta) once per frame.
  function attach(scene) {
    // Read protagonist abilities from window.GAME_DESIGN (the pipeline injects
    // the full design.json there at integrate time). Fallback chain:
    //   window.GAME_DESIGN.protagonist.abilities
    //   scene.GAME_DESIGN.protagonist.abilities (legacy)
    //   window.GAME_CONFIG.protagonist.abilities (legacy)
    let ablList = null;
    try {
      if (window.GAME_DESIGN && window.GAME_DESIGN.protagonist && Array.isArray(window.GAME_DESIGN.protagonist.abilities)) {
        ablList = window.GAME_DESIGN.protagonist.abilities;
      } else if (scene.GAME_DESIGN && scene.GAME_DESIGN.protagonist && Array.isArray(scene.GAME_DESIGN.protagonist.abilities)) {
        ablList = scene.GAME_DESIGN.protagonist.abilities;
      } else if (window.GAME_CONFIG && window.GAME_CONFIG.protagonist && Array.isArray(window.GAME_CONFIG.protagonist.abilities)) {
        ablList = window.GAME_CONFIG.protagonist.abilities;
      }
    } catch (_e) {}
    ablList = ablList || [];

    const enabled = [];
    for (const raw of ablList) {
      const impl = _resolve(raw);
      if (impl && enabled.indexOf(impl) === -1) {
        try { impl.bind(scene); enabled.push(impl); }
        catch (e) { console.warn("[Abilities] bind failed for", raw, e); }
      }
    }
    scene._abilities = enabled;
    return enabled;
  }

  function tick(scene, time, delta) {
    if (!scene._abilities) return;
    for (const a of scene._abilities) {
      try { a.tick(scene, time, delta); }
      catch (e) {
        if (!a._erred) { console.warn("[Abilities] tick failed for", a.key, e); a._erred = true; }
      }
    }
  }

  root.Abilities = { attach, tick, _resolve, REGISTRY };
})(typeof window !== "undefined" ? window : this);
