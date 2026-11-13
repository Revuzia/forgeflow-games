# HIT PARADE research: batch driver for render_mixamo_roster.py.
# Restarts Blender every <=10 files (or ~450 MB of FBX) to keep memory sane; tolerates crashes.
# Usage: python run_roster_batches.py
import os, sys, json, glob, subprocess, time

BLENDER = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
SRC = "F:/games/forgeflow-games-assets/_downloaded/mixamo/characters"
ROOT = "C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade"
SCRIPT = ROOT + "/tools/research/render_mixamo_roster.py"
OUT = ROOT + "/_research/characters/renders"
WORK = ROOT + "/_research/characters/_batches"
LOG = ROOT + "/_research/characters/render_log.txt"
MAX_FILES = 10
MAX_BYTES = 450 * 1024 * 1024

os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)


def done(p):
    stem = os.path.splitext(os.path.basename(p))[0]
    return os.path.isfile(os.path.join(OUT, stem + ".json"))


def run_chunk(idx, files, logf):
    lst = os.path.join(WORK, "chunk_%02d.json" % idx)
    with open(lst, "w", encoding="utf-8") as f:
        json.dump(files, f)
    t0 = time.time()
    cmd = [BLENDER, "--background", "--factory-startup", "--python", SCRIPT, "--", lst, OUT]
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    env["PYTHONIOENCODING"] = "utf-8"
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                       encoding="utf-8", errors="replace", timeout=3600)
    lines = [l for l in p.stdout.splitlines() if "[roster]" in l or "Error" in l or "Traceback" in l]
    msg = "chunk %02d rc=%s %.0fs files=%d\n" % (idx, p.returncode, time.time() - t0, len(files))
    logf.write(msg + "\n".join(lines) + "\n")
    logf.flush()
    print(msg.strip(), flush=True)
    for l in lines:
        print("   ", l[:200], flush=True)


def main():
    files = sorted(glob.glob(SRC + "/*.fbx"))
    todo = [f.replace("\\", "/") for f in files if not done(f)]
    print("total", len(files), "todo", len(todo), flush=True)
    chunks, cur, cb = [], [], 0
    for f in todo:
        sz = os.path.getsize(f)
        if cur and (len(cur) >= MAX_FILES or cb + sz > MAX_BYTES):
            chunks.append(cur); cur, cb = [], 0
        cur.append(f); cb += sz
    if cur:
        chunks.append(cur)
    with open(LOG, "a", encoding="utf-8") as logf:
        logf.write("=== run %s: %d files in %d chunks\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), len(todo), len(chunks)))
        for i, c in enumerate(chunks):
            run_chunk(i, c, logf)
        # retry anything that neither finished nor logged an error (e.g. Blender crash mid-chunk), one per process
        left = [f for f in todo if not done(f)]
        for j, f in enumerate(left):
            stem = os.path.splitext(os.path.basename(f))[0]
            logf.write("retry single %s\n" % stem)
            run_chunk(100 + j, [f], logf)
        final_left = [os.path.basename(f) for f in files if not done(f)]
        logf.write("unfinished after retries: %s\n" % final_left)
        print("unfinished after retries:", final_left, flush=True)


main()
