#!/usr/bin/env python
"""Run perfcheck.py only in QUIET windows on a shared box: waits until no OTHER automated Chrome
(a chrome browser process with --remote-debugging-pipe / --enable-automation and no --type=) has been
alive for --quiet seconds, runs perfcheck, and polls during the run; a run during which a foreign
automated Chrome appeared is labelled CONTAMINATED and does not count. Collects --n clean runs.

    python _harness/scratch/final/perfalone.py --n 5 [--zoom max] [--budget 2400]
"""
import argparse, os, re, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PS = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='chrome-headless-shell.exe'\" | "
      "Where-Object { $_.CommandLine -notlike '*--type=*' -and ($_.CommandLine -like '*--remote-debugging-pipe*' -or "
      "$_.CommandLine -like '*--enable-automation*') } | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }")


def autochromes():
    out = subprocess.run(["powershell", "-NoProfile", "-Command", PS], capture_output=True, text=True).stdout
    return {int(l.split()[0]) for l in out.split("\n") if l.strip()}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--zoom", default="auto")
    ap.add_argument("--quiet", type=float, default=12)
    ap.add_argument("--budget", type=float, default=2400)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    t_end = time.time() + a.budget
    clean, tries = [], 0
    while len(clean) < a.n and time.time() < t_end:
        q0 = None
        while time.time() < t_end:
            if autochromes():
                q0 = None
            elif q0 is None:
                q0 = time.time()
            elif time.time() - q0 >= a.quiet:
                break
            time.sleep(2)
        if time.time() >= t_end:
            break
        tries += 1
        before = autochromes()          # ours not started yet → should be empty
        seen, stop = set(), [False]
        def watch():
            while not stop[0]:
                seen.update(autochromes()); time.sleep(1.5)
        th = threading.Thread(target=watch, daemon=True)
        log = os.path.join(a.out, "%s_try%d.txt" % (a.zoom, tries))
        with open(log, "w", encoding="utf-8") as fh:
            p = subprocess.Popen([sys.executable, os.path.join(ROOT, "_harness", "perfcheck.py"), "--no-serve", "--zoom", a.zoom],
                                 cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT)
            time.sleep(4)               # let OUR chrome start, then any NEW pid beyond ours is foreign
            ours = autochromes() - before
            th.start()
            rc = p.wait()
        stop[0] = True; th.join()
        foreign = seen - ours - before
        txt = open(log, encoding="utf-8").read()
        m = re.search(r"frames\s*:.*", txt); v = re.search(r"PERF GATE.*", txt); z = re.search(r"camera\s*:.*", txt)
        tag = "CONTAMINATED %s" % sorted(foreign) if foreign else "clean"
        print("try %d (%s) rc=%d %s :: %s :: %s%s" % (tries, a.zoom, rc, tag, m.group(0) if m else "?", v.group(0) if v else "",
              (" :: " + z.group(0)[:160]) if z else ""), flush=True)
        if not foreign:
            clean.append(rc)
    print("CLEAN RUNS %d/%d wanted · pass %d · fail %d · tries %d" % (len(clean), a.n, clean.count(0), len(clean) - clean.count(0), tries))


if __name__ == "__main__":
    main()
