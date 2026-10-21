"""Odrum · Amber setter — bespoke VFX (Lumen: warm lampresin, honey glass; the team colour holds every danger edge).

Identity: resin that is poured, flows and SETS. Dark viscous amber bodies (alpha / opaque drops) with honey-glass
highlights; a team keyline on every edge that can hurt; the "setting" read is a pale crust that creeps in from
the rim and a team edge that brightens until the pool snaps hard. Shapes: falling blob -> splash -> glossy pool
(a1 / ult), a level whirl of two pot-heads (a2), a low hop with a loaded bead (a3), a cracking amber shell (passive).

Timed zones: Resin Shot and Amber Hour pools are fixed-length (delay + duration = 2.0 s / 2.75 s), so their zone defs
run ONCE across the zone's whole life (duration a little longer than the zone, so the loop never restarts); the
"set" moment is its own def on the zone's onExpire area (odrum_a1_set / odrum_ult_set), which fires exactly then.
"""
from __future__ import annotations

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, INK2, NOON, WHITE, L, chips, dust, flash, light, shake, vfx)

RESIN_DK = "#4A2F18"    # set resin body (alpha)
RESIN = "#9A6331"       # poured resin (opaque drops)
AMBER = "signature"     # lit resin: Odrum's resin-gold signature (r12 M12; the old amber #C98A47 sat in the harm hue band)
HONEY = "#E8C48E"       # honey-glass highlight (low saturation: never reads as the Dusk marigold)


def _blob(fall: float, t_land: float, size: float, glow: float, e: float) -> list:
    """a resin blob dropping straight onto the ground centre, landing at t_land (not fitted: real metres)"""
    g = 2 * (fall - 2.0 * t_land) / (t_land * t_land)        # start 2 m/s down, reach the ground at t_land
    common = dict(at="ground", offset=[0, fall, 0], count=1, dir="down", spreadDeg=0, speed=[2.0, 2.0], life=[t_land, t_land],
                  gravity=round(g, 2), drag=0, collide=False, fit=False, rotDeg=[0, 0])
    return [
        L("emitter", **common, size=[size * 0.7, size], color=[RESIN, RESIN_DK], alpha=[1, 1], texture="drop", blend="chip", rim=HONEY,
          rimAlpha=0.7, stretch=0.02),
        L("emitter", **common, size=[glow * 0.6, glow], color=[AMBER, HONEY], alpha=[0, 0.8, 0.9], emissive=e, texture="glow", blend="add", soft=0.3),
    ]


def _splash(t: float, n_drops: int, sp, drop: float, e: float, ring_life: float) -> list:
    out = [
        L("shockwave", at="ground", delay=t, radius=[[0, 0.08], [0.3, 0.75], [1, 1.0]], width=[0.4, 0.05], life=ring_life, color=AMBER,
          alpha=[1, 0.7, 0], emissive=e, sharp=1.8, noise=0.45, fit=True),
        L("emitter", at="ground", delay=t, count=n_drops, shape="disc", radius=0.12, dir="out", spreadDeg=70, speed=list(sp), life=[0.45, 0.8],
          size=[drop, drop * 0.8], sizeVar=[0.6, 1.4], color=[RESIN, RESIN_DK], alpha=[1, 1, 0], gravity=16, drag=1.0, bounce=0.1,
          texture="drop", blend="chip", rim=HONEY, rimAlpha=0.55, align="velocity", stretch=0.02),
        L("emitter", at="ground", delay=t, count=max(4, n_drops // 3), shape="disc", radius=0.2, dir="up", spreadDeg=45, speed=[sp[0] * 0.6, sp[1] * 0.7],
          life=[0.25, 0.45], size=[0.12, 0.03], color=[HONEY, AMBER], alpha=[1, 0], emissive=e, gravity=9, drag=2, texture="spark",
          stretch=0.035, blend="add", secondary=True),
    ]
    return out


def _pool(t0: float, life: float, e_edge: float, glint_rate: float, crust_alpha: float) -> list:
    """the glossy pool from t0 for `life` s: caustic body, honey sheen, a creeping crust ring, a team edge that brightens"""
    hold = [[0, 0], [0.06, 1], [0.94, 1], [1, 0]]
    sc = lambda a: [[k, v * a] for k, v in hold]  # noqa: E731
    return [
        # body: glossy dark amber with a caustic shimmer (plain style tints the texture)
        L("decal", at="ground", delay=t0, shape="circle", style="plain", texture="caustic", radius=[[0, 0.6], [0.06, 1.0], [1, 1.0]], life=life,
          color=[[0, RESIN_DK], [0.15, RESIN], [1, "#B08050"]], alpha=sc(0.8), emissive=0.15, fit=True),
        # honey sheen on top (additive caustics, faint)
        L("decal", at="ground", delay=t0, shape="circle", style="light", texture="caustic", radius=[[0, 0.55], [0.06, 0.96], [1, 0.96]], life=life,
          color=AMBER, alpha=sc(0.35), emissive=[0.6, 0.9], fit=True),
        # the setting front: a pale ring creeping in from the rim to the centre (reaches it as the pool sets)
        L("shockwave", at="ground", delay=t0, radius=[[0, 1.0], [1, 0.04]], width=[0.16, 0.05], life=life, color=[HONEY, DAWNGLASS],
          alpha=[[0, 0], [0.08, 0.7], [0.9, 0.85], [1, 0]], emissive=[1.2, 2.2], sharp=1.2, noise=0.5, fit=True),
        # the danger edge: team keyline that brightens and tightens toward the set
        L("shockwave", at="ground", delay=t0, radius=[[0, 1.04], [0.8, 1.0], [1, 0.99]], width=[0.08, 0.13], life=life, color="team",
          alpha=[[0, 0.3], [0.1, 0.6], [0.85, 1.0], [1, 0]], emissive=[[0, 1.4], [0.7, 2.6], [1, e_edge]], sharp=2.4, noise=0.25, fit=True),
        # bubbles of light popping on the surface, drifting slowly (a slow is control: a gentle turn)
        L("emitter", at="ground", delay=t0, rate=glint_rate, duration=life * 0.92, shape="disc", radius=0.92, dir="up", spreadDeg=10,
          speed=[0.05, 0.2], life=[0.3, 0.55], size=[0, 0.16, 0], color=[HONEY, DAWNGLASS], alpha=[0, 1, 0], emissive=2.2, orbitDeg=24,
          texture="glint", blend="add", fit=True, secondary=True),
        L("emitter", at="ground", delay=t0 + 0.1, rate=glint_rate * 0.4, duration=life * 0.85, shape="disc", radius=0.85, dir="up", spreadDeg=5,
          speed=[0.0, 0.05], life=[0.5, 0.8], size=[0.05, 0.28], color=AMBER, alpha=[0.7, 0], emissive=1.4, texture="ring_thin", align="ground",
          blend="add", fit=True, secondary=True),
    ]


def defs() -> list:
    D = []

    # ── passive · Cracked Amber (on the cracked enemy; passives play at T1: no decals, emissive ≤ 1.5) ─────────────
    D.append(vfx("odrum_passive_crack", 0.7,
                 # an amber shell round the legs splits along team-lit seams and falls away
                 L("mesh", at="target", shape="orb", scale=[[0, 0.95], [0.25, 1.05], [1, 1.12]], stretch=[1.0, 1.35, 1.0], offset=[0, -0.45, 0],
                   life=0.42, color=[AMBER, RESIN], alpha=[[0, 0.55], [0.5, 0.45], [1, 0]], emissive=0.9, rim=HONEY, rimPow=1.6, rimEmissive=1.5,
                   noise=0.6, noiseScale=2.6, dissolve=[[0, 0.0], [0.15, 0.25], [1, 1.0]], edge="team", edgeWidth=0.12, edgeEmissive=1.5, blend="alpha"),
                 L("flash", at="target", radius=0.5, life=0.05, color="team", intensity=1.5, offset=[0, -0.3, 0]),
                 L("shockwave", at="target", radius=[[0, 0.25], [0.4, 0.75], [1, 0.9]], width=[0.18, 0.04], life=0.22, color="team", alpha=[1, 0.7, 0],
                   emissive=1.5, sharp=2.0, mode="vertical", offset=[0, -0.2, 0]),
                 # amber chips break off and fall (harm is down)
                 L("emitter", at="target", count=12, shape="ring", radius=0.42, offset=[0, -0.35, 0], dir="out", spreadDeg=60, speed=[1.5, 3.2],
                   life=[0.4, 0.6], size=[0.21, 0.2, 0.12], sizeVar=[0.6, 1.3], color=[HONEY, RESIN], alpha=[1, 1, 1, 0], gravity=14, drag=0.8,
                   bounce=0.3, texture="chip", blend="chip", spinDeg=[-540, 540], rim=NOON, rimAlpha=0.4),
                 L("emitter", at="target", count=6, shape="ring", radius=0.4, offset=[0, -0.3, 0], dir="down", spreadDeg=40, speed=[1.5, 3],
                   life=[0.12, 0.22], size=[0.14, 0.04], color="team", alpha=[1, 0], emissive=1.5, drag=2, texture="spark", stretch=0.04, blend="add"),
                 comment="T1 · Lumen · Cracked Amber: an amber shell round the legs splits along team-lit seams, amber chips fall, a short team ring"))

    # ── a1 · Resin Shot pool (zone: lob lands at 0.5 s, pool 1.5 s, then odrum_a1_set) ──────────────────────────────
    D.append(vfx("odrum_a1_resin", 2.3,
                 # 0 - 0.5 s: the lob comes down on the centre; its shadow grows; a soft team ring closes in
                 _blob(4.6, 0.5, 0.7, 1.2, 1.8),
                 L("decal", at="ground", shape="circle", style="plain", texture="splat", radius=[[0, 0.12], [1, 0.32]], life=0.52, color=INK2,
                   alpha=[[0, 0], [0.8, 0.45], [1, 0.3]], fit=True),
                 L("shockwave", at="ground", radius=[[0, 0.95], [1, 0.25]], width=[0.06, 0.1], life=0.5, color="team", alpha=[0, 0.45, 0.6],
                   emissive=1.5, sharp=1.5, noise=0.2, fit=True),
                 # 0.5 s: splash
                 L("flash", at="ground", delay=0.5, radius=0.8, life=0.06, color=AMBER, intensity=2.2),
                 _splash(0.5, 22, (2.4, 4.8), 0.16, 2.0, 0.32),
                 chips("ground", 6, speed=(2, 4.5), delay=0.52, size=0.12),
                 # 0.5 - 2.0 s: the pool
                 _pool(0.5, 1.5, 4.0, 14, 0.42),
                 light("ground", AMBER, 4.0, 4.0, 1.5, attack=0.2, delay=0.5),
                 comment="T3 · Lumen · Resin Shot: a resin blob drops on the centre, splashes opaque amber drops, a glossy caustic pool; a pale crust "
                         "ring creeps in from the rim while the team edge brightens: when the crust reaches the centre, it sets"))
    D.append(vfx("odrum_a1_set", 1.1,
                 L("flash", at="ground", radius=0.9, life=0.06, color="team", intensity=3.0),
                 # the clamp: the edge snaps inward
                 L("shockwave", at="ground", radius=[[0, 1.12], [0.5, 0.92], [1, 0.9]], width=[0.3, 0.08], life=0.22, color=[DAWNGLASS, "team"],
                   alpha=[1, 0.8, 0], emissive=3.0, sharp=2.2, noise=0.2, fit=True),
                 # hardened amber with team seams cooling in it (the root holds 1 s)
                 L("decal", at="ground", shape="circle", style="crack", radius=[[0, 0.7], [0.08, 1.0], [1, 1.0]], life=1.05, color=RESIN_DK, rim="team",
                   alpha=[[0, 0.9], [0.8, 0.75], [1, 0]], emissive=2.0, fit=True),
                 L("decal", at="ground", shape="circle", style="frost", texture="frost", radius=0.98, life=1.05, color=AMBER, rim=HONEY,
                   alpha=[[0, 0.55], [0.8, 0.4], [1, 0]], emissive=0.8, fit=True),
                 # glass splinters skitter out low, amber chips
                 L("emitter", at="ground", count=18, shape="ring", radius=0.7, dir="out", spreadDeg=25, speed=[2.0, 4.5], life=[0.25, 0.45],
                   size=[0.22, 0.18, 0], sizeVar=[0.6, 1.3], color=[HONEY, "team"], alpha=[1, 1, 0], emissive=2.6, gravity=4, drag=2.2,
                   texture="shard", blend="add", align="velocity", aspect=0.45, fit=True),
                 L("emitter", at="ground", count=14, shape="disc", radius=0.9, dir="up", spreadDeg=40, speed=[1.5, 3.5], life=[0.35, 0.6],
                   size=[0.12, 0.12, 0.08], sizeVar=[0.6, 1.3], color=[HONEY, RESIN], alpha=[1, 1, 1, 0], gravity=14, drag=0.8, bounce=0.3,
                   texture="chip", blend="chip", spinDeg=[-540, 540], rim=NOON, rimAlpha=0.4, fit=True, secondary=True),
                 shake(0.15),
                 comment="T2 · Lumen · Resin Shot sets: the team edge snaps inward, the pool hardens into cracked amber glass with team seams "
                         "cooling (1 s, the root), splinters skitter out"))

    # ── a2 · Swing Out (area at self, 3 m: the pots whirl, the ring of harm goes out) ───────────────────────────────
    def pot_sweep(rot: float) -> list:
        # a thin bright arc at the pot's radius (fan + edge mask) and a faint motion wedge behind it, whipping round
        return [L("mesh", at="origin", shape="fan", angleDeg=48, scale=2.9, offset=[0, -0.35, 0], life=0.32, color=[HONEY, AMBER],
                  alpha=[[0, 1], [0.7, 0.9], [1, 0]], emissive=2.4, mask="edge", maskParam=0.97, rotateDeg=[0, rot, 0], spinDeg=-1050, align="flat",
                  noise=0.25, blend="add"),
                L("mesh", at="origin", shape="fan", angleDeg=120, scale=2.8, offset=[0, -0.35, 0], life=0.32, color=AMBER,
                  alpha=[[0, 0.35], [0.7, 0.25], [1, 0]], emissive=1.2, mask="edge", maskParam=[[0, 0.9], [1, 0.9]], rotateDeg=[0, rot + 62, 0],
                  spinDeg=-1050, align="flat", noise=0.6, noiseScale=2.5, scroll=[2.0, 0], blend="add")]
    D.append(vfx("odrum_a2_whirl", 0.9,
                 # the two pots whip round at waist height (a bright arc each, a faint wedge of motion behind)
                 pot_sweep(0),
                 pot_sweep(180),
                 # the hit goes out to 3 m: the team edge is the brightest thing
                 L("shockwave", at="ground", delay=0.04, radius=[[0, 0.3], [0.35, 0.8], [1, 1.0]], width=[0.45, 0.07], life=0.34, color="team",
                   alpha=[1, 0.9, 0], emissive=3.0, sharp=2.0, noise=0.4, fit=True),
                 L("shockwave", at="ground", delay=0.1, radius=[[0, 0.25], [1, 0.7]], width=[0.2, 0.04], life=0.3, color="team", alpha=[0.6, 0.4, 0],
                   emissive=2.0, sharp=1.5, noise=0.5, fit=True),
                 # resin flung off the pots, tangent-ish and out (opaque drops)
                 L("emitter", at="origin", count=16, shape="ring", radius=1.35, offset=[0, -0.35, 0], dir="out", spreadDeg=50, speed=[4, 7.5],
                   life=[0.35, 0.6], size=[0.13, 0.1], sizeVar=[0.6, 1.4], color=[RESIN, AMBER], alpha=[1, 1, 0], gravity=12, drag=1.6,
                   orbitDeg=-140, texture="drop", blend="chip", rim=HONEY, rimAlpha=0.5, align="velocity", stretch=0.02),
                 L("emitter", at="origin", count=14, shape="ring", radius=1.3, offset=[0, -0.35, 0], dir="out", spreadDeg=20, speed=[6, 11],
                   life=[0.1, 0.2], size=[0.18, 0.05], color="team", alpha=[1, 0], emissive=2.6, drag=3, texture="streak", stretch=0.05, blend="add"),
                 # the slow: a low turn of dust (control spirals), then he leans into the run
                 dust("ground", 7, size=0.9, speed=(1.6, 3.0), radius=0.5, delay=0.05),
                 L("decal", at="ground", shape="ring", style="light", texture="caustic", radius=[[0, 0.8], [0.15, 1.0], [1, 1.0]], life=0.6, color="team",
                   alpha=[0.5, 0.3, 0], emissive=1.2, fit=True),
                 L("emitter", at="ground", delay=0.18, count=8, shape="disc", radius=0.3, dir="back", spreadDeg=20, speed=[4, 7], life=[0.1, 0.2],
                   size=[0.4, 0.1], color="team", alpha=[0.8, 0], emissive=2.2, drag=3, texture="streak", stretch=0.06, blend="add",
                   offset=[0, 0.25, 0], fit=False),
                 light("origin", AMBER, 5, 5, 0.3),
                 comment="T2 · Lumen · Swing Out: the two resin pots whip round at the waist (two bright heads, fading tails), drops of resin fly off, "
                         "a team ring goes out to 3 m (the hit), a turn of dust; side streaks as he leans into the run"))

    # ── a3 · Step and Load (dash: a low hop, a resin bead loaded into the sling) ────────────────────────────────────
    D.append(vfx("odrum_a3_hop", 1.4,
                 # push-off: dust and a few chips at the start (on the ground under the start point)
                 [dict(x, offset=[0, -0.95, 0]) for x in dust("origin", 5, size=0.8, speed=(1.0, 2.2), radius=0.2, delay=0.0)],
                 [dict(x, offset=[0, -0.95, 0]) for x in chips("origin", 5, speed=(1.5, 3.5), size=0.1, delay=0.0)],
                 # the hop: a short warm streak and a low team ground streak (movement is a side streak)
                 L("ribbon", at="path", color=[AMBER, "team"], width=[0.0, 0.42], life=0.22, alpha=[0, 0.6], emissive=2.4, noise=0.4, scroll=2.5),
                 L("ribbon", at="path", color="team", width=[0.0, 0.7], life=0.26, alpha=[0, 0.45], emissive=2.0, noise=0.5, face="ground"),
                 L("emitter", at="path", count=10, shape="sphere", radius=0.3, dir="back", spreadDeg=25, speed=[3, 6], life=[0.08, 0.16],
                   size=[0.3, 0.06], color="team", alpha=[0.9, 0], emissive=2.4, drag=3, texture="streak", stretch=0.05, blend="add"),
                 L("emitter", at="path", count=7, shape="sphere", radius=0.25, dir="back", spreadDeg=60, speed=[1.5, 3.5], life=[0.35, 0.6],
                   size=[0.12, 0.09], sizeVar=[0.6, 1.3], color=[RESIN, AMBER], alpha=[1, 1, 0], gravity=12, drag=1.2, texture="drop", blend="chip",
                   rim=HONEY, rimAlpha=0.5, align="velocity", stretch=0.02, secondary=True),
                 # landing (the hop lasts 0.25 s): a small ring and dust where he lands
                 L("shockwave", at="path", delay=0.25, offset=[0, -1.0, 0], radius=[[0, 0.2], [1, 0.9]], width=[0.18, 0.04], life=0.28, color="team",
                   alpha=[0.8, 0.5, 0], emissive=2.0, sharp=1.6),
                 [dict(x, offset=[0, -1.0, 0]) for x in dust("path", 4, size=0.7, speed=(0.8, 1.8), radius=0.2, delay=0.25)],
                 # loaded: a resin bead glows in the sling pouch and drips a little light (a glow is a warning)
                 L("sprite", at="path", socket="weapon", follow=True, delay=0.12, life=1.2, size=[[0, 0], [0.12, 0.55], [0.8, 0.45], [1, 0]],
                   color=[HONEY, AMBER], alpha=[[0, 0], [0.1, 1], [0.8, 0.9], [1, 0]], emissive=2.6, texture="glow", blend="add", soft=0.2),
                 L("sprite", at="path", socket="weapon", follow=True, delay=0.12, life=1.2, size=[[0, 0], [0.12, 0.2], [1, 0.16]],
                   color=AMBER, alpha=[[0, 0], [0.1, 1], [0.85, 1], [1, 0]], emissive=0.9, texture="drop", blend="chip", rim=HONEY, rimAlpha=0.7),
                 L("emitter", at="path", socket="weapon", follow=True, delay=0.2, bursts=[[0.0, 3], [0.35, 2], [0.7, 2]], shape="sphere", radius=0.12,
                   dir="random", spreadDeg=0, speed=[0.2, 0.5], life=[0.25, 0.4], size=[0, 0.1, 0], color=[HONEY, "team"], alpha=[0, 1, 0],
                   emissive=2.4, texture="glint", blend="add", secondary=True),
                 comment="T3 · Lumen · Step and Load: a push-off of dust, a short warm streak over a team ground streak, a ring where he lands; "
                         "a honey resin bead glows in the sling (the loaded shot) for a beat"))

    # ── ult · Amber Hour pool (zone 5 m: the great ball lands at 0.75 s, pool 2.0 s, then odrum_ult_set) ────────────
    D.append(vfx("odrum_ult_amber", 3.05,
                 _blob(7.5, 0.75, 1.3, 2.4, 2.2),
                 L("decal", at="ground", shape="circle", style="plain", texture="splat", radius=[[0, 0.08], [1, 0.3]], life=0.78, color=INK2,
                   alpha=[[0, 0], [0.8, 0.5], [1, 0.35]], fit=True),
                 L("shockwave", at="ground", radius=[[0, 0.97], [1, 0.2]], width=[0.08, 0.14], life=0.75, color="team", alpha=[0, 0.5, 0.7],
                   emissive=2.0, sharp=1.5, noise=0.2, fit=True),
                 # 0.75 s: the great splash, a second wave behind it
                 L("flash", at="ground", delay=0.75, radius=1.4, life=0.08, color=AMBER, intensity=3.0),
                 _splash(0.75, 34, (2.2, 4.4), 0.2, 2.4, 0.45),
                 L("shockwave", at="ground", delay=0.86, radius=[[0, 0.1], [1, 0.75]], width=[0.3, 0.05], life=0.5, color=AMBER,
                   alpha=[0.8, 0.5, 0], emissive=2.0, sharp=1.4, noise=0.5, fit=True),
                 chips("ground", 12, speed=(3, 6), delay=0.77, size=0.13),
                 [dict(x, fit=True) for x in dust("ground", 8, size=1.0, speed=(0.8, 1.6), radius=0.5, delay=0.8)],
                 L("feel", delay=0.75, shake=0.35, who="self"),
                 # 0.75 - 2.75 s: the great pool, with slow resin swells rolling out from the centre
                 _pool(0.75, 2.0, 6.0, 26, 0.5),
                 L("emitter", at="ground", delay=0.9, bursts=[[0.0, 1], [0.6, 1], [1.2, 1]], shape="point", dir="none", speed=[0, 0], life=[0.9, 0.9],
                   size=[0.3, 2.0], color=AMBER, alpha=[0.0, 0.55, 0], emissive=1.6, texture="ring_thin", align="ground", blend="add", fit=False),
                 light("ground", AMBER, 8.0, 8.0, 2.0, attack=0.3, delay=0.75),
                 comment="T3 · Lumen · Amber Hour: a great resin ball drops on the centre, a heavy splash and a second wave, a 5 m glossy pool with "
                         "slow swells; the pale crust ring creeps in from the rim while the team edge brightens: it sets as the crust closes"))
    D.append(vfx("odrum_ult_set", 1.8,
                 flash(4, at="ground", scale=1.3),
                 L("shockwave", at="ground", radius=[[0, 1.15], [0.5, 0.93], [1, 0.9]], width=[0.5, 0.12], life=0.28, color=[WHITE, "team"],
                   alpha=[1, 0.9, 0], emissive=10, sharp=2.2, noise=0.2, fit=True),
                 L("shockwave", at="ground", delay=0.05, radius=[[0, 0.15], [0.4, 0.8], [1, 1.0]], width=[0.4, 0.06], life=0.4, color="team",
                   alpha=[0.9, 0.7, 0], emissive=6, sharp=1.8, noise=0.3, fit=True),
                 L("decal", at="ground", shape="circle", style="crack", radius=[[0, 0.8], [0.06, 1.0], [1, 1.0]], life=1.55, color=RESIN_DK, rim="team",
                   alpha=[[0, 0.95], [0.85, 0.8], [1, 0]], emissive=4.0, fit=True),
                 L("decal", at="ground", shape="circle", style="frost", texture="frost", radius=0.98, life=1.55, color=AMBER, rim=HONEY,
                   alpha=[[0, 0.6], [0.85, 0.45], [1, 0]], emissive=1.2, fit=True),
                 # the whole group cracks: splinters skitter out low, amber chips, a glass mist settles
                 L("emitter", at="ground", count=34, shape="disc", radius=0.85, dir="out", spreadDeg=30, speed=[2.0, 4.0], life=[0.3, 0.55],
                   size=[0.26, 0.2, 0], sizeVar=[0.6, 1.3], color=[WHITE, HONEY, "team"], alpha=[1, 1, 0], emissive=6, gravity=4, drag=2.2,
                   texture="shard", blend="add", align="velocity", aspect=0.45, fit=True),
                 L("emitter", at="ground", count=26, shape="disc", radius=0.9, dir="up", spreadDeg=45, speed=[1.5, 3.0], life=[0.4, 0.7],
                   size=[0.13, 0.13, 0.08], sizeVar=[0.6, 1.3], color=[HONEY, RESIN], alpha=[1, 1, 1, 0], gravity=14, drag=0.8, bounce=0.3,
                   texture="chip", blend="chip", spinDeg=[-540, 540], rim=NOON, rimAlpha=0.4, fit=True, secondary=True),
                 [dict(x, fit=True) for x in dust("ground", 10, size=1.1, speed=(0.8, 1.6), radius=0.7, delay=0.12, color=(DUST, DUST2))],
                 light("ground", "team", 18, 9, 0.4),
                 shake(0.6),
                 comment="T4 · Lumen · Amber Hour sets: a white-core flash, the 5 m edge snaps inward, the pool turns to cracked amber glass with team "
                         "seams (1.5 s, the root), splinters and chips skitter out, dust settles"))
    return D
