#!/usr/bin/env python
"""worldcheck - is the world every client builds the SAME world, and is the baked collider table the one the GLBs and maps.js produce?
(Last Circle world-foundation plan, Wave 5; promoted by lane F1 from lane 5A's scratch probes census/lootdiff.mjs, census/failpaths.mjs and
`_tools/bake_prop_colliders.mjs --check`.)  NODE ONLY: no browser, no server, no file edited.

    python _harness/worldcheck.py --disk                       # the working copy (the integration run)
    python _harness/worldcheck.py --rev 7f6a9fb2               # a frozen commit: the must-fail proof on Wave 4 (the registered negative control)
    python _harness/worldcheck.py --disk --plant stale-table   # negative controls (each must exit 1)
    python _harness/worldcheck.py --disk --plant rng-shift
    python _harness/worldcheck.py --disk --baseline-rev <rev>  # compare the RNG stream with another revision (Wave 6 re-baselines on purpose)

It imports the UNMODIFIED runtime/3d/royale/maps.js in Node (world_env.mjs, the same environment as placement_census.mjs) and asserts:

  table-current        `node _tools/bake_prop_colliders.mjs --check`: assets/props/prop_colliders.json is what the GLBs + the tool's config
                       produce, and maps.js's baseH table agrees (a stale table = colliders that no longer match what is drawn)
  builds-deterministic two builds of one (map, seed) in one process give the identical collider list (3 builds: isla_viva 7, ashgrid 7, deepwood 1234)
  glb-fail-same        every prop GLB failing to load gives the IDENTICAL collider list (a squad client whose CDN request died must derive the
                       same cover as its squad-mates; Wave 4 built NO colliders for a kind whose GLB failed: 624 vs 847, 829 vs 1744, 532 vs 1518)
  table-404-builds     the baked table failing to fetch still builds the map (legacy colliders, one console.warn)         [information: how
                       many colliders such a client then differs by - a squad-disagreement residual until the Wave-7 guard]
  rng-stream           against the baseline revision (default = the Wave-4 commit, 7f6a9fb2), in 15 builds (3 maps x seeds 1, 7, 1234, 31337,
                       2026): the POIs are identical, the wild loot (the LAST consumer of the shared RNG in buildMap) is identical, and every
                       prop kind's anchors (x, z) except containers' (stack uppers are laid out by the stack, by design) are an ordered
                       subsequence of the baseline's (draw-then-reject: a slope-rejected prop disappears, nothing else moves). A Wave-5
                       row: Wave 6 builds towns on purpose and passes `--baseline-rev` with the revision it started from

--plant stale-table  runs the table check on a scratch copy whose table was edited (container height + 0.5 m)         -> table-current FAILs
--plant rng-shift    runs the working-copy fingerprint on a scratch copy of maps.js with ONE extra rng() draw after the generator is
                     created                                                                                        -> rng-stream FAILs
In plant mode only the designated row counts: exit 1 = the fault was detected, exit 0 = the gate is blind to it.

Exit 0 pass / 1 fail / 2 could-not-judge (node missing, the census crashed, a row measured nothing).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import placementcheck as PC  # noqa: E402

GATE = "worldcheck"
NODE_PROBE = os.path.join(C.HERE, "world_node.mjs")
WAVE4_REV = "7f6a9fb2"
SEEDS = "1,7,1234,31337,2026"
PLANT_ROWS = {"stale-table": {"table-current"}, "rng-shift": {"rng-stream"}}
RNG_ANCHOR = "const rng = W.SIM.mulberry32(seed ^ 0xabcdef);"


def run_node(args_list, timeout=900):
    run_node.n = getattr(run_node, "n", 0) + 1
    out = os.path.join(tempfile.gettempdir(), "lc_world_node_%d_%d.json" % (os.getpid(), run_node.n))
    cmd = ["node", NODE_PROBE] + args_list + ["--out", out]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("world_node.mjs still running after %d s" % timeout)
    if p.returncode != 0 or not os.path.exists(out):
        raise C.EnvFailure("world_node.mjs exit %s: %s" % (p.returncode, " | ".join((p.stderr or p.stdout or "").strip().splitlines()[-4:])[:600]))
    with open(out, encoding="utf-8") as fh:
        doc = json.load(fh)
    try:
        os.remove(out)
    except OSError:
        pass
    doc["stderr"] = (p.stderr or "").strip().splitlines()[-20:]
    return doc


def vendor_dir():
    v = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(v):
        raise C.EnvFailure("vendored three not found at %s" % v)
    return v


def bake_check(root):
    """(exit code | None, text): `node <root>/_tools/bake_prop_colliders.mjs --check`; None when that root has no such tool."""
    tool = os.path.join(root, "_tools", "bake_prop_colliders.mjs")
    if not os.path.isfile(tool):
        return None, "no _tools/bake_prop_colliders.mjs in %s (a revision from before the baked collider table)" % root
    p = subprocess.run(["node", tool, "--check"], capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=root, timeout=300)
    return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()[:400]


def mini_root(with_runtime):
    """A scratch copy of the parts of the game the probes read (never the working copy itself): props + table (+ the tool, + runtime/)."""
    dst = tempfile.mkdtemp(prefix="lc_world_plant_")
    os.makedirs(os.path.join(dst, "assets", "props"))
    for f in os.listdir(os.path.join(C.ROOT, "assets", "props")):
        p = os.path.join(C.ROOT, "assets", "props", f)
        if os.path.isfile(p):
            shutil.copy2(p, os.path.join(dst, "assets", "props", f))
    os.makedirs(os.path.join(dst, "_tools"))
    shutil.copy2(os.path.join(C.ROOT, "_tools", "bake_prop_colliders.mjs"), os.path.join(dst, "_tools", "bake_prop_colliders.mjs"))
    if with_runtime:
        shutil.copytree(os.path.join(C.ROOT, "runtime"), os.path.join(dst, "runtime"))
    else:
        os.makedirs(os.path.join(dst, "runtime", "3d", "royale"))
        shutil.copy2(os.path.join(C.ROOT, "runtime", "3d", "royale", "maps.js"), os.path.join(dst, "runtime", "3d", "royale", "maps.js"))
    return dst


def judge_rng(v, now, base, baseline_label, chk):
    nb = {(b["map"], b["seed"]): b for b in now["builds"]}
    bb = {(b["map"], b["seed"]): b for b in base["builds"]}
    keys = sorted(set(nb) & set(bb))
    if not keys:
        return chk("rng-stream", None, "no (map, seed) in common between the two fingerprints")
    poi_bad, wild_bad, prop_bad, rejected, kinds_checked = [], [], [], 0, 0
    unchecked = set()
    for k in keys:
        a, b = nb[k], bb[k]
        if a["pois"] != b["pois"]:
            poi_bad.append("%s s%d" % k)
        if a["wild"] != b["wild"]:
            wild_bad.append("%s s%d (%d vs %d wild loot points)" % (k[0], k[1], len(a["wild"]), len(b["wild"])))
        for kind, now_list in a["props"].items():
            if kind == "container" or not now_list:
                continue
            # the baseline's anchors: its own instance list when it has one, else the centres of its legacy colliders (Wave 4 centres a prop's
            # collider on the seeded spot); a kind the baseline never collided (bushes) has no anchors to compare
            before = [(x, z) for x, z, _s, _ry in b["props"].get(kind, [])] or [(x, z) for x, z in (b.get("colAnchors") or {}).get(kind, [])]
            if not before:
                unchecked.add(kind)
                continue
            kinds_checked += 1
            it = iter(before)
            if not all(any(q == (x, z) for q in it) for x, z, _s, _ry in now_list):
                prop_bad.append("%s s%d %s" % (k[0], k[1], kind))
            rejected += max(0, len(before) - len(now_list))
    det = "%d builds vs %s: POIs identical in %d, wild loot identical in %d, prop anchors an ordered subsequence of the baseline's in %d of %d (build, kind) pairs (%d props rejected by slope since; no baseline anchors for: %s)" % (
        len(keys), baseline_label, len(keys) - len(poi_bad), len(keys) - len(wild_bad), kinds_checked - len(prop_bad), kinds_checked, rejected, ", ".join(sorted(unchecked)) or "none")
    bad = []
    if poi_bad:
        bad.append("POIs differ: " + ", ".join(poi_bad[:5]))
    if wild_bad:
        bad.append("wild loot differs: " + ", ".join(wild_bad[:5]))
    if prop_bad:
        bad.append("prop anchors moved: " + ", ".join(prop_bad[:6]))
    return chk("rng-stream", not bad, det if not bad else det + " | " + " | ".join(bad), "identical POIs / wild loot / prop anchors")


def main_fn(v, args):
    plant = args.plant
    if plant and plant not in PLANT_ROWS:
        raise C.HarnessError("unknown --plant %r (known: %s)" % (plant, ", ".join(sorted(PLANT_ROWS))))
    plant_rows = PLANT_ROWS[plant] if plant else None

    def chk(name, ok, detail, expect=None):
        if plant_rows is not None:
            if name in plant_rows:
                return v.check(name, ok, detail, expect)
            v.info(name + " (not counted in plant mode)", detail)
            return ok
        return v.check(name, ok, detail, expect)

    root, label = C.ROOT, "working copy"
    if args.rev:
        root, sha = PC.rev_root(args.rev)
        label = "git %s" % sha
    vendor = vendor_dir()
    v.data["root"] = label
    print("%s: %s%s" % (GATE, label, (" PLANT " + plant) if plant else ""), flush=True)
    tmp = []
    try:
        # ---- 1. the baked table
        if plant == "stale-table":
            mini = mini_root(False); tmp.append(mini)
            tf = os.path.join(mini, "assets", "props", "prop_colliders.json")
            with open(tf, encoding="utf-8") as fh:
                t = json.load(fh)
            t["kinds"]["container"]["height"] = round(t["kinds"]["container"]["height"] + 0.5, 4)
            with open(tf, "w", encoding="utf-8") as fh:
                json.dump(t, fh)
            code, text = bake_check(mini)
            print("%s: stale-table plant: --check exit %s: %s" % (GATE, code, text[:160]), flush=True)
        else:
            code, text = bake_check(root)
        if code is None:
            chk("table-current", None, text)
        else:
            chk("table-current", code == 0, text, "`bake_prop_colliders.mjs --check` exits 0")
        if plant == "stale-table":
            return

        # ---- 2-4. determinism and the fail paths
        if plant is None:
            det = run_node(["--mode", "determinism", "--root", root, "--vendor", vendor])
            for ln in det.get("stderr", []):
                print("  " + ln, flush=True)
            rows = det["rows"]
            v.data["determinism"] = rows
            chk("builds-deterministic", all(r["twice"] for r in rows), "two builds of one (map, seed) give identical colliders: %s" % ", ".join("%s s%d %s (%d colliders)" % (r["map"], r["seed"], "same" if r["twice"] else "DIFFERENT", r["colliders"]) for r in rows), "identical")
            bad = ["%s s%d: %d colliders with the GLBs vs %d with every GLB failing" % (r["map"], r["seed"], r["colliders"], r["glbFailColliders"]) for r in rows if not r["glbFailSame"]]
            chk("glb-fail-same", not bad, ("every prop GLB failing to load gives the identical collider list: %s" % ", ".join("%s s%d (%d)" % (r["map"], r["seed"], r["colliders"]) for r in rows)) if not bad else " | ".join(bad), "identical")
            bad = ["%s s%d: %s" % (r["map"], r["seed"], r["table404Error"]) for r in rows if not r["table404Built"]]
            chk("table-404-builds", not bad, ("the map still builds when prop_colliders.json 404s: %s" % ", ".join("%s s%d (%s colliders, %d fetch attempts, %d warns)" % (r["map"], r["seed"], r["table404Colliders"], r["table404Attempts"], len(r["table404Warns"])) for r in rows)) if not bad else " | ".join(bad), "builds")
            v.info("table-404 squad disagreement", "; ".join("%s s%d: %d colliders without the table vs %d with it" % (r["map"], r["seed"], r["table404Colliders"], r["colliders"]) for r in rows if r["table404Colliders"] is not None and r["table404Colliders"] != r["colliders"]) or "none")

        # ---- 5. the RNG stream vs the baseline revision
        baseline = args.baseline_rev or WAVE4_REV
        base_root, base_sha = PC.rev_root(baseline)
        now_root = root
        if plant == "rng-shift":
            mini = mini_root(True); tmp.append(mini)
            mp = os.path.join(mini, "runtime", "3d", "royale", "maps.js")
            with open(mp, encoding="utf-8") as fh:
                src = fh.read()
            if src.count(RNG_ANCHOR) != 1:
                raise C.EnvFailure("plant rng-shift: anchor %r found %d times in maps.js" % (RNG_ANCHOR, src.count(RNG_ANCHOR)))
            with open(mp, "w", encoding="utf-8") as fh:
                fh.write(src.replace(RNG_ANCHOR, RNG_ANCHOR + " rng();   /* PLANT rng-shift: one extra draw */"))
            now_root = mini
        seeds = "7" if args.quick else SEEDS
        now = run_node(["--mode", "fingerprint", "--root", now_root, "--vendor", vendor, "--seeds", seeds])
        if args.rev and PC.rev_root(args.rev)[1] == base_sha:
            base = now
        else:
            base = run_node(["--mode", "fingerprint", "--root", base_root, "--vendor", vendor, "--seeds", seeds])
        judge_rng(v, now, base, "git " + base_sha, chk)
    finally:
        for d in tmp:
            shutil.rmtree(d, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--baseline-rev", default=None, help="the revision the RNG stream is compared with (default %s, the Wave-4 commit)" % WAVE4_REV)
    ap.add_argument("--quick", action="store_true", help="seed 7 only for the RNG stream")
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
