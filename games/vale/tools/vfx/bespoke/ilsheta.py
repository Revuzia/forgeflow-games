"""Ilsheta (Tender, lamp hanger): bespoke ability VFX.

Identity: lamplight. A dawnglass lamp with a warm wick-light core, glass that glints and rings,
pools of light on the ground, motes that rise (help is up). Lumen only, no ink. The team colour is
the rim and the edge of every pool; the warm lamp core is the fighter's own note, kept small.
"""
from __future__ import annotations

from vfxkit import (DAWNGLASS, NOON, SAP, L, chips, decal, flash, glow, light, mesh, motes, ribbon, shake, shards, shockwave, sparks,
                    streaks, vfx)

LAMP = "#F7EBD0"        # warm wick-light (pale; never a large area)
LAMP_HOT = "#FFF4DE"    # T4 core warmth (turns Dawnglass below T4)
GLASS = DAWNGLASS


def xfade(peak: float, life: float, dur: float) -> list:
    """alpha keys for a zone loop: the old copy fades out exactly while the next one fades in."""
    o = max(0.02, (life - dur) / life)
    return [[0, 0], [o, peak], [1 - o, peak], [1, 0]]


def lamp(at: str, life: float, dur: float, up: float, size: float, e: float) -> list:
    """a hanging lamp: a glass bead with a warm core, a team rim and a soft halo"""
    return (mesh(at, "orb", size, life, color=[LAMP], alpha=xfade(1.0, life, dur), emissive=e, rim="team", rim_pow=1.4, rim_emissive=e,
                 noise=0.35, scroll=[0, 0.8], offset=[0, up, 0], fit=False)
            + glow(at, "team", size * 3.2, life, e * 0.5, alpha=xfade(0.7, life, dur), offset=[0, up, 0], soft=0.1)
            + glow(at, LAMP, size * 1.6, life, e * 0.8, alpha=xfade(0.9, life, dur), offset=[0, up, 0], soft=0.1))


def defs() -> list:
    D = []

    # ── passive · Warm Hands (heals on a crowd-controlled ally run warm and quicken them; T1) ─────
    D.append(vfx("ilsheta_passive_warm", 0.7,
                 glow("target", LAMP, 0.9, 0.35, 1.5, alpha=(0, 1, 0.5, 0), soft=0.1),
                 shockwave("target", color=[LAMP, "team"], radius=(0.2, 0.75), width=(0.14, 0.04), life=0.4, emissive=1.5, sharp=1.8),
                 motes("target", 9, color=[LAMP, "team"], rise=1.8, life=(0.4, 0.65), size=0.16, radius=0.35, emissive=1.5),
                 L("emitter", at="target", count=6, shape="disc", radius=0.3, dir="back", spreadDeg=20, speed=[3, 5], life=[0.1, 0.2],
                   size=[0.35, 0.08], color="team", alpha=[0.9, 0], emissive=1.5, drag=3, texture="streak", stretch=0.06, blend="add",
                   offset=[0, -0.8, 0], delay=0.15),
                 comment="T1 · Lumen · Warm Hands: a warm glow on the eased ally, a small ring of lamplight at their feet, warm motes rise"
                         " (help is up), a few side streaks for the haste"))

    # ── a1 · Glint Bolt (projectile 18 m/s, 9 m; T2) ─────────────────────────────────────────────
    D.append(vfx("ilsheta_a1_glint", 0.6,
                 flash(2, at="origin", color=LAMP, scale=0.7),
                 # the bead: a round glass drop with a warm core and a team rim, a turning cross-glint on it
                 mesh("path", "orb", 0.34, 0.6, color=[LAMP, GLASS], alpha=1, emissive=3.0, rim="team", rim_pow=1.3, rim_emissive=3.0,
                      noise=0.3, scroll=[0, 2], hold=1),
                 [L("sprite", at="path", follow=True, texture="flare", size=[1.0, 1.0], color=["team"], emissive=2.6, alpha=[0.9, 1, 0.9],
                    life=0.6, spinDeg=[220, 220], soft=0.05)],
                 glow("path", "team", 0.9, 0.6, 2.0, alpha=(0.8, 0.8, 0.8, 0.5), follow=True),
                 ribbon("path", "team", width=(0.0, 0.22), life=0.14, alpha=(0, 0.5), emissive=2.4, noise=0.2),
                 ribbon("path", GLASS, width=(0.0, 0.07), life=0.1, alpha=(0, 0.8), emissive=2.6, noise=0.1),
                 # glass flakes shed and SINK behind it (the slow: down is harm)
                 L("emitter", at="path", rate=34, shape="sphere", radius=0.12, dir="down", spreadDeg=50, speed=[0.4, 1.2], life=[0.3, 0.55],
                   size=[0.1, 0.07, 0], sizeVar=[0.6, 1.4], color=[GLASS, "team"], alpha=[1, 0.8, 0], emissive=2.2, gravity=4, drag=1.5,
                   texture="shard", blend="add", align="velocity", aspect=0.45, spinDeg=[-200, 200], secondary=True),
                 comment="T2 · Lumen · Glint Bolt: a round glass bead with a warm core and a team rim, a turning cross-glint on it, a fine"
                         " streak, glass flakes shed that sink (the slow; down is harm)"))

    # ── a2 · Hung Lamp (zone circle 3, follows the bearer, 4 s; loops 0.5 s; T3) ──────────────────
    LIFE, DUR = 0.58, 0.5
    D.append(vfx("ilsheta_a2_lamp", DUR,
                 lamp("ground", LIFE, DUR, 2.9, 0.34, 3.0),
                 # the lampshade of light: a faint cone from the lamp down to the 3 m pool
                 mesh("ground", "cone", 2.0, LIFE, color=[LAMP], alpha=xfade(0.1, LIFE, DUR), emissive=0.8, rim="team", rim_pow=2.4,
                      rim_emissive=1.4, mask="band", mask_param=0.12, noise=0.55, scroll=[0, -0.8], stretch=[1, 0.48, 1], fit=True),
                 decal("ground", "light", 1.0, LIFE, color=LAMP, alpha=xfade(0.5, LIFE, DUR), emissive=0.9, texture="caustic"),
                 shockwave("ground", color="team", radius=(1.0, 1.0), width=(0.08, 0.08), life=LIFE, emissive=2.6, alpha=xfade(0.85, LIFE, DUR),
                           sharp=2.2, noise=0.2),
                 motes("ground", 0, color=[LAMP, "team"], rate=10, rise=1.3, life=(0.6, 0.9), size=0.17, radius=0.75, emissive=2.0),
                 L("emitter", at="ground", rate=4, shape="disc", radius=0.4, dir="up", spreadDeg=15, speed=[0.8, 1.4], life=[0.5, 0.8],
                   size=[0, 0.16, 0], color=[SAP, "#CFF2D9"], alpha=[0, 0.8, 0], emissive=1.4, texture="petal", blend="add", spinDeg=[-90, 90],
                   secondary=True),
                 light("ground", LAMP, 3, 5, LIFE),
                 comment="T3 · Lumen · Hung Lamp (loop, follows the bearer): a glass lamp with a warm core hangs over them, a faint lampshade"
                         " cone of light down to a 3 m caustic pool with a team edge, motes and a few Sap petals rising (help is up)"))

    # ── a3 · Dawnglass Shell: the kindle at Ilsheta (cast, castTime 0; T2) ────────────────────────
    D.append(vfx("ilsheta_a3_kindle", 0.5,
                 flash(2, at="origin", color=LAMP, scale=0.8),
                 [L("sprite", at="origin", texture="flare", size=[1.7, 1.7], color=[GLASS, "team"], emissive=3.0, alpha=[1, 0], life=0.25,
                    offset=[0.25, 0.05, 0], spinDeg=[160, 160], soft=0.05)],
                 L("emitter", at="origin", count=14, offset=[0.25, 0, 0], shape="sphere", radius=0.1, dir="forward", spreadDeg=30, speed=[5, 9],
                   life=[0.18, 0.32], size=[0.2, 0.14, 0], sizeVar=[0.6, 1.3], color=[GLASS, "team"], alpha=[1, 1, 0], emissive=3.0, drag=2.5,
                   texture="shard", blend="add", align="velocity", aspect=0.45),
                 shockwave("ground", color="team", radius=(0.2, 0.8), width=(0.12, 0.03), life=0.3, emissive=2.4, fit=False),
                 comment="T2 · Lumen · Dawnglass Shell cast: the lamp kindles (a turning cross-glint), panes of glass fly toward the ally"))

    # ── a3 · Dawnglass Shell: the shell on the ally (hit on the ally target; T2) ────────────────
    D.append(vfx("ilsheta_a3_shell", 0.9,
                 L("beam", **{"from": "origin"}, to="target", color=[GLASS, "team"], width=0.16, life=0.3, emissive=2.6, noise=0.0,
                   core=1.4, alpha=[1, 0.8, 0], taper=[0.4, 1]),
                 # glass panes fly in from all sides and close into a faceted shell
                 L("emitter", at="target", count=16, shape="sphere", radius=1.1, surface=True, dir="in", spreadDeg=6, speed=[3.2, 4.2],
                   life=[0.2, 0.26], size=[0.22, 0.2, 0.1], color=[GLASS, "team"], alpha=[0.6, 1, 0.3], emissive=2.8, drag=0.5,
                   texture="shard", blend="add", align="velocity", aspect=0.5),
                 mesh("target", "orb", [[0, 0.4], [0.25, 0.4], [0.4, 1.7], [1, 1.65]], 0.9, color=GLASS, alpha=[[0, 0], [0.3, 0], [0.42, 0.32],
                      [0.7, 0.18], [1, 0]], emissive=1.2, rim="team", rim_pow=2.2, rim_emissive=3.0, noise=0.5, noise_scale=1.6, scroll=[0, 0.4],
                      fit=False),
                 flash(2, at="target", color=GLASS, scale=0.9, delay=0.22),
                 L("emitter", at="target", count=12, delay=0.24, shape="ring", radius=0.55, dir="up", spreadDeg=10, speed=[1.2, 2.2],
                   life=[0.35, 0.6], size=[0.13, 0.04], color=[GLASS, "team"], alpha=[0, 1, 0], emissive=2.2, texture="shard", blend="add",
                   offset=[0, -0.85, 0]),
                 streaks("target", 6, speed=(3, 5), life=(0.1, 0.2), size=0.4, spread=20, dir_="back", emissive=2.2, delay=0.3),
                 comment="T2 · Lumen · Dawnglass Shell lands: a glass thread from her lamp, panes fly in and close into a faceted shell with a"
                         " team rim, flakes rise (help is up), a few side streaks for the haste"))

    # ── ult · Every Window Lit: the dawn (area circle 9 at self, allies; T4) ──────────────────────
    D.append(vfx("ilsheta_ult_dawn", 1.6,
                 flash(4, at="origin", color=LAMP_HOT, scale=1.3),
                 # the lamp at her chest becomes a short sun: a column of light stands up through her (help is up)
                 mesh("origin", "column", [[0, 0.3], [0.2, 1.2], [1, 1.0]], 1.0, color=[LAMP_HOT, "team"], alpha=[[0, 0.9], [0.4, 0.5], [1, 0]],
                      emissive=8, mask="top", mask_param=0.5, stretch=[0.6, 3.4, 0.6], rim="team", rim_pow=1.5, rim_emissive=6, offset=[0, -1.0, 0], noise=0.4, scroll=[0, 2.4],
                      fit=False),
                 # dawn rolls out across all 9 m: a team edge brightest, a warm wash behind it
                 shockwave("ground", color=["team"], radius=(0.04, 1.0), width=(0.5, 0.18), life=0.75, emissive=8, sharp=1.8, noise=0.3),
                 shockwave("ground", color=[LAMP, "team"], radius=(0.03, 0.85), width=(0.9, 0.3), life=0.95, emissive=2.5, alpha=(0.7, 0.4, 0),
                           delay=0.08, noise=0.5),
                 decal("ground", "light", [[0, 0.1], [0.45, 1.0], [1, 1.0]], 1.5, color=LAMP, alpha=(0.5, 0.35, 0), emissive=1.2, texture="caustic"),
                 L("emitter", at="ground", count=46, delay=0.1, shape="disc", radius=0.95, dir="up", spreadDeg=12, speed=[0.3, 0.6],
                   life=[0.7, 1.2], size=[0, 0.1, 0.07, 0], color=[LAMP, "team"], alpha=[0, 1, 0.8, 0], emissive=3.0, gravity=-0.4, drag=0.8,
                   turbulence=0.6, texture="mote", blend="add", secondary=True),
                 motes("origin", 18, color=[LAMP, "team"], rise=3.2, life=(0.6, 1.0), size=0.2, radius=0.6, emissive=4.0),
                 light("origin", LAMP, 22, 12, 0.8),
                 shake(0.3),
                 comment="T4 · Lumen · Every Window Lit: white core flash at her lamp, a column of light stands up through her (help is up),"
                         " dawn rolls out across all 9 m with the team edge brightest and a warm wash behind it, motes lift everywhere"))

    # ── ult · Every Window Lit: a lamp on each ally (zone circle 2.5, follows, 5 s; loops 0.5 s; T3) ──
    LIFE, DUR = 0.58, 0.5
    D.append(vfx("ilsheta_ult_lamps", DUR,
                 lamp("ground", LIFE, DUR, 2.95, 0.4, 4.0),
                 # a lit window: a narrow shaft of light standing up through the bearer from a bright pool
                 mesh("ground", "pillar", 0.36, LIFE, color=[LAMP, "team"], alpha=xfade(0.24, LIFE, DUR), emissive=2.4, mask="top", mask_param=0.6,
                      stretch=[1, 9.0, 1], noise=0.5, scroll=[0, 1.6], rim="team", rim_pow=1.6, rim_emissive=2.4, fit=True),
                 decal("ground", "light", 1.0, LIFE, color=LAMP, alpha=xfade(0.6, LIFE, DUR), emissive=1.2, texture="caustic"),
                 shockwave("ground", color="team", radius=(1.0, 1.0), width=(0.1, 0.1), life=LIFE, emissive=3.5, alpha=xfade(1.0, LIFE, DUR),
                           sharp=2.2, noise=0.2),
                 L("emitter", at="ground", rate=14, shape="ring", radius=0.95, dir="up", spreadDeg=8, speed=[1.0, 1.8], life=[0.4, 0.7],
                   size=[0, 0.14, 0], color=[LAMP, "team"], alpha=[0, 1, 0], emissive=2.4, texture="mote", blend="add"),
                 motes("ground", 0, color=[LAMP, "team"], rate=12, rise=2.4, life=(0.5, 0.8), size=0.18, radius=0.4, emissive=2.6),
                 light("ground", LAMP, 4, 5, LIFE),
                 comment="T3 · Lumen · Every Window Lit (loop on each ally): a brighter lamp over them, a lit-window shaft of light standing up"
                         " through them from a caustic pool, a team edge with motes climbing it (help is up)"))
    return D
