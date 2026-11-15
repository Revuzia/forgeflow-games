#!/usr/bin/env python
"""stormplace - LC-13 / OD-1 storm placement over 2000 seeds x 3 maps (P2-D lane sim; gate by P2-F). NO browser.

    python _harness/p23/stormplace.py --disk                    # the working copy
    python _harness/p23/stormplace.py --rev 9aa2b746            # control: the P2 base (today's rule, p50 37 m) MUST FAIL
    python _harness/p23/stormplace.py --disk --plant land-ignored   # control: a landAt that says "land" everywhere MUST FAIL (wet finals)
    python _harness/p23/stormplace.py --disk --inject F:/lc_p23/harness/stubs/storm_proposed.cjs   # validation against the P1-G design

The Storm of the served runtime/sim/royale.js is built the way storm.js builds it, plus OD-1's land predicate:
new SIM.Storm({ seed, mode, half: 784, landAt(x, z), heightAt, waterY }), landAt = the map's analytic ground (mkHeightFn read out of the
served maps.js) above waterY + 0.5 m. Seeds are spread like real 32-bit match seeds (P1-G storm_study).

Rows (OD-1 as decided: area-uniform, land-checked, F = 1.0, STANDARD only, Quick unchanged, storm timeline unchanged):
  landAt-asked [map]      the Storm calls the predicate at all (a Storm that never asks cannot honour it)
  final-p50 [map]         final-centre distance from the map centre, p50 >= 150 m (plan section 5 World)
  final-water [map]       0 final centres in water (by the map's ground)
  total-920 [map]         the standard storm totals 920 s on every seed (timeline unchanged)
  nesting [map]           every circle inside the previous one
  edge-caps [map]         phase-1 edge speed <= 55 % of sprint, every phase <= 80 % (P1-G study caps)
  quick-unchanged [map]   Quick Match circles + timeline byte-identical to the P2 base's (2000 seeds)
  deterministic [map]     the same seed twice gives the same storm (200 seeds)
  ground-agreement        the analytic ground vs the BUILT map's heightAt (what the game's landAt reads): >= 99.5 % of a 161 x 161 grid
                          agree on land/water, and the final centre of the built-ground storm is on land (Isla Viva + Deepwood, seeds 7 / 1234)
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

MAPS = ["isla_viva", "ashgrid", "deepwood"]
P50_MIN = 150.0
PH1_CAP, ALL_CAP = 0.55, 0.80
AGREE_MIN = 0.995


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=("land-ignored",))
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--maps", default=",".join(MAPS))
    ap.add_argument("--no-agree", action="store_true", help="skip the built-map ground-agreement row (it builds 4 maps, ~30 s)")
    args = L.parse(ap)

    def body(v):
        root, label = L.node_root(args)
        base, blabel = L.node_root(argparse.Namespace(rev=L.BASE_P23, overlay=[]))
        v.data["root"], v.data["base"] = label, blabel
        argv = [os.path.join(L.HERE, "node", "storm_place.cjs"), "--root", root, "--base-root", base, "--n", str(args.n), "--maps", args.maps]
        if args.plant:
            argv += ["--plant", args.plant]
        for f in args.inject or []:
            argv += ["--inject", f]
        res, _tail, wall = L.run_node(argv)
        v.data["storm"] = res
        for m, r in res["maps"].items():
            water_map = r["waterY"] > -100
            v.check("landAt-asked [%s]" % m, r["landCalls"] > 0, {"landCalls": r["landCalls"], "seeds": args.n}, "> 0 predicate calls")
            v.check("final-p50 [%s]" % m, r["p50"] >= P50_MIN, {"p50": r["p50"], "p90": r["p90"], "max": r["max"], "over150": r["over150"]}, ">= %.0f m" % P50_MIN)
            if water_map:
                v.check("final-water [%s]" % m, r["wetFinal"] == 0, {"wetFinal": r["wetFinal"], "wetPhaseCentres": r["wetCentres"], "of": r["centres"]}, "0")
            else:
                v.info("final-water [%s] (no water on this map)" % m, {"wetFinal": r["wetFinal"]})
            v.check("total-920 [%s]" % m, list(r["totalS"].keys()) == ["920"], r["totalS"], "920 s on every seed")
            v.check("nesting [%s]" % m, r["nestBad"] == 0, {"violations": r["nestBad"]}, "0")
            e = r["edge"]
            v.check("edge-caps [%s]" % m, bool(e) and e[0] <= PH1_CAP and max(e) <= ALL_CAP, {"maxShareOfSprintPerPhase": e},
                    "phase 1 <= %.2f, every phase <= %.2f" % (PH1_CAP, ALL_CAP))
            v.check("quick-unchanged [%s]" % m, r["quickChecked"] > 0 and r["quickDiff"] == 0, {"differ": r["quickDiff"], "of": r["quickChecked"], "base": blabel}, "0 differ")
            v.check("deterministic [%s]" % m, r["detDiff"] == 0, {"differ": r["detDiff"]}, "0")
        if not args.no_agree and args.plant is None:
            ag, _t, _w = L.run_node([os.path.join(L.HERE, "node", "height_agree.mjs"), "--root", root, "--maps", "isla_viva,deepwood", "--seeds", "7,1234"])
            rows = ag["rows"]
            ok = bool(rows) and all(r["share"] >= AGREE_MIN and r["finalBuiltLand"] for r in rows)
            v.check("ground-agreement", ok, [{k: r[k] for k in ("map", "seed", "share", "finalApartM", "finalBuiltLand")} for r in rows],
                    ">= %.3f agree; built-ground final on land" % AGREE_MIN)
        v.info("node wall", {"s": wall})
    return C.run_gate("p23_stormplace", body, args)


if __name__ == "__main__":
    sys.exit(main())
