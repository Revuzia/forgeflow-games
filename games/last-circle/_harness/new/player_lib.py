"""player_lib - shared helpers for the lane PLAYER gates (wave 4). Imported by the player_*.py gates only.

`--isolate`: while several lanes edit games/last-circle at the same time, a half-written file of another lane (loot.js threw
"Cannot create property 'visible' on number" mid-edit) fails a gate that has nothing to do with it. With --isolate the page is served
from git HEAD (the frozen build, common.GitBlobs) and ONLY this lane's files (OVERLAY / OVERLAY_PREFIXES) come from the working copy.
Without the flag the gates behave exactly like every other gate (`--disk` = the whole working copy), which is what the orchestrator
runs after integration.
"""
from __future__ import annotations

import mimetypes
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402

# the files lane PLAYER owns / consumes from lane ART-A (clips + canopy), relative to games/last-circle
OVERLAY = {
    "runtime/3d/royale/player.js",
    "runtime/3d/royale/rig_pipeline.js",
    "runtime/3d/royale/nametags.js",
}
OVERLAY_PREFIXES = ("assets/chars/clips/", "assets/props/canopy.")


def add_args(ap):
    ap.add_argument("--isolate", action="store_true",
                    help="serve git HEAD plus ONLY lane PLAYER's files (+ ART-A's clips/canopy) from the working copy, so other lanes' "
                         "half-written edits cannot fail this gate (implies --disk)")
    ap.add_argument("--overlay-root", default=None, metavar="DIR",
                    help="with --isolate: take the overlay files from DIR (a copy laid out like games/last-circle) instead of the working copy, "
                         "so a long gate keeps testing one frozen version of the lane while the files are edited")
    return ap


def prepare(args):
    """Call right after parse_args()."""
    if getattr(args, "isolate", False):
        args.disk = True
        if not getattr(args, "rev", None):
            args.rev = "HEAD"


def _is_overlay(rel):
    return rel in OVERLAY or any(rel.startswith(p) for p in OVERLAY_PREFIXES)


def overlay(session, args):
    """Call right after the Session started (before the first goto). Safe no-op without --isolate."""
    if not getattr(args, "isolate", False) or session.disk is None:
        return
    root = getattr(args, "overlay_root", None) or C.ROOT

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


def served_note(v, args):
    if getattr(args, "isolate", False):
        v.data["servedFrom"] = "git %s + working-copy overlay: %s, %s*" % (getattr(args, "rev", "HEAD"), sorted(OVERLAY), list(OVERLAY_PREFIXES))
