#!/usr/bin/env python
"""citycheck - is there a CITY, or is it open grass?  (Last Circle world plan, section 4, lane 6E.)

    python _harness/citycheck.py --disk                       # Wave 6: INFORMATION - prints the table, exit 0 when measured, 2 when not
    python _harness/citycheck.py --disk --blocking            # Wave 7: the rows gate (exit 1 on a failed row)
    python _harness/citycheck.py --disk --blocking --block-maps all   # Wave 7b: all three maps gate (also: a comma list; the default is ashgrid)
    python _harness/citycheck.py --rev bd523284 --blocking    # the must-fail proof: the Wave-5 release has no towns (exit 1)
    python _harness/citycheck.py --disk --quick               # 30 seeds instead of 200, no Chrome
    python _harness/citycheck.py --disk --towngen             # forecast: lane 6B's towngen.js scored against the same targets (Node)
    python _harness/citycheck.py --selftest                   # the detector on a synthetic village (offline, ~2 s; exit 1 on a miscount)

Two halves, ONE measuring function (probe_city.js, the pinned detector):
  Node    placement_census.mjs --mode city imports the UNMODIFIED runtime/3d/royale/maps.js through the three resolve hook and measures
          every (map, seed): 200 seeds x 3 maps (the many-seed rows) plus the three COVER seeds (7, 1234, 2026).
  Chrome  ONE Chrome per live map (default ashgrid, seed 7): the same probe on the map of a real match, compared with the Node replay of the
          same (map, seed) - the Node numbers are only trusted while they equal the live game's (row detector-parity).

THE PINNED "ENTERABLE BUILDING" (probe_city.js header has the full text): a roofed room, a chest-height wall in >= 3 of 4 directions, and a
doorway (a neighbour cell outside, floor within the 0.55 m step, no collider in the body band). The research lane's contact-cluster count
(39 / 37 / 35 at HEAD seed 7) asks for no door; the skeptic's python (33 / 38 / 33) merged every second cell (banker's round() on half-integer
keys) and lost small buildings; the pinned one reads 37 / 37 / 34 on the same HEAD worlds (the cluster count stays as an INFORMATION column).

Rows (plan section 4, per map; coverage rows judged on the COVER seeds, the rest over all seeds):
  enterable-near25     land within 25 m of an enterable building >= 10 %                         (HEAD 2.1-3.4 %)
  enterable-distance   median distance to one <= 90 m and p90 <= 150 m                           (HEAD 165-182 m / 351-360 m)
  land-far150          land more than 150 m from one <= 10 %                                      (HEAD 55-62 %)
  town-roads-dry       0 town road vertices below waterY, every seed                              (HEAD Jungle Market wet on 99.5 % of 200 seeds)
  town-enterables      every named town >= 6 enterable buildings on every seed                    (HEAD Container Yard, Rubble Row, Banana Farm, Ranger Ridge, Hunter's Hollow, Fire Watch: 0)
  endgame-cover        the area of the last two circles (r 31.4 m) holds >= 10 static cover pieces on >= 90 % of seeds   (HEAD median 0 / 5 / 0 = ashgrid / isla_viva / deepwood; the 9.4 m final circle alone: median 0)
  detector-parity      the live game's probe equals the Node replay for the same (map, seed)       (a harness-integrity row)
  compounds-placed     (Wave 7b) every seed lays out >= COMPOUND_MIN[map] compounds (75 % of towngen PLANS: 24 / 6 / 27)      (live Isla Viva / Deepwood: no layout at all = 0)
  compounds-enterable  (Wave 7b) >= 95 % of all compounds hold >= 2 enterable buildings by the pinned detector (PUBG: compounds of 2-6 buildings)
  endgame-final-c8     (Wave 7b, INFORMATION) the strict 9.4 m final circle (c8): median cover pieces and the share of seeds with >= 10
INFORMATION mode (the Wave-6 default) prints every row as "would PASS / would FAIL" and never exits 1: in Wave 6 no town exists in the live
game, so the coverage rows are EXPECTED to fail on the working copy. --blocking (Wave 7) makes them gate on --block-maps (default ashgrid; Wave 7b: `all` or a list).
Wave 7b changes of definition (README "Wave-7b gates"): town-enterables judges the NAMED TOWNS of TOWN_TABLE on the themed maps (the other POIs - a wreck, temples, a farm,
a watchtower - print as information); town-roads-dry also judges towngen's own streets (rec.roads.layout, sampled on the final ground); --city-plant wet-street is its control.

--towngen scores lane 6B's runtime/3d/royale/towngen.js (Node, the real heightAt of each built map) as a pre-wiring forecast: the same rows
on (enterable buildings of the current map outside the replaced towns) + (enterable parcels the generator emits).
Exit 0 pass / 1 fail / 2 could-not-judge (node missing, a census crashed, the live probe never ran).
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import placementcheck as PC  # noqa: E402

GATE = "citycheck"
CENSUS = os.path.join(C.HERE, "placement_census.mjs")
PROBE = os.path.join(C.HERE, "probe_city.js")
COVER_SEEDS = [7, 1234, 2026]           # Savanna seed 7 + 2 more (the plan: "Savanna seed 7 + 2 seeds, then each themed map")
WIDE_N = 200                            # seeds 1..200 for the many-seed rows
# thresholds: PLAN section 4 (citycheck.py), unchanged
NEAR25_MIN = 0.10
MEDIAN_MAX = 90.0
P90_MAX = 150.0
FAR150_MAX = 0.10
TOWN_MIN = 6
ENDGAME_MIN = 10
ENDGAME_SEED_SHARE = 0.90
PARITY_TOL = 0.02
# Wave 7b (lane B2): the named towns whose enterable count gates `town-enterables` (plan section 4: "every named town >= 6 enterable buildings"). Savanna: every POI (the Wave-7 rule,
# unchanged). The themed maps: the TOWNS and the endgame village (Isla Viva: Palm Bay, Coco Village, Jungle Market, Lagoon Docks + Volcano Rim = the crater-rim village; Deepwood: Logging
# Camp, Ranger Ridge, Lakeside Cabins, Hunter's Hollow, Old Quarry, Riverside Mill = the mill compound). The rest of each map's POIs (Shipwreck Cove, Cliff Temples, Banana Farm; Fire Watch,
# Meadow Farm: a wreck, ruins, farmland, a watchtower, farmland) stay on an INFORMATION line with their counts.
TOWN_TABLE = {
    "isla_viva": ("palm_bay", "coco_village", "jungle_market", "lagoon_docks", "volcano_rim"),
    "deepwood": ("logging", "ranger", "lakeside", "hollow", "quarry", "mill"),
}
COMPOUND_MIN = {"ashgrid": 24, "isla_viva": 6, "deepwood": 27}      # 75 % of towngen PLANS[map].compounds.count (30 / 8 / 36): a seed whose dry land cannot hold them all is allowed to lose a quarter
COMPOUND_BUILDINGS = 2                                              # a compound holds >= 2 enterable buildings (PUBG: compounds "with 2 to 6 buildings")
COMPOUND_SHARE = 0.95                                               # ... for >= 95 % of all compounds over all seeds
PLANT_ROWS = {"wet-street": {"town-roads-dry"}}
ENDGAME_NOTE = ("the plan's HEAD figure (final circle median 0) measured the 9.4 m final circle itself; 10 pieces inside a 277 m2 disc is out of reach of any layout "
                "with 56 m blocks, so the row measures the area the last two circles span (circle -2, r 31.4 m) with the plan's bar unchanged; the strict figure stays an INFO line")


def f(v, nd=1):
    return "-" if v is None else ("%.*f" % (nd, v))


def circles_of(e):
    return sorted((k for k in e if k.startswith("c") and k[1:].isdigit()), key=lambda k: int(k[1:]))


def pctl(a, q):
    if not a:
        return None
    s = sorted(a)
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


# ───────────────────────────── the Node half ─────────────────────────────
def node_tasks(root, vendor, maps, seeds_by_map, legacy_seeds, jobs, timeout, chunk=25, extra=None, mode="city"):
    """Run placement_census.mjs --mode city for every (map, seed chunk), `jobs` Node processes at a time. Returns the merged rows."""
    tasks = []
    tmp = tempfile.mkdtemp(prefix="lc_citycheck_")
    for m in maps:
        seeds = seeds_by_map[m]
        for i in range(0, len(seeds), chunk):
            part = seeds[i:i + chunk]
            out = os.path.join(tmp, "%s_%d.json" % (m, i))
            cmd = ["node", CENSUS, "--mode", mode, "--root", root, "--vendor", vendor, "--maps", m, "--seeds", ",".join(str(x) for x in part),
                   "--legacy-seeds", ",".join(str(x) for x in part if x in legacy_seeds), "--buildings", "--out", out] + list(extra or [])
            tasks.append({"cmd": cmd, "out": out, "map": m, "log": out + ".log"})
    pending = list(tasks)
    running = []
    rows = []
    t0 = time.time()
    done = 0
    while pending or running:
        while pending and len(running) < jobs:
            t = pending.pop(0)
            try:
                t["fh"] = open(t["log"], "w", encoding="utf-8")
                t["p"] = subprocess.Popen(t["cmd"], stdout=t["fh"], stderr=subprocess.STDOUT, cwd=C.ROOT)
            except FileNotFoundError:
                raise C.EnvFailure("node is not on PATH")
            running.append(t)
        time.sleep(0.4)
        for t in list(running):
            rc = t["p"].poll()
            if rc is None:
                continue
            running.remove(t)
            t["fh"].close()
            done += 1
            if rc != 0 or not os.path.exists(t["out"]):
                tail = " | ".join(open(t["log"], encoding="utf-8", errors="replace").read().strip().splitlines()[-4:])[:600]
                for u in running:
                    u["p"].kill()
                raise C.EnvFailure("placement_census.mjs --mode %s (%s) exit %s: %s" % (mode, t["map"], rc, tail))
            with open(t["out"], encoding="utf-8") as fh:
                rows += json.load(fh)["rows"]
            if done % 5 == 0 or not pending and not running:
                print("  node city: %d/%d tasks done (%.0f s)" % (done, len(tasks), time.time() - t0), flush=True)
        if time.time() - t0 > timeout:
            for u in running:
                u["p"].kill()
            raise C.EnvFailure("node city census still running after %d s" % timeout)
    return rows


# ───────────────────────────── the Chrome half ─────────────────────────────
def tree_state(root):
    """(path, size, mtime) of every runtime / asset-table file the worlds are built from: the Node half and the Chrome half must measure the SAME tree
    (Wave 7b: another lane editing maps.js between the two halves read as a detector-parity FAIL; it is an environment condition, could-not-judge)."""
    out = {}
    for sub in ("runtime", os.path.join("assets", "props")):
        base = os.path.join(root, sub)
        for dp, _dn, fns in os.walk(base):
            for fn in fns:
                if fn.endswith((".js", ".mjs", ".json")):
                    fp = os.path.join(dp, fn)
                    try:
                        st = os.stat(fp)
                    except OSError:
                        continue
                    out[os.path.relpath(fp, root)] = (st.st_size, int(st.st_mtime))
    return out


def tree_changed(before, after):
    return sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))


def live_record(args, map_id, seed, src):
    a = copy.copy(args)
    a.disk = bool(args.disk or args.rev)
    with C.Session(a, name="citycheck") as s:
        s.boot()
        s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
        st = s.start_match(mode="standard", seed=seed, map_id=map_id, enter=False)
        keys = s.js("() => { window.__LCCITY__ = (" + src + ")(); return Object.keys(window.__LCCITY__); }")
        if "measureLive" not in keys:
            raise C.HarnessError("probe_city.js did not install: %s" % keys)
        has_map = s.js("() => !!(window.__LC__.W.map && window.__LC__.W.map.colliders)")
        if not has_map:
            raise C.HarnessError("the match is loaded (phase %s) but W.map is empty" % s.phase())
        t0 = time.time()
        rec = s.js("() => window.__LCCITY__.measureLive({ legacy: false })")
        rec["liveMs"] = round((time.time() - t0) * 1000)
        rec["load"] = st
        rec["pageErrors"] = [e[1][:200] for e in s.page_errors][:3]
        rec["failedRequests"] = len(s.failed)
    return rec


def same_buildings(a, b):
    if len(a) != len(b):
        return False, "%d vs %d buildings" % (len(a), len(b))
    for p, q in zip(sorted(a), sorted(b)):
        if abs(p[0] - q[0]) > PARITY_TOL or abs(p[1] - q[1]) > PARITY_TOL:
            return False, "building at (%s, %s) vs (%s, %s)" % (p[0], p[1], q[0], q[1])
    return True, ""


# ───────────────────────────── judging ─────────────────────────────
class Rows:
    """INFORMATION mode (Wave 6): every row is printed "would PASS / would FAIL" and never gates. --blocking: the rows gate (on --block-maps)."""

    def __init__(self, v, blocking, block_maps, only=None):
        self.v, self.blocking, self.block_maps = v, blocking, set(block_maps)
        self.only = only                      # a --city-plant run: only the named rows count (the others print as information)
        self.state = {}

    def row(self, name, ok, detail, expect=None, map_id=None):
        key = name if map_id is None else "%s [%s]" % (name, map_id)
        self.state[key] = ok
        if self.only is not None and name not in self.only:
            self.v.info("%s (not counted in plant mode)" % key, detail)
            return ok
        gating = self.blocking and (map_id is None or map_id in self.block_maps)
        if gating:
            return self.v.check(key, ok, detail, expect)
        tag = "would PASS" if ok else ("would FAIL" if ok is False else "not measured")
        self.v.info("%s (%s%s)" % (key, tag, "" if self.blocking else ", information"), detail)
        return ok


def judge(v, R, rows, maps, cover_seeds, args):
    by = {}
    for r in rows:
        by.setdefault(r["map"], {})[r["seed"]] = r
    S = {}
    n_wide = 30 if args.quick else args.seeds_n
    for m in maps:
        allseeds = by.get(m, {})
        if not allseeds:
            continue
        seeds = {s: r for s, r in allseeds.items() if 1 <= s <= n_wide}       # the many-seed rows: seeds 1..N exactly (the extra cover / live seeds are not in the pool)
        S[m] = {"seeds": len(seeds)}
        # ---- coverage rows: the cover seeds ----
        cov = [allseeds[s] for s in cover_seeds if s in allseeds]
        per = ["s%d: %d enterable (sealed %d%s) within25 %s%% median %s p90 %s >150 %s%%" % (
            r["seed"], r["enterable"], r["sealed"], (", cluster %d" % r["legacyCluster"]) if r.get("legacyCluster") is not None else "",
            f(100 * r["cover"]["within25"]), f(r["cover"]["median"]), f(r["cover"]["p90"]), f(100 * r["cover"]["gt150"])) for r in cov]
        v.info("%s enterable buildings (cover seeds)" % m, " | ".join(per) + " | land %s km2" % f(cov[0]["cover"]["landKm2"], 2) if cov else "no cover seed measured")
        S[m]["cover"] = [{"seed": r["seed"], "enterable": r["enterable"], "sealed": r["sealed"], "cluster": r.get("legacyCluster"), **{k: r["cover"][k] for k in ("within25", "median", "p90", "gt150", "landKm2")}} for r in cov]
        wide = [r["enterable"] for r in seeds.values()]
        v.info("%s enterable buildings over %d seeds" % (m, len(wide)), "min %d, median %s, max %d" % (min(wide), f(pctl(wide, 0.5)), max(wide)))
        S[m]["enterableAll"] = {"min": min(wide), "p50": pctl(wide, 0.5), "max": max(wide)}
        if cov:
            bad = [r for r in cov if (r["cover"]["within25"] or 0) < NEAR25_MIN]
            R.row("enterable-near25", not bad, "land within 25 m of an enterable building: " + "; ".join("s%d %s%%" % (r["seed"], f(100 * (r["cover"]["within25"] or 0))) for r in cov),
                  ">= %d %%" % (100 * NEAR25_MIN), m)
            bad = [r for r in cov if (r["cover"]["median"] is None or r["cover"]["median"] > MEDIAN_MAX or r["cover"]["p90"] > P90_MAX)]
            R.row("enterable-distance", not bad, "median / p90 distance to one: " + "; ".join("s%d %s / %s m" % (r["seed"], f(r["cover"]["median"]), f(r["cover"]["p90"])) for r in cov),
                  "median <= %d m and p90 <= %d m" % (MEDIAN_MAX, P90_MAX), m)
            bad = [r for r in cov if (r["cover"]["gt150"] or 0) > FAR150_MAX]
            R.row("land-far150", not bad, "land more than 150 m away: " + "; ".join("s%d %s%%" % (r["seed"], f(100 * (r["cover"]["gt150"] or 0))) for r in cov), "<= %d %%" % (100 * FAR150_MAX), m)
        # ---- town roads: the road mesh (the legacy rule) AND towngen's own streets (Wave 7b: rec.roads.layout) ----
        wet_map = any(r["waterY"] > -100 for r in seeds.values())
        lay = {s: r["roads"].get("layout") or {} for s, r in seeds.items()}
        lay_wet = sorted(s for s, l in lay.items() if l.get("wet", 0) > 0)
        lay_tot = sum(l.get("wet", 0) for l in lay.values())
        lay_by = {}
        for l in lay.values():
            for pid, n in (l.get("wetByTown") or {}).items():
                lay_by[pid] = lay_by.get(pid, 0) + 1
        lay_seeds = sum(1 for l in lay.values() if l.get("layout"))
        if lay_seeds:
            S[m]["roadsWetLayout"] = {"seedsWet": len(lay_wet), "vertsWet": lay_tot, "bySeedsPerTown": lay_by, "seedsWithLayout": lay_seeds}
        if not wet_map and not lay_wet:
            v.info("town-roads-dry [%s]" % m, "no water on this map%s" % ((" (towngen's streets: %d samples on %d seeds, 0 wet)" % (sum(l.get("verts", 0) for l in lay.values()), lay_seeds)) if lay_seeds else ""))
        else:
            nomesh = [s for s, r in seeds.items() if not r["roads"]["meshFound"]] if wet_map else []
            if nomesh:
                R.row("town-roads-dry", None, "no road mesh found on %d of %d seeds (the 'roads' mesh is where the ribbon lives)" % (len(nomesh), len(seeds)), None, m)
            else:
                wetseeds = sorted(s for s, r in seeds.items() if r["roads"]["wetTown"] > 0)
                tot = sum(r["roads"]["wetTown"] for r in seeds.values())
                bypoi = {}
                for r in seeds.values():
                    for pid, n in r["roads"]["wetByPoi"].items():
                        bypoi[pid] = bypoi.get(pid, 0) + 1
                S[m]["roadsWet"] = {"seedsWet": len(wetseeds), "vertsWet": tot, "bySeedsPerPoi": bypoi}
                ok = not wetseeds and not lay_wet
                lay_txt = (" | towngen's streets: %d samples on %d seeds with a layout, %s" % (sum(l.get("verts", 0) for l in lay.values()), lay_seeds, "0 wet" if not lay_wet else
                           "%d wet on %d seeds (%s)" % (lay_tot, len(lay_wet), ", ".join("%s %d" % (k, n) for k, n in sorted(lay_by.items(), key=lambda kv: -kv[1]))))) if lay_seeds else " | no towngen layout on this build (the road mesh is all there is)"
                R.row("town-roads-dry", ok, (("road mesh: 0 town road vertices below waterY on %d seeds (%d town vertices on seed %s)" % (len(seeds), next(iter(seeds.values()))["roads"]["townVerts"], min(seeds))) if not wetseeds else
                      "road mesh: %d wet town road vertices on %d of %d seeds (%s%%); seeds with a wet street per town: %s" % (tot, len(wetseeds), len(seeds), f(100 * len(wetseeds) / len(seeds)), ", ".join("%s %d" % (k, n) for k, n in sorted(bypoi.items(), key=lambda kv: -kv[1])))) + lay_txt,
                      "0 vertices on every seed", m)
        links = [r["city"]["links"] for r in seeds.values() if r.get("city")]
        if links and any(l["wet"] for l in links):
            v.info("%s inter-town link roads under water (information, not a town road)" % m, "%d of %d seeds have a wet link road (max %d wet vertices): a link may cross water on a bridge or a ford" % (sum(1 for l in links if l["wet"]), len(links), max(l["wetVerts"] for l in links)))
        # ---- every named town ----
        pois = {}
        for r in seeds.values():
            for p in r["pois"]:
                pois.setdefault(p["id"], p["name"])
        tstat = {}
        for pid in pois:
            vals = [r["perPoi"].get(pid, 0) for r in seeds.values()]
            tstat[pid] = {"name": pois[pid], "min": min(vals), "p50": pctl(vals, 0.5), "max": max(vals), "below": sum(1 for x in vals if x < TOWN_MIN), "n": len(vals)}
        S[m]["towns"] = tstat
        named = [k for k in tstat if m not in TOWN_TABLE or k in TOWN_TABLE[m]]          # Wave 7b: the themed maps gate their NAMED TOWNS (TOWN_TABLE); Savanna every POI
        rest = [k for k in tstat if k not in named]
        gone = [k for k in (TOWN_TABLE.get(m) or ()) if k not in tstat]
        low = sorted((k for k in named if tstat[k]["min"] < TOWN_MIN), key=lambda k: tstat[k]["p50"])
        v.info("%s enterable per named town (min / median / max over %d seeds)" % (m, len(seeds)), "; ".join("%s %d/%s/%d" % (t["name"], t["min"], f(t["p50"], 0), t["max"]) for k, t in tstat.items() if k in named))
        if rest:
            v.info("%s other POIs (information: not a town)" % m, "; ".join("%s %d/%s/%d (under %d on %d of %d seeds)" % (tstat[k]["name"], tstat[k]["min"], f(tstat[k]["p50"], 0), tstat[k]["max"], TOWN_MIN, tstat[k]["below"], tstat[k]["n"]) for k in rest))
        if gone:
            R.row("town-enterables", False, "TOWN_TABLE names POIs this build's %s does not have: %s" % (m, ", ".join(gone)), None, m)
        else:
            R.row("town-enterables", not low, ("every named town has >= %d enterable buildings on every one of %d seeds (%s)" % (TOWN_MIN, len(seeds), ", ".join(tstat[k]["name"] for k in named))) if not low else
                  "%d of %d named towns dip under %d on some seed: %s" % (len(low), len(named), TOWN_MIN, "; ".join("%s min %d median %s (under %d on %d of %d seeds)" % (tstat[k]["name"], tstat[k]["min"], f(tstat[k]["p50"], 0), TOWN_MIN, tstat[k]["below"], tstat[k]["n"]) for k in low)),
                  "every town >= %d on every seed" % TOWN_MIN, m)
        # ---- compounds (Wave 7b): the 2-6 building farm / ruin clusters between the towns ----
        cities = [r["city"] for r in seeds.values() if r.get("city")]
        cmin = COMPOUND_MIN.get(m, 0)
        if not cities:
            R.row("compounds-placed", False, "this build's %s has no towngen layout (M.city is null): 0 compounds on every one of %d seeds" % (m, len(seeds)), ">= %d compounds on every seed" % cmin, m)
            R.row("compounds-enterable", False, "no compound to judge: this build's %s has no towngen layout" % m, ">= %d %% of compounds hold >= %d enterable buildings" % (100 * COMPOUND_SHARE, COMPOUND_BUILDINGS), m)
        else:
            counts = [len(c["compounds"]) for c in cities]
            few = [s for s, r in seeds.items() if len((r.get("city") or {"compounds": []})["compounds"]) < cmin]
            S[m]["compounds"] = {"min": min(counts), "p50": pctl(counts, 0.5), "max": max(counts), "seedsUnder": len(few), "layoutSeeds": len(cities)}
            R.row("compounds-placed", not few and len(cities) == len(seeds), "compounds per seed: min %d, median %s, max %d over %d seeds%s" % (min(counts), f(pctl(counts, 0.5), 0), max(counts), len(cities), ("; %d seeds under %d" % (len(few), cmin)) if few else ""), ">= %d compounds on every seed" % cmin, m)
            allc = [c for ci in cities for c in ci["compounds"]]
            good = sum(1 for c in allc if (c["found"] or 0) >= COMPOUND_BUILDINGS)
            fcount = {}
            for c in allc:
                fcount[c["found"]] = fcount.get(c["found"], 0) + 1
            S[m]["compoundsEnterable"] = {"compounds": len(allc), "good": good, "byFound": fcount}
            R.row("compounds-enterable", bool(allc) and good >= COMPOUND_SHARE * len(allc) and len(cities) == len(seeds), ("%d seeds have no towngen layout; " % (len(seeds) - len(cities)) if len(cities) != len(seeds) else "") + "%d of %d compounds (%s %%) hold >= %d enterable buildings by the pinned detector; enterable buildings per compound: %s" % (
                good, len(allc), f(100 * good / max(1, len(allc))), COMPOUND_BUILDINGS, ", ".join("%s: %d" % (k, fcount[k]) for k in sorted(fcount, key=lambda x: (x is None, x)))), ">= %d %% of compounds" % (100 * COMPOUND_SHARE), m)
        # ---- endgame ----
        eg = [r["endgame"] for r in seeds.values() if r.get("endgame")]
        if not eg:
            R.row("endgame-cover", None, "the sim's Storm was not available", None, m)
        else:
            ks = circles_of(eg[0])
            sh = lambda k: sum(1 for e in eg if e[k]["pieces"] >= ENDGAME_MIN) / len(eg)
            med = lambda k: pctl([e[k]["pieces"] for e in eg], 0.5)
            area = ks[-2]                                   # the area the last two circles span (r 31.4 m): see ENDGAME_NOTE
            S[m]["endgame"] = {"areaCircle": area, "areaShare": sh(area), "areaMedian": med(area), "finalShare": sh(ks[-1]), "finalMedian": med(ks[-1]), "c6Share": sh(ks[-3]), "c6Median": med(ks[-3]),
                               "finalNoRoof": sum(1 for e in eg if e["finalRoofs"] == 0)}
            v.info("%s endgame cover pieces over %d seeds" % (m, len(eg)), "circle %s (r %s m): median %s, >= %d on %s%% | circle %s (r %s m, the gated area): median %s, >= %d on %s%% | final %s (r %s m, strict): median %s, >= %d on %s%%; final circle with no roof slab on %d seeds" % (
                ks[-3], f(eg[0][ks[-3]]["r"]), f(med(ks[-3]), 0), ENDGAME_MIN, f(100 * sh(ks[-3])), area, f(eg[0][area]["r"]), f(med(area), 0), ENDGAME_MIN, f(100 * sh(area)),
                ks[-1], f(eg[0][ks[-1]]["r"]), f(med(ks[-1]), 0), ENDGAME_MIN, f(100 * sh(ks[-1])), S[m]["endgame"]["finalNoRoof"]))
            R.row("endgame-cover", sh(area) >= ENDGAME_SEED_SHARE, "the area of the last two circles (circle %s, r %s m) holds >= %d static cover pieces on %s%% of %d seeds (median %s pieces; the 9.4 m final circle alone: %s%%)" % (
                area, f(eg[0][area]["r"]), ENDGAME_MIN, f(100 * sh(area)), len(eg), f(med(area), 0), f(100 * sh(ks[-1]))), ">= %d %% of seeds" % (100 * ENDGAME_SEED_SHARE), m)
            fin = ks[-1]
            v.info("endgame-final-%s [%s] (INFORMATION: the strict final circle, r %s m)" % (fin, m, f(eg[0][fin]["r"])), "median %s cover pieces, p10 %s, >= %d pieces on %s%% of %d seeds; no roof slab on %d seeds (Wave 7b target: reported, not gated: 10 pieces inside a 277 m2 disc is out of reach of any 56 m block layout)" % (
                f(med(fin), 0), f(pctl([e[fin]["pieces"] for e in eg], 0.1), 0), ENDGAME_MIN, f(100 * sh(fin)), len(eg), S[m]["endgame"]["finalNoRoof"]))
    return S


# ───────────────────────────── the selftest ─────────────────────────────
SELFTEST_JS = r"""
const fs = require("fs");
const API = (0, eval)("(" + fs.readFileSync(process.argv[process.argv.length - 1], "utf8") + ")()");
const box = (x0, x1, y0, y1, z0, z1) => ({ kind: "box", minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 });
// a maps.js-like house at (cx, cz): 7 x 6 m, walls 0.35 thick and 3.4 m high, a 1.4 m door in the south wall (or none), a 0.3 m roof deck
function house(cx, cz, opt) {
  const o = opt || {}, y = o.y || 0, out = [], T = 0.35, w = 7, d = 6, H = 3.4;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  out.push(box(x0, x1, y, y + H, z1 - T, z1), box(x0, x0 + T, y, y + H, z0, z1), box(x1 - T, x1, y, y + H, z0, z1));
  if (o.noDoor) out.push(box(x0, x1, y, y + H, z0, z0 + T));
  else { const dw = 1.4, dx0 = cx - dw / 2, dx1 = cx + dw / 2; out.push(box(x0, dx0, y, y + H, z0, z0 + T), box(dx1, x1, y, y + H, z0, z0 + T), box(dx0, dx1, y + 2.0, y + H, z0, z0 + T)); }
  out.push(box(x0 - 0.3, x1 + 0.3, y + H, y + H + 0.3, z0 - 0.3, z1 + 0.3));
  return out;
}
const flat = (h) => () => h;
const res = {};
const run = (name, cols, gnd, want) => {
  const r = API.detect(cols, gnd, -999);
  const ent = r.buildings.filter((b) => b.door).length, sealed = r.buildings.length - ent;
  res[name] = { got: [ent, sealed], want, ok: ent === want[0] && sealed === want[1] };
};
run("three houses with doors", [].concat(house(0, 0), house(30, 0), house(0, 30)), flat(0), [3, 0]);
run("one door, one sealed shell", [].concat(house(0, 0), house(30, 0, { noDoor: true })), flat(0), [1, 1]);
run("a pergola (roof on four posts) is not a building", [box(-3, 3, 3.4, 3.7, -3, 3), box(-3, -2.8, 0, 3.4, -3, -2.8), box(2.8, 3, 0, 3.4, -3, -2.8), box(-3, -2.8, 0, 3.4, 2.8, 3), box(2.8, 3, 0, 3.4, 2.8, 3)], flat(0), [0, 0]);
run("a closed box (no room) is not a building", [box(-4, 4, 0, 3.4, -4, 4), box(-4.3, 4.3, 3.4, 3.7, -4.3, 4.3)], flat(0), [0, 0]);
// alignment: the 0.5 m cell lattice and the 0.35 m walls meet at every phase; a house must be found (and a sealed one stay sealed) at all of them
{
  let bad = [];
  for (let k = 0; k < 12; k++) {
    const ox = (k * 0.137) % 0.5, oz = (k * 0.291) % 0.5;
    const a = API.detect(house(ox, oz), flat(0), -999).buildings, b = API.detect(house(ox, oz, { noDoor: true }), flat(0), -999).buildings;
    if (!(a.length === 1 && a[0].door === true && b.length === 1 && b[0].door === false)) bad.push([ox, oz, a.length, a.length && a[0].door, b.length, b.length && b[0].door]);
  }
  res["found / sealed correctly at 12 lattice phases"] = { got: bad.length ? bad.slice(0, 3) : 0, want: 0, ok: bad.length === 0 };
}
// a door whose threshold is 0.9 m over the street (the ground drops 0.9 m from the door line outward): the controller's 0.55 m step cannot get in
run("a doorway on a 0.9 m step is sealed", house(0, 0), (x, z) => (z < -2.6 ? -0.9 : 0), [0, 1]);
// a ramp counts as a wall (the stair well of a tower): a house with a ramp inside is one building
run("a house with a stair ramp inside", [].concat(house(0, 0), [{ kind: "ramp", minX: -2.5, maxX: -1, minY: 0, maxY: 3.1, minZ: -1.5, maxZ: 2, dir: 2 }]), flat(0), [1, 0]);
// the distance statistic: one house at the centre of a 100 m square of dry land (grid 4 m): median must equal the exact figure
const rect = { x0: -3.2, x1: 3.2, z0: -2.7, z1: 2.7 };
const cov = API.landDistance([rect], flat(0), -999, 50, 4);
const exp = []; for (let j = 0; j < 25; j++) for (let i = 0; i < 25; i++) { const x = -50 + (i + 0.5) * 4, z = -50 + (j + 0.5) * 4; const dx = Math.max(rect.x0 - x, 0, x - rect.x1), dz = Math.max(rect.z0 - z, 0, z - rect.z1); exp.push(Math.hypot(dx, dz)); }
exp.sort((a, b) => a - b);
const q = (a, p) => { const k = (a.length - 1) * p, lo = Math.floor(k), hi = Math.min(lo + 1, a.length - 1); return a[lo] + (a[hi] - a[lo]) * (k - lo); };
const want = Math.round(q(exp, 0.5) * 10) / 10, want90 = Math.round(q(exp, 0.9) * 10) / 10;
res["land distance median / p90 match a brute-force recount"] = { got: [cov.median, cov.p90], want: [want, want90], ok: cov.median === want && cov.p90 === want90 && cov.landCells === 625 };
console.log(JSON.stringify(res));
process.exit(Object.values(res).every((x) => x.ok) ? 0 : 1);
"""


def selftest(v):
    p = subprocess.run(["node", "-e", SELFTEST_JS, PROBE], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    try:
        res = json.loads((p.stdout or "").strip().splitlines()[-1])
    except Exception:
        raise C.EnvFailure("selftest: node produced no result: %s" % ((p.stderr or p.stdout or "")[-300:]))
    for name, r in res.items():
        v.check("selftest: " + name, r["ok"], "got %s, want %s" % (r["got"], r["want"]))
    selftest_judge(v)


class _Quiet:
    """a Verdict stand-in for the judge selftest: records (name, ok) and prints nothing"""

    def __init__(self):
        self.rows, self.data = [], {}

    def check(self, name, ok, detail="", expect=None):
        self.rows.append((name, ok))
        return ok

    def cnj(self, name, why):
        self.rows.append((name, None))

    def info(self, name, detail=""):
        pass


def _fake_row(seed=1, map_id="isla_viva"):
    """one (map, seed) record shaped like probe_city.measure()'s, on a themed map whose every row passes"""
    pois = [{"id": i, "name": i.replace("_", " ").title()} for i in ("palm_bay", "coco_village", "volcano_rim", "shipwreck", "lagoon_docks", "jungle_market")]
    cc = {"r": 31.4, "pieces": 40, "roofs": 3}
    return {"map": map_id, "seed": seed, "waterY": 0, "enterable": 100, "sealed": 0, "pois": pois, "perPoi": {p["id"]: 12 for p in pois},
            "cover": {"within25": 0.25, "median": 40.0, "p90": 80.0, "gt150": 0.01, "landKm2": 0.5},
            "roads": {"meshFound": True, "wetTown": 0, "townVerts": 100, "wetByPoi": {}, "townByPoi": {},
                      "layout": {"layout": True, "towns": 6, "verts": 900, "wet": 0, "wetByTown": {}, "vertsByTown": {}}},
            "endgame": {"c6": dict(cc, r=70.6), "c7": dict(cc), "c8": dict(cc, r=9.4, pieces=4), "final": "c8", "finalPieces": 4, "finalRoofs": 1},
            "city": {"version": 4, "towns": [], "compounds": [{"id": "cmp%02d" % i, "found": 4, "claimed": 4, "buildings": 4} for i in range(8)], "links": {"n": 3, "wet": 0, "wetVerts": 0}}}


def selftest_judge(v):
    """the Wave-7b JUDGE logic on synthetic records (offline, no Node): a good themed map passes every row, and each defect breaks exactly its own row"""
    class A:
        quick, seeds_n = True, 30

    def run(mutate=None, map_id="isla_viva"):
        rows = []
        for sd in (1, 2, 7, 1234, 2026):
            r = _fake_row(sd, map_id)
            if mutate and sd in (7, 2026):
                mutate(r)
            rows.append(r)
        q = _Quiet()
        R = Rows(q, True, [map_id])
        judge(q, R, rows, [map_id], [7, 1234, 2026], A)
        return {n.split(" [")[0]: ok for n, ok in q.rows}

    def lowtown(r): r["perPoi"]["lagoon_docks"] = 3
    def lowrest(r): r["perPoi"]["shipwreck"] = 0                    # a POI outside the named table: information only
    def fewcmp(r): r["city"]["compounds"] = r["city"]["compounds"][:3]
    def thincmp(r):
        for c in r["city"]["compounds"][:6]: c["found"] = 1
    def wetlayout(r): r["roads"]["layout"].update(wet=4, wetByTown={"palm_bay": 4})
    def wetmesh(r): r["roads"].update(wetTown=2, wetByPoi={"coco_village": 2})
    def nocity(r): r["city"] = None
    def lowc7(r): r["endgame"]["c7"]["pieces"] = 2
    cases = [("a good themed map passes every row", None, lambda o: all(x is True for x in o.values()) and {"town-enterables", "compounds-placed", "compounds-enterable", "town-roads-dry", "endgame-cover"} <= set(o)),
             ("a named town under 6 breaks town-enterables", lowtown, lambda o: o["town-enterables"] is False and o["compounds-placed"] is True),
             ("a POI outside the named table does not", lowrest, lambda o: o["town-enterables"] is True),
             ("3 compounds break compounds-placed", fewcmp, lambda o: o["compounds-placed"] is False),
             ("compounds with one enterable building break compounds-enterable", thincmp, lambda o: o["compounds-enterable"] is False and o["compounds-placed"] is True),
             ("a wet towngen street breaks town-roads-dry", wetlayout, lambda o: o["town-roads-dry"] is False),
             ("a wet road-mesh vertex breaks town-roads-dry", wetmesh, lambda o: o["town-roads-dry"] is False),
             ("no towngen layout breaks both compound rows", nocity, lambda o: o["compounds-placed"] is False and o["compounds-enterable"] is False),
             ("2 cover pieces in c7 break endgame-cover", lowc7, lambda o: o["endgame-cover"] is False)]
    for name, mut, want in cases:
        o = run(mut)
        v.check("selftest judge: " + name, bool(want(o)), {k: o[k] for k in sorted(o)})
    # Savanna (every POI counts) keeps the Wave-7 rule: the same low POI that the themed table ignores breaks it
    q = run(lowrest, "ashgrid")
    v.check("selftest judge: ashgrid judges EVERY POI (no named table)", q["town-enterables"] is False, q)


# ───────────────────────────── towngen forecast ─────────────────────────────
def towngen_forecast(v, args, R, root, vendor, maps, cover, wide):
    """Wave-7 forecast: lane 6B's towngen.js scored against the same rows (placement_census.mjs --mode towngen; see its header for what is replaced)."""
    tg = os.path.join(root, "runtime", "3d", "royale", "towngen.js")
    if not os.path.isfile(tg):
        v.cnj("towngen forecast", "runtime/3d/royale/towngen.js does not exist at this revision (lane 6B)")
        return None
    t0 = time.time()
    seeds = sorted(set(wide) | set(cover))
    rows = node_tasks(root, vendor, maps, {m: seeds for m in maps}, set(), args.jobs, args.census_timeout, mode="towngen")
    v.info("towngen forecast", "%d (map, seed) layouts scored in %.0f s (towngen v%s); the CURRENT world with every POI that towngen fills replaced by its layout" % (len(rows), time.time() - t0, rows[0]["tg"]["version"] if rows else "?"))
    for m in maps:
        mr = [r for r in rows if r["map"] == m and r["seed"] in cover]
        if mr:
            r = mr[0]
            t = r["tg"]
            v.info("forecast %s layout (seed %d)" % (m, r["seed"]), "towns %d (%d enterable), compounds %d (%d enterable), current buildings kept outside the replaced POIs %d, towngen shells in towns %d, max floors %d, buildings %d of which enterable %d; endgame K %d pieces per enterable building (p10 %s); towngen %d ms" % (
                t["towns"], t["enterableTowns"], t["compounds"], t["enterableCompounds"], t["keptCurrent"], t["shellsTowns"], t["maxFloors"], t["buildingsAll"], t["enterableAll"], t["K"], t.get("Kp10"), t["ms"]))
    S = judge(v, R, rows, maps, cover, args)
    for m in maps:
        links = [r["roads"].get("linkWet", 0) for r in rows if r["map"] == m and r["seed"] in wide]
        if links and max(links):
            v.info("forecast %s inter-town links under water" % m, "%d of %d seeds have a link road with wet vertices (max %d): not a town road, but a Wave-7 road still to be trimmed" % (sum(1 for x in links if x), len(links), max(links)))
    return S


def main_fn(v, args):
    t0 = time.time()
    if args.selftest:
        selftest(v)
        return
    maps = [m for m in (args.maps or ",".join(C.MAPS)).split(",") if m]
    root, label = C.ROOT, "working copy"
    if args.rev:
        root, sha = PC.rev_root(args.rev)
        label = "git %s" % sha
    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    cover = [int(x) for x in (args.cover_seeds or ",".join(str(s) for s in COVER_SEEDS)).split(",") if x]
    n_wide = 30 if args.quick else args.seeds_n
    wide = list(range(1, n_wide + 1))
    live_seeds = [int(x) for x in args.live_seeds.split(",") if x]
    live_maps = [m for m in args.live_maps.split(",") if m and m in maps]
    seeds_all = sorted(set(wide) | set(cover) | (set(live_seeds) if live_maps else set()))
    blocking = bool(args.blocking)
    block_maps = [m for m in (",".join(C.MAPS) if args.block_maps == "all" else args.block_maps).split(",") if m]
    if args.city_plant and args.city_plant not in PLANT_ROWS:
        raise C.HarnessError("unknown --city-plant %r (known: %s)" % (args.city_plant, ", ".join(sorted(PLANT_ROWS))))
    R = Rows(v, blocking, block_maps, PLANT_ROWS.get(args.city_plant))
    v.data.update({"root": label, "mode": "BLOCKING" if blocking else "INFORMATION", "blockMaps": block_maps, "coverSeeds": cover, "wideSeeds": n_wide, "pin": "probe_city.js v1"})
    print("%s: %s | maps %s | cover seeds %s | %d seeds for the many-seed rows | %s" % (GATE, label, ",".join(maps), cover, n_wide, "BLOCKING" if blocking else "INFORMATION (Wave 6: no towns in the live game yet, the coverage rows are expected to fail)"), flush=True)
    if args.towngen:
        S = towngen_forecast(v, args, R, root, vendor, maps, cover, wide)
        v.data["forecast"] = S
        if S is not None and not blocking:
            failing = sorted(k for k, ok in R.state.items() if ok is False)
            v.check("forecast scored (INFORMATION: %d rows would FAIL%s; --blocking makes them gate)" % (len(failing), (": " + ", ".join(failing[:6]) + ("..." if len(failing) > 6 else "")) if failing else ""), True, {"wouldFail": failing})
        v.data["rows"] = {k: ok for k, ok in R.state.items()}
        return
    tree0 = tree_state(root)
    rows = node_tasks(root, vendor, maps, {m: seeds_all for m in maps}, set(cover), args.jobs, args.census_timeout, extra=(["--city-plant", args.city_plant] if args.city_plant else None))
    v.info("Node replay", "%d (map, seed) builds measured in %.0f s (%d jobs)" % (len(rows), time.time() - t0, args.jobs))
    S = judge(v, R, rows, maps, cover, args)
    v.data["summary"] = S
    # ---- the live half: ONE Chrome per map ----
    live = {}
    if live_maps and not args.quick and not args.no_live:
        with open(PROBE, encoding="utf-8") as fh:
            src = fh.read()
        byk = {(r["map"], r["seed"]): r for r in rows}
        for m in live_maps:
            for sd in live_seeds:
                moved = tree_changed(tree0, tree_state(root))
                if moved:
                    R.row("detector-parity", None, "the served tree changed after the Node half started (%s): Chrome and Node would build different worlds - re-run on a stable tree" % ", ".join(moved[:4]), None, m)
                    continue
                try:
                    lr = live_record(args, m, sd, src)
                except C.EnvFailure as e:
                    R.row("detector-parity", None, "live half: %s" % e, None, m)
                    continue
                moved = tree_changed(tree0, tree_state(root))
                if moved:
                    R.row("detector-parity", None, "the served tree changed while the page was measured (%s) - re-run on a stable tree" % ", ".join(moved[:4]), None, m)
                    continue
                nr = byk.get((m, sd))
                ok, why = same_buildings(lr.get("buildings", []), nr.get("buildings", [])) if nr else (False, "the Node replay has no (%s, %d)" % (m, sd))
                same_counts = nr and lr["enterable"] == nr["enterable"] and lr["sealed"] == nr["sealed"] and abs((lr["cover"]["median"] or 0) - (nr["cover"]["median"] or 0)) < 0.2
                live[m + ":" + str(sd)] = {"enterable": lr["enterable"], "sealed": lr["sealed"], "median": lr["cover"]["median"], "liveMs": lr["liveMs"], "load": lr["load"], "pageErrors": lr["pageErrors"], "node": {"enterable": nr["enterable"], "median": nr["cover"]["median"]} if nr else None}
                v.info("live %s seed %d" % (m, sd), "load %s s; %d enterable (sealed %d), median %s m, land %s km2, probe %d ms; page errors %d, failed requests %d" % (
                    lr["load"].get("load_s"), lr["enterable"], lr["sealed"], f(lr["cover"]["median"]), f(lr["cover"]["landKm2"], 2), lr["liveMs"], len(lr["pageErrors"]), lr["failedRequests"]))
                R.row("detector-parity", bool(ok and same_counts) and not lr["pageErrors"], ("live == Node: %d enterable (sealed %d), median %s m" % (lr["enterable"], lr["sealed"], f(lr["cover"]["median"]))) if ok and same_counts else
                      "live %s vs Node %s: %s" % (lr["enterable"], nr["enterable"] if nr else "-", why or "statistics differ"), "same buildings in the page and in Node", m)
    elif not args.quick:
        v.info("detector-parity", "skipped (--no-live)")
    v.data["live"] = live
    # ---- verdict ----
    measured = len(rows)
    failing = sorted(k for k, ok in R.state.items() if ok is False)
    if not blocking:
        if measured:
            v.check("measured %d builds (INFORMATION: %d rows would FAIL%s; --blocking makes them gate)" % (measured, len(failing), (": " + ", ".join(failing[:6]) + ("..." if len(failing) > 6 else "")) if failing else ""), True,
                    {"builds": measured, "wouldFail": failing})
        else:
            v.cnj("measured builds", "nothing was measured")
    v.data["rows"] = {k: ok for k, ok in R.state.items()}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=None, help="comma list (default: all three)")
    ap.add_argument("--blocking", action="store_true", help="Wave 7: the rows gate (default: information)")
    ap.add_argument("--block-maps", default="ashgrid", help="maps whose rows gate under --blocking: a comma list or `all` (default ashgrid = Savanna; Wave 7b: all three)")
    ap.add_argument("--city-plant", default=None, help="negative control (Wave 7b): %s - only the named rows count" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--cover-seeds", default=None, help="coverage-row seeds (default %s)" % ",".join(str(s) for s in COVER_SEEDS))
    ap.add_argument("--seeds-n", type=int, default=WIDE_N, help="seeds 1..N for the many-seed rows (default %d)" % WIDE_N)
    ap.add_argument("--quick", action="store_true", help="30 seeds, no Chrome")
    ap.add_argument("--jobs", type=int, default=3, help="Node processes at a time")
    ap.add_argument("--no-live", action="store_true", help="skip the Chrome half")
    ap.add_argument("--live-maps", default="ashgrid", help="maps measured in Chrome (default ashgrid)")
    ap.add_argument("--live-seeds", default="7", help="seeds measured in Chrome (default 7)")
    ap.add_argument("--towngen", action="store_true", help="forecast: score lane 6B's towngen.js against the same rows")
    ap.add_argument("--selftest", action="store_true", help="offline: the detector on a synthetic village")
    ap.add_argument("--census-timeout", type=int, default=3600)
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
