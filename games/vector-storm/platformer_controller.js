/**
 * ForgeFlow Games — PlatformerController2D
 *
 * Canonical 2D platformer character controller for Phaser 3 + Arcade Physics.
 * Owns: horizontal movement, jump (single + double + variable + coyote + buffered),
 * dash, and animation hints. Owns the deterministic tick order so per-game
 * patches can't introduce input/velocity/collision-order bugs.
 *
 * Why this exists:
 *   Procedural generation kept producing per-game bespoke movement loops with
 *   subtle integration-order bugs (apply gravity vs clamp velocity vs resolve
 *   collision vs set grounded flag). Industry convention for tight platformers
 *   (Celeste, Super Meat Boy, Hollow Knight, Mario, Godot, Unity, Unreal) is a
 *   kinematic character controller, not a rigid-body simulation. This module
 *   IS that controller. Generators MUST NOT inline movement logic; they call
 *   controller.tick(time, delta) once per frame.
 *
 * Usage:
 *   // In GameScene.create():
 *   this.controller = new PlatformerController2D(this, {
 *     preset: "default",            // "default" | "mario" | "celeste" | "sonic" | "dkc"
 *     overrides: GAME_CONFIG.player // optional per-game tunings
 *   });
 *   this.controller.attach(this.player);
 *
 *   // In GameScene.update(time, delta):
 *   const intent = this.controller.tick(time, delta);
 *   // intent.animKey — "player_idle" | "player_run" | "player_jump"
 *   // intent.jumped  — bool, true on the frame jump fires
 *   // intent.dashed  — bool, true on the frame dash fires
 *
 * Tick order (DO NOT REORDER without updating tests):
 *   1. Read input + buffer/coyote timers
 *   2. Update grounded flag (single source of truth: body.blocked.down || body.touching.down)
 *   3. Refresh coyote + double-jump on ground
 *   4. Apply horizontal accel/clamp (skipped if dashing)
 *   5. Process jump (ground → coyote → buffered → double)
 *   6. Apply variable-jump-cut (release while velocity.y < cut threshold)
 *   7. Process dash trigger
 *   8. Emit animation intent
 *   9. Decay timers (dash duration, etc.)
 */

(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────
  // Presets — feel parameters for major platformer styles.
  // Generators pick a preset by genre/sub_genre. Numbers are tuned
  // to Phaser arcade units (px/s velocity, ms timers).
  // ─────────────────────────────────────────────────────────────
  const PRESETS = {
    default: {
      speed: 200,
      jumpForce: -350,
      doubleJumpForce: -300,
      enableDoubleJump: true,
      dashSpeed: 400,
      dashDuration: 150,
      enableDash: true,
      coyoteTime: 100,
      jumpBuffer: 100,
      variableJumpCutFactor: 0.85,
      variableJumpCutVelocity: -100,
      airControlFactor: 1.0,
      maxFallSpeed: 600,
    },
    // Mario-like — heavier feel, no dash, single double-jump optional
    mario: {
      speed: 220,
      jumpForce: -370,
      doubleJumpForce: -320,
      enableDoubleJump: false,
      dashSpeed: 0,
      dashDuration: 0,
      enableDash: false,
      coyoteTime: 80,
      jumpBuffer: 120,
      variableJumpCutFactor: 0.5,
      variableJumpCutVelocity: -150,
      airControlFactor: 0.85,
      maxFallSpeed: 700,
    },
    // Celeste-like — tight, dash-heavy, generous coyote+buffer
    celeste: {
      speed: 200,
      jumpForce: -340,
      doubleJumpForce: -300,
      enableDoubleJump: false,
      dashSpeed: 480,
      dashDuration: 130,
      enableDash: true,
      coyoteTime: 120,
      jumpBuffer: 130,
      variableJumpCutFactor: 0.45,
      variableJumpCutVelocity: -100,
      airControlFactor: 1.0,
      maxFallSpeed: 580,
    },
    // Sonic-like — fast, big jumps, no dash (roll handled separately)
    sonic: {
      speed: 320,
      jumpForce: -420,
      doubleJumpForce: 0,
      enableDoubleJump: false,
      dashSpeed: 0,
      dashDuration: 0,
      enableDash: false,
      coyoteTime: 60,
      jumpBuffer: 80,
      variableJumpCutFactor: 0.6,
      variableJumpCutVelocity: -120,
      airControlFactor: 0.75,
      maxFallSpeed: 800,
    },
    // Donkey-Kong-Country-like — momentum-heavy, big jumps, no dash
    dkc: {
      speed: 210,
      jumpForce: -380,
      doubleJumpForce: 0,
      enableDoubleJump: false,
      dashSpeed: 360,
      dashDuration: 200,
      enableDash: true,           // barrel-roll = dash
      coyoteTime: 90,
      jumpBuffer: 110,
      variableJumpCutFactor: 0.7,
      variableJumpCutVelocity: -130,
      airControlFactor: 0.9,
      maxFallSpeed: 700,
    },
  };

  /**
   * @param {Phaser.Scene} scene  — must expose this.cursors / this.wasd / this.spaceKey / this.shiftKey
   *                                (the controller binds these from the scene at attach() time)
   * @param {Object} options
   *   options.preset    — preset name, defaults to "default"
   *   options.overrides — partial cfg overrides (e.g., GAME_CONFIG.player from generated game)
   */
  function PlatformerController2D(scene, options) {
    this.scene = scene;
    this.options = options || {};
    const presetName = this.options.preset || "default";
    const preset = PRESETS[presetName] || PRESETS.default;
    // Merge: preset → overrides. Overrides win for any key present.
    this.cfg = Object.assign({}, preset, this.options.overrides || {});
    this.player = null;

    // State
    this.coyoteTimer = 0;
    this.canDoubleJump = true;
    this.isDashing = false;
    this.dashEndTime = 0;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
    // Variable-jump-cut state: track previous-frame upHeld so cut applies
    // ONCE on the release edge, not every frame the key is up. The
    // "every-frame cut" bug compounds 0.7^N → player barely leaves the
    // ground (this regressed jump_works in QA on 2026-04-27).
    this._prevUpHeld = false;
    this._jumpCutApplied = false;
    this._lastIntent = { animKey: "player_idle", jumped: false, dashed: false };
  }

  /**
   * Attach to a player sprite. Caller must have called scene.physics.add.sprite(...)
   * and configured the body (size/offset/collide-world-bounds). Controller does
   * NOT create or destroy the body — single responsibility.
   */
  PlatformerController2D.prototype.attach = function (playerSprite) {
    if (!playerSprite || !playerSprite.body) {
      console.warn("[PlatformerController2D] attach: player sprite has no physics body");
      return;
    }
    this.player = playerSprite;
    if (this.cfg.maxFallSpeed) {
      try { this.player.body.setMaxVelocityY(this.cfg.maxFallSpeed); } catch (_e) { /* old Phaser */ }
    }
  };

  /**
   * Per-frame tick. Call exactly once from GameScene.update(time, delta).
   * Reads input from this.scene.cursors / wasd / spaceKey / shiftKey.
   * Mutates the player body. Returns animation + event hints.
   *
   * @param {Object} [opts]
   *   opts.skipHorizontal — true if a level-mode hook already set velocityX (e.g., minecart auto-run)
   *   opts.skipJump       — true to disable jump input this frame (e.g., underwater swim)
   *   opts.skipDash       — true to disable dash this frame
   */
  PlatformerController2D.prototype.tick = function (time, delta, opts) {
    if (!this.player || !this.player.active || !this.player.body) {
      return this._lastIntent;
    }
    opts = opts || {};
    const cfg = this.cfg;
    const body = this.player.body;
    const cursors = this.scene.cursors;
    const wasd = this.scene.wasd;
    const spaceKey = this.scene.spaceKey;
    const shiftKey = this.scene.shiftKey;

    // ── 2. GROUNDED FLAG (single source of truth) ──
    // Use both blocked.down (collided this frame) AND touching.down (touching tile).
    // Same convention test_runner uses via __TEST__.getPlayer().onGround.
    const onGround = !!(body.blocked && body.blocked.down) || !!(body.touching && body.touching.down) ||
                     (typeof body.onFloor === "function" && body.onFloor());

    // ── 3. REFRESH TIMERS ON GROUND ──
    if (onGround) {
      this.coyoteTimer = cfg.coyoteTime;
      this.canDoubleJump = true;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }
    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= delta;
    }

    // ── 1. READ INPUT (null-safe — input objects may not be wired yet on first frame) ──
    const leftDown  = (cursors && cursors.left  && cursors.left.isDown)  || (wasd && wasd.A && wasd.A.isDown);
    const rightDown = (cursors && cursors.right && cursors.right.isDown) || (wasd && wasd.D && wasd.D.isDown);
    const upJustDown =
      (spaceKey && Phaser.Input.Keyboard.JustDown(spaceKey)) ||
      (cursors && cursors.up && Phaser.Input.Keyboard.JustDown(cursors.up)) ||
      (wasd && wasd.W && Phaser.Input.Keyboard.JustDown(wasd.W));
    const upHeld =
      (spaceKey && spaceKey.isDown) ||
      (cursors && cursors.up && cursors.up.isDown) ||
      (wasd && wasd.W && wasd.W.isDown);
    const dashJustDown = cfg.enableDash && shiftKey && Phaser.Input.Keyboard.JustDown(shiftKey);

    // ── 4. HORIZONTAL MOVEMENT ──
    // Skipped while dashing (dash sets velocityX directly, locks horizontal control)
    // Also skipped if caller signalled a level-mode override (minecart auto-run, etc.)
    let animKey = "player_idle";
    if (!this.isDashing && !opts.skipHorizontal) {
      const speedScale = onGround ? 1.0 : (cfg.airControlFactor || 1.0);
      if (leftDown) {
        this.player.setVelocityX(-cfg.speed * speedScale);
        this.player.setFlipX(true);
        if (onGround) animKey = "player_run";
      } else if (rightDown) {
        this.player.setVelocityX(cfg.speed * speedScale);
        this.player.setFlipX(false);
        if (onGround) animKey = "player_run";
      } else {
        this.player.setVelocityX(0);
        if (onGround) animKey = "player_idle";
      }
    }

    // ── 5. JUMP (ground → coyote → buffered → double) ──
    let jumped = false;
    if (!opts.skipJump && upJustDown) {
      this.jumpBuffered = true;
      this.jumpBufferTimer = cfg.jumpBuffer;
    }
    const canGroundJump = !opts.skipJump && this.coyoteTimer > 0 &&
                          (upJustDown || (this.jumpBuffered && this.jumpBufferTimer > 0));
    if (canGroundJump) {
      this.player.setVelocityY(cfg.jumpForce);
      this.coyoteTimer = 0;
      this.jumpBuffered = false;
      this.jumpBufferTimer = 0;
      jumped = true;
    } else if (!opts.skipJump && cfg.enableDoubleJump && upJustDown && this.canDoubleJump && !onGround && this.coyoteTimer <= 0) {
      this.player.setVelocityY(cfg.doubleJumpForce);
      this.canDoubleJump = false;
      jumped = true;
    }

    // ── 6. VARIABLE-JUMP-CUT ──
    // Apply cut ONCE on the release edge (upHeld true → false transition) while
    // the player is still rising fast. Applying every frame compounds 0.7^N and
    // the player barely leaves the ground. Reset the latch when we're back on
    // ground (so next jump can be cut again).
    if (jumped) {
      this._jumpCutApplied = false;  // fresh jump → cut not yet applied
    }
    const releaseEdge = this._prevUpHeld && !upHeld;
    if (releaseEdge && !this._jumpCutApplied && !jumped &&
        body.velocity.y < cfg.variableJumpCutVelocity) {
      body.velocity.y *= cfg.variableJumpCutFactor;
      this._jumpCutApplied = true;
    }
    if (onGround) {
      this._jumpCutApplied = false;  // ready for next jump
    }
    this._prevUpHeld = upHeld;

    // ── 7. DASH ──
    let dashed = false;
    if (!opts.skipDash && dashJustDown && !this.isDashing) {
      this.isDashing = true;
      this.dashEndTime = time + cfg.dashDuration;
      const dir = this.player.flipX ? -1 : 1;
      this.player.setVelocityX(dir * cfg.dashSpeed);
      this.player.setVelocityY(0);
      try { body.setAllowGravity(false); } catch (_e) {}
      dashed = true;
    }
    // Dash end
    if (this.isDashing && time >= this.dashEndTime) {
      this.isDashing = false;
      try { body.setAllowGravity(true); } catch (_e) {}
    }

    // ── 8. ANIMATION INTENT ──
    if (!onGround) animKey = "player_jump";

    this._lastIntent = { animKey: animKey, jumped: jumped, dashed: dashed, onGround: onGround };
    return this._lastIntent;
  };

  /** Reset internal state (call on level restart / respawn) */
  PlatformerController2D.prototype.reset = function () {
    this.coyoteTimer = 0;
    this.canDoubleJump = true;
    this.isDashing = false;
    this.dashEndTime = 0;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
  };

  /** Live-update feel parameters (for power-ups, level modes, etc.) */
  PlatformerController2D.prototype.setConfig = function (overrides) {
    Object.assign(this.cfg, overrides || {});
  };

  // Expose globally — game.js loads this as a <script> tag, no bundler.
  window.PlatformerController2D = PlatformerController2D;
  window.PlatformerController2D.PRESETS = PRESETS;
})();
