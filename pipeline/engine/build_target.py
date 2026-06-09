#!/usr/bin/env python3
"""build_target.py — ADDITIVE, FLAG-GATED selector that lets the nightly build a game on the from-scratch
ForgeFlow ENGINE instead of Phaser. Phaser stays the DEFAULT and its code path is byte-for-byte unchanged;
the engine target is OPT-IN and ALWAYS falls back to Phaser on any failure, so the nightly can never regress.

Enable:  FFG_ENGINE_TARGET=1            (off/unset -> Phaser, the default)
Scope:   FFG_ENGINE_GENRES=platformer,shmup   (optional allowlist; default = all emitter-supported genres)

Pure decision logic + thin build/verify wrappers, dependency-injected so the routing unit-tests with no
claude -p, no playwright, no network (see test_build_target.py). The PLAYABILITY of an emitted engine game
is proven separately by forgeflow-engine/tools/verify_engine_emit.py (headless drive-to-win).
"""
import json
import os
import sys
import tempfile
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent           # forgeflow-games/pipeline/engine
GAMES = ENGINE_DIR.parent.parent                       # forgeflow-games/

# genres the engine emitter (engine_game_emit.py) can turn into a playable game today
ENGINE_GENRES = {
    "platformer", "runner", "shmup", "shooter", "arcade", "bullet-hell",
    "tactics", "tactics3d", "3d-tactics", "void-skirmish", "collect", "pickup",
}


def engine_enabled():
    """True only when the operator explicitly opts in. Default (unset) -> False -> Phaser."""
    return os.environ.get("FFG_ENGINE_TARGET", "").strip().lower() in ("1", "true", "yes", "on")


def _allowed_genres():
    raw = os.environ.get("FFG_ENGINE_GENRES", "").strip()
    if not raw:
        return set(ENGINE_GENRES)
    return {g.strip().lower() for g in raw.split(",") if g.strip()} & ENGINE_GENRES


def choose_target(genre, content=None):
    """Return True to build on the ENGINE, False for Phaser (the default). Engine only when explicitly
    enabled AND the genre is supported by the emitter AND inside the (optional) allowlist."""
    if not engine_enabled():
        return False
    g = (genre or "").lower()
    return g in ENGINE_GENRES and g in _allowed_genres()


def assemble_target(slug, content, genre, *, phaser_assemble, engine_build):
    """Choose + run the build target WITH automatic Phaser fallback. `phaser_assemble()` and
    `engine_build()` are injected zero-arg callables that return the built game dir. The engine branch
    never raises out of here — any engine failure falls back to Phaser so the nightly always ships.
    Returns (game_dir, target_str)."""
    if choose_target(genre, content):
        try:
            return engine_build(), "engine"
        except Exception as e:                       # pragma: no cover - exercised via stub in tests
            return phaser_assemble(), "phaser-fallback:" + type(e).__name__
    return phaser_assemble(), "phaser"


# ── thin wrappers the live nightly calls (import-light; heavy deps imported lazily) ───────────────
def engine_assemble(slug, content, out_root=None):
    """Build a playable engine game dir from `content` via engine_game_emit. Raises on failure (the caller
    treats a raise as 'engine unavailable' and falls back to Phaser)."""
    if str(ENGINE_DIR) not in sys.path:
        sys.path.insert(0, str(ENGINE_DIR))
    import engine_game_emit                            # sibling module (lazy)
    out = Path(out_root) if out_root else (GAMES / "games" / "_engine" / slug)
    tf = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    try:
        json.dump(content, tf)
        tf.close()
        meta = engine_game_emit.build(tf.name, out, slug=slug)
    finally:
        try:
            os.unlink(tf.name)
        except OSError:
            pass
    return Path(meta["out"])


def engine_verify(slug, gdir):
    """Deterministic STRUCTURAL gate for an emitted engine game (no playwright/claude -p in the nightly):
    game.js exports a GAME with setup+update, index.html injects __GAME_OBJECT__ in game mode, and the
    engine runtime + audio are staged. Full headless PLAYABILITY is proven by
    forgeflow-engine/tools/verify_engine_emit.py. Returns (ok, detail)."""
    gdir = Path(gdir)
    gj, idx = gdir / "game.js", gdir / "index.html"
    checks = [("game.js exists", gj.exists()), ("index.html exists", idx.exists()),
              ("engine src present", (gdir / "src" / "engine.js").exists()),
              ("audio staged", (gdir / "assets" / "audio").exists())]
    if gj.exists():
        t = gj.read_text(encoding="utf-8")
        checks.append(("game.js exports GAME", "export const GAME" in t))
        checks.append(("game.js has setup+update", "setup(" in t and "update(" in t))
    if idx.exists():
        h = idx.read_text(encoding="utf-8")
        checks.append(("index injects __GAME_OBJECT__", "__GAME_OBJECT__" in h))
        checks.append(("index runs game mode", '"game"' in h))
    failed = [n for n, ok in checks if not ok]
    return (not failed), ("structural ok (%d checks)" % len(checks)) if not failed else ("missing: " + ", ".join(failed))
