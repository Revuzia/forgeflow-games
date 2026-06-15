#!/usr/bin/env python3
"""run_all_tests.py — the games pipeline's CI entry: runs every suite, exit 0 only if ALL pass.
Used by (a) the nightly PRE-FLIGHT gate (a bad commit must never reach the 1:30 AM run untested —
audit 2026-06-11) and (b) the git pre-push hook (pipeline/engine/git_hooks/pre-push).
~60-120s total; hermetic (suites prove they leave production state untouched)."""
import subprocess
import sys
import time
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
SUITES = [
    "test_engine_authoring.py",
    "test_build_target.py",
    "test_orchestrator.py",
    "gates/test_ai_qa_panel.py",
    "test_no_primitives.py",
    "gates/test_scope_gate.py",
    "gates/test_render_gates.py",
    "gates/test_asset_staging.py",
    "gates/test_kernel_target.py",
    "gates/test_emit_integrity.py",
    "tests/test_perf_gate.py",
]


def main():
    t0 = time.time()
    failed = []
    for s in SUITES:
        r = subprocess.run([sys.executable, str(ENGINE / s)], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=240, cwd=str(ENGINE))
        tail = (r.stdout or "").strip().splitlines()[-1:] or ["(no output)"]
        status = "PASS" if r.returncode == 0 else "FAIL"
        print(f"  [{status}] {s:34} {tail[0][:80]}")
        if r.returncode != 0:
            failed.append(s)
    print(f"CI: {'PASS' if not failed else 'FAIL'} — {len(SUITES) - len(failed)}/{len(SUITES)} suites "
          f"in {time.time() - t0:.0f}s" + ("" if not failed else "  failed: " + ", ".join(failed)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
