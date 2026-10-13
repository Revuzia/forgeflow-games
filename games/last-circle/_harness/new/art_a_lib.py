"""art_a_lib - `--isolate` for the lane ART-A gates (art_a_clips.py, art_a_canopy.py). Not a gate.

While several lanes edit games/last-circle at once, another lane's half-written runtime file can fail a gate that only tests
ART-A's assets. With --isolate the page is served from git HEAD (common.GitBlobs, the frozen build) and ONLY ART-A's own files
(assets/chars/clips/**, assets/props/canopy.glb/.json) come from the working copy. Without the flag the gates behave like every
other gate (--disk = the whole working copy), which is the run that counts after integration.
"""
from __future__ import annotations

import mimetypes
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402

OVERLAY_PREFIXES = ("assets/chars/clips/", "assets/props/canopy.")


def add_args(ap):
    ap.add_argument("--isolate", action="store_true",
                    help="serve git HEAD plus ONLY lane ART-A's files (assets/chars/clips/**, assets/props/canopy.*) from the working "
                         "copy (implies --disk)")
    return ap


def prepare(args):
    """Call right after parse_args()."""
    if getattr(args, "isolate", False):
        args.disk = True
        if not getattr(args, "rev", None):
            args.rev = "HEAD"


def overlay(session, args):
    """Call right after the Session started (before boot). Safe no-op without --isolate."""
    if not getattr(args, "isolate", False) or session.disk is None:
        return

    def rel_of(url):
        u = urllib.parse.urlparse(url)
        if not u.path.startswith(C.GAME_PATH):
            return None
        return urllib.parse.unquote(u.path[len(C.GAME_PATH):])

    def pred(url):
        rel = rel_of(url)
        return bool(rel) and ".." not in rel.split("/") and rel.startswith(OVERLAY_PREFIXES) and \
            os.path.isfile(os.path.join(C.ROOT, rel.replace("/", os.sep)))

    def handle(route):
        rel = rel_of(route.request.url)
        full = os.path.join(C.ROOT, rel.replace("/", os.sep))
        with open(full, "rb") as f:
            body = f.read()
        ext = os.path.splitext(full)[1].lower()
        ct = C.CTYPES.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        session.disk.served += 1
        route.fulfill(status=200, body=body, headers={"Content-Type": ct, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})

    session.disk.overrides.append((pred, handle))


def served_note(v, args):
    if getattr(args, "isolate", False):
        v.data["servedFrom"] = "git %s + working-copy overlay: %s*" % (getattr(args, "rev", "HEAD"), list(OVERLAY_PREFIXES))
        print("%s: isolate = %s" % (v.gate if hasattr(v, "gate") else "art_a", v.data["servedFrom"]), flush=True)
