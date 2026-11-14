#!/usr/bin/env python
"""L6 scratch: the titan `ultimate` clip — no foes, Size III, frozen at roar / blast moments; centre crops."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate, ensure_play  # noqa: E402
from ultshots import WAIT_JS  # noqa: E402
ap = add_common_args(argparse.ArgumentParser())
ap.add_argument("--titans", default="molo,voltkite,hearthback,briarwick")
ap.add_argument("--rank", type=int, default=2)
args = ap.parse_args()
sess = Session(args, "l6clip"); sess.start()
from PIL import Image
try:
    for titan in args.titans.split(","):
        sess.goto(build_url(args.base, autostart=1, dev=1, titan=titan, biome="grideast", seed=9))
        sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
        sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.noSpawns(true); c.killAll(); }")
        if args.rank: sess.js("(r) => window.__BT__.cheat.rank(r)", args.rank); time.sleep(3.0); ensure_play(sess, 10)
        sess.js("() => window.__BT__.cheat.killAll()")
        for ph, t in (("idle", 0), ("roar", 0.4), ("blast", 0.3)):
            if ph != "idle":
                sess.js("() => window.__BT__.freeze(false)")
                if ph == "roar":
                    sess.js("() => window.__BT__.cheat.ult(100)"); time.sleep(0.2); sess.press("KeyE")
                info = sess.js(WAIT_JS, [ph, t])
            else:
                info = None
                sess.js("() => window.__BT__.freeze(true)")
            time.sleep(0.25)
            p = os.path.join(SHOTS, "l6", "clip_%s_%s.png" % (titan, ph))
            sess.screenshot(p)
            im = Image.open(p); W, H = im.size
            im.crop((int(W * 0.3), int(H * 0.2), int(W * 0.7), int(H * 0.8))).save(p.replace(".png", "_crop.png"))
            print(titan, ph, json.dumps(info))
        sess.js("() => window.__BT__.freeze(false)")
finally:
    sess.close()
