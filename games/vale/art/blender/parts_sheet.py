"""PARTS SHEET: every builder of common/parts.py on a neutral VALE_BIPED_1 mannequin, one cell each,
rendered with Cycles (Khronos PBR Neutral + vale_grade_01, the game's chain) into
art/renders/parts/sheet.png. This is the visual catalog fighter artists pick from.

    python3 art/build.py parts [--cell 256] [--samples 24] [--keys mask_,hood_]     (or)
    python3 art/blender/parts_sheet.py -- [--cell 256] [--samples 24] [--keys mask_,hood_]

Materials are the bible defaults (materials.BIBLE_PALETTE) without the value gradient, so each
part shows its own form and material; the accent slot is switched ON everywhere it exists.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402,F401  (first: the bpy wheel registers mathutils on import)
from mathutils import Vector  # noqa: E402

from common import body, imageops, kit, materials, mesh, parts, render, rig, scene  # noqa: E402
from common.fighter import Context  # noqa: E402

V = Vector
OUT = os.path.join(scene.RENDERS_DIR, "parts")
PROPORTIONS = rig.proportions(height=1.9, head=0.30, neck=0.06, shoulder_width=0.48, hip_width=0.20, leg=0.84,
                              arm=0.61, hand=0.21, foot=0.30, ankle_height=0.09, spine_curve=0.02, stance=0.04)
SHAPE = body.shape(girth=1.0, chest=1.04, arm=1.05, forearm=1.18, hand=1.5, neck=1.25, head_w=1.1, head_d=1.06,
                   feet=False, hands=False)


def build_groups(ctx) -> list:
    """[(key, label, view, builder)] - view: head | head_back | upper | upper_back | full | full_back |
    legs | hand | prop | prop_face | hip."""
    P = parts
    G = []

    def add(key, label, view, fn):
        G.append((key, label, view, fn))

    for st in ("oval", "plate", "slit", "half", "beak"):
        add(f"mask_{st}", f"mask {st}", "head", lambda c, st=st: P.mask(c, st, accent=(st == "plate")))
    add("visor_band", "visor band", "head", lambda c: P.mask(c, "oval", eye_scale=0.6) + P.visor(c, "band", target=None, accent=True))
    add("visor_chimney", "visor chimney", "head_wide", lambda c: P.visor(c, "chimney", accent=True))
    add("visor_dome", "visor dome", "head", lambda c: P.mask(c, "oval") + P.visor(c, "dome", accent=True))
    add("hood_deep", "hood deep + crest", "head_wide", lambda c: P.mask(c, "keel") + P.hood(c, "deep", accent=True))
    add("hood_peaked", "hood peaked", "head_wide", lambda c: P.mask(c, "plate") + P.hood(c, "peaked"))
    add("hood_wide", "hood wide", "head_wide", lambda c: P.mask(c, "oval") + P.hood(c, "wide", mat="cloth"))
    add("cowl", "cowl (hood down)", "upper_3q", lambda c: P.mask(c, "slit") + P.cowl(c, accent=True))
    add("wrap", "head wrap", "head_wide", lambda c: P.mask(c, "half") + P.head_wrap(c, accent=True))
    add("collar", "collar", "upper", lambda c: P.collar(c))
    add("mantle_shawl", "mantle shawl + clasp", "upper", lambda c: P.mantle(c, "shawl", accent=True))
    add("mantle_capelet", "mantle capelet", "upper", lambda c: P.mantle(c, "capelet", mat="cloth"))
    add("stole", "stole", "upper", lambda c: P.collar(c) + P.stole(c, accent=True))
    add("pauldron_stone", "pauldron stone", "upper", lambda c: P.collar(c) + P.pauldron(c, "stone", accent=True))
    add("pauldron_wood", "pauldron wood lames", "upper", lambda c: P.pauldron(c, "wood", accent=True))
    add("pauldron_cloth", "pauldron cloth pads", "upper", lambda c: P.pauldron(c, "cloth", mat="cloth2"))
    for kd in ("wood", "stone", "leather", "wrap"):
        add(f"bracer_{kd}", f"bracer {kd}", "forearm", lambda c, kd=kd: P.bracer(c, kd, sides=("L",)))
    add("greave", "greaves + knees", "legs", lambda c: P.greave(c, "ironstone", sides=("L",)) +
        P.greave(c, "wood", sides=("R",)) + P.boot_trim(c, "heavy"))
    add("glove_fingers", "glove fingers (fist)", "hand", lambda c: P.glove(c, "fingers", sides=("L",), accent=True))
    add("glove_mitt", "glove mitt (fist)", "hand", lambda c: P.glove(c, "mitt", sides=("L",)))
    add("glove_open", "glove open (cast)", "hand", lambda c: P.glove(c, "fingers", sides=("L",), pose="open",
                                                                  mat="cloth2", cuff_mat="leather"))
    add("boots", "boot trim wrapped / low", "legs", lambda c: P.boot_trim(c, "wrapped", sides=("L",)) +
        P.boot_trim(c, "low", sides=("R",)))
    add("belt", "belt pouches + lamp", "hip", lambda c: P.belt(c, pouches=[(62, 1.0), (-70, 0.8)], lamp=118,
                                                              buckle="dial"))
    add("satchel", "satchel", "upper_low", lambda c: P.satchel(c, accent=True))
    add("tabard", "tabard (point)", "full", lambda c: P.belt(c, buckle="plate") + P.tabard(c, accent=True,
                                                                                         mat="cloth2", hem_mat="cloth"))
    add("skirt", "skirt (6 panels)", "full", lambda c: P.belt(c, buckle="knot") + P.skirt(c, panels=6))
    add("cape", "cape (2 x_ bones)", "full_back", lambda c: P.collar(c) + P.cape(c, cut="swallow", accent=True))
    # props (prop space)
    add("sword", "sword", "prop", lambda c: P.sword(c, hand=None, socket=None, accent=True))
    add("greatblade", "greatblade", "prop", lambda c: P.greatblade(c, hand=None, socket=None, accent=True))
    add("spear", "spear", "prop", lambda c: P.spear(c, hand=None, socket=None, accent=True))
    add("staff", "staff lens / spire", "prop", lambda c: P.staff(c, hand=None, socket=None, accent=True) +
        _shift(P.staff(c, hand=None, socket=None, head="spire", name="staff2"), (0, 0.35, 0)))
    add("bow", "bow + quiver", "prop_side", lambda c: P.bow(c, hand=None, socket=None, quiver=False, accent=True) +
        _shift(_quiver_display(c), (0, 0.45, -0.25)))
    add("twin", "twin blades", "prop", lambda c: P.twin_blades(c, socket=None, accent=True))
    add("hammer", "hammer / maul", "prop", lambda c: P.hammer(c, hand=None, socket=None, accent=True) +
        _shift(P.maul(c, hand=None, socket=None), (0, 0.5, 0.0)))
    add("lantern", "chain-lantern", "hand_low", lambda c: P.chain_lantern(c, hand="L", accent=True))
    add("focus", "focus orb", "prop_small", lambda c: P.focus_orb(c, hand=None, socket=None, accent=True))
    add("shield", "round shield", "prop_face", lambda c: P.round_shield(c, hand=None, accent=True))
    add("discs", "thrown discs + holster", "hip_r", lambda c: P.discs(c, hand="R", accent=True, socket=None))
    add("shards", "thrown shards + bandolier", "upper_r", lambda c: P.shards(c, hand="R", accent=True, socket=None))
    return G


def _shift(plist, d):
    for p in plist:
        p.low.data.transform(__import__("mathutils").Matrix.Translation(V(d)))
        p.low.data.update()
    return plist


def _quiver_display(ctx):
    return parts.quiver_back(ctx, place=False, name="quiver")


VIEWS = {
    # view: (centre fn(J) -> Vector, ortho size (m), yaw deg, pitch deg)
    "head": (lambda J, c: c, 0.44, 32.0, 6.0),
    "head_wide": (lambda J, c: c + V((0, 0, 0.03)), 0.56, 32.0, 6.0),
    "upper": (lambda J, c: V((0, 0, J["spine1"].z + 0.08)), 0.92, 30.0, 8.0),
    "upper_low": (lambda J, c: V((0, 0, J["spine1"].z - 0.04)), 1.0, 40.0, 8.0),
    "upper_back": (lambda J, c: V((0, 0, J["spine1"].z + 0.08)), 0.92, 200.0, 8.0),
    "upper_3q": (lambda J, c: V((0, 0, J["spine1"].z + 0.14)), 0.8, 125.0, 14.0),
    "forearm": (lambda J, c: (J["elbow.L"] + J["wrist.L"]) * 0.5 + V((0.0, 0.0, -0.02)), 0.46, 62.0, 8.0),
    "hip_r": (lambda J, c: V((-0.34, -0.02, J["spine0"].z - 0.22)), 0.82, -58.0, 8.0),
    "upper_r": (lambda J, c: V((-0.16, 0.0, J["spine1"].z - 0.04)), 1.1, -30.0, 8.0),
    "hip": (lambda J, c: V((0, 0, J["spine0"].z - 0.10)), 0.8, 35.0, 10.0),
    "full": (lambda J, c: V((0, 0, 0.98)), 2.08, 30.0, 6.0),
    "full_back": (lambda J, c: V((0, 0, 0.98)), 2.08, 205.0, 8.0),
    "legs": (lambda J, c: V((0, 0, 0.30)), 0.78, 28.0, 8.0),
    "hand": (lambda J, c: J["wrist.L"] + V((0.03, -0.02, -0.04)), 0.28, 70.0, 10.0),
    "hand_low": (lambda J, c: J["wrist.L"] + V((0.03, 0, -0.30)), 0.86, 35.0, 6.0),
}


def frame_cam(cam, center, size, yaw, pitch):
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size
    cam.data.shift_x = cam.data.shift_y = 0.0
    render.look_at(cam, center, render.orbit(center, 8.0, yaw, pitch))
    cam.data.clip_start, cam.data.clip_end = 0.1, 30.0


def prop_view(objs):
    lo, hi = V((1e9,) * 3), V((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            lo = V((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = V((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return (lo + hi) * 0.5, max((hi - lo).length * 0.82, 0.25)


def main():
    def extra(p):
        p.add_argument("--cell", type=int, default=256)
        p.add_argument("--samples", type=int, default=24)
        p.add_argument("--keys", default="", help="comma list of part key prefixes (default: all)")
    args = scene.parse_args(extra)
    t_all = time.perf_counter()
    scene.reset()
    col = scene.collection("parts_sheet")
    ctx = Context(spec=None, col=col)
    ctx.info = rig.build_rig(PROPORTIONS, name="sheet_rig", col=col)
    ctx.palette = materials.bible_palette()
    ctx.gradient = None
    ctx.mats = materials.bible_set(ctx.palette, None)
    # mannequin: under-suit body, heavy boots fused in, cloth head (the face wrap under masks)
    bp = body.humanoid_parts(ctx.info, SHAPE, col=col)
    for p in bp:
        mesh.set_material(p, ctx.mats["cloth"] if p.name.startswith(("b_torso", "b_arm", "b_head", "b_neck"))
                          else ctx.mats["under"])
    for s in ("L", "R"):
        b = parts.boot(ctx, s, "heavy")
        mesh.set_material(b, ctx.mats["leather"])
        bp.append(b)
    hi = mesh.union_fillet(bp, voxel=0.0065, fillet=0.03, name="body_high", col=col)
    ctx.body_high, ctx.targets = hi, [hi]
    default_hands = [p.low for p in parts.glove(ctx, "fingers", name="hand")]
    groups = build_groups(ctx)
    only = [x for x in args.keys.split(",") if x]
    built = []
    tb = time.perf_counter()
    for key, label, view, fn in groups:
        if only and not any(key.startswith(o) for o in only):
            continue
        ctx.targets = [hi]
        parts._reg(ctx).pop("belt", None)
        before = set(bpy.data.objects)
        t0 = time.perf_counter()
        try:
            res = fn(ctx)
        except Exception as e:                      # keep the sheet going; report the broken builder
            import traceback
            traceback.print_exc()
            scene.log(f"PARTS SHEET: {key} FAILED: {e}")
            built.append((key, label + " FAILED", view, [], 0, 0.0))
            continue
        objs = [p.low for p in res if p.low is not None]
        extra_objs = [o for o in set(bpy.data.objects) - before if o.type == "MESH" and o not in objs]
        for o in extra_objs:                        # helper leftovers (never part of the result)
            o.hide_render = True
        tris = sum(mesh.tri_count(o, evaluated=False) for o in objs)
        built.append((key, label, view, objs, tris, round(time.perf_counter() - t0, 2)))
        for o in objs:
            o.hide_render = True
    t_build = time.perf_counter() - tb
    scene.log(f"parts built in {t_build:.1f}s")
    # render
    light = render.map_lighting("map_rift")
    render.sky_world(light["sky"], 0.75)
    cam = render.camera(lens=50)
    c_head, _ = kit.head_frame(ctx.info)
    J = ctx.info.joints
    render.clear_lights()
    cells, labels, stats = [], [], []
    tr = time.perf_counter()
    size = args.cell
    bg = imageops.np.zeros((size, size, 4), imageops.np.float32)
    yy = imageops.np.linspace(0, 1, size, dtype=imageops.np.float32)[:, None]
    bg[..., 0] = 0.20 - 0.06 * yy
    bg[..., 1] = 0.22 - 0.06 * yy
    bg[..., 2] = 0.26 - 0.06 * yy
    bg[..., 3] = 1.0
    for key, label, view, objs, tris, secs in built:
        is_prop = view.startswith("prop")
        for o in [hi] + default_hands:
            o.hide_render = is_prop
        if key.startswith("glove"):
            for o in default_hands:
                if o.name.startswith("hand.L"):
                    o.hide_render = True
        for o in objs:
            o.hide_render = False
        if is_prop:
            ctr, sz = prop_view(objs)
            yaw = {"prop": 80.0, "prop_side": 70.0, "prop_face": 28.0, "prop_small": 40.0}[view]
            frame_cam(cam, ctr, sz, yaw, 12.0)
        else:
            fn, sz, yaw, pitch = VIEWS[view]
            frame_cam(cam, fn(J, c_head), sz, yaw, pitch)
        sun_dir = render.view_dir_light(cam, 215.0, 42.0)
        render.sun_lamp(sun_dir, 3.2, scene.hex_rgb(light["sunColor"]))
        render.setup(size, size, args.samples, transparent=True, noise=0.04, view="Khronos PBR Neutral")
        p = os.path.join(OUT, f"_cell_{key}.png")
        render.render(p)
        imageops.denoise(p, 1.6)
        img = imageops.grade(imageops.over(imageops.load(p), bg.copy()))
        os.remove(p)
        cells.append(img)
        labels.append(f"{label}  {tris // 1000 if tris >= 1000 else 0}.{(tris % 1000) // 100}k")
        stats.append({"key": key, "label": label, "tris": tris, "build_s": secs})
        for o in objs:
            o.hide_render = True
    cols = 8
    sheet = imageops.grid(cells, cols, pad=4, bg=(0.07, 0.08, 0.10))
    path = os.path.join(OUT, "sheet.png" if not only else f"sheet_{'_'.join(only)}.png")
    imageops.save(sheet, path, alpha=False)
    imageops.label(path, [(4 + (i % cols) * (size + 4) + 5, 4 + (i // cols) * (size + 4) + size - 24, s)
                          for i, s in enumerate(labels)])
    scene.write_json(os.path.join(OUT, "sheet.json"), {"parts": stats, "build_s": round(t_build, 1),
                                                       "render_s": round(time.perf_counter() - tr, 1),
                                                       "total_s": round(time.perf_counter() - t_all, 1)})
    scene.log(f"parts sheet -> {scene.rel(path)} ({len(cells)} cells) in {time.perf_counter() - t_all:.1f}s")


if __name__ == "__main__":
    main()
