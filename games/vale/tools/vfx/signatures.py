"""VALE fighter VFX signatures (r12 M12): every fighter owns a hue, so a kit is known by its light.

The hue is the fighter's, taken from VALE's own world and the kit (never from another game's characters):
the colour of what the fighter works with. Team identity stays in the danger edges (shockwave rims, ground
rings, mesh rims, telegraphs); everything else a kit emits is drawn in its signature.

Rules (tokens.json `vfx.signature`, checked by tools/build_content.ts):
  - HSV saturation >= 0.55, value 0.70-0.95
  - hue outside tokens vfx.reservedHuesHSV (ally 200-225, harm 28-50, heal 125-150, tritan rose 340-350); the
    blue-violet and jade families sit >= 11 deg clear of the ally and heal bands (r12 review: Dunsom's 231 deg
    indigo read as azure next to the ally colour, Marund's jade sat 7 deg from the heal band), so the
    indigo-garnet arc is spaced 240.5 / 266 / 291.5 / 317 / 335 and jade-aqua 161.5 / 188
  - no two fighters within 25 deg of hue unless their L* differs by >= 25 (dark / light pairs share a hue
    family: Dunsom's dusk indigo and Ardit's dawnglass periwinkle are one hue at two values). Sixteen fit the
    free hue arcs only this way: red 2, yellow-green 4, jade-aqua 2, indigo-garnet 8.
`secondary` is the companion: the same hue at the opposite value (a pale highlight for a dark signature, a
deep body for a light one), used for tails, rims and secondary particles.

Written into content/fighters/<id>.json `vfx` by tools/vfx/kit_present.py; read by the renderer from there.
"""
from __future__ import annotations

import colorsys

# fighter: (signature hex, name, the thing in the kit it comes from)
SIGNATURES: dict[str, tuple[str, str, str]] = {
    "burdam":  ("#B30300", "grudge crimson", "the tally he keeps of every blow, cut in red"),
    "kemdo":   ("#F2896C", "burning-glass coral", "the hot spot her lens throws"),
    "odrum":   ("#B3A400", "resin gold", "Serenade lampresin poured thick and set"),
    "sukri":   ("#F2F06C", "noon lemon", "the noon light he carries in his cup"),
    "ilsheta": ("#74B300", "lamp chartreuse", "the green-gold flame of a hung healing lamp"),
    "ulkro":   ("#5BD13B", "grove lime", "the fresh-cut grove a dart hunter runs through"),
    "marund":  ("#08B47F", "dome jade", "the glaze on a finished Lamp Dome course"),
    "lisvel":  ("#6BE0F2", "morning aqua", "Aubade's cool morning glass"),
    "dunsom":  ("#0200D2", "dusk indigo", "the last of the evening he herds"),
    "ardit":   ("#6D6CF2", "dawnglass periwinkle", "a tilted pane of dawnglass"),
    "hesmi":   ("#5C0EC2", "unlit violet", "the shadow under the fallen needle"),
    "vashil":  ("#A66CF2", "chime lavender", "the ring of a struck glass bell"),
    "tunlan":  ("#9A00B4", "puppet plum", "a lamp-shadow thrown on a dusk wall"),
    "ervet":   ("#DF6CF2", "glass-blade orchid", "the edge of her blade as it shatters"),
    "nurrow":  ("#F26CCC", "lullaby pink", "the hush she sings over a fight"),
    "rishal":  ("#B3004A", "heat garnet", "glass drawn red-hot into lines"),
}

RESERVED = {"ally": (200, 225), "harm": (28, 50), "heal": (125, 150), "tritanAltRose": (340, 350)}


def _rgb(hx: str) -> tuple[float, float, float]:
    return int(hx[1:3], 16) / 255, int(hx[3:5], 16) / 255, int(hx[5:7], 16) / 255


def _hex(r: float, g: float, b: float) -> str:
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


def lstar(hx: str) -> float:
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in _rgb(hx)]
    y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    return 116 * y ** (1 / 3) - 16 if y > 0.008856 else 903.3 * y


def hsv(hx: str) -> tuple[float, float, float]:
    h, s, v = colorsys.rgb_to_hsv(*_rgb(hx))
    return h * 360, s, v


def secondary(hx: str) -> str:
    """the companion: same hue, opposite value (pale for a dark signature, deep for a light one)"""
    h, s, v = hsv(hx)
    if lstar(hx) < 50:
        return _hex(*colorsys.hsv_to_rgb(h / 360, 0.32, 0.98))
    return _hex(*colorsys.hsv_to_rgb(h / 360, min(1.0, s + 0.3), 0.52))


def pairs() -> dict[str, dict[str, str]]:
    return {f: {"signature": sig, "secondary": secondary(sig)} for f, (sig, _, _) in SIGNATURES.items()}


def check() -> list[str]:
    errs = []
    items = list(SIGNATURES.items())
    for f, (sig, _, _) in items:
        h, s, v = hsv(sig)
        if s < 0.55 or not (0.7 - 1e-3 <= v <= 0.95 + 1e-3):
            errs.append(f"{f}: {sig} S {s:.2f} V {v:.2f} (needs S >= 0.55, V 0.70-0.95)")
        for k, (a, b) in RESERVED.items():
            if a <= h <= b:
                errs.append(f"{f}: {sig} hue {h:.0f} is in the reserved {k} band {a}-{b}")
    for i, (a, (sa, _, _)) in enumerate(items):
        for b, (sb, _, _) in items[i + 1:]:
            d = abs(hsv(sa)[0] - hsv(sb)[0])
            d = min(d, 360 - d)
            if d < 25 and abs(lstar(sa) - lstar(sb)) < 25:
                errs.append(f"{a} {sa} / {b} {sb}: {d:.0f} deg apart and only {abs(lstar(sa) - lstar(sb)):.1f} L* apart")
    return errs


if __name__ == "__main__":
    for f, (sig, name, why) in SIGNATURES.items():
        h, s, v = hsv(sig)
        print(f"{f:8s} {sig} {secondary(sig)}  h{h:5.1f} s{s:.2f} v{v:.2f} L*{lstar(sig):5.1f}  {name}: {why}")
    e = check()
    print("\n".join(e) if e else "signatures OK")
