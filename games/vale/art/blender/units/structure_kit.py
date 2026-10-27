"""VALE structure kit: boolean-free hard-surface architecture + the painted bake for the structures.

Used by art/blender/units/structures.py (the Needles, the Lantern and the Hourbell in two cultures).

Geometry (numpy + bmesh, metres, Blender Z up, origin at the ground centre, identity transforms so
object space = world space for the procedural paint):
  lathe(profile)        surface of revolution of an (r, z) profile; full or partial (sector) sweeps,
                        open or closed profiles, `segs` 8 = an octagonal shaft (flat facets)
  sweep(path, w, d)     a rectangular moulding along a 3-D path (bands, arch frames, dome ribs)
  prism(poly, frame)    a 2-D outline extruded along an axis with chamfered edges (fins, panes,
                        gables, blades, blocks)
  crystal(...)          an n-sided bipyramid with a waist band (dawnglass shards, accent cores)
Every piece goes into the bmesh of ONE material (or of a named animated node) and carries a random
`vale_var` per piece (per-stone value variation in the paint). Profiles are given counter-clockwise in
the (r, z) half-plane (bottom outward, side up, top inward), which makes every normal point out.

Surfacing (one base-colour atlas per structure, the fighters' bake method without the explode):
  * materials = the bible vocabulary (common.materials: honed stone, glass), each multiplied by the
    piece's `vale_var`, painted with cavity dirt, chalked convex edges, top light and the
    structure's value gradient (dark feet, lit crown), plus rain streaks and chips;
  * smart-UV + pack, EMIT bake of the painted base colour, an AO bake over the assembled structure
    (accent pieces occlude), AO multiplied into the base colour; roughness stays a factor;
  * `accent` pieces are not baked: the renderer tints that material per viewer (CONTRACT §12).
"""
from __future__ import annotations

import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from common import bake as BK
from common import materials as M
from common import scene

TAU = math.tau


# ── geometry primitives (return verts Nx3, faces [tuple]) ──────────────────────────────────────────
def lathe(profile, segs: int = 32, a0: float = 0.0, a1: float | None = None, closed: bool = False, phase: float = 0.0):
    """Revolve an (r, z) profile about +Z. Points with r ~ 0 collapse to a pole. `a1` None = a full
    turn; a partial sweep gets flat end caps (the profile polygon must then be closed or touch the axis)."""
    full = a1 is None
    n = segs if full else segs + 1
    span = TAU if full else (a1 - a0)
    angs = [phase + a0 + span * j / segs for j in range(n)]
    verts, rings = [], []
    for r, z in profile:
        if r < 1e-5:
            rings.append([len(verts)])
            verts.append((0.0, 0.0, z))
        else:
            idx = []
            for a in angs:
                idx.append(len(verts))
                verts.append((r * math.cos(a), r * math.sin(a), z))
            rings.append(idx)
    faces = []
    m = len(profile)
    pairs = [(k, k + 1) for k in range(m - 1)] + ([(m - 1, 0)] if closed else [])
    jn = segs if full else segs
    for k0, k1 in pairs:
        A, Bq = rings[k0], rings[k1]
        if len(A) == 1 and len(Bq) == 1:
            continue
        for j in range(jn):
            j1 = (j + 1) % n if full else j + 1
            if len(A) == 1:
                faces.append((A[0], Bq[j1], Bq[j]))
            elif len(Bq) == 1:
                faces.append((A[j], A[j1], Bq[0]))
            else:
                faces.append((A[j], A[j1], Bq[j1], Bq[j]))
    if not full:
        c0 = [ring[0] for ring in rings]
        c1 = [ring[-1] for ring in rings]
        c0 = list(dict.fromkeys(c0))
        c1 = list(dict.fromkeys(c1))
        if len(c0) >= 3:
            faces.append(tuple(c0))            # orientation fixed by recalc (closed solid)
        if len(c1) >= 3:
            faces.append(tuple(reversed(c1)))
    return np.array(verts, dtype=np.float64), faces


def chamfer_profile(pts, c: float):
    """Insert a chamfer of size c at every interior corner of an (r, z) polyline (sharp corners only)."""
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = (np.array(pts[i - 1]), np.array(pts[i]), np.array(pts[i + 1]))
        d0, d1 = p1 - p0, p2 - p1
        l0, l1 = np.linalg.norm(d0), np.linalg.norm(d1)
        if l0 < 1e-6 or l1 < 1e-6 or p1[0] < 1e-5:
            out.append(tuple(p1))
            continue
        cosang = float(np.dot(d0, d1) / (l0 * l1))
        if cosang > 0.94:                       # nearly straight: keep
            out.append(tuple(p1))
            continue
        cc = min(c, l0 * 0.45, l1 * 0.45)
        out.append(tuple(p1 - d0 / l0 * cc))
        out.append(tuple(p1 + d1 / l1 * cc))
    out.append(pts[-1])
    return out


def sweep(path, w: float, d: float, out_fn=None, closed: bool = False, sink: float = 0.01, up=(0, 0, 1)):
    """Rectangular section (width w across, depth d outward) along a 3-D path. `out_fn(p)` gives the
    outward direction at p (default: radial from the Z axis). The section spans [-sink, d] outward."""
    P = np.asarray(path, dtype=np.float64)
    n = len(P)
    verts, faces = [], []
    for i in range(n):
        if closed:
            t = P[(i + 1) % n] - P[(i - 1) % n]
        else:
            t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        t = t / (np.linalg.norm(t) + 1e-12)
        o = np.array(out_fn(P[i]) if out_fn else (P[i][0], P[i][1], 0.0), dtype=np.float64)
        o = o - t * np.dot(o, t)
        if np.linalg.norm(o) < 1e-8:
            o = np.array(up, dtype=np.float64) - t * np.dot(up, t)
        o /= np.linalg.norm(o) + 1e-12
        b = np.cross(t, o)
        for (sw, sd) in ((-0.5, -sink), (0.5, -sink), (0.5, d), (-0.5, d)):
            verts.append(P[i] + b * sw * w + o * sd)
    segs = n if closed else n - 1
    for i in range(segs):
        a, c = i * 4, ((i + 1) % n) * 4
        for k in range(4):
            k1 = (k + 1) % 4
            faces.append((a + k, a + k1, c + k1, c + k))
    if not closed:
        faces.append((3, 2, 1, 0))
        e = (n - 1) * 4
        faces.append((e, e + 1, e + 2, e + 3))
    return np.array(verts), faces


def prism(poly, origin=(0, 0, 0), u=(1, 0, 0), v=(0, 0, 1), depth: float = 0.1, chamfer: float = 0.0, center: bool = True):
    """A 2-D outline (u, v coordinates) extruded by `depth` along w = u x v; chamfered edges."""
    o, U, Vv = (np.asarray(x, dtype=np.float64) for x in (origin, u, v))
    W = np.cross(U, Vv)
    W /= np.linalg.norm(W)
    bm = bmesh.new()
    off = -depth / 2 if center else 0.0
    vs = [bm.verts.new(tuple(o + U * p[0] + Vv * p[1] + W * off)) for p in poly]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=tuple(W * depth))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if chamfer > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=chamfer, offset_type="OFFSET", segments=1,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
    return _bm_arrays(bm)


def box(center, half, chamfer: float = 0.0, rz: float = 0.0):
    """An axis box (half extents in its own x, y, z), turned rz about Z, chamfered edges."""
    hx, hy, hz = half
    u = (math.cos(rz), math.sin(rz), 0.0)
    poly = [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)]
    return prism(poly, origin=center, u=u, v=(0, 0, 1), depth=2 * hy, chamfer=chamfer)


def crystal(center, r: float, h_up: float, h_down: float, sides: int = 4, band: float = 0.0, phase: float = 0.0):
    c = np.asarray(center, dtype=np.float64)
    verts = [c + (0, 0, h_up)]
    rings = [(band / 2, r), (-band / 2, r)] if band > 0 else [(0.0, r)]
    for z, rr in rings:
        for j in range(sides):
            a = phase + TAU * j / sides
            verts.append(c + (rr * math.cos(a), rr * math.sin(a), z))
    verts.append(c - (0, 0, h_down))
    faces = []
    top, bot = 0, len(verts) - 1
    r0 = 1
    for j in range(sides):
        faces.append((top, r0 + j, r0 + (j + 1) % sides))
    if band > 0:
        r1 = 1 + sides
        for j in range(sides):
            j1 = (j + 1) % sides
            faces.append((r0 + j, r1 + j, r1 + j1, r0 + j1))
        rl = r1
    else:
        rl = r0
    for j in range(sides):
        faces.append((bot, rl + (j + 1) % sides, rl + j))
    return np.array(verts), faces


def _bm_arrays(bm):
    bm.verts.index_update()
    v = np.array([tuple(x.co) for x in bm.verts], dtype=np.float64)
    f = [tuple(x.index for x in face.verts) for face in bm.faces]
    bm.free()
    return v, f


# ── transforms ──────────────────────────────────────────────────────────────────────────────────
def rotz(V, a: float):
    c, s = math.cos(a), math.sin(a)
    R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])
    return V @ R.T


def rot(V, axis, a: float, about=(0, 0, 0)):
    R = np.array(Matrix.Rotation(a, 3, Vector(axis)))
    p = np.asarray(about, dtype=np.float64)
    return (V - p) @ R.T + p


def move(V, d):
    return V + np.asarray(d, dtype=np.float64)


def polar(fn, n: int, phase: float = 0.0):
    """[(verts, faces)] of fn() rotated n times about Z."""
    out = []
    for i in range(n):
        v, f = fn(i)
        out.append((rotz(v, phase + TAU * i / n), f))
    return out


def arch_path(w: float, spring: float, kind: str = "round", n: int = 12, bottom: float = 0.0, k: float = 0.8):
    """2-D (u, v) path of an arch opening: up the right jamb, over the head, down the left jamb.
    kind 'round' = semicircle; 'pointed' = two arcs of radius k*w (k 0.5 round .. 1 equilateral)."""
    pts = [(w / 2, bottom), (w / 2, spring)]
    if kind == "round":
        for i in range(1, n):
            a = math.pi * i / n
            pts.append((w / 2 * math.cos(a), spring + w / 2 * math.sin(a)))
    else:
        R = max(w / 2 + 1e-4, k * w)
        cx = w / 2 - R                              # right arc centre (cx, spring)
        ta = math.acos(max(-1.0, min(1.0, (0.0 - cx) / R)))
        half = max(2, n // 2)
        for i in range(1, half + 1):
            a = ta * i / half
            pts.append((cx + R * math.cos(a), spring + R * math.sin(a)))
        for i in range(half - 1, 0, -1):
            a = ta * i / half
            pts.append((-(cx + R * math.cos(a)), spring + R * math.sin(a)))
    pts += [(-w / 2, spring), (-w / 2, bottom)]
    return pts


def arch_apex(w: float, spring: float, kind: str = "round", k: float = 0.8) -> float:
    if kind == "round":
        return spring + w / 2
    R = max(w / 2 + 1e-4, k * w)
    cx = w / 2 - R
    return spring + math.sqrt(max(0.0, R * R - cx * cx))


def arch_outline(w: float, spring: float, kind: str = "round", n: int = 12, bottom: float = 0.0):
    """Closed 2-D outline of an arched pane (the arch path closed along the sill)."""
    p = arch_path(w, spring, kind, n, bottom)
    # drop duplicated spring points
    out = []
    for q in p:
        if not out or abs(out[-1][0] - q[0]) + abs(out[-1][1] - q[1]) > 1e-6:
            out.append(q)
    return out


def on_cylinder(path_uv, R: float, ang: float, z0: float = 0.0, lift: float = 0.0):
    """Wrap a 2-D (u along the circumference, v up) path onto a cylinder of radius R at angle ang."""
    out = []
    for u, v in path_uv:
        a = ang + u / R
        out.append(((R + lift) * math.cos(a), (R + lift) * math.sin(a), z0 + v))
    return out


def in_plane(path_uv, origin, u, v):
    o, U, Vv = (np.asarray(x, dtype=np.float64) for x in (origin, u, v))
    return [tuple(o + U * a + Vv * b) for a, b in path_uv]


# ── the build: one bmesh per material / node ──────────────────────────────────────────────────────
class Build:
    def __init__(self, name: str, height: float, seed: int | None = None):
        self.name = name
        self.height = height
        self.rng = random.Random(scene.seed_of(name) if seed is None else seed)
        self.parts: dict[tuple[str, str], list] = {}      # (node, material) -> [(verts, faces, var, piece id)]
        self.anims: dict[str, dict] = {}                   # node -> {"pivot": (x,y,z), "clips": {...}}
        self.pieces: list[dict] = []                       # piece id -> {"node", "mat"} (the damage/ruin split)
        self.plinth_top = 0.0                              # top of the dial-stone plinth (stays in the ruin)

    def add(self, mat: str, piece, node: str = "body", var: float | None = None):
        if piece is None:
            return
        if isinstance(piece, list):
            for p in piece:
                self.add(mat, p, node, var)
            return
        v, f = piece
        if mat == "accent" and node == "body":
            node = "glow"                     # live accent pieces stay out of the baked body
        if var is None:
            var = self.rng.uniform(-1.0, 1.0)
        pid = len(self.pieces)
        self.pieces.append({"node": node, "mat": mat})
        self.parts.setdefault((node, mat), []).append((np.asarray(v, dtype=np.float64), list(f), var, pid))

    def scale(self, s: float):
        """Uniform scale about the ground centre (r12 M9: structures at ~2.5x fighter height)."""
        for lst in self.parts.values():
            for i, (v, f, var, pid) in enumerate(lst):
                lst[i] = (v * s, f, var, pid)
        self.plinth_top *= s

    def tris(self) -> int:
        t = 0
        for lst in self.parts.values():
            for _, f, _, _ in lst:
                t += sum(len(x) - 2 for x in f)
        return t

    def objects(self, col, sharp_deg: float = 38.0) -> dict:
        """node -> object (materials as slots; `vale_var` point attribute). Each piece is welded and its
        normals recalculated on its own (pieces are closed solids), so touching pieces never merge."""
        nodes: dict[str, list] = {}
        for (node, mat), lst in self.parts.items():
            nodes.setdefault(node, []).append((mat, lst))
        out = {}
        for node, groups in nodes.items():
            bm = bmesh.new()
            lay = bm.verts.layers.float.new("vale_var")
            play = bm.verts.layers.int.new("vale_piece")
            mats = []
            for mat, lst in groups:
                mi = len(mats)
                mats.append(mat)
                for v, f, var, pid in lst:
                    vs = [bm.verts.new(tuple(p)) for p in v]
                    for x in vs:
                        x[lay] = var
                        x[play] = pid
                    pf = []
                    for face in f:
                        if len(set(face)) < 3:
                            continue
                        try:
                            nf = bm.faces.new([vs[i] for i in face])
                            nf.material_index = mi
                            pf.append(nf)
                        except ValueError:
                            pass
                    bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-6)
                    pf = [x for x in pf if x.is_valid]
                    if pf:
                        bmesh.ops.recalc_face_normals(bm, faces=pf)
            loose = [v for v in bm.verts if not v.link_faces]
            if loose:
                bmesh.ops.delete(bm, geom=loose, context="VERTS")
            me = bpy.data.meshes.new(f"{self.name}_{node}")
            bm.normal_update()
            bm.to_mesh(me)
            bm.free()
            for mat in mats:
                me.materials.append(bpy.data.materials.get(mat))
            me.shade_smooth()
            me.set_sharp_from_angle(angle=math.radians(sharp_deg))
            ob = bpy.data.objects.new(f"{self.name}_{node}", me)
            col.objects.link(ob)
            out[node] = ob
        return out


def fix_normals_outward(ob):
    """Recalculate normals per connected piece (closed pieces point out)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def drop_hidden_bottoms(ob, z: float = 0.02):
    """Delete faces lying on the ground facing down (never seen, wastes atlas space)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    kill = [f for f in bm.faces if f.normal.z < -0.98 and f.calc_center_median().z < z]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def drop_buried_faces(ob, others=()) -> int:
    """Delete faces buried inside other closed pieces (stacked lathe caps, sunk frame backs, block
    faces inside floors): a face goes when its centre AND every corner (pulled 12 % toward the centre),
    nudged 2 mm along the normal, first hit a back face when cast along the normal (= they sit inside a
    solid). Frees most of the atlas for what the camera can see."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for o in others:                               # accent pieces occlude too (ticks on the plinth, cores)
        bm2 = bmesh.new()
        bm2.from_mesh(o.data)
        me = bpy.data.meshes.new("_occ")
        bm2.to_mesh(me)
        bm2.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    bvh = BVHTree.FromBMesh(bm)
    n_own = len(ob.data.polygons)
    kill = []
    for f in bm.faces[:n_own]:
        n = f.normal
        if n.length < 0.5:
            continue
        c = f.calc_center_median()
        pts = [c] + [v.co.lerp(c, 0.12) for v in f.verts]
        t1 = n.orthogonal().normalized()
        t2 = n.cross(t1)
        dirs = [n] + [(n + t * 0.7).normalized() for t in (t1, -t1, t2, -t2)]
        inside = True
        for p in pts:
            votes = 0
            for d in dirs:                      # majority vote: a stray sunk piece must not save a buried face
                hit = bvh.ray_cast(p + n * 0.002, d, 30.0)
                if hit[0] is None:
                    continue
                if hit[1].dot(d) > 0.05:
                    votes += 1
                elif any(h[1].dot(d) > 0.05 for h in bvh.find_nearest_range(hit[0], 2e-4)):
                    votes += 1                  # stacked pieces: the next piece's coincident cap hides our exit
            if votes < 3:
                inside = False
                break
        if inside:
            kill.append(f.index)
    bm.free()
    if not kill:
        return 0
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(kill)


# ── painted materials ─────────────────────────────────────────────────────────────────────────────
def _var_multiply(mat, amount: float):
    """Multiply the Base Color by (1 + amount * vale_var): per-stone value variation."""
    nt = mat.node_tree
    b = nt.nodes.get("BSDF")
    sock = b.inputs["Base Color"]
    if not sock.is_linked:
        return
    src = sock.links[0].from_socket
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "vale_var"
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY_ADD"
    nt.links.new(at.outputs["Fac"], mul.inputs[0])
    mul.inputs[1].default_value = amount
    mul.inputs[2].default_value = 1.0
    cc = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(mul.outputs[0], cc.inputs[i])
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MULTIPLY"
    mx.inputs[0].default_value = 1.0
    nt.links.new(src, mx.inputs[6])
    nt.links.new(cc.outputs[0], mx.inputs[7])
    nt.links.new(mx.outputs[2], sock)


def _weather(mat, hexcol: str, streaks: float, chips: float, height: float):
    """Rain streaks under every ledge (vertical stretched noise, stronger low on the form) and
    small pale chips on edges (the Bevel edge mask x a coarse noise)."""
    if streaks <= 0 and chips <= 0:
        return
    g = M.G.__new__(M.G)
    g.mat, g.nt, g.x, g._coord, g._geo = mat, mat.node_tree, -2000, None, None
    g.bsdf = mat.node_tree.nodes.get("BSDF")
    sock = g.bsdf.inputs["Base Color"]
    src = sock.links[0].from_socket
    c = src
    if streaks > 0:
        n = g.noise(g.mapping(g.obj, scale=(9.0, 9.0, 0.55)), scale=3.0, detail=3.0, rough=0.55)
        st = g.ramp(n.outputs["Fac"], [(0.52, 0.0), (0.72, 1.0)])
        # streaks fade toward the crown (rain dirt collects low) and only on near-vertical faces
        z = g.sep_z()
        zf = g.math("SUBTRACT", 1.0, g.math("MULTIPLY", z, 1.0 / max(1.0, height), clamp=True))
        sep = g.n("ShaderNodeSeparateXYZ")
        g.link(g.geo.outputs["Normal"], sep.inputs[0])
        vert = g.math("SUBTRACT", 1.0, g.math("ABSOLUTE", sep.outputs["Z"]))
        k = g.math("MULTIPLY", g.math("MULTIPLY", st, zf), g.math("MULTIPLY", vert, streaks), clamp=True)
        c = g.mix(c, M.shade_hex(hexcol, 0.62, 1.05), k)
    if chips > 0:
        e = M.edge_mask(g, 0.03, 5.0)
        n2 = g.noise(scale=7.0, detail=4.0, rough=0.7)
        cm = g.math("MULTIPLY", e, g.ramp(n2.outputs["Fac"], [(0.5, 0.0), (0.62, 1.0)]))
        c = g.mix(c, M.shade_hex(hexcol, 1.22, 0.7), g.math("MULTIPLY", cm, chips))
    g.link(c, sock)


def _masonry(mat, brick: tuple, strength: float):
    """Coursed masonry painted on near-vertical faces: a Brick texture in (arc length around Z, height)
    coordinates (the seam sits on +X, away from the camera side), dark mortar joints and a value per
    stone; faded out on tops (|normal z| > 0.7)."""
    if strength <= 0:
        return
    bw, bh, mortar = brick
    g = M.G.__new__(M.G)
    g.mat, g.nt, g.x, g._coord, g._geo = mat, mat.node_tree, -3000, None, None
    g.bsdf = mat.node_tree.nodes.get("BSDF")
    sock = g.bsdf.inputs["Base Color"]
    src = sock.links[0].from_socket
    sep = g.n("ShaderNodeSeparateXYZ")
    g.link(g.obj, sep.inputs[0])
    nx = g.math("MULTIPLY", sep.outputs["X"], -1.0)
    ny = g.math("MULTIPLY", sep.outputs["Y"], -1.0)
    ang = g.math("ARCTAN2", ny, nx)
    rad = g.math("MAXIMUM", g.math("SQRT", g.math("ADD", g.math("POWER", sep.outputs["X"], 2.0), g.math("POWER", sep.outputs["Y"], 2.0))), 0.25)
    u = g.math("MULTIPLY", ang, rad)
    cv = g.n("ShaderNodeCombineXYZ")
    g.link(u, cv.inputs[0])
    g.link(sep.outputs["Z"], cv.inputs[1])
    br = g.n("ShaderNodeTexBrick")
    br.offset = 0.5
    br.squash = 1.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = bw
    br.inputs["Row Height"].default_value = bh
    br.inputs["Mortar Size"].default_value = mortar
    br.inputs["Mortar Smooth"].default_value = 0.25
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Color1"].default_value = (1.0, 1.0, 1.0, 1.0)
    br.inputs["Color2"].default_value = (0.86, 0.86, 0.86, 1.0)
    br.inputs["Mortar"].default_value = (0.5, 0.5, 0.5, 1.0)
    g.link(cv.outputs[0], br.inputs["Vector"])
    nz = g.n("ShaderNodeSeparateXYZ")
    g.link(g.geo.outputs["Normal"], nz.inputs[0])
    vert = g.math("SUBTRACT", 1.0, g.math("MULTIPLY", g.math("ABSOLUTE", nz.outputs["Z"]), 1.4), clamp=True)
    k = g.math("MULTIPLY", vert, strength)
    c = g.mix(src, g.mix(src, br.outputs["Color"], 1.0, "MULTIPLY"), k)
    g.link(c, sock)


def paint_set(spec: dict, height: float) -> dict:
    """Build the structure's painted materials. spec: name -> dict(kind, hex, rough, var, streaks,
    chips, chisel, speckle, veins, scale). kind: stone | glass | accent."""
    grad = M.bible_gradient(height, [(0.0, 0.58), (0.06, 0.68), (0.2, 0.84), (0.5, 0.96), (0.8, 1.04), (1.0, 1.1)])
    out = {}
    for name, s in spec.items():
        kind = s.get("kind", "stone")
        pal = {name: s["hex"], "accent": s.get("hex", "#3F9CFF")}
        if kind == "accent":
            m = M.accent(pal, key="accent", base_value=0.3)
        elif kind == "glass":
            m = M.glass(name, pal, name, grad, rough=s.get("rough", 0.18), inclusions=s.get("inclusions", 0.35))
        else:
            m = M.honed_stone(name, pal, name, grad, rough=s.get("rough", 0.7), chisel=s.get("chisel", 0.8),
                              speckle=s.get("speckle", 0.0), veins=s.get("veins", 0.0), scale=s.get("scale", 0.6))
            _weather(m, s["hex"], s.get("streaks", 0.35), s.get("chips", 0.45), height)
            if s.get("brick"):
                _masonry(m, s["brick"], s.get("brick_k", 0.6))
        if kind != "accent":
            _var_multiply(m, s.get("var", 0.07))
        out[name] = m
    return out


# ── bake ──────────────────────────────────────────────────────────────────────────────────────────
def bake_body(body, others, out_dir: str, name: str, size: int = 1024, samples: int = 24, ao_samples: int = 96,
              ao_distance: float = 0.8, ao_into: float = 0.55, rough: float = 0.72, unwrap_angle: float = 55.0) -> bpy.types.Material:
    """Bake `body`'s painted multi-material look into ONE base-colour atlas (JPEG) and replace its
    materials with a single glTF-ready material. `others` (accent pieces, cores) occlude the AO."""
    sc = bpy.context.scene
    BK.unwrap(body, angle=unwrap_angle, margin=0.004)
    BK._setup_cycles(samples)
    base = BK.new_image(f"{name}_base", size, False)
    ao = BK.new_image(f"{name}_ao", size, True, (1, 1, 1, 1))
    mats = [s.material for s in body.material_slots if s.material]
    targets = []
    for m in mats:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.name = "_bake_target"
        t.image = base
        m.node_tree.nodes.active = t
        targets.append((m, t))
    vis = {o: o.hide_render for o in sc.objects}
    for o in sc.objects:
        o.hide_render = o is not body
    scene.select_only([body], body)
    r = BK._Route(mats, "Base Color")
    try:
        bpy.ops.object.bake(type="EMIT", use_selected_to_active=False, margin=8, use_clear=True)
    finally:
        r.restore()
    # AO over the assembled structure
    for o in sc.objects:
        o.hide_render = not (o is body or o in others)
    sc.cycles.samples = ao_samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bake_world")
    sc.world.light_settings.distance = ao_distance
    for m, t in targets:
        t.image = ao
    scene.select_only([body], body)
    bpy.ops.object.bake(type="AO", use_selected_to_active=False, margin=8, use_clear=True)
    for o, h in vis.items():
        o.hide_render = h
    b = BK.image_array(base)
    a = np.clip(BK.image_array(ao)[..., 0], 0, 1)
    k = (1.0 - ao_into) + ao_into * np.power(a, 0.9)
    b[..., :3] *= k[..., None]
    BK.set_image_array(base, b)
    path = BK.save_image(base, os.path.join(out_dir, f"{name}_base.jpg"), "JPEG", 90)
    bpy.data.images.remove(ao)
    for m, t in targets:
        m.node_tree.nodes.remove(t)
    # one exported material: baked base colour, roughness factor
    mat = bpy.data.materials.new(f"{name}_stone")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.name = "BSDF"
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    img = bpy.data.images.load(path, check_existing=True)
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = img
    nt.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    body.data.materials.clear()
    body.data.materials.append(mat)
    return mat


# ── node animation (object-level glTF clips, NLA tracks) ─────────────────────────────────────────
def clip(ob, name: str, keys: dict):
    """keys: data_path -> [(frame, value(s))]; one action + NLA track named `name`."""
    ob.animation_data_create()
    act = bpy.data.actions.new(name)
    ob.animation_data.action = act
    for path, ks in keys.items():
        for f, val in ks:
            setattr(ob, path, val)
            ob.keyframe_insert(path, frame=f)
    act.use_fake_user = True
    tr = ob.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, int(min(f for ks in keys.values() for f, _ in ks)), act)
    ob.animation_data.action = None


def export_glb(root, path: str):
    objs = [root] + list(root.children_recursive)
    scene.select_only(objs, active=root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(**scene.op_kwargs(
        bpy.ops.export_scene.gltf, filepath=path, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True, export_tangents=False,
        export_vertex_color="NONE", export_materials="EXPORT", export_image_format="AUTO", export_jpeg_quality=90,
        export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_skins=False, export_lights=False, export_cameras=False, export_extras=False))
    return path


# ── r12 M9: damage states, the collapse split and the ruin ────────────────────────────────────────
# A structure GLB carries, under its root (names end in the part; the renderer finds them by suffix):
#   _base       the dial-stone plinth (always shown; it stays in the ruin)
#   _glow_base  the plinth's accent hour-ticks (their light goes out with the structure)
#   _upper      everything above the plinth (falls in the collapse), parent of:
#     _chip1 / _chip2   small pieces that break off at the first / second damage threshold (hidden then)
#     _dmg1 / _dmg2     crack ribbons (dark ink with a live accent seam) shown from that threshold on
#     _glow, _core      the accent pieces and the animated accent core
#   _ruin       the broken stump (the upper pieces below a tilted break, the break capped in raw stone)
#               and rubble (copies of the tower's own stones, so they wear the same bake); <= 1.5 m tall
# _base, _upper, _chip*, _ruin share the one baked material; the ruin's caps use `<name>_ruin_core`.
def piece_bounds(B: Build):
    for lst in B.parts.values():
        for v, _f, _var, pid in lst:
            p = B.pieces[pid]
            lo, hi = v.min(axis=0), v.max(axis=0)
            if "lo" in p:
                lo, hi = np.minimum(lo, p["lo"]), np.maximum(hi, p["hi"])
            p["lo"], p["hi"] = lo, hi


def classify(B: Build, rng: random.Random, chip1: float = 0.2, chip2: float = 0.26) -> dict:
    """piece groups: base (plinth), upper, chip1, chip2 (body pieces only), glow_base, glow."""
    piece_bounds(B)
    zt = B.plinth_top + 0.06
    H = max(float(p["hi"][2]) for p in B.pieces if "hi" in p)
    g = {k: set() for k in ("base", "upper", "chip1", "chip2", "glow_base", "glow", "core")}
    cands = []
    for pid, p in enumerate(B.pieces):
        if "hi" not in p:
            continue
        low = float(p["hi"][2]) <= zt
        if p["node"] == "core":
            g["core"].add(pid)
        elif p["node"] == "glow":
            g["glow_base" if low else "glow"].add(pid)
        elif low:
            g["base"].add(pid)
        else:
            g["upper"].add(pid)
            d = float(np.linalg.norm(p["hi"] - p["lo"]))
            cz = float(p["lo"][2] + p["hi"][2]) / 2
            if 0.08 < d < 0.8 and cz > zt + 0.3 * (H - zt) and not p.get("nochip"):
                cands.append((pid, cz))
    cands.sort(key=lambda x: -float(B.pieces[x[0]]["hi"][2]))
    picked1 = {pid for pid, _ in cands[:2]}                  # the crown's tip goes first (a silhouette change)
    rest = [pid for pid, _ in cands[2:]]
    rng.shuffle(rest)
    n1 = max(1, int(len(rest) * chip1))
    n2 = max(2, int(len(rest) * chip2))
    picked1 |= set(rest[:n1])
    picked2 = set(rest[n1:n1 + n2])
    g["chip1"], g["chip2"] = picked1, picked2
    g["upper"] -= picked1 | picked2
    return g


def _face_pieces(me) -> np.ndarray:
    vp = np.zeros(len(me.vertices), dtype=np.int32)
    me.attributes["vale_piece"].data.foreach_get("value", vp)
    ls = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", ls)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    return vp[lv[ls]] if len(ls) else np.zeros(0, dtype=np.int32)


def subset(ob, pids: set, name: str, col):
    """A new object holding only the faces of these pieces (same materials, UVs, attributes)."""
    fp = _face_pieces(ob.data)
    keep = np.isin(fp, np.array(sorted(pids), dtype=np.int32)) if pids else np.zeros(len(fp), dtype=bool)
    if not keep.any():
        return None
    me = ob.data.copy()
    me.name = name
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.nonzero(~keep)[0]], context="FACES")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    return o


def plain_material(name: str, hexcol: str, rough: float = 0.85):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*scene.hex_rgb(hexcol), 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    return m


def _cap_holes(bm, mat_index: int) -> int:
    edges = [e for e in bm.edges if e.is_boundary]
    if not edges:
        return 0
    r = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    for f in r["faces"]:
        f.material_index = mat_index
    bmesh.ops.recalc_face_normals(bm, faces=r["faces"])
    return len(r["faces"])


def _piece_bms(ob, pids):
    """{pid: bmesh} of each piece of `ob` (copies)."""
    fp = _face_pieces(ob.data)
    out = {}
    for pid in pids:
        if not np.any(fp == pid):
            continue
        tmp = subset(ob, {pid}, "_tmp_piece", bpy.context.scene.collection)
        bm = bmesh.new()
        bm.from_mesh(tmp.data)
        me = tmp.data
        bpy.data.objects.remove(tmp)
        bpy.data.meshes.remove(me)
        out[pid] = bm
    return out


def make_ruin(body, B: Build, groups: dict, rng: random.Random, name: str, col, core_hex: str,
              cut: float, max_h: float = 1.45, rubble: int = 10, plinth_r: float = 1.8):
    """The persistent ruin: the upper pieces that reach below `cut`, broken along a tilted plane and
    capped in raw stone, plus `rubble` of the tower's own stones lying on and around the plinth."""
    from mathutils import Euler
    core = plain_material(f"{name}_ruin_core", core_hex, 0.92)
    upper_all = groups["upper"] | groups["chip1"] | groups["chip2"]
    stump_ids = {pid for pid in upper_all if float(B.pieces[pid]["lo"][2]) < cut}
    stump = subset(body, stump_ids, f"{name}_ruin", col)
    if stump is None:
        return None, 0.0
    stump.data.materials.append(core)
    ci = len(stump.data.materials) - 1
    src = bmesh.new()
    src.from_mesh(stump.data)
    r_max = max((Vector((v.co.x, v.co.y)).length for v in src.verts if v.co.z > B.plinth_top + 0.1), default=1.0)
    # a jagged break: three sectors, each cut along its own tilted plane at its own height (every cut capped
    # in raw stone, so a sector standing higher than its neighbour shows a broken wall); the high side of
    # every plane stays under max_h
    bm = bmesh.new()
    a0 = rng.uniform(0, TAU)
    for k in range(3):
        sb = src.copy()
        for side, ang in ((1.0, a0 + k * TAU / 3), (-1.0, a0 + (k + 1) * TAU / 3)):
            # keep the half-plane on the sector's side of the radial plane at `ang`
            nrm = Vector((-math.sin(ang), math.cos(ang), 0.0)) * -side
            bmesh.ops.bisect_plane(sb, geom=sb.verts[:] + sb.edges[:] + sb.faces[:], dist=1e-5, plane_co=(0, 0, 0), plane_no=nrm,
                                   clear_outer=True, clear_inner=False)
            _cap_holes(sb, ci)
        tilt = math.radians(rng.uniform(10.0, 22.0))
        h = cut + rng.uniform(-0.32, 0.08) * (1.0 if k else 0.4)
        h = min(h, max_h - 0.04 - math.tan(tilt) * r_max)
        if h < B.plinth_top + 0.3:
            tilt = math.atan(max(0.02, (max_h - 0.04 - B.plinth_top - 0.3) / r_max))
            h = B.plinth_top + 0.3
        mid = a0 + (k + 0.5) * TAU / 3 + rng.uniform(-0.6, 0.6)       # the plane rises toward the sector's middle or edge
        az = mid + (math.pi if rng.random() < 0.5 else 0.0)
        no = Vector((math.sin(tilt) * math.cos(az), math.sin(tilt) * math.sin(az), math.cos(tilt)))
        bmesh.ops.bisect_plane(sb, geom=sb.verts[:] + sb.edges[:] + sb.faces[:], dist=1e-5, plane_co=(0, 0, h), plane_no=no,
                               clear_outer=True, clear_inner=False)
        _cap_holes(sb, ci)
        me = bpy.data.meshes.new("_sector")
        sb.to_mesh(me)
        sb.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    src.free()
    # a hair inside the intact upper (both show for a moment as the top starts to fall: no z-fight)
    for v in bm.verts:
        v.co.x *= 0.992
        v.co.y *= 0.992
        v.co.z -= 0.004
    r_stump = max((Vector((v.co.x, v.co.y)).length for v in bm.verts if v.co.z > B.plinth_top + 0.1), default=0.6)
    top_at = cut
    # rubble: medium pieces from above the break (not whole rings), tumbled onto the plinth and the ground
    cands = []
    for pid in upper_all:
        p = B.pieces[pid]
        lo, hi = p["lo"], p["hi"]
        ext = hi - lo
        d = float(np.linalg.norm(ext))
        if float(lo[2]) < cut - 0.05 or d < 0.22 or d > 1.25 or (ext[0] > 0.8 and ext[1] > 0.8) or \
                (min(ext) < 0.1 and max(ext) > 0.6):         # no whole rings, no floor plates
            continue
        cands.append(pid)
    rng.shuffle(cands)
    pieces = _piece_bms(body, cands[: rubble * 3])
    placed = 0
    for pid in cands[: rubble * 3]:
        if placed >= rubble or pid not in pieces:
            continue
        pb = pieces[pid]
        _cap_holes(pb, ci)
        c = sum((v.co for v in pb.verts), Vector()) / max(1, len(pb.verts))
        for v in pb.verts:
            v.co -= c
        best = None
        for _ in range(8):
            e = Euler((rng.uniform(-1.4, 1.4), rng.uniform(-1.4, 1.4), rng.uniform(0, TAU)), "XYZ").to_matrix()
            zs = [(e @ v.co).z for v in pb.verts]
            h = max(zs) - min(zs)
            if best is None or h < best[0]:
                best = (h, e, min(zs))
        h, e, zmin = best
        on_top = placed < 4 and h < 0.4
        if on_top:
            rr = rng.uniform(0.0, r_stump * 0.6)
            base = top_at - 0.2
        else:
            rr = rng.uniform(r_stump + 0.15, plinth_r * 1.12)
            base = B.plinth_top if rr < plinth_r - 0.15 else 0.0
        if base - 0.05 + h > max_h:
            continue
        a = rng.uniform(0, TAU)
        off = Vector((rr * math.cos(a), rr * math.sin(a), base - 0.05 - zmin))
        for v in pb.verts:
            v.co = e @ v.co + off
        me = bpy.data.meshes.new("_rubble")
        pb.to_mesh(me)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        placed += 1
    for pb in pieces.values():
        pb.free()
    bm.normal_update()
    bm.to_mesh(stump.data)
    bm.free()
    zmax = max(v.co.z for v in stump.data.vertices)
    return stump, zmax


def cracks(targets, B: Build, rng: random.Random, n: int, z0: float, z1: float, width: float, name: str, col,
           crack_mat, accent_mat, seed_pts: int = 10):
    """Crack ribbons walking over the upper's surface (rays toward the axis): a dark ink ribbon with a
    thin live accent seam inside (the light shows through the broken stone)."""
    from mathutils.bvhtree import BVHTree
    bm_all = bmesh.new()
    for o in targets:
        bm_all.from_mesh(o.data)
    bm_all.faces.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm_all)
    R = max(max(abs(v.co.x), abs(v.co.y)) for v in bm_all.verts) * 1.5 + 1.0
    bm_all.free()

    def cast(th, z):
        o = Vector((R * math.cos(th), R * math.sin(th), z))
        d = Vector((-math.cos(th), -math.sin(th), 0.0))
        hit = bvh.ray_cast(o, d, 2 * R)
        if hit[0] is None or hit[1].dot(d) > -0.25:
            return None
        return hit[0], hit[1]

    out = bmesh.new()
    walks = []
    for _ in range(n):
        for _try in range(12):
            th, z = rng.uniform(0, TAU), rng.uniform(z0, z1)
            h = cast(th, z)
            if h:
                break
        else:
            continue
        sgn = rng.choice((-1.0, 1.0))
        pts = [h]
        th0, zz = th, z
        steps = rng.randint(6, 11)
        for _s in range(steps):
            r = max(0.25, Vector((pts[-1][0].x, pts[-1][0].y)).length)
            th0 += rng.uniform(-0.16, 0.16) / r
            zz += sgn * rng.uniform(0.08, 0.17)
            h2 = cast(th0, zz)
            if not h2 or (h2[0] - pts[-1][0]).length > 0.4:
                break
            pts.append(h2)
        if len(pts) >= 3:
            walks.append((pts, 1.0))
            if len(pts) >= 5 and rng.random() < 0.7:          # a side branch
                k = rng.randint(1, len(pts) - 2)
                thb = math.atan2(pts[k][0].y, pts[k][0].x)
                zb = pts[k][0].z
                br = [pts[k]]
                side = rng.choice((-1.0, 1.0))
                for _s in range(rng.randint(2, 4)):
                    r = max(0.25, Vector((br[-1][0].x, br[-1][0].y)).length)
                    thb += side * rng.uniform(0.08, 0.16) / r
                    zb += sgn * rng.uniform(0.03, 0.09)
                    h2 = cast(thb, zb)
                    if not h2 or (h2[0] - br[-1][0]).length > 0.3:
                        break
                    br.append(h2)
                if len(br) >= 2:
                    walks.append((br, 0.6))

    def ribbon(pts, w, off, mi):
        L = len(pts)
        left, right = [], []
        for i, (p, nrm) in enumerate(pts):
            t = (pts[min(i + 1, L - 1)][0] - pts[max(i - 1, 0)][0])
            t = t.normalized() if t.length > 1e-6 else Vector((0, 0, 1))
            b = nrm.cross(t)
            b = b.normalized() if b.length > 1e-6 else Vector((1, 0, 0))
            u = (i + 0.5) / L
            k = max(0.18, math.sin(math.pi * u) ** 0.6) * rng.uniform(0.8, 1.15)
            q = p + nrm * off
            left.append(out.verts.new(q + b * (w * k / 2)))
            right.append(out.verts.new(q - b * (w * k / 2)))
        for i in range(L - 1):
            f = out.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
            f.material_index = mi
            f.normal_update()
            if f.normal.dot(pts[i][1]) < 0:
                f.normal_flip()
    for pts, s in walks:
        ribbon(pts, width * s, 0.014, 0)
        ribbon(pts, width * s * 0.3, 0.019, 1)
    if not out.faces:
        out.free()
        return None
    me = bpy.data.meshes.new(name)
    out.to_mesh(me)
    out.free()
    me.materials.append(crack_mat)
    me.materials.append(accent_mat)
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    return o
