#!/usr/bin/env python3
"""art_fallback.py — LIBRARY-FIRST asset policy with on-demand generation (owner, 2026-06-11:
"use the assets we have but use pixellab/stability when needed").

The engine pipeline always casts from the real library (Kenney/CC0 + the 75GB Unity haul + staged
audio). This module is the LAST RESORT bridge: when a required slot genuinely cannot be filled from
the library, generate it — PixelLab for 2D sprites, Stability (Stable Audio) for music — under hard
budget caps, with every call ledgered. It can never break a night: every path is try/except with a
False/None fallback, and generation is skipped entirely when keys are missing or the cap is hit.

Budget: max 3 generations per calendar day (state/art_gen_budget.json), env kill: FFG_GEN_ART=0.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
ART = ENGINE.parent / "art"
STATE = ENGINE.parent.parent.parent / "state"
BUDGET_FILE = STATE / "art_gen_budget.json"
DAILY_CAP = 3

if str(ART) not in sys.path:
    sys.path.insert(0, str(ART))


def _budget_left():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        b = json.loads(BUDGET_FILE.read_text(encoding="utf-8"))
    except Exception:
        b = {}
    return DAILY_CAP - int(b.get(today, 0)), today, b


def _budget_spend(today, b):
    try:
        b[today] = int(b.get(today, 0)) + 1
        BUDGET_FILE.parent.mkdir(parents=True, exist_ok=True)
        BUDGET_FILE.write_text(json.dumps(b, indent=1), encoding="utf-8")
    except Exception:
        pass


def _enabled():
    return os.environ.get("FFG_GEN_ART", "1") != "0"


def ensure_sprite(out_path, description, size=64):
    """Generate ONE sprite via PixelLab when the library can't fill a slot. Returns True iff a real
    file landed at out_path. Library-first callers must only invoke this after exhausting the library."""
    out_path = Path(out_path)
    if out_path.exists():
        return True
    if not _enabled():
        return False
    left, today, b = _budget_left()
    if left <= 0:
        return False
    try:
        import sprite_generator
        if not sprite_generator.get_api_key():
            return False                                    # no key -> silent library fallback
        res = sprite_generator.generate_sprite(description, width=size, height=size,
                                               output_path=str(out_path))
        ok = bool(res) and out_path.exists() and out_path.stat().st_size > 200
        if ok:
            _budget_spend(today, b)
        return ok
    except Exception:
        return False


def ensure_music(out_path, theme="uplifting chiptune game theme, loopable"):
    """Generate ONE music track via Stability when the music library is empty/missing the slot.
    Returns True iff a real file landed at out_path."""
    out_path = Path(out_path)
    if out_path.exists():
        return True
    if not _enabled():
        return False
    left, today, b = _budget_left()
    if left <= 0:
        return False
    try:
        import music_generator
        if not music_generator._load_stability_key():
            return False
        res = music_generator.generate_music(theme, out_path, duration_seconds=90)
        ok = bool(res) and out_path.exists() and out_path.stat().st_size > 10000
        if ok:
            _budget_spend(today, b)
        return ok
    except Exception:
        return False


if __name__ == "__main__":
    left, _, _ = _budget_left()
    print(f"art_fallback: enabled={_enabled()} budget_left_today={left}/{DAILY_CAP}")
