"""DYEFIELD — shared headless-bpy helpers for the art lane (MAP).

Everything here is deterministic: no wall-clock, no unseeded randomness. Geometry is authored in
Blender coordinates (Z-up). Data files (data/*.json) are in runtime/glTF coordinates (Y-up); the
glTF exporter maps Blender (x, y, z) -> glTF (x, z, -y), so glTF (X, Y, Z) is Blender (X, -Z, Y).
Use g2b() / b2g() at the boundary and author "forward" as Blender -Y (it arrives as glTF +Z).

Asset-local frame convention (deco_assets.py): origin at the asset's base, up = +Z, forward = -Y.
Placing an asset with a yaw (CONTRACT §2: 0 faces +Z, positive turns left) is a rotation about
Blender Z by +yaw.
"""
from __future__ import annotations

import json
import math
import os
import random
import zlib

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
ROOT = os.path.dirname(ART)
DATA_DIR = os.path.join(ROOT, "data")
GLTF_DIR = os.path.join(ART, "gltf")
RENDER_DIR = os.path.join(ART, "renders")


# ── coordinates ──────────────────────────────────────────────────────────────────────────────────
def g2b(x: float, y: float, z: float) -> Vector:
    """runtime/glTF (Y-up) -> Blender (Z-up)."""
    return Vector((x, -z, y))


def b2g(v) -> tuple[float, float, float]:
    """Blender (Z-up) -> runtime/glTF (Y-up)."""
    return (v[0], v[2], -v[1])


def place_matrix(pos_gltf, yaw_deg: float = 0.0, scale=1.0) -> Matrix:
    """World matrix for an asset authored in the asset-local frame (forward = Blender -Y)."""
    s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    t = Matrix.Translation(g2b(*pos_gltf))
    r = Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
    sc = Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    return t @ r @ sc


# ── determinism ──────────────────────────────────────────────────────────────────────────────────
def seed_of(*parts) -> int:
    return zlib.crc32("|".join(str(p) for p in parts).encode("utf-8")) & 0xFFFFFFFF


def rng(*parts) -> random.Random:
    return random.Random(seed_of(*parts))


# ── data ─────────────────────────────────────────────────────────────────────────────────────────
def load_json(name: str) -> dict:
    with open(os.path.join(DATA_DIR, name), encoding="utf-8") as f:
        return json.load(f)


def hex_to_linear(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2])


# ── scene ────────────────────────────────────────────────────────────────────────────────────────
def reset_scene() -> None:
    """Empty factory scene (idempotent builds)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.objects, bpy.data.curves,
                 bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.worlds):
        for item in list(coll):
            try:
                coll.remove(item)
            except Exception:
                pass


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def new_collection(name: str, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


# ── materials (CONTRACT §3.1 M_* set) ───────────────────────────────────────────────────────────
# name -> (sRGB base color, roughness, metallic, emission strength, double-sided)
MATERIALS: dict[str, tuple[str, float, float, float, bool]] = {
    "M_tile":        ("#EADBBE", 0.62, 0.0, 0.0, False),   # warm off-white / sand court tile
    "M_concrete":    ("#C7C0B4", 0.86, 0.0, 0.0, False),   # light warm grey
    "M_boardwalk":   ("#B8844F", 0.72, 0.0, 0.0, False),   # warm deck wood
    "M_crate":       ("#C77A3A", 0.70, 0.0, 0.0, False),   # orange-brown crate wood
    "M_chevron":     ("#1FA9A1", 0.55, 0.0, 0.0, False),   # teal (runtime draws white chevrons from UV0)
    "M_hazard":      ("#FFC21A", 0.55, 0.0, 0.0, False),   # hazard yellow (runtime draws black stripes)
    "M_planter":     ("#C8633B", 0.78, 0.0, 0.0, False),   # terracotta
    "M_soil":        ("#5B3B25", 0.95, 0.0, 0.0, False),
    "M_metal":       ("#4F5B6E", 0.42, 0.55, 0.0, False),  # grey-blue painted metal (dark)
    "M_pad_A":       ("#FF8A1F", 0.35, 0.0, 0.0, False),   # teams.json SUNCREW dye (overwritten from data)
    "M_pad_B":       ("#5B4BF0", 0.35, 0.0, 0.0, False),   # teams.json GULF CREW dye (overwritten from data)
    "M_palm_trunk":  ("#8C6440", 0.85, 0.0, 0.0, False),
    "M_palm_leaf":   ("#3DAE4B", 0.60, 0.0, 0.0, True),
    "M_lamp":        ("#FFF2CF", 0.30, 0.0, 1.5, False),   # lamp lens (warm, slightly emissive)
    "M_glass":       ("#BFE7F4", 0.08, 0.0, 0.0, False),
    "M_billboard":   ("#F7F3E8", 0.55, 0.0, 0.0, True),    # board / banner / sail canvas
    "M_sign_text":   ("#1D3F8C", 0.40, 0.0, 0.0, False),   # lettering (navy)
    "M_rope":        ("#D6C293", 0.90, 0.0, 0.0, False),
    "M_rock":        ("#8F8A82", 0.92, 0.0, 0.0, False),
    "M_sand":        ("#EBD9A9", 0.95, 0.0, 0.0, False),
    "M_island":      ("#5F9F78", 0.95, 0.0, 0.0, False),   # soft hazy green
    "M_lighthouse":  ("#F7F5EF", 0.60, 0.0, 0.0, False),
    "M_crane":       ("#3E86B8", 0.55, 0.2, 0.0, False),   # teal-blue gantry cranes
    "M_hull":        ("#F4F1EA", 0.45, 0.0, 0.0, False),
    "M_water":       ("#1B8FB0", 0.08, 0.0, 0.0, False),
    "M_foliage":     ("#4E9F52", 0.90, 0.0, 0.0, False),
    "M_paint_trim":  ("#E4473A", 0.50, 0.0, 0.0, False),   # signal red painted trim
}


def get_material(name: str, override_hex: str | None = None):
    """Create (once) an M_* material with a plain Principled BSDF — exports cleanly to glTF."""
    if name not in MATERIALS:
        raise KeyError(f"{name} is not in the CONTRACT §3.1 material set")
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    hexc, rough, metal, emis, double = MATERIALS[name]
    if override_hex:
        hexc = override_hex
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    col = hex_to_linear(hexc)
    bsdf.inputs["Base Color"].default_value = (*col, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emis > 0:
        bsdf.inputs["Emission Color"].default_value = (*col, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emis
    mat.use_backface_culling = not double
    mat.diffuse_color = (*col, 1.0)
    mat["df_base_hex"] = hexc
    return mat


# ── geometry accumulation ────────────────────────────────────────────────────────────────────────
class Geo:
    """A bucket of polygons with per-face material names, later written as ONE mesh object.

    Parts are appended already transformed (world space), so the resulting object has an
    identity transform (CONTRACT §3.1: paint_/solid_/col_ transforms applied).
    """

    def __init__(self, name: str):
        self.name = name
        self.verts: list[Vector] = []
        self.faces: list[tuple[int, ...]] = []
        self.fmat: list[str] = []
        self.fsmooth: list[bool] = []
        self.fgroup: list[int] = []   # per-face instance id (-1 = none); written as face attr df_group
        self.ngroups = 0

    def _pad_groups(self):
        if len(self.fgroup) < len(self.faces):
            self.fgroup += [-1] * (len(self.faces) - len(self.fgroup))

    def add_bm(self, bm, mat, matrix: Matrix | None = None, smooth: bool | None = False, mat_names=None):
        """Append a bmesh. `mat` = one M_* name for every face, or None with `mat_names`
        (list indexed by face.material_index). smooth=None keeps each face's own flag."""
        base = len(self.verts)
        bm.verts.index_update()
        for v in bm.verts:
            self.verts.append((matrix @ v.co) if matrix is not None else v.co.copy())
        for f in bm.faces:
            self.faces.append(tuple(base + v.index for v in f.verts))
            self.fmat.append(mat if mat is not None else mat_names[f.material_index])
            self.fsmooth.append(f.smooth if smooth is None else smooth)
        return self

    def add_mesh_data(self, me, mat_names, matrix: Matrix | None = None):
        bm = bmesh.new()
        bm.from_mesh(me)
        base = len(self.verts)
        bm.verts.index_update()
        for v in bm.verts:
            self.verts.append((matrix @ v.co) if matrix is not None else v.co.copy())
        for f in bm.faces:
            self.faces.append(tuple(base + v.index for v in f.verts))
            self.fmat.append(mat_names[f.material_index])
            self.fsmooth.append(f.smooth)
        bm.free()
        return self

    def extend(self, other: "Geo", matrix: Matrix | None = None, group: bool = False):
        """Append another Geo (transformed). group=True tags the appended faces as one instance
        (face attribute df_group), e.g. so each crate can be unwrapped on its own."""
        self._pad_groups()
        base = len(self.verts)
        for v in other.verts:
            self.verts.append((matrix @ v) if matrix is not None else v.copy())
        for f in other.faces:
            self.faces.append(tuple(base + i for i in f))
        self.fmat += other.fmat
        self.fsmooth += other.fsmooth
        if group:
            self.fgroup += [self.ngroups] * len(other.faces)
            self.ngroups += 1
        else:
            self._pad_groups()
        return self

    def empty(self) -> bool:
        return not self.faces

    def canonicalize(self):
        """Deterministic element order. Some bmesh operators (exact boolean, bisect) iterate
        pointer-keyed tables, so their element ORDER can vary between runs even though the
        geometry is identical. Sort faces by (material, rounded centroid, size), start every loop
        at its lexicographically smallest vertex (winding kept) and renumber vertices by first use,
        so the written mesh — and therefore the atlas unwrap and the GLB bytes — depend only on
        the geometry."""
        self._pad_groups()
        R = lambda v: (round(v.x, 4), round(v.y, 4), round(v.z, 4))  # noqa: E731
        rows = []
        for fi, f in enumerate(self.faces):
            keys = [R(self.verts[i]) for i in f]
            k0 = min(range(len(f)), key=lambda i: keys[i])
            rot = f[k0:] + f[:k0]
            n = len(f)
            cx = round(sum(self.verts[i].x for i in f) / n, 4)
            cy = round(sum(self.verts[i].y for i in f) / n, 4)
            cz = round(sum(self.verts[i].z for i in f) / n, 4)
            rows.append(((self.fmat[fi], cx, cy, cz, n, tuple(keys[(k0 + j) % n] for j in range(n))), rot,
                         self.fmat[fi], self.fsmooth[fi], self.fgroup[fi]))
        rows.sort(key=lambda r: r[0])
        remap: dict[int, int] = {}
        verts, faces, fmat, fsmooth, fgroup = [], [], [], [], []
        for _, rot, m, sm, gr in rows:
            idx = []
            for i in rot:
                if i not in remap:
                    remap[i] = len(verts)
                    verts.append(self.verts[i])
                idx.append(remap[i])
            faces.append(tuple(idx))
            fmat.append(m)
            fsmooth.append(sm)
            fgroup.append(gr)
        self.verts, self.faces, self.fmat, self.fsmooth, self.fgroup = verts, faces, fmat, fsmooth, fgroup
        return self

    def to_object(self, coll=None, sharp_angle_deg: float = 38.0, team_hex: dict | None = None):
        self.canonicalize()
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], [list(f) for f in self.faces])
        names: list[str] = []
        for m in self.fmat:
            if m not in names:
                names.append(m)
        for m in names:
            me.materials.append(get_material(m, (team_hex or {}).get(m)))
        idx = {m: i for i, m in enumerate(names)}
        me.polygons.foreach_set("material_index", [idx[m] for m in self.fmat])
        me.polygons.foreach_set("use_smooth", self.fsmooth)
        self._pad_groups()
        if self.ngroups:
            at = me.attributes.new("df_group", "INT", "FACE")
            at.data.foreach_set("value", self.fgroup)
        me.validate(clean_customdata=False)
        me.update()
        if any(self.fsmooth):
            me.set_sharp_from_angle(angle=math.radians(sharp_angle_deg))
        ob = bpy.data.objects.new(self.name, me)
        link(ob, coll)
        return ob


# ── bmesh primitives (Blender coords) ────────────────────────────────────────────────────────────
def bm_box(bm, mn, mx, mat_index: int = 0):
    """Axis-aligned box from Blender-space min/max corners. Returns the new faces."""
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    co = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
          (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    v = [bm.verts.new(c) for c in co]
    idx = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    faces = [bm.faces.new([v[i] for i in f]) for f in idx]
    for f in faces:
        f.material_index = mat_index
    return faces


def bm_oriented_box(bm, center, size, rot: Matrix, mat_index: int = 0):
    """Box of `size` (sx, sy, sz) centred at `center`, rotated by 3x3/4x4 `rot`."""
    sx, sy, sz = (s * 0.5 for s in size)
    m = Matrix.Translation(Vector(center)) @ rot.to_4x4()
    faces = bm_box(bm, (-sx, -sy, -sz), (sx, sy, sz), mat_index)
    verts = {v for f in faces for v in f.verts}
    for v in verts:
        v.co = m @ v.co
    if rot.to_3x3().determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=faces)
    return faces


def bm_cylinder(bm, r0: float, r1: float, z0: float, z1: float, seg: int = 12, cap0=True, cap1=True,
                center=(0.0, 0.0), mat_index: int = 0, phase: float = 0.0):
    cx, cy = center
    ring0, ring1 = [], []
    for i in range(seg):
        a = phase + 2 * math.pi * i / seg
        ring0.append(bm.verts.new((cx + r0 * math.cos(a), cy + r0 * math.sin(a), z0)))
        ring1.append(bm.verts.new((cx + r1 * math.cos(a), cy + r1 * math.sin(a), z1)))
    faces = []
    for i in range(seg):
        j = (i + 1) % seg
        faces.append(bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i])))
    if cap0:
        faces.append(bm.faces.new(list(reversed(ring0))))
    if cap1:
        faces.append(bm.faces.new(ring1))
    for f in faces:
        f.material_index = mat_index
    return faces


def bm_lathe(bm, profile, seg: int = 32, mats=None, closed_center=True, phase: float = 0.0):
    """Revolve a (r, z) profile around Z. Faces point to the LEFT of the profile's travel
    direction in the (r right, z up) plane, so list profiles top -> bottom along the outside
    (outward-and-down) for outward normals. `mats[i]` is the material index for the band
    between profile[i] and profile[i+1]."""
    rings = []
    for (r, z) in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            ring = []
            for i in range(seg):
                a = phase + 2 * math.pi * i / seg
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)
    faces = []
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        mi = mats[k] if mats else 0
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1:
                f = bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], b[0], a[j]))
            else:
                f = bm.faces.new((a[i], b[i], b[j], a[j]))
            f.material_index = mi
            faces.append(f)
    return faces


def bm_icosphere(bm, radius: float, subdiv: int, matrix: Matrix | None = None):
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius,
                                     matrix=matrix if matrix is not None else Matrix.Identity(4))
    return res["verts"]


def bm_tube(bm, points, radius: float, seg: int = 8, cap=True, mat_index: int = 0, radii=None):
    """Tube along a polyline (Blender-space points)."""
    rings = []
    n = len(points)
    prev_side = None
    for i, p in enumerate(points):
        p = Vector(p)
        if i == 0:
            t = (Vector(points[1]) - p).normalized()
        elif i == n - 1:
            t = (p - Vector(points[i - 1])).normalized()
        else:
            t = ((Vector(points[i + 1]) - p).normalized() + (p - Vector(points[i - 1])).normalized()).normalized()
        ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        side = t.cross(ref).normalized() if prev_side is None else (prev_side - t * prev_side.dot(t)).normalized()
        prev_side = side
        up = side.cross(t).normalized()
        r = radii[i] if radii else radius
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append(bm.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * r))
        rings.append(ring)
    faces = []
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(seg):
            j = (k + 1) % seg
            faces.append(bm.faces.new((a[k], a[j], b[j], b[k])))
    if cap:
        faces.append(bm.faces.new(list(reversed(rings[0]))))
        faces.append(bm.faces.new(rings[-1]))
    bmesh.ops.reverse_faces(bm, faces=faces)  # the ring parametrisation winds inward
    for f in faces:
        f.material_index = mat_index
    return faces


def bm_transform(bm, matrix: Matrix, verts=None):
    bmesh.ops.transform(bm, matrix=matrix, verts=list(verts) if verts is not None else bm.verts)


def bm_fix_normals(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def bevel_edges(bm, edges, offset: float, segments: int = 1, profile: float = 0.5):
    edges = [e for e in edges if e.is_valid]
    if not edges:
        return
    bmesh.ops.bevel(bm, geom=edges, offset=offset, offset_type="OFFSET", segments=segments,
                    profile=profile, affect="EDGES", clamp_overlap=True, loop_slide=True)


def cleanup_degenerate(bm, area_eps: float = 1e-6):
    """Remove zero-area slivers left by booleans / bevel clamping (each one would otherwise become
    its own atlas island and waste margin space)."""
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bad = [f for f in bm.faces if f.calc_area() < area_eps]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="FACES")
    loose_e = [e for e in bm.edges if not e.link_faces]
    if loose_e:
        bmesh.ops.delete(bm, geom=loose_e, context="EDGES")
    loose_v = [v for v in bm.verts if not v.link_faces]
    if loose_v:
        bmesh.ops.delete(bm, geom=loose_v, context="VERTS")
    return len(bad)


def sharp_convex_edges(bm, min_angle_deg: float = 30.0, exclude=None):
    """Manifold convex edges whose dihedral angle exceeds min_angle_deg."""
    lim = math.radians(min_angle_deg)
    out = []
    for e in bm.edges:
        if len(e.link_faces) != 2 or not e.is_convex:
            continue
        try:
            ang = e.calc_face_angle()
        except ValueError:
            continue
        if ang > lim and (exclude is None or not exclude(e)):
            out.append(e)
    return out


# ── booleans (EXACT solver) ─────────────────────────────────────────────────────────────────────
def mesh_object_from_bm(name: str, bm, mats: list[str], coll=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    for m in mats:
        me.materials.append(get_material(m))
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    return ob


def boolean_chain(base_obj, steps) -> "bpy.types.Mesh":
    """Evaluate base_obj with boolean modifiers [(op, [objects]), ...] using the EXACT solver and
    material_mode INDEX. Returns a new Mesh datablock; operand objects are removed."""
    tmp_colls = []
    for k, (op, objs) in enumerate(steps):
        coll = bpy.data.collections.new(f"_bool_{base_obj.name}_{k}")
        bpy.context.scene.collection.children.link(coll)
        for o in objs:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)
        coll.hide_render = True
        mod = base_obj.modifiers.new(f"bool{k}", "BOOLEAN")
        mod.operation = op
        mod.operand_type = "COLLECTION"
        mod.collection = coll
        mod.solver = "EXACT"
        mod.use_self = True
        mod.material_mode = "INDEX"
        tmp_colls.append(coll)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(base_obj.evaluated_get(dg))
    base_obj.modifiers.clear()
    for coll in tmp_colls:
        for o in list(coll.objects):
            data = o.data
            bpy.data.objects.remove(o)
            if data is not None and data.users == 0:
                bpy.data.meshes.remove(data)
        bpy.data.collections.remove(coll)
    return me


# ── UVs ──────────────────────────────────────────────────────────────────────────────────────────
def uv_box_metres(me, layer_name: str = "UVMap"):
    """UV0 in metres: per-face planar box projection, 1 UV unit = 1 m along the surface.

    Floors / slopes (|n.z| >= 0.5): u = along the in-plane projection of world +X, v = along the
    in-plane direction that is glTF +Z on a flat floor. Walls: u = horizontal, increasing to the
    viewer's right when facing the wall, v = height. The glTF exporter writes v' = 1 - v, so the
    stored Blender v is pre-flipped: exported TEXCOORD_0 is exactly (u, v) as described.
    """
    if layer_name not in me.uv_layers:
        me.uv_layers.new(name=layer_name)
    uv = me.uv_layers[layer_name].data
    X = Vector((1, 0, 0))
    Z = Vector((0, 0, 1))
    Gz = Vector((0, -1, 0))  # glTF +Z in Blender space
    for p in me.polygons:
        n = p.normal
        if n.length < 1e-8:
            t1, t2 = X, Gz
        elif abs(n.z) >= 0.5:
            t1 = X - n * n.dot(X)
            if t1.length < 1e-6:
                t1 = Gz - n * n.dot(Gz)
            t1.normalize()
            t2 = n.cross(t1).normalized()
            if t2.dot(Gz) < 0:
                t2 = -t2
        else:
            t1 = Z.cross(n)
            t1.normalize()
            t2 = Z
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = co.dot(t1)
            v = co.dot(t2)
            uv[li].uv = (u, 1.0 - v)


def face_area_sum(me) -> float:
    return sum(p.area for p in me.polygons)
