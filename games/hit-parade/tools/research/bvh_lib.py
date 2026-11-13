"""Minimal numpy BVH reader + forward kinematics for the CMU (Hahne) BVH set.

Pure numpy, no Blender needed (Blender's bundled Python has numpy too, so the
retarget script imports this same module).

Coordinates: BVH files are Y-up, subject faces +Z at rest, units = CMU ASF
units (1 unit = 1/0.45 inch). `to_blender()` converts to Blender Z-up metres:
    (x, y, z)_bvh -> (x, -z, y)_blender * SCALE
so the subject faces -Y at rest (same as a Mixamo FBX after Blender import),
left = +X, up = +Z.
"""
import numpy as np

SCALE_M = 0.0254 / 0.45  # CMU ASF length unit -> metres
A_BVH2BL = np.array([[1.0, 0.0, 0.0],
                     [0.0, 0.0, -1.0],
                     [0.0, 1.0, 0.0]])


class Joint(object):
    __slots__ = ("name", "parent", "offset", "channels", "is_end", "index")

    def __init__(self, name, parent, index):
        self.name = name
        self.parent = parent
        self.offset = np.zeros(3)
        self.channels = []
        self.is_end = False
        self.index = index


class BVH(object):
    def __init__(self, path):
        self.path = path
        self.joints = []
        self.by_name = {}
        self.frame_time = 1.0 / 120.0
        self.data = None
        self._parse(path)

    @property
    def fps(self):
        return 1.0 / self.frame_time

    @property
    def n_frames(self):
        return self.data.shape[0]

    def _parse(self, path):
        with open(path, "r") as fh:
            text = fh.read()
        head, motion = text.split("MOTION", 1)
        toks = head.split()
        i = 0
        stack = []
        cur = None
        end_count = 0
        while i < len(toks):
            t = toks[i]
            if t in ("ROOT", "JOINT"):
                name = toks[i + 1]
                parent = stack[-1] if stack else None
                j = Joint(name, parent, len(self.joints))
                self.joints.append(j)
                self.by_name[name] = j
                cur = j
                i += 2
            elif t == "End":
                parent = stack[-1]
                end_count += 1
                j = Joint(parent.name + "_End", parent, len(self.joints))
                j.is_end = True
                self.joints.append(j)
                self.by_name[j.name] = j
                cur = j
                i += 2
            elif t == "{":
                stack.append(cur)
                i += 1
            elif t == "}":
                stack.pop()
                i += 1
            elif t == "OFFSET":
                cur.offset = np.array([float(toks[i + 1]), float(toks[i + 2]), float(toks[i + 3])])
                i += 4
            elif t == "CHANNELS":
                n = int(toks[i + 1])
                cur.channels = toks[i + 2:i + 2 + n]
                i += 2 + n
            else:
                i += 1
        lines = motion.strip().splitlines()
        nf = int(lines[0].split(":")[1])
        self.frame_time = float(lines[1].split(":")[1])
        rows = [l for l in lines[2:] if l.strip()]
        arr = np.array([np.array(r.split(), dtype=np.float64) for r in rows[:nf]])
        self.data = arr
        # channel column index per joint
        col = 0
        self.col = {}
        for j in self.joints:
            self.col[j.name] = col
            col += len(j.channels)

    def fk(self, frames=None):
        """Return (pos, rot, names): pos (F,J,3), rot (F,J,3,3) in BVH space.
        End sites are included as joints (rot = parent's rot)."""
        data = self.data if frames is None else self.data[frames]
        F = data.shape[0]
        J = len(self.joints)
        pos = np.zeros((F, J, 3))
        rot = np.zeros((F, J, 3, 3))
        for j in self.joints:
            local = np.tile(np.eye(3), (F, 1, 1))
            trans = np.zeros((F, 3))
            c0 = self.col[j.name]
            for k, ch in enumerate(j.channels):
                v = data[:, c0 + k]
                if ch.endswith("position"):
                    trans[:, "XYZ".index(ch[0])] = v
                else:
                    local = local @ _axis_rot(ch[0], np.radians(v))
            if j.parent is None:
                pos[:, j.index] = trans + j.offset
                rot[:, j.index] = local
            else:
                p = j.parent.index
                pos[:, j.index] = pos[:, p] + np.einsum("fij,j->fi", rot[:, p], j.offset)
                rot[:, j.index] = rot[:, p] @ local
        return pos, rot, [j.name for j in self.joints]

    def rest_positions(self):
        """Joint positions with every rotation zeroed (the BVH bind pose)."""
        J = len(self.joints)
        pos = np.zeros((J, 3))
        for j in self.joints:
            if j.parent is None:
                pos[j.index] = j.offset
            else:
                pos[j.index] = pos[j.parent.index] + j.offset
        return pos


def _axis_rot(axis, ang):
    c = np.cos(ang)
    s = np.sin(ang)
    F = ang.shape[0]
    m = np.zeros((F, 3, 3))
    if axis == "X":
        m[:, 0, 0] = 1
        m[:, 1, 1] = c
        m[:, 1, 2] = -s
        m[:, 2, 1] = s
        m[:, 2, 2] = c
    elif axis == "Y":
        m[:, 1, 1] = 1
        m[:, 0, 0] = c
        m[:, 0, 2] = s
        m[:, 2, 0] = -s
        m[:, 2, 2] = c
    else:
        m[:, 2, 2] = 1
        m[:, 0, 0] = c
        m[:, 0, 1] = -s
        m[:, 1, 0] = s
        m[:, 1, 1] = c
    return m


def to_blender(pos, rot=None):
    """BVH Y-up units -> Blender Z-up metres."""
    p = np.einsum("ij,...j->...i", A_BVH2BL, pos) * SCALE_M
    if rot is None:
        return p
    r = np.einsum("ij,...jk,lk->...il", A_BVH2BL, rot, A_BVH2BL)
    return p, r


def load_blender(path, frames=None):
    """Convenience: parse + FK + convert. Returns dict."""
    b = BVH(path)
    pos, rot, names = b.fk(frames)
    p, r = to_blender(pos, rot)
    rest = to_blender(b.rest_positions())
    return {"bvh": b, "pos": p, "rot": r, "names": names,
            "idx": {n: i for i, n in enumerate(names)}, "rest": rest, "fps": b.fps}
