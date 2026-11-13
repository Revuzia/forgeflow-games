# dev helper: raw (pre-weld) islands of each base in the BUILD frame, plus the
# weld result, to find separable parts (magazine, forend, bolt...).
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
code = open(SRC, encoding="utf-8").read().split("ids = ONLY or list(CFG.keys())")[0]
_args = sys.argv[sys.argv.index("--") + 1:]
sys.argv = [sys.argv[0], "--"]
g = {"__file__": os.path.abspath(SRC), "__name__": "a4build"}
exec(compile(code, SRC, "exec"), g)
bpy = g["bpy"]; bmesh = g["bmesh"]
for wid in _args:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cfg = g["CFG"][wid]
    base, muzzle_y, bore_z, right_x, scale = g["import_base"](cfg)
    # NO weld: islands as the artist/AI left them
    bm = bmesh.new(); bm.from_mesh(base.data); bm.verts.ensure_lookup_table()
    seen = set(); isl = []
    for v in bm.verts:
        if v.index in seen: continue
        st = [v]; comp = []; seen.add(v.index)
        while st:
            a = st.pop(); comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index); st.append(b)
        xs = [c.co.x for c in comp]; ys = [c.co.y for c in comp]; zs = [c.co.z for c in comp]
        isl.append((len(comp), min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
    print("RAW", wid, "bore_z %.3f muzzle_y %.3f verts %d islands %d" % (bore_z, muzzle_y, len(bm.verts), len(isl)))
    big = [i for i in isl if i[0] >= 25]
    big.sort(key=lambda i: i[5])      # by zmin ascending (lowest parts first)
    for i in big[:22]:
        print("  n=%4d x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % i)
    bm.free()
