#!/usr/bin/env python3
"""test_build_target.py — GS9 deterministic unit test for the nightly ENGINE/Phaser selector + fallback.
No claude -p, no playwright, no network. Proves: Phaser is the DEFAULT; engine is opt-in + genre-gated;
and ANY engine failure falls back to Phaser so the nightly always ships. Prints 'NIGHTLY-ROUTE: PASS'."""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_target  # noqa: E402

n = 0
fails = []


def chk(label, ok):
    global n
    n += 1
    if not ok:
        fails.append(label)


def setenv(target=None, genres=None, config=None):
    for k in ("FFG_ENGINE_TARGET", "FFG_ENGINE_GENRES", "FFG_ENGINE_AUTHOR"):
        os.environ.pop(k, None)
    # hermetic: point config at a nonexistent path so the real engine_target.json never leaks into the
    # env-only routing tests (unless a case sets one explicitly).
    os.environ["FFG_ENGINE_CONFIG"] = config or str(Path(tempfile.gettempdir()) / "ffg_no_such_engine_cfg.json")
    if target is not None:
        os.environ["FFG_ENGINE_TARGET"] = target
    if genres is not None:
        os.environ["FFG_ENGINE_GENRES"] = genres


# ── choose_target: Phaser is the default ──────────────────────────────────────────────────────
setenv()                                   # unset -> Phaser
chk("default (unset) -> Phaser", build_target.choose_target("platformer") is False)
chk("default not enabled", build_target.engine_enabled() is False)

setenv(target="0")
chk("FFG_ENGINE_TARGET=0 -> Phaser", build_target.choose_target("platformer") is False)

setenv(target="1")
chk("flag on + platformer -> engine", build_target.choose_target("platformer") is True)
chk("flag on + shmup -> engine", build_target.choose_target("shmup") is True)
chk("flag on + UNSUPPORTED genre -> Phaser", build_target.choose_target("rpg") is False)
chk("flag on + empty genre -> Phaser", build_target.choose_target("") is False)

setenv(target="1", genres="shmup")          # allowlist excludes platformer
chk("allowlist shmup: platformer -> Phaser", build_target.choose_target("platformer") is False)
chk("allowlist shmup: shmup -> engine", build_target.choose_target("shmup") is True)

# config-file opt-in (the committed flip, NOT a Task Scheduler env change)
_cfg = Path(tempfile.mkdtemp()) / "engine_target.json"
_cfg.write_text(json.dumps({"enabled": True, "genres": ["platformer"]}), encoding="utf-8")
setenv(config=str(_cfg))                    # env target unset; only the config enables
chk("config enabled: platformer -> engine", build_target.choose_target("platformer") is True)
chk("config enabled: shmup not in cfg genres -> Phaser", build_target.choose_target("shmup") is False)
_cfg.write_text(json.dumps({"enabled": False}), encoding="utf-8")
setenv(config=str(_cfg))
chk("config disabled -> Phaser", build_target.choose_target("platformer") is False)
setenv()                                    # back to hermetic default for the rest


# ── authoring_enabled: AI-authoring opt-in (env + config), default OFF ──────────────────────────
setenv()
chk("authoring default OFF", build_target.authoring_enabled() is False)
setenv()
os.environ["FFG_ENGINE_AUTHOR"] = "1"
chk("FFG_ENGINE_AUTHOR=1 -> authoring on", build_target.authoring_enabled() is True)
_acfg = Path(tempfile.mkdtemp()) / "engine_target.json"
_acfg.write_text(json.dumps({"enabled": True, "author": True}), encoding="utf-8")
setenv(config=str(_acfg))
chk("config author:true -> authoring on", build_target.authoring_enabled() is True)
_acfg.write_text(json.dumps({"enabled": True}), encoding="utf-8")    # enabled but no author key
setenv(config=str(_acfg))
chk("config without author key -> authoring OFF", build_target.authoring_enabled() is False)
setenv()


# ── assemble_target: routing + automatic fallback (injected stubs) ────────────────────────────
calls = {"phaser": 0, "engine": 0}


def phaser_stub():
    calls["phaser"] += 1
    return "PHASER_DIR"


def engine_stub():
    calls["engine"] += 1
    return "ENGINE_DIR"


def engine_boom():
    calls["engine"] += 1
    raise RuntimeError("emit blew up")


setenv()                                   # default
calls.update(phaser=0, engine=0)
gdir, tgt = build_target.assemble_target("s", {}, "platformer", phaser_assemble=phaser_stub, engine_build=engine_stub)
chk("default routes to phaser dir", gdir == "PHASER_DIR" and tgt == "phaser")
chk("default never calls engine", calls["engine"] == 0)

setenv(target="1")
calls.update(phaser=0, engine=0)
gdir, tgt = build_target.assemble_target("s", {}, "platformer", phaser_assemble=phaser_stub, engine_build=engine_stub)
chk("flag on routes to engine dir", gdir == "ENGINE_DIR" and tgt == "engine")
chk("flag on did not call phaser", calls["phaser"] == 0)

setenv(target="1")
calls.update(phaser=0, engine=0)
gdir, tgt = build_target.assemble_target("s", {}, "platformer", phaser_assemble=phaser_stub, engine_build=engine_boom)
chk("engine failure -> phaser FALLBACK dir", gdir == "PHASER_DIR" and tgt.startswith("phaser-fallback"))
chk("fallback actually called phaser", calls["phaser"] == 1)

setenv(target="1")
calls.update(phaser=0, engine=0)
gdir, tgt = build_target.assemble_target("s", {}, "rpg", phaser_assemble=phaser_stub, engine_build=engine_stub)
chk("unsupported genre -> phaser (no engine attempt)", gdir == "PHASER_DIR" and tgt == "phaser" and calls["engine"] == 0)


# ── engine_verify: structural gate ─────────────────────────────────────────────────────────────
def make_game_dir(good=True):
    d = Path(tempfile.mkdtemp())
    (d / "src").mkdir()
    (d / "assets" / "audio").mkdir(parents=True)
    (d / "src" / "engine.js").write_text("// engine", encoding="utf-8")
    if good:
        (d / "game.js").write_text("export const GAME = { title:'x', setup(ctx){}, update(dt,ctx){} };", encoding="utf-8")
        (d / "index.html").write_text('<script>window.__GAME_OBJECT__=GAME; window.__ENGINE_MODE__="game";</script>', encoding="utf-8")
    else:
        (d / "game.js").write_text("// nothing useful", encoding="utf-8")
        (d / "index.html").write_text("<html></html>", encoding="utf-8")
    return d


ok, detail = build_target.engine_verify("s", make_game_dir(good=True))
chk("engine_verify passes a well-formed game (" + detail + ")", ok)
ok2, detail2 = build_target.engine_verify("s", make_game_dir(good=False))
chk("engine_verify fails a malformed game", not ok2)

setenv()                                   # leave env clean

print(f"checks run: {n}")
if fails:
    print("FAILED:")
    for f in fails:
        print("  -", f)
    print("NIGHTLY-ROUTE: FAIL")
    sys.exit(1)
print(f"NIGHTLY-ROUTE: PASS ({n} checks)")
sys.exit(0)
