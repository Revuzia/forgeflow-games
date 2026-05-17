/**
 * Shroud of the Ancients — Act 1 Data Registry
 *
 * Pass 2 hand-authored content. Rooms, NPCs, enemies, items, dungeon layout.
 * Each room is 18×11 tiles @ 16px = 288×176 px (Zelda screen geometry).
 *
 * Tile codes:
 *   '.'  grass / floor (walkable)
 *   '#'  solid wall / tree / obstacle
 *   '~'  water (walkable: false)
 *   ':'  path / stone floor (walkable)
 *   'W'  weak wall (bombable)
 *   'D'  door (transitions to neighbor room — direction inferred from edge)
 *   'L'  locked door (needs small key)
 *   'B'  big door (needs big key)
 *   'P'  pit
 *   's'  spike
 *   '*'  decorative bush (burnable)
 *   '$'  pickup spot (rupee/heart drop spawn)
 *
 * Rooms are connected via `exits` keyed by direction (N/S/E/W).
 *
 * Edit this file freely — pass2.js consumes it via window.SHROUD_ACT1_DATA.
 */
(function (global) {
  "use strict";

  // ── Player config ────────────────────────────────────────────────
  const PLAYER = {
    spawn_room: "village_square",
    spawn_x: 144,     // tile col 9 * 16
    spawn_y: 80,      // tile row 5 * 16
    speed: 100,
    max_hearts: 3,
    start_hearts: 3,
    invuln_ms: 800,
    knockback_px: 12,
  };

  // ── Rooms (will be filled in over iterations) ────────────────────
  // Each room: { id, zone, music, tiles: [11 strings of 18 chars], exits, npcs, enemies, items }
  const ROOMS = {};

  // Iteration #1 — one starter room so the scaffold has something visible.
  // Subsequent iterations populate the remaining 21 rooms.
  ROOMS["village_square"] = {
    id: "village_square",
    zone: "canopy_village",
    music: "music_menu",
    tiles: [
      "##################",  // 0  — top wall
      "#................#",  // 1
      "#................#",  // 2
      "#......::::......#",  // 3
      "#......::::......#",  // 4
      "#......::::......#",  // 5  — player spawn row
      "#......::::......#",  // 6
      "#................#",  // 7
      "#................#",  // 8
      "#........D.......#",  // 9  — south door
      "##################",  // 10 — bottom wall
    ],
    exits: {
      // Filled in as overworld grows. South-door goes to thicket_a.
      S: "thicket_a",
    },
    npcs: [
      // { id, name, x, y, dialogue: { state_key: [lines] }, default_state }
      // Elder Mira placeholder — full dialogue tree in npcs_dialogue phase.
      {
        id: "elder_mira",
        name: "Elder Mira",
        x: 96, y: 64,
        default_state: "intro",
        dialogue: {
          intro: [
            "Kaelen, the jungle whispers of danger.",
            "The Ancients left relics to seal great evils—",
            "I fear one seal weakens.",
            "Head south through the Thicket to the Ruins of First Light.",
          ],
        },
      },
    ],
    enemies: [],
    items: [],
  };

  // ── Enemy templates (instantiated by spawn_id from room.enemies) ──
  const ENEMIES = {
    thornback_lurker: { hp: 10, dmg: 1.0, behavior: "patrol", speed: 40, color: 0x2d5016 },
    veilstalker:      { hp: 8,  dmg: 1.0, behavior: "chase",  speed: 60, color: 0x1a1a2e },
    wraithwhisper:    { hp: 6,  dmg: 1.0, behavior: "shoot",  speed: 30, color: 0x9333ea, projectile_cd_ms: 2000 },
    geomancer_statue: { hp: 20, dmg: 2.0, behavior: "guard",  speed: 0,  color: 0x7c7c7c, slam_cd_ms: 3000 },
    crystalspine_boar:{ hp: 15, dmg: 2.0, behavior: "charge", speed: 80, color: 0x6b4423 },
  };

  // ── Bosses ───────────────────────────────────────────────────────
  const BOSSES = {
    guardian_of_first_light: {
      name: "Guardian of First Light",
      hp_phase1: 30,
      hp_phase2: 20,
      dmg: 2.0,
      phases: 2,
      color: 0xfacc15,
    },
  };

  // ── Items / pickups ───────────────────────────────────────────────
  const ITEMS = {
    heart:           { kind: "heart_refill", value: 0.5, color: 0xff3344 },
    rupee_green:     { kind: "rupee", value: 1,   color: 0x22c55e },
    rupee_blue:      { kind: "rupee", value: 5,   color: 0x3b82f6 },
    rupee_red:       { kind: "rupee", value: 20,  color: 0xef4444 },
    small_key:       { kind: "key",   value: 1,   color: 0xfbbf24 },
    big_key:         { kind: "big_key", value: 1, color: 0xa855f7 },
    heart_container: { kind: "heart_container", value: 1, color: 0xff3344 },
    bow:             { kind: "weapon", id: "bow", color: 0x8b4513 },
    bombs:           { kind: "weapon", id: "bombs", color: 0x1f2937 },
    boomerang:       { kind: "weapon", id: "boomerang", color: 0xeab308 },
  };

  // ── Music + SFX hooks (key → asset URL) ──────────────────────────
  const AUDIO = {
    music: {
      menu:    "assets/music/menu_theme.mp3",
      village: "assets/music/menu_theme.mp3",   // calm
      thicket: "assets/music/world_01.mp3",     // adventurous
      ruins:   "assets/audio/music_dungeon.ogg",
      boss:    "assets/music/boss_theme.mp3",
      victory: "assets/music/victory.mp3",
    },
    sfx: {
      attack:        "assets/audio/sfx_attack.ogg",
      attack_heavy:  "assets/audio/sfx_attack_heavy.ogg",
      hit:           "assets/audio/sfx_hit.ogg",
      hurt:          "assets/audio/sfx_hurt.ogg",
      coin:          "assets/audio/sfx_coin.ogg",
      heal:          "assets/audio/sfx_heal.ogg",
      pickup:        "assets/audio/sfx_pickup.ogg",
      door:          "assets/audio/sfx_door.ogg",
      enemy_die:     "assets/audio/sfx_enemy_die.ogg",
      shoot:         "assets/audio/sfx_shoot.ogg",
      menu_confirm:  "assets/audio/sfx_menu_confirm.ogg",
      menu_select:   "assets/audio/sfx_menu_select.ogg",
      levelup:       "assets/audio/sfx_levelup.ogg",
      death:         "assets/audio/sfx_death.ogg",
    },
  };

  // ── Quest state machine (mutated by NPCs + events) ───────────────
  // Tracks the player's progress through Act 1 main + side quests.
  const INITIAL_QUEST_STATE = {
    main_quest: "talk_to_mira",   // states: talk_to_mira → enter_thicket → enter_ruins → get_key → defeat_miniboss → get_dungeon_item → solve_puzzles → defeat_guardian → act1_complete
    side_quest_flowers: "not_started", // not_started → 1_collected → 2_collected → 3_collected → returned → done
    flags: {
      has_sword: true,    // start with basic Astral Blade
      has_bow: false,
      has_bombs: false,
      has_boomerang: false,
      small_keys: 0,
      big_key: false,
      heart_pieces: 0,
      rupees: 0,
    },
  };

  // ── Export ────────────────────────────────────────────────────────
  global.SHROUD_ACT1_DATA = {
    PLAYER, ROOMS, ENEMIES, BOSSES, ITEMS, AUDIO,
    INITIAL_QUEST_STATE,
    TILE: 16,
    ROOM_W: 18,
    ROOM_H: 11,
    SCREEN_W: 18 * 16,   // 288
    SCREEN_H: 11 * 16,   // 176
    SCALE: 3,            // upscale to 864×528 for visibility (Phaser scales viewport via FIT)
  };
})(window);
