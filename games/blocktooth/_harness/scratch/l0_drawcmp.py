#!/usr/bin/env python
"""L0 A/B: same seed, same frozen tick, per-scene-root draw/tri breakdown on two servers (e.g. L0 vs a
HEAD copy). Attributes any draw-call / triangle difference to a view root.

    python _harness/scratch/l0_drawcmp.py --base http://localhost:5250 --other http://localhost:5251 --no-serve
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from common import Session, add_common_args, build_url, dismiss_slate  # noqa: E402


def sample(args, base):
    a = argparse.Namespace(**vars(args)); a.base = base
    s = Session(a, "drawcmp")
    s.start()
    try:
        s.goto(build_url(base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5))
        s.wait_bt(90)
        s.wait_screen(["play"], 90)
        s.js("() => window.__BT__.freeze(true)")
        s.js("() => window.__BT__.cheat.level(35)")
        s.js("() => window.__BT__.step(90)")
        time.sleep(1.0)
        bd = s.js("() => window.__BT__.renderBreakdown(12)")
        st = s.js("() => { const s = window.__BT__.state(); return {tick: s.tick, enemies: s.enemies, draws: s.draws, tris: s.tris, programs: s.programs}; }")
        return bd, st
    finally:
        s.close()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument("--other", required=True)
    args = ap.parse_args()
    A, sa = sample(args, args.base)
    B, sb = sample(args, args.other)
    print("A", args.base, json.dumps(sa), "breakdown draws", A["totalDraws"], "tris", A["totalTris"])
    print("B", args.other, json.dumps(sb), "breakdown draws", B["totalDraws"], "tris", B["totalTris"])
    ga = {g["name"].split("#")[0]: g for g in A["groups"]}
    gb = {g["name"].split("#")[0]: g for g in B["groups"]}
    for k in sorted(set(ga) | set(gb)):
        x, y = ga.get(k, {"draws": 0, "tris": 0}), gb.get(k, {"draws": 0, "tris": 0})
        flag = "" if (x["draws"], x["tris"]) == (y["draws"], y["tris"]) else "   <-- differs"
        print("  %-28s A draws %4d tris %8d | B draws %4d tris %8d%s" % (k, x["draws"], x["tris"], y["draws"], y["tris"], flag))


if __name__ == "__main__":
    main()
