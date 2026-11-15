# -*- coding: utf-8 -*-
"""Re-run every _play_*.py driver against the CURRENT build, one browser at a time.

Each driver is run with its DEFAULT invocation (no scene arg) plus, when the
driver exposes a phase/scene registry, every registered phase.  stdout+stderr,
exit code and wall time are written to _replayout/<driver>[__<phase>].txt.

    python _replay_runall.py                # everything
    python _replay_runall.py --list         # just enumerate the run plan
    python _replay_runall.py --only rime2   # substring filter
    python _replay_runall.py --timeout 300
"""
import os, re, sys, glob, json, time, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)

REG = re.compile(r"^(?:SCENES|PHASES|STAGES|LEGS|BEATS)\s*=\s*\{(.*?)\}\s*$", re.S | re.M)
KEY = re.compile(r"[\"']([A-Za-z0-9_\-]+)[\"']\s*:")

def phases_of(path):
    src = open(path, encoding="utf-8", errors="replace").read()
    has_main = bool(re.search(r"^if __name__\s*==", src, re.M))
    top_with = bool(re.search(r"^with\s+\w+\(", src, re.M))
    top_call = bool(re.search(r"^[a-z_][A-Za-z0-9_]*\(", src, re.M))
    if not (has_main or top_with or top_call):
        return None                      # pure library / helper module
    names = []
    for m in REG.finditer(src):
        names += KEY.findall(m.group(1))
    names += re.findall(r"^@(?:phase|scene|stage|leg|beat)\(\s*[\"']([A-Za-z0-9_\-]+)[\"']", src, re.M)
    # de-dup, keep order
    seen, ordered = set(), []
    for n in names:
        if n not in seen:
            seen.add(n); ordered.append(n)
    return ordered

def main():
    args = sys.argv[1:]
    only = None
    timeout = 240
    if "--only" in args: only = args[args.index("--only") + 1]
    if "--timeout" in args: timeout = int(args[args.index("--timeout") + 1])
    listing = "--list" in args

    plan = []
    for f in sorted(glob.glob(os.path.join(HERE, "_play_*.py"))):
        b = os.path.basename(f)[:-3]
        if only and only not in b: continue
        ph = phases_of(f)
        if ph is None:
            plan.append((b, None, "LIB"))     # library only -- still import-checked
            continue
        if ph:
            for p in ph: plan.append((b, p, "phase"))
        else:
            plan.append((b, None, "default"))
    # priority: drivers that self-report into _playreports answer defects directly
    def prio(item):
        b = item[0]
        try:
            src = open(os.path.join(HERE, b + ".py"), encoding="utf-8", errors="replace").read()
        except Exception:
            src = ""
        return (0 if "_playreports" in src else 1, b)
    plan.sort(key=prio)

    if listing:
        for b, p, k in plan: print("%-28s %-12s %s" % (b, p or "-", k))
        print("TOTAL RUNS", len([x for x in plan if x[2] != "LIB"]), "libs", len([x for x in plan if x[2]=="LIB"]))
        return

    budget_min = 150.0
    if "--budget-min" in args: budget_min = float(args[args.index("--budget-min") + 1])
    # ---- targeted mechanism probe first: it answers more defects per minute
    COURSES = ["keep","verdant-1","verdant-2","verdant-3","ember-1","ember-2","ember-3",
               "ember-4","rime-1","rime-2","rime-3","azure-1","azure-2","azure-3"]
    for c in COURSES:
        dst = os.path.join(OUT, "probe2_%s.txt" % c)
        if os.path.exists(dst) and os.path.getsize(dst) > 0: continue
        t0 = time.time()
        try:
            r = subprocess.run([sys.executable, "-u", os.path.join(HERE, "_replay_probe2.py"), c],
                               cwd=HERE, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=1500)
            so, se, rc = r.stdout, r.stderr, r.returncode
        except subprocess.TimeoutExpired as e:
            so, se, rc = (e.stdout or ""), (e.stderr or "") + chr(10) + "__TIMEOUT__", -9
        open(dst, "w", encoding="utf-8").write(so + ((chr(10) + "--- STDERR ---" + chr(10) + se) if se else ""))
        print("[probe2] %-11s rc=%-3s %6.1fs" % (c, rc, time.time() - t0), flush=True)

    idx = {}
    t_all = time.time()
    for i, (b, p, kind) in enumerate(plan):
        if budget_min and (time.time() - t_all) / 60.0 > budget_min:
            idx["__budget_stop__"] = {"after": i, "of": len(plan), "min": budget_min}
            print("BUDGET STOP after %d of %d runs" % (i, len(plan)), flush=True)
            break
        if kind == "LIB":
            idx[b] = {"kind": "LIB", "skipped": "library (no playwright entry)"}
            continue
        tag = b + ("__" + p if p else "")
        dst = os.path.join(OUT, tag + ".txt")
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            idx[tag] = json.load(open(dst + ".meta", encoding="utf-8")) if os.path.exists(dst+".meta") else {"kind":"cached"}
            continue
        cmd = [sys.executable, "-u", os.path.join(HERE, b + ".py")] + ([p] if p else [])
        t0 = time.time()
        try:
            r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=timeout)
            rc, so, se = r.returncode, r.stdout, r.stderr
        except subprocess.TimeoutExpired as e:
            rc, so, se = -9, (e.stdout or ""), (e.stderr or "") + "\n__TIMEOUT__ %ds" % timeout
        dt = time.time() - t0
        open(dst, "w", encoding="utf-8").write(so + ("\n--- STDERR ---\n" + se if se else ""))
        meta = {"kind": kind, "rc": rc, "sec": round(dt, 1), "bytes": len(so)}
        json.dump(meta, open(dst + ".meta", "w", encoding="utf-8"))
        idx[tag] = meta
        print("[%3d/%3d] %-34s rc=%-3s %6.1fs %7db  (elapsed %.0fm)" %
              (i + 1, len(plan), tag, rc, dt, len(so), (time.time()-t_all)/60), flush=True)
    json.dump(idx, open(os.path.join(OUT, "_index.json"), "w", encoding="utf-8"), indent=1)
    print("DONE", len(idx))

main()
