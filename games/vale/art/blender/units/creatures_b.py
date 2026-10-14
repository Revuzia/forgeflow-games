"""VALE RIFT monsters, set B (neutral, no `accent`): skinned + animated GLBs.

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/creatures_b.py --
            [--only longshade,sunsplinter,...] [--fast] [--no-qa] [--icons-only]

  longshade        4.2 m  late siege objective: a beast of ink-dark shade that rises out of its own long
                          shadow. Front half: a hunched torso on two very long clawed forelimbs, a pale chalk
                          mask-plate (carved hour-lines fanning from the chin, two lamp eyes) on a hooded neck,
                          an ink-smoke crest; back half: no hind legs, the body pours into a flat shadow-tail
                          that lies on the ground and follows the body (world-space ground chain).
                          Clips idle, run (forelimb pull-crawl), attack1 (claw), cast_a1 (Shadow Sweep),
                          cast_a2 (Pooled Shade), cast_a3 (Full Length: 1.6 s rear + crash), death (collapse and
                          flatten into the ground; the lamps go out).
  sunsplinter      3.2 m  repeatable objective: the Needle's broken tip floating over a core of noon light
  gloamoth         1.6 m  regular camp: a big hovering moth of dusk light (lamp-shade wings)
  gloamoth_little  0.8 m  its rounder, fluffier companion
  stray_numeral    2.4 m  regular camp: a chalk numeral stroke-figure that hops like a stiff stone puppet
  stray_tick       1.0 m  a single carved tick mark that hops

Kit: creature_kit.py (armature from a joint table, analytic 2-bone limb IK, SDF bodies, baked paint),
extended here with per-bone pose overrides (armature-space offsets, uniform scale, absolute matrices),
a root scale track (death flatten), ground chains (tails that lie on the ground and follow the body),
tag-bound rigid pieces (each shard / chunk / claw on its own bone) and a 128² icon renderer.
Glow (eyes, wings, the noon core) stays at emissive <= 0.8 (a glow is a warning); bosses telegraph
by scaling their glowing parts up in the wind-ups. Impact frames at 40 % of attack / cast clips
(frame counts are multiples of 5).

Outputs: art/out/units/<id>.glb, art/out/units/{sunsplinter,longshade}_icon.png (128²),
art/renders/units/<id>.png (three.js contact sheet), art/renders/units/build_report_<id>.json,
art/.cache/units/<id>.blend.
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from common import bake, export, imageops, materials, mesh, render, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import Capsule, Ellipsoid, HalfSpace, RoundBox, RoundCone, Sculpt, Sphere  # noqa: E402
import creature_kit as K  # noqa: E402
from creature_kit import B, Clip, Leg, LegDef, lerp, rot, smooth, spline, wave  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "units")
RENDERS = os.path.join(scene.RENDERS_DIR, "units")
CACHE = os.path.join(scene.CACHE_DIR, "units")
TEXCACHE = os.path.join(scene.CACHE_DIR, "textures", "units")
NOISE = sdf.Noise(53)
NODE_BIN = "/opt/homebrew/opt/node@22/bin"
for _p in (NODE_BIN, "/opt/homebrew/bin"):
    if os.path.isdir(_p) and _p not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _p + os.pathsep + os.environ.get("PATH", "")     # optimize.mjs: node 22, ffmpeg
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


# ── small helpers ────────────────────────────────────────────────────────────────────────────────
def V3(p):
    return np.asarray(p, dtype=np.float64)


def mirror(p, s=-1):
    return (p[0] * s, p[1], p[2])


def sarr(a, b, x):
    """Vectorised smoothstep from a to b (a > b allowed: falling)."""
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def pivot(R, c, h):
    """hips_loc that rotates the body by R about point c (instead of the hips head h)."""
    c, h = V3(c), V3(h)
    return c + R @ (h - c) - h


def bump(t, a, b):
    """0 -> 1 -> 0 over [a, b] (sine hump)."""
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a))


def mix_hex(col, key_col, w):
    w = np.asarray(w, dtype=np.float64)[:, None]
    return col * (1 - w) + key_col * w


def tube_path(base, direction, length, curl_axis=None, curl_deg=0.0, segs=3):
    """Points of a curved stroke: starts at `base` along `direction`, bending by curl_deg about
    curl_axis over its length."""
    d = K.nrm(direction)
    pts = [V3(base)]
    for k in range(segs):
        if curl_axis is not None and curl_deg:
            dk = K.rodrigues(d, curl_axis, math.radians(curl_deg) * (k + 0.5) / segs)
        else:
            dk = d
        pts.append(pts[-1] + dk * length / segs)
    return pts


def mat4(R=None, t=None, s=1.0):
    M = np.eye(4)
    if R is not None:
        M[:3, :3] = np.asarray(R) * s
    elif s != 1.0:
        M[:3, :3] *= s
    if t is not None:
        M[:3, 3] = t
    return M


class GSculpt(Sculpt):
    """A Sculpt cut flat at the ground (z >= ground) slice by slice: a global HalfSpace `inter` would
    evaluate the whole grid at once (gigabytes for a 4 m monster)."""

    def __init__(self, name="sdf", ground: float = 0.006, k: float = 0.006):
        super().__init__(name)
        self.ground, self.gk = float(ground), float(k)

    def evaluate(self, voxel, bounds=None, log=None):
        D, lo = super().evaluate(voxel, bounds, log)
        zs = lo[2] + voxel * np.arange(D.shape[2])
        for i, z in enumerate(zs):
            if z < self.ground + 3 * self.gk + voxel:
                D[:, :, i] = sdf.smax(D[:, :, i], np.float32(self.ground - z), self.gk)
        return D, lo


def surface_point(prim, origin, direction, far: float = 4.0, step: float = 0.01):
    """First inside -> outside crossing of an SDF along a ray from an interior origin."""
    o, d = V3(origin), K.nrm(direction)
    ts = np.arange(0.0, far, step)
    dd = prim.d(o[None, :] + ts[:, None] * d[None, :])
    i = int(np.argmax(dd > 0))
    a, b = ts[max(0, i - 1)], ts[i]
    for _ in range(20):
        m = (a + b) / 2
        if prim.d((o + m * d)[None, :])[0] > 0:
            b = m
        else:
            a = m
    return o + d * (a + b) / 2


def blend_of(S: Sculpt):
    return sdf.Blend([(op, prim, k) for op, prim, k, _ in S.ops])


class Cut(sdf.Prim):
    """A primitive cut by planes (point, outward normal): broken, faceted ends on stone pieces."""

    def __init__(self, base, planes, k: float = 0.008):
        self.base, self.planes, self.k = base, [(V3(p), K.nrm(n)) for p, n in planes], float(k)

    def bounds(self):
        return self.base.bounds()

    def d(self, P):
        d = self.base.d(P)
        for p, n in self.planes:
            d = sdf.smax(d, (P - p) @ n, self.k)
        return d


class Pyramidion(sdf._Framed):
    """A square needle shaft (half-width w0 at z=0 -> w1 at z=Ls) capped by a pyramid to a point at Ls+Lp,
    in the frame's local Z."""

    def __init__(self, c, axes, w0, w1, Ls, Lp):
        super().__init__(c, axes)
        self.w0, self.w1, self.Ls, self.Lp = float(w0), float(w1), float(Ls), float(Lp)

    def bounds(self):
        w = max(self.w0, self.w1) * 1.5
        return self._corners_z(w)

    def _corners_z(self, w):
        pts = np.array([[sx * w, sy * w, z] for sx in (-1, 1) for sy in (-1, 1) for z in (-0.05, self.Ls + self.Lp + 0.05)])
        wp = pts @ self.ax + self.c
        return wp.min(0), wp.max(0)

    def d(self, P):
        p = self.local(P)
        z = p[:, 2]
        hw_s = self.w0 + (self.w1 - self.w0) * np.clip(z / self.Ls, 0, 1)
        hw_p = self.w1 * np.clip(1 - (z - self.Ls) / self.Lp, 0, 1)
        hw = np.where(z < self.Ls, hw_s, hw_p)
        q = np.maximum(np.abs(p[:, 0]), np.abs(p[:, 1])) - hw
        return np.maximum(np.maximum(q * 0.85, -z), z - (self.Ls + self.Lp))


def crystal(verts, faces, a, b, ra, rb, sides=6, tip=0.0, twist=0.0, base_tip=0.0):
    """A faceted prism a->b (radius ra->rb), pointed beyond b by `tip` (and beyond a by `base_tip`)."""
    a, b = V3(a), V3(b)
    F = sdf.frame(b - a)
    x, y = F[0], F[1]
    i0 = len(verts)
    for r, c in ((ra, a), (rb, b)):
        for k in range(sides):
            ang = 2 * math.pi * k / sides + twist
            verts.append(c + r * (math.cos(ang) * x + math.sin(ang) * y))
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((i0 + k, i0 + k2, i0 + sides + k2, i0 + sides + k))
    d = K.nrm(b - a)
    if tip > 0:
        apex = len(verts)
        verts.append(b + d * tip)
        for k in range(sides):
            faces.append((i0 + sides + k, i0 + sides + (k + 1) % sides, apex))
    else:
        faces.append(tuple(i0 + sides + k for k in range(sides)))
    if base_tip > 0:
        apex = len(verts)
        verts.append(a - d * base_tip)
        for k in range(sides):
            faces.append((i0 + (k + 1) % sides, i0 + k, apex))
    else:
        faces.append(tuple(i0 + k for k in reversed(range(sides))))


def mesh_object(name, verts, faces, col, smooth_shade=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.data.polygons.foreach_set("use_smooth", np.full(len(ob.data.polygons), smooth_shade, dtype=bool))
    return ob


def rigid_T(p_from, p_to, R):
    """4x4 rigid transform: rotate by R about p_from, then move p_from to p_to."""
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = V3(p_to) - R @ V3(p_from)
    return T


def slerp_R(R0, R1, t):
    from mathutils import Matrix as _M
    q0 = _M(np.asarray(R0).tolist()).to_quaternion()
    q1 = _M(np.asarray(R1).tolist()).to_quaternion()
    return np.array(q0.slerp(q1, float(min(1.0, max(0.0, t)))).to_matrix())


# ── extended pose / rig ──────────────────────────────────────────────────────────────────────────
@dataclass
class PoseB(K.Pose):
    loc: dict = field(default_factory=dict)       # bone -> armature-space offset added after the bone's rotation
    scl: dict = field(default_factory=dict)       # bone -> uniform scale (children inherit it)
    world: dict = field(default_factory=dict)     # bone -> absolute armature-space 4x4 (replaces FK)
    chains: list = field(default_factory=list)    # ground chains: dicts (bones, phis, zs) laid in world space
    root_scale: tuple | None = None               # world-axes scale of the whole pose about the origin

    def r(self, bone: str, p=0.0, y=0.0, r=0.0):
        R = rot(p, y, r)
        self.rot[bone] = R @ self.rot[bone] if bone in self.rot else R
        return self

    def R(self, bone: str, M):
        """Pre-multiply an arbitrary armature-axes rotation matrix."""
        M = np.asarray(M, dtype=np.float64)
        self.rot[bone] = M @ self.rot[bone] if bone in self.rot else M
        return self


class RigB(K.Rig):
    def __init__(self, arm, legs):
        super().__init__(arm, legs)
        self.chain_first = {}

    def rest_pose(self) -> PoseB:
        return PoseB(legs={n: self.rest_leg(n) for n in self.legs})

    def _chain(self, ch: dict, P: dict, Mp: np.ndarray):
        """Lay a chain of bones on the ground in world space: joint i+1 sits at height zs[i+1] (or as close as
        the bone length allows), heading phis[i] (degrees, 0 = straight back along +Y, + toward +X)."""
        bones = ch["bones"]
        p = (Mp @ self.local[bones[0]])[:3, 3].copy()
        zs = ch["zs"]
        up = np.array([0.0, 0.0, 1.0])
        for i, b in enumerate(bones):
            L = self.length[b]
            zt = zs[i + 1] if i + 1 < len(zs) else zs[-1]
            dz = zt - p[2]
            if abs(dz) > 0.96 * L:
                dz = math.copysign(0.96 * L, dz)
            dh = math.sqrt(max(L * L - dz * dz, 1e-8))
            ph = math.radians(ch["phis"][i])
            q = p + np.array([math.sin(ph) * dh, math.cos(ph) * dh, dz])
            Y = K.nrm(q - p)
            Xv = np.cross(Y, up)
            Xv = K.nrm(Xv) if np.linalg.norm(Xv) > 1e-6 else np.array([1.0, 0, 0])
            Z = np.cross(Xv, Y)
            M = np.eye(4)
            M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = Xv, Y, Z, p
            P[b] = M
            p = q

    def solve(self, pose) -> dict:
        P = {}
        loc = getattr(pose, "loc", {})
        scl = getattr(pose, "scl", {})
        world = getattr(pose, "world", {})
        chains = {c["bones"][0]: c for c in getattr(pose, "chains", [])}
        for n in self.order:
            if n in P:
                continue
            par = self.parent[n]
            Mp = P[par] if par else np.eye(4)
            if n in chains:
                self._chain(chains[n], P, Mp)
                continue
            if n in self.leg_of_upper:
                self._leg(self.leg_of_upper[n], Mp, pose, P)
                continue
            if n == "hips":
                M = Mp @ self.local[n] if par else self.rest[n].copy()
                M[:3, :3] = pose.hips_rot @ M[:3, :3]
                M[:3, 3] = M[:3, 3] + pose.hips_loc
                if n in pose.rot:
                    Rr = self.rest[n][:3, :3]
                    M[:3, :3] = M[:3, :3] @ (Rr.T @ pose.rot[n] @ Rr)
            else:
                M = Mp @ self.local[n]
                R = pose.rot.get(n)
                if R is not None:
                    Rr = self.rest[n][:3, :3]
                    bs = np.eye(4)
                    bs[:3, :3] = Rr.T @ R @ Rr
                    M = M @ bs
            if n in world:
                M = np.array(world[n], dtype=np.float64)
            if n in loc:
                M = M.copy()
                M[:3, 3] += V3(loc[n])
            if n in scl and abs(scl[n] - 1.0) > 1e-9:
                M = M.copy()
                M[:3, :3] *= scl[n]
            P[n] = M
        return P

    def basis3(self, P: dict) -> dict:
        out = {}
        for n in self.order:
            par = self.parent[n]
            ref = (P[par] @ self.local[n]) if par else self.rest[n]
            Bm = np.linalg.inv(ref) @ P[n]
            loc, q, s = Matrix(Bm.tolist()).decompose()
            out[n] = (np.array(loc), np.array([q.w, q.x, q.y, q.z]), np.array(s))
        return out


def write_clip(rig: RigB, clip: Clip) -> dict:
    """Sample the clip at every frame -> one layered action (LINEAR keys) on a muted NLA track. Rotation for
    every bone; location / scale only where a bone actually moves / scales; a root scale track when the
    pose asks for one."""
    arm = rig.arm
    rig.reach_log = []
    rig.soft_log = []
    poses = [clip.fn(f / clip.frames) for f in range(clip.frames + 1)]
    if clip.loop:
        poses[-1] = poses[0]
    mats = [rig.solve(p) for p in poses]
    bases = [rig.basis3(P) for P in mats]
    old = bpy.data.actions.get(clip.name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(clip.name)
    act.use_fake_user = True
    layer = act.layers.new("Layer")
    strip = layer.strips.new(type="KEYFRAME")
    slot = act.slots.new(id_type="OBJECT", name=arm.name)
    cb = strip.channelbag(slot, ensure=True)
    n = len(bases)
    frames = np.arange(n, dtype=np.float64)

    def keys(b, prop, arr):
        dp = f'pose.bones["{b}"].{prop}'
        for i in range(arr.shape[1]):
            fc = K._fcurve(cb, dp, i, b)
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", np.stack([frames, arr[:, i]], 1).ravel())
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()

    for b in rig.order:
        if b == "root":
            rs = np.array([p.root_scale if getattr(p, "root_scale", None) is not None else (1.0, 1.0, 1.0)
                           for p in poses], dtype=np.float64)
            if np.abs(rs - 1).max() > 1e-6:
                # root rest axes: X = world X, Y = world -Y, Z = world -Z (scale magnitudes map 1:1)
                keys(b, "scale", rs)
            continue
        qs = np.array([bs[b][1] for bs in bases])
        for i in range(1, n):
            if qs[i] @ qs[i - 1] < 0:
                qs[i] = -qs[i]
        keys(b, "rotation_quaternion", qs)
        ls = np.array([bs[b][0] for bs in bases])
        if b == "hips" or np.abs(ls).max() > 1e-5:
            keys(b, "location", ls)
        ss = np.array([bs[b][2] for bs in bases])
        if np.abs(ss - 1).max() > 1e-5:
            keys(b, "scale", ss)
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = n - 1
    act.use_cyclic = False
    ad = arm.animation_data or arm.animation_data_create()
    tr = ad.nla_tracks.new()
    tr.name = clip.name
    st = tr.strips.new(clip.name, 0, act)
    try:
        st.action_slot = slot
    except (AttributeError, TypeError):
        pass
    tr.mute = True
    reach = sorted(set(rig.reach_log))
    if reach:
        scene.log(f"  {clip.name}: limb reach clamped {len(rig.reach_log)}x: {reach[:8]}")
    return {"frames": clip.frames, "duration_s": round(clip.duration, 4), "loop": clip.loop,
            "impact": clip.impact, "reach_clamps": len(rig.reach_log), "soft_reach": len(rig.soft_log)}


# ── materials ────────────────────────────────────────────────────────────────────────────────────
def painted_stone(name: str, hexcol: str, grad, chisel: float = 1.0, scale: float = 1.0, chalk=(1.3, 0.6),
                  pores: float = 0.10):
    """Bake source for carved stone: vertex colour (Col RGB albedo, A roughness) under the bible's painted
    cues, broad chisel facets, pores."""
    m, g = materials._new(name)
    at = g.n("ShaderNodeAttribute")
    at.attribute_name = "Col"
    at.attribute_type = "GEOMETRY"
    c = materials.painted_breakup(g, at.outputs["Color"], amount=0.07, scale=2.2 * scale, hue=0.008)
    vc = g.voronoi(scale=6.0 * scale, feature="F1")
    if chisel > 0:
        c = g.mix(c, g.ramp(vc.outputs["Color"], [(0.0, 0.94), (1.0, 1.05)]), 0.6 * chisel, "MULTIPLY")
    c, e = materials.paint(g, c, hexcol, grad, chalk=chalk)
    pn = g.noise(scale=130.0 * scale, detail=3.0, rough=0.6)
    vb = g.voronoi(scale=6.0 * scale, feature="DISTANCE_TO_EDGE")
    h = g.math("ADD", g.math("MULTIPLY", pn.outputs["Fac"], 0.5),
               g.math("MULTIPLY", g.ramp(vb.outputs["Distance"], [(0.0, 0.0), (0.08, 1.0)]), 0.5 * chisel))
    g.set_bsdf(color=c, rough=at.outputs["Alpha"], metal=0.0, normal=g.bump(h, strength=pores, distance=0.004))
    return m


def painted_glass(name: str, grad, gloss: float = 0.6):
    """Bake source for dawnglass / lit glass from vertex colour: soft internal streaks, suspended
    inclusions, bright catch-light edges."""
    m, g = materials._new(name)
    at = g.n("ShaderNodeAttribute")
    at.attribute_name = "Col"
    at.attribute_type = "GEOMETRY"
    c = at.outputs["Color"]
    st = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 2.5)), scale=7.0, detail=2.0, rough=0.5, distortion=1.3)
    c = g.mix(c, g.ramp(st.outputs["Fac"], [(0.3, 0.85), (0.7, 1.1)]), 1.0, "MULTIPLY")
    sp = g.voronoi(scale=40.0, feature="F1")
    dots = g.ramp(sp.outputs["Distance"], [(0.0, 1.0), (0.08, 0.0)])
    c = g.mix(c, (1.0, 1.0, 1.0, 1.0), g.math("MULTIPLY", dots, 0.25))
    e = materials.edge_mask(g, 0.012, 8.0)
    c = g.mix(c, (0.95, 0.97, 1.0, 1.0), g.math("MULTIPLY", e, 0.45))
    c = materials.top_light(g, c, 0.15)
    g.set_bsdf(color=c, rough=at.outputs["Alpha"], metal=0.0, specular=gloss,
               normal=g.bump(st.outputs["Fac"], strength=0.04, distance=0.002))
    return m


# ════════════════════════════════════════════════════════════════════════════════════════════════
class Monster:
    ID = ""
    HEIGHT = 1.0
    BODY_TOP = 1.0
    RUN_SPEED = 3.0
    TEX = 1024
    TEX_SIZES = {"orm": 512}
    VOX_LOW = 0.012
    VOX_HIGH = 0.008
    VOX_PART = {}                  # part -> low voxel
    VOX_HIGH_PART = {}             # part -> high voxel
    TRIS = {"body": 6000}
    SYMMETRIC = {}                 # part -> symmetric decimation
    CLIPS = ("idle", "run", "attack1", "death")
    HEAT_EXCLUDE = ("root",)
    GLOW = {}                      # part -> (material name, emissive strength <= 0.8)
    UV_WEIGHTS = {}                # part NAME -> texel weight (mapped to part ids at build time)
    BAKE_RAY = (0.02, 0.07)
    AO_DIST = 0.3
    PART_BIND = {}                 # part -> None (bone heat) | "transfer" | bone | ("tags", {tag: bone}) | callable
    NO_AO = ()                     # parts whose baked AO is divided back out (thin flapping wings)
    FEET = ()                      # planted-joint bones for the run foot-slide check
    WRIST_MIN = 0.03
    BALL_MIN = 0.0
    ICON = False
    ICON_LIGHT = (1.0, 1.0, 1.0)                    # key, fill, rim multipliers
    ICON_BG = ((0.20, 0.17, 0.22), (0.045, 0.04, 0.06))   # dark ink wash: centre, edge (display sRGB)

    def __init__(self):
        self.J = self.joints()
        self.low_sculpts = {}
        self.part_verts = {}       # part -> rest vertices of the low (world)
        self.piece_tags = {}       # multi-piece part -> piece sculpt names (vale_piece index -> tag)
        self.tag_verts = {}        # (part, tag) -> rest vertices of the low

    def joints(self) -> dict:
        return {}

    def bones(self) -> list:
        raise NotImplementedError

    def legdefs(self) -> list:
        return []

    def sculpts(self, detail: bool) -> dict:
        return {}

    def hard(self, col) -> list:
        """[(part, low obj, bind, high obj or None)]"""
        return []

    def paint(self, part, V, N, tags) -> tuple:
        raise NotImplementedError

    def high_material(self, part, grad):
        raise NotImplementedError

    def hard_material(self, part, grad):
        """A procedural bake-source material for a hard part, or None (vertex-painted via paint())."""
        return None

    def ao_free_polys(self, low):
        """Polygons whose baked AO is divided back out (faces hidden in the rest pose that a clip reveals)."""
        return None

    def weight_fix(self, ob):
        pass

    def clips(self, rig) -> list:
        raise NotImplementedError

    def icon_setup(self, rig):
        """-> (clip, frame, look-at target, camera yaw deg, pitch deg, frame height m)"""
        raise NotImplementedError


def bind_by_tags(ob, arm, S: Sculpt, tag_bone: dict, piece_tags=None) -> dict:
    """Rigid pieces: every vertex of `ob` goes (weight 1) to the bone of its piece: the piece it was meshed from
    (vale_piece attribute of multi-piece parts) or else its nearest tagged primitive."""
    V, _ = K.arrays(ob)
    V = np.array([ob.matrix_world @ Vector(p) for p in V])
    if piece_tags is not None and "vale_piece" in ob.data.attributes:
        pv = np.empty(len(ob.data.vertices), dtype=np.int32)
        ob.data.attributes["vale_piece"].data.foreach_get("value", pv)
        keys = [t for t in piece_tags if t in tag_bone]
        near = np.array([keys.index(piece_tags[i]) for i in pv])
    else:
        tags = K.tag_distances(S, V, pad=0.2)
        keys = [t for t in tags if t in tag_bone]
        D = np.stack([tags[t] for t in keys])
        near = np.argmin(D, 0)
    # every connected island (one rigid piece) goes wholly to its majority tag: a vertex near another piece must
    # not be dragged off with it
    me = ob.data
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    parent = np.arange(len(V))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a_, b_ in e:
        ra, rb = find(a_), find(b_)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(len(V))])
    for r in np.unique(roots):
        m = roots == r
        near[m] = np.bincount(near[m], minlength=len(keys)).argmax()
    ob.vertex_groups.clear()
    out = {}
    for j, t in enumerate(keys):
        b = tag_bone[t]
        vg = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
        idx = np.nonzero(near == j)[0].tolist()
        if idx:
            vg.add(idx, 1.0, "REPLACE")
        out.setdefault(t, V[near == j])
    mesh.add_armature_modifier(ob, arm)
    mesh.parent_keep(ob, arm)
    return out


def part_uv_mask(low, part_id, w: int, h: int, poly_sel=None) -> np.ndarray:
    """(h, w) coverage of one part's UV triangles (or of the polygons in poly_sel), row 0 = bottom."""
    me = low.data
    me.calc_loop_triangles()
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2) * np.array([w, h])
    tl = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("loops", tl)
    if poly_sel is not None:
        pi = np.empty(len(me.loop_triangles), dtype=np.int64)
        me.loop_triangles.foreach_get("polygon_index", pi)
        sel = np.asarray(poly_sel)[pi]
    else:
        pv = np.empty(len(me.vertices), dtype=np.int32)
        me.attributes["vale_part"].data.foreach_get("value", pv)
        tv = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
        me.loop_triangles.foreach_get("vertices", tv)
        sel = pv[tv.reshape(-1, 3)[:, 0]] == part_id
    M = np.zeros((h, w), dtype=bool)
    for a, b, c in uv[tl.reshape(-1, 3)[sel]]:
        x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0])) - 1)), int(min(w - 1, np.ceil(max(a[0], b[0], c[0])) + 1))
        y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1])) - 1)), int(min(h - 1, np.ceil(max(a[1], b[1], c[1])) + 1))
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
        e = -0.08
        M[y0:y1 + 1, x0:x1 + 1] |= (l1 >= e) & (l2 >= e) & (1 - l1 - l2 >= e)
    return M


def remove_ao(low, body_mat, part_id, poly_sel=None) -> int:
    """Divide the baked whole-body AO back out of one part's texels (thin wings under wings must not carry the
    other wing's occlusion: it would travel with them when they flap) and clear its ORM occlusion."""
    imgs = {n.image.filepath: n.image for n in body_mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}
    base = next(i for p_, i in imgs.items() if p_.endswith("_base.jpg"))
    orm = next(i for p_, i in imgs.items() if p_.endswith("_orm.png"))
    b = bake.image_array(base).copy()
    o = bake.image_array(orm).copy()
    Mb = part_uv_mask(low, part_id, b.shape[1], b.shape[0], poly_sel)
    Mo = part_uv_mask(low, part_id, o.shape[1], o.shape[0], poly_sel)
    # ORM red = 0.55 + 0.45 * ao (bake.py lift when AO is multiplied into the base); resample to the base size
    a = np.clip((o[..., 0] - 0.55) / 0.45, 0, 1)
    ys = (np.arange(b.shape[0]) * o.shape[0] // b.shape[0])
    xs = (np.arange(b.shape[1]) * o.shape[1] // b.shape[1])
    a_b = a[ys][:, xs]
    k = (1.0 - materials.BIBLE_BAKE["ao"]) + materials.BIBLE_BAKE["ao"] * np.power(a_b, 0.8)
    b[..., :3][Mb] = np.clip(b[..., :3][Mb] / np.maximum(k[Mb], 0.25)[:, None], 0, 1)
    o[..., 0][Mo] = 1.0
    bake.set_image_array(base, b)
    bake.save_image(base, bpy.path.abspath(base.filepath), "JPEG", 90)
    base.reload()
    bake.set_image_array(orm, o)
    bake.save_image(orm, bpy.path.abspath(orm.filepath), "PNG")
    orm.reload()
    return int(Mb.sum())


def build(cr: Monster, args) -> dict:
    T = scene.Timer(cr.ID)
    report = {"id": cr.ID}
    scene.reset()
    col = scene.collection(cr.ID)
    src = scene.collection(f"{cr.ID}_src")
    with T.step("rig"):
        arm = K.build_armature(f"{cr.ID}_rig", cr.bones(), col)
        rig = RigB(arm, cr.legdefs())
        P = rig.solve(rig.rest_pose())
        err = max(float(np.abs(P[n] - rig.rest[n]).max()) for n in rig.order)
        report["rest_solve_err"] = err
        if err > 1e-4:
            raise SystemExit(f"{cr.ID}: rest pose solve error {err}")
    grad = materials.bible_gradient(cr.BODY_TOP)
    parts, highs, pid = [], {}, {}
    with T.step("sculpt"):
        lows = cr.sculpts(False)
        his = cr.sculpts(True)
        for name, S in lows.items():
            vox_l, vox_h = cr.VOX_PART.get(name, cr.VOX_LOW), cr.VOX_HIGH_PART.get(name, cr.VOX_HIGH)
            if isinstance(S, list):
                # rigid pieces: each meshed on its own small grid (tris shared by surface area), then joined
                areas = []
                for piece in S:
                    lo_, hi_ = piece.bounds()
                    e = np.maximum(hi_ - lo_, 1e-3)
                    areas.append(2 * (e[0] * e[1] + e[1] * e[2] + e[0] * e[2]))
                areas = np.array(areas) / sum(areas)
                pl = [K.low_from(piece, vox_l, max(40, int(cr.TRIS.get(name, 6000) * a_)), f"{cr.ID}_{name}_{i}", col)
                      for i, (piece, a_) in enumerate(zip(S, areas))]
                for i, ob_ in enumerate(pl):          # remember which piece every vertex came from (rigid binding)
                    at = ob_.data.attributes.new("vale_piece", "INT", "POINT")
                    at.data.foreach_set("value", [i] * len(ob_.data.vertices))
                cr.piece_tags[name] = [piece.name for piece in S]
                low = mesh.join(pl, f"{cr.ID}_{name}")
                phs = []
                for i, hp in enumerate(his[name]):
                    h_ = K.high_from(hp, vox_h, f"{cr.ID}_{name}_hi{i}", src)
                    Vh, Nh = K.arrays(h_)
                    rgb, rough = cr.paint(name, Vh, Nh, K.tag_distances(hp, Vh))
                    K.set_colors(h_, rgb, rough)
                    phs.append(h_)
                hi = mesh.join(phs, f"{cr.ID}_{name}_hi")
                comb = Sculpt(name)
                for piece in S:
                    comb.ops += piece.ops
                S = comb
            else:
                low = K.low_from(S, vox_l, cr.TRIS.get(name, 6000), f"{cr.ID}_{name}", col,
                                 symmetric=cr.SYMMETRIC.get(name, False))
                hi = K.high_from(his[name], vox_h, f"{cr.ID}_{name}_hi", src)
                Vh, Nh = K.arrays(hi)
                tags = K.tag_distances(his[name], Vh)
                rgb, rough = cr.paint(name, Vh, Nh, tags)
                K.set_colors(hi, rgb, rough)
            hi.data.materials.append(cr.high_material(name, grad))
            pid[name] = len(pid)
            cr.low_sculpts[name] = S
            parts.append((name, low, cr.PART_BIND.get(name)))
            highs.setdefault(pid[name], []).append(hi)
            scene.log(f"{name}: low {K.tri_count(low)} tris, high {len(hi.data.polygons)} faces")
        for name, ob, bind, hi in cr.hard(col):
            if name not in pid:
                pid[name] = len(pid)
            if hi is None:
                hi = mesh.duplicate(ob, ob.name + "_hi", src)
            else:
                for c in list(hi.users_collection):
                    c.objects.unlink(hi)
                src.objects.link(hi)
            if not hi.data.materials:
                hm = cr.hard_material(name, grad)
                if hm is None:
                    Vh, Nh = K.arrays(hi)
                    rgb, rough = cr.paint(name, Vh, Nh, {})
                    K.set_colors(hi, rgb, rough)
                    hm = cr.high_material(name, grad)
                hi.data.materials.append(hm)
            highs.setdefault(pid[name], []).append(hi)
            parts.append((name, ob, bind))
            scene.log(f"{name} (hard): {K.tri_count(ob)} tris")
    with T.step("bind"):
        bodies = []
        for name, ob, bind in sorted(parts, key=lambda p: 0 if p[2] is None else 1):
            mesh.set_part(ob, pid[name])
            V, _ = K.arrays(ob)
            cr.part_verts[name] = V.copy()
            if bind is None:
                res = mesh.bind_auto(ob, arm, exclude=cr.HEAT_EXCLUDE)
                report[f"heat_{name}"] = {k: v for k, v in res.items() if k != "empty_groups"}
                cr.weight_fix(ob)
                bodies.append(ob)
            elif bind == "transfer":
                mesh.transfer_weights(bodies[0], ob)
                mesh.add_armature_modifier(ob, arm)
                mesh.parent_keep(ob, arm)
            elif callable(bind):
                bind(ob, arm)
            elif isinstance(bind, tuple) and bind[0] == "tags":
                S = cr.low_sculpts.get(name) or cr.tag_sculpt(name)
                for t, vv in bind_by_tags(ob, arm, S, bind[1], cr.piece_tags.get(name)).items():
                    cr.tag_verts[(name, t)] = vv
            else:
                mesh.bind_rigid(ob, arm, bind)
        low = mesh.join([p[1] for p in parts], cr.ID)
        if low.data.validate(verbose=False, clean_customdata=False):
            scene.log("validate: repaired the joined low")
        report["tris"] = K.tri_count(low)
        report["parts"] = {n: pid[n] for n in pid}
    with T.step("uv"):
        bake.unwrap(low, weights={pid[k]: w for k, w in cr.UV_WEIGHTS.items() if k in pid})
        report["uv_coverage"] = round(bake.uv_coverage(low), 3)
    with T.step("bake"):
        res = bake.bake_asset(low, highs, os.path.join(TEXCACHE, cr.ID), name=cr.ID, size=cr.TEX,
                              samples=4, ao_samples=48 if not args.fast else 8, ao_distance=cr.AO_DIST,
                              cage=cr.BAKE_RAY[0], ray=cr.BAKE_RAY[1], mat_name=f"{cr.ID}_body", fast=args.fast,
                              ao_into_base=materials.BIBLE_BAKE["ao"], sizes=dict(cr.TEX_SIZES))
        report["bake"] = res["timings"]
        body_mat = res["material"]
        base_img = next(n.image for n in body_mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
                        and n.image.filepath.endswith("_base.jpg"))
        report["bake_holes_filled"] = K.fill_bake_holes(base_img, low)
        for part in cr.NO_AO:
            if part in pid:
                report[f"no_ao_{part}"] = remove_ao(low, body_mat, pid[part])
        sel = cr.ao_free_polys(low)
        if sel is not None and sel.any():
            report["no_ao_faces"] = remove_ao(low, body_mat, None, sel)
        for part, spec in cr.GLOW.items():
            if part not in pid:
                continue
            mname, strength = spec[0], min(0.8, spec[1])
            flat_hex = spec[2] if len(spec) > 2 else None
            if flat_hex:
                # factor-only lamp: flat warm light (no baked AO darkening a lamp sunk in a socket)
                gm = bpy.data.materials.new(mname)
                gm.use_nodes = True
                bsdf = gm.node_tree.nodes.get("Principled BSDF")
                lin = materials.shade_hex(flat_hex)
                bsdf.inputs["Base Color"].default_value = lin
                bsdf.inputs["Emission Color"].default_value = lin
                bsdf.inputs["Emission Strength"].default_value = strength
                bsdf.inputs["Roughness"].default_value = 0.35
            else:
                gm = body_mat.copy()
                gm.name = mname
                nt = gm.node_tree
                bsdf = nt.nodes["BSDF"]
                img = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and n.image.filepath.endswith("_base.jpg"))
                nt.links.new(img.outputs["Color"], bsdf.inputs["Emission Color"])
                bsdf.inputs["Emission Strength"].default_value = strength
            low.data.materials.append(gm)
            mi = len(low.data.materials) - 1
            pv = np.empty(len(low.data.vertices), dtype=np.int32)
            low.data.attributes["vale_part"].data.foreach_get("value", pv)
            idx = np.empty(len(low.data.polygons), dtype=np.int32)
            low.data.polygons.foreach_get("material_index", idx)
            for p in low.data.polygons:
                if pv[p.vertices[0]] == pid[part]:
                    idx[p.index] = mi
            low.data.polygons.foreach_set("material_index", idx)
    for o in list(src.objects):
        o.hide_render = True
        o.hide_viewport = True
    for a_ in ("vale_part", "vale_piece"):
        if a_ in low.data.attributes:
            low.data.attributes.remove(low.data.attributes[a_])
    with T.step("clips"):
        if cr.legdefs():
            ball = min(rig.head_pos[lg.bones[3]][2] for lg in cr.legdefs())
            rig.ground = (max(ball * 0.55, cr.BALL_MIN), 0.012, cr.WRIST_MIN)
        clips = cr.clips(rig)
        report["clips"] = {c.name: write_clip(rig, c) for c in clips}
        if arm.animation_data:
            arm.animation_data.action = None
    arm["vale_kind"] = "monster"
    arm["vale_id"] = cr.ID
    arm["vale_height"] = float(cr.HEIGHT)
    if cr.FEET:
        arm["vale_run_ref_speed"] = float(cr.RUN_SPEED)     # QA: planted-foot speed (flyers / hoppers: no planted feet)
    report["mesh_top_m"] = round(max((low.matrix_world @ v.co).z for v in low.data.vertices), 3)
    if not args.no_qa:
        with T.step("ground_qa"):
            report["min_z"] = K.min_z_over_clips(rig, [low], clips)
            scene.log(f"min z per clip: {report['min_z']}")
    glb = os.path.join(OUT, f"{cr.ID}.glb")
    with T.step("export"):
        K.clear_pose(rig)
        export.export_glb([arm, low], glb)
        report["glb_bytes_raw"] = os.path.getsize(glb)
    with T.step("optimize"):
        report["optimize"] = export.optimize(glb, fighter=True)
    report["glb_bytes"] = os.path.getsize(glb)
    os.makedirs(CACHE, exist_ok=True)
    scene.save_blend(os.path.join(CACHE, f"{cr.ID}.blend"))
    if cr.ICON:
        with T.step("icon"):
            report["icon"] = render_icon(cr, rig, low, args.fast)
    if not args.no_qa:
        with T.step("qa"):
            rc, out = K.run_node(["art/tools/inspect_glb.mjs", scene.rel(glb)])
            report["inspect"] = out.strip().splitlines()[-12:]
            lt = ["art/tools/three_load_test.mjs", scene.rel(glb), "--unit", "--clips", ",".join(cr.CLIPS),
                  "--budget-kb", "1024"]
            if cr.FEET:
                lt += ["--feet", ",".join(cr.FEET)]
            rc, out = K.run_node(lt)
            report["load_test"] = {"ok": rc == 0, "log": out.strip().splitlines()[-14:]}
            scene.log(out)
            sheet = os.path.join(RENDERS, f"{cr.ID}.png")
            rc, out = K.run_node(["art/tools/three_snapshot.mjs", scene.rel(glb), scene.rel(sheet), "--unit",
                                  "--chrome", CHROME], timeout=900)
            report["sheet"] = {"ok": rc == 0, "out": scene.rel(sheet), "log": out.strip().splitlines()[-3:]}
            scene.log(out[-1500:])
    report["timings"] = T.report()
    scene.write_json(os.path.join(RENDERS, f"build_report_{cr.ID}.json"), report)
    scene.log(f"{cr.ID}: {report['tris']} tris, {report['glb_bytes'] / 1024:.0f} KiB, top {report['mesh_top_m']} m, "
              f"total {T.total():.0f}s")
    return report


# ── icon (128², head-and-shoulders three-quarter, dark ink background) ─────────────────────────────
def render_icon(cr: Monster, rig: RigB, low, fast: bool = False) -> dict:
    clip, frame, target, yaw, pitch, frame_h = cr.icon_setup(rig)
    K.show_frame(rig, clip, frame)
    bpy.context.view_layer.update()
    sc = bpy.context.scene
    for o in sc.objects:
        if o.type == "MESH" and o != low:
            o.hide_render = True
    low.hide_render = False
    cam = render.camera("icon_cam", lens=70.0)
    tgt = Vector(target)
    d = frame_h / (2 * math.tan(math.atan(18.0 / 70.0)))
    loc = tgt + Vector((math.sin(math.radians(yaw)) * math.cos(math.radians(pitch)),
                        -math.cos(math.radians(yaw)) * math.cos(math.radians(pitch)),
                        math.sin(math.radians(pitch)))) * d
    render.look_at(cam, tgt, loc)
    sc.camera = cam
    # one warm key behind-left of the camera, a cool fill, a violet rim from behind (the ink rim light)
    for o in list(sc.objects):
        if o.type == "LIGHT":
            bpy.data.objects.remove(o, do_unlink=True)
    view = (tgt - loc).normalized()
    side = view.cross(Vector((0, 0, 1))).normalized()

    def lamp(name, direction, energy, color, angle=8.0):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        ld.color = color
        ld.angle = math.radians(angle)
        ob = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(ob)
        ob.rotation_euler = Vector(direction).normalized().to_track_quat("-Z", "Y").to_euler()
        return ob
    k = cr.ICON_LIGHT
    lamp("icon_key", view * 0.6 + side * 0.55 + Vector((0, 0, -0.75)), 3.2 * k[0], (1.0, 0.93, 0.84))
    lamp("icon_fill", view * 0.8 - side * 0.7 + Vector((0, 0, -0.1)), 0.7 * k[1], (0.72, 0.8, 1.0))
    lamp("icon_rim", -view * 0.9 + side * 0.35 + Vector((0, 0, -0.45)), 2.6 * k[2], (0.78, 0.76, 1.0))
    lamp("icon_rim2", -view * 0.9 - side * 0.45 + Vector((0, 0, -0.2)), 1.6 * k[2], (0.7, 0.72, 1.0))
    world = bpy.data.worlds.new("icon_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.05, 0.05, 0.07, 1.0)
    bg.inputs["Strength"].default_value = 0.6
    sc.world = world
    render.setup(256, 256, 24 if fast else 96, transparent=True, view="Khronos PBR Neutral")
    raw = os.path.join(RENDERS, f"{cr.ID}_icon_raw.png")
    render.render(raw)
    imageops.denoise(raw)
    fg = imageops.premul_resize(imageops.load(raw), 128, 128)
    # dark ink background: a deep violet-ink radial wash with a faint warm glow behind the head
    yy, xx = np.mgrid[0:128, 0:128] / 127.0
    r = np.sqrt((xx - 0.55) ** 2 + (yy - 0.42) ** 2)
    bgc = np.zeros((128, 128, 4))
    inner, outer = np.array(cr.ICON_BG[0]), np.array(cr.ICON_BG[1])
    w = np.clip(1 - r / 0.75, 0, 1)[..., None] ** 1.6
    bgc[..., :3] = outer * (1 - w) + inner * w
    bgc[..., :3] *= 1 + 0.06 * imageops.value_noise(128, 128, 6, 3)[..., None]
    bgc[..., 3] = 1.0
    out_png = os.path.join(OUT, f"{cr.ID}_icon.png")
    imageops.save(imageops.grade(imageops.over(fg, bgc)), out_png, alpha=False)
    if os.path.isfile(raw):
        os.remove(raw)
    K.clear_pose(rig)
    return {"out": scene.rel(out_png)}


# ════════════════════════════════════════════════════════════════════════════════════════════════
class Longshade(Monster):
    """The beast that lives where the Needle's shadow ends. It is its own shadow, peeled up off the stone at
    the front: a hunched ink torso held up on two long clawed forelimbs, a pale chalk mask-plate on a hooded
    neck, an ink-smoke crest; behind the shoulders the body pours down into a long flat shadow lying on the
    ground. No hind legs: it hauls itself forward hand over hand and the shadow slides after it."""
    ID = "longshade"
    HEIGHT = 4.2
    BODY_TOP = 3.7
    RUN_SPEED = 3.2
    TEX = 2048
    TEX_SIZES = {"orm": 1024, "normal": 1024}
    VOX_LOW = 0.022
    VOX_HIGH = 0.015
    VOX_PART = {"mask": 0.008, "claws": 0.009, "eyes": 0.006}
    VOX_HIGH_PART = {"mask": 0.0045, "claws": 0.006, "eyes": 0.004}
    TRIS = {"body": 9000, "mask": 900, "claws": 800, "eyes": 160}
    CLIPS = ("idle", "run", "attack1", "cast_a1", "cast_a2", "cast_a3", "death")
    HEAT_EXCLUDE = ("root", "mask", "eye.L", "eye.R", "claw.L", "claw.R")
    GLOW = {"eyes": ("longshade_lamp", 0.8, "#FFE9B8")}
    UV_WEIGHTS = {"mask": 5.0, "claws": 1.6, "eyes": 0.3}
    BAKE_RAY = (0.03, 0.1)
    AO_DIST = 0.5
    PART_BIND = {"mask": "mask", "eyes": ("tags", {"eyeL": "eye.L", "eyeR": "eye.R"}),
                 "claws": ("tags", {"clawL": "claw.L", "clawR": "claw.R"})}
    FEET = ("claw.L", "claw.R")
    ICON_LIGHT = (1.2, 1.4, 2.6)
    ICON_BG = ((0.30, 0.25, 0.31), (0.05, 0.045, 0.065))
    WRIST_MIN = 0.14
    BALL_MIN = 0.06
    ICON = True
    TAIL = ("tail", "tail2", "tail3", "tail4", "tail5", "tail6")
    PAL = {"ink": "#141219", "ink_top": "#1E1B28", "ink_under": "#0B0A0F", "rim": "#4C4870", "rim_hi": "#8C88BE",
           "streak": "#2E2A42",
           "hand": "#26222F", "claw": "#35303F", "claw_tip": "#A39CB3", "chalk": "#E4DED0", "chalk_dirt": "#B9B0A0",
           "groove": "#3B3542", "socket": "#221E29", "lamp": "#FFF0CC", "lamp_edge": "#F2B45E"}
    # mask frame: centre, lateral, up (along the plate), out (face normal, tilted 20 degrees up)
    MC = np.array([0.0, -1.74, 3.10])
    MU = np.array([0.0, math.sin(math.radians(24)), math.cos(math.radians(24))])
    MN = np.array([0.0, -math.cos(math.radians(24)), math.sin(math.radians(24))])
    MX = np.array([1.0, 0.0, 0.0])

    def joints(self):
        return dict(
            hips=(0, 1.05, 1.15), spine=(0, 0.35, 1.85), chest=(0, -0.35, 2.32), neck=(0, -0.72, 2.66),
            neck2=(0, -0.98, 2.92), head=(0, -1.24, 3.08), snout=(0, -1.70, 3.02),
            tail=(0, 1.12, 1.02), tail2=(0, 1.85, 0.48), tail3=(0, 2.6, 0.2), tail4=(0, 3.35, 0.12),
            tail5=(0, 4.1, 0.09), tail6=(0, 4.85, 0.07), tail_end=(0, 5.6, 0.05),
            withers=(0.42, -0.42, 2.82), shoulder=(0.86, -0.48, 2.32), elbow=(0.86, -0.42, 1.30),
            wrist=(0.86, -1.42, 0.44), fball=(0.86, -1.72, 0.11), ftip=(0.86, -2.42, 0.035),
        )

    def bones(self):
        J = self.J
        mc, mu, mn = self.MC, self.MU, self.MN
        bl = [B("root", (0, 0, 0), (0, -0.6, 0)),
              B("hips", J["hips"], J["spine"], "root"),
              B("spine", J["spine"], J["chest"], "hips", True),
              B("chest", J["chest"], J["neck"], "spine", True),
              B("neck", J["neck"], J["neck2"], "chest", True),
              B("neck2", J["neck2"], J["head"], "neck", True),
              B("head", J["head"], J["snout"], "neck2", True),
              B("mask", tuple(mc - mn * 0.05), tuple(mc + mn * 0.2), "head", xaxis=(1, 0, 0))]
        for s, sx in (("L", 1), ("R", -1)):
            e = mc + mu * 0.12 + self.MX * 0.15 * sx + mn * 0.04
            bl.append(B(f"eye.{s}", tuple(e), tuple(e + mn * 0.12), "head"))
        names = list(self.TAIL) + ["tail_end"]
        for i, n in enumerate(self.TAIL):
            bl.append(B(n, J[n], J[names[i + 1]], "hips" if i == 0 else self.TAIL[i - 1], i > 0))
        for s, sx in (("L", 1), ("R", -1)):
            m = lambda k: mirror(J[k], sx)  # noqa: E731
            bl += [B(f"scapula.{s}", m("withers"), m("shoulder"), "chest"),
                   B(f"upper_arm.{s}", m("shoulder"), m("elbow"), f"scapula.{s}", True),
                   B(f"forearm.{s}", m("elbow"), m("wrist"), f"upper_arm.{s}", True),
                   B(f"hand.{s}", m("wrist"), m("fball"), f"forearm.{s}", True),
                   B(f"claw.{s}", m("fball"), m("ftip"), f"hand.{s}", True)]
        return bl

    def legdefs(self):
        return [LegDef("FL", ("upper_arm.L", "forearm.L", "hand.L", "claw.L"), -1),
                LegDef("FR", ("upper_arm.R", "forearm.R", "hand.R", "claw.R"), -1)]

    # ── sculpt ──
    def body_sculpt(self, detail):
        J = self.J
        S = GSculpt("body")
        self.wisps = []
        # billowing surface: puffy low-frequency lumps (both meshes) + fine smoke grain (bake only)
        if detail:
            smoke = ((lambda P: -0.035 * (1 - np.abs(NOISE(P, 2.2))) + 0.008 * NOISE.fbm(P * np.array([1.6, 0.35, 1.6]), 5.0, 3)),
                     0.045)
        else:
            smoke = ((lambda P: -0.035 * (1 - np.abs(NOISE(P, 2.2)))), 0.037)
        tip_t = 0.012 if detail else 0.026          # ribbon thickness / width at the tips (the low keeps >= ~1.2 voxels)

        def add(prim, k, tag="ink", d=smoke):
            if d is not None:
                prim = prim.displaced(d[0], d[1] + 0.004)
            S.add(prim, k=k, tag=tag)

        def ribbon(base, direction, length, w0, t0, face, curl_axis=None, curl=0.0, segs=4, k0=0.08, w1=None):
            """A flat curling smoke ribbon: width w0 -> tip, thickness t0 -> tip, broad face toward `face`."""
            pts = tube_path(base, direction, length, curl_axis, curl, segs)
            ws = np.linspace(w0, w1 if w1 is not None else tip_t * 1.4, len(pts))
            ts = np.linspace(t0, tip_t, len(pts))
            for i in range(segs):
                d = pts[i + 1] - pts[i]
                side = np.cross(d, face)
                side = K.nrm(side) if np.linalg.norm(side) > 1e-6 else np.array([1.0, 0, 0])
                S.add(sdf.FlatCapsule(pts[i], pts[i + 1], ws[i], ts[i], ws[i + 1], ts[i + 1], side=side),
                      k=k0 if i == 0 else 0.03, tag="wisp")
            self.wisps.append((pts[0], pts[-1], length))

        def tendril(base, d, L, w0, wt, t0, face, amp=0.12, nwave=1.3, rise=0.0, segs=6, k0=0.09, phase=0.0):
            """A long streaming smoke tendril: flat, wavy (an S in the plane of `face`), rounded tip."""
            d = K.nrm(d)
            up_ = K.nrm(np.asarray(face, dtype=np.float64) - d * (np.asarray(face) @ d))
            ss = np.linspace(0, 1, segs + 1)
            pts = [V3(base) + d * L * u + up_ * (amp * math.sin(math.pi * (nwave * u + phase)) * min(1.0, u * 3)
                                                 + rise * u * u) for u in ss]
            ws = w0 * (1 - ss) + wt * ss + 0.25 * w0 * np.sin(np.pi * ss)
            ts = np.maximum(t0 * (1 - 0.6 * ss), tip_t)
            for i in range(segs):
                sd = pts[i + 1] - pts[i]
                side = np.cross(sd, up_)
                side = K.nrm(side) if np.linalg.norm(side) > 1e-6 else np.array([1.0, 0, 0])
                S.add(sdf.FlatCapsule(pts[i], pts[i + 1], ws[i], ts[i], ws[i + 1], ts[i + 1], side=side),
                      k=k0 if i == 0 else 0.035, tag="wisp")
            self.wisps.append((pts[0], pts[-1], L))

        def lick(base, d, L, r0, r1, face=(0, 0, 1.0), amp=0.12, phase=0.0, rise=0.0, hook=40.0, k0=0.1, segs=7):
            """A fat smoke tendril: round, tapering fast then slowly to a rounded tip, an S along its length and
            a final hook curling toward `face` (a lick of dark flame / a curl of smoke)."""
            d = K.nrm(d)
            up_ = K.nrm(np.asarray(face, dtype=np.float64) - d * (np.asarray(face) @ d))
            side = K.nrm(np.cross(d, up_))
            ss = np.linspace(0, 1, segs + 1)
            pts = [V3(base)]
            dd = d.copy()
            for i in range(segs):
                u = (ss[i] + ss[i + 1]) / 2
                bend = amp * math.cos(math.pi * (1.3 * u + phase)) * 1.6 + (math.radians(hook) * 2.2 * max(0.0, u - 0.6))
                dk = K.rodrigues(dd, side, -bend * (L / segs))
                pts.append(pts[-1] + dk * L / segs + up_ * rise * (L / segs) * u)
            rr = [r1 + (r0 - r1) * (1 - u) ** 1.6 for u in ss]
            S.add(sdf.Tube(pts, rr, k=0.03), k=k0, tag="wisp")
            self.wisps.append((pts[0], pts[-1], L))

        # torso: deep chest, high shoulder hump, the belly pouring back and down into the ground
        add(Ellipsoid((0, -0.38, 2.16), (0.64, 0.56, 0.64)), 0.0)
        add(Ellipsoid((0, -0.36, 2.60), (0.80, 0.46, 0.36)), 0.22)
        add(RoundCone((0, -0.1, 2.0), (0, 0.85, 1.12), 0.58, 0.54), 0.25)
        add(Ellipsoid((0, 1.25, 0.66), (0.80, 0.85, 0.52)), 0.3)
        # the shadow-tail: wide, flat, lying on the ground, tapering
        T = [(0, 1.70, 0.40), (0, 2.60, 0.15), (0, 3.45, 0.095), (0, 4.30, 0.08), (0, 5.10, 0.066), (0, 5.75, 0.05)]
        W = [(0.86, 0.40), (0.80, 0.14), (0.68, 0.09), (0.52, 0.07), (0.32, 0.055), (0.12, 0.042)]
        for i in range(len(T) - 1):
            add(sdf.FlatCapsule(T[i], T[i + 1], W[i][0], W[i][1], W[i + 1][0], W[i + 1][1], side=(1, 0, 0)), 0.1, tag="tail")
        self.tail_w = (np.array([t[1] for t in T]), np.array([w[0] for w in W]))
        # neck and a hooded head (the face is the chalk mask, a separate rigid part)
        add(RoundCone((0, -0.45, 2.55), (0, -1.08, 3.0), 0.52, 0.42), 0.2)
        add(Ellipsoid((0, -1.28, 3.14), (0.47, 0.44, 0.5)), 0.14, tag="hood")
        add(Ellipsoid((0, -1.02, 3.50), (0.34, 0.42, 0.3)), 0.14, tag="hood")
        # forelimbs: heavy upper arm, long forearm, a long narrow hand of fused fingers
        for sx in (1, -1):
            m = lambda k: np.array(mirror(J[k], sx))  # noqa: E731
            add(Ellipsoid(mirror((0.62, -0.45, 2.42), sx), (0.34, 0.38, 0.36)), 0.18)
            add(RoundCone(m("shoulder"), m("elbow"), 0.3, 0.21), 0.14)
            add(RoundCone(m("elbow"), m("wrist"), 0.22, 0.135), 0.08)
            add(Sphere(m("wrist"), 0.125), 0.05, tag="hand")
            add(sdf.FlatCapsule(m("wrist"), m("fball"), 0.16, 0.095, 0.18, 0.065, side=(1, 0, 0)), 0.05, tag="hand")
            for dx in (-0.17, -0.06, 0.06, 0.17):                # knuckle pads the claws grow from
                add(Sphere(m("fball") + np.array([dx * sx, -0.03, -0.005]), 0.07), 0.04, tag="hand")
        # ── ink-smoke edges (geometry only): flat ribbons of shade rising and curling off the body ──
        X = np.array([1.0, 0, 0])
        UP = np.array([0, 0, 1.0])
        core = blend_of(S)
        # the back dissolves into smoke: large overlapping billows over the dorsal surface, biggest over the
        # shoulders, smaller toward the tail and down the flanks
        rng_b = np.random.RandomState(31)
        self.billows = []

        def billow(c_, r_, k_=0.07):
            S.add(Sphere(c_, r_), k=k_, tag="wisp")
            self.billows.append((V3(c_), r_))
        for j, yy in enumerate(np.linspace(-1.05, 2.0, 12)):
            zc = float(np.interp(yy, [-1.05, -0.4, 0.4, 1.2, 2.05], [3.0, 2.35, 1.85, 1.0, 0.3]))
            f = (yy + 1.05) / 3.05
            for th in ((-60, -30, 0, 30, 60) if j % 2 == 0 else (-46, -15, 15, 46)):
                th_ = th + rng_b.uniform(-9, 9)
                if abs(th_) > 40 and yy > 1.5:
                    continue
                dirn = K.nrm((math.sin(math.radians(th_)), rng_b.uniform(-0.1, 0.25), math.cos(math.radians(th_))))
                sp = surface_point(core, (0, yy + rng_b.uniform(-0.1, 0.1), zc), dirn)
                r_ = (0.34 * (1 - f) + 0.15 * f) * (1 - 0.3 * abs(th_) / 70) * rng_b.uniform(0.7, 1.3)
                billow(sp + dirn * r_ * rng_b.uniform(0.0, 0.32), r_)
        # billows rising off the cowl and the shoulders (the 4.2 m top), and down the backs of the arms
        for cl in (((0.0, -1.02, 3.68), 0.25), ((0.05, -0.84, 3.98), 0.22), ((0.24, -0.95, 3.55), 0.17),
                   ((-0.24, -0.95, 3.55), 0.17)):
            billow(np.array(cl[0]), cl[1], 0.1)
        for sx in (1, -1):
            for c_, r_ in (((0.72, -0.25, 2.85), 0.22), ((0.8, -0.05, 2.98), 0.17)):
                billow(np.array(mirror(c_, sx)), r_, 0.1)
            e = np.array(mirror(J["elbow"], sx))
            w_ = np.array(mirror(J["wrist"], sx))
            for f, r_ in ((0.0, 0.2), (0.25, 0.16), (0.5, 0.13), (0.75, 0.1)):
                billow(e + (w_ - e) * f + np.array([sx * 0.03, 0.14 - 0.03 * f, 0.02]), r_, 0.05)
            billow(e + np.array([sx * 0.02, 0.26, 0.1]), 0.15, 0.08)
        # the tail's edge bleeds into scalloped lobes of ink, a few loose drops beside it, three tendrils at the end
        ys, ws = self.tail_w
        rng = np.random.RandomState(7)
        for i, yy in enumerate(np.linspace(1.95, 5.35, 11)):
            hw = float(np.interp(yy, ys, ws))
            for sx in (1, -1):
                big = 1.0 if (i + (sx > 0)) % 2 else 0.6
                r_ = (0.16 + 0.1 * big) * (1.0 - 0.05 * i)
                c_ = np.array([sx * (hw - 0.02 + r_ * 0.35), yy + rng.uniform(-0.08, 0.08), 0.045])
                add(Ellipsoid(c_, (r_, r_ * 1.25, 0.04)), 0.06, tag="lobe", d=None)
        for ang in (-34, 0, 34):
            a = math.radians(ang)
            pts = tube_path((0, 5.5, 0.04), (math.sin(a), math.cos(a), 0), 0.95, np.array([0, 0, 1.0]), ang * 0.9, 4)
            ws = [0.13, 0.1, 0.075, 0.05, 0.035]
            for i in range(4):
                S.add(sdf.FlatCapsule(pts[i], pts[i + 1], ws[i], 0.04, ws[i + 1], 0.035, side=np.cross(pts[i + 1] - pts[i], (0, 0, 1))),
                      k=0.06 if i == 0 else 0.03, tag="wisp")
            self.wisps.append((pts[0], pts[-1], 0.95))
        return S

    def mask_sculpt(self, detail):
        mc, mu, mn, mx = self.MC, self.MU, self.MN, self.MX
        S = Sculpt("mask")
        ax = np.stack([mx, mu, mn])
        S.add(Ellipsoid(mc, (0.36, 0.48, 0.085), axes=ax), k=0.0, tag="plate")
        # the brow is cut straight, the chin drawn to a point
        S.inter(HalfSpace(mc + mu * 0.36, mu, extent=1.0), k=0.03)
        for sx in (1, -1):
            nrm_ = K.nrm(-mu * 0.6 + mx * sx * 0.8)
            S.inter(HalfSpace(mc - mu * 0.47, nrm_, extent=1.0), k=0.04)
        S.sub(Ellipsoid(mc - mn * 0.08, (0.3, 0.4, 0.055), axes=ax), k=0.02)       # hollow back
        S.sub(Sphere(mc + mu * 0.38 + mx * 0.31 + mn * 0.03, 0.08), k=0.01)          # a chip off the brow corner
        S.add(RoundCone(mc + mu * 0.0 + mn * 0.068, mc - mu * 0.42 + mn * 0.035, 0.034, 0.018), k=0.025, tag="plate")
        self.eyes_c = []
        for sx in (1, -1):
            e = mc + mu * 0.12 + mx * 0.15 * sx
            self.eyes_c.append(e)
            S.sub(Sphere(e + mn * 0.08, 0.1), k=0.012)                                 # shallow socket
            S.add(sdf.Torus(e + mn * 0.06, 0.108, 0.017, axes=ax), k=0.01, tag="plate")   # carved rim
        self.grooves = []
        if detail:
            chin = mc - mu * 0.44 + mn * 0.05
            for ang in (-58, -36, -15, 15, 36, 58):                     # hour-lines fanning from the chin
                a = math.radians(ang)
                d = K.nrm(mu * math.cos(a) + mx * math.sin(a))
                L = 0.34 if abs(ang) < 20 else 0.3
                p0, p1 = chin + d * 0.06, chin + d * L + mn * 0.015
                S.sub(Capsule(p0, p1, 0.009), k=0.003)
                self.grooves.append((p0, p1))
            g0, g1 = mc + mu * 0.3 - mx * 0.26 + mn * 0.062, mc + mu * 0.3 + mx * 0.24 + mn * 0.062
            S.sub(Capsule(g0, g1, 0.008), k=0.003)                         # the brow band
            self.grooves.append((g0, g1))
            pts = [mc + mu * 0.35 + mx * 0.25, mc + mu * 0.24 + mx * 0.24, mc + mu * 0.05 + mx * 0.27, mc - mu * 0.12 + mx * 0.2]
            for a_, b_ in zip(pts[:-1], pts[1:]):                       # a hairline crack from the chip
                S.sub(Capsule(a_ + mn * 0.08, b_ + mn * 0.08, 0.005), k=0.002)
        return S

    def eye_sculpt(self, detail):
        S = Sculpt("eyes")
        mc, mu, mn, mx = self.MC, self.MU, self.MN, self.MX
        for sx, tag in ((1, "eyeL"), (-1, "eyeR")):
            e = mc + mu * 0.12 + mx * 0.15 * sx
            S.add(Ellipsoid(e + mn * 0.045, (0.08, 0.08, 0.055), axes=np.stack([mx, mu, mn])), k=0.0, tag=tag)
        return S

    def claw_sculpt(self, detail):
        J = self.J
        S = GSculpt("claws", ground=0.004, k=0.004)
        self.claws = []
        for sx, tag in ((1, "clawL"), (-1, "clawR")):
            fb = np.array(mirror(J["fball"], sx))
            for dx, L in ((-0.17, 0.66), (-0.06, 0.86), (0.06, 0.88), (0.17, 0.62)):
                base = fb + np.array([dx * sx, -0.06, 0.0])
                splay = math.radians(dx * sx * 75)
                d0 = K.nrm(np.array([math.sin(splay) * 0.98, -math.cos(splay), 0.2]))
                side = K.nrm(np.cross(d0, (0, 0, 1)))
                pts = tube_path(base, d0, L, side, -40, 5)
                # sickle blades: deep (vertical) and thin (sideways)
                ws = np.linspace(0.07, 0.012 if detail else 0.016, len(pts))
                ts = np.linspace(0.04, 0.008 if detail else 0.014, len(pts))
                for i in range(len(pts) - 1):
                    S.add(sdf.FlatCapsule(pts[i], pts[i + 1], ws[i], ts[i], ws[i + 1], ts[i + 1], side=np.cross(side, pts[i + 1] - pts[i])),
                          k=0.02 if i == 0 else 0.01, tag=tag)
                self.claws.append((base, pts[-1], L))
        return S

    def sculpts(self, detail):
        return {"body": self.body_sculpt(detail), "mask": self.mask_sculpt(detail), "claws": self.claw_sculpt(detail),
                "eyes": self.eye_sculpt(detail)}

    def tag_sculpt(self, name):
        return self.sculpts(False)[name]

    # ── paint ──
    def _along(self, V, segs):
        """Fraction along the nearest (base, tip, length) stroke for each vertex."""
        best = np.full(len(V), 1e9)
        frac = np.zeros(len(V))
        for a, b, L in segs:
            a, b = V3(a), V3(b)
            ab = b - a
            t = np.clip(((V - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
            d = np.linalg.norm(V - (a + t[:, None] * ab), axis=1)
            m = d < best
            best[m] = d[m]
            frac[m] = t[m]
        return frac, best

    def paint(self, part, V, N, tags):
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        nz = N[:, 2]
        if part == "body":
            col = mix_hex(np.tile(c("ink"), (n, 1)), c("ink_top"), sarr(0.1, 0.9, nz) * 0.8)
            col = mix_hex(col, c("ink_under"), sarr(-0.2, -0.8, nz))
            # stretch streaks: faint long brush lines running down the body toward the tail
            st = NOISE.fbm(V * np.array([7.0, 0.35, 7.0]), 1.0, 3)
            streak = sarr(0.18, 0.32, st) * sarr(0.0, 0.5, nz)
            col = mix_hex(col, c("streak"), streak * 0.55)
            rough = np.full(n, 0.86)
            dmin = np.min(np.stack(list(tags.values())), 0)
            # smoke billows: a cool light rim on their outer, upper faces, growing toward the trail's end
            ww = np.clip(1 - (tags["wisp"] - dmin) / 0.02, 0, 1) * (tags["wisp"] < 0.04)
            # how far each point sits out on its billow (the billow's crown, not the seam where billows meet)
            crown = np.zeros(n)
            for c_, r_ in self.billows:
                dd = np.linalg.norm(V - c_, axis=1)
                m = dd < r_ * 1.15
                if m.any():
                    crown[m] = np.maximum(crown[m], sarr(0.75, 1.05, dd[m] / r_))
            fr, _ = self._along(V, self.wisps) if self.wisps else (np.zeros(n), None)
            rimf = ww * crown * (0.1 + 0.35 * sarr(0.0, 0.8, nz))
            col = mix_hex(col, c("rim"), rimf)
            col = mix_hex(col, c("rim_hi"), ww * crown * sarr(0.7, 1.0, nz) * 0.12)
            rough = rough * (1 - ww) + 0.9 * ww
            # the flat shadow-tail and its ink lobes: a faint cool rim on the edges, a darker core line
            tw = (np.clip(1 - (np.minimum(tags["tail"], tags["lobe"]) - dmin) / 0.02, 0, 1) *
                  (np.minimum(tags["tail"], tags["lobe"]) < 0.04) * (V[:, 2] < 0.35))
            ys, wsd = self.tail_w
            hw = np.interp(V[:, 1], ys, wsd)
            edge = sarr(0.55, 1.15, np.abs(V[:, 0]) / np.maximum(hw, 0.05))
            col = mix_hex(col, c("rim"), tw * edge * 0.6)
            core = sarr(0.3, 0.0, np.abs(V[:, 0]) / np.maximum(hw, 0.05)) * (V[:, 1] > 1.6)
            col = mix_hex(col, c("ink_under"), core * 0.6)
            hw_ = np.clip(1 - (tags["hand"] - dmin) / 0.02, 0, 1) * (tags["hand"] < 0.04)
            col = mix_hex(col, c("hand"), hw_ * 0.8)
            return col, rough
        if part == "claws":
            fr, _ = self._along(V, self.claws)
            col = mix_hex(np.tile(c("claw"), (n, 1)), c("claw_tip"), sarr(0.45, 1.0, fr))
            return col, 0.38 + 0.2 * fr
        if part == "eyes":
            mn = self.MN
            face = np.clip(N @ mn, 0, 1)
            col = mix_hex(np.tile(c("lamp_edge"), (n, 1)), c("lamp"), sarr(0.3, 0.9, face))
            return col, np.full(n, 0.25)
        # mask: chalk plate, dark carved grooves, dark sockets, ink tears under the eyes
        mc, mu, mn, mx = self.MC, self.MU, self.MN, self.MX
        rel = V - mc
        u, x, o = rel @ mu, rel @ mx, rel @ mn
        col = np.tile(c("chalk"), (n, 1))
        col = mix_hex(col, c("chalk_dirt"), sarr(-0.1, -0.4, u) * 0.5 + sarr(0.0, -0.06, o) * 0.6)
        rough = np.full(n, 0.72)
        if self.grooves:
            _, gd = self._along(V, [(a, b, 1.0) for a, b in self.grooves])
            g = sarr(0.016, 0.006, gd)
            col = mix_hex(col, c("groove"), g * 0.85)
        for e in self.eyes_c:
            d = np.linalg.norm(V - (e + mn * 0.04), axis=1)
            col = mix_hex(col, c("socket"), sarr(0.13, 0.1, d) * (o > -0.02))
            # an ink tear running down from each socket
            dx = np.abs((V - e) @ mx)
            du = (V - e) @ mu
            tear = sarr(0.035, 0.014, dx) * sarr(-0.1, -0.12, du) * sarr(-0.4, -0.24, du) * (o > 0.0)
            col = mix_hex(col, c("groove"), tear * 0.6)
        return col, rough

    def high_material(self, part, grad):
        if part == "body":
            return K.painted_material(f"{self.ID}_body_src", "#433D58", grad, fur=0.02, fur_scale=(1.0, 0.6, 1.6),
                                      chalk=(1.5, 0.75), cavity=(0.45, 1.1), breakup=0.05, top=0.1)
        if part == "mask":
            return painted_stone(f"{self.ID}_mask_src", self.PAL["chalk"], grad, chisel=0.6, scale=3.0, chalk=(1.12, 0.5))
        if part == "claws":
            return K.painted_material(f"{self.ID}_claw_src", "#4A4458", grad, fur=0.0, chalk=(2.0, 0.6), breakup=0.04)
        return K.painted_material(f"{self.ID}_eye_src", self.PAL["lamp"], None, fur=0.0, chalk=(1.0, 1.0),
                                  cavity=(1.0, 1.0), breakup=0.0, top=0.0)

    def weight_fix(self, ob):
        def side(sfx):
            return lambda n: n.endswith(sfx)
        arm_b = {f"{b}.{s}" for b in ("upper_arm", "forearm", "hand") for s in ("L", "R")}
        rules = [(side(".L"), lambda V: sarr(-0.02, 0.06, V[:, 0])),
                 (side(".R"), lambda V: sarr(0.02, -0.06, V[:, 0])),
                 # the arms own nothing of the torso's middle or of the tail
                 (lambda n: n in arm_b, lambda V: sarr(0.35, 0.55, np.abs(V[:, 0])) * sarr(0.6, 0.2, V[:, 1])),
                 (lambda n: n.startswith("tail"), lambda V: sarr(0.5, 0.95, V[:, 1]))]
        K.mask_weights(ob, rules)
        K.smooth_weights(ob, iters=2, k=0.5)

    # ── clips ──
    def clips(self, rig):
        J = self.J
        R0 = rig.rest_pose().legs
        H = np.array(J["hips"])
        C = np.array([0.0, 0.3, 1.5])            # torso pivot for small sways
        GP = np.array([0.0, 1.25, 0.45])          # ground pivot: where the shade pours into the ground
        spd = self.RUN_SPEED
        tail_z = [rig.head_pos[b][2] for b in self.TAIL] + [J["tail_end"][2]]
        NT = len(self.TAIL)

        def body(P, pitch=0.0, roll=0.0, yaw=0.0, lift=(0, 0, 0), c=C):
            R = rot(pitch, yaw, roll)
            P.hips_rot = R
            P.hips_loc = pivot(R, c, H) + np.array(lift, dtype=np.float64)

        def tail(P, phis, zs=None):
            P.chains = [{"bones": list(self.TAIL), "phis": list(phis), "zs": list(zs or tail_z)}]

        def tail_wave(t, amp=6.0, waves=1.0, speed=1.0, base=0.0, grow=1.0):
            return [base + amp * (0.35 + 0.65 * grow * i / (NT - 1)) * math.sin(2 * math.pi * (speed * t - waves * i / NT))
                    for i in range(NT)]

        def planted(P):
            for k, lg in R0.items():
                P.legs[k] = Leg(p=lg.p, a=lg.a, t=lg.t)

        def eyes(P, s):
            P.scl["eye.L"] = s
            P.scl["eye.R"] = s

        # idle 3 s: slow breathing, the mask turns to look, the claws of the right hand drum once, the shadow ripples
        def idle(t):
            P = rig.rest_pose()
            planted(P)
            body(P, pitch=1.2 * wave(t, 0.1, 2), roll=1.0 * wave(t, 0.3), lift=(0.02 * wave(t, 0.05), 0, 0.03 * wave(t, 0, 2)))
            look = spline([(0, 0), (0.15, 0), (0.32, 14), (0.5, 14), (0.68, -10), (0.86, -10), (1.0, 0)], t, period=1.0)
            tilt = spline([(0, 0), (0.32, -6), (0.5, -4), (0.68, 7), (0.86, 5), (1.0, 0)], t, period=1.0)
            P.r("spine", p=1.2 * wave(t, 0, 2)).r("chest", p=-1.5 * wave(t, 0.05, 2), y=look * 0.15)
            P.r("neck", y=look * 0.3, p=2 * wave(t, 0.2, 2)).r("neck2", y=look * 0.3).r("head", y=look * 0.4, r=tilt, p=-2 * wave(t, 0.3, 2))
            drum = [bump(t, 0.55 + 0.07 * i, 0.62 + 0.07 * i) for i in range(3)]
            fr = R0["FR"]
            P.legs["FR"] = Leg(p=fr.p, a=fr.a, t=fr.t + 22 * sum(drum))
            eyes(P, 1.0 + 0.05 * wave(t, 0.0, 2))
            tail(P, tail_wave(t, amp=5.0, waves=0.9))
            return P

        # run 0.8 s: hand over hand at 3.2 m/s; each reach drops the shoulder, the shadow snakes behind
        RUN_F = 24
        stride = spd * RUN_F / K.FPS
        G = {"FL": (0.0, 0.56, 0.42), "FR": (0.5, 0.56, 0.42)}

        def run(t):
            P = rig.rest_pose()
            for k, (ph, duty, lift) in G.items():
                r = R0[k]
                u = (t - ph) % 1.0
                dy, dz, st, s = K.foot_path(u, duty, stride, lift, tangent=0.45, lift_peak=0.5)
                if st:
                    a = lerp(r.a + 25, r.a - 35, s)
                    tt = lerp(r.t - 5, r.t - 25, s)
                else:
                    a = spline([(0, r.a - 35), (0.35, r.a - 60), (0.75, r.a + 40), (1.0, r.a + 25)], s)
                    tt = spline([(0, r.t - 25), (0.3, r.t + 40), (0.8, r.t + 20), (1.0, r.t - 5)], s)
                P.legs[k] = Leg(p=(r.p[0], r.p[1] + dy, r.p[2] + dz), a=a, t=tt)
            sway = wave(t, 0.1)                                     # + leaning onto the left hand
            dip = 0.5 + 0.5 * math.cos(4 * math.pi * (t - 0.12))
            body(P, pitch=-9 - 3 * dip, roll=4 * sway, yaw=5 * wave(t, 0.35), lift=(0.05 * sway, -0.08, -0.22 - 0.12 * dip), c=GP)
            P.r("chest", y=-6 * wave(t, 0.3), r=-3 * sway, p=2 * dip)
            P.r("neck", p=8 + 4 * dip, y=4 * wave(t, 0.3)).r("neck2", p=5).r("head", p=4 - 3 * dip, y=3 * wave(t, 0.3), r=-2 * sway)
            eyes(P, 1.0)
            phis = tail_wave(t, amp=14.0, waves=0.8, base=0.0)
            tail(P, phis)
            return P

        # attack1 (1.0 s): right claws cocked high, raked down across the front at 40 %, a drag back, recover
        def attack(t):
            P = rig.rest_pose()
            planted(P)
            up = spline([(0, 0), (0.28, 1.0), (0.34, 1.05), (0.4, 0.0), (1.0, 0.0)], t)
            hit = spline([(0, 0), (0.33, 0), (0.4, 1.0), (0.6, 0.85), (0.85, 0.2), (1.0, 0)], t)
            body(P, pitch=6 * up - 8 * hit, roll=5 * up - 3 * hit, yaw=-12 * up + 10 * hit,
                 lift=(0.15 * up, 0.12 * up - 0.3 * hit, 0.1 * up - 0.2 * hit), c=GP)
            fr = R0["FR"]
            rest = np.array(fr.p)
            cock = np.array([-1.25, -0.9, 2.9])
            strike = np.array([-0.35, -2.75, 0.12])
            if t < 0.4:
                w = smooth(t / 0.28)
                p = rest * (1 - w) + cock * w if t < 0.34 else cock + (strike - cock) * smooth((t - 0.34) / 0.06)
                a = lerp(fr.a, 165, w) if t < 0.34 else lerp(165, 75, smooth((t - 0.34) / 0.06))
                tt = lerp(fr.t, 200, w) if t < 0.34 else lerp(200, 110, smooth((t - 0.34) / 0.06))
            else:
                w = smooth((t - 0.6) / 0.35)
                drag = strike + np.array([0.15, 0.45, 0.0]) * smooth((t - 0.4) / 0.2)
                p = drag * (1 - w) + rest * w
                p = p + np.array([0, 0, 0.25 * bump(t, 0.62, 0.95)])
                a = lerp(lerp(75, fr.a + 20, smooth((t - 0.4) / 0.2)), fr.a, w)
                tt = lerp(lerp(110, fr.t - 20, smooth((t - 0.4) / 0.2)), fr.t, w)
            P.legs["FR"] = Leg(p=tuple(p), a=a, t=tt)
            P.r("chest", y=-14 * up + 16 * hit, r=4 * up)
            P.r("neck", p=-6 * up + 10 * hit, y=-8 * up + 6 * hit).r("head", p=-4 * up + 8 * hit, y=-6 * up + 8 * hit)
            eyes(P, 1.0 + 0.15 * up)
            tail(P, tail_wave(t, amp=6.0, waves=0.6))
            for i in range(NT):
                P.chains[0]["phis"][i] += -10 * up * (1 - i / NT) + 8 * hit * (1 - i / NT)
            return P

        # cast_a1 Shadow Sweep (1.17 s): wind the right arm far out to the side, sweep it low through a wide arc
        # across the front (centre at 40 %), follow through to the left, recover
        def sweep(t):
            P = rig.rest_pose()
            planted(P)
            fr, fl = R0["FR"], R0["FL"]
            wind = spline([(0, 0), (0.3, 1.0), (0.36, 1.0), (0.5, 0.0), (1.0, 0.0)], t)
            # sweep angle about a centre between the shoulders (0 = straight ahead, + = toward the left side)
            arc = spline([(0, -80), (0.3, -98), (0.36, -98), (0.4, 0), (0.47, 38), (0.62, 42), (0.85, 14), (1.0, 0)], t)
            out = spline([(0, 0), (0.25, 1), (0.62, 1), (0.92, 0), (1.0, 0)], t)
            ang = math.radians(arc)
            c0, rr_ = np.array([-0.45, -0.55, 0.0]), 2.35
            arc_p = c0 + np.array([math.sin(ang) * rr_, -math.cos(ang) * rr_, 0.32 + 0.3 * wind + 0.45 * max(0.0, math.sin(ang))])
            p = np.array(fr.p) * (1 - out) + arc_p * out
            P.legs["FR"] = Leg(p=tuple(p), a=lerp(fr.a, 95, out), t=lerp(fr.t, 115, out))
            # the left hand steps out and back to let the sweep pass, and plants again
            st = smooth((t - 0.12) / 0.18) * (1 - smooth((t - 0.78) / 0.18))
            lf = 0.3 * (bump(t, 0.12, 0.3) + bump(t, 0.78, 0.96))
            P.legs["FL"] = Leg(p=(fl.p[0] + 0.35 * st, fl.p[1] + 0.55 * st, fl.p[2] + lf), a=fl.a, t=fl.t)
            yaw = -20 * wind + 24 * smooth((t - 0.36) / 0.16) * (1 - smooth((t - 0.66) / 0.3))
            body(P, pitch=-4 * out, roll=7 * wind - 3 * out * (1 - wind), yaw=yaw,
                 lift=(-0.25 * wind, -0.1 * out, -0.18 * out), c=GP)
            P.r("chest", y=yaw * 0.5, r=3 * wind)
            P.r("neck", y=-yaw * 0.4 + 6 * out).r("head", y=-yaw * 0.3 + 8 * out, p=6 * out)
            eyes(P, 1.0 + 0.25 * wind + 0.15 * out)
            ph = tail_wave(t, amp=6.0, waves=0.5)
            tail(P, [p_ - yaw * 0.8 * (1 - i / NT) for i, p_ in enumerate(ph)])
            return P

        # cast_a2 Pooled Shade (1.33 s): rear up with the arms spread, at 40 % pour forward: both hands slap down
        # far ahead and spread the shade, the mask bows over the pool, hold, recover
        def pool(t):
            P = rig.rest_pose()
            rear = spline([(0, 0), (0.3, 1.0), (0.35, 1.04), (0.4, 0.0), (1.0, 0.0)], t)
            pour = spline([(0, 0), (0.35, 0), (0.4, 1.0), (0.72, 0.95), (0.9, 0.25), (1.0, 0)], t)
            body(P, pitch=24 * rear - 14 * pour, lift=(0, 0.25 * rear - 0.45 * pour, 0.15 * rear - 0.35 * pour), c=GP)
            for k, sx in (("FL", 1), ("FR", -1)):
                r = R0[k]
                up_p = np.array([sx * 1.55, -0.9, 2.6])
                down_p = np.array([sx * 1.35, -2.85, 0.11])
                rp = np.array(r.p)
                if t < 0.35:
                    p = rp * (1 - rear) + up_p * rear
                    a, tt = lerp(r.a, 150, rear), lerp(r.t, 190, rear)
                elif t < 0.4:
                    w = smooth((t - 0.35) / 0.05)
                    p = up_p * (1 - w) + down_p * w
                    a, tt = lerp(150, 70, w), lerp(190, 92, w)
                else:
                    w = smooth((t - 0.72) / 0.28)
                    p = down_p * (1 - w) + rp * w + np.array([0, 0, 0.3 * bump(t, 0.75, 1.0)])
                    a, tt = lerp(70, r.a, w), lerp(92, r.t, w)
                P.legs[k] = Leg(p=tuple(p), a=a, t=tt)
            P.r("chest", p=6 * rear - 6 * pour)
            P.r("neck", p=14 * rear - 16 * pour).r("neck2", p=6 * rear - 8 * pour).r("head", p=10 * rear - 18 * pour)
            eyes(P, 1.0 + 0.3 * rear + 0.1 * pour)
            ph = tail_wave(t, amp=5.0, waves=0.6)
            tail(P, ph)
            return P

        # cast_a3 Full Length (65 f = 2.17 s): rear slowly to full height over 1.6 s (the shadow stands up at its
        # full length, arms spread high, the lamps swell), crash down at 1.6 s, settle
        CR = 48 / 65.0

        def full_length(t):
            P = rig.rest_pose()
            rise = smooth(min(1.0, t / (CR * 0.92))) * (1 - smooth((t - CR) / 0.05))
            shake = 0.015 * smooth((t - 0.45) / 0.3) * (1 - smooth((t - CR) / 0.03)) * math.sin(2 * math.pi * t * 22)
            crash = smooth((t - CR) / 0.045) * (1 - smooth((t - 0.86) / 0.14))
            body(P, pitch=38 * rise - 12 * crash, roll=0, lift=(shake, -0.35 * rise - 0.45 * crash, 0.2 * rise - 0.38 * crash), c=GP)
            for k, sx in (("FL", 1), ("FR", -1)):
                r = R0[k]
                rp = np.array(r.p)
                hi_p = np.array([sx * 1.75, -0.2, 4.6])
                crash_p = np.array([sx * 1.1, -3.0, 0.11])
                if t < CR:
                    w = smooth(t / (CR * 0.85))
                    p = rp * (1 - w) + hi_p * w
                    a, tt = lerp(r.a, 175, w), lerp(r.t, 205, w)
                elif t < CR + 0.05:
                    w = smooth((t - CR) / 0.05)
                    p = hi_p * (1 - w) + crash_p * w
                    a, tt = lerp(175, 75, w), lerp(205, 95, w)
                else:
                    w = smooth((t - 0.84) / 0.16)
                    p = crash_p * (1 - w) + rp * w + np.array([0, 0, 0.25 * bump(t, 0.85, 1.0)])
                    a, tt = lerp(75, r.a, w), lerp(95, r.t, w)
                P.legs[k] = Leg(p=tuple(p), a=a, t=tt)
            P.r("spine", p=-6 * rise).r("chest", p=-10 * rise + 4 * crash)
            P.r("neck", p=-14 * rise - 12 * crash).r("neck2", p=-10 * rise - 6 * crash).r("head", p=-16 * rise - 10 * crash + 4 * shake * 60)
            eyes(P, 1.0 + 0.45 * rise * smooth(t / CR) + 0.1 * crash)
            tail(P, tail_wave(t, amp=4.0, waves=0.6))
            return P

        # death (1.8 s): the arms buckle, it slumps forward and sideways, the mask drops, everything lies flat, the
        # lamps go out and the whole shade flattens into the ground
        def death(t):
            P = rig.rest_pose()
            buckle = smooth(t / 0.3)
            fall = smooth((t - 0.15) / 0.4)
            flat = smooth((t - 0.66) / 0.3)
            body(P, pitch=-8 * buckle * (1 - fall) - 30 * fall, roll=-8 * fall, yaw=6 * fall,
                 lift=(-0.12 * fall, -0.35 * fall, -0.12 * buckle - 0.35 * fall), c=GP)
            for k, sx in (("FL", 1), ("FR", -1)):
                r = R0[k]
                rp = np.array(r.p)
                splay = np.array([sx * 2.0, -1.9 - 0.2 * (sx < 0), 0.11])
                p = rp * (1 - fall) + splay * fall
                P.legs[k] = Leg(p=tuple(p), a=lerp(r.a, 85, fall), t=lerp(r.t, 100, fall))
            P.r("chest", p=-10 * fall, r=-6 * fall)
            P.r("neck", p=8 * buckle * (1 - fall) - 22 * fall, y=16 * fall).r("neck2", p=-12 * fall, y=10 * fall)
            P.r("head", p=-6 * fall, r=58 * fall)
            eyes(P, max(0.02, 1.0 - smooth((t - 0.55) / 0.3)))
            ph = tail_wave(t, amp=6.0 * (1 - fall), waves=0.6)
            tail(P, [p_ + 8 * fall * math.sin(i) for i, p_ in enumerate(ph)])
            P.root_scale = (1.0 + 0.08 * flat, 1.0 + 0.05 * flat, 1.0 - 0.72 * flat)
            return P

        return [Clip("idle", 90, idle, loop=True), Clip("run", RUN_F, run, loop=True),
                Clip("attack1", 30, attack, impact=0.4), Clip("cast_a1", 35, sweep, impact=0.4),
                Clip("cast_a2", 40, pool, impact=0.4), Clip("cast_a3", 65, full_length, impact=0.4),
                Clip("death", 55, death)]

    def icon_setup(self, rig):
        # the head and the shoulders at the idle's start, three-quarter from the front-left, a little above
        return ("idle", 0, (0.08, -1.3, 3.12), 32.0, 14.0, 2.1)


# ════════════════════════════════════════════════════════════════════════════════════════════════
class Sunsplinter(Monster):
    """The Needle's broken tip, still holding the noon: a square pyramidion shaft-fragment (hour-tick grooves, a
    dawnglass-glazed point, the broken base jagged) floats above-front of a faceted orb of noon light; around the
    orb a loose shell of chalk shaft-fragments (fresh broken ends, ironstone band remnants), an inner orbit of
    dawnglass crystals and an outer orbit of small chips. Every piece hangs on its own bone from the orb's centre,
    so it can orbit, lift, scatter, vanish and re-form."""
    ID = "sunsplinter"
    HEIGHT = 3.2
    BODY_TOP = 3.2
    RUN_SPEED = 3.0
    TEX = 1024
    TEX_SIZES = {"orm": 512}
    VOX_LOW = 0.011
    VOX_HIGH = 0.0065
    TRIS = {"stone": 7400}
    CLIPS = ("idle", "run", "attack1", "cast_a1", "cast_a2", "cast_a3", "death")
    GLOW = {"core": ("sunsplinter_noon", 0.8, "#FFCB62")}
    UV_WEIGHTS = {"glass": 0.6, "core": 0.15}
    BAKE_RAY = (0.02, 0.06)
    AO_DIST = 0.25
    ICON = True
    ICON_LIGHT = (1.0, 1.1, 1.6)
    ICON_BG = ((0.24, 0.21, 0.27), (0.05, 0.045, 0.065))
    C = np.array([0.0, 0.0, 1.66])
    # tip: broken base B, axis 38 degrees above forward
    TA = K.nrm(np.array([0.0, -math.cos(math.radians(38)), math.sin(math.radians(38))]))
    TB = np.array([0.0, -0.25, 1.98])
    TLS, TLP, TW0, TW1 = 1.02, 0.86, 0.3, 0.25
    TCUT = 0.5                                          # the stone pyramid stops here; the glazed point continues
    PAL = {"chalk": "#E6E0D3", "break": "#D2C5AC", "groove": "#6B635A", "iron": "#5A524B", "under": "#BDBCB8"}

    def __init__(self):
        rng = np.random.RandomState(17)
        C = self.C
        # ring frames: the stone halo leans toward the viewer (front low, back high); the glass sunburst leans the
        # other way; the chips circle level and wide
        self.nA = sdf.rot_x(-24) @ np.array([0, 0, 1.0])
        self.nG = sdf.rot_x(20) @ np.array([0, 0, 1.0])
        self.nC = np.array([0, 0, 1.0])
        self.stones = []

        def ring_dir(n, ang):
            e1 = K.nrm(np.cross(n, (1.0, 0, 0)))
            e2 = np.cross(n, e1)
            return K.nrm(e1 * math.cos(ang) + e2 * math.sin(ang))
        iron = {1, 4, 7}
        for i in range(9):
            ang = 2 * math.pi * (i + 0.5) / 9 + rng.uniform(-0.12, 0.12)
            v = ring_dir(self.nA, ang)
            tan = K.nrm(np.cross(self.nA, v))
            ax = K.rodrigues(tan, v, math.radians(rng.uniform(-25, 25)))
            L, w = rng.uniform(0.78, 1.0), rng.uniform(0.2, 0.25)
            self.stones.append(dict(c=C + v * rng.uniform(1.12, 1.22), v=v, ax=ax, L=L, w=w, roll=rng.uniform(-20, 20),
                                    band=(i not in iron) and rng.uniform() < 0.5, bpos=rng.uniform(-0.25, 0.25),
                                    iron=i in iron, axis=self.nA, seed=rng.randint(1 << 30)))
        for az in (60, 180, 300):                   # the keel: fragments hanging under the orb, points down
            a_ = math.radians(az + rng.uniform(-10, 10))
            v = K.nrm(np.array([math.sin(a_) * 0.55, -math.cos(a_) * 0.55, -1.0]))
            ax = K.nrm(v + np.array([0, 0, -0.6]))
            self.stones.append(dict(c=C + v * 0.82, v=v, ax=ax, L=rng.uniform(0.6, 0.72), w=rng.uniform(0.17, 0.2),
                                    roll=rng.uniform(0, 90), band=False, bpos=0.0, iron=False, axis=np.array([0, 0, 1.0]),
                                    seed=rng.randint(1 << 30)))
        self.glass = []
        NG = 7
        for i in range(NG):
            v = ring_dir(self.nG, 2 * math.pi * i / NG)
            self.glass.append(dict(c=C + v * 0.72, v=v, L=0.42, r=0.07, axis=self.nG))
        self.chips = []
        for i in range(6):
            v = ring_dir(self.nC, 2 * math.pi * (i + 0.25) / 6)
            self.chips.append(dict(c=C + v * 1.62 + np.array([0, 0, 0.12]), v=v, s=0.1, slot=i, axis=self.nC))
        self.hard_verts = {}
        Monster.__init__(self)

    # ── rig ──
    def bones(self):
        C = self.C
        tc = self.TB + self.TA * 0.85
        bl = [B("root", (0, 0, 0), (0, -0.6, 0)),
              B("hips", tuple(C), tuple(C + np.array([0, -0.4, 0])), "root"),
              B("core", tuple(C), tuple(C + np.array([0, 0, 0.3])), "hips"),
              B("head", tuple(tc), tuple(tc + self.TA * 0.8), "hips")]
        for i, st in enumerate(self.stones):
            bl.append(B(f"s{i}", tuple(C), tuple(st["c"]), "hips"))
        for i, g in enumerate(self.glass):
            bl.append(B(f"g{i}", tuple(C), tuple(g["c"]), "hips"))
        for i, ch in enumerate(self.chips):
            bl.append(B(f"c{i}", tuple(C), tuple(ch["c"]), "hips"))
        return bl

    @property
    def PART_BIND(self):
        tb = {"tip": "head"}
        tb.update({f"s{i}": f"s{i}" for i in range(len(self.stones))})
        tb.update({f"c{i}": f"c{i}" for i in range(len(self.chips))})
        return {"stone": ("tags", tb)}

    # ── sculpt ──
    def stone_piece(self, i, st, detail):
        S = Sculpt(f"s{i}")
        rng = np.random.RandomState(st["seed"])
        F = sdf.frame(st["ax"], K.rodrigues(st["v"], st["ax"], math.radians(st["roll"])))
        half = (st["w"], st["w"] * 0.9, st["L"] / 2)
        base = RoundBox(st["c"], half, 0.03, axes=F)
        planes = []
        for sgn in (1, -1):                       # both ends broken: two slanted fracture planes each
            for _ in range(2):
                n = K.nrm(F[2] * sgn + F[0] * rng.uniform(-0.8, 0.8) + F[1] * rng.uniform(-0.8, 0.8))
                planes.append((st["c"] + F[2] * sgn * st["L"] * rng.uniform(0.3, 0.42), n))
        n = K.nrm(F[0] + F[1] * rng.uniform(0.6, 1.4))           # one corner sheared off
        planes.append((st["c"] + n * st["w"] * rng.uniform(0.8, 0.95), n))
        prim = Cut(base, planes, k=0.01)
        st["planes"], st["F"] = planes, F
        if detail:
            prim = prim.displaced(lambda P, s_=st["seed"]: -0.008 * np.clip(sdf.Noise(s_ % 997).ridged(P, 7.0, 2) - 0.55, 0, 1),
                                  0.008)
        S.add(prim, k=0.0, tag=f"s{i}")
        st["grooves"] = []
        if detail:
            # hour-tick grooves across one face
            for j in range(3):
                z = (j - 1) * st["L"] * 0.22
                p = st["c"] + F[2] * z + F[1] * half[1]
                a_, b_ = p - F[0] * st["w"] * 0.6, p + F[0] * st["w"] * 0.6
                S.sub(Capsule(a_, b_, 0.016), k=0.004)
                st["grooves"].append((a_, b_))
        return S

    def chip_piece(self, i, ch, detail):
        """Identical chips (one shape turned to each slot): the chip ring can turn one slot per idle loop seamlessly."""
        S = Sculpt(f"c{i}")
        rng = np.random.RandomState(99)
        Rs = K.rodrigues_m(ch["axis"], 2 * math.pi * ch["slot"] / 6)
        F0 = sdf.frame(np.array([0.3, -0.5, 0.8]), np.array([1.0, 0.2, 0.1]))
        F = (Rs @ F0.T).T
        base = RoundBox(ch["c"], (ch["s"], ch["s"] * 0.8, ch["s"] * 1.3), 0.02, axes=F)
        planes = [(ch["c"] + (Rs @ n) * ch["s"] * rng.uniform(0.5, 0.8), Rs @ n)
                  for n in (K.nrm(rng.normal(size=3)) for _ in range(3))]
        S.add(Cut(base, planes, k=0.006), k=0.0, tag=f"c{i}")
        return S

    def tip_piece(self, detail):
        S = Sculpt("tip")
        A, Bp = self.TA, self.TB
        F = sdf.frame(A, (1, 0, 0))
        rng = np.random.RandomState(5)
        pyr = Pyramidion(Bp, F, self.TW0, self.TW1, self.TLS, self.TLP)
        zc = self.TLS + self.TLP * self.TCUT
        planes = [(Bp + A * zc, A)]                         # the stone stops where the glazed point begins
        for _ in range(3):                                  # the broken base
            n = K.nrm(-A + F[0] * rng.uniform(-0.9, 0.9) + F[1] * rng.uniform(-0.9, 0.9))
            planes.append((Bp + A * rng.uniform(0.05, 0.14), n))
        self.tip_planes = planes
        prim = Cut(pyr, planes, k=0.01)
        if detail:
            prim = prim.displaced(lambda P: -0.007 * np.clip(sdf.Noise(77).ridged(P, 6.0, 2) - 0.55, 0, 1), 0.007)
        S.add(prim, k=0.0, tag="tip")
        # the collar where shaft meets pyramid, and an ironstone band low on the shaft
        S.add(sdf.RoundBox(Bp + A * (self.TLS - 0.02), (self.TW1 + 0.035, self.TW1 + 0.035, 0.055), 0.02, axes=F), k=0.01, tag="tip")
        self.tip_band = (Bp + A * 0.36, 0.07)
        S.add(sdf.RoundBox(self.tip_band[0], (self.TW0 * 0.93 + 0.025, self.TW0 * 0.93 + 0.025, 0.06), 0.02, axes=F), k=0.01, tag="tip")
        self.tip_grooves = []
        if detail:
            for face in range(4):
                nf = F[0] * math.cos(face * math.pi / 2) + F[1] * math.sin(face * math.pi / 2)
                tf = np.cross(A, nf)
                for z in (0.55, 0.7, 0.84):
                    hw = self.TW0 + (self.TW1 - self.TW0) * z / self.TLS
                    p = Bp + A * z + nf * hw
                    a_, b_ = p - tf * hw * 0.55, p + tf * hw * 0.55
                    S.sub(Capsule(a_, b_, 0.014), k=0.004)
                    self.tip_grooves.append((a_, b_))
        return S

    def sculpts(self, detail):
        pieces = [self.tip_piece(detail)]
        pieces += [self.stone_piece(i, st, detail) for i, st in enumerate(self.stones)]
        pieces += [self.chip_piece(i, ch, detail) for i, ch in enumerate(self.chips)]
        return {"stone": pieces}

    def hard(self, col):
        out = []
        # the noon core: a smooth orb of light (no facets: the Vale has no gems) + a crown of short dawnglass
        # splinters radiating from it (bound to the core: they swell with it)
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=0.42)
        for v in bm.verts:
            v.co = v.co + Vector(self.C)
        me = bpy.data.meshes.new("sunsplinter_core")
        bm.to_mesh(me)
        bm.free()
        core = bpy.data.objects.new("sunsplinter_core", me)
        col.objects.link(core)
        core.data.polygons.foreach_set("use_smooth", np.ones(len(core.data.polygons), dtype=bool))
        out.append(("core", core, "core", None))
        rng = np.random.RandomState(3)
        v, f = [], []
        for k in range(12):
            d = K.nrm(rng.normal(size=3) * np.array([1, 1, 0.6]))
            crystal(v, f, self.C + d * 0.3, self.C + d * 0.52, 0.04, 0.03, sides=5, tip=0.09, twist=rng.uniform(0, 1))
        sp = mesh_object("sunsplinter_splinters", v, f, col)
        out.append(("glass", sp, "core", None))
        # the sunburst: identical dawnglass rays pointing out of the orb on a tilted ring, one bone each
        for i, g in enumerate(self.glass):
            v, f = [], []
            a_, b_ = g["c"] - g["v"] * g["L"] * 0.45, g["c"] + g["v"] * g["L"] * 0.55
            crystal(v, f, a_, b_, g["r"], g["r"] * 0.8, sides=6, tip=g["r"] * 2.2, twist=0.0, base_tip=g["r"] * 0.9)
            ob = mesh_object(f"sunsplinter_g{i}", v, f, col)
            self.hard_verts[f"g{i}"] = np.array(v)
            out.append(("glass", ob, f"g{i}", None))
        # the glazed point of the tip: a four-sided dawnglass pyramid continuing the stone pyramid
        zc = self.TLS + self.TLP * self.TCUT
        hw = self.TW1 * (1 - self.TCUT)
        F = sdf.frame(self.TA, (1, 0, 0))
        v, f = [], []
        base = self.TB + self.TA * (zc - 0.012)
        top = self.TB + self.TA * (self.TLS + self.TLP * 1.12)
        for k in range(4):
            ang = math.pi / 4 + k * math.pi / 2
            v.append(base + (F[0] * math.cos(ang) + F[1] * math.sin(ang)) * hw * math.sqrt(2) * 1.04)
        v.append(top)
        f = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)]
        cap = mesh_object("sunsplinter_cap", v, f, col)
        self.tip_point = top
        out.append(("glass", cap, "head", None))
        return out

    # ── paint / materials ──
    def paint(self, part, V, N, tags):
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        if part == "core":
            return np.tile(K.hexc("#FFF0C4"), (n, 1)), np.full(n, 0.3)
        nz = N[:, 2]
        col = np.tile(c("chalk"), (n, 1))
        col = mix_hex(col, c("under"), sarr(-0.3, -0.85, nz) * 0.6)
        rough = np.full(n, 0.66)
        key = next(iter(tags))
        if key == "tip":
            planes, grooves = self.tip_planes[1:], self.tip_grooves
            # the glazed point continues the pyramid: a fresh pale ring where stone meets glass

            bc, bw = self.tip_band
            d_band = np.abs((V - bc) @ self.TA)
            col = mix_hex(col, c("iron"), sarr(bw + 0.012, bw - 0.004, d_band) * 0.9)
            d_col = np.abs((V - (self.TB + self.TA * (self.TLS - 0.02))) @ self.TA)
            col = mix_hex(col, c("iron"), sarr(0.07, 0.05, d_col) * 0.9)
        elif key.startswith("s"):
            st = self.stones[int(key[1:])]
            planes, grooves = st["planes"], st["grooves"]
            if st["iron"]:
                col = mix_hex(np.tile(c("iron"), (n, 1)), K.hexc("#4A433D"), sarr(-0.3, -0.85, nz) * 0.6)
            if st["band"]:
                d_band = np.abs((V - st["c"]) @ st["F"][2] - st["bpos"] * st["L"])
                col = mix_hex(col, c("iron"), sarr(0.075, 0.055, d_band) * 0.9)
        else:
            planes, grooves = [], []
        # fresh fracture faces: warmer, rougher
        for p_, n_ in planes:
            on = sarr(0.02, 0.004, np.abs((V - p_) @ n_)) * sarr(0.6, 0.9, N @ n_)
            col = mix_hex(col, c("break"), on * 0.85)
            rough = rough * (1 - on) + 0.82 * on
        if grooves:
            _, gd = Longshade._along(None, V, [(a_, b_, 1.0) for a_, b_ in grooves])
            col = mix_hex(col, c("groove"), sarr(0.028, 0.012, gd) * 0.85)
        return col, rough

    def high_material(self, part, grad):
        return painted_stone(f"{self.ID}_stone_src", self.PAL["chalk"], grad, chisel=0.8, scale=2.2, chalk=(1.1, 0.5))

    def hard_material(self, part, grad):
        if part == "glass":
            pal = materials.bible_palette(dawnglass="#BCD6EA")
            return materials.glass(f"{self.ID}_glass_src", pal, "dawnglass", None, rough=0.1, depth=0.4, inclusions=0.3)
        return None

    # ── clips ──
    def clips(self, rig):
        C = self.C
        H = C.copy()
        names_s = [f"s{i}" for i in range(len(self.stones))]
        names_g = [f"g{i}" for i in range(len(self.glass))]
        names_c = [f"c{i}" for i in range(len(self.chips))]
        pieces = names_s + names_g + names_c
        cent = {b: rig.tail_pos[b].copy() for b in pieces}
        vhat = {b: K.nrm(cent[b] - C) for b in pieces}
        verts = {}
        for b in names_s + names_c:
            verts[b] = self.tag_verts.get(("stone", b))
        for b in names_g:
            verts[b] = self.hard_verts[b]
        tipv = self.tag_verts.get(("stone", "tip"))
        tip_c = rig.head_pos["head"].copy()
        rng = np.random.RandomState(23)
        ph = {b: rng.uniform(0, 1) for b in pieces}
        spin_dir = {b: rng.choice([-1, 1]) for b in pieces}
        UPV = np.array([0, 0, 1.0])

        def body(P, pitch=0.0, roll=0.0, yaw=0.0, lift=(0, 0, 0)):
            R = rot(pitch, yaw, roll)
            P.hips_rot = R
            P.hips_loc = np.array(lift, dtype=np.float64)

        axis_b = {}
        for i, st in enumerate(self.stones):
            axis_b[f"s{i}"] = st["axis"]
        for i, g in enumerate(self.glass):
            axis_b[f"g{i}"] = g["axis"]
        for i, ch in enumerate(self.chips):
            axis_b[f"c{i}"] = ch["axis"]

        def orbit(P, b, phi=0.0, lift=0.0, spin=0.0, push=0.0, off=(0, 0, 0), scale=None):
            """phi: turn along the piece's own ring (about the ring axis); lift: toward the zenith; spin: about the
            piece's radial direction; push: radial offset."""
            v = vhat[b]
            k = np.cross(v, UPV)
            k = K.nrm(k) if np.linalg.norm(k) > 1e-6 else np.array([1.0, 0, 0])
            R = K.rodrigues_m(axis_b[b], math.radians(phi)) @ K.rodrigues_m(k, math.radians(-lift)) @ \
                K.rodrigues_m(v, math.radians(spin))
            P.rot[b] = R
            P.loc[b] = (R @ v) * push + np.asarray(off, dtype=np.float64)
            if scale is not None:
                P.scl[b] = scale

        def lying(b, V_):
            """A resting orientation on the ground (longest axis level, random yaw) and the centroid height."""
            r_ = np.random.RandomState(sum(ord(ch_) * (i_ + 1) for i_, ch_ in enumerate(b)))
            X0 = V_ - V_.mean(0)
            w, ev = np.linalg.eigh(X0.T @ X0)
            ax = ev[:, 2]
            yaw = r_.uniform(0, 2 * math.pi)
            tgt = np.array([math.cos(yaw), math.sin(yaw), 0.0])
            k = np.cross(ax, tgt)
            ang = math.acos(max(-1.0, min(1.0, float(ax @ tgt))))
            R1 = K.rodrigues_m(k, ang) if np.linalg.norm(k) > 1e-6 else np.eye(3)
            R = K.rodrigues_m(tgt, r_.uniform(0, 2 * math.pi)) @ R1
            h = -float(((X0 @ R.T)[:, 2]).min()) + 0.004
            return R, h

        def piece_world(rig_, b, p_c, R, s=1.0):
            T = np.eye(4)
            T[:3, :3] = R * s
            T[:3, 3] = p_c - (R * s) @ cent_eff[b]
            return T @ rig_.rest[b]

        cent_eff = {b: (verts[b].mean(0) if verts[b] is not None else cent[b]) for b in pieces}

        def idle(t):
            P = rig.rest_pose()
            body(P, pitch=1.5 * wave(t, 0.1), roll=1.5 * wave(t, 0.35), lift=(0, 0, 0.07 * wave(t, 0.0, 2)))
            P.scl["core"] = 1.0 + 0.045 * wave(t, 0.0, 4)
            P.r("head", p=3 * wave(t, 0.2, 2), y=4 * wave(t, 0.4))
            P.loc["head"] = np.array([0, 0, 0.04 * wave(t, 0.15, 2)])
            # the halo drifts back and forth along its ring and rocks; the sunburst turns one ray-slot per loop and
            # the chip ring one chip-slot the other way (identical pieces: the loop is seamless)
            for i, b in enumerate(names_s):
                orbit(P, b, phi=10 * wave(t, 0.0) + 4 * wave(t, ph[b], 2), lift=4 * wave(t, ph[b] + 0.3, 2),
                      spin=14 * wave(t, ph[b] + 0.1), push=0.04 * wave(t, ph[b], 2))
            for b in names_g:
                orbit(P, b, phi=360.0 / len(names_g) * t)
            for b in names_c:
                orbit(P, b, phi=-360.0 / len(names_c) * t, spin=360 * t * spin_dir[b])
            return P

        RUN_F = 24

        def run(t):
            P = rig.rest_pose()
            body(P, pitch=-9 + 1.5 * wave(t, 0.1, 2), roll=2 * wave(t, 0.3), lift=(0, 0, -0.04 + 0.04 * wave(t, 0.0, 2)))
            P.scl["core"] = 1.0 + 0.03 * wave(t, 0.0, 2)
            P.r("head", p=-8 + 2 * wave(t, 0.2, 2))
            for b in names_s + names_g:
                z_ = (cent[b][2] - C[2])
                orbit(P, b, phi=6 * wave(t, ph[b]), lift=4 * wave(t, ph[b], 2), spin=14 * wave(t, ph[b] + 0.2),
                      off=(0.04 * wave(t, ph[b]), 0.24 + 0.06 * wave(t, ph[b], 2) + 0.06 * max(0.0, z_), 0.03 * wave(t, ph[b] + 0.25, 2)))
            for b in names_c:
                orbit(P, b, phi=10 * wave(t, ph[b]), spin=360 * t * spin_dir[b], off=(0, 0.45, 0.05 * wave(t, ph[b], 2)))
            return P

        def attack(t):
            # the tip draws back and up, stabs forward-down at 40 %, holds, returns
            P = rig.rest_pose()
            draw = spline([(0, 0), (0.3, 1.0), (0.34, 1.05), (0.4, 0.0), (1.0, 0.0)], t)
            stab = spline([(0, 0), (0.34, 0), (0.4, 1.0), (0.56, 0.95), (0.85, 0.15), (1.0, 0)], t)
            body(P, pitch=4 * draw - 7 * stab, lift=(0, 0.12 * draw - 0.22 * stab, 0.08 * draw - 0.1 * stab))
            P.r("head", p=14 * draw - 34 * stab)
            P.loc["head"] = np.array([0, 0.42 * draw - 1.05 * stab, 0.12 * draw - 0.3 * stab])
            P.scl["core"] = 1.0 + 0.12 * stab + 0.05 * draw
            for b in names_s + names_g + names_c:
                orbit(P, b, phi=4 * wave(t, ph[b]), spin=10 * wave(t, ph[b]),
                      off=(0, 0.1 * draw - 0.18 * stab * (1.0 - vhat[b][1] * 0.5), 0.04 * draw))
            return P

        def shard_rain(t):
            # rises; the shards lift into a crown over the orb; at 40 % they launch skyward and vanish; then re-form
            # out of the orb's light while it settles
            P = rig.rest_pose()
            rise = smooth(t / 0.35) * (1 - smooth((t - 0.6) / 0.4))
            body(P, pitch=4 * rise, lift=(0, 0.05 * rise, 0.45 * rise))
            P.r("head", p=40 * rise)
            P.loc["head"] = np.array([0, 0.1 * rise, 0.2 * rise])
            P.scl["core"] = 1.0 + 0.25 * bump(t, 0.25, 0.55) + 0.05 * rise
            crown = smooth(t / 0.34)
            launch = smooth((t - 0.38) / 0.14)
            gone = smooth((t - 0.42) / 0.1) * (1 - smooth((t - 0.68) / 0.01))
            reform = smooth((t - 0.68) / 0.3)
            for b in names_s + names_g:
                el = math.degrees(math.asin(max(-1.0, min(1.0, vhat[b][2]))))
                if t < 0.68:
                    orbit(P, b, phi=10 * crown * wave(t, ph[b]), lift=(70 - el) * 0.75 * crown, spin=60 * crown * spin_dir[b],
                          push=0.25 * crown, off=(0, 0, 3.2 * launch), scale=max(0.02, 1 - gone))
                else:
                    orbit(P, b, spin=60 * (1 - reform) * spin_dir[b], scale=max(0.02, reform))
            for b in names_c:
                orbit(P, b, phi=-120 * t, lift=20 * crown, spin=360 * t * spin_dir[b])
            return P

        def noon_glare(t):
            # charge 1.2 s: the orb swells and shivers, the shards draw in and spin up; flare: the orb pops, the
            # shards blast outward; return
            P = rig.rest_pose()
            CH = 36 / 45.0
            ch = min(1.0, t / CH)
            fl = smooth((t - CH) / 0.05) * (1 - smooth((t - CH - 0.05) / 0.15))
            body(P, lift=(0.02 * ch * math.sin(2 * math.pi * t * 31) * (t < CH), 0, -0.08 * ch * (t < CH) + 0.1 * fl))
            if t < CH:
                P.scl["core"] = 1.0 + 0.6 * ch ** 1.5 + 0.035 * math.sin(2 * math.pi * t * 23) * ch
            elif t < CH + 0.05:
                P.scl["core"] = lerp(1.6, 2.5, smooth((t - CH) / 0.05))
            else:
                P.scl["core"] = lerp(2.5, 1.0, smooth((t - CH - 0.05) / (1.0 - CH - 0.05)))
            P.r("head", p=44 * smooth(t / 0.3) * (1 - smooth((t - CH - 0.05) / 0.15)))
            P.loc["head"] = np.array([0, 0.15, 0.25]) * smooth(t / 0.3) * (1 - smooth((t - CH - 0.05) / 0.15))
            pull = smooth(t / CH) * (1 - smooth((t - CH) / 0.04))
            for b in names_s + names_g + names_c:
                blast = fl * (1.0 if b[0] != "c" else 1.4) * (0.35 if vhat[b][2] < -0.3 else 1.0)
                orbit(P, b, phi=(90 * ch * ch) * spin_dir[b] * (b[0] == "g"), spin=540 * ch * ch * spin_dir[b],
                      push=-0.32 * pull + 0.95 * blast)
            return P

        def splinter_spray(t):
            # the tip turns to point straight ahead, the shards gather behind it in a cone; at 40 % they spray
            # forward and vanish; the tip recoils; the shards re-form out of the orb
            P = rig.rest_pose()
            aim = smooth(t / 0.3) * (1 - smooth((t - 0.55) / 0.4))
            recoil = bump(t, 0.38, 0.6)
            body(P, pitch=-3 * aim, lift=(0, 0.1 * recoil, 0))
            P.r("head", p=-44 * aim)
            P.loc["head"] = np.array([0, 0.1 * aim + 0.35 * recoil, -0.25 * aim])
            P.scl["core"] = 1.0 + 0.3 * bump(t, 0.3, 0.5)
            gather = smooth(t / 0.34)
            shoot = smooth((t - 0.37) / 0.13)
            gone = smooth((t - 0.42) / 0.08)
            reform = smooth((t - 0.66) / 0.3)
            fwd = np.array([0, -1.0, 0])
            for j, b in enumerate(names_s + names_g):
                if t < 0.66:
                    ring = 2 * math.pi * j / 20
                    rr_ = 0.35 + 0.45 * ((j * 7) % 5) / 4
                    p_g = C + np.array([math.cos(ring) * rr_, -0.35 - 0.3 * ((j * 3) % 4) / 3, math.sin(ring) * rr_ * 0.8 + 0.1])
                    p_c = cent_eff[b] * (1 - gather) + p_g * gather + (fwd * 4.5 + np.array([0, 0, -0.9])) * shoot
                    # point each piece forward while it gathers (its long axis to -Y)
                    Vb = verts[b]
                    X0 = Vb - Vb.mean(0)
                    w, ev = np.linalg.eigh(X0.T @ X0)
                    ax = ev[:, 2] * (1 if ev[1, 2] < 0 else -1)
                    k = np.cross(ax, fwd)
                    ang = math.acos(max(-1.0, min(1.0, float(ax @ fwd))))
                    R_al = K.rodrigues_m(k, ang) if np.linalg.norm(k) > 1e-6 else np.eye(3)
                    R = slerp_R(np.eye(3), R_al, gather)
                    P.world[b] = piece_world(rig, b, p_c, R, max(0.02, 1 - gone))
                else:
                    orbit(P, b, spin=90 * (1 - reform) * spin_dir[b], scale=max(0.02, reform))
            for b in names_c:
                orbit(P, b, phi=-90 * t, spin=360 * t * spin_dir[b])
            return P

        lie = {b: lying(b, verts[b]) for b in pieces}
        fall_at = {b: 0.2 + 0.16 * rng.uniform() for b in pieces}
        land = {}
        for b in pieces:
            c0 = cent_eff[b]
            out = K.nrm(np.array([c0[0], c0[1], 0.0]) + 1e-6)
            land[b] = np.array([c0[0], c0[1], 0.0]) + out * rng.uniform(0.3, 0.9) + np.array([0, 0, lie[b][1]])
        # the tip plants point-first in the ground, leaning
        tp0 = self.tip_point
        d_end = K.nrm(np.array([0.12, -0.25, -0.96]))
        kk = np.cross(self.TA, d_end)
        R_tip = K.rodrigues_m(kk, math.acos(float(self.TA @ d_end)))
        tip_end_point = np.array([0.08, -1.45, -0.42])
        tip_cent_end = tip_end_point + R_tip @ (tip_c - tp0)

        def death(t):
            P = rig.rest_pose()
            body(P, lift=(0, 0, -0.1 * smooth(t / 0.3)))
            flick = 1.0 + 0.3 * math.sin(2 * math.pi * t * 9) * (1 - smooth((t - 0.15) / 0.1))
            P.scl["core"] = max(0.02, flick * (1 - smooth((t - 0.18) / 0.2)))
            for b in pieces:
                s_ = min(1.0, max(0.0, (t - fall_at[b]) / 0.24))
                c0 = cent_eff[b] + vhat[b] * 0.15 * smooth(t / 0.18)
                R_end, h = lie[b]
                p_end = land[b]
                p = c0 * (1 - s_) + p_end * s_
                p[2] = c0[2] + (p_end[2] - c0[2]) * s_ * s_
                if s_ >= 1.0:
                    p[2] = p_end[2] + 0.05 * bump(t, fall_at[b] + 0.24, fall_at[b] + 0.34)
                R = slerp_R(np.eye(3), R_end, smooth(s_))
                P.world[b] = piece_world(rig, b, p, R)
            # the tip: tips over and plunges point-first
            s_ = min(1.0, max(0.0, (t - 0.28) / 0.26))
            R = slerp_R(np.eye(3), R_tip, s_ ** 1.5)
            p = tip_c * (1 - s_) + tip_cent_end * s_
            p[2] = tip_c[2] + (tip_cent_end[2] - tip_c[2]) * s_ * s_
            wob = 2.5 * bump(t, 0.54, 0.7)
            P.world["head"] = piece_world_tip(p, K.rz(wob) @ R)
            return P

        def piece_world_tip(p_c, R):
            T = np.eye(4)
            T[:3, :3] = R
            T[:3, 3] = p_c - R @ tip_c
            return T @ rig.rest["head"]

        return [Clip("idle", 120, idle, loop=True), Clip("run", RUN_F, run, loop=True),
                Clip("attack1", 30, attack, impact=0.4), Clip("cast_a1", 40, shard_rain, impact=0.4),
                Clip("cast_a2", 45, noon_glare, impact=0.4), Clip("cast_a3", 35, splinter_spray, impact=0.4),
                Clip("death", 50, death)]

    def icon_setup(self, rig):
        return ("cast_a2", 26, (0.0, -0.1, 2.35), 50.0, 18.0, 3.1)


# ════════════════════════════════════════════════════════════════════════════════════════════════
class Gloamoth(Monster):
    """A big moth of dusk light, hovering: a soft lilac-furred body with a cream collar ruff, large dark eyes,
    feathered antennae and an amber-banded abdomen; two pairs of broad wings painted like lamp-shades — pleated
    panels between dark radial veins, the panel centres lit-through amber, fading to dusk violet at the scalloped
    edge with a cream fringe, a decor band and one painted dot per panel. The wings carry a faint glow (<= 0.8)."""
    ID = "gloamoth"
    HEIGHT = 1.6
    BODY_TOP = 1.6
    RUN_SPEED = 3.4
    S = 1.0
    LITTLE = False
    TEX = 1024
    VOX_LOW = 0.009
    VOX_HIGH = 0.0055
    TRIS = {"body": 2300}
    CLIPS = ("idle", "run", "attack1", "death")
    HEAT_EXCLUDE = ("root", "wing_f.L", "wing_f2.L", "wing_h.L", "wing_h2.L", "wing_f.R", "wing_f2.R", "wing_h.R", "wing_h2.R")
    GLOW = {"wings_f": ("gloamoth_wing", 0.3), "wings_h": ("gloamoth_wing", 0.3)}
    NO_AO = ("wings_f", "wings_h")
    UV_WEIGHTS = {"wings_f": 1.25, "wings_h": 1.0, "body": 0.8}
    BAKE_RAY = (0.012, 0.035)
    AO_DIST = 0.15
    WING_RES = (6, 24)                 # low wing rings x sectors
    PAL = {"fur": "#A18CBA", "fur_dk": "#65507F", "collar": "#EDE0C8", "eye": "#221A2B", "abd_a": "#D9A066",
           "abd_b": "#8C76A6", "antenna": "#DCC8A2", "leg": "#4F3F60",
           "w_root": "#33224F", "w_amber": "#F2A53E", "w_mid": "#A4507A", "w_edge": "#3C2A62", "w_vein": "#2E1D3B",
           "w_fringe": "#F2E2C4", "w_dot": "#FFE4A8"}

    def __init__(self):
        sc = self.S
        self.B = np.array([0.0, 0.0, 1.12 if not self.LITTLE else 0.548])
        # wings: root offset from the body centre, span direction (dihedral), sweep, lengths
        dih = 30.0 if not self.LITTLE else 34.0
        self.wings = {}
        for side, sx in (("L", 1), ("R", -1)):
            for kind in ("f", "h"):
                if kind == "f":
                    root = self.B + np.array([sx * 0.07, -0.05, 0.06]) * sc
                    yaw, d_, L = -12.0, dih, (0.86 if not self.LITTLE else 0.74)
                    th0, th1 = -28.0, 98.0
                else:
                    root = self.B + np.array([sx * 0.065, 0.06, 0.02]) * sc
                    yaw, d_, L = 18.0, dih - 10.0, (0.64 if not self.LITTLE else 0.58)
                    th0, th1 = 15.0, 128.0
                # span direction u (out to the side, tilted up by the dihedral, swept by yaw), chord v (backward)
                u = K.nrm(np.array([sx * math.cos(math.radians(d_)) * math.cos(math.radians(yaw)),
                                    math.sin(math.radians(yaw)) * math.cos(math.radians(d_)), math.sin(math.radians(d_))]))
                v0 = np.array([0.0, 1.0, 0.0])
                v = K.nrm(v0 - u * (u @ v0))
                n = np.cross(u, v) * sx
                self.wings[(kind, side)] = dict(root=root, u=u, v=v, n=n, L=L, th0=th0, th1=th1, sx=sx, kind=kind)
        super().__init__()

    # wing outline: radius (fraction of L) along polar angle theta (deg, 0 = span direction, + toward the chord)
    def r_of(self, kind, th):
        th = np.asarray(th, dtype=np.float64)
        if kind == "f":
            base = np.interp(th, [-28, -12, 6, 24, 50, 75, 98], [0.42, 0.86, 1.0, 0.95, 0.72, 0.5, 0.36])
            sc_ = 0.035 * np.abs(np.sin(np.radians(th - 6) * 7.5)) * (th > 8)
        else:
            base = np.interp(th, [15, 40, 70, 100, 115, 128], [0.55, 0.92, 1.0, 0.86, 0.66, 0.45])
            sc_ = 0.04 * np.abs(np.sin(np.radians(th - 15) * 8.0))
        if self.LITTLE:
            sc_ = sc_ * 0.6
            base = base ** 0.7                     # rounder
        return base - sc_

    def wing_point(self, w, s_, th):
        r = self.r_of(w["kind"], th) * w["L"] * self.S
        a = np.radians(th)
        camber = 0.035 * w["L"] * self.S * s_ * (1 - s_) * 4
        return (w["root"] + s_ * r * (np.cos(a) * w["u"] + np.sin(a) * w["v"]) + camber * w["n"])

    def wing_mesh(self, name, w, rings, sectors, col, thick):
        import bmesh
        ss = np.concatenate([[0.0], np.linspace(0.12, 1.0, rings)])
        ths = np.linspace(w["th0"], w["th1"], sectors + 1)
        verts, faces = [], []
        for s_ in ss:
            for th in ths:
                verts.append(self.wing_point(w, s_, th))
        nT = len(ths)
        for i in range(len(ss) - 1):
            for j in range(nT - 1):
                a = i * nT + j
                faces.append((a, a + 1, a + nT + 1, a + nT))
        ob = mesh_object(name, verts, faces, col, smooth_shade=True)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.to_mesh(ob.data)
        bm.free()
        m = ob.modifiers.new("solid", "SOLIDIFY")
        m.thickness = thick
        m.offset = 0.0
        m.use_even_offset = True
        mesh.apply_modifiers(ob)
        ob.data.polygons.foreach_set("use_smooth", np.ones(len(ob.data.polygons), dtype=bool))
        return ob

    def wing_coords(self, w, V):
        d = V - w["root"]
        uu, vv = d @ w["u"], d @ w["v"]
        th = np.degrees(np.arctan2(vv, uu))
        r = self.r_of(w["kind"], th) * w["L"] * self.S
        return np.hypot(uu, vv) / np.maximum(r, 1e-6), th

    def wing_of(self, V):
        """(kind, side) of the nearest wing for each vertex."""
        keys = list(self.wings)
        D = []
        for k in keys:
            w = self.wings[k]
            s_, th = self.wing_coords(w, V)
            inside = (th >= w["th0"] - 5) & (th <= w["th1"] + 5)
            D.append(np.where(inside, np.abs(np.minimum(s_, 1.0) - s_) + np.abs((V - w["root"]) @ w["n"]), 9.0))
        return [keys[i] for i in np.argmin(np.stack(D), 0)]

    # ── rig ──
    def bones(self):
        sc, Bc = self.S, self.B
        P_ = lambda p: tuple(Bc + np.array(p) * sc)  # noqa: E731
        bl = [B("root", (0, 0, 0), (0, -0.4 * sc, 0)),
              B("hips", P_((0, 0.05, 0)), P_((0, -0.12, 0.02)), "root"),
              B("head", P_((0, -0.13, 0.03)), P_((0, -0.26, 0.02)), "hips"),
              B("abdomen", P_((0, 0.12, -0.02)), P_((0, 0.32, -0.12)), "hips"),
              B("abdomen2", P_((0, 0.32, -0.12)), P_((0, 0.52, -0.24)), "abdomen", True)]
        for side, sx in (("L", 1), ("R", -1)):
            bl.append(B(f"antenna.{side}", P_((sx * 0.04, -0.2, 0.08)), P_((sx * 0.16, -0.3, 0.38)), "head"))
            for kind in ("f", "h"):
                w = self.wings[(kind, side)]
                mid = self.wing_point(w, 0.5, 30 if kind == "f" else 70)
                tip = self.wing_point(w, 1.0, 30 if kind == "f" else 70)
                bl.append(B(f"wing_{kind}.{side}", tuple(w["root"]), tuple(mid), "hips"))
                bl.append(B(f"wing_{kind}2.{side}", tuple(mid), tuple(tip), f"wing_{kind}.{side}", True))
        return bl

    @property
    def PART_BIND(self):
        return {"wings_f": self.bind_wings, "wings_h": self.bind_wings}

    def bind_wings(self, ob, arm):
        V, _ = K.arrays(ob)
        ob.vertex_groups.clear()
        which = self.wing_of(V)
        for kind, side in self.wings:
            w = self.wings[(kind, side)]
            m = np.array([k == (kind, side) for k in which])
            if not m.any():
                continue
            s_, _ = self.wing_coords(w, V[m])
            t = sarr(0.3, 0.75, s_)
            idx = np.nonzero(m)[0]
            g1 = ob.vertex_groups.get(f"wing_{kind}.{side}") or ob.vertex_groups.new(name=f"wing_{kind}.{side}")
            g2 = ob.vertex_groups.get(f"wing_{kind}2.{side}") or ob.vertex_groups.new(name=f"wing_{kind}2.{side}")
            for i, tt in zip(idx, t):
                if tt < 0.999:
                    g1.add([int(i)], float(1 - tt), "REPLACE")
                if tt > 0.001:
                    g2.add([int(i)], float(tt), "REPLACE")
        mesh.add_armature_modifier(ob, arm)
        mesh.parent_keep(ob, arm)

    # ── sculpt ──
    def sculpts(self, detail):
        sc, Bc = self.S, self.B
        S = Sculpt("body")
        lit = self.LITTLE
        fluff = (lambda P: -0.012 * sc * (1 - np.abs(NOISE(P / sc, 9.0))) +
                 (0.004 * sc * NOISE.fbm(P / sc * np.array([1.0, 1.0, 1.0]), 40.0, 2) if detail else 0.0))
        amp = 0.016 * sc

        def add(prim, k, tag="fur", d=True):
            if d:
                prim = prim.displaced(fluff, amp)
            S.add(prim, k=k * sc, tag=tag)

        def E(c, r, axes=None):
            return Ellipsoid(tuple(Bc + np.array(c) * sc), tuple(np.array(r) * sc), axes=axes)

        def RC(a, b, ra, rb):
            return RoundCone(tuple(Bc + np.array(a) * sc), tuple(Bc + np.array(b) * sc), ra * sc, rb * sc)
        k_ = 1.25 if lit else 1.0
        add(E((0, 0.0, 0.0), (0.18 * k_, 0.2, 0.18 * k_)), 0.0)                               # thorax
        add(E((0, -0.12, 0.0), (0.19 * k_, 0.1, 0.18 * k_)), 0.05, tag="collar")               # collar ruff
        add(E((0, -0.19, 0.02), (0.095, 0.085, 0.09)), 0.04, tag="fur")                        # head
        for sx in (1, -1):
            S.add(E((sx * 0.068, -0.225, 0.035), (0.056, 0.056, 0.062)), k=0.01 * sc, tag="eye")  # big eyes
        # abdomen: three segments trailing back and down (amber bands painted)
        for (a, b, ra, rb) in (((0, 0.12, -0.02), (0, 0.3, -0.1), 0.15 * k_, 0.13 * k_),
                               ((0, 0.3, -0.1), (0, 0.46, -0.19), 0.125 * k_, 0.09 * k_),
                               ((0, 0.46, -0.19), (0, 0.56, -0.26), 0.07 * k_, 0.03)):
            add(RC(a, b, ra, rb), 0.05, tag="abd")
        # six small folded legs under the thorax
        for sx in (1, -1):
            for y0 in (-0.08, 0.0, 0.08):
                a = (sx * 0.08, y0, -0.1)
                b = (sx * 0.13, y0 - 0.02, -0.2)
                c = (sx * 0.1, y0 - 0.05, -0.27)
                S.add(sdf.Tube([Bc + np.array(a) * sc, Bc + np.array(b) * sc, Bc + np.array(c) * sc],
                               [0.022 * sc, 0.018 * sc, 0.014 * sc], k=0.01 * sc), k=0.02 * sc, tag="leg")
        # feathered antennae: a shaft with a flat comb-leaf of fronds
        for sx in (1, -1):
            a = Bc + np.array([sx * 0.04, -0.2, 0.08]) * sc
            pts = tube_path(a, (sx * 0.4, -0.35, 1.0), 0.36 * sc, np.array([1.0, 0, 0]), 40, 4)
            S.add(sdf.Tube(pts, [0.014 * sc, 0.012 * sc, 0.011 * sc, 0.01 * sc, 0.009 * sc], k=0.005 * sc), k=0.01 * sc, tag="antenna")
            for i in range(4):
                c = (pts[i] + pts[i + 1]) / 2
                d = pts[i + 1] - pts[i]
                wdt = (0.045 + 0.03 * math.sin(math.pi * (i + 0.5) / 4)) * sc
                side = K.nrm(np.cross(d, (0, -1.0, 0.2)))
                S.add(sdf.FlatCapsule(pts[i], pts[i + 1], wdt, 0.01 * sc, wdt * 0.85, 0.01 * sc, side=side), k=0.008 * sc,
                      tag="antenna")
                if detail:          # fronds: notches cut into the leaf's edges
                    for j in range(3):
                        q = pts[i] + d * (j + 0.5) / 3
                        for sgn in (1, -1):
                            S.sub(Capsule(q + side * sgn * wdt * 0.55, q + side * sgn * wdt * 1.2, 0.006 * sc), k=0.002)
        return {"body": S}

    def hard(self, col):
        out = []
        rings, sectors = self.WING_RES
        for kind in ("f", "h"):
            for side in ("L", "R"):
                w = self.wings[(kind, side)]
                lo = self.wing_mesh(f"{self.ID}_wing_{kind}{side}", w, rings, sectors, col, 0.012 * self.S)
                hi = self.wing_mesh(f"{self.ID}_wing_{kind}{side}_hi", w, 60, 200, col, 0.012 * self.S)
                out.append((f"wings_{kind}", lo, self.PART_BIND[f"wings_{kind}"], hi))
        return out

    # ── paint ──
    def wing_paint(self, V, N):
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        col = np.zeros((n, 3))
        rough = np.full(n, 0.55)
        which = self.wing_of(V)
        for key in self.wings:
            w = self.wings[key]
            m = np.array([k == key for k in which])
            if not m.any():
                continue
            s_, th = self.wing_coords(w, V[m])
            s_ = np.clip(s_, 0, 1.05)
            # radial gradient: dusk root -> lit amber -> rose -> violet edge
            g = np.interp(s_, [0.0, 0.18, 0.42, 0.66, 0.86, 1.0], [0, 0, 1, 1.6, 2.4, 3.0])
            stops = [c("w_root"), c("w_amber"), c("w_mid"), c("w_edge")]
            gi = np.clip(g, 0, 2.999)
            i0 = np.floor(gi).astype(int)
            f = (gi - i0)[:, None]
            cc = np.array(stops)[i0] * (1 - f) + np.array(stops)[np.minimum(i0 + 1, 3)] * f
            # pleated lamp-shade panels: radial veins, each panel brighter at its middle (light through the shade)
            npan = 6 if w["kind"] == "f" else 5
            u = (th - w["th0"]) / (w["th1"] - w["th0"]) * npan
            fr = u - np.floor(u)
            vein = sarr(0.035, 0.0, np.minimum(fr, 1 - fr)) * sarr(0.12, 0.2, s_)
            glow = sarr(0.45, 0.0, np.abs(fr - 0.5)) * sarr(0.25, 0.5, s_) * sarr(0.9, 0.6, s_)
            cc = cc * (1 + 0.28 * glow[:, None])
            # decor: a cream band at 0.36 and 0.8, a dot per panel at 0.68, the scalloped edge fringed cream
            band = sarr(0.016, 0.004, np.abs(s_ - 0.36)) + sarr(0.014, 0.004, np.abs(s_ - 0.8))
            dot = sarr(0.075, 0.045, np.hypot((fr - 0.5) * 0.9, (s_ - 0.68) * 2.2)) * sarr(0.1, 0.2, s_)
            fringe = sarr(0.91, 0.97, s_)
            cc = mix_hex(cc, c("w_fringe"), np.clip(band, 0, 1) * 0.85)
            cc = mix_hex(cc, c("w_dot"), dot)
            cc = mix_hex(cc, c("w_vein"), np.clip(vein, 0, 1) * 0.9)
            cc = mix_hex(cc, c("w_fringe"), fringe * 0.9)
            # the underside a little duskier
            under = sarr(0.0, -0.6, (N[m] @ w["n"]) * w["sx"] * np.sign(w["n"][2] + 1e-6))
            cc = cc * (1 - 0.12 * under[:, None])
            col[m] = cc
        return col, rough

    def paint(self, part, V, N, tags):
        if part.startswith("wings"):
            return self.wing_paint(V, N)
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        sc, Bc = self.S, self.B
        rel = (V - Bc) / sc
        col = mix_hex(np.tile(c("fur"), (n, 1)), c("fur_dk"), sarr(0.2, -0.6, N[:, 2]) * 0.6)
        rough = np.full(n, 0.9)
        dmin = np.min(np.stack(list(tags.values())), 0)
        for tag in ("collar", "eye", "abd", "antenna", "leg"):
            w = np.clip(1 - (tags[tag] - dmin) / (0.008 * sc), 0, 1) * (tags[tag] < 0.02 * sc)
            if tag == "collar":
                kc = mix_hex(np.tile(c("collar"), (n, 1)), c("fur"), sarr(-0.02, 0.06, rel[:, 1]))
                r_ = 0.92
            elif tag == "eye":
                kc, r_ = np.tile(c("eye"), (n, 1)), 0.25
            elif tag == "abd":
                band = 0.5 + 0.5 * np.sin((rel[:, 1] - 0.12) / 0.075 * math.pi)
                kc = mix_hex(np.tile(c("abd_b"), (n, 1)), c("abd_a"), sarr(0.72, 0.95, band) * 0.75)
                kc = mix_hex(kc, c("fur_dk"), sarr(0.1, -0.7, N[:, 2]) * 0.5)
                r_ = 0.88
            elif tag == "antenna":
                kc, r_ = np.tile(c("antenna"), (n, 1)), 0.8
            else:
                kc, r_ = np.tile(c("leg"), (n, 1)), 0.8
            col = mix_hex(col, kc, w)
            rough = rough * (1 - w) + r_ * w
        return col, rough

    def high_material(self, part, grad):
        if part.startswith("wings"):
            return K.painted_material(f"{self.ID}_{part}_src", self.PAL["w_amber"], None, fur=0.01, chalk=(1.15, 0.6),
                                      cavity=(0.8, 1.0), breakup=0.05, top=0.05)
        return K.painted_material(f"{self.ID}_body_src", self.PAL["fur"], grad, fur=0.08, fur_scale=(1.5, 1.5, 1.5),
                                  chalk=(1.2, 0.7), breakup=0.05)

    def weight_fix(self, ob):
        rules = [(lambda n: n.endswith(".L"), lambda V: sarr(-0.01, 0.03, V[:, 0])),
                 (lambda n: n.endswith(".R"), lambda V: sarr(0.01, -0.03, V[:, 0]))]
        K.mask_weights(ob, rules)
        K.smooth_weights(ob, iters=2, k=0.5)

    # ── clips ──
    def flap(self, P, kind, side, up=0.0, fwd=0.0, twist=0.0, flex=0.0):
        """Wing pose in the body frame: up (deg, + raises the tip), fwd (deg, + sweeps the tip forward), twist
        (deg, about the span: + pitches the leading edge up), flex (deg, the outer half lags / bends)."""
        w = self.wings[(kind, side)]
        sx = w["sx"]
        Rup = K.rodrigues_m(np.array([0, 1.0, 0]), math.radians(-up * sx))
        Rfw = K.rodrigues_m(np.array([0, 0, 1.0]), math.radians(fwd * sx))
        Rtw = K.rodrigues_m(w["u"], math.radians(twist * sx))
        P.R(f"wing_{kind}.{side}", Rfw @ Rup @ Rtw)
        if flex:
            P.R(f"wing_{kind}2.{side}", K.rodrigues_m(np.array([0, 1.0, 0]), math.radians(-flex * sx)))

    def clips(self, rig):
        sc, Bc = self.S, self.B
        H = rig.head_pos["hips"].copy()
        spd = self.RUN_SPEED
        lit = self.LITTLE

        def body(P, pitch=0.0, roll=0.0, yaw=0.0, lift=(0, 0, 0)):
            R = rot(pitch, yaw, roll)
            P.hips_rot = R
            P.hips_loc = pivot(R, Bc, H) + np.array(lift, dtype=np.float64) * sc

        def beat(P, ph, amp, mid=0.0, fwd=0.0, lag=0.08, flex=14.0, sweep=0.0):
            for side in ("L", "R"):
                for kind, dph in (("f", 0.0), ("h", lag)):
                    a = math.sin(2 * math.pi * (ph - dph))
                    da = math.cos(2 * math.pi * (ph - dph))
                    self.flap(P, kind, side, up=mid + amp * a, fwd=fwd + sweep * da, twist=10 * da,
                              flex=flex * math.sin(2 * math.pi * (ph - dph - 0.12)))

        NF = 4 if not lit else 6           # flaps per idle loop

        def idle(t):
            P = rig.rest_pose()
            ph = NF * t
            body(P, pitch=3 * wave(t, 0.1) - 2, roll=3 * wave(t, 0.3), yaw=4 * wave(t, 0.6),
                 lift=(0.03 * wave(t, 0.2), 0, 0.045 * math.sin(2 * math.pi * (ph + 0.3)) + 0.03 * wave(t, 0.0)))
            beat(P, ph, 34 if not lit else 30, mid=-4, sweep=6)
            P.r("head", p=4 * wave(t, 0.2), y=8 * wave(t, 0.5))
            P.r("antenna.L", p=8 * wave(t, 0.3, 2), y=6 * wave(t, 0.1)).r("antenna.R", p=8 * wave(t, 0.4, 2), y=-6 * wave(t, 0.15))
            P.r("abdomen", p=-4 + 5 * math.sin(2 * math.pi * (ph - 0.25)), y=4 * wave(t, 0.4)).r("abdomen2", p=4 * math.sin(2 * math.pi * (ph - 0.35)))
            return P

        RUN_F = 18 if not lit else 15
        NR = 3

        def run(t):
            P = rig.rest_pose()
            ph = NR * t
            body(P, pitch=-18 + 3 * math.sin(2 * math.pi * ph), roll=2 * wave(t, 0.3),
                 lift=(0, 0, -0.06 + 0.05 * math.sin(2 * math.pi * (ph + 0.3))))
            beat(P, ph, 42 if not lit else 36, mid=-2, fwd=-8, sweep=10, flex=18)
            P.r("head", p=12)
            P.r("antenna.L", p=-25 + 6 * math.sin(2 * math.pi * ph)).r("antenna.R", p=-25 + 6 * math.sin(2 * math.pi * ph))
            P.r("abdomen", p=10 + 4 * math.sin(2 * math.pi * (ph - 0.3))).r("abdomen2", p=6)
            return P

        def attack(t):
            # rear back with the wings raised, dive forward-down and brush the target with a forward wing sweep at
            # 40 %, beat back up
            P = rig.rest_pose()
            up = spline([(0, 0), (0.28, 1.0), (0.33, 1.0), (0.4, 0.0), (1.0, 0.0)], t)
            dive = spline([(0, 0), (0.32, 0), (0.4, 1.0), (0.55, 0.9), (0.85, 0.15), (1.0, 0)], t)
            body(P, pitch=18 * up - 32 * dive, lift=(0, 0.18 * up - 0.55 * dive, 0.12 * up - 0.38 * dive))
            for side in ("L", "R"):
                for kind, lag in (("f", 0.0), ("h", 0.04)):
                    tt = max(0.0, t - lag)
                    upw = spline([(0, 0), (0.28, 62), (0.34, 66), (0.4, -38), (0.55, -30), (0.8, 10), (1.0, 0)], tt)
                    fw = spline([(0, 0), (0.28, -20), (0.34, -24), (0.4, 42), (0.55, 36), (0.85, 5), (1.0, 0)], tt)
                    self.flap(P, kind, side, up=upw, fwd=fw, twist=-12 * dive + 10 * up, flex=-18 * dive + 12 * up)
            P.r("head", p=-10 * up + 14 * dive)
            P.r("antenna.L", p=-30 * dive).r("antenna.R", p=-30 * dive)
            P.r("abdomen", p=-12 * up + 18 * dive)
            return P

        def death(t):
            # a last stutter of beats, the wings fold up together over the back, it spirals down and lands on its
            # side, a final twitch
            P = rig.rest_pose()
            fold = smooth((t - 0.15) / 0.3)
            fall = smooth((t - 0.12) / 0.6)
            land = smooth((t - 0.5) / 0.2)
            twitch = bump(t, 0.82, 0.9)
            ground_z = 0.22 if not lit else 0.2
            drop = (Bc[2] / sc - ground_z) * (fall ** 1.7)
            body(P, pitch=-15 * fall + 10 * land, roll=-82 * land + 6 * twitch, yaw=140 * fall,
                 lift=(-0.12 * land, 0.1 * fall, -drop))
            ph = 3 * t
            for side in ("L", "R"):
                for kind in ("f", "h"):
                    beat_a = 30 * math.sin(2 * math.pi * ph) * (1 - fold)
                    self.flap(P, kind, side, up=beat_a + 62 * fold - 6 * twitch, fwd=(-6 if kind == "f" else 10) * fold,
                              flex=8 * fold)
            P.r("head", p=-14 * fall).r("antenna.L", p=-30 * fall, y=10 * land).r("antenna.R", p=-30 * fall)
            P.r("abdomen", p=18 * fall + 6 * twitch).r("abdomen2", p=10 * fall)
            return P

        return [Clip("idle", 60, idle, loop=True), Clip("run", RUN_F, run, loop=True),
                Clip("attack1", 30 if not lit else 25, attack, impact=0.4), Clip("death", 45, death)]


class GloamothLittle(Gloamoth):
    """The small companion: half the size, rounder and fluffier, rounder wings, beats faster."""
    ID = "gloamoth_little"
    HEIGHT = 0.8
    BODY_TOP = 0.8
    RUN_SPEED = 3.6
    S = 0.52
    LITTLE = True
    TEX = 512
    TEX_SIZES = {"orm": 256}
    VOX_LOW = 0.006
    VOX_HIGH = 0.0035
    TRIS = {"body": 1500}
    WING_RES = (5, 18)
    GLOW = {"wings_f": ("gloamoth_little_wing", 0.3), "wings_h": ("gloamoth_little_wing", 0.3)}

# ════════════════════════════════════════════════════════════════════════════════════════════════
class BoxSculpt(Sculpt):
    """A piece of a larger carving: meshed only inside its own box (the cut planes bound it)."""

    def __init__(self, name, box):
        super().__init__(name)
        self.box = (V3(box[0]), V3(box[1]))

    def bounds(self, pad: float = 0.0):
        return self.box[0] - pad, self.box[1] + pad


def crack_fn(seed: int, amp: float, freq: float):
    nz = sdf.Noise(seed)
    return lambda P: amp * nz(P, freq)


class StrayBase(Monster):
    """Shared machinery for the carved-stone Strays: the figure is a union of carved primitives cut into rigid
    chunks along noisy crack surfaces (each chunk its own SDF piece and bone, the pieces fit together), chalk paint
    with grime at the foot, lichen, drilled eyes and hairline cracks along the future break lines; death crumbles
    the chunks into a heap (absolute per-chunk transforms, gravity, PCA resting poses)."""
    TEX = 1024
    VOX_LOW = 0.01
    VOX_HIGH = 0.006
    UV_WEIGHTS = {}
    BAKE_RAY = (0.015, 0.05)
    AO_DIST = 0.2
    PAL = {"chalk": "#DCD6C8", "chalk_lo": "#C4BBA9", "grime": "#968A78", "lichen": "#8A946A", "lichen2": "#B3AE80",
           "eye": "#2A2521", "crack": "#7E7466", "groove": "#A99F8E", "break": "#E6DCC8"}

    # to implement: figure(detail) -> list of (prim, k), cuts -> {piece: [(point, normal, seed)]} (inside = n.(P-p)+f <= 0),
    # piece_box(piece), eyes (list of points), piece_bone
    def figure(self, detail):
        raise NotImplementedError

    def sculpts(self, detail):
        prims = self.figure(detail)
        out = []
        # every piece is meshed inside the whole figure's bounds (its cut planes bound it); each crack surface is
        # displaced by +f on its first side and -f on the other, so the chunks fit exactly
        lo = np.min([pr.bounds()[0] for pr, _ in prims], axis=0) - 0.05
        hi = np.max([pr.bounds()[1] for pr, _ in prims], axis=0) + 0.05
        seen = set()
        self.crack_sign = {}
        for piece, planes in self.cuts().items():
            S = BoxSculpt(piece, (lo, hi))
            for prim, k in prims:
                S.add(prim, k=k, tag=piece)
            for p_, n_, seed in planes:
                hs = HalfSpace(p_, n_, extent=4.0)
                if seed is None:
                    S.inter(hs, k=0.004)
                    continue
                sg = 1.0 if seed not in seen else -1.0
                seen.add(seed)
                self.crack_sign[(piece, seed)] = sg
                f = crack_fn(seed, 0.035 * self.CRACK, 7.0 / self.CRACK)
                S.inter(hs.displaced(lambda P, f_=f, sg_=sg: sg_ * f_(P), 0.04), k=0.004)
            for c_, r_ in self.chips():
                S.sub(Sphere(c_, r_), k=0.01)
            for e in self.eyes():
                S.sub(Capsule(e[0], e[1], self.EYE_R), k=0.006)
            if detail:
                for a_, b_ in self.grooves():
                    S.sub(Capsule(a_, b_, 0.012 * self.CRACK), k=0.004)
            out.append(S)
        self.piece_names = list(self.cuts().keys())
        return {"stone": out}

    def chips(self):
        return []

    def grooves(self):
        return []

    @property
    def PART_BIND(self):
        return {"stone": ("tags", {p_: self.piece_bone(p_) for p_ in self.cuts()})}

    def paint(self, part, V, N, tags):
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        nz = N[:, 2]
        z = V[:, 2] / self.HEIGHT
        col = np.tile(c("chalk"), (n, 1))
        col = mix_hex(col, c("chalk_lo"), sarr(0.1, -0.7, nz) * 0.55)
        col = mix_hex(col, c("grime"), sarr(0.16, 0.0, z) * 0.8)                     # dial grit on the feet
        streak = sarr(0.15, 0.4, NOISE.fbm(V * np.array([3.0, 3.0, 0.4]), 2.0, 3)) * sarr(0.0, -0.3, nz + 0.1) * 0.0
        col = mix_hex(col, c("chalk_lo"), sarr(0.1, 0.35, NOISE.fbm(V * np.array([2.5, 2.5, 0.35]), 2.5, 3)) * 0.35 + streak)
        ln = NOISE.fbm(V * 1.0, 2.2, 3)
        ls = NOISE(V, 9.0)
        lichen = sarr(0.18, 0.32, ln) * sarr(0.05, 0.25, ls) * sarr(-0.2, 0.4, nz)
        col = mix_hex(col, c("lichen"), lichen * 0.8)
        col = mix_hex(col, c("lichen2"), sarr(0.3, 0.45, ln) * sarr(0.3, 0.5, ls) * 0.5)
        rough = np.full(n, 0.78)
        # hairline cracks where the chunks meet (the future break lines)
        key = next(iter(tags))
        for p_, n_, seed in self.cuts()[key]:
            if seed is None:
                continue
            f = crack_fn(seed, 0.035 * self.CRACK, 7.0 / self.CRACK)
            d = np.abs((V - V3(p_)) @ K.nrm(n_) + self.crack_sign.get((key, seed), 1.0) * f(V))
            facing = np.abs(N @ K.nrm(n_))
            near = sarr(0.02, 0.004, d)
            # the outer skin: a dark hairline where the crack surfaces; the fracture face itself: fresh pale stone
            col = mix_hex(col, c("crack"), near * sarr(0.75, 0.45, facing) * 0.9)
            col = mix_hex(col, c("break"), near * sarr(0.6, 0.85, facing))
            rough = rough * (1 - near * sarr(0.6, 0.85, facing)) + 0.9 * near * sarr(0.6, 0.85, facing)
        for e in self.eyes():
            _, d = Longshade._along(None, V, [(e[0], e[1], 1.0)])
            col = mix_hex(col, c("eye"), sarr(self.EYE_R + 0.02, self.EYE_R + 0.004, d))
        if self.grooves():
            _, gd = Longshade._along(None, V, [(a_, b_, 1.0) for a_, b_ in self.grooves()])
            col = mix_hex(col, c("groove"), sarr(0.03 * self.CRACK, 0.012 * self.CRACK, gd) * 0.6)
        return col, rough

    def high_material(self, part, grad):
        return painted_stone(f"{self.ID}_stone_src", self.PAL["chalk"], grad, chisel=1.0, scale=2.5 / self.CRACK,
                             chalk=(1.12, 0.5))

    def ao_free_polys(self, low):
        """The fracture faces: hidden (touching the next chunk) in the rest pose, revealed by the crumble."""
        me = low.data
        names = {g.index: g.name for g in low.vertex_groups}
        bone_piece = {self.piece_bone(p_): p_ for p_ in self.cuts()}
        vpiece = [None] * len(me.vertices)
        for v in me.vertices:
            if v.groups:
                g = max(v.groups, key=lambda gg: gg.weight)
                vpiece[v.index] = bone_piece.get(names.get(g.group))
        sel = np.zeros(len(me.polygons), dtype=bool)
        for poly in me.polygons:
            piece = vpiece[poly.vertices[0]]
            if piece is None:
                continue
            c_ = np.array(poly.center)
            n_p = np.array(poly.normal)
            for p_, n_, seed in self.cuts()[piece]:
                if seed is None:
                    continue
                f = crack_fn(seed, 0.035 * self.CRACK, 7.0 / self.CRACK)
                d = abs(float((c_ - V3(p_)) @ K.nrm(n_) + self.crack_sign.get((piece, seed), 1.0) * f(c_[None, :])[0]))
                if d < 0.03 * self.CRACK and abs(float(n_p @ K.nrm(n_))) > 0.55:
                    sel[poly.index] = True
                    break
        return sel

    # ── crumble ──
    def crumble_setup(self, rig, rng):
        cent, lie = {}, {}
        for p_ in self.piece_names:
            Vp = self.tag_verts.get(("stone", p_))
            cent[p_] = Vp.mean(0)
            X0 = Vp - cent[p_]
            w, ev = np.linalg.eigh(X0.T @ X0)
            ax = ev[:, 2]
            yaw = rng.uniform(0, 2 * math.pi)
            tgt = np.array([math.cos(yaw), math.sin(yaw), 0.0])
            k = np.cross(ax, tgt)
            ang = math.acos(max(-1.0, min(1.0, float(ax @ tgt))))
            R1 = K.rodrigues_m(k, ang) if np.linalg.norm(k) > 1e-6 else np.eye(3)
            # roll about the long axis so the flattest face lies down
            best = None
            for roll in np.linspace(0, 2 * math.pi, 12, endpoint=False):
                R = K.rodrigues_m(tgt, roll) @ R1
                zz = (X0 @ R.T)[:, 2]
                h = -zz.min()
                if best is None or h < best[1]:
                    best = (R, h)
            lie[p_] = (best[0], best[1] + 0.004)
        return cent, lie

    def crumble_pose(self, rig, P, t, cent, lie, start, land_xy, cur_T=None):
        """Absolute transforms: piece p_ falls from its current place (cur_T[p_] or rest) from start[p_] over 0.28 of
        the clip to its resting pose at land_xy[p_], with a small bounce."""
        for p_ in self.piece_names:
            b = self.piece_bone(p_)
            s_ = min(1.0, max(0.0, (t - start[p_]) / 0.28))
            T0 = cur_T[p_] if cur_T is not None else np.eye(4)
            c0 = (T0 @ np.append(cent[p_], 1.0))[:3]
            R0 = T0[:3, :3]
            R_end, h = lie[p_]
            p_end = np.array([land_xy[p_][0], land_xy[p_][1], h])
            p = c0 * (1 - s_) + p_end * s_
            p[2] = c0[2] + (p_end[2] - c0[2]) * s_ * s_
            if s_ >= 1.0:
                p[2] = p_end[2] + 0.06 * self.CRACK * bump(t, start[p_] + 0.28, start[p_] + 0.38)
            R = slerp_R(R0, R_end, smooth(s_))
            T = np.eye(4)
            T[:3, :3] = R
            T[:3, 3] = p - R @ cent[p_]
            Vp = self.tag_verts[("stone", p_)]
            zmin = float(((Vp - cent[p_]) @ R.T)[:, 2].min() + p[2])
            if zmin < 0.002:                       # never through the ground while tumbling
                T[2, 3] += 0.002 - zmin
            P.world[b] = T @ rig.rest[b]


# ════════════════════════════════════════════════════════════════════════════════════════════════
class StrayNumeral(StrayBase):
    """A carved numeral that walked off the dial: an inverted V of chalk strokes (the thick stroke left, the thin
    one right, as the carvers cut them) standing on bracketed foot-serifs, a neck block at the apex and a crossbar
    with flared serif ends riding on top as its head; two drilled holes for eyes. Chipped, lichened, grimy at the
    foot, hairline cracks along the lines it will crumble on. It moves like a stiff stone puppet: a hop-waddle,
    rocking from foot to foot."""
    ID = "stray_numeral"
    HEIGHT = 2.4
    BODY_TOP = 2.4
    RUN_SPEED = 3.0
    TRIS = {"stone": 4300}
    CLIPS = ("idle", "run", "attack1", "cast_a1", "death")
    FEET = ("footL", "footR")
    CRACK = 1.0
    EYE_R = 0.035
    A = np.array([0.0, 0.0, 1.62])                # apex (body pivot)
    FL = np.array([0.56, 0.0, 0.0])               # foot contacts
    FR = np.array([-0.5, 0.0, 0.0])
    WL, WR, DEPTH = 0.43, 0.25, 0.36              # stroke widths (thick / thin), depth (front-back)

    def figure(self, detail):
        A, D = self.A, self.DEPTH
        prims = []
        chis = ((lambda P: -0.01 * np.clip(sdf.Noise(13).ridged(P, 5.0, 2) - 0.5, 0, 1) - 0.004 * NOISE(P, 18.0)), 0.014)
        for foot, w in ((self.FL, self.WL), (self.FR, self.WR)):
            top = A + np.array([0, 0, 0.12])
            bot = foot + np.array([0, 0, 0.1])
            ax = K.nrm(top - bot)
            F = np.stack([K.nrm(np.cross((0, 1.0, 0), ax)), np.array([0, 1.0, 0]), ax])
            L = np.linalg.norm(top - bot)
            stroke = RoundBox((top + bot) / 2, (w / 2, D / 2, L / 2), 0.03, axes=F)
            prims.append((stroke.displaced(*chis) if detail else stroke, 0.0))
            serif = RoundBox(foot + np.array([0, 0, 0.075]), (0.2 + w * 0.6, D / 2 + 0.02, 0.075), 0.025)
            prims.append((serif.displaced(*chis) if detail else serif, 0.11))
        # flatten the apex where the strokes cross, the neck block on it
        neck = RoundBox(A + np.array([0, 0, 0.16]), (0.17, D / 2 - 0.02, 0.13), 0.03)
        prims.append((neck, 0.04))
        # the crossbar head with flared, bracketed serif ends
        bar = RoundBox(A + np.array([0, 0, 0.47]), (0.64, D / 2 + 0.01, 0.15), 0.03)
        prims.append((bar.displaced(*chis) if detail else bar, 0.05))
        for sx in (1, -1):
            fl = RoundBox(A + np.array([sx * 0.63, 0, 0.6]), (0.07, D / 2 + 0.01, 0.18), 0.03)
            prims.append((fl, 0.09))
        self.prims = prims
        return prims

    def cuts(self):
        A = self.A
        top_cut = (A + np.array([0, 0, 0.02]), (0, 0, 1.0), None)         # the strokes stop under the neck
        out = {}
        # left leg: foot chunk / upper chunk / apex; right likewise; apex + neck; the bar split in two
        zl, zr = 0.62, 0.78
        out["footL"] = [((0, 0, zl), (0.25, 0, 1.0), 101), ((0.12, 0, 0), (-1.0, 0, 0), None)]
        out["legL"] = [((0, 0, zl), (-0.25, 0, -1.0), 101), ((0, 0, 1.28), (-0.1, 0, 1.0), 102), ((0.12, 0, 0), (-1.0, 0, 0), None)]
        out["footR"] = [((0, 0, zr), (-0.3, 0, 1.0), 103), ((-0.12, 0, 0), (1.0, 0, 0), None)]
        out["legR"] = [((0, 0, zr), (0.3, 0, -1.0), 103), ((0, 0, 1.3), (0.1, 0, 1.0), 104), ((-0.12, 0, 0), (1.0, 0, 0), None)]
        out["apex"] = [((0, 0, 1.28), (0.1, 0, -1.0), 102), ((0, 0, 1.3), (-0.1, 0, -1.0), 104), ((0, 0, A[2] + 0.3), (0, 0, 1.0), 105)]
        out["headL"] = [((0, 0, A[2] + 0.3), (0, 0, -1.0), 105), ((0.06, 0, 0), (-1.0, 0, 0.15), 106)]
        out["headR"] = [((0, 0, A[2] + 0.3), (0, 0, -1.0), 105), ((0.06, 0, 0), (1.0, 0, -0.15), 106)]
        return out

    def piece_box(self, piece):
        d = self.DEPTH / 2 + 0.08
        A = self.A
        return {"footL": ((0.0, -d, -0.02), (1.05, d, 0.85)), "legL": ((-0.15, -d, 0.45), (0.75, d, 1.55)),
                "footR": ((-1.0, -d, -0.02), (0.05, d, 1.0)), "legR": ((-0.7, -d, 0.6), (0.15, d, 1.55)),
                "apex": ((-0.45, -d, 1.1), (0.45, d, A[2] + 0.42)),
                "headL": ((-0.2, -d, A[2] + 0.22), (0.82, d, 2.45)), "headR": ((-0.82, -d, A[2] + 0.22), (0.2, d, 2.45))}[piece]

    def piece_bone(self, piece):
        return piece

    def eyes(self):
        z = self.A[2] + 0.48
        y = -self.DEPTH / 2 - 0.03
        return [(np.array([sx * 0.22, y - 0.02, z]), np.array([sx * 0.22, y + 0.09, z])) for sx in (1, -1)]

    def chips(self):
        A, d = self.A, self.DEPTH / 2
        return [((0.79, -d, 0.02), 0.07), ((-0.72, d, 0.13), 0.06), ((0.66, d, A[2] + 0.66), 0.08),
                ((-0.7, -d, A[2] + 0.36), 0.06), ((0.2, -d, 1.05), 0.05), ((-0.3, d, 0.9), 0.045)]

    def grooves(self):
        # an engraved line down the face of the thick stroke (the carver's inline)
        top = self.A + np.array([0, 0, 0.0])
        bot = self.FL + np.array([0, 0, 0.25])
        y = -self.DEPTH / 2 - 0.01
        a = np.array([top[0] * 0.8 + bot[0] * 0.2, y, top[2] * 0.8 + bot[2] * 0.2])
        b = np.array([top[0] * 0.15 + bot[0] * 0.85, y, top[2] * 0.15 + bot[2] * 0.85])
        return [(a, b)]

    def bones(self):
        A = self.A
        head_c = A + np.array([0.04, -1.0, 0.47])          # the facing marker sits well ahead (the figure is lopsided)
        bl = [B("root", (0, 0, 0), (0, -0.6, 0)),
              B("hips", tuple(A), tuple(A + np.array([0, -0.35, 0])), "root"),
              B("apex", tuple(A + np.array([0, 0, -0.2])), tuple(A + np.array([0, 0, 0.1])), "hips"),
              B("neck", tuple(A + np.array([0, 0, 0.3])), tuple(A + np.array([0, 0, 0.6])), "hips"),
              B("head", tuple(head_c), tuple(head_c + np.array([0, -0.2, 0])), "neck"),
              B("headL", tuple(A + np.array([0.35, 0, 0.47])), tuple(A + np.array([0.75, 0, 0.47])), "neck"),
              B("headR", tuple(A + np.array([-0.35, 0, 0.47])), tuple(A + np.array([-0.75, 0, 0.47])), "neck")]
        for s_, F in (("L", self.FL), ("R", self.FR)):
            mid = A + (F - A) * 0.5
            bl += [B(f"strut.{s_}", tuple(A), tuple(F), "hips"),
                   B(f"leg{s_}", tuple(mid), tuple(mid + (F - A) * 0.2), f"strut.{s_}"),
                   B(f"foot{s_}", tuple(F), tuple(F + np.array([0, -0.25, 0])), f"strut.{s_}")]
        return bl

    HEAT_EXCLUDE = ("root",)

    def clips(self, rig):
        A = self.A
        H = A.copy()
        l0 = {"L": self.FL - A, "R": self.FR - A}
        spd = self.RUN_SPEED
        rng = np.random.RandomState(8)

        def set_body(P, R_b, Apos):
            P.hips_rot = R_b
            P.hips_loc = np.asarray(Apos) - H

        def body_about(P, R, c):
            P.hips_rot = R
            P.hips_loc = pivot(R, c, H)

        def stance(R_b, f, side, ay=0.0):
            """Body at R_b standing on `side`'s foot at f: the leg hinge (pitch) that keeps the apex at y ~ ay, and the
            apex position."""
            lo, hi = -60.0, 60.0
            for _ in range(40):
                m = (lo + hi) / 2
                v = R_b @ rot(m) @ l0[side]
                if (f[1] - v[1]) > ay:
                    hi = m
                else:
                    lo = m
            ph = (lo + hi) / 2
            return f - R_b @ rot(ph) @ l0[side], ph

        # idle 3 s: a slow rock from foot to foot, the bar wobbling behind, one settling thunk
        def idle(t):
            P = rig.rest_pose()
            rk = 2.2 * wave(t, 0.0)
            foot = self.FL + np.array([0.45, 0, 0]) if rk > 0 else self.FR - np.array([0.34, 0, 0])
            hop = 0.04 * bump(t, 0.52, 0.6)
            R = rot(0.8 * wave(t, 0.25, 2), 0, rk)
            body_about(P, R, foot)
            P.hips_loc = P.hips_loc + np.array([0, 0, hop])
            P.r("neck", r=-3.5 * wave(t, 0.12) + 4 * bump(t, 0.58, 0.68), p=1.5 * wave(t, 0.3, 2))
            return P

        # run 0.8 s: two hops, each landing on one foot, rocking onto it, vaulting over it, a short flight
        RUN_F = 24
        T_hop = RUN_F / K.FPS / 2
        Dty = 0.56
        half = spd * Dty * T_hop / 2

        def body_R(side, s):
            sg = 1 if side == "L" else -1
            return rot(lerp(7.0, -9.0, s), 4.0 * sg * (0.5 - s), sg * 7.0 * math.sin(math.pi * min(1.0, 0.25 + 0.75 * s)))

        def stance_state(side, s):
            f = (self.FL if side == "L" else self.FR) + np.array([0, -half + 2 * half * s, 0])
            R_b = body_R(side, s)
            Ap, ph = stance(R_b, f, side, ay=0.0)
            return R_b, Ap, ph
        R_lo_L, A_lo_L, ph_lo_L = stance_state("L", 1.0)
        R_td_R, A_td_R, ph_td_R = stance_state("R", 0.0)
        R_lo_R, A_lo_R, ph_lo_R = stance_state("R", 1.0)
        R_td_L, A_td_L, ph_td_L = stance_state("L", 0.0)

        def run(t):
            P = rig.rest_pose()
            u = (t * 2) % 1.0
            side = "L" if t < 0.5 else "R"
            other = "R" if side == "L" else "L"
            if u < Dty:
                s = u / Dty
                R_b, Ap, ph = stance_state(side, s)
                ph_o = lerp(-16.0, 14.0, smooth(s))
            else:
                s = (u - Dty) / (1 - Dty)
                if side == "L":
                    R0_, A0_, p0_, R1_, A1_, p1_ = R_lo_L, A_lo_L, ph_lo_L, R_td_R, A_td_R, ph_td_R
                else:
                    R0_, A0_, p0_, R1_, A1_, p1_ = R_lo_R, A_lo_R, ph_lo_R, R_td_L, A_td_L, ph_td_L
                R_b = slerp_R(R0_, R1_, smooth(s))
                Ap = A0_ * (1 - s) + A1_ * s + np.array([0, 0, 0.16 * 4 * s * (1 - s)])
                ph = lerp(p0_, -16.0, smooth(s))             # the leg that pushed off trails
                ph_o = lerp(14.0, p1_, smooth(s))            # the landing leg reaches
            set_body(P, R_b, Ap)
            P.r(f"strut.{side}", p=ph)
            P.r(f"strut.{other}", p=ph_o)
            P.r("neck", r=4 * wave(t, 0.1, 2), p=-3 * wave(t, 0.2, 2))
            return P

        # attack1 1.0 s: rock back, hop up with the legs splayed, stomp down leaning in at 40 %, the bar nods hard
        def attack(t):
            P = rig.rest_pose()
            back = spline([(0, 0), (0.22, 1.0), (0.28, 0.6), (0.4, 0.0), (1.0, 0.0)], t)
            air = spline([(0, 0), (0.24, 0), (0.33, 1.0), (0.4, 0.0), (1.0, 0)], t)
            hit = spline([(0, 0), (0.37, 0), (0.4, 1.0), (0.52, 0.7), (0.75, 0.15), (1.0, 0)], t)
            R = rot(9 * back - 12 * hit - 8 * air, 0, 0)
            body_about(P, R, np.array([0, 0.2 if back > hit else -0.2, 0.0]))
            P.hips_loc = P.hips_loc + np.array([0, -0.15 * air - 0.2 * hit, 0.45 * air])
            for sd, sg in (("L", 1), ("R", -1)):
                P.r(f"strut.{sd}", r=sg * 9 * air, p=-6 * air)
            P.r("neck", p=-28 * hit + 10 * back + 6 * air + 8 * bump(t, 0.5, 0.7), r=3 * hit * wave(t, 0, 4))
            return P

        # cast_a1 Topple 1.5 s: rock back, tip forward over the toes and crash flat on its face along the line (40 %),
        # lie a beat, lever itself back upright with a wobble
        def topple(t):
            P = rig.rest_pose()
            back = math.sin(math.pi * min(1.0, t / 0.2)) if t < 0.2 else 0.0
            if t < 0.2:
                fall = 0.0
            elif t < 0.4:
                fall = ((t - 0.2) / 0.2) ** 2                          # it falls like a slab: gravity
            elif t < 0.46:
                fall = 1.0 - 0.035 * math.sin(math.pi * (t - 0.4) / 0.06)   # the crash bounces once
            elif t < 0.6:
                fall = 1.0
            elif t < 0.88:
                fall = 1.0 - 1.03 * smooth((t - 0.6) / 0.28)        # levers itself up, a hair past upright
            else:
                fall = lerp(-0.03, 0.0, smooth((t - 0.88) / 0.12))
            if t < 0.2:
                R = rot(8 * back, 0, 0)
                body_about(P, R, np.array([0, self.DEPTH / 2, 0.0]))
            else:
                R = rot(-90 * fall, 0, 0)
                body_about(P, R, np.array([0, -self.DEPTH / 2 - 0.02, 0.0]))
            P.r("neck", p=6 * bump(t, 0.4, 0.52) + 6 * bump(t, 0.85, 1.0))
            return P

        # death 1.67 s: a shudder, the cracks open, it crumbles: the bar halves drop, the legs fold in, a heap
        start = {"headL": 0.2, "headR": 0.26, "apex": 0.3, "legL": 0.34, "legR": 0.3, "footL": 0.42, "footR": 0.4}

        def death(t):
            P = rig.rest_pose()
            # the chunks' current transforms come from a shudder of the whole figure
            sh = 1.6 * math.sin(2 * math.pi * t * 11) * (1 - smooth((t - 0.1) / 0.15))
            Rs = rot(0, 0, sh)
            T0 = rigid_T(np.array([0, 0, 0]), np.array([0, 0, 0]), Rs)
            cur = {p_: T0 for p_ in self.piece_names}
            self.crumble_pose(rig, P, t, cent, lie, start, land, cur)
            return P

        cent, lie = self.crumble_setup(rig, rng)
        land = {}
        for p_ in self.piece_names:
            c0 = cent[p_]
            out = K.nrm(np.array([c0[0], c0[1] - 0.25, 0.0]) + 1e-6)
            land[p_] = np.array([c0[0] * 0.9, c0[1] - 0.3, 0.0])[:2] + out[:2] * (0.35 + 0.25 * c0[2] / self.HEIGHT) + \
                rng.uniform(-0.12, 0.12, 2)
        return [Clip("idle", 90, idle, loop=True), Clip("run", RUN_F, run, loop=True),
                Clip("attack1", 30, attack, impact=0.4), Clip("cast_a1", 45, topple, impact=0.4),
                Clip("death", 50, death)]


class StrayTick(StrayBase):
    """A single tick mark that wandered off the dial: one short chalk stroke with a bracketed serif top and foot,
    two drilled eyes under the top serif. It pogo-hops on its foot serif."""
    ID = "stray_tick"
    HEIGHT = 1.0
    BODY_TOP = 1.0
    RUN_SPEED = 3.5
    TEX = 512
    TEX_SIZES = {"orm": 256}
    VOX_LOW = 0.006
    VOX_HIGH = 0.0038
    TRIS = {"stone": 1500}
    CLIPS = ("idle", "run", "attack1", "death")
    CRACK = 0.5
    EYE_R = 0.018
    W, D = 0.25, 0.25

    def figure(self, detail):
        W, D = self.W, self.D
        chis = ((lambda P: -0.006 * np.clip(sdf.Noise(29).ridged(P, 9.0, 2) - 0.5, 0, 1) - 0.002 * NOISE(P, 30.0)), 0.008)
        stroke = RoundBox((0, 0, 0.5), (W / 2, D / 2, 0.38), 0.02)
        foot = RoundBox((0, 0, 0.055), (W / 2 + 0.13, D / 2 + 0.015, 0.055), 0.018)
        top = RoundBox((0, 0, 0.93), (W / 2 + 0.11, D / 2 + 0.015, 0.07), 0.018)
        prims = [(stroke.displaced(*chis) if detail else stroke, 0.0), (foot.displaced(*chis) if detail else foot, 0.08),
                 (top.displaced(*chis) if detail else top, 0.08)]
        return prims

    def cuts(self):
        return {"foot": [((0, 0, 0.3), (0.2, 0, 1.0), 201)],
                "mid": [((0, 0, 0.3), (-0.2, 0, -1.0), 201), ((0, 0, 0.66), (-0.25, 0, 1.0), 202)],
                "top": [((0, 0, 0.66), (0.25, 0, -1.0), 202)]}

    def piece_box(self, piece):
        d = self.D / 2 + 0.06
        return {"foot": ((-0.35, -d, -0.02), (0.35, d, 0.45)), "mid": ((-0.25, -d, 0.15), (0.25, d, 0.8)),
                "top": ((-0.35, -d, 0.5), (0.35, d, 1.05))}[piece]

    def piece_bone(self, piece):
        return {"foot": "foot", "mid": "mid", "top": "head"}[piece]

    def eyes(self):
        y = -self.D / 2 - 0.02
        return [(np.array([sx * 0.06, y - 0.01, 0.8]), np.array([sx * 0.06, y + 0.05, 0.8])) for sx in (1, -1)]

    def chips(self):
        d = self.D / 2
        return [((0.27, -d, 0.0), 0.04), ((-0.25, d, 0.97), 0.035), ((0.12, -d, 0.45), 0.025)]

    def bones(self):
        return [B("root", (0, 0, 0), (0, -0.3, 0)),
                B("hips", (0, 0, 0.0), (0, 0, 0.4), "root"),
                B("foot", (0, 0, 0.0), (0, -0.2, 0.0), "hips"),
                B("mid", (0, 0, 0.3), (0, 0, 0.66), "hips"),
                B("head", (0, -self.D / 2 - 0.01, 0.8), (0, -self.D / 2 - 0.01, 1.0), "hips")]

    def clips(self, rig):
        H = rig.head_pos["hips"].copy()
        spd = self.RUN_SPEED
        rng = np.random.RandomState(4)
        Dd = self.D / 2

        def body_about(P, R, c, lift=(0, 0, 0)):
            P.hips_rot = R
            P.hips_loc = pivot(R, c, H) + np.array(lift, dtype=np.float64)

        # idle 2 s: two little bounces in place, rocking, a curious lean
        def idle(t):
            P = rig.rest_pose()
            hops = 0.07 * (bump(t, 0.1, 0.3) + 0.7 * bump(t, 0.55, 0.72))
            lean = spline([(0, 0), (0.35, 4), (0.5, 4), (0.8, -3), (1.0, 0)], t, period=1.0)
            body_about(P, rot(2 * wave(t, 0.2, 2), 0, lean), np.zeros(3), lift=(0, 0, hops))
            return P

        # run 0.4 s: one pogo hop per cycle at 3.5 m/s: a short planted push-off, then an arc leaning into the hop
        RUN_F = 12
        T = RUN_F / K.FPS
        Dty = 0.3
        half = spd * Dty * T / 2

        def run(t):
            P = rig.rest_pose()
            if t < Dty:
                s = t / Dty
                fy = -half + 2 * half * s
                R = rot(lerp(8.0, -16.0, s), 0, 2 * wave(t, 0.1))
                body_about(P, R, np.zeros(3), lift=(0, fy, 0))
            else:
                s = (t - Dty) / (1 - Dty)
                y0, y1 = half, -half
                R = rot(lerp(-16.0, 8.0, smooth(s)), 0, 2 * wave(t, 0.1))
                body_about(P, R, np.zeros(3), lift=(0, y0 + (y1 - y0) * s, 0.24 * 4 * s * (1 - s)))
            return P

        # attack1 0.83 s: lean back, hop in and chop the top serif down onto the target at 40 %, spring back up
        def attack(t):
            P = rig.rest_pose()
            back = spline([(0, 0), (0.25, 1.0), (0.3, 0.8), (0.38, 0.0), (1.0, 0)], t)
            chop = spline([(0, 0), (0.3, 0.0), (0.4, 1.0), (0.55, 0.85), (0.8, 0.1), (1.0, 0)], t)
            hop = 0.18 * bump(t, 0.26, 0.4)
            if chop < 1e-4:
                body_about(P, rot(14 * back), np.array([0, Dd, 0]), lift=(0, -0.1 * bump(t, 0.26, 0.4), hop))
            else:
                body_about(P, rot(-68 * chop), np.array([0, -Dd - 0.02, 0]), lift=(0, -0.22 * chop, 0))
            return P

        start = {"top": 0.22, "mid": 0.3, "foot": 0.38}

        def death(t):
            P = rig.rest_pose()
            sh = 3.0 * math.sin(2 * math.pi * t * 10) * (1 - smooth((t - 0.1) / 0.12))
            T0 = rigid_T(np.zeros(3), np.zeros(3), rot(0, 0, sh))
            self.crumble_pose(rig, P, t, cent, lie, start, land, {p_: T0 for p_ in self.piece_names})
            return P

        cent, lie = self.crumble_setup(rig, rng)
        land = {"top": np.array([0.15, -0.55]), "mid": np.array([-0.2, -0.18]), "foot": np.array([0.05, 0.12])}
        return [Clip("idle", 60, idle, loop=True), Clip("run", RUN_F, run, loop=True),
                Clip("attack1", 25, attack, impact=0.4), Clip("death", 45, death)]

# ════════════════════════════════════════════════════════════════════════════════════════════════
CREATURES = {"longshade": Longshade, "sunsplinter": Sunsplinter, "gloamoth": Gloamoth, "gloamoth_little": GloamothLittle,
             "stray_numeral": StrayNumeral, "stray_tick": StrayTick}


def icon_from_cache(cr: Monster, fast: bool) -> dict:
    """Re-render the 128² icon from art/.cache/units/<id>.blend (no rebuild)."""
    bpy.ops.wm.open_mainfile(filepath=os.path.join(CACHE, f"{cr.ID}.blend"))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    low = bpy.context.scene.objects[cr.ID]

    class _R:
        pass
    r = _R()
    r.arm = arm
    return render_icon(cr, r, low, fast)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--fast", action="store_true")
    p.add_argument("--no-qa", action="store_true")
    p.add_argument("--icons-only", action="store_true")
    a = p.parse_args(scene.script_args())
    ids = [i for i in CREATURES if not a.only or i in a.only.split(",")]
    for i in ids:
        if a.icons_only:
            if CREATURES[i].ICON:
                scene.log(f"{i} icon: {icon_from_cache(CREATURES[i](), a.fast)}")
            continue
        build(CREATURES[i](), a)


if __name__ == "__main__":
    main()
