#!/usr/bin/env python3
"""
playtest_bot.py — Playwright-driven automated playtesting for generated games.

Per 2026-04-17 research, 3-layer QA validation catches 95%+ of shipped bugs in
under 10 minutes (vs hours for DQN bots). Layer 1 = reachability solver (fast).
Layer 2 = random-action completion bot (this file). Layer 3 = scripted pathfinding
bot (optional, for timing-tight sections).

This module implements Layer 2:
  - Boots the game in headless Chromium via Playwright
  - Uses window.__TEST__ hooks (exposed by the game templates) to read state
  - Runs N trials, each with random keyboard actions (biased toward forward + jump)
  - Tracks: did we win? did we die? did we get stuck in one spot for 10+ sec?
  - Reports completion rate, average time, common failure patterns

Templates expose:
  window.__TEST__.getPlayer()     -> {x, y, health, alive, state}
  window.__TEST__.getCurrentScene() -> "GameScene" | "GameOverScene" | "WinScene"
  window.__TEST__.simulateInput(key, down) -> triggers key press/release
  window.__TEST__.getScore(), getLives(), getLevel(), getEnemies()

Usage (as module):
    from playtest_bot import run_playtest
    result = run_playtest(game_url, trials=5, time_limit_sec=60)

CLI:
    python scripts/playtest_bot.py --url http://localhost:8080/game/index.html --trials 10
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path


def run_soak(game_url: str, duration_sec: int = 600, headless: bool = True) -> dict:
    """AAA soak test — play continuously for 10 min, sample memory every 30 sec,
    detect leaks. Reports memory growth rate, FPS stability, anomaly counts.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"error": "playwright not installed"}

    result = {"duration_sec": duration_sec, "memory_samples": [], "fps_samples": [], "console_errors": [], "died": False, "crashed": False}
    import random, time
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))

        try:
            page.goto(game_url, timeout=20000, wait_until="domcontentloaded")
            page.wait_for_function(
                "() => window.__TEST__ && typeof window.__TEST__.getPlayer === 'function'",
                timeout=15000,
            )
            try:
                btn = page.query_selector("button:has-text('Play'), button:has-text('Start'), #play-btn")
                if btn: btn.click()
            except Exception: pass

            start = time.time()
            last_sample = start
            while time.time() - start < duration_sec:
                # Sample every 30 sec
                if time.time() - last_sample >= 30:
                    last_sample = time.time()
                    try:
                        perf = page.evaluate("() => window.__PERF__ && window.__PERF__.getPerformance ? window.__PERF__.getPerformance() : null")
                        if perf:
                            result["memory_samples"].append({"t": int(time.time() - start), "mb": perf.get("memMB", 0)})
                            result["fps_samples"].append({"t": int(time.time() - start), "fps": perf.get("fps", 0)})
                    except Exception: pass

                # Continuous random-ish play
                try:
                    action = random.choice(["right", "right", "right_jump", "jump", "left", "idle"])
                    if action == "right": page.keyboard.press("ArrowRight")
                    elif action == "right_jump":
                        page.keyboard.down("ArrowRight"); page.keyboard.press("Space")
                        time.sleep(0.1); page.keyboard.up("ArrowRight")
                    elif action == "jump": page.keyboard.press("Space")
                    elif action == "left": page.keyboard.press("ArrowLeft")
                except Exception: pass

                # If died, restart
                try:
                    scene = page.evaluate("() => window.__TEST__.getCurrentScene()")
                    if scene in ("GameOverScene", "DeathScene"):
                        result["died"] = True
                        try: page.reload(); time.sleep(2)
                        except Exception: pass
                except Exception: pass

                time.sleep(0.2)
        except Exception as e:
            result["crashed"] = True
            result["error"] = str(e)[:200]

        result["console_errors"] = errors[:20]
        browser.close()

    # Compute leak analysis
    if len(result["memory_samples"]) >= 3:
        first = result["memory_samples"][0]["mb"]
        last = result["memory_samples"][-1]["mb"]
        result["memory_growth_mb"] = last - first
        result["memory_growth_pct"] = round((last - first) / max(1, first) * 100, 1)
        result["memory_verdict"] = "leak_suspected" if (last > first * 1.8 and last - first > 30) else "stable"
    if result["fps_samples"]:
        avg_fps = sum(s["fps"] for s in result["fps_samples"]) / len(result["fps_samples"])
        min_fps = min(s["fps"] for s in result["fps_samples"])
        result["avg_fps"] = round(avg_fps, 1)
        result["min_fps"] = min_fps
        result["fps_verdict"] = "pass" if min_fps >= 30 else "fail"
    return result


def run_playtest(game_url: str, trials: int = 5, time_limit_sec: int = 60,
                 headless: bool = True) -> dict:
    """Run N random-action playtest trials. Return aggregate stats."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"error": "playwright not installed — run: pip install playwright && playwright install chromium"}

    results = {
        "url":            game_url,
        "trials":         trials,
        "time_limit_sec": time_limit_sec,
        "wins":           0,
        "deaths":         0,
        "stuck":          0,
        "crashes":        0,
        "trial_details":  [],
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(viewport={"width": 1280, "height": 720})

        for trial_num in range(1, trials + 1):
            trial = {"trial": trial_num, "outcome": None, "duration_sec": 0,
                     "max_x": 0, "final_score": 0, "console_errors": []}
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

            try:
                page.goto(game_url, timeout=20000, wait_until="domcontentloaded")
                # 2026-04-27: __TEST__ only exists AFTER Game scene starts, but
                # the game boots into Menu first. Dismiss menu first, then wait
                # for __TEST__. Same fix shipped to L1 test_runner earlier.
                page.wait_for_function("() => window.__GAME__", timeout=15000)
                for key in ("Space", "Enter", "ArrowRight"):
                    page.keyboard.press(key); page.wait_for_timeout(120)
                # Click any "Play" / "Start" button if present (some templates use buttons)
                try:
                    play_btn = page.query_selector("button:has-text('Play'), button:has-text('Start'), #play-btn, #start-btn")
                    if play_btn: play_btn.click()
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
                    timeout=15000
                )

                start_time = time.time()
                last_x = None
                stuck_ticks = 0
                max_x_seen = 0

                # Action loop — 200ms between inputs
                while time.time() - start_time < time_limit_sec:
                    # Check state
                    try:
                        scene = page.evaluate("() => window.__TEST__.getCurrentScene()")
                    except Exception:
                        scene = "unknown"

                    # 2026-04-22: substring match so games using variants
                    # (LevelWin, Level1Complete, VictoryOverlay) still count.
                    if scene and any(s in str(scene) for s in ("Win", "Victory", "LevelComplete")):
                        trial["outcome"] = "win"
                        results["wins"] += 1
                        break
                    if scene and any(s in str(scene) for s in ("GameOver", "Death")):
                        trial["outcome"] = "death"
                        results["deaths"] += 1
                        break

                    try:
                        player = page.evaluate("() => window.__TEST__.getPlayer()")
                        if player and "x" in player:
                            x = player["x"]
                            if last_x is not None and abs(x - last_x) < 2:
                                stuck_ticks += 1
                            else:
                                stuck_ticks = 0
                            last_x = x
                            max_x_seen = max(max_x_seen, x)
                        if not player.get("alive", True):
                            trial["outcome"] = "death"
                            results["deaths"] += 1
                            break
                    except Exception:
                        pass

                    # Stuck >50 ticks (10 sec) = fail this trial
                    if stuck_ticks > 50:
                        trial["outcome"] = "stuck"
                        results["stuck"] += 1
                        break

                    # Random action: heavily biased toward right + jump (platformer heuristic)
                    action = random.choices(
                        ["right", "right", "right", "right_jump", "right_jump",
                         "jump", "left", "dash", "attack", "idle"],
                        k=1
                    )[0]

                    try:
                        if action == "right":
                            page.keyboard.press("ArrowRight")
                        elif action == "right_jump":
                            page.keyboard.down("ArrowRight")
                            page.keyboard.press("Space")
                            time.sleep(0.1)
                            page.keyboard.up("ArrowRight")
                        elif action == "jump":
                            page.keyboard.press("Space")
                        elif action == "left":
                            page.keyboard.press("ArrowLeft")
                        elif action == "dash":
                            page.keyboard.press("Shift")
                        elif action == "attack":
                            page.keyboard.press("X")
                        # idle = do nothing
                    except Exception:
                        pass

                    time.sleep(0.2)

                else:
                    # Time-out without win/death/stuck
                    trial["outcome"] = "timeout"

                trial["duration_sec"] = round(time.time() - start_time, 1)
                trial["max_x"] = max_x_seen
                try:
                    trial["final_score"] = page.evaluate("() => window.__TEST__.getScore ? window.__TEST__.getScore() : 0")
                except Exception:
                    pass

            except Exception as e:
                trial["outcome"] = "crash"
                trial["error"] = str(e)[:200]
                results["crashes"] += 1

            trial["console_errors"] = errors[:10]
            results["trial_details"].append(trial)
            page.close()

        browser.close()

    # Aggregates
    results["completion_rate"] = round(results["wins"] / trials, 2) if trials else 0
    results["verdict"] = (
        "PASS" if results["completion_rate"] >= 0.2 else
        "BORDERLINE" if results["completion_rate"] >= 0.05 or results["wins"] >= 1 else
        "FAIL"
    )

    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="Full URL of the deployed/local game")
    ap.add_argument("--trials", type=int, default=5)
    ap.add_argument("--time-limit", type=int, default=60, dest="time_limit")
    ap.add_argument("--headed", action="store_true", help="Show browser (for debugging)")
    ap.add_argument("--soak", type=int, default=0, help="Run SOAK test for N seconds (default: normal playtest)")
    args = ap.parse_args()

    if args.soak:
        result = run_soak(args.url, duration_sec=args.soak, headless=not args.headed)
        print(json.dumps(result, indent=2))
        verdict = result.get("fps_verdict") == "pass" and result.get("memory_verdict") == "stable"
        sys.exit(0 if verdict else 1)

    result = run_playtest(args.url, trials=args.trials,
                          time_limit_sec=args.time_limit, headless=not args.headed)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("verdict") == "PASS" else 1)


if __name__ == "__main__":
    main()
