#!/usr/bin/env python3
"""art_b_bootmaps.py - Wave 8 stage A2 (lane H5, kit merge): bootcheck on ALL THREE maps, plus the town kit's GLB downloads of each real match.

bootcheck.py (unchanged, imported) boots the game, clicks the BATTLE ROYALE card, and the game picks the map at random (hud.js randomMap(), no picker).
This wrapper runs it again and again until each of ashgrid / isla_viva / deepwood has been played (or --max runs), and records per run - read-only, through
one hook on Session.diagnostics() which bootcheck calls after its walk - which map was loaded and which assets/props/city GLBs the page requested
(performance resource entries). The merged interior kit (55 furniture / wall types, manifest.json) is placed by no map yet, so NONE of their GLBs may be
requested: the row "interior-glbs" fails on any. Every bootcheck row keeps its own verdict and exit code; a run's exit 2 (could-not-judge) is re-run.

  python _tools/art_b_bootmaps.py --disk [--max 12] [--out FILE.json]
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
HARNESS = GAME / "_harness"
MAPS = ("ashgrid", "isla_viva", "deepwood")

HOOK = r'''
import sys, json, os
sys.path.insert(0, %(h)r)
import common as C
_orig = C.Session.diagnostics
def _diag(self, *a, **k):
    try:
        info = self.js("""() => {
          const W = window.__LC__.W, man = W && W.map;
          const res = performance.getEntriesByType("resource").map((e) => e.name.replace(/[?#].*$/, ""));
          const city = res.filter((u) => /assets\/props\/city\/.*\.glb$/.test(u)).map((u) => u.replace(/^.*assets\/props\/city\//, ""));
          return { mapId: W.mapId, phase: W.phase, cityGlbs: Array.from(new Set(city)).sort(), manifest: res.some((u) => /assets\/props\/city\/manifest\.json$/.test(u)) };
        }""")
    except Exception as e:
        info = {"error": str(e)[:200]}
    with open(os.environ["ART_B_BOOTMAPS_OUT"], "w", encoding="utf-8") as f:
        json.dump(info, f)
    return _orig(self, *a, **k)
C.Session.diagnostics = _diag
sys.argv = ["bootcheck.py"] + json.loads(os.environ["ART_B_BOOTMAPS_ARGS"])
sys.path.insert(0, %(h)r)
import bootcheck
sys.exit(bootcheck.main())
''' % {"h": str(HARNESS)}


def main() -> int:
    args = sys.argv[1:]
    mx, out = 12, None
    if "--max" in args:
        i = args.index("--max"); mx = int(args[i + 1]); del args[i:i + 2]
    if "--out" in args:
        i = args.index("--out"); out = args[i + 1]; del args[i:i + 2]
    man = json.loads((GAME / "assets" / "props" / "city" / "manifest.json").read_text(encoding="utf-8"))
    cat = json.loads((GAME / "assets" / "props" / "city" / "manifest_interior.json").read_text(encoding="utf-8"))["catalogue"]
    new_files = {man["types"][t]["file"] for t, c in cat.items() if c.get("new") and t in man["types"]}
    runs, seen = [], {}
    tmpd = tempfile.mkdtemp(prefix="art_b_bootmaps_")
    hook = Path(tmpd) / "hook.py"
    hook.write_text(HOOK, encoding="utf-8")
    for n in range(mx):
        if all(m in seen for m in MAPS):
            break
        info_p = Path(tmpd) / ("info_%d.json" % n)
        rep = "art_b_bootmaps_%d" % n
        env = dict(os.environ, ART_B_BOOTMAPS_OUT=str(info_p), ART_B_BOOTMAPS_ARGS=json.dumps(args + ["--report", rep]), PYTHONIOENCODING="utf-8")
        p = subprocess.run([sys.executable, str(hook)], cwd=str(GAME), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        info = json.loads(info_p.read_text(encoding="utf-8")) if info_p.exists() else {"error": "no diagnostics reached"}
        verdict = [l for l in p.stdout.splitlines() if l.startswith("VERDICT")]
        bad_new = sorted(f for f in info.get("cityGlbs", []) if f in new_files)
        row = {"run": n, "rc": p.returncode, "map": info.get("mapId"), "verdict": verdict[-1] if verdict else None, "cityGlbs": len(info.get("cityGlbs", [])),
               "interiorGlbsRequested": bad_new, "manifestFetched": info.get("manifest"), "info": info}
        runs.append(row)
        print("run %d: map %s rc %d  %s  city GLBs %d, new interior GLBs requested %d" % (n, row["map"], p.returncode, row["verdict"], row["cityGlbs"], len(bad_new)), flush=True)
        if p.returncode != 0:
            print("\n".join(p.stdout.splitlines()[-30:]))
        if p.returncode == 0 and row["map"] in MAPS and row["map"] not in seen:
            seen[row["map"]] = row
    print("\nart_b_bootmaps verdict table")
    rc = 0
    for m in MAPS:
        r = seen.get(m)
        st = "PASS" if r else "CNJ "
        print("  %s  bootcheck [%s]  %s" % (st, m, (r["verdict"] if r else "no passing run landed on this map in %d runs" % len(runs))))
        if not r:
            rc = max(rc, 2)
    fails = [r for r in runs if r["rc"] == 1]
    if fails:
        rc = 1
        print("  FAIL  bootcheck runs that FAILED: %s" % [(r["run"], r["map"]) for r in fails])
    leak = [r for r in runs if r["interiorGlbsRequested"]]
    print("  %s  interior-glbs  0 of the %d new interior-kit GLBs requested by any match (%d runs)%s" % (
        "FAIL" if leak else "PASS", len(new_files), len(runs), (": " + json.dumps([(r["map"], r["interiorGlbsRequested"][:4]) for r in leak])) if leak else ""))
    if leak:
        rc = 1
    if out:
        Path(out).write_text(json.dumps({"runs": runs, "newInteriorFiles": sorted(new_files)}, indent=1), encoding="utf-8")
    print("VERDICT art_b_bootmaps: %s" % ("PASS" if rc == 0 else "FAIL" if rc == 1 else "COULD-NOT-JUDGE"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
