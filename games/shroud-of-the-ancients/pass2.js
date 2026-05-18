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

  // Map tile code → Kenney roguelike_sheet frame index (col + row * 56).
  // The sheet is 56 cols × 30 rows of 16×16 tiles with 1px gap. Frames are
  // best-guess; tweak the indices if any look wrong in playtest.
  const TILE_FRAMES = {
    '.': 0,                  // grass (col 0, row 0)
    '#': 5,                  // dark wall / stone
    '~': 4 + 56 * 0,         // water (col 4 row 0 = 4)  [tweak if wrong]
    ':': 1,                  // stone path (col 1 row 0)
    'W': 5 + 56 * 1,         // weak wall (cracked stone, row 1 col 5)
    'D': 1,                  // door tile floor (path)
    'L': 1,                  // locked-door tile (path under lock icon)
    'B': 1,                  // big-door tile (path under lock icon)
    'P': null,               // pit — pure black (no sprite)
    's': null,               // spike — drawn separately
    '*': 6,                  // bush (col 6 row 0)
    '$': 0,                  // pickup spot = grass
  };

  const TILE_DRAW_DECOR = {
    'L': { color: 0xfacc15, shape: "lock_small" },
    'B': { color: 0xa855f7, shape: "lock_big" },
    'D': { color: 0x451a03, shape: "door" },
    's': { color: 0xb91c1c, shape: "spike" },
    'P': { color: 0x000000, shape: "pit" },
  };

  const WALKABLE_TILES = new Set(['.', ':', 'D', 'L', 'B', '*', '$']);
  const SOLID_TILES = new Set(['#']);
  const HAZARD_TILES = new Set(['~', 'P', 's']);
  const WEAK_WALL_TILES = new Set(['W']);

  // Item kinds that spawn inside a closed treasure chest (must be opened by
  // walking onto them — animated lid lift + sparkles + item-rise overhead).
  // Consumable kinds (heart/rupee/bomb_refill/flower) auto-pickup as floor icons.
  const CHEST_KINDS = new Set([
    'small_key', 'big_key', 'heart_piece', 'heart_container',
    'bow', 'bombs', 'boomerang',
    'dungeon_map', 'dungeon_compass',
  ]);

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

      // Real Kenney atlases — replace the colored-rectangle placeholders
      this.load.atlasXML("enemies_atlas", "assets/enemies.png", "assets/enemies.xml");
      // Kenney "Roguelike characters" sheet — 17×17 cell grid (16+1 spacing).
      this.load.spritesheet("rl_chars", "assets/roguelike_chars.png", {
        frameWidth: 16, frameHeight: 16, spacing: 1, margin: 0,
      });
      // Kenney "Roguelike/RPG" tilesheet — 968×526 = 57 cols × 31 rows of
      // 16×16 cells with 1px gap (margin 0). Used for tile rendering.
      this.load.spritesheet("rl_tiles", "assets/roguelike_sheet.png", {
        frameWidth: 16, frameHeight: 16, spacing: 1, margin: 0,
      });
      this.load.image("uipack_rpg", "assets/uipack_rpg_sheet.png");
      // Zone backgrounds (atmospheric — used as room backdrop when present)
      this.load.image("world_01_bg", "assets/world_01_bg.jpg");
      this.load.image("world_02_bg", "assets/world_02_bg.jpg");
      this.load.image("world_03_bg", "assets/world_03_bg.jpg");
      this.load.image("world_04_bg", "assets/world_04_bg.jpg");

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
      // Build per-enemy walk anims from the Kenney atlas
      const animEnemies = Object.entries(D.ENEMIES).concat(Object.entries(D.BOSSES));
      for (const [tplName, tpl] of animEnemies) {
        if (!tpl.sprite_rest) continue;
        const moveFrames = [tpl.sprite_move_a, tpl.sprite_move_b].filter(Boolean);
        if (moveFrames.length > 0) {
          this.anims.create({
            key: "anim_" + tplName,
            frames: moveFrames.map(f => ({ key: "enemies_atlas", frame: f })),
            frameRate: 4,
            repeat: -1,
          });
        }
      }
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
      // Reset max_hearts to baseline on every game start — singleton D.PLAYER
      // is shared across scene restarts, so a previous run's heart-container
      // pickups would leak into a New Game otherwise.
      if (typeof D._BASELINE_MAX_HEARTS !== "number") D._BASELINE_MAX_HEARTS = D.PLAYER.max_hearts;
      D.PLAYER.max_hearts = D._BASELINE_MAX_HEARTS;
      this.hearts = D.PLAYER.start_hearts;
      this.currentRoomId = D.PLAYER.spawn_room;
      // Reset per-run state
      this._doorUnlocks = {};
      this._brokenWalls = {};
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
      // Player spawn — if loaded from save, place in center of current room
      // (rough but always reachable); otherwise use designed village_square spawn.
      const spawnX = this.fromSave ? SCREEN_W / 2 : D.PLAYER.spawn_x;
      const spawnY = this.fromSave ? SCREEN_H / 2 : D.PLAYER.spawn_y;
      // Use the existing 64×64 protagonist_*.png — Kaelen the relic seeker.
      // Scale down to 20px target so the character fits inside a tile-and-
      // a-bit on screen but is still clearly visible (not the previous
      // ~10px mushroom-looking Kenney frame).
      this.player = this.physics.add.sprite(spawnX, spawnY, "p_idle");
      const PLAYER_TARGET_PX = 32;
      this.player.setScale(PLAYER_TARGET_PX / 64);
      this.player.setOrigin(0.5, 0.85);
      // Body footprint = bottom-center 24x14 of the 64x64 sprite. After scale
      // 32/64=0.5, the actual body is 12x7 — fits comfortably inside one
      // 16x16 tile so movement between tiles is smooth.
      this.player.body.setSize(24, 14).setOffset(20, 46);
      this.player.facing = "down";
      this.player.invuln_until = this.fromSave ? (this.time.now + 2500) : 0;
      this.player.knockback_until = 0;
      this.player._usingTopDown = false;
      this.player._currentAnimState = null;
      this.entityLayer.add(this.player);
      // Now that the player exists, hook up the wall collider for the
      // initial room (was created during _buildRoom but didn't have a
      // player to bind to).
      this._attachWallCollider();

      // Enemies + items (spawned by _buildRoom for the current room)
      this.enemies = [];          // active enemy sprites
      this.itemsOnGround = [];    // pickup sprites
      this._spawnRoomEntities();

      // Sword hitbox (recycled across swings)
      this.hitbox = this.add.rectangle(0, 0, 14, 10, 0xfacc15, 0).setStrokeStyle(0).setVisible(false);
      this.physics.add.existing(this.hitbox);
      this.hitbox.body.setAllowGravity && this.hitbox.body.setAllowGravity(false);
      this.hitbox.body.checkCollision.none = true;  // not blocked by anything
      this.fxLayer.add(this.hitbox);

      // Item-slot state (B-button equivalent — cycled via C key)
      // Player gains items by collecting them; flags govern availability.
      this.currentItem = null;        // 'bow' | 'bombs' | 'boomerang' | null
      this.bombCount = 0;             // depleted on use, refilled from pickups (will add bomb_pickup later)
      this._refreshItemSlot();

      // Arrow projectile pool (8 arrows — Zelda canon: cap concurrent shots)
      this.arrows = [];
      for (let i = 0; i < 8; i++) {
        const a = this.add.rectangle(-100, -100, 6, 2, 0xfde047);
        a.setStrokeStyle(1, 0x422006);
        this.physics.add.existing(a);
        a.body.setAllowGravity && a.body.setAllowGravity(false);
        a.body.setSize(6, 4);
        a.active = false;
        a.setVisible(false);
        a._embed_until = 0;
        this.fxLayer.add(a);
        this.arrows.push(a);
      }

      // Bomb list (sparse — max ~4 active bombs at once)
      this.bombs = [];

      // Camera centers on the room — locked, NES-style edge transitions later
      this.cameras.main.centerOn(SCREEN_W / 2, SCREEN_H / 2);

      // Input
      this.keys = this.input.keyboard.createCursorKeys();
      this.keysWASD = this.input.keyboard.addKeys("W,A,S,D");
      this.keyZ = this.input.keyboard.addKey("Z");
      this.keyX = this.input.keyboard.addKey("X");
      this.keyC = this.input.keyboard.addKey("C");
      this.keyEsc = this.input.keyboard.addKey("ESC");
      // ESC opens pause overlay (PauseP2 scene)
      this.input.keyboard.on("keydown-ESC", () => {
        if (this.scene.isPaused("P2_Play")) return;  // already paused
        if (this.dialogueActive) return;
        this.scene.pause();
        this.scene.launch("P2_Pause");
      });

      // Compute grid coords for every room (BFS from spawn following exit dirs).
      // Used by the Map UI to render a minimap + full-map overlay.
      this._roomGrid = this._computeRoomGridLayout();
      this._visitedRooms = this._visitedRooms || new Set();
      this._visitedRooms.add(this.currentRoomId);

      // HUD
      this._buildHUD();
      this._applyPendingSave();

      // Music
      this._setRoomMusic();
      // Initial save (so Continue button works after Game Over even if
      // player hasn't crossed a room threshold yet)
      this._writeSave();

      // Test hook — used by smoke-test autoplayer
      const self = this;
      window.__SHROUD_P2__ = {
        scene: this,
        version: 2,
        teleport: (x, y) => { self.player.x = x; self.player.y = y; },
        goRoom: id => self._enterRoom(id, "S"),
        getRoom: () => self.currentRoomId,
        quest: () => self.quest,
        flags: () => self.quest.flags,
        hearts: () => self.hearts,
        bombs: () => self.bombCount,
        currentItem: () => self.currentItem,
        enemyCount: () => self.enemies.filter(e => e.active && !e.dead).length,
        itemCount: () => self.itemsOnGround.length,
        npcs: () => (self.npcsInRoom || []).filter(n => n && n._npcData).map(n => n._npcData.id),
        dialogueActive: () => !!self.dialogueActive,
        hurt: amt => self._damagePlayer(amt || 0.5),
        // Programmatic input — used by autoplayer to walk + attack
        swing: () => self._swing(self.time.now),
        useItem: () => self._useItem(self.time.now),
        cycleItem: () => self._cycleItem(),
        talk: () => {
          const npc = self._findAdjacentNPC();
          if (npc) self._dialogueOpen(npc);
          return !!npc;
        },
        advanceDialogue: () => self._dialogueAdvance(self.time.now),
        // Test-only: close active dialogue immediately (bypasses 180ms throttle)
        debugCloseDialogue: () => {
          if (self.dialogueActive) {
            // Walk to last line so side-effects fire correctly
            self.dialogueIndex = self.dialogueLines.length;
            self._dialogueClose();
          }
        },
        // Debug — give bow / bombs for test scenarios
        debugGiveBow: () => { self.quest.flags.has_bow = true; if (!self.currentItem) self.currentItem = "bow"; self._refreshItemSlot(); },
        debugGiveBombs: (n) => { self.quest.flags.has_bombs = true; self.bombCount += (n||5); if (!self.currentItem) self.currentItem = "bombs"; self._refreshItemSlot(); },
        debugGiveKey: () => { self.quest.flags.small_keys += 1; self._refreshHUD(); },
        debugGiveBigKey: () => { self.quest.flags.big_key = true; self._refreshHUD(); },
        // Force-kill all enemies in current room (for skipping past fights)
        debugKillEnemies: () => {
          for (const e of self.enemies) if (e.active && !e.dead) self._killEnemy(e);
        },
        // Force-set player position + velocity
        move: (dx, dy) => {
          const sp = D.PLAYER.speed;
          self.player.body.setVelocity(dx * sp, dy * sp);
          if (dx < 0) self.player.facing = "left";
          else if (dx > 0) self.player.facing = "right";
          else if (dy < 0) self.player.facing = "up";
          else if (dy > 0) self.player.facing = "down";
        },
        stop: () => self.player.body.setVelocity(0, 0),
      };
    }

    update(time, delta) {
      const p = this.player;
      const sp = D.PLAYER.speed;

      // Dialogue suspends gameplay — only handle advance/close input
      if (this.dialogueActive) {
        if (Phaser.Input.Keyboard.JustDown(this.keyZ) || Phaser.Input.Keyboard.JustDown(this.keyC) ||
            Phaser.Input.Keyboard.JustDown(this.keys.space)) {
          this._dialogueAdvance(time);
        }
        p.body.setVelocity(0, 0);
        return;
      }

      // Knockback overrides input
      if (p.knockback_until > time) {
        // Velocity already set by _damagePlayer; just hold it
      } else {
        let vx = 0, vy = 0;
        const up    = this.keys.up.isDown    || this.keysWASD.W.isDown;
        const down  = this.keys.down.isDown  || this.keysWASD.S.isDown;
        const left  = this.keys.left.isDown  || this.keysWASD.A.isDown;
        const right = this.keys.right.isDown || this.keysWASD.D.isDown;
        if (left)       vx = -sp;
        else if (right) vx = sp;
        if (up)         vy = -sp;
        else if (down)  vy = sp;
        if (vx !== 0 && vy !== 0) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
        if (this.attackUntil && time < this.attackUntil) { vx *= 0.3; vy *= 0.3; }
        p.body.setVelocity(vx, vy);

        // Facing — ONLY changes on actual L/R input (stable when moving up/down)
        if (left && p.facing !== "left")   { p.facing = "left";  p.setFlipX(true); }
        else if (right && p.facing !== "right") { p.facing = "right"; p.setFlipX(false); }
        else if (up && !left && !right && p.facing !== "up")     p.facing = "up";
        else if (down && !left && !right && p.facing !== "down") p.facing = "down";

        // Anim state machine — only triggers a state change on TRANSITION
        const isMoving = (vx !== 0 || vy !== 0);
        const isAttacking = (this.attackUntil && time < this.attackUntil);
        let wantAnim;
        if (isAttacking) wantAnim = "p_attack";
        else if (isMoving) wantAnim = "p_walk";
        else wantAnim = "p_idle";
        if (p._currentAnimState !== wantAnim) {
          p._currentAnimState = wantAnim;
          if (wantAnim === "p_walk") {
            if (!p.anims.isPlaying || p.anims.currentAnim?.key !== "p_walk") p.play("p_walk");
          } else if (wantAnim === "p_idle") {
            if (p.anims.isPlaying) p.stop();
            p.setTexture("p_idle");
          }
          // wantAnim === "p_attack" — _swing() already called p.play("p_attack")
        }
      }

      // Attack input
      if (Phaser.Input.Keyboard.JustDown(this.keyZ)) this._swing(time);
      // Use selected item
      if (Phaser.Input.Keyboard.JustDown(this.keyX)) this._useItem(time);
      // Action — context-sensitive: talk to adjacent NPC, otherwise cycle item slot
      if (Phaser.Input.Keyboard.JustDown(this.keyC)) {
        const npc = this._findAdjacentNPC();
        if (npc) this._dialogueOpen(npc);
        else this._cycleItem();
      }
      // Sword hitbox tick (position + active-window check)
      this._tickHitbox(time);
      // Arrow projectile tick
      this._tickArrows(time);
      // Bomb tick (fuse + explosion)
      this._tickBombs(time);

      // Edge-of-screen transition (NES Zelda style — door tile triggers neighbor room)
      this._checkEdgeTransitions(p);

      // Hazard tiles (spikes, pits, water)
      this._checkHazards(p, time);

      // Enemy AI tick
      this._tickEnemies(time, delta);
      // Enemy projectiles
      this._tickEnemyProjectiles(time);
      // Puzzles
      this._tickPuzzles(time);

      // Item pickup overlap
      this._tickPickups(time);

      // i-frames flicker
      if (p.invuln_until > time) {
        p.alpha = (Math.floor(time / 60) % 2) === 0 ? 0.4 : 1.0;
      } else {
        p.alpha = 1.0;
      }
      // Low-hearts warning beep (≤ 1 heart) every 900ms
      if (this.hearts > 0 && this.hearts <= 1) {
        if (!this._lowHeartLastBeep || time - this._lowHeartLastBeep > 900) {
          this._lowHeartLastBeep = time;
          try { this.sound.play("sfx_hit", { volume: 0.18 }); } catch (_) {}
        }
      }
    }

    // ── Room management ───────────────────────────────────────────
    _buildRoom(id) {
      const room = D.ROOMS[id];
      if (!room) { console.error("[pass2] unknown room", id); return; }
      this.currentRoom = room;

      // tileLayer holds only tile graphics — safe to nuke.
      this.tileLayer.removeAll(true);

      // entityLayer holds player + NPCs + enemies + items + name labels.
      // DO NOT destroy the player — track and remove only OUR room-scoped entities.
      this._clearRoomEntities();

      // Tile rendering — rich Graphics-drawn tiles + real physics wall colliders.
      const g = this.add.graphics();
      this.tileLayer.add(g);
      const rng = (seed) => { let t = seed; return () => { t = (t * 1103515245 + 12345) & 0x7fffffff; return t / 0x7fffffff; }; };
      const roomSeed = room.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const rnd = rng(roomSeed);
      // Build a static physics group of wall colliders, one per '#' tile.
      // Phaser handles sliding / no-clipping automatically via overlap-collide.
      if (this.wallGroup) this.wallGroup.clear(true, true);
      this.wallGroup = this.physics.add.staticGroup();
      for (let y = 0; y < ROOM_H; y++) {
        const row = room.tiles[y];
        for (let x = 0; x < ROOM_W; x++) {
          const ch = row && row[x] ? row[x] : '.';
          this._drawTile(g, ch, x * TILE, y * TILE, rnd);
          const decor = TILE_DRAW_DECOR[ch];
          if (decor) this._drawTileDecor(g, decor, x * TILE, y * TILE);
          // Static wall body for solid tiles
          if (SOLID_TILES.has(ch)) {
            const wall = this.wallGroup.create(x * TILE + TILE/2, y * TILE + TILE/2, null);
            wall.setSize(TILE, TILE);
            wall.setVisible(false);
            wall.refreshBody();
          }
        }
      }
      // Player↔wall collider attached separately (see _attachWallCollider)
      // because _buildRoom may run BEFORE this.player is created (initial
      // create() path).
      this._attachWallCollider();

      // NPCs — hooded-figure Graphics with cloak color from n.tint.
      // The roguelike_chars sprite at 16x16 was illegible at game zoom; this
      // procedural figure reads clearly even at small scale.
      this.npcsInRoom = [];
      (room.npcs || []).forEach(n => {
        const npc = this._drawNpcFigure(n);
        npc._npcData = n;
        this.entityLayer.add(npc);
        // Label BELOW the NPC's feet + yellow-bordered dark plate
        const labelY = n.y + 14;
        const textW = Math.max(22, n.name.length * 4 + 4);
        const plate = this.add.rectangle(n.x, labelY, textW, 8, 0x0f172a, 0.9);
        plate.setStrokeStyle(0.5, 0xfde047);
        const label = this.add.text(n.x, labelY, n.name,
          { font: "6px monospace", color: "#fde047" })
          .setOrigin(0.5);
        this.entityLayer.add(plate);
        this.entityLayer.add(label);
        this.npcsInRoom.push(npc);
        this.npcsInRoom.push(plate);
        this.npcsInRoom.push(label);
      });
    }

    _drawNpcFigure(n) {
      // Draw an NPC as a procedural hooded figure with cloak in n.tint color.
      // Container x = n.x, y = n.y. The figure is ~10 wide × 16 tall, with
      // feet centered near the container origin.
      const container = this.add.container(n.x, n.y);
      const g = this.add.graphics();
      container.add(g);
      const cloak = n.tint || 0xfacc15;
      // Darker shade for shadow side
      const cloakDark = (cloak & 0xfefefe) >>> 1;
      // Shadow at feet
      g.fillStyle(0x000000, 0.4);
      g.fillEllipse(0, 7, 10, 3);
      // Cloak body (trapezoid)
      g.fillStyle(cloak, 1);
      g.fillTriangle(-6, 7, 6, 7, 4, -3);
      g.fillTriangle(-6, 7, 4, -3, -4, -3);
      // Cloak shadow on right side
      g.fillStyle(cloakDark, 1);
      g.fillTriangle(0, 7, 6, 7, 4, -3);
      // Outline
      g.lineStyle(0.5, 0x111111, 1);
      g.strokeTriangle(-6, 7, 6, 7, 4, -3);
      g.strokeTriangle(-6, 7, 4, -3, -4, -3);
      // Face area under hood (skin)
      g.fillStyle(0xfde7c2, 1);
      g.fillCircle(0, -5, 2.5);
      // Hood (over head + drape)
      g.fillStyle(cloak, 1);
      g.fillCircle(0, -7, 3);
      // Hood inner shadow
      g.fillStyle(cloakDark, 1);
      g.fillEllipse(0, -5, 4, 2);
      // Eyes (two tiny dark dots)
      g.fillStyle(0x111111, 1);
      g.fillCircle(-1, -5.2, 0.5);
      g.fillCircle(1, -5.2, 0.5);
      // Small belt / sash
      g.fillStyle(0x57534e, 1);
      g.fillRect(-5, 0, 10, 1);
      return container;
    }

    _computeRoomGridLayout() {
      // BFS from spawn. Exit direction → grid offset: N=(-y), S=(+y), E=(+x), W=(-x).
      const grid = {};
      const offsets = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
      const queue = [{ id: D.PLAYER.spawn_room, gx: 0, gy: 0 }];
      while (queue.length) {
        const { id, gx, gy } = queue.shift();
        if (grid[id]) continue;
        const room = D.ROOMS[id];
        if (!room) continue;
        grid[id] = { gx, gy, zone: room.zone, id };
        for (const [dir, off] of Object.entries(offsets)) {
          const next = room.exits && room.exits[dir];
          if (next && !grid[next]) queue.push({ id: next, gx: gx + off[0], gy: gy + off[1] });
        }
      }
      return grid;
    }

    _attachWallCollider() {
      // Re-bind the player ↔ wall static-group collider. Must be called
      // both after initial player creation in create() AND after every
      // _buildRoom rebuild (the wallGroup is replaced each room).
      if (!this.player || !this.wallGroup) return;
      if (this._wallCollider) {
        this.physics.world.removeCollider(this._wallCollider);
        this._wallCollider = null;
      }
      this._wallCollider = this.physics.add.collider(this.player, this.wallGroup);
    }

    _clearRoomEntities() {
      // Destroy any tracked room-scoped entities WITHOUT touching player or hitbox.
      const lists = [this.enemies || [], this.itemsOnGround || [], this.npcsInRoom || [], this.bombs || [], this.enemyProjectiles || [], this.puzzleEntities || []];
      for (const list of lists) {
        for (const item of list) {
          if (item && item.destroy) item.destroy();
        }
      }
      this.enemies = [];
      this.itemsOnGround = [];
      this.npcsInRoom = [];
      this.bombs = [];
      this.enemyProjectiles = [];
      this.puzzleEntities = [];
      this.puzzleBlocks = null;
      this.puzzlePlates = null;
      this.puzzleStatues = null;
      this._pushPuzzle = null;
      this._lightPuzzle = null;
      // Also reset arrows in flight (recycle, don't destroy)
      if (this.arrows) {
        for (const a of this.arrows) {
          a.active = false;
          a.setVisible(false);
          a._embed_until = 0;
          if (a.body) a.body.setVelocity(0, 0);
          a.x = -100; a.y = -100;
        }
      }
    }

    _enterRoom(id, fromDirection) {
      const newRoom = D.ROOMS[id];
      if (!newRoom) {
        console.warn("[pass2] no neighbor room:", id);
        return;
      }
      // Locked door gate (small key / big key)
      // Check if the entering edge of the OLD room has L or B at the door tile
      // For now, we trust the data — locked rooms expose their keys before player can reach them.
      // Refine in iter polish.
      this.currentRoomId = id;
      // Repaint — _clearRoomEntities preserves player + hitbox; _buildRoom
      // only nukes tileLayer (tiles + decor) and re-adds NPCs.
      this._buildRoom(id);
      // Defensive re-add — only if player drifted out of entityLayer.
      if (this.player && this.player.parentContainer !== this.entityLayer) {
        try { this.entityLayer.add(this.player); } catch (e) { console.warn("[pass2] player re-add failed:", e.message); }
      }
      // Spawn entities for the new room
      this._spawnRoomEntities();
      // Spawn position based on entry direction
      const entryPos = {
        N: { x: SCREEN_W / 2, y: TILE * 1.5 },
        S: { x: SCREEN_W / 2, y: TILE * (ROOM_H - 1.5) },
        E: { x: TILE * (ROOM_W - 1.5), y: SCREEN_H / 2 },
        W: { x: TILE * 1.5, y: SCREEN_H / 2 },
      }[fromDirection] || { x: SCREEN_W / 2, y: SCREEN_H / 2 };
      this.player.setPosition(entryPos.x, entryPos.y);
      this.player.body.setVelocity(0, 0);
      this._lastEntryDir = fromDirection;
      this._setRoomMusic();
      // Mark visited + refresh minimap so the new room appears
      if (!this._visitedRooms) this._visitedRooms = new Set();
      this._visitedRooms.add(this.currentRoomId);
      this._updateMinimap();
      this._writeSave();
    }

    _roomCleared(roomId) {
      if (!this._roomsCleared) this._roomsCleared = {};
      return !!this._roomsCleared[roomId];
    }

    _maybeMarkRoomCleared() {
      const r = this.currentRoom;
      if (!r || !r.lock_until_cleared) return;
      if (this._roomCleared(r.id)) return;
      const alive = this.enemies.filter(e => e.active && !e.dead).length;
      if (alive > 0) return;
      // Mark + side-effects
      if (!this._roomsCleared) this._roomsCleared = {};
      this._roomsCleared[r.id] = true;
      try { this.sound.play("sfx_door", { volume: 0.5 }); } catch (_) {}
      this._showFanfare("ROOM CLEARED");
      // drops_*_on_clear — spawn keys/items at room center on full clear
      if (r.drops_key_on_clear) this._spawnPickup("small_key", SCREEN_W/2, SCREEN_H/2);
      if (r.drops_big_key_on_clear) this._spawnPickup("big_key", SCREEN_W/2, SCREEN_H/2);
    }

    _checkEdgeTransitions(p) {
      const r = this.currentRoom;
      if (!r || !r.exits) return;
      // Find which edge (if any) we'd cross this frame.
      let dir = null;
      if (p.y < TILE && r.exits.N) dir = "N";
      else if (p.y > SCREEN_H - TILE * 0.5 && r.exits.S) dir = "S";
      else if (p.x > SCREEN_W - TILE * 0.5 && r.exits.E) dir = "E";
      else if (p.x < TILE * 0.5 && r.exits.W) dir = "W";
      if (dir) {
        // Lock-until-cleared: room doors close if any enemy is alive.
        // Doesn't apply to the entry direction (would trap player).
        if (r.lock_until_cleared && !this._roomCleared(r.id)) {
          if (dir !== this._lastEntryDir) {
            this._showLockedFeedback("enemies_present");
            this._bouncePlayer(dir);
            return;
          }
        }
        // Puzzle gating — light puzzle gates the N exit when configured.
        if (r.puzzle && r.puzzle.kind === "light_4statue" && r.puzzle.gates_north_exit
            && dir === "N" && this.puzzleState && !this.puzzleState.solved) {
          this._showLockedFeedback("statue_puzzle");
          this._bouncePlayer(dir);
          return;
        }
        // Check for a locked-door tile at the edge — block unless we have a key.
        // Door tile positions inferred from tile layout: any 'L' (small) / 'B' (big) on the corresponding edge.
        const lockType = this._edgeLockType(r, dir);
        if (lockType === "L") {
          if (this.quest.flags.small_keys > 0) {
            this.quest.flags.small_keys -= 1;
            this._unlockEdge(r.id, dir);
            try { this.sound.play("sfx_door", { volume: 0.6 }); } catch (_) {}
            this._refreshHUD();
          } else {
            this._showLockedFeedback("locked");
            // Bounce player off the edge
            this._bouncePlayer(dir);
            return;
          }
        } else if (lockType === "B") {
          if (this.quest.flags.big_key) {
            this._unlockEdge(r.id, dir);
            try { this.sound.play("sfx_door", { volume: 0.6 }); } catch (_) {}
          } else {
            this._showLockedFeedback("big_locked");
            this._bouncePlayer(dir);
            return;
          }
        }
        this._enterRoom(r.exits[dir], { N:"S", S:"N", E:"W", W:"E" }[dir]);
        return;
      }
      // Physics collision is handled by this.wallGroup (a static body per '#'
      // tile). Phaser auto-resolves sliding and prevents clipping.
    }

    _edgeLockType(room, dir) {
      // Returns 'L' (small-key) | 'B' (big-key) | null. Looks at the tile
      // on the relevant edge of the room. If door is already unlocked
      // (this._doorUnlocks[room.id][dir]), returns null.
      if (!this._doorUnlocks) this._doorUnlocks = {};
      const u = (this._doorUnlocks[room.id] || {})[dir];
      if (u) return null;
      // Inspect the edge row/col for L or B characters
      const t = room.tiles;
      const has = (ch) => {
        if (dir === "N") return (t[0] || "").includes(ch);
        if (dir === "S") return (t[ROOM_H - 1] || "").includes(ch);
        // Column edges
        if (dir === "W") return t.some(row => row[0] === ch);
        if (dir === "E") return t.some(row => row[ROOM_W - 1] === ch);
        return false;
      };
      if (has("L")) return "L";
      if (has("B")) return "B";
      return null;
    }

    _unlockEdge(roomId, dir) {
      if (!this._doorUnlocks) this._doorUnlocks = {};
      this._doorUnlocks[roomId] = this._doorUnlocks[roomId] || {};
      this._doorUnlocks[roomId][dir] = true;
    }

    _bouncePlayer(dir) {
      const p = this.player;
      const kb = 80;
      if (dir === "N") { p.body.setVelocity(0, kb); p.y = TILE * 1.5; }
      else if (dir === "S") { p.body.setVelocity(0, -kb); p.y = SCREEN_H - TILE * 1.5; }
      else if (dir === "E") { p.body.setVelocity(-kb, 0); p.x = SCREEN_W - TILE * 1.5; }
      else if (dir === "W") { p.body.setVelocity(kb, 0); p.x = TILE * 1.5; }
      p.knockback_until = this.time.now + 180;
    }

    _showLockedFeedback(kind) {
      try { this.sound.play("sfx_hit", { volume: 0.3 }); } catch (_) {}
      const msg = kind === "big_locked"      ? "The Big Door is sealed."
                : kind === "enemies_present" ? "Defeat all enemies first!"
                : kind === "statue_puzzle"   ? "The statues must face the center."
                : "Locked — find a small key.";
      const t = this.add.text(SCREEN_W/2, 24, msg,
        { font: "8px monospace", color: "#fde047", backgroundColor: "rgba(0,0,0,0.7)" }).setOrigin(0.5, 0);
      this.fxLayer.add(t);
      this.time.delayedCall(1200, () => t && t.destroy && t.destroy());
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

    _buildMinimap() {
      // Top-right corner: a small 6-wide x 5-tall grid showing rooms in the
      // current zone. Each cell ~6x4 px. Current room highlighted yellow.
      // Visited rooms dim. With dungeon_map, unvisited rooms are outlined.
      // With dungeon_compass, rooms still holding items get a dot.
      if (this.minimapG) this.minimapG.destroy();
      this.minimapG = this.add.graphics();
      this.fxLayer.add(this.minimapG);
      this._updateMinimap();
    }

    _updateMinimap() {
      if (!this.minimapG || !this._roomGrid) return;
      const g = this.minimapG;
      g.clear();
      const cur = this._roomGrid[this.currentRoomId];
      if (!cur) return;
      // Show only rooms in the current zone
      const zoneRooms = Object.values(this._roomGrid).filter(r => r.zone === cur.zone);
      if (zoneRooms.length === 0) return;
      const minGX = Math.min(...zoneRooms.map(r => r.gx));
      const minGY = Math.min(...zoneRooms.map(r => r.gy));
      const cellW = 6, cellH = 4, pad = 1;
      // Anchor minimap to top-right corner with 2px margin
      const originX = SCREEN_W - 2 - (Math.max(...zoneRooms.map(r => r.gx)) - minGX + 1) * (cellW + pad) + pad;
      const originY = 12;
      // Background plate
      const w = (Math.max(...zoneRooms.map(r => r.gx)) - minGX + 1) * (cellW + pad) + 2;
      const h = (Math.max(...zoneRooms.map(r => r.gy)) - minGY + 1) * (cellH + pad) + 2;
      g.fillStyle(0x0f172a, 0.85);
      g.fillRect(originX - 2, originY - 2, w, h);
      g.lineStyle(0.5, 0xfde047, 0.7);
      g.strokeRect(originX - 2, originY - 2, w, h);
      const hasMap = this.quest && this.quest.flags && this.quest.flags.has_map;
      const hasCompass = this.quest && this.quest.flags && this.quest.flags.has_compass;
      for (const room of zoneRooms) {
        const px = originX + (room.gx - minGX) * (cellW + pad);
        const py = originY + (room.gy - minGY) * (cellH + pad);
        const visited = this._visitedRooms && this._visitedRooms.has(room.id);
        const isCurrent = room.id === this.currentRoomId;
        if (isCurrent) {
          g.fillStyle(0xfde047, 1);
          g.fillRect(px, py, cellW, cellH);
        } else if (visited) {
          g.fillStyle(0x475569, 1);
          g.fillRect(px, py, cellW, cellH);
        } else if (hasMap) {
          g.lineStyle(0.5, 0x475569, 1);
          g.strokeRect(px, py, cellW, cellH);
        }
        // Compass: dot for rooms with uncollected items
        if (hasCompass && D.ROOMS[room.id]) {
          const rd = D.ROOMS[room.id];
          const hasUncollectedItem = (rd.items || []).length > 0 || rd.boss_reward || rd.miniboss_reward;
          if (hasUncollectedItem && !this._collectedRoomItems?.has(room.id)) {
            g.fillStyle(0xef4444, 1);
            g.fillCircle(px + cellW/2, py + cellH/2, 0.7);
          }
        }
      }
    }

    _buildHUD() {
      // HUD lives in fxLayer (never rebuilt). tileLayer.removeAll(true) on
      // room change would destroy HUD if it lived there.
      this.hudHeartsG = this.add.graphics();
      this.hudRupees = this.add.text(2, 14, "$0", { font: "8px monospace", color: "#22c55e" });
      this.hudKeys = this.add.text(36, 14, "K0", { font: "8px monospace", color: "#facc15" });
      this.hudItem = this.add.text(SCREEN_W - 2, 2, "[(no item)]",
        { font: "8px monospace", color: "#94a3b8" }).setOrigin(1, 0);
      this.fxLayer.add(this.hudHeartsG);
      this.fxLayer.add(this.hudRupees);
      this.fxLayer.add(this.hudKeys);
      this.fxLayer.add(this.hudItem);
      this._buildMinimap();
      this._refreshHUD();
    }

    _heartPath(g, cx, cy, size, strokeOnly, strokeColor) {
      // Heart silhouette = two circles + downward triangle.
      const s = size / 8;   // scale factor (size 7 → ~0.875 scale)
      const r = 2 * s;
      // Bumps
      if (!strokeOnly) {
        g.fillCircle(cx - 2*s, cy - 1*s, r);
        g.fillCircle(cx + 2*s, cy - 1*s, r);
        g.fillTriangle(cx - 4*s, cy + 0.5*s, cx + 4*s, cy + 0.5*s, cx, cy + 4*s);
      } else {
        g.strokeCircle(cx - 2*s, cy - 1*s, r);
        g.strokeCircle(cx + 2*s, cy - 1*s, r);
        g.strokeTriangle(cx - 4*s, cy + 0.5*s, cx + 4*s, cy + 0.5*s, cx, cy + 4*s);
      }
    }

    _heartLeftHalfPath(g, cx, cy, size) {
      // Just the left half of a heart — for half-heart rendering.
      const s = size / 8;
      const r = 2 * s;
      g.fillCircle(cx - 2*s, cy - 1*s, r);
      // Half triangle (left side)
      g.fillTriangle(cx - 4*s, cy + 0.5*s, cx, cy + 0.5*s, cx, cy + 4*s);
    }

    _refreshHUD() {
      // Draw real heart shapes (two circles + triangle silhouette).
      if (this.hudHeartsG) {
        const g = this.hudHeartsG;
        g.clear();
        const max = D.PLAYER.max_hearts;
        const cur = this.hearts;
        const startX = 4, startY = 4;
        const sizePx = 7;        // heart visual size (small for HUD)
        const gap = 2;
        for (let i = 0; i < max; i++) {
          const cx = startX + i * (sizePx + gap) + sizePx / 2;
          const cy = startY + sizePx / 2;
          const filled = cur - i;
          // 1. Outline silhouette (always drawn)
          g.lineStyle(1, 0x111111, 1);
          this._heartPath(g, cx, cy, sizePx, true /* stroke */, 0x111111);
          if (filled >= 1) {
            // Full red heart
            g.fillStyle(0xef4444, 1);
            this._heartPath(g, cx, cy, sizePx, false);
          } else if (filled >= 0.5) {
            // Half — left half red, right half dark grey
            g.fillStyle(0x4b1d1d, 1);
            this._heartPath(g, cx, cy, sizePx, false);
            g.fillStyle(0xef4444, 1);
            this._heartLeftHalfPath(g, cx, cy, sizePx);
          } else {
            // Empty — dark heart outline only
            g.fillStyle(0x4b1d1d, 1);
            this._heartPath(g, cx, cy, sizePx, false);
          }
        }
      }
      const q = this.quest && this.quest.flags;
      if (this.hudRupees && q) this.hudRupees.setText("$" + q.rupees);
      if (this.hudKeys && q) this.hudKeys.setText("K" + q.small_keys + (q.big_key ? "*" : ""));
    }

    // ══════════════════════════════════════════════════════════════
    // COMBAT — sword hitbox, enemy AI, damage, knockback
    // ══════════════════════════════════════════════════════════════

    _swing(time) {
      if (this.attackUntil && time < this.attackUntil) return;
      // Timings: 80ms windup (texture swap), 200ms active (hitbox lit), 100ms recovery
      this.attackUntil = time + 380;
      this.hitboxActiveFrom = time + 80;
      this.hitboxActiveUntil = time + 280;
      this.hitboxHitEnemies = new Set();   // prevents multi-hit per swing
      try { this.sound.play("sfx_attack", { volume: 0.6 }); } catch (_) {}
      this.player.play("p_attack");
    }

    _tickHitbox(time) {
      const hb = this.hitbox;
      if (!this.attackUntil || time > this.attackUntil) { hb.setVisible(false); return; }
      // Position hitbox in facing direction
      const p = this.player;
      const off = 12;     // distance from player center
      const dirOffsets = {
        up:    { x: 0,    y: -off, w: 12, h: 14 },
        down:  { x: 0,    y:  off, w: 12, h: 14 },
        left:  { x: -off, y:  0,   w: 14, h: 12 },
        right: { x:  off, y:  0,   w: 14, h: 12 },
      };
      const d = dirOffsets[p.facing] || dirOffsets.down;
      hb.setPosition(p.x + d.x, p.y + d.y);
      hb.setSize(d.w, d.h);
      hb.body.setSize(d.w, d.h);
      const active = time >= this.hitboxActiveFrom && time <= this.hitboxActiveUntil;
      hb.setVisible(active);
      hb.setFillStyle(0xfacc15, active ? 0.4 : 0);
      if (active) {
        // Check overlap with enemies
        for (const e of this.enemies) {
          if (!e.active || e.dead || this.hitboxHitEnemies.has(e)) continue;
          if (Phaser.Geom.Intersects.RectangleToRectangle(hb.getBounds(), e.getBounds())) {
            this._damageEnemy(e, 1, "sword");
            this.hitboxHitEnemies.add(e);
          }
        }
        // Statues — sword hit rotates them
        if (this.puzzleStatues) {
          for (const s of this.puzzleStatues) {
            if (this.hitboxHitEnemies.has(s)) continue;
            if (Phaser.Geom.Intersects.RectangleToRectangle(hb.getBounds(), s.getBounds())) {
              this._rotateStatue(s);
              this.hitboxHitEnemies.add(s);
            }
          }
        }
      }
    }

    _damageEnemy(e, amount, source) {
      source = source || "sword";
      const time = this.time.now;
      // Defensive: if Guardian is hit before its AI tick initializes _phase,
      // treat it as phase 1 so the transition check below fires correctly.
      if (e._template === "guardian_of_first_light" && !e._phase) e._phase = 1;
      // Sword immunity — Guardian phase 2 OR any enemy with tpl.sword_immune=true
      const tpl = D.ENEMIES[e._template] || D.BOSSES[e._template] || {};
      const swordImmuneNow =
        (e._template === "guardian_of_first_light" && e._phase === 2) ||
        tpl.sword_immune;
      if (swordImmuneNow && source === "sword") {
        e.flash_until = time + 80;
        try { this.sound.play("sfx_hit", { volume: 0.3 }); } catch (_) {}
        return;
      }
      e.hp -= amount;
      e.flash_until = time + 120;
      // Knockback away from player (or projectile origin)
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      const len = Math.max(0.001, Math.hypot(dx, dy));
      const kb = 140;
      e.body.setVelocity((dx/len) * kb, (dy/len) * kb);
      e.knockback_until = time + 180;
      try { this.sound.play("sfx_hit", { volume: 0.5 }); } catch (_) {}
      // Hitstop on sword/arrow hit — 40ms freeze for snappy feel
      this._hitstop(source === "bomb" ? 100 : 40);
      // Tiny shake on every enemy hit
      this.cameras.main.shake(80, 0.002);
      // Phase transition for Guardian
      if (e._template === "guardian_of_first_light" && e._phase === 1 && e.hp <= 0) {
        // Transition to phase 2
        const tpl = D.BOSSES.guardian_of_first_light;
        e._phase = 2;
        e.hp = tpl.hp_phase2;
        e.speed = (tpl.speed || 60) + 20;
        e.color = 0xfde047;
        e._stun_until = time + 1200;   // brief vulnerable stun
        e.body.setVelocity(0, 0);
        try { this.sound.play("sfx_levelup", { volume: 0.6 }); } catch (_) {}
        return;
      }
      if (e.hp <= 0) this._killEnemy(e);
    }

    _killEnemy(e) {
      e.dead = true;
      e.active = false;
      e.setVisible(false);
      e.body.setVelocity(0, 0);
      try { this.sound.play("sfx_enemy_die", { volume: 0.5 }); } catch (_) {}
      // Split-on-death — spawn smaller copies (e.g. mudborn_shambler → 2 pups)
      const eTpl = D.ENEMIES[e._template] || {};
      if (eTpl.splits_on_death && !e._already_split) {
        const split = eTpl.splits_on_death;
        for (let i = 0; i < (split.count || 2); i++) {
          const offset = (i - (split.count - 1) / 2) * 14;
          const pup = this._spawnEnemyAt(split.kind, e.x + offset, e.y);
          if (pup) pup._already_split = true;
        }
      }
      // Random drop: 30% green rupee, 15% heart, 55% nothing
      const r = Math.random();
      let drop = null;
      if (r < 0.30) drop = "rupee_green";
      else if (r < 0.45) drop = "heart";
      if (drop) this._spawnPickup(drop, e.x, e.y);
      // If this enemy is a miniboss + room has miniboss_reward, drop it
      const room = this.currentRoom;
      if (e._role === "miniboss" && room && room.miniboss_reward) {
        this._spawnPickup(room.miniboss_reward.kind, e.x, e.y);
      }
      if (e._role === "boss" && room && room.boss_reward) {
        this._spawnPickup(room.boss_reward.kind, SCREEN_W/2, SCREEN_H/2);
        // Trigger win
        this._winAct1();
      }
      // Check for room-cleared
      this._maybeMarkRoomCleared();
    }

    _damagePlayer(amount, sourceX, sourceY) {
      const time = this.time.now;
      const p = this.player;
      if (p.invuln_until > time) return;
      this.hearts = Math.max(0, this.hearts - amount);
      p.invuln_until = time + D.PLAYER.invuln_ms;
      try { this.sound.play("sfx_hurt", { volume: 0.6 }); } catch (_) {}
      this._refreshHUD();
      // Screen shake — proportional to damage taken
      this.cameras.main.shake(160, 0.006 + amount * 0.004);
      // Hitstop — brief physics freeze on big hits (≥ 1 heart)
      if (amount >= 1) this._hitstop(70);
      // Knockback away from source
      if (typeof sourceX === "number" && typeof sourceY === "number") {
        const dx = p.x - sourceX;
        const dy = p.y - sourceY;
        const len = Math.max(0.001, Math.hypot(dx, dy));
        const kb = 180;
        p.body.setVelocity((dx/len) * kb, (dy/len) * kb);
        p.knockback_until = time + 200;
      }
      if (this.hearts <= 0) this._gameOver();
    }

    _hitstop(ms) {
      // Freeze physics + AI briefly for impact emphasis
      this.physics.world.isPaused = true;
      this.time.delayedCall(ms, () => { this.physics.world.isPaused = false; });
    }

    // ══════════════════════════════════════════════════════════════
    // ENEMY SPAWNING + AI
    // ══════════════════════════════════════════════════════════════

    _spawnEnemyAt(template, x, y, role) {
      // Spawn a single enemy at (x, y) using the same flow as _spawnRoomEntities.
      // Used by split-on-death + room-spawned reinforcements.
      const tpl = (template && D.ENEMIES[template]) || (D.BOSSES[template]);
      if (!tpl) { console.warn("[pass2] unknown enemy template:", template); return null; }
      const useAtlas = tpl.sprite_rest && this.textures.exists("enemies_atlas");
      let e;
      if (useAtlas) {
        e = this.physics.add.sprite(x, y, "enemies_atlas", tpl.sprite_rest);
        const targetPx = (tpl.scale || 1) * 14;
        e.setScale(targetPx / 64);
        e.setTint(tpl.color || 0xffffff);
        if (this.anims.exists("anim_" + template)) e.play("anim_" + template);
      } else {
        e = this.add.rectangle(x, y, 12, 12, tpl.color || 0xff0000);
        e.setStrokeStyle(1, 0x000000);
        this.physics.add.existing(e);
      }
      e.body.setCollideWorldBounds(false);
      e.body.setSize(10, 10);
      e._template = template;
      e._behavior = tpl.behavior;
      e._role = role || null;
      e.hp = tpl.hp_phase1 || tpl.hp || 5;
      e.dmg = tpl.dmg || 1;
      e.speed = tpl.speed || 40;
      e.color = tpl.color || 0xffffff;
      e._useAtlas = useAtlas;
      e.dead = false;
      e.knockback_until = 0;
      e.flash_until = 0;
      e._ai = { dir: 1, change_at: 0, last_shot: 0 };
      if (e._template === "guardian_of_first_light") e._phase = 1;
      e.active = true;
      this.entityLayer.add(e);
      this.enemies.push(e);
      return e;
    }

    _spawnRoomEntities() {
      this.enemies = [];
      this.itemsOnGround = [];
      const room = this.currentRoom;
      if (!room) return;
      // Enemies — delegate to _spawnEnemyAt for consistency with split-on-death
      // and any other dynamic-spawn paths.
      (room.enemies || []).forEach(spec => {
        this._spawnEnemyAt(spec.template, spec.x, spec.y, spec.role);
      });
      // Items
      (room.items || []).forEach(item => {
        this._spawnPickup(item.kind, item.x, item.y);
      });
      // Puzzles
      this.puzzleEntities = [];
      this.puzzleState = { solved: false };
      const puz = room.puzzle;
      if (puz) {
        if (puz.kind === "push_block") this._buildPushBlockPuzzle(puz);
        else if (puz.kind === "light_4statue") this._buildLightPuzzle(puz);
      }
    }

    // ── Push-block puzzle ──────────────────────────────────────────
    _buildPushBlockPuzzle(puz) {
      // Plates: 10×10 cyan squares on the floor
      this.puzzlePlates = puz.plates.map(p => {
        const r = this.add.rectangle(p.x, p.y, 10, 10, 0x0891b2, 0.5);
        r.setStrokeStyle(1, 0x0e7490);
        this.entityLayer.add(r);
        this.puzzleEntities.push(r);
        return { plate: r, x: p.x, y: p.y, pressed: false };
      });
      // Blocks: 14×14 stone-grey draggable squares
      this.puzzleBlocks = puz.blocks.map(b => {
        const r = this.add.rectangle(b.x, b.y, 14, 14, 0x6b7280);
        r.setStrokeStyle(1, 0x374151);
        this.physics.add.existing(r);
        r.body.setImmovable(true);
        r.body.setSize(14, 14);
        r._isPushBlock = true;
        this.entityLayer.add(r);
        this.puzzleEntities.push(r);
        return r;
      });
      this._pushPuzzle = puz;
    }

    // ── 4-statue light puzzle ──────────────────────────────────────
    _buildLightPuzzle(puz) {
      // Statues — small grey blocks with an arrow indicating facing.
      // Player strikes statue with sword to rotate facing 90°. Solved when
      // all 4 face the center.
      this.puzzleStatues = puz.statues.map((s, i) => {
        const r = this.add.rectangle(s.x, s.y, 12, 12, 0x9ca3af);
        r.setStrokeStyle(1, 0x374151);
        this.physics.add.existing(r);
        r.body.setImmovable(true);
        r._isStatue = true;
        r._facing = i;  // initial facings 0/1/2/3 (random-ish; need to rotate)
        // Arrow indicator overlay
        const arrow = this.add.text(s.x, s.y, "→",
          { font: "10px monospace", color: "#fde047", stroke: "#000", strokeThickness: 2 })
          .setOrigin(0.5);
        r._arrow = arrow;
        this.entityLayer.add(r);
        this.entityLayer.add(arrow);
        this.puzzleEntities.push(r);
        this.puzzleEntities.push(arrow);
        this._updateStatueArrow(r);
        return r;
      });
      this._lightPuzzle = puz;
    }

    _updateStatueArrow(s) {
      // facing 0=right, 1=down, 2=left, 3=up
      // For "face center" — depends on quadrant.
      const arrows = ["→", "↓", "←", "↑"];
      s._arrow.setText(arrows[s._facing % 4]);
    }

    _rotateStatue(s) {
      s._facing = (s._facing + 1) % 4;
      this._updateStatueArrow(s);
      try { this.sound.play("sfx_hit", { volume: 0.4 }); } catch (_) {}
      // Visual hit-flash
      s.fillColor = 0xffffff;
      this.time.delayedCall(100, () => { if (s && s.fillColor !== undefined) s.fillColor = 0x9ca3af; });
      this._checkLightPuzzle();
    }

    _tickPuzzles(time) {
      // Push the blocks when the player walks into them
      if (this.puzzleBlocks && this.puzzleBlocks.length) {
        for (const b of this.puzzleBlocks) {
          if (!b.active) continue;
          if (Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), b.getBounds())) {
            // Push direction = player facing
            const f = this.player.facing;
            const step = 1.5;
            const dx = (f === "left" ? -step : f === "right" ? step : 0);
            const dy = (f === "up" ? -step : f === "down" ? step : 0);
            if (dx || dy) {
              // Don't push into solid tiles
              const nx = b.x + dx, ny = b.y + dy;
              const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
              const ch = (this.currentRoom.tiles[ty] || "")[tx];
              if (!SOLID_TILES.has(ch)) {
                b.x = nx; b.y = ny;
                // Push player back so they don't constantly press through
                this.player.x -= dx * 0.6;
                this.player.y -= dy * 0.6;
              }
            }
          }
        }
        // Plate detection
        if (this.puzzlePlates && this._pushPuzzle && !this.puzzleState.solved) {
          let allPressed = true;
          for (const pInfo of this.puzzlePlates) {
            const wasPressed = pInfo.pressed;
            pInfo.pressed = this.puzzleBlocks.some(b =>
              Phaser.Math.Distance.Between(b.x, b.y, pInfo.x, pInfo.y) < 8);
            if (pInfo.pressed && !wasPressed) {
              pInfo.plate.fillColor = 0x06b6d4;   // lit
              try { this.sound.play("sfx_pickup", { volume: 0.3 }); } catch (_) {}
            } else if (!pInfo.pressed && wasPressed) {
              pInfo.plate.fillColor = 0x0891b2;
            }
            if (!pInfo.pressed) allPressed = false;
          }
          if (allPressed) {
            this.puzzleState.solved = true;
            try { this.sound.play("sfx_door", { volume: 0.6 }); } catch (_) {}
            this._showFanfare("PUZZLE SOLVED");
            if (this._pushPuzzle.reward_on_solve) {
              const rew = this._pushPuzzle.reward_on_solve;
              this._spawnPickup(rew.kind, rew.x, rew.y);
            }
          }
        }
      }
    }

    _checkLightPuzzle() {
      const puz = this._lightPuzzle;
      if (!puz || this.puzzleState.solved) return;
      const cx = SCREEN_W / 2, cy = SCREEN_H / 2;
      // Each statue must "face center" — facing dir is the dir of the arrow.
      // We compute the dir-from-statue-to-center and require facing === that.
      let allFacing = true;
      for (const s of this.puzzleStatues) {
        const dx = cx - s.x, dy = cy - s.y;
        const wantHorizontal = Math.abs(dx) >= Math.abs(dy);
        const want = wantHorizontal
          ? (dx > 0 ? 0 : 2)   // right or left
          : (dy > 0 ? 1 : 3);  // down or up
        if (s._facing !== want) { allFacing = false; break; }
      }
      if (allFacing) {
        this.puzzleState.solved = true;
        try { this.sound.play("sfx_door", { volume: 0.6 }); } catch (_) {}
        this._showFanfare("THE WAY OPENS");
      }
    }

    _spawnPickup(kind, x, y) {
      const tpl = D.ITEMS[kind];
      if (!tpl) { console.warn("[pass2] unknown item kind:", kind); return; }
      // Chest-worthy items get a closed-chest visual; consumables (heart,
      // rupee, bomb_refill, side_quest_flower) lie on the floor as icons.
      const isChest = CHEST_KINDS.has(kind);
      let it;
      if (isChest) {
        it = this._drawClosedChest(x, y);
        it._isChest = true;
        it._opened = false;
      } else {
        it = this._drawItemIcon(kind, tpl, x, y);
        // Gentle pulse — telegraphs "pickup me"
        this.tweens.add({
          targets: it, scaleX: 1.15, scaleY: 1.15, duration: 600, yoyo: true, repeat: -1, ease: "Sine.inOut",
        });
      }
      it.active = true;
      it._kind = kind;
      it._template = tpl;
      this.entityLayer.add(it);
      this.itemsOnGround.push(it);
    }

    _drawClosedChest(x, y) {
      const container = this.add.container(x, y);
      const g = this.add.graphics();
      container.add(g);
      // Shadow at base
      g.fillStyle(0x000000, 0.3);
      g.fillEllipse(0, 5, 12, 3);
      // Chest body (wooden box)
      g.fillStyle(0x78350f, 1);
      g.fillRect(-5, -2, 10, 7);
      g.lineStyle(0.5, 0x451a03, 1);
      g.strokeRect(-5, -2, 10, 7);
      // Chest lid (curved top — approximated with a rect + corner shadow)
      g.fillStyle(0x92400e, 1);
      g.fillRect(-5, -5, 10, 4);
      g.lineStyle(0.5, 0x451a03, 1);
      g.strokeRect(-5, -5, 10, 4);
      // Metal bands (gold)
      g.fillStyle(0xfacc15, 1);
      g.fillRect(-5, -1, 10, 1);
      g.fillRect(-5, 2, 10, 1);
      // Latch (center front)
      g.fillStyle(0xeab308, 1);
      g.fillRect(-1, -2, 2, 2);
      g.fillStyle(0x000000, 1);
      g.fillCircle(0, -1, 0.4);
      // Subtle pulse to attract attention
      this.tweens.add({
        targets: container, y: y - 1, duration: 800, yoyo: true, repeat: -1, ease: "Sine.inOut",
      });
      return container;
    }

    _openChest(chest) {
      if (chest._opened) return;
      chest._opened = true;
      // Draw open-chest state (lid lifted) + item icon rising overhead
      // Wipe the existing Graphics and redraw open
      const oldG = chest.list[0];
      if (oldG && oldG.destroy) oldG.destroy();
      const g = this.add.graphics();
      chest.add(g);
      // Shadow + body unchanged
      g.fillStyle(0x000000, 0.3); g.fillEllipse(0, 5, 12, 3);
      g.fillStyle(0x78350f, 1); g.fillRect(-5, -2, 10, 7);
      g.lineStyle(0.5, 0x451a03, 1); g.strokeRect(-5, -2, 10, 7);
      g.fillStyle(0xfacc15, 1); g.fillRect(-5, -1, 10, 1); g.fillRect(-5, 2, 10, 1);
      // Dark inside (chest is open)
      g.fillStyle(0x1a0a00, 1);
      g.fillRect(-4, -1, 8, 5);
      // Open lid tilted backward (rotated rect approximation — a polygon)
      g.fillStyle(0x92400e, 1);
      g.fillTriangle(-5, -5, 5, -5, 5, -2);
      g.fillTriangle(-5, -5, 5, -2, -5, -2);
      g.lineStyle(0.5, 0x451a03, 1);
      g.strokeTriangle(-5, -5, 5, -5, 5, -2);
      // Yellow flash burst (briefly)
      const flash = this.add.circle(chest.x, chest.y - 2, 10, 0xfde047, 0.85);
      this.fxLayer.add(flash);
      this.tweens.add({ targets: flash, scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 360, onComplete: () => flash.destroy() });
      // Sparkles
      for (let i = 0; i < 6; i++) {
        const sp = this.add.circle(chest.x + (Math.random() - 0.5) * 12, chest.y - 4, 0.8, 0xfde047, 1);
        this.fxLayer.add(sp);
        this.tweens.add({
          targets: sp, x: chest.x + (Math.random() - 0.5) * 24, y: chest.y - 12 - Math.random() * 6, alpha: 0,
          duration: 700 + Math.random() * 300, onComplete: () => sp.destroy(),
        });
      }
      // Item icon rises overhead
      const tpl = chest._template;
      const innerIcon = this._drawItemIcon(chest._kind, tpl, chest.x, chest.y - 2);
      this.fxLayer.add(innerIcon);
      this.tweens.add({
        targets: innerIcon, y: chest.y - 14, scaleX: 1.4, scaleY: 1.4, duration: 700, ease: "Sine.out",
      });
      this.tweens.add({
        targets: innerIcon, alpha: 0, duration: 300, delay: 800, onComplete: () => innerIcon.destroy(),
      });
      try { this.sound.play("sfx_door", { volume: 0.5 }); } catch (_) {}
    }

    _drawItemIcon(kind, tpl, x, y) {
      // Container holding the shape — set its position so the body lives at (x, y)
      const container = this.add.container(x, y);
      const g = this.add.graphics();
      container.add(g);
      const baseCol = tpl.color || 0xfacc15;
      const outline = 0x111111;
      if (kind === "heart" || kind === "heart_container") {
        const s = (kind === "heart_container") ? 1.7 : 1.0;
        // Two circles + triangle bottom — classic heart silhouette
        g.fillStyle(baseCol, 1);
        g.fillCircle(-2*s, -1*s, 2.4*s);
        g.fillCircle( 2*s, -1*s, 2.4*s);
        g.fillTriangle(-4*s, 0.5*s, 4*s, 0.5*s, 0, 4.5*s);
        g.lineStyle(1, outline, 1);
        g.strokeCircle(-2*s, -1*s, 2.4*s);
        g.strokeCircle( 2*s, -1*s, 2.4*s);
        g.strokeTriangle(-4*s, 0.5*s, 4*s, 0.5*s, 0, 4.5*s);
      } else if (kind === "heart_piece") {
        // Quarter heart — top-right wedge of a heart
        g.fillStyle(baseCol, 1);
        g.fillCircle(0, -1, 2.5);
        g.fillTriangle(-3, 0, 3, 0, 0, 4);
        g.lineStyle(1, outline, 1);
        g.strokeCircle(0, -1, 2.5);
      } else if (kind === "rupee_green" || kind === "rupee_blue" || kind === "rupee_red") {
        // Diamond gem
        g.fillStyle(baseCol, 1);
        g.fillPoints([{x:0,y:-4},{x:3,y:0},{x:0,y:4},{x:-3,y:0}], true);
        g.lineStyle(1, outline, 1);
        g.strokePoints([{x:0,y:-4},{x:3,y:0},{x:0,y:4},{x:-3,y:0}, {x:0,y:-4}]);
        // Highlight
        g.fillStyle(0xffffff, 0.5);
        g.fillTriangle(-1, -3, 1, -3, 0, -1);
      } else if (kind === "small_key") {
        // Key — round bow on left + shaft + notch
        g.fillStyle(baseCol, 1);
        g.fillCircle(-2.5, 0, 2);
        g.fillRect(-1, -1, 5, 2);
        g.fillRect(3, -2, 1.2, 4);   // notch
        g.lineStyle(1, outline, 1);
        g.strokeCircle(-2.5, 0, 2);
      } else if (kind === "big_key") {
        // Big ornate key — bigger bow + cross + notch
        g.fillStyle(baseCol, 1);
        g.fillCircle(-3, 0, 3);
        g.fillCircle(-3, 0, 1.5);    // inner ring (hole)
        g.fillRect(-1, -1, 7, 2);
        g.fillRect(4, -3, 1.5, 6);
        g.lineStyle(1, outline, 1);
        g.strokeCircle(-3, 0, 3);
        // Center the hole — re-draw black
        g.fillStyle(0x000000, 1);
        g.fillCircle(-3, 0, 1);
      } else if (kind === "bow") {
        // Bow + arrow icon
        g.lineStyle(1.5, baseCol, 1);
        g.strokeCircle(-1, 0, 4);    // bow arc (partial via stroke)
        g.fillStyle(0xfde047, 1);
        g.fillRect(-4, -0.5, 8, 1);  // arrow shaft
        g.fillTriangle(4, -2, 4, 2, 6, 0);  // arrowhead
      } else if (kind === "bombs" || kind === "bomb_refill") {
        // Black bomb with yellow spark fuse
        g.fillStyle(0x1f2937, 1);
        g.fillCircle(0, 1, 3.5);
        g.lineStyle(1, outline, 1);
        g.strokeCircle(0, 1, 3.5);
        // Fuse
        g.lineStyle(1, 0xfacc15, 1);
        g.lineBetween(2, -2, 4, -4);
        // Spark
        g.fillStyle(0xfde047, 1);
        g.fillCircle(4, -4, 1.2);
      } else if (kind === "dungeon_map") {
        // Folded parchment with crease lines
        g.fillStyle(baseCol, 1);
        g.fillRect(-4, -3, 8, 6);
        g.lineStyle(1, outline, 1);
        g.strokeRect(-4, -3, 8, 6);
        // Folds
        g.lineStyle(0.5, 0x78350f, 1);
        g.lineBetween(-1, -3, -1, 3);
        g.lineBetween(2, -3, 2, 3);
        // X marks the spot
        g.fillStyle(0xef4444, 1);
        g.fillCircle(0, 0, 0.6);
      } else if (kind === "dungeon_compass") {
        // Circular compass with N-S needle
        g.fillStyle(baseCol, 1);
        g.fillCircle(0, 0, 4);
        g.lineStyle(1, outline, 1);
        g.strokeCircle(0, 0, 4);
        // Needle
        g.fillStyle(0xef4444, 1);
        g.fillTriangle(0, -3, -1, 0, 1, 0);
        g.fillStyle(0xfff, 1);
        g.fillTriangle(0, 3, -1, 0, 1, 0);
        g.fillStyle(0x000, 1);
        g.fillCircle(0, 0, 0.7);
      } else if (kind === "flower") {
        // Bioluminescent flower — 5 cyan petals + yellow center + green stem
        g.fillStyle(0x14532d, 1);
        g.fillRect(-0.5, 1, 1, 4);   // stem
        g.fillStyle(baseCol, 1);     // cyan petals
        const r = 1.8;
        for (let i = 0; i < 5; i++) {
          const a = i * (Math.PI * 2 / 5) - Math.PI / 2;
          g.fillCircle(Math.cos(a) * r, Math.sin(a) * r - 1, 1.6);
        }
        g.fillStyle(0xfde047, 1);    // yellow center
        g.fillCircle(0, -1, 1.0);
      } else if (kind === "boomerang") {
        // V-shape boomerang
        g.fillStyle(baseCol, 1);
        g.fillPoints([{x:-3,y:0},{x:-1,y:-3},{x:1,y:-1},{x:3,y:-3},{x:1,y:0},{x:-1,y:1}], true);
        g.lineStyle(1, outline, 1);
        g.strokePoints([{x:-3,y:0},{x:-1,y:-3},{x:1,y:-1},{x:3,y:-3},{x:1,y:0},{x:-1,y:1},{x:-3,y:0}]);
      } else {
        // Fallback — generic colored square
        g.fillStyle(baseCol, 1);
        g.fillRect(-4, -4, 8, 8);
        g.lineStyle(1, outline, 1);
        g.strokeRect(-4, -4, 8, 8);
      }
      return container;
    }

    _tickEnemies(time, delta) {
      const p = this.player;
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue;
        // Flash + telegraph — works for both atlas sprites (setTint) and rectangles (fillColor)
        const baseColor = (e._phase === 2 && e._template === "guardian_of_first_light")
          ? 0xfde047 : e.color;
        let drawColor = (e.flash_until > time) ? 0xffffff : baseColor;
        if (e._telegraph_until > time) {
          drawColor = ((Math.floor(time/80) % 2) === 0) ? 0xffffff : baseColor;
        }
        if (e._useAtlas) {
          if (e.setTint) e.setTint(drawColor);
        } else {
          e.fillColor = drawColor;
        }
        // Skip AI during knockback (except boss — boss is heavier)
        if (e.knockback_until > time && e._role !== "boss") continue;

        switch (e._behavior) {
          case "patrol": this._ai_patrol(e, p, time); break;
          case "chase":  this._ai_chase(e, p, time);  break;
          case "shoot":  this._ai_shoot(e, p, time);  break;
          case "guard":  this._ai_guard(e, p, time);  break;
          case "charge": this._ai_charge(e, p, time); break;
          case "fly":    this._ai_fly(e, p, time);    break;
          default:
            if (e._template === "guardian_of_first_light") this._ai_boss_guardian(e, p, time);
            else e.body.setVelocity(0, 0);
        }
        // Contact damage to player (skip during boss phase-transition stun)
        if (e._stun_until > time) continue;
        if (Phaser.Geom.Intersects.RectangleToRectangle(p.getBounds(), e.getBounds())) {
          this._damagePlayer(e.dmg * 0.5, e.x, e.y);
        }
      }
    }

    // ── Enemy AI behaviors ─────────────────────────────────────────

    _ai_patrol(e, p, time) {
      if (!e._ai.change_at) e._ai.change_at = time + 1500;
      if (time > e._ai.change_at) {
        e._ai.dir *= -1;
        e._ai.change_at = time + 1200 + Math.random() * 800;
      }
      e.body.setVelocity(e.speed * e._ai.dir, 0);
      const aheadX = e.x + e._ai.dir * 8;
      const tx = Math.floor(aheadX / TILE);
      const ty = Math.floor(e.y / TILE);
      const ch = (this.currentRoom.tiles[ty] || "")[tx];
      if (SOLID_TILES.has(ch)) { e._ai.dir *= -1; e._ai.change_at = time + 1000; }
    }

    _ai_chase(e, p, time) {
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const len = Math.max(0.001, Math.hypot(dx, dy));
      let vx = (dx/len) * e.speed;
      let vy = (dy/len) * e.speed;
      // Naive wall-avoidance: if blocked by solid tile ahead, sidestep
      const aheadX = e.x + Math.sign(vx) * 8;
      const aheadY = e.y + Math.sign(vy) * 8;
      const txX = Math.floor(aheadX / TILE);
      const tyY = Math.floor(aheadY / TILE);
      const chX = (this.currentRoom.tiles[Math.floor(e.y/TILE)] || "")[txX];
      const chY = (this.currentRoom.tiles[tyY] || "")[Math.floor(e.x/TILE)];
      if (SOLID_TILES.has(chX)) vx = 0;
      if (SOLID_TILES.has(chY)) vy = 0;
      e.body.setVelocity(vx, vy);
    }

    _ai_shoot(e, p, time) {
      // Wraithwhisper — hover near spawn, fire at player every 2s with 1s telegraph
      if (!e._ai.last_shot) e._ai.last_shot = time + 1000;
      const cd = 2000;
      const telegraph_ms = 700;
      // Gentle hover sway (sin pattern)
      const swayX = Math.sin(time * 0.002) * 0.3;
      const swayY = Math.cos(time * 0.0023) * 0.3;
      // Always drift slightly toward player for menace
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const len = Math.max(0.001, Math.hypot(dx, dy));
      const driftSp = e.speed * 0.5;
      e.body.setVelocity((dx/len) * driftSp + swayX, (dy/len) * driftSp + swayY);
      // Fire cycle
      if (time - e._ai.last_shot > cd) {
        if (!e._telegraph_until) {
          e._telegraph_until = time + telegraph_ms;
        } else if (time > e._telegraph_until) {
          this._enemyFireProjectile(e, p);
          e._ai.last_shot = time;
          e._telegraph_until = 0;
        }
      }
    }

    _ai_guard(e, p, time) {
      // Geomancer Statue — stationary, slam attack every 3s shockwave
      e.body.setVelocity(0, 0);
      if (!e._ai.last_slam) e._ai.last_slam = time + 1500;
      const cd = 3000;
      const telegraph_ms = 600;
      if (time - e._ai.last_slam > cd) {
        if (!e._telegraph_until) {
          e._telegraph_until = time + telegraph_ms;
        } else if (time > e._telegraph_until) {
          this._enemySlam(e);
          e._ai.last_slam = time;
          e._telegraph_until = 0;
        }
      }
    }

    _ai_fly(e, p, time) {
      // Hover with sin-sway, dive at player when within dive_range.
      const tpl = D.ENEMIES[e._template] || {};
      const diveRange = tpl.dive_range || 50;
      const diveSpeed = tpl.dive_speed || 100;
      const dist = Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y);
      if (!e._diving && dist < diveRange) {
        e._diving = true;
        e._dive_end = time + 800;
      }
      if (e._diving) {
        if (time < e._dive_end) {
          const dx = p.x - e.x, dy = p.y - e.y;
          const len = Math.max(0.001, Math.hypot(dx, dy));
          e.body.setVelocity((dx/len) * diveSpeed, (dy/len) * diveSpeed);
        } else {
          e._diving = false;
        }
      } else {
        // Hover sway + slow drift toward player from far
        const sx = Math.cos(time * 0.003) * 12;
        const sy = Math.sin(time * 0.004) * 10;
        const dx = p.x - e.x, dy = p.y - e.y;
        const len = Math.max(0.001, Math.hypot(dx, dy));
        e.body.setVelocity(sx + (dx/len) * 18, sy + (dy/len) * 18);
      }
    }

    _ai_charge(e, p, time) {
      // Crystalspine Boar — line of sight horizontal/vertical, charge at high speed
      if (!e._ai.charging) e._ai.charging = false;
      if (e._ai.charging) {
        // Continue current charge until wall hit or off-screen
        const aheadX = e.x + e._ai.charge_dir.x * 8;
        const aheadY = e.y + e._ai.charge_dir.y * 8;
        const tx = Math.floor(aheadX / TILE);
        const ty = Math.floor(aheadY / TILE);
        const ch = (this.currentRoom.tiles[ty] || "")[tx];
        if (SOLID_TILES.has(ch) || time > e._ai.charge_end) {
          e._ai.charging = false;
          e.body.setVelocity(0, 0);
          e._stun_until = time + 600;   // boar stunned after wall slam
        }
      } else {
        // Idle — wait, then check line of sight
        if (!e._ai.next_check) e._ai.next_check = time + 800;
        if (time > e._ai.next_check) {
          e._ai.next_check = time + 600;
          const dx = p.x - e.x;
          const dy = p.y - e.y;
          if (Math.abs(dx) < 16 && Math.abs(dy) > 16) {
            // Vertical line of sight
            e._ai.charging = true;
            e._ai.charge_dir = { x: 0, y: Math.sign(dy) };
            e._ai.charge_end = time + 1500;
          } else if (Math.abs(dy) < 16 && Math.abs(dx) > 16) {
            // Horizontal line of sight
            e._ai.charging = true;
            e._ai.charge_dir = { x: Math.sign(dx), y: 0 };
            e._ai.charge_end = time + 1500;
          }
        }
        if (e._ai.charging) {
          e.body.setVelocity(e._ai.charge_dir.x * e.speed * 1.6, e._ai.charge_dir.y * e.speed * 1.6);
        }
      }
    }

    // ── Guardian boss AI (2 phases) ────────────────────────────────

    _ai_boss_guardian(e, p, time) {
      if (!e._phase) {
        e._phase = 1;
        e._ai.next_attack = time + 1200;
      }
      // Phase 1 — chase player + occasional slam shockwave
      if (e._phase === 1) {
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const len = Math.max(0.001, Math.hypot(dx, dy));
        e.body.setVelocity((dx/len) * e.speed, (dy/len) * e.speed);
        if (time > e._ai.next_attack) {
          if (!e._telegraph_until) {
            e._telegraph_until = time + 700;
            e.body.setVelocity(0, 0);
          } else if (time > e._telegraph_until) {
            this._enemySlam(e, 38);  // wide shockwave
            e._telegraph_until = 0;
            e._ai.next_attack = time + 3500;
          }
        }
      } else if (e._phase === 2) {
        // Phase 2 — sword-immune, faster, fires projectile ring every 4s
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const len = Math.max(0.001, Math.hypot(dx, dy));
        e.body.setVelocity((dx/len) * e.speed * 1.4, (dy/len) * e.speed * 1.4);
        if (time > e._ai.next_attack) {
          // Burst-fire 4 projectiles in cardinal directions
          for (const dir of [[1,0],[-1,0],[0,1],[0,-1]]) {
            this._enemyFireProjectileDir(e, dir[0], dir[1]);
          }
          e._ai.next_attack = time + 4000;
        }
      }
    }

    // ── Enemy projectiles + slam shockwave ─────────────────────────

    _enemyFireProjectile(e, p) {
      // Aim straight at player at fire time (no tracking)
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const len = Math.max(0.001, Math.hypot(dx, dy));
      this._enemyFireProjectileDir(e, dx/len, dy/len);
    }
    _enemyFireProjectileDir(e, dirX, dirY) {
      if (!this.enemyProjectiles) this.enemyProjectiles = [];
      const proj = this.add.circle(e.x, e.y, 3, 0xa855f7);
      proj.setStrokeStyle(1, 0x4c1d95);
      this.physics.add.existing(proj);
      proj.body.setAllowGravity && proj.body.setAllowGravity(false);
      proj.body.setSize(4, 4);
      const speed = 140;
      proj.body.setVelocity(dirX * speed, dirY * speed);
      proj._dmg = e.dmg || 1;
      proj._spawn_time = this.time.now;
      this.fxLayer.add(proj);
      this.enemyProjectiles.push(proj);
      try { this.sound.play("sfx_shoot", { volume: 0.3 }); } catch (_) {}
    }

    _tickEnemyProjectiles(time) {
      if (!this.enemyProjectiles) return;
      for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
        const pj = this.enemyProjectiles[i];
        // Off-screen or stale → despawn
        if (pj.x < 0 || pj.x > SCREEN_W || pj.y < 0 || pj.y > SCREEN_H || time - pj._spawn_time > 3500) {
          pj.destroy();
          this.enemyProjectiles.splice(i, 1);
          continue;
        }
        // Hit player
        if (Phaser.Geom.Intersects.RectangleToRectangle(pj.getBounds(), this.player.getBounds())) {
          this._damagePlayer(pj._dmg * 0.5, pj.x, pj.y);
          pj.destroy();
          this.enemyProjectiles.splice(i, 1);
          continue;
        }
        // Hit wall
        const tx = Math.floor(pj.x / TILE);
        const ty = Math.floor(pj.y / TILE);
        const ch = (this.currentRoom.tiles[ty] || "")[tx];
        if (SOLID_TILES.has(ch)) {
          pj.destroy();
          this.enemyProjectiles.splice(i, 1);
        }
      }
    }

    _enemySlam(e, radius) {
      // Radial shockwave damages player if within radius
      radius = radius || 28;
      const ring = this.add.circle(e.x, e.y, 4, 0xff3344, 0.4);
      ring.setStrokeStyle(2, 0xfde047, 1);
      this.fxLayer.add(ring);
      this.tweens.add({ targets: ring, radius: radius, alpha: 0,
        duration: 280, onComplete: () => ring.destroy() });
      if (Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y) < radius) {
        this._damagePlayer((e.dmg || 1) * 0.5, e.x, e.y);
      }
      try { this.sound.play("sfx_hit", { volume: 0.5 }); } catch (_) {}
    }

    _tickPickups(time) {
      const p = this.player;
      for (let i = this.itemsOnGround.length - 1; i >= 0; i--) {
        const it = this.itemsOnGround[i];
        if (!it.active) continue;
        if (it._pending_collect) continue;  // already opening, waiting for delay
        if (Phaser.Math.Distance.Between(p.x, p.y, it.x, it.y) < 10) {
          if (it._isChest && !it._opened) {
            // Open chest with animation, collect after delay so the player
            // sees the lid-lift + sparkle + item-rise sequence.
            it._pending_collect = true;
            this._openChest(it);
            this.time.delayedCall(900, () => {
              if (!it || !it.scene) return;
              this._collectItem(it);
              it.destroy();
              const idx = this.itemsOnGround.indexOf(it);
              if (idx >= 0) this.itemsOnGround.splice(idx, 1);
            });
          } else if (!it._isChest) {
            // Consumable floor drop — instant pickup
            this._collectItem(it);
            it.destroy();
            this.itemsOnGround.splice(i, 1);
          }
        }
      }
    }

    _collectItem(it) {
      const kind = it._kind;
      const tpl = it._template;
      const q = this.quest.flags;
      let sfx = "sfx_pickup";
      if (tpl.kind === "rupee") { q.rupees += tpl.value; sfx = "sfx_coin"; }
      else if (tpl.kind === "key") { q.small_keys += 1; sfx = "sfx_pickup"; }
      else if (tpl.kind === "big_key") { q.big_key = true; sfx = "sfx_levelup"; }
      else if (tpl.kind === "heart_refill") { this.hearts = Math.min(D.PLAYER.max_hearts, this.hearts + 0.5); sfx = "sfx_heal"; }
      else if (tpl.kind === "heart_piece") { q.heart_pieces += 1; sfx = "sfx_levelup"; if (q.heart_pieces >= 4) { q.heart_pieces -= 4; D.PLAYER.max_hearts += 1; this.hearts = D.PLAYER.max_hearts; } }
      else if (tpl.kind === "heart_container") { D.PLAYER.max_hearts += 1; this.hearts = D.PLAYER.max_hearts; sfx = "sfx_levelup"; }
      else if (tpl.kind === "weapon") {
        if (tpl.id === "bow") { q.has_bow = true; if (!this.currentItem) this.currentItem = "bow"; }
        else if (tpl.id === "bombs") { q.has_bombs = true; this.bombCount += 4; if (!this.currentItem) this.currentItem = "bombs"; }
        else if (tpl.id === "boomerang") { q.has_boomerang = true; if (!this.currentItem) this.currentItem = "boomerang"; }
        sfx = "sfx_levelup";
      }
      else if (tpl.kind === "bomb_refill") {
        this.bombCount += (tpl.value || 3);
        sfx = "sfx_pickup";
      }
      else if (tpl.kind === "dungeon_map") {
        q.has_map = true;
        sfx = "sfx_levelup";
        this._showFanfare("GOT THE MAP");
        this._updateMinimap && this._updateMinimap();
      }
      else if (tpl.kind === "dungeon_compass") {
        q.has_compass = true;
        sfx = "sfx_levelup";
        this._showFanfare("GOT THE COMPASS");
        this._updateMinimap && this._updateMinimap();
      }
      else if (tpl.kind === "side_quest_flower") {
        // Heda's flower side quest — collect 3 and return to her for a heart piece.
        // NOTE: `q` above is this.quest.flags; flower-quest state lives on this.quest
        // directly (top-level fields), so we mutate `this.quest` here.
        const Q = this.quest;
        if (Q.flowers_collected === undefined) Q.flowers_collected = 0;
        Q.flowers_collected += 1;
        if (Q.side_quest_flowers === "not_started" || !Q.side_quest_flowers) Q.side_quest_flowers = "in_progress";
        if (Q.flowers_collected >= 3 && Q.side_quest_flowers === "in_progress") {
          Q.side_quest_flowers = "ready_to_return";
          this._showFanfare("3 FLOWERS — RETURN TO HEDA");
        } else {
          this._showFanfare("FLOWER " + Q.flowers_collected + " / 3");
        }
        sfx = "sfx_pickup";
      }
      try { this.sound.play(sfx, { volume: 0.5 }); } catch (_) {}
      // Mark the current room as having had an item collected (clears compass dot)
      if (!this._collectedRoomItems) this._collectedRoomItems = new Set();
      this._collectedRoomItems.add(this.currentRoomId);
      this._updateMinimap && this._updateMinimap();
      this._refreshHUD();
      this._refreshItemSlot();
      // Item-get fanfare for high-value pickups
      const fanfareKinds = new Set(["weapon", "big_key", "heart_container", "heart_piece"]);
      if (fanfareKinds.has(tpl.kind)) {
        const label = tpl.kind === "weapon"  ? "GOT: " + (tpl.id || "ITEM").toUpperCase()
                    : tpl.kind === "big_key" ? "GOT: BIG KEY"
                    : tpl.kind === "heart_container" ? "HEART CONTAINER!"
                    : "HEART PIECE";
        this._showFanfare(label);
      }
    }

    _showFanfare(label) {
      const t = this.add.text(SCREEN_W/2, 80, label,
        { font: "bold 14px serif", color: "#fde047", stroke: "#000", strokeThickness: 2 })
        .setOrigin(0.5);
      this.fxLayer.add(t);
      this.tweens.add({ targets: t, y: 50, alpha: 0,
        duration: 1700, delay: 600, onComplete: () => t.destroy() });
    }

    _winAct1() {
      this.attackUntil = 999999;
      // Big shake + gold fade
      this.cameras.main.shake(420, 0.012);
      this.cameras.main.fade(1500, 255, 215, 0);
      // Clear save so player can replay from scratch
      try { localStorage.removeItem("shroud_save_v1"); } catch (_) {}
      this.time.delayedCall(1700, () => this.scene.start("P2_Win"));
    }

    // ══════════════════════════════════════════════════════════════
    // ITEMS — bow, bombs, item-slot cycling
    // ══════════════════════════════════════════════════════════════

    _cycleItem() {
      const q = this.quest.flags;
      const owned = [];
      if (q.has_bow) owned.push("bow");
      if (q.has_bombs) owned.push("bombs");
      if (q.has_boomerang) owned.push("boomerang");
      if (owned.length === 0) { this.currentItem = null; this._refreshItemSlot(); return; }
      const idx = this.currentItem ? owned.indexOf(this.currentItem) : -1;
      this.currentItem = owned[(idx + 1) % owned.length];
      try { this.sound.play("sfx_menu_select", { volume: 0.4 }); } catch (_) {}
      this._refreshItemSlot();
    }

    _useItem(time) {
      const q = this.quest.flags;
      if (!this.currentItem) return;
      if (this.currentItem === "bow" && q.has_bow) {
        this._fireArrow(time);
      } else if (this.currentItem === "bombs" && q.has_bombs && this.bombCount > 0) {
        this._dropBomb(time);
      }
      // boomerang reserved for future expansion (returns to player, stuns enemies)
    }

    _refreshItemSlot() {
      if (!this.hudItem) return;
      const label = this.currentItem
        ? (this.currentItem === "bombs" ? `BOMBS x${this.bombCount}` : this.currentItem.toUpperCase())
        : "(no item)";
      this.hudItem.setText(`[${label}]`);
    }

    // ── Bow + arrows ──────────────────────────────────────────────

    _fireArrow(time) {
      if (this.lastArrowFire && time - this.lastArrowFire < 280) return;
      const a = this.arrows.find(x => !x.active);
      if (!a) return;
      this.lastArrowFire = time;
      a.active = true;
      a.setVisible(true);
      a._embed_until = 0;
      const dirVec = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] }[this.player.facing] || [0,1];
      a.x = this.player.x + dirVec[0] * 8;
      a.y = this.player.y + dirVec[1] * 8;
      // Orient arrow visually
      if (dirVec[0] !== 0) { a.setSize(6, 2); a.body.setSize(6, 2); }
      else { a.setSize(2, 6); a.body.setSize(2, 6); }
      const speed = 220;
      a.body.setVelocity(dirVec[0] * speed, dirVec[1] * speed);
      a._dir = dirVec;
      try { this.sound.play("sfx_shoot", { volume: 0.4 }); } catch (_) {}
    }

    _tickArrows(time) {
      for (const a of this.arrows) {
        if (!a.active) continue;
        // Embedded (stuck in wall) — hide after embed_until
        if (a._embed_until > 0) {
          if (time > a._embed_until) {
            a.active = false; a.setVisible(false);
            a.x = -100; a.y = -100;
            a.body.setVelocity(0, 0);
          }
          continue;
        }
        // Off-screen → recycle
        if (a.x < 0 || a.x > SCREEN_W || a.y < 0 || a.y > SCREEN_H) {
          a.active = false; a.setVisible(false);
          a.body.setVelocity(0, 0);
          continue;
        }
        // Solid-tile hit → embed
        const tx = Math.floor(a.x / TILE);
        const ty = Math.floor(a.y / TILE);
        const ch = (this.currentRoom.tiles[ty] || "")[tx];
        if (SOLID_TILES.has(ch) || WEAK_WALL_TILES.has(ch)) {
          a.body.setVelocity(0, 0);
          a._embed_until = time + 500;
          continue;
        }
        // Enemy hit → damage + recycle
        for (const e of this.enemies) {
          if (!e.active || e.dead) continue;
          if (Phaser.Geom.Intersects.RectangleToRectangle(a.getBounds(), e.getBounds())) {
            this._damageEnemy(e, 1, "arrow");
            a.active = false; a.setVisible(false);
            a.body.setVelocity(0, 0);
            a.x = -100; a.y = -100;
            break;
          }
        }
      }
    }

    // ── Bombs ─────────────────────────────────────────────────────

    _dropBomb(time) {
      if (this.bombCount <= 0) return;
      this.bombCount -= 1;
      const b = this.add.rectangle(this.player.x, this.player.y + 4, 8, 8, 0x1f2937);
      b.setStrokeStyle(1, 0xfacc15);
      this.physics.add.existing(b);
      b.body.setAllowGravity && b.body.setAllowGravity(false);
      b.body.setSize(6, 6);
      b._fuse_end = time + 2000;
      b._exploded = false;
      this.fxLayer.add(b);
      this.bombs.push(b);
      this._refreshItemSlot();
    }

    _tickBombs(time) {
      for (let i = this.bombs.length - 1; i >= 0; i--) {
        const b = this.bombs[i];
        if (b._exploded) {
          // Hold explosion VFX for 220ms then despawn
          if (time > b._explode_until) {
            b.destroy();
            this.bombs.splice(i, 1);
          }
          continue;
        }
        // Pulse before exploding
        const remaining = b._fuse_end - time;
        if (remaining > 0) {
          const flash = (Math.floor(time / (remaining < 500 ? 80 : 160)) % 2) === 0;
          b.fillColor = flash ? 0xef4444 : 0x1f2937;
          continue;
        }
        // Explode
        this._explodeBomb(b, time);
      }
    }

    _explodeBomb(b, time) {
      b._exploded = true;
      b._explode_until = time + 220;
      // Visual: expand and brighten
      b.fillColor = 0xfbbf24;
      this.tweens.add({ targets: b, scaleX: 4, scaleY: 4, alpha: 0.6, duration: 180 });
      try { this.sound.play("sfx_enemy_die", { volume: 0.7 }); } catch (_) {}
      // Damage enemies in radius
      const radius = 32;
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue;
        if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) < radius) {
          this._damageEnemy(e, 2, "bomb");   // bombs do 2 dmg, can hit sword-immune bosses
        }
      }
      // Damage player if too close (Zelda canon: friendly fire!)
      if (Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y) < radius) {
        this._damagePlayer(0.5, b.x, b.y);
      }
      // Destroy weak walls in radius
      this._breakWeakWallsAround(b.x, b.y, radius);
    }

    _breakWeakWallsAround(cx, cy, radius) {
      const room = this.currentRoom;
      if (!room) return;
      // Mutate the room tile string — break weak walls within radius into floor
      const tiles = room.tiles.slice();
      let changed = false;
      const r2 = radius * radius;
      for (let y = 0; y < ROOM_H; y++) {
        let row = tiles[y];
        for (let x = 0; x < ROOM_W; x++) {
          const ch = row[x];
          if (!WEAK_WALL_TILES.has(ch)) continue;
          const px = x * TILE + TILE/2;
          const py = y * TILE + TILE/2;
          if ((px - cx) ** 2 + (py - cy) ** 2 < r2) {
            row = row.substring(0, x) + '.' + row.substring(x + 1);
            tiles[y] = row;
            changed = true;
            // Track for save
            if (!this._brokenWalls) this._brokenWalls = {};
            if (!this._brokenWalls[this.currentRoomId]) this._brokenWalls[this.currentRoomId] = [];
            this._brokenWalls[this.currentRoomId].push([x, y]);
          }
        }
      }
      if (changed) {
        room.tiles = tiles;
        // Spawn weak-wall reward (heart piece etc.) once per room
        if (room.weak_wall_reward && !room._weak_wall_consumed) {
          room._weak_wall_consumed = true;
          this._spawnPickup(room.weak_wall_reward.kind, SCREEN_W/2, SCREEN_H/2);
          try { this.sound.play("sfx_levelup", { volume: 0.5 }); } catch (_) {}
        }
        // Repaint tile layer
        this._repaintTiles();
      }
    }

    _repaintTiles() {
      // Re-render just the tile layer without rebuilding entities.
      const room = this.currentRoom;
      if (!room) return;
      this.tileLayer.removeAll(true);
      const g = this.add.graphics();
      this.tileLayer.add(g);
      const rng = (seed) => { let t = seed; return () => { t = (t * 1103515245 + 12345) & 0x7fffffff; return t / 0x7fffffff; }; };
      const rnd = rng(room.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
      for (let y = 0; y < ROOM_H; y++) {
        const row = room.tiles[y];
        for (let x = 0; x < ROOM_W; x++) {
          const ch = row && row[x] ? row[x] : '.';
          this._drawTile(g, ch, x * TILE, y * TILE, rnd);
          const decor = TILE_DRAW_DECOR[ch];
          if (decor) this._drawTileDecor(g, decor, x * TILE, y * TILE);
        }
      }
    }

    _drawTile(g, ch, x, y, rnd) {
      const T = TILE;
      switch (ch) {
        case '.': {
          // Grass — base + detail tufts + occasional flower
          g.fillStyle(0x4f7942, 1);
          g.fillRect(x, y, T, T);
          // Tufts (random across tile)
          g.fillStyle(0x3d5f33, 1);
          for (let i = 0; i < 3; i++) {
            const tx = x + Math.floor(rnd() * (T - 2));
            const ty = y + Math.floor(rnd() * (T - 2));
            g.fillRect(tx, ty, 1, 1);
          }
          // Highlight strands
          g.fillStyle(0x6b9a4f, 1);
          for (let i = 0; i < 2; i++) {
            const tx = x + Math.floor(rnd() * (T - 1));
            const ty = y + Math.floor(rnd() * (T - 1));
            g.fillRect(tx, ty, 1, 1);
          }
          break;
        }
        case '#': {
          // Zone-aware solid tile: trees in overworld, stone walls in dungeon.
          const zone = (this.currentRoom && this.currentRoom.zone) || '';
          const isOverworld = (zone === 'canopy_village' || zone === 'emerald_thicket' || zone === 'shrine_path');
          if (isOverworld) {
            // Tree — green canopy with darker trunk shadow
            g.fillStyle(0x365314, 1);          // shadow grass at base
            g.fillRect(x, y, T, T);
            // Canopy (mounded green)
            g.fillStyle(0x14532d, 1);
            g.fillCircle(x + 8, y + 6, 6);
            g.fillCircle(x + 4, y + 9, 4);
            g.fillCircle(x + 12, y + 9, 4);
            g.fillStyle(0x22c55e, 1);
            g.fillCircle(x + 6, y + 5, 2.5);
            g.fillCircle(x + 11, y + 5, 2);
            g.fillStyle(0x86efac, 0.8);
            g.fillCircle(x + 7, y + 4, 1);
            // Trunk hint at bottom
            g.fillStyle(0x451a03, 1);
            g.fillRect(x + 7, y + T - 3, 2, 3);
          } else {
            // Stone wall — brick pattern with shadow
            g.fillStyle(0x52525b, 1);
            g.fillRect(x, y, T, T);
            g.fillStyle(0x27272a, 1);
            g.fillRect(x, y + 5, T, 1);
            g.fillRect(x, y + 11, T, 1);
            g.fillRect(x + 7, y, 1, 5);
            g.fillRect(x + 3, y + 6, 1, 5);
            g.fillRect(x + 11, y + 6, 1, 5);
            g.fillRect(x + 7, y + 12, 1, 4);
            g.fillStyle(0x71717a, 1);
            g.fillRect(x, y, T, 1);
            g.fillStyle(0x18181b, 1);
            g.fillRect(x, y + T - 1, T, 1);
          }
          break;
        }
        case '~': {
          // Water — blue base + wave dashes
          g.fillStyle(0x1e40af, 1);
          g.fillRect(x, y, T, T);
          g.fillStyle(0x3b82f6, 1);
          g.fillRect(x + 2, y + 3, 4, 1);
          g.fillRect(x + 9, y + 7, 4, 1);
          g.fillRect(x + 4, y + 11, 4, 1);
          g.fillStyle(0x60a5fa, 0.5);
          g.fillRect(x + 2, y + 4, 4, 1);
          break;
        }
        case ':': {
          // Stone path — pale grey blocks
          g.fillStyle(0x9ca3af, 1);
          g.fillRect(x, y, T, T);
          g.fillStyle(0x6b7280, 1);
          g.fillRect(x, y + 7, T, 1);
          g.fillRect(x + 7, y, 1, T);
          // Crack detail
          g.fillStyle(0x6b7280, 1);
          g.fillRect(x + 3, y + 3, 1, 1);
          g.fillRect(x + 11, y + 11, 1, 1);
          break;
        }
        case 'W': {
          // Weak wall — cracked stone (lighter, with X crack)
          g.fillStyle(0x78350f, 1);
          g.fillRect(x, y, T, T);
          g.fillStyle(0x44200a, 1);
          g.lineStyle(1, 0x44200a, 1);
          g.lineBetween(x + 2, y + 2, x + T - 2, y + T - 2);
          g.lineBetween(x + T - 2, y + 2, x + 2, y + T - 2);
          // Highlight pebbles
          g.fillStyle(0xa3621f, 1);
          g.fillRect(x + 5, y + 5, 2, 2);
          break;
        }
        case '*': {
          // Bush — green base + leaf clusters
          g.fillStyle(0x4f7942, 1);  // grass underneath
          g.fillRect(x, y, T, T);
          g.fillStyle(0x14532d, 1);
          g.fillCircle(x + 5, y + 7, 3);
          g.fillCircle(x + 11, y + 9, 3);
          g.fillCircle(x + 8, y + 5, 2);
          g.fillStyle(0x22c55e, 0.6);
          g.fillCircle(x + 6, y + 6, 1);
          break;
        }
        case 'D':
        case 'L':
        case 'B': {
          // Door tile — render as wall-with-archway. Stone wall frames the
          // doorway on the sides; a darker recess + wooden door fills the
          // center. Looks integrated into the wall row instead of a
          // floating wood-box on a path tile.
          // Left wall frame
          g.fillStyle(0x52525b, 1);
          g.fillRect(x, y, 2, T);
          // Right wall frame
          g.fillRect(x + T - 2, y, 2, T);
          // Top arch stones
          g.fillRect(x, y, T, 3);
          // Dark recess behind door
          g.fillStyle(0x18181b, 1);
          g.fillRect(x + 2, y + 3, T - 4, T - 3);
          // Wooden door — vertical planks
          g.fillStyle(0x78350f, 1);
          g.fillRect(x + 3, y + 5, T - 6, T - 6);
          // Plank seam
          g.fillStyle(0x3f1d05, 1);
          g.fillRect(x + 7, y + 5, 1, T - 6);
          // Doorknob (small bronze dot)
          g.fillStyle(0xfacc15, 1);
          g.fillCircle(x + 11, y + 11, 0.8);
          // Top arch highlight
          g.fillStyle(0x71717a, 1);
          g.fillRect(x, y, T, 1);
          break;
        }
        case 'P': {
          // Pit — pure black void with rim shadow (decor handles the rim)
          g.fillStyle(0x000000, 1);
          g.fillRect(x, y, T, T);
          break;
        }
        case 's': {
          // Spike base — grass tile underneath (decor draws spikes on top)
          g.fillStyle(0x9ca3af, 1);
          g.fillRect(x, y, T, T);
          break;
        }
        case '$': {
          // Pickup spot = grass
          g.fillStyle(0x4f7942, 1);
          g.fillRect(x, y, T, T);
          break;
        }
        default: {
          g.fillStyle(0x222222, 1);
          g.fillRect(x, y, T, T);
        }
      }
    }

    _drawTileDecor(g, decor, x, y) {
      const cx = x + TILE/2, cy = y + TILE/2;
      switch (decor.shape) {
        case "lock_small": {
          // Yellow padlock overlaid on door — sits centered on the door panel
          g.fillStyle(decor.color, 1);
          g.fillRect(cx - 2, cy + 1, 4, 3);
          g.lineStyle(1, decor.color, 1);
          g.strokeCircle(cx, cy, 1.6);
          g.lineStyle(0.5, 0x111111, 1);
          g.strokeRect(cx - 2, cy + 1, 4, 3);
          // Keyhole dot
          g.fillStyle(0x111111, 1);
          g.fillCircle(cx, cy + 2, 0.5);
          break;
        }
        case "lock_big": {
          // Purple ornate lock overlaid on door
          g.fillStyle(decor.color, 1);
          g.fillRect(cx - 3, cy, 6, 4);
          g.lineStyle(1.5, decor.color, 1);
          g.strokeCircle(cx, cy - 1, 2);
          g.lineStyle(0.5, 0x111111, 1);
          g.strokeRect(cx - 3, cy, 6, 4);
          // Center jewel
          g.fillStyle(0xfde047, 1);
          g.fillCircle(cx, cy + 2, 0.8);
          break;
        }
        case "door": {
          // No-op — door art is now baked into _drawTile for 'D' tiles.
          break;
        }
        case "spike": {
          // 3 dark triangles
          g.fillStyle(0x9ca3af, 1);
          g.fillTriangle(x + 2, y + TILE - 2, x + 5, y + 4, x + 8, y + TILE - 2);
          g.fillTriangle(x + 8, y + TILE - 2, x + 11, y + 4, x + 14, y + TILE - 2);
          g.lineStyle(0.5, 0x000000, 1);
          g.strokeTriangle(x + 2, y + TILE - 2, x + 5, y + 4, x + 8, y + TILE - 2);
          g.strokeTriangle(x + 8, y + TILE - 2, x + 11, y + 4, x + 14, y + TILE - 2);
          break;
        }
        case "pit": {
          // Pure-black hole with darker rim
          g.fillStyle(0x000000, 1);
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle(0x1f2937, 1);
          g.fillRect(x, y, TILE, 2);   // top rim shadow
          g.fillRect(x, y, 2, TILE);
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // NPC DIALOGUE
    // ══════════════════════════════════════════════════════════════

    _findAdjacentNPC() {
      // Returns the closest NPC within 18px of the player, or null.
      if (!this.npcsInRoom) return null;
      const p = this.player;
      let best = null;
      let bestD = 18;
      for (const npcObj of this.npcsInRoom) {
        if (!npcObj || !npcObj._npcData) continue;   // labels don't have _npcData
        const d = Phaser.Math.Distance.Between(npcObj.x, npcObj.y, p.x, p.y);
        if (d < bestD) { bestD = d; best = npcObj; }
      }
      return best;
    }

    _dialogueOpen(npcObj) {
      const data = npcObj._npcData;
      if (!data) return;
      // Pick which dialogue state to use
      const stateKey = this._pickNpcDialogueState(data);
      const lines = (data.dialogue && data.dialogue[stateKey]) || [];
      if (lines.length === 0) return;
      this.dialogueActive = true;
      this.dialogueData = data;
      this.dialogueLines = lines.slice();
      this.dialogueIndex = 0;
      this.dialogueStateKey = stateKey;
      this._dialogueBuildBox();
      this._dialogueRenderLine();
      try { this.sound.play("sfx_menu_select", { volume: 0.4 }); } catch (_) {}
    }

    _pickNpcDialogueState(data) {
      const q = this.quest;
      const f = q.flags;
      // Heda — flower side quest progression
      if (data.id === "heda_herbalist") {
        if (q.side_quest_flowers === "returned" || q.side_quest_flowers === "done") return "complete";
        if (q.side_quest_flowers === "ready_to_return") return "complete";
        if (q.side_quest_flowers === "in_progress") return "in_progress";
        return "intro";
      }
      // Mira — different after dungeon clear
      if (data.id === "elder_mira") {
        if (q.main_quest === "act1_complete") return "after_dungeon";
        return "intro";
      }
      // Liora — different after first talk (which gives bow)
      if (data.id === "liora_scholar") {
        if (f.has_bow) return "after_bow";
        return "intro";
      }
      // Default
      return data.default_state || "intro";
    }

    _dialogueBuildBox() {
      // Build modal at bottom of screen — added to fxLayer (above tiles + entities)
      const boxX = 4;
      const boxY = SCREEN_H - 56;
      const boxW = SCREEN_W - 8;
      const boxH = 50;
      this._dialogueBox = this.add.rectangle(boxX, boxY, boxW, boxH, 0x0f172a, 0.92).setOrigin(0, 0);
      this._dialogueBox.setStrokeStyle(1, 0xfacc15);
      this._dialogueName = this.add.text(boxX + 4, boxY + 2,
        (this.dialogueData.name || "???") + ":",
        { font: "8px monospace", color: "#fde047" });
      this._dialogueText = this.add.text(boxX + 4, boxY + 14, "",
        { font: "7px monospace", color: "#fff", wordWrap: { width: boxW - 8 } });
      this._dialogueArrow = this.add.text(boxX + boxW - 12, boxY + boxH - 12, "▶",
        { font: "8px monospace", color: "#fde047" });
      // Blink the arrow
      this._dialogueArrowTween = this.tweens.add({
        targets: this._dialogueArrow, alpha: 0.2, duration: 500, yoyo: true, repeat: -1
      });
      this.fxLayer.add(this._dialogueBox);
      this.fxLayer.add(this._dialogueName);
      this.fxLayer.add(this._dialogueText);
      this.fxLayer.add(this._dialogueArrow);
    }

    _dialogueRenderLine() {
      if (!this._dialogueText) return;
      const line = this.dialogueLines[this.dialogueIndex] || "";
      this._dialogueText.setText(line);
    }

    _dialogueAdvance(time) {
      if (this._dialogueLastAdvance && time - this._dialogueLastAdvance < 180) return;
      this._dialogueLastAdvance = time;
      this.dialogueIndex += 1;
      if (this.dialogueIndex >= this.dialogueLines.length) {
        this._dialogueClose();
      } else {
        this._dialogueRenderLine();
        try { this.sound.play("sfx_menu_select", { volume: 0.3 }); } catch (_) {}
      }
    }

    _dialogueClose() {
      // Apply any on-close side-effects (give bow, advance quest state)
      const data = this.dialogueData;
      const stateKey = this.dialogueStateKey;
      const q = this.quest;
      const f = q.flags;
      if (data) {
        if (data.id === "elder_mira" && stateKey === "intro" && q.main_quest === "talk_to_mira") {
          q.main_quest = "enter_thicket";
        }
        if (data.id === "liora_scholar" && stateKey === "intro" && data.gives_bow_on_first_talk && !f.has_bow) {
          f.has_bow = true;
          if (!this.currentItem) this.currentItem = "bow";
          try { this.sound.play("sfx_levelup", { volume: 0.6 }); } catch (_) {}
          this._refreshItemSlot();
        }
        // Heda turn-in: 3 flowers → heart piece reward + side quest closes
        if (data.id === "heda_herbalist" && q.side_quest_flowers === "ready_to_return") {
          q.side_quest_flowers = "done";
          f.heart_pieces += 1;
          if (f.heart_pieces >= 4) {
            f.heart_pieces -= 4;
            D.PLAYER.max_hearts += 1;
            this.hearts = D.PLAYER.max_hearts;
          }
          this._showFanfare("HEART PIECE (" + f.heart_pieces + "/4)");
          try { this.sound.play("sfx_levelup", { volume: 0.6 }); } catch (_) {}
          this._refreshHUD();
        }
      }
      // Tear down UI
      [this._dialogueBox, this._dialogueName, this._dialogueText, this._dialogueArrow]
        .forEach(el => { if (el && el.destroy) el.destroy(); });
      if (this._dialogueArrowTween) this._dialogueArrowTween.stop();
      this._dialogueBox = this._dialogueName = this._dialogueText = this._dialogueArrow = null;
      this._dialogueArrowTween = null;
      this.dialogueActive = false;
      this.dialogueData = null;
      this.dialogueLines = null;
      this.dialogueIndex = 0;
      try { this.sound.play("sfx_menu_confirm", { volume: 0.3 }); } catch (_) {}
    }

    _gameOver() {
      // Player.invuln_until set to high val so further damage doesn't re-fire
      this.player.invuln_until = this.time.now + 99999;
      this.player.body.setVelocity(0, 0);
      this.cameras.main.shake(380, 0.012);
      this.cameras.main.fade(900, 0, 0, 0);
      this.time.delayedCall(1100, () => this.scene.start("P2_GameOver"));
    }

    _loadSave() {
      try {
        const raw = localStorage.getItem("shroud_save_v1");
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.quest) this.quest = s.quest;
        if (typeof s.hearts === "number") this.hearts = s.hearts;
        if (typeof s.max_hearts === "number") D.PLAYER.max_hearts = s.max_hearts;
        if (s.roomId) this.currentRoomId = s.roomId;
        if (s.currentItem) this._pendingItem = s.currentItem;   // applied after _refreshItemSlot exists
        if (typeof s.bombCount === "number") this._pendingBomb = s.bombCount;
        if (s.doorUnlocks) this._doorUnlocks = s.doorUnlocks;
        if (s.broken_walls) this._brokenWalls = s.broken_walls;  // map of roomId → [tile coords]
      } catch (_) {}
    }

    _applyPendingSave() {
      if (this._pendingItem) { this.currentItem = this._pendingItem; this._pendingItem = null; }
      if (typeof this._pendingBomb === "number") { this.bombCount = this._pendingBomb; this._pendingBomb = null; }
      this._refreshItemSlot();
      this._refreshHUD();
      // Re-apply room-specific broken weak-walls
      if (this._brokenWalls && this._brokenWalls[this.currentRoomId]) {
        const room = D.ROOMS[this.currentRoomId];
        for (const [x, y] of this._brokenWalls[this.currentRoomId]) {
          if (room.tiles[y] && WEAK_WALL_TILES.has(room.tiles[y][x])) {
            room.tiles[y] = room.tiles[y].substring(0, x) + '.' + room.tiles[y].substring(x + 1);
          }
        }
        this._repaintTiles();
      }
    }

    _writeSave() {
      try {
        const s = {
          quest: this.quest,
          hearts: this.hearts,
          max_hearts: D.PLAYER.max_hearts,
          roomId: this.currentRoomId,
          currentItem: this.currentItem,
          bombCount: this.bombCount,
          doorUnlocks: this._doorUnlocks || {},
          broken_walls: this._brokenWalls || {},
          ts: Date.now(),
        };
        localStorage.setItem("shroud_save_v1", JSON.stringify(s));
      } catch (_) {}
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P2_Pause — overlay paused scene (Esc to toggle)
  // ══════════════════════════════════════════════════════════════
  class PauseP2 extends Phaser.Scene {
    constructor() { super("P2_Pause"); }
    create() {
      const w = this.cameras.main.width, h = this.cameras.main.height;
      this.add.rectangle(0, 0, w, h, 0x000000, 0.6).setOrigin(0, 0);
      this.add.text(w/2, h/2 - 20, "PAUSED", { font: "32px serif", color: "#facc15" }).setOrigin(0.5);
      this.add.text(w/2, h/2 + 20, "Esc to resume  ·  Q to quit to menu",
        { font: "14px monospace", color: "#94a3b8" }).setOrigin(0.5);
      this.input.keyboard.on("keydown-ESC", () => {
        this.scene.stop();
        this.scene.resume("P2_Play");
      });
      this.input.keyboard.on("keydown-Q", () => {
        this.scene.stop("P2_Play");
        this.scene.stop();
        this.scene.start("P2_Menu");
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P2_Win — Act 1 cleared screen
  // ══════════════════════════════════════════════════════════════
  class WinP2 extends Phaser.Scene {
    constructor() { super("P2_Win"); }
    create() {
      const w = this.cameras.main.width, h = this.cameras.main.height;
      this.cameras.main.setBackgroundColor(0x1a0a2e);
      this.add.text(w/2, h*0.20, "ACT I CLEARED",
        { font: "bold 36px serif", color: "#fde047" }).setOrigin(0.5);
      this.add.text(w/2, h*0.30, "The First Relic is yours.",
        { font: "16px serif", color: "#e2e8f0" }).setOrigin(0.5);
      this.add.text(w/2, h*0.42,
        "Five seals remain.\nKaelen's journey continues in Acts II–VI.",
        { font: "14px serif", color: "#94a3b8", align: "center" }).setOrigin(0.5);
      this.add.text(w/2, h*0.65, "▶ Return to Menu",
        { font: "20px monospace", color: "#22c55e" })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.scene.start("P2_Menu"));
      this.input.keyboard.on("keydown-ENTER", () => this.scene.start("P2_Menu"));
      this.input.keyboard.on("keydown-SPACE", () => this.scene.start("P2_Menu"));
      try { this.sound.play("sfx_levelup", { volume: 0.6 }); } catch (_) {}
      try {
        if (this._music) this._music.stop();
        this._music = this.sound.add("music_victory", { loop: false, volume: 0.4 });
        this._music.play();
        this.events.once("shutdown", () => this._music && this._music.stop());
      } catch (_) {}
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P2_GameOver — separate scene so Continue can pick up saved progress
  // ══════════════════════════════════════════════════════════════
  class GameOverP2 extends Phaser.Scene {
    constructor() { super("P2_GameOver"); }
    create() {
      const w = this.cameras.main.width, h = this.cameras.main.height;
      this.cameras.main.setBackgroundColor(0x0a0a0a);
      this.add.text(w/2, h*0.35, "GAME OVER",
        { font: "bold 40px serif", color: "#ef4444" }).setOrigin(0.5);
      const hasSave = (() => { try { return !!localStorage.getItem("shroud_save_v1"); } catch(_) { return false; } })();
      this.add.text(w/2, h*0.55, hasSave ? "▶ Continue" : "▶ New Game",
        { font: "20px monospace", color: "#22c55e" })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.scene.start("P2_Play", { fromSave: hasSave }));
      this.add.text(w/2, h*0.65, "Esc — Menu",
        { font: "14px monospace", color: "#94a3b8" }).setOrigin(0.5);
      this.input.keyboard.on("keydown-ENTER", () => this.scene.start("P2_Play", { fromSave: hasSave }));
      this.input.keyboard.on("keydown-SPACE", () => this.scene.start("P2_Play", { fromSave: hasSave }));
      this.input.keyboard.on("keydown-ESC", () => this.scene.start("P2_Menu"));
      try { this.sound.play("sfx_death", { volume: 0.5 }); } catch (_) {}
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Game init
  // ══════════════════════════════════════════════════════════════
  function start() {
    // `?test=1` query param forces setTimeout-based game loop so the game
    // ticks even in hidden/backgrounded tabs (raf throttles in inactive tabs).
    // Used by the headless preview tool for automated playthrough.
    const testMode = (typeof location !== "undefined" && location.search && location.search.indexOf("test=1") >= 0);
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
      fps: testMode ? { forceSetTimeOut: true, target: 60 } : undefined,
      scene: [BootP2, PreloadP2, MenuP2, PlayP2, PauseP2, WinP2, GameOverP2],
    });
    window.__GAME_P2__ = game;
    window.__TEST_MODE__ = testMode;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
