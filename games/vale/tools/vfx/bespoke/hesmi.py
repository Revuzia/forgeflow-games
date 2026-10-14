"""Hesmi (Plinth · Hourless · the shard bearer): bespoke VFX.

Identity: Shade cast by stone. Standing stones (opaque, dark ironstone with a pale honed edge) and the hard,
rectangular shadows they throw. Where Burdam's ink stains and smears, Hesmi's shade is rectilinear and still:
long flat shadow slabs, square plinths, stone that drops and stays. Grey stone chips and dust; the
relationship colour (team) only on the danger edge (the far end of a shadow that will topple, the ring where
the great shard lands) and on the shards' cut tops.

Anchors (src/render/director.ts): the planted shard and the great shadow are rect zones whose anchor is the
rect's START (the shadow runs `length` along the facing: shadow layers are offset forward by half the length);
the topple is a rect area anchored at the rect's CENTRE; Shoulder the Stone is a dash (`path`; a dash def's
instance follows the fighter for as long as she lives, so it carries NO ribbons, path meshes or path
rate-emitters: timed bursts only); Stand Firm fires at the cast and tracks her (`caster`); Felled Shard lands
as a delayed area (the def spawns at the landing, `ground`).
"""
from __future__ import annotations

from vfxkit import (INK, INK2, NOON, WHITE, L, decal, dust, flash, light, mesh, shake, shockwave, vfx)

STONE = "#4C4A53"       # weathered shard body (ironstone)
STONE_LT = "#D3CEC3"    # the honed cut band
GAUNT = "#8A867D"       # honed dialstone
SHADE = "#141419"       # her shadow (cold ink)

XF = [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]


def _bursts(t0: float, t1: float, step: float, n: int) -> list:
    out, t = [], t0
    while t <= t1 + 1e-6:
        out.append([round(t, 3), n])
        t += step
    return out


def _stones(at: str, n: int, speed=(3, 7), size=0.2, delay: float = 0.02, offset=None, spread: float = 160, dir_: str = "up", **kw) -> list:
    """Opaque stone chips: dark ironstone and pale honed stone."""
    return [L("emitter", at=at, offset=offset, count=n, dir=dir_, spreadDeg=spread, speed=list(speed), life=[0.45, 0.75],
              size=[size, size, size * 0.6], sizeVar=[0.6, 1.4], color=[STONE_LT, STONE, GAUNT], alpha=[1, 1, 1, 0], gravity=15, drag=0.7,
              bounce=0.3, texture="chip", blend="chip", spinDeg=[-480, 480], rim=NOON, rimAlpha=0.5, delay=delay or None, secondary=True, **kw)]


def _dust(at: str, n: int, size=1.0, speed=(1.5, 3.0), radius=0.4, delay=0.05, offset=None, **kw) -> list:
    return [L("emitter", at=at, offset=offset, count=n, shape=kw.pop("shape", "ring"), radius=radius, dir=kw.pop("dir", "out"), spreadDeg=35,
              speed=list(speed), life=[0.6, 1.0], size=[size * 0.5, size, size * 1.25], color=["#6E6A62", "#57544E"], alpha=[0, 0.5, 0.3, 0],
              gravity=-0.2, drag=2.6, turbulence=0.3, rotDeg=[0, 360], spinDeg=[-30, 30], texture="dust_puff", blend="alpha", soft=0.3,
              delay=delay or None, secondary=True, **kw)]


def defs() -> list:
    D = []

    # ── passive · Shade-Fed: an enemy is Shaded (a hard shadow pools under them, shade drips off) ──────────
    D.append(vfx("hesmi_passive_shade", 0.7,
                 L("sprite", at="target", follow=True, offset=[0, -1.05, 0], texture="splat", size=[1.4, 2.4, 2.4], color=SHADE, alpha=[0.9, 0.8, 0],
                   life=0.65, blend="ink", rim="team", rimAlpha=0.7, align="ground", rotDeg=[0, 360]),
                 L("emitter", at="target", offset=[0, 0.5, 0], count=6, shape="ring", radius=0.4, dir="down", spreadDeg=8, speed=[2, 3],
                   life=[0.3, 0.45], size=[0.12, 0.08], color=[SHADE, INK2], alpha=[1, 1, 0], texture="drop", blend="ink", rim=NOON, rimAlpha=0.6,
                   align="velocity"),
                 comment="T1 · Shade · Shade-Fed: a hard shadow pools under the enemy with a team rim, shade drips down the body"))

    # ── a1 · Plant Shard: the shard driven in at the point and its 9 × 2.5 m shadow for 3 s (rect zone) ──
    # The zone lasts exactly 3 s, so this def runs the whole life (3.3 s: it never re-loops): the plant, the held
    # shadow, and a tremble in the last half-second before the topple (a separate area def).
    D.append(vfx("hesmi_a1_shadow", 3.3,
                 flash(2, at="ground", color="team", scale=0.7),
                 _stones("ground", 10, speed=(2.5, 5.5), size=0.17, offset=[0, 0.2, 0]),
                 _dust("ground", 6, size=0.9, speed=(1.2, 2.4), radius=0.3, delay=0.02),
                 decal("ground", "crack", [[0, 0.3], [0.04, 0.8], [1, 0.8]], 3.2, color=INK2, alpha=[[0, 0.9], [0.9, 0.8], [1, 0]], emissive=1.2,
                       rim="team", fit=False),
                 # the planted shard: dark ironstone, a pale honed edge, leaning toward its shadow; it trembles at the end
                 mesh("ground", "shard", [[0, 0.6], [0.015, 3.6], [1, 3.6]], 3.05, color=STONE, alpha=[[0, 1], [0.97, 1], [1, 0]], emissive=0,
                      rim=STONE_LT, rim_pow=3.5, rim_emissive=0.8, blend="chip", rotate=[-80, 0, 0], stretch=[0.95, 0.95, 1], fit=False, noise=0),
                 L("sprite", at="ground", offset=[0.3, 1.75, 0], texture="glow", size=0.5, color="team", emissive=2.4,
                   alpha=[[0, 0], [0.05, 0.8], [0.75, 0.8], [0.8, 1], [0.97, 1], [1, 0]], life=3.05, fit=False),
                 # the shadow: a long hard slab of shade running 9 m away from her
                 *[L("decal", at="ground", style="plain", radius=1.0, life=3.05, color=SHADE, alpha=[[0, 0], [0.03, 1.0], [0.95, 1.0], [1, 0]],
                     shape="rect", length=2.0, width=2.5, texture="spark", offset=[4.5, 0, 0], fit=True) for _ in range(2)],
                 L("emitter", at="ground", offset=[0, 0.1, 0], rate=12, duration=2.9, shape="line", length=9.0, width=2.2, dir="forward", spreadDeg=20,
                   speed=[0.2, 0.5], life=[0.8, 1.2], size=[0.5, 0.9, 1.0], color=[SHADE, INK2], alpha=[0, 0.6, 0], gravity=-0.05, drag=1,
                   texture="ink_puff", blend="ink", rim="team", rimAlpha=0.35, rotDeg=[0, 360], soft=0.25, fit=False),
                 # the danger end: a team keyline across the far end of the shadow, brightening before the topple
                 L("emitter", at="ground", offset=[9.0, 0.08, 0], rate=50, duration=2.95, shape="line", length=0.01, width=2.5, dir="none",
                   speed=[0, 0], life=[0.35, 0.5], size=[0.7, 0.55], color="team", alpha=[0, 0.8, 0], emissive=[[0, 2.0], [0.7, 2.0], [1, 4.0]],
                   texture="glow", blend="add", align="ground", fit=False),
                 L("emitter", at="ground", offset=[9.0, 0.1, 0], rate=40, duration=0.55, delay=2.4, shape="line", length=0.01, width=2.5, dir="up",
                   spreadDeg=10, speed=[0.3, 0.8], life=[0.25, 0.4], size=[0.3, 0.1], color="team", alpha=[1, 0], emissive=4.0, texture="spark",
                   stretch=0.04, blend="add", fit=False),
                 # tremble: grit trickles off the shard, it shivers
                 L("emitter", at="ground", offset=[0.2, 1.6, 0], rate=16, duration=0.6, delay=2.35, shape="sphere", radius=0.35, dir="down", spreadDeg=30,
                   speed=[0.2, 0.6], life=[0.4, 0.6], size=[0.09, 0.07], color=[STONE_LT, GAUNT], alpha=[1, 1, 0], gravity=9, texture="chip",
                   blend="chip", fit=False),
                 _dust("ground", 4, size=0.7, speed=(0.4, 0.9), radius=0.3, delay=2.4),
                 comment="T3 · Shade · Plant Shard (rect zone, whole life): the shard is driven in (chips, dust, a crack), a dark stone "
                         "with a pale honed edge and a team-lit cut top leaning toward its 9 × 2.5 m shadow; the shadow is a hard slab "
                         "of shade with low ink drifting along it; the far end carries a team keyline that brightens as the shard "
                         "trembles in the last half-second"))

    # ── a1 · Plant Shard, the topple: the shard falls along its shadow (rect area at the centre, 9 × 2.5) ───
    slam = []
    for i, f in enumerate((-3.6, -1.8, 0.0, 1.8, 3.6)):
        d = 0.03 * i
        slam += _stones("ground", 5, speed=(2.5, 5), size=0.17, delay=d + 0.01, offset=[f, 0.2, 0], spread=120)
        slam += _dust("ground", 3, size=1.1, speed=(1.2, 2.4), radius=0.5, delay=d + 0.03, offset=[f, 0, 0])
    D.append(vfx("hesmi_a1_topple", 1.1,
                 flash(2, at="ground", color="team", scale=1.4),
                 mesh("ground", "shard", 9.0, 0.95, color=STONE, alpha=[[0, 0], [0.04, 1], [0.6, 1], [1, 0]], emissive=0, rim=STONE_LT, rim_pow=3.5,
                      rim_emissive=0.8, blend="chip", stretch=[0.65, 0.45, 1], dissolve=[[0, 0], [0.55, 0], [1, 1]], edge="team", edge_emissive=2.0,
                      fit=False, noise=0.3),
                 decal("ground", "crack", 1.0, 1.0, color=INK2, alpha=(0.95, 0.8, 0), emissive=1.8, rim="team", shape="rect", length=2.0, width=2.6,
                       fit=True),
                 decal("ground", "plain", 1.0, 0.6, color=SHADE, alpha=(1.0, 0.8, 0), shape="rect", length=2.0, width=2.5, texture="spark", fit=True),
                 L("emitter", at="ground", offset=[-4.5, 0.1, 0], count=24, shape="line", length=9.0, width=2.6, dir="up", spreadDeg=40, speed=[2, 4],
                   life=[0.15, 0.3], size=[0.4, 0.1], color="team", alpha=[1, 0], emissive=3.0, drag=2.5, texture="spark", stretch=0.04, blend="add",
                   fit=False),
                 *slam,
                 shake(0.35),
                 comment="T2 · Shade · Plant Shard topple: the shard falls flat along its shadow: a long stone slab lies the 9 m length "
                         "and dissolves at a team edge, the ground cracks the length of it, chips and dust burst in sequence from her end "
                         "to the far end, team sparks along it"))

    # ── a2 · Shoulder the Stone: a low shoulder charge, 4.5 m at 13 m/s, knocking them aside (dash) ─────────
    tr = _bursts(0.0, 0.38, 0.02, 2)
    D.append(vfx("hesmi_a2_shoulder", 0.55,
                 flash(2, at="origin", color="team", scale=0.6, light=False),
                 _dust("ground", 7, size=1.0, speed=(1.5, 3.0), radius=0.3, delay=0.0),
                 _stones("ground", 6, speed=(2, 4.5), size=0.15, delay=0.0),
                 # a dark slab of shade shoved ahead of the shoulder; stone and shade thrown to both sides (aside)
                 L("emitter", at="path", offset=[0.75, -0.7, 0], bursts=_bursts(0.0, 0.38, 0.02, 2), shape="line", length=0.01, width=1.4,
                   dir="forward", spreadDeg=50, speed=[1.5, 3], velocity=[0, 0.8, 0], life=[0.3, 0.5], size=[0.5, 0.9, 1.0], color=["#6E6A62", "#57544E"],
                   alpha=[0, 0.55, 0], drag=3, texture="dust_puff", blend="alpha", rotDeg=[0, 360], soft=0.3),
                 L("emitter", at="path", offset=[0.9, -0.5, 0], bursts=_bursts(0.0, 0.38, 0.04, 2), shape="line", length=0.01, width=1.2,
                   dir="forward", spreadDeg=60, speed=[3, 6], velocity=[0, 1.5, 0], life=[0.3, 0.5], size=[0.15, 0.15, 0.09], sizeVar=[0.6, 1.3],
                   color=[STONE_LT, STONE, GAUNT], alpha=[1, 1, 0], gravity=14, drag=1, bounce=0.3, texture="chip", blend="chip",
                   spinDeg=[-480, 480], rim=NOON, rimAlpha=0.5),
                 L("emitter", at="path", offset=[0.6, -0.6, 0.4], bursts=_bursts(0.0, 0.38, 0.04, 1), shape="sphere", radius=0.2, dir="none",
                   velocity=[1.5, 1.5, 5], speed=[0, 0], life=[0.4, 0.6], size=[0.17, 0.17, 0.1], sizeVar=[0.6, 1.3], color=[STONE_LT, STONE, GAUNT],
                   alpha=[1, 1, 0], gravity=14, drag=1, bounce=0.3, texture="chip", blend="chip", spinDeg=[-480, 480], rim=NOON, rimAlpha=0.5),
                 L("emitter", at="path", offset=[0.6, -0.6, -0.4], bursts=_bursts(0.02, 0.38, 0.04, 1), shape="sphere", radius=0.2, dir="none",
                   velocity=[1.5, 1.5, -5], speed=[0, 0], life=[0.4, 0.6], size=[0.17, 0.17, 0.1], sizeVar=[0.6, 1.3], color=[STONE_LT, STONE, GAUNT],
                   alpha=[1, 1, 0], gravity=14, drag=1, bounce=0.3, texture="chip", blend="chip", spinDeg=[-480, 480], rim=NOON, rimAlpha=0.5),
                 L("emitter", at="path", offset=[0.4, -0.7, 0], bursts=_bursts(0.0, 0.38, 0.03, 2), shape="sphere", radius=0.3, dir="out",
                   spreadDeg=40, velocity=[0, 0.4, 0], speed=[2, 3.5], life=[0.4, 0.65], size=[0.5, 0.9, 1.1], color=["#6E6A62", "#57544E"],
                   alpha=[0, 0.5, 0], drag=2.5, texture="dust_puff", blend="alpha", rotDeg=[0, 360], soft=0.3),
                 # her wake: a hard shade band on the ground, team side-streaks
                 L("emitter", at="path", offset=[0, -0.95, 0], bursts=tr, shape="sphere", radius=0.12, dir="back", spreadDeg=4, speed=[2.4, 2.8],
                   life=[0.35, 0.45], size=[1.0, 0.85], color=SHADE, alpha=[0.6, 0.45, 0], texture="ink_puff", frame=2, blend="ink", rim="team",
                   rimAlpha=0.25, stretch=0.32, soft=0.1),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.38, 0.025, 2), shape="sphere", radius=0.55, dir="back", spreadDeg=18, speed=[3, 6],
                   life=[0.08, 0.16], size=[0.42, 0.1], color="team", alpha=[0.9, 0], emissive=4.0, drag=3, texture="streak", stretch=0.06, blend="add"),
                 comment="T3 · Shade · Shoulder the Stone: a dark slab of shade with a team rim is shoved ahead of her shoulder, stone "
                         "chips and dust thrown to both sides (knocked aside), a hard shade band and team side-streaks behind. Timed bursts"))

    # ── a3 · Stand Firm: gauntlets clack, standing stones rise round her, a still shell of shade for 2.5 s (cast) ──
    D.append(vfx("hesmi_a3_firm", 2.6,
                 L("sprite", at="caster", follow=True, offset=[0.35, 0.35, 0], texture="flare", size=[0.4, 1.6, 1.0], color=[NOON, "team"], emissive=3.0,
                   alpha=[1, 1, 0], life=0.18, delay=0.3),
                 L("emitter", at="caster", offset=[0.35, 0.35, 0], count=10, shape="sphere", radius=0.1, dir="out", spreadDeg=180, speed=[3, 6],
                   life=[0.1, 0.2], size=[0.16, 0.05], color=[NOON, "team"], alpha=[1, 0], emissive=3.0, drag=3, texture="spark", stretch=0.03,
                   blend="add", delay=0.3),
                 shockwave("caster", radius=(0.4, 1.3), width=(0.25, 0.06), life=0.35, emissive=2.4, delay=0.3),
                 # standing stones: a ring of dark stones rises round her feet (up = help) and settles back
                 mesh("caster", "shard", [[0, 0.0], [0.08, 1.5], [0.75, 1.45], [1, 0.0]], 1.6, color=STONE, alpha=1, emissive=0, rim=STONE_LT,
                      rim_pow=3.5, rim_emissive=0.8, blend="chip", rotate=[-90, 0, 17], stretch=[0.85, 0.85, 1], offset=[1.099, -1.0, 0.34],
                      follow=True, hold=1, delay=0.28, noise=0),
                 mesh("caster", "shard", [[0, 0.0], [0.08, 1.5], [0.75, 1.45], [1, 0.0]], 1.6, color=STONE, alpha=1, emissive=0, rim=STONE_LT,
                      rim_pow=3.5, rim_emissive=0.8, blend="chip", rotate=[-90, 0, 77], stretch=[0.85, 0.85, 1], offset=[0.255, -1.0, 1.121],
                      follow=True, hold=1, delay=0.30, noise=0),
                 mesh("caster", "shard", [[0, 0.0], [0.08, 1.5], [0.75, 1.45], [1, 0.0]], 1.6, color=STONE, alpha=1, emissive=0, rim=STONE_LT,
                      rim_pow=3.5, rim_emissive=0.8, blend="chip", rotate=[-90, 0, 137], stretch=[0.85, 0.85, 1], offset=[-0.844, -1.0, 0.782],
                      follow=True, hold=1, delay=0.32, noise=0),
                 mesh("caster", "shard", [[0, 0.0], [0.08, 1.5], [0.75, 1.45], [1, 0.0]], 1.6, color=STONE, alpha=1, emissive=0, rim=STONE_LT,
                      rim_pow=3.5, rim_emissive=0.8, blend="chip", rotate=[-90, 0, 197], stretch=[0.85, 0.85, 1], offset=[-1.099, -1.0, -0.34],
                      follow=True, hold=1, delay=0.34, noise=0),
                 mesh("caster", "shard", [[0, 0.0], [0.08, 1.5], [0.75, 1.45], [1, 0.0]], 1.6, color=STONE, alpha=1, emissive=0, rim=STONE_LT,
                      rim_pow=3.5, rim_emissive=0.8, blend="chip", rotate=[-90, 0, 257], stretch=[0.85, 0.85, 1], offset=[-0.255, -1.0, -1.121],
                      follow=True, hold=1, delay=0.36, noise=0),
                 mesh("caster", "shard", [[0, 0.0], [0.08, 1.5], [0.75, 1.45], [1, 0.0]], 1.6, color=STONE, alpha=1, emissive=0, rim=STONE_LT,
                      rim_pow=3.5, rim_emissive=0.8, blend="chip", rotate=[-90, 0, 317], stretch=[0.85, 0.85, 1], offset=[0.844, -1.0, -0.782],
                      follow=True, hold=1, delay=0.38, noise=0),
                 _dust("caster", 6, size=0.8, speed=(0.8, 1.6), radius=0.9, delay=0.3, offset=[0, -1.0, 0]),
                 # the plinth: a square of hard shade under her, a team fresnel shell holding still
                 decal("ground", "plain", 1.0, 2.5, color=SHADE, alpha=[[0, 0], [0.05, 1.0], [0.9, 0.9], [1, 0]], shape="rect", length=2.0, width=2.0,
                       texture="ring_thin", fit=False),
                 mesh("caster", "pillar", [[0, 0.6], [0.05, 1.0], [1, 1.0]], 2.5, color="team", alpha=[[0, 0], [0.05, 1], [0.88, 1], [1, 0]],
                      emissive=0.06, rim="team", rim_pow=3.5, rim_emissive=3.0, stretch=[1.7, 2.5, 1.7], offset=[0, -1.0, 0], mask="top", mask_param=0.55,
                      follow=True, hold=1, noise=0.5, noise_scale=2.0, scroll=[0, -0.4]),
                 L("emitter", at="caster", follow=True, offset=[0, -1.0, 0], rate=8, duration=2.4, shape="ring", radius=0.75, dir="up", spreadDeg=10,
                   speed=[0.4, 0.8], life=[0.6, 0.9], size=[0, 0.14, 0], color=[STONE_LT, "team"], alpha=[0, 0.9, 0], emissive=2.0, texture="mote",
                   blend="add"),
                 comment="T2 · Shade · Stand Firm: the gauntlets clack (a pale flash and sparks at the chest, a team ring), a ring of "
                         "dark standing stones rises round her feet and settles back; a square plinth of hard shade under her and a "
                         "still team fresnel shell hold for 2.5 s, pale motes rise (help is up)"))

    # ── ult · Felled Shard, the impact: the great shard lands 0.75 s after the cast (delayed area, r 2, T4) ───
    D.append(vfx("hesmi_ult_shard", 1.5,
                 flash(4, at="ground", scale=1.5),
                 mesh("ground", "column", [[0, 1.0], [1, 0.6]], 0.16, color=[WHITE, "team"], alpha=(1, 0), emissive=12, mask="top", mask_param=0.3,
                      stretch=[1.2, 10.0, 1.2], fit=False, noise=0.2, scroll=[0, -6.0]),
                 # the great shard stands where it fell for the shadow's 5 s
                 mesh("ground", "shard", [[0, 4.2], [0.004, 5.6], [1, 5.6]], 5.75, color=STONE, alpha=[[0, 1], [0.97, 1], [1, 0]], emissive=0,
                      rim=STONE_LT, rim_pow=3.5, rim_emissive=0.9, blend="chip", rotate=[-84, 0, 6], stretch=[1.15, 1.15, 1], fit=False, noise=0),
                 L("sprite", at="ground", offset=[0.3, 2.75, 0], texture="glow", size=0.8, color="team", emissive=3.0,
                   alpha=[[0, 0], [0.02, 1], [0.95, 0.7], [1, 0]], life=5.75, fit=False),
                 shockwave("ground", radius=(0.2, 1.05), width=(0.8, 0.15), life=0.4, emissive=10, sharp=2.2, fit=True),
                 shockwave("ground", color=INK2, radius=(0.25, 1.6), width=(1.0, 0.3), life=0.55, emissive=0, blend="ink", alpha=(0.85, 0.6, 0), fit=True,
                           delay=0.03),
                 decal("ground", "crack", [[0, 0.5], [0.06, 1.45], [1, 1.5]], 2.2, color=INK2, alpha=(1, 0.85, 0), emissive=3.0, rim="team", fit=True),
                 _stones("ground", 26, speed=(4, 9), size=0.24, offset=[0, 0.3, 0]),
                 _dust("ground", 14, size=1.6, speed=(3, 5), radius=0.9, delay=0.08),
                 L("emitter", at="ground", count=16, shape="ring", radius=0.9, dir="out", spreadDeg=30, speed=[5, 9], life=[0.15, 0.3], size=[0.5, 0.15],
                   color=[WHITE, "team"], alpha=[1, 0], emissive=10, drag=2.5, texture="streak", stretch=0.05, blend="add", offset=[0, 0.3, 0], fit=False),
                 light("ground", "team", 26, 9, 0.5),
                 shake(0.7),
                 comment="T4 · Shade · Felled Shard: a white streak from the sky and a white core; the great shard is driven in and "
                         "stands for the shadow's 5 s (dark ironstone, pale honed edge, a team-lit cut top); a team ring to 2 m, an ink "
                         "ring and a wide crack beyond it, heavy stone and dust thrown out"))

    # ── ult · Felled Shard, the great shadow: 12 × 5 m for 5 s (rect zone loop; slows and Shades) ─────────
    D.append(vfx("hesmi_ult_shadow", 1.0,
                 *[L("decal", at="ground", style="plain", radius=1.0, life=1.06, color=SHADE, alpha=[[0, 0], [0.04, 1.0], [0.95, 1.0], [1, 0]],
                     shape="rect", length=2.0, width=5.0, texture="spark", offset=[6.0, 0, 0], fit=True) for _ in range(2)],
                 L("emitter", at="ground", offset=[0, 0.1, 0], rate=26, shape="line", length=12.0, width=4.6, dir="forward", spreadDeg=20,
                   speed=[0.2, 0.5], life=[0.8, 1.2], size=[0.6, 1.1, 1.3], color=[SHADE, INK2], alpha=[0, 0.6, 0], gravity=-0.05, drag=1,
                   texture="ink_puff", blend="ink", rim="team", rimAlpha=0.35, rotDeg=[0, 360], soft=0.25, fit=False),
                 L("emitter", at="ground", offset=[12.0, 0.08, 0], rate=80, shape="line", length=0.01, width=5.0, dir="none", speed=[0, 0],
                   life=[0.35, 0.5], size=[0.75, 0.6], color="team", alpha=[0, 0.8, 0], emissive=2.4, texture="glow", blend="add", align="ground",
                   fit=False),
                 L("emitter", at="ground", offset=[0, 0.3, 0], rate=10, shape="line", length=12.0, width=4.6, dir="down", spreadDeg=10, speed=[0.1, 0.3],
                   life=[0.6, 1.0], size=[0, 0.1, 0], color=[STONE_LT, GAUNT], alpha=[0, 0.8, 0], texture="mote", blend="alpha", fit=False,
                   secondary=True),
                 comment="T3 · Shade · Felled Shard great shadow (zone loop): a 12 × 5 m hard slab of shade running away from the shard, "
                         "low ink drifting along it, grit settling, a team keyline across the far end"))
    return D
