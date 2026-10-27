"""VALE ambient critters (r12 M14): small original fauna that live off the gameplay zones and take off when a unit
the viewer sees comes within 3 m (src/render/ambient.ts drives them from content/maps/*.json art.ambient.critters).

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/props/critters.py -- [--only dialwren]
        [--no-qa]

  dialwren   ~0.31 m  a round ground bird of the Dialwood clearings and the Noonplate fair: gull-grey feather (an
                      Aubade material), a pale chalk band across the eyes (nobody in the Vale shows a bare face to
                      the stopped sun, the birds included) and a long fan tail cocked upright like a gnomon, its
                      feathers barred with one dark hour-band and a chalk tip.
                      idle (4 s loop): breathes, looks round, pecks twice, flicks its tail
                      flee (8-frame wing-beat loop; the code flies it to another perch)
                      settle (24 frames, once): brakes with two beats, lands, folds, flicks the tail
  hourskink  ~0.48 m  a basking skink of warm cut stone (wall feet, the Fallen Shaft's drums, the span's edges)
                      that carries a gnomon on its back: a right-triangle sail ribbed with dark hour-lines,
                      raised to bask, folded flat to run.
                      idle (4 s loop): basks, the sail breathes, two push-ups, the tail tip curls
                      flee (10-frame loop): a low S-wave scurry, legs in diagonal pairs, sail flat
                      settle (27 frames, once): stops, raises the sail with an overshoot, one push-up

Neither is modelled on any reference game's creature: the wren's gnomon tail and visor band and the skink's
hour-ribbed gnomon sail are the Vale's own (sundial, stopped light, carved stone).

Build: parts from bmesh primitives (ellipsoids, tapered tubes, flat plates), one armature (rigid parts on one bone
each; smooth weights only along the skink's spine and tail), one double-sided matte material with vertex colour
(COLOR_0, linear, painted per part with a baked top-light / underside occlusion), <= 1.5k triangles, real size in
metres, origin at the ground contact, facing -Y (three: +Z). Clips are sampled per frame from pose functions
(FK, rotations about the rest axes) into one action per clip, stashed on NLA tracks (one glTF animation each).

Output: art/out/props/ambient/<id>.glb, art/renders/props/critters_<id>.png (three.js unit sheet: 8 facings at the
gameplay camera + every clip) and art/renders/props/critters_report.json.
"""
from __future__ import annotations

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import export, scene  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "props", "ambient")
RENDERS = os.path.join(scene.RENDERS_DIR, "props")
FPS = scene.FPS
TRI_BUDGET = 1500
NODE_BIN = "/opt/homebrew/opt/node@22/bin"
if os.path.isdir(NODE_BIN) and NODE_BIN not in os.environ.get("PATH", ""):
    os.environ["PATH"] = NODE_BIN + os.pathsep + os.environ.get("PATH", "")


# ── colour ───────────────────────────────────────────────────────────────────────────────────────
def lin(h: str) -> Vector:
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return Vector([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c])


def mixc(a: Vector, b: Vector, t: float) -> Vector:
    t = max(0.0, min(1.0, t))
    return a * (1 - t) + b * t


def smooth(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ── mesh builder: one bmesh, per-vertex colour + bone weights ────────────────────────────────────
class Builder:
    def __init__(self, bones: list[str]):
        self.bm = bmesh.new()
        self.bones = bones
        self.dl = self.bm.verts.layers.deform.verify()
        self.cl = self.bm.verts.layers.float_color.new("Col")

    def _add(self, verts, faces, color, weights):
        vs = [self.bm.verts.new(v) for v in verts]
        for f in faces:
            try:
                self.bm.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        for i, v in enumerate(vs):
            c = color(Vector(verts[i]), i)
            v[self.cl] = (c[0], c[1], c[2], 1.0)
            for b, w in weights(Vector(verts[i])).items():
                if w > 1e-4:
                    v[self.dl][self.bones.index(b)] = w
        return vs

    def ellipsoid(self, centre, radii, color, weights, seg=10, rings=7, rot: Matrix | None = None):
        verts = [(0.0, 0.0, 1.0)]
        for i in range(1, rings):
            th = math.pi * i / rings
            for k in range(seg):
                ph = 2 * math.pi * (k + 0.5 * (i % 2)) / seg
                verts.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
        verts.append((0.0, 0.0, -1.0))
        faces = [(0, 1 + (k + 1) % seg, 1 + k) for k in range(seg)]
        for i in range(rings - 2):
            a0, b0 = 1 + i * seg, 1 + (i + 1) * seg
            for k in range(seg):
                k1 = (k + 1) % seg
                if i % 2 == 0:
                    faces += [(a0 + k, a0 + k1, b0 + k), (a0 + k1, b0 + k1, b0 + k)]
                else:
                    faces += [(a0 + k, b0 + k1, b0 + k), (a0 + k, a0 + k1, b0 + k1)]
        last = len(verts) - 1
        lb = 1 + (rings - 2) * seg
        faces += [(last, lb + k, lb + (k + 1) % seg) for k in range(seg)]
        R = rot or Matrix.Identity(3)
        out = [tuple(Vector(centre) + R @ Vector((v[0] * radii[0], v[1] * radii[1], v[2] * radii[2]))) for v in verts]
        return self._add(out, faces, color, weights)

    def tube(self, pts, radii, color, weights, sides=5, cap=True):
        """a tapered tube along a polyline (legs, toes, tail)"""
        P = [Vector(p) for p in pts]
        rings = []
        up = Vector((0, 0, 1))
        for i, p in enumerate(P):
            t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
            ref = up if abs(t.dot(up)) < 0.9 else Vector((1, 0, 0))
            u = t.cross(ref).normalized()
            v = t.cross(u).normalized()
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * radii[i] for k in range(sides)])
        verts = [tuple(x) for r in rings for x in r]
        faces = []
        for i in range(len(P) - 1):
            for k in range(sides):
                a, b = i * sides + k, i * sides + (k + 1) % sides
                faces += [(a, b, b + sides, a + sides)]
        if cap:
            verts.append(tuple(P[-1] + (P[-1] - P[-2]).normalized() * radii[-1] * 0.8))
            ti = len(verts) - 1
            base = (len(P) - 1) * sides
            faces += [(base + k, base + (k + 1) % sides, ti) for k in range(sides)]
        return self._add(verts, faces, color, weights)

    def plate(self, poly, color, weights):
        """a flat polygon (wing, feather, sail, toe); the material is double-sided"""
        return self._add([tuple(p) for p in poly], [tuple(range(len(poly)))], color, weights)

    def finish(self, name: str):
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:])
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        for b in self.bones:
            ob.vertex_groups.new(name=b)
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        for p in me.polygons:
            p.use_smooth = True
        return ob


def rigid(bone: str):
    return lambda p: {bone: 1.0}


def material(name: str) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.use_backface_culling = False
    if not m.node_tree:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    return m


# ── armature + FK clips ──────────────────────────────────────────────────────────────────────────
def armature(name: str, joints: dict[str, tuple[tuple[float, float, float], str | None]]):
    """joints: bone -> (head, parent). Every bone points +Z (length 2 cm): pose rotations are authored in the rest
    (armature) axes and converted per bone."""
    arm_data = bpy.data.armatures.new(name + "_rig")
    arm = bpy.data.objects.new(name + "_rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for b, (h, _) in joints.items():
        eb = arm_data.edit_bones.new(b)
        eb.head = h
        eb.tail = (h[0], h[1], h[2] + 0.02)
        eb.roll = 0.0
    for b, (_, p) in joints.items():
        if p:
            arm_data.edit_bones[b].parent = arm_data.edit_bones[p]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def R(x=0.0, y=0.0, z=0.0) -> Matrix:
    """rotation in the rest axes, degrees: x pitch (+ lifts a -Y-pointing nose), y roll about the body axis,
    z yaw (+ turns the nose toward +X)"""
    return (Matrix.Rotation(math.radians(z), 3, "Z") @ Matrix.Rotation(math.radians(y), 3, "Y")
            @ Matrix.Rotation(math.radians(-x), 3, "X"))


def write_clip(arm, name: str, frames: int, pose_fn, loop: bool):
    """pose_fn(t in 0..1) -> {bone: (Matrix3 rotation in rest axes, Vector offset in rest axes)}"""
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    for f in range(frames + 1):
        t = (f % frames) / frames if loop else f / frames
        pose = pose_fn(t)
        for pb in arm.pose.bones:
            B = pb.bone.matrix_local.to_3x3()
            rot, off = pose.get(pb.name, (Matrix.Identity(3), Vector()))
            q = (B.inverted() @ rot @ B).to_quaternion()
            if f > 0 and q.dot(pb.rotation_quaternion) < 0:
                q.negate()
            pb.rotation_quaternion = q
            pb.location = B.inverted() @ Vector(off)
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            pb.keyframe_insert("location", frame=f, group=pb.name)
    # linear keys (one per frame)
    for fc in _fcurves(act):
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = frames
    ad.action = None
    tr = ad.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 0, act)
    try:
        st.action_slot = act.slots[0]
    except (AttributeError, IndexError, TypeError):
        pass
    tr.mute = True
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    return {"frames": frames, "seconds": round(frames / FPS, 3), "loop": loop}


def _fcurves(act):
    try:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    yield from cb.fcurves
    except AttributeError:
        yield from act.fcurves


def wave(t: float, hz: float = 1.0, ph: float = 0.0) -> float:
    return math.sin(2 * math.pi * (t * hz + ph))


def bump(t: float, a: float, b: float) -> float:
    """0 → 1 → 0 between a and b (smooth)"""
    if t <= a or t >= b:
        return 0.0
    u = (t - a) / (b - a)
    return math.sin(math.pi * u) ** 2


def ease(t: float, a: float, b: float) -> float:
    return smooth(a, b, t)


# ══ dialwren ══════════════════════════════════════════════════════════════════════════════════════
WREN_J = {
    "root": ((0, 0, 0), None),
    "body": ((0, 0.0, 0.095), "root"),
    "legs": ((0, 0.0, 0.07), "body"),
    "head": ((0, -0.058, 0.13), "body"),
    "tail": ((0, 0.068, 0.112), "body"),
    "wing_l": ((0.042, -0.028, 0.128), "body"),
    "hand_l": ((0.122, -0.022, 0.128), "wing_l"),
    "wing_r": ((-0.042, -0.028, 0.128), "body"),
    "hand_r": ((-0.122, -0.022, 0.128), "wing_r"),
}
WREN = {
    "back": lin("#7D8288"), "belly": lin("#A9A7A0"), "head": lin("#6F757D"), "band": lin("#C9C4B6"), "eye": lin("#1E1D1C"),
    "beak": lin("#34312D"), "leg": lin("#5A4C40"), "tail": lin("#868C93"), "bar": lin("#2F3338"), "tip": lin("#C4BFB1"),
    "wing": lin("#6E747B"), "prim": lin("#4B5057"), "edge": lin("#9EA2A3"),
}


def build_wren():
    b = Builder(list(WREN_J))
    W = WREN

    def body_col(p, i):
        under = smooth(0.11, 0.06, p.z)                       # pale breast and belly
        breast = smooth(-0.02, -0.07, p.y) * smooth(0.13, 0.09, p.z)
        c = mixc(W["back"], W["belly"], max(under, breast * 0.8))
        return c * (0.72 + 0.28 * smooth(0.05, 0.15, p.z))   # baked underside occlusion

    b.ellipsoid((0, 0.004, 0.098), (0.052, 0.082, 0.05), body_col, rigid("body"), seg=12, rings=8, rot=R(x=12))

    def head_col(p, i):
        # the chalk visor band across the eyes, above it the dark cap, below the pale throat
        d = (p - Vector((0, -0.078, 0.147)))
        band = smooth(0.012, 0.004, abs(d.z - 0.004)) * smooth(-0.004, -0.024, d.y + 0.004 * 0)
        throat = smooth(-0.005, -0.03, d.z) * smooth(0.0, -0.03, d.y)
        c = mixc(W["head"], W["belly"], throat * 0.8)
        c = mixc(c, W["band"], band)
        return c * (0.8 + 0.2 * smooth(0.12, 0.17, p.z))

    b.ellipsoid((0, -0.078, 0.147), (0.036, 0.04, 0.035), head_col, rigid("head"), seg=10, rings=7)
    # eyes: two dark beads set into the chalk band
    for s in (1, -1):
        b.ellipsoid((s * 0.03, -0.095, 0.152), (0.0075, 0.0075, 0.0075), lambda p, i: W["eye"], rigid("head"), seg=6, rings=4)
    # beak: a short wedge
    b.tube([(0, -0.108, 0.146), (0, -0.124, 0.143), (0, -0.136, 0.141)], [0.011, 0.007, 0.002], lambda p, i: W["beak"], rigid("head"), sides=4, cap=True)
    # legs: thin tubes to three-toed feet on the ground
    for s in (1, -1):
        x = s * 0.021
        b.tube([(x, 0.006, 0.07), (x, 0.012, 0.035), (x, 0.0, 0.004)], [0.0065, 0.0045, 0.004], lambda p, i: W["leg"], rigid("legs"), sides=4, cap=False)
        for a in (-28, 0, 28):
            d = Vector((math.sin(math.radians(a)) * 0.026, -math.cos(math.radians(a)) * 0.026, 0))
            b.tube([(x, 0.0, 0.004), tuple(Vector((x, 0.0, 0.003)) + d)], [0.0035, 0.002], lambda p, i: W["leg"], rigid("legs"), sides=3, cap=True)
        b.tube([(x, 0.0, 0.004), (x, 0.016, 0.003)], [0.003, 0.002], lambda p, i: W["leg"], rigid("legs"), sides=3, cap=True)
    # the gnomon tail: five feathers fanned in a plane cocked 52 deg up; each a base, a dark hour-band and a chalk tip
    # (separate quads so the bars stay crisp). R(x=-a) raises a +Y-pointing part by a degrees
    pivot = Vector(WREN_J["tail"][0])
    cock = R(x=-52)
    for k, a in enumerate((-22, -11, 0, 11, 22)):
        L = 0.142 - abs(a) * 0.0011
        dirv = Vector((math.sin(math.radians(a)), math.cos(math.radians(a)), 0))
        side = Vector((dirv.y, -dirv.x, 0))
        segs = [(0.0, 0.62, W["tail"]), (0.62, 0.8, W["bar"]), (0.8, 1.0, W["tip"])]
        for (u0, u1, col) in segs:
            w0 = 0.010 + 0.012 * u0
            w1 = 0.010 + 0.012 * u1
            if u1 >= 1.0:
                w1 = 0.016
            quad = [dirv * (L * u0) - side * w0, dirv * (L * u0) + side * w0, dirv * (L * u1) + side * w1, dirv * (L * u1) - side * w1]
            lift = Vector((0, 0, 0.0015 * k))
            quad = [pivot + cock @ (q + lift) for q in quad]
            shade = 0.85 + 0.15 * (1 - abs(a) / 22)
            b.plate(quad, (lambda c, s=shade: (lambda p, i: c * s))(col), rigid("tail"))
    # wings: modelled SPREAD (the flight pose is the rest pose; idle folds them). An arm plate (wing_*) and a hand of
    # pointed primaries (hand_*), chord running back (+Y) from the leading edge
    for s, wb, hb in ((1, "wing_l", "hand_l"), (-1, "wing_r", "hand_r")):
        sx = Vector(WREN_J[wb][0])
        hx = Vector(WREN_J[hb][0])
        arm_poly = [sx + Vector((0, -0.004, 0)), hx + Vector((-s * 0.0, -0.002, 0)), hx + Vector((0, 0.062, 0)),
                    sx + Vector((s * 0.03, 0.074, 0)), sx + Vector((0, 0.062, 0))]
        if s < 0:
            arm_poly = arm_poly[::-1]
        b.plate(arm_poly, lambda p, i, s=s: mixc(W["wing"], W["edge"], 0.25 if p.y > 0.03 else 0.0), rigid(wb))
        # primaries: three long pointed plates
        for k, (dx, dy, ln) in enumerate(((0.0, 0.0, 0.112), (0.0, 0.02, 0.098), (0.0, 0.04, 0.078))):
            base = hx + Vector((0, dy, 0.0006 * k))
            tipv = base + Vector((s * ln * 0.93, ln * 0.36, 0))
            poly = [base + Vector((0, -0.006, 0)), tipv, base + Vector((s * ln * 0.25, 0.03, 0)), base + Vector((0, 0.024, 0))]
            if s < 0:
                poly = poly[::-1]
            b.plate(poly, lambda p, i, k=k: mixc(W["prim"], W["wing"], 0.25 * k), rigid(hb))
    ob = b.finish("dialwren")
    return ob


def wren_folded(s: int) -> tuple[Matrix, Matrix]:
    """the wing folded along the body: the arm swept back and rolled down against the flank, the hand tucked"""
    arm = R(z=s * 96) @ R(y=s * 62) @ R(x=-6)
    hand = R(z=s * 8)
    return arm, hand


def wren_idle(t: float) -> dict:
    T = 4.0
    s_ = t * T
    breath = math.sin(2 * math.pi * t * 2) * 0.0018
    # look round: yaw keys
    yaw = 0.0
    for (a, b_, ang) in ((0.2, 0.9, 38), (1.6, 2.3, -42), (3.3, 3.8, 18)):
        yaw += ang * bump(s_, a, b_)
    # two pecks (body pitches down, head down) around 2.5 s and 2.85 s
    peck = bump(s_, 2.4, 2.75) + bump(s_, 2.78, 3.12)
    flick = bump(s_, 1.05, 1.35) + 0.6 * bump(s_, 3.85, 4.0) + 0.6 * bump(s_, 0.0, 0.12)
    pose = {
        "root": (Matrix.Identity(3), Vector()),
        "body": (R(x=-24 * peck + 2 * math.sin(2 * math.pi * t)), Vector((0, 0, breath - 0.004 * peck))),
        "head": (R(x=-38 * peck + 6 * bump(s_, 1.6, 2.3), z=yaw, y=8 * bump(s_, 0.3, 0.8) - 10 * bump(s_, 3.3, 3.8)), Vector()),
        "tail": (R(x=-16 * flick + 6 * peck), Vector()),
        "legs": (R(x=24 * peck), Vector()),
    }
    for s, wb, hb in ((1, "wing_l", "hand_l"), (-1, "wing_r", "hand_r")):
        a, h = wren_folded(s)
        pose[wb] = (a, Vector())
        pose[hb] = (h, Vector())
    return pose


def wren_beat(ph: float, amp: float = 1.0) -> tuple[float, float]:
    """arm and hand elevation for a wing-beat phase (0..1): a strong downstroke, a fast lagging hand"""
    up = math.cos(2 * math.pi * ph)
    return 8 + 52 * amp * up, 26 * amp * math.cos(2 * math.pi * ph - 0.9)


def wren_flee(t: float) -> dict:
    arm_e, hand_e = wren_beat(t)
    bob = -math.cos(2 * math.pi * t) * 0.006
    pose = {
        "root": (Matrix.Identity(3), Vector()),
        "body": (R(x=-8), Vector((0, 0, 0.02 + bob))),
        "head": (R(x=10), Vector()),
        "tail": (R(x=44 + 4 * math.sin(2 * math.pi * t)), Vector()),   # streamlined, near level
        "legs": (R(x=-78), Vector()),                    # tucked back
    }
    for s, wb, hb in ((1, "wing_l", "hand_l"), (-1, "wing_r", "hand_r")):
        pose[wb] = (R(y=-s * arm_e) @ R(z=s * 4), Vector())
        pose[hb] = (R(y=-s * hand_e), Vector())
    return pose


def wren_settle(t: float) -> dict:
    f = t * 24
    # 0-10 two braking beats, body pitched up, legs reaching forward; 10-14 touchdown; 14-24 fold, tail flick
    braking = 1 - ease(f, 9, 15)
    beat = (f / 10.0) * 2
    arm_e, hand_e = wren_beat(beat % 1.0, 1.0)
    fold = ease(f, 13, 21)
    land = bump(f, 9.5, 16)
    flick = bump(f, 17, 23)
    pose = {
        "root": (Matrix.Identity(3), Vector()),
        "body": (R(x=28 * braking - 10 * land), Vector((0, 0, 0.012 * braking - 0.006 * land))),
        "head": (R(x=-14 * braking + 8 * land), Vector()),
        "tail": (R(x=30 * braking - 18 * flick), Vector()),
        "legs": (R(x=30 * braking - 10 * land), Vector()),
    }
    rest = wren_idle(0.0)
    for s, wb, hb in ((1, "wing_l", "hand_l"), (-1, "wing_r", "hand_r")):
        fa, fh = wren_folded(s)
        spread_a = R(y=-s * arm_e * braking + -s * 20 * (1 - braking)) @ R(z=s * 4)
        spread_h = R(y=-s * hand_e * braking)
        pose[wb] = (_slerp(spread_a, fa, fold), Vector())
        pose[hb] = (_slerp(spread_h, fh, fold), Vector())
    # the last frames blend into the idle loop's first pose
    end = ease(f, 20, 24)
    for k, (rot, off) in rest.items():
        r0, o0 = pose.get(k, (Matrix.Identity(3), Vector()))
        pose[k] = (_slerp(r0, rot, end), o0.lerp(off, end))
    return pose


def _slerp(a: Matrix, b: Matrix, t: float) -> Matrix:
    return a.to_quaternion().slerp(b.to_quaternion(), max(0.0, min(1.0, t))).to_matrix()


# ══ hourskink ═════════════════════════════════════════════════════════════════════════════════════
SKINK_J = {
    "root": ((0, 0, 0), None),
    "hips": ((0, 0.03, 0.034), "root"),
    "chest": ((0, -0.02, 0.036), "hips"),
    "head": ((0, -0.085, 0.04), "chest"),
    "sail": ((0, -0.03, 0.056), "hips"),
    "tail1": ((0, 0.095, 0.03), "hips"),
    "tail2": ((0, 0.17, 0.024), "tail1"),
    "tail3": ((0, 0.24, 0.018), "tail2"),
    "leg_fl": ((0.026, -0.05, 0.03), "chest"),
    "leg_fr": ((-0.026, -0.05, 0.03), "chest"),
    "leg_bl": ((0.026, 0.07, 0.03), "hips"),
    "leg_br": ((-0.026, 0.07, 0.03), "hips"),
}
SK = {
    "body": lin("#8A7352"), "band": lin("#4C3D2C"), "belly": lin("#A99472"), "head": lin("#7C6849"), "eye": lin("#191715"),
    "sail": lin("#6D5940"), "rib": lin("#33291F"), "edge": lin("#BDB197"), "leg": lin("#6E5C42"), "toe": lin("#4B3E2E"),
}


def build_skink():
    b = Builder(list(SKINK_J))
    S = SK

    def spine_w(p):
        y = p.y
        if y < 0.08:
            w = smooth(0.03, -0.03, y)
            return {"chest": w, "hips": 1 - w}
        return {"hips": 1.0}

    def body_col(p, i):
        # warm cut-stone back crossed by dark hour-bands, a pale belly
        band = 0.5 + 0.5 * math.cos(p.y * 2 * math.pi / 0.045)
        bandm = smooth(0.55, 0.85, band) * smooth(0.03, 0.045, p.z)
        c = mixc(S["body"], S["band"], bandm * 0.85)
        c = mixc(c, S["belly"], smooth(0.028, 0.016, p.z))
        return c * (0.72 + 0.28 * smooth(0.015, 0.05, p.z))

    b.ellipsoid((0, 0.008, 0.034), (0.03, 0.098, 0.022), body_col, spine_w, seg=12, rings=9)

    def head_col(p, i):
        c = mixc(S["head"], S["belly"], smooth(0.036, 0.026, p.z))
        return c * (0.78 + 0.22 * smooth(0.025, 0.055, p.z))

    b.ellipsoid((0, -0.112, 0.038), (0.022, 0.036, 0.0155), head_col, rigid("head"), seg=10, rings=6, rot=R(x=-4))
    for s in (1, -1):
        b.ellipsoid((s * 0.018, -0.118, 0.045), (0.0055, 0.0055, 0.0055), lambda p, i: S["eye"], rigid("head"), seg=6, rings=4)

    # tail: a tapered tube from the hips to a fine tip, smooth weights along three bones
    tpts = [(0, 0.082, 0.031), (0, 0.13, 0.027), (0, 0.18, 0.022), (0, 0.23, 0.017), (0, 0.28, 0.012), (0, 0.33, 0.008)]
    trad = [0.019, 0.015, 0.011, 0.0075, 0.0045, 0.002]

    def tail_w(p):
        y = p.y
        w1 = smooth(0.07, 0.11, y)
        w2 = smooth(0.15, 0.19, y)
        w3 = smooth(0.22, 0.26, y)
        return {"hips": 1 - w1, "tail1": w1 - w2, "tail2": w2 - w3, "tail3": w3}

    def tail_col(p, i):
        band = 0.5 + 0.5 * math.cos(p.y * 2 * math.pi / 0.05)
        c = mixc(S["body"], S["band"], smooth(0.5, 0.9, band) * 0.8)
        return c * (0.75 + 0.25 * smooth(0.005, 0.03, p.z))

    b.tube(tpts, trad, tail_col, tail_w, sides=6, cap=True)

    # legs: splayed, bent at the knee, three-toed feet flat on the ground
    for bone, (x, y, z) in ((k, SKINK_J[k][0]) for k in ("leg_fl", "leg_fr", "leg_bl", "leg_br")):
        s = 1 if x > 0 else -1
        front = y < 0
        knee = (x + s * 0.032, y + (-0.006 if front else 0.01), z + 0.012)
        foot = (x + s * 0.042, y + (-0.012 if front else 0.018), 0.004)
        b.tube([(x, y, z), knee, foot], [0.0075, 0.0055, 0.004], lambda p, i: SK["leg"], rigid(bone), sides=4, cap=False)
        fv = Vector(foot)
        fwd = -1 if front else 1                      # front toes reach forward (-Y), hind toes back
        for a in (-30, 5, 40):                        # fanned, leaning outward
            ang = math.radians(a)
            d = Vector((s * math.sin(ang), fwd * math.cos(ang), 0)) * 0.018
            b.tube([tuple(fv), tuple(fv + d)], [0.003, 0.0015], lambda p, i: SK["toe"], rigid(bone), sides=3, cap=True)

    # the gnomon sail: a right triangle, its upright edge forward, ribbed with dark hour-lines; four strips (crisp
    # ribs), a pale chalk upper edge
    base0, base1 = Vector((0, -0.052, 0.05)), Vector((0, 0.07, 0.046))
    apex_h = 0.072
    n = 5
    for k in range(n):
        u0, u1 = k / n, (k + 1) / n
        p0 = base0.lerp(base1, u0)
        p1 = base0.lerp(base1, u1)
        h0 = apex_h * (1 - u0)
        h1 = apex_h * (1 - u1)
        rib = k % 2 == 1
        col = S["rib"] if rib else S["sail"]
        quad = [p0, p1, p1 + Vector((0, 0, h1 * 0.82)), p0 + Vector((0, 0, h0 * 0.82))]
        b.plate(quad, (lambda c: (lambda p, i: c))(col), rigid("sail"))
        edge = [p0 + Vector((0, 0, h0 * 0.82)), p1 + Vector((0, 0, h1 * 0.82)), p1 + Vector((0, 0, h1)), p0 + Vector((0, 0, h0))]
        if h0 > 1e-4:
            b.plate(edge, lambda p, i: S["edge"], rigid("sail"))
    ob = b.finish("hourskink")
    return ob


SAIL_UP, SAIL_FLAT = 0.0, 74.0          # R(x=+a) lays the upright sail back toward the tail


def skink_idle(t: float) -> dict:
    T = 4.0
    s_ = t * T
    push = bump(s_, 1.2, 1.55) + bump(s_, 1.6, 1.95)
    sail = SAIL_UP + 10 * (0.5 + 0.5 * math.cos(2 * math.pi * t)) + 4 * push
    curl = 10 * math.sin(2 * math.pi * t)
    look = 16 * bump(s_, 2.4, 3.3)
    return {
        "root": (Matrix.Identity(3), Vector()),
        "hips": (R(), Vector((0, 0, 0.0015 * math.sin(2 * math.pi * t * 2)))),
        "chest": (R(x=13 * push), Vector((0, 0, 0.008 * push))),
        "head": (R(x=-6 * push + 4 * math.sin(2 * math.pi * t), z=look), Vector()),
        "sail": (R(x=sail), Vector()),
        "tail1": (R(z=4 * math.sin(2 * math.pi * t)), Vector()),
        "tail2": (R(z=5 * math.sin(2 * math.pi * t - 0.6)), Vector()),
        "tail3": (R(z=curl, x=4), Vector()),
        "leg_fl": (R(y=-10 * push), Vector()),
        "leg_fr": (R(y=10 * push), Vector()),
        "leg_bl": (R(), Vector()),
        "leg_br": (R(), Vector()),
    }


def skink_run(ph: float, amp: float = 1.0) -> dict:
    w = 2 * math.pi * ph
    sw = math.sin(w)
    lift_a = max(0.0, math.sin(w)) * amp
    lift_b = max(0.0, -math.sin(w)) * amp
    return {
        "root": (Matrix.Identity(3), Vector()),
        "hips": (R(z=-14 * sw * amp), Vector((0, 0, -0.004 * amp))),
        "chest": (R(z=26 * sw * amp, x=-3 * amp), Vector()),
        "head": (R(z=-14 * sw * amp, x=-4 * amp), Vector()),
        "sail": (R(x=SAIL_FLAT * amp + SAIL_UP * (1 - amp)), Vector()),
        "tail1": (R(z=20 * math.sin(w - 0.9) * amp), Vector()),
        "tail2": (R(z=26 * math.sin(w - 1.7) * amp), Vector()),
        "tail3": (R(z=30 * math.sin(w - 2.5) * amp), Vector()),
        # diagonal pairs: front-left with back-right
        "leg_fl": (R(z=-38 * math.cos(w) * amp, y=-22 * lift_a), Vector()),
        "leg_br": (R(z=-38 * math.cos(w) * amp, y=22 * lift_a), Vector()),
        "leg_fr": (R(z=-38 * math.cos(w) * amp, y=22 * lift_b), Vector()),
        "leg_bl": (R(z=-38 * math.cos(w) * amp, y=-22 * lift_b), Vector()),
    }


def skink_flee(t: float) -> dict:
    return skink_run(t, 1.0)


def skink_settle(t: float) -> dict:
    f = t * 27
    amp = 1 - ease(f, 0, 9)
    run = skink_run((f / 10.0) % 1.0, amp)
    rest = skink_idle(0.0)
    raise_ = ease(f, 7, 15)
    over = bump(f, 13, 19)
    push = bump(f, 15, 23)
    pose = {}
    for k in rest:
        r0, o0 = run[k]
        r1, o1 = rest[k]
        pose[k] = (_slerp(r0, r1, ease(f, 3, 12)), o0.lerp(o1, ease(f, 3, 12)))
    pose["sail"] = (_slerp(R(x=SAIL_FLAT), R(x=SAIL_UP - 8 * over), raise_), Vector())
    pose["chest"] = (pose["chest"][0] @ R(x=14 * push), pose["chest"][1] + Vector((0, 0, 0.009 * push)))
    pose["head"] = (pose["head"][0] @ R(x=-7 * push + 10 * over), Vector())
    end = ease(f, 23, 27)
    for k, (rot, off) in rest.items():
        r0, o0 = pose[k]
        pose[k] = (_slerp(r0, rot, end), o0.lerp(off, end))
    return pose


# ── build one critter ────────────────────────────────────────────────────────────────────────────
CRITTERS = {
    "dialwren": (WREN_J, build_wren, [("idle", 120, wren_idle, True), ("flee", 8, wren_flee, True), ("settle", 24, wren_settle, False)]),
    "hourskink": (SKINK_J, build_skink, [("idle", 120, skink_idle, True), ("flee", 10, skink_flee, True), ("settle", 27, skink_settle, False)]),
}


def build(cid: str, qa: bool) -> dict:
    scene.reset()
    joints, builder, clips = CRITTERS[cid]
    arm = armature(cid, joints)
    ob = builder()
    ob.data.materials.append(material(f"{cid}_matte"))
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    dims = [round(x, 3) for x in ob.dimensions]
    rep = {"tris": tris, "verts": len(ob.data.vertices), "bones": len(joints), "size_m": dims, "clips": {}}
    assert tris <= TRI_BUDGET, f"{cid}: {tris} triangles > {TRI_BUDGET}"
    for name, frames, fn, loop in clips:
        rep["clips"][name] = write_clip(arm, name, frames, fn, loop)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{cid}.glb")
    sc = bpy.context.scene
    sc.render.fps = FPS
    for o in sc.objects:
        o.select_set(False)
    arm.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = arm
    sc.frame_set(0)
    kw = dict(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_texcoords=False, export_normals=True, export_tangents=False, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_extras=False, export_skins=True, export_influence_nb=4,
        export_all_influences=False, export_def_bones=False, export_leaf_bone=False, export_rest_position_armature=True,
        export_morph=False, export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_frame_step=1, export_frame_range=False, export_optimize_animation_size=True, export_anim_single_armature=True,
        export_reset_pose_bones=True, export_anim_slide_to_zero=False, export_bake_animation=False,
        export_vertex_color="NAME", export_vertex_color_name="Col", export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
    )
    bpy.ops.export_scene.gltf(**scene.op_kwargs(bpy.ops.export_scene.gltf, **kw))
    opt = export.optimize(path, quantize=True)
    rep["kb"] = round(os.path.getsize(path) / 1024, 1)
    rep["optimize"] = opt.get("ok")
    scene.log(f"{cid}: {tris} tris, {rep['verts']} verts, {rep['kb']} KB, size {dims}")
    if qa:
        rep["three_qa"] = unit_sheet(path, os.path.join(RENDERS, f"critters_{cid}.png"))
    return rep


def unit_sheet(glb: str, png: str) -> dict:
    """art/tools/three_snapshot.mjs --unit: 8 facings at the gameplay camera (1:1 px at 1080p) + every clip"""
    import subprocess
    os.makedirs(os.path.dirname(png), exist_ok=True)
    node = export.node_exe()
    script = os.path.join(scene.TOOLS_DIR, "three_snapshot.mjs")
    if not node or not os.path.isfile(script):
        return {"ok": False, "skipped": "node or three_snapshot.mjs missing"}
    r = subprocess.run([node, script, glb, png, "--unit", "--cell", "200"], cwd=scene.GAME_DIR, capture_output=True, text=True)
    line = next((ln for ln in r.stdout.splitlines() if ln.startswith("[three-snap] {")), None)
    scene.log(f"three unit sheet {os.path.basename(png)}: exit {r.returncode} {line or (r.stdout + r.stderr)[-300:]}")
    return {"ok": r.returncode == 0, "line": line}


def main():
    a = scene.parse_args(lambda p: p.add_argument("--no-qa", action="store_true"))
    only = [x for x in a.only.split(",") if x] or list(CRITTERS)
    report_path = os.path.join(RENDERS, "critters_report.json")
    report = scene.read_json(report_path, {}) or {}
    for cid in only:
        report[cid] = build(cid, qa=not a.no_qa)
    os.makedirs(RENDERS, exist_ok=True)
    scene.write_json(report_path, report)


main()
