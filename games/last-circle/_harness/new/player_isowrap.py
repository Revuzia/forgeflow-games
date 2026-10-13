#!/usr/bin/env python
"""player_isowrap - run ANY existing gate with lane PLAYER's isolation (wave 4 dev tool, not a gate).

    python _harness/new/player_isowrap.py framecheck.py [that gate's own flags]
    python _harness/new/player_isowrap.py rigcheck.py --out some.json

The named gate (a file in _harness/) runs unchanged, except that the page is served from git HEAD plus ONLY lane PLAYER's files
(player.js, rig_pipeline.js, nametags.js and ART-A's assets/chars/clips + assets/props/canopy.*) from the working copy. Other lanes'
half-written files cannot fail it. See player_lib.py. Exit code is the wrapped gate's.
"""
from __future__ import annotations

import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.dirname(HERE)
sys.path.insert(0, HARNESS)
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import player_lib as PL  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    target = sys.argv[1]
    path = target if os.path.isabs(target) else os.path.join(HARNESS, target)
    if not os.path.isfile(path):
        print("no such gate: %s" % path)
        return 2
    argv = [a for a in sys.argv[2:] if a not in ("--disk", "--isolate")]
    overlay_root = None
    if "--overlay-root" in argv:
        i = argv.index("--overlay-root")
        overlay_root = argv[i + 1]
        del argv[i:i + 2]
    if "--rev" not in argv:
        argv += ["--rev", "HEAD"]
    sys.argv = [path] + argv

    orig_start = C.Session.start

    def start(self):
        orig_start(self)
        self.args.isolate = True
        self.args.overlay_root = overlay_root
        PL.overlay(self, self.args)

    C.Session.start = start
    try:
        runpy.run_path(path, run_name="__main__")
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
