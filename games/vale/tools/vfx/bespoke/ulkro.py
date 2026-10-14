"""Ulkro · Dart hunter — bespoke VFX (Lumen: bleached-wood darts with dawnglass leaf heads; wind and dust of the run).

Identity: SPEED. Long thin darts (an opaque bone shaft, a glass leaf head, a hard team streak), rings of torn air
shed along the throw, side streaks and kicked dust for every stride. Shapes: a long dart that cracks the air (a1),
a high bound with two glass pips at the landing (a2), a low dart that pins the legs (a3), a sprint-start burst
that fans five glass heads over the quiver (ult), a glass pip that snaps on at the heel (passive) and the small
Long Run darts (passive dart).
"""
from __future__ import annotations

from vfxkit import CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, NOON, WHITE, L, chips, dust, light, shake, vfx

BONE = "#D9CFB8"        # bleached thrower and shafts
BONE_DK = "#9C9384"
GLASS = DAWNGLASS
WIND = "#C9D4DC"        # torn-air streaks


def _dart(scale: float, e: float, streak_w: float, rate: float) -> list:
    """a dart riding the projectile: bone shaft, glass leaf head, a team streak, wind shed behind"""
    return [
        L("mesh", at="path", shape="spike", scale=0.62 * scale, stretch=[0.5, 1.0, 0.5], rotateDeg=[-90, 0, 0], offset=[-0.3 * scale, 0, 0], life=0.5,
          color=[BONE, BONE_DK], alpha=1, emissive=0.5, blend="chip", align="velocity", hold=1),
        L("mesh", at="path", shape="shard", scale=0.5 * scale, stretch=[1.1, 0.7, 1.0], offset=[0.32 * scale, 0, 0], life=0.5, color=[WHITE, GLASS, "team"],
          alpha=1, emissive=e, rim="team", rimPow=2.0, rimEmissive=e, align="velocity", hold=1),
        L("sprite", at="path", offset=[0.32 * scale, 0, 0], follow=True, life=0.6, size=0.7 * scale, color="team", emissive=e * 0.8,
          alpha=[[0, 0], [0.1, 0.8], [1, 0.8]], texture="glow", blend="add", soft=0.2),
        L("ribbon", at="path", color=["team", GLASS], width=[0.0, streak_w], life=0.14, alpha=[0, 0.6], emissive=e, noise=0.2, scroll=3),
        L("emitter", at="path", rate=rate, shape="sphere", radius=0.25, dir="back", spreadDeg=12, speed=[2, 5], life=[0.08, 0.16],
          size=[0.4 * scale, 0.08], color=[WIND, "team"], alpha=[0.7, 0], emissive=min(e, 2.0), drag=3, texture="streak", stretch=0.05, blend="add",
          secondary=True),
    ]


def defs() -> list:
    D = []

    # ── passive · Run-up (a stack: on Ulkro, T1: no decals, emissive ≤ 1.5) ──────────────────────────────────────────
    D.append(vfx("ulkro_passive_runup", 0.45,
                 # a glass leaf head snaps into the fan over the quiver; a puff and a streak at the heel
                 L("mesh", at="target", shape="shard", scale=[[0, 0.0], [0.3, 0.62], [1, 0.52]], stretch=[1.0, 0.7, 1.0], offset=[-0.25, 1.05, 0],
                   life=0.42, color=[GLASS, "team"], alpha=[[0, 1], [0.7, 0.9], [1, 0]], emissive=1.5, rim="team", rimPow=2.0, rimEmissive=1.5,
                   rotateDeg=[-70, 0, 0], align="dir"),
                 L("emitter", at="target", count=4, shape="point", offset=[-0.25, 1.05, 0], dir="random", speed=[0.6, 1.5], life=[0.12, 0.22],
                   size=[0.1, 0.03], color=[WHITE, "team"], alpha=[1, 0], emissive=1.5, texture="glint", blend="add"),
                 L("emitter", at="target", count=5, shape="disc", radius=0.25, offset=[0, -0.95, 0], dir="back", spreadDeg=25, speed=[2.5, 4.5],
                   life=[0.1, 0.18], size=[0.35, 0.08], color="team", alpha=[0.8, 0], emissive=1.5, drag=3, texture="streak", stretch=0.05, blend="add"),
                 [dict(x, offset=[0, -0.95, 0]) for x in dust("target", 2, size=0.5, speed=(0.6, 1.2), radius=0.15, delay=0.0)],
                 comment="T1 · Lumen · Run-up stack: a glass dart head snaps into the fan over her quiver with a glint, a side streak and a puff "
                         "of dust at the heel"))
    D.append(vfx("ulkro_passive_dart", 0.5,
                 _dart(0.75, 1.5, 0.12, 30),
                 comment="T1 · Lumen · Long Run dart: a small bone dart with a glass head and a thin team streak"))

    # ── a1 · Hurl (projectile, 10 m at 30 m/s): the long dart cracks the air ─────────────────────────────────────────
    D.append(vfx("ulkro_a1_hurl", 0.6,
                 L("flash", at="origin", radius=0.6, life=0.05, color="team", intensity=2.6, offset=[0.4, 0.2, 0]),
                 L("shockwave", at="origin", offset=[0.5, 0.2, 0], radius=[[0, 0.15], [1, 0.75]], width=[0.14, 0.03], life=0.2, color=[GLASS, "team"],
                   alpha=[1, 0.6, 0], emissive=2.6, sharp=2.0, mode="vertical"),
                 _dart(1.25, 3.0, 0.26, 60),
                 # rings of torn air shed along the throw
                 [L("shockwave", at="path", delay=d, radius=[[0, 0.12], [1, 0.6]], width=[0.1, 0.02], life=0.22, color=[WIND, "team"],
                    alpha=[0.8, 0.4, 0], emissive=2.0, sharp=1.8, mode="vertical") for d in (0.06, 0.13, 0.2, 0.27)],
                 comment="T2 · Lumen · Hurl: a crack of air at her hand, a long bone dart with a glass leaf head in a team glow, a hard team "
                         "streak and wind lines, rings of torn air shed along the throw"))

    # ── a2 · Bound (dash: a 4 m leap, +2 Run-up stacks) ──────────────────────────────────────────────────────────────
    D.append(vfx("ulkro_a2_bound", 0.9,
                 # take-off: a stamp of dust and chips, a low team ring
                 L("shockwave", at="origin", offset=[0, -0.95, 0], radius=[[0, 0.2], [1, 1.1]], width=[0.22, 0.05], life=0.3, color="team",
                   alpha=[0.9, 0.5, 0], emissive=2.4, sharp=1.8),
                 [dict(x, offset=[0, -0.95, 0]) for x in dust("origin", 6, size=0.9, speed=(1.5, 3.0), radius=0.25, delay=0.0)],
                 [dict(x, offset=[0, -0.95, 0]) for x in chips("origin", 7, speed=(2, 4.5), size=0.11, delay=0.0)],
                 # the leap: a high pale streak, a team ground streak, wind peeling off
                 L("ribbon", at="path", offset=[0, 0.25, 0], color=[BONE, "team"], width=[0.0, 0.38], life=0.24, alpha=[0, 0.65], emissive=2.4, noise=0.3,
                   scroll=3),
                 L("ribbon", at="path", color="team", width=[0.0, 0.8], life=0.3, alpha=[0, 0.45], emissive=2.2, noise=0.5, face="ground"),
                 L("emitter", at="path", bursts=[[0.0, 5], [0.08, 5], [0.16, 5]], shape="sphere", radius=0.35, dir="back", spreadDeg=30, speed=[3, 6],
                   life=[0.1, 0.18], size=[0.45, 0.08], color=[WIND, "team"], alpha=[0.8, 0], emissive=2.4, drag=3, texture="streak", stretch=0.05,
                   blend="add"),
                 # landing (0.25 s): dust ring and two glass pips pop up (the two Run-up stacks)
                 L("shockwave", at="path", delay=0.25, offset=[0, -1.0, 0], radius=[[0, 0.2], [1, 1.0]], width=[0.2, 0.04], life=0.3, color="team",
                   alpha=[0.8, 0.5, 0], emissive=2.2, sharp=1.6),
                 [dict(x, offset=[0, -1.0, 0]) for x in dust("path", 5, size=0.8, speed=(1.0, 2.2), radius=0.25, delay=0.25)],
                 L("emitter", at="path", delay=0.27, count=2, shape="point", offset=[-0.2, 0.9, 0], dir="up", spreadDeg=50, speed=[1.2, 1.8],
                   life=[0.4, 0.5], size=[[0, 0.1], [0.3, 0.32], [1, 0.2]], color=[WHITE, GLASS, "team"], alpha=[1, 1, 0], emissive=3.0, gravity=2,
                   drag=2, texture="shard", align="velocity", aspect=0.45, blend="add"),
                 L("emitter", at="path", delay=0.27, count=6, shape="point", offset=[-0.2, 0.9, 0], dir="random", speed=[0.6, 1.4],
                   life=[0.15, 0.25], size=[0.1, 0.03], color=[WHITE, "team"], alpha=[1, 0], emissive=2.6, texture="glint", blend="add"),
                 comment="T3 · Lumen · Bound: a stamp of dust and chips with a low team ring at take-off, a high pale streak over a team ground "
                         "streak with wind peeling off, a dust ring on landing and two glass pips popping up (the two Run-up stacks)"))

    # ── a3 · Hamstring Dart (hit on the target): a low dart pins the legs ─────────────────────────────────────────────
    D.append(vfx("ulkro_a3_hamstring", 0.8,
                 L("beam", **{"from": "origin"}, to="target", width=0.1, life=0.09, color=["team", GLASS], alpha=[1, 0.8, 0], emissive=3.0, noise=0.05,
                   core=1.8, taper=[0.2, 1.0]),
                 L("flash", at="target", radius=0.5, life=0.05, color="team", intensity=3.0, offset=[0, -0.7, 0]),
                 # the dart stands in the shin, angled down the line of the throw
                 L("mesh", at="target", shape="spike", scale=[[0, 0.5], [0.15, 0.55], [1, 0.55]], stretch=[0.45, 1.0, 0.45], rotateDeg=[105, 0, 0],
                   offset=[-0.35, -0.55, 0], life=0.75, color=[BONE, BONE_DK], alpha=[[0, 1], [0.8, 1], [1, 0]], emissive=0.5, blend="chip", align="dir"),
                 L("mesh", at="target", shape="shard", scale=0.3, offset=[-0.05, -0.62, 0], rotateDeg=[15, 0, 0], life=0.75, color=[GLASS, "team"],
                   alpha=[[0, 1], [0.8, 1], [1, 0]], emissive=2.4, rim="team", rimPow=2.0, rimEmissive=2.4, align="dir"),
                 # the slow: a team ring tightens round the ankles, glass flakes sink; the reveal: a thin shaft of team light
                 L("shockwave", at="target", offset=[0, -1.0, 0], radius=[[0, 1.0], [1, 0.4]], width=[0.08, 0.16], life=0.35, color="team",
                   alpha=[0.4, 1, 0], emissive=2.6, sharp=2.0),
                 L("emitter", at="target", count=10, shape="ring", radius=0.35, offset=[0, -0.6, 0], dir="down", spreadDeg=30, speed=[0.4, 1.0],
                   life=[0.35, 0.6], size=[0.14, 0.05], color=[GLASS, "team"], alpha=[1, 0.8, 0], emissive=2.0, gravity=2, texture="shard",
                   align="velocity", aspect=0.45, blend="add"),
                 L("mesh", at="target", shape="pillar", scale=[[0, 0.3], [0.2, 1.0], [1, 1.0]], stretch=[0.3, 3.2, 0.3], offset=[0, -1.0, 0], life=0.6,
                   color="team", alpha=[[0, 0], [0.15, 0.35], [1, 0]], emissive=1.8, mask="top", maskParam=0.5, noise=0.4, scroll=[0, 1.5], align="up"),
                 L("emitter", at="target", count=8, shape="point", offset=[0, -0.6, 0], dir="forward", spreadDeg=60, speed=[2.5, 5], life=[0.3, 0.5],
                   size=[0.12, 0.12, 0.08], sizeVar=[0.6, 1.3], color=[CHALK, CHALK_DK], alpha=[1, 1, 1, 0], gravity=14, drag=0.8, bounce=0.3,
                   texture="chip", blend="chip", spinDeg=[-540, 540], rim=NOON, rimAlpha=0.4),
                 comment="T2 · Lumen · Hamstring Dart: a hard team line from her hand to the legs, a bone dart with a glass head stands in the shin, "
                         "a team ring tightens round the ankles with glass flakes sinking (the slow), a thin shaft of team light (the reveal)"))

    # ── ult · Long Run (area on herself, T4): the sprint start ────────────────────────────────────────────────────────
    D.append(vfx("ulkro_ult_run", 1.2,
                 L("flash", at="ground", radius=1.0, life=0.1, color="team", intensity=10, core=WHITE, offset=[0, 0.4, 0]),
                 L("shockwave", at="ground", radius=[[0, 0.2], [0.4, 1.3], [1, 1.7]], width=[0.5, 0.08], life=0.45, color=[WHITE, "team"],
                   alpha=[1, 0.8, 0], emissive=10, sharp=2.0, noise=0.3),
                 L("shockwave", at="ground", delay=0.06, offset=[0, 1.0, 0], radius=[[0, 0.3], [1, 1.5]], width=[0.2, 0.04], life=0.35, color="team",
                   alpha=[0.9, 0.5, 0], emissive=6, sharp=2.0, mode="vertical", fit=False),
                 # side streaks tear off backward, dust and chips are kicked back
                 L("emitter", at="ground", count=26, shape="disc", radius=0.4, offset=[0, 0.5, 0], dir="back", spreadDeg=35, speed=[7, 13],
                   life=[0.12, 0.25], size=[0.7, 0.12], color=[WIND, "team"], alpha=[1, 0], emissive=6, drag=3, texture="streak", stretch=0.06,
                   blend="add", fit=False),
                 L("emitter", at="ground", count=10, shape="disc", radius=0.4, dir="back", spreadDeg=35, speed=[2.5, 5], life=[0.5, 0.9],
                   size=[0.6, 1.2, 1.5], color=[DUST, DUST2], alpha=[0, 0.5, 0.3, 0], gravity=-0.2, drag=2.6, texture="dust_puff", blend="alpha",
                   rotDeg=[0, 360], fit=False, secondary=True),
                 [dict(x, fit=False) for x in chips("ground", 12, speed=(2.5, 5), size=0.12, delay=0.02)],
                 # five glass heads fan up over the quiver (help is up) and the air takes a team tint
                 L("emitter", at="ground", count=5, shape="point", offset=[-0.3, 1.9, 0], dir="up", spreadDeg=70, speed=[1.5, 2.2], life=[0.5, 0.6],
                   size=[[0, 0.1], [0.25, 0.42], [1, 0.3]], color=[WHITE, GLASS, "team"], alpha=[1, 1, 0], emissive=8, gravity=3, drag=2.2,
                   texture="shard", align="velocity", aspect=0.42, blend="add", fit=False),
                 L("emitter", at="ground", count=12, shape="disc", radius=0.6, dir="up", spreadDeg=20, speed=[1.5, 3], life=[0.4, 0.7],
                   size=[0, 0.16, 0], color=[GLASS, "team"], alpha=[0, 1, 0], emissive=4, texture="mote", blend="add", fit=False, secondary=True),
                 light("ground", "team", 16, 7, 0.35),
                 shake(0.3),
                 comment="T4 · Lumen · Long Run: a white-core flash at her feet, a team ring and a ring of torn air, side streaks tear off "
                         "backward with dust and chips, five glass heads fan up over the quiver, motes rise (a self-buff is up)"))
    return D
