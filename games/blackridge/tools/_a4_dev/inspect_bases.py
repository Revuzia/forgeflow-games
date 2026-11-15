import bpy, math, os, sys, bmesh
from mathutils import Vector
SRC = r"C:\Users\TestRun\Claude Claw\forgeflow-games\games\last-circle\assets\props\meshy_wpn"
OUT = r"C:\Users\TestRun\Claude Claw\forgeflow-games\games\blackridge\_shots\presentation\bases"
os.makedirs(OUT, exist_ok=True)
D = math.radians
names = sys.argv[sys.argv.index("--")+1:]
for nm in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, nm + ".glb"))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mo = max(meshes, key=lambda o: len(o.data.vertices))
    bm = bmesh.new(); bm.from_mesh(mo.data)
    bm.verts.ensure_lookup_table()
    seen = set(); isl = []
    for v in bm.verts:
        if v.index in seen: continue
        stack=[v]; comp=[]; seen.add(v.index)
        while stack:
            a=stack.pop(); comp.append(a)
            for e in a.link_edges:
                b=e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index); stack.append(b)
        xs=[c.co.x for c in comp]; ys=[c.co.y for c in comp]; zs=[c.co.z for c in comp]
        isl.append((len(comp), (min(xs),max(xs)), (min(ys),max(ys)), (min(zs),max(zs))))
    isl.sort(reverse=True)
    print("INSPECT", nm, "meshes", len(meshes), "verts", len(mo.data.vertices), "faces", len(mo.data.polygons), "islands", len(isl))
    for i in isl[:12]:
        print("  ISL", i[0], "x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (i[1][0],i[1][1],i[2][0],i[2][1],i[3][0],i[3][1]))
    bm.free()
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1200; sc.render.resolution_y = 700
    sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.2,0.22,0.26,1)
    for (loc,e) in [((2,-2,2),500),((-2,-1,1),200)]:
        l = bpy.data.lights.new("l","AREA"); l.energy=e*3; l.size=2
        o = bpy.data.objects.new("l", l); o.location=loc; bpy.context.scene.collection.objects.link(o)
    allv=[mo.matrix_world @ v.co for v in mo.data.vertices]
    mn=Vector((min(v.x for v in allv),min(v.y for v in allv),min(v.z for v in allv)))
    mx=Vector((max(v.x for v in allv),max(v.y for v in allv),max(v.z for v in allv)))
    c=(mn+mx)/2; ext=(mx-mn)
    print("  BBOX", [round(x,3) for x in mn], [round(x,3) for x in mx])
    cam = bpy.data.cameras.new("c"); cam.angle = D(40)
    co = bpy.data.objects.new("c", cam); bpy.context.scene.collection.objects.link(co)
    sc.camera = co
    L = max(ext)*1.6
    for tag, d, rot in [("side", Vector((0,-L,0)), (D(90),0,0)), ("top", Vector((0,0,L)), (0,0,0)), ("tq", Vector((L*0.6,-L*0.7,L*0.4)), None)]:
        co.location = c + d
        if rot is None:
            direction = (c - co.location); co.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()
        else:
            co.rotation_euler = rot
        sc.render.filepath = os.path.join(OUT, f"base_{nm}_{tag}.png")
        bpy.ops.render.render(write_still=True)
