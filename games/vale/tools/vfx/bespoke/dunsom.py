"""Dunsom (Caster · Serenade · the dusk herder with the crook and lantern): bespoke VFX.

Identity: Shade with a dusk-lavender haze. He moves people: everything he does is a hook, a sweep or a herd.
Shape language is curves and spirals (control): funnels that draw in, rings drawn round by the crook, low waves
along the ground. Colours: dusk ink (DUSK_INK), lavender haze (DUSK, hue 255°, never the marigold of his lamp
glass), Noonwhite rims, and the relationship colour (team) on every edge that moves an enemy. His lantern core
is the team-coloured accent, so the lantern flare is team light.

Anchors (src/render/director.ts): Draw In and the Driving Hour eruption are delayed areas (the def spawns when
they land, `ground`); Crook Sweep is a 2 m-wide projectile (`path`); Step Through Dusk fires at the cast
(`origin` = where he leaves); the herding ring is an area at his feet, aimed at the drive point (`dir`).
"""
from __future__ import annotations

from vfxkit import (INK, INK2, NOON, WHITE, L, chips, decal, dust, flash, ink, light, mesh, shake, shockwave, vfx)

DUSK = "#B4A8D8"        # dusk lavender haze
DUSK_DK = "#6E6390"     # lavender in shadow
DUSK_INK = "#221E2C"    # dusk ink (violet-black)
STONE = "#8C8478"       # chips (his card secondary)


def _ring(at: str, radius, width, life: float, color="team", alpha=(1, 0.8, 0), emissive: float = 2.5, sharp: float = 1.6, noise: float = 0.35,
          delay: float = 0.0, fit=None, blend: str = "add") -> list:
    """A shockwave with a raw radius curve (keys allowed: rings that close inward)."""
    return [L("shockwave", at=at, radius=radius, width=list(width), life=life, color=color, alpha=list(alpha), emissive=emissive, sharp=sharp,
              noise=noise, delay=delay or None, fit=fit, blend=blend)]


def defs() -> list:
    D = []

    # ── passive · Settling: a displaced enemy is Settled (a dusk halo sinks onto them) ─────────────────────
    D.append(vfx("dunsom_passive_settle", 0.8,
                 shockwave("target", radius=(0.95, 0.45), width=(0.08, 0.14), life=0.45, emissive=1.5, alpha=(0, 1, 0)),
                 L("emitter", at="target", offset=[0, 0.7, 0], count=8, shape="ring", radius=0.45, dir="down", spreadDeg=10, speed=[1.2, 2.0],
                   life=[0.35, 0.55], size=[0.5, 0.3], color=[DUSK, "team"], alpha=[0, 0.9, 0], emissive=1.4, drag=1.5, texture="wisp",
                   blend="add", align="velocity", aspect=0.5),
                 L("emitter", at="target", offset=[0, -0.6, 0], count=4, shape="ring", radius=0.4, dir="out", spreadDeg=20, speed=[0.3, 0.7],
                   life=[0.4, 0.6], size=[0.35, 0.6], color=[DUSK_INK, INK], alpha=[0, 0.7, 0], drag=1.5, texture="ink_puff", blend="ink",
                   rim=NOON, rimAlpha=0.5, soft=0.2),
                 comment="T1 · Shade · Settling: a team halo narrows at the feet while dusk wisps sink down the body (harm settles), "
                         "a breath of dusk ink at the ankles"))

    # ── a1 · Draw In: the hook catches 3 m around the point and reels everything in (delayed area, r 3) ─────
    D.append(vfx("dunsom_a1_draw", 1.0,
                 flash(3, at="ground", color="team", scale=0.7),
                 # the reel: a dusk funnel turns inward (control spiral) under a team ring closing to the centre
                 mesh("ground", "tornado", 2.1, 0.36, color=[DUSK, "team"], alpha=(1, 0.9, 0), emissive=2.6, stretch=[1, 0.12, 1], twist=-7, mask="edge",
                      mask_param=[[0, 1.02], [0.75, 0.18], [1, 0.05]], noise=0.7, noise_scale=3.0, scroll=[0.8, 2.2], fit=True),
                 mesh("ground", "tornado", 2.1, 0.36, color=DUSK, alpha=(0.35, 0.25, 0), emissive=0.5, stretch=[1, 0.12, 1], twist=-7, noise=1.0,
                      noise_scale=3.0, scroll=[0.8, 2.2], fit=True),
                 _ring("ground", radius=[[0, 1.02], [0.7, 0.3], [1, 0.12]], width=(0.3, 0.12), life=0.3, emissive=4.0, sharp=2.4, alpha=(1, 1, 0.3),
                           fit=True),
                 _ring("ground", color=DUSK_INK, radius=[[0, 1.05], [0.7, 0.35], [1, 0.16]], width=(0.6, 0.2), life=0.32, emissive=0, blend="ink",
                           alpha=(0.85, 0.8, 0), fit=True),
                 L("emitter", at="ground", offset=[0, 0.35, 0], count=40, shape="ring", radius=3.0, dir="in", spreadDeg=8, speed=[7, 10],
                   life=[0.26, 0.34], size=[0.7, 0.35], color=[DUSK, "team"], alpha=[0, 1, 0], emissive=3.5, drag=0.6, orbitDeg=-160, texture="wisp",
                   blend="add", align="velocity", aspect=0.35, fit=False),
                 L("emitter", at="ground", offset=[0, 0.2, 0], count=10, shape="ring", radius=2.8, dir="in", spreadDeg=10, speed=[5, 8],
                   life=[0.3, 0.42], size=[0.6, 1.0], color=[DUSK_INK, INK], alpha=[0, 0.85, 0], drag=0.8, orbitDeg=-140, texture="ink_puff",
                   blend="ink", rim=DUSK, rimAlpha=0.6, rotDeg=[0, 360], fit=False, soft=0.2),
                 # the catch: everything arrives at the centre in a puff of dusk
                 ink("ground", 6, size=0.7, speed=(1.0, 2.0), life=(0.35, 0.6), radius=0.2, shape="disc", dir_="out", gravity=-0.2, delay=0.26,
                     color=(DUSK_INK, INK)),
                 L("sprite", at="ground", offset=[0, 0.6, 0], texture="glow", size=[0.6, 1.6, 0.8], color=[DUSK, "team"], emissive=3.0,
                   alpha=[0, 1, 0], life=0.25, delay=0.24, fit=False),
                 decal("ground", "ink", [[0, 0.1], [0.15, 0.35], [1, 0.38]], 0.7, color=DUSK_INK, alpha=(0.8, 0.6, 0), rim="team", texture="splat",
                       delay=0.24, fit=True),
                 comment="T3 · Shade · Draw In: the crook's hook catches the point: a dusk funnel spins inward (control) under a team ring "
                         "that closes from 3 m to the centre, lavender wisps and dusk ink are reeled in; the catch lands in a puff of dusk "
                         "and a stain"))

    # ── a2 · Crook Sweep: a 2 m-wide wave of dusk swept 7 m along the ground (projectile, 24 m/s) ──────────
    D.append(vfx("dunsom_a2_sweep", 0.45,
                 flash(2, at="origin", color=DUSK, scale=0.7, light=False),
                 # the wave front: a low crescent of team light with a dusk-ink crest riding behind it
                 mesh("path", "crescent", [[0, 1.4], [0.15, 2.5], [1, 2.5]], 0.45, color=[DUSK, "team"], alpha=0.8, emissive=2.4, align="velocity",
                      offset=[0, -0.85, 0], hold=1, noise=0.7, noise_scale=2.5, scroll=[1.5, 0], stretch=[1, 1, 1.5]),
                 mesh("path", "crescent", [[0, 1.6], [0.15, 2.8], [1, 2.8]], 0.45, color="team", alpha=0.5, emissive=1.6, align="velocity",
                      offset=[-0.25, -0.75, 0], hold=1, noise=0.8, noise_scale=2.5, scroll=[2.0, 0], stretch=[1, 1, 2.6]),
                 mesh("path", "crescent", [[0, 1.4], [0.15, 2.6], [1, 2.6]], 0.45, color=DUSK_INK, alpha=0.85, emissive=0, rim="team", rim_emissive=2.0,
                      blend="ink", align="velocity", offset=[-0.35, -0.8, 0], hold=1, noise=0.6, scroll=[1.2, 0], stretch=[1, 1, 0.9]),
                 L("emitter", at="path", rate=45, shape="line", length=0.01, width=2.0, offset=[-0.1, -0.7, 0], dir="up", spreadDeg=30,
                   speed=[1.0, 2.2], life=[0.25, 0.4], size=[0.3, 0.5, 0.55], color=[DUSK_INK, INK], alpha=[0, 0.8, 0], gravity=1.5, drag=1.5,
                   texture="ink_puff", blend="ink", rim=DUSK, rimAlpha=0.6, rotDeg=[0, 360], soft=0.2),
                 L("emitter", at="path", rate=40, shape="line", length=0.01, width=2.0, offset=[0.1, -0.6, 0], dir="back", spreadDeg=20,
                   speed=[2, 4], life=[0.12, 0.22], size=[0.5, 0.15], color=[DUSK, "team"], alpha=[1, 0], emissive=3.0, drag=2, texture="streak",
                   stretch=0.05, blend="add"),
                 # the swept path darkens: a dusk-ink band on the ground with a team rim
                 L("ribbon", at="path", color=DUSK_INK, width=[0, 1.6, 2.0], life=0.5, alpha=[0, 0.6, 0.7], emissive=0, noise=0.5, blend="ink",
                   rim="team", rimAlpha=0.6, face="ground"),
                 L("ribbon", at="path", color=[DUSK, "team"], width=[0, 1.4, 1.9], life=0.35, alpha=[0, 0.22, 0.4], emissive=1.6, noise=0.6, face="ground"),
                 L("emitter", at="path", rate=24, shape="line", length=0.01, width=1.8, offset=[0, -0.9, 0], dir="up", spreadDeg=40, speed=[0.6, 1.4],
                   life=[0.5, 0.8], size=[0.6, 1.0, 1.2], color=["#6E6A62", "#57544E"], alpha=[0, 0.4, 0], gravity=-0.2, drag=2.5,
                   texture="dust_puff", blend="alpha", rotDeg=[0, 360], soft=0.3, secondary=True),
                 comment="T2 · Shade · Crook Sweep: a low 2 m wave rolls along the ground: a team-lit crescent front with a dusk-ink crest "
                         "breaking behind it, the swept path left dark under a team rim, dust kicked up"))

    # ── a3 · Step Through Dusk: he leaves his shade standing where he was (cast, at the departure) ───────────
    D.append(vfx("dunsom_a3_step", 0.9,
                 L("sprite", at="origin", offset=[0, -0.05, 0], texture="ink_puff", frame=3, size=[2.0, 2.3, 2.4], color=[DUSK_INK, INK],
                   alpha=[0.95, 0.85, 0], erode=[0, 0.1, 0.8], life=0.75, blend="ink", rim=DUSK, rimAlpha=0.9, align="axis", aspect=0.5, soft=0.2),
                 L("sprite", at="origin", offset=[0, 0.1, 0], texture="glow", size=[1.6, 2.2, 1.6], color=[DUSK, "team"], emissive=3.0, alpha=[0.9, 0],
                   life=0.2, align="axis", aspect=0.45),
                 ink("origin", 10, size=0.8, speed=(0.6, 1.6), life=(0.45, 0.75), radius=0.4, shape="sphere", dir_="out", gravity=-0.3,
                     color=(DUSK_INK, INK), rim=DUSK),
                 L("emitter", at="origin", count=12, shape="sphere", radius=0.5, dir="forward", spreadDeg=14, speed=[9, 14], life=[0.1, 0.2],
                   size=[0.6, 0.15], color=[DUSK, "team"], alpha=[1, 0], emissive=3.0, drag=2.5, texture="streak", stretch=0.06, blend="add"),
                 shockwave("origin", radius=(0.25, 0.95), width=(0.16, 0.05), life=0.3, emissive=2.6),
                 decal("ground", "ink", [[0, 0.4], [0.15, 0.8], [1, 0.85]], 0.9, color=DUSK_INK, alpha=(0.8, 0.6, 0), rim="team", texture="splat",
                       fit=False),
                 comment="T2 · Shade · Step Through Dusk: he steps out of his own shade: a tall dusk-ink silhouette with a lavender rim is "
                         "left standing and crumbles, lavender side-streaks leave toward the arrival, a small team ring and a stain"))

    # ── ult · Driving Hour, the herd: the crook draws a 5 m ring round him and drives everyone at the point ──
    D.append(vfx("dunsom_ult_herd", 1.0,
                 L("sprite", at="caster", socket="weapon", offset=[0, 1.0, 0], texture="flare", size=[0.8, 2.4, 1.6], color=[NOON, "team"],
                   emissive=8.0, alpha=[1, 1, 0], life=0.3),
                 flash(3, at="origin", color="team", scale=0.8),
                 # the herding circle: a dusk band drawn once round at 5 m by the crook (a bright team head), then it tightens
                 mesh("ground", "ringwave", [[0, 2.05], [0.7, 2.0], [1, 1.85]], 0.42, color=[[0, "team"], [1, DUSK]], alpha=(0.85, 0.7, 0), emissive=4.0,
                      mask="sweep", mask_param=[[0, 0.02], [0.8, 1.05], [1, 1.2]], align="up", fit=True, noise=0.8, noise_scale=3.0, scroll=[0, -2.0]),
                 mesh("ground", "ringwave", [[0, 2.05], [1, 1.75]], 0.6, color=DUSK_INK, alpha=[[0, 0], [0.3, 0.7], [1, 0]], emissive=0, rim="team",
                      blend="ink", mask="band", mask_param=0.35, align="up", fit=True, noise=0.6, scroll=[0.4, -0.8], delay=0.1),
                 shockwave("ground", radius=(1.0, 0.92), width=(0.12, 0.05), life=0.5, emissive=6.0, alpha=(0, 1, 0), delay=0.12, fit=True),
                 # driven: dusk streams across the circle toward the point
                 L("emitter", at="ground", offset=[0, 0.5, 0], count=36, shape="disc", radius=5.0, radiusInner=1.0, dir="forward", spreadDeg=16,
                   speed=[8, 13], life=[0.25, 0.45], size=[0.85, 0.35], color=[DUSK, "team"], alpha=[0, 1, 0], emissive=5.0, drag=0.8,
                   texture="wisp", blend="add", align="velocity", aspect=0.35, delay=0.12, fit=False),
                 L("emitter", at="ground", offset=[0, 0.3, 0], count=14, shape="ring", radius=4.8, dir="forward", spreadDeg=25, speed=[3, 6],
                   life=[0.4, 0.7], size=[0.7, 1.2], color=[DUSK_INK, INK], alpha=[0, 0.8, 0], drag=1.5, texture="ink_puff", blend="ink", rim=DUSK,
                   rimAlpha=0.6, rotDeg=[0, 360], delay=0.08, fit=False, soft=0.25),
                 light("origin", "team", 16, 8, 0.4),
                 shake(0.3),
                 comment="T4 · Shade · Driving Hour (the herd): the lantern flares team-white; the crook draws a dusk band once round at "
                         "5 m (a bright team head), an ink ring shadows it, then lavender streams and dusk ink drive across the circle "
                         "toward the point"))

    # ── ult · Driving Hour, the eruption: the point erupts 0.6 s later (delayed area, r 2.5, root) ──────────
    D.append(vfx("dunsom_ult_drive", 1.5,
                 flash(4, at="ground", scale=1.4),
                 mesh("ground", "column", [[0, 0.2], [0.12, 0.75], [1, 0.85]], 0.7, color=DUSK_INK, alpha=[[0, 1], [0.5, 0.85], [1, 0]], emissive=0,
                      rim="team", rim_pow=2.4, rim_emissive=4.0, blend="ink", stretch=[0.9, 1.5, 0.9], mask="top", mask_param=0.45,
                      dissolve=[[0, 0.1], [0.4, 0.3], [1, 1]], edge="team", edge_emissive=5.0, noise=0.9, noise_scale=2.5, scroll=[0.3, 2.6], twist=1.5,
                      fit=True),
                 mesh("ground", "column", [[0, 0.1], [0.15, 0.3], [1, 0.32]], 0.28, color=[WHITE, "team"], alpha=(0.9, 0), emissive=12, mask="top",
                      mask_param=0.6, stretch=[1, 4.0, 1], noise=0.6, scroll=[0, 3.0], fit=True),
                 shockwave("ground", radius=(0.15, 1.0), width=(0.6, 0.12), life=0.35, emissive=10, sharp=2.2, fit=True),
                 shockwave("ground", color=DUSK, radius=(0.1, 0.85), width=(0.3, 0.06), life=0.45, emissive=4.0, alpha=(0.8, 0.5, 0), delay=0.06, fit=True),
                 # the root: the ground under them binds in a dusk-ink coil, the edge held in team colour
                 mesh("ground", "spiral", [[0, 0.4], [0.15, 1.05], [1, 1.0]], 1.3, color=DUSK_INK, alpha=[[0, 0], [0.1, 1], [0.5, 0.75], [1, 0]],
                      emissive=0, rim="team", rim_pow=3.0, rim_emissive=2.4, blend="ink", stretch=[1.9, 0.3, 1.9], twist=-1.0, delay=0.05, fit=True),
                 decal("ground", "ink", [[0, 0.3], [0.1, 0.95], [1, 1.0]], 1.4, color=DUSK_INK, alpha=(0.85, 0.75, 0), rim="team", texture="splat",
                       fit=True),
                 L("emitter", at="ground", count=26, shape="disc", radius=0.8, dir="up", spreadDeg=55, speed=[4, 8], life=[0.5, 0.9], size=[0.18, 0.12],
                   color=[INK, DUSK_INK], alpha=[1, 1, 0], gravity=12, drag=0.6, texture="drop", blend="ink", rim=DUSK, rimAlpha=0.7, align="velocity",
                   fit=False),
                 ink("ground", 14, size=1.5, speed=(3, 5.5), life=(0.5, 0.9), radius=0.4, shape="disc", dir_="out", gravity=-0.1,
                     color=(DUSK_INK, INK), rim=DUSK),
                 L("emitter", at="ground", count=20, shape="disc", radius=0.6, dir="up", spreadDeg=25, speed=[5, 9], life=[0.3, 0.5],
                   size=[0.8, 0.3], color=[DUSK, "team"], alpha=[1, 0], emissive=6.0, drag=2, texture="wisp", blend="add", align="velocity",
                   aspect=0.35, fit=False),
                 chips("ground", 14, color=(STONE, "#57544E"), speed=(4, 8), size=0.16),
                 light("ground", "team", 24, 9, 0.5),
                 shake(0.65),
                 comment="T4 · Shade · Driving Hour eruption: a white core, then a dusk-ink column erupts with a bright team rim and a "
                         "white-hot heart, a team ring thrown to 2.5 m; a dusk-ink coil binds the ground (root), ink rains and billows "
                         "out, chips fly"))
    return D
