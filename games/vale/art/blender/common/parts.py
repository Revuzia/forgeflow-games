"""VALE SHARED FIGHTER PARTS LIBRARY: every roster fighter composes from these pieces.

The 16 fighters differ by proportions, palette, which parts they wear and their parameters, NOT by
re-invented geometry. Every builder here follows ONE contract:

    parts.<builder>(ctx, ..., mat=<role>, accent=None|True|{...}, bevel=0.03, name=...) -> [fighter.Part]

  * materials by ROLE NAME from the bible vocabulary (`ctx.mats[role]`: chalk, stone, sandstone,
    ironstone, dawnglass, lampresin, wood, wood_dark, cloth, cloth2, under, leather, ink + extras
    the fighter adds), so skins are palette swaps. Never metal, gems, gold, gears or runes.
  * `bevel` = the rounded edge band in metres, the bible's 2-4 cm brushstroke (clamped to 2-4 cm
    and to 45 % of the form's thickness: thin cloth gets a rolled hem instead).
  * `accent` = the optional inlay slot in the `accent` material (a carved glass channel or fin,
    never a gem). True = the part's default placement; a dict overrides its knobs. The bible wants
    accents in the TOP HALF only (<= 5 % of the silhouette): builders that sit low (greaves,
    boots, skirts) log a warning when asked for one.
  * binding comes with each Part: rigid to a bone ('bone:head', 'bone:prop.R'), two-bone blends
    (('zblend'|'dblend', ...)), skinned ('auto' / 'transfer' = copy the body's weights) or an
    x_ chain (('chain', name, root)). Pass `bind=` to override where it makes sense.
  * drapery that sways (tabards, skirts, capes, the chain-lantern) ADDS its own x_ chain while
    modelling (<= 2 bones per drapery, bible "rigid drapery"); `chain_configs(ctx)` returns the
    matching secondary-motion settings (use it as the fighter's `chain_config`).
  * held props are modelled in PROP SPACE (grip at the origin, main axis +Z, front/edge toward -Y)
    and placed with `hand="R"|"L"` on prop.R / prop.L (`hand=None` keeps prop space: back carry,
    sheets). Weapon builders can add the VFX tip socket (`socket="x_blade_tip"`), which the
    fighter lists in SOCKETS (FighterArt.sockets.weapon_tip).

Conform targets default to `ctx.targets` (the body high plus anything the fighter appended:
collars, belts), so call order matters: body -> collar/mantle -> pauldrons -> belt -> drapery.

CATALOG (what exists; see art/renders/parts/sheet.png):
  faces      mask(style= oval | plate | slit | half | beak | keel)  visor(style= band | chimney | dome)
  head       hood(style= deep | peaked | wide)  cowl()  head_wrap()  crest_fin()  halo(style= disc | ring)
  shoulders  mantle(style= shawl | capelet)  stole()  collar()  pauldron(kind= stone | wood | cloth)
  limbs      bracer(kind= wood | stone | leather | wrap)  greave(kind= ironstone | wood) (+ knee block)
             glove(style= fingers | mitt | wrap, pose= fist | open)  boot(style=...) + boot_trim(...)
  waist      belt(buckle=, pouches=[...], lamp=)  pouch()  lamp()  strap()  satchel()
  drapery    tabard()  skirt()  cape()
  weapons    sword  greatblade  spear  staff  bow (+ quiver)  twin_blades  hammer  maul
             chain_lantern  focus_orb  round_shield  discs (thrown, + holster)  shards (thrown, + bandolier)
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from . import anim, kit, mesh, rig, scene
from .fighter import Part
from .mesh import Cylindrical, Spherical

V = Vector
FRONT = V((0.0, -1.0, 0.0))
UP = V((0.0, 0.0, 1.0))
BEVEL = 0.03                     # default rounded edge band (m): the bible's 2-4 cm brushstroke


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# helpers
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def bevel_w(bevel: float, thickness: float) -> float:
    """Bevel-modifier width for a visible `bevel` band (2-4 cm) on a form `thickness` thick."""
    if not bevel:
        return 0.0
    b = max(0.02, min(0.04, bevel))
    return max(0.002, min(0.5 * b, 0.45 * thickness))


def _m(ctx, mat):
    """Material by role name (ctx.mats) or a material object."""
    if mat is None or not isinstance(mat, str):
        return mat
    if mat not in ctx.mats:
        raise KeyError(f"material role {mat!r} not in ctx.mats ({sorted(ctx.mats)}); add it with extra_materials()")
    return ctx.mats[mat]


def _acc(accent, **defaults) -> dict | None:
    if not accent:
        return None
    d = dict(defaults)
    if isinstance(accent, dict):
        d.update(accent)
    return d


def _targets(ctx, target=None):
    if target is not None:
        return target
    return list(ctx.targets) if ctx.targets else ([ctx.body_high] if ctx.body_high else None)


def _reg(ctx) -> dict:
    """Per-build scratch registry on the context (belt object, chain roles, ...)."""
    r = ctx.__dict__.get("_parts")
    if r is None:
        r = ctx.__dict__["_parts"] = {"roles": {}}
    return r


def _H(ctx) -> float:
    return float(ctx.info.props["height"])


def _k(ctx) -> float:
    """Scale relative to the 1.9 m standard fighter."""
    return _H(ctx) / 1.9


def _warn_low(ctx, obj, what: str) -> None:
    zs = [(obj.matrix_world @ v.co).z for v in obj.data.vertices]
    if zs and sum(zs) / len(zs) < 0.5 * _H(ctx):
        msg = f"parts: accent on {what} sits in the bottom half (bible: accents in the top half only)"
        scene.log("WARNING " + msg)
        ctx.report.setdefault("warnings", []).append(msg)


def _xf(objs, M) -> None:
    for o in objs:
        o.data.transform(M)
        o.data.update()


def _set(o, ctx, mat):
    mesh.set_material(o, _m(ctx, mat))
    return o


def closed_tube(points, axis, rx, ry, *, segments: int = 8, exp: float = 3.0, name: str = "tube", col=None):
    """A closed tube through `points` (a loop, first != last) whose section is oriented by `axis`
    at every point (ry along the axis, rx across it): bands, rims, wraps. Frames are computed per
    point, so the seam never twists (parallel transport round a non-planar loop does)."""
    import bmesh
    pts = [V(p) for p in points]
    n = len(pts)
    a = V(axis).normalized()
    rxs = rx if isinstance(rx, (list, tuple)) else [rx] * n
    rys = ry if isinstance(ry, (list, tuple)) else [ry] * n
    sec = mesh._section(segments, 1.0, 1.0, 1.0, 1.0, exp)
    bm = bmesh.new()
    rings_ = []
    for i in range(n):
        T = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        N = (a - T * a.dot(T))
        N = N.normalized() if N.length > 1e-8 else T.orthogonal().normalized()
        B = T.cross(N).normalized()
        rings_.append([bm.verts.new(pts[i] + B * (x * rxs[i]) + N * (y * rys[i])) for x, y in sec])
    for i in range(n):
        r0, r1 = rings_[i], rings_[(i + 1) % n]
        for k in range(segments):
            k2 = (k + 1) % segments
            bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh.bm_to_obj(bm, name, col)


def ring(center, axis, radius: float, section=(0.012, 0.012), n: int = 24, name: str = "ring", col=None,
         ref=None, exp: float = 2.0):
    """Closed torus-like loop (bands, rims, wraps) around `axis` through `center`."""
    a = V(axis).normalized()
    r0 = V(ref) if ref is not None else (V((1, 0, 0)) if abs(a.x) < 0.9 else V((0, 1, 0)))
    e1 = (r0 - a * r0.dot(a)).normalized()
    e2 = a.cross(e1).normalized()
    rad = radius if callable(radius) else (lambda t, r=radius: r)
    pts = [V(center) + (e1 * math.cos(2 * math.pi * i / n) + e2 * math.sin(2 * math.pi * i / n)) * rad(i / n)
           for i in range(n)]
    return closed_tube(pts, a, section[1], section[0], exp=exp, name=name, col=col)


def surface_ring(proj: Cylindrical, v: float, target, lift: float, section=(0.012, 0.01), n: int = 24,
                 name: str = "band", col=None, u0: float = 0.0, u1: float = 360.0, wobble: float = 0.0):
    """A band hugging `target` around a Cylindrical projection at height/axis distance `v`
    (bracer straps, boot cuffs, wraps). section = (half width along the axis, radial thickness);
    u0/u1 < 360 makes an open arc (round caps)."""
    tree = mesh.bvh_of(target) if not hasattr(target, "ray_cast") else target
    closed = abs((u1 - u0) - 360.0) < 1e-6
    m = n
    pts = []
    for i in range(m if closed else m + 1):
        u = u0 + (u1 - u0) * i / m
        vv = v + wobble * math.sin(math.radians(u) * 2.0)
        pts.append(kit.surface(proj, u, vv, tree, lift + section[1] * 0.7))
    if closed:
        return closed_tube(pts, proj.a, section[1], section[0], name=name, col=col)
    return mesh.loft([{"p": p, "rx": section[1], "ry": section[0], "exp": 3.0} for p in pts], segments=8,
                     caps=("round", "round"), up=tuple(proj.a), name=name, col=col, rings=m + 1, smooth_path=False)


# ── chains (rigid drapery on <= 2 sway bones) ──────────────────────────────────────────────────
def _thigh_x(p, s):
    return p.get(f"thigh.{s}", (0.0, 0.0, 0.0))[0]


def _push_front(p):
    return 0.7 * max(0.0, _thigh_x(p, "L"), _thigh_x(p, "R"))


def _push_back(p):
    return 0.7 * max(0.0, -min(_thigh_x(p, "L"), _thigh_x(p, "R")))


def _push_cape(p):
    return 0.6 * max(0.0, -min(_thigh_x(p, "L"), _thigh_x(p, "R"))) + 1.2 * max(0.0, p.get("spine", (0, 0, 0))[0])


CHAIN_ROLES = {
    # role: ChainCfg kwargs (drive pushes the first bone, deg)
    "front": dict(gravity=0.8, stiffness=120.0, damping=13.0, inertia=0.7, drive=_push_front, limit=(-60.0, 60.0)),
    "back": dict(gravity=0.8, stiffness=110.0, damping=12.0, inertia=0.8, drive=_push_back, limit=(-60.0, 60.0)),
    "cape": dict(gravity=0.85, stiffness=80.0, damping=10.0, inertia=1.1, drive=_push_cape, limit=(-70.0, 70.0)),
    "hang": dict(gravity=1.0, stiffness=55.0, damping=7.0, inertia=1.4, drive=None, limit=(-85.0, 85.0), floor=0.06),
    "side": dict(gravity=0.7, stiffness=130.0, damping=14.0, inertia=0.5, drive=None, limit=(-45.0, 45.0)),
}


def chain_role(name: str) -> str:
    """Role of an x_ chain from its name (works for cached rigs too): *_f front, *_b back, cape*,
    *_hang, else side."""
    if name.startswith("cape"):
        return "cape"
    if name.endswith("_hang"):
        return "hang"
    if name.endswith("_f"):
        return "front"
    if name.endswith("_b"):
        return "back"
    return "side"


def add_chain(ctx, name: str, parent: str, top, bottom, bones: int = 1, z_hint=(0, -1, 0)) -> list:
    """An x_<name>_<i> chain from `top` to `bottom` (straight, `bones` <= 2) under `parent`.
    Name it with the role suffix (`_f`, `_b`, `cape`, `_hang`) so chain_configs() knows its motion."""
    if name in ctx.chains:
        return ctx.chains[name]
    assert 1 <= bones <= 2, "bible: <= 2 sway bones per drapery"
    top, bottom = V(top), V(bottom)
    pts = [top.lerp(bottom, i / bones) for i in range(bones + 1)]
    ctx.chains[name] = rig.add_chain(ctx.info, name, parent, pts, z_hint=z_hint)
    return ctx.chains[name]


def chain_configs(ctx, overrides: dict | None = None) -> list:
    """anim.ChainCfg for every x_ chain on the fighter, from the chain's role (see CHAIN_ROLES);
    `overrides` = {chain name: {ChainCfg kwargs}}. Use as the fighter's chain_config(ctx)."""
    out = []
    for nm, bones in ctx.chains.items():
        kw = dict(CHAIN_ROLES[chain_role(nm)])
        kw.update((overrides or {}).get(nm, {}))
        out.append(anim.ChainCfg(list(bones), **kw))
    return out


def _socket(ctx, socket: str | None, hand: str | None, tip: float) -> None:
    if not socket or not hand:
        return
    nm = socket if socket.startswith("x_") else f"x_{socket}"
    if nm in ctx.info.armature.data.bones:
        return
    rig.add_socket(ctx.info, nm, f"prop.{hand}", rig.prop_matrix(ctx.info, f"prop.{hand}") @ V((0, 0, tip)))


def place_prop(ctx, named_objs, hand: str | None, uv: float = 1.0, bind: str | None = None) -> list:
    """Prop-space objects -> Parts on prop.<hand> (hand None: stay in prop space, bind `bind`)."""
    objs = [o for _, o in named_objs]
    if hand:
        _xf(objs, rig.prop_matrix(ctx.info, f"prop.{hand}"))
        bind = bind or f"bone:prop.{hand}"
    return [Part(n, low=o, bind=bind or "bone:prop.R", uv_weight=uv) for n, o in named_objs]


def back_carry(ctx, objs, *, tilt: float = 35.0, side: str = "R", z: float | None = None, depth: float = 0.16):
    """Move prop-space objects onto the back (diagonal, handle over the `side` shoulder); bind
    'bone:chest'. Returns the matrix used."""
    J = ctx.info.joints
    zc = z if z is not None else J["spine1"].z + 0.06
    sx = -1.0 if side == "R" else 1.0
    M = (Matrix.Translation(V((0.0, J["spine1"].y + depth, zc))) @ Matrix.Rotation(math.radians(tilt * sx), 4, "Y")
         @ Matrix.Rotation(math.radians(180.0), 4, "Z"))
    _xf(objs, M)
    return M


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# FACES: carved masks (Serenade / Hourless) and glass visors (Aubade)
# ═══════════════════════════════════════════════════════════════════════════════════════════════
# outline rows (polar v from the crown, azimuth u half-span), facet keys (piecewise LINEAR: carved
# planes), eye recesses. v 88 ~ the eye line, 120+ the jaw. Facet keys are offsets in metres.
MASK_STYLES = {
    # smooth oval: soft planes, calm almond eyes, no keel (calm / Tender / Caster faces)
    "oval": dict(rows=[(46, -38, 38), (60, -66, 66), (88, -74, 74), (114, -62, 62), (138, -24, 24)],
                 fu=[(-90, -0.016), (-60, -0.007), (-30, -0.001), (0, 0.004), (30, -0.001), (60, -0.007), (90, -0.016)],
                 fv=[(40, -0.012), (62, 0.0), (76, 0.007), (90, -0.002), (104, 0.004), (122, 0.0), (142, -0.014)],
                 eyes=("almond", 25.0, 88.0, 12.0, 4.4, -0.10), depth=0.012, sharp=50.0, cols=22, rows_n=13),
    # angular plate: hard cheek planes, centre ridge, stern slanted slits (Breaker / Plinth faces)
    "plate": dict(rows=[(44, -58, 58), (58, -82, 82), (92, -86, 86), (120, -76, 76), (136, -42, 42)],
                  fu=[(-96, -0.034), (-56, -0.013), (-14, 0.003), (0, 0.012), (14, 0.003), (56, -0.013), (96, -0.034)],
                  fv=[(40, -0.02), (64, 0.0), (73, 0.017), (80, 0.010), (90, -0.006), (102, 0.004), (118, 0.0), (134, -0.018)],
                  eyes=("almond", 28.0, 88.5, 14.0, 3.4, -0.35), depth=0.016, sharp=12.0, cols=24, rows_n=15),
    # slit visor: a closed carved face with ONE horizontal eye slit (Striker / Hourless)
    "slit": dict(rows=[(42, -54, 54), (58, -80, 80), (92, -84, 84), (122, -72, 72), (140, -34, 34)],
                 fu=[(-96, -0.03), (-50, -0.010), (-8, 0.004), (0, 0.008), (8, 0.004), (50, -0.010), (96, -0.03)],
                 fv=[(38, -0.018), (62, 0.0), (78, 0.009), (86, 0.004), (94, 0.004), (108, 0.006), (124, -0.002), (142, -0.016)],
                 eyes=("slit", 46.0, 87.0, 3.2, 0.0, 0.0), depth=0.017, sharp=22.0, cols=26, rows_n=15),
    # half-mask with a heavy brow shelf: forehead to the cheekbones, nose guard (the jaw stays wrapped)
    "half": dict(rows=[(40, -48, 48), (56, -78, 78), (86, -84, 84), (100, -72, 72), (108, -30, 30), (113, -10, 10)],
                 fu=[(-96, -0.03), (-54, -0.010), (-12, 0.004), (0, 0.009), (12, 0.004), (54, -0.010), (96, -0.03)],
                 fv=[(36, -0.016), (60, 0.004), (70, 0.026), (77, 0.022), (84, 0.0), (98, 0.006), (114, 0.002)],
                 eyes=("almond", 27.0, 89.0, 13.5, 4.8, -0.28), depth=0.02, sharp=18.0, cols=24, rows_n=13),
    # beaked / long: an oval-plate face whose nose runs out into a long carved bill (facing cue)
    "beak": dict(rows=[(46, -44, 44), (60, -72, 72), (90, -78, 78), (116, -64, 64), (136, -26, 26)],
                 fu=[(-90, -0.022), (-56, -0.009), (-18, 0.001), (0, 0.006), (18, 0.001), (56, -0.009), (90, -0.022)],
                 fv=[(40, -0.014), (62, 0.0), (74, 0.012), (82, 0.006), (92, -0.004), (106, 0.002), (122, 0.0), (140, -0.016)],
                 eyes=("almond", 30.0, 87.0, 12.5, 3.6, -0.30), depth=0.015, sharp=20.0, cols=22, rows_n=13,
                 beak=dict(length=0.12, drop=0.5, root=0.036, width=0.03)),
    # keel: the look-dev reference face (plate planes + a short keel ridge down the centre line)
    "keel": dict(rows=[(48, -43, 43), (62, -72, 72), (88, -78, 78), (110, -72, 72), (140, -33, 33)],
                 fu=[(-88, -0.0144), (-58, -0.009), (-30, -0.002), (-9, 0.004), (0, 0.006), (9, 0.004), (30, -0.002),
                     (58, -0.009), (88, -0.0144)],
                 fv=[(43, -0.016), (62, -0.002), (74, 0.013), (81, 0.0078), (90, -0.004), (100, 0.004), (112, 0.0),
                     (124, -0.006), (145, -0.015)],
                 eyes=("almond", 25.0, 88.5, 15.0, 7.4, -0.25), depth=0.015, sharp=16.0, cols=22, rows_n=13,
                 keel=dict(v0=72.0, v1=114.0, height=0.032, width=0.017)),
}


def _recess(eyes, depth):
    kind, a, b, c, d, slant = eyes

    if kind == "slit":                     # a = half length (deg u), b = v, c = half height
        def f(u, v):
            du = max(0.0, abs(u) - (a - c * 1.6)) / (c * 1.6)
            dv = (v - b - 0.02 * abs(u)) / c
            d2 = du * du + dv * dv
            return depth * (1.0 - d2) ** 0.35 if d2 < 1.0 else 0.0
        return f

    eu, ev, ew, eh = a, b, c, d             # almond: centre u, v, half-width u, half-height v

    def g(u, v):
        du, dv = (abs(u) - eu) / ew, (v - ev - slant * (abs(u) - eu)) / eh
        d2 = du * du + dv * dv
        return depth * (1.0 - d2) ** 0.35 if d2 < 1.0 else 0.0
    return g


def _ink_lines(proj, tree, eyes, R, ink_mat, name, col):
    kind, a, b, c, d, slant = eyes
    out = []
    if kind == "slit":
        st = []
        n = 15
        for i in range(n):
            t = i / (n - 1)
            u = -a * 0.97 + 2 * a * 0.97 * t
            h = min(1.0, (1.0 - abs(2 * t - 1)) * 6.0) ** 0.6
            p = kit.surface(proj, u, b + 0.02 * abs(u), tree, 0.0015, outer=True)
            st.append({"p": p, "rx": max(0.0015, c * 0.85 * h * math.pi / 180.0 * R), "ry": 0.0025, "exp": 2.4})
        o, dd = proj.ray(0.0, b)
        e = mesh.loft(st, segments=8, caps=("point", "point"), up=tuple(dd), name=f"{name}_eye", col=col, rings=24)
        mesh.set_material(e, ink_mat)
        return [e]
    eu, ev, ew, eh = a, b, c, d
    for sgn in (1.0, -1.0):
        st = []
        k = 9
        for i in range(k):
            t = i / (k - 1)
            du = (-1.0 + 2.0 * t) * ew * 0.9
            u = sgn * (eu + du)
            p = kit.surface(proj, u, ev + slant * du, tree, 0.0015, outer=True)
            st.append({"p": p, "rx": max(0.0015, eh * 0.9 * math.sin(math.pi * t) ** 0.75 * math.pi / 180.0 * R),
                       "ry": 0.0025, "exp": 2.4})
        o, dd = proj.ray(sgn * eu, ev)
        e = mesh.loft(st, segments=8, caps=("point", "point"), up=tuple(dd), name=f"{name}_eye", col=col, rings=12)
        mesh.set_material(e, ink_mat)
        out.append(e)
    return out


def mask(ctx, style: str = "oval", *, mat="chalk", ink="ink", accent=None, target=None, lift: float = 0.016,
         thickness: float = 0.018, bevel: float = 0.02, scale: float = 1.0, eye_scale: float = 1.0,
         name: str = "mask", **over) -> list:
    """Carved mask over the front of the head (bind 'bone:head').

    style: oval (smooth, calm) | plate (angular planes, centre ridge, stern slits) | slit (closed
    face, one horizontal slit) | half (brow shelf to the cheekbones, nose guard) | beak (long carved
    bill) | keel (the reference: short keel ridge down the centre). `scale` widens the outline,
    `eye_scale` the recesses; any MASK_STYLES key can be overridden (rows, fu, fv, eyes, depth...).
    accent: a brow channel (kind='brow', default) or a centre stripe up the forehead (kind='stripe')."""
    if style not in MASK_STYLES:
        raise KeyError(f"mask style {style!r}: {sorted(MASK_STYLES)}")
    S = dict(MASK_STYLES[style])
    S.update(over)
    col, M = ctx.col, ctx.mats
    c, R0 = kit.head_frame(ctx.info)
    R = R0 + lift
    proj = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    rows = [(v, u0 * scale, u1 * scale) for v, u0, u1 in S["rows"]]
    eyes = S["eyes"]
    if eye_scale != 1.0:
        k, a, b, cc, d, sl = eyes
        eyes = (k, a * (eye_scale if k == "slit" else 1.0), b, cc * eye_scale, d * eye_scale, sl)
    rec = _recess(eyes, S["depth"])
    fu, fv = S["fu"], S["fv"]

    def r_fn(u, v, r):
        return r + kit.pwl(fu, u) + kit.pwl(fv, v) - rec(u, v)

    m = mesh.plate(proj, rows, target=_targets(ctx, target), r_fn=r_fn, offset=lift, thickness=thickness,
                   cols=S["cols"], rows_n=S["rows_n"], smooth_iters=8, rim=0.0, bevel_w=bevel_w(bevel, thickness) * 0.7,
                   bevel_segments=2, weighted=False, name=name, col=col, mat=_m(ctx, mat), inner=False)
    mesh.shade(m, True, sharp_angle=S["sharp"])
    mesh.weighted_normals(m)
    tree = mesh.bvh_of([m])
    m = mesh.join([m] + _ink_lines(proj, tree, eyes, R, _m(ctx, ink), name, col), name)
    _reg(ctx)["mask"] = m
    ctx.targets = list(ctx.targets or [ctx.body_high]) + [m]      # hoods and wraps conform over the mask
    out = [Part(name, low=m, bind="bone:head", uv_weight=1.8)]
    if S.get("keel"):
        kk = S["keel"]
        b = kit.mask_beak(ctx, _m(ctx, mat), m, v0=kk["v0"], v1=kk["v1"], height=kk["height"], width=kk["width"],
                          name=f"{name}_keel", col=col)
        out.append(Part(f"{name}_keel", low=b, bind="bone:head", uv_weight=1.4))
    if S.get("beak"):
        out.append(Part(f"{name}_beak", low=_long_beak(ctx, proj, tree, S["beak"], _m(ctx, mat), f"{name}_beak"),
                        bind="bone:head", uv_weight=1.4))
    a = _acc(accent, kind="brow", width=0.014, height=0.005)
    if a:
        tree = mesh.bvh_of([m])
        if a["kind"] == "stripe":
            uvs = [(0.0, 50.0 + 22.0 * i / 6) for i in range(7)]
        else:
            vb = next((v for v, _ in fv if v >= 70), 74) + 2.0
            uvs = [(-42 + 84 * i / 8, vb) for i in range(9)]
        inl = kit.inlay(proj, uvs, tree, M["accent"], width=a["width"], height=a["height"], name=f"{name}_inlay", col=col)
        out.append(Part(f"{name}_inlay", low=inl, bind="bone:head"))
    return out


def _long_beak(ctx, proj, tree, B, mat, name):
    """A long carved bill from the nose bridge, out and down (reads as facing from the game camera)."""
    L, drop, root, wid = B["length"] * _k(ctx), B["drop"], B["root"], B["width"]
    base = kit.surface(proj, 0.0, 84.0, tree, -0.006, outer=True)
    mid = kit.surface(proj, 0.0, 100.0, tree, -0.002, outer=True)
    st = [{"p": base, "rx": wid * 0.8, "ry": root * 0.6, "exp": 2.2},
          {"p": mid + FRONT * 0.010, "rx": wid, "ry": root, "ry2": root * 0.8, "exp": 2.0}]
    n = 5
    for i in range(1, n + 1):
        t = i / n
        p = mid + FRONT * (0.010 + L * t) + V((0, 0, -L * drop * t ** 1.6))
        st.append({"p": p, "rx": max(0.003, wid * (1 - 0.82 * t)), "ry": max(0.003, root * (1 - 0.85 * t)),
                   "ry2": max(0.002, root * 0.8 * (1 - 0.9 * t)), "exp": 2.0})
    b = mesh.loft(st, segments=10, caps=("round", "point"), up=(0, 0, 1), name=name, col=ctx.col, rings=16)
    mesh.set_material(b, mat)
    mesh.shade(b, True, sharp_angle=40)
    return b


def visor(ctx, style: str = "band", *, mat="dawnglass", frame="wood_dark", accent=None, target=None,
          lift: float = 0.006, bevel: float = 0.02, height: float = 0.30, width: float = 0.13, name: str = "visor") -> list:
    """Dawnglass visor (Aubade faces), bind 'bone:head'.
    band: a glass band across the eyes over the mask/head (`target`, default the body)
    chimney: a tall narrow glass pane before the face in a carved frame (vertical: crown read)
    dome: a glass bowl over the whole face with a carved rim.
    accent: a glass fin along the frame top (chimney) / an edge channel (band, dome)."""
    col = ctx.col
    c, R = kit.head_frame(ctx.info)
    proj = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    tgt = _targets(ctx, target)
    out = []
    if style == "band":
        if target is None and _reg(ctx).get("mask") is not None:
            tgt = [_reg(ctx)["mask"]]                     # over the carved mask when there is one
        vz = kit.glass_visor(ctx, _m(ctx, mat), tgt, v0=78.0, v1=97.0, lift=lift, thickness=0.012,
                             bevel_w=bevel_w(bevel, 0.012), name=name, col=col)
        out.append(Part(name, low=vz, bind="bone:head", uv_weight=1.2))
        if frame:
            tree = mesh.bvh_of([vz])
            for v, nm in ((77.0, "top"), (98.0, "bot")):
                fr = kit.inlay(proj, [(-80 + 160 * i / 12, v) for i in range(13)], tree, _m(ctx, frame), width=0.012,
                               height=0.006, taper=False, name=f"{name}_frame_{nm}", col=col)
                out.append(Part(f"{name}_frame_{nm}", low=fr, bind="bone:head"))
        a = _acc(accent, width=0.010, height=0.005)
        if a:
            tree = mesh.bvh_of([out[0].low])
            inl = kit.inlay(proj, [(-44 + 88 * i / 8, 79.5) for i in range(9)], tree, ctx.mats["accent"],
                            width=a["width"], height=a["height"], name=f"{name}_inlay", col=col)
            out.append(Part(f"{name}_inlay", low=inl, bind="bone:head"))
        return out
    if style == "chimney":
        k = _k(ctx)
        h, w = height * k, width * k
        tree = mesh.bvh_of(tgt)
        face = kit.surface(proj, 0.0, 92.0, tree, 0.03)
        z0 = c.z - 0.08 * k
        rows = [(z0, -w * 0.5, w * 0.5), (z0 + h * 0.5, -w * 0.52, w * 0.52), (z0 + h * 0.92, -w * 0.46, w * 0.46),
                (z0 + h, -w * 0.18, w * 0.18)]
        rows = [(z - z0, a, b) for z, a, b in rows]
        pane = mesh.slab(rows, thickness=0.016, cols=4, rows_n=10, bevel_w=bevel_w(bevel, 0.016), name=name, col=col,
                         mat=_m(ctx, mat))
        rails = []
        for sx in (-1, 1):
            rails.append(mesh.loft([{"p": (0, sx * w * 0.53, -0.01), "rx": 0.014, "ry": 0.016},
                                    {"p": (0, sx * w * 0.55, h * 0.5), "rx": 0.014, "ry": 0.016},
                                    {"p": (0, sx * w * 0.47, h * 0.92), "rx": 0.013, "ry": 0.015},
                                    {"p": (0, sx * w * 0.18, h + 0.012), "rx": 0.012, "ry": 0.014}],
                                   segments=8, caps=("round", "round"), up=(1, 0, 0), name=f"{name}_rail", col=col))
        sill = mesh.loft([{"p": (0, -w * 0.6, -0.012), "rx": 0.02, "ry": 0.016},
                          {"p": (0, w * 0.6, -0.012), "rx": 0.02, "ry": 0.016}], segments=8, caps=("round", "round"),
                         up=(1, 0, 0), name=f"{name}_sill", col=col, smooth_path=False)
        fr = mesh.join(rails + [sill], f"{name}_frame")
        mesh.set_material(fr, _m(ctx, frame or "wood_dark"))
        Mx = Matrix.Translation(V((0.0, face.y, z0))) @ Matrix.Rotation(math.radians(-90), 4, "Z")
        _xf([pane, fr], Mx)
        out += [Part(name, low=pane, bind="bone:head", uv_weight=1.2), Part(f"{name}_frame", low=fr, bind="bone:head")]
        a = _acc(accent, height=0.03)
        if a:
            p0 = V((0.0, face.y + 0.004, z0 + h + 0.016))
            fin = kit.crest([p0 + V((0, 0.03 * t - 0.015, 0.0)) for t in (0, 0.33, 0.66, 1.0)],
                            [0.004, a["height"], a["height"] * 0.9, 0.004], [0.006, 0.009, 0.009, 0.006],
                            ctx.mats["accent"], name=f"{name}_fin", col=col)
            out.append(Part(f"{name}_fin", low=fin, bind="bone:head"))
        return out
    if style == "dome":
        rows = [(50, -60, 60), (90, -80, 80), (126, -62, 62), (138, -30, 30)]
        Rd = R + 0.036 + lift

        def bowl(u, v, r):                                 # a smooth ellipsoid bowl (glass is never lumpy)
            return Rd * (1.0 + 0.12 * max(0.0, math.cos(math.radians(u))) * math.sin(math.radians(v)) ** 2)

        dm = mesh.plate(proj, rows, target=None, r_fn=bowl, offset=0.0, thickness=0.012, cols=22, rows_n=9,
                        smooth_iters=0, rim=0.014, rim_height=0.007, bevel_w=bevel_w(bevel, 0.012), bevel_segments=2,
                        name=name, col=col, mat=_m(ctx, mat), rim_mat=_m(ctx, frame or "wood_dark"), inner=True)
        out.append(Part(name, low=dm, bind="bone:head", uv_weight=1.2))
        a = _acc(accent, width=0.012, height=0.005)
        if a:
            tree = mesh.bvh_of([dm])
            inl = kit.inlay(proj, [(0.0, 54 + 14 * i / 4) for i in range(5)], tree, ctx.mats["accent"],
                            width=a["width"], height=a["height"], name=f"{name}_inlay", col=col)
            out.append(Part(f"{name}_inlay", low=inl, bind="bone:head"))
        return out
    raise KeyError(f"visor style {style!r}: band | chimney | dome")


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# HEAD: hoods, cowls, wraps, crest fins
# ═══════════════════════════════════════════════════════════════════════════════════════════════
HOOD_STYLES = {
    "deep": dict(open_deg=66.0, lift=0.034, peak=0.06, folds=5, fold_depth=0.011, v_end=126.0),
    "peaked": dict(open_deg=64.0, lift=0.032, peak=0.15, folds=5, fold_depth=0.010, v_end=124.0),
    "wide": dict(open_deg=74.0, lift=0.055, peak=0.03, folds=7, fold_depth=0.014, v_end=134.0),
}


def hood(ctx, style: str = "deep", *, mat="cloth2", rim="cloth2", accent=None, target=None, name: str = "hood",
         **over) -> list:
    """Heavy cloth hood, open at the face, sculpted folds, rolled hem (bind zblend neck->head).
    styles: deep (the reference) | peaked (tall point at the back of the crown) | wide (broad,
    loose, a big round crown read). accent: a crest fin over the crown (front -> back)."""
    S = dict(HOOD_STYLES[style])
    S.update(over)
    J = ctx.info.joints
    h = kit.hood(ctx, _m(ctx, mat), _m(ctx, rim), target=_targets(ctx, target), col=ctx.col, name=name, **S)
    hb = J["head_base"]
    out = [Part(name, low=h, bind=("zblend", "neck", "head", hb.z - 0.06, hb.z + 0.02), uv_weight=1.3)]
    a = _acc(accent, height=0.044, width=0.016)
    if a:
        out += crest_fin(ctx, [h], height=a["height"], width=a["width"], name=f"{name}_crest")
    return out


def crest_fin(ctx, target, *, height: float = 0.044, width: float = 0.016, v0: float = -34.0, v1: float = 50.0,
              mat="accent", name: str = "crest_fin") -> list:
    """A fin along the crown of `target` (hood, helm) from the brow (v0 < 0) over to the back (v1):
    the crown read from the gameplay camera; default material `accent` (the reference's crest)."""
    c, _ = kit.head_frame(ctx.info)
    hp = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    tree = mesh.bvh_of(target)
    pts, hts, wds = [], [], []
    for i in range(9):
        t = i / 8
        v = v0 + (v1 - v0) * t
        pts.append(kit.surface(hp, 0 if v < 0 else 180, abs(v) + 1e-3, tree, -0.004, outer=True))
        hts.append(0.010 + height * math.sin(math.pi * min(1.0, t * 1.08)) ** 0.7)
        wds.append(0.012 + width * math.sin(math.pi * t))
    fin = kit.crest(pts, hts, wds, _m(ctx, mat), name=name, col=ctx.col)
    return [Part(name, low=fin, bind="bone:head")]


def cowl(ctx, *, mat="cloth2", accent=None, target=None, thick: float = 0.036, depth: float = 0.036,
         name: str = "cowl") -> list:
    """A hood thrown back: a fat rolled cowl around the neck + the hood bunched at the nape
    (bind zblend chest->neck). accent: a glass toggle at the front."""
    J = ctx.info.joints
    nb = J["neck_base"]
    tgt = _targets(ctx, target)
    roll = kit.scarf(ctx, _m(ctx, mat), tgt, z=nb.z + 0.012, thick=thick, depth=depth, cowl=0.05, bunch=0.32,
                     bunches=5, back_rise=0.045, n=36, segments=10, name=name, col=ctx.col)
    axis = Cylindrical((0, nb.y + 0.02, 0), (0, 0, 1), ref=(0, -1, 0))
    rtree = mesh.bvh_of([roll])
    top = [kit.surface(axis, 180 - 62 + 124 * i / 6, nb.z + 0.02, rtree, -0.01, outer=True) for i in range(7)]
    back = kit.drape(top[::-1], 0.20 * _k(ctx), _m(ctx, mat), folds=2, fold_depth=0.016, flare=0.05, avoid=tgt,
                     clearance=0.03, hem=lambda u: 0.55 * (1 - abs(2 * u - 1)) ** 1.5, out_dir=(0, 1, 0),
                     thickness=0.02, name=f"{name}_back", col=ctx.col, rows=7, cols=8)
    bnd = ("zblend", "chest", "neck", nb.z - 0.07, nb.z + 0.04)
    out = [Part(name, low=roll, bind=bnd, uv_weight=1.1), Part(f"{name}_back", low=back, bind=bnd)]
    a = _acc(accent, size=0.026)
    if a:
        tree = mesh.bvh_of([roll])
        p = kit.surface(axis, 0.0, nb.z - 0.05, tree, 0.004, outer=True)
        tg = mesh.loft([{"p": p + V((0, 0, -a["size"])), "rx": 0.008, "ry": 0.008},
                        {"p": p, "rx": 0.012, "ry": 0.011}, {"p": p + V((0, 0, a["size"])), "rx": 0.008, "ry": 0.008}],
                       segments=8, caps=("point", "point"), up=(0, -1, 0), name=f"{name}_toggle", col=ctx.col)
        mesh.set_material(tg, ctx.mats["accent"])
        out.append(Part(f"{name}_toggle", low=tg, bind="bone:chest"))
    return out


def head_wrap(ctx, *, mat="cloth2", accent=None, target=None, bands: int = 5, tail: float = 0.22,
              name: str = "wrap") -> list:
    """Hourless head wrap: flat cloth bands wound around the skull with an eye gap, a knot and a
    short trailing tail at the back (bind 'bone:head'; the tail rides the neck). Wear it over a
    `mask(style='half')` or alone (the wrap IS the face)."""
    col = ctx.col
    c, R = kit.head_frame(ctx.info)
    tgt = _targets(ctx, target)
    tree = mesh.bvh_of(tgt)
    proj = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    # a cloth cap over the crown and the back of the skull (the face stays open between the bands)
    back = Spherical(c, up=(0, 0, 1), front=(0, 1, 0))
    cap = mesh.plate(back, [(0, -180, 180), (40, -180, 180), (72, -128, 128), (104, -100, 100)], target=tgt,
                     offset=0.010, thickness=0.012, cols=24, rows_n=8, smooth_iters=8, rim=0.0, bevel_w=0.004,
                     name=f"{name}_cap", col=col, mat=_m(ctx, mat), inner=False)
    objs = [cap]
    ctree = mesh.bvh_of(tgt + [cap])
    # wound bands: (front polar v, back polar v, half width m); each crosses the face higher or lower
    # than at the back (tilted), overlapping its neighbour, slightly twisted and tapered at the tuck
    plan = [(54, 30, 0.024), (68, 44, 0.023), (80, 58, 0.020), (108, 98, 0.026), (124, 112, 0.028)][:max(2, bands)]
    for i, (vf, vb, hw) in enumerate(plan):
        pts, wd = [], []
        n = 30
        ph = 40.0 * i
        for j in range(n):
            u = -180 + 360 * j / n
            t = 0.5 + 0.5 * math.cos(math.radians(u))            # 1 at the front, 0 at the back
            v = vb + (vf - vb) * t + 2.5 * math.sin(math.radians(u * 2 + ph))
            pts.append(kit.surface(proj, u, v, ctree, 0.005 + 0.002 * (i % 2)))
            wd.append(hw * (0.75 + 0.25 * math.cos(math.radians(u * 1.5 + ph)) ** 2))
        objs.append(closed_tube(pts, (0, 0, 1), 0.006, wd, exp=3.2, name=f"{name}_{i}", col=col))
    knot_p = kit.surface(proj, 180.0, 96.0, tree, 0.03)
    knot = mesh.loft([{"p": knot_p + V((0, -0.01, 0.02)), "rx": 0.03, "ry": 0.02},
                      {"p": knot_p + V((0, 0.012, 0.0)), "rx": 0.034, "ry": 0.026},
                      {"p": knot_p + V((0, 0.0, -0.025)), "rx": 0.022, "ry": 0.018}], segments=10,
                     caps=("round", "round"), up=(0, 1, 0), name=f"{name}_knot", col=col)
    objs.append(knot)
    w = mesh.join(objs, name)
    mesh.set_material(w, _m(ctx, mat))
    out = [Part(name, low=w, bind="bone:head", uv_weight=1.2)]
    if tail > 0:
        tp = knot_p + V((0, 0.02, -0.02))
        top = [tp + V((x, 0, 0)) for x in (-0.03, -0.01, 0.01, 0.03)]
        tl = kit.drape(top, tail * _k(ctx), _m(ctx, mat), folds=1, fold_depth=0.006, flare=0.03, out_dir=(0, 1, 0),
                       thickness=0.012, hem=lambda u: 0.25 * abs(2 * u - 1), name=f"{name}_tail", col=col, rows=5, cols=4)
        hb = ctx.info.joints["head_base"]
        out.append(Part(f"{name}_tail", low=tl, bind=("zblend", "neck", "head", hb.z - 0.10, hb.z + 0.0)))
    a = _acc(accent, width=0.012, height=0.005)
    if a:
        inl = kit.inlay(proj, [(-36 + 72 * i / 6, 70.0) for i in range(7)], mesh.bvh_of([w]), ctx.mats["accent"],
                        width=a["width"], height=a["height"], name=f"{name}_inlay", col=col)
        out.append(Part(f"{name}_inlay", low=inl, bind="bone:head"))
    return out


def halo(ctx, style: str = "disc", *, radius: float = 0.20, mat="dawnglass", rim="wood_dark", back: float = 0.17,
         lift: float = 0.06, tilt: float = 0.0, accent=None, name: str = "halo") -> list:
    """The Caster's DISC read: a carved dawnglass dial disc standing behind the head (disc) or an
    open carved ring (ring), `back` m behind the head centre, tilted `tilt` deg; bind 'bone:head'.
    accent: an inlay ring on its face (crown height: top half by construction)."""
    col = ctx.col
    hc, _ = kit.head_frame(ctx.info)
    k = _k(ctx)
    cen = hc + V((0, back * k, lift * k))
    R = radius * k
    objs = []
    if style == "disc":
        d = mesh.loft([{"p": cen + V((0, -0.012, 0)), "rx": R, "ry": R, "exp": 2.0},
                       {"p": cen + V((0, 0.012, 0)), "rx": R, "ry": R, "exp": 2.0}], segments=32, caps=("flat", "flat"),
                      up=(0, 0, 1), name=name, col=col, smooth_path=False, rings=2)
        mesh.bevel(d, 0.008, 2, angle=30)
        mesh.set_material(d, _m(ctx, mat))
        objs.append((name, d))
        if rim:
            r_ = ring(cen, (0, 1, 0), R + 0.004, section=(0.016, 0.012), n=40, name=f"{name}_rim", col=col)
            mesh.set_material(r_, _m(ctx, rim))
            objs.append((f"{name}_rim", r_))
    else:
        r_ = ring(cen, (0, 1, 0), R, section=(0.016, 0.022), n=40, name=name, col=col)
        mesh.set_material(r_, _m(ctx, rim or mat))
        objs.append((name, r_))
    a = _acc(accent, r=0.85)
    if a:
        o = ring(cen + V((0, -0.016 if style == "disc" else -0.02, 0)), (0, 1, 0), R * a["r"], section=(0.004, 0.009), n=36,
                 name=f"{name}_inlay", col=col)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    if tilt:
        M = Matrix.Translation(cen) @ Matrix.Rotation(math.radians(tilt), 4, "X") @ Matrix.Translation(-cen)
        _xf([o for _, o in objs], M)
    return [Part(n, low=o, bind="bone:head", uv_weight=0.8) for n, o in objs]


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# SHOULDERS: mantles, stoles, collars, pauldrons
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def collar(ctx, *, mat="cloth2", target=None, thick: float = 0.032, depth: float = 0.046, cowl: float = 0.045,
           name: str = "collar") -> list:
    """A rolled heavy-linen scarf gathered around the neck (the reference collar). Appends itself
    to ctx.targets (pauldrons and straps then sit over it). Bind zblend chest->neck."""
    nb = ctx.info.joints["neck_base"]
    o = kit.scarf(ctx, _m(ctx, mat), _targets(ctx, target), z=nb.z - 0.004, lift=0.0, thick=thick, depth=depth,
                  cowl=cowl, bunch=0.12, bunches=6, n=36, segments=10, name=name, col=ctx.col)
    ctx.targets = list(ctx.targets or [ctx.body_high]) + [o]
    return [Part(name, low=o, bind=("zblend", "chest", "neck", nb.z - 0.07, nb.z + 0.03), uv_weight=1.1)]


def mantle(ctx, style: str = "shawl", *, mat="cloth2", rim=None, accent=None, target=None, bevel: float = 0.02,
           name: str = "mantle") -> list:
    """Heavy cloth over the neck and shoulders, sculpted folds hanging from the collar, a cowl dip
    at the chest. shawl: to the upper chest | capelet: to mid-chest, flared over the shoulders
    (Tender/Caster mass). Appends itself to ctx.targets. Bind zblend chest->neck.
    accent: a sundial clasp at the front (wood dial + glass gnomon)."""
    J = ctx.info.joints
    nb = J["neck_base"]
    v_bot, flare, folds = {"shawl": (64.0, 0.022, 9), "capelet": (84.0, 0.05, 11)}[style]
    c = V((0.0, nb.y + 0.02, nb.z - 0.15 * _k(ctx)))
    proj = Spherical(c, up=(0, 0, 1), front=(0, -1, 0))
    v_top = 30.0

    def shape(u, v, r):
        t = mesh.smoothstep(v_top + 6, v_bot, v)
        f = 0.02 * abs(math.sin(math.radians(u) * folds * 0.5)) ** 0.7 * t
        cw = 0.03 * max(0.0, math.cos(math.radians(u))) ** 3 * mesh.smoothstep(v_top, v_top + 20, v) * (1 - t)
        return f + flare * t * t + cw

    o = mesh.plate(proj, [(v_top, -180, 180), ((v_top + v_bot) * 0.5, -180, 180), (v_bot, -180, 180)],
                   target=_targets(ctx, target), offset=0.028, thickness=0.022, cols=36, rows_n=9, smooth_iters=10,
                   wrap=True, shape_fn=shape, rim=0.014, rim_height=0.006, bevel_w=bevel_w(bevel, 0.022) * 0.4,
                   bevel_segments=1, name=name, col=ctx.col, mat=_m(ctx, mat), rim_mat=_m(ctx, rim or mat), inner=True)
    ctx.targets = list(ctx.targets or [ctx.body_high]) + [o]
    out = [Part(name, low=o, bind=("zblend", "chest", "neck", nb.z - 0.10, nb.z + 0.03), uv_weight=1.2)]
    a = _acc(accent, radius=0.05)
    if a:
        out += clasp(ctx, u=0.0, z=nb.z - 0.06, radius=a["radius"], target=[o])
    return out


def clasp(ctx, *, u: float = 22.0, z: float | None = None, radius: float = 0.055, wood="wood_dark", target=None,
          name: str = "clasp") -> list:
    """The sundial clasp: a carved wood dial with a glass gnomon fin (accent), on the chest at
    azimuth `u` (0 = front centre) and height `z`. Bind 'bone:chest'."""
    J = ctx.info.joints
    zc = z if z is not None else J["spine1"].z + 0.10
    axis = Cylindrical((0, 0, 0), (0, 0, 1), ref=(0, -1, 0))
    cp = kit.surface(axis, u, zc, mesh.bvh_of(_targets(ctx, target)), 0.004)
    n = (cp - V((0, 0, zc))).normalized()
    disc, gn = kit.sundial_clasp(ctx, _m(ctx, wood), ctx.mats["accent"], cp, n, radius=radius, thick=0.022,
                                 gnomon=radius * 0.9, name=name, col=ctx.col)
    return [Part(name, low=disc, bind="bone:chest"), Part(f"{name}_gnomon", low=gn, bind="bone:chest")]


def stole(ctx, *, mat="cloth", accent=None, target=None, length: float = 0.55, width: float = 0.10,
          name: str = "stole") -> list:
    """A long heavy cloth stole: a band behind the neck whose two ends fall down the chest to the
    belt (Tender/Caster line). The ends bend with the spine (bind zblend spine->chest).
    accent: a glass weight-bar across each end's top."""
    J = ctx.info.joints
    nb, s1 = J["neck_base"], J["spine1"]
    tgt = _targets(ctx, target)
    band = kit.scarf(ctx, _m(ctx, mat), tgt, z=nb.z - 0.012, thick=0.022, depth=0.03, cowl=0.03, bunch=0.06,
                     bunches=4, back_rise=0.02, n=32, segments=8, name=f"{name}_band", col=ctx.col)
    axis = Cylindrical((0, 0, 0), (0, 0, 1), ref=(0, -1, 0))
    tree = mesh.bvh_of(tgt + [band])
    out = [Part(f"{name}_band", low=band, bind=("zblend", "chest", "neck", nb.z - 0.07, nb.z + 0.03))]
    z0 = nb.z - 0.05
    for s, u in (("L", 24.0), ("R", -24.0)):
        du = math.degrees(width / 0.16) * 0.5
        top = [kit.surface(axis, u - du + 2 * du * i / 4, z0, tree, 0.008) for i in range(5)]
        if s == "R":
            top = top[::-1]
        d = mesh.cloth_panel(top, length * _k(ctx), folds=1, fold_depth=0.008, flare=0.02, out_dir=(0, -1, 0),
                             avoid=tgt, clearance=0.024, thickness=0.016, name=f"{name}.{s}", col=ctx.col, seed=len(s),
                             fold_sharp=0.4, hem_bevel=0.006, rows=8, cols=4, hem=lambda t: 0.10 * (1 - abs(2 * t - 1)))
        mesh.set_material(d, _m(ctx, mat))
        out.append(Part(f"{name}.{s}", low=d, bind=("zblend", "spine", "chest", s1.z - 0.10, s1.z + 0.05)))
        a = _acc(accent, width=0.012)
        if a:
            st = mesh.bvh_of([d])
            bar = [kit.surface(axis, u - du * 0.8 + 1.6 * du * i / 4, z0 - 0.06, st, 0.002, outer=True) for i in range(5)]
            inl = mesh.loft([{"p": p, "rx": a["width"] * 0.5, "ry": 0.005, "ry2": 0.003, "exp": 3.0} for p in bar],
                            segments=6, caps=("round", "round"), up=(0, -1, 0), name=f"{name}_inlay.{s}", col=ctx.col)
            mesh.set_material(inl, ctx.mats["accent"])
            out.append(Part(f"{name}_inlay.{s}", low=inl, bind="bone:chest"))
    return out


def pauldron(ctx, kind: str = "stone", *, sides=("L", "R"), mat=None, accent=None, target=None, size: float = 1.0,
             thickness: float | None = None, bevel: float = 0.035, lames: int = 3, name: str = "pauldron") -> list:
    """Shoulder armour in the bible's materials; bind dblend shoulder -> upper_arm.
    kind: stone (thick honed slab, the Breaker/Plinth mass; the reference) | wood (carved lames,
          `lames` overlapping plates down the arm) | cloth (layered quilted pads with rolled edges).
    size scales the reach; accent: a channel along the slab ridge / the top lame / the pad seam.
    Pass sides=('L',) for an asymmetric silhouette (facing read from above)."""
    out = []
    mat = mat or {"stone": "stone", "wood": "wood", "cloth": "cloth"}[kind]
    tgt = _targets(ctx, target)
    for s in sides:
        nm = f"{name}.{s}"
        sx = 1.0 if s == "L" else -1.0
        if kind == "stone":
            th = thickness or 0.04
            o, proj, bnd = kit.slab_pauldron(ctx, s, _m(ctx, mat), tgt, size=size, lift=0.034, thickness=th,
                                             bevel_w=bevel_w(bevel, th), flare=0.024 * size, tilt=0.6, v_end=56.0 * size,
                                             ridge=0.014, name=nm, col=ctx.col)
            out.append(Part(nm, low=o, bind=bnd, uv_weight=1.2))
            surf = [o]
            uvs = [(0 if t < 0 else 180, abs(t) + 1e-3) for t in [-44 + 88 * i / 8 for i in range(9)]]
            aw = 0.062
        else:
            J = ctx.info.joints
            sh = J[f"shoulder.{s}"]
            c = sh + V((-0.03 * sx, 0.0, -0.03))
            up = V(((0.55 if kind == "wood" else 0.5) * sx, 0.0, 1.0)).normalized()
            proj = Spherical(c, up=up, front=(0, -1, 0))
            lo, hi = (-75.0, 255.0) if sx > 0 else (-255.0, 75.0)
            th = thickness or (0.022 if kind == "wood" else 0.03)
            bnd = ("dblend", f"shoulder.{s}", f"upper_arm.{s}", tuple(c), tuple(-up), 0.04, 0.13)
            plates = []
            n = max(1, lames if kind == "wood" else 2)
            for k in range(n):
                v0 = 0.0 if k == 0 else 22.0 + 18.0 * (k - 1)
                v1 = (36.0 if k == 0 else v0 + 26.0) * size
                off = (0.034 + 0.016 * k) * size

                def shp(u, v, r, k=k, v0=v0, v1=v1):
                    kk = math.cos(math.radians(u - 90.0 * sx))
                    fl = 0.018 * mesh.smoothstep(v0 + (v1 - v0) * 0.5, v1, v) * (0.5 + 0.5 * max(0.0, kk))
                    if kind == "cloth":
                        fl += 0.006 * abs(math.sin(math.radians(u) * 4.0)) ** 0.7 * mesh.smoothstep(v0, v1, v)
                    return fl

                rows = [(v0, lo, hi), ((v0 + v1) * 0.5, lo, hi), (v1, lo + 8 * sx, hi - 8 * sx)]
                p = mesh.plate(proj, rows, target=tgt if k == 0 else tgt + plates, offset=off, thickness=th, cols=20,
                               smooth_iters=16, rows_n=5, shape_fn=shp, rim=0.012 if kind == "cloth" else 0.0,
                               rim_height=0.006, bevel_w=bevel_w(bevel, th), bevel_segments=2, name=f"{nm}_{k}",
                               col=ctx.col, mat=_m(ctx, mat), inner=True)
                plates.append(p)
            o = mesh.join(plates, nm)
            out.append(Part(nm, low=o, bind=bnd, uv_weight=1.2))
            surf = [plates[0]]
            uvs = [(0 if t < 0 else 180, abs(t) + 1e-3) for t in [-36 + 72 * i / 8 for i in range(9)]]
            aw = 0.04
        a = _acc(accent, width=aw, height=0.006)
        if a:
            inl = kit.inlay(proj, uvs, surf, ctx.mats["accent"], width=a["width"], height=a["height"], lift=-0.001,
                            name=f"{nm}_inlay", col=ctx.col)
            out.append(Part(f"{nm}_inlay", low=inl, bind=bnd))
    return out


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# LIMBS: bracers, greaves, gloves, boots
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def bracer(ctx, kind: str = "wood", *, sides=("L", "R"), mat=None, accent=None, target=None, t0: float = 0.22,
           t1: float = 0.97, thickness: float | None = None, bevel: float = 0.025, straps: int | None = None,
           name: str = "bracer") -> list:
    """Forearm armour, bind 'bone:forearm.X'.
    kind: wood (carved ash shell, flared cuff) | stone (thick slab shell with a ridge) |
          leather (thin shell + strap bands) | wrap (cloth bands spiralled round the forearm).
    accent: a channel along the outer face (bracers hang at mid height in idle: use sparingly)."""
    out = []
    J = ctx.info.joints
    tgt = _targets(ctx, target)
    mat = mat or {"wood": "wood", "stone": "stone", "leather": "leather", "wrap": "cloth2"}[kind]
    for s in sides:
        nm = f"{name}.{s}"
        a_, b_ = J[f"elbow.{s}"], J[f"wrist.{s}"]
        L = (b_ - a_).length
        cyl = Cylindrical(a_, (b_ - a_).normalized(), ref=(0, 0, 1))
        objs = []
        if kind == "wrap":
            tree = mesh.bvh_of(tgt)
            n = straps or 6
            for i in range(n):
                v = L * (t0 + (t1 - t0) * (i + 0.5) / n)
                objs.append(surface_ring(cyl, v, tree, 0.002 + 0.002 * (i % 2), section=(L * (t1 - t0) / n * 0.62, 0.005), n=20,
                                         name=f"{nm}_w{i}", col=ctx.col, wobble=0.012))
        else:
            th = thickness or {"wood": 0.022, "stone": 0.03, "leather": 0.012}[kind]
            sh = kit.limb_shell(ctx, f"elbow.{s}", f"wrist.{s}", _m(ctx, mat), tgt, t0=t0, t1=t1, lift=0.012,
                                thickness=th, bevel_w=bevel_w(bevel, th), flare=0.022, ridge=0.012 if kind == "stone" else 0.0,
                                cols=16, name=nm, col=ctx.col)
            objs.append(sh)
            if kind in ("wood", "stone"):                  # carved lips: the bracer reads as a cuff, not a sleeve
                tree = mesh.bvh_of([sh])
                for t, w_ in ((t0 + 0.02, 0.012), (t1 - 0.025, 0.016)):
                    objs.append(surface_ring(cyl, L * t, tree, -0.004, section=(w_, th * 0.55), n=22,
                                             name=f"{nm}_lip", col=ctx.col))
            if kind == "leather" or straps:
                tree = mesh.bvh_of([sh])
                for i in range(straps or 2):
                    v = L * (t0 + (t1 - t0) * (0.25 + 0.5 * i / max(1, (straps or 2) - 1)))
                    st = surface_ring(cyl, v, tree, 0.0, section=(0.011, 0.005), n=20, name=f"{nm}_s{i}", col=ctx.col)
                    mesh.set_material(st, _m(ctx, "wood_dark" if kind == "leather" else "leather"))
                    out.append(Part(f"{nm}_s{i}", low=st, bind=f"bone:forearm.{s}"))
        o = mesh.join(objs, nm)
        mesh.set_material(o, _m(ctx, mat))
        out.insert(0, Part(nm, low=o, bind=f"bone:forearm.{s}"))
        a = _acc(accent, width=0.016)
        if a:
            tree = mesh.bvh_of([o])
            out_dir = 90.0 if s == "L" else -90.0
            pts = [kit.surface(cyl, out_dir, L * (t0 + 0.12 + (t1 - t0 - 0.24) * i / 6), tree, 0.002, outer=True)
                   for i in range(7)]
            inl = mesh.loft([{"p": p, "rx": a["width"] * 0.5, "ry": 0.005, "ry2": 0.003, "exp": 3} for p in pts],
                            segments=6, caps=("round", "round"), up=tuple(cyl.ray(out_dir, 0)[1]), name=f"{nm}_inlay",
                            col=ctx.col)
            mesh.set_material(inl, ctx.mats["accent"])
            out.append(Part(f"{nm}_inlay", low=inl, bind=f"bone:forearm.{s}"))
            _warn_low(ctx, inl, nm)
    return out


def greave(ctx, kind: str = "ironstone", *, sides=("L", "R"), mat=None, knee: bool = True, target=None,
           thickness: float = 0.024, bevel: float = 0.025, accent=None, name: str = "greave") -> list:
    """Shin plate (front arc, centre ridge) + optional knee block; bind 'bone:shin.X'.
    kind: ironstone (the dark feet band; reference) | wood (carved). No accent here (bottom half)."""
    out = []
    J = ctx.info.joints
    mat = mat or kind
    tgt = _targets(ctx, target)
    if accent:
        scene.log("WARNING parts.greave: accents belong in the top half; ignoring accent")
    for s in sides:
        gr = kit.limb_shell(ctx, f"knee.{s}", f"ankle.{s}", _m(ctx, mat), tgt, t0=0.14, t1=0.78, arc=105.0,
                            ref=(0, -1, 0), lift=0.016, thickness=thickness, bevel_w=bevel_w(bevel, thickness), flare=0.012,
                            ridge=0.012, cols=10, name=f"{name}.{s}", col=ctx.col)
        out.append(Part(f"{name}.{s}", low=gr, bind=f"bone:shin.{s}"))
        if knee:
            kn = J[f"knee.{s}"]
            kp = Spherical(kn + V((0, 0.03, 0.01)), up=(0, -1, 0.2), front=(0, 0, 1))
            hi = ctx.body_high or tgt[0]
            R = (mesh._surface_r(mesh.bvh_of([hi]), *kp.ray(0, 0), 0.3) or 0.08) + 0.02
            kc = mesh.plate(kp, [(0, -180, 180), (30, -180, 180), (58, -180, 180)], target=None,
                            r_fn=lambda u, v, r, R=R: R * (1.0 + 0.10 * math.cos(math.radians(u)) ** 2 *
                                                           mesh.smoothstep(20, 58, v)),
                            offset=0.0, thickness=thickness, cols=16, rows_n=6, smooth_iters=0, wrap=True, rim=0.0,
                            bevel_w=bevel_w(bevel, thickness), bevel_segments=2, name=f"knee.{s}", col=ctx.col,
                            mat=_m(ctx, mat))
            out.append(Part(f"knee.{s}", low=kc, bind=f"bone:shin.{s}"))
    return out


def glove(ctx, style: str = "fingers", *, sides=("L", "R"), pose: str = "fist", mat="leather", cuff_mat=None,
          scale: float = 1.45, cuff: bool = True, grip_r: float = 0.024, accent=None, name: str = "glove") -> list:
    """Hands as separate pieces (set SHAPE hands=False on the body), bind 'bone:hand.X' (cuff on
    the forearm). Built for 96 px: chunky, readable, no thin digits.
    style: fingers (four real fingers + thumb) | mitt (one fused finger block + thumb: the
           chunkiest read) | wrap (fingers bound in cloth strips; mat='cloth2')
    pose: fist (curled round the prop axis: weapons, `grip_r` = handle radius) | open (a casting
          hand, fingers spread and slightly curled; holds nothing).
    accent: a glass channel across the back of the cuff."""
    out = []
    info = ctx.info
    J = info.joints
    k = _k(ctx) * scale / 1.45
    for s in sides:
        nm = f"{name}.{s}"
        wr, kn = J[f"wrist.{s}"], J[f"knuckle.{s}"]
        d = (kn - wr).normalized()
        pn = J[f"palm_n.{s}"]
        fr = (FRONT - d * FRONT.dot(d)).normalized()                 # thumb side / grip axis
        L = info.props["hand"] * scale
        objs = []
        back = -pn
        palm = mesh.loft([{"p": wr - d * 0.006 + back * 0.004, "rx": 0.026 * k, "ry": 0.036 * k, "exp": 2.6},
                          {"p": wr + d * L * 0.24 + back * 0.004, "rx": 0.025 * k, "ry": 0.045 * k, "exp": 3.2},
                          {"p": wr + d * L * 0.40 + back * 0.002, "rx": 0.023 * k, "ry": 0.044 * k, "exp": 3.4}],
                         segments=14, caps=("round", "round"), up=tuple(fr), name=f"{nm}_palm", col=ctx.col, cap_len=0.6)
        objs.append(palm)
        P = wr + d * L * 0.40 + pn * 0.022                         # prop bone head: the grip axis passes here
        offs = [0.033, 0.0115, -0.0095, -0.029]
        radii = [0.0104, 0.0110, 0.0104, 0.0094]
        lens = [1.0, 1.06, 1.0, 0.86]
        if style == "mitt":
            offs, radii, lens = [0.002], [0.0135], [1.0]
        for i, (o_, r_, l_) in enumerate(zip(offs, radii, lens)):
            o_, r_ = o_ * k, r_ * k
            K = wr + d * L * 0.42 + fr * o_ + back * 0.006
            if pose == "fist":
                C = P + fr * o_
                rel = K - C
                x, y = rel.dot(d), rel.dot(pn)
                th0 = math.atan2(y, x)
                rho0 = max(rel.length, grip_r + r_ + 0.002)
                sweep = math.radians(205.0 * l_)
                pts = []
                for j in range(8):
                    t = j / 7
                    th = th0 + sweep * t
                    rho = rho0 * (1.0 - 0.10 * t)
                    pts.append(C + (d * math.cos(th) + pn * math.sin(th)) * rho)
                pts[0] = K
            else:
                spread = math.radians((-1.5 + i) * 7.0) if style != "mitt" else 0.0
                fd = (Matrix.Rotation(spread, 3, pn) @ d).normalized()
                ln = L * 0.55 * l_
                pts = [K + fd * ln * t + pn * (0.03 * k * t * t) for t in (0, 0.25, 0.5, 0.75, 1.0)]
            if style == "mitt":
                st = [{"p": p, "rx": r_ * (1.0 - 0.15 * j / (len(pts) - 1)), "ry": 0.044 * k, "exp": 3.2}
                      for j, p in enumerate(pts)]
                up = fr
            else:
                st = [{"p": p, "rx": r_ * (1.0 - 0.22 * j / (len(pts) - 1)), "ry": r_ * (1.05 - 0.22 * j / (len(pts) - 1)),
                       "exp": 2.4} for j, p in enumerate(pts)]
                up = fr
            f = mesh.loft(st, segments=10 if style != "mitt" else 14, caps=("round", "round"), up=tuple(up),
                          name=f"{nm}_f{i}", col=ctx.col, rings=12, cap_len=0.8)
            objs.append(f)
        # thumb: from the heel of the palm over the front of the grip
        t0 = wr + d * L * 0.10 + fr * 0.030 * k + pn * 0.010 * k
        t1 = wr + d * L * 0.26 + fr * 0.046 * k + pn * 0.026 * k
        t2 = (wr + d * L * 0.40 + fr * 0.040 * k + pn * 0.050 * k) if pose == "fist" else \
            (wr + d * L * 0.38 + fr * 0.075 * k + pn * 0.030 * k)
        thumb = mesh.loft([{"p": t0, "rx": 0.017 * k, "ry": 0.019 * k}, {"p": t1, "rx": 0.015 * k, "ry": 0.016 * k},
                           {"p": t2, "rx": 0.013 * k, "ry": 0.013 * k}], segments=10, caps=("round", "round"),
                          up=tuple(pn), name=f"{nm}_thumb", col=ctx.col, cap_len=0.8)
        objs.append(thumb)
        if style == "wrap":
            for i, z in enumerate((0.12, 0.30)):
                objs.append(ring(wr + d * L * z + back * 0.002, d, 0.040 * k, section=(0.012, 0.005), n=16,
                                 name=f"{nm}_band{i}", col=ctx.col, ref=fr))
        g = mesh.join(objs, nm)
        mesh.set_material(g, _m(ctx, mat))
        out.append(Part(nm, low=g, bind=f"bone:hand.{s}", uv_weight=1.2))
        if cuff:
            d2 = J[f"forearm_dir.{s}"]
            cf = mesh.loft([{"p": wr - d2 * 0.085, "rx": 0.052 * k, "ry": 0.046 * k},
                            {"p": wr - d2 * 0.03, "rx": 0.056 * k, "ry": 0.05 * k},
                            {"p": wr + d2 * 0.004, "rx": 0.064 * k, "ry": 0.058 * k}], segments=16,
                           caps=(None, None), up=(0, -1, 0), name=f"{nm}_cuff", col=ctx.col, rings=4, smooth_path=False)
            mesh.solidify(cf, 0.008, offset=1.0)
            mesh.bevel(cf, 0.003, 1, angle=40)
            mesh.set_material(cf, _m(ctx, cuff_mat or mat))
            out.append(Part(f"{nm}_cuff", low=cf, bind=f"bone:forearm.{s}"))
            a = _acc(accent, width=0.012)
            if a:
                tree = mesh.bvh_of([cf])
                cyl = Cylindrical(wr, -d2, ref=(0, -1, 0))
                pts = [kit.surface(cyl, -50 + 100 * i / 6, 0.05, tree, 0.002, outer=True) for i in range(7)]
                inl = mesh.loft([{"p": p, "rx": a["width"] * 0.5, "ry": 0.005, "ry2": 0.003, "exp": 3} for p in pts],
                                segments=6, caps=("round", "round"), up=tuple(-d2), name=f"{nm}_inlay", col=ctx.col)
                mesh.set_material(inl, ctx.mats["accent"])
                out.append(Part(f"{nm}_inlay", low=inl, bind=f"bone:forearm.{s}"))
    return out


BOOT_STYLES = {
    # body.boot kwargs: cuff height (m at 1.9 m), width multiplier, toe lift
    "heavy": dict(height=0.36, width=1.3, toe_up=0.004),
    "tall": dict(height=0.46, width=1.22, toe_up=0.002),
    "wrapped": dict(height=0.30, width=1.15, toe_up=0.0),
    "low": dict(height=0.22, width=1.18, toe_up=0.006),
}


def boot(ctx, side: str, style: str = "heavy", **over):
    """Boot SHAPE for the body union (returns the object, like body.boot): append it to the
    body parts before mesh.union_fillet so it fuses and skins with the legs. Pair with boot_trim()."""
    from . import body
    S = dict(BOOT_STYLES[style])
    S.update(over)
    return body.boot(ctx.info, side, col=ctx.col, cuff=True, height=S["height"] * _k(ctx), width=S["width"],
                     toe_up=S["toe_up"], name=f"b_boot.{side}")


def boot_trim(ctx, style: str = "heavy", *, sides=("L", "R"), mat="ironstone", band="leather", target=None,
              bevel: float = 0.02, name: str = "boot") -> list:
    """Hard trim over the boots (separate parts): heavy/tall = an ironstone toe cap + a rolled cuff
    band; wrapped = cloth bands round the shaft; low = a strap over the instep. Bind foot/shin."""
    out = []
    J = ctx.info.joints
    tgt = _targets(ctx, target)
    tree = mesh.bvh_of(tgt)
    S = BOOT_STYLES[style]
    for s in sides:
        an, ball, toe, heel, kn = J[f"ankle.{s}"], J[f"ball.{s}"], J[f"toe.{s}"], J[f"heel.{s}"], J[f"knee.{s}"]
        fwd = V((toe.x - heel.x, toe.y - heel.y, 0)).normalized()
        if style in ("heavy", "tall", "low"):
            c = V((ball.x, ball.y, 0.03)) - fwd * 0.03
            kp = Spherical(c, up=fwd, front=(0, 0, 1))
            cap = mesh.plate(kp, [(0, -180, 180), (40, -110, 110), (62, -100, 100)], target=tree, offset=0.007,
                             thickness=0.014, cols=16, rows_n=6, smooth_iters=6, rim=0.0, bevel_w=bevel_w(bevel, 0.014),
                             bevel_segments=2, name=f"{name}_toe.{s}", col=ctx.col, mat=_m(ctx, mat), inner=True)
            out.append(Part(f"{name}_toe.{s}", low=cap, bind=("dblend", f"foot.{s}", f"toe.{s}", tuple(c - fwd * 0.04),
                                                               tuple(fwd), 0.0, 0.05)))
        t = (kn - an).normalized()
        cyl = Cylindrical(an, t, ref=(0, -1, 0))
        top_v = (S["height"] * _k(ctx) - an.z) / max(t.z, 0.3)
        if style in ("heavy", "tall"):
            b = surface_ring(cyl, top_v - 0.02, tree, 0.002, section=(0.022, 0.011), n=22, name=f"{name}_cuff.{s}",
                             col=ctx.col)
            mesh.set_material(b, _m(ctx, band))
            out.append(Part(f"{name}_cuff.{s}", low=b, bind=f"bone:shin.{s}"))
        elif style == "wrapped":
            nb_ = 5
            sp = top_v * 0.78 / nb_
            bands = [surface_ring(cyl, top_v * 0.2 + sp * (i + 0.5), tree, 0.001 + 0.003 * (i % 2),
                                  section=(sp * 0.62, 0.005), n=22, name=f"{name}_w{i}.{s}", col=ctx.col,
                                  wobble=0.012 * (1 if i % 2 else -1)) for i in range(nb_)]
            b = mesh.join(bands, f"{name}_wrap.{s}")
            mesh.set_material(b, _m(ctx, "cloth" if band == "leather" else band))
            out.append(Part(f"{name}_wrap.{s}", low=b, bind=f"bone:shin.{s}"))
        else:
            b = surface_ring(cyl, 0.01, tree, 0.002, section=(0.014, 0.006), n=20, name=f"{name}_strap.{s}", col=ctx.col)
            mesh.set_material(b, _m(ctx, band))
            out.append(Part(f"{name}_strap.{s}", low=b, bind=f"bone:shin.{s}"))
    return out


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# WAIST: belts, pouches, lamps, straps, satchels
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def _waist_axis():
    return Cylindrical((0, 0, 0), (0, 0, 1), ref=(0, -1, 0))


def belt(ctx, *, mat="leather", width: float = 0.095, buckle: str | None = "plate", buckle_mat="wood",
         pouches=(), lamp: float | None = None, target=None, bevel: float = 0.02, accent=None,
         name: str = "belt") -> list:
    """Waxed leather belt at the waist (+ buckle plate | dial | knot, pouches at azimuths [(u, size)],
    a lampresin lamp at azimuth `lamp`). Registers itself as the drapery top (tabard/skirt hang from
    it) and appends to ctx.targets. Bind 'bone:hips'. Azimuth u: 0 front, +90 the fighter's left."""
    J = ctx.info.joints
    s0 = J["spine0"]
    axis = _waist_axis()
    bz0, bz1 = s0.z - 0.05, s0.z - 0.05 + width
    tgt = _targets(ctx, target)
    b = mesh.plate(axis, [(bz1, -180, 180), (bz0, -180, 180)], target=tgt, offset=0.014, thickness=0.018, cols=36,
                   smooth_iters=8, wrap=True, rim=0.0, bevel_w=bevel_w(bevel, 0.018) * 0.6, bevel_segments=2, name=name,
                   col=ctx.col, mat=_m(ctx, mat))
    _reg(ctx)["belt"] = (b, bz0, bz1)
    ctx.targets = list(ctx.targets or [ctx.body_high]) + [b]
    out = [Part(name, low=b, bind="bone:hips")]
    btree = mesh.bvh_of([b])
    if buckle:
        bp = kit.surface(axis, 0, (bz0 + bz1) / 2, btree, 0.004)
        if buckle == "dial":
            out += clasp(ctx, u=0.0, z=(bz0 + bz1) / 2, radius=0.05, target=[b], name=f"{name}_dial")
            for p in out[-2:]:
                p.bind = "bone:hips"
        else:
            if buckle == "knot":
                bk = mesh.loft([{"p": bp + V((0.0, 0, 0.02)), "rx": 0.03, "ry": 0.022},
                                {"p": bp + V((0.0, -0.012, 0.0)), "rx": 0.038, "ry": 0.026},
                                {"p": bp + V((0.0, 0, -0.024)), "rx": 0.026, "ry": 0.018}], segments=10,
                               caps=("round", "round"), up=(0, -1, 0), name=f"{name}_buckle", col=ctx.col)
                mesh.set_material(bk, _m(ctx, mat))
            else:
                bk = mesh.slab([(-0.055, 0.045, -0.045), (0.0, 0.055, -0.055), (0.055, 0.045, -0.045)], thickness=0.026,
                               cols=4, rows_n=5, bevel_w=0.008, bevel_segments=2, name=f"{name}_buckle", col=ctx.col,
                               mat=_m(ctx, buckle_mat))
                bk.data.transform(Matrix.Translation(bp + V((0, -0.010, 0))) @ Matrix.Rotation(math.radians(-90), 4, "Z"))
            out.append(Part(f"{name}_buckle", low=bk, bind="bone:hips"))
    for i, pu in enumerate(pouches):
        u, size = (pu, 1.0) if isinstance(pu, (int, float)) else pu
        out += pouch(ctx, u=u, size=size, name=f"{name}_pouch{i}")
    if lamp is not None:
        out += lantern(ctx, u=lamp, name=f"{name}_lamp")
    a = _acc(accent, width=0.012)
    if a:
        pts = [kit.surface(axis, -28 + 56 * i / 6, bz1 - 0.012, btree, 0.0, outer=True) for i in range(7)]
        inl = mesh.loft([{"p": p, "rx": a["width"] * 0.5, "ry": 0.005, "ry2": 0.003, "exp": 3} for p in pts],
                        segments=6, caps=("round", "round"), up=(0, -1, 0), name=f"{name}_inlay", col=ctx.col)
        mesh.set_material(inl, ctx.mats["accent"])
        out.append(Part(f"{name}_inlay", low=inl, bind="bone:hips"))
        _warn_low(ctx, inl, name)
    return out


def pouch(ctx, *, u: float = 60.0, size: float = 1.0, mat="leather", flap="leather", toggle="wood",
          name: str = "pouch") -> list:
    """A boxy waxed-leather pouch hung on the belt at azimuth `u` (flap + carved toggle). Bind hips."""
    belt_obj, bz0, bz1 = _reg(ctx).get("belt", (None, 0, 0))
    if belt_obj is None:
        raise RuntimeError("parts.pouch: build parts.belt first")
    axis = _waist_axis()
    s = size * _k(ctx)
    top = kit.surface(axis, u, bz1 - 0.01, mesh.bvh_of([belt_obj]), 0.0, outer=True)
    n = (top - V((0, 0, top.z))).normalized()
    w, dp, h = 0.075 * s, 0.035 * s, 0.085 * s
    c = top + n * (dp + 0.004)
    side = V((0, 0, 1)).cross(n).normalized()
    bag = mesh.loft([{"p": c + V((0, 0, -h)), "rx": w * 0.92, "ry": dp * 0.9, "exp": 3.4},
                     {"p": c + V((0, 0, -h * 0.5)), "rx": w, "ry": dp, "exp": 3.6},
                     {"p": c + V((0, 0, 0)), "rx": w * 0.98, "ry": dp * 0.95, "exp": 3.6}], segments=14,
                    caps=("round", "flat"), up=tuple(n), name=name, col=ctx.col, cap_len=0.25)
    mesh.set_material(bag, _m(ctx, mat))
    fl = mesh.loft([{"p": c + n * 0.004 + V((0, 0, 0.012)), "rx": w * 1.04, "ry": dp * 1.12, "exp": 3.8},
                    {"p": c + n * (dp * 0.8) + V((0, 0, -h * 0.42)), "rx": w * 0.98, "ry": 0.008, "exp": 3.8}],
                   segments=12, caps=("flat", "round"), up=tuple(n), name=f"{name}_flap", col=ctx.col, rings=5,
                   smooth_path=False, cap_len=0.3)
    mesh.set_material(fl, _m(ctx, flap))
    tg = mesh.loft([{"p": c + n * (dp + 0.004) + V((0, 0, -h * 0.42)) - side * 0.016, "rx": 0.007, "ry": 0.007},
                    {"p": c + n * (dp + 0.006) + V((0, 0, -h * 0.42)) + side * 0.016, "rx": 0.007, "ry": 0.007}],
                   segments=8, caps=("round", "round"), up=tuple(n), name=f"{name}_toggle", col=ctx.col,
                   smooth_path=False)
    mesh.set_material(tg, _m(ctx, toggle))
    return [Part(name, low=bag, bind="bone:hips"), Part(f"{name}_flap", low=fl, bind="bone:hips"),
            Part(f"{name}_toggle", low=tg, bind="bone:hips")]


def lantern(ctx, *, u: float = 108.0, size: float = 1.0, glass="lampresin", frame="wood_dark", center=None,
            bind: str = "bone:hips", name: str = "lantern") -> list:
    """A small lampresin light vessel (stalled light, cupped in a carved frame) hung on the belt at
    azimuth `u`, or at `center` (world) when given. Bind hips (or `bind`)."""
    col = ctx.col
    s = size * _k(ctx)
    if center is None:
        belt_obj, bz0, bz1 = _reg(ctx).get("belt", (None, 0, 0))
        z = ctx.info.joints["spine0"].z - 0.10
        top = kit.surface(_waist_axis(), u, z + 0.05, mesh.bvh_of([belt_obj] if belt_obj else _targets(ctx)), 0.05)
        c = top + V((0.0, 0.0, -0.09 * s))
    else:
        c = V(center)
    vessel = mesh.loft([{"p": c + V((0, 0, -0.065 * s)), "rx": 0.030 * s, "ry": 0.030 * s},
                        {"p": c + V((0, 0, -0.030 * s)), "rx": 0.052 * s, "ry": 0.052 * s},
                        {"p": c + V((0, 0, 0.030 * s)), "rx": 0.050 * s, "ry": 0.050 * s},
                        {"p": c + V((0, 0, 0.060 * s)), "rx": 0.034 * s, "ry": 0.034 * s}], segments=12,
                       caps=("round", "round"), up=(0, -1, 0), name=name, col=col, cap_len=0.4)
    mesh.set_material(vessel, _m(ctx, glass))
    cap = mesh.loft([{"p": c + V((0, 0, 0.055 * s)), "rx": 0.042 * s, "ry": 0.042 * s, "exp": 2.4},
                     {"p": c + V((0, 0, 0.082 * s)), "rx": 0.030 * s, "ry": 0.030 * s, "exp": 2.4},
                     {"p": c + V((0, 0, 0.098 * s)), "rx": 0.010 * s, "ry": 0.010 * s}], segments=10,
                    caps=("flat", "point"), up=(0, -1, 0), name=f"{name}_cap", col=col)
    base = mesh.loft([{"p": c + V((0, 0, -0.080 * s)), "rx": 0.036 * s, "ry": 0.036 * s, "exp": 2.4},
                      {"p": c + V((0, 0, -0.058 * s)), "rx": 0.040 * s, "ry": 0.040 * s, "exp": 2.4}], segments=10,
                     caps=("flat", "flat"), up=(0, -1, 0), name=f"{name}_base", col=col)
    ribs = []
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = V((math.cos(a), math.sin(a), 0))
        ribs.append(mesh.sweep([c + d * 0.040 * s + V((0, 0, -0.062 * s)), c + d * 0.056 * s,
                                c + d * 0.040 * s + V((0, 0, 0.058 * s))], 0.008 * s, segments=4, caps=("flat", "flat"),
                               rings=6, name=f"{name}_rib{k}", col=col))
    fr = mesh.join([cap, base] + ribs, f"{name}_frame")
    mesh.set_material(fr, _m(ctx, frame))
    return [Part(name, low=vessel, bind=bind, uv_weight=1.2), Part(f"{name}_frame", low=fr, bind=bind)]


def strap(ctx, path, *, mat="leather", width: float = 0.06, thickness: float = 0.012, lift: float = 0.010,
          target=None, bind=None, name: str = "strap") -> list:
    """A flat strap lying on the body along [(u, z), ...] (azimuth deg, height m) around the
    vertical axis: harnesses, baldrics, bandoliers. Bind default: zblend spine->chest."""
    J = ctx.info.joints
    s1 = J["spine1"]
    axis = _waist_axis()
    tree = mesh.bvh_of(_targets(ctx, target))
    pts = [kit.surface(axis, u, z, tree, lift) for u, z in path]
    st = mesh.loft([{"p": p, "rx": width * 0.5, "ry": thickness * 0.6, "ry2": thickness * 0.4, "exp": 3.2} for p in pts],
                   segments=8, caps=("flat", "flat"), up=(0, -1, 0), name=name, col=ctx.col, rings=max(12, len(pts) * 3))
    mesh.set_material(st, _m(ctx, mat))
    return [Part(name, low=st, bind=bind or ("zblend", "spine", "chest", s1.z - 0.06, s1.z + 0.06))]


def satchel(ctx, *, side: str = "L", mat="leather", flap="leather", size: float = 1.0, strap_w: float = 0.05,
            accent=None, name: str = "satchel") -> list:
    """A waxed-leather satchel on the `side` hip, its strap across the body from the opposite
    shoulder (strap zblend spine->chest, bag 'bone:hips'). accent: a glass toggle on the flap."""
    J = ctx.info.joints
    nb, s0 = J["neck_base"], J["spine0"]
    sx = 1.0 if side == "L" else -1.0
    k = size * _k(ctx)
    axis = _waist_axis()
    tgt = _targets(ctx, target=None)
    tree = mesh.bvh_of(tgt)
    zc = s0.z - 0.06
    top = kit.surface(axis, 92 * sx, zc + 0.04, tree, 0.0)
    n = (top - V((0, 0, top.z))).normalized()
    w, dp, h = 0.12 * k, 0.045 * k, 0.11 * k
    c = top + n * (dp + 0.01) + V((0, 0, -0.03))
    bag = mesh.loft([{"p": c + V((0, 0, -h)), "rx": w * 0.9, "ry": dp * 0.9, "exp": 3.0},
                     {"p": c + V((0, 0, -h * 0.4)), "rx": w, "ry": dp, "exp": 3.4},
                     {"p": c + V((0, 0, 0.02)), "rx": w * 0.96, "ry": dp * 0.9, "exp": 3.4}], segments=16,
                    caps=("round", "flat"), up=tuple(n), name=name, col=ctx.col, cap_len=0.3)
    mesh.set_material(bag, _m(ctx, mat))
    fl = mesh.loft([{"p": c + V((0, 0, 0.03)), "rx": w * 1.04, "ry": dp * 1.12, "exp": 3.6},
                    {"p": c + n * (dp * 0.9) + V((0, 0, -h * 0.5)), "rx": w * 0.95, "ry": 0.01, "exp": 3.6}],
                   segments=14, caps=("flat", "round"), up=tuple(n), name=f"{name}_flap", col=ctx.col, rings=6,
                   smooth_path=False, cap_len=0.3)
    mesh.set_material(fl, _m(ctx, flap))
    out = [Part(name, low=bag, bind="bone:hips", uv_weight=1.1), Part(f"{name}_flap", low=fl, bind="bone:hips")]
    # the strap: over the opposite shoulder, diagonally down the chest and the back to the bag
    zt, zb = nb.z - 0.01, zc + 0.05
    front = [(-sx * 28 + sx * 113 * i / 10, zt - (zt - zb) * i / 10) for i in range(11)]
    back = [(-sx * (152 + 103 * i / 10), zt - (zt - zb) * i / 10) for i in range(11)]
    out += strap(ctx, front, mat=mat, width=strap_w, name=f"{name}_strap")
    out += strap(ctx, back, mat=mat, width=strap_w, name=f"{name}_strap_back")
    a = _acc(accent, size=0.022)
    if a:
        tc = c + n * (dp + 0.012) + V((0, 0, -h * 0.45))
        tg = mesh.loft([{"p": tc + V((0, 0, -a["size"])), "rx": 0.007, "ry": 0.007}, {"p": tc, "rx": 0.011, "ry": 0.01},
                        {"p": tc + V((0, 0, a["size"])), "rx": 0.007, "ry": 0.007}], segments=8, caps=("point", "point"),
                       up=tuple(n), name=f"{name}_toggle", col=ctx.col)
        mesh.set_material(tg, ctx.mats["accent"])
        out.append(Part(f"{name}_toggle", low=tg, bind="bone:hips"))
        _warn_low(ctx, tg, name)
    return out


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# DRAPERY: tabards, skirts, capes (sculpted solid cloth; rigid drapery on x_ chains)
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def _belt_line(ctx):
    r = _reg(ctx).get("belt")
    if r:
        return r
    s0 = ctx.info.joints["spine0"]
    return (None, s0.z - 0.05, s0.z + 0.045)


def tabard(ctx, *, mat="cloth", hem_mat=None, front: bool = True, back: bool = True, span: float = 44.0,
           length: float = 0.48, chest: bool = True, folds: int = 2, fold_depth: float = 0.014, cut: str = "point",
           accent=None, target=None, name: str = "tabard") -> list:
    """Heavy cloth tabard: a panel over the chest (follows the body: bind 'transfer') continuing
    below the belt as hanging panels on one-bone chains (`<name>_f`, `<name>_b`).
    span = half width in degrees of azimuth; cut = point | straight | swallow (hem shape);
    chest=False hangs only from the belt (a loincloth). accent: a glass channel down the chest panel."""
    J = ctx.info.joints
    nb = J["neck_base"]
    belt_obj, bz0, bz1 = _belt_line(ctx)
    tgt = _targets(ctx, target)
    axis = _waist_axis()
    hems = {"point": lambda u: 0.16 * (1 - abs(2 * u - 1)), "straight": lambda u: 0.02 * math.sin(math.pi * u),
            "swallow": lambda u: 0.14 * abs(2 * u - 1)}
    out = []
    L = length * _k(ctx)
    for side, sgn, u_c in (("f", -1.0, 0.0), ("b", 1.0, 180.0)):
        if (side == "f" and not front) or (side == "b" and not back):
            continue
        sp = span if side == "f" else span * 1.15
        if chest:
            def folds_fn(u, v, r, u_c=u_c, sp=sp):
                x = (u - u_c) / sp
                return 0.004 * math.sin(x * math.pi * 2.0) * mesh.smoothstep(nb.z - 0.02, bz1, v)
            zt = nb.z - (0.07 if side == "f" else 0.04)
            cp = mesh.plate(axis, [(zt, u_c - sp * 0.82, u_c + sp * 0.82), (bz1 + 0.02, u_c - sp, u_c + sp),
                                   (bz0 + 0.01, u_c - sp, u_c + sp)], target=tgt, offset=0.016, thickness=0.016,
                            cols=14, smooth_iters=8, shape_fn=folds_fn, rim=0.012, rim_height=0.005, bevel_w=0.006,
                            bevel_segments=1, row_step=0.035, name=f"{name}_chest_{side}", col=ctx.col,
                            mat=_m(ctx, mat), rim_mat=_m(ctx, hem_mat or mat))
            out.append(Part(f"{name}_chest_{side}", low=cp, bind="transfer", uv_weight=1.1))
        top_z = bz0 + 0.008
        tree = mesh.bvh_of(tgt)
        top = [kit.surface(axis, u_c - sp + 2 * sp * i / 6, top_z, tree, 0.012) for i in range(7)]
        if side == "b":
            top = top[::-1]
        c0 = sum(top, V()) / len(top)
        cname = f"{name}_{side}"
        add_chain(ctx, cname, "hips", c0 + V((0, sgn * 0.01, 0)), c0 + V((0, sgn * 0.05, -L * 0.9)), bones=1,
                  z_hint=(0, sgn, 0))
        d = kit.drape(top, L, _m(ctx, mat), folds=folds, fold_depth=fold_depth, flare=0.05, avoid=tgt, clearance=0.035,
                      hem=hems[cut], out_dir=(0, sgn, 0), name=cname, col=ctx.col, seed=3 if side == "f" else 4)
        out.append(Part(cname, low=d, bind=("chain", cname, "hips")))
    a = _acc(accent, width=0.014)
    if a and chest and front:
        tree = mesh.bvh_of([out[0].low])
        pts = [kit.surface(axis, 0.0, nb.z - 0.10 - 0.16 * i / 6, tree, 0.0, outer=True) for i in range(7)]
        inl = mesh.loft([{"p": p, "rx": a["width"] * 0.5, "ry": 0.005, "ry2": 0.003, "exp": 3} for p in pts], segments=6,
                        caps=("round", "round"), up=(0, -1, 0), name=f"{name}_inlay", col=ctx.col)
        mesh.set_material(inl, ctx.mats["accent"])
        out.append(Part(f"{name}_inlay", low=inl, bind="bone:chest"))
    return out


def skirt(ctx, *, mat="cloth", panels: int = 6, length: float = 0.42, folds: int = 2, overlap: float = 0.18,
          gap_front: float = 0.0, target=None, name: str = "skirt") -> list:
    """A split skirt of `panels` heavy cloth panels round the belt. The front and back panels hang
    on one-bone chains (`<name>_f`, `<name>_b`: the thighs push them), the side panels blend
    hips -> thigh like tassets, so the legs never cut through. No accent (bottom half)."""
    J = ctx.info.joints
    belt_obj, bz0, bz1 = _belt_line(ctx)
    tgt = _targets(ctx, target)
    tree = mesh.bvh_of(tgt)
    axis = _waist_axis()
    L = length * _k(ctx)
    out = []
    step = 360.0 / panels
    chains = {}
    for i in range(panels):
        uc = step * i + (step * 0.5 if gap_front else 0.0)
        uc = (uc + 180.0) % 360.0 - 180.0
        half = step * (0.5 + overlap)
        lift = 0.012 + 0.008 * (i % 2)
        top = [kit.surface(axis, uc - half + 2 * half * j / 5, bz0 + 0.008, tree, lift) for j in range(6)]
        outv = kit.surface(axis, uc, bz0, tree, 0.0) - V((0, 0, bz0))
        outv.z = 0
        outv.normalize()
        if outv.y > 0:
            top = top[::-1]
        nm = f"{name}{i}"
        d = kit.drape(top, L * (1.0 - 0.08 * abs(math.sin(math.radians(uc)))), _m(ctx, mat), folds=folds,
                      fold_depth=0.012, flare=0.06, avoid=tgt, clearance=0.03 + 0.008 * (i % 2),
                      hem=lambda u: 0.06 * math.sin(math.pi * u), out_dir=tuple(outv), name=nm, col=ctx.col, seed=i)
        if abs(uc) <= 45.0:
            cn = f"{name}_f"
        elif abs(uc) >= 135.0:
            cn = f"{name}_b"
        else:
            cn = None
        if cn:
            if cn not in chains:
                sg = -1.0 if cn.endswith("_f") else 1.0
                c0 = V((0, sg * 0.15, bz0))
                chains[cn] = add_chain(ctx, cn, "hips", c0, c0 + V((0, sg * 0.05, -L * 0.9)), bones=1, z_hint=(0, sg, 0))
            out.append(Part(nm, low=d, bind=("chain", cn, "hips")))
        else:
            s = "L" if uc > 0 else "R"
            out.append(Part(nm, low=d, bind=("zblend", f"thigh.{s}", "hips", bz0 - L * 0.8, bz0 - 0.02)))
    return out


def cape(ctx, *, mat="cloth", length: float = 1.0, span: float = 140.0, folds: int = 4,
         fold_depth: float = 0.024, cut: str = "round", bones: int = 2, clasps: bool = True, accent=None, target=None,
         name: str = "cape") -> list:
    """Solid sculpted cape from the shoulders on a 2-bone x_cape chain (bind ('chain','cape','chest')).
    span = degrees of the back it covers at the top; cut = round | straight | swallow | point;
    clasps adds carved toggles at the front of the shoulders (accent=True makes them glass fins)."""
    J = ctx.info.joints
    nb = J["neck_base"]
    tgt = _targets(ctx, target)
    tree = mesh.bvh_of(tgt)
    axis = Cylindrical((0, nb.y, 0), (0, 0, 1), ref=(0, -1, 0))
    zt = nb.z - 0.045
    top = [kit.surface(axis, 180 - span / 2 + span * i / 8, zt - 0.03 * abs(math.sin(math.radians(span / 2 * (2 * i / 8 - 1)))),
                       tree, 0.016) for i in range(9)]
    L = length * _k(ctx)
    hems = {"round": lambda u: 0.10 * math.sin(math.pi * u), "straight": lambda u: 0.0,
            "swallow": lambda u: 0.22 * abs(2 * u - 1) ** 1.5, "point": lambda u: 0.22 * (1 - abs(2 * u - 1))}
    c0 = V((0, nb.y + 0.12, zt))
    add_chain(ctx, name, "chest", c0, c0 + V((0, 0.10, -L * 0.92)), bones=bones, z_hint=(0, 1, 0))
    d = kit.drape(top[::-1], L, _m(ctx, mat), folds=folds, fold_depth=fold_depth, flare=0.14, avoid=tgt, clearance=0.04,
                  hem=hems[cut], out_dir=(0, 1, 0), thickness=0.02, name=name, col=ctx.col, seed=7, rows=10, cols=14)
    out = [Part(name, low=d, bind=("chain", name, "chest"), uv_weight=1.1)]
    if clasps:
        for s, sx in (("L", 1.0), ("R", -1.0)):
            p = kit.surface(axis, 180 - sx * span / 2 + sx * 4, zt + 0.004, tree, 0.02)
            m_ = ctx.mats["accent"] if accent else _m(ctx, "wood_dark")
            tg = mesh.loft([{"p": p + V((0, -0.02, -0.006)), "rx": 0.012, "ry": 0.01},
                            {"p": p + V((0, 0.0, 0.0)), "rx": 0.018, "ry": 0.014},
                            {"p": p + V((0, 0.02, 0.006)), "rx": 0.012, "ry": 0.01}], segments=8,
                           caps=("round", "round"), up=(0, 0, 1), name=f"{name}_clasp.{s}", col=ctx.col)
            mesh.set_material(tg, m_)
            out.append(Part(f"{name}_clasp.{s}", low=tg, bind="bone:chest"))
    return out


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# WEAPONS + PROPS (prop space: grip at the origin, main axis +Z, front/edge toward -Y)
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def _grip(col, z0: float, z1: float, r: float, *, wraps=(), ribbed: bool = True, name: str = "grip"):
    st = []
    n = max(4, int((z1 - z0) / 0.04) + 1)
    for i in range(n):
        z = z0 + (z1 - z0) * i / (n - 1)
        rr = r * (1.0 + (0.14 if (ribbed and i % 2) else 0.0))
        st.append({"p": (0, 0, z), "rx": rr, "ry": rr * 1.1})
    g = mesh.loft(st, segments=10, caps=("flat", "flat"), up=(0, -1, 0), name=name, col=col, rings=2 * n + 1,
                  smooth_path=False)
    ws = []
    for z in wraps:
        ws.append(mesh.loft([{"p": (0, 0, z - 0.017), "rx": r * 1.3, "ry": r * 1.42, "exp": 2.6},
                             {"p": (0, 0, z + 0.017), "rx": r * 1.3, "ry": r * 1.42, "exp": 2.6}], segments=8,
                            caps=("flat", "flat"), up=(0, -1, 0), name=f"{name}_wrap", col=col, rings=2, smooth_path=False))
    return g, (mesh.join(ws, f"{name}_wraps") if ws else None)


def _knob(col, z: float, r: float, name: str, down: bool = True):
    s = -1.0 if down else 1.0
    return mesh.loft([{"p": (0, 0, z), "rx": r * 0.62, "ry": r * 0.68, "exp": 2.4},
                      {"p": (0, 0, z + s * r * 0.7), "rx": r, "ry": r * 1.08, "exp": 3.0},
                      {"p": (0, 0, z + s * r * 1.45), "rx": r * 0.55, "ry": r * 0.6, "exp": 2.4}], segments=10,
                     caps=("flat", "round"), up=(0, -1, 0), name=name, col=col, cap_len=0.5)


def _fuller_inlay(ctx, z0: float, z1: float, half_t, width: float, name: str, y: float = 0.0):
    """Accent strip on both faces of a slab blade (prop space), from z0 to z1."""
    objs = []
    for sx in (1.0, -1.0):
        st = []
        for i in range(7):
            z = z0 + (z1 - z0) * i / 6
            t = i / 6
            st.append({"p": (sx * (half_t(z) + 0.0006), y, z), "rx": width * 0.5 * (0.5 + 0.5 * math.sin(math.pi * t) ** 0.4),
                       "ry": 0.0022, "ry2": 0.004, "exp": 3.0})
        objs.append(mesh.loft(st, segments=6, caps=("round", "round"), up=(sx, 0, 0), name=f"{name}{sx}", col=ctx.col))
    o = mesh.join(objs, name)
    mesh.set_material(o, ctx.mats["accent"])
    return o


def sword(ctx, *, length: float = 0.82, width: float = 0.075, thickness: float = 0.026, guard: str = "block",
          hand: str | None = "R", socket: str | None = "x_blade_tip", accent=None, bevel: float = 0.02,
          blade="stone", edge="dawnglass", spine="ironstone", grip="wood_dark", wrap="leather", name: str = "sword") -> list:
    """One-handed honed-stone sword: dawnglass edges, ironstone core line, carved guard (block |
    wings | none), wood grip with leather wraps, ironstone pommel. accent: fuller strip."""
    col = ctx.col
    L, W = length, width
    z0 = 0.11
    rows = [(z0, W * 0.5, -W * 0.5), (z0 + L * 0.35, W * 0.48, -W * 0.48), (z0 + L * 0.78, W * 0.36, -W * 0.36),
            (z0 + L * 0.94, W * 0.14, -W * 0.14), (z0 + L, 0.0, 0.0)]

    def th(u, v):
        return thickness * (1.0 - 0.62 * abs(2 * u - 1) ** 1.4) * (1.0 - 0.35 * v)

    bl = mesh.slab(rows, thickness=th, cols=10, rows_n=14, bevel_w=bevel_w(bevel, thickness) * 0.5, bevel_segments=2,
                   name=f"{name}_blade", col=col,
                   bands=[(0.13, _m(ctx, edge)), (0.44, _m(ctx, blade)), (0.56, _m(ctx, spine)), (0.87, _m(ctx, blade)),
                          (1.0, _m(ctx, edge))])
    objs = [(f"{name}_blade", bl)]
    if guard != "none":
        gw = W * (1.5 if guard == "block" else 2.4)
        g = mesh.slab([(0.075, gw * 0.5, -gw * 0.5), (0.095, gw * 0.55, -gw * 0.55), (0.115, gw * 0.42, -gw * 0.42)]
                      if guard == "block" else
                      [(0.07, gw * 0.18, -gw * 0.18), (0.09, gw * 0.5, -gw * 0.5), (0.105, gw * 0.56, -gw * 0.56),
                       (0.115, gw * 0.2, -gw * 0.2)], thickness=0.05, cols=4, rows_n=4, bevel_w=0.01, bevel_segments=2,
                      name=f"{name}_guard", col=col, mat=_m(ctx, spine))
        objs.append((f"{name}_guard", g))
    gr, wr = _grip(col, -0.11, 0.075, 0.019, wraps=(-0.05, 0.03), name=f"{name}_grip")
    mesh.set_material(gr, _m(ctx, grip))
    mesh.set_material(wr, _m(ctx, wrap))
    pm = _knob(col, -0.11, 0.03, f"{name}_pommel")
    mesh.set_material(pm, _m(ctx, spine))
    objs += [(f"{name}_grip", gr), (f"{name}_wraps", wr), (f"{name}_pommel", pm)]
    a = _acc(accent, width=0.012)
    if a:
        objs.append((f"{name}_inlay", _fuller_inlay(ctx, z0 + 0.03, z0 + L * 0.45,
                                                    lambda z: 0.5 * thickness * (1 - 0.35 * (z - z0) / L), a["width"],
                                                    f"{name}_inlay")))
    _socket(ctx, socket, hand, z0 + L)
    return place_prop(ctx, objs, hand, uv=1.2)


def greatblade(ctx, *, length: float = 1.27, width: float = 0.13, hand: str | None = "R",
               socket: str | None = "x_blade_tip", accent=None, bevel: float = 0.024, name: str = "gn") -> list:
    """The oversized gnomon blade (the reference's Breaker weapon): ironstone spine, a carved fuller
    groove, honed dialstone blade, dawnglass cutting edge; carved walnut grip with leather wraps,
    ironstone guard block and pommel. accent: a glass channel along the spine."""
    col = ctx.col
    k = length / 1.27
    w = width / 0.13
    blade = mesh.slab([(0.150, 0.065 * w, -0.250 * w), (0.42 * k, 0.058 * w, -0.215 * w), (0.80 * k, 0.045 * w, -0.150 * w),
                       (1.10 * k, 0.030 * w, -0.070 * w), (1.27 * k, 0.004 * w, -0.004 * w)],
                      thickness=lambda u, v: (0.050 - 0.036 * u) * (1.0 - 0.35 * v), cols=10, rows_n=16,
                      bevel_w=bevel_w(bevel, 0.05) * 0.5, bevel_segments=3, name=f"{name}_blade", col=col,
                      bands=[(0.16, ctx.mats["ironstone"]), (0.25, ctx.mats["stone"]), (0.31, ctx.mats["ironstone"]),
                             (0.86, ctx.mats["stone"]), (1.0, ctx.mats["dawnglass"])])
    guard = mesh.slab([(0.095, 0.085 * w, -0.115 * w), (0.125, 0.095 * w, -0.13 * w), (0.165, 0.08 * w, -0.105 * w)],
                      thickness=0.07, cols=4, rows_n=3, bevel_w=0.014, bevel_segments=2, name=f"{name}_guard", col=col,
                      mat=ctx.mats["ironstone"])
    grip, wraps = _grip(col, -0.30, 0.10, 0.024, wraps=(-0.20, -0.06, 0.06), name=f"{name}_grip")
    mesh.set_material(grip, ctx.mats["wood_dark"])
    mesh.set_material(wraps, ctx.mats["leather"])
    pommel = mesh.loft([{"p": (0, 0, -0.300), "rx": 0.030, "ry": 0.034, "exp": 2.4},
                        {"p": (0, 0, -0.335), "rx": 0.048, "ry": 0.052, "exp": 3.0},
                        {"p": (0, 0, -0.370), "rx": 0.026, "ry": 0.028, "exp": 2.4}], segments=10,
                       caps=("flat", "round"), up=(0, -1, 0), name=f"{name}_pommel", col=col, cap_len=0.5)
    mesh.set_material(pommel, ctx.mats["ironstone"])
    objs = [(f"{name}_blade", blade), (f"{name}_guard", guard), (f"{name}_grip", grip), (f"{name}_wraps", wraps),
            (f"{name}_pommel", pommel)]
    a = _acc(accent, width=0.014)
    if a:
        st = [{"p": (0, 0.067 * w - 0.003, z), "rx": a["width"] * 0.5, "ry": 0.004, "ry2": 0.006, "exp": 3}
              for z in (0.2, 0.35, 0.5, 0.65)]
        sp = mesh.loft(st, segments=6, caps=("round", "round"), up=(0, 1, 0), name=f"{name}_inlay", col=col)
        mesh.set_material(sp, ctx.mats["accent"])
        objs.append((f"{name}_inlay", sp))
    _socket(ctx, socket, hand, 1.26 * k)
    return place_prop(ctx, objs, hand, uv=1.3)


def spear(ctx, *, length: float = 2.1, head: float = 0.34, hand: str | None = "R", socket: str | None = "x_spear_tip",
          accent=None, bevel: float = 0.02, name: str = "spear") -> list:
    """Carved ash spear: a long haft gripped a third of the way up, a honed-stone leaf head with
    dawnglass edges, leather bindings, an ironstone butt cap. accent: a glass collar under the head."""
    col = ctx.col
    zb, zt = -0.72 * length / 2.1, length - 0.72 * length / 2.1 - head
    haft = mesh.loft([{"p": (0, 0, zb), "rx": 0.017, "ry": 0.017}, {"p": (0, 0, (zb + zt) / 2), "rx": 0.02, "ry": 0.02},
                      {"p": (0, 0, zt), "rx": 0.017, "ry": 0.017}], segments=8, caps=("flat", "flat"), name=f"{name}_haft",
                     col=col, rings=18)
    mesh.set_material(haft, ctx.mats["wood"])
    W = head * 0.27
    hd = mesh.slab([(zt - 0.02, 0.012, -0.012), (zt + head * 0.18, W * 0.5, -W * 0.5), (zt + head * 0.42, W * 0.56, -W * 0.56),
                    (zt + head * 0.8, W * 0.26, -W * 0.26), (zt + head, 0.0, 0.0)],
                   thickness=lambda u, v: 0.024 * (1.0 - 0.6 * abs(2 * u - 1) ** 1.3) * (1 - 0.3 * v), cols=8, rows_n=12,
                   bevel_w=bevel_w(bevel, 0.024) * 0.4, bevel_segments=2, name=f"{name}_head", col=col,
                   bands=[(0.15, ctx.mats["dawnglass"]), (0.85, ctx.mats["stone"]), (1.0, ctx.mats["dawnglass"])])
    binds = [mesh.loft([{"p": (0, 0, z - 0.02), "rx": 0.025, "ry": 0.025, "exp": 2.6},
                        {"p": (0, 0, z + 0.02), "rx": 0.025, "ry": 0.025, "exp": 2.6}], segments=8, caps=("flat", "flat"),
                       name=f"{name}_bind", col=col, rings=2, smooth_path=False) for z in (zt - 0.03, -0.05, 0.06)]
    bnd = mesh.join(binds, f"{name}_binds")
    mesh.set_material(bnd, ctx.mats["leather"])
    butt = _knob(col, zb, 0.024, f"{name}_butt")
    mesh.set_material(butt, ctx.mats["ironstone"])
    objs = [(f"{name}_haft", haft), (f"{name}_head", hd), (f"{name}_binds", bnd), (f"{name}_butt", butt)]
    a = _acc(accent)
    if a:
        o = ring(V((0, 0, zt - 0.07)), (0, 0, 1), 0.022, section=(0.012, 0.004), n=16, name=f"{name}_inlay", col=col)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    _socket(ctx, socket, hand, zt + head)
    return place_prop(ctx, objs, hand, uv=1.1)


def staff(ctx, *, length: float = 1.6, head: str = "lens", hand: str | None = "R", socket: str | None = "x_staff_tip",
          accent=None, name: str = "staff") -> list:
    """Carved ash staff (grip at the origin, off hand at +0.36). head: lens (chalk crook holding a
    dawnglass lens; the template caster) | vessel (a lampresin vessel in a carved cage) | spire
    (a stacked chalk spire). accent: a glass ring at the head."""
    col = ctx.col
    zt = length * 0.5
    shaft = mesh.loft([{"p": (0, 0, -length * 0.49), "rx": 0.016, "ry": 0.016}, {"p": (0, 0, 0.0), "rx": 0.02, "ry": 0.02},
                       {"p": (0, 0, zt), "rx": 0.018, "ry": 0.018}], segments=8, caps=("round", "flat"),
                      name=f"{name}", col=col, rings=14)
    mesh.set_material(shaft, ctx.mats["wood"])
    objs = [(name, shaft)]
    if head == "spire":
        sp = mesh.loft([{"p": (0, 0, zt - 0.02), "rx": 0.03, "ry": 0.03, "exp": 3.6},
                        {"p": (0, 0, zt + 0.08), "rx": 0.05, "ry": 0.05, "exp": 3.6},
                        {"p": (0, 0, zt + 0.09), "rx": 0.04, "ry": 0.04, "exp": 3.6},
                        {"p": (0, 0, zt + 0.17), "rx": 0.038, "ry": 0.038, "exp": 3.6},
                        {"p": (0, 0, zt + 0.18), "rx": 0.028, "ry": 0.028, "exp": 3.6},
                        {"p": (0, 0, zt + 0.32), "rx": 0.004, "ry": 0.004}], segments=8, caps=("flat", "point"),
                       name=f"{name}_head", col=col, smooth_path=False, rings=12)
        mesh.set_material(sp, ctx.mats["chalk"])
        objs.append((f"{name}_head", sp))
        tip, ring_z, ring_r = zt + 0.32, zt + 0.085, 0.052
    else:
        hd = mesh.loft([{"p": (0, 0, zt - 0.02), "rx": 0.03, "ry": 0.03}, {"p": (0, 0, zt + 0.04), "rx": 0.075, "ry": 0.022, "exp": 2.6},
                        {"p": (0, 0, zt + 0.20), "rx": 0.085, "ry": 0.024, "exp": 2.6}, {"p": (0, 0, zt + 0.26), "rx": 0.03, "ry": 0.02}],
                       segments=12, caps=("flat", "round"), up=(0, -1, 0), name=f"{name}_head", col=col)
        mesh.set_material(hd, ctx.mats["chalk" if head == "lens" else "wood_dark"])
        objs.append((f"{name}_head", hd))
        if head == "vessel":
            ln = mesh.loft([{"p": (0, 0, zt + 0.06), "rx": 0.03, "ry": 0.03}, {"p": (0, 0, zt + 0.12), "rx": 0.055, "ry": 0.055},
                            {"p": (0, 0, zt + 0.19), "rx": 0.04, "ry": 0.04}], segments=12, caps=("round", "round"),
                           up=(0, -1, 0), name=f"{name}_lens", col=col)
            mesh.set_material(ln, ctx.mats["lampresin"])
        else:
            ln = mesh.loft([{"p": (0, 0.0, zt + 0.12), "rx": 0.06, "ry": 0.008}, {"p": (0, -0.012, zt + 0.12), "rx": 0.062, "ry": 0.012},
                            {"p": (0, -0.022, zt + 0.12), "rx": 0.05, "ry": 0.006}], segments=14, caps=("flat", "round"),
                           up=(0, 0, 1), name=f"{name}_lens", col=col, smooth_path=False, rings=3)
            mesh.set_material(ln, ctx.mats["dawnglass"])
        objs.append((f"{name}_lens", ln))
        tip, ring_z, ring_r = zt + 0.26, zt + 0.0, 0.03
    a = _acc(accent)
    if a:
        o = ring(V((0, 0, ring_z)), (0, 0, 1), ring_r + 0.002, section=(0.011, 0.004), n=18, name=f"{name}_inlay", col=col)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    _socket(ctx, socket, hand, tip)
    return place_prop(ctx, objs, hand)


def bow(ctx, *, height: float = 1.3, hand: str | None = "L", socket: str | None = "x_arrow_nock", quiver: bool = True,
        accent=None, name: str = "bow") -> list:
    """Carved recurve bow held in the off hand (limbs along prop Z, belly toward the archer +Y,
    string behind), walnut tips, leather grip; quiver=True adds a back quiver with arrows
    (bind chest). accent: a glass band on the grip / the quiver mouth."""
    col = ctx.col
    h = height * 0.5
    limb = []
    for sgn in (1.0, -1.0):
        pts, rad = [], []
        for i in range(9):
            t = i / 8
            z = sgn * (0.06 + (h - 0.06) * t)
            y = 0.11 * t ** 2 - 0.05 * max(0.0, (t - 0.82) / 0.18) ** 1.5
            pts.append(V((0, y, z)))
            rad.append((0.024 * (1 - 0.55 * t), 0.014 * (1 - 0.5 * t)))
        lb = mesh.loft([{"p": p, "rx": r[0], "ry": r[1], "exp": 2.4} for p, r in zip(pts, rad)], segments=8,
                       caps=("flat", "round"), up=(0, -1, 0), name=f"{name}_limb", col=col, rings=16)
        limb.append(lb)
    body_ = mesh.join(limb, name)
    mesh.set_material(body_, ctx.mats["wood"])
    grip = mesh.loft([{"p": (0, 0, -0.085), "rx": 0.024, "ry": 0.022}, {"p": (0, 0.004, 0.0), "rx": 0.026, "ry": 0.026},
                      {"p": (0, 0, 0.085), "rx": 0.024, "ry": 0.022}], segments=10, caps=("round", "round"),
                     up=(0, -1, 0), name=f"{name}_grip", col=col)
    mesh.set_material(grip, ctx.mats["leather"])
    tips = []
    ty = 0.11 - 0.05
    for sgn in (1.0, -1.0):
        tips.append(mesh.loft([{"p": (0, ty + 0.01, sgn * (h - 0.05)), "rx": 0.013, "ry": 0.010},
                               {"p": (0, ty - 0.012, sgn * (h + 0.015)), "rx": 0.008, "ry": 0.007}], segments=8,
                              caps=("round", "point"), up=(0, -1, 0), name=f"{name}_tip", col=col, smooth_path=False))
    tp = mesh.join(tips, f"{name}_tips")
    mesh.set_material(tp, ctx.mats["wood_dark"])
    string = mesh.loft([{"p": (0, ty + 0.004, h - 0.02), "rx": 0.003, "ry": 0.003},
                        {"p": (0, ty + 0.004, -h + 0.02), "rx": 0.003, "ry": 0.003}], segments=6, caps=("flat", "flat"),
                       up=(0, -1, 0), name=f"{name}_string", col=col, smooth_path=False, rings=2)
    mesh.set_material(string, ctx.mats["cloth2"])
    objs = [(name, body_), (f"{name}_grip", grip), (f"{name}_tips", tp), (f"{name}_string", string)]
    a = _acc(accent)
    if a:
        o = ring(V((0, 0.002, 0.095)), (0, 0, 1), 0.025, section=(0.009, 0.004), n=16, name=f"{name}_inlay", col=col)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    _socket(ctx, socket, hand, 0.0)
    out = place_prop(ctx, objs, hand)
    if quiver:
        out += quiver_back(ctx, accent=accent, name=f"{name}_quiver")
    return out


def quiver_back(ctx, *, arrows: int = 5, length: float = 0.6, accent=None, place: bool = True,
                name: str = "quiver") -> list:
    """Leather quiver on the back (over the right shoulder) with walnut rims and arrows (ash
    shafts, cloth fletching). Bind 'bone:chest' (place=False keeps it upright at the origin)."""
    col = ctx.col
    tube = mesh.loft([{"p": (0, 0, 0.0), "rx": 0.05, "ry": 0.04, "exp": 2.4},
                      {"p": (0, 0, length * 0.5), "rx": 0.058, "ry": 0.046, "exp": 2.4},
                      {"p": (0, 0, length), "rx": 0.064, "ry": 0.05, "exp": 2.4}], segments=12, caps=("round", "flat"),
                     up=(0, -1, 0), name=name, col=col, cap_len=0.3)
    mesh.set_material(tube, ctx.mats["leather"])
    rims = mesh.join([ring(V((0, 0, z)), (0, 0, 1), r, section=(0.008, 0.012), n=16, name=f"{name}_rim", col=col)
                      for z, r in ((length - 0.012, 0.064), (0.08, 0.052))], f"{name}_rims")
    mesh.set_material(rims, ctx.mats["wood_dark"])
    shafts, fl = [], []
    for i in range(arrows):
        a = 2 * math.pi * i / arrows
        x, y = 0.026 * math.cos(a), 0.02 * math.sin(a)
        top = length + 0.16 + 0.02 * ((i * 7) % 3)
        shafts.append(mesh.loft([{"p": (x, y, length * 0.5), "rx": 0.006, "ry": 0.006},
                                 {"p": (x * 1.3, y * 1.3, top), "rx": 0.006, "ry": 0.006}], segments=6,
                                caps=("flat", "round"), name=f"{name}_shaft", col=col, smooth_path=False, rings=2))
        for k in range(3):
            b = a + 2 * math.pi * k / 3
            d = V((math.cos(b), math.sin(b), 0))
            base = V((x * 1.3, y * 1.3, top - 0.10))
            fl.append(mesh.loft([{"p": base + d * 0.006, "rx": 0.002, "ry": 0.004},
                                 {"p": base + d * 0.016 + V((0, 0, 0.05)), "rx": 0.002, "ry": 0.01},
                                 {"p": base + d * 0.008 + V((0, 0, 0.085)), "rx": 0.002, "ry": 0.004}], segments=4,
                                caps=("point", "point"), up=tuple(d), name=f"{name}_fletch", col=col))
    sh = mesh.join(shafts, f"{name}_arrows")
    mesh.set_material(sh, ctx.mats["wood"])
    fj = mesh.join(fl, f"{name}_fletching")
    mesh.set_material(fj, ctx.mats["cloth2"])
    objs = [(name, tube), (f"{name}_rims", rims), (f"{name}_arrows", sh), (f"{name}_fletching", fj)]
    a = _acc(accent)
    if a:
        o = ring(V((0, 0, length - 0.035)), (0, 0, 1), 0.064, section=(0.009, 0.004), n=16, name=f"{name}_inlay", col=col)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    if place:
        J = ctx.info.joints
        s1 = J["spine1"]
        M = (Matrix.Translation(V((0.0, s1.y + 0.17 * _k(ctx), s1.z - 0.24))) @ Matrix.Rotation(math.radians(-24), 4, "Y")
             @ Matrix.Rotation(math.radians(-14), 4, "X"))
        _xf([o for _, o in objs], M)
    return [Part(n, low=o, bind="bone:chest") for n, o in objs]


def twin_blades(ctx, *, length: float = 0.56, width: float = 0.07, curve: float = 0.09, socket: str | None = "x_blade_tip",
                accent=None, bevel: float = 0.02, name: str = "twin") -> list:
    """A pair of short curved honed-stone blades (dawnglass cutting edge, ironstone back), one in
    each hand (prop.R, prop.L mirrored). accent: a glass strip at each blade's root."""
    out = []
    for hand in ("R", "L"):
        col = ctx.col
        rows = []
        n = 6
        for i in range(n + 1):
            t = i / n
            z = 0.09 + length * t
            yc = -curve * t ** 2
            w = width * (1.0 - t ** 1.6) + 0.004
            rows.append((z, yc + w * 0.42, yc - w * 0.58) if i < n else (z, yc - 0.004, yc - 0.004))
        bl = mesh.slab(rows, thickness=lambda u, v: 0.02 * (1.0 - 0.7 * u) * (1 - 0.3 * v), cols=8, rows_n=12,
                       bevel_w=bevel_w(bevel, 0.02) * 0.4, bevel_segments=2, name=f"{name}_blade.{hand}", col=col,
                       bands=[(0.2, ctx.mats["ironstone"]), (0.8, ctx.mats["stone"]), (1.0, ctx.mats["dawnglass"])])
        gd = mesh.slab([(0.065, 0.03, -0.05), (0.09, 0.034, -0.056)], thickness=0.04, cols=3, rows_n=3, bevel_w=0.008,
                       bevel_segments=2, name=f"{name}_guard.{hand}", col=col, mat=ctx.mats["ironstone"])
        gr, wr = _grip(col, -0.07, 0.065, 0.018, wraps=(-0.01,), name=f"{name}_grip.{hand}")
        mesh.set_material(gr, ctx.mats["wood_dark"])
        mesh.set_material(wr, ctx.mats["leather"])
        pm = _knob(col, -0.07, 0.024, f"{name}_pommel.{hand}")
        mesh.set_material(pm, ctx.mats["ironstone"])
        objs = [(f"{name}_blade.{hand}", bl), (f"{name}_guard.{hand}", gd), (f"{name}_grip.{hand}", gr),
                (f"{name}_wraps.{hand}", wr), (f"{name}_pommel.{hand}", pm)]
        a = _acc(accent, width=0.01)
        if a:
            objs.append((f"{name}_inlay.{hand}", _fuller_inlay(ctx, 0.12, 0.26, lambda z: 0.0088, a["width"],
                                                               f"{name}_inlay.{hand}", y=-0.012)))
        _socket(ctx, socket if hand == "R" else (socket + "_l" if socket else None), hand, 0.09 + length)
        out += place_prop(ctx, objs, hand if ctx.info else None)
    return out


def hammer(ctx, *, haft: float = 0.62, head=(0.24, 0.12, 0.12), hand: str | None = "R", two_hand: bool = False,
           socket: str | None = "x_hammer_head", accent=None, bevel: float = 0.03, name: str = "hammer") -> list:
    """Ironstone-headed hammer on a carved ash haft (head = (length along Y, width X, height Z)).
    The head is a rounded block with flared striking faces and a carved waist band; leather
    lashing where it meets the haft. maul() is the two-handed version. accent: glass band in the waist."""
    col = ctx.col
    hl, hw, hh = head
    zb = -0.12 if not two_hand else -0.62
    zt = haft + zb
    hf = mesh.loft([{"p": (0, 0, zb), "rx": 0.02, "ry": 0.02}, {"p": (0, 0, (zb + zt) / 2), "rx": 0.023, "ry": 0.023},
                    {"p": (0, 0, zt + hh * 0.5), "rx": 0.021, "ry": 0.021}], segments=8, caps=("flat", "flat"),
                   name=f"{name}_haft", col=col, rings=16)
    mesh.set_material(hf, ctx.mats["wood"])
    zc = zt + hh * 0.35
    st = []
    for y, s in ((-hl / 2, 1.06), (-hl / 2 + 0.03, 1.0), (-0.025, 0.93), (-0.012, 0.86), (0.012, 0.86), (0.025, 0.93),
                 (hl / 2 - 0.03, 1.0), (hl / 2, 1.06)):
        st.append({"p": (0, y, zc), "rx": hw * 0.5 * s, "ry": hh * 0.5 * s, "exp": 3.6})
    hd = mesh.loft(st, segments=16, caps=("flat", "flat"), up=(0, 0, 1), name=f"{name}_head", col=col, smooth_path=False,
                   rings=len(st))
    mesh.bevel(hd, bevel_w(bevel, hh), 2, angle=30)
    mesh.set_material(hd, ctx.mats["ironstone"])
    lash = mesh.join([ring(V((0, 0, z)), (0, 0, 1), 0.026, section=(0.012, 0.006), n=12, name=f"{name}_lash", col=col)
                      for z in (zc - hh * 0.62, zc - hh * 0.62 - 0.03)], f"{name}_lashing")
    mesh.set_material(lash, ctx.mats["leather"])
    cap = _knob(col, zb, 0.026, f"{name}_cap")
    mesh.set_material(cap, ctx.mats["stone"])
    objs = [(f"{name}_haft", hf), (f"{name}_head", hd), (f"{name}_lashing", lash), (f"{name}_cap", cap)]
    a = _acc(accent)
    if a:
        pts = []                      # a rounded-square band sunk into the head's carved waist
        for i in range(25):
            ang = 2 * math.pi * i / 24
            cx, cz = math.cos(ang), math.sin(ang)
            e = 2.0 / 3.6
            x = math.copysign(abs(cx) ** e, cx) * hw * 0.5 * 0.86
            z = math.copysign(abs(cz) ** e, cz) * hh * 0.5 * 0.86
            pts.append(V((x, 0.0, zc + z)))
        o = mesh.loft([{"p": p, "rx": 0.009, "ry": 0.004, "exp": 3} for p in pts], segments=6, caps=(None, None),
                      up=(0, 1, 0), name=f"{name}_inlay", col=col, rings=25, smooth_path=False)
        mesh.cleanup(o, merge=1e-4)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    _socket(ctx, socket, hand, zc)
    return place_prop(ctx, objs, hand, uv=1.2)


def maul(ctx, *, haft: float = 1.15, head=(0.36, 0.2, 0.2), **kw) -> list:
    """Two-handed ironstone maul (grip at the origin, off hand toward the butt); see hammer()."""
    kw.setdefault("name", "maul")
    return hammer(ctx, haft=haft, head=head, two_hand=True, **kw)


def chain_lantern(ctx, *, chain: float = 0.42, hand: str = "R", size: float = 1.0, beads: int = 4, accent=None,
                  name: str = "clantern") -> list:
    """A lampresin lantern swinging on a waxed cord from the fist (carved toggle in the grip, wood
    beads on the cord). The cord + lantern ride a 2-bone x_<name>_hang chain under prop.<hand>
    (role 'hang': gravity, low stiffness: it swings). accent: a glass cap on the lantern."""
    col = ctx.col
    info = ctx.info
    Mp = rig.prop_matrix(info, f"prop.{hand}")
    P0 = Mp @ V((0, 0, 0))
    tog = mesh.loft([{"p": (0, 0, -0.07), "rx": 0.016, "ry": 0.016}, {"p": (0, 0, 0.0), "rx": 0.02, "ry": 0.02},
                     {"p": (0, 0, 0.07), "rx": 0.016, "ry": 0.016}], segments=8, caps=("round", "round"),
                    name=f"{name}_toggle", col=col)
    mesh.set_material(tog, ctx.mats["wood_dark"])
    tog.data.transform(Mp)
    out = [Part(f"{name}_toggle", low=tog, bind=f"bone:prop.{hand}")]
    k = size * _k(ctx)
    top = P0 + V((0, 0, -0.03))
    bot = top + V((0, 0, -chain * k))
    cn = f"{name}_hang"
    add_chain(ctx, cn, f"prop.{hand}", top, bot - V((0, 0, 0.10 * k)), bones=2, z_hint=(0, -1, 0))
    cord = mesh.loft([{"p": top, "rx": 0.005, "ry": 0.005}, {"p": bot, "rx": 0.005, "ry": 0.005}], segments=6,
                     caps=("flat", "flat"), name=f"{name}_cord", col=col, smooth_path=False, rings=8)
    mesh.set_material(cord, ctx.mats["leather"])
    bd = []
    for i in range(beads):
        c = top.lerp(bot, (i + 0.6) / (beads + 0.4))
        bd.append(mesh.loft([{"p": c + V((0, 0, 0.014)), "rx": 0.008, "ry": 0.008},
                             {"p": c, "rx": 0.016, "ry": 0.016}, {"p": c - V((0, 0, 0.014)), "rx": 0.008, "ry": 0.008}],
                            segments=8, caps=("round", "round"), name=f"{name}_bead", col=col))
    bj = mesh.join(bd, f"{name}_beads")
    mesh.set_material(bj, ctx.mats["wood"])
    lp = lantern(ctx, center=bot - V((0, 0, 0.10 * k)), size=size * 1.25, name=f"{name}_lamp", bind=("chain", cn, f"prop.{hand}"))
    out += [Part(f"{name}_cord", low=cord, bind=("chain", cn, f"prop.{hand}")),
            Part(f"{name}_beads", low=bj, bind=("chain", cn, f"prop.{hand}"))] + lp
    a = _acc(accent)
    if a:
        c = bot - V((0, 0, 0.10 * k)) + V((0, 0, 0.11 * k * 1.25))
        o = mesh.loft([{"p": c - V((0, 0, 0.012)), "rx": 0.02, "ry": 0.02}, {"p": c + V((0, 0, 0.03)), "rx": 0.004, "ry": 0.004}],
                      segments=8, caps=("flat", "point"), name=f"{name}_inlay", col=col, smooth_path=False)
        mesh.set_material(o, ctx.mats["accent"])
        out.append(Part(f"{name}_inlay", low=o, bind=("chain", cn, f"prop.{hand}")))
    return out


def focus_orb(ctx, *, radius: float = 0.085, hand: str | None = "L", socket: str | None = "x_focus",
              accent=None, name: str = "focus") -> list:
    """A smooth dawnglass orb (never faceted: not a gem) held above the fist in a carved walnut
    cradle of three prongs on a short handle. accent: a thin glass halo ring round the orb."""
    col = ctx.col
    zc = 0.10 + radius
    hd = mesh.loft([{"p": (0, 0, -0.08), "rx": 0.016, "ry": 0.016}, {"p": (0, 0, 0.0), "rx": 0.019, "ry": 0.019},
                    {"p": (0, 0, 0.07), "rx": 0.022, "ry": 0.022}, {"p": (0, 0, 0.10), "rx": 0.04, "ry": 0.04, "exp": 2.4}],
                   segments=10, caps=("round", "flat"), name=f"{name}_handle", col=col)
    prongs = []
    for i in range(3):
        a = 2 * math.pi * i / 3
        d = V((math.cos(a), math.sin(a), 0))
        pts = [V((0, 0, 0.095)) + d * 0.03, V((0, 0, zc - radius * 0.55)) + d * (radius * 0.92),
               V((0, 0, zc + radius * 0.25)) + d * (radius * 1.02), V((0, 0, zc + radius * 0.62)) + d * (radius * 0.72)]
        prongs.append(mesh.sweep(pts, [0.011, 0.01, 0.008, 0.005], segments=6, caps=("flat", "round"), rings=10,
                                 name=f"{name}_prong", col=col))
    cr = mesh.join([hd] + prongs, f"{name}_cradle")
    mesh.set_material(cr, ctx.mats["wood_dark"])
    st = []
    for i in range(9):
        th = math.radians(12 + 156 * i / 8)
        st.append({"p": (0, 0, zc - radius * math.cos(th)), "rx": radius * math.sin(th), "ry": radius * math.sin(th)})
    orb = mesh.loft(st, segments=20, caps=("round", "round"), name=f"{name}_orb", col=col, rings=14, cap_len=0.22,
                    smooth_path=False)
    mesh.set_material(orb, ctx.mats["dawnglass"])
    objs = [(f"{name}_cradle", cr), (f"{name}_orb", orb)]
    a = _acc(accent)
    if a:
        o = ring(V((0, 0, zc)), (0.25, 0.0, 1.0), radius * 1.28, section=(0.004, 0.008), n=28, name=f"{name}_inlay", col=col)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    _socket(ctx, socket, hand, zc)
    return place_prop(ctx, objs, hand, uv=1.2)


def round_shield(ctx, *, radius: float = 0.36, hand: str | None = "L", boss: bool = True, accent=None,
                 bevel: float = 0.03, name: str = "shield") -> list:
    """Round carved-wood shield (prop space: face toward -Y, the fist on the centre grip bar along
    +Z), waxed-leather rim, honed-stone boss. accent: a glass channel round the boss."""
    col = ctx.col
    R = radius
    disc = mesh.loft([{"p": (0, -0.03, 0), "rx": R * 0.96, "ry": R * 0.96}, {"p": (0, -0.045, 0), "rx": R, "ry": R},
                      {"p": (0, -0.062, 0), "rx": R * 0.97, "ry": R * 0.97}], segments=32, caps=("flat", "flat"),
                     up=(0, 0, 1), name=name, col=col, smooth_path=False, rings=3)
    mesh.bevel(disc, bevel_w(bevel, 0.032), 2, angle=30)
    mesh.set_material(disc, ctx.mats["wood"])
    rim = ring(V((0, -0.046, 0)), (0, 1, 0), R + 0.004, section=(0.018, 0.022), n=40, name=f"{name}_rim", col=col)
    mesh.set_material(rim, ctx.mats["leather"])
    objs = [(name, disc), (f"{name}_rim", rim)]
    if boss:
        bs = mesh.loft([{"p": (0, -0.058, 0), "rx": R * 0.26, "ry": R * 0.26}, {"p": (0, -0.075, 0), "rx": R * 0.24, "ry": R * 0.24},
                        {"p": (0, -0.088, 0), "rx": R * 0.16, "ry": R * 0.16}], segments=20, caps=("flat", "round"),
                       up=(0, 0, 1), name=f"{name}_boss", col=col, smooth_path=False, rings=3, cap_len=0.5)
        mesh.set_material(bs, ctx.mats["stone"])
        objs.append((f"{name}_boss", bs))
    bar = mesh.loft([{"p": (0, 0, -0.08), "rx": 0.018, "ry": 0.016}, {"p": (0, -0.012, 0), "rx": 0.02, "ry": 0.018},
                     {"p": (0, 0, 0.08), "rx": 0.018, "ry": 0.016}], segments=8, caps=("round", "round"),
                    name=f"{name}_bar", col=col)
    posts = [mesh.loft([{"p": (0, 0.0, z), "rx": 0.02, "ry": 0.02}, {"p": (0, -0.034, z), "rx": 0.022, "ry": 0.022}],
                       segments=8, caps=("flat", "flat"), up=(0, 0, 1), name=f"{name}_post", col=col, smooth_path=False)
             for z in (-0.08, 0.08)]
    bj = mesh.join([bar] + posts, f"{name}_grip")
    mesh.set_material(bj, ctx.mats["wood_dark"])
    objs.append((f"{name}_grip", bj))
    a = _acc(accent)
    if a:
        o = ring(V((0, -0.063, 0)), (0, 1, 0), R * 0.33, section=(0.003, 0.01), n=28, name=f"{name}_inlay", col=col)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    return place_prop(ctx, objs, hand, uv=1.1)


def _disc(col, c, n, r, chalk, glass, name):
    n = V(n).normalized()
    d = mesh.loft([{"p": c - n * 0.009, "rx": r * 0.86, "ry": r * 0.86}, {"p": c - n * 0.004, "rx": r, "ry": r},
                   {"p": c + n * 0.004, "rx": r, "ry": r}, {"p": c + n * 0.009, "rx": r * 0.86, "ry": r * 0.86}],
                  segments=22, caps=("flat", "flat"), up=tuple(n.orthogonal()), name=name, col=col, smooth_path=False, rings=4)
    mesh.set_material(d, chalk)
    e = ring(c, n, r * 0.99, section=(0.0045, 0.006), n=28, name=f"{name}_edge", col=col)
    mesh.set_material(e, glass)
    return [d, e]


def discs(ctx, *, radius: float = 0.075, hand: str | None = "R", holster: int = 3, accent=None,
          socket: str | None = "x_disc", name: str = "disc") -> list:
    """Thrown discs: chalk discs with a dawnglass edge. One held flat in the fist (rim in the grip),
    `holster` more stacked in a leather holster on the right hip (bind hips). accent: a glass dot
    channel across the held disc."""
    col = ctx.col
    held = _disc(col, V((0, 0, radius * 0.95)), (1, 0, 0), radius, ctx.mats["chalk"], ctx.mats["dawnglass"], f"{name}_held")
    hj = mesh.join(held, f"{name}_held")
    objs = [(f"{name}_held", hj)]
    a = _acc(accent)
    if a:
        o = mesh.loft([{"p": (0.0095, 0, radius * 0.45), "rx": 0.006, "ry": 0.002, "ry2": 0.004},
                       {"p": (0.0095, 0, radius * 1.45), "rx": 0.006, "ry": 0.002, "ry2": 0.004}], segments=6,
                      caps=("round", "round"), up=(1, 0, 0), name=f"{name}_inlay", col=col, smooth_path=False)
        mesh.set_material(o, ctx.mats["accent"])
        objs.append((f"{name}_inlay", o))
    _socket(ctx, socket, hand, radius * 0.95)
    out = place_prop(ctx, objs, hand)
    if holster and ctx.info:
        J = ctx.info.joints
        s0 = J["spine0"]
        tree = mesh.bvh_of(_targets(ctx))
        p = kit.surface(_waist_axis(), -100.0, s0.z - 0.14, tree, 0.02)
        n = (p - V((0, 0, p.z))).normalized()
        dd = []
        for i in range(holster):
            dd += _disc(col, p + n * (0.02 + 0.02 * i) + V((0, 0, 0.0)), n, radius, ctx.mats["chalk"],
                        ctx.mats["dawnglass"], f"{name}_h{i}")
        hj2 = mesh.join(dd, f"{name}_stack")
        side = V((0, 0, 1)).cross(n).normalized()
        hol = mesh.loft([{"p": p + n * 0.006 - side * (radius + 0.01), "rx": 0.03, "ry": 0.012},
                         {"p": p + n * 0.03 - side * (radius + 0.018), "rx": 0.035, "ry": 0.04},
                         {"p": p + n * 0.006 - side * (radius + 0.01) + n * 0.06, "rx": 0.03, "ry": 0.012}], segments=8,
                        caps=("round", "round"), up=(0, 0, 1), name=f"{name}_holster", col=col)
        mesh.set_material(hol, ctx.mats["leather"])
        out += [Part(f"{name}_stack", low=hj2, bind="bone:hips"), Part(f"{name}_holster", low=hol, bind="bone:hips")]
    return out


def _shard(col, base, d, length, width, name):
    d = V(d).normalized()
    up = d.orthogonal()
    return mesh.loft([{"p": base, "rx": width * 0.35, "ry": width * 0.25, "exp": 1.0},
                      {"p": base + d * length * 0.28, "rx": width, "ry": width * 0.62, "exp": 1.0},
                      {"p": base + d * length * 0.62, "rx": width * 0.7, "ry": width * 0.45, "exp": 1.0},
                      {"p": base + d * length, "rx": 0.002, "ry": 0.002, "exp": 1.0}], segments=4,
                     caps=("flat", "point"), up=tuple(up), name=name, col=col, rings=8)


def shards(ctx, *, length: float = 0.26, width: float = 0.028, hand: str | None = "R", bandolier: int = 4,
           accent=None, socket: str | None = "x_shard", name: str = "shard") -> list:
    """Thrown dawnglass shards (the Lumen motif: glass, never a gem cut): one held point-forward in
    the fist (wrapped leather base), `bandolier` more in loops on a strap across the chest (bind
    chest). accent: the held shard's core is the accent glass."""
    col = ctx.col
    sh = _shard(col, V((0, 0, 0.03)), (0, 0, 1), length, width, f"{name}_held")
    mesh.set_material(sh, ctx.mats["accent"] if accent else ctx.mats["dawnglass"])
    wr = mesh.loft([{"p": (0, 0, -0.05), "rx": 0.018, "ry": 0.016}, {"p": (0, 0, 0.045), "rx": 0.02, "ry": 0.016}],
                   segments=8, caps=("round", "round"), name=f"{name}_wrap", col=col, smooth_path=False)
    mesh.set_material(wr, ctx.mats["leather"])
    _socket(ctx, socket, hand, 0.03 + length)
    out = place_prop(ctx, [(f"{name}_held", sh), (f"{name}_wrap", wr)], hand)
    if bandolier and ctx.info:
        J = ctx.info.joints
        nb, s0 = J["neck_base"], J["spine0"]
        path = [(40 - 80 * i / 10, nb.z - 0.03 - (nb.z - s0.z - 0.06) * i / 10) for i in range(11)]
        out += strap(ctx, path, width=0.045, name=f"{name}_bandolier")
        tree = mesh.bvh_of(_targets(ctx))
        axis = _waist_axis()
        ss = []
        for i in range(bandolier):
            t = 0.25 + 0.5 * i / max(1, bandolier - 1)
            u, z = path[int(t * 10)]
            p = kit.surface(axis, u, z, tree, 0.03)
            ss.append(_shard(col, p + V((0, 0, -0.06)), (0.2, -0.1, 1.0), length * 0.55, width * 0.8, f"{name}_b{i}"))
        sj = mesh.join(ss, f"{name}_spares")
        mesh.set_material(sj, ctx.mats["dawnglass"])
        out.append(Part(f"{name}_spares", low=sj, bind="bone:chest"))
    return out
