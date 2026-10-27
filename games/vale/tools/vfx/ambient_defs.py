"""VALE T0 ambient defs (r12 M14): the amb_* VfxDefs the maps place through art.ambient (content/maps/*.json).

Built into content/vfx.json by tools/vfx/build_vfx.py. They run in src/render/ambient.ts as closed-form GPU particles
(not in the VFX system): only `emitter` and `sprite` layers; `count` is particles per placed point at High (the
quality tier scales it: Low 0.4, Medium 0.7); every particle loops its `life`.

T0 law (tokens vfx.tiers.T0, checked by tools/build_content.ts): emissive <= 0.8, nothing faster than 0.5 Hz (lives
>= 2 s, the wander's partials <= 0.5 Hz, orbit / spin <= 180 deg/s), literal colours only (never a team, element or
signature ref), no team tint, never inside a gameplay zone (the content build checks every placed point against the
lanes, camps, fountains and shops). Warm light sits at hue 19-26 deg (below the harm band 28-50, tokens
vfx.reservedHuesHSV) with saturation ~0.5-0.6; motes and dust stay near neutral (saturation <= 0.15).

Nothing here is a reference game's effect: lamp flames are the Serenade's lampresin, the motes are stalled light
settling over the Dialwood, the Needlespan's updraft lifts chalk dust from the broken needle, the Noonplate's fair hangs
paper lanterns and drops paper petals.
"""
from __future__ import annotations


def fade(a: float, rise: float = 0.25, fall: float = 0.75) -> list:
    """alpha over life: in, hold, out"""
    return [[0, 0], [rise, a], [fall, a], [1, 0]]


def breathe(lo: float, hi: float) -> list:
    """a sprite that breathes once per life (life >= 2 s, so <= 0.5 Hz)"""
    return [[0, lo], [0.5, hi], [1, lo]]


def em(layer: dict) -> dict:
    return {"type": "emitter", **layer}


def sprite(layer: dict) -> dict:
    return {"type": "sprite", **layer}


def flame(core: str, tip: str, glow: str, smoke: bool = False) -> list:
    """a resin lamp's flame: a breathing glow, three lazy tongues, optionally a thin smoke curl"""
    layers = [
        sprite({"texture": "glow", "size": 0.7, "life": 2.6, "alpha": breathe(0.62, 0.86), "emissive": 0.5, "color": glow, "blend": "add"}),
        em({"count": 3, "shape": "point", "life": [2.0, 2.8], "velocity": [0, 0.1, 0], "turbulence": 0.02,
            "size": [[0, 0.08], [0.35, 0.15], [1, 0.03]], "sizeVar": [0.8, 1.2], "color": [[0, core], [1, tip]],
            "alpha": [[0, 0], [0.12, 0.85], [0.6, 0.45], [1, 0]], "emissive": [[0, 0.8], [1, 0.45]], "texture": "light_puff", "blend": "add"}),
    ]
    if smoke:
        layers.append(em({"count": 2, "shape": "point", "life": [5.0, 7.0], "velocity": [0.04, 0.3, 0.02], "turbulence": 0.12,
                          "size": [[0, 0.12], [1, 0.6]], "color": "#8E8A86", "alpha": [[0, 0], [0.2, 0.16], [1, 0]], "emissive": 0.4,
                          "texture": "dust_puff", "blend": "alpha"}))
    return layers


def defs() -> list:
    out = [
        # ── RIFT (Hourfall) ──────────────────────────────────────────────────────────────────────────
        {"$comment": "T0 ambient · RIFT: pale motes of stalled light adrift over the Dialwood crowns (on the blocks, never over a road or room; <= 30 on screen)",
         "id": "amb_rift_canopy_motes", "duration": 10, "teamTint": False, "layers": [
             em({"count": 6, "shape": "aura", "radius": 4.5, "height": 2.4, "life": [7, 11], "velocity": [0.05, 0.06, 0.02], "turbulence": 0.7,
                 "size": [[0, 0.0], [0.2, 0.5], [0.8, 0.5], [1, 0.0]], "sizeVar": [0.7, 1.3], "color": "#D8D4B8", "alpha": fade(0.85),
                 "emissive": 0.7, "texture": "mote", "blend": "add"})]},
        {"$comment": "T0 ambient · RIFT: a lampresin flame in a resin lamp (plaza lips, the noonline shrine): red-amber, below the harm hues",
         "id": "amb_rift_resin_flame", "duration": 2.6, "teamTint": False, "layers": flame("#E0A070", "#A9543A", "#C98457")},
        {"$comment": "T0 ambient · RIFT: dust turning in the light over the Fallen Shaft's banks (the needle's shaft)",
         "id": "amb_rift_shaft_dust", "duration": 10, "teamTint": False, "layers": [
             em({"count": 7, "shape": "aura", "radius": 2.6, "height": 3.2, "life": [8, 12], "velocity": [0.05, 0.03, -0.02], "turbulence": 0.4,
                 "size": [[0, 0], [0.2, 0.24], [0.8, 0.24], [1, 0]], "sizeVar": [0.6, 1.4], "color": "#E2D6B6", "alpha": fade(0.75, 0.3, 0.7),
                 "emissive": 0.5, "texture": "mote", "blend": "add"})]},
        {"$comment": "T0 ambient · RIFT: slow glints on the Fallen Shaft's shallows (ground-level, tiny, never a pool of light)",
         "id": "amb_rift_shallows_glint", "duration": 3, "teamTint": False, "layers": [
             em({"count": 5, "shape": "disc", "radius": 2.6, "life": [2.2, 3.6], "size": [[0, 0], [0.5, 0.42], [1, 0]], "sizeVar": [0.6, 1.2],
                 "rotDeg": [0, 90], "color": "#D2DCD8", "alpha": [[0, 0], [0.5, 0.9], [1, 0]], "emissive": 0.65, "texture": "glint", "blend": "add"})]},
        {"$comment": "T0 ambient · RIFT: midges drifting at the wall feet and the shallows' banks (dark specks, alpha)",
         "id": "amb_rift_shallows_insects", "duration": 4, "teamTint": False, "layers": [
             em({"count": 9, "shape": "sphere", "radius": 0.7, "life": [3, 5], "turbulence": 0.35, "size": 0.1, "sizeVar": [0.8, 1.2],
                 "color": "#2B2924", "alpha": fade(0.85, 0.15, 0.85), "emissive": 0.25, "texture": "mote", "blend": "alpha"})]},
        # ── BRIDGE (Needlespan) ──────────────────────────────────────────────────────────────────────
        {"$comment": "T0 ambient · BRIDGE: chalk dust riding the gorge's warm updraft, far below the deck",
         "id": "amb_bridge_updraft", "duration": 11, "teamTint": False, "layers": [
             em({"count": 10, "shape": "disc", "radius": 7, "life": [9, 13], "velocity": [0.15, 0.7, 0], "turbulence": 0.9,
                 "size": [[0, 0], [0.2, 0.34], [0.8, 0.34], [1, 0]], "sizeVar": [0.6, 1.4], "color": "#C9B9A4", "alpha": fade(0.7),
                 "emissive": 0.45, "texture": "mote", "blend": "add"})]},
        {"$comment": "T0 ambient · BRIDGE: long mist wisps drifting along the drop under the lip",
         "id": "amb_bridge_gorge_wisps", "duration": 14, "teamTint": False, "layers": [
             em({"count": 3, "shape": "line", "length": 22, "radius": 3, "life": [12, 16], "velocity": [0.3, 0.04, 0], "turbulence": 0.5,
                 "size": [[0, 2.2], [1, 3.4]], "rotDeg": [-20, 20], "color": "#7F89A6", "alpha": [[0, 0], [0.35, 0.2], [0.7, 0.16], [1, 0]],
                 "emissive": 0.42, "texture": "wisp", "blend": "alpha"})]},
        {"$comment": "T0 ambient · BRIDGE: a lampresin flame in the terrace lamps by the Dawn Arch and the Lamp Gate (the long evening's warmer cast)",
         "id": "amb_bridge_resin_flame", "duration": 2.6, "teamTint": False, "layers": flame("#E39A68", "#A64E36", "#CB7E54")},
        {"$comment": "T0 ambient · BRIDGE: fine chalk dust lifting off the deck's broken edges (off the road, at the drop)",
         "id": "amb_bridge_chalk_dust", "duration": 8, "teamTint": False, "layers": [
             em({"count": 4, "shape": "line", "length": 6, "radius": 0.5, "life": [6, 9], "velocity": [0, 0.12, 0], "turbulence": 0.35,
                 "size": [[0, 0], [0.25, 0.26], [1, 0.12]], "color": "#CFC8BA", "alpha": [[0, 0], [0.25, 0.6], [1, 0]], "emissive": 0.45,
                 "texture": "mote", "blend": "add"})]},
        # ── FRAY (Noonplate) ─────────────────────────────────────────────────────────────────────────
        {"$comment": "T0 ambient · FRAY: a paper lantern's warm glow at the fair stands (off the plate)",
         "id": "amb_fray_lantern_glow", "duration": 3.2, "teamTint": False, "layers": [
             sprite({"texture": "glow", "size": 0.8, "life": 3.2, "alpha": breathe(0.5, 0.7), "emissive": 0.45, "color": "#D18C6A", "blend": "add"}),
             sprite({"texture": "glow", "size": 0.3, "life": 3.2, "alpha": breathe(0.7, 0.85), "emissive": 0.6, "color": "#E0AA84", "blend": "add"})]},
        {"$comment": "T0 ambient · FRAY: the fair's resin lamps, a flame and a thin smoke curl",
         "id": "amb_fray_lamp_flame", "duration": 2.6, "teamTint": False, "layers": flame("#E0A070", "#A9543A", "#C98457", smoke=True)},
        {"$comment": "T0 ambient · FRAY: paper petals drifting down over the fair stands (linen and rose-lilac, never a seat colour)",
         "id": "amb_fray_petals", "duration": 11, "teamTint": False, "layers": [
             em({"count": 4, "shape": "aura", "radius": 4, "height": 1.2, "life": [9, 13], "velocity": [0.12, -0.22, 0.06], "turbulence": 0.5,
                 "size": 0.16, "sizeVar": [0.8, 1.3], "rotDeg": [0, 360], "spinDeg": [-80, 80], "color": "#B4A388",
                 "alpha": fade(0.9, 0.1, 0.85), "emissive": 0.5, "texture": "petal", "blend": "alpha"}),
             em({"count": 3, "shape": "aura", "radius": 4, "height": 1.2, "life": [9, 13], "velocity": [0.1, -0.2, 0.08], "turbulence": 0.5,
                 "size": 0.14, "sizeVar": [0.8, 1.3], "rotDeg": [0, 360], "spinDeg": [-80, 80], "color": "#8C7484",
                 "alpha": fade(0.9, 0.1, 0.85), "emissive": 0.5, "texture": "petal", "blend": "alpha"})]},
        {"$comment": "T0 ambient · FRAY: the noon glare's haze drifting along the rim, outside the plate",
         "id": "amb_fray_rim_haze", "duration": 12, "teamTint": False, "layers": [
             em({"count": 2, "shape": "aura", "radius": 2.8, "height": 0.6, "life": [10, 14], "velocity": [0.06, 0.03, 0], "turbulence": 0.4,
                 "size": [[0, 1.6], [1, 2.6]], "color": "#D4CEC2", "alpha": [[0, 0], [0.4, 0.1], [0.7, 0.08], [1, 0]], "emissive": 0.5,
                 "texture": "dust_puff", "blend": "alpha"})]},
    ]
    return out
