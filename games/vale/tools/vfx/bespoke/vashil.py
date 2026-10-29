"""Vashil · Bell ringer — bespoke VFX (Lumen: dawnglass bells, sound drawn as rings of light).

Identity: SOUND. Every effect is made of concentric rings (the strike, the ripples that follow, the hush inside),
glass bell shapes (the dome mesh is a bell) and glints shaken loose by the ringing. The danger edge is always
the outermost team ring. Shapes: a band of rings with a quiet centre (a1), a flying glass bell that sheds ripples
(a2), a swept fan with arcs pushing out (a3), a great glass bell struck three times (ult), a humming pair of
rings round the chest (passive).
"""
from __future__ import annotations

from vfxkit import CHALK, CHALK_DK, DAWNGLASS, INK2, NOON, WHITE, L, chips, dust, light, shake, vfx

GLASS = DAWNGLASS
BELL = "#C7D9E8"
CHALKY = "#D9D4C6"


def defs() -> list:
    D = []

    # ── passive · Hum (on the humming enemy, T1: emissive ≤ 1.5, no decals) ──────────────────────────────────────────
    D.append(vfx("vashil_passive_hum", 0.8,
                 [L("shockwave", at="target", delay=d, offset=[0, 0.3, 0], radius=[[0, 0.42], [1, 0.72]], width=[0.07, 0.02], life=0.32,
                    color=[GLASS, "team"], alpha=[0.9, 0.5, 0], emissive=1.5, sharp=2.0, mode="vertical") for d in (0.0, 0.18, 0.36)],
                 L("emitter", at="target", count=8, shape="ring", radius=0.5, offset=[0, 0.3, 0], dir="none", speed=[0, 0], life=[0.4, 0.7],
                   size=[0, 0.12, 0], color=[WHITE, GLASS, "team"], alpha=[0, 1, 0], emissive=1.5, orbitDeg=300, texture="glint", blend="add"),
                 L("emitter", at="target", count=4, shape="sphere", radius=0.4, offset=[0, 0.3, 0], dir="none", speed=[0, 0], life=[0.35, 0.55],
                   size=[0.05, 0.4], color="team", alpha=[0.8, 0], emissive=1.4, texture="ring_thin", blend="add"),
                 comment="T1 · Lumen · Hum: thin rings of sound pulse round the target's chest three times, glints circle it, small ripples bloom"))

    # ── passive · the chord (area at the struck humming enemy, 3.5 m; every humming enemy in it is stunned 1 s, T3) ────
    # two notes meet: the hum's chest rings swell into a band of sound running out to 3.5 m (the humming enemies inside
    # are joined by it), then the stun: the rings snap shut inward and a hush settles
    D.append(vfx("vashil_passive_chord", 1.0,
                 [L("shockwave", at="target", delay=d, offset=[0, 0.3, 0], radius=[[0, 0.42], [1, 0.9]], width=[0.08, 0.03], life=0.22,
                    color=[GLASS, "team"], alpha=[1, 0.6, 0], emissive=2.6, sharp=2.2, mode="vertical") for d in (0.0, 0.08)],
                 L("shockwave", at="ground", radius=[[0, 0.12], [0.5, 0.92], [1, 1.0]], width=[0.22, 0.05], life=0.36, color=[WHITE, BELL, "team"],
                   alpha=[1, 0.9, 0], emissive=4.5, sharp=2.6, noise=0.15, fit=True),
                 L("shockwave", at="ground", delay=0.06, radius=[[0, 0.1], [0.5, 0.8], [1, 0.86]], width=[0.12, 0.03], life=0.32, color=[BELL, "team"],
                   alpha=[0.8, 0.6, 0], emissive=3.0, sharp=2.6, fit=True),
                 # the stun: rings snap shut on the struck one
                 [L("shockwave", at="target", delay=0.22 + d, offset=[0, 1.6, 0], radius=[[0, 0.9], [1, 0.35]], width=[0.06, 0.1], life=0.3,
                    color=[NOON, "team"], alpha=[0, 1, 0], emissive=3.0, sharp=2.0) for d in (0.0, 0.12)],
                 L("emitter", at="ground", count=18, shape="ring", radius=0.95, offset=[0, 0.4, 0], dir="in", spreadDeg=10, speed=[1.5, 2.5],
                   life=[0.35, 0.55], size=[0, 0.16, 0], color=[WHITE, GLASS, "team"], alpha=[0, 1, 0], emissive=3.0, texture="glint", blend="add",
                   delay=0.18, fit=True),
                 light("target", "team", 4, 5, 0.25),
                 comment="T3 · Lumen · the chord: the hum's chest rings swell and a band of sound runs out to 3.5 m joining the humming "
                         "enemies, then rings snap shut over the struck one (the stun) and glints fall inward into a hush"))

    # ── a1 · Peal (ring area 1.5 - 3.5 m, lands after 0.4 s): the ring of sound with a quiet centre ───────────────────
    inner = 1.5 / 3.5
    D.append(vfx("vashil_a1_peal", 1.0,
                 # the strike: the band flashes, its outer edge (the danger edge) brightest
                 L("shockwave", at="ground", radius=[[0, 0.94], [0.2, 1.0], [1, 1.02]], width=[0.18, 0.06], life=0.5, color=[WHITE, "team"],
                   alpha=[1, 0.8, 0], emissive=6, sharp=2.6, noise=0.2, fit=True),
                 L("shockwave", at="ground", radius=[[0, inner + 0.06], [0.2, inner], [1, inner - 0.02]], width=[0.12, 0.04], life=0.45,
                   color=[GLASS, "team"], alpha=[0.9, 0.6, 0], emissive=3.5, sharp=2.0, noise=0.2, fit=True),
                 L("mesh", at="ground", shape="ringwave", scale=[[0, 1.85], [0.3, 2.0], [1, 2.02]], life=0.32, color=[GLASS, "team"],
                   alpha=[0.55, 0.3, 0], emissive=2.4, noise=0.5, noiseScale=3, scroll=[1.2, 0], align="up", fit=True),
                 # ripples roll out across the band and stop at the edge
                 [L("shockwave", at="ground", delay=d, radius=[[0, inner], [1, 1.0]], width=[0.08, 0.04], life=0.36, color=[GLASS, "team"],
                    alpha=[0.0, 0.9, 0.2], emissive=3.0, sharp=1.6, noise=0.3, fit=True) for d in (0.05, 0.16, 0.27)],
                 L("decal", at="ground", shape="ring", style="light", texture="caustic", radius=[[0, 0.96], [1, 1.0]], life=0.7, color="team",
                   alpha=[0.55, 0.3, 0], emissive=1.4, fit=True),
                 # glass shaken loose: glints and small slivers thrown outward off the band; little notes bloom in it
                 L("emitter", at="ground", count=20, shape="ring", radius=0.72, radiusInner=inner, dir="out", spreadDeg=40, speed=[1.5, 3.5],
                   life=[0.3, 0.55], size=[0.2, 0.15, 0], sizeVar=[0.6, 1.3], color=[WHITE, GLASS, "team"], alpha=[1, 1, 0], emissive=4, gravity=3,
                   drag=2, texture="shard", align="velocity", aspect=0.42, blend="add", fit=True),
                 L("emitter", at="ground", count=10, shape="disc", radius=0.95, radiusInner=inner + 0.05, dir="up", spreadDeg=10, speed=[0.3, 0.8],
                   life=[0.3, 0.5], size=[0.05, 0.55], color=[GLASS, "team"], alpha=[0.9, 0], emissive=2.4, texture="ring_thin", blend="add",
                   fit=True, secondary=True),
                 chips("ground", 8, speed=(2, 4), size=0.1, delay=0.02),
                 light("ground", "team", 10, 8, 0.3),
                 comment="T3 · Lumen · Peal: the 1.5 - 3.5 m band strikes: a bright team outer edge (the danger edge), a glass inner edge, a ring "
                         "flash, ripples that roll out across the band and stop at the edge, glass shaken loose outward; the centre stays quiet"))

    # ── a2 · Glass Chime (projectile, 9 m at 26 m/s): a small glass bell that sheds ripples ───────────────────────────
    D.append(vfx("vashil_a2_chime", 0.6,
                 L("shockwave", at="origin", offset=[0.4, 0.3, 0], radius=[[0, 0.15], [1, 0.7]], width=[0.1, 0.03], life=0.22, color=[GLASS, "team"],
                   alpha=[1, 0.6, 0], emissive=3.0, sharp=2.0, mode="vertical"),
                 L("mesh", at="path", shape="dome", scale=[[0, 0.2], [0.15, 0.55], [1, 0.55]], life=0.4, color=[BELL, "team"], alpha=0.85, emissive=2.2,
                   rim="team", rimPow=2.2, rimEmissive=3.0, noise=0.3, scroll=[1.5, 0], offset=[0, -0.15, 0], hold=1, wobble=0.02),
                 L("sprite", at="path", offset=[0, -0.12, 0], follow=True, life=0.6, size=0.32, color=[WHITE, "team"], emissive=3.0,
                   alpha=[[0, 0], [0.1, 1], [1, 1]], texture="glow", blend="add", soft=0.1),
                 L("sprite", at="path", follow=True, life=0.6, size=1.2, color="team", emissive=1.6, alpha=[[0, 0], [0.1, 0.5], [1, 0.5]], texture="glow",
                   blend="add", soft=0.3),
                 L("ribbon", at="path", color=["team", GLASS], width=[0.0, 0.18], life=0.12, alpha=[0, 0.5], emissive=2.4, noise=0.2),
                 # ripples of sound shed along the flight
                 L("emitter", at="path", rate=34, shape="point", dir="none", speed=[0, 0], life=[0.22, 0.3], size=[0.25, 1.0], color=[GLASS, "team"],
                   alpha=[0.9, 0], emissive=2.4, texture="ring_thin", blend="add"),
                 L("emitter", at="path", rate=24, shape="sphere", radius=0.3, dir="back", spreadDeg=40, speed=[0.4, 1.2], life=[0.15, 0.3],
                   size=[0, 0.1, 0], color=[WHITE, GLASS], alpha=[0, 1, 0], emissive=2.6, texture="glint", blend="add", secondary=True),
                 comment="T2 · Lumen · Glass Chime: a vertical ring at the rod tip, then a small glass bell with a team clapper of light flies, "
                         "shedding rings of sound and glints"))

    # ── a3 · Ring Out (cone 3.5 m, 90°): the rod sweeps the arc, arcs of sound push out ───────────────────────────────
    D.append(vfx("vashil_a3_ringout", 0.8,
                 L("mesh", at="ground", shape="fan", angleDeg=90, scale=2.0, life=0.2, color=[WHITE, GLASS, "team"], alpha=[[0, 1], [0.7, 0.9], [1, 0]],
                   emissive=3.0, mask="sweep", maskParam=[[0, 0.0], [1, 1.1]], align="dir", noise=0.3, fit=True),
                 [L("mesh", at="ground", delay=d, shape="fan", angleDeg=92, scale=2.02, life=0.3, color=[GLASS, "team"], alpha=[[0, a], [0.7, a], [1, 0]],
                    emissive=3.0, mask="edge", maskParam=[[0, 0.3], [1, 1.0]], align="dir", fit=True) for d, a in ((0.08, 1.0), (0.16, 0.7), (0.24, 0.45))],
                 L("decal", at="ground", shape="cone", style="light", texture="caustic", angleDeg=90, radius=1.0, life=0.5, color="team",
                   alpha=[0.5, 0.3, 0], emissive=1.4, fit=True),
                 L("emitter", at="ground", delay=0.06, count=16, shape="cone", angleDeg=86, length=3.2, dir="forward", spreadDeg=50, speed=[3, 6],
                   life=[0.2, 0.4], size=[0.2, 0.14, 0], sizeVar=[0.6, 1.3], color=[WHITE, GLASS, "team"], alpha=[1, 1, 0], emissive=3.0, drag=2.4,
                   texture="shard", align="velocity", aspect=0.42, blend="add", fit=False),
                 L("emitter", at="ground", delay=0.08, count=8, shape="cone", angleDeg=80, length=3.0, dir="up", spreadDeg=10, speed=[0.2, 0.5],
                   life=[0.3, 0.45], size=[0.05, 0.5], color=[GLASS, "team"], alpha=[0.9, 0], emissive=2.4, texture="ring_thin", blend="add",
                   fit=False, secondary=True),
                 [dict(x, fit=False) for x in dust("ground", 4, size=0.7, speed=(1.5, 2.5), radius=0.6, delay=0.1)],
                 comment="T2 · Lumen · Ring Out: the rod sweeps the 90° arc (a glass fan whose leading edge is brightest), three arcs of sound "
                         "push out to 3.5 m, glass glints thrown forward, small notes bloom in the arc"))

    # ── ult · Morning Toll (4.5 m, three tolls; this plays at each): a great glass bell is struck ─────────────────────
    D.append(vfx("vashil_ult_toll", 1.3,
                 L("flash", at="ground", radius=1.6, life=0.1, color="team", intensity=10, core=WHITE),
                 # the bell: a tall glass dome over the area that rings (a squash) and dissolves with a team edge
                 L("mesh", at="ground", shape="dome", scale=[[0, 1.25], [0.12, 1.0], [0.3, 1.05], [1, 1.08]], stretch=[1.0, 1.25, 1.0], life=0.55,
                   color=[BELL, "team"], alpha=[[0, 0.55], [0.4, 0.32], [1, 0]], emissive=[[0, 3.0], [0.2, 1.4], [1, 1.0]], rim="team", rimPow=2.6,
                   rimEmissive=8, noise=0.4,
                   scroll=[0.8, 0.4], dissolve=[[0, 0], [0.4, 0.15], [1, 1]], edge="team", edgeEmissive=8, align="up", fit=True),
                 # three rings roll out (the danger edge brightest), a ripple ring follows
                 [L("shockwave", at="ground", delay=d, radius=[[0, 0.25], [0.35, 0.85], [1, 1.0]], width=[w, 0.07], life=0.42, color=[WHITE, "team"],
                    alpha=[1, 0.8, 0], emissive=e, sharp=2.2, noise=0.3, fit=True) for d, w, e in ((0.0, 0.6, 10), (0.08, 0.4, 6), (0.16, 0.25, 4))],
                 L("mesh", at="ground", shape="ringwave", scale=[[0, 0.6], [0.4, 1.9], [1, 2.05]], life=0.38, color=[GLASS, "team"], alpha=[0.6, 0.35, 0],
                   emissive=4, noise=0.5, noiseScale=3, align="up", fit=True),
                 L("decal", at="ground", shape="circle", style="crack", radius=[[0, 0.5], [0.1, 0.95], [1, 0.95]], life=1.2, color=INK2, rim="team",
                   alpha=[0.85, 0.7, 0], emissive=3.0, fit=True),
                 # glass shaken off the bell and chips thrown out
                 L("emitter", at="ground", count=26, shape="ring", radius=0.5, dir="out", spreadDeg=35, speed=[3, 6], life=[0.35, 0.6],
                   size=[0.28, 0.2, 0], sizeVar=[0.6, 1.4], color=[WHITE, GLASS, "team"], alpha=[1, 1, 0], emissive=8, gravity=6, drag=1.8,
                   texture="shard", align="velocity", aspect=0.42, blend="add", fit=False),
                 [dict(x, fit=False) for x in chips("ground", 14, speed=(3, 6.5), size=0.13, delay=0.02)],
                 [dict(x, fit=True) for x in dust("ground", 8, size=0.9, speed=(0.8, 1.6), radius=0.6, delay=0.12)],
                 L("emitter", at="ground", count=14, shape="disc", radius=0.9, radiusInner=0.3, dir="up", spreadDeg=10, speed=[0.3, 0.8],
                   life=[0.3, 0.55], size=[0.1, 0.9], color=[GLASS, "team"], alpha=[0.9, 0], emissive=4, texture="ring_thin", blend="add", fit=True,
                   secondary=True),
                 light("ground", "team", 22, 10, 0.35),
                 shake(0.35),
                 comment="T4 · Lumen · Morning Toll (each toll): a white-core flash, a tall glass bell over the 4.5 m area rings (a squash) and "
                         "dissolves along team seams, three rings roll out brightest at the edge, glass shaken off, chips out, a cracked ring stays"))
    return D
