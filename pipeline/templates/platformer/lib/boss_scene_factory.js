/* boss_scene_factory.js — generates a Phaser Scene class for ANY boss
 * defined in design.bosses[]. Replaces the per-boss hand-coded scenes
 * the pipeline used to generate (3,880 lines of duplication).
 *
 * Usage:
 *   const cls = BossSceneFactory.make("BossKingBramblebackVerdantTyrant", designBoss);
 *   game.scene.add("BossKingBramblebackVerdantTyrant", cls);
 *
 * The generated scene:
 *   - Boots with the player + a flat arena
 *   - Uses BossLib.create(this, designBoss) for HP bar + phase + attacks
 *   - Loads boss sprite + plays idle animation
 *   - Win condition: boss.hp <= 0 → onBossDefeated → returns to main flow
 */
(function (root) {
  "use strict";

  function make(sceneKey, designBoss) {
    const Klass = function () {
      Phaser.Scene.call(this, { key: sceneKey });
    };
    Klass.prototype = Object.create(Phaser.Scene.prototype);
    Klass.prototype.constructor = Klass;

    Klass.prototype.init = function (data) {
      this.score = (data && data.score !== undefined) ? data.score : 0;
      this.lives = (data && data.lives !== undefined) ? data.lives : 3;
      this.maxLives = (window.GAME_CONFIG && window.GAME_CONFIG.player && window.GAME_CONFIG.player.maxLives) || 3;
    };

    Klass.prototype.preload = function () {
      // Boss sprite (best-effort — names vary by game)
      try {
        const safeName = (designBoss.name || "boss").toLowerCase().replace(/[^a-z0-9]+/g, "_");
        this.load.image(`boss_${safeName}`, `assets/${designBoss.name || "boss"}.png`);
      } catch (_e) {}
    };

    Klass.prototype.create = function () {
      const { width, height } = this.cameras.main;
      // Arena bg — solid color from design
      this.cameras.main.setBackgroundColor((designBoss.arena_bg || "#1a1423"));

      // Floor
      const floor = this.add.rectangle(width / 2, height - 30, width, 60, 0x4a3a2a)
        .setOrigin(0.5);
      this.physics.add.existing(floor, true);

      // Player (kenney sprite)
      this.player = this.physics.add.sprite(80, height - 100,
        this.textures.exists("characters") ? "characters" : "__pixel", 0);
      this.player.setCollideWorldBounds(true);
      this.player.setScale(2.5);
      this.player.setSize(16, 20);
      this.player.setOffset(4, 4);
      if (this.player.body) this.player.body.setMaxVelocityY(600);
      this.physics.add.collider(this.player, floor);

      // Input
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys("W,A,S,D");
      this.shiftKey = this.input.keyboard.addKey("SHIFT");
      this.spaceKey = this.input.keyboard.addKey("SPACE");
      // Controller
      if (typeof window.PlatformerController2D === "function") {
        this.controller = new window.PlatformerController2D(this, {
          overrides: (window.GAME_CONFIG && window.GAME_CONFIG.player) || {},
        });
        this.controller.attach(this.player);
      }
      // Helper methods used by BossLib
      this.killEnemy = (en) => en && en.destroy();
      this.playerHit = () => {
        if (this.isInvincible) return;
        this.lives--;
        if (this.lives <= 0) this.scene.start("GameOver", { score: this.score });
        this.isInvincible = true;
        this.cameras.main.flash(120, 200, 0, 0);
        this.time.delayedCall(800, () => { this.isInvincible = false; });
      };
      this.showFloatText = (x, y, text, color) => {
        const t = this.add.text(x, y, text, { fontSize: "16px", color: color || "#ffffff" }).setOrigin(0.5);
        this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 800, onComplete: () => t.destroy() });
      };

      // BOSS via BossLib
      this.onBossDefeated = () => {
        this.cameras.main.fade(800, 0, 0, 0);
        this.time.delayedCall(900, () => {
          this.scene.start("Win", { score: this.score + 5000 });
        });
      };
      if (typeof window.BossLib !== "undefined") {
        this.boss = window.BossLib.create(this, designBoss);
      } else {
        console.error("[BossSceneFactory] BossLib not loaded");
      }

      // HUD
      this.add.text(16, 16, "Score: " + this.score, { fontSize: "16px", color: "#ffffff" })
        .setScrollFactor(0).setDepth(900);
      this.livesText = this.add.text(16, 36, "Lives: " + this.lives, { fontSize: "16px", color: "#ffffff" })
        .setScrollFactor(0).setDepth(900);

      // Pause hook
      this.input.keyboard.on("keydown-ESC", () => {
        this.scene.launch("Pause");
        this.scene.pause();
      });
    };

    Klass.prototype.update = function (time, delta) {
      if (this.controller) this.controller.tick(time, delta);
      if (this.boss) this.boss.tick(time, delta);
      if (this.livesText) this.livesText.setText("Lives: " + this.lives);
    };

    return Klass;
  }

  root.BossSceneFactory = { make };
})(typeof window !== "undefined" ? window : this);
