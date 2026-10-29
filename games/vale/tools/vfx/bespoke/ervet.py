"""Ervet (Breaker · Aubade · the dawnglass greatsword that breaks and reforms): bespoke VFX.

Identity: Lumen glass in three states. Whole: long clean arcs of cold glass light. Broken: a burst and a
field of splinters (opaque glass chunks, twinkling glints, a frosted floor). Great: the blade reforms out of
the splinters at its own size (ervet.md: the blade must not grow). Where Ardit is a pane (flat planes, warm sun, caustics), Ervet is the blade
(arcs, splinters, fracture, cold DAWNGLASS → team). Shards thrown outward are harm; flakes rising are her guard.

Anchors (src/render/director.ts): Heavy Arc, Shatter, Reform and the Whole Again landing are areas at her feet
(`ground`); Glass Guard fires at the cast and tracks her (`caster`); Shard Kick rides each of its three
shards (`path`); Quick Jab and the leap are dashes (`path`; a dash def's instance follows the fighter for as
long as she lives, so those carry NO ribbons, path meshes or path rate-emitters: timed bursts only); the
shard field is a zone that loops (1 s) while it lives.
"""
from __future__ import annotations

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, NOON, WHITE, L, chips, decal, dust, flash, light, mesh, shake, shockwave, vfx)

GLASS = "#B6CEE0"       # the blade
GLASS_DK = "#5D6B7C"    # blued glass in shadow (card secondary)

XF = [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]          # loop crossfade (life = 1.25 × duration)


def _bursts(t0: float, t1: float, step: float, n: int) -> list:
    out, t = [], t0
    while t <= t1 + 1e-6:
        out.append([round(t, 3), n])
        t += step
    return out


def _shards(at: str, n: int, speed=(5, 10), size=0.3, spread=170, dir_: str = "out", gravity: float = 8.0, delay: float = 0.0, shape="sphere",
            radius=0.2, life=(0.3, 0.55), emissive: float = 3.0, fit=None, offset=None, **kw) -> list:
    """Glass splinters: additive, velocity-aligned."""
    return [L("emitter", at=at, offset=offset, count=n, shape=shape, radius=radius, dir=dir_, spreadDeg=spread, speed=list(speed), life=list(life),
              size=[size, size * 0.8, 0], sizeVar=[0.6, 1.4], color=[GLASS, "team"], alpha=[1, 1, 0], emissive=emissive, gravity=gravity,
              drag=1.6, texture="shard", blend="add", align="velocity", aspect=0.45, delay=delay or None, fit=fit, **kw)]


def _chunks(at: str, n: int, speed=(2.5, 6), size=0.18, delay: float = 0.03, offset=None, **kw) -> list:
    """Opaque glass chunks (impacts throw opaque chips): pale glass with a team catch-light."""
    return [L("emitter", at=at, offset=offset, count=n, dir="up", spreadDeg=160, speed=list(speed), life=[0.4, 0.7], size=[size, size, size * 0.6],
              sizeVar=[0.6, 1.3], color=[GLASS, GLASS_DK], alpha=[1, 1, 1, 0], gravity=14, drag=0.8, bounce=0.35, texture="shard", blend="chip",
              spinDeg=[-540, 540], rim="team", rimAlpha=0.7, delay=delay or None, secondary=True, **kw)]


def defs() -> list:
    D = []

    # ── passive · Dawnglass Edge: the blade's edge catches the light (her attacks carry a glass edge) ───────
    D.append(vfx("ervet_passive_edge", 0.5,
                 L("sprite", at="caster", socket="weapon", follow=True, offset=[0.3, 0.2, 0], texture="flare", size=[0.3, 0.8, 0.5], color=[NOON, "team"],
                   emissive=1.5, alpha=[0, 1, 0], life=0.25),
                 L("emitter", at="caster", socket="weapon", offset=[0.3, 0.0, 0], count=5, shape="sphere", radius=0.3, dir="out", spreadDeg=120,
                   speed=[0.6, 1.4], life=[0.2, 0.35], size=[0.12, 0.04], color=[GLASS, "team"], alpha=[1, 0], emissive=1.4, gravity=2,
                   texture="glint", blend="add"),
                 comment="T1 · Lumen · Dawnglass Edge: a sun-glint runs along the blade edge, a few glints fall off it"))

    # ── a1 · Heavy Arc: the whole blade sweeps a 3.5 m, 140° arc at waist height (area cone) ─────────────
    D.append(vfx("ervet_a1_arc", 0.9,
                 # a sheet of cold glass light swept through the air (bright leading edge), the arc's rim flashing
                 mesh("origin", "fan", 2.0, 0.26, color=[[0, WHITE], [0.25, GLASS], [1, "team"]], alpha=(1, 1, 0), emissive=3.0, angle=140,
                      mask="sweep", mask_param=[[0, 0.0], [0.8, 1.05], [1, 1.25]], offset=[0, -0.55, 0], fit=True, noise=0.3, scroll=[0, -2.0]),
                 mesh("origin", "fan", 2.04, 0.3, color=[GLASS, "team"], alpha=(0.0, 0.9, 0), emissive=3.0, angle=140, mask="edge",
                      mask_param=0.97, offset=[0, -0.55, 0], fit=True, delay=0.06),
                 # splinters flung out along the arc; the floor it passed over frosts (the slow)
                 _shards("ground", 18, speed=(5, 9), size=0.28, shape="cone", spread=12, dir_="normal", gravity=4, delay=0.04, offset=[0, 0.6, 0],
                         fit=False, angleDeg=136, length=3.3),
                 L("emitter", at="ground", offset=[0, 0.6, 0], count=14, shape="cone", angleDeg=136, length=3.4, dir="normal", spreadDeg=8,
                   speed=[6, 10], life=[0.1, 0.18], size=[0.45, 0.12], color=[GLASS, "team"], alpha=[1, 0], emissive=3.0, drag=2.5, texture="streak",
                   stretch=0.05, blend="add", fit=False),
                 decal("ground", "frost", [[0, 0.5], [0.12, 1.0], [1, 1.0]], 1.0, color=DAWNGLASS, alpha=(0.6, 0.45, 0), emissive=1.2, rim="team",
                       shape="cone", angle=140, texture="frost", delay=0.05, fit=True),
                 L("emitter", at="ground", offset=[0, 0.25, 0], count=10, shape="cone", angleDeg=130, length=3.4, dir="none", speed=[0, 0],
                   life=[0.3, 0.6], size=[0, 0.24, 0], color=[GLASS, "team"], alpha=[0, 1, 0], emissive=3.0, texture="glint", blend="add", delay=0.12,
                   fit=False, secondary=True),
                 comment="T2 · Lumen · Heavy Arc: the whole blade sweeps the 140° arc as a sheet of cold glass light at waist height "
                         "(bright leading edge, the rim flashing), splinters and streaks thrown out along it, the floor frosts (the slow)"))

    # ── a1 (Hilt) · Quick Jab: a 3 m jab with the stub (dash, 18 m/s) ─────────────────────────────────────
    D.append(vfx("ervet_a1_jab", 0.4,
                 flash(2, at="origin", color=GLASS, scale=0.6, light=False),
                 L("emitter", at="path", offset=[0.7, 0.05, 0], bursts=_bursts(0.0, 0.2, 0.02, 1), shape="point", dir="forward", spreadDeg=4,
                   speed=[9, 12], life=[0.06, 0.09], size=[0.7, 0.3], color=[NOON, GLASS, "team"], alpha=[1, 0], emissive=5.0, drag=1, texture="spark",
                   stretch=0.06, blend="add"),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.2, 0.02, 2), shape="sphere", radius=0.45, dir="back", spreadDeg=15, speed=[4, 7],
                   life=[0.08, 0.15], size=[0.4, 0.1], color=[GLASS, "team"], alpha=[0.9, 0], emissive=4.0, drag=3, texture="streak", stretch=0.06,
                   blend="add"),
                 L("emitter", at="path", offset=[0, -0.95, 0], bursts=_bursts(0.0, 0.2, 0.02, 2), shape="sphere", radius=0.1, dir="back",
                   spreadDeg=4, speed=[2.6, 3.0], life=[0.2, 0.26], size=[0.7, 0.5], color="team", alpha=[0.4, 0], emissive=3.0, texture="glow",
                   blend="add", stretch=0.35),
                 L("emitter", at="path", offset=[0.4, 0.1, 0], bursts=_bursts(0.0, 0.2, 0.04, 1), shape="sphere", radius=0.3, dir="back", spreadDeg=60,
                   speed=[1, 2.5], life=[0.2, 0.35], size=[0.15, 0.05], color=[GLASS, "team"], alpha=[1, 0], emissive=3.0, gravity=4, texture="glint",
                   blend="add"),
                 comment="T3 · Lumen · Quick Jab: a hard needle of glass light thrusts ahead of the stub, short side-streaks and a team "
                         "skid on the ground, glints shed. Timed bursts"))

    # ── a2 · Glass Guard: the blade planted as a pale wall, a glass shell wraps her for 2 s (cast) ─────────
    D.append(vfx("ervet_a2_guard", 2.1,
                 flash(2, at="caster", color=GLASS, scale=0.8),
                 mesh("caster", "blade", [[0, 1.0], [0.06, 2.3], [1, 2.3]], 2.0, color=[GLASS, "team"], alpha=[[0, 0], [0.04, 0.75], [0.85, 0.45], [1, 0]],
                      emissive=2.6, rim="team", rim_emissive=2.0, rotate=[-90, 0, 0], stretch=[3.0, 1, 1], offset=[0.75, -0.05, 0], follow=True, hold=1,
                      noise=0.35, scroll=[0, 0.6]),
                 mesh("caster", "orb", [[0, 0.8], [0.06, 2.25], [0.12, 2.1], [1, 2.1]], 2.0, color=[GLASS, "team"],
                      alpha=[[0, 0], [0.05, 0.9], [0.85, 0.75], [1, 0]], emissive=0.12, rim="team", rim_pow=2.4, rim_emissive=3.0, stretch=[1, 1.15, 1],
                      offset=[0, -0.05, 0], follow=True, hold=1, noise=0.55, noise_scale=3.5, scroll=[0.1, 0.25]),
                 shockwave("caster", radius=(0.3, 1.1), width=(0.16, 0.05), life=0.3, emissive=2.6),
                 decal("ground", "frost", [[0, 0.4], [0.06, 1.05], [1, 1.05]], 2.0, color=DAWNGLASS, alpha=[[0, 0.6], [0.8, 0.45], [1, 0]], emissive=1.2,
                       rim="team", texture="frost", fit=False),
                 L("emitter", at="caster", follow=True, offset=[0, -1.0, 0], rate=10, duration=1.8, shape="ring", radius=0.8, dir="up", spreadDeg=10,
                   speed=[0.8, 1.6], life=[0.5, 0.8], size=[0.15, 0.05], color=[GLASS, "team"], alpha=[0, 1, 0], emissive=2.4, texture="shard",
                   blend="add", align="velocity", aspect=0.45),
                 # the shell breaks when it ends
                 _shards("caster", 12, speed=(2.5, 5), size=0.2, dir_="out", gravity=6, delay=1.95, radius=0.9, life=(0.25, 0.45), emissive=2.6),
                 comment="T2 · Lumen · Glass Guard: the blade stands planted before her as a pale wall and a cold glass shell wraps her "
                         "(team fresnel rim), the floor frosts, glass flakes rise (help is up); the shell splinters when it ends"))

    # ── a2 (Hilt) · Shard Kick: one of three kicked shards (projectile, 20 m/s, 6 m) ──────────────────────
    D.append(vfx("ervet_a2_kick", 0.5,
                 mesh("path", "shard", 0.5, 0.5, color=[GLASS, "team"], alpha=1, emissive=3.0, rim="team", rim_pow=1.5, rim_emissive=3.0,
                      align="velocity", stretch=[0.9, 0.9, 1.4], spin=1080, rotate=[0, 0, 0], hold=1, noise=0.3),
                 L("ribbon", at="path", color=[GLASS, "team"], width=[0, 0.2], life=0.12, alpha=[0, 0.5], emissive=2.4, noise=0.3),
                 L("emitter", at="path", rate=40, shape="sphere", radius=0.12, dir="back", spreadDeg=50, speed=[0.5, 1.5], life=[0.15, 0.3],
                   size=[0.14, 0.04], color=[GLASS, "team"], alpha=[1, 0], emissive=3.0, gravity=3, texture="glint", blend="add", secondary=True),
                 comment="T2 · Lumen · Shard Kick: a tumbling splinter of the blade (glass with a team rim), a thin streak, glints shed"))

    # ── a3 · Shatter: the blade smashed into the ground and broken, 3 m (area) ────────────────────────────
    D.append(vfx("ervet_a3_smash", 1.0,
                 flash(2, at="ground", color=GLASS, scale=1.5),
                 mesh("origin", "blade", 2.2, 0.3, color=[[0, WHITE], [0.4, GLASS], [1, "team"]], alpha=(1, 0.9, 0), emissive=3.0, rim="team",
                      rotate=[-90, 0, 0], stretch=[3.2, 1, 1], offset=[0.8, -0.1, 0], dissolve=[[0, 0], [0.3, 0.15], [1, 1]], edge=GLASS,
                      edge_emissive=3.0, noise=0.5, noise_scale=3.0),
                 shockwave("ground", radius=(0.15, 1.0), width=(0.45, 0.08), life=0.3, emissive=3.0, sharp=2.2, fit=True),
                 shockwave("ground", color=GLASS, radius=(0.1, 0.8), width=(0.2, 0.05), life=0.38, emissive=2.4, delay=0.05, alpha=(0.8, 0.5, 0), fit=True),
                 decal("ground", "frost", [[0, 0.3], [0.1, 0.95], [1, 1.0]], 1.0, color=DAWNGLASS, alpha=(0.7, 0.5, 0), emissive=1.5, rim="team",
                       texture="frost", fit=True),
                 decal("ground", "crack", [[0, 0.2], [0.1, 0.4], [1, 0.4]], 1.0, color="#2A2C33", alpha=(0.9, 0.7, 0), emissive=1.5, rim="team",
                       fit=True, delay=0.02),
                 _shards("ground", 26, speed=(6, 11), size=0.34, spread=60, dir_="out", gravity=9, shape="ring", radius=0.35, offset=[0.8, 0.3, 0],
                         fit=False),
                 _shards("ground", 10, speed=(5, 8), size=0.26, spread=30, dir_="up", gravity=12, offset=[0.8, 0.3, 0], fit=False),
                 _chunks("ground", 14, speed=(3, 7), offset=[0.8, 0.2, 0]),
                 dust("ground", 6, size=0.9, speed=(2, 3.5), radius=0.4),
                 light("ground", "team", 10, 6, 0.3),
                 shake(0.3),
                 comment="T2 · Lumen · Shatter: the whole blade comes down and breaks: a white-glass blade flashes and dissolves into "
                         "splinters, a burst of glass shards and opaque glass chunks out to 3 m under a team edge ring, the floor frosts and cracks"))

    # ── a3 · Shatter, the shard field: splinters lying in a 3 m frosted circle for 2 s (zone loop) ─────────
    D.append(vfx("ervet_a3_shatter", 1.0,
                 decal("ground", "light", 1.0, 1.25, color=[DAWNGLASS, DAWNGLASS], alpha=[[0, 0], [0.2, 0.5], [0.8, 0.5], [1, 0]], emissive=1.1,
                       texture="frost", fit=True),
                 shockwave("ground", radius=(1.0, 1.0), width=(0.1, 0.1), life=1.25, emissive=3.0, alpha=XF, sharp=2.5, noise=0.4, fit=True),
                 L("emitter", at="ground", rate=26, shape="disc", radius=2.85, dir="none", speed=[0, 0], life=[0.7, 1.1], size=[0, 0.3, 0.3, 0],
                   sizeVar=[0.6, 1.4], color=[GLASS, GLASS_DK], alpha=[0, 1, 1, 0], texture="shard", blend="chip", align="ground", rotDeg=[0, 360],
                   rim="team", rimAlpha=0.8, fit=False),
                 L("emitter", at="ground", offset=[0, 0.15, 0], rate=14, shape="disc", radius=2.7, dir="up", spreadDeg=5, speed=[0, 0.05],
                   life=[0.6, 1.0], size=[0, 0.32, 0.3, 0], color=[GLASS, "team"], alpha=[0, 0.8, 0.8, 0], emissive=3.0, texture="shard",
                   blend="add", align="axis", aspect=0.4, fit=False),
                 L("emitter", at="ground", offset=[0, 0.3, 0], rate=20, shape="disc", radius=2.8, dir="none", speed=[0, 0], life=[0.4, 0.7],
                   size=[0, 0.26, 0], color=[NOON, GLASS, "team"], alpha=[0, 1, 0], emissive=4.0, orbitDeg=35, texture="glint", blend="add", fit=False),
                 comment="T3 · Lumen · Shatter shard field (zone loop): a frosted glass floor, opaque splinters lying in it with team "
                         "catch-lights, a few standing glass slivers, glints drifting slowly round (control), a thin team edge at 3 m"))

    # ── a3 (Hilt) · Reform: the splinters fly home and the blade is whole again, 2 m (area) ────────────────
    D.append(vfx("ervet_a3_reform", 0.9,
                 _shards("ground", 22, speed=(6, 8), size=0.28, spread=8, dir_="in", gravity=0, shape="ring", radius=2.2, life=(0.24, 0.3),
                         offset=[0, 0.5, 0], fit=False),
                 mesh("origin", "blade", 2.2, 0.45, color=[[0, GLASS], [0.4, "team"], [1, "team"]], alpha=[[0, 0], [0.4, 1], [1, 0]], emissive=3.0,
                      rim="team", rotate=[-90, 0, 0], stretch=[3.0, 1, 1], offset=[0.3, 0.0, 0], dissolve=[[0, 1], [0.5, 0.0], [1, 0.4]], edge=NOON,
                      edge_emissive=3.0, noise=0.5, noise_scale=3.0),
                 flash(2, at="ground", color=GLASS, scale=1.1, delay=0.24),
                 shockwave("ground", radius=(0.15, 1.0), width=(0.35, 0.07), life=0.3, emissive=3.0, delay=0.24, fit=True),
                 L("emitter", at="origin", count=12, shape="sphere", radius=0.4, dir="out", spreadDeg=170, speed=[2, 5], life=[0.2, 0.4],
                   size=[0.2, 0.05], color=[GLASS, "team"], alpha=[1, 0], emissive=3.0, drag=2, texture="glint", blend="add", delay=0.26),
                 comment="T2 · Lumen · Reform: splinters fly home from 2 m, the blade condenses out of them (dissolve in reverse, a pale "
                         "edge), then a flash and a team ring to 2 m as it is whole"))

    # ── ult · Whole Again, the leap (dash 6 m at 14 m/s) ──────────────────────────────────────────────────
    D.append(vfx("ervet_ult_leap", 0.6,
                 flash(3, at="ground", color=GLASS, scale=0.7),
                 dust("ground", 9, size=1.1, speed=(1.8, 3.2), radius=0.4, delay=0.0),
                 _chunks("ground", 8, speed=(2.5, 5), delay=0.0),
                 shockwave("ground", radius=(0.3, 1.4), width=(0.3, 0.06), life=0.3, emissive=3.0, fit=False),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.5, 0.02, 2), shape="sphere", radius=0.1, dir="back", spreadDeg=4, speed=[2.6, 3.0],
                   life=[0.18, 0.24], size=[0.8, 0.4], color=[GLASS, "team"], alpha=[0.5, 0], emissive=4.0, texture="glow", blend="add", stretch=0.35),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.5, 0.03, 2), shape="sphere", radius=0.6, dir="back", spreadDeg=40, speed=[1, 3],
                   life=[0.3, 0.5], size=[0.26, 0.2, 0], color=[GLASS, "team"], alpha=[1, 1, 0], emissive=3.0, gravity=6, drag=1.2, texture="shard",
                   blend="add", align="velocity", aspect=0.45),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.5, 0.025, 1), shape="sphere", radius=0.5, dir="back", spreadDeg=20, speed=[3, 6],
                   life=[0.1, 0.2], size=[0.5, 0.12], color="team", alpha=[0.9, 0], emissive=4.0, drag=3, texture="streak", stretch=0.06, blend="add"),
                 comment="T3 · Lumen · Whole Again leap: launch flash, dust, glass chunks and a ring; a glass-light streak along the arc "
                         "sheds splinters and side-streaks. Timed bursts"))

    # ── ult · Whole Again, the landing: the blade reforms whole at its own size, 3.5 m (area, T4) ──────────
    # the glass blade ghost is her blade's own length (1.31 m; scale 1.3 x stretch 0.52 = ~0.15 m wide), never larger
    # (integration run 2: the oversized 3.4 m ghost read as the cut 'oversized blade')
    D.append(vfx("ervet_ult_whole", 1.5,
                 flash(4, at="ground", scale=1.7),
                 mesh("origin", "blade", [[0, 1.0], [0.15, 1.28], [1, 1.32]], 0.6, color=[[0, WHITE], [0.3, GLASS], [1, "team"]], alpha=[[0, 1], [0.6, 0.9], [1, 0]],
                      emissive=12, rim="team", rim_emissive=6.0, rotate=[-90, 0, 0], stretch=[0.52, 1, 1], offset=[0.6, 0.68, 0],
                      dissolve=[[0, 0], [0.55, 0.05], [1, 1]], edge="team", edge_emissive=8.0, noise=0.4, noise_scale=3.0),
                 shockwave("ground", radius=(0.15, 1.0), width=(0.7, 0.12), life=0.4, emissive=10, sharp=2.2, fit=True),
                 shockwave("ground", color=GLASS, radius=(0.1, 0.85), width=(0.35, 0.06), life=0.55, emissive=6.0, delay=0.08, alpha=(0.8, 0.5, 0), fit=True),
                 shockwave("origin", radius=(0.3, 2.2), width=(0.3, 0.06), life=0.3, emissive=8.0, vertical=True, alpha=(0.9, 0.5, 0)),
                 decal("ground", "frost", [[0, 0.3], [0.1, 0.95], [1, 1.0]], 1.4, color=DAWNGLASS, alpha=(0.8, 0.6, 0), emissive=2.5, rim="team",
                       texture="frost", fit=True),
                 decal("ground", "crack", [[0, 0.2], [0.1, 0.5], [1, 0.5]], 1.4, color="#2A2C33", alpha=(0.95, 0.75, 0), emissive=3.0, rim="team", fit=True),
                 _shards("ground", 34, speed=(8, 14), size=0.34, spread=50, dir_="out", gravity=7, shape="ring", radius=0.5, offset=[0, 0.3, 0],
                         emissive=8.0, fit=False),
                 _shards("ground", 14, speed=(6, 10), size=0.3, spread=35, dir_="up", gravity=12, offset=[0, 0.3, 0], emissive=6.0, fit=False),
                 _chunks("ground", 16, speed=(4, 8), size=0.2),
                 dust("ground", 12, size=1.4, speed=(2.5, 4.5), radius=0.8, delay=0.12),
                 light("ground", "team", 26, 10, 0.5),
                 shake(0.7),
                 comment="T4 · Lumen · Whole Again landing: a white core, her blade slams down whole at its own size (white-hot glass to team, "
                         "dissolving at its edge), a team ring to 3.5 m and an upright ring burst, a storm of splinters and glass chunks, "
                         "the floor frosts and cracks, dust settles"))

    # ── ult · Whole Again, the landing as re-keyed (W4): she calls every shard home from 4.5 m (area, T4) ──────────
    # the shards fly IN along straight lines from the 4.5 m ring to her hilt (the pull: enemies are dragged 2 m toward
    # her) and the blade is whole there; the old outward storm would read as a push
    D.append(vfx("ervet_ult_shards_home", 1.5,
                 flash(4, at="ground", scale=1.5),
                 # the lines home: streaks from the ring to the hilt (a ring of 4.4 m, 15 m/s for 0.29 s: they meet at the hilt)
                 L("emitter", at="ground", count=28, shape="ring", radius=4.4, offset=[0, 0.9, 0], dir="in", spreadDeg=0, speed=[15, 15],
                   life=[0.29, 0.29], size=[0.6, 0.45, 0.2], color=[GLASS, "team"], alpha=[0.0, 0.9, 1, 0.6], emissive=6.0, drag=0, texture="streak",
                   stretch=0.08, blend="add", align="velocity", fit=False),
                 _shards("ground", 32, speed=(14.5, 15.5), size=0.34, spread=3, dir_="in", gravity=0, shape="ring", radius=4.4, life=(0.28, 0.3),
                         offset=[0, 0.9, 0], emissive=7.0, fit=False),
                 L("decal", at="ground", shape="line", style="light", length=4.5, width=0.12, radius=1.0, life=0.5, color=GLASS,
                   alpha=[0.6, 0.4, 0], emissive=2.0, fit=True, secondary=True),
                 # whole again at the hilt as they arrive
                 mesh("origin", "blade", [[0, 1.0], [0.15, 1.26], [1, 1.3]], 0.6, color=[[0, WHITE], [0.3, GLASS], [1, "team"]],
                      alpha=[[0, 0], [0.2, 0], [0.32, 1], [0.7, 0.9], [1, 0]], emissive=12, rim="team", rim_emissive=6.0, rotate=[-90, 0, 0],
                      stretch=[0.52, 1, 1], offset=[0.6, 0.68, 0], dissolve=[[0, 1], [0.32, 0.05], [0.7, 0.05], [1, 1]], edge="team",
                      edge_emissive=8.0, noise=0.4, noise_scale=3.0),
                 flash(3, at="origin", color=GLASS, scale=0.9, delay=0.3, light=False),
                 # the edge the shards came from, then the ring closing in behind them (the pull)
                 L("shockwave", at="ground", radius=[[0, 1.0], [0.6, 0.55], [1, 0.45]], width=[0.12, 0.3], life=0.42, color=[GLASS, "team"],
                   alpha=[1, 0.8, 0], emissive=6.0, sharp=2.2, fit=True),
                 shockwave("ground", radius=(0.15, 1.0), width=(0.5, 0.1), life=0.35, emissive=8.0, sharp=2.2, delay=0.3, fit=True),
                 decal("ground", "frost", [[0, 0.3], [0.1, 0.95], [1, 1.0]], 1.4, color=DAWNGLASS, alpha=(0.75, 0.6, 0), emissive=2.5, rim="team",
                       texture="frost", fit=True),
                 L("emitter", at="origin", count=14, shape="sphere", radius=0.4, offset=[0, 0.9, 0], dir="out", spreadDeg=170, speed=[2, 5],
                   life=[0.2, 0.4], size=[0.2, 0.05], color=[GLASS, "team"], alpha=[1, 0], emissive=4.0, drag=2, texture="glint", blend="add", delay=0.3),
                 dust("ground", 10, size=1.3, speed=(1.5, 3.5), radius=0.8, delay=0.1),
                 light("ground", "team", 24, 10, 0.5),
                 comment="T4 · Lumen · Whole Again (re-keyed): a white core, then every shard flies home along straight lines from the "
                         "4.5 m ring into her hilt (the pull), her blade condenses whole at its own size as they arrive, a ring closes in behind "
                         "them, the floor frosts"))

    # ── passive · Dawnglass Edge: a lodged shard torn out, bursting 1.75 m round the target (area at the hit, T2) ─────
    D.append(vfx("ervet_passive_tear", 0.8,
                 flash(2, at="ground", color=GLASS, scale=0.9),
                 mesh("ground", "shard", [[0, 0.5], [1, 0.7]], 0.3, color=[NOON, GLASS], alpha=[[0, 1], [0.6, 1], [1, 0]], emissive=3.0, rim="team",
                      rim_pow=1.6, rim_emissive=3.0, offset=[0, 0.9, 0], rotate=[-70, 0, 0], dissolve=[[0, 0], [0.5, 0], [1, 1]], edge="team",
                      edge_emissive=3.0),
                 _shards("ground", 16, speed=(5, 8), size=0.26, spread=40, dir_="out", gravity=6, shape="ring", radius=0.3, offset=[0, 0.8, 0],
                         life=(0.22, 0.32), emissive=3.0, fit=False),
                 shockwave("ground", radius=(0.2, 1.0), width=(0.3, 0.06), life=0.3, emissive=3.0, fit=True),
                 _chunks("ground", 6, speed=(2, 4), size=0.14, offset=[0, 0.8, 0]),
                 decal("ground", "frost", [[0, 0.4], [0.15, 1.0], [1, 1.0]], 0.8, color=DAWNGLASS, alpha=(0.5, 0.4, 0), emissive=1.2, rim="team",
                       texture="frost", fit=True),
                 comment="T2 · Lumen · Shard torn out: the lodged dawnglass shard rips out of the target and flies up, it bursts into "
                         "splinters to 1.75 m under a team ring, a frosted mark"))
    return D
