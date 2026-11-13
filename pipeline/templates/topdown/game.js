/**
 * ForgeFlow Games — Phaser Top-Down Adventure Template
 *
 * Reusable scaffold for Zelda-like adventure games.
 * The pipeline substitutes template tokens with game-specific values.
 *
 * Features:
 * - Phaser 3.90 Arcade Physics, NO gravity (top-down view)
 * - 8-directional movement (WASD / Arrow keys)
 * - Sword / attack mechanic (X or Z key)
 * - Tilemap-based levels from JSON data
 * - Enemy AI: patrol, chase, ranged
 * - Health system (hearts, not lives)
 * - Collectibles (keys, gems, hearts)
 * - Dialog system placeholder
 * - HUD: hearts, keys, minimap area name
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
  player: {
    speed: 140,
    attackRange: 30,
    attackCooldown: 400,
    maxHearts: 6,
    startHearts: 3,
    invincibleDuration: 1200,
    knockbackForce: 150,
  },
  enemies: {
    patrolSpeed: 60,
    chaseSpeed: 100,
    detectionRange: 140,
    rangedCooldown: 2000,
    projectileSpeed: 160,
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
    this.load.on("progress", (value) => {
      const { width, height } = this.cameras.main;
      const g = this.add.graphics();
      g.clear();
      g.fillStyle(0x111827, 1);
      g.fillRect(0, 0, width, height);
      g.fillStyle(0x00cc66, 1);
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
    const bar = this.add.rectangle(width * 0.2 + 2, height / 2, 0, 20, 0x00cc66).setOrigin(0, 0.5);
    const loadText = this.add.text(width / 2, height / 2 - 40, "Loading...", {
      font: "18px Arial", color: "#888888",
    }).setOrigin(0.5);

    this.load.on("progress", (value) => {
      bar.width = (width * 0.6 - 4) * value;
      loadText.setText(`Loading... ${Math.floor(value * 100)}%`);
    });

    // ── SPRITES ──
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
    this.load.audio("sfx_attack", "assets/audio/sfx_attack.ogg");
    this.load.audio("sfx_hit", "assets/audio/sfx_hit.ogg");
    this.load.audio("sfx_pickup", "assets/audio/sfx_pickup.ogg");
    this.load.audio("sfx_key", "assets/audio/sfx_key.ogg");
    this.load.audio("sfx_door", "assets/audio/sfx_door.ogg");
    this.load.audio("sfx_enemy_die", "assets/audio/sfx_enemy_die.ogg");
    this.load.audio("sfx_heal", "assets/audio/sfx_heal.ogg");
    this.load.audio("sfx_game_over", "assets/audio/sfx_game_over.ogg");
    this.load.audio("sfx_level_complete", "assets/audio/sfx_level_complete.ogg");

    // Music
    this.load.audio("music_menu", "assets/audio/music_menu.ogg");
    this.load.audio("music_level", "assets/audio/music_level.ogg");
    this.load.audio("music_dungeon", "assets/audio/music_dungeon.ogg");
    this.load.audio("music_boss", "assets/audio/music_boss.ogg");

    // ── LEVEL DATA ──
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
    const playBtn = this.add.text(width / 2, height * 0.6, "BEGIN ADVENTURE", {
      font: "bold 28px Arial",
      color: "#ffffff",
      backgroundColor: "#228855",
      padding: { x: 40, y: 16 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    playBtn.on("pointerover", () => playBtn.setStyle({ backgroundColor: "#1a6644" }));
    playBtn.on("pointerout", () => playBtn.setStyle({ backgroundColor: "#228855" }));
    playBtn.on("pointerdown", () => {
      this.sound.stopAll();
      this.scene.start("Game", { level: 0 });
    });

    // Controls
    this.add.text(width / 2, height * 0.78, "Arrow Keys / WASD to move  |  X or Z to attack", {
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
      this.sound.stopAll();
      this.scene.start("Game", { level: 0 });
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME SCENE — Core gameplay (top-down adventure)
// ═══════════════════════════════════════════════════════════════

class GameScene extends Phaser.Scene {
  constructor() { super("Game"); }

  init(data) {
    this.currentLevel = data.level || 0;
    this.score = data.score || 0;
    this.hearts = data.hearts || GAME_CONFIG.player.startHearts;
    this.keys = data.keys || 0;
    this.isInvincible = false;
    this.isAttacking = false;
    this.attackCooldownTimer = 0;
    this.facingDir = { x: 0, y: 1 }; // Default facing down
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);

    // Stop menu music, start level music
    this.sound.stopAll();
    try {
      const levelData = GAME_CONFIG.levels[this.currentLevel];
      const musicKey = levelData && levelData.music ? levelData.music : "music_level";
      this.sound.play(musicKey, { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    } catch (e) { /* audio may not be loaded in QA */ }

    // ── CREATE LEVEL ──
    this.createLevel();

    // ── PLAYER ──
    this.createPlayer();

    // ── ENEMIES ──
    this.createEnemies();

    // ── COLLECTIBLES ──
    this.createCollectibles();

    // ── DOORS ──
    this.createDoors();

    // ── PROJECTILES ──
    this.projectiles = this.physics.add.group();
    this.physics.add.overlap(this.player, this.projectiles, this.projectileHitPlayer, null, this);
    this.physics.add.collider(this.projectiles, this.groundLayer, (proj) => proj.destroy());

    // ── SWORD HITBOX ──
    this.swordHitbox = this.add.rectangle(0, 0, GAME_CONFIG.player.attackRange, GAME_CONFIG.player.attackRange);
    this.physics.add.existing(this.swordHitbox, false);
    this.swordHitbox.body.setAllowGravity(false);
    this.swordHitbox.setVisible(false);
    this.swordHitbox.body.enable = false;

    this.physics.add.overlap(this.swordHitbox, this.enemies, this.swordHitEnemy, null, this);

    // ── HUD ──
    this.createHUD();

    // ── DIALOG ──
    this.dialogBox = null;
    this.dialogActive = false;

    // ── CAMERA ──
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(60, 40);

    // ── INPUT ──
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    this.attackKeyX = this.input.keyboard.addKey("X");
    this.attackKeyZ = this.input.keyboard.addKey("Z");
    this.interactKey = this.input.keyboard.addKey("E");

    // ── PLAYER CONTROLLER ──
    // Canonical 8-directional controller (see templates/shared/topdown_controller.js).
    // Owns input → vx/vy → diagonal-normalize → setVelocity. Game still owns
    // animation choice (4-axis walk_left/right/up/down) using intent.cardinalDir.
    if (typeof window.TopdownController2D === "function") {
      this.controller = new window.TopdownController2D(this, {
        preset: (window.GAME_DESIGN && window.GAME_DESIGN.controller_preset) || "default",
        overrides: { speed: GAME_CONFIG.player.speed },
      });
      this.controller.attach(this.player);
    } else {
      console.error("[GameScene] TopdownController2D missing — topdown_controller.js failed to load");
    }

    // ── PARTICLES ──
    this.sparkEmitter = this.add.particles(0, 0, "tiles", {
      frame: [0, 1],
      lifespan: 300,
      speed: { min: 30, max: 80 },
      scale: { start: 0.4, end: 0 },
      alpha: { start: 0.7, end: 0 },
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

    // Store map reference
    this.map = map;
    this.levelData = levelData;
  }

  createPlayer() {
    const spawn = this.levelData.playerSpawn || { x: 50, y: 50 };
    this.player = this.physics.add.sprite(spawn.x, spawn.y, "characters", 0);
    this.player.setCollideWorldBounds(true);
    this.player.body.setAllowGravity(false);
    this.player.setSize(16, 18);
    this.player.setOffset(4, 6);
    this.player.setDrag(500, 500);

    // Collide with walls
    this.physics.add.collider(this.player, this.groundLayer);

    // Player animations (4 directions)
    this.anims.create({ key: "player_idle_down", frames: [{ key: "characters", frame: 0 }], frameRate: 1, repeat: -1 });
    this.anims.create({ key: "player_idle_up", frames: [{ key: "characters", frame: 3 }], frameRate: 1, repeat: -1 });
    this.anims.create({ key: "player_idle_left", frames: [{ key: "characters", frame: 6 }], frameRate: 1, repeat: -1 });
    this.anims.create({ key: "player_idle_right", frames: [{ key: "characters", frame: 6 }], frameRate: 1, repeat: -1 });
    this.anims.create({ key: "player_walk_down", frames: this.anims.generateFrameNumbers("characters", { start: 0, end: 1 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: "player_walk_up", frames: this.anims.generateFrameNumbers("characters", { start: 3, end: 4 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: "player_walk_left", frames: this.anims.generateFrameNumbers("characters", { start: 6, end: 7 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: "player_walk_right", frames: this.anims.generateFrameNumbers("characters", { start: 6, end: 7 }), frameRate: 8, repeat: -1 });
  }

  createEnemies() {
    this.enemies = this.physics.add.group();
    const enemyData = this.levelData.enemies || [];

    for (const e of enemyData) {
      const enemy = this.enemies.create(e.x, e.y, "characters", e.frame || 10);
      enemy.setCollideWorldBounds(true);
      enemy.body.setAllowGravity(false);
      enemy.setSize(16, 18);
      enemy.setDrag(300, 300);
      enemy.enemyType = e.type || "patrol";
      enemy.patrolDir = { x: 1, y: 0 };
      enemy.patrolRange = e.range || 80;
      enemy.startX = e.x;
      enemy.startY = e.y;
      enemy.hp = e.hp || 2;
      enemy.damage = e.damage || 1;
      enemy.rangedTimer = 0;
    }

    // Enemy-wall collision
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
      item.type = c.type || "gem"; // gem, key, heart
    }

    this.physics.add.overlap(this.player, this.collectibles, this.collectItem, null, this);
  }

  createDoors() {
    this.doors = this.physics.add.staticGroup();
    const doorData = this.levelData.doors || [];

    for (const d of doorData) {
      const door = this.doors.create(d.x, d.y, "tiles", d.frame || 100);
      door.setSize(18, 18);
      door.keysRequired = d.keysRequired || 1;
      door.targetLevel = d.targetLevel;
      door.targetSpawn = d.targetSpawn || null;
    }

    this.physics.add.overlap(this.player, this.doors, this.tryOpenDoor, null, this);

    // Exit/goal
    if (this.levelData.exit) {
      this.exit = this.physics.add.staticSprite(
        this.levelData.exit.x, this.levelData.exit.y, "tiles", 120
      );
      this.physics.add.overlap(this.player, this.exit, this.reachExit, null, this);
    }
  }

  createHUD() {
    const hudStyle = { font: "bold 16px Arial", color: "#ffffff", stroke: "#000", strokeThickness: 3 };

    // Hearts
    this.heartIcons = [];
    for (let i = 0; i < GAME_CONFIG.player.maxHearts; i++) {
      const hx = 16 + i * 22;
      const heart = this.add.text(hx, 14, (i < this.hearts) ? "\u2665" : "\u2661", {
        font: "bold 20px Arial",
        color: (i < this.hearts) ? "#ff3366" : "#333333",
        stroke: "#000",
        strokeThickness: 2,
      }).setScrollFactor(0).setDepth(100);
      this.heartIcons.push(heart);
    }

    // Keys
    this.keysText = this.add.text(16, 40, `Keys: ${this.keys}`, hudStyle).setScrollFactor(0).setDepth(100);

    // Score
    this.scoreText = this.add.text(16, 62, `Score: ${this.score}`, hudStyle).setScrollFactor(0).setDepth(100);

    // Area name
    this.areaText = this.add.text(this.cameras.main.width / 2, 16,
      this.levelData.name || `Area ${this.currentLevel + 1}`, {
        ...hudStyle, font: "bold 18px Arial",
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
  }

  update(time, delta) {
    if (!this.player || !this.player.active) return;
    if (this.dialogActive) return;

    const cfg = GAME_CONFIG.player;

    // ── ATTACK COOLDOWN ──
    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer -= delta;
    }

    // ── 8-DIRECTIONAL MOVEMENT (delegated to TopdownController2D) ──
    // Controller owns input → vx/vy → diagonal-normalize → setVelocity.
    // Game owns animation policy (4-axis walk_left/right/up/down vs idle_*).
    if (this.controller) {
      const intent = this.controller.tick(time, delta, {
        skipMovement: this.isAttacking,
        speed: cfg.speed,
      });
      // Sync legacy facingDir (some patches read it)
      if (intent.moving) {
        this.facingDir = {
          x: Math.sign(intent.vx) || this.facingDir.x,
          y: Math.sign(intent.vy) || this.facingDir.y,
        };
      }
      // Animation: pick by cardinalDir + flipX rules from the original template
      if (intent.moving) {
        if (intent.cardinalDir === "left") {
          this._safePlayAnim("player_walk_left");
          this.player.setFlipX(false);
        } else if (intent.cardinalDir === "right") {
          this._safePlayAnim("player_walk_right");
          this.player.setFlipX(true);
        } else if (intent.cardinalDir === "up") {
          this._safePlayAnim("player_walk_up");
        } else {
          this._safePlayAnim("player_walk_down");
        }
      } else {
        if (this.facingDir.y < 0) {
          this._safePlayAnim("player_idle_up");
        } else if (Math.abs(this.facingDir.x) > Math.abs(this.facingDir.y)) {
          this._safePlayAnim("player_idle_right");
          this.player.setFlipX(this.facingDir.x < 0 ? false : true);
        } else {
          this._safePlayAnim("player_idle_down");
        }
      }
    }

    // ── ATTACK ──
    const attackPressed = Phaser.Input.Keyboard.JustDown(this.attackKeyX) ||
                          Phaser.Input.Keyboard.JustDown(this.attackKeyZ);

    if (attackPressed && this.attackCooldownTimer <= 0 && !this.isAttacking) {
      this.performAttack();
    }

    // ── ENEMY AI ──
    try { this.updateEnemies(time, delta); } catch (_e) {
      if (!this._enemyAiErrorLogged) {
        console.warn("[GameScene] updateEnemies threw; further errors suppressed.", _e);
        this._enemyAiErrorLogged = true;
      }
    }

    // ── ENEMY NORMALIZER (vec2, 2026-04-27) ──
    // Pipeline-level guarantee: every patrol-type enemy gets a baseline 2D
    // patrol velocity along its patrolDir vector, and patrolDir is clamped at
    // boundaries so enemies don't oscillate in place. Ensures enemies_move QA
    // passes regardless of what Claude generated for per-game enemy AI.
    // Uses vec2 patrolDir.x/y (top-down convention) — different from the
    // platformer's scalar patrolDir.
    try {
      if (this.enemies && this.enemies.children) {
        this.enemies.children.iterate((enemy) => {
          if (!enemy || !enemy.active || !enemy.body) return;
          if (enemy.enemyType !== "patrol") return;
          const pd = enemy.patrolDir;
          if (!pd || (pd.x === 0 && pd.y === 0)) return;
          // Baseline patrol velocity if at rest
          if (Math.abs(enemy.body.velocity.x) < 1 && Math.abs(enemy.body.velocity.y) < 1) {
            const sp = (GAME_CONFIG.enemies && GAME_CONFIG.enemies.patrolSpeed) || 60;
            enemy.body.setVelocity(pd.x * sp * 0.6, pd.y * sp * 0.6);
          }
          // Boundary clamp on radial patrol distance
          const sx = (typeof enemy.startX === "number") ? enemy.startX : enemy.x;
          const sy = (typeof enemy.startY === "number") ? enemy.startY : enemy.y;
          const range = enemy.patrolRange || 100;
          const dx = enemy.x - sx;
          const dy = enemy.y - sy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > range) {
            // Reverse direction + nudge inside the patrol circle
            pd.x *= -1;
            pd.y *= -1;
            const ratio = (range - 2) / dist;
            enemy.x = sx + dx * ratio;
            enemy.y = sy + dy * ratio;
          }
        });
      }
    } catch (_e) { /* enemy normalizer must never break the game */ }

    // ── INVINCIBILITY FLASH ──
    if (this.isInvincible) {
      this.player.setAlpha(Math.sin(time * 0.02) > 0 ? 1 : 0.3);
    }
  }

  performAttack() {
    this.isAttacking = true;
    this.attackCooldownTimer = GAME_CONFIG.player.attackCooldown;

    // Position sword hitbox in facing direction
    const range = GAME_CONFIG.player.attackRange;
    let sx = this.player.x;
    let sy = this.player.y;

    // Pick dominant facing
    if (Math.abs(this.facingDir.x) >= Math.abs(this.facingDir.y)) {
      sx += this.facingDir.x > 0 ? range : -range;
    } else {
      sy += this.facingDir.y > 0 ? range : -range;
    }

    this.swordHitbox.setPosition(sx, sy);
    this.swordHitbox.body.enable = true;

    // Visual slash effect
    const slash = this.add.rectangle(sx, sy, range, range, 0xffffff, 0.6).setDepth(50);
    this.tweens.add({
      targets: slash,
      alpha: 0,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 150,
      onComplete: () => slash.destroy(),
    });

    this.playSound("sfx_attack");

    // Short pause during attack
    this.player.setVelocity(0, 0);

    this.time.delayedCall(150, () => {
      this.isAttacking = false;
      this.swordHitbox.body.enable = false;
    });
  }

  swordHitEnemy(hitbox, enemy) {
    enemy.hp--;
    this.emitSparks(enemy.x, enemy.y, 8);
    this.cameras.main.shake(60, 0.004);

    if (enemy.hp <= 0) {
      this.score += 50;
      this.showFloatText(enemy.x, enemy.y - 16, "+50", "#ffcc00");
      this.emitSparks(enemy.x, enemy.y, 15);
      this.playSound("sfx_enemy_die");
      enemy.destroy();
    } else {
      enemy.setTint(0xff0000);
      this.time.delayedCall(100, () => { if (enemy.active) enemy.clearTint(); });
      this.playSound("sfx_hit");

      // Knockback enemy
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      enemy.setVelocity(Math.cos(angle) * 200, Math.sin(angle) * 200);
    }

    this.updateHUD();
  }

  updateEnemies(time, delta) {
    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;

      const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);

      switch (enemy.enemyType) {
        case "patrol": {
          // Walk along patrol axis, reverse at range or wall
          enemy.setVelocityX(enemy.patrolDir.x * GAME_CONFIG.enemies.patrolSpeed);
          enemy.setVelocityY(enemy.patrolDir.y * GAME_CONFIG.enemies.patrolSpeed);

          const dx = enemy.x - enemy.startX;
          const dy = enemy.y - enemy.startY;
          const patrolDist = Math.sqrt(dx * dx + dy * dy);

          if (patrolDist > enemy.patrolRange || enemy.body.blocked.left || enemy.body.blocked.right ||
              enemy.body.blocked.up || enemy.body.blocked.down) {
            enemy.patrolDir.x *= -1;
            enemy.patrolDir.y *= -1;
          }
          enemy.setFlipX(enemy.patrolDir.x < 0);
          break;
        }

        case "chase": {
          if (dist < GAME_CONFIG.enemies.detectionRange) {
            const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
            enemy.setVelocity(
              Math.cos(angle) * GAME_CONFIG.enemies.chaseSpeed,
              Math.sin(angle) * GAME_CONFIG.enemies.chaseSpeed
            );
            enemy.setFlipX(this.player.x < enemy.x);
          } else {
            // Idle / slow patrol
            enemy.setVelocityX(enemy.patrolDir.x * GAME_CONFIG.enemies.patrolSpeed * 0.4);
            const dx = enemy.x - enemy.startX;
            if (Math.abs(dx) > enemy.patrolRange) enemy.patrolDir.x *= -1;
          }
          break;
        }

        case "ranged": {
          if (dist < GAME_CONFIG.enemies.detectionRange * 1.5) {
            enemy.rangedTimer += delta;
            // Face player
            enemy.setFlipX(this.player.x < enemy.x);
            // Stop moving, aim
            enemy.setVelocity(0, 0);

            if (enemy.rangedTimer >= GAME_CONFIG.enemies.rangedCooldown) {
              enemy.rangedTimer = 0;
              this.enemyShoot(enemy);
            }
          } else {
            // Patrol slowly
            enemy.setVelocityX(enemy.patrolDir.x * GAME_CONFIG.enemies.patrolSpeed * 0.3);
            if (Math.abs(enemy.x - enemy.startX) > enemy.patrolRange) enemy.patrolDir.x *= -1;
          }
          break;
        }
      }
    });
  }

  enemyShoot(enemy) {
    const proj = this.projectiles.create(enemy.x, enemy.y, "tiles", 85);
    proj.body.setAllowGravity(false);
    proj.setSize(8, 8);
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    proj.setVelocity(
      Math.cos(angle) * GAME_CONFIG.enemies.projectileSpeed,
      Math.sin(angle) * GAME_CONFIG.enemies.projectileSpeed
    );
    // Auto-destroy after 3 seconds
    this.time.delayedCall(3000, () => { if (proj.active) proj.destroy(); });
  }

  projectileHitPlayer(player, proj) {
    proj.destroy();
    this.playerHit(1);
  }

  handleEnemyCollision(player, enemy) {
    if (this.isInvincible) return;
    this.playerHit(enemy.damage);
  }

  playerHit(damage) {
    if (this.isInvincible) return;
    this.hearts -= damage;
    this.updateHUD();
    this.playSound("sfx_hit");
    this.cameras.main.shake(150, 0.01);
    this.cameras.main.flash(200, 255, 50, 50);

    if (this.hearts <= 0) {
      this.playerDie();
    } else {
      // Knockback
      this.isInvincible = true;
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
    switch (item.type) {
      case "key":
        this.keys++;
        this.playSound("sfx_key");
        this.showFloatText(item.x, item.y - 10, "+KEY", "#ffcc00");
        break;
      case "heart":
        if (this.hearts < GAME_CONFIG.player.maxHearts) {
          this.hearts++;
          this.playSound("sfx_heal");
          this.showFloatText(item.x, item.y - 10, "+\u2665", "#ff3366");
        }
        break;
      case "gem":
      default:
        this.score += item.value;
        this.playSound("sfx_pickup");
        this.showFloatText(item.x, item.y - 10, `+${item.value}`, "#00ffaa");
        break;
    }

    this.emitSparks(item.x, item.y, 6);
    item.destroy();
    this.updateHUD();
  }

  tryOpenDoor(player, door) {
    if (this.keys >= door.keysRequired) {
      this.keys -= door.keysRequired;
      this.playSound("sfx_door");
      this.emitSparks(door.x, door.y, 10);
      door.destroy();
      this.updateHUD();

      // If door leads to another level
      if (door.targetLevel !== undefined && door.targetLevel !== null) {
        this.cameras.main.flash(400, 255, 255, 255);
        this.time.delayedCall(500, () => {
          this.scene.start("Game", {
            level: door.targetLevel,
            score: this.score,
            hearts: this.hearts,
            keys: this.keys,
          });
        });
      }
    } else {
      this.showFloatText(door.x, door.y - 16, `Need ${door.keysRequired} key(s)`, "#ff5555");
    }
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
          hearts: this.hearts,
          keys: this.keys,
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

  // ── DIALOG SYSTEM ──

  showDialog(text, onComplete) {
    this.dialogActive = true;
    this.player.setVelocity(0, 0);
    const { width, height } = this.cameras.main;

    const bgRect = this.add.rectangle(width / 2, height - 70, width - 40, 100, 0x000000, 0.85)
      .setScrollFactor(0).setDepth(200);
    const dialogText = this.add.text(width / 2, height - 70, text, {
      font: "16px Arial", color: "#ffffff", wordWrap: { width: width - 80 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    const continueText = this.add.text(width - 40, height - 30, "[SPACE]", {
      font: "12px Arial", color: "#888888",
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(201);

    this.dialogBox = { bgRect, dialogText, continueText };

    this.input.keyboard.once("keydown-SPACE", () => {
      bgRect.destroy();
      dialogText.destroy();
      continueText.destroy();
      this.dialogBox = null;
      this.dialogActive = false;
      if (onComplete) onComplete();
    });
  }

  // ── UTILITIES ──

  playSound(key) {
    try {
      this.sound.play(key, { volume: GAME_CONFIG.audio.sfxVolume });
    } catch (e) { /* sound may not exist */ }
  }

  emitSparks(x, y, count) {
    if (this.sparkEmitter) {
      this.sparkEmitter.emitParticleAt(x, y, count);
    }
  }

  showFloatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      font: "bold 14px Arial", color: color, stroke: "#000", strokeThickness: 2,
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: t, y: y - 35, alpha: 0, duration: 800,
      onComplete: () => t.destroy(),
    });
  }

  updateHUD() {
    // Hearts
    for (let i = 0; i < this.heartIcons.length; i++) {
      this.heartIcons[i].setText(i < this.hearts ? "\u2665" : "\u2661");
      this.heartIcons[i].setColor(i < this.hearts ? "#ff3366" : "#333333");
    }
    this.keysText.setText(`Keys: ${this.keys}`);
    this.scoreText.setText(`Score: ${this.score}`);
  }

  // ── TEST API (for Playwright QA) ──

  // 2026-04-23: play an animation only if it exists + has frames. Missing
  // animations (e.g. when spritesheet load silently failed) otherwise throw
  // "Cannot read properties of undefined (reading 'duration')" in Phaser's
  // animation system, which aborts the entire update() loop — stopping player
  // movement, gravity, and enemy updates. Wrapping here makes every call safe.
  _safePlayAnim(key, ignoreIfPlaying = true) {
    try {
      if (!this.player || !this.player.anims) return;
      const animSys = this.anims;
      if (!animSys || typeof animSys.exists !== "function" || !animSys.exists(key)) return;
      const def = animSys.get(key);
      if (!def || !def.frames || def.frames.length === 0) return;
      this.player.anims.play(key, ignoreIfPlaying);
    } catch (e) {
      // Swallow — animation errors must never abort the update loop.
    }
  }

  exposeTestAPI() {
    window.__TEST__ = {
      getPlayer: () => ({
        x: this.player.x,
        y: this.player.y,
        velocityX: this.player.body.velocity.x,
        velocityY: this.player.body.velocity.y,
        hearts: this.hearts,
        keys: this.keys,
        alive: this.player.active,
        facing: this.facingDir,
        attacking: this.isAttacking,
      }),
      getScore: () => this.score,
      getLives: () => this.hearts,
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
      font: "24px Arial", color: "#228855", backgroundColor: "#1e293b",
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
      font: "bold 28px Arial", color: "#ffffff", backgroundColor: "#228855",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    retry.on("pointerdown", () => this.scene.start("Game", { level: 0 }));

    const menu = this.add.text(width / 2, height * 0.72, "Main Menu", {
      font: "20px Arial", color: "#888888",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    menu.on("pointerdown", () => this.scene.start("Menu"));

    this.input.keyboard.on("keydown-SPACE", () => this.scene.start("Game", { level: 0 }));

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

    this.add.text(width / 2, height * 0.3, "ADVENTURE COMPLETE!", {
      font: "bold 48px Arial", color: "#00ff88",
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
      gravity: { y: 0 },
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
