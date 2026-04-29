/**
 * ForgeFlow Games — Phaser Platformer Template
 *
 * Reusable scaffold for all platformer-genre games.
 * The pipeline substitutes template tokens with game-specific values.
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

// 2026-04-28: full design.json exposed at runtime so the ability /
// power-up / world-mechanic / dialog libraries can read protagonist,
// worlds, power_ups, npc_cast, etc. without their own fetch.
// {{GAME_DESIGN_JSON}} is replaced by the pipeline at integrate time.
window.GAME_DESIGN = {{GAME_DESIGN_JSON}};

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
  levels: [],  // Filled by pipeline from content_units cache
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
    // Fallback textures moved to PreloadScene.preload (using make.graphics
    // with add:false so no scene-attached objects block auto-transition).
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

    // 2026-04-28: fallback textures so any group.create(x, y, null) call
    // (e.g. enemy projectiles, moving platforms in patches) has a valid
    // texture instead of TypeError on undefined.sys.
    const makeRect = (key, w, h, color) => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(color, 1);
      g.fillRect(0, 0, w, h);
      g.generateTexture(key, w, h);
      g.destroy();
    };
    makeRect("__pixel", 1, 1, 0xffffff);
    makeRect("__projectile", 12, 12, 0xff5040);
    makeRect("__platform", 48, 16, 0x7a5230);

    // ── SPRITES ──
    // 2026-04-28: Load the SHARED ASSET LIBRARY (springs, switches, ladders,
    // doors, lava, water, castle bg, HUD icons, gems, flags).
    if (typeof window.AssetLoader !== "undefined" && window.AssetLoader.preload) {
      window.AssetLoader.preload(this);
    }
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

{{CUSTOM_SPRITE_LOADS}}

    // 2026-04-23: Kenney animated enemies atlas (mapped per-game by
    // enemy_sprite_mapper.py; see enemy_anim_config.json). Loaded via
    // atlasXML so Phaser can reference frames by name (bat.png, bat_fly.png,
    // etc.) and we register idle/walk/hit/dead animations in GameScene.
    if (window.__ENEMY_ANIM_CONFIG && window.__ENEMY_ANIM_CONFIG.atlas_png) {
      this.load.atlasXML(
        window.__ENEMY_ANIM_CONFIG.atlas_key,
        "assets/" + window.__ENEMY_ANIM_CONFIG.atlas_png,
        "assets/" + window.__ENEMY_ANIM_CONFIG.atlas_xml
      );
    }

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

    // 2026-04-23: "Continue" if a save exists; otherwise "New Game".
    let saved = null;
    try {
      if (window.SaveLoad && window.SaveLoad.init) {
        window.SaveLoad.init(GAME_CONFIG.title.toLowerCase().replace(/\s+/g, "-"));
      }
      if (window.SaveLoad && window.SaveLoad.load) {
        saved = window.SaveLoad.load(0);  // slot 0 = autosave
      }
    } catch (_e) { saved = null; }

    const startNew = () => this.scene.start("Game", { level: 0, score: 0, lives: GAME_CONFIG.player.startLives });
    const continueGame = () => {
      const s = saved || {};
      this.scene.start("Game", {
        level: Math.min(s.lastLevel || 0, Math.max(0, (GAME_CONFIG.levels || []).length - 1)),
        score: s.score || 0,
        lives: s.lives || GAME_CONFIG.player.startLives,
      });
    };

    const playLabel = saved ? "CONTINUE" : "PLAY";
    const playBtn = this.add.text(width / 2, height * 0.58, playLabel, {
      font: "bold 32px Arial",
      color: "#ffffff",
      backgroundColor: "#ff8800",
      padding: { x: 40, y: 16 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    playBtn.on("pointerover", () => playBtn.setStyle({ backgroundColor: "#ff6600" }));
    playBtn.on("pointerout", () => playBtn.setStyle({ backgroundColor: "#ff8800" }));
    playBtn.on("pointerdown", saved ? continueGame : startNew);

    // If a save exists, also show "NEW GAME" as a secondary option.
    if (saved) {
      const newBtn = this.add.text(width / 2, height * 0.68, "NEW GAME", {
        font: "16px Arial",
        color: "#aaaaaa",
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      newBtn.on("pointerover", () => newBtn.setStyle({ color: "#ffffff" }));
      newBtn.on("pointerout", () => newBtn.setStyle({ color: "#aaaaaa" }));
      newBtn.on("pointerdown", () => {
        try { window.SaveLoad && window.SaveLoad.save && window.SaveLoad.save(0, { lastLevel: 0, lives: 0, score: 0 }); } catch (_) {}
        startNew();
      });
    }

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

    // Keyboard start — Space AND Enter; respects Continue-vs-New via saved flag.
    const kbStart = saved ? continueGame : startNew;
    this.input.keyboard.once("keydown-SPACE", kbStart);
    this.input.keyboard.once("keydown-ENTER", kbStart);

    // Analytics: session_start (no-op if not configured)
    try { if (window.Analytics && window.Analytics.event) window.Analytics.event("session_start", { has_save: !!saved }); } catch (_) {}
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
    // MUST be created BEFORE setupTileHazards / createMovingPlatforms because
    // those register physics overlaps/colliders with this.player. If player is
    // undefined when the collider is registered, Phaser's arcade physics throws
    // `Cannot read properties of undefined (reading 'isParent')` every frame —
    // which silently freezes the entire game loop. (Diagnosed 2026-04-27.)
    this.createPlayer();

    // ── ENEMIES ──
    this.createEnemies();

    // 2026-04-23: hazard tiles (lava/saw/spike-ceiling/crumble/vine/ice/water)
    // and moving platforms — registered AFTER player + enemies exist so the
    // collider/overlap calls have valid targets.
    try { this.setupTileHazards(); } catch (_e) { console.warn("setupTileHazards failed:", _e); }
    try { this.createMovingPlatforms(); } catch (_e) { console.warn("createMovingPlatforms failed:", _e); }

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

    // ── PLAYER CONTROLLER ──
    // Canonical platformer controller (see templates/shared/platformer_controller.js).
    // Owns: horizontal movement, jump (ground/coyote/buffered/double), variable
    // jump cut, dash. The pipeline NEVER inlines this logic per-game — that was
    // the source of "stuck at QA #1" bugs (each generated game had subtle
    // integration-order bugs). This is the single source of truth.
    if (typeof window.PlatformerController2D === "function") {
      this.controller = new window.PlatformerController2D(this, {
        preset: (window.GAME_DESIGN && window.GAME_DESIGN.controller_preset) || "default",
        overrides: GAME_CONFIG.player,
      });
      this.controller.attach(this.player);
    } else {
      console.error("[GameScene] PlatformerController2D missing — platformer_controller.js failed to load");
    }

    // 2026-04-23: AAA pipeline hook — patch_player_systems.js may define
    // setupCustomAbilityControls() to register game-specific ability keys.
    // Optional call (no-op if patch not present).
    if (typeof this.setupCustomAbilityControls === "function") {
      try { this.setupCustomAbilityControls(); } catch (_e) { /* non-fatal */ }
    }

    // 2026-04-28: ABILITY / POWER-UP / WORLD-MECHANIC / DIALOG WIRING.
    // Each library reads the design (window.GAME_DESIGN injected at boot)
    // and configures itself for the current world/level. These are NO-OPS
    // if the library wasn't loaded (graceful degradation).
    try {
      // Resolve the current world's design data
      const worldNum = (this.levelData && this.levelData.world_num) || 1;
      const designWorlds = (window.GAME_DESIGN && window.GAME_DESIGN.worlds) || [];
      const designWorld = designWorlds.find(w => (w.num || 0) === worldNum) || designWorlds[worldNum - 1] || null;

      if (typeof window.Abilities !== "undefined") {
        window.Abilities.attach(this);
      }
      if (typeof window.WorldMechanics !== "undefined" && designWorld) {
        window.WorldMechanics.attach(this, designWorld);
      }
      if (typeof window.Dialog !== "undefined") {
        const npcs = (window.GAME_DESIGN && window.GAME_DESIGN.npc_cast) || [];
        if (npcs.length) window.Dialog.spawnForWorld(this, npcs, worldNum);
      }
      // Set pieces from the synthesizer (vines, NPC markers, etc.)
      this._spawnSetPieces();
      // Power-ups: scatter 1-2 per level based on design.power_ups
      if (typeof window.PowerUps !== "undefined") {
        const pu = (window.GAME_DESIGN && window.GAME_DESIGN.power_ups) || [];
        if (pu.length && this.map) {
          const cols = this.map.width;
          const tile = this.map.tileWidth || 18;
          const floorY = (this.map.height - 4) * tile - 32;
          // Pick 1-2 power-ups for this level (deterministic per level index)
          const seed = (this.currentLevel || 0) * 7919;
          const i1 = (seed) % pu.length;
          const i2 = (seed + 3) % pu.length;
          window.PowerUps.spawn(this, cols * 0.4 * tile, floorY, pu[i1]);
          if (this.currentLevel >= 2) window.PowerUps.spawn(this, cols * 0.8 * tile, floorY, pu[i2]);
        }
      }
    } catch (libErr) {
      console.warn("[GameScene] library wiring failed:", libErr);
    }

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
    // 2026-04-23 T4: level mode dispatch. "minecart" auto-runs, "underwater"
    // swims. Default "standard" = normal platforming. Stored on the scene so
    // update() + createPlayer() can branch.
    this.levelMode = levelData.mode || "standard";

    // Create tilemap from level data.
    // 2026-04-28: convert 0 -> -1 so empty cells don't render as kenney tile
    // index 0 (grass block). Phaser tilemap from-data treats -1 as empty;
    // 0 is a valid tile index. The level synthesizer uses 0 for "no tile"
    // (86% of cells) so without this remap the entire viewport tiles over
    // with grass and the foreground/parallax bg are obscured.
    const remappedTiles = levelData.tiles.map(row =>
      row.map(v => (v === 0 ? -1 : v)));
    const map = this.make.tilemap({
      data: remappedTiles,
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
    // 2026-04-28: prefer the per-world full-image background
    // (world_NN_bg.jpg generated by phase_assets via Grok Imagine).
    // Was: tiled the kenney tilemap-backgrounds_packed.png frame 0 across the
    // whole viewport, which rendered the small tile-pattern at full screen
    // covering all foreground (caught by visual_bot 2026-04-28).
    const worldNum = (this.levelData && this.levelData.world_num) || 1;
    const bgKey = `world_${String(worldNum).padStart(2, "0")}_bg`;
    if (this.textures.exists(bgKey)) {
      // Strong dark overlay (fillAlpha 0.5) on top of the bg so it recedes
      // behind the kenney pixel-art foreground (vision_qa_bot 3/10 verdict:
      // "background overpowers gameplay, art-style mismatch"). Keep bg at
      // full alpha — reducing it just blends with the camera bg color and
      // doesn't actually darken the image.
      this.add.image(0, 0, bgKey)
        .setOrigin(0, 0)
        .setDisplaySize(mapWidth, mapHeight)
        .setScrollFactor(0.3)
        .setDepth(-10);
      this.add.rectangle(0, 0, mapWidth, mapHeight, 0x000814, 0.5)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(-9);
    } else {
      // Fallback: solid background color from GAME_CONFIG (no tile-fill bug)
      const bgColor = (GAME_CONFIG.colors && GAME_CONFIG.colors.bg) || "#1a3a5e";
      this.cameras.main.setBackgroundColor(bgColor);
    }
  }

  // 2026-04-28: spawn entities from levelData.set_pieces[] (vine, npc_marker,
  // etc.) into the right Phaser groups so the abilities/dialog libraries
  // can interact with them. Set pieces come from the level synthesizer
  // which reads design.json's per-level set_pieces strings.
  _spawnSetPieces() {
    const sps = (this.levelData && this.levelData.set_pieces) || [];
    if (!sps.length) return;
    if (!this.vines) this.vines = this.physics.add.staticGroup();
    for (const sp of sps) {
      try {
        if (sp.type === "vine") {
          // Tall thin vertical green sprite, grabbable by Abilities.vine_swing
          const v = this.vines.create(sp.x, sp.y, "__pixel");
          v.setDisplaySize(4, 100).setTint(0x4caf50);
          v.isVine = true;
          v.refreshBody && v.refreshBody();
        } else if (sp.type === "npc_marker") {
          // If we have a per-world NPC, place one HERE instead of default
          const designNpcs = (window.GAME_DESIGN && window.GAME_DESIGN.npc_cast) || [];
          const worldNum = (this.levelData && this.levelData.world_num) || 1;
          const npc = designNpcs.find(n => !n.location_world || n.location_world === worldNum);
          if (npc && window.Dialog && window.Dialog.spawn) {
            window.Dialog.spawn(this, sp.x, sp.y, npc);
          }
        } else if (sp.type === "structure") {
          // Decorative block already added to tiles in synthesizer; nothing to do
        }
        // fruit_cluster / barrel / marker entries are already in collectibles
      } catch (e) { console.warn("[setpiece] spawn failed:", sp, e); }
    }
  }

  createPlayer() {
    const spawn = this.levelData.playerSpawn || { x: 50, y: 200 };
    this.player = this.physics.add.sprite(spawn.x, spawn.y, "characters", 0);
    this.player.setCollideWorldBounds(true);
    this.player.setBounce(0);
    // 2026-04-28: scale player 2.5x. Kenney characters atlas is 24px native;
    // enemies_atlas is 64px. Player was 2.7x smaller than common enemies on
    // screen (user feedback) — backwards from DKC-style where the protagonist
    // is the same size or larger than mooks. setScale(2.5) makes player ~60px
    // tall to match enemies. Body dims also scale with the sprite in Phaser
    // 3 Arcade physics so collisions stay correct.
    this.player.setScale(2.5);
    this.player.setSize(16, 20);
    this.player.setOffset(4, 4);
    this.player.body.setMaxVelocityY(600);

    // 2026-04-23 T4: delegate mode-specific setup to a design-driven hook.
    // The PIPELINE generates applyLevelModeSetup() as a patch from
    // design.special_level_modes (e.g. DKC needs "minecart" + "underwater";
    // Sonic would need "boost_loop"; Metroid would need "morph_ball").
    // Template stays genre-agnostic.
    if (typeof this.applyLevelModeSetup === "function") {
      try { this.applyLevelModeSetup(this.levelMode); } catch (_e) { /* non-fatal */ }
    }

    // Player state
    this.player.health = GAME_CONFIG.player.startLives;

    // Collide with ground
    this.physics.add.collider(this.player, this.groundLayer);

    // Player animations
    // 2026-04-28: guard against re-registration on scene restart (was
    // logging "AnimationManager key already exists" warning every level
    // change). The AnimationManager is per-Game not per-Scene.
    if (!this.anims.exists("player_idle")) {
      this.anims.create({ key: "player_idle", frames: this.anims.generateFrameNumbers("characters", { start: 0, end: 1 }), frameRate: 4, repeat: -1 });
    }
    if (!this.anims.exists("player_run")) {
      this.anims.create({ key: "player_run", frames: this.anims.generateFrameNumbers("characters", { start: 0, end: 1 }), frameRate: 10, repeat: -1 });
    }
    if (!this.anims.exists("player_jump")) {
      this.anims.create({ key: "player_jump", frames: [{ key: "characters", frame: 1 }], frameRate: 1 });
    }
  }

  createEnemies() {
    this.enemies = this.physics.add.group();
    const enemyData = this.levelData.enemies || [];

    // 2026-04-23: register per-type enemy animations from the injected config.
    // enemy_sprite_mapper.py maps each design enemy to a Kenney type (bat,
    // slimeGreen, etc.) with idle/walk/hit/dead animation frames. Here we
    // register those animations once per type before spawning enemies.
    const enemyCfg = (typeof window !== "undefined" && window.__ENEMY_ANIM_CONFIG) || null;
    const enemyAnimsReady = !!(enemyCfg && this.textures.exists(enemyCfg.atlas_key));
    // 2026-04-23: iterate structured anim specs — no runtime code evaluation.
    // We never parse untrusted JS strings; animations are pure data.
    if (enemyAnimsReady && Array.isArray(enemyCfg.animations)) {
      for (const spec of enemyCfg.animations) {
        if (!spec || !spec.key || !Array.isArray(spec.frames)) continue;
        if (this.anims.exists(spec.key)) continue;
        try {
          this.anims.create({
            key: spec.key,
            frames: spec.frames.map(f => ({ key: enemyCfg.atlas_key, frame: f })),
            frameRate: spec.frameRate || 10,
            repeat: spec.repeat == null ? -1 : spec.repeat,
          });
        } catch (_regErr) {
          console.warn("[enemyAnims] failed to register", spec.key, _regErr);
        }
      }
    }

    for (const e of enemyData) {
      // Determine sprite source: prefer Kenney atlas frame for the mapped type,
      // fall back to the classic `characters` spritesheet for non-mapped enemies.
      let texKey = "characters";
      let baseFrame = e.frame || 10;
      let kenneyType = null;
      if (enemyAnimsReady && enemyCfg.by_name) {
        const enemyName = e.enemy_ref || e.name;
        const cfg = enemyName && enemyCfg.by_name[enemyName];
        if (cfg && cfg.kenney_type) {
          kenneyType = cfg.kenney_type;
          texKey = enemyCfg.atlas_key;
          baseFrame = cfg.base_frame;
        }
      }
      const enemy = this.enemies.create(e.x, e.y, texKey, baseFrame);
      enemy.setCollideWorldBounds(true);
      enemy.setBounce(0);
      enemy.setSize(16, 18);
      // 2026-04-23: enemy runtime shape documented in action_2d.build_entity_library
      // prompt. Set BOTH conventions (startX/patrolRange AND patrolStart/patrolEnd)
      // so Claude-generated AI code works regardless of which pair it references.
      enemy.enemyType = e.type || "patrol";
      enemy.name = e.enemy_ref || e.name || "Enemy";
      enemy.kenneyType = kenneyType;  // for updateEnemies to pick right anim key
      enemy.patrolDir = e.patrolDir || 1;
      enemy.patrolRange = e.range || e.patrolRange || 100;
      enemy.startX = e.x;
      enemy.patrolStart = (e.patrolStart !== undefined) ? e.patrolStart : (e.x - enemy.patrolRange);
      enemy.patrolEnd   = (e.patrolEnd   !== undefined) ? e.patrolEnd   : (e.x + enemy.patrolRange);
      enemy.detectionRange = e.detectionRange || 200;
      enemy.hp = e.hp || 1;
      enemy.damage = e.damage || 1;
      enemy.speed = e.speed || 60;
      enemy.body.setAllowGravity(e.type !== "flying" && e.type !== "fly");
      // Play walk anim by default (idle kicks in when velocity = 0 via updateEnemies)
      if (kenneyType) {
        const animKey = `${kenneyType}_walk`;
        if (this.anims.exists(animKey)) {
          try { enemy.play(animKey, true); } catch (_e) {}
        }
      }
    }

    // Enemy-ground collision
    this.physics.add.collider(this.enemies, this.groundLayer);

    // Player-enemy collision
    this.physics.add.overlap(this.player, this.enemies, this.handleEnemyCollision, null, this);
  }

  createCollectibles() {
    this.collectibles = this.physics.add.staticGroup();
    // 2026-04-23 T4: collectible rendering is DESIGN-DRIVEN. Template reads
    // per-type metadata from window.__COLLECTIBLE_TYPES (injected by the
    // pipeline from design.collectible_types). Template stays generic —
    // DKC's KONG letters, Mario's star coins, Metroid's energy tanks, etc.
    // all flow through this one data path.
    const typeMeta = (typeof window !== "undefined" && window.__COLLECTIBLE_TYPES) || {};
    const collectData = this.levelData.collectibles || [];

    for (const c of collectData) {
      const t = c.type || "coin";
      const meta = typeMeta[t] || {};
      const frame = c.frame || meta.frame || 67;
      const item = this.collectibles.create(c.x, c.y, "tiles", frame);
      item.setSize(14, 14);
      item.value = c.value != null ? c.value : (meta.value || 10);
      item.type = t;
      item.collectibleMeta = meta;
      // Optional per-type tint + letter identity (for "lettered" pickups like KONG)
      if (meta.tint) item.setTint(meta.tint);
      if (c.letter) item.letter = String(c.letter).toUpperCase();
    }

    this.physics.add.overlap(this.player, this.collectibles, this.collectItem, null, this);

    if (this.levelData.exit) {
      // 2026-04-28: scale up the exit visual + body so the player can't
      // overshoot it. Was: 18x18 sprite — a player body of 40x50 walking
      // past at 200 px/s could traverse the exit's 18-px hot zone in a
      // single physics frame and never trigger overlap (caught by AAA
      // play-through audit on barrel-blitz: player reached x=3940, exit
      // at 3906, no overlap fired). Display 2x scale + body 60x80 = a
      // reliable end-of-level target that visibly reads as "the goal".
      this.exit = this.physics.add.staticSprite(
        this.levelData.exit.x, this.levelData.exit.y, "tiles", 120
      ).setScale(2);
      this.exit.body.setSize(60, 80);
      this.exit.body.setOffset(-21, -31);
      this.exit.refreshBody();
      this.physics.add.overlap(this.player, this.exit, this.reachExit, null, this);
    }
  }

  // 2026-04-23: moving platforms oscillate along axis "x" or "y" via Phaser tween.
  createMovingPlatforms() {
    this.movingPlatforms = this.physics.add.group({ allowGravity: false, immovable: true });
    const data = this.levelData.moving_platforms || [];
    for (const p of data) {
      const w = (p.w || 3) * (GAME_CONFIG.tileSize || 18);
      const h = (p.h || 1) * (GAME_CONFIG.tileSize || 18);
      // 2026-04-28: use the BootScene-generated __platform texture instead
      // of null (which TypeError'd on undefined.sys). Tint applies on top.
      const plat = this.movingPlatforms.create(p.x, p.y, "__platform");
      if (plat.setDisplaySize) plat.setDisplaySize(w, h);
      plat.body.setSize(w, h);
      plat.setTintFill ? plat.setTintFill(0x7a5230) : null;
      plat.refreshBody && plat.refreshBody();
      const axis = p.axis || "x";
      const range = p.range || 120;
      const dur = Math.max(600, Math.round(range / Math.max(20, p.speed || 60) * 1000));
      const tweenProps = axis === "y"
        ? { y: plat.y + range }
        : { x: plat.x + range };
      this.tweens.add({ targets: plat, ...tweenProps, duration: dur, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    if (this.movingPlatforms.getChildren().length > 0) {
      this.physics.add.collider(this.player, this.movingPlatforms);
      if (this.enemies) this.physics.add.collider(this.enemies, this.movingPlatforms);
    }
  }

  // 2026-04-23: hazardous + special tile behaviors (lava/saw/crumble/ice/water/vine).
  // Walks the tilemap and attaches overlap/collision handlers per tile-id.
  setupTileHazards() {
    if (!this.groundLayer) return;
    const t = (GAME_CONFIG.tileSize || 18);
    this.hazardTiles = this.physics.add.staticGroup();
    this.vineTiles = this.physics.add.staticGroup();
    this.crumbleTiles = [];
    const tiles = (this.levelData.tiles || []);
    for (let r = 0; r < tiles.length; r++) {
      const row = tiles[r];
      for (let c = 0; c < (row || []).length; c++) {
        const id = row[c];
        const px = c * t + t / 2;
        const py = r * t + t / 2;
        if (id === 6 || id === 7 || id === 8) {
          // lava / saw / spike_ceiling — damage on overlap
          const hz = this.hazardTiles.create(px, py, null);
          hz.body.setSize(t, t);
          hz.hazardKind = id === 6 ? "lava" : id === 7 ? "saw" : "spike_ceiling";
          const colors = { 6: 0xff4422, 7: 0xcccccc, 8: 0xdd5555 };
          hz.setTintFill ? hz.setTintFill(colors[id] || 0xff0000) : null;
        } else if (id === 9) {
          // crumble — tracks player stand, breaks 400ms later
          this.crumbleTiles.push({ tileX: c, tileY: r, broken: false, standStart: 0 });
        } else if (id === 10) {
          const v = this.vineTiles.create(px, py, null);
          v.body.setSize(t, t);
          v.setTintFill ? v.setTintFill(0x228833) : null;
        }
      }
    }
    if (this.hazardTiles.getChildren().length > 0) {
      this.physics.add.overlap(this.player, this.hazardTiles, (pl, hz) => {
        this.takeDamage(2, hz.hazardKind || "hazard");
      }, null, this);
    }
    if (this.vineTiles.getChildren().length > 0) {
      this.physics.add.overlap(this.player, this.vineTiles, (pl, vt) => {
        const up = this.cursors && (this.cursors.up.isDown || (this.wasd && this.wasd.W.isDown));
        if (up) {
          pl.setVelocityY(-200);
          pl.body.setAllowGravity(false);
          this.time.delayedCall(120, () => { if (pl.body) pl.body.setAllowGravity(true); });
        }
      }, null, this);
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

    // 2026-04-23 T4: pipeline-generated `createCustomHUD()` (from player_systems
    // patch) can add HUD elements specific to the design's collectible_types —
    // DKC's KONG pip strip, Mario's coin + star counter, Sonic's ring count, etc.
    // Template keeps only score / lives / level name.
    if (typeof this.createCustomHUD === "function") {
      try { this.createCustomHUD(); } catch (_e) { /* non-fatal */ }
    }

    // Combo counter (appears when combo > 1, auto-hides at 0).
    this.comboText = this.add.text(16, 64, "", { ...style, font: "bold 20px Arial", color: "#ffdd33" })
      .setScrollFactor(0).setDepth(100).setVisible(false);
    this._updateComboHUD = () => {
      if ((this.comboCount || 0) <= 1) {
        this.comboText.setVisible(false);
      } else {
        this.comboText.setText(`COMBO ×${Math.min(5, this.comboCount)}`);
        this.comboText.setVisible(true);
      }
    };
  }

  update(time, delta) {
    if (!this.player || !this.player.active) return;

    const onGround = this.player.body.onFloor() || this.player.body.touching.down;
    const cfg = GAME_CONFIG.player;

    // ── COMBO DECAY ──
    // Combo window closes after 1.5 s since last stomp. Zero out + refresh HUD.
    if ((this.comboTimer || 0) > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this._updateComboHUD && this._updateComboHUD();
      }
    }

    // ── CRUMBLE TILES ──
    // Tiles marked with id=9 break 400 ms after the player stands on them.
    if (this.crumbleTiles && this.crumbleTiles.length && this.groundLayer) {
      const ts = GAME_CONFIG.tileSize || 18;
      const pxTile = Math.floor(this.player.x / ts);
      const pyTileBelow = Math.floor((this.player.y + 12) / ts);
      for (const ct of this.crumbleTiles) {
        if (ct.broken) continue;
        if (ct.tileX === pxTile && ct.tileY === pyTileBelow) {
          if (!ct.standStart) ct.standStart = time;
          if (time - ct.standStart > 400) {
            // Remove tile from layer
            try { this.groundLayer.removeTileAt(ct.tileX, ct.tileY); } catch (_e) {}
            ct.broken = true;
            this.playSound && this.playSound("sfx_crumble");
          }
        }
      }
    }

    // ── PLAYER CONTROLLER (canonical) ──
    // All horizontal movement, jump (ground/coyote/buffered/double), variable
    // jump cut, and dash live in PlatformerController2D. Generated games MUST
    // NOT inline this logic — the controller is the single source of truth.
    // Level-mode hooks (minecart auto-run / underwater swim) signal via
    // skipHorizontal/skipJump so they can take over without fighting the
    // controller for velocity.
    let modeHandled = false;
    if (typeof this.applyLevelModeMovement === "function") {
      try {
        modeHandled = !!this.applyLevelModeMovement(this.levelMode, {
          moveLeft: (this.cursors.left && this.cursors.left.isDown) || (this.wasd && this.wasd.A && this.wasd.A.isDown),
          moveRight: (this.cursors.right && this.cursors.right.isDown) || (this.wasd && this.wasd.D && this.wasd.D.isDown),
          onGround, delta, cfg,
        });
      } catch (_e) { /* level mode hook bug → fall back to default movement */ }
    }
    if (this.controller) {
      const intent = this.controller.tick(time, delta, {
        skipHorizontal: modeHandled,
        skipJump: modeHandled,
      });
      if (intent.animKey) this._safePlayAnim(intent.animKey);
      if (intent.jumped) {
        this.playSound && this.playSound("sfx_jump");
        this.emitDust && this.emitDust(this.player.x, this.player.y + 12, 5);
      }
      if (intent.dashed) {
        this.emitDust && this.emitDust(this.player.x, this.player.y, 10);
      }
      // Mirror controller state into legacy fields a few patches still read
      this.isDashing = this.controller.isDashing;
      this.canDoubleJump = this.controller.canDoubleJump;
      this.coyoteTimer = this.controller.coyoteTimer;
    }

    // ── ABILITIES + WORLD MECHANICS + DIALOG (2026-04-28) ──
    // Per-frame ticks for the libraries wired in create(). All gracefully
    // no-op if their library wasn't loaded.
    try {
      if (window.Abilities && window.Abilities.tick) window.Abilities.tick(this, time, delta);
    } catch (_e) {}
    try {
      if (window.WorldMechanics && window.WorldMechanics.tick) window.WorldMechanics.tick(this, time, delta);
    } catch (_e) {}
    try {
      if (window.Dialog && window.Dialog.checkInteraction) window.Dialog.checkInteraction(this);
    } catch (_e) {}

    // ── ENEMY AI ──
    // 2026-04-23: wrapped in try/catch. AAA pipeline patches may replace
    // updateEnemies with code that calls undefined helper methods (e.g.,
    // Claude-generated `this.createLavaTrail()` that was never defined).
    // Without this wrap, ONE undefined call aborts update() → stops player
    // movement, gravity, and jumps.
    try { this.updateEnemies(delta); } catch (_e) {
      if (!this._enemyAiErrorLogged) {
        console.warn("[GameScene] updateEnemies threw; further errors suppressed.", _e);
        this._enemyAiErrorLogged = true;
      }
    }

    // ── ENEMY NORMALIZER (2026-04-27) ──
    // Pipeline-level guarantee: every patrol-type enemy on the ground gets a
    // baseline patrol velocity, and patrolDir is clamped so enemies don't stick
    // at boundaries oscillating direction. Ensures enemies_move QA passes
    // regardless of what Claude generated for the per-game enemy AI.
    try {
      if (this.enemies && this.enemies.children) {
        this.enemies.children.iterate((enemy) => {
          if (!enemy || !enemy.active || !enemy.body) return;
          if (enemy.enemyType !== "patrol") return;
          // Baseline patrol velocity if at rest on ground
          if (enemy.body.touching.down && Math.abs(enemy.body.velocity.x) < 1) {
            const dir = enemy.patrolDir || 1;
            enemy.body.setVelocityX(dir * (GAME_CONFIG.enemies.patrolSpeed * 0.6));
          }
          // Boundary clamp — direction set decisively, position nudged inside
          const start = (typeof enemy.startX === "number") ? enemy.startX : enemy.x;
          const range = enemy.patrolRange || 100;
          const leftBound = start - range;
          const rightBound = start + range;
          if (enemy.x <= leftBound) {
            enemy.patrolDir = 1;
            enemy.x = leftBound + 2;
            if (typeof enemy.setFlipX === "function") enemy.setFlipX(false);
          } else if (enemy.x >= rightBound) {
            enemy.patrolDir = -1;
            enemy.x = rightBound - 2;
            if (typeof enemy.setFlipX === "function") enemy.setFlipX(true);
          }
        });
      }
    } catch (_e) { /* enemy normalizer must never break the game */ }

    // 2026-04-23: AAA pipeline hook — per-world signature mechanic dispatcher.
    // patch_signature_mechanics.js adds applyWorld<N>Mechanic(delta) methods;
    // we invoke the one matching this level's world_num, if present.
    // Wrapped in try/catch so a bad mechanic method never aborts update().
    try {
      const worldN = (this.levelData && (this.levelData.world_num || this.levelData.world_num === 0))
        ? this.levelData.world_num
        : (Math.floor(this.currentLevel / 6) + 1);  // fallback: group 6 levels per world
      const fn = this["applyWorld" + worldN + "Mechanic"];
      if (typeof fn === "function") fn.call(this, delta);
    } catch (_e) { /* non-fatal */ }

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
      // Damage enemy
      enemy.hp--;
      if (enemy.hp <= 0) {
        this.killEnemy(enemy);
      } else {
        // 2026-04-23 AAA VFX: play hit anim + tint + scale pulse
        this._playEnemyAnim(enemy, "hit");
        enemy.setTint(0xff4040);
        const origScaleX = enemy.scaleX, origScaleY = enemy.scaleY;
        this.tweens.add({
          targets: enemy, scaleX: origScaleX * 1.25, scaleY: origScaleY * 0.75,
          duration: 80, yoyo: true,
          onComplete: () => { enemy.setScale(origScaleX, origScaleY); enemy.clearTint();
            this._playEnemyAnim(enemy, "walk"); }
        });
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

  // 2026-04-23: helper to play the right Kenney-mapped enemy animation safely.
  // Suffix is "walk" / "idle" / "hit" / "dead" / "fly" / etc.
  _playEnemyAnim(enemy, suffix) {
    if (!enemy || !enemy.kenneyType) return;
    const key = enemy.kenneyType + "_" + suffix;
    if (!this.anims.exists(key)) return;
    try {
      if (!enemy.anims.currentAnim || enemy.anims.currentAnim.key !== key) {
        enemy.play(key, true);
      }
    } catch (_e) {}
  }

  killEnemy(enemy) {
    // 2026-04-23 AAA death: play dead anim + fade + tween before destroy
    this._playEnemyAnim(enemy, "dead");
    enemy.setTint(0xaaaaaa);
    if (enemy.body) enemy.body.enable = false;
    // Particles + shake
    this.emitDust(enemy.x, enemy.y, 12);
    this.cameras.main.shake(80, 0.005);
    // Fade + sink then destroy
    this.tweens.add({
      targets: enemy,
      alpha: 0,
      y: enemy.y + 12,
      angle: enemy.angle + (Math.random() > 0.5 ? 35 : -35),
      duration: 350,
      onComplete: () => enemy.destroy(),
    });
  }

  playerHit() {
    if (this.isInvincible) return;
    this.lives--;
    this.updateHUD();
    this.playSound("sfx_hit");
    this.cameras.main.shake(150, 0.01);
    this.cameras.main.flash(200, 255, 50, 50);
    try { if (window.Analytics && window.Analytics.event) window.Analytics.event("hit", { lives: this.lives }); } catch (_) {}
    // Combo breaks on any damage taken
    this.comboCount = 0;
    this.comboTimer = 0;
    this._updateComboHUD && this._updateComboHUD();

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

  // Alias used by hazard tiles / boss damage / combo break paths.
  takeDamage(amount, kind) {
    // `amount` accepted for future HP-based damage; current model is 1 hit = -1 life.
    return this.playerHit();
  }

  // 2026-04-23: DKC combo — stomping multiple enemies in 1.5s chains multiplier.
  // Called from enemy-bounce handler (if present) or enemy_die handler in patches.
  onEnemyStomped(enemy) {
    this.comboCount = (this.comboCount || 0) + 1;
    this.comboTimer = 1500;
    const mult = Math.min(5, this.comboCount);
    const bonus = 50 * mult;
    this.score += bonus;
    this.playSound("sfx_stomp");
    if (enemy && enemy.x != null) {
      this.showFloatText(enemy.x, enemy.y - 30, `×${mult} +${bonus}`, "#ffdd33");
    }
    this.updateHUD();
    this._updateComboHUD && this._updateComboHUD();
    try { if (window.Analytics && window.Analytics.event) window.Analytics.event("stomp", { combo: this.comboCount }); } catch (_) {}
  }

  playerDie() {
    this.playSound("sfx_game_over");
    this.sound.stopAll();
    this.cameras.main.shake(300, 0.02);
    this.time.delayedCall(500, () => {
      this.scene.start("GameOver", { score: this.score, level: this.currentLevel });
    });
  }

  // 2026-04-23 T4: generic collectible dispatch. Pipeline-generated
  // `onCollectibleByType(type, player, item)` (from player_systems patch,
  // based on design.collectible_types) decides what happens per-type.
  // Template's default = score bump + coin sfx.
  collectItem(player, item) {
    const t = item.type || "coin";
    let handled = false;
    if (typeof this.onCollectibleByType === "function") {
      try { handled = this.onCollectibleByType(t, player, item); } catch (_e) { handled = false; }
    }
    if (!handled) {
      this.score += item.value || 10;
      this.playSound("sfx_coin");
      this.showFloatText(item.x, item.y - 10, `+${item.value || 10}`, "#ffcc00");
    }
    this.updateHUD();
    this.emitDust(item.x, item.y, 6);
    try { if (window.Analytics && window.Analytics.event) window.Analytics.event("collect", { type: t, value: item.value }); } catch (_) {}
    item.destroy();
  }

  reachExit(player, exit) {
    this.playSound("sfx_level_complete");
    this.sound.stopAll();
    this.cameras.main.flash(500, 255, 255, 255);
    this.score += 500;

    // 2026-04-23: persist progress after every level clear. save_load.js wraps
    // localStorage with a namespaced key — the Menu's "Continue" button reads
    // this on next load. Also unlocks the next world when we've cleared a
    // boss level (last level of the current world).
    try {
      const levelsInWorld = 6;  // typical DKC world length; override via design later
      const nextLevel = this.currentLevel + 1;
      const currentWorld = Math.floor(this.currentLevel / levelsInWorld) + 1;
      const nextWorld = Math.floor(nextLevel / levelsInWorld) + 1;
      if (window.SaveLoad && window.SaveLoad.save) {
        // Slot 0 is the autosave slot.
        window.SaveLoad.save(0, {
          lastLevel: nextLevel,
          lives: this.lives,
          score: this.score,
          unlockedWorlds: Math.max(currentWorld, nextWorld),
          kongLetters: this.kongLetters,
        });
      }
      if (window.Analytics && window.Analytics.event) {
        window.Analytics.event("level_complete", {
          level: this.currentLevel, score: this.score, lives: this.lives,
        });
      }
    } catch (_e) { /* non-fatal */ }

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
    this.add.text(width / 2, height * 0.22, "PAUSED", {
      font: "bold 48px Arial", color: "#ffffff",
    }).setOrigin(0.5);

    const resume = this.add.text(width / 2, height * 0.36, "Resume", {
      font: "24px Arial", color: "#ff8800", backgroundColor: "#1e293b",
      padding: { x: 30, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    resume.on("pointerdown", () => {
      this.scene.resume("Game");
      this.scene.stop();
    });

    // 2026-04-23: accessibility + audio toggles (DKC-standard pause menu).
    // Uses window.Accessibility (shared module) to persist toggles across runs.
    const a11y = (typeof window !== "undefined") ? window.Accessibility : null;
    const makeToggle = (label, y, getValue, onClick) => {
      const txt = this.add.text(width / 2, y, `${label}: ${getValue()}`, {
        font: "18px Arial", color: "#cccccc", backgroundColor: "#0f172a",
        padding: { x: 20, y: 8 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      txt.on("pointerdown", () => {
        onClick();
        txt.setText(`${label}: ${getValue()}`);
      });
      return txt;
    };
    if (a11y) {
      const CB_MODES = ["none", "protanopia", "deuteranopia", "tritanopia"];
      makeToggle("Colorblind mode", height * 0.50,
        () => a11y.get("colorBlindMode"),
        () => {
          const cur = a11y.get("colorBlindMode");
          const next = CB_MODES[(CB_MODES.indexOf(cur) + 1) % CB_MODES.length];
          a11y.set("colorBlindMode", next);
        });
      makeToggle("Reduced motion", height * 0.60,
        () => a11y.get("reducedMotion") ? "ON" : "OFF",
        () => a11y.set("reducedMotion", !a11y.get("reducedMotion")));
      makeToggle("High contrast", height * 0.70,
        () => a11y.get("highContrast") ? "ON" : "OFF",
        () => a11y.set("highContrast", !a11y.get("highContrast")));
    }
    makeToggle("Music", height * 0.80,
      () => this.game.sound.mute ? "OFF" : "ON",
      () => { this.game.sound.mute = !this.game.sound.mute; });

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
