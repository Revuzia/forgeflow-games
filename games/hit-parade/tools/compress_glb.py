"""HIT PARADE - fighter GLB compression (lane ASSETS, CONTRACT 6.1, TECH_REUSE section F chain C).

  python tools/compress_glb.py <raw.glb> <out.glb> [--size 1024] [--quality 85] [--qc <qc.glb>]
                               [--no-resample] [--budget-mb 3.0]

Chain (every step is the global @gltf-transform/cli 4.4.2, except step 1):
  1. node tools/glb_post.mjs strip   rotation tracks + Hips translation only, _cutout -> MASK,
                                     drop KHR_materials_specular / extra UV sets
  2. gltf-transform resize --width N --height N      (textures capped at N; chain C, 1024 for heroes)
  3. gltf-transform webp --quality Q
  4. gltf-transform resample          (drops keys a linear interpolation reproduces; three plays
                                       linear/slerp tracks, so the pose at any time is unchanged
                                       within the 1e-4 tolerance)
  -> --qc copy (Blender can import it: no meshopt)
  5. gltf-transform meshopt           (quantize + EXT_meshopt_compression; E48: preferred to Draco)
Prints one JSON line with every intermediate size; exit 1 if the output exceeds --budget-mb.
ASCII only.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = dict(os.environ, PYTHONIOENCODING="utf-8")


def gt():
    exe = shutil.which("gltf-transform") or shutil.which("gltf-transform.cmd")
    if not exe:
        raise SystemExit("gltf-transform CLI not found on PATH")
    return exe


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV)
    if p.returncode != 0:
        sys.stderr.write(p.stdout[-3000:] + "\n" + p.stderr[-3000:] + "\n")
        raise SystemExit("step failed (%d): %s" % (p.returncode, " ".join(cmd)))
    return p.stdout


def compress(raw, out, size=1024, quality=85, qc=None, resample=True):
    tmp = out + ".tmp"
    os.makedirs(tmp, exist_ok=True)
    sizes = {"raw": os.path.getsize(raw)}
    s1 = os.path.join(tmp, "1_strip.glb")
    info = run(["node", os.path.join(HERE, "glb_post.mjs"), "strip", raw, s1]).strip().splitlines()[-1]
    sizes["strip"] = os.path.getsize(s1)
    s2 = os.path.join(tmp, "2_resize.glb")
    run([gt(), "resize", s1, s2, "--width", str(size), "--height", str(size)])
    sizes["resize"] = os.path.getsize(s2)
    s3 = os.path.join(tmp, "3_webp.glb")
    run([gt(), "webp", s2, s3, "--quality", str(quality)])
    sizes["webp"] = os.path.getsize(s3)
    s4 = s3
    if resample:
        s4 = os.path.join(tmp, "4_resample.glb")
        run([gt(), "resample", s3, s4])
        sizes["resample"] = os.path.getsize(s4)
    if qc:
        shutil.copyfile(s4, qc)
    run([gt(), "meshopt", s4, out])
    sizes["meshopt"] = os.path.getsize(out)
    shutil.rmtree(tmp, ignore_errors=True)
    return {"out": out, "sizes": sizes, "strip": json.loads(info)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("out")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--qc", default=None)
    ap.add_argument("--no-resample", action="store_true")
    ap.add_argument("--budget-mb", type=float, default=3.0)
    a = ap.parse_args()
    r = compress(a.raw, a.out, a.size, a.quality, a.qc, not a.no_resample)
    r["budget_mb"] = a.budget_mb
    r["mb"] = round(r["sizes"]["meshopt"] / 1e6, 3)
    r["within_budget"] = r["sizes"]["meshopt"] <= a.budget_mb * 1e6
    print(json.dumps(r))
    sys.exit(0 if r["within_budget"] else 1)


if __name__ == "__main__":
    main()
