#!/usr/bin/env python
"""K2b scratch: computed-style dump for one selector in a live locked run (debug aid)."""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
import argparse

ap = argparse.ArgumentParser()
add_common_args(ap)
ap.add_argument('--sel', action='append', default=[])
args = ap.parse_args()
with Session(args, 'k2b-inspect') as sess:
    sess.goto(build_url(args.base, dev=1, noslate=1, autostart=1, titan='molo', biome='grideast', seed=1337))
    sess.wait_bt(90)
    sess.wait_screen(('play', 'draft'), 90)
    ensure_play(sess, 10)
    sess.js('() => window.__BT__.freeze(true)')
    sess.cheat('gateLock', 1)
    time.sleep(0.5)
    for sel in args.sel:
        r = sess.safe_js("""(s) => Array.from(document.querySelectorAll(s)).slice(0, 4).map((e) => { const c = getComputedStyle(e); const b = e.getBoundingClientRect();
          return { tag: e.tagName, cls: String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className), rect: [b.x, b.y, b.width, b.height].map(Math.round),
                   display: c.display, position: c.position, transform: c.transform, width: c.width, height: c.height, fill: c.fill, visibility: c.visibility, opacity: c.opacity,
                   html: e.outerHTML.slice(0, 300) }; })""", sel)
        print(sel, json.dumps(r, indent=1))
