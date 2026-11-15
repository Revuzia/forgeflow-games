#!/usr/bin/env python
"""loot_isowrap - run ANY existing gate with lane LOOT's isolation (wave 4 dev tool, not a gate).

    python _harness/new/loot_isowrap.py framecheck.py [that gate's own flags]
    python _harness/new/loot_isowrap.py new/loot_beams_rings.py --only pools,clamp
    python _harness/new/loot_isowrap.py bootcheck.py --rev <rev>       # another base revision (default HEAD)

The named gate (a path under _harness/) runs unchanged, except that the page is served from git HEAD (or --rev) plus ONLY lane
LOOT's file (runtime/3d/royale/loot.js) from the working copy, so other lanes' half-written files cannot fail it. Exit code is
the wrapped gate's. Pass --base-only to serve the base revision WITHOUT the overlay (the "before" column of an A/B).
"""
from __future__ import annotations

import mimetypes
import os
import runpy
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.dirname(HERE)
sys.path.insert(0, HARNESS)
sys.path.insert(0, HERE)
import common as C  # noqa: E402

OVERLAY = {"runtime/3d/royale/loot.js"}


def overlay(session):
    if session.disk is None:
        return

    def pred(url):
        u = urllib.parse.urlparse(url)
        if not u.path.startswith(C.GAME_PATH):
            return False
        return urllib.parse.unquote(u.path[len(C.GAME_PATH):]) in OVERLAY

    def handle(route):
        u = urllib.parse.urlparse(route.request.url)
        rel = urllib.parse.unquote(u.path[len(C.GAME_PATH):])
        full = os.path.join(C.ROOT, rel.replace("/", os.sep))
        with open(full, "rb") as f:
            body = f.read()
        ct = C.CTYPES.get(os.path.splitext(full)[1].lower()) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        session.disk.served += 1
        route.fulfill(status=200, body=body, headers={"Content-Type": ct, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})

    session.disk.overrides.append((pred, handle))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    target = sys.argv[1]
    path = target if os.path.isabs(target) else os.path.join(HARNESS, target)
    if not os.path.isfile(path):
        print("no such gate: %s" % path)
        return 2
    argv = [a for a in sys.argv[2:] if a not in ("--disk", "--isolate", "--base-only")]
    base_only = "--base-only" in sys.argv[2:]
    if "--rev" not in argv:
        argv += ["--rev", "HEAD"]
    sys.argv = [path] + argv
    print("loot_isowrap: git %s%s" % (argv[argv.index("--rev") + 1], "" if base_only else " + working-copy " + ", ".join(sorted(OVERLAY))))

    orig_start = C.Session.start

    def start(self):
        orig_start(self)
        if not base_only:
            overlay(self)

    C.Session.start = start
    try:
        runpy.run_path(path, run_name="__main__")
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
