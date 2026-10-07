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

BIBLE BEARINGS. The style bible and tokens.json give the sun as a compass bearing in the game
world (camera looks -Z = north = screen-up): 0 = -Z, 90 = +X (east, screen-right), 180 = +Z
(toward the camera), 270 = -X (west). Presets should use `sun_bearing_deg` (bible numbers verbatim);
it converts to this module's azimuth as `azimuth = bearing - 90`, and sun_dir_three() then equals
tokens.json grade.maps.<map>.sun.dir (checked at build time, `sun_dir_check`).

Parameters (style bible picks them per map):
    sun_elevation_deg, sun_bearing_deg (bible) | sun_azimuth_deg (this frame),
    sky_type ('MULTIPLE_SCATTERING' | 'SINGLE_SCATTERING' | 'HOSEK_WILKIE' | 'PREETHAM'),
    air, aerosol, ozone, altitude_m (Multiple Scattering densities, tokens.json values verbatim;
    `turbidity` is the legacy haze knob: aerosol = turbidity / 2.2 when `aerosol` is absent),
    clouds: cloud_kind ('cumulus' | 'altocumulus' | 'cirrus'), cloud_cover (0..1), cloud_scale,
    cloud_height, cloud_softness, cloud_opacity, cloud_stretch (cirrus streak ratio),
    cloud_angle_deg (streak direction), cloud_tint '#rrggbb' (lit side), cloud_shadow_tint
    '#rrggbb' (underside, e.g. warm-lit undersides), sky_tint '#rrggbb', ground '#rrggbb',
    split {"west": hex, "east": hex, "strength": 0..1} (horizontal temperature split, menu sky),
    sun_disc (False: the renderer's directional light is the sun), exposure (stops), seed, size.
Clouds live in the dome only: nothing here casts cloud shadows on the map (bible look rules).
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
    "turbidity": 2.2, "air": 1.0, "ozone": 1.0, "altitude_m": 200.0, "cloud_kind": "cumulus",
    "cloud_cover": 0.45, "cloud_scale": 1.0, "cloud_height": 1.0, "cloud_softness": 0.18,
    "cloud_opacity": 0.92, "cloud_stretch": 1.0, "cloud_angle_deg": 0.0, "cloud_tint": "#ffffff",
    "cloud_shadow_tint": None, "sky_tint": "#ffffff", "ground": "#5d6450", "split": None,
    "sun_disc": False, "exposure": 0.0, "seed": 1, "size": [2048, 1024], "samples": 16, "target_mean": 1.0,
}


def resolve_params(params: dict) -> dict:
    """DEFAULTS + preset, with the bible bearing converted to this module's azimuth."""
    p = dict(DEFAULTS)
    p.update(params or {})
    if p.get("sun_bearing_deg") is not None:
        p["sun_azimuth_deg"] = (float(p["sun_bearing_deg"]) - 90.0) % 360.0
    if p.get("aerosol") is None:
        p["aerosol"] = max(0.0, p["turbidity"] / 2.2)
    return p


def bearing_dir_three(bearing_deg: float, el_deg: float) -> list:
    """tokens.json convention: bearing 0 = -Z, 90 = +X, 180 = +Z (toward the camera)."""
    b, e = math.radians(bearing_deg), math.radians(el_deg)
    return [round(math.cos(e) * math.sin(b), 4), round(math.sin(e), 4), round(-math.cos(e) * math.cos(b), 4)]


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
        sky.aerosol_density = p["aerosol"]
        sky.ozone_density = p["ozone"]
        sky.altitude = p["altitude_m"]
    else:
        sky.turbidity = p["turbidity"]
    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(tc.outputs["Generated"], sep.inputs[0])
    dz = sep.outputs["Z"]
    sky_col = mixc(sky.outputs["Color"], (*scene.hex_rgb(p["sky_tint"]), 1.0), 1.0)
    sky_col.node.blend_type = "MULTIPLY"
    if p.get("split"):
        # horizontal temperature split (menu: cool west / warm east). Blender X = three X = east.
        spl = p["split"]
        sx = N("ShaderNodeMapRange")
        sx.interpolation_type = "SMOOTHSTEP"
        sx.inputs["From Min"].default_value = -0.85
        sx.inputs["From Max"].default_value = 0.85
        L(sep.outputs["X"], sx.inputs["Value"])
        tw = mixc((*scene.hex_rgb(spl["west"]), 1.0), (*scene.hex_rgb(spl["east"]), 1.0), sx.outputs["Result"])
        # normalise the tint to unit luminance so it shifts temperature, not brightness
        tl = N("ShaderNodeRGBToBW")
        L(tw, tl.inputs[0])
        tn = N("ShaderNodeVectorMath")
        tn.operation = "DIVIDE"
        L(tw, tn.inputs[0])
        L(tl.outputs[0], tn.inputs[1])
        k = float(spl.get("strength", 0.3))
        tmul = mixc(sky_col, tn.outputs[0], 1.0)
        tmul.node.blend_type = "MULTIPLY"
        sky_col = mixc(sky_col, tmul, k)
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

    kind = p.get("cloud_kind", "cumulus")
    stretch = max(0.2, float(p.get("cloud_stretch", 1.0)))
    ang = math.radians(float(p.get("cloud_angle_deg", 0.0)))

    def noise2(vec, scale, detail, rough, color=False):
        n = N("ShaderNodeTexNoise")
        n.noise_dimensions = "2D"
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        L(vec, n.inputs["Vector"])
        return n.outputs["Color" if color else "Fac"]

    def smooth(val, lo, hi):
        mr = N("ShaderNodeMapRange")
        mr.interpolation_type = "SMOOTHSTEP"
        mr.inputs["From Min"].default_value = lo
        mr.inputs["From Max"].default_value = hi
        L(val, mr.inputs["Value"])
        return mr.outputs["Result"]

    cover = p["cloud_cover"]
    soft = p["cloud_softness"]

    def deck(shift, shrink: float = 1.0):
        src = comb.outputs[0]
        if shrink != 1.0:                            # toward the deck centre = toward the zenith
            sc_ = N("ShaderNodeVectorMath")
            sc_.operation = "SCALE"
            L(src, sc_.inputs[0])
            sc_.inputs["Scale"].default_value = shrink
            src = sc_.outputs[0]
        mp = N("ShaderNodeMapping")
        # anisotropic deck (cirrus streaks): compress across the streak, rotate the streak direction
        mp.inputs["Scale"].default_value = (s / stretch ** 0.5, s * stretch ** 0.5, 1)
        mp.inputs["Rotation"].default_value = (0, 0, ang)
        mp.inputs["Location"].default_value = (off[0] + shift[0], off[1] + shift[1], 0)
        L(src, mp.inputs["Vector"])
        uv = mp.outputs[0]
        add = N("ShaderNodeVectorMath")             # domain warp: billowy, painterly edges
        add.operation = "MULTIPLY_ADD"
        L(noise2(uv, 0.7, 2.0, 0.5, color=True), add.inputs[0])
        add.inputs[1].default_value = {"cirrus": (0.5, 0.5, 0.0), "cumulus": (0.45, 0.45, 0.0)}.get(kind, (1.1, 1.1, 0.0))
        L(uv, add.inputs[2])
        w = add.outputs[0]
        lo = 0.66 - 0.32 * cover
        if kind == "altocumulus":
            # a field of small rounded puffs (cells) in broad patches (low-frequency mask)
            patch = smooth(noise2(uv, 0.55, 2.0, 0.5), 0.60 - 0.30 * cover, 0.74 - 0.30 * cover)
            vo = N("ShaderNodeTexVoronoi")
            vo.voronoi_dimensions = "2D"
            vo.feature = "SMOOTH_F1"
            vo.inputs["Scale"].default_value = 6.0
            vo.inputs["Smoothness"].default_value = 0.8
            vo.inputs["Randomness"].default_value = 0.85
            L(w, vo.inputs["Vector"])
            puffs = math_("SUBTRACT", 1.0, math_("MULTIPLY", vo.outputs["Distance"], 1.7), clamp=True)
            det = noise2(w, 4.0, 4.0, 0.55)
            n = math_("ADD", math_("MULTIPLY", puffs, 0.8), math_("MULTIPLY", det, 0.35))
            return math_("MULTIPLY", smooth(n, 0.52, 0.52 + soft), patch)
        if kind == "cirrus":
            n = noise2(w, 1.0, 12.0, 0.72)
            return smooth(n, lo, lo + soft)
        # cumulus: big rounded heaps (smooth Voronoi cells) broken up by billowy fBm
        vo = N("ShaderNodeTexVoronoi")
        vo.voronoi_dimensions = "2D"
        vo.feature = "SMOOTH_F1"
        vo.inputs["Scale"].default_value = 1.9
        vo.inputs["Smoothness"].default_value = 1.0
        vo.inputs["Randomness"].default_value = 0.9
        L(w, vo.inputs["Vector"])
        heaps = math_("SUBTRACT", 1.0, math_("MULTIPLY", vo.outputs["Distance"], 1.5), clamp=True)
        bill = noise2(w, 3.2, 5.0, 0.52)
        n = math_("ADD", math_("MULTIPLY", heaps, 0.62), math_("MULTIPLY", bill, 0.48))
        lo_c = 0.72 - 0.45 * cover
        return smooth(n, lo_c, lo_c + soft)

    dens = deck((0.0, 0.0))
    # light: sample the deck shifted toward the sun -> thinner there = lit side (painterly)
    sh = 0.12 / s
    toward = deck((sv[0] * sh, sv[1] * sh))
    lit_sun = math_("SUBTRACT", 1.0, math_("MULTIPLY", math_("SUBTRACT", toward, math_("MULTIPLY", dens, 0.5)), 1.4),
                    clamp=True)
    # top light: thinner toward the zenith = lit crown, denser below = soft shaded base
    above = deck((0.0, 0.0), shrink=0.90)
    lit_top = math_("SUBTRACT", 1.0, math_("MULTIPLY", math_("SUBTRACT", above, math_("MULTIPLY", dens, 0.5)), 1.4),
                    clamp=True)
    lit = math_("ADD", math_("MULTIPLY", lit_sun, 0.55), math_("MULTIPLY", lit_top, 0.45))
    tint = (*scene.hex_rgb(p["cloud_tint"]), 1.0)
    el = max(0.05, math.sin(math.radians(p["sun_elevation_deg"])))
    bright = mixc((0.97, 0.96, 0.95, 1), (1.0, 0.86, 0.70, 1), 1.0 - min(1.0, el * 1.6))
    lit_col = mixc(bright, tint, 0.6)
    if p.get("cloud_shadow_tint"):
        shadow_col = mixc((0.55, 0.60, 0.70, 1), (*scene.hex_rgb(p["cloud_shadow_tint"]), 1.0), 0.85)
    else:
        shadow_col = mixc((0.55, 0.60, 0.70, 1), tint, 0.25)
    # reference brightness: the clear sky at the zenith (constant over the dome), so clouds are
    # brighter than the sky on the lit side (~2x) and soft blue-grey underneath, everywhere alike
    zen = N("ShaderNodeTexSky")
    for attr in ("sky_type", "sun_elevation", "sun_rotation", "sun_disc", "air_density", "aerosol_density",
                 "ozone_density", "altitude", "turbidity"):
        if hasattr(sky, attr):
            try:
                setattr(zen, attr, getattr(sky, attr))
            except Exception:
                pass
    zen.inputs["Vector"].default_value = (0.0, 0.0, 1.0)
    lum = N("ShaderNodeRGBToBW")
    L(zen.outputs["Color"], lum.inputs[0])
    lit_scaled = N("ShaderNodeVectorMath")
    lit_scaled.operation = "SCALE"
    L(lit_col, lit_scaled.inputs[0])
    lit_scaled.inputs["Scale"].default_value = 2.1
    cloud_rgb = mixc(shadow_col, lit_scaled.outputs[0], lit)
    cm = N("ShaderNodeVectorMath")
    cm.operation = "SCALE"
    L(cloud_rgb, cm.inputs[0])
    L(lum.outputs[0], cm.inputs["Scale"])
    # thin edges let the circumsolar glow through (silver lining)
    edge = math_("MULTIPLY", math_("SUBTRACT", 1.0, dens, clamp=True), 0.55)
    glow = N("ShaderNodeVectorMath")
    glow.operation = "SCALE"
    L(sky_col, glow.inputs[0])
    L(edge, glow.inputs["Scale"])
    cl = N("ShaderNodeVectorMath")
    cl.operation = "ADD"
    L(cm.outputs[0], cl.inputs[0])
    L(glow.outputs[0], cl.inputs[1])
    f0, f1 = {"altocumulus": (0.06, 0.38), "cirrus": (0.05, 0.32)}.get(kind, (0.03, 0.26))
    fade = smooth(dz, f0, f1)
    alpha = math_("MULTIPLY", dens, fade)
    alpha = math_("MULTIPLY", alpha, float(p.get("cloud_opacity", 0.92)))
    col = mixc(sky_col, cl.outputs[0], alpha)
    # below the horizon: replaced after normalisation (build_sky: lit ground radiance)
    final = col
    L(final, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    return w


def build_sky(params: dict, out_hdr: str, preview_png: str | None = None) -> dict:
    p = resolve_params(params)
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
    # lower hemisphere = the lit map ground, in the HDR's own units: a horizontal Lambert surface
    # of albedo `ground` under the map sun (three intensity I at elevation el) and this sky, divided
    # by the environment intensity the renderer applies (so IBL bounce from below is plausible).
    I = float(p.get("ground_sun_intensity", 3.0))
    amb = max(0.05, float(p.get("ground_ambient", 0.65)))
    el = math.radians(p["sun_elevation_deg"])
    g_lin = np.array(scene.hex_rgb(p["ground"]), np.float32)
    g_rad = g_lin * ((I * max(math.sin(el), 0.05) / math.pi + amb * 1.0) / amb)
    rows = np.arange(h, dtype=np.float32)
    elev = ((rows + 0.5) / h - 0.5) * math.pi              # bottom-up rows: row 0 = nadir
    hz = arr[h // 2, :, :3].copy()                          # first row above the horizon
    t = np.clip(-elev / math.radians(5.0), 0, 1)
    t = (t * t * (3 - 2 * t))[:, None, None]
    below = (elev < 0)[:, None, None]
    blend = hz[None, :, :] * (1 - t) + g_rad[None, None, :] * t
    arr[..., :3] = np.where(below, blend, arr[..., :3])
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
    if p.get("sun_bearing_deg") is not None:
        stats["sun_dir_bible"] = bearing_dir_three(p["sun_bearing_deg"], p["sun_elevation_deg"])
        stats["sun_dir_check"] = max(abs(a - b) for a, b in zip(stats["sun_dir_three"], stats["sun_dir_bible"])) < 2e-3
    stats["params"] = p
    scene.log(f"sky {os.path.basename(out_hdr)}: {stats['render_s']}s render, mean {stats['mean_sky_lum']}, max {stats['max']}")
    return stats
