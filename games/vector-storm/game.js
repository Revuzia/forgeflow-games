/**
 * Vector Storm - A Geometry Wars: Retro Evolved Clone
 * Twin-stick arena shooter with neon vector graphics
 * Survive the geometry. Outlast the swarm.
 */

// ═══════════════════════════════════════════════════════════════
// GAME CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const GAME_CONFIG = {
  title: "Vector Storm",
  // 2026-05-05 — Bumped from 960×540 to 1280×720 (HD). 1.78× more game-world
  // area (player feels less cramped) AND sharper fullscreen since the canvas
  // is upscaled less in 1080p/1440p displays. All hardcoded center/edge
  // refs (480, 270, 952, 532, 1160, 740, 180, 60) updated proportionally.
  width: 1280,
  height: 720,
  audio: { musicVolume: 0.3, sfxVolume: 0.6 },
  levels: [],
  colors: {
    bg: "#080820",
    accent: "#00cc00",
    text: "#ffffff",
  },
};

// 2026-05-05 weapon overhaul — single source of truth for tier visuals + names.
// PIERCE (tier 4) was removed — single penetrating line was useless against
// wave 4 swarms. Tier 4 slot is intentionally empty so existing tier numbers
// for CHAIN (5) and ROCKET (6) stay stable. Tier 7+8 are the new endgame.
//   World 1 (waves 1-3):  tiers 1, 2, 3 (spreads)
//   World 2 (waves 4-6):  tiers 5, 6 (CHAIN LIGHTNING + ROCKET)
//   World 3 (waves 7-9):  tiers 7, 8 (BLACK HOLE + HOMING SWARM) — endgame.
const WEAPON_TIERS = {
  0: { name: 'BASE',            colorHex: 0x00ffff, cssColor: '#00ffff', innerHex: 0x008888, label: 'I',   minWave: 0 },
  1: { name: 'DOUBLE SHOT',     colorHex: 0xffff44, cssColor: '#ffff44', innerHex: 0xffaa00, label: 'II',  minWave: 1 },
  2: { name: 'TRIPLE SPREAD',   colorHex: 0xff44ff, cssColor: '#ff44ff', innerHex: 0xff88ff, label: 'III', minWave: 1 },
  3: { name: 'QUAD BURST',      colorHex: 0x44ddff, cssColor: '#44ddff', innerHex: 0x0088aa, label: 'IV',  minWave: 2 },
  // 4: PIERCE — removed
  5: { name: 'CHAIN LIGHTNING', colorHex: 0x88ff44, cssColor: '#88ff44', innerHex: 0x44aa00, label: 'CL',  minWave: 4 },
  6: { name: 'SHOCK WAVE',      colorHex: 0xffaa00, cssColor: '#ffaa00', innerHex: 0xffff66, label: 'SHK', minWave: 5 },
  7: { name: 'BLACK HOLE',      colorHex: 0x8844ff, cssColor: '#8844ff', innerHex: 0x441188, label: 'BH',  minWave: 7 },
  8: { name: 'HOMING SWARM',    colorHex: 0xff44aa, cssColor: '#ff44aa', innerHex: 0xaa2266, label: 'HS',  minWave: 7 },
};

const gameState = {
  currentScene: null,
  currentLevel: 0,
  score: 0,
  multiplier: 1,
  lives: 3,
  bombs: 3,
  player: null,
  enemies: [],
  bullets: [],
  particles: [],
  waveStartTime: 0,
  currentWave: 1,
  highScore: parseInt(localStorage.getItem('vectorStormHighScore') || '0'),
  // 2026-05-05 — Highest wave ever started in any prior run. Used to gate
  // the N-skip ability: you can only skip TO a wave you've reached before.
  // Saved on every wave start. Persists across sessions like high score.
  maxWaveReached: parseInt(localStorage.getItem('vectorStormMaxWave') || '1'),
  enemySpawnTimer: 0,
  gravityWells: []
};

// ─── Achievement tracker (calls forgeflow-sdk.js → portal → Supabase) ──
// Centralized so kill / wave / boss / bomb / score paths all funnel through
// one tiny module. Each slug is emitted at most once per page-load via the
// `emitted` Set; the server side is also idempotent (UNIQUE on user_id +
// achievement_id) so re-emits are harmless.
const VS_ACHIEVE = {
  emitted: new Set(),
  unlock(slug) {
    if (this.emitted.has(slug)) return;
    this.emitted.add(slug);
    if (window.ForgeFlow && window.ForgeFlow.unlockAchievement) {
      window.ForgeFlow.unlockAchievement(slug);
    }
  },
  // Called from kill block: enemy.points * gameState.multiplier already added.
  onKill() {
    this.unlock("first_kill");
    const m = gameState.multiplier;
    if (m >= 25)  this.unlock("multiplier_25");
    if (m >= 50)  this.unlock("multiplier_50");
    if (m >= 99)  this.unlock("multiplier_max");
    if (gameState.score >= 50000)  this.unlock("score_50k");
    if (gameState.score >= 100000) this.unlock("score_100k");
  },
  // Wave numbers are 1-indexed in gameState. Called when a wave begins.
  onWaveStart() {
    const w = gameState.currentWave;
    if (w >= 3) this.unlock("reach_wave_3");
    if (w >= 5) this.unlock("reach_wave_5");
    if (w >= 7) this.unlock("reach_wave_7");
    if (w >= 9) this.unlock("reach_wave_9");
    if (w > 9)  this.unlock("survive_all");
  },
  // World boundaries: World 1 = waves 1-3, World 2 = 4-6, World 3 = 7-9.
  // Boss appears at the END of each world (waves 3, 6, 9).
  onBossDefeat() {
    const w = gameState.currentWave;
    if (w <= 3)      this.unlock("boss_world1");
    else if (w <= 6) this.unlock("boss_world2");
    else             this.unlock("boss_world3");
  },
  onBomb() {
    this.unlock("first_bomb");
  },
};
window.VS_ACHIEVE = VS_ACHIEVE;

window.GAME_DESIGN = {"title": "Vector Storm", "tagline": "Survive the geometry. Outlast the swarm.", "genre": "simulation", "sub_genre": "twin-stick-arena-shooter", "controls": {"move": "WASD or left stick - 8-directional ship movement", "aim": "mouse cursor or right stick - independent firing direction", "fire": "left mouse / right trigger - continuous fire while held", "bomb": "space / left trigger - clears all enemies on screen, limited stock"}, "core_loop": ["Spawn waves of geometric enemies (snakes, diamonds, pinwheels, gravity wells)", "Player ship strafes around a single-screen arena while shooting", "Each kill increments the score multiplier (capped); dying resets multiplier", "Survive 60 seconds → wave clears, brief pause, next wave spawns harder", "Game over on running out of lives; high score persists in localStorage"], "enemies": [{"name": "Blue Square", "behavior": "drift toward player slowly", "hp": 1, "color": "0x4488ff"}, {"name": "Diamond", "behavior": "sine-wave oscillating chase", "hp": 1, "color": "0xff44ff"}, {"name": "Snake", "behavior": "follow leader segment", "hp": 1, "color": "0x44ff88"}, {"name": "Pinwheel", "behavior": "spawn 4 child shards on death", "hp": 2, "color": "0xffaa00"}, {"name": "Gravity Well", "behavior": "pull player + bullets toward center", "hp": 5, "color": "0xff0044"}], "player": {"starting_lives": 3, "starting_bombs": 3, "fire_rate_per_sec": 8, "bullet_speed": 600, "ship_speed": 280}, "scoring": {"kill_base": 25, "multiplier_increment_per_kill": 1, "multiplier_cap": 99, "death_resets_multiplier": true}, "art_direction": "Neon vector graphics on near-black background. Bloom glow on every sprite. Particle trails. Bullets are bright cyan lines. Enemies are pure-color geometric shapes drawn with Phaser.Graphics (NOT sprites - vector primitives).", "audio_direction": "Pumping electronic beat (loop). Distinct enemy-spawn synth zaps. Satisfying bass kick on every kill. Multiplier tick rises in pitch as multiplier climbs.", "iconic_moments": ["Wave-clear screen-shake + bloom flash", "Multiplier number swelling 2x scale on kill", "Bomb explosion: white flash + radial wave", "First gravity well of the run pulls the camera"], "victory_condition": "Survive 5 minutes (5 waves × 60s)", "loss_condition": "lives reach 0", "level_count": 5, "boss_count": 1, "worlds": [{"name": "Wave 1", "color_palette": ["#080820", "#00cc00"], "boss": null}, {"name": "Wave 2", "color_palette": ["#080820", "#00aaff"], "boss": null}, {"name": "Wave 3", "color_palette": ["#080820", "#00ff00"], "boss": null}, {"name": "Wave 4", "color_palette": ["#080820", "#0088ff"], "boss": null}, {"name": "Wave 5", "color_palette": ["#080820", "#004400"], "boss": {"name": "Gravity Well"}}], "collectible_types": [{"name": "extra_life", "frame": 0}, {"name": "extra_bomb", "frame": 1}, {"name": "speed_boost", "frame": 2}]};
window.__TEST__ = window.__TEST__ || {};
window.__TEST__.getGameConfig = () => ({ ...GAME_CONFIG });
window.__TEST__.getGameState = () => ({ ...gameState });
window.__TEST__.getCurrentScene = () => gameState.currentScene || "Boot";
window.__TEST__.getCurrentLevel = () => gameState.currentWave - 1;
window.__TEST__.getScore = () => gameState.score;
window.__TEST__.getLives = () => gameState.lives;
window.__TEST__.getMultiplier = () => gameState.multiplier;
window.__TEST__.getPlayer = () => {
  if (!gameState.player) return null;
  return { x: gameState.player.x, y: gameState.player.y, alive: gameState.player.active };
};
window.__TEST__.getEnemies = () => {
  return gameState.enemies.filter(e => e && e.active).map(e => ({
    x: e.x,
    y: e.y,
    alive: e.active
  }));
};

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function createNeonGraphics(scene, x, y, drawFunc, color = 0x00ffff, scale = 1) {
  const graphics = scene.add.graphics();
  graphics.x = x;
  graphics.y = y;
  graphics.lineStyle(2, color, 1);
  drawFunc(graphics);
  graphics.setScale(scale);
  
  // Add glow effect
  const glow = scene.add.graphics();
  glow.x = x;
  glow.y = y;
  glow.lineStyle(6, color, 0.3);
  drawFunc(glow);
  glow.setScale(scale);
  graphics.glow = glow;
  
  return graphics;
}

function angleToTarget(source, target) {
  return Math.atan2(target.y - source.y, target.x - source.x);
}

function distanceBetween(a, b) {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

// ═══════════════════════════════════════════════════════════════
// SCENES
// ═══════════════════════════════════════════════════════════════

// ── ENEMY ANIM CONFIG (injected by mechanical.integrate) ──
window.__ENEMY_ANIM_CONFIG = {
  "atlas_key": "enemies_atlas",
  "atlas_png": "enemies.png",
  "atlas_xml": "enemies.xml",
  "by_name": {
    "Blue Square": {
      "kenney_type": "slime_normal",
      "base_frame": "slime_normal_rest"
    },
    "Diamond": {
      "kenney_type": "slime_normal",
      "base_frame": "slime_normal_rest"
    },
    "Snake": {
      "kenney_type": "worm_normal",
      "base_frame": "worm_normal_rest"
    },
    "Pinwheel": {
      "kenney_type": "slime_normal",
      "base_frame": "slime_normal_rest"
    },
    "Gravity Well": {
      "kenney_type": "slime_normal",
      "base_frame": "slime_normal_rest"
    }
  },
  "animations": [
    {
      "key": "slime_normal_idle",
      "frames": [
        "slime_normal_rest",
        "slime_normal_rest"
      ],
      "frameRate": 3,
      "repeat": -1
    },
    {
      "key": "slime_normal_walk",
      "frames": [
        "slime_normal_walk_a",
        "slime_normal_walk_b",
        "slime_normal_walk_a",
        "slime_normal_walk_b"
      ],
      "frameRate": 10,
      "repeat": -1
    },
    {
      "key": "slime_normal_squash",
      "frames": [
        "slime_normal_flat",
        "slime_normal_flat"
      ],
      "frameRate": 6,
      "repeat": 0
    },
    {
      "key": "slime_normal_hit",
      "frames": [
        "slime_normal_rest",
        "slime_normal_rest"
      ],
      "frameRate": 10,
      "repeat": 0
    },
    {
      "key": "slime_normal_dead",
      "frames": [
        "slime_normal_flat",
        "slime_normal_flat"
      ],
      "frameRate": 6,
      "repeat": 0
    },
    {
      "key": "worm_normal_idle",
      "frames": [
        "worm_normal_rest",
        "worm_normal_rest"
      ],
      "frameRate": 3,
      "repeat": -1
    },
    {
      "key": "worm_normal_walk",
      "frames": [
        "worm_normal_move_a",
        "worm_normal_move_b",
        "worm_normal_move_a",
        "worm_normal_move_b"
      ],
      "frameRate": 10,
      "repeat": -1
    },
    {
      "key": "worm_normal_hit",
      "frames": [
        "worm_normal_rest",
        "worm_normal_rest"
      ],
      "frameRate": 10,
      "repeat": 0
    },
    {
      "key": "worm_normal_dead",
      "frames": [
        "worm_normal_rest",
        "worm_normal_rest"
      ],
      "frameRate": 6,
      "repeat": 0
    }
  ],
  "animation_registrations_js": "        if (!this.anims.exists(\"slime_normal_idle\")) {\n          this.anims.create({ key: \"slime_normal_idle\", frames: [\n            { key: \"enemies_atlas\", frame: \"slime_normal_rest\" },\n          { key: \"enemies_atlas\", frame: \"slime_normal_rest\" }\n          ], frameRate: 3, repeat: -1 });\n        }\n        if (!this.anims.exists(\"slime_normal_walk\")) {\n          this.anims.create({ key: \"slime_normal_walk\", frames: [\n            { key: \"enemies_atlas\", frame: \"slime_normal_walk_a\" },\n          { key: \"enemies_atlas\", frame: \"slime_normal_walk_b\" },\n          { key: \"enemies_atlas\", frame: \"slime_normal_walk_a\" },\n          { key: \"enemies_atlas\", frame: \"slime_normal_walk_b\" }\n          ], frameRate: 10, repeat: -1 });\n        }\n        if (!this.anims.exists(\"slime_normal_squash\")) {\n          this.anims.create({ key: \"slime_normal_squash\", frames: [\n            { key: \"enemies_atlas\", frame: \"slime_normal_flat\" },\n          { key: \"enemies_atlas\", frame: \"slime_normal_flat\" }\n          ], frameRate: 6, repeat: 0 });\n        }\n        if (!this.anims.exists(\"slime_normal_hit\")) {\n          this.anims.create({ key: \"slime_normal_hit\", frames: [\n            { key: \"enemies_atlas\", frame: \"slime_normal_rest\" },\n          { key: \"enemies_atlas\", frame: \"slime_normal_rest\" }\n          ], frameRate: 10, repeat: 0 });\n        }\n        if (!this.anims.exists(\"slime_normal_dead\")) {\n          this.anims.create({ key: \"slime_normal_dead\", frames: [\n            { key: \"enemies_atlas\", frame: \"slime_normal_flat\" },\n          { key: \"enemies_atlas\", frame: \"slime_normal_flat\" }\n          ], frameRate: 6, repeat: 0 });\n        }\n        if (!this.anims.exists(\"worm_normal_idle\")) {\n          this.anims.create({ key: \"worm_normal_idle\", frames: [\n            { key: \"enemies_atlas\", frame: \"worm_normal_rest\" },\n          { key: \"enemies_atlas\", frame: \"worm_normal_rest\" }\n          ], frameRate: 3, repeat: -1 });\n        }\n        if (!this.anims.exists(\"worm_normal_walk\")) {\n          this.anims.create({ key: \"worm_normal_walk\", frames: [\n            { key: \"enemies_atlas\", frame: \"worm_normal_move_a\" },\n          { key: \"enemies_atlas\", frame: \"worm_normal_move_b\" },\n          { key: \"enemies_atlas\", frame: \"worm_normal_move_a\" },\n          { key: \"enemies_atlas\", frame: \"worm_normal_move_b\" }\n          ], frameRate: 10, repeat: -1 });\n        }\n        if (!this.anims.exists(\"worm_normal_hit\")) {\n          this.anims.create({ key: \"worm_normal_hit\", frames: [\n            { key: \"enemies_atlas\", frame: \"worm_normal_rest\" },\n          { key: \"enemies_atlas\", frame: \"worm_normal_rest\" }\n          ], frameRate: 10, repeat: 0 });\n        }\n        if (!this.anims.exists(\"worm_normal_dead\")) {\n          this.anims.create({ key: \"worm_normal_dead\", frames: [\n            { key: \"enemies_atlas\", frame: \"worm_normal_rest\" },\n          { key: \"enemies_atlas\", frame: \"worm_normal_rest\" }\n          ], frameRate: 6, repeat: 0 });\n        }",
  "enemy_kenney_map_js": "const ENEMY_KENNEY_MAP = {\n    \"Blue Square\": \"slime_normal\",\n    \"Diamond\": \"slime_normal\",\n    \"Snake\": \"worm_normal\",\n    \"Pinwheel\": \"slime_normal\",\n    \"Gravity Well\": \"slime_normal\"\n  };"
};

// ── COLLECTIBLE TYPES (injected by mechanical.integrate) ──
window.__COLLECTIBLE_TYPES = {
  "extra_life": {
    "label": "extra_life",
    "effect": "score",
    "rarity": "common",
    "frame": 0,
    "tint": null,
    "value": 10,
    "sfx": "sfx_coin"
  },
  "extra_bomb": {
    "label": "extra_bomb",
    "effect": "score",
    "rarity": "common",
    "frame": 1,
    "tint": null,
    "value": 10,
    "sfx": "sfx_coin"
  },
  "speed_boost": {
    "label": "speed_boost",
    "effect": "score",
    "rarity": "common",
    "frame": 2,
    "tint": null,
    "value": 10,
    "sfx": "sfx_coin"
  }
};

class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }
  create() { 
    gameState.currentScene = "Boot";
    this.scene.start("Preload"); 
  }
}

class PreloadScene extends Phaser.Scene {
  constructor() { super("Preload"); }
  
  preload() {
    // Load audio
    // 2026-05-05 — 3-world music progression. Each world has distinct mood;
    // boss fights use a dedicated dark-ambient track. All Stability AI generated.
    //   World 1 (waves 1-3):  synthwave, "floating through space clouds"
    //   World 2 (waves 4-6):  glitchy IDM, "reality-bending quantum mechanics"
    //   World 3 (waves 7-9):  industrial techno, "abandoned space cemetery"
    //   Boss fights:          dark ambient drone, "low-frequency cosmic rumbles"
    this.load.audio('music_world1', 'assets/audio/music_world1.mp3');
    this.load.audio('music_world2', 'assets/audio/music_world2.mp3');
    this.load.audio('music_world3', 'assets/audio/music_world3.mp3');
    this.load.audio('music_boss',   'assets/audio/music_boss.mp3');
    this.load.audio('music_menu',   'assets/audio/music_menu.mp3');
    this.load.audio('sfx_place', 'assets/audio/sfx_place.ogg');
    this.load.audio('sfx_demolish', 'assets/audio/sfx_demolish.ogg');
    this.load.audio('sfx_complete', 'assets/audio/sfx_complete.ogg');
    this.load.audio('sfx_disaster', 'assets/audio/sfx_disaster.ogg');
    this.load.audio('sfx_levelup', 'assets/audio/sfx_levelup.ogg');
  }
  
  create() { 
    gameState.currentScene = "Preload";
    this.scene.start("Menu"); 
  }
}

class MenuScene extends Phaser.Scene {
  constructor() { super("Menu"); }
  
  create() {
    gameState.currentScene = "Menu";
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#080820');
    // 2026-05-05 — Explicitly re-enable input on every scene entry. After
    // returning from GameOver→Menu, Phaser sometimes leaves input.enabled=false
    // depending on transition timing. Belt-and-suspenders.
    this.input.enabled = true;
    if (this.input.keyboard) this.input.keyboard.enabled = true;
    
    // Title with neon effect
    const title = this.add.text(width / 2, height * 0.3, GAME_CONFIG.title, {
      font: "bold 48px Arial",
      color: "#00ffff",
      stroke: '#00ffff',
      strokeThickness: 2
    }).setOrigin(0.5);
    title.setShadow(0, 0, '#00ffff', 20);
    
    // Tagline
    this.add.text(width / 2, height * 0.4, "Survive the geometry. Outlast the swarm.", {
      font: "20px Arial",
      color: "#88ddff"
    }).setOrigin(0.5);
    
    // High score
    this.add.text(width / 2, height * 0.5, `High Score: ${gameState.highScore}`, {
      font: "18px Arial",
      color: "#ffaa00"
    }).setOrigin(0.5);

    // Max wave reached — gates the N-skip ability
    this.add.text(width / 2, height * 0.575, `Max Wave Reached: ${gameState.maxWaveReached}`, {
      font: "16px Arial",
      color: "#88ddff"
    }).setOrigin(0.5);

    // Reset save button — wipes high score + max wave
    const resetBtn = this.add.text(width - 16, height - 16, "Reset Save", {
      font: "12px Arial",
      color: "#888888",
    }).setOrigin(1, 1).setInteractive({ useHandCursor: true });
    resetBtn.on('pointerover', () => resetBtn.setColor('#ff6644'));
    resetBtn.on('pointerout', () => resetBtn.setColor('#888888'));
    resetBtn.on('pointerdown', () => {
      localStorage.removeItem('vectorStormHighScore');
      localStorage.removeItem('vectorStormMaxWave');
      gameState.highScore = 0;
      gameState.maxWaveReached = 1;
      this.scene.restart();
    });

    // 2026-05-05 (3rd rewrite) — User reports START still broken after
    // GameOver→Menu re-entry. Stripping ALL custom DOM/scene-level handlers
    // because they capture closures over scene state and can ghost across
    // re-entries. Now using ONE canonical Phaser pattern: Rectangle with
    // setInteractive(). Phaser's input plugin handles re-entry correctly
    // when this.input.enabled is set (above) and a fresh interactive object
    // is registered on every create().
    const _startGame = () => this.scene.start('Game', { level: 0 });
    const sbW = 240, sbH = 56, sbX = width / 2, sbY = height * 0.7;
    const startRect = this.add.rectangle(sbX, sbY, sbW, sbH, 0x00aa44, 0.85)
      .setStrokeStyle(2, 0x00ff66, 1)
      .setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-sbW / 2, -sbH / 2, sbW, sbH),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
    startRect.on('pointerover', () => startRect.setFillStyle(0x00ff66, 1));
    startRect.on('pointerout',  () => startRect.setFillStyle(0x00aa44, 0.85));
    startRect.on('pointerdown', _startGame);
    this.add.text(sbX, sbY, 'START GAME', {
      font: 'bold 24px Arial', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);

    // Keyboard fallback — works regardless of mouse-input weirdness
    this.input.keyboard.on('keydown-ENTER', _startGame);
    this.input.keyboard.on('keydown-SPACE', _startGame);
    
    // Controls info
    this.add.text(width / 2, height * 0.85, "WASD: Move • Mouse: Aim • Click: Fire • Space: Bomb • P: Pause • N: Next Wave • F: Fullscreen", {
      font: "14px Arial",
      color: "#668899"
    }).setOrigin(0.5);

    // 2026-05-05 — Fullscreen toggle (also bound to F key everywhere).
    const fsBtn = this.add.text(16, 16, '⛶  Fullscreen', {
      font: '14px Arial', color: '#88ddff',
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    fsBtn.on('pointerover', () => fsBtn.setColor('#ffffff'));
    fsBtn.on('pointerout',  () => fsBtn.setColor('#88ddff'));
    fsBtn.on('pointerdown', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });
    this.input.keyboard.on('keydown-F', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });
  }
}

class GameScene extends Phaser.Scene {
  constructor() { super("Game"); }
  
  init(data) {
    // 2026-05-06 — Comprehensive run-state reset. A "new game" must start
    // from a CLEAN slate — no carryover from the previous run, period.
    // Stop whack-a-moling individual fields. We:
    //   1. Reset every gameState.* run-scope field (module-global).
    //   2. Force-restore physics.world.timeScale (hit-stop slow-mo bug).
    //   3. Wipe every `this._*` and `this.*` instance prop that persists
    //      across scene.start (Phaser re-uses the GameScene instance).
    //   4. Null all Phaser group/collider/overlap refs so create() can
    //      re-instantiate them and re-register interactions cleanly.
    // Anything not in this list is effectively a bug: if a future feature
    // adds new run-scope state, it MUST be added here.
    gameState.currentScene = "Game";
    gameState.currentLevel = (data && typeof data.level === "number") ? data.level : 0;
    gameState.score = 0;
    gameState.multiplier = 1;
    gameState.lives = 3;
    gameState.bombs = 3;
    gameState.currentWave = 1;
    gameState.enemies = [];
    gameState.bullets = [];
    gameState.gravityWells = [];
    gameState.player = null;
    gameState.particles = [];
    // 2026-05-06 — initialize waveStartTime to "right now" instead of 0.
    // If left at 0, update() reads `time - 0 = current_time_since_boot`
    // (already huge), and the `waveElapsed >= waveTimer` check fires on
    // the very first update tick → currentWave bumps to 2 before the
    // player even sees wave 1. Same reasoning for waveTimer + nextSpawnTime
    // below in the per-run flags block. create() will overwrite these
    // with proper values; init's job is just to make sure no degenerate
    // value can cause a spurious wave-advance during the brief window
    // between init and create.
    gameState.waveStartTime = this.time && this.time.now ? this.time.now : 0;
    gameState.enemySpawnTimer = 0;

    // ── physics: undo any lingering hit-stop slow-mo ──
    if (this.physics && this.physics.world) {
      this.physics.world.timeScale = 1;
    }

    // ── Per-run flags / counters ──
    this._gameOverFired = false;
    this._hitStopActive = false;
    this._bossDeathPending = false;
    this._isBossClearAdvance = false;
    this._scorePopups = [];
    this._activeChainBolts = 0;
    this.paused = false;
    this.bossActive = false;
    this.boss = null;
    this.bossId = 0;
    this.waveSkipped = false;
    this._skipRequested = false;
    this.isInvincible = false;
    this.invincibleUntil = 0;
    this.weaponTier = 0;
    this.weaponTierExpiresAt = 0;
    this.weaponStacks = 0;
    // Same rationale as gameState.waveStartTime above — set to safe-far-
    // future / proper-default values, NEVER 0, so update()'s wave-elapsed
    // check can't misfire between init and create.
    this.nextSpawnTime = (this.time && this.time.now ? this.time.now : 0) + 1000;
    this.waveTimer = 60000;
    this.lastFireTime = 0;
    this._sceneCreatedAt = 0;
    this.damageRings = [];
    // 2026-05-06 — Wide-laser boss attack (Prism Core wave 9). Each beam:
    // { gfx, telegraphGfx, x, y, angle, width, length, telegraphUntil,
    //   firingUntil, hit:false }. Telegraph phase shows a thin warning
    // line; firing phase widens to a damaging beam. update() checks
    // overlap with player using rotated-rect math.
    this.bossBeams = [];

    // ── Phaser groups + overlap/collider refs ──
    // Null EVERY group/collider ref so the destroyed previous-run handles
    // can't be reused. create() recreates the groups; lazy-create code
    // for overlap colliders gates on these being null before re-binding.
    this.weaponPickups = null;
    this.bulletGroup = null;
    this.enemyGroup = null;
    this._weaponPickupOverlap = null;
    this._hazardOverlapWired = false;

    // ── HUD/Text refs from previous run (Phaser auto-destroys these on
    // scene shutdown, but explicit null prevents accidental reads of
    // dead refs in update()). ──
    this.scoreText = null;
    this.multiplierText = null;
    this.livesText = null;
    this.bombsText = null;
    this.waveText = null;
    this.weaponHUDText = null;
    this.bossHpBg = null;
    this.bossHpBar = null;
    this.bossNameText = null;

    // ── Audio that may have started in the previous run ──
    if (this.bgMusic && this.bgMusic.stop) {
      try { this.bgMusic.stop(); } catch (_e) {}
    }
    this.bgMusic = null;
  }
  // 2026-05-06 — Phaser auto-destroys scene-scoped tweens/timers on
  // shutdown, but we explicitly cancel them too because some tween
  // onComplete callbacks reference module-global gameState (which would
  // otherwise log errors after scene exit). Phaser calls shutdown()
  // automatically on scene.start.
  shutdown() {
    try {
      if (this.tweens) this.tweens.killAll();
      if (this.time) this.time.removeAllEvents();
      if (this.physics && this.physics.world) this.physics.world.timeScale = 1;
      if (this.bgMusic && this.bgMusic.stop) this.bgMusic.stop();
    } catch (_e) {}
  }
  
  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#080820');

    // 2026-05-05 GAME-FEEL: bloom post-fx makes neon vector games feel LIT
    // instead of flat. Single line, dramatic visual upgrade. Phaser 3.60+
    // ships built-in postFX bloom (no shader code required).
    try {
      this.cameras.main.postFX.addBloom(0xffffff, 1, 1, 1, 1.4, 4);
    } catch (e) { /* bloom unavailable in older Phaser — degrade gracefully */ }

    // Generate a 1x1 transparent texture once — used by physics-only sprites
    // (player/enemies/bullets) that draw their visuals via separate Phaser
    // Graphics. Without this, `physics.add.sprite(x,y,null)` makes Phaser
    // render a default green/purple debug box for the missing-texture sprite,
    // which sits BEHIND the graphics — produces the "every shape has a green
    // box around it" visual the user reported.
    if (!this.textures.exists('_invisible')) {
      const tx = this.textures.createCanvas('_invisible', 1, 1);
      tx.refresh();
    }

    // 2026-05-05 PERF — Pre-bake bullet textures ONCE per tier. Previously
    // every bullet allocated a Phaser Graphics object (separate GameObject in
    // the display list, separate draw call, no batching). With QUAD x5 stacks
    // firing 14 bullets per click at 8/sec, the renderer was managing 150+
    // independent Graphics nodes and tessellating geometry each frame — that's
    // the freeze the user reported. Now bullets use `physics.add.image()` with
    // these pre-baked textures, which Phaser batches into a single draw call.
    this._bakeBulletTextures();

    // Grid background
    this.createGrid();

    // Create player ship
    this.createPlayer();

    // Create enemy groups
    this.enemyGroup = this.physics.add.group();
    this.bulletGroup = this.physics.add.group();
    
    // Particle emitters
    this.createParticleEmitters();
    
    // Input
    this.cursors = this.input.keyboard.addKeys({
      w: Phaser.Input.Keyboard.KeyCodes.W,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      p: Phaser.Input.Keyboard.KeyCodes.P,
      n: Phaser.Input.Keyboard.KeyCodes.N
    });

    // Pause toggle (P key)
    this.cursors.p.on('down', () => this._togglePause());
    this.paused = false;

    // 2026-05-05 — Fullscreen toggle (F key) — same as menu.
    this.input.keyboard.on('keydown-F', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });

    // Fire control
    this.input.on('pointerdown', () => { this.firing = true; });
    this.input.on('pointerup', () => { this.firing = false; });
    this.firing = false;
    this.lastFireTime = 0;
    this.fireRate = 125; // 8 shots per second (base)
    // 2026-05-05 weapon overhaul — 5 distinct tiers + stack bonus.
    // Tier 0 = base (cyan). Tier 1 = DOUBLE (yellow). Tier 2 = TRIPLE (magenta).
    // Tier 3 = QUAD (cyan-bright). Tier 4 = PIERCE (orange, bullets penetrate).
    // Tier 5 = RAPID (lime, fireRate halved).
    // Stacking the SAME tier extends duration by +6s and grants +1 stack bonus
    // (extra bullet on the spread, +50% damage, +score bonus).
    this.weaponTier = 0;
    this.weaponTierExpiresAt = 0;
    this.weaponStacks = 0;  // bonus stacks from duplicate pickups
    this.baseFireRate = 125;
    
    // Enemy projectiles (separate group — must hit player, not other enemies)
    this.enemyBullets = this.physics.add.group();
    this.damageRings = []; // expanding rings from waver / boss

    // Collisions
    this.physics.add.overlap(this.bulletGroup, this.enemyGroup, this.bulletHitEnemy, null, this);
    this.physics.add.overlap(gameState.player, this.enemyGroup, this.playerHitEnemy, null, this);
    this.physics.add.overlap(gameState.player, this.enemyBullets, this.playerHitEnemyBullet, null, this);
    
    // HUD
    this.createHUD();
    
    // Wave management
    gameState.waveStartTime = this.time.now;
    this.waveTimer = 60000; // 60 seconds per wave
    this.nextSpawnTime = this.time.now + 1000;
    this.spawnDelay = 2000;
    
    // Audio
    // 2026-05-05 — World music starts at world 1 (waves 1-3 = synthwave).
    // _switchMusic crossfades to next world track on world transition.
    this._currentMusicKey = null;
    this._switchMusic('music_world1');
    
    // Sound pool for kills
    this.killSounds = [];
    for (let i = 0; i < 5; i++) {
      this.killSounds.push(this.sound.add('sfx_place', { volume: 0.4 }));
    }
    this.killSoundIndex = 0;
    // Stamp scene-creation time so _advanceWave's anti-bump guard can
    // reject stale wave-elapsed checks fired during the boot window.
    this._sceneCreatedAt = this.time.now;
  }

  createGrid() {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x112244, 0.3);
    
    // Vertical lines
    for (let x = 0; x < this.cameras.main.width; x += 40) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, this.cameras.main.height);
    }
    
    // Horizontal lines
    for (let y = 0; y < this.cameras.main.height; y += 40) {
      graphics.moveTo(0, y);
      graphics.lineTo(this.cameras.main.width, y);
    }
    
    graphics.strokePath();
  }
  
  createPlayer() {
    const { width, height } = this.cameras.main;
    
    gameState.player = this.physics.add.sprite(width / 2, height / 2, '_invisible');
    gameState.player.setSize(20, 20);
    
    // Draw ship as vector graphics
    const shipGraphics = this.add.graphics();
    shipGraphics.lineStyle(2, 0x00ffff, 1);
    shipGraphics.strokePoints([
      { x: -10, y: -10 },
      { x: 15, y: 0 },
      { x: -10, y: 10 },
      { x: -5, y: 0 },
      { x: -10, y: -10 }
    ], true);
    
    gameState.player.shipGraphics = shipGraphics;
    gameState.player.setCollideWorldBounds(true);
    gameState.player.alive = true;
    gameState.player.invulnerable = false;
    gameState.player.speed = 280;
  }
  
  createParticleEmitters() {
    // Create custom particle graphics
    const particleGraphics = this.make.graphics({ x: 0, y: 0 }, false);
    particleGraphics.lineStyle(1, 0xffffff);
    particleGraphics.strokeRect(0, 0, 2, 2);
    particleGraphics.generateTexture('particle', 4, 4);
    
    this.explosionEmitter = this.add.particles(0, 0, 'particle', {
      speed: { min: 100, max: 300 },
      scale: { start: 1, end: 0 },
      blendMode: 'ADD',
      lifespan: 500,
      quantity: 20
    });
    this.explosionEmitter.stop();
  }
  
  createHUD() {
    const { width, height } = this.cameras.main;
    
    // Score
    this.scoreText = this.add.text(20, 20, 'Score: 0', {
      font: '20px Arial',
      color: '#ffffff'
    });
    
    // Multiplier
    this.multiplierText = this.add.text(20, 50, 'x1', {
      font: 'bold 24px Arial',
      color: '#ffaa00'
    });
    
    // Lives
    this.livesText = this.add.text(20, height - 50, 'Lives: 3', {
      font: '18px Arial',
      color: '#00ff00'
    });
    
    // Bombs
    this.bombsText = this.add.text(20, height - 80, 'Bombs: 3', {
      font: '18px Arial',
      color: '#00aaff'
    });
    
    // Wave timer
    this.waveText = this.add.text(width / 2, 30, 'Wave 1 - 60s', {
      font: '16px Arial',
      color: '#888888'
    }).setOrigin(0.5);

    // 2026-05-05 — Active weapon HUD (top-right). Shows tier name + stack count
    // + remaining duration bar so the player knows what they have & for how long.
    this.weaponText = this.add.text(width - 20, 20, '', {
      font: 'bold 18px Arial',
      color: '#00ffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(50);
    this.weaponBarBg = this.add.graphics().setDepth(50);
    this.weaponBar = this.add.graphics().setDepth(51);
  }
  
  spawnEnemy(type) {
    const { width, height } = this.cameras.main;
    let enemy;
    let x, y;
    
    // Spawn from edges
    if (Math.random() < 0.5) {
      x = Math.random() < 0.5 ? 0 : width;
      y = Math.random() * height;
    } else {
      x = Math.random() * width;
      y = Math.random() < 0.5 ? 0 : height;
    }
    
    enemy = this.physics.add.sprite(x, y, '_invisible');
    enemy.enemyType = type;
    
    switch(type) {
      case 'blue_square':
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.strokeRect(-10, -10, 20, 20);
        }, 0x4488ff);
        enemy.speed = 60;
        enemy.hp = 1;
        enemy.points = 25;
        break;
        
      case 'diamond':
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.strokePoints([
            { x: 0, y: -12 },
            { x: 12, y: 0 },
            { x: 0, y: 12 },
            { x: -12, y: 0 }
          ], true);
        }, 0xff44ff);
        enemy.speed = 80;
        enemy.hp = 1;
        enemy.points = 50;
        enemy.oscillate = 0;
        break;
        
      case 'snake':
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.strokeCircle(0, 0, 8);
        }, 0x44ff88);
        enemy.speed = 100;
        enemy.hp = 1;
        enemy.points = 75;
        enemy.segments = [];
        // Create tail segments
        for (let i = 0; i < 5; i++) {
          const segment = this.add.graphics();
          segment.lineStyle(2, 0x44ff88, 1 - i * 0.15);
          segment.strokeCircle(0, 0, 8 - i);
          segment.x = x;
          segment.y = y;
          enemy.segments.push(segment);
        }
        break;
        
      case 'pinwheel':
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          for (let i = 0; i < 4; i++) {
            g.save();
            g.rotate(i * Math.PI / 2);
            g.moveTo(0, 0);
            g.lineTo(15, 5);
            g.lineTo(15, -5);
            g.closePath();
            g.strokePath();
            g.restore();
          }
        }, 0xffaa00);
        enemy.speed = 70;
        enemy.hp = 2;
        enemy.points = 100;
        enemy.rotation = 0;
        break;
        
      case 'gravity_well':
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          for (let i = 0; i < 3; i++) {
            g.strokeCircle(0, 0, 10 + i * 8);
          }
        }, 0xff0044);
        enemy.speed = 30;
        enemy.hp = 5;
        enemy.points = 200;
        enemy.pullRadius = 150;
        enemy.pullStrength = 100;
        gameState.gravityWells.push(enemy);
        break;

      case 'shooter':
        // SHOOTER — slow circle with a "barrel" line. Fires red bullets at
        // player every 1.8s. Stays at 200-300px range, doesn't chase aggressively.
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.strokeCircle(0, 0, 10);
          g.lineStyle(2, 0xff4444, 1);
          g.lineBetween(0, 0, 14, 0);  // barrel
        }, 0xff8844);
        enemy.speed = 40;
        enemy.hp = 2;
        enemy.points = 150;
        enemy.lastShot = this.time.now + 1500; // first shot 1.5s after spawn
        enemy.shootCooldown = Math.max(900, 1900 - gameState.currentWave * 100);
        enemy.preferredDistance = 250;
        break;

      case 'spinner':
        // SPINNER — fast triangle that crosses the screen in a straight line at
        // very high speed, spinning rapidly. Player must dodge its path.
        // Locks direction at spawn; doesn't chase — pure projectile-like.
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(3, 0xff44ff, 1);
          g.strokePoints([
            { x: 0, y: -12 }, { x: 11, y: 7 }, { x: -11, y: 7 },
          ], true);
          g.lineStyle(1, 0xffaaff, 0.6);
          g.strokeCircle(0, 0, 16);
        }, 0xff44ff);
        enemy.speed = 280;  // fast!
        enemy.hp = 1;
        enemy.points = 200;
        enemy.spinAngle = 0;
        // Lock attack direction toward player at spawn
        if (gameState.player) {
          enemy._lockedAngle = angleToTarget(enemy, gameState.player);
        } else {
          enemy._lockedAngle = Math.random() * Math.PI * 2;
        }
        break;

      case 'waver':
        // WAVER — stationary hexagon that emits expanding damage rings every 3s.
        // Ring is dangerous only while expanding (~600ms window).
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(3, 0x44ff88, 1);
          const pts = [];
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            pts.push({ x: Math.cos(a) * 12, y: Math.sin(a) * 12 });
          }
          g.strokePoints(pts, true);
          g.lineStyle(1, 0x88ffaa, 0.5);
          g.strokeCircle(0, 0, 6);
        }, 0x44ff88);
        enemy.speed = 25;
        enemy.hp = 3;
        enemy.points = 175;
        enemy.lastWaveAt = this.time.now + 1800;
        enemy.waveCooldown = Math.max(2000, 3500 - gameState.currentWave * 150);
        break;

      // ── WORLD 2 — SQUID / ORGANIC ROSTER ──────────────────────────────
      case 'squid':
        // SQUID — body + 5 wavy tentacles. Drifts toward player. When close
        // (<200px), enters SPIN ATTACK: rotates rapidly and dashes. Tentacles
        // animate via _squidPhase tracked in update.
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(2, 0xff66cc, 1);
          // Bulb body
          g.strokeCircle(0, -2, 9);
          // 5 tentacles drawn as two-segment lines (wave will be applied in update)
          for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + Math.PI / 4 * (i - 2) + Math.PI;
            const x1 = Math.cos(a) * 6, y1 = Math.sin(a) * 6 + 4;
            const x2 = Math.cos(a) * 14, y2 = Math.sin(a) * 14 + 14;
            g.lineBetween(x1, y1, x2, y2);
          }
          g.lineStyle(1, 0xffaadd, 0.6);
          g.strokeCircle(0, -2, 5);
        }, 0xff66cc);
        enemy.speed = 60;
        enemy.hp = 3;
        enemy.points = 175;
        enemy.spinAttackAt = 0;
        enemy.spinAngle = 0;
        break;

      case 'squiggle':
        // SQUIGGLE — fast wavy line traversal. Locked direction at spawn,
        // perpendicular sine wobble. Hard-to-track projectile-like enemy.
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(3, 0x88ddff, 1);
          // Three-segment squiggle body
          g.lineBetween(-12, 0, -4, -5);
          g.lineBetween(-4, -5, 4, 5);
          g.lineBetween(4, 5, 12, 0);
        }, 0x88ddff);
        enemy.speed = 220;
        enemy.hp = 1;
        enemy.points = 175;
        enemy.wobble = 0;
        if (gameState.player) {
          enemy._lockedAngle = angleToTarget(enemy, gameState.player);
        } else {
          enemy._lockedAngle = Math.random() * Math.PI * 2;
        }
        break;

      case 'jelly':
        // JELLY — round translucent blob. Slow chaser. Splits into 3 mini
        // jellies on death (replaces pinwheel for world 2).
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(3, 0xffaa44, 1);
          g.strokeCircle(0, 0, 11);
          g.lineStyle(2, 0xffcc88, 0.6);
          g.strokeCircle(0, 0, 7);
          // Jelly tentacle ripples below
          g.lineStyle(1, 0xffaa44, 0.7);
          for (let i = -2; i <= 2; i++) {
            g.lineBetween(i * 4, 11, i * 4, 17);
          }
        }, 0xffaa44);
        enemy.speed = 55;
        enemy.hp = 3;
        enemy.points = 200;
        break;

      // ── WORLD 3 — CRYSTAL / FRAGMENTED ROSTER ──────────────────────────
      case 'crystal':
        // CRYSTAL — fast triangular shard that ricochets off screen edges
        // up to 3 times before self-destruct. Locked angle at spawn.
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(3, 0xaaffff, 1);
          g.strokePoints([
            { x: 0, y: -10 }, { x: 9, y: 8 }, { x: -9, y: 8 },
          ], true);
          g.lineStyle(1, 0xffffff, 0.6);
          g.strokePoints([
            { x: 0, y: -5 }, { x: 4, y: 4 }, { x: -4, y: 4 },
          ], true);
        }, 0xaaffff);
        enemy.speed = 200;
        enemy.hp = 1;
        enemy.points = 200;
        enemy.bouncesLeft = 3;
        if (gameState.player) {
          enemy._lockedAngle = angleToTarget(enemy, gameState.player);
        } else {
          enemy._lockedAngle = Math.random() * Math.PI * 2;
        }
        break;

      case 'cluster':
        // CLUSTER — 4 small crystal pieces orbiting a center. Multi-HP. On
        // death breaks into 4 crystal shards flying outward.
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(2, 0xffff88, 1);
          // 4 sub-crystals at compass points
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2;
            const cx = Math.cos(a) * 10, cy = Math.sin(a) * 10;
            g.strokePoints([
              { x: cx, y: cy - 4 }, { x: cx + 4, y: cy + 3 }, { x: cx - 4, y: cy + 3 },
            ], true);
          }
          g.lineStyle(1, 0xffffaa, 0.5);
          g.strokeCircle(0, 0, 14);
        }, 0xffff88);
        enemy.speed = 50;
        enemy.hp = 5;
        enemy.points = 350;
        enemy.spinAngle = 0;
        break;

      case 'glitcher':
        // GLITCHER — square that TELEPORTS short distances when hit and
        // periodically. Hard to track, persistent.
        enemy.graphics = createNeonGraphics(this, 0, 0, (g) => {
          g.lineStyle(3, 0xff44aa, 1);
          g.strokeRect(-10, -10, 20, 20);
          g.lineStyle(1, 0xffffff, 0.6);
          g.strokeRect(-5, -5, 10, 10);
          // Glitch artifact lines
          g.lineStyle(1, 0xff44aa, 0.7);
          g.lineBetween(-12, -2, 12, -2);
          g.lineBetween(-12, 4, 12, 4);
        }, 0xff44aa);
        enemy.speed = 45;
        enemy.hp = 4;
        enemy.points = 250;
        enemy.lastTeleport = this.time.now + 2000;
        break;
    }
    
    enemy.setSize(20, 20);

    // 2026-05-05 wave-intensification — Geometry Wars pattern: enemies get
    // visibly faster + tougher each wave so the screen feels increasingly
    // hostile. Linear speed boost (+18%/wave) and HP boost on heavy types
    // (every 2 waves, pinwheel/gravity_well gain +1 HP).
    const w = Math.max(1, gameState.currentWave);
    const speedMult = 1 + (w - 1) * 0.18;
    enemy.speed = (enemy.speed || 0) * speedMult;
    if (type === 'pinwheel' || type === 'gravity_well') {
      enemy.hp = (enemy.hp || 1) + Math.floor((w - 1) / 2);
    }

    this.enemyGroup.add(enemy);
    gameState.enemies.push(enemy);

    // Spawn sound
    this.sound.play('sfx_disaster', { volume: 0.2, detune: Math.random() * 200 - 100 });
  }

  // 2026-05-05 freeze-fix — every enemy has orphan display objects (graphics,
  // optional .glow, snake .segments[]) that are NOT in enemyGroup. Calling
  // enemyGroup.clear() destroys the sprite but strands these on screen,
  // which both visibly freezes them AND tanks the renderer at scale.
  // Always go through this helper.
  _killEnemy(enemy) {
    if (!enemy) return;
    if (enemy.segments) {
      enemy.segments.forEach(s => {
        if (s) {
          this.tweens.killTweensOf(s);
          s.destroy();
        }
      });
      enemy.segments = null;
    }
    if (enemy.graphics) {
      // 2026-05-05 freeze fix — tweens targeting destroyed graphics objects
      // can leak update calls and stall the renderer. Kill tweens BEFORE
      // destroying the target. Also covers the boss telegraph scale-pulse.
      this.tweens.killTweensOf(enemy.graphics);
      if (enemy.graphics.glow) {
        this.tweens.killTweensOf(enemy.graphics.glow);
        enemy.graphics.glow.destroy();
      }
      enemy.graphics.destroy();
      enemy.graphics = null;
    }
    this.tweens.killTweensOf(enemy);
    // Remove from gravity-well registry if present
    if (gameState.gravityWells && gameState.gravityWells.length) {
      const idx = gameState.gravityWells.indexOf(enemy);
      if (idx >= 0) gameState.gravityWells.splice(idx, 1);
    }
    enemy.destroy();
  }

  // 2026-05-05 PERF — Bake one bullet texture per weapon tier. Each is a
  // small canvas drawn from a Graphics, then converted to a Texture and
  // cached. Bullets reference these textures via add.image() — single
  // batched draw call for all bullets of the same tier.
  _bakeBulletTextures() {
    const tiers = [
      { key: 'bullet_t0', color: 0x00ffff, kind: 'line' },
      { key: 'bullet_t1', color: 0xffff44, kind: 'line' },
      { key: 'bullet_t2', color: 0xff44ff, kind: 'line' },
      { key: 'bullet_t3', color: 0x44ddff, kind: 'line' },
      { key: 'bullet_t5', color: 0x88ff44, kind: 'bolt' },
      { key: 'bullet_t6', color: 0xff3322, kind: 'rocket' },
      { key: 'bullet_t7', color: 0x8844ff, kind: 'orb' },
      { key: 'bullet_t8', color: 0xff44aa, kind: 'arrow' },
    ];
    for (const t of tiers) {
      if (this.textures.exists(t.key)) continue;
      const w = (t.kind === 'rocket' || t.kind === 'arrow') ? 36 : 28;
      const h = (t.kind === 'rocket') ? 22 : 16;
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const cx = w / 2, cy = h / 2;
      if (t.kind === 'line') {
        g.lineStyle(3, t.color, 1);
        g.lineBetween(cx - 10, cy, cx + 10, cy);
      } else if (t.kind === 'bolt') {
        g.lineStyle(3, t.color, 1);
        g.lineBetween(cx - 10, cy, cx + 10, cy);
        g.lineStyle(2, 0xffffaa, 0.9);
        g.lineBetween(cx - 8, cy - 3, cx - 2, cy + 1);
        g.lineBetween(cx - 2, cy + 1, cx + 2, cy - 1);
        g.lineBetween(cx + 2, cy - 1, cx + 8, cy + 3);
      } else if (t.kind === 'rocket') {
        g.fillStyle(t.color, 1);
        g.fillRect(cx - 12, cy - 4, 20, 8);
        g.fillStyle(0xffffaa, 1);
        g.fillTriangle(cx + 8, cy - 4, cx + 8, cy + 4, cx + 14, cy);
        g.fillStyle(0xffaa44, 1);
        g.fillTriangle(cx - 12, cy - 4, cx - 12, cy - 8, cx - 6, cy - 4);
        g.fillTriangle(cx - 12, cy + 4, cx - 12, cy + 8, cx - 6, cy + 4);
        g.fillStyle(0xffff44, 0.9);
        g.fillCircle(cx - 15, cy, 3);
      } else if (t.kind === 'orb') {
        g.fillStyle(0x000000, 1);
        g.fillCircle(cx, cy, 7);
        g.lineStyle(2, t.color, 1);
        g.strokeCircle(cx, cy, 8);
        g.lineStyle(1, 0xaa66ff, 0.8);
        g.strokeCircle(cx, cy, 11);
      } else if (t.kind === 'arrow') {
        g.fillStyle(t.color, 1);
        g.fillTriangle(cx - 8, cy - 3, cx - 8, cy + 3, cx + 8, cy);
        g.fillStyle(0xffaadd, 0.9);
        g.fillTriangle(cx - 8, cy - 3, cx - 8, cy - 6, cx - 4, cy - 3);
        g.fillTriangle(cx - 8, cy + 3, cx - 8, cy + 6, cx - 4, cy + 3);
        g.fillStyle(0xffff88, 0.7);
        g.fillCircle(cx - 10, cy, 2);
      }
      g.generateTexture(t.key, w, h);
      g.destroy();
    }
  }

  // 2026-05-05 — Drift debris (split-children from pinwheel/jelly/cluster).
  // Pure outward velocity, NO chase AI. Self-destructs after 2.5s. Drawn via
  // the supplied paintFn so each parent type can give its debris distinct
  // visuals.
  _spawnDriftDebris(x, y, angle, speed, color, points, paintFn) {
    const d = this.physics.add.sprite(x, y, '_invisible');
    d.graphics = createNeonGraphics(this, 0, 0, paintFn, color, 0.5);
    d.hp = 1;
    d.points = points;
    d.enemyType = 'drift';
    d.bornAt = this.time.now;
    this.enemyGroup.add(d);
    gameState.enemies.push(d);
    d.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    return d;
  }

  // 2026-05-05 — Enemy projectile (shooter / boss bursts). Separate group so
  // it doesn't collide with other enemies. Auto-destroys after 4s.
  // PERF: Capped at 80 active. When over cap, oldest is destroyed first.
  // Without cap, late-game boss radial bursts + many shooters stack 200+
  // bullets and the renderer chokes (each is a Graphics + sprite).
  _spawnEnemyBullet(x, y, angle, speed = 200, color = 0xff4444) {
    if (this.enemyBullets && this.enemyBullets.getChildren) {
      const list = this.enemyBullets.getChildren();
      while (list.length >= 80) {
        const oldest = list[0];
        if (oldest && oldest.active) {
          if (oldest.graphics) oldest.graphics.destroy();
          oldest.destroy();
        } else {
          break;
        }
      }
    }
    const bullet = this.physics.add.sprite(x, y, '_invisible');
    bullet.setSize(8, 8);
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(0, 0, 4);
    g.lineStyle(1, 0xffffff, 0.6);
    g.strokeCircle(0, 0, 5);
    bullet.graphics = g;
    bullet.spawnedAt = this.time.now;
    this.enemyBullets.add(bullet);
    bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    this.time.delayedCall(4000, () => {
      if (bullet.active) {
        if (bullet.graphics) bullet.graphics.destroy();
        bullet.destroy();
      }
    });
    return bullet;
  }

  // 2026-05-05 — Damage ring. PERF: previously did clear()+lineStyle()+
  // strokeCircle() every frame on each ring. With many rings, this stacked
  // up. Now: draw ring ONCE at radius=1 and use Phaser tweens to scale
  // up + fade. Tween logic runs natively in Phaser (cheap). The damageRings
  // array still tracks them for collision-vs-player checks.
  _emitDamageRing(x, y, color = 0x44ff88, maxRadius = 130) {
    const ring = this.add.graphics().setDepth(150);
    ring.lineStyle(3, color, 1);
    ring.strokeCircle(0, 0, 1);  // unit ring, scaled via tween
    ring.x = x; ring.y = y;
    ring.scale = 8;
    const ringObj = {
      gfx: ring, x, y,
      radius: 8,
      maxRadius,
      color,
      birthTime: this.time.now,
      lifetime: 700,
      hit: false,
    };
    this.damageRings.push(ringObj);
    // Native Phaser tween — no per-frame Graphics redraw needed
    this.tweens.add({
      targets: ring,
      scale: maxRadius,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
    });
    if (this.cache.audio.exists('sfx_disaster')) {
      this.sound.play('sfx_disaster', { volume: 0.25, detune: -300 });
    }
    return ringObj;
  }

  // 2026-05-06 — Wide-laser boss attack. Two-phase:
  //   1) Telegraph (700ms): thin red warning line drawn from boss across
  //      the screen so the player can dodge.
  //   2) Firing (450ms): a wide beam (default 60px) that damages the
  //      player on touch. update() checks overlap each frame using
  //      perpendicular distance from the player to the beam axis.
  // Beams persist across boss-death only briefly — wipeBossBeams() clears
  // them in _onBossDefeated for clean wave transition.
  _fireBossLaser(boss, angle, opts = {}) {
    const width = opts.width || 60;
    const length = opts.length || 1400;
    const telegraphMs = opts.telegraphMs || 700;
    const firingMs = opts.firingMs || 450;
    const color = opts.color || 0xff3300;
    const tele = this.add.graphics().setDepth(140);
    tele.lineStyle(3, color, 0.85);
    tele.lineBetween(0, 0, length, 0);
    tele.x = boss.x; tele.y = boss.y; tele.rotation = angle;
    // Subtle pulse during telegraph so it reads as "warning"
    this.tweens.add({
      targets: tele,
      alpha: { from: 1, to: 0.3 },
      duration: telegraphMs / 4,
      yoyo: true,
      repeat: 3,
    });
    // 2026-05-06 — Boss charge-up GLOW. Stack of two graphics under the
    // boss body that scale up + pulse during telegraph, then snap to 0
    // when the beam fires. Gives the player a second readable cue (the
    // boss itself) on top of the warning line. Pinned to boss x/y each
    // frame via the bossBeams update loop.
    const glowOuter = this.add.graphics().setDepth(95);
    glowOuter.fillStyle(color, 0.22);
    glowOuter.fillCircle(0, 0, 90);
    glowOuter.x = boss.x; glowOuter.y = boss.y;
    glowOuter.scale = 0.4;
    glowOuter.alpha = 0;
    const glowInner = this.add.graphics().setDepth(96);
    glowInner.fillStyle(color, 0.55);
    glowInner.fillCircle(0, 0, 55);
    glowInner.x = boss.x; glowInner.y = boss.y;
    glowInner.scale = 0.4;
    glowInner.alpha = 0;
    // Outer halo: ramps up smoothly across telegraph
    this.tweens.add({
      targets: glowOuter,
      scale: 1.4,
      alpha: 0.85,
      duration: telegraphMs,
      ease: 'Quad.easeIn',
    });
    // Inner core: faster pulse for urgency, gets brighter as fire nears
    this.tweens.add({
      targets: glowInner,
      scale: { from: 0.4, to: 1.1 },
      alpha: { from: 0.2, to: 0.95 },
      duration: telegraphMs / 5,
      yoyo: true,
      repeat: 4,
      ease: 'Sine.easeInOut',
    });
    const beam = {
      gfx: null,
      telegraphGfx: tele,
      glowOuter, glowInner,
      x: boss.x, y: boss.y,
      angle, width, length,
      birth: this.time.now,
      telegraphUntil: this.time.now + telegraphMs,
      firingUntil: this.time.now + telegraphMs + firingMs,
      hit: false,
      _bossRef: boss,
    };
    // After telegraph, swap to thick damaging beam
    this.time.delayedCall(telegraphMs, () => {
      if (tele && tele.active) tele.destroy();
      // Snap glows out — sharp transition signals "now firing"
      this.tweens.killTweensOf(glowOuter);
      this.tweens.killTweensOf(glowInner);
      this.tweens.add({ targets: [glowOuter, glowInner], alpha: 0, scale: 1.6, duration: 140, ease: 'Quad.easeOut',
        onComplete: () => { if (glowOuter.active) glowOuter.destroy(); if (glowInner.active) glowInner.destroy(); }});
      beam.glowOuter = null;
      beam.glowInner = null;
      // Boss may have died during telegraph — bail
      if (!beam._bossRef || !beam._bossRef.active) return;
      const g = this.add.graphics().setDepth(141);
      g.fillStyle(color, 0.85);
      g.fillRect(0, -width / 2, length, width);
      g.fillStyle(0xffffff, 0.65);
      g.fillRect(0, -width / 6, length, width / 3);
      g.x = beam._bossRef.x; g.y = beam._bossRef.y; g.rotation = angle;
      beam.gfx = g;
      // Camera shake punctuates the fire moment
      this.cameras.main.shake(180, 0.018);
      if (this.cache.audio.exists('sfx_disaster')) {
        this.sound.play('sfx_disaster', { volume: 0.4 });
      }
    });
    this.bossBeams.push(beam);
  }

  playerHitEnemyBullet(player, bullet) {
    if (player.invulnerable || !bullet.active) return;
    if (bullet.graphics) bullet.graphics.destroy();
    bullet.destroy();
    // Reuse player-hit logic (lose life + invuln frames)
    this.playerHitEnemy(player, { active: true, x: bullet.x, y: bullet.y });
  }

  fireBullet() {
    const pointer = this.input.activePointer;
    const baseAngle = angleToTarget(gameState.player, pointer);

    const now = this.time.now;
    const tierActive = now < this.weaponTierExpiresAt;
    const activeTier = tierActive ? this.weaponTier : 0;
    const stacks = tierActive ? this.weaponStacks : 0;

    // Each tier has a fire pattern. Stacks add bonus shots.
    const angles = [];
    if (activeTier === 0) {
      // Base
      angles.push(baseAngle);
    } else if (activeTier === 1) {
      // DOUBLE — parallel; +1 parallel per stack
      const count = 2 + stacks;
      for (let i = 0; i < count; i++) angles.push(baseAngle);
    } else if (activeTier === 2) {
      // TRIPLE spread ±15deg; each stack widens spread + adds 2 shots
      const count = 3 + stacks * 2;
      const widen = Math.PI / 12 + stacks * Math.PI / 36;
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        angles.push(baseAngle + (i - half) * (widen / Math.max(half, 1)));
      }
    } else if (activeTier === 3) {
      // QUAD shotgun-burst — 4 tight shots; each stack adds 2 shots
      const count = 4 + stacks * 2;
      const widen = Math.PI / 9; // ±20deg
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        angles.push(baseAngle + (i - half) * (widen / Math.max(half, 1)));
      }
    } else if (activeTier === 5) {
      // 2026-05-05 — CHAIN LIGHTNING is now an INSTANT ZAP, not a bullet.
      // No projectile travel — fire a bolt directly from player to nearest
      // enemy, then chain. Higher damage (was too weak as a one-bullet weapon).
      this._fireChainZap(baseAngle, stacks);
      return;  // bypass _spawnBullet entirely
    } else if (activeTier === 6) {
      // 2026-05-06 — SHOCK WAVE replaces ROCKET. Player emits a radial
      // expanding ring centered on the ship that damages every enemy it
      // passes through. Bypass _spawnBullet entirely (no projectile).
      this._fireShockWave(stacks);
      return;
    } else if (activeTier === 7) {
      // 2026-05-06 — BLACK HOLE rewritten as a player-centric ability:
      // sucks all enemies toward the ship, damages them, and grants
      // invincibility for the duration. Bypasses _spawnBullet — no
      // travel projectile, the vortex IS the weapon.
      this._fireBlackHole(stacks);
      return;
    } else if (activeTier === 8) {
      // HOMING SWARM — 3 + stacks missiles in tight forward arc, each homes
      const count = 3 + stacks;
      const widen = Math.PI / 8;  // ±22.5deg arc
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        angles.push(baseAngle + (i - half) * (widen / Math.max(half, 1)));
      }
    } else {
      angles.push(baseAngle);
    }

    angles.forEach((angle, i) => this._spawnBullet(angle, i, activeTier, stacks, angles.length));
  }

  _spawnBullet(angle, idx, tier, stacks, total) {
    const px = gameState.player.x;
    const py = gameState.player.y;
    // Spread tiers offset bullets perpendicular to aim so they look like a line
    let ox = 0, oy = 0;
    if (tier === 1 && total > 1) {
      const perp = angle + Math.PI / 2;
      const half = (total - 1) / 2;
      const sign = (idx - half) * 12;
      ox = Math.cos(perp) * sign;
      oy = Math.sin(perp) * sign;
    }

    // 2026-05-05 PERF — Use a pre-baked texture (single batched draw call for
    // all bullets of the same tier) instead of allocating a Graphics object
    // per bullet. Stack visual is conveyed via scaleX bump (subtle thickening).
    // Texture key falls back to t0 if a tier doesn't have a unique texture.
    const texKey = this.textures.exists(`bullet_t${tier}`) ? `bullet_t${tier}` : 'bullet_t0';
    const bullet = this.physics.add.image(px + ox, py + oy, texKey);
    bullet.setScale(1 + Math.min(stacks, 4) * 0.08);
    bullet.weaponTier = tier;
    // Chain lightning targets: stacks add jumps.
    bullet.chainJumps = (tier === 5) ? (2 + stacks) : 0;
    // Rocket explosion radius: stacks scale up.
    bullet.rocketRadius = (tier === 6) ? (90 + stacks * 25) : 0;
    // Black hole projectile flag — on impact, spawn vortex.
    bullet.blackHoleProjectile = (tier === 7);
    bullet.blackHoleStacks = (tier === 7) ? stacks : 0;
    // Homing missile properties — locks onto nearest enemy at spawn.
    bullet.homing = (tier === 8);
    if (tier === 8) {
      bullet.homingTarget = this._findNearestEnemy(px, py);
      bullet.homingTurnRate = 0.0035;  // radians per ms
    }
    bullet.damage = 1 + (stacks * 0.5);
    if (tier === 6) bullet.damage = 2 + (stacks * 0.8);    // ROCKET direct hit
    if (tier === 8) bullet.damage = 1.5 + (stacks * 0.5);  // HOMING per-missile

    // 2026-05-05 PERF — Cap concurrent bullets at 150. Stacked QUAD + chain
    // lightning + homing swarm can spawn 30+ bullets per fire tick; runaway
    // counts cause GPU/CPU thrashing. When over cap, destroy oldest first.
    if (gameState.bullets.length >= 150) {
      const oldest = gameState.bullets.shift();
      if (oldest && oldest.active) {
        if (oldest.graphics) oldest.graphics.destroy();
        oldest.destroy();
      }
    }

    // CRITICAL: Group.add() calls body.reset() which zeroes velocity.
    this.bulletGroup.add(bullet);
    gameState.bullets.push(bullet);

    // Speed per tier — heavy weapons slower so they feel weighty.
    let speed = 600;
    if (tier === 6) speed = 380;        // Rocket
    else if (tier === 7) speed = 320;   // Black-hole projectile
    else if (tier === 8) speed = 500;   // Homing — modest, lets them turn
    bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    bullet.rotation = angle;

    this.time.delayedCall(2000, () => {
      if (bullet.active) {
        if (bullet.graphics) bullet.graphics.destroy();
        bullet.destroy();
      }
    });
  }

  // 2026-05-05 — World structure. 3 worlds × 3 waves = 9 waves. Each world
  // ends in a boss (waves 3, 6, 9). Music swaps on world transition.
  _worldForWave(w) {
    if (w <= 3) return 1;
    if (w <= 6) return 2;
    return 3;
  }

  _isBossWave(w) {
    return w === 3 || w === 6 || w === 9;
  }

  _bossIdForWave(w) {
    if (w === 3) return 1; // OCTAEDRON
    if (w === 6) return 2; // HEX SWARM
    if (w === 9) return 3; // PRISM CORE
    return 0;
  }

  _switchMusic(key) {
    if (this._currentMusicKey === key) return;
    if (this.bgMusic) {
      const old = this.bgMusic;
      // Quick fade out, then stop
      this.tweens.add({
        targets: old, volume: 0,
        duration: 600,
        onComplete: () => { try { old.stop(); old.destroy(); } catch (e) {} },
      });
    }
    if (!this.cache.audio.exists(key)) return;
    this.bgMusic = this.sound.add(key, { volume: 0, loop: true });
    this.bgMusic.play();
    this.tweens.add({ targets: this.bgMusic, volume: 0.3, duration: 800 });
    this._currentMusicKey = key;
  }

  _musicKeyForWorld(world) {
    return `music_world${world}`;
  }

  _showBigBanner(text, color, durationMs = 1800) {
    const banner = this.add.text(640, 360, text, {
      font: 'bold 56px Arial',
      color: color,
      align: 'center',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(500).setAlpha(0);
    this.tweens.add({
      targets: banner, alpha: 1, scale: 1.15,
      duration: 250, yoyo: true, hold: durationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => banner.destroy(),
    });
    return banner;
  }

  // ── BOSS SPAWNERS ─────────────────────────────────────────────────────
  // Each boss is a heavyweight enemy with multi-phase behavior, custom
  // graphics, and a kill callback that triggers wave advance + world transition.
  _startBossFight(bossId) {
    if (this.bossActive) return;
    this.bossActive = true;
    this.bossId = bossId;
    // Pause regular spawning during boss fight
    this.nextSpawnTime = Number.MAX_SAFE_INTEGER;
    // 2026-05-05 — Boss music swap removed (user request — single track for
    // the whole game). World identity lives in the enemy roster + boss visuals.
    // Dramatic intro: red flash + camera shake + name banner
    this.cameras.main.flash(400, 255, 80, 80);
    this.cameras.main.shake(500, 0.018);
    const bossNames = { 1: 'OCTAEDRON', 2: 'HEX SWARM', 3: 'PRISM CORE' };
    const bossColors = { 1: '#44ddff', 2: '#ff44ff', 3: '#ff8800' };
    this._showBigBanner(`⬢ BOSS: ${bossNames[bossId]} ⬢`, bossColors[bossId], 1600);
    // Spawn boss after intro (1.5s)
    this.time.delayedCall(1500, () => {
      this._spawnBoss(bossId);
    });
  }

  _spawnBoss(bossId) {
    const cx = 640, cy = 240; // Spawn at top-center (1280x720 → x=center, y=33%)
    const boss = this.physics.add.sprite(cx, cy, '_invisible');
    boss.enemyType = `boss_${bossId}`;
    boss.bossId = bossId;
    boss.bossPhase = 0;
    boss.lastAttack = this.time.now;
    boss.satellites = []; // for boss 2

    if (bossId === 1) {
      // OCTAEDRON: large rotating diamond. HIGH HP — should take 15-20s with
      // a stacked weapon, much longer with base. Punishes weak loadouts.
      boss.graphics = createNeonGraphics(this, 0, 0, (g) => {
        g.lineStyle(3, 0x44ddff, 1);
        g.strokePoints([
          { x: 0, y: -40 }, { x: 36, y: 0 },
          { x: 0, y: 40 }, { x: -36, y: 0 },
        ], true);
        g.lineStyle(2, 0x88eeff, 0.6);
        g.strokePoints([
          { x: 0, y: -22 }, { x: 18, y: 0 },
          { x: 0, y: 22 }, { x: -18, y: 0 },
        ], true);
      }, 0x44ddff);
      boss.hp = 120;
      boss.maxHp = 120;
      boss.points = 5000;
      boss.speed = 40;
      boss.setSize(70, 70);
    } else if (bossId === 2) {
      // HEX SWARM: central hexagon (invuln) + 6 satellites (vulnerable).
      // Core only takes damage when all satellites destroyed.
      boss.graphics = createNeonGraphics(this, 0, 0, (g) => {
        g.lineStyle(3, 0xff44ff, 1);
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          pts.push({ x: Math.cos(a) * 30, y: Math.sin(a) * 30 });
        }
        g.strokePoints(pts, true);
        g.lineStyle(2, 0xffaaff, 0.5);
        g.strokeCircle(0, 0, 16);
      }, 0xff44ff);
      boss.hp = 180;
      boss.maxHp = 180;
      boss.points = 8000;
      boss.speed = 30;
      boss.setSize(60, 60);
      // Spawn 6 satellite triangles around the core
      for (let i = 0; i < 6; i++) {
        const sat = this._spawnHexSatellite(boss, i);
        boss.satellites.push(sat);
      }
    } else if (bossId === 3) {
      // PRISM CORE: rotating triangular prism, 3 phases by HP thresholds.
      // 2026-05-06 — HP bumped 280 → 480 + wide laser added per user
      // ("final boss too easy"). Prism Core is wave 9 = the run finale,
      // it should genuinely test the player's tier-8 weapon stack.
      boss.graphics = createNeonGraphics(this, 0, 0, (g) => {
        g.lineStyle(4, 0xff8800, 1);
        g.strokePoints([
          { x: 0, y: -45 }, { x: 39, y: 22 }, { x: -39, y: 22 },
        ], true);
        g.lineStyle(2, 0xffaa44, 0.7);
        g.strokePoints([
          { x: 0, y: -22 }, { x: 19, y: 11 }, { x: -19, y: 11 },
        ], true);
      }, 0xff8800);
      boss.hp = 480;
      boss.maxHp = 480;
      boss.points = 15000;
      boss.speed = 50;
      boss.setSize(80, 80);
    }

    this.enemyGroup.add(boss);
    gameState.enemies.push(boss);
    this.boss = boss;

    // Boss HP bar at top of screen
    this._createBossHUD();
  }

  _spawnHexSatellite(coreBoss, idx) {
    const sat = this.physics.add.sprite(coreBoss.x, coreBoss.y, '_invisible');
    sat.enemyType = 'boss_satellite';
    sat.parentBoss = coreBoss;
    sat.orbitAngle = idx * Math.PI / 3;
    sat.orbitRadius = 80;
    sat.hp = 10;
    sat.points = 500;
    sat.speed = 0;
    sat.graphics = createNeonGraphics(this, 0, 0, (g) => {
      g.lineStyle(2, 0xffff44, 1);
      g.strokePoints([
        { x: 0, y: -10 }, { x: 9, y: 6 }, { x: -9, y: 6 },
      ], true);
    }, 0xffff44);
    sat.setSize(20, 20);
    this.enemyGroup.add(sat);
    gameState.enemies.push(sat);
    return sat;
  }

  _createBossHUD() {
    if (this.bossHpBg) this.bossHpBg.destroy();
    if (this.bossHpBar) this.bossHpBar.destroy();
    if (this.bossNameText) this.bossNameText.destroy();
    const bossNames = { 1: 'OCTAEDRON', 2: 'HEX SWARM', 3: 'PRISM CORE' };
    const bossColors = { 1: 0x44ddff, 2: 0xff44ff, 3: 0xff8800 };
    this.bossNameText = this.add.text(640, 80, bossNames[this.bossId], {
      font: 'bold 22px Arial',
      color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(60);
    this.bossHpBg = this.add.graphics().setDepth(60);
    this.bossHpBg.fillStyle(0x222222, 0.8);
    this.bossHpBg.fillRect(340, 100, 600, 14);
    this.bossHpBar = this.add.graphics().setDepth(61);
    this.bossHpBar._color = bossColors[this.bossId];
  }

  _updateBossHUD() {
    if (!this.bossHpBar || !this.boss) return;
    const pct = Math.max(0, this.boss.hp / this.boss.maxHp);
    this.bossHpBar.clear();
    this.bossHpBar.fillStyle(this.bossHpBar._color, 1);
    this.bossHpBar.fillRect(340, 100, 600 * pct, 14);
  }

  _killBossHUD() {
    if (this.bossHpBg) { this.bossHpBg.destroy(); this.bossHpBg = null; }
    if (this.bossHpBar) { this.bossHpBar.destroy(); this.bossHpBar = null; }
    if (this.bossNameText) { this.bossNameText.destroy(); this.bossNameText = null; }
  }

  _onBossDefeated() {
    this.bossActive = false;
    this.boss = null;
    this._killBossHUD();
    // 2026-05-06 — Wipe all enemy bullets so the next wave starts clean.
    // Hex Swarm (and other bosses) leave projectiles in flight after death;
    // homing reds especially would track the player into wave 7 unfairly.
    if (this.enemyBullets && this.enemyBullets.getChildren) {
      this.enemyBullets.getChildren().slice().forEach(b => {
        if (b.graphics) b.graphics.destroy();
        if (b.active) b.destroy();
      });
    }
    // Same for any in-flight Prism Core wide-laser beams (telegraph,
    // fire, and the charge-up glow under the boss).
    if (this.bossBeams && this.bossBeams.length) {
      this.bossBeams.forEach(beam => {
        if (beam.telegraphGfx && beam.telegraphGfx.active) beam.telegraphGfx.destroy();
        if (beam.gfx && beam.gfx.active) beam.gfx.destroy();
        if (beam.glowOuter && beam.glowOuter.active) beam.glowOuter.destroy();
        if (beam.glowInner && beam.glowInner.active) beam.glowInner.destroy();
      });
      this.bossBeams = [];
    }
    // 2026-05-05 freeze fix: the wave timer ran through the entire boss fight,
    // so by the time the boss dies waveElapsed > waveTimer. Without this guard,
    // the next frame's timer check fires _advanceWave immediately AND the
    // 2.2s delayedCall below fires it again → double-burst-spawn chaos.
    this._bossDeathPending = true;
    // Massive death FX
    this.cameras.main.flash(600, 255, 255, 255);
    this.cameras.main.shake(800, 0.025);
    // Score bonus
    const bonus = 5000 * gameState.currentWave;
    gameState.score += bonus;
    this.scoreText.setText(`Score: ${gameState.score}`);
    this._showBigBanner(`WORLD ${this._worldForWave(gameState.currentWave)} CLEARED\n+${bonus}`, '#ffff44', 1800);
    // Slight delay then advance — flagged as boss-clear so _advanceWave
    // performs the full enemy/projectile cleanup (the only true "clear").
    this.time.delayedCall(2200, () => {
      this._isBossClearAdvance = true;
      this._advanceWave();
    });
  }

  _advanceWave() {
    // 2026-05-06 — Reject any advance fired within 500ms of scene creation.
    // The user reported "sometimes retry starts at wave 2" — root cause
    // was a stale wave-elapsed check on the first update tick before
    // create() finished setting waveStartTime/waveTimer to proper values.
    // Even with init() now seeding sane defaults, this guard makes it
    // impossible for any path (queued tween, leaked timer, future bug)
    // to bump currentWave during the boot window of a fresh run.
    if (this._sceneCreatedAt && (this.time.now - this._sceneCreatedAt) < 500) {
      return;
    }
    // Clear post-boss-death guard now that we're advancing
    this._bossDeathPending = false;
    gameState.currentWave++;
    VS_ACHIEVE.onWaveStart();
    // 2026-05-05 — Persist highest wave ever reached so N-skip can be gated
    // on it on future runs. Save on every wave start.
    if (gameState.currentWave > gameState.maxWaveReached) {
      gameState.maxWaveReached = gameState.currentWave;
      localStorage.setItem('vectorStormMaxWave', String(gameState.maxWaveReached));
    }
    if (gameState.currentWave > 9) {
      if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
        localStorage.setItem('vectorStormHighScore', gameState.highScore.toString());
      }
      if (this.bgMusic) this.bgMusic.stop();
      this.scene.start('Win');
      return;
    }
    gameState.waveStartTime = this.time.now;
    // 2026-05-05 polish — wave-clear: brief white flash + shake + zoom-punch.
    // Was pure-green at 1000ms (epileptic + too long). Geometry Wars uses a
    // ~150ms white flash + celebratory shake + bass kick — brief but punchy.
    this.cameras.main.flash(180, 255, 255, 255);
    this.cameras.main.shake(220, 0.014);
    // Zoom-punch: zoom out 5% then snap back. Standard wave-clear feel.
    this.cameras.main.zoomTo(1.05, 80, 'Sine.easeOut');
    this.time.delayedCall(120, () => this.cameras.main.zoomTo(1.0, 200, 'Sine.easeOut'));

    if (this.cache.audio.exists('sfx_levelup')) {
      this.sound.play('sfx_levelup', { volume: 0.5 });
    }
    // Bonus score popup floating in center
    const bonus = 1000 * gameState.currentWave;
    gameState.score += bonus;
    this.scoreText.setText(`Score: ${gameState.score}`);
    const waveBonusPop = this.add.text(640, 360, `WAVE ${gameState.currentWave - 1} CLEAR\n+${bonus}`, {
      font: 'bold 32px Arial',
      color: '#ffff88',
      align: 'center',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(300);
    this.tweens.add({
      targets: waveBonusPop,
      y: 220, alpha: 0, scale: 1.5,
      duration: 1400, ease: 'Cubic.easeOut',
      onComplete: () => waveBonusPop.destroy(),
    });

    // Reset N-key skip guard so next wave's N key can fire (re-entry guard
    // prevents skip-cascade through all 9 waves in one frame).
    this.waveSkipped = false;

    // 2026-05-05 — Cumulative-wave model. Per user spec: enemies persist
    // across wave advances. Only a BOSS KILL is a real "clear". This means:
    //   N-skip: keep enemies. Skipping wave 1→2→3 stacks all 3 waves' enemies.
    //   Timer expiry: keep enemies (you didn't earn a clear).
    //   Boss kill: clear everything (real clear, world transition).
    const isBossClear = this._isBossClearAdvance === true;
    this._isBossClearAdvance = false;
    this._skipRequested = false;
    if (isBossClear) {
      if (gameState.enemies && gameState.enemies.length) {
        gameState.enemies.slice().forEach(e => this._killEnemy(e));
      }
      gameState.enemies = [];
      gameState.gravityWells = [];
      if (this.enemyGroup) this.enemyGroup.clear(true, false);
      if (this.enemyBullets && this.enemyBullets.getChildren) {
        this.enemyBullets.getChildren().slice().forEach(b => {
          if (b.graphics) b.graphics.destroy();
          b.destroy();
        });
      }
      // 2026-05-05 freeze fix — damage rings persist across wave change and
      // their .gfx Graphics objects can leak. Force-clear them on boss-clear.
      if (this.damageRings && this.damageRings.length) {
        this.damageRings.forEach(r => { if (r.gfx) { this.tweens.killTweensOf(r.gfx); r.gfx.destroy(); } });
        this.damageRings = [];
      }
      // Same for active black-hole vortices
      if (this.blackHoles && this.blackHoles.length) {
        this.blackHoles.forEach(bh => { if (bh.gfx) bh.gfx.destroy(); });
        this.blackHoles = [];
      }
    }

    const wave = gameState.currentWave;
    // 2026-05-05 — Per user request, music stays the same the whole game
    // (synthwave / music_world1). World identity now lives in the enemy
    // roster, not the audio. Boss fights also stay on the same music.

    // BOSS WAVE — skip drip, fire boss intro
    if (this._isBossWave(wave)) {
      this._startBossFight(this._bossIdForWave(wave));
      return;
    }

    // 2026-05-05 — Burst spawn ONLY on boss-clear advances (post-boss = new
    // world feel). On skip/timer-expiry advances, no burst — the screen
    // already has leftover enemies, and the new wave's drip uses the
    // updated roster + faster spawn delay. Difficulty ramps naturally.
    if (isBossClear) {
      const burstCount = 4 + wave * 2;
      const types = this._availableEnemyTypes(wave);
      for (let i = 0; i < burstCount; i++) {
        this.time.delayedCall(i * 80, () => {
          // 2026-05-05 — same bug as _togglePause: this.gameOver is the
          // method reference (truthy), would skip ALL spawns. Use the flag.
          if (this._gameOverFired || this.paused) return;
          const t = Phaser.Utils.Array.GetRandom(types);
          this.spawnEnemy(t);
        });
      }
      this.nextSpawnTime = this.time.now + burstCount * 80 + 400;
    } else {
      // Drip resumes immediately at the new wave's faster pace
      this.nextSpawnTime = this.time.now + 400;
    }
  }

  // 2026-05-05 — World-themed rosters. Each world has DIFFERENT enemy
  // species so the visual identity changes between worlds (per user spec).
  //   World 1 (waves 1-3): GEOMETRIC — squares, diamonds, snakes, shooters, spinners
  //   World 2 (waves 4-6): SQUID/ORGANIC — squids, squiggles, jellies, wavers, shooters
  //   World 3 (waves 7-9): CRYSTAL — crystals, clusters, glitchers, gravity_wells
  _availableEnemyTypes(wave) {
    if (wave <= 3) {
      // World 1
      const t = ['blue_square', 'diamond'];
      if (wave >= 2) t.push('snake', 'shooter');
      if (wave >= 3) t.push('spinner');
      return t;
    } else if (wave <= 6) {
      // World 2 — squid theme. Wave 4 weighted toward chasers (squid, jelly)
      // not fast traversers — eased entry from world 1.
      const t = ['squid', 'jelly'];
      if (wave >= 4) t.push('squid', 'shooter');   // extra squid (slow), shooter (mid)
      if (wave >= 5) t.push('squiggle', 'waver');  // squiggle introduced wave 5
      if (wave >= 6) t.push('squiggle', 'jelly');  // density up
      return t;
    } else {
      // World 3 — crystal theme
      const t = ['crystal', 'glitcher'];
      if (wave >= 7) t.push('cluster');
      if (wave >= 8) t.push('gravity_well', 'crystal');
      if (wave >= 9) t.push('glitcher', 'cluster');
      return t;
    }
  }

  _togglePause() {
    // 2026-05-05 — was gated on `this.gameOver` which is the METHOD reference
    // (always truthy) → P never paused. Use the dedicated _gameOverFired flag
    // set in gameOver() instead.
    if (this._gameOverFired) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.physics.pause();
      if (this.bgMusic) this.bgMusic.pause();
      this._pauseText = this.add.text(640, 360, 'PAUSED\n[P] resume', {
        font: 'bold 48px Arial', color: '#ffffff', align: 'center'
      }).setOrigin(0.5).setDepth(1000);
    } else {
      this.physics.resume();
      if (this.bgMusic) this.bgMusic.resume();
      if (this._pauseText) { this._pauseText.destroy(); this._pauseText = null; }
    }
  }

  _grantWeaponUpgrade(tier, durationMs = 9000) {
    const now = this.time.now;
    const sameTierStillActive = (this.weaponTier === tier && now < this.weaponTierExpiresAt);
    if (sameTierStillActive) {
      // STACK BONUS — extend duration + add a stack (caps at 4)
      this.weaponStacks = Math.min(this.weaponStacks + 1, 4);
      this.weaponTierExpiresAt = Math.max(this.weaponTierExpiresAt, now) + durationMs;
      // Score bonus per stack
      gameState.score += 250 * this.weaponStacks;
      this.scoreText.setText(`Score: ${gameState.score}`);
    } else {
      // New tier — reset stacks
      this.weaponTier = tier;
      this.weaponStacks = 0;
      this.weaponTierExpiresAt = now + durationMs;
    }
    const meta = WEAPON_TIERS[tier] || WEAPON_TIERS[0];
    const stacksLabel = this.weaponStacks > 0 ? ` x${1 + this.weaponStacks}` : '';
    const flashLabel = sameTierStillActive
      ? `${meta.name} STACK${stacksLabel}!  +${250 * this.weaponStacks}`
      : `${meta.name}!`;
    const flash = this.add.text(gameState.player.x, gameState.player.y - 40,
      flashLabel, {
        font: 'bold 18px Arial',
        color: meta.cssColor,
        stroke: '#000000', strokeThickness: 3,
      }
    ).setOrigin(0.5).setDepth(300);
    this.tweens.add({
      targets: flash, y: flash.y - 40, alpha: 0, scale: 1.4,
      duration: 1100, ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
    // Brief radial pulse on player at pickup
    const pulse = this.add.graphics().setDepth(250);
    pulse.lineStyle(3, meta.colorHex, 0.9);
    pulse.strokeCircle(0, 0, 18);
    pulse.x = gameState.player.x; pulse.y = gameState.player.y;
    this.tweens.add({
      targets: pulse, scale: 3, alpha: 0,
      duration: 380, ease: 'Cubic.easeOut',
      onComplete: () => pulse.destroy(),
    });
    if (this.cache.audio.exists('sfx_levelup')) {
      this.sound.play('sfx_levelup', { volume: 0.4, detune: this.weaponStacks * 100 });
    }
  }

  // 2026-05-06 — tier-dependent drop multiplier. Higher-tier weapons
  // are stronger so they drop slightly less. Each step is small ("slightly
  // less than the previous"), and the steps themselves shrink with tier.
  //   Tier 0–4 (base bullets):    1.00 (full base rate)
  //   Tier 5 CHAIN LIGHTNING:     0.85
  //   Tier 6 SHOCK WAVE:          0.72
  //   Tier 7 BLACK HOLE:          0.60
  //   Tier 8 HOMING SWARM:        0.50
  _dropMultiplierForTier(tier) {
    switch (tier | 0) {
      case 5: return 0.85;
      case 6: return 0.72;
      case 7: return 0.60;
      case 8: return 0.50;
      default: return 1.00;
    }
  }

  _spawnWeaponUpgradeAt(x, y, tierMultiplier = 1) {
    // 2026-05-05 — drop rate scales with wave so late waves get more pickups.
    // Wave 1: ~25%, wave 2: ~32%, wave 5: ~50%.
    // 2026-05-06 — multiplied by per-weapon-tier modifier (lower for AOE
    // weapons, lowest for Homing Swarm) so AOE doesn't trivially farm
    // upgrades. Caller passes their tier's multiplier.
    const dropRate = (0.22 + gameState.currentWave * 0.06) * tierMultiplier;
    if (Math.random() > dropRate) return;

    // Pick a tier from those unlocked at current wave
    const w = gameState.currentWave;
    const unlocked = Object.entries(WEAPON_TIERS)
      .filter(([k, v]) => Number(k) >= 1 && v.minWave <= w)
      .map(([k]) => Number(k));
    if (unlocked.length === 0) unlocked.push(1);
    const tier = Phaser.Utils.Array.GetRandom(unlocked);
    const meta = WEAPON_TIERS[tier];

    const pickup = this.physics.add.sprite(x, y, '_invisible');
    pickup.setSize(24, 24);
    pickup.upgradeTier = tier;
    const g = this.add.graphics();
    // Outer ring
    g.lineStyle(2, meta.colorHex, 1);
    g.strokeCircle(0, 0, 13);
    // Inner ring (filled solid for visual weight)
    g.fillStyle(meta.innerHex, 0.45);
    g.fillCircle(0, 0, 9);
    // Tier-symbol — distinct glyph per tier
    g.lineStyle(2, meta.colorHex, 1);
    if (tier === 1) {
      // 2 horizontal lines = double
      g.lineBetween(-6, -2, 6, -2);
      g.lineBetween(-6, 2, 6, 2);
    } else if (tier === 2) {
      // 3 lines forming a Y = triple
      g.lineBetween(0, -6, -5, 5);
      g.lineBetween(0, -6, 5, 5);
      g.lineBetween(0, -6, 0, 6);
    } else if (tier === 3) {
      // 4 lines fanning = quad
      g.lineBetween(0, -6, -6, 4);
      g.lineBetween(0, -6, -2, 5);
      g.lineBetween(0, -6, 2, 5);
      g.lineBetween(0, -6, 6, 4);
    } else if (tier === 5) {
      // Lightning bolt for CHAIN LIGHTNING
      g.lineBetween(-3, -7, 1, -1);
      g.lineBetween(1, -1, -2, 1);
      g.lineBetween(-2, 1, 3, 7);
    } else if (tier === 6) {
      // Rocket icon — body + nose + tail
      g.fillStyle(meta.colorHex, 1);
      g.fillRect(-2, -6, 4, 8);
      g.fillTriangle(-3, -6, 3, -6, 0, -10);
      g.fillTriangle(-2, 2, 2, 2, 0, 6);
      g.lineStyle(1, 0xffffaa, 0.8);
      g.lineBetween(0, 6, 0, 9);
    } else if (tier === 7) {
      // BLACK HOLE — dark core with swirl rings
      g.fillStyle(0x000000, 1);
      g.fillCircle(0, 0, 4);
      g.lineStyle(1.5, meta.colorHex, 1);
      g.strokeCircle(0, 0, 5);
      g.lineStyle(1, 0xaa66ff, 0.7);
      g.strokeCircle(0, 0, 7);
    } else if (tier === 8) {
      // HOMING SWARM — 3 little arrows fanning out
      g.lineStyle(1.5, meta.colorHex, 1);
      g.lineBetween(0, 0, -5, -6);
      g.lineBetween(-5, -6, -3, -6);
      g.lineBetween(0, 0, 5, -6);
      g.lineBetween(5, -6, 3, -6);
      g.lineBetween(0, 0, 0, -7);
      g.lineBetween(0, -7, 1, -6);
    }
    pickup.graphics = g;
    pickup.spawnedAt = this.time.now;
    if (!this.weaponPickups) this.weaponPickups = this.physics.add.group();
    this.weaponPickups.add(pickup);
    if (!this._weaponPickupOverlap) {
      this._weaponPickupOverlap = this.physics.add.overlap(
        gameState.player, this.weaponPickups,
        (player, pu) => {
          if (pu.graphics) pu.graphics.destroy();
          this._grantWeaponUpgrade(pu.upgradeTier);
          pu.destroy();
        }, null, this
      );
    }
    pickup.setVelocity((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60);
    // Auto-destroy after 8s
    this.time.delayedCall(8000, () => {
      if (pickup && pickup.active) {
        if (pickup.graphics) pickup.graphics.destroy();
        pickup.destroy();
      }
    });
  }
  
  bulletHitEnemy(bullet, enemy) {
    if (!enemy.active || !bullet.active) return;
    // Pierce: don't re-damage an enemy this same bullet already hit
    if (bullet._hitSet && bullet._hitSet.has(enemy)) return;

    // BOSS 2 (Hex Swarm) — core is invulnerable until all 6 satellites die.
    // Show shield-impact spark at the boss instead.
    if (enemy.enemyType === 'boss_2' && enemy.satellites && enemy.satellites.some(s => s && s.active)) {
      // Visual feedback so the player knows shields are up
      const spark = this.add.graphics().setDepth(200);
      spark.lineStyle(2, 0xffaaff, 1);
      spark.strokeCircle(0, 0, 36);
      spark.x = enemy.x; spark.y = enemy.y;
      this.tweens.add({
        targets: spark, alpha: 0, scale: 1.3,
        duration: 240, onComplete: () => spark.destroy(),
      });
      // Bullet still consumed (unless pierce)
      if (bullet.pierce > 0) {
        bullet.pierce--;
        if (!bullet._hitSet) bullet._hitSet = new Set();
        bullet._hitSet.add(enemy);
        return;
      }
      if (bullet.graphics) bullet.graphics.destroy();
      bullet.destroy();
      return;
    }

    // 2026-05-05 weapon overhaul — bullet damage scales with stacks; pierce
    // bullets do not destroy on hit until pierce count exhausted.
    const dmg = bullet.damage || 1;
    enemy.hp -= dmg;

    if (enemy.hp <= 0) {
      // Score
      const points = enemy.points * gameState.multiplier;
      gameState.score += points;
      gameState.multiplier = Math.min(gameState.multiplier + 1, 99);
      VS_ACHIEVE.onKill();

      // Update HUD with juice
      this.scoreText.setText(`Score: ${gameState.score}`);
      this.multiplierText.setText(`x${gameState.multiplier}`);
      this.tweens.add({
        targets: this.multiplierText,
        scaleX: 2,
        scaleY: 2,
        duration: 100,
        yoyo: true
      });
      
      // 2026-05-05 GAME-FEEL polish — every kill must FEEL impactful.
      // Combination of camera shake + hit-stop + score-popup + bloom flash
      // is the canonical Vlambeer "Art of Screenshake" recipe.

      // Explosion particles
      this.explosionEmitter.explode(20, enemy.x, enemy.y);

      // Camera shake — intensity scales with multiplier (capped to avoid nausea).
      // 2026-05-05 — dialed back per user feedback ("just a bit less, it's too
      // much"). Was 0.005-0.015 / 80ms; now 0.0025-0.008 / 60ms — more subtle
      // per-kill bump that still escalates with multiplier but doesn't dominate.
      const shakeIntensity = Math.min(0.0025 + gameState.multiplier * 0.00025, 0.008);
      this.cameras.main.shake(60, shakeIntensity);

      // 2026-05-05 — Hit-stop FREEZE BUG fix. Old code captured `oldTimeScale`
      // at kill-time, then restored it 50ms later. With multiple kills in the
      // same frame (chain explosion, rocket AOE, bomb), kill #2 captured
      // timeScale=5 (already slowed by kill #1), set 5, scheduled restore-to-5.
      // After 50ms, the LAST callback won the race and pinned timeScale at 5
      // FOREVER → entire game stuck in slow-motion. Looked like a freeze, was
      // actually 5x slowdown. Fix: guard with _hitStopActive flag — only ONE
      // hit-stop can be active at a time, and the restore always sets back to 1.
      if (!this._hitStopActive) {
        this._hitStopActive = true;
        this.physics.world.timeScale = 5;
        this.time.delayedCall(50, () => {
          this.physics.world.timeScale = 1;
          this._hitStopActive = false;
        });
      }

      // 2026-05-05 PERF — Score popups capped to 6 concurrent. With QUAD+stack
      // weapons + chain lightning + AOE explosions, dozens of kills per second
      // were spawning Text+tween objects per kill, causing the choppy freezes
      // the user reported. Skip when capped — visual fidelity stays high
      // because the multiplier number on the HUD already pulses on every kill.
      if (!this._scorePopups) this._scorePopups = [];
      this._scorePopups = this._scorePopups.filter(p => p && p.active);
      if (this._scorePopups.length < 6) {
        const popText = `+${enemy.points * gameState.multiplier}`;
        const popup = this.add.text(enemy.x, enemy.y, popText, {
          font: 'bold 18px Arial',
          color: gameState.multiplier > 10 ? '#ffff44' : '#00ffff',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(200);
        this._scorePopups.push(popup);
        this.tweens.add({
          targets: popup,
          y: popup.y - 50,
          alpha: 0,
          scale: 1.4,
          duration: 700,
          ease: 'Cubic.easeOut',
          onComplete: () => popup.destroy(),
        });
      }

      // Wave-scaled drop, multiplied by the firing weapon's tier
      // multiplier (tier 8 Homing Swarm drops least; base bullets full).
      // Skip shards / gravity wells (would make pinwheel deaths trivial)
      // and boss satellites (6 of them per fight = drop spam).
      if (enemy.enemyType !== 'shard'
          && enemy.enemyType !== 'gravity_well'
          && enemy.enemyType !== 'boss_satellite') {
        const mul = this._dropMultiplierForTier(bullet?.weaponTier ?? 0);
        this._spawnWeaponUpgradeAt(enemy.x, enemy.y, mul);
      }

      // Special death effects — split-on-death enemies. 2026-05-05 USER FIX:
      // these "split children" (pinwheel shards, mini-jellies, cluster pieces)
      // used the default `shard` enemyType which CHASES the player ("missile-
      // guided ball follows me"). They now use enemyType='drift' which keeps
      // their initial outward velocity and self-destructs after 2.5s — they're
      // pure debris hazards, not heat-seekers.
      if (enemy.enemyType === 'pinwheel') {
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2;
          this._spawnDriftDebris(enemy.x, enemy.y, angle, 150, 0xffaa00, 25, (g) => {
            g.strokeRect(-5, -5, 10, 10);
          });
        }
      } else if (enemy.enemyType === 'jelly') {
        for (let i = 0; i < 3; i++) {
          const angle = i * (Math.PI * 2 / 3) + Math.random() * 0.4;
          this._spawnDriftDebris(enemy.x, enemy.y, angle, 130, 0xffaa44, 50, (g) => {
            g.lineStyle(2, 0xffaa44, 1);
            g.strokeCircle(0, 0, 6);
          });
        }
      } else if (enemy.enemyType === 'cluster') {
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2 + Math.random() * 0.3;
          this._spawnDriftDebris(enemy.x, enemy.y, angle, 180, 0xffff88, 75, (g) => {
            g.lineStyle(2, 0xffff88, 1);
            g.strokePoints([
              { x: 0, y: -5 }, { x: 4, y: 4 }, { x: -4, y: 4 },
            ], true);
          });
        }
      }

      // BOSS DEATH — trigger world-clear sequence
      const wasBoss = enemy.bossId !== undefined;
      const wasBossSatellite = enemy.enemyType === 'boss_satellite';

      // Clean up (via helper — handles segments, graphics.glow, gravity-well registry)
      this._killEnemy(enemy);

      // Kill sound
      this.killSounds[this.killSoundIndex].play();
      this.killSoundIndex = (this.killSoundIndex + 1) % this.killSounds.length;

      // Boss-specific post-death routing
      if (wasBoss) {
        VS_ACHIEVE.onBossDefeat();
        this._onBossDefeated();
      } else if (wasBossSatellite && this.boss && this.boss.satellites) {
        // Remove from satellite list
        const idx = this.boss.satellites.indexOf(enemy);
        if (idx >= 0) this.boss.satellites[idx] = null;
        // All satellites dead? speed up the boss
        const remaining = this.boss.satellites.filter(s => s && s.active).length;
        if (remaining === 0) {
          this.boss.speed *= 1.8;
          this._showBigBanner('SHIELDS DOWN', '#ffff44', 900);
        }
      }
    }

    // PIERCE bullets penetrate up to N enemies before being destroyed.
    if (bullet.pierce > 0) {
      bullet.pierce--;
      // Track which enemies already hit so the same enemy isn't re-counted
      // across overlap frames (Phaser overlap can fire repeatedly).
      if (!bullet._hitSet) bullet._hitSet = new Set();
      bullet._hitSet.add(enemy);
      return; // keep the bullet alive
    }

    // CHAIN LIGHTNING — on impact, bolt jumps to nearby enemies. Each chain
    // deals 60% of the previous link's damage. Visual: lime zigzag bolts.
    if (bullet.chainJumps > 0) {
      this._chainLightning(enemy, bullet.chainJumps, bullet.damage);
    }

    // ROCKET — explodes on impact. Damage all enemies inside rocketRadius.
    // Visual: large red damage ring + white flash + screen shake.
    if (bullet.rocketRadius > 0) {
      this._rocketExplode(bullet.x, bullet.y, bullet.rocketRadius, bullet.damage);
    }

    // BLACK HOLE — on impact, spawn a persistent vortex at impact point.
    if (bullet.blackHoleProjectile) {
      this._spawnBlackHole(bullet.x, bullet.y, bullet.blackHoleStacks || 0);
    }

    // HOMING — small explosion on impact (smaller than rocket but AOE)
    if (bullet.homing) {
      this._rocketExplode(bullet.x, bullet.y, 55, bullet.damage * 0.7);
    }

    // Destroy bullet
    if (bullet.graphics) bullet.graphics.destroy();
    bullet.destroy();
  }

  // 2026-05-05 — Chain lightning helper. From the initial hit enemy, find the
  // nearest other-enemy within 220px, draw a brief lightning bolt, deal 60%
  // damage. Recurse jumpsLeft times. Each link can't re-hit the same enemy.
  // 2026-05-05 — CHAIN LIGHTNING fire path. INSTANT ZAP from player to
  // nearest enemy in a forward 120° arc within 480px. Damage applied on
  // hit, then recurses via _chainLightning to bounce to N more targets.
  // No projectile, no travel time. Slightly stronger than the bullet
  // version (3+stacks dmg, 3+stacks jumps) per user "needs to be teenier
  // bit stronger" feedback.
  // 2026-05-06 — SHOCK WAVE (tier 6, replaces ROCKET).
  // Emits a fast-expanding ring centered on the player. Every enemy that
  // intersects the ring's growing radius takes damage exactly once. Stacks
  // grow both the final radius and the per-hit damage.
  _fireShockWave(stacks) {
    const px = gameState.player.x;
    const py = gameState.player.y;
    const maxRadius = 200 + stacks * 60;          // 200/260/320/380/440 by stack
    const damage   = 3 + stacks * 1.2;            // 3.0/4.2/5.4/6.6/7.8
    const duration = 320 + stacks * 30;           // ms
    const ring = this.add.graphics().setDepth(170);
    const inner = this.add.graphics().setDepth(171);
    const hitSet = new Set();
    if (this.cache.audio.exists('sfx_disaster')) {
      this.sound.play('sfx_disaster', { volume: 0.4, detune: 600 });
    }
    this.cameras.main.shake(120, 0.004);
    // 60Hz tick growing the ring radius. Each tick checks for fresh
    // enemy intersections (any enemy within current radius that we
    // haven't already damaged this wave).
    const startMs = this.time.now;
    const tickEvent = this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        const elapsed = this.time.now - startMs;
        const t = Math.min(1, elapsed / duration);
        const r = maxRadius * t;
        ring.clear();
        ring.lineStyle(6, 0xffaa00, 1 - t * 0.6);
        ring.strokeCircle(px, py, r);
        inner.clear();
        inner.lineStyle(2, 0xffff66, 1 - t);
        inner.strokeCircle(px, py, r * 0.94);
        for (const e of gameState.enemies) {
          if (!e || !e.active || hitSet.has(e)) continue;
          const dx = e.x - px, dy = e.y - py;
          if (Math.hypot(dx, dy) <= r) {
            hitSet.add(e);
            e.hp -= damage;
            // Knock-back from origin
            if (e.body && typeof e.body.setVelocity === "function") {
              const ang = Math.atan2(dy, dx);
              e.body.setVelocity(Math.cos(ang) * 220, Math.sin(ang) * 220);
            }
            if (e.hp <= 0) {
              // 2026-05-06 — boss/satellite routing. Without this the
              // SHOCK WAVE could kill Hex Swarm / Octaedron / Prism Core
              // and the game would soft-lock at "Wave N - BOSS" because
              // _onBossDefeated never fired. Mirrors the bullet kill path.
              const wasBoss = e.bossId !== undefined;
              const wasBossSatellite = e.enemyType === 'boss_satellite';
              const eX = e.x, eY = e.y, eType = e.enemyType;
              const points = (e.points || 0) * gameState.multiplier;
              gameState.score += points;
              if (this.scoreText) this.scoreText.setText(`Score: ${gameState.score}`);
              this.explosionEmitter.explode(14, eX, eY);
              this._killEnemy(e);
              if (wasBoss) {
                if (typeof VS_ACHIEVE !== "undefined" && VS_ACHIEVE.onBossDefeat) {
                  VS_ACHIEVE.onBossDefeat();
                }
                this._onBossDefeated();
              } else if (wasBossSatellite && this.boss && this.boss.satellites) {
                const idx = this.boss.satellites.indexOf(e);
                if (idx >= 0) this.boss.satellites[idx] = null;
                const remaining = this.boss.satellites.filter(s => s && s.active).length;
                if (remaining === 0) {
                  this.boss.speed *= 1.8;
                  this._showBigBanner('SHIELDS DOWN', '#ffff44', 900);
                }
              }
              // Tier 6 SHOCK WAVE drop roll (~72% of base wave-scaled rate).
              if (eType !== 'shard' && eType !== 'gravity_well' && eType !== 'boss_satellite') {
                this._spawnWeaponUpgradeAt(eX, eY, this._dropMultiplierForTier(6));
              }
            }
          }
        }
        if (t >= 1) {
          tickEvent.destroy();
          this.tweens.add({
            targets: [ring, inner], alpha: 0, duration: 100,
            onComplete: () => { ring.destroy(); inner.destroy(); },
          });
        }
      },
    });
  }

  // 2026-05-06 — BLACK HOLE (tier 7).
  // Player-centric singularity: a swirling vortex anchored at the ship
  // for `duration` ms. While active:
  //   - All enemies within `pullRadius` are dragged toward the player.
  //   - Enemies inside `damageRadius` take damage every tick.
  //   - The player is INVULNERABLE for the entire vortex lifetime.
  // Stacks scale every dimension: radius, damage, duration. Fire rate
  // (handled in the firing loop) drops dramatically with stacks too —
  // base 700ms cooldown, faster per stack.
  _fireBlackHole(stacks) {
    const px = gameState.player.x;
    const py = gameState.player.y;
    const pullRadius   = 320 + stacks * 90;       // 320/410/500/590/680
    const damageRadius = 140 + stacks * 35;
    const damagePerTick= 0.6 + stacks * 0.3;      // applied every 100ms
    const duration     = 1600 + stacks * 350;     // 1.6s base, +0.35s per stack
    if (this.cache.audio.exists('sfx_disaster')) {
      this.sound.play('sfx_disaster', { volume: 0.45, detune: -700 });
    }
    this.cameras.main.shake(180, 0.005);

    // ── Make the player invincible for the duration ──
    const player = gameState.player;
    if (player) {
      player.invulnerable = true;
      // tint to signal protected state (purple matches the BH color)
      try { player.setTint(0x8844ff); } catch (_e) {}
    }

    // ── Vortex visuals: 3 nested swirling rings ──
    const ringG = this.add.graphics().setDepth(160);
    const startMs = this.time.now;
    const tickMs = 100;
    let nextDamageAt = startMs;
    const tickEvent = this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        const elapsed = this.time.now - startMs;
        const t = Math.min(1, elapsed / duration);
        // Vortex visual — center darkens, rings rotate inward
        ringG.clear();
        const cx = gameState.player ? gameState.player.x : px;
        const cy = gameState.player ? gameState.player.y : py;
        ringG.fillStyle(0x1a0033, 0.55 * (1 - t));
        ringG.fillCircle(cx, cy, damageRadius * 0.5);
        for (let i = 0; i < 3; i++) {
          const phase = (this.time.now * 0.004 + i * 1.2);
          const rad = damageRadius * (0.5 + 0.3 * i) + Math.sin(phase) * 6;
          ringG.lineStyle(2 + i, 0x8844ff, (0.7 - i * 0.18) * (1 - t * 0.6));
          ringG.strokeCircle(cx, cy, rad);
        }

        // Pull + damage enemies
        for (const e of gameState.enemies) {
          if (!e || !e.active) continue;
          const dx = cx - e.x, dy = cy - e.y;
          const dist = Math.hypot(dx, dy);
          if (dist > pullRadius || dist < 1) continue;
          // Boss-class enemies resist pull (only minor drift)
          const isBoss = e.bossId !== undefined;
          const pull = (isBoss ? 60 : 280) * (1 - dist / pullRadius);
          if (e.body && typeof e.body.setVelocity === "function") {
            const ang = Math.atan2(dy, dx);
            const vx = (e.body.velocity.x || 0) + Math.cos(ang) * pull * 0.05;
            const vy = (e.body.velocity.y || 0) + Math.sin(ang) * pull * 0.05;
            e.body.setVelocity(vx, vy);
          }
        }

        // Damage tick
        if (this.time.now >= nextDamageAt) {
          nextDamageAt = this.time.now + tickMs;
          for (const e of gameState.enemies) {
            if (!e || !e.active) continue;
            const dx = cx - e.x, dy = cy - e.y;
            if (Math.hypot(dx, dy) > damageRadius) continue;
            e.hp -= damagePerTick;
            if (e.hp <= 0) {
              const wasBoss = e.bossId !== undefined;
              const wasBossSatellite = e.enemyType === 'boss_satellite';
              const eX = e.x, eY = e.y, eType = e.enemyType;
              const points = (e.points || 0) * gameState.multiplier;
              gameState.score += points;
              if (this.scoreText) this.scoreText.setText(`Score: ${gameState.score}`);
              this.explosionEmitter.explode(10, eX, eY);
              this._killEnemy(e);
              if (wasBoss) {
                if (typeof VS_ACHIEVE !== "undefined" && VS_ACHIEVE.onBossDefeat) VS_ACHIEVE.onBossDefeat();
                this._onBossDefeated();
              } else if (wasBossSatellite && this.boss && this.boss.satellites) {
                const idx = this.boss.satellites.indexOf(e);
                if (idx >= 0) this.boss.satellites[idx] = null;
              }
              // Tier 7 BLACK HOLE drop roll (~60% of base wave-scaled rate).
              if (eType !== 'shard' && eType !== 'gravity_well' && eType !== 'boss_satellite') {
                this._spawnWeaponUpgradeAt(eX, eY, this._dropMultiplierForTier(7));
              }
            }
          }
        }

        if (t >= 1) {
          tickEvent.destroy();
          ringG.destroy();
          // Restore player vulnerability (unless someone else holds it)
          if (player && player.active) {
            player.invulnerable = false;
            try { player.clearTint(); } catch (_e) {}
          }
        }
      },
    });
  }

  _fireChainZap(baseAngle, stacks) {
    const px = gameState.player.x;
    const py = gameState.player.y;
    // 2026-05-06 — Initial range scales with score multiplier so a high-streak
    // player can lock onto enemies way further out. Base 480px, +20px per
    // multiplier point, capped at 1100px (almost full arena width). Stacks
    // ALSO add a small range bonus.
    const multBonus = Math.min(60, gameState.multiplier) * 20;
    const stackBonus = stacks * 35;
    let target = null;
    let nearestDist = 480 + multBonus + stackBonus;
    const arcCos = Math.cos(Math.PI / 3); // 60deg
    for (const e of gameState.enemies) {
      if (!e || !e.active) continue;
      const dx = e.x - px;
      const dy = e.y - py;
      const dist = Math.hypot(dx, dy);
      if (dist > nearestDist || dist < 1) continue;
      const dot = (Math.cos(baseAngle) * dx + Math.sin(baseAngle) * dy) / dist;
      if (dot < arcCos) continue;
      target = e; nearestDist = dist;
    }
    if (!target) {
      // No target — short visible spark in aim direction so the player gets
      // feedback that the weapon fired but missed.
      this._drawZapBolt(px, py, px + Math.cos(baseAngle) * 240, py + Math.sin(baseAngle) * 240, 0.5);
      return;
    }
    // Damage the primary target
    const baseDamage = 3 + stacks;  // stronger than the old bullet version
    target.hp -= baseDamage;
    this._drawZapBolt(px, py, target.x, target.y, 1);
    // Audio
    if (this.cache.audio.exists('sfx_place')) {
      this.sound.play('sfx_place', { volume: 0.35, detune: 800 });
    }
    if (target.hp <= 0 && target.active) {
      const tX = target.x, tY = target.y, tType = target.enemyType;
      const points = (target.points || 0) * gameState.multiplier;
      gameState.score += points;
      this.scoreText.setText(`Score: ${gameState.score}`);
      this.explosionEmitter.explode(12, tX, tY);
      this._killEnemy(target);
      // Tier 5 CHAIN LIGHTNING drop roll (~85% of base wave-scaled rate).
      if (tType !== 'shard' && tType !== 'gravity_well' && tType !== 'boss_satellite') {
        this._spawnWeaponUpgradeAt(tX, tY, this._dropMultiplierForTier(5));
      }
    }
    // Then chain from this target to nearby enemies
    this._chainLightning(target, 3 + stacks, baseDamage * 0.7);
  }

  // Draw a single zigzag lightning bolt from (x1,y1) to (x2,y2). Same
  // style as _chainLightning's bolts but available standalone for the
  // initial player→target zap.
  _drawZapBolt(x1, y1, x2, y2, intensity = 1) {
    if (this._activeChainBolts === undefined) this._activeChainBolts = 0;
    if (this._activeChainBolts >= 12) return;  // perf cap
    this._activeChainBolts++;
    const bolt = this.add.graphics().setDepth(180);
    bolt.lineStyle(3, 0x88ff44, intensity);
    const mx1 = x1 + (x2 - x1) * 0.33 + (Math.random() - 0.5) * 22;
    const my1 = y1 + (y2 - y1) * 0.33 + (Math.random() - 0.5) * 22;
    const mx2 = x1 + (x2 - x1) * 0.66 + (Math.random() - 0.5) * 22;
    const my2 = y1 + (y2 - y1) * 0.66 + (Math.random() - 0.5) * 22;
    bolt.lineBetween(x1, y1, mx1, my1);
    bolt.lineBetween(mx1, my1, mx2, my2);
    bolt.lineBetween(mx2, my2, x2, y2);
    // Bright glow line on top
    bolt.lineStyle(1, 0xffffff, intensity * 0.9);
    bolt.lineBetween(x1, y1, mx1, my1);
    bolt.lineBetween(mx1, my1, mx2, my2);
    bolt.lineBetween(mx2, my2, x2, y2);
    this.tweens.add({
      targets: bolt, alpha: 0, duration: 160,
      onComplete: () => {
        this._activeChainBolts = Math.max(0, this._activeChainBolts - 1);
        bolt.destroy();
      },
    });
  }

  _chainLightning(srcEnemy, jumpsLeft, damage, alreadyHit) {
    if (jumpsLeft <= 0) return;
    const visited = alreadyHit || new Set([srcEnemy]);
    let nearest = null;
    let nearestDist = 220;
    for (const e of gameState.enemies) {
      if (!e || !e.active || visited.has(e)) continue;
      const d = Math.hypot(e.x - srcEnemy.x, e.y - srcEnemy.y);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    if (!nearest) return;
    visited.add(nearest);

    // 2026-05-05 PERF — Cap concurrent visible bolts to 12. With chain x4
    // stacks (6 jumps each) + 30+ bullets hitting per frame in dense waves,
    // the previous code spawned 180+ Graphics objects + tweens in a single
    // frame. The damage still applies — only the visual is throttled.
    if (this._activeChainBolts === undefined) this._activeChainBolts = 0;
    if (this._activeChainBolts < 12) {
      this._activeChainBolts++;
      const bolt = this.add.graphics().setDepth(180);
      bolt.lineStyle(3, 0x88ff44, 1);
      const mx1 = srcEnemy.x + (nearest.x - srcEnemy.x) * 0.33 + (Math.random() - 0.5) * 30;
      const my1 = srcEnemy.y + (nearest.y - srcEnemy.y) * 0.33 + (Math.random() - 0.5) * 30;
      const mx2 = srcEnemy.x + (nearest.x - srcEnemy.x) * 0.66 + (Math.random() - 0.5) * 30;
      const my2 = srcEnemy.y + (nearest.y - srcEnemy.y) * 0.66 + (Math.random() - 0.5) * 30;
      bolt.lineBetween(srcEnemy.x, srcEnemy.y, mx1, my1);
      bolt.lineBetween(mx1, my1, mx2, my2);
      bolt.lineBetween(mx2, my2, nearest.x, nearest.y);
      this.tweens.add({
        targets: bolt, alpha: 0, duration: 180,
        onComplete: () => {
          this._activeChainBolts = Math.max(0, this._activeChainBolts - 1);
          bolt.destroy();
        },
      });
    }
    // Apply damage
    const chainDmg = damage * 0.6;
    nearest.hp -= chainDmg;
    if (nearest.hp <= 0 && nearest.active) {
      const nX = nearest.x, nY = nearest.y, nType = nearest.enemyType;
      // Score + score popup
      const points = (nearest.points || 0) * gameState.multiplier;
      gameState.score += points;
      this.scoreText.setText(`Score: ${gameState.score}`);
      this.explosionEmitter.explode(12, nX, nY);
      this._killEnemy(nearest);
      // Tier 5 chain-jump kills also drop at the CL multiplier.
      if (nType !== 'shard' && nType !== 'gravity_well' && nType !== 'boss_satellite') {
        this._spawnWeaponUpgradeAt(nX, nY, this._dropMultiplierForTier(5));
      }
    }
    // Recurse
    this._chainLightning(nearest, jumpsLeft - 1, chainDmg, visited);
  }

  // 2026-05-05 — Rocket explosion. AOE damage at impact, big visual.
  _rocketExplode(x, y, radius, damage) {
    // Visible expanding ring
    this._emitDamageRing(x, y, 0xff3322, radius);
    // White flash core
    const core = this.add.graphics().setDepth(190);
    core.fillStyle(0xffffaa, 0.9);
    core.fillCircle(0, 0, radius * 0.4);
    core.x = x; core.y = y;
    this.tweens.add({
      targets: core, alpha: 0, scale: 1.6,
      duration: 280, ease: 'Cubic.easeOut',
      onComplete: () => core.destroy(),
    });
    // Screen shake — proportional to radius
    this.cameras.main.shake(220, Math.min(0.018, 0.008 + radius * 0.00006));
    // Damage all enemies within radius
    for (const e of gameState.enemies.slice()) {
      if (!e || !e.active) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > radius) continue;
      // Falloff: full damage at center, 50% at edge
      const dmg = damage * (1 - 0.5 * (d / radius));
      e.hp -= dmg;
      if (e.hp <= 0) {
        const points = (e.points || 0) * gameState.multiplier;
        gameState.score += points;
        this.scoreText.setText(`Score: ${gameState.score}`);
        this.explosionEmitter.explode(10, e.x, e.y);
        this._killEnemy(e);
      }
    }
    // Audio
    if (this.cache.audio.exists('sfx_disaster')) {
      this.sound.play('sfx_disaster', { volume: 0.5, detune: -400 });
    }
  }

  // 2026-05-05 — Find nearest active enemy (used for homing-missile lock-on).
  _findNearestEnemy(x, y) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of gameState.enemies) {
      if (!e || !e.active) continue;
      const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    return nearest;
  }

  // 2026-05-05 — BLACK HOLE entity. Persistent (2.5s + stacks*0.5s) vortex
  // that pulls all enemies within radius toward center and damages on tick.
  // Stored in this.blackHoles[] and ticked in update(). Damage per tick scales
  // with stacks; radius grows with stacks.
  _spawnBlackHole(x, y, stacks) {
    if (!this.blackHoles) this.blackHoles = [];
    const radius = 180 + stacks * 40;
    const lifetime = 2500 + stacks * 500;
    const dmgPerTick = 0.6 + stacks * 0.4;
    const pullStrength = 280 + stacks * 60;

    // 2026-05-05 PERF — Black hole visual is now drawn ONCE and animated via
    // Phaser tweens. Previous version did clear()+5 strokeCircle()s every
    // frame for every active black hole, which stacked up badly when multiple
    // were active. Now: pre-draw the rings to a Graphics object, then tween
    // rotation + scale natively (single GPU upload, no tessellation per frame).
    const gfx = this.add.graphics().setDepth(140);
    gfx.fillStyle(0x000000, 0.85);
    gfx.fillCircle(0, 0, 22);
    gfx.lineStyle(2, 0x8844ff, 1);
    gfx.strokeCircle(0, 0, 26);
    gfx.lineStyle(1, 0xaa66ff, 0.7);
    gfx.strokeCircle(0, 0, 40);
    gfx.lineStyle(1, 0xcc88ff, 0.4);
    gfx.strokeCircle(0, 0, radius * 0.7);
    gfx.x = x; gfx.y = y;

    // Continuous rotation (cheap — Phaser tween updates rotation property)
    this.tweens.add({
      targets: gfx, rotation: Math.PI * 2,
      duration: 1800, repeat: -1, ease: 'Linear',
    });
    // Subtle pulse for organic feel
    this.tweens.add({
      targets: gfx, scaleX: 1.08, scaleY: 1.08,
      duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    // Fade out near the end of lifetime
    this.tweens.add({
      targets: gfx, alpha: 0,
      duration: 400, delay: lifetime - 400, ease: 'Cubic.easeOut',
    });

    const bh = {
      gfx, x, y, radius, lifetime,
      birthTime: this.time.now,
      lastTick: this.time.now,
      tickInterval: 200,
      dmgPerTick, pullStrength,
    };
    this.blackHoles.push(bh);
    this.cameras.main.shake(180, 0.012);
    if (this.cache.audio.exists('sfx_disaster')) {
      this.sound.play('sfx_disaster', { volume: 0.5, detune: -800 });
    }
    return bh;
  }
  
  playerHitEnemy(player, enemy) {
    if (player.invulnerable || !enemy.active) return;
    
    // Player death
    gameState.lives--;
    gameState.multiplier = 1;
    this.livesText.setText(`Lives: ${gameState.lives}`);
    this.multiplierText.setText('x1');
    
    // Death effect
    this.cameras.main.shake(500, 0.02);
    this.cameras.main.flash(500, 255, 0, 0);
    
    // Invulnerability
    player.invulnerable = true;
    const blinkTween = this.tweens.add({
      targets: player.shipGraphics,
      alpha: 0,
      duration: 100,
      repeat: 10,
      yoyo: true,
      onComplete: () => {
        player.invulnerable = false;
        player.shipGraphics.alpha = 1;
      }
    });
    
    // Game over check
    if (gameState.lives <= 0) {
      this.gameOver();
    }
    
    this.sound.play('sfx_disaster', { volume: 0.5 });
  }
  
  useBomb() {
    if (gameState.bombs <= 0) return;

    gameState.bombs--;
    this.bombsText.setText(`Bombs: ${gameState.bombs}`);
    VS_ACHIEVE.onBomb();
    
    // Screen flash
    this.cameras.main.flash(300, 255, 255, 255);
    
    // Radial wave effect
    const wave = this.add.graphics();
    wave.x = gameState.player.x;
    wave.y = gameState.player.y;
    wave.lineStyle(4, 0xffffff, 1);
    wave.strokeCircle(0, 0, 10);
    
    this.tweens.add({
      targets: wave,
      scaleX: 50,
      scaleY: 50,
      alpha: 0,
      duration: 500,
      onComplete: () => wave.destroy()
    });
    
    // 2026-05-05 BOMB FIX — bombs used to call _killEnemy() on every enemy
    // including the boss, which destroyed the boss sprite but skipped
    // _onBossDefeated() — leaving bossActive=true forever and softlocking
    // the wave. Now: regular enemies = insta-kill (clear-the-screen), but
    // bosses + satellites take 25% maxHP damage and route through proper
    // death flow if reduced to 0 HP. Bombs are still powerful but no longer
    // bypass the boss fight.
    this.enemyGroup.children.entries.slice().forEach(enemy => {
      if (!enemy.active) return;

      const isBoss = enemy.bossId !== undefined;
      const isSat = enemy.enemyType === 'boss_satellite';

      if (isBoss || isSat) {
        // Hex-Swarm core is shielded while satellites are alive
        if (isBoss && enemy.satellites && enemy.satellites.some(s => s && s.active)) {
          // Visual feedback at boss but no damage to core
          const spark = this.add.graphics().setDepth(200);
          spark.lineStyle(2, 0xffffff, 1);
          spark.strokeCircle(0, 0, 36);
          spark.x = enemy.x; spark.y = enemy.y;
          this.tweens.add({
            targets: spark, alpha: 0, scale: 1.6,
            duration: 220, onComplete: () => spark.destroy(),
          });
          return;
        }
        const dmg = (enemy.maxHp || enemy.hp) * 0.25;
        enemy.hp -= dmg;
        // Hit-flash on the boss
        const spark = this.add.graphics().setDepth(200);
        spark.lineStyle(3, 0xffffff, 1);
        spark.strokeCircle(0, 0, 30);
        spark.x = enemy.x; spark.y = enemy.y;
        this.tweens.add({
          targets: spark, alpha: 0, scale: 2,
          duration: 280, onComplete: () => spark.destroy(),
        });
        if (enemy.hp <= 0) {
          const points = (enemy.points || 0) * gameState.multiplier;
          gameState.score += points;
          this.explosionEmitter.explode(24, enemy.x, enemy.y);
          this._killEnemy(enemy);
          if (isBoss) {
            this._onBossDefeated();
          } else if (isSat && this.boss && this.boss.satellites) {
            const idx = this.boss.satellites.indexOf(enemy);
            if (idx >= 0) this.boss.satellites[idx] = null;
            const remaining = this.boss.satellites.filter(s => s && s.active).length;
            if (remaining === 0) {
              this.boss.speed *= 1.8;
              this._showBigBanner('SHIELDS DOWN', '#ffff44', 900);
            }
          }
        }
        return;
      }

      // Regular enemy — clear-the-screen behavior (unchanged)
      const points = (enemy.points || 0) * gameState.multiplier;
      gameState.score += points;
      this.explosionEmitter.explode(20, enemy.x, enemy.y);
      this._killEnemy(enemy);
    });

    gameState.gravityWells = [];
    
    this.scoreText.setText(`Score: ${gameState.score}`);
    this.sound.play('sfx_complete', { volume: 0.6 });
  }
  
  gameOver() {
    // 2026-05-05 — set explicit flag so _togglePause and burst-spawn callbacks
    // can check `this._gameOverFired` instead of the unreliable `this.gameOver`
    // (which is the method itself — always truthy as a function reference).
    this._gameOverFired = true;
    // Submit final score to portal leaderboard (no-op outside iframe).
    if (window.ForgeFlow) window.ForgeFlow.gameOver(gameState.score);
    // Update high score
    if (gameState.score > gameState.highScore) {
      gameState.highScore = gameState.score;
      localStorage.setItem('vectorStormHighScore', gameState.highScore.toString());
    }
    if (this.bgMusic) this.bgMusic.stop();
    this.scene.start('GameOver');
  }
  
  update(time, delta) {
    if (!gameState.player || !gameState.player.alive) return;
    // Pause gate — blocks all gameplay updates while P-toggle is active.
    if (this.paused) return;

    // Manual next-wave (N key) — skips the timer. Rules:
    //   - You can only skip TO a wave you've REACHED before (maxWaveReached).
    //     This is a "save" gate so a fresh save can't blast to wave 9.
    //   - Cannot skip during a boss fight — must defeat the boss properly.
    //   - Enemies PERSIST (no clear) so difficulty stacks naturally.
    //   - No new burst on skip — drip uses the new wave's roster + scaling,
    //     so the screen ramps up to that wave's intensity gradually.
    if (Phaser.Input.Keyboard.JustDown(this.cursors.n)
        && !this.waveSkipped && gameState.currentWave <= 9
        && !this.bossActive && !this._bossDeathPending
        && gameState.currentWave + 1 <= gameState.maxWaveReached) {
      this.waveSkipped = true;
      this._skipRequested = true;
      this._advanceWave();
      return;
    } else if (Phaser.Input.Keyboard.JustDown(this.cursors.n)
        && !this.waveSkipped
        && gameState.currentWave + 1 > gameState.maxWaveReached) {
      // Show denial flash so the player understands why nothing happened
      const denial = this.add.text(640, 360,
        `Reach wave ${gameState.currentWave + 1} first`,
        { font: 'bold 24px Arial', color: '#ff6644', stroke: '#000000', strokeThickness: 3 }
      ).setOrigin(0.5).setDepth(500);
      this.tweens.add({
        targets: denial, alpha: 0, y: denial.y - 30,
        duration: 1200, ease: 'Cubic.easeOut',
        onComplete: () => denial.destroy(),
      });
      this.waveSkipped = true;
      this.time.delayedCall(800, () => { this.waveSkipped = false; });
      return;
    }

    // Update player position to follow graphics
    if (gameState.player.shipGraphics) {
      gameState.player.shipGraphics.x = gameState.player.x;
      gameState.player.shipGraphics.y = gameState.player.y;
    }

    // Update weapon-upgrade pickups: graphics follow physics body.
    // 2026-05-06 — defensive guard. After a scene shutdown the previous
    // run's weaponPickups group reference was being read with `.children`
    // pointing at a destroyed list → TypeError on `entries.forEach`,
    // which Phaser caught + froze the loop ("clicking TRY AGAIN freezes"
    // user report). Null check + optional chaining stops the crash; the
    // missing reset is also fixed in init() below.
    if (this.weaponPickups && this.weaponPickups.children && this.weaponPickups.children.entries) {
      this.weaponPickups.children.entries.forEach(p => {
        if (p.graphics && p.active) {
          p.graphics.x = p.x;
          p.graphics.y = p.y;
          // Pulse alpha so they're visible on the dark background
          p.graphics.alpha = 0.6 + 0.4 * Math.sin(time * 0.005);
        }
      });
    }
    
    // Player movement
    const speed = gameState.player.speed;
    let vx = 0, vy = 0;
    
    if (this.cursors.a.isDown) vx = -speed;
    if (this.cursors.d.isDown) vx = speed;
    if (this.cursors.w.isDown) vy = -speed;
    if (this.cursors.s.isDown) vy = speed;
    
    // Diagonal movement normalization
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
    }
    
    gameState.player.setVelocity(vx, vy);
    
    // Rotate ship to face mouse
    const pointer = this.input.activePointer;
    const angle = angleToTarget(gameState.player, pointer);
    if (gameState.player.shipGraphics) {
      gameState.player.shipGraphics.rotation = angle;
    }
    
    // Firing
    // 2026-05-06 — Heavy weapons start slow but RAMP with stacks.
    // Each weapon gets a base cooldown and a per-stack reduction; the
    // floor stops it from going trivially fast at max stacks.
    //   Tier 5 CHAIN LIGHTNING: 200ms base, no scaling (instant zap)
    //   Tier 6 SHOCK WAVE:      400ms base, -50ms / stack, floor 150ms
    //   Tier 7 BLACK HOLE:      700ms base, -90ms / stack, floor 250ms
    //   Tier 8 HOMING SWARM:    200ms base, no scaling (already AOE-ish)
    let effectiveFireRate = this.baseFireRate;
    if (time < this.weaponTierExpiresAt) {
      const stacks = this.weaponStacks || 0;
      if (this.weaponTier === 5)      effectiveFireRate = 200;
      else if (this.weaponTier === 6) effectiveFireRate = Math.max(150, 400 - stacks * 50);
      else if (this.weaponTier === 7) effectiveFireRate = Math.max(250, 700 - stacks * 90);
      else if (this.weaponTier === 8) effectiveFireRate = 200;
    }
    if (this.firing && time > this.lastFireTime + effectiveFireRate) {
      this.fireBullet();
      this.lastFireTime = time;
    }

    // 2026-05-05 — Active weapon HUD readout
    if (this.weaponText && this.weaponBar && this.weaponBarBg) {
      const remaining = this.weaponTierExpiresAt - time;
      if (remaining > 0 && this.weaponTier > 0) {
        const meta = WEAPON_TIERS[this.weaponTier];
        const stackLabel = this.weaponStacks > 0 ? ` x${1 + this.weaponStacks}` : '';
        this.weaponText.setText(`${meta.name}${stackLabel}`);
        this.weaponText.setColor(meta.cssColor);
        // Duration bar — 100px wide, fills based on remaining / 9000ms cap
        const W = 120, H = 6;
        const bx = this.cameras.main.width - 20 - W;
        const by = 48;
        const pct = Math.max(0, Math.min(1, remaining / 9000));
        this.weaponBarBg.clear();
        this.weaponBarBg.fillStyle(0x222222, 0.7);
        this.weaponBarBg.fillRect(bx, by, W, H);
        this.weaponBar.clear();
        this.weaponBar.fillStyle(meta.colorHex, 1);
        this.weaponBar.fillRect(bx, by, W * pct, H);
      } else {
        this.weaponText.setText('');
        this.weaponBar.clear();
        this.weaponBarBg.clear();
        // Reset stacks once expired
        if (this.weaponTier !== 0 && remaining <= 0) {
          this.weaponTier = 0;
          this.weaponStacks = 0;
        }
      }
    }
    
    // Bomb
    if (Phaser.Input.Keyboard.JustDown(this.cursors.space)) {
      this.useBomb();
    }
    
    // Update bullets to follow their graphics
    gameState.bullets = gameState.bullets.filter(b => b.active);
    gameState.bullets.forEach(bullet => {
      if (bullet.graphics) {
        bullet.graphics.x = bullet.x;
        bullet.graphics.y = bullet.y;
        bullet.graphics.rotation = bullet.rotation;
      }
    });
    
    // Enemy AI
    gameState.enemies = gameState.enemies.filter(e => e.active);
    gameState.enemies.forEach(enemy => {
      if (!enemy.active) return;
      
      // Update graphics position
      if (enemy.graphics) {
        enemy.graphics.x = enemy.x;
        enemy.graphics.y = enemy.y;
        if (enemy.graphics.glow) {
          enemy.graphics.glow.x = enemy.x;
          enemy.graphics.glow.y = enemy.y;
        }
      }
      
      // Movement AI
      switch(enemy.enemyType) {
        case 'blue_square':
          // Simple chase
          const angleToPlayer = angleToTarget(enemy, gameState.player);
          enemy.setVelocity(
            Math.cos(angleToPlayer) * enemy.speed,
            Math.sin(angleToPlayer) * enemy.speed
          );
          break;
          
        case 'diamond':
          // Sine wave chase
          enemy.oscillate = (enemy.oscillate || 0) + delta * 0.005;
          const diamondAngle = angleToTarget(enemy, gameState.player);
          const perpAngle = diamondAngle + Math.PI / 2;
          const sineOffset = Math.sin(enemy.oscillate) * 50;
          enemy.setVelocity(
            Math.cos(diamondAngle) * enemy.speed + Math.cos(perpAngle) * sineOffset,
            Math.sin(diamondAngle) * enemy.speed + Math.sin(perpAngle) * sineOffset
          );
          break;
          
        case 'snake':
          // Head follows player
          const snakeAngle = angleToTarget(enemy, gameState.player);
          enemy.setVelocity(
            Math.cos(snakeAngle) * enemy.speed,
            Math.sin(snakeAngle) * enemy.speed
          );
          // Segments follow each other
          if (enemy.segments) {
            let prevX = enemy.x, prevY = enemy.y;
            enemy.segments.forEach((segment, i) => {
              const newX = Phaser.Math.Linear(segment.x, prevX, 0.2);
              const newY = Phaser.Math.Linear(segment.y, prevY, 0.2);
              prevX = segment.x;
              prevY = segment.y;
              segment.x = newX;
              segment.y = newY;
            });
          }
          break;
          
        case 'pinwheel':
          // Spinning chase
          enemy.rotation = (enemy.rotation || 0) + delta * 0.005;
          if (enemy.graphics) {
            enemy.graphics.rotation = enemy.rotation;
            if (enemy.graphics.glow) enemy.graphics.glow.rotation = enemy.rotation;
          }
          const pinwheelAngle = angleToTarget(enemy, gameState.player);
          enemy.setVelocity(
            Math.cos(pinwheelAngle) * enemy.speed,
            Math.sin(pinwheelAngle) * enemy.speed
          );
          break;
          
        case 'gravity_well':
          // Slow drift
          const wellAngle = angleToTarget(enemy, gameState.player);
          enemy.setVelocity(
            Math.cos(wellAngle) * enemy.speed,
            Math.sin(wellAngle) * enemy.speed
          );
          // Rotate graphics
          if (enemy.graphics) {
            enemy.graphics.rotation = (enemy.graphics.rotation || 0) + delta * 0.001;
            if (enemy.graphics.glow) enemy.graphics.glow.rotation = enemy.graphics.rotation;
          }
          break;
          
        case 'shooter':
          // SHOOTER — keeps preferred distance, fires aimed bullets at player
          {
            const sa = angleToTarget(enemy, gameState.player);
            const dist = distanceBetween(enemy, gameState.player);
            const desired = enemy.preferredDistance || 250;
            // Move toward or away from preferred distance
            const speed = enemy.speed * (dist > desired ? 1 : -0.6);
            enemy.setVelocity(Math.cos(sa) * speed, Math.sin(sa) * speed);
            // Rotate barrel toward player
            if (enemy.graphics) enemy.graphics.rotation = sa;
            // Fire if cooldown elapsed
            if (time > enemy.lastShot + (enemy.shootCooldown || 1800)) {
              this._spawnEnemyBullet(enemy.x, enemy.y, sa, 220, 0xff4444);
              enemy.lastShot = time;
              if (this.cache.audio.exists('sfx_disaster')) {
                this.sound.play('sfx_disaster', { volume: 0.15, detune: 600 });
              }
            }
          }
          break;

        case 'spinner':
          // SPINNER — locked-direction high-speed cross. Spins visually.
          enemy.spinAngle = (enemy.spinAngle || 0) + delta * 0.025;
          if (enemy.graphics) enemy.graphics.rotation = enemy.spinAngle;
          enemy.setVelocity(
            Math.cos(enemy._lockedAngle) * enemy.speed,
            Math.sin(enemy._lockedAngle) * enemy.speed
          );
          // Auto-destroy if it crosses the screen entirely (200px buffer)
          if (enemy.x < -200 || enemy.x > 1480 || enemy.y < -200 || enemy.y > 920) {
            this._killEnemy(enemy);
          }
          break;

        case 'waver':
          // WAVER — drifts toward player slowly; periodically emits damage rings
          {
            const wa = angleToTarget(enemy, gameState.player);
            enemy.setVelocity(Math.cos(wa) * enemy.speed, Math.sin(wa) * enemy.speed);
            if (enemy.graphics) {
              enemy.graphics.rotation = (enemy.graphics.rotation || 0) + delta * 0.0015;
            }
            if (time > enemy.lastWaveAt + (enemy.waveCooldown || 3000)) {
              this._emitDamageRing(enemy.x, enemy.y, 0x44ff88, 130);
              enemy.lastWaveAt = time;
            }
          }
          break;

        // ── WORLD 2 BEHAVIORS ──
        case 'squid':
          // SQUID — drifts toward player; when within 200px, enters SPIN ATTACK
          // (rapid rotation + dash burst). Spin attack lasts 600ms then cools 1.5s.
          {
            const sqDist = distanceBetween(enemy, gameState.player);
            const sqAngle = angleToTarget(enemy, gameState.player);
            const inAttack = time < (enemy.spinAttackUntil || 0);
            if (sqDist < 200 && time > (enemy.spinAttackAt || 0) + 1500 && !inAttack) {
              // Trigger spin attack
              enemy.spinAttackAt = time;
              enemy.spinAttackUntil = time + 600;
            }
            if (time < (enemy.spinAttackUntil || 0)) {
              // Spin-attack: fast rotation + dash
              enemy.spinAngle = (enemy.spinAngle || 0) + delta * 0.04;
              enemy.setVelocity(Math.cos(sqAngle) * enemy.speed * 3, Math.sin(sqAngle) * enemy.speed * 3);
            } else {
              // Drift mode — slow chase, gentle bobbing
              enemy.spinAngle = (enemy.spinAngle || 0) + delta * 0.003;
              enemy.setVelocity(Math.cos(sqAngle) * enemy.speed, Math.sin(sqAngle) * enemy.speed);
            }
            if (enemy.graphics) enemy.graphics.rotation = enemy.spinAngle;
          }
          break;

        case 'squiggle':
          // SQUIGGLE — locked-direction high-speed traversal with sine wobble
          // perpendicular to flight direction. Hard to track.
          enemy.wobble = (enemy.wobble || 0) + delta * 0.012;
          {
            const wob = Math.sin(enemy.wobble) * 80;
            const perp = (enemy._lockedAngle || 0) + Math.PI / 2;
            enemy.setVelocity(
              Math.cos(enemy._lockedAngle) * enemy.speed + Math.cos(perp) * wob,
              Math.sin(enemy._lockedAngle) * enemy.speed + Math.sin(perp) * wob
            );
            if (enemy.graphics) {
              enemy.graphics.rotation = enemy._lockedAngle + Math.sin(enemy.wobble) * 0.6;
            }
          }
          // Self-destroy off-screen
          if (enemy.x < -200 || enemy.x > 1480 || enemy.y < -200 || enemy.y > 920) {
            this._killEnemy(enemy);
          }
          break;

        case 'jelly':
          // JELLY — slow chase + gentle pulse (no special attack — splits on death)
          {
            const jAngle = angleToTarget(enemy, gameState.player);
            enemy.setVelocity(Math.cos(jAngle) * enemy.speed, Math.sin(jAngle) * enemy.speed);
            if (enemy.graphics) {
              enemy.graphics.rotation = (enemy.graphics.rotation || 0) + delta * 0.001;
            }
          }
          break;

        // ── WORLD 3 BEHAVIORS ──
        case 'crystal':
          // CRYSTAL — fast locked-angle traversal that BOUNCES off screen edges.
          // Each bounce decrements bouncesLeft; self-destruct at 0.
          enemy.spinAngle = (enemy.spinAngle || 0) + delta * 0.008;
          if (enemy.graphics) enemy.graphics.rotation = enemy.spinAngle;
          enemy.setVelocity(
            Math.cos(enemy._lockedAngle) * enemy.speed,
            Math.sin(enemy._lockedAngle) * enemy.speed
          );
          // Bounce
          if (enemy.x < 8) { enemy._lockedAngle = Math.PI - enemy._lockedAngle; enemy.x = 8; enemy.bouncesLeft--; }
          else if (enemy.x > 1272) { enemy._lockedAngle = Math.PI - enemy._lockedAngle; enemy.x = 1272; enemy.bouncesLeft--; }
          if (enemy.y < 8) { enemy._lockedAngle = -enemy._lockedAngle; enemy.y = 8; enemy.bouncesLeft--; }
          else if (enemy.y > 712) { enemy._lockedAngle = -enemy._lockedAngle; enemy.y = 712; enemy.bouncesLeft--; }
          if (enemy.bouncesLeft <= 0) this._killEnemy(enemy);
          break;

        case 'cluster':
          // CLUSTER — slow chase + spin (cosmetic). Splits into 4 crystals on death.
          enemy.spinAngle = (enemy.spinAngle || 0) + delta * 0.0025;
          if (enemy.graphics) enemy.graphics.rotation = enemy.spinAngle;
          {
            const cAngle = angleToTarget(enemy, gameState.player);
            enemy.setVelocity(Math.cos(cAngle) * enemy.speed, Math.sin(cAngle) * enemy.speed);
          }
          break;

        case 'glitcher':
          // GLITCHER — slow chase. Periodically TELEPORTS up to 120px in a
          // random direction. Visual flash on teleport.
          {
            const gAngle = angleToTarget(enemy, gameState.player);
            enemy.setVelocity(Math.cos(gAngle) * enemy.speed, Math.sin(gAngle) * enemy.speed);
            if (time > (enemy.lastTeleport || 0)) {
              const tpAngle = Math.random() * Math.PI * 2;
              const tpDist = 60 + Math.random() * 80;
              // Quick fade-out then teleport then fade-in
              if (enemy.graphics) {
                this.tweens.add({
                  targets: enemy.graphics, alpha: 0,
                  duration: 80, yoyo: true,
                  onYoyo: () => {
                    if (enemy.active && enemy.body) {
                      enemy.x += Math.cos(tpAngle) * tpDist;
                      enemy.y += Math.sin(tpAngle) * tpDist;
                      // Clamp inside arena
                      enemy.x = Phaser.Math.Clamp(enemy.x, 20, 1260);
                      enemy.y = Phaser.Math.Clamp(enemy.y, 20, 700);
                    }
                  },
                });
              }
              enemy.lastTeleport = time + 1500 + Math.random() * 1500;
            }
          }
          break;

        case 'boss_1':
          // OCTAEDRON — slow orbital drift around screen center, spawns minions,
          // periodic SHOCK WAVE damage rings expanding outward.
          {
            enemy.spinAngle = (enemy.spinAngle || 0) + delta * 0.0008;
            const orbitRad = 140;
            const targetX = 640 + Math.cos(enemy.spinAngle) * orbitRad;
            const targetY = 360 + Math.sin(enemy.spinAngle) * orbitRad;
            const dirA = angleToTarget(enemy, { x: targetX, y: targetY });
            enemy.setVelocity(Math.cos(dirA) * enemy.speed, Math.sin(dirA) * enemy.speed);
            if (enemy.graphics) enemy.graphics.rotation = enemy.spinAngle * 4;
            // Spawn 2 diamond minions every 3.5s
            if (!enemy.lastSpawn || time > enemy.lastSpawn + 3500) {
              for (let i = 0; i < 2; i++) {
                this.time.delayedCall(i * 200, () => this.spawnEnemy('diamond'));
              }
              enemy.lastSpawn = time;
            }
            // SHOCK WAVE — large expanding cyan ring. Cooldown shortens as
            // boss HP drops (3s normal, 1.8s under 33%). Telegraphs 0.5s before.
            const shockCd = enemy.hp / enemy.maxHp < 0.33 ? 1800 : 3000;
            if (!enemy.lastShock) enemy.lastShock = time + 2500;
            if (time > enemy.lastShock - 500 && !enemy._shockTelegraphed) {
              enemy._shockTelegraphed = true;
              if (enemy.graphics) {
                this.tweens.add({
                  targets: enemy.graphics, scale: 1.4,
                  duration: 450, yoyo: true, ease: 'Cubic.easeOut',
                });
              }
            }
            if (time > enemy.lastShock) {
              this._emitDamageRing(enemy.x, enemy.y, 0x44ddff, 320);
              this.cameras.main.shake(180, 0.012);
              enemy.lastShock = time + shockCd;
              enemy._shockTelegraphed = false;
            }
            // Aimed bullet at player every 1.6s (faster under 50%)
            const aimedCd = enemy.hp / enemy.maxHp < 0.5 ? 1100 : 1700;
            if (!enemy.lastAimed || time > enemy.lastAimed + aimedCd) {
              const aim = angleToTarget(enemy, gameState.player);
              this._spawnEnemyBullet(enemy.x, enemy.y, aim, 240, 0x44ddff);
              enemy.lastAimed = time;
            }
            this._updateBossHUD();
          }
          break;

        case 'boss_2':
          // HEX SWARM — slow drift; rotates faster as satellites die.
          // Once all sats down, fires radial bullet bursts.
          {
            const livingSats = (enemy.satellites || []).filter(s => s && s.active).length;
            const rotSpeed = 0.0015 + (6 - livingSats) * 0.0008;
            enemy.spinAngle = (enemy.spinAngle || 0) + delta * rotSpeed;
            if (enemy.graphics) enemy.graphics.rotation = enemy.spinAngle;
            const ba = angleToTarget(enemy, gameState.player);
            enemy.setVelocity(Math.cos(ba) * enemy.speed, Math.sin(ba) * enemy.speed);
            // Fire radial burst every 4s once shields down + a homing red
            // glowing bullet aimed at the player at the same cadence.
            // 2026-05-06 — Hex Swarm difficulty bump per user request.
            if (livingSats === 0) {
              if (!enemy.lastBurst || time > enemy.lastBurst + 4000) {
                for (let i = 0; i < 8; i++) {
                  const a = i * Math.PI / 4 + (enemy.spinAngle || 0);
                  this._spawnEnemyBullet(enemy.x, enemy.y, a, 200, 0xff44ff);
                }
                const aim = angleToTarget(enemy, gameState.player);
                const homing = this._spawnEnemyBullet(enemy.x, enemy.y, aim, 220, 0xff0000);
                if (homing) {
                  homing.homing = true;
                  homing.homingSpeed = 240;
                  homing.homingTurnRate = 0.06;
                  // Bigger glowing visual: red core + white inner highlight
                  // + outer red halo, plus a pulsing alpha tween.
                  if (homing.graphics) {
                    homing.graphics.clear();
                    homing.graphics.fillStyle(0xff0000, 0.35);
                    homing.graphics.fillCircle(0, 0, 11);
                    homing.graphics.fillStyle(0xff2222, 1);
                    homing.graphics.fillCircle(0, 0, 7);
                    homing.graphics.fillStyle(0xffffff, 1);
                    homing.graphics.fillCircle(0, 0, 3);
                    homing.graphics.lineStyle(2, 0xff8888, 0.9);
                    homing.graphics.strokeCircle(0, 0, 9);
                    this.tweens.add({
                      targets: homing.graphics,
                      alpha: { from: 1, to: 0.55 },
                      duration: 220,
                      yoyo: true,
                      repeat: -1,
                    });
                  }
                  homing.setSize(12, 12);
                }
                enemy.lastBurst = time;
              }
            }
            this._updateBossHUD();
            // Move satellites in orbit around the boss
            if (enemy.satellites) {
              enemy.satellites.forEach((sat, i) => {
                if (!sat || !sat.active) return;
                sat.orbitAngle += delta * 0.002;
                const ox = enemy.x + Math.cos(sat.orbitAngle) * sat.orbitRadius;
                const oy = enemy.y + Math.sin(sat.orbitAngle) * sat.orbitRadius;
                sat.setVelocity((ox - sat.x) * 5, (oy - sat.y) * 5);
                if (sat.graphics) {
                  sat.graphics.x = sat.x; sat.graphics.y = sat.y;
                  sat.graphics.rotation = sat.orbitAngle + Math.PI / 2;
                }
              });
            }
          }
          break;

        case 'boss_satellite':
          // Satellite movement is handled by the parent boss_2 case
          break;

        case 'boss_3':
          // PRISM CORE — 3 phases by HP threshold. Phase 0: chase + radial bursts.
          // Phase 1 (<66% HP): sweeping bullet line. Phase 2 (<33% HP): dash + ring.
          {
            const phase = enemy.hp / enemy.maxHp < 0.33 ? 2 :
                          enemy.hp / enemy.maxHp < 0.66 ? 1 : 0;
            if (phase !== enemy.bossPhase) {
              enemy.bossPhase = phase;
              this.cameras.main.flash(180, 255, 200, 100);
              this._showBigBanner(`PHASE ${phase + 1}`, '#ff8800', 800);
            }
            enemy.spinAngle = (enemy.spinAngle || 0) + delta * 0.003 * (1 + phase * 0.6);
            if (enemy.graphics) enemy.graphics.rotation = enemy.spinAngle;
            const pa = angleToTarget(enemy, gameState.player);
            const chaseSpeed = enemy.speed * (1 + phase * 0.4);
            enemy.setVelocity(Math.cos(pa) * chaseSpeed, Math.sin(pa) * chaseSpeed);
            // Phase-specific attacks
            const cd = phase === 0 ? 2400 : phase === 1 ? 1600 : 1100;
            if (!enemy.lastAtk || time > enemy.lastAtk + cd) {
              if (phase === 0) {
                // Radial 6-burst
                for (let i = 0; i < 6; i++) {
                  const a = i * Math.PI / 3 + enemy.spinAngle;
                  this._spawnEnemyBullet(enemy.x, enemy.y, a, 220, 0xff8800);
                }
              } else if (phase === 1) {
                // 3-shot tight spread aimed at player
                for (let i = -1; i <= 1; i++) {
                  this._spawnEnemyBullet(enemy.x, enemy.y, pa + i * 0.18, 280, 0xff6600);
                }
              } else {
                // Ring + 8-burst
                this._emitDamageRing(enemy.x, enemy.y, 0xff8800, 180);
                for (let i = 0; i < 12; i++) {
                  const a = i * Math.PI / 6;
                  this._spawnEnemyBullet(enemy.x, enemy.y, a, 240, 0xff4400);
                }
              }
              enemy.lastAtk = time;
            }
            // 2026-05-06 — Wide-laser cadence (separate timer from bullet
            // attacks so the boss is doing both). Shorter telegraph + more
            // frequent fire as phases escalate. Phase 0: 4.5s cadence with
            // 700ms warning. Phase 2: 2.2s cadence with 350ms warning —
            // genuinely punishing.
            const laserCd = phase === 0 ? 4500 : phase === 1 ? 3200 : 2200;
            const teleMs  = phase === 0 ? 700  : phase === 1 ? 500  : 350;
            const fireMs  = phase === 0 ? 450  : phase === 1 ? 500  : 600;
            const beamW   = phase === 0 ? 60   : phase === 1 ? 75   : 95;
            if (!enemy.lastLaser || time > enemy.lastLaser + laserCd) {
              this._fireBossLaser(enemy, pa, {
                width: beamW,
                length: 1400,
                telegraphMs: teleMs,
                firingMs: fireMs,
                color: 0xff3300,
              });
              enemy.lastLaser = time;
            }
            this._updateBossHUD();
          }
          break;

        case 'drift':
          // DRIFT debris (split-children) — keep outward velocity, decelerate
          // slowly, no chase. Self-destruct after 2.5s.
          if (time - (enemy.bornAt || 0) > 2500) {
            this._killEnemy(enemy);
            break;
          }
          // Mild deceleration so they don't fly forever
          if (enemy.body) {
            enemy.setVelocity(
              enemy.body.velocity.x * 0.985,
              enemy.body.velocity.y * 0.985
            );
          }
          break;

        default:
          // Simple chase fallback (e.g., legacy 'shard')
          if (enemy.graphics) {
            const shardAngle = angleToTarget(enemy, gameState.player);
            enemy.setVelocity(
              Math.cos(shardAngle) * 50,
              Math.sin(shardAngle) * 50
            );
          }
      }
    });
    
    // 2026-05-05 — Update enemy-bullet graphics positions
    // 2026-05-06 — Homing-bullet steering: rotate current velocity toward
    // the player by a capped turn rate per frame so the bullet curves
    // smoothly instead of snapping. Player invuln/dead → fly straight.
    if (this.enemyBullets && this.enemyBullets.getChildren) {
      this.enemyBullets.getChildren().forEach(b => {
        if (b.homing && b.active && gameState.player && gameState.player.active) {
          const desired = Math.atan2(gameState.player.y - b.y, gameState.player.x - b.x);
          const cur = Math.atan2(b.body.velocity.y, b.body.velocity.x);
          let diff = desired - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = b.homingTurnRate || 0.06;
          const next = cur + Phaser.Math.Clamp(diff, -turn, turn);
          const sp = b.homingSpeed || 220;
          b.setVelocity(Math.cos(next) * sp, Math.sin(next) * sp);
        }
        if (b.graphics) { b.graphics.x = b.x; b.graphics.y = b.y; }
      });
    }

    // 2026-05-05 PERF — Black hole visuals are now tween-driven (set up in
    // _spawnBlackHole). This loop only handles physics: pull enemies + tick
    // damage. No per-frame Graphics work.
    if (this.blackHoles && this.blackHoles.length) {
      this.blackHoles = this.blackHoles.filter(bh => {
        const age = time - bh.birthTime;
        if (age > bh.lifetime) {
          this.tweens.killTweensOf(bh.gfx);
          bh.gfx.destroy();
          return false;
        }
        // Pull enemies (bosses are immune so they remain a fight)
        for (const e of gameState.enemies.slice()) {
          if (!e || !e.active || e.bossId !== undefined) continue;
          const dx = bh.x - e.x;
          const dy = bh.y - e.y;
          const dist = Math.hypot(dx, dy);
          if (dist > bh.radius || dist < 1) continue;
          const pull = bh.pullStrength * (1 - dist / bh.radius);
          const ax = (dx / dist) * pull;
          const ay = (dy / dist) * pull;
          if (e.body) {
            e.setVelocity(
              e.body.velocity.x + ax * delta / 1000,
              e.body.velocity.y + ay * delta / 1000
            );
          }
        }
        // Tick damage every tickInterval
        if (time > bh.lastTick + bh.tickInterval) {
          bh.lastTick = time;
          for (const e of gameState.enemies.slice()) {
            if (!e || !e.active) continue;
            const d = Math.hypot(bh.x - e.x, bh.y - e.y);
            if (d > bh.radius) continue;
            e.hp -= bh.dmgPerTick;
            if (e.hp <= 0) {
              const points = (e.points || 0) * gameState.multiplier;
              gameState.score += points;
              this.scoreText.setText(`Score: ${gameState.score}`);
              this.explosionEmitter.explode(8, e.x, e.y);
              this._killEnemy(e);
            }
          }
        }
        return true;
      });
    }

    // 2026-05-05 — Tick HOMING MISSILES (tier 8 swarm). Steer each missile
    // toward its locked target. If target dies, find a new one.
    if (gameState.bullets && gameState.bullets.length) {
      for (const b of gameState.bullets) {
        if (!b || !b.active || !b.homing) continue;
        if (!b.homingTarget || !b.homingTarget.active) {
          b.homingTarget = this._findNearestEnemy(b.x, b.y);
        }
        if (b.homingTarget) {
          const desired = Math.atan2(b.homingTarget.y - b.y, b.homingTarget.x - b.x);
          let diff = desired - b.rotation;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = Math.max(-b.homingTurnRate * delta, Math.min(b.homingTurnRate * delta, diff));
          const newAngle = b.rotation + turn;
          b.setVelocity(Math.cos(newAngle) * 500, Math.sin(newAngle) * 500);
          b.rotation = newAngle;
        }
      }
    }

    // 2026-05-05 PERF — damage-ring visuals are now tween-driven (see
    // _emitDamageRing). This loop only reads gfx.scale to derive current
    // radius for collision and disposes when lifetime expires. No per-frame
    // Graphics redraw, much cheaper.
    // 2026-05-06 — Boss wide-laser tick: keep beam pinned to boss origin
    // during telegraph + firing, run damage check during firing phase.
    // Geometry: project player vec onto beam axis; if 0 ≤ along ≤ length
    // and |perp| ≤ width/2 → hit.
    if (this.bossBeams && this.bossBeams.length) {
      this.bossBeams = this.bossBeams.filter(beam => {
        const expired = time > beam.firingUntil;
        // Pin all visuals (warning line, fire beam, charge-up glow) to
        // the still-living boss so they track its motion correctly.
        if (beam._bossRef && beam._bossRef.active) {
          beam.x = beam._bossRef.x;
          beam.y = beam._bossRef.y;
          if (beam.telegraphGfx && beam.telegraphGfx.active) {
            beam.telegraphGfx.x = beam.x;
            beam.telegraphGfx.y = beam.y;
          }
          if (beam.gfx && beam.gfx.active) {
            beam.gfx.x = beam.x;
            beam.gfx.y = beam.y;
          }
          if (beam.glowOuter && beam.glowOuter.active) {
            beam.glowOuter.x = beam.x;
            beam.glowOuter.y = beam.y;
          }
          if (beam.glowInner && beam.glowInner.active) {
            beam.glowInner.x = beam.x;
            beam.glowInner.y = beam.y;
          }
        }
        if (expired) {
          if (beam.telegraphGfx && beam.telegraphGfx.active) beam.telegraphGfx.destroy();
          if (beam.gfx && beam.gfx.active) beam.gfx.destroy();
          if (beam.glowOuter && beam.glowOuter.active) beam.glowOuter.destroy();
          if (beam.glowInner && beam.glowInner.active) beam.glowInner.destroy();
          return false;
        }
        const firing = time >= beam.telegraphUntil;
        if (firing && !beam.hit && gameState.player && gameState.player.active && !gameState.player.invulnerable) {
          const dx = gameState.player.x - beam.x;
          const dy = gameState.player.y - beam.y;
          const cos = Math.cos(beam.angle);
          const sin = Math.sin(beam.angle);
          const along = dx * cos + dy * sin;
          const perp  = -dx * sin + dy * cos;
          if (along >= 0 && along <= beam.length && Math.abs(perp) <= beam.width / 2) {
            beam.hit = true;
            this.playerHitEnemy(gameState.player, { active: true, x: gameState.player.x, y: gameState.player.y });
          }
        }
        return true;
      });
    }

    if (this.damageRings && this.damageRings.length) {
      this.damageRings = this.damageRings.filter(r => {
        const age = time - r.birthTime;
        if (age > r.lifetime) {
          r.gfx.destroy();
          return false;
        }
        // Read scale (set by Phaser tween) instead of re-computing + redrawing
        r.radius = r.gfx.scale;
        // Player damage check — narrow ring annulus
        if (!r.hit && gameState.player && !gameState.player.invulnerable) {
          const d = Math.hypot(gameState.player.x - r.x, gameState.player.y - r.y);
          if (Math.abs(d - r.radius) < 14) {
            r.hit = true;
            this.playerHitEnemy(gameState.player, { active: true, x: r.x, y: r.y });
          }
        }
        return true;
      });
    }

    // Apply gravity wells
    gameState.gravityWells.forEach(well => {
      if (!well.active) return;

      // Pull player
      const distToPlayer = distanceBetween(well, gameState.player);
      if (distToPlayer < well.pullRadius) {
        const pullAngle = angleToTarget(gameState.player, well);
        const pullForce = (1 - distToPlayer / well.pullRadius) * well.pullStrength;
        gameState.player.setVelocity(
          gameState.player.body.velocity.x + Math.cos(pullAngle) * pullForce * delta / 1000,
          gameState.player.body.velocity.y + Math.sin(pullAngle) * pullForce * delta / 1000
        );
      }
      
      // Pull bullets
      gameState.bullets.forEach(bullet => {
        if (!bullet.active) return;
        const distToBullet = distanceBetween(well, bullet);
        if (distToBullet < well.pullRadius) {
          const pullAngle = angleToTarget(bullet, well);
          const pullForce = (1 - distToBullet / well.pullRadius) * well.pullStrength;
          bullet.setVelocity(
            bullet.body.velocity.x + Math.cos(pullAngle) * pullForce * delta / 1000,
            bullet.body.velocity.y + Math.sin(pullAngle) * pullForce * delta / 1000
          );
        }
      });
    });
    
    // Wave management
    if (this.bossActive) {
      // Boss waves: no timer, no drip spawn — wait for boss kill
      this.waveText.setText(`Wave ${gameState.currentWave} - BOSS`);
    } else if (this._bossDeathPending) {
      // 2026-05-05 — Boss just died. Don't run timer/drip until the 2.2s
      // delayedCall fires _advanceWave (which clears this flag).
      this.waveText.setText(`WORLD CLEARED!`);
    } else {
      const waveElapsed = time - gameState.waveStartTime;
      const waveRemaining = Math.max(0, Math.ceil((this.waveTimer - waveElapsed) / 1000));
      this.waveText.setText(`Wave ${gameState.currentWave} - ${waveRemaining}s`);

      // Spawn enemies (drip — wave-gated roster).
      // 2026-05-05 PERF — Soft cap at 80 active enemies. Cumulative-wave
      // model lets the count grow without bound; once it crosses ~100 the
      // renderer chokes (each enemy is its own Graphics + sprite). When
      // capped, drip is paused but the enemies still attack — player has
      // to thin them out before more spawn. Boss minions and split-debris
      // bypass this cap (they use spawnEnemy directly from event handlers).
      if (time > this.nextSpawnTime && waveRemaining > 0
          && gameState.enemies.length < 80) {
        const enemyTypes = this._availableEnemyTypes(gameState.currentWave);
        const type = Phaser.Utils.Array.GetRandom(enemyTypes);
        this.spawnEnemy(type);

        this.spawnDelay = Math.max(180, 1600 - gameState.currentWave * 280);
        this.nextSpawnTime = time + this.spawnDelay;
      } else if (gameState.enemies.length >= 80) {
        // While at cap, push spawn timer forward so we don't insta-spawn the
        // moment one enemy dies (would burst-spawn into the cap repeatedly).
        this.nextSpawnTime = time + 400;
      }

      // Wave complete (timer expired)
      if (waveElapsed >= this.waveTimer) {
        this._advanceWave();
      }
    }
  }
}

class GameOverScene extends Phaser.Scene {
  constructor() { super("GameOver"); }

  create() {
    gameState.currentScene = "GameOver";
    // 2026-05-06 — Refresh scale on every entry. Phaser's FIT-mode pointer
    // mapping can stale after a fullscreen transition (scene re-entry from
    // fullscreen Game→GameOver loses the parent div's new bounding rect,
    // making clicks land "next to" the button). this.scale.refresh()
    // recomputes the canvas-display-rect-to-game-coordinates transform.
    try { this.scale.refresh(); } catch (_e) {}
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#080820');

    // 2026-05-05 — Polished game-over screen. Neon vector aesthetic matching
    // the gameplay. Real Graphics-drawn buttons with explicit hit areas
    // (Text+backgroundColor hit areas were unreliable — clicks were missing).
    try { this.cameras.main.postFX.addBloom(0xffffff, 1, 1, 1, 1.2, 3); } catch (e) {}

    // Faint grid backdrop — same vibe as the arena
    const grid = this.add.graphics().setDepth(0);
    grid.lineStyle(1, 0x1a2030, 0.6);
    for (let x = 0; x <= width; x += 60) { grid.lineBetween(x, 0, x, height); }
    for (let y = 0; y <= height; y += 60) { grid.lineBetween(0, y, width, y); }

    // Title
    const title = this.add.text(width / 2, height * 0.22, 'GAME OVER', {
      font: 'bold 64px Arial',
      color: '#ff0044',
      stroke: '#ff66aa', strokeThickness: 2,
    }).setOrigin(0.5);
    title.setShadow(0, 0, '#ff0044', 30);
    // Subtle pulse
    this.tweens.add({
      targets: title, scale: 1.05,
      duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // Stat panel — three rows (final score, wave reached, high score)
    const panelY = height * 0.42;
    const stats = [
      { label: 'FINAL SCORE',  value: gameState.score,           color: '#ffffff' },
      { label: 'WAVE REACHED', value: gameState.currentWave,     color: '#88ddff' },
      { label: 'HIGH SCORE',   value: gameState.highScore,       color: '#ffaa00' },
    ];
    stats.forEach((s, i) => {
      this.add.text(width / 2 - 120, panelY + i * 36, s.label, {
        font: '16px Arial', color: '#888888',
      }).setOrigin(1, 0.5);
      this.add.text(width / 2 - 100, panelY + i * 36, String(s.value), {
        font: 'bold 22px Arial', color: s.color,
      }).setOrigin(0, 0.5);
    });

    // 2026-05-05 (4th rewrite) — User reports menu/gameover BOTH still stuck
    // after Game→GameOver→Menu→Game cycle. Earlier "redundant 3-path input"
    // attempt was the cause, not the cure: scene-level pointerdown + DOM
    // canvas listeners CAPTURE CLOSURES OVER SCENE STATE that survive
    // re-entry, leaking handlers that fire on dead scene refs. Stripping
    // back to the SIMPLEST canonical Phaser pattern: Rectangle setInteractive
    // + ENTER keyboard fallback. Phaser handles re-entry correctly when
    // input.enabled is set on every create() (done above for Menu; doing it
    // here too).
    this.input.enabled = true;
    if (this.input.keyboard) this.input.keyboard.enabled = true;

    this._makeButton(width / 2, height * 0.72, 240, 56, 'TRY AGAIN',
      0x00ff88, () => this.scene.start('Game', { level: 0 }));

    this._makeButton(width / 2, height * 0.85, 160, 38, 'MAIN MENU',
      0x4488ff, () => this.scene.start('Menu'));

    // Keyboard fallbacks
    this.input.keyboard.on('keydown-ENTER', () => this.scene.start('Game', { level: 0 }));
    this.input.keyboard.on('keydown-SPACE', () => this.scene.start('Game', { level: 0 }));
    this.input.keyboard.on('keydown-M', () => this.scene.start('Menu'));
    this.input.keyboard.on('keydown-F', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });

    // Hint
    this.add.text(width / 2, height * 0.94, 'click • or press ENTER • F for fullscreen', {
      font: '14px Arial', color: '#666a80',
    }).setOrigin(0.5);
  }

  _makeButton(x, y, w, h, label, color, onClick) {
    // 2026-05-05 — User reports buttons unresponsive. The previous version
    // passed an explicit Phaser.Geom.Rectangle hitArea with negative
    // origin coords (-w/2, -h/2). Phaser's default hit area for a
    // GameObjects.Rectangle is correct without overrides, and the explicit
    // override was misaligned in some renders. Pass `{ useHandCursor: true }`
    // alone — Phaser auto-derives the hit area from rect.width/height.
    const rect = this.add.rectangle(x, y, w, h, color, 0.22)
      .setStrokeStyle(2, color, 1)
      .setInteractive({ useHandCursor: true });
    rect.on('pointerover', () => { rect.setFillStyle(color, 0.4); });
    rect.on('pointerout',  () => { rect.setFillStyle(color, 0.22); });
    // pointerup is more reliable across browsers than pointerdown for
    // scene transitions — pointerdown sometimes fires DURING the parent
    // page bubble and the click is already mid-flight when scene.start
    // fires, leaving a stale event on the new scene.
    const fire = (e) => { if (e?.event) e.event.stopPropagation(); onClick(); };
    rect.on('pointerup', fire);
    // DOM-level fallback bound to the canvas — useful inside iframes
    // where Phaser's input plugin sometimes loses pointer focus after
    // the previous scene's gameOver handler ran. Two paths to fire.
    const labelText = this.add.text(x, y, label, {
      font: 'bold 22px Arial',
      color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    labelText.on('pointerup', fire);
    return rect;
  }
}

class WinScene extends Phaser.Scene {
  constructor() { super("Win"); }
  
  create() {
    gameState.currentScene = "Win";
    // 2026-05-06 — Same fullscreen-pointer-stale fix as GameOverScene.
    try { this.scale.refresh(); } catch (_e) {}
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#080820');

    // Victory text with glow
    const victoryText = this.add.text(width / 2, height * 0.25, "VICTORY!", {
      font: "bold 56px Arial",
      color: "#00ffff"
    }).setOrigin(0.5);
    victoryText.setShadow(0, 0, '#00ffff', 30);

    this.add.text(width / 2, height * 0.4, "You survived all waves!", {
      font: "24px Arial",
      color: "#88ddff"
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.5, `Final Score: ${gameState.score}`, {
      font: "28px Arial",
      color: "#ffffff"
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.6, `High Score: ${gameState.highScore}`, {
      font: "20px Arial",
      color: "#ffaa00"
    }).setOrigin(0.5);

    // Use the same makeButton helper as GameOverScene so the whole rendered
    // button (rectangle + label) is a single hit zone at the original
    // designed size.
    GameOverScene.prototype._makeButton.call(this,
      width / 2, height * 0.75, 240, 56, 'PLAY AGAIN',
      0x00ff88, () => this.scene.start('Game', { level: 0 }));

    GameOverScene.prototype._makeButton.call(this,
      width / 2, height * 0.88, 160, 38, 'MAIN MENU',
      0x4488ff, () => this.scene.start('Menu'));

    // Keyboard fallback
    this.input.keyboard.on('keydown-ENTER', () => this.scene.start('Game', { level: 0 }));
    this.input.keyboard.on('keydown-SPACE', () => this.scene.start('Game', { level: 0 }));
    this.input.keyboard.on('keydown-M', () => this.scene.start('Menu'));
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASER GAME INSTANCE
// ═══════════════════════════════════════════════════════════════

const phaserConfig = {
  type: Phaser.AUTO,
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  backgroundColor: GAME_CONFIG.colors.bg,
  parent: "game-container",
  // 2026-05-05 — FIT mode always. Intrinsic resolution is now 1280×720 so
  // the game looks crisp at common windowed sizes (≥1280 wide) and only
  // upscales modestly to fullscreen 1920×1080 (1.5× vs prior 2×).
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_CONFIG.width,
    height: GAME_CONFIG.height,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: [BootScene, PreloadScene, MenuScene, GameScene, GameOverScene, WinScene],
};

const game = new Phaser.Game(phaserConfig);
window.__GAME__ = game;

// 2026-05-06 — Refresh the FIT-mode scale on every fullscreen change,
// in BOTH directions. The native fullscreenchange event fires on the
// document when the parent iframe enters or exits fullscreen, but
// Phaser's internal canvas-display-rect snapshot doesn't always catch
// the resize → exit-fullscreen leaves the canvas stretched at the old
// fullscreen dimensions until the user manually resizes the window.
// Refreshing on every change recomputes the parent's bounding rect.
const _refreshScale = () => { try { game.scale.refresh(); } catch (_e) {} };
document.addEventListener("fullscreenchange",       _refreshScale);
document.addEventListener("webkitfullscreenchange", _refreshScale);
window.addEventListener("resize", _refreshScale);

// 2026-05-05 — Scale mode is FIT (set in phaserConfig). Phaser handles both
// windowed and fullscreen automatically — canvas scales up to fill the
// available container while preserving 16:9 aspect (letterbox if needed).