#!/usr/bin/env python
"""homes - w10_homes: are the furnished homes house-sized, furnished like homes, with kitchens, baths and real-size furniture?  (Wave 10, round 1, lane R1A.)
NODE ONLY: no browser, no server, no file of the tree edited (a planted fault edits a scratch copy).

    python _harness/p23/homes.py --disk                     # the working copy: 3 maps x seeds 1, 7, 1234, 2026 (12 builds) + a determinism re-build (~1-2 min)
    python _harness/p23/homes.py --rev 361c5ec3             # a frozen commit (the W9 tip: every W10 row FAILS there)
    python _harness/p23/homes.py --disk --plant sparse      # a planted fault (see PLANTS): exit 1 = caught

homes.mjs builds each map with the unmodified maps.js (world_env.mjs) and records every enterable building and every room of a home (use house, not a ruin),
the same census as the W10 houses audit (F:/lc_p23/w10/audit/houses/census.mjs). "Substantive" = a piece whose drawn type is not filler (the audit's FILL list:
clocks, lamps, plants, bins, art, posters, rugs, wall shelves, mirrors, whiteboards, runners, coat racks, monitors, cartons, small boxes, a slim TV, a microwave).
"Lived rooms" = living, bedroom, kitchen, dining (of homes).

Rows (any FAIL -> exit 1; the census not running -> exit 2):
  home-size     0 homes under 100 m2 of footprint (W x D), 0 homes at 7.5 x 7.5 m                                  [audit: 403 at 7.5 x 7.5; half <= 75 m2]
  storeys       >= 40 % of homes two-storey pooled over the 12 builds, each map >= 30 %                             [16.9 %]
  programme     100 % of homes hold living + kitchen + bedroom + bath; median rooms (corridors not counted) >= 5     [median 3; no kitchen 48.9 %]
  sheds         one-room enterable buildings <= 8 % of all enterable buildings                                       [15 %]
  coverage      lived rooms: median floor coverage (standing pieces' footprint / room area) >= 25 %; <= 10 % under 15 %   [15 %; 53 % under 15 %]
  density       lived rooms: substantive pieces per 10 m2 median >= 2.5; every lived room >= 6 substantive pieces    [1.6; median 4]
  sets          bedroom bed 100 %, nightstand >= 90 %, wardrobe / dresser >= 90 %; living sofa >= 98 %, coffee table >= 90 %, TV unit >= 80 %;
                kitchen dining set (a table + >= 2 chairs in the kitchen or a room it opens into) >= 95 %          [kitchen table 50.5 %]
  kitchen-run   the kitchen's base units form ONE run (each touching the next within 0.05 m) in >= 90 % of kitchens; upper cabinets >= 70 %;
                a hood over the stove >= 70 %                                                                         [uppers 69 / 866; 0 hoods]
  bath-set      baths: a basin with a mirror over it >= 90 %, a shower or tub >= 90 % (plan item 7)
  filler        filler <= 35 % of a home's pieces (pooled); clocks <= 1 in every home; floor lamps <= 1 and potted plants <= 1 in every room   [48.8 %]
  narrow        living / kitchen / bedroom: the narrow side of the room's biggest rectangle >= 5.0 m in >= 98 %; bath long / narrow <= 2.0 in >= 95 %   [19.7 % at 2.5 m]
  scale         housegen.FURN_K in [1.15, 1.25] and every kit piece's collider == the box the kit DRAWS for its entry (manifest bbox x the entry's scale,
                citykit's quarter turn) within 2 cm (0 mismatches)                                                   [k = 1.0]
  tris          furnished home storeys: p90 <= 6,000 triangles (housegen's own count of what it draws)                [p50 3,341]
  loot          every map x seed: the map's loot points (map.lootPoints - it holds every house's points - + house chests) within +-10 % of the W9 tip
  loot-density  homes' loot points (+ chests) per m2 of room, per map (4 seeds pooled), within +-15 % of the W9 tip (the plan's loot row, second half)
  determinism   the first map x seed built twice gives the same census hash
Plants (a scratch copy of runtime/ + assets/props with ONE source edit; each must exit 1 on its rows):
  tiny-homes (7.5 x 7.5 back in towngen ARCH house_s, one floor) -> home-size, storeys     sparse (the area quota off: VIEW_WANT top-up only) -> coverage, density
  clock-spam (the clock / lamp / plant caps off) -> filler      gap-kitchen (base units spaced, not run) -> kitchen-run     strip-rooms (1-cell minimum width) -> narrow
  scale-draw-only (kit drawn at k, colliders at 1) -> scale     no-programme (the minimum programme off) -> programme       shed-flood (shed weights x20) -> sheds
  no-sets (the centre groups off) -> sets       tri-flood (TRI_BUDGET 6000 -> 60000 and the quota 1 per 1.5 m2) -> tris     loot-drop (house loot halved) -> loot
  rng-leak (Math.random in the furnisher) -> determinism     no-bath-set (no mirror / shower) -> bath-set     (loot-drop also -> loot-density)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import statistics
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402

C = L.C
GATE = "w10_homes"
HERE = os.path.dirname(os.path.abspath(__file__))
MJS = os.path.join(HERE, "homes.mjs")
MAPS = "isla_viva,ashgrid,deepwood"
SEEDS = "1,7,1234,2026"
W9_TIP = "361c5ec3"          # the Wave-9 round-1 tip Wave 10 starts from (master 361c5ec3 = LIVE_REV b7e245ef + the gates baseline move): the loot baseline. NEVER moves
HG = "runtime/3d/royale/housegen.js"
TG = "runtime/3d/royale/towngen.js"
# plant -> (rows that must FAIL, [(file, regex, replacement)]) - each regex must match exactly once in the scratch copy (else could-not-judge)
PLANTS = {
    "tiny-homes": ({"home-size", "storeys"}, [(TG, r'house_s: \{ use: "house", gen: "house", dims: \[[^\n]*?\], floors: \[[^\]]*\]',
                                                 'house_s: { use: "house", gen: "house", dims: [[7.5, 7.5], [10, 7.5]], floors: [1]')]),
    "sparse": ({"coverage", "density"}, [(HG, r"export const AREA_QUOTA = true;", "export const AREA_QUOTA = false;")]),
    "clock-spam": ({"filler"}, [(HG, r"export const FILLER_CAPS = true;", "export const FILLER_CAPS = false;")]),
    "gap-kitchen": ({"kitchen-run"}, [(HG, r"export const KITCHEN_RUN = true;", "export const KITCHEN_RUN = false;")]),
    "strip-rooms": ({"narrow"}, [(HG, r"export const MIN_ROOM_W = 2;", "export const MIN_ROOM_W = 1;")]),
    "scale-draw-only": ({"scale"}, [(HG, r"const COL_K = FURN_K;", "const COL_K = 1;")]),
    "no-programme": ({"programme"}, [(HG, r"export const HOME_PROGRAMME = true;", "export const HOME_PROGRAMME = false;")]),
    "shed-flood": ({"sheds"}, [(TG, r"export const SHED_W = 1;", "export const SHED_W = 20;")]),
    "no-sets": ({"sets"}, [(HG, r"export const CENTRE_GROUPS = true;", "export const CENTRE_GROUPS = false;")]),
    "tri-flood": ({"tris"}, [(HG, r"export const TRI_BUDGET_HOME = 6000;", "export const TRI_BUDGET_HOME = 60000;"),
                             (HG, r"export const QUOTA_M2 = 4;", "export const QUOTA_M2 = 1.5;")]),
    "loot-drop": ({"loot", "loot-density"}, [(HG, r"export const LOOT_KEEP = 1;", "export const LOOT_KEEP = 0.5;")]),
    "rng-leak": ({"determinism"}, [(HG, r"export const RNG_LEAK = false;", "export const RNG_LEAK = true;")]),
    "no-bath-set": ({"bath-set"}, [(HG, r"export const BATH_SET = true;", "export const BATH_SET = false;")]),
}


def pct(a, b):
    return 100.0 * a / b if b else 0.0


def q(vals, p):
    v = sorted(vals)
    return v[min(len(v) - 1, int(p * len(v)))] if v else None


def planted_root(src, plant):
    """a scratch copy of <src>/runtime + assets/props + assets/vendor with the plant's edits (each anchor must match exactly once)"""
    dst = tempfile.mkdtemp(prefix="lc_w10homes_%s_" % plant)
    for part in ("runtime", os.path.join("assets", "props"), os.path.join("assets", "vendor")):
        if os.path.isdir(os.path.join(src, part)):
            shutil.copytree(os.path.join(src, part), os.path.join(dst, part))
    for rel, rx, rep in PLANTS[plant][1]:
        fn = os.path.join(dst, rel.replace("/", os.sep))
        with open(fn, encoding="utf-8") as fh:
            s = fh.read()
        n = len(re.findall(rx, s))
        if n != 1:
            raise C.EnvFailure("plant %s: anchor %r matched %d times in %s (the tree moved: re-anchor the plant)" % (plant, rx, n, rel))
        s = re.sub(rx, lambda _m: rep, s)
        with open(fn, "w", encoding="utf-8") as fh:
            fh.write(s)
    return dst


def census(root, maps, seeds, twice):
    argv = [MJS, "--root", root, "--maps", maps, "--seeds", seeds, "--vendor", os.path.join(root, "assets", "vendor", "three")]
    if twice:
        argv.append("--twice")
    data, _tail, secs = L.run_node(argv, timeout=3600)
    data["secs"] = secs
    return data


def baseline(maps, seeds):
    """the W9 tip's census (cached by maps / seeds under _reports)"""
    fn = os.path.join(C.REPORTS, "w10_homes_base_%s_%s_%s.json" % (W9_TIP, maps.replace(",", "-"), seeds.replace(",", "-")))
    if os.path.isfile(fn):
        with open(fn, encoding="utf-8") as fh:
            return json.load(fh)
    root, _label = L._rev_root(W9_TIP)
    d = census(root, maps, seeds, False)
    os.makedirs(C.REPORTS, exist_ok=True)
    with open(fn, "w", encoding="utf-8") as fh:
        json.dump(d, fh)
    return d


def judge(v, d, base):
    B = d["builds"]
    homes = [b for R in B for b in R["buildings"] if b["home"]]
    allb = [b for R in B for b in R["buildings"]]
    rooms = [r for R in B for r in R["rooms"]]
    lived = [r for r in rooms if r["kind"] in ("living", "bedroom", "kitchen", "dining")]
    if not homes or not lived:
        v.cnj("census", "no homes / lived rooms in %d builds" % len(B))
        return
    v.data["census"] = {"builds": len(B), "buildings": len(allb), "homes": len(homes), "rooms": len(rooms), "lived": len(lived), "furnK": d.get("furnK"), "hgVersion": d.get("hgVersion"),
                        "genVersion": d.get("genVersion"), "secs": d.get("secs")}
    v.info("census", v.data["census"])
    # home-size
    small = [b for b in homes if b["W"] * b["D"] < 100 - 1e-6]
    tiny = [b for b in homes if abs(b["W"] - 7.5) < 1e-6 and abs(b["D"] - 7.5) < 1e-6]
    fp = sorted(b["W"] * b["D"] for b in homes)
    v.check("home-size", not small and not tiny, "%d homes; %d under 100 m2, %d at 7.5 x 7.5 (bar 0 / 0); footprint min %.1f p50 %.1f m2%s" % (
        len(homes), len(small), len(tiny), fp[0], q(fp, 0.5), (" e.g. " + small[0]["id"]) if small else ""), "0 under 100 m2, 0 at 7.5 x 7.5")
    # storeys
    two = pct(sum(1 for b in homes if b["storeys"] >= 2), len(homes))
    per = {}
    for R in B:
        hs = [b for b in R["buildings"] if b["home"]]
        per.setdefault(R["map"], [0, 0])
        per[R["map"]][0] += sum(1 for b in hs if b["storeys"] >= 2)
        per[R["map"]][1] += len(hs)
    perp = {m: pct(a, n) for m, (a, n) in per.items()}
    v.check("storeys", two >= 40 and all(x >= 30 for x in perp.values()), "two-storey homes %.1f %% pooled (bar >= 40); per map %s (bar >= 30 each)" % (
        two, ", ".join("%s %.1f %%" % kv for kv in perp.items())), ">= 40 % pooled, >= 30 % per map")
    # programme
    need = ("living", "kitchen", "bedroom", "bath")
    miss = [b for b in homes if not all(k in b["kinds"].split("+") for k in need)]
    medr = statistics.median(b["roomsNonHall"] for b in homes)
    v.check("programme", not miss and medr >= 5, "%d of %d homes miss a living / kitchen / bedroom / bath (bar 0)%s; median rooms %.1f (bar >= 5)" % (
        len(miss), len(homes), (" e.g. %s (%s)" % (miss[0]["id"], miss[0]["kinds"])) if miss else "", medr), "100 %, median >= 5")
    # sheds
    one = sum(1 for b in allb if b["rooms"] == 1)
    v.check("sheds", pct(one, len(allb)) <= 8, "one-room enterable buildings %d of %d = %.1f %% (bar <= 8 %%)" % (one, len(allb), pct(one, len(allb))), "<= 8 %")
    # coverage
    cov = [r["cov"] for r in lived]
    low = pct(sum(1 for c in cov if c < 0.15), len(cov))
    v.check("coverage", statistics.median(cov) >= 0.25 and low <= 10, "lived rooms %d: median coverage %.1f %% (bar >= 25), under 15 %%: %.1f %% (bar <= 10); by kind %s" % (
        len(cov), 100 * statistics.median(cov), low, ", ".join("%s %.0f %%" % (k, 100 * statistics.median([r["cov"] for r in lived if r["kind"] == k])) for k in ("living", "bedroom", "kitchen", "dining") if any(r["kind"] == k for r in lived))),
        "median >= 25 %, <= 10 % under 15 %")
    # density
    den = [10.0 * r["sub"] / r["area"] for r in lived]
    mins = min(r["sub"] for r in lived)
    worst = min(lived, key=lambda r: r["sub"])
    v.check("density", statistics.median(den) >= 2.5 and mins >= 6, "lived rooms: substantive per 10 m2 median %.2f (bar >= 2.5); fewest %d (bar >= 6: %s %s %.1f m2); rooms under 6: %d" % (
        statistics.median(den), mins, worst["h"], worst["kind"], worst["area"], sum(1 for r in lived if r["sub"] < 6)), "median >= 2.5, min >= 6")
    # sets
    def share(kind, key):
        rs = [r for r in rooms if r["kind"] == kind]
        return pct(sum(r[key] for r in rs), len(rs)), len(rs)
    S = {("bedroom", "bed"): 100, ("bedroom", "night"): 90, ("bedroom", "ward"): 90, ("living", "sofa"): 98, ("living", "coffee"): 90, ("living", "tv"): 80, ("kitchen", "dine"): 95}
    got = {k: share(*k) for k in S}
    v.check("sets", all(got[k][0] >= bar - 1e-9 for k, bar in S.items()), "; ".join("%s %s %.1f %% of %d (bar %d)" % (k[0], k[1], got[k][0], got[k][1], bar) for k, bar in S.items()),
            "bed 100, night 90, wardrobe 90, sofa 98, coffee 90, TV 80, dining 95")
    # kitchen-run
    ks = [r for r in rooms if r["kind"] == "kitchen"]
    one_run = pct(sum(1 for r in ks if r["base"] >= 1 and r["runs"] == 1), len(ks))
    up = pct(sum(r["upper"] for r in ks), len(ks))
    hood = pct(sum(r["hood"] for r in ks), len(ks))
    v.check("kitchen-run", one_run >= 90 and up >= 70 and hood >= 70, "kitchens %d: one closed base run %.1f %% (bar >= 90); upper cabinets %.1f %% (>= 70); hood over the stove %.1f %% (>= 70)" % (
        len(ks), one_run, up, hood), "run >= 90 %, uppers >= 70 %, hood >= 70 %")
    # bath-set
    bs = [r for r in rooms if r["kind"] == "bath"]
    sm = pct(sum(1 for r in bs if r["bsink"] and r["mirror"]), len(bs))
    wa = pct(sum(r["wash"] for r in bs), len(bs))
    v.check("bath-set", sm >= 90 and wa >= 90, "baths %d: basin + mirror %.1f %% (bar >= 90); shower or tub %.1f %% (bar >= 90)" % (len(bs), sm, wa), ">= 90 % / >= 90 %")
    # filler
    fill = pct(sum(b["fill"] for b in homes), sum(b["pieces"] for b in homes))
    clk = [b for b in homes if b["clocks"] > 1]
    lmp = [r for r in rooms if r["lamps"] > 1]
    pl = [r for r in rooms if r["plants"] > 1]
    v.check("filler", fill <= 35 and not clk and not lmp and not pl, "filler %.1f %% of home pieces (bar <= 35); homes with > 1 clock %d; rooms with > 1 floor lamp %d, > 1 potted plant %d (bars 0)" % (
        fill, len(clk), len(lmp), len(pl)), "<= 35 %, 0, 0, 0")
    # narrow
    lk = [r for r in rooms if r["kind"] in ("living", "kitchen", "bedroom")]
    wide = pct(sum(1 for r in lk if r["nw"] >= 5.0 - 1e-6), len(lk))
    bath_ok = pct(sum(1 for r in bs if r["nw"] > 0 and r["nl"] / r["nw"] <= 2.0 + 1e-9), len(bs))
    v.check("narrow", wide >= 98 and bath_ok >= 95, "living / kitchen / bedroom %d: narrow side >= 5.0 m in %.1f %% (bar >= 98); baths %d: aspect <= 2.0 in %.1f %% (bar >= 95)" % (
        len(lk), wide, len(bs), bath_ok), ">= 98 %, >= 95 %")
    # scale
    k = d.get("furnK") or 1
    kn = sum(R["kit"]["n"] for R in B)
    kb = sum(R["kit"]["bad"] for R in B)
    kw = max(B, key=lambda R: R["kit"]["worst"])["kit"]
    v.check("scale", 1.15 - 1e-9 <= k <= 1.25 + 1e-9 and kn > 0 and kb == 0, "FURN_K %.3f (bar 1.15 .. 1.25); kit pieces %d, collider != drawn box (> 2 cm) %d (bar 0); worst %.3f m (%s); entry scales %s" % (
        k, kn, kb, kw["worst"], kw["worstId"], json.dumps(B[0]["kit"]["ks"])), "k in [1.15, 1.25], 0 mismatches")
    # tris
    st = [t for b in homes for t in b["tris"] if t > 0]
    v.check("tris", bool(st) and q(st, 0.9) <= 6000, "home storeys %d: triangles p50 %d, p90 %d (bar <= 6000), max %d" % (len(st), q(st, 0.5), q(st, 0.9), max(st)), "p90 <= 6000")
    # loot
    if base is None:
        v.cnj("loot", "no W9-tip baseline census")
    else:
        bb = {(R["map"], R["seed"]): R for R in base["builds"]}
        bad, parts = [], []
        for R in B:
            o = bb.get((R["map"], R["seed"]))
            if not o:
                continue
            r = R["loot"]["total"] / max(1, o["loot"]["total"])
            parts.append("%s s%d %d -> %d (x%.3f)" % (R["map"], R["seed"], o["loot"]["total"], R["loot"]["total"], r))
            if not 0.9 <= r <= 1.1:
                bad.append(parts[-1])
        dens = []
        for m in sorted({R["map"] for R in B}):
            a = sum(R["homeLoot"] for R in B if R["map"] == m) / max(1e-9, sum(R["homeArea"] for R in B if R["map"] == m))
            b0 = sum(o["homeLoot"] for o in base["builds"] if o["map"] == m) / max(1e-9, sum(o["homeArea"] for o in base["builds"] if o["map"] == m))
            r = a / b0 if b0 else 0
            dens.append("%s %.4f -> %.4f /m2 (x%.3f)" % (m, b0, a, r))
            if not 0.85 <= r <= 1.15:
                bad.append(dens[-1])
        bad_map = [b for b in bad if " s" in b.split(" -> ")[0]]
        bad_den = [b for b in bad if b not in bad_map]
        v.check("loot", not bad_map and bool(parts), "vs %s: map loot %s%s" % (W9_TIP, "; ".join(parts), (" | OUT: " + "; ".join(bad_map)) if bad_map else ""), "+-10 % per map x seed")
        v.check("loot-density", not bad_den and bool(dens), "vs %s: home loot per m2 %s%s" % (W9_TIP, "; ".join(dens), (" | OUT: " + "; ".join(bad_den)) if bad_den else ""), "+-15 % per map")
    # determinism
    dt = d.get("determinism")
    if not dt:
        v.cnj("determinism", "no re-build")
    else:
        v.check("determinism", dt["a"] == dt["b"], "%s seed %d built twice: %s vs %s" % (dt["map"], dt["seed"], dt["a"], dt["b"]), "identical hashes")


def main_fn(v, args):
    root, label = L.node_root(args)
    if args.plant:
        root = planted_root(root, args.plant)
        label += " + plant " + args.plant
        v.note("plant %s: rows that must FAIL: %s" % (args.plant, ", ".join(sorted(PLANTS[args.plant][0]))))
    v.data["tree"] = label
    d = census(root, args.maps, args.seeds, True)
    base = None
    try:
        base = baseline(args.maps, args.seeds)
    except Exception as e:  # the baseline is the loot row's only input: a failure there is that row's could-not-judge, never a pass
        v.note("baseline census failed: %s" % str(e)[:300])
    judge(v, d, base)
    if args.plant:
        must = PLANTS[args.plant][0]
        for r in v.rows:
            if r["kind"] == "gate" and r["name"] not in must and r["ok"] is not None:
                r["kind"] = "info"          # under a plant only the designated rows count (exit 1 = the fault was caught)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, PLANTS.keys())
    ap.add_argument("--maps", default=MAPS)
    ap.add_argument("--seeds", default=SEEDS)
    args = L.parse(ap)
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
