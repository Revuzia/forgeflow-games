"""Contact sheets for CMU segments: 4 stick-figure frames per segment
(start, mid-windup, contact, recovery end) in a 3/4 front-right view, plus a
top view and a side view of the strike path. Left limbs blue, right limbs red,
striking limb drawn thick with a yellow trail.

Usage: python cmu_sheets.py <segments.json> <out_dir> <prefix> [rows_per_sheet] [filter_expr]
filter_expr: python expression over `s` (segment dict), e.g. "s['kind']=='hand'"
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cmu_segment as CS  # noqa: E402

LABEL_W = 210
PW = 175
PH = 215
TW = 150
FONT = None
for fp in ("C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/arial.ttf"):
    if os.path.exists(fp):
        FONT = ImageFont.truetype(fp, 12)
        FONT_S = ImageFont.truetype(fp, 11)
        break
if FONT is None:
    FONT = FONT_S = ImageFont.load_default()

SKIP = ("Finger", "Index", "Thumb", "LThumb", "RThumb")
_cache = {}


def get_take(t):
    if t not in _cache:
        if len(_cache) > 6:
            _cache.clear()
        _cache[t] = CS.Take(t)
    return _cache[t]


def bones(T):
    out = []
    for j in T_joints(T):
        if j.parent is None:
            continue
        if any(k in j.name for k in SKIP) or any(k in j.parent.name for k in SKIP):
            continue
        if j.name.endswith("_End") and not (j.name.startswith("Head") or "Toe" in j.name):
            continue
        out.append((j.parent.name, j.name))
    return out


def T_joints(T):
    import bvh_lib as B
    if not hasattr(T, "_joints"):
        T._joints = B.BVH(CS.take_path(T.take)).joints
    return T._joints


def frame_basis(fwd):
    fwd = np.array([fwd[0], fwd[1], 0.0])
    fwd /= np.linalg.norm(fwd) + 1e-9
    left = np.array([-fwd[1], fwd[0], 0.0])
    return fwd, left


def view_axes(fwd, left, az_deg=40.0, el_deg=14.0, side=1.0):
    """side=+1 camera on the subject's RIGHT, -1 on the LEFT."""
    az = np.radians(az_deg)
    el = np.radians(el_deg)
    cam = np.cos(el) * (np.cos(az) * fwd + side * np.sin(az) * (-left)) + np.sin(el) * np.array([0, 0, 1.0])
    view = -cam
    sx = np.cross(view, [0, 0, 1.0])
    sx /= np.linalg.norm(sx)
    sy = np.cross(sx, view)
    if np.dot(sx, fwd) < 0:
        sx = -sx  # mirror so the subject's forward is always screen-RIGHT
    return view, sx, sy


def draw_path(draw, T, s, e, c, origin, fwd, left, ox, oy, eff, mode):
    """mode 'top': x=-left (right), y=fwd up.  mode 'side': x=fwd, y=z."""
    pts = T.p[s:e + 1, T.I[eff]] - origin
    hips = T.p[s:e + 1, T.I["Hips"]] - origin
    if mode == "top":
        X = -pts @ left
        Y = pts @ fwd
        HX = -hips @ left
        HY = hips @ fwd
    else:
        X = pts @ fwd
        Y = pts[:, 2] - (T.floor - origin[2])
        HX = hips @ fwd
        HY = hips[:, 2] - (T.floor - origin[2])
    sc = 52.0
    cx = ox + TW / 2
    cy = oy + PH / 2 + (10 if mode == "top" else 70)

    def m(x, y):
        return cx + sc * x, cy - sc * y
    draw.rectangle([ox + 2, oy + 2, ox + TW - 2, oy + PH - 2], outline=(200, 200, 200))
    if mode == "side":
        draw.line([m(-1.1, 0), m(1.1, 0)], fill=(170, 170, 170))
    else:
        draw.line([m(0, 0), m(0, 0.6)], fill=(0, 160, 0), width=2)
    draw.line([m(x, y) for x, y in zip(HX, HY)], fill=(150, 150, 150), width=2)
    n = len(X)
    for k in range(n - 1):
        t = k / max(1, n - 2)
        col = (int(40 + 215 * t), 60, int(255 - 215 * t))
        draw.line([m(X[k], Y[k]), m(X[k + 1], Y[k + 1])], fill=col, width=2)
    kc = c - s
    if 0 <= kc < n:
        x, y = m(X[kc], Y[kc])
        draw.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(0, 0, 0), width=2)
    draw.text((ox + 5, oy + 4), "TOP (fwd up)" if mode == "top" else "SIDE (fwd right)", fill=(90, 90, 90), font=FONT_S)


def seg_geometry(T, sg):
    s, c, e = sg["start"], sg["contact"], sg["end"]
    kind = sg.get("kind")
    limb = sg.get("limb", "body")
    if kind == "hand":
        S = "Left" if limb.startswith("L") else "Right"
        eff = S + "HandIndex1_End"
        att = T.P(eff, c) - T.P("Spine1", c)
        if np.linalg.norm(att[:2]) < 0.08:
            att = T.hips_fwd[s]
        fwd = att
        prefix = (S + "Arm", S + "ForeArm", S + "Hand")
    elif kind in ("foot", "knee"):
        S = "Left" if limb.startswith("L") else "Right"
        eff = S + ("Foot" if kind == "foot" else "Leg")
        kd = T.P(eff, c) - T.P("Hips", c)
        fwd = kd if np.linalg.norm(kd[:2]) > 0.2 else T.hips_fwd[s]
        prefix = (S + "UpLeg", S + "Leg", S + "Foot", S + "ToeBase")
    else:
        eff = "Head_End"
        fwd = T.hips_fwd[e]
        prefix = None
    frames = [s, (s + c) // 2, c, e] if kind in ("hand", "foot", "knee") else \
        [s, s + (e - s) // 3, s + 2 * (e - s) // 3, e]
    side = 0.0
    if kind in ("hand", "foot", "knee"):
        side = 1.0 if limb.startswith("R") else -1.0
    return eff, fwd, prefix, frames, side


def render_sheet(segs, path, title):
    rows = len(segs)
    W = LABEL_W + 4 * PW + 2 * TW
    H = 28 + rows * PH
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((6, 6), title, fill=(0, 0, 0), font=FONT)
    for r, sg in enumerate(segs):
        T = get_take(sg["take"])
        oy = 28 + r * PH
        d.line([(0, oy), (W, oy)], fill=(210, 210, 210))
        eff, fwd, prefix, frames, side = seg_geometry(T, sg)
        fwd, left = frame_basis(fwd)
        origin = T.p[sg["start"], T.I["Hips"]].copy()
        origin[2] = T.floor
        lines = ["#%s  %s" % (sg.get("id", r), sg["take"]),
                 "s/c/e %d/%d/%d" % (sg["start"], sg["contact"], sg["end"]),
                 "dur %.2fs @%.0ffps" % ((sg["end"] - sg["start"]) / sg["fps"], sg["fps"]),
                 ("%s [%s]" % (sg["class"], sg["quality"]) if "quality" in sg else "AUTO: %s" % sg["class"]),
                 "limb %s" % sg.get("limb")]
        if sg.get("kind") == "hand" and "elbow_deg" in sg:
            lines += ["pk %.1fm/s elb %.0f" % (sg["peak_speed_ms"], sg["elbow_deg"]),
                      "v f%.2f l%.2f u%.2f" % (sg["v_fwd"], sg["v_lat"], sg["v_up"]),
                      "lead %s  hChest %.2f" % (sg["lead"], sg["h_rel_chest_m"])]
        elif sg.get("kind") in ("foot", "knee") and "yaw_turn_deg" in sg:
            lines += ["pk %.1fm/s yaw %.0f" % (sg["peak_speed_ms"], sg["yaw_turn_deg"]),
                      "v f%.2f l%.2f u%.2f" % (sg["v_fwd"], sg["v_lat"], sg["v_up"]),
                      "footH %.2f supH %.2f" % (sg["foot_h_m"], sg["support_foot_h_m"])]
        else:
            lines += ["kind %s (side view," % sg.get("kind"), " panels follow hips)"]
        lines += ["drift %.1fcm pops %d" % (sg["foot_drift_cm"], sg["pops"])]
        for k, ln in enumerate(lines):
            d.text((6, oy + 6 + 15 * k), ln, fill=(0, 0, 0), font=FONT)
        labels = ["start", "windup", "CONTACT", "end"] if sg.get("kind") in ("hand", "foot", "knee") else \
            ["start", "1/3", "2/3", "end"]
        for k, f in enumerate(frames):
            ox = LABEL_W + k * PW
            d.rectangle([ox + 1, oy + 1, ox + PW - 1, oy + PH - 1], outline=(225, 225, 225))
            trail = T.p[sg["start"]:f + 1, T.I[eff]] if f > sg["start"] else None
            pref = prefix if prefix else ()
            org = origin
            if side == 0.0:
                org = T.p[f, T.I["Hips"]].copy()
                org[2] = T.floor
            draw_pose_multi(d, T, f, org, fwd, left, ox, oy, pref, trail, side)
            d.text((ox + 5, oy + 4), "%s f%d  fwd->" % (labels[k], f), fill=(0, 0, 0), font=FONT_S)
        draw_path(d, T, sg["start"], sg["end"], sg["contact"], origin, fwd, left,
                  LABEL_W + 4 * PW, oy, eff, "top")
        draw_path(d, T, sg["start"], sg["end"], sg["contact"], origin, fwd, left,
                  LABEL_W + 4 * PW + TW, oy, eff, "side")
    img.save(path)


def draw_pose_multi(d, T, f, origin, fwd, left, ox, oy, prefixes, trail, side):
    if side == 0.0:
        view, sx, sy = view_axes(fwd, left, 90.0, 12.0, 1.0)
    else:
        view, sx, sy = view_axes(fwd, left, 62.0, 14.0, side)
    P = T.p[f]
    I = T.I
    scale = 95.0

    def proj(p):
        q = p - origin
        return ox + PW / 2 + scale * np.dot(q, sx), oy + PH - 22 - scale * np.dot(q, sy)
    fl = np.array([origin[0], origin[1], T.floor])
    c0 = proj(fl)
    d.line([c0, proj(fl + 0.5 * fwd)], fill=(0, 160, 0), width=2)
    for dd in (left, -left, -fwd):
        d.line([c0, proj(fl + 0.3 * dd)], fill=(175, 175, 175), width=1)
    segs = []
    for a, b in bones(T):
        pa, pb = P[I[a]], P[I[b]]
        segs.append((np.dot((pa + pb) / 2 - origin, view), a, b, pa, pb))
    segs.sort(key=lambda x: -x[0])
    if trail is not None and len(trail) > 1:
        d.line([proj(x) for x in trail], fill=(255, 215, 0), width=2)
    for depth, a, b, pa, pb in segs:
        if prefixes and a in prefixes:
            col, w = (255, 150, 0), 5
        elif b.startswith("Left") or b.startswith("LHip"):
            col, w = (40, 90, 255), 3
        elif b.startswith("Right") or b.startswith("RHip"):
            col, w = (230, 40, 40), 3
        else:
            col, w = (60, 60, 60), 3
        d.line([proj(pa), proj(pb)], fill=col, width=w)
    hx, hy = proj(P[I["Head_End"]])
    d.ellipse([hx - 6, hy - 6, hx + 6, hy + 6], outline=(40, 40, 40), width=2)


if __name__ == "__main__":
    segs = json.load(open(sys.argv[1]))
    od = sys.argv[2]
    prefix = sys.argv[3]
    per = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    flt = sys.argv[5] if len(sys.argv) > 5 else "True"
    for i, sg in enumerate(segs):
        sg.setdefault("id", i)
    sel = [s for s in segs if eval(flt)]
    os.makedirs(od, exist_ok=True)
    k = 0
    for i in range(0, len(sel), per):
        chunk = sel[i:i + per]
        p = os.path.join(od, "%s_%02d.png" % (prefix, k))
        render_sheet(chunk, p, "%s sheet %d  (ids %s..%s)" % (prefix, k, chunk[0]["id"], chunk[-1]["id"]))
        print(p)
        k += 1
