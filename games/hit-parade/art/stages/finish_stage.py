"""HIT PARADE - compress a Blender-exported stage GLB (TECH_REUSE chain D) and record its stats (lane STAGES).

  python art/stages/finish_stage.py rust_theater

raw  : _harness/scratch/stages_cache/<id>_raw.glb   (from art/stages/<id>.py)
out  : art/gltf/stages/<id>.glb
chain: gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024
       --prune false --flatten false --join false
                            keep the crowd_* empties (VIEW reads them, CONTRACT 17.1). Measured: with either
                            flatten or join left on, optimize drops all 190 empty nodes even with --prune false.
                            The Blender build already joins the set into one mesh (1 primitive per material).
       --simplify false     authored geometry, flat walls and alpha cards: no decimation
       --palette false --instance false   (no effect without join; nothing repeats after the Blender join)
Then updates data/stages.json build stats (write_stages_json.py --measure). ASCII only.
"""
import os
import sys
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sid = sys.argv[1] if len(sys.argv) > 1 else "rust_theater"
    raw = os.path.join(ROOT, "_harness", "scratch", "stages_cache", sid + "_raw.glb")
    out = os.path.join(ROOT, "art", "gltf", "stages", sid + ".glb")
    gt = shutil.which("gltf-transform")
    if not gt:
        raise SystemExit("gltf-transform not on PATH (npm i -g @gltf-transform/cli)")
    cmd = [gt, "optimize", raw, out, "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024",
           "--prune", "false", "--simplify", "false", "--flatten", "false", "--join", "false",
           "--palette", "false", "--instance", "false"]
    print("RUN", " ".join('"%s"' % c if " " in c else c for c in cmd), flush=True)
    r = subprocess.run(cmd, shell=(os.name == "nt"), capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(r.stdout[-4000:])
    if r.returncode != 0:
        print(r.stderr[-4000:])
        raise SystemExit("gltf-transform failed rc=%d" % r.returncode)
    print("raw", os.path.getsize(raw), "->", out, os.path.getsize(out))
    subprocess.run([sys.executable, os.path.join(HERE, "write_stages_json.py"), "--measure"], check=True)


if __name__ == "__main__":
    main()
