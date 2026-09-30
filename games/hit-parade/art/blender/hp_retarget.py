"""HIT PARADE asset pipeline - HYBRID world-space retarget (lane ASSETS, CONTRACT 6.1).

Source of the method: _research/animations/rig_compat.md ("Ship hybrid with a rest-relative hips
rule"), the driftwake closed form (games/driftwake/tools/blender_retarget.py) and the hybrid finger
copy of tools/research/mixamo_rig_proof.py. Generalised here so ONE routine bakes every source kind:

  every source is an X Bot-skeleton sampler returning, for output frame k (30 fps):
      D[bone]  = world-space rotation delta from the X Bot REST  (W_src(n) = D(n) @ R_src_rest(n))
      hoff     = world hips-head offset from the X Bot REST hips head (metres, X Bot scale)
  samplers: ClipSampler (a Mixamo FBX on X Bot, optional range / speed / L-R mirror),
            LayerSampler (lower body from clip A + upper body from clip B, B's upper body
            re-attached to A's hips), ArmSampler (an X Bot armature carrying any action: CMU
            retarget output), AuthorSampler (keyframed world-space poses, author_clips.py).

Target pose per bone (target armature has identity object transform after hp_body):
  body bones (in the source, not fingers):  W_t(n) = D(n) @ R_t_rest(n)         (world delta)
  finger bones:                              W_t(n) = W_t(parent) @ L_src(n)      (parent-relative
                                             copy: the fist shape is X Bot's relative to the hand)
  extra bones (Hair*, Weapon, eyes...):      keep their rest relation to the parent
  basis B(n) = relrest(n)^-1 @ W_t(parent)^-1 @ W_t(n)
Hips (rest-relative rule, rig_compat.md): head_t = rest_head_t + (src_head - src_rest_head) x ratio,
  ratio = target hip height / X Bot hip height. The horizontal part is then STRIPPED: the hips stay
  above the rest hips xy in every frame, and the forward travel is returned as root motion
  ([[t, dx_fwd_m]], body metres, relative to frame 0) for clips.json 'root'.
Optional per clip: air='strip' ground-locks the feet (the sim owns airborne height; the removed
lift is reported as apexY), loopBlend=K eases the last K frames into frame 0.
ASCII only.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

import hp_common as C

FPS = 30
S_MIRROR = Matrix(((-1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)))


# ---------------------------------------------------------------------------- samplers
class _ArmEval(object):
    """Evaluates one imported X Bot-skeleton armature at a (fractional) scene frame."""

    def __init__(self, arm):
        self.arm = arm
        self.m3 = C.arm_m3(arm)
        self.names = {C.strip(b.name): b.name for b in arm.data.bones}
        self.rest = {s: C.rest_w3(arm, n) for s, n in self.names.items()}
        self.rest_inv = {s: r.inverted() for s, r in self.rest.items()}
        self.rest_hips = C.rest_head_w(arm, self.names["Hips"])
        self.hip_h = C.hip_height(arm)
        act = arm.animation_data.action if arm.animation_data else None
        self.frange = C.action_frame_range(act) if act else (1, 1)

    def eval(self, f):
        scn = bpy.context.scene
        fi = int(math.floor(f))
        scn.frame_set(fi, subframe=float(f - fi))
        bpy.context.view_layer.update()
        pbs = self.arm.pose.bones
        D = {}
        for s, n in self.names.items():
            W = (self.m3 @ pbs[n].matrix.to_3x3()).normalized()
            D[s] = W @ self.rest_inv[s]
        hips = self.arm.matrix_world @ pbs[self.names["Hips"]].head
        return D, hips - self.rest_hips

    def world_rot(self, D, s):
        return D[s] @ self.rest[s]


def _mirror(D, hoff):
    Dm = {}
    for s in D:
        src = C.swap_lr(s)
        if src not in D:
            src = s
        Dm[s] = S_MIRROR @ D[src] @ S_MIRROR
    return Dm, S_MIRROR @ hoff


class ClipSampler(object):
    """A Mixamo clip (FBX on X Bot). rng = [f0, f1] source frames (1-based, as in the file).
    `ev` is an _ArmEval (or an armature, wrapped here)."""

    def __init__(self, ev, rng=None, speed=1.0, mirror=False):
        self.ev = ev if isinstance(ev, _ArmEval) else _ArmEval(ev)
        a, b = self.ev.frange
        self.f0 = float(rng[0]) if rng else float(a)
        self.f1 = float(rng[1]) if rng else float(b)
        self.speed = float(speed or 1.0)
        self.mirror = bool(mirror)
        self.n = int(math.floor((self.f1 - self.f0) / self.speed + 1e-6)) + 1
        self.rest = self.ev.rest
        self.hip_h = self.ev.hip_h

    def src_frame(self, k):
        return min(self.f1, self.f0 + k * self.speed)

    def sample(self, k):
        D, h = self.ev.eval(self.src_frame(k))
        if self.mirror:
            D, h = _mirror(D, h)
        return D, h


class ArmSampler(ClipSampler):
    """Any X Bot armature whose action is keyed on consecutive frames (CMU output, authored)."""


class YawSampler(object):
    """Turns a whole sampler about the world vertical through the rest hips (D' = Rz D, hoff' = Rz hoff):
    the contact AIM (bake_fighter.aim_clip) puts a strike's effector straight ahead at contact."""

    def __init__(self, inner, Rz):
        self.inner = inner
        self.Rz = Rz
        self.n = inner.n
        self.rest = inner.rest
        self.hip_h = inner.hip_h
        self.f0 = getattr(inner, "f0", 0.0)
        self.speed = getattr(inner, "speed", 1.0)

    def __getattr__(self, name):
        return getattr(self.__dict__["inner"], name)

    def sample(self, k):
        D, h = self.inner.sample(k)
        return {s: self.Rz @ m for s, m in D.items()}, self.Rz @ h


def yaw_to_front(v):
    """3x3 rotation about world Z taking the horizontal direction of v onto the model forward (-Y)."""
    phi = math.atan2(v.y, v.x)
    return Matrix.Rotation(math.atan2(-1.0, 0.0) - phi, 3, Vector((0.0, 0.0, 1.0)))


def swing_about_z(R):
    """R (3x3 world rotation) minus its twist about world Z: the tilt part only (swing-twist)."""
    q = R.to_quaternion()
    tw = Quaternion((q.w, 0.0, 0.0, q.z))
    if tw.magnitude < 1e-9:
        return R.copy()
    tw.normalize()
    return (q @ tw.inverted()).to_matrix()


class LayerSampler(object):
    """Lower body (Hips + legs) from A, upper body (Spine and up) from B re-attached to A's hips.
    B is time-warped onto A's output frames.
    attach (part 2): how B's upper body is re-attached onto A's hips.
      "full"  B's upper keeps its relation to B's hips (rotated by A_hips @ B_hips^-1). Carries B's
              pelvis YAW offset into the result: a bladed boxing pelvis (30-50 deg off the punch line)
              turned the layered punch off-line (measured: bruno air_chop fist 0.23 m BEHIND the body,
              johnny air_hammer at -0.03 m, air_cross 0.44 m vs 0.87 m standing).
      "yaw"   (default) only the TILT of A_hips @ B_hips^-1 is applied (swing about world Z): B's upper
              keeps its own world yaw = its facing / attack line, and leans with A's hips.
      "world" B's upper keeps its world orientation exactly (no lean from A)."""

    def __init__(self, lower, upper, attach="yaw"):
        self.lo, self.up = lower, upper
        self.n = lower.n
        self.rest = lower.rest
        self.hip_h = lower.hip_h
        if attach not in ("full", "yaw", "world"):
            raise ValueError("layer attach must be full|yaw|world, got %r" % (attach,))
        self.attach = attach
        self.up_yaw = None   # contact aim of a layered strike turns the UPPER only (legs keep running)

    def sample(self, k):
        Da, ha = self.lo.sample(k)
        if self.up.n <= 1 or self.n <= 1:
            ku = 0.0
        else:
            ku = k * (self.up.n - 1) / float(self.n - 1)
        fu = self.up.f0 + ku * self.up.speed
        Db, _ = self.up.ev.eval(min(self.up.f1, fu))
        if self.up.mirror:
            Db, _ = _mirror(Db, Vector())
        if self.up_yaw is not None:
            Db = {s: self.up_yaw @ m for s, m in Db.items()}
        att = Da["Hips"] @ Db["Hips"].inverted()
        if self.attach == "yaw":
            att = swing_about_z(att)
        elif self.attach == "world":
            att = Matrix.Identity(3)
        D = {}
        for s in Da:
            if s in C.LOWER_BODY:
                D[s] = Da[s]
            else:
                D[s] = att @ Db[s]
        return D, ha


def _slerp3(a, b, w):
    qa, qb = a.to_quaternion(), b.to_quaternion()
    if qa.dot(qb) < 0.0:
        qb.negate()
    return qa.slerp(qb, w).to_matrix()


class SeqSampler(object):
    """CONTRACT 20.5 `seq`: segments played back to back. Segment k starts where segment k-1 ends
    minus `xf` output frames (30 fps), so the clip length is sum(n_k) - 1*(K-1) - xf*(K-1) frames and
    segment k frame j sits on output frame starts[k] + j (= lane FIGHTERS' kitlib.entry_seconds).
    The xf+1 overlapping frames crossfade with a smoothstep (bone deltas slerped, hips lerped).
    Horizontal hips travel is continuous: each segment continues from where the previous one was at
    the blend start (its own frame-0 xy is re-based there), so the stripped root motion accumulates.
    Every segment is an X Bot-skeleton sampler; hip offsets are rescaled to segment 0's hip height."""

    def __init__(self, segs, xf=2):
        if not segs:
            raise ValueError("seq needs at least one segment")
        self.segs = segs
        self.xf = max(0, int(xf))
        self.starts = [0]
        for i in range(1, len(segs)):
            s = self.starts[-1] + segs[i - 1].n - 1 - self.xf
            self.starts.append(max(self.starts[-1] + 1, s))
        self.n = self.starts[-1] + segs[-1].n
        self.rest = segs[0].rest
        self.hip_h = segs[0].hip_h
        self.f0, self.speed = 0.0, 1.0
        self._off = None

    def _seg(self, i, j):
        g = self.segs[i]
        D, h = g.sample(max(0, min(g.n - 1, j)))
        sc = self.hip_h / g.hip_h if g.hip_h else 1.0
        return D, h * sc

    def _offsets(self):
        # horizontal re-base per segment (computed once; evaluates the blend-start frames)
        offs = [Vector((0.0, 0.0, 0.0))]
        for i in range(1, len(self.segs)):
            j_prev = self.starts[i] - self.starts[i - 1]
            _, hp = self._seg(i - 1, j_prev)
            _, h0 = self._seg(i, 0)
            o = offs[i - 1] + Vector((hp.x - h0.x, hp.y - h0.y, 0.0))
            offs.append(o)
        self._off = offs

    def sample(self, k):
        if self._off is None:
            self._offsets()
        cur = 0
        for i in range(len(self.segs)):
            if k >= self.starts[i]:
                cur = i
        Dc, hc = self._seg(cur, k - self.starts[cur])
        hc = hc + self._off[cur]
        if cur > 0 and self.xf > 0 and k < self.starts[cur] + self.xf:
            prev = cur - 1
            Dp, hp = self._seg(prev, k - self.starts[prev])
            hp = hp + self._off[prev]
            w = (k - self.starts[cur]) / float(self.xf)
            w = w * w * (3.0 - 2.0 * w)
            D = {s: _slerp3(Dp[s], Dc[s], w) for s in Dc if s in Dp}
            return D, hp.lerp(hc, w)
        return Dc, hc

    def locate(self, i, out_frame_in_segment):
        """Output frame of segment i's own output frame."""
        return self.starts[i] + out_frame_in_segment


# ---------------------------------------------------------------------------- core
class Target(object):
    def __init__(self, arm):
        self.arm = arm
        mw = arm.matrix_world
        err = max(abs(mw[i][j] - (1.0 if i == j else 0.0)) for i in range(4) for j in range(4))
        if err > 1e-5:
            raise RuntimeError("target armature must have an identity object transform (err %g)" % err)
        self.order = C.hier_order(arm)
        self.short = {n: C.strip(n) for n in self.order}
        self.parent = {n: (arm.data.bones[n].parent.name if arm.data.bones[n].parent else None)
                       for n in self.order}
        self.mrest = {n: arm.data.bones[n].matrix_local.copy() for n in self.order}
        self.lrest = {}
        for n in self.order:
            p = self.parent[n]
            self.lrest[n] = (self.mrest[p].inverted() @ self.mrest[n]) if p else self.mrest[n].copy()
        self.relrot = {n: self.lrest[n].to_3x3().normalized() for n in self.order}
        self.relrot_inv = {n: r.inverted() for n, r in self.relrot.items()}
        self.rest_w = {n: self.mrest[n].to_3x3().normalized() for n in self.order}
        self.hips = C.PFX + "Hips"
        self.rest_hips = self.mrest[self.hips].translation.copy()
        self.hips_rrest_inv = self.mrest[self.hips].to_3x3().inverted()
        self.hip_h = C.hip_height(arm)
        feet = [C.PFX + b for b in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase",
                                    "LeftToe_End", "RightToe_End")]
        self.feet = [f for f in feet if f in self.mrest]
        self.feet_rest_z = min(self.mrest[f].translation.z for f in self.feet)
        self.body_rest_z = min(m.translation.z for m in self.mrest.values())

    def fk(self, quats, hips_loc):
        """Armature(=world)-space 4x4 pose matrices from basis quats + hips location."""
        P = {}
        for n in self.order:
            b = quats[n].to_matrix().to_4x4()
            if n == self.hips:
                b = Matrix.Translation(hips_loc) @ b
            p = self.parent[n]
            P[n] = (P[p] @ self.lrest[n] @ b) if p else (self.lrest[n] @ b)
        return P


def retarget(sampler, tgt, opts=None):
    """Sample every output frame, compute the target pose. Returns a dict with per-frame
    'quats' {bone: [Quaternion]}, 'hips' [Vector], 'root' [[t, dx]], 'apex', 'n'."""
    opts = opts or {}
    n = sampler.n
    ratio = tgt.hip_h / sampler.hip_h
    src_rest = sampler.rest
    src_rest_inv = {s: r.inverted() for s, r in src_rest.items()}
    quats = {b: [] for b in tgt.order}
    hips_list = []
    hoffs = []
    for k in range(n):
        D, hoff = sampler.sample(k)
        hoffs.append(hoff.copy())
        W = {}
        for b in tgt.order:
            s = tgt.short[b]
            p = tgt.parent[b]
            Wp = W[p] if p else Matrix.Identity(3)
            if s in D and not C.is_finger(s):
                Wn = D[s] @ tgt.rest_w[b]
            elif s in D and C.is_finger(s):
                ps = tgt.short[p] if p else None
                if ps in D:
                    Ls = (D[ps] @ src_rest[ps]).inverted() @ (D[s] @ src_rest[s])
                else:
                    Ls = tgt.relrot[b]
                Wn = Wp @ Ls
            else:
                Wn = Wp @ tgt.relrot[b]
            W[b] = Wn
            Bm = tgt.relrot_inv[b] @ Wp.inverted() @ Wn
            quats[b].append(Bm.to_quaternion().normalized())
        want = tgt.rest_hips + hoff * ratio
        hips_list.append(want)
    # strip horizontal travel -> root motion (model forward = -Y world)
    y0 = hoffs[0].y
    root = [[round(k / float(FPS), 4), round(-(hoffs[k].y - y0) * ratio, 4)] for k in range(n)]
    for k in range(n):
        hips_list[k] = Vector((tgt.rest_hips.x, tgt.rest_hips.y, hips_list[k].z))
    apex = None
    lifts = []
    if opts.get("air") == "hold":
        # hips height held at frame 0: the sim owns airborne height, the body turns about its hips
        for k in range(n):
            hips_list[k] = Vector((hips_list[k].x, hips_list[k].y, hips_list[0].z))
    if opts.get("air") == "strip":
        for k in range(n):
            P = tgt.fk({b: quats[b][k] for b in tgt.order}, tgt.hips_rrest_inv @ (hips_list[k] - tgt.rest_hips))
            lift = min(P[f].translation.z for f in tgt.feet) - tgt.feet_rest_z
            lifts.append(lift)
            if lift > 0.0:
                hips_list[k] = hips_list[k] - Vector((0.0, 0.0, lift))
        apex = round(max(0.0, max(lifts)), 4)
    lb = int(opts.get("loopBlend") or 0)
    if lb > 0 and n > lb + 1:
        for i in range(lb):
            k = n - lb + i
            w = (i + 1) / float(lb)
            w = w * w * (3 - 2 * w)
            for b in tgt.order:
                q0, qk = quats[b][0], quats[b][k]
                quats[b][k] = qk.slerp(q0, w)
            hips_list[k] = hips_list[k].lerp(hips_list[0], w)
    for b in tgt.order:
        quats[b] = C.quat_list_fix(quats[b])
    locs = [tgt.hips_rrest_inv @ (h - tgt.rest_hips) for h in hips_list]
    return {"n": n, "quats": quats, "hips_loc": locs, "root": root, "apex_strip": apex,
            "ratio": ratio, "lifts": lifts}


def write_action(tgt, name, res):
    """Write the retarget result as a new action on the target armature (keys 0..N-1)."""
    arm = tgt.arm
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    for b in tgt.order:
        qs = res["quats"][b]
        dp = 'pose.bones["%s"].rotation_quaternion' % b
        for i in range(4):
            C.write_fcurve(act, arm, dp, i, [q[i] for q in qs], tgt.short[b])
    dp = 'pose.bones["%s"].location' % tgt.hips
    for i in range(3):
        C.write_fcurve(act, arm, dp, i, [v[i] for v in res["hips_loc"]], "Hips")
    return act


def fk_frames(tgt, res):
    out = []
    for k in range(res["n"]):
        out.append(tgt.fk({b: res["quats"][b][k] for b in tgt.order}, res["hips_loc"][k]))
    return out


def fk_gate(tgt, act, res, frames):
    """Blender-evaluated pose vs our FK (the measurements below trust our FK)."""
    arm = tgt.arm
    arm.animation_data.action = act
    worst = 0.0
    for k in frames:
        bpy.context.scene.frame_set(k)
        bpy.context.view_layer.update()
        P = tgt.fk({b: res["quats"][b][k] for b in tgt.order}, res["hips_loc"][k])
        for b in tgt.order:
            e = (arm.pose.bones[b].head - P[b].translation).length
            worst = max(worst, e)
    return worst


# ---------------------------------------------------------------------------- measurement
EFFECTORS = {
    "RightHand": ("RightHandMiddle1", "RightHand", "RightArm"),
    "LeftHand": ("LeftHandMiddle1", "LeftHand", "LeftArm"),
    "RightFoot": ("RightToeBase", "RightFoot", "RightUpLeg"),
    "LeftFoot": ("LeftToeBase", "LeftFoot", "LeftUpLeg"),
    "RightKnee": ("RightLeg", "RightLeg", "RightUpLeg"),
    "LeftKnee": ("LeftLeg", "LeftLeg", "LeftUpLeg"),
    "Head": ("HeadTop_End", "Head", "Hips"),
}


def eff_point(tgt, P, eff):
    pt, alt, root = EFFECTORS[eff]
    b = C.PFX + pt if (C.PFX + pt) in P else C.PFX + alt
    return P[b].translation, P[C.PFX + root].translation


def to_local(v):
    """world (Blender) -> fighter-local [x_fwd, y_up]."""
    return [round(-v.y, 4), round(v.z, 4)]


def measure(tgt, res, plan, frames_P):
    """contact / effector / apex from the baked pose (our FK).
    plan['contact']: None (not a strike) | 'auto' (front-pass rule) | an OUTPUT frame (float allowed:
    the clip plan's source frame converted; clips.json then carries the exact time and the effector
    point is interpolated between the two neighbouring baked frames).
    plan['effector']: a bone key of EFFECTORS (from the plan, or derived from a CMU limb); otherwise the
    fastest candidate (plan['_eff_cands'] limits the candidates, e.g. hands only for layered strikes) -
    for an explicit contact the fastest in the window [c-4, c+1] around it."""
    n = res["n"]
    out = {"contact": None, "effector": None, "apexY": None}
    cspec = plan.get("contact", "auto")
    eff_name = plan.get("effector")
    cands = plan.get("_eff_cands")
    hips = [P[tgt.hips].translation for P in frames_P]
    c_frame = None
    c_exact = None
    if cspec is None or n < 3:
        pass
    elif isinstance(cspec, (int, float)):
        c_exact = max(0.0, min(float(n - 1), float(cspec)))
        c_frame = int(round(c_exact))
        if not eff_name:
            eff_name = _fastest(tgt, frames_P, hips, n, cands, (max(0, c_frame - 4), min(n - 1, c_frame + 1)))[0]
    else:
        eff_name2, peak = _fastest(tgt, frames_P, hips, n, cands)
        eff_name = eff_name or eff_name2
        sp = _speeds(tgt, frames_P, hips, n, eff_name)
        pk = max(range(n), key=lambda k: sp[k])
        ext = [(eff_point(tgt, frames_P[k], eff_name)[0] - eff_point(tgt, frames_P[k], eff_name)[1]).length
               for k in range(n)]
        c = pk
        for k in range(pk, n - 1):
            c = k
            if ext[k + 1] <= ext[k] or sp[k + 1] < 0.5 * sp[pk]:
                break
        lo, hi = max(0, c - 8), min(n - 1, c + 3)
        c_frame = max(range(lo, hi + 1), key=lambda k: -eff_point(tgt, frames_P[k], eff_name)[0].y)
    if c_frame is not None and eff_name in ("RightFoot", "LeftFoot") and not plan.get("_eff_explicit"):
        # a KNEE strike: at contact the knee is >= 0.15 m ABOVE the toe and the toe is no farther out from the
        # hips (horizontally) than the knee -> the knee is the striking point (patch clinch_knee / step_knee
        # are CMU knees declared kind foot; gazza's Mixamo knees picked the foot as the fastest limb). The
        # test is rotation-invariant (it runs before the contact aim): kicks have the toe up high (front
        # kick) or far out (toe kick, floor sweeps) and are unaffected.
        knee = eff_name.replace("Foot", "Knee")
        Pc = frames_P[c_frame]
        hp = Pc[tgt.hips].translation
        kp = eff_point(tgt, Pc, knee)[0]
        fp = eff_point(tgt, Pc, eff_name)[0]
        kh = Vector((kp.x - hp.x, kp.y - hp.y, 0.0)).length
        fh = Vector((fp.x - hp.x, fp.y - hp.y, 0.0)).length
        if kp.z > fp.z + 0.15 and fh <= kh + 0.05:
            out["effector_note"] = "%s -> %s (knee %.2f m above the toe, toe %.2f m out vs knee %.2f m)" % (
                eff_name, knee, kp.z - fp.z, fh, kh)
            eff_name = knee
    if c_frame is not None:
        if c_exact is None:
            c_exact = float(c_frame)
        out["contact"] = round(c_exact / float(FPS), 4)
        out["contact_frame"] = c_frame
        a = int(math.floor(c_exact))
        b = min(n - 1, a + 1)
        w = c_exact - a
        if w > 1e-6 and b != a:
            # the pose AT the exact time, joints slerped like three.js samples it (a linear chord between
            # the two frames' points was up to 6.6 cm off on johnny's run_hook, a 11.7 m/s hook)
            qs = {bn: res["quats"][bn][a].slerp(res["quats"][bn][b], w) for bn in tgt.order}
            Pi = tgt.fk(qs, res["hips_loc"][a].lerp(res["hips_loc"][b], w))
            p = eff_point(tgt, Pi, eff_name)[0]
        else:
            p = eff_point(tgt, frames_P[a], eff_name)[0]
        out["effector"] = {"bone": eff_name, "at": to_local(p)}
    # apexY: the lift the ground-lock removed (air='strip' clips: the clip's own jump height, which
    # the sim's y replaces). Other clips keep their vertical motion in the pose: null.
    out["apexY"] = res.get("apex_strip")
    return out


def _speeds(tgt, frames_P, hips, n, eff):
    pts = [eff_point(tgt, frames_P[k], eff)[0] - hips[k] for k in range(n)]
    sp = [0.0] * n
    for k in range(n):
        a, b = max(0, k - 1), min(n - 1, k + 1)
        if b > a:
            sp[k] = (pts[b] - pts[a]).length * FPS / float(b - a)
    return sp


def _fastest(tgt, frames_P, hips, n, cands=None, window=None):
    best = (None, -1.0)
    for eff in (cands or ("RightHand", "LeftHand", "RightFoot", "LeftFoot", "RightKnee", "LeftKnee")):
        if C.PFX + EFFECTORS[eff][1] not in frames_P[0]:
            continue
        sp = _speeds(tgt, frames_P, hips, n, eff)
        if window:
            sp = sp[window[0]:window[1] + 1] or sp
        m = max(sp)
        if m > best[1]:
            best = (eff, m)
    return best


def body_facts(tgt):
    """clips.json body facts (rest pose, metres)."""
    M = tgt.mrest
    g = lambda s: M[C.PFX + s].translation  # noqa: E731
    top = max(m.translation.z for m in M.values())
    tip = "RightHandMiddle4" if (C.PFX + "RightHandMiddle4") in M else "RightHand"
    toe = "RightToe_End" if (C.PFX + "RightToe_End") in M else "RightToeBase"
    return {
        "hipsM": round(g("Hips").z, 4),
        "handReachM": round(abs(g(tip).x - g("Hips").x), 4),
        "footReachM": round((g("RightUpLeg") - g(toe)).length, 4),
        "boneTopM": round(top, 4),
    }
