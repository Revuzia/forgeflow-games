"""Ardit (Plinth · Aubade · the dawnglass pavise): bespoke VFX.

Identity: Lumen. A tall pane of dawnglass that catches the low sun. Panes and planes, glare thrown flat across
the ground, caustic light pools, glass that crazes underfoot. Chalk-warm sunlight (CHALK) into cool glass
(DAWNGLASS) into the relationship colour (team) at every danger edge. No ink: Ardit is all light.

Anchors (src/render/director.ts): the dash rides the fighter (`path`; a dash def's instance follows the fighter
for as long as he lives, so it carries NO ribbons, path meshes or path rate-emitters: the trail is made of
timed bursts); Glare and Spire Strike are areas at his feet (`ground`, scale = the area radius); Muster is a
zone that loops (1 s) while it lives.
"""
from __future__ import annotations

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, NOON, WHITE, L, chips, decal, dust, flash, light, mesh, shake, shockwave, vfx)

GLASS_DK = "#8496A8"     # the card secondary: blued glass in shadow


def _bursts(t0: float, t1: float, step: float, n: int) -> list:
    out, t = [], t0
    while t <= t1 + 1e-6:
        out.append([round(t, 3), n])
        t += step
    return out


XF = [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]          # loop crossfade (life = 1.25 × duration)


def defs() -> list:
    D = []

    # ── passive · Turned Blades: a disarm turns a blade aside → the pane glints, glass flakes rise ──────
    D.append(vfx("ardit_passive_turned", 0.7,
                 L("sprite", at="caster", follow=True, offset=[0.25, 0.35, -0.45], texture="flare", size=[0.4, 1.0, 0.7], color=[CHALK, "team"],
                   emissive=1.5, alpha=[0, 1, 0], life=0.3, rotDeg=[0, 0]),
                 mesh("caster", "wall", [[0, 0.6], [0.3, 1.0], [1, 1.0]], 0.4, color=[DAWNGLASS, "team"], alpha=(0.5, 0.4, 0), emissive=1.5,
                      mask="edge", mask_param=[[0, 0.0], [1, 1.1]], stretch=[0.7, 1.5, 0.05], offset=[0.3, -0.65, -0.45], follow=True,
                      noise=0.3, hold=1),
                 L("emitter", at="caster", follow=False, offset=[0, -1.0, 0], count=6, shape="ring", radius=0.5, dir="up", spreadDeg=12,
                   speed=[1.0, 2.0], life=[0.35, 0.6], size=[0.14, 0.05], color=[DAWNGLASS, "team"], alpha=[0, 1, 0], emissive=1.4,
                   texture="shard", blend="add", align="velocity", aspect=0.5, drag=1.0),
                 shockwave("origin", radius=(0.3, 0.9), width=(0.12, 0.04), life=0.3, emissive=1.4, alpha=(0.8, 0.5, 0)),
                 comment="T1 · Lumen · Turned Blades: a stack of armour → the pavise pane glints edge-to-edge, glass flakes rise (help is up), "
                         "a small team ring at the feet"))

    # ── a1 · Lancing Run: a 7 m charge behind the pane (16 m/s, ~0.45 s) ───────────────────────────────
    tr = _bursts(0.0, 0.5, 0.025, 1)
    D.append(vfx("ardit_a1_lance", 0.6,
                 flash(3, at="origin", color="team", scale=0.6),
                 dust("ground", 7, size=0.9, speed=(1.4, 3.0), radius=0.3, delay=0.0),
                 chips("ground", 7, speed=(2, 4.5), size=0.14, delay=0.0),
                 shockwave("ground", radius=(0.3, 1.3), width=(0.25, 0.06), life=0.25, emissive=3.0, alpha=(0.9, 0.6, 0), fit=False),
                 # the pane leading the charge: a pale upright sheet of glass light, its leading edge a hard vertical line,
                 # a sun-glint riding its top corner
                 L("emitter", at="path", offset=[0.75, -0.1, 0], bursts=tr, shape="point", dir="none", speed=[0, 0], life=[0.07, 0.07],
                   size=[2.1, 2.0], color=[DAWNGLASS, "team"], alpha=[0.3, 0.2], emissive=3.0, texture="glow", blend="add", align="axis",
                   aspect=0.5, soft=0.2),
                 L("emitter", at="path", offset=[0.95, -0.05, 0], bursts=tr, shape="point", dir="none", speed=[0, 0], life=[0.06, 0.06],
                   size=[1.9, 1.8], color=[DAWNGLASS, "team"], alpha=[1, 0.6], emissive=5.0, texture="spark", blend="add", rotDeg=[90, 90]),
                 L("emitter", at="path", offset=[0.9, 0.85, 0], bursts=_bursts(0.0, 0.5, 0.05, 1), shape="point", dir="none", speed=[0, 0],
                   life=[0.09, 0.09], size=[0.8, 0.5], color=[CHALK, DAWNGLASS], alpha=[1, 0], emissive=5.0, texture="flare", blend="add",
                   rotDeg=[0, 30]),
                 # the trail: a continuous team band along the ground (spawned along each frame's segment), side streaks peel back
                 L("emitter", at="path", offset=[0, -0.95, 0], bursts=_bursts(0.0, 0.5, 0.02, 2), shape="sphere", radius=0.15, dir="back",
                   spreadDeg=4, speed=[2.6, 3.0], life=[0.26, 0.32], size=[1.0, 0.75], color="team", alpha=[0.42, 0], emissive=3.0, texture="glow",
                   blend="add", stretch=0.32, soft=0.1),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.5, 0.025, 2), shape="sphere", radius=0.55, dir="back", spreadDeg=18,
                   speed=[3, 6], life=[0.1, 0.2], size=[0.42, 0.1], color=[DAWNGLASS, "team"], alpha=[0.9, 0], emissive=4.0, drag=2.5,
                   texture="streak", stretch=0.06, blend="add"),
                 L("emitter", at="path", offset=[0.7, 0.2, 0], bursts=_bursts(0.0, 0.5, 0.05, 1), shape="sphere", radius=0.5, dir="back",
                   spreadDeg=50, speed=[1, 2.5], life=[0.25, 0.4], size=[0.17, 0.06], color=[DAWNGLASS, "team"], alpha=[1, 0], emissive=3.0,
                   gravity=4, texture="glint", blend="add", secondary=True),
                 comment="T3 · Lumen · Lancing Run: a pale sheet of glass light leads the charge (a glint on its top edge), a team band "
                         "runs along the ground, side streaks peel back; launch dust and chips. Built from timed bursts (no ribbon)"))

    # ── a2 · Glare: a 5 m, 70° cone of reflected sun (area at the feet, scale = 5) ──────────────────────
    D.append(vfx("ardit_a2_glare", 0.9,
                 # the pane catches the sun
                 L("sprite", at="origin", offset=[0.55, 0.55, -0.3], texture="flare", size=[0.6, 2.2, 1.6], color=[CHALK, "team"],
                   emissive=6.0, alpha=[1, 1, 0], life=0.2, rotDeg=[10, 10]),
                 mesh("origin", "wall", [[0, 0.8], [0.2, 1.0], [1, 1.0]], 0.3, color=[DAWNGLASS, "team"], alpha=(0.7, 0.5, 0), emissive=3.0,
                      stretch=[1.25, 1.8, 0.05], offset=[0.6, -1.0, 0], rotate=[-25, 0, 0], mask="edge", mask_param=[[0, 0.0], [1, 1.1]],
                      noise=0.3),
                 # the glare: a bright front races out across the cone (danger edge brightest) over a ray-streaked fill
                 mesh("ground", "fan", 2.0, 0.42, color=[[0, CHALK], [0.35, "team"], [1, "team"]], alpha=(1, 1, 0), emissive=6.0, angle=70,
                      mask="edge", mask_param=[[0, 0.12], [0.75, 1.04], [1, 1.04]], fit=True, noise=0.25),
                 mesh("ground", "fan", 2.0, 0.75, color=[DAWNGLASS, "team"], alpha=[[0, 0], [0.12, 0.6], [0.5, 0.35], [1, 0]], emissive=2.4, angle=70,
                      mask="band", mask_param=0.12, fit=True, noise=0.65, noise_scale=2.2, scroll=[0, -1.6]),
                 decal("ground", "light", 1.0, 1.0, color=[CHALK, "team"], alpha=(0.0, 0.55, 0.35, 0), emissive=1.6, shape="cone", angle=70,
                       texture="caustic", fit=True),
                 # rays thrown outward through the cone, dazzle glints hanging in it
                 L("emitter", at="ground", offset=[0, 0.6, 0], count=20, shape="cone", angleDeg=64, length=4.6, dir="normal", spreadDeg=6,
                   speed=[7, 11], life=[0.12, 0.24], size=[0.5, 0.12], color=[CHALK, "team"], alpha=[1, 0], emissive=5.0, drag=2.0,
                   texture="streak", stretch=0.05, blend="add", fit=False),
                 L("emitter", at="ground", offset=[0, 0.7, 0], count=10, shape="cone", angleDeg=60, length=4.6, dir="none", speed=[0, 0],
                   life=[0.25, 0.5], size=[0, 0.45, 0], color=[CHALK, DAWNGLASS], alpha=[0, 1, 0], emissive=4.5, texture="flare", blend="add",
                   rotDeg=[0, 45], delay=0.08, fit=False, secondary=True),
                 L("emitter", at="ground", offset=[0, 1.2, 0], count=12, shape="cone", angleDeg=60, length=4.4, dir="down", spreadDeg=30,
                   speed=[0.3, 0.8], life=[0.45, 0.8], size=[0.12, 0.04], color=[DAWNGLASS, "team"], alpha=[0, 1, 0], emissive=3.0, gravity=1.5,
                   texture="glint", blend="add", delay=0.12, fit=False, secondary=True),
                 light("ground", "team", 14, 7, 0.45),
                 comment="T3 · Lumen · Glare: the pane flares (a sun-glint on its edge), then reflected sun is thrown flat across the 70° cone: "
                         "a bright team front races out to 5 m over a ray-streaked fill, a caustic light pool lingers, glints drift down"))

    # ── a3 · Spire Strike: the spire driven into the ground, 2.5 m around him (area at the feet, scale 2.5) ──
    D.append(vfx("ardit_a3_spire", 1.0,
                 flash(2, at="ground", color="team", scale=1.4),
                 # the stake: a shaft of light driven down at the strike point, a thin spire left standing
                 mesh("origin", "spike", [[0, 0.15], [0.12, 1.0], [1, 1.0]], 0.28, color=[DAWNGLASS, "team"], alpha=(1, 0.9, 0), emissive=3.0,
                      rim="team", rim_emissive=3.0, stretch=[2.2, 2.4, 2.2], rotate=[180, 0, 0], offset=[0.75, 1.2, 0]),
                 mesh("ground", "column", [[0, 0.9], [1, 0.5]], 0.45, color=[DAWNGLASS, "team"], alpha=(0.75, 0), emissive=3.0, mask="top",
                      mask_param=0.6, stretch=[0.3, 3.2, 0.3], offset=[0.75, 0, 0], noise=0.4, scroll=[0, 2.0], fit=False),
                 # the ground crazes into glass out to the edge; the edge ring is the brightest thing
                 decal("ground", "frost", [[0, 0.25], [0.1, 0.9], [1, 0.95]], 1.0, color=DAWNGLASS, alpha=(0.75, 0.6, 0), emissive=2.0, rim="team",
                       texture="frost", fit=True),
                 decal("ground", "crack", [[0, 0.3], [0.1, 0.42], [1, 0.42]], 1.0, color="#2A2C33", alpha=(0.9, 0.7, 0), emissive=1.6, rim="team",
                       fit=True),
                 shockwave("ground", radius=(0.12, 1.0), width=(0.5, 0.1), life=0.32, emissive=3.0, sharp=2.2, fit=True),
                 shockwave("ground", color=DAWNGLASS, radius=(0.1, 0.78), width=(0.25, 0.05), life=0.4, emissive=2.2, alpha=(0.8, 0.5, 0),
                           delay=0.05, fit=True),
                 L("emitter", at="ground", offset=[0.75, 0.15, 0], count=16, shape="ring", radius=0.25, dir="out", spreadDeg=40, speed=[5, 9],
                   life=[0.28, 0.5], size=[0.3, 0.22, 0], sizeVar=[0.6, 1.3], color=[DAWNGLASS, "team"], alpha=[1, 1, 0], emissive=3.0,
                   gravity=9, drag=1.6, texture="shard", blend="add", align="velocity", aspect=0.45, fit=False),
                 chips("ground", 10, speed=(2.5, 6), size=0.15),
                 dust("ground", 8, size=1.0, speed=(2.5, 4.2), radius=0.5, delay=0.06),
                 light("ground", "team", 9, 5, 0.3),
                 shake(0.25),
                 comment="T2 · Lumen · Spire Strike: a stake of light is driven down at the strike point and a thin spire stands for a "
                         "breath; the ground crazes into glass out to 2.5 m under a team edge ring, glass shards and chalk chips fly out, dust settles"))

    # ── ult · Muster: a 6 m beacon zone that follows him for 5 s (loops each 1 s) ───────────────────────
    D.append(vfx("ardit_ult_muster", 1.0,
                 # the disarm edge: a held team ring and a low glass rampart standing on it (the brightest thing)
                 shockwave("ground", radius=(1.0, 1.0), width=(0.2, 0.2), life=1.25, emissive=5.0, alpha=XF, sharp=2.6, noise=0.25, fit=True),
                 mesh("ground", "wall", 2.0, 1.25, color="team", alpha=[[0, 0], [0.2, 0.6], [0.8, 0.6], [1, 0]], emissive=4.0,
                      mask="top", mask_param=0.75, stretch=[1, 0.07, 1], noise=0.5, noise_scale=4.0, scroll=[0.06, 0.6], fit=True),
                 # the beacon: a pale spire of light over him, a caustic pool under it
                 mesh("ground", "column", 1.0, 1.25, color="team", alpha=[[0, 0], [0.2, 0.55], [0.8, 0.55], [1, 0]], emissive=5.0,
                      mask="top", mask_param=0.75, stretch=[0.6, 5.5, 0.6], noise=0.5, scroll=[0, 1.8], rim="team", rim_emissive=4.0, fit=False),
                 L("sprite", at="ground", offset=[0, 5.0, 0], texture="flare", size=2.6, color="team", emissive=5.0,
                   alpha=[[0, 0], [0.2, 0.9], [0.8, 0.9], [1, 0]], life=1.25, rotDeg=[0, 0], fit=False),
                 decal("ground", "light", 0.75, 1.25, color=DAWNGLASS, alpha=[[0, 0], [0.2, 0.38], [0.8, 0.38], [1, 0]], emissive=1.2,
                       texture="caustic", fit=True),
                 # help rises inside; glints sit on the edge
                 L("emitter", at="ground", rate=34, shape="disc", radius=5.6, dir="up", spreadDeg=12, speed=[0.7, 1.5], life=[0.7, 1.1],
                   size=[0, 0.2, 0.15, 0], color=[CHALK, DAWNGLASS, "team"], alpha=[0, 1, 0.8, 0], emissive=3.0, drag=0.4, turbulence=0.4,
                   texture="mote", blend="add", fit=False, secondary=True),
                 L("emitter", at="ground", rate=14, shape="disc", radius=1.0, dir="up", spreadDeg=8, speed=[1.6, 2.6], life=[0.7, 1.0],
                   size=[0.3, 0.12], color=[DAWNGLASS, "team"], alpha=[0, 1, 0], emissive=3.5, texture="shard", blend="add", align="velocity",
                   aspect=0.4, fit=False),
                 L("emitter", at="ground", rate=22, shape="ring", radius=6.0, dir="none", speed=[0, 0], life=[0.35, 0.7], size=[0, 0.3, 0],
                   color=[DAWNGLASS, "team"], alpha=[0, 1, 0], emissive=4.5, texture="glint", blend="add", offset=[0, 0.35, 0], fit=False),
                 comment="T3 · Lumen · Muster (zone loop): a held team ring with a low glass rampart on it marks the 6 m disarm edge "
                         "(the brightest thing), a pale spire of light stands over Ardit above a caustic pool, glass motes and panes rise "
                         "inside (help is up), glints sit on the edge"))
    return D
