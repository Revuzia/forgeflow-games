"""VALE art: write a fighter's texel-to-part map from its cached build, without a rebuild (closing CW5 r2 refix: Burdam's
GLB carries post-build grades a rebuild would lose, and the Lisvel build's own painter never reached the dump).

    Blender -b art/.cache/fighters/<id>.blend --python art/tools/partmap_dump.py -- <id>

Writes art/.cache/fighters/partmap/<id>.npz (part, names), the format of art/tools/part_lab.py: rasterizes the cached
body mesh's active UV map at 2048 by its vale_part attribute; the names come from the fighter's sculpts() order."""
import importlib.util
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

GAME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BL = os.path.join(GAME, "art", "blender")
sys.path.insert(0, BL)
sys.path.insert(0, os.path.join(BL, "fighters"))
from common.hifi import project  # noqa: E402

fid = sys.argv[sys.argv.index("--") + 1]
sp = importlib.util.spec_from_file_location(fid, os.path.join(BL, "fighters", f"{fid}.py"))
mod = importlib.util.module_from_spec(sp)
sys.modules[fid] = mod
sp.loader.exec_module(mod)


class _Joints(dict):
    """(Ervet's sculpts take the rig's joints: only the names matter here) a bone's head, or the origin for a joint with
    no bone of that name (palm.R)"""

    def __missing__(self, k):
        return Vector((0.0, 0.0, 0.0))


try:
    names = [it[0] for it in mod.sculpts()]
except TypeError:
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    names = [it[0] for it in mod.sculpts(_Joints({b.name: b.head_local.copy() for b in arm.data.bones}))]
body = max((o for o in bpy.data.objects if o.type == "MESH" and o.data.attributes.get("vale_part")),
           key=lambda o: len(o.data.polygons))
maps = project.rasterize(body, 2048, "vale_part")
# (CW5 round 3: Nurrow's build splits hat_cone into two parts, so sculpts() is one name short and every id after it read as the
# wrong part: "trousers" measured a hand. A map with more parts than sculpts() names keeps the build's own names, or stops.)
if int(maps["part"].max()) >= len(names):
    prior = os.path.join(GAME, "art", ".cache", "fighters", "partmap", f"{fid}.npz")
    built = [str(n) for n in np.load(prior)["names"]] if os.path.isfile(prior) else []
    if int(maps["part"].max()) >= len(built):
        raise SystemExit(f"[partmap] {fid}: ids reach {int(maps['part'].max())} but sculpts() names {len(names)}: rebuild for the build's own map")
    names = built
out = os.path.join(GAME, "art", ".cache", "fighters", "partmap", f"{fid}.npz")
os.makedirs(os.path.dirname(out), exist_ok=True)
np.savez_compressed(out, part=np.ascontiguousarray(maps["part"]), names=np.array(names))
print(f"[partmap] {fid}: body {body.name}, {len(names)} names, parts in map {sorted(set(np.unique(maps['part']).tolist()))[:4]}... -> {out}")
