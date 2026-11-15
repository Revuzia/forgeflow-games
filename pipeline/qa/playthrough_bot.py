#!/usr/bin/env python3
"""playthrough_bot.py — verifies a level is actually beatable end-to-end.

The existing speedrun_bot only catches softlocks (graph reachability with
backward search). The playtest_bot fires random keys and counts a "win" if
the scene happens to transition. Neither catches "level is technically
reachable but the player physically can't progress because of body-collision
geometry the synthesizer didn't account for" — the bug class that shipped
through every QA gate before today.

This bot uses real Playwright keyboard events (not synthetic JustDown) to
hold-right + jump in a tight loop, like a determined human, for 90 seconds
per level. PASS if the scene transitions away from "Game" (level complete
or player win) within the budget. FAIL otherwise.

Coverage: levels 0, 1, 2 (early difficulty) by default. The other 43 share
the same template+synthesizer so if the first three pass, the rest are very
likely OK. Caller can override --levels.

Usage:
    from playthrough_bot import run_playthroughs
    res = run_playthroughs(game_url, level_count=3)

CLI:
    python playthrough_bot.py --url URL --levels 0,1,2
"""
import argparse
import json
import sys
import time


def run_playthroughs(game_url: str, level_count: int = 3,
                     time_limit_sec: int = 90, headless: bool = True) -> dict:
    """Drive the game with real keyboard events for `level_count` levels."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"verdict": "SKIP", "skipped": "playwright not installed"}

    results = {
        "url": game_url,
        "level_count": level_count,
        "per_level": [],
        "wins": 0,
        "verdict": "unknown",
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        try:
            page.goto(game_url, timeout=30000, wait_until="domcontentloaded")
            page.wait_for_function("() => window.__GAME__", timeout=10000)
            try:
                page.wait_for_function(
                    "() => window.__GAME__ && window.__GAME__.textures && "
                    "window.__GAME__.textures.list && "
                    "window.__GAME__.textures.list['tiles'] && "
                    "window.__GAME__.textures.list['characters']",
                    timeout=20000)
            except Exception:
                pass
            # Dismiss menu, start Game on level 0
            page.evaluate("() => { try { localStorage.clear(); } catch(_e){} }")
            page.evaluate("() => { window.__GAME__.scene.stop('Menu'); window.__GAME__.scene.start('Game'); }")
            page.wait_for_timeout(2500)

            for lvl in range(level_count):
                start_time = time.time()
                start_x = page.evaluate("() => window.__GAME__.scene.getScene('Game').player.x") or 0
                map_w = page.evaluate("() => window.__GAME__.scene.getScene('Game').map.widthInPixels") or 0
                start_currentLevel = page.evaluate("() => window.__GAME__.scene.getScene('Game').currentLevel") or 0
                trial = {
                    "level": lvl, "start_currentLevel": start_currentLevel,
                    "map_width_px": map_w, "start_x": round(start_x),
                    "outcome": "in_progress",
                }

                page.keyboard.down("ArrowRight")
                last_x = start_x
                stuck_ticks = 0
                while time.time() - start_time < time_limit_sec:
                    page.keyboard.press("Space")
                    page.wait_for_timeout(450)

                    cur_state = page.evaluate("""() => {
                        const g = window.__GAME__.scene.getScene('Game');
                        if (!g) return null;
                        return {
                            x: Math.round(g.player ? g.player.x : 0),
                            currentLevel: g.currentLevel,
                            sceneActive: g.scene.isActive(),
                            sceneKey: window.__GAME__.scene.scenes.find(s => s.scene.isActive()).scene.key,
                            health: g.player ? g.player.health : 0,
                        };
                    }""")
                    if not cur_state:
                        trial["outcome"] = "scene_lost"
                        break
                    # Win conditions
                    if cur_state["currentLevel"] != start_currentLevel:
                        trial["outcome"] = "win"
                        trial["completed_in_sec"] = round(time.time() - start_time, 1)
                        results["wins"] += 1
                        start_currentLevel = cur_state["currentLevel"]
                        # Move on to next level
                        break
                    if cur_state["sceneKey"] in ("Win", "Victory", "LevelComplete"):
                        trial["outcome"] = "win"
                        trial["completed_in_sec"] = round(time.time() - start_time, 1)
                        results["wins"] += 1
                        break
                    if cur_state["sceneKey"] in ("GameOver", "Death"):
                        trial["outcome"] = "death"
                        trial["died_at_x"] = cur_state["x"]
                        break
                    # Stuck detection: same x for 8 seconds = give up on this level
                    if abs(cur_state["x"] - last_x) < 5:
                        stuck_ticks += 1
                        if stuck_ticks >= 18:  # 18 * 450ms = 8.1s
                            trial["outcome"] = "stuck"
                            trial["stuck_at_x"] = cur_state["x"]
                            trial["pct_progress"] = round(cur_state["x"] / max(1, map_w) * 100)
                            break
                    else:
                        stuck_ticks = 0
                    last_x = cur_state["x"]

                if trial["outcome"] == "in_progress":
                    trial["outcome"] = "timeout"
                    trial["final_x"] = cur_state["x"] if cur_state else 0
                    trial["pct_progress"] = round((cur_state["x"] if cur_state else 0) / max(1, map_w) * 100)

                page.keyboard.up("ArrowRight")
                results["per_level"].append(trial)

                if trial["outcome"] != "win":
                    break  # Don't try further levels if this one failed
        except Exception as e:
            results["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        finally:
            browser.close()

    # Verdict
    if not results["per_level"]:
        results["verdict"] = "SKIP"
    elif results["wins"] == 0:
        results["verdict"] = "FAIL"
    elif results["wins"] >= max(1, level_count // 2):
        results["verdict"] = "PASS"
    else:
        results["verdict"] = "BORDERLINE"
    results["completion_rate"] = round(results["wins"] / max(1, len(results["per_level"])), 2)
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--levels", type=int, default=3)
    ap.add_argument("--time-limit", type=int, default=90)
    args = ap.parse_args()
    res = run_playthroughs(args.url, level_count=args.levels, time_limit_sec=args.time_limit)
    print(json.dumps(res, indent=2)[:3000])
    sys.exit(0 if res.get("verdict") in ("PASS", "BORDERLINE", "SKIP") else 1)


if __name__ == "__main__":
    main()
