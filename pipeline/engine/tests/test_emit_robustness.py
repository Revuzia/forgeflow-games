#!/usr/bin/env python3
"""test_emit_robustness.py — locks in the Tier-5 robustness contract for EMITTED engine games.

Three properties make a generated 2D game robust in the field. All three are currently TRUE but were
UNGUARDED — a future engine/emitter refactor could silently break any of them with no test failing.
This suite builds real golden games and asserts each, so the contract can't regress unnoticed:

  (a) MOBILE-PLAYABLE — the engine's Input falls back from keyboard to on-screen touch zones, so the
      game is playable with no keyboard. axisX/axisY must keep BOTH a keyboard branch AND a pointer
      screen-zone branch; a tap must fire, a top-zone tap must jump; index.html must ship the
      device-width viewport. (Strip the pointer branch and mobile silently dies — this catches it.)
  (a) CDN-PROOF — emitted games import the engine + game LOCALLY (./src/engine.js, ./game.js) with zero
      external http(s) script/import refs, so a CDN outage can't break a shipped game. Better than a
      "vendor fallback": there is no vendor to fall back from. This asserts that stays true.
  (b) NO FALSE GAMEPAD CLAIM — we don't advertise gamepad support that isn't wired. deploy meta keeps
      controls_gamepad empty and the emitted output makes no 'gamepad' claim.

Deterministic, no browser, no claude -p: build -> assert on the emitted artifacts + engine source.
"""
import re
import sys
import tempfile
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
GAMES = ENGINE.parents[1]
sys.path.insert(0, str(ENGINE))
import engine_game_emit as emit  # noqa: E402

GENRES = [("platformer", "platformer.content.json"), ("shmup", "shmup.content.json")]
_checks = 0


def _ok(cond, msg):
    global _checks
    _checks += 1
    if not cond:
        raise AssertionError(msg)


def _build(slug, content_file):
    out = Path(tempfile.mkdtemp()) / slug
    emit.build(str(ENGINE / "golden" / content_file), out, slug=slug)
    return out


def _read(p):
    return p.read_text(encoding="utf-8", errors="replace")


def _method_body(src, name):
    # grab `name() { ... }` up to the matching 2-space-indented closing brace (engine style)
    m = re.search(name + r"\(\)\s*\{.*?\n  \}", src, re.S)
    return m.group(0) if m else ""


def test_mobile_touch_and_viewport():
    for slug, cf in GENRES:
        out = _build(slug, cf)
        html = _read(out / "index.html")
        _ok("width=device-width" in html, f"{slug}: index.html missing device-width viewport (mobile scaling)")
        rt = _read(out / "src" / "game_runtime.js")
        ax = _method_body(rt, "axisX")
        ay = _method_body(rt, "axisY")
        _ok(ax and ("KeyD" in ax or "ArrowRight" in ax), f"{slug}: axisX lost its keyboard branch")
        _ok("this.pointer.down" in ax, f"{slug}: axisX lost its touch pointer-zone branch — mobile movement broken")
        _ok("this.pointer.down" in ay, f"{slug}: axisY lost its touch pointer-zone branch — mobile movement broken")
        # tap-to-act contract: a tap fires (KeyF) and a top-zone tap jumps
        pr = _method_body(rt, "pressed") or rt
        _ok("this.pointer._justDown" in pr and "KeyF" in pr, f"{slug}: tap-to-fire contract missing in Input.pressed")
        _ok(("Space" in pr or "ArrowUp" in pr), f"{slug}: top-zone tap-to-jump contract missing in Input.pressed")


def test_no_cdn_self_contained():
    extern = re.compile(r'(?:src|href)\s*=\s*["\']https?://|import[^;]*?from\s*["\']https?://')
    for slug, cf in GENRES:
        out = _build(slug, cf)
        files = [out / "index.html", out / "game.js"] + list((out / "src").glob("*.js"))
        for f in files:
            hits = extern.findall(_read(f))
            _ok(not hits, f"{slug}: {f.name} has an external http(s) script/import ({hits[:1]}) — not CDN-proof")


def test_no_false_gamepad_claim():
    # deploy meta must not advertise gamepad support
    dep = _read(ENGINE / "deploy_engine_game.py")
    _ok('"controls_gamepad": ""' in dep, "deploy_engine_game.py no longer keeps controls_gamepad empty")
    for slug, cf in GENRES:
        out = _build(slug, cf)
        html = _read(out / "index.html").lower()
        gamejs = _read(out / "game.js").lower()
        _ok("gamepad" not in html, f"{slug}: index.html makes a gamepad claim that isn't wired")
        _ok("gamepad" not in gamejs, f"{slug}: game.js makes a gamepad claim that isn't wired")


def run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {fn.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"  ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"EMIT-ROBUSTNESS: {'PASS' if not failed else 'FAIL'} ({_checks} checks across {len(fns)} tests)")
    return failed == 0


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
