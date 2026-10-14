"""VALE structures (ART 2.0 methods): the Needles, the Lantern and the Hourbell.

    Blender -b --factory-startup --python art/blender/units/structures.py -- [--only needle_outer,...] [--preview]

Neutral dial-stone architecture (both sides use the same unit; the team reads from the `accent`
material, which the renderer tints per viewer). Sculpted as numpy SDF volumes per material, decimated to
the CONTRACT §12 structure budget, box-projected UVs onto the painted tiling textures
(art/out/textures/*.webp), and vertex-painted on top (glTF multiplies COLOR_0 into the base colour):
sun from behind-left, posterised, crevice occlusion, chalk-lit edges, a darker foot.

  needle_outer / needle_inner / needle_bell   carved square needles on stepped plinths: ironstone bands,
                                              hour-tick grooves, a dawnglass eye (accent) under the cap
  lantern                                     the lane gate: a stone lantern whose lamp chamber is accent
  hourbell                                    the core: four pillars, a dome roof, a hung bell with an
                                              accent lamp in its mouth

Output: art/out/units/<id>.glb (origin at the ground centre, +Z of Blender = up, the exporter maps it
to three's +Y) and art/renders/units/structures.png.
"""
from __future__ import annotations

import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import Capsule, Ellipsoid, HalfSpace, Lathe, Prim, RoundBox, Sculpt, Sphere, Torus  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "units")
RENDERS = os.path.join(scene.RENDERS_DIR, "units")
TEX = os.path.join(scene.OUT_DIR, "textures")
N = sdf.Noise(31)
SUN = np.array([-0.45, -0.35, 0.82]) / np.linalg.norm([-0.45, -0.35, 0.82])


class TaperBox(Prim):
    """A square shaft whose half-width runs from w0 (z0) to w1 (z1), rounded edges r."""

    def __init__(self, z0, z1, w0, w1, r=0.03, c=(0.0, 0.0)):
        self.z0, self.z1, self.w0, self.w1, self.r = z0, z1, w0, w1, r
        self.c = np.array(c, dtype=np.float64)

    def bounds(self):
        w = max(self.w0, self.w1)
        return np.array([self.c[0] - w, self.c[1] - w, self.z0]), np.array([self.c[0] + w, self.c[1] + w, self.z1])

    def d(self, P):
        t = np.clip((P[:, 2] - self.z0) / (self.z1 - self.z0), 0, 1)
        w = self.w0 + (self.w1 - self.w0) * t
        q = np.stack([np.abs(P[:, 0] - self.c[0]) - w + self.r, np.abs(P[:, 1] - self.c[1]) - w + self.r,
                      np.abs(P[:, 2] - (self.z0 + self.z1) / 2) - (self.z1 - self.z0) / 2 + self.r], axis=1)
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(axis=1), 0) - self.r


def cyl(z0, z1, r, rr=0.03):
    def prof(rad, z):
        q0 = rad - r + rr
        q1 = np.abs(z - (z0 + z1) / 2) - (z1 - z0) / 2 + rr
        return np.sqrt(np.maximum(q0, 0) ** 2 + np.maximum(q1, 0) ** 2) + np.minimum(np.maximum(q0, q1), 0) - rr
    return Lathe((0, 0, 0), prof, r + 0.05, z0 - 0.05, z1 + 0.05)


def chip(amp, freq):
    return lambda P: amp * np.clip(N.ridged(P, freq, 3), 0, 1) - amp * 0.3


def blend(S: Sculpt) -> sdf.Blend:
    return sdf.Blend([(op, prim, k) for op, prim, k, _ in S.ops])


# ── designs: name -> {material: Sculpt} ─────────────────────────────────────────────────────────
def needle(h: float, w: float, bands: int, bell: bool) -> dict:
    stone, iron, glass = Sculpt("stone"), Sculpt("ironstone"), Sculpt("accent")
    # stepped plinth (two tiers, chipped)
    stone.add(cyl(0.0, 0.32, w * 2.9).displaced(chip(0.03, 3.0), 0.03), k=0.0)
    stone.add(cyl(0.3, 0.6, w * 2.3).displaced(chip(0.025, 3.5), 0.025), k=0.02)
    cap0 = h * 0.8
    shaft = TaperBox(0.55, cap0, w, w * 0.66, r=0.05)
    stone.add(shaft.displaced(lambda P: 0.01 * N(P, 4.0), 0.012), k=0.04)
    # hour-tick grooves down each face
    for s in range(4):
        a = s * math.pi / 2
        for k in range(5):
            z = 1.2 + k * (cap0 - 2.0) / 5
            wz = w + (w * 0.66 - w) * (z - 0.55) / (cap0 - 0.55)
            p = np.array([math.cos(a) * wz, math.sin(a) * wz, z])
            stone.sub(Capsule(p + np.array([-math.sin(a), math.cos(a), 0]) * wz * 0.45, p - np.array([-math.sin(a), math.cos(a), 0]) * wz * 0.45, 0.025), k=0.01)
    # pyramidion cap
    def pyr(P):
        z = P[:, 2] - cap0
        hw = w * 0.74 * np.clip(1 - z / (h - cap0), 0, 1)
        q = np.maximum(np.abs(P[:, 0]), np.abs(P[:, 1])) - hw
        return np.maximum(np.maximum(q, -z), z - (h - cap0)) * 0.8
    class Pyr(Prim):
        def bounds(self):
            return np.array([-w, -w, cap0 - 0.05]), np.array([w, w, h + 0.05])
        def d(self, P):
            return pyr(P)
    stone.add(Pyr(), k=0.03)
    stone.add(TaperBox(cap0 - 0.18, cap0 + 0.05, w * 0.82, w * 0.8, r=0.04), k=0.0)   # cap collar
    # ironstone bands
    for i in range(bands):
        z = 0.95 + (cap0 - 1.6) * (i + 0.5) / bands
        wz = w + (w * 0.66 - w) * (z - 0.55) / (cap0 - 0.55)
        iron.add(TaperBox(z - 0.09, z + 0.09, wz + 0.05, wz + 0.045, r=0.03), k=0.0)
    # the eye: a window through the shaft under the cap, glazed with accent glass
    ez = cap0 - 0.65
    stone.sub(RoundBox((0, 0, ez), (w * 1.2, w * 0.32, 0.32), 0.05), k=0.03)
    stone.sub(RoundBox((0, 0, ez), (w * 0.32, w * 1.2, 0.32), 0.05), k=0.03)
    glass.add(Ellipsoid((0, 0, ez), (w * 0.38, w * 0.38, 0.36)), k=0.0)
    if bell:   # bell needles: a small bronze-less stone bell hung from the collar
        iron.add(Torus((0, -w * 0.9, cap0 - 0.25), 0.08, 0.02), k=0.0)
    return {"stone": stone, "ironstone": iron, "accent": glass}


def lantern() -> dict:
    stone, iron, glass = Sculpt("stone"), Sculpt("ironstone"), Sculpt("accent")
    stone.add(cyl(0.0, 0.35, 1.5).displaced(chip(0.03, 3.0), 0.03), k=0.0)
    stone.add(cyl(0.35, 0.6, 1.15).displaced(chip(0.025, 3.5), 0.025), k=0.02)
    stone.add(TaperBox(0.6, 2.0, 0.42, 0.34, r=0.05), k=0.04)                       # column
    stone.add(RoundBox((0, 0, 2.08), (0.7, 0.7, 0.1), 0.04), k=0.02)                 # lamp floor
    for sx in (-1, 1):                                                                # chamber posts
        for sy in (-1, 1):
            stone.add(RoundBox((sx * 0.56, sy * 0.56, 2.65), (0.11, 0.11, 0.5), 0.03), k=0.01)
    # roof: a wide flat-topped hat with an upturned rim
    def roof(r, z):
        t = np.clip(r / 1.25, 0, 1)
        top = 3.62 - 0.32 * t + 0.1 * t ** 6
        return np.maximum(np.maximum(z - top, 3.18 + 0.12 * t ** 4 - z), r - 1.25)
    stone.add(Lathe((0, 0, 0), roof, 1.3, 3.1, 3.8).displaced(chip(0.02, 4.0), 0.02), k=0.02)
    stone.add(Sphere((0, 0, 3.86), 0.17), k=0.06)                                     # finial
    iron.add(Torus((0, 0, 2.2), 0.72, 0.035, axes=np.diag([1, 1, 1.0])), k=0.0)
    iron.add(Torus((0, 0, 3.12), 0.72, 0.035), k=0.0)
    glass.add(Ellipsoid((0, 0, 2.65), (0.36, 0.36, 0.42)), k=0.0)                     # the lamp core
    return {"stone": stone, "ironstone": iron, "accent": glass}


def hourbell() -> dict:
    stone, iron, glass = Sculpt("stone"), Sculpt("ironstone"), Sculpt("accent")
    stone.add(cyl(0.0, 0.4, 3.4).displaced(chip(0.035, 2.5), 0.035), k=0.0)
    stone.add(cyl(0.4, 0.75, 2.8).displaced(chip(0.03, 3.0), 0.03), k=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            stone.add(TaperBox(0.75, 6.2, 0.36, 0.3, r=0.05, c=(sx * 1.55, sy * 1.55)), k=0.04)
    stone.add(RoundBox((0, 0, 6.35), (2.05, 2.05, 0.22), 0.06), k=0.03)              # entablature
    def dome(r, z):
        q = np.sqrt((r / 1.85) ** 2 + ((z - 6.55) / 1.9) ** 2)
        return np.maximum((q - 1.0) * 1.6, 6.5 - z)
    stone.add(Lathe((0, 0, 0), dome, 1.95, 6.4, 8.6), k=0.06)
    stone.add(Capsule((0, 0, 8.4), (0, 0, 9.0), 0.13), k=0.06)                       # finial spike
    iron.add(Torus((0, 0, 6.62), 1.82, 0.06), k=0.0)
    # the bell: lathe profile (shoulder, waist, flared lip), hollow mouth, hung from a beam
    def bell(r, z):
        zz = (z - 3.2)
        prof = np.where(zz > 1.6, 0.5 - (zz - 1.6) * 0.5, 0.62 + 0.38 * np.clip((1.6 - zz) / 1.6, 0, 1) ** 1.6)
        outer = np.maximum(np.maximum(r - prof, -zz), zz - 2.0)
        inner = np.maximum(r - (prof - 0.09), 0.25 - zz)
        return np.maximum(outer, -inner) * 0.9
    iron.add(Lathe((0, 0, 0), bell, 1.1, 3.1, 5.3), k=0.0)
    iron.add(RoundBox((0, 0, 5.75), (1.6, 0.12, 0.12), 0.03), k=0.0)                 # beam
    iron.add(Capsule((0, 0, 5.2), (0, 0, 5.7), 0.07), k=0.04)
    glass.add(Sphere((0, 0, 3.75), 0.42), k=0.0)                                       # lamp core in the mouth
    return {"stone": stone, "ironstone": iron, "accent": glass}


DESIGNS = {
    "needle_outer": lambda: needle(7.0, 0.62, 2, False),
    "needle_inner": lambda: needle(7.5, 0.7, 3, False),
    "needle_bell": lambda: needle(6.5, 0.56, 2, True),
    "lantern": lantern,
    "hourbell": hourbell,
}
TRIS = {"needle_outer": 6000, "needle_inner": 6500, "needle_bell": 6000, "lantern": 7000, "hourbell": 12000}
MAT = {"stone": ("plaster_chalk.webp", 2.2, "#C9C1AE"), "ironstone": ("ironstone.webp", 1.0, "#5A4F46"), "accent": (None, 1.0, "#3F9CFF")}


# ── surfacing ────────────────────────────────────────────────────────────────────────────────────
def srgb2lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def arrays(ob):
    me = ob.data
    v = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", v); v = v.reshape(-1, 3)
    n = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("normal", n); n = n.reshape(-1, 3)
    e = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get("vertices", e)
    return v, n, e.reshape(-1, 2)


def cavity(v, n, e, iters=3):
    cnt = np.bincount(e.ravel(), minlength=len(v)).astype(np.float64)
    avg = v.copy()
    for _ in range(iters):
        acc = np.zeros_like(v)
        np.add.at(acc, e[:, 0], avg[e[:, 1]]); np.add.at(acc, e[:, 1], avg[e[:, 0]])
        avg = acc / np.maximum(cnt, 1)[:, None]
    return np.einsum("ij,ij->i", v - avg, n)


TINT = {"stone": "#B9AE9B", "ironstone": "#FFFFFF"}   # dial-stone warmth (L* ~70 with the chalk texture)


def vpaint(ob, height: float, tint: str = "#FFFFFF"):
    """Painted light and occlusion as a multiplier around 1 (the texture carries the colour)."""
    v, n, e = arrays(ob)
    lit = np.clip(np.einsum("ij,j->i", n, SUN), 0, 1)
    t = np.clip(0.35 + 0.65 * lit, 0, 1)
    t = np.round(t * 3) / 3 * 0.55 + t * 0.45
    k = 0.62 + 0.55 * t
    cav = cavity(v, n, e)
    k *= 1 - 0.5 * np.clip(-cav / 0.03, 0, 1)
    k += 0.25 * np.clip(cav / 0.02, 0, 1)
    k *= 0.55 + 0.45 * smooth(0.0, 0.9, v[:, 2])                    # darker foot
    k *= 0.95 + 0.08 * smooth(height * 0.6, height, v[:, 2])        # lighter crown (value gradient)
    # a darkening multiplier in 0..1 (the texture carries the albedo; glTF multiplies COLOR_0 into it), linear
    col = (np.clip(k / 1.25, 0, 1) ** 2.2)[:, None] * srgb2lin(hexc(tint))[None, :]
    me = ob.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    a = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.ones((len(v), 4)); rgba[:, :3] = col
    a.data.foreach_set("color", rgba.astype(np.float32).ravel())
    me.color_attributes.active_color = a


def box_uv(ob, tile: float):
    """World-scaled box projection: each face takes the two axes orthogonal to its dominant normal."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    nl = len(me.loops)
    lv = np.empty(nl, dtype=np.int64); me.loops.foreach_get("vertex_index", lv)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    pn = np.empty(len(me.polygons) * 3); me.polygons.foreach_get("normal", pn); pn = pn.reshape(-1, 3)
    ls = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("loop_total", lt)
    face_of_loop = np.repeat(np.arange(len(me.polygons)), lt)
    ax = np.argmax(np.abs(pn), axis=1)[face_of_loop]
    p = co[lv]
    u = np.where(ax == 0, p[:, 1], p[:, 0])
    w = np.where(ax == 2, p[:, 1], p[:, 2])
    uv = np.stack([u, w], axis=1) / tile
    me.uv_layers.active.data.foreach_set("uv", uv.astype(np.float32).ravel())


def material(name: str):
    tex, _, hexcol = MAT[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Roughness"].default_value = 0.85 if name != "accent" else 0.3
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(os.path.join(TEX, tex), check_existing=True)
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = (*srgb2lin(hexc(hexcol)), 1)
        b.inputs["Emission Color"].default_value = (*srgb2lin(hexc(hexcol)), 1)
        b.inputs["Emission Strength"].default_value = 0.8
    return m


def low(ob, tris):
    t = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if t > tris:
        md = ob.modifiers.new("dec", "DECIMATE"); md.ratio = tris / t
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=md.name)
    ob.data.polygons.foreach_set("use_smooth", np.ones(len(ob.data.polygons), dtype=bool))
    return ob


def build(name: str, col):
    parts = DESIGNS[name]()
    total = TRIS[name]
    weights = {"stone": 0.75, "ironstone": 0.17, "accent": 0.08}
    objs = []
    height = 0.0
    for mname, S in parts.items():
        if not S.ops:
            continue
        v, q = S.mesh(0.035 if mname == "stone" else 0.025)
        ob = sdf.to_object(f"{name}_{mname}", v, q, col)
        low(ob, int(total * weights[mname]))
        height = max(height, float(v[:, 2].max()))
        if mname != "accent":
            box_uv(ob, MAT[mname][1])
        ob.data.materials.append(material(mname))
        objs.append(ob)
    for ob in objs:
        m = ob.name.rsplit("_", 1)[-1]
        if m != "accent":
            vpaint(ob, height, TINT.get(m, "#FFFFFF"))
    return objs, height


def export(objs, path):
    scene.select_only(objs, active=objs[0])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(**scene.op_kwargs(bpy.ops.export_scene.gltf, filepath=path, export_format="GLB", use_selection=True,
                                                export_apply=True, export_yup=True, export_normals=True, export_texcoords=True,
                                                export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_materials="EXPORT",
                                                export_image_format="AUTO", export_animations=False, export_skins=False, export_lights=False,
                                                export_cameras=False))


def preview(groups):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; scene.cycles_device(sc); sc.cycles.samples = 64
    sc.render.resolution_x, sc.render.resolution_y = 1800, 800
    sc.view_settings.view_transform = "Standard"
    w = sc.world or bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.44, 0.47, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 2.4
    sc.collection.objects.link(sun); sun.rotation_euler = (math.radians(38), 0, math.radians(-40))
    x = 0.0
    for objs in groups:
        for o in objs:
            o.location.x = x
        x += 5.0
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam)
    cam.data.lens = 30
    cx = (x - 5.0) / 2
    cam.location = (cx, -22.0, 17.0)
    from mathutils import Vector
    cam.rotation_euler = (Vector((cx, 0, 3.2)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    os.makedirs(RENDERS, exist_ok=True)
    sc.render.filepath = os.path.join(RENDERS, "structures.png")
    bpy.ops.render.render(write_still=True)


def main():
    import argparse
    p = argparse.ArgumentParser(); p.add_argument("--only", default=""); p.add_argument("--preview", action="store_true")
    a = p.parse_args(scene.script_args())
    scene.reset()
    col = scene.collection("structures")
    groups = []
    for nme in [n for n in DESIGNS if not a.only or n in a.only.split(",")]:
        objs, h = build(nme, col)
        path = os.path.join(OUT, f"{nme}.glb")
        export(objs, path)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
        scene.log(f"{nme}: {tris} tris, height {h:.2f} m, {os.path.getsize(path) // 1024} KB")
        groups.append(objs)
    if a.preview:
        preview(groups)


if __name__ == "__main__":
    main()
