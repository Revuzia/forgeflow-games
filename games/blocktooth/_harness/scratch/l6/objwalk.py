#!/usr/bin/env python
"""L6 scratch: place objectives, WALK (real keys) toward each until it is in view, screenshot the dressing."""
import argparse, json, math, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate, ensure_play, world_to_keys  # noqa: E402

ONSCREEN = r"""(kind) => { const c = window.__BT__.debugCore, W = window.__BT__.world, cam = c.camera;
  const o = W.map.objectives.find(o => o.alive && o.kind === kind); if (!o) return null;
  const v = new cam.position.constructor(o.x, 0, o.z); v.project(cam);
  return Math.abs(v.x) < 0.7 && v.y > -0.55 && v.y < 0.8 && v.z < 1; }"""

def walk_to(sess, kind, stop_h, timeout=20.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if sess.screen() != "play":
            sess.release_all(); ensure_play(sess, 6); continue
        s = sess.state() or {}
        o = next((o for o in s.get("v2", {}).get("objectives", []) if o["kind"] == kind), None)
        W = sess.js("() => { const T = window.__BT__.world.titan; return [T.x, T.z, T.height]; }")
        if not o:
            sess.release_all(); return None
        dx, dz = o["x"] - W[0], o["z"] - W[1]
        if math.hypot(dx, dz) < stop_h * W[2] or sess.js(ONSCREEN, kind):
            sess.release_all(); return math.hypot(dx, dz)
        sess.hold(world_to_keys(dx, dz))
        time.sleep(0.08)
    sess.release_all()
    return -1

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument("--ranks", default="0,2,4")
    ap.add_argument("--stop", type=float, default=5.0)
    args = ap.parse_args()
    sess = Session(args, "l6walk"); sess.start()
    try:
        for rank in [int(r) for r in args.ranks.split(",")]:
            sess.goto(build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=7))
            sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
            sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.noSpawns(true); c.killAll(); }")
            if rank:
                sess.js("(r) => window.__BT__.cheat.rank(r)", rank); time.sleep(3.0); ensure_play(sess, 10)
            for kind in ("overloadSite", "recordsAnnex"):
                ok, v = sess.cheat("objective", kind)
                print("Size %d %s -> %s" % (rank + 1, kind, v))
                if not ok or v is None:
                    continue
                d = walk_to(sess, kind, args.stop)
                time.sleep(0.8)
                print("   walked, dist", d)
                sess.screenshot(os.path.join(SHOTS, "l6", "walk_%s_s%d.png" % (kind, rank + 1)))
    finally:
        sess.close()

if __name__ == "__main__":
    main()
