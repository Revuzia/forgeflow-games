"""Kemdo (Breaker, burning glass): bespoke ability VFX.

Identity: the stopped sun through a lens. Light is FOCUSED: narrow white-hot cores inside team
edges, lens rings, funnels that converge to a point, scorch lines where it touched, heat shimmer
(caustic light) and a few small embers. Lumen only. Ember orange stays a speck, never an area
(it sits next to the Dusk marigold band).
"""
from __future__ import annotations

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, EMBER, INK2, NOON, L, chips, decal, dust, flash, glow, light, mesh, motes,
                    ribbon, shake, shards, shockwave, sparks, streaks, vfx)

HOT = "#FFF3E2"         # white-hot glass (the renderer keeps it Dawnglass below T4)
GLOW = "#F6E0B8"        # hot pale light, low saturation
STEAM = "#A8A398"       # vent steam (mid value, alpha)
CHAR = "#2E2620"        # scorch


def xfade(peak: float, life: float, dur: float) -> list:
    """alpha keys for a zone loop: the old copy fades out exactly while the next one fades in."""
    o = max(0.02, (life - dur) / life)
    return [[0, 0], [o, peak], [1 - o, peak], [1, 0]]


def shifted(layers: list, offset: list) -> list:
    """the same layers moved by an offset [forward, up, right] in the facing frame"""
    return [dict(x, offset=offset) for x in layers]


def lens(at: str, size: float, life: float, e: float, offset=None, delay: float = 0.0) -> list:
    """the burning glass flaring: a thin team lens ring round a white-hot focus point (camera-facing, so it always reads round)"""
    return [L("sprite", at=at, texture="ring_thin", size=[[0, size * 0.6], [0.3, size], [1, size * 1.1]], color="team", emissive=e,
              alpha=[1, 0.9, 0], life=life, offset=offset, delay=delay or None, soft=0.05),
            L("sprite", at=at, texture="glow", size=[size * 0.75, size * 0.5], color=HOT, emissive=e, alpha=[1, 0.7, 0], life=life * 0.8,
              offset=offset, delay=delay or None, soft=0.05),
            L("sprite", at=at, texture="flare", size=[size * 1.3, size * 1.0], color=[HOT, "team"], emissive=e, alpha=[1, 0], life=life * 0.7,
              offset=offset, delay=delay or None, soft=0.05)]


def keyline(at: str, length: float, life: float, alpha, e: float, offset: list, width: float = 0.07, color="team") -> list:
    """a thin straight line of light lying on the ground along the facing (a flattened glass sliver; decal lines
    cannot be thinner than 5 % of their length)"""
    return mesh(at, "shard", 1.0, life, color=color, alpha=alpha, emissive=e, mask="ends", mask_param=0.08, noise=0.2,
                stretch=[round(width / 0.32, 3), 0.15, length], offset=offset, fit=False)


def defs() -> list:
    D = []

    # ── passive · Cooling Kill (a takedown vents all her Heat; T1) ───────────────────────────────
    D.append(vfx("kemdo_passive_cool", 0.9,
                 L("emitter", at="target", count=7, shape="sphere", radius=0.35, dir="up", spreadDeg=35, speed=[1.0, 2.0], life=[0.5, 0.8],
                   size=[0.4, 0.8, 1.0], color=[STEAM, DUST], alpha=[0, 0.4, 0.25, 0], gravity=-0.6, drag=2.0, turbulence=0.6, rotDeg=[0, 360],
                   spinDeg=[-40, 40], texture="dust_puff", blend="alpha", soft=0.3),
                 shockwave("target", color=[DAWNGLASS, "team"], radius=(0.6, 0.25), width=(0.12, 0.04), life=0.35, emissive=1.5, alpha=(0, 1, 0)),
                 motes("target", 8, color=[DAWNGLASS, "team"], rise=2.0, life=(0.4, 0.7), size=0.14, radius=0.4, emissive=1.5),
                 comment="T1 · Lumen · Cooling Kill: her Heat leaves as pale steam rising off her, a team ring closes in, cool glass motes"
                         " climb (help is up)"))

    # ── a1 · Long Thrust (area rect 4.5 x 1.2 at self, anchored on its centre; T2) ─────────────────
    D.append(vfx("kemdo_a1_thrust", 0.7,
                 lens("origin", 0.75, 0.22, 3.0, offset=[0.55, 0.15, 0]),
                 flash(2, at="origin", color=GLOW, scale=0.8),
                 # the focused lance: a white-hot line inside a team beam, 4 m along the facing
                 L("beam", **{"from": "origin"}, color="team", width=0.4, life=0.2, emissive=3.0, noise=0.05, core=2.0,
                   alpha=[1, 0.9, 0], taper=[0.25, 1.0]),
                 L("emitter", at="origin", count=16, shape="line", length=4.4, width=0.4, offset=[0, -0.3, 0], dir="forward", spreadDeg=6,
                   speed=[8, 14], life=[0.08, 0.16], size=[0.5, 0.1], color=[HOT, "team"], alpha=[1, 0], emissive=3.0, drag=2, texture="streak",
                   stretch=0.05, blend="add"),
                 # where it touched: a burned line on the ground that cools, a few hot specks and chips
                 decal("ground", "scorch", 1.0, 0.9, shape="line", width=0.55, color=CHAR, alpha=(0.85, 0.7, 0), emissive=2.0, rim="team",
                       texture="scorch", delay=0.04),
                 L("emitter", at="ground", count=10, delay=0.05, shape="line", length=1.8, width=0.5, offset=[-2.0, 0, 0], dir="up", spreadDeg=40,
                   speed=[1.5, 3], life=[0.25, 0.45], size=[0.08, 0.03], color=[EMBER, "team"], alpha=[1, 0], emissive=2.6, gravity=4, drag=1.5,
                   texture="ember", blend="add", secondary=True),
                 chips("ground", 6, speed=(2, 4), size=0.12, delay=0.05),
                 light("origin", GLOW, 8, 6, 0.25),
                 comment="T2 · Lumen · Long Thrust: the lens flares at the glaive head, a focused white-hot lance inside a team beam runs 4 m"
                         " forward with streaks, a scorched line cools on the ground, a few embers"))

    # ── a2 · Heat Shimmer: the dash (5 m at 15 m/s; T3) ──────────────────────────────────────────
    D.append(vfx("kemdo_a2_dash", 0.5,
                 lens("origin", 0.6, 0.2, 3.0, offset=[0.4, 0.1, 0]),
                 ribbon("path", "team", width=(0.0, 0.9), life=0.28, alpha=(0, 0.6), emissive=3.0, noise=0.3, face="ground"),
                 ribbon("path", HOT, width=(0.0, 0.18), life=0.16, alpha=(0, 0.9), emissive=3.5, noise=0.1),
                 L("emitter", at="path", perMeter=7, offset=[0, -0.8, 0], shape="disc", radius=0.3, dir="up", spreadDeg=60, speed=[0.6, 1.6],
                   life=[0.3, 0.55], size=[0.09, 0.03], color=[EMBER, "team"], alpha=[1, 0], emissive=3.0, gravity=1.5, drag=1.2, turbulence=1.0,
                   texture="ember", blend="add", secondary=True),
                 L("emitter", at="path", rate=36, shape="disc", radius=0.45, dir="back", spreadDeg=15, speed=[5, 9], life=[0.08, 0.15],
                   size=[0.55, 0.1], color=[HOT, "team"], alpha=[0.9, 0], emissive=3.0, drag=3, texture="streak", stretch=0.06, blend="add"),
                 dust("origin", 4, size=0.7, speed=(1, 2), radius=0.2, delay=0.0),
                 comment="T3 · Lumen · Heat Shimmer dash: a lens flash, then a hot white core streak inside a team ground streak, embers"
                         " shed off her heels, side streaks (movement)"))

    # ── a2 · Heat Shimmer: the strip (zone rect 5 x 1.2 from where she started, 2 s; loops 1 s; T3) ──
    LIFE, DUR = 1.12, 1.0
    D.append(vfx("kemdo_a2_shimmer", DUR,
                 # wavering caustic heat on the ground along the strip (absolute: the zone is 5 m, anchored at its start)
                 shifted(decal("ground", "light", 2.5, LIFE, shape="rect", width=1.2, color=GLOW, alpha=xfade(0.5, LIFE, DUR), emissive=1.0,
                               texture="caustic", fit=False), [2.5, 0, 0]),
                 sum([keyline("ground", 5.0, LIFE, xfade(0.9, LIFE, DUR), 2.6, [2.5, 0.03, side]) for side in (0.6, -0.6)], []),
                 # heat haze wisps that waver (no rise: this hurts), glints that slide (control)
                 L("emitter", at="ground", rate=9, shape="line", length=5.0, width=1.0, offset=[0, 0.3, 0], dir="none", speed=[0, 0],
                   life=[0.7, 1.1], size=[0.6, 1.0, 1.2], color=[GLOW, "team"], alpha=[0, 0.16, 0], emissive=1.2, turbulence=1.2,
                   turbulenceScale=0.8, rotDeg=[0, 360], spinDeg=[-30, 30], texture="light_puff", blend="add", fit=False),
                 L("emitter", at="ground", rate=10, shape="line", length=5.0, width=1.1, offset=[0, 0.1, 0], dir="random", speed=[0.2, 0.5],
                   life=[0.4, 0.7], size=[0, 0.14, 0], color=[HOT, "team"], alpha=[0, 1, 0], emissive=2.4, texture="glint", blend="add",
                   fit=False, secondary=True),
                 comment="T3 · Lumen · Heat Shimmer strip (loop): a 5 m strip of wavering caustic heat between two team keylines, haze wisps"
                         " that waver in place (no rise: it slows enemies), glints sliding over it"))

    # ── a3 · Vent (area circle 3 at self; T2) ────────────────────────────────────────────────────
    D.append(vfx("kemdo_a3_vent", 0.9,
                 flash(2, at="origin", color=GLOW, scale=1.2),
                 # the blast of stored heat: a team ring out (harm), a hot inner ring behind it
                 shockwave("ground", color="team", radius=(0.12, 1.05), width=(0.45, 0.1), life=0.32, emissive=3.0),
                 shockwave("ground", color=[HOT, GLOW], radius=(0.08, 0.8), width=(0.6, 0.15), life=0.36, emissive=2.6, alpha=(0.8, 0.5, 0),
                           delay=0.03, noise=0.5),
                 shards("ground", 16, color=(HOT, "team"), speed=(6, 10), life=(0.2, 0.4), size=0.24, spread=60, emissive=3.0, gravity=2,
                        shape="disc"),
                 L("emitter", at="ground", count=14, shape="disc", radius=0.25, dir="out", spreadDeg=40, speed=[3, 6], life=[0.3, 0.55],
                   size=[0.1, 0.03], color=[EMBER, "team"], alpha=[1, 0], emissive=3.0, gravity=2, drag=1.5, texture="ember", blend="add",
                   secondary=True),
                 # steam billows thrown out and lifting off
                 L("emitter", at="ground", count=12, delay=0.04, shape="ring", radius=0.25, dir="out", spreadDeg=30, speed=[2, 4], velocity=[0, 0.8, 0],
                   life=[0.45, 0.8], size=[0.5, 1.1, 1.4], color=[STEAM, DUST2], alpha=[0, 0.45, 0.25, 0], gravity=-0.4, drag=2.6, turbulence=0.5,
                   rotDeg=[0, 360], spinDeg=[-40, 40], texture="dust_puff", blend="alpha", soft=0.3),
                 # her vented guard: a brief glass shell (20% less damage)
                 mesh("origin", "orb", [[0, 1.0], [0.3, 1.7], [1, 1.65]], 0.6, color=DAWNGLASS, alpha=[[0, 0.22], [0.5, 0.15], [1, 0]], emissive=1.2,
                      rim="team", rim_pow=2.0, rim_emissive=3.0, noise=0.5, scroll=[0, 0.8], fit=False),
                 decal("ground", "scorch", 0.55, 1.0, shape="ring", color=CHAR, alpha=(0.75, 0.6, 0), emissive=1.8, rim="team", texture="scorch"),
                 light("origin", GLOW, 10, 7, 0.3),
                 comment="T2 · Lumen · Vent: stored heat blasts out (a team ring brightest, a hot ring behind), hot glass and embers thrown out,"
                         " steam billows lift off, a brief glass shell on her, a scorched ring"))

    # ── ult · Held Focus (zone circle 2, follows the target, 3 s, ticks 0.5 s; loops 0.5 s; T3) ───
    LIFE, DUR = 0.56, 0.5
    D.append(vfx("kemdo_ult_focus", DUR,
                 # the sun funnel: light pours down a converging cone onto the spot
                 mesh("ground", "tornado", 2.0, LIFE, color="team", alpha=xfade(0.16, LIFE, DUR), emissive=1.2, rim=GLOW, rim_pow=1.6,
                      rim_emissive=2.4, mask="band", mask_param=0.25, noise=0.6, scroll=[0.2, -2.4], stretch=[1, 1.25, 1], fit=True),
                 L("emitter", at="ground", rate=26, shape="ring", radius=0.8, offset=[0, 4.2, 0], dir="in", spreadDeg=5, speed=[3, 4],
                   velocity=[0, -6.5, 0], life=[0.55, 0.65], size=[0.2, 0.06], color=[HOT, "team"], alpha=[0, 1, 0.6], emissive=3.0,
                   texture="spark", stretch=0.04, blend="add"),
                 # the burning spot: a white-hot core, scorch under it, a heat pool, the team edge brightest
                 glow("ground", HOT, 0.9, LIFE, 3.0, alpha=xfade(0.9, LIFE, DUR), offset=[0, 0.25, 0], soft=0.1),
                 decal("ground", "scorch", 0.42, LIFE, color=CHAR, alpha=xfade(0.85, LIFE, DUR), emissive=3.0, rim="team", texture="scorch"),
                 decal("ground", "light", 1.0, LIFE, color=GLOW, alpha=xfade(0.25, LIFE, DUR), emissive=0.8, texture="caustic"),
                 shockwave("ground", color="team", radius=(1.0, 1.0), width=(0.12, 0.12), life=LIFE, emissive=5.0, alpha=xfade(1.0, LIFE, DUR),
                           sharp=2.4, noise=0.2),
                 # each tick a hot pulse burns out from the spot (harm is out)
                 shockwave("ground", color=[HOT, "team"], radius=(0.15, 0.95), width=(0.2, 0.05), life=0.3, emissive=4.0),
                 L("emitter", at="ground", count=8, shape="disc", radius=0.3, dir="out", spreadDeg=50, speed=[2, 4], life=[0.25, 0.45],
                   size=[0.1, 0.03], color=[EMBER, "team"], alpha=[1, 0], emissive=3.5, gravity=3, drag=1.5, texture="ember", blend="add",
                   secondary=True),
                 L("emitter", at="ground", rate=6, shape="disc", radius=0.3, dir="up", spreadDeg=20, speed=[0.6, 1.2], life=[0.5, 0.8],
                   size=[0.3, 0.6, 0.8], color=[DUST2, "#3A3632"], alpha=[0, 0.35, 0], gravity=-0.3, drag=1.5, turbulence=0.6, rotDeg=[0, 360],
                   texture="dust_puff", blend="alpha", soft=0.3, secondary=True),
                 light("ground", GLOW, 8, 5, LIFE),
                 comment="T3 · Lumen · Held Focus (loop, follows the target): a funnel of light pours down and converges on a 2 m spot, a"
                         " white-hot core over a scorch, the team edge brightest, a hot pulse and embers burst out each 0.5 s tick, char smoke"))
    return D
