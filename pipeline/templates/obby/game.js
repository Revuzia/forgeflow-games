/**
 * ForgeFlow Games — Phaser Obby Template
 * Obstacle course / precision platformer (Roblox obby style).
 * One-hit death + checkpoint respawn. Linear stage progression.
 * Pipeline substitutes template tokens with game-specific values.
 */

const GAME_CONFIG = {
  title: "{{GAME_TITLE}}",
  width: 1280,
  height: 720,
  tileSize: 18,
  gravity: 900,
  player: {
    speed: 220,
    jumpForce: -380,
    doubleJumpForce: -320,
    dashSpeed: 450,
    dashDuration: 180,
    coyoteTime: 120,
    jumpBuffer: 120,
  },
  stages: {{STAGE_DATA}},
  colors: {
    bg: "#{{BG_COLOR}}",
    accent: "#{{ACCENT_COLOR}}",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// BOOT + PRELOAD
// ─────────────────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super("BootScene"); }
  create() { this.scene.start("PreloadScene"); }
}

class PreloadScene extends Phaser.Scene {
  constructor() { super("PreloadScene"); }
  preload() {
    // Tilesets + character
    this.load.spritesheet("tiles",
      "assets/tilemap_packed.png",
      { frameWidth: 18, frameHeight: 18 });
    this.load.spritesheet("chars",
      "assets/tilemap-characters_packed.png",
      { frameWidth: 24, frameHeight: 24 });
    // SFX
    {{CUSTOM_SPRITE_LOADS}}
    {{CUSTOM_AUDIO_LOADS}}
    // Fallback stock audio if dynamic loads empty
    this.load.audio("sfx_jump", "assets/audio/sfx_jump.ogg");
    this.load.audio("sfx_death", "assets/audio/sfx_death.ogg");
    this.load.audio("sfx_checkpoint", "assets/audio/sfx_checkpoint.ogg");
    this.load.audio("sfx_level_complete", "assets/audio/sfx_level_complete.ogg");
    this.load.audio("music_level", "assets/audio/music_level.ogg");
  }
  create() { this.scene.start("MenuScene"); }
}

// ─────────────────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────────────────
class MenuScene extends Phaser.Scene {
  constructor() { super("MenuScene"); }
  create() {
    const menu = document.getElementById("menu-overlay");
    const hud = document.getElementById("hud");
    const playBtn = document.getElementById("play-btn");
    if (playBtn) {
      playBtn.onclick = () => {
        menu.classList.add("hidden");
        hud.classList.remove("hidden");
        this.scene.start("GameScene");
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GAME
// ─────────────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super("GameScene"); }

  create() {
    // Attach shared helpers
    if (window.Juice) Juice.attach(this);
    if (window.Gamepad) Gamepad.init(this);
    if (window.SaveLoad) SaveLoad.init("{{GAME_TITLE}}");

    this.stageIndex = 0;
    this.deaths = 0;
    this.startTime = Date.now();
    this.checkpointIndex = 0;

    this._buildStage();
    this._createPlayer();
    this._setupInput();
    this._startHudUpdate();
  }

  _buildStage() {
    const stage = GAME_CONFIG.stages[this.stageIndex] || this._defaultStage();
    // Render ground + platforms + hazards from stage data
    this.platforms = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup();
    this.checkpoints = this.physics.add.staticGroup();
    this.goal = null;

    const ts = GAME_CONFIG.tileSize;
    if (stage.tiles) {
      for (let r = 0; r < stage.tiles.length; r++) {
        for (let c = 0; c < stage.tiles[r].length; c++) {
          const t = stage.tiles[r][c];
          const x = c * ts + ts / 2;
          const y = r * ts + ts / 2;
          if (t === 1 || t === 2) {
            // Solid ground
            const p = this.add.rectangle(x, y, ts, ts, 0x556677);
            this.platforms.add(p);
          } else if (t === 3) {
            // Floating platform
            const p = this.add.rectangle(x, y, ts, ts / 2, 0x88aacc);
            this.platforms.add(p);
          } else if (t === 4) {
            // Spike / kill hazard
            const s = this.add.triangle(x, y, 0, ts, ts / 2, 0, ts, ts, 0xff3333);
            this.hazards.add(s);
          } else if (t === 5) {
            // Checkpoint flag
            const cp = this.add.rectangle(x, y - ts / 2, ts / 4, ts, 0x00ff88);
            cp.cpIndex = this.stageIndex + 1;
            this.checkpoints.add(cp);
          } else if (t === 9) {
            // Goal
            this.goal = this.add.rectangle(x, y - ts / 2, ts, ts, 0xffcc00);
            this.physics.add.existing(this.goal, true);
          }
        }
      }
    }

    // Level bounds extend with stage length
    const worldWidth = (stage.tiles?.[0]?.length || 60) * ts;
    this.physics.world.setBounds(0, 0, worldWidth, 30 * ts);
    this.cameras.main.setBounds(0, 0, worldWidth, 30 * ts);
  }

  _defaultStage() {
    // Simple tutorial stage when no data provided
    const tiles = [];
    for (let r = 0; r < 30; r++) tiles.push(Array(60).fill(0));
    for (let c = 0; c < 60; c++) tiles[26][c] = 1;  // ground
    for (let c = 0; c < 60; c++) tiles[27][c] = 2;
    tiles[25][30] = 4;  // a spike
    tiles[25][58] = 9;  // goal
    return { tiles };
  }

  _createPlayer() {
    const spawnX = 40;
    const spawnY = 20 * GAME_CONFIG.tileSize;
    this.player = this.add.rectangle(spawnX, spawnY, 16, 24, 0x66ddff);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.canDoubleJump = true;
    this.player.dashCooldown = 0;

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.overlap(this.player, this.hazards, () => this._die());
    this.physics.add.overlap(this.player, this.checkpoints, (_, cp) => this._hitCheckpoint(cp));
    if (this.goal) {
      this.physics.add.overlap(this.player, this.goal, () => this._finishStage());
    }

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
  }

  _setupInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys("W,A,S,D,SPACE,SHIFT,X");
  }

  _die() {
    if (this._dying) return;
    this._dying = true;
    this.deaths++;
    if (this.juice) {
      this.juice.flash(0xff3333, 200);
      this.juice.shake(300, 0.02);
      this.juice.particles(this.player.x, this.player.y, { count: 16, color: 0xff3333 });
    }
    this.sound.play("sfx_death", { volume: 0.6 });
    this.time.delayedCall(500, () => {
      this._dying = false;
      // Respawn at checkpoint
      const cp = this._checkpointPos();
      this.player.setPosition(cp.x, cp.y);
      this.player.body.setVelocity(0, 0);
    });
  }

  _checkpointPos() {
    // Checkpoint 0 = stage start; higher = nearest checkpoint passed
    return { x: 40 + this.checkpointIndex * 200, y: 20 * GAME_CONFIG.tileSize };
  }

  _hitCheckpoint(cp) {
    if (cp.cpIndex > this.checkpointIndex) {
      this.checkpointIndex = cp.cpIndex;
      this.sound.play("sfx_checkpoint", { volume: 0.6 });
      if (this.juice) {
        this.juice.flash(0x00ff88, 100);
        this.juice.rippleText("CHECKPOINT!", this.player.x, this.player.y - 40);
      }
      cp.setFillStyle(0x888888);  // mark as activated
    }
  }

  _finishStage() {
    if (this._finishing) return;
    this._finishing = true;
    this.sound.play("sfx_level_complete", { volume: 0.8 });
    if (this.juice) {
      this.juice.rippleText("STAGE CLEAR!", this.player.x, this.player.y - 60, {
        size: "52px", color: "#ffcc00", duration: 2000,
      });
    }
    if (window.SaveLoad) {
      SaveLoad.autoSave({
        level: this.stageIndex + 1,
        deaths: this.deaths,
        playtime: Math.round((Date.now() - this.startTime) / 1000),
      });
    }
    this.time.delayedCall(2000, () => {
      this.stageIndex++;
      if (this.stageIndex >= GAME_CONFIG.stages.length) {
        this.scene.start("WinScene", { deaths: this.deaths });
      } else {
        this.scene.restart();
      }
    });
  }

  _startHudUpdate() {
    this.time.addEvent({
      delay: 100, loop: true, callback: () => {
        document.getElementById("stage-num").textContent = this.stageIndex + 1;
        document.getElementById("deaths").textContent = this.deaths;
        const sec = Math.round((Date.now() - this.startTime) / 1000);
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        document.getElementById("timer").textContent = `${min}:${String(s).padStart(2, '0')}`;
      },
    });
  }

  update() {
    if (this._dying || this._finishing) return;
    const body = this.player.body;
    const onGround = body.blocked.down || body.touching.down;

    // Movement
    const left = this.cursors.left.isDown || this.keys.A.isDown ||
                 (this.gamepad && this.gamepad.getAxis("movex") < -0.2);
    const right = this.cursors.right.isDown || this.keys.D.isDown ||
                  (this.gamepad && this.gamepad.getAxis("movex") > 0.2);
    if (left)       body.setVelocityX(-GAME_CONFIG.player.speed);
    else if (right) body.setVelocityX(GAME_CONFIG.player.speed);
    else            body.setVelocityX(0);

    // Jump
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.cursors.space) ||
                        Phaser.Input.Keyboard.JustDown(this.keys.SPACE) ||
                        (this.gamepad && this.gamepad.justPressed("jump"));
    if (jumpPressed) {
      if (onGround) {
        body.setVelocityY(GAME_CONFIG.player.jumpForce);
        this.sound.play("sfx_jump", { volume: 0.4 });
        this.player.canDoubleJump = true;
      } else if (this.player.canDoubleJump) {
        body.setVelocityY(GAME_CONFIG.player.doubleJumpForce);
        this.player.canDoubleJump = false;
        this.sound.play("sfx_jump", { volume: 0.4, rate: 1.3 });
      }
    }

    // Dash
    const dashPressed = Phaser.Input.Keyboard.JustDown(this.keys.SHIFT) ||
                        (this.gamepad && this.gamepad.justPressed("dash"));
    if (dashPressed && this.player.dashCooldown <= 0) {
      const dir = right ? 1 : left ? -1 : (this.player.scaleX >= 0 ? 1 : -1);
      body.setVelocityX(dir * GAME_CONFIG.player.dashSpeed);
      this.player.dashCooldown = 1000;
      if (this.juice) this.juice.trailFollow(this.player, { lifespan: 200 });
    } else if (this.player.dashCooldown > 0) {
      this.player.dashCooldown -= this.sys.game.loop.delta;
    }

    // Death if fallen out of world
    if (this.player.y > 30 * GAME_CONFIG.tileSize) {
      this._die();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// WIN / GAME OVER
// ─────────────────────────────────────────────────────────────────────────
class WinScene extends Phaser.Scene {
  constructor() { super("WinScene"); }
  create(data) {
    this.add.rectangle(640, 360, 1280, 720, 0x0a0e1a);
    this.add.text(640, 280, "CONGRATULATIONS", { fontSize: "64px", color: "#ffcc00", fontFamily: "Arial Black" }).setOrigin(0.5);
    this.add.text(640, 360, `Obby cleared with ${data?.deaths || 0} deaths`, { fontSize: "22px", color: "#aaaaaa" }).setOrigin(0.5);
    const btn = this.add.text(640, 460, "Play Again", {
      fontSize: "20px", backgroundColor: "#444", color: "#fff", padding: 12,
    }).setOrigin(0.5).setInteractive();
    btn.on("pointerdown", () => location.reload());
  }
}

class GameOverScene extends Phaser.Scene {
  constructor() { super("GameOverScene"); }
  create() { this.scene.start("MenuScene"); }
}

class CheckpointScene extends Phaser.Scene { constructor() { super("CheckpointScene"); } }

// ─────────────────────────────────────────────────────────────────────────
// WINDOW __TEST__ HOOKS
// ─────────────────────────────────────────────────────────────────────────
window.__TEST__ = {
  getPlayer: () => {
    const s = game.scene.getScene("GameScene");
    if (!s || !s.player) return null;
    return { x: s.player.x, y: s.player.y, alive: !s._dying, deaths: s.deaths, checkpoint_num: s.checkpointIndex };
  },
  getStageNumber: () => {
    const s = game.scene.getScene("GameScene");
    return s ? s.stageIndex + 1 : 0;
  },
  getCurrentScene: () => {
    const active = game.scene.scenes.find(s => s.sys.settings.active);
    return active?.sys?.settings?.key || "unknown";
  },
  getDeathCount: () => {
    const s = game.scene.getScene("GameScene");
    return s ? s.deaths : 0;
  },
  getScore: () => 0,
  getLives: () => 1,
  getEnemies: () => [],
  getLevel: () => {
    const s = game.scene.getScene("GameScene");
    return s ? s.stageIndex + 1 : 1;
  },
  simulateInput: (key, down) => {
    const e = new KeyboardEvent(down ? "keydown" : "keyup", { key });
    document.dispatchEvent(e);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// GAME INIT
// ─────────────────────────────────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  parent: "game-container",
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  physics: {
    default: "arcade",
    arcade: { gravity: { y: GAME_CONFIG.gravity }, debug: false },
  },
  scene: [BootScene, PreloadScene, MenuScene, GameScene, CheckpointScene, WinScene, GameOverScene],
};
const game = new Phaser.Game(config);
window.__GAME__ = game;
