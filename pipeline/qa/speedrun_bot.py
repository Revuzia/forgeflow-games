#!/usr/bin/env python3
"""
speedrun_bot.py — Layer 3 of 3-layer QA (per research recommendation).

Unlike random-action bot (Layer 2) which explores blindly, the speedrun bot
executes a DETERMINISTIC path through each level. It catches timing-tight
sections that random inputs can't consistently clear.

Strategy:
  1. Load each level from levels.json
  2. Run reachability_solver to get the optimal path (start -> goal via jumps)
  3. Translate path to keyboard input timeline (move right, jump at gap, etc.)
  4. Execute via Playwright — press inputs at the right frames
  5. Verify the player actually reached the goal

Faster + more reliable than random bot for timing-sensitive validation.

Usage (as module):
    from speedrun_bot import run_speedrun
    result = run_speedrun(game_url, levels_json, design_json, trials=1)

CLI:
    python scripts/speedrun_bot.py --url file:///path/index.html --levels path/levels.json --design path/design.json
"""
import argparse
import json
import sys
import time
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _plan_path_through_level(level: dict, physics: dict) -> list:
    """Use reachability solver to get a BFS path from start to goal.
    Returns list of (x, y) tile positions representing the path.
    """
    try:
        from reachability_solver import _parse_level, _jump_reach, _collect_standing_nodes, _check_line_of_jump
    except ImportError:
        return []

    grid, start, goal = _parse_level(level)
    if not grid:
        return []

    jump_height = int(physics.get("jump_height_tiles", 4))
    horiz_speed = float(physics.get("horizontal_speed_tiles", 5))
    double_jump = bool(physics.get("double_jump", False))
    dash_tiles = int(physics.get("dash_tiles", 0))

    reach_offsets = _jump_reach(jump_height, horiz_speed, double_jump, dash_tiles)
    standing = set(_collect_standing_nodes(grid))
    if not standing or start not in standing:
        return []

    # BFS retaining parent for path reconstruction
    parents = {start: None}
    queue = deque([start])
    goal_node = None
    while queue:
        pos = queue.popleft()
        if pos == goal or (abs(pos[0] - goal[0]) <= 1 and abs(pos[1] - goal[1]) <= 1):
            goal_node = pos
            break
        for dx, dy in reach_offsets:
            np = (pos[0] + dx, pos[1] + dy)
            if np in parents or np not in standing:
                continue
            if not _check_line_of_jump(grid, pos[0], pos[1], np[0], np[1]):
                continue
            parents[np] = pos
            queue.append(np)

    if not goal_node:
        return []

    # Reconstruct path
    path = []
    node = goal_node
    while node is not None:
        path.append(node)
        node = parents[node]
    path.reverse()
    return path


def _path_to_input_plan(path: list, tile_px: int = 18) -> list:
    """Translate a path of (tile_x, tile_y) positions into a timeline of keyboard
    actions. Each step describes the input at that frame-bucket.

    Returns list of {"action": "hold_right"|"jump"|"dash", "duration_ms": int}
    """
    if len(path) < 2:
        return []

    plan = []
    for i in range(1, len(path)):
        prev = path[i - 1]
        curr = path[i]
        dx = curr[0] - prev[0]
        dy = curr[1] - prev[1]

        if dy < 0:
            # Upward transition = jump
            plan.append({"action": "jump", "duration_ms": 100})
        if dx > 0:
            plan.append({"action": "hold_right", "duration_ms": 200 + 80 * abs(dx)})
        elif dx < 0:
            plan.append({"action": "hold_left", "duration_ms": 200 + 80 * abs(dx)})
        elif dy == 0 and dx == 0:
            plan.append({"action": "idle", "duration_ms": 50})

    return plan


def run_speedrun(game_url: str, levels: list, design: dict, trials: int = 1,
                 headless: bool = True, time_limit_sec: int = 90,
                 physics: dict | None = None) -> dict:
    """Run a scripted speedrun against a game. Verifies deterministic paths work.

    Args:
        physics: derived player physics (jump_height_tiles, horizontal_speed_tiles,
                 double_jump, dash_tiles). If None, falls back to design abilities
                 + conservative defaults (matches L2 reachability behavior).
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"error": "playwright not installed"}

    # 2026-04-27: caller can now pass derived physics. Fallback to design.json
    # ability strings + defaults if not provided (matches old behavior).
    if not physics:
        physics = {
            "jump_height_tiles": 4,
            "horizontal_speed_tiles": 5,
            "double_jump": "double" in " ".join(design.get("protagonist", {}).get("abilities", [])).lower(),
            "dash_tiles": 4 if "dash" in " ".join(design.get("protagonist", {}).get("abilities", [])).lower() else 0,
        }

    # 2026-04-27: Cooper FDG 2025 backward-reachability check on every tested
    # level so soft-lock zones surface even when the level is technically
    # completable.
    softlock_summary = {"levels_with_softlocks": 0, "total_softlock_tiles": 0}
    try:
        from reachability_solver import find_softlocks as _find_softlocks
        for level in levels[:3]:  # match the per-level loop below
            sl = _find_softlocks(level, physics)
            if sl["softlock_count"] > 0:
                softlock_summary["levels_with_softlocks"] += 1
                softlock_summary["total_softlock_tiles"] += sl["softlock_count"]
    except Exception as _sl_e:
        softlock_summary["error"] = str(_sl_e)[:120]

    results = {
        "url": game_url,
        "physics_used": physics,
        "softlocks": softlock_summary,
        "levels_tested": 0,
        "levels_completed": 0,
        "per_level": [],
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(viewport={"width": 1280, "height": 720})

        # Test up to first 3 levels (scripted speedrun is expensive per level)
        for lvl_idx, level in enumerate(levels[:3]):
            plan = _plan_path_through_level(level, physics)
            if not plan:
                results["per_level"].append({"level": lvl_idx, "outcome": "no_path_found"})
                continue

            input_plan = _path_to_input_plan(plan)
            level_result = {"level": lvl_idx, "input_steps": len(input_plan)}
            page = context.new_page()

            try:
                page.goto(game_url, timeout=20000, wait_until="domcontentloaded")
                # 2026-04-27: __TEST__ only exists AFTER Game scene starts (it's
                # registered in GameScene.create()). Dismiss Menu first, then
                # wait for __TEST__. Same fix shipped to L1 + playtest_bot.
                page.wait_for_function("() => window.__GAME__", timeout=15000)
                for key in ("Space", "Enter", "ArrowRight"):
                    page.keyboard.press(key); page.wait_for_timeout(120)
                try:
                    btn = page.query_selector("button:has-text('Play'), button:has-text('Start'), #play-btn")
                    if btn: btn.click()
                except Exception:
                    pass
                # Force-start Game scene as last resort
                try:
                    page.evaluate("() => window.__GAME__ && window.__GAME__.scene && window.__GAME__.scene.start && window.__GAME__.scene.start('Game')")
                except Exception:
                    pass
                # NOW wait for __TEST__
                page.wait_for_function(
                    "() => window.__TEST__ && typeof window.__TEST__.getPlayer === 'function'",
                    timeout=15000,
                )

                # Jump to specific level if the API supports it
                try:
                    page.evaluate(f"() => window.__TEST__.loadLevel && window.__TEST__.loadLevel({lvl_idx})")
                except Exception:
                    pass

                start_time = time.time()
                held_keys = set()
                completed = False

                for step in input_plan:
                    if time.time() - start_time > time_limit_sec:
                        level_result["outcome"] = "timeout"
                        break

                    action = step["action"]
                    dur = step["duration_ms"] / 1000.0

                    if action == "hold_right":
                        if "ArrowLeft" in held_keys:
                            page.keyboard.up("ArrowLeft"); held_keys.discard("ArrowLeft")
                        if "ArrowRight" not in held_keys:
                            page.keyboard.down("ArrowRight"); held_keys.add("ArrowRight")
                        time.sleep(dur)
                    elif action == "hold_left":
                        if "ArrowRight" in held_keys:
                            page.keyboard.up("ArrowRight"); held_keys.discard("ArrowRight")
                        if "ArrowLeft" not in held_keys:
                            page.keyboard.down("ArrowLeft"); held_keys.add("ArrowLeft")
                        time.sleep(dur)
                    elif action == "jump":
                        page.keyboard.press("Space")
                        time.sleep(dur)
                    elif action == "dash":
                        page.keyboard.press("Shift")
                        time.sleep(dur)
                    elif action == "idle":
                        # Release all held keys
                        for k in list(held_keys):
                            page.keyboard.up(k); held_keys.discard(k)
                        time.sleep(dur)

                    # Check completion — 2026-04-28: substring match on scene
                    # name OR level-increment (intermediate level beats stay
                    # in Game scene with currentLevel+1).
                    try:
                        scene = page.evaluate("() => window.__TEST__.getCurrentScene()")
                        if scene and any(s in str(scene) for s in ("Win", "Victory", "LevelComplete")):
                            completed = True
                            level_result["outcome"] = "completed"
                            break
                        if scene and any(s in str(scene) for s in ("GameOver", "Death")):
                            level_result["outcome"] = "death_during_scripted_run"
                            break
                        cur_lvl = page.evaluate("() => window.__TEST__.getLevel ? window.__TEST__.getLevel() : null")
                        if cur_lvl is not None and cur_lvl > lvl_idx:
                            completed = True
                            level_result["outcome"] = "completed_level_advanced"
                            break
                    except Exception:
                        pass

                # Release any still-held keys
                for k in list(held_keys):
                    page.keyboard.up(k)

                if not completed and "outcome" not in level_result:
                    level_result["outcome"] = "did_not_reach_goal"
                if completed:
                    results["levels_completed"] += 1

                level_result["duration_sec"] = round(time.time() - start_time, 1)

            except Exception as e:
                level_result["outcome"] = f"error: {str(e)[:80]}"

            results["per_level"].append(level_result)
            results["levels_tested"] += 1
            page.close()

        browser.close()

    # Verdict — 2026-04-28 v2: speedrun_bot now has TWO checks:
    #   1) Cooper backward-reachability (softlock tiles must be 0)
    #   2) Scripted-input completion rate ≥ 33% (was unconditional PASS)
    # The audit caught a level shipped where 0/3 scripted runs completed
    # but verdict was PASS. Real users couldn't beat it. New rule: if scripted
    # runs are reliably failing AND there's a level we tested, downgrade to
    # FAIL — the level is unbeatable in physics even if not graph-softlocked.
    sl_count = (results.get("softlocks") or {}).get("total_softlock_tiles", 0)
    completion_rate = results["levels_completed"] / max(1, results["levels_tested"])
    results["completion_rate"] = round(completion_rate, 2)
    if results["levels_tested"] == 0:
        results["verdict"] = "NO_LEVELS_TESTABLE"
    elif sl_count > 0:
        results["verdict"] = "FAIL"
    elif completion_rate < 0.34:
        # Scripted-input completion is unreliable due to enemy timing, but
        # 0% suggests a real geometry problem (jump unreachable, exit
        # overshot, etc.). 33% threshold is a balance — gives benefit of
        # doubt to enemy-RNG variance while flagging total failures.
        results["verdict"] = "FAIL"
    else:
        results["verdict"] = "PASS"

    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--levels", required=True, help="Path to levels.json")
    ap.add_argument("--design", required=True, help="Path to design.json")
    args = ap.parse_args()

    levels = json.loads(Path(args.levels).read_text(encoding="utf-8"))
    design = json.loads(Path(args.design).read_text(encoding="utf-8"))
    if isinstance(levels, dict) and "levels" in levels:
        levels = levels["levels"]

    result = run_speedrun(args.url, levels, design)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("verdict") == "PASS" else 1)


if __name__ == "__main__":
    main()
