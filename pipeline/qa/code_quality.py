#!/usr/bin/env python3
"""
code_quality.py — Lint Claude-generated game.js before integration.

AAA standard: no code reaches production without style + correctness review.
We run a set of regex-based sanity checks that catch common Claude codegen mistakes:
  - Unbalanced braces
  - Missing window.__TEST__ hooks
  - Eval / Function() usage (security)
  - Console.log left in production
  - Unused catch blocks that swallow errors silently
  - Missing GAME_CONFIG guard
  - JSX / TypeScript in a JS file
  - Huge inline strings (likely prompt leak)

Returns a score 0-100. Build phase treats <70 as a hard fail.
"""
import argparse
import json
import re
import sys
from pathlib import Path


def lint_game_js(path: Path) -> dict:
    if not path.exists():
        return {"score": 0, "errors": ["file missing"], "warnings": []}
    code = path.read_text(encoding="utf-8", errors="replace")
    errors = []
    warnings = []

    # ── Hard errors ───────────────────────────────────────────────────────
    # Unbalanced braces
    open_b = code.count("{"); close_b = code.count("}")
    if open_b != close_b:
        errors.append(f"Unbalanced braces: {{={open_b}, }}={close_b}")

    # Unbalanced parens
    open_p = code.count("("); close_p = code.count(")")
    if abs(open_p - close_p) > 2:
        errors.append(f"Unbalanced parens: (={open_p}, )={close_p}")

    # Unbalanced brackets
    open_s = code.count("["); close_s = code.count("]")
    if abs(open_s - close_s) > 2:
        errors.append(f"Unbalanced brackets: [={open_s}, ]={close_s}")

    # Template placeholders left unsubstituted
    placeholders = re.findall(r"\{\{[A-Z_]+\}\}", code)
    if placeholders:
        errors.append(f"Unsubstituted placeholders: {set(placeholders)}")

    # Missing test hooks
    if "__TEST__" not in code:
        errors.append("Missing window.__TEST__ hooks — Playwright QA will fail")

    # Missing GAME_CONFIG
    if "GAME_CONFIG" not in code:
        errors.append("Missing GAME_CONFIG — template placeholders may have been replaced incorrectly")

    # Security: eval / Function()
    if re.search(r"\beval\s*\(", code):
        errors.append("eval() used — security risk, remove before production")
    if re.search(r"\bnew\s+Function\s*\(", code):
        errors.append("new Function() used — security risk")

    # JSX / TypeScript contamination (Claude sometimes emits TSX)
    if re.search(r":\s*(string|number|boolean)\s*=", code):
        warnings.append("Type annotations detected — game.js should be plain JS, not TS")
    if re.search(r"<[A-Z]\w+[^<>]*/>", code):
        warnings.append("JSX detected — game.js should be plain JS")

    # Empty catch blocks (swallowing errors)
    # 2026-04-27: tuned threshold up from 5 to 50. Legit Phaser idioms include
    # `try { animation.play() } catch (_e) {}` for animations that may not be
    # registered yet, audio that may not be loaded in QA, etc. AAA pipeline
    # patches add ~30-60 of these per game. Real abuse is when the count
    # explodes past 100 (Claude swallowing real bugs). Also distinguishing
    # "intentional swallow" (catch (_e) {} or catch (_) {}) from "forgot to
    # handle" (catch (e) {}) — only the latter is a smell.
    suspicious_catches = len(re.findall(r"catch\s*\(\s*[a-zA-Z][a-zA-Z0-9]*\s*\)\s*\{\s*\}", code))
    intentional_catches = len(re.findall(r"catch\s*\(\s*_\w*\s*\)\s*\{\s*\}", code))
    empty_catches = suspicious_catches + intentional_catches
    if suspicious_catches > 5:
        warnings.append(f"{suspicious_catches} catch(e) blocks with no handler — suspicious; use catch(_e) for intentional swallows")
    if empty_catches > 100:
        warnings.append(f"{empty_catches} empty catch blocks total — abuse, refactor")

    # ── Warnings ──────────────────────────────────────────────────────────
    # Console.log in production
    console_count = len(re.findall(r"\bconsole\.(log|debug|info)\b", code))
    if console_count > 10:
        warnings.append(f"{console_count} console.log/debug/info calls — should be removed for production")

    # Inline strings > 500 chars — flag NATURAL-LANGUAGE strings (possible prompt
    # leak), NOT data blobs. A natural-language string has a high ratio of
    # alphabetic words to symbols. Data (tile arrays, JSON, base64) is mostly
    # commas/numbers/braces.
    # 2026-04-27: previously fired on every level-data inline string. Now we
    # require the string to look like prose (lots of letters + spaces, not
    # comma-separated numbers).
    big_strings = re.findall(r'(["\'`])([^"\'`\n]{500,})\1', code)
    leak_candidates = []
    for _q, s in big_strings:
        # Ratio of alphabetic chars to total — prose ≥0.55, data <0.3
        alpha = sum(1 for c in s if c.isalpha())
        spaces = sum(1 for c in s if c == " ")
        if len(s) > 0 and (alpha / len(s)) > 0.55 and (spaces / len(s)) > 0.10:
            leak_candidates.append(s)
    if leak_candidates:
        warnings.append(f"Huge inline natural-language strings ({len(leak_candidates)}) — possible prompt leak")

    # TODO / FIXME
    todo_count = len(re.findall(r"\b(TODO|FIXME|XXX|HACK)\b", code, re.IGNORECASE))
    if todo_count > 3:
        warnings.append(f"{todo_count} TODO/FIXME markers — Claude left incomplete stubs")

    # Missing Phaser.Game instantiation (2D templates) or THREE.Scene (3D)
    has_phaser = "new Phaser.Game" in code
    has_three = "new THREE." in code or "THREE.Scene" in code
    if not has_phaser and not has_three:
        errors.append("No game engine instantiation found (neither Phaser nor Three.js)")

    # Size check (too small = stub, too big = likely broken)
    # 2026-04-27: raised soft-warning threshold from 500 KB to 4 MB. Real games
    # that inline 46 levels of 1000×31 tilemap data legitimately reach 3+ MB.
    # Hard-warning at 4 MB suggests genuine duplication. Below 4 MB is fine.
    size_kb = len(code) / 1024
    if size_kb < 3:
        errors.append(f"game.js too small ({size_kb:.1f} KB) — likely stub or truncated")
    elif size_kb > 4096:
        warnings.append(f"game.js exceeds 4 MB ({size_kb:.1f} KB) — likely duplication, check externalization of levels/assets")

    # ── Score ─────────────────────────────────────────────────────────────
    score = 100
    score -= len(errors) * 15
    score -= len(warnings) * 3
    score = max(0, min(100, score))

    return {
        "score": score,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "size_kb": round(size_kb, 1),
            "console_calls": console_count,
            "todo_count": todo_count,
            "empty_catches": empty_catches,
            "has_phaser": has_phaser,
            "has_three": has_three,
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="Path to game.js")
    ap.add_argument("--min-score", type=int, default=70)
    args = ap.parse_args()
    result = lint_game_js(Path(args.path))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["score"] >= args.min_score else 1)


if __name__ == "__main__":
    main()
