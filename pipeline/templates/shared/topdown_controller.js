/**
 * ForgeFlow Games — TopdownController2D
 *
 * Canonical 8-directional top-down character controller for Phaser 3 + Arcade
 * Physics. Owns: input reading, diagonal normalization, velocity application,
 * facing-direction tracking. Used by `topdown` and `arpg` genre templates.
 *
 * Why this exists:
 *   Same reasoning as PlatformerController2D — generators were inlining the
 *   same input → vx/vy → setVelocity glue per game with subtle bugs (forgotten
 *   diagonal normalize, wrong sign convention, etc.). Industry convention for
 *   top-down characters (Zelda, Hyper Light Drifter, Hades) is a kinematic
 *   controller separate from physics simulation.
 *
 * Usage:
 *   // GameScene.create() — AFTER inputs are wired:
 *   this.controller = new TopdownController2D(this, {
 *     preset: "default",          // "default" | "zelda" | "hades" | "twin-stick"
 *     overrides: { speed: GAME_CONFIG.player.speed },
 *   });
 *   this.controller.attach(this.player);
 *
 *   // GameScene.update(time, delta):
 *   const intent = this.controller.tick(time, delta, {
 *     skipMovement: this.isAttacking || this.moveTarget !== null,
 *     speed: GAME_CONFIG.player.speed + this.bonusSpeed,  // optional override
 *   });
 *   // intent.vx, intent.vy        — normalized [-1..1] direction
 *   // intent.moving               — bool, true if any direction key held
 *   // intent.cardinalDir          — "left"|"right"|"up"|"down" (dominant axis)
 *   // intent.facingDir            — {x, y} updated only when moving
 *   //
 *   // Game decides animation policy:
 *   //   4-axis games: pick anim by intent.cardinalDir
 *   //   1-axis games: pick anim by intent.moving + setFlipX(intent.vx < 0)
 *
 * Tick order (DO NOT REORDER):
 *   1. Read input (cursors + wasd)
 *   2. Compute raw direction vector
 *   3. Normalize diagonals (×0.7071)
 *   4. Apply velocity (skipped if opts.skipMovement)
 *   5. Update facingDir when moving
 *   6. Emit intent
 */

(function () {
  "use strict";

  const SQRT1_2 = Math.SQRT1_2;  // 0.7071… — diagonal normalization

  // Presets — feel parameters per top-down sub-genre
  const PRESETS = {
    default: {
      speed: 180,
      diagonalNormalize: true,
      stopOnIdle: true,         // setVelocity(0,0) when no input
    },
    // Zelda-like — grid-snapped movement, slightly slower
    zelda: {
      speed: 160,
      diagonalNormalize: true,
      stopOnIdle: true,
    },
    // Hades-like — fast, fluid
    hades: {
      speed: 220,
      diagonalNormalize: true,
      stopOnIdle: true,
    },
    // Twin-stick shooter — very fast, no friction
    "twin-stick": {
      speed: 260,
      diagonalNormalize: true,
      stopOnIdle: true,
    },
  };

  /**
   * @param {Phaser.Scene} scene  — must expose this.cursors and this.wasd at attach() time
   * @param {Object} options
   *   options.preset    — preset name, defaults to "default"
   *   options.overrides — partial cfg overrides (e.g., { speed: 200 })
   */
  function TopdownController2D(scene, options) {
    this.scene = scene;
    this.options = options || {};
    const presetName = this.options.preset || "default";
    const preset = PRESETS[presetName] || PRESETS.default;
    this.cfg = Object.assign({}, preset, this.options.overrides || {});
    this.player = null;

    // State
    this.facingDir = { x: 0, y: 1 };  // default: facing down (typical for top-down)
    this._lastIntent = {
      vx: 0, vy: 0, moving: false,
      cardinalDir: "down",
      facingDir: { x: 0, y: 1 },
    };
  }

  /** Attach to player sprite. Caller already configured the body. */
  TopdownController2D.prototype.attach = function (playerSprite) {
    if (!playerSprite || !playerSprite.body) {
      console.warn("[TopdownController2D] attach: player sprite has no physics body");
      return;
    }
    this.player = playerSprite;
  };

  /**
   * Per-frame tick. Call exactly once from GameScene.update(time, delta).
   *
   * @param {Object} [opts]
   *   opts.skipMovement — true if caller is handling movement (e.g., attacking,
   *                       click-to-move target active, dialog open, etc.)
   *   opts.speed        — override the effective speed for this frame
   */
  TopdownController2D.prototype.tick = function (time, delta, opts) {
    if (!this.player || !this.player.active || !this.player.body) {
      return this._lastIntent;
    }
    opts = opts || {};
    const cfg = this.cfg;
    const cursors = this.scene.cursors;
    const wasd = this.scene.wasd;
    const speed = (typeof opts.speed === "number") ? opts.speed : cfg.speed;

    // ── 1. READ INPUT (null-safe) ──
    const leftDown  = (cursors && cursors.left  && cursors.left.isDown)  || (wasd && wasd.A && wasd.A.isDown);
    const rightDown = (cursors && cursors.right && cursors.right.isDown) || (wasd && wasd.D && wasd.D.isDown);
    const upDown    = (cursors && cursors.up    && cursors.up.isDown)    || (wasd && wasd.W && wasd.W.isDown);
    const downDown  = (cursors && cursors.down  && cursors.down.isDown)  || (wasd && wasd.S && wasd.S.isDown);

    // ── 2. COMPUTE RAW DIRECTION ──
    let vx = 0;
    let vy = 0;
    if (leftDown)  vx = -1;
    if (rightDown) vx = 1;   // right wins if both held (matches Phaser convention)
    if (upDown)    vy = -1;
    if (downDown)  vy = 1;   // down wins if both held

    // ── 3. NORMALIZE DIAGONALS ──
    if (cfg.diagonalNormalize && vx !== 0 && vy !== 0) {
      vx *= SQRT1_2;
      vy *= SQRT1_2;
    }

    const moving = (vx !== 0 || vy !== 0);

    // ── 4. APPLY VELOCITY (unless caller suppressed) ──
    if (!opts.skipMovement) {
      if (moving) {
        this.player.setVelocity(vx * speed, vy * speed);
      } else if (cfg.stopOnIdle) {
        this.player.setVelocity(0, 0);
      }
    }

    // ── 5. UPDATE FACING DIR (only when moving so idle preserves last facing) ──
    if (moving) {
      this.facingDir = { x: vx, y: vy };
    }

    // ── 6. CARDINAL DIR (dominant axis) for 4-axis animation games ──
    let cardinalDir;
    if (Math.abs(vx) >= Math.abs(vy)) {
      cardinalDir = (vx < 0) ? "left" : (vx > 0) ? "right" : (this.facingDir.x < 0 ? "left" : "right");
    } else {
      cardinalDir = (vy < 0) ? "up" : "down";
    }

    this._lastIntent = {
      vx: vx, vy: vy,
      moving: moving,
      cardinalDir: cardinalDir,
      facingDir: this.facingDir,
    };
    return this._lastIntent;
  };

  /** Reset internal state (call on level restart / respawn) */
  TopdownController2D.prototype.reset = function () {
    this.facingDir = { x: 0, y: 1 };
  };

  /** Live-update feel parameters */
  TopdownController2D.prototype.setConfig = function (overrides) {
    Object.assign(this.cfg, overrides || {});
  };

  // Expose globally — game.js loads this as a <script> tag, no bundler.
  window.TopdownController2D = TopdownController2D;
  window.TopdownController2D.PRESETS = PRESETS;
})();
