"""Lisvel (Slinger, morning archer): bespoke ability VFX.

Identity: lines of morning light. Long, straight, horizontal: arrows that leave a lit line, lanes
of light that flow in the shot's direction (side streaks = movement), glass bow-tips that glint,
a few gull feathers. Lumen only, low-slanted warm-pale light with the team colour on every edge.
"""
from __future__ import annotations

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, INK2, NOON, L, chips, decal, dust, flash, glow, light, mesh, motes, ribbon,
                    shake, shockwave, sparks, streaks, vfx)

MORNING = "#F4E9D2"     # low morning light, pale and warm
FEATHER = "#D9D4CA"     # gull feather (opaque)
FEATHER_DK = "#A8A296"
WHITE_T = "#FFFFFF"     # T4 only (Dawnglass below T4)


def xfade(peak: float, life: float, dur: float) -> list:
    """alpha keys for a zone loop: the old copy fades out exactly while the next one fades in."""
    o = max(0.02, (life - dur) / life)
    return [[0, 0], [o, peak], [1 - o, peak], [1, 0]]


def shifted(layers: list, offset: list) -> list:
    """the same layers moved by an offset [forward, up, right] in the facing frame"""
    return [dict(x, offset=offset) for x in layers]


def feathers(at: str, n: int, speed=(1.5, 3.5), dir_: str = "out", delay: float = 0.0, offset=None) -> list:
    """gull feathers: opaque pale vanes that flutter and drift down"""
    return [L("emitter", at=at, count=n, offset=offset, shape="sphere", radius=0.2, dir=dir_, spreadDeg=70, speed=list(speed),
              life=[0.5, 0.85], size=[0.2, 0.18, 0.12], sizeVar=[0.7, 1.3], color=[FEATHER, FEATHER_DK], alpha=[1, 1, 0], gravity=1.6,
              drag=3.0, turbulence=1.2, rotDeg=[0, 360], spinDeg=[-300, 300], texture="petal", blend="alpha", rim="team", rimAlpha=0.5,
              delay=delay or None, secondary=True)]


def keyline(at: str, length: float, life: float, alpha, e: float, offset: list, width: float = 0.07, color="team") -> list:
    """a thin straight line of light lying on the ground along the facing (a flattened glass sliver; decal lines
    cannot be thinner than 5 % of their length)"""
    return mesh(at, "shard", 1.0, life, color=color, alpha=alpha, emissive=e, mask="ends", mask_param=0.08, noise=0.2,
                stretch=[round(width / 0.32, 3), 0.15, length], offset=offset, fit=False)


def defs() -> list:
    D = []

    # ── passive · Reach of Morning (a stack: +0.4 m attack range; T1) ─────────────────────────────
    D.append(vfx("lisvel_passive_reach", 0.5,
                 L("emitter", at="target", count=5, offset=[0.3, 0.1, 0], shape="line", length=0.2, width=0.5, dir="forward", spreadDeg=4,
                   speed=[6, 9], life=[0.1, 0.18], size=[0.5, 0.08], color=[MORNING, "team"], alpha=[1, 0], emissive=1.5, drag=2,
                   texture="streak", stretch=0.06, blend="add"),
                 [L("sprite", at="target", texture="glint", size=[0.5, 0.5], color=[MORNING, "team"], emissive=1.5, alpha=[0, 1, 0], life=0.3,
                    offset=[0.35, 0.15, side], spinDeg=[200, 200], soft=0.05) for side in (-0.85, 0.85)],
                 comment="T1 · Lumen · Reach of Morning: both glass bow-tips glint and a few lines of light run forward from the bow"
                         " (her reach grows)"))

    # ── a1 · Dawn Line: the arrow (projectile 28 m/s, 10 m, pierces; T2) ──────────────────────────
    D.append(vfx("lisvel_a1_arrow", 0.6,
                 flash(2, at="origin", color=MORNING, scale=0.7),
                 L("emitter", at="origin", count=6, offset=[0.3, 0, 0], dir="forward", spreadDeg=8, speed=[8, 12], life=[0.08, 0.14],
                   size=[0.6, 0.1], color=[MORNING, "team"], alpha=[1, 0], emissive=3.0, drag=2, texture="streak", stretch=0.06, blend="add"),
                 # the shaft: a chalk-pale arrow of light with a glinting glass tip
                 mesh("path", "spike", 0.7, 0.6, color=[MORNING, DAWNGLASS], alpha=1, emissive=2.6, rim="team", rim_pow=1.4, rim_emissive=3.0,
                      align="velocity", stretch=[0.22, 0.22, 2.2], hold=1),
                 [L("sprite", at="path", follow=True, texture="glint", size=[0.7, 0.7], color=[DAWNGLASS, "team"], emissive=3.0, alpha=[1, 1, 0.8],
                    life=0.6, spinDeg=[300, 300], soft=0.05)],
                 # the line it leaves: a long ribbon that holds (the lane the zone keeps lit)
                 ribbon("path", "team", width=(0.0, 0.3), life=0.55, alpha=(0.15, 0.6), emissive=2.6, noise=0.15, scroll=3.0),
                 ribbon("path", MORNING, width=(0.0, 0.1), life=0.4, alpha=(0.1, 0.9), emissive=3.0, noise=0.05),
                 L("emitter", at="path", rate=9, shape="sphere", radius=0.1, dir="back", spreadDeg=60, speed=[0.2, 0.6], life=[0.45, 0.7],
                   size=[0.14, 0.12, 0.08], sizeVar=[0.7, 1.3], color=[FEATHER, FEATHER_DK], alpha=[1, 1, 0], gravity=1.4, drag=3.0,
                   turbulence=1.2, rotDeg=[0, 360], spinDeg=[-300, 300], texture="petal", blend="alpha", rim="team", rimAlpha=0.5,
                   secondary=True),
                 comment="T2 · Lumen · Dawn Line arrow: a bow-flash, a pale shaft of light with a glinting glass tip, a long team line held"
                         " behind it, a few gull feathers shed"))

    # ── a1 · Dawn Line: the lit line (zone rect 10 x 1.2 from her, 3 s; loops 1 s; T3) ───────────
    LIFE, DUR = 1.12, 1.0
    D.append(vfx("lisvel_a1_line", DUR,
                 shifted(decal("ground", "light", 5.0, LIFE, shape="rect", width=1.2, color=MORNING, alpha=xfade(0.5, LIFE, DUR), emissive=1.1,
                               texture="glow", fit=False), [5.0, 0, 0]),
                 sum([keyline("ground", 10.0, LIFE, xfade(0.9, LIFE, DUR), 2.6, [5.0, 0.03, side]) for side in (0.6, -0.6)], []),
                 keyline("ground", 10.0, LIFE, xfade(0.5, LIFE, DUR), 1.8, [5.0, 0.03, 0], width=0.05, color=MORNING),
                 # light flowing along the lane in the shot's direction (side streaks: allies run faster on it)
                 L("emitter", at="ground", rate=40, shape="line", length=9.6, width=1.0, offset=[0, 0.12, 0], dir="forward", spreadDeg=2,
                   speed=[4, 7], life=[0.3, 0.6], size=[0.9, 0.16], color=[MORNING, "team"], alpha=[0, 1, 0], emissive=2.8, drag=0.3,
                   texture="streak", stretch=0.08, blend="add", align="velocity", fit=False),
                 L("emitter", at="ground", rate=8, shape="line", length=9.6, width=1.0, offset=[0, 0.1, 0], dir="up", spreadDeg=10,
                   speed=[0.3, 0.6], life=[0.6, 1.0], size=[0, 0.12, 0], color=[MORNING, "team"], alpha=[0, 0.8, 0], emissive=2.0,
                   texture="mote", blend="add", fit=False, secondary=True),
                 comment="T3 · Lumen · Dawn Line lane (loop): a 10 m strip of slanting morning light between two team keylines, light flowing"
                         " along it in the shot's direction (movement), a few motes"))

    # ── a2 · Backstep (dash 3 m away at 16 m/s; T3) ─────────────────────────────────────────────
    D.append(vfx("lisvel_a2_backstep", 0.6,
                 feathers("origin", 9, speed=(1.5, 3.2), dir_="out"),
                 flash(2, at="origin", color=MORNING, scale=0.6, light=False),
                 shockwave("origin", color="team", radius=(0.2, 0.75), width=(0.12, 0.03), life=0.25, emissive=2.6),
                 ribbon("path", "team", width=(0.0, 0.7), life=0.3, alpha=(0, 0.55), emissive=3.0, noise=0.3, face="ground"),
                 ribbon("path", MORNING, width=(0.0, 0.22), life=0.2, alpha=(0, 0.8), emissive=3.0, noise=0.1),
                 L("emitter", at="path", rate=40, shape="disc", radius=0.4, dir="back", spreadDeg=12, speed=[4, 7], life=[0.08, 0.15],
                   size=[0.5, 0.1], color=[MORNING, "team"], alpha=[0.9, 0], emissive=2.8, drag=3, texture="streak", stretch=0.06, blend="add"),
                 # the next shot is primed: the glass tips glint as she lands
                 [L("sprite", at="path", follow=True, texture="glint", size=[0.6, 0.6], color=[DAWNGLASS, "team"], emissive=3.0, alpha=[0, 0, 1, 0],
                    life=0.5, offset=[0.25, 0.2, side], spinDeg=[260, 260], soft=0.05) for side in (-0.85, 0.85)],
                 comment="T3 · Lumen · Backstep: a puff of gull feathers where she stood, a short team side-streak hop, both glass bow-tips"
                         " glint as she lands (the next shot reaches farther)"))

    # ── a3 · Morning Draw (self buff, +40% attack speed for 4 s; cast; T2) ────────────────────────
    D.append(vfx("lisvel_a3_draw", 0.8,
                 # the bow drawn level: a flat arc of light snaps across her body at bow height
                 mesh("origin", "shard", [[0, 0.6], [0.25, 1.0], [1, 1.0]], 0.32, color=[MORNING, "team"], alpha=(1, 0.8, 0), emissive=3.0,
                      mask="ends", mask_param=0.15, stretch=[0.35, 0.35, 2.0], rotate=[0, 90, 0], offset=[0.3, 0.1, 0], fit=False),
                 [L("sprite", at="origin", texture="flare", size=[0.9, 0.8], color=[DAWNGLASS, "team"], emissive=3.0, alpha=[0, 1, 0], life=0.3,
                    offset=[0.35, 0.1, side], spinDeg=[220, 220], soft=0.05) for side in (-0.9, 0.9)],
                 # quickening rings climb her (help is up): three in a quick tempo
                 [mesh("origin", "ringwave", [[0, 1.3], [1, 1.75]], 0.34, color="team", alpha=(1, 0), emissive=2.8, align="up", mask="edge",
                       mask_param=0.97, offset=[0, -1.0 + 0.55 * i, 0], delay=0.06 * i, fit=False)[0] for i in range(3)],
                 motes("origin", 10, color=[MORNING, "team"], rise=2.8, life=(0.35, 0.6), size=0.15, radius=0.45, emissive=2.6, delay=0.05),
                 L("emitter", at="origin", count=8, offset=[0.25, 0.1, 0], shape="line", length=0.1, width=1.7, dir="up", spreadDeg=15,
                   speed=[1.5, 3], life=[0.2, 0.35], size=[0.12, 0.03], color="team", alpha=[1, 0], emissive=2.6, drag=1.5, texture="spark",
                   stretch=0.03, blend="add", delay=0.08),
                 comment="T2 · Lumen · Morning Draw: the level longbow lights end to end, both glass tips flare, three rings climb her"
                         " in a quick tempo with motes (help is up)"))

    # ── ult · Sun Corridor (area rect 14 x 3, lands after 0.75 s, anchored on its centre; T4) ─────
    D.append(vfx("lisvel_ult_corridor", 1.6,
                 flash(4, at="ground", color=MORNING, scale=0.55),
                 # sunlight pours down along the whole shaft
                 L("emitter", at="ground", count=34, shape="line", length=14, width=2.8, offset=[-7, 5.5, 0], dir="down", spreadDeg=3,
                   speed=[16, 22], life=[0.22, 0.3], size=[0.9, 0.12], color=[WHITE_T, "team"], alpha=[0.8, 0.5], emissive=6, texture="streak",
                   stretch=0.05, blend="add", align="velocity", fit=False),
                 # a curtain of light stands round the corridor (team edges brightest), then thins
                 mesh("ground", "wall", 1.0, 0.75, color="team", alpha=[[0, 0.3], [0.3, 0.15], [1, 0]], emissive=3, rim=MORNING, rim_pow=2.0,
                      rim_emissive=4, mask="top", mask_param=[[0, 0.4], [1, 0.95]], noise=0.6, scroll=[0, 2.2], stretch=[3.0, 1.8, 14.0], fit=False),
                 decal("ground", "light", 7.0, 1.5, shape="rect", width=3.0, color=MORNING, alpha=(0.55, 0.3, 0), emissive=1.8, texture="glow",
                       fit=False),
                 sum([keyline("ground", 14.0, 1.5, [[0, 1], [0.5, 0.8], [1, 0]], 6, [0, 0.03, side], width=0.12) for side in (1.5, -1.5)], []),
                 decal("ground", "scorch", 7.0, 1.6, shape="rect", width=2.2, color=INK2, alpha=(0.55, 0.4, 0), emissive=2, rim=MORNING,
                       texture="scorch", delay=0.05, fit=False),
                 # the landing kicks dust and chips along its whole length
                 L("emitter", at="ground", count=22, delay=0.05, shape="line", length=13.5, width=2.8, offset=[-6.75, 0.05, 0], dir="up",
                   spreadDeg=50, speed=[2.5, 5], life=[0.4, 0.65], size=[0.15, 0.15, 0.09], sizeVar=[0.6, 1.3], color=[CHALK, CHALK_DK],
                   alpha=[1, 1, 1, 0], gravity=13, drag=0.8, bounce=0.35, texture="chip", blend="chip", spinDeg=[-540, 540], rim=NOON,
                   rimAlpha=0.5, fit=False, secondary=True),
                 L("emitter", at="ground", count=14, delay=0.1, shape="line", length=13.5, width=3.2, offset=[-6.75, 0.05, 0], dir="out",
                   spreadDeg=35, speed=[0.8, 1.8], life=[0.6, 1.0], size=[0.6, 1.2, 1.5], color=[DUST, DUST2], alpha=[0, 0.4, 0.25, 0],
                   gravity=-0.2, drag=2.6, rotDeg=[0, 360], spinDeg=[-30, 30], texture="dust_puff", blend="alpha", soft=0.3, fit=False,
                   secondary=True),
                 L("emitter", at="ground", count=30, delay=0.15, shape="line", length=13.5, width=2.6, offset=[-6.75, 0.1, 0], dir="up",
                   spreadDeg=12, speed=[0.6, 1.4], life=[0.7, 1.2], size=[0, 0.16, 0], color=[MORNING, "team"], alpha=[0, 1, 0], emissive=3,
                   texture="mote", blend="add", fit=False, secondary=True),
                 light("ground", MORNING, 24, 12, 0.6),
                 shake(0.5),
                 comment="T4 · Lumen · Sun Corridor lands: white core flash, sunlight pours straight down the 14 x 3 m shaft, a curtain of"
                         " light stands round it with team edges brightest, a lit floor with team keylines, a burned strip, chips and dust"
                         " along its length, motes"))
    return D
