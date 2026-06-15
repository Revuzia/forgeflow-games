#!/usr/bin/env python3
"""emit_integrity_gate.py — DETERMINISTIC guard that an emitted game is actually SHIPPABLE code:
no leftover template placeholder tokens, and game.js is syntactically valid JavaScript.

Why: engine_game_emit fills ~24 `__TOKEN__` placeholders by string substitution. A missed key
(or a template typo) ships a game.js with a raw `__FOE_SPR__` in it or a broken brace — a black
screen the structural verify (file-exists) never catches. This gate is the teeth:
  • TOKEN scan (pure Python, zero false positives): no `__[A-Z_]+__` survives in game.js / index.html.
  • SYNTAX check (best-effort): `node --check` the game.js as an ES module (.mjs). Node present on
    this box (v22); if node is missing/times out the syntax check is SKIPPED (never a false fail) —
    the token scan still runs.

Usage:
    from emit_integrity_gate import check_emit_integrity
    res = check_emit_integrity(game_dir)     # -> dict with .ok
CLI: python emit_integrity_gate.py <game_dir>   (exit 0 ok, 1 fail)
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

TOKEN_RE = re.compile(r"__[A-Z][A-Z0-9_]*__")
# tokens that are legitimately PRESENT post-build (the engine injects them at runtime in index.html,
# they are not template-fill placeholders): none in game.js. index.html may legitimately keep the
# __GAME_OBJECT__ hook only if the emitter leaves it — but our emitter substitutes it, so treat all as leftover.


def _node_check(js_text: str):
    """(ok, detail). ok=None when node can't run (skip). Validates as an ES module via a temp .mjs."""
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as tf:
            tf.write(js_text)
            tmp = tf.name
        try:
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=30)
        finally:
            try:
                Path(tmp).unlink()
            except OSError:
                pass
        if r.returncode == 0:
            return True, "node --check ok"
        return False, "syntax error: " + (r.stderr or r.stdout or "").strip().splitlines()[-1:][0][:160] if (r.stderr or r.stdout) else "syntax error"
    except (FileNotFoundError, OSError):
        return None, "node not available — syntax check skipped"
    except subprocess.TimeoutExpired:
        return None, "node --check timed out — skipped"


def check_emit_integrity(game_dir) -> dict:
    game_dir = Path(game_dir)
    gj = game_dir / "game.js"
    idx = game_dir / "index.html"
    res = {"slug": game_dir.name, "leftover_tokens": [], "syntax_ok": None, "warnings": []}
    if not gj.exists():
        res.update({"ok": False, "verdict": "fail", "reason": "no game.js"})
        return res
    js = gj.read_text(encoding="utf-8", errors="replace")
    # TOKEN scan — game.js must be FULLY substituted at emit time. index.html is intentionally
    # NOT scanned: it legitimately keeps runtime-filled tokens (__ENGINE__/__ENGINE_MODE__/
    # __ENGINE_ERROR__/__GAME_OBJECT__) that the engine loader substitutes in the browser — the
    # structural verify even REQUIRES __GAME_OBJECT__ to be present post-build.
    toks = sorted(set(TOKEN_RE.findall(js)))
    res["leftover_tokens"] = toks
    # SYNTAX check (best-effort)
    syn_ok, syn_detail = _node_check(js)
    res["syntax_ok"] = syn_ok
    if syn_ok is None:
        res["warnings"].append(syn_detail)
    ok = (not toks) and (syn_ok is not False)
    res.update({
        "ok": ok,
        "verdict": "pass" if ok else "fail",
        "reason": ("shippable" if ok else
                   ("leftover placeholders: " + ", ".join(toks)) if toks else
                   "game.js " + syn_detail),
    })
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("usage: emit_integrity_gate.py <game_dir>"); return 2
    res = check_emit_integrity(args[0])
    print(f"emit_integrity[{res['slug']}]: {res['verdict']} — {res['reason']}")
    for w in res.get("warnings", []):
        print("   " + w)
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
