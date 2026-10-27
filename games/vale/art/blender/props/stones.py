"""Fallen hour-tick stones (RIFT §6), needle fragments (BRIDGE §5) and basalt chips (FRAY): chiselled,
flat-faceted dial-stone pieces with chamfered (chalk-lit) edges, carved grooves and bands, and soft
moss cushions draped over their tops. Painted, never flat grey facets (r12 M11): the value rolls from a warm lit
top to a cool occluded foot, facets only nudge it, and the lit convex edges carry a chalk rim.

A piece is cut from a box (or a drum sector) by planar chisel cuts — corner chips, and a cluster of deep
cuts on one end for the broken face — then optional loop cuts (an engraved tick groove along the top, or a
recessed hour-band round a drum), a 1-segment bevel on every hard edge, and triangulation. Every facet
keeps its own vertices and normal (crisp, painted planes). Painting is rotation-invariant: up-facing and
sky light, corner occlusion, contact darkening at the foot, chalk on the chamfers, pale inscription in the
groove, a fresh paler tone on the broken face, moss on the cushions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import bmesh
import numpy as np
from mathutils import Vector

from kit import Part, merge
from paint import Occluder, fbm3, hash01, hexc, posterize, ramp, smooth

FLAG_CHAMFER, FLAG_GROOVE, FLAG_BREAK, FLAG_BAND = 1, 2, 4, 8
SMOOTH_DEG = 40.0              # a hull lump's planes melt across turns gentler than this


@dataclass
class StoneSpec:
    seed: int
    size: tuple[float, float, float]              # x (long), y, z (height) of the uncut block (m)
    shape: str = "block"                          # block | drum (an annular sector of the needle's shaft) | hull (a lump)
    chips: int = 6                                # corner/edge chisel cuts
    broken: bool = True                           # a jagged broken face on the +x end
    bevel: float = 0.035
    groove: float = 0.0                           # width of an engraved tick groove along the top (0: none)
    band: bool = False                            # drum: a recessed hour-band round the outside
    moss: list[tuple[float, float, float]] = field(default_factory=list)   # cushions: (x, y, radius)
    tilt: tuple[float, float] = (0.0, 0.0)        # lean (rad about x, y), the piece settled in the ground
    sink: float = 0.04                            # how far the foot sits below the ground
    palette: str = "dial"
    extra: list["StoneSpec"] = field(default_factory=list)          # more pieces in the same prop
    offset: tuple[float, float, float] = (0.0, 0.0, 0.0)
    yaw: float = 0.0
    detail: float = 0.0                           # chisel micro-planes: how far a poked face centre moves (m)
    taper: float = 0.0                            # worn: the top drawn in by this fraction (a sunk, weathered piece)
    seg: int = 1                                  # bevel segments (2: a rounded, weathered edge)
    soft: float = 0.0                             # shading across the chamfers: 0 crisp facets, 1 the edge rolls from
                                                  # one face's normal to the other's (a soft, hand-painted bevel)
    dome: float = 0.0                             # the top face crowned this much (m): worn round, never a flat lid


PALETTES = {
    # RIFT dial-stone: warm grey, lit faces land L* 40-55 on screen (below the pale roads), worn lit edges
    # (r12 M11: painted, never flat — facets only nudge the value, deeper occlusion in the creases and at the
    # foot, warmer lit tops / cooler shade, a chalk rim on the lit convex edges over the chamfers)
    "dial": dict(stops=[(0.0, "#1F1D1B"), (0.25, "#37322C"), (0.5, "#514A40"), (0.75, "#6E6656"), (1.0, "#8C826E")],
                 chalk="#BDB194", groove="#B0A891", broken="#8A8173", moss="#3E4A32", moss_hi="#66703F", warm=0.13, keep=0.9,
                 facet=0.035, ao=0.68, rim=0.38),
    # BRIDGE needle stone: pale chalk-grey, cooler; fracture faces paler still (brief: L* 72 raw face)
    # BRIDGE needle stone: pale chalk-grey and COOL against the warm deck (#A59B86) and terraces; fracture faces
    # paler still (brief: L* 72 raw face); its carved groove and hour-band hold chalk inlay like the deck's script
    "needle": dict(stops=[(0.0, "#2A2D33"), (0.25, "#474B52"), (0.5, "#6A6E72"), (0.75, "#90938F"), (1.0, "#B2B2AA")],
                   chalk="#D3D0C2", groove="#CFC8B4", broken="#BDB7A8", moss="#55663F", moss_hi="#7D8A52", band=0.84,
                   facet=0.05, ao=0.62, rim=0.25),
    # FRAY basalt: the one dark stone, chalk lips
    "basalt": dict(stops=[(0.0, "#1A1B1F"), (0.25, "#2A2B30"), (0.5, "#3A3B40"), (0.75, "#4C4D52"), (1.0, "#5F5F62")],
                   chalk="#8E897C", groove="#A49E8E", broken="#3D3E42", moss="#3F4D35", moss_hi="#5E6B45"),
}


def _bm_block(sp: StoneSpec, rng) -> tuple[bmesh.types.BMesh, float]:
    """→ (bmesh, height of the drum axis above the ground; 0 for blocks)."""
    bm = bmesh.new()
    axis_z = 0.0
    sx, sy, sz = sp.size
    if sp.shape == "drum":
        # an annular sector of the shaft (axis along y here; the piece lies on its side)
        r_out, r_in, ang = sx * 0.5, sx * 0.5 * 0.35, math.radians(110)
        seg = 7
        pts = [(r_out * math.cos(-ang / 2 + ang * i / seg), r_out * math.sin(-ang / 2 + ang * i / seg)) for i in range(seg + 1)]
        pts += [(r_in * math.cos(ang / 2), r_in * math.sin(ang / 2)), (r_in * math.cos(-ang / 2), r_in * math.sin(-ang / 2))]
        vs = [bm.verts.new((x, -sy / 2, z)) for x, z in pts]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
            v.co.y += sy
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        # lay it on one radial cut face, the curved outside arching over the top
        a = ang / 2
        for v in bm.verts:
            x, y, z = v.co
            v.co = Vector((x * math.cos(a) - z * math.sin(a), y, x * math.sin(a) + z * math.cos(a)))
        zmin = min(v.co.z for v in bm.verts)
        for v in bm.verts:
            v.co.z -= zmin
        axis_z = -zmin
    elif sp.shape == "hull":
        # a weathered lump: points on a rounded box (superellipsoid), each pushed in or out a little, wrapped
        # in their convex hull — big irregular planes, no box left in the silhouette
        n = 26 if sx < 1.6 * max(sy, 1e-3) else 34
        ga = math.pi * (3 - math.sqrt(5))
        pts = []
        for i in range(n):
            z = 1 - 2 * (i + 0.5) / n
            r = math.sqrt(max(0.0, 1 - z * z))
            a = i * ga + rng.uniform(-0.3, 0.3)
            d = np.array([r * math.cos(a), r * math.sin(a), z])
            q = np.sign(d) * np.abs(d) ** (2.0 / 2.8)              # rounded box
            q *= 1 + rng.uniform(-0.16, 0.06)
            pts.append((q[0] * sx / 2, q[1] * sy / 2, (max(q[2], -0.55) * 0.5 / 1.0 + 0.5) * sz / 0.75))
        vs = [bm.verts.new(p) for p in pts]
        bmesh.ops.convex_hull(bm, input=vs)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        zmin = min(v.co.z for v in bm.verts)
        for v in bm.verts:
            v.co.z -= zmin
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    else:
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * sx, v.co.y * sy, (v.co.z + 0.5) * sz))
    return bm, axis_z


def _cut(bm, co, no):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)


def _split(bm, co, no):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)


def stone_mesh(sp: StoneSpec) -> Part:
    """→ a flat-faceted Part (attrs flag, facet, kind=5)."""
    rng = np.random.default_rng(sp.seed)
    bm, axis_z = _bm_block(sp, rng)
    flag = bm.faces.layers.int.new("flag")
    if sp.taper > 0 and sp.shape == "block":
        zt = max(v.co.z for v in bm.verts)
        for v in bm.verts:
            f = 1.0 - sp.taper * (v.co.z / zt) ** 1.5
            v.co.x *= f
            v.co.y *= f
    ctr = Vector(np.mean([tuple(v.co) for v in bm.verts], 0))
    span = min(sp.size)

    def extent(n):
        return max((v.co - ctr).dot(n) for v in bm.verts)

    for k in range(sp.chips):                            # corner and edge chips, mostly on the top
        az = rng.uniform(0, 2 * math.pi)
        el = rng.uniform(0.25, 1.0) if rng.uniform() < 0.8 else rng.uniform(-0.5, -0.1)
        n = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))).normalized()
        d = rng.uniform(0.10, 0.28) * span
        _cut(bm, ctr + n * (extent(n) - d), n)
    if sp.broken:                                        # a jagged broken end (+x)
        for k in range(3):
            az = rng.uniform(-0.7, 0.7)
            el = rng.uniform(-0.6, 0.6)
            n = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))).normalized()
            d = rng.uniform(0.10, 0.22) * sp.size[0] * (1.0 if k == 0 else 0.6)
            _cut(bm, ctr + n * (extent(n) - d), n)
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            if f.normal.x > 0.35 and (f.calc_center_median() - ctr).x > sp.size[0] * 0.15:
                f[flag] |= FLAG_BREAK
    bm.normal_update()
    # chamfer every hard edge
    hard = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(28)]
    if sp.bevel > 0 and hard:
        res = bmesh.ops.bevel(bm, geom=hard, offset=sp.bevel, offset_type="OFFSET", segments=sp.seg,
                              profile=0.5 if sp.seg == 1 else 0.62,
                              affect="EDGES", clamp_overlap=True)
        for f in res["faces"]:
            f[flag] = FLAG_CHAMFER
        bm.normal_update()
    # bands / grooves as loop cuts, then recess them (crisp: engraved after the chamfer)
    if sp.groove > 0 and sp.shape != "hull":
        top = max(v.co.z for v in bm.verts)
        for s in (-1, 1):
            _split(bm, Vector((0, s * sp.groove / 2, 0)), Vector((0, 1, 0)))
        _split(bm, Vector((-sp.size[0] * 0.30, 0, 0)), Vector((1, 0, 0)))
        _split(bm, Vector((sp.size[0] * 0.22, 0, 0)), Vector((1, 0, 0)))
        bm.normal_update()
        faces = [f for f in bm.faces if f.normal.z > 0.9 and abs(f.calc_center_median().y) < sp.groove / 2
                 and -sp.size[0] * 0.30 < f.calc_center_median().x < sp.size[0] * 0.22 and f.calc_center_median().z > top - 0.08]
        if faces:
            ext = bmesh.ops.extrude_face_region(bm, geom=faces)
            bmesh.ops.delete(bm, geom=faces, context="FACES_ONLY")   # the region's old cap would lid the groove
            nv = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
            for v in nv:
                v.co.z -= sp.groove * 0.14                # a shallow engraved tick, chalk-filled (not a dark slot)
            for f in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMFace)]:
                f[flag] |= FLAG_GROOVE
            bm.normal_update()
            for f in bm.faces:                           # the groove walls
                c = f.calc_center_median()
                if abs(f.normal.z) < 0.3 and abs(c.y) <= sp.groove / 2 + 1e-4 and c.z > top - sp.groove * 0.4 - 0.01 \
                        and -sp.size[0] * 0.30 - 1e-3 < c.x < sp.size[0] * 0.22 + 1e-3:
                    f[flag] |= FLAG_GROOVE
    if sp.band and sp.shape == "drum":
        w = sp.size[1] * 0.16
        yc = sp.size[1] * 0.12
        r_out = sp.size[0] * 0.5
        for s_ in (-1, 1):
            _split(bm, Vector((0, yc + s_ * w / 2, 0)), Vector((0, 1, 0)))
        bm.normal_update()

        def rad(p):
            return math.hypot(p.x, p.z - axis_z)
        faces = [f for f in bm.faces if abs(f.calc_center_median().y - yc) < w / 2 and rad(f.calc_center_median()) > 0.82 * r_out
                 and abs(f.normal.y) < 0.3]
        if faces:
            ext = bmesh.ops.extrude_face_region(bm, geom=faces)
            bmesh.ops.delete(bm, geom=faces, context="FACES_ONLY")
            for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
                d = Vector((v.co.x, 0.0, v.co.z - axis_z))
                if d.length > 1e-6:
                    v.co -= d.normalized() * 0.028
            for f in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMFace)]:
                f[flag] = FLAG_BAND
            bm.normal_update()
            for f in bm.faces:
                c = f.calc_center_median()
                if abs(f.normal.y) > 0.7 and abs(abs(c.y - yc) - w / 2) < 1e-3 and rad(c) > 0.8 * r_out:
                    f[flag] = FLAG_BAND
    # a worn crown: the top faces poked and their centres raised (the weather rounds a carved lid)
    if sp.dome > 0:
        tops = [f for f in bm.faces if not (f[flag] & (FLAG_CHAMFER | FLAG_GROOVE | FLAG_BAND)) and f.normal.z > 0.75
                and f.calc_area() > (0.12 * span) ** 2]
        if tops:
            res = bmesh.ops.poke(bm, faces=tops)
            for v in res["verts"]:
                v.co.z += sp.dome * rng.uniform(0.7, 1.15)
            bm.normal_update()
    # chisel texture: poke the big planes and nudge each new centre in or out, so every face breaks into a
    # few hand-cut micro-planes the painter can mottle (chamfers, grooves and bands stay crisp)
    if sp.detail > 0:
        keep = FLAG_CHAMFER | FLAG_GROOVE | FLAG_BAND
        for lvl, amin in enumerate(((0.16 * span) ** 2, (0.22 * span) ** 2)):
            big = [f for f in bm.faces if not (f[flag] & keep) and f.calc_area() > amin]
            if not big:
                break
            res = bmesh.ops.poke(bm, faces=big)
            for v in res["verts"]:
                v.co += v.normal * rng.uniform(-0.6, 1.0) * sp.detail * (1.0 if lvl == 0 else 0.6)
            bm.normal_update()
    # settle: tilt, sink, yaw, offset
    ax, ay = sp.tilt
    for v in bm.verts:
        x, y, z = v.co
        y, z = y * math.cos(ax) - z * math.sin(ax), y * math.sin(ax) + z * math.cos(ax)
        x, z = x * math.cos(ay) + z * math.sin(ay), -x * math.sin(ay) + z * math.cos(ay)
        v.co = Vector((x, y, z))
    zmin = min(v.co.z for v in bm.verts)
    cy, sy_ = math.cos(sp.yaw), math.sin(sp.yaw)
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x * cy - y * sy_ + sp.offset[0], x * sy_ + y * cy + sp.offset[1], z - zmin - sp.sink + sp.offset[2]))
    bm.normal_update()
    fid = bm.faces.layers.int.new("fid")
    for i, f in enumerate(bm.faces):
        f[fid] = i
    normals = {i: tuple(f.normal) for i, f in enumerate(bm.faces)}
    # soft bevels: a chamfer corner takes the area-weighted normal of every face round its vertex, so the edge
    # rolls from one plane's light to the other's (the big planes stay flat: chiselled, never blobby)
    corner_n = {}
    if sp.soft > 0 and sp.shape == "hull":
        # a sculpted lump: each corner smooths over the faces round it that turn less than SMOOTH_DEG from its own
        # face (the planes melt into each other; a sharp break or a carved groove stays a crisp line)
        cmax = math.cos(math.radians(SMOOTH_DEG))
        for f in bm.faces:
            if f[flag] & (FLAG_GROOVE | FLAG_BAND):
                continue
            for v in f.verts:
                acc = Vector((0.0, 0.0, 0.0))
                for g in v.link_faces:
                    if g[flag] & (FLAG_GROOVE | FLAG_BAND) or g.normal.dot(f.normal) < cmax:
                        continue
                    acc += g.normal * g.calc_area()
                if acc.length > 1e-9:
                    acc.normalize()
                    corner_n[(f[fid], v.index)] = tuple((acc * sp.soft + f.normal * (1 - sp.soft)).normalized())
    elif sp.soft > 0:
        for f in bm.faces:
            if not (f[flag] & FLAG_CHAMFER):
                continue
            for v in f.verts:
                acc = Vector((0.0, 0.0, 0.0))
                for g in v.link_faces:
                    acc += g.normal * g.calc_area()
                if acc.length > 1e-9:
                    acc.normalize()
                    n = (acc * sp.soft + f.normal * (1 - sp.soft)).normalized()
                    corner_n[(f[fid], v.index)] = tuple(n)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    keys, P, N, Fl, Fi, F = {}, [], [], [], [], []
    for f in bm.faces:
        tri = []
        for v in f.verts:
            k = (f[fid], v.index)
            if k not in keys:
                keys[k] = len(P)
                P.append(tuple(v.co)); N.append(corner_n.get(k, normals[f[fid]])); Fl.append(f[flag]); Fi.append(f[fid])
            tri.append(keys[k])
        F.append(tri)
    bm.free()
    part = Part(np.asarray(P), np.asarray(F), np.asarray(N), flag=np.asarray(Fl, float), facet=np.asarray(Fi, float), kind=5)
    return part


def moss_cushion(rock: Part, occ_rock: Occluder, x: float, y: float, r: float, rng, thick: float = 0.03) -> Part | None:
    """A soft, lumpy cushion draped over the rock top around (x, y): a centre and three rings with an irregular
    lobed outline; the rim tucks into the stone. Rays from above find the surface."""
    from mathutils import Vector as V
    n_out = 18
    ang = np.linspace(0, 2 * math.pi, n_out, endpoint=False) + rng.uniform(0, 1)
    ph1, ph2 = rng.uniform(0, 6.3, 2)
    rr = r * (1.0 + 0.22 * np.sin(3 * ang + ph1) + 0.12 * np.sin(5 * ang + ph2) + rng.uniform(-0.08, 0.08, n_out))
    top = rock.P[:, 2].max() + 1.0

    def drop(px, py):
        loc, nrm, *_ = occ_rock.bvh.ray_cast(V((px, py, top)), V((0, 0, -1)), 10.0)
        return None if loc is None else (loc.z, nrm.z)

    hit0 = drop(x, y)
    if hit0 is None or hit0[1] < 0.3:
        return None
    out, ring_id = [(x, y, hit0[0] + thick)], [0]
    fr = ((0.38, 1, 0.85), (0.72, 2, 0.55), (1.0, 3, -0.25))
    for k, a in enumerate(ang):
        for f, rid, hz in fr:
            ff = f
            while ff > 0.08:
                px, py = x + math.cos(a) * rr[k] * ff, y + math.sin(a) * rr[k] * ff
                hit = drop(px, py)
                if hit is not None and hit[1] > 0.15:
                    break
                ff *= 0.8
            else:
                px, py, hit = x, y, hit0
            lump = 1.0 + (0.35 * hash01(k * 1.7 + rid, x * 9.1) - 0.15 if rid < 3 else 0.0)
            z = hit[0] + thick * hz * lump if rid < 3 else hit[0] + 0.004
            out.append((px, py, z)); ring_id.append(rid)
    P = np.asarray(out)
    F = []
    R = len(fr)
    for k in range(n_out):
        k1 = (k + 1) % n_out
        F.append([0, 1 + R * k, 1 + R * k1])
        for j in range(R - 1):
            a1, b1 = 1 + R * k + j, 1 + R * k1 + j
            a2, b2 = a1 + 1, b1 + 1
            F.append([a1, a2, b2]); F.append([a1, b2, b1])
    F = np.asarray(F)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    flip = fn[:, 2] < 0
    F[flip] = F[flip][:, [0, 2, 1]]
    return Part(P, F, None, ring=np.asarray(ring_id, float), kind=6)


def inlay_strip(occ_rock: Occluder, sp: StoneSpec, top: float) -> Part | None:
    """The hour-tick's carved line on a weathered lump: a thin chalk strip laid along the piece's long axis
    (−0.30 … +0.22 of its length, like the dial's ticks), each point dropped onto the stone from above and
    lifted 3 mm. Single-sided, facing up; kind 7 (painted as the groove's chalk inlay)."""
    from mathutils import Vector as V
    ax = np.array([math.cos(sp.yaw), math.sin(sp.yaw)])
    sd = np.array([-ax[1], ax[0]])
    o = np.array(sp.offset[:2])
    xs = np.linspace(-0.30, 0.22, 9) * sp.size[0]
    rows = []
    for x in xs:
        row = []
        for s_ in (-1, 1):
            q = o + ax * x + sd * s_ * sp.groove * 0.5
            loc, nrm, *_ = occ_rock.bvh.ray_cast(V((q[0], q[1], top + 1.0)), V((0, 0, -1)), 10.0)
            if loc is None or nrm.z < 0.7:
                row = None
                break
            row.append((loc.x, loc.y, loc.z + 0.003))
        rows.append(row)
    # the longest run of rows that all landed on the stone's top
    best, cur = [], []
    for row in rows:
        cur = cur + [row] if row is not None else []
        if len(cur) > len(best):
            best = cur
    if len(best) < 3:
        return None
    P = np.array([p for row in best for p in row])
    # a carved line is straight: lay it on the plane through its hits, never below the stone
    A_ = np.column_stack([P[:, 0], P[:, 1], np.ones(len(P))])
    coef, *_ = np.linalg.lstsq(A_, P[:, 2], rcond=None)
    P[:, 2] = np.maximum(A_ @ coef + 0.003, P[:, 2])
    F = []
    for i in range(len(best) - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
        F += [[a, c, b], [b, c, d]]
    P = np.asarray(P); F = np.asarray(F)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    F[fn[:, 2] < 0] = F[fn[:, 2] < 0][:, [0, 2, 1]]
    return Part(P, F, None, kind=7, flag=float(FLAG_GROOVE))


def build_stone(sp: StoneSpec) -> Part:
    pieces = [stone_mesh(sp)] + [stone_mesh(e) for e in sp.extra]
    rock = merge(pieces)
    rng = np.random.default_rng(sp.seed + 1)
    occ = Occluder(rock.P, rock.F, ground=False)
    cushions = []
    for (x, y, r) in sp.moss + [m for e in sp.extra for m in e.moss]:
        c = moss_cushion(rock, occ, x, y, r, rng)
        if c is not None:
            cushions.append(c)
    if sp.shape == "hull" and sp.groove > 0:
        strip = inlay_strip(occ, sp, float(rock.P[:, 2].max()))
        if strip is not None:
            cushions.append(strip)
    return merge([rock] + cushions)


def paint_stone(st: Part, palette: str, seed: int) -> np.ndarray:
    pal = PALETTES[palette]
    P, N, A = st.P, st.N, st.A
    occ = Occluder(P, st.F, ground=True)
    span = max(np.ptp(P[:, 0]), np.ptp(P[:, 1]), 0.2)
    ao = occ.ao(P, N, rays=20, dist=0.6 * span)
    sky = occ.sky(P, N, rays=14, cone_deg=60.0, dist=6.0)
    kind = A["kind"]
    flag = A.get("flag", np.zeros(len(P))).astype(int)
    facet = A.get("facet", np.zeros(len(P)))
    up = N[:, 2]
    z = P[:, 2]
    zr = smooth(-0.02, 0.45 * max(z.max(), 0.1), z)
    # each chisel facet its own value, but only a nudge (r12 M11: a facet must never read as a flat grey tile —
    # the light rolls over the stone from its lit top to its shaded foot, the edges catch it, the creases keep it)
    fj = hash01(facet + seed * 13.0, facet * 0.37)
    fw = pal.get("facet", 0.09)
    v = 0.18 + 0.38 * sky + 0.22 * smooth(-0.4, 0.95, up) + fw * (fj - 0.5) + 0.06 * fbm3(P, 5.0, 2, seed)
    ak = pal.get("ao", 0.55)
    v *= (1 - ak) + ak * ao
    v *= 0.62 + 0.38 * zr                                         # contact darkening at the foot
    v += 0.10 * (fbm3(P, 7.0 / span, 3, seed + 2) - 0.5)                 # weathering mottle
    v = posterize(np.clip(v, 0, 1), 5, keep=pal.get("keep", 0.65))
    c = ramp(v, pal["stops"])
    # lit planes lean warm, turned-away planes cool (rotation-invariant: up-facing only), like a painted stone
    wk = pal.get("warm", 0.0)
    if wk:
        c = c * (1 + wk * (smooth(-0.3, 0.9, up) - 0.45)[:, None] * np.array([1.0, 0.35, -0.9]))
    # painted edge light on the convex silhouette (r12 M11): every corner where this facet's normal turns from
    # its neighbours' (the welded normal) takes chalk where the light falls — a brushed rim, never a drawn line
    rim_k = pal.get("rim", 0.0)
    if rim_k:
        key = np.round(P / 1e-4).astype(np.int64)
        _, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        acc = np.zeros((inv.max() + 1, 3))
        np.add.at(acc, inv, N)
        nw = acc[inv] / np.maximum(np.linalg.norm(acc[inv], axis=1, keepdims=True), 1e-9)
        turn = 1.0 - np.einsum("ij,ij->i", nw, N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9))
        edge = smooth(0.02, 0.22, turn) * smooth(-0.1, 0.7, nw[:, 2]) * smooth(0.2, 0.7, sky) * (kind == 5)
        c = c + (hexc(pal["chalk"]) - c) * (rim_k * edge)[:, None]
    lit = smooth(0.15, 0.6, sky) * smooth(0.3, 0.8, ao)
    brk = (flag & FLAG_BREAK) > 0
    c = np.where(brk[:, None], c * 0.55 + hexc(pal["broken"]) * 0.45 * (0.5 + 0.5 * lit[:, None]), c)
    ch = (flag & FLAG_CHAMFER) > 0
    chalk = hexc(pal["chalk"])
    k = 0.42 * lit * smooth(-0.2, 0.6, up) + 0.08                # a worn, lit edge, not a drawn line
    c = np.where(ch[:, None], c + (chalk - c) * k[:, None], c)
    gr = (flag & FLAG_GROOVE) > 0
    c = np.where(gr[:, None], hexc(pal["groove"]) * (0.7 + 0.3 * ao[:, None]), c)
    bd = (flag & FLAG_BAND) > 0
    c = np.where(bd[:, None], c * pal.get("band", 0.72), c)
    moss = kind == 6
    if moss.any():
        ring = A.get("ring", np.zeros(len(P)))
        mv = 0.25 + 0.5 * sky + 0.12 * (ring <= 1) + 0.2 * (fbm3(P, 9.0 / span, 2, seed + 9) - 0.5)
        mv *= 0.55 + 0.45 * ao
        mv = np.clip(mv, 0, 1)
        mc = hexc(pal["moss"]) * (1 - mv[:, None]) + hexc(pal["moss_hi"]) * mv[:, None]
        # the cushion's rim feathers into the stone under it (no sticker edge)
        under = ramp(np.clip(0.3 + 0.4 * sky, 0, 1), pal["stops"])
        fe = np.where(ring == 3, 1.0, np.where(ring == 2, 0.35, 0.0))[:, None]
        mc = mc * (1 - fe) + under * fe
        c[moss] = mc[moss]
    # moss creeping into the stone's upward facets near cushions and in sheltered tops
    if palette == "dial":
        creep = (kind == 5) * smooth(0.5, 0.9, up) * smooth(0.46, 0.64, fbm3(P, 3.2 / span, 3, seed + 5)) * (~ch) * (~gr)
        c = c * (1 - 0.5 * creep[:, None]) + hexc(pal["moss"]) * (0.5 * creep[:, None])
    return np.clip(c, 0, 1)
