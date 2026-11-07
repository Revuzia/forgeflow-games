"""VALE art (lane GF, GF-3): re-bake a fighter's normal and ORM at a larger size from the cached build's own sources (the
cached .blend keeps the `<part>_high` sources, the procedural materials and the low's UVs), without touching the shipped GLB.

    Blender -b art/.cache/fighters/<id>.blend --python art/tools/rebake_data_maps.py -- <id> <out_dir> [size 1024]

Writes <out_dir>/<id>_{normal,orm}.png (and a throwaway base). The GLB swap is glb_image_swap.py; the part names come from
the part map (art/tools/partmap_dump.py)."""
import os
import sys

import bpy
import numpy as np

GAME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(GAME, "art", "blender"))
from common import bake, materials  # noqa: E402

a = sys.argv[sys.argv.index("--") + 1:]
fid, out = a[0], a[1]
size = int(a[2]) if len(a) > 2 else 1024
names = [str(n) for n in np.load(os.path.join(GAME, "art", ".cache", "fighters", "partmap", f"{fid}.npz"))["names"]]
body = max((o for o in bpy.data.objects if o.type == "MESH" and o.data.attributes.get("vale_part")), key=lambda o: len(o.data.polygons))
accent = next((o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("_accent")), None)
highs = {}
for i, n in enumerate(names):
    h = bpy.data.objects.get(f"{n}_high")
    if h is not None:
        highs[i] = [h]
missing = [n for i, n in enumerate(names) if i not in highs]
print(f"[rebake] {fid}: {len(highs)} sources, none for {missing}")
os.makedirs(out, exist_ok=True)
bake_src = bpy.data.collections.get("_bake_src")
if bake_src is not None:
    bake_src.hide_render = False
    bake_src.hide_viewport = False
    for lc in bpy.context.view_layer.layer_collection.children:
        if lc.name == "_bake_src":
            lc.exclude = False
            lc.hide_viewport = False
for o in [h for hs in highs.values() for h in hs]:
    o.hide_viewport = False
    o.hide_set(False)
res = bake.bake_asset(body, highs, out, name=fid, size=2048, sizes={"normal": size, "orm": size},
                      ao_extra=[accent] if accent else [], ao_into_base=materials.BIBLE_BAKE["ao"], zero_metal=True)
print("[rebake] done", res["timings"], res["images"])
