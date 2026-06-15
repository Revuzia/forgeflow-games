#!/usr/bin/env python3
"""Deterministic tests for perf_gate — the FPS verdict + static glow scan.

No browser, no claude -p. Proves the gate fires both ways: smooth FPS passes, sustained-low FPS
fails (the lumen-run case), empty/blocked samples skip (never a false fail), and the static glow
scan flags an over-budget emitted source while a clean one passes.
"""
import sys
import tempfile
from pathlib import Path

GATES = Path(__file__).resolve().parents[1] / "gates"
sys.path.insert(0, str(GATES))
from perf_gate import fps_verdict, static_perf_scan, GLOW_BUDGET  # noqa: E402


def _s(*fps):
    return [{"t": i, "fps": f} for i, f in enumerate(fps)]


def test_fps_smooth_passes():
    v = fps_verdict(_s(58, 60, 60, 59, 60, 58, 60))
    assert v["verdict"] == "pass", v
    assert v["avg_fps"] >= 58


def test_fps_sustained_low_fails():
    # the lumen-run shape: stuck in the low 20s -> must FAIL
    v = fps_verdict(_s(60, 60, 22, 21, 23, 20, 22))  # first 2 are warmup, dropped
    assert v["verdict"] == "fail", v


def test_fps_single_dip_still_passes():
    # one outlier dip in an otherwise-smooth run should NOT fail (avg stays high, min floor 24)
    v = fps_verdict(_s(60, 60, 59, 58, 60, 57, 59, 58))
    assert v["verdict"] == "pass", v


def test_fps_warmup_spikes_ignored():
    # the first 2 samples are garbage (compile/decode); they must not drag the verdict
    v = fps_verdict(_s(8, 12, 60, 59, 60, 58, 60))
    assert v["verdict"] == "pass", v


def test_fps_no_samples_skips():
    assert fps_verdict([])["verdict"] == "skip"
    assert fps_verdict([{"t": 0}, {"t": 1, "fps": 0}])["verdict"] == "skip"


def test_static_glow_clean_passes():
    d = Path(tempfile.mkdtemp())
    (d / "game.js").write_text("ctx.spawn('coin'); ctx.glow(player); ctx.glow(goal);", encoding="utf-8")
    r = static_perf_scan(d)
    assert r["ok"] and r["verdict"] == "pass", r
    assert r["glows"] == 2


def test_static_glow_over_budget_warns():
    d = Path(tempfile.mkdtemp())
    (d / "game.js").write_text("\n".join(f"e{i}.glow();" for i in range(GLOW_BUDGET + 10)), encoding="utf-8")
    r = static_perf_scan(d)
    assert not r["ok"] and r["verdict"] == "warn", r
    assert r["glows"] == GLOW_BUDGET + 10


def test_static_no_gamejs_skips():
    d = Path(tempfile.mkdtemp())
    r = static_perf_scan(d)
    assert r["verdict"] == "skip" and r["ok"], r


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
    print(f"perf_gate: {len(fns) - failed}/{len(fns)} passed")
    return failed == 0


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
