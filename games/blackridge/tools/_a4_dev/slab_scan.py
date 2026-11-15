# dev helper: z-slab scan of a welded base in the build frame
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
code = open(SRC, encoding="utf-8").read().split("ids = ONLY or list(CFG.keys())")[0]
_args = sys.argv[sys.argv.index("--") + 1:]
sys.argv = [sys.argv[0], "--"] + [a for a in _args if a.startswith("-")]
g = {"__file__": os.path.abspath(SRC), "__name__": "a4build"}
exec(compile(code, SRC, "exec"), g)
bpy = g["bpy"]
ids = [a for a in _args if not a.startswith("-")]
for wid in ids:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cfg = g["CFG"][wid]
    base, muzzle_y, bore_z, right_x, scale = g["import_base"](cfg)
    g["weld_mesh"](base)
    vs = [v.co for v in base.data.vertices]
    zs = [v.z for v in vs]
    zmin, zmax = min(zs), max(zs)
    print("SCAN", wid, "bore_z %.3f muzzle_y %.3f z[%.3f,%.3f]" % (bore_z, muzzle_y, zmin, zmax))
    step = 0.02
    z = zmax
    while z > zmin:
        sel = [v for v in vs if z - step <= v.z < z]
        if sel:
            ys = sorted(v.y for v in sel)
            # histogram of y in 0.02 bins -> contiguous runs
            runs = []
            bins = sorted(set(int(math.floor(v.y / 0.02)) for v in sel))
            start = prev = bins[0]
            for b in bins[1:]:
                if b != prev + 1:
                    runs.append((start * 0.02, (prev + 1) * 0.02)); start = b
                prev = b
            runs.append((start * 0.02, (prev + 1) * 0.02))
            print("  z[%.3f,%.3f] n=%4d x[%.3f,%.3f] runs_y=%s" % (
                z - step, z, len(sel), min(v.x for v in sel), max(v.x for v in sel),
                ["%.2f..%.2f" % r for r in runs]))
        z -= step
