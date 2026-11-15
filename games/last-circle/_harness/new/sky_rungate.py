#!/usr/bin/env python
"""SKY lane (Wave 4): run an EXISTING harness gate on `git HEAD for every file + the working-copy maps.js`.

  python _harness/new/sky_rungate.py framecheck.py   [gate args...]
  python _harness/new/sky_rungate.py leaktest.py
  python _harness/new/sky_rungate.py --maps head bootcheck.py      # the BEFORE column: HEAD maps.js too

Why: other lanes edit other runtime files in the same working tree while this lane is measured, so `gate.py --disk` mixes in their
half-finished code (the PLAYER lane's `RIM_COOL is not defined` killed a run). This wrapper patches common.Session.start (in
memory; common.py is untouched) so the gate is served with `--rev HEAD` plus a route override for runtime/3d/royale/maps.js only.
Exit code and report are the gate's own. Gate arguments that the gate defines itself (--map, --seed, --skip ...) pass through.
"""
from __future__ import annotations

import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sky_lib as L  # noqa: E402

C = L.C


def main():
    argv = sys.argv[1:]
    which = "work"
    if argv and argv[0] == "--maps":
        which = argv[1]
        argv = argv[2:]
    if not argv:
        print(__doc__)
        return 2
    gate = argv[0]
    rest = argv[1:]
    path = gate if os.path.isabs(gate) else os.path.join(os.path.dirname(HERE), gate)
    if not os.path.isfile(path):
        print("no such gate: %s" % path)
        return 2
    orig_start = C.Session.start

    def start(self):
        if getattr(self.args, "rev", None) is None:
            self.args.rev = "HEAD"
        orig_start(self)
        if self.disk is not None:
            L.maps_override(self, which)

    C.Session.start = start
    print("sky_rungate: %s on git HEAD + %s maps.js" % (os.path.basename(path), "working-copy" if which == "work" else "HEAD"), flush=True)
    sys.argv = [path] + (["--disk"] if "--disk" not in rest else []) + rest
    sys.path.insert(0, os.path.dirname(path))
    try:
        runpy.run_path(path, run_name="__main__")
    except SystemExit as e:
        return int(e.code or 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
