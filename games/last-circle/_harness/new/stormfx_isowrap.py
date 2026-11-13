#!/usr/bin/env python
"""stormfx_isowrap - run ANY existing gate with lane STORMFX's isolation (wave 4 dev tool, not a gate).

    python _harness/new/stormfx_isowrap.py framecheck.py [that gate's own flags]
    python _harness/new/stormfx_isowrap.py new/stormfx_storm.py
    python _harness/new/stormfx_isowrap.py bootcheck.py --rev <rev>       # another base revision (default HEAD)

The named gate (a path under _harness/) runs unchanged, except that the page is served from git HEAD (or --rev) plus ONLY lane
STORMFX's files from the working copy (storm.js, fx.js, ffg_kernel_3d.js, ffg_warmup.js, lc_output_pass.js) and the finished
ART-B files this lane consumes by feature detection (assets/fx/*.png, the vendored meshopt decoder), so other lanes'
half-written files cannot fail it. Exit code is the wrapped gate's. --base-only serves the base revision WITHOUT the overlay
(the "before" column of an A/B).
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

OVERLAY = {
    "runtime/3d/royale/storm.js",
    "runtime/3d/royale/fx.js",
    "runtime/3d/ffg_kernel_3d.js",
    "runtime/3d/ffg_warmup.js",
    "runtime/3d/lc_output_pass.js",
    "assets/vendor/three/examples/jsm/libs/meshopt_decoder.module.js",
}
OVERLAY_PREFIX = ("assets/fx/",)


def overlay(session):
    if session.disk is None:
        return

    def rel_of(url):
        u = urllib.parse.urlparse(url)
        if not u.path.startswith(C.GAME_PATH):
            return None
        return urllib.parse.unquote(u.path[len(C.GAME_PATH):])

    def pred(url):
        rel = rel_of(url)
        if rel is None:
            return False
        if rel in OVERLAY:
            return True
        return rel.startswith(OVERLAY_PREFIX) and ".." not in rel.split("/") and os.path.isfile(os.path.join(C.ROOT, rel.replace("/", os.sep)))

    def handle(route):
        rel = rel_of(route.request.url)
        full = os.path.join(C.ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(full):
            return route.fulfill(status=404, body="Not found", headers={"Cache-Control": "no-store"})
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
    print("stormfx_isowrap: git %s%s" % (argv[argv.index("--rev") + 1], "" if base_only else " + working-copy " + ", ".join(sorted(OVERLAY)) + " + assets/fx/*"))

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
