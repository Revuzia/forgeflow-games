# HIT PARADE research: report which mesh uses each untextured material, and its base colour.
# Usage: blender.exe --background --factory-startup --python probe_untextured_materials.py -- <fbx> [<fbx> ...]
import bpy, sys
files = sys.argv[sys.argv.index("--") + 1:]
for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=f)
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        for s in o.material_slots:
            m = s.material
            if m is None or not m.node_tree:
                continue
            if any(n.type == "TEX_IMAGE" for n in m.node_tree.nodes):
                continue
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            col = tuple(round(x, 3) for x in b.inputs["Base Color"].default_value) if b else None
            alpha = round(b.inputs["Alpha"].default_value, 3) if b else None
            print("[untex]", f.split("/")[-1], "mesh=", o.name, "verts=", len(o.data.vertices), "mat=", m.name, "base=", col, "alpha=", alpha)
