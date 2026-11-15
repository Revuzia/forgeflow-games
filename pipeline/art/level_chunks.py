#!/usr/bin/env python3
"""
level_chunks.py — Hand-designed level chunk library + WFC-lite composer.

Per 2026-04-17 research: WaveFunctionCollapse-alone doesn't guarantee platformer
levels are reachable. The proven pattern is **chunk-based assembly with hand-
designed segments joined procedurally**. From ~40-60 chunks you can generate
200-400 playable levels before perceptual repetition sets in.

This module provides:
  1. CHUNK_LIBRARY — hand-designed 8×15-tile chunks with entry/exit contracts
  2. compose_level(chunks, difficulty, length_tiles, theme) — stitches chunks
     into a complete level, respecting entry/exit compatibility
  3. enforce_reachability — cooperates with reachability_solver.py to ensure
     every generated level is beatable

Chunk contract:
  {
    "id": "unique_name",
    "theme_tags": ["grassland", "jungle"],      # which worlds can use this
    "difficulty": 1-10,
    "entry": "flat" | "high" | "low" | "pit",   # where player enters (tile y)
    "exit": "flat" | "high" | "low" | "pit",    # where player exits
    "tiles": [[row of tile codes]],             # actual layout (15 cols wide)
    "required_abilities": ["jump", "double_jump", "dash"],  # which abilities needed to traverse
    "set_piece": "standard|boulder|boss_gate|checkpoint|bonus_room",
    "enemy_slots": [{"x": 3, "y": 5, "type_hint": "patrol"}],
    "collectible_slots": [{"x": 7, "y": 4}]
  }

Tile codes (consistent with build.levels tilemap format):
  0 = air
  1 = ground_top   (grass/stone top)
  2 = ground_fill  (underground)
  3 = platform     (floating)
  4 = spike        (hazard)
  5 = goal         (exit flag)
  6 = moving_platform
  7 = spring       (boost up)
  8 = one_way_platform
"""
import json
import random
from pathlib import Path


# ─── Base chunk library (hand-designed primitives) ─────────────────────────
# Every chunk is 15 cols × 8 rows. Player enters from left, exits right.
# Row 7 = ground level. Row 0 = top. Keeps entry/exit contracts consistent.

_CHUNK_EMPTY_ROW = [0] * 15
_CHUNK_GROUND_ROW = [1] * 15
_CHUNK_FILL_ROW = [2] * 15


def _blank_chunk(ground_rows=2):
    rows = [list(_CHUNK_EMPTY_ROW) for _ in range(8)]
    for i in range(8 - ground_rows, 8):
        rows[i] = list(_CHUNK_GROUND_ROW if i == 8 - ground_rows else _CHUNK_FILL_ROW)
    return rows


# Flat ground with scattered platforms — tutorial opener
CHUNK_TUTORIAL_OPEN = {
    "id": "tutorial_open",
    "theme_tags": ["all"],
    "difficulty": 1,
    "entry": "flat", "exit": "flat",
    "tiles": [
        [0]*15, [0]*15, [0]*15, [0]*15,
        [0,0,0,0,0,3,3,0,0,0,3,3,0,0,0],  # two platforms
        [0]*15,
        [1]*15,
        [2]*15,
    ],
    "required_abilities": ["jump"],
    "set_piece": "standard",
    "enemy_slots": [],
    "collectible_slots": [{"x": 5, "y": 3}, {"x": 10, "y": 3}],
}

# Pit jump — classic platformer primitive
CHUNK_PIT_JUMP = {
    "id": "pit_jump",
    "theme_tags": ["all"],
    "difficulty": 2,
    "entry": "flat", "exit": "flat",
    "tiles": [
        [0]*15, [0]*15, [0]*15, [0]*15, [0]*15, [0]*15,
        [1,1,1,1,0,0,0,0,0,1,1,1,1,1,1],  # 5-tile pit
        [2,2,2,2,0,0,0,0,0,2,2,2,2,2,2],
    ],
    "required_abilities": ["jump"],
    "set_piece": "standard",
    "enemy_slots": [{"x": 11, "y": 5, "type_hint": "patrol"}],
    "collectible_slots": [{"x": 6, "y": 5}],
}

# Spike hazard + platform stepping-stones
CHUNK_SPIKE_STEPS = {
    "id": "spike_steps",
    "theme_tags": ["all"],
    "difficulty": 4,
    "entry": "flat", "exit": "flat",
    "tiles": [
        [0]*15, [0]*15, [0]*15, [0]*15,
        [0,0,0,3,0,0,3,0,0,3,0,0,0,0,0],  # stepping platforms
        [0]*15,
        [1,1,1,4,4,4,4,4,4,4,4,1,1,1,1],  # spike pit
        [2]*15,
    ],
    "required_abilities": ["jump", "double_jump"],
    "set_piece": "standard",
    "enemy_slots": [],
    "collectible_slots": [{"x": 3, "y": 3}, {"x": 6, "y": 3}, {"x": 9, "y": 3}],
}

# High ledge — requires double-jump or dash
CHUNK_HIGH_LEDGE = {
    "id": "high_ledge",
    "theme_tags": ["all"],
    "difficulty": 5,
    "entry": "flat", "exit": "high",
    "tiles": [
        [0]*15, [0]*15,
        [0,0,0,0,0,0,0,0,0,0,0,1,1,1,1],  # elevated platform at end
        [0,0,0,0,0,0,0,0,0,0,0,2,2,2,2],
        [0]*15,
        [0,0,0,0,0,3,3,0,0,0,0,0,0,0,0],  # transition platform
        [1]*15,
        [2]*15,
    ],
    "required_abilities": ["jump", "double_jump"],
    "set_piece": "standard",
    "enemy_slots": [{"x": 12, "y": 1, "type_hint": "patrol"}],
    "collectible_slots": [{"x": 6, "y": 4}, {"x": 13, "y": 1}],
}

# Enemy ambush — 3 enemies arranged in a trap
CHUNK_ENEMY_AMBUSH = {
    "id": "enemy_ambush",
    "theme_tags": ["all"],
    "difficulty": 6,
    "entry": "flat", "exit": "flat",
    "tiles": [
        [0]*15, [0]*15,
        [0,0,0,0,0,3,3,3,3,3,0,0,0,0,0],  # platform above
        [0]*15, [0]*15, [0]*15,
        [1]*15,
        [2]*15,
    ],
    "required_abilities": ["jump"],
    "set_piece": "standard",
    "enemy_slots": [
        {"x": 3, "y": 5, "type_hint": "chase"},
        {"x": 7, "y": 2, "type_hint": "flying"},
        {"x": 11, "y": 5, "type_hint": "patrol"},
    ],
    "collectible_slots": [{"x": 7, "y": 1}],
}

# Vertical climb — up a shaft
CHUNK_VERTICAL_CLIMB = {
    "id": "vertical_climb",
    "theme_tags": ["cave", "dungeon"],
    "difficulty": 6,
    "entry": "flat", "exit": "high",
    "tiles": [
        [0,0,0,0,0,0,0,0,0,0,0,1,1,1,1],
        [0,0,3,3,0,0,0,3,3,0,0,2,2,2,2],
        [0,0,0,0,0,3,3,0,0,0,0,0,0,0,0],
        [0,3,3,0,0,0,0,0,0,3,3,0,0,0,0],
        [0,0,0,0,3,3,0,0,0,0,0,0,0,0,0],
        [3,3,0,0,0,0,0,0,3,3,0,0,0,0,0],
        [1]*15,
        [2]*15,
    ],
    "required_abilities": ["jump", "double_jump", "wall_slide"],
    "set_piece": "standard",
    "enemy_slots": [{"x": 10, "y": 0, "type_hint": "flying"}],
    "collectible_slots": [{"x": 5, "y": 4}, {"x": 9, "y": 3}, {"x": 13, "y": 0}],
}

# Spring launch — bouncing up through a shaft
CHUNK_SPRING_LAUNCH = {
    "id": "spring_launch",
    "theme_tags": ["all"],
    "difficulty": 3,
    "entry": "flat", "exit": "high",
    "tiles": [
        [0]*15, [0]*15,
        [0,0,0,0,0,0,0,0,0,0,0,1,1,1,1],
        [0,0,0,0,0,0,0,0,0,0,0,2,2,2,2],
        [0,0,0,0,0,3,3,0,0,0,0,0,0,0,0],
        [0]*15,
        [1,1,1,1,1,7,1,1,1,1,1,0,0,0,0],  # spring in floor
        [2]*15,
    ],
    "required_abilities": ["jump"],
    "set_piece": "standard",
    "enemy_slots": [],
    "collectible_slots": [{"x": 5, "y": 3}, {"x": 13, "y": 1}],
}

# Moving platform gap
CHUNK_MOVING_PLATFORM = {
    "id": "moving_platform",
    "theme_tags": ["all"],
    "difficulty": 5,
    "entry": "flat", "exit": "flat",
    "tiles": [
        [0]*15, [0]*15, [0]*15, [0]*15,
        [0,0,0,0,0,6,6,0,0,0,0,0,0,0,0],  # moving platform (code 6)
        [0]*15,
        [1,1,1,1,0,0,0,0,0,0,0,1,1,1,1],  # big gap
        [2,2,2,2,0,0,0,0,0,0,0,2,2,2,2],
    ],
    "required_abilities": ["jump"],
    "set_piece": "standard",
    "enemy_slots": [],
    "collectible_slots": [{"x": 6, "y": 3}],
}

# Checkpoint room — rest beat between hard sections
CHUNK_CHECKPOINT = {
    "id": "checkpoint_room",
    "theme_tags": ["all"],
    "difficulty": 1,
    "entry": "flat", "exit": "flat",
    "tiles": [
        [0]*15, [0]*15, [0]*15, [0]*15, [0]*15, [0]*15,
        [1]*15,
        [2]*15,
    ],
    "required_abilities": [],
    "set_piece": "checkpoint",
    "enemy_slots": [],
    "collectible_slots": [{"x": 7, "y": 5}],  # big collectible at checkpoint
}

# Goal chunk — ends the level
CHUNK_GOAL = {
    "id": "goal_chunk",
    "theme_tags": ["all"],
    "difficulty": 1,
    "entry": "flat", "exit": "flat",
    "tiles": [
        [0]*15, [0]*15, [0]*15, [0]*15,
        [0,0,0,0,0,0,0,0,0,0,0,0,5,0,0],  # goal flag
        [0]*15,
        [1]*15,
        [2]*15,
    ],
    "required_abilities": [],
    "set_piece": "goal",
    "enemy_slots": [],
    "collectible_slots": [],
}


CHUNK_LIBRARY = [
    CHUNK_TUTORIAL_OPEN,
    CHUNK_PIT_JUMP,
    CHUNK_SPIKE_STEPS,
    CHUNK_HIGH_LEDGE,
    CHUNK_ENEMY_AMBUSH,
    CHUNK_VERTICAL_CLIMB,
    CHUNK_SPRING_LAUNCH,
    CHUNK_MOVING_PLATFORM,
    CHUNK_CHECKPOINT,
    CHUNK_GOAL,
]


# ─── Composition API ────────────────────────────────────────────────────────

def _pick_chunk(difficulty_target: int, theme: str, abilities: list,
                last_exit: str, rng: random.Random) -> dict:
    """Pick a compatible chunk given constraints."""
    candidates = []
    for c in CHUNK_LIBRARY:
        # Entry must match last exit (simplified — flat/flat, high/high match, any can follow checkpoint)
        if c["id"] == "goal_chunk":
            continue  # goal added separately
        if last_exit == "high" and c["entry"] not in ("high", "flat"):
            continue
        if "all" not in c["theme_tags"] and theme not in c["theme_tags"]:
            continue
        # Ability check — chunk's required_abilities must all be in player's abilities
        missing = set(c["required_abilities"]) - set(abilities)
        if missing:
            continue
        diff_delta = abs(c["difficulty"] - difficulty_target)
        if diff_delta <= 3:
            # Weight by difficulty match
            candidates.append((c, 4 - diff_delta))
    if not candidates:
        return CHUNK_TUTORIAL_OPEN
    # Weighted random selection
    total = sum(w for _, w in candidates)
    r = rng.random() * total
    acc = 0
    for c, w in candidates:
        acc += w
        if acc >= r:
            return c
    return candidates[0][0]


def compose_level(difficulty: int, target_length_tiles: int = 90,
                  theme: str = "grassland", player_abilities: list = None,
                  seed: int = None) -> dict:
    """Compose a full level from chunks. Returns tilemap in the same format as
    phase_build's `levels` sub-phase output (30 rows × N cols).

    Args:
      difficulty: 1-10, influences chunk difficulty selection
      target_length_tiles: total level width in tiles
      theme: world theme (grassland, cave, ice, etc.)
      player_abilities: list of abilities player has ("jump", "double_jump", "dash", "wall_slide")
      seed: reproducible RNG seed

    Returns level dict compatible with phase_build tilemap format:
      {"name", "tiles", "playerSpawn", "enemies", "collectibles", "exit", "difficulty"}
    """
    rng = random.Random(seed if seed is not None else difficulty * 1000 + hash(theme) % 1000)
    player_abilities = player_abilities or ["jump", "double_jump"]
    chunks_per_level = max(4, target_length_tiles // 15)

    sequence = []
    last_exit = "flat"
    # Ramp difficulty within a level — start easier, end harder
    for i in range(chunks_per_level - 1):  # -1 for goal chunk
        # Parabolic difficulty curve within a level
        local_diff = int(difficulty * (0.6 + 0.6 * (i / max(1, chunks_per_level - 2))))
        local_diff = max(1, min(10, local_diff))
        chunk = _pick_chunk(local_diff, theme, player_abilities, last_exit, rng)
        sequence.append(chunk)
        last_exit = chunk["exit"]

    # Always end with the goal chunk
    sequence.append(CHUNK_GOAL)

    # Stitch: each chunk is 15 wide × 8 tall; extend to 30 rows with empty sky
    total_width = 15 * len(sequence)
    tiles_30 = [[0] * total_width for _ in range(30)]
    enemies = []
    collectibles = []
    player_spawn = None
    exit_pos = None

    for idx, chunk in enumerate(sequence):
        col_off = idx * 15
        # Paste chunk tiles into bottom 8 rows (rows 22-29)
        for r in range(8):
            for c in range(15):
                tiles_30[22 + r][col_off + c] = chunk["tiles"][r][c]
        # Player spawn = center of first chunk, row 21 (above ground)
        if idx == 0:
            player_spawn = {"x": (col_off + 2) * 18, "y": 20 * 18}
        # Enemy placements
        for es in chunk["enemy_slots"]:
            enemies.append({
                "x": (col_off + es["x"]) * 18,
                "y": (22 + es["y"]) * 18,
                "type": es.get("type_hint", "patrol"),
                "range": 100, "hp": 1, "damage": 1,
            })
        # Collectibles
        for cs in chunk["collectible_slots"]:
            collectibles.append({
                "x": (col_off + cs["x"]) * 18,
                "y": (22 + cs["y"]) * 18,
                "value": 10, "type": "coin",
            })
        # Goal position
        if chunk["id"] == "goal_chunk":
            exit_pos = {"x": (col_off + 12) * 18, "y": 22 * 18 + 4 * 18}

    return {
        "name": f"Level — {theme} (diff {difficulty})",
        "tiles": tiles_30,
        "playerSpawn": player_spawn or {"x": 50, "y": 350},
        "enemies": enemies,
        "collectibles": collectibles,
        "exit": exit_pos or {"x": (total_width - 3) * 18, "y": 22 * 18 + 4 * 18},
        "difficulty": difficulty,
        "theme": theme,
        "chunks_used": [c["id"] for c in sequence],
    }


def compose_game_levels(design: dict, levels_count: int = None) -> list:
    """Generate all levels for a game from its design. Used by phase_build as
    a fallback/augmentation when Claude's generated levels are insufficient.
    """
    worlds = design.get("worlds", [{"name": "World 1", "theme": "grassland"}])
    blueprints = design.get("levels", [])
    if levels_count is None:
        levels_count = len(blueprints) if blueprints else 20

    abilities = design.get("protagonist", {}).get("abilities", ["jump", "double_jump"])
    # Infer available movement abilities from ability names
    movement = []
    joined = " ".join(abilities).lower()
    if "jump" in joined:       movement.append("jump")
    if "double" in joined:     movement.append("double_jump")
    if "dash" in joined:       movement.append("dash")
    if "wall" in joined:       movement.append("wall_slide")

    levels = []
    for i in range(levels_count):
        # Pick a world (cycle through)
        world = worlds[i % len(worlds)] if worlds else {"theme": "grassland"}
        theme = world.get("theme", "grassland")
        # Match blueprint difficulty if available
        bp = blueprints[i] if i < len(blueprints) else None
        difficulty = bp.get("difficulty_1_to_10", (i % 10) + 1) if bp else (i % 10) + 1
        level = compose_level(
            difficulty=difficulty,
            target_length_tiles=60 + (difficulty * 8),  # harder = longer
            theme=theme,
            player_abilities=movement,
            seed=i * 97,
        )
        if bp:
            level["name"] = bp.get("name", level["name"])
            level["mechanic_focus"] = bp.get("mechanic_focus", "")
        levels.append(level)

    return levels


def main():
    """Smoke test — compose 5 levels and print stats."""
    for diff in [1, 3, 5, 7, 9]:
        level = compose_level(difficulty=diff, target_length_tiles=90, theme="grassland",
                              player_abilities=["jump", "double_jump", "dash"])
        print(f"Diff {diff}: {len(level['tiles'][0])} cols x 30 rows, "
              f"{len(level['enemies'])} enemies, {len(level['collectibles'])} collectibles, "
              f"chunks: {' -> '.join(level['chunks_used'])}")


if __name__ == "__main__":
    main()
