"""VALE structures: the Needles, the Lantern and the Hourbell — one set per culture.

    Blender -b --factory-startup --python art/blender/units/structures.py -- [--only needle_outer,...]
        [--culture aubade|serenade] [--preview] [--preview-only] [--fast]

Two sets of the same five units (same role, collision radius, content height and clip names), picked by
team through UnitDef.art.teamModels = [aubade, serenade] (CONTRACT §12; FFA modes use art.model = aubade):

  AUBADE (west, team 0)    tall slender chalk spires of coursed octagonal stone, swept buttress fins with
                           dawnglass shards, blued-steel bands, accent inlays climbing the faces, an open
                           lancet stage holding the accent crystal, a concave spire with glowing dormers and
                           a dawnglass finial. Hourbell = an open eight-column belfry under a tall spire.
  SERENADE (east, team 1)  low, broad, banded ironstone and ochre sandstone drums with round-arched lampresin
                           windows, ironstone domes with sandstone ribs and an accent ring at the foot, an open
                           lamp cupola (accent core in a lampresin bowl) under a laid-down iron gnomon blade.
                           Hourbell = an arcaded drum under a great ribbed dome.
  shared                   the dial-stone plinth of dressed blocks with the twelve accent hour-ticks.

needle_outer / needle_inner / needle_bell / lantern / hourbell -> art/out/units/<id>_<culture>.glb with
object clips on the accent core: idle (loop), attack1 (impact at 40 %), death (the light goes out, held).
Geometry + the painted bake live in structure_kit.py (hard-surface kit, bible materials, one baked
base-colour atlas per structure, AO multiplied in; `accent` stays a live material the renderer tints).
Report: art/renders/units/build_report_structures.json; contact sheet: art/renders/units/structures.png.

The SDF + tiling-texture helpers below the imports (TaperBox, cyl, chip, box_uv, vpaint, material, low,
export, MAT, TINT) are the older surfacing that small_units.py and maps/landmarks.py import from here.
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
sys.path.insert(0, HERE)
from mathutils import Matrix, Vector  # noqa: E402
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



# legacy surfacing (box-projected tiling textures x vertex paint): shared with small_units.py and
# maps/landmarks.py, which import this module as `S`
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


def export(objs, path):
    scene.select_only(objs, active=objs[0])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(**scene.op_kwargs(bpy.ops.export_scene.gltf, filepath=path, export_format="GLB", use_selection=True,
                                                export_apply=True, export_yup=True, export_normals=True, export_texcoords=True,
                                                export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_materials="EXPORT",
                                                export_image_format="AUTO", export_animations=False, export_skins=False, export_lights=False,
                                                export_cameras=False))




# ════════════════════════════════════════════════════════════════════════════════════════════════
# THE TWO CULTURES (art.teamModels = [aubade, serenade]; CONTRACT §12)
#
# Shared: a dial-stone plinth of dressed blocks whose top step carries the twelve hour-ticks of the
# Vale's dial, inlaid in `accent` (the quarter hours larger) and ringed by a metal inlay; one painted
# value ramp (dark feet, lit crown); the `accent` light at the head of every structure.
#   AUBADE (west)    tall, slender, upward: octagonal chalk spires of coursed stone, swept buttress
#                    fins with dawnglass shards, blued-steel bands, accent inlays climbing the faces,
#                    an open lancet stage holding an accent crystal, a concave spire with glowing
#                    gablets and a dawnglass finial.
#   SERENADE (east)  low, broad, round, heavy: banded ironstone feet, ochre sandstone drums with
#                    round-arched lampresin windows, ironstone domes with sandstone ribs and a
#                    glowing accent ring at the foot, an open lamp cupola whose accent core burns in
#                    a lampresin bowl, and an oxidised-iron gnomon blade (the needle, laid down).
# ════════════════════════════════════════════════════════════════════════════════════════════════
import structure_kit as K  # noqa: E402

PI = math.pi
FPS = scene.FPS
SCRATCH = os.path.join(scene.CACHE_DIR, "structures")   # gitignored: bake images, unquantized exports, look renders
O8 = dict(segs=8, phase=PI / 8)          # octagon: flats face the axes and the diagonals

DIAL = dict(hex="#9F998F", chisel=1.0, var=0.08, streaks=0.35, chips=0.55, scale=0.5)
AUBADE_MATS = {
    "dialstone": DIAL,
    "chalk": dict(hex="#DCD9D0", chisel=0.55, var=0.06, streaks=0.45, chips=0.45, veins=0.12, scale=0.5, rough=0.66,
                  brick=(0.56, 0.25, 0.018), brick_k=0.55),
    "steel": dict(hex="#53637A", chisel=0.15, var=0.05, rough=0.48, streaks=0.1, chips=0.7, scale=0.9),
    "dawnglass": dict(kind="glass", hex="#B4CFE8", rough=0.12, inclusions=0.3),
    "accent": dict(kind="accent", hex="#3F9CFF"),
}
SERENADE_MATS = {
    "dialstone": DIAL,
    "sandstone": dict(hex="#C9A675", chisel=0.8, var=0.08, veins=0.3, streaks=0.45, chips=0.5, scale=0.5, rough=0.74,
                      brick=(0.48, 0.24, 0.02), brick_k=0.7),
    "ironstone": dict(hex="#5E4C41", chisel=0.7, var=0.07, speckle=0.45, streaks=0.2, chips=0.65, scale=0.6, rough=0.7,
                      brick=(0.5, 0.3, 0.016), brick_k=0.55),
    "iron": dict(hex="#4C443F", chisel=0.2, var=0.05, speckle=0.9, rough=0.56, streaks=0.1, chips=0.7, scale=0.9),
    "lampresin": dict(kind="glass", hex="#D99C4E", rough=0.2, inclusions=0.6),
    "accent": dict(kind="accent", hex="#3F9CFF"),
}


def ring(r_in, r_out, z0, z1, c=0.015, segs=48, phase=0.0):
    """A closed rectangular-section ring (band, collar, inlay)."""
    prof = [(r_in, z0), (r_out - c, z0), (r_out, z0 + c), (r_out, z1 - c), (r_out - c, z1), (r_in, z1)]
    return K.lathe(prof, segs, closed=True, phase=phase)


def disk(r, z0, z1, c=0.03, segs=48, phase=0.0):
    return K.lathe(K.chamfer_profile([(0, z0), (r, z0), (r, z1), (0, z1)], c), segs, phase=phase)


def ellipse_pts(a, b, z0, t0, t1, n, r_off=0.0):
    out = []
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        out.append((a * math.cos(t) + r_off, z0 + b * math.sin(t)))
    return out


def dial_plinth(B, steps, tick_r, metal, tick_len=0.26, tick_w=0.075):
    """Dial-stone plinth: a chamfered disk, then rings of twelve dressed blocks (each with its own
    value) around a polished floor; twelve accent hour-ticks (quarters larger) on the top step and a
    metal inlay ring inside them. steps: [(r, z0, z1)] bottom up."""
    r, z0, z1 = steps[0]
    B.add("dialstone", disk(r, z0, z1, 0.05, 64))
    for r, z0, z1 in steps[1:]:
        rin = r * 0.62
        B.add("dialstone", disk(rin + 0.05, z0, z1 - 0.005, 0.02, 48))
        gap = 0.012 / r
        for k in range(12):
            a0 = (k - 0.5) * K.TAU / 12 + gap
            a1 = (k + 0.5) * K.TAU / 12 - gap
            prof = [(rin, z0), (r - 0.03, z0), (r, z0 + 0.03), (r, z1 - 0.04), (r - 0.04, z1), (rin, z1)]
            B.add("dialstone", K.lathe(prof, 6, a0=a0, a1=a1, closed=True))
    ztop = steps[-1][2]
    for k in range(12):
        a = k * K.TAU / 12
        big = k % 3 == 0
        L = tick_len * (1.45 if big else 1.0)
        W = tick_w * (1.5 if big else 1.0)
        B.add("accent", K.box((tick_r * math.cos(a), tick_r * math.sin(a), ztop + 0.006), (L / 2, W / 2, 0.026), 0.01, rz=a))
    ri = tick_r - tick_len * 0.85 - 0.05
    B.add(metal, ring(ri - 0.05, ri, ztop - 0.02, ztop + 0.018, 0.008, 64))


def core_anim(ob, kind: str, pivot):
    """Object clips on the accent core: idle (loop), attack1 (impact at 40 %), death (held)."""
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    px, py, pz = pivot
    if kind == "crystal":                       # a 4-fold crystal: a quarter turn per loop, a slow bob
        K.clip(ob, "idle", {
            "rotation_euler": [(1, (0, 0, 0)), (121, (0, 0, PI / 2))],
            "location": [(1, (px, py, pz)), (31, (px, py, pz + 0.06)), (61, (px, py, pz)), (91, (px, py, pz - 0.06)), (121, (px, py, pz))]})
        K.clip(ob, "attack1", {
            "location": [(1, (px, py, pz)), (8, (px, py, pz - 0.08)), (13, (px, py, pz + 0.22)), (31, (px, py, pz))],
            "scale": [(1, (1, 1, 1)), (13, (1.18, 1.18, 1.18)), (31, (1, 1, 1))]})
    else:                                       # a lamp core: it breathes
        K.clip(ob, "idle", {"scale": [(1, (1, 1, 1)), (46, (1.07, 1.07, 1.07)), (91, (1, 1, 1))]})
        K.clip(ob, "attack1", {"scale": [(1, (1, 1, 1)), (8, (0.86, 0.86, 0.86)), (13, (1.3, 1.3, 1.3)), (31, (1, 1, 1))]})
    K.clip(ob, "death", {
        "location": [(1, (px, py, pz)), (12, (px, py, pz + 0.15)), (45, (px, py, pz - 0.35))],
        "scale": [(1, (1, 1, 1)), (12, (1.25, 1.25, 1.25)), (45, (0.02, 0.02, 0.02))]})
    ob.location = (px, py, pz)
    ob.rotation_euler = (0, 0, 0)
    ob.scale = (1, 1, 1)


# ── AUBADE ───────────────────────────────────────────────────────────────────────────────────────
def slope_panes(B, pts, n_sides, phase_faces, t0=0.08, t1=0.42, w=0.16, frame=True, k=0.75):
    """Glowing lancet panes lying flush on the faces of an n-sided spire whose (r, z) profile is `pts`
    (corner radius), each with a steel lancet frame; faces centred at phase_faces + j*2pi/n."""
    ap = math.cos(PI / n_sides)
    i0, i1 = int(round(t0 * (len(pts) - 1))), max(int(round(t0 * (len(pts) - 1))) + 1, int(round(t1 * (len(pts) - 1))))
    (ra, za), (rb, zb) = pts[i0], pts[i1]
    pa = np.array([ra * ap, za])
    pb = np.array([rb * ap, zb])
    d = pb - pa
    L = float(np.linalg.norm(d))
    d /= L
    for j in range(n_sides):
        a = phase_faces + j * K.TAU / n_sides
        o = np.array([math.cos(a), math.sin(a), 0.0])
        u = np.array([-math.sin(a), math.cos(a), 0.0])
        v = o * d[0] + np.array([0, 0, 1.0]) * d[1]
        nrm = np.cross(u, v)
        base = o * pa[0] + np.array([0, 0, pa[1]]) + nrm * 0.012
        spring = L * 0.55
        pane = K.arch_outline(w, spring, "pointed", 8, bottom=L * 0.08)
        B.add("accent", K.prism(pane, origin=tuple(base), u=tuple(u), v=tuple(v), depth=0.025))
        if frame:
            path = K.arch_path(w + 0.06, spring, "pointed", 10, bottom=L * 0.08, k=k)
            p3 = [tuple(base + u * a_ + v * b_) for a_, b_ in path]
            B.add("steel", K.sweep(p3, 0.045, 0.035, out_fn=lambda p, nrm=nrm: tuple(nrm), sink=0.02))


def a_spire_cap(B, zc, tip, r_base, panes=8, pane_w=0.2, ribs=True, finial=0.5, sides=8):
    """Concave octagonal spire from zc to tip, steel ridge ribs, flush glowing lancets, dawnglass finial."""
    n = 10
    prof = [(0, zc), (r_base, zc), (r_base, zc + 0.06)]
    pts = []
    for i in range(n + 1):
        t = i / n
        r = (r_base - 0.035) * (1 - t) ** 1.3 + 0.035 * t
        z = zc + 0.08 + (tip - zc - 0.08) * t
        pts.append((r, z))
    prof += pts + [(0, tip + 0.02)]
    B.add("chalk", K.lathe(prof, segs=sides, phase=PI / sides))
    if ribs:
        for k in range(sides):
            a = PI / sides + k * K.TAU / sides
            path = [(r * math.cos(a), r * math.sin(a), z) for r, z in pts[:-1]]
            B.add("steel", K.sweep(path, 0.035 * max(1.0, r_base / 0.8), 0.028, sink=0.02))
    if panes:
        slope_panes(B, pts, sides, 0.0, 0.05, 0.4, pane_w)
    B.add("steel", ring(0.0, 0.09, tip - 0.12, tip - 0.02, 0.01, 8, PI / 8))
    B.add("dawnglass", K.crystal((0, 0, tip + finial * 0.32), 0.1 * max(1.0, finial / 0.6), finial * 0.68, finial * 0.32 + 0.06,
                                 sides=4, band=0.06, phase=PI / 4))
    return pts


def pinnacle(B, c, z0, h, r=0.1, tip=0.3):
    prof = K.chamfer_profile([(0, z0), (r * 1.3, z0), (r * 1.3, z0 + 0.12), (r, z0 + 0.18), (r * 0.8, z0 + h * 0.62), (0, z0 + h)], 0.015)
    v, f = K.lathe(prof, 8, phase=PI / 8)
    B.add("chalk", (K.move(v, (c[0], c[1], 0)), f))
    B.add("dawnglass", K.crystal((c[0], c[1], z0 + h + tip * 0.3), r * 0.55, tip * 0.7, tip * 0.3, sides=4, phase=PI / 4))


def a_fin(B, a, zb, top, reach=1.34, thick=0.17, shard=True, pinnacle=False, s=1.0):
    pts = [(0.35, zb), (reach, zb), (reach, zb + 0.16 * s), (reach - 0.1 * s, zb + 0.3 * s)]
    n = 9
    u0, v0 = reach - 0.1 * s, zb + 0.3 * s
    for i in range(1, n + 1):
        t = i / n
        pts.append((0.55 + (u0 - 0.55) * (1 - t) ** 1.7, v0 + (top - v0) * t))
    pts += [(0.42, top - 0.05), (0.35, top - 0.25)]
    u = (math.cos(a), math.sin(a), 0.0)
    B.add("chalk", K.prism(pts, origin=(0, 0, 0), u=u, v=(0, 0, 1), depth=thick, chamfer=0.025))
    # a steel cap along the swept edge
    path = [(p[0] * math.cos(a), p[0] * math.sin(a), p[1]) for p in pts[3:3 + n]]
    B.add("steel", K.sweep(path, thick * 0.55, 0.035, out_fn=lambda p, a=a: (math.cos(a) * 0.4, math.sin(a) * 0.4, 1.0), sink=0.02))
    su, sv = reach - 0.16 * s, zb + 0.36 * s
    if pinnacle:
        prof = [(0, sv - 0.05), (0.1, sv - 0.05), (0.1, sv + 0.12), (0.075, sv + 0.18), (0.06, sv + 0.42), (0, sv + 0.62)]
        v, f = K.lathe(prof, 8, phase=PI / 8)
        B.add("chalk", (K.rotz(K.move(v, (su, 0, 0)), a), f))
        v, f = K.crystal((su, 0, sv + 0.7), 0.05, 0.22, 0.1, sides=4)
        B.add("dawnglass", (K.rotz(v, a), f))
    elif shard:
        v, f = K.crystal((0, 0, 0), 0.085 * s, 0.42 * s, 0.1, sides=4, band=0.04, phase=PI / 4)
        v = K.rot(v, (0, 1, 0), 0.22)
        B.add("dawnglass", (K.rotz(K.move(v, (su, 0, sv + 0.1)), a), f))


def aubade_needle(B, H, z_stage, stage_h=1.25, r0=0.62, r1=0.5, fins=4, bands=2, pinnacles=False, bell=False):
    dial_plinth(B, [(1.82, 0.0, 0.24), (1.5, 0.24, 0.5)], 1.27, "steel")
    zb = 0.5
    B.add("chalk", K.lathe(K.chamfer_profile([(0, zb), (1.0, zb), (1.0, zb + 0.2), (0.92, zb + 0.28), (0.92, zb + 0.56),
                                              (0.74, zb + 0.8), (0, zb + 0.8)], 0.03), **O8))
    B.add("steel", ring(0.9, 1.03, zb + 0.16, zb + 0.24, 0.01, 8, PI / 8))
    zs0, zs1 = zb + 0.76, z_stage - 0.36

    def r_at(z):
        return r0 + (r1 - r0) * (z - zs0) / (zs1 - zs0)

    ncourse = max(3, round((zs1 - zs0) / 0.5))
    zc = [zs0 + (zs1 - zs0) * i / ncourse for i in range(ncourse + 1)]
    for i in range(ncourse):
        za, zz = zc[i], zc[i + 1]
        prof = [(0, za), (r_at(za) - 0.022, za), (r_at(za), za + 0.022), (r_at(zz), zz - 0.022), (r_at(zz) - 0.022, zz), (0, zz)]
        B.add("chalk", K.lathe(prof, **O8))
    band_idx = [round(ncourse * (k + 1) / (bands + 1)) for k in range(bands)]
    band_z = [zc[i] for i in band_idx]
    for z in band_z:
        r = r_at(z)
        B.add("steel", ring(r - 0.03, r + 0.05, z - 0.08, z + 0.08, 0.015, 8, PI / 8))
    # accent inlays climbing the four cardinal faces, broken at every course joint (stacked ticks)
    ap = math.cos(PI / 8)
    for k in range(4):
        a = k * PI / 2
        for i in range(ncourse):
            za, zz = zc[i] + 0.07, zc[i + 1] - 0.07
            if i == 0:
                za += 0.12
            if any(abs(z - zc[i]) < 1e-6 for z in band_z):
                za += 0.06
            if any(abs(z - zc[i + 1]) < 1e-6 for z in band_z):
                zz -= 0.06
            if zz - za < 0.15:
                continue
            path = [(r_at(z) * ap, 0, z) for z in np.linspace(za, zz, 3)]
            v, f = K.sweep(path, 0.075, 0.016, out_fn=lambda p: (1, 0, 0), sink=0.01)
            B.add("accent", (K.rotz(v, a), f))
            for side in (-1, 1):
                pth = [(r_at(z) * ap, side * 0.07, z) for z in np.linspace(za - 0.03, zz + 0.03, 3)]
                v, f = K.sweep(pth, 0.03, 0.03, out_fn=lambda p: (1, 0, 0), sink=0.01)
                B.add("chalk", (K.rotz(v, a), f))
    # swept buttress fins (alternate small fins on the inner needle)
    top = zs0 + (zs1 - zs0) * 0.55
    for k in range(fins):
        big = fins == 4 or k % 2 == 0
        a = PI / 4 + k * K.TAU / fins
        if big:
            a_fin(B, a, zb, top, pinnacle=pinnacles)
        else:
            a_fin(B, a, zb, zs0 + (zs1 - zs0) * 0.22, reach=1.12, thick=0.13, shard=True, s=0.75)
    # corbelled floor of the eye
    zf = z_stage
    B.add("steel", ring(r1 - 0.03, r1 + 0.045, zs1 - 0.1, zs1 + 0.02, 0.012, 8, PI / 8))
    B.add("chalk", K.lathe(K.chamfer_profile([(0, zs1), (r1, zs1), (r1 + 0.2, zf - 0.09), (r1 + 0.26, zf - 0.09), (r1 + 0.26, zf),
                                              (0, zf)], 0.025), **O8))
    for k in range(8):                        # hour-tick studs on the corbel rim
        a = k * PI / 4
        rr = (r1 + 0.26) * math.cos(PI / 8)
        B.add("accent", K.box(((rr + 0.005) * math.cos(a), (rr + 0.005) * math.sin(a), zf - 0.045), (0.02, 0.05, 0.032), 0.006, rz=a))
    zt = zf + stage_h
    a_eye(B, zf, H - 0.42, r_eye=r1 + 0.2, ring_t=0.74)
    # a dark blued-steel floor plate in the eye (the crystal reads against it from above)
    B.add("steel", K.lathe(K.chamfer_profile([(0, zf - 0.02), (r1 + 0.16, zf - 0.02), (r1 + 0.16, zf + 0.05), (0, zf + 0.05)], 0.02), **O8))
    B.add("dawnglass", ring(0.3, 0.4, zf + 0.04, zf + 0.08, 0.01, 8, PI / 8))
    for k in range(4):                        # a dawnglass cradle of shards leaning in toward the crystal
        a = k * PI / 2
        v, f = K.crystal((0, 0, 0), 0.07, 0.42, 0.06, sides=4, phase=PI / 4)
        v = K.rot(v, (0, 1, 0), -0.5)
        B.add("dawnglass", (K.rotz(K.move(v, (0.52, 0, zf + 0.06)), a), f))
    L = H - 0.42 - zf
    zc_core = zf + L * 0.42
    if bell:
        zt = zf + L * 0.74 - 0.06
        prof = [(0.0, zt - 0.02), (0.12, zt - 0.03), (0.22, zt - 0.1), (0.27, zt - 0.3), (0.3, zt - 0.62), (0.36, zt - 0.8), (0.4, zt - 0.86),
                (0.39, zt - 0.9), (0.33, zt - 0.86), (0.28, zt - 0.78), (0.23, zt - 0.6), (0.2, zt - 0.32), (0.0, zt - 0.2)]
        B.add("steel", K.lathe(prof, 24, closed=True))
        B.add("accent", ring(0.37, 0.42, zt - 0.86, zt - 0.8, 0.008, 24))
        zc_core = zt - 0.98
        B.add("accent", K.crystal((0, 0, zc_core), 0.15, 0.26, 0.34, sides=4, band=0.05, phase=PI / 4), node="core")
        return "crystal", (0, 0, zc_core)
    B.add("accent", K.crystal((0, 0, zc_core), 0.3, 0.72, 0.58, sides=4, band=0.12, phase=PI / 4), node="core")
    return "crystal", (0, 0, zc_core)


def a_eye(B, zf, tip, r_eye=0.64, ribs=4, w=0.12, ring_t=0.64, finial=0.6):
    """The needle's eye: chalk ribs rising from the floor, swelling, converging to the tip (an open
    spire around the crystal), thin steel minor ribs, a steel binding ring, a dawnglass finial."""
    L = tip - zf
    ctrl = [(r_eye, 0.0), (r_eye + 0.13, 0.22), (r_eye + 0.06, 0.48), (r_eye * 0.55, 0.76), (0.05, 1.0)]

    def prof(t):
        for i in range(len(ctrl) - 1):
            (r0, t0), (r1_, t1) = ctrl[i], ctrl[i + 1]
            if t <= t1 + 1e-9:
                u = (t - t0) / (t1 - t0)
                u = u * u * (3 - 2 * u)
                return r0 + (r1_ - r0) * u
        return ctrl[-1][0]
    ts = np.linspace(0.0, 0.985, 16)
    for k in range(ribs):
        a = PI / 4 + k * K.TAU / ribs
        path = [(prof(t) * math.cos(a), prof(t) * math.sin(a), zf + L * t) for t in ts]
        B.add("chalk", K.sweep(path, w, 0.11, sink=0.05))
        B.add("steel", K.sweep([(x * (1 + 0.11 / max(0.1, math.hypot(x, y))), y * (1 + 0.11 / max(0.1, math.hypot(x, y))), z)
                                for x, y, z in path[1:-2]], w * 0.38, 0.02, sink=0.01))
        a2 = a + PI / ribs
        tm = np.linspace(0.0, ring_t, 9)
        path = [((prof(t) - 0.05) * math.cos(a2), (prof(t) - 0.05) * math.sin(a2), zf + L * t) for t in tm]
        B.add("steel", K.sweep(path, 0.045, 0.05, sink=0.02))
    rr = prof(ring_t)
    B.add("steel", ring(rr - 0.1, rr + 0.1, zf + L * ring_t - 0.06, zf + L * ring_t + 0.06, 0.015, 8, PI / 8))
    B.add("steel", ring(0.0, 0.11, tip - 0.1, tip + 0.04, 0.012, 8, PI / 8))
    B.add("dawnglass", K.crystal((0, 0, tip + finial * 0.34), 0.11, finial * 0.66, finial * 0.34 + 0.08, sides=4, band=0.06, phase=PI / 4))


def aubade_lantern(B):
    """The lane gate: two chalk pylons under a pointed arch, a dawnglass-framed lantern hanging in it
    (the road's stored light). Lanterns never turn (facing 0): the arch faces the camera (Blender -X)."""
    dial_plinth(B, [(2.2, 0.0, 0.22), (1.88, 0.22, 0.46)], 1.64, "steel")
    z0 = 0.46
    py = 1.18
    ztop = 3.55
    for sgn in (-1, 1):
        c = np.array([0.0, sgn * py, 0.0])
        prof = K.chamfer_profile([(0, z0), (0.46, z0), (0.46, z0 + 0.3), (0.38, z0 + 0.38), (0.36, z0 + 0.62), (0.3, z0 + 0.74),
                                  (0.25, ztop - 0.25), (0.31, ztop - 0.15), (0.31, ztop), (0, ztop)], 0.025)
        v, f = K.lathe(prof, **O8)
        B.add("chalk", (K.move(v, c), f))
        for zz in (z0 + 0.62, 2.0, ztop - 0.32):
            r = 0.36 if zz < 1.2 else 0.25
            v, f = ring(r - 0.03, r + 0.05, zz - 0.06, zz + 0.06, 0.012, 8, PI / 8)
            B.add("steel", (K.move(v, c), f))
        # accent inlays climbing the pylon's camera face and its outer face
        for a in (PI, sgn * PI / 2):
            for za, zz in ((z0 + 0.86, 1.88), (2.12, ztop - 0.46)):
                path = [((0.25 + 0.05 * (1 - (z - z0) / (ztop - z0))) * math.cos(PI / 8) * math.cos(a) + c[0],
                         (0.25 + 0.05 * (1 - (z - z0) / (ztop - z0))) * math.cos(PI / 8) * math.sin(a) + c[1], z) for z in np.linspace(za, zz, 3)]
                B.add("accent", K.sweep(path, 0.06, 0.016, out_fn=lambda p, a=a: (math.cos(a), math.sin(a), 0), sink=0.01))
        # a fin buttress on the outer side, a pinnacle crown on top
        v, f = K.prism([(0.0, z0), (0.62, z0), (0.62, z0 + 0.14), (0.5, z0 + 0.3)] +
                       [(0.25 + 0.25 * (1 - t) ** 1.6, z0 + 0.3 + (2.5 - z0 - 0.3) * t) for t in np.linspace(0.1, 1, 8)] + [(0.0, 2.45)],
                       origin=(0, 0, 0), u=(0, sgn, 0), v=(0, 0, 1), depth=0.16, chamfer=0.022)
        B.add("chalk", (K.move(v, c), f))
        pinnacle(B, (c[0], c[1]), ztop, 1.2, r=0.17, tip=0.42)
        for k in range(4):
            a = PI / 4 + k * PI / 2
            pinnacle(B, (c[0] + 0.24 * math.cos(a), c[1] + 0.24 * math.sin(a)), ztop, 0.55, r=0.06, tip=0.16)
    # the pointed arch between the pylons, a steel inner arch, a threshold with the gate line
    span = 2 * py - 0.5
    rise = K.arch_apex(span, 0.0, "pointed", 0.85)
    spring = 3.0
    path = K.arch_path(span, spring, "pointed", 16, k=0.85)[1:-1]
    p3 = K.in_plane(path, (0, 0, 0), (0, 1, 0), (0, 0, 1))
    B.add("chalk", K.sweep(p3, 0.24, 0.17, out_fn=lambda p: (-1, 0, 0), sink=0.17))
    path = K.arch_path(span - 0.3, spring, "pointed", 14, k=0.85)[1:-1]
    p3 = K.in_plane(path, (0, 0, 0), (0, 1, 0), (0, 0, 1))
    B.add("steel", K.sweep(p3, 0.06, 0.06, out_fn=lambda p: (-1, 0, 0), sink=0.06))
    apex = spring + rise
    B.add("steel", K.box((0, 0, apex + 0.08), (0.2, 0.12, 0.16), 0.02))
    B.add("chalk", K.box((0, 0, z0 + 0.06), (0.42, py - 0.3, 0.06), 0.02))
    B.add("accent", K.box((-0.0, 0, z0 + 0.125), (0.05, py - 0.42, 0.012), 0.004))
    # the hanging lantern: a steel rod, a chalk hood, four steel ribs, a dawnglass foot; the crystal inside
    zl1 = apex - 0.55
    zl0 = zl1 - 1.25
    B.add("steel", K.box((0, 0, (apex + zl1) / 2), (0.03, 0.03, (apex - zl1) / 2), 0.008))
    B.add("chalk", K.lathe(K.chamfer_profile([(0, zl1 - 0.05), (0.42, zl1 - 0.05), (0.42, zl1 + 0.04), (0.06, zl1 + 0.42), (0, zl1 + 0.46)], 0.02), **O8))
    B.add("steel", K.lathe(K.chamfer_profile([(0, zl0 - 0.06), (0.36, zl0 - 0.06), (0.36, zl0 + 0.04), (0, zl0 + 0.04)], 0.015), **O8))
    for k in range(4):
        a = PI / 4 + k * PI / 2
        rr = [0.34, 0.42, 0.42, 0.36]
        zz = [zl0, zl0 + 0.35, zl1 - 0.35, zl1]
        path = [(r * math.cos(a), r * math.sin(a), z) for r, z in zip(rr, zz)]
        B.add("steel", K.sweep(path, 0.055, 0.05, sink=0.02))
    B.add("dawnglass", K.crystal((0, 0, zl0 - 0.22), 0.1, 0.16, 0.34, sides=4, phase=PI / 4))
    zc = (zl0 + zl1) / 2
    B.add("accent", K.crystal((0, 0, zc), 0.27, 0.55, 0.5, sides=4, band=0.1, phase=PI / 4), node="core")
    return "crystal", (0, 0, zc)


def aubade_hourbell(B):
    dial_plinth(B, [(3.6, 0.0, 0.24), (3.2, 0.24, 0.48), (2.85, 0.48, 0.72)], 2.55, "steel", tick_len=0.42, tick_w=0.1)
    z0 = 0.72
    zp = z0 + 0.72
    B.add("chalk", K.lathe(K.chamfer_profile([(0, z0), (2.4, z0), (2.4, z0 + 0.46), (2.3, z0 + 0.56), (2.3, zp), (0, zp)], 0.035), **O8))
    B.add("steel", ring(2.3, 2.44, z0 + 0.3, z0 + 0.4, 0.01, 8, PI / 8))
    # eight columns on the octagon's corners
    rc = 1.98
    zcap = 4.95
    for k in range(8):
        a = PI / 8 + k * PI / 4
        c = (rc * math.cos(a), rc * math.sin(a))
        prof = K.chamfer_profile([(0, zp), (0.3, zp), (0.3, zp + 0.3), (0.22, zp + 0.4), (0.2, zcap - 0.2), (0.27, zcap - 0.08),
                                  (0.27, zcap + 0.12), (0, zcap + 0.12)], 0.025)
        v, f = K.lathe(prof, 8, phase=PI / 8)
        B.add("chalk", (K.move(v, (c[0], c[1], 0)), f))
        for zz in (zp + 0.55, 3.4):
            v, f = ring(0.18, 0.235, zz, zz + 0.09, 0.008, 8, PI / 8)
            B.add("steel", (K.move(v, (c[0], c[1], 0)), f))
    # pointed arches on the eight faces
    ap = rc * math.cos(PI / 8)
    span = 2 * rc * math.sin(PI / 8) - 0.42
    rise = K.arch_apex(span, 0.0, "pointed", 0.8)
    spring = zcap + 0.12 - rise
    for k in range(8):
        a = k * PI / 4
        path = K.arch_path(span, spring, "pointed", 14, k=0.8)[1:-1]
        p3 = K.in_plane(path, (ap, 0, 0), (0, 1, 0), (0, 0, 1))
        v, f = K.sweep(p3, 0.17, 0.13, out_fn=lambda p: (1, 0, 0), sink=0.13)
        B.add("chalk", (K.rotz(v, a), f))
    ze = zcap + 0.12
    B.add("chalk", K.lathe(K.chamfer_profile([(0, ze), (2.32, ze), (2.32, ze + 0.3), (2.22, ze + 0.4), (2.22, ze + 0.52), (0, ze + 0.52)], 0.03), **O8))
    B.add("steel", ring(2.28, 2.36, ze + 0.1, ze + 0.2, 0.01, 8, PI / 8))
    zr = ze + 0.52
    # stacked: a pent-roof skirt with eight glowing dormers, an upper lancet stage holding the crystal,
    # then the tall concave spire with a dawnglass crown (the Glass Belfry language)
    rs0, rs1, zs1 = 2.3, 1.42, zr + 0.62
    B.add("chalk", K.lathe([(0, zr), (rs0, zr), (rs0, zr + 0.06), (rs1, zs1), (0, zs1)], **O8))
    skirt = [(rs0 + (rs1 - rs0) * t, zr + 0.06 + (zs1 - zr - 0.06) * t) for t in np.linspace(0, 1, 11)]
    slope_panes(B, skirt, 8, 0.0, 0.12, 0.85, 0.3)
    for k in range(8):
        a = PI / 8 + k * PI / 4
        path = [((rs0 + (rs1 - rs0) * t) * math.cos(a), (rs0 + (rs1 - rs0) * t) * math.sin(a), zr + 0.06 + (zs1 - zr - 0.06) * t)
                for t in np.linspace(0, 1, 4)]
        B.add("steel", K.sweep(path, 0.05, 0.035, out_fn=lambda p: (p[0], p[1], 1.6), sink=0.02))
    for k in range(8):                       # a crown of pinnacles on the skirt's corners
        a = PI / 8 + k * PI / 4
        pinnacle(B, (2.08 * math.cos(a), 2.08 * math.sin(a)), zr + 0.02, 1.15, r=0.11, tip=0.34)
    # the needle's eye crowns the belfry: eight chalk ribs converge over the great crystal (a roofed stage
    # would hide it from the 52-degree camera)
    zf = zs1
    tip = 10.0
    B.add("steel", K.lathe(K.chamfer_profile([(0, zf - 0.02), (1.3, zf - 0.02), (1.3, zf + 0.06), (0, zf + 0.06)], 0.02), **O8))
    B.add("dawnglass", ring(0.62, 0.74, zf + 0.05, zf + 0.1, 0.01, 8, PI / 8))
    for k in range(8):
        a = k * PI / 4
        v, f = K.crystal((0, 0, 0), 0.09, 0.62, 0.08, sides=4, phase=PI / 4)
        v = K.rot(v, (0, 1, 0), -0.45)
        B.add("dawnglass", (K.rotz(K.move(v, (0.95, 0, zf + 0.08)), a), f))
    a_eye(B, zf, tip, r_eye=1.2, ribs=8, w=0.16, ring_t=0.6, finial=0.9)
    zcore = zf + (tip - zf) * 0.4
    # the bell (blued steel) hung from a yoke; accent lip and heart
    zl, zcr = 1.9, 4.15
    hgt = zcr - zl
    pr = [(0.0, zcr), (0.35, zcr), (0.58, zcr - 0.12 * hgt), (0.7, zcr - 0.35 * hgt), (0.78, zcr - 0.65 * hgt), (0.98, zcr - 0.88 * hgt),
          (1.14, zl + 0.04), (1.12, zl), (0.98, zl + 0.02), (0.86, zl + 0.12 * hgt), (0.68, zl + 0.4 * hgt), (0.6, zl + 0.75 * hgt),
          (0.4, zcr - 0.1), (0.0, zcr - 0.1)]
    B.add("steel", K.lathe(pr, 40, closed=True))
    B.add("steel", K.lathe([(0, zcr - 0.02), (0.2, zcr - 0.02), (0.2, zcr + 0.3), (0.12, zcr + 0.42), (0, zcr + 0.42)], 12))
    for k in range(2):
        a = PI / 8 + k * PI / 2 + PI / 4
        v, f = K.box((0, 0, zcr + 0.5), (rc + 0.05, 0.11, 0.13), 0.02)
        B.add("steel", (K.rotz(v, a), f))
    B.add("accent", ring(1.08, 1.17, zl + 0.03, zl + 0.15, 0.01, 40))
    B.add("accent", ring(0.73, 0.79, zl + 0.62 * hgt, zl + 0.68 * hgt, 0.008, 40))
    B.add("accent", K.crystal((0, 0, zl + 0.35), 0.24, 0.4, 0.45, sides=4, band=0.08, phase=PI / 4))
    B.add("accent", K.crystal((0, 0, zcore), 0.46, 1.05, 0.85, sides=4, band=0.16, phase=PI / 4), node="core")
    return "crystal", (0, 0, zcore)


# ── SERENADE ─────────────────────────────────────────────────────────────────────────────────────
def s_window(B, ang, R, z_sill, w, spring, frame_mat="ironstone"):
    """A round-arched lampresin window on a drum of radius R: flat pane, swept frame, sill."""
    o = np.array([math.cos(ang), math.sin(ang), 0.0])
    u = (-math.sin(ang), math.cos(ang), 0.0)
    pane = K.arch_outline(w, spring, "round", 10)
    B.add("lampresin", K.prism(pane, origin=tuple(o * (R + 0.012) + (0, 0, z_sill)), u=u, v=(0, 0, 1), depth=0.06))
    path = K.arch_path(w + 0.07, spring, "round", 14)
    B.add(frame_mat, K.sweep(K.on_cylinder(path, R, ang, z_sill, 0.0), 0.075, 0.07, sink=0.03))
    v, f = K.box((0, 0, 0), (0.07, w / 2 + 0.1, 0.045), 0.012)
    B.add(frame_mat, (K.rotz(K.move(v, (R + 0.03, 0, z_sill - 0.02)), ang), f))
    # mullion: the pane in two lights
    v, f = K.box((0, 0, 0), (0.025, 0.018, (spring + w * 0.35) / 2), 0.005)
    B.add("iron", (K.rotz(K.move(v, (R + 0.05, 0, z_sill + (spring + w * 0.35) / 2)), ang), f))


def s_dome(B, a, b, z0, r_top, ribs=8, rib_phase=0.0, segs=40, rib_mat="sandstone", seams=True, shell=0.1):
    """Ironstone dome. seams=True: built of `ribs` gores parted by narrow slots through which an inner
    accent dome glows (the lamp shining through the dome's seams); a sandstone keel rib on every gore."""
    t1 = math.acos(r_top / a)
    pts = ellipse_pts(a, b, z0, 0.0, t1, 10)
    if not seams:
        B.add("ironstone", K.lathe([(0, z0)] + pts + [(0, pts[-1][1])], segs))
    else:
        inner = ellipse_pts(a - shell, b - shell, z0, 0.0, math.acos(min(0.999, (r_top - 0.02) / (a - shell))), 8)
        B.add("accent", K.lathe([(0, z0)] + [(r - 0.01, z) for r, z in inner] + [(0, inner[-1][1])], segs))
        gap = 0.075
        for k in range(ribs):
            g = gap / a
            a0 = rib_phase + k * K.TAU / ribs + g
            a1 = rib_phase + (k + 1) * K.TAU / ribs - g
            prof = pts + [(r, z) for r, z in inner[::-1]]
            B.add("ironstone", K.lathe(prof, max(3, segs // ribs), a0=a0, a1=a1, closed=True))
    for k in range(ribs):
        ang = rib_phase + (k + 0.5) * K.TAU / ribs if seams else rib_phase + k * K.TAU / ribs
        path = [(r * math.cos(ang), r * math.sin(ang), z) for r, z in pts]

        def out(p, a=a, b=b, z0=z0):
            rr = math.hypot(p[0], p[1]) + 1e-9
            nr, nz = rr / (a * a), (p[2] - z0) / (b * b)
            return (p[0] / rr * nr, p[1] / rr * nr, nz)
        B.add(rib_mat, K.sweep(path, 0.085 * max(1.0, a / 1.4), 0.045 * max(1.0, a / 1.4), out_fn=out, sink=0.03))
    return pts[-1][1]


def s_cupola(B, z0, r, h, posts=6, core_r=0.33, cap_b=0.42, gnomon=1.3, bell=False):
    """The lamp cupola: sandstone base ring, iron posts, lampresin bowl, accent core, ironstone cap,
    and the gnomon blade laid on top (the Serenade needle)."""
    B.add("sandstone", K.lathe(K.chamfer_profile([(0, z0), (r + 0.1, z0), (r + 0.1, z0 + 0.12), (0, z0 + 0.12)], 0.025), 32))
    zp0, zp1 = z0 + 0.12, z0 + 0.12 + h
    for k in range(posts):
        a = PI / posts + k * K.TAU / posts
        B.add("iron", K.box((r * 0.9 * math.cos(a), r * 0.9 * math.sin(a), (zp0 + zp1) / 2), (0.05, 0.05, h / 2), 0.015, rz=a))
    B.add("sandstone", K.lathe(K.chamfer_profile([(0, zp1), (r + 0.12, zp1), (r + 0.12, zp1 + 0.13), (0, zp1 + 0.13)], 0.025), 32))
    zc0 = zp1 + 0.13
    pts = ellipse_pts(r + 0.06, cap_b, zc0, 0.0, PI / 2, 8)
    B.add("ironstone", K.lathe([(0, zc0)] + pts, 32))
    B.add("sandstone", ring(0.0, 0.12, zc0 + cap_b - 0.02, zc0 + cap_b + 0.08, 0.01, 16))
    B.cap_top = zc0 + cap_b
    if gnomon > 0:
        s_gnomon(B, zc0 + cap_b + 0.04, gnomon)
    return s_cupola_core(B, r, h, zp0, zp1, core_r, bell)


def s_gnomon(B, zg, gnomon):
    """The Serenade needle laid down: a slim wedge whose concave edge rises toward the back, edged in
    sandstone, with a lampresin sun-disc set through it."""
    # gnomon blade: a slim wedge whose concave edge rises toward the back, edged in sandstone, with a
    # lampresin sun-disc set through it
    L = gnomon * 0.62
    edge = [(L * 0.5 - (L * 0.92) * t, 0.08 + gnomon * (t ** 1.9)) for t in np.linspace(0, 1, 10)]
    poly = [(L * 0.5, 0)] + edge + [(-L * 0.5, gnomon), (-L * 0.5, 0)]
    B.add("iron", K.prism(poly, origin=(0, 0, zg), u=(0, -1, 0), v=(0, 0, 1), depth=0.09, chamfer=0.016))
    B.add("sandstone", K.sweep([(0, -u, zg + v) for u, v in edge], 0.12, 0.04, out_fn=lambda p: (0, -0.5, 1.0), sink=0.02))
    dr = min(0.2, L * 0.22)
    v, f = K.lathe([(0, -0.07), (dr, -0.07), (dr + 0.03, -0.035), (dr + 0.03, 0.035), (dr, 0.07), (0, 0.07)], 20)
    v = K.rot(v, (0, 1, 0), PI / 2)
    B.add("lampresin", (K.move(v, (0, L * 0.22, zg + gnomon * 0.42)), f))
    v, f = ring(dr + 0.02, dr + 0.07, -0.06, 0.06, 0.01, 20)
    v = K.rot(v, (0, 1, 0), PI / 2)
    B.add("sandstone", (K.move(v, (0, L * 0.22, zg + gnomon * 0.42)), f))
    B.add("iron", K.lathe([(0, zg + gnomon - 0.02), (0.08, zg + gnomon - 0.02), (0.08, zg + gnomon + 0.08), (0, zg + gnomon + 0.14)], 10))


def s_cupola_core(B, r, h, zp0, zp1, core_r, bell):
    # bowl + core (or a bell with the core in its mouth)
    zcore = (zp0 + zp1) / 2 + 0.04
    if bell:
        zcr = zp1 - 0.02
        hb = h * 0.75
        prof = [(0.0, zcr), (0.14, zcr), (0.24, zcr - 0.2 * hb), (0.28, zcr - 0.6 * hb), (0.36, zcr - 0.92 * hb), (0.38, zcr - hb),
                (0.32, zcr - hb + 0.03), (0.24, zcr - 0.62 * hb), (0.2, zcr - 0.25 * hb), (0.0, zcr - 0.15 * hb)]
        B.add("iron", K.lathe(prof, 24, closed=True))
        B.add("accent", ring(0.34, 0.4, zcr - hb + 0.01, zcr - hb + 0.07, 0.008, 24))
        zcore = zcr - hb - 0.02
        sph = [(0, zcore - core_r * 0.75)] + ellipse_pts(core_r * 0.6, core_r * 0.75, zcore, -PI / 2 + 0.25, PI / 2 - 0.25, 6) + \
            [(0, zcore + core_r * 0.75)]
        B.add("accent", K.lathe(sph, 16), node="core")
        return zcore
    B.add("lampresin", K.lathe([(0, zp0 + 0.02), (r * 0.45, zp0 + 0.02), (r * 0.68, zp0 + 0.16), (r * 0.62, zp0 + 0.2), (0, zp0 + 0.12)], 24, closed=False))
    sph = [(0, zcore - core_r)] + [(core_r * math.cos(t), zcore + core_r * math.sin(t)) for t in np.linspace(-PI / 2 + 0.25, PI / 2 - 0.25, 7)] + [(0, zcore + core_r)]
    B.add("accent", K.lathe(sph, 18), node="core")
    return zcore


def s_foot(B, z0, R, h=0.38, c=(0.0, 0.0, 0.0)):
    prof = [(0, z0), (R + 0.2, z0), (R + 0.2, z0 + 0.1)]
    prof += [(R + 0.06 + 0.14 * math.cos(t), z0 + 0.1 + h * 0.4 + 0.14 * math.sin(t)) for t in np.linspace(-PI / 2, PI / 2, 7)][1:]
    prof += [(R + 0.02, z0 + h), (0, z0 + h)]
    v, f = K.lathe(prof, 48)
    B.add("ironstone", (K.move(v, c), f))
    return z0 + h


def serenade_needle(B, R=1.22, zd=2.62, n_win=4, dome_b=1.05, cup_r=0.6, cup_h=0.82, gnomon=1.45, lamps=False, bell=False):
    dial_plinth(B, [(2.02, 0.0, 0.2), (1.74, 0.2, 0.42)], 1.52, "iron")
    z = s_foot(B, 0.42, R)
    # drum: three sandstone courses with a slight batter
    nc = 3
    zs = [z + (zd - z) * i / nc for i in range(nc + 1)]

    def r_at(zz):
        return R - 0.07 * (zz - z) / (zd - z)
    for i in range(nc):
        za, zb = zs[i], zs[i + 1]
        prof = [(0, za), (r_at(za) - 0.02, za), (r_at(za), za + 0.02), (r_at(zb), zb - 0.02), (r_at(zb) - 0.02, zb), (0, zb)]
        B.add("sandstone", K.lathe(prof, 40))
    # windows between ironstone pilasters
    wz = z + 0.22
    ww = 0.5 if R < 1.25 else 0.56
    spring = (zd - 0.32) - wz - ww / 2
    for k in range(n_win):
        a = k * K.TAU / n_win
        s_window(B, a, r_at(wz + 0.5), wz, ww, spring)
        a2 = a + PI / n_win
        path = [(r_at(zz) * math.cos(a2), r_at(zz) * math.sin(a2), zz) for zz in np.linspace(z, zd, 4)]
        B.add("ironstone", K.sweep(path, 0.17, 0.05, sink=0.02))
        # a wall lamp on every pilaster: iron bracket, lampresin drop, iron hood
        zl = zd - 0.62
        rl = r_at(zl) + 0.05
        arm = [(rl - 0.04, 0, zl + 0.1), (rl + 0.12, 0, zl + 0.14), (rl + 0.26, 0, zl + 0.1)]
        v, f = K.sweep(arm, 0.045, 0.04, out_fn=lambda p: (0, 0, 1), sink=0.0)
        B.add("iron", (K.rotz(v, a2), f))
        v, f = K.lathe([(0, zl - 0.2), (0.05, zl - 0.17), (0.095, zl - 0.06), (0.085, zl + 0.03), (0, zl + 0.05)], 10)
        B.add("lampresin", (K.rotz(K.move(v, (rl + 0.26, 0, 0)), a2), f))
        v, f = K.lathe([(0, zl + 0.02), (0.11, zl + 0.02), (0.05, zl + 0.12), (0, zl + 0.13)], 10)
        B.add("iron", (K.rotz(K.move(v, (rl + 0.26, 0, 0)), a2), f))
    # cornice with twelve hour-tick dentils, the accent ring, the dome
    rt = r_at(zd)
    B.add("ironstone", K.lathe(K.chamfer_profile([(0, zd), (rt, zd), (rt + 0.16, zd + 0.12), (rt + 0.16, zd + 0.22), (rt + 0.08, zd + 0.28),
                                                  (0, zd + 0.28)], 0.02), 48))
    for k in range(12):
        a = PI / 12 + k * K.TAU / 12
        B.add("sandstone", K.box(((rt + 0.03) * math.cos(a), (rt + 0.03) * math.sin(a), zd - 0.05), (0.06, 0.08, 0.06), 0.012, rz=a))
    zr = zd + 0.28
    B.add("accent", ring(rt - 0.12, rt + 0.0, zr - 0.01, zr + 0.08, 0.01, 48))
    ztop = s_dome(B, rt - 0.08, dome_b, zr, cup_r + 0.05, ribs=8)
    B.add("ironstone", ring(rt - 0.1, rt - 0.02, zr - 0.01, zr + 0.16, 0.012, 48))
    zcore = s_cupola(B, ztop - 0.06, cup_r, cup_h, posts=4 if not bell else 6, core_r=0.42 if not bell else 0.3, cap_b=0.28, gnomon=gnomon,
                     bell=bell)
    if lamps:     # four satellite lamp posts on the plinth (the inner needle)
        for k in range(4):
            a = PI / 4 + k * PI / 2
            c = np.array([1.55 * math.cos(a), 1.55 * math.sin(a), 0.0])
            prof = K.chamfer_profile([(0, 0.4), (0.17, 0.4), (0.17, 0.55), (0.1, 0.62), (0.08, 1.35), (0.13, 1.4), (0.13, 1.46), (0, 1.46)], 0.015)
            v, f = K.lathe(prof, 10)
            B.add("ironstone", (K.move(v, c), f))
            v, f = K.lathe([(0, 1.44), (0.14, 1.44), (0.19, 1.56), (0.12, 1.64), (0, 1.62)], 12)
            B.add("lampresin", (K.move(v, c), f))
            sph = [(0, 1.52)] + [(0.1 * math.cos(t), 1.66 + 0.1 * math.sin(t)) for t in np.linspace(-1.2, 1.2, 5)] + [(0, 1.76)]
            v, f = K.lathe(sph, 10)
            B.add("accent", (K.move(v, c), f))
            v, f = K.lathe([(0, 1.74), (0.16, 1.74), (0.11, 1.84), (0, 1.9)], 10)
            B.add("iron", (K.move(v, c), f))
    return "lamp", (0, 0, zcore)


def serenade_lantern(B):
    """The lane gate: two squat banded piers capped by small ribbed domes under a heavy round arch with an
    ironstone keystone; an iron-strapped lamp-pot (lampresin bowl, accent core) hangs in the arch."""
    dial_plinth(B, [(2.26, 0.0, 0.2), (1.94, 0.2, 0.42)], 1.72, "iron")
    z0 = 0.42
    py = 1.24
    zp = 2.75
    for sgn in (-1, 1):
        c = np.array([0.0, sgn * py, 0.0])
        zt = s_foot(B, z0, 0.44, 0.3, c=c)
        prof = [(0, zt), (0.47, zt), (0.44, zp), (0, zp)]
        v, f = K.lathe(prof, 32)
        B.add("sandstone", (K.move(v, c), f))
        for zz in (1.25, zp - 0.12):
            v, f = ring(0.42, 0.52, zz - 0.07, zz + 0.07, 0.015, 32)
            B.add("ironstone", (K.move(v, c), f))
        v, f = K.lathe(K.chamfer_profile([(0, zp), (0.58, zp), (0.58, zp + 0.14), (0.5, zp + 0.2), (0, zp + 0.2)], 0.02), 32)
        B.add("ironstone", (K.move(v, c), f))
        # a small dome with glowing seams on each pier
        pts = ellipse_pts(0.48, 0.42, zp + 0.2, 0.0, math.acos(0.12 / 0.48), 8)
        inner = ellipse_pts(0.42, 0.36, zp + 0.2, 0.0, math.acos(0.1 / 0.42), 8)
        v, f = K.lathe([(0, zp + 0.2)] + [(r - 0.01, z) for r, z in inner] + [(0, inner[-1][1])], 24)
        B.add("accent", (K.move(v, c), f))
        for k in range(6):
            g = 0.055 / 0.48
            v, f = K.lathe(pts + [(r, z) for r, z in inner[::-1]], 4, a0=k * K.TAU / 6 + g, a1=(k + 1) * K.TAU / 6 - g, closed=True)
            B.add("ironstone", (K.move(v, c), f))
        v, f = K.lathe([(0, pts[-1][1] - 0.02), (0.13, pts[-1][1] - 0.02), (0.13, pts[-1][1] + 0.06), (0.06, pts[-1][1] + 0.22), (0, pts[-1][1] + 0.3)], 12)
        B.add("sandstone", (K.move(v, c), f))
        # an arched lampresin window on each pier's camera face
        o = np.array([-1.0, 0.0, 0.0])
        pane = K.arch_outline(0.26, 0.42, "round", 8)
        B.add("lampresin", K.prism(pane, origin=tuple(c + o * 0.45 + (0, 0, 1.5)), u=(0, -1, 0), v=(0, 0, 1), depth=0.06))
        path = K.arch_path(0.32, 0.42, "round", 10)
        p3 = K.in_plane(path, tuple(c + o * 0.46 + (0, 0, 1.5)), (0, -1, 0), (0, 0, 1))
        B.add("ironstone", K.sweep(p3, 0.06, 0.06, out_fn=lambda p: (-1, 0, 0), sink=0.04))
    # the heavy round arch: sandstone voussoirs (each its own stone), an ironstone keystone
    span = 2 * py - 0.88
    spring = zp - 0.1
    R = span / 2 + 0.17
    nv = 9
    for i in range(nv):
        a0 = PI * i / nv + 0.012
        a1 = PI * (i + 1) / nv - 0.012
        mat = "ironstone" if i == nv // 2 else "sandstone"
        ro = R + (0.42 if i == nv // 2 else 0.3)
        poly = [(math.cos(a) * (R - 0.17), math.sin(a) * (R - 0.17)) for a in np.linspace(a0, a1, 3)] + \
               [(math.cos(a) * ro, math.sin(a) * ro) for a in np.linspace(a1, a0, 3)]
        B.add(mat, K.prism(poly, origin=(0, 0, spring), u=(0, 1, 0), v=(0, 0, 1), depth=0.4 if mat == "sandstone" else 0.48, chamfer=0.02))
    apex = spring + R + 0.42
    # the lamp-pot: an iron cap, six iron straps around the accent core, a lampresin bowl
    zl1 = spring + R - 0.32
    zl0 = zl1 - 0.95
    B.add("iron", K.box((0, 0, (spring + R - 0.17 + zl1) / 2), (0.035, 0.035, (spring + R - 0.17 - zl1) / 2 + 0.02), 0.008))
    B.add("ironstone", K.lathe(K.chamfer_profile([(0, zl1 - 0.04), (0.4, zl1 - 0.04), (0.4, zl1 + 0.04)] +
                                                 ellipse_pts(0.4, 0.22, zl1 + 0.04, 0.0, PI / 2, 5)[1:], 0.015), 24))
    for k in range(6):
        a = k * K.TAU / 6
        path = [(0.36 * math.cos(t) * math.cos(a) + 0.0, 0.36 * math.cos(t) * math.sin(a), (zl0 + zl1) / 2 + 0.47 * math.sin(t))
                for t in np.linspace(-PI / 2 + 0.35, PI / 2 - 0.15, 7)]
        B.add("iron", K.sweep(path, 0.05, 0.04, out_fn=lambda p, zc=(zl0 + zl1) / 2: (p[0], p[1], (p[2] - zc) * 0.6), sink=0.015))
    B.add("lampresin", K.lathe([(0, zl0 - 0.06), (0.16, zl0 - 0.06), (0.3, zl0 + 0.08), (0.24, zl0 + 0.12), (0, zl0 + 0.04)], 20))
    B.add("iron", K.lathe([(0, zl0 - 0.2), (0.05, zl0 - 0.18), (0.08, zl0 - 0.05), (0, zl0 - 0.05)], 8))
    zc = (zl0 + zl1) / 2 + 0.04
    sph = [(0, zc - 0.31)] + [(0.31 * math.cos(t), zc + 0.31 * math.sin(t)) for t in np.linspace(-PI / 2 + 0.25, PI / 2 - 0.25, 7)] + [(0, zc + 0.31)]
    B.add("accent", K.lathe(sph, 18), node="core")
    B.add("ironstone", K.box((0, 0, z0 + 0.06), (0.42, py - 0.45, 0.06), 0.02))
    B.add("accent", K.box((0, 0, z0 + 0.125), (0.05, py - 0.55, 0.012), 0.004))
    return "lamp", (0, 0, zc)


def serenade_hourbell(B):
    dial_plinth(B, [(3.72, 0.0, 0.22), (3.34, 0.22, 0.44), (3.0, 0.44, 0.66)], 2.72, "iron", tick_len=0.42, tick_w=0.1)
    z0 = 0.66
    R = 2.4
    zt = s_foot(B, z0, R, 0.34)
    za0, zs = zt, 2.5                       # arcade: piers, round arches, spandrels
    npier = 8
    pa = 0.36
    for k in range(npier):
        a = PI / 8 + k * K.TAU / npier
        c = (R * math.cos(a), R * math.sin(a))
        B.add("sandstone", K.box((c[0], c[1], (za0 + 3.2) / 2), (0.3, pa, (3.2 - za0) / 2), 0.035, rz=a))
        B.add("ironstone", K.box((c[0], c[1], za0 + 0.16), (0.36, pa + 0.06, 0.16), 0.03, rz=a))
        B.add("ironstone", K.box((c[0], c[1], zs - 0.04), (0.35, pa + 0.05, 0.08), 0.02, rz=a))
    span = R * K.TAU / npier - 2 * pa
    for k in range(npier):
        a = k * K.TAU / npier
        path = K.arch_path(span + 0.04, zs, "round", 12)[1:-1]
        B.add("sandstone", K.sweep(K.on_cylinder([(u, v) for u, v in path], R + 0.02, a, 0.0), 0.24, 0.3, sink=0.2))
        apex = zs + span / 2 + 0.14
        o = np.array([math.cos(a), math.sin(a), 0.0])
        u = (-math.sin(a), math.cos(a), 0.0)
        for side in (-1, 1):
            arc = [(side * (span / 2 + 0.02) * math.cos(t), zs + (span / 2 + 0.02) * math.sin(t)) for t in np.linspace(0, PI / 2, 7)]
            poly = [(side * (span / 2 + 0.2), zs), (side * (span / 2 + 0.2), apex + 0.1), (0, apex + 0.1)] + arc[::-1]
            if side < 0:
                poly = poly[::-1]
            B.add("sandstone", K.prism(poly, origin=tuple(o * (R - 0.02)), u=u, v=(0, 0, 1), depth=0.36))
    zdr = zs + span / 2 + 0.24
    B.add("sandstone", K.lathe(K.chamfer_profile([(0, 3.15), (R + 0.22, 3.15), (R + 0.22, zdr), (0, zdr)], 0.02), 48))
    B.add("ironstone", K.lathe(K.chamfer_profile([(0, zdr), (R + 0.24, zdr), (R + 0.42, zdr + 0.16), (R + 0.42, zdr + 0.3), (R + 0.32, zdr + 0.38),
                                                  (0, zdr + 0.38)], 0.025), 48))
    for k in range(16):
        a = PI / 16 + k * K.TAU / 16
        B.add("sandstone", K.box(((R + 0.26) * math.cos(a), (R + 0.26) * math.sin(a), zdr - 0.07), (0.08, 0.12, 0.07), 0.012, rz=a))
    zr = zdr + 0.38
    rt = R + 0.22
    B.add("accent", ring(rt - 0.24, rt - 0.06, zr - 0.01, zr + 0.11, 0.012, 48))
    ztop = s_dome(B, rt - 0.16, 1.85, zr, 0.86, ribs=8, segs=40)
    B.add("ironstone", ring(rt - 0.22, rt - 0.12, zr - 0.01, zr + 0.24, 0.012, 48))
    zcore = s_cupola(B, ztop - 0.1, 0.78, 0.86, posts=8, core_r=0.46, cap_b=0.42, gnomon=0)
    # under the dome a lampresin brazier keeps the arcade lit (seen through the arches)
    B.add("sandstone", K.lathe(K.chamfer_profile([(0, zt), (0.62, zt), (0.62, zt + 0.12), (0.42, zt + 0.22), (0.36, zt + 0.55), (0, zt + 0.55)], 0.02), 24))
    B.add("lampresin", K.lathe([(0, zt + 0.5), (0.4, zt + 0.5), (0.95, zt + 0.86), (1.0, zt + 0.95), (0.9, zt + 0.98), (0, zt + 0.72)], 32))
    B.add("accent", K.lathe([(0, zt + 0.7)] + [(0.62 * math.cos(t), zt + 1.05 + 0.5 * math.sin(t)) for t in np.linspace(-1.0, 1.3, 6)] + [(0, zt + 1.62)], 16))
    # the Hourbell itself hangs in the open air, in a crown of two crossed iron arches over the lamp
    # cupola (inside the drum it would be invisible from the 52-degree camera)
    za = B.cap_top - 0.04
    ra, ha = 0.82, 1.45
    B.add("sandstone", ring(0.0, 0.3, za - 0.02, za + 0.1, 0.015, 24))
    for k in range(2):
        a = PI / 4 + k * PI / 2
        u = np.array([math.cos(a), math.sin(a), 0.0])
        path = [tuple(u * ra * math.cos(t) + np.array([0, 0, za + ha * math.sin(t)])) for t in np.linspace(0.0, PI, 15)]
        nrm = np.cross(u, (0, 0, 1))
        B.add("iron", K.sweep(path, 0.1, 0.05, out_fn=lambda p, za=za: (p[0], p[1], (p[2] - za) * 0.4), sink=0.05))
        for sgn in (-1, 1):
            B.add("sandstone", K.box(tuple(u * ra * sgn + np.array([0, 0, za + 0.08])), (0.13, 0.13, 0.1), 0.02, rz=a))
    zap = za + ha
    B.add("iron", K.lathe([(0, zap - 0.12), (0.14, zap - 0.1), (0.16, zap + 0.04), (0.08, zap + 0.12), (0, zap + 0.13)], 12))
    s_gnomon(B, zap + 0.08, 0.75)
    zcr = zap - 0.14
    hb = 0.86
    zl = zcr - hb
    pr = [(0.0, zcr), (0.2, zcr), (0.33, zcr - 0.12 * hb), (0.39, zcr - 0.35 * hb), (0.43, zcr - 0.65 * hb), (0.53, zcr - 0.88 * hb),
          (0.62, zl + 0.03), (0.61, zl), (0.53, zl + 0.015), (0.47, zl + 0.12 * hb), (0.38, zl + 0.4 * hb), (0.34, zl + 0.75 * hb),
          (0.22, zcr - 0.06), (0.0, zcr - 0.06)]
    B.add("iron", K.lathe(pr, 24, closed=True))
    B.add("iron", K.lathe([(0, zcr - 0.02), (0.07, zcr - 0.02), (0.07, zap - 0.08), (0, zap - 0.08)], 8))
    B.add("sandstone", ring(0.41, 0.47, zcr - 0.5 * hb, zcr - 0.42 * hb, 0.008, 32))
    B.add("accent", ring(0.58, 0.65, zl + 0.015, zl + 0.085, 0.01, 32))
    B.add("accent", K.lathe([(0, zl + 0.02)] + [(0.18 * math.cos(t), zl + 0.2 + 0.2 * math.sin(t)) for t in np.linspace(-1.2, 1.2, 5)] + [(0, zl + 0.42)], 12))
    return "lamp", (0, 0, zcore)


# ── registry: (unit id, culture) -> (builder, size, texture) ─────────────────────────────────────
DESIGNS = {
    ("needle_outer", "aubade"): (lambda B: aubade_needle(B, 7.3, 4.15, r0=0.7, r1=0.56), 1024),
    ("needle_inner", "aubade"): (lambda B: aubade_needle(B, 7.8, 4.45, r0=0.74, r1=0.6, fins=8, bands=3, pinnacles=True), 1024),
    ("needle_bell", "aubade"): (lambda B: aubade_needle(B, 6.8, 3.75, r0=0.66, r1=0.53, bands=2, bell=True), 1024),
    ("lantern", "aubade"): (aubade_lantern, 1024),
    ("hourbell", "aubade"): (aubade_hourbell, 2048),
    ("needle_outer", "serenade"): (lambda B: serenade_needle(B), 1024),
    ("needle_inner", "serenade"): (lambda B: serenade_needle(B, R=1.26, zd=2.85, n_win=6, dome_b=1.15, cup_r=0.56, cup_h=0.76, gnomon=1.5, lamps=True), 1024),
    ("needle_bell", "serenade"): (lambda B: serenade_needle(B, R=1.1, zd=2.4, n_win=4, dome_b=0.95, cup_r=0.5, cup_h=0.86, gnomon=1.15, bell=True), 1024),
    ("lantern", "serenade"): (serenade_lantern, 1024),
    ("hourbell", "serenade"): (serenade_hourbell, 2048),
}
UNITS = ["needle_outer", "needle_inner", "needle_bell", "lantern", "hourbell"]
CULTURES = ["aubade", "serenade"]
HEIGHT = {"needle_outer": 7.0, "needle_inner": 7.5, "needle_bell": 6.5, "lantern": 4.5, "hourbell": 9.0}


def glb_path(uid: str, culture: str) -> str:
    return os.path.join(OUT, f"{uid}_{culture}.glb")


def raw_path(uid: str, culture: str) -> str:
    return os.path.join(SCRATCH, "raw", f"{uid}_{culture}.glb")


def sheet_path(uid: str, culture: str) -> str:
    return raw_path(uid, culture) if os.path.isfile(raw_path(uid, culture)) else glb_path(uid, culture)


def build_one(uid: str, culture: str, fast: bool = False) -> dict:
    from common import export as X
    scene.reset()
    col = scene.collection(f"{uid}_{culture}")
    fn, size = DESIGNS[(uid, culture)]
    mats_spec = AUBADE_MATS if culture == "aubade" else SERENADE_MATS
    B = K.Build(f"{uid}_{culture}", HEIGHT[uid])
    kind, pivot = fn(B)
    zmax = max(float(v[:, 2].max()) for lst in B.parts.values() for v, _, _ in lst)
    K.paint_set(mats_spec, zmax)
    objs = B.objects(col)
    body = objs["body"]
    K.drop_hidden_bottoms(body)
    others = [o for n, o in objs.items() if n != "body"]
    buried = K.drop_buried_faces(body, others)
    scene.log(f"{uid}_{culture}: {buried} buried faces dropped")
    tris = sum(len(p.vertices) - 2 for o in objs.values() for p in o.data.polygons)
    K.bake_body(body, others, os.path.join(SCRATCH), f"{uid}_{culture}", size=512 if fast else size,
                samples=6 if fast else 24, ao_samples=16 if fast else 96, ao_distance=1.2 if uid == "hourbell" else 0.8)
    root = bpy.data.objects.new(f"{uid}_{culture}", None)
    col.objects.link(root)
    for n, o in objs.items():
        o.parent = root
    core = objs.get("core")
    if core is not None:
        me = core.data
        me.transform(Matrix.Translation((-pivot[0], -pivot[1], -pivot[2])))
        core_anim(core, kind, pivot)
    path = glb_path(uid, culture)
    K.export_glb(root, path)
    raw = os.path.getsize(path)
    import shutil
    os.makedirs(os.path.join(SCRATCH, "raw"), exist_ok=True)
    shutil.copyfile(path, raw_path(uid, culture))        # the contact sheet imports the unquantized export
    X.optimize(path, fighter=True)
    rep = {"unit": uid, "culture": culture, "tris": tris, "height": round(zmax, 2), "kb_raw": raw // 1024,
           "kb": os.path.getsize(path) // 1024, "texture": 512 if fast else size, "buried_faces_dropped": buried,
           "clips": ["idle", "attack1", "death"] if core is not None else []}
    scene.log(f"{uid}_{culture}: {rep}")
    return rep


def preview(paths: dict, out_png: str, fast: bool = False, pitch_deg: float = 40.0, lens: float = 40.0, w: int = 2400, h: int = 1240):
    """Both cultures in the game's light: Aubade in the front row, Serenade behind, left to right
    needle_outer, needle_inner, needle_bell, lantern, hourbell; framed to what was built."""
    from common import render
    scene.reset()
    light = render.map_lighting("map_rift")
    render.sky_world(light["sky"], light["ambient"], camera_strength=0.9)
    order = [u for u in UNITS if any((u, c) in paths and os.path.isfile(paths[(u, c)]) for c in CULTURES)]
    gapx = {"needle_outer": 5.2, "needle_inner": 5.2, "needle_bell": 5.2, "lantern": 5.6, "hourbell": 8.4}
    x = 0.0
    xs = {}
    for i, u in enumerate(order):
        if i:
            x += (gapx[order[i - 1]] + gapx[u]) / 2
        xs[u] = x
    lo = Vector((1e9, 1e9, 0.0))
    hi = Vector((-1e9, -1e9, 0.0))
    for (uid, culture), p in paths.items():
        if uid not in xs or not os.path.isfile(p):
            continue
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=p)
        new = [o for o in bpy.context.scene.objects if o not in before]
        bpy.context.scene.frame_set(0)
        for o in new:
            if o.animation_data:
                o.animation_data.action = None
            o.animation_data_clear()
        for o in new:
            if o.name.endswith("_core"):
                o.scale = (1.0, 1.0, 1.0)
                o.rotation_mode = "QUATERNION"
                o.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        y = 0.0 if culture == "aubade" else 8.0
        for r in [o for o in new if o.parent is None]:
            r.location = (xs[uid], y, 0.0)
            r.rotation_mode = "XYZ"
            r.rotation_euler = (0.0, 0.0, PI / 2)
        lo = Vector((min(lo.x, xs[uid] - 3), min(lo.y, y - 3), 0))
        hi = Vector((max(hi.x, xs[uid] + 3), max(hi.y, y + 3), 9.0))
    import bmesh as _bm
    g = bpy.data.meshes.new("ground")
    bm = _bm.new()
    _bm.ops.create_grid(bm, x_segments=1, y_segments=1, size=80.0)
    bm.to_mesh(g)
    bm.free()
    go = bpy.data.objects.new("ground", g)
    bpy.context.scene.collection.objects.link(go)
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*scene.hex_rgb("#77726A"), 1.0)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    g.materials.append(gm)
    cam = render.camera(lens=lens)
    tgt = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2 - 0.5, 2.4))
    span = max(hi.x - lo.x + 3.0, (hi.y - lo.y) * 1.6, 10.0)
    d = span * 0.5 / math.tan(math.atan(18.0 / lens)) * 1.06
    pitch = math.radians(pitch_deg)
    cam.location = tgt + Vector((0.0, -d * math.cos(pitch), d * math.sin(pitch)))
    render.look_at(cam, tgt, cam.location)
    bpy.context.scene.camera = cam
    render.sun_lamp(render.view_dir_light(cam, 225.0, 52.0), light["sunIntensity"] * 0.9, scene.hex_rgb(light["sunColor"]))
    render.setup(w, h, 24 if fast else 128, transparent=False, view="Khronos PBR Neutral")
    bpy.context.scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    scene.log(f"preview {scene.rel(out_png)}")


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="", help="unit ids (needle_outer,...)")
    p.add_argument("--culture", default="", help="aubade | serenade (default both)")
    p.add_argument("--preview", action="store_true")
    p.add_argument("--preview-only", action="store_true")
    p.add_argument("--fast", action="store_true")
    p.add_argument("--look", default="", help="preview only these units, closer, to this png name")
    a = p.parse_args(scene.script_args())
    units = [u for u in UNITS if not a.only or u in a.only.split(",")]
    cultures = [c for c in CULTURES if not a.culture or c in a.culture.split(",")]
    reports = []
    if not a.preview_only:
        for uid in units:
            for c in cultures:
                reports.append(build_one(uid, c, a.fast))
        rp = os.path.join(RENDERS, "build_report_structures.json")
        old = scene.read_json(rp, {}) or {}
        for r in reports:
            old[f"{r['unit']}_{r['culture']}"] = r
        scene.write_json(rp, old)
    if a.look:
        preview({(u, c): sheet_path(u, c) for u in units for c in CULTURES}, os.path.join(SCRATCH, f"{a.look}.png"), a.fast,
                pitch_deg=48.0, lens=50.0, w=1800, h=1100)
    elif a.preview or a.preview_only:
        preview({(u, c): sheet_path(u, c) for u in UNITS for c in CULTURES}, os.path.join(RENDERS, "structures.png"), a.fast)


if __name__ == "__main__":
    main()
