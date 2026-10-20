"""VALE scatter props: Dialwood trees, fallen hour-tick stones and needle fragments for the map scatter
(src/render/terrain.ts instances them from each map's `art.terrain.props`: tree / rock / stone).

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/props/scatter.py -- [--only a,b]
        [--preview [--res 1920] [--samples 48]]          (VALE_CYCLES_DEVICE=CPU when the GPU is busy)

Modules (this folder): kit.py (numpy mesh parts, fan leaves, tubes, GLB writer), paint.py (ray-cast
occlusion and painterly ramps), dialwood.py (the trees), stones.py (chiselled stone pieces).

Budgets are per INSTANCE COUNT, not per model: RIFT instances ~920 trees (each drawn again in the shadow
pass) against a ≤ 700k-triangle scene (CONTRACT §12, RIFT brief §6), so a tree is ≤ 750 triangles.

  Dialwood   (RIFT §6, WORLD §maps "lacquered fan-leaved plates, bevelled, instanced") — five variants
             (tall, broad, squat, young, leaning): crowns of clumps shingled with single-sided fan leaves over
             closed cores, shaded by clump normals; a faceted trunk with a root flare and limbs. ≤ 750
             triangles; ≤ 3.4 m tall in game (the brief's cap south of play), crowns ≤ 1.6 m from the trunk,
             so a crown on a block edge keeps the units on the road beside it in view.
  boulders   RIFT rock role: fallen hour-tick stones at the cliff feet — they stand on walkable floor, so
             ≤ 0.4 m in game (brief §6, checklist §8): authored ≤ ROCK_MAX_H. Low broken slabs, a tick bar
             with its engraved groove, a broken pair; worn lit chamfers, moss feathered into the stone.
  stones     fallen hour-tick fragments. ≤ 300 triangles; authored ≤ 0.85 m because the terrain scales a
             stone by 0.10–0.42 (it lands ≤ 0.4 m).
  needle_*   BRIDGE §5: pale needle-stone fragments (a drum sector with its recessed hour-band, a broken
             slab), ≤ 0.58 m so the terrain's ≤ 1.38× boulder scale keeps them ≤ 0.8 m. Built for the stubs,
             broken edges and gorge lip; they render once the terrain (or the map's landmarks) places them.

Everything is vertex-coloured (no textures, no material maps — the terrain draws all props with one
vertex-colour material, roughness 0.86), real size in metres, origin at the ground contact. Terrain spins
each instance about the vertical, so the paint carries only rotation-invariant light (sky visibility,
up-facing, occlusion, rims); the renderer's sun supplies direction.

Output: art/out/props/<name>.glb, art/renders/props/scatter.png (--preview) and a build report
art/renders/props/build_report.json (triangles, vertices, KB, size per prop).
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from common import scene  # noqa: E402

import dialwood  # noqa: E402
import kit  # noqa: E402
import stones  # noqa: E402
from paint import srgb2lin  # noqa: E402
from stones import StoneSpec  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "props")
RENDERS = os.path.join(scene.RENDERS_DIR, "props")

BUDGET = {"tree": 750, "rock": 600, "stone": 300}
ROCK_MAX_H = 0.33                 # RIFT rock role, authored: ×1.1·s (s ≤ 1.1) − 4 cm sunk → ≤ 0.36 m in game

STONES: dict[str, tuple[str, StoneSpec]] = {
    # RIFT rock role: fallen hour-tick stones at the cliff feet, on walkable floor, so ≤ 0.4 m in game (brief
    # §6, checklist §8): authored ≤ 0.33 m tall (terrain ×1.1·s vertically, s ≤ 1.1, sunk 4 cm). Low, broken,
    # half-sunk carved pieces that read as floor dressing, never as walls.
    "boulder_block": ("rock", StoneSpec(seed=5, size=(0.92, 0.64, 0.30), chips=7, broken=True, bevel=0.05, taper=0.16,
                                        moss=[(-0.16, 0.06, 0.22)], tilt=(0.04, -0.03), sink=0.05, palette="dial")),
    "boulder_tick": ("rock", StoneSpec(seed=17, size=(1.18, 0.38, 0.27), chips=7, broken=True, bevel=0.045, groove=0.08, taper=0.2,
                                       tilt=(0.0, 0.05), yaw=0.25, sink=0.06, palette="dial")),
    "boulder_pair": ("rock", StoneSpec(seed=29, size=(0.70, 0.54, 0.27), chips=6, broken=True, bevel=0.045, taper=0.15,
                                       moss=[(-0.04, 0.04, 0.13)], tilt=(-0.04, 0.05), offset=(-0.16, 0.10, 0.0), sink=0.05, palette="dial",
                                       extra=[StoneSpec(seed=31, size=(0.38, 0.30, 0.20), chips=4, broken=True, bevel=0.035, taper=0.1,
                                                        tilt=(0.18, 0.2), offset=(0.36, -0.30, 0.0), yaw=0.7, palette="dial")])),
    # RIFT stones (terrain scale 0.10–0.46): fallen hour-tick fragments
    "stone_tick": ("stone", StoneSpec(seed=41, size=(0.84, 0.30, 0.24), chips=3, broken=True, bevel=0.03, groove=0.07, taper=0.1,
                                      tilt=(0.06, 0.0), palette="dial")),
    "stone_chip": ("stone", StoneSpec(seed=47, size=(0.62, 0.50, 0.34), chips=5, broken=True, bevel=0.035, taper=0.15,
                                      tilt=(0.12, -0.08), palette="dial")),
    # BRIDGE (brief §5: needle fragments ≤ 0.8 m on the stubs, broken edges and gorge lip, never on the deck):
    # built for that placement; the terrain places no rock on the span today, so the map does not list them
    "needle_drum": ("rock", StoneSpec(seed=53, size=(0.70, 0.42, 0.0), shape="drum", chips=3, broken=False, bevel=0.03,
                                      band=True, palette="needle")),
    "needle_slab": ("rock", StoneSpec(seed=59, size=(0.52, 0.30, 0.23), chips=4, broken=True, bevel=0.03, groove=0.05,
                                      tilt=(0.05, 0.10), palette="needle")),
}


def build(name: str) -> tuple[str, kit.Part, np.ndarray]:
    if name in dialwood.TREES:
        sp = dialwood.TREES[name]
        part = dialwood.build_tree(sp)
        col = dialwood.paint_tree(part, sp.seed, sp.tint)
        return "tree", part, col
    role, sp = STONES[name]
    part = stones.build_stone(sp)
    col = stones.paint_stone(part, sp.palette, sp.seed)
    return role, part, col


def export(name: str, part: kit.Part, col: np.ndarray) -> int:
    os.makedirs(OUT, exist_ok=True)
    return kit.write_glb(os.path.join(OUT, f"{name}.glb"), part.P, part.N, srgb2lin(col), part.F, name)


# ── preview sheet: the game's camera pitch, RIFT's sun, a cliff-top floor ──────────────────────────
def preview(names: list[str], res: int = 1920, samples: int = 48):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res, res * 9 // 16
    try:
        sc.view_settings.view_transform = "Khronos PBR Neutral"
    except TypeError:
        sc.view_settings.view_transform = "Standard"
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.62, 0.74, 1)
    bg.inputs["Strength"].default_value = 0.75
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.color = (1.0, 0.92, 0.85)
    sun.data.angle = math.radians(2.0)
    sc.collection.objects.link(sun)
    from mathutils import Vector
    sun_dir = Vector((-0.3531, -0.5043, 0.788))          # RIFT sunDir (three) → Blender (x, -z, y)
    sun.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()
    mat = bpy.data.materials.new("prev_vcol")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeVertexColor")
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.86
    floor_m = bpy.data.materials.new("floor")
    floor_m.use_nodes = True
    floor_m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb2lin([0.50, 0.48, 0.43]), 1)
    floor_m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    bpy.ops.mesh.primitive_plane_add(size=80, location=(10, 4, 0))
    bpy.context.active_object.data.materials.append(floor_m)
    trees = [n for n in names if n in dialwood.TREES]
    rocks = [n for n in names if n not in dialwood.TREES]
    placed = []
    for i, n in enumerate(trees):
        placed.append((n, (i * 4.4, 4.0, 0.0), 0.82))
    for i, n in enumerate(rocks):
        role = STONES[n][0]
        s = 1.0 if role == "rock" else 0.46                       # stones at their largest in-game size
        placed.append((n, (-1.2 + i * 1.95, -0.6, 0.0), s))
    for n, loc, s in placed:
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f"{n}.glb"))
        for ob in bpy.context.selected_objects:
            if ob.type != "MESH":
                continue
            ca = ob.data.color_attributes
            if len(ca):
                attr.layer_name = ca[0].name
            ob.data.materials.clear()
            ob.data.materials.append(mat)
            ob.location = loc
            ob.scale = (s, s, s)
            ob.rotation_euler[2] = 0.6
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 22.0
    pitch = math.radians(52)
    tgt = Vector((8.8, 2.2, 1.0))
    d = 40.0
    cam.location = tgt + Vector((0, -math.cos(pitch) * d, math.sin(pitch) * d))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    os.makedirs(RENDERS, exist_ok=True)
    sc.render.filepath = os.path.join(RENDERS, "scatter.png")
    bpy.ops.render.render(write_still=True)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--preview", action="store_true")
    p.add_argument("--res", type=int, default=1920)
    p.add_argument("--samples", type=int, default=48)
    a = p.parse_args(scene.script_args())
    scene.reset()
    names = [n for n in list(dialwood.TREES) + list(STONES) if not a.only or n in a.only.split(",")]
    report = {}
    rp = os.path.join(RENDERS, "build_report.json")
    if os.path.exists(rp):
        report = {k: v for k, v in json.load(open(rp)).items() if k in dialwood.TREES or k in STONES}
    for n in names:
        role, part, col = build(n)
        size = export(n, part, col)
        ext = np.ptp(part.P, axis=0)
        report[n] = dict(role=role, tris=int(part.tris), verts=int(len(part.P)), kb=round(size / 1024, 1),
                         size_m=[round(float(x), 2) for x in ext], budget=BUDGET[role])
        flag = "" if part.tris <= BUDGET[role] else "  OVER BUDGET"
        if role == "rock" and STONES[n][1].palette == "dial" and part.P[:, 2].max() > ROCK_MAX_H:
            flag += f"  TOO TALL (> {ROCK_MAX_H} m authored)"
        scene.log(f"{n:16s} {role:5s} {part.tris:5d} tris {len(part.P):5d} verts {size / 1024:6.1f} KB  "
                  f"{ext[0]:.2f}×{ext[1]:.2f}×{ext[2]:.2f} m{flag}")
    os.makedirs(RENDERS, exist_ok=True)
    with open(rp, "w") as fh:
        json.dump(report, fh, indent=1, sort_keys=True)
    if a.preview:
        preview(list(report) if not a.only else names, a.res, a.samples)


if __name__ == "__main__":
    main()
