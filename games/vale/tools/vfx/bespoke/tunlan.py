"""Tunlan · Shadow puppeteer — bespoke VFX (Shade: lamp-thrown ink shadows with a pale rim; the danger rim in team).

Identity: shapes of SHADOW cast by a warm paper lamp. Every harmful body is ink (alpha ink, a Noonwhite or team
rim, smoky noise inside), built into a creature or a hand; the only light is the lamp's low-saturation paper glow
(#EAD7AE), which flares when she casts. Shapes: a running ink hound (a1), a hand of five ink fingers closing
on the target (a2), a lamp flare that throws the shadows outward (a3), a horned beast that floods the cone (ult),
a startled bristle of ink (passive).

Built from the FX meshes: the hound is orbs + spikes riding the projectile (offset low to run along the ground);
the hand's fingers are spikes placed round the target in the facing frame and leaned inward (align dir, so the
local frame is +Z forward, +X = left).
"""
from __future__ import annotations

import math

from vfxkit import INK, INK2, NOON, WHITE, L, chips, light, shake, vfx

LAMP = "#EAD7AE"        # paper lamp glow (low saturation)
LAMP_HOT = "#F3E3C2"
SMOKE = "#1F2127"


def _ink_mesh(at: str, shape: str, scale, life: float, *, offset=None, stretch=None, rotate=None, alpha=(1, 1), rim="team", rim_e: float = 1.8,
              noise: float = 0.7, align: str | None = None, delay: float = 0.0, hold: float | None = None, dissolve=None, wobble: float | None = None,
              color=INK, fit: bool | None = None, rim_pow: float = 4.5) -> dict:
    return L("mesh", at=at, shape=shape, scale=scale, life=life, offset=offset, stretch=stretch, rotateDeg=rotate, color=color,
             alpha=list(alpha), emissive=0, rim=rim, rimPow=rim_pow, rimEmissive=rim_e, noise=noise, noiseScale=2.2, scroll=[0.3, -0.8],
             blend="ink", align=align, delay=delay or None, hold=hold, dissolve=dissolve, edge="team" if dissolve else None,
             edgeEmissive=2.0 if dissolve else None, wobble=wobble, fit=fit)


def _finger(theta_deg: float, radius: float, lean_deg: float, *, scale, life: float, delay: float, alpha, height: float = -1.0,
            thick: float = 1.0) -> dict:
    """an ink finger standing at angle theta round the target (facing frame), its tip leaning in toward the target"""
    th, ph = math.radians(theta_deg), math.radians(lean_deg)
    f, r = radius * math.cos(th), radius * math.sin(th)          # offset forward / right
    lx, lz = -r, f                                               # local mesh frame (align dir): +Z forward, +X left
    d = math.hypot(lx, lz) or 1.0
    tx, tz = -lx / d * math.sin(ph), -lz / d * math.sin(ph)      # tip lean toward the centre
    az = -math.asin(max(-1.0, min(1.0, tx)))
    ax = math.asin(max(-1.0, min(1.0, tz / max(1e-4, math.cos(az)))))
    return _ink_mesh("target", "spike", scale, life, offset=[round(f, 3), height, round(r, 3)], stretch=[thick, 1.0, thick],
                     rotate=[round(math.degrees(ax), 1), 0, round(math.degrees(az), 1)], alpha=alpha, align="dir", delay=delay, noise=0.55)


def defs() -> list:
    D = []

    # ── passive · Startle (on the startled enemy, T1: emissive ≤ 1.5, no decals) ───────────────────────────────────
    D.append(vfx("tunlan_passive_startle", 0.6,
                 # a bristle of ink spikes jumps off the head and shoulders (a start), a pale ring jolts
                 L("emitter", at="target", count=14, shape="sphere", radius=0.25, offset=[0, 0.45, 0], dir="out", spreadDeg=70, speed=[3.5, 6],
                   life=[0.14, 0.24], size=[0.3, 0.12], color=[INK, INK2], alpha=[1, 1, 0], drag=4, gravity=-2, texture="streak", stretch=0.05,
                   blend="ink", rim="team", rimAlpha=0.8),
                 L("shockwave", at="target", offset=[0, 0.4, 0], radius=[[0, 0.3], [1, 0.85]], width=[0.16, 0.04], life=0.2, color="team",
                   alpha=[1, 0.6, 0], emissive=1.5, sharp=2.0, mode="vertical"),
                 L("emitter", at="target", count=5, shape="sphere", radius=0.3, offset=[0, 0.2, 0], dir="out", spreadDeg=90, speed=[0.6, 1.4],
                   life=[0.35, 0.55], size=[0.4, 0.75], color=[INK, SMOKE], alpha=[0, 0.8, 0], gravity=0.5, drag=2.5, texture="ink_puff", blend="ink",
                   rim=NOON, rimAlpha=0.6, rotDeg=[0, 360]),
                 comment="T1 · Shade · Startle: a bristle of ink spikes jumps off the target's head and shoulders with a team rim, a pale jolt "
                         "ring, a puff of shadow"))

    # ── a1 · Hound Shadow (projectile, 9 m at 14 m/s, pierces): a low ink hound running along the ground ─────────────
    body_y = -0.62
    D.append(vfx("tunlan_a1_hound", 0.8,
                 # cast: the lamp gutters and a puff of shadow leaps off her hands
                 L("flash", at="origin", radius=0.6, life=0.06, color=LAMP, intensity=2.6, offset=[0.3, 0.3, 0]),
                 L("emitter", at="origin", count=8, shape="sphere", radius=0.25, offset=[0.4, -0.2, 0], dir="forward", spreadDeg=50, speed=[1.5, 3],
                   life=[0.3, 0.5], size=[0.5, 0.9], color=[INK, SMOKE], alpha=[0, 0.85, 0], drag=2.5, gravity=0.6, texture="ink_puff", blend="ink",
                   rim=NOON, rimAlpha=0.6, rotDeg=[0, 360]),
                 # the hound (rides the projectile, held while it runs): uniform orbs and spikes only (stretching bends the rim)
                 _ink_mesh("path", "orb", [[0, 0.3], [0.4, 1.0], [1, 1.0]], 0.35, offset=[0, body_y, 0], stretch=[0.5, 0.48, 1.3], hold=1,
                           align="velocity", wobble=0.04, rim_pow=12, rim_e=2.0),
                 _ink_mesh("path", "orb", [[0, 0.2], [0.4, 0.42], [1, 0.42]], 0.35, offset=[0.66, body_y + 0.2, 0], hold=1, align="velocity",
                           rim_pow=5, rim_e=2.0),
                 _ink_mesh("path", "spike", [[0, 0.1], [0.4, 0.34], [1, 0.34]], 0.35, offset=[0.86, body_y + 0.17, 0], rotate=[96, 0, 0], hold=1,
                           align="velocity"),
                 _ink_mesh("path", "spike", [[0, 0.1], [0.4, 0.3], [1, 0.3]], 0.35, offset=[0.66, body_y + 0.36, 0.11], rotate=[-35, 0, -18], hold=1,
                           align="velocity"),
                 _ink_mesh("path", "spike", [[0, 0.1], [0.4, 0.3], [1, 0.3]], 0.35, offset=[0.66, body_y + 0.36, -0.11], rotate=[-35, 0, 18], hold=1,
                           align="velocity"),
                 _ink_mesh("path", "spike", [[0, 0.1], [0.4, 0.55], [1, 0.55]], 0.35, offset=[-0.58, body_y + 0.08, 0], rotate=[-118, 0, 0], hold=1,
                           align="velocity"),
                 [_ink_mesh("path", "spike", [[0, 0.1], [0.4, 0.4], [1, 0.4]], 0.35, offset=[f, body_y - 0.02, r], rotate=[180 + tilt, 0, 0], hold=1,
                            align="velocity", rim=NOON, rim_e=1.2)
                  for f, r, tilt in ((0.34, 0.13, -25), (0.3, -0.13, 20), (-0.36, 0.13, 25), (-0.32, -0.13, -20))],
                 # eyes: two team points (the danger read on a black body)
                 L("sprite", at="path", offset=[0.9, body_y + 0.36, 0.11], follow=True, life=0.9, size=0.17, color="team", emissive=3.0,
                   alpha=[[0, 0], [0.15, 1], [1, 1]], texture="glow", blend="add", soft=0.05),
                 L("sprite", at="path", offset=[0.9, body_y + 0.36, -0.11], follow=True, life=0.9, size=0.17, color="team", emissive=3.0,
                   alpha=[[0, 0], [0.15, 1], [1, 1]], texture="glow", blend="add", soft=0.05),
                 # paws kick up shadow, a ground wake under a team rim, smoke that sinks
                 L("emitter", at="path", offset=[0, -1.0, 0], rate=34, shape="disc", radius=0.3, dir="up", spreadDeg=40, speed=[0.4, 1.2],
                   life=[0.25, 0.45], size=[0.35, 0.6], color=[INK, SMOKE], alpha=[0, 0.85, 0], gravity=1.5, drag=2.5, texture="ink_puff", blend="ink",
                   rim=NOON, rimAlpha=0.55, rotDeg=[0, 360]),
                 L("ribbon", at="path", offset=[0, -1.0, 0], color=INK2, width=[0.0, 0.85], life=0.3, alpha=[0, 0.75], emissive=0, blend="ink",
                   rim="team", noise=0.5, face="ground"),
                 L("emitter", at="path", rate=16, shape="sphere", radius=0.3, offset=[-0.2, body_y + 0.2, 0], dir="back", spreadDeg=30,
                   speed=[0.6, 1.4], life=[0.12, 0.22], size=[0.35, 0.1], color="team", alpha=[0.7, 0], emissive=2.2, drag=3, texture="streak",
                   stretch=0.05, blend="add", secondary=True),
                 comment="T2 · Shade · Hound Shadow: an ink hound (body, head, snout, ears, tail) runs low along the ground with a team rim and two "
                         "team eyes, its paws kicking up shadow over an ink wake; the lamp gutters at the cast"))

    # ── a2 · Hand Shadow (hit on the target): five ink fingers rise round the target and close ───────────────────────
    open_set = [_finger(a, 1.05, 16, scale=[[0, 0.0], [0.5, 1.7], [1, 1.8]], life=0.26, delay=0.0, alpha=[[0, 0], [0.3, 1], [0.8, 1], [1, 0]])
                for a in (-150, -90, -30, 30, 90)]
    closed = [_finger(a, 0.62, 46, scale=[[0, 1.7], [0.25, 1.85], [1, 1.6]], life=0.6, delay=0.2, alpha=[[0, 0], [0.12, 1], [0.75, 1], [1, 0]])
              for a in (-150, -90, -30, 30, 90)]
    D.append(vfx("tunlan_a2_grip", 0.95,
                 open_set, closed,
                 # the palm's shadow on the ground, a closing team ring (control closes in), the grip lands
                 L("decal", at="target", shape="circle", style="ink", texture="splat", radius=[[0, 0.6], [0.25, 1.25], [1, 1.1]], life=0.9, color=INK, rim="team",
                   alpha=[[0, 0], [0.15, 0.8], [0.8, 0.7], [1, 0]]),
                 L("shockwave", at="target", offset=[0, -1.0, 0], radius=[[0, 1.4], [1, 0.45]], width=[0.08, 0.2], life=0.32, color="team",
                   alpha=[0.3, 1, 0], emissive=3.0, sharp=2.0, noise=0.25),
                 L("flash", at="target", delay=0.22, radius=0.6, life=0.05, color="team", intensity=3.0),
                 L("emitter", at="target", delay=0.22, count=10, shape="sphere", radius=0.35, dir="out", spreadDeg=160, speed=[2.5, 4.5],
                   life=[0.25, 0.45], size=[0.16, 0.1], color=[INK, INK2], alpha=[1, 1, 0], gravity=10, drag=1.0, texture="drop", blend="ink",
                   rim=NOON, rimAlpha=0.7),
                 L("emitter", at="target", delay=0.22, count=6, shape="sphere", radius=0.4, dir="out", spreadDeg=120, speed=[0.6, 1.2],
                   life=[0.4, 0.6], size=[0.5, 0.9], color=[INK, SMOKE], alpha=[0, 0.8, 0], gravity=0.4, drag=2.5, texture="ink_puff", blend="ink",
                   rim="team", rimAlpha=0.5, rotDeg=[0, 360], secondary=True),
                 comment="T2 · Shade · Hand Shadow: five ink fingers with team rims rise open round the target, then close in tight as the palm's "
                         "shadow spreads under it; a team ring closes, ink drops spray at the grip"))

    # ── a3 · Lamp Flare (area at self, 3 m): the lamp flares and the shadows are thrown out ───────────────────────────
    D.append(vfx("tunlan_a3_flare", 0.9,
                 L("flash", at="origin", radius=0.95, life=0.08, color=LAMP_HOT, intensity=3.0, offset=[0.2, 0.75, 0]),
                 L("sprite", at="origin", offset=[0.2, 0.75, 0], life=0.3, size=[[0, 0.6], [0.2, 2.2], [1, 2.6]], color=[LAMP_HOT, LAMP],
                   alpha=[[0, 1], [0.3, 0.55], [1, 0]], emissive=2.4, texture="flare", blend="add", soft=0.3),
                 L("decal", at="ground", shape="circle", style="light", texture="caustic", radius=[[0, 0.4], [0.2, 1.0], [1, 1.0]], life=0.45,
                   color=LAMP, alpha=[0.7, 0.35, 0], emissive=1.4, fit=True),
                 # the shadows flee: ink thrown outward along the ground, a team edge at 3 m
                 L("emitter", at="ground", count=16, shape="ring", radius=0.35, dir="out", spreadDeg=12, speed=[5.5, 7.5], life=[0.4, 0.55],
                   size=[0.55, 0.9, 0.7], color=[INK, SMOKE], alpha=[0.95, 0.8, 0], drag=3.2, gravity=0, texture="ink_puff", blend="ink",
                   rim=NOON, rimAlpha=0.65, rotDeg=[0, 360], fit=False),
                 L("emitter", at="ground", count=14, shape="ring", radius=0.4, dir="out", spreadDeg=8, speed=[8, 11], life=[0.22, 0.3],
                   size=[0.5, 0.16], color=[INK, INK2], alpha=[1, 0.9, 0], drag=3, texture="streak", stretch=0.05, blend="ink", rim="team",
                   rimAlpha=0.8, offset=[0, 0.25, 0], fit=False),
                 L("shockwave", at="ground", delay=0.03, radius=[[0, 0.2], [0.4, 0.8], [1, 1.0]], width=[0.4, 0.07], life=0.34, color="team",
                   alpha=[1, 0.9, 0], emissive=3.0, sharp=2.2, noise=0.35, fit=True),
                 L("emitter", at="origin", count=14, shape="sphere", radius=0.2, offset=[0.2, 0.75, 0], dir="out", spreadDeg=180, speed=[3, 6],
                   life=[0.2, 0.4], size=[0.1, 0.03], color=[LAMP_HOT, LAMP], alpha=[1, 0], emissive=2.6, drag=2.5, gravity=2, texture="ember",
                   stretch=0.03, blend="add", secondary=True),
                 light("origin", LAMP, 14, 8, 0.35),
                 comment="T2 · Shade · Lamp Flare: the paper lamp flares (a warm flare, a light pool on the ground), the shadows are thrown out "
                         "along the ground as ink streaks and puffs, a team edge rolls to 3 m"))

    # ── ult · Shadow Play: the beast rises over her (cast), then floods the 9 m 50° cone (area, T4) ─────────────────
    D.append(vfx("tunlan_ult_raise", 1.0,
                 L("sprite", at="origin", offset=[0.15, 0.8, 0], life=0.9, size=[[0, 0.4], [0.6, 1.4], [1, 0.8]], color=[LAMP, "team"],
                   alpha=[[0, 0], [0.2, 1], [0.8, 1], [1, 0]], emissive=4.0, texture="glow", blend="add", soft=0.25),
                 # a column of shadow climbs behind her and spreads horns above the hat
                 _ink_mesh("origin", "tornado", [[0, 0.4], [0.5, 1.1], [1, 1.25]], 0.95, offset=[-0.55, -1.0, 0], stretch=[0.9, 2.3, 0.9],
                           alpha=[[0, 0], [0.2, 0.6], [0.8, 0.55], [1, 0]], align="dir", noise=0.95, rim=NOON, rim_e=1.0, rim_pow=9,
                           dissolve=[0.15, 0.3]),
                 _ink_mesh("origin", "spike", [[0, 0.3], [0.5, 1.6], [1, 1.8]], 0.95, offset=[-0.5, 1.2, 0.45], rotate=[-10, 0, -32],
                           alpha=[[0, 0], [0.3, 1], [0.85, 1], [1, 0]], align="dir", rim_e=5.0),
                 _ink_mesh("origin", "spike", [[0, 0.3], [0.5, 1.6], [1, 1.8]], 0.95, offset=[-0.5, 1.2, -0.45], rotate=[-10, 0, 32],
                           alpha=[[0, 0], [0.3, 1], [0.85, 1], [1, 0]], align="dir", rim_e=5.0),
                 L("emitter", at="origin", rate=26, duration=0.7, shape="ring", radius=1.4, offset=[0, -0.9, 0], dir="in", spreadDeg=20,
                   speed=[1.5, 2.5], life=[0.45, 0.65], size=[0.6, 1.1], color=[INK, SMOKE], alpha=[0, 0.85, 0], gravity=-1.5, drag=1.0,
                   texture="ink_puff", blend="ink", rim="team", rimAlpha=0.55, rotDeg=[0, 360], secondary=True),
                 light("origin", LAMP, 10, 6, 0.9, attack=0.5),
                 comment="T4 · Shade · Shadow Play wind-up: the lamp glows in her colour, a column of shadow climbs behind her and spreads two "
                         "great horns above the hat, shadow is drawn in from the ground (the warning)"))
    D.append(vfx("tunlan_ult_play", 1.6,
                 L("flash", at="origin", radius=1.3, life=0.1, color=LAMP_HOT, intensity=10, core=WHITE, offset=[0.2, 0.75, 0]),
                 # the body of the beast floods the cone
                 L("mesh", at="ground", shape="fan", angleDeg=50, scale=[[0, 0.3], [0.3, 2.0], [1, 2.0]], life=1.2, color=[INK, INK2],
                   alpha=[[0, 0.95], [0.6, 0.85], [1, 0]], emissive=0, rim="team", rimPow=4.0, rimEmissive=2.0, noise=0.4, noiseScale=2.0, scroll=[0, -1.2],
                   dissolve=[[0, 0], [0.6, 0.1], [1, 1]], edge="team", edgeEmissive=5.0, blend="ink", align="dir", fit=True),
                 # its front: the brightest team edge rushing out to 9 m
                 L("mesh", at="ground", shape="fan", angleDeg=52, scale=2.02, life=0.42, color=[WHITE, "team"], alpha=[[0, 1], [0.8, 1], [1, 0]],
                   emissive=10, mask="edge", maskParam=[[0, 0.15], [0.55, 0.99], [1, 1.0]], blend="add", align="dir", fit=True),
                 L("decal", at="ground", shape="cone", style="plain", texture="splat", angleDeg=50, radius=1.0, life=1.5, color=INK, rim="team",
                   alpha=[[0, 0.85], [0.75, 0.7], [1, 0]], fit=True),
                 # horns, claws and jaws of shadow standing up in the cone
                 _ink_mesh("ground", "spike", [[0, 0.5], [0.3, 3.6], [1, 3.8]], 1.1, offset=[6.2, 0, 1.1], rotate=[-20, 0, -28],
                           alpha=[[0, 0], [0.15, 1], [0.75, 1], [1, 0]], align="dir", rim_e=3.0, fit=False),
                 _ink_mesh("ground", "spike", [[0, 0.5], [0.3, 3.6], [1, 3.8]], 1.1, offset=[6.2, 0, -1.1], rotate=[-20, 0, 28],
                           alpha=[[0, 0], [0.15, 1], [0.75, 1], [1, 0]], align="dir", rim_e=3.0, fit=False),
                 _ink_mesh("ground", "orb", [[0, 0.5], [0.3, 2.6], [1, 2.7]], 1.1, offset=[6.6, 0, 0],
                           alpha=[[0, 0], [0.15, 0.95], [0.75, 0.9], [1, 0]], align="dir", rim_e=3.0, fit=False),
                 [_ink_mesh("ground", "spike", [[0, 0.2], [0.3, 2.4], [1, 2.2]], 0.9, offset=[f, 0, r], rotate=[55, 0, 0],
                            delay=d, alpha=[[0, 0], [0.15, 1], [0.7, 1], [1, 0]], align="dir", rim_e=3.0, fit=False)
                  for f, r, d in ((3.2, 0.6, 0.05), (3.6, -0.9, 0.08), (5.0, 1.6, 0.11), (5.2, -0.2, 0.06), (7.0, 1.0, 0.13), (7.2, -1.8, 0.1))],
                 # its eyes
                 L("sprite", at="ground", offset=[6.6, 2.4, 0.55], life=1.0, size=0.55, color="team", emissive=8, alpha=[[0, 0], [0.12, 1], [0.8, 1], [1, 0]],
                   texture="glow", blend="add", soft=0.1, fit=False),
                 L("sprite", at="ground", offset=[6.6, 2.4, -0.55], life=1.0, size=0.55, color="team", emissive=8, alpha=[[0, 0], [0.12, 1], [0.8, 1], [1, 0]],
                   texture="glow", blend="add", soft=0.1, fit=False),
                 # shadow billows roll the length of the cone, ink drops rain out
                 L("emitter", at="ground", count=38, shape="cone", angleDeg=46, length=8.6, dir="forward", spreadDeg=20, speed=[1.5, 4],
                   life=[0.5, 0.9], size=[1.1, 1.9, 1.6], color=[INK, SMOKE], alpha=[0, 0.85, 0], drag=2.2, gravity=-0.3, texture="ink_puff",
                   blend="ink", rim="team", rimAlpha=0.55, rotDeg=[0, 360], fit=False),
                 L("emitter", at="ground", count=24, shape="cone", angleDeg=46, length=8.0, dir="up", spreadDeg=50, speed=[3, 6], life=[0.4, 0.7],
                   size=[0.18, 0.12], color=[INK, INK2], alpha=[1, 1, 0], gravity=12, drag=0.8, texture="drop", blend="ink", rim=NOON, rimAlpha=0.6,
                   fit=False, secondary=True),
                 chips("ground", 10, speed=(2, 4), size=0.12, delay=0.05),
                 light("origin", LAMP, 20, 10, 0.4),
                 shake(0.6),
                 comment="T4 · Shade · Shadow Play: a white-core lamp flash, then a horned shadow beast floods the 9 m 50° cone: an ink body under "
                         "a team rim, its front the brightest team edge rushing out, horns, claws and two team eyes standing up in it, billows and "
                         "ink rain; the ground stays dark"))
    return D
