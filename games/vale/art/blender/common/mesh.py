"""Modelling helpers that produce professional, non-primitive forms.

Toolbox (all deterministic, all in world space with object transforms left at identity so that
object-space texture coordinates equal world coordinates and parts can be joined freely):

  sweep / loft          lofted surfaces along smooth paths with superellipse cross sections,
                        per-station radii, asymmetric front/back depth and round/point caps
                        (limbs, torsos, horns, blades, tails, handles, straps)
  skin_body             Skin-modifier body from an edge skeleton with per-vertex radii + subdiv
  union_fillet          voxel union of overlapping parts + smoothing only where parts meet
                        (organic junction fillets, like a sculpt) -> the HIGH body
  plate                 hard-surface armour conformed to a target surface: structured grid in a
                        cylindrical/spherical parameter space, ray-projected, smoothed so it
                        reads as rigid metal, solidified, raised rim, bevelled, weighted normals
  cloth_panel           hanging solidified cloth (tabards, capes, sashes) with folds, flare and
                        a shaped hem, pushed out of the body
  decimate_to, cleanup, mirror_x, shade, weighted_normals, apply_modifiers, join, tri_count
  bind_rigid / bind_auto / chain_weights / limit_weights   skinning helpers

Boolean-free by design (booleans are fragile headless and wreck topology).
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

from . import scene

V = Vector


# ── basics ───────────────────────────────────────────────────────────────────────────────────────
def bm_to_obj(bm: bmesh.types.BMesh, name: str, col=None, smooth: bool = True) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    return scene.new_object(name, me, col)


def obj_bm(obj) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    return bm


def tri_count(obj, evaluated: bool = True) -> int:
    if evaluated:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        n = sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
        return n
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def apply_modifiers(obj, keep=("ARMATURE",)) -> None:
    scene.select_only([obj], obj)
    for m in list(obj.modifiers):
        if m.type in keep:
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:  # disabled / no effect modifiers
            scene.log(f"modifier {m.name} on {obj.name} not applied: {e}")
            obj.modifiers.remove(m)


def duplicate(obj, name: str, col=None, apply=False) -> bpy.types.Object:
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    new.data.name = name
    scene.link(new, col or (obj.users_collection[0] if obj.users_collection else None))
    if apply:
        apply_modifiers(new)
    return new


def join(objs, name: str) -> bpy.types.Object:
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    scene.select_only(objs, objs[0])
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def cleanup(obj, merge: float = 1e-4, recalc: bool = True, loose: bool = True) -> None:
    bm = obj_bm(obj)
    if merge > 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
    if loose:
        loose_v = [v for v in bm.verts if not v.link_faces]
        if loose_v:
            bmesh.ops.delete(bm, geom=loose_v, context="VERTS")
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def shade(obj, smooth: bool = True, sharp_angle: float | None = None) -> None:
    me = obj.data
    if smooth:
        me.shade_smooth()
        if sharp_angle is not None:
            me.set_sharp_from_angle(angle=math.radians(sharp_angle))
    else:
        me.shade_flat()


def weighted_normals(obj, weight: int = 50, apply: bool = True) -> None:
    m = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    m.weight = weight
    m.keep_sharp = True
    m.mode = "FACE_AREA"
    if apply:
        apply_modifiers(obj)


def bevel(obj, width: float, segments: int = 2, angle: float = 35.0, profile: float = 0.5,
          harden: bool = True, apply: bool = True, clamp: bool = True) -> None:
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.profile = profile
    m.harden_normals = harden
    m.use_clamp_overlap = clamp
    m.miter_outer = "MITER_ARC"
    if apply:
        apply_modifiers(obj)


def solidify(obj, thickness: float, offset: float = -1.0, rim: bool = True, apply: bool = True,
             even: bool = True) -> None:
    m = obj.modifiers.new("Solidify", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    m.use_rim = rim
    m.use_even_offset = even
    m.use_quality_normals = True
    if apply:
        apply_modifiers(obj)


def subdivide(obj, levels: int = 1, apply: bool = True, crease_boundary: bool = False) -> None:
    m = obj.modifiers.new("Subdivision", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    m.quality = 3
    m.boundary_smooth = "PRESERVE_CORNERS" if crease_boundary else "ALL"
    if apply:
        apply_modifiers(obj)


def smooth(obj, factor: float = 0.5, iterations: int = 5, group: str | None = None, apply=True) -> None:
    m = obj.modifiers.new("Smooth", "SMOOTH")
    m.factor = factor
    m.iterations = iterations
    if group:
        m.vertex_group = group
    if apply:
        apply_modifiers(obj)


def mirror_x(obj, merge: float = 1e-4, apply: bool = True) -> None:
    """Model the +X (character's left) half, mirror to -X and weld the seam."""
    m = obj.modifiers.new("Mirror", "MIRROR")
    m.use_axis = (True, False, False)
    m.use_clip = True
    m.use_mirror_merge = True
    m.merge_threshold = merge
    if apply:
        apply_modifiers(obj)


def decimate_to(obj, target_tris: int, symmetric: bool = True) -> int:
    """Collapse-decimate to roughly `target_tris` triangles. Returns the resulting count."""
    cur = tri_count(obj, evaluated=False)
    if cur <= target_tris:
        return cur
    m = obj.modifiers.new("Decimate", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = max(0.001, target_tris / cur)
    m.use_symmetry = symmetric
    m.symmetry_axis = "X"
    m.use_collapse_triangulate = True
    apply_modifiers(obj)
    return tri_count(obj, evaluated=False)


def set_part(obj, part: int) -> None:
    """Tag every vertex with an integer `vale_part` id (bake explodes parts apart by it)."""
    me = obj.data
    attr = me.attributes.get("vale_part") or me.attributes.new("vale_part", "INT", "POINT")
    attr.data.foreach_set("value", [part] * len(me.vertices))


def set_material(obj, mat) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ── smooth paths and profiles ───────────────────────────────────────────────────────────────────
def catmull_rom(points, samples: int) -> list[Vector]:
    """Centripetal Catmull-Rom through `points`, resampled to `samples` points by arc length."""
    pts = [V(p) for p in points]
    if len(pts) == 2:
        return [pts[0].lerp(pts[1], i / (samples - 1)) for i in range(samples)]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    dense: list[Vector] = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        t0 = 0.0
        t1 = t0 + max((p1 - p0).length ** 0.5, 1e-6)
        t2 = t1 + max((p2 - p1).length ** 0.5, 1e-6)
        t3 = t2 + max((p3 - p2).length ** 0.5, 1e-6)
        for k in range(24):
            t = t1 + (t2 - t1) * k / 24
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            dense.append(b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1)))
    dense.append(pts[-1])
    return resample(dense, samples)


def resample(dense, samples: int) -> list[Vector]:
    acc = [0.0]
    for i in range(1, len(dense)):
        acc.append(acc[-1] + (dense[i] - dense[i - 1]).length)
    total = acc[-1] or 1.0
    out = []
    j = 0
    for i in range(samples):
        d = total * i / (samples - 1)
        while j < len(acc) - 2 and acc[j + 1] < d:
            j += 1
        seg = (acc[j + 1] - acc[j]) or 1.0
        out.append(dense[j].lerp(dense[j + 1], (d - acc[j]) / seg))
    return out


def smoothstep(a: float, b: float, x: float) -> float:
    if a == b:
        return 1.0 if x >= b else 0.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def profile(keys, t: float) -> float:
    """Smooth (cubic Hermite, monotone-ish) interpolation of [(t, value), ...] at t in [0, 1]."""
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    for i in range(len(keys) - 1):
        t0, v0 = keys[i]
        t1, v1 = keys[i + 1]
        if t0 <= t <= t1:
            u = (t - t0) / ((t1 - t0) or 1.0)
            # tangents from neighbours (Catmull-Rom), clamped to avoid overshoot
            vm = keys[i - 1][1] if i > 0 else v0
            vp = keys[i + 2][1] if i + 2 < len(keys) else v1
            m0 = 0.5 * (v1 - vm)
            m1 = 0.5 * (vp - v0)
            if (v1 - v0) * m0 <= 0:
                m0 = 0.0
            if (v1 - v0) * m1 <= 0:
                m1 = 0.0
            h00 = 2 * u ** 3 - 3 * u ** 2 + 1
            h10 = u ** 3 - 2 * u ** 2 + u
            h01 = -2 * u ** 3 + 3 * u ** 2
            h11 = u ** 3 - u ** 2
            return h00 * v0 + h10 * m0 + h01 * v1 + h11 * m1
    return keys[-1][1]


def transport_frames(path, up_hint) -> list[tuple[Vector, Vector, Vector]]:
    """Parallel-transport frames (T, N, B) along `path`; N starts as `up_hint` made orthogonal."""
    n = len(path)
    tans = []
    for i in range(n):
        a = path[max(0, i - 1)]
        b = path[min(n - 1, i + 1)]
        tans.append((b - a).normalized())
    up = V(up_hint).normalized()
    N = (up - tans[0] * up.dot(tans[0]))
    if N.length < 1e-6:
        N = tans[0].orthogonal()
    N.normalize()
    frames = []
    for i in range(n):
        T = tans[i]
        if i > 0:
            prev_T = tans[i - 1]
            axis = prev_T.cross(T)
            if axis.length > 1e-8:
                ang = prev_T.angle(T)
                N = Matrix.Rotation(ang, 3, axis.normalized()) @ N
            N = (N - T * N.dot(T)).normalized()
        B = T.cross(N).normalized()
        frames.append((T.copy(), N.copy(), B))
    return frames


# ── lofts ────────────────────────────────────────────────────────────────────────────────────────
def _section(seg: int, rx: float, ry: float, rx2: float, ry2: float, exp: float, phase: float = 0.0):
    """Superellipse ring in the (B, N) plane. rx/rx2: +B/-B half widths, ry/ry2: +N/-N depths."""
    pts = []
    e = 2.0 / max(exp, 0.1)
    for k in range(seg):
        a = 2 * math.pi * k / seg + phase
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** e, c) * (rx if c >= 0 else rx2)
        y = math.copysign(abs(s) ** e, s) * (ry if s >= 0 else ry2)
        pts.append((x, y))
    return pts


def loft(stations, segments: int = 16, caps=("round", "round"), up=(0, -1, 0), rings: int | None = None,
         name: str = "loft", col=None, cap_len: float = 0.6, smooth_path: bool = True) -> bpy.types.Object:
    """Loft superellipse sections along a smooth path.

    stations: list of dicts {p: point, rx, ry, [rx2], [ry2], [exp], [twist] (deg), [off]: (db, dn)}
      rx along B (= T x N), ry along N; N starts at `up` (e.g. FRONT for a vertical torso, so ry is
      the depth toward the front and ry2 toward the back). Values are interpolated smoothly.
    caps: per end 'round' | 'point' | 'flat' | None.
    rings: number of rings along the path (default: ~ every 2.5 cm, min 6).
    """
    pts = [V(s["p"]) for s in stations]
    length = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))
    rings = rings or max(6, int(length / 0.025))
    path = catmull_rom(pts, rings) if smooth_path and len(pts) > 2 else catmull_rom(pts, rings)
    # station parameter by arc length along the control polygon
    acc = [0.0]
    for i in range(1, len(pts)):
        acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
    st = [a / (acc[-1] or 1.0) for a in acc]

    def key(name_, default=None):
        out = []
        for s, t in zip(stations, st):
            v = s.get(name_, None)
            if v is None:
                v = default(s) if callable(default) else default
            out.append((t, v))
        return out

    k_rx = key("rx")
    k_ry = key("ry")
    k_rx2 = key("rx2", lambda s: s["rx"])
    k_ry2 = key("ry2", lambda s: s["ry"])
    k_exp = key("exp", 2.0)
    k_tw = key("twist", 0.0)
    k_ob = [(t, (s.get("off") or (0.0, 0.0))[0]) for s, t in zip(stations, st)]
    k_on = [(t, (s.get("off") or (0.0, 0.0))[1]) for s, t in zip(stations, st)]
    frames = transport_frames(path, up)
    # arc-length param of the resampled path
    acc2 = [0.0]
    for i in range(1, len(path)):
        acc2.append(acc2[-1] + (path[i] - path[i - 1]).length)
    bm = bmesh.new()
    ring_verts = []
    for i, (c, (T, N, B)) in enumerate(zip(path, frames)):
        t = acc2[i] / (acc2[-1] or 1.0)
        tw = math.radians(profile(k_tw, t))
        if tw:
            rot = Matrix.Rotation(tw, 3, T)
            N2, B2 = rot @ N, rot @ B
        else:
            N2, B2 = N, B
        sec = _section(segments, profile(k_rx, t), profile(k_ry, t), profile(k_rx2, t), profile(k_ry2, t),
                       profile(k_exp, t))
        cc = c + B2 * profile(k_ob, t) + N2 * profile(k_on, t)
        ring_verts.append([bm.verts.new(cc + B2 * x + N2 * y) for x, y in sec])
    for i in range(len(ring_verts) - 1):
        a, b = ring_verts[i], ring_verts[i + 1]
        for k in range(segments):
            k2 = (k + 1) % segments
            bm.faces.new((a[k], a[k2], b[k2], b[k]))

    def cap(ring, center, T, kind, sign):
        if kind is None:
            return
        if kind == "flat":
            cv = bm.verts.new(center)
            for k in range(segments):
                k2 = (k + 1) % segments
                f = (ring[k2], ring[k], cv) if sign > 0 else (ring[k], ring[k2], cv)
                bm.faces.new(f)
            return
        rad = sum((v.co - center).length for v in ring) / len(ring)
        steps = 4 if kind == "round" else 3
        prev = ring
        for s in range(1, steps):
            a = (math.pi / 2) * s / steps
            if kind == "round":
                scale, push = math.cos(a), math.sin(a) * rad * cap_len
            else:
                scale, push = 1.0 - s / steps, rad * 1.6 * s / steps
            cur = [bm.verts.new(center + (v.co - center) * scale + T * push * sign) for v in ring]
            for k in range(segments):
                k2 = (k + 1) % segments
                f = (prev[k], prev[k2], cur[k2], cur[k]) if sign > 0 else (prev[k2], prev[k], cur[k], cur[k2])
                bm.faces.new(f)
            prev = cur
        tip = center + T * sign * (rad * cap_len if kind == "round" else rad * 1.6)
        tv = bm.verts.new(tip)
        for k in range(segments):
            k2 = (k + 1) % segments
            f = (prev[k], prev[k2], tv) if sign > 0 else (prev[k2], prev[k], tv)
            bm.faces.new(f)

    c0 = sum((v.co for v in ring_verts[0]), V()) / segments
    c1 = sum((v.co for v in ring_verts[-1]), V()) / segments
    cap(ring_verts[-1], c1, frames[-1][0], caps[1], +1)
    cap(ring_verts[0], c0, frames[0][0], caps[0], -1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_to_obj(bm, name, col)


def sweep(path_pts, radii, segments: int = 12, exp: float = 2.0, **kw) -> bpy.types.Object:
    """Convenience: loft along `path_pts` with radii [(rx, ry), ...] (one per point) or a float."""
    st = []
    for i, p in enumerate(path_pts):
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        rx, ry = (r, r) if isinstance(r, (int, float)) else r
        st.append({"p": p, "rx": rx, "ry": ry, "exp": exp})
    return loft(st, segments=segments, **kw)


# ── skin-modifier bodies (creatures, minions, quick blockouts that still read organic) ────────────
def skin_body(nodes, edges, radii, name="skin_body", col=None, subdiv: int = 2, root: int = 0,
              branch_smooth: float = 0.5) -> bpy.types.Object:
    """Skin modifier over an edge skeleton (nodes: points, radii: (rx, ry) per node) + subdivision."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(n) for n in nodes], [tuple(e) for e in edges], [])
    obj = scene.new_object(name, me, col)
    m = obj.modifiers.new("Skin", "SKIN")
    m.branch_smoothing = branch_smooth
    m.use_smooth_shade = True
    for i, sv in enumerate(me.skin_vertices[0].data):
        r = radii[i]
        sv.radius = (r, r) if isinstance(r, (int, float)) else tuple(r)
        sv.use_root = (i == root)
    if subdiv:
        s = obj.modifiers.new("Subdivision", "SUBSURF")
        s.levels = subdiv
        s.render_levels = subdiv
    apply_modifiers(obj)
    shade(obj)
    return obj


# ── union with junction fillets ─────────────────────────────────────────────────────────────────
def union_fillet(parts, voxel: float = 0.005, fillet: float = 0.025, fillet_strength: float = 1.0,
                 global_smooth: float = 0.35, name: str = "body_high", col=None,
                 keep_parts: bool = False) -> bpy.types.Object:
    """Voxel-union overlapping parts into one closed surface, then smooth ONLY where two or more
    parts meet (vertices within `fillet` of a second part) so junctions read as sculpted
    transitions instead of tube intersections. Returns the high-res object.

    Materials: each part's first material becomes a slot on the result and every face takes the
    material of the nearest source part (so a fused body can be cloth/leather/skin by region)."""
    bms = []
    trees = []
    mats = []
    part_mat = []
    for p in parts:
        bm = obj_bm(p)
        bm.transform(p.matrix_world)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        trees.append(BVHTree.FromBMesh(bm))
        bms.append(bm)
        m = p.data.materials[0] if len(p.data.materials) else None
        if m is not None and m not in mats:
            mats.append(m)
        part_mat.append(mats.index(m) if m is not None else 0)
    merged = bmesh.new()
    for bm in bms:
        me_tmp = bpy.data.meshes.new("_tmp")
        bm.to_mesh(me_tmp)
        merged.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
        bm.free()
    obj = bm_to_obj(merged, name, col)
    obj.data.materials.clear()
    m = obj.modifiers.new("Remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    m.adaptivity = 0.0
    m.use_smooth_shade = True
    apply_modifiers(obj)
    # junction weights
    vg = obj.vertex_groups.new(name="_junction")
    me = obj.data
    by_w: dict[float, list[int]] = {}
    for v in me.vertices:
        ds = []
        for t in trees:
            hit = t.find_nearest(v.co, fillet * 2.0)
            ds.append(hit[3] if hit[0] is not None else 1e9)
        ds.sort()
        if len(ds) > 1 and ds[1] < fillet * 2.0:
            w = 1.0 - smoothstep(0.0, fillet * 2.0, ds[1])
            w = round(min(1.0, w * fillet_strength * 1.2), 3)
            if w > 0:
                by_w.setdefault(w, []).append(v.index)
    for w, idx in by_w.items():
        vg.add(idx, w, "REPLACE")
    its = max(2, int(fillet / voxel * 1.5))
    smooth(obj, factor=0.9, iterations=its, group="_junction")
    if global_smooth > 0:
        smooth(obj, factor=global_smooth, iterations=3)
    g = obj.vertex_groups.get("_junction")
    if g is not None:
        obj.vertex_groups.remove(g)
    if mats:
        for mt in mats:
            obj.data.materials.append(mt)
        if len(mats) > 1:
            assign_nearest_material(obj, trees, part_mat)
    if not keep_parts:
        scene.delete(parts)
    shade(obj)
    return obj


def assign_nearest_material(obj, trees, part_mat) -> None:
    """Face material index = material of the nearest source part (by face centre)."""
    me = obj.data
    idx = []
    for poly in me.polygons:
        c = poly.center
        best, bi = 1e9, 0
        for i, t in enumerate(trees):
            hit = t.find_nearest(c, best)
            if hit[0] is not None and hit[3] < best:
                best, bi = hit[3], i
        idx.append(part_mat[bi])
    me.polygons.foreach_set("material_index", idx)
    me.update()


# ── conformed hard-surface plates ───────────────────────────────────────────────────────────────
class Projection:
    """Maps a (u, v) parameter to a ray (origin on an axis/centre, outward unit direction)."""

    def ray(self, u: float, v: float) -> tuple[Vector, Vector]:
        raise NotImplementedError


class Cylindrical(Projection):
    """u = angle (deg) around `axis` measured from `ref` (0 = ref, +90 = axis x ref side),
    v = distance (m) along the axis from `origin`. The axis may be a polyline (bent limbs)."""

    def __init__(self, origin, axis, ref=(0, -1, 0)):
        self.o = V(origin)
        self.a = V(axis).normalized()
        r = V(ref)
        self.r = (r - self.a * r.dot(self.a)).normalized()
        self.s = self.a.cross(self.r).normalized()

    def ray(self, u, v):
        ang = math.radians(u)
        d = (self.r * math.cos(ang) + self.s * math.sin(ang)).normalized()
        return self.o + self.a * v, d


class Spherical(Projection):
    """u = azimuth (deg) around `up` from `front`, v = polar angle (deg) from `up`."""

    def __init__(self, center, up=(0, 0, 1), front=(0, -1, 0)):
        self.c = V(center)
        self.up = V(up).normalized()
        f = V(front)
        self.f = (f - self.up * f.dot(self.up)).normalized()
        self.s = self.up.cross(self.f).normalized()

    def ray(self, u, v):
        az, po = math.radians(u), math.radians(v)
        d = self.up * math.cos(po) + (self.f * math.cos(az) + self.s * math.sin(az)) * math.sin(po)
        return self.c.copy(), d.normalized()

    def uv(self, p) -> tuple[float, float]:
        """Inverse of ray(): (azimuth u, polar v) in degrees of world point `p` around the centre."""
        d = (V(p) - self.c)
        if d.length < 1e-9:
            return 0.0, 0.0
        d.normalize()
        v = math.degrees(math.acos(max(-1.0, min(1.0, d.dot(self.up)))))
        u = math.degrees(math.atan2(d.dot(self.s), d.dot(self.f)))
        return u, v

    def point(self, u, v, r):
        o, d = self.ray(u, v)
        return o + d * r


def bvh_of(objs) -> BVHTree:
    bm = bmesh.new()
    for o in objs if isinstance(objs, (list, tuple)) else [objs]:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me_tmp = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me_tmp)
        tmp.free()
        bm.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def _surface_r(bvh: BVHTree, origin: Vector, d: Vector, far: float) -> float | None:
    """Distance from `origin` along `d` to the first surface crossed going outward (the target's
    surface around the projection axis/centre). Falls back to the outermost hit when the origin
    lies outside the target and the ray points away from it."""
    hit = bvh.ray_cast(origin + d * 1e-4, d, far)
    if hit[0] is not None:
        return (hit[0] - origin).dot(d)
    start = origin + d * far
    hit = bvh.ray_cast(start, -d, far * 1.2)
    if hit[0] is None:
        return None
    return (hit[0] - origin).dot(d)


def plate(proj: Projection, rows, target=None, offset: float = 0.015, thickness: float = 0.012,
          cols: int = 12, smooth_iters: int = 6, min_r: float = 0.0, r_fn=None, shape_fn=None,
          rim: float = 0.0, rim_height: float = 0.004, bevel_w: float = 0.004, bevel_segments: int = 1,
          row_step: float = 0.03,
          wrap: bool = False, far: float = 1.0, name: str = "plate", col=None,
          weighted: bool = True, mat=None, rim_mat=None, inner: bool = False,
          rows_n: int | None = None) -> bpy.types.Object:
    """Armour plate conformed to `target` (a BVHTree or object list) along `proj` rays.

    rows: [(v, u_min, u_max), ...] top to bottom (outline as per-row u ranges; values are
          smoothly resampled). For wrap=True rows span a full turn (u_max - u_min = 360).
    r = (surface distance + offset) smoothed `smooth_iters` times (rigid-looking metal), never
        closer than `offset * 0.6` to the surface, never below `min_r`; `r_fn(u, v, r)` may
        replace it (pure parametric shapes) and `shape_fn(u, v, r)` adds relief (ridges, flares).
    The shell gets an inward edge wall of `thickness` (inner=True adds the hidden inner shell too,
    for plates seen from behind); `rim` > 0 raises a border band of that width
    (classic plate edge); edges get a bevel; normals are face-weighted (crisp hard surface).
    """
    tree = target if isinstance(target, BVHTree) or target is None else bvh_of(target)
    n_rows = max(len(rows), 2)
    vs = [r[0] for r in rows]
    # resample the outline to a regular number of rows
    nv = max(4, int(abs(vs[-1] - vs[0]) / row_step) + 1) if isinstance(proj, Cylindrical) else max(4, int(n_rows * 1.5))
    nv = rows_n or nv
    tv = [i / (nv - 1) for i in range(nv)]
    keys_v = [(i / (n_rows - 1), r[0]) for i, r in enumerate(rows)]
    keys_u0 = [(i / (n_rows - 1), r[1]) for i, r in enumerate(rows)]
    keys_u1 = [(i / (n_rows - 1), r[2]) for i, r in enumerate(rows)]
    ncol = cols if not wrap else cols
    grid_uv = []
    grid_r = []
    grid_rmin = []
    for t in tv:
        v = profile(keys_v, t)
        u0, u1 = profile(keys_u0, t), profile(keys_u1, t)
        row_uv, row_r, row_m = [], [], []
        nc = ncol if wrap else ncol + 1
        for j in range(nc):
            u = u0 + (u1 - u0) * j / ncol
            o, d = proj.ray(u, v)
            rs = _surface_r(tree, o, d, far) if tree is not None else None
            if rs is None:
                rs = min_r
            row_uv.append((u, v))
            row_r.append(rs + offset)
            row_m.append(max(rs + offset * 0.6, min_r))
        grid_uv.append(row_uv)
        grid_r.append(row_r)
        grid_rmin.append(row_m)
    nr, nc = len(grid_r), len(grid_r[0])
    # smooth the radial height field (rigid read), respecting the minimum clearance
    for _ in range(smooth_iters):
        new = [row[:] for row in grid_r]
        for i in range(nr):
            for j in range(nc):
                nb = []
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ii, jj = i + di, j + dj
                    if wrap:
                        jj %= nc
                    if 0 <= ii < nr and 0 <= jj < nc:
                        nb.append(grid_r[ii][jj])
                avg = sum(nb) / len(nb)
                new[i][j] = max(grid_rmin[i][j], 0.5 * grid_r[i][j] + 0.5 * avg)
        grid_r = new
    bm = bmesh.new()
    verts = []
    for i in range(nr):
        rays, rs = [], []
        for j in range(nc):
            u, v = grid_uv[i][j]
            r = grid_r[i][j]
            if r_fn:
                r = r_fn(u, v, r)
            if shape_fn:
                r = r + shape_fn(u, v, r)
            rays.append(proj.ray(u, v))
            rs.append(max(r, 1e-4))
        # a pole row (every ray identical, e.g. Spherical v = 0) must collapse to ONE apex: per-column
        # radii along the same ray otherwise leave collinear sliver faces with flipped shading normals
        d0 = rays[0][1]
        if all((o - rays[0][0]).length < 1e-7 and d.dot(d0) > 1 - 1e-9 for o, d in rays):
            rs = [sum(rs) / len(rs)] * len(rs)
        verts.append([bm.verts.new(o + d * r) for (o, d), r in zip(rays, rs)])
    for i in range(nr - 1):
        for j in range(nc if wrap else nc - 1):
            j2 = (j + 1) % nc
            bm.faces.new((verts[i][j], verts[i][j2], verts[i + 1][j2], verts[i + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    # outward orientation: normals should point away from the projection centre
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table()
    f0 = bm.faces[len(bm.faces) // 2]
    o, d = proj.ray(*grid_uv[nr // 2][nc // 2])
    if f0.normal.dot(f0.calc_center_median() - o) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    if rim > 0:
        border = _raise_rim_sheet(bm, rim, rim_height)
        if rim_mat is not None:
            for f in border:
                f.material_index = 1
    obj = bm_to_obj(bm, name, col)
    if mat is not None:
        obj.data.materials.append(mat)
        if rim_mat is not None:
            obj.data.materials.append(rim_mat)
    m = obj.modifiers.new("Solidify", "SOLIDIFY")
    m.thickness = thickness
    m.offset = -1.0
    m.use_rim = True
    m.use_rim_only = not inner          # game plates: no hidden inner shell (halves the tris)
    m.use_even_offset = False
    m.use_quality_normals = True
    apply_modifiers(obj)
    if bevel_w > 0:
        bevel(obj, bevel_w, bevel_segments, angle=40)
    shade(obj, True)
    if weighted:
        weighted_normals(obj)
    return obj


def _raise_rim_sheet(bm: bmesh.types.BMesh, width: float, height: float) -> list:
    """On the single-sided sheet: inset the whole region from its boundary by `width` and sink the
    interior by `height` -> after solidify the border reads as a raised rolled edge.
    Returns the border faces."""
    faces = list(bm.faces)
    bm.normal_update()
    res = bmesh.ops.inset_region(bm, faces=faces, thickness=width, depth=-height, use_even_offset=False,
                                 use_boundary=True, use_relative_offset=False)
    return list(res.get("faces", []))


# ── cloth ────────────────────────────────────────────────────────────────────────────────────────
def cloth_panel(top_pts, length: float, folds: int = 4, fold_depth: float = 0.012, flare: float = 0.05,
                hem=None, out_dir=(0, -1, 0), down=(0, 0, -1), thickness: float = 0.006, cols: int = 14,
                rows: int = 12, avoid=None, clearance: float = 0.015, sway: float = 0.0,
                name: str = "cloth", col=None, seed: int = 0, fold_sharp: float = 0.0,
                hem_bevel: float = 0.0, fold_top: float = 0.25) -> bpy.types.Object:
    """Hanging cloth panel from an attachment curve (tabards, loincloths, capes, sashes).

    top_pts: points along the attachment line (left to right as seen from the front)
    hem(u) -> extra length factor (0..1+) along the width, e.g. a pointed or swallow-tail cut
    folds: vertical folds whose depth grows toward the hem (from `fold_top` x depth at the top);
           flare pushes the hem outward
    fold_sharp 0..1: SCULPTED folds (heavy cloth): broad rounded crests, pinched valleys
    hem_bevel: rounds the solidified panel's rim (a rolled hem, 2-4 cm brushstroke on heavy cloth)
    avoid: BVHTree/objects the cloth must clear by `clearance` (pushed along `out_dir`)
    """
    tree = avoid if isinstance(avoid, BVHTree) or avoid is None else bvh_of(avoid)
    top = catmull_rom([V(p) for p in top_pts], cols + 1)
    out = V(out_dir).normalized()
    dn = V(down).normalized()
    rnd = scene.rng("cloth", name, seed)
    phases = [rnd.uniform(0, 0.6) for _ in range(3)]
    bm = bmesh.new()
    grid = []
    for i in range(rows + 1):
        v = i / rows
        row = []
        for j, tp in enumerate(top):
            u = j / cols
            L = length * (1.0 + (hem(u) if hem else 0.0))
            p = tp + dn * (v * L)
            p += out * (flare * v * v)
            amp = fold_depth * (fold_top + (1.0 - fold_top) * v)
            f = math.sin(2 * math.pi * (folds * u + phases[0]))
            if fold_sharp > 0:          # crest broad, valley pinched: x' = 1 - (1 - x)^p
                x01 = 1.0 - (1.0 - 0.5 * (f + 1.0)) ** (1.0 + 2.5 * fold_sharp)
                f = 2.0 * x01 - 1.0
            p += out * (amp * f)
            p += out * (amp * 0.35 * math.sin(2 * math.pi * (folds * 2.1 * u + phases[1])))
            if sway:
                side = (top[-1] - top[0]).normalized()
                p += side * (sway * v * v)
            if tree is not None:
                for _ in range(3):
                    hit = tree.find_nearest(p, clearance * 3)
                    if hit[0] is None:
                        break
                    dist = (p - hit[0]).length
                    sgn = 1.0 if (p - hit[0]).dot(hit[1]) >= 0 else -1.0
                    if sgn > 0 and dist >= clearance:
                        break
                    p += out * (clearance - sgn * dist + 0.002)
            row.append(bm.verts.new(p))
        grid.append(row)
    for i in range(rows):
        for j in range(cols):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table()
    if bm.faces[len(bm.faces) // 2].normal.dot(out) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    obj = bm_to_obj(bm, name, col)
    solidify(obj, thickness, offset=-1.0)
    if hem_bevel > 0:
        bevel(obj, min(hem_bevel, thickness * 0.49), 1, angle=50)
    shade(obj, True)
    return obj


# ── carved slabs (blades, fins, tablets, shields): thick, bevelled, no primitives ────────────────
def slab(rows, thickness=0.03, cols: int = 8, rows_n: int | None = None, bevel_w: float = 0.012,
         bevel_segments: int = 3, bevel_angle: float = 30.0, name: str = "slab", col=None, mat=None,
         bands: list | None = None) -> bpy.types.Object:
    """A thick carved slab between two edge curves, built in the YZ plane (thickness along X):
    prop space for blades (grip at the origin, main axis +Z, edge toward -Y).

    rows: [(z, y_a, y_b), ...] stations along +Z; y_a is the back/spine edge, y_b the front/cutting
          edge; values are resampled smoothly (`rows_n` rows). A station with y_a == y_b is a tip.
    thickness: metres, or fn(u, v) -> metres with u 0..1 from edge a to edge b and v 0..1 along Z
          (taper a blade from a thick spine to a thin edge).
    The two faces are joined by a rim wall; `bevel_w` rounds every edge sharper than `bevel_angle`
    with `bevel_segments` (bible: 2-4 cm bevels as brushstrokes; thin edges clamp automatically).
    bands: optional [(u_max, mat), ...] across the slab (sorted by u_max, last = 1.0): a face takes
    the first band whose u_max is above its u, e.g. [(0.16, ironstone), (0.86, stone), (1.0, glass)]
    = an ironstone spine, a honed-stone blade and a dawnglass edge."""
    n = rows_n or max(6, len(rows) * 3)
    keys_z = [(i / (len(rows) - 1), r[0]) for i, r in enumerate(rows)]
    keys_a = [(i / (len(rows) - 1), r[1]) for i, r in enumerate(rows)]
    keys_b = [(i / (len(rows) - 1), r[2]) for i, r in enumerate(rows)]
    tfn = thickness if callable(thickness) else (lambda u, v, t=thickness: t)
    bm = bmesh.new()
    F, B, U = [], [], []
    for i in range(n):
        v = i / (n - 1)
        z, ya, yb = profile(keys_z, v), profile(keys_a, v), profile(keys_b, v)
        rf, rb, ru = [], [], []
        for j in range(cols + 1):
            u = j / cols
            y = ya + (yb - ya) * u
            t = max(1e-4, tfn(u, v)) * 0.5
            rf.append(bm.verts.new((t, y, z)))
            rb.append(bm.verts.new((-t, y, z)))
            ru.append(u)
        F.append(rf)
        B.append(rb)
        U.append(ru)
    side = {}
    for i in range(n - 1):
        for j in range(cols):
            f1 = bm.faces.new((F[i][j], F[i][j + 1], F[i + 1][j + 1], F[i + 1][j]))
            f2 = bm.faces.new((B[i][j], B[i + 1][j], B[i + 1][j + 1], B[i][j + 1]))
            side[f1] = side[f2] = (j + 0.5) / cols
    ring = [(0, j) for j in range(cols + 1)] + [(i, cols) for i in range(1, n)] + \
           [(n - 1, j) for j in range(cols - 1, -1, -1)] + [(i, 0) for i in range(n - 2, 0, -1)]
    for k in range(len(ring)):
        (i0, j0), (i1, j1) = ring[k], ring[(k + 1) % len(ring)]
        try:
            f = bm.faces.new((F[i0][j0], B[i0][j0], B[i1][j1], F[i1][j1]))
            side[f] = 0.5 * (j0 + j1) / cols
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bands:
        for f in bm.faces:
            u = side.get(f, 0.5)
            f.material_index = next((i for i, (um, _) in enumerate(bands) if u <= um), len(bands) - 1)
    obj = bm_to_obj(bm, name, col)
    if bands:
        for _, m in bands:
            obj.data.materials.append(m)
    elif mat is not None:
        obj.data.materials.append(mat)
    if bevel_w > 0:
        bevel(obj, bevel_w, bevel_segments, angle=bevel_angle)
    shade(obj, True)
    weighted_normals(obj)
    return obj


# ── skinning ─────────────────────────────────────────────────────────────────────────────────────
def add_armature_modifier(obj, arm) -> None:
    for m in obj.modifiers:
        if m.type == "ARMATURE":
            m.object = arm
            return
    m = obj.modifiers.new("Armature", "ARMATURE")
    m.object = arm
    m.use_vertex_groups = True
    m.use_deform_preserve_volume = False


def parent_keep(obj, arm) -> None:
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "OBJECT"
    obj.matrix_world = mw


def bind_rigid(obj, arm, bone: str) -> None:
    """Every vertex weight 1.0 to `bone` (armour plates, props, hard parts)."""
    obj.vertex_groups.clear()
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    add_armature_modifier(obj, arm)
    parent_keep(obj, arm)


def _deform_bones(arm, exclude=()) -> list:
    return [b for b in arm.data.bones if b.use_deform and b.name not in exclude]


def _seg_dist(p: Vector, a: Vector, b: Vector) -> float:
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def proximity_weights(obj, arm, bones=None, falloff: float = 3.0, only_unweighted: bool = False) -> int:
    """Envelope-style weights from distance to bone segments (fallback when heat weighting fails).
    Returns the number of vertices written."""
    bones = bones or [b.name for b in _deform_bones(arm)]
    mw = arm.matrix_world
    segs = {b: (mw @ arm.data.bones[b].head_local, mw @ arm.data.bones[b].tail_local) for b in bones}
    groups = {b: obj.vertex_groups.get(b) or obj.vertex_groups.new(name=b) for b in bones}
    have = set()
    if only_unweighted:
        names = {g.index: g.name for g in obj.vertex_groups}
        for v in obj.data.vertices:
            if any(g.weight > 1e-4 and names.get(g.group) in segs for g in v.groups):
                have.add(v.index)
    n = 0
    for v in obj.data.vertices:
        if v.index in have:
            continue
        p = obj.matrix_world @ v.co
        ds = sorted((_seg_dist(p, *segs[b]), b) for b in bones)[:3]
        d0 = max(ds[0][0], 1e-4)
        ws = [(b, (d0 / max(d, 1e-4)) ** falloff) for d, b in ds]
        tot = sum(w for _, w in ws)
        for b, w in ws:
            if w / tot > 0.02:
                groups[b].add([v.index], w / tot, "REPLACE")
        n += 1
    return n


def bind_auto(obj, arm, exclude=("root", "prop.L", "prop.R"), fix: bool = True) -> dict:
    """ARMATURE_AUTO (bone heat) with a proximity fallback for every vertex left unweighted.
    Bones in `exclude` (and every x_ bone unless listed in include via deform state) get no
    weights here. Returns {'heat_ok': bool, 'fixed_vertices': n}."""
    saved = {}
    for b in arm.data.bones:
        if b.name in exclude or (b.name.startswith("x_")):
            saved[b.name] = b.use_deform
            b.use_deform = False
    obj.vertex_groups.clear()
    scene.select_only([obj, arm], arm)
    heat_ok = True
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO", keep_transform=True)
    except RuntimeError as e:
        heat_ok = False
        scene.log(f"bind_auto: heat weighting raised {e}")
    deform = [b.name for b in _deform_bones(arm)]
    names = {g.index: g.name for g in obj.vertex_groups}
    empty_groups = [b for b in deform if obj.vertex_groups.get(b) is None or not any(
        any(g.group == obj.vertex_groups[b].index and g.weight > 1e-4 for g in v.groups)
        for v in obj.data.vertices)]
    unweighted = 0
    for v in obj.data.vertices:
        if not any(g.weight > 1e-4 and names.get(g.group) in deform for g in v.groups):
            unweighted += 1
    fixed = 0
    if fix and (unweighted or not heat_ok):
        scene.log(f"bind_auto {obj.name}: {unweighted} unweighted vertices, "
                  f"empty groups {empty_groups[:6]} -> proximity fallback")
        fixed = proximity_weights(obj, arm, deform, only_unweighted=heat_ok)
    for name, d in saved.items():
        arm.data.bones[name].use_deform = d
    add_armature_modifier(obj, arm)
    if obj.parent != arm:
        parent_keep(obj, arm)
    limit_weights(obj)
    return {"heat_ok": heat_ok and unweighted == 0, "unweighted": unweighted, "fixed_vertices": fixed,
            "empty_groups": empty_groups}


def chain_weights(obj, arm, chain: list[str], root_bone: str, blend: float = 0.35) -> None:
    """Weights for a cloth/tail hanging along an x_ chain: each vertex is projected onto the chain
    polyline and blended between neighbouring chain bones; the top `blend` of the first bone is
    shared with `root_bone` so the attachment line stays glued."""
    obj.vertex_groups.clear()
    mw = arm.matrix_world
    pts = [mw @ arm.data.bones[chain[0]].head_local] + [mw @ arm.data.bones[b].tail_local for b in chain]
    groups = {b: obj.vertex_groups.new(name=b) for b in [root_bone] + chain}
    seglen = [(pts[i + 1] - pts[i]).length for i in range(len(chain))]
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        best = None
        for i in range(len(chain)):
            a, b = pts[i], pts[i + 1]
            ab = b - a
            t = (p - a).dot(ab) / max(ab.length_squared, 1e-12)
            tc = max(0.0, min(1.0, t))
            d = (p - (a + ab * tc)).length
            if best is None or d < best[0]:
                best = (d, i, t)
        _, i, t = best
        t = max(0.0, min(1.0, t)) if i < len(chain) - 1 else max(0.0, t)
        s = i + min(t, 1.0)                           # continuous chain parameter
        ws: dict[str, float] = {}
        if s < blend:
            k = s / blend
            ws[root_bone] = 1.0 - k
            ws[chain[0]] = k
        else:
            # centre of bone k at parameter k + 0.5; blend linearly between bone centres
            x = s - 0.5
            k0 = int(math.floor(x))
            f = x - k0
            k0c = max(0, min(len(chain) - 1, k0))
            k1c = max(0, min(len(chain) - 1, k0 + 1))
            ws[chain[k0c]] = ws.get(chain[k0c], 0) + (1 - f)
            ws[chain[k1c]] = ws.get(chain[k1c], 0) + f
        tot = sum(ws.values())
        for b, w in ws.items():
            if w / tot > 1e-3:
                groups[b].add([v.index], w / tot, "REPLACE")
    add_armature_modifier(obj, arm)
    parent_keep(obj, arm)


def limit_weights(obj, limit: int = 4, clean: float = 0.01) -> None:
    """glTF carries 4 influences: keep the 4 largest per vertex, drop tiny ones, normalise."""
    names = {g.index: g for g in obj.vertex_groups}
    for v in obj.data.vertices:
        gs = sorted(((g.weight, g.group) for g in v.groups), reverse=True)
        keep = [(w, gi) for w, gi in gs[:limit] if w >= clean] or gs[:1]
        drop = [gi for _, gi in gs if gi not in {k[1] for k in keep}]
        for gi in drop:
            names[gi].remove([v.index])
        tot = sum(w for w, _ in keep) or 1.0
        for w, gi in keep:
            names[gi].add([v.index], w / tot, "REPLACE")


def transfer_weights(src, dst) -> None:
    """Copy skin weights from `src` (e.g. the body) to `dst` (tight clothing, straps) by nearest
    surface interpolation, then limit/normalise."""
    dst.vertex_groups.clear()
    for g in src.vertex_groups:
        dst.vertex_groups.new(name=g.name)
    m = dst.modifiers.new("DataTransfer", "DATA_TRANSFER")
    m.object = src
    m.use_vert_data = True
    m.data_types_verts = {"VGROUP_WEIGHTS"}
    m.vert_mapping = "POLYINTERP_NEAREST"
    m.layers_vgroup_select_src = "ALL"
    m.layers_vgroup_select_dst = "NAME"
    scene.select_only([dst], dst)
    bpy.ops.object.modifier_apply(modifier=m.name)
    limit_weights(dst)


def conform_under_armour(body, covers, reach: float = 0.075, cull_reach: float = 0.06, tilt: float = 32.0,
                         cull: bool = True, keep_ring: int = 1) -> dict:
    """Make the body move WITH the armour that hides it, and drop body faces nobody can see.

    Bone-heat weights on the body and the plates' own (rigid / zblend / dblend) weights disagree
    near joints, so in a pose the under-suit pushes through a plate (e.g. the shoulder blades
    through the back plate when the arms come forward). For every body vertex five rays (the
    normal + four tilted by `tilt` degrees) are cast against the covering parts in the rest pose:
      * coverage = share of rays that hit a cover within `reach` metres; vertices with coverage
        >= 0.6 blend their weights toward the covering polygon's weights (fully at 1.0), so skin
        and plate share one deformation;
      * faces whose vertices are ALL fully covered within `cull_reach` are deleted (they can never
        be seen, and their triangles are free for visible detail), except a `keep_ring` of faces
        around everything still visible so plate gaps never show daylight.
    `covers`: objects already bound (vertex groups set). Returns stats.
    """
    from mathutils.bvhtree import BVHTree
    verts, polys, owner = [], [], []
    for ci, o in enumerate(covers):
        base = len(verts)
        mw = o.matrix_world
        verts.extend(mw @ v.co for v in o.data.vertices)
        for p in o.data.polygons:
            polys.append([base + i for i in p.vertices])
            owner.append((ci, tuple(p.vertices)))
    if not polys:
        return {"covered": 0, "culled_faces": 0}
    tree = BVHTree.FromPolygons(verts, polys)
    cover_w = []
    for o in covers:
        names = {g.index: g.name for g in o.vertex_groups}
        cover_w.append([{names[g.group]: g.weight for g in v.groups if g.weight > 1e-4} for v in o.data.vertices])
    me = body.data
    mw = body.matrix_world
    nmat = mw.to_3x3().inverted().transposed()
    groups = {g.name: g for g in body.vertex_groups}
    gname = {g.index: g.name for g in body.vertex_groups}
    full = [False] * len(me.vertices)
    covered = 0
    ct, st = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    for v in me.vertices:
        p = mw @ v.co
        n = (nmat @ v.normal).normalized()
        t1 = n.orthogonal().normalized()
        t2 = n.cross(t1)
        dirs = [n] + [(n * ct + t * st).normalized() for t in (t1, -t1, t2, -t2)]
        hits, near, best = 0, 0, None
        for d in dirs:
            loc, _nrm, idx, dist = tree.ray_cast(p + d * 1e-4, d, reach)
            if loc is None:
                continue
            hits += 1
            near += dist <= cull_reach
            if best is None or dist < best[0]:
                best = (dist, idx)
        cov = hits / len(dirs)
        full[v.index] = near == len(dirs)
        if cov < 0.6 or best is None:
            continue
        ci, pv = owner[best[1]]
        tw: dict[str, float] = {}
        for vi in pv:
            for b, w in cover_w[ci][vi].items():
                tw[b] = tw.get(b, 0.0) + w / len(pv)
        if not tw:
            continue
        s = smoothstep(0.6, 1.0, cov)
        cur = {gname[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
        new = {b: cur.get(b, 0.0) * (1 - s) + tw.get(b, 0.0) * s for b in set(cur) | set(tw)}
        tot = sum(new.values()) or 1.0
        for g in list(v.groups):
            body.vertex_groups[g.group].remove([v.index])
        for b, w in new.items():
            if w / tot > 1e-3:
                if b not in groups:
                    groups[b] = body.vertex_groups.new(name=b)
                    gname[groups[b].index] = b
                groups[b].add([v.index], w / tot, "REPLACE")
        covered += 1
    limit_weights(body)
    culled = 0
    if cull:
        bm = obj_bm(body)
        bm.faces.ensure_lookup_table()
        dead = {f.index for f in bm.faces if all(full[v.index] for v in f.verts)}
        for _ in range(keep_ring):                       # keep one ring around the visible region
            edge = {f.index for f in bm.faces if f.index in dead and any(
                lf.index not in dead for v in f.verts for lf in v.link_faces)}
            dead -= edge
        geom = [bm.faces[i] for i in sorted(dead)]
        culled = len(geom)
        if geom:
            bmesh.ops.delete(bm, geom=geom, context="FACES")
            # vertex groups follow bmesh deform layer automatically
            bm.to_mesh(me)
            me.update()
        bm.free()
    return {"covered": covered, "culled_faces": culled}
