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
import numpy as np
from mathutils import Vector

from . import anim, imageops, scene

V = Vector
LOOK = "AgX - Medium High Contrast"


def setup(w: int, h: int, samples: int, transparent: bool = True, noise: float = 0.02, view: str = "AgX"):
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
    sc.view_settings.view_transform = view
    try:
        sc.view_settings.look = LOOK if view == "AgX" else "None"
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


SPLASH_DEFAULTS = {
    # STYLE_BIBLE "Menu mood"/"Grid": the 3D subject owns columns 7-12 (right half), UI columns 1-6.
    "map": "map_rift",          # backdrop theme + sky (art/out/maps/<map>/sky.hdr)
    "clip": "victory", "t": 0.9,                # splash pose (the fighter's REAL clip set)
    "yaw": 26.0,                # FRONT three-quarter: camera on the character's left (+X), the
                                # fighter faces screen-left, into the frame, toward the UI side
    "pitch": -5.0,              # hero angle: camera at hip height looking up; the horizon sits low
    "lens": 60.0, "x": 0.72,    # subject centre at 72 % of the width (columns 7-12 at 1600 px)
    "fill": 0.88,               # subject height / frame height
    "rim_cool": 1.0,            # Aubade dawn rim on the screen-left edge (behind the subject)
    "rim_warm": 1.0,            # Serenade lamp rim on the screen-right edge
    "paint_r": 3,               # Kuwahara radius of the painted backdrop (px at 1600)
    "post": True,               # light wrap + bloom + vignette before the grade
    "portrait_clip": "idle_lobby", "portrait_t": 0.0, "portrait_yaw": 28.0,
    "icon_yaw": 24.0,
    "key_az": 225.0, "key_el": 45.0,            # bible: the fighter key at view 225 deg / 45 deg
    "sun": 3.0, "ambient": 0.65,                # lighting.json (sunIntensity, ambient)
}


def _splash_cfg(spec, skin) -> dict:
    c = dict(SPLASH_DEFAULTS)
    c.update(getattr(spec, "SPLASH", {}) or {})
    c.update((skin or {}).get("splash", {}) or {})
    return c


def map_lighting(map_id: str) -> dict:
    lj = scene.read_json(os.path.join(scene.OUT_DIR, "maps", map_id, "lighting.json"), {}) or {}
    return {"sunColor": lj.get("sunColor", "#FFEBD8"), "sunIntensity": float(lj.get("sunIntensity", 3.0)),
            "ambient": float(lj.get("ambient", 0.65)), "fogColor": lj.get("fogColor", "#9AA7B4"),
            "sky": os.path.join(scene.OUT_DIR, "maps", map_id, "sky.hdr")}


def sky_world(hdr: str, strength: float = 0.65, rot_z_deg: float = 0.0, camera_strength: float | None = None):
    """World = the map's baked sky HDR (mean radiance 1.0, sun disc off). `camera_strength` makes
    the sky the camera sees brighter/darker than the light it casts (backdrop plates)."""
    sc = bpy.context.scene
    w = bpy.data.worlds.get("vale_sky_world") or bpy.data.worlds.new("vale_sky_world")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rot_z_deg))
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    if os.path.isfile(hdr):
        env.image = bpy.data.images.load(hdr, check_existing=True)
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    if camera_strength is None:
        nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    else:
        bg2 = nt.nodes.new("ShaderNodeBackground")
        bg2.inputs["Strength"].default_value = camera_strength
        nt.links.new(env.outputs["Color"], bg2.inputs["Color"])
        lp = nt.nodes.new("ShaderNodeLightPath")
        mx = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(lp.outputs["Is Camera Ray"], mx.inputs[0])
        nt.links.new(bg.outputs["Background"], mx.inputs[1])
        nt.links.new(bg2.outputs["Background"], mx.inputs[2])
        nt.links.new(mx.outputs["Shader"], out.inputs["Surface"])
    return w


def view_dir_light(cam, az_deg: float, el_deg: float) -> V:
    """Unit vector TOWARD the light for a view-relative bearing: 0 = along the view direction, angles
    clockwise seen from above (90 right, 180 behind the camera, 225 behind-left), elevation up."""
    f = cam.matrix_world.to_3x3() @ V((0, 0, -1))
    f.z = 0
    f.normalize()
    a = -math.radians(az_deg)                         # clockwise from above = negative about +Z
    h = V((f.x * math.cos(a) - f.y * math.sin(a), f.x * math.sin(a) + f.y * math.cos(a), 0.0))
    e = math.radians(el_deg)
    return V((h.x * math.cos(e), h.y * math.cos(e), math.sin(e))).normalized()


def sun_lamp(direction: V, strength: float, color, angle_deg: float = 2.0, name: str = "vale_key_sun"):
    ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, "SUN")
    ld.type = "SUN"
    ld.energy = strength
    ld.color = color
    ld.angle = math.radians(angle_deg)
    ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, ld)
    if ob.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    ob.hide_render = False
    return ob


RIM_COOL = (0.62, 0.78, 1.0)     # dawn azure, desaturated (Aubade: screen-left)
RIM_WARM = (1.0, 0.74, 0.46)     # lamp marigold, desaturated (Serenade: screen-right)


def bible_lights(cam, cfg: dict, light: dict, rim: float = 1.0, scale: float = 1.0, pair: bool = False,
                 target=None) -> list:
    """STYLE_BIBLE lighting for fighter art: ONE sun behind-left of the camera (view 225 deg / 45 deg,
    the map's sun colour and intensity) + a soft painterly rim so the silhouette separates from the
    painted backdrop. The sky HDR is the fill (ambient). pair=True (splash): a WARM/COOL rim pair
    from behind the subject instead: cool dawn light on the screen-left (Aubade) edge, warm lamp
    light on the screen-right (Serenade) edge, as the world sits on screen."""
    clear_lights()
    for o in list(bpy.context.scene.objects):
        if o.type == "LIGHT" and o.name.startswith("vale_key_sun"):
            o.hide_render = True
    sun = sun_lamp(view_dir_light(cam, cfg["key_az"], cfg["key_el"]), light["sunIntensity"] * 0.9 * cfg["sun"] / 3.0,
                   scene.hex_rgb(light["sunColor"]))
    out = [sun]
    if pair:
        f = cam.matrix_world.to_3x3() @ V((0, 0, -1))
        tgt = V(target) if target is not None else cam.location + f * 5.0 * scale
        for nm, az, el, colr, k in (("vale_rim_cool", -46.0, 26.0, RIM_COOL, cfg.get("rim_cool", 1.0)),
                                    ("vale_rim_warm", 44.0, 16.0, RIM_WARM, cfg.get("rim_warm", 1.0))):
            if k > 0:                                          # kickers: side-back, tight enough to edge the form
                d = view_dir_light(cam, az, el)
                out.append(_area(nm, tgt + d * 3.0 * scale, tgt, 1500.0 * k * scale * scale, colr, 0.8 * scale))
        return out
    if rim > 0:
        d = view_dir_light(cam, 140.0, 24.0)
        f = cam.matrix_world.to_3x3() @ V((0, 0, -1))
        tgt = cam.location + f * 5.0 * scale
        out.append(_area("vale_rim", tgt + d * 3.0 * scale, tgt, 260.0 * rim * scale * scale, (1.0, 0.94, 0.86), 1.6 * scale))
    return out


def posed_bounds(objs) -> tuple:
    """World AABB of the evaluated (posed, deformed) meshes."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = V((1e9, 1e9, 1e9)), V((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            p = mw @ v.co
            lo = V((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = V((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        ev.to_mesh_clear()
    return lo, hi


# ── map-themed painted backdrops ───────────────────────────────────────────────────────────────
HAZE_STRENGTH = 1.3     # the haze glows like the bright horizon band of the sky HDR (distant forms dissolve)


def _haze_mat(name: str, base_hex: str, haze_hex: str, haze_dist: float, rough: float = 0.8, dial: bool = False,
              dial_center=(0.0, 0.0)):
    """Diffuse material that fades to the haze colour with camera distance (aerial perspective
    without volumes). `dial` paints the Hourfall floor: honed paving, radial hour-lines every 15
    degrees and concentric bands around `dial_center`."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = rough
    col = nt.nodes.new("ShaderNodeRGB")
    col.outputs[0].default_value = (*scene.hex_rgb(base_hex), 1.0)
    cur = col.outputs[0]
    if dial:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        dx = nt.nodes.new("ShaderNodeMath"); dx.operation = "SUBTRACT"
        nt.links.new(sep.outputs["X"], dx.inputs[0]); dx.inputs[1].default_value = dial_center[0]
        dy = nt.nodes.new("ShaderNodeMath"); dy.operation = "SUBTRACT"
        nt.links.new(sep.outputs["Y"], dy.inputs[0]); dy.inputs[1].default_value = dial_center[1]
        ang = nt.nodes.new("ShaderNodeMath"); ang.operation = "ARCTAN2"
        nt.links.new(dy.outputs[0], ang.inputs[0]); nt.links.new(dx.outputs[0], ang.inputs[1])
        k = nt.nodes.new("ShaderNodeMath"); k.operation = "MULTIPLY"
        nt.links.new(ang.outputs[0], k.inputs[0]); k.inputs[1].default_value = 12.0       # 24 hour-lines
        sn = nt.nodes.new("ShaderNodeMath"); sn.operation = "SINE"
        nt.links.new(k.outputs[0], sn.inputs[0])
        ab = nt.nodes.new("ShaderNodeMath"); ab.operation = "ABSOLUTE"
        nt.links.new(sn.outputs[0], ab.inputs[0])
        line = nt.nodes.new("ShaderNodeMapRange")
        line.inputs["From Min"].default_value = 0.0
        line.inputs["From Max"].default_value = 0.22           # wide carved hour-lines (survive the paint)
        line.inputs["To Min"].default_value = 0.48
        line.inputs["To Max"].default_value = 1.0
        nt.links.new(ab.outputs[0], line.inputs["Value"])
        ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(dx.outputs[0], cmb.inputs[0]); nt.links.new(dy.outputs[0], cmb.inputs[1])
        nt.links.new(cmb.outputs[0], ln.inputs[0])
        rg = nt.nodes.new("ShaderNodeMath"); rg.operation = "SINE"
        rk = nt.nodes.new("ShaderNodeMath"); rk.operation = "MULTIPLY"
        nt.links.new(ln.outputs["Value"], rk.inputs[0]); rk.inputs[1].default_value = 0.35
        nt.links.new(rk.outputs[0], rg.inputs[0])
        band = nt.nodes.new("ShaderNodeMapRange")
        band.inputs["From Min"].default_value = 0.92
        band.inputs["From Max"].default_value = 1.0
        band.inputs["To Min"].default_value = 1.0
        band.inputs["To Max"].default_value = 0.8
        nt.links.new(rg.outputs[0], band.inputs["Value"])
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 0.08
        noise.inputs["Detail"].default_value = 3.0
        nm = nt.nodes.new("ShaderNodeMapRange")
        nm.inputs["To Min"].default_value = 0.86
        nm.inputs["To Max"].default_value = 1.08
        nt.links.new(noise.outputs["Fac"], nm.inputs["Value"])
        m1 = nt.nodes.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
        nt.links.new(line.outputs["Result"], m1.inputs[0]); nt.links.new(band.outputs["Result"], m1.inputs[1])
        m2 = nt.nodes.new("ShaderNodeMath"); m2.operation = "MULTIPLY"
        nt.links.new(m1.outputs[0], m2.inputs[0]); nt.links.new(nm.outputs["Result"], m2.inputs[1])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(cur, mix.inputs[6])
        cc = nt.nodes.new("ShaderNodeCombineColor")
        for i in range(3):
            nt.links.new(m2.outputs[0], cc.inputs[i])
        nt.links.new(cc.outputs[0], mix.inputs[7])
        cur = mix.outputs[2]
        brick = nt.nodes.new("ShaderNodeTexBrick")                      # honed paving slabs (2.4 x 1.2 m)
        brick.inputs["Scale"].default_value = 0.2                       # 5 m honed slabs
        brick.inputs["Mortar Size"].default_value = 0.03
        brick.inputs["Color1"].default_value = (1, 1, 1, 1)
        brick.inputs["Color2"].default_value = (0.9, 0.9, 0.9, 1)
        brick.inputs["Mortar"].default_value = (0.62, 0.62, 0.62, 1)
        nt.links.new(tc.outputs["Object"], brick.inputs["Vector"])
        mb = nt.nodes.new("ShaderNodeMix"); mb.data_type = "RGBA"; mb.blend_type = "MULTIPLY"
        mb.inputs[0].default_value = 1.0
        nt.links.new(cur, mb.inputs[6])
        nt.links.new(brick.outputs["Color"], mb.inputs[7])
        cur = mb.outputs[2]
    nt.links.new(cur, bsdf.inputs["Base Color"])
    cam = nt.nodes.new("ShaderNodeCameraData")
    fog = nt.nodes.new("ShaderNodeMath"); fog.operation = "DIVIDE"
    nt.links.new(cam.outputs["View Distance"], fog.inputs[0]); fog.inputs[1].default_value = -haze_dist
    ex = nt.nodes.new("ShaderNodeMath"); ex.operation = "EXPONENT"
    nt.links.new(fog.outputs[0], ex.inputs[0])
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.use_clamp = True
    inv.inputs[0].default_value = 1.0
    nt.links.new(ex.outputs[0], inv.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*scene.hex_rgb(haze_hex), 1.0)
    em.inputs["Strength"].default_value = HAZE_STRENGTH
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(inv.outputs[0], mx.inputs[0])
    nt.links.new(bsdf.outputs["BSDF"], mx.inputs[1])
    nt.links.new(em.outputs["Emission"], mx.inputs[2])
    nt.links.new(mx.outputs["Shader"], out.inputs["Surface"])
    return m


def _bd_obj(o, col):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)
    return o


def frustum_tan(cam) -> tuple[float, float]:
    """Horizontal tangent range the camera sees (sensor fit AUTO, landscape or square, with shift_x)."""
    half = (cam.data.sensor_width / 2) / cam.data.lens
    off = cam.data.shift_x * cam.data.sensor_width / cam.data.lens
    return -half + off, half + off


MAP_HAZE = {"map_rift": "#d3dadf", "map_bridge": "#ddd0bc", "map_fray": "#e2dccf", "menu_rim": "#d6d2cb"}


def map_backdrop(map_id: str, cam, seed: int = 3):
    """Soft distant set dressing for the map theme, placed INSIDE the camera's (shifted) frustum, in
    aerial perspective (every surface fades to the horizon haze with distance, no volumes):
      * the dial's far rim: a low hazy ridge along the whole horizon (a horizon line, not a void)
      * Aubade spires, screen-LEFT (west, WORLD.md): tall stacked chalk tiers with dawnglass belfries,
        three depth layers, the farthest almost dissolved (they sit behind the UI half: quiet)
      * Serenade domes, screen-RIGHT behind the subject: low banded drums under lamp domes
      * the fallen needle lying across the far dial; the honed dial floor with converging hour-lines
    Returns the collection (delete it after use)."""
    from . import mesh
    col = scene.collection("_backdrop")
    rnd = scene.rng("backdrop", map_id, seed)
    f = cam.matrix_world.to_3x3() @ V((0, 0, -1))
    f.z = 0
    f.normalize()
    r = V((f.y, -f.x, 0.0))                                   # camera right on the ground plane
    c0 = V((cam.location.x, cam.location.y, 0.0))
    t0, t1 = frustum_tan(cam)
    span = t1 - t0
    haze = MAP_HAZE.get(map_id, "#d3dadf")
    floor = mesh.loft([{"p": (0, 0, -0.02), "rx": 0.01, "ry": 0.01}, {"p": (0, 0, -0.01), "rx": 1600, "ry": 1600}],
                      segments=96, caps=("flat", "flat"), name="bd_floor", col=col, smooth_path=False, rings=2)
    dial_c = c0 + f * 26.0 + r * (26.0 * (t0 + 0.40 * span))       # the gnomon's foot: hour-lines radiate
    mesh.set_material(floor, _haze_mat("bd_floor_mat", "#b4a587", haze, 70.0, 0.85, dial=True,
                                       dial_center=(dial_c.x, dial_c.y)))
    objs = [floor]

    def at(dist, x_frac):
        tan = t0 + span * x_frac
        return c0 + f * dist + r * (dist * tan)

    # the far rim of the dial: a long undulating ridge just above the horizon
    pts, st = [], []
    for i in range(25):
        xf = -0.25 + 1.5 * i / 24
        d = 1500.0 + 120.0 * math.sin(i * 1.7)
        h = 26.0 + 14.0 * math.sin(i * 0.9 + 1.0) + 8.0 * math.sin(i * 2.3)
        st.append({"p": at(d, xf) + V((0, 0, h * 0.5)), "rx": h * 0.62, "ry": h * 0.55, "exp": 2.2})
    ridge = mesh.loft(st, segments=10, caps=("flat", "flat"), up=(0, 0, 1), name="bd_ridge", col=col, rings=80)
    mesh.set_material(ridge, _haze_mat("bd_ridge_mat", "#857e70", haze, 1100.0, 0.9))
    objs.append(ridge)

    def spire(base, hgt, w, glass_m, stone_m, nm):
        tiers = rnd.choice([3, 4])
        z = 0.0
        out = []
        for k in range(tiers):                                 # square tiers with setbacks: stacked, not a cone
            tw = w * (1.0 - 0.16 * k)
            th = hgt * (0.40 if k == 0 else 0.42 / tiers)
            tier = mesh.loft([{"p": base + V((0, 0, z)), "rx": tw, "ry": tw, "exp": 3.6},
                              {"p": base + V((0, 0, z + th)), "rx": tw * 0.94, "ry": tw * 0.94, "exp": 3.6}],
                             segments=8, caps=("flat", "flat"), up=(0, -1, 0), name=f"{nm}_{k}", col=col,
                             smooth_path=False, rings=2)
            mesh.set_material(tier, stone_m)
            out.append(tier)
            if k == 1:                                         # a dawnglass belfry band
                gl = mesh.loft([{"p": base + V((0, 0, z + th * 0.2)), "rx": tw * 1.02, "ry": tw * 1.02, "exp": 3.6},
                                {"p": base + V((0, 0, z + th * 0.75)), "rx": tw * 1.02, "ry": tw * 1.02, "exp": 3.6}],
                               segments=8, caps=("flat", "flat"), up=(0, -1, 0), name=f"{nm}_glass", col=col,
                               smooth_path=False, rings=2)
                mesh.set_material(gl, glass_m)
                out.append(gl)
            z += th
        sp = mesh.loft([{"p": base + V((0, 0, z)), "rx": w * 0.5, "ry": w * 0.5, "exp": 3.0},
                        {"p": base + V((0, 0, hgt)), "rx": w * 0.025, "ry": w * 0.025, "exp": 2.0}], segments=8,
                       caps=("flat", "point"), up=(0, -1, 0), name=nm, col=col, smooth_path=False, rings=3)
        mesh.set_material(sp, stone_m)
        out.append(sp)
        return out

    # Aubade spires: three depth layers on the left (UI) side; nearer = a touch more contrast
    for layer, (dist, hz, n, xr) in enumerate(((1100.0, 980.0, 5, (0.0, 0.42)), (720.0, 820.0, 3, (0.04, 0.36)),
                                               (460.0, 700.0, 2, (0.10, 0.30)))):
        stone_m = _haze_mat(f"bd_spire_mat{layer}", "#868a92", haze, hz, 0.7)
        glass_m = _haze_mat(f"bd_glass_mat{layer}", "#6f8aa6", haze, hz, 0.3)
        for i in range(n):
            xf = xr[0] + (xr[1] - xr[0]) * (i + rnd.uniform(0.2, 0.8)) / n
            d = dist * rnd.uniform(0.9, 1.1)
            hgt = rnd.uniform(0.06, 0.09) * d * (1.25 if i == n // 2 else 1.0)
            objs += spire(at(d, xf), hgt, hgt * rnd.uniform(0.055, 0.07), glass_m, stone_m, f"bd_spire{layer}_{i}")
    # Serenade domes: banded drums under lamp domes, behind and right of the subject
    for layer, (dist, hz, n, xr) in enumerate(((980.0, 900.0, 3, (0.5, 1.05)), (560.0, 720.0, 2, (0.6, 1.0)))):
        dome_m = _haze_mat(f"bd_dome_mat{layer}", "#8e6e55", haze, hz, 0.75)
        band_m = _haze_mat(f"bd_band_mat{layer}", "#a87a45", haze, hz, 0.4)
        for i in range(n):
            xf = xr[0] + (xr[1] - xr[0]) * (i + rnd.uniform(0.25, 0.75)) / n
            d = dist * rnd.uniform(0.92, 1.08)
            R = d * rnd.uniform(0.022, 0.03)
            base = at(d, xf)
            st = [{"p": base, "rx": R * 1.3, "ry": R * 1.3, "exp": 2.0},
                  {"p": base + V((0, 0, R * 0.16)), "rx": R * 1.3, "ry": R * 1.3, "exp": 2.0},
                  {"p": base + V((0, 0, R * 0.17)), "rx": R * 1.0, "ry": R * 1.0, "exp": 2.0},
                  {"p": base + V((0, 0, R * 0.48)), "rx": R * 1.0, "ry": R * 1.0, "exp": 2.0},
                  {"p": base + V((0, 0, R * 0.49)), "rx": R * 0.97, "ry": R * 0.97, "exp": 2.0}]
            dm = mesh.loft(st, segments=24, caps=("flat", "round"), up=(0, -1, 0), name=f"bd_dome{layer}_{i}", col=col,
                           cap_len=0.62, smooth_path=False, rings=8)
            mesh.set_material(dm, dome_m)
            bd = mesh.loft([{"p": base + V((0, 0, R * 0.40)), "rx": R * 1.03, "ry": R * 1.03},
                            {"p": base + V((0, 0, R * 0.47)), "rx": R * 1.03, "ry": R * 1.03}], segments=24,
                           caps=("flat", "flat"), up=(0, -1, 0), name=f"bd_band{layer}_{i}", col=col, smooth_path=False,
                           rings=2)
            mesh.set_material(bd, band_m)
            top = base + V((0, 0, R * 0.49 + R * 0.97 * 0.62))
            ln = mesh.loft([{"p": top - V((0, 0, 0.5)), "rx": R * 0.14, "ry": R * 0.14},
                            {"p": top + V((0, 0, R * 0.20)), "rx": R * 0.12, "ry": R * 0.12},
                            {"p": top + V((0, 0, R * 0.40)), "rx": R * 0.02, "ry": R * 0.02}], segments=10,
                           caps=("flat", "point"), up=(0, -1, 0), name=f"bd_lantern{layer}_{i}", col=col,
                           smooth_path=False, rings=3)
            mesh.set_material(ln, dome_m)
            objs += [dm, bd, ln]
    # the fallen needle: a long tapered shaft, its broken base raised on the far rim, tip on the dial
    a = at(900.0, 0.30)
    b = at(760.0, 0.95)
    nd = mesh.loft([{"p": a + V((0, 0, 30)), "rx": 9.0, "ry": 9.0, "exp": 3.0},
                    {"p": a.lerp(b, 0.5) + V((0, 0, 14)), "rx": 6.5, "ry": 6.5, "exp": 3.0},
                    {"p": b + V((0, 0, 2)), "rx": 2.0, "ry": 2.0, "exp": 3.0}], segments=8, caps=("flat", "point"),
                   up=(0, 0, 1), name="bd_needle", col=col, smooth_path=False, rings=6)
    mesh.set_material(nd, _haze_mat("bd_needle_mat", "#77716a", haze, 900.0, 0.8))
    objs.append(nd)
    for o in objs:
        _bd_obj(o, col)
    return col


def backdrop_plate(cam, cfg: dict, light: dict, w: int, h: int, path: str, fast: bool, paint_r: int = 2) -> np.ndarray:
    """Render the painted map backdrop through `cam` (subject hidden), Kuwahara-painted, softened,
    returned at (w, h) display sRGB (Khronos PBR Neutral, ungraded)."""
    hidden = [o for o in bpy.context.scene.objects if not o.hide_render and
              (o.type == "MESH" or (o.type == "LIGHT" and o.name.startswith("vale_rim")))]
    for o in hidden:                                           # the subject and its rim lights (rims light
        o.hide_render = True                                   # the fighter only, never the painted world)
    clip_end = cam.data.clip_end
    cam.data.clip_end = 5000.0                                 # the set dressing stands 450-1600 m away
    col = map_backdrop(cfg["map"], cam)
    sw, sh = max(160, (w * 3) // 4), max(90, (h * 3) // 4)
    setup(sw, sh, 16 if fast else 48, transparent=False, noise=0.05, view="Khronos PBR Neutral")
    render(path)
    plate = imageops.load(path)
    if not os.environ.get("VALE_KEEP_PLATE"):
        os.remove(path)
    plate = imageops.kuwahara(plate, paint_r)
    plate = imageops.gaussian(plate, 0.8 + 0.25 * paint_r)        # distance softness (the subject stays crisp)
    plate = imageops.resize(plate, w, h)
    for o in list(col.objects):
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    bpy.data.collections.remove(col)
    cam.data.clip_end = clip_end
    for o in hidden:
        o.hide_render = False
    np_ = imageops.np
    # painterly canvas tooth + a soft top-down light falloff
    tooth = imageops.value_noise(w, h, max(8, w // 5), 17)
    plate[..., :3] *= (0.975 + 0.05 * tooth[..., None])
    yy = np_.linspace(0, 1, h, dtype=np_.float32)[:, None, None]
    plate[..., :3] *= (1.02 - 0.06 * yy)
    plate[..., 3] = 1.0
    return plate


def splash_post(fg: np.ndarray, plate: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """Painterly integration of the rendered subject over its painted plate (display sRGB, before
    the LUT): light wrap (the backdrop's light bleeds 1-3 px onto the silhouette edge), a soft bloom
    of the brightest sky, and a gentle vignette that keeps the eye on the subject."""
    h, w = fg.shape[:2]
    k = w / 1600.0
    a = fg[..., 3:4]
    comp = imageops.over(fg, plate)
    if strength <= 0:
        return comp
    ab = imageops.gaussian(fg[..., 3:4].repeat(4, axis=2), 1.6 * k)[..., :1]
    wrap = np.clip(a * (1.0 - ab) * 2.0, 0.0, 1.0)
    pb = imageops.gaussian(plate, 4.0 * k)
    comp[..., :3] = comp[..., :3] * (1.0 - 0.14 * strength * wrap) + pb[..., :3] * 0.14 * strength * wrap
    lum = comp[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    hi = np.clip((lum - 0.82) / 0.18, 0.0, 1.0)[..., None] * comp[..., :3]
    hi4 = np.concatenate([hi, np.ones_like(hi[..., :1])], axis=2)
    bloom = imageops.gaussian(hi4, 16.0 * k)[..., :3]
    comp[..., :3] = np.clip(comp[..., :3] + 0.16 * strength * bloom, 0.0, 1.0)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = (xx / w - 0.62) / 0.75, (yy / h - 0.52) / 0.62
    vig = 1.0 - 0.16 * strength * np.clip(dx * dx + dy * dy, 0.0, 1.6) ** 1.3
    comp[..., :3] *= vig[..., None]
    comp[..., 3] = 1.0
    return comp


def _fit_camera(cam, lo: V, hi: V, yaw: float, pitch: float, lens: float, fill: float, aspect: float, x_frac: float,
                y_center: float | None = None):
    """Aim a perspective camera at the subject box from (yaw, pitch) so its height fills `fill` of the
    frame, then shift it horizontally so the subject's centre sits at `x_frac` of the width."""
    cam.data.lens = lens
    cam.data.sensor_fit = "AUTO"
    cam.data.sensor_width = 36.0
    hgt = hi.z - lo.z
    ctr = V(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, y_center if y_center is not None else (lo.z + hi.z) / 2))
    sw = 36.0
    vfov = 2 * math.atan((sw / 2) / lens / max(aspect, 1.0)) if aspect >= 1 else 2 * math.atan((sw / 2) / lens)
    dist = hgt / fill / (2 * math.tan(vfov / 2)) + 0.5 * max(hi.x - lo.x, hi.y - lo.y) * 0.5
    look_at(cam, ctr, orbit(ctr, dist, yaw, pitch))
    cam.data.shift_x = -(x_frac - 0.5) * (1.0 if aspect >= 1 else aspect)
    cam.data.shift_y = 0.0
    bpy.context.view_layer.update()
    return ctr, dist


def fighter_renders(ctx, objs, P: dict, skin, fast: bool = False, clip_sheet: bool = False, only=None,
                    scale: float = 1.0) -> dict:
    """Portrait 512², icon 128², splash 1600x900 (+ turntable QA) with the bible conventions:
      * front three-quarter (camera on the fighter's left, the fighter faces screen-left into frame)
      * ONE sun behind-left of the camera (view 225 deg / 45 deg) + the map sky as fill + a soft rim
      * splash subject in columns 7-12 (centre ~73 % of the width), feet grounded with a real shadow
      * painted map-themed backdrop (map sky + distant spires left, domes right, the dial floor)
      * Khronos PBR Neutral view transform, then the locked vale_grade_01 LUT (the game's chain).
    only: subset of {"splash", "portrait", "icon", "turntable"}; scale != 1 renders PREVIEWS at that
    size into art/renders/<sub>/preview_*.png (shipped files untouched): fast look-and-fix loops."""
    spec = ctx.spec
    arm = ctx.info.armature
    prof = spec.MOTION
    cfg = _splash_cfg(spec, skin)
    light = map_lighting(cfg["map"])
    pre = f"{skin['id']}_" if skin else ""
    chains = spec.chain_config(ctx) if hasattr(spec, "chain_config") else [anim.ChainCfg(b) for b in ctx.chains.values()]
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o not in objs:
            o.hide_render = True
    S = 8 if fast else 1
    want = (lambda k: True) if not only else (lambda k: k in only)
    preview = abs(scale - 1.0) > 1e-6

    def dest(name):
        if preview:
            return os.path.join(P["renders"], f"preview_{pre}{name}.png")
        return os.path.join(P["out"], f"{pre}{name}.png")

    clips = fighter_clips(ctx)
    out, T = {}, {}
    cam = camera(lens=50)
    sky_world(light["sky"], light["ambient"], camera_strength=1.0)

    # ── splash 1600x900 ──
    if want("splash"):
        pose_frame(arm, prof, cfg["clip"], t=cfg["t"], chains=chains, clips=clips)
        lo, hi = posed_bounds(objs)
        lo.z = min(lo.z, 0.0)
        _fit_camera(cam, lo, hi, cfg["yaw"], cfg["pitch"], cfg["lens"], cfg["fill"], 16 / 9, cfg["x"])
        bible_lights(cam, cfg, light, rim=1.0, scale=1.6, pair=True, target=(lo + hi) * 0.5)
        t0 = time.perf_counter()
        W, H = int(round(1600 * scale)), int(round(900 * scale))
        plate = backdrop_plate(cam, cfg, light, W, H, os.path.join(P["renders"], f"{pre}_plate.png"), fast,
                               paint_r=max(1, int(round(cfg.get("paint_r", 3) * scale))))
        g = ground(catcher=True, size=60.0)
        setup(W, H, max(16, 64 // S), view="Khronos PBR Neutral")
        raw_s = os.path.join(P["renders"], f"{pre}splash_raw.png")
        render(raw_s)
        imageops.denoise(raw_s, 2.0)
        fg = imageops.load(raw_s)
        comp = splash_post(fg, plate, 1.0 if cfg.get("post", True) else 0.0)
        out["splash"] = imageops.save(imageops.grade(comp), dest("splash"), alpha=False)
        g.hide_render = True
        T["splash"] = round(time.perf_counter() - t0, 2)

    # ── portrait 512² (head and shoulders, three-quarter, front) ──
    t0 = time.perf_counter()
    pose_frame(arm, prof, cfg["portrait_clip"], t=cfg["portrait_t"], chains=chains, clips=clips)
    pplate = None
    head = bone_pos(arm, "head")
    neck = bone_pos(arm, "neck")
    H = spec.PROPORTIONS["height"]
    top = posed_bounds(objs)[1].z
    plo = V((head.x - 0.3, head.y - 0.3, neck.z - 0.30 * H / 1.9))
    phi = V((head.x + 0.3, head.y + 0.3, min(top, head.z + 0.36 * H / 1.9) + 0.03))
    _fit_camera(cam, plo, phi, cfg["portrait_yaw"], 6.0, 85.0, 0.92, 1.0, 0.5)
    bible_lights(cam, cfg, light, rim=0.8, scale=0.8, pair=True, target=(plo + phi) * 0.5)
    if want("portrait") or want("icon"):
        PW = max(64, int(round(512 * scale)))
        pplate = backdrop_plate(cam, cfg, light, PW, PW, os.path.join(P["renders"], f"{pre}_pplate.png"), fast,
                                paint_r=2)
    if want("portrait"):
        setup(PW * 3 // 2, PW * 3 // 2, max(16, 72 // S), view="Khronos PBR Neutral")
        raw = os.path.join(P["renders"], f"{pre}portrait_raw.png")
        render(raw)
        imageops.denoise(raw)
        fg = imageops.premul_resize(imageops.load(raw), PW, PW)
        out["portrait"] = imageops.save(imageops.grade(splash_post(fg, pplate, 0.6 if cfg.get("post", True) else 0.0)),
                                        dest("portrait"), alpha=False)
        T["portrait"] = round(time.perf_counter() - t0, 2)

    # ── icon 128² (head close-up: the mask and crown read at a glance) ──
    if not skin and want("icon"):
        t0 = time.perf_counter()
        ilo = V((head.x - 0.2, head.y - 0.2, head.z - 0.16 * H / 1.9))
        ihi = V((head.x + 0.2, head.y + 0.2, min(top, head.z + 0.34 * H / 1.9) + 0.02))
        _fit_camera(cam, ilo, ihi, cfg["icon_yaw"], 3.0, 85.0, 0.9, 1.0, 0.5)
        bible_lights(cam, cfg, light, rim=1.2, scale=0.6, pair=True, target=(ilo + ihi) * 0.5)
        setup(256, 256, max(16, 96 // S), view="Khronos PBR Neutral")
        raw_i = os.path.join(P["renders"], "icon_raw.png")
        render(raw_i)
        imageops.denoise(raw_i)
        fg = imageops.premul_resize(imageops.load(raw_i), 128, 128)
        sky = imageops.resize(pplate, 128, 128)
        sky[..., :3] = sky[..., :3] * 0.85 + 0.05
        out["icon"] = imageops.save(imageops.grade(imageops.over(fg, sky)), dest("icon"), alpha=False)
        T["icon"] = round(time.perf_counter() - t0, 2)

    for o in list(bpy.context.scene.objects):
        if o.type == "LIGHT" and o.name.startswith("vale_key_sun"):
            o.hide_render = True
    cam.data.shift_x = cam.data.shift_y = 0.0
    if not skin and want("turntable") and not preview:
        T["turntable"], out["turntable"] = turntable(ctx, P, chains, fast)
    for f in ("portrait_raw", "icon_raw", "splash_raw"):
        p = os.path.join(P["renders"], f"{pre}{f}.png")
        if os.path.isfile(p):
            os.remove(p)
    anim.apply_pose(arm, {})
    return {"files": {k: scene.rel(v) for k, v in out.items()}, "seconds": T}


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
