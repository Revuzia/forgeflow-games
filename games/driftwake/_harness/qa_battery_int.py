# -*- coding: utf-8 -*-
"""
qa_battery_int.py -- run the existing gate battery against the INTEGRATED build
(lane INT), one browser at a time, on ONE threaded server (qa_server.py, 8930).

The battery scripts are NOT edited. Each is run from a temporary patched copy
(_harness/_int_tmp_<name>, deleted afterwards) with ENVIRONMENT-ONLY edits,
every one printed before the run:
  - its port / URL -> 8930 (one server for the whole battery, not a fresh
    `python -m http.server` with a 5-deep accept backlog per script — that
    backlog refuses the module burst on this loaded machine, see qa_server.py);
  - its own `python -m http.server` spawn -> a sleeping placeholder process;
  - Playwright boot / navigation timeouts (60 s / 120 s / 180 s) -> 900 s:
    a boot measured at 6+ minutes today must not read as a failure.
Nothing that decides PASS/FAIL is touched. A script's verdict lines and exit
code are copied verbatim into the summary.

    python _harness/qa_battery_int.py                 # the whole battery
    python _harness/qa_battery_int.py qa_tab qa_menu  # a subset, by name
"""
import json
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PORT = 8930
BASE = "http://localhost:%d/games/driftwake/" % PORT
URL = BASE + "index.html"
LOGDIR = Path(sys.argv[sys.argv.index("--logs") + 1]) if "--logs" in sys.argv else HERE
OUT = LOGDIR / "qa_battery_int_out.json"

BATTERY = [
    ("modulecheck", [BASE + "_harness/modulecheck.html"]),
    ("bootcheck", ["--url", URL, "--wait", "900", "--out", str(HERE.parent / "_shots" / "int_bootcheck.png")]),
    ("stepsync", ["--url", URL]),
    ("qa_surfspeed", []),
    ("qa_tab", [URL]),
    ("qa_menu", [URL]),
    ("audit_combat_smoke", [URL]),
    ("qa_directives", []),
    ("qa_enemy_aaa", []),
    ("qa_dart", []),
    ("qa_fxwave", []),
    ("qa_pathfinding", []),
    ("qa_flee", ["--on-only"]),
    ("qa_density", []),
    ("qa_edgefix", []),
    ("qa_boss", []),
    ("qa_bossfix", []),
    ("qa_meshrelease", []),
    ("qa_shrinenet", []),
    ("qa_feelfix", []),
    # The four lane browser proofs (their page libraries now REUSE main.js's
    # systems when SNOWFLOW.meaning exists — see each file's [lane INT] note).
    ("qa_questcore", []),
    ("qa_worldact", ["--stage", "full"]),
    ("qa_rewards", []),
    ("qa_ui", []),
]

VERDICT = re.compile(r"(RESULT|SUMMARY|checks? (passed|PASS)|units PASS|=== .* ===|NOT RUN|Traceback|Error:)", re.I)


def port_open(p):
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect(("127.0.0.1", p))
        return True
    except Exception:
        return False
    finally:
        s.close()


def patch(src):
    """Environment-only edits; returns (text, [what changed])."""
    notes = []
    out = src
    n = 0
    out, k = re.subn(r"localhost:\d{4}", "localhost:%d" % PORT, out)
    n += k
    out, k = re.subn(r"^PORT\s*=\s*\d+", "PORT = %d" % PORT, out, flags=re.M)
    n += k
    if n:
        notes.append("port -> %d (%d sites)" % (PORT, n))
    out, k = re.subn(r"\[sys\.executable,\s*\"-m\",\s*\"http\.server\",\s*[^\]]+\]",
                     "[sys.executable, \"-c\", \"import time; time.sleep(86400)\"]", out)
    if k:
        notes.append("own http.server spawn -> placeholder (%d)" % k)
    out, k = re.subn(r"stop_server\s*=\s*serve\(ROOT,\s*PORT\)", "stop_server = (lambda: None)", out)
    if k:
        notes.append("in-process server -> the shared one (%d)" % k)
    out, k = re.subn(r"timeout\s*=\s*(60_?000|120_?000|180_?000)\b", "timeout=900000", out)
    if k:
        notes.append("boot/navigation timeouts -> 900 s (%d)" % k)
    return out, notes


def run_one(name, args, timeout_s):
    src_path = HERE / (name + ".py")
    tmp = HERE / ("_int_tmp_" + name + ".py")
    text, notes = patch(src_path.read_text(encoding="utf-8"))
    tmp.write_text(text, encoding="utf-8")
    log = LOGDIR / ("battery_" + name + ".log")
    print("\n######## %s %s" % (name, " ".join(args)), flush=True)
    print("  environment edits: " + ("; ".join(notes) if notes else "none"), flush=True)
    t0 = time.time()
    rc = None
    try:
        with open(log, "w", encoding="utf-8") as fh:
            p = subprocess.Popen([sys.executable, "-u", str(tmp)] + args, cwd=str(HERE),
                                 stdout=fh, stderr=subprocess.STDOUT)
            try:
                rc = p.wait(timeout=timeout_s)
            except subprocess.TimeoutExpired:
                p.kill()
                rc = "TIMEOUT(%d s)" % timeout_s
    finally:
        try:
            tmp.unlink()
        except Exception:
            pass
    body = log.read_text(encoding="utf-8", errors="replace").splitlines()
    verdicts = [l for l in body if VERDICT.search(l)][-8:]
    fails = [l for l in body if l.strip().startswith("FAIL")][:12]
    dt = time.time() - t0
    print("  exit %s after %.0f s; log %s" % (rc, dt, log), flush=True)
    for l in verdicts:
        print("  | " + l[:400], flush=True)
    for l in fails:
        print("  ! " + l[:400], flush=True)
    return {"name": name, "args": args, "exit": rc, "wallS": round(dt), "edits": notes,
            "verdicts": verdicts, "fails": fails, "tail": body[-6:], "log": str(log)}


def main():
    argv = sys.argv[1:]
    want = [a for i, a in enumerate(argv) if not a.startswith("--") and not (i > 0 and argv[i - 1] == "--logs")]
    todo = [b for b in BATTERY if not want or b[0] in want]
    srv = None
    if not port_open(PORT):
        srv = subprocess.Popen([sys.executable, str(HERE / "qa_server.py"), str(PORT)], cwd=str(ROOT),
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
    results = []
    try:
        for name, args in todo:
            results.append(run_one(name, args, 3600))
            OUT.write_text(json.dumps(results, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    finally:
        if srv is not None:
            srv.terminate()
    print("\n======== BATTERY SUMMARY (integrated build, port %d)" % PORT)
    for r in results:
        print("%-20s exit=%-14s %s" % (r["name"], r["exit"], (r["verdicts"][-1] if r["verdicts"] else "(no verdict line)")[:160]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
