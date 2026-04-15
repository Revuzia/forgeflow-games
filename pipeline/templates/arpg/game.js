/**
 * ForgeFlow Games — Phaser ARPG Template
 *
 * Reusable scaffold for Diablo-style action RPGs.
 * The pipeline fills in {{PLACEHOLDERS}} with game-specific values.
 *
 * Features:
 * - Phaser 3.90 Arcade Physics, NO gravity (top-down isometric feel)
 * - Click-to-move OR WASD movement
 * - Attack on click / X key
 * - Enemy waves, loot drops
 * - Health + mana bars
 * - XP + level-up system
 * - Simple inventory (3 equipment slots)
 * - Procedural room generation
 * - HUD: health bar, mana bar, XP bar, level, inventory slots
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
    speed: 160,
    attackRange: 36,
    attackCooldown: 350,
    maxHealth: 100,
    maxMana: 50,
    startHealth: 100,
    startMana: 50,
    manaRegenRate: 2,       // per second
    healthRegenRate: 0.5,   // per second
    invincibleDuration: 600,
    knockbackForce: 120,
    xpPerLevel: 100,        // XP needed per level, scales
    levelScaling: 1.4,      // xpPerLevel * levelScaling^level
  },
  enemies: {
    patrolSpeed: 50,
    chaseSpeed: 90,
    detectionRange: 160,
    spawnInterval: 8000,    // ms between wave spawns
    maxPerRoom: 8,
  },
  loot: {
    dropChance: 0.4,        // 40% chance on enemy kill
    types: ["health_potion", "mana_potion", "weapon", "armor", "ring"],
  },
  rooms: {
    minSize: 10,
    maxSize: 18,
    count: 5,               // rooms per dungeon level
    corridorWidth: 3,
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
// BOOT SCENE
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
      g.fillStyle(0xaa33ff, 1);
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
// PRELOAD SCENE
// ═══════════════════════════════════════════════════════════════

class PreloadScene extends Phaser.Scene {
  constructor() { super("Preload"); }

  preload() {
    const { width, height } = this.cameras.main;

    const barBg = this.add.rectangle(width / 2, height / 2, width * 0.6, 24, 0x1e293b);
    const bar = this.add.rectangle(width * 0.2 + 2, height / 2, 0, 20, 0xaa33ff).setOrigin(0, 0.5);
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

    // {{CUSTOM_SPRITE_LOADS}}

    // ── AUDIO ──
    this.load.audio("sfx_attack", "assets/audio/sfx_attack.ogg");
    this.load.audio("sfx_hit", "assets/audio/sfx_hit.ogg");
    this.load.audio("sfx_enemy_die", "assets/audio/sfx_enemy_die.ogg");
    this.load.audio("sfx_pickup", "assets/audio/sfx_pickup.ogg");
    this.load.audio("sfx_levelup", "assets/audio/sfx_levelup.ogg");
    this.load.audio("sfx_potion", "assets/audio/sfx_potion.ogg");
    this.load.audio("sfx_equip", "assets/audio/sfx_equip.ogg");
    this.load.audio("sfx_game_over", "assets/audio/sfx_game_over.ogg");
    this.load.audio("sfx_level_complete", "assets/audio/sfx_level_complete.ogg");

    this.load.audio("music_menu", "assets/audio/music_menu.ogg");
    this.load.audio("music_level", "assets/audio/music_level.ogg");
    this.load.audio("music_dungeon", "assets/audio/music_dungeon.ogg");
    this.load.audio("music_boss", "assets/audio/music_boss.ogg");

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

    this.add.text(width / 2, height * 0.28, GAME_CONFIG.title, {
      font: "bold 48px Arial",
      color: GAME_CONFIG.colors.accent,
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.42, "{{GAME_TAGLINE}}", {
      font: "18px Arial", color: "#888888",
    }).setOrigin(0.5);

    const playBtn = this.add.text(width / 2, height * 0.58, "ENTER THE DUNGEON", {
      font: "bold 28px Arial",
      color: "#ffffff",
      backgroundColor: "#7722cc",
      padding: { x: 40, y: 16 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    playBtn.on("pointerover", () => playBtn.setStyle({ backgroundColor: "#5511aa" }));
    playBtn.on("pointerout", () => playBtn.setStyle({ backgroundColor: "#7722cc" }));
    playBtn.on("pointerdown", () => {
      this.sound.stopAll();
      this.scene.start("Game", { level: 0 });
    });

    this.add.text(width / 2, height * 0.76, "WASD / Click to move  |  X or Click enemy to attack", {
      font: "14px Arial", color: "#666666",
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.82, "{{EXTRA_CONTROLS}}", {
      font: "14px Arial", color: "#666666",
    }).setOrigin(0.5);

    if (this.sound.get("music_menu")) {
      this.sound.play("music_menu", { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    }

    this.input.keyboard.once("keydown-SPACE", () => {
      this.sound.stopAll();
      this.scene.start("Game", { level: 0 });
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME SCENE — Core ARPG gameplay
// ═══════════════════════════════════════════════════════════════

class GameScene extends Phaser.Scene {
  constructor() { super("Game"); }

  init(data) {
    this.currentLevel = data.level || 0;
    this.score = data.score || 0;
    this.playerLevel = data.playerLevel || 1;
    this.playerXP = data.playerXP || 0;
    this.playerHealth = data.playerHealth || GAME_CONFIG.player.startHealth;
    this.playerMana = data.playerMana || GAME_CONFIG.player.startMana;
    this.maxHealth = data.maxHealth || GAME_CONFIG.player.maxHealth;
    this.maxMana = data.maxMana || GAME_CONFIG.player.maxMana;
    this.isInvincible = false;
    this.isAttacking = false;
    this.attackCooldownTimer = 0;
    this.facingDir = { x: 0, y: 1 };
    this.moveTarget = null; // For click-to-move

    // Inventory: 3 equipment slots
    this.inventory = data.inventory || {
      weapon: null,
      armor: null,
      ring: null,
    };

    // Stats modified by equipment
    this.bonusAttack = 0;
    this.bonusDefense = 0;
    this.bonusSpeed = 0;
    this.recalcStats();
  }

  recalcStats() {
    this.bonusAttack = 0;
    this.bonusDefense = 0;
    this.bonusSpeed = 0;
    if (this.inventory.weapon) this.bonusAttack += this.inventory.weapon.value;
    if (this.inventory.armor) this.bonusDefense += this.inventory.armor.value;
    if (this.inventory.ring) this.bonusSpeed += this.inventory.ring.value;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);

    this.sound.stopAll();
    try {
      this.sound.play("music_dungeon", { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    } catch (e) {}

    // ── GENERATE DUNGEON ──
    this.generateDungeon();

    // ── PLAYER ──
    this.createPlayer();

    // ── ENEMIES ──
    this.enemies = this.physics.add.group();
    this.spawnEnemies();

    // ── LOOT ──
    this.lootItems = this.physics.add.group();
    this.physics.add.overlap(this.player, this.lootItems, this.pickupLoot, null, this);

    // ── SWORD HITBOX ──
    this.swordHitbox = this.add.rectangle(0, 0, GAME_CONFIG.player.attackRange, GAME_CONFIG.player.attackRange);
    this.physics.add.existing(this.swordHitbox, false);
    this.swordHitbox.body.setAllowGravity(false);
    this.swordHitbox.setVisible(false);
    this.swordHitbox.body.enable = false;
    this.physics.add.overlap(this.swordHitbox, this.enemies, this.swordHitEnemy, null, this);

    // ── STAIRS / EXIT ──
    if (this.exitPos) {
      this.exitSprite = this.physics.add.staticSprite(this.exitPos.x, this.exitPos.y, "tiles", 120);
      this.physics.add.overlap(this.player, this.exitSprite, this.reachExit, null, this);
    }

    // ── HUD ──
    this.createHUD();

    // ── CAMERA ──
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setDeadzone(80, 50);

    // ── INPUT ──
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    this.attackKeyX = this.input.keyboard.addKey("X");
    this.potionKey1 = this.input.keyboard.addKey("ONE");
    this.potionKey2 = this.input.keyboard.addKey("TWO");

    // Click-to-move + Click-to-attack
    this.input.on("pointerdown", (pointer) => this.handlePointerDown(pointer));

    // ── PARTICLES ──
    this.hitEmitter = this.add.particles(0, 0, "tiles", {
      frame: [0, 1],
      lifespan: 300,
      speed: { min: 40, max: 100 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.8, end: 0 },
      emitting: false,
    });

    // ── WAVE SPAWNER ──
    this.waveTimer = this.time.addEvent({
      delay: GAME_CONFIG.enemies.spawnInterval,
      callback: () => this.spawnWave(),
      loop: true,
    });

    // ── TEST HOOKS ──
    this.exposeTestAPI();

    // ── PAUSE ──
    this.input.keyboard.on("keydown-ESC", () => {
      this.scene.launch("Pause");
      this.scene.pause();
    });
  }

  // ── PROCEDURAL DUNGEON ──

  generateDungeon() {
    // Check for pre-built level data first
    const levelData = GAME_CONFIG.levels[this.currentLevel];
    if (levelData && levelData.tiles) {
      // Use pre-built tilemap
      const map = this.make.tilemap({
        data: levelData.tiles,
        tileWidth: GAME_CONFIG.tileSize,
        tileHeight: GAME_CONFIG.tileSize,
      });
      const tileset = map.addTilesetImage("tiles", null, GAME_CONFIG.tileSize, GAME_CONFIG.tileSize);
      this.groundLayer = map.createLayer(0, tileset);
      this.groundLayer.setCollisionByExclusion([-1, 0]);
      this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
      this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
      this.map = map;
      this.levelData = levelData;
      this.spawnPos = levelData.playerSpawn || { x: 50, y: 50 };
      this.exitPos = levelData.exit || null;
      this.roomCenters = levelData.roomCenters || [this.spawnPos];
      return;
    }

    // Procedural generation
    const cfg = GAME_CONFIG.rooms;
    const dungeonW = 60;
    const dungeonH = 40;
    const ts = GAME_CONFIG.tileSize;

    // Initialize all walls
    const tileGrid = [];
    for (let r = 0; r < dungeonH; r++) {
      tileGrid[r] = [];
      for (let c = 0; c < dungeonW; c++) {
        tileGrid[r][c] = 1; // Wall tile
      }
    }

    // Generate rooms
    this.roomCenters = [];
    const rooms = [];
    const maxAttempts = 100;
    let attempts = 0;

    while (rooms.length < cfg.count && attempts < maxAttempts) {
      attempts++;
      const rw = Phaser.Math.Between(cfg.minSize, cfg.maxSize);
      const rh = Phaser.Math.Between(cfg.minSize, cfg.maxSize);
      const rx = Phaser.Math.Between(2, dungeonW - rw - 2);
      const ry = Phaser.Math.Between(2, dungeonH - rh - 2);

      // Check overlap with existing rooms
      let overlaps = false;
      for (const room of rooms) {
        if (rx < room.x + room.w + 2 && rx + rw + 2 > room.x &&
            ry < room.y + room.h + 2 && ry + rh + 2 > room.y) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      rooms.push({ x: rx, y: ry, w: rw, h: rh });

      // Carve room
      for (let r = ry; r < ry + rh; r++) {
        for (let c = rx; c < rx + rw; c++) {
          tileGrid[r][c] = 0; // Floor
        }
      }

      this.roomCenters.push({
        x: Math.floor(rx + rw / 2) * ts + ts / 2,
        y: Math.floor(ry + rh / 2) * ts + ts / 2,
      });
    }

    // Connect rooms with corridors
    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1];
      const b = rooms[i];
      const ax = Math.floor(a.x + a.w / 2);
      const ay = Math.floor(a.y + a.h / 2);
      const bx = Math.floor(b.x + b.w / 2);
      const by = Math.floor(b.y + b.h / 2);

      // Horizontal corridor
      const startX = Math.min(ax, bx);
      const endX = Math.max(ax, bx);
      for (let c = startX; c <= endX; c++) {
        for (let cw = -1; cw <= 1; cw++) {
          const row = ay + cw;
          if (row >= 0 && row < dungeonH) tileGrid[row][c] = 0;
        }
      }

      // Vertical corridor
      const startY = Math.min(ay, by);
      const endY = Math.max(ay, by);
      for (let r = startY; r <= endY; r++) {
        for (let cw = -1; cw <= 1; cw++) {
          const col = bx + cw;
          if (col >= 0 && col < dungeonW) tileGrid[r][col] = 0;
        }
      }
    }

    // Build tilemap
    const map = this.make.tilemap({
      data: tileGrid,
      tileWidth: ts,
      tileHeight: ts,
    });
    const tileset = map.addTilesetImage("tiles", null, ts, ts);
    this.groundLayer = map.createLayer(0, tileset);
    this.groundLayer.setCollisionByExclusion([-1, 0]);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.map = map;
    this.levelData = levelData || {};

    // Spawn in first room, exit in last room
    this.spawnPos = this.roomCenters[0];
    if (this.roomCenters.length > 1) {
      this.exitPos = this.roomCenters[this.roomCenters.length - 1];
    } else {
      this.exitPos = { x: this.spawnPos.x + 100, y: this.spawnPos.y };
    }
  }

  createPlayer() {
    this.player = this.physics.add.sprite(this.spawnPos.x, this.spawnPos.y, "characters", 0);
    this.player.setCollideWorldBounds(true);
    this.player.body.setAllowGravity(false);
    this.player.setSize(16, 18);
    this.player.setOffset(4, 6);
    this.player.setDrag(600, 600);
    this.player.setDepth(20);

    this.physics.add.collider(this.player, this.groundLayer);

    // Animations
    this.anims.create({ key: "player_idle", frames: [{ key: "characters", frame: 0 }], frameRate: 1, repeat: -1 });
    this.anims.create({ key: "player_walk", frames: this.anims.generateFrameNumbers("characters", { start: 0, end: 1 }), frameRate: 8, repeat: -1 });
  }

  // ── ENEMY SPAWNING ──

  spawnEnemies() {
    const enemyList = (this.levelData && this.levelData.enemies) ? this.levelData.enemies : [];

    if (enemyList.length > 0) {
      for (const e of enemyList) {
        this.createEnemy(e.x, e.y, e.type || "patrol", e.hp || 3, e.frame || 10);
      }
    } else {
      // Spawn enemies in rooms (not the first room)
      for (let i = 1; i < this.roomCenters.length; i++) {
        const center = this.roomCenters[i];
        const count = Phaser.Math.Between(2, 4);
        for (let j = 0; j < count; j++) {
          const ex = center.x + Phaser.Math.Between(-40, 40);
          const ey = center.y + Phaser.Math.Between(-40, 40);
          const type = Math.random() < 0.3 ? "chase" : "patrol";
          this.createEnemy(ex, ey, type, 2 + this.currentLevel, 10);
        }
      }
    }
  }

  createEnemy(x, y, type, hp, frame) {
    if (this.enemies.children.size >= GAME_CONFIG.enemies.maxPerRoom * 2) return;

    const enemy = this.enemies.create(x, y, "characters", frame);
    enemy.setCollideWorldBounds(true);
    enemy.body.setAllowGravity(false);
    enemy.setSize(16, 18);
    enemy.setDrag(300, 300);
    enemy.setDepth(15);
    enemy.enemyType = type;
    enemy.hp = hp;
    enemy.maxHp = hp;
    enemy.damage = 8 + this.currentLevel * 3;
    enemy.patrolDir = { x: Math.random() > 0.5 ? 1 : -1, y: 0 };
    enemy.startX = x;
    enemy.startY = y;
    enemy.patrolRange = 60;
    enemy.xpValue = 20 + this.currentLevel * 5;

    this.physics.add.collider(enemy, this.groundLayer);
    this.physics.add.overlap(this.player, enemy, this.handleEnemyCollision, null, this);
  }

  spawnWave() {
    if (this.enemies.children.size >= GAME_CONFIG.enemies.maxPerRoom * 2) return;
    // Spawn 1-3 enemies near a random room (not first)
    if (this.roomCenters.length <= 1) return;
    const idx = Phaser.Math.Between(1, this.roomCenters.length - 1);
    const center = this.roomCenters[idx];
    const count = Phaser.Math.Between(1, 3);
    for (let i = 0; i < count; i++) {
      const ex = center.x + Phaser.Math.Between(-30, 30);
      const ey = center.y + Phaser.Math.Between(-30, 30);
      this.createEnemy(ex, ey, "chase", 2 + this.currentLevel, 10);
    }
  }

  // ── HUD ──

  createHUD() {
    const { width } = this.cameras.main;
    const hudY = 10;

    // Health bar background
    this.add.rectangle(120, hudY + 8, 160, 14, 0x333333).setScrollFactor(0).setDepth(100).setOrigin(0.5);
    this.healthBar = this.add.rectangle(42, hudY + 2, 156, 12, 0xff3333).setScrollFactor(0).setDepth(101).setOrigin(0, 0);
    this.healthText = this.add.text(120, hudY + 8, `${this.playerHealth}/${this.maxHealth}`, {
      font: "bold 10px Arial", color: "#ffffff",
    }).setScrollFactor(0).setDepth(102).setOrigin(0.5);
    this.add.text(16, hudY + 3, "HP", { font: "bold 12px Arial", color: "#ff5555" }).setScrollFactor(0).setDepth(102);

    // Mana bar
    this.add.rectangle(120, hudY + 26, 160, 14, 0x333333).setScrollFactor(0).setDepth(100).setOrigin(0.5);
    this.manaBar = this.add.rectangle(42, hudY + 20, 156, 12, 0x3366ff).setScrollFactor(0).setDepth(101).setOrigin(0, 0);
    this.manaText = this.add.text(120, hudY + 26, `${Math.floor(this.playerMana)}/${this.maxMana}`, {
      font: "bold 10px Arial", color: "#ffffff",
    }).setScrollFactor(0).setDepth(102).setOrigin(0.5);
    this.add.text(16, hudY + 21, "MP", { font: "bold 12px Arial", color: "#6699ff" }).setScrollFactor(0).setDepth(102);

    // XP bar
    const xpNeeded = this.getXPForLevel(this.playerLevel);
    this.add.rectangle(120, hudY + 44, 160, 10, 0x333333).setScrollFactor(0).setDepth(100).setOrigin(0.5);
    this.xpBar = this.add.rectangle(42, hudY + 40, 156 * (this.playerXP / xpNeeded), 8, 0x33cc33).setScrollFactor(0).setDepth(101).setOrigin(0, 0);
    this.xpText = this.add.text(120, hudY + 44, `XP: ${this.playerXP}/${xpNeeded}`, {
      font: "bold 9px Arial", color: "#ffffff",
    }).setScrollFactor(0).setDepth(102).setOrigin(0.5);

    // Level
    this.levelText = this.add.text(width - 16, hudY, `Lv ${this.playerLevel}`, {
      font: "bold 18px Arial", color: "#ffcc00", stroke: "#000", strokeThickness: 3,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    // Score
    this.scoreText = this.add.text(width - 16, hudY + 24, `Score: ${this.score}`, {
      font: "bold 14px Arial", color: "#ffffff", stroke: "#000", strokeThickness: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    // Floor
    this.floorText = this.add.text(width / 2, hudY, `Floor ${this.currentLevel + 1}`, {
      font: "bold 16px Arial", color: "#aaaaaa", stroke: "#000", strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    // Inventory slots (bottom of screen)
    this.createInventoryHUD();
  }

  createInventoryHUD() {
    const { width, height } = this.cameras.main;
    const slotSize = 36;
    const startX = width / 2 - slotSize * 1.5 - 4;
    const slotY = height - slotSize - 10;

    const slots = ["weapon", "armor", "ring"];
    const labels = ["W", "A", "R"];
    const slotColors = [0x884422, 0x446688, 0x668844];

    this.invSlots = {};

    for (let i = 0; i < 3; i++) {
      const sx = startX + i * (slotSize + 4);
      this.add.rectangle(sx + slotSize / 2, slotY + slotSize / 2, slotSize, slotSize, 0x1a1a2e, 0.8)
        .setStrokeStyle(2, slotColors[i]).setScrollFactor(0).setDepth(100);

      this.add.text(sx + 4, slotY + 2, labels[i], {
        font: "bold 10px Arial", color: "#666666",
      }).setScrollFactor(0).setDepth(101);

      const valueText = this.add.text(sx + slotSize / 2, slotY + slotSize / 2 + 4, "", {
        font: "bold 12px Arial", color: "#ffffff",
      }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

      this.invSlots[slots[i]] = valueText;
    }

    this.updateInventoryHUD();
  }

  updateInventoryHUD() {
    for (const slot of ["weapon", "armor", "ring"]) {
      const item = this.inventory[slot];
      if (item) {
        this.invSlots[slot].setText(`+${item.value}`);
      } else {
        this.invSlots[slot].setText("--");
      }
    }
  }

  updateHUD() {
    // Health
    const hpRatio = Math.max(0, this.playerHealth / this.maxHealth);
    this.healthBar.width = 156 * hpRatio;
    this.healthText.setText(`${Math.floor(this.playerHealth)}/${this.maxHealth}`);

    // Mana
    const mpRatio = Math.max(0, this.playerMana / this.maxMana);
    this.manaBar.width = 156 * mpRatio;
    this.manaText.setText(`${Math.floor(this.playerMana)}/${this.maxMana}`);

    // XP
    const xpNeeded = this.getXPForLevel(this.playerLevel);
    const xpRatio = Math.min(1, this.playerXP / xpNeeded);
    this.xpBar.width = 156 * xpRatio;
    this.xpText.setText(`XP: ${this.playerXP}/${xpNeeded}`);

    // Level
    this.levelText.setText(`Lv ${this.playerLevel}`);
    this.scoreText.setText(`Score: ${this.score}`);
  }

  // ── UPDATE LOOP ──

  update(time, delta) {
    if (!this.player || !this.player.active) return;

    const cfg = GAME_CONFIG.player;
    const dt = delta / 1000;

    // ── REGEN ──
    if (this.playerHealth < this.maxHealth) {
      this.playerHealth = Math.min(this.maxHealth, this.playerHealth + cfg.healthRegenRate * dt);
    }
    if (this.playerMana < this.maxMana) {
      this.playerMana = Math.min(this.maxMana, this.playerMana + cfg.manaRegenRate * dt);
    }

    // ── ATTACK COOLDOWN ──
    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer -= delta;
    }

    // ── MOVEMENT (WASD) ──
    const moveLeft = this.cursors.left.isDown || this.wasd.A.isDown;
    const moveRight = this.cursors.right.isDown || this.wasd.D.isDown;
    const moveUp = this.cursors.up.isDown || this.wasd.W.isDown;
    const moveDown = this.cursors.down.isDown || this.wasd.S.isDown;

    let vx = 0;
    let vy = 0;
    const effectiveSpeed = cfg.speed + this.bonusSpeed;

    if (moveLeft || moveRight || moveUp || moveDown) {
      this.moveTarget = null; // Cancel click-to-move
      if (moveLeft) vx = -1;
      if (moveRight) vx = 1;
      if (moveUp) vy = -1;
      if (moveDown) vy = 1;

      if (vx !== 0 && vy !== 0) {
        vx *= Math.SQRT1_2;
        vy *= Math.SQRT1_2;
      }

      if (!this.isAttacking) {
        this.player.setVelocity(vx * effectiveSpeed, vy * effectiveSpeed);
      }
    } else if (this.moveTarget && !this.isAttacking) {
      // Click-to-move
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.moveTarget.x, this.moveTarget.y);
      if (dist > 8) {
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.moveTarget.x, this.moveTarget.y);
        this.player.setVelocity(Math.cos(angle) * effectiveSpeed, Math.sin(angle) * effectiveSpeed);
        vx = Math.cos(angle);
        vy = Math.sin(angle);
      } else {
        this.moveTarget = null;
        this.player.setVelocity(0, 0);
      }
    } else if (!this.isAttacking) {
      this.player.setVelocity(0, 0);
    }

    // Facing direction
    if (vx !== 0 || vy !== 0) {
      this.facingDir = { x: vx, y: vy };
      this.player.anims.play("player_walk", true);
      this.player.setFlipX(vx < 0);
    } else {
      this.player.anims.play("player_idle", true);
    }

    // ── KEYBOARD ATTACK ──
    if (Phaser.Input.Keyboard.JustDown(this.attackKeyX) && this.attackCooldownTimer <= 0 && !this.isAttacking) {
      this.performAttack();
    }

    // ── POTIONS (1 = health, 2 = mana) ──
    if (Phaser.Input.Keyboard.JustDown(this.potionKey1)) {
      this.useHealthPotion();
    }
    if (Phaser.Input.Keyboard.JustDown(this.potionKey2)) {
      this.useManaPotion();
    }

    // ── ENEMY AI ──
    this.updateEnemies(delta);

    // ── UPDATE HUD ──
    this.updateHUD();

    // ── INVINCIBILITY FLASH ──
    if (this.isInvincible) {
      this.player.setAlpha(Math.sin(time * 0.02) > 0 ? 1 : 0.3);
    }
  }

  // ── INPUT ──

  handlePointerDown(pointer) {
    // Convert to world coordinates
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

    // Check if clicking on an enemy (attack)
    let hitEnemy = null;
    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;
      const dist = Phaser.Math.Distance.Between(worldPoint.x, worldPoint.y, enemy.x, enemy.y);
      if (dist < 24) {
        hitEnemy = enemy;
      }
    });

    if (hitEnemy) {
      // Move toward enemy and attack
      this.moveTarget = { x: hitEnemy.x, y: hitEnemy.y };
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, hitEnemy.x, hitEnemy.y) < GAME_CONFIG.player.attackRange * 1.5) {
        if (this.attackCooldownTimer <= 0 && !this.isAttacking) {
          this.facingDir = {
            x: hitEnemy.x - this.player.x,
            y: hitEnemy.y - this.player.y,
          };
          this.performAttack();
        }
      }
    } else {
      // Click-to-move
      this.moveTarget = { x: worldPoint.x, y: worldPoint.y };
    }
  }

  performAttack() {
    this.isAttacking = true;
    this.attackCooldownTimer = GAME_CONFIG.player.attackCooldown;

    const range = GAME_CONFIG.player.attackRange;
    const len = Math.sqrt(this.facingDir.x * this.facingDir.x + this.facingDir.y * this.facingDir.y) || 1;
    const nx = this.facingDir.x / len;
    const ny = this.facingDir.y / len;

    const sx = this.player.x + nx * range;
    const sy = this.player.y + ny * range;

    this.swordHitbox.setPosition(sx, sy);
    this.swordHitbox.body.enable = true;

    // Slash effect
    const slash = this.add.rectangle(sx, sy, range, range, 0xffaa00, 0.6).setDepth(50);
    this.tweens.add({
      targets: slash, alpha: 0, scaleX: 1.6, scaleY: 1.6, duration: 150,
      onComplete: () => slash.destroy(),
    });

    this.playSound("sfx_attack");
    this.player.setVelocity(0, 0);

    this.time.delayedCall(150, () => {
      this.isAttacking = false;
      this.swordHitbox.body.enable = false;
    });
  }

  swordHitEnemy(hitbox, enemy) {
    const baseDamage = 15 + this.bonusAttack;
    enemy.hp -= baseDamage;
    this.emitHit(enemy.x, enemy.y, 8);
    this.cameras.main.shake(50, 0.003);
    this.showFloatText(enemy.x, enemy.y - 16, `-${baseDamage}`, "#ffcc00");

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    } else {
      enemy.setTint(0xff0000);
      this.time.delayedCall(100, () => { if (enemy.active) enemy.clearTint(); });
      this.playSound("sfx_hit");

      // Knockback
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      enemy.setVelocity(Math.cos(angle) * 200, Math.sin(angle) * 200);
    }
  }

  killEnemy(enemy) {
    this.score += 25;
    this.gainXP(enemy.xpValue);
    this.emitHit(enemy.x, enemy.y, 15);
    this.playSound("sfx_enemy_die");

    // Loot drop
    if (Math.random() < GAME_CONFIG.loot.dropChance) {
      this.dropLoot(enemy.x, enemy.y);
    }

    enemy.destroy();
    this.updateHUD();
  }

  // ── XP & LEVEL UP ──

  getXPForLevel(level) {
    return Math.floor(GAME_CONFIG.player.xpPerLevel * Math.pow(GAME_CONFIG.player.levelScaling, level - 1));
  }

  gainXP(amount) {
    this.playerXP += amount;
    this.showFloatText(this.player.x, this.player.y - 24, `+${amount} XP`, "#33cc33");

    const needed = this.getXPForLevel(this.playerLevel);
    if (this.playerXP >= needed) {
      this.playerXP -= needed;
      this.playerLevel++;
      this.onLevelUp();
    }
  }

  onLevelUp() {
    // Increase stats
    this.maxHealth += 15;
    this.maxMana += 8;
    this.playerHealth = this.maxHealth;
    this.playerMana = this.maxMana;

    // Visual feedback
    this.cameras.main.flash(300, 255, 255, 100);
    this.showFloatText(this.player.x, this.player.y - 40, `LEVEL UP! Lv ${this.playerLevel}`, "#ffcc00");
    this.playSound("sfx_levelup");
    this.updateHUD();
  }

  // ── LOOT ──

  dropLoot(x, y) {
    const types = GAME_CONFIG.loot.types;
    const type = types[Math.floor(Math.random() * types.length)];
    const frames = { health_potion: 67, mana_potion: 68, weapon: 80, armor: 81, ring: 82 };

    const loot = this.lootItems.create(x + Phaser.Math.Between(-10, 10), y + Phaser.Math.Between(-10, 10),
      "tiles", frames[type] || 67);
    loot.body.setAllowGravity(false);
    loot.setSize(12, 12);
    loot.setDepth(10);
    loot.lootType = type;
    loot.lootValue = Phaser.Math.Between(3, 8 + this.currentLevel * 2);

    // Bounce animation
    this.tweens.add({
      targets: loot, y: loot.y - 10, duration: 300, yoyo: true, ease: "Sine.easeOut",
    });
  }

  pickupLoot(player, loot) {
    const type = loot.lootType;
    const value = loot.lootValue;

    switch (type) {
      case "health_potion":
        this.playerHealth = Math.min(this.maxHealth, this.playerHealth + 30);
        this.showFloatText(loot.x, loot.y - 10, "+30 HP", "#ff5555");
        this.playSound("sfx_potion");
        break;
      case "mana_potion":
        this.playerMana = Math.min(this.maxMana, this.playerMana + 20);
        this.showFloatText(loot.x, loot.y - 10, "+20 MP", "#5599ff");
        this.playSound("sfx_potion");
        break;
      case "weapon":
        this.inventory.weapon = { name: "Sword", value: value, type: "weapon" };
        this.showFloatText(loot.x, loot.y - 10, `Weapon +${value}`, "#ffaa00");
        this.playSound("sfx_equip");
        this.recalcStats();
        this.updateInventoryHUD();
        break;
      case "armor":
        this.inventory.armor = { name: "Armor", value: value, type: "armor" };
        this.showFloatText(loot.x, loot.y - 10, `Armor +${value}`, "#6699ff");
        this.playSound("sfx_equip");
        this.recalcStats();
        this.updateInventoryHUD();
        break;
      case "ring":
        this.inventory.ring = { name: "Ring", value: value, type: "ring" };
        this.showFloatText(loot.x, loot.y - 10, `Ring +${value}`, "#66cc66");
        this.playSound("sfx_equip");
        this.recalcStats();
        this.updateInventoryHUD();
        break;
    }

    this.score += 10;
    this.emitHit(loot.x, loot.y, 6);
    loot.destroy();
    this.updateHUD();
  }

  useHealthPotion() {
    if (this.playerHealth >= this.maxHealth) return;
    this.playerHealth = Math.min(this.maxHealth, this.playerHealth + 30);
    this.showFloatText(this.player.x, this.player.y - 20, "+30 HP", "#ff5555");
    this.playSound("sfx_potion");
    this.updateHUD();
  }

  useManaPotion() {
    if (this.playerMana >= this.maxMana) return;
    this.playerMana = Math.min(this.maxMana, this.playerMana + 20);
    this.showFloatText(this.player.x, this.player.y - 20, "+20 MP", "#5599ff");
    this.playSound("sfx_potion");
    this.updateHUD();
  }

  // ── ENEMY AI ──

  updateEnemies(delta) {
    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;

      const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);

      switch (enemy.enemyType) {
        case "patrol": {
          enemy.setVelocityX(enemy.patrolDir.x * GAME_CONFIG.enemies.patrolSpeed);
          const dx = Math.abs(enemy.x - enemy.startX);
          if (dx > enemy.patrolRange || enemy.body.blocked.left || enemy.body.blocked.right) {
            enemy.patrolDir.x *= -1;
          }
          enemy.setFlipX(enemy.patrolDir.x < 0);

          // Switch to chase if player is close
          if (dist < GAME_CONFIG.enemies.detectionRange * 0.7) {
            enemy.enemyType = "chase";
          }
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
            enemy.setVelocity(0, 0);
          }
          break;
        }
      }
    });
  }

  handleEnemyCollision(player, enemy) {
    if (this.isInvincible) return;
    const damage = Math.max(1, enemy.damage - this.bonusDefense);
    this.playerHit(damage);
  }

  playerHit(damage) {
    if (this.isInvincible) return;
    this.playerHealth -= damage;
    this.showFloatText(this.player.x, this.player.y - 16, `-${damage}`, "#ff3333");
    this.updateHUD();
    this.playSound("sfx_hit");
    this.cameras.main.shake(120, 0.008);
    this.cameras.main.flash(150, 255, 50, 50);

    if (this.playerHealth <= 0) {
      this.playerDie();
    } else {
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
      this.scene.start("GameOver", { score: this.score, level: this.currentLevel, playerLevel: this.playerLevel });
    });
  }

  reachExit(player, exit) {
    this.playSound("sfx_level_complete");
    this.sound.stopAll();
    this.cameras.main.flash(500, 255, 255, 255);
    this.score += 200;

    this.time.delayedCall(800, () => {
      const totalLevels = GAME_CONFIG.levels.length || 5;
      if (this.currentLevel + 1 >= totalLevels) {
        this.scene.start("Win", { score: this.score, playerLevel: this.playerLevel });
      } else {
        this.scene.start("Game", {
          level: this.currentLevel + 1,
          score: this.score,
          playerLevel: this.playerLevel,
          playerXP: this.playerXP,
          playerHealth: this.playerHealth,
          playerMana: this.playerMana,
          maxHealth: this.maxHealth,
          maxMana: this.maxMana,
          inventory: { ...this.inventory },
        });
      }
    });

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
    } catch (e) {}
  }

  emitHit(x, y, count) {
    if (this.hitEmitter) {
      this.hitEmitter.emitParticleAt(x, y, count);
    }
  }

  showFloatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      font: "bold 13px Arial", color: color, stroke: "#000", strokeThickness: 2,
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 700,
      onComplete: () => t.destroy(),
    });
  }

  // ── TEST API ──
  exposeTestAPI() {
    window.__TEST__ = {
      getPlayer: () => ({
        x: this.player.x,
        y: this.player.y,
        velocityX: this.player.body.velocity.x,
        velocityY: this.player.body.velocity.y,
        health: this.playerHealth,
        maxHealth: this.maxHealth,
        mana: this.playerMana,
        maxMana: this.maxMana,
        level: this.playerLevel,
        xp: this.playerXP,
        alive: this.player.active,
        inventory: { ...this.inventory },
      }),
      getScore: () => this.score,
      getLives: () => Math.ceil(this.playerHealth / (this.maxHealth / 3)),
      getEnemies: () => this.enemies.children.entries.filter(e => e.active).map(e => ({
        x: e.x, y: e.y, type: e.enemyType, hp: e.hp, maxHp: e.maxHp,
      })),
      getCurrentScene: () => this.scene.key,
      getLevel: () => this.currentLevel,
      getPlayerLevel: () => this.playerLevel,
      getInventory: () => ({ ...this.inventory }),
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
      font: "24px Arial", color: "#aa33ff", backgroundColor: "#1e293b",
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
    this.finalPlayerLevel = data.playerLevel || 1;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor("#0a0e1a");

    this.add.text(width / 2, height * 0.25, "YOU DIED", {
      font: "bold 56px Arial", color: "#ff3366",
      stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.42, `Score: ${this.finalScore}`, {
      font: "24px Arial", color: "#ffffff",
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.50, `Reached Level ${this.finalPlayerLevel} | Floor ${this.lastLevel + 1}`, {
      font: "18px Arial", color: "#aaaaaa",
    }).setOrigin(0.5);

    const retry = this.add.text(width / 2, height * 0.64, "Try Again", {
      font: "bold 28px Arial", color: "#ffffff", backgroundColor: "#7722cc",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    retry.on("pointerdown", () => this.scene.start("Game", { level: 0 }));

    const menu = this.add.text(width / 2, height * 0.78, "Main Menu", {
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

  init(data) {
    this.finalScore = data.score || 0;
    this.finalPlayerLevel = data.playerLevel || 1;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor("#0a0e1a");

    this.add.text(width / 2, height * 0.25, "DUNGEON CLEARED!", {
      font: "bold 48px Arial", color: "#ffcc00",
      stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.42, `Final Score: ${this.finalScore}`, {
      font: "28px Arial", color: "#ffffff",
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.50, `Hero Level: ${this.finalPlayerLevel}`, {
      font: "20px Arial", color: "#aaaaaa",
    }).setOrigin(0.5);

    const again = this.add.text(width / 2, height * 0.64, "Play Again", {
      font: "bold 28px Arial", color: "#ffffff", backgroundColor: "#ffcc00",
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

window.__GAME__ = game;
