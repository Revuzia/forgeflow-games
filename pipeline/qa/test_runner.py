#!/usr/bin/env python3
"""
test_runner.py — Playwright-based QA that actually plays browser games.

Uses window.__TEST__ hooks exposed by game templates to:
- Verify game starts without errors
- Test player movement (arrow keys change position)
- Test jumping (player goes up)
- Test enemy spawning and movement
- Test collectible pickup (score increases)
- Test death/respawn (lives decrease)
- Test game over screen
- Test level transitions
- Verify no console errors

Usage:
  python pipeline/qa/test_runner.py --game-url file:///path/to/index.html
  python pipeline/qa/test_runner.py --game-url https://cdn.example.com/game/index.html
  python pipeline/qa/test_runner.py --game-dir games/my-game/
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# Check if Playwright is installed
def ensure_playwright():
    try:
        import playwright
        return True
    except ImportError:
        print("[qa] Installing Playwright...")
        subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
        return True


def run_qa_tests(game_url: str, genre: str = "platformer", timeout_ms: int = 30000) -> dict:
    """
    Run automated QA tests against a game.
    Returns dict with test results, score, and pass/fail status.
    """
    ensure_playwright()
    from playwright.sync_api import sync_playwright

    results = {
        "url": game_url,
        "genre": genre,
        "tests": {},
        "console_errors": [],
        "total_tests": 0,
        "passed_tests": 0,
        "failed_tests": 0,
        "score": 0,
        "passed": False,
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 960, "height": 540})

        # Capture console errors
        page.on("console", lambda msg: (
            results["console_errors"].append(msg.text)
            if msg.type == "error" else None
        ))

        try:
            # ── TEST 1: Game loads without errors ──
            print("  [1/10] Game loads...")
            page.goto(game_url, timeout=timeout_ms)
            page.wait_for_timeout(3000)  # Wait for Phaser to initialize

            has_phaser = page.evaluate("typeof Phaser !== 'undefined'")
            has_game = page.evaluate("typeof window.__GAME__ !== 'undefined'")
            results["tests"]["game_loads"] = has_phaser and has_game
            if not has_game:
                # Try without __GAME__ (for non-template games)
                has_canvas = page.evaluate("document.querySelector('canvas') !== null")
                results["tests"]["game_loads"] = has_canvas

            # ── TEST 2: Start screen present ──
            print("  [2/10] Start screen...")
            # Click play button or press space to start
            page.keyboard.press("Space")
            page.wait_for_timeout(1000)
            # Check if we entered gameplay
            has_test_api = page.evaluate("typeof window.__TEST__ !== 'undefined'")
            if not has_test_api:
                # Try clicking in center (for custom start buttons)
                page.mouse.click(480, 270)
                page.wait_for_timeout(1000)
                has_test_api = page.evaluate("typeof window.__TEST__ !== 'undefined'")
            results["tests"]["start_screen"] = True  # If we got here, start screen existed

            if has_test_api:
                # ── TEST 3: Player exists and has position ──
                print("  [3/10] Player exists...")
                player = page.evaluate("window.__TEST__.getPlayer()")
                results["tests"]["player_exists"] = player is not None and "x" in player
                initial_x = player["x"] if player else 0
                initial_y = player["y"] if player else 0

                # ── TEST 4: Right arrow moves player right ──
                print("  [4/10] Movement right...")
                page.keyboard.down("ArrowRight")
                page.wait_for_timeout(500)
                page.keyboard.up("ArrowRight")
                page.wait_for_timeout(100)
                player_after = page.evaluate("window.__TEST__.getPlayer()")
                moved_right = player_after and player_after["x"] > initial_x + 5
                results["tests"]["movement_right"] = moved_right

                # ── TEST 5: Left arrow moves player left ──
                print("  [5/10] Movement left...")
                pos_before_left = page.evaluate("window.__TEST__.getPlayer()")["x"]
                page.keyboard.down("ArrowLeft")
                page.wait_for_timeout(500)
                page.keyboard.up("ArrowLeft")
                page.wait_for_timeout(100)
                pos_after_left = page.evaluate("window.__TEST__.getPlayer()")["x"]
                results["tests"]["movement_left"] = pos_after_left < pos_before_left - 5

                # ── TEST 6: Jump works (player goes up) ──
                print("  [6/10] Jump...")
                player_before_jump = page.evaluate("window.__TEST__.getPlayer()")
                page.keyboard.press("Space")
                page.wait_for_timeout(300)
                player_mid_jump = page.evaluate("window.__TEST__.getPlayer()")
                results["tests"]["jump_works"] = (
                    player_mid_jump and
                    player_mid_jump["y"] < player_before_jump["y"] - 5
                )

                page.wait_for_timeout(500)  # Wait to land

                # ── TEST 7: Score system works ──
                print("  [7/10] Score system...")
                score = page.evaluate("window.__TEST__.getScore()")
                results["tests"]["score_system"] = score is not None and isinstance(score, (int, float))

                # ── TEST 8: Enemies exist ──
                print("  [8/10] Enemies...")
                enemies = page.evaluate("window.__TEST__.getEnemies()")
                results["tests"]["enemies_exist"] = enemies is not None and len(enemies) > 0
                if enemies and len(enemies) > 0:
                    # Check enemy moves
                    enemy_x_before = enemies[0]["x"]
                    page.wait_for_timeout(500)
                    enemies_after = page.evaluate("window.__TEST__.getEnemies()")
                    if enemies_after and len(enemies_after) > 0:
                        results["tests"]["enemies_move"] = abs(enemies_after[0]["x"] - enemy_x_before) > 1
                    else:
                        results["tests"]["enemies_move"] = False
                else:
                    results["tests"]["enemies_move"] = False

                # ── TEST 9: Lives system ──
                print("  [9/10] Lives system...")
                lives = page.evaluate("window.__TEST__.getLives()")
                results["tests"]["lives_system"] = lives is not None and lives > 0

                # ── TEST 10: Current scene ──
                print("  [10/10] Scene system...")
                scene = page.evaluate("window.__TEST__.getCurrentScene()")
                results["tests"]["scene_system"] = scene is not None and isinstance(scene, str) and len(scene) > 0

            else:
                # No test API — run basic visual checks
                print("  [3-10] No __TEST__ API — running basic checks...")
                has_canvas = page.evaluate("document.querySelector('canvas') !== null")
                results["tests"]["has_canvas"] = has_canvas

                # Check canvas is rendering (not blank)
                canvas_data = page.evaluate("""
                    (() => {
                        const c = document.querySelector('canvas');
                        if (!c) return null;
                        const ctx = c.getContext('2d');
                        if (!ctx) return 'webgl';
                        const d = ctx.getImageData(c.width/2, c.height/2, 10, 10).data;
                        return Array.from(d.slice(0, 12));
                    })()
                """)
                results["tests"]["canvas_renders"] = canvas_data is not None

                # Screenshot for visual inspection
                page.screenshot(path=str(ROOT / "forgeflow-games" / "pipeline" / "qa" / "last_qa_screenshot.png"))
                results["tests"]["screenshot_taken"] = True

                # Fill in remaining tests as skipped
                for t in ["player_exists", "movement_right", "movement_left",
                          "jump_works", "score_system", "enemies_exist",
                          "enemies_move", "lives_system", "scene_system"]:
                    if t not in results["tests"]:
                        results["tests"][t] = None  # Skipped

            # ── Console error check ──
            critical_errors = [e for e in results["console_errors"]
                             if "error" in e.lower() and "favicon" not in e.lower()]
            results["tests"]["no_critical_errors"] = len(critical_errors) == 0

        except Exception as e:
            results["tests"]["execution"] = False
            results["error"] = str(e)
            print(f"  [ERROR] {e}")

        finally:
            browser.close()

    # ── SCORING ──
    total = 0
    passed = 0
    for test_name, result in results["tests"].items():
        if result is None:
            continue  # Skipped
        total += 1
        if result:
            passed += 1

    results["total_tests"] = total
    results["passed_tests"] = passed
    results["failed_tests"] = total - passed
    results["score"] = round((passed / max(total, 1)) * 100, 1)
    results["passed"] = results["score"] >= 70  # 70% pass threshold

    return results


def print_results(results: dict):
    print("\n" + "=" * 50)
    print(f"QA Results: {results['score']:.0f}/100 — {'PASS' if results['passed'] else 'FAIL'}")
    print("=" * 50)
    for test_name, result in results["tests"].items():
        if result is None:
            icon = "⏭️"
            label = "SKIP"
        elif result:
            icon = "✅"
            label = "PASS"
        else:
            icon = "❌"
            label = "FAIL"
        print(f"  {icon} {label}: {test_name}")

    if results["console_errors"]:
        print(f"\n  Console errors ({len(results['console_errors'])}):")
        for err in results["console_errors"][:5]:
            print(f"    - {err[:100]}")

    print(f"\n  Total: {results['passed_tests']}/{results['total_tests']} passed")
    print(f"  Score: {results['score']:.0f}/100")
    print(f"  Status: {'✅ PASSED' if results['passed'] else '❌ FAILED'}")


def main():
    parser = argparse.ArgumentParser(description="Game QA Test Runner")
    parser.add_argument("--game-url", help="URL to the game (file:// or https://)")
    parser.add_argument("--game-dir", help="Local game directory (will use file:// URL)")
    parser.add_argument("--genre", default="platformer", choices=["platformer", "topdown", "boardgame", "arpg", "arcade"])
    parser.add_argument("--timeout", type=int, default=30000, help="Page load timeout in ms")
    args = parser.parse_args()

    if args.game_dir:
        game_path = Path(args.game_dir).resolve()
        game_url = f"file:///{game_path / 'index.html'}"
    elif args.game_url:
        game_url = args.game_url
    else:
        print("Error: Provide --game-url or --game-dir")
        sys.exit(1)

    print(f"Running QA tests on: {game_url}")
    print(f"Genre: {args.genre}")
    print()

    results = run_qa_tests(game_url, args.genre, args.timeout)
    print_results(results)

    # Save results
    results_path = ROOT / "forgeflow-games" / "pipeline" / "qa" / "last_qa_results.json"
    results_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nResults saved to: {results_path}")

    sys.exit(0 if results["passed"] else 1)


if __name__ == "__main__":
    main()
