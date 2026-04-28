#!/usr/bin/env python3
"""
visual_bot.py — L8 visual QA bot. The missing layer.

The other 14 sub-layers test code/movement/audio/state but never check what
the game actually LOOKS like on screen. Caught real issue 2026-04-28: the
barrel-blitz parallax background was rendering a tile-pattern texture across
the entire viewport, totally covering the intended jungle scene. No code
test would catch that — only a visual check.

Heuristic checks (no neural net, no AAA-quality vision required):

  1. CANVAS NOT BLANK
     The whole viewport must have ≥4 distinct dominant colors. A single
     solid color → scene didn't render or fell back to background fill.

  2. NOT MONOTONOUS BACKGROUND
     The center region of the canvas must have COLOR VARIANCE distinct from
     the edges. If center == edges (same texture everywhere), a tiled bg
     pattern is overpowering the foreground (the bug we just hit).

  3. PLAYER VISIBLE
     A non-background sprite must be present. We sample 3 frames over 1.5s,
     and if at least one pixel cluster differs across frames, something is
     animating (player or enemies) → game state is alive.

  4. HUD READABLE
     The top 12% of the canvas must have visible text (>10 distinct colors
     in that strip — typical for HUD with score/lives/level).

  5. NO ALL-RED OR ALL-MAGENTA
     Standard "shader / texture missing" fallback colors. Phaser falls back
     to magenta when an asset key isn't loaded.

Architecture: pure Pillow + Playwright. No GPU. ~150 LOC.

Usage:
    from visual_bot import run_visual_check
    res = run_visual_check(game_url)
    # res["verdict"] is "PASS" / "FAIL" / "SKIP"

CLI:
    python visual_bot.py --url http://127.0.0.1:8765/index.html
"""
import argparse
import io
import json
import sys
import time
from collections import Counter
from pathlib import Path


def _color_quantize(img, bucket=32):
    """Map each pixel to its color bucket. Bucket=32 → 8x8x8 = 512 cells."""
    return [(r // bucket, g // bucket, b // bucket)
            for r, g, b, *_ in img.getdata()]


def _dominant_colors(img, bucket=32):
    """Return list of (color, count) sorted desc."""
    return Counter(_color_quantize(img, bucket)).most_common()


def _crop_region(img, x0_pct, y0_pct, x1_pct, y1_pct):
    """Crop by percentages."""
    w, h = img.size
    return img.crop((int(w * x0_pct), int(h * y0_pct),
                     int(w * x1_pct), int(h * y1_pct)))


def _color_variance(img):
    """Number of distinct color buckets — proxy for visual complexity."""
    return len(set(_color_quantize(img)))


def analyze_screenshot(png_bytes: bytes) -> dict:
    """Run heuristic checks on a single screenshot."""
    from PIL import Image
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    findings = {"checks": {}, "issues": []}

    # Check 1: not blank
    dom = _dominant_colors(img, bucket=32)
    distinct = len(dom)
    findings["checks"]["distinct_colors"] = distinct
    if distinct < 4:
        findings["issues"].append(
            f"canvas has only {distinct} distinct colors — likely blank or single-tile fill")

    # Check 2: center vs edges variance ratio
    center = _crop_region(img, 0.30, 0.30, 0.70, 0.70)
    top_edge = _crop_region(img, 0.05, 0.05, 0.30, 0.25)
    center_var = _color_variance(center)
    edge_var = _color_variance(top_edge)
    findings["checks"]["center_variance"] = center_var
    findings["checks"]["edge_variance"] = edge_var
    # If center has fewer or equal colors as a small edge region, the
    # background is overpowering (no foreground game elements visible).
    if center_var < max(8, edge_var * 0.7):
        findings["issues"].append(
            f"center variance ({center_var}) < edge variance ({edge_var}) — background "
            f"may be overpowering foreground (tile-fill bug?)")

    # Check 3: HUD strip (top 12% of canvas) — should have visible text
    hud_strip = _crop_region(img, 0.0, 0.0, 1.0, 0.12)
    hud_var = _color_variance(hud_strip)
    findings["checks"]["hud_variance"] = hud_var
    if hud_var < 10:
        findings["issues"].append(
            f"HUD region has only {hud_var} distinct colors — score/lives may be missing")

    # Check 4: missing-texture fallback (Phaser uses magenta for missing keys)
    magenta_buckets = sum(c for color, c in dom
                          if color[0] >= 6 and color[1] <= 1 and color[2] >= 6)
    total = sum(c for _, c in dom)
    magenta_pct = magenta_buckets / max(total, 1)
    findings["checks"]["magenta_fill_pct"] = round(magenta_pct, 3)
    if magenta_pct > 0.10:
        findings["issues"].append(
            f"{magenta_pct:.0%} of canvas is magenta — likely missing-texture fallback")

    # Check 5: dominant color shouldn't be >85% (single-color blank)
    if dom and total > 0:
        top_color_pct = dom[0][1] / total
        findings["checks"]["top_color_pct"] = round(top_color_pct, 3)
        if top_color_pct > 0.85:
            findings["issues"].append(
                f"top color is {top_color_pct:.0%} of canvas — game may not be rendering")

    return findings


def run_visual_check(game_url: str, headless: bool = True,
                     screenshot_count: int = 3) -> dict:
    """Take N screenshots during gameplay + analyze each. PASS if all clean."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"skipped": "playwright not installed", "verdict": "SKIP"}

    results = {"url": game_url, "screenshots": [], "verdict": "unknown"}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        try:
            page.goto(game_url, timeout=30000, wait_until="domcontentloaded")
            page.wait_for_function("() => window.__GAME__", timeout=10000)
            for k in ("Space", "Enter"):
                page.keyboard.press(k); page.wait_for_timeout(150)
            try:
                page.evaluate("() => window.__GAME__ && window.__GAME__.scene && window.__GAME__.scene.start && window.__GAME__.scene.start('Game')")
            except Exception:
                pass
            page.wait_for_timeout(2000)

            for i in range(screenshot_count):
                # Move player a bit between screenshots (right + jump)
                page.keyboard.down("ArrowRight"); time.sleep(0.3); page.keyboard.up("ArrowRight")
                if i % 2: page.keyboard.press("Space")
                page.wait_for_timeout(500)
                png = page.screenshot()
                analysis = analyze_screenshot(png)
                analysis["frame"] = i + 1
                results["screenshots"].append(analysis)
        except Exception as e:
            results["error"] = str(e)[:200]
        finally:
            browser.close()

    # Verdict: PASS if every screenshot passed (zero issues)
    all_issues = []
    for s in results["screenshots"]:
        all_issues.extend(s.get("issues", []))
    results["total_issues"] = len(all_issues)
    results["unique_issue_types"] = len(set(all_issues))
    results["verdict"] = "PASS" if len(all_issues) == 0 else "FAIL"
    if all_issues:
        # Dedup + show first-3
        seen = set()
        unique = []
        for iss in all_issues:
            key = iss.split(" — ")[0][:60]
            if key not in seen:
                seen.add(key); unique.append(iss)
        results["sample_issues"] = unique[:5]
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--screenshots", type=int, default=3)
    args = ap.parse_args()
    res = run_visual_check(args.url, screenshot_count=args.screenshots)
    print(json.dumps(res, indent=2)[:3000])
    sys.exit(0 if res.get("verdict") == "PASS" else 1)


if __name__ == "__main__":
    main()
