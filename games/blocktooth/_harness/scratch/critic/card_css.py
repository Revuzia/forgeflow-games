import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args(); args.no_serve = True
S = Session(args, "card_css"); S.start()
try:
    S.goto(build_url(args.base, autostart=1, noslate=1, seed=11, titan="voltkite")); S.wait_bt(60); S.wait_screen("play", 60); time.sleep(1)
    print(S.safe_js("() => { const c = document.querySelector('.bt-hud .bt-card') || document.querySelector('.bt-card'); const cs = getComputedStyle(c); const b = c.getBoundingClientRect(); const kids = [...c.children].map(k => { const r = k.getBoundingClientRect(); return [k.className, Math.round(r.left - b.left), Math.round(r.top - b.top), Math.round(r.width), Math.round(r.height)]; }); return { padding: cs.padding, maxHeight: cs.maxHeight, maxWidth: cs.maxWidth, overflow: cs.overflow, box: [Math.round(b.width), Math.round(b.height)], kids }; }"))
finally:
    S.close()
