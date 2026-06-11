#!/usr/bin/env python3
"""scope_gate.py — DETERMINISTIC content-scope enforcement (owner, 2026-06-11: "a scope gate that
parses level/world count against design, absolutely").

The design doc (M0) PROMISES a content scope ("5 hand-crafted worlds", "8 waves", ...). Until now
nothing counted the promise against the shipped code — the AI panel only approximated it. This gate
parses BOTH sides and blocks M2+ until the game declares at least the promised count:

  promised_scope(design_doc) -> (count, unit)   from scope/core_loop/definition_of_done text
  declared_scope(game_js)    -> (count, how)    from the game's top-level level-data declaration
  run_gate(design_doc, js)   -> {ok, promised, unit, declared, detail}

CONTRACT (also stated in the authoring/revision prompts): the game declares its content as ONE
top-level array literal — `const LEVELS = [ ... ]` (or WORLDS/STAGES/WAVES/ROUNDS/ZONES/ACTS, or
LEVEL_DATA/WORLD_DATA) with one element per level — or an explicit `const LEVEL_COUNT = N`.
Inconclusive cases never block: a doc with no numeric promise passes (ok, promised=0).
"""
import re

# major content units, in preference order when several are promised
UNITS = ("world", "level", "stage", "zone", "act", "wave", "round")
_PROMISE_RE = re.compile(
    r"(\d{1,3})\s*(?:\+\s*)?(?:hand-?crafted\s+|distinct\s+|unique\s+|playable\s+)?"
    r"(worlds?|levels?|stages?|zones?|acts?|waves?|rounds?)\b", re.IGNORECASE)
_DECL_ARRAY_RE = re.compile(
    r"\b(?:const|let|var)\s+(LEVELS?|WORLDS?|STAGES?|WAVES?|ROUNDS?|ZONES?|ACTS?|LEVEL_DATA|WORLD_DATA)"
    r"\s*=\s*\[", re.IGNORECASE)
_DECL_COUNT_RE = re.compile(
    r"\b(?:const|let|var)\s+(?:LEVEL|WORLD|STAGE|WAVE|ROUND)_?COUNT\s*=\s*(\d{1,3})\b", re.IGNORECASE)


def promised_scope(design_doc):
    """Parse the design doc's promised content count. Returns (count, unit) or (0, None).
    Prefers the largest count among major units (sub-units like 'screens' are ignored)."""
    if not design_doc:
        return 0, None
    text = " ".join(str(design_doc.get(k, "")) for k in
                    ("scope", "core_loop", "definition_of_done", "milestone_plan", "title"))
    best = (0, None)
    for m in _PROMISE_RE.finditer(text):
        n, unit = int(m.group(1)), m.group(2).lower().rstrip("s")
        if 1 <= n <= 30 and n > best[0]:
            best = (n, unit)
    return best


def _count_array_elements(js, open_idx):
    """Count top-level elements of the array literal starting at js[open_idx]=='['.
    String/template/comment-aware bracket scan; returns 0 on malformed input."""
    depth, i, n, elems, seg = 0, open_idx, len(js), 0, False   # seg = content since last comma
    in_str, esc = None, False
    while i < n:
        c = js[i]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == in_str: in_str = None
            i += 1; continue
        if c in "\"'`":
            in_str = c
            if depth == 1: seg = True
            i += 1; continue
        if c == "/" and i + 1 < n and js[i + 1] == "/":
            i = js.find("\n", i)
            if i < 0: return 0
            continue
        if c == "/" and i + 1 < n and js[i + 1] == "*":
            i = js.find("*/", i)
            if i < 0: return 0
            i += 2; continue
        if c in "[{(":
            if depth == 1: seg = True
            depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0:
                return elems + (1 if seg else 0)            # trailing comma must not inflate
        elif depth == 1:
            if c == ",":
                if seg: elems += 1
                seg = False
            elif not c.isspace():
                seg = True
        i += 1
    return 0


def declared_scope(js):
    """Count the content the game ACTUALLY declares. Returns (count, evidence)."""
    best = (0, "no LEVELS/WORLDS array or *_COUNT declaration found")
    for m in _DECL_ARRAY_RE.finditer(js or ""):
        cnt = _count_array_elements(js, m.end() - 1)
        if cnt > best[0]:
            best = (cnt, f"{m.group(1)} array with {cnt} element(s)")
    for m in _DECL_COUNT_RE.finditer(js or ""):
        cnt = int(m.group(1))
        if cnt > best[0]:
            best = (cnt, m.group(0))
    return best


def run_gate(design_doc, js):
    """The gate. ok=False ONLY on a concrete shortfall (promised>0 and declared<promised)."""
    promised, unit = promised_scope(design_doc)
    declared, how = declared_scope(js)
    if promised <= 0:
        return {"ok": True, "promised": 0, "unit": None, "declared": declared,
                "detail": "no numeric scope promised in design doc (inconclusive -> pass)"}
    ok = declared >= promised
    detail = (f"design doc promises {promised} {unit}(s); game declares {declared} ({how})" +
              ("" if ok else f" — BUILD THE REMAINING {promised - declared}"))
    return {"ok": ok, "promised": promised, "unit": unit, "declared": declared, "detail": detail}


if __name__ == "__main__":
    import json, sys
    from pathlib import Path
    gdir = Path(sys.argv[1])
    jpath = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    dd = json.loads(jpath.read_text(encoding="utf-8")).get("design_doc", {}) if jpath else {}
    print(json.dumps(run_gate(dd, (gdir / "game.js").read_text(encoding="utf-8")), indent=1))
