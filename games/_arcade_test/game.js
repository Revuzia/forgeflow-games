/**
 * ForgeFlow Games — Arcade / Twin-Stick Shooter Template
 *
 * Genre: arcade (twin-stick-shooter)
 * Engine: Phaser 3.90 Arcade Physics
 *
 * Player ship moves with WASD/arrows, fires toward mouse cursor, bombs
 * with Q. Single-arena gameplay with wave-based enemy spawning.
 *
 * Libraries (loaded by index.html):
 *   - twin_stick_controller.js : input + auto-fire
 *   - enemy_waves.js           : wave definitions + spawn + AI tick
 *   - score_combo.js           : chain-kill multiplier
 *   - particle_burst.js        : neon-vector explosion effects
 */

window.GAME_DESIGN = {"title":"Geometry Wars Test","tagline":"Twin-stick arena"};

const GAME_CONFIG = {
  title: "Geometry Wars Test",
  width: 960,
  height: 720,
  player: {
    moveSpeed: 280,
    fireRate: 120,
    bulletSpeed: 700,
    maxLives: 3,
    startLives: 3,
    invincibleDuration: 1200,
  },
  audio: { musicVolume: 0.3, sfxVolume: 0.6 },
  colors: {
    bg: "#000814",
    accent: "#00e5ff",
    text: "#ffffff",
  },
};

// ═══════════════════════════════════════════════════════════════
// BOOT — generates fallback textures + transitions to Preload
// ═══════════════════════════════════════════════════════════════

class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }
  create() { this.scene.start("Preload"); }
}

class PreloadScene extends Phaser.Scene {
  constructor() { super("Preload"); }
  preload() {
    const { width, height } = this.cameras.main;
    const barBg = this.add.rectangle(width / 2, height / 2, width * 0.6, 24, 0x1e293b);
    const bar = this.add.rectangle(width * 0.2 + 2, height / 2, 0, 20, 0x00e5ff).setOrigin(0, 0.5);
    this.load.on("progress", v => bar.width = (width * 0.6 - 4) * v);

    // Fallback textures (generated, no file load)
    const makeRect = (key, w, h, color) => {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(color, 1);
      g.fillRect(0, 0, w, h);
      g.generateTexture(key, w, h);
      g.destroy();
    };
    makeRect("__pixel", 1, 1, 0xffffff);
    makeRect("__bullet", 6, 6, 0x00e5ff);
    makeRect("__player_ship", 24, 24, 0xffffff);

    // Try to load music/sfx if available
    try { this.load.audio("music_level", "assets/audio/music_level.ogg"); } catch (_e) {}
    try { this.load.audio("sfx_shoot", "assets/audio/sfx_shoot.ogg"); } catch (_e) {}
    try { this.load.audio("sfx_hit", "assets/audio/sfx_hit.ogg"); } catch (_e) {}
  }
  create() { this.scene.start("Menu"); }
}

class MenuScene extends Phaser.Scene {
  constructor() { super("Menu"); }
  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);
    this.add.text(width / 2, height * 0.3, GAME_CONFIG.title, {
      fontSize: "44px", color: "#00e5ff", fontStyle: "bold",
    }).setOrigin(0.5);
    if (window.GAME_DESIGN && window.GAME_DESIGN.tagline) {
      this.add.text(width / 2, height * 0.42, window.GAME_DESIGN.tagline, {
        fontSize: "16px", color: "#ffffff",
      }).setOrigin(0.5);
    }
    const start = this.add.text(width / 2, height * 0.6, "PRESS SPACE TO START", {
      fontSize: "20px", color: "#ffeb3b",
    }).setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
    this.add.text(width / 2, height * 0.75, "WASD = move | Mouse = aim | Q = bomb", {
      fontSize: "14px", color: "#888888",
    }).setOrigin(0.5);
    this.input.keyboard.once("keydown-SPACE", () => this.scene.start("Game"));
    this.input.keyboard.once("keydown-ENTER", () => this.scene.start("Game"));
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME — single-arena twin-stick action
// ═══════════════════════════════════════════════════════════════

class GameScene extends Phaser.Scene {
  constructor() { super("Game"); }
  init(data) {
    this.score = data.score || 0;
    this.lives = data.lives || GAME_CONFIG.player.startLives;
    this.maxLives = GAME_CONFIG.player.maxLives;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);

    // Arena grid bg (subtle dotted)
    this._drawGrid();

    // Player
    this.player = this.physics.add.sprite(width / 2, height / 2, "__player_ship");
    this.player.setDisplaySize(20, 20).setTint(0x00e5ff);
    this.player.body.setCircle(10);
    this.player.setCollideWorldBounds(true);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    this.spaceKey = this.input.keyboard.addKey("SPACE");
    this._bombKey = this.input.keyboard.addKey("Q");

    // Twin-stick controller
    if (typeof window.TwinStickController === "function") {
      this.controller = new window.TwinStickController(this, {
        overrides: GAME_CONFIG.player,
      });
      this.controller.attach(this.player);
    } else {
      console.error("[GameScene] TwinStickController missing");
    }

    // Combo + particle libs
    if (window.ScoreCombo) window.ScoreCombo.attach(this);

    // Helper methods used by libs
    this.killEnemy = (en) => {
      if (!en || !en.active) return;
      const cfg = en._cfg || {};
      const pos = { x: en.x, y: en.y, tint: cfg.tint, score: en._scoreVal || 50 };
      // Death effect
      if (window.Burst) window.Burst.killPop(this, pos.x, pos.y, pos.tint, pos.score);
      // Score (with combo multiplier)
      if (window.ScoreCombo) window.ScoreCombo.recordKill(this, pos.score);
      // Run on-death effect (splitter spawns, bomb explodes)
      if (cfg.onDeath) try { cfg.onDeath(this, en); } catch (_e) {}
      en.destroy();
      if (window.EnemyWaves) window.EnemyWaves.notifyKill(this);
      this.updateHUD();
    };

    this.playerHit = () => {
      if (this.isInvincible) return;
      this.lives--;
      this.cameras.main.flash(180, 255, 0, 0);
      this.cameras.main.shake(220, 0.012);
      if (window.Burst) window.Burst.explosion(this, this.player.x, this.player.y, 0xff5252, 24);
      if (this.lives <= 0) {
        this.scene.start("GameOver", { score: this.score });
        return;
      }
      this.isInvincible = true;
      this.player.setAlpha(0.4);
      this.time.delayedCall(GAME_CONFIG.player.invincibleDuration, () => {
        this.isInvincible = false;
        if (this.player) this.player.setAlpha(1);
      });
      this.updateHUD();
    };

    this.showFloatText = (x, y, text, color) => {
      const t = this.add.text(x, y, text, { fontSize: "14px", color: color || "#ffffff", fontStyle: "bold" })
        .setOrigin(0.5).setDepth(60);
      this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 700, onComplete: () => t.destroy() });
    };

    this.playSound = (key) => {
      try { if (this.cache.audio.exists(key)) this.sound.add(key).play({ volume: GAME_CONFIG.audio.sfxVolume }); } catch (_e) {}
    };

    // Player ship trail
    if (window.Burst) window.Burst.trail(this, this.player, 0x00e5ff);

    // Bullets vs enemies
    this.physics.add.overlap(this.bullets, this.enemies = this.physics.add.group(), (bullet, en) => {
      if (!bullet.active || !en.active) return;
      en._hp = (en._hp || 1) - 1;
      bullet.destroy();
      if (en._hp <= 0) this.killEnemy(en);
      else {
        en.setTint(0xffffff);
        this.time.delayedCall(80, () => en.active && en.setTint(en._cfg ? en._cfg.tint : 0xffffff));
      }
    });
    // Player vs enemies
    this.physics.add.overlap(this.player, this.enemies, () => {
      if (!this.isInvincible) this.playerHit();
    });

    // HUD
    this.scoreText = this.add.text(16, 16, "Score: 0", { fontSize: "18px", color: "#ffffff", fontStyle: "bold" })
      .setScrollFactor(0).setDepth(900);
    this.livesText = this.add.text(16, 40, "Lives: " + this.lives, { fontSize: "16px", color: "#ffffff" })
      .setScrollFactor(0).setDepth(900);
    this.bombsText = this.add.text(16, 60, "Bombs: " + (this.controller ? this.controller.bombsLeft : 0), {
      fontSize: "16px", color: "#ffeb3b" }).setScrollFactor(0).setDepth(900);

    // Start the wave loop
    if (window.EnemyWaves) window.EnemyWaves.start(this, { wave: 1 });

    // Pause hook
    this.input.keyboard.on("keydown-ESC", () => {
      this.scene.launch("Pause");
      this.scene.pause();
    });

    // Music
    try {
      if (this.cache.audio.exists("music_level"))
        this.sound.play("music_level", { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    } catch (_e) {}

    this.updateHUD();
    this.exposeTestAPI();
  }

  _drawGrid() {
    const { width, height } = this.cameras.main;
    const g = this.add.graphics();
    g.lineStyle(1, 0x102040, 0.6);
    for (let x = 0; x < width; x += 40) g.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 40) g.lineBetween(0, y, width, y);
    g.setDepth(-1);
  }

  updateHUD() {
    if (this.scoreText) this.scoreText.setText("Score: " + (this.score || 0));
    if (this.livesText) this.livesText.setText("Lives: " + this.lives);
    if (this.bombsText && this.controller) this.bombsText.setText("Bombs: " + this.controller.bombsLeft);
  }

  update(time, delta) {
    if (this.controller) this.controller.tick(time, delta);
    if (window.EnemyWaves) window.EnemyWaves.tick(this, time, delta);
  }

  exposeTestAPI() {
    window.__TEST__ = {
      getPlayer: () => this.player ? { x: this.player.x, y: this.player.y, alive: this.player.active } : null,
      getScore: () => this.score,
      getLives: () => this.lives,
      getWave: () => this._wave || 0,
      getCurrentScene: () => this.scene.key,
    };
    window.__GAME__ = this.sys.game;
  }
}

class PauseScene extends Phaser.Scene {
  constructor() { super("Pause"); }
  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);
    this.add.text(width / 2, height / 2, "PAUSED\nPress ESC to resume", {
      fontSize: "28px", color: "#ffffff", align: "center",
    }).setOrigin(0.5);
    this.input.keyboard.once("keydown-ESC", () => {
      this.scene.stop();
      this.scene.resume("Game");
    });
  }
}

class GameOverScene extends Phaser.Scene {
  constructor() { super("GameOver"); }
  init(data) { this.finalScore = data.score || 0; }
  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor("#000814");
    this.add.text(width / 2, height * 0.3, "GAME OVER", {
      fontSize: "48px", color: "#ff5252", fontStyle: "bold",
    }).setOrigin(0.5);
    this.add.text(width / 2, height * 0.45, "Score: " + this.finalScore, {
      fontSize: "24px", color: "#ffffff",
    }).setOrigin(0.5);
    const retry = this.add.text(width / 2, height * 0.6, "PRESS SPACE TO RETRY", {
      fontSize: "18px", color: "#ffeb3b",
    }).setOrigin(0.5);
    this.tweens.add({ targets: retry, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
    this.input.keyboard.once("keydown-SPACE", () => this.scene.start("Game"));
  }
}

const config = {
  type: Phaser.AUTO,
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  parent: "game-container",
  physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, PreloadScene, MenuScene, GameScene, PauseScene, GameOverScene],
};

new Phaser.Game(config);
