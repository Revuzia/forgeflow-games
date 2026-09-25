#!/usr/bin/env python
"""L6 scratch: open a run, fire UPROAR with no foes, freeze mid-blast and dump the L6 scene objects."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate  # noqa: E402
from ultshots import WAIT_JS  # noqa: E402

DUMP = r"""() => { const c = window.__BT__.debugCore; const out = {};
  for (const n of ['ult:sinkhole','ult:rings','ult:sprites','ult:streaks','ult:arcs','ult:pumice','ult:thorns']) {
    const o = c.scene.getObjectByName(n); if (!o) { out[n] = null; continue; }
    const wp = o.getWorldPosition ? o.getWorldPosition(new o.position.constructor()) : null;
    out[n] = { vis: o.visible, count: o.count, pos: [o.position.x, o.position.y, o.position.z].map(v => +v.toFixed(2)),
               scale: [o.scale.x, o.scale.y, o.scale.z].map(v => +v.toFixed(2)), parentVis: o.parent && o.parent.visible, inScene: !!o.parent && !!o.parent.parent };
  }
  const W = window.__BT__.world; out.titan = [W.titan.x, W.titan.z]; return out; }"""

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument("--titan", default="molo")
    ap.add_argument("--biome", default="grideast")
    ap.add_argument("--rank", type=int, default=0)
    ap.add_argument("--t", type=float, default=0.5)
    ap.add_argument("--name", default="probe")
    args = ap.parse_args()
    sess = Session(args, "l6probe"); sess.start()
    try:
        sess.goto(build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=5))
        sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
        sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.noSpawns(true); c.killAll(); }")
        if args.rank: sess.js("(r) => window.__BT__.cheat.rank(r)", args.rank); time.sleep(2.5)
        sess.js("() => window.__BT__.cheat.killAll()")
        sess.js("() => window.__BT__.cheat.ult(100)"); time.sleep(0.2)
        sess.press("KeyE")
        print(json.dumps(sess.js(WAIT_JS, ["blast", args.t])))
        time.sleep(0.3)
        print(json.dumps(sess.js(DUMP), indent=1))
        sess.screenshot(os.path.join(SHOTS, "l6", args.name + ".png"))
    finally:
        sess.close()

if __name__ == "__main__":
    main()
