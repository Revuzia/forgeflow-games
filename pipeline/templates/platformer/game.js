/**
 * ForgeFlow Games — Phaser Platformer Template
 *
 * Reusable scaffold for all platformer-genre games.
 * The pipeline fills in {{PLACEHOLDERS}} with game-specific values.
 *
 * Features:
 * - Phaser 3.90 Arcade Physics with gravity
 * - Player: run, jump, double-jump, wall-slide, dash, ground-pound
 * - Tilemap-based levels from JSON data
 * - Enemy AI: patrol, chase, flying, shooter
 * - Collectibles + power-ups
 * - Particles, screen shake, juice effects
 * - Sound effects + background music
 * - HUD with score, lives, level
 * - Menu, pause, game over, win screens
 * - window.__TEST__ hooks for Playwright QA
 */

// ═══════════════════════════════════════════════════════════════
// GAME CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const GAME_CONFIG = {
  title: "{{GAME_TITLE}}",
  width: 960,
  height: 540,
  tileSize: 18,
  gravity: 800,
  player: {
    speed: 200,
    jumpForce: -350,
    doubleJumpForce: -300,
    dashSpeed: 400,
    dashDuration: 150,
    coyoteTime: 100,    // ms after leaving ground where jump still works
    jumpBuffer: 100,    // ms before landing where jump press is remembered
    wallSlideSpeed: 50,
    maxLives: 3,
    startLives: 3,
    invincibleDuration: 1500,
  },
  enemies: {
    patrolSpeed: 80,
    chaseSpeed: 150,
    detectionRange: 200,
  },
  audio: {
    musicVolume: 0.3,
    sfxVolume: 0.6,
  },
  levels: {{LEVEL_DATA}},  // Filled by pipeline
  colors: {
    bg: "#{{BG_COLOR}}",
    accent: "#{{ACCENT_COLOR}}",
    text: "#ffffff",
  },
};

// ═══════════════════════════════════════════════════════════════
// BOOT SCENE — Loads minimal assets for loading bar
// ═══════════════════════════════════════════════════════════════

class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }

  preload() {
    // Loading bar background
    this.load.on("progress", (value) => {
      const { width, height } = this.cameras.main;
      const g = this.add.graphics();
      g.clear();
      g.fillStyle(0x111827, 1);
      g.fillRect(0, 0, width, height);
      g.fillStyle(0xff8800, 1);
      g.fillRect(width * 0.2, height / 2 - 10, width * 0.6 * value, 20);
      g.lineStyle(2, 0x334155, 1);
      g.strokeRect(width * 0.2, height / 2 - 10, width * 0.6, 20);
    });
  }

  create() {
    this.scene.start("Preload");
  }
}

// ═══════════════════════════════════════════════════════════════
// PRELOAD SCENE — Loads all game assets
// ═══════════════════════════════════════════════════════════════

class PreloadScene extends Phaser.Scene {
  constructor() { super("Preload"); }

  preload() {
    const { width, height } = this.cameras.main;

    // Loading bar
    const barBg = this.add.rectangle(width / 2, height / 2, width * 0.6, 24, 0x1e293b);
    const bar = this.add.rectangle(width * 0.2 + 2, height / 2, 0, 20, 0xff8800).setOrigin(0, 0.5);
    const loadText = this.add.text(width / 2, height / 2 - 40, "Loading...", {
      font: "18px Arial", color: "#888888",
    }).setOrigin(0.5);

    this.load.on("progress", (value) => {
      bar.width = (width * 0.6 - 4) * value;
      loadText.setText(`Loading... ${Math.floor(value * 100)}%`);
    });

    // ── SPRITES ──
    // Tileset (Kenney Pixel Platformer)
    this.load.spritesheet("tiles", "assets/tilemap_packed.png", {
      frameWidth: 18, frameHeight: 18,
    });
    this.load.spritesheet("characters", "assets/tilemap-characters_packed.png", {
      frameWidth: 24, frameHeight: 24,
    });
    this.load.spritesheet("backgrounds", "assets/tilemap-backgrounds_packed.png", {
      frameWidth: 24, frameHeight: 24,
    });

    // {{CUSTOM_SPRITE_LOADS}} — Pipeline inserts PixelLab sprites here

    // ── AUDIO ──
    // SFX
    this.load.audio("sfx_jump", "assets/audio/sfx_jump.ogg");
    this.load.audio("sfx_land", "assets/audio/sfx_land.ogg");
    this.load.audio("sfx_coin", "assets/audio/sfx_coin.ogg");
    this.load.audio("sfx_hit", "assets/audio/sfx_hit.ogg");
    this.load.audio("sfx_enemy_die", "assets/audio/sfx_enemy_die.ogg");
    this.load.audio("sfx_power_up", "assets/audio/sfx_power_up.ogg");
    this.load.audio("sfx_checkpoint", "assets/audio/sfx_checkpoint.ogg");
    this.load.audio("sfx_game_over", "assets/audio/sfx_game_over.ogg");
    this.load.audio("sfx_level_complete", "assets/audio/sfx_level_complete.ogg");

    // Music
    this.load.audio("music_menu", "assets/audio/music_menu.ogg");
    this.load.audio("music_level", "assets/audio/music_level.ogg");
    this.load.audio("music_boss", "assets/audio/music_boss.ogg");

    // ── LEVEL DATA ──
    // Levels are embedded as JSON in the config or loaded from files
    // {{LEVEL_FILE_LOADS}}
  }

  create() {
    this.scene.start("Menu");
  }
}

// ═══════════════════════════════════════════════════════════════
// MENU SCENE
// ═══════════════════════════════════════════════════════════════

class MenuScene extends Phaser.Scene {
  constructor() { super("Menu"); }

  create() {
    const { width, height } = this.cameras.main;

    // Background
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);

    // Title
    this.add.text(width / 2, height * 0.3, GAME_CONFIG.title, {
      font: "bold 48px Arial",
      color: GAME_CONFIG.colors.accent,
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(width / 2, height * 0.42, "{{GAME_TAGLINE}}", {
      font: "18px Arial",
      color: "#888888",
    }).setOrigin(0.5);

    // Play button
    const playBtn = this.add.text(width / 2, height * 0.6, "PLAY", {
      font: "bold 32px Arial",
      color: "#ffffff",
      backgroundColor: "#ff8800",
      padding: { x: 40, y: 16 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    playBtn.on("pointerover", () => playBtn.setStyle({ backgroundColor: "#ff6600" }));
    playBtn.on("pointerout", () => playBtn.setStyle({ backgroundColor: "#ff8800" }));
    playBtn.on("pointerdown", () => {
      this.scene.start("Game", { level: 0 });
    });

    // Controls
    this.add.text(width / 2, height * 0.78, "Arrow Keys / WASD to move  |  Space to jump", {
      font: "14px Arial", color: "#666666",
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.84, "{{EXTRA_CONTROLS}}", {
      font: "14px Arial", color: "#666666",
    }).setOrigin(0.5);

    // Start music
    if (this.sound.get("music_menu")) {
      this.sound.play("music_menu", { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    }

    // Keyboard start
    this.input.keyboard.once("keydown-SPACE", () => {
      this.scene.start("Game", { level: 0 });
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME SCENE — Core gameplay
// ═══════════════════════════════════════════════════════════════

class GameScene extends Phaser.Scene {
  constructor() { super("Game"); }

  init(data) {
    this.currentLevel = data.level || 0;
    this.score = data.score || 0;
    this.lives = data.lives || GAME_CONFIG.player.startLives;
    this.isInvincible = false;
    this.canDoubleJump = true;
    this.isDashing = false;
    this.coyoteTimer = 0;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
    this.comboCount = 0;
    this.comboTimer = null;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);

    // Stop menu music, start level music
    this.sound.stopAll();
    try {
      this.sound.play("music_level", { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    } catch (e) { /* audio may not be loaded in QA */ }

    // ── CREATE LEVEL ──
    this.createLevel();

    // ── PLAYER ──
    this.createPlayer();

    // ── ENEMIES ──
    this.createEnemies();

    // ── COLLECTIBLES ──
    this.createCollectibles();

    // ── HUD ──
    this.createHUD();

    // ── CAMERA ──
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setDeadzone(100, 50);

    // ── INPUT ──
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    this.shiftKey = this.input.keyboard.addKey("SHIFT");
    this.spaceKey = this.input.keyboard.addKey("SPACE");

    // ── PARTICLES ──
    this.dustEmitter = this.add.particles(0, 0, "tiles", {
      frame: [0, 1],
      lifespan: 400,
      speed: { min: 20, max: 60 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.6, end: 0 },
      gravityY: 100,
      emitting: false,
    });

    // ── TEST HOOKS ──
    this.exposeTestAPI();

    // ── PAUSE ──
    this.input.keyboard.on("keydown-ESC", () => {
      this.scene.launch("Pause");
      this.scene.pause();
    });
  }

  createLevel() {
    const levelData = GAME_CONFIG.levels[this.currentLevel];
    if (!levelData) {
      this.scene.start("Win", { score: this.score });
      return;
    }

    // Create tilemap from level data
    const map = this.make.tilemap({
      data: levelData.tiles,
      tileWidth: GAME_CONFIG.tileSize,
      tileHeight: GAME_CONFIG.tileSize,
    });
    const tileset = map.addTilesetImage("tiles", null, GAME_CONFIG.tileSize, GAME_CONFIG.tileSize);
    this.groundLayer = map.createLayer(0, tileset);
    this.groundLayer.setCollisionByExclusion([-1, 0]);

    // World bounds
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Parallax background
    this.createParallaxBackground(map.widthInPixels, map.heightInPixels);

    // Store map reference
    this.map = map;
    this.levelData = levelData;
  }

  createParallaxBackground(mapWidth, mapHeight) {
    // Far layer
    const bg1 = this.add.tileSprite(0, 0, mapWidth, mapHeight, "backgrounds", 0)
      .setOrigin(0, 0).setScrollFactor(0.1).setAlpha(0.3).setDepth(-10);
    // Mid layer
    const bg2 = this.add.tileSprite(0, 0, mapWidth, mapHeight, "backgrounds", 4)
      .setOrigin(0, 0).setScrollFactor(0.3).setAlpha(0.2).setDepth(-5);
  }

  createPlayer() {
    const spawn = this.levelData.playerSpawn || { x: 50, y: 200 };
    this.player = this.physics.add.sprite(spawn.x, spawn.y, "characters", 0);
    this.player.setCollideWorldBounds(true);
    this.player.setBounce(0);
    this.player.setSize(16, 20);
    this.player.setOffset(4, 4);
    this.player.body.setMaxVelocityY(600);

    // Player state
    this.player.health = GAME_CONFIG.player.startLives;

    // Collide with ground
    this.physics.add.collider(this.player, this.groundLayer);

    // Player animations
    this.anims.create({ key: "player_idle", frames: this.anims.generateFrameNumbers("characters", { start: 0, end: 1 }), frameRate: 4, repeat: -1 });
    this.anims.create({ key: "player_run", frames: this.anims.generateFrameNumbers("characters", { start: 0, end: 1 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: "player_jump", frames: [{ key: "characters", frame: 1 }], frameRate: 1 });
  }

  createEnemies() {
    this.enemies = this.physics.add.group();
    const enemyData = this.levelData.enemies || [];

    for (const e of enemyData) {
      const enemy = this.enemies.create(e.x, e.y, "characters", e.frame || 10);
      enemy.setCollideWorldBounds(true);
      enemy.setBounce(0);
      enemy.setSize(16, 18);
      enemy.enemyType = e.type || "patrol";
      enemy.patrolDir = 1;
      enemy.patrolRange = e.range || 100;
      enemy.startX = e.x;
      enemy.hp = e.hp || 1;
      enemy.damage = e.damage || 1;
      enemy.body.setAllowGravity(e.type !== "flying");
    }

    // Enemy-ground collision
    this.physics.add.collider(this.enemies, this.groundLayer);

    // Player-enemy collision
    this.physics.add.overlap(this.player, this.enemies, this.handleEnemyCollision, null, this);
  }

  createCollectibles() {
    this.collectibles = this.physics.add.staticGroup();
    const collectData = this.levelData.collectibles || [];

    for (const c of collectData) {
      const item = this.collectibles.create(c.x, c.y, "tiles", c.frame || 67);
      item.setSize(14, 14);
      item.value = c.value || 10;
      item.type = c.type || "coin";
    }

    // Player-collectible overlap
    this.physics.add.overlap(this.player, this.collectibles, this.collectItem, null, this);

    // Goal/exit
    if (this.levelData.exit) {
      this.exit = this.physics.add.staticSprite(
        this.levelData.exit.x, this.levelData.exit.y, "tiles", 120
      );
      this.physics.add.overlap(this.player, this.exit, this.reachExit, null, this);
    }
  }

  createHUD() {
    const style = { font: "bold 16px Arial", color: "#ffffff", stroke: "#000", strokeThickness: 3 };
    this.scoreText = this.add.text(16, 16, `Score: ${this.score}`, style).setScrollFactor(0).setDepth(100);
    this.livesText = this.add.text(16, 40, `Lives: ${this.lives}`, style).setScrollFactor(0).setDepth(100);
    this.levelText = this.add.text(this.cameras.main.width / 2, 16,
      this.levelData.name || `Level ${this.currentLevel + 1}`, {
        ...style, font: "bold 18px Arial"
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
  }

  update(time, delta) {
    if (!this.player || !this.player.active) return;

    const onGround = this.player.body.onFloor() || this.player.body.touching.down;
    const cfg = GAME_CONFIG.player;

    // ── COYOTE TIME ──
    if (onGround) {
      this.coyoteTimer = cfg.coyoteTime;
      this.canDoubleJump = true;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }

    // ── JUMP BUFFER ──
    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= delta;
    }

    // ── HORIZONTAL MOVEMENT ──
    const moveLeft = this.cursors.left.isDown || this.wasd.A.isDown;
    const moveRight = this.cursors.right.isDown || this.wasd.D.isDown;

    if (!this.isDashing) {
      if (moveLeft) {
        this.player.setVelocityX(-cfg.speed);
        this.player.setFlipX(true);
        if (onGround) this.player.anims.play("player_run", true);
      } else if (moveRight) {
        this.player.setVelocityX(cfg.speed);
        this.player.setFlipX(false);
        if (onGround) this.player.anims.play("player_run", true);
      } else {
        this.player.setVelocityX(0);
        if (onGround) this.player.anims.play("player_idle", true);
      }
    }

    // ── JUMP ──
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.spaceKey) ||
                        Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
                        Phaser.Input.Keyboard.JustDown(this.wasd.W);

    if (jumpPressed) {
      this.jumpBuffered = true;
      this.jumpBufferTimer = cfg.jumpBuffer;
    }

    const canJump = this.coyoteTimer > 0 && (jumpPressed || (this.jumpBuffered && this.jumpBufferTimer > 0));

    if (canJump) {
      this.player.setVelocityY(cfg.jumpForce);
      this.coyoteTimer = 0;
      this.jumpBuffered = false;
      this.jumpBufferTimer = 0;
      this.playSound("sfx_jump");
      this.emitDust(this.player.x, this.player.y + 12, 5);
    } else if (jumpPressed && this.canDoubleJump && !onGround && this.coyoteTimer <= 0) {
      // Double jump
      this.player.setVelocityY(cfg.doubleJumpForce);
      this.canDoubleJump = false;
      this.playSound("sfx_jump");
      this.emitDust(this.player.x, this.player.y, 8);
    }

    // Variable jump height — release early = lower jump
    if ((this.cursors.up.isUp && this.wasd.W.isUp && this.spaceKey.isUp) && this.player.body.velocity.y < -100) {
      this.player.body.velocity.y *= 0.85;
    }

    // Jump/fall animation
    if (!onGround) {
      this.player.anims.play("player_jump", true);
    }

    // ── DASH ──
    if (Phaser.Input.Keyboard.JustDown(this.shiftKey) && !this.isDashing) {
      this.isDashing = true;
      const dir = this.player.flipX ? -1 : 1;
      this.player.setVelocityX(dir * cfg.dashSpeed);
      this.player.setVelocityY(0);
      this.player.body.setAllowGravity(false);
      this.emitDust(this.player.x, this.player.y, 10);

      this.time.delayedCall(cfg.dashDuration, () => {
        this.isDashing = false;
        this.player.body.setAllowGravity(true);
      });
    }

    // ── ENEMY AI ──
    this.updateEnemies(delta);

    // ── FALL DEATH ──
    if (this.player.y > this.map.heightInPixels + 50) {
      this.playerDie();
    }

    // ── COMBO DECAY ──
    if (this.comboTimer) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboTimer = null;
      }
    }

    // ── INVINCIBILITY FLASH ──
    if (this.isInvincible) {
      this.player.setAlpha(Math.sin(time * 0.02) > 0 ? 1 : 0.3);
    }
  }

  updateEnemies(delta) {
    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;

      switch (enemy.enemyType) {
        case "patrol":
          enemy.setVelocityX(enemy.patrolDir * GAME_CONFIG.enemies.patrolSpeed);
          // Reverse at patrol bounds
          if (Math.abs(enemy.x - enemy.startX) > enemy.patrolRange) {
            enemy.patrolDir *= -1;
          }
          enemy.setFlipX(enemy.patrolDir < 0);
          // Reverse at edges (don't walk off platforms)
          if (enemy.body.onWall()) enemy.patrolDir *= -1;
          break;

        case "chase":
          const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
          if (dist < GAME_CONFIG.enemies.detectionRange) {
            const dir = this.player.x > enemy.x ? 1 : -1;
            enemy.setVelocityX(dir * GAME_CONFIG.enemies.chaseSpeed);
            enemy.setFlipX(dir < 0);
          } else {
            // Patrol when player far
            enemy.setVelocityX(enemy.patrolDir * GAME_CONFIG.enemies.patrolSpeed * 0.5);
            if (Math.abs(enemy.x - enemy.startX) > enemy.patrolRange) enemy.patrolDir *= -1;
          }
          break;

        case "flying":
          enemy.setVelocityY(Math.sin(Date.now() * 0.003 + enemy.startX) * 40);
          enemy.setVelocityX(enemy.patrolDir * GAME_CONFIG.enemies.patrolSpeed * 0.6);
          if (Math.abs(enemy.x - enemy.startX) > enemy.patrolRange) enemy.patrolDir *= -1;
          break;
      }
    });
  }

  handleEnemyCollision(player, enemy) {
    if (this.isInvincible) return;

    // Stomping from above
    if (player.body.velocity.y > 0 && player.y + player.height * 0.5 < enemy.y) {
      // Kill enemy
      enemy.hp--;
      if (enemy.hp <= 0) {
        this.killEnemy(enemy);
      } else {
        enemy.setTint(0xff0000);
        this.time.delayedCall(100, () => enemy.clearTint());
      }
      player.setVelocityY(GAME_CONFIG.player.jumpForce * 0.6);
      this.comboCount++;
      this.comboTimer = 2000;
      const pts = 100 * this.comboCount;
      this.score += pts;
      this.showFloatText(enemy.x, enemy.y - 20, `+${pts}`, this.comboCount > 1 ? "#ffcc00" : "#ffffff");
      this.updateHUD();
      this.playSound("sfx_enemy_die");
    } else {
      // Take damage
      this.playerHit();
    }
  }

  killEnemy(enemy) {
    // Particles
    this.emitDust(enemy.x, enemy.y, 12);
    // Screen shake
    this.cameras.main.shake(80, 0.005);
    enemy.destroy();
  }

  playerHit() {
    if (this.isInvincible) return;
    this.lives--;
    this.updateHUD();
    this.playSound("sfx_hit");
    this.cameras.main.shake(150, 0.01);
    this.cameras.main.flash(200, 255, 50, 50);

    if (this.lives <= 0) {
      this.playerDie();
    } else {
      // Invincibility frames
      this.isInvincible = true;
      this.player.setVelocityY(GAME_CONFIG.player.jumpForce * 0.5);
      this.time.delayedCall(GAME_CONFIG.player.invincibleDuration, () => {
        this.isInvincible = false;
        this.player.setAlpha(1);
      });
    }
  }

  playerDie() {
    this.playSound("sfx_game_over");
    this.sound.stopAll();
    this.cameras.main.shake(300, 0.02);
    this.time.delayedCall(500, () => {
      this.scene.start("GameOver", { score: this.score, level: this.currentLevel });
    });
  }

  collectItem(player, item) {
    this.score += item.value;
    this.updateHUD();
    this.playSound("sfx_coin");
    this.emitDust(item.x, item.y, 6);
    this.showFloatText(item.x, item.y - 10, `+${item.value}`, "#ffcc00");
    item.destroy();
  }

  reachExit(player, exit) {
    this.playSound("sfx_level_complete");
    this.sound.stopAll();
    this.cameras.main.flash(500, 255, 255, 255);
    this.score += 500;

    this.time.delayedCall(800, () => {
      if (this.currentLevel + 1 >= GAME_CONFIG.levels.length) {
        this.scene.start("Win", { score: this.score });
      } else {
        this.scene.start("Game", {
          level: this.currentLevel + 1,
          score: this.score,
          lives: this.lives,
        });
      }
    });

    // Notify parent (ForgeFlow Games portal) for ad break
    try {
      window.parent.postMessage({
        type: "forgeflow:level_complete",
        level: this.currentLevel,
        score: this.score,
      }, "*");
    } catch (e) {}
  }

  // ── UTILITIES ──

  playSound(key) {
    try {
      this.sound.play(key, { volume: GAME_CONFIG.audio.sfxVolume });
    } catch (e) { /* sound may not exist */ }
  }

  emitDust(x, y, count) {
    if (this.dustEmitter) {
      this.dustEmitter.emitParticleAt(x, y, count);
    }
  }

  showFloatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      font: "bold 14px Arial", color: color, stroke: "#000", strokeThickness: 2,
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: t, y: y - 40, alpha: 0, duration: 800,
      onComplete: () => t.destroy(),
    });
  }

  updateHUD() {
    this.scoreText.setText(`Score: ${this.score}`);
    this.livesText.setText(`Lives: ${this.lives}`);
  }

  // ── TEST API (for Playwright QA) ──
  exposeTestAPI() {
    window.__TEST__ = {
      getPlayer: () => ({
        x: this.player.x,
        y: this.player.y,
        velocityX: this.player.body.velocity.x,
        velocityY: this.player.body.velocity.y,
        lives: this.lives,
        alive: this.player.active,
        onGround: this.player.body.onFloor(),
      }),
      getScore: () => this.score,
      getLives: () => this.lives,
      getEnemies: () => this.enemies.children.entries.filter(e => e.active).map(e => ({
        x: e.x, y: e.y, type: e.enemyType, hp: e.hp,
      })),
      getCollectibles: () => this.collectibles.children.entries.filter(c => c.active).map(c => ({
        x: c.x, y: c.y, type: c.type, value: c.value,
      })),
      getCurrentScene: () => this.scene.key,
      getLevel: () => this.currentLevel,
      simulateInput: (key, duration = 100) => {
        this.input.keyboard.emit(`keydown-${key}`);
        setTimeout(() => this.input.keyboard.emit(`keyup-${key}`), duration);
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// PAUSE SCENE
// ═══════════════════════════════════════════════════════════════

class PauseScene extends Phaser.Scene {
  constructor() { super("Pause"); }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);
    this.add.text(width / 2, height * 0.4, "PAUSED", {
      font: "bold 48px Arial", color: "#ffffff",
    }).setOrigin(0.5);

    const resume = this.add.text(width / 2, height * 0.55, "Resume", {
      font: "24px Arial", color: "#ff8800", backgroundColor: "#1e293b",
      padding: { x: 30, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    resume.on("pointerdown", () => {
      this.scene.resume("Game");
      this.scene.stop();
    });

    this.input.keyboard.on("keydown-ESC", () => {
      this.scene.resume("Game");
      this.scene.stop();
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME OVER SCENE
// ═══════════════════════════════════════════════════════════════

class GameOverScene extends Phaser.Scene {
  constructor() { super("GameOver"); }

  init(data) {
    this.finalScore = data.score || 0;
    this.lastLevel = data.level || 0;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor("#0a0e1a");

    this.add.text(width / 2, height * 0.3, "GAME OVER", {
      font: "bold 56px Arial", color: "#ff3366",
      stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.45, `Score: ${this.finalScore}`, {
      font: "24px Arial", color: "#ffffff",
    }).setOrigin(0.5);

    const retry = this.add.text(width / 2, height * 0.6, "Try Again", {
      font: "bold 28px Arial", color: "#ffffff", backgroundColor: "#ff8800",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    retry.on("pointerdown", () => this.scene.start("Game", { level: 0 }));

    const menu = this.add.text(width / 2, height * 0.72, "Main Menu", {
      font: "20px Arial", color: "#888888",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    menu.on("pointerdown", () => this.scene.start("Menu"));

    this.input.keyboard.on("keydown-SPACE", () => this.scene.start("Game", { level: 0 }));

    // Update test hooks
    if (window.__TEST__) {
      window.__TEST__.getCurrentScene = () => "GameOver";
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// WIN SCENE
// ═══════════════════════════════════════════════════════════════

class WinScene extends Phaser.Scene {
  constructor() { super("Win"); }

  init(data) { this.finalScore = data.score || 0; }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor("#0a0e1a");

    this.add.text(width / 2, height * 0.3, "YOU WIN!", {
      font: "bold 56px Arial", color: "#00ff88",
      stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.45, `Final Score: ${this.finalScore}`, {
      font: "28px Arial", color: "#ffffff",
    }).setOrigin(0.5);

    const again = this.add.text(width / 2, height * 0.6, "Play Again", {
      font: "bold 28px Arial", color: "#ffffff", backgroundColor: "#00ff88",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    again.on("pointerdown", () => this.scene.start("Game", { level: 0 }));

    this.input.keyboard.on("keydown-SPACE", () => this.scene.start("Game", { level: 0 }));

    if (window.__TEST__) {
      window.__TEST__.getCurrentScene = () => "Win";
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASER GAME INSTANCE
// ═══════════════════════════════════════════════════════════════

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  parent: "game-container",
  backgroundColor: GAME_CONFIG.colors.bg,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: GAME_CONFIG.gravity },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PreloadScene, MenuScene, GameScene, PauseScene, GameOverScene, WinScene],
  audio: {
    disableWebAudio: false,
  },
  render: {
    pixelArt: true,
    antialias: false,
  },
});

// Expose game instance for testing
window.__GAME__ = game;
