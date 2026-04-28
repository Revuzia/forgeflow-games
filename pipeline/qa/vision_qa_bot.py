#!/usr/bin/env python3
"""
vision_qa_bot.py — L8b LLM-vision QA. Uses Claude Opus 4.7 via `claude -p`
(no API key, OAuth-authenticated, ~free per call vs Gemini API).

Distinct from visual_bot.py (L8a):
  - L8a (pixel-bot): cheap heuristics — catches gross failures (blank canvas,
    background overpowering foreground, missing-texture magenta).
  - L8b (vision-bot, this file): aesthetic judgment — catches what only a
    human eye notices: art-direction match, sprite proportions, animation
    quality, set-piece coherence, "would a player think this looks polished".

Why both layers?
  L8a runs every QA pass (free, fast, catches structural visual bugs).
  L8b runs once per game on final pass (catches design-quality bugs).
  Together they cover the "code passes but looks broken" gap that no other
  layer addresses.

Why `claude -p` over Anthropic API?
  - Uses CLAUDE_CODE_OAUTH_TOKEN (no API key in api_config needed)
  - Same Opus 4.7 model as the rest of the pipeline (consistent quality)
  - Same auth as phase_research/design/build/debug — no new credential
  - Reads images via `@filepath` reference — Claude Code's Read tool handles
    multimodal input natively
  - Cost: covered by Claude Code subscription (no per-call API charges)

Usage (as module):
    from vision_qa_bot import run_vision_qa
    res = run_vision_qa(game_url, inspired_by="Donkey Kong Country",
                        screenshot_count=3)

CLI:
    python vision_qa_bot.py --url URL --inspired-by "Donkey Kong Country"
"""
import argparse
import json
import os
import subprocess
import sys
import time
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent.parent.parent  # Claude Claw root
SCREENSHOT_DIR = ROOT / "state" / "vision_qa_screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)


def _capture_screenshots(game_url: str, count: int = 3,
                         slug: str = "game") -> list:
    """Take N screenshots during gameplay, return list of file paths."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return []
    paths = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        try:
            page.goto(game_url, timeout=30000, wait_until="domcontentloaded")
            page.wait_for_function("() => window.__GAME__", timeout=10000)
            # 2026-04-28: WAIT FOR ALL TEXTURES TO LOAD before forcing scene.start.
            # Forcing Game scene before preload completes captured Phaser
            # missing-texture fallback squares (caught by vision_qa_bot 2/10
            # verdict). Real users wait for the menu naturally.
            try:
                page.wait_for_function(
                    "() => window.__GAME__ && window.__GAME__.textures && "
                    "window.__GAME__.textures.list && "
                    "window.__GAME__.textures.list['tiles'] && "
                    "window.__GAME__.textures.list['characters']",
                    timeout=20000)
            except Exception:
                pass
            # Now dismiss menu + start Game (preload finished, textures loaded)
            for k in ("Space", "Enter"):
                page.keyboard.press(k); page.wait_for_timeout(150)
            try:
                page.evaluate("() => window.__GAME__ && window.__GAME__.scene && window.__GAME__.scene.start && window.__GAME__.scene.start('Game')")
            except Exception:
                pass
            try:
                page.wait_for_function("() => window.__TEST__ && window.__TEST__.getPlayer", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(2000)
            ts = int(time.time())
            for i in range(count):
                page.keyboard.down("ArrowRight"); time.sleep(0.4); page.keyboard.up("ArrowRight")
                if i % 2: page.keyboard.press("Space")
                page.wait_for_timeout(400)
                path = SCREENSHOT_DIR / f"{slug}_{ts}_{i+1}.png"
                page.screenshot(path=str(path))
                paths.append(path)
        except Exception:
            pass
        finally:
            browser.close()
    return paths


def _ask_claude_vision(image_paths: list, prompt_text: str,
                       timeout: int = 120) -> dict:
    """Send image references + prompt to `claude -p --model opus`. Returns
    parsed JSON verdict (or {"raw_response": ..., "parse_error": ...}).
    """
    if not image_paths:
        return {"error": "no images to analyze"}
    # Build prompt with @file references for each image
    image_refs = "\n".join(f"  @{p}" for p in image_paths)
    full_prompt = (
        f"{prompt_text}\n\n"
        f"Read these screenshots:\n{image_refs}\n\n"
        f"Return ONLY a single JSON object — no markdown fences, no prose."
    )
    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "opus"],
            input=full_prompt,
            capture_output=True, text=True,
            encoding="utf-8", errors="replace",
            timeout=timeout,
            cwd=str(ROOT),
        )
        if result.returncode != 0:
            return {"error": f"claude -p exit {result.returncode}: {(result.stderr or '')[:200]}"}
        text = result.stdout.strip()
        # Strip code fences if present
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        # Find first { and last } if wrapped in prose
        if not text.startswith("{"):
            i, j = text.find("{"), text.rfind("}")
            if i >= 0 and j > i:
                text = text[i:j+1]
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            return {"raw_response": text[:1500], "parse_error": str(e)}
    except subprocess.TimeoutExpired:
        return {"error": f"claude -p timeout after {timeout}s"}
    except FileNotFoundError:
        return {"error": "claude CLI not on PATH (install Claude Code)"}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}


def run_vision_qa(game_url: str, inspired_by: str = "a polished platformer",
                  screenshot_count: int = 3, slug: str = "game") -> dict:
    """Run visual QA via Claude Opus 4.7 vision. Returns aesthetic verdict.

    Args:
        game_url:           live URL to capture
        inspired_by:        source game name (e.g. "Donkey Kong Country") to
                             anchor aesthetic comparison
        screenshot_count:   how many screenshots to evaluate (default 3)
        slug:               game slug for screenshot filenames

    Returns: {
        "verdict":         "PASS" | "FAIL" | "SKIP",
        "score_0_to_10":   int — overall visual quality
        "playable_view":   bool — was Claude looking at gameplay (not menu)
        "background_visible": bool
        "characters_visible": bool
        "hud_visible":     bool
        "issues":          list of {severity, desc} — high-severity blocks ship
        "strengths":       list of what works
        "summary":         one-sentence overall judgment
        "screenshots_analyzed": list of paths
    }
    """
    paths = _capture_screenshots(game_url, count=screenshot_count, slug=slug)
    if not paths:
        return {"verdict": "SKIP", "skipped": "could not capture screenshots"}

    prompt = (
        f"You are a senior game-design QA reviewer at a AAA studio. The game "
        f"shown is INSPIRED BY '{inspired_by}'. Examine the in-game "
        f"screenshot(s) below and judge visual quality strictly.\n\n"
        f"Return a SINGLE JSON object with this exact shape:\n"
        f'{{\n'
        f'  "score_0_to_10": <int>,        // overall AAA visual quality\n'
        f'  "verdict": "PASS"|"FAIL",       // PASS only if score >= 6 AND no high-severity issues\n'
        f'  "playable_view": <bool>,        // are screenshots showing gameplay (not menu)?\n'
        f'  "background_visible": <bool>,   // is there a coherent themed background\n'
        f'  "characters_visible": <bool>,   // are player/enemy sprites distinct + correctly proportioned\n'
        f'  "hud_visible": <bool>,          // is HUD (score/lives/level) readable\n'
        f'  "art_matches_inspiration": <bool>,  // does art direction resemble the inspired_by source\n'
        f'  "issues": [\n'
        f'    {{"severity":"high|medium|low","desc":"<specific visual issue>"}}\n'
        f'  ],\n'
        f'  "strengths": ["<what works visually>"],\n'
        f'  "summary": "<one sentence overall judgment>"\n'
        f'}}\n\n'
        f"BE STRICT. Examples of issues to flag:\n"
        f"  - HIGH: tile-pattern overpowering foreground, blank canvas, "
        f"sprites missing, magenta missing-texture color\n"
        f"  - MEDIUM: wrong sprite proportions, animations stiff, background "
        f"doesn't match level theme, parallax broken\n"
        f"  - LOW: minor polish gaps, font choice, UI layout\n"
        f"Score 5 = programmer-art prototype. Score 7+ requires real polish. "
        f"Score 9-10 only for genuinely AAA-quality visuals."
    )

    verdict = _ask_claude_vision(paths, prompt)
    verdict["screenshots_analyzed"] = [str(p) for p in paths]
    verdict["url"] = game_url
    verdict["inspired_by"] = inspired_by

    # Normalize verdict if Claude returned non-PASS/FAIL
    v = verdict.get("verdict")
    score = verdict.get("score_0_to_10")
    if "error" in verdict or "parse_error" in verdict:
        verdict["verdict"] = "SKIP"
    elif v not in ("PASS", "FAIL", "SKIP"):
        # Derive from score
        if isinstance(score, (int, float)) and score >= 6:
            high_severity = sum(1 for i in (verdict.get("issues") or [])
                                if isinstance(i, dict) and i.get("severity") == "high")
            verdict["verdict"] = "PASS" if high_severity == 0 else "FAIL"
        else:
            verdict["verdict"] = "FAIL"
    return verdict


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--inspired-by", default="a polished platformer")
    ap.add_argument("--screenshots", type=int, default=3)
    ap.add_argument("--slug", default="game")
    args = ap.parse_args()
    res = run_vision_qa(args.url, inspired_by=args.inspired_by,
                        screenshot_count=args.screenshots, slug=args.slug)
    print(json.dumps(res, indent=2)[:3000])
    sys.exit(0 if res.get("verdict") in ("PASS", "SKIP") else 1)


if __name__ == "__main__":
    main()
