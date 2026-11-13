#!/usr/bin/env python
"""navtown - can a walker get street -> room -> street in EVERY room of the towns and compounds of EVERY map, on the grid NavGrid.bakeTown builds?
(Last Circle Wave 7, lane 7D: the town half of the navcheck rows; Wave 7b, lane B2: Isla Viva and Deepwood too, and the Riverside Mill bridge.)  NODE ONLY: no browser, no server, no file edited.

    python _harness/navtown.py --disk                          # the working copy: all three maps, seeds 7, 1234, 2026 (Savanna ~1.5 min, the themed maps less)
    python _harness/navtown.py --disk --maps ashgrid           # one map (the Wave-7 form of the row names: no [map] suffix)
    python _harness/navtown.py --disk --plant coarse-indoor    # negative control (must exit 1): the grid is baked with 3 m indoor cells, no door fits
    python _harness/navtown.py --rev dd414cb2 --maps ashgrid   # a frozen commit (the Wave-7 live build): town-top-rooms MUST fail there (2-3 downtown top-storey rooms per seed have no route)
    python _harness/navtown.py --rev 6191b380 --block-maps isla_viva,deepwood   # the Wave-7b must-fail proof: the live build has NO towns on the themed maps (town-rooms-found FAILS: no M.city layout)

Wave 7b: --maps (default all three), --block-maps (the maps whose rows COUNT; the others print "would PASS / would FAIL" as information, like citycheck's), --require-bridge (maps whose layout MUST
carry a bridge that the grid plans across and the real mover walks, both ways: Deepwood's Riverside Mill, plan O4). A map in --block-maps whose build has no `M.city` layout FAILS town-rooms-found
(the themed maps' towns are wired in Wave 7b; a Wave-5/6 Savanna fails the same way on a blocking Savanna).

navcheck's door-reachability rows drive the REAL BOT CONTROLLER (bots.js); they cover the town tiles once lane 7B2's wiring lands, but only for the bots' planner. These rows
judge the GRID itself, independent of bots.js: `probe_navtown.mjs` builds Savanna with the UNMODIFIED maps.js, bakes every town and compound of its towngen layout with
NavGrid.bakeTown (the way stage B composes the grid), finds every room with navcheck's own room survey, and for every room asks the grid for a path from an open street
point (in) and back (out) and WALKS it with player.js's tick() (the real mover; lane 7B1's phase3 closed loop). A room is reached when a street gets a walker in AND out.

  town-rooms-found      >= 300 rooms inside the baked rects on every seed (a probe that finds fewer measured nothing: could-not-judge)
  town-bake-done        bakeTown covered every rect (town.done)
  town-ground-rooms     ground-floor rooms (<= 1.5 m over the terrain) reached in AND out >= 98 %          (plan: door-reachability, ground floors >= 98 %)
  town-upper-rooms      rooms above the ground floor (upper + top) reached in AND out >= 85 %             (plan: upper floors >= 85 % after Wave 5; 98 % after Wave 8)
  town-walks-agree      the real mover arrives on >= 99.5 % of the walks the grid planned                  (the grid errs toward blocked: it must not plan what the mover cannot walk)
  town-top-rooms        (Wave-7 completion round, D5) the TOP storey - rooms more than 7.5 m over the terrain, the third storey and up of a downtown tower - reached in AND out >= 98 % on every seed
                        (the plan's Wave-8 number for upper floors, asked here of the highest rooms only; >= 15 top rooms per seed or the row is could-not-judge). Wave-7 live build dd414cb2:
                        22 of 24 / 18 of 21 / 23 of 26 (seeds 7, 1234, 2026): the stair's landing slab starts 0.61 m past the ramp end, no lattice node bridges the gap, the whole storey above the stair
                        is an island for the planner ("no-goal" / "partial path"). The upper-rooms row (all rooms above the ground floor, 85 %) hid this: 95.7-97.7 %
  town-top-walks-agree  (Wave-7 completion round, D5) the real mover arrives on >= 99.5 % of the walks the grid planned to a TOP-storey room: the island was joined by bridge edges, and a planner that
                        joins what the mover cannot cross would send bots into the same wall for the rest of the match
  town-bridge           (Wave 7b, --require-bridge maps) every seed's layout has a bridge; the grid plans bank -> bank and back (from 8-18 m past each end) and the real mover arrives on EVERY walk
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
import placementcheck as PC  # noqa: E402

GATE = "navtown"
PROBE = os.path.join(C.HERE, "probe_navtown.mjs")
PLANT_ROWS = {"coarse-indoor": {"town-ground-rooms", "town-upper-rooms"}}
GROUND_MIN = 0.98
UPPER_MIN = 0.85
AGREE_MIN = 0.995
ROOMS_MIN = 300             # Savanna: >= 300 rooms inside the baked rects per seed (it holds 459-504)
ROOMS_MIN_THEMED = 100      # Wave 7b: Isla Viva / Deepwood towns hold 204-264 rooms; the guard only says 'the survey measured something' (a could-not-judge floor, not a quality bar)
TOP_MIN = 0.98
TOP_ROOMS_MIN = 15           # the top storey of the Savanna downtown has 21-26 rooms per seed (Wave-7 live build); fewer than this = the survey measured too little


def pc(a, b):
    return "-" if not b else "%.1f %%" % (100.0 * a / b)


class Rows:
    """Rows of the maps in --block-maps COUNT; the others print "would PASS / would FAIL" (information), like citycheck.py's."""

    def __init__(self, v0, block_maps, plant, plant_rows, multi):
        self.v0, self.block, self.plant, self.plant_rows, self.multi = v0, set(block_maps), plant, plant_rows, multi
        self.state = {}

    def key(self, name, map_id):
        return ("%s [%s]" % (name, map_id)) if self.multi else name

    def counted(self, name, map_id):
        return map_id in self.block and not (self.plant and name not in self.plant_rows)

    def check(self, name, map_id, ok, detail, expect=None):
        key = self.key(name, map_id)
        self.state[key] = ok
        if self.plant and name not in self.plant_rows:
            self.v0.info(key + " (not counted in plant mode)", detail)
            return ok
        if map_id in self.block:
            return self.v0.check(key, ok, detail, expect)
        self.v0.info("%s (%s, information)" % (key, "would PASS" if ok else ("would FAIL" if ok is False else "not measured")), detail)
        return ok

    def cnj(self, name, map_id, why):
        key = self.key(name, map_id)
        if self.counted(name, map_id):
            return self.v0.cnj(key, why)
        self.v0.info(key + " (information)", why)


def judge_map(v0, R, map_id, seeds, args):
    """the rows of one map (names suffixed " [map]" when several maps run)"""
    if any(s.get("noCity") for s in seeds):
        R.check("town-rooms-found", map_id, False, "this build's %s has NO M.city layout (seeds %s): no town or compound to bake - the themed maps' towns are wired in Wave 7b, a Wave-5/6 Savanna has none either" % (
            map_id, [s["seed"] for s in seeds if s.get("noCity")]), ">= %d rooms inside the baked rects on every seed" % (ROOMS_MIN if map_id == "ashgrid" else ROOMS_MIN_THEMED))
        return
    rmin = ROOMS_MIN if map_id == "ashgrid" else ROOMS_MIN_THEMED
    low = [s for s in seeds if s["roomsInTowns"] < rmin]
    if low:
        R.cnj("town-rooms-found", map_id, "only %s rooms inside the baked rects (seeds %s, floor %d): the room survey measured too little" % ([s["roomsInTowns"] for s in low], [s["seed"] for s in low], rmin))
        return
    R.check("town-rooms-found", map_id, True, "; ".join("seed %d: %d rooms in %d towns + %d compounds (%d found map-wide)" % (s["seed"], s["roomsInTowns"], s["towns"], s["compounds"], s["roomsFound"]) for s in seeds), ">= %d per seed" % rmin)
    R.check("town-bake-done", map_id, all(s["done"] for s in seeds), "; ".join("seed %d: %d tiles, %d ms, %.2f MB" % (s["seed"], s["tiles"], s["bakeMs"], s["MB"]) for s in seeds), "bakeTown covers every rect")

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
        if (r == 0 and map_id == "ashgrid") or (r and b < UPPER_MIN * r):          # (Savanna always has rooms above the ground floor: none at all is a failure there)
            bad_u.append(s["seed"])
    R.check("town-ground-rooms", map_id, not bad_g, "ground-floor rooms reached in AND out: " + "; ".join(show_g), ">= %d %% on every seed" % round(100 * GROUND_MIN))
    # a themed map's towns are mostly one- and two-storey: a seed with NO room above the ground floor has nothing to judge here (the row is judged on the seeds that have some)
    upper_total = sum(agg(s, ("upper", "top"))[0] for s in seeds)
    if upper_total == 0 and map_id != "ashgrid":
        # not applicable, not could-not-judge: Deepwood's lodge houses are single-storey (O3 allows <= 3 floors, it does not demand them); the ground-floor rows judge every room
        v0.info("town-upper-rooms [%s] (not applicable)" % map_id, "no room above the ground floor on any of %d seeds: nothing to judge (every room is judged by town-ground-rooms)" % len(seeds))
    else:
        R.check("town-upper-rooms", map_id, not bad_u, "rooms above the ground floor reached in AND out: " + "; ".join(show_u), ">= %d %% on every seed that has some" % round(100 * UPPER_MIN))
    plan = sum(s["tab"][l]["plan"] for s in seeds for l in s["tab"])
    walk = sum(s["tab"][l]["walk"] for s in seeds for l in s["tab"])
    tops = [(s["seed"], s["tab"]["top"]["rooms"], s["tab"]["top"]["both"]) for s in seeds]
    top_total = sum(t[1] for t in tops)
    if map_id == "ashgrid":
        few = [t for t in tops if t[1] < TOP_ROOMS_MIN]
        if few:
            R.cnj("town-top-rooms", map_id, "only %s top-storey rooms on seeds %s (need >= %d): the survey measured too little" % ([t[1] for t in few], [t[0] for t in few], TOP_ROOMS_MIN))
        else:
            bad_t = [t[0] for t in tops if t[2] < TOP_MIN * t[1]]
            R.check("town-top-rooms", map_id, not bad_t, "top-storey rooms (> 7.5 m over the terrain) reached in AND out: " + "; ".join("seed %d %d of %d (%s)" % (t[0], t[2], t[1], pc(t[2], t[1])) for t in tops), ">= %d %% on every seed" % round(100 * TOP_MIN))
    elif top_total:
        # the themed maps have few rooms above 7.5 m (a lodge or a ruin tower): every one that exists must be reached
        bad_t = [t[0] for t in tops if t[1] and t[2] < t[1]]
        R.check("town-top-rooms", map_id, not bad_t, "top-storey rooms (> 7.5 m over the terrain, %d in all) reached in AND out: %s" % (top_total, "; ".join("seed %d %d of %d (%s)" % (t[0], t[2], t[1], pc(t[2], t[1])) for t in tops)), "every top-storey room reached")
    tplan = [(s["seed"], s["tab"]["top"]["plan"], s["tab"]["top"]["walk"]) for s in seeds]
    if sum(t[1] for t in tplan) == 0:
        if map_id == "ashgrid":
            R.cnj("town-top-walks-agree", map_id, "the grid planned no walk to a top-storey room: nothing for the real mover to walk")
    else:
        bad_w = [t[0] for t in tplan if t[1] and t[2] < AGREE_MIN * t[1]]
        R.check("town-top-walks-agree", map_id, not bad_w, "the real mover arrived on " + "; ".join("seed %d %d of %d (%s)" % (t[0], t[2], t[1], pc(t[2], t[1])) for t in tplan) + " of the walks planned to a top-storey room", ">= %.1f %% on every seed" % (100 * AGREE_MIN))
    R.check("town-walks-agree", map_id, plan > 0 and walk >= AGREE_MIN * plan, "the real mover arrived on %d of %d planned walks (%s); failed walks: %s" % (
        walk, plan, pc(walk, plan), [f for s in seeds for f in s["fails"]][:3] or "none"), ">= %.1f %%" % (100 * AGREE_MIN))
    # ---- the bridge (Wave 7b, plan O4: the Riverside Mill compound crosses the Deepwood river) ----
    if map_id in args.require_bridge:
        per, bad = [], []
        for s in seeds:
            bw = s.get("bridgeWalk") or {}
            ok = bw.get("bridges", 0) >= 1 and bw.get("walks", 0) >= 2 and bw.get("planned") == bw.get("walks") and bw.get("walked") == bw.get("planned") and not bw.get("fails")
            per.append("seed %d: %d bridge(s), %d walks, %d planned, %d walked%s" % (s["seed"], bw.get("bridges", 0), bw.get("walks", 0), bw.get("planned", 0), bw.get("walked", 0),
                                                                                    ("; " + "; ".join("%s %s" % (f.get("dir", ""), f["why"]) for f in bw["fails"][:2])) if bw.get("fails") else ""))
            if not ok:
                bad.append(s["seed"])
        R.check("town-bridge", map_id, not bad, "the layout's bridge, bank -> bank and back (grid plan + the real mover): " + "; ".join(per), "a bridge on every seed; every walk planned and arrived")
    else:
        bw_all = [s.get("bridgeWalk") or {} for s in seeds]
        nb = sum(b.get("bridges", 0) for b in bw_all)
        if nb:
            v0.info("%s bridges (not required here)" % map_id, "%d bridge(s): %d walks, %d planned, %d walked" % (nb, sum(b.get("walks", 0) for b in bw_all), sum(b.get("planned", 0) for b in bw_all), sum(b.get("walked", 0) for b in bw_all)))
    for s in seeds:
        t = s["tab"]
        v0.info("%s seed %d by level" % (map_id, s["seed"]), " | ".join("%s: %d rooms, %d reached, walks %d planned %d walked %d" % (l, t[l]["rooms"], t[l]["both"], t[l]["walks"], t[l]["plan"], t[l]["walk"]) for l in ("ground", "upper", "top")))
        if s["unreached"]:
            v0.info("%s seed %d unreached rooms" % (map_id, s["seed"]), "; ".join("%s %s at (%s, %s, %s) in:%s out:%s %s" % (u["place"], u["lvl"], u["room"][0], u["room"][1], u["room"][2], u["in"], u["out"], u["why"]) for u in s["unreached"][:8]))
        v0.info("%s seed %d MB per town (plan estimate 1-2 MB; lane 7B1 read downtown 1.04-1.38 MB before the Wave-7 polish)" % (map_id, s["seed"]), ", ".join("%s %.2f" % (m["id"], m["MB"]) for m in s["townMB"]))


def main_fn(v0, args):
    plant = args.plant
    if plant and plant not in PLANT_ROWS:
        raise C.HarnessError("unknown --plant %r (known: %s)" % (plant, ", ".join(sorted(PLANT_ROWS))))
    maps = [m for m in args.maps.split(",") if m]
    block = [m for m in (args.block_maps or ",".join(maps)).split(",") if m]
    args.require_bridge = [m for m in (args.require_bridge or "").split(",") if m]
    R = Rows(v0, block, plant, PLANT_ROWS.get(plant), len(maps) > 1)
    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    root, served = C.ROOT, "working copy"
    if args.rev:
        root, sha = PC.rev_root(args.rev)
        served = "git " + sha
    out = os.path.join(tempfile.gettempdir(), "lc_navtown_%d.json" % os.getpid())
    cmd = ["node", PROBE, "--root", root, "--vendor", vendor, "--maps", ",".join(maps), "--seeds", args.seeds, "--out", out]
    if plant:
        cmd += ["--plant", plant]
    print("%s: %s | maps %s (counted: %s; bridge required: %s) | seeds %s | plant %s" % (GATE, served, ",".join(maps), ",".join(block), ",".join(args.require_bridge) or "none", args.seeds, plant or "none"), flush=True)
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
    v0.info("probe", "%d (map, seed) builds in %.0f s; navgrid %s" % (len(doc["seeds"]), time.time() - t0, os.path.basename(doc["navgrid"])))
    for m in maps:
        seeds = [s for s in doc["seeds"] if s.get("map") == m]
        if not seeds:
            R.cnj("town-rooms-found", m, "the probe returned no record for this map")
            continue
        judge_map(v0, R, m, seeds, args)
    v0.data["rows"] = dict(R.state)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=",".join(C.MAPS), help="comma list (default all three maps)")
    ap.add_argument("--block-maps", default=None, help="maps whose rows COUNT (default: every map run); the others print would PASS / would FAIL as information")
    ap.add_argument("--require-bridge", default="", help="maps whose layout must carry a bridge the grid plans across and the mover walks (Wave 7b: deepwood)")
    ap.add_argument("--seeds", default="7,1234,2026", help="seeds per map (default 7,1234,2026: the citycheck cover seeds)")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--timeout", type=int, default=1800)
    args = ap.parse_args()
    if args.plant and not args.report:
        args.report = "navtown_plant_" + args.plant.replace("-", "_")
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
