# Blender headless HDRI/EXR thumbnailer with measured luminance stats.
# Usage: blender.exe --background --python env_hdri_preview.py -- <list.json> <out_dir>
# list = [{"id": str, "path": str}]. Writes <id>.png (512x256, AgX/Filmic view) + _hdri_stats.json
# ASCII only.
import bpy, sys, os, json
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
items = json.load(open(os.path.abspath(argv[0]), encoding="utf-8"))
OUT = os.path.abspath(argv[1])
os.makedirs(OUT, exist_ok=True)
stats_path = os.path.join(OUT, "_hdri_stats.json")
stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
scene = bpy.context.scene
for vt in ("AgX", "Filmic", "Standard"):
    try:
        scene.view_settings.view_transform = vt
        break
    except Exception:
        continue
scene.render.image_settings.file_format = "PNG"
for it in items:
    iid, p = it["id"], it["path"]
    dst = os.path.join(OUT, iid + ".png")
    if iid in stats and os.path.exists(dst):
        continue
    rec = {"path": p}
    try:
        img = bpy.data.images.load(p)
        w, h = img.size
        rec["size"] = [w, h]
        img.scale(512, 256)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(256, 512, 4)[:, :, :3]
        lum = 0.2126 * px[:, :, 0] + 0.7152 * px[:, :, 1] + 0.0722 * px[:, :, 2]
        rec["mean_lum"] = round(float(lum.mean()), 4)
        rec["p99_lum"] = round(float(np.percentile(lum, 99)), 3)
        rec["max_lum"] = round(float(lum.max()), 2)
        mc = px.reshape(-1, 3).mean(0)
        rec["mean_rgb"] = [round(float(c), 4) for c in mc]
        # auto exposure so mean maps to ~0.18
        ev = float(np.log2(0.18 / max(rec["mean_lum"], 1e-5)))
        scene.view_settings.exposure = max(min(ev, 6), -6)
        rec["preview_exposure_ev"] = round(scene.view_settings.exposure, 2)
        img.save_render(dst, scene=scene)
        rec["png"] = dst
        bpy.data.images.remove(img)
    except Exception as e:
        rec["error"] = str(e)[:300]
    stats[iid] = rec
    json.dump(stats, open(stats_path, "w"), indent=1)
    print("HDRI", iid, rec.get("size"), rec.get("mean_lum"), rec.get("error", ""))
print("DONE", len(stats))
