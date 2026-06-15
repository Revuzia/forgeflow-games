#!/usr/bin/env python3
"""payload_gate.py — DETERMINISTIC download-weight budget for a single-file browser game.

The AAA push (Phase 2: bundling Poly Haven PBR sets + HDRIs from F:) collides with
the 'self-contained single page' rule: ONE 2k HDRI = 6.6MB, ONE PBR set = ~9.7MB, so
naive staging makes 30MB+ games — a non-AAA load experience and Cloudflare bloat.
This gate bounds the SHIPPABLE bytes of a game dir so texture/IBL additions can't
silently blow the payload. Pairs with the perf gate (GPU cost) — this one is the
NETWORK cost the perf gate doesn't see.

Counts only files that actually deploy (web assets); excludes dev cruft (.bak,
.aaa_cache, __pycache__, *.py, *.test.*, research/, design.json, *.md, source maps).

Usage:
    from payload_gate import check_payload
    res = check_payload(game_dir, budget_mb=12)
CLI:
    python payload_gate.py <game_dir> [--budget 12]
    exit 0 = within budget, 1 = over
"""
import argparse
import json
import sys
from pathlib import Path

DEFAULT_BUDGET_MB = 12  # owner-tunable; stylized-AAA browser game target

# files/dirs that never deploy — don't count them against the budget
EXCLUDE_DIR_PARTS = {".aaa_cache", "__pycache__", "research", ".git", "node_modules"}
EXCLUDE_SUFFIXES = {".py", ".pyc", ".md", ".map", ".bak", ".log"}
EXCLUDE_NAME_SUBSTR = (".bak_", ".test.", "smoke_test", "design.json", "raw_research", "qa_results", "play_report", "render_quality.json", "payload.json")
# only these extensions are real shipped web payload
WEB_SUFFIXES = {".html", ".js", ".mjs", ".css", ".json", ".wasm",
                ".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".basis",
                ".hdr", ".exr", ".ogg", ".mp3", ".wav", ".m4a", ".svg", ".woff", ".woff2"}


def _shippable(p: Path) -> bool:
    if any(part in EXCLUDE_DIR_PARTS for part in p.parts):
        return False
    if p.suffix.lower() in EXCLUDE_SUFFIXES:
        return False
    name = p.name.lower()
    if any(s in name for s in EXCLUDE_NAME_SUBSTR):
        return False
    return p.suffix.lower() in WEB_SUFFIXES


def check_payload(game_dir, budget_mb: float = DEFAULT_BUDGET_MB) -> dict:
    game_dir = Path(game_dir)
    budget = int(budget_mb * 1024 * 1024)
    total = 0
    files = []
    for p in game_dir.rglob("*"):
        if p.is_file() and _shippable(p):
            try:
                sz = p.stat().st_size
            except OSError:
                continue
            total += sz
            files.append((sz, str(p.relative_to(game_dir))))
    files.sort(reverse=True)
    ok = total <= budget
    return {
        "slug": game_dir.name,
        "ok": ok,
        "verdict": "pass" if ok else "fail",
        "bytes": total,
        "mb": round(total / 1024 / 1024, 2),
        "budget_mb": budget_mb,
        "top": [{"mb": round(s / 1024 / 1024, 2), "file": f} for s, f in files[:8]],
        "reason": ("within budget" if ok else f"{round(total/1024/1024,2)}MB > {budget_mb}MB budget"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("game_dir")
    ap.add_argument("--budget", type=float, default=DEFAULT_BUDGET_MB)
    a = ap.parse_args()
    res = check_payload(a.game_dir, a.budget)
    try:
        (Path(a.game_dir) / "payload.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    except Exception:
        pass
    print(f"payload[{res['slug']}]: {res['verdict']} — {res['mb']}MB / {res['budget_mb']}MB")
    if not res["ok"]:
        for t in res["top"]:
            print(f"   {t['mb']}MB  {t['file']}")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
