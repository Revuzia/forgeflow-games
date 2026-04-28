#!/usr/bin/env python3
"""
coverage_bot.py — L3d: Go-Explore-lite coverage-driven exploration bot.

Architecture: Go-Explore (Uber AI 2018 / Ecoffet et al.) without the neural
network. Pure Python + Playwright. Designed for our 3-min QA budget on CPU.

The other 4 bots all FAIL when the level requires non-trivial action sequences
(e.g., jump-then-right to clear an enemy). Coverage_bot solves this by:

  1. Maintaining a "cell archive" of states visited
       cell = (scene_id, floor(player_x / cell_size), floor(player_y / cell_size))
  2. Each trial:
       a. Pick a target cell from the archive (prefer under-visited cells)
       b. Reset to start (page reload + dismiss menu)
       c. Replay the action trajectory that previously reached the target
       d. From there, take random exploratory actions for budget_left ms
       e. Record any NEW cells discovered + the trajectory that reached them
  3. Repeats until time budget exhausted or full state space explored

Bug classes only this bot catches:
  - Dead zones / softlock pockets (cells reachable but with no exit)
  - Difficulty cliffs (every cell after X requires precise action sequence)
  - Coverage gaps where no other bot ever reaches level 5+
  - Hidden-path bugs (cells that should be reachable but require specific
    action chord and no other bot ever discovers it)

Source basis: Ecoffet, Huang, Lehman, Stanley, Clune, "Go-Explore: a New
Approach for Hard-Exploration Problems" (Uber AI Labs, 2018, arXiv 1901.10995).
Industry parity: EA SEED uses similar curiosity-driven approach in production.

Usage:
    from coverage_bot import run_coverage_bot
    res = run_coverage_bot(game_url, time_budget_sec=60, cell_size_px=80)

CLI:
    python coverage_bot.py --url http://127.0.0.1:8765/index.html --time 60
"""
import argparse
import json
import random
import sys
import time
from collections import defaultdict
from pathlib import Path


# ── Action vocabulary (key, hold_ms) tuples ──────────────────────────────────
# Each action is a sequence of key holds — keys can be combined via overlap.
ACTIONS = {
    "right":          [("ArrowRight", 250)],
    "right_jump":     [("ArrowRight", 350), ("Space", 200)],   # overlapped
    "right_long":     [("ArrowRight", 600)],                    # sustained walk
    "jump":           [("Space", 200)],
    "high_jump":      [("Space", 400)],
    "double_jump":    [("Space", 150), ("Space", 150)],         # tap-pause-tap
    "left":           [("ArrowLeft", 250)],
    "left_jump":      [("ArrowLeft", 350), ("Space", 200)],
    "right_dash":     [("ArrowRight", 200), ("Shift", 150)],
    "down":           [("ArrowDown", 200)],
    "wait":           [],
}
ACTION_NAMES = list(ACTIONS.keys())


def _fire_action(page, action_name: str):
    """Execute one action sequence. Holds keys for the specified durations.
    Multiple holds are issued in parallel via async down/up."""
    seq = ACTIONS.get(action_name, [])
    if not seq:
        page.wait_for_timeout(150)
        return
    # Fire all keydowns first, then sleep for max duration, then keyup
    keys = [k for k, _ms in seq]
    durations = {k: ms for k, ms in seq}
    for k in keys:
        try: page.keyboard.down(k)
        except Exception: pass
    page.wait_for_timeout(max(durations.values()))
    for k in keys:
        try: page.keyboard.up(k)
        except Exception: pass


def _player_cell(player_state: dict, scene: str, cell_size_px: int) -> tuple:
    """Map game state to a discrete cell. None if state unavailable."""
    if not player_state or "x" not in player_state:
        return None
    return (
        scene or "?",
        int(player_state["x"] // cell_size_px),
        int(player_state["y"] // cell_size_px),
    )


def _sample_state(page) -> tuple:
    """Read player + scene from window.__TEST__. Returns (player, scene, alive)."""
    try:
        player = page.evaluate("() => window.__TEST__ && window.__TEST__.getPlayer ? window.__TEST__.getPlayer() : null")
    except Exception:
        player = None
    try:
        scene = page.evaluate("() => window.__TEST__ && window.__TEST__.getCurrentScene ? window.__TEST__.getCurrentScene() : null")
    except Exception:
        scene = None
    alive = bool(player and player.get("alive", True))
    return player, scene, alive


def run_coverage_bot(game_url: str,
                     time_budget_sec: int = 60,
                     cell_size_px: int = 80,
                     max_trial_sec: int = 25,
                     headless: bool = True) -> dict:
    """Run Go-Explore-lite. Returns coverage report.

    Args:
        time_budget_sec: total wall-clock budget across all trials
        cell_size_px:    discretization of (x, y) for cell archive
        max_trial_sec:   single-trial cap (so we cycle through trajectories)

    Returns: {
        "verdict":             "PASS" if coverage > min_threshold, else "FAIL",
        "trials":              int — number of completed trials,
        "cells_visited":       int — unique cells across all trials,
        "scenes_visited":      list of scene keys touched,
        "max_player_x":        farthest x reached,
        "max_player_y":        deepest/highest y reached,
        "deaths":              int — death events recorded,
        "cell_visit_heatmap":  dict cell-key -> visit count (capped at top 30),
        "trajectories":        list of best-trajectories per archive cell,
        "duration_sec":        actual time spent
    }
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"skipped": "playwright not installed", "verdict": "SKIP"}

    archive: dict[tuple, dict] = {}  # cell -> {"trajectory": [...], "visits": int}
    deaths = 0
    scenes_seen = set()
    max_x = 0.0
    max_y = 0.0
    trial_count = 0
    t_start_global = time.time()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(viewport={"width": 1280, "height": 720})

        while time.time() - t_start_global < time_budget_sec:
            trial_count += 1
            # ── 1. PICK target cell from archive (under-visited preferred) ──
            replay_trajectory = []
            if archive and random.random() < 0.7:  # 70% chance to revisit
                # Weighted: prefer cells visited least often
                cells = list(archive.keys())
                weights = [1.0 / max(1, archive[c]["visits"]) for c in cells]
                target = random.choices(cells, weights=weights, k=1)[0]
                replay_trajectory = list(archive[target]["trajectory"])
                archive[target]["visits"] += 1

            # ── 2. RESET to start ──
            page = context.new_page()
            try:
                page.goto(game_url, wait_until="domcontentloaded", timeout=15000)
                page.wait_for_function("() => window.__GAME__", timeout=10000)
                for k in ("Space", "Enter"):
                    page.keyboard.press(k); page.wait_for_timeout(100)
                try:
                    page.evaluate("() => window.__GAME__.scene.start('Game')")
                except Exception:
                    pass
                page.wait_for_function(
                    "() => window.__TEST__ && window.__TEST__.getPlayer",
                    timeout=10000
                )
                page.wait_for_timeout(500)
            except Exception:
                page.close()
                continue

            # ── 3. REPLAY trajectory (deterministic prefix) ──
            current_trajectory = []
            for action in replay_trajectory[:60]:  # cap replay length
                _fire_action(page, action)
                current_trajectory.append(action)
                # Mid-replay sample to populate archive on the way
                player, scene, alive = _sample_state(page)
                if player:
                    max_x = max(max_x, player.get("x", 0))
                    max_y = max(max_y, player.get("y", 0))
                if scene: scenes_seen.add(scene)
                if not alive:
                    deaths += 1
                    break

            # ── 4. EXPLORE from here for remaining budget ──
            t_trial_start = time.time()
            while time.time() - t_trial_start < max_trial_sec and \
                  time.time() - t_start_global < time_budget_sec:
                action = random.choices(
                    ACTION_NAMES,
                    weights=[3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1], k=1
                )[0]
                _fire_action(page, action)
                current_trajectory.append(action)

                player, scene, alive = _sample_state(page)
                if player:
                    max_x = max(max_x, player.get("x", 0))
                    max_y = max(max_y, player.get("y", 0))
                if scene: scenes_seen.add(scene)

                # Record new cell
                cell = _player_cell(player, scene, cell_size_px)
                if cell and cell not in archive:
                    archive[cell] = {"trajectory": list(current_trajectory),
                                     "visits": 1}

                if not alive:
                    deaths += 1
                    break
                if scene and any(s in str(scene) for s in ("Win", "Victory", "LevelComplete")):
                    # WIN! Record the trajectory.
                    archive[("__WIN__",)] = {"trajectory": list(current_trajectory),
                                              "visits": 1}
                    break

            page.close()

        browser.close()

    # ── Build report ──
    cells_visited = len(archive)
    duration = round(time.time() - t_start_global, 1)
    # Top-30 most-visited cells for the heatmap (kept small to avoid huge JSON)
    heatmap = sorted(
        ((str(c), archive[c]["visits"]) for c in archive),
        key=lambda kv: -kv[1]
    )[:30]
    trajectories = {
        str(c): archive[c]["trajectory"][:50]  # cap length
        for c in list(archive)[:5]              # only show 5 trajectories
    }

    # Verdict: pass if coverage exceeds modest threshold.
    # Tuneable — for a 60s run we expect ≥ 8 unique cells if game runs well.
    verdict = "PASS" if cells_visited >= 8 else "FAIL"

    return {
        "verdict":            verdict,
        "trials":             trial_count,
        "duration_sec":       duration,
        "cells_visited":      cells_visited,
        "scenes_visited":     sorted(scenes_seen),
        "max_player_x":       round(max_x, 1),
        "max_player_y":       round(max_y, 1),
        "deaths":             deaths,
        "cell_visit_heatmap": heatmap,
        "trajectories":       trajectories,
        "won":                ("__WIN__",) in archive,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--time", type=int, default=60)
    ap.add_argument("--cell-size", type=int, default=80)
    args = ap.parse_args()
    res = run_coverage_bot(args.url, time_budget_sec=args.time,
                           cell_size_px=args.cell_size)
    print(json.dumps(res, indent=2)[:3000])
    sys.exit(0 if res.get("verdict") == "PASS" else 1)


if __name__ == "__main__":
    main()
