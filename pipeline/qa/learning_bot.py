#!/usr/bin/env python3
"""
learning_bot.py — In-session learning playtest bot.

Approach: contextual multi-armed bandit over action sequences.
- Trial 1 = random actions (like existing playtest_bot)
- After each trial, measure progress (max_x_seen, coins_collected, reached_exit)
- Build a memory of "chunks" — short action sequences that produced forward progress
- Subsequent trials bias toward replaying successful chunks + random exploration
- Exploration rate decays per trial (epsilon-greedy with epsilon_0 = 0.6, decay 0.7/trial)

This is NOT full RL (no neural net, no gradient descent). It's a lightweight
learning pattern that improves within a single 2-4 min QA session without
requiring GPU or pre-training.

Research basis:
  - Multi-armed bandits (Sutton & Barto, Reinforcement Learning: An Introduction)
  - UCB1 selection (Auer et al., 2002)
  - NEAT-lite approach inspired by Sethbling's MarI/O
  - Not a replacement for DQN/PPO for production-grade bots; appropriate for
    fast web-game QA with bounded compute budget.

Usage (as module, drop-in replacement for playtest_bot):
    from learning_bot import run_learning_playtest
    result = run_learning_playtest(game_url, trials=5, time_limit_sec=60)
"""
import random
import time
from collections import Counter, defaultdict


ACTIONS = ["right", "right_jump", "jump", "left", "left_jump", "down", "idle"]


def _encode_action(action: str):
    """Convert action name into Playwright key presses."""
    return {
        "right":      [("ArrowRight", 300)],
        "right_jump": [("ArrowRight", 200), ("Space", 150)],
        "jump":       [("Space", 200)],
        "left":       [("ArrowLeft", 300)],
        "left_jump":  [("ArrowLeft", 200), ("Space", 150)],
        "down":       [("ArrowDown", 200)],
        "idle":       [(None, 200)],
    }.get(action, [("ArrowRight", 200)])


def _fire_action(page, action: str):
    """Execute one action (may involve multiple key down/up sequences)."""
    for key, hold_ms in _encode_action(action):
        if key is None:
            page.wait_for_timeout(hold_ms)
            continue
        try:
            page.keyboard.down(key)
            page.wait_for_timeout(hold_ms)
            page.keyboard.up(key)
        except Exception:
            pass


def _get_player_x(page):
    try:
        p = page.evaluate("() => window.__TEST__ ? window.__TEST__.getPlayer() : null")
        if isinstance(p, dict) and "x" in p:
            return float(p["x"]), (p.get("alive", True) is not False)
    except Exception:
        pass
    return None, True


def run_learning_playtest(game_url: str, trials: int = 5, time_limit_sec: int = 60) -> dict:
    """Run N playtest trials that LEARN within the session.

    Returns the same shape as playtest_bot.run_playtest plus:
      - "learning_chunks": top action sequences discovered
      - "progress_per_trial": max_x after each trial (shows improvement)
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"skipped": "playwright not installed", "wins": 0, "trials": 0, "verdict": "SKIP"}

    # ── Chunk memory: maps (action_sequence_key → avg_progress_delta) ─────
    # Each chunk = tuple of 3 consecutive actions.
    chunk_score = defaultdict(lambda: {"attempts": 0, "total_gain": 0.0})

    def _chunk_key(seq):
        return tuple(seq[-3:]) if len(seq) >= 3 else tuple(seq)

    results = {
        "trials": trials,
        "wins": 0,
        "deaths": 0,
        "timeouts": 0,
        "progress_per_trial": [],
        "learning_chunks": [],
        "max_x_seen": 0,
        "avg_progress": 0,
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for trial_num in range(1, trials + 1):
            # ── Epsilon decay: more exploration early, more exploitation later
            epsilon = max(0.1, 0.6 * (0.7 ** (trial_num - 1)))

            trial = {"trial": trial_num, "outcome": None, "epsilon": round(epsilon, 3)}
            try:
                page = browser.new_page(viewport={"width": 960, "height": 540})
                page.on("pageerror", lambda e: None)  # silent
                page.goto(game_url, timeout=20000, wait_until="domcontentloaded")
                page.wait_for_timeout(2000)

                # Dismiss start screen
                for key in ("Space", "Enter"):
                    page.keyboard.press(key)
                    page.wait_for_timeout(150)
                try:
                    page.evaluate("() => window.__GAME__ && window.__GAME__.scene && window.__GAME__.scene.start && window.__GAME__.scene.start('Game')")
                except Exception:
                    pass
                page.wait_for_timeout(800)

                start_time = time.time()
                prev_x, _ = _get_player_x(page)
                if prev_x is None:
                    prev_x = 0
                max_x = prev_x
                action_seq = []
                # 2026-04-28: track initial level so level-increment counts as a win
                try:
                    initial_level = page.evaluate("() => window.__TEST__ && window.__TEST__.getLevel ? window.__TEST__.getLevel() : 0")
                except Exception:
                    initial_level = 0

                while time.time() - start_time < time_limit_sec:
                    # Check win / death via scene
                    try:
                        scene = page.evaluate("() => window.__TEST__ ? window.__TEST__.getCurrentScene() : null")
                    except Exception:
                        scene = None
                    if scene and any(k in str(scene) for k in ("Win", "Victory", "LevelComplete")):
                        trial["outcome"] = "win"
                        results["wins"] += 1
                        break
                    # 2026-04-28: level-increment win detection (intermediate
                    # level beats stay in Game scene with currentLevel+1)
                    try:
                        cur_level = page.evaluate("() => window.__TEST__ && window.__TEST__.getLevel ? window.__TEST__.getLevel() : 0")
                        if cur_level is not None and cur_level > initial_level:
                            trial["outcome"] = "win"
                            trial["levels_completed"] = cur_level - initial_level
                            results["wins"] += 1
                            break
                    except Exception:
                        pass
                    if scene and any(k in str(scene) for k in ("GameOver", "Death")):
                        trial["outcome"] = "death"
                        results["deaths"] += 1
                        break

                    # ── Choose action: epsilon-greedy over learned chunks
                    if random.random() < epsilon or len(chunk_score) < 3:
                        # Explore: biased random (weight toward forward progress)
                        action = random.choices(
                            ACTIONS,
                            weights=[0.35, 0.25, 0.12, 0.08, 0.05, 0.05, 0.1],
                            k=1,
                        )[0]
                    else:
                        # Exploit: pick chunk with best avg gain among known chunks
                        # Consider chunks whose first 2 actions match our recent history
                        prefix = tuple(action_seq[-2:]) if len(action_seq) >= 2 else ()
                        best_chunk = None
                        best_gain = -1e9
                        for chunk, stats in chunk_score.items():
                            if len(chunk) != 3 or stats["attempts"] < 1:
                                continue
                            if prefix and chunk[:2] != prefix:
                                continue
                            avg = stats["total_gain"] / stats["attempts"]
                            if avg > best_gain:
                                best_gain = avg
                                best_chunk = chunk
                        if best_chunk:
                            action = best_chunk[-1]
                        else:
                            action = random.choice(ACTIONS)

                    _fire_action(page, action)
                    action_seq.append(action)

                    # Measure progress
                    cur_x, alive = _get_player_x(page)
                    if cur_x is None:
                        cur_x = prev_x
                    if not alive:
                        trial["outcome"] = "death"
                        results["deaths"] += 1
                        break
                    delta = cur_x - prev_x
                    if cur_x > max_x:
                        max_x = cur_x

                    # Update chunk memory with gain attribution
                    if len(action_seq) >= 3:
                        key = _chunk_key(action_seq)
                        chunk_score[key]["attempts"] += 1
                        chunk_score[key]["total_gain"] += delta

                    prev_x = cur_x
                else:
                    trial["outcome"] = "timeout"
                    results["timeouts"] += 1

                trial["max_x"] = round(max_x, 1)
                trial["actions_taken"] = len(action_seq)
                results["progress_per_trial"].append(trial["max_x"])
                results["max_x_seen"] = max(results["max_x_seen"], max_x)
                page.close()
            except Exception as e:
                trial["outcome"] = "crash"
                trial["error"] = str(e)[:200]

        browser.close()

    # Rank top learned chunks
    ranked = sorted(
        ((k, v["total_gain"] / max(1, v["attempts"]), v["attempts"])
         for k, v in chunk_score.items()),
        key=lambda x: x[1], reverse=True,
    )
    results["learning_chunks"] = [
        {"chunk": " → ".join(k), "avg_gain": round(g, 1), "attempts": a}
        for k, g, a in ranked[:5]
    ]

    if results["progress_per_trial"]:
        results["avg_progress"] = round(sum(results["progress_per_trial"]) / len(results["progress_per_trial"]), 1)

    # Verdict: improved if last trial > first trial by >= 20%, or any wins
    verdict = "FAIL"
    if results["wins"] >= 1:
        verdict = "PASS"
    elif len(results["progress_per_trial"]) >= 2:
        first = results["progress_per_trial"][0]
        last = results["progress_per_trial"][-1]
        if last >= first * 1.2 and last > 100:
            verdict = "BORDERLINE"  # learning showed improvement but no win
    results["verdict"] = verdict

    return results


if __name__ == "__main__":
    import argparse, json, sys
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--trials", type=int, default=5)
    ap.add_argument("--time-limit", type=int, default=60)
    args = ap.parse_args()
    r = run_learning_playtest(args.url, args.trials, args.time_limit)
    print(json.dumps(r, indent=2))
    sys.exit(0 if r.get("verdict") in ("PASS", "BORDERLINE") else 1)
