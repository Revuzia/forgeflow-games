/* twin_stick_controller.js — WASD-move + mouse-aim + auto-fire.
 *
 * Geometry-Wars-style twin-stick. Player ship moves freely in 8 directions
 * via WASD/arrows, fires continuously toward the mouse cursor. Holding
 * SPACE toggles burst-fire (3-shot spread per cycle). Q drops a bomb.
 *
 * Usage:
 *   const ctrl = new TwinStickController(scene, opts);
 *   ctrl.attach(playerSprite);
 *   ctrl.tick(time, delta);  // every update
 *
 * Returns scene.bullets (Phaser group) for collision setup.
 */
(function (root) {
  "use strict";

  const PRESETS = {
    default: {
      moveSpeed: 280,
      fireRate: 120,    // ms between shots
      bulletSpeed: 700,
      bulletLifespan: 1500,
      bombs: 3,
    },
  };

  function TwinStickController(scene, options) {
    this.scene = scene;
    options = options || {};
    this.cfg = Object.assign({}, PRESETS.default, options.overrides || {});
    this.player = null;
    this._lastFire = 0;
    this._burstMode = false;
    this._lastBomb = 0;
    this.bombsLeft = this.cfg.bombs;
  }

  TwinStickController.prototype.attach = function (player) {
    this.player = player;
    if (!player || !player.body) return;
    player.body.setMaxVelocity(this.cfg.moveSpeed * 1.2, this.cfg.moveSpeed * 1.2);
    player.body.setDrag(700, 700);
    // Bullet group (lazy create)
    if (!this.scene.bullets) {
      this.scene.bullets = this.scene.physics.add.group({
        defaultKey: "__bullet",
        maxSize: 200,
      });
    }
  };

  TwinStickController.prototype.tick = function (time, delta) {
    if (!this.player || !this.player.active) return;
    const cfg = this.cfg;
    const cursors = this.scene.cursors;
    const wasd = this.scene.wasd;

    // ── MOVEMENT ──
    let vx = 0, vy = 0;
    const left = (cursors && cursors.left && cursors.left.isDown) || (wasd && wasd.A && wasd.A.isDown);
    const right = (cursors && cursors.right && cursors.right.isDown) || (wasd && wasd.D && wasd.D.isDown);
    const up = (cursors && cursors.up && cursors.up.isDown) || (wasd && wasd.W && wasd.W.isDown);
    const down = (cursors && cursors.down && cursors.down.isDown) || (wasd && wasd.S && wasd.S.isDown);
    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;
    // Normalize diagonals
    const mag = Math.sqrt(vx * vx + vy * vy);
    if (mag > 0) {
      vx = (vx / mag) * cfg.moveSpeed;
      vy = (vy / mag) * cfg.moveSpeed;
    }
    this.player.setVelocity(vx, vy);

    // Rotate ship to face mouse
    const ptr = this.scene.input.activePointer;
    if (ptr) {
      const wx = ptr.worldX || ptr.x;
      const wy = ptr.worldY || ptr.y;
      const ang = Math.atan2(wy - this.player.y, wx - this.player.x);
      this.player.rotation = ang;
    }

    // ── AUTO-FIRE ──
    if (time - this._lastFire >= cfg.fireRate) {
      this._lastFire = time;
      this._fire();
    }

    // ── BOMB ──
    if (this.scene._bombKey && Phaser.Input.Keyboard.JustDown(this.scene._bombKey) && this.bombsLeft > 0) {
      this._fireBomb();
    }
  };

  TwinStickController.prototype._fire = function () {
    const cfg = this.cfg;
    const ang = this.player.rotation;
    const tex = this.scene.textures.exists("__bullet") ? "__bullet" : "__pixel";
    const b = this.scene.bullets.create(this.player.x, this.player.y, tex);
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.setDisplaySize(8, 8).setTint(0x00e5ff);
    b.body.setAllowGravity && b.body.setAllowGravity(false);
    b.body.setVelocity(Math.cos(ang) * cfg.bulletSpeed, Math.sin(ang) * cfg.bulletSpeed);
    b.body.setCircle(4);
    b._lifespan = cfg.bulletLifespan;
    b._spawnTime = this.scene.time.now;
    // Auto-cull
    this.scene.time.delayedCall(cfg.bulletLifespan, () => { try { b.destroy(); } catch (_e) {} });
  };

  TwinStickController.prototype._fireBomb = function () {
    this.bombsLeft--;
    const p = this.player;
    // Visual: expanding ring
    const ring = this.scene.add.circle(p.x, p.y, 30, 0xffffff, 0);
    ring.setStrokeStyle(6, 0xffffff, 1);
    ring.setDepth(50);
    this.scene.tweens.add({
      targets: ring, radius: 800, alpha: 0, duration: 600,
      onComplete: () => ring.destroy(),
    });
    // Kill all enemies
    if (this.scene.enemies && this.scene.enemies.children) {
      this.scene.enemies.children.iterate(en => {
        if (en && en.active && this.scene.killEnemy) this.scene.killEnemy(en);
      });
    }
    if (this.scene.cameras && this.scene.cameras.main) {
      this.scene.cameras.main.flash(300, 255, 255, 255);
      this.scene.cameras.main.shake(400, 0.012);
    }
  };

  root.TwinStickController = TwinStickController;
})(typeof window !== "undefined" ? window : this);
