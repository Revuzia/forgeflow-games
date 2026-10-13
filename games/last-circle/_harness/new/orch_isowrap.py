#!/usr/bin/env python
"""orch_isowrap - run ANY existing gate with lane ORCH's isolation (wave 4 dev tool, not a gate).

    python _harness/new/orch_isowrap.py bootcheck.py [that gate's own flags]
    python _harness/new/orch_isowrap.py framecheck.py --skip space
    python _harness/new/orch_isowrap.py bootcheck.py --overlay runtime/3d/royale/storm.js   # + more working-copy files

The named gate (a file in _harness/) runs unchanged, except that the page is served from git HEAD plus ONLY
runtime/3d/ffg_royale3d.js (and any --overlay <rel> files / --overlay-prefix <rel/> dirs) from the working copy, so other lanes'
half-written files cannot fail it. Same mechanism as player_isowrap.py. Exit code is the wrapped gate's.
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
import common as C  # noqa: E402

OVERLAY = {"runtime/3d/ffg_royale3d.js"}
PREFIXES = []


def install(session):
    if session.disk is None:
        return

    def pred(url):
        u = urllib.parse.urlparse(url)
        if not u.path.startswith(C.GAME_PATH):
            return False
        rel = urllib.parse.unquote(u.path[len(C.GAME_PATH):])
        ok = rel in OVERLAY or any(rel.startswith(p) for p in PREFIXES)
        return ok and os.path.isfile(os.path.join(C.ROOT, rel.replace("/", os.sep)))

    def handle(route):
        u = urllib.parse.urlparse(route.request.url)
        rel = urllib.parse.unquote(u.path[len(C.GAME_PATH):])
        full = os.path.join(C.ROOT, rel.replace("/", os.sep))
        with open(full, "rb") as f:
            body = f.read()
        ext = os.path.splitext(full)[1].lower()
        ct = C.CTYPES.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
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
    argv = [a for a in sys.argv[2:] if a not in ("--disk", "--isolate")]
    while "--overlay" in argv:
        i = argv.index("--overlay")
        OVERLAY.add(argv[i + 1])
        del argv[i:i + 2]
    while "--overlay-prefix" in argv:
        i = argv.index("--overlay-prefix")
        PREFIXES.append(argv[i + 1])
        del argv[i:i + 2]
    if "--rev" not in argv:
        argv += ["--rev", "HEAD"]
    print("orch_isowrap: git HEAD + working copy of %s %s" % (sorted(OVERLAY), PREFIXES))
    sys.argv = [path] + argv
    orig_start = C.Session.start

    def start(self):
        orig_start(self)
        install(self)

    C.Session.start = start
    try:
        runpy.run_path(path, run_name="__main__")
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
