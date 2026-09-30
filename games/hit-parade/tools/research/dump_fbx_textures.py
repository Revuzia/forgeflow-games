# HIT PARADE research: dump the embedded textures of one FBX to PNG files for inspection.
# Usage: blender.exe --background --factory-startup --python dump_fbx_textures.py -- <file.fbx> <out_dir>
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
seen = set()
for img in bpy.data.images:
    if img.type != "IMAGE":
        continue
    key = os.path.basename(img.filepath.replace("\\", "/")).lower() or img.name
    if key in seen:
        continue
    seen.add(key)
    name = os.path.splitext(key)[0]
    dst = os.path.join(out, name + ".png")
    try:
        img.filepath_raw = dst
        img.file_format = "PNG"
        img.save()
        print("[dump]", dst, tuple(img.size))
    except Exception as e:
        print("[dump] FAIL", key, e)
