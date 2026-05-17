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
      this.player.knockback_until = 0;
      this.entityLayer.add(this.player);

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

      // Knockback overrides input
      if (p.knockback_until > time) {
        // Velocity already set by _damagePlayer; just hold it
      } else {
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
        // Disable movement while attacking
        if (this.attackUntil && time < this.attackUntil) { vx *= 0.3; vy *= 0.3; }
        p.body.setVelocity(vx, vy);

        // Walk anim
        if ((vx || vy) && (!this.attackUntil || time > this.attackUntil)) {
          if (!p.anims.isPlaying || p.anims.currentAnim?.key !== "p_walk") p.play("p_walk");
        } else if (!this.attackUntil || time > this.attackUntil) {
          if (p.anims.isPlaying) p.stop();
          p.setTexture("p_idle");
        }
      }

      // Attack input
      if (Phaser.Input.Keyboard.JustDown(this.keyZ)) this._swing(time);
      // Use selected item
      if (Phaser.Input.Keyboard.JustDown(this.keyX)) this._useItem(time);
      // Cycle item slot
      if (Phaser.Input.Keyboard.JustDown(this.keyC)) this._cycleItem();
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

      // Item pickup overlap
      this._tickPickups(time);

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

      // tileLayer holds only tile graphics — safe to nuke.
      this.tileLayer.removeAll(true);

      // entityLayer holds player + NPCs + enemies + items + name labels.
      // DO NOT destroy the player — track and remove only OUR room-scoped entities.
      this._clearRoomEntities();

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
      this.npcsInRoom = [];
      (room.npcs || []).forEach(n => {
        const npc = this.add.rectangle(n.x, n.y, 12, 14, 0xfacc15);
        npc.setStrokeStyle(1, 0x000000);
        npc._npcData = n;
        this.entityLayer.add(npc);
        const label = this.add.text(n.x, n.y - 14, n.name, { font: "6px monospace", color: "#fff" }).setOrigin(0.5);
        this.entityLayer.add(label);
        this.npcsInRoom.push(npc);
        this.npcsInRoom.push(label);
      });
    }

    _clearRoomEntities() {
      // Destroy any tracked room-scoped entities WITHOUT touching player or hitbox.
      const lists = [this.enemies || [], this.itemsOnGround || [], this.npcsInRoom || [], this.bombs || [], this.enemyProjectiles || []];
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
      // Repaint (also clears entityLayer)
      this._buildRoom(id);
      // Re-add player to entity layer
      this.entityLayer.add(this.player);
      // Re-add the hitbox to fxLayer (entityLayer was cleared but fxLayer wasn't — keep hitbox where it is)
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
      // Note: HUD lives in fxLayer (never rebuilt), not tileLayer (rebuilt on room
      // change). This was a bug in iter #3 — HUD was destroyed on every room
      // transition because tileLayer.removeAll(true) ran in _buildRoom.
      this.hudHearts = this.add.text(2, 2, "♥".repeat(this.hearts), { font: "10px monospace", color: "#ff3344" });
      this.hudRupees = this.add.text(2, 13, "₽ 0", { font: "8px monospace", color: "#22c55e" });
      this.hudKeys = this.add.text(36, 13, "🔑 0", { font: "8px monospace", color: "#facc15" });
      this.hudItem = this.add.text(SCREEN_W - 2, 2, "[(no item)]", { font: "8px monospace", color: "#94a3b8" }).setOrigin(1, 0);
      this.fxLayer.add(this.hudHearts);
      this.fxLayer.add(this.hudRupees);
      this.fxLayer.add(this.hudKeys);
      this.fxLayer.add(this.hudItem);
    }

    _refreshHUD() {
      if (this.hudHearts) this.hudHearts.setText("♥".repeat(Math.ceil(this.hearts)));
      const q = this.quest.flags;
      if (this.hudRupees) this.hudRupees.setText("$ " + q.rupees);
      if (this.hudKeys) this.hudKeys.setText("K " + q.small_keys + (q.big_key ? "*" : ""));
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
      }
    }

    _damageEnemy(e, amount, source) {
      source = source || "sword";
      const time = this.time.now;
      // Guardian phase-2 sword immunity — must use bomb or arrow
      if (e._template === "guardian_of_first_light" && e._phase === 2 && source === "sword") {
        e.flash_until = time + 80;   // light flash, no damage
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
    }

    _damagePlayer(amount, sourceX, sourceY) {
      const time = this.time.now;
      const p = this.player;
      if (p.invuln_until > time) return;
      this.hearts = Math.max(0, this.hearts - amount);
      p.invuln_until = time + D.PLAYER.invuln_ms;
      try { this.sound.play("sfx_hurt", { volume: 0.6 }); } catch (_) {}
      this._refreshHUD();
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

    // ══════════════════════════════════════════════════════════════
    // ENEMY SPAWNING + AI
    // ══════════════════════════════════════════════════════════════

    _spawnRoomEntities() {
      this.enemies = [];
      this.itemsOnGround = [];
      const room = this.currentRoom;
      if (!room) return;
      // Enemies
      (room.enemies || []).forEach(spec => {
        const tpl = (spec.template && D.ENEMIES[spec.template]) || (D.BOSSES[spec.template]);
        if (!tpl) { console.warn("[pass2] unknown enemy template:", spec.template); return; }
        // Use rectangle + physics body — sprite swap is a polish-pass task
        const e = this.add.rectangle(spec.x, spec.y, 12, 12, tpl.color || 0xff0000);
        e.setStrokeStyle(1, 0x000000);
        this.physics.add.existing(e);
        e.body.setCollideWorldBounds(false);
        e.body.setSize(10, 10);
        e._template = spec.template;
        e._behavior = tpl.behavior;
        e._role = spec.role || null;
        e.hp = tpl.hp_phase1 || tpl.hp || 5;
        e.dmg = tpl.dmg || 1;
        e.speed = tpl.speed || 40;
        e.color = tpl.color || 0xff0000;
        e.dead = false;
        e.knockback_until = 0;
        e.flash_until = 0;
        e._ai = { dir: 1, change_at: 0, last_shot: 0 };
        e.active = true;
        this.entityLayer.add(e);
        this.enemies.push(e);
      });
      // Items
      (room.items || []).forEach(item => {
        this._spawnPickup(item.kind, item.x, item.y);
      });
    }

    _spawnPickup(kind, x, y) {
      const tpl = D.ITEMS[kind];
      if (!tpl) { console.warn("[pass2] unknown item kind:", kind); return; }
      const it = this.add.rectangle(x, y, 8, 8, tpl.color || 0xfacc15);
      it.setStrokeStyle(1, 0x000000);
      this.physics.add.existing(it);
      it.body.setSize(6, 6);
      it.body.setAllowGravity && it.body.setAllowGravity(false);
      it._kind = kind;
      it._template = tpl;
      this.entityLayer.add(it);
      this.itemsOnGround.push(it);
    }

    _tickEnemies(time, delta) {
      const p = this.player;
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue;
        // Flash
        const baseColor = (e._phase === 2 && e._template === "guardian_of_first_light")
          ? 0xfde047 : e.color;
        e.fillColor = (e.flash_until > time) ? 0xffffff : baseColor;
        // Telegraph indicator (shoot AI charges before firing)
        if (e._telegraph_until > time) {
          e.fillColor = ((Math.floor(time/80) % 2) === 0) ? 0xffffff : baseColor;
        }
        // Skip AI during knockback (except boss — boss is heavier)
        if (e.knockback_until > time && e._role !== "boss") continue;

        switch (e._behavior) {
          case "patrol": this._ai_patrol(e, p, time); break;
          case "chase":  this._ai_chase(e, p, time);  break;
          case "shoot":  this._ai_shoot(e, p, time);  break;
          case "guard":  this._ai_guard(e, p, time);  break;
          case "charge": this._ai_charge(e, p, time); break;
          default:
            // Bosses get their own dispatcher (Guardian template)
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
        if (Phaser.Geom.Intersects.RectangleToRectangle(p.getBounds(), it.getBounds())) {
          this._collectItem(it);
          it.destroy();
          this.itemsOnGround.splice(i, 1);
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
      try { this.sound.play(sfx, { volume: 0.5 }); } catch (_) {}
      this._refreshHUD();
      this._refreshItemSlot();
    }

    _winAct1() {
      this.attackUntil = 999999;
      this.cameras.main.fade(1500, 255, 215, 0);
      this.time.delayedCall(1700, () => this.scene.start("P2_Menu"));
      // TODO (polish): proper Win scene
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
      // Re-render just the tile layer without rebuilding entities
      const room = this.currentRoom;
      if (!room) return;
      this.tileLayer.removeAll(true);
      const g = this.add.graphics();
      this.tileLayer.add(g);
      for (let y = 0; y < ROOM_H; y++) {
        const row = room.tiles[y];
        for (let x = 0; x < ROOM_W; x++) {
          const ch = row && row[x] ? row[x] : '.';
          const color = TILE_COLORS[ch] ?? 0x222222;
          g.fillStyle(color, 1);
          g.fillRect(x * TILE, y * TILE, TILE, TILE);
          if (ch === '#') { g.fillStyle(0x000000, 0.2); g.fillRect(x * TILE, y * TILE + TILE - 2, TILE, 2); }
          if (ch === '*') {
            g.fillStyle(0x14532d, 1);
            g.fillCircle(x * TILE + 5, y * TILE + 7, 2);
            g.fillCircle(x * TILE + 11, y * TILE + 9, 2);
          }
        }
      }
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
