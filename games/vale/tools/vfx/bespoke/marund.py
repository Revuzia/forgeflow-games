"""Marund (Plinth, dome mason): bespoke ability VFX.

Identity: masonry. Pale honed stone, wet mortar and courses of light laid one over another, the
way his dome-cap is banded. Stone parts are OPAQUE (chip blend) and catch a team rim; the light is
Lumen. The dome is the signature: a real shell with a bright team foot ring (the no-entry line is
the brightest thing), three warm windows like the cap's, banding courses on the shell.
"""
from __future__ import annotations

import math

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, INK2, NOON, WHITE, L, chips, decal, dust, flash, glow, light, mesh, motes,
                    ribbon, shake, shockwave, sparks, streaks, vfx)

STONE = "#D0C6B3"       # honed dialstone (the cap shell)
STONE_DK = "#8F8676"
IRON = "#4A4038"        # ironstone banding
MORTAR = "#C9C3B5"      # wet mortar, pale
MORTAR_DK = "#7E786E"
WHITE_T = "#FFFFFF"     # T4 only (below T4 the renderer turns it Dawnglass)
HEARTH = "#EBD9B8"      # a low-saturation lamp warmth (window glazing light), never a large area


def xfade(peak: float, life: float, dur: float) -> list:
    """alpha keys for a zone loop: the old copy fades out exactly while the next one fades in."""
    o = max(0.02, (life - dur) / life)
    return [[0, 0], [o, peak], [1 - o, peak], [1, 0]]


def defs() -> list:
    D = []

    # ── passive · Hearthside (interval area, circle 5 at self, every 1 s; T1) ───────────────────
    # a slow hearth breath: the 5 m edge glows up and down, warm motes rise off Marund (help is up)
    D.append(vfx("marund_passive_hearth", 1.0,
                 shockwave("ground", color=[HEARTH, "team"], radius=(0.97, 1.0), width=(0.06, 0.06), life=1.0, emissive=1.2,
                           alpha=(0, 0.55, 0.55, 0), sharp=2.2, noise=0.25),
                 motes("ground", 5, color=[HEARTH, "team"], rise=1.2, life=(0.7, 1.0), size=0.14, radius=0.12, emissive=1.4, delay=0.05),
                 L("emitter", at="ground", count=6, shape="ring", radius=0.98, dir="up", spreadDeg=10, speed=[0.3, 0.6], life=[0.5, 0.9],
                   size=[0, 0.12, 0], color=["team", HEARTH], alpha=[0, 0.8, 0], emissive=1.3, texture="mote", blend="add", secondary=True),
                 comment="T1 · Lumen · Hearthside: the 5 m hearth edge breathes in team light, warm motes rise off the mason (help is up)"))

    # ── a1 · Shoulder In (dash 4.5 m at 14 m/s; T3) ─────────────────────────────────────────────
    # the cap becomes a battering ram: a stone-and-light dome face leads the charge, a ploughed furrow
    D.append(vfx("marund_a1_shoulder", 0.55,
                 # push-off: dust thrown back, a few chips, a cracked footprint
                 dust("origin", 6, size=1.0, speed=(1.5, 3.0), radius=0.3, delay=0.0, shape="disc", dir_="out"),
                 chips("origin", 7, speed=(2.5, 5), size=0.15, delay=0.0),
                 decal("origin", "crack", 0.8, 0.9, color=INK2, alpha=(0.75, 0.6, 0), emissive=0.4, rim="team", texture="crack"),
                 # the ram: a forward-facing dome shell of team light with an opaque stone core plate
                 mesh("path", "dome", [[0, 0.6], [0.12, 1.6], [1, 1.6]], 0.55, color="team", alpha=[[0, 0.7], [0.8, 0.6], [1, 0]], emissive=1.8,
                      rim="team", rim_pow=1.8, rim_emissive=5.0, noise=0.6, scroll=[0, -2.5], rotate=[90, 0, 0], stretch=[1, 0.7, 1], hold=1,
                      offset=[0.3, 0, 0]),
                 mesh("path", "dome", [[0, 0.4], [0.12, 1.15], [1, 1.15]], 0.55, color=[STONE, STONE_DK], alpha=1, emissive=0.45, rim="team",
                      rim_pow=2.6, rim_emissive=4.0, blend="chip", noise=0.35, rotate=[90, 0, 0], stretch=[1, 0.38, 1], hold=1, offset=[0.55, 0, 0]),
                 # furrow of light on the ground and a short body streak (movement)
                 ribbon("path", "team", width=(0.0, 1.5), life=0.32, alpha=(0, 0.6), emissive=3.0, noise=0.5, face="ground"),
                 ribbon("path", STONE, width=(0.0, 0.5), life=0.2, alpha=(0, 0.5), emissive=1.6, noise=0.3),
                 L("emitter", at="path", perMeter=5, offset=[0, -0.95, 0], shape="disc", radius=0.4, dir="out", spreadDeg=40, speed=[1.0, 2.4],
                   life=[0.45, 0.8], size=[0.45, 0.9, 1.1], color=[DUST, DUST2], alpha=[0, 0.5, 0.3, 0], gravity=-0.2, drag=2.6, turbulence=0.3,
                   rotDeg=[0, 360], spinDeg=[-30, 30], texture="dust_puff", blend="alpha", soft=0.3, secondary=True),
                 L("emitter", at="path", perMeter=3, offset=[0.4, -0.9, 0], dir="up", spreadDeg=70, speed=[2.5, 5], life=[0.35, 0.6], size=[0.13, 0.13, 0.08],
                   sizeVar=[0.6, 1.3], color=[STONE, CHALK_DK], alpha=[1, 1, 1, 0], gravity=14, drag=0.8, bounce=0.35, texture="chip", blend="chip",
                   spinDeg=[-540, 540], rim=NOON, rimAlpha=0.5, secondary=True),
                 L("emitter", at="path", rate=40, shape="disc", radius=0.5, dir="back", spreadDeg=20, speed=[4, 8], life=[0.08, 0.16], size=[0.5, 0.12],
                   color="team", alpha=[0.9, 0], emissive=3.0, drag=3, texture="streak", stretch=0.06, blend="add"),
                 light("origin", "team", 6, 5, 0.4),
                 comment="T3 · Lumen · Shoulder In: the cap turns battering ram (a stone plate inside a forward team dome), a furrow of light,"
                         " dust and chips ploughed aside, side streaks (movement)"))

    # ── a2 · Shelter Dome: the raise (area circle 3 at self, knockback 2.5; T2) ─────────────────
    D.append(vfx("marund_a2_raise", 0.9,
                 flash(2, at="ground", color=STONE, scale=1.2),
                 # the maul post driven in: a crack and chips at the centre
                 decal("ground", "crack", [[0, 0.15], [0.1, 0.4], [1, 0.4]], 0.9, color=INK2, alpha=(0.85, 0.7, 0), emissive=0.5, rim="team",
                       texture="crack"),
                 chips("ground", 8, speed=(2.5, 5), size=0.14),
                 # the shell goes up fast and wide: enemies are shoved to its edge (out is harm)
                 mesh("ground", "dome", [[0, 0.5], [0.22, 2.0], [1, 2.02]], 0.6, color="team", alpha=[[0, 0.8], [0.3, 0.4], [1, 0]], emissive=1.4,
                      rim="team", rim_pow=2.0, rim_emissive=3.0, noise=0.6, scroll=[0, 1.5], fit=True),
                 # the courses are laid: a band of light climbs the shell from the foot to the crown
                 mesh("ground", "dome", 2.0, 0.42, color=[STONE, "team"], alpha=[[0, 1], [0.8, 1], [1, 0]], emissive=3.0,
                      mask="edge", mask_param=[[0, 0.05], [1, 0.95]], noise=0.2, fit=True),
                 shockwave("ground", radius=(0.15, 1.05), width=(0.45, 0.1), life=0.3, emissive=3.0, fit=True),
                 L("emitter", at="ground", count=14, shape="ring", radius=0.95, dir="out", spreadDeg=30, speed=[2, 4], life=[0.35, 0.55],
                   size=[0.15, 0.15, 0.09], sizeVar=[0.6, 1.3], color=[STONE, CHALK_DK], alpha=[1, 1, 1, 0], gravity=13, drag=0.8, bounce=0.35,
                   texture="chip", blend="chip", spinDeg=[-540, 540], rim=NOON, rimAlpha=0.5, delay=0.06, fit=True),
                 dust("ground", 10, size=1.0, speed=(1.0, 2.0), radius=1.0, delay=0.08, shape="ring"),
                 light("ground", "team", 8, 6, 0.4),
                 shake(0.2),
                 comment="T2 · Lumen · Shelter Dome raised: the maul post cracks the floor, a team shell swells to 3 m and shoves (out is harm),"
                         " a course of stone light climbs it, chips and dust at the foot"))

    # ── a2 · Shelter Dome: the standing dome (zone circle 3, loops 1 s while it lives; T3) ───────
    LIFE, DUR = 1.12, 1.0
    win = []
    for ang in (0, 120, 240):   # three warm windows like the cap's, low on the shell (placed for the real 3 m dome)
        a = math.radians(ang)
        win += glow("ground", HEARTH, 0.5, LIFE, 2.0, alpha=xfade(0.85, LIFE, DUR),
                    offset=[round(math.cos(a) * 2.75, 3), 0.9, round(math.sin(a) * 2.75, 3)], soft=0.1)
    D.append(vfx("marund_a2_dome", DUR,
                 # the shell: clear in the middle, a bright fresnel silhouette (a dome, not a disc)
                 mesh("ground", "dome", 2.0, LIFE, color="team", alpha=xfade(0.26, LIFE, DUR), emissive=0.8, rim="team", rim_pow=2.6,
                      rim_emissive=4.0, noise=0.6, noise_scale=2.4, scroll=[0.05, 0.12], fit=True),
                 # laid courses (the cap's banding): each course catches light on its top edge and falls off below
                 sum([mesh("ground", "dome", 2.0, LIFE, color="team", alpha=xfade(a, LIFE, DUR), emissive=1.2, mask="edge", mask_param=v,
                           noise=0.3, fit=True) for v, a in ((0.22, 0.24), (0.47, 0.19), (0.72, 0.15))], []),
                 # the sun's catch-light high on the shell (behind-left), so it reads round
                 glow("ground", DAWNGLASS, 1.1, LIFE, 1.2, alpha=xfade(0.45, LIFE, DUR), offset=[0.5, 2.45, -0.9], soft=0.1),
                 # the no-entry foot ring: the brightest line in the effect
                 shockwave("ground", radius=(1.0, 1.0), width=(0.14, 0.14), life=LIFE, emissive=5.5, alpha=xfade(1.0, LIFE, DUR),
                           sharp=2.6, noise=0.15),
                 decal("ground", "plain", 1.0, LIFE, color="team", alpha=xfade(0.16, LIFE, DUR), texture="glow"),
                 win,
                 motes("ground", 0, color=[HEARTH, "team"], rate=7, rise=1.1, life=(0.8, 1.1), radius=0.7, size=0.18, emissive=2.0),
                 L("emitter", at="ground", rate=6, shape="ring", radius=1.0, dir="out", spreadDeg=30, speed=[0.2, 0.5], life=[0.6, 0.9],
                   size=[0.3, 0.6, 0.7], color=[DUST, DUST2], alpha=[0, 0.35, 0.2, 0], gravity=-0.1, drag=2.0, rotDeg=[0, 360],
                   texture="dust_puff", blend="alpha", soft=0.3, secondary=True),
                 comment="T3 · Lumen · Shelter Dome (loop): a clear team shell with a bright fresnel silhouette and a solid foot band, two"
                         " stone banding courses, a catch-light on the crown, three warm windows low on the wall, the no-entry foot ring"
                         " brightest, motes rising inside (help is up)"))

    # ── a3 · Mortar Pail: the fling (cast at the caster; release at castTime 0.25) ─────────────
    D.append(vfx("marund_a3_fling", 0.7,
                 L("emitter", at="origin", count=14, delay=0.2, offset=[0.3, -0.4, -0.25], shape="sphere", radius=0.12, dir="forward", spreadDeg=22,
                   speed=[5, 7.5], velocity=[0, 3.2, 0], life=[0.32, 0.5], size=[0.3, 0.24], sizeVar=[0.6, 1.4], color=[MORTAR, MORTAR_DK],
                   alpha=[1, 1, 0], gravity=11, drag=0.6, texture="drop", blend="chip", align="velocity", rim="team", rimAlpha=0.5),
                 L("emitter", at="origin", count=5, delay=0.2, offset=[0.3, -0.4, -0.25], dir="forward", spreadDeg=30, speed=[3, 5], velocity=[0, 2, 0],
                   life=[0.12, 0.22], size=[0.3, 0.08], color="team", alpha=[0.9, 0], emissive=2.4, drag=3, texture="streak", stretch=0.05, blend="add"),
                 # the underhand swing: a vertical arc smear rising forward from the left hip
                 mesh("origin", "crescent", [[0, 0.8], [1, 1.3]], 0.26, color=[MORTAR, "team"], alpha=(0.9, 0), emissive=2.0, mask="sweep",
                      mask_param=[[0, 0], [1, 1.05]], rotate=[0, 0, 90], offset=[0.2, -0.3, -0.3], delay=0.12),
                 dust("origin", 3, size=0.6, speed=(0.4, 1.0), radius=0.15, delay=0.18, shape="sphere"),
                 comment="T2 · impact · Mortar Pail thrown: a wet handful of opaque mortar leaves the pail underhand with a short team streak"))

    # ── a3 · Mortar Pail: the landing (area circle 2, delay 0.5; T3) ─────────────────────────────
    D.append(vfx("marund_a3_mortar", 1.2,
                 flash(2, at="ground", color=MORTAR, scale=1.1, light=False),
                 # the wet slap: a mortar splash billow, drops thrown out and falling (out/down is harm)
                 L("emitter", at="ground", count=5, shape="disc", radius=0.25, dir="up", spreadDeg=60, speed=[0.8, 1.8], life=[0.35, 0.5],
                   size=[0.7, 1.3, 1.5], color=[MORTAR, MORTAR_DK], alpha=[1, 0.9, 0], gravity=2, drag=2, rotDeg=[0, 360], texture="splash",
                   blend="alpha", rim="team", rimAlpha=0.5, soft=0.2, fit=True),
                 L("emitter", at="ground", count=22, shape="disc", radius=0.3, dir="out", spreadDeg=55, speed=[2.5, 5], velocity=[0, 2.5, 0],
                   life=[0.35, 0.6], size=[0.18, 0.14], sizeVar=[0.6, 1.4], color=[MORTAR, MORTAR_DK], alpha=[1, 1, 0], gravity=12, drag=0.8,
                   texture="drop", blend="chip", align="velocity", rim="team", rimAlpha=0.45, bounce=0.05),
                 shockwave("ground", radius=(0.25, 1.05), width=(0.3, 0.06), life=0.32, emissive=3.0, fit=True),
                 # the stain that marks the Mortared: pale wet mortar with a team rim, drying out
                 decal("ground", "ink", [[0, 0.45], [0.08, 0.85], [1, 0.9]], 1.2, color=MORTAR, alpha=(0.85, 0.7, 0), rim="team", texture="ink_puff", fit=True),
                 # slow (control spiral): a few mortar flecks sliding round the stain
                 L("emitter", at="ground", count=8, delay=0.1, shape="ring", radius=0.8, dir="none", speed=[0, 0], life=[0.5, 0.8],
                   size=[0, 0.12, 0], color=["team", MORTAR], alpha=[0, 0.9, 0], emissive=2.0, orbitDeg=-180, texture="mote", blend="add", fit=True),
                 chips("ground", 6, color=(MORTAR, STONE_DK), speed=(2, 4), size=0.12),
                 dust("ground", 5, size=0.9, radius=0.6, delay=0.12),
                 comment="T3 · impact · Mortar lands: a wet opaque slap, mortar drops thrown out, a team ring, a pale mortar stain with a team rim"
                         " (the Mortar mark), flecks slide round it (control)"))

    # ── ult · Domefall: the leap (dash toPoint 7 m; T3) ─────────────────────────────────────────
    D.append(vfx("marund_ult_leap", 0.9,
                 dust("origin", 10, size=1.2, speed=(1.5, 3.2), radius=0.5, delay=0.0),
                 chips("origin", 10, speed=(2.5, 6), size=0.16, delay=0.0),
                 decal("origin", "crack", 1.0, 1.0, color=INK2, alpha=(0.8, 0.6, 0), emissive=0.5, rim="team", texture="crack"),
                 shockwave("origin", radius=(0.3, 1.4), width=(0.3, 0.06), life=0.3, emissive=3.0),
                 ribbon("path", "team", width=(0.0, 0.9), life=0.35, alpha=(0, 0.55), emissive=3.0, noise=0.4),
                 ribbon("path", STONE, width=(0.0, 0.35), life=0.22, alpha=(0, 0.6), emissive=1.8, noise=0.2),
                 glow("path", "team", 1.3, 0.9, 2.4, alpha=(0, 0.8, 0.8, 0), follow=True),
                 L("emitter", at="path", rate=30, shape="disc", radius=0.4, dir="back", spreadDeg=30, speed=[1, 2.5], life=[0.2, 0.4], size=[0.16, 0.04],
                   color=["team", HEARTH], alpha=[1, 0], emissive=3.0, drag=2, texture="spark", stretch=0.03, blend="add", secondary=True),
                 comment="T3 · Lumen · Domefall leap: a cracked launch spot, dust and chips, a team glow rides the arc with a stone-pale"
                         " streak and sparks shed behind"))

    # ── ult · Domefall: the landing (area circle 3.5; T4) ─────────────────────────────────────────
    D.append(vfx("marund_ult_domefall", 1.6,
                 # r12 M13: the primary element is the dome itself, glazed in Marund's jade: a deep-jade shell (L* ~48 against
                 # the pale plaza's ~78) with a signature glaze rim; the team foot ring stays the brightest edge (the no-entry line)
                 flash(4, at="ground", color="signature", scale=1.0),
                 # the shell lands whole (opaque glazed stone), holds a beat, then splits along glowing jade seams
                 mesh("ground", "dome", [[0, 2.3], [0.07, 1.98], [0.12, 2.0], [1, 2.0]], 0.8, color=["secondary", IRON], alpha=[[0, 1], [0.75, 1], [1, 0]],
                      emissive=0.35, rim="signature", rim_pow=2.6, rim_emissive=3.0, blend="chip", noise=0.3, noise_scale=1.6,
                      dissolve=[[0, 0], [0.22, 0.02], [0.45, 0.45], [1, 1]], edge="signature", edge_width=0.14, edge_emissive=8, fit=True),
                 # the banding course of the shell, lit jade as it breaks
                 mesh("ground", "dome", 2.0, 0.5, color=["signature", "secondary"], alpha=[[0, 0.7], [0.6, 0.5], [1, 0]], emissive=3.0, mask="edge",
                      mask_param=[[0, 0.1], [1, 0.55]], noise=0.3, delay=0.05, fit=True),
                 # the three windows flare as it breaks
                 [L("sprite", at="ground", texture="flare", size=[1.1, 1.2], color=HEARTH, emissive=6, alpha=[0, 1, 0], life=0.32, delay=0.06,
                    offset=[round(3.0 * c, 3), 1.1, round(3.0 * s_, 3)], soft=0.1) for c, s_ in ((1, 0), (-0.5, 0.866), (-0.5, -0.866))],
                 # shell fragments thrown out (glazed jade and ironstone), then the brightest team ring
                 L("emitter", at="ground", count=20, delay=0.18, shape="ring", radius=0.8, dir="out", spreadDeg=35, speed=[4, 8], velocity=[0, 3.5, 0],
                   life=[0.55, 0.9], size=[0.4, 0.36, 0.24], sizeVar=[0.6, 1.4], color=["secondary", IRON], alpha=[1, 1, 1, 0], gravity=14, drag=0.6,
                   bounce=0.3, texture="chip", blend="chip", spinDeg=[-400, 400], rim="signature", rimAlpha=0.6, fit=True),
                 mesh("ground", "dome", [[0, 2.0], [1, 2.45]], 0.3, color="signature", alpha=[[0, 0], [0.15, 0.2], [1, 0]], emissive=2.0, rim="signature",
                      rim_pow=2.0, rim_emissive=4.0, noise=0.6, delay=0.2, fit=True),
                 shockwave("ground", radius=(0.35, 1.15), width=(0.7, 0.12), life=0.45, emissive=9.0, delay=0.18, fit=True),
                 shockwave("ground", radius=(0.2, 0.95), width=(0.3, 0.05), life=0.6, emissive=4.0, delay=0.28, alpha=(0.8, 0.4, 0), fit=True),
                 # the floor lit as the shell splits (combat F4: the landing lifts its disc >= 2x on every tier, bloom or not)
                 L("decal", at="ground", shape="circle", style="light", radius=[[0, 0.6], [0.3, 0.95], [1, 1.0]], life=0.6, color=[WHITE, "signature"],
                   alpha=[[0, 0.3], [0.4, 0.6], [1, 0]], emissive=1.8, fit=True, delay=0.16),
                 chips("ground", 14, color=("secondary", CHALK_DK), speed=(4, 8), size=0.16),
                 dust("ground", 12, size=1.5, speed=(2, 4), radius=0.9, delay=0.25, life=(0.7, 1.1)),
                 decal("ground", "crack", [[0, 0.5], [0.1, 1.1], [1, 1.15]], 1.5, color=INK2, alpha=(0.9, 0.75, 0), emissive=1.0, rim="signature",
                       texture="crack", fit=True),
                 light("ground", "signature", 14, 10, 0.55),
                 comment="T4 · Lumen · Domefall landing: a jade core flash (white heart), a whole deep-jade glazed shell slams down, holds a"
                         " beat and splits along glowing jade seams while a course of light runs up it and the windows flare, glazed"
                         " fragments fly out, the team ring is brightest, a dark cracked floor settles"))
    return D
