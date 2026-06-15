#!/usr/bin/env python3
"""perf_gate.py — the single, TESTED home for a game's perf verdict.

Two complementary checks, both deterministic (same input -> same verdict, no claude -p):

  1. fps_verdict(fps_samples)  — the RUNTIME gate. The kernel exposes window.__PERF__.getPerformance()
     and the live playtest_bot samples it; this function turns that sample stream into pass/fail.
     This is the gate that actually caught lumen-run's choppiness. It lived inline in playtest_bot;
     centralised here so the threshold has ONE definition and a deterministic unit test (feed it
     synthetic sample arrays, assert the verdict) instead of only ever running behind a live browser.

  2. static_perf_scan(game_dir) — a cheap STATIC smell test on the emitted source. It can't see
     procedural runtime spawn counts (those are generated in the kernel loop, not declared), so it
     only flags the one static signal that survives: per-object glow-shader density in the emitted
     game source above what scene bloom should be carrying. Advisory, never the sole fail.

Usage:
    from perf_gate import fps_verdict, static_perf_scan, check_perf
    v = fps_verdict([{"fps": 58}, {"fps": 60}, ...])     # -> {"verdict": "pass", "avg_fps":..., ...}
    s = static_perf_scan(game_dir)                         # -> {"ok": True/False, "glows":..., ...}
CLI: python perf_gate.py <game_dir>          (runs the static scan; FPS gate is live-only)
"""
import argparse
import re
import sys
from pathlib import Path

# Runtime FPS thresholds. 60 is the rAF ceiling; 40 avg / 24 min tolerates honest dips on a busy
# scene while still failing the sustained-low-FPS case (lumen-run sat in the low 20s).
AVG_FPS_FLOOR = 40
MIN_FPS_FLOOR = 24
WARMUP_DROP = 2          # ignore the first N samples (shader compile / asset decode spikes)

# Static glow-density budget. The kernel caps LIVE per-object glow emission at 14; a source that
# *writes* far more glow call-sites than that is leaning on per-object shaders instead of one scene
# bloom pass — the exact thing that tanked lumen-run before the kernel fix.
GLOW_BUDGET = 48
_GLOW_RE = re.compile(r'\.glow\s*\(|addGlow|postFX\.add(?!Bloom)')


def fps_verdict(fps_samples, avg_floor=AVG_FPS_FLOOR, min_floor=MIN_FPS_FLOOR, warmup_drop=WARMUP_DROP):
    """Turn a list of {"fps": n} samples (from window.__PERF__) into a perf verdict.

    No usable samples (Canvas mode / WebGL blocked / __PERF__ absent) -> 'skip', never a false fail.
    """
    vals = [s["fps"] for s in (fps_samples or [])[warmup_drop:] if isinstance(s, dict) and s.get("fps")]
    if not vals:
        return {"verdict": "skip", "avg_fps": None, "min_fps": None, "samples": 0,
                "reason": "no FPS samples (Canvas/WebGL-blocked/__PERF__ absent) — not scored"}
    avg = sum(vals) / len(vals)
    lo = min(vals)
    ok = avg >= avg_floor and lo >= min_floor
    return {"verdict": "pass" if ok else "fail", "avg_fps": round(avg, 1), "min_fps": lo,
            "samples": len(vals), "ok": ok,
            "reason": "smooth" if ok else f"sustained low FPS (avg {avg:.1f} < {avg_floor} or min {lo} < {min_floor})"}


def _read(p, cap=1_500_000):
    try:
        return p.read_text(encoding="utf-8", errors="replace")[:cap]
    except Exception:
        return ""


def static_perf_scan(game_dir, glow_budget=GLOW_BUDGET):
    """Cheap static smell test on emitted source. Advisory: flags per-object glow over budget."""
    game_dir = Path(game_dir)
    js = _read(game_dir / "game.js")
    if not js:
        return {"ok": True, "verdict": "skip", "glows": 0,
                "reason": "no game.js (non-emitter game) — perf scored live by the play-tester"}
    glows = len(_GLOW_RE.findall(js))
    ok = glows <= glow_budget
    return {"ok": ok, "verdict": "pass" if ok else "warn", "glows": glows,
            "reason": "within glow budget" if ok else f"{glows} per-object glow call-sites > {glow_budget} budget (let scene bloom carry the glow)"}


def check_perf(game_dir, fps_samples=None):
    """Convenience: combine the live FPS verdict (if samples given) with the static scan."""
    static = static_perf_scan(game_dir)
    out = {"slug": Path(game_dir).name, "static": static}
    if fps_samples is not None:
        out["fps"] = fps_verdict(fps_samples)
        out["ok"] = (out["fps"]["verdict"] != "fail") and static["ok"]
    else:
        out["ok"] = static["ok"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("game_dir")
    a = ap.parse_args()
    s = static_perf_scan(a.game_dir)
    print(f"perf-static[{Path(a.game_dir).name}]: {s['verdict']} — glows {s['glows']} — {s['reason']}")
    print("  (runtime FPS gate runs live via playtest_bot -> perf_gate.fps_verdict)")
    return 0 if s["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
