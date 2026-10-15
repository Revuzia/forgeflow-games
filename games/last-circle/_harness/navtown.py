#!/usr/bin/env python
"""navtown - can a walker get street -> room -> street in EVERY room of the Savanna towns and compounds, on the grid NavGrid.bakeTown builds?
(Last Circle Wave 7, lane 7D: the town half of the navcheck rows.)  NODE ONLY: no browser, no server, no file edited.

    python _harness/navtown.py --disk                          # the working copy: Savanna seeds 7, 1234, 2026 (~1.5 min)
    python _harness/navtown.py --disk --plant coarse-indoor    # negative control (must exit 1): the grid is baked with 3 m indoor cells, no door fits

navcheck's door-reachability rows drive the REAL BOT CONTROLLER (bots.js); they cover the town tiles once lane 7B2's wiring lands, but only for the bots' planner. These rows
judge the GRID itself, independent of bots.js: `probe_navtown.mjs` builds Savanna with the UNMODIFIED maps.js, bakes every town and compound of its towngen layout with
NavGrid.bakeTown (the way stage B composes the grid), finds every room with navcheck's own room survey, and for every room asks the grid for a path from an open street
point (in) and back (out) and WALKS it with player.js's tick() (the real mover; lane 7B1's phase3 closed loop). A room is reached when a street gets a walker in AND out.

  town-rooms-found      >= 300 rooms inside the baked rects on every seed (a probe that finds fewer measured nothing: could-not-judge)
  town-bake-done        bakeTown covered every rect (town.done)
  town-ground-rooms     ground-floor rooms (<= 1.5 m over the terrain) reached in AND out >= 98 %          (plan: door-reachability, ground floors >= 98 %)
  town-upper-rooms      rooms above the ground floor (upper + top) reached in AND out >= 85 %             (plan: upper floors >= 85 % after Wave 5; 98 % after Wave 8)
  town-walks-agree      the real mover arrives on >= 99.5 % of the walks the grid planned                  (the grid errs toward blocked: it must not plan what the mover cannot walk)
  information           per level and per town: rooms, planned, walked, the unreached rooms with where and why; bake ms; MB per town (plan estimate 1-2 MB)

The control `--plant coarse-indoor` bakes with cellIndoor 3 m: a 1 m door cannot be crossed, so the rooms behind doors are not reached and town-ground-rooms / town-upper-rooms FAIL.
Exit 0 pass / 1 fail / 2 could-not-judge (node missing, the probe crashed, too few rooms).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "navtown"
PROBE = os.path.join(C.HERE, "probe_navtown.mjs")
PLANT_ROWS = {"coarse-indoor": {"town-ground-rooms", "town-upper-rooms"}}
GROUND_MIN = 0.98
UPPER_MIN = 0.85
AGREE_MIN = 0.995
ROOMS_MIN = 300


def pc(a, b):
    return "-" if not b else "%.1f %%" % (100.0 * a / b)


def main_fn(v0, args):
    plant = args.plant
    if plant and plant not in PLANT_ROWS:
        raise C.HarnessError("unknown --plant %r (known: %s)" % (plant, ", ".join(sorted(PLANT_ROWS))))
    rows_in_plant = PLANT_ROWS.get(plant)

    def check(name, ok, detail, expect=None):
        if plant and name not in rows_in_plant:
            v0.info(name + " (not counted in plant mode)", detail)
            return ok
        return v0.check(name, ok, detail, expect)

    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    out = os.path.join(tempfile.gettempdir(), "lc_navtown_%d.json" % os.getpid())
    cmd = ["node", PROBE, "--root", C.ROOT, "--vendor", vendor, "--map", "ashgrid", "--seeds", args.seeds, "--out", out]
    if plant:
        cmd += ["--plant", plant]
    print("%s: working copy | Savanna seeds %s | plant %s" % (GATE, args.seeds, plant or "none"), flush=True)
    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=args.timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("probe_navtown.mjs still running after %d s" % args.timeout)
    if p.returncode != 0 or not os.path.exists(out):
        raise C.EnvFailure("probe_navtown.mjs exit %s: %s" % (p.returncode, " | ".join((p.stderr or p.stdout or "").strip().splitlines()[-4:])[:500]))
    with open(out, encoding="utf-8") as fh:
        doc = json.load(fh)
    try:
        os.remove(out)
    except OSError:
        pass
    v0.data["probe"] = doc
    seeds = doc["seeds"]
    v0.info("probe", "%d seeds in %.0f s; navgrid %s" % (len(seeds), time.time() - t0, os.path.basename(doc["navgrid"])))
    if any(s.get("noCity") for s in seeds):
        v0.cnj("town-rooms-found", "this build's Savanna has no M.city layout (a Wave-5/6 build): nothing to bake")
        return
    low = [s for s in seeds if s["roomsInTowns"] < ROOMS_MIN]
    if low:
        v0.cnj("town-rooms-found", "only %s rooms inside the baked rects (seeds %s): the room survey measured too little" % ([s["roomsInTowns"] for s in low], [s["seed"] for s in low]))
        return
    check("town-rooms-found", True, "; ".join("seed %d: %d rooms in %d towns + %d compounds (%d found map-wide)" % (s["seed"], s["roomsInTowns"], s["towns"], s["compounds"], s["roomsFound"]) for s in seeds), ">= %d per seed" % ROOMS_MIN)
    check("town-bake-done", all(s["done"] for s in seeds), "; ".join("seed %d: %d tiles, %d ms, %.2f MB" % (s["seed"], s["tiles"], s["bakeMs"], s["MB"]) for s in seeds), "bakeTown covers every rect")

    def agg(s, levels):
        rooms = sum(s["tab"][l]["rooms"] for l in levels)
        both = sum(s["tab"][l]["both"] for l in levels)
        return rooms, both

    bad_g, bad_u, show_g, show_u = [], [], [], []
    for s in seeds:
        r, b = agg(s, ("ground",))
        show_g.append("seed %d %d of %d (%s)" % (s["seed"], b, r, pc(b, r)))
        if r == 0 or b < GROUND_MIN * r:
            bad_g.append(s["seed"])
        r, b = agg(s, ("upper", "top"))
        show_u.append("seed %d %d of %d (%s)" % (s["seed"], b, r, pc(b, r)))
        if r == 0 or b < UPPER_MIN * r:
            bad_u.append(s["seed"])
    check("town-ground-rooms", not bad_g, "ground-floor rooms reached in AND out: " + "; ".join(show_g), ">= %d %% on every seed" % round(100 * GROUND_MIN))
    check("town-upper-rooms", not bad_u, "rooms above the ground floor reached in AND out: " + "; ".join(show_u), ">= %d %% on every seed" % round(100 * UPPER_MIN))
    plan = sum(s["tab"][l]["plan"] for s in seeds for l in s["tab"])
    walk = sum(s["tab"][l]["walk"] for s in seeds for l in s["tab"])
    check("town-walks-agree", plan > 0 and walk >= AGREE_MIN * plan, "the real mover arrived on %d of %d planned walks (%s); failed walks: %s" % (
        walk, plan, pc(walk, plan), [f for s in seeds for f in s["fails"]][:3] or "none"), ">= %.1f %%" % (100 * AGREE_MIN))
    for s in seeds:
        t = s["tab"]
        v0.info("seed %d by level" % s["seed"], " | ".join("%s: %d rooms, %d reached, walks %d planned %d walked %d" % (l, t[l]["rooms"], t[l]["both"], t[l]["walks"], t[l]["plan"], t[l]["walk"]) for l in ("ground", "upper", "top")))
        if s["unreached"]:
            v0.info("seed %d unreached rooms" % s["seed"], "; ".join("%s %s at (%s, %s, %s) in:%s out:%s %s" % (u["place"], u["lvl"], u["room"][0], u["room"][1], u["room"][2], u["in"], u["out"], u["why"]) for u in s["unreached"][:8]))
        v0.info("seed %d MB per town (plan estimate 1-2 MB; lane 7B1 read downtown 1.04-1.38 MB before the Wave-7 polish)" % s["seed"], ", ".join("%s %.2f" % (m["id"], m["MB"]) for m in s["townMB"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--seeds", default="7,1234,2026", help="Savanna seeds (default 7,1234,2026: the citycheck cover seeds)")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--timeout", type=int, default=1800)
    args = ap.parse_args()
    if args.plant and not args.report:
        args.report = "navtown_plant_" + args.plant.replace("-", "_")
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
