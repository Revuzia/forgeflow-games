"""Bible kit: production modelling helpers for VALE fighters (STYLE_BIBLE "Fighters", tokens.json
`fighter`, WORLD.md §2 faces). Every helper returns ONE mesh object (world space, identity
transform, materials assigned) ready to wrap in `fighter.Part(...)` with the binding noted in its
docstring. Nothing here is a primitive: masks, hoods and slabs are conformed plates and lofts with
2-4 cm bevels (the bevel is the brushstroke).

    head_frame(info)                  centre + radius of the head (masks, hoods, visors, crests)
    carved_mask(ctx, mat, ink, ...)   carved stone/wood mask: planar facets, brow shelf, beak keel
                                      (the facing cue from above), carved eye recesses painted ink
    glass_visor(ctx, mat, target)     a dawnglass band across the eyes (Aubade faces)
    hood(ctx, mat, ...)               heavy cloth hood open at the face, sculpted folds, rolled hem
    mantle(ctx, mat, ...)             heavy cloth shawl around neck and shoulders
    slab_pauldron(ctx, side, mat)     thick honed-stone shoulder slab (+ the projection, for inlays)
    limb_shell(ctx, a, b, mat, ...)   bracer / greave / cuff: thick conformed shell on a limb segment
    drape(top_pts, length, mat, ...)  heavy cloth panel: sculpted folds, rolled hem (rigid drapery)
    inlay(proj, uvs, target, mat)     raised glass inlay strip following a surface (the `accent`)
    crest(points, heights, widths)    fin along a path (hood crest, gnomon fin)
    surface(proj, u, v, target, lift) a point on a target surface along a projection ray

Faces (WORLD.md §2): Aubade wear glass visors, Serenade carved or lacquered masks, the Hourless
wraps or hoods. No bare faces, no hair cards; drapery is rigid with <= 2 sway bones (x_ chains of
one bone each, or one chain of two).
"""
from __future__ import annotations

import math

from mathutils import Vector

from . import mesh
from .mesh import Cylindrical, Spherical

V = Vector


def _bvh(target):
    if target is None:
        return None
    from mathutils.bvhtree import BVHTree
    return target if isinstance(target, BVHTree) else mesh.bvh_of(target)


def surface(proj, u: float, v: float, target, lift: float = 0.0, far: float = 1.0, default: float = 0.12,
            outer: bool = False) -> Vector:
    """Point where the projection ray (u, v) leaves `target` (objects or BVH), pushed out by `lift`.
    outer=True takes the OUTERMOST crossing (closed shells: slabs with an inner face)."""
    o, d = proj.ray(u, v)
    r = None
    if target is not None:
        tree = _bvh(target)
        if outer:
            hit = tree.ray_cast(o + d * far, -d, far)
            r = (hit[0] - o).dot(d) if hit[0] is not None else None
        else:
            r = mesh._surface_r(tree, o, d, far)
    return o + d * ((r if r is not None else default) + lift)


def pwl(keys, x: float) -> float:
    """Piecewise-LINEAR interpolation over [(x, y), ...] (carved planar facets, not smooth)."""
    if x <= keys[0][0]:
        return keys[0][1]
    for (x0, y0), (x1, y1) in zip(keys, keys[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / max(1e-9, x1 - x0)
    return keys[-1][1]


def head_frame(info) -> tuple[Vector, float]:
    """(centre, radius) of the base head (rig crown/head_base): masks and hoods are built around it."""
    J = info.joints
    hb, cr = J["head_base"], J["crown"]
    hh = cr.z - hb.z
    c = V((0.0, hb.y + 0.004, hb.z + 0.44 * hh))
    return c, 0.5 * hh


# ── faces ────────────────────────────────────────────────────────────────────────────────────────
def carved_mask(ctx, mat, ink_mat, center=None, radius=None, *, target=None, u_span: float = 80.0, v_top: float = 46.0,
                v_bot: float = 132.0, lift: float = 0.024, brow: float = 0.012, cheek: float = 0.014,
                chin: float = 0.010, eye=(27.0, 88.0, 15.0, 4.6), eye_depth: float = 0.012, slant: float = -0.22,
                thickness: float = 0.018, bevel_w: float = 0.007, cols: int = 22, rows_n: int = 13,
                sharp_angle: float = 16.0, name: str = "mask", col=None):
    """Carved mask over the front of the head (bind 'bone:head').

    Planar facets: the radius is piecewise-linear in azimuth u (cheek planes turning away) and in
    polar angle v (brow shelf, eye line, cheekbones, chin), so the surface reads cut, not moulded.
    With `target` (the body high) the facets ride `lift` above the real head surface; without it
    they sit on a sphere of `radius` + lift around `center`.
    eye = (u, v, half-width u, half-height v) of the carved recesses (degrees), sunk `eye_depth`
    and painted with `ink_mat`; `slant` tilts the slits (v per degree of u: < 0 = outer corners up,
    a stern brow). Add the beak with `mask_beak` (the top-down facing cue)."""
    c0, R0 = head_frame(ctx.info)
    c = V(center) if center is not None else c0
    R = (radius if radius is not None else R0) + lift
    proj = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    eu, ev, ew, eh = eye
    fu = [(-u_span - 10, -cheek * 1.6), (-58, -cheek), (-30, -0.002), (-9, 0.004), (0, 0.006), (9, 0.004),
          (30, -0.002), (58, -cheek), (u_span + 10, -cheek * 1.6)]
    fv = [(v_top - 5, -0.016), (62, -0.002), (74, brow), (81, brow * 0.6), (90, -0.004), (100, 0.004),
          (112, 0.0), (124, -chin * 0.6), (v_bot + 5, -chin * 1.5)]

    def r_fn(u, v, r):
        rr = (r if target is not None else R) + pwl(fu, u) + pwl(fv, v)
        du, dv = (abs(u) - eu) / ew, (v - ev - slant * (abs(u) - eu)) / eh
        d2 = du * du + dv * dv
        if d2 < 1.0:                                  # carved recess with a crisp lip
            rr -= eye_depth * (1.0 - d2) ** 0.35
        return rr

    rows = [(v_top, -u_span * 0.55, u_span * 0.55), (v_top + 14, -u_span * 0.92, u_span * 0.92),
            (88, -u_span, u_span), (110, -u_span * 0.92, u_span * 0.92), (v_bot, -u_span * 0.42, u_span * 0.42)]
    m = mesh.plate(proj, rows, target=target, r_fn=r_fn, offset=lift if target is not None else 0.0,
                   thickness=thickness, cols=cols, rows_n=rows_n, smooth_iters=8 if target is not None else 0, rim=0.0, bevel_w=bevel_w, bevel_segments=2, weighted=False, name=name, col=col,
                   mat=mat, inner=False)
    mesh.shade(m, True, sharp_angle=sharp_angle)
    mesh.weighted_normals(m)
    # ink almonds laid in the carved recesses (smooth outlines at any mesh density)
    tree = mesh.bvh_of([m])
    eyes = []
    for sgn in (1.0, -1.0):
        st = []
        k = 9
        for i in range(k):
            t = i / (k - 1)
            du = (-1.0 + 2.0 * t) * ew * 0.9
            u = sgn * (eu + du)
            v = ev + slant * du
            h = math.sin(math.pi * t) ** 0.75
            p = surface(proj, u, v, tree, 0.0015, outer=True)
            st.append({"p": p, "rx": max(0.0015, eh * 0.9 * h * math.pi / 180.0 * R), "ry": 0.0025, "exp": 2.4})
        o, d = proj.ray(sgn * eu, ev)
        e = mesh.loft(st, segments=8, caps=("point", "point"), up=tuple(d), name=f"{name}_eye", col=col, rings=12)
        mesh.set_material(e, ink_mat)
        eyes.append(e)
    m = mesh.join([m] + eyes, name)
    m["vale_proj"] = [c.x, c.y, c.z, R]
    return m


def mask_beak(ctx, mat, mask_obj, center=None, *, v0: float = 70.0, v1: float = 112.0, height: float = 0.034,
              width: float = 0.018, name: str = "mask_beak", col=None):
    """A carved keel down the mask's centre line, deepest near the bottom: the mask's 'beak' reads
    as the facing direction from the game camera (bible silhouette rule). Bind 'bone:head'."""
    c0, _ = head_frame(ctx.info)
    c = V(center) if center is not None else c0
    proj = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    tree = mesh.bvh_of([mask_obj])
    st = []
    n = 7
    for i in range(n):
        t = i / (n - 1)
        v = v0 + (v1 - v0) * t
        p = surface(proj, 0.0, v, tree, -0.003)
        h = height * (0.15 + 0.85 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.8) if t < 0.95 else height * 0.4
        w = width * (0.55 + 0.45 * math.sin(math.pi * t))
        st.append({"p": p, "rx": w, "ry": h, "ry2": 0.004, "exp": 1.7})
    o, d = proj.ray(0.0, (v0 + v1) / 2)
    b = mesh.loft(st, segments=8, caps=("point", "round"), up=tuple(d), name=name, col=col, rings=14)
    mesh.set_material(b, mat)
    mesh.shade(b, True, sharp_angle=40)
    return b


def glass_visor(ctx, mat, target, center=None, *, u_span: float = 84.0, v0: float = 79.0, v1: float = 97.0,
                lift: float = 0.006, thickness: float = 0.012, bevel_w: float = 0.005, name: str = "visor", col=None):
    """Dawnglass band across the eyes, conformed proud of `target` (mask or head). Bind 'bone:head'."""
    c0, _ = head_frame(ctx.info)
    c = V(center) if center is not None else c0
    proj = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    rows = [(v0, -u_span * 0.92, u_span * 0.92), ((v0 + v1) / 2, -u_span, u_span), (v1, -u_span * 0.9, u_span * 0.9)]
    vz = mesh.plate(proj, rows, target=target, offset=lift, thickness=thickness, cols=24, rows_n=5, smooth_iters=6,
                    rim=0.0, bevel_w=bevel_w, bevel_segments=2, name=name, col=col, mat=mat)
    return vz


def hood(ctx, mat, rim_mat=None, center=None, *, open_deg: float = 64.0, lift: float = 0.03, peak: float = 0.05,
         folds: int = 5, fold_depth: float = 0.010, v_end: float = 128.0, thickness: float = 0.02,
         target=None, name: str = "hood", col=None):
    """Heavy cloth hood around the head, open at the face (`open_deg` half-angle around the front),
    a soft point at the back of the crown (`peak`), sculpted folds radiating from the crown and a
    rolled hem. Bind ('zblend', 'neck', 'head', z0, z1) so the drape at the nape follows the neck."""
    c0, R0 = head_frame(ctx.info)
    c = V(center) if center is not None else c0
    proj = Spherical(c, up=(0, 0, 1), front=(0, 1, 0))          # u = 0 at the BACK, +-180 at the face
    a = 180.0 - open_deg

    def shape(u, v, r):
        su = math.sin(math.radians(u * folds * 0.5)) ** 2
        fold = fold_depth * (su ** 1.6) * mesh.smoothstep(35, 115, v)
        back = max(0.0, math.cos(math.radians(u)))
        pk = peak * back ** 2 * math.exp(-((v - 38) / 22) ** 2)
        drape = 0.022 * mesh.smoothstep(90, v_end, v) * (0.4 + 0.6 * back)
        return fold + pk + drape

    rows = [(0, -180, 180), (34, -180, 180), (64, -a - 18, a + 18), (96, -a, a), (v_end, -a + 8, a - 8)]
    h = mesh.plate(proj, rows, target=target, offset=lift, thickness=thickness, cols=24, rows_n=10, smooth_iters=10,
                   shape_fn=shape, rim=0.016, rim_height=0.006, bevel_w=0.008, bevel_segments=2, name=name, col=col,
                   mat=mat, rim_mat=rim_mat or mat, inner=True)
    return h


def mantle(ctx, mat, rim_mat=None, *, z_top: float | None = None, depth: float = 0.15, lift: float = 0.028,
           folds: int = 7, fold_depth: float = 0.012, cowl: float = 0.03, flare: float = 0.008, thickness: float = 0.02,
           target=None, name: str = "mantle", col=None):
    """Heavy cloth shawl wrapped around neck and shoulders, folds hanging from the collar and a
    cowl dip at the chest. Bind ('zblend', 'chest', 'neck', ...) or 'bone:chest'."""
    J = ctx.info.joints
    nb = J["neck_base"]
    zt = z_top if z_top is not None else nb.z + 0.015
    cyl = Cylindrical((0, nb.y + 0.01, 0), (0, 0, 1), ref=(0, -1, 0))

    def shape(u, v, r):
        t = mesh.smoothstep(zt, zt - depth, v)
        f = fold_depth * abs(math.sin(math.radians(u) * folds * 0.5)) ** 0.7 * t
        cw = cowl * max(0.0, math.cos(math.radians(u))) ** 3 * t
        return f + cw + flare * t

    rows = [(zt, -180, 180), (zt - depth * 0.5, -180, 180), (zt - depth, -180, 180)]
    return mesh.plate(cyl, rows, target=target, offset=lift, thickness=thickness, cols=26, smooth_iters=8, wrap=True,
                      shape_fn=shape, rim=0.012, rim_height=0.005, bevel_w=0.007, bevel_segments=1, row_step=0.03,
                      name=name, col=col, mat=mat, rim_mat=rim_mat or mat, inner=True)


# ── armour in the bible's materials ─────────────────────────────────────────────────────────────
def slab_pauldron(ctx, side: str, mat, target, *, size: float = 1.0, lift: float = 0.045, thickness: float = 0.042,
                  bevel_w: float = 0.018, flare: float = 0.03, tilt: float = 0.42, v_end: float = 64.0, ridge: float = 0.012,
                  name: str | None = None, col=None):
    """Thick honed-stone shoulder slab (Breaker/Plinth mass). Returns (obj, proj, bind): bind is
    ('dblend', shoulder, upper_arm, ...); use `proj` to lay an `inlay` along its ridge (u=0 front,
    180 back, v polar from the slab's up axis)."""
    J = ctx.info.joints
    sx = 1.0 if side == "L" else -1.0
    sh = J[f"shoulder.{side}"]
    c = sh + V((-0.03 * sx, 0.0, -0.03))
    up = V((tilt * sx, 0.0, 1.0)).normalized()
    proj = Spherical(c, up=up, front=(0, -1, 0))
    lo, hi = (-75.0, 255.0) if sx > 0 else (-255.0, 75.0)

    def shape(u, v, r):
        k = math.cos(math.radians(u - (90.0 if sx > 0 else -90.0)))          # +1 on the outer side
        keel = ridge * math.exp(-((abs(math.sin(math.radians(u)))) / 0.30) ** 2) * (1 - mesh.smoothstep(10, v_end, v))
        return flare * mesh.smoothstep(v_end * 0.55, v_end, v) * (0.5 + 0.5 * max(0.0, k)) + 0.006 * size + keel

    rows = [(0, lo, hi), (v_end * 0.5, lo, hi), (v_end, lo + 6 * sx, hi - 6 * sx)]
    o = mesh.plate(proj, rows, target=target, offset=lift * size, thickness=thickness, cols=20, smooth_iters=18,
                   rows_n=6, shape_fn=shape, rim=0.0, bevel_w=bevel_w, bevel_segments=2, name=name or f"pauldron.{side}",
                   col=col, mat=mat, inner=True)
    bind = ("dblend", f"shoulder.{side}", f"upper_arm.{side}", tuple(c), tuple(-up), 0.04, 0.13)
    return o, proj, bind


def limb_shell(ctx, a: str, b: str, mat, target, *, t0: float = 0.3, t1: float = 0.98, arc: float | None = None,
               ref=(0, 0, 1), lift: float = 0.012, thickness: float = 0.022, bevel_w: float = 0.01, flare: float = 0.015,
               ridge: float = 0.0, cols: int = 14, name: str = "shell", col=None):
    """Thick conformed shell between joints `a` -> `b` (e.g. 'elbow.L' -> 'wrist.L' for a carved wood
    bracer, 'knee.R' -> 'ankle.R' for an ironstone greave). `arc` = None wraps fully, or the half
    angle (deg) around `ref` for a front plate. Flared at the far end, optional centre ridge.
    Bind rigidly to the limb bone ('bone:forearm.L', 'bone:shin.R')."""
    J = ctx.info.joints
    pa, pb = J[a], J[b]
    L = (pb - pa).length
    cyl = Cylindrical(pa, (pb - pa).normalized(), ref=ref)

    def shape(u, v, r):
        f = flare * mesh.smoothstep(L * (t1 - 0.25), L * t1, v)
        rd = ridge * math.exp(-(u / 14.0) ** 2) if ridge else 0.0
        return f + rd

    if arc is None:
        rows = [(L * t0, -180, 180), (L * (t0 + t1) / 2, -180, 180), (L * t1, -180, 180)]
        wrap = True
    else:
        rows = [(L * t0, -arc * 0.9, arc * 0.9), (L * (t0 + t1) / 2, -arc, arc), (L * t1, -arc * 0.92, arc * 0.92)]
        wrap = False
    return mesh.plate(cyl, rows, target=target, offset=lift, thickness=thickness, cols=cols, smooth_iters=10, wrap=wrap,
                      shape_fn=shape, rim=0.0, bevel_w=bevel_w, bevel_segments=2, row_step=0.05, name=name, col=col,
                      mat=mat, inner=wrap is False)


def drape(top_pts, length: float, mat, *, folds: int = 3, fold_depth: float = 0.016, flare: float = 0.05,
          hem=None, out_dir=(0, -1, 0), avoid=None, clearance: float = 0.03, thickness: float = 0.016,
          fold_sharp: float = 0.45, hem_bevel: float = 0.006, seed: int = 0, rows: int = 7, cols: int = 10,
          name: str = "drape", col=None):
    """Heavy cloth panel (tabard, loincloth, cape, sash): sculpted folds, rolled hem, rigid drapery.
    Bind ('chain', name, root) on an x_ chain of <= 2 bones, or rigidly ('bone:hips')."""
    o = mesh.cloth_panel(top_pts, length, folds=folds, fold_depth=fold_depth, flare=flare, hem=hem, out_dir=out_dir,
                         avoid=avoid, clearance=clearance, thickness=thickness, name=name, col=col, seed=seed,
                         fold_sharp=fold_sharp, hem_bevel=hem_bevel, rows=rows, cols=cols, fold_top=0.35)
    mesh.set_material(o, mat)
    return o


# ── accent + fins ───────────────────────────────────────────────────────────────────────────────
def inlay(proj, uvs, target, mat, *, width: float = 0.02, height: float = 0.006, lift: float = 0.001,
          taper: bool = True, name: str = "inlay", col=None, rings: int | None = None, segments: int = 6):
    """Raised glass strip laid along [(u, v), ...] on the OUTER surface of `target` (the accent: a
    carved channel of dawnglass, NOT a gem or a rune). Width tapers at both ends unless `taper=False`."""
    tree = _bvh(target)
    pts = [surface(proj, u, v, tree, lift, outer=True) for u, v in uvs]
    n = len(pts)
    st = []
    for i, p in enumerate(pts):
        t = i / (n - 1)
        k = (0.45 + 0.55 * math.sin(math.pi * t) ** 0.5) if taper else 1.0
        st.append({"p": p, "rx": width * 0.5 * k, "ry": height, "ry2": height * 0.6, "exp": 3.0})
    mid = len(uvs) // 2
    o, d = proj.ray(*uvs[mid])
    s = mesh.loft(st, segments=segments, caps=("round", "round"), up=tuple(d), name=name, col=col, rings=rings or max(8, n))
    mesh.set_material(s, mat)
    return s


def crest(points, heights, widths, mat, *, up=(0, 0, 1), name: str = "crest", col=None, rings: int = 16):
    """A fin along `points` (hood crest, gnomon fin): heights/widths per point, pointed ends."""
    st = [{"p": p, "rx": w, "ry": h, "ry2": 0.004, "exp": 2.2} for p, h, w in zip(points, heights, widths)]
    c = mesh.loft(st, segments=8, caps=("point", "point"), up=up, name=name, col=col, rings=rings)
    mesh.set_material(c, mat)
    return c


def scarf(ctx, mat, target, *, z: float | None = None, lift: float = 0.004, thick: float = 0.034, depth: float = 0.05,
          cowl: float = 0.06, back_rise: float = 0.012, bunch: float = 0.18, bunches: int = 7, n: int = 40,
          segments: int = 10, name: str = "scarf", col=None):
    """A rolled heavy-linen scarf / cowl wrapped around the neck base: a closed tube whose section
    swells and pinches (`bunch`, `bunches`) like gathered cloth, dipping `cowl` metres at the front
    and rising at the back; it rides `lift` above `target`. Bind ('zblend', 'chest', 'neck', ...)."""
    import bmesh
    J = ctx.info.joints
    nb = J["neck_base"]
    zc = z if z is not None else nb.z - 0.01
    tree = _bvh(target)
    axis = Cylindrical((0, nb.y + 0.01, 0), (0, 0, 1), ref=(0, -1, 0))
    rings = []
    for i in range(n):
        u = 360.0 * i / n
        front = max(0.0, math.cos(math.radians(u))) ** 2
        back = max(0.0, -math.cos(math.radians(u)))
        zz = zc - cowl * front + back_rise * back
        o, d = axis.ray(u, zz)
        r = mesh._surface_r(tree, o, d, 0.6) or 0.12
        k = 1.0 + bunch * math.sin(math.radians(u) * bunches + 0.7) * (0.6 + 0.4 * front)
        ry = depth * k * (1.0 + 0.35 * front)
        rx = thick * k
        c = o + d * (r + lift + ry * 0.75)
        rings.append((c, d, rx, ry))
    bm = bmesh.new()
    vv = []
    for c, d, rx, ry in rings:
        up = V((0, 0, 1))
        side = up.cross(d).normalized()
        upn = d.cross(side).normalized()
        ring = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            ca, sa = math.cos(a), math.sin(a)
            # superellipse-ish cloth roll: flatter on the body side
            rr = ry if ca >= 0 else ry * 0.55
            ring.append(bm.verts.new(c + d * (ca * rr) + upn * (sa * rx)))
        vv.append(ring)
    for i in range(n):
        a, b = vv[i], vv[(i + 1) % n]
        for s in range(segments):
            s2 = (s + 1) % segments
            bm.faces.new((a[s], b[s], b[s2], a[s2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh.bm_to_obj(bm, name, col)
    mesh.set_material(o, mat)
    return o


def sundial_clasp(ctx, wood_mat, accent_mat, center, normal, *, radius: float = 0.055, thick: float = 0.022,
                  gnomon: float = 0.05, name: str = "clasp", col=None):
    """A carved wood dial disc with a glass GNOMON fin (the accent: a sundial, never a gem).
    Returns (disc, fin); bind both 'bone:chest' (or wherever the clasp sits)."""
    c, n = V(center), V(normal).normalized()
    disc = mesh.loft([{"p": c - n * 0.004, "rx": radius, "ry": radius, "exp": 2.0},
                      {"p": c + n * thick * 0.7, "rx": radius * 0.98, "ry": radius * 0.98, "exp": 2.0},
                      {"p": c + n * thick, "rx": radius * 0.80, "ry": radius * 0.80, "exp": 2.0}], segments=20,
                     caps=("flat", "flat"), up=(0, 0, 1), name=name, col=col, smooth_path=False, rings=3)
    mesh.bevel(disc, 0.005, 2, angle=30)
    mesh.set_material(disc, wood_mat)
    # gnomon: a right-triangle fin standing on the disc, its sloped edge (the style) toward the top
    side = V((0, 0, 1)).cross(n).normalized()
    up = n.cross(side).normalized()
    base = c + n * (thick - 0.002)
    st = []
    for i in range(6):
        t = i / 5
        st.append({"p": base + up * radius * (-0.72 + 1.40 * t), "rx": 0.007 + 0.004 * t, "ry": 0.004 + gnomon * t,
                   "ry2": 0.002, "exp": 1.8})
    fin = mesh.loft(st, segments=6, caps=("point", "flat"), up=tuple(n), name=name + "_gnomon", col=col, rings=8)
    mesh.set_material(fin, accent_mat)
    return disc, fin
