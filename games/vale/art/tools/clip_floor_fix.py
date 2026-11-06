#!/usr/bin/env python3
"""Bring a shipped fighter GLB's props, chains and feet up to the floor, in place, without a rebuild (closing CW5
minor:floor-sweep). Companion of art/tools/clip_floor.py, which stays the gate.

    python3 art/tools/clip_floor_fix.py art/out/fighters/ervet/ervet.glb [--clips cast_ult,recall] [--max-deg 45] [--dry]

For each clip the gate fails, per round: take the lowest visible vertex, pick the bones that may carry it and that have a
rotation track in this clip, and at each of those bones' keys turn the bone about its own head by the least rotation that
brings its subtree up to the floor. Every correction is feathered over its neighbours so nothing pops.

    a prop (prop.R / prop.L, usually no track of its own)  -> the hand's wrist
    a chain segment x_<name>_<k>                           -> x_<name>_1 ... x_<name>_k, root first
    a rigid extra x_<name> with its own track              -> itself
    foot or toe                                            -> the leg: two-bone IK on thigh and shin lifts the ankle, the
                                                              knee stays on the source pose's side, the foot keeps its
                                                              world rotation. A straight leg, or a shin track with no
                                                              keys there (thinned), cannot bend: the thigh swings the
                                                              whole leg up about the hip instead
    the body, in a death                                   -> the hips' track rises (the corpse lies on the floor)
    the body, anywhere else                                -> nothing: that is the source's job (reported, not moved)

Only animation samples are rewritten, in their own bytes of the BIN chunk: no key is added, no texture re-encoded, the
file size does not change. A rebuild loses it: re-run this after a build, then art/tools/clip_floor.py. A two-handed
weapon turns at the leading wrist only, so the tool prints the most it turned each bone: look at the clip when that is large.

Guard: a solve that grows a leg's largest 30 Hz step (foot or shin, relative to the hips) by more than MAX_STEP_GROWTH, or
moves an ankle more than MAX_ANKLE_SHIFT across the floor, is refused: the clip stays as it was and the tool exits 1.

    python3 art/tools/clip_floor_fix.py art/out/fighters/ervet/ervet.glb --check-against <pre-fix copy of the glb>

runs the same step check on a shipped GLB against an earlier copy, every clip, writes nothing, exits 1 on a growth.
Pure python + numpy (shares chain_motion's GLB reader).
"""
import argparse
import math
import os
import re
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chain_motion import CT, NC, Rig, accessor  # noqa: E402

LIMIT = -0.02       # clip_floor's gate
HEADROOM = 0.004    # solve to this far above the gate's limit; thinned keys dip between themselves
ROUNDS = 12
MAX_STEP_GROWTH = 0.10  # m per 30 Hz frame, foot or shin relative to the hips
MAX_ANKLE_SHIFT = 0.10  # m, horizontal
LEG_BONES = ("foot.L", "foot.R", "shin.L", "shin.R")


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def q_from_rotvec(v):
    a = float(np.linalg.norm(v))
    if a < 1e-9:
        return np.array([0.0, 0.0, 0.0, 1.0])
    return np.r_[v / a * math.sin(a / 2), math.cos(a / 2)]


def rot_only(M):
    u, _, vt = np.linalg.svd(M[:3, :3])
    return u @ vt


def rot_matrix(v):
    a = float(np.linalg.norm(v))
    if a < 1e-9:
        return np.eye(3)
    k = v / a
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


class Body:
    def __init__(self, rig):
        self.rig = rig
        js, buf = rig.js, rig.buf
        self.prims = []
        for n in rig.nodes:
            if "mesh" in n and "skin" in n:
                for prim in js["meshes"][n["mesh"]]["primitives"]:
                    at = prim["attributes"]
                    if "JOINTS_0" not in at:
                        continue
                    pos = accessor(js, buf, at["POSITION"])
                    J = accessor(js, buf, at["JOINTS_0"]).astype(int)
                    W = accessor(js, buf, at["WEIGHTS_0"])
                    W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
                    self.prims.append((np.c_[pos, np.ones(len(pos))], J, W, n["skin"]))
        self.skins = []
        for sk in js["skins"]:
            ibm = accessor(js, buf, sk["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
            self.skins.append((sk["joints"], ibm))

    def verts(self, world):
        """(positions, dominant joint's node index), visible vertices only (a bone scaled to nothing hides its mesh)"""
        P, D = [], []
        for P4, J, W, si in self.prims:
            joints, ibm = self.skins[si]
            Mj = np.stack([world[j] @ ibm[k] for k, j in enumerate(joints)])
            out = np.zeros((len(P4), 3))
            for c in range(J.shape[1]):
                out += W[:, c:c + 1] * np.einsum("nij,nj->ni", Mj[J[:, c]], P4)[:, :3]
            dom = J[np.arange(len(J)), np.argmax(W, 1)]
            vis = np.abs(np.linalg.det(Mj[dom][:, :3, :3])) >= 1e-3
            P.append(out[vis])
            D.append(np.array(joints)[dom[vis]])
        return np.concatenate(P), np.concatenate(D)


def carriers(rig, node, rot_nodes):
    """the bones that may lift a vertex dominated by the rigid extra or chain `node`, in order"""
    nm = rig.nodes[node].get("name", "")
    if not nm.startswith(("x_", "prop.")):
        return []
    if nm.startswith("x_") and not re.search(r"_\d+$", nm) and node in rot_nodes:
        return [node]   # a rigid extra with its own track (a pavise, a hat)
    i = node
    while i is not None:
        n = rig.nodes[i].get("name", "")
        if n.startswith("hand."):
            return [i] if i in rot_nodes else []
        m = re.match(r"x_(.+)_(\d+)$", n)
        if m:
            segs = [rig.name.get(f"x_{m.group(1)}_{k}") for k in range(1, int(m.group(2)) + 1)]
            return [s for s in segs if s in rot_nodes]
        i = rig.parent.get(i)
        if i is None or rig.nodes[i].get("name", "") in ("hips", "spine", "chest", "neck", "head"):
            return []
    return []


def subtree(rig, node):
    out = {node}
    for c in rig.nodes[node].get("children", []):
        out |= subtree(rig, c)
    return out


def lowest_over_frames(body, ch, dur, fps=30.0):
    best = (1e9, 0, None)
    for f in range(0, max(1, int(round(dur * fps))) + 1):
        t = min(f / fps, dur)
        P, D = body.verts(body.rig.pose(ch, t))
        i = int(np.argmin(P[:, 1]))
        if P[i, 1] < best[0]:
            best = (float(P[i, 1]), f, int(D[i]))
    return best


def solve_bone(body, ch, bone, target, max_rad):
    """turn `bone` at each of its keys so its subtree clears `target`; returns the largest angle turned this call (rad)"""
    rig = body.rig
    tr = next(c for c in ch if c[0] == bone and c[1] == "rotation")
    times, vals = tr[2], tr[3]
    sub = subtree(rig, bone)
    parent = rig.parent.get(bone)
    deltas = np.zeros((len(times), 3))
    orig = vals.copy()
    for k, t in enumerate(times):
        total = np.zeros(3)
        for _ in range(5):
            world = rig.pose(ch, float(t))
            P, D = body.verts(world)
            P = P[np.isin(D, list(sub))]
            if not len(P):
                break
            i = int(np.argmin(P[:, 1]))
            if P[i, 1] >= target - 0.0005:
                break
            piv = world[bone][:3, 3]
            d = P[i] - piv
            r = float(np.linalg.norm(d))
            if r < 1e-4:
                break
            cos_now = max(-1.0, min(1.0, d[1] / r))
            cos_want = (target - piv[1]) / r
            if cos_want >= 1.0:     # the pivot itself is under the floor: straight up is the most it can do
                cos_want = 0.999
            cos_want = max(-1.0, cos_want)
            ang = math.acos(cos_now) - math.acos(cos_want)
            if ang <= 1e-5:
                break
            axis = np.cross(d, (0.0, 1.0, 0.0))
            n = float(np.linalg.norm(axis))
            if n < 1e-6:
                break
            Rp = rot_only(world[parent]) if parent is not None else np.eye(3)
            step = Rp.T @ (axis / n * ang)      # the world turn, in the parent's frame
            if np.linalg.norm(total + step) > max_rad:
                break
            total = total + step
            vals[k] = qmul(q_from_rotvec(total), orig[k])
        deltas[k] = total
    # feather: a key beside a corrected one takes part of it, in time, so the turn eases in and out
    if np.abs(deltas).sum() == 0:
        return 0.0
    feather = deltas.copy()
    for _ in range(2):
        s = feather.copy()
        for k in range(len(times)):
            a, b = max(0, k - 1), min(len(times) - 1, k + 1)
            s[k] = 0.25 * feather[a] + 0.5 * feather[k] + 0.25 * feather[b]
        feather = s
    use = np.where(np.linalg.norm(feather, axis=1, keepdims=True) > np.linalg.norm(deltas, axis=1, keepdims=True), feather, deltas)
    for k in range(len(times)):
        vals[k] = qmul(q_from_rotvec(use[k]), orig[k])
        vals[k] /= np.linalg.norm(vals[k])
    return float(np.linalg.norm(use, axis=1).max())


def mat2quat(R):
    t = np.trace(R)
    if t > 0:
        w = math.sqrt(1 + t) * 2
        q = [(R[2, 1] - R[1, 2]) / w, (R[0, 2] - R[2, 0]) / w, (R[1, 0] - R[0, 1]) / w, w / 4]
    else:
        i = int(np.argmax(np.diag(R)))
        j, k = (i + 1) % 3, (i + 2) % 3
        w = math.sqrt(1 + R[i, i] - R[j, j] - R[k, k]) * 2
        q = [0.0, 0.0, 0.0, (R[k, j] - R[j, k]) / w]
        q[i] = w / 4
        q[j] = (R[j, i] + R[i, j]) / w
        q[k] = (R[k, i] + R[i, k]) / w
    return np.array(q) / np.linalg.norm(q)


def min_rot(a, b):
    """the least rotation matrix taking direction a to direction b"""
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    ax = np.cross(a, b)
    n = float(np.linalg.norm(ax))
    if n < 1e-9:
        return np.eye(3)
    return rot_matrix(ax / n * math.atan2(n, float(a @ b)))


def feathered(lift):
    """a per-frame lift eased over its neighbours; never less than asked"""
    f = lift.copy()
    for _ in range(3):
        s = f.copy()
        s[1:-1] = 0.25 * f[:-2] + 0.5 * f[1:-1] + 0.25 * f[2:]
        f = s
    return np.maximum(f, lift)


def frame_times(dur, fps=30.0):
    return np.array([min(f / fps, dur) for f in range(0, max(1, int(round(dur * fps))) + 1)])


def copy_channels(ch):
    return [tuple(c[:3]) + (c[3].copy(),) + tuple(c[4:]) for c in ch]


def pose_at_frames(rig, ch, dur, names):
    """{name: positions per 30 Hz frame}; the bones' world origins"""
    times = frame_times(dur)
    ids = {n: rig.name[n] for n in names if n in rig.name}
    out = {n: np.zeros((len(times), 3)) for n in ids}
    for i, t in enumerate(times):
        w = rig.pose(ch, float(t))
        for n, j in ids.items():
            out[n][i] = w[j][:3, 3]
    return out


def leg_steps(rig, ch, dur):
    """{leg bone: (largest 30 Hz step relative to the hips, its frame)}"""
    p = pose_at_frames(rig, ch, dur, LEG_BONES + ("hips",))
    out = {}
    for n in LEG_BONES:
        if n in p:
            d = np.linalg.norm(np.diff(p[n] - p["hips"], axis=0), axis=1)
            k = int(np.argmax(d)) if len(d) else 0
            out[n] = (float(d[k]) if len(d) else 0.0, k + 1)
    return out


def leg_guard(rig, src, ch, dur):
    """what is wrong with this solve against its source, or None"""
    s0, s1 = leg_steps(rig, src, dur), leg_steps(rig, ch, dur)
    bad = [f"{n} step {s0[n][0]:.3f} -> {s1[n][0]:.3f} m at f{s1[n][1]}" for n in s0 if s1[n][0] - s0[n][0] > MAX_STEP_GROWTH]
    feet = ("foot.L", "foot.R")
    p0, p1 = pose_at_frames(rig, src, dur, feet), pose_at_frames(rig, ch, dur, feet)
    for n in p0:
        h = np.linalg.norm((p1[n] - p0[n])[:, [0, 2]], axis=1)
        if h.max() > MAX_ANKLE_SHIFT:
            bad.append(f"{n} ankle moved {h.max():.3f} m across the floor at f{int(np.argmax(h))}")
    return "; ".join(bad) or None


def swing_spans(rig, src, thigh, shin, foot, shin_keys, times, lift):
    """per frame, 1 where the leg must swing: each lifted span is solved one way, so no key jumps between the two"""
    out = np.zeros(len(times))
    i = 0
    while i < len(times):
        if lift[i] <= 0:
            i += 1
            continue
        j = i
        while j + 1 < len(times) and lift[j + 1] > 0:
            j += 1
        # the shin's bend moves linearly between its own keys: can that carry this lift? (a long key gap over a hold can)
        sk = np.r_[shin_keys, times[0], times[-1]]
        sk = np.unique(sk)
        swing = float(np.abs(lift - np.interp(times, sk, np.interp(sk, times, lift)))[max(0, i - 3):j + 4].max()) > 0.015
        for t in times[i:j + 1]:
            w0 = rig.pose(src, float(t))
            H0, K0, A0 = w0[thigh][:3, 3], w0[shin][:3, 3], w0[foot][:3, 3]
            u0 = (A0 - H0) / np.linalg.norm(A0 - H0)
            swing = swing or float(np.linalg.norm((K0 - H0) - ((K0 - H0) @ u0) * u0)) < 0.02
        out[i:j + 1] = 1.0 if swing else 0.0
        i = j + 1
    return out


def leg_fix(body, ch, side, target, src):
    """the ankle rises until foot and toe clear `target`, the foot keeps its world rotation. False if a track is missing.
    Two-bone IK with the knee on the side it has in the source pose `src`. Where the knee cannot bend (the source leg is
    straight: no side to keep; or the shin's keys are too thin to carry the lift's curve, so its bend lands on the wrong
    frames while the thigh's per-frame keys assume it: that flipped Ervet's dash leg), the thigh alone swings the leg up"""
    rig = body.rig
    thigh, shin, foot = (rig.name[f"{b}.{side}"] for b in ("thigh", "shin", "foot"))
    tr = {b: next((c for c in ch if c[0] == b and c[1] == "rotation"), None) for b in (thigh, shin, foot)}
    if any(v is None for v in tr.values()):
        return False
    sub = list(subtree(rig, foot))
    dur = max(float(c[2][-1]) for c in ch)
    times = frame_times(dur)
    lift = np.zeros(len(times))
    for i, t in enumerate(times):
        P, D = body.verts(rig.pose(ch, float(t)))
        P = P[np.isin(D, sub)]
        if len(P):
            lift[i] = max(0.0, target - float(P[:, 1].min()))
    lift = feathered(lift)
    if lift.max() <= 0:
        return True
    swing = swing_spans(rig, src, thigh, shin, foot, tr[shin][2], times, lift)
    new = {}
    for b, c in tr.items():
        out = c[3].copy()
        for k, t in enumerate(c[2]):
            d = float(np.interp(float(t), times, lift))
            if d <= 0:
                continue
            w = rig.pose(ch, float(t))
            H, K, A = w[thigh][:3, 3], w[shin][:3, 3], w[foot][:3, 3]
            Rp, Rt, Rs, Rf = (rot_only(w[x]) for x in (rig.parent[thigh], thigh, shin, foot))
            if float(np.interp(float(t), times, swing)) > 0.5:
                a = A - H
                r = float(np.linalg.norm(a))
                ang = math.acos(max(-1.0, min(1.0, a[1] / r))) - math.acos(max(-1.0, min(0.999, (a[1] + d) / r)))
                ax = np.cross(a, (0.0, 1.0, 0.0))
                n = float(np.linalg.norm(ax))
                R = rot_matrix(ax / n * ang) if n > 1e-6 and ang > 0 else np.eye(3)
                Rt2, Rs2 = R @ Rt, R @ Rs
            else:
                w0 = rig.pose(src, float(t))
                H0, K0, A0 = w0[thigh][:3, 3], w0[shin][:3, 3], w0[foot][:3, 3]
                A2 = A + np.array((0.0, d, 0.0))
                l1, l2 = float(np.linalg.norm(K - H)), float(np.linalg.norm(A - K))
                D2 = min(float(np.linalg.norm(A2 - H)), (l1 + l2) * 0.999)
                u = (A2 - H) / np.linalg.norm(A2 - H)
                u0 = (A0 - H0) / np.linalg.norm(A0 - H0)
                v = (K0 - H0) - ((K0 - H0) @ u0) * u0    # the knee's side of the hip-ankle line, in the source pose
                v = v - (v @ u) * u
                vn = float(np.linalg.norm(v))
                v = v / vn if vn > 1e-6 else np.cross(u, (1.0, 0.0, 0.0))
                ca = (l1 * l1 + D2 * D2 - l2 * l2) / (2 * l1 * D2)
                K2 = H + l1 * (ca * u + math.sqrt(max(0.0, 1 - ca * ca)) * v)
                Rt2 = min_rot(K - H, K2 - H) @ Rt
                A_mid = K2 + min_rot(K - H, K2 - H) @ (A - K)
                Rs2 = min_rot(A_mid - K2, A2 - K2) @ min_rot(K - H, K2 - H) @ Rs
            if b == thigh:
                q = mat2quat(Rp.T @ Rt2)
            elif b == shin:
                q = mat2quat(Rt2.T @ Rs2)
            else:
                q = mat2quat(Rs2.T @ Rf)
            out[k] = q if q @ c[3][k] >= 0 else -q
        new[b] = out
    for b, c in tr.items():
        c[3][:] = new[b]
    return True


def hips_fix(body, ch, target):
    """the hips' translation track rises until the whole body clears `target`"""
    rig = body.rig
    hips = rig.name["hips"]
    c = next((x for x in ch if x[0] == hips and x[1] == "translation"), None)
    if c is None:
        return 0.0
    dur = max(float(x[2][-1]) for x in ch)
    times = frame_times(dur)
    lift = np.zeros(len(times))
    for i, t in enumerate(times):
        P, _ = body.verts(rig.pose(ch, float(t)))
        lift[i] = max(0.0, target - float(P[:, 1].min()))
    lift = feathered(lift)
    w = rig.pose(ch, 0.0)
    Mp = w[rig.parent[hips]] if hips in rig.parent else np.eye(4)
    dv = np.linalg.inv(Mp[:3, :3]) @ np.array((0.0, 1.0, 0.0))
    for k, t in enumerate(c[2]):
        c[3][k] = c[3][k] + dv * float(np.interp(float(t), times, lift))
    return float(lift.max())


def write_samples(rig, buf, ch_sampler_acc, vals):
    """the new samples into their accessor's own bytes (a track cannot leave a normalized accessor's range)"""
    js = rig.js
    a = js["accessors"][ch_sampler_acc]
    v = js["bufferViews"][a["bufferView"]]
    dt = np.dtype(CT[a["componentType"]])
    c = NC[a["type"]]
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", 0) or dt.itemsize * c
    scale = {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}.get(CT[a["componentType"]])
    for i, q in enumerate(vals):
        if a.get("normalized"):
            raw = np.round(np.clip(q, -1, 1) * scale).astype(dt)
        else:
            raw = np.asarray(q, dtype=dt)
        buf[start + i * stride:start + i * stride + dt.itemsize * c] = raw.tobytes()


def check_against(rig, old):
    worst, fails = (0.0, ""), 0
    for nm in rig.anims:
        if nm not in old.anims:
            continue
        s1, s0 = leg_steps(rig, *rig.clip(nm)), leg_steps(old, *old.clip(nm))
        for n in s1:
            g = s1[n][0] - s0[n][0]
            if g > worst[0]:
                worst = (g, f"{nm} {n} {s0[n][0]:.3f} -> {s1[n][0]:.3f} m at f{s1[n][1]}")
            if g > MAX_STEP_GROWTH:
                fails += 1
                print(f"  FAIL {nm:12s} {n:7s} step {s0[n][0]:.3f} -> {s1[n][0]:.3f} m at f{s1[n][1]}")
    print(f"  largest leg-step growth {worst[0]:+.3f} m ({worst[1] or 'none'}); {fails} over {MAX_STEP_GROWTH} m")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--clips", default="")
    ap.add_argument("--max-deg", type=float, default=45.0)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--check-against", default="", help="an earlier copy of this GLB: report leg-step growth, write nothing")
    a = ap.parse_args()
    rig = Rig(a.glb)
    if a.check_against:
        sys.exit(check_against(rig, Rig(a.check_against)))
    body = Body(rig)
    buf = bytearray(rig.buf)
    max_rad = math.radians(a.max_deg)
    names = [c for c in (a.clips.split(",") if a.clips else rig.anims) if c in rig.anims]
    refused = 0
    for nm in names:
        ch, dur = rig.clip(nm)
        low0 = lowest_over_frames(body, ch, dur)
        if low0[0] >= LIMIT:
            continue
        src = copy_channels(ch)
        rot_nodes = {c[0] for c in ch if c[1] == "rotation"}
        turned = {}
        low = low0
        target = LIMIT + HEADROOM
        touched, legs, hips_up = set(), set(), 0.0
        for _ in range(ROUNDS):
            if low[0] >= LIMIT:
                break
            dom = rig.nodes[low[2]].get("name", "")
            bones = carriers(rig, low[2], rot_nodes)
            if bones:
                for b in bones:
                    ang = solve_bone(body, ch, b, target, max_rad)
                    turned[b] = turned.get(b, 0.0) + ang    # composes with earlier rounds: an upper bound
                    touched.add((b, "rotation"))
            elif dom.startswith(("foot.", "toe.")) and nm != "death":
                side = dom[-1]
                if not leg_fix(body, ch, side, target, src):
                    break
                legs.add(side)
                for x in ("thigh", "shin", "foot"):
                    touched.add((rig.name[f"{x}.{side}"], "rotation"))
            elif nm == "death":
                hips_up += hips_fix(body, ch, target)
                touched.add((rig.name["hips"], "translation"))
            else:
                break
            nxt = lowest_over_frames(body, ch, dur)
            if nxt[0] <= low[0] + 1e-4 and nxt[2] == low[2]:
                target += 0.006     # thinned keys: the dip is between them, ask the keys for more
            low = nxt
        bad = leg_guard(rig, src, ch, dur)
        if bad:
            refused += 1
            print(f"  {nm:12s} REFUSED, left as it was: {bad}")
            continue
        sampler = {}
        for c in rig.anims[nm]["channels"]:
            sampler[(c["target"]["node"], c["target"]["path"])] = rig.anims[nm]["samplers"][c["sampler"]]["output"]
        for key in touched:
            tr = next(c for c in ch if (c[0], c[1]) == key)
            write_samples(rig, buf, sampler[key], tr[3])
        who = [f"{rig.nodes[b]['name']} {math.degrees(v):.1f} deg" for b, v in turned.items()]
        who += [f"leg.{x} IK" for x in sorted(legs)] + ([f"hips +{hips_up:.3f} m"] if hips_up else [])
        tag = "ok" if low[0] >= LIMIT else f"STILL BELOW on {rig.nodes[low[2]].get('name')}"
        print(f"  {nm:12s} {low0[0]:+.3f} m on {rig.nodes[low0[2]].get('name'):12s} -> {low[0]:+.3f} m at f{low[1]} ({tag}) | {', '.join(who) or 'no carrier'}")
    if a.dry:
        sys.exit(1 if refused else 0)
    b = open(a.glb, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    off = 20 + jl
    bl = struct.unpack_from("<I", b, off)[0]
    assert bl == len(buf)
    with open(a.glb, "wb") as f:
        f.write(b[:off + 8])
        f.write(bytes(buf))
        f.write(b[off + 8 + bl:])
    sys.exit(1 if refused else 0)


if __name__ == "__main__":
    main()
