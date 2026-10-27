"""Burdam carry search, fix pass 6: what a viewer actually SEES of the carried blade.

For each candidate carry (right wrist point, blade heading / elevation, roll of the flat about the blade axis) the
cached build's rigid cleaver is posed by FK against the guard-posed body (carry5's method) and rendered as points:

  game    the 52 degree gameplay camera (82.1 px per m at 1080p), 24 facings: the blade + heel pixels left in view
          (px^2) after the health bar / name plate (art height + 0.35 m) and the body in front of it (a depth
          buffer of the posed body, arms excluded) take theirs; the blade's screen angle; the 'pointer' facings
          (the tip at bar level just past one of the bar's ends)
  lane    the minimum of `game` over the two lane facings (facing screen-left / screen-right, +-15 degrees)
  eye     the eye-level front (yaw 0) and portrait (yaw 28, camera on his left) views: the blade's screen angle
          (degrees above horizontal, + = rising toward his left: the concept's diagonal behind the head) and the
          share of the blade not hidden by the body / head
  hits    cleaver points inside the torso / head (BVH, top candidates only)

    Blender -b --factory-startup --python art/blender/proto/burdam_carry6.py -- [--top 25] [--sheet a,b,c]

--sheet renders the listed candidates (indices into the printed ranking) as point splats: columns game W, E, S,
N, SW, NE (bar drawn), eye front, eye portrait -> art/renders/fighters/burdam/carry6_sheet.png.
--pick "wx,wy,wz,head,elev,roll;..." scores (and sheets) explicit carries instead of the grid search.
"""
from __future__ import annotations

import itertools
import math
import os
import sys
import types

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
sys.path.insert(0, BL)
sys.path.insert(0, os.path.join(BL, "fighters"))
sys.path.insert(0, HERE)

PPM = 82.1
C52, S52 = math.cos(math.radians(52)), math.sin(math.radians(52))
EYE_PITCH = math.radians(6.0)
EYE_PPM = 160.0
ARMS = ("forearms", "fist_R", "palm_L", "fingers_L", "vambrace", "strap_plate")
HARD = ("mask", "cowl", "coat", "belt", "skirt", "tier1")
SOFT = ("shoulder_plate", "fringe")
LANE = (75, 90, 105, 255, 270, 285)


def game_proj(P, yd):
    t = math.radians(yd)
    x = P[:, 0] * math.cos(t) - P[:, 1] * math.sin(t)
    y = P[:, 0] * math.sin(t) + P[:, 1] * math.cos(t)          # + = away from the camera
    v = P[:, 2] * C52 + y * S52
    depth = -y * C52 + P[:, 2] * S52                            # + = toward the camera
    return x * PPM, v * PPM, depth


def eye_proj(P, yd):
    t = math.radians(yd)
    x = P[:, 0] * math.cos(t) - P[:, 1] * math.sin(t)
    y = P[:, 0] * math.sin(t) + P[:, 1] * math.cos(t)
    v = P[:, 2] * math.cos(EYE_PITCH) + y * math.sin(EYE_PITCH)
    depth = -y * math.cos(EYE_PITCH) + P[:, 2] * math.sin(EYE_PITCH)
    return x * EYE_PPM, v * EYE_PPM, depth


def surface_points(co, tri, step):
    """points on the triangles (vertex arrays co, index triples tri) about `step` m apart; and the triangle of each"""
    A, B, C = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    ar = 0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1)
    k = np.maximum(1, np.round(ar / (step * step)).astype(int))
    idx = np.repeat(np.arange(len(tri)), k)
    rng = np.random.default_rng(3)
    u, v = rng.random(len(idx)), rng.random(len(idx))
    f = u + v > 1
    u[f], v[f] = 1 - u[f], 1 - v[f]
    P = A[idx] + (B[idx] - A[idx]) * u[:, None] + (C[idx] - A[idx]) * v[:, None]
    return P, idx


class ZBuf:
    """the body's nearest depth per pixel (points splatted r px)"""

    def __init__(self, x, v, d, r=2):
        self.x0, self.v0 = int(np.floor(x.min())) - r - 2, int(np.floor(v.min())) - r - 2
        w = int(np.ceil(x.max())) - self.x0 + r + 3
        h = int(np.ceil(v.max())) - self.v0 + r + 3
        self.z = np.full((h, w), -1e9)
        xi, vi = np.round(x).astype(int) - self.x0, np.round(v).astype(int) - self.v0
        for dx in range(-r, r + 1):
            for dv in range(-r, r + 1):
                if dx * dx + dv * dv > r * r + 1:
                    continue
                np.maximum.at(self.z, (vi + dv, xi + dx), d)

    def hidden(self, x, v, d, tol=0.02):
        xi, vi = np.round(x).astype(int) - self.x0, np.round(v).astype(int) - self.v0
        ok = (xi >= 0) & (vi >= 0) & (xi < self.z.shape[1]) & (vi < self.z.shape[0])
        out = np.zeros(len(x), dtype=bool)
        out[ok] = self.z[vi[ok], xi[ok]] > d[ok] + tol
        return out


def bar_hidden(x, v, anchor_px):
    dv = v - anchor_px
    return ((x >= -76) & (x <= 54) & (np.abs(dv) <= 9)) | ((np.abs(x) <= 45) & (dv > 9) & (dv <= 25))


def area(x, v, sel):
    if not np.any(sel):
        return 0
    k = np.round(x[sel]).astype(int) * 100003 + np.round(v[sel]).astype(int)
    return len(np.unique(k))


def screen_angle(x, v):
    Q = np.stack([x - x.mean(), v - v.mean()], 1)
    w, V_ = np.linalg.eigh(Q.T @ Q)
    ax = V_[:, -1]
    if ax[0] < 0:
        ax = -ax
    return math.degrees(math.atan2(ax[1], ax[0])), math.sqrt(max(w[-1], 0.0) / len(x)) * 3.46


def main():
    import argparse
    from common import scene
    p = argparse.ArgumentParser()
    p.add_argument("--top", type=int, default=25)
    p.add_argument("--height", type=float, default=2.16)
    p.add_argument("--wx", default="-0.46,-0.38,-0.30")
    p.add_argument("--wy", default="-0.34,-0.22,-0.10")
    p.add_argument("--wz", default="1.40,1.50,1.60,1.70")
    p.add_argument("--head", default="0,15,30,45,60,75")
    p.add_argument("--elev", default="10,20,30,40,50")
    p.add_argument("--roll", default="-40,-20,0,20,40")
    p.add_argument("--sheet", default="")
    p.add_argument("--pick", default="")
    p.add_argument("--out", default="carry6_sheet.png")
    p.add_argument("--by-min", action="store_true", help="rank by the worst facing first")
    p.add_argument("--by-sw", action="store_true", help="rank by the blade NOT rising in the facings toward screen-left")
    p.add_argument("--clip", default="", help="score the cached build posed by a CURRENT clip key instead: 'run:0.25'")
    p.add_argument("--eye-min", type=float, default=0.0, help="keep candidates whose eye-level front view shows this share")
    p.add_argument("--eye-ang", default="0,90", help="keep candidates whose eye-level front angle lies in this range")
    p.add_argument("--lobby", type=float, default=0.0,
                   help="fix pass 8: rank for the LOBBY carry (no health bar): the eye-level front angle near this "
                        "value, the blade, the heel and the haft + pommel all in view at eye level (front, portrait)")
    a = p.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "burdam.blend"))
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from common import anim
    import burdam as F
    F._install_aim_roll()
    arm = bpy.data.objects["burdam_rig"]
    ctx = types.SimpleNamespace(info=types.SimpleNamespace(armature=arm, props=F.PROPORTIONS, joints={}), spec=F,
                                chains={}, skin=None)
    R = F.Rig(ctx)
    skel = R.skel
    body = bpy.data.objects["burdam"]
    names = [x[0] for x in F.sculpts()]
    me = body.data
    n = len(me.vertices)
    co0 = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co0)
    co0 = co0.reshape(-1, 3).astype(np.float64)
    pv = np.zeros(n, dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    ids = {nm: i for i, nm in enumerate(names)}
    pname = np.array(names)[pv]
    cl_sel = np.isin(pname, F.CLEAVER)
    G = F.guard_pose()
    clip_pose = None
    if a.clip:
        cn, ct = a.clip.split(":")
        clips_ = anim.standard_clips(skel, F.MOTION, F.clip_overrides(ctx))
        clip_pose = clips_[cn].sample(float(ct))
        G = clip_pose
    anim.apply_pose(arm, G)
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    ev = body.evaluated_get(deps)
    m2 = ev.to_mesh()
    co = np.empty(len(m2.vertices) * 3, dtype=np.float32)
    m2.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    Mw = np.array(body.matrix_world)
    co = co.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]
    polys = [tuple(p_.vertices) for p_ in me.polygons]
    ppart = np.array([names[pv[q[0]]] for q in polys])
    hard = [i for i in range(len(polys)) if ppart[i] in HARD]
    soft = [i for i in range(len(polys)) if ppart[i] in SOFT]
    bvh_h = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in hard])
    bvh_s = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in soft])
    occ = ~cl_sel & ~np.isin(pname, ARMS)
    tri = np.array([q[:3] for q in polys] + [(q[0], q[2], q[3]) for q in polys if len(q) == 4])
    tpart = pname[tri[:, 0]]
    bt = tri[~np.isin(tpart, F.CLEAVER) & ~np.isin(tpart, ARMS)]
    Pb, bwhich = surface_points(co, bt, 0.008)
    bpart = pname[bt[:, 0]][bwhich]
    Mb = np.array(arm.data.bones["prop.R"].matrix_local)
    ct = tri[np.isin(tpart, F.CLEAVER)]
    Pc, which = surface_points(co0, ct, 0.006)
    loc_cl = (Pc - Mb[:3, 3]) @ Mb[:3, :3]
    cpart = tpart[np.isin(tpart, F.CLEAVER)][which]
    is_blade = np.isin(cpart, ("blade", "heel", "gems"))
    is_heel = cpart == "heel"
    is_hp = np.isin(cpart, ("haft", "pommel"))
    yaws = list(range(0, 360, 15))
    anchor = (a.height + 0.35) * C52 * PPM
    zg = {yd: ZBuf(*game_proj(Pb, yd)) for yd in yaws}
    ze = {yd: ZBuf(*eye_proj(Pb, yd), r=3) for yd in (0, -28)}
    sh = skel.fk(anim.resolve(skel, G))
    shoulder = np.array((sh[skel.parent["upper_arm.R"]] @ skel.local["upper_arm.R"]).translation)
    print(f"right shoulder joint {np.round(shoulder, 3).tolist()}")

    def pose_clip():
        q = anim.resolve(skel, clip_pose)
        M = skel.fk(q)
        Mp = np.array(M["prop.R"])
        P = loc_cl @ Mp[:3, :3].T + Mp[:3, 3]
        d = Mp[:3, 1] / np.linalg.norm(Mp[:3, 1])
        return P, d, Mp[:3, 0], True

    def pose_cleaver(wx, wy, wz, hd, el, rl):
        if clip_pose is not None:
            return pose_clip()
        h, e = math.radians(hd), math.radians(el)
        d = np.array([math.cos(e) * math.cos(h), math.cos(e) * math.sin(h), math.sin(e)])
        s = np.cross([0.0, 0.0, 1.0], d)
        s /= np.linalg.norm(s)
        if s[1] < 0:
            s = -s
        up = np.cross(s, d)
        r = math.radians(rl)                    # roll the flat normal about d (+ turns it toward the back)
        up = up * math.cos(r) + np.cross(d, up) * math.sin(r)
        pose = R.place(G, (wx, wy, wz), tuple(d), tuple(up), pole=tuple(F.CARRY["pole"]))
        if a.pick:
            print(f"  pick ({wx},{wy},{wz},{hd},{el},{rl}): CARRY = dict(rel={tuple(round(c, 3) for c in pose['ik']['hand.R'].rel)}, "
                  f"pole={tuple(F.CARRY['pole'])}, d={tuple(round(float(c), 3) for c in d)}, up={tuple(round(float(c), 3) for c in up)})")
        q = anim.resolve(skel, pose)
        M = skel.fk(q)
        Mp = np.array(M["prop.R"])
        P = loc_cl @ Mp[:3, :3].T + Mp[:3, 3]
        ok = np.dot(Mp[:3, 1], d) > 0.98 and np.linalg.norm(np.array(M["hand.R"].translation) - (wx, wy, wz)) < 0.04
        return P, d, up, ok

    def score(P, d, up):
        B = P[is_blade]
        g, angs, ptr = {}, {}, 0
        tip = B[np.argmax(B @ d)]
        for yd in yaws:
            x, v, dp = game_proj(B, yd)
            vis = ~bar_hidden(x, v, anchor) & ~zg[yd].hidden(x, v, dp)
            g[yd] = area(x, v, vis)
            angs[yd] = screen_angle(x, v)[0]
            tx, tv, _ = game_proj(tip[None], yd)
            if abs(tv[0] - anchor) < 16 and (tx[0] > 54 or tx[0] < -76) and -130 < tx[0] < 110:
                ptr += 1
        eye = {}
        for yd in (0, -28):
            x, v, dp = eye_proj(B, yd)
            hid = ze[yd].hidden(x, v, dp)
            ang, L = screen_angle(x, v)
            tx, _, _ = eye_proj(tip[None], yd)
            parts = []
            for sel in (is_heel, is_hp):
                xq, vq, dq = eye_proj(P[sel], yd)
                parts.append(1.0 - float(ze[yd].hidden(xq, vq, dq).mean()))
            eye[yd] = (ang, 1.0 - float(hid.mean()), L / EYE_PPM, float(tx[0]) / EYE_PPM, area(x * 0.5, v * 0.5, ~hid),
                       parts[0], parts[1])
        lane = min(g[y] for y in LANE)
        return dict(game=g, angs=angs, ptr=ptr, lane=lane, mean=float(np.mean(list(g.values()))),
                    minall=min(g.values()), eye=eye, tipz=float(tip[2]))

    def hits(P):
        def inside(bvh, Q, tol):
            c = 0
            for v_ in Q[::3]:
                loc, nrm, fi, dist = bvh.find_nearest(Vector(v_), 0.3)
                if loc is not None and (Vector(v_) - loc).dot(nrm) < -tol:
                    c += 1
            return c
        return inside(bvh_h, P, 0.005), inside(bvh_s, P, 0.02)

    fl = lambda s: [float(x) for x in s.split(",")]  # noqa: E731
    if a.pick:
        cands = [tuple(fl(s)) for s in a.pick.split(";") if s.strip()]
    else:
        cands = list(itertools.product(fl(a.wx), fl(a.wy), fl(a.wz), fl(a.head), fl(a.elev), fl(a.roll)))
    rows = []
    for c in cands:
        P, d, up, ok = pose_cleaver(*c)
        if not ok and not a.pick:
            continue
        s = score(P, d, up)
        s.update(c=c, d=d, up=up, ok=ok)
        rows.append(s)
    print(f"{len(cands)} candidates, {len(rows)} reachable")

    def key_min(r):
        fa, fv = r["eye"][0][0], r["eye"][0][1]
        return -(r["minall"] / 200.0 + r["mean"] / 1000.0 + fv - abs(fa - 30.0) / 20.0 - 1.0 * r["ptr"])

    def key_sw(r):
        g, an = r["game"], r["angs"]
        sw = [y for y in (285, 300, 315, 330)]
        flat_hi = sum(max(0.0, an[y]) for y in sw)               # rising (toward the bar) in the facings toward screen-left
        fa, fv = r["eye"][0][0], r["eye"][0][1]
        return (flat_hi / 10.0 - min(g[y] for y in sw) / 300.0 - r["minall"] / 400.0 - fv + abs(fa - 28.0) / 15.0)

    def key(r):
        fa, fv = r["eye"][0][0], r["eye"][0][1]
        concept = -abs(fa - 30.0) / 10.0 + 2.0 * fv + (r["eye"][0][4] + r["eye"][-28][4]) / 1200.0
        return -(r["lane"] / 400.0 + r["minall"] / 400.0 + r["mean"] / 800.0 + concept - 1.5 * r["ptr"])

    def key_lobby(r):
        e0, e28 = r["eye"][0], r["eye"][-28]
        return -(2.0 * e0[1] + e28[1] + 1.5 * e0[5] + 0.5 * e28[5] + 1.5 * e0[6] + 0.5 * e28[6]
                 - abs(e0[0] - a.lobby) / 6.0 - abs(e28[0] - a.lobby) / 12.0)

    lo_a, hi_a = fl(a.eye_ang)
    rows = [r for r in rows if r["eye"][0][1] >= a.eye_min and r["eye"][-28][1] >= a.eye_min
            and lo_a <= r["eye"][0][0] <= hi_a] if not a.pick else rows
    print(f"{len(rows)} pass the eye-level filter")
    rows.sort(key=key_lobby if a.lobby else (key_sw if a.by_sw else (key_min if a.by_min else key)))
    if not a.pick:
        top = []
        for r in rows:
            if len(top) >= a.top:
                break
            P, d, up, ok = pose_cleaver(*r["c"])
            nh, ns = hits(P)
            r["hits"] = (nh, ns)
            if nh == 0 and ns == 0:
                top.append(r)
        rows = top
    else:
        for r in rows:
            P, d, up, ok = pose_cleaver(*r["c"])
            r["hits"] = hits(P)
    for i, r in enumerate(rows):
        c = r["c"]
        g = r["game"]
        print("   per facing (yaw: px^2 / screen angle): " + " ".join(f"{y}:{g[y]}/{r['angs'][y]:+.0f}" for y in yaws))
        e0, e28 = r["eye"][0], r["eye"][-28]
        print(f"[{i:2d}] wrist ({c[0]:+.2f},{c[1]:+.2f},{c[2]:.2f}) head {c[3]:3.0f} elev {c[4]:3.0f} roll {c[5]:+3.0f} "
              f"| lane {r['lane']:4d} min {r['minall']:4d} mean {r['mean']:5.0f} ptr {r['ptr']} "
              f"| W {g[270]:4d} E {g[90]:4d} S {g[0]:4d} N {g[180]:4d} "
              f"angW {r['angs'][270]:+4.0f} angE {r['angs'][90]:+4.0f} angS {r['angs'][0]:+4.0f} "
              f"| eye0 {e0[0]:+4.0f}deg vis {e0[1]:.2f} heel {e0[5]:.2f} haft {e0[6]:.2f} A {e0[4]:4d} eye28 {e28[0]:+4.0f}deg vis {e28[1]:.2f} heel {e28[5]:.2f} haft {e28[6]:.2f} A {e28[4]:4d} tipx {e28[3]:+.2f} "
              f"| tip z {r['tipz']:.2f} hits {r.get('hits')} ok {r['ok']} d {np.round(r['d'], 3).tolist()} "
              f"up {np.round(r['up'], 3).tolist()}")
    if a.sheet or a.pick:
        sel = [int(x) for x in a.sheet.split(",")] if a.sheet else list(range(len(rows)))
        sheet([rows[i] for i in sel if i < len(rows)], Pb, bpart, cpart, pose_cleaver, anchor, a.out)


PART_RGB = {"mask": (0.78, 0.65, 0.37), "cowl": (0.31, 0.29, 0.26), "coat": (0.39, 0.30, 0.23),
            "skirt": (0.36, 0.27, 0.21), "blade": (0.80, 0.80, 0.76), "heel": (0.28, 0.26, 0.25),
            "gems": (0.25, 0.55, 0.95), "haft": (0.35, 0.24, 0.16), "pommel": (0.25, 0.24, 0.23)}


def sheet(rows, body, bpart, cnames, pose_cleaver, anchor, out):
    from common import scene
    cw, chh = 200, 230
    views = [("g", 270), ("g", 90), ("g", 0), ("g", 180), ("g", 225), ("g", 45), ("e", 0), ("e", -28)]
    W, H = cw * len(views), chh * len(rows)
    img = np.full((H, W, 4), 1.0, dtype=np.float32)
    img[..., :3] = 0.62
    brgb = np.array([PART_RGB.get(nm, (0.50, 0.42, 0.34)) for nm in bpart])
    for ri, r in enumerate(rows):
        P, d, up, ok = pose_cleaver(*r["c"])
        crgb = np.array([PART_RGB[nm] for nm in cnames])
        allP = np.concatenate([body, P])
        allc = np.concatenate([brgb, crgb])
        for vi, (kind, yd) in enumerate(views):
            if kind == "g":
                x, v, dp = game_proj(allP, yd)
                scale = 1.0
                ox, oy = cw * vi + cw * 0.5, chh * ri + chh - 40
            else:
                x, v, dp = eye_proj(allP, yd)
                scale = 0.62
                x, v = x * scale, v * scale
                ox, oy = cw * vi + cw * 0.5, chh * ri + chh - 12
            order = np.argsort(dp)
            xi = np.round(ox + x[order]).astype(int)
            yi = np.round(oy - v[order]).astype(int)
            cc = allc[order]
            # light from the camera's upper left: a cheap value cue by depth
            for dx in (0, 1):
                for dy in (0, 1):
                    ok_ = (xi + dx >= cw * vi) & (xi + dx < cw * (vi + 1)) & (yi + dy >= chh * ri) & (yi + dy < chh * (ri + 1))
                    img[yi[ok_] + dy, xi[ok_] + dx, :3] = cc[ok_]
            if kind == "g":
                by = int(round(oy - anchor))
                x0, x1 = int(ox - 76), int(ox + 54)
                img[max(by - 9, 0):by + 9, x0:x1, :3] = (0.12, 0.12, 0.12)
                img[max(by - 6, 0):by + 6, x0 + 24:x1 - 3, :3] = (0.35, 0.85, 0.55)
                img[max(by - 25, 0):by - 12, int(ox - 45):int(ox + 45), :3] = (0.92, 0.92, 0.92)
        img[chh * ri:chh * ri + 1, :, :3] = 0.2
    for vi in range(len(views)):
        img[:, cw * vi:cw * vi + 1, :3] = 0.2
    path = os.path.join(scene.ART_DIR, "renders", "fighters", "burdam", out)
    im = bpy.data.images.new("carry6", W, H, alpha=True)
    im.pixels.foreach_set(np.flipud(img).ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    print(f"sheet -> {path}")


if __name__ == "__main__":
    main()
