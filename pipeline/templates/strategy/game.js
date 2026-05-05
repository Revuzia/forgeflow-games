/**
 * ForgeFlow Games — BARE Engine Harness for STRATEGY games
 *
 * 2026-05-05 philosophy shift: templates are pure engine harness.
 * Research → design.json → sub-phase patches drive 100% of gameplay.
 * The template provides ONLY:
 *   • Phaser 3 boot + preload + menu + game + gameover + win scenes
 *     (empty stubs — sub-phase patches inject ALL gameplay)
 *   • window.__TEST__ hooks so the L0–L8 QA stack can introspect
 *   • Standard placeholder tokens the integrate phase substitutes
 *   • A `new Phaser.Game(config)` instantiation
 *
 * Anything else (turn-state machine, grid renderer, units, AI, fog of
 * war, resource economy, victory conditions, etc.) belongs in
 * patches — written by Claude from the design that the research phase
 * produced. The template should never assume what the strategy game IS.
 */

// ═══════════════════════════════════════════════════════════════
// GAME CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const GAME_CONFIG = {
  title: "{{GAME_TITLE}}",
  width: 960,
  height: 540,
  audio: { musicVolume: 0.3, sfxVolume: 0.6 },
  levels: {{LEVEL_DATA}},  // Filled by pipeline (scenarios from design)
  colors: {
    bg: "#{{BG_COLOR}}",
    accent: "#{{ACCENT_COLOR}}",
    text: "#ffffff",
  },
};

// Runtime state — patches extend this object with game-specific fields.
const gameState = {
  currentScene: null,
  currentLevel: 0,
};

window.GAME_DESIGN = {{GAME_DESIGN_JSON}};
window.__TEST__ = window.__TEST__ || {};
window.__TEST__.getGameConfig = () => ({ ...GAME_CONFIG });
window.__TEST__.getGameState = () => ({ ...gameState });

// ═══════════════════════════════════════════════════════════════
// SCENES — empty stubs. Patches override create() with real gameplay.
// ═══════════════════════════════════════════════════════════════

class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }
  create() { this.scene.start("Preload"); }
}

class PreloadScene extends Phaser.Scene {
  constructor() { super("Preload"); }
  preload() {
    // {{CUSTOM_SPRITE_LOADS}} — Pipeline inserts game-specific sprites here
    // {{CUSTOM_AUDIO_LOADS}} — Pipeline inserts game-specific audio here
  }
  create() { this.scene.start("Menu"); }
}

class MenuScene extends Phaser.Scene {
  constructor() { super("Menu"); }
  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);
    this.add.text(width / 2, height * 0.35, GAME_CONFIG.title, {
      font: "bold 40px Arial", color: GAME_CONFIG.colors.accent,
    }).setOrigin(0.5);
    this.add.text(width / 2, height * 0.5, "{{GAME_TAGLINE}}", {
      font: "16px Arial", color: "#cbd5e1",
    }).setOrigin(0.5);
    const startBtn = this.add.text(width / 2, height * 0.7, "▶ Start", {
      font: "22px Arial", color: "#ffffff",
      backgroundColor: GAME_CONFIG.colors.accent, padding: { x: 18, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    startBtn.on("pointerdown", () => this.scene.start("Game", { level: 0 }));
    if (window.__TEST__) window.__TEST__.getCurrentScene = () => "Menu";
  }
}

class GameScene extends Phaser.Scene {
  constructor() { super("Game"); }
  init(data) {
    gameState.currentScene = "Game";
    gameState.currentLevel = (data && typeof data.level === "number") ? data.level : 0;
  }
  create() {
    // Empty stub. Patches override / extend via GameScene.prototype.
    if (window.__TEST__) {
      window.__TEST__.getCurrentScene = () => "Game";
      window.__TEST__.getCurrentLevel = () => gameState.currentLevel;
    }
  }
  update() {
    // Empty stub.
  }
}

class GameOverScene extends Phaser.Scene {
  constructor() { super("GameOver"); }
  create() {
    if (window.__TEST__) window.__TEST__.getCurrentScene = () => "GameOver";
  }
}

class WinScene extends Phaser.Scene {
  constructor() { super("Win"); }
  create() {
    if (window.__TEST__) window.__TEST__.getCurrentScene = () => "Win";
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
  physics: { default: "arcade", arcade: { gravity: { y: 0 } } },
  scene: [BootScene, PreloadScene, MenuScene, GameScene, GameOverScene, WinScene],
};

const game = new Phaser.Game(phaserConfig);
window.__GAME__ = game;
