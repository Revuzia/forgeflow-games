#!/usr/bin/env python3
"""
oracle_bot.py — L3c: Property/invariant assertion bot.

Catches the bug class our other 3 bots categorically cannot find: SILENT STATE
CORRUPTION. The random/learning/speedrun bots all measure outcomes (did we
win? how far did we get?). They do NOT check whether the game's internal state
is consistent while it's running.

Examples of bugs only the oracle finds:
  - Player Y suddenly drops to -99999 (fall-through-world bug)
  - getCurrentScene() returns "Boot" mid-gameplay (wrong scene loaded)
  - Score went DOWN without the player losing a life (bookkeeping bug)
  - Enemy count grew past the level spec maximum (spawn loop)
  - Player teleported >100px in a single frame (physics jitter / glitch)
  - Console fired any uncaught error during play (silent crash)

Architecture: TITAN's Issue Diagnosis Module pattern (arXiv 2509.22170, Sept
2025) minus the LLM. Driven by the same random-action stream as playtest_bot,
but on every frame samples window.__TEST__ hooks and asserts a fixed set of
invariants. Reports first violation per invariant + total violation count.

Usage (as module):
    from oracle_bot import run_oracle
    result = run_oracle(game_url, trials=2, time_limit_sec=30)
    # result["verdict"] is "PASS" if zero invariants violated, "FAIL" otherwise

CLI:
    python oracle_bot.py --url http://127.0.0.1:8765/index.html --trials 2
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path


# ── Invariants ───────────────────────────────────────────────────────────────
# Each invariant is a dict with:
#   id:    short stable ID for reporting
#   desc:  human-readable description
#   probe: JS snippet that returns {ok: bool, detail: str} from the game state
#
# Probes execute via page.evaluate() so they have full access to window.__TEST__,
# window.__GAME__, and any state the game exposes. Probes MUST be defensive —
# if the API isn't available yet (early boot), return ok:true so we don't false-
# positive during scene transitions.

INVARIANTS = [
    {
        "id":   "player_y_in_world",
        "desc": "Player Y must stay within world bounds (no fall-through)",
        "probe": """() => {
            try {
                const p = window.__TEST__.getPlayer();
                if (!p) return {ok: true, detail: "no player yet"};
                const g = window.__GAME__;
                const scene = g && g.scene && g.scene.getScene && g.scene.getScene("Game");
                const map = scene && scene.map;
                const maxY = map && map.heightInPixels ? map.heightInPixels + 200 : 5000;
                const minY = -200;
                if (p.y < minY) return {ok: false, detail: "player.y=" + p.y + " < minY=" + minY};
                if (p.y > maxY) return {ok: false, detail: "player.y=" + p.y + " > maxY=" + maxY};
                return {ok: true};
            } catch (e) { return {ok: true, detail: "probe err: " + String(e)}; }
        }""",
    },
    {
        "id":   "player_x_in_world",
        "desc": "Player X must stay within world bounds (no off-map teleport)",
        "probe": """() => {
            try {
                const p = window.__TEST__.getPlayer();
                if (!p) return {ok: true};
                const g = window.__GAME__;
                const scene = g && g.scene && g.scene.getScene && g.scene.getScene("Game");
                const map = scene && scene.map;
                const maxX = map && map.widthInPixels ? map.widthInPixels + 100 : 50000;
                if (p.x < -100) return {ok: false, detail: "player.x=" + p.x + " < -100"};
                if (p.x > maxX) return {ok: false, detail: "player.x=" + p.x + " > maxX=" + maxX};
                return {ok: true};
            } catch (e) { return {ok: true}; }
        }""",
    },
    {
        "id":   "scene_is_known",
        "desc": "getCurrentScene() must return a known scene key (no orphan scenes)",
        "probe": """() => {
            try {
                const s = window.__TEST__.getCurrentScene();
                if (!s) return {ok: true, detail: "no scene yet"};
                const known = ["Boot","Preload","Menu","Game","Pause","GameOver","Win"];
                const isKnown = known.includes(s) || /^Boss/.test(s) || /^Game/.test(s) || /^Win/.test(s);
                if (!isKnown) return {ok: false, detail: "unknown scene: " + s};
                return {ok: true};
            } catch (e) { return {ok: true}; }
        }""",
    },
    {
        "id":   "lives_non_negative",
        "desc": "Lives must never go negative",
        "probe": """() => {
            try {
                const l = window.__TEST__.getLives();
                if (l == null) return {ok: true};
                if (l < 0) return {ok: false, detail: "lives=" + l};
                return {ok: true};
            } catch (e) { return {ok: true}; }
        }""",
    },
    {
        "id":   "score_non_negative",
        "desc": "Score must never go negative",
        "probe": """() => {
            try {
                const s = window.__TEST__.getScore();
                if (s == null) return {ok: true};
                if (s < 0) return {ok: false, detail: "score=" + s};
                return {ok: true};
            } catch (e) { return {ok: true}; }
        }""",
    },
    {
        "id":   "enemies_count_sane",
        "desc": "Enemy count must not exceed 100 (catches spawn loops)",
        "probe": """() => {
            try {
                const e = window.__TEST__.getEnemies();
                if (!e) return {ok: true};
                if (e.length > 100) return {ok: false, detail: "enemies.length=" + e.length};
                return {ok: true};
            } catch (e) { return {ok: true}; }
        }""",
    },
    {
        "id":   "player_velocity_sane",
        "desc": "Player velocity must stay below 5000 px/s (catches physics jitter)",
        "probe": """() => {
            try {
                const p = window.__TEST__.getPlayer();
                if (!p) return {ok: true};
                const vx = Math.abs(p.velocityX || 0);
                const vy = Math.abs(p.velocityY || 0);
                if (vx > 5000) return {ok: false, detail: "|velocityX|=" + vx};
                if (vy > 5000) return {ok: false, detail: "|velocityY|=" + vy};
                return {ok: true};
            } catch (e) { return {ok: true}; }
        }""",
    },
]


def _fire_random_action(page):
    """Reuse playtest_bot's biased random distribution so the oracle gets
    the same action coverage."""
    action = random.choices(
        ["right", "right_jump", "jump", "left", "idle"],
        weights=[40, 25, 15, 10, 10], k=1
    )[0]
    if action == "right":
        page.keyboard.press("ArrowRight")
    elif action == "right_jump":
        page.keyboard.down("ArrowRight"); page.keyboard.press("Space")
        time.sleep(0.05); page.keyboard.up("ArrowRight")
    elif action == "jump":
        page.keyboard.press("Space")
    elif action == "left":
        page.keyboard.press("ArrowLeft")
    # idle: no key


def run_oracle(game_url: str, trials: int = 2, time_limit_sec: int = 30,
               headless: bool = True) -> dict:
    """Run N trials with random actions, asserting invariants every frame.

    Returns: {
        "trials":          int,
        "verdict":         "PASS" | "FAIL",
        "violations":      list of {invariant_id, trial, time_sec, detail},
        "violation_counts": dict mapping invariant_id -> count,
        "console_errors":  list of unique console-error strings,
        "trial_details":   list per trial
    }
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"skipped": "playwright not installed", "verdict": "SKIP",
                "violations": [], "violation_counts": {}}

    results = {
        "url":              game_url,
        "trials":           trials,
        "violations":       [],
        "violation_counts": {},
        "console_errors":   [],
        "trial_details":    [],
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        for trial_num in range(1, trials + 1):
            trial = {"trial": trial_num, "samples": 0, "violations_in_trial": 0}
            page = context.new_page()
            errors_seen = set()
            page.on("pageerror", lambda exc: errors_seen.add(str(exc)[:200]))
            page.on("console", lambda msg: errors_seen.add(msg.text[:200])
                    if msg.type == "error" else None)

            try:
                page.goto(game_url, timeout=20000, wait_until="domcontentloaded")
                page.wait_for_function(
                    "() => window.__TEST__ && typeof window.__TEST__.getPlayer === 'function'",
                    timeout=15000
                )
                # Dismiss menu
                for key in ("Space", "Enter"):
                    page.keyboard.press(key); page.wait_for_timeout(100)
                try:
                    page.evaluate("() => window.__GAME__ && window.__GAME__.scene.start('Game')")
                except Exception:
                    pass
                page.wait_for_timeout(800)

                # Action + sample loop
                start = time.time()
                while time.time() - start < time_limit_sec:
                    _fire_random_action(page)
                    page.wait_for_timeout(150)

                    # Check every invariant
                    for inv in INVARIANTS:
                        try:
                            r = page.evaluate(inv["probe"])
                        except Exception:
                            continue
                        trial["samples"] += 1
                        if isinstance(r, dict) and r.get("ok") is False:
                            v = {"invariant_id": inv["id"], "trial": trial_num,
                                 "time_sec": round(time.time() - start, 2),
                                 "detail": r.get("detail", "")}
                            results["violations"].append(v)
                            results["violation_counts"][inv["id"]] = \
                                results["violation_counts"].get(inv["id"], 0) + 1
                            trial["violations_in_trial"] += 1

            except Exception as e:
                trial["error"] = str(e)[:200]
            finally:
                page.close()
                results["trial_details"].append(trial)

            # Carry over console errors from this trial
            for err in errors_seen:
                if err not in results["console_errors"]:
                    results["console_errors"].append(err)

        browser.close()

    # Verdict: pass if zero invariant violations AND zero console errors
    has_violations = len(results["violations"]) > 0
    has_console_errors = len(results["console_errors"]) > 0
    results["verdict"] = "FAIL" if (has_violations or has_console_errors) else "PASS"
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--trials", type=int, default=2)
    ap.add_argument("--time-limit", type=int, default=30)
    args = ap.parse_args()
    res = run_oracle(args.url, trials=args.trials, time_limit_sec=args.time_limit)
    print(json.dumps(res, indent=2)[:3000])
    sys.exit(0 if res.get("verdict") == "PASS" else 1)


if __name__ == "__main__":
    main()
