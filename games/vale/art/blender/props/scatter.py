"""VALE scatter props (ART 2.0 methods): Dialwood trees, boulders and stones for the map scatter.

    Blender -b --factory-startup --python art/blender/props/scatter.py -- [--only dialwood_a,...] [--preview]

Sculpted as numpy SDF volumes (common/hifi/sdf.py), decimated to instancing budgets, and PAINTED INTO
VERTEX COLOURS (no textures: a tree costs a few KB): a warm sunlit crown and cool dark underside, a
posterised painterly ramp, crevice occlusion from the surface's own concavity, light leaf dabs, bark
streaks, moss on stone tops and chalk-lit stone edges. Forms are chunky and readable from the 52-degree
camera; nothing glows. Colours are the terrain palette (src/render/terrain.ts DEFAULT_COLORS): leaf
#3F5A45, trunk #4A3F36, stone #77726A, moss #475A43, and the terrain multiplies a per-instance tint.

Output: art/out/props/<name>.glb (authored at real size, origin at the ground contact) and a preview
sheet art/renders/props/scatter.png.
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
from common.hifi.sdf import Capsule, Ellipsoid, RoundCone, Sculpt, Sphere  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "props")
RENDERS = os.path.join(scene.RENDERS_DIR, "props")
N = sdf.Noise(23)


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexc(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ── shapes ───────────────────────────────────────────────────────────────────────────────────────
def dialwood(seed: int, height: float, crown: float, lobes: int, lean: float) -> tuple[Sculpt, Sculpt]:
    rng = np.random.default_rng(seed)
    trunk = Sculpt("trunk")
    top = np.array([lean * 0.4, 0.0, height * 0.55])
    trunk.add(RoundCone((0, 0, 0.0), top, 0.26, 0.15), k=0.0)
    for a in range(4):                                     # root flare
        ang = a * math.pi / 2 + rng.uniform(-0.3, 0.3)
        trunk.add(RoundCone((0, 0, 0.35), (math.cos(ang) * 0.42, math.sin(ang) * 0.42, 0.0), 0.12, 0.06), k=0.12)
    for b in range(2):                                     # two limbs into the crown
        ang = rng.uniform(0, 2 * math.pi)
        trunk.add(RoundCone(top * 0.85, top + np.array([math.cos(ang) * crown * 0.45, math.sin(ang) * crown * 0.45, height * 0.18]), 0.1, 0.05), k=0.08)
    bark = lambda P: 0.012 * np.sin(np.arctan2(P[:, 1], P[:, 0]) * 9 + P[:, 2] * 2.0) + 0.01 * N(P, 6.0)
    trunk_d = Sculpt("trunk_d")
    for op in trunk.ops:
        trunk_d.ops.append(op)
    canopy = Sculpt("canopy")
    cz = height * 0.55 + crown * 0.55
    c0 = np.array([lean * 0.6, 0.0, cz])
    canopy.add(Ellipsoid(c0, (crown, crown * 0.95, crown * 0.78)), k=0.0)
    for i in range(lobes):                                 # leaf masses around and above the core
        ang = 2 * math.pi * i / lobes + rng.uniform(-0.4, 0.4)
        rr = crown * rng.uniform(0.62, 0.85)
        zz = cz + crown * rng.uniform(-0.25, 0.45)
        r = crown * rng.uniform(0.5, 0.68)
        canopy.add(Ellipsoid(c0 + (math.cos(ang) * rr, math.sin(ang) * rr, zz - cz), (r, r * 0.95, r * 0.82)), k=crown * 0.25)
    canopy.add(Ellipsoid(c0 + (0, 0, crown * 0.55), (crown * 0.6, crown * 0.6, crown * 0.5)), k=crown * 0.3)
    # leaf clumps: rounded masses packed over the upper surface (the read that survives the camera and
    # the decimation: a cauliflower of clumps, each with its own light and shadow)
    for i in range(int(16 + crown * 10)):
        u = rng.uniform(-0.35, 1.0)
        ph = rng.uniform(0, 2 * math.pi)
        rr = math.sqrt(max(0.0, 1 - u * u))
        d = np.array([rr * math.cos(ph) * crown * 1.02, rr * math.sin(ph) * crown * 0.98, u * crown * 0.84])
        r = crown * rng.uniform(0.24, 0.34)
        canopy.add(Sphere(c0 + d * 0.92, r), k=crown * 0.06)
    leafy = lambda P: -0.05 * np.clip(N.ridged(P, 3.2, 2), 0, 1) - 0.02 * N(P, 8.0)    # fine leaf grain
    canopy_d = Sculpt("canopy_d")
    canopy_d.add(sdf.Blend([(op, prim, k) for op, prim, k, _ in canopy.ops]).displaced(leafy, 0.12), k=0.0)
    trunk_dd = Sculpt("trunk_dd")
    trunk_dd.add(sdf.Blend([(op, prim, k) for op, prim, k, _ in trunk.ops]).displaced(bark, 0.025), k=0.0)
    return trunk_dd, canopy_d


def boulder(seed: int, size: float, flat: float) -> Sculpt:
    rng = np.random.default_rng(seed)
    S = Sculpt("boulder")
    S.add(Ellipsoid((0, 0, size * 0.32), (size * 0.62, size * 0.5, size * 0.42 * flat)), k=0.0)
    for i in range(3):
        ang = rng.uniform(0, 2 * math.pi)
        S.add(Ellipsoid((math.cos(ang) * size * 0.3, math.sin(ang) * size * 0.25, size * rng.uniform(0.15, 0.4)),
                        (size * rng.uniform(0.3, 0.45),) * 2 + (size * 0.3 * flat,)), k=size * 0.12)
    # chisel: planar cuts (facets) + a few cracks, the stylised "carved" read
    for i in range(6):
        n = rng.normal(size=3)
        n[2] = abs(n[2]) * 0.6 + 0.2
        n /= np.linalg.norm(n)
        S.inter(sdf.HalfSpace(n * size * rng.uniform(0.42, 0.55) + np.array([0, 0, size * 0.3]), n, size * 2), k=size * 0.04)
    S.inter(sdf.HalfSpace((0, 0, -0.02), (0, 0, -1), size * 2), k=0.0)
    out = Sculpt("boulder_d")
    out.add(sdf.Blend([(op, prim, k) for op, prim, k, _ in S.ops]).displaced(lambda P: 0.02 * size * N(P, 3.0 / size), 0.03 * size), k=0.0)
    return out


# ── vertex paint ─────────────────────────────────────────────────────────────────────────────────
def mesh_arrays(ob):
    me = ob.data
    v = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", v)
    v = v.reshape(-1, 3)
    me.calc_loop_triangles() if hasattr(me, "calc_loop_triangles") else None
    n = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", n)
    n = n.reshape(-1, 3)
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    return v, n, e.reshape(-1, 2)


def cavity(v, n, e, iters: int = 3):
    """+ convex (edges, crowns), - concave (crevices): the vertex against its neighbours' mean, along n."""
    nv = len(v)
    cnt = np.bincount(e.ravel(), minlength=nv).astype(np.float64)
    avg = v.copy()
    for _ in range(iters):
        acc = np.zeros_like(v)
        np.add.at(acc, e[:, 0], avg[e[:, 1]])
        np.add.at(acc, e[:, 1], avg[e[:, 0]])
        avg = acc / np.maximum(cnt, 1)[:, None]
    return np.einsum("ij,ij->i", v - avg, n)


def paint(ob, colors: np.ndarray):
    me = ob.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.ones((len(colors), 4))
    rgba[:, :3] = srgb2lin(np.clip(colors, 0, 1))
    attr.data.foreach_set("color", rgba.astype(np.float32).ravel())
    me.color_attributes.active_color = attr


SUN = np.array([-0.45, -0.35, 0.82])
SUN /= np.linalg.norm(SUN)


def paint_canopy(ob, crown_z: float, crown: float, seed: int):
    v, n, e = mesh_arrays(ob)
    leaf = hexc("#3F5A45")
    hi = hexc("#86A04E")         # sunlit leaf (warm, yellow-green)
    mid = hexc("#3F5A3C")
    lo = hexc("#121C1A")         # underside (cool, deep)
    h = (v[:, 2] - (crown_z - crown)) / (2 * crown)
    lit = np.clip(np.einsum("ij,j->i", n, SUN), 0, 1)
    t = np.clip(0.5 * smooth(0.1, 0.95, h) + 0.75 * lit - 0.25, 0, 1)
    t = np.round(t * 4) / 4 * 0.7 + t * 0.3                 # posterised painterly bands, softened
    col = np.where(t[:, None] < 0.5, lo + (mid - lo) * (t[:, None] / 0.5), mid + (hi - mid) * ((t[:, None] - 0.5) / 0.5))
    cav = cavity(v, n, e)
    occ = np.clip(-cav / 0.035, 0, 1)
    col *= (1 - 0.6 * occ)[:, None]
    rng = np.random.default_rng(seed)
    dab = (N(v * np.array([1, 1, 1.3]), 4.1) > 0.6) & (lit > 0.45)
    col = np.where(dab[:, None], col * 0.5 + hexc("#B4C46A") * 0.5, col)
    col = col * 0.9 + leaf * 0.1
    paint(ob, col)


def paint_trunk(ob):
    v, n, e = mesh_arrays(ob)
    base = hexc("#4A3F36")
    streak = 0.85 + 0.25 * np.sin(np.arctan2(v[:, 1], v[:, 0]) * 9 + v[:, 2] * 2.0)
    lit = np.clip(np.einsum("ij,j->i", n, SUN), 0, 1)
    col = base[None, :] * (streak * (0.7 + 0.55 * lit))[:, None]
    col *= (0.6 + 0.4 * smooth(0, 0.6, v[:, 2]))[:, None]        # dark at the roots
    paint(ob, col)


def paint_stone(ob, size: float, moss: bool = True):
    v, n, e = mesh_arrays(ob)
    stone = hexc("#68635B")
    light = hexc("#A49C8B")
    dark = hexc("#2A2826")
    mossc = hexc("#5B7046")
    lit = np.clip(np.einsum("ij,j->i", n, SUN), 0, 1)
    t = np.clip(0.25 + 0.75 * lit, 0, 1)
    t = np.round(t * 3) / 3 * 0.6 + t * 0.4
    col = np.where(t[:, None] < 0.5, dark + (stone - dark) * (t[:, None] / 0.5), stone + (light - stone) * ((t[:, None] - 0.5) / 0.5))
    cav = cavity(v, n, e)
    col *= (1 - 0.5 * np.clip(-cav / (0.03 * size), 0, 1))[:, None]
    col = col + (light - col) * (0.35 * np.clip(cav / (0.025 * size), 0, 1))[:, None]          # chalk-lit edges
    if moss:
        m = smooth(0.55, 0.85, n[:, 2]) * (N(v, 1.6 / size) > 0.45)
        col = col * (1 - m[:, None] * 0.8) + mossc * (m[:, None] * 0.8)
    col *= (0.55 + 0.45 * smooth(0, size * 0.25, v[:, 2]))[:, None]   # contact shadow at the foot
    paint(ob, col)


# ── build ────────────────────────────────────────────────────────────────────────────────────────
def low(ob, tris: int):
    t = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if t > tris:
        m = ob.modifiers.new("dec", "DECIMATE")
        m.ratio = tris / t
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=m.name)
    ob.data.polygons.foreach_set("use_smooth", np.ones(len(ob.data.polygons), dtype=bool))
    return ob


def material():
    m = bpy.data.materials.get("vale_prop_vcol") or bpy.data.materials.new("vale_prop_vcol")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.85
    return m


SPECS = {
    "dialwood_a": dict(kind="tree", seed=3, height=4.4, crown=1.55, lobes=6, lean=0.15),
    "dialwood_b": dict(kind="tree", seed=11, height=5.2, crown=1.35, lobes=5, lean=-0.2),
    "dialwood_c": dict(kind="tree", seed=29, height=3.8, crown=1.8, lobes=7, lean=0.05),
    "boulder_a": dict(kind="rock", seed=5, size=1.0, flat=0.85),
    "boulder_b": dict(kind="rock", seed=17, size=1.0, flat=0.65),
    "stone_a": dict(kind="rock", seed=41, size=1.0, flat=0.5, moss=False),
}


def build(name: str, spec: dict, col):
    mat = material()
    objs = []
    if spec["kind"] == "tree":
        trunk, canopy = dialwood(spec["seed"], spec["height"], spec["crown"], spec["lobes"], spec["lean"])
        tv, tq = trunk.mesh(0.045)
        cv, cq = canopy.mesh(0.06)
        t = low(sdf.to_object(f"{name}_trunk", tv, tq, col), 260)
        c = low(sdf.to_object(f"{name}_canopy", cv, cq, col), 1800)
        paint_trunk(t)
        cz = spec["height"] * 0.55 + spec["crown"] * 0.55
        paint_canopy(c, cz, spec["crown"], spec["seed"])
        objs = [t, c]
    else:
        S = boulder(spec["seed"], spec["size"], spec["flat"])
        v, q = S.mesh(0.03)
        r = low(sdf.to_object(name, v, q, col), 420)
        paint_stone(r, spec["size"], spec.get("moss", True))
        objs = [r]
    for o in objs:
        o.data.materials.append(mat)
    scene.select_only(objs, active=objs[0])
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def export(ob, path):
    scene.select_only([ob], active=ob)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(**scene.op_kwargs(bpy.ops.export_scene.gltf, filepath=path, export_format="GLB", use_selection=True,
                                                export_apply=True, export_yup=True, export_normals=True, export_texcoords=False,
                                                export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_materials="EXPORT",
                                                export_animations=False, export_skins=False, export_morph=False, export_lights=False,
                                                export_cameras=False))


def preview(objs):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = 64
    sc.render.resolution_x, sc.render.resolution_y = 1600, 600
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.44, 0.47, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.2
    sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(38), 0, math.radians(-40))
    x = 0.0
    for o in objs:
        o.location.x = x
        x += 4.2 if "dialwood" in o.name else 2.4
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.lens = 28
    cx = x / 2 - 2
    cam.location = (cx, -15.0, 13.0)
    from mathutils import Vector
    cam.rotation_euler = (Vector((cx, 0, 1.6)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    os.makedirs(RENDERS, exist_ok=True)
    sc.render.filepath = os.path.join(RENDERS, "scatter.png")
    bpy.ops.render.render(write_still=True)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--preview", action="store_true")
    a = p.parse_args(scene.script_args())
    scene.reset()
    col = scene.collection("props")
    names = [n for n in SPECS if not a.only or n in a.only.split(",")]
    objs = []
    for nme in names:
        ob = build(nme, SPECS[nme], col)
        export(ob, os.path.join(OUT, f"{nme}.glb"))
        scene.log(f"{nme}: {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris, {os.path.getsize(os.path.join(OUT, nme + '.glb')) // 1024} KB")
        objs.append(ob)
    if a.preview:
        preview(objs)


if __name__ == "__main__":
    main()
