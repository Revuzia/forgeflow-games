#!/usr/bin/env python
"""rocksweep - the REAL-MOVER SWEEP: does the game's own mover ever walk into a drawn rock?  (Wave-7 completion round, lane D5)

    python _harness/rocksweep.py --disk                         # every isolated rock of 3 maps x seeds 1, 7, 1234, 31337, 2026, 8 sprint angles each (13,432 sprints; ~3-4 min)
    python _harness/rocksweep.py --disk --maps ashgrid --seeds 31337
    python _harness/rocksweep.py --disk --strip-lip             # the same sweep with the rock "lip" companion collider REMOVED from the served table (is the lip redundant?)
    python _harness/rocksweep.py --rev dd414cb2                 # the must-fail proof: the Wave-7 live build (5 sprints end 0.57-1.26 m inside a rock)
    python _harness/rocksweep.py --disk --plant old-mover       # the working copy with the Wave-7 mover (player.js of --old-rev) served over it: MUST FAIL

collisioncheck's `sprints-rocks` row samples 8 rocks x 8 angles per map (192 sprints for the three maps) and bars 1 %. That is the right shape for a FIT defect (a collider
narrower than its rock, which bites in 5-50 % of the sprints) and the wrong shape for a MOVER defect: the Wave-7 lane 7H sweep of every isolated rock found five sprints in
13,432 (0.037 %) that walk 0.57-1.26 m into a rock through a 6 mm window in player.js (blockedIn probes the destination floor from the feet BEFORE gravity, the post-move
support test from the feet AFTER it: a box whose rise over the feet is 0.544-0.550 m - or 0.574-0.598 m behind the rock "lip" duplicate - is neither a wall nor liftable). A
sample never sees one in 3,000. This gate visits every isolated rock instance (probe_collision.js sprintsAll: same mover, same judging rules as the sprint row: a body counts only
where its top is at least the 0.55 m step height over the feet, a flagged body is confirmed by its OWN drawn triangles, a run-up that starts inside a wall box backs off) and the
bar is a COUNT:

  sweep-rocks        per map: 0 sprints end more than 10 cm inside the drawn rock (exact: it is a count of events, not a rate; the gate cannot be satisfied by a larger population)
  population         the sweep judged at least MIN_RUNS sprints per map (a probe that visited nothing is could-not-judge, never a pass)

--strip-lip: assets/props/prop_colliders.json is served (page route, nothing on disk changes) without the `*_lip` companion part of the rock table (bake_prop_colliders.mjs LIP: one
extra box, 3 cm lower, that relocates the window; the tool notes it is redundant once player.js makes its two floor tests consistent). The rows are then named sweep-rocks-nolip: a
PASS says the mover fix alone closes the window and the lip can be dropped from the bake config.

--plant old-mover: player.js of --old-rev (default the Wave-7 live build) is served over the working copy. On a tree whose mover is fixed this reproduces the Wave-7 defect and the
row must FAIL (exit 1 = the planted fault was seen); on a tree that is not fixed it changes nothing.

Exit 0 pass / 1 fail / 2 could-not-judge (a map would not load, the probe measured nothing).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "rocksweep"
PROBE = os.path.join(C.HERE, "probe_collision.js")
DEFAULT_MAPS = "isla_viva,ashgrid,deepwood"
DEFAULT_SEEDS = "1,7,1234,31337,2026"        # the five placement-census seeds (the set lane 7H swept: 13,432 sprints, 5 of them the mover window)
MIN_RUNS = {"isla_viva": 300, "ashgrid": 2000, "deepwood": 1000}     # a full default sweep reads 968 / 8,600 / 3,864; a --seeds subset scales this down below
OLD_REV_DEFAULT = "dd414cb2"                 # the Wave-7 live build: its player.js has the window


def read_probe():
    with open(PROBE, encoding="utf-8") as fh:
        return fh.read()


class PlantView:
    """--plant: only the designated rows count (exit 1 = the planted fault was seen); the rest print as information."""

    def __init__(self, v, base_rows):
        self._v, self._rows = v, base_rows

    def check(self, name, ok, detail="", expect=None):
        if name.split(" [")[0] in self._rows:
            return self._v.check(name, ok, detail, expect)
        self._v.info(name + " (not counted in plant mode)", detail)
        return ok

    def cnj(self, name, why):
        return self.check(name, None, why)

    def __getattr__(self, k):
        return getattr(self._v, k)


def install_strip_lip(s, args):
    """serve prop_colliders.json without the rock `*_lip` parts; returns how many were removed"""
    rel = "assets/props/prop_colliders.json"
    b = s.disk.git.read(rel) if getattr(args, "rev", None) else open(os.path.join(C.ROOT, rel.replace("/", os.sep)), "rb").read()
    if b is None:
        raise C.EnvFailure("strip-lip: %s is not in the served tree" % rel)
    table = json.loads(b.decode("utf-8"))
    k = (table.get("kinds") or {}).get("rocks")
    if not k or not k.get("parts"):
        raise C.EnvFailure("strip-lip: the baked table has no rocks parts")
    before = len(k["parts"])
    k["parts"] = [p for p in k["parts"] if not str(p.get("name", "")).endswith("_lip")]
    removed = before - len(k["parts"])
    body = json.dumps(table).encode("utf-8")
    s.disk.overrides.append((lambda url: urllib.parse.urlparse(url).path.endswith("/" + rel),
                             lambda route: route.fulfill(status=200, body=body, headers={"Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
    return removed


def install_old_mover(s, args):
    """serve player.js as committed at --old-rev over whatever the session serves"""
    rel = "runtime/3d/royale/player.js"
    b = C.git_blobs(args.old_rev).read(rel)
    if b is None:
        raise C.EnvFailure("old-mover: %s is not in %s" % (rel, args.old_rev))
    s.disk.overrides.append((lambda url: urllib.parse.urlparse(url).path.endswith("/" + rel),
                             lambda route: route.fulfill(status=200, body=b, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
    return "player.js (%d bytes) served from %s" % (len(b), args.old_rev)


def sweep_one(args, map_id, seed, src):
    t0 = time.time()
    res = {"map": map_id, "seed": seed}
    with C.Session(args, "rocksweep_%s_%d" % (map_id, seed), viewport={"width": 960, "height": 600}) as s:
        if args.strip_lip:
            res["lipRemoved"] = install_strip_lip(s, args)
        if args.plant == "old-mover":
            res["plant"] = install_old_mover(s, args)
        s.boot()
        s.freeze_loop()
        st = s.start_match(mode="practice", seed=seed, map_id=map_id)
        s.freeze_loop()
        res["loadS"] = st.get("load_s")
        keys = s.js("() => { window.__LCCOL__ = (" + src + ")(); return Object.keys(window.__LCCOL__); }")
        if "sprintsAll" not in keys:
            raise C.HarnessError("probe_collision.js has no sprintsAll: %s" % keys)
        s.js("() => window.__LC__.stepFrames(14, 1/60, false)")
        s.js("() => window.__LCCOL__.props()")
        r = s.js("(o) => window.__LCCOL__.sprintsAll(o)", {"kind": "rocks"})
        res["sweep"] = r
        res["pageErrors"] = [e[1][:200] for e in s.page_errors][:3]
        res["failedRequests"] = len(s.failed)
    res["wallS"] = round(time.time() - t0, 1)
    print("  [%s s%d] %d rocks, %d sprints, inside10 %d, deepest %.3f m, hull-only %d, backed-off starts %d (%.0f s)%s" % (
        map_id, seed, r["instances"], r["runs"], r["inside10"], r["deepest"], r["hullOnly"], r["backed"], res["wallS"],
        ("  FAILS %s" % [(f["i"], f["ang"], f["minGap"]) for f in r["fail"]][:6]) if r["fail"] else ""), flush=True)
    return res


def main_fn(v0, args):
    plant = args.plant
    if plant and plant != "old-mover":
        raise C.HarnessError("unknown --plant %r (known: old-mover)" % plant)
    if (plant or args.strip_lip) and not (args.disk or args.rev):
        raise C.EnvFailure("--plant / --strip-lip patch the served files: they need --disk or --rev")
    suffix = "-nolip" if args.strip_lip else ""
    v = PlantView(v0, {"sweep-rocks" + suffix}) if plant else v0
    maps = [m for m in args.maps.split(",") if m]
    seeds = [int(x) for x in args.seeds.split(",") if x.strip()]
    src = read_probe()
    v0.data.update({"maps": maps, "seeds": seeds, "stripLip": bool(args.strip_lip), "plant": plant, "oldRev": args.old_rev if plant else None})
    print("%s: maps %s | seeds %s | strip-lip %s | plant %s" % (GATE, ",".join(maps), ",".join(str(x) for x in seeds), args.strip_lip, plant or "none"), flush=True)
    per = {}
    for m in maps:
        per[m] = []
        for sd in seeds:
            per[m].append(sweep_one(args, m, sd, src))
    v0.data["perRun"] = per
    tot_runs = tot_in = 0
    for m in maps:
        rs = per[m]
        runs = sum(r["sweep"]["runs"] for r in rs)
        inside = sum(r["sweep"]["inside10"] for r in rs)
        tot_runs += runs
        tot_in += inside
        errs = [e for r in rs for e in r["pageErrors"]] + (["%d failed requests" % sum(r["failedRequests"] for r in rs)] if any(r["failedRequests"] for r in rs) else [])
        fails = [(r["seed"], f["i"], f["ang"], f["minGap"]) for r in rs for f in r["sweep"]["fail"]]
        floor = int(MIN_RUNS.get(m, 300) * len(seeds) / 5.0)
        v0.check("population [%s]" % m + suffix, runs >= floor, "%d sprints over %d rocks (seeds %s); floor %d" % (runs, sum(r["sweep"]["instances"] for r in rs), ",".join(str(s_) for s_ in seeds), floor))
        v.check("sweep-rocks%s [%s]" % (suffix, m), inside == 0,
                "%d of %d sprints end > 10 cm inside the drawn rock%s; deepest %.3f m; hull-only points %d, backed-off starts %d" % (
                    inside, runs, (" - (seed, rock, angle, depth m): %s" % fails[:8]) if fails else "", max([r["sweep"]["deepest"] for r in rs] + [0]), sum(r["sweep"]["hullOnly"] for r in rs), sum(r["sweep"]["backed"] for r in rs)),
                "exactly 0 sprints inside a rock")
        if errs:
            v0.check("errors [%s]" % m + suffix, False, errs[:4])
    v0.info("population", "%d sprints, %d inside a rock (%.4f %%); lip removed from the served table: %s" % (tot_runs, tot_in, 100.0 * tot_in / max(1, tot_runs), args.strip_lip))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=DEFAULT_MAPS)
    ap.add_argument("--seeds", default=DEFAULT_SEEDS)
    ap.add_argument("--strip-lip", action="store_true", help="serve the rock collider table without its *_lip companion part (rows are named sweep-rocks-nolip)")
    ap.add_argument("--plant", default=None, help="negative control: old-mover (player.js of --old-rev served over this tree)")
    ap.add_argument("--old-rev", default=OLD_REV_DEFAULT, help="the build whose player.js the old-mover plant serves (default %(default)s, the Wave-7 live build)")
    args = ap.parse_args()
    if args.strip_lip and not args.report:
        args.report = "rocksweep_nolip"
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
