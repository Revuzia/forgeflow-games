"""Build the CRESTBOUND critter kit: runs each creature script in its own headless Blender, collects
the per-asset manifest fragments into assets/models/critters/manifest.json and checks the budgets.

    python build_all.py [names...]          (default: every asset)
"""
import subprocess, sys, os, json, time, glob

BLENDER = r"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(GAME, "assets", "models", "critters")
SCRIPTS = ["gnasher", "gnasher_post", "bumbler", "skitter", "warden", "fen"]
BUDGET = {"critter": 8000, "npc": 8000, "prop": 1500}
TEX_BUDGET_MB = 24


def run(name):
    t0 = time.time()
    cmd = [BLENDER, "--background", "--python", os.path.join(HERE, name + ".py"), "--", OUT]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    keep = [l for l in (p.stdout + p.stderr).splitlines() if l.startswith("[cb]") or "MANIFEST_FRAGMENT" in l or "Traceback" in l or "Error" in l]
    print("\n".join(keep))
    ok = p.returncode == 0 and any("MANIFEST_FRAGMENT" in l for l in keep)
    print("== %s %s in %.0fs" % (name, "OK" if ok else "FAILED rc=%d" % p.returncode, time.time() - t0))
    if not ok:
        tail = (p.stdout + p.stderr).splitlines()[-40:]
        print("\n".join(tail))
    return ok


def collect():
    assets = []
    for fp in sorted(glob.glob(os.path.join(OUT, "*.manifest.json"))):
        with open(fp, encoding="utf-8") as f:
            assets.append(json.load(f))
    tex_bytes = 0
    for fp in glob.glob(os.path.join(OUT, "textures", "*.png")):
        tex_bytes += os.path.getsize(fp)
    glb_bytes = sum(os.path.getsize(os.path.join(OUT, a["file"])) for a in assets if os.path.exists(os.path.join(OUT, a["file"])))
    budgets = []
    for a in assets:
        lim = BUDGET.get(a.get("kind", "critter"), 8000)
        budgets.append({"name": a["name"], "tris": a["tris"], "limit": lim, "ok": a["tris"] <= lim,
                        "atlas_px": a.get("atlas_px"), "atlas_ok": (a.get("atlas_px") or 0) <= 2048})
    man = {
        "kit": "critters",
        "game": "crestbound",
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "generator": "_tools/blender/critters/build_all.py (Blender 5.1.2 headless, bpy only)",
        "conventions": {"up": "+Y", "forward": "+Z", "units": "metres", "pivot": "feet/base at origin",
                        "clips": "NLA tracks -> glTF animations, names EXACT; clip[0] is the loop the runtime should default to",
                        "textures": "baked atlases embedded in each GLB (albedo sRGB, normal OpenGL +Y, ORM = AO/rough/metal); loose copies in textures/"},
        "budgets": {"tris": budgets, "textures_mb": round(tex_bytes / 1e6, 2), "textures_limit_mb": TEX_BUDGET_MB,
                    "textures_ok": tex_bytes <= TEX_BUDGET_MB * 1e6, "glb_mb": round(glb_bytes / 1e6, 2)},
        "assets": [{k: a[k] for k in ("name", "file", "kind", "tris", "bones", "bone_names", "clips", "bounds", "pivot", "forward", "materials",
                                       "textures", "atlas_px", "file_bytes", "states", "turntable", "contact_sheet", "notes") if k in a} for a in assets],
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(man, f, indent=2)
    print(json.dumps(man["budgets"], indent=1))
    return man


if __name__ == "__main__":
    names = sys.argv[1:] or SCRIPTS
    results = {n: run(n) for n in names}
    man = collect()
    print("RESULTS", json.dumps(results))
