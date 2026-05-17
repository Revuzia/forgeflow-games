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

  // ── helper: build a room (keeps the data table compact) ─────────
  function R(id, zone, tiles, exits, opts) {
    ROOMS[id] = Object.assign({
      id, zone, tiles,
      exits: exits || {},
      npcs: [], enemies: [], items: [],
      music: opts && opts.music,
    }, opts || {});
  }

  // ════════════════════════════════════════════════════════════════
  // OVERWORLD — Canopy Village + Emerald Thicket + Shrine Path
  // 12 rooms total.  Open edges in tile data = passable to neighbor.
  // ════════════════════════════════════════════════════════════════

  // ── Canopy Village (4 rooms) ─────────────────────────────────────

  R("village_square", "canopy_village", [
    "########D#########",
    "#................#",
    "#......::::......#",
    "#......::::......#",
    "D......::::......D",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#................#",
    "#................#",
    "########D#########",
  ], { N: "shrine_path_a", S: "thicket_a", E: "village_gate", W: "herbalist_hut" },
  {
    npcs: [{
      id: "elder_mira", name: "Elder Mira", x: 144, y: 56,
      default_state: "intro",
      dialogue: {
        intro: [
          "Kaelen, the jungle whispers of danger.",
          "The Ancients left relics to seal great evils—",
          "I fear one seal weakens.",
          "Head south through the Thicket to the Ruins of First Light.",
        ],
        after_dungeon: [
          "You returned with the First Relic. The seal holds for now.",
          "But six remain. Rest, then journey on.",
        ],
      },
    }],
  });

  R("herbalist_hut", "canopy_village", [
    "##################",
    "#................#",
    "#..*..........*..#",
    "#................#",
    "#......::::......D",   // east exit back to square
    "#......:HH:......#",   // HH = herbalist's table (cosmetic; tile reads '.')
    "#......:HH:......#",
    "#......::::......#",
    "#..*..........*..#",
    "#................#",
    "##################",
  ].map(r => r.replace(/H/g, '.')), { E: "village_square" },
  {
    npcs: [{
      id: "heda_herbalist", name: "Heda the Herbalist", x: 144, y: 88,
      default_state: "intro",
      dialogue: {
        intro: [
          "Welcome, traveller.",
          "The bioluminescent flowers in the Thicket — bring me three?",
          "I'll trade you a Heart Piece.",
        ],
        in_progress: ["Find the glowing flowers among the bushes!"],
        complete: [
          "Three flowers! Just what I needed.",
          "Take this Heart Piece. May it strengthen you.",
        ],
      },
    }],
  });

  R("village_gate", "canopy_village", [
    "##################",
    "#................#",
    "#................#",
    "#................#",
    "D......::::......#",   // west exit back to square
    "#......:SS:......#",   // shop tiles (cosmetic, '.' walkable)
    "#......:SS:......#",
    "#......::::......#",
    "#................#",
    "#................#",
    "##################",
  ].map(r => r.replace(/S/g, '.')), { W: "village_square" },
  {
    npcs: [{
      id: "dax_trader", name: "Dax the Trader", x: 144, y: 80,
      default_state: "intro",
      dialogue: {
        intro: [
          "Fresh off the vine! What'll it be?",
          "  · Heart Refill — 10 rupees",
          "  · Wooden Shield — 30 rupees",
          "  · Bombs (3) — 20 rupees",
          "(Press X near me to buy; not yet implemented in this build.)",
        ],
      },
    }],
  });

  // ── Shrine Path (3 rooms — side quest path north) ────────────────

  R("shrine_path_a", "shrine_path", [
    "##########D#######",
    "#:::::::::........#".slice(0,18),
    "#:::::::::........#".slice(0,18),
    "#................#",
    "#......*.........#",
    "#................#",
    "#............*...#",
    "#................#",
    "#......*.........#",
    "#................#",
    "########D#########",
  ], { N: "shrine_path_b", S: "village_square" });

  R("shrine_path_b", "shrine_path", [
    "########D#########",
    "#................#",
    "#....*......*....#",
    "#................#",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#................#",
    "#....*......*....#",
    "#................#",
    "########D#########",
  ], { N: "shrine_path_c", S: "shrine_path_a" });

  R("shrine_path_c", "shrine_path", [
    "##################",
    "#................#",
    "#...##......##...#",
    "#..#..#....#..#..#",
    "#..#  #....#  #..#".replace(/ /g, '.'),
    "#..#H #....# H#..#".replace(/[H ]/g, '.'),  // H = heart-piece slot
    "#..#..#....#..#..#",
    "#...##......##...#",
    "#................#",
    "#................#",
    "########D#########",
  ], { S: "shrine_path_b" },
  {
    items: [{ kind: "heart_piece", x: 80, y: 80 }],
  });

  // ── Emerald Thicket (6 rooms) ────────────────────────────────────

  R("thicket_a", "emerald_thicket", [
    "########D#########",
    "#....*......*....#",
    "#................#",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#................#",
    "#....*......*....#",
    "#................#",
    "########D#########",
  ], { N: "village_square", S: "thicket_b" },
  {
    enemies: [{ template: "thornback_lurker", x: 64, y: 80 }],
  });

  R("thicket_b", "emerald_thicket", [
    "########D#########",
    "#................#",
    "#....****....****.".slice(0,18),
    "#................#",
    "D......::::......D",
    "#......::::......#",
    "#......::::......#",
    "#................#",
    "#....****....****.".slice(0,18),
    "#................#",
    "########D#########",
  ], { N: "thicket_a", S: "thicket_c", E: "thicket_vine", W: "thicket_waterfall" },
  {
    enemies: [
      { template: "thornback_lurker", x: 48, y: 80 },
      { template: "veilstalker", x: 224, y: 80 },
    ],
  });

  R("thicket_waterfall", "emerald_thicket", [
    "##################",
    "#~~~~............#",
    "#~~~~~~..........#",
    "#~~~~~~~~........#",
    "#~~~~~~~~~~......D",   // east back to thicket_b
    "#~~~~~~~~~~......#",
    "#~~~~~~~~........#",
    "#~~~~~~..........#",
    "#~~~~............#",
    "#................#",
    "##################",
  ], { E: "thicket_b" },
  {
    npcs: [{
      id: "liora_scholar", name: "Liora",
      x: 200, y: 64,
      default_state: "intro",
      gives_bow_on_first_talk: true,
      dialogue: {
        intro: [
          "Kaelen! Mira sent word you'd come.",
          "These ruins are guarded by Wraithwhispers — vile spirits that strike from above.",
          "Take this. The Stormcrest Bow.",
          "Aim true and the spirits cannot harm you.",
          "(Got the BOW — press C to cycle items, X to fire!)",
        ],
        after_bow: [
          "The Guardian below is wreathed in old magic.",
          "Your blade alone won't fell it. Use bombs — or bow shafts — when its hide flares gold.",
        ],
      },
    }],
    items: [{ kind: "rupee_blue", x: 240, y: 96 }, { kind: "heart_piece", x: 240, y: 128 }],
  });

  R("thicket_vine", "emerald_thicket", [
    "##################",
    "#................#",
    "#................#",
    "#........WWWWW...#",   // weak wall — bombable
    "D........WWWWW...#",   // west back to thicket_b
    "#........WWWWW...#",
    "#................#",
    "#................#",
    "#................#",
    "#................#",
    "##################",
  ], { W: "thicket_b" },
  {
    items: [{ kind: "rupee_green", x: 80, y: 80 }],
    // weak walls hide a passage to a heart-piece chamber (not authored as a
    // separate room — bombing them spawns a hidden chest in this same room).
    weak_wall_reward: { kind: "heart_piece" },
  });

  R("thicket_c", "emerald_thicket", [
    "########D#########",
    "#................#",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#......::::......#",
    "#................#",
    "#......::::......#",
    "########D#########",
  ], { N: "thicket_b", S: "ruins_entrance_overworld" },
  {
    enemies: [
      { template: "wraithwhisper", x: 64, y: 64 },
      { template: "wraithwhisper", x: 224, y: 96 },
    ],
    items: [{ kind: "rupee_blue", x: 32, y: 128 }],
  });

  R("ruins_entrance_overworld", "emerald_thicket", [
    "########D#########",
    "#................#",
    "#......####......#",
    "#.....##LL##.....#",   // LL = ruin entrance arch (cosmetic; '.' walkable)
    "#.....##LL##.....#",
    "#.....##::##.....#",
    "#.....##::##.....#",
    "#.....##::##.....#",
    "#.....######.....#",
    "#................#",
    "##################",
  ].map(r => r.replace(/L/g, '.')), { N: "thicket_c", S: "ruins_foyer" },
  {
    // Stepping out the south edge enters the dungeon (treated like any other room).
    is_dungeon_portal: true,
  });

  // ════════════════════════════════════════════════════════════════
  // DUNGEON — Ruins of First Light (10 rooms)
  // ════════════════════════════════════════════════════════════════

  R("ruins_foyer", "ruins_of_first_light", [
    "########L#########",   // L = locked door (north — needs small key)
    "#:::::::::::::::::".slice(0,18),
    "#::::....::::....#",
    "#::::....::::....#",
    "D::::....::::....D",   // E/W open
    "#::::....::::....#",
    "#::::....::::....#",
    "#:::::::::::::::::".slice(0,18),
    "#................#",
    "#................#",
    "########D#########",
  ], { N: "ruins_north_a", E: "ruins_east_a", W: "ruins_west_a", S: "ruins_entrance_overworld" },
  {
    enemies: [{ template: "veilstalker", x: 144, y: 144 }],
  });

  R("ruins_east_a", "ruins_of_first_light", [
    "##################",
    "#:::::::::::::::::".slice(0,18),
    "#:::::::::::::::::".slice(0,18),
    "#::....::....::::#",
    "D::....::....::::#",   // west back to foyer
    "#::....::....::::#",
    "#:::::::::::::::::".slice(0,18),
    "#:::::::::::::::::".slice(0,18),
    "#.......D........#",   // south to east_b
    "#................#",
    "##################",
  ], { W: "ruins_foyer", S: "ruins_east_b" },
  {
    enemies: [
      { template: "wraithwhisper", x: 80, y: 80 },
      { template: "veilstalker", x: 192, y: 80 },
    ],
    items: [{ kind: "small_key", x: 144, y: 80 }],
  });

  R("ruins_east_b", "ruins_of_first_light", [
    "########D#########",
    "#:::::::::::::::::".slice(0,18),
    "#::....BB....::::#",   // BB = push block (cosmetic, will be entity)
    "#::....BB....::::#",
    "#::::::::::::::::#",
    "#::PP::::::PP::::#",   // P = pit (hazard)
    "#::PP::::::PP::::#",
    "#::::::::::::::::#",
    "#:::::::::::::::::".slice(0,18),
    "#................#",
    "##################",
  ].map(r => r.replace(/B/g, '.')), { N: "ruins_east_a" },
  {
    items: [{ kind: "rupee_red", x: 144, y: 144 }],
  });

  R("ruins_west_a", "ruins_of_first_light", [
    "##################",
    "#:::::::::::::::::".slice(0,18),
    "#::....::....::::#",
    "#::....::....::::#",
    "#::....::....::::D",   // east back to foyer
    "#::....::....::::#",
    "#:::::::::::::::::".slice(0,18),
    "#.......D........#",
    "#................#",
    "#................#",
    "##################",
  ], { E: "ruins_foyer", S: "ruins_west_b" },
  {
    enemies: [{ template: "thornback_lurker", x: 80, y: 80 }],
  });

  R("ruins_west_b", "ruins_of_first_light", [
    "########D#########",
    "#:::::::::::::::::".slice(0,18),
    "#:::::::::::::::::".slice(0,18),
    "#::::........::::#",
    "#::::........::::#",
    "#::::....G...::::#",   // G = Geomancer Statue mini-boss spawn
    "#::::........::::#",
    "#::::........::::#",
    "#:::::::::::::::::".slice(0,18),
    "#................#",
    "##################",
  ].map(r => r.replace(/G/g, '.')), { N: "ruins_west_a" },
  {
    enemies: [{ template: "geomancer_statue", x: 144, y: 80, role: "miniboss" }],
    miniboss_reward: { kind: "bombs" },   // mini-boss drops bombs (dungeon item)
  });

  R("ruins_north_a", "ruins_of_first_light", [
    "########D#########",
    "#:::::::::::::::::".slice(0,18),
    "#::....::....::::#",
    "#::....::....::::#",
    "#::....::....::::#",
    "#::....::....::::#",
    "#::....::....::::#",
    "#::....::....::::#",
    "#:::::::::::::::::".slice(0,18),
    "#................#",
    "########L#########",   // L = locked back (south = foyer, was unlocked by key)
  ], { N: "ruins_north_b", S: "ruins_foyer" },
  {
    // 4-statue light puzzle (puzzle logic in later iteration)
    puzzle: { kind: "light_4statue", solved_reward: "open_north" },
    enemies: [
      { template: "wraithwhisper", x: 80, y: 80 },
      { template: "wraithwhisper", x: 192, y: 144 },
    ],
  });

  R("ruins_north_b", "ruins_of_first_light", [
    "########D#########",
    "#:::::::::::::::::".slice(0,18),
    "#::....WW....::::#",   // weak wall hides heart piece
    "#::....WW....::::#",
    "#::....::....::::#",
    "#::....::....::::#",
    "#::....::....::::#",
    "#:::::::::::::::::".slice(0,18),
    "#................#",
    "#................#",
    "########D#########",
  ], { N: "ruins_big_key_room", S: "ruins_north_a" },
  {
    weak_wall_reward: { kind: "heart_piece" },
  });

  R("ruins_big_key_room", "ruins_of_first_light", [
    "########D#########",
    "#:::::::::::::::::".slice(0,18),
    "#::....::....::::#",
    "#::....::....::::#",
    "#::::....K...::::#",   // K = big key spawn (cosmetic '.')
    "#::....::....::::#",
    "#::....::....::::#",
    "#::....::....::::#",
    "#:::::::::::::::::".slice(0,18),
    "#................#",
    "########D#########",
  ].map(r => r.replace(/K/g, '.')), { N: "ruins_boss_door", S: "ruins_north_b" },
  {
    enemies: [{ template: "veilstalker", x: 64, y: 80 }, { template: "veilstalker", x: 224, y: 96 }],
    items: [{ kind: "big_key", x: 144, y: 80 }],
  });

  R("ruins_boss_door", "ruins_of_first_light", [
    "########B#########",   // B = big door (needs big key)
    "#:::::::::::::::::".slice(0,18),
    "#::::::::::::::::#",
    "#::::........::::#",
    "#::::........::::#",
    "#::::........::::#",
    "#::::........::::#",
    "#::::........::::#",
    "#::::::::::::::::#",
    "#:::::::::::::::::".slice(0,18),
    "########D#########",
  ], { N: "ruins_boss_room", S: "ruins_big_key_room" });

  R("ruins_boss_room", "boss_arena", [
    "##################",
    "#::::::::::::::::#",
    "#::::::::::::::::#",
    "#::::....::::::::#",
    "#::::....X.::::::#",   // X = Guardian spawn (cosmetic '.')
    "#::::........::::#",
    "#::::........::::#",
    "#::::........::::#",
    "#::::::::::::::::#",
    "#::::::::::::::::#",
    "########D#########",
  ].map(r => r.replace(/X/g, '.')), { S: "ruins_boss_door" },
  {
    enemies: [{ template: "guardian_of_first_light", x: 160, y: 80, role: "boss" }],
    boss_reward: { kind: "heart_container" },
    music: "music_boss",
  });

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
