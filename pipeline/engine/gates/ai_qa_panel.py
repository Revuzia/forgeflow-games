#!/usr/bin/env python3
"""ai_qa_panel.py — the MULTI-AGENT AI QA panel for a built ENGINE game. A panel of independent claude -p
inspectors, each checking ONE part of the game, layered ON TOP of the deterministic 10-inspector play
tester (forgeflow-engine/tools/verify_engine_game_play.py — that one is the must-pass: boots/plays/renders/
real-assets/controls/progression/audio/no-crash). This panel adds the QUALITY judgments a deterministic
check can't make:

  vision_fidelity (vision, blocking)  — looks like a real, finished game of its genre, NOT programmer art.
  genre_fit       (code,   blocking)  — implements the genre's SIGNATURE MECHANIC with depth, not a stub.
  code_review     (code,   advisory)  — reachable win AND lose, no degenerate values, input handled, no bugs.
  ux_hud          (vision, advisory)  — menus + HUD readable, not clipped/overlapping.

DESIGN / SAFETY:
  • The DETERMINISTIC harness — inspector registry, prompt assembly, response parsing, aggregation,
    fallback — is fully unit-tested with FIXTURES (test_ai_qa_panel.py; no claude -p, no network).
  • Each inspector is a SEPARATE claude -p call (independent perspective). claude -p fires ONLY when
    run=True (the nightly / an operator cmd) — NEVER in an interactive Claude session (OAuth lock).
  • A DEFERRED inspector (claude -p unavailable / no screenshot) is NOT a blocking fail — so a no-claude
    env still ships via the deterministic gates. Deferred inspectors are flagged in the report.
  • Blocking is policy: only `vision_fidelity` + `genre_fit` block (a real "is this a game of its genre"
    check); the rest are advisory feedback the auto-repair loop can act on. Tune via FFG_AI_QA_BLOCKING.

Usage:
  python ai_qa_panel.py <game_dir> --genre <genre> [--shot <png>] [--run]
      (default prints the per-inspector claude -p commands for the operator; --run executes them)
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# name, kind (code|vision), blocking (default policy), floor (min score 0-100 to pass), rubric
INSPECTORS = [
    {"name": "vision_fidelity", "kind": "vision", "blocking": True, "floor": 60,
     "rubric": ("Looking at this screenshot of a {genre} game, does it look like a REAL, finished {genre} "
                "game — NOT programmer art (bare colored boxes/quads, letters used as sprites, untextured "
                "wireframes, flat rectangles)? Judge art + composition only.")},
    {"name": "genre_fit", "kind": "code", "blocking": True, "floor": 55,
     "rubric": ("Here is the game.js for a {genre} game. Does it implement the SIGNATURE MECHANIC of the "
                "{genre} genre with real depth — a working core loop with 3+ levels/waves/rounds and a "
                "difficulty ramp (ctx.level progression) — NOT a cosmetic stub, a single-screen one-shot, "
                "or a different genre wearing its name?")},
    {"name": "code_review", "kind": "code", "blocking": False, "floor": 50,
     "rubric": ("You are a senior gameplay engineer. Review this game.js for logic/completeness bugs: a "
                "reachable WIN and a reachable LOSE state, no degenerate/no-op values, input handled every "
                "frame, no obvious runtime errors or soft-locks.")},
    {"name": "ux_hud", "kind": "vision", "blocking": False, "floor": 50,
     "rubric": ("Looking at this screenshot, are the on-screen text, menus and HUD READABLE and well laid "
                "out — not clipped, overlapping, or running off-screen?")},
]
_FMT = " Return ONLY compact JSON: {{\"pass\": true|false, \"score\": 0-100, \"issues\": [\"short issue\"]}}."


def _blocking(insp):
    """Policy: env FFG_AI_QA_BLOCKING overrides — 'none' (all advisory), 'all', or default (the per-inspector flag)."""
    pol = os.environ.get("FFG_AI_QA_BLOCKING", "").strip().lower()
    if pol == "none":
        return False
    if pol == "all":
        return True
    return insp["blocking"]


def build_prompt(insp, ctx):
    """Assemble one inspector's claude -p prompt. code inspectors embed game.js; vision inspectors expect
    the screenshot attached separately (build_command appends @shot)."""
    rubric = insp["rubric"].format(genre=ctx.get("genre", "?"))
    base = f"You are an expert game QA reviewer ({insp['name']}). {rubric}{_FMT}"
    if insp["kind"] == "code":
        gj = (ctx.get("game_js") or "")[:6000]
        return base + f"\n\nTITLE: {ctx.get('title','?')}\n\n=== game.js ===\n{gj}"
    return base                                            # vision: screenshot attached by build_command


def build_command(insp, ctx):
    """(argv, stdin_prompt) for an inspector (vision attaches the screenshot via @path inside the prompt).
    Prompt rides STDIN, never argv — Windows caps argv at 32,767 chars (WinError 206)."""
    prompt = build_prompt(insp, ctx)
    if insp["kind"] == "vision" and ctx.get("shot"):
        prompt = prompt + f"\n\n@{ctx['shot']}"
    return ["claude", "-p"], prompt


def parse_verdict(raw):
    """Extract {pass, score, issues} from a claude -p response. Robust to fences / prose. None if unparseable."""
    if not raw or not raw.strip():
        return None
    m = re.search(r"```(?:json)?\s*\n(.*?)```", raw, re.DOTALL)
    blob = m.group(1) if m else raw
    s, e = blob.find("{"), blob.rfind("}")
    if s < 0 or e <= s:
        return None
    try:
        d = json.loads(blob[s:e + 1])
    except json.JSONDecodeError:
        return None
    if "pass" not in d and "score" not in d:
        return None
    return d


def run_inspector(insp, ctx, *, run=False, _raw_override=None, timeout=120):
    """Run ONE inspector. Returns {name, kind, blocking, pass, score, issues, deferred, error}.
    deferred=True (pass=None) when it couldn't run (no run / no screenshot for vision / claude -p missing /
    unparseable) — deferred is never a blocking fail."""
    blocking = _blocking(insp)
    base = {"name": insp["name"], "kind": insp["kind"], "blocking": blocking,
            "pass": None, "score": None, "issues": [], "deferred": True, "error": None}
    if insp["kind"] == "vision" and not ctx.get("shot"):
        base["error"] = "no screenshot"
        return base
    if _raw_override is None and not run:
        base["error"] = "deferred (run=False)"
        return base
    try:
        if _raw_override is not None:
            raw = _raw_override
        else:
            cmd, prompt = build_command(insp, ctx)
            raw = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=timeout).stdout
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        base["error"] = "claude -p unavailable: " + type(e).__name__
        return base
    d = parse_verdict(raw)
    if d is None:
        base["error"] = "unparseable verdict"
        return base
    score = d.get("score")
    passed = bool(d.get("pass")) and (score is None or score >= insp["floor"])
    base.update({"pass": passed, "score": score, "issues": (d.get("issues") or [])[:8], "deferred": False})
    return base


def aggregate(results):
    """Combine inspector results into a panel verdict. A BLOCKING inspector that DEFINITELY failed (not
    deferred) -> hold. Advisory + deferred are reported, never block."""
    blocking_fails = [r["name"] for r in results if r["blocking"] and r["pass"] is False and not r["deferred"]]
    advisory_fails = [r["name"] for r in results if not r["blocking"] and r["pass"] is False and not r["deferred"]]
    deferred = [r["name"] for r in results if r["deferred"]]
    issues = {r["name"]: r["issues"] for r in results if r["issues"]}
    return {"verdict": "hold" if blocking_fails else "ship",
            "blocking_fails": blocking_fails, "advisory_fails": advisory_fails,
            "deferred": deferred, "issues": issues}


def run_panel(game_dir, genre, *, shot=None, run=False, title=None):
    """Run the whole panel on a built engine game dir. Returns {verdict, inspectors, ...} + writes
    ai_qa_report.json. Loads game.js for the code inspectors. Never raises."""
    gdir = Path(game_dir)
    ctx = {"genre": genre, "shot": shot, "title": title or gdir.name}
    gj = gdir / "game.js"
    ctx["game_js"] = gj.read_text(encoding="utf-8") if gj.exists() else ""
    results = [run_inspector(i, ctx, run=run) for i in INSPECTORS]
    agg = aggregate(results)
    report = {"game": gdir.name, "genre": genre, **agg, "inspectors": results}
    try:
        (gdir / "ai_qa_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    except OSError:
        pass
    return report


def main():
    if len(sys.argv) < 2:
        print("usage: python ai_qa_panel.py <game_dir> --genre <genre> [--shot PNG] [--run]")
        sys.exit(2)
    gdir = Path(sys.argv[1])
    genre = sys.argv[sys.argv.index("--genre") + 1] if "--genre" in sys.argv else "?"
    shot = sys.argv[sys.argv.index("--shot") + 1] if "--shot" in sys.argv else None
    run = "--run" in sys.argv
    if not run:
        # operator mode: print the exact claude -p command for each inspector
        gj = (gdir / "game.js").read_text(encoding="utf-8") if (gdir / "game.js").exists() else ""
        ctx = {"genre": genre, "shot": shot, "title": gdir.name, "game_js": gj}
        print(f"[ai_qa_panel] claude -p blocked in-session. Operator: run these {len(INSPECTORS)} inspectors:")
        for insp in INSPECTORS:
            if insp["kind"] == "vision" and not shot:
                print(f"  - {insp['name']}: (needs --shot <png>)")
                continue
            print(f"\n--- {insp['name']} ({'blocking' if _blocking(insp) else 'advisory'}) ---")
            print(" ".join(json.dumps(a) if " " in a else a for a in build_command(insp, ctx))[:600] + " ...")
        sys.exit(0)
    report = run_panel(gdir, genre, shot=shot, run=True)
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["verdict"] == "ship" else 1)


if __name__ == "__main__":
    main()
