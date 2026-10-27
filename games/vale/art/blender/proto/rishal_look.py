"""Rishal look / concept-pose check on the cached build (art/.cache/fighters/rishal.blend, written by
`art/build.py fighter rishal`).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/rishal_look.py -- \
        [--mode pose,views] [--res 900] [--clip idle --frame 0]

pose   the mesh posed like each view of the painting (rishal.CONCEPT_POSE), orthographic at the plates' own frame:
       _fit/pose_{front,back}.png = the concept with the posed silhouette (red: model only, green: painting only)
       and the textured posed render beside the painting crop (the paint must reproduce the painting), IoU printed
views  the game material at rest (or a clip frame): orthographic front / back, a three-quarter, the 52 degree game
       camera -> _fit/look.png
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import anim, scene  # noqa: E402

OUT = os.path.join(scene.RENDERS_DIR, "fighters", "rishal", "_fit")
GAME = os.path.dirname(os.path.dirname(scene.RENDERS_DIR))


def look(obj, p, t):
    from mathutils import Vector
    d = Vector(t) - Vector(p)
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def img_array(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1].copy()


def save_array(arr, path):
    h, w = arr.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :arr.shape[2]] = arr[..., :4]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.pixels.foreach_set(rgba[::-1].ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def setup(sc):
    for m in bpy.data.materials:
        if m.use_nodes:
            for nd in m.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED":
                    for lk in list(nd.inputs["Alpha"].links):
                        m.node_tree.links.remove(lk)
                    nd.inputs["Alpha"].default_value = 1.0
    sc.render.engine = "BLENDER_EEVEE"
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("cmp")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.62, 0.62, 0.64, 1)
    bg.inputs["Strength"].default_value = 1.0
    key = bpy.data.lights.new("cmp_key", "SUN")
    key.energy = 2.4
    ko = bpy.data.objects.new("cmp_key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(40), 0, math.radians(-25))


def camera(sc, name):
    cam = bpy.data.cameras.new(name)
    co = bpy.data.objects.new(name, cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return cam, co


def plate_camera(sc, side, meta, height):
    info = meta[side]
    k = (info["ground"] - info["top"]) / height
    W, H = meta["size"]
    cam, co = camera(sc, f"plate_{side}")
    cam.type = "ORTHO"
    cam.sensor_fit = "VERTICAL"
    cam.ortho_scale = H / k
    sc.render.resolution_x, sc.render.resolution_y = W // 2, H
    pxc = W / 4 if side == "front" else 3 * W / 4
    zc = (info["ground"] - H / 2) / k
    if side == "front":
        xc = (pxc - info["cx"]) / k
        co.location = (xc, -8.0, zc)
        co.rotation_euler = (math.radians(90), 0, 0)
    else:
        xc = -(pxc - info["cx"]) / k
        co.location = (xc, 8.0, zc)
        co.rotation_euler = (math.radians(90), 0, math.radians(180))
    return co


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def run_pose(sc, arm, R, res_scale=1.0):
    meta = json.load(open(os.path.join(scene.CACHE_DIR, "concept", "rishal_plates.json")))
    concept = img_array(os.path.join(GAME, "_design", "concept", "rishal.webp"))[..., :3]
    mask = img_array(os.path.join(scene.CACHE_DIR, "concept", "rishal_mask.png"))[..., 0] > 0.5
    mask = dilate(mask, 7)
    W, H = meta["size"]
    names = [p_[0] for p_ in R.sculpts()]
    bodies = [o for o in sc.objects if o.type == "MESH" and o.name in ("rishal", "rishal_accent")]
    for side in ("front", "back"):
        copies = []
        for b in bodies:
            c_ = R.posed_copy(b, R.CONCEPT_POSE[side], f"_pc_{b.name}", side, names)
            sc.collection.objects.link(c_)
            copies.append(c_)
            b.hide_render = True
        plate_camera(sc, side, meta, R.HEIGHT)
        sc.render.film_transparent = True
        path = os.path.join(OUT, f"_pose_{side}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        rgba = img_array(path)
        sil = rgba[..., 3] > 0.5
        x0 = 0 if side == "front" else W // 2
        C = mask[:, x0:x0 + W // 2]
        img = concept[:, x0:x0 + W // 2].copy()
        both = sil & C
        iou = both.sum() / max(1, (sil | C).sum())
        a_ = rgba[..., 3:4]
        ov = rgba[..., :3] * a_ * 0.8 + img * (1 - a_ * 0.8)
        ec = C & ~(np.roll(C, 1, 0) & np.roll(C, -1, 0) & np.roll(C, 1, 1) & np.roll(C, -1, 1))
        ec = ec | np.roll(ec, 1, 1) | np.roll(ec, 1, 0)
        ov[ec] = (0.0, 0.9, 0.1)
        # textured posed render composited on grey beside the painting
        tex = rgba[..., :3] * rgba[..., 3:4] + 0.80 * (1 - rgba[..., 3:4])
        ys, xs = np.nonzero(C | sil)
        y0, y1 = max(0, ys.min() - 20), min(H, ys.max() + 20)
        xa, xb = max(0, xs.min() - 20), min(W // 2, xs.max() + 20)
        sheet = np.concatenate([ov[y0:y1, xa:xb], img[y0:y1, xa:xb], tex[y0:y1, xa:xb]], axis=1)
        save_array(sheet, os.path.join(OUT, f"pose_{side}.png"))
        os.remove(path)
        for c_ in copies:
            bpy.data.objects.remove(c_)
        for b in bodies:
            b.hide_render = False
        ry, rx = np.nonzero(sil & ~C)
        gy, gx = np.nonzero(C & ~sil)
        print(f"[rishal_look] {side}: red (model only) centroid x {rx.mean():.0f}, green (painting only) x {gx.mean():.0f}; "
              f"render {rgba.shape}, mask {C.shape}")
        cy, cxm = np.nonzero(sil)
        dy, dxm = np.nonzero(C)
        print(f"[rishal_look] {side}: posed silhouette IoU {iou:.3f}; centroid model ({cxm.mean():.0f}, {cy.mean():.0f}) "
              f"concept ({dxm.mean():.0f}, {dy.mean():.0f}); rows model {cy.min()}-{cy.max()} concept {dy.min()}-{dy.max()}")
    anim.apply_pose(arm, {})
    sc.render.film_transparent = False


def repaint(sc, R):
    """the current module's paint on the cached body, written into its base colour image (no AO multiply)"""
    body = sc.objects["rishal"]
    names = [p_[0] for p_ in R.sculpts()]
    mat = body.data.materials[0]
    bs = next(nd for nd in mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
    src = bs.inputs["Base Color"].links[0].from_node
    while src.type != "TEX_IMAGE":
        src = next(i.links[0].from_node for i in src.inputs if i.links)
    img = src.image
    size = img.size[0]
    rgb = R.paint_object(body, size, R.PROJECTION, names)
    a = np.ones((size, size, 4), dtype=np.float32)
    a[..., :3] = rgb[::-1]
    img.pixels.foreach_set(a.ravel())
    img.update()
    print("[rishal_look] repainted", img.name, size)


def run_views(sc, arm, res, clip=None, frame=0.0, tag="", head=False):
    if clip:
        anim.set_action_frame(arm, clip, frame)
    tiles = []
    for kind in (("front", "back", "threeq", "game") if not head else ("hfront", "hthreeq", "hside", "hback")):
        cam, co = camera(sc, kind)
        if kind.startswith("h"):
            cam.lens = 85
            tgt = (0.0, -0.02, 1.66)
            p = {"hfront": (0.0, -2.2, 1.70), "hthreeq": (-1.3, -1.75, 1.85), "hside": (2.2, -0.05, 1.70),
                 "hback": (0.9, 2.0, 1.85)}[kind]
            co.location = p
            look(co, p, tgt)
        elif kind in ("front", "back"):
            cam.type = "ORTHO"
            cam.ortho_scale = 2.05
            cam.sensor_fit = "VERTICAL"
            y = -6.0 if kind == "front" else 6.0
            co.location = (0, y, 0.98)
            co.rotation_euler = (math.radians(90), 0, 0 if kind == "front" else math.radians(180))
        elif kind == "threeq":
            cam.lens = 70
            p = (-3.0, -5.6, 2.1)
            co.location = p
            look(co, p, (0, 0, 0.98))
        else:
            cam.lens = 150
            p = (0.0, -7.5, 0.98 + 7.5 * math.tan(math.radians(52)))
            co.location = p
            look(co, p, (0, 0, 0.98))
        sc.render.resolution_x, sc.render.resolution_y = int(res * 0.75), res
        path = os.path.join(OUT, f"_look_{kind}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tiles.append(img_array(path)[..., :3])
        os.remove(path)
    sheet = np.concatenate(tiles, axis=1)
    save_array(sheet, os.path.join(OUT, f"look{tag}.png"))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="pose,views")
    ap.add_argument("--res", type=int, default=900)
    ap.add_argument("--clip", default="")
    ap.add_argument("--frame", type=float, default=0.0)
    ap.add_argument("--repaint", action="store_true", help="re-run rishal's projection paint on the cached body first")
    a = ap.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "rishal.blend"))
    import rishal as R
    sc = bpy.context.scene
    arm = None
    for o in sc.objects:
        if o.type == "ARMATURE":
            arm = o
            o.data.pose_position = "POSE"
            if o.animation_data:
                o.animation_data.action = None
        if o.type == "MESH":
            o.hide_render = o.name not in ("rishal", "rishal_accent")
        if o.type in ("LIGHT", "CAMERA"):
            o.hide_render = True
    setup(sc)
    os.makedirs(OUT, exist_ok=True)
    if a.repaint:
        repaint(sc, R)
    modes = a.mode.split(",")
    if "pose" in modes:
        run_pose(sc, arm, R)
    if "head" in modes:
        anim.apply_pose(arm, {})
        run_views(sc, arm, a.res, None, 0.0, "_head", head=True)
    if "views" in modes:
        anim.apply_pose(arm, {})
        run_views(sc, arm, a.res, a.clip or None, a.frame, f"_{a.clip}_{int(a.frame)}" if a.clip else "")


if __name__ == "__main__":
    main()
