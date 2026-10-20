#!/usr/bin/env python
"""genversion - was MAP_GEN_VERSION bumped when the world a squad peer must agree on changed?  (Wave-7 completion round, lane D5.)  NODE ONLY: no browser, no server, no file edited.

    python _harness/genversion.py --disk                                   # the working copy against the build LIVE on the CDN (common.LIVE_REV): 3 maps x seeds 1, 7, 1234 (~1 min)
    python _harness/genversion.py --rev dd414cb2 --live-rev 60b854d0       # any two commits: the Wave-7 release against the Wave-6 one (the worlds differ, the version moved 2 -> 3: PASS)
    python _harness/genversion.py --rev dd414cb2 --live-rev 60b854d0 --plant no-bump   # negative control: the same candidate with its MAP_GEN_VERSION set back to 2: MUST FAIL
    python _harness/genversion.py --disk --expect-version 5 --identical-maps ashgrid   # Wave 7b (gate.py): the version is 5 on all three maps, and Savanna's world hashes IDENTICALLY to the live build's
    python _harness/genversion.py --disk --expect-version 5 --identical-maps ashgrid --plant savanna-shift   # negative control: Savanna gets one compound fewer (a scratch towngen.js): MUST FAIL

A squad room is "every client rebuilds the same world from W.seed" (net.js hands MAP_GEN_VERSION over in the handshake and refuses a peer whose version differs). The guard sees the VERSION,
never the world: a change to a world builder, the collider table, a prop anchor or loot placement that leaves MAP_GEN_VERSION where it was puts two clients on one version and two
worlds, and nothing says so (the Wave-6 ground changes shipped without a guard at all; the Wave-7 loot settling moved Isla Viva and Deepwood loot positions "although the maps are identical").
`probe_genversion.mjs` builds every (map, seed) with the candidate's UNMODIFIED maps.js and loot.js and with the live build's, and hashes what a peer must agree on: every collider, the ground
height on a 7.3 m grid, the POIs, the prop anchors, the map's loot points and the items loot.js populate() spawns from them (the meshes are not in it). Rows:

  gv-bumped         if ANY of those hashes differs on ANY (map, seed) from the live build's, the candidate's MAP_GEN_VERSION export is HIGHER than the live build's (a build without the export counts
                    as 1). Identical worlds pass with any version >= the live one. The detail names every (map, seed, field) that moved, so a lane that changed the world can see it
  gv-export-built   the version each built map reports (map.genVersion) equals the file's export (a fallback build reports less on purpose and would show here)
  population        at least 9 (map, seed) builds compared on each side (a probe that built nothing is could-not-judge, never a pass)
  INFO              the number of builds whose world changed, per field; the live and candidate versions; whether the bump was single (live + 1; D2 bumps ONCE per round)

Wave 7b (lane B2) adds two rows: gv-target (`--expect-version N`: the export IS N and every built map reports N - "the three maps' versions are consistent") and gv-identical (`--identical-maps
ashgrid`: the maps named there must hash IDENTICALLY to the live build's on every field and seed - Wave 7b changes Isla Viva and Deepwood on purpose and promises Savanna's world stays byte for byte;
a squad peer on the live build and one on this build would otherwise share a version on Savanna and play different cities).

--plant no-bump copies the candidate's runtime tree to a scratch directory and sets its `MAP_GEN_VERSION` back to the live build's value (the candidate's world is untouched): on a candidate
whose world differs from the live build's, gv-bumped must FAIL. With --disk the plant works on whatever the tree holds; if the tree's world is still identical to live's the plant changes
nothing, and the run says so (the registered control therefore pins --rev dd414cb2 against --live-rev 60b854d0, where the worlds differ for certain).

Exit 0 pass / 1 fail / 2 could-not-judge (node missing, the probe crashed, too few builds).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import placementcheck as PC  # noqa: E402

GATE = "genversion"
PROBE = os.path.join(C.HERE, "probe_genversion.mjs")
FIELDS = ("col", "heights", "pois", "props", "points", "items")
MIN_BUILDS = 9
VERSION_RE = re.compile(r"(export const MAP_GEN_VERSION = )(\d+)(;)")


def run_probe(root, vendor, maps, seeds, timeout, label):
    out = os.path.join(tempfile.gettempdir(), "lc_genversion_%d_%s.json" % (os.getpid(), label))
    cmd = ["node", PROBE, "--root", root, "--vendor", vendor, "--maps", maps, "--seeds", seeds, "--out", out]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("probe_genversion.mjs (%s) still running after %d s" % (label, timeout))
    if p.returncode != 0 or not os.path.exists(out):
        raise C.EnvFailure("probe_genversion.mjs (%s) exit %s: %s" % (label, p.returncode, " | ".join((p.stderr or p.stdout or "").strip().splitlines()[-4:])[:500]))
    with open(out, encoding="utf-8") as fh:
        doc = json.load(fh)
    try:
        os.remove(out)
    except OSError:
        pass
    print("  [%s] %d builds in %.0f s (MAP_GEN_VERSION export %s%s)" % (label, len(doc["builds"]), time.time() - t0, doc["exportVersion"], "" if doc["hasExport"] else ", none: counts as 1"), flush=True)
    return doc


def plant_no_bump(root, live_version):
    """a scratch copy of root's runtime/ + assets/props with the version export set back to live_version; returns (dir, what changed)"""
    dst = tempfile.mkdtemp(prefix="lc_genversion_plant_")
    for sub in ("runtime", os.path.join("assets", "props")):
        shutil.copytree(os.path.join(root, sub), os.path.join(dst, sub))
    p = os.path.join(dst, "runtime", "3d", "royale", "maps.js")
    with open(p, encoding="utf-8", newline="") as fh:
        src = fh.read()
    m = VERSION_RE.search(src)
    if not m:
        raise C.EnvFailure("plant no-bump: maps.js has no 'export const MAP_GEN_VERSION = <n>;'")
    new = VERSION_RE.sub(lambda mm: mm.group(1) + str(live_version) + mm.group(3), src, count=1)
    with open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write(new)
    return dst, "MAP_GEN_VERSION %s -> %s in a scratch copy of maps.js" % (m.group(2), live_version)


def plant_savanna_shift(root):
    """a scratch copy of root's runtime/ + assets/props whose towngen.js lays out ONE Savanna compound fewer (PLANS.ashgrid.compounds.count 30 -> 29); the version is untouched"""
    dst = tempfile.mkdtemp(prefix="lc_genversion_plant_")
    for sub in ("runtime", os.path.join("assets", "props")):
        shutil.copytree(os.path.join(root, sub), os.path.join(dst, sub))
    p = os.path.join(dst, "runtime", "3d", "royale", "towngen.js")
    with open(p, encoding="utf-8", newline="") as fh:
        src = fh.read()
    m = re.search(r"(compounds: \{ count: )30(, themes)", src)
    if not m:
        raise C.EnvFailure("plant savanna-shift: towngen.js has no 'compounds: { count: 30, themes' (the Savanna plan)")
    with open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write(re.sub(r"(compounds: \{ count: )30(, themes)", lambda mm: mm.group(1) + "29" + mm.group(2), src, count=1))
    return dst, "Savanna compounds 30 -> 29 in a scratch copy of towngen.js"


def main_fn(v, args):
    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    if args.plant and args.plant not in ("no-bump", "savanna-shift"):
        raise C.HarnessError("unknown --plant %r (known: no-bump, savanna-shift)" % args.plant)
    live_root, live_sha = PC.rev_root(args.live_rev)
    if args.rev:
        cand_root, cand_sha = PC.rev_root(args.rev)
        cand_label = "git " + cand_sha
    else:
        cand_root, cand_label = C.ROOT, "working copy"
    print("%s: %s vs the live build %s | maps %s | seeds %s | plant %s" % (GATE, cand_label, live_sha, args.maps, args.seeds, args.plant or "none"), flush=True)
    live = run_probe(live_root, vendor, args.maps, args.seeds, args.timeout, "live " + live_sha)
    plant_note = None
    scratch = None
    try:
        if args.plant in ("no-bump", "savanna-shift"):
            scratch, plant_note = plant_no_bump(cand_root, live["exportVersion"]) if args.plant == "no-bump" else plant_savanna_shift(cand_root)
            print("  plant %s: %s" % (args.plant, plant_note), flush=True)
            cand = run_probe(scratch, vendor, args.maps, args.seeds, args.timeout, "candidate (planted)")
        else:
            cand = run_probe(cand_root, vendor, args.maps, args.seeds, args.timeout, "candidate")
    finally:
        if scratch:
            shutil.rmtree(scratch, ignore_errors=True)
    v.data.update({"candidate": cand_label, "live": live_sha, "candidateVersion": cand["exportVersion"], "liveVersion": live["exportVersion"], "plant": args.plant, "plantNote": plant_note,
                   "builds": len(cand["builds"])})
    if len(cand["builds"]) < MIN_BUILDS or len(live["builds"]) < MIN_BUILDS:
        v.cnj("population", "compared %d candidate / %d live builds (need >= %d)" % (len(cand["builds"]), len(live["builds"]), MIN_BUILDS))
        return
    v.check("population", True, "%d (map, seed) builds per side: maps %s, seeds %s" % (len(cand["builds"]), args.maps, args.seeds))
    lk = {(b["map"], b["seed"]): b for b in live["builds"]}
    moved, per_field = [], {f: 0 for f in FIELDS}
    for b in cand["builds"]:
        o = lk.get((b["map"], b["seed"]))
        if o is None:
            continue
        diff = [f for f in FIELDS if b[f] != o[f]]
        for f in diff:
            per_field[f] += 1
        if diff:
            moved.append("%s s%d: %s%s" % (b["map"], b["seed"], ",".join(diff), (" (colliders %d -> %d)" % (o["n"], b["n"])) if o["n"] != b["n"] else ""))
    cv, lv = cand["exportVersion"], live["exportVersion"]
    changed_maps = sorted({m.split(" ")[0] for m in moved})
    if moved:
        ok = cv > lv
        v.check("gv-bumped", ok, "the world a peer must agree on CHANGED in %d of %d builds (maps %s; fields: %s) and MAP_GEN_VERSION is %d on the candidate, %d on the live build%s" % (
            len(moved), len(cand["builds"]), ",".join(changed_maps), ", ".join("%s %d" % (f, n) for f, n in per_field.items() if n), cv, lv,
            "" if ok else " - NOT BUMPED: two clients (one on each build) would share a version and build different worlds, and the guard cannot see it"),
            "version > the live build's whenever a world hash moved")
        v.info("what moved", "; ".join(moved[:12]) + (" ..." if len(moved) > 12 else ""))
    else:
        ok = cv >= lv
        v.check("gv-bumped", ok, "every one of the %d builds is IDENTICAL to the live build's in col / heights / pois / props / points / items; MAP_GEN_VERSION %d (live %d)%s" % (
            len(cand["builds"]), cv, lv, "" if ok else " - LOWER than the live build's"), "no world change, or a higher version")
        if plant_note:
            v.info("plant has no effect here", "the candidate's world equals the live build's, so there is nothing to forget to bump: pin --rev against an older --live-rev (the registered control)")
    bad = [(b["map"], b["seed"], b["genVersion"]) for b in cand["builds"] if b["genVersion"] != cv]
    v.check("gv-export-built", not bad, "every built map reports genVersion %d = the export%s" % (cv, ("; differing: %s" % bad[:4]) if bad else ""), "map.genVersion == MAP_GEN_VERSION")
    # ---- Wave 7b: the three maps agree on the target version; the held maps are byte for byte the live build's ----
    if args.expect_version is not None:
        by_map = {}
        for b in cand["builds"]:
            by_map.setdefault(b["map"], set()).add(b["genVersion"])
        off = {m: sorted(x) for m, x in by_map.items() if x != {args.expect_version}}
        v.check("gv-target", cv == args.expect_version and not off, "MAP_GEN_VERSION export %d, built maps report %s (target %d)%s" % (cv, "; ".join("%s %s" % (m, sorted(x)) for m, x in sorted(by_map.items())), args.expect_version,
                ("; OFF TARGET: %s" % off) if off or cv != args.expect_version else ""), "export == every built map's genVersion == %d" % args.expect_version)
    ident = [m for m in (args.identical_maps or "").split(",") if m]
    if ident:
        movedm = {}
        for b in cand["builds"]:
            if b["map"] not in ident:
                continue
            o = lk.get((b["map"], b["seed"]))
            if o is None:
                continue
            d = [f for f in FIELDS if b[f] != o[f]]
            if d:
                movedm.setdefault(b["map"], []).append("s%d: %s%s" % (b["seed"], ",".join(d), (" (colliders %d -> %d)" % (o["n"], b["n"])) if o["n"] != b["n"] else ""))
        n_ident = sum(1 for b in cand["builds"] if b["map"] in ident)
        v.check("gv-identical", n_ident > 0 and not movedm, ("%d builds of %s hash IDENTICALLY to the live build's (col / heights / pois / props / points / items)" % (n_ident, ",".join(ident))) if n_ident and not movedm else
                ("no build of %s was compared" % ",".join(ident)) if not n_ident else "; ".join("%s changed on %d of %d seeds: %s" % (m, len(x), len(args.seeds.split(",")), "; ".join(x[:4])) for m, x in movedm.items()),
                "the held maps (%s) hash identically to the live build's on every seed" % ",".join(ident))
        v.info("changed on purpose", "maps whose world differs from the live build's: %s" % (", ".join(sorted({m.split(" ")[0] for m in moved})) or "none"))
    v.info("version step", "candidate %d, live %d: %s" % (cv, lv, "a single bump (live + 1)" if cv == lv + 1 else ("unchanged" if cv == lv else ("bumped %d times in one round" % (cv - lv) if cv > lv else "LOWER"))))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--live-rev", default=C.LIVE_REV, help="the build the candidate is compared with (default common.LIVE_REV)")
    ap.add_argument("--maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--seeds", default="1,7,1234")
    ap.add_argument("--plant", default=None, help="negative control: no-bump, savanna-shift")
    ap.add_argument("--expect-version", type=int, default=None, help="Wave 7b: the MAP_GEN_VERSION every map must report (gate.py passes 5)")
    ap.add_argument("--identical-maps", default="", help="Wave 7b: maps whose world must hash IDENTICALLY to the live build's (gate.py: ashgrid)")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
