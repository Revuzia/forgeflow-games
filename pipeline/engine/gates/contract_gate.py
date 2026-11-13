"""contract_gate.py — Layer-4 contract gate.

Validates a game's content.json against the base schema + its genre profile.
This is the gate that PREVENTS the class of bug that paused echoes-of-the-rift:
the generator, the level data, and QA now all speak one schema, so a tile-format
mismatch is caught here in milliseconds instead of jamming the debug loop.

Usage:
    python contract_gate.py <path/to/content.json>
    python contract_gate.py ../../games/rift-tactics/content.json

Exit 0 = valid, 1 = invalid (prints the precise violations).
"""
import json
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ENGINE_DIR / "schema"
PROFILE_DIR = SCHEMA_DIR / "profiles"


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate(content_path):
    content_path = Path(content_path)
    if not content_path.exists():
        return False, [f"content file not found: {content_path}"]
    try:
        content = _load(content_path)
    except json.JSONDecodeError as e:
        return False, [f"content.json is not valid JSON: {e}"]

    try:
        import jsonschema
    except ImportError:
        return False, ["jsonschema not installed (pip install jsonschema)"]

    errors = []
    base = _load(SCHEMA_DIR / "content.schema.json")
    v = jsonschema.Draft7Validator(base)
    for e in sorted(v.iter_errors(content), key=lambda e: list(e.path)):
        loc = "/".join(str(p) for p in e.path) or "(root)"
        errors.append(f"[base] {loc}: {e.message}")

    genre = content.get("genre")
    profile_path = PROFILE_DIR / f"{genre}.schema.json"
    if not genre:
        errors.append("[base] genre missing — cannot select a profile")
    elif not profile_path.exists():
        errors.append(f"[profile] no schema profile for genre '{genre}' at {profile_path.name}")
    else:
        profile = _load(profile_path)
        pv = jsonschema.Draft7Validator(profile)
        for e in sorted(pv.iter_errors(content), key=lambda e: list(e.path)):
            loc = "/".join(str(p) for p in e.path) or "(root)"
            errors.append(f"[{genre}] {loc}: {e.message}")

    # Cross-field sanity that schema can't express: units must stand on a
    # walkable tile (not inside a wall) — the kind of contract bug that produces
    # an unplayable game even when the JSON shape is fine.
    if genre == "tactics" and "missions" in content:
        for mi, m in enumerate(content.get("missions", [])):
            grid = m.get("grid")
            if not grid:
                continue
            h = len(grid)
            w = len(grid[0]) if h else 0
            for side in ("player_units", "enemy_units"):
                for u in m.get(side, []):
                    x, y = u.get("x"), u.get("y")
                    if x is None or y is None:
                        continue
                    if not (0 <= y < h and 0 <= x < w):
                        errors.append(f"[tactics] mission {mi} unit {u.get('id')} at ({x},{y}) is out of bounds {w}x{h}")
                    elif grid[y][x] in (1, 3):
                        errors.append(f"[tactics] mission {mi} unit {u.get('id')} spawns inside a blocking tile ({grid[y][x]}) at ({x},{y})")

    return (len(errors) == 0), errors


def main():
    if len(sys.argv) < 2:
        print("usage: python contract_gate.py <content.json>")
        sys.exit(2)
    ok, errors = validate(sys.argv[1])
    if ok:
        print(f"[contract_gate] PASS  {sys.argv[1]}")
        sys.exit(0)
    print(f"[contract_gate] FAIL  {sys.argv[1]}")
    for e in errors:
        print("  - " + e)
    sys.exit(1)


if __name__ == "__main__":
    main()
