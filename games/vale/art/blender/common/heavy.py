"""Machine-wide limit on heavy processes (Blender builds, harness Chrome), so parallel agents queue
instead of oversubscribing the machine (a 10-core / 16 GB Mac swapped itself to a halt with ~15 of them).

Protocol, shared with _harness/heavy_slot.mjs: a slot is the directory $VALE_HEAVY_DIR/slot<i>
(default /tmp/vale_heavy, i < $VALE_HEAVY_SLOTS, default 3), created atomically with mkdir; its `owner`
file holds "<pid> <unix time> <label>". A slot whose owner process is gone is reclaimed, so a killed
agent never leaks one. While the system's free-memory level (kern.memorystatus_level) is under
$VALE_HEAVY_MIN_FREE % (default 12), a free slot is still not taken, for at most 3 minutes per acquire.
A child started by a slot holder inherits VALE_HEAVY_HELD=1 and takes no second slot.

    import heavy; heavy.hold("blender:marund")          # in a Blender process: held until exit
    python3 art/blender/common/heavy.py run -- <cmd...>   # wrap any command (agents' ad-hoc runs)
    python3 art/blender/common/heavy.py status            # who holds what
"""

from __future__ import annotations

import atexit
import os
import shutil
import subprocess
import sys
import time

DIR = os.environ.get("VALE_HEAVY_DIR", "/tmp/vale_heavy")
SLOTS = max(1, int(os.environ.get("VALE_HEAVY_SLOTS", "3") or 3))
MIN_FREE = int(os.environ.get("VALE_HEAVY_MIN_FREE", "12") or 12)
MEM_WAIT_MAX_S = 180


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _owner(path: str) -> tuple[int, float, str] | None:
    try:
        with open(os.path.join(path, "owner")) as f:
            pid, ts, *label = f.read().split(" ", 2)
        return int(pid), float(ts), (label[0].strip() if label else "")
    except (OSError, ValueError):
        return None


def _stale(path: str) -> bool:
    o = _owner(path)
    if o is None:   # mid-creation, or the owner died before writing: give it a moment
        try:
            return time.time() - os.path.getmtime(path) > 30
        except OSError:
            return False
    return not _alive(o[0])


def _free_level() -> int:
    try:
        return int(subprocess.run(["sysctl", "-n", "kern.memorystatus_level"], capture_output=True, text=True, timeout=5).stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return 100


def holders() -> list[str]:
    out = []
    for i in range(SLOTS):
        o = _owner(os.path.join(DIR, f"slot{i}"))
        if o:
            out.append(f"slot{i}: pid {o[0]} for {int(time.time() - o[1])}s {o[2]}")
    return out


def acquire(label: str) -> str | None:
    """Block until a slot is free; returns its path (None when a parent already holds one)."""
    if os.environ.get("VALE_HEAVY_HELD") == "1":
        return None
    os.makedirs(DIR, exist_ok=True)
    t0 = time.time(); said = 0.0; mem_wait = 0.0
    while True:
        low = _free_level() < MIN_FREE and mem_wait < MEM_WAIT_MAX_S
        if not low:
            for i in range(SLOTS):
                path = os.path.join(DIR, f"slot{i}")
                if os.path.isdir(path) and _stale(path):
                    shutil.rmtree(path, ignore_errors=True)
                try:
                    os.mkdir(path)
                except FileExistsError:
                    continue
                with open(os.path.join(path, "owner"), "w") as f:
                    f.write(f"{os.getpid()} {time.time():.0f} {label}")
                if time.time() - t0 > 5:
                    print(f"[heavy] {label}: got slot{i} after {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
                return path
        if time.time() - said > 60:
            why = f"memory free {_free_level()}% < {MIN_FREE}%" if low else f"all {SLOTS} slots busy"
            print(f"[heavy] {label}: waiting ({why}) — " + "; ".join(holders()), file=sys.stderr, flush=True)
            said = time.time()
        time.sleep(3)
        if low:
            mem_wait += 3


def release(path: str | None) -> None:
    if not path:
        return
    o = _owner(path)
    if o and o[0] == os.getpid():
        shutil.rmtree(path, ignore_errors=True)


def hold(label: str) -> None:
    """Acquire for the rest of this process (released at exit; a kill is reclaimed by the next acquire)."""
    path = acquire(label)
    if path:
        atexit.register(release, path)
        os.environ["VALE_HEAVY_HELD"] = "1"   # children of this process share the slot
    try:
        os.nice(5)    # heavy work yields to the editor, the app and the dev server
    except OSError:
        pass


def _main(argv: list[str]) -> int:
    if argv[:1] == ["status"]:
        print("\n".join(holders()) or f"all {SLOTS} slots free"); return 0
    if argv[:1] == ["run"]:
        cmd = argv[2:] if argv[1:2] == ["--"] else argv[1:]
        if not cmd:
            print(__doc__); return 2
        path = acquire("run:" + os.path.basename(cmd[0]) + " " + " ".join(cmd[1:])[:80])
        try:
            env = dict(os.environ, VALE_HEAVY_HELD="1")
            return subprocess.run(cmd, env=env).returncode
        finally:
            release(path)
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
