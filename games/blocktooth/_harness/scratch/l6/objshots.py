#!/usr/bin/env python
"""L6 scratch preview: objectives (+ markers) at Size I / III / V and the five power-up tokens at Size III.

    python _harness/scratch/l6/objshots.py --base http://localhost:5257/ --no-serve
"""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate, print_diagnostics, diag_problems  # noqa: E402

SPREAD_PU = r"""() => {
  const W = window.__BT__.world, T = W.titan, H = T.height;
  const s = Math.sin(T.heading), c = Math.cos(T.heading);
  const live = W.map.powerups.filter(p => p.alive);
  live.forEach((p, i) => { const side = (i - (live.length - 1) / 2) * 1.3 * H; p.x = T.x + s * 3.2 * H + c * side; p.z = T.z + c * 3.2 * H - s * side; });
  return live.map(p => p.kind);
}"""
MARKS = r"""() => { const s = window.__BT__.state(); return { dom: s.v2dom, objs: s.v2.objectives.map(o => [o.kind, o.target, +o.x.toFixed(0), +o.z.toFixed(0)]), pu: s.v2.powerups.map(p => p.kind) }; }"""


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument("--titan", default="molo")
    ap.add_argument("--biome", default="grideast")
    ap.add_argument("--ranks", default="0,2,4")
    ap.add_argument("--out", default=os.path.join(SHOTS, "l6"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    fails = []
    sess = Session(args, "l6obj")
    sess.start()
    try:
        for rank in [int(r) for r in args.ranks.split(",")]:
            sess.goto(build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=7))
            sess.wait_bt(90); sess.wait_screen(["slate", "play"], 90); dismiss_slate(sess); sess.wait_screen(["play"], 20)
            sess.js("() => { const c = window.__BT__.cheat; c.god(true); c.noSpawns(true); c.killAll(); }")
            if rank:
                sess.js("(r) => window.__BT__.cheat.rank(r)", rank)
                time.sleep(3.0)
            ids = {}
            for k, ahead in (("overloadSite", None), ("reliefDepot", 3.5), ("recordsAnnex", None)):
                ok, v = sess.cheat("objective", k, ahead) if ahead else sess.cheat("objective", k)
                if ahead:
                    H = sess.js("() => window.__BT__.world.titan.height")
                    ok, v = sess.cheat("objective", k, ahead * H)
                ids[k] = v if ok else "ERR " + str(v)
            time.sleep(1.2)
            m = sess.js(MARKS)
            print("Size %d objectives %s -> %s" % (rank + 1, json.dumps(ids), json.dumps(m)))
            name = "obj_markers_s%d" % (rank + 1)
            sess.screenshot(os.path.join(args.out, name + ".png"))
            # zoom out one notch too (markers at every zoom)
            sess.press("Minus"); sess.press("Minus"); time.sleep(1.2)
            sess.screenshot(os.path.join(args.out, name + "_zoomout.png"))
            print("  zoomed out:", json.dumps(sess.js(MARKS)["dom"]))
            if rank == 2:
                sess.press("KeyZ"); time.sleep(1.0)
                for k in ("cleanup", "demolition", "redLight", "rushHour", "backPay"):
                    ok, v = sess.cheat("powerup", k)
                    if not ok:
                        fails.append("powerup %s: %s" % (k, v))
                print("  powerups:", sess.js(SPREAD_PU))
                time.sleep(1.0)
                sess.screenshot(os.path.join(args.out, "powerups_s3.png"))
                print("  ", json.dumps(sess.js(MARKS)))
        d = sess.diagnostics()
        print_diagnostics(d)
        probs = diag_problems(d)
        if probs:
            fails.append("diagnostics: %s" % probs)
    finally:
        sess.close()
    for f in fails:
        print("  [FAIL]", f)
    print("RESULT:", "PASS" if not fails else "FAIL")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
