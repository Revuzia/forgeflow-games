#!/usr/bin/env python3
"""Measure baked secondary-motion chains (x_<name>_1..n) in a shipped fighter GLB, without Blender.

    python3 art/tools/chain_motion.py art/out/fighters/ardit/ardit.glb --clip run --chain tabard_l --ref thigh.L
    python3 art/tools/chain_motion.py art/out/fighters/burdam/burdam.glb --clip run --chain coat_f --ref thigh.L --all

Per frame: each chain segment's angle from hanging straight down (deg, signed: + = toward the fighter's front,
root +Z), the reference bone's angle the same way (head -> its child's head), and a summary:
  seg1 max |angle|, the swing range (max - min) of every segment, and the LAG of seg1 behind the reference:
  the frame shift (0..n/2) that best correlates seg1's forward angle with the reference's earlier one (a loop clip
  is treated as periodic). The closing CW5 gate for Ardit's tabard: seg1 max <= 30 deg, lag >= 2 frames.
--all prints every frame. Pure python + numpy (glTF 2.0 binary; LINEAR / STEP samplers).
"""
import argparse
import json
import math
import struct
import sys

import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load(path):
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    js = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from("<I", b, off)[0]
    return js, b[off + 8:off + 8 + bl]


def accessor(js, buf, i):
    a = js["accessors"][i]
    v = js["bufferViews"][a["bufferView"]]
    dt = np.dtype(CT[a["componentType"]])
    n, c = a["count"], NC[a["type"]]
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", 0) or dt.itemsize * c
    raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (n - 1) + dt.itemsize * c, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, shape=(n, c * dt.itemsize), strides=(stride, 1)).copy()
    arr = out.view(dt).reshape(n, c).astype(np.float64)
    if a.get("normalized"):
        arr /= {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}[CT[a["componentType"]]]
    return arr


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        r = a + (b - a) * t
        return r / np.linalg.norm(r)
    th = math.acos(d)
    return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)


class Rig:
    def __init__(self, path):
        js, buf = load(path)
        self.js, self.buf = js, buf
        self.nodes = js["nodes"]
        self.name = {n.get("name", str(i)): i for i, n in enumerate(self.nodes)}
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get("children", []):
                self.parent[c] = i
        self.anims = {a["name"]: a for a in js.get("animations", [])}

    def rest_trs(self):
        out = {}
        for i, n in enumerate(self.nodes):
            out[i] = [np.array(n.get("translation", [0, 0, 0]), float), np.array(n.get("rotation", [0, 0, 0, 1]), float),
                      np.array(n.get("scale", [1, 1, 1]), float)]
        return out

    def clip(self, name):
        a = self.anims[name]
        ch = []
        dur = 0.0
        for c in a["channels"]:
            s = a["samplers"][c["sampler"]]
            t = accessor(self.js, self.buf, s["input"])[:, 0]
            v = accessor(self.js, self.buf, s["output"])
            ch.append((c["target"]["node"], c["target"]["path"], t, v, s.get("interpolation", "LINEAR")))
            dur = max(dur, float(t[-1]))
        return ch, dur

    def pose(self, ch, time):
        trs = self.rest_trs()
        for node, path, t, v, interp in ch:
            if path not in ("translation", "rotation", "scale"):
                continue
            k = int(np.searchsorted(t, time, side="right")) - 1
            if k < 0:
                val = v[0]
            elif k >= len(t) - 1:
                val = v[len(t) - 1]
            else:
                u = 0.0 if interp == "STEP" else (time - t[k]) / max(1e-9, t[k + 1] - t[k])
                val = slerp(v[k], v[k + 1], u) if path == "rotation" else v[k] + (v[k + 1] - v[k]) * u
            trs[node][{"translation": 0, "rotation": 1, "scale": 2}[path]] = np.array(val, float)
        world = {}

        def W(i):
            if i in world:
                return world[i]
            T, R, S = trs[i]
            M = np.eye(4)
            M[:3, :3] = qmat(R) * S
            M[:3, 3] = T
            if i in self.parent:
                M = W(self.parent[i]) @ M
            world[i] = M
            return M
        for i in range(len(self.nodes)):
            W(i)
        return world


def seg_angle(p0, p1, fwd):
    """deg from hanging straight down (-Y), + when the lower end swings toward fwd"""
    d = p1 - p0
    n = np.linalg.norm(d)
    if n < 1e-9:
        return 0.0
    a = math.degrees(math.acos(max(-1.0, min(1.0, -d[1] / n))))
    return a if np.dot(d, fwd) >= 0 else -a


def child_of(rig, i):
    ch = rig.nodes[i].get("children", [])
    return ch[0] if ch else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--clip", default="run")
    ap.add_argument("--chain", action="append", required=True, help="chain name: x_<chain>_1..n")
    ap.add_argument("--ref", default=None, help="reference bone (its head -> its first child's head)")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    rig = Rig(a.glb)
    ch, dur = rig.clip(a.clip)
    nf = int(round(dur * a.fps))
    loop = a.clip in ("run", "idle", "idle_lobby", "channel", "stunned")
    print(f"# {a.glb} clip {a.clip} {dur:.3f} s {nf} frames (loop={loop})")
    root = rig.name.get("root")
    rows = []
    for ci in a.chain:
        js = []
        k = 1
        while f"x_{ci}_{k}" in rig.name:
            js.append(rig.name[f"x_{ci}_{k}"])
            k += 1
        if not js:
            sys.exit(f"no chain x_{ci}_1 in {a.glb}")
        tip = child_of(rig, js[-1])
        segs, ref = [], []
        for f in range(nf + (0 if loop else 1)):
            W = rig.pose(ch, f / a.fps)
            R = W[root][:3, :3] if root is not None else np.eye(3)
            fwd = R @ np.array([0.0, 0.0, 1.0])
            pts = [W[j][:3, 3] for j in js]
            if tip is not None:
                pts.append(W[tip][:3, 3])
            else:      # no tail node: extend the last bone along its own +Y by the previous segment's length
                L = np.linalg.norm(pts[-1] - pts[-2]) if len(pts) > 1 else 0.2
                pts.append(pts[-1] + W[js[-1]][:3, 1] / np.linalg.norm(W[js[-1]][:3, 1]) * L)
            segs.append([seg_angle(pts[s], pts[s + 1], fwd) for s in range(len(pts) - 1)])
            if a.ref:
                r = rig.name[a.ref]
                c = child_of(rig, r)
                ref.append(seg_angle(W[r][:3, 3], W[c][:3, 3], fwd))
        S = np.array(segs)
        print(f"chain {ci}: {len(js)} bones, {S.shape[1]} segments")
        if a.all:
            for f, s in enumerate(segs):
                print(f"  f{f:3d} " + " ".join(f"{x:+6.1f}" for x in s) + (f" | ref {ref[f]:+6.1f}" if ref else ""))
        print(f"  seg1 max |deg| {np.abs(S[:, 0]).max():.1f}  max fwd {S[:, 0].max():+.1f}")
        print("  swing range per segment (deg) " + " ".join(f"{S[:, s].max() - S[:, s].min():.1f}" for s in range(S.shape[1])))
        print("  max frame-to-frame step per segment (deg) " +
              " ".join(f"{np.abs(np.diff(S[:, s])).max():.1f}" for s in range(S.shape[1])))
        if ref:
            Rr = np.array(ref)
            x = S[:, 0] - S[:, 0].mean()
            y = Rr - Rr.mean()
            best, bl = -2.0, 0
            n = len(x)
            for lag in range(0, n // 2 + 1):
                if loop:
                    yy = np.roll(y, lag)
                    xx = x
                else:
                    if n - lag < 4:
                        break
                    yy, xx = y[:n - lag], x[lag:]
                d = np.linalg.norm(xx) * np.linalg.norm(yy)
                c = float(np.dot(xx, yy) / d) if d > 1e-9 else 0.0
                if c > best:
                    best, bl = c, lag
            pk_s, pk_r = int(np.argmax(S[:, 0])), int(np.argmax(Rr))
            print(f"  ref {a.ref}: max fwd {Rr.max():+.1f} at f{pk_r}; seg1 peak at f{pk_s}; "
                  f"peak lag {(pk_s - pk_r) % n if loop else pk_s - pk_r} f; xcorr lag {bl} f (r {best:.2f})")
        rows.append(S)


if __name__ == "__main__":
    main()
