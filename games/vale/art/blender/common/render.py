"""Cycles renders for fighters: portrait (512²), splash (1600×900), icon (128²) and the QA
turntable contact sheet (8 angles + 4 clip key poses).

Look: AgX view transform with the "Medium High Contrast" look. AgX desaturates bright emissive
accents gracefully instead of clipping them to flat cyan/white, matches three.js
AgXToneMapping if the renderer picks it, and keeps the painted albedo readable.
Lighting: studio key (warm area) + cool fill + strong rim (palette secondary) + low world
ambient. Backdrops are painted in numpy from the fighter's card palette and composited under a
transparent render (shadow catcher keeps the ground contact in the splash).
Noise: >= 96-128 samples + adaptive sampling, rendered at up to 1.5-2x and downsampled, then
ffmpeg nlmeans (no OpenImageDenoise in the bpy wheel). EEVEE is never used (no GPU here).
"""
from __future__ import annotations

import math
import os
import time

import bpy
from mathutils import Vector

from . import anim, imageops, scene

V = Vector
LOOK = "AgX - Medium High Contrast"


def setup(w: int, h: int, samples: int, transparent: bool = True, noise: float = 0.02):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    c = sc.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = noise
    c.adaptive_min_samples = max(8, samples // 8)
    c.use_denoising = False
    c.max_bounces = 6
    c.diffuse_bounces = 3
    c.glossy_bounces = 3
    c.transmission_bounces = 2
    c.transparent_max_bounces = 4
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.sample_clamp_indirect = 4.0
    c.seed = 0
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = LOOK
    except TypeError:
        sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.render.use_persistent_data = True


def world(color=(0.20, 0.22, 0.26), strength: float = 0.35, top=None):
    sc = bpy.context.scene
    w = bpy.data.worlds.get("vale_studio") or bpy.data.worlds.new("vale_studio")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    if top is None:
        bg.inputs["Color"].default_value = (*color, 1.0)
    else:  # vertical gradient sky (ambient tint from above)
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = -0.2
        mr.inputs["From Max"].default_value = 0.6
        nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], mix.inputs[0])
        mix.inputs[6].default_value = (*color, 1.0)
        mix.inputs[7].default_value = (*top, 1.0)
        nt.links.new(mix.outputs[2], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return w


def camera(name: str = "vale_cam", lens: float = 50.0):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.sensor_fit = "AUTO"
    cam.data.sensor_width = 36.0
    cam.data.clip_start = 0.05
    cam.data.clip_end = 200
    bpy.context.scene.camera = cam
    return cam


def look_at(cam, target, loc):
    cam.location = V(loc)
    cam.rotation_euler = (V(target) - V(loc)).to_track_quat("-Z", "Y").to_euler()


def orbit(target, dist: float, yaw_deg: float, pitch_deg: float = 6.0) -> V:
    """Camera position around `target`; yaw 0 = straight in front (-Y), + = toward character's left."""
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    return V(target) + V((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist


def _area(name, loc, target, energy, color, size):
    ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, "AREA")
    ld.type = "AREA"
    ld.energy = energy
    ld.color = color
    ld.shape = "DISK"
    ld.size = size
    ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, ld)
    if ob.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(ob)
    look_at(ob, target, loc)
    return ob


def three_point(target, scale: float = 1.0, key=(1.0, 0.93, 0.84), fill=(0.70, 0.80, 1.0), rim=(0.6, 0.85, 1.0),
                key_e: float = 260.0, fill_e: float = 60.0, rim_e: float = 420.0, yaw: float = 0.0) -> list:
    """Key (front-left, high, warm), fill (front-right, low, cool), rim (behind, opposite the key)."""
    t = V(target)
    s = scale
    out = [
        _area("vale_key", orbit(t, 3.2 * s, yaw + 38, 38), t, key_e * s * s, key, 1.6 * s),
        _area("vale_fill", orbit(t, 3.4 * s, yaw - 55, 8), t, fill_e * s * s, fill, 2.4 * s),
        _area("vale_rim", orbit(t, 3.0 * s, yaw + 160, 30), t, rim_e * s * s, rim, 1.0 * s),
        _area("vale_rim2", orbit(t, 3.0 * s, yaw - 150, 20), t, rim_e * 0.45 * s * s, rim, 1.0 * s),
    ]
    return out


def clear_lights():
    for o in list(bpy.context.scene.objects):
        if o.type == "LIGHT" and o.name.startswith("vale_"):
            bpy.data.objects.remove(o, do_unlink=True)


def ground(name="vale_ground", size=30.0, catcher: bool = True, color=(0.35, 0.36, 0.38)):
    ob = bpy.data.objects.get(name)
    if ob is None:
        me = bpy.data.meshes.new(name)
        r = size / 2
        me.from_pydata([(-r, -r, 0), (r, -r, 0), (r, r, 0), (-r, r, 0)], [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
        me.materials.append(m)
    ob.is_shadow_catcher = catcher
    ob.hide_render = False
    return ob


def render(path: str) -> float:
    t = time.perf_counter()
    sc = bpy.context.scene
    scene.ensure_dir(os.path.dirname(path))
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return round(time.perf_counter() - t, 2)


def bone_pos(arm, bone: str, tail: bool = False) -> V:
    bpy.context.view_layer.update()
    pb = arm.pose.bones[bone]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


# ── fighter renders ────────────────────────────────────────────────────────────────────────────
def fighter_clips(ctx, skel=None) -> dict:
    """The fighter's REAL clip set: generated clips + the spec's clip_overrides (what the GLB ships)."""
    spec = ctx.spec
    skel = skel or anim.Skeleton(ctx.info.armature)
    overrides = spec.clip_overrides(ctx) if hasattr(spec, "clip_overrides") else {}
    return anim.standard_clips(skel, spec.MOTION, overrides or {})


def pose_frame(arm, profile: dict, clip: str, frame: int | None = None, chains=None, t: float | None = None,
               clips: dict | None = None):
    """Pose `arm` at `clip` frame (incl. secondary motion). Pass `clips` (fighter_clips) so bespoke
    clip_overrides are honoured; without it the generated clip for the motion profile is used."""
    skel = anim.Skeleton(arm)
    c = (clips or anim.standard_clips(skel, profile))[clip]
    poses = anim.sample_clip(skel, c, chains)
    f = frame if frame is not None else int(round((t if t is not None else 0.0) * c.frames))
    f = max(0, min(len(poses) - 1, f))
    if arm.animation_data:
        arm.animation_data.action = None
    anim.apply_pose(arm, poses[f])
    return c


def fighter_renders(ctx, objs, P: dict, skin, fast: bool = False, clip_sheet: bool = False) -> dict:
    spec = ctx.spec
    arm = ctx.info.armature
    prof = spec.MOTION
    card = (skin or {}).get("card") or getattr(spec, "CARD", {"primary": "#2a3a52", "secondary": "#c9a04e"})
    pre = f"{skin['id']}_" if skin else ""
    H = spec.PROPORTIONS["height"]
    chains = spec.chain_config(ctx) if hasattr(spec, "chain_config") else [anim.ChainCfg(b) for b in ctx.chains.values()]
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o not in objs:
            o.hide_render = True
    S = 16 if fast else 1
    clips = fighter_clips(ctx)
    rim_col = scene.hex_rgb(card.get("secondary", "#c9a04e"))
    rim_col = tuple(0.55 + 0.45 * c / max(rim_col) for c in rim_col) if max(rim_col) > 0 else (1, 1, 1)
    out = {}
    T = {}

    # portrait (512²: bust, lobby pose — weapon rested, head toward camera)
    pose_frame(arm, prof, "idle_lobby", frame=0, chains=chains, clips=clips)
    head = bone_pos(arm, "head")
    k = H / 1.85
    tgt = head - V((0, 0, 0.085 * k))
    cam = camera(lens=85)
    look_at(cam, tgt, orbit(tgt, 2.05 * k, -24, 5))
    clear_lights()
    three_point(tgt, 0.8 * k, rim=rim_col, yaw=-24, key_e=170, fill_e=45, rim_e=300)
    world((0.16, 0.18, 0.22), 0.45)
    setup(768, 768, max(16, 128 // S))
    raw = os.path.join(P["renders"], f"{pre}portrait_raw.png")
    T["portrait"] = render(raw)
    imageops.denoise(raw)
    fg = imageops.premul_resize(imageops.load(raw), 512, 512)
    bg = imageops.painted_backdrop(512, 512, card["primary"], card["secondary"], glow=(0.5, 0.4))
    out["portrait"] = imageops.save(imageops.over(fg, bg), os.path.join(P["out"], f"{pre}portrait.png"))

    # icon (128²: head close-up)
    if not skin:
        # frame the crown (crest / horns / hat) inside the icon: centre between the head bone and the
        # measured top of the rest mesh
        top = max((o.matrix_world @ v.co).z for o in objs if o.type == "MESH" for v in o.data.vertices)
        ic = V((head.x, head.y, 0.5 * (head.z + top) - 0.02 * k))
        span = max(0.30 * k, top - head.z + 0.10 * k)
        look_at(cam, ic, orbit(ic, max(1.18 * k, span * 3.6), -20, 5))
        setup(256, 256, max(16, 96 // S))
        raw_i = os.path.join(P["renders"], "icon_raw.png")
        T["icon"] = render(raw_i)
        imageops.denoise(raw_i)
        fg = imageops.premul_resize(imageops.load(raw_i), 128, 128)
        bg = imageops.painted_backdrop(128, 128, card["primary"], card["secondary"], glow=(0.5, 0.45), glow_size=0.7)
        out["icon"] = imageops.save(imageops.over(fg, bg), os.path.join(P["out"], "icon.png"))

    # splash (1600×900: low three-quarter, victory hold, shadow-catcher ground, painted sky)
    pose_frame(arm, prof, "victory", t=0.8, chains=chains, clips=clips)
    # hero framing: low three-quarter, the figure fills the frame height on the right third
    # (crown to boots in frame; a raised weapon may leave the top edge — splash art, not a sheet)
    tgt = V((0, 0, 0.745 * H))                     # thighs up to the raised fist; the blade may exit
    cam = camera(lens=50)
    look_at(cam, tgt, orbit(tgt, 5.1 * k, -32, -8))
    cam.data.shift_x = -0.19                       # subject on the right third
    cam.data.shift_y = 0.0
    clear_lights()
    three_point(V((0, 0, 1.0 * k)), 1.15 * k, rim=rim_col, key_e=300, fill_e=45, rim_e=800, yaw=-32)
    g = ground(catcher=True)
    world(scene.hex_rgb(card["primary"]), 0.55, top=tuple(min(1, c * 1.8 + 0.05) for c in scene.hex_rgb(card["primary"])))
    setup(1600, 900, max(16, 128 // S))
    raw_s = os.path.join(P["renders"], f"{pre}splash_raw.png")
    T["splash"] = render(raw_s)
    imageops.denoise(raw_s, 2.0)
    cam.data.shift_x = 0.0
    cam.data.shift_y = 0.0
    fg = imageops.load(raw_s)
    bg = splash_backdrop(1600, 900, card["primary"], card["secondary"])
    out["splash"] = imageops.save(imageops.over(fg, bg), os.path.join(P["out"], f"{pre}splash.png"))
    g.hide_render = True

    # turntable contact sheet (QA): 8 angles + 4 clip key poses
    if not skin:
        T["turntable"], out["turntable"] = turntable(ctx, P, chains, fast)
    for f in ("portrait_raw", "icon_raw", "splash_raw"):
        p = os.path.join(P["renders"], f"{pre}{f}.png")
        if os.path.isfile(p):
            os.remove(p)
    anim.apply_pose(arm, {})
    return {"files": {k: scene.rel(v) for k, v in out.items()}, "seconds": T}


def splash_backdrop(w: int, h: int, primary: str, secondary: str) -> "imageops.np.ndarray":
    np = imageops.np
    bg = imageops.painted_backdrop(w, h, primary, secondary, seed=11, glow=(0.66, 0.46), glow_size=0.55)
    # horizon haze + ground darkening (atmospheric depth behind the shadow catcher)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    hz = 0.60
    haze = np.exp(-((yy - hz) / 0.07) ** 2)
    s = np.array(scene.hex_srgb(secondary), np.float32)
    bg[..., :3] = bg[..., :3] * (1 - 0.35 * haze[..., None]) + (s * 0.6 + 0.25)[None, None, :] * 0.35 * haze[..., None]
    ground_mask = np.clip((yy - hz) / 0.4, 0, 1)
    bg[..., :3] *= (1 - 0.45 * ground_mask[..., None])
    clouds = imageops.value_noise(w, h, 7, 21) * 0.6 + imageops.value_noise(w, h, 17, 22) * 0.4
    cm = np.clip((clouds - 0.5) * 2.2, 0, 1) * np.clip((hz - yy) / hz, 0, 1)
    bg[..., :3] = bg[..., :3] * (1 - 0.18 * cm[..., None]) + 0.18 * cm[..., None] * (s * 0.5 + 0.4)[None, None, :]
    return bg


def turntable(ctx, P: dict, chains, fast: bool) -> tuple:
    spec = ctx.spec
    arm = ctx.info.armature
    prof = spec.MOTION
    H = spec.PROPORTIONS["height"]
    cell = 384
    S = 4 if fast else 1
    tgt = V((0, 0, 0.5 * H))
    cam = camera(lens=50)
    clear_lights()
    world((0.24, 0.26, 0.30), 0.8)
    sun = bpy.data.lights.get("vale_sun") or bpy.data.lights.new("vale_sun", "SUN")
    sun.energy = 3.2
    sun.angle = math.radians(8)
    so = bpy.data.objects.get("vale_sun") or bpy.data.objects.new("vale_sun", sun)
    if so.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(48), 0, math.radians(-38))
    g = ground(catcher=False)
    g.hide_render = False
    setup(cell, cell, max(8, 32 // S), transparent=False, noise=0.04)
    t0 = time.perf_counter()
    cells, labels = [], []
    pose_frame(arm, prof, "idle", frame=0, chains=chains, clips=fighter_clips(ctx))
    for i in range(8):
        yaw = i * 45
        look_at(cam, tgt, orbit(tgt, 4.5 * H / 1.85, yaw, 10))
        p = os.path.join(P["renders"], f"_tt_{i}.png")
        render(p)
        cells.append(p)
        labels.append(f"yaw {yaw}")
    skel = anim.Skeleton(arm)
    clips = fighter_clips(ctx, skel)
    keys = [("run", 0.0), ("attack1", anim.IMPACT), ("cast_ult", anim.IMPACT), ("death", 1.0)]
    look_at(cam, tgt, orbit(tgt, 4.6 * H / 1.85, -35, 12))
    for name, t in keys:
        c = clips[name]
        poses = anim.sample_clip(skel, c, chains)
        f = int(round(t * c.frames))
        anim.apply_pose(arm, poses[f])
        p = os.path.join(P["renders"], f"_tt_{name}.png")
        render(p)
        cells.append(p)
        labels.append(f"{name} f{f}/{c.frames}")
    arrs = []
    for p in cells:
        imageops.denoise(p, 2.0)
        arrs.append(imageops.load(p))
        os.remove(p)
    sheet = imageops.grid(arrs, 4)
    path = os.path.join(P["renders"], "turntable.png")
    imageops.save(sheet, path, alpha=False)
    pad = 4
    imageops.label(path, [(pad + (i % 4) * (cell + pad) + 6, pad + (i // 4) * (cell + pad) + 6, s)
                          for i, s in enumerate(labels)])
    g.hide_render = True
    so.hide_render = True
    return round(time.perf_counter() - t0, 2), path
