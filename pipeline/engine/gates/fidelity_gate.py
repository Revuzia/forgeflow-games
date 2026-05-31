"""fidelity_gate.py — Layer-4 fidelity (vision) gate.

Answers the question the old QA never asked: "does this LOOK like the target
genre?" Takes a screenshot of the running game and asks a Claude vision model to
score genre fidelity + flag visual defects (the dark-box sprites, blurry fonts,
overlapping HUD, off-perspective art that shipped in shroud/echoes).

This is a SOFT gate (produces a 0-100 score + notes; the build treats <60 as a
fail that feeds a specific fix back to regeneration).

Operator note: `claude -p` cannot run inside an interactive Claude session (the
OAuth lock — see CLAUDE.md). So this module exposes:
  - score_screenshot(img_path, genre, reference_note) -> dict   (the real call)
  - a CLI that prints the exact `claude -p` command for the operator to run, OR
    runs it directly when invoked from a non-interactive context (Task Scheduler).

Usage:
    python fidelity_gate.py <screenshot.png> <genre> [--run]
        (default prints the command; --run executes claude -p)
"""
import json
import subprocess
import sys
from pathlib import Path

PROMPT_TEMPLATE = (
    "You are a strict game art director doing ship/no-ship QA on a COMMERCIAL "
    "game. The attached screenshot is from a browser game in the '{genre}' genre. "
    "{reference}\n\n"
    "Hold it to a published-indie-game bar. AUTOMATICALLY fail (reads_as_genre=false, "
    "genre_fidelity<=30) if you see PLACEHOLDER / programmer-art, e.g.: units drawn "
    "as plain circles/squares with a LETTER on them; emoji used as sprites/objects; "
    "flat single-colour debug tiles with no texture or theme; objects that are just "
    "geometric primitives with no art; a scene that looks like a prototype or a "
    "developer test rather than a finished game. A real game has themed, textured, "
    "lit art with clear iconography — not labelled tokens.\n\n"
    "Return ONLY compact JSON: "
    '{{"genre_fidelity":0-100,"visual_defects":["..."],"reads_as_genre":true/false,'
    '"placeholder_art":true/false,"notes":"one sentence"}}.\n'
    "genre_fidelity = how much it looks like a polished, SHIPPED example of this genre. "
    "placeholder_art = true if any of the placeholder signs above are present. "
    "visual_defects = concrete problems (lettered-circle units, emoji objects, dark "
    "boxes around sprites, blurry text, overlapping HUD, untextured debug grid, "
    "placeholder rectangles). Be harsh — when in doubt, fail."
)

GENRE_REFERENCE = {
    "tactics": "It should read as a polished turn-based tactics game like XCOM / Into the Breach: "
               "themed unit sprites or clear class iconography (NOT lettered circles), textured/lit "
               "tiles, real cover objects, hazard tiles that look hazardous (not an emoji), and a "
               "styled HUD with turn/objective/fleet status.",
    "battleship": "It should read as a polished naval game: a real water surface, 3D ship models, "
                  "clear hit/miss markers, a styled HUD — not flat coloured panels.",
    "topdown": "It should read as a top-down adventure (character sprite on a tiled, textured map, HUD with hearts).",
    "platformer": "It should read as a side-view platformer (textured ground, platforms, a character sprite, parallax).",
}


def build_command(img_path, genre, reference_note=None):
    ref = reference_note or GENRE_REFERENCE.get(genre, "")
    prompt = PROMPT_TEMPLATE.format(genre=genre, reference=ref)
    # claude -p with an image attachment via @path
    return ["claude", "-p", f"{prompt}\n\n@{img_path}"]


def score_screenshot(img_path, genre, reference_note=None, timeout=120):
    """Run the vision call. Returns dict with score + notes, or an error dict.
    Only call this from a NON-interactive context (Task Scheduler / cron)."""
    cmd = build_command(img_path, genre, reference_note)
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return {"ok": False, "error": str(e), "genre_fidelity": None}
    raw = (out.stdout or "").strip()
    # Extract the JSON object from the model output.
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
            data["ok"] = True
            return data
        except json.JSONDecodeError:
            pass
    return {"ok": False, "error": "could not parse vision JSON", "raw": raw[:400], "genre_fidelity": None}


def _passes(result):
    """Ship/no-ship verdict. Requires a parsed result, a genre-appropriate read,
    no placeholder art, and a solid score. Conservative: an unparseable/errored
    vision call does NOT pass (we never ship a build we couldn't actually see)."""
    if not result.get("ok"):
        return False
    if result.get("placeholder_art") is True:
        return False
    if result.get("reads_as_genre") is False:
        return False
    return (result.get("genre_fidelity") or 0) >= 65


def capture_then_score(url, genre, out_png, reference_note=None):
    """Full vision gate: screenshot the running game (Playwright/CDP, reliable for
    WebGL) then score it. The capture half now works headlessly — capture.py."""
    from capture import capture  # gates/ is on sys.path when run from there
    capture(url, out_png)
    return score_screenshot(out_png, genre, reference_note)


def main():
    if len(sys.argv) < 3:
        print("usage: python fidelity_gate.py <screenshot.png|--url URL> <genre> [--run]")
        sys.exit(2)
    # --url mode: capture first (needs Playwright), then score (needs claude -p).
    if sys.argv[1] == "--url":
        url, genre = sys.argv[2], sys.argv[3]
        out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "fidelity_shot.png"
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        if "--run" in sys.argv:
            print(json.dumps(capture_then_score(url, genre, out), indent=2))
            sys.exit(0)
        from capture import capture
        capture(url, out)
        print(f"[fidelity_gate] captured {out}. Operator: score with claude -p:")
        print("  " + " ".join(f'"{c}"' if " " in c else c for c in build_command(out, genre)))
        sys.exit(0)
    img, genre = sys.argv[1], sys.argv[2]
    run = "--run" in sys.argv
    if not Path(img).exists():
        print(f"[fidelity_gate] screenshot not found: {img}")
        sys.exit(2)
    if run:
        result = score_screenshot(img, genre)
        print(json.dumps(result, indent=2))
        sys.exit(0 if _passes(result) else 1)
    # Default: print the operator command (safe inside interactive sessions).
    cmd = build_command(img, genre)
    print("[fidelity_gate] vision call deferred (claude -p blocked in interactive session).")
    print("Operator: run this in cmd.exe / Task Scheduler:")
    print("  " + " ".join(f'"{c}"' if " " in c else c for c in cmd))


if __name__ == "__main__":
    main()
