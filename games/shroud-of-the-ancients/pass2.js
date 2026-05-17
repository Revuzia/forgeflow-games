/**
 * Shroud of the Ancients — Pass 2 entry point
 *
 * Clean Phaser scaffold built fresh on top of the existing assets.
 * Replaces the broken procgen layer of game.js. Each scene is small +
 * focused; gameplay code lives in shroud_combat.js / shroud_hud.js /
 * shroud_npcs.js / shroud_save.js (added in subsequent iterations).
 *
 * Scenes:
 *   P2_Boot    → tiny preload-bar bootstrap
 *   P2_Preload → load all Act-1 assets, then start P2_Menu
 *   P2_Menu    → title screen, "New Game" / "Continue"
 *   P2_Play    → main gameplay scene (room-based exploration)
 *
 * Data: window.SHROUD_ACT1_DATA (rooms/enemies/items/audio)
 * Save: localStorage key 'shroud_save_v1'
 */
(function () {
  "use strict";

  const D = window.SHROUD_ACT1_DATA;
  if (!D) {
    console.error("[pass2] window.SHROUD_ACT1_DATA missing — load shroud_act1_data.js first");
    return;
  }

  const TILE = D.TILE;          // 16
  const ROOM_W = D.ROOM_W;      // 18
  const ROOM_H = D.ROOM_H;      // 11
  const SCREEN_W = D.SCREEN_W;  // 288
  const SCREEN_H = D.SCREEN_H;  // 176
  const SCALE = D.SCALE;        // 3 — game viewport renders at 864x528

  // ── Tile color palette ──────────────────────────────────────────
  // Drawn via Phaser Graphics until we wire a proper tileset atlas.
  // Keeps Pass 2 visually legible without depending on the old tilemap_packed.
  const TILE_COLORS = {
    '.': 0x4f7942,  // grass
    '#': 0x1a2e1a,  // wall / tree
    '~': 0x1e40af,  // water
    ':': 0x9ca3af,  // path
    'W': 0x78350f,  // weak wall
    'D': 0x451a03,  // door (rendered as floor + door overlay)
    'L': 0x713f12,  // locked door
    'B': 0x4c1d95,  // big door
    'P': 0x000000,  // pit
    's': 0xb91c1c,  // spike
    '*': 0x365314,  // bush
    '$': 0x4f7942,  // pickup spot (rendered as grass underneath)
  };

  const WALKABLE_TILES = new Set(['.', ':', 'D', 'L', 'B', '*', '$']);
  const SOLID_TILES = new Set(['#']);
  const HAZARD_TILES = new Set(['~', 'P', 's']);
  const WEAK_WALL_TILES = new Set(['W']);

  // ══════════════════════════════════════════════════════════════
  // P2_Boot — tiny bootstrap so Preload has a visible loading bar
  // ══════════════════════════════════════════════════════════════
  class BootP2 extends Phaser.Scene {
    constructor() { super("P2_Boot"); }
    create() {
      this.scene.start("P2_Preload");
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P2_Preload — load all Act 1 assets, then start Menu
  // ══════════════════════════════════════════════════════════════
  class PreloadP2 extends Phaser.Scene {
    constructor() { super("P2_Preload"); }
    preload() {
      const w = this.cameras.main.width;
      const h = this.cameras.main.height;
      this.cameras.main.setBackgroundColor(0x0a0e1a);

      const barBg = this.add.rectangle(w/2, h/2, w*0.6, 18, 0x1e293b);
      const bar = this.add.rectangle(w*0.2 + 2, h/2, 0, 14, 0x00cc66).setOrigin(0, 0.5);
      const label = this.add.text(w/2, h/2 - 30, "Loading…", { font: "16px monospace", color: "#888" }).setOrigin(0.5);
      this.load.on("progress", v => { bar.width = (w*0.6 - 4) * v; label.setText("Loading… " + Math.floor(v*100) + "%"); });

      // Protagonist sprites (existing side-view, used for top-down with rotation/tint)
      this.load.image("p_idle",   "assets/protagonist_idle.png");
      this.load.image("p_run_1",  "assets/protagonist_run_1.png");
      this.load.image("p_run_2",  "assets/protagonist_run_2.png");
      this.load.image("p_run_3",  "assets/protagonist_run_3.png");
      this.load.image("p_attack_1", "assets/protagonist_attack_1.png");
      this.load.image("p_attack_2", "assets/protagonist_attack_2.png");
      this.load.image("p_hurt",   "assets/protagonist_hurt.png");
      this.load.image("p_die",    "assets/protagonist_die.png");

      // Audio (deduplicated keys, lazy-load music)
      const seenAudio = new Set();
      Object.entries(D.AUDIO.music).forEach(([k, url]) => {
        const key = "music_" + k;
        if (seenAudio.has(url)) return;
        seenAudio.add(url);
        this.load.audio(key, url);
      });
      Object.entries(D.AUDIO.sfx).forEach(([k, url]) => {
        this.load.audio("sfx_" + k, url);
      });
    }
    create() {
      // Build the player walk anim from the 3 run frames (used by P2_Play)
      this.anims.create({
        key: "p_walk",
        frames: [{ key: "p_run_1" }, { key: "p_run_2" }, { key: "p_run_3" }],
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({
        key: "p_attack",
        frames: [{ key: "p_attack_1" }, { key: "p_attack_2" }],
        frameRate: 18,
        repeat: 0,
      });
      this.scene.start("P2_Menu");
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P2_Menu — Title + New Game / Continue
  // ══════════════════════════════════════════════════════════════
  class MenuP2 extends Phaser.Scene {
    constructor() { super("P2_Menu"); }
    create() {
      const w = this.cameras.main.width;
      const h = this.cameras.main.height;
      this.cameras.main.setBackgroundColor(0x0a0e1a);

      this.add.text(w/2, h*0.25, "SHROUD OF THE ANCIENTS", {
        font: "bold 32px serif", color: "#facc15",
      }).setOrigin(0.5);
      this.add.text(w/2, h*0.32, "Act I — The Shattered Seal", {
        font: "18px serif", color: "#94a3b8",
      }).setOrigin(0.5);

      const newBtn = this.add.text(w/2, h*0.55, "▶ New Game", {
        font: "20px monospace", color: "#22c55e",
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const contBtn = this.add.text(w/2, h*0.62, "↻ Continue", {
        font: "20px monospace", color: this._hasSave() ? "#22c55e" : "#475569",
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      this.add.text(w/2, h*0.85, "Arrows/WASD: move  ·  Z: attack  ·  X: item  ·  C: action  ·  Esc: pause", {
        font: "12px monospace", color: "#64748b",
      }).setOrigin(0.5);

      const startNew = () => {
        try { localStorage.removeItem("shroud_save_v1"); } catch (_) {}
        this.scene.start("P2_Play", { fromSave: false });
      };
      const startCont = () => {
        if (this._hasSave()) this.scene.start("P2_Play", { fromSave: true });
      };
      newBtn.on("pointerdown", startNew);
      contBtn.on("pointerdown", startCont);
      this.input.keyboard.on("keydown-ENTER", startNew);
      this.input.keyboard.on("keydown-SPACE", startNew);

      // Music
      try {
        if (this._menuMusic) this._menuMusic.stop();
        this._menuMusic = this.sound.add("music_menu", { loop: true, volume: 0.4 });
        this._menuMusic.play();
        this.events.once("shutdown", () => this._menuMusic && this._menuMusic.stop());
      } catch (_) {}
    }
    _hasSave() {
      try { return !!localStorage.getItem("shroud_save_v1"); } catch (_) { return false; }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P2_Play — main gameplay scene
  // ══════════════════════════════════════════════════════════════
  class PlayP2 extends Phaser.Scene {
    constructor() { super("P2_Play"); }
    init(data) {
      this.fromSave = data && data.fromSave;
    }
    create() {
      // Quest state (initial or loaded from save)
      this.quest = JSON.parse(JSON.stringify(D.INITIAL_QUEST_STATE));
      this.hearts = D.PLAYER.start_hearts;
      this.currentRoomId = D.PLAYER.spawn_room;
      if (this.fromSave) this._loadSave();

      // Camera + viewport
      this.cameras.main.setBackgroundColor(0x000000);
      this.cameras.main.setZoom(SCALE);
      this.cameras.main.setRoundPixels(true);

      // Root containers
      this.tileLayer = this.add.container(0, 0);
      this.entityLayer = this.add.container(0, 0);
      this.fxLayer = this.add.container(0, 0);

      // Build first room
      this._buildRoom(this.currentRoomId);

      // Player
      this.player = this.physics.add.sprite(D.PLAYER.spawn_x, D.PLAYER.spawn_y, "p_idle");
      this.player.setOrigin(0.5, 0.7);
      this.player.body.setSize(10, 8).setOffset(7, 14);
      this.player.facing = "down";
      this.player.invuln_until = 0;
      this.entityLayer.add(this.player);

      // Camera centers on the room — locked, NES-style edge transitions later
      this.cameras.main.centerOn(SCREEN_W / 2, SCREEN_H / 2);

      // Input
      this.keys = this.input.keyboard.createCursorKeys();
      this.keysWASD = this.input.keyboard.addKeys("W,A,S,D");
      this.keyZ = this.input.keyboard.addKey("Z");
      this.keyX = this.input.keyboard.addKey("X");
      this.keyC = this.input.keyboard.addKey("C");
      this.keyEsc = this.input.keyboard.addKey("ESC");

      // HUD (minimal — full HUD shipped in hud_save phase)
      this._buildHUD();

      // Music
      this._setRoomMusic();

      // Test hook
      window.__SHROUD_P2__ = {
        scene: this,
        teleport: (x, y) => { this.player.x = x; this.player.y = y; },
        goRoom: id => this._enterRoom(id, "S"),
        quest: () => this.quest,
        hurt: amt => this._damagePlayer(amt || 0.5),
        version: 1,
      };
    }

    update(time, delta) {
      const p = this.player;
      const sp = D.PLAYER.speed;
      let vx = 0, vy = 0;
      const up    = this.keys.up.isDown    || this.keysWASD.W.isDown;
      const down  = this.keys.down.isDown  || this.keysWASD.S.isDown;
      const left  = this.keys.left.isDown  || this.keysWASD.A.isDown;
      const right = this.keys.right.isDown || this.keysWASD.D.isDown;
      if (left) { vx = -sp; p.facing = "left"; p.setFlipX(true); }
      else if (right) { vx = sp; p.facing = "right"; p.setFlipX(false); }
      if (up) { vy = -sp; if (!left && !right) p.facing = "up"; }
      else if (down) { vy = sp; if (!left && !right) p.facing = "down"; }
      if (vx !== 0 && vy !== 0) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
      p.body.setVelocity(vx, vy);

      // Walk anim
      if ((vx || vy) && p.invuln_until < time) {
        if (!p.anims.isPlaying || p.anims.currentAnim?.key !== "p_walk") p.play("p_walk");
      } else if (!this.attackUntil || time > this.attackUntil) {
        p.stop();
        p.setTexture("p_idle");
      }

      // Attack
      if (Phaser.Input.Keyboard.JustDown(this.keyZ)) this._swing(time);

      // Edge-of-screen transition (NES Zelda style — door tile triggers neighbor room)
      this._checkEdgeTransitions(p);

      // Hazard tiles (spikes, pits, water)
      this._checkHazards(p, time);

      // i-frames flicker
      if (p.invuln_until > time) {
        p.alpha = (Math.floor(time / 60) % 2) === 0 ? 0.4 : 1.0;
      } else {
        p.alpha = 1.0;
      }
    }

    // ── Room management ───────────────────────────────────────────
    _buildRoom(id) {
      const room = D.ROOMS[id];
      if (!room) { console.error("[pass2] unknown room", id); return; }
      this.currentRoom = room;
      this.tileLayer.removeAll(true);
      this.entityLayer.removeAll(true);

      // Tile rendering (Graphics rect per tile)
      const g = this.add.graphics();
      this.tileLayer.add(g);
      for (let y = 0; y < ROOM_H; y++) {
        const row = room.tiles[y];
        for (let x = 0; x < ROOM_W; x++) {
          const ch = row && row[x] ? row[x] : '.';
          const color = TILE_COLORS[ch] ?? 0x222222;
          g.fillStyle(color, 1);
          g.fillRect(x * TILE, y * TILE, TILE, TILE);
          if (ch === '#') {
            // Inner shadow for depth
            g.fillStyle(0x000000, 0.2);
            g.fillRect(x * TILE, y * TILE + TILE - 2, TILE, 2);
          }
          if (ch === '*') {
            // Bush — small dark dots
            g.fillStyle(0x14532d, 1);
            g.fillCircle(x * TILE + 5, y * TILE + 7, 2);
            g.fillCircle(x * TILE + 11, y * TILE + 9, 2);
          }
        }
      }

      // NPCs
      (room.npcs || []).forEach(n => {
        const npc = this.add.rectangle(n.x, n.y, 12, 14, 0xfacc15);
        npc.setStrokeStyle(1, 0x000000);
        npc._npcData = n;
        this.entityLayer.add(npc);
        // Name label
        const label = this.add.text(n.x, n.y - 14, n.name, { font: "6px monospace", color: "#fff" }).setOrigin(0.5);
        this.entityLayer.add(label);
      });

      // Enemies + items rendered in later phases (combat + enemies)
    }

    _enterRoom(id, fromDirection) {
      const newRoom = D.ROOMS[id];
      if (!newRoom) {
        console.warn("[pass2] no neighbor room:", id);
        return;
      }
      this.currentRoomId = id;
      // Repaint
      this._buildRoom(id);
      // Re-add player to entity layer
      this.entityLayer.add(this.player);
      // Spawn position based on entry direction
      const entryPos = {
        N: { x: SCREEN_W / 2, y: TILE * 1.5 },
        S: { x: SCREEN_W / 2, y: TILE * (ROOM_H - 1.5) },
        E: { x: TILE * (ROOM_W - 1.5), y: SCREEN_H / 2 },
        W: { x: TILE * 1.5, y: SCREEN_H / 2 },
      }[fromDirection] || { x: SCREEN_W / 2, y: SCREEN_H / 2 };
      this.player.setPosition(entryPos.x, entryPos.y);
      this.player.body.setVelocity(0, 0);
      // Music swap if zone changes
      this._setRoomMusic();
    }

    _checkEdgeTransitions(p) {
      const r = this.currentRoom;
      if (!r || !r.exits) return;
      // North
      if (p.y < TILE && r.exits.N) { this._enterRoom(r.exits.N, "S"); return; }
      // South
      if (p.y > SCREEN_H - TILE * 0.5 && r.exits.S) { this._enterRoom(r.exits.S, "N"); return; }
      // East
      if (p.x > SCREEN_W - TILE * 0.5 && r.exits.E) { this._enterRoom(r.exits.E, "W"); return; }
      // West
      if (p.x < TILE * 0.5 && r.exits.W) { this._enterRoom(r.exits.W, "E"); return; }
      // Solid-wall collisions (clamp player to playable bounds)
      const tx = Math.floor(p.x / TILE);
      const ty = Math.floor(p.y / TILE);
      const ch = (r.tiles[ty] || "")[tx];
      if (SOLID_TILES.has(ch)) {
        // Push player back to last safe pos — simplistic, will refine
        p.body.setVelocity(0, 0);
        // Nudge toward center of the tile we came from
        p.x = Phaser.Math.Clamp(p.x, TILE * 1.2, SCREEN_W - TILE * 1.2);
        p.y = Phaser.Math.Clamp(p.y, TILE * 1.2, SCREEN_H - TILE * 1.2);
      }
    }

    _checkHazards(p, time) {
      if (p.invuln_until > time) return;
      const tx = Math.floor(p.x / TILE);
      const ty = Math.floor(p.y / TILE);
      const r = this.currentRoom;
      const ch = (r.tiles[ty] || "")[tx];
      if (HAZARD_TILES.has(ch)) this._damagePlayer(0.5);
    }

    _setRoomMusic() {
      const zoneToMusic = {
        canopy_village: "music_village",
        emerald_thicket: "music_thicket",
        shrine_path: "music_thicket",
        ruins_of_first_light: "music_ruins",
        boss_arena: "music_boss",
      };
      const key = zoneToMusic[this.currentRoom.zone] || "music_village";
      if (this._music && this._music.key === key) return;
      if (this._music) try { this._music.stop(); } catch (_) {}
      try {
        this._music = this.sound.add(key, { loop: true, volume: 0.3 });
        this._music.play();
      } catch (e) { /* missing audio — silent fail */ }
    }

    _buildHUD() {
      // Static overlay — does NOT scale with camera zoom
      // Phaser tip: setScrollFactor(0) + use a separate UI cam is cleaner.
      // For Pass-2 #1: just stamp text in scene-space and let it scale with zoom.
      this.hudHearts = this.add.text(2, 2, "♥".repeat(this.hearts), { font: "10px monospace", color: "#ff3344" });
      this.hudHearts.setScrollFactor(0);
      this.tileLayer.add(this.hudHearts);
    }

    _refreshHUD() {
      if (this.hudHearts) this.hudHearts.setText("♥".repeat(Math.ceil(this.hearts)));
    }

    // ── Combat (placeholder — full impl in `combat` phase) ──
    _swing(time) {
      if (this.attackUntil && time < this.attackUntil) return;
      this.attackUntil = time + 280;
      try { this.sound.play("sfx_attack", { volume: 0.6 }); } catch (_) {}
      this.player.play("p_attack");
      // TODO: spawn hitbox in facing direction, check enemy overlap
    }

    _damagePlayer(amount) {
      const time = this.time.now;
      if (this.player.invuln_until > time) return;
      this.hearts = Math.max(0, this.hearts - amount);
      this.player.invuln_until = time + D.PLAYER.invuln_ms;
      try { this.sound.play("sfx_hurt", { volume: 0.6 }); } catch (_) {}
      this._refreshHUD();
      if (this.hearts <= 0) this._gameOver();
    }

    _gameOver() {
      this.scene.pause();
      this.cameras.main.fade(800, 0, 0, 0);
      this.time.delayedCall(900, () => this.scene.start("P2_Menu"));
    }

    _loadSave() {
      try {
        const raw = localStorage.getItem("shroud_save_v1");
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.quest) this.quest = s.quest;
        if (typeof s.hearts === "number") this.hearts = s.hearts;
        if (s.roomId) this.currentRoomId = s.roomId;
      } catch (_) {}
    }

    _writeSave() {
      try {
        const s = { quest: this.quest, hearts: this.hearts, roomId: this.currentRoomId };
        localStorage.setItem("shroud_save_v1", JSON.stringify(s));
      } catch (_) {}
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Game init
  // ══════════════════════════════════════════════════════════════
  function start() {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: SCREEN_W * SCALE,
      height: SCREEN_H * SCALE,
      parent: "game-container",
      backgroundColor: "#000",
      pixelArt: true,
      antialias: false,
      physics: {
        default: "arcade",
        arcade: { gravity: { y: 0 }, debug: false },
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [BootP2, PreloadP2, MenuP2, PlayP2],
    });
    window.__GAME_P2__ = game;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
