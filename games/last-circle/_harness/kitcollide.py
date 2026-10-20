#!/usr/bin/env python
"""kitcollide - do the city kit's colliders match the mesh that is DRAWN at body height?  (Last Circle world plan, Wave 7, lane 7E.)  NODE ONLY: no browser,
no server, no file edited.

    python _harness/kitcollide.py                         # the working copy: manifest.json + the colliders citykit.js really uses (~15 s)
    python _harness/kitcollide.py --census 7,1234,2026    # + weigh every type by how often the Savanna builder places it (~25 s a seed)
    python _harness/kitcollide.py --census 7,1234,2026 --census-maps ashgrid,isla_viva,deepwood --census-require ashgrid,isla_viva,deepwood   # Wave 7b: the kit on all three maps
    python _harness/kitcollide.py --rev 60b854d0          # a frozen commit (the must-fail proof: the colliders that shipped in Wave 6)
    python _harness/kitcollide.py --plant shrink          # negative controls (each must exit 1, see PLANTS)

WHY: collisioncheck measures no kit collider (its rows cover trees, rocks, cars, containers) and the plan's "kit colliders clip p95 <= 0.10 m" passes at p95 0.0004 m
because ~97 % of the placed kit entries are lamps, cars, hydrants and flat walls. CHECK_A found the TAIL: on 3.6-3.8 % of the placed entries the drawn mesh pokes
> 0.10 m past its collider at body height (porch columns, relief bays, plinths), 0.6-1.6 m on a few types, and an invisible wall the other way. The bar is on the tail:
EVERY type, not a percentile.

probe_kitcollide.js loads the SHIPPED GLB of each of the 81 types (meshopt-decoded, node transforms, x suggested_scale), turns it by each of the 4 quarter turns exactly
the way citykit.js turns an instance, slices it at 31 planes between feet+0.3 m (below: a step, the mover climbs 0.55 m) and feet+1.8 m (the capsule), and measures against
the boxes that overlap that band (the colliders of manifest.json, and, separately, the ones citykit.js's embedded table gives through the game's own colliderFor()):
  poke-out  how far the drawn solid reaches OUTSIDE the boxes (a player walks that far into the visible wall), over the outline points a player can reach
  phantom   how far a box's exposed edge stands off the drawn solid (a player is stopped by AIR that far); hollow shells count as solid, a roof above 1.8 m does not

Rows (any FAIL -> exit 1; the probe not running -> exit 2):
  decode          all 81 shipped GLBs decode, with the manifest's triangle count and bbox
  poke            0 of 81 types with poke-out > 0.10 m            (manifest.json colliders)         [Wave 6: 27 of 81, worst 3.0 m]
  phantom         0 of 81 types with a phantom > 0.25 m           (manifest.json colliders)         [Wave 6: 21 of 81, worst 0.45 m]
  poke-shipped    the same bar on the colliders citykit.js ships  (COLLIDER_BOXES through colliderFor)
  phantom-shipped the same
  table-current   citykit.js's embedded COLLIDER_BOXES equals manifest.json exactly (after an intake run: node citykit.selftest.cjs --emit-table)
  rotation        the same type at the 4 quarter turns reads the same numbers (spread <= 0.03 m: mesh and boxes agree on the turn), and the game's colliderFor() equals the
                  independent turn of the same table to the millimetre
  boxes           the box count of every type <= 24 (the colliders feed the per-frame queryColliders: bounded)
  entries         (--census) 0 % of the entries the Savanna builder places stand on a type over either bar, for both collider sets
  INFO            worst types, box totals per Savanna seed (manifest vs shipped)

PLANTS (a planted fault edits a temp copy, never the tree; each must exit 1):
  shrink  every footprint / bands box of manifest.json shrunk by 0.15 m a side -> poke      grow  the same boxes grown by 0.40 m -> phantom
  q1-sign a patched citykit.js that turns quarter turn 1 the wrong way -> rotation          stale-table  the manifest with one box nudged -> table-current
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "kitcollide"
PROBE = os.path.join(C.HERE, "probe_kitcollide.js")
POKE_BAR, PHANTOM_BAR, SPREAD_BAR, MAX_BOXES = 0.10, 0.25, 0.03, 24
PLANTS = {"shrink": {"poke"}, "grow": {"phantom"}, "q1-sign": {"rotation"}, "stale-table": {"table-current"}}


def rev_root(rev):
    """runtime/ + assets/props of games/last-circle at a git rev, extracted to a temp dir (cached by commit sha)."""
    sha = subprocess.run(["git", "-C", C.REPO, "rev-parse", rev], capture_output=True, text=True).stdout.strip()
    if not sha:
        raise C.HarnessError("unknown git revision %r" % rev)
    dst = os.path.join(tempfile.gettempdir(), "lc_gate_rev", sha)
    mark = os.path.join(dst, ".complete")
    if not os.path.exists(mark):
        os.makedirs(dst, exist_ok=True)
        p = subprocess.run(["git", "-C", C.REPO, "archive", sha, "games/last-circle/runtime", "games/last-circle/assets/props"], capture_output=True)
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


def run_probe(root, manifest, citykit, args, out):
    cmd = ["node", PROBE, "--root", root, "--manifest", manifest, "--citykit", citykit, "--out", out,
           "--meshopt", os.path.join(C.ROOT, "assets", "vendor", "three", "examples", "jsm", "libs", "meshopt_decoder.module.js"),
           "--vendor", os.path.join(C.ROOT, "assets", "vendor", "three")]
    if args.only:
        cmd += ["--only", args.only]
    if args.census:
        cmd += ["--census", args.census, "--census-maps", args.census_maps]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=args.timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("probe_kitcollide.js still running after %d s" % args.timeout)
    if p.returncode != 0 or not os.path.exists(out):
        raise C.EnvFailure("probe_kitcollide.js failed (rc %s): %s" % (p.returncode, (p.stderr or p.stdout)[-600:]))
    return json.load(open(out, encoding="utf-8")), p.stdout


def plant_files(plant, root, tmp):
    """-> (manifest path, citykit path) for the run, planted faults applied to temp copies."""
    man = os.path.join(root, "assets", "props", "city", "manifest.json")
    ck = os.path.join(root, "runtime", "3d", "royale", "citykit.js")
    if plant in ("shrink", "grow"):
        m = json.load(open(man, encoding="utf-8"))
        d = -0.15 if plant == "shrink" else 0.40
        for t in m["types"].values():
            if t["collider_mode"] in ("footprint", "bands"):
                for b in t["colliders"]:
                    for a in (0, 2):
                        if b["max"][a] - b["min"][a] > 2 * abs(d) + 0.05 or d > 0:
                            b["min"][a] = round(b["min"][a] - d, 3)
                            b["max"][a] = round(b["max"][a] + d, 3)
        man = os.path.join(tmp, "manifest.json")
        json.dump(m, open(man, "w", encoding="utf-8"), separators=(",", ":"))
    elif plant == "stale-table":
        m = json.load(open(man, encoding="utf-8"))
        m["types"]["props/hydrant"]["colliders"][0]["max"][0] += 0.01
        man = os.path.join(tmp, "manifest.json")
        json.dump(m, open(man, "w", encoding="utf-8"), separators=(",", ":"))
    elif plant == "q1-sign":
        s = open(ck, encoding="utf-8").read()
        s2 = s.replace("else if (q === 1) { a = z0; b = z1; c = -x1; d = -x0; }", "else if (q === 1) { a = -z1; b = -z0; c = x0; d = x1; }")
        if s2 == s:
            raise C.HarnessError("q1-sign plant: the quarter-turn line of citykit.js was not found")
        ck = os.path.join(tmp, "citykit.js")
        open(ck, "w", encoding="utf-8").write(s2)
    return man, ck


def main_fn(v, args):
    t0 = time.time()
    if args.plant and args.plant not in PLANTS:
        raise C.HarnessError("unknown plant %r (%s)" % (args.plant, ", ".join(sorted(PLANTS))))
    if args.rev:
        root, label = rev_root(args.rev)
    else:
        root, label = C.ROOT, "working copy"
    tmp = tempfile.mkdtemp(prefix="lc_kitcollide_")
    manifest, citykit = plant_files(args.plant, root, tmp)
    doc, text = run_probe(root, manifest, citykit, args, os.path.join(tmp, "kitcollide.json"))
    T = doc["types"]
    n = len(T)
    v.data["root"] = label
    v.data["probe"] = {k: doc[k] for k in ("band", "slices", "sample", "qs", "wallS")}
    v.data["types"] = {k: {f: r.get(f) for f in ("mode", "boxes", "shipBoxes", "worstPoke", "worstPhantom", "shipWorstPoke", "shipWorstPhantom", "spread", "turnDiff")} for k, r in T.items()}
    v.data["census"] = doc.get("census")
    v.info("source", "%s: manifest %s, citykit %s; %d types x %d turns, band %s m, %d slices, probe %.1f s" % (
        label, os.path.relpath(doc["manifest"], root) if doc["manifest"].startswith(root) else "(temp copy)", os.path.basename(doc["citykit"] or "-"), n, len(doc["qs"]), doc["band"], doc["slices"], doc["wallS"]))
    plant = PLANTS.get(args.plant) if args.plant else None
    count = lambda name: plant is None or name in plant     # in plant mode only the designated rows count

    def row(name, ok, detail, expect=None):
        if count(name):
            v.check(name, ok, detail, expect)
        else:
            v.info(name + " (not counted)", detail)

    bad = doc["decode"]["bad"]
    want = n if args.only else 81                      # a partial run (--only) is judged on the types it was asked for
    row("decode", n == want and not bad and doc["decode"]["ok"] == n, {"decoded": doc["decode"]["ok"], "of": n, "bad": bad[:3]}, expect="%d of %d" % (want, want))

    def worst(key, k=6):
        return [(i.split("/", 1)[1], T[i][key]) for i in sorted(T, key=lambda i: -T[i][key])[:k]]
    over = lambda key, bar: [i for i in T if T[i][key] > bar]
    row("poke", not over("worstPoke", POKE_BAR), {"types over 0.10 m": len(over("worstPoke", POKE_BAR)), "of": n, "worst": worst("worstPoke")}, expect="0 types over 0.10 m")
    row("phantom", not over("worstPhantom", PHANTOM_BAR), {"types over 0.25 m": len(over("worstPhantom", PHANTOM_BAR)), "of": n, "worst": worst("worstPhantom")}, expect="0 types over 0.25 m")
    shipped = doc.get("citykit") is not None and all("shipWorstPoke" in r for r in T.values())
    if shipped:
        row("poke-shipped", not over("shipWorstPoke", POKE_BAR), {"types over 0.10 m": len(over("shipWorstPoke", POKE_BAR)), "of": n, "worst": worst("shipWorstPoke")}, expect="0 types over 0.10 m")
        row("phantom-shipped", not over("shipWorstPhantom", PHANTOM_BAR), {"types over 0.25 m": len(over("shipWorstPhantom", PHANTOM_BAR)), "of": n, "worst": worst("shipWorstPhantom")}, expect="0 types over 0.25 m")
        drift = doc.get("drift") or []
        row("table-current", not drift, {"types where citykit.js COLLIDER_BOXES differs from manifest.json": len(drift), "first": drift[:4],
                                         "fix": "node runtime/3d/royale/citykit.selftest.cjs --emit-table, paste the literal into citykit.js"}, expect="0")
        td = max(r["turnDiff"] for r in T.values())
    else:
        v.cnj("citykit.js", "citykit.js did not import in Node: %s" % doc.get("citykitError"))
        td = None
    sp = max(r["spread"] for r in T.values())
    row("rotation", sp <= SPREAD_BAR and (td is None or td <= 0.001), {"max spread over the 4 turns (m)": sp, "colliderFor vs independent turn (m)": td, "worst": worst("spread", 3)}, expect="spread <= 0.03, turn diff <= 0.001")
    mb = max(r["boxes"] for r in T.values())
    row("boxes", mb <= MAX_BOXES, {"max boxes per type": mb, "type": max(T, key=lambda i: T[i]["boxes"]), "total manifest": sum(r["boxes"] for r in T.values()),
                                   "total shipped": sum(r["shipBoxes"] or 0 for r in T.values()) if shipped else None}, expect="<= 24 per type")
    cen = doc.get("census")
    if args.census:
        if cen and not cen.get("error") and not cen.get("counts") and cen.get("byMap") and args.census_require:
            # Wave 7b: no kit at all on the maps that were asked to place one is a verdict, not a could-not-judge: each required map FAILS kit-placed
            v.info("entries", "the census built %s and found no kit entry on any of them" % ",".join(cen.get("maps") or []))
            for mid, bm in cen["byMap"].items():
                if mid in args.census_require.split(","):
                    row("kit-placed [%s]" % mid, False, "this build's %s places NO city kit (M.city is null on %d of %d seeds)" % (mid, len(bm["seeds"]) - bm["hasCity"], len(bm["seeds"])),
                        "kit entries on every seed, none on a type over either bar")
        elif not cen or cen.get("error") or not cen.get("counts"):
            v.cnj("entries", "census failed: %s" % ((cen or {}).get("error") or "no counts"))
        else:
            tot = cen["entries"]
            share = lambda key, bar: sum(c for i, c in cen["counts"].items() if i in T and T[i][key] > bar) / max(1, tot)
            per_seed = {s: {"entries": c["entries"], "manifest boxes": c["boxesMan"], "shipped boxes": c["boxesShip"]} for s, c in cen["seeds"].items()}
            sh = {"poke > 0.10 m %": round(100 * share("worstPoke", POKE_BAR), 2), "phantom > 0.25 m %": round(100 * share("worstPhantom", PHANTOM_BAR), 2)}
            if shipped:
                sh["shipped poke > 0.10 m %"] = round(100 * share("shipWorstPoke", POKE_BAR), 2)
                sh["shipped phantom > 0.25 m %"] = round(100 * share("shipWorstPhantom", PHANTOM_BAR), 2)
            row("entries", all(x == 0 for x in sh.values()), dict(sh, entries=tot, seeds=per_seed), expect="0 % of the placed entries over either bar")
            # Wave 7b: the kit is placed on all three maps. Per map: how many entries, and (maps named in --census-require) a map with NO kit at all FAILS - it has no city to judge
            for mid, bm in (cen.get("byMap") or {}).items():
                n = bm["entries"]
                badn = sum(c for i, c in bm["counts"].items() if i in T and (T[i]["worstPoke"] > POKE_BAR or T[i]["worstPhantom"] > PHANTOM_BAR))
                if shipped:
                    badn += sum(c for i, c in bm["counts"].items() if i in T and (T[i]["shipWorstPoke"] > POKE_BAR or T[i]["shipWorstPhantom"] > PHANTOM_BAR) and not (T[i]["worstPoke"] > POKE_BAR or T[i]["worstPhantom"] > PHANTOM_BAR))
                v.info("entries [%s]" % mid, "%d kit entries on %d seeds (%d with a city layout), %d on a type over either bar (%s %%), manifest boxes %d, shipped boxes %d" % (
                    n, len(bm["seeds"]), bm["hasCity"], badn, round(100 * badn / max(1, n), 2), bm["boxesMan"], bm["boxesShip"]))
                if mid in (args.census_require or "").split(","):
                    row("kit-placed [%s]" % mid, n > 0 and bm["hasCity"] == len(bm["seeds"]) and badn == 0, "%d kit entries on %d seeds, %d on a type over a bar" % (n, len(bm["seeds"]), badn) if n else "this build's %s places NO city kit (M.city is null on %d of %d seeds)" % (mid, len(bm["seeds"]) - bm["hasCity"], len(bm["seeds"])),
                        "kit entries on every seed, none on a type over either bar")
    v.info("worst by poke", worst("worstPoke", 8))
    v.info("worst by phantom", worst("worstPhantom", 8))
    v.info("wall", "%.0f s (Node, no browser)" % (time.time() - t0))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rev", default=None, metavar="GITREV", help="judge the colliders as committed at GITREV (runtime/ + assets/props extracted to a temp dir)")
    ap.add_argument("--disk", action="store_true", help="accepted for gate.py symmetry: this gate always reads the working copy unless --rev")
    ap.add_argument("--only", default=None, help="comma list of id substrings")
    ap.add_argument("--census", default=None, help="comma list of seeds to weigh the types by (builds the real map in Node, ~25 s a seed on Savanna)")
    ap.add_argument("--census-maps", default="ashgrid", help="maps the census builds (Wave 7b: ashgrid,isla_viva,deepwood)")
    ap.add_argument("--census-require", default="", help="maps that MUST place a kit (a build without one FAILS kit-placed [map])")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANTS)))
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--report", default=None)
    ap.add_argument("--out", default=None)
    ap.set_defaults(base="node only (no server)")
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
