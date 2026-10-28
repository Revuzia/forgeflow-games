"""greatwick Serenade POSED-mantle clearance check (fix round 8): opens the build's cached .blend (rig, clips, the
skinned game mesh), skins the mantle's game mesh in numpy (linear blend, its exported weights, or a candidate head
share blended over them) on EVERY frame of every clip, carries each posed point into the hood's own frame (the inverse
of the head bone's skinning matrix: the hood is rigid on the head) and measures it against the hood sculpt:
  * opening : strip samples (vertices + 5 x 5 per quad) OUTSIDE the hood / collar felt and INSIDE the opening's prism
              (SER_ARCH: the hollow and the 40 cm in front of it, above its floor): a pale tab standing in the dark
              opening. Gate: none, on any frame.
  * rise    : the largest rise (head frame) of a strip sample outside the felt but within 3 cm of it on the front
              +-75 deg columns, over the same sample at rest: the lapels coming up in front of the hood's lower rim (the
              eye-level 'teeth'). Gate: < 1.5 cm.
  * tuck    : the turned-in top row's depth inside the felt, front columns / all columns (gate: >= 1.5 cm).
  * sink    : strip samples (tuck to hem, outside the hood) that sink > 4 mm into the posed TUNIC (each sample read in
              the tunic's rest space through the tunic's own skinning there): the tunic showing through the felt as
              dark shards. Gate: <= 25 samples (of ~3000).
Per clip it prints the worst frame of each, then a PASS / FAIL line.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/blender/proto/wick_greatwick_mantlepose.py -- [--blend PATH] [--clips attack1,death] \
        [--share '{"rows": [1, 1, 0.5, 0.15, 0, 0], "front": 60, "fade": 95, "back": [..]}'] [--frames-log]

--share replaces the mantle's weights with wick_greatwick.mantle_weights for that MANTLE_HEAD-style config (per-row
head share on the front columns, faded to `back` rows by `fade` degrees from the front; optional `neck` / `neck_back`
rows), so a share is tried without a build; without it the check runs on the weights the build exported.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from common import heavy, scene  # noqa: E402


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--blend", default=os.path.join(scene.CACHE_DIR, "fighters", "greatwick_serenade.blend"))
    p.add_argument("--clips", default="")
    p.add_argument("--share", default="")
    p.add_argument("--frames-log", action="store_true")
    p.add_argument("--json", default="")
    p.add_argument("--render", default="", help="DIR: flat part-colour renders of the posed neck (Workbench)")
    p.add_argument("--times", default="idle:0.3;attack1:0.18,0.25,0.33,0.42;death:0.2,0.4,0.6,1.0")
    p.add_argument("--tag", default="")
    return p.parse_args(scene.script_args())


def main():
    a = args()
    heavy.hold("blender:greatwick_mantlepose")
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    import wick_greatwick as gw
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    parts = gw.serenade_parts(gw.LAYOUT["serenade"])
    names = [sp.name for sp in parts]
    by = {sp.name: sp for sp in parts}
    sp_m = by["mantle"]
    mV, _ = sp_m.meta["low_mesh"]
    nv = 6
    mV_model = sp_m.to_model(np.asarray(mV, float))
    ncol = len(mV_model) // nv
    # the skinned body mesh: the mantle's vertices by their part id
    body = None
    for o in bpy.data.objects:
        if o.type == "MESH" and o.parent == arm and o.data.attributes.get("vale_part") is not None:
            pid = np.zeros(len(o.data.vertices), np.int64)
            o.data.attributes["vale_part"].data.foreach_get("value", pid)
            if (pid == names.index("mantle")).any() and not o.name.endswith("_accent"):
                body = o
                break
    me = body.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    mw = np.array(body.matrix_world)
    co = co.reshape(n, 3) @ mw[:3, :3].T + mw[:3, 3]
    pid = np.zeros(n, np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pid)
    sel = np.nonzero(pid == names.index("mantle"))[0]
    X0 = co[sel].astype(float)
    # each Blender vertex -> its (column, row) on the strip grid
    d2 = ((X0[:, None, :] - mV_model[None, :, :]) ** 2).sum(-1)
    gi = d2.argmin(1)
    print(f"MANTLE {len(sel)} verts matched to {len(mV_model)} grid points, max {math.sqrt(d2.min(1).max()) * 1000:.2f} mm")
    bones = [b.name for b in arm.data.bones]
    bi = {b: i for i, b in enumerate(bones)}
    gname = {g.index: g.name for g in body.vertex_groups}
    W = np.zeros((len(sel), len(bones)))
    for k, vi in enumerate(sel):
        for g in me.vertices[vi].groups:
            nm = gname.get(g.group)
            if nm in bi and g.weight > 1e-5:
                W[k, bi[nm]] = g.weight
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    hood_v = np.nonzero(pid == names.index("hood"))[0][:50]
    hw_ = []
    for vi in hood_v:
        hw_.append({gname[g.group]: round(g.weight, 3) for g in me.vertices[vi].groups if g.weight > 1e-3})
    print("HOOD weights sample", hw_[:3])
    col_i, row_i = gi // nv, gi % nv
    # side angle (deg from the front) of each grid column (the facings copy the edge columns)
    m_cols = [15.0, 24.0, 34.0, 46.0, 60.0, 75.0, 90.0, 105.0, 120.0, 135.0, 150.0, 180.0]
    m_cols = m_cols + [360.0 - c_ for c_ in m_cols[::-1][1:]]
    side_c = np.array([min(c_, 360 - c_) for c_ in [m_cols[0]] + m_cols + [m_cols[-1]]])
    assert len(side_c) == ncol, (len(side_c), ncol)
    rb_ = arm.data.bones
    if a.share:
        cfg = json.loads(a.share)
        # the binder's own weights for this share, from scratch (joints: the rig's bone heads)
        jz = (rb_["hips"].head_local.z, rb_["chest"].head_local.z, rb_["neck"].head_local.z, rb_["upper_arm.L"].head_local.z)
        Wd = gw.mantle_weights(X0, jz, side_c[col_i], row_i, cfg)
        W = np.zeros_like(W)
        for b_, arr in Wd.items():
            W[:, bi[b_]] = arr
        # glTF's 4 influences (limit_weights: the 4 largest >= 0.01, renormalised)
        for k in range(len(W)):
            o_ = np.argsort(-W[k])
            W[k, o_[4:]] = 0.0
            W[k, W[k] < 0.01] = 0.0
        W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
        print("SHARE", cfg, "head share by row (front col):", [round(float(gw.mantle_head_share(15.0, r, cfg)), 3) for r in range(nv)],
              "(side 90):", [round(float(gw.mantle_head_share(90.0, r, cfg)), 3) for r in range(nv)])
    else:
        hh = W[:, bi["head"]] if "head" in bi else np.zeros(len(W))
        for r in range(nv):
            m = row_i == r
            print(f"  row {r}: head share front {hh[m & (side_c[col_i] < 40)].mean():.3f} side {hh[m & (np.abs(side_c[col_i] - 90) < 20)].mean():.3f} back {hh[m & (side_c[col_i] > 150)].mean():.3f}")
    if a.render:
        render(a, arm, body, sel, W, bones, names, pid)
        return
    # the hood frame fields (model space)
    hood_tf = by["hood"].to_model
    inv_h = gw.invert(hood_tf)
    F_cov = gw.sdf.Blend([("add", gw.field_of(by["hood"].S), 0.0), ("add", gw.field_of(by["collar"].S), 0.0)])
    A = gw.SER_ARCH

    def fields(P):
        Q = inv_h(P)
        return F_cov.d(Q), A.d(Q), Q
    # strip grid -> samples (vertices + 5 x 5 per quad)
    G_of = np.full((ncol, nv), -1)
    G_of[col_i, row_i] = np.arange(len(sel))
    assert (G_of >= 0).all()
    s_ = np.linspace(0, 1, 5)
    SU, SV = np.meshgrid(s_, s_)
    SU, SV = SU.ravel(), SV.ravel()

    def samples(X):
        G = X[G_of]                                            # (ncol, nv, 3)
        a00, a10, a01, a11 = G[:-1, :-1], G[1:, :-1], G[:-1, 1:], G[1:, 1:]
        S = ((1 - SU) * (1 - SV))[None, None, :, None] * a00[:, :, None] + (SU * (1 - SV))[None, None, :, None] * a10[:, :, None] \
            + ((1 - SU) * SV)[None, None, :, None] * a01[:, :, None] + (SU * SV)[None, None, :, None] * a11[:, :, None]
        return S                                               # (ncol-1, nv-1, 25, 3)
    qc = np.repeat(np.minimum(side_c[:-1], side_c[1:])[:, None], nv - 1, 1)          # quad side angle
    qr = np.repeat(np.arange(nv - 1)[None, :], ncol - 1, 0)                          # quad row (0 = tuck -> top)
    front_q = qc <= 75.0
    S0 = samples(X0)
    c0, a0, Q0 = fields(S0.reshape(-1, 3))
    Q0 = Q0.reshape(S0.shape)
    tuck = row_i == 0
    ct0, _, _ = fields(X0[tuck])
    print(f"REST: tuck depth front {(-ct0[side_c[col_i[tuck]] < 60]).min() * 100:.2f} cm, all {(-ct0).min() * 100:.2f} cm; "
          f"opening samples outside felt {int(((a0 < 0) & (c0 > 0.002)).sum())}")
    open_rest = ((a0 < 0) & (c0 > 0.002)).reshape(S0.shape[:3])
    for ii in zip(*np.nonzero(open_rest)):
        print(f"  rest-open sample: quad side {qc[ii[0], ii[1]]:.0f} row {ii[1]} ad {a0.reshape(S0.shape[:3])[ii] * 100:.2f} cm "
              f"felt {c0.reshape(S0.shape[:3])[ii] * 100:.2f} cm at {np.round(Q0[ii], 3).tolist()}")
    # the tunic ('cloak'): each strip sample skinned with the tunic's own weights there (inverse-distance mean of its
    # 4 nearest tunic vertices at rest), so a posed sample is read in the tunic's rest space against its sculpt
    tsel = np.nonzero(pid == names.index("cloak"))[0]
    TW = np.zeros((len(tsel), len(bones)))
    for k, vi in enumerate(tsel):
        for g in me.vertices[vi].groups:
            nm = gname.get(g.group)
            if nm in bi and g.weight > 1e-5:
                TW[k, bi[nm]] = g.weight
    TW /= np.maximum(TW.sum(1, keepdims=True), 1e-9)
    TX = co[tsel].astype(float)
    S0f = S0.reshape(-1, 3)
    dd = np.sqrt(((S0f[:, None, :] - TX[None, :, :]) ** 2).sum(-1))
    nn = np.argsort(dd, 1)[:, :4]
    wn = 1.0 / np.maximum(np.take_along_axis(dd, nn, 1), 1e-4)
    SW = (TW[nn] * wn[:, :, None]).sum(1) / wn.sum(1)[:, None]
    F_t = gw.field_of(by["cloak"].S)
    inv_b = gw.invert(by["cloak"].to_model)
    t0 = F_t.d(inv_b(S0f)).reshape(S0.shape[:3])
    sink_rest = t0 < -0.004
    vis_q = (qr <= 3)[:, :, None] & (c0.reshape(S0.shape[:3]) > 0.0)           # (not the lip; not inside the hood)
    print(f"REST: samples inside the tunic {int((sink_rest & vis_q).sum())}")
    rb = arm.data.bones
    rest_inv = np.stack([np.array(rb[b].matrix_local.inverted()) for b in bones])
    amw = np.array(arm.matrix_world)
    amw_inv = np.linalg.inv(amw)
    sc = bpy.context.scene
    acts = [x for x in a.clips.split(",") if x] or sorted(act.name for act in bpy.data.actions)
    report = {}
    ok_all = True
    Xh = np.c_[X0, np.ones(len(X0))]
    for clip in acts:
        act = bpy.data.actions.get(clip)
        if act is None:
            print("no action", clip)
            continue
        arm.animation_data_create()
        arm.animation_data.action = act
        f0, f1 = (int(v) for v in act.frame_range)
        worst = {"open": (0, None, 0.0), "rise": (0.0, None), "tuck": (9.0, None), "sink": (0, None, 0.0)}
        for fr in range(f0, f1 + 1):
            sc.frame_set(fr)
            pb = arm.pose.bones
            M = np.stack([amw @ np.array(pb[b].matrix) @ rest_inv[i] @ amw_inv for i, b in enumerate(bones)])
            X = np.einsum("nb,bij,nj->ni", W, M, Xh)[:, :3]
            Sh = np.linalg.inv(M[bi["head"]])
            Xl = (np.c_[X, np.ones(len(X))] @ Sh.T)[:, :3]            # into the head's rest frame
            S = samples(Xl)
            c, ad, Q = fields(S.reshape(-1, 3))
            c, ad, Q = c.reshape(S.shape[:3]), ad.reshape(S.shape[:3]), Q.reshape(S.shape)
            outside = c > 0.002
            opn = outside & (ad < 0) & ~open_rest
            n_open = int(opn.sum())
            dep = float((-ad[opn]).max()) if n_open else 0.0
            near = outside & (c < 0.03) & front_q[:, :, None]            # out of the felt, within 3 cm of the hood
            rise = np.where(near, Q[..., 2] - Q0[..., 2], 0.0)
            r_max = float(rise.max())
            Mt = np.einsum("nb,bij->nij", SW, M)                     # each sample's tunic skinning matrix
            Sw = samples(X).reshape(-1, 3)
            Pt = np.einsum("nij,nj->ni", np.linalg.inv(Mt), np.c_[Sw, np.ones(len(Sw))])[:, :3]
            tdep = F_t.d(inv_b(Pt)).reshape(S.shape[:3])
            snk = (tdep < -0.004) & ~sink_rest & (qr <= 3)[:, :, None] & (c > 0.0)
            n_sink = int(snk.sum())
            s_dep = float((-tdep[snk]).max()) if n_sink else 0.0
            if n_sink > worst["sink"][0]:
                cols = sorted({int(side_c[i]) for i in np.nonzero(snk.any((1, 2)))[0]})
                rows = sorted({int(r) for r in np.nonzero(snk.any((0, 2)))[0]})
                worst["sink"] = (n_sink, (fr, round((fr - f0) / max(1, f1 - f0), 3), cols, rows), s_dep)
            ct, _, _ = fields(Xl[tuck])
            t_front = float((-ct[side_c[col_i[tuck]] < 60]).min())
            t_all = float((-ct).min())
            t = (fr - f0) / max(1, f1 - f0)
            if n_open > worst["open"][0] or (n_open == worst["open"][0] and dep > worst["open"][2]):
                cols = sorted({int(side_c[i]) for i in np.nonzero(opn.any((1, 2)))[0]})
                rows = sorted({int(r) for r in np.nonzero(opn.any((0, 2)))[0]})
                worst["open"] = (n_open, (fr, round(t, 3), cols, rows), dep)
            if r_max > worst["rise"][0]:
                ii = np.unravel_index(int(rise.argmax()), rise.shape)
                worst["rise"] = (r_max, (fr, round(t, 3), int(qc[ii[0], ii[1]]), int(ii[1])))
            if t_all < worst["tuck"][0]:
                worst["tuck"] = (t_all, (fr, round(t, 3), round(t_front * 100, 2)))
            if a.frames_log:
                print(f"  {clip} f{fr:3d} t{t:.2f}: open {n_open:4d} ({dep * 100:.1f} cm) rise {r_max * 100:5.1f} cm  tuck front {t_front * 100:.1f} all {t_all * 100:.1f}")
        ok = worst["open"][0] == 0 and worst["rise"][0] < 0.015 and worst["tuck"][0] >= 0.015 and worst["sink"][0] <= 25
        ok_all &= ok
        report[clip] = {"open": worst["open"][0], "open_at": worst["open"][1], "open_depth_cm": round(worst["open"][2] * 100, 2),
                        "rise_cm": round(worst["rise"][0] * 100, 2), "rise_at": worst["rise"][1],
                        "tuck_min_cm": round(worst["tuck"][0] * 100, 2), "tuck_at": worst["tuck"][1],
                        "sink": worst["sink"][0], "sink_at": worst["sink"][1], "sink_depth_cm": round(worst["sink"][2] * 100, 2), "ok": ok}
        print(f"CLIP {clip:10s} frames {f0}-{f1}: open {worst['open'][0]} at {worst['open'][1]} ({worst['open'][2] * 100:.1f} cm deep); "
              f"rise {worst['rise'][0] * 100:.1f} cm at {worst['rise'][1]}; tuck min {worst['tuck'][0] * 100:.1f} cm at {worst['tuck'][1]}; "
              f"sink {worst['sink'][0]} at {worst['sink'][1]} ({worst['sink'][2] * 100:.1f} cm)  {'ok' if ok else 'FAIL'}")
    print("MANTLEPOSE", "PASS" if ok_all else "FAIL")
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(report, fh, indent=1)


SHOW = {"hood": "#B49A74", "hood_rim": "#3B302A", "collar": "#4B4039", "crown_band": "#3F9CFF", "mantle": "#F0DCB0",
        "cloak": "#765E4E", "sleeve_R": "#6A5446", "sleeve_L": "#6A5446", "mitt_R": "#45362C", "mitt_L": "#45362C",
        "pack": "#6E5848", "hollow_floor": "#17150F", "hood_light": "#3F9CFF"}


def render(a, arm, body, sel, W, bones, names, pid):
    """Write W into the body's mantle vertex groups and render the posed neck in flat part colours (the mantle pale,
    the hollow and the rim dark): eye level front / 3-4 / side and the 52-degree camera front / 315, framed on the
    posed hood, at each clip time."""
    from mathutils import Vector
    os.makedirs(a.render, exist_ok=True)
    vg = {g.name: g for g in body.vertex_groups}
    for b in bones:
        if b not in vg and W[:, bones.index(b)].max() > 0:
            vg[b] = body.vertex_groups.new(name=b)
    idx = [int(v) for v in sel]
    for g in body.vertex_groups:
        g.remove(idx)
    for k, vi in enumerate(idx):
        for j in np.nonzero(W[k] > 1e-4)[0]:
            vg[bones[j]].add([vi], float(W[k, j]), "REPLACE")
    def lin(h):
        return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in scene.hex_srgb(h)]
    for o in bpy.data.objects:
        if o.type != "MESH" or o.data.attributes.get("vale_part") is None:
            continue
        me = o.data
        n = len(me.vertices)
        pp = np.zeros(n, np.int64)
        me.attributes["vale_part"].data.foreach_get("value", pp)
        cols = np.tile(np.array(lin("#6A5446") + [1.0], np.float32), (n, 1))
        for i, nm in enumerate(names):
            hx = SHOW.get(nm) or next((v for k, v in SHOW.items() if nm.startswith(k)), None)
            if hx:
                cols[pp == i] = lin(hx) + [1.0]
        if o.name.endswith("_accent"):
            cols[:] = lin("#3F9CFF") + [1.0]
        at = me.color_attributes.get("_flat") or me.color_attributes.new("_flat", "FLOAT_COLOR", "POINT")
        at.data.foreach_set("color", cols.ravel())
        me.color_attributes.active_color = at
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "VERTEX"
    sh.show_cavity = False
    sc.render.resolution_x, sc.render.resolution_y = 520, 460
    cam_d = bpy.data.cameras.new("cam_mp")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 0.62
    cam = bpy.data.objects.new("cam_mp", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    views = [("eye0", 0, 3), ("eye35", 35, 3), ("eye70", 70, 3), ("g52_0", 0, 52), ("g52_315", -45, 52)]
    hood_i = names.index("hood")
    paths = []
    for spec in a.times.split(";"):
        clip, ts = spec.split(":")
        act = bpy.data.actions.get(clip)
        if act is None:
            continue
        arm.animation_data_create()
        arm.animation_data.action = act
        f0, f1 = act.frame_range
        for t in ts.split(","):
            fr = f0 + float(t) * (f1 - f0)
            sc.frame_set(int(math.floor(fr)), subframe=fr - math.floor(fr))
            dg = bpy.context.evaluated_depsgraph_get()
            ev = body.evaluated_get(dg)
            me = ev.to_mesh()
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ np.array(body.matrix_world)[:3, :3].T + np.array(body.matrix_world)[:3, 3]
            c = co[pid == hood_i].mean(0)
            ev.to_mesh_clear()
            tgt = Vector((float(c[0]), float(c[1]), float(c[2]) - 0.10))
            for nm, yaw, pitch in views:
                y, p = math.radians(yaw), math.radians(pitch)
                d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
                cam.location = tgt + d * 4.0
                cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                path = os.path.join(a.render, f"{a.tag}{clip}_{float(t):.2f}_{nm}.png")
                sc.render.filepath = path
                bpy.ops.render.render(write_still=True)
                paths.append(path)
    print("RENDERED", len(paths), a.render)


if __name__ == "__main__":
    main()
