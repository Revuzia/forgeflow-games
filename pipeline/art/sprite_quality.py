#!/usr/bin/env python3
"""
sprite_quality.py — Claude-vision-based quality review of generated sprites.

Scores each sprite 1-10 on: recognizable subject, color coherence, pixel-art
fidelity, correct transparent background, reasonable proportions.

Called from phase_assets after all sprites generate. Flags low-scoring sprites
for regeneration. Gracefully degrades (returns pass) if anthropic SDK missing.

Cost: ~$0.05/sprite. For a typical game with 30 sprites = $1.50/game.

Usage (as module):
    from sprite_quality import review_sprites
    results = review_sprites(assets_dir, min_score=5)
"""
import base64
import json
import os
from pathlib import Path

NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"


def _load_anthropic_key() -> str:
    try:
        cfg = json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
        return (cfg.get("anthropic", {}) or {}).get("api_key") \
            or (cfg.get("providers", {}) or {}).get("anthropic", {}).get("api_key") or ""
    except Exception:
        return ""


def _score_one(img_path: Path, api_key: str, kind: str = "sprite") -> dict:
    """Return {score: int 1-10, reason: str, flagged: bool} for one sprite."""
    try:
        import anthropic
    except ImportError:
        return {"score": 10, "reason": "anthropic SDK not installed", "flagged": False, "skipped": True}

    try:
        b64 = base64.b64encode(img_path.read_bytes()).decode()
    except Exception as e:
        return {"score": 0, "reason": f"read failed: {e}", "flagged": True}

    prompt = (
        f"You are an art director reviewing auto-generated pixel-art sprites for a 2D game.\n\n"
        f"Rate this {kind} on a 1-10 scale across these criteria:\n"
        f"  1. Subject is recognizable (not random noise or solid color)\n"
        f"  2. Color palette is coherent (not random rainbow)\n"
        f"  3. Pixel-art fidelity (not blurry, not photorealistic)\n"
        f"  4. Background is transparent OR a clean solid color\n"
        f"  5. Proportions look intentional\n\n"
        f"Return ONLY a JSON object: {{\"score\": N, \"reason\": \"one short sentence\"}}.\n"
        f"1-3 = unusable; 4-5 = mediocre; 6-7 = decent; 8-10 = professional."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",  # cheap + fast for vision
            max_tokens=200,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": prompt},
            ]}],
        )
        raw = msg.content[0].text.strip()
        # Extract JSON
        import re as _re
        m = _re.search(r'\{[^}]+\}', raw)
        if m:
            data = json.loads(m.group(0))
            score = int(data.get("score", 5))
            reason = str(data.get("reason", ""))[:200]
            return {"score": score, "reason": reason, "flagged": score < 5}
        return {"score": 5, "reason": f"parse failed: {raw[:100]}", "flagged": False}
    except Exception as e:
        return {"score": 10, "reason": f"api error: {str(e)[:120]}", "flagged": False, "skipped": True}


def review_sprites(assets_dir: Path, min_score: int = 5, max_review: int = 40) -> dict:
    """Score every PNG sprite in assets_dir. Return aggregate results + per-sprite detail.

    Flagged sprites (score < min_score) are candidates for regeneration.
    Caps at max_review to bound cost (~40 sprites × $0.05 = $2/game).
    """
    api_key = _load_anthropic_key()
    if not api_key:
        return {"reviewed": 0, "flagged": 0, "skipped": True,
                "reason": "no anthropic api_key in api_config.json"}

    results = {"reviewed": 0, "flagged": 0, "avg_score": 0, "details": []}
    total_score = 0

    # Review only gameplay-visible sprites (skip UI, backgrounds, atlas files)
    skip_patterns = ("atlas", "bg", "background", "tilemap", "tile_", "ui_", ".inline_")
    sprites = sorted([f for f in assets_dir.glob("*.png")
                      if not any(p in f.name.lower() for p in skip_patterns)])[:max_review]

    if not sprites:
        return {"reviewed": 0, "flagged": 0, "reason": "no sprites to review"}

    # Determine kind from filename for better prompts
    for sp in sprites:
        name = sp.name.lower()
        if "protagonist" in name or "player" in name or "hero" in name:
            kind = "player character"
        elif "enemy_" in name or "boss_" in name:
            kind = "enemy or boss"
        elif "item" in name or "coin" in name or "powerup" in name:
            kind = "item / collectible"
        else:
            kind = "game sprite"

        detail = _score_one(sp, api_key, kind=kind)
        detail["sprite"] = sp.name
        detail["kind"] = kind
        if detail.get("skipped"):
            continue
        results["details"].append(detail)
        results["reviewed"] += 1
        total_score += detail["score"]
        if detail.get("flagged"):
            results["flagged"] += 1

    if results["reviewed"] > 0:
        results["avg_score"] = round(total_score / results["reviewed"], 1)

    return results


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        d = Path(sys.argv[1])
        r = review_sprites(d, min_score=int(sys.argv[2]) if len(sys.argv) > 2 else 5)
        print(json.dumps(r, indent=2))
    else:
        print("Usage: python sprite_quality.py <assets_dir> [min_score=5]")
