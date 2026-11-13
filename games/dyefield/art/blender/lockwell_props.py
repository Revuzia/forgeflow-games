"""DYEFIELD — LOCKWELL WORKS props, trims and shell (helper module for map_lockwell.py).

Every builder here returns WORLD-space geometry (Blender coords, Z-up) as common.Geo buckets, from
brush data in runtime/glTF coordinates (Y-up). Nothing here touches bpy scene state except the
text helper borrowed from deco_assets (HARBOR CUP / TIDE CO. only). Deterministic: every jitter
comes from common.rng(seed parts).

Helpers named g* take glTF (x, y, z) triples:
    gbox(bm, mn, mx)            axis-aligned box from glTF min/max
    gobox(bm, c, size, yaw)     oriented box (size = glTF x, y, z extents), yaw about +Y
    gtube(bm, pts, r)           tube along glTF points
"""
from __future__ import annotations

import math

import bmesh
from mathutils import Matrix, Vector

import common as C
import deco_assets as D
from common import Geo

# ── tiny glTF-space primitives ───────────────────────────────────────────────────────────────────


def gbox(bm, mn, mx, mi=0):
    return C.bm_box(bm, (mn[0], -mx[2], mn[1]), (mx[0], -mn[2], mx[1]), mi)


def gobox(bm, c, size, yaw_deg=0.0, pitch_axis=None, pitch_deg=0.0, mi=0):
    """Oriented box centred at glTF c, extents (sx, sy, sz) along glTF x, y, z, then rotated by
    yaw about +Y (glTF) — i.e. about Blender +Z."""
    rot = Matrix.Rotation(math.radians(yaw_deg), 3, "Z")
    if pitch_axis:
        rot = rot @ Matrix.Rotation(math.radians(pitch_deg), 3, pitch_axis)
    # glTF (sx, sy, sz) -> Blender extents (sx, sz, sy)
    return C.bm_oriented_box(bm, C.g2b(*c), (size[0], size[2], size[1]), rot, mi)


def gtube(bm, pts, r, seg=6, cap=True):
    return C.bm_tube(bm, [C.g2b(*p) for p in pts], r, seg=seg, cap=cap)


def seg_box(bm, a, b, w, h):
    """A straight bar of cross-section w (horizontal) x h (vertical) from glTF a to glTF b
    (arbitrary slope) — an oriented box whose long axis follows a->b and whose 'up' stays vertical."""
    A, B = C.g2b(*a), C.g2b(*b)
    d = B - A
    L = d.length
    if L < 1e-6:
        return []
    t = d / L
    up = Vector((0, 0, 1))
    side = t.cross(up)
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    upn = side.cross(t).normalized()
    m = Matrix((side, t, upn)).transposed()      # columns: local x = side, local y = along, local z = up
    return C.bm_oriented_box(bm, (A + B) / 2, (w, L, h), m)


def geo_of(name, parts):
    """parts: [(bm, mat_name)] or [(bm, mat_name, matrix)] -> Geo (frees the bmeshes)."""
    g = Geo(name)
    for part in parts:
        bm, mat = part[0], part[1]
        m = part[2] if len(part) > 2 else None
        if bm.faces:
            g.add_bm(bm, mat, matrix=m)
        bm.free()
    return g


def xcyl(r, x0, x1, seg=16):
    """Cylinder along Blender/glTF X from x0 to x1, centred on the origin's Y/Z (bmesh)."""
    bm = bmesh.new()
    C.bm_cylinder(bm, r, r, x0, x1, seg=seg)
    C.bm_transform(bm, Matrix.Rotation(math.radians(90), 4, "Y"))
    # bm_cylinder runs along +Z; rotating +90 about Y maps +Z -> +X
    return bm


# ── pallet (solid, non-paintable) ────────────────────────────────────────────────────────────────
def pallet(seed: str) -> Geo:
    """1.2 m x 1.0 m x 0.14 m wooden pallet in the asset-local frame (origin at the base centre,
    long side along local X). Top deck = 5 boards, 3 stringer blocks rows, 3 bottom boards."""
    rnd = C.rng("pallet", seed)
    wood = bmesh.new()
    dark = bmesh.new()
    W, Dp, H = 1.2, 1.0, 0.14
    for k in range(5):                                   # top boards along X
        y = -Dp / 2 + 0.07 + k * (Dp - 0.14) / 4
        dz = rnd.uniform(-0.004, 0.004)
        C.bm_box(wood, (-W / 2, y - 0.07, H - 0.022 + dz), (W / 2, y + 0.07, H + dz))
    for x in (-W / 2 + 0.05, 0.0, W / 2 - 0.05):         # stringer blocks
        for y in (-Dp / 2 + 0.06, 0.0, Dp / 2 - 0.06):
            C.bm_box(dark, (x - 0.05, y - 0.06, 0.022), (x + 0.05, y + 0.06, H - 0.022))
    for y in (-Dp / 2 + 0.06, 0.0, Dp / 2 - 0.06):       # bottom boards along X
        C.bm_box(wood, (-W / 2, y - 0.06, 0.0), (W / 2, y + 0.06, 0.022))
    return geo_of("pallet", [(wood, "M_crate"), (dark, "M_boardwalk")])


# ── railings (solid) ─────────────────────────────────────────────────────────────────────────────
RAIL_H = 1.05


def railing(points, height=RAIL_H, post_step=1.6) -> Geo:
    """Handrail along a glTF polyline at deck height: square posts, a top rail and a knee rail
    (painted teal-blue steel, M_crane; the hazard yellow is kept for edges and stringers)."""
    bm = bmesh.new()
    for i in range(len(points) - 1):
        a, b = Vector(points[i]), Vector(points[i + 1])
        d = b - a
        L = math.hypot(d.x, d.z)
        n = max(1, math.ceil(L / post_step))
        for k in range(n + 1):
            if i > 0 and k == 0:
                continue                                  # shared corner post
            p = a + d * (k / n)
            gbox(bm, (p.x - 0.035, p.y, p.z - 0.035), (p.x + 0.035, p.y + height, p.z + 0.035))
        for hh, w in ((height, 0.07), (height * 0.52, 0.045)):
            A = (a.x, a.y + hh - w / 2, a.z)
            B = (b.x, b.y + hh - w / 2, b.z)
            seg_box(bm, A, B, w, w)
    return geo_of("rail", [(bm, "M_crane")])


def stair_rail_points(b, side: str):
    """Handrail base polyline for a stairs brush along its `side` edge ('-x', '+x', '-z', '+z' in
    WORLD frame): from the foot of the first riser to the top landing edge, following the nosings."""
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    rise = b["rise"]
    inset = 0.06
    if rise[1] == "x":
        zz = z0 + inset if side == "-z" else z1 - inset
        lo, hi = (x0, x1) if rise[0] == "+" else (x1, x0)
        n = int(b.get("steps"))
        d = (hi - lo) / n
        return [[lo, y0 + (y1 - y0) / n, zz], [hi - d, y1, zz], [hi, y1, zz]]
    xx = x0 + inset if side == "-x" else x1 - inset
    lo, hi = (z0, z1) if rise[0] == "+" else (z1, z0)
    n = int(b.get("steps"))
    d = (hi - lo) / n
    return [[xx, y0 + (y1 - y0) / n, lo], [xx, y1, hi - d], [xx, y1, hi]]


# ── columns (solid) ──────────────────────────────────────────────────────────────────────────────
def column(pos, height, size=0.5) -> Geo:
    """Steel I-beam column (M_metal) with a base plate, a cap plate and a hazard-striped guard wrap
    (0 - 1.2 m) around its foot."""
    x, y, z = pos
    s = size / 2
    st = bmesh.new()
    gbox(st, (x - s, y + 0.0, z - s), (x + s, y + 0.04, z + s))               # base plate
    gbox(st, (x - s, y + height - 0.04, z - s), (x + s, y + height, z + s))  # cap plate
    gbox(st, (x - s, y, z - s), (x + s, y + height, z - s + 0.06))           # flanges
    gbox(st, (x - s, y, z + s - 0.06), (x + s, y + height, z + s))
    gbox(st, (x - 0.04, y, z - s + 0.06), (x + 0.04, y + height, z + s - 0.06))  # web
    hz = bmesh.new()
    gbox(hz, (x - s - 0.04, y, z - s - 0.04), (x + s + 0.04, y + 1.2, z + s + 0.04))
    return geo_of("column", [(st, "M_metal"), (hz, "M_hazard")])


# ── loading-dock canopy ──────────────────────────────────────────────────────────────────────────
def canopy(b) -> dict:
    """Flat steel awning over the spawn dock: roof slab (solid, M_steel), team-coloured fascia on
    its open edges, two posts (b['points'], glTF feet) and wall brackets. -> {'solid', 'deco'}."""
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    team = b["team"]
    toward = 1.0 if (z0 + z1) < 0 else -1.0          # the open (hall) side is toward mid
    zo = z1 if toward > 0 else z0
    zw = z0 if toward > 0 else z1                     # the wall side
    roof = bmesh.new()
    gbox(roof, (x0, y0, z0), (x1, y1, z1))
    fas = bmesh.new()
    gbox(fas, (x0 - 0.05, y0 - 0.35, zo - 0.05 * toward if toward > 0 else zo - 0.05),
         (x1 + 0.05, y1 + 0.06, zo + 0.05 if toward > 0 else zo + 0.05))
    for xs in (x0, x1):
        gbox(fas, (xs - 0.05, y0 - 0.35, min(zw, zo)), (xs + 0.05, y1 + 0.06, max(zw, zo)))
    posts = bmesh.new()
    for p in b.get("points", []):
        gbox(posts, (p[0] - 0.13, p[1], p[2] - 0.13), (p[0] + 0.13, y0, p[2] + 0.13))
    brk = bmesh.new()
    for xs in (x0 + 1.0, (x0 + x1) / 2, x1 - 1.0):
        seg_box(brk, (xs, y0 - 1.6, zw), (xs, y0, zw + 2.2 * toward), 0.12, 0.12)
    # loading-bay valance on the open edge: hangs VALANCE m below the canopy (blocks the crane-nest
    # sightline to the spawn pad; runners pass under it), team colour, crew mark, hazard hem
    vh = b.get("valance", 2.2)
    val = bmesh.new()
    za, zb = sorted((zo, zo - 0.14 * toward))
    gbox(val, (x0, y0 - vh, za), (x1, y0, zb))
    hem = bmesh.new()
    zh_a, zh_b = sorted((zo + 0.02 * toward, zo - 0.16 * toward))
    gbox(hem, (x0 - 0.02, y0 - vh - 0.02, zh_a), (x1 + 0.02, y0 - vh + 0.3, zh_b))
    mark = bmesh.new()
    zm = zo + 0.012 * toward                       # just proud of the valance's hall-facing face
    cy = y0 - (vh - 0.3) / 2
    R = (vh - 0.3) * 0.36
    seg = 40
    if team == "A":                               # sun-disc: ring + centre dot
        for (r0, r1) in ((R * 0.72, R), (0.0, R * 0.34)):
            for k in range(seg):
                a0, a1 = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
                q = [(r0 * math.cos(a0), r0 * math.sin(a0)), (r1 * math.cos(a0), r1 * math.sin(a0)),
                     (r1 * math.cos(a1), r1 * math.sin(a1)), (r0 * math.cos(a1), r0 * math.sin(a1))]
                vs = [mark.verts.new(C.g2b(u, cy + v, zm)) for (u, v) in q]
                if r0 < 1e-6:
                    vs = [vs[0], vs[1], vs[2]]
                mark.faces.new(vs)
    else:                                         # wave-peak: a filled triangle, apex up
        tri = [(-R * 1.05, -R * 0.8), (R * 1.05, -R * 0.8), (0.0, R * 1.0)]
        mark.faces.new([mark.verts.new(C.g2b(u, cy + v, zm)) for (u, v) in tri])
    bmesh.ops.remove_doubles(mark, verts=mark.verts, dist=1e-6)
    for f in mark.faces:                          # face the hall
        n = f.normal
        if (n.y * -1.0) * toward < 0:            # Blender -Y = glTF +Z
            f.normal_flip()
    solid = geo_of("canopy", [(roof, "M_steel"), (fas, f"M_pad_{team}"), (posts, "M_metal"),
                              (val, f"M_pad_{team}"), (hem, "M_hazard")])
    deco = geo_of("canopy_brk", [(brk, "M_metal"), (mark, "M_billboard")])
    return {"solid": solid, "deco": deco}


# ── press frame (on top of the paintable housing) ────────────────────────────────────────────────
def press_frame(b) -> dict:
    """Guide columns, crown and ram above a press housing (solid, not paintable), plus hydraulic
    cylinders, a flywheel and a control box (deco). -> {'solid', 'deco'}."""
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    top = y1
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    outer = -1.0 if cx < 0 else 1.0                   # the side-lane side of this press (x)
    cols = bmesh.new()
    for (px, pz) in ((x0 + 0.45, z0 + 0.45), (x1 - 0.45, z0 + 0.45), (x0 + 0.45, z1 - 0.45), (x1 - 0.45, z1 - 0.45)):
        gbox(cols, (px - 0.2, top, pz - 0.2), (px + 0.2, top + 3.5, pz + 0.2))
    crown = bmesh.new()
    gbox(crown, (x0 + 0.1, top + 2.8, z0 + 0.1), (x1 - 0.1, top + 3.5, z1 - 0.1))
    gbox(crown, (x0 + 0.02, top + 3.18, z0 + 0.02), (x1 - 0.02, top + 3.32, z1 - 0.02))  # crown band
    ram = bmesh.new()
    gbox(ram, (x0 + 0.75, top + 1.85, z0 + 0.75), (x1 - 0.75, top + 2.55, z1 - 0.75))
    hz = bmesh.new()
    gbox(hz, (x0 + 0.72, top + 1.72, z0 + 0.72), (x1 - 0.72, top + 1.88, z1 - 0.72))
    solid = geo_of("press_frame", [(cols, "M_metal"), (crown, "M_press"), (ram, "M_steel"), (hz, "M_hazard")])
    # deco: hydraulic rods crown -> ram, cylinders above the crown, flywheel on the outer side
    rods = bmesh.new()
    for pz in (cz - 1.4, cz + 1.4):
        C.bm_cylinder(rods, 0.12, 0.12, top + 2.55, top + 2.8, seg=12, center=(cx, -pz))
        C.bm_cylinder(rods, 0.3, 0.3, top + 3.5, top + 4.3, seg=16, center=(cx, -pz))
        C.bm_cylinder(rods, 0.34, 0.34, top + 4.3, top + 4.42, seg=16, center=(cx, -pz))
    fx = (x0 - 0.18) if outer < 0 else (x1 + 0.18)
    fy = top + 3.15
    rim = xcyl(1.15, -0.14, 0.14, seg=28)
    C.bm_transform(rim, Matrix.Translation(C.g2b(fx, fy, cz)))
    hub = xcyl(0.35, -0.22, 0.22, seg=16)
    C.bm_transform(hub, Matrix.Translation(C.g2b(fx, fy, cz)))
    spokes = bmesh.new()
    for k in range(6):
        a = k * math.pi / 3
        pa = (fx, fy + 0.3 * math.sin(a), cz + 0.3 * math.cos(a))
        pb = (fx, fy + 1.05 * math.sin(a), cz + 1.05 * math.cos(a))
        seg_box(spokes, pa, pb, 0.1, 0.12)
    box = bmesh.new()
    bx = (x1 + 0.08) if outer < 0 else (x0 - 0.08)
    gbox(box, (min(bx, bx - 0.3 * -outer), 1.2, cz - 0.6), (max(bx, bx - 0.3 * -outer), 2.2, cz + 0.6))
    lamp = bmesh.new()
    lx = bx - 0.16 * outer
    for k, dz in enumerate((-0.35, 0.0, 0.35)):
        gbox(lamp, (lx - 0.03, 1.95, cz + dz - 0.06), (lx + 0.03, 2.07, cz + dz + 0.06))
    deco = geo_of("press_deco", [(rods, "M_glass"), (rim, "M_paint_trim"), (hub, "M_metal"), (spokes, "M_paint_trim"),
                                 (box, "M_office"), (lamp, "M_lamp")])
    return {"solid": solid, "deco": deco}


# ── conveyor trims ───────────────────────────────────────────────────────────────────────────────
def conveyor_trim(b) -> dict:
    """Low skirt boards along both belt edges (solid, 0.14 m: autostep clears them), a tail drum at
    the foot, a drive motor under the head end and support ribs on the open side (deco).
    -> {'solid', 'deco'}."""
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    rise = b["rise"]
    lo_z, hi_z = (z0, z1) if rise == "+z" else (z1, z0)
    yl = lambda z: y0 + (y1 - y0) * (z - lo_z) / (hi_z - lo_z)  # noqa: E731
    sk = bmesh.new()
    for xs in (x0 + 0.06, x1 - 0.06):
        seg_box(sk, (xs, yl(lo_z) + 0.07, lo_z), (xs, yl(hi_z) + 0.07, hi_z), 0.12, 0.14)
    solid = geo_of("conveyor_skirt", [(sk, "M_hazard")])
    up = 1 if hi_z > lo_z else -1
    drum = xcyl(0.3, -((x1 - x0) / 2 - 0.12), (x1 - x0) / 2 - 0.12)
    drum_m = Matrix.Translation(C.g2b((x0 + x1) / 2, y0 + 0.12, lo_z - 0.05 * up))
    open_x = x0 if (x0 + x1) / 2 > 0 else x1           # the hall-facing side (away from the gallery wall)
    s = 1.0 if open_x == x1 else -1.0
    ribs = bmesh.new()
    zz = lo_z + 2.0 * up
    while (hi_z - zz) * up > 0.6:
        h = yl(zz)
        xa, xb = sorted((open_x, open_x + 0.08 * s))
        gbox(ribs, (xa, 0.0, zz - 0.09), (xb, h - 0.05, zz + 0.09))
        zz += 2.0 * up
    band = bmesh.new()
    seg_box(band, (open_x + 0.03 * s, yl(lo_z) - 0.12, lo_z), (open_x + 0.03 * s, yl(hi_z) - 0.12, hi_z), 0.06, 0.2)
    motor = bmesh.new()
    mz = hi_z - 0.75 * up
    xa, xb = sorted((open_x - 0.05 * s, open_x + 0.95 * s))
    gbox(motor, (xa, 1.9, mz - 0.5), (xb, 2.9, mz + 0.5))
    mcyl = xcyl(0.36, -0.45, 0.45)
    mcyl_m = Matrix.Translation(C.g2b(open_x + 0.5 * s, 2.4, mz - 1.2 * up)) @ Matrix.Rotation(math.radians(90), 4, "Z")
    deco = geo_of("conveyor_deco", [(drum, "M_metal", drum_m), (ribs, "M_metal"), (band, "M_hazard"),
                                    (motor, "M_press"), (mcyl, "M_metal", mcyl_m)])
    return {"solid": solid, "deco": deco}


# ── catwalk decks (grate) + frames ───────────────────────────────────────────────────────────────
def catwalk(b) -> dict:
    """Grate deck (M_grate; the runtime alpha-tests it) with steel stringers under both long edges
    and cross bearers every 1.5 m (solid). -> {'grate', 'solid'}."""
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    deck = bmesh.new()
    gbox(deck, (x0, y0, z0), (x1, y1, z1))
    fr = bmesh.new()
    along_x = (x1 - x0) >= (z1 - z0)
    if along_x:
        for zz in (z0, z1 - 0.1):
            gbox(fr, (x0, y1 - 0.34, zz), (x1, y0, zz + 0.1))
        n = max(1, round((x1 - x0) / 1.5))
        for k in range(n + 1):
            xx = x0 + (x1 - x0) * k / n
            xx = min(max(xx, x0 + 0.04), x1 - 0.04)
            gbox(fr, (xx - 0.04, y1 - 0.26, z0 + 0.1), (xx + 0.04, y0, z1 - 0.1))
    else:
        for xx in (x0, x1 - 0.1):
            gbox(fr, (xx, y1 - 0.34, z0), (xx + 0.1, y0, z1))
        n = max(1, round((z1 - z0) / 1.5))
        for k in range(n + 1):
            zz = z0 + (z1 - z0) * k / n
            zz = min(max(zz, z0 + 0.04), z1 - 0.04)
            gbox(fr, (x0 + 0.1, y1 - 0.26, zz - 0.04), (x1 - 0.1, y0, zz + 0.04))
    return {"grate": geo_of("catwalk", [(deck, "M_grate")]), "solid": geo_of("catwalk_frame", [(fr, "M_hazard")])}


def hangers(points_xz, y_from, y_to) -> Geo:
    """Thin hanger rods from the truss chord down to a catwalk / beam (deco)."""
    bm = bmesh.new()
    for (x, z) in points_xz:
        gbox(bm, (x - 0.02, y_from, z - 0.02), (x + 0.02, y_to, z + 0.02))
    return geo_of("hangers", [(bm, "M_metal")])


# ── shell: walls, roof with skylight strips, trusses, clerestory, doors, signs, pipes ────────────
WALL_T = 0.6


def shell(bounds, props) -> dict:
    """The building shell (not paintable). Returns {bucket_name: Geo}:
    solid_shell_wall_{w,e,s,n}, solid_shell_roof, deco_skylights, deco_clerestory, deco_trusses,
    deco_doors, deco_signs, deco_pipes, deco_wallband."""
    (bx0, by0, bz0), (bx1, by1, bz1) = bounds["min"], bounds["max"]
    H = by1
    t = WALL_T
    out = {}
    for key, mn, mx in (("w", (bx0 - t, by0, bz0 - t), (bx0, H + 0.6, bz1 + t)),
                        ("e", (bx1, by0, bz0 - t), (bx1 + t, H + 0.6, bz1 + t)),
                        ("s", (bx0, by0, bz0 - t), (bx1, H + 0.6, bz0)),
                        ("n", (bx0, by0, bz1), (bx1, H + 0.6, bz1 + t))):
        bm = bmesh.new()
        gbox(bm, mn, mx)
        out[f"solid_shell_wall_{key}"] = geo_of(f"wall_{key}", [(bm, "M_brick")])
    # roof slab with two skylight strips (openings), lantern curbs around them
    sk = props["skylights"]
    xs = sorted(v for pair in sk["x"] for v in pair)
    zs0, zs1 = sk["z0"], sk["z1"]
    roof = bmesh.new()
    cuts = [bx0 - t] + xs + [bx1 + t]
    for i in range(len(cuts) - 1):
        a, c = cuts[i], cuts[i + 1]
        is_open = any(abs(a - p[0]) < 1e-6 and abs(c - p[1]) < 1e-6 for p in sk["x"])
        if is_open:
            gbox(roof, (a, H, bz0 - t), (c, H + 0.6, zs0))
            gbox(roof, (a, H, zs1), (c, H + 0.6, bz1 + t))
        else:
            gbox(roof, (a, H, bz0 - t), (c, H + 0.6, bz1 + t))
    curb = bmesh.new()
    depth = sk["depth"]
    for (a, c) in sk["x"]:
        gbox(curb, (a - 0.25, H + 0.6, zs0 - 0.25), (a, H + 0.6 + depth, zs1 + 0.25))
        gbox(curb, (c, H + 0.6, zs0 - 0.25), (c + 0.25, H + 0.6 + depth, zs1 + 0.25))
        gbox(curb, (a, H + 0.6, zs0 - 0.25), (c, H + 0.6 + depth, zs0))
        gbox(curb, (a, H + 0.6, zs1), (c, H + 0.6 + depth, zs1 + 0.25))
    out["solid_shell_roof"] = geo_of("roof", [(roof, "M_metal"), (curb, "M_metal")])
    # skylight panes (emissive, dim overcast) + glazing bars + rain streaks
    panes = bmesh.new()
    bars = bmesh.new()
    streak = bmesh.new()
    rnd = C.rng("lockwell", "rain")
    py = H + 0.6 + depth - 0.08
    for (a, c) in sk["x"]:
        gbox(panes, (a, py - 0.02, zs0), (c, py, zs1))
        nz = int(round((zs1 - zs0) / 1.35))
        for k in range(nz + 1):
            zz = zs0 + (zs1 - zs0) * k / nz
            gbox(bars, (a, py - 0.2, zz - 0.05), (c, py - 0.02, zz + 0.05))
        for xx in (a + (c - a) / 3, a + 2 * (c - a) / 3):
            gbox(bars, (xx - 0.04, py - 0.16, zs0), (xx + 0.04, py - 0.02, zs1))
        for k in range(nz):
            for j in range(3):
                x_lo = a + (c - a) * j / 3
                for s in range(4):
                    sx = x_lo + rnd.uniform(0.15, (c - a) / 3 - 0.15)
                    sz0 = zs0 + (zs1 - zs0) * k / nz + rnd.uniform(0.05, 0.5)
                    ln = rnd.uniform(0.35, 0.8)
                    gbox(streak, (sx - 0.012, py - 0.03, sz0), (sx + 0.012, py - 0.025, sz0 + ln))
    out["deco_skylights"] = geo_of("skylights", [(panes, "M_skylight"), (bars, "M_metal"), (streak, "M_glass")])
    # clerestory windows on the long walls
    cl = props["clerestory"]
    cp = bmesh.new()
    cf = bmesh.new()
    for side in (-1, 1):
        wx = bx0 if side < 0 else bx1
        inx = -0.02 * side
        for zc in cl["z"]:
            z_a, z_b = zc - cl["width"] / 2, zc + cl["width"] / 2
            gbox(cp, (wx + inx - 0.01, cl["y0"], z_a), (wx + inx + 0.01, cl["y1"], z_b))
            fr = 0.12
            fx0, fx1 = sorted((wx + inx * 1, wx - 0.14 * side))
            for (za, zb, ya, yb) in ((z_a - fr, z_a, cl["y0"] - fr, cl["y1"] + fr), (z_b, z_b + fr, cl["y0"] - fr, cl["y1"] + fr),
                                     (z_a, z_b, cl["y0"] - fr, cl["y0"]), (z_a, z_b, cl["y1"], cl["y1"] + fr)):
                gbox(cf, (fx0, ya, za), (fx1, yb, zb))
            for k in range(1, 4):
                zz = z_a + (z_b - z_a) * k / 4
                gbox(cf, (fx0 + 0.04 * (side > 0), cl["y0"], zz - 0.035), (fx1 - 0.04 * (side < 0), cl["y1"], zz + 0.035))
            ym = (cl["y0"] + cl["y1"]) / 2
            gbox(cf, (fx0, ym - 0.035, z_a), (fx1, ym + 0.035, z_b))
    out["deco_clerestory"] = geo_of("clerestory", [(cp, "M_skylight"), (cf, "M_metal")])
    # roof trusses (Pratt-ish) spanning X, with a steel purlin line at each skylight edge
    tr = props["trusses"]
    tb = bmesh.new()
    y0, y1 = tr["y0"], tr["y1"]
    for zc in tr["z"]:
        gbox(tb, (bx0, y0, zc - 0.12), (bx1, y0 + 0.2, zc + 0.12))           # bottom chord
        gbox(tb, (bx0, y1 - 0.2, zc - 0.12), (bx1, y1, zc + 0.12))           # top chord
        n = 16
        for k in range(n + 1):
            xx = bx0 + (bx1 - bx0) * k / n
            gbox(tb, (xx - 0.07, y0 + 0.2, zc - 0.07), (xx + 0.07, y1 - 0.2, zc + 0.07))
            if k < n:
                xn = bx0 + (bx1 - bx0) * (k + 1) / n
                if k < n // 2:
                    seg_box(tb, (xx, y1 - 0.2, zc), (xn, y0 + 0.2, zc), 0.1, 0.1)
                else:
                    seg_box(tb, (xx, y0 + 0.2, zc), (xn, y1 - 0.2, zc), 0.1, 0.1)
    out["deco_trusses"] = geo_of("trusses", [(tb, "M_metal")])
    # roll-up loading doors on both end walls (team stripe), with guides and a header box
    dr = props["doors"]
    dp = bmesh.new()
    dg = bmesh.new()
    dA = bmesh.new()
    dB = bmesh.new()
    dh = bmesh.new()
    for side, team_bm in ((-1, dA), (1, dB)):
        wz = bz0 if side < 0 else bz1
        inz = -0.03 * side
        for xc in dr["x"]:
            xa, xb = xc - dr["width"] / 2, xc + dr["width"] / 2
            ya, yb = 1.0, 1.0 + dr["height"]
            za, zb = sorted((wz, wz + inz))
            gbox(dp, (xa, ya, za), (xb, yb, zb))
            for k in range(int(dr["height"] / 0.22)):
                yy = ya + 0.11 + k * 0.22
                zc_ = wz + inz * 1.6
                gbox(dg, (xa, yy - 0.02, min(zc_, wz)), (xb, yy + 0.02, max(zc_, wz)))
            zt_a, zt_b = sorted((wz, wz + inz * 2.0))
            gbox(team_bm, (xa, ya + 1.5, zt_a), (xb, ya + 2.0, zt_b))
            gbox(dh, (xa - 0.25, ya, min(wz, wz - 0.22 * side)), (xa, yb + 0.1, max(wz, wz - 0.22 * side)))
            gbox(dh, (xb, ya, min(wz, wz - 0.22 * side)), (xb + 0.25, yb + 0.1, max(wz, wz - 0.22 * side)))
            gbox(dh, (xa - 0.3, yb, min(wz, wz - 0.45 * side)), (xb + 0.3, yb + 0.55, max(wz, wz - 0.45 * side)))
            gbox(dh, (xa, ya, min(wz, wz - 0.06 * side)), (xb, ya + 0.12, max(wz, wz - 0.06 * side)))
    out["deco_doors"] = geo_of("doors", [(dp, "M_steel"), (dg, "M_metal"), (dA, "M_pad_A"), (dB, "M_pad_B"), (dh, "M_hazard")])
    # painted wall band + pipes on the end walls above the doors
    pb = bmesh.new()
    band = bmesh.new()
    for side in (-1, 1):
        wz = bz0 if side < 0 else bz1
        for yy, r in ((6.45, 0.16), (6.95, 0.11)):
            zz = wz - 0.28 * side
            pts = [C.g2b(bx0 + 0.3, yy, zz), C.g2b(bx1 - 0.3, yy, zz)]
            C.bm_tube(pb, pts, r, seg=10)
        for xx in (bx0 + 1.2, bx1 - 1.2):
            C.bm_tube(pb, [C.g2b(xx, 1.0, wz - 0.28 * side), C.g2b(xx, 12.4, wz - 0.28 * side)], 0.13, seg=10)
    for side in (-1, 1):
        wx = bx0 if side < 0 else bx1
        xa, xb = sorted((wx, wx - 0.03 * side))
        gbox(band, (xa, 9.55, bz0), (xb, 9.85, bz1))
    out["deco_pipes"] = geo_of("pipes", [(pb, "M_crane")])
    out["deco_wallband"] = geo_of("wallband", [(band, "M_office")])
    # painted wall signs above the canopies (only HARBOR CUP / TIDE CO.)
    sg = props["signs"]
    sb = bmesh.new()
    st = Geo("sign_text")
    sf = bmesh.new()
    for side, key in ((-1, "A"), (1, "B")):
        wz = bz0 if side < 0 else bz1
        W, Hs = sg["width"], sg["height"]
        za, zb = sorted((wz, wz - 0.06 * side))
        gbox(sb, (-W / 2, sg["y"] - Hs / 2, za), (W / 2, sg["y"] + Hs / 2, zb))
        zf_a, zf_b = sorted((wz, wz - 0.1 * side))
        for (xa, xb, ya, yb) in ((-W / 2 - 0.15, W / 2 + 0.15, sg["y"] - Hs / 2 - 0.15, sg["y"] - Hs / 2),
                                 (-W / 2 - 0.15, W / 2 + 0.15, sg["y"] + Hs / 2, sg["y"] + Hs / 2 + 0.15),
                                 (-W / 2 - 0.15, -W / 2, sg["y"] - Hs / 2, sg["y"] + Hs / 2),
                                 (W / 2, W / 2 + 0.15, sg["y"] - Hs / 2, sg["y"] + Hs / 2)):
            gbox(sf, (xa, ya, zf_a), (xb, yb, zf_b))
        tbm = D.text_bm(sg[key], depth=0.05, bevel=0.0)
        D.fit_text(tbm, W - 1.2, Hs - 0.5, Vector((0, 0, 0)))
        # lettering faces local -Y = glTF +Z at yaw 0: the south wall (z = bz0) looks toward +Z
        yaw = 0.0 if side < 0 else 180.0
        m = C.place_matrix((0, sg["y"], wz - 0.06 * side), yaw)
        st.add_bm(tbm, "M_sign_text", matrix=m)
        tbm.free()
    g = geo_of("signs", [(sb, "M_billboard"), (sf, "M_paint_trim")])
    g.extend(st)
    out["deco_signs"] = g
    return out


# ── strip lights (fluorescent fixtures) ──────────────────────────────────────────────────────────
def strip_positions(props, skip_near_cab=4.2):
    """[(x, y, z)] centres of every fluorescent fixture (glTF)."""
    s = props["strips"]
    out = []
    n = int(round((s["z1"] - s["z0"]) / s["step"]))
    for x in list(s["rows_x"]) + list(s["gallery_x"]):
        y = s["gallery_y"] if x in s["gallery_x"] else s["y"]
        for k in range(n + 1):
            z = s["z0"] + s["step"] * k
            if abs(x) < 5 and abs(z) < skip_near_cab:
                continue
            out.append((x, y, z))
    return out


def strips(props, positions, chain_to) -> Geo:
    s = props["strips"]
    L = s["length"]
    hous = bmesh.new()
    tube = bmesh.new()
    chain = bmesh.new()
    for (x, y, z) in positions:
        gbox(hous, (x - 0.13, y, z - L / 2), (x + 0.13, y + 0.12, z + L / 2))
        gbox(tube, (x - 0.06, y - 0.05, z - L / 2 + 0.08), (x + 0.06, y, z + L / 2 - 0.08))
        for dz in (-L / 2 + 0.25, L / 2 - 0.25):
            gbox(chain, (x - 0.012, y + 0.12, z + dz - 0.012), (x + 0.012, chain_to, z + dz + 0.012))
    return geo_of("strips", [(hous, "M_metal"), (tube, "M_strip"), (chain, "M_metal")])


# ── practical lamp fixtures (at the light_ empties) ──────────────────────────────────────────────
def lamp_fixture(pos, kind: str, cable_to: float) -> Geo:
    x, y, z = pos
    shade = bmesh.new()
    bulb = bmesh.new()
    wire = bmesh.new()
    if kind == "canopy":
        gbox(shade, (x - 0.45, y + 0.02, z - 0.3), (x + 0.45, y + 0.22, z + 0.3))
        gbox(bulb, (x - 0.38, y - 0.02, z - 0.22), (x + 0.38, y + 0.02, z + 0.22))
        gbox(wire, (x - 0.02, y + 0.22, z - 0.02), (x + 0.02, cable_to, z + 0.02))
    else:
        prof = [(0.06, 0.62), (0.1, 0.55), (0.16, 0.42), (0.34, 0.22), (0.52, 0.04), (0.55, 0.0)]
        C.bm_lathe(shade, prof, seg=18)
        C.bm_transform(shade, Matrix.Translation(C.g2b(x, y, z)))
        C.bm_lathe(bulb, [(0.0, 0.2), (0.16, 0.14), (0.22, 0.02), (0.0, 0.0)], seg=14)
        C.bm_transform(bulb, Matrix.Translation(C.g2b(x, y - 0.02, z)))
        C.bm_cylinder(wire, 0.018, 0.018, y + 0.6, cable_to, seg=6, center=(x, -z))
    return geo_of("lamp", [(shade, "M_paint_trim" if kind == "pendant" else "M_metal"), (bulb, "M_lamp"), (wire, "M_metal")])


# ── the crane: runway beam, trolley, cab over the nest, hooks ────────────────────────────────────
def crane(nest, props, bounds) -> dict:
    """Monorail runway beam along Z at x = 0 (deco), a trolley at z = 0 hanging the cab: four
    corner posts + roof over the nest platform (solid) with an operator console; two hook trolleys
    near the docks with hook blocks and team-coloured loads (deco). -> {'solid', 'deco'}."""
    cr = props["crane"]
    (nx0, ny0, nz0), (nx1, ny1, nz1) = nest["min"], nest["max"]
    (bx0, _, bz0), (bx1, _, bz1) = bounds["min"], bounds["max"]
    by0, by1 = cr["beam_y"]
    beam = bmesh.new()
    gbox(beam, (-0.32, by0, bz0 + 0.5), (0.32, by0 + 0.08, bz1 - 0.5))    # bottom flange
    gbox(beam, (-0.32, by1 - 0.08, bz0 + 0.5), (0.32, by1, bz1 - 0.5))    # top flange
    gbox(beam, (-0.05, by0, bz0 + 0.5), (0.05, by1, bz1 - 0.5))           # web
    for zz in (bz0 + 0.5, bz1 - 0.5):                                     # end stops
        gbox(beam, (-0.4, by0 - 0.2, zz - 0.15), (0.4, by1, zz + 0.15))
    ry = cr["cab_roof_y"]
    trol = bmesh.new()
    gbox(trol, (-0.9, ry + 0.25, -1.6), (0.9, by0 - 0.06, 1.6))
    wheels = []
    for zz in (-1.1, 1.1):
        for xs in (-0.2, 0.2):
            w = xcyl(0.17, -0.05, 0.05, seg=12)
            wheels.append((w, "M_metal", Matrix.Translation(C.g2b(xs, by0 + 0.2, zz))))
    posts = bmesh.new()
    for (px, pz) in ((nx0 + 0.12, nz0 + 0.12), (nx1 - 0.12, nz0 + 0.12), (nx0 + 0.12, nz1 - 0.12), (nx1 - 0.12, nz1 - 0.12)):
        gbox(posts, (px - 0.12, ny1, pz - 0.12), (px + 0.12, ry, pz + 0.12))
    roof = bmesh.new()
    gbox(roof, (nx0 - 0.15, ry, nz0 - 0.15), (nx1 + 0.15, ry + 0.25, nz1 + 0.15))
    stripe = bmesh.new()
    gbox(stripe, (nx0 - 0.17, ry + 0.06, nz0 - 0.17), (nx1 + 0.17, ry + 0.16, nz1 + 0.17))
    console = bmesh.new()
    btn = bmesh.new()
    for sg in (1.0, -1.0):                         # two operator consoles, rot180 (fair nest cover)
        def B(bm_, a, b_):
            (ax, ay, az), (bx_, by_, bz_) = a, b_
            gbox(bm_, (min(ax * sg, bx_ * sg), ay, min(az * sg, bz_ * sg)), (max(ax * sg, bx_ * sg), by_, max(az * sg, bz_ * sg)))
        B(console, (2.1, ny1, 2.1), (2.88, ny1 + 0.85, 2.88))
        B(console, (2.05, ny1 + 0.85, 2.05), (2.9, ny1 + 0.95, 2.9))
        for k in range(3):
            B(btn, (2.15 + k * 0.22, ny1 + 0.95, 2.3), (2.29 + k * 0.22, ny1 + 1.0, 2.44))
    solid = geo_of("crane_cab", [(posts, "M_paint_trim"), (roof, "M_paint_trim"), (stripe, "M_hazard"), (console, "M_metal")])
    deco_parts = [(beam, "M_paint_trim"), (trol, "M_hazard"), (btn, "M_lamp")] + wheels
    # cab lamp under the roof (emissive only)
    cl = bmesh.new()
    gbox(cl, (-0.9, ry - 0.06, -0.12), (0.9, ry, 0.12))
    deco_parts.append((cl, "M_strip"))
    # hook trolleys near both docks: cable, hook block, hook, a hanging steel coil
    hk = bmesh.new()
    hy = cr["hook_y"]
    cab = bmesh.new()
    coil_parts = []
    for zz, team in ((-21.0, "A"), (21.0, "B")):
        gbox(hk, (-0.7, by0 - 0.55, zz - 0.9), (0.7, by0 - 0.06, zz + 0.9))            # hook trolley
        for dx in (-0.18, 0.18):
            gbox(cab, (dx - 0.02, hy + 0.9, zz - 0.02), (dx + 0.02, by0 - 0.55, zz + 0.02))
        blk = bmesh.new()
        gbox(blk, (-0.35, hy + 0.2, zz - 0.28), (0.35, hy + 0.95, zz + 0.28))
        coil_parts.append((blk, "M_hazard"))
        hook = bmesh.new()
        pts = []
        for k in range(10):
            a = math.radians(-30 + 250 * k / 9)
            pts.append(C.g2b(0.0 + 0.28 * math.sin(a), hy - 0.25 - 0.28 * math.cos(a), zz))
        C.bm_tube(hook, [C.g2b(0, hy + 0.2, zz), C.g2b(0, hy - 0.05, zz)] , 0.06, seg=8)
        C.bm_tube(hook, pts, 0.07, seg=8)
        coil_parts.append((hook, "M_metal"))
        # load: a steel coil on a cradle, team-coloured band (small, high: never blocks the dock view)
        coil = xcyl(0.55, -0.45, 0.45, seg=20)
        coil_parts.append((coil, "M_steel", Matrix.Translation(C.g2b(0, hy - 0.95, zz))))
        eye = xcyl(0.22, -0.47, 0.47, seg=12)
        coil_parts.append((eye, "M_metal", Matrix.Translation(C.g2b(0, hy - 0.95, zz))))
        band = xcyl(0.57, -0.12, 0.12, seg=20)
        coil_parts.append((band, f"M_pad_{team}", Matrix.Translation(C.g2b(0, hy - 0.95, zz))))
        strap = bmesh.new()
        for dx in (-0.3, 0.3):
            seg_box(strap, (dx, hy - 0.95, zz), (0, hy - 0.3, zz), 0.04, 0.04)
        coil_parts.append((strap, "M_metal"))
    deco_parts += [(hk, "M_hazard"), (cab, "M_metal")] + coil_parts
    deco = geo_of("crane", deco_parts)
    return {"solid": solid, "deco": deco}


# ── office trims (door + window frames) and furniture ────────────────────────────────────────────
def office_trims(front_x, back_x, z0, z1, y0, openings, sign) -> dict:
    """Door / window frames on the front wall (deco) and a desk + filing cabinets inside (solid).
    `sign` = +1 when the front faces -x (authored east office), -1 when mirrored."""
    fr = bmesh.new()
    fx0, fx1 = sorted((front_x - 0.06 * sign, front_x + 0.36 * sign))
    for (kind, za, zb, ya, yb) in openings:
        w = 0.1
        gbox(fr, (fx0, ya, za - w), (fx1, yb + w, za))
        gbox(fr, (fx0, ya, zb), (fx1, yb + w, zb + w))
        gbox(fr, (fx0, yb, za), (fx1, yb + w, zb))
        if kind == "window":
            gbox(fr, (fx0, ya - w, za - w), (fx1, ya, zb + w))
            gbox(fr, (fx0 + 0.1, (ya + yb) / 2 - 0.03, za), (fx1 - 0.1, (ya + yb) / 2 + 0.03, zb))
    furn = bmesh.new()
    xa, xb = sorted((back_x - 0.35 * sign, back_x - 1.25 * sign))
    # rot180-consistent: the desk sits at the -z end of the east office, the +z end of the west one
    dz0, dz1 = (z0 + 1.0, z0 + 2.6) if sign > 0 else (z1 - 2.6, z1 - 1.0)
    gbox(furn, (xa, y0, dz0), (xb, y0 + 0.78, dz1))                      # desk
    ca, cb = sorted((back_x - 0.35 * sign, back_x - 0.95 * sign))
    for zz in ((z1 - 1.6, z1 - 1.0) if sign > 0 else (z0 + 1.6, z0 + 1.0)):
        gbox(furn, (ca, y0, zz - 0.28), (cb, y0 + 1.35, zz + 0.28))       # filing cabinets
    return {"deco": geo_of("office_trim", [(fr, "M_steel")]), "solid": geo_of("office_furn", [(furn, "M_metal")])}
