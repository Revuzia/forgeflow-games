#!/usr/bin/env python3
"""retarget_clips_v3.py — WORLD-SPACE retarget of the 2026-07 Meshy library
clips onto the original hero rigs. v2's local rest-delta failed because the
two rig generations use different bone AXIS conventions; but both rigs pose
the SAME mesh, so world-space orientations are the shared truth:

  W_old_target(t) = W_new(t) · Cbone,  Cbone = W_new_rest⁻¹·W_old_rest (≈ I)
  local_old(t)    = W_oldparent(t)⁻¹ · W_old_target(t)   (solved top-down)
  Hips world translation copied with rest-height scaling; all other
  translation/scale tracks dropped (rest translations come from the old rig).

Clips are resampled uniformly at 30 fps and rebuilt as fresh clip-only GLBs.
Validation: world positions of key joints are compared old-vs-new per clip.
"""
import json
import struct
from pathlib import Path

import numpy as np
from pygltflib import GLTF2

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "asset_gen" / "meshy_v2_rigs"
DST = ROOT / "games" / "thronedrift" / "assets" / "chars" / "meshy"
FPS = 30

CT = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NC = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}

CLIPS = {
    "barbarian": ["idle", "walk", "run", "slash1", "slash2", "finisher", "hit", "death"],
    "knight": ["idle", "walk", "run", "slash1", "slash2", "finisher", "parry", "hit", "death"],
    "rogue": ["idle", "walk", "run", "slash1", "slash2", "finisher", "hit", "death"],
    "sorceress": ["idle", "walk", "run", "melee", "cast1", "cast2", "hit", "death"],
}
INSTALL_NAME = {"walk": "walk_arm.glb", "run": "run_arm.glb"}


def qmul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz], axis=-1)


def qinv(q):
    o = np.array(q, dtype=np.float64).copy()
    o[..., :3] *= -1
    return o


def qrot(q, v):
    qv = np.concatenate([v, np.zeros(v.shape[:-1] + (1,))], axis=-1)
    return qmul(qmul(q, qv), qinv(q))[..., :3]


def nlerp(q0, q1, t):
    d = np.sum(q0 * q1, axis=-1, keepdims=True)
    q1 = np.where(d < 0, -q1, q1)
    out = q0 * (1 - t) + q1 * t
    return out / np.linalg.norm(out, axis=-1, keepdims=True)


class Rig:
    def __init__(self, g):
        self.names = [n.name or f"n{i}" for i, n in enumerate(g.nodes)]
        self.index = {n: i for i, n in enumerate(self.names)}
        self.parent = {}
        for pi, n in enumerate(g.nodes):
            for c in (n.children or []):
                self.parent[c] = pi
        self.rest_r = {}
        self.rest_t = {}
        for i, n in enumerate(g.nodes):
            self.rest_r[i] = np.array(n.rotation if n.rotation else [0, 0, 0, 1], dtype=np.float64)
            self.rest_t[i] = np.array(n.translation if n.translation else [0, 0, 0], dtype=np.float64)
        # topological order (parents first)
        self.order = []
        seen = set()
        def visit(i):
            if i in seen: return
            p = self.parent.get(i)
            if p is not None: visit(p)
            seen.add(i); self.order.append(i)
        for i in range(len(g.nodes)): visit(i)

    def world_rest(self):
        wr, wt = {}, {}
        for i in self.order:
            p = self.parent.get(i)
            if p is None:
                wr[i], wt[i] = self.rest_r[i], self.rest_t[i]
            else:
                wr[i] = qmul(wr[p], self.rest_r[i])
                wt[i] = wt[p] + qrot(wr[p][None, :], self.rest_t[i][None, :])[0]
        return wr, wt


def acc_read(g, blob, ai):
    a = g.accessors[ai]; bv = g.bufferViews[a.bufferView]
    fmt, sz = CT[a.componentType]; n = NC[a.type]
    off = (bv.byteOffset or 0) + (a.byteOffset or 0)
    stride = bv.byteStride or sz * n
    return np.array([struct.unpack_from("<" + fmt * n, blob, off + i * stride) for i in range(a.count)])


def sample_tracks(g, blob, rig, times):
    """per-node local rotation (defaults rest) sampled at `times`; hips translation too."""
    N = len(rig.names)
    T = len(times)
    rot = {i: np.tile(rig.rest_r[i], (T, 1)) for i in range(N)}
    hips_i = rig.index.get("Hips")
    hips_t = np.tile(rig.rest_t[hips_i], (T, 1)) if hips_i is not None else None
    anim = g.animations[0]
    for ch in anim.channels:
        node = ch.target.node
        samp = anim.samplers[ch.sampler]
        tin = acc_read(g, blob, samp.input)[:, 0]
        vout = acc_read(g, blob, samp.output)
        if ch.target.path == "rotation":
            out = np.zeros((T, 4))
            for k, t in enumerate(times):
                j = np.searchsorted(tin, t, side="right") - 1
                j = max(0, min(j, len(tin) - 1))
                j2 = min(j + 1, len(tin) - 1)
                f = 0.0 if tin[j2] == tin[j] else (t - tin[j]) / (tin[j2] - tin[j])
                out[k] = nlerp(vout[j][None, :], vout[j2][None, :], f)[0]
            rot[node] = out
        elif ch.target.path == "translation" and node == hips_i:
            out = np.zeros((T, 3))
            for k, t in enumerate(times):
                j = np.searchsorted(tin, t, side="right") - 1
                j = max(0, min(j, len(tin) - 1))
                j2 = min(j + 1, len(tin) - 1)
                f = 0.0 if tin[j2] == tin[j] else (t - tin[j]) / (tin[j2] - tin[j])
                out[k] = vout[j] * (1 - f) + vout[j2] * f
            hips_t = out
    return rot, hips_t


def world_from_locals(rig, rot, hips_t, times):
    T = len(times)
    wr = {}
    wt = {}
    hips_i = rig.index.get("Hips")
    for i in rig.order:
        p = rig.parent.get(i)
        lt = np.tile(rig.rest_t[i], (T, 1))
        if i == hips_i and hips_t is not None:
            lt = hips_t
        if p is None:
            wr[i] = rot.get(i, np.tile(rig.rest_r[i], (T, 1)))
            wt[i] = lt
        else:
            wr[i] = qmul(wr[p], rot.get(i, np.tile(rig.rest_r[i], (T, 1))))
            wt[i] = wt[p] + qrot(wr[p], lt)
    return wr, wt


def build_clip_glb(path, rig_old, times, local_rot, hips_t, name):
    """fresh minimal clip-only GLB targeting the old rig's node names."""
    nodes = []
    for i, nm in enumerate(rig_old.names):
        nd = {"name": nm,
              "rotation": [float(x) for x in rig_old.rest_r[i]],
              "translation": [float(x) for x in rig_old.rest_t[i]]}
        ch = [c for c, p in rig_old.parent.items() if p == i]
        if ch: nd["children"] = ch
        nodes.append(nd)
    bin_ = bytearray()
    accs, bvs = [], []
    def push(arr, ctype, atype):
        arr = np.asarray(arr, dtype=np.float32)
        raw = arr.tobytes()
        bvs.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": len(raw)})
        bin_.extend(raw)
        while len(bin_) % 4: bin_.append(0)
        acc = {"bufferView": len(bvs) - 1, "componentType": 5126, "count": len(arr), "type": atype}
        if atype == "SCALAR":
            acc["min"] = [float(arr.min())]; acc["max"] = [float(arr.max())]
        accs.append(acc)
        return len(accs) - 1
    t_acc = push(times, 5126, "SCALAR")
    channels, samplers = [], []
    for i in rig_old.order:
        r_acc = push(local_rot[i], 5126, "VEC4")
        samplers.append({"input": t_acc, "output": r_acc, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": i, "path": "rotation"}})
    if hips_t is not None:
        h_acc = push(hips_t, 5126, "VEC3")
        samplers.append({"input": t_acc, "output": h_acc, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": rig_old.index["Hips"], "path": "translation"}})
    js = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [rig_old.order[0]]}],
          "nodes": nodes, "animations": [{"name": name, "channels": channels, "samplers": samplers}],
          "accessors": accs, "bufferViews": bvs, "buffers": [{"byteLength": len(bin_)}]}
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bytes(bin_))


def retarget(hero, clip):
    old_g = GLTF2().load_binary(str(DST / hero / "base.glb"))
    rig_old = Rig(old_g)
    src = SRC / hero / f"anim_{clip}.glb"
    g = GLTF2().load_binary(str(src)); blob = g.binary_blob()
    rig_new = Rig(g)
    dur = max(acc_read(g, blob, s.input)[:, 0].max() for s in g.animations[0].samplers)
    times = np.arange(0, dur + 1e-6, 1.0 / FPS)
    rot_new, hips_new_t = sample_tracks(g, blob, rig_new, times)
    wr_new, wt_new = world_from_locals(rig_new, rot_new, hips_new_t, times)
    wr_rest_old, wt_rest_old = rig_old.world_rest()
    wr_rest_new, wt_rest_new = rig_new.world_rest()
    # per-bone world correction (≈ identity when both rigs bind the same mesh)
    T = len(times)
    local_old = {}
    wr_old = {}
    name2new = rig_new.index
    hips_scale = (abs(wt_rest_old[rig_old.index["Hips"]][1]) or 1) / (abs(wt_rest_new[name2new["Hips"]][1]) or 1)
    for i in rig_old.order:
        nm = rig_old.names[i]
        j = name2new.get(nm)
        if j is None:
            wr_old[i] = np.tile(wr_rest_old[i], (T, 1))
            local_old[i] = np.tile(rig_old.rest_r[i], (T, 1))
            continue
        C = qmul(qinv(wr_rest_new[j][None, :]), wr_rest_old[i][None, :])
        w_target = qmul(wr_new[j], np.tile(C, (T, 1)))
        p = rig_old.parent.get(i)
        if p is None:
            local_old[i] = w_target
        else:
            local_old[i] = qmul(qinv(wr_old[p]), w_target)
        local_old[i] /= np.linalg.norm(local_old[i], axis=-1, keepdims=True)
        wr_old[i] = w_target
    hips_t_old = None
    if hips_new_t is not None:
        j = name2new["Hips"]
        i = rig_old.index["Hips"]
        hips_t_old = wt_rest_old[i][None, :] + (hips_new_t - wt_rest_new[j][None, :]) * hips_scale
    out = DST / hero / INSTALL_NAME.get(clip, f"anim_{clip}.glb")
    build_clip_glb(out, rig_old, times, local_old, hips_t_old, {"walk": "Walk", "run": "Run", "idle": "Idle"}.get(clip, clip))
    # numeric validation: wrist world position old-vs-new at mid-clip
    wr_o, wt_o = world_from_locals(rig_old, local_old, hips_t_old, times)
    mid = T // 2
    errs = []
    for nm in ("RightHand", "LeftHand", "Head"):
        io, jn = rig_old.index.get(nm), name2new.get(nm)
        if io is None or jn is None: continue
        errs.append(np.linalg.norm(wt_o[io][mid] - wt_new[jn][mid]))
    return max(errs) if errs else -1


def main():
    worst = 0
    for hero, clips in CLIPS.items():
        for c in clips:
            e = retarget(hero, c)
            worst = max(worst, e)
            print(f"[{hero}/{c}] world-retargeted, joint err {e:.3f}")
    print(f"WORST joint error: {worst:.3f} (units; <0.15 is visually identical)")


if __name__ == "__main__":
    main()
