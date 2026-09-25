#!/usr/bin/env python
"""G3: run perfcheck only in GPU-quiet windows on a shared box.

perfalone.py waits for every foreign automated Chrome to EXIT; the playwright-mcp Chrome of another
session can stay open for hours. This variant measures what actually contends: the GPU 3D-engine
utilisation of every chrome.exe process that existed BEFORE our run (foreign), plus total CPU load.
Quiet = foreign chrome 3D util < --gpu-max % and CPU load < --cpu-max % for --quiet seconds.
During the run it keeps sampling the same foreign pids; a run whose mean foreign 3D util exceeded
--gpu-max (or whose peak exceeded 3x it) is CONTAMINATED and does not count. Collects --n clean runs.

    python _harness/scratch/g3/perfquiet.py --n 5 --out _harness/scratch/g3/perf_a --extra "--v2"
"""
import argparse
import os
import re
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

PS_SAMPLE = r"""
$pids = @(Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$c = Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -ErrorAction SilentlyContinue
$by = @{}
foreach ($s in $c.CounterSamples) { if ($s.InstanceName -match '^pid_(\d+)_') { $p = [int]$Matches[1]; $by[$p] = ($by[$p] + $s.CookedValue) } }
$load = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
"LOAD $load"
foreach ($p in $pids) { $v = 0; if ($by.ContainsKey($p)) { $v = $by[$p] }; "P $p $([math]::Round($v,2))" }
"""


def sample():
    out = subprocess.run(["powershell", "-NoProfile", "-Command", PS_SAMPLE], capture_output=True, text=True).stdout
    load, util = None, {}
    for ln in out.splitlines():
        parts = ln.split()
        if len(parts) == 2 and parts[0] == "LOAD":
            try:
                load = float(parts[1])
            except ValueError:
                pass
        elif len(parts) == 3 and parts[0] == "P":
            util[int(parts[1])] = float(parts[2])
    return load, util


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--quiet", type=float, default=20)
    ap.add_argument("--gpu-max", type=float, default=3.0)
    ap.add_argument("--cpu-max", type=float, default=35.0)
    ap.add_argument("--budget", type=float, default=14400)
    ap.add_argument("--max-tries", type=int, default=12)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="http://localhost:5178/")
    ap.add_argument("--extra", default="", help="extra perfcheck args, space-separated")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    t_end = time.time() + a.budget
    clean, tries = [], 0
    last_note = 0
    while len(clean) < a.n and time.time() < t_end and tries < a.max_tries:
        q0 = None
        while time.time() < t_end:
            load, util = sample()
            fg = sum(util.values())
            quiet = fg < a.gpu_max and (load is None or load < a.cpu_max)
            if not quiet:
                q0 = None
                if time.time() - last_note > 300:
                    top = sorted(util.items(), key=lambda kv: -kv[1])[:2]
                    print("%s waiting: foreign chrome 3D %.1f %% (top %s) · cpu %s %%" % (
                        time.strftime("%H:%M:%S"), fg, top, load), flush=True)
                    last_note = time.time()
            elif q0 is None:
                q0 = time.time()
            elif time.time() - q0 >= a.quiet:
                break
            time.sleep(2)
        if time.time() >= t_end:
            break
        tries += 1
        _, util0 = sample()
        foreign = set(util0)
        series = []
        stop = [False]

        def watch():
            while not stop[0]:
                _l, u = sample()
                series.append((sum(v for p, v in u.items() if p in foreign), _l))
                time.sleep(1.0)

        th = threading.Thread(target=watch, daemon=True)
        tag_extra = re.sub(r"[^a-z0-9]+", "_", a.extra.lower()).strip("_") or "base"
        log = os.path.join(a.out, "%s_try%d.txt" % (tag_extra, tries))
        with open(log, "w", encoding="utf-8") as fh:
            cmd = [sys.executable, os.path.join(ROOT, "_harness", "perfcheck.py"), "--no-serve", "--base", a.base,
                   "--report-dir", a.out, "--shot", os.path.join(a.out, "%s_try%d.png" % (tag_extra, tries))]
            if a.extra:
                cmd += a.extra.split()
            th.start()
            p = subprocess.Popen(cmd, cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT)
            rc = p.wait()
        stop[0] = True
        th.join()
        gs = [g for g, _ in series]
        ls = [l for _, l in series if isinstance(l, (int, float))]
        gmean = sum(gs) / len(gs) if gs else 0.0
        gmax = max(gs) if gs else 0.0
        contaminated = gmean > a.gpu_max or gmax > 3 * a.gpu_max
        txt = open(log, encoding="utf-8").read()
        m = re.search(r"frames\s*:.*", txt)
        v = re.search(r"PERF GATE.*", txt)
        u = re.search(r"UPROAR\s*:.*", txt)
        r = re.search(r"renderer\s*:.*", txt)
        tag = ("CONTAMINATED" if contaminated else "clean") + " (foreign chrome 3D mean %.1f %% max %.1f %% · cpu mean %.0f %%)" % (
            gmean, gmax, (sum(ls) / len(ls)) if ls else -1)
        print("try %d rc=%d %s :: %s :: %s%s :: %s" % (tries, rc, tag, m.group(0) if m else "?",
                                                   (u.group(0) + " :: ") if u else "", r.group(0)[:90] if r else "",
                                                   v.group(0) if v else ""), flush=True)
        if not contaminated:
            clean.append(rc)
    print("CLEAN RUNS %d/%d wanted · pass %d · fail %d · tries %d" % (
        len(clean), a.n, clean.count(0), len(clean) - clean.count(0), tries), flush=True)


if __name__ == "__main__":
    main()
