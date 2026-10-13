#!/usr/bin/env python
"""gate - every Last Circle gate in one run: Node selftests, then each browser gate, one verdict table (PLAN section 5).

    python _harness/gate.py --disk                         # the integration run (serves the working copy; no server needed)
    python _harness/gate.py --disk --only bootcheck,leaktest
    python _harness/gate.py --rev 7da063ad --skip mobile,probe_match
    python _harness/gate.py --disk --negative-controls     # also prove rigcheck / portalcheck still FAIL on a planted fault

Node first (`node <file>` for every runtime/**/*.selftest.cjs: royale.selftest.cjs, aimassist.selftest.cjs, the audio pool
selftest when they exist) - they prove the SIM only. Then the browser gates run ONE AT A TIME (one Chrome at a time on this
shared box), each as its own process with the same --base / --disk / --rev / --headed / --gpu flags:

  bootcheck   bootguard   rigcheck (3 seeds)   playtest   portalcheck (--matrix)   framecheck   lifecycle   feelcheck
  layoutcheck (desktop + phones)   mobile (4 devices)   probe_match (>= 6 seeds, storm on)   leaktest (3 ashgrid)
  then the Wave-4 lane gates (_harness/new/<lane>_<name>.py, registered 2026-10-12; the same exit-code convention):
    artb_check   art_a_clips   art_a_canopy   art_a_integration   artb_decode   artb_integration
    stormfx_fx   stormfx_storm   loot_beams_rings   sky_probe (--merged)   sky_lowtier (--merged)
    hud_checks   hud_cycle
    player_dlcount   player_deaths   player_canopy   player_camwall   player_rim   player_dive
    orch_lowpost   orch_progkey   sim_pacing (10 whole matches: the long one)
  perfcheck, orch_lowpost_ab (INFORMATION ONLY: shown, never counted)

--negative-controls adds the planted-fault runs, each of which must exit 1: rigcheck --inject-regression, portalcheck minus
allow-pointer-lock, bootguard j/k --plant no-card and --plant hidden-card, bootcheck --plant lock-drop, feelcheck --plant
kill-marker-short, layoutcheck --only phones --plant no-touch-ui, framecheck --plant forced-layout, loot_beams_rings
(flush-clear, storm-ignore), sky_probe (fog-flat, no-rng-burn, no-handles), sky_lowtier (one-layer-broken); and feelcheck
--plant blind-sampler, which must exit 2 (a blinded sampler is could-not-judge, never a verdict).

Each gate's stdout goes to _harness/_reports/gate_<stamp>/<gate>.log and its JSON report to _harness/_reports/. A gate exits
0 pass / 1 fail / 2 could-not-judge; a timeout or a crash of the gate process is could-not-judge. The overall verdict:
any fail -> FAIL (exit 1); else any could-not-judge -> COULD-NOT-JUDGE (exit 2, re-run those gates; never counted as a
pass); else PASS (exit 0).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

# (name, script, extra args, timeout s, informational)
GATES = [
    ("bootcheck", "bootcheck.py", [], 3600, False),
    ("bootguard", "bootguard.py", [], 5400, False),
    ("rigcheck", "rigcheck.py", ["--seeds", "7,11,23"], 5400, False),
    ("playtest", "playtest.py", [], 5400, False),
    ("portalcheck", "portalcheck.py", ["--matrix"], 3600, False),
    ("framecheck", "framecheck.py", [], 5400, False),
    ("lifecycle", "lifecycle.py", [], 3600, False),
    ("feelcheck", "feelcheck.py", [], 3600, False),
    ("layoutcheck", "layoutcheck.py", [], 5400, False),
    ("mobile", "mobile.py", [], 7200, False),
    ("probe_match", "probe_match.py", ["--farwall"], 14400, False),
    ("leaktest", "leaktest.py", [], 7200, False),
    # ---- Wave-4 lane gates: _harness/new/<lane>_<name>.py, registered 2026-10-12. Same convention as every gate above (0 pass /
    # 1 fail / 2 could-not-judge, one VERDICT line, JSON in _reports/); all take the common flags, so --disk / --rev / --base /
    # --headed / --gpu pass through. None needs a rAF (they step frames); each lane gate's --isolate / --overlay-root is a
    # lane-development convenience and is NOT used here: the integration run judges the whole working copy (or --rev).
    # ART-B first: artb_check reads files on disk (no browser), so a bad manifest fails in seconds.
    ("artb_check", "new/artb_check.py", [], 600, False),
    ("art_a_clips", "new/art_a_clips.py", [], 3600, False),
    ("art_a_canopy", "new/art_a_canopy.py", [], 3600, False),
    ("art_a_integration", "new/art_a_integration.py", [], 5400, False),
    ("artb_decode", "new/artb_decode.py", [], 3600, False),
    ("artb_integration", "new/artb_integration.py", [], 3600, False),
    ("stormfx_fx", "new/stormfx_fx.py", [], 3600, False),
    ("stormfx_storm", "new/stormfx_storm.py", [], 5400, False),
    ("loot_beams_rings", "new/loot_beams_rings.py", [], 5400, False),
    # sky_*: by default they serve git HEAD + ONLY the working-copy maps.js (a before/after rig that ignores --disk/--rev);
    # --merged = a plain working-copy run, one browser, absolute rows only (the integration pass their docstrings name)
    ("sky_probe", "new/sky_probe.py", ["--merged"], 5400, False),
    ("sky_lowtier", "new/sky_lowtier.py", ["--merged"], 3600, False),
    ("hud_checks", "new/hud_checks.py", [], 5400, False),
    ("hud_cycle", "new/hud_cycle.py", [], 5400, False),
    ("player_dlcount", "new/player_dlcount.py", [], 5400, False),
    ("player_deaths", "new/player_deaths.py", [], 5400, False),
    ("player_canopy", "new/player_canopy.py", [], 5400, False),
    ("player_camwall", "new/player_camwall.py", [], 5400, False),
    ("player_rim", "new/player_rim.py", [], 3600, False),
    ("player_dive", "new/player_dive.py", [], 3600, False),
    ("orch_lowpost", "new/orch_lowpost.py", [], 5400, False),
    ("orch_progkey", "new/orch_progkey.py", [], 3600, False),
    ("sim_pacing", "new/sim_pacing.py", [], 14400, False),
    ("perfcheck", "perfcheck.py", [], 7200, True),
    # information only (never exits 1): LOW tier with vs without the composer, interleaved ABAB. --no-lp drops its lc_liveprobe
    # arms (rAF windows - perfcheck above already reports those); the stepped GPU-synced bench stays
    ("orch_lowpost_ab", "new/orch_lowpost_ab.py", ["--no-lp"], 5400, True),
]
# planted faults that MUST make a passing gate fail (the gate's own falsifier)
NEGATIVE = [
    ("rigcheck-injected", "rigcheck.py", ["--seeds", "7", "--inject-regression"], 3600),
    ("portalcheck-minus-pointer-lock", "portalcheck.py", ["--drop-token", "allow-pointer-lock"], 3600),
    # Wave-2 L1F: the j/k card judge must FAIL when no card is painted / the card is hidden, and the lock row when the
    # lock drops while the player is alive (bootguard / bootcheck --plant)
    ("bootguard-plant-no-card", "bootguard.py", ["--cases", "j,k", "--plant", "no-card"], 1800),
    ("bootguard-plant-hidden-card", "bootguard.py", ["--cases", "j,k", "--plant", "hidden-card"], 1800),
    ("bootcheck-plant-lock-drop", "bootcheck.py", ["--plant", "lock-drop"], 3600),
    # Wave-3 H-harness: the kill-marker row must FAIL on a 50 ms kill hold; a blind sampler (the Wave-2 ordering defect)
    # must be COULD-NOT-JUDGE (expected exit 2), never a verdict; the phone overlap rows must not pass with no touch controls
    ("feelcheck-plant-kill-marker-short", "feelcheck.py", ["--plant", "kill-marker-short"], 1800),
    ("feelcheck-plant-blind-sampler", "feelcheck.py", ["--plant", "blind-sampler"], 1800, 2),
    ("layoutcheck-plant-no-touch-ui", "layoutcheck.py", ["--only", "phones", "--plant", "no-touch-ui"], 3600),
    # forced layouts are counted from a stack-traced trace now: a planted style-write + offsetWidth updater must FAIL both rows
    ("framecheck-plant-forced-layout", "framecheck.py", ["--plant", "forced-layout"], 3600),
    # Wave-4 lane falsifiers (each documented "MUST fail", each measured to exit 1 on 2026-10-12). The sky plants run WITHOUT
    # --merged: --merged skips the maps.js override the plant rides on
    ("loot_beams_rings-plant-flush-clear", "new/loot_beams_rings.py", ["--only", "gpusync", "--plant", "flush-clear"], 1800),
    ("loot_beams_rings-plant-storm-ignore", "new/loot_beams_rings.py", ["--only", "stormfade", "--plant", "storm-ignore"], 1800),
    ("sky_probe-plant-fog-flat", "new/sky_probe.py", ["--plant", "fog-flat"], 1800),
    ("sky_probe-plant-no-rng-burn", "new/sky_probe.py", ["--plant", "no-rng-burn"], 1800),
    ("sky_probe-plant-no-handles", "new/sky_probe.py", ["--plant", "no-handles"], 1800),
    ("sky_lowtier-plant-one-layer-broken", "new/sky_lowtier.py", ["--plant", "one-layer-broken"], 1800),
]


def node_selftests():
    files = sorted(glob.glob(os.path.join(C.ROOT, "runtime", "**", "*.selftest.cjs"), recursive=True))
    out = []
    for f in files:
        rel = os.path.relpath(f, C.ROOT).replace(os.sep, "/")
        t0 = time.time()
        try:
            r = subprocess.run(["node", f], cwd=C.ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
            code = 0 if r.returncode == 0 else 1
            tail = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-3:]
        except subprocess.TimeoutExpired:
            code, tail = 2, ["timeout after 900 s"]
        except FileNotFoundError:
            code, tail = 2, ["node not found on PATH"]
        out.append({"name": "node " + rel, "exit": code, "wall": round(time.time() - t0, 1), "tail": tail})
        print("  %-4s node %s (%.0f s) %s" % ({0: "PASS", 1: "FAIL", 2: "CNJ "}[code], rel, time.time() - t0, " | ".join(tail)[:200]), flush=True)
    return out


def run_gate(name, script, extra, timeout, args, logdir):
    cmd = [sys.executable, "-u", os.path.join(C.HERE, script)] + list(extra)
    if args.rev:
        cmd += ["--rev", args.rev]
    elif args.disk:
        cmd += ["--disk"]
    if args.base != C.DEFAULT_BASE:
        cmd += ["--base", args.base]
    if args.headed:
        cmd += ["--headed"]
    if args.gpu and args.gpu != "d3d11" and name != "mobile":
        cmd += ["--gpu", args.gpu]
    log = os.path.join(logdir, name + ".log")
    t0 = time.time()
    verdict = None
    print("\n=== %s  %s  (%s)" % (name, " ".join(cmd[2:]), time.strftime("%H:%M:%S")), flush=True)
    try:
        with open(log, "w", encoding="utf-8") as fh:
            p = subprocess.run(cmd, cwd=C.ROOT, stdout=fh, stderr=subprocess.STDOUT, timeout=timeout,
                               env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        code = p.returncode if p.returncode in (0, 1, 2) else 2
    except subprocess.TimeoutExpired:
        code = 2
        verdict = "timeout after %d s" % timeout
    try:
        lines = open(log, encoding="utf-8", errors="replace").read().splitlines()
        vl = [ln for ln in lines if ln.startswith("VERDICT ")]
        rl = [ln for ln in lines if ln.startswith("REPORT ")]
        if vl and not verdict:
            verdict = vl[-1][len("VERDICT "):]
        report = rl[-1][len("REPORT "):] if rl else None
    except Exception:
        report = None
    if verdict is None:
        verdict = "no verdict line (gate process exit %s)" % code
    print("    -> exit %d  %s  [%.0f s]  log %s" % (code, verdict, time.time() - t0, log), flush=True)
    return {"name": name, "exit": code, "verdict": verdict, "wall": round(time.time() - t0, 1), "log": log, "report": report}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--only", default=None, help="comma list of gate names")
    ap.add_argument("--skip", default="", help="comma list of gate names to skip")
    ap.add_argument("--no-node", action="store_true", help="skip the Node selftests")
    ap.add_argument("--negative-controls", action="store_true", help="also run the planted-fault runs (each must exit 1)")
    args = ap.parse_args()
    only = set(x for x in (args.only or "").split(",") if x) or None
    skip = set(x for x in args.skip.split(",") if x)
    stamp = C.stamp()
    logdir = os.path.join(C.REPORTS, "gate_%s" % stamp)
    os.makedirs(logdir, exist_ok=True)
    n, err = C.automated_chromes()
    print("gate: %s | other automated Chromes: %s | logs %s" % (
        ("git " + args.rev) if args.rev else ("working copy (--disk)" if args.disk else args.base), n if err is None else err, logdir), flush=True)
    rows = []
    if not args.no_node and (only is None or "node" in only):
        print("\n=== Node selftests (the SIM only; always the WORKING COPY, even with --rev)", flush=True)
        rows += [dict(r, info=False) for r in node_selftests()]
    for name, script, extra, timeout, info in GATES:
        if (only is not None and name not in only) or name in skip:
            continue
        r = run_gate(name, script, extra, timeout, args, logdir)
        r["info"] = info
        rows.append(r)
    if args.negative_controls:
        for ent in NEGATIVE:
            name, script, extra, timeout = ent[:4]
            want = ent[4] if len(ent) > 4 else 1
            if only is not None and name.split("-")[0] not in only:
                continue
            r = run_gate(name, script, extra, timeout, args, logdir)
            r["negative"] = True
            r["info"] = False
            r["gateExit"] = r["exit"]
            if want == 1:
                # a planted fault must FAIL the gate: exit 1 is the pass here
                r["exit"] = {1: 0, 0: 1}.get(r["exit"], 2)
            else:
                # a blinded measurement must be COULD-NOT-JUDGE: exit 2 is the pass here; a verdict either way is a harness defect
                r["exit"] = 0 if r["exit"] == want else 1
            r["verdict"] = ("planted fault detected (exit %d as required) - " % want if r["exit"] == 0 else
                            "planted fault NOT detected (gate exit %s, wanted %d) - " % (r["gateExit"], want)) + r["verdict"]
            rows.append(r)
    counted = [r for r in rows if not r.get("info")]
    code = 1 if any(r["exit"] == 1 for r in counted) else (2 if any(r["exit"] == 2 for r in counted) or not counted else 0)
    print("\n" + "=" * 110)
    print("LAST CIRCLE GATE TABLE  %s  (%s)" % (time.strftime("%Y-%m-%d %H:%M"), ("git " + args.rev) if args.rev else ("working copy" if args.disk else args.base)))
    for r in rows:
        tag = {0: "PASS", 1: "FAIL", 2: "CNJ "}[r["exit"]] + (" (info)" if r.get("info") else "")
        print("  %-12s %-34s %6.0f s  %s" % (tag, r["name"], r.get("wall", 0), str(r.get("verdict") or " | ".join(r.get("tail") or []))[:150]))
    print("OVERALL: %s" % {0: "PASS", 1: "FAIL", 2: "COULD-NOT-JUDGE (re-run the CNJ gates; never counted as a pass)"}[code])
    out = os.path.join(logdir, "gate_table.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"stamp": stamp, "args": vars(args), "otherChromes": n, "rows": rows, "exit": code}, fh, indent=1)
    print("REPORT %s" % out)
    return code


if __name__ == "__main__":
    sys.exit(main())
