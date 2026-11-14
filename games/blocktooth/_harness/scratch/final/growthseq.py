#!/usr/bin/env python
"""GROWTH SEQUENCE — real-play screenshots at LV 1, 3, 5, 8 (+ cheat.level for the late levels),
default camera zoom, so a reader can SEE the titan grow on screen level by level.

    python _harness/scratch/final/growthseq.py --out <dir> [--titan molo --biome grideast --seed 3]
           [--levels 1,3,5,8,12,16,22,27,32] [--real-max 8]

Menus by real keys (title → titan → biome → DROP IN), the slate dismissed by a real key, then a
steering policy plays with page.keyboard only (the playtest.py observation JS: WASD toward the
best flattenable food, 1 on every draft). god mode is on (a cheat that never changes size or
level) so the real-play stretch cannot end in a death. Levels above --real-max are reached with
cheat.level(n) (dev), which goes through the sim's real level/rank-ups (no drafts queued).
Before each shot the keys are released and the grow tween + camera spring settle (2.4 s); every
shot records level, Size, body H, the camera distance (__BTCAM__) and the body's screen fraction
(foot → head projected through the live camera).
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import (Session, add_common_args, build_url, dismiss_slate, menus_to_slate,  # noqa: E402
                    world_to_keys)
from playtest import OBS_JS, steer  # noqa: E402

FRAC_JS = r"""
() => {
  const c = window.__BTCAM__, W = window.__H_W__ && window.__H_W__();
  if (!c || !W) return null;
  const T = W.titan, cam = c.camera;
  const P = (y) => { const v = cam.position.clone().set(T.x, y, T.z); v.project(cam); return v.y; };
  const frac = Math.abs(P(T.height) - P(0)) / 2;
  return { lv: T.level, rank: T.rank, H: +T.height.toFixed(2), growT: +T.growT.toFixed(2),
           D: +c.distance.toFixed(1), auto: +c.autoDist.toFixed(1), zoom: +c.zoom.toFixed(3),
           frac: +(100 * frac).toFixed(1) };
}
"""


def play_until(sess, target, log, budget_s=300):
    """Real keys until titan.level >= target: playtest.py's own steering policy (food seeking, stuck
    detours, hook on cooldown, periodic dash, drafts picked with real 1/2/3), run in 2-s slices."""
    t_end = time.time() + budget_s
    m = {"moved": 0.0, "propsEaten0": None, "floorsEaten0": None, "props": 0, "floors": 0, "level": 1, "rank": 0,
         "draftsTaken": 0, "draftsFailed": 0, "spacePresses": 0, "shiftPresses": 0, "hookConfirmedByCd": 0,
         "dashConfirmedByCharges": 0, "hpLost": 0.0, "pauses": 0, "end": None, "stuckDetours": 0,
         "worldExposed": False, "maxEnemies": 0}
    ns = argparse.Namespace(seconds=2.0)
    junk = os.path.join(os.environ.get("TEMP", "."), "growthseq_steer")
    os.makedirs(junk, exist_ok=True)
    while time.time() < t_end:
        s = sess.state() or {}
        if (s.get("level") or 0) >= target:
            sess.release_all()
            return True
        steer(sess, ns, "t", "b", m, [], junk, lambda *_: None)
    sess.release_all()
    return False


def settle_and_shot(sess, out, name, log, wait=2.4):
    sess.release_all()
    t_end = time.time() + 20
    while time.time() < t_end:            # a level-up opens a draft: pick it so the grow tween plays
        s = sess.state() or {}
        if s.get("screen") == "draft":
            sess.press("Digit1")
            time.sleep(0.35)
            continue
        if s.get("screen") == "play" and not ((s.get("drafts") or {}).get("pending") or 0):
            break
        time.sleep(0.15)
    time.sleep(wait)
    info = sess.safe_js(FRAC_JS)
    p = os.path.join(out, name + ".png")
    sess.screenshot(p)
    log("%s: %s" % (name, json.dumps(info)))
    return p, info


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titan", default="molo")
    ap.add_argument("--biome", default="grideast")
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--levels", default="1,3,5,8,12,16,22,27,32")
    ap.add_argument("--real-max", type=int, default=8, help="levels up to this are reached by real play")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    levels = [int(x) for x in args.levels.split(",") if x.strip()]
    rep = {"shots": []}

    def log(m):
        print(m, flush=True)

    sess = Session(args, "growthseq")
    sess.start()
    try:
        sess.goto(build_url(args.base, dev=1, seed=args.seed, quality=args.quality))
        if not sess.wait_bt(60):
            raise SystemExit("no __BT__")
        ok, nav = menus_to_slate(sess, args.titan, args.biome, log=log)
        if not ok:
            raise SystemExit("menus failed: %s" % nav)
        ok, scr = dismiss_slate(sess, 20, "Enter")
        if not ok:
            raise SystemExit("slate: %s" % scr)
        sess.cheat("god", True)
        for L in levels:
            cur = (sess.state() or {}).get("level") or 1
            how = "already at LV %d" % cur
            if L > cur:
                if L <= args.real_max:
                    t0 = time.time()
                    if not play_until(sess, L, log):
                        log("LV %d not reached by real play — cheat.level" % L)
                        sess.cheat("level", L)
                        how = "cheat.level (real play timed out)"
                    else:
                        how = "real play (%.0f s)" % (time.time() - t0)
                else:
                    sess.cheat("noSpawns", False)
                    ok, v = sess.cheat("level", L)
                    how = "cheat.level → %s" % (v,)
            p, info = settle_and_shot(sess, args.out, "LV%02d" % L, log)
            rep["shots"].append({"level": L, "how": how, "path": p, "info": info})
        diag = sess.diagnostics()
        rep["diagnostics"] = {k: (len(v) if isinstance(v, list) else v) for k, v in (diag or {}).items()}
    finally:
        sess.close()
    with open(os.path.join(args.out, "growthseq.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=1)
    print("GROWTH SEQUENCE")
    for r in rep["shots"]:
        i = r["info"] or {}
        print("  LV %2s  %-34s Size %s  H %6s m  D %7s m  zoom %s  body %5s %% of screen height  %s" % (
            r["level"], r["how"], ["I", "II", "III", "IV", "V"][i.get("rank", 0)] if i else "?", i.get("H"), i.get("D"),
            i.get("zoom"), i.get("frac"), r["path"]))
    print("diagnostics: %s" % json.dumps(rep.get("diagnostics"))[:400])


if __name__ == "__main__":
    main()
