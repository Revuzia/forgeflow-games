"""Equirect sky HDR (Radiance .hdr, 2048×1024 by default) for a map's environment light.

Built entirely in Cycles: Blender's physical Sky Texture (MULTIPLE_SCATTERING by default) plus a
PAINTED procedural cloud layer evaluated in the world shader (a flat cloud deck projected from
the view direction, fBm noise with domain warp, coverage threshold, fake self-shadowing by
sampling the deck again toward the sun, horizon fade), rendered through a panoramic
equirectangular camera. No downloaded HDRIs.

Orientation (matches three.js equirect sampling): the image centre looks along world +X
(three +X), the right half turns toward Blender -Y (three +Z, the direction models face), the top
row is straight up. `sun_azimuth_deg` is measured in that frame: 0 = toward +X, 90 = toward
three +Z (Blender -Y), 180 = -X, 270 = three -Z (Blender +Y). `sun_elevation_deg` above horizon.
MapDef.art.lighting.sunDir should be derived from the same two numbers (see sun_dir_three()).

Parameters (style bible picks them per map):
    sun_elevation_deg, sun_azimuth_deg, sky_type ('MULTIPLE_SCATTERING' | 'SINGLE_SCATTERING' |
    'HOSEK_WILKIE' | 'PREETHAM'), turbidity (haze: aerosol density for the scattering models,
    turbidity for Hosek/Preetham), air, ozone, cloud_cover (0..1), cloud_scale, cloud_height,
    cloud_softness, cloud_tint '#rrggbb', sky_tint '#rrggbb', ground '#rrggbb',
    sun_disc (False: the renderer's directional light is the sun), exposure (stops), seed.
"""
from __future__ import annotations

import math
import os
import time

import bpy
import numpy as np

from . import imageops, scene

DEFAULTS = {
    "sun_elevation_deg": 35.0, "sun_azimuth_deg": 120.0, "sky_type": "MULTIPLE_SCATTERING",
    "turbidity": 2.2, "air": 1.0, "ozone": 1.0, "cloud_cover": 0.45, "cloud_scale": 1.0,
    "cloud_height": 1.0, "cloud_softness": 0.18, "cloud_tint": "#ffffff", "sky_tint": "#ffffff",
    "ground": "#5d6450", "sun_disc": False, "exposure": 0.0, "seed": 1, "size": [2048, 1024],
    "samples": 16, "target_mean": 1.0,
}


def sun_vector_blender(az_deg: float, el_deg: float):
    """Unit vector toward the sun in Blender coordinates (az frame documented above)."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    # three: az 0 -> +X, 90 -> +Z ; Blender: three +Z == Blender -Y
    return (math.cos(el) * math.cos(az), -math.cos(el) * math.sin(az), math.sin(el))


def sun_dir_three(az_deg: float, el_deg: float) -> list:
    """Direction toward the sun in three.js coordinates (for MapDef lighting.sunDir)."""
    x, y, z = sun_vector_blender(az_deg, el_deg)
    return [round(x, 4), round(z, 4), round(-y, 4)]


def _world(p: dict):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("vale_sky")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new

    def math_(op, a, b=None, clamp=False):
        m = N("ShaderNodeMath")
        m.operation = op
        m.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, bpy.types.NodeSocket):
                L(v, m.inputs[i])
            else:
                m.inputs[i].default_value = v
        return m.outputs[0]

    def mixc(a, b, f):
        m = N("ShaderNodeMix")
        m.data_type = "RGBA"
        m.clamp_result = False
        m.clamp_factor = True
        for sock, v in ((m.inputs[0], f), (m.inputs[6], a), (m.inputs[7], b)):
            if isinstance(v, bpy.types.NodeSocket):
                L(v, sock)
            else:
                sock.default_value = v
        return m.outputs[2]

    out = N("ShaderNodeOutputWorld")
    bg = N("ShaderNodeBackground")
    L(bg.outputs["Background"], out.inputs["Surface"])
    sky = N("ShaderNodeTexSky")
    sky.sky_type = p["sky_type"]
    sv = sun_vector_blender(p["sun_azimuth_deg"], p["sun_elevation_deg"])
    sky.sun_elevation = math.radians(p["sun_elevation_deg"])
    # Blender's sky: sun_rotation 0 puts the sun toward +Y; rotate it onto our azimuth
    sky.sun_rotation = math.atan2(sv[0], sv[1]) % (2 * math.pi)
    if p["sky_type"] in ("MULTIPLE_SCATTERING", "SINGLE_SCATTERING"):
        sky.sun_disc = bool(p["sun_disc"])
        sky.air_density = p["air"]
        sky.aerosol_density = max(0.0, p["turbidity"] / 2.2)
        sky.ozone_density = p["ozone"]
        sky.altitude = 200.0
    else:
        sky.turbidity = p["turbidity"]
    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(tc.outputs["Generated"], sep.inputs[0])
    dz = sep.outputs["Z"]
    sky_col = mixc(sky.outputs["Color"], (*scene.hex_rgb(p["sky_tint"]), 1.0), 1.0)
    sky_col.node.blend_type = "MULTIPLY"
    # cloud deck: uv = dir.xy / max(dir.z, eps) (flat layer at unit height)
    zc = math_("MAXIMUM", dz, 0.035)
    u = math_("DIVIDE", sep.outputs["X"], zc)
    v = math_("DIVIDE", sep.outputs["Y"], zc)
    comb = N("ShaderNodeCombineXYZ")
    L(u, comb.inputs[0])
    L(v, comb.inputs[1])
    s = 0.6 * p["cloud_scale"] / max(0.2, p["cloud_height"])
    rng = scene.rng("sky", p["seed"])
    off = (rng.uniform(0, 100), rng.uniform(0, 100), 0.0)

    def deck(shift):
        mp = N("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (s, s, 1)
        mp.inputs["Location"].default_value = (off[0] + shift[0], off[1] + shift[1], 0)
        L(comb.outputs[0], mp.inputs["Vector"])
        warp = N("ShaderNodeTexNoise")
        warp.noise_dimensions = "2D"
        warp.inputs["Scale"].default_value = 0.9
        warp.inputs["Detail"].default_value = 2.0
        L(mp.outputs[0], warp.inputs["Vector"])
        add = N("ShaderNodeVectorMath")
        add.operation = "MULTIPLY_ADD"
        L(warp.outputs["Color"], add.inputs[0])
        add.inputs[1].default_value = (0.9, 0.9, 0.0)
        L(mp.outputs[0], add.inputs[2])
        n = N("ShaderNodeTexNoise")
        n.noise_dimensions = "2D"
        n.inputs["Scale"].default_value = 1.6
        n.inputs["Detail"].default_value = 8.0
        n.inputs["Roughness"].default_value = 0.58
        L(add.outputs[0], n.inputs["Vector"])
        cover = p["cloud_cover"]
        lo = 0.66 - 0.32 * cover
        mr = N("ShaderNodeMapRange")
        mr.interpolation_type = "SMOOTHSTEP"
        mr.inputs["From Min"].default_value = lo
        mr.inputs["From Max"].default_value = lo + p["cloud_softness"]
        L(n.outputs["Fac"], mr.inputs["Value"])
        return mr.outputs["Result"]

    dens = deck((0.0, 0.0))
    # light: sample the deck shifted toward the sun -> thinner there = lit rim (painterly)
    sh = 0.12 / s
    toward = deck((sv[0] * sh, sv[1] * sh))
    lit = math_("SUBTRACT", 1.0, math_("MULTIPLY", math_("SUBTRACT", toward, math_("MULTIPLY", dens, 0.4)), 1.6),
                clamp=True)
    sun_col = sky.outputs["Color"]  # sky colour near the sun carries the warm tint
    tint = (*scene.hex_rgb(p["cloud_tint"]), 1.0)
    el = max(0.05, math.sin(math.radians(p["sun_elevation_deg"])))
    bright = mixc((0.95, 0.93, 0.92, 1), (1.0, 0.86, 0.70, 1), 1.0 - min(1.0, el * 1.6))
    lit_col = mixc(bright, tint, 0.5)
    shadow_col = mixc((0.42, 0.47, 0.58, 1), tint, 0.25)
    cloud_rgb = mixc(shadow_col, lit_col, lit)
    # brightness of the deck scales with the sky's overall luminance (overcast vs clear)
    lum = N("ShaderNodeRGBToBW")
    L(sky.outputs["Color"], lum.inputs[0])
    gain = math_("ADD", math_("MULTIPLY", lum.outputs[0], 0.9), 0.35)
    cloud_rgb2 = mixc(cloud_rgb, (1, 1, 1, 1), 0.0)
    cm = N("ShaderNodeVectorMath")
    cm.operation = "SCALE"
    L(cloud_rgb2, cm.inputs[0])
    L(gain, cm.inputs["Scale"])
    fade = N("ShaderNodeMapRange")
    fade.interpolation_type = "SMOOTHSTEP"
    fade.inputs["From Min"].default_value = 0.02
    fade.inputs["From Max"].default_value = 0.30
    L(dz, fade.inputs["Value"])
    alpha = math_("MULTIPLY", dens, fade.outputs["Result"])
    alpha = math_("MULTIPLY", alpha, 0.92)
    col = mixc(sky_col, cm.outputs[0], alpha)
    # below the horizon: tinted ground haze instead of the black of the physical model
    gnd = N("ShaderNodeMapRange")
    gnd.interpolation_type = "SMOOTHSTEP"
    gnd.inputs["From Min"].default_value = 0.0
    gnd.inputs["From Max"].default_value = -0.08
    L(dz, gnd.inputs["Value"])
    gcol = N("ShaderNodeVectorMath")
    gcol.operation = "SCALE"
    gcol.inputs[0].default_value = scene.hex_rgb(p["ground"])
    L(gain, gcol.inputs["Scale"])
    final = mixc(col, gcol.outputs[0], gnd.outputs["Result"])
    L(final, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    del sun_col
    return w


def build_sky(params: dict, out_hdr: str, preview_png: str | None = None) -> dict:
    p = dict(DEFAULTS)
    p.update(params or {})
    t0 = time.perf_counter()
    scene.reset()
    sc = bpy.context.scene
    _world(p)
    cd = bpy.data.cameras.new("pano")
    cd.type = "PANO"
    cd.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("pano", cd)
    sc.collection.objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))     # look along +X, up +Z
    sc.camera = cam
    w, h = p["size"]
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.cycles.samples = p["samples"]
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    tmp = os.path.join(scene.CACHE_DIR, "sky_tmp.exr")
    scene.ensure_dir(os.path.dirname(tmp))
    st = sc.render.image_settings
    st.file_format = "OPEN_EXR"
    st.color_depth = "32"
    st.color_mode = "RGB"
    sc.render.filepath = tmp
    t = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    t_render = time.perf_counter() - t
    img = bpy.data.images.load(tmp)
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr = arr.reshape(h, w, 4)
    # normalise: mean upper-hemisphere luminance -> target_mean, then exposure (stops)
    up = arr[h // 2:, :, :3]                                # bottom-up rows: upper half = sky
    lum = (0.2126 * up[..., 0] + 0.7152 * up[..., 1] + 0.0722 * up[..., 2])
    wts = np.cos(np.linspace(0, math.pi / 2, up.shape[0], dtype=np.float32))[:, None]
    mean = float((lum * wts).sum() / (wts.sum() * up.shape[1]))
    k = (p["target_mean"] / max(mean, 1e-6)) * (2.0 ** p["exposure"])
    arr[..., :3] *= k
    img.pixels.foreach_set(arr.ravel())
    scene.ensure_dir(os.path.dirname(out_hdr))
    img.filepath_raw = out_hdr
    img.file_format = "HDR"
    img.save(filepath=out_hdr)
    stats = {"render_s": round(t_render, 2), "mean_sky_lum": round(mean * k, 3), "max": round(float(arr[..., :3].max()), 2),
             "scale": round(k, 5)}
    if preview_png:
        prev = arr[::-1, :, :3].copy()
        prev = prev / (1.0 + prev)                         # simple Reinhard for QA viewing
        prev = np.clip(prev, 0, 1) ** (1 / 2.2)
        prev = imageops.resize(np.concatenate([prev, np.ones(prev.shape[:2] + (1,), np.float32)], 2), 1024, 512)
        imageops.save(prev, preview_png, alpha=False)
    bpy.data.images.remove(img)
    os.remove(tmp)
    stats["total_s"] = round(time.perf_counter() - t0, 2)
    stats["sun_dir_three"] = sun_dir_three(p["sun_azimuth_deg"], p["sun_elevation_deg"])
    stats["params"] = p
    scene.log(f"sky {os.path.basename(out_hdr)}: {stats['render_s']}s render, mean {stats['mean_sky_lum']}, max {stats['max']}")
    return stats
