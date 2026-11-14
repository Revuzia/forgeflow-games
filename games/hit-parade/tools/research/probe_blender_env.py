import bpy, sys
print("VERSION", bpy.app.version_string)
sc = bpy.context.scene
try:
    sc.render.engine = "NOPE"
except TypeError as e:
    print("ENGINES", e)
print("HAS import_scene.fbx", hasattr(bpy.ops.import_scene, "fbx"))
print("HAS wm.fbx_import", hasattr(bpy.ops.wm, "fbx_import"))
try:
    print("fbx op", bpy.ops.import_scene.fbx.get_rna_type().identifier)
except Exception as e:
    print("import_scene.fbx err", e)
try:
    print("wm fbx op", bpy.ops.wm.fbx_import.get_rna_type().identifier)
except Exception as e:
    print("wm.fbx_import err", e)
vt = [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items]
print("VIEW_TRANSFORMS", vt)
