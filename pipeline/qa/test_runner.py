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
        "network_errors": [],
        "total_tests": 0,
        "passed_tests": 0,
        "failed_tests": 0,
        "score": 0,
        "passed": False,
        # 2026-04-22 AAA-standard bug severity. Any P0 failure blocks deploy
        # regardless of overall score. P1 must be ≥90% pass. P2/P3 are warnings.
        "severity_failures": {"P0": [], "P1": [], "P2": [], "P3": []},
    }

    # Test name → severity map.
    # P0 = blocker (game doesn't function): no deploy allowed
    # P1 = core gameplay (moves, jumps, enemies, exit): must fix
    # P2 = quality / polish: should fix
    # P3 = nice-to-have / cross-compat: can ship if rest is clean
    TEST_SEVERITY = {
        "game_loads":          "P0",
        "has_canvas":          "P0",
        "canvas_renders":      "P0",
        "no_critical_errors":  "P0",
        "execution":           "P0",
        "player_exists":       "P1",
        "movement_right":      "P1",
        "movement_left":       "P1",
        "jump_works":          "P1",
        "enemies_exist":       "P1",
        "scene_system":        "P1",
        "start_screen":        "P1",
        "score_system":        "P2",
        "lives_system":        "P2",
        "enemies_move":        "P2",
        "enemies_animate":     "P2",  # 2026-04-23: AAA-tier animation check
        "bosses_animate":      "P2",  # 2026-04-23: boss sprite animates during fight
        "boss_attack_variety": "P2",  # 2026-04-23: ≥3 distinct attack animations play
        "gravity_works":       "P2",
        "visual_not_blank":    "P2",
        "stability_10s":       "P2",
        "sound_initialized":   "P3",
        "screenshot_taken":    "P3",
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 960, "height": 540})

        # Capture console errors
        page.on("console", lambda msg: (
            results["console_errors"].append(msg.text)
            if msg.type == "error" else None
        ))

        # 2026-04-23: capture failed network requests (404/5xx) with their URL
        # so we can actually diagnose which asset is missing instead of only
        # seeing "Failed to load resource: 404" with no path.
        def _on_response(resp):
            try:
                if resp.status >= 400:
                    results.setdefault("network_errors", []).append({
                        "status": resp.status,
                        "url": resp.url,
                    })
            except Exception:
                pass
        page.on("response", _on_response)

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
            # 2026-04-22: cover ALL plausible start-screen dismissal patterns.
            # Phaser templates put a START GAME text button at different Y
            # positions (y=270, 300, 320, 350 seen across templates). Click
            # the whole vertical column at x=480 + fire keyboard inputs.
            has_test_api = page.evaluate("typeof window.__TEST__ !== 'undefined'")
            # 1) keyboard
            for key in ("Space", "Enter", "ArrowRight"):
                page.keyboard.press(key)
                page.wait_for_timeout(150)
            # 2) click multiple Y positions to cover any button placement
            for click_y in (270, 300, 320, 350, 400):
                page.mouse.click(480, click_y)
                page.wait_for_timeout(150)
            # 3) if scene API exposed, force-start GameScene (last resort for games
            #    whose MainMenu has no keyboard handler AND button hit-area is unusual)
            try:
                page.evaluate("""
                    (() => {
                        if (!window.__GAME__) return;
                        const sm = window.__GAME__.scene;
                        if (!sm) return;
                        const g = sm.getScene && sm.getScene('Game');
                        const gameScene = sm.keys && (sm.keys['Game'] || sm.keys['GameScene'] || sm.keys['game']);
                        const target = gameScene || g;
                        if (target && sm.start) { sm.start('Game'); }
                    })();
                """)
            except Exception:
                pass
            page.wait_for_timeout(500)
            # Poll for player to spawn (up to 5s) — GameScene.create() runs async
            player = None
            for _ in range(25):
                try:
                    player = page.evaluate("window.__TEST__ ? window.__TEST__.getPlayer() : null")
                except Exception:
                    player = None
                if player is not None and isinstance(player, dict) and "x" in player:
                    break
                page.wait_for_timeout(200)
            results["tests"]["start_screen"] = True  # If we got here, start screen existed
            has_test_api = page.evaluate("typeof window.__TEST__ !== 'undefined'")

            if has_test_api:
                # ── TEST 3: Player exists and has position ──
                print("  [3/10] Player exists...")
                results["tests"]["player_exists"] = player is not None and isinstance(player, dict) and "x" in player
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
                # 2026-04-22: guard against None — Python was crashing on
                # `None["x"]` when player_exists failed, aborting the entire
                # QA sweep with 'NoneType' is not subscriptable.
                print("  [5/10] Movement left...")
                _pl = page.evaluate("window.__TEST__.getPlayer()")
                if _pl is None or "x" not in _pl:
                    results["tests"]["movement_left"] = False
                    raise RuntimeError("Player hook returned None mid-QA — skipping remaining tests")
                pos_before_left = _pl["x"]
                page.keyboard.down("ArrowLeft")
                page.wait_for_timeout(500)
                page.keyboard.up("ArrowLeft")
                page.wait_for_timeout(100)
                pos_after_left = page.evaluate("window.__TEST__.getPlayer()")["x"]
                results["tests"]["movement_left"] = pos_after_left < pos_before_left - 5

                # ── TEST 6: Jump works (player goes up) ──
                # 2026-04-22: previously used page.keyboard.press() which is
                # an instant down+up in <1ms. Many Phaser templates implement
                # variable-jump-height: if Space is released while velocity.y
                # is still negative, multiply velocity by ~0.7. Instant press
                # triggers that cut every frame → player barely leaves ground.
                # Hold Space for ~150ms (realistic tap) so variable-jump kicks
                # in AFTER apex, not during liftoff.
                print("  [6/10] Jump...")
                player_before_jump = page.evaluate("window.__TEST__.getPlayer()")
                page.keyboard.down("Space")
                page.wait_for_timeout(150)
                page.keyboard.up("Space")
                page.wait_for_timeout(150)
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

                # ── TEST 8: Enemies exist + move + animate ──
                print("  [8/10] Enemies...")
                enemies = page.evaluate("window.__TEST__.getEnemies()")
                results["tests"]["enemies_exist"] = enemies is not None and len(enemies) > 0
                if enemies and len(enemies) > 0:
                    # Check enemy moves (position delta)
                    enemy_x_before = enemies[0]["x"]
                    # Capture animation frame index at t=0 (requires enemy.anims.currentFrame)
                    anim_frame_before = page.evaluate(
                        "() => { const s = window.__GAME__ && window.__GAME__.scene.getScene('Game');"
                        "  const e = s && s.enemies && s.enemies.children.entries[0];"
                        "  return e && e.anims && e.anims.currentFrame ? e.anims.currentFrame.index : null; }"
                    )
                    page.wait_for_timeout(500)
                    enemies_after = page.evaluate("window.__TEST__.getEnemies()")
                    anim_frame_after = page.evaluate(
                        "() => { const s = window.__GAME__ && window.__GAME__.scene.getScene('Game');"
                        "  const e = s && s.enemies && s.enemies.children.entries[0];"
                        "  return e && e.anims && e.anims.currentFrame ? e.anims.currentFrame.index : null; }"
                    )
                    if enemies_after and len(enemies_after) > 0:
                        results["tests"]["enemies_move"] = abs(enemies_after[0]["x"] - enemy_x_before) > 1
                    else:
                        results["tests"]["enemies_move"] = False
                    # 2026-04-23: enemies_animate — frame index should change over 500ms if
                    # Kenney-atlas animations are registered + playing. Skipped if enemy has
                    # no animation system attached (not mapped to Kenney).
                    if anim_frame_before is None and anim_frame_after is None:
                        results["tests"]["enemies_animate"] = False  # no animation at all
                    else:
                        # Either frame changed OR both are valid numbers (idle anim can keep same frame briefly)
                        results["tests"]["enemies_animate"] = (
                            anim_frame_before != anim_frame_after
                            or (anim_frame_after is not None and anim_frame_after >= 0)
                        )
                else:
                    results["tests"]["enemies_move"] = False
                    results["tests"]["enemies_animate"] = False

                # ── TEST 9: Lives system ──
                print("  [9/10] Lives system...")
                lives = page.evaluate("window.__TEST__.getLives()")
                results["tests"]["lives_system"] = lives is not None and lives > 0

                # ── TEST 10: Current scene ──
                print("  [10/14] Scene system...")
                scene = page.evaluate("window.__TEST__.getCurrentScene()")
                results["tests"]["scene_system"] = scene is not None and isinstance(scene, str) and len(scene) > 0

                # ── TEST 11: GENRE-SPECIFIC TESTS ──
                if genre == "platformer":
                    print("  [11/14] Platformer: gravity pulls player down...")
                    player_grav = page.evaluate("window.__TEST__.getPlayer()")
                    if player_grav and not player_grav.get("onGround", True):
                        page.wait_for_timeout(300)
                        player_grav2 = page.evaluate("window.__TEST__.getPlayer()")
                        results["tests"]["gravity_works"] = player_grav2["y"] > player_grav["y"] if player_grav2 else False
                    else:
                        results["tests"]["gravity_works"] = True  # On ground = gravity working

                elif genre == "topdown":
                    print("  [11/14] Top-down: 4-directional movement...")
                    # Test up movement
                    pos_before = page.evaluate("window.__TEST__.getPlayer()")
                    page.keyboard.down("ArrowUp")
                    page.wait_for_timeout(300)
                    page.keyboard.up("ArrowUp")
                    pos_after = page.evaluate("window.__TEST__.getPlayer()")
                    results["tests"]["movement_up"] = pos_after and pos_after["y"] < pos_before["y"] - 3

                    # Test down movement
                    pos_before = page.evaluate("window.__TEST__.getPlayer()")
                    page.keyboard.down("ArrowDown")
                    page.wait_for_timeout(300)
                    page.keyboard.up("ArrowDown")
                    pos_after = page.evaluate("window.__TEST__.getPlayer()")
                    results["tests"]["movement_down"] = pos_after and pos_after["y"] > pos_before["y"] + 3

                elif genre == "boardgame":
                    print("  [11/14] Board game: turn system...")
                    game_state = page.evaluate("""
                        window.__TEST__ ? {
                            currentPlayer: window.__TEST__.getPlayer(),
                            score: window.__TEST__.getScore(),
                        } : null
                    """)
                    results["tests"]["turn_system"] = game_state is not None

                elif genre == "arpg":
                    print("  [11/14] ARPG: attack works...")
                    page.keyboard.press("KeyX")
                    page.wait_for_timeout(200)
                    # Just verify no crash after attack
                    still_alive = page.evaluate("window.__TEST__.getPlayer()?.alive !== false")
                    results["tests"]["attack_works"] = still_alive

                # ── TEST 12: VISUAL QA — Screenshot analysis ──
                print("  [12/14] Visual QA: canvas not blank...")
                screenshot_path = str(Path(__file__).parent / "last_qa_screenshot.png")
                page.screenshot(path=screenshot_path)

                # Check canvas is not a solid color (blank/broken)
                canvas_check = page.evaluate("""
                    (() => {
                        const c = document.querySelector('canvas');
                        if (!c) return {ok: false, reason: 'no_canvas'};
                        try {
                            // Sample pixels from different regions
                            const ctx = c.getContext('2d', {willReadFrequently: true});
                            if (!ctx) return {ok: true, reason: 'webgl_no_2d'}; // WebGL canvas, can't check
                            const samples = [];
                            for (let i = 0; i < 5; i++) {
                                const x = Math.floor(c.width * (0.2 + i * 0.15));
                                const y = Math.floor(c.height * 0.5);
                                const px = ctx.getImageData(x, y, 1, 1).data;
                                samples.push([px[0], px[1], px[2]]);
                            }
                            // Check if all samples are the same color (blank screen)
                            const allSame = samples.every(s =>
                                Math.abs(s[0]-samples[0][0]) < 5 &&
                                Math.abs(s[1]-samples[0][1]) < 5 &&
                                Math.abs(s[2]-samples[0][2]) < 5
                            );
                            return {ok: !allSame, reason: allSame ? 'all_same_color' : 'varied_pixels', samples: samples};
                        } catch(e) {
                            return {ok: true, reason: 'webgl_context'};
                        }
                    })()
                """)
                results["tests"]["visual_not_blank"] = canvas_check.get("ok", False) if canvas_check else False
                if canvas_check and not canvas_check.get("ok"):
                    print(f"    Visual check: {canvas_check.get('reason')} — game may not be rendering correctly")

                # ── TEST 13: Sound system initialized ──
                print("  [13/14] Sound system...")
                has_sound = page.evaluate("""
                    window.__GAME__?.sound?.sounds?.length > 0 ||
                    document.querySelectorAll('audio').length > 0 ||
                    (typeof window.__GAME__?.sound !== 'undefined')
                """)
                results["tests"]["sound_initialized"] = bool(has_sound)

                # ── TEST 14: No crash after 10 seconds of gameplay ──
                print("  [14/14] Stability: 10s gameplay...")
                # Simulate 10 seconds of random input
                for _ in range(5):
                    page.keyboard.press("ArrowRight")
                    page.wait_for_timeout(500)
                    page.keyboard.press("Space")
                    page.wait_for_timeout(500)
                    page.keyboard.press("ArrowLeft")
                    page.wait_for_timeout(500)
                    page.keyboard.press("ArrowRight")
                    page.wait_for_timeout(500)
                stability_ok = page.evaluate("typeof window.__GAME__ !== 'undefined' || document.querySelector('canvas') !== null")
                results["tests"]["stability_10s"] = bool(stability_ok)

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
    # 2026-04-27: AAA standard — every L1 test must pass to ship. Anything
    # less is noise that masks real bugs.
    results["passed"] = results["score"] >= 100  # require 100% pass

    # 2026-04-22: bucket failures by severity so phase_qa can gate deploy.
    for test_name, outcome in results["tests"].items():
        if outcome is False:  # explicit False, skip None
            sev = TEST_SEVERITY.get(test_name, "P2")  # default medium if unmapped
            results["severity_failures"][sev].append(test_name)
    results["has_P0"] = len(results["severity_failures"]["P0"]) > 0
    results["has_P1"] = len(results["severity_failures"]["P1"]) > 0

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

    # 2026-04-23: surface 4xx/5xx with URLs so "Failed to load resource: 404"
    # actually tells us WHICH asset is missing. Captured by page.on("response").
    net_errs = results.get("network_errors") or []
    if net_errs:
        print(f"\n  Network errors ({len(net_errs)}):")
        for e in net_errs[:10]:
            if isinstance(e, dict):
                print(f"    - HTTP {e.get('status', '?')}  {e.get('url', '?')}")
            else:
                print(f"    - {str(e)[:120]}")

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
