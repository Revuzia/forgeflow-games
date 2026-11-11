"""Card-only hands (cards pass 4, the owner's "fix anything not fixed": verify 1 and 2 kept finding a blocky mitten on
Kemdo and four stacked sausage blocks on Sukri in the cards' focal area; a hand-only xAI repaint did not beat the render).

At card render time (render.fighter_renders, painted-plate fighters listed in HANDS below) every game hand is swapped
for a higher-detail CARD hand built here:

  * the sculpt: an anatomical fist / open hand on the fighter's own hand frame (C the centre of the fingers' curl, the
    shaft axis for a grip; a the knuckle line pinky -> index; f wrist -> knuckles; out the back of the hand): a palm
    block and a dorsal dome with four metacarpal ridges, four fingers in three phalanges (proximal / middle / distal on
    a curl through the fighter's own knuckle, middle-joint and tip points) with a hard union between neighbours (the
    finger breaks), MCP knuckle bumps and PIP joint bumps, a two-segment thumb over a thenar pad, the glove's cuff;
    meshed by sdf surface nets at 1.2 mm (the game hands are 450-680 triangles; a card hand is ~20-40 k);
  * the fit: the sculpt lives in the fighter's sculpt space. The game hand in the cached rig may have been re-posed
    after the bake (Kemdo's right fist is turned 62 degrees about the wrist), so the transform sculpt -> rest is
    measured, not assumed: an ICP of the cached bake source (<part>_high) onto the game hand's vertices (rigid, from the
    identity and the principal-axis starts; mean residual logged, a bad fit keeps the game hand);
  * the skin: the card hand takes the game hand's material and its UVs (a Data Transfer from the game hand's faces,
    nearest face, interpolated), so each skin's glove colour and baked paint carry over; the material copy drops a
    normal map (the low mesh's baked normals belong to the low mesh);
  * the bind: rigid on the bone the game hand is weighted to (an Armature modifier on a weight-1 group), so every clip
    and card pose moves it exactly as the game hand; the game hand is hidden by a Mask modifier on a "card_hide" group.

Everything is undone after the card renders (remove()). The GLB, the clips and the in-game model are untouched; this
module runs only inside the card render. Kemdo's hands are new sculpts (the game's are a box with four capsules: a
mitten); Sukri's follow his own glove's points (sukri.finger_pts / fist frames) with the phalanges and breaks added.
"""
from __future__ import annotations

import math

import bpy
import numpy as np

from .hifi import sdf
from .hifi.sdf import Capsule, Ellipsoid, FlatCapsule, RoundBox, Sculpt, Sphere, Tube

VOXEL = 0.0012
FIT_MAX = 0.006          # m: the ICP's mean residual above which the card keeps the game hand


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) + 1e-12)


def frame(C, a, f, out):
    C, a, f, out = (np.asarray(x, float) for x in (C, a, f, out))
    a = unit(a)
    f = unit(f - a * f.dot(a))
    out = unit(out - a * out.dot(a) - f * out.dot(f))
    return C, a, f, out


def _bez(K, M, T, u):
    Q = 2.0 * M - 0.5 * (K + T)          # the quadratic through K (u 0), M (u 0.5) and T (u 1)
    return (1 - u) ** 2 * K + 2 * (1 - u) * u * Q + u * u * T


def hand(name, C, a, f, out, s, curl=1.0, grip_r=None, filled=True, relaxed=False, fat=1.0, cuff=True,
         spacing=0.0245, knuckle_line=None):
    """An anatomical gloved hand (see the module doc). s scales the hand (Sukri's HS 1.55 = his 15 cm fist); fat
    thickens the fingers; grip_r carves the shaft channel round the a axis through C; curl 1 = a fist, 0.12 = open."""
    C, a, f, out = frame(C, a, f, out)
    S = Sculpt(name)
    ax = np.stack([a, f, out])
    o = 1.0 - curl
    # palm block and the back of the hand
    S.add(RoundBox(C - f * 0.034 * s + out * 0.009 * s, (0.045 * s, 0.040 * s, 0.020 * s), 0.015 * s, axes=ax), k=0.0)
    S.add(Ellipsoid(C - f * 0.034 * s + out * 0.022 * s, (0.041 * s, 0.040 * s, 0.011 * s), axes=ax), k=0.010 * s)
    for i in range(4):                                     # metacarpal ridges (tendons under the leather)
        sp = (i - 1.5) * spacing * s
        S.add(Capsule(C - f * 0.062 * s + out * 0.029 * s + a * sp * 0.55, C - f * 0.006 * s + out * 0.027 * s + a * sp,
                      0.0042 * s), k=0.006 * s)
    fingers = Sculpt(name + "_f")
    for i in range(4):                                     # 0 pinky .. 3 index
        sp = (i - 1.5) * spacing * s
        rr = (0.0110 if i else 0.0098) * s ** 0.85 * fat * (1.06 if relaxed else 1.0)
        ln = (0.86, 1.0, 1.06, 1.0)[i]                     # ring / middle a little longer, the pinky short
        K = C + f * 0.006 * s + out * 0.026 * s + a * sp
        M = C + f * (0.040 + 0.016 * o) * s * ln + out * (0.004 + 0.020 * o) * s + a * sp
        T = C + f * (0.026 + 0.050 * o) * s * ln - out * (0.026 - 0.040 * o) * s * ln + a * sp
        if relaxed:
            spread = a * ((i - 1.5) * 0.0030 * s)
            M, T = M + spread, T + spread * 1.4
        P = _bez(K, M, T, 0.44)                            # PIP
        D = _bez(K, M, T, 0.76)                            # DIP
        if grip_r is not None:                             # keep every joint clear of the shaft
            for nm in ("P", "D", "T"):
                X = {"P": P, "D": D, "T": T}[nm]
                r = X - C - a * (X - C).dot(a)
                rl = np.linalg.norm(r)
                need = grip_r + rr * 0.92
                if rl < need:
                    X = X + unit(r) * (need - rl)
                if nm == "P":
                    P = X
                elif nm == "D":
                    D = X
                else:
                    T = X
        fs = Sculpt(f"{name}_f{i}")
        fs.add(Tube([K, P], [rr * 1.08, rr * 1.0], k=0.0), k=0.0)
        fs.add(Tube([P, D], [rr * 0.97, rr * 0.92], k=0.0), k=0.0012 * s)
        fs.add(Tube([D, T], [rr * 0.89, rr * 0.80], k=0.0), k=0.0010 * s)
        fs.add(Sphere(K + out * 0.006 * s, rr * 1.12), k=0.003 * s)                     # MCP knuckle
        fs.add(Sphere(P + unit(P - C - a * (P - C).dot(a)) * 0.0028 * s, rr * 0.98), k=0.0016 * s)   # PIP bump
        fs.add(Sphere(D + unit(D - C - a * (D - C).dot(a)) * 0.0018 * s, rr * 0.88), k=0.0012 * s)   # DIP
        for op, prim, k, tg in fs.ops:
            fingers.ops.append((op, prim, k, tg))
    # the four fingers: one hard union among themselves (the breaks), a small blend into the palm
    S.add(_Union(fingers), k=0.0035 * s)
    # the thumb: a thenar pad, then two segments over the front of the grip (Sukri's thumb points)
    tb = C - f * 0.034 * s - out * 0.018 * s + a * 0.046 * s
    tm = C + f * 0.006 * s - out * (0.034 - 0.006 * o) * s + a * (0.050 + 0.004 * o) * s
    tt = C + f * (0.040 + 0.010 * o) * s - out * (0.016 + 0.004 * o) * s + a * (0.034 + 0.010 * o) * s
    if grip_r is not None:
        for X in (tm, tt):
            r = X - C - a * (X - C).dot(a)
            rl = np.linalg.norm(r)
            if rl < grip_r + 0.011 * s:
                X += unit(r) * (grip_r + 0.011 * s - rl)
    S.add(Ellipsoid(C - f * 0.040 * s - out * 0.006 * s + a * 0.034 * s, (0.020 * s, 0.028 * s, 0.016 * s), axes=ax),
          k=0.008 * s)
    S.add(Tube([tb, tm], [0.0158 * s * fat, 0.0136 * s * fat], k=0.0), k=0.006 * s)
    S.add(Tube([tm, tt], [0.0128 * s * fat, 0.0104 * s * fat], k=0.0), k=0.0012 * s)
    S.add(Sphere(tm + unit(tm - C - a * (tm - C).dot(a)) * 0.002 * s, 0.0134 * s * fat), k=0.0015 * s)
    if cuff:
        S.add(FlatCapsule(C - f * 0.110 * s, C - f * 0.052 * s, 0.036 * s, 0.026 * s, 0.041 * s, 0.028 * s, side=a),
              k=0.012 * s)
    if grip_r is not None:
        S.sub(Capsule(C - a * 0.15, C + a * 0.15, grip_r), k=0.002)
    elif filled:
        S.add(Ellipsoid(C + f * 0.010 * s - out * 0.002 * s, (0.044 * s, 0.024 * s, 0.022 * s), axes=ax), k=0.006 * s)
    return S


class _Union(sdf.Prim):
    """A Sculpt's add ops as one primitive (hard union at each op's own k): the fingers blend into the palm as one."""

    def __init__(self, sc: Sculpt):
        self.sc = sc

    def bounds(self):
        return self.sc.bounds()

    def d(self, P):
        d = None
        for op, prim, k, _ in self.sc.ops:
            di = prim.d(P)
            d = di if d is None else (np.minimum(d, di) if k <= 0 else sdf.smin(d, di, k))
        return d


# ── per-fighter card hands: {part name: Sculpt} in the fighter's sculpt space ─────────────────────────────────────
def _kemdo(spec) -> dict:
    out = {}
    _, wr_r = spec.right_arm_points()
    e1 = np.asarray(spec.AXU, float)
    hd = np.asarray(spec.GRIP, float) - wr_r
    e2 = unit(hd - e1 * hd.dot(e1))
    e3 = np.cross(e1, e2)
    # the right fist round the flat blade-haft under the round haft (index and thumb up toward the lens)
    out["hand_R"] = hand("card_hand_R", spec.GRIP - e2 * 0.004, e1, e2, -e3, 1.32, curl=1.0, grip_r=0.029, fat=1.12, cuff=False)
    lc = np.array([0.322, -0.03, 0.985])
    R = sdf.rot_x(-8)
    # the hanging left fist: knuckles to the front, the back of the hand out (+x), thumb on top (kemdo.sculpts' hand_L)
    out["hand_L"] = hand("card_hand_L", lc + R @ np.array([0.0, 0.012, 0.0]), R @ np.array([0, 0, 1.0]),
                         R @ np.array([0, -1.0, 0]), np.array([1.0, 0, 0]), 1.26, curl=1.0, filled=True, fat=1.12, cuff=False)
    return out


def _sukri(spec) -> dict:
    s = float(spec.HS)
    C, a, f, o = spec.HAND_R_FRAME
    out = {"hand_R": hand("card_hand_R", C, a, f, o, s, curl=1.0, grip_r=float(spec.SHAFT_R) + 0.004)}
    C, a, f, o = spec.HAND_L_FRAME
    out["hand_L"] = hand("card_hand_L", C, a, f, o, s, curl=float(spec.LEFT_CURL), filled=True)
    out["hand_L_open"] = hand("card_hand_L_open", C, a, f, o, s, curl=float(spec.OPEN_CURL), relaxed=True,
                              filled=False)
    return out


HANDS = {"kemdo": _kemdo, "sukri": _sukri}


# ── install / remove ─────────────────────────────────────────────────────────────────────────────────────────────
def _world(o) -> np.ndarray:
    n = len(o.data.vertices)
    co = np.empty(n * 3)
    o.data.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    M = np.array(o.matrix_world)
    return co @ M[:3, :3].T + M[:3, 3]


def _nn(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """for each src point the index of its nearest dst point (chunked brute force)"""
    out = np.empty(len(src), dtype=np.int64)
    for i in range(0, len(src), 512):
        d = ((src[i:i + 512, None, :] - dst[None]) ** 2).sum(-1)
        out[i:i + 512] = d.argmin(1)
    return out


def _kabsch(A, B):
    ca, cb = A.mean(0), B.mean(0)
    H = (A - ca).T @ (B - cb)
    U, _, Vt = np.linalg.svd(H)
    dd = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, dd]) @ U.T
    return R, cb - R @ ca


def fit(high: np.ndarray, low: np.ndarray) -> tuple:
    """rigid (R, t) taking the sculpt-space bake source onto the game hand's rest vertices; mean residual (m)"""
    rng = np.random.default_rng(0)
    H = high[rng.choice(len(high), min(len(high), 3000), replace=False)]
    starts = [(np.eye(3), np.zeros(3))]
    ch, cl = H.mean(0), low.mean(0)
    _, _, Vh = np.linalg.svd(H - ch, full_matrices=False)
    _, _, Vl = np.linalg.svd(low - cl, full_matrices=False)
    for sx in (1, -1):
        for sy in (1, -1):
            D = np.diag([sx, sy, sx * sy])
            R0 = Vl.T @ D @ Vh
            if np.linalg.det(R0) > 0:
                starts.append((R0, cl - R0 @ ch))
    for axis in range(3):                # a part re-posed after the bake (Kemdo's right fist: 62 deg about the wrist)
        for deg in (-90, -75, -60, -45, -30, 30, 45, 60, 75, 90):
            Ra = [sdf.rot_x, sdf.rot_y, sdf.rot_z][axis](deg)
            starts.append((Ra, cl - Ra @ ch))
    best = None
    for R, t in starts:
        for _ in range(40):
            HT = H @ R.T + t
            j = _nn(low, HT)
            R2, t2 = _kabsch(H[j], low)
            R, t = R2, t2
        HT = H @ R.T + t
        err = float(np.sqrt(((HT[_nn(low, HT)] - low) ** 2).sum(-1)).mean())
        if best is None or err < best[2]:
            best = (R, t, err)
    return best


def _part_mask(o, names: list, part: str, base_pts: np.ndarray | None) -> np.ndarray | None:
    me = o.data
    a = me.attributes.get("vale_part")
    n = len(me.vertices)
    if a is not None and a.domain == "POINT" and part in names:
        pv = np.empty(n, dtype=np.int64)
        a.data.foreach_get("value", pv)
        return pv == names.index(part)
    if base_pts is None or not len(base_pts):
        return None
    P = _world(o)                    # a skin mesh (no part ids): the vertices on the base game hand (rest)
    lo, hi = base_pts.min(0) - 0.01, base_pts.max(0) + 0.01
    cand = np.nonzero(np.all((P >= lo) & (P <= hi), axis=1))[0]
    m = np.zeros(n, dtype=bool)
    if len(cand):
        j = _nn(P[cand], base_pts)
        d = np.linalg.norm(P[cand] - base_pts[j], axis=1)
        m[cand[d < 0.004]] = True
    return m


def _bone_of(o, mask: np.ndarray) -> str | None:
    w = {}
    for v in np.nonzero(mask)[0][:400]:
        for g in o.data.vertices[int(v)].groups:
            nm = o.vertex_groups[g.group].name
            w[nm] = w.get(nm, 0.0) + g.weight
    return max(w, key=w.get) if w else None


def install(spec, arm, objs, log=print) -> list:
    """Swap the hands of the meshes in `objs` for card hands; returns the undo list for remove()."""
    fid = getattr(spec, "ID", "")
    if fid not in HANDS:
        return []
    names = [it[0] for it in spec.sculpts()]
    sculpts = HANDS[fid](spec)
    base = next((o for o in bpy.data.objects if o.type == "MESH" and o.name == fid and o.data.attributes.get("vale_part")),
                None)
    undo = []
    for part, S in sculpts.items():
        high = bpy.data.objects.get(f"{part}_high")
        if base is None or high is None:
            log(f"card hands {fid} {part}: no cached game hand / bake source; kept the game hand")
            continue
        bmask = _part_mask(base, names, part, None)
        if bmask is None or bmask.sum() < 20:
            continue
        base_pts = _world(base)[bmask]
        R, t, err = fit(_world(high), base_pts)
        if err > FIT_MAX:
            log(f"card hands {fid} {part}: fit residual {err * 1000:.1f} mm > {FIT_MAX * 1000:.0f} mm; kept the game hand")
            continue
        v, q = S.mesh(VOXEL)
        Mh = np.array(high.matrix_world)
        v = v @ Mh[:3, :3].T + Mh[:3, 3]          # the sculpt space is the bake source's world
        v = v @ R.T + t                            # -> the rig's rest
        for o in objs:
            if o.type != "MESH" or o.name.endswith("_accent"):
                continue
            m = _part_mask(o, names, part, base_pts)
            if m is None or m.sum() < 20:
                continue
            bone = _bone_of(o, m)
            if bone is None:
                continue
            # the UV source: the game hand's faces alone, at rest
            src_me = o.data.copy()
            src = bpy.data.objects.new(f"card_hand_src_{part}", src_me)
            bpy.context.scene.collection.objects.link(src)
            src.matrix_world = o.matrix_world.copy()
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(src_me)
            bm.verts.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[bm.verts[i] for i in range(len(bm.verts)) if not m[i]], context="VERTS")
            bm.to_mesh(src_me)
            bm.free()
            src.hide_render = True
            # material: the faces' own, without the low mesh's normal map
            pm = np.empty(len(o.data.polygons), dtype=np.int64)
            o.data.polygons.foreach_get("material_index", pm)
            vi = np.empty(len(o.data.loops), dtype=np.int64)
            o.data.loops.foreach_get("vertex_index", vi)
            ls = np.empty(len(o.data.polygons), dtype=np.int64)
            o.data.polygons.foreach_get("loop_start", ls)
            hand_polys = m[vi[ls]]
            mi = int(np.bincount(pm[hand_polys]).argmax()) if hand_polys.any() else 0
            mat = o.data.materials[mi].copy() if len(o.data.materials) else None
            if mat is not None and mat.use_nodes:
                for lk in list(mat.node_tree.links):
                    if lk.from_node.type == "NORMAL_MAP" and lk.to_socket.name == "Normal":
                        mat.node_tree.links.remove(lk)
            Mo = np.array(o.matrix_world)
            vl = (v - Mo[:3, 3]) @ np.linalg.inv(Mo[:3, :3]).T
            me = sdf.to_mesh(f"card_{part}_{o.name}", vl, q)
            me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), dtype=bool))
            ob = bpy.data.objects.new(f"card_{part}_{o.name}", me)
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = o.parent
            ob.matrix_world = o.matrix_world.copy()
            if mat is not None:
                me.materials.append(mat)
            uvn = o.data.uv_layers.active.name if o.data.uv_layers.active else "UVMap"
            me.uv_layers.new(name=uvn)
            g = ob.vertex_groups.new(name=bone)
            g.add(list(range(len(me.vertices))), 1.0, "REPLACE")
            dt = ob.modifiers.new("card_uv", "DATA_TRANSFER")
            dt.object = src
            dt.use_object_transform = True
            dt.use_loop_data = True
            dt.data_types_loops = {"UV"}
            dt.loop_mapping = "POLYINTERP_NEAREST"
            am = ob.modifiers.new("card_arm", "ARMATURE")
            am.object = arm
            hide = o.vertex_groups.get("card_hide") or o.vertex_groups.new(name="card_hide")
            hide.add([int(i) for i in np.nonzero(m)[0]], 1.0, "REPLACE")
            mk = o.modifiers.get("card_hide") or o.modifiers.new("card_hide", "MASK")
            mk.vertex_group = "card_hide"
            mk.invert_vertex_group = True
            undo.append((o, ob, src, mat))
            log(f"card hands {fid} {part} on {o.name}: {len(me.polygons)} faces on {bone} (fit {err * 1000:.1f} mm, "
                f"{int(m.sum())} game verts hidden)")
    bpy.context.view_layer.update()
    return undo


def remove(undo: list) -> None:
    seen = set()
    for o, ob, src, mat in undo:
        if o.name not in seen:
            seen.add(o.name)
            mk = o.modifiers.get("card_hide")
            if mk is not None:
                o.modifiers.remove(mk)
            g = o.vertex_groups.get("card_hide")
            if g is not None:
                o.vertex_groups.remove(g)
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(me)
        sme = src.data
        bpy.data.objects.remove(src, do_unlink=True)
        bpy.data.meshes.remove(sme)
        if mat is not None:
            bpy.data.materials.remove(mat)


# ── card-only material grades (cards pass 4): a part's material graded for the card's light, never the game's ─────────
# Sukri Shadeprint (ruling 2 via ruling 30): the mask's albedo is #B39272 but the violet key and the warm focal read it
# pale peach on the cards (measured 203,161,162 splash / 209,157,156 portrait); the card grade multiplies the mask's
# colour toward the amber lacquer, darkens the eye inlays (dark amber, the painted lid kept) and takes the specular
# off them (the violet rim lights glinted in the pupils), with a lacquer sheen on the rest.
GRADE = {
    "sukri_shadeprint": {"face": {"mul": (0.70, 0.78, 0.42), "rough": 0.42, "eye_mul": 0.55, "eye_spec": 0.04,
                                  "eye_rough": 0.75}},
}


def _sock(socks, name, typ):
    """a Mix node's socket by name and type (the node carries one per data type under the same name)"""
    return next(x for x in socks if x.name == name and x.type == typ)


def _grade_material(mat, g: dict):
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    bc = bsdf.inputs["Base Color"]
    if not bc.is_linked:
        return
    src = bc.links[0].from_socket
    hsv = nt.nodes.new("ShaderNodeSeparateColor")
    hsv.mode = "HSV"
    nt.links.new(src, hsv.inputs[0])
    eye = nt.nodes.new("ShaderNodeMapRange")          # the inlays, pupils and painted lids: saturated (S > ~0.5)
    _sock(eye.inputs, "From Min", "VALUE").default_value = 0.46
    _sock(eye.inputs, "From Max", "VALUE").default_value = 0.58
    nt.links.new(hsv.outputs[1], _sock(eye.inputs, "Value", "VALUE"))
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    _sock(mul.inputs, "Factor", "VALUE").default_value = 1.0
    nt.links.new(src, _sock(mul.inputs, "A", "RGBA"))
    _sock(mul.inputs, "B", "RGBA").default_value = (*g["mul"], 1.0)
    dk = nt.nodes.new("ShaderNodeMix")
    dk.data_type = "RGBA"
    dk.blend_type = "MULTIPLY"
    nt.links.new(_sock(eye.outputs, "Result", "VALUE"), _sock(dk.inputs, "Factor", "VALUE"))
    nt.links.new(_sock(mul.outputs, "Result", "RGBA"), _sock(dk.inputs, "A", "RGBA"))
    e = float(g.get("eye_mul", 1.0))
    _sock(dk.inputs, "B", "RGBA").default_value = (e, e, e, 1.0)
    nt.links.new(_sock(dk.outputs, "Result", "RGBA"), bc)
    for key, sock, base in (("rough", "Roughness", None), ("eye_spec", "Specular IOR Level", 0.5)):
        if key not in g or sock not in bsdf.inputs:
            continue
        s = bsdf.inputs[sock]
        for lk in list(s.links):
            nt.links.remove(lk)
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "FLOAT"
        nt.links.new(_sock(eye.outputs, "Result", "VALUE"), _sock(mx.inputs, "Factor", "VALUE"))
        if key == "rough":
            _sock(mx.inputs, "A", "VALUE").default_value = float(g["rough"])
            _sock(mx.inputs, "B", "VALUE").default_value = float(g.get("eye_rough", g["rough"]))
        else:
            _sock(mx.inputs, "A", "VALUE").default_value = float(s.default_value)
            _sock(mx.inputs, "B", "VALUE").default_value = float(g["eye_spec"])
        nt.links.new(_sock(mx.outputs, "Result", "VALUE"), s)


def grade(spec, skin, objs, log=print) -> list:
    """card-only material grades (GRADE) on the parts of the meshes in `objs`; returns the undo list for ungrade()"""
    sid = (skin or {}).get("id") or getattr(spec, "ID", "")
    if sid not in GRADE:
        return []
    fid = getattr(spec, "ID", "")
    names = [it[0] for it in spec.sculpts()]
    base = next((o for o in bpy.data.objects if o.type == "MESH" and o.name == fid and o.data.attributes.get("vale_part")),
                None)
    undo = []
    for part, g in GRADE[sid].items():
        if base is None:
            continue
        bm_ = _part_mask(base, names, part, None)
        if bm_ is None or not bm_.any():
            continue
        base_pts = _world(base)[bm_]
        for o in objs:
            if o.type != "MESH" or o.name.endswith("_accent"):
                continue
            m = _part_mask(o, names, part, base_pts)
            if m is None or m.sum() < 20:
                continue
            me = o.data
            vi = np.empty(len(me.loops), dtype=np.int64)
            me.loops.foreach_get("vertex_index", vi)
            ls = np.empty(len(me.polygons), dtype=np.int64)
            me.polygons.foreach_get("loop_start", ls)
            lt = np.empty(len(me.polygons), dtype=np.int64)
            me.polygons.foreach_get("loop_total", lt)
            allin = np.add.reduceat(m[vi].astype(np.int64), ls) == lt
            pm = np.empty(len(me.polygons), dtype=np.int64)
            me.polygons.foreach_get("material_index", pm)
            mi = int(np.bincount(pm[allin]).argmax()) if allin.any() else 0
            mat = me.materials[mi].copy()
            mat.name = f"card_grade_{part}"
            _grade_material(mat, g)
            me.materials.append(mat)
            new = len(me.materials) - 1
            old = pm.copy()
            pm2 = pm.copy()
            pm2[allin] = new
            me.polygons.foreach_set("material_index", pm2)
            me.update()
            undo.append((o, old, mat))
            log(f"card grade {sid} {part} on {o.name}: {int(allin.sum())} faces")
    return undo


def ungrade(undo: list) -> None:
    for o, old, mat in undo:
        me = o.data
        me.polygons.foreach_set("material_index", old)
        i = list(me.materials).index(mat)
        me.materials.pop(index=i)
        bpy.data.materials.remove(mat)
        me.update()
