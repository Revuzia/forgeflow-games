/**
 * ForgeFlow Games — Phaser Board Game Template
 *
 * Reusable scaffold for digital board games (Catan, Azul, Codenames, etc.).
 * The pipeline fills in {{PLACEHOLDERS}} with game-specific values.
 *
 * Features:
 * - Phaser 3.90, NO physics engine
 * - Mouse/touch input only
 * - Turn-based state machine (player1 → player2 → ...)
 * - Grid-based board (configurable size)
 * - Piece placement / selection via click
 * - Score/resource tracking per player
 * - Win condition checking
 * - AI opponent (simple random + greedy)
 * - HUD: current player, scores, turn number
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
  board: {
    rows: 8,
    cols: 8,
    cellSize: 48,
    offsetX: 0,  // Computed in create()
    offsetY: 0,
    lineColor: 0x334155,
    highlightColor: 0x00cc66,
    invalidColor: 0xff3366,
  },
  players: {
    count: 2,
    names: ["Player 1", "Player 2"],
    colors: [0x3388ff, 0xff5533],
    colorHex: ["#3388ff", "#ff5533"],
    aiControlled: [false, true],  // Player 2 is AI by default
  },
  ai: {
    thinkDelay: 600,  // ms delay to simulate "thinking"
    strategy: "greedy",  // "random" or "greedy"
  },
  audio: {
    musicVolume: 0.3,
    sfxVolume: 0.6,
  },
  levels: {{LEVEL_DATA}},  // Filled by pipeline (board configurations)
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
      g.fillStyle(0x3388ff, 1);
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
    const bar = this.add.rectangle(width * 0.2 + 2, height / 2, 0, 20, 0x3388ff).setOrigin(0, 0.5);
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

    // {{CUSTOM_SPRITE_LOADS}}

    // ── AUDIO ──
    this.load.audio("sfx_place", "assets/audio/sfx_place.ogg");
    this.load.audio("sfx_select", "assets/audio/sfx_select.ogg");
    this.load.audio("sfx_invalid", "assets/audio/sfx_invalid.ogg");
    this.load.audio("sfx_capture", "assets/audio/sfx_capture.ogg");
    this.load.audio("sfx_turn", "assets/audio/sfx_turn.ogg");
    this.load.audio("sfx_win", "assets/audio/sfx_win.ogg");
    this.load.audio("sfx_game_over", "assets/audio/sfx_game_over.ogg");

    this.load.audio("music_menu", "assets/audio/music_menu.ogg");
    this.load.audio("music_level", "assets/audio/music_level.ogg");

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

    this.add.text(width / 2, height * 0.25, GAME_CONFIG.title, {
      font: "bold 48px Arial",
      color: GAME_CONFIG.colors.accent,
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.38, "{{GAME_TAGLINE}}", {
      font: "18px Arial", color: "#888888",
    }).setOrigin(0.5);

    // 1 Player
    const btn1p = this.add.text(width / 2, height * 0.54, "VS COMPUTER", {
      font: "bold 26px Arial", color: "#ffffff", backgroundColor: "#3388ff",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn1p.on("pointerover", () => btn1p.setStyle({ backgroundColor: "#2266cc" }));
    btn1p.on("pointerout", () => btn1p.setStyle({ backgroundColor: "#3388ff" }));
    btn1p.on("pointerdown", () => {
      this.sound.stopAll();
      this.scene.start("Game", { vsAI: true, level: 0 });
    });

    // 2 Player
    const btn2p = this.add.text(width / 2, height * 0.68, "2 PLAYERS", {
      font: "bold 26px Arial", color: "#ffffff", backgroundColor: "#ff5533",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn2p.on("pointerover", () => btn2p.setStyle({ backgroundColor: "#cc3322" }));
    btn2p.on("pointerout", () => btn2p.setStyle({ backgroundColor: "#ff5533" }));
    btn2p.on("pointerdown", () => {
      this.sound.stopAll();
      this.scene.start("Game", { vsAI: false, level: 0 });
    });

    // Controls
    this.add.text(width / 2, height * 0.82, "Click to place pieces  |  {{EXTRA_CONTROLS}}", {
      font: "14px Arial", color: "#666666",
    }).setOrigin(0.5);

    if (this.sound.get("music_menu")) {
      this.sound.play("music_menu", { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME SCENE — Core board game logic
// ═══════════════════════════════════════════════════════════════

class GameScene extends Phaser.Scene {
  constructor() { super("Game"); }

  init(data) {
    this.currentLevel = data.level || 0;
    this.vsAI = data.vsAI !== undefined ? data.vsAI : true;
    this.currentPlayer = 0;  // Index into players array
    this.turnNumber = 1;
    this.scores = new Array(GAME_CONFIG.players.count).fill(0);
    this.gameOver = false;
    this.selectedCell = null;
    this.board = [];  // 2D array: board[row][col] = null | { player: 0|1, type: ... }
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(GAME_CONFIG.colors.bg);

    this.sound.stopAll();
    try {
      this.sound.play("music_level", { loop: true, volume: GAME_CONFIG.audio.musicVolume });
    } catch (e) {}

    // ── BOARD SETUP ──
    const levelData = GAME_CONFIG.levels[this.currentLevel];
    if (levelData) {
      GAME_CONFIG.board.rows = levelData.rows || GAME_CONFIG.board.rows;
      GAME_CONFIG.board.cols = levelData.cols || GAME_CONFIG.board.cols;
      GAME_CONFIG.board.cellSize = levelData.cellSize || GAME_CONFIG.board.cellSize;
    }

    const bCfg = GAME_CONFIG.board;
    const boardWidth = bCfg.cols * bCfg.cellSize;
    const boardHeight = bCfg.rows * bCfg.cellSize;
    bCfg.offsetX = Math.floor((width - boardWidth) / 2);
    bCfg.offsetY = Math.floor((height - boardHeight) / 2) + 10;

    // Initialize empty board
    this.board = [];
    for (let r = 0; r < bCfg.rows; r++) {
      this.board[r] = [];
      for (let c = 0; c < bCfg.cols; c++) {
        this.board[r][c] = null;
      }
    }

    // Pre-place pieces from level data
    if (levelData && levelData.initialPieces) {
      for (const p of levelData.initialPieces) {
        this.board[p.row][p.col] = { player: p.player, type: p.type || "piece" };
      }
    }

    // ── DRAW ──
    this.boardGraphics = this.add.graphics();
    this.piecesGroup = this.add.group();
    this.highlightGraphics = this.add.graphics().setDepth(5);

    this.drawBoard();
    this.drawPieces();

    // ── HUD ──
    this.createHUD();

    // ── INPUT ──
    this.input.on("pointerdown", (pointer) => this.handleClick(pointer));
    this.input.on("pointermove", (pointer) => this.handleHover(pointer));

    // ── TEST HOOKS ──
    this.exposeTestAPI();

    // ── PAUSE ──
    this.input.keyboard.on("keydown-ESC", () => {
      this.scene.launch("Pause");
      this.scene.pause();
    });
  }

  drawBoard() {
    const g = this.boardGraphics;
    const bCfg = GAME_CONFIG.board;
    g.clear();

    // Board background
    g.fillStyle(0x1a2233, 1);
    g.fillRect(bCfg.offsetX, bCfg.offsetY, bCfg.cols * bCfg.cellSize, bCfg.rows * bCfg.cellSize);

    // Grid lines
    g.lineStyle(1, bCfg.lineColor, 0.8);
    for (let r = 0; r <= bCfg.rows; r++) {
      const y = bCfg.offsetY + r * bCfg.cellSize;
      g.lineBetween(bCfg.offsetX, y, bCfg.offsetX + bCfg.cols * bCfg.cellSize, y);
    }
    for (let c = 0; c <= bCfg.cols; c++) {
      const x = bCfg.offsetX + c * bCfg.cellSize;
      g.lineBetween(x, bCfg.offsetY, x, bCfg.offsetY + bCfg.rows * bCfg.cellSize);
    }

    // Checkerboard pattern
    for (let r = 0; r < bCfg.rows; r++) {
      for (let c = 0; c < bCfg.cols; c++) {
        if ((r + c) % 2 === 0) {
          g.fillStyle(0x1e2d44, 0.5);
          g.fillRect(bCfg.offsetX + c * bCfg.cellSize, bCfg.offsetY + r * bCfg.cellSize, bCfg.cellSize, bCfg.cellSize);
        }
      }
    }
  }

  drawPieces() {
    // Clear existing piece sprites
    this.piecesGroup.clear(true, true);

    const bCfg = GAME_CONFIG.board;
    for (let r = 0; r < bCfg.rows; r++) {
      for (let c = 0; c < bCfg.cols; c++) {
        const cell = this.board[r][c];
        if (cell !== null) {
          const px = bCfg.offsetX + c * bCfg.cellSize + bCfg.cellSize / 2;
          const py = bCfg.offsetY + r * bCfg.cellSize + bCfg.cellSize / 2;
          const radius = bCfg.cellSize * 0.35;
          const piece = this.add.circle(px, py, radius, GAME_CONFIG.players.colors[cell.player]);
          piece.setStrokeStyle(2, 0xffffff, 0.6);
          piece.setDepth(10);
          this.piecesGroup.add(piece);
        }
      }
    }
  }

  createHUD() {
    const { width } = this.cameras.main;
    const hudStyle = { font: "bold 16px Arial", color: "#ffffff", stroke: "#000", strokeThickness: 3 };

    // Current player indicator
    this.turnText = this.add.text(width / 2, 14, "", hudStyle)
      .setOrigin(0.5, 0).setDepth(100);

    // Scores — left side
    this.scoreTexts = [];
    for (let i = 0; i < GAME_CONFIG.players.count; i++) {
      const label = GAME_CONFIG.players.names[i] + (this.vsAI && GAME_CONFIG.players.aiControlled[i] ? " (AI)" : "");
      const st = this.add.text(16, 14 + i * 22, `${label}: ${this.scores[i]}`, {
        ...hudStyle,
        color: GAME_CONFIG.players.colorHex[i],
      }).setDepth(100);
      this.scoreTexts.push(st);
    }

    // Turn number — right side
    this.turnNumText = this.add.text(width - 16, 14, `Turn ${this.turnNumber}`, hudStyle)
      .setOrigin(1, 0).setDepth(100);

    this.updateHUD();
  }

  updateHUD() {
    const name = GAME_CONFIG.players.names[this.currentPlayer];
    this.turnText.setText(`${name}'s Turn`);
    this.turnText.setColor(GAME_CONFIG.players.colorHex[this.currentPlayer]);

    for (let i = 0; i < this.scoreTexts.length; i++) {
      const label = GAME_CONFIG.players.names[i] + (this.vsAI && GAME_CONFIG.players.aiControlled[i] ? " (AI)" : "");
      this.scoreTexts[i].setText(`${label}: ${this.scores[i]}`);
    }

    this.turnNumText.setText(`Turn ${this.turnNumber}`);
  }

  // ── GRID HELPERS ──

  pixelToGrid(px, py) {
    const bCfg = GAME_CONFIG.board;
    const col = Math.floor((px - bCfg.offsetX) / bCfg.cellSize);
    const row = Math.floor((py - bCfg.offsetY) / bCfg.cellSize);
    if (row >= 0 && row < bCfg.rows && col >= 0 && col < bCfg.cols) {
      return { row, col };
    }
    return null;
  }

  gridToPixel(row, col) {
    const bCfg = GAME_CONFIG.board;
    return {
      x: bCfg.offsetX + col * bCfg.cellSize + bCfg.cellSize / 2,
      y: bCfg.offsetY + row * bCfg.cellSize + bCfg.cellSize / 2,
    };
  }

  // ── INPUT HANDLING ──

  handleHover(pointer) {
    if (this.gameOver) return;
    this.highlightGraphics.clear();

    const cell = this.pixelToGrid(pointer.x, pointer.y);
    if (!cell) return;

    const bCfg = GAME_CONFIG.board;
    const isValid = this.isValidMove(cell.row, cell.col, this.currentPlayer);
    const color = isValid ? bCfg.highlightColor : bCfg.invalidColor;

    this.highlightGraphics.lineStyle(2, color, 0.8);
    this.highlightGraphics.strokeRect(
      bCfg.offsetX + cell.col * bCfg.cellSize,
      bCfg.offsetY + cell.row * bCfg.cellSize,
      bCfg.cellSize, bCfg.cellSize
    );
  }

  handleClick(pointer) {
    if (this.gameOver) return;

    // Ignore if it's an AI-controlled player's turn
    if (this.vsAI && GAME_CONFIG.players.aiControlled[this.currentPlayer]) return;

    const cell = this.pixelToGrid(pointer.x, pointer.y);
    if (!cell) return;

    this.attemptMove(cell.row, cell.col, this.currentPlayer);
  }

  // ── MOVE LOGIC ──

  isValidMove(row, col, player) {
    // Default: cell must be empty
    if (this.board[row][col] !== null) return false;
    return true;
  }

  attemptMove(row, col, player) {
    if (!this.isValidMove(row, col, player)) {
      this.playSound("sfx_invalid");
      return false;
    }

    // Place piece
    this.board[row][col] = { player: player, type: "piece" };
    this.playSound("sfx_place");

    // Check for captures (simple: adjacent opponent pieces)
    const captured = this.checkCaptures(row, col, player);
    this.scores[player] += 1 + captured;

    // Redraw
    this.drawPieces();
    this.updateHUD();

    // Visual feedback
    const pos = this.gridToPixel(row, col);
    this.showFloatText(pos.x, pos.y - 20, "+1", GAME_CONFIG.players.colorHex[player]);

    // Check win
    if (this.checkWinCondition(player)) {
      this.endGame(player);
      return true;
    }

    // Check draw (board full)
    if (this.isBoardFull()) {
      this.endGame(-1); // draw
      return true;
    }

    // Next turn
    this.nextTurn();
    return true;
  }

  checkCaptures(row, col, player) {
    // Simple capture: check 4 directions for sandwich pattern (player-opponent-player)
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let totalCaptured = 0;

    for (const [dr, dc] of dirs) {
      const mr = row + dr;
      const mc = col + dc;
      const fr = row + dr * 2;
      const fc = col + dc * 2;

      if (mr >= 0 && mr < GAME_CONFIG.board.rows && mc >= 0 && mc < GAME_CONFIG.board.cols &&
          fr >= 0 && fr < GAME_CONFIG.board.rows && fc >= 0 && fc < GAME_CONFIG.board.cols) {
        const mid = this.board[mr][mc];
        const far = this.board[fr][fc];

        if (mid && mid.player !== player && far && far.player === player) {
          // Capture the middle piece
          this.board[mr][mc] = { player: player, type: "piece" };
          totalCaptured++;
          this.playSound("sfx_capture");

          const pos = this.gridToPixel(mr, mc);
          this.showFloatText(pos.x, pos.y - 10, "CAPTURED", "#ffcc00");
        }
      }
    }

    return totalCaptured;
  }

  checkWinCondition(player) {
    // Default: first to reach score threshold wins
    const levelData = GAME_CONFIG.levels[this.currentLevel];
    const threshold = (levelData && levelData.winScore) ? levelData.winScore : 15;
    return this.scores[player] >= threshold;
  }

  isBoardFull() {
    for (let r = 0; r < GAME_CONFIG.board.rows; r++) {
      for (let c = 0; c < GAME_CONFIG.board.cols; c++) {
        if (this.board[r][c] === null) return false;
      }
    }
    return true;
  }

  nextTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % GAME_CONFIG.players.count;
    if (this.currentPlayer === 0) this.turnNumber++;
    this.playSound("sfx_turn");
    this.updateHUD();

    // If next player is AI, trigger AI move
    if (this.vsAI && GAME_CONFIG.players.aiControlled[this.currentPlayer] && !this.gameOver) {
      this.time.delayedCall(GAME_CONFIG.ai.thinkDelay, () => this.aiMove());
    }
  }

  // ── AI ──

  aiMove() {
    if (this.gameOver) return;

    const moves = this.getValidMoves();
    if (moves.length === 0) {
      // No valid moves, skip turn
      this.nextTurn();
      return;
    }

    let chosen;
    if (GAME_CONFIG.ai.strategy === "greedy") {
      chosen = this.aiGreedy(moves);
    } else {
      chosen = moves[Math.floor(Math.random() * moves.length)];
    }

    this.attemptMove(chosen.row, chosen.col, this.currentPlayer);
  }

  aiGreedy(moves) {
    // Score each move by: captures + center preference
    let bestScore = -Infinity;
    let bestMove = moves[0];
    const centerR = GAME_CONFIG.board.rows / 2;
    const centerC = GAME_CONFIG.board.cols / 2;

    for (const m of moves) {
      // Simulate captures
      let score = 0;
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const mr = m.row + dr;
        const mc = m.col + dc;
        const fr = m.row + dr * 2;
        const fc = m.col + dc * 2;
        if (mr >= 0 && mr < GAME_CONFIG.board.rows && mc >= 0 && mc < GAME_CONFIG.board.cols &&
            fr >= 0 && fr < GAME_CONFIG.board.rows && fc >= 0 && fc < GAME_CONFIG.board.cols) {
          const mid = this.board[mr][mc];
          const far = this.board[fr][fc];
          if (mid && mid.player !== this.currentPlayer && far && far.player === this.currentPlayer) {
            score += 5;
          }
        }
      }

      // Center preference (small bonus)
      const distToCenter = Math.abs(m.row - centerR) + Math.abs(m.col - centerC);
      score += (GAME_CONFIG.board.rows - distToCenter) * 0.3;

      // Randomize ties
      score += Math.random() * 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
    }

    return bestMove;
  }

  getValidMoves() {
    const moves = [];
    for (let r = 0; r < GAME_CONFIG.board.rows; r++) {
      for (let c = 0; c < GAME_CONFIG.board.cols; c++) {
        if (this.isValidMove(r, c, this.currentPlayer)) {
          moves.push({ row: r, col: c });
        }
      }
    }
    return moves;
  }

  // ── END GAME ──

  endGame(winnerIndex) {
    this.gameOver = true;
    this.sound.stopAll();

    if (winnerIndex >= 0) {
      this.playSound("sfx_win");
      this.time.delayedCall(1200, () => {
        this.scene.start("Win", {
          score: this.scores[winnerIndex],
          winner: GAME_CONFIG.players.names[winnerIndex],
          scores: [...this.scores],
        });
      });
    } else {
      // Draw
      this.playSound("sfx_game_over");
      this.time.delayedCall(1200, () => {
        this.scene.start("GameOver", {
          score: Math.max(...this.scores),
          scores: [...this.scores],
          draw: true,
        });
      });
    }

    // Notify parent
    try {
      window.parent.postMessage({
        type: "forgeflow:level_complete",
        level: this.currentLevel,
        score: this.scores[0],
      }, "*");
    } catch (e) {}
  }

  // ── UTILITIES ──

  playSound(key) {
    try {
      this.sound.play(key, { volume: GAME_CONFIG.audio.sfxVolume });
    } catch (e) {}
  }

  showFloatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      font: "bold 14px Arial", color: color, stroke: "#000", strokeThickness: 2,
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 800,
      onComplete: () => t.destroy(),
    });
  }

  // ── TEST API ──
  exposeTestAPI() {
    window.__TEST__ = {
      getPlayer: () => ({
        currentPlayer: this.currentPlayer,
        name: GAME_CONFIG.players.names[this.currentPlayer],
        isAI: this.vsAI && GAME_CONFIG.players.aiControlled[this.currentPlayer],
        scores: [...this.scores],
      }),
      getScore: () => this.scores[0],
      getLives: () => this.turnNumber,
      getEnemies: () => [],  // Not applicable to board games
      getCurrentScene: () => this.scene.key,
      getLevel: () => this.currentLevel,
      getBoard: () => this.board.map(row => row.map(cell => cell ? { ...cell } : null)),
      getTurn: () => this.turnNumber,
      getScores: () => [...this.scores],
      simulateInput: (key, duration = 100) => {
        this.input.keyboard.emit(`keydown-${key}`);
        setTimeout(() => this.input.keyboard.emit(`keyup-${key}`), duration);
      },
      simulateClick: (row, col) => {
        const pos = this.gridToPixel(row, col);
        this.handleClick({ x: pos.x, y: pos.y });
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
      font: "24px Arial", color: "#3388ff", backgroundColor: "#1e293b",
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
    this.allScores = data.scores || [0, 0];
    this.isDraw = data.draw || false;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor("#0a0e1a");

    const title = this.isDraw ? "DRAW!" : "GAME OVER";
    this.add.text(width / 2, height * 0.25, title, {
      font: "bold 56px Arial", color: this.isDraw ? "#ffcc00" : "#ff3366",
      stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);

    // Show all scores
    for (let i = 0; i < this.allScores.length; i++) {
      this.add.text(width / 2, height * 0.42 + i * 28,
        `${GAME_CONFIG.players.names[i]}: ${this.allScores[i]}`, {
          font: "22px Arial", color: GAME_CONFIG.players.colorHex[i],
        }).setOrigin(0.5);
    }

    const retry = this.add.text(width / 2, height * 0.65, "Play Again", {
      font: "bold 28px Arial", color: "#ffffff", backgroundColor: "#3388ff",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    retry.on("pointerdown", () => this.scene.start("Game", { level: 0, vsAI: true }));

    const menu = this.add.text(width / 2, height * 0.78, "Main Menu", {
      font: "20px Arial", color: "#888888",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    menu.on("pointerdown", () => this.scene.start("Menu"));

    this.input.keyboard.on("keydown-SPACE", () => this.scene.start("Game", { level: 0, vsAI: true }));

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
    this.winner = data.winner || "Player 1";
    this.allScores = data.scores || [0, 0];
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor("#0a0e1a");

    this.add.text(width / 2, height * 0.22, `${this.winner} WINS!`, {
      font: "bold 48px Arial", color: "#00ff88",
      stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);

    for (let i = 0; i < this.allScores.length; i++) {
      this.add.text(width / 2, height * 0.40 + i * 28,
        `${GAME_CONFIG.players.names[i]}: ${this.allScores[i]}`, {
          font: "22px Arial", color: GAME_CONFIG.players.colorHex[i],
        }).setOrigin(0.5);
    }

    const again = this.add.text(width / 2, height * 0.62, "Play Again", {
      font: "bold 28px Arial", color: "#ffffff", backgroundColor: "#00ff88",
      padding: { x: 36, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    again.on("pointerdown", () => this.scene.start("Game", { level: 0, vsAI: true }));

    this.input.keyboard.on("keydown-SPACE", () => this.scene.start("Game", { level: 0, vsAI: true }));

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
