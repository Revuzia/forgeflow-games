"""Stylized-PBR node materials: the VALE studio look (hand-painted feel under PBR light).

Every material here is a Cycles node graph that ends in ONE Principled BSDF named "BSDF" whose
Base Color / Roughness / Metallic / Normal inputs carry the look. bake.py reads those inputs
(emission trick) and rebuilds a plain glTF material from the baked images, so anything painted
into these graphs (edge highlights, cavity dirt, value gradient, weave, grain) ends up in the
textures. Materials named in `KEEP` (the required emissive `accent`, glowing gems) are not baked:
they export as factor-only glTF materials.

Painted cues used throughout:
  * edge highlight from Geometry > Pointiness on the HIGH mesh (worn/lit edges)
  * cavity darkening from a local Ambient Occlusion node (dirt in creases)
  * low-frequency hue/value breakup (brush blotches) + stretched noise (brush strokes)
  * VALUE GRADIENT: object-space Z darkens toward the feet and lifts toward the head/shoulders
    (classic top-down readability: the silhouette's top pops, feet melt into the ground)

Colours come from a palette dict (hex strings) so the style bible can drive every fighter/skin.
Object coordinates are used for all textures: build parts with identity object transforms.
"""
from __future__ import annotations

import colorsys

import bpy

from .scene import hex_rgb

KEEP = ("accent",)          # material names (or prefixes 'gem_', 'glow_') that bake.py leaves alone
KEEP_PREFIXES = ("gem_", "glow_")

DEFAULT_PALETTE = {
    "metal": "#8f98a6",      # painted steel
    "metal_dark": "#3b4452",
    "trim": "#c9a04e",       # brass / gold trims
    "cloth": "#2f5a87",      # primary fabric
    "cloth2": "#d8cfb8",     # secondary fabric / lining
    "under": "#2e3138",      # padded under-suit
    "leather": "#6a442b",
    "leather_dark": "#3b261a",
    "skin": "#c99678",
    "wood": "#7a5534",
    "stone": "#8c877d",
    "gem": "#62e0ff",
    "accent": "#6fe6ff",     # readability accent (team/player tint replaces it at runtime)
}
DEFAULT_GRADIENT = {"z0": 0.0, "z1": 1.85, "low": 0.58, "high": 1.08, "gamma": 0.8}


def palette(**overrides) -> dict:
    p = dict(DEFAULT_PALETTE)
    p.update(overrides)
    return p


def is_kept(mat_or_name) -> bool:
    n = mat_or_name if isinstance(mat_or_name, str) else mat_or_name.name
    return n in KEEP or n.startswith(KEEP_PREFIXES)


def shade_hex(h: str, value: float = 1.0, sat: float = 1.0, hue: float = 0.0) -> tuple:
    """Linear RGBA of `h` with HSV value/saturation multipliers and a hue shift (turns)."""
    r, g, b = (int(h.lstrip("#")[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    hh, s, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb((hh + hue) % 1.0, min(1.0, s * sat), min(1.0, v * value))
    from .scene import srgb_to_linear
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


# ── tiny node-graph builder ────────────────────────────────────────────────────────────────────
class G:
    def __init__(self, mat: bpy.types.Material):
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0
        self.out = self.n("ShaderNodeOutputMaterial", loc=(900, 0))
        self.bsdf = self.n("ShaderNodeBsdfPrincipled", loc=(600, 0))
        self.bsdf.name = "BSDF"
        self.link(self.bsdf.outputs["BSDF"], self.out.inputs["Surface"])
        self._coord = None
        self._geo = None

    def n(self, kind: str, loc=None, **inputs):
        node = self.nt.nodes.new(kind)
        if loc:
            node.location = loc
        else:
            node.location = (self.x, 0)
            self.x -= 10
        for k, v in inputs.items():
            if hasattr(node, k) and not k[0].isupper():
                setattr(node, k, v)
            else:
                node.inputs[k].default_value = v
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)
        return b

    @property
    def obj(self):
        if self._coord is None:
            self._coord = self.n("ShaderNodeTexCoord")
        return self._coord.outputs["Object"]

    @property
    def geo(self):
        if self._geo is None:
            self._geo = self.n("ShaderNodeNewGeometry")
        return self._geo

    def mapping(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        m = self.n("ShaderNodeMapping")
        m.inputs["Scale"].default_value = scale
        m.inputs["Location"].default_value = loc
        m.inputs["Rotation"].default_value = rot
        self.link(vec, m.inputs["Vector"])
        return m.outputs["Vector"]

    def noise(self, vec=None, scale=5.0, detail=3.0, rough=0.5, distortion=0.0, dims="3D"):
        t = self.n("ShaderNodeTexNoise")
        t.noise_dimensions = dims
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        t.inputs["Distortion"].default_value = distortion
        self.link(vec if vec is not None else self.obj, t.inputs["Vector"])
        return t

    def voronoi(self, vec=None, scale=5.0, feature="F1", metric="EUCLIDEAN"):
        t = self.n("ShaderNodeTexVoronoi")
        t.feature = feature
        t.distance = metric
        t.inputs["Scale"].default_value = scale
        self.link(vec if vec is not None else self.obj, t.inputs["Vector"])
        return t

    def wave(self, vec=None, scale=5.0, kind="BANDS", direction="X", distortion=0.0, detail=2.0, profile="SIN"):
        t = self.n("ShaderNodeTexWave")
        t.wave_type = kind
        if kind == "BANDS":
            t.bands_direction = direction
        else:
            t.rings_direction = direction
        t.wave_profile = profile
        t.inputs["Scale"].default_value = scale
        t.inputs["Distortion"].default_value = distortion
        t.inputs["Detail"].default_value = detail
        self.link(vec if vec is not None else self.obj, t.inputs["Vector"])
        return t

    def ramp(self, fac, stops):
        """stops: [(pos, (r,g,b,a) or float)]"""
        r = self.n("ShaderNodeValToRGB")
        cr = r.color_ramp
        cr.interpolation = "EASE"
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        for i, (pos, col) in enumerate(stops):
            e = cr.elements[0] if i == 0 else cr.elements.new(pos)
            e.position = pos
            if isinstance(col, (int, float)):
                col = (col, col, col, 1.0)
            e.color = col
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def mix(self, a, b, fac, blend="MIX"):
        m = self.n("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = blend
        m.clamp_result = True
        self._in(m.inputs[0], fac)
        self._in(m.inputs[6], a)
        self._in(m.inputs[7], b)
        return m.outputs[2]

    def mixf(self, a, b, fac):
        m = self.n("ShaderNodeMix")
        m.data_type = "FLOAT"
        m.clamp_result = True
        self._in(m.inputs[0], fac)
        self._in(m.inputs[2], a)
        self._in(m.inputs[3], b)
        return m.outputs[0]

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath")
        m.operation = op
        m.use_clamp = clamp
        self._in(m.inputs[0], a)
        if b is not None:
            self._in(m.inputs[1], b)
        return m.outputs[0]

    def sep_z(self, vec=None):
        s = self.n("ShaderNodeSeparateXYZ")
        self.link(vec if vec is not None else self.obj, s.inputs[0])
        return s.outputs["Z"]

    def ao(self, distance=0.05, samples=16, local=True):
        a = self.n("ShaderNodeAmbientOcclusion")
        a.samples = samples
        a.only_local = local
        a.inputs["Distance"].default_value = distance
        return a.outputs["AO"]

    def bump(self, height, strength=0.2, distance=0.01, normal=None):
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    def _in(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.link(val, sock)
        else:
            if isinstance(val, (tuple, list)) and len(val) == 3 and sock.type == "RGBA":
                val = (*val, 1.0)
            sock.default_value = val

    def set_bsdf(self, color=None, rough=None, metal=None, normal=None, emission=None, emission_strength=None,
                 alpha=None, specular=None, coat=None):
        b = self.bsdf
        for name, v in (("Base Color", color), ("Roughness", rough), ("Metallic", metal), ("Normal", normal),
                        ("Emission Color", emission), ("Emission Strength", emission_strength),
                        ("Alpha", alpha), ("Specular IOR Level", specular), ("Coat Weight", coat)):
            if v is not None:
                self._in(b.inputs[name], v)


def _new(name: str) -> tuple[bpy.types.Material, G]:
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, G(m)


# ── shared painted cues ─────────────────────────────────────────────────────────────────────────
def value_gradient(g: G, color, grad: dict | None):
    """Multiply `color` by a Z ramp: `low` at z0 (feet) -> `high` at z1 (head)."""
    if not grad:
        return color
    z = g.sep_z()
    span = max(1e-3, grad["z1"] - grad["z0"])
    t = g.math("MULTIPLY", g.math("SUBTRACT", z, grad["z0"]), 1.0 / span, clamp=True)
    t = g.math("POWER", t, grad.get("gamma", 1.0))
    v = g.math("ADD", g.math("MULTIPLY", t, grad["high"] - grad["low"]), grad["low"])
    return _mul_scalar(g, color, v)


def _mul_scalar(g: G, color, s):
    c = g.n("ShaderNodeCombineColor")
    g.link(s, c.inputs[0])
    g.link(s, c.inputs[1])
    g.link(s, c.inputs[2])
    return g.mix(color, c.outputs[0], 1.0, "MULTIPLY")


def painted_breakup(g: G, color, amount=0.12, scale=2.5, hue=0.02):
    """Low-frequency value/hue blotches + stretched brush strokes."""
    n1 = g.noise(scale=scale, detail=2.0, rough=0.55)
    blot = g.ramp(n1.outputs["Fac"], [(0.3, 1.0 - amount), (0.7, 1.0 + amount * 0.6)])
    c = g.mix(color, blot, 1.0, "MULTIPLY")
    strokes = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 7.0)), scale=9.0, detail=1.0, rough=0.4)
    s = g.ramp(strokes.outputs["Fac"], [(0.35, 1.0 - amount * 0.5), (0.65, 1.0 + amount * 0.4)])
    return g.mix(c, s, 1.0, "MULTIPLY")


def edge_cavity(g: G, color, edge_col, cavity_col, edge=0.6, cavity=0.75, ao_dist=0.04,
                edge_lo=0.505, edge_hi=0.56):
    """Edge highlight (pointiness) + cavity dirt (local AO)."""
    p = g.geo.outputs["Pointiness"]
    e = g.ramp(p, [(edge_lo, 0.0), (edge_hi, 1.0)])
    e = g.math("MULTIPLY", e, edge)
    c = g.mix(color, edge_col, e)
    ao = g.ao(distance=ao_dist)
    cav = g.ramp(ao, [(0.25, 1.0), (0.85, 0.0)])
    cav = g.math("MULTIPLY", cav, cavity)
    return g.mix(c, cavity_col, cav), e


# ── material library ────────────────────────────────────────────────────────────────────────────
def painted_metal(name: str, pal: dict, key: str = "metal", grad=None, metallic: float = 0.9,
                  rough: float = 0.38, brushed: float = 1.0, edge: float = 0.85, cavity: float = 0.8,
                  hammered: float = 0.0) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.10, scale=3.0)
    # brushed streaks (anisotropic look baked into albedo/roughness)
    br = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 40.0)), scale=14.0, detail=4.0, rough=0.6)
    brf = g.ramp(br.outputs["Fac"], [(0.35, 1.0 - 0.08 * brushed), (0.65, 1.0 + 0.06 * brushed)])
    c = g.mix(c, brf, 1.0, "MULTIPLY")
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.75, 0.6), shade_hex(pal.get(key + "_dark", pal[key]), 0.45, 1.1),
                       edge=edge, cavity=cavity)
    c = value_gradient(g, c, grad)
    r = g.ramp(br.outputs["Fac"], [(0.3, rough - 0.08), (0.7, rough + 0.10)])
    r = g.mixf(g.math("ADD", r, 0.0), rough - 0.15, e)
    nrm = None
    if hammered > 0:
        vo = g.voronoi(scale=60.0, feature="SMOOTH_F1")
        nrm = g.bump(vo.outputs["Distance"], strength=0.12 * hammered, distance=0.004)
    g.set_bsdf(color=c, rough=r, metal=metallic, normal=nrm)
    return m


def leather(name: str, pal: dict, key: str = "leather", grad=None, rough: float = 0.62) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.14, scale=4.0, hue=0.01)
    grain = g.noise(scale=180.0, detail=6.0, rough=0.7)
    cells = g.voronoi(scale=90.0, feature="F1")
    h = g.math("ADD", g.math("MULTIPLY", grain.outputs["Fac"], 0.6), g.math("MULTIPLY", cells.outputs["Distance"], 0.4))
    c = g.mix(c, shade_hex(pal[key], 0.75), g.ramp(h, [(0.35, 0.0), (0.6, 0.5)]))
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.45, 0.75), shade_hex(pal.get(key + "_dark", pal[key]), 0.5),
                       edge=0.6, cavity=0.7)
    c = value_gradient(g, c, grad)
    r = g.mixf(rough + 0.1, rough - 0.18, e)
    g.set_bsdf(color=c, rough=r, metal=0.0, normal=g.bump(h, strength=0.18, distance=0.002))
    return m


def cloth(name: str, pal: dict, key: str = "cloth", grad=None, rough: float = 0.86, weave_scale: float = 260.0,
          trim_key: str | None = None) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.12, scale=3.0, hue=0.015)
    wx = g.wave(scale=weave_scale, direction="X", profile="SIN")
    wz = g.wave(scale=weave_scale, direction="Z", profile="SIN")
    weave = g.math("MULTIPLY", wx.outputs["Fac"], wz.outputs["Fac"])
    c = g.mix(c, shade_hex(pal[key], 0.82), g.math("MULTIPLY", weave, 0.5))
    # folds: local AO deepens fold valleys, pointiness lifts crests (painted light on folds)
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.35, 0.85), shade_hex(pal[key], 0.42, 1.15),
                       edge=0.45, cavity=0.85, ao_dist=0.06, edge_lo=0.5, edge_hi=0.54)
    c = value_gradient(g, c, grad)
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(weave, strength=0.08, distance=0.001))
    return m


def skin(name: str, pal: dict, key: str = "skin", grad=None, rough: float = 0.55) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.06, scale=5.0)
    warm = g.noise(scale=3.0, detail=2.0)
    c = g.mix(c, shade_hex(pal[key], 0.92, 1.25, -0.015), g.ramp(warm.outputs["Fac"], [(0.4, 0.0), (0.7, 0.45)]))
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.18, 0.85), shade_hex(pal[key], 0.55, 1.3, -0.02),
                       edge=0.35, cavity=0.55, ao_dist=0.03)
    c = value_gradient(g, c, grad)
    pores = g.noise(scale=400.0, detail=2.0)
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(pores.outputs["Fac"], strength=0.03, distance=0.001))
    return m


def stone(name: str, pal: dict, key: str = "stone", grad=None, rough: float = 0.82) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.16, scale=2.0)
    v = g.voronoi(scale=6.0, feature="DISTANCE_TO_EDGE")
    crack = g.ramp(v.outputs["Distance"], [(0.0, 1.0), (0.05, 0.0)])
    c = g.mix(c, shade_hex(pal[key], 0.45), g.math("MULTIPLY", crack, 0.8))
    n = g.noise(scale=25.0, detail=8.0, rough=0.65)
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.35, 0.7), shade_hex(pal[key], 0.4), edge=0.7, cavity=0.8,
                       ao_dist=0.08)
    c = value_gradient(g, c, grad)
    h = g.math("SUBTRACT", n.outputs["Fac"], g.math("MULTIPLY", crack, 0.6))
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(h, strength=0.35, distance=0.01))
    return m


def wood(name: str, pal: dict, key: str = "wood", grad=None, rough: float = 0.6, axis: str = "Z") -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    vec = g.mapping(g.obj, scale=(1.0, 1.0, 0.08) if axis == "Z" else (0.08, 1.0, 1.0))
    rings = g.wave(vec, scale=22.0, kind="RINGS", direction="Z" if axis == "Z" else "X", distortion=6.0, detail=3.0)
    c = g.mix(shade_hex(pal[key], 0.72), shade_hex(pal[key], 1.15), g.ramp(rings.outputs["Fac"], [(0.2, 0.0), (0.8, 1.0)]))
    c = painted_breakup(g, c, amount=0.1, scale=3.0)
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.5, 0.7), shade_hex(pal[key], 0.4), edge=0.6, cavity=0.7)
    c = value_gradient(g, c, grad)
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(rings.outputs["Fac"], strength=0.1, distance=0.002))
    return m


def gem(name: str, pal: dict, key: str = "gem", strength: float = 3.0) -> bpy.types.Material:
    """Emissive crystal; name it `gem_*` to keep it un-baked (glTF emissive factor)."""
    m, g = _new(name if name.startswith(KEEP_PREFIXES) else "gem_" + name)
    col = shade_hex(pal[key])
    g.set_bsdf(color=shade_hex(pal[key], 0.7), rough=0.15, metal=0.0, emission=col, emission_strength=strength)
    return m


def accent(pal: dict, key: str = "accent", strength: float = 2.0) -> bpy.types.Material:
    """The REQUIRED emissive readability material (CONTRACT §12). The renderer tints its emissive
    with the team/player colour; the authored colour is what portraits show."""
    m, g = _new("accent")
    col = shade_hex(pal[key])
    g.set_bsdf(color=shade_hex(pal[key], 0.85, 0.6), rough=0.35, metal=0.0, emission=col, emission_strength=strength)
    return m


def flat(name: str, rgba, rough=0.5, metal=0.0) -> bpy.types.Material:
    m, g = _new(name)
    g.set_bsdf(color=rgba, rough=rough, metal=metal)
    return m


def standard_set(pal: dict, grad: dict | None = None, prefix: str = "") -> dict:
    """The usual fighter material set keyed by role."""
    grad = grad if grad is not None else dict(DEFAULT_GRADIENT)
    return {
        "metal": painted_metal(prefix + "metal", pal, "metal", grad),
        "trim": painted_metal(prefix + "trim", pal, "trim", grad, metallic=1.0, rough=0.32, brushed=0.6, edge=1.0),
        "dark_metal": painted_metal(prefix + "dark_metal", pal, "metal_dark", grad, metallic=0.85, rough=0.45),
        "cloth": cloth(prefix + "cloth", pal, "cloth", grad),
        "cloth2": cloth(prefix + "cloth2", pal, "cloth2", grad),
        "under": cloth(prefix + "under", pal, "under", grad, weave_scale=180.0),
        "leather": leather(prefix + "leather", pal, "leather", grad),
        "leather_dark": leather(prefix + "leather_dark", pal, "leather_dark", grad),
        "skin": skin(prefix + "skin", pal, "skin", grad),
        "wood": wood(prefix + "wood", pal, "wood", grad),
        "accent": accent(pal),
    }
