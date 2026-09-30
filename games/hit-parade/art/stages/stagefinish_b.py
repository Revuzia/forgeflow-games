"""HIT PARADE - finish a lane STAGES-B stage: compress the raw GLB, measure it, fill the fragment, merge.

  python art/stages/stagefinish_b.py rooftop|control_room [--no-merge]
  (also called at the end of art/stages/<id>.py inside Blender)

raw  : _harness/scratch/stages_cache/<id>_raw.glb   (art/stages/<id>.py)
out  : art/gltf/stages/<id>.glb
chain: exactly art/stages/finish_stage.py (TECH_REUSE chain D, lane STAGES P1): gltf-transform optimize --compress
       meshopt --texture-compress webp --texture-size 1024 --prune false --simplify false --flatten false --join false
       --palette false --instance false  (flatten/join would drop the crowd_* empties the view reads, CONTRACT 17.1).
stats: write_stages_json.glb_stats (the same measurement rust_theater's `build` uses) + envBytes + skyBytes.
fragment: art/stages/<id>.stage.json gets `build` (measured); then tools/merge_stages.py (lane STAGES-A) runs when it
       exists, which merges every art/stages/*.stage.json into data/stages.json. finish_stage.py is not used: it rewrites
       data/stages.json from write_stages_json.py and would drop the other stages. Plain Python 3, ASCII only.
"""
import os
import sys
import json
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True


def system_python():
    """sys.executable is blender.exe when this runs inside Blender"""
    if os.path.basename(sys.executable).lower().startswith("python"):
        return sys.executable
    p = os.environ.get("HP_PYTHON")
    if p and os.path.exists(p):
        return p
    for c in ("python", "python3", "py"):
        w = shutil.which(c)
        if w and "WindowsApps" not in w:
            return w
    raise SystemExit("no system python on PATH (set HP_PYTHON)")


def glb_stats(path):
    import write_stages_json as W
    return W.glb_stats(path)


def finish(sid, merge=True):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raw = os.path.join(ROOT, "_harness", "scratch", "stages_cache", sid + "_raw.glb")
    out = os.path.join(ROOT, "art", "gltf", "stages", sid + ".glb")
    gt = shutil.which("gltf-transform") or shutil.which("gltf-transform.cmd")
    if not gt:
        raise SystemExit("gltf-transform not on PATH (npm i -g @gltf-transform/cli)")
    cmd = [gt, "optimize", raw, out, "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024",
           "--prune", "false", "--simplify", "false", "--flatten", "false", "--join", "false",
           "--palette", "false", "--instance", "false"]
    print("RUN", " ".join('"%s"' % c if " " in c else c for c in cmd), flush=True)
    r = subprocess.run(cmd, shell=(os.name == "nt"), capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(r.stdout[-3000:], flush=True)
    if r.returncode != 0:
        print(r.stderr[-3000:], flush=True)
        raise SystemExit("gltf-transform failed rc=%d" % r.returncode)
    print("raw", os.path.getsize(raw), "->", out, os.path.getsize(out), flush=True)
    frag_p = os.path.join(HERE, sid + ".stage.json")
    frag = json.load(open(frag_p, encoding="utf-8"))
    st = glb_stats(out)
    env = frag.get("environment", {}).get("hdr")
    envp = os.path.join(ROOT, "art", "gltf", "stages", env) if env else None
    st["envBytes"] = os.path.getsize(envp) if envp and os.path.exists(envp) else None
    st["totalBytes"] = st["bytes"] + (st["envBytes"] or 0)
    frag["build"] = st
    with open(frag_p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(frag, indent=2) + "\n")
    print("measured", json.dumps(st), flush=True)
    budget_ok = st["totalBytes"] <= 6000000 and st["draws"] <= 150
    print("budget", "OK" if budget_ok else "OVER", "(<= 6,000,000 B incl. env, <= 150 draws)", flush=True)
    mp = os.path.join(ROOT, "tools", "merge_stages.py")
    if merge and os.path.exists(mp):
        r = subprocess.run([system_python(), mp], capture_output=True, text=True, encoding="utf-8", errors="replace")
        print("merge_stages.py rc=%d" % r.returncode, r.stdout[-2000:], r.stderr[-2000:], flush=True)
    elif merge:
        print("tools/merge_stages.py not present (lane STAGES-A) - fragment left for the merge", flush=True)
    return st


if __name__ == "__main__":
    finish(sys.argv[1] if len(sys.argv) > 1 else "rooftop", merge="--no-merge" not in sys.argv)
