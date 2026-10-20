#!/usr/bin/env python
"""placementcheck - does everything the player can SEE touch the ground, and does the ground they stand on match the ground they see?
(Last Circle world-foundation plan, section 4, lane 5D.)  NODE ONLY: no browser, no server, no file edited.

    python _harness/placementcheck.py --disk                      # the working copy (the integration run)
    python _harness/placementcheck.py --rev 7f6a9fb2              # a frozen commit (the must-fail proof on Wave 4)
    python _harness/placementcheck.py --disk --quick              # 1 seed per map
    python _harness/placementcheck.py --disk --plant y-only-recentre     # negative control (must exit 1)
    python _harness/placementcheck.py --disk --wave 5             # the Wave-5 gate: the Wave-6 rows below are information only
    python _harness/placementcheck.py --rev bd523284 --rows base-edges,doorway-clearance,roads-float,pads,ground-match   # only these rows count

It runs placement_census.mjs, which imports the UNMODIFIED runtime/3d/royale/maps.js (and loot.js) in Node through the resolve
hook in three_hooks.mjs ("three" and "three/addons/" the way index.html's importmap resolves them), builds isla_viva / ashgrid /
deepwood for seeds 1, 7, 1234, 31337, 2026 and measures, against the REAL rendered terrain triangles (the near-ring chunks the
map's own LOD updater builds):

  anchor-offset       every instanced prop: the drawn base (or footprint) centre is <= 0.5 m from its colliders (0 = on them)  (Wave 4: rocks p50 33 m, max 92 m)
  rocks-floating      rocks whose LOWEST vertex is still > 0.2 m above the rendered ground < 5 %      (Wave 4: ~46 %)
  rocks-buried        rocks with EVERY vertex under the ground < 2 %                                   (Wave 4: ~25 %)
  props-float         non-rock props: base vertex > 0.10 m above the ground <= 2 % per kind;
  props-sunk          base vertex > 1.0 m below the ground <= 2 % per kind (embed 0.10-0.15 m + the slope across the base; plan leaves embedMax open)
  props-float-worst   no non-rock prop base vertex > 0.25 m above the ground (one lifted tree trips it)
                      (an UPPER container of a stack rests on the drawn top of the LOWER one - maps.js marks it `onTop` - so for
                      containers a lower container's top counts as support: a vertex whose x,z is inside another container's
                      footprint, with that container's top at or below the vertex + 0.10 m, is measured against that top)
  stack-contact       every container that rests on another sits within 0.10 m of the lower one's top (an upper that really floats
                      still fails: a stack-float plant lifts one by 0.30 m)
  ground-match        |map.heightAt - rendered near-ring surface| p99 <= 0.05 m on ~20k dry-land samples per seed (Wave 4: 0.28 m)
  collider-top        collider top within 0.3 m of the drawn top for >= 95 % of the instances of every kind
  structure-contact   no connected structure piece with no contact (roof 0.20 m over a house, ranger roof 0.97 m, bench legs ...)
  ramp-slope          every ramp's plank climbs at 45 degrees at most                                 (Wave 4: 17 / 39 / 35 ramps over, up to 60 deg)
  chest-base          chests on terrain: base gap p50 <= 0.05 m (Wave 4: 0.20 m)       [loot.js populate() run for real]
  chest-base-worst    no chest on terrain hovers more than 0.10 m (the median misses one in ~190)  (Wave 4: up to 5.6 m)
  floor-rings         floor-item ring hover p50 <= 0.12 m over the rendered ground     [no regression]
Wave-6 rows (lane 6E; gating since the default is --wave 6, information with --wave 5):
  base-edges          grounded structure base edges <= 0.10 m over the rendered ground: <= 1 % of any plan generator over it   (Wave 5: house 85-93 %, hut 76-90 %, tower 98-100 %)
  doorway-clearance   every doorway >= 2.0 m under its lintel                                                              (Wave 5: min 1.16 m, 8 under 2.0)
  ramp-start-step     every ramp starts within 0.55 m of the floor                                                        (Wave 4: 42 over; Wave 5 release: 0, kept as a guard)
  roads-float         road ribbon > 0.10 m over the ground <= 1 % of the samples                                          (Wave 5: 2.3 / 16.3 / 6.6 %)
  ground-match        |heightAt - rendered near ring| p99 <= 1e-4 m (Wave 5 bar: 0.05 m)                                  (Wave 5: 0.012 / 0.037 / 0.023 m)
  pads                the ground under every pad rect (M.ground.padLog) and under every pad-generator footprint is flat within 0.02 m (physics AND drawn)   (Wave 5: slopes of 0.1-3 m)

Exit 0 pass / 1 fail / 2 could-not-judge (the census crashed, a prop kind is missing, loot.js would not run, Node is missing).
--plant NAME mutates the BUILT map in memory (never a file) and the gate must FAIL on the designated row:
  y-only-recentre -> anchor-offset + rocks-floating     perimeter-drop -> ground-match     tree-float -> props-float-worst
  stack-float -> stack-contact + props-float-worst
  Wave 6: no-pads -> base-edges + pads (the drawn ground is 0.35 m lower on half of every footprint)   door-buried -> doorway-clearance
          ramp-lip -> ramp-start-step   roads-lifted -> roads-float   ground-shift -> ground-match (3 mm)
In plant mode only the designated rows count: exit 1 = the fault was detected, exit 0 = the gate is blind to it.
--rows a,b,c does the same for a named set of rows without planting anything (a frozen revision must FAIL them).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "placementcheck"
CENSUS = os.path.join(C.HERE, "placement_census.mjs")
SEEDS = "1,7,1234,31337,2026"
EXPECTED_KINDS = {"isla_viva": ["palm", "tree", "bush", "rocks", "car", "barrel"],
                  "ashgrid": ["tree", "bush", "rocks", "car", "container", "barrel"],
                  "deepwood": ["birch", "pine", "bush", "rocks", "car"]}
# Wave 7b (lane B2): a kind the world may legitimately NOT place. Isla Viva's old barrels came from Palm Bay's "depot" town() signature; the resort towns of Wave 7b are towngen layouts and carry none.
# A kind listed here is still judged by every row when >= 5 are present; only its absence is not a could-not-judge (printed as information).
OPTIONAL_KINDS = {"isla_viva": ("barrel",)}
# thresholds: plan section 4, re-measured on 7f6a9fb2 (see REPORT.md of lane 5D and the README rows)
OFFSET_MAX = 0.5
ROCK_HOVER_MAX = 0.05
ROCK_BURIED_MAX = 0.02
FLOAT_SHARE_MAX = 0.02
SUNK_SHARE_MAX = 0.02
FLOAT_WORST = 0.25
GROUND_P99 = 0.05           # the Wave-5 bar (--wave 5)
GROUND_P99_W6 = 1e-4        # the Wave-6 bar: physics ground == drawn ground (the plan: <= 1e-4 m after Wave 6)
EDGE_SHARE_MAX = 0.01       # base-edges: share of a plan generator's grounded structures with an edge > 0.10 m over the ground (Wave 5 allowed 5 %; tightened with 6A at 0 %)
PAD_FLAT = 0.02             # a pad is flat when the ground under it varies by <= 0.02 m
PADS_GATING = True          # lane 6E decision on 6A's final numbers (see REPORT / README): False leaves the pads row information
EDGE_GENS = ("house", "hut", "tower", "rangerTower", "waterTower", "steeple", "lighthouse", "farmland")
# Wave 7b (lane B2): base-edges judges EVERY generator with >= 5 grounded structures (the Wave-6 plan list above plus the ones the themed towns add: buildCrater, ruinHouse, dock and bridge builders ...),
# except the cosmetic ones named here (a fence board follows the ground at its two ends and floats up to 0.99 m in between by design). A list of names would have let lane B1's crater village (33 % of 60
# structures up to 1.29 m over the ground) pass unjudged: it was an INFORMATION line.
EDGE_EXEMPT = ("addFenceBoard", "?")


def edge_judged(gen):
    return gen in EDGE_GENS or gen not in EDGE_EXEMPT
COLTOP_MISS_MAX = 0.05
CHEST_GAP_P50 = 0.05
CHEST_GAP_MAX = 0.10
RING_P50 = 0.12
FLOAT_TOL = 0.10          # the "resting on" tolerance (also the census FLOAT): a stacked upper may hover this much over its lower's top
PLANT_ROWS = {"y-only-recentre": {"anchor-offset", "rocks-floating"}, "perimeter-drop": {"ground-match"}, "tree-float": {"props-float-worst"},
              "stack-float": {"stack-contact", "props-float-worst"},
              # Wave 6 (lane 6E)
              "no-pads": {"base-edges", "pads"}, "door-buried": {"doorway-clearance"}, "ramp-lip": {"ramp-start-step"}, "roads-lifted": {"roads-float"},
              "ground-shift": {"ground-match"}}
WAVE6_ROWS = ("base-edges", "doorway-clearance", "ramp-start-step", "roads-float", "ground-match", "pads")


def rev_root(rev):
    """Extract runtime/ + assets/props of games/last-circle at a git rev into a temp dir (cached by commit sha)."""
    sha = subprocess.run(["git", "-C", C.REPO, "rev-parse", rev], capture_output=True, text=True).stdout.strip()
    if not sha:
        raise C.HarnessError("unknown git revision %r" % rev)
    dst = os.path.join(tempfile.gettempdir(), "lc_gate_rev", sha)
    mark = os.path.join(dst, ".complete")
    if not os.path.exists(mark):
        os.makedirs(dst, exist_ok=True)
        p = subprocess.run(["git", "-C", C.REPO, "archive", sha, "games/last-circle/runtime", "games/last-circle/assets/props"],
                           capture_output=True)
        if p.returncode != 0:
            raise C.HarnessError("git archive %s failed: %s" % (rev, p.stderr.decode("utf-8", "replace")[:300]))
        with tarfile.open(fileobj=io.BytesIO(p.stdout)) as tf:
            for m in tf.getmembers():
                if not m.isfile():
                    continue
                rel = m.name[len("games/last-circle/"):] if m.name.startswith("games/last-circle/") else m.name
                out = os.path.join(dst, rel.replace("/", os.sep))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "wb") as fh:
                    fh.write(tf.extractfile(m).read())
        open(mark, "w").write(sha)
    return dst, sha[:8]


def run_census(root, vendor, maps, seeds, plants, timeout):
    out = os.path.join(tempfile.gettempdir(), "lc_gate_census_%d_%s.json" % (os.getpid(), time.strftime("%H%M%S")))
    cmd = ["node", CENSUS, "--root", root, "--vendor", vendor, "--maps", ",".join(maps), "--seeds", seeds, "--out", out]
    if plants:
        cmd += ["--plant", ",".join(plants)]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("placement_census.mjs still running after %d s" % timeout)
    if p.returncode != 0 or not os.path.exists(out):
        raise C.EnvFailure("placement_census.mjs exit %s: %s" % (p.returncode, " | ".join((p.stderr or p.stdout or "").strip().splitlines()[-4:])[:600]))
    with open(out, encoding="utf-8") as fh:
        doc = json.load(fh)
    try:
        os.remove(out)
    except OSError:
        pass
    doc["stderr"] = (p.stderr or "").strip().splitlines()[-30:]
    return doc


def f(v, nd=3):
    return "-" if v is None else ("%.*f" % (nd, v))


def judge(v, doc, args, plant_rows):
    S = doc["summary"]
    wave6 = args.wave >= 6

    def chk(name, ok, detail, expect=None, wave6_row=False):
        if plant_rows is not None:                          # negative control / --rows: only the designated rows decide
            if name in plant_rows:
                return v.check(name, ok, detail, expect)
            v.info(name + " (not counted in plant mode)", detail)
            return ok
        if wave6_row and not wave6:
            v.info(name + " (Wave-6 row, information with --wave 5)", detail)
            return ok
        if name == "pads" and not PADS_GATING:
            v.info(name + " (Wave-6 row, information: 6A's pads are not flat everywhere yet)", detail)
            return ok
        return v.check(name, ok, detail, expect)

    # 0. the census itself
    missing, optional_absent = [], []
    for m, kinds in EXPECTED_KINDS.items():
        if m not in S:
            continue
        for k in kinds:
            if k not in S[m]["props"] or S[m]["props"][k]["n"] < 5:
                (optional_absent if k in OPTIONAL_KINDS.get(m, ()) else missing).append("%s:%s" % (m, k))
    if optional_absent:
        v.info("census: optional prop kinds not placed in this world (Wave 7b)", ", ".join(optional_absent) + " (fewer than 5 instances: no row can judge them; judged when present)")
    if doc.get("lootNote"):
        v.cnj("census: loot.js", doc["lootNote"])
    for m in S:
        if S[m].get("lootError"):
            v.cnj("census: loot.js populate() on %s" % m, S[m]["lootError"])
    if missing:
        v.cnj("census: every expected prop kind built", "missing or < 5 instances: " + ", ".join(missing))
    nearC = [S[m]["field"]["near"]["n"] for m in S]
    if min(nearC or [0]) < 1000:
        v.cnj("census: rendered terrain sampled", "near-ring samples per map %s" % nearC)
    per_map = lambda fn: "; ".join("%s %s" % (m, fn(S[m])) for m in S)

    # 1. anchor offset (collider centre vs drawn base centre)
    worst = []
    bad = []
    for m in S:
        for k, p in S[m]["props"].items():
            if p["offsetMax"] is not None and p["offsetMax"] > OFFSET_MAX:
                bad.append("%s:%s p50 %s p90 %s max %s" % (m, k, f(p["offsetP50"], 1), f(p["offsetP90"], 1), f(p["offsetMax"], 1)))
            worst.append(p["offsetMax"] or 0)
    for m in S:
        v.info("anchor-offset centre-to-centre %s" % m, "; ".join("%s p50 %s max %s" % (k, f(p["centreP50"], 2), f(p["centreMax"], 2)) for k, p in S[m]["props"].items()))
    chk("anchor-offset", not bad, ("<= %.2f m for every instance (worst %.2f m)" % (OFFSET_MAX, max(worst or [0]))) if not bad else
        "drawn base more than %.2f m from its collider: %s" % (OFFSET_MAX, " | ".join(bad)), "max <= %.2f m" % OFFSET_MAX)

    # 2. rocks
    hov = [(m, S[m]["props"]["rocks"]) for m in S if "rocks" in S[m]["props"]]
    bad = ["%s %s%% (n %d)" % (m, f(100 * (p["hoverShare02"] or 0), 1), p["n"]) for m, p in hov if (p["hoverShare02"] or 0) >= ROCK_HOVER_MAX]
    chk("rocks-floating", not bad, ("lowest vertex > 0.2 m above the ground: " + "; ".join("%s %s%%" % (m, f(100 * (p["hoverShare02"] or 0), 1)) for m, p in hov)) if not bad else
        "rocks hovering > 0.2 m (wholly in the air %s): %s" % ("; ".join("%s %s%%" % (m, f(100 * (p["airShare"] or 0), 1)) for m, p in hov), " | ".join(bad)), "< %d %%" % (100 * ROCK_HOVER_MAX))
    bad = ["%s %s%%" % (m, f(100 * (p["buriedFullyShare"] or 0), 1)) for m, p in hov if (p["buriedFullyShare"] or 0) >= ROCK_BURIED_MAX]
    chk("rocks-buried", not bad, ("every vertex under the ground: " + "; ".join("%s %s%%" % (m, f(100 * (p["buriedFullyShare"] or 0), 1)) for m, p in hov)) if not bad else
        "rocks fully buried: " + " | ".join(bad), "< %d %%" % (100 * ROCK_BURIED_MAX))

    # 3. other props
    fl, sk = [], []
    for m in S:
        for k, p in S[m]["props"].items():
            if k == "rocks":
                continue
            if (p["floatShare"] or 0) > FLOAT_SHARE_MAX:
                fl.append("%s:%s %s%% (p90 %s, max %s)" % (m, k, f(100 * p["floatShare"], 1), f(p["floatP90"], 2), f(p["floatMaxMax"], 2)))
            if (p["sunkShare"] or 0) > SUNK_SHARE_MAX:
                sk.append("%s:%s %s%% (max %s)" % (m, k, f(100 * p["sunkShare"], 1), f(p["sunkMax"], 2)))
    chk("props-float", not fl, "base vertex > 0.10 m above the ground, share per kind <= 2 %" if not fl else " | ".join(fl), "<= 2 % per kind")
    chk("props-sunk", not sk, "base vertex > 1.0 m under the ground, share per kind <= 2 %" if not sk else " | ".join(sk), "<= 2 % per kind")
    over = ["%s:%s %s m" % (m, k, f(p["floatMaxMax"], 2)) for m in S for k, p in S[m]["props"].items() if k != "rocks" and (p["floatMaxMax"] or 0) > FLOAT_WORST]
    chk("props-float-worst", not over, "no non-rock prop floats > %.2f m" % FLOAT_WORST if not over else "worst float per kind above %.2f m: %s" % (FLOAT_WORST, " | ".join(over)), "none > %.2f m" % FLOAT_WORST)
    # 3b. stacks: an upper container rests on the drawn top of the LOWER one (maps.js marks it `onTop`), so props-float above counts a
    # lower container's top as support (a vertex of an instance whose footprint holds it, top at or below the vertex + 0.10 m). That
    # forgiveness must not hide an upper that really floats: this row judges ONLY the supported ones, with the 0.10 m bar itself.
    stk = [(m, k, p) for m in S for k, p in S[m]["props"].items() if (p.get("stackedN") or 0) > 0]
    for m, k, p in stk:
        v.info("stacked %s %s" % (k, m), "%d resting on a lower one, float vs the lower's top max %s m, share > 0.10 m %s %%" % (p["stackedN"], f(p["stackedFloatMax"], 3), f(100 * (p["stackedFloatShare"] or 0), 1)))
    badstk = ["%s:%s %s m (%s %% over, n %d)" % (m, k, f(p["stackedFloatMax"], 2), f(100 * (p["stackedFloatShare"] or 0), 1), p["stackedN"]) for m, k, p in stk if (p["stackedFloatMax"] or 0) > FLOAT_TOL]
    has_ct = [m for m in S if "container" in S[m]["props"]]
    no_stack = [m for m in has_ct if not any(mm == m for mm, _k, _p in stk)]
    if not has_ct:
        v.info("stack-contact (no container is built on these maps)", "nothing to judge")
    elif no_stack:
        chk("stack-contact", None, "no container rests on another in %s - the stack rule measured nothing (the yard no longer stacks, or the footprint test lost them)" % ", ".join(no_stack))
    else:
        chk("stack-contact", not badstk, ("%d stacked uppers rest on their lower container within %.2f m (worst %s m)" % (sum(p["stackedN"] for _m, _k, p in stk), FLOAT_TOL, f(max([p["stackedFloatMax"] or 0 for _m, _k, p in stk] or [0]), 3))) if not badstk else
            "an upper container floats above the lower one: " + " | ".join(badstk), "every stacked upper within %.2f m of its lower's top" % FLOAT_TOL)

    # 3c. ramps (C-RAMP authoring, lane 5A): the plank climbs at 45 degrees at most (a 60 degree ranger-tower ramp could not be climbed)
    rs = {m: S[m].get("rampSlope") for m in S if S[m].get("rampSlope")}
    nr = sum(r["n"] for r in rs.values())
    if nr == 0:
        chk("ramp-slope", None, "no ramp on the maps")
    else:
        over = sum(r["gt45"] for r in rs.values())
        chk("ramp-slope", over == 0, ("every ramp climbs at <= 45 degrees: " + "; ".join("%s %d ramps, steepest %s deg" % (m, r["n"], f(r["max"], 1)) for m, r in rs.items())) if not over else
            "%d of %d ramps climb steeper than 45 degrees: %s" % (over, nr, "; ".join("%s %d of %d (steepest %s deg)" % (m, r["gt45"], r["n"], f(r["max"], 1)) for m, r in rs.items() if r["gt45"])), "0 ramps over 45 degrees")

    # 4. the ground the player stands on vs the ground they see (Wave 5: p99 <= 0.05 m; Wave 6: the physics ground IS the drawn ground, <= 1e-4 m)
    gbar = GROUND_P99_W6 if wave6 else GROUND_P99
    gfmt = (lambda x: "%.2e" % x) if wave6 else (lambda x: f(x, 4))
    bad = ["%s p99 %s m (max %s, %s%% > 0.10, %s%% > 1e-4)" % (m, gfmt(S[m]["field"]["near"]["absP99"]), gfmt(S[m]["field"]["near"]["absMax"]), f(100 * (S[m]["field"]["near"]["shareAbsGt10"] or 0), 1), f(100 * (S[m]["field"]["near"].get("shareAbsGt1e4") or 0), 2)) for m in S if (S[m]["field"]["near"]["absP99"] or 0) > gbar]
    chk("ground-match", not bad, ("|heightAt - rendered near ring| p99 " + per_map(lambda s: gfmt(s["field"]["near"]["absP99"])) + "; max " + per_map(lambda s: gfmt(s["field"]["near"]["absMax"]))) if not bad else " | ".join(bad),
        "p99 <= %s m" % ("1e-4" if wave6 else "0.05"))
    for m in S:
        fa = S[m]["field"]["far"]
        v.info("far-chunk ground error %s" % m, "p99 %s m, max %s m, %s%% > 0.10 (n %d)" % (f(fa["absP99"]), f(fa["absMax"]), f(100 * (fa["shareAbsGt10"] or 0), 1), fa["n"]))

    # 5. collider top vs drawn top
    bad = []
    seen = 0
    for m in S:
        for k, p in S[m]["props"].items():
            if not p["colTopN"]:
                continue
            seen += 1
            if (p["colTopMissShare"] or 0) > COLTOP_MISS_MAX:
                bad.append("%s:%s %s%% off by > 0.3 m (p50 %s, max %s)" % (m, k, f(100 * p["colTopMissShare"], 0), f(p["colTopDiffP50"], 2), f(p["colTopDiffMax"], 2)))
    chk("collider-top", not bad and seen > 0, "collider top within 0.3 m of the drawn top (%d kinds)" % seen if not bad else " | ".join(bad), "<= 5 % per kind")
    nocol = ["%s:%s" % (m, k) for m in S for k, p in S[m]["props"].items() if p["noCollider"] and not p["colTopN"]]
    if nocol:
        v.info("props without a collider", ", ".join(nocol))

    # 6. structure contact
    fl = []
    for m in S:
        for e in S[m]["floating"]:
            if (e["hoverMax"] or 0) > 0.05:
                fl.append("%s %s x%d hover p50 %s max %s over %s (e.g. seed %s at %s,%s)" % (m, e["gen"], e["n"], f(e["hoverP50"], 2), f(e["hoverMax"], 2), e["over"], e["e"][0], f(e["e"][1], 0), f(e["e"][2], 0)))
    chk("structure-contact", not fl, "every connected structure piece touches the ground or another piece" if not fl else "%d groups: %s" % (len(fl), " | ".join(fl)), "0 pieces without contact")

    # 7. loot
    bad = []
    for m in S:
        c = S[m]["chests"]
        if c["terrainN"] and (c["gapP50"] or 0) > CHEST_GAP_P50:
            bad.append("%s p50 %s m (p90 %s, n %d)" % (m, f(c["gapP50"]), f(c["gapP90"]), c["terrainN"]))
    chk("chest-base", not bad and any(S[m]["chests"]["terrainN"] for m in S), "chest base gap p50 " + per_map(lambda s: f(s["chests"]["gapP50"])) if not bad else " | ".join(bad), "p50 <= %.2f m" % CHEST_GAP_P50)
    # the median hides one hovering chest in 190: every chest on terrain must rest on it (the worst is a visible defect: deepwood seed 1 hovers 0.70 m)
    bad = ["%s worst %s m" % (m, f(S[m]["chests"]["gapMax"])) for m in S if (S[m]["chests"]["gapMax"] or 0) > CHEST_GAP_MAX]
    chk("chest-base-worst", not bad and any(S[m]["chests"]["terrainN"] for m in S), "no chest on terrain hovers more than %.2f m: worst %s" % (CHEST_GAP_MAX, per_map(lambda s: f(s["chests"]["gapMax"]))) if not bad else
        "a chest hovers over the ground (terrain chests per map: %s): %s" % (per_map(lambda s: str(s["chests"]["terrainN"])), " | ".join(bad)), "every chest <= 0.10 m")
    for m in S:
        c = S[m]["chests"]
        v.info("chests on structures %s" % m, "n %d, gap to floor p50 %s min %s max %s (a chest sunk into a floor reads negative)" % (c["boxN"], f(c["boxGapP50"]), f(c["boxGapMin"]), f(c["boxGapMax"])))
    bad = ["%s p50 %s m (p99 %s)" % (m, f(S[m]["rings"]["centreP50"]), f(S[m]["rings"]["centreP99"])) for m in S if (S[m]["rings"]["centreP50"] or 0) > RING_P50]
    chk("floor-rings", not bad and any(S[m]["rings"]["terrainN"] for m in S), "floor-item ring hover p50 " + per_map(lambda s: f(s["rings"]["centreP50"])) if not bad else " | ".join(bad), "p50 <= %.2f m" % RING_P50)
    for m in S:
        r = S[m]["rings"]
        v.info("floor rings %s" % m, "n %d on ground %d: centre hover p50 %s p99 %s, rim worst p99 %s max %s, lowest rim %s" % (r["n"], r["terrainN"], f(r["centreP50"]), f(r["centreP99"]), f(r["maxP99"]), f(r["maxMax"]), f(r["minMin"])))

    # Wave-6 rows
    bad = []
    for m in S:
        for e in S[m]["grounded"]:
            if edge_judged(e["gen"]) and e["n"] >= 5 and (e["edgeGt10Share"] or 0) > EDGE_SHARE_MAX:
                bad.append("%s %s %s%% of %d (p50 %s, max %s)" % (m, e["gen"], f(100 * e["edgeGt10Share"], 0), e["n"], f(e["edgeP50"], 2), f(e["edgeMax"], 2)))
    judged = sum(e["n"] for m in S for e in S[m]["grounded"] if edge_judged(e["gen"]) and e["n"] >= 5)
    judged_gens = sorted({e["gen"] for m in S for e in S[m]["grounded"] if edge_judged(e["gen"]) and e["n"] >= 5})
    chk("base-edges", not bad and judged > 0, ("grounded structure base edges <= 0.10 m over the ground (%d structures of %d generators: %s)" % (judged, len(judged_gens), "/".join(judged_gens[:10]) + ("..." if len(judged_gens) > 10 else ""))) if not bad else " | ".join(bad), "<= %d %% per generator" % (100 * EDGE_SHARE_MAX), wave6_row=True)
    oth = []
    for m in S:
        for e in S[m]["grounded"]:
            if not (edge_judged(e["gen"]) and e["n"] >= 5) and e["n"] >= 1 and (e["edgeGt10Share"] or 0) > 0:
                oth.append("%s %s %s%% of %d (max %s%s)" % (m, e["gen"], f(100 * e["edgeGt10Share"], 1), e["n"], f(e["edgeMax"], 2), (" e.g. seed %s at %s,%s" % (e["worst"][0]["seed"], f(e["worst"][0]["x"], 0), f(e["worst"][0]["z"], 0))) if e.get("worst") else ""))
    if oth:
        v.info("base-edges, other generators (not judged: exempt, or fewer than 5)", " | ".join(oth))
    d = ["%s min %s (%d < 1.85 capsule, %d < 2.0)" % (m, f(S[m]["doors"]["minClear"], 2), S[m]["doors"]["ltCapsule"], S[m]["doors"]["lt20"]) for m in S if S[m]["doors"]["lt20"]]
    chk("doorway-clearance", not d, "every doorway >= 2.0 m: min " + per_map(lambda s: "%s over %d doorways" % (f(s["doors"]["minClear"], 2), s["doors"]["n"])) if not d else " | ".join(d), ">= 2.0 m", wave6_row=True)
    d = ["%s %d of %d starts > 0.55 m (max %s)" % (m, S[m]["ramps"]["stepGt055"], S[m]["ramps"]["n"], f(S[m]["ramps"]["stepMax"], 2)) for m in S if S[m]["ramps"]["stepGt055"]]
    chk("ramp-start-step", not d, "every ramp starts within 0.55 m of the floor" if not d else " | ".join(d), "0 over 0.55 m", wave6_row=True)
    d = ["%s %s%%" % (m, f(100 * (S[m]["roads"]["floatShare"] or 0), 1)) for m in S if (S[m]["roads"]["floatShare"] or 0) > 0.01]
    chk("roads-float", not d, ("road ribbon float > 0.10 m <= 1 %%: %s" % per_map(lambda s: f(100 * (s["roads"]["floatShare"] or 0), 2) + " %")) if not d else " | ".join(d), "<= 1 %", wave6_row=True)
    v.info("roads below the surface", per_map(lambda s: "%s %% of %d samples under the rendered ground" % (f(100 * (s["roads"]["pokeShare"] or 0), 2), s["roads"]["n"])))
    # pads: the ground under every pad rect the map reports, and under every pad-generator footprint, is one level
    P = {m: S[m]["pads"] for m in S}
    nstruct = sum(p["n"] for p in P.values())
    bad = []
    for m, p in P.items():
        if p["over02Phys"] or p["over02Draw"]:
            bad.append("%s footprints %s%% of %d flat only within %s m (drawn) / %s m (physics): %s" % (m, f(100 * max(p["over02Phys"] or 0, p["over02Draw"] or 0), 1), p["n"], f(p["maxDraw"], 3), f(p["maxPhys"], 3),
                       ", ".join("%s %s%% (max %s)" % (g["gen"], f(100 * (g["over02Draw"] or 0), 0), f(g["maxDraw"], 3)) for g in p["byGen"] if g["over02Draw"])))
        if p["api"] and (p["rectsOver02Phys"] or p["rectsOver02Draw"]):
            bad.append("%s pad rects %s%% of %d not flat (max %s m physics, %s m drawn; by generator %s; worst %s)" % (m, f(100 * max(p["rectsOver02Phys"] or 0, p["rectsOver02Draw"] or 0), 1), p["rects"], f(p["rectsMaxPhys"], 3), f(p["rectsMaxDraw"], 3),
                       ", ".join("%s %d of %d" % (g["gen"], g["over"], g["n"]) for g in p.get("rectsByGen", [])), "; ".join("seed %s %s at %s,%s %s m" % (w["seed"], w["gen"], f(w["x"], 0), f(w["z"], 0), f(w["flatPhys"], 3)) for w in p.get("rectsWorst", [])[:2])))
    api = [m for m, p in P.items() if p["api"]]
    for m, p in P.items():
        v.info("pads %s" % m, "%d footprints: max range %s m drawn / %s m physics, p90 %s m; %s" % (p["n"], f(p["maxDraw"], 3), f(p["maxPhys"], 3), f(p["p90Draw"], 3),
               ("%d pad rects (M.ground.padLog): max range %s m physics / %s m drawn, level error max %s m" % (p["rects"], f(p["rectsMaxPhys"], 3), f(p["rectsMaxDraw"], 3), f(p["rectsOffLevelMax"], 3))) if p["api"] else "no M.ground.padLog on this build"))
    chk("pads", not bad and nstruct > 0, ("%d structure footprints%s flat within %.2f m" % (nstruct, (" and %d pad rects" % sum(p["rects"] for p in P.values())) if api else "", PAD_FLAT)) if not bad else " | ".join(bad), "every pad flat within %.2f m" % PAD_FLAT, wave6_row=True)
    return S


def main_fn(v, args):
    t0 = time.time()
    plants = [p for p in (args.plant or "").split(",") if p]
    for p in plants:
        if p not in PLANT_ROWS:
            raise C.HarnessError("unknown --plant %r (known: %s)" % (p, ", ".join(sorted(PLANT_ROWS))))
    root, label = C.ROOT, "working copy"
    if args.rev:
        root, sha = rev_root(args.rev)
        label = "git %s" % sha
    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    seeds = args.seeds or SEEDS
    if args.quick:
        seeds = "7"
    maps = [m for m in (args.maps or ",".join(C.MAPS)).split(",") if m]
    print("%s: census of %s on %s, seeds %s, plants %s" % (GATE, label, ",".join(maps), seeds, plants or "none"), flush=True)
    doc = run_census(root, vendor, maps, seeds, plants, args.census_timeout)
    for ln in doc.get("stderr", [])[-len(maps) * len(seeds.split(",")):]:
        print("  " + ln, flush=True)
    v.data["root"] = label
    v.data["seeds"] = seeds
    v.data["plants"] = plants
    # a planted fault that could not be applied (the census records `<plant>:NO-...`) must never read as a blind gate: could-not-judge
    unapplied = sorted({x for m in doc["summary"].values() for x in (m.get("planted") or []) if ":NO-" in x})
    if unapplied:
        v.cnj("planted fault applied", "the plant did not apply to the built map: %s" % ", ".join(unapplied))
    v.data["census_wall_s"] = doc.get("wallS")
    plant_rows = None
    if plants:
        plant_rows = set()
        for p in plants:
            plant_rows |= PLANT_ROWS[p]
        print("%s: PLANT MODE %s - only %s count; exit 1 = the planted fault was detected" % (GATE, plants, sorted(plant_rows)), flush=True)
    elif args.rows:
        plant_rows = set(x for x in args.rows.split(",") if x)
        print("%s: ROWS %s - only these count (a frozen revision is expected to FAIL them)" % (GATE, sorted(plant_rows)), flush=True)
    S = judge(v, doc, args, plant_rows)
    v.data["summary"] = S
    v.data["wave"] = args.wave
    v.info("census wall", "%.0f s (Node, no browser)" % (time.time() - t0))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=None, help="comma list (default: all three)")
    ap.add_argument("--seeds", default=None, help="comma list (default %s)" % SEEDS)
    ap.add_argument("--quick", action="store_true", help="seed 7 only")
    ap.add_argument("--wave", type=int, default=6, help="6 (default) gates the Wave-6 rows (base edges, doorways, ramp starts, roads, ground match 1e-4, pads); 5 leaves them information and keeps the 0.05 m ground bar")
    ap.add_argument("--rows", default=None, help="comma list: ONLY these rows count (the others are information): the must-fail proof on a frozen revision")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--census-timeout", type=int, default=1800)
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
