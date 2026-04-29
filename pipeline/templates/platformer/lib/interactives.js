/* interactives.js — universal interactive entities for platformers.
 *
 * Drop-in helpers for:
 *   - Springs / springboards (jump pads)
 *   - Buttons / switches (toggleable platforms / doors)
 *   - Levers (3-state)
 *   - Question blocks (Mario-style item box)
 *   - Locked doors + keys (collect key → door opens)
 *   - Ladders (vertical climb)
 *   - Conveyor belts (auto-move)
 *   - Springboard (vertical bounce)
 *   - Checkpoint flags
 *
 * Each helper takes `(scene, x, y, opts?)` and returns the created sprite.
 * Internal collision/overlap is auto-wired against `scene.player`.
 *
 * Texture keys assumed to be loaded by the asset_loader.js helper:
 *   spring, spring_active, switch_<color>, switch_<color>_pressed, lever,
 *   lever_left, lever_right, block_coin, block_coin_active, key_<color>,
 *   door_closed, door_open, ladder_top, ladder_middle, ladder_bottom,
 *   conveyor, water, lava, flag_<color>
 *
 * If a texture is missing the helper falls back to a colored rectangle.
 */
(function (root) {
  "use strict";

  function _has(scene, key) { return scene.textures && scene.textures.exists(key); }
  function _safeKey(scene, key, fallbackColor) {
    if (_has(scene, key)) return key;
    // Use the BootScene-generated __pixel and tint
    if (_has(scene, "__pixel")) return "__pixel";
    return null;
  }

  // ── SPRING / SPRINGBOARD ───────────────────────────────────────────────
  // Player landing on top → upward velocity boost.
  function spring(scene, x, y, opts) {
    if (!scene.springs) {
      scene.springs = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.springs, (p, sp) => {
          if (p.body.velocity.y >= 0 && p.y < sp.y) {
            p.setVelocityY((opts && opts.power) || -700);
            // Briefly show "active" texture
            if (sp._activeKey && _has(scene, sp._activeKey)) {
              const orig = sp.texture.key;
              sp.setTexture(sp._activeKey);
              scene.time.delayedCall(150, () => sp.setTexture(orig));
            }
            if (typeof scene.playSound === "function") scene.playSound("sfx_jump");
          }
        });
      }
    }
    const key = _safeKey(scene, "spring", 0xffeb3b);
    const sp = scene.springs.create(x, y, key);
    sp._activeKey = "spring_out";
    if (!_has(scene, "spring")) sp.setTint(0xffeb3b).setDisplaySize(28, 16);
    return sp;
  }

  // ── SWITCH / BUTTON ────────────────────────────────────────────────────
  // Player overlap → fires a toggle callback exactly once per stand.
  function switchTile(scene, x, y, color, onActivate) {
    color = color || "blue";
    if (!scene.switches) {
      scene.switches = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.switches, (p, sw) => {
          if (sw._fired) return;
          sw._fired = true;
          const pressedKey = `switch_${sw._color}_pressed`;
          if (_has(scene, pressedKey)) sw.setTexture(pressedKey);
          else sw.setTint(0x66bb6a);
          try { sw._cb && sw._cb(scene, sw); } catch (_e) {}
          if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
        });
      }
    }
    const key = _safeKey(scene, `switch_${color}`, 0xffeb3b);
    const sw = scene.switches.create(x, y, key);
    sw._color = color;
    sw._cb = onActivate;
    if (!_has(scene, `switch_${color}`)) sw.setDisplaySize(20, 20).setTint(0xffeb3b);
    return sw;
  }

  // ── QUESTION BLOCK (Mario item box) ───────────────────────────────────
  // Player hits underside → block "pops", spawns coin/power-up upward.
  function questionBlock(scene, x, y, opts) {
    if (!scene.qBlocks) {
      scene.qBlocks = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.collider(scene.player, scene.qBlocks, (p, qb) => {
          if (qb._consumed) return;
          // Hit from below if player is moving up AND below block
          if (p.body.velocity.y < 0 && p.y > qb.y) {
            qb._consumed = true;
            if (_has(scene, "block_coin_active")) qb.setTexture("block_coin_active");
            else qb.setTint(0x444444);
            // Spawn the loot
            const loot = qb._loot || "coin";
            if (loot === "coin") {
              if (scene.score !== undefined) scene.score += 50;
              if (typeof scene.updateHUD === "function") scene.updateHUD();
              // Coin pop animation
              const c = scene.add.image(qb.x, qb.y - 10, _has(scene, "hud_coins") ? "hud_coins" : "__pixel");
              if (!_has(scene, "hud_coins")) c.setTint(0xffd700).setDisplaySize(12, 12);
              scene.tweens.add({ targets: c, y: qb.y - 60, alpha: 0, duration: 600, onComplete: () => c.destroy() });
            } else if (loot === "powerup" && window.PowerUps) {
              const pu = (window.GAME_DESIGN && window.GAME_DESIGN.power_ups) || [];
              if (pu.length) window.PowerUps.activate(scene, pu[0].name, pu[0].duration_seconds);
            }
            if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
          }
        });
      }
    }
    const key = _safeKey(scene, "block_coin", 0xffeb3b);
    const qb = scene.qBlocks.create(x, y, key);
    qb._loot = (opts && opts.loot) || "coin";
    if (!_has(scene, "block_coin")) qb.setDisplaySize(28, 28).setTint(0xffeb3b);
    return qb;
  }

  // ── KEY + LOCKED DOOR ─────────────────────────────────────────────────
  // Player picks up matching-color key → door becomes passable.
  const _doorKeyState = {}; // {color: bool} per scene (resets per scene start)

  function key(scene, x, y, color) {
    color = color || "yellow";
    if (!scene.keys) {
      scene.keys = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.keys, (p, k) => {
          if (k._collected) return;
          k._collected = true;
          if (!scene._keyBag) scene._keyBag = {};
          scene._keyBag[k._color] = true;
          k.destroy();
          if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
          // Visual flash
          if (typeof scene.cameras !== "undefined" && scene.cameras.main) {
            scene.cameras.main.flash(120, 200, 200, 80);
          }
        });
      }
    }
    const tex = _safeKey(scene, `key_${color}`, 0xffeb3b);
    const k = scene.keys.create(x, y, tex);
    k._color = color;
    if (!_has(scene, `key_${color}`)) k.setDisplaySize(16, 24).setTint(0xffeb3b);
    return k;
  }

  function lockedDoor(scene, x, y, color) {
    color = color || "yellow";
    if (!scene.doors) {
      scene.doors = scene.physics.add.staticGroup();
      // Doors block player by default unless their key is in the bag
      if (scene.player) {
        scene.physics.add.collider(scene.player, scene.doors, (p, d) => {
          if (scene._keyBag && scene._keyBag[d._color]) {
            // Open!
            if (_has(scene, "door_open")) d.setTexture("door_open");
            else d.setAlpha(0.3);
            d.body.enable = false;
          }
        });
      }
    }
    const tex = _safeKey(scene, "door_closed", 0xa1887f);
    const d = scene.doors.create(x, y, tex);
    d._color = color;
    if (!_has(scene, "door_closed")) d.setDisplaySize(24, 48).setTint(0xa1887f);
    return d;
  }

  // ── LADDER (climbable) ────────────────────────────────────────────────
  // Player overlap + UP/DOWN keys → suspend gravity, vertical move.
  function ladder(scene, x, y, height) {
    height = height || 4;
    if (!scene.ladders) {
      scene.ladders = scene.physics.add.staticGroup();
      // Per-frame check (cheap, only when player overlaps)
      scene._ladderTickEv = scene.time.addEvent({
        delay: 16, loop: true, callback: () => {
          if (!scene.player || !scene.player.body) return;
          let onLadder = false;
          scene.ladders.children.iterate(l => {
            if (!l) return;
            if (scene.physics.overlap(scene.player, l)) onLadder = true;
          });
          if (onLadder) {
            const up = (scene.cursors && scene.cursors.up && scene.cursors.up.isDown) || (scene.wasd && scene.wasd.W && scene.wasd.W.isDown);
            const dn = (scene.cursors && scene.cursors.down && scene.cursors.down.isDown) || (scene.wasd && scene.wasd.S && scene.wasd.S.isDown);
            if (up || dn) {
              try { scene.player.body.setAllowGravity(false); } catch (_e) {}
              scene.player.body.velocity.y = up ? -160 : 160;
            }
          } else if (scene._ladderWasOn) {
            try { scene.player.body.setAllowGravity(true); } catch (_e) {}
          }
          scene._ladderWasOn = onLadder;
        },
      });
    }
    // Place top, middle*N-2, bottom
    const tile = scene.map ? scene.map.tileWidth : 18;
    const top = scene.ladders.create(x, y, _safeKey(scene, "ladder_top", 0x8d6e63));
    if (!_has(scene, "ladder_top")) top.setDisplaySize(18, 18).setTint(0x8d6e63);
    for (let i = 1; i < height - 1; i++) {
      const m = scene.ladders.create(x, y + i * tile, _safeKey(scene, "ladder_middle", 0x8d6e63));
      if (!_has(scene, "ladder_middle")) m.setDisplaySize(18, 18).setTint(0x8d6e63);
    }
    const bot = scene.ladders.create(x, y + (height - 1) * tile, _safeKey(scene, "ladder_bottom", 0x8d6e63));
    if (!_has(scene, "ladder_bottom")) bot.setDisplaySize(18, 18).setTint(0x8d6e63);
    return top;
  }

  // ── CONVEYOR ───────────────────────────────────────────────────────────
  // Player on top → applies horizontal force.
  function conveyor(scene, x, y, length, dir) {
    length = length || 5;
    dir = dir || 1; // 1 = right, -1 = left
    if (!scene.conveyors) {
      scene.conveyors = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.collider(scene.player, scene.conveyors, (p, c) => {
          // Only push when standing on top
          if (Math.abs(p.body.bottom - c.body.top) < 4) {
            p.body.velocity.x += c._dir * 90 / 60;
          }
        });
      }
    }
    const tile = scene.map ? scene.map.tileWidth : 18;
    for (let i = 0; i < length; i++) {
      const c = scene.conveyors.create(x + i * tile, y, _safeKey(scene, "conveyor", 0xfbc02d));
      if (!_has(scene, "conveyor")) c.setDisplaySize(18, 12).setTint(0xfbc02d);
      c._dir = dir;
      // Animate (slide texture)
      scene.tweens.add({ targets: c, x: c.x + (dir * 18), duration: 1000, repeat: -1, ease: "Linear" });
    }
  }

  // ── CHECKPOINT FLAG ────────────────────────────────────────────────────
  // Player overlap → save respawn point.
  function checkpoint(scene, x, y, color) {
    color = color || "blue";
    if (!scene.checkpoints) {
      scene.checkpoints = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.checkpoints, (p, ckpt) => {
          if (ckpt._activated) return;
          ckpt._activated = true;
          scene.respawnPoint = { x: ckpt.x, y: ckpt.y - 30 };
          if (typeof scene.showFloatText === "function") scene.showFloatText(ckpt.x, ckpt.y - 40, "CHECKPOINT", "#ffeb3b");
          if (typeof scene.playSound === "function") scene.playSound("sfx_collect");
          ckpt.setTint(0x66bb6a);
        });
      }
    }
    const tex = _safeKey(scene, `flag_${color}`, 0x42a5f5) || _safeKey(scene, "flagBlue", 0x42a5f5);
    const f = scene.checkpoints.create(x, y, tex);
    if (!tex) f.setDisplaySize(16, 48).setTint(0x42a5f5);
    return f;
  }

  // ── PIPE (Mario-style green tube — generated at runtime since no sprite) ──
  // Two-piece: thicker top "lip" + tall body. Player on top can press DOWN
  // to enter (warps to a destination set on the pipe).
  function pipe(scene, x, y, height, destX, destY) {
    height = height || 3;
    if (!scene.pipes) {
      scene.pipes = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.collider(scene.player, scene.pipes);
        scene._pipeTickEv = scene.time.addEvent({
          delay: 16, loop: true, callback: () => {
            if (!scene.player) return;
            const dn = (scene.cursors && scene.cursors.down && scene.cursors.down.isDown) || (scene.wasd && scene.wasd.S && scene.wasd.S.isDown);
            if (!dn) return;
            scene.pipes.children.iterate(pp => {
              if (!pp || !pp._isTop || !pp._destX) return;
              const onTop = Math.abs(scene.player.x - pp.x) < 24 &&
                            Math.abs(scene.player.body.bottom - pp.body.top) < 4;
              if (onTop && !scene._warping) {
                scene._warping = true;
                if (typeof scene.cameras !== "undefined" && scene.cameras.main) scene.cameras.main.flash(300, 0, 200, 0);
                scene.player.setPosition(pp._destX, pp._destY);
                scene.time.delayedCall(400, () => { scene._warping = false; });
              }
            });
          },
        });
      }
    }
    const tile = scene.map ? scene.map.tileWidth : 18;
    // Top "lip" — wider
    const top = scene.pipes.create(x, y, "__pixel");
    top.setDisplaySize(tile * 2.5, tile).setTint(0x2e7d32);
    top._isTop = true;
    top._destX = destX; top._destY = destY;
    top.refreshBody && top.refreshBody();
    // Body — thinner stack
    for (let i = 1; i < height; i++) {
      const seg = scene.pipes.create(x, y + i * tile, "__pixel");
      seg.setDisplaySize(tile * 2, tile).setTint(0x388e3c);
      seg.refreshBody && seg.refreshBody();
    }
    return top;
  }

  // ── PORTAL (generated runtime ring) ───────────────────────────────────
  function portal(scene, x, y, destX, destY, color) {
    color = color || 0x9c27b0;
    if (!scene.portals) {
      scene.portals = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.portals, (p, pt) => {
          if (scene._warping) return;
          scene._warping = true;
          if (typeof scene.cameras !== "undefined" && scene.cameras.main) scene.cameras.main.flash(400, 200, 0, 200);
          p.setPosition(pt._destX, pt._destY);
          scene.time.delayedCall(500, () => { scene._warping = false; });
        });
      }
    }
    const pt = scene.portals.create(x, y, "__pixel");
    pt.setDisplaySize(48, 64).setTint(color);
    pt._destX = destX; pt._destY = destY;
    // Concentric ring effect
    for (let r = 0; r < 3; r++) {
      const ring = scene.add.circle(x, y, 24, color, 0);
      ring.setStrokeStyle(3, color, 0.7);
      scene.tweens.add({
        targets: ring, radius: 60, alpha: 0, duration: 1500, repeat: -1,
        delay: r * 500,
      });
    }
    return pt;
  }

  // ── PUBLIC ────────────────────────────────────────────────────────────
  root.Interactives = {
    spring, switchTile, questionBlock, key, lockedDoor, ladder,
    conveyor, checkpoint, pipe, portal,
  };
})(typeof window !== "undefined" ? window : this);
