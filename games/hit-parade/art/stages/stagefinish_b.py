"""HIT PARADE - finish a lane STAGES-B / STAGES3D-B stage: compress the raw GLB, measure it, fill the fragment, swap, merge.

  python art/stages/stagefinish_b.py rooftop|control_room            finish into the STAGING dir (no merge)
  python art/stages/stagefinish_b.py rooftop|control_room --swap     move the staged GLB + env + fragment into place in
                                                                     one step, then run tools/merge_stages.py
  python art/stages/stagefinish_b.py rooftop|control_room --sheets   2x2 labelled orbit proof sheets (PIL)
  (finish is also called at the end of art/stages/<id>.py inside Blender)

raw     : _harness/scratch/stages_cache/<id>_raw.glb   (art/stages/<id>.py)
staged  : _harness/scratch/stages_cache/out3d/<id>.glb, <id>_env.hdr, <id>.stage.json   (3D ring conversion: the running
          game keeps loading the shipped files until --swap)
shipped : art/gltf/stages/<id>.glb, art/gltf/stages/<id>_env.hdr, art/stages/<id>.stage.json
chain: exactly art/stages/finish_stage.py (TECH_REUSE chain D, lane STAGES P1): gltf-transform optimize --compress
       meshopt --texture-compress webp --texture-size 1024 --prune false --simplify false --flatten false --join false
       --palette false --instance false  (flatten/join would drop the crowd_* empties the view reads, CONTRACT 17.1).
stats: write_stages_json.glb_stats (the same measurement rust_theater's `build` uses) + envBytes.
merge: tools/merge_stages.py (lane STAGES-A / STAGES3D-A) merges every art/stages/*.stage.json into data/stages.json.
Plain Python 3, ASCII only.
"""
import os
import sys
import json
import time
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CACHE = os.path.join(ROOT, "_harness", "scratch", "stages_cache")
OUT3D = os.path.join(CACHE, "out3d")
GLTF = os.path.join(ROOT, "art", "gltf", "stages")
REP = os.path.join(ROOT, "_harness", "_reports", "stages")
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


def _paths(sid, staged):
    frag = json.load(open(os.path.join(OUT3D if staged else HERE, sid + ".stage.json"), encoding="utf-8"))
    env = frag.get("environment", {}).get("hdr")
    base = OUT3D if staged else GLTF
    return {
        "glb": os.path.join(base, frag.get("glb", sid + ".glb")),
        "env": os.path.join(base, env) if env else None,
        "frag": os.path.join(OUT3D if staged else HERE, sid + ".stage.json"),
    }, frag


def finish(sid, merge=False, staged=True):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raw = os.path.join(CACHE, sid + "_raw.glb")
    P, frag = _paths(sid, staged)
    out = P["glb"]
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
    st = glb_stats(out)
    envp = P["env"]
    if staged and envp and not os.path.exists(envp):
        envp = os.path.join(GLTF, os.path.basename(envp))       # this build did not rewrite the env: the shipped one
    st["envBytes"] = os.path.getsize(envp) if envp and os.path.exists(envp) else None
    st["totalBytes"] = st["bytes"] + (st["envBytes"] or 0)
    old = frag.get("build") or {}
    if "clearance" in old:                      # measured in Blender (CONTRACT 35.11.5), kept with the GLB stats
        st["clearance"] = old["clearance"]
    frag["build"] = st
    with open(P["frag"], "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(frag, indent=2) + "\n")
    print("measured", json.dumps(st), flush=True)
    budget_ok = st["totalBytes"] <= 6000000 and st["draws"] <= 150
    print("budget", "OK" if budget_ok else "OVER", "(<= 6,000,000 B incl. env, <= 150 draws)", flush=True)
    if merge:
        run_merge()
    return st


def run_merge():
    mp = os.path.join(ROOT, "tools", "merge_stages.py")
    if not os.path.exists(mp):
        print("tools/merge_stages.py not present - fragment left for the merge", flush=True)
        return None
    r = subprocess.run([system_python(), mp], capture_output=True, text=True, encoding="utf-8", errors="replace")
    print("merge_stages.py rc=%d" % r.returncode, r.stdout[-3000:], r.stderr[-2000:], flush=True)
    return r.returncode


def _replace(src, dst, tries=20):
    """atomic rename on the same volume; retried while a dev server holds the old file open (Windows sharing)"""
    for k in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError as ex:
            print("  busy (%s), retry %d" % (ex, k + 1), flush=True)
            time.sleep(0.5)
    raise SystemExit("could not replace %s" % dst)


def validate_staged(sid):
    """tools/merge_stages.py validate() (lane STAGES3D-A) on the STAGED fragment + GLB + env before anything moves"""
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import merge_stages as M
    P, frag = _paths(sid, True)
    base = json.load(open(os.path.join(ROOT, "data", "stages.json"), encoding="utf-8"))
    errs, warns = [], []
    M.validate(json.loads(json.dumps(frag)), base.get("budget", {}), errs, warns, glb_dir=OUT3D)
    for w in warns:
        print("WARN  [staged]", w, flush=True)
    for e in errs:
        print("ERROR [staged]", e, flush=True)
    return errs


def swap(sid, merge=True):
    """validate the staged build with merge_stages' rules, then move the staged GLB + env HDR + fragment into art/
    (each an atomic rename), then merge"""
    errs = validate_staged(sid)
    if errs:
        raise SystemExit("staged %s fails merge_stages validation - nothing moved" % sid)
    P, frag = _paths(sid, True)
    moves = [(P["glb"], os.path.join(GLTF, os.path.basename(P["glb"])))]
    if P["env"] and os.path.exists(P["env"]):
        moves.append((P["env"], os.path.join(GLTF, os.path.basename(P["env"]))))
    moves.append((P["frag"], os.path.join(HERE, sid + ".stage.json")))
    for src, dst in moves:
        if not os.path.exists(src):
            raise SystemExit("staged file missing: %s" % src)
    for src, dst in moves:
        print("swap", os.path.relpath(src, ROOT), "->", os.path.relpath(dst, ROOT), os.path.getsize(src), "B", flush=True)
        # keep a copy of the staged file for re-runs of the three.js check (the rename consumes it)
        shutil.copy2(src, src + ".bak")
        _replace(src, dst)
    rc = run_merge() if merge else None
    return rc


def sheets(sid):
    from PIL import Image, ImageDraw, ImageFont
    try:
        fnt = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 22)
    except OSError:
        fnt = ImageFont.load_default()
    degs = [0, 45, 90, 135, 180, 225, 270, 315]
    out = []
    for tag, dist in (("near", 4.4), ("far", 8.0)):
        ids = ["orbit_%03d_%s" % (a, tag[0]) for a in degs]
        for k in range(2):
            part = list(zip(degs[4 * k:4 * k + 4], ids[4 * k:4 * k + 4]))
            cw, ch = 960, 540
            im = Image.new("RGB", (cw * 2, ch * 2), (0, 0, 0))
            d = ImageDraw.Draw(im)
            n = 0
            for i, (a, s) in enumerate(part):
                p = os.path.join(REP, "%s_%s.png" % (sid, s))
                if not os.path.exists(p):
                    continue
                t = Image.open(p).convert("RGB").resize((cw, ch), Image.LANCZOS)
                x, y = (i % 2) * cw, (i // 2) * ch
                im.paste(t, (x, y))
                d.rectangle((x, y, x + 330, y + 30), fill=(0, 0, 0))
                d.text((x + 6, y + 4), "%s yaw %d  %.1f m" % (s, a, dist), fill=(255, 255, 0), font=fnt)
                n += 1
            if n:
                op = os.path.join(REP, "%s_orbit_%s_%d.png" % (sid, tag, k))
                im.save(op)
                out.append(op)
                print("sheet", op, n, "shots", flush=True)
    return out


if __name__ == "__main__":
    sid = sys.argv[1] if len(sys.argv) > 1 else "rooftop"
    if "--sheets" in sys.argv:
        sheets(sid)
    elif "--swap" in sys.argv:
        rc = swap(sid, merge="--no-merge" not in sys.argv)
        sys.exit(rc or 0)
    else:
        finish(sid, merge="--merge" in sys.argv, staged="--shipped" not in sys.argv)
