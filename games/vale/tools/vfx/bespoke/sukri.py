"""Sukri · Rim wanderer — bespoke VFX (Lumen: the cup of noon light; soft, round, gathering shapes).

Identity: GATHERING. Pale warm noon light (#EEDFB8, low saturation) pours from the cup on his crook; help is
drawn IN and UP (motes rising, rings closing toward him, shells of glass on allies); harm is a ring pushed
out with the team edge brightest. Heals carry the reserved Sap hue only. Shapes: a mote tossed from the cup
(a1 cast) that bursts (a1 damage half) and mends (a1 heal half), a beckon at the cup (a2 cast) and a streak of
light that follows the drawn ally into a glass shell (a2 hit), a spinning bola (a3) that wraps the legs (a3 hit),
a held dome of noon over the 6 m (passive), a 10 m ring that gathers everyone in (ult) and a swirling ring of
dust (ult zone).
"""
from __future__ import annotations

from vfxkit import CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, NOON, SAP, WHITE, L, chips, dust, light, shake, vfx

CUP = "#EEDFB8"         # noon light from the cup
CUP_DIM = "#CDBF9C"
GLASS = DAWNGLASS
SAP_PALE = "#CFF2D9"
CORD = "#B9AE95"        # the weighted cord
IRON = "#4A4540"

LOOP = 1.0
HOLD = [[0, 0], [0.23, 1], [0.77, 1], [1, 0]]


def _hold(a: float) -> list:
    return [[t, v * a] for t, v in HOLD]


def defs() -> list:
    D = []

    # ── passive · Spare Hour (area on Sukri, 6 m; passives play at T1: no decals, emissive ≤ 1.5) ─────────────────────
    D.append(vfx("sukri_passive_spare", 1.1,
                 L("mesh", at="ground", shape="dome", scale=[[0, 1.6], [0.2, 2.0], [1, 2.02]], stretch=[1.0, 0.45, 1.0], life=1.05, color=[CUP, GLASS],
                   alpha=[[0, 0], [0.15, 0.08], [0.8, 0.06], [1, 0]], emissive=0.8, rim=CUP, rimPow=3.0, rimEmissive=1.5, noise=0.5, scroll=[0.2, 0.3],
                   align="up", fit=True),
                 L("shockwave", at="ground", radius=[[0, 0.9], [0.2, 1.0], [1, 1.0]], width=[0.06, 0.05], life=1.05, color=[CUP, "team"],
                   alpha=[[0, 0], [0.12, 1], [0.8, 0.9], [1, 0]], emissive=1.5, sharp=2.4, noise=0.2, fit=True),
                 L("shockwave", at="ground", radius=[[0, 1.0], [1, 0.15]], width=[0.12, 0.05], life=0.45, color=CUP, alpha=[0.8, 0.5, 0], emissive=1.5,
                   sharp=1.4, fit=True),
                 L("flash", at="origin", radius=0.7, life=0.06, color=CUP, intensity=1.5, offset=[0.2, 0.2, 0]),
                 # held breath: motes rise across the circle (help is up)
                 L("emitter", at="ground", count=36, shape="disc", radius=5.6, dir="up", spreadDeg=12, speed=[0.6, 1.4], life=[0.6, 1.0],
                   size=[0, 0.22, 0], color=[CUP, GLASS], alpha=[0, 1, 0], emissive=1.5, gravity=-0.3, drag=1.0, turbulence=0.4, texture="mote",
                   blend="add", fit=False, secondary=True),
                 comment="T1 · Lumen · Spare Hour: a faint dome of noon light over the 6 m, a held pale ring at its edge, a pulse drawn in to Sukri "
                         "and motes rising across the circle (help is up); nobody inside can be touched for a breath"))

    # ── a1 · Mote Toss: the cast (the cup tips), the burst (damage half), the mend (heal half) ─────────────────────────
    D.append(vfx("sukri_a1_toss", 0.9,
                 L("sprite", at="origin", socket="weapon", follow=True, life=0.4, size=[[0, 0.2], [0.6, 0.8], [1, 0.3]], color=[CUP, "team"],
                   alpha=[[0, 0], [0.3, 1], [1, 0]], emissive=2.6, texture="glow", blend="add", soft=0.2),
                 # the mote leaves the cup on a short high arc toward the target
                 L("emitter", at="origin", socket="weapon", delay=0.25, count=1, shape="point", dir="none", velocity=[4.5, 4.0, 0], speed=[0, 0],
                   life=[0.45, 0.45], size=[0.45, 0.32], color=[WHITE, CUP], alpha=[1, 1, 0], emissive=3.0, gravity=9, texture="glow", blend="add",
                   collide=False),
                 L("emitter", at="origin", socket="weapon", delay=0.25, count=1, shape="point", dir="none", velocity=[4.5, 4.0, 0], speed=[0, 0],
                   life=[0.45, 0.45], size=[1.0, 0.7], color=CUP, alpha=[0.6, 0.5, 0], emissive=1.8, gravity=9, texture="glow", blend="add",
                   collide=False),
                 L("emitter", at="origin", socket="weapon", delay=0.25, count=8, shape="point", dir="none", velocity=[4.0, 3.6, 0], speed=[0.2, 0.8],
                   spreadDeg=180, life=[0.3, 0.5], size=[0, 0.12, 0], color=[CUP, "team"], alpha=[0, 1, 0], emissive=2.4, gravity=8, texture="glint",
                   blend="add", collide=False),
                 comment="T2 · Lumen · Mote Toss cast: the cup on the crook glows, then a mote of noon light leaves it on a short high arc toward "
                         "the target, glints spilling"))
    D.append(vfx("sukri_a1_mote", 0.8,
                 L("flash", at="ground", radius=0.9, life=0.06, color=CUP, intensity=3.0, offset=[0, 0.4, 0]),
                 L("shockwave", at="ground", radius=[[0, 0.15], [0.35, 0.8], [1, 1.0]], width=[0.35, 0.06], life=0.36, color="team", alpha=[1, 0.85, 0],
                   emissive=4.0, sharp=2.0, noise=0.3, fit=True),
                 L("mesh", at="ground", shape="orb", scale=[[0, 0.3], [0.3, 1.1], [1, 1.25]], stretch=[1, 0.6, 1], life=0.28, color=[WHITE, CUP],
                   alpha=[0.7, 0], emissive=3.0, rim="team", rimPow=2.4, rimEmissive=3.0, noise=0.5, dissolve=[[0, 0], [0.3, 0.3], [1, 1]], edge="team",
                   edgeEmissive=3.0, align="up", fit=False),
                 # light petals thrown out low (harm is out)
                 L("emitter", at="ground", count=18, shape="disc", radius=0.3, offset=[0, 0.3, 0], dir="out", spreadDeg=30, speed=[3, 6],
                   life=[0.35, 0.6], size=[0.18, 0.28, 0], color=[CUP, "team"], alpha=[1, 0.9, 0], emissive=3.0, gravity=2, drag=2.4, spinDeg=[-360, 360],
                   texture="petal", blend="add", align="velocity", fit=False),
                 chips("ground", 7, speed=(2, 4), size=0.11, delay=0.02),
                 light("ground", CUP, 8, 6, 0.3),
                 comment="T3 · Lumen · Mote Toss burst: the mote lands in a soft flash of noon, a team ring pushes out to 2.5 m (the harm), petals "
                         "of light skim outward"))
    D.append(vfx("sukri_a1_mend", 1.0,
                 L("decal", at="ground", shape="circle", style="light", texture="caustic", radius=[[0, 0.5], [0.2, 0.9], [1, 0.95]], life=0.8,
                   color=SAP, alpha=[0.45, 0.3, 0], emissive=1.2, fit=True),
                 L("shockwave", at="ground", radius=[[0, 0.9], [1, 0.3]], width=[0.1, 0.05], life=0.5, color=SAP, alpha=[0.0, 0.7, 0], emissive=2.0,
                   sharp=1.4, fit=True),
                 L("emitter", at="ground", count=22, shape="disc", radius=2.2, dir="up", spreadDeg=10, speed=[1.2, 2.4], life=[0.5, 0.9],
                   size=[0, 0.2, 0], color=[SAP, SAP_PALE], alpha=[0, 1, 0], emissive=2.2, gravity=-0.3, drag=1.0, turbulence=0.5, texture="mote",
                   blend="add", fit=False),
                 L("emitter", at="ground", count=8, shape="disc", radius=1.4, dir="up", spreadDeg=12, speed=[1.0, 1.8], life=[0.5, 0.8],
                   size=[0, 0.2, 0], color=[SAP, SAP_PALE], alpha=[0, 0.9, 0], emissive=1.6, spinDeg=[-90, 90], texture="petal", blend="add",
                   fit=False, secondary=True),
                 comment="T3 · Lumen · Mote Toss mend: where it lands, a soft Sap light pool, a Sap ring drawn in and motes and petals rising "
                         "(help is up)"))

    # ── a2 · Draw Near: the beckon (cast) and the pull into a glass shell (hit on the ally) ─────────────────────────────
    D.append(vfx("sukri_a2_beckon", 0.6,
                 L("sprite", at="origin", socket="weapon", follow=True, life=0.45, size=[[0, 0.3], [0.4, 0.9], [1, 0.4]], color=[CUP, "team"],
                   alpha=[[0, 0], [0.3, 1], [1, 0]], emissive=2.6, texture="glow", blend="add", soft=0.2),
                 L("emitter", at="origin", socket="weapon", follow=True, count=14, shape="sphere", radius=0.9, surface=True, dir="in", speed=[2.0, 3.0],
                   life=[0.25, 0.35], size=[0.12, 0.04], color=[CUP, "team"], alpha=[0, 1, 0], emissive=2.6, texture="spark", stretch=0.03, blend="add"),
                 L("shockwave", at="origin", offset=[0.3, 0.2, 0], radius=[[0, 0.8], [1, 0.15]], width=[0.06, 0.12], life=0.25, color=CUP,
                   alpha=[0.0, 0.8, 0], emissive=2.4, sharp=1.6, mode="vertical"),
                 comment="T2 · Lumen · Draw Near cast: the cup glows and light is drawn in to it from all round (help is in)"))
    D.append(vfx("sukri_a2_draw", 1.0,
                 # the drawn ally trails a streak of noon light along the pull
                 L("ribbon", at="target", color=[CUP, "team"], width=[0.0, 0.55], life=0.35, alpha=[0, 0.7], emissive=2.6, noise=0.3, scroll=2),
                 L("ribbon", at="target", offset=[0, -0.9, 0], color="team", width=[0.0, 0.7], life=0.35, alpha=[0, 0.4], emissive=2.0, noise=0.5,
                   face="ground"),
                 # a glass shell closes round them
                 L("mesh", at="target", shape="orb", scale=[[0, 2.2], [0.2, 1.6], [0.35, 1.7], [1, 1.7]], stretch=[1, 1.15, 1], life=0.9,
                   color=[GLASS, CUP], alpha=[[0, 0], [0.15, 0.1], [0.75, 0.08], [1, 0]], emissive=0.8, rim="team", rimPow=2.2, rimEmissive=3.0,
                   noise=0.4, scroll=[0, 0.6], follow=True, align="up"),
                 L("emitter", at="target", count=14, shape="ring", radius=0.6, offset=[0, -0.9, 0], dir="up", spreadDeg=10, speed=[1.0, 2.0],
                   life=[0.4, 0.7], size=[0.12, 0.04], color=[GLASS, CUP], alpha=[0, 1, 0], emissive=2.2, texture="shard", align="velocity", aspect=0.45,
                   blend="add", follow=True),
                 L("emitter", at="target", count=10, shape="sphere", radius=0.6, dir="up", spreadDeg=20, speed=[0.6, 1.4], life=[0.5, 0.8],
                   size=[0, 0.18, 0], color=[CUP, GLASS], alpha=[0, 1, 0], emissive=2.0, gravity=-0.3, texture="mote", blend="add", follow=True,
                   secondary=True),
                 comment="T2 · Lumen · Draw Near: the drawn ally trails a streak of noon light along the pull and a glass shell closes round them "
                         "(team rim), glass flakes and motes rise (help is up)"))

    # ── a3 · Wrap Cast: the spinning bola (projectile) and the wrap round the legs (hit) ───────────────────────────────
    D.append(vfx("sukri_a3_wrap", 0.6,
                 L("mesh", at="path", shape="ringwave", scale=[[0, 0.3], [0.2, 0.85], [1, 0.85]], life=0.45, color=[CUP, "team"], alpha=0.85, emissive=2.4,
                   spinDeg=-1080, align="flat", hold=1, noise=0.3, offset=[0, -0.2, 0]),
                 # two weights whirling round the cord loop (opaque, follow the throw)
                 L("emitter", at="path", count=2, shape="ring", radius=0.36, offset=[0, -0.2, 0], dir="none", speed=[0, 0], life=[0.7, 0.7],
                   size=0.2, color=[IRON, IRON], alpha=[1, 1], orbitDeg=-1080, texture="chip", blend="chip", rim=CUP, rimAlpha=0.6, follow=True,
                   collide=False),
                 L("ribbon", at="path", offset=[0, -0.2, 0], color=["team", CUP], width=[0.0, 0.5], life=0.16, alpha=[0, 0.5], emissive=2.2, noise=0.3),
                 L("emitter", at="path", rate=40, shape="ring", radius=0.36, offset=[0, -0.2, 0], dir="none", speed=[0, 0], life=[0.08, 0.14],
                   size=[0.14, 0.05], color=[CUP, "team"], alpha=[0.9, 0], emissive=2.4, texture="spark", blend="add", secondary=True),
                 comment="T2 · Lumen · Wrap Cast: a spinning loop of cord lit with noon light, two dark weights whirling round it, a team streak"))
    D.append(vfx("sukri_a3_bind", 1.1,
                 L("flash", at="target", radius=0.55, life=0.05, color="team", intensity=3.0, offset=[0, -0.4, 0]),
                 # the cord whips round the legs and pulls tight (control is a spiral)
                 L("mesh", at="target", shape="spiral", scale=[[0, 1.6], [0.2, 1.0], [0.35, 0.82], [1, 0.82]], stretch=[1.0, 1.1, 1.0], offset=[0, -1.0, 0],
                   life=1.05, color=[CUP, "team"], alpha=[[0, 0], [0.08, 1], [0.85, 0.9], [1, 0]], emissive=2.6, twist=-2.5, align="up", follow=True),
                 L("emitter", at="target", count=2, shape="ring", radius=0.5, offset=[0, -0.75, 0], dir="none", speed=[0, 0], life=[0.35, 0.35],
                   size=0.18, color=[IRON, IRON], alpha=[1, 1, 0], orbitDeg=-900, radial=-4, texture="chip", blend="chip", rim=CUP, rimAlpha=0.6,
                   collide=False),
                 L("shockwave", at="target", offset=[0, -1.0, 0], radius=[[0, 1.0], [1, 0.42]], width=[0.08, 0.14], life=0.3, color="team",
                   alpha=[0.3, 1, 0], emissive=2.8, sharp=2.0),
                 L("decal", at="target", shape="circle", style="light", texture="caustic", radius=0.6, life=1.0, color="team", alpha=[0.5, 0.4, 0],
                   emissive=1.2),
                 chips("target", 6, speed=(1.5, 3), size=0.1, delay=0.2),
                 comment="T2 · Lumen · Wrap Cast hit: the lit cord whips round the legs and pulls tight (a spiral closing), the two weights clack "
                         "round, a team ring tightens at the feet"))

    # ── ult · Gather In (area 10 m, T4) and the ring of dust (zone 4 m, loops) ──────────────────────────────────────────
    D.append(vfx("sukri_ult_gather", 1.5,
                 L("flash", at="origin", radius=1.3, life=0.1, color=CUP, intensity=10, core=WHITE, offset=[0.2, 0.3, 0]),
                 # the 10 m ring closes in on him (help is in), a second ring follows
                 L("shockwave", at="ground", radius=[[0, 1.0], [0.6, 0.35], [1, 0.08]], width=[0.35, 0.12], life=0.7, color=[CUP, "team"],
                   alpha=[[0, 0.4], [0.15, 1], [0.85, 0.9], [1, 0]], emissive=8, sharp=2.0, noise=0.3, fit=True),
                 L("shockwave", at="ground", delay=0.12, radius=[[0, 0.9], [0.6, 0.3], [1, 0.06]], width=[0.18, 0.06], life=0.62, color=[GLASS, CUP],
                   alpha=[[0, 0], [0.2, 0.7], [1, 0]], emissive=5, sharp=1.6, noise=0.4, fit=True),
                 # light streams in from the whole circle to the cup and rises (help is up)
                 L("emitter", at="ground", count=60, shape="ring", radius=9.5, radiusInner=7.0, offset=[0, 0.4, 0], dir="in", spreadDeg=6, speed=[11, 14],
                   life=[0.6, 0.75], size=[0.4, 0.1], color=[CUP, "team"], alpha=[0, 1, 0.6, 0], emissive=6, drag=0.6, texture="streak", stretch=0.05,
                   blend="add", fit=False),
                 L("emitter", at="origin", delay=0.45, count=26, shape="disc", radius=0.8, offset=[0, -0.8, 0], dir="up", spreadDeg=15, speed=[2.5, 4.5],
                   life=[0.5, 0.9], size=[0, 0.24, 0], color=[WHITE, CUP, GLASS], alpha=[0, 1, 0], emissive=6, gravity=-0.4, drag=1.0, texture="mote",
                   blend="add"),
                 L("mesh", at="origin", delay=0.45, shape="column", scale=[[0, 0.6], [0.3, 1.2], [1, 1.2]], stretch=[1, 2.2, 1], offset=[0, -0.95, 0],
                   life=0.7, color=[WHITE, CUP], alpha=[0.6, 0], emissive=6, mask="top", maskParam=0.5, noise=0.5, scroll=[0, 2.0], align="up"),
                 L("sprite", at="origin", socket="weapon", follow=True, life=1.2, size=[[0, 0.4], [0.3, 1.5], [1, 0.8]], color=[CUP, "team"],
                   alpha=[[0, 0], [0.15, 1], [0.8, 0.8], [1, 0]], emissive=6, texture="glow", blend="add", soft=0.2),
                 [dict(x, fit=False) for x in dust("ground", 10, size=1.0, speed=(0.6, 1.4), radius=1.5, delay=0.5)],
                 light("origin", CUP, 20, 12, 0.9, attack=0.3),
                 shake(0.4),
                 comment="T4 · Lumen · Gather In: a white-core flash at the cup, the 10 m ring closes in on Sukri with a second ring behind it, "
                         "streaks of noon light stream in from the whole circle and rise as a column of motes at the cup (help is in and up)"))
    D.append(vfx("sukri_ult_dust", LOOP,
                 # a slow ring of dust turns round him (spiral = control), a team edge at 4 m
                 L("shockwave", at="ground", radius=[[0, 0.99], [1, 1.0]], width=[0.09, 0.09], life=1.3, color="team", alpha=_hold(0.95), emissive=3.0,
                   sharp=2.4, noise=0.3, fit=True),
                 L("decal", at="ground", shape="circle", style="light", texture="caustic", radius=0.98, life=1.3, color=CUP_DIM, alpha=_hold(0.22),
                   emissive=0.6, fit=True),
                 L("emitter", at="ground", rate=22, duration=LOOP, shape="ring", radius=3.8, radiusInner=1.6, offset=[0, 0.5, 0], dir="none", speed=[0, 0], life=[0.9, 1.3],
                   size=[0.9, 1.5, 1.7], color=[CUP_DIM, "#A89F8C", DUST], alpha=[0, 0.55, 0.4, 0], orbitDeg=-55, gravity=0, turbulence=0.3, soft=0.15,
                   rotDeg=[0, 360], spinDeg=[-40, 40], texture="dust_puff", blend="alpha", fit=False),
                 L("emitter", at="ground", rate=10, duration=LOOP, shape="ring", radius=3.9, radiusInner=1.0, offset=[0, 0.3, 0], dir="none",
                   speed=[0, 0], life=[0.5, 0.8], size=[0, 0.14, 0], color=[CUP, GLASS], alpha=[0, 1, 0], emissive=2.4, orbitDeg=-80, texture="glint",
                   blend="add", fit=False, secondary=True),
                 L("emitter", at="ground", rate=26, duration=LOOP, shape="ring", radius=3.9, radiusInner=1.8, offset=[0, 0.2, 0], dir="none",
                   speed=[0, 0], life=[0.4, 0.6], size=[0.7, 0.15], color=[CUP, "team"], alpha=[0.9, 0], emissive=2.4, orbitDeg=-140,
                   texture="streak", blend="add", align="ground", fit=False, secondary=True),
                 comment="T3 · Lumen · Gather In dust: a slow ring of pale dust and glints turns round Sukri (a control spiral), a team edge at 4 m; "
                         "loops seamlessly for its 2 s"))
    return D
