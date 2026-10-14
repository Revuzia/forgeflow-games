"""Nurrow (Striker, lull singer): bespoke ability VFX.

Identity: the snuffed lamp. Shade family: plum-black ink that moves like felt, always under a
Noonwhite or team rim; soft rings that widen like a sung note; pale lilac felt petals that sink in a
slow spiral (sleep is control: spiral, and down). Almost no sparks: she is silent. The one light she
allows is the clear light left on the target she chose (the ultimate).
"""
from __future__ import annotations

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, INK, INK2, NOON, L, chips, decal, dust, flash, glow, ink, light, mesh, ribbon, shake,
                    shockwave, sparks, vfx)

PLUM = "#2B2433"        # plum-black ink
PLUM2 = "#3E3440"       # her palette primary
LILAC = "#B7B4BE"       # the sleeping mask, pale felt
LILAC2 = "#8E8798"
WHITE_T = "#FFFFFF"     # T4 only


def felt(at: str, n: int, radius: float = 0.6, orbit: float = 160, delay: float = 0.0, offset=None, fit: bool | None = None,
         rate: float | None = None, life=(0.7, 1.1)) -> list:
    """pale felt petals that sink in a slow spiral (sleep: control and down)"""
    return [L("emitter", at=at, count=None if rate else n, rate=rate, offset=offset, shape="ring", radius=radius, dir="down", spreadDeg=20,
              speed=[0.2, 0.5], life=list(life), size=[0.2, 0.17, 0.1], sizeVar=[0.7, 1.3], color=[LILAC, LILAC2], alpha=[0, 1, 0.9, 0],
              gravity=0.5, drag=1.5, orbitDeg=orbit, turbulence=0.4, rotDeg=[0, 360], spinDeg=[-200, 200], texture="petal", blend="alpha",
              rim="team", rimAlpha=0.55, delay=delay or None, fit=fit, secondary=True)]


def defs() -> list:
    D = []

    # ── passive · Quiet Kill (takedown: enemies within 5 m sleep 1 s; area circle 5 at self; T1) ─────
    D.append(vfx("nurrow_passive_hush", 1.2,
                 # the snuffed wick: a thin curl of ink smoke off her, a dying team ember
                 glow("origin", "team", 0.5, 0.25, 1.5, alpha=(1, 0.6, 0), offset=[0, 0.7, 0], soft=0.05),
                 ink("origin", 4, size=0.5, speed=(0.4, 0.9), life=(0.5, 0.8), color=(PLUM, PLUM2), dir_="up", radius=0.08, gravity=-0.6,
                     rim_alpha=0.7),
                 # the hush rolls out to 5 m: an ink wave under a light rim, the team edge brightest
                 shockwave("ground", color=PLUM, radius=(0.1, 1.0), width=(0.5, 0.2), life=0.7, emissive=0, blend="ink", alpha=(0.85, 0.6, 0),
                           sharp=1.2, noise=0.5),
                 shockwave("ground", color="team", radius=(0.12, 1.02), width=(0.08, 0.04), life=0.7, emissive=1.5, alpha=(1, 0.8, 0), sharp=2.2),
                 ink("ground", 10, size=0.9, speed=(2.5, 4.5), life=(0.5, 0.8), color=(PLUM, PLUM2), dir_="out", radius=0.2, shape="disc",
                     gravity=0.1, rim_alpha=0.5),
                 felt("ground", 10, radius=0.55, orbit=120, delay=0.15),
                 comment="T1 · Shade · Quiet Kill: a wick is snuffed on her (a dying team ember, a curl of ink smoke), then a hush of ink rolls"
                         " out to 5 m under a team edge, felt petals spiral down (sleep)"))

    # ── a1 · Felt Step (dash toPoint 4 m at 18 m/s; T3) ────────────────────────────────────────────
    D.append(vfx("nurrow_a1_step", 0.6,
                 ink("origin", 5, size=0.8, speed=(0.5, 1.2), life=(0.35, 0.6), color=(PLUM, PLUM2), dir_="out", radius=0.25, shape="disc",
                     gravity=0.4),
                 ribbon("path", PLUM, width=(0.0, 1.0), life=0.34, alpha=(0, 0.9), emissive=0, noise=0.5, blend="ink", rim="team", face="ground"),
                 ribbon("path", "team", width=(0.0, 0.16), life=0.18, alpha=(0, 0.7), emissive=2.6, noise=0.2),
                 L("emitter", at="path", perMeter=4, offset=[0, -0.5, 0], shape="sphere", radius=0.25, dir="back", spreadDeg=50, speed=[0.4, 1.0],
                   life=[0.3, 0.55], size=[0.35, 0.7, 0.8], sizeVar=[0.8, 1.25], color=[PLUM, PLUM2], alpha=[0, 0.85, 0.6, 0], gravity=0.8, drag=2.6,
                   turbulence=0.5, rotDeg=[0, 360], spinDeg=[-40, 40], texture="ink_puff", blend="ink", rim="team", rimAlpha=0.6, soft=0.3),
                 L("emitter", at="path", rate=20, shape="disc", radius=0.4, dir="back", spreadDeg=12, speed=[4, 7], life=[0.08, 0.14],
                   size=[0.45, 0.08], color="team", alpha=[0.8, 0], emissive=2.4, drag=3, texture="streak", stretch=0.06, blend="add"),
                 felt("path", 4, radius=0.3, orbit=60, offset=[0, 0.2, 0], life=(0.5, 0.8)),
                 comment="T3 · Shade · Felt Step: a silent lunge, a plum ink smear along the ground under a team rim, ink puffs that sink"
                         " behind her, a thin team streak (movement), a few felt petals"))

    # ── a2 · Lullaby Dart: the dart (projectile 22 m/s, 8 m; T2) ─────────────────────────────────
    D.append(vfx("nurrow_a2_lullaby", 0.7,
                 flash(2, at="origin", color=LILAC, scale=0.5, light=False),
                 mesh("path", "spike", 0.6, 0.7, color=PLUM, alpha=1, emissive=0, rim="team", rim_pow=1.0, rim_emissive=2.8, blend="ink",
                      align="velocity", stretch=[0.3, 0.3, 1.5], hold=1),
                 ribbon("path", PLUM2, width=(0.0, 0.32), life=0.3, alpha=(0, 0.8), emissive=0, noise=0.6, blend="ink", rim="team"),
                 # the song: soft rings widen off the dart like held notes
                 L("emitter", at="path", rate=11, dir="none", speed=[0, 0], life=[0.35, 0.5], size=[0.15, 0.55, 0.75], color=["team", LILAC],
                   alpha=[0.9, 0.5, 0], emissive=2.0, texture="ring_thin", blend="add", rotDeg=[0, 0], soft=0.05),
                 ink("path", 0, size=0.35, speed=(0.1, 0.3), life=(0.3, 0.45), rate=18, color=(PLUM, PLUM2), dir_="back", radius=0.06,
                     gravity=0.7, rim_alpha=0.6),
                 comment="T2 · Shade · Lullaby Dart: a slim plum-ink needle inside a team rim, a wavering ink wake that sinks, soft team"
                         " rings widen off it like held notes"))

    # ── a2 · Lullaby Dart: asleep (hit on the fighter it reaches; sleep 1.05 s; T2) ───────────────
    D.append(vfx("nurrow_a2_drowse", 1.15,
                 flash(2, at="target", color=LILAC, scale=0.6, light=False),
                 # a hood of ink settles over the head, under a light rim
                 [dict(x, offset=[0, 0.75, 0]) for x in ink("target", 7, size=0.65, speed=(0.15, 0.45), life=(0.7, 1.05), color=(PLUM, PLUM2),
                                                         dir_="out", radius=0.25, gravity=0.5, rim_alpha=0.7)],
                 # the closing note: a team ring narrows onto them; felt petals spiral down past the shoulders
                 shockwave("target", color="team", radius=(0.95, 0.35), width=(0.08, 0.04), life=0.55, emissive=2.4, alpha=(0, 1, 0.6)),
                 felt("target", 9, radius=0.55, orbit=200, offset=[0, 0.9, 0], life=(0.8, 1.1)),
                 L("emitter", at="target", count=3, delay=0.1, offset=[0, 1.2, 0], dir="none", speed=[0, 0], life=[0.5, 0.7],
                   size=[0.2, 0.6, 0.8], color=["team", LILAC], alpha=[0.8, 0.4, 0], emissive=1.8, texture="ring_thin", blend="add", soft=0.05),
                 comment="T2 · Shade · asleep: a hood of ink settles over the head under a light rim, a team ring narrows onto them, felt"
                         " petals spiral down past the shoulders (control, down), a last soft note"))

    # ── a3 · Snuff (unit target, magic damage + silence; the hit; T2) ──────────────────────────────
    D.append(vfx("nurrow_a3_snuff", 0.9,
                 # the snuffer comes down over the head and clamps (her hat's shape)
                 mesh("target", "cone", [[0, 1.25], [0.25, 0.8], [1, 0.75]], 0.42, color=PLUM, alpha=[[0, 0], [0.12, 1], [0.7, 1], [1, 0]],
                      emissive=0.6, rim=NOON, rim_pow=5.0, rim_emissive=1.2, blend="chip", noise=0.2, stretch=[1.25, 0.75, 1.25], offset=[0, 0.45, 0],
                      fit=False),
                 # its brim carries the team light (her hat's accent is on the rim)
                 mesh("target", "ringwave", [[0, 1.25], [0.25, 0.8], [1, 0.75]], 0.42, color="team", alpha=[[0, 0], [0.12, 1], [0.7, 1], [1, 0]],
                      emissive=3.0, align="up", mask="edge", mask_param=0.97, offset=[0, 0.47, 0], fit=False),
                 # the blade's cut: a dark crescent with a light rim across them
                 mesh("target", "crescent", [[0, 0.6], [0.35, 1.3], [1, 1.35]], 0.16, color=[PLUM], alpha=(1, 0.9, 0), emissive=0, rim="team",
                      rim_pow=1.0, rim_emissive=3.0, blend="ink", mask="sweep", mask_param=[[0, 0], [1, 1.05]], align="flat", rotate=[0, 0, 0],
                      offset=[-0.2, 0.0, 0], fit=False),
                 flash(2, at="target", color=NOON, scale=0.7, light=False),
                 # the light goes out: the team ember under the cone gutters, a thin curl of smoke escapes the tip
                 glow("target", "team", 0.9, 0.3, 2.6, alpha=(1, 0.5, 0), offset=[0, 0.6, 0], soft=0.05),
                 L("emitter", at="target", count=5, delay=0.22, offset=[0, 1.05, 0], dir="up", spreadDeg=12, speed=[0.5, 1.0], life=[0.45, 0.65],
                   size=[0.12, 0.3, 0.42], color=[PLUM2, LILAC2], alpha=[0, 0.8, 0], gravity=-0.2, drag=1.2, turbulence=1.2, rotDeg=[0, 360],
                   texture="ink_puff", blend="ink", rim=NOON, rimAlpha=0.6, soft=0.2),
                 ink("target", 6, size=0.6, speed=(1.5, 2.8), life=(0.3, 0.5), color=(PLUM, PLUM2), dir_="out", radius=0.2, shape="disc",
                     gravity=0.5),
                 L("emitter", at="target", count=7, shape="sphere", radius=0.1, dir="out", spreadDeg=180, speed=[2.5, 4.5], life=[0.25, 0.4],
                   size=[0.14, 0.09], color=[INK, PLUM], alpha=[1, 1, 0], gravity=9, drag=1.0, texture="drop", blend="ink", rim=NOON, rimAlpha=0.7),
                 comment="T2 · Shade · Snuff: a plum snuffer cone drops over the head and clamps under a team rim, a dark blade crescent cuts"
                         " across, the team ember under it gutters and a curl of smoke escapes the tip, ink drops thrown out"))

    # ── ult · Lull the Rest: the lunge (dash to the chosen target; T3) ──────────────────────────────
    D.append(vfx("nurrow_ult_lunge", 0.6,
                 ink("origin", 8, size=1.0, speed=(0.8, 1.8), life=(0.4, 0.65), color=(PLUM, PLUM2), dir_="out", radius=0.3, shape="disc",
                     gravity=0.3),
                 shockwave("origin", color="team", radius=(0.2, 1.0), width=(0.14, 0.04), life=0.3, emissive=3.0),
                 ribbon("path", PLUM, width=(0.0, 1.4), life=0.4, alpha=(0, 0.9), emissive=0, noise=0.6, blend="ink", rim="team", face="ground"),
                 ribbon("path", "team", width=(0.0, 0.3), life=0.24, alpha=(0, 0.75), emissive=3.0, noise=0.2),
                 L("emitter", at="path", perMeter=5, offset=[0, -0.4, 0], shape="sphere", radius=0.3, dir="back", spreadDeg=60, speed=[0.4, 1.2],
                   life=[0.35, 0.6], size=[0.45, 0.85, 1.0], sizeVar=[0.8, 1.25], color=[PLUM, PLUM2], alpha=[0, 0.9, 0.6, 0], gravity=0.8,
                   drag=2.6, turbulence=0.5, rotDeg=[0, 360], spinDeg=[-40, 40], texture="ink_puff", blend="ink", rim="team", rimAlpha=0.65,
                   soft=0.3),
                 felt("path", 6, radius=0.35, orbit=90, offset=[0, 0.3, 0], life=(0.6, 0.9)),
                 comment="T3 · Shade · Lull the Rest lunge: an ink burst where she leaves, a wide plum smear and a team streak to the chosen"
                         " one, ink puffs sink behind, felt petals"))

    # ── ult · Lull the Rest: the lull (area circle 5 at the chosen target; T4) ──────────────────────
    D.append(vfx("nurrow_ult_lull", 1.8,
                 flash(4, at="target", color=LILAC, scale=0.9),
                 # the chosen one is left in clear light
                 mesh("target", "pillar", [[0, 0.5], [0.15, 1.0], [1, 0.9]], 1.3, color=[WHITE_T, "team"], alpha=[[0, 0.9], [0.4, 0.5], [1, 0]],
                      emissive=8, mask="top", mask_param=0.5, stretch=[0.75, 3.2, 0.75], offset=[0, -1.0, 0], noise=0.4, scroll=[0, 1.6], rim="team",
                      rim_pow=1.5, rim_emissive=6, fit=False),
                 # dusk falls on everyone else: an ink shell settles over the 5 m and thins out
                 mesh("ground", "dome", [[0, 2.3], [0.2, 2.0], [1, 2.0]], 1.2, color=PLUM, alpha=[[0, 0], [0.12, 0.5], [0.6, 0.35], [1, 0]],
                      emissive=0, rim="team", rim_pow=4.0, rim_emissive=5, blend="ink", noise=0.8, noise_scale=1.2, scroll=[0.05, -0.3],
                      stretch=[1, 0.55, 1], fit=True),
                 shockwave("ground", color=PLUM, radius=(0.08, 1.0), width=(0.7, 0.25), life=0.65, emissive=0, blend="ink", alpha=(0.9, 0.7, 0),
                           sharp=1.2, noise=0.5),
                 shockwave("ground", color="team", radius=(0.1, 1.02), width=(0.35, 0.08), life=0.6, emissive=8, sharp=2.0),
                 shockwave("ground", color="team", radius=(1.0, 1.0), width=(0.08, 0.08), life=1.5, emissive=4, alpha=(0, 1, 0.8, 0), delay=0.5),
                 ink("ground", 22, size=1.5, speed=(3, 5.5), life=(0.6, 1.0), color=(PLUM, PLUM2), dir_="out", radius=0.25, shape="disc",
                     gravity=0.2),
                 felt("ground", 26, radius=0.75, orbit=110, offset=[0, 2.2, 0], delay=0.2, life=(1.0, 1.4)),
                 decal("ground", "ink", [[0, 0.3], [0.15, 1.0], [1, 1.0]], 1.7, color=PLUM, alpha=(0.75, 0.6, 0), rim="team", texture="ink_puff"),
                 light("target", LILAC, 16, 8, 0.5),
                 shake(0.5),
                 comment="T4 · Shade · Lull the Rest: white core flash, the chosen one stands in a clear column of light while dusk falls on"
                         " the rest: an ink shell settles over 5 m under a bright team rim and thins away, an ink wave rolls out with the team"
                         " edge brightest, felt petals spiral down everywhere (sleep), an ink stain"))
    return D
