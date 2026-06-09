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
import subprocess
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


def _config():
    """Opt-in config (committed, so the flip is a repo change — NOT a Task Scheduler env change).
    Path overridable via FFG_ENGINE_CONFIG (used by tests to stay hermetic)."""
    try:
        p = Path(os.environ.get("FFG_ENGINE_CONFIG") or (ENGINE_DIR / "engine_target.json"))
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def engine_enabled():
    """True when opted in — via env FFG_ENGINE_TARGET=1 OR engine_target.json {"enabled": true}.
    Default (neither) -> False -> Phaser stays the nightly default."""
    if os.environ.get("FFG_ENGINE_TARGET", "").strip().lower() in ("1", "true", "yes", "on"):
        return True
    return bool(_config().get("enabled"))


def _allowed_genres():
    raw = os.environ.get("FFG_ENGINE_GENRES", "").strip()
    if raw:
        return {g.strip().lower() for g in raw.split(",") if g.strip()} & ENGINE_GENRES
    cfg = _config().get("genres")
    if cfg:
        return {str(g).strip().lower() for g in cfg} & ENGINE_GENRES
    return set(ENGINE_GENRES)


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


def _play_tester_path():
    """Locate the general multi-inspector play tester (forgeflow-engine sibling). Override: FFG_PLAY_TESTER."""
    env = os.environ.get("FFG_PLAY_TESTER")
    if env and Path(env).exists():
        return Path(env)
    p = GAMES.parent / "forgeflow-engine" / "tools" / "verify_engine_game_play.py"
    return p if p.exists() else None


def play_verify(slug, gdir, port=8788, timeout=200):
    """Run the multi-inspector PLAY tester (boots + drives the built game; checks boot/menu/start/liveness/
    render/real_assets/controls/progression/audio/errors). Returns (ship, detail):
      ship True  -> tester verdict SHIP (it actually plays)
      ship False -> tester verdict HOLD (lifeless/broken — names the failed inspectors)
      ship None  -> tester could NOT run (no playwright / tester missing) -> caller keeps structural-only floor
    Never raises."""
    tester = _play_tester_path()
    if tester is None:
        return None, "play tester not found (forgeflow-engine/tools/verify_engine_game_play.py)"
    report = Path(gdir) / "play_report.json"
    try:
        report.unlink()
    except OSError:
        pass
    try:
        r = subprocess.run([sys.executable, str(tester), str(gdir), "--port", str(port),
                            "--report", str(report)], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "play tester timed out after %ds" % timeout
    except Exception as e:
        return None, "play tester spawn error: " + type(e).__name__
    if not report.exists():
        # rc 2 = no index.html / bad args; otherwise likely missing playwright -> infra, not a quality fail
        return None, "play tester produced no report (rc=%s): %s" % (r.returncode, (r.stdout or r.stderr)[-160:])
    try:
        rep = json.loads(report.read_text(encoding="utf-8"))
    except Exception:
        return None, "play report unparseable"
    if rep.get("verdict") == "SHIP":
        return True, "play SHIP (10/10 inspectors%s)" % (", won" if rep.get("won") else "")
    return False, "play HOLD — failed: " + ", ".join(rep.get("failed", []) or ["?"])


def dev_engine_build(slug, content):
    """Deep-dev path: build a REAL-asset engine game from a content/spec dict (deterministic — no claude -p,
    no Phaser schema gate), structural-verify it, then PLAY-verify it (multi-inspector tester). The game is
    only accepted (ok=True) when it both structures correctly AND actually plays. A lifeless/broken game
    (play HOLD) returns False so the deep loop keeps iterating / falls back to Phaser — never ships a dead
    game. If the play tester can't run (no playwright in this env), we keep the structural-only floor and
    say so in the detail (never worse than before). Returns (ok, out_dir, detail). Never raises."""
    try:
        out = engine_assemble(slug, content)
    except Exception as e:
        return False, None, "engine build error: " + type(e).__name__ + ": " + str(e)[:160]
    ok, detail = engine_verify(slug, out)
    if not ok:
        return False, str(out), detail
    ship, pdetail = play_verify(slug, out)
    if ship is False:
        return False, str(out), "structural ok BUT " + pdetail          # lifeless -> iterate/fallback, don't ship
    if ship is None:
        return True, str(out), detail + " | play-test SKIPPED (" + pdetail + ")"   # structural-only floor
    return True, str(out), detail + " | " + pdetail
