#!/usr/bin/env python
"""L6 scratch preview: fire UPROAR (real E) per titan at a Size, freeze the sim at chosen blast times
(the ult view runs on the sim clock, so a frozen frame is the exact moment) and screenshot.

    python _harness/scratch/l6/ultshots.py --base http://localhost:5257/ --no-serve --titans molo --ranks 0
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate, print_diagnostics, diag_problems  # noqa: E402

BIOME = {"molo": "grideast", "voltkite": "lockwater", "hearthback": "whitestacks", "briarwick": "grideast"}

WAIT_JS = r"""
async ([phase, t]) => {
  const B = window.__BT__;
  const t0 = performance.now();
  while (performance.now() - t0 < 6000) {
    const W = B.world;
    if (W && W.ult && ((W.ult.phase === phase && W.ult.t >= t) || (phase === 'roar' && W.ult.phase === 'blast'))) {
      B.freeze(true);
      return { phase: W.ult.phase, t: W.ult.t, r: W.ult.r, H: W.titan.height, enemies: W.enemies.filter(e => e.alive).length };
    }
    await new Promise(r => requestAnimationFrame(r));
  }
  return null;
}
"""


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument("--titans", default="molo,voltkite,hearthback,briarwick")
    ap.add_argument("--ranks", default="0,4")
    ap.add_argument("--times", default="roar:0.3,blast:0.25,blast:0.7")
    ap.add_argument("--out", default=os.path.join(SHOTS, "l6"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    fails = []
    sess = Session(args, "l6ult")
    sess.start()
    try:
        for titan in args.titans.split(","):
            for rank in [int(r) for r in args.ranks.split(",")]:
                url = build_url(args.base, autostart=1, dev=1, titan=titan, biome=BIOME[titan], seed=5)
                sess.goto(url)
                sess.wait_bt(90)
                sess.wait_screen(["slate", "play"], 90)
                dismiss_slate(sess)
                sess.wait_screen(["play"], 20)
                sess.js("() => window.__BT__.cheat.god(true)")
                if rank > 0:
                    sess.js("(r) => window.__BT__.cheat.rank(r)", rank)
                    time.sleep(2.5)
                sess.js("() => { const c = window.__BT__.cheat; c.spawn('android', 24); c.spawn('buggy', 6); c.spawn('drone', 6); }")
                time.sleep(2.0)
                for spec in args.times.split(","):
                    ph, t = spec.split(":")
                    sess.js("() => window.__BT__.freeze(false)")
                    sess.js("() => window.__BT__.cheat.ult(100)")
                    time.sleep(0.25)
                    if spec == args.times.split(",")[0] or True:
                        # wait for idle + lockout? cheat.ult adds raw points; the lockout blocks charge, so wait it out
                        pass
                    sess.press("KeyE")
                    info = sess.js(WAIT_JS, [ph, float(t)])
                    name = "ult_%s_s%d_%s%s" % (titan, rank + 1, ph, t.replace(".", ""))
                    time.sleep(0.25)
                    sess.screenshot(os.path.join(args.out, name + ".png"))
                    print("%-36s %s" % (name, json.dumps(info)))
                    if not info:
                        fails.append(name + ": ult never reached " + spec)
                    sess.js("() => window.__BT__.freeze(false)")
                    time.sleep(7.5)   # ULT.lockoutS = 6 s after a fire
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
