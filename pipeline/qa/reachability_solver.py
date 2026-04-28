#!/usr/bin/env python3
"""
reachability_solver.py — Graph-based reachability check for platformer levels.

Per 2026-04-17 research (XDA/Northeastern findings), 90%+ of broken auto-gen'd
levels are caught by a graph-based reachability solver in under 1 second — far
faster than Playwright or DQN bots. Only after a level passes reachability do
we bother running browser-based playtests.

Algorithm:
  1. Parse the level's tilemap (Tiled JSON or our level.json format)
  2. Identify the player's physics capabilities (jump_height, dash_distance,
     double_jump, wall_slide) from design.json
  3. Build a graph where nodes = stable standing positions (on top of solid tiles)
     and edges = reachable transitions between them
  4. BFS from start → end; if end is reachable, the level is completable
  5. Also detect soft-locks: regions where the player can get stuck with no exit

Usage (as module):
    from reachability_solver import check_level
    ok, issues = check_level(level_json, player_physics)

CLI:
    python scripts/reachability_solver.py --level path/to/level.json --physics path/to/design.json
"""
import argparse
import json
import math
import sys
from collections import defaultdict, deque
from pathlib import Path


# ── Tile semantics ───────────────────────────────────────────────────────────
# Default tile mapping — platformer tiles. Games can override via design.json
SOLID_TILES     = {"solid", "platform", "ground", "wall", "spike_immune"}
HAZARD_TILES    = {"spike", "lava", "pit", "saw"}
ONE_WAY_TILES   = {"platform_oneway", "cloud"}
GOAL_TILES      = {"goal", "flag", "exit", "door"}
START_TILES     = {"start", "spawn"}


def _tile_is_solid(tile_type: str) -> bool:
    return tile_type in SOLID_TILES or tile_type in ONE_WAY_TILES


def _tile_is_hazard(tile_type: str) -> bool:
    return tile_type in HAZARD_TILES


# ── Jump reachability model ─────────────────────────────────────────────────
#
# Computes: given a launch position + player physics, which landing positions
# are reachable via a single jump arc? Accounts for double-jump and dash.
#
# Simplified model uses integer tile coordinates. Jump arc is parabolic.
# We compute max horizontal reach at jump apex and decreasing reach as we go down.

def _jump_reach(jump_height_tiles: int, horizontal_speed_tiles: float,
                double_jump: bool = False, dash_tiles: int = 0) -> list:
    """Return list of (dx, dy) tile offsets reachable from any standing position.

    dx positive = right, dy positive = down. Ground is at dy=0 relative to start.
    """
    reachable = []
    # Single jump
    for dy in range(-jump_height_tiles, jump_height_tiles + 1):
        # At vertical displacement dy, remaining horizontal range
        # Parabolic: max_h_at(dy) = horizontal_speed * 2 * sqrt((jump_height - |dy|) / gravity_units)
        # Simplified:
        h_factor = max(0, jump_height_tiles - abs(dy)) / jump_height_tiles
        max_h = int(horizontal_speed_tiles * (1 + h_factor))
        for dx in range(-max_h, max_h + 1):
            reachable.append((dx, dy))

    # Double jump — adds 1 more jump_height of vertical + reach
    if double_jump:
        for dy in range(-jump_height_tiles * 2, jump_height_tiles + 1):
            h_factor = max(0, (jump_height_tiles * 2) - abs(dy)) / (jump_height_tiles * 2)
            max_h = int(horizontal_speed_tiles * 1.5 * (1 + h_factor))
            for dx in range(-max_h, max_h + 1):
                reachable.append((dx, dy))

    # Dash — horizontal-only, short duration
    if dash_tiles > 0:
        for dx in range(-dash_tiles, dash_tiles + 1):
            if dx != 0:
                reachable.append((dx, 0))

    return list(set(reachable))  # dedup


# ── Level graph construction ────────────────────────────────────────────────
def _parse_level(level_data: dict) -> tuple:
    """Parse level JSON into a 2D grid of tile types.

    Accepts multiple formats:
      1. Tiled JSON: layers[].data[] with tile ID → we need a tileset mapping
      2. Our simpler format: {"grid": [[tile_type, ...], ...], "start": [x,y], "goal": [x,y]}
      3. ASCII art: {"ascii": "...", "legend": {"#": "solid", ".": "empty", "S": "start", "G": "goal"}}
      4. ForgeFlow format (2026-04-22): {"tiles": [[int, ...]], "playerSpawn": {x,y}, "exit": {x,y}}
         where tile ints: 0=air, 1=ground_top, 2=ground_fill, 3=platform, 4=spike, 5=goal
         and coordinates are in pixels (tile size = 18px).
    """
    # 2026-04-22: ForgeFlow-pipeline format (from phase_build.levels Claude prompt)
    if "tiles" in level_data and "playerSpawn" in level_data:
        TILE_PX = 18
        INT_TO_TYPE = {
            0: "empty", 1: "solid", 2: "solid",
            3: "platform_oneway", 4: "spike", 5: "goal",
        }
        int_grid = level_data["tiles"]
        grid = [[INT_TO_TYPE.get(int(c) if isinstance(c, (int, str)) else 0, "empty")
                 for c in row] for row in int_grid]
        height = len(grid)
        width = len(grid[0]) if grid else 0
        sp = level_data.get("playerSpawn", {}) or {}
        ex = level_data.get("exit", {}) or {}
        sx, sy = int(sp.get("x", 0)) // TILE_PX, int(sp.get("y", 0)) // TILE_PX
        gx, gy = int(ex.get("x", (width - 1) * TILE_PX)) // TILE_PX, int(ex.get("y", (height - 2) * TILE_PX)) // TILE_PX
        # Clamp to grid bounds
        sx = max(0, min(width - 1, sx)); sy = max(0, min(height - 1, sy))
        gx = max(0, min(width - 1, gx)); gy = max(0, min(height - 1, gy))
        return grid, (sx, sy), (gx, gy)

    if "grid" in level_data:
        grid = level_data["grid"]
        start = tuple(level_data.get("start", [0, 0]))
        goal = tuple(level_data.get("goal", [len(grid[0]) - 1 if grid else 0, 0]))
        return grid, start, goal

    if "ascii" in level_data:
        legend = level_data.get("legend", {"#": "solid", ".": "empty", "S": "start", "G": "goal",
                                            "^": "spike", "o": "collectible"})
        lines = level_data["ascii"].strip().split("\n")
        height = len(lines)
        width = max(len(l) for l in lines) if lines else 0
        grid = [["empty"] * width for _ in range(height)]
        start = (0, 0)
        goal = (width - 1, 0)
        for y, line in enumerate(lines):
            for x, ch in enumerate(line):
                tile_type = legend.get(ch, "empty")
                if tile_type == "start":
                    start = (x, y)
                    grid[y][x] = "empty"
                elif tile_type == "goal":
                    goal = (x, y)
                    grid[y][x] = "empty"
                else:
                    grid[y][x] = tile_type
        return grid, start, goal

    # Tiled JSON: basic support (assumes first layer is tile layer)
    if "layers" in level_data:
        layer = next((l for l in level_data["layers"] if l.get("type") == "tilelayer"), None)
        if not layer:
            return [], (0, 0), (0, 0)
        width = layer["width"]
        height = layer["height"]
        data = layer["data"]
        # Without a tileset mapping we can't distinguish tile types — assume any non-zero ID is solid
        grid = []
        for y in range(height):
            row = []
            for x in range(width):
                tile_id = data[y * width + x]
                row.append("solid" if tile_id > 0 else "empty")
            grid.append(row)
        start = tuple(level_data.get("start", [1, height - 2]))
        goal = tuple(level_data.get("goal", [width - 2, height - 2]))
        return grid, start, goal

    return [], (0, 0), (0, 0)


def _is_standing(grid, x, y) -> bool:
    """A tile position is 'standing' if the tile itself is walkable (empty/oneway top)
    AND the tile below is solid."""
    if not (0 <= y < len(grid)) or not (0 <= x < len(grid[0])):
        return False
    if grid[y][x] in SOLID_TILES:
        return False  # inside a wall
    if grid[y][x] in HAZARD_TILES:
        return False  # dead
    if y + 1 >= len(grid):
        return False
    below = grid[y + 1][x]
    return below in SOLID_TILES or below in ONE_WAY_TILES


def _collect_standing_nodes(grid) -> list:
    """Return every (x, y) position where the player can stand."""
    nodes = []
    for y in range(len(grid)):
        for x in range(len(grid[0]) if grid else 0):
            if _is_standing(grid, x, y):
                nodes.append((x, y))
    return nodes


def _check_line_of_jump(grid, x1, y1, x2, y2) -> bool:
    """Check a straight-line sample of the jump arc doesn't pass through solid tiles.

    Simplified: sample 8 points along the arc and reject if any is inside a solid
    or if the hazard check fires.
    """
    # Parabolic sampling
    apex_y = min(y1, y2) - 1  # rough apex
    samples = 8
    for i in range(1, samples):
        t = i / samples
        # Linear interpolation for x
        x = int(x1 + (x2 - x1) * t)
        # Parabolic y: starts at y1, dips to apex_y, ends at y2
        y = int(y1 + (y2 - y1) * t - 2 * (1 - abs(2*t - 1)))
        if 0 <= y < len(grid) and 0 <= x < len(grid[0]):
            if grid[y][x] in SOLID_TILES:
                return False  # arc hits a wall
            if grid[y][x] in HAZARD_TILES:
                return False  # arc crosses hazard
    return True


# ── Main check ──────────────────────────────────────────────────────────────
def check_level(level_data: dict, physics: dict = None) -> tuple:
    """Check if level is beatable. Returns (bool_completable, issues_list)."""
    physics = physics or {}
    issues = []

    grid, start, goal = _parse_level(level_data)
    if not grid:
        return False, ["Could not parse level data"]

    # Extract physics
    jump_height = int(physics.get("jump_height_tiles", 4))
    horizontal_speed = float(physics.get("horizontal_speed_tiles", 5))
    double_jump = bool(physics.get("double_jump", False))
    dash_tiles = int(physics.get("dash_tiles", 0))

    reach_offsets = _jump_reach(jump_height, horizontal_speed, double_jump, dash_tiles)
    standing = set(_collect_standing_nodes(grid))

    if not standing:
        return False, ["No standing positions in level — is it all solid or all hazard?"]

    if start not in standing:
        # Snap start to nearest standing position
        nearest = min(standing, key=lambda p: (p[0] - start[0])**2 + (p[1] - start[1])**2) if standing else None
        issues.append(f"Start {start} is not standing — snapping to {nearest}")
        start = nearest

    # BFS from start
    visited = {start}
    queue = deque([start])
    goal_reachable = False
    while queue:
        pos = queue.popleft()
        if pos == goal or (abs(pos[0] - goal[0]) <= 1 and abs(pos[1] - goal[1]) <= 1):
            goal_reachable = True
            break
        for dx, dy in reach_offsets:
            np = (pos[0] + dx, pos[1] + dy)
            if np in visited:
                continue
            if np not in standing:
                continue
            # Verify the arc doesn't pass through solid
            if not _check_line_of_jump(grid, pos[0], pos[1], np[0], np[1]):
                continue
            visited.add(np)
            queue.append(np)

    if not goal_reachable:
        issues.append(f"Goal at {goal} not reachable from start {start}. Explored {len(visited)} positions.")
        return False, issues

    # Bonus: detect isolated pockets (softlock zones)
    unreachable = standing - visited
    if unreachable:
        # Only flag if the pocket is >5 tiles (otherwise likely intentional secret)
        if len(unreachable) > 5:
            issues.append(f"{len(unreachable)} unreachable standing positions — potential softlock zones or unreachable secrets")

    return True, issues


# ── Backward reachability — Cooper FDG 2025 "Stuck in the Middle" ───────────
# Beyond "can the player reach the goal?", this answers "from which tiles can
# the player NEVER reach the goal?". A tile is a SOFTLOCK if it's
# forward-reachable from start AND not backward-reachable from goal AND not
# obviously a sink (lethal hazard). Player walks into the zone, can't get out,
# can't progress — game is stuck.
#
# Source: Cooper & Bazzaz, "Stuck in the Middle: Generating Levels without
# (or with) Softlocks", FDG 2025.

def _backward_jump_reach(reach_offsets: list) -> list:
    """Reverse the offset graph: if forward reach has (dx, dy), backward
    reach has (-dx, -dy). Used to BFS from goal toward start to find all
    tiles from which the goal is reachable."""
    return list(set((-dx, -dy) for dx, dy in reach_offsets))


def find_softlocks(level_data: dict, physics: dict = None) -> dict:
    """Compute softlock zones for one level.

    Returns: {
        "completable":         bool — goal reachable from start at all,
        "forward_reachable":   set of tiles reachable from start,
        "backward_reachable":  set of tiles from which goal is reachable,
        "softlock_zones":      list of tiles that are forward-reachable but
                                not backward-reachable (player can walk there
                                but can never reach the goal from there),
        "softlock_count":      int — how many softlock tiles
        "issues":              list of human-readable issues
    }
    """
    physics = physics or {}
    grid, start, goal = _parse_level(level_data)
    if not grid:
        return {"completable": False, "forward_reachable": set(),
                "backward_reachable": set(), "softlock_zones": [],
                "softlock_count": 0, "issues": ["Could not parse level data"]}

    jump_height = int(physics.get("jump_height_tiles", 4))
    horizontal_speed = float(physics.get("horizontal_speed_tiles", 5))
    double_jump = bool(physics.get("double_jump", False))
    dash_tiles = int(physics.get("dash_tiles", 0))

    forward_offsets = _jump_reach(jump_height, horizontal_speed, double_jump, dash_tiles)
    backward_offsets = _backward_jump_reach(forward_offsets)
    standing = set(_collect_standing_nodes(grid))

    # Snap start to nearest standing if needed
    if start not in standing and standing:
        start = min(standing, key=lambda p: (p[0]-start[0])**2 + (p[1]-start[1])**2)
    # Snap goal to nearest standing if needed
    if goal not in standing and standing:
        goal = min(standing, key=lambda p: (p[0]-goal[0])**2 + (p[1]-goal[1])**2)

    # Forward BFS from start
    forward = {start}
    queue = deque([start])
    while queue:
        pos = queue.popleft()
        for dx, dy in forward_offsets:
            np = (pos[0]+dx, pos[1]+dy)
            if np in forward or np not in standing:
                continue
            if not _check_line_of_jump(grid, pos[0], pos[1], np[0], np[1]):
                continue
            forward.add(np)
            queue.append(np)

    # Backward BFS from goal (using reversed offsets)
    backward = {goal}
    queue = deque([goal])
    while queue:
        pos = queue.popleft()
        for dx, dy in backward_offsets:
            np = (pos[0]+dx, pos[1]+dy)
            if np in backward or np not in standing:
                continue
            # Verify the FORWARD jump (np -> pos) is unobstructed (we're walking
            # backward through the graph but the arc is still forward-shaped)
            if not _check_line_of_jump(grid, np[0], np[1], pos[0], pos[1]):
                continue
            backward.add(np)
            queue.append(np)

    completable = goal in forward
    softlocks = forward - backward  # tiles you can reach but can't escape from
    issues = []
    if not completable:
        issues.append(f"Goal at {goal} not reachable from start {start}.")
    if len(softlocks) > 0:
        issues.append(f"{len(softlocks)} softlock tiles found "
                      f"(reachable from start, but goal unreachable from them).")
    return {
        "completable":        completable,
        "forward_reachable":  forward,
        "backward_reachable": backward,
        "softlock_zones":     sorted(softlocks)[:20],  # cap for log brevity
        "softlock_count":     len(softlocks),
        "issues":             issues,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", required=True, help="Path to level JSON")
    ap.add_argument("--physics", help="Path to design.json (for player physics)")
    args = ap.parse_args()

    level_data = json.loads(Path(args.level).read_text(encoding="utf-8"))
    physics = {}
    if args.physics:
        design = json.loads(Path(args.physics).read_text(encoding="utf-8"))
        # Map design.json fields to physics dict
        controls = design.get("controls", {})
        abilities = design.get("protagonist", {}).get("abilities", [])
        physics["double_jump"] = "double jump" in " ".join(abilities).lower() or "double_jump" in abilities
        physics["dash_tiles"] = 4 if "dash" in " ".join(abilities).lower() else 0

    ok, issues = check_level(level_data, physics)
    print(f"Completable: {ok}")
    for i in issues:
        print(f"  - {i}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
