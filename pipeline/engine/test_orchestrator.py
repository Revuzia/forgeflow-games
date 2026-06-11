#!/usr/bin/env python3
"""test_orchestrator.py — pins the ONE-GAME state machine + run-safety invariants (audit T2).
No claude -p, no Telegram, no Playwright: everything monkeypatched/fixtured.

Covers:
  1. run lock        — acquire / second-acquire fails / release / stale-break
  2. _atomic_write   — content lands, no .tmp残 left behind
  3. pick_dev_target — oldest active wins; parked BLOCKS promotion (one-game policy);
                       DONE journals ignored; empty -> backlog promotion
  4. dev_loop Q2     — authoring stack down => "transient", journal untouched, NO template downgrade
  5. dev_loop T5     — Phaser path quarantined => "transient" unless FFG_ALLOW_PHASER=1

Run: python test_orchestrator.py   (exit 0 = pass)
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import v2_pipeline as v2  # noqa: E402
import build_target       # noqa: E402

N, FAILS = 0, []


def chk(label, ok):
    global N
    N += 1
    print(("  [PASS] " if ok else "  [FAIL] ") + label)
    if not ok:
        FAILS.append(label)


# silence side-channels
v2.notify = lambda *a, **k: None
v2.track_error = lambda *a, **k: None

# ── 1. run lock ─────────────────────────────────────────────────────────────────────────────────
tmp = Path(tempfile.mkdtemp())
v2.RUN_LOCK = tmp / ".ffg_nightly.lock"
chk("lock: first acquire", v2.acquire_run_lock() is True)
chk("lock: second acquire blocked", v2.acquire_run_lock() is False)
v2.release_run_lock()
chk("lock: re-acquire after release", v2.acquire_run_lock() is True)
os.utime(v2.RUN_LOCK, (time.time() - 4 * 3600, time.time() - 4 * 3600))   # stale (>3h)
chk("lock: stale lock broken + re-acquired", v2.acquire_run_lock() is True)
v2.release_run_lock()

# DEAD-HOLDER BREAK: a lock left by a hard-killed process (finally never ran) must be broken
# immediately — not after 3h — or a killed --once test blocks the 2:30 nightly.
import subprocess
dead = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"],
                      capture_output=True, text=True).stdout.strip()
v2.RUN_LOCK.write_text(dead, encoding="utf-8")                      # fresh mtime, dead PID
chk("lock: dead-holder lock broken instantly", v2.acquire_run_lock() is True)
v2.release_run_lock()
v2.RUN_LOCK.write_text(str(os.getpid()), encoding="utf-8")          # fresh mtime, LIVE pid (us)
chk("lock: live-holder lock still blocks", v2.acquire_run_lock() is False)
v2.release_run_lock()

# ── 2. atomic write ─────────────────────────────────────────────────────────────────────────────
tgt = tmp / "state.json"
v2._atomic_write(tgt, '{"a": 1}')
chk("atomic: content written", json.loads(tgt.read_text(encoding="utf-8"))["a"] == 1)
v2._atomic_write(tgt, '{"a": 2}')
chk("atomic: replaced", json.loads(tgt.read_text(encoding="utf-8"))["a"] == 2)
chk("atomic: no .tmp left", not list(tmp.glob("*.tmp")))

# ── 3. pick_dev_target (one-game policy) ────────────────────────────────────────────────────────
jdir = tmp / "dev_journal"
jdir.mkdir()
groot = tmp / "root"
(groot / "games").mkdir(parents=True)
v2.DEV_JOURNAL, v2.ROOT = jdir, groot


def _journal(slug, milestone="M1", parked=False, created="2026-01-01"):
    j = {"slug": slug, "genre": "platformer", "milestone": milestone, "created": created}
    if parked:
        j["parked"] = True
    (jdir / f"{slug}.json").write_text(json.dumps(j), encoding="utf-8")


_journal("older", created="2026-01-01")
_journal("newer", created="2026-02-01")
item, j = v2.pick_dev_target()
chk("pick: oldest active journal wins", item and item["slug"] == "older")

for f in jdir.glob("*.json"):
    f.unlink()
_journal("blocked-game", parked=True)
v2._load_queue = lambda: {"queue": [{"slug": "fresh", "genre": "shmup", "status": "backlog", "rating": 90}]}
item, j = v2.pick_dev_target()
chk("pick: PARKED journal blocks promotion (one-game policy)", item is None and j is None)

for f in jdir.glob("*.json"):
    f.unlink()
_journal("done-game", milestone="DONE")
item, j = v2.pick_dev_target()
chk("pick: DONE ignored -> promotes from backlog", item and item["slug"] == "fresh")

# ── 4+5. dev_loop guards (Q2 + Phaser quarantine) ───────────────────────────────────────────────
for f in jdir.glob("*.json"):
    f.unlink()
_journal("guard-game", milestone="M2")
v2.WIP = tmp / "_wip"


def _boom(*a, **k):
    raise AssertionError("template/Phaser path must not run")


build_target.dev_engine_build = _boom
v2.develop_step = _boom
v2.generate_slice = _boom
v2.generate_design_doc = lambda item: None

# Q2: authoring ON but milestone stack unavailable (returns None) -> transient, journal untouched
build_target.authoring_enabled = lambda: True
build_target.choose_target = lambda *a, **k: True
v2.engine_milestone_dev = lambda *a, **k: None
st = v2.dev_loop()
jj = json.loads((jdir / "guard-game.json").read_text(encoding="utf-8"))
chk("Q2: authoring-down => transient", st == "transient")
chk("Q2: journal milestone untouched (no DONE stamp)", jj["milestone"] == "M2")

# T5: engine routing refuses -> Phaser quarantine aborts unless opted in
os.environ.pop("FFG_ALLOW_PHASER", None)
build_target.choose_target = lambda *a, **k: False
st = v2.dev_loop()
chk("T5: Phaser path quarantined => transient", st == "transient")

print(f"\nchecks run: {N}")
print("ORCHESTRATOR: " + ("PASS (%d checks)" % N if not FAILS else "FAIL — " + "; ".join(FAILS)))
sys.exit(0 if not FAILS else 1)
