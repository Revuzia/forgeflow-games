"""VALE VFX authoring kit: composable layer builders for content/vfx.json (CONTRACT §9.5 v2).

Every builder returns a list of layer dicts; a def is `vfx(id, duration, *layer_lists, comment=...)`.
The kit encodes the bible (STYLE_BIBLE "VFX", tokens.json `vfx`) so recipes stay consistent:

  families   LUMEN  additive stored light: glass flares, sun-petals, lamp-fire, glass shards
             SHADE  the stopped shadow: alpha ink smoke and stains, always with a pale (#F4EFE2) rim
  tiers      emissive caps T0-T4 = 0.8 · 2 · 3 · 6 · >=10 (the renderer clamps; recipes aim at the cap)
  impact     flash 0-50 ms (radius by tier) -> mark 50-250 ms -> settle 250-900 ms (L* <= 55)
  grammar    up = help · out / down = harm · side streak = movement · spiral = control
  rules      the danger element is brightest; impacts throw OPAQUE chips; trails <= 0.5 of the head

Colours: "team" (the relationship colour for the viewer: danger edges only), "signature" / "secondary" (the
caster fighter's own hue, r12 M12), "element" (the palette / skin tint), or hex.
"""
from __future__ import annotations

import json
from pathlib import Path

CAP = {0: 0.8, 1: 2.0, 2: 3.0, 3: 6.0, 4: 12.0}     # T1 2.0 since r12 M5 (a basic hit's core must read on pale stone)
FLASH_R = {1: 0.45, 2: 0.75, 3: 1.1, 4: 1.6}   # tokens radiusM x1.5: the glow sprite reads at 82 px/m

# bible palette (hex, sRGB)
CHALK = "#F1E2C6"       # chalk chips, pale stone
CHALK_DK = "#8A8478"
DAWNGLASS = "#BFD3E6"   # cool glass highlight (never white below T4)
NOON = "#F4EFE2"        # Noonwhite: the Shade rim
INK = "#17181B"
INK2 = "#2A2C33"
DUST = "#6E6A62"
DUST2 = "#57544E"
ORCHID = "#D9A7C7"      # magic mark
ROSE = "#E59BB0"
SAP = "#7FD6A0"         # heal (reserved heal hue band 125-150)
EMBER = "#FF9A4A"
WHITE = "#FFFFFF"       # T4 cores only


def L(type_: str, **kw) -> dict:
    d = {"type": type_}
    for k, v in kw.items():
        if v is None:
            continue
        d[k] = v
    return d


# ── light ────────────────────────────────────────────────────────────────────────────────────────
def flash(tier: int, at: str = "target", color: str = "team", core: bool | None = None, scale: float = 1.0, delay: float = 0.0, light: bool = True,
          life: float | None = None) -> list:
    """The impact flash (0-50 ms): a glow sprite, a white core on T4, a pooled light."""
    r = FLASH_R.get(tier, 0.5) * scale
    return [L("flash", at=at, radius=round(r, 3), life=life or (0.06 if tier >= 3 else 0.05), color=color, intensity=CAP[tier],
              core=WHITE if (core if core is not None else tier >= 4) else None, light=None if light else False, delay=delay or None)]


def glow(at: str, color: str, size: float, life: float, emissive: float, alpha=(0, 1, 0.6, 0), delay: float = 0.0, follow: bool | None = None,
         socket: str | None = None, offset=None, texture: str = "glow", soft: float = 0.25) -> list:
    """A held glow sprite (charging cores, weapon flares, zone hearts)."""
    return [L("sprite", at=at, socket=socket, offset=offset, follow=follow, texture=texture, size=[size, size * 1.08], color=color,
              emissive=emissive, alpha=list(alpha), life=life, delay=delay or None, soft=soft)]


def light(at: str, color: str, intensity: float, radius: float, life: float, attack: float = 0.0, flicker: float = 0.0, delay: float = 0.0) -> list:
    return [L("light", at=at, color=color, intensity=intensity, radius=radius, life=life, attack=attack or None, flicker=flicker or None, delay=delay or None)]


# ── particles ────────────────────────────────────────────────────────────────────────────────────
def sparks(at: str, n: int, color="team", speed=(4, 9), life=(0.12, 0.28), size=0.16, spread=150, dir_: str = "up", emissive: float = 3.0,
           gravity: float = 9.0, drag: float = 2.5, delay: float = 0.0, stretch: float = 0.035, shape: str | None = None, radius: float | None = None,
           tex: str = "spark", secondary: bool | None = None) -> list:
    """Velocity-stretched light streaks (additive)."""
    return [L("emitter", at=at, count=n, shape=shape, radius=radius, dir=dir_, spreadDeg=spread, speed=list(speed), life=list(life),
              size=[size, size * 0.4], color=color if isinstance(color, (str, list)) else color, alpha=[1, 0.8, 0], emissive=emissive,
              gravity=gravity, drag=drag, texture=tex, stretch=stretch, blend="add", delay=delay or None, secondary=secondary)]


def chips(at: str, n: int, color=(CHALK, CHALK_DK), speed=(3, 7), life=(0.35, 0.6), size=0.17, spread=160, gravity: float = 14.0,
          delay: float = 0.03, tex: str = "chip", rim: str | None = NOON) -> list:
    """OPAQUE impact chips (the bible: impacts throw opaque chips), bouncing on the ground."""
    return [L("emitter", at=at, count=n, dir="up", spreadDeg=spread, speed=list(speed), life=list(life), size=[size, size, size * 0.6],
              sizeVar=[0.6, 1.3], color=list(color), alpha=[1, 1, 1, 0], gravity=gravity, drag=0.8, bounce=0.35, texture=tex, blend="chip",
              spinDeg=[-540, 540], rim=rim, rimAlpha=0.5 if rim else None, delay=delay or None, secondary=True)]


def motes(at: str, n: int, color="team", rise: float = 1.4, life=(0.6, 1.1), size=0.2, radius: float = 0.6, emissive: float = 2.0,
          delay: float = 0.0, rate: float | None = None, duration: float | None = None, shape: str = "disc", orbit: float = 0.0,
          turbulence: float = 0.8, tex: str = "mote") -> list:
    """Drifting motes of light (help rises: positive rise; harm settles)."""
    return [L("emitter", at=at, count=n if not rate else None, rate=rate, duration=duration, shape=shape, radius=radius, dir="up", spreadDeg=25,
              speed=[rise * 0.5, rise], life=list(life), size=[0, size, size * 0.8, 0], color=color, alpha=[0, 1, 0.8, 0], emissive=emissive,
              gravity=-0.2 if rise > 0 else 0.5, drag=1.2, turbulence=turbulence, orbitDeg=orbit or None, texture=tex, blend="add",
              delay=delay or None, secondary=True)]


def petals(at: str, n: int, color=(ORCHID, ROSE), speed=(1.5, 3.5), life=(0.45, 0.8), size=0.26, emissive: float = 1.6, delay: float = 0.02,
           dir_: str = "out", gravity: float = 1.2) -> list:
    """Sun-petals of light (the magic mark: orchid-rose)."""
    return [L("emitter", at=at, count=n, shape="sphere", radius=0.15, dir=dir_, spreadDeg=40, speed=list(speed), life=list(life),
              size=[size * 0.6, size, 0], color=list(color), alpha=[1, 0.9, 0], emissive=emissive, gravity=gravity, drag=2.2,
              spinDeg=[-360, 360], texture="petal", blend="add", align="velocity", delay=delay or None, secondary=True)]


def shards(at: str, n: int, color=(DAWNGLASS, "team"), speed=(5, 10), life=(0.3, 0.55), size=0.3, spread=170, emissive: float = 2.2,
           delay: float = 0.0, dir_: str = "out", gravity: float = 6.0, shape: str = "sphere") -> list:
    """Glass shards (Lumen): additive, velocity-aligned, glinting."""
    return [L("emitter", at=at, count=n, shape=shape, radius=0.2, dir=dir_, spreadDeg=spread, speed=list(speed), life=list(life),
              size=[size, size * 0.8, 0], sizeVar=[0.6, 1.4], color=list(color), alpha=[1, 1, 0], emissive=emissive, gravity=gravity, drag=1.8,
              texture="shard", blend="add", align="velocity", aspect=0.45, delay=delay or None)]


def ink(at: str, n: int, size=1.1, speed=(1.2, 3.0), life=(0.5, 0.9), rim: str = NOON, color=(INK, INK2), dir_: str = "out", delay: float = 0.0,
        radius: float = 0.3, shape: str = "sphere", gravity: float = -0.3, rate: float | None = None, duration: float | None = None,
        rim_alpha: float = 0.6) -> list:
    """Shade ink billows: alpha ink flipbook with a pale rim (the bible's 1 px Noonwhite rim)."""
    return [L("emitter", at=at, count=n if not rate else None, rate=rate, duration=duration, shape=shape, radius=radius, dir=dir_, spreadDeg=60,
              speed=list(speed), life=list(life), size=[size * 0.45, size, size * 1.2], sizeVar=[0.8, 1.25], color=list(color),
              alpha=[0, 0.9, 0.75, 0], gravity=gravity, drag=2.6, turbulence=0.6, rotDeg=[0, 360], spinDeg=[-40, 40], texture="ink_puff",
              blend="ink", rim=rim, rimAlpha=rim_alpha, soft=0.3, delay=delay or None)]


def dust(at: str, n: int, size=0.9, speed=(0.8, 2.2), life=(0.5, 0.9), color=(DUST, DUST2), delay: float = 0.08, radius: float = 0.35,
         shape: str = "ring", dir_: str = "out", alpha: float = 0.45) -> list:
    """Settling dust (the 250-900 ms settle: L* <= 55, no reserved hues)."""
    return [L("emitter", at=at, count=n, shape=shape, radius=radius, dir=dir_, spreadDeg=35, speed=list(speed), life=list(life),
              size=[size * 0.5, size, size * 1.25], color=list(color), alpha=[0, alpha, alpha * 0.6, 0], gravity=-0.25, drag=2.8,
              turbulence=0.3, rotDeg=[0, 360], spinDeg=[-30, 30], texture="dust_puff", blend="alpha", soft=0.3, delay=delay or None,
              secondary=True)]


def streaks(at: str, n: int, color="team", speed=(6, 12), life=(0.08, 0.16), size=0.4, spread=40, dir_: str = "forward", emissive: float = 2.5,
            delay: float = 0.0) -> list:
    """Side streaks (movement grammar)."""
    return [L("emitter", at=at, count=n, dir=dir_, spreadDeg=spread, speed=list(speed), life=list(life), size=[size, size * 0.3],
              color=color, alpha=[0.9, 0], emissive=emissive, drag=3.0, texture="streak", stretch=0.05, blend="add", delay=delay or None)]


# ── shapes ───────────────────────────────────────────────────────────────────────────────────────
def shockwave(at: str = "ground", color="team", radius=(0.3, 1.0), width=(0.25, 0.08), life: float = 0.35, emissive: float = 2.5,
              alpha=(1, 0.8, 0), sharp: float = 1.6, noise: float = 0.35, inner: float = 0.0, delay: float = 0.0, vertical: bool = False,
              fit: bool | None = None, blend: str = "add") -> list:
    """Expanding ring with the brightest (danger) leading edge."""
    rad = [[0, radius[0]], [0.35, radius[0] + (radius[1] - radius[0]) * 0.75], [1, radius[1]]]
    return [L("shockwave", at=at, radius=rad, width=list(width), life=life, color=color, alpha=list(alpha), emissive=emissive, sharp=sharp,
              noise=noise, inner=inner or None, delay=delay or None, mode="vertical" if vertical else None, fit=fit, blend=blend)]


def decal(at: str, style: str, radius, life: float, color="team", alpha=(0.6, 0.6, 0), emissive=None, shape: str = "circle", rim=None,
          texture: str | None = None, delay: float = 0.0, angle: float | None = None, length: float | None = None, width: float | None = None,
          fit: bool | None = None) -> list:
    return [L("decal", at=at, shape=shape, style=style, radius=radius, life=life, color=color, alpha=list(alpha), emissive=emissive, rim=rim,
              texture=texture, delay=delay or None, angleDeg=angle, length=length, width=width, fit=fit)]


def mesh(at: str, shape: str, scale, life: float, color="team", alpha=(1, 0), emissive=2.0, rim=None, rim_pow: float | None = None,
         rim_emissive: float | None = None, noise: float | None = None, noise_scale: float | None = None, scroll=None, dissolve=None,
         edge=None, edge_width: float | None = None, edge_emissive: float | None = None, mask: str | None = None, mask_param=None,
         blend: str = "add", spin: float | None = None, rotate=None, align: str | None = None, wobble: float | None = None,
         twist: float | None = None, angle: float | None = None, stretch=None, hold: float | None = None, delay: float = 0.0,
         follow: bool | None = None, fit: bool | None = None, offset=None, socket: str | None = None) -> list:
    """An FX mesh shell (orb, dome, pillar, blade, crescent, fan …) with rim, noise, dissolve and masks."""
    return [L("mesh", at=at, shape=shape, scale=scale, stretch=stretch, life=life, color=color, alpha=list(alpha) if isinstance(alpha, tuple) else alpha,
              emissive=emissive, rim=rim, rimPow=rim_pow, rimEmissive=rim_emissive, noise=noise, noiseScale=noise_scale, scroll=scroll,
              dissolve=dissolve, edge=edge, edgeWidth=edge_width, edgeEmissive=edge_emissive, mask=mask, maskParam=mask_param, blend=blend,
              spinDeg=spin, rotateDeg=rotate, align=align, wobble=wobble, twist=twist, angleDeg=angle, hold=hold, delay=delay or None,
              follow=follow, fit=fit, offset=offset, socket=socket)]


def ribbon(at: str = "path", color="team", width=(0.0, 0.32), life: float = 0.2, alpha=(0, 0.55), emissive: float = 2.0, noise: float = 0.35,
           blend: str = "add", rim=None, face: str | None = None, delay: float = 0.0, socket: str | None = None, scroll: float = 2.0) -> list:
    """A trail that follows the anchor; width/alpha run tail -> head (trail <= 0.5 of the head)."""
    return [L("ribbon", at=at, color=color, width=list(width), life=life, alpha=list(alpha), emissive=emissive, noise=noise, blend=blend, rim=rim,
              rimAlpha=0.6 if rim else None, face=face, delay=delay or None, socket=socket, scroll=scroll)]


def beam(color="team", width: float = 0.35, life: float = 0.25, emissive: float = 3.0, noise: float = 0.12, core: float = 1.6, frm: str = "origin",
         to: str = "target", delay: float = 0.0, alpha=(1, 1, 0)) -> list:
    return [L("beam", color=color, width=width, life=life, emissive=emissive, noise=noise, core=core, **{"from": frm}, to=to, alpha=list(alpha),
              delay=delay or None)]


def shake(amount: float, who: str = "self", delay: float = 0.0) -> list:
    """m4 (r12): no ability shakes the camera; impact is sold by flash, the exposure envelope, particles and ground
    marks. Kept so recipes read as authored; it adds nothing (world events shake from the director)."""
    return []


# ── composite recipes ────────────────────────────────────────────────────────────────────────────
def impact(tier: int, kind: str, at: str = "target", scale: float = 1.0) -> list:
    """The bible impact: flash (0-50 ms) -> mark (50-250 ms, by damage type) -> settle (250-900 ms). Every
    impact carries a team-coloured read (the relationship cue) besides its damage-type mark."""
    s = scale
    out = flash(tier, at=at, scale=s)
    n = {1: 6, 2: 11, 3: 15, 4: 20}[tier]
    e = CAP[tier]
    hot = [WHITE, "team"] if tier >= 4 else [DAWNGLASS, "team"]
    if kind == "physical":
        # a quick slash smear across the target (camera-facing crescent, sweep mask: the leading edge is brightest)
        out += mesh(at, "crescent", [[0, 0.45 * s], [0.35, 1.1 * s], [1, 1.2 * s]], 0.13 if tier <= 1 else 0.16, color=hot, alpha=(1, 0.9, 0),
                    emissive=e, mask="sweep", mask_param=[0, 1.05], align="camera", rotate=[0, 0, 25], stretch=[1.0, 0.55, 1.0])
        out += sparks(at, max(4, n // 2), color="team", speed=(5 * s, 10 * s), life=(0.08, 0.18), emissive=min(e, 2.6), gravity=6)
        out += chips(at, n, speed=(2.5 * s, 6 * s))
    elif kind == "magic":
        out += mesh(at, "orb", [[0, 0.25 * s], [0.4, 0.95 * s], [1, 1.1 * s]], 0.2, color=[ORCHID, ROSE], alpha=(0.85, 0), emissive=min(e, 2.6),
                    rim=ROSE, rim_pow=1.6, rim_emissive=min(e, 2.4), noise=0.6, dissolve=[0, 0.25, 1], edge="team", edge_emissive=min(e, 2.6))
        out += shockwave(at, color=ROSE, radius=(0.2 * s, 1.1 * s), width=(0.22, 0.04), life=0.24, emissive=min(e, 2.4), vertical=True, noise=0.2)
        out += petals(at, n, size=0.24 * s)
        out += sparks(at, max(3, n // 3), color="team", speed=(3, 6), life=(0.1, 0.2), emissive=min(e, 2.2), gravity=2)
    elif kind == "true":
        out += shockwave(at, color=NOON, radius=(0.25 * s, 1.15 * s), width=(0.3, 0.05), life=0.26, emissive=min(e, 2.4), vertical=True, sharp=2.0)
        out += mesh(at, "orb", [[0, 0.3 * s], [1, 0.8 * s]], 0.18, color=INK, alpha=(0.9, 0), emissive=0, rim=NOON, rim_pow=1.2,
                    rim_emissive=min(e, 2.4), blend="ink", noise=0.7, dissolve=[0, 0.2, 1], edge=NOON)
        out += [L("emitter", at=at, count=max(5, n // 2), shape="sphere", radius=0.1, dir="out", spreadDeg=180, speed=[2.5, 5], life=[0.25, 0.45],
                 size=[0.16 * s, 0.1 * s], color=[INK, INK2], alpha=[1, 1, 0], gravity=9, drag=1.0, texture="drop", blend="ink", rim=NOON, rimAlpha=0.7)]
    if tier >= 2:
        out += dust(at, 3 if tier == 2 else 5, size=0.8 * s, radius=0.2)
    return out


def vfx(id_: str, duration: float, *layer_lists, comment: str = "", team_tint: bool = True) -> dict:
    layers = []
    for ll in layer_lists:            # a builder's list, or one bare layer dict
        layers += [ll] if isinstance(ll, dict) else list(ll)
    bad = [x for x in layers if not isinstance(x, dict)]
    if bad:
        raise SystemExit(f"{id_}: layer lists must hold dicts, got {bad[:3]}")
    d = {"$comment": comment, "id": id_, "duration": duration, "teamTint": team_tint, "layers": layers}
    if not comment:
        del d["$comment"]
    return d


def write(defs: list, path: Path) -> None:
    ids = [d["id"] for d in defs]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"duplicate vfx ids: {sorted(dup)}")
    path.write_text(json.dumps(defs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
