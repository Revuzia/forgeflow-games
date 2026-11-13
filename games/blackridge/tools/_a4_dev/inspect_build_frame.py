# dev helper: load the a4 build script's DEFINITIONS (not its build loop), import a
# base in the build frame, print island table + render side/top views with a ruler.
#   blender -b --factory-startup -noaudio --python inspect_build_frame.py -- warden vesper ...
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
code = open(SRC, encoding="utf-8").read().split("ids = ONLY or list(CFG.keys())")[0]
# the script reads sys.argv for ids; keep ours out of its way
_args = sys.argv[sys.argv.index("--") + 1:]
sys.argv = [sys.argv[0], "--"] + [a for a in _args if a.startswith("-")]
g = {"__file__": os.path.abspath(SRC), "__name__": "a4build"}
exec(compile(code, SRC, "exec"), g)
bpy = g["bpy"]; bmesh = g["bmesh"]; Vector = g["Vector"]; D = math.radians
ids = [a for a in _args if not a.startswith("-")]
OUT = os.path.join(g["GAME"], "_shots", "presentation", "bases")
os.makedirs(OUT, exist_ok=True)

for wid in ids:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cfg = g["CFG"][wid]
    base, muzzle_y, bore_z, right_x, scale = g["import_base"](cfg)
    g["weld_mesh"](base)
    print("INSPECT", wid, "muzzle_y %.4f bore_z %.4f right_x %.4f scale %.4f verts %d" % (
        muzzle_y, bore_z, right_x, scale, len(base.data.vertices)))
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
    isl.sort(reverse=True)
    print("  islands", len(isl))
    for i in isl[:14]:
        print("  ISL n=%4d x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % i)
    bm.free()
    # render side + top with ruler cubes every 0.05 m along y and z
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1600; sc.render.resolution_y = 800
    sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.25, 0.27, 0.3, 1)
    for (loc, e) in [((2, -2, 2), 1500), ((-2, -1, 1), 600)]:
        l = bpy.data.lights.new("l", "AREA"); l.energy = e; l.size = 2
        o = bpy.data.objects.new("l", l); o.location = loc; bpy.context.scene.collection.objects.link(o)
    # ruler: small cubes along y at z = zmin-0.03, every 0.05 (long every 0.1) ; along z at y = ymin-0.03
    import bmesh as _bm
    ys_all = [v.co.y for v in base.data.vertices]; zs_all = [v.co.z for v in base.data.vertices]
    ymin, ymax, zmin, zmax = min(ys_all), max(ys_all), min(zs_all), max(zs_all)
    def tick(x, y, z, s, col):
        bpy.ops.mesh.primitive_cube_add(size=s, location=(x, y, z))
        o = bpy.context.active_object
        m = bpy.data.materials.new("t"); m.diffuse_color = col; o.data.materials.append(m)
    n = int((ymax - ymin) / 0.05) + 2
    for k in range(-8, n):
        y = round(k * 0.05, 3)
        if y < ymin - 0.05 or y > ymax + 0.05: continue
        tick(0.12, y, zmin - 0.04, 0.012 if k % 2 else 0.02, (1, 0.2, 0.2, 1) if k % 2 == 0 else (1, 1, 1, 1))
    for k in range(-12, 12):
        z = round(k * 0.05, 3)
        if z < zmin - 0.05 or z > zmax + 0.05: continue
        tick(0.12, ymin - 0.04, z, 0.012 if k % 2 else 0.02, (0.2, 1, 0.2, 1) if k % 2 == 0 else (1, 1, 1, 1))
    cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"
    co = bpy.data.objects.new("c", cam); bpy.context.scene.collection.objects.link(co)
    sc.camera = co
    cy = (ymin + ymax) / 2; cz = (zmin + zmax) / 2
    cam.ortho_scale = max(ymax - ymin, (zmax - zmin) * 2) * 1.15 + 0.1
    # side view from +X looking -X: build frame +Y forward is screen-right when looking from +X? use rotation
    co.location = (1.0, cy, cz); co.rotation_euler = (D(90), 0, D(90))
    sc.render.filepath = os.path.join(OUT, "bf_%s_side.png" % wid)
    bpy.ops.render.render(write_still=True)
    # top view
    cam.ortho_scale = max(ymax - ymin, 0.4) * 1.15
    co.location = (0, cy, 1.0); co.rotation_euler = (0, 0, D(-90))
    sc.render.filepath = os.path.join(OUT, "bf_%s_top.png" % wid)
    bpy.ops.render.render(write_still=True)
