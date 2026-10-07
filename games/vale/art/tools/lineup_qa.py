"""VALE readability QA: a roster lineup at the GAME camera (STYLE_BIBLE "In-game camera", "Look rules").

    python3 art/tools/lineup_qa.py -- a.glb b.glb ... [--name lineup] [--facings 0,90,180,270] [--samples 16]
    blender -b --factory-startup --python art/tools/lineup_qa.py -- a.glb b.glb ...

Each GLB is imported, posed at `idle` frame 0 and rendered ALONE at the focus of the gameplay camera
(pitch 52 deg, vertical FOV 26 deg, 28.5 m, 1920x1080: a 1.9 m fighter is ~96 px tall) with a fast
Cycles pass, once per facing (0 = facing the camera). Lighting is the bible's fighter key (view
225 deg / 45 deg, 0.9 x the map sun) over the map_rift sky ambient, tone mapped with Khronos PBR
Neutral and graded with vale_grade_01, exactly the game's chain. Passes per fighter:
  colour      what the player sees (composited on the lane colour)
  value       CIE L* of the colour pass (grayscale test)
  silhouette  black alpha mask
  id          accent vs body (flat emission ids) for the accent share
Metrics (JSON + sheet in art/renders/lineup/<name>.{png,json}):
  heightPx          silhouette height at 1080p (bible: 96 px for a 1.9 m fighter)
  valueBands        mean L* of the top quarter / middle half / bottom quarter of the silhouette
                    (bible / tokens.json fighter.valueLstar: 70-85 / 45-65 / 20-35)
  accent            accent pixels as % of the silhouette, and the share of them in the top half
                    (bible: <= 5 %, top half)
  iou64             pairwise silhouette IoU at 64 px (the 720p size of a standard fighter), masks
                    aligned on the fighter's origin, per facing; the gate is the max over facings
                    (bible: <= 0.80). Pairs of the same fighter (base vs `<id>_<variant>` skins)
                    are reported but not gated (skins keep the silhouette class on purpose).
  iou64_norm        the same with every silhouette scaled to 64 px tall (shape only, height removed)
"""
from __future__ import annotations

import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ART, "blender"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import imageops, render, scene  # noqa: E402

V = Vector
PITCH, VFOV, DIST, W, H = 52.0, 26.0, 28.5, 1920, 1080
CROP = 200                          # px window over the focus at 1080p (fits a 2.4 m fighter + weapon)
BANDS = {"top": (70, 85), "mid": (45, 65), "bottom": (20, 35)}
LANE = "#9A927F"                    # tokens.json colors.terrain-ref.lane


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = {"glbs": [], "name": "lineup", "facings": [0, 90, 180, 270], "samples": 16, "names": None}
    i = 0
    while i < len(a):
        k = a[i]
        if k in ("--name", "--facings", "--samples", "--names"):
            v = a[i + 1]
            out[k[2:]] = ([int(x) for x in v.split(",")] if k == "--facings" else int(v) if k == "--samples"
                          else v.split(",") if k == "--names" else v)
            i += 2
        else:
            out["glbs"].append(os.path.abspath(k))
            i += 1
    if not out["glbs"]:
        raise SystemExit(__doc__)
    return out


def import_glb(path: str):
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before_o]
    acts = [a for a in bpy.data.actions if a not in before_a]
    arm = next((o for o in objs if o.type == "ARMATURE"), None)
    idle = next((a for a in acts if a.name.split(".")[0] in ("idle",) or a.name.startswith("idle_")), None)
    if arm is not None:
        ad = arm.animation_data or arm.animation_data_create()
        for t in ad.nla_tracks:
            t.mute = True
        if idle is not None:
            ad.action = idle
            if getattr(idle, "slots", None) and len(idle.slots):
                try:
                    ad.action_slot = idle.slots[0]
                except Exception:
                    pass
    root = [o for o in objs if o.parent is None]
    return {"objs": objs, "arm": arm, "roots": root, "meshes": [o for o in objs if o.type == "MESH"],
            "idle": idle.name if idle else None}


def assign_action(entry, act) -> None:
    arm = entry["arm"]
    if arm is None or act is None:
        return
    ad = arm.animation_data or arm.animation_data_create()
    for t in ad.nla_tracks:
        t.mute = True
    ad.action = act
    if getattr(act, "slots", None) and len(act.slots):
        try:
            ad.action_slot = act.slots[0]
        except Exception:
            pass
    entry["idle"] = act.name


def set_visible(entry, on: bool):
    for o in entry["objs"]:
        o.hide_render = not on
        o.hide_viewport = not on


def set_yaw(entry, yaw_deg: float):
    for o in entry["roots"]:
        o.rotation_mode = "XYZ"
        o.rotation_euler = (o.rotation_euler.x, o.rotation_euler.y, math.radians(yaw_deg))


def game_camera():
    cam = render.camera("lineup_cam")
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 24.0
    cam.data.lens = 12.0 / math.tan(math.radians(VFOV / 2))
    p = math.radians(PITCH)
    cam.location = V((0.0, -math.cos(p) * DIST, math.sin(p) * DIST))       # south of the focus, looking north (+Y)
    cam.rotation_euler = (V((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.shift_x = cam.data.shift_y = 0.0
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = W, H
    bpy.context.view_layer.update()
    return cam


def crop_border():
    sc = bpy.context.scene
    cx, cy = W / 2, H / 2 + 55                           # the feet stand on the focus: the window sits above it
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x = (cx - CROP / 2) / W
    sc.render.border_max_x = (cx + CROP / 2) / W
    sc.render.border_min_y = (cy - CROP / 2) / H
    sc.render.border_max_y = (cy + CROP / 2) / H


def lights(cam, light):
    cfg = dict(render.SPLASH_DEFAULTS)
    render.clear_lights()
    render.sun_lamp(render.view_dir_light(cam, cfg["key_az"], cfg["key_el"]), light["sunIntensity"] * 0.9,
                    scene.hex_rgb(light["sunColor"]))
    render.sky_world(light["sky"], light["ambient"])


def id_materials(entries, on: bool, saved: dict):
    """Swap every material's surface to a flat emission id (accent red, others white) and back."""
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out is None:
            continue
        if on:
            saved[m.name] = [l.from_socket for l in out.inputs["Surface"].links]
            em = nt.nodes.new("ShaderNodeEmission")
            em.name = "_lineup_id"
            em.inputs["Color"].default_value = (1, 0, 0, 1) if m.name.startswith("accent") else (1, 1, 1, 1)
            nt.links.new(em.outputs[0], out.inputs["Surface"])
        else:
            em = nt.nodes.get("_lineup_id")
            if em is not None:
                nt.nodes.remove(em)
            for s in saved.get(m.name, []):
                nt.links.new(s, out.inputs["Surface"])


def rend(path: str, samples: int, view: str = "Khronos PBR Neutral"):
    render.setup(W, H, samples, transparent=True, noise=0.05, view=view)
    crop_border()
    render.render(path)
    a = imageops.load(path)
    os.remove(path)
    return a


def resize_mask(m: np.ndarray, f: float) -> np.ndarray:
    h, w = m.shape
    nh, nw = max(1, int(round(h / f))), max(1, int(round(w / f)))
    r = imageops.resize(m[..., None].astype(np.float32), nw, nh)[..., 0]
    return r > 0.5


def iou(a: np.ndarray, b: np.ndarray) -> float:
    u = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / u) if u else 0.0


def norm64(m: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(m)
    if not len(ys):
        return np.zeros((64, 64), bool)
    c = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.float32)
    h, w = c.shape
    s = 64.0 / max(h, w)
    nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
    r = imageops.resize(c[..., None], nw, nh)[..., 0] > 0.5
    out = np.zeros((64, 64), bool)
    y0, x0 = 64 - nh, (64 - nw) // 2
    out[y0:y0 + nh, x0:x0 + nw] = r
    return out


def same_fighter(a: str, b: str) -> bool:
    return a.startswith(b + "_") or b.startswith(a + "_") or a == b


def main():
    A = args()
    t_all = time.perf_counter()
    scene.reset()
    names = A["names"] or [os.path.splitext(os.path.basename(g))[0] for g in A["glbs"]]
    entries = []
    for g in A["glbs"]:
        entries.append(import_glb(g))
    # skins ship no clips: the client plays the BASE fighter's clips on them by bone name; do the same
    for e, nm in zip(entries, names):
        if e["idle"] is None:
            base = max((b for b in names if nm.startswith(b + "_")), key=len, default=None)
            be = entries[names.index(base)] if base else None
            if be is not None and be["idle"]:
                assign_action(e, bpy.data.actions[be["idle"]])
                e["idleFrom"] = base
    cam = game_camera()
    light = render.map_lighting("map_rift")
    lights(cam, light)
    outdir = scene.ensure_dir(os.path.join(scene.RENDERS_DIR, "lineup"))
    tmp = os.path.join(outdir, "_tmp.png")
    lane = np.array(scene.hex_srgb(LANE), np.float32)
    res = {"camera": {"pitchDeg": PITCH, "vfovDeg": VFOV, "distance": DIST, "resolution": [W, H],
                      "light": "fighter key view 225/45 x0.9 sun + map_rift sky ambient, PBR Neutral + vale_grade_01"},
           "fighters": {}, "facings": A["facings"]}
    masks = {}
    cells = {"colour": [], "value": [], "sil": []}
    saved = {}
    for e, nm in zip(entries, names):
        for o in entries:
            set_visible(o, o is e)
        bpy.context.scene.frame_set(0)
        info = {"glb": scene.rel(A["glbs"][names.index(nm)]), "idleAction": e["idle"], "facings": {}}
        if e.get("idleFrom"):
            info["clipsFrom"] = e["idleFrom"]
        masks[nm] = {}
        for f in A["facings"]:
            set_yaw(e, f)
            bpy.context.view_layer.update()
            col = rend(tmp, A["samples"])
            alpha = col[..., 3]
            sil = alpha > 0.5
            id_materials(entries, True, saved)
            idp = rend(tmp, 4, view="Standard")
            id_materials(entries, False, saved)
            graded = imageops.grade(col)
            rgb = graded[..., :3]
            L = imageops.srgb_lstar(np.clip(rgb, 0, 1))
            ys, xs = np.nonzero(sil)
            fi = {}
            if len(ys):
                y0, y1 = ys.min(), ys.max()
                hgt = y1 - y0 + 1
                fi["heightPx"] = int(hgt)
                rows = np.arange(sil.shape[0])[:, None]
                top = sil & (rows < y0 + 0.25 * hgt)
                bot = sil & (rows > y1 - 0.25 * hgt)
                mid = sil & ~top & ~bot
                # alpha-weighted mean L* of fully covered pixels per band
                core = alpha > 0.95
                fi["valueBands"] = {k: round(float(L[m & core].mean()), 1) if (m & core).any() else None
                                    for k, m in (("top", top), ("mid", mid), ("bottom", bot))}
                acc = sil & (idp[..., 0] > 0.5) & (idp[..., 1] < 0.35)
                n_acc = int(acc.sum())
                tophalf = sil & (rows < y0 + 0.5 * hgt)
                fi["accentPct"] = round(100.0 * n_acc / sil.sum(), 2)
                fi["accentTopHalfShare"] = round(float((acc & tophalf).sum() / n_acc), 3) if n_acc else None
                fi["accentTopHalfPctOfFighter"] = round(100.0 * float((acc & tophalf).sum()) / sil.sum(), 2)
            info["facings"][str(f)] = fi
            masks[nm][f] = sil
            if f == A["facings"][0]:
                comp = rgb * alpha[..., None] + lane[None, None, :] * (1 - alpha[..., None])
                cells["colour"].append(np.concatenate([comp, np.ones_like(alpha)[..., None]], 2))
                Lg = np.clip(L / 100.0, 0, 1)
                laneL = float(imageops.srgb_lstar(lane[None, None, :])[0, 0]) / 100.0
                vimg = Lg * alpha + laneL * (1 - alpha)
                cells["value"].append(np.concatenate([np.repeat(vimg[..., None], 3, 2), np.ones_like(alpha)[..., None]], 2))
                s3 = np.where(sil, 0.0, 1.0).astype(np.float32)
                cells["sil"].append(np.concatenate([np.repeat(s3[..., None], 3, 2), np.ones_like(alpha)[..., None]], 2))
        f0 = info["facings"][str(A["facings"][0])]
        vb = f0.get("valueBands") or {}
        info["valueGradientOk"] = all(vb.get(k) is not None and lo <= vb[k] <= hi for k, (lo, hi) in BANDS.items())
        info["valueGradientMonotone"] = bool(vb and vb.get("top") and vb.get("bottom") and vb["top"] > vb["mid"] > vb["bottom"])
        accs = [fi.get("accentPct", 0) for fi in info["facings"].values()]
        tops = [fi.get("accentTopHalfShare") or 0 for fi in info["facings"].values()]
        info["accentPctMax"] = max(accs)
        info["accentOk"] = max(accs) <= 5.0 and min(tops) >= 0.9 and min(accs) >= 1.0
        res["fighters"][nm] = info
        scene.log(f"{nm}: height {f0.get('heightPx')} px, value bands {vb}, accent {[float(a) for a in accs]} %")
    # pairwise IoU
    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            per, pern = {}, {}
            for f in A["facings"]:
                m1, m2 = masks[a][f], masks[b][f]
                per[str(f)] = round(iou(resize_mask(m1, 1.5), resize_mask(m2, 1.5)), 3)    # 1080p -> 720p (64 px)
                pern[str(f)] = round(iou(norm64(m1), norm64(m2)), 3)
            sf = same_fighter(a, b)
            mx = max(per.values())
            pairs.append({"a": a, "b": b, "sameFighter": sf, "iou64": per, "iou64Max": mx,
                          "iou64_norm": pern, "iou64NormMax": max(pern.values()),
                          "ok": True if sf else mx <= 0.80})
    res["pairs"] = pairs
    res["silhouetteOk"] = all(p["ok"] for p in pairs)
    # sheet: colour / value / silhouette rows at 2x (nearest) of the true 1080p pixels
    def up2(a):
        return np.repeat(np.repeat(a, 2, 0), 2, 1)
    rows = [up2(c) for c in cells["colour"]] + [up2(c) for c in cells["value"]] + [up2(c) for c in cells["sil"]]
    sheet = imageops.grid(rows, len(names), pad=6)
    png = os.path.join(outdir, f"{A['name']}.png")
    imageops.save(sheet, png, alpha=False)
    cw = CROP * 2 + 6
    labels = []
    for k, nm in enumerate(names):
        fi = res["fighters"][nm]
        vb = (fi["facings"][str(A["facings"][0])].get("valueBands") or {})
        labels.append((6 + k * cw + 4, 10, nm[:34]))
        labels.append((6 + k * cw + 4, 6 + cw * 1 + 4, f"L* {vb.get('top')}/{vb.get('mid')}/{vb.get('bottom')}"))
        labels.append((6 + k * cw + 4, 6 + cw * 2 + 4, f"accent {fi['accentPctMax']}%"))
    imageops.label(png, labels)
    res["sheet"] = scene.rel(png)
    res["seconds"] = round(time.perf_counter() - t_all, 1)
    scene.write_json(os.path.join(outdir, f"{A['name']}.json"), res)
    scene.log(f"lineup -> {scene.rel(png)} in {res['seconds']} s; silhouetteOk={res['silhouetteOk']}")
    for p in pairs:
        scene.log(f"  IoU64 {p['a']} vs {p['b']}: max {p['iou64Max']} (norm {p['iou64NormMax']})"
                  f"{' [same fighter]' if p['sameFighter'] else ''}")


if __name__ == "__main__":
    main()
