#!/usr/bin/env python
"""hg_cpu - the housegen.selftest CPU row, paired with a pinned reference build (Wave 10 R1A fix12, orchestrator ruling R-d, 2026-11-17).
NODE ONLY: no browser, no server, no file of the tree edited.

    python _harness/p23/hg_cpu.py                      # the working copy vs the reference 04e82d802: 3 rounds of ref, head, ref (9 selftest runs, ~15 min)
    python _harness/p23/hg_cpu.py --plant slow-gen     # planted fault: the head's selftest generates every house twice (HG_PLANT_REGEN=1): exit 1 = caught

Why: the selftest's CPU row (<= 36 ms of JS-thread CPU a generated + checked house, 4,860 houses, one worker per physical core) was set when the
reference build read 25.8-27.3 ms. On today's box (8 workers on 8 cores, memory-bound, other lanes running) that same reference reads 38+ ms, so the
absolute reading measures the box, not the generator. The bar stays 36 ms; the house set, the worker count and every check stay as they are.

Measurement: the SAME selftest run (runtime/3d/royale/housegen.selftest.cjs, its own 'selftest CPU' reading) on the reference tree (git archive of
REF_REV into a cache dir: reproducible in any checkout of the repo, F:/lcwt/int included) and on the head, interleaved ref, head, ref per round, same
HG_WORKERS, same houses. The head runs with HG_CPU_ROW=wrapper: the selftest prints its CPU reading as info and this script judges it; the head's
other selftest checks still gate here (row 'checks').

Rows:
  cpu       PASS if median(head) <= 36 ms (and >= 75 % of the JS-thread CPU on the workers in every head run). If that is red, PASS only when BOTH
            (a) median(ref) > 27.3 ms (the box is inflating the reading) and (b) median(head) <= 36 x median(ref) / 27.3 (<= 1.32 x the reference:
            the headroom the 36 ms bar gave over the reading it was set against). Otherwise FAIL. The reference not built / not run / no
            reading, a house-count or worker-count mismatch, or the control out of range: COULD-NOT-JUDGE, never a pass.
  control   the reference against itself, in the same window: median of each round's ref run after the head / median of the one before it,
            inside 0.93-1.07 (the pairing is fair), else the cpu row is COULD-NOT-JUDGE when it needs the paired branch.
  checks    every head run's other selftest checks pass (0 failed).
Plant slow-gen (gate.py NEGATIVE, MUST exit 1): the head generates every house twice (>= 40 % more CPU) -> the cpu row must fail through BOTH the
absolute branch and the ratio branch (b) (the row passes, = plant NOT caught, if either branch passes); under the plant only the cpu row counts.
Every reading prints with the box load before / after it (Win32_Processor LoadPercentage), the ratio and the branch that decided.
"""
from __future__ import annotations

import argparse
import os
import re
import statistics
import subprocess
import sys
import tarfile
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import p23lib as L  # noqa: E402

GATE = "p23_hg_cpu"
REF_REV = "04e82d802"            # the pinned reference build (read 25.8-27.3 ms when the 36 ms bar was set, 2026-10-27; NEVER moves)
BAR_MS = 36.0                    # the selftest's HG_CPU_MS_PER_HOUSE (never lowered)
REF_AT_BAR_MS = 27.3             # the top of the reference's reading when the bar was set
RATIO_MAX = BAR_MS / REF_AT_BAR_MS   # 1.3187
CTRL_LO, CTRL_HI = 0.93, 1.07
SHARE_MIN = 75
SELFTEST = os.path.join("runtime", "3d", "royale", "housegen.selftest.cjs")
PLANTS = {"slow-gen": "the head's selftest generates every house twice (HG_PLANT_REGEN=1): the cpu row must FAIL through the absolute AND the ratio branch"}
RUN_TIMEOUT = 1500


def box_load():
    try:
        p = subprocess.run(["powershell", "-NoProfile", "-Command",
                            "[int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"],
                           capture_output=True, text=True, timeout=60)
        return int(p.stdout.strip())
    except Exception:
        return None


def ref_tree(rev):
    """git archive of games/last-circle at `rev` into a cache dir (keyed by the full sha; .complete marks a finished extract)"""
    sha = subprocess.run(["git", "-C", C.REPO, "rev-parse", rev + "^{commit}"], capture_output=True, text=True).stdout.strip()
    if not sha:
        raise C.EnvFailure("reference %s: unknown git revision in %s" % (rev, C.REPO))
    dst = os.path.join(tempfile.gettempdir(), "lc_p23_hgref", sha)
    mark = os.path.join(dst, ".complete")
    if not os.path.exists(mark):
        os.makedirs(dst, exist_ok=True)
        tar = dst + ".tar"
        p = subprocess.run(["git", "-C", C.REPO, "archive", "--format=tar", "-o", tar, sha, "games/last-circle"], capture_output=True)
        if p.returncode != 0:
            raise C.EnvFailure("reference %s: git archive failed: %s" % (rev, p.stderr.decode("utf-8", "replace")[:300]))
        with tarfile.open(tar) as tf:
            for m in tf.getmembers():
                if not m.isfile() or not m.name.startswith("games/last-circle/"):
                    continue
                out = os.path.join(dst, m.name[len("games/last-circle/"):].replace("/", os.sep))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "wb") as fh:
                    fh.write(tf.extractfile(m).read())
        os.remove(tar)
        with open(mark, "w") as fh:
            fh.write(sha)
    if not os.path.isfile(os.path.join(dst, SELFTEST)):
        raise C.EnvFailure("reference %s: no %s in the archive" % (rev, SELFTEST))
    return dst, sha[:9]


RX_CPU = re.compile(r"selftest CPU ([\d.]+) ms a house on the JS threads \(<= [\d.]+ ms: ([\d.]+) s for (\d+) houses\), (\d+) % of the JS")
RX_NW = re.compile(r"s on the (\d+) workers")
RX_SUM = re.compile(r"^(PASS|FAIL)  (\d+) passed, (\d+) failed", re.M)


def run_selftest(root, env_extra, tag, nw):
    env = {k: v for k, v in os.environ.items() if not k.startswith("HG_")}
    env.update({"HG_WORKERS": str(nw), "PYTHONIOENCODING": "utf-8"})
    env.update(env_extra)
    l0 = box_load()
    t0 = time.time()
    try:
        p = subprocess.run(["node", os.path.join(root, SELFTEST)], cwd=root, env=env, capture_output=True, timeout=RUN_TIMEOUT,
                           encoding="utf-8", errors="replace")
        out, rc = (p.stdout or "") + "\n" + (p.stderr or ""), p.returncode
    except subprocess.TimeoutExpired:
        out, rc = "timeout after %d s" % RUN_TIMEOUT, None
    secs = time.time() - t0
    l1 = box_load()
    m, n, s = RX_CPU.search(out), RX_NW.search(out), RX_SUM.search(out)
    r = {"tag": tag, "rc": rc, "wall_s": round(secs, 1), "load": [l0, l1],
         "ms": float(m.group(1)) if m else None, "cpu_s": float(m.group(2)) if m else None, "houses": int(m.group(3)) if m else None,
         "share": int(m.group(4)) if m else None, "workers": int(n.group(1)) if n else None,
         "passed": int(s.group(2)) if s else None, "failed": int(s.group(3)) if s else None,
         "fails": [x.strip() for x in out.splitlines() if x.strip().startswith("FAIL  ") and "selftest CPU" not in x][:4]}
    if r["ms"] is None:
        r["tail"] = out[-600:]
    print("  READ %-6s %s ms a house (%s houses, %s workers, %s %% on the workers, %s s CPU)  wall %.0f s  load %s/%s  rc %s  checks %s passed / %s failed"
          % (tag, r["ms"], r["houses"], r["workers"], r["share"], r["cpu_s"], secs, l0, l1, rc, r["passed"], r["failed"]), flush=True)
    return r


def fmt(x, nd=1):
    return ("%%.%df" % nd) % x if x is not None else "n/a"


def main_fn(v, args):
    nw = args.workers or max(1, min(8, (os.cpu_count() or 2) // 2))       # the selftest's own default: one worker per physical core
    head_root = C.ROOT
    head_env = {"HG_CPU_ROW": "wrapper"}
    if args.plant == "slow-gen":
        head_env["HG_PLANT_REGEN"] = "1"
        v.note("plant slow-gen: %s" % PLANTS["slow-gen"])
    ref_root, ref_sha = ref_tree(REF_REV)
    v.data.update({"ref": ref_sha, "ref_root": ref_root, "head_root": head_root, "workers": nw, "rounds": args.rounds})
    print("p23_hg_cpu: reference %s (%s), head %s, %d workers, %d rounds of ref, head, ref" % (ref_sha, ref_root, head_root, nw, args.rounds), flush=True)
    runs = []
    for k in range(1, args.rounds + 1):
        runs.append(dict(run_selftest(ref_root, {}, "refA%d" % k, nw), side="refA"))
        runs.append(dict(run_selftest(head_root, head_env, "head%d" % k, nw), side="head"))
        runs.append(dict(run_selftest(ref_root, {}, "refB%d" % k, nw), side="refB"))
    v.data["runs"] = runs
    H = [r for r in runs if r["side"] == "head"]
    R = [r for r in runs if r["side"] != "head"]
    RA, RB = [r for r in R if r["side"] == "refA"], [r for r in R if r["side"] == "refB"]
    hm = [r["ms"] for r in H if r["ms"] is not None]
    # ---- the head's other checks (the same runs)
    bad = [r for r in H if r["failed"] is None or r["failed"] > 0]
    cname = "checks: every other housegen.selftest check passes in each head run (%s)" % ", ".join("%s %s/%s" % (r["tag"], r["passed"], r["failed"]) for r in H)
    cdet = "; ".join("%s: %s" % (r["tag"], " | ".join(r["fails"]) or r.get("tail", "")[-200:]) for r in bad)
    if args.plant:
        v.info(cname, cdet)
    else:
        v.check(cname, not bad and len(H) == args.rounds, cdet)
    name = "cpu: housegen selftest <= %.0f ms a house absolute, else <= %.3f x the reference %s when the reference reads > %.1f ms" % (BAR_MS, RATIO_MAX, ref_sha, REF_AT_BAR_MS)
    if len(hm) != len(H):
        v.cnj(name, "a head run gave no CPU reading: " + "; ".join(r.get("tail", "")[-300:] for r in H if r["ms"] is None))
        return
    hmed = statistics.median(hm)
    share_ok = all(r["share"] is not None and r["share"] >= SHARE_MIN for r in H)
    abs_ok = hmed <= BAR_MS and share_ok
    rm = [r["ms"] for r in R if r["ms"] is not None]
    ref_ok = len(rm) == len(R) and all(r["houses"] == H[0]["houses"] and r["workers"] == nw for r in runs)
    rmed = statistics.median(rm) if rm else None
    ratio = hmed / rmed if rmed else None
    ctrl = (statistics.median([r["ms"] for r in RB]) / statistics.median([r["ms"] for r in RA])) if ref_ok else None
    ctrl_ok = ctrl is not None and CTRL_LO <= ctrl <= CTRL_HI
    a_ok = rmed is not None and rmed > REF_AT_BAR_MS
    b_ok = ratio is not None and ratio <= RATIO_MAX
    summ = ("head %s -> median %.1f ms (share min %s %%); ref %s -> median %s ms; ratio %s (<= %.3f); control refB/refA %s (%.2f-%.2f); loads %s"
            % ([r["ms"] for r in H], hmed, min((r["share"] or 0) for r in H), [r["ms"] for r in R], fmt(rmed),
               fmt(ratio, 3), RATIO_MAX, fmt(ctrl, 3), CTRL_LO, CTRL_HI,
               " ".join("%s:%s/%s" % (r["tag"], r["load"][0], r["load"][1]) for r in runs)))
    v.data.update({"head_med": hmed, "ref_med": rmed, "ratio": ratio, "control": ctrl, "abs_ok": abs_ok, "a_ok": a_ok, "b_ok": b_ok, "ctrl_ok": ctrl_ok})
    v.info("control: the reference against itself (refB / refA) %s, fair inside %.2f-%.2f: %s" % (fmt(ctrl, 3), CTRL_LO, CTRL_HI, "yes" if ctrl_ok else "NO"))
    v.info("absolute branch: median(head) %.1f <= %.0f ms and share >= %d %%: %s" % (hmed, BAR_MS, SHARE_MIN, "PASS" if abs_ok else "red"))
    v.info("paired branch: (a) median(ref) %s > %.1f: %s; (b) ratio %s <= %.3f: %s" % (fmt(rmed), REF_AT_BAR_MS, a_ok, fmt(ratio, 3), RATIO_MAX, b_ok))
    if args.plant:
        if not ref_ok or not ctrl_ok:
            v.cnj(name, "plant run not judgeable (reference / control): " + summ)
        else:
            dec = "absolute PASS (plant slipped)" if abs_ok else ("ratio PASS (plant slipped)" if b_ok else "absolute red AND ratio red (caught by both)")
            v.check(name, abs_ok or (b_ok and share_ok), "decided by: %s; %s" % (dec, summ))
        return
    if abs_ok:
        v.check(name, True, "decided by: absolute (median %.1f <= %.0f ms); %s" % (hmed, BAR_MS, summ))
    elif not ref_ok:
        v.cnj(name, "absolute red and the reference gave no comparable reading (houses / workers / missing): " + summ)
    elif not ctrl_ok:
        v.cnj(name, "absolute red and the control is out of range (the pairing is not fair in this window): " + summ)
    else:
        v.check(name, a_ok and b_ok and share_ok, "decided by: paired (absolute red; (a) %s, (b) %s); %s" % (a_ok, b_ok, summ))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, PLANTS.keys())
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--workers", type=int, default=0, help="HG_WORKERS for every run (default: the selftest's own, one per physical core)")
    args = L.parse(ap)
    if args.rounds < 1:
        ap.error("--rounds >= 1")
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
