#!/usr/bin/env python3
"""
audio_bot.py — L3f: audio playback verification.

The L1 "sound_initialized" test only checks `this.sound` exists. It does NOT
verify any audio actually plays during gameplay. AAA games have functional
SFX + music; this bot catches games where the audio API initialized but
no sounds ever fire (silent game).

Method:
  1. Boot game, dismiss menu, enter Game scene
  2. Wrap Phaser's sound.play to count calls per sound key
  3. Run a few seconds of gameplay (random actions to trigger sfx_jump etc.)
  4. Check: did sfx_jump fire? did music_level start? did any sound
     actually play (not just be loaded)?

NOTE: Headless Chromium has no audio output device, so we cannot verify
audio is AUDIBLE — only that the play() API was invoked with valid keys.
That's still 100x better than the current "sound_initialized: true" check
which only verifies the constructor ran.

Usage:
    from audio_bot import run_audio_check
    res = run_audio_check(game_url, time_sec=10)
"""
import argparse
import json
import sys
import time
from pathlib import Path


def run_audio_check(game_url: str, time_sec: int = 10, headless: bool = True) -> dict:
    """Verify audio actually plays during gameplay."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"skipped": "playwright not installed", "verdict": "SKIP"}

    results = {"url": game_url, "verdict": "unknown", "play_calls": {},
               "sounds_loaded": [], "music_played": False, "sfx_played": False}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: None)

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
            page.wait_for_timeout(800)

            # Wrap sound.play to count invocations
            page.evaluate("""() => {
                const game = window.__GAME__;
                if (!game || !game.sound) return;
                window.__SOUND_CALLS__ = {};
                window.__SOUNDS_LOADED__ = [];
                const orig = game.sound.play.bind(game.sound);
                game.sound.play = function(key, opts) {
                    window.__SOUND_CALLS__[key] = (window.__SOUND_CALLS__[key] || 0) + 1;
                    return orig(key, opts);
                };
                // Also enumerate loaded sounds
                if (game.cache && game.cache.audio) {
                    window.__SOUNDS_LOADED__ = game.cache.audio.entries.entries
                        ? Object.keys(game.cache.audio.entries.entries) : [];
                }
            }""")

            # Run random actions to trigger SFX (jump, dash, attack)
            t_end = time.time() + time_sec
            while time.time() < t_end:
                for k in ("Space", "ArrowRight", "Shift", "X", "Z"):
                    try: page.keyboard.press(k)
                    except Exception: pass
                    page.wait_for_timeout(200)

            # Read the call counts
            results["play_calls"] = page.evaluate("() => window.__SOUND_CALLS__ || {}")
            results["sounds_loaded"] = page.evaluate("() => window.__SOUNDS_LOADED__ || []")
        except Exception as e:
            results["error"] = str(e)[:200]
        finally:
            browser.close()

    # Categorize
    music_keys = [k for k in results["play_calls"].keys() if "music" in k.lower()]
    sfx_keys = [k for k in results["play_calls"].keys() if "sfx" in k.lower() or
                k in ("jump", "land", "death", "coin", "hit")]
    results["music_played"] = bool(music_keys)
    results["sfx_played"] = bool(sfx_keys) or bool(any(k for k in results["play_calls"]
                                                         if "music" not in k.lower()))
    total_calls = sum(results["play_calls"].values())
    results["total_play_calls"] = total_calls

    # Verdict — pass if any audio actually fired (>= 1 sfx call)
    # AAA standard would also require music; we relax that since music is
    # often gated on a user interaction in modern browsers' autoplay policy.
    results["verdict"] = "PASS" if total_calls >= 1 else "FAIL"
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--time", type=int, default=10)
    args = ap.parse_args()
    res = run_audio_check(args.url, time_sec=args.time)
    print(json.dumps(res, indent=2)[:2000])
    sys.exit(0 if res.get("verdict") == "PASS" else 1)


if __name__ == "__main__":
    main()
