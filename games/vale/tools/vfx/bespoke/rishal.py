"""Rishal · Glass runner — bespoke VFX (Lumen: dawnglass knives, chalk, clean straight lines).

Identity: everything is a LINE of glass. Hard thin streaks, ground glass strips with team keylines on both long
edges (the danger edges), glints that catch and die, standing slivers, splinters. No round blooms except the
T4 coil. Shapes: a laid glass strip (a1 track), a crossing X cut (a2), a cracked mirror strip + two-wing spring
(a3), a long wide strip with a bright spine + a sonic rush (ult), a burst of splinters (passive).

Tracks are rect zones that start at the zone's position and run `length` m forward (sim inRect), so every
strip layer is offset forward by half the length (offsets are absolute metres; the radius-like values fit the
zone's half-length). Tracks loop each 1.0 s with 1.3 s layers that cross-fade, so the loop is seamless.
"""
from __future__ import annotations

from vfxkit import CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, NOON, WHITE, L, chips, dust, light, shake, vfx

GLASS = DAWNGLASS
ICE = "#A9C6DE"         # cool glass body
SLATE = "#5E6B78"       # smoked glass (the feint)
INKGLASS = "#2B3038"

LOOP = 1.0
LIFE = 1.3
HOLD = [[0, 0], [0.23, 1], [0.77, 1], [1, 0]]          # two copies overlap 0.3 s: their sum stays level


def _hold(a: float) -> list:
    return [[t, v * a] for t, v in HOLD]


def _track(length: float, width: float, *, floor_tex: str, floor_col, floor_rim, floor_a: float, floor_e: float, key_e: float,
           glint_rate: float, sliver_rate: float, spine: bool = False, chevrons: bool = False) -> list:
    """a glass strip `length` x `width` m running forward from the zone position (absolute metres: fit off)"""
    half = length / 2
    out = [
        L("decal", at="ground", shape="rect", style="plain", texture=floor_tex, radius=0.5, length=length, fit=False, width=width,
          offset=[half, 0, 0], life=LIFE, color=floor_col, alpha=_hold(floor_a), emissive=0.2),
        L("decal", at="ground", shape="rect", style="light", texture=floor_tex, radius=0.5, length=length, fit=False, width=width * 0.9,
          offset=[half, 0, 0], life=LIFE, color=floor_rim, alpha=_hold(0.45), emissive=floor_e),
        # the danger edges: a team keyline down each long side
        L("decal", at="ground", shape="line", style="light", radius=0.5, length=length, fit=False, width=0.08, offset=[half, 0, width / 2 - 0.03], life=LIFE,
          color="team", alpha=_hold(0.95), emissive=key_e),
        L("decal", at="ground", shape="line", style="light", radius=0.5, length=length, fit=False, width=0.08, offset=[half, 0, -width / 2 + 0.03], life=LIFE,
          color="team", alpha=_hold(0.95), emissive=key_e),
        # glints catch along the strip
        L("emitter", at="ground", rate=glint_rate, shape="line", length=length, width=width * 0.8, fit=False, dir="up", spreadDeg=0,
          speed=[0.0, 0.08], life=[0.22, 0.42], size=[0, 0.2, 0], color=[WHITE, GLASS, "team"], alpha=[0, 1, 0], emissive=3.0, texture="glint",
          blend="add", secondary=True),
        # standing slivers of glass (vertical billboards) rise a hand's width and fade
        L("emitter", at="ground", rate=sliver_rate, shape="line", length=length, width=width * 0.7, fit=False, dir="up", spreadDeg=0,
          speed=[0.05, 0.15], life=[0.5, 0.9], size=[[0, 0], [0.25, 0.26], [1, 0.18]], sizeVar=[0.6, 1.3], color=[GLASS, ICE],
          alpha=[0, 0.85, 0.6, 0], emissive=1.4, texture="shard", align="axis", aspect=0.32, blend="add", secondary=True),
    ]
    if spine:
        out.append(L("decal", at="ground", shape="line", style="light", radius=0.5, length=length, fit=False, width=0.14, offset=[half, 0, 0], life=LIFE,
                     color=[GLASS, "team"], alpha=_hold(0.8), emissive=key_e * 0.8))
    if chevrons:
        # smoked-glass panes lying flat along the line, flashing like mirrors (the feint's broken glass)
        out.append(L("emitter", at="ground", rate=sliver_rate * 1.4, shape="line", length=length, width=width * 0.6, fit=False, dir="none",
                     speed=[0, 0], life=[0.6, 1.0], size=[0.32, 0.3], sizeVar=[0.6, 1.3], color=[GLASS, "team"], alpha=[0, 0.7, 0.5, 0],
                     emissive=[0.6, 2.4, 0.4], texture="shard", align="ground", aspect=0.5, rotDeg=[0, 360], blend="add", secondary=True))
    return out


def _streak_dash(dur: float, *, wings: bool, core_w: float, ground_w: float, e: float) -> list:
    """a dash along the path: camera streak(s), a ground glass streak, knife-tip sparks skimming the ground"""
    out = []
    if wings:
        for side in (-0.45, 0.45):
            out.append(L("ribbon", at="path", offset=[0, 0.05, side], color=[GLASS, "team"], width=[0.0, core_w], life=0.2, alpha=[0, 0.75],
                         emissive=e, noise=0.25, scroll=3))
    else:
        out.append(L("ribbon", at="path", color=[GLASS, "team"], width=[0.0, core_w], life=0.2, alpha=[0, 0.8], emissive=e, noise=0.2, scroll=3))
    out += [
        L("ribbon", at="path", color="team", width=[0.0, ground_w], life=0.3, alpha=[0, 0.5], emissive=2.2, noise=0.45, face="ground"),
        L("emitter", at="path", offset=[0, -1.0, 0], bursts=[[t * dur / 4, 4] for t in range(4)], shape="point", dir="back", spreadDeg=40,
          speed=[3, 7], life=[0.12, 0.25], size=[0.14, 0.03], color=[WHITE, GLASS], alpha=[1, 0], emissive=e, gravity=6, drag=2.5,
          texture="spark", stretch=0.04, blend="add"),
        L("emitter", at="path", bursts=[[t * dur / 3, 3] for t in range(3)], shape="sphere", radius=0.35, dir="random", speed=[0.3, 1.2],
          life=[0.3, 0.55], size=[0.16, 0.12, 0], sizeVar=[0.6, 1.3], color=[GLASS, ICE], alpha=[1, 1, 0], emissive=1.8, gravity=5, drag=1.2,
          texture="shard", align="velocity", aspect=0.45, blend="add", secondary=True),
    ]
    return out


def defs() -> list:
    D = []

    # ── passive · Split Glass (on the Cut enemy, T1: no decals, emissive ≤ 1.5) ─────────────────────────────────────
    D.append(vfx("rishal_passive_split", 0.6,
                 L("flash", at="target", radius=0.45, life=0.05, color="team", intensity=1.5),
                 # the Cuts split: three long splinters snap out of the body in a fan
                 L("emitter", at="target", count=3, shape="point", dir="out", spreadDeg=150, speed=[5, 7], life=[0.16, 0.22], size=[0.5, 0.4, 0],
                   color=[WHITE, GLASS], alpha=[1, 1, 0], emissive=1.5, drag=5, texture="shard", align="velocity", aspect=0.3, blend="add"),
                 L("mesh", at="target", shape="blade", scale=[[0, 0.55], [0.35, 0.8], [1, 0.85]], stretch=[0.7, 1.0, 1.9], life=0.16,
                   color=[GLASS, "team"], alpha=[1, 0.95, 0], emissive=1.5, mask="sweep", maskParam=[0, 1.05], align="up", rotateDeg=[38, 50, 0]),
                 L("mesh", at="target", delay=0.04, shape="blade", scale=[[0, 0.55], [0.35, 0.8], [1, 0.85]], stretch=[0.7, 1.0, 1.9], life=0.16,
                   color=[GLASS, "team"], alpha=[1, 0.95, 0], emissive=1.5, mask="sweep", maskParam=[0, 1.05], align="up", rotateDeg=[38, -50, 0]),
                 L("emitter", at="target", count=10, shape="sphere", radius=0.2, dir="out", spreadDeg=170, speed=[2.5, 5], life=[0.25, 0.45],
                   size=[0.18, 0.14, 0], sizeVar=[0.6, 1.3], color=[GLASS, "team"], alpha=[1, 1, 0], emissive=1.5, gravity=7, drag=1.6,
                   texture="shard", align="velocity", aspect=0.45, blend="add"),
                 chips("target", 8, speed=(2, 5), size=0.12, delay=0.02),
                 comment="T1 · Lumen · Split Glass: the Cuts split out of the target as three long splinters and a quick crossed slash, glass "
                         "and chalk chips fall"))

    # ── a1 · Glass Dash: the track (rect zone 5 x 1, loops 1 s) and the dash that lays it ───────────────────────────
    D.append(vfx("rishal_a1_track", LOOP,
                 _track(5.0, 1.0, floor_tex="frost", floor_col=ICE, floor_rim=GLASS, floor_a=0.6, floor_e=1.0, key_e=2.6, glint_rate=12,
                        sliver_rate=6),
                 comment="T3 · Lumen · Glass Dash track: a 5 x 1 m strip of ground glass (frost facets sparkling in team), a team keyline down both "
                         "edges, glints and standing slivers along it; loops seamlessly while the track lives"))
    D.append(vfx("rishal_a1_dash", 0.6,
                 L("flash", at="origin", radius=0.55, life=0.05, color=GLASS, intensity=2.6, offset=[0, -0.4, 0]),
                 [dict(x, offset=[0, -0.95, 0]) for x in dust("origin", 4, size=0.7, speed=(1.2, 2.4), radius=0.15, delay=0.0)],
                 _streak_dash(0.31, wings=False, core_w=0.32, ground_w=1.0, e=3.0),
                 # where he stops: a skid of chips and a glass tick
                 [dict(x, offset=[0, -0.95, 0]) for x in chips("path", 6, speed=(1.5, 3.5), size=0.1, delay=0.31)],
                 L("emitter", at="path", delay=0.31, count=5, shape="point", dir="forward", spreadDeg=60, speed=[2, 4], life=[0.12, 0.22],
                   size=[0.14, 0.03], color=[WHITE, GLASS], alpha=[1, 0], emissive=2.6, drag=3, texture="spark", stretch=0.04, blend="add",
                   offset=[0, -0.9, 0]),
                 comment="T3 · Lumen · Glass Dash: a hard glass streak at the body over a team ground streak (the track being laid), knife-tip "
                         "sparks skimming the ground, glass flakes shed, a chalk skid where he stops"))

    # ── a2 · Glint Cut (hit on the target; plays for each of the two slashes) ────────────────────────────────────────
    D.append(vfx("rishal_a2_cut", 0.5,
                 L("flash", at="target", radius=0.42, life=0.05, color="team", intensity=3.0),
                 # a crossing X of thin glass slashes, leading edge brightest
                 L("mesh", at="target", shape="blade", scale=[[0, 0.55], [0.35, 1.0], [1, 1.06]], stretch=[0.7, 1.0, 1.9], life=0.16,
                   color=[WHITE, GLASS, "team"], alpha=[1, 0.95, 0], emissive=3.0, mask="sweep", maskParam=[0, 1.05], align="up", rotateDeg=[38, 48, 0]),
                 L("mesh", at="target", delay=0.05, shape="blade", scale=[[0, 0.55], [0.35, 1.0], [1, 1.06]], stretch=[0.7, 1.0, 1.9], life=0.16,
                   color=[WHITE, GLASS, "team"], alpha=[1, 0.95, 0], emissive=3.0, mask="sweep", maskParam=[0, 1.05], align="up", rotateDeg=[38, -48, 0]),
                 # glass splinters fly on through, in the cut's direction
                 L("emitter", at="target", count=12, shape="sphere", radius=0.15, dir="forward", spreadDeg=70, speed=[4, 8], life=[0.18, 0.35],
                   size=[0.24, 0.18, 0], sizeVar=[0.6, 1.3], color=[GLASS, "team"], alpha=[1, 1, 0], emissive=2.8, gravity=5, drag=2.4,
                   texture="shard", align="velocity", aspect=0.4, blend="add"),
                 L("emitter", at="target", count=6, shape="point", dir="forward", spreadDeg=50, speed=[7, 11], life=[0.06, 0.12], size=[0.5, 0.06],
                   color="team", alpha=[1, 0], emissive=3.0, drag=3, texture="streak", stretch=0.05, blend="add"),
                 chips("target", 9, speed=(2.5, 5.5), size=0.13),
                 L("decal", at="target", shape="circle", style="crack", radius=[[0, 0.3], [0.1, 0.6], [1, 0.6]], life=0.5, color=CHALK_DK, rim=GLASS,
                   alpha=[0.7, 0.5, 0], emissive=1.2, offset=[0, -1.0, 0]),
                 comment="T2 · Lumen · Glint Cut (each slash): a crossing X of thin glass slashes on the target, splinters fly on through in "
                         "the cut's direction, chalk chips, a glass crack at the feet"))

    # ── a3 · Feint: the smoked-glass track laid over the ground he covered (rect 4 x 1, loops), and the spring ──────
    D.append(vfx("rishal_a3_feint", LOOP,
                 _track(4.0, 1.0, floor_tex="crack", floor_col=INKGLASS, floor_rim=GLASS, floor_a=0.75, floor_e=1.4, key_e=2.4, glint_rate=8,
                        sliver_rate=4, chevrons=True),
                 comment="T3 · Lumen · Feint track: a 4 x 1 m strip of cracked smoked glass (dark fractures with light in them), team keylines "
                         "down both edges, flat mirror panes flashing along it; loops while the track lives"))
    D.append(vfx("rishal_a3_spring", 0.7,
                 # the false lunge: a pale glass after-image lunges the other way and breaks
                 L("mesh", at="origin", shape="blade", scale=[[0, 0.8], [0.4, 1.6], [1, 1.7]], stretch=[2.2, 1, 1.4], offset=[-0.9, -0.3, 0],
                   rotateDeg=[0, 180, 0], life=0.2, color=[GLASS, "team"], alpha=[0.8, 0.6, 0], emissive=2.4, mask="sweep", maskParam=[0, 1.05],
                   noise=0.4, dissolve=[[0, 0], [0.5, 0.2], [1, 1]], edge="team", edgeEmissive=2.6),
                 L("emitter", at="origin", count=10, shape="sphere", radius=0.3, offset=[-0.7, -0.3, 0], dir="random", speed=[0.8, 2.2],
                   life=[0.25, 0.45], size=[0.2, 0.15, 0], sizeVar=[0.6, 1.3], color=[GLASS, ICE], alpha=[1, 1, 0], emissive=2.0, gravity=6, drag=1.5,
                   texture="shard", align="velocity", aspect=0.45, blend="add"),
                 # the spring back: two knife wings
                 _streak_dash(0.29, wings=True, core_w=0.24, ground_w=0.8, e=2.8),
                 [dict(x, offset=[0, -0.95, 0]) for x in dust("path", 4, size=0.7, speed=(0.8, 1.8), radius=0.2, delay=0.29)],
                 comment="T3 · Lumen · Feint: a pale glass after-image lunges the other way and breaks into flakes, then he springs back on two "
                         "glass wings (the knives) over a team ground streak; dust where he lands"))

    # ── ult · Long Glint: the coil (cast), the rush (dash 9 m), the long track (rect zone 9 x 1.5, loops) ───────────
    D.append(vfx("rishal_ult_coil", 0.55,
                 # a glint runs the whole 9 m line before he goes (the warning), white at the knives (T4)
                 L("flash", at="origin", radius=0.9, life=0.1, color="team", intensity=10, core=WHITE),
                 L("mesh", at="origin", shape="blade", scale=1.0, stretch=[1.4, 1, 9.0], offset=[4.5, -0.95, 0], life=0.24,
                   color=[WHITE, GLASS, "team"], alpha=[[0, 1], [0.7, 1], [1, 0]], emissive=8, mask="sweep", maskParam=[[0, 0], [1, 1.1]],
                   align="dir"),
                 L("decal", at="origin", shape="line", style="light", radius=1.0, length=9.0, width=0.18, offset=[4.5, -1.0, 0], life=0.5,
                   color="team", alpha=[[0, 0], [0.15, 0.9], [1, 0]], emissive=3.0),
                 L("emitter", at="origin", count=16, shape="sphere", radius=0.9, dir="in", spreadDeg=10, speed=[3, 5], life=[0.15, 0.22],
                   size=[0.14, 0.04], color=[WHITE, "team"], alpha=[0, 1, 0], emissive=6, texture="spark", stretch=0.03, blend="add"),
                 light("origin", "team", 12, 6, 0.3, attack=0.1),
                 comment="T4 · Lumen · Long Glint coil: a white-core glint at the knives, a glass glint races down the full 9 m line and leaves a "
                         "team line on the ground for a beat (the warning), sparks drawn in"))
    D.append(vfx("rishal_ult_rush", 0.9,
                 L("shockwave", at="origin", radius=[[0, 0.3], [1, 1.4]], width=[0.25, 0.04], life=0.3, color=[GLASS, "team"], alpha=[1, 0.6, 0],
                   emissive=3.5, sharp=2.0, mode="vertical"),
                 [dict(x, offset=[0, -0.95, 0]) for x in dust("origin", 6, size=0.9, speed=(1.5, 3), radius=0.2, delay=0.0)],
                 L("ribbon", at="path", color=[WHITE, GLASS, "team"], width=[0.0, 0.5], life=0.28, alpha=[0, 0.9], emissive=4.5, noise=0.2, scroll=3),
                 L("ribbon", at="path", offset=[0, 0.1, 0.5], color=[GLASS, "team"], width=[0.0, 0.18], life=0.18, alpha=[0, 0.6], emissive=3.0),
                 L("ribbon", at="path", offset=[0, 0.1, -0.5], color=[GLASS, "team"], width=[0.0, 0.18], life=0.18, alpha=[0, 0.6], emissive=3.0),
                 L("ribbon", at="path", color="team", width=[0.0, 1.5], life=0.4, alpha=[0, 0.55], emissive=2.6, noise=0.5, face="ground"),
                 # glass wake thrown off to both sides as he passes
                 L("emitter", at="path", bursts=[[t * 0.1, 6] for t in range(5)], shape="sphere", radius=0.3, dir="random", spreadDeg=0,
                   speed=[1.5, 4], life=[0.3, 0.55], size=[0.24, 0.18, 0], sizeVar=[0.6, 1.4], color=[WHITE, GLASS, "team"], alpha=[1, 1, 0],
                   emissive=4.0, gravity=6, drag=1.6, texture="shard", align="velocity", aspect=0.42, blend="add"),
                 L("emitter", at="path", offset=[0, -1.0, 0], bursts=[[t * 0.1, 5] for t in range(5)], shape="point", dir="back", spreadDeg=40,
                   speed=[4, 8], life=[0.12, 0.25], size=[0.16, 0.04], color=[WHITE, GLASS], alpha=[1, 0], emissive=4.0, gravity=6, drag=2.5,
                   texture="spark", stretch=0.04, blend="add"),
                 # the skid at the far end
                 [dict(x, offset=[0, -0.95, 0]) for x in chips("path", 10, speed=(2, 4.5), size=0.12, delay=0.5)],
                 [dict(x, offset=[0, -0.95, 0]) for x in dust("path", 6, size=0.9, speed=(1.0, 2.2), radius=0.3, delay=0.5)],
                 comment="T3 · Lumen · Long Glint rush: a sound-ring at the start, a hard white-glass streak with two knife streaks either side over "
                         "a wide team ground streak, a glass wake thrown off to both sides, a chalk skid at the end"))
    D.append(vfx("rishal_ult_glint", LOOP,
                 _track(9.0, 1.5, floor_tex="frost", floor_col=ICE, floor_rim=GLASS, floor_a=0.65, floor_e=1.4, key_e=4.0, glint_rate=26,
                        sliver_rate=12, spine=True),
                 comment="T3 · Lumen · Long Glint track: a 9 x 1.5 m strip of ground glass with a bright glass spine down the middle, team keylines "
                         "on both edges, dense glints and standing slivers; loops seamlessly for its 4 s"))
    return D
