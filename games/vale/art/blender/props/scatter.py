"""VALE scatter props: Dialwood trees, fallen hour-tick stones and needle fragments for the map scatter
(src/render/terrain.ts instances them from each map's `art.terrain.props`: tree / rock / stone).

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/props/scatter.py -- [--only a,b]
        [--preview] [--trees] [--bridge] [--res 1920] [--samples 48]   (VALE_CYCLES_DEVICE=CPU when the GPU is busy)
    --preview  the whole set on a floor (scatter.png) · --trees  the Dialwood look-dev sheet, paint over final
    (scatter_trees.png) · --bridge  the needle set on BRIDGE's deck, terraces and a stub (scatter_bridge.png)

Modules (this folder): kit.py (numpy mesh parts, fan leaves, tubes, GLB writer), paint.py (ray-cast
occlusion and painterly ramps), dialwood.py (the trees), stones.py (chiselled stone pieces).

Budgets are per INSTANCE COUNT, not per model: RIFT instances ~920 trees (each drawn again in the shadow
pass) against a ≤ 700k-triangle scene (CONTRACT §12, RIFT brief §6), so a tree is ≤ 750 triangles.

  Dialwood   (RIFT §6, WORLD §maps "lacquered fan-leaved plates, bevelled, instanced") — five variants
             (tall, broad, squat, young, leaning): crowns of clumps shingled with single-sided fan leaves over
             closed cores, shaded by clump normals; a faceted trunk with a root flare and limbs. Matte painted
             plates (r12 M11: gloss mask 0, a baked bottom/interior → top value gradient, ≥ 20 plates). ≤ 750
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
from paint import hexc, srgb2lin  # noqa: E402
from stones import StoneSpec  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "props")
RENDERS = os.path.join(scene.RENDERS_DIR, "props")

BUDGET = {"tree": 750, "rock": 600, "stone": 300}
HULL_BEVEL = 0.018                # RIFT lumps: a narrow chamfer on every hard edge, where the chalk edge light lands (r12 M11)
ROCK_MAX_H = 0.33                 # RIFT rock role, authored: ×1.1·s (s ≤ 1.1) − 4 cm sunk → ≤ 0.36 m in game

STONES: dict[str, tuple[str, StoneSpec]] = {
    # RIFT rock role: fallen hour-tick stones at the cliff feet, on walkable floor, so ≤ 0.4 m in game (brief
    # §6, checklist §8): authored ≤ 0.33 m tall (terrain ×1.1·s vertically, s ≤ 1.1, sunk 4 cm). Low, broken,
    # half-sunk carved pieces that read as floor dressing, never as walls.
    "boulder_block": ("rock", StoneSpec(seed=5, size=(0.92, 0.70, 0.27), shape="hull", chips=3, broken=True, bevel=HULL_BEVEL,
                                        soft=1.0, taper=0.12, moss=[(-0.12, 0.06, 0.24)], tilt=(0.05, -0.04), sink=0.05,
                                        palette="dial")),
    "boulder_tick": ("rock", StoneSpec(seed=17, size=(1.12, 0.42, 0.27), shape="hull", chips=3, broken=True, bevel=HULL_BEVEL, soft=1.0,
                                       groove=0.075, taper=0.1, tilt=(0.0, 0.05), yaw=0.25, sink=0.05, palette="dial")),
    "boulder_pair": ("rock", StoneSpec(seed=29, size=(0.74, 0.58, 0.26), shape="hull", chips=3, broken=True, bevel=HULL_BEVEL, soft=1.0,
                                       taper=0.1, moss=[(-0.04, 0.04, 0.15)], tilt=(-0.05, 0.06), offset=(-0.16, 0.10, 0.0),
                                       sink=0.05, palette="dial",
                                       extra=[StoneSpec(seed=31, size=(0.42, 0.34, 0.20), shape="hull", chips=2, broken=True,
                                                        bevel=HULL_BEVEL, soft=1.0, tilt=(0.18, 0.2), offset=(0.38, -0.30, 0.0),
                                                        yaw=0.7, palette="dial")])),
    # RIFT stones (terrain scale 0.10–0.46): fallen hour-tick fragments
    "stone_tick": ("stone", StoneSpec(seed=41, size=(0.86, 0.34, 0.25), shape="hull", chips=2, broken=True, bevel=HULL_BEVEL, soft=1.0,
                                      groove=0.07, taper=0.1, tilt=(0.06, 0.0), palette="dial")),
    "stone_chip": ("stone", StoneSpec(seed=47, size=(0.64, 0.54, 0.32), shape="hull", chips=3, broken=True, bevel=HULL_BEVEL, soft=1.0,
                                      taper=0.1, tilt=(0.12, -0.08), palette="dial")),
    # BRIDGE (brief §5: needle fragments ≤ 0.8 m on the stubs, broken edges and gorge lip, never on the deck):
    # built for that placement; the terrain places no rock on the span today, so the map does not list them
    "needle_drum": ("rock", StoneSpec(seed=53, size=(0.70, 0.42, 0.0), shape="drum", chips=3, broken=False, bevel=0.03,
                                      band=True, palette="needle")),
    "needle_slab": ("rock", StoneSpec(seed=59, size=(0.52, 0.30, 0.23), chips=4, broken=True, bevel=0.03, groove=0.05,
                                      tilt=(0.05, 0.10), palette="needle")),
    # BRIDGE stones (terrain stone scale 0.10–0.42, so authored ≤ 0.85 m → ≤ 0.36 m): loose needle chips for the
    # broken deck edges, the stubs and the gorge lip (brief §5: never on the open deck)
    "needle_chip": ("stone", StoneSpec(seed=61, size=(0.66, 0.46, 0.30), chips=5, broken=True, bevel=0.03, taper=0.12,
                                       tilt=(0.10, -0.06), palette="needle")),
    "needle_shard": ("stone", StoneSpec(seed=67, size=(0.84, 0.24, 0.20), chips=4, broken=True, bevel=0.025, groove=0.05,
                                        taper=0.08, tilt=(0.04, 0.12), yaw=0.2, palette="needle")),
}
BRIDGE_SET = ["needle_drum", "needle_slab", "needle_chip", "needle_shard"]


def build(name: str) -> tuple[str, kit.Part, np.ndarray, np.ndarray]:
    """→ role, mesh, sRGB colours, GLOSS mask (COLOR_0.a: 1 lacquered leaf, 0 bark / stone)."""
    if name in dialwood.TREES:
        sp = dialwood.TREES[name]
        part = dialwood.build_tree(sp)
        col, gloss = dialwood.paint_tree(part, sp.seed, sp.tint)
        return "tree", part, col, gloss
    role, sp = STONES[name]
    part = stones.build_stone(sp)
    col = stones.paint_stone(part, sp.palette, sp.seed)
    return role, part, col, np.zeros(len(part.P))             # stone and moss: matte


def export(name: str, part: kit.Part, col: np.ndarray, gloss: np.ndarray) -> int:
    os.makedirs(OUT, exist_ok=True)
    return kit.write_glb(os.path.join(OUT, f"{name}.glb"), part.P, part.N, srgb2lin(col), part.F, name, gloss=gloss)


def _front_side(nt):
    """The game draws props FrontSide (single-sided plates): make back faces transparent in Cycles too, so the
    previews never show a plate's unlit back that the game culls."""
    out = nt.nodes["Material Output"]
    link = out.inputs["Surface"].links[0]
    src = link.from_socket
    nt.links.remove(link)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mix.inputs["Fac"])
    nt.links.new(src, mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


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
    _front_side(nt)
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


def preview_trees(res: int = 1920, samples: int = 48):
    """Dialwood look-dev sheet: the five trees at their in-game size (×0.8) and the gameplay pitch (52°) under
    RIFT's sun, two rows: the PAINT alone (vertex colour as emission) and the FINAL (lit, roughness from the
    COLOR_0.a gloss mask: 1 → 0.42, 0 → 0.86) → scatter_trees.png."""
    from mathutils import Vector
    rows = []
    for mode in ("paint", "final"):
        scene.reset()
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        scene.cycles_device(sc)
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.render.resolution_x, sc.render.resolution_y = res, res * 9 // 32
        try:
            sc.view_settings.view_transform = "Khronos PBR Neutral"
        except TypeError:
            sc.view_settings.view_transform = "Standard"
        w = bpy.data.worlds.new("w")
        sc.world = w
        w.use_nodes = True
        w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.62, 0.74, 1)
        w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.75
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 3.0
        sun.data.color = (1.0, 0.92, 0.85)
        sun.data.angle = math.radians(2.0)
        sc.collection.objects.link(sun)
        sun.rotation_euler = (-Vector((-0.3531, -0.5043, 0.788))).to_track_quat("-Z", "Y").to_euler()
        fl = bpy.data.materials.new("floor")
        fl.use_nodes = True
        fl.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.075, 0.035, 1)  # the moss block top
        fl.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
        bpy.ops.mesh.primitive_plane_add(size=80)
        bpy.context.active_object.data.materials.append(fl)
        m = bpy.data.materials.new(mode)
        m.use_nodes = True
        nt = m.node_tree
        vc = nt.nodes.new("ShaderNodeVertexColor")
        if mode == "paint":
            em = nt.nodes.new("ShaderNodeEmission")
            nt.links.new(vc.outputs["Color"], em.inputs["Color"])
            nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
        else:
            bsdf = nt.nodes["Principled BSDF"]
            nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.inputs["To Min"].default_value, mr.inputs["To Max"].default_value = 0.86, 0.42
            nt.links.new(vc.outputs["Alpha"], mr.inputs["Value"])
            nt.links.new(mr.outputs[0], bsdf.inputs["Roughness"])
        _front_side(nt)
        names = list(dialwood.TREES)
        for i, n in enumerate(names):
            bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f"{n}.glb"))
            for ob in bpy.context.selected_objects:
                if ob.type != "MESH":
                    continue
                ca = ob.data.color_attributes
                if len(ca):
                    vc.layer_name = ca[0].name
                ob.data.materials.clear()
                ob.data.materials.append(m)
                ob.location = ((i - (len(names) - 1) / 2) * 3.3, 0.0, 0.0)
                ob.scale = (0.8, 0.8, 0.8)
                ob.rotation_euler[2] = 0.6 + i * 1.3
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 17.0
        pitch = math.radians(52)
        tgt = Vector((0.0, 0.0, 1.5))
        cam.location = tgt + Vector((0, -math.cos(pitch) * 40, math.sin(pitch) * 40))
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam
        path = os.path.join(scene.CACHE_DIR, "props", f"trees_{mode}.png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        rows.append(path)
    imgs = [bpy.data.images.load(p) for p in rows]
    W, H = imgs[0].size
    out = bpy.data.images.new("trees_sheet", W, H * len(imgs))
    px = np.zeros((H * len(imgs), W, 4), dtype=np.float32)
    for k, im in enumerate(imgs):                                  # Blender images are bottom-up: paint on top
        px[(len(imgs) - 1 - k) * H:(len(imgs) - k) * H] = np.asarray(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
    out.pixels = px.ravel()
    out.filepath_raw = os.path.join(RENDERS, "scatter_trees.png")
    out.file_format = "PNG"
    out.save()


def preview_bridge(res: int = 1920, samples: int = 48):
    """BRIDGE read check: the needle set at its in-game sizes on the deck (lane #A59B86), the Aubade and
    Serenade terraces, a stub top and the gorge lip, under Needlespan's sun (46°, #FFC890)."""
    from mathutils import Vector
    scene.reset()
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
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.45, 0.5, 0.68, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.9
    sun.data.color = (1.0, 0.784, 0.565)
    sun.data.angle = math.radians(2.0)
    sc.collection.objects.link(sun)
    sun_dir = Vector((-0.2376, -0.6528, 0.7193))                  # BRIDGE sunDir (three) → Blender (x, -z, y)
    sun.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()
    vmat = bpy.data.materials.new("prev_vcol")
    vmat.use_nodes = True
    vnt = vmat.node_tree
    vattr = vnt.nodes.new("ShaderNodeVertexColor")
    vnt.links.new(vattr.outputs["Color"], vnt.nodes["Principled BSDF"].inputs["Base Color"])
    _front_side(vnt)
    vnt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.86

    def slab(name, hexcol, loc, size):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb2lin(hexc(hexcol)), 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
        ob = bpy.context.active_object
        ob.scale = size
        ob.data.materials.append(m)
    # four floors left → right: Aubade terrace, the deck, a stub top (raised 1.4 m), Serenade terrace
    slab("aubade", "#A3A7A8", (-6.0, 0.0, -0.5), (4.0, 8.0, 1.0))
    slab("deck", "#A59B86", (-2.0, 0.0, -0.5), (4.0, 8.0, 1.0))
    slab("stub", "#8E8979", (2.0, 0.0, 0.7), (4.0, 8.0, 1.4))
    slab("serenade", "#A8916E", (6.0, 0.0, -0.5), (4.0, 8.0, 1.0))
    sizes = {"rock": [1.375, 0.85], "stone": [0.42 * 1.1, 0.25]}
    k = 0
    for fx, z in [(-6.0, 0.0), (-2.0, 0.0), (2.0, 1.4), (6.0, 0.0)]:
        for j, n in enumerate(BRIDGE_SET):
            role = STONES[n][0]
            for si, s in enumerate(sizes[role]):
                bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f"{n}.glb"))
                for ob in bpy.context.selected_objects:
                    if ob.type != "MESH":
                        continue
                    ca = ob.data.color_attributes
                    if len(ca):
                        vattr.layer_name = ca[0].name
                    ob.data.materials.clear()
                    ob.data.materials.append(vmat)
                    ob.location = (fx - 1.1 + si * 1.3, -2.6 + j * 1.6, z)
                    ob.scale = (s, s, s * (0.88 if role == "rock" else 0.82))
                    ob.rotation_euler[2] = 0.4 + 1.7 * k
                    k += 1
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 16.4
    pitch = math.radians(52)
    tgt = Vector((0.0, 0.2, 0.4))
    cam.location = tgt + Vector((0, -math.cos(pitch) * 40, math.sin(pitch) * 40))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.filepath = os.path.join(RENDERS, "scatter_bridge.png")
    bpy.ops.render.render(write_still=True)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--preview", action="store_true")
    p.add_argument("--res", type=int, default=1920)
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--bridge", action="store_true", help="also render the BRIDGE read check (scatter_bridge.png)")
    p.add_argument("--trees", action="store_true", help="also render the Dialwood look-dev sheet (scatter_trees.png)")
    a = p.parse_args(scene.script_args())
    scene.reset()
    names = [n for n in list(dialwood.TREES) + list(STONES) if not a.only or n in a.only.split(",")]
    report = {}
    rp = os.path.join(RENDERS, "build_report.json")
    if os.path.exists(rp):
        report = {k: v for k, v in json.load(open(rp)).items() if k in dialwood.TREES or k in STONES}
    for n in names:
        role, part, col, gloss = build(n)
        size = export(n, part, col, gloss)
        ext = np.ptp(part.P, axis=0)
        report[n] = dict(role=role, tris=int(part.tris), verts=int(len(part.P)), kb=round(size / 1024, 1),
                         size_m=[round(float(x), 2) for x in ext], budget=BUDGET[role],
                         gloss=dict(mean=round(float(gloss.mean()), 3), glossy_verts=int((gloss > 0.5).sum())))
        if role == "tree":                                   # r12 M11: ≥ 20 fan plates per crown
            kf = part.A["kind"][part.F[:, 0]]
            report[n]["plates"] = int(round((kf == 1).sum() / dialwood.K_LEAF))
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
    if a.trees:
        preview_trees(a.res, a.samples)
    if a.bridge:
        preview_bridge(a.res, a.samples)


if __name__ == "__main__":
    main()
