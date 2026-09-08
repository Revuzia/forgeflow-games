"""GNASHER chain post + one chain link (static props, no rig). The runtime keeps drawing its own chain
between body and post; these give it a real post and a real link to instance."""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cblib import *
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]

# ---- post ------------------------------------------------------------------------------------------
b = Builder("gnasher_post", out, atlas=512)
stone = b.mat("stone", mat_paint, base=(0.46, 0.44, 0.40), rough=0.85, chip=(0.6, 0.58, 0.54), scale=6.0, bump=0.5)
iron = b.mat("iron", mat_metal, base=(0.28, 0.29, 0.32), rough=0.55, rust=(0.44, 0.17, 0.05), scale=10.0, bump=0.4)
brass = b.mat("brass", mat_metal, base=(0.62, 0.45, 0.18), rough=0.4, worn=(0.9, 0.8, 0.5), grime=(0.12, 0.08, 0.03), scale=16.0)
b.rbox("base", (0.62, 0.62, 0.22), (0, 0, 0.11), "root", stone, bevel=0.05, segs=3)
b.rbox("base2", (0.44, 0.44, 0.12), (0, 0, 0.27), "root", stone, bevel=0.04, segs=3)
b.cyl("shaft", 0.075, 0.062, 0.95, (0, 0, 0.80), "root", iron, seg=12, bevel=0.01)
b.torus("band0", 0.08, 0.018, (0, 0, 0.40), "root", brass, seg_major=14, seg_minor=5)
b.torus("band1", 0.07, 0.016, (0, 0, 1.10), "root", brass, seg_major=14, seg_minor=5)
b.sphere("cap", 0.10, (0, 0, 1.30), "root", iron, seg=14, rings=9)
b.torus("ring", 0.10, 0.026, (0, 0, 1.44), "root", brass, seg_major=16, seg_minor=6, rot=(90, 0, 0))
b.face_at = Vector((0, 0, 1.3)); b.face_r = 0.3
b.build_mesh()
b.bake(ao_samples=24)
info = finish(b, os.path.join(out, "gnasher_post.manifest.json"), idle_clip=None,
              extra={"kind": "prop", "notes": ["static; place at the gnasher's post position; ring centre at y=1.44"]})

# ---- chain link ------------------------------------------------------------------------------------
b2 = Builder("gnasher_link", out, atlas=256)
iron2 = b2.mat("iron", mat_metal, base=(0.30, 0.31, 0.34), rough=0.5, rust=(0.44, 0.17, 0.05), scale=30.0, bump=0.4)
# an oval link 0.30 m long (runtime chain pitch GN_LINK = 0.30) lying along Z, centred at the origin
b2.torus("link", 0.075, 0.022, (0, 0, 0.15), "root", iron2, seg_major=24, seg_minor=8, rot=(90, 0, 0), scale=(1, 1, 2.0))
b2.face_at = Vector((0, 0, 0.15)); b2.face_r = 0.2
b2.build_mesh()
b2.bake(ao_samples=16)
finish(b2, os.path.join(out, "gnasher_link.manifest.json"), idle_clip=None,
       extra={"kind": "prop", "notes": ["one 0.30 m link along +Y (glTF); instance per GN_LINK along the chain, alternate 90 deg roll"]})
