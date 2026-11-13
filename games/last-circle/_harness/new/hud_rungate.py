#!/usr/bin/env python
"""HUD lane (Wave 4): run any harness gate on `git HEAD for every file + the working-copy hud.js (+ ART-B's assets/hud/*)`.

  python _harness/new/hud_rungate.py layoutcheck.py              [gate args...]
  python _harness/new/hud_rungate.py mobile.py
  python _harness/new/hud_rungate.py new/hud_checks.py --only phones
  python _harness/new/hud_rungate.py --overlay-root DIR leaktest.py   # take hud.js from a frozen copy laid out like games/last-circle
  HUD_RUNGATE_EXTRA=runtime/3d/royale/player.js python _harness/new/hud_rungate.py feelcheck.py   # bisect: one more working-copy file over git HEAD

Why: other lanes edit other runtime files in the same working tree while this lane is measured, so `--disk` mixes in their
half-finished code. This wrapper patches common.Session.start in memory (common.py is untouched) so the gate is served with
`--rev HEAD` plus a route override for runtime/3d/royale/hud.js and assets/hud/* (the weapon silhouettes of contract C-ART-FX,
untracked, so HEAD would answer 404 for them). Exit code and report are the gate's own. Without this wrapper the gates behave as
usual (`--disk` = the whole working copy), which is the final integration run.
"""
from __future__ import annotations

import mimetypes
import os
import runpy
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402

OVERLAY = {"runtime/3d/royale/hud.js"}
# bisecting a shared-tree failure: HUD_RUNGATE_EXTRA="runtime/3d/royale/player.js,runtime/sim/royale.js" lays those working-copy files over git HEAD too
OVERLAY |= {x.strip().replace("\\", "/") for x in os.environ.get("HUD_RUNGATE_EXTRA", "").split(",") if x.strip()}
OVERLAY_PREFIXES = ("assets/hud/",) + tuple(x.strip() for x in os.environ.get("HUD_RUNGATE_PREFIXES", "").split(",") if x.strip())   # bisecting: more untracked asset folders from the working copy


def _is_overlay(rel):
    return rel in OVERLAY or any(rel.startswith(p) for p in OVERLAY_PREFIXES)


def install_overlay(session, root):
    def pred(url):
        u = urllib.parse.urlparse(url)
        if not u.path.startswith(C.GAME_PATH):
            return False
        rel = urllib.parse.unquote(u.path[len(C.GAME_PATH):])
        return _is_overlay(rel) and os.path.isfile(os.path.join(root, rel.replace("/", os.sep)))

    def handle(route):
        u = urllib.parse.urlparse(route.request.url)
        rel = urllib.parse.unquote(u.path[len(C.GAME_PATH):])
        full = os.path.join(root, rel.replace("/", os.sep))
        with open(full, "rb") as f:
            body = f.read()
        ext = os.path.splitext(full)[1].lower()
        ct = C.CTYPES.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        session.disk.served += 1
        route.fulfill(status=200, body=body, headers={"Content-Type": ct, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})

    session.disk.overrides.append((pred, handle))


def main():
    argv = sys.argv[1:]
    root = C.ROOT
    if argv and argv[0] == "--overlay-root":
        root = os.path.abspath(argv[1])
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
        # HUD_RUNGATE_BASE=disk: base = the whole working copy (not git HEAD), so --overlay-root can swap just hud.js for another version
        # (the reverse experiment: the full shared tree with HEAD's hud.js, to see whether a failure follows my file or the other lanes')
        if getattr(self.args, "rev", None) is None and os.environ.get("HUD_RUNGATE_BASE") != "disk":
            self.args.rev = "HEAD"
        orig_start(self)
        if self.disk is not None:
            install_overlay(self, root)

    C.Session.start = start
    print("hud_rungate: %s on git HEAD + overlay %s, %s* from %s" % (os.path.basename(path), sorted(OVERLAY), list(OVERLAY_PREFIXES), root), flush=True)
    sys.argv = [path] + (["--disk"] if "--disk" not in rest else []) + rest
    sys.path.insert(0, os.path.dirname(path))
    try:
        runpy.run_path(path, run_name="__main__")
    except SystemExit as e:
        return int(e.code or 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
