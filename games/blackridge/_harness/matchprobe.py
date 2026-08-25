#!/usr/bin/env python
"""
BLACKRIDGE matchprobe — the Part 5 acceptance battery (PVP_BUILD_PLAN W10).

    python matchprobe.py --mode all --seeds 20        # the full battery
    python matchprobe.py --mode ctf --seeds 5         # quick CTF loop
    python matchprobe.py --mode all --seeds 20 --skip-scenarios
    python matchprobe.py --scenarios-only             # T-CTF battery alone

WHAT IT MEASURES (each AC names its instrument in PVP_BUILD_PLAN Part 5):
  AC-1..AC-4, AC-7..AC-12   live headless matches — REAL lanternwalk
                            colliders + nav + content.json + spawn director +
                            full bot AI, Idle human, every (mode, seed) run
                            twice for the determinism hash.
  AC-5/AC-6                 CTF flag invariants + stalemate/captureBlocked,
                            live per-tick sampling.
  AC-14                     the CTF capture bar — ≥8/20 playable, ≥17/20 +
                            no 0-0 + median first capture ≤150 s = SHIP.
                            The bar reached is REPORTED, never rounded up.
  AC-13/15/16/17/18/19      bot-comprehension scenarios T-CTF-1/2/2b/6/7/4,
                            scripted live on the real arena.
  (AC-20/AC-21 cores        objective.selftest.cjs §4 — not duplicated here.)

The battery is headless Node (the sim is THREE-free and deterministic —
GAME_DOCTRINE §4); this wrapper owns arg parsing, the UTF-8 console, and the
exit code. All measurement lives in matchprobe_runner.mjs beside this file.

Exit 0 iff every assertion held. Exit 1 = assertions failed. Exit 2 = the
runner crashed / node missing.
"""
import argparse
import os
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "matchprobe_runner.mjs")


def main() -> int:
    ap = argparse.ArgumentParser(description="BLACKRIDGE Part 5 acceptance battery")
    ap.add_argument("--mode", default="all",
                    help="'all' or a comma list of tdm/ctf/ffa (default all)")
    ap.add_argument("--seeds", default="20",
                    help="a count (N -> seeds 1..N) or a comma seed list (default 20)")
    ap.add_argument("--skip-scenarios", action="store_true",
                    help="run only the live match battery (AC-1..AC-12, AC-14)")
    ap.add_argument("--scenarios-only", action="store_true",
                    help="run only the T-CTF comprehension scenarios (AC-13..AC-19)")
    args = ap.parse_args()

    cmd = ["node", RUNNER, "--mode", args.mode, "--seeds", args.seeds]
    if args.skip_scenarios:
        cmd.append("--skip-scenarios")
    if args.scenarios_only:
        cmd.append("--skip-matches")

    env = dict(os.environ)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    # explicit line streaming: an inherited console handle can swallow the
    # runner's output entirely under some Windows pipe setups (measured:
    # rc 0, zero bytes seen), and node block-buffers into log files.
    try:
        proc = subprocess.Popen(
            cmd, cwd=os.path.dirname(HERE), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1)
    except FileNotFoundError:
        print("matchprobe: node not found on PATH", file=sys.stderr)
        return 2
    for line in proc.stdout:
        print(line, end="", flush=True)
    proc.wait()
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
