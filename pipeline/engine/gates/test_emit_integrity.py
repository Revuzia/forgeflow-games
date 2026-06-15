#!/usr/bin/env python3
"""test_emit_integrity.py — CI for emit_integrity_gate (Tier 5).

Proves (deterministic, no claude -p): every emitter genre produces a game.js with NO leftover
__TOKEN__ placeholders and valid JS syntax; and the gate has TEETH — it FAILS a game.js with a
surviving placeholder and FAILS one with broken syntax. node-missing degrades the syntax half to
skip (never a false fail); the token half always runs.
"""
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))                 # gates (emit_integrity_gate)
sys.path.insert(0, str(HERE.parent))          # engine (engine_game_emit)
import emit_integrity_gate as eig             # noqa: E402
import engine_game_emit as emit               # noqa: E402

GAMES = HERE.parents[2]                        # gates -> engine -> pipeline -> forgeflow-games
GOLDEN = {
    "platformer": GAMES / "pipeline/engine/golden/platformer.content.json",
    "shmup": GAMES / "pipeline/engine/golden/shmup.content.json",
    "tactics3d": GAMES / "pipeline/engine/golden/tactics3d.content.json",
}
n = 0
fails = []


def chk(label, ok, detail=None):
    global n
    n += 1
    if not ok:
        fails.append(label + (f"  [{detail}]" if detail else ""))


# ── A) every emitted golden is shippable: no leftover tokens, valid syntax ────
node_seen = False
for genre, content in GOLDEN.items():
    if not content.exists():
        chk(f"golden exists: {genre}", False, str(content)); continue
    out = Path(tempfile.mkdtemp()) / genre
    emit.build(str(content), out, slug=genre)
    r = eig.check_emit_integrity(out)
    chk(f"{genre}: emit integrity PASS", r["ok"], r["reason"])
    chk(f"{genre}: no leftover placeholders", not r["leftover_tokens"], ", ".join(r["leftover_tokens"]))
    if r["syntax_ok"] is True:
        node_seen = True

# ── B) BOTH-WAYS: the gate must FAIL broken emits ─────────────────────────────
with tempfile.TemporaryDirectory() as td:
    d = Path(td) / "leftover"
    d.mkdir()
    (d / "game.js").write_text('export const GAME = { sprites: {}, setup(ctx){ ctx.spawn({sprite: __FOE_SPR__}); }, update(){} };', encoding="utf-8")
    r = eig.check_emit_integrity(d)
    chk("gate FAILS a leftover __TOKEN__", not r["ok"] and "__FOE_SPR__" in r["leftover_tokens"], r["reason"])

with tempfile.TemporaryDirectory() as td:
    d = Path(td) / "broken"
    d.mkdir()
    (d / "game.js").write_text('export const GAME = { setup(ctx){ const x = ( ; }, update(){} };', encoding="utf-8")
    r = eig.check_emit_integrity(d)
    if r["syntax_ok"] is None:
        print("  (note: node unavailable — syntax both-ways check skipped)")
    else:
        chk("gate FAILS broken JS syntax", not r["ok"] and r["syntax_ok"] is False, r["reason"])

with tempfile.TemporaryDirectory() as td:
    d = Path(td) / "good"
    d.mkdir()
    (d / "game.js").write_text('export const GAME = { sprites: {}, setup(ctx){ ctx.spawn({ tag: "player", sprite: "hero" }); }, update(){} };', encoding="utf-8")
    r = eig.check_emit_integrity(d)
    chk("gate PASSES a clean game.js", r["ok"], r["reason"])

if not node_seen:
    print("  (note: node syntax validation did not run on goldens — token scan still enforced)")

if fails:
    print(f"EMIT-INTEGRITY: FAIL ({len(fails)} of {n} checks)")
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print(f"EMIT-INTEGRITY: PASS ({n} checks)")
sys.exit(0)
