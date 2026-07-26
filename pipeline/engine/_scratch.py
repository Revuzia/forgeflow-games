"""Self-cleaning scratch directories for the engine pipeline and its test suites.

WHY THIS EXISTS
---------------
Several harnesses called ``tempfile.mkdtemp()`` and then exited through
``sys.exit(0)`` / ``sys.exit(1)``. ``mkdtemp`` (unlike ``TemporaryDirectory``)
never cleans up on its own, so every run left a directory behind — and because
``stage()`` copies the REAL asset set in, each one carried a full game build
including a ~60 MB ``foe2.glb``.

``run_all_tests.py`` is wired into both the nightly start and the git pre-push
hook, so this leaked on essentially every build and every push. By 2026-07-25
there were 3,652 orphans holding 30.7 GB and the C: drive was down to 0.13 GB
free, which is enough to make ``git push`` fail (it needs scratch space to pack
objects) and would eventually have corrupted state writes.

USAGE
-----
    from _scratch import scratch_dir, sweep_stale

    tmp = scratch_dir()          # removed automatically at interpreter exit
    sweep_stale()                # clears orphans from previously crashed runs

Two deliberate design choices:

* **atexit, not ``TemporaryDirectory``.** The call sites want a plain ``Path``
  that outlives the statement that created it and stays valid until the process
  ends. ``atexit`` gives exactly that, and it fires on normal return, on
  ``sys.exit()`` (which raises ``SystemExit``), and on an unhandled exception.
  It does NOT fire on ``os._exit()`` or a hard kill — which is what
  ``sweep_stale()`` is for.

* **A distinctive prefix.** Anonymous ``tmpXXXXXXXX`` names are indistinguishable
  from every other program's temp files, so a leak can only ever be cleaned by
  hand and at some risk. Everything created here is named ``ffg_*``, so a future
  leak is unambiguously ours and can be swept safely and automatically.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile
import time
from pathlib import Path

PREFIX = "ffg_"

# How long an orphan must sit untouched before a sweep will remove it. Six hours
# is comfortably longer than any single pipeline run but short enough that a
# crashed nightly is cleaned before the next one starts.
STALE_HOURS = 6

_created: list[Path] = []


def scratch_dir(prefix: str = PREFIX, keep: bool = False) -> Path:
    """Create a temp directory that removes itself when the process exits.

    Args:
        prefix: name prefix; keep the default so sweeps can find it.
        keep:   skip auto-removal (for debugging a failing run). The directory
                is still named ``ffg_*`` so a later sweep will reclaim it.

    Returns:
        Path to a new directory.
    """
    d = Path(tempfile.mkdtemp(prefix=prefix))
    _created.append(d)
    if not keep:
        atexit.register(shutil.rmtree, d, ignore_errors=True)
    return d


def sweep_stale(prefix: str = PREFIX, older_than_hours: float = STALE_HOURS,
                root: str | os.PathLike | None = None) -> tuple[int, int]:
    """Delete ``prefix``-named orphans left by runs that died without cleanup.

    Only touches directories matching our own prefix, and only those untouched
    for ``older_than_hours`` — so a concurrently running pipeline is never
    clobbered.

    Returns:
        (directories_removed, bytes_reclaimed)
    """
    base = Path(root or tempfile.gettempdir())
    cutoff = time.time() - older_than_hours * 3600
    removed = 0
    freed = 0
    try:
        entries = list(base.iterdir())
    except OSError:
        return (0, 0)

    for p in entries:
        if not p.is_dir() or not p.name.startswith(prefix):
            continue
        try:
            if p.stat().st_mtime >= cutoff:
                continue
            size = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
        except OSError:
            continue
        try:
            shutil.rmtree(p, ignore_errors=True)
            # rmtree(ignore_errors=True) can partially succeed; only count a
            # directory as reclaimed if it is actually gone.
            if not p.exists():
                removed += 1
                freed += size
        except OSError:
            continue
    return (removed, freed)


def free_bytes(path: str | os.PathLike | None = None) -> int:
    """Free space on the volume holding ``path`` (default: the temp volume)."""
    return shutil.disk_usage(Path(path or tempfile.gettempdir())).free


if __name__ == "__main__":  # pragma: no cover - operator convenience
    n, b = sweep_stale()
    print(f"swept {n} stale {PREFIX}* dirs, reclaimed {b / 1048576:.1f} MB")
    print(f"free on temp volume: {free_bytes() / 2**30:.2f} GB")
