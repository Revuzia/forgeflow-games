"""Burdam (Breaker · Serenade · the grudge holder with the ironstone cleaver): bespoke VFX.

Identity: Shade. Ink that stains and settles, heavy overhand chops, rings that close in on him like a debt
being called. Warm sandstone and oxidised-iron chips (his mask and cleaver), ink bodies with a pale rim, and
the relationship colour (team) only on the cutting edge and the closing ring. Grudges read as notches: short,
hard, upright ink strokes.

Anchors (src/render/director.ts): Bear Down's lunge rides the fighter (`path`; a dash def's instance follows
the fighter for as long as he lives, so it carries NO ribbons, path meshes or path rate-emitters: the lunge is
built from timed bursts); the chop lands as the ability's hit (`target`); Stubborn's brace is a cast at his
body (`caster`, tracked) and its stamp an area (`ground`, r 3); Old Wound is a 4 m, 100° cone and Settled
Account a 7 m circle at his feet (`ground`).
"""
from __future__ import annotations

from vfxkit import (DUST, DUST2, INK, INK2, NOON, WHITE, L, chips, decal, dust, flash, ink, light, mesh, shake, shockwave, sparks, vfx)

SAND = "#D4C2A0"        # the ledger mask (pale ochre lacquer)
RUST = "#B8A794"        # oxidised pauldrons
IRON = "#4B4039"        # the cleaver spine
INK_W = "#241D19"       # warm ink (iron-brown shadow)


def _bursts(t0: float, t1: float, step: float, n: int) -> list:
    out, t = [], t0
    while t <= t1 + 1e-6:
        out.append([round(t, 3), n])
        t += step
    return out


def _drops(at: str, n: int, speed=(2.5, 5.0), size=0.15, delay: float = 0.0, offset=None, dir_: str = "up", spread: float = 70,
           shape: str = "sphere", radius: float = 0.15, fit=None, **kw) -> list:
    return [L("emitter", at=at, offset=offset, count=n, shape=shape, radius=radius, dir=dir_, spreadDeg=spread, speed=list(speed),
              life=[0.35, 0.6], size=[size, size * 0.7], color=[INK, INK_W], alpha=[1, 1, 0], gravity=12, drag=0.7, texture="drop",
              blend="ink", rim=NOON, rimAlpha=0.65, align="velocity", delay=delay or None, fit=fit, secondary=True, **kw)]


def _ring(at: str, radius, width, life: float, color="team", alpha=(1, 0.8, 0), emissive: float = 2.5, sharp: float = 1.6, noise: float = 0.35,
          delay: float = 0.0, fit=None, blend: str = "add") -> list:
    """A shockwave with a raw radius curve (keys allowed: rings that close inward)."""
    return [L("shockwave", at=at, radius=radius, width=list(width), life=life, color=color, alpha=list(alpha), emissive=emissive, sharp=sharp,
              noise=noise, delay=delay or None, fit=fit, blend=blend)]


def defs() -> list:
    D = []

    # ── passive · Long Memory: a Grudge stack is notched onto the enemy (a hard ink tally stroke over the head) ──
    D.append(vfx("burdam_passive_grudge", 0.8,
                 mesh("target", "shard", [[0, 0.0], [0.12, 0.95], [1, 0.85]], 0.8, color=INK_W, alpha=(1, 1, 0), emissive=0, rim="team",
                      rim_pow=3.0, rim_emissive=1.5, blend="ink", rotate=[-90, 0, 14], stretch=[1.1, 1.1, 1.0], offset=[0, 1.25, 0], follow=True,
                      hold=1, noise=0.2),
                 L("emitter", at="target", offset=[0, 1.35, 0], count=4, shape="sphere", radius=0.08, dir="out", spreadDeg=180, speed=[1.5, 3],
                   life=[0.12, 0.22], size=[0.12, 0.04], color="team", alpha=[1, 0], emissive=1.5, drag=3, texture="spark", stretch=0.03,
                   blend="add"),
                 _drops("target", 3, speed=(0.5, 1.2), size=0.1, offset=[0, 1.1, 0], dir_="down", spread=40),
                 comment="T1 · Shade · Long Memory: a Grudge is notched onto the enemy: a short upright ink stroke with a team rim "
                         "snaps in over the head, a spark where it lands, ink drips off it"))

    # ── a1 · Bear Down: the lunge (dash, up to 5 m at 15 m/s) ────────────────────────────────────────────
    tr = _bursts(0.0, 0.36, 0.02, 2)
    D.append(vfx("burdam_a1_beardown", 0.5,
                 ink("ground", 6, size=0.9, speed=(1.0, 2.4), life=(0.4, 0.7), radius=0.3, shape="disc", dir_="out", gravity=-0.1),
                 chips("ground", 6, color=(SAND, IRON), speed=(2, 4), size=0.14, delay=0.0),
                 dust("ground", 5, size=0.8, speed=(1.2, 2.4), radius=0.25, delay=0.0),
                 # a dark drag mark along the ground and an ink wake off the shoulders
                 L("emitter", at="path", offset=[0, -0.95, 0], bursts=tr, shape="sphere", radius=0.12, dir="back", spreadDeg=4, speed=[2.4, 2.8],
                   life=[0.35, 0.45], size=[0.85, 0.7], color=[INK_W, INK], alpha=[0.6, 0.45, 0], texture="ink_puff", frame=2, blend="ink",
                   rim="team", rimAlpha=0.3, stretch=0.32, soft=0.1),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.36, 0.06, 1), shape="sphere", radius=0.35, dir="back", spreadDeg=40,
                   speed=[0.6, 1.4], life=[0.25, 0.4], size=[0.3, 0.5, 0.6], color=[INK, INK_W], alpha=[0, 0.6, 0], gravity=-0.4, drag=2,
                   turbulence=0.6, texture="ink_puff", blend="ink", rim=NOON, rimAlpha=0.45, rotDeg=[0, 360], spinDeg=[-60, 60], soft=0.25),
                 L("emitter", at="path", bursts=_bursts(0.0, 0.36, 0.025, 2), shape="sphere", radius=0.5, dir="back", spreadDeg=20,
                   speed=[3, 6], life=[0.08, 0.16], size=[0.4, 0.1], color="team", alpha=[0.9, 0], emissive=4.0, drag=3, texture="streak",
                   stretch=0.06, blend="add"),
                 # the cleaver lifts: a glint runs up the blade as he leaves
                 L("emitter", at="path", offset=[-0.2, 1.1, 0.25], bursts=[[0.0, 1], [0.06, 1]], shape="point", dir="none", speed=[0, 0],
                   life=[0.14, 0.14], size=[0.5, 0.9, 0], color=[NOON, "team"], alpha=[1, 0], emissive=4.0, texture="flare", blend="add"),
                 comment="T3 · Shade · Bear Down lunge: launch ink and warm chips at the plant foot, a dark ink drag-mark with a team rim "
                         "runs along the ground, ink peels off the shoulders, team side-streaks; a glint off the lifted cleaver. Timed bursts"))

    # ── a1 · Bear Down: the chop (the ability's hit, at the target) ───────────────────────────────────────
    D.append(vfx("burdam_a1_chop", 0.9,
                 flash(2, at="target", color="team", scale=0.9),
                 # an overhead arc from top to bottom in front of the target: a bright team edge, an ink smear behind it
                 mesh("target", "crescent", [[0, 2.0], [0.4, 2.7], [1, 2.8]], 0.28, color=[NOON, "team"], alpha=(1, 1, 0), emissive=3.0,
                      mask="sweep", mask_param=[[0, 0.05], [0.6, 1.05], [1, 1.15]], rotate=[0, 0, -90], offset=[-0.7, 0.25, 0], stretch=[1, 1, 0.8]),
                 mesh("target", "crescent", [[0, 2.0], [0.4, 2.75], [1, 2.85]], 0.5, color=INK_W, alpha=(0.95, 0.85, 0), emissive=0, rim="team",
                      rim_emissive=2.4, blend="ink", mask="sweep", mask_param=[[0, 0.0], [0.4, 1.0], [1, 1.15]], rotate=[0, 0, -90],
                      offset=[-0.75, 0.25, 0], stretch=[1, 1, 0.8], delay=0.03),
                 decal("target", "crack", [[0, 0.5], [0.12, 1.0], [1, 1.0]], 1.0, color=INK2, alpha=(0.9, 0.7, 0), emissive=1.2, rim="team"),
                 chips("target", 14, color=(SAND, IRON), speed=(3, 7), size=0.16),
                 _drops("target", 6, speed=(2, 4.5), offset=[0, -0.3, 0]),
                 dust("target", 4, size=0.8, radius=0.2),
                 shake(0.2),
                 comment="T2 · Shade · Bear Down chop: the cleaver comes down through the target, top to bottom: a team edge with an ink "
                         "smear behind it, a crack opens at the feet, warm chips and ink drops fly"))

    # ── a2 · Stubborn: the brace (cast, 3 s): the stamp's ring closes on him like a counted debt ─────────────
    D.append(vfx("burdam_a2_brace", 3.0,
                 flash(2, at="caster", color=NOON, scale=0.7, light=False),
                 shockwave("caster", color=INK2, radius=(0.3, 1.3), width=(0.4, 0.12), life=0.35, emissive=0, blend="ink", alpha=(0.85, 0.6, 0)),
                 shockwave("caster", radius=(0.25, 1.2), width=(0.14, 0.04), life=0.3, emissive=2.6),
                 chips("caster", 6, color=(SAND, IRON), speed=(1.5, 3.5), size=0.13),
                 # the countdown: a team ring at 3 m closes to his feet over the 3 s (the stamp comes when it arrives)
                 mesh("caster", "ringwave", [[0, 6.6], [0.08, 6.0], [1, 1.5]], 3.0, color="team", alpha=[[0, 0], [0.06, 0.6], [0.85, 0.75], [1, 0.4]],
                      emissive=[[0, 1.4], [0.8, 1.8], [1, 3.0]], mask="edge", mask_param=0.97, align="up", offset=[0, -1.0, 0], follow=True,
                      hold=1, noise=0.35, noise_scale=3.0, scroll=[0.15, 0]),
                 mesh("caster", "ringwave", [[0, 6.4], [0.08, 5.8], [1, 1.4]], 3.0, color=INK_W, alpha=[[0, 0], [0.06, 0.6], [0.9, 0.7], [1, 0]],
                      emissive=0, blend="ink", mask="edge", mask_param=0.8, align="up", offset=[0, -1.01, 0], follow=True, hold=1, noise=0.6,
                      noise_scale=2.5, scroll=[-0.1, 0]),
                 # set like a post: ink settles round his feet; the notches in the cleaver light one by one
                 L("emitter", at="caster", follow=True, offset=[0, -1.0, 0], rate=9, duration=2.8, shape="ring", radius=0.55, dir="up",
                   spreadDeg=15, speed=[0.2, 0.5], life=[0.6, 0.9], size=[0.4, 0.75, 0.9], color=[INK, INK_W], alpha=[0, 0.55, 0], gravity=-0.1,
                   drag=1.5, turbulence=0.4, texture="ink_puff", blend="ink", rim="team", rimAlpha=0.5, rotDeg=[0, 360], soft=0.25),
                 L("emitter", at="caster", socket="weapon", follow=True, offset=[0, 0.5, 0], bursts=[[0.15, 1], [0.7, 1], [1.25, 1], [1.8, 1], [2.35, 1]],
                   shape="sphere", radius=0.25, dir="none", speed=[0, 0], life=[0.5, 0.5], size=[0, 0.42, 0.3, 0], color="team", alpha=[0, 1, 0],
                   emissive=2.8, texture="glint", blend="add"),
                 comment="T2 · Shade · Stubborn brace: he sets like a post (an ink ring and chips at the feet); a team ring at 3 m, ink "
                         "shadowed, closes on his feet over the 3 s so everyone can count the stamp; ink settles round him, the cleaver's "
                         "notches glint one by one"))

    # ── a2 · Stubborn: the stamp when it ends (area, r 3) ─────────────────────────────────────────────────
    D.append(vfx("burdam_a2_stamp", 1.0,
                 flash(2, at="ground", color="team", scale=1.3),
                 shockwave("ground", color=INK2, radius=(0.15, 0.95), width=(0.7, 0.2), life=0.4, emissive=0, blend="ink", alpha=(0.9, 0.7, 0),
                           fit=True),
                 shockwave("ground", radius=(0.15, 1.0), width=(0.45, 0.1), life=0.32, emissive=3.0, sharp=2.4, fit=True),
                 decal("ground", "crack", [[0, 0.25], [0.1, 0.6], [1, 0.6]], 1.0, color=INK2, alpha=(0.95, 0.75, 0), emissive=1.5, rim="team", fit=True),
                 decal("ground", "ink", [[0, 0.2], [0.1, 0.42], [1, 0.45]], 1.0, color=INK_W, alpha=(0.75, 0.55, 0), rim="team", texture="splat",
                       fit=True),
                 chips("ground", 16, color=(SAND, IRON), speed=(3.5, 7.5), size=0.16),
                 _drops("ground", 10, speed=(3, 6), offset=[0, 0.2, 0], spread=80, shape="ring", radius=0.4, fit=False),
                 dust("ground", 10, size=1.2, speed=(2.5, 4.5), radius=0.5),
                 shake(0.3),
                 comment="T2 · Shade · Stubborn stamp: the debt lands at once: an ink ring and a team edge thrown out to 3 m, a crack "
                         "and an ink stain at his feet, warm chips and ink drops out, a dust ring settles"))

    # ── a3 · Old Wound: a 4 m, 100° waist-high cleave, the wound reopening a beat later (area cone) ─────────
    D.append(vfx("burdam_a3_wound", 1.1,
                 # the sweep, right shoulder to left: a dark ink wake with a bright team cutting edge
                 mesh("ground", "fan", 2.0, 0.3, color=INK_W, alpha=(0.9, 0.85, 0), emissive=0, angle=100, mask="sweep",
                      mask_param=[[0, -0.05], [0.75, 1.0], [1, 1.25]], blend="ink", fit=True, noise=0.4, noise_scale=2.0),
                 mesh("ground", "fan", 2.0, 0.24, color=[[0, NOON], [0.3, "team"], [1, "team"]], alpha=(1, 1, 0), emissive=3.0, angle=100,
                      mask="sweep", mask_param=[[0, 0.0], [0.75, 1.05], [1, 1.3]], fit=True, noise=0.2),
                 L("emitter", at="ground", offset=[0, 0.7, 0], count=14, shape="cone", angleDeg=96, length=3.9, dir="normal", spreadDeg=10,
                   speed=[4, 7], life=[0.1, 0.2], size=[0.4, 0.1], color="team", alpha=[1, 0], emissive=3.0, drag=2.5, texture="streak",
                   stretch=0.05, blend="add", fit=False),
                 L("emitter", at="ground", offset=[0, 0.4, 0], count=12, shape="cone", angleDeg=96, length=3.8, dir="normal", spreadDeg=50,
                   speed=[2.5, 5.5], life=[0.4, 0.6], size=[0.15, 0.15, 0.09], sizeVar=[0.6, 1.3], color=[SAND, IRON], alpha=[1, 1, 1, 0],
                   gravity=14, drag=0.8, bounce=0.35, texture="chip", blend="chip", spinDeg=[-540, 540], rim=NOON, rimAlpha=0.5, delay=0.05,
                   fit=False, secondary=True),
                 # the old wound reopens: after a held beat the ground splits along the arc and weeps ink
                 decal("ground", "crack", [[0, 0.6], [0.1, 0.98], [1, 0.98]], 0.85, color=INK2, alpha=(0.95, 0.8, 0), emissive=1.6, rim="team",
                       shape="cone", angle=100, delay=0.26, fit=True),
                 _drops("ground", 14, speed=(2.0, 4.5), size=0.16, delay=0.28, shape="cone", spread=30, angleDeg=96, length=3.6, fit=False),
                 L("emitter", at="ground", count=7, shape="cone", angleDeg=96, length=3.6, dir="up", spreadDeg=30, speed=[0.4, 1.0],
                   life=[0.45, 0.7], size=[0.3, 0.55, 0.65], color=[INK, INK_W], alpha=[0, 0.7, 0], gravity=-0.3, drag=2, texture="ink_puff",
                   blend="ink", rim="team", rimAlpha=0.5, rotDeg=[0, 360], delay=0.28, fit=False, soft=0.25),
                 comment="T2 · Shade · Old Wound: one long waist-high cleave sweeps the 100° arc right to left (an ink wake behind a bright "
                         "team edge, warm chips thrown out); a held beat later the ground splits along the arc and weeps ink"))

    # ── ult · Settled Account: every Grudge-bearer within 7 m is dragged in and the debt stamped (area, r 7, T4) ──
    D.append(vfx("burdam_ult_account", 1.4,
                 # the reach: an ink ring at 7 m with a team edge closes on him; ink and light are dragged inward
                 _ring("ground", color=INK2, radius=[[0, 1.02], [0.75, 0.25], [1, 0.12]], width=(0.9, 0.3), life=0.34, emissive=0, blend="ink",
                           alpha=(0.95, 0.95, 0.3), fit=True, sharp=1.2),
                 _ring("ground", radius=[[0, 1.0], [0.75, 0.24], [1, 0.1]], width=(0.35, 0.12), life=0.32, emissive=6.0, alpha=(1, 1, 0.4),
                           sharp=2.6, fit=True),
                 L("emitter", at="ground", offset=[0, 0.5, 0], count=34, shape="ring", radius=6.8, dir="in", spreadDeg=6, speed=[17, 22],
                   life=[0.26, 0.32], size=[0.9, 0.5], color=[INK, INK_W], alpha=[0.9, 0.7, 0], drag=0.5, texture="wisp", blend="ink", rim="team",
                   rimAlpha=0.6, align="velocity", aspect=0.4, fit=False),
                 L("emitter", at="ground", offset=[0, 0.8, 0], count=26, shape="ring", radius=6.8, dir="in", spreadDeg=8, speed=[18, 24],
                   life=[0.22, 0.3], size=[0.6, 0.2], color="team", alpha=[1, 0.4], emissive=6.0, drag=0.4, texture="streak", stretch=0.05,
                   blend="add", fit=False),
                 # the stamp: the cleaver tip comes down, white core, the account closed
                 flash(4, at="ground", scale=1.5, delay=0.3),
                 mesh("ground", "column", [[0, 0.8], [1, 0.4]], 0.3, color=[WHITE, "team"], alpha=(1, 0), emissive=10, mask="top", mask_param=0.5,
                      stretch=[0.5, 3.6, 0.5], delay=0.3, fit=False, noise=0.3, scroll=[0, 2.0]),
                 shockwave("ground", radius=(0.05, 0.42), width=(0.7, 0.15), life=0.4, emissive=10, sharp=2.0, fit=True, delay=0.3),
                 shockwave("ground", color=INK2, radius=(0.05, 0.36), width=(0.9, 0.25), life=0.5, emissive=0, blend="ink", alpha=(0.9, 0.6, 0),
                           fit=True, delay=0.32),
                 decal("ground", "crack", [[0, 0.15], [0.08, 0.32], [1, 0.32]], 1.1, color=INK2, alpha=(1, 0.8, 0), emissive=3.0, rim="team",
                       fit=True, delay=0.3),
                 decal("ground", "ink", [[0, 0.1], [0.1, 0.24], [1, 0.26]], 1.1, color=INK_W, alpha=(0.85, 0.6, 0), rim="team", texture="splat",
                       fit=True, delay=0.3),
                 chips("ground", 22, color=(SAND, IRON), speed=(4, 9), size=0.18, delay=0.31),
                 _drops("ground", 14, speed=(3.5, 7), size=0.18, delay=0.31, shape="ring", radius=0.5, spread=60, fit=False),
                 dust("ground", 12, size=1.5, speed=(2.5, 4.5), radius=0.8, delay=0.36),
                 light("ground", "team", 24, 10, 0.5, delay=0.3),
                 shake(0.6, delay=0.3),
                 comment="T4 · Shade · Settled Account: an ink ring with a team edge reaches out to 7 m and closes on him, ink and light "
                         "dragged inward with it; as it arrives the cleaver stamps: a white core, a stake of light, the ground cracks and "
                         "stains, warm chips and ink drops out, dust settles"))
    return D
