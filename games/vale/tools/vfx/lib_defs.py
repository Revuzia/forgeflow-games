"""VALE shared VFX library (lib_*): the presets every fighter, unit and world event can use.

Anchors follow the director (src/render/director.ts): a cast fires at the caster (`origin`) when the
windup starts; projectiles ride their entity (`path`); hits land on the target (`target`); areas and
zones sit on the `ground` (radius-like values scale with the area: `fit`); dashes follow the fighter
(`path`); statuses track their unit (`target`). Built into content/vfx.json by tools/vfx/build_vfx.py.
"""
from __future__ import annotations

GOLD = "#FFD27A"   # Gleam (the game's gold)

from kit_defs import ult_tell  # noqa: E402  (max2 VFX-10: the shared ultimate tell)
from vfxkit import (CAP, CHALK, CHALK_DK, CHAR, DAWNGLASS, DUST, DUST2, EMBER, FLASH_R, INK, INK2, NOON, ORCHID, ROSE, SAP, SMOKE, SMOKE2, WHITE, beam, chips, decal,
                    dust, flash, glow, impact, ink, light, mesh, motes, petals, ribbon, shake, shards, shockwave, sparks, streaks, vfx, L)

WARM = "#FFE4B8"   # the shared hit core: a warm white that stays warm below T4 (not Dawnglass-clamped)


def defs() -> list:
    D = []
    # ── projectiles (ride the projectile: at path) ───────────────────────────────────────────────
    D.append(vfx("lib_bolt_lumen", 0.6,
                 flash(2, at="origin", scale=0.8),
                 mesh("path", "shard", 0.42, 0.6, color=[DAWNGLASS, "team"], alpha=1, emissive=3.0, rim="team", rim_pow=1.6, rim_emissive=2.5,
                      align="velocity", stretch=[0.7, 0.7, 1.6], hold=1),
                 glow("path", "team", 0.9, 0.6, 2.6, alpha=(1, 1, 1, 0.8), follow=True),
                 ribbon("path", "team", width=(0.0, 0.26), life=0.16, alpha=(0, 0.5), emissive=2.2),
                 L("emitter", at="path", rate=40, shape="point", dir="back", spreadDeg=35, speed=[0.4, 1.4], life=[0.12, 0.26], size=[0.09, 0.02],
                   color=["team", DAWNGLASS], alpha=[0.9, 0], emissive=2.4, drag=2, texture="glint", blend="add", secondary=True),
                 comment="T2 · Lumen · fast light dart: a glass head in a team glow, half-alpha streak, glints shed along the path"))
    D.append(vfx("lib_bolt_shade", 0.6,
                 flash(2, at="origin", scale=0.7, color=NOON, light=False),
                 mesh("path", "shard", 0.46, 0.6, color=INK, alpha=1, emissive=0, rim="team", rim_pow=1.2, rim_emissive=2.4, blend="ink",
                      align="velocity", stretch=[0.75, 0.75, 1.7], hold=1),
                 ribbon("path", INK2, width=(0.0, 0.34), life=0.24, alpha=(0, 0.8), emissive=0, blend="ink", rim="team"),
                 ink("path", 0, size=0.3, speed=(0.1, 0.4), life=(0.2, 0.32), rate=26, dir_="back", radius=0.05, gravity=0.6, rim_alpha=0.7),
                 comment="T2 · Shade · ink dart with a light rim: ink head inside a team rim, an ink wake that sinks"))
    D.append(vfx("lib_arrow", 0.5,
                 mesh("path", "spike", 0.55, 0.5, color=CHALK, alpha=1, emissive=0.6, blend="chip", align="velocity", stretch=[0.18, 0.18, 1.4], hold=1),
                 ribbon("path", "team", width=(0.0, 0.1), life=0.12, alpha=(0, 0.5), emissive=1.4),
                 comment="T1 · Lumen · basic-attack arrow or sling stone: opaque chalk shaft, thin team streak"))
    D.append(vfx("lib_shard_volley", 0.6,
                 mesh("path", "shard", 0.34, 0.6, color=[DAWNGLASS, "team"], alpha=1, emissive=2.6, rim="team", rim_pow=1.5, rim_emissive=2.0,
                      align="velocity", stretch=[0.6, 0.6, 1.5], hold=1),
                 ribbon("path", "team", width=(0.0, 0.16), life=0.12, alpha=(0, 0.45), emissive=1.8),
                 comment="T2 · Lumen · one glass shard of a fanned volley (the DSL count/spreadDeg makes the fan)"))
    D.append(vfx("lib_orb_lumen", 0.8,
                 mesh("path", "orb", [[0, 0.2], [0.15, 0.62], [1, 0.62]], 0.8, color=[DAWNGLASS, "team"], alpha=0.9, emissive=2.6, rim="team",
                      rim_pow=1.8, rim_emissive=3.0, noise=0.5, scroll=[0.4, 1.2], hold=1, wobble=0.03),
                 glow("path", "team", 1.6, 0.8, 1.8, alpha=(0, 0.8, 0.8, 0.6), follow=True),
                 L("emitter", at="path", rate=24, shape="sphere", radius=0.35, surface=True, dir="none", speed=[0, 0], life=[0.35, 0.6],
                   size=[0, 0.1, 0], color="team", alpha=[0, 1, 0], emissive=2.4, orbitDeg=360, texture="mote", blend="add"),
                 ribbon("path", "team", width=(0.0, 0.5), life=0.3, alpha=(0, 0.35), emissive=1.6, noise=0.5),
                 comment="T2 · Lumen · slow orb of stored light: team sphere, motes circling, glow trail"))
    D.append(vfx("lib_orb_shade", 0.8,
                 mesh("path", "orb", [[0, 0.25], [0.15, 0.64], [1, 0.64]], 0.8, color=INK, alpha=0.95, emissive=0, rim="team", rim_pow=1.4,
                      rim_emissive=2.6, noise=0.8, scroll=[0.5, -1.0], blend="ink", hold=1, wobble=0.05),
                 ink("path", 0, size=0.7, speed=(0.1, 0.5), life=(0.4, 0.7), rate=26, dir_="back", radius=0.2, gravity=0.8),
                 comment="T2 · Shade · slow ink orb: ink sphere inside a team rim, a smoke wake that sinks"))
    D.append(vfx("lib_thrown_blade", 0.6,
                 mesh("path", "crescent", 0.6, 0.6, color=CHALK, alpha=1, emissive=0.5, blend="chip", spin=1080, align="flat", hold=1,
                      rim="team", rim_pow=2.0, rim_emissive=2.0),
                 ribbon("path", "team", width=(0.0, 0.34), life=0.14, alpha=(0, 0.45), emissive=2.0, face="ground"),
                 comment="T2 · Lumen · spinning thrown blade: opaque chalk crescent, team edge, short streak"))
    D.append(vfx("lib_lob", 0.9,
                 mesh("path", "orb", 0.42, 0.9, color="#A0958A", alpha=1, emissive=0.4, blend="chip", rim="team", rim_pow=1.4, rim_emissive=2.6,
                      noise=0.6, hold=1, spin=240),
                 glow("path", "team", 1.0, 0.9, 1.6, alpha=(0, 0.7, 0.7, 0.5), follow=True),
                 L("emitter", at="path", rate=30, dir="back", spreadDeg=50, speed=[0.3, 1.0], life=[0.25, 0.5], size=[0.1, 0.03],
                   color=[EMBER, "team"], alpha=[1, 0], emissive=2.4, gravity=3, texture="ember", blend="add", secondary=True),
                 comment="T2 · Lumen · lobbed shell on an arc: stone core in a team glow, embers shed behind; the landing is a separate area"))
    def needle(id_: str, k: float, wake: float, extra=(), comment: str = "") -> dict:
        """a Needle's shot by tier (max VFX-5b): outer 1.0, inner and the Bell's ring brighter, longer, heavier"""
        return vfx(id_, 0.6,
                   flash(2, at="origin", scale=1.2 * k),
                   mesh("path", "spike", 0.9 * k, 0.6, color=[DAWNGLASS, "team"], alpha=1, emissive=3.0 * min(k, 1.3), rim="team", rim_emissive=3.0 * k,
                        align="velocity", stretch=[0.35, 0.35, 2.4], hold=1),
                   ribbon("path", "team", width=(0.0, 0.3 * k), life=0.14 * wake, alpha=(0, 0.6), emissive=2.6, noise=0.2),
                   # the shot's heat: the air at the needle tip shimmers as it lets go, the bolt bends light along its way (T3)
                   L("distort", at="origin", mode="haze", size=[0.7 * k, 1.1 * k], strength=[[0, 0.004], [0.25, 0.012], [1, 0]], life=0.4),
                   L("distort", at="path", follow=True, mode="bulge", size=0.55 * k, strength=[[0, 0.009], [0.8, 0.007], [1, 0]], life=0.6),
                   *extra, comment=comment)
    D.append(needle("lib_needle_shot", 1.0, 1.0, comment="T3 · Lumen · an outer Needle fires: a long team spike with a hard streak; muzzle flash "
                    "and a heat shimmer at the needle tip, light bent along the bolt, its light on the ground under it"))
    D.append(needle("lib_needle_shot_inner", 1.15, 1.6,
                    extra=(glow("path", "team", 1.1, 0.6, 3.0, alpha=(1, 1, 1, 0.8), follow=True),
                           L("emitter", at="path", rate=30, shape="point", dir="back", spreadDeg=30, speed=[0.4, 1.2], life=[0.14, 0.26],
                             size=[0.1, 0.02], color=["team", DAWNGLASS], alpha=[0.9, 0], emissive=2.6, drag=2, texture="glint", blend="add")),
                    comment="T3 · Lumen · an inner Needle fires: the outer shot at 1.15x with a glowing head, a 1.6x wake and glints shed"))
    D.append(needle("lib_needle_shot_bell", 1.35, 2.2,
                    extra=(glow("path", "team", 1.5, 0.6, 3.6, alpha=(1, 1, 1, 0.8), follow=True),
                           ribbon("path", DAWNGLASS, width=(0.0, 0.14), life=0.3, alpha=(0, 0.7), emissive=3.0, noise=0.1),
                           L("emitter", at="path", rate=46, shape="point", dir="back", spreadDeg=40, speed=[0.6, 1.8], life=[0.16, 0.3],
                             size=[0.14, 0.03], color=["team", DAWNGLASS], alpha=[1, 0], emissive=3.0, drag=2, texture="spark", stretch=0.03,
                             blend="add"),
                           shockwave("origin", radius=(0.2, 1.4), width=(0.2, 0.04), life=0.25, emissive=3.0, vertical=True)),
                    comment="T3 · Lumen · the Hourbell's needles fire: the heaviest shot, 1.35x, a bright head, a doubled 2.2x wake of team and "
                            "glass, sparks shed, a ring of air at the muzzle"))

    # ── impacts (at target) ───────────────────────────────────────────────────────────────────────
    # basic and ability hits (r12 M5): a 1-2 frame warm-white core big enough to read on pale stone (>= 0.6 m, L* >= 90),
    # an ink body behind it with a light rim (the value contrast pale stone needs), an oriented cut along
    # attacker -> victim (the instance's dir) for 100-130 ms, 4-6 radial streaks, opaque chips settled by 0.4 s.
    # The core is shared warm white (every hit reads as a hit); the cut's tail and the streaks carry the
    # attacker's signature (team for wicks and structures).
    def hit(id_: str, tier: int, r: float, cut: float, n_streak: int, n_chip: int, comment: str, extra=()) -> dict:
        e = CAP[tier]
        return vfx(id_, 0.5 if tier <= 1 else 0.8,
                   L("emitter", at="target", count=1, shape="point", dir="none", speed=[0, 0], life=[0.16, 0.2], size=[r * 1.5, r * 2.2],
                     color=[INK, INK2], alpha=[0.75, 0.5, 0], texture="ink_puff", blend="ink", rim=WARM, rimAlpha=0.85, soft=0.25, rotDeg=[0, 360]),
                   flash(tier, at="target", color=WARM, life=0.035, light=tier >= 2, scale=r / FLASH_R[tier]),
                   mesh("target", "crescent", [[0, cut * 0.55], [0.4, cut], [1, cut * 1.05]], 0.11 if tier <= 1 else 0.13, color=[WARM, "signature"],
                        alpha=(1, 0.9, 0), emissive=e, mask="sweep", mask_param=[0, 1.05], rotate=[18, 0, 0], stretch=[1.0, 1.0, 0.8]),
                   L("emitter", at="target", count=n_streak, shape="sphere", radius=0.08, dir="out", spreadDeg=360, speed=[6, 10], life=[0.15, 0.2],
                     size=[0.2, 0.04], color=[WARM, "signature"], alpha=[1, 0], emissive=e, drag=3, texture="spark", stretch=0.045, blend="add"),
                   chips("target", n_chip, speed=(2.5, 5.5), life=(0.25, 0.38), size=0.15, rim=WARM),
                   *extra, comment=comment)
    D.append(hit("lib_hit_phys_light", 1, 0.62, 0.95, 5, 6,
                 "T1 · impact · basic physical hit: a warm-white core over an ink puff (reads on pale stone), a cut along the blow in the "
                 "attacker's signature, 5 radial streaks, chalk chips settled by 0.4 s"))
    D.append(hit("lib_hit_phys_heavy", 2, 0.85, 1.25, 6, 10,
                 "T2 · impact · heavy physical hit: the light hit at 0.85 m with a wider cut, more chips, a short crack and settling dust",
                 extra=(decal("target", "crack", [[0, 0.6], [0.15, 1.1], [1, 1.1]], 0.8, color=INK2, alpha=(0.8, 0.7, 0), emissive=0.35, rim="team"),
                        *dust("target", 3, size=0.8, radius=0.2))))
    D.append(vfx("lib_hit_magic", 0.8,
                 L("emitter", at="target", count=1, shape="point", dir="none", speed=[0, 0], life=[0.18, 0.22], size=[1.0, 1.4], color=[INK, INK2],
                   alpha=[0.7, 0.45, 0], texture="ink_puff", blend="ink", rim=ORCHID, rimAlpha=0.85, soft=0.25, rotDeg=[0, 360]),
                 flash(2, at="target", color=WARM, life=0.035, scale=0.7 / FLASH_R[2]),
                 shockwave("target", color=[ROSE, ORCHID], radius=(0.2, 0.95), width=(0.2, 0.04), life=0.2, emissive=3.0, vertical=True, noise=0.2),
                 mesh("target", "orb", [[0, 0.25], [0.4, 0.8], [1, 0.9]], 0.16, color=[ORCHID, ROSE], alpha=(0.8, 0), emissive=2.6, rim=ROSE,
                      rim_pow=1.6, rim_emissive=2.4, noise=0.6, dissolve=[0, 0.25, 1], edge="signature", edge_emissive=2.6),
                 L("emitter", at="target", count=5, shape="sphere", radius=0.08, dir="out", spreadDeg=360, speed=[5, 8], life=[0.15, 0.2],
                   size=[0.18, 0.04], color=[WARM, "signature"], alpha=[1, 0], emissive=3.0, drag=3, texture="spark", stretch=0.04, blend="add"),
                 petals("target", 8, size=0.24),
                 chips("target", 4, speed=(2, 4), life=(0.25, 0.38), size=0.12, rim=ORCHID),
                 comment="T2 · impact · magic hit: a warm-white core over an ink puff with an orchid rim, an orchid-rose ring and bloom, "
                         "streaks in the caster's signature, petals of light"))
    D.append(vfx("lib_hit_true", 0.6, impact(2, "true"),
                 comment="T2 · impact · true damage: ink splash inside a Noonwhite halo (value inversion)"))
    D.append(vfx("lib_crit", 0.8,
                 L("emitter", at="target", count=1, shape="point", dir="none", speed=[0, 0], life=[0.2, 0.24], size=[1.4, 1.9], color=[INK, INK2],
                   alpha=[0.75, 0.5, 0], texture="ink_puff", blend="ink", rim=WARM, rimAlpha=0.9, soft=0.25, rotDeg=[0, 360]),
                 # the starburst: >= 0.7 x a fighter's height, one hard frame then gone
                 L("sprite", at="target", texture="flare", size=[[0, 1.2], [0.3, 1.6], [1, 1.7]], color=WARM, emissive=3.0, alpha=[[0, 1], [0.5, 0.8], [1, 0]],
                   life=0.09, rotDeg=[0, 360], space="world", hold=0),
                 flash(2, at="target", color=WARM, life=0.04, scale=1.2),
                 mesh("target", "crescent", [[0, 0.8], [0.3, 1.6], [1, 1.75]], 0.16, color=[WARM, "signature"], alpha=(1, 0.9, 0), emissive=3.0, mask="sweep",
                      mask_param=[0, 1.05], rotate=[18, 0, 0]),
                 L("emitter", at="target", count=9, shape="sphere", radius=0.1, dir="out", spreadDeg=360, speed=[8, 13], life=[0.16, 0.22],
                   size=[0.28, 0.05], color=[WARM, "signature"], alpha=[1, 0], emissive=3.0, drag=3, texture="spark", stretch=0.05, blend="add"),
                 chips("target", 14, speed=(3, 7), life=(0.3, 0.45), rim=WARM),
                 dust("target", 4, size=0.7, delay=0.2),
                 comment="T2 · impact · critical hit: a warm starburst >= 0.7 x fighter height for one beat over an ink puff, a big cut in "
                         "the attacker's signature, 9 hard streaks, a heavy chip spray"))

    # ── detonations / sweeps (areas: at ground, fit to the area radius) ──────────────────────────
    D.append(vfx("lib_burst_lumen", 0.9,
                 flash(2, at="ground", scale=1.6),
                 mesh("ground", "orb", [[0, 0.2], [0.25, 0.85], [1, 1.0]], 0.28, color=[WHITE, DAWNGLASS, "team"], alpha=(0.9, 0), emissive=3.0,
                      rim="team", rim_pow=1.4, rim_emissive=3.0, noise=0.5, dissolve=[0, 0.3, 1], edge="team", edge_emissive=3.0, fit=True),
                 shockwave("ground", radius=(0.2, 1.05), width=(0.35, 0.06), life=0.32, emissive=3.0, fit=True),
                 shards("ground", 14, speed=(5, 10), emissive=2.6),
                 chips("ground", 8, speed=(3, 6)),
                 decal("ground", "scorch", 0.9, 0.9, color=INK2, alpha=(0.55, 0.45, 0), emissive=0.5, rim="team", fit=True),
                 light("ground", "team", 6, 6, 0.3),
                 comment="T2 · Lumen · light detonation: team flash, edge ring brightest, glass shards fly out, opaque chips"))
    D.append(vfx("lib_burst_shade", 0.9,
                 flash(2, at="ground", color=NOON, scale=1.2, light=False),
                 ink("ground", 12, size=1.3, speed=(2.5, 4.5), life=(0.45, 0.8), radius=0.3, shape="disc", dir_="out", gravity=-0.1),
                 shockwave("ground", radius=(0.25, 1.0), width=(0.25, 0.05), life=0.35, emissive=2.6, fit=True),
                 L("emitter", at="ground", count=10, shape="disc", radius=0.4, dir="up", spreadDeg=50, speed=[2, 4], life=[0.4, 0.7], size=[0.14, 0.1],
                   color=[INK, INK2], alpha=[1, 1, 0], gravity=12, drag=0.6, texture="drop", blend="ink", rim=NOON, rimAlpha=0.6, bounce=0.1),
                 decal("ground", "ink", 1.0, 1.2, color=INK, alpha=(0.75, 0.6, 0), rim="team", fit=True),
                 comment="T2 · Shade · ink detonation: ink billows out under a team rim ring, drops fall, an ink stain"))
    D.append(vfx("lib_slam_ground", 0.9,
                 flash(2, at="ground", color=CHALK, scale=1.1, light=False),
                 decal("ground", "crack", [[0, 0.4], [0.1, 1.0], [1, 1.0]], 0.9, color=INK2, alpha=(0.85, 0.75, 0), emissive=0.45, rim="team", fit=True),
                 shockwave("ground", color=CHALK, radius=(0.3, 1.1), width=(0.4, 0.1), life=0.3, emissive=1.4, alpha=(0.8, 0.6, 0), fit=True),
                 chips("ground", 14, speed=(3.5, 7.5), size=0.13),
                 dust("ground", 8, size=1.1, speed=(1.5, 3.2), radius=0.6),
                 shake(0.25),
                 comment="T2 · impact · weapon or body slams the ground: crack decal, heavy chips out, dust ring"))
    D.append(vfx("lib_cone_sweep", 0.6,
                 # max2: a ground sweep, not a mesh: a thin team arc runs out across the cone over the fading cone mark (the fan
                 # mesh read as a solid tilted sheet)
                 decal("origin", "light", [[0, 0.4], [0.7, 3.0], [1, 3.1]], 0.5, shape="cone", angle=70, color=["team", DAWNGLASS], alpha=(1, 0.7, 0),
                       emissive=2.6, texture="ring_thin", fit=True),
                 L("emitter", at="origin", count=14, shape="cone", angleDeg=70, length=3.0, dir="forward", spreadDeg=30, speed=[4, 8],
                   life=[0.1, 0.22], size=[0.18, 0.04], color="team", alpha=[1, 0], emissive=2.6, drag=3, texture="streak", stretch=0.05, blend="add"),
                 decal("origin", "light", [[0, 0.5], [0.4, 3.0], [1, 3.0]], 0.5, shape="cone", angle=70, alpha=(0.5, 0.3, 0), emissive=1.3, fit=True),
                 comment="T2 · Lumen · sweeping cone strike: a team fan sweeps the arc (bright leading edge), streaks fly outward, a fading cone mark"))
    D.append(vfx("lib_ring_pulse", 0.6,
                 shockwave("origin", radius=(0.4, 2.6), width=(0.35, 0.08), life=0.4, emissive=2.6),
                 shockwave("origin", radius=(0.3, 1.9), width=(0.2, 0.05), life=0.34, emissive=1.8, delay=0.07, alpha=(0.7, 0.5, 0)),
                 motes("origin", 12, rise=0.4, life=(0.35, 0.6), radius=0.5, shape="ring", emissive=2.2),
                 comment="T2 · Lumen · expanding pulse around the caster: two team rings out, motes thrown outward"))
    D.append(vfx("lib_line_cleave", 0.6,
                 mesh("origin", "blade", [[0, 0.6], [0.3, 1.0], [1, 1.0]], 0.22, color=[WHITE, "team"], alpha=(1, 0), emissive=3.0, mask="sweep",
                      mask_param=[0, 1.05], align="dir", stretch=[1.3, 1, 4.2], offset=[2.0, 0.6, 0]),
                 decal("origin", "light", 1.0, 0.5, shape="line", length=4.5, width=1.0, alpha=(0.7, 0.45, 0), emissive=1.6),
                 chips("origin", 8, speed=(2, 5)),
                 comment="T2 · Lumen · long straight cleave: a team blade along the line, a fading line mark, chips kicked up"))

    # ── zones (loop while the zone lives: at ground, fit) ─────────────────────────────────────────
    def zone(id_, floor_style, floor_color, edge, extra, comment):
        D.append(vfx(id_, 1.0,
                     decal("ground", floor_style, 1.0, 1.05, color=floor_color, alpha=(0, 0.55, 0.55, 0), emissive=0.8, rim="team", fit=True),
                     shockwave("ground", radius=(0.98, 1.0), width=(0.08, 0.08), life=1.05, emissive=edge, alpha=(0, 1, 1, 0), sharp=2.5, noise=0.3, fit=True),
                     extra, comment=comment))
    zone("lib_zone_lumen", "light", "team", 2.4,
         motes("ground", 0, rate=10, rise=0.25, life=(0.8, 1.2), radius=1.0, shape="disc", emissive=2.0) ,
         "T3 · Lumen · lingering field of light: a faint team floor, a bright team edge, motes drifting level")
    zone("lib_zone_shade", "ink", INK, 2.2,
         ink("ground", 0, size=1.0, speed=(0.1, 0.4), life=(0.8, 1.2), rate=8, radius=0.9, shape="disc", dir_="up", gravity=-0.05, rim_alpha=0.45),
         "T3 · Shade · lingering pool of shadow: an ink-stain floor, a light rim in team colour, low smoke")
    zone("lib_zone_glass", "frost", DAWNGLASS, 2.4,
         L("emitter", at="ground", rate=10, shape="disc", radius=1.0, dir="none", speed=[0, 0], life=[0.8, 1.2], size=[0, 0.14, 0],
           color=[DAWNGLASS, "team"], alpha=[0, 0.8, 0], emissive=1.6, orbitDeg=60, texture="glint", blend="add", fit=True),
         "T3 · Lumen · slowing field of ground glass: a cracked glass floor, a slow control spiral, a team edge")
    zone("lib_zone_ember", "scorch", "#3A2A22", 2.6,
         L("emitter", at="ground", rate=16, shape="disc", radius=1.0, dir="out", spreadDeg=40, speed=[0.6, 1.4], life=[0.5, 0.9], size=[0.1, 0.03],
           color=[EMBER, "team"], alpha=[1, 0], emissive=2.4, gravity=0.6, turbulence=1.2, texture="ember", blend="add", fit=True),
         "T3 · Lumen · burning field: an ember floor, embers thrown outward (not up: up means help), a team edge")

    # ── movement ──────────────────────────────────────────────────────────────────────────────────
    D.append(vfx("lib_dash_trail", 0.5,
                 ribbon("path", "team", width=(0.0, 1.1), life=0.3, alpha=(0, 0.7), emissive=2.6, noise=0.45, face="ground"),
                 ribbon("path", DAWNGLASS, width=(0.0, 0.3), life=0.18, alpha=(0, 0.8), emissive=2.6, noise=0.2),
                 [L("emitter", at="path", rate=40, dir="back", spreadDeg=25, speed=[4, 8], life=[0.08, 0.16], size=[0.2, 0.05], color="team",
                    alpha=[0.9, 0], emissive=2.4, drag=3, texture="streak", stretch=0.05, blend="add")],
                 dust("origin", 5, size=0.8, speed=(1, 2.2), radius=0.2, delay=0.0),
                 comment="T3 · Lumen · dash: a team side-streak trail along the path, dust kicked at the start"))
    D.append(vfx("lib_blink", 0.4,
                 flash(3, at="origin", scale=0.8),
                 mesh("origin", "orb", [[0, 1.1], [1, 0.1]], 0.22, color=[DAWNGLASS, "team"], alpha=(0.9, 0), emissive=3.0, rim="team", rim_emissive=3.0,
                      dissolve=[0, 0.4, 1], edge="team", edge_emissive=4.0, stretch=[0.6, 1.4, 0.6], offset=[0, 0.9, 0]),
                 shards("origin", 12, speed=(1.5, 4), life=(0.2, 0.4), size=0.12, dir_="in", gravity=0),
                 shockwave("origin", radius=(0.9, 0.2), width=(0.2, 0.05), life=0.22, emissive=2.4),
                 comment="T3 · Lumen · blink: the caster folds into glass at the start and unfolds at the end"))
    D.append(vfx("lib_leap", 0.6,
                 dust("origin", 8, size=1.0, speed=(1.5, 3), radius=0.4, delay=0.0),
                 chips("origin", 8, speed=(2, 5)),
                 ribbon("path", "team", width=(0.0, 0.5), life=0.3, alpha=(0, 0.5), emissive=2.0),
                 comment="T3 · impact · leap: launch dust and chips at the start, a high team streak along the arc"))
    D.append(vfx("lib_haste", 0.6,
                 L("emitter", at="target", rate=26, duration=0.6, shape="disc", radius=0.35, dir="back", spreadDeg=20, speed=[3, 6], life=[0.1, 0.2],
                   size=[0.45, 0.1], color="team", alpha=[0.9, 0], emissive=2.4, drag=3, texture="streak", stretch=0.08, blend="add", offset=[0, -0.6, 0]),
                 comment="T2 · Lumen · haste: team side-streaks peel off behind the feet"))

    # ── buffs / statuses (at target, tracking) ───────────────────────────────────────────────────
    D.append(vfx("lib_shield_up", 0.8,
                 mesh("target", "orb", [[0, 0.5], [0.2, 1.65], [1, 1.6]], 0.8, color=DAWNGLASS, alpha=(0, 0.35, 0.3, 0), emissive=1.4, rim="team",
                      rim_pow=2.2, rim_emissive=3.0, noise=0.4, scroll=[0, 0.6], hold=0.6),
                 L("emitter", at="target", count=14, shape="ring", radius=0.6, dir="up", spreadDeg=10, speed=[1.0, 2.0], life=[0.4, 0.7],
                   size=[0.12, 0.04], color=[DAWNGLASS, "team"], alpha=[0, 1, 0], emissive=2.2, texture="shard", blend="add", offset=[0, -0.9, 0]),
                 shockwave("target", radius=(0.3, 0.8), width=(0.15, 0.04), life=0.4, emissive=2.0),
                 comment="T2 · Lumen · shield: a Dawnglass shell, glass flakes rising (help), a team ring at the feet"))
    D.append(vfx("lib_heal_rise", 0.8,
                 motes("target", 22, color=SAP, rise=2.4, life=(0.5, 0.85), radius=0.55, emissive=2.2),
                 mesh("target", "column", [[0, 0.3], [0.3, 0.8], [1, 0.8]], 0.6, color=SAP, alpha=(0.55, 0), emissive=1.6, mask="top", mask_param=0.5,
                      stretch=[0.9, 1.8, 0.9], offset=[0, -0.9, 0], noise=0.5, scroll=[0, 2.2], rim=SAP, rim_pow=1.6, rim_emissive=1.8),
                 L("emitter", at="target", count=6, shape="ring", radius=0.4, dir="up", spreadDeg=15, speed=[1.0, 1.8], life=[0.5, 0.8],
                   size=[0, 0.18, 0], color=[SAP, "#CFF2D9"], alpha=[0, 0.9, 0], emissive=1.6, texture="petal", blend="add", spinDeg=[-90, 90]),
                 shockwave("target", color=SAP, radius=(0.2, 0.9), width=(0.15, 0.04), life=0.45, emissive=1.6),
                 comment="T2 · Lumen · heal: Sap motes and petals rising (help is up), a soft Sap ring"))
    D.append(vfx("lib_stun_ring", 1.0,
                 L("emitter", at="target", rate=14, shape="ring", radius=0.42, dir="none", speed=[0, 0], life=[0.45, 0.7], size=[0, 0.14, 0],
                   color="team", alpha=[0, 1, 0], emissive=2.6, orbitDeg=420, texture="spark", blend="add", offset=[0, 1.1, 0]),
                 mesh("target", "ringwave", 0.55, 1.0, color="team", alpha=(0, 0.9, 0.9, 0), emissive=2.4, spin=260, align="up", offset=[0, 1.1, 0], hold=1),
                 decal("target", "light", 0.7, 1.0, shape="ring", alpha=(0, 0.6, 0.6, 0), emissive=1.2),
                 comment="T3 · Lumen · stun: a team control spiral turning over the head, sparks circling, a harm ring at the feet"))
    D.append(vfx("lib_root_bind", 1.0,
                 mesh("target", "spiral", [[0, 0.2], [0.15, 0.75], [1, 0.75]], 1.0, color=INK, alpha=(0, 1, 1, 0), emissive=0, rim="team", rim_emissive=2.4,
                      blend="ink", twist=-3, offset=[0, -0.7, 0], hold=1),
                 decal("target", "ink", 0.6, 1.0, color=INK, alpha=(0, 0.7, 0.7, 0), rim="team"),
                 comment="T3 · Shade · root: ink bands coil tight around the feet under a team rim; feet pinned"))
    D.append(vfx("lib_slow_glass", 1.0,
                 L("emitter", at="target", rate=10, shape="ring", radius=0.35, dir="down", spreadDeg=20, speed=[0.2, 0.5], life=[0.5, 0.8],
                   size=[0.1, 0.03], color=[DAWNGLASS, "team"], alpha=[0, 0.9, 0], emissive=1.4, texture="shard", blend="add", offset=[0, -0.4, 0]),
                 decal("target", "frost", 0.55, 1.0, color=DAWNGLASS, alpha=(0, 0.45, 0.45, 0), rim="team"),
                 comment="T2 · Lumen · slow: glass crust at the legs, flakes sinking, a faint control spiral at the feet"))
    D.append(vfx("lib_silence", 1.0,
                 ink("target", 0, size=0.7, speed=(0.1, 0.3), life=(0.6, 0.9), rate=10, radius=0.3, dir_="up", gravity=-0.2, rim_alpha=0.6) ,
                 mesh("target", "orb", 0.75, 1.0, color=INK, alpha=(0, 0.6, 0.6, 0), emissive=0, rim="team", rim_emissive=1.8, blend="ink",
                      offset=[0, 1.0, 0], noise=0.8, hold=1),
                 comment="T3 · Shade · silence: an ink hood of smoke around the head with a team rim; no sparks, no glow"))
    D.append(vfx("lib_empower", 0.8,
                 glow("origin", "team", 1.0, 0.8, 2.6, alpha=(0, 1, 0.8, 0), socket="weapon", follow=True),
                 L("emitter", at="origin", socket="weapon", follow=True, rate=24, duration=0.7, dir="up", spreadDeg=40, speed=[0.6, 1.6],
                   life=[0.2, 0.4], size=[0.08, 0.02], color="team", alpha=[1, 0], emissive=2.4, texture="spark", stretch=0.03, blend="add"),
                 comment="T2 · Lumen · empowered next attack: a weapon flare (a glow is a warning) and sparks rising off it"))
    D.append(vfx("lib_reveal_mark", 1.0,
                 mesh("target", "pillar", [[0, 0.1], [0.2, 1.0], [1, 1.0]], 1.0, color="team", alpha=(0, 0.45, 0.4, 0), emissive=1.6, mask="top",
                      mask_param=0.3, stretch=[0.35, 3.0, 0.35], offset=[0, -0.9, 0], noise=0.4, scroll=[0, 1.2], hold=1),
                 shockwave("target", radius=(0.9, 0.3), width=(0.1, 0.05), life=0.6, emissive=1.8, alpha=(0, 1, 0)),
                 comment="T2 · Lumen · revealed: a thin shaft of team light stands on the unit, a narrowing ring at the feet"))
    D.append(vfx("lib_mark_stack", 0.35,
                 mesh("target", "shard", [[0, 0.0], [0.3, 0.55], [1, 0.48]], 0.35, color=[DAWNGLASS, "team"], alpha=(1, 0.8), emissive=1.5, spin=420,
                      offset=[0, 1.5, 0], align="up"),
                 sparks("target", 4, speed=(1, 2), life=(0.1, 0.2), emissive=1.4, gravity=0),
                 comment="T1 · Lumen · one stack of a mark: a small team shard snaps into an orbit over the head"))

    # ── summons / ultimates ───────────────────────────────────────────────────────────────────────
    D.append(vfx("lib_summon_rise", 0.9,
                 shockwave("ground", radius=(0.2, 1.2), width=(0.25, 0.06), life=0.4, emissive=2.6, fit=True),
                 # max VFX-3: the ground's ink draws the summon up: an ink sleeve with a team rim climbs out of an ink pool, ink
                 # threads rise through it, a stair of light rings steps up and a thin shaft of light marks its heart
                 # max2: the pool is a dial of team light with a thin ink ring that dries in 0.7 s (was a 1.6 s black ink
                 # stain), the sleeve is one rim-lit erode sheath (the stacked stair + shaft cylinders are gone)
                 decal("ground", "ink", [[0, 0.3], [0.2, 0.95], [1, 1.0]], 0.7, color=SMOKE, alpha=(0.55, 0.3, 0), rim="team", fit=True),
                 decal("ground", "light", [[0, 0.4], [0.2, 1.1], [1, 1.15]], 0.9, color="team", alpha=(0.6, 0.35, 0), emissive=1.8, texture="rune", fit=True),
                 mesh("ground", "column", [[0, 0.2], [0.3, 0.7], [1, 0.72]], 0.6, color=[DAWNGLASS, "team"], alpha=(0.7, 0), emissive=2.2, rim="team",
                      rim_pow=1.3, rim_emissive=2.8, stretch=[0.9, 1.6, 0.9], noise=0.7, scroll=[0, 1.6], dissolve=[0, 0, 0.25, 1], edge="team",
                      edge_emissive=2.6),
                 L("emitter", at="ground", count=14, shape="ring", radius=0.55, dir="up", spreadDeg=12, speed=[1.8, 3.2], life=[0.4, 0.65],
                   size=[0.4, 0.08], color=[INK, INK2], alpha=[0.9, 0], texture="streak", stretch=0.06, blend="ink", rim="team", rimAlpha=0.7),
                 motes("ground", 16, rise=2.6, radius=0.6, emissive=2.6),
                 chips("ground", 8),
                 comment="T3 · a summon rises: the ground's ink draws it up (ink threads rising out of a thin drying ink ring over a lit "
                         "dial), one rim-lit sleeve of team light, a team ring, motes, stone chips"))
    D.append(vfx("lib_ult_windup", 0.8,
                 shockwave("origin", radius=(2.4, 0.4), width=(0.08, 0.28), life=0.7, emissive=3.0, alpha=(0, 1, 0.4)),
                 L("emitter", at="origin", rate=50, duration=0.6, shape="ring", radius=2.2, dir="in", spreadDeg=10, speed=[2.5, 4], life=[0.35, 0.55],
                   size=[0.12, 0.05], color="team", alpha=[0, 1, 0], emissive=3.0, texture="spark", stretch=0.03, blend="add"),
                 glow("origin", "team", 1.6, 0.8, 3.0, alpha=(0, 0.5, 1, 0), offset=[0, 1.0, 0]),
                 light("origin", "team", 8, 6, 0.8, attack=0.6),
                 *ult_tell(0.75, held=False),
                 comment="T3 · Lumen · ultimate wind-up: a team ring closes in, light gathers inward and up (the warning); max2: the "
                         "closing hour-dial and the standing shaft every ultimate wind-up shares"))
    D.append(vfx("lib_ult_lumen", 1.4,
                 flash(4, at="ground", scale=1.6),
                 mesh("ground", "orb", [[0, 0.2], [0.2, 1.1], [1, 1.25]], 0.4, color=[WHITE, DAWNGLASS, "team"], alpha=(1, 0), emissive=12, rim="team",
                      rim_emissive=6, noise=0.5, dissolve=[0, 0.3, 1], edge="team", edge_emissive=6, fit=True),
                 shockwave("ground", radius=(0.3, 1.2), width=(0.6, 0.1), life=0.45, emissive=6, fit=True),
                 shockwave("ground", radius=(0.2, 0.9), width=(0.3, 0.05), life=0.6, emissive=3, delay=0.1, alpha=(0.8, 0.4, 0), fit=True),
                 shards("ground", 30, speed=(7, 14), emissive=6, size=0.22),
                 chips("ground", 16, speed=(4, 9), size=0.14),
                 dust("ground", 10, size=1.4, speed=(2, 4), radius=0.8, delay=0.15),
                 decal("ground", "scorch", 1.1, 1.4, color=INK2, alpha=(0.7, 0.6, 0), emissive=2.5, rim="team", fit=True),
                 light("ground", "team", 20, 10, 0.5),
                 shake(0.7),
                 comment="T4 · Lumen · ultimate release, light: white core flash (T4 only), a team edge ring brightest, a glass storm out, chips"))
    D.append(vfx("lib_ult_shade", 1.4,
                 flash(4, at="ground", scale=1.4),
                 ink("ground", 22, size=1.8, speed=(3.5, 6.5), life=(0.55, 1.0), radius=0.4, shape="disc", dir_="out", gravity=-0.1),
                 shockwave("ground", radius=(0.3, 1.2), width=(0.5, 0.08), life=0.5, emissive=6, fit=True),
                 L("emitter", at="ground", count=18, shape="disc", radius=0.6, dir="up", spreadDeg=55, speed=[3, 6], life=[0.5, 0.9],
                   size=[0.16, 0.12], color=[INK, INK2], alpha=[1, 1, 0], gravity=12, drag=0.6, texture="drop", blend="ink", rim=NOON, rimAlpha=0.6),
                 decal("ground", "ink", 1.15, 1.4, color=INK, alpha=(0.8, 0.65, 0), rim="team", fit=True),
                 shake(0.7),
                 comment="T4 · Shade · ultimate release, shadow: white core flash (T4 only), an ink storm out under a bright team rim, ink rain"))

    # ── world events ──────────────────────────────────────────────────────────────────────────────
    D.append(vfx("lib_level_up", 1.2,
                 # a deliberate moment (m2): a column of the fighter's own light (L* 85-90), two rings rising up it over 1 s
                 # max VFX-3: hour ticks snap up a dial round the feet (a stair of dial rings rising), a short shaft of the
                 # fighter's light, the carved dial on the ground lit once
                 mesh("origin", "stair", [[0, 0.2], [0.18, 1.05], [1, 1.1]], 1.0, color=["signature", "#FFF4DA"], alpha=[[0, 0], [0.1, 0.9], [0.6, 0.6], [1, 0]],
                      emissive=2.8, stretch=[1.15, 2.0, 1.15], offset=[0, -0.9, 0], noise=0.3, scroll=[0, 1.0], spin=120),
                 mesh("origin", "shaft", [[0, 0.2], [0.25, 0.55], [1, 0.5]], 0.8, color=["#FFF4DA", "signature"], alpha=[[0, 0], [0.1, 0.9], [1, 0]],
                      emissive=2.8, stretch=[0.6, 3.0, 0.6], offset=[0, -0.9, 0], noise=0.3, scroll=[0, 2.6]),
                 decal("origin", "light", [[0, 0.6], [0.15, 1.25], [1, 1.3]], 1.1, color="signature", alpha=(0.8, 0.5, 0), emissive=1.8, texture="rune"),
                 *[L("emitter", at="origin", delay=dl, count=1, offset=[0, -0.85, 0], shape="point", dir="up", spreadDeg=0, speed=[2.4, 2.4], life=[0.8, 0.8],
                     size=[1.6, 1.9, 1.5], color=["signature", "#FFF4DA"], alpha=[[0, 0], [0.15, 1], [0.7, 0.8], [1, 0]], emissive=2.8, drag=1.2,
                     texture="ring_thin", align="ground", blend="add") for dl in (0.0, 0.35)],
                 shockwave("origin", color="team", radius=(0.3, 1.0), width=(0.2, 0.05), life=0.5, emissive=2.6),
                 motes("origin", 18, color=["signature", "#FFF4DA"], rise=2.8, radius=0.6, emissive=2.6),
                 comment="T2 · Lumen · level up: a 0.9 m column of the fighter's signature light, two rings rising up it over 1 s, a team "
                         "ring at the feet, motes climb (help is up)"))
    D.append(vfx("lib_respawn", 0.9,
                 # max VFX-3: the Seat's light pours down: streaks of team light fall onto the spot from above, an eroded sleeve of
                 # light sets the fighter down, a lit pool and dial on the ground
                 L("emitter", at="origin", offset=[0, 3.6, 0], count=18, shape="disc", radius=0.55, dir="down", spreadDeg=6, speed=[9, 13], life=[0.22, 0.3],
                   size=[0.7, 0.1], color=[NOON, "team"], alpha=[0, 1, 0.6], emissive=3.0, texture="streak", stretch=0.06, blend="add"),
                 # max2: the light is set down in three beats, not one column: the falling streaks, a thin sleeve (half the
                 # column's alpha) and dial rings stepping DOWN onto the feet (the level-up stair reversed), then the seat ring
                 mesh("origin", "column", [[0, 1.0], [1, 0.75]], 0.6, color=[DAWNGLASS, "team"], alpha=(0.5, 0), emissive=2.4, mask="top", mask_param=0.3,
                      stretch=[0.7, 3.0, 0.7], offset=[0, -0.9, 0], dissolve=[0, 0.2, 1], edge="team", rim="team", rim_pow=1.4, rim_emissive=3.0,
                      scroll=[0, -2.0], noise=0.5),
                 *[L("emitter", at="origin", delay=dl, count=1, offset=[0, 0.8, 0], shape="point", dir="down", spreadDeg=0, speed=[6.5, 6.5], life=[0.5, 0.5],
                     size=[1.0, 1.5, 1.7], color=[NOON, "team"], alpha=[[0, 0], [0.15, 1], [0.8, 0.8], [1, 0]], emissive=2.6, drag=2.5,
                     texture="ring_thin", align="ground", blend="add") for dl in (0.05, 0.2)],
                 L("emitter", at="origin", count=10, shape="ring", radius=0.9, dir="up", spreadDeg=8, speed=[1.6, 2.6], life=[0.35, 0.5],
                   size=[0.5, 0.08], color=[NOON, "team"], alpha=[1, 0], emissive=2.6, texture="streak", stretch=0.05, blend="add", delay=0.3),
                 decal("origin", "light", [[0, 0.5], [0.2, 1.2], [1, 1.2]], 0.9, color="team", alpha=(0.7, 0.4, 0), emissive=1.6, texture="rune"),
                 decal("origin", "light", 1.0, 0.7, color="team", alpha=(0.5, 0.3, 0), emissive=1.4, texture="glow"),
                 shockwave("origin", radius=(0.2, 1.4), width=(0.3, 0.06), life=0.45, emissive=2.6, delay=0.18),
                 motes("origin", 16, rise=2.2, radius=0.6, emissive=2.4, delay=0.18),
                 comment="T2 · Lumen · respawn: the Seat's light pours down onto the spot, two dial rings step down onto the feet round a thin "
                         "sleeve, a lit pool and dial, a ring settles out, streaks and motes rise"))
    D.append(vfx("lib_recall", 1.0,
                 shockwave("origin", radius=(0.8, 0.8), width=(0.1, 0.1), life=1.0, emissive=2.0, alpha=(0, 0.9, 0.9, 0), sharp=2.0),
                 mesh("origin", "column", 0.8, 1.0, color="team", alpha=(0, 0.3, 0.3, 0), emissive=1.6, mask="top", mask_param=0.4,
                      stretch=[0.8, 2.6, 0.8], offset=[0, -0.9, 0], noise=0.6, scroll=[0, 1.0], hold=1),
                 motes("origin", 0, rate=14, rise=1.6, radius=0.7, emissive=2.0),
                 comment="T2 · Lumen · recall channel (loop): a slow team ring at the feet, a faint column, motes drifting up"))
    D.append(vfx("lib_death_shatter", 3.2,
                 flash(2, at="origin", color="team", scale=0.9),
                 chips("origin", 22, color=(CHALK, CHALK_DK), speed=(2.5, 6), life=(0.6, 0.9), size=0.2),
                 sparks("origin", 10, speed=(4, 8), emissive=2.4),
                 shockwave("origin", radius=(0.2, 1.0), width=(0.2, 0.05), life=0.35, emissive=2.0),
                 dust("origin", 8, size=1.2, delay=0.15, radius=0.5),
                 # max VFX-4 the snuffed lamp: the fighter's own light leaves the body as a rising plume of ink and embers, the
                 # killer-side ring runs out wide, a brief pool of the fighter's light on the ground, and a scorched hour-mark stays
                 # where they fell (3 s); never a flash to white (ruling 10)
                 # max2: the plume is warm smoke (SMOKE), not a near-black blob over the body
                 ink("origin", 6, size=0.6, speed=(1.4, 2.6), life=(0.7, 1.1), radius=0.3, dir_="up", gravity=-1.4, delay=0.08, rim_alpha=0.45,
                     color=(SMOKE, SMOKE2)),
                 L("emitter", at="origin", count=26, shape="sphere", radius=0.35, dir="up", spreadDeg=40, speed=[1.4, 3.4], life=[0.8, 1.4],
                   size=[0.12, 0.05], color=["signature", EMBER], alpha=[1, 0.8, 0], emissive=2.6, gravity=-1.4, drag=1.2, turbulence=1.4,
                   texture="ember", blend="add", delay=0.05),
                 L("emitter", at="origin", count=1, shape="point", dir="up", spreadDeg=0, speed=[1.6, 1.6], life=[0.7, 0.7],
                   size=[[0, 0.6], [0.3, 1.1], [1, 0.4]], color="signature", alpha=[[0, 0.9], [0.4, 0.6], [1, 0]], emissive=2.6, drag=1.4,
                   texture="glow", blend="add"),
                 shockwave("origin", radius=(0.6, 2.6), width=(0.18, 0.04), life=0.55, emissive=2.2, delay=0.06, alpha=(0.9, 0.6, 0)),
                 decal("origin", "light", 1.6, 0.6, color="signature", alpha=(0.55, 0.3, 0), emissive=1.6, texture="glow"),
                 decal("origin", "scorch", [[0, 0.5], [0.06, 1.15], [1, 1.2]], 3.2, color=CHAR, alpha=[[0, 0.7], [0.75, 0.55], [1, 0]], emissive=1.2,
                       rim="signature"),
                 decal("origin", "light", 1.2, 3.0, color="signature", alpha=[[0, 0.7], [0.7, 0.35], [1, 0]], emissive=1.0, texture="rune"),
                 light("origin", "signature", 8, 6, 0.6),
                 comment="T2 · impact · a fighter falls — the snuffed lamp: the mask cracks into opaque chips, the fighter's light leaves "
                         "as a rising plume of ink and embers, a ring runs out, a brief light pool, a scorched hour-mark stays 3 s"))
    def gleam(id_: str, n: int, k: float, comment: str, extra=()) -> dict:
        """max VFX-9: Gleam paid out: warm coins pop off the victim and arc toward the killer (the spawn's dir), a soft glint
        lands on the killer as they arrive (`at: caster`), a few motes rise off them; own feedback only (the director)"""
        return vfx(id_, 0.9,
                   flash(2, at="origin", color=GOLD, scale=0.55 * k, light=False),
                   L("emitter", at="origin", count=n, shape="sphere", radius=0.12, dir="forward", spreadDeg=38, speed=[2.6 * k, 4.2 * k],
                     velocity=[0, 3.6, 0], life=[0.5, 0.62], size=[0.34 * k, 0.4 * k, 0.2 * k], color=[GOLD, "#FFE9B0"], alpha=[1, 1, 0],
                     emissive=2.4, gravity=9, drag=0.4, spinDeg=[-400, 400], texture="glint", blend="add"),
                   L("emitter", at="origin", count=n // 2, shape="sphere", radius=0.1, dir="up", spreadDeg=50, speed=[1.5, 2.6], life=[0.25, 0.4],
                     size=[0.1, 0.03], color=GOLD, alpha=[1, 0], emissive=2.4, gravity=4, texture="spark", stretch=0.03, blend="add"),
                   L("sprite", at="caster", delay=0.42, texture="flare", size=[[0, 0.5 * k], [0.3, 0.85 * k], [1, 0.7 * k]], color=GOLD, emissive=2.4,
                     alpha=[[0, 0], [0.2, 1], [1, 0]], life=0.24, rotDeg=[0, 360], space="world", hold=0),
                   motes("caster", n // 2, color=GOLD, rise=1.6, life=(0.3, 0.5), radius=0.3, emissive=2.0, delay=0.44),
                   *extra, comment=comment, team_tint=False)
    D.append(gleam("lib_gleam_pickup", 8, 1.0, "T2 · Lumen · your last hit pays: eight warm Gleam coins pop off the unit and arc to you, "
                   "a soft glint lands on you (own feedback, no relationship)"))
    D.append(gleam("lib_gleam_bounty", 16, 1.35, "T2 · Lumen · your champion kill pays its bounty: the last-hit coins at 1.35x with a warm "
                   "ring out on the ground where they fell",
                   extra=(shockwave("origin", color=[GOLD, "#FFE9B0"], radius=(0.3, 2.0), width=(0.22, 0.05), life=0.45, emissive=2.4),
                          shockwave("caster", color=GOLD, radius=(1.2, 0.3), width=(0.12, 0.05), life=0.3, emissive=2.2, delay=0.42))))
    D.append(vfx("lib_sunmote_pickup", 0.7,
                 flash(2, at="origin", color="#FFD27A", scale=1.0),
                 motes("origin", 16, color="#FFD27A", rise=3.0, radius=0.5, emissive=2.6),
                 shockwave("origin", radius=(0.2, 1.1), width=(0.2, 0.05), life=0.4, emissive=2.4),
                 comment="T2 · Lumen · Sunmote taken: a warm burst and motes rise into the picker, a ring in the picker's colour"))
    D.append(vfx("lib_structure_fall", 1.6,
                 flash(4, at="origin", scale=2.2),
                 chips("origin", 30, color=(CHALK, CHALK_DK), speed=(3, 8), life=(0.7, 1.2), size=0.2),
                 dust("origin", 16, size=2.2, speed=(2, 4.5), radius=1.2, life=(0.8, 1.4), delay=0.1),
                 shockwave("origin", radius=(0.5, 4.0), width=(0.8, 0.15), life=0.6, emissive=6),
                 decal("origin", "crack", 3.0, 1.6, color=INK2, alpha=(0.8, 0.7, 0), emissive=2.0, rim="team"),
                 light("origin", "team", 20, 14, 0.6),
                 shake(1.0, who="all"),
                 comment="T4 · impact · Needle, Lantern or Hourbell falls: white core flash (T4), stone collapses into heavy chips, a team ring"))
    # r12 M9 structure states (src/render/structures.ts; ids from UnitDef.art.damage / art.ruin): origin = the
    # tower's flank at the break / crack height, ground = its foot; the camera never shakes for these
    D.append(vfx("lib_structure_crack", 1.1,
                 flash(2, at="origin", scale=1.3, color="team"),
                 sparks("origin", 10, color=["team", DAWNGLASS], speed=(2.5, 5.5), life=(0.12, 0.3), emissive=2.6, gravity=4, spread=120, dir_="out"),
                 # r12 M9 fix: chips that read at the gameplay camera (0.32 m ≈ 12-18 px at 1080p), beside the real
                 # broken-off stones the renderer drops (structures.ts dropChip)
                 chips("origin", 24, color=(CHALK, CHALK_DK), speed=(1.4, 3.6), life=(0.8, 1.1), size=0.32, spread=110, gravity=12, delay=0.02),
                 dust("origin", 5, size=1.1, speed=(0.5, 1.4), radius=0.4, life=(0.6, 1.0), delay=0.05, shape="sphere"),
                 dust("ground", 4, size=1.2, speed=(0.6, 1.6), radius=0.9, life=(0.7, 1.0), delay=0.35),
                 comment="T2 · impact · a structure passes a damage threshold: its light flares through the new cracks, heavy chips rain off where it broke"))
    D.append(vfx("lib_structure_break", 1.3,
                 flash(3, at="origin", scale=1.4, color="team", light=False),
                 sparks("origin", 18, color=["team", DAWNGLASS], speed=(4, 9), life=(0.15, 0.4), emissive=4.0, gravity=6, spread=170, dir_="out"),
                 chips("origin", 34, color=(CHALK, CHALK_DK), speed=(2.5, 6.5), life=(0.8, 1.3), size=0.24, spread=170, gravity=13),
                 dust("origin", 10, size=1.8, speed=(1.0, 2.8), radius=0.7, life=(0.8, 1.3), delay=0.06, shape="ring"),
                 # max2: a 5.5 m pool at 5 (was 9 m at 8: the whole frame went blue for 0.3 s)
                 light("origin", "team", 5, 5.5, 0.45),
                 # max VFX-4: a dust column climbs off the break, smoke lingers, the base's ground lights once
                 L("emitter", at="origin", count=12, shape="sphere", radius=0.6, dir="up", spreadDeg=25, speed=[1.6, 3.4], life=[1.2, 2.0],
                   size=[1.2, 2.4, 3.0], sizeVar=[0.8, 1.25], color=[DUST, DUST2], alpha=[0, 0.6, 0.35, 0], gravity=-0.4, drag=1.6, turbulence=0.4,
                   rotDeg=[0, 360], spinDeg=[-25, 25], texture="dust_puff", blend="alpha", soft=0.3, delay=0.05),
                 ink("origin", 5, size=1.4, speed=(0.4, 1.0), life=(1.6, 2.4), radius=0.5, dir_="up", gravity=-0.5, delay=0.3, rim_alpha=0.25,
                     color=(SMOKE2, DUST)),
                 decal("ground", "light", 2.2, 0.8, color="team", alpha=(0.4, 0.22, 0), emissive=1.4, texture="glow"),
                 comment="T3 · impact · a structure's top shears off at the break: its light bursts out, heavy chips and a dust collar"))
    D.append(vfx("lib_structure_land", 1.8,
                 dust("ground", 22, size=2.6, speed=(2.0, 5.0), life=(1.0, 1.7), radius=1.6, delay=0.0, alpha=0.55),
                 dust("ground", 10, size=1.8, speed=(0.6, 1.8), life=(1.2, 1.8), radius=0.6, delay=0.12, shape="sphere"),
                 chips("ground", 40, color=(CHALK, CHALK_DK), speed=(3, 8), life=(0.7, 1.2), size=0.26, spread=150, gravity=15),
                 shockwave("ground", color=DUST, radius=(0.8, 6.0), width=(1.4, 0.3), life=0.7, emissive=0.0, alpha=(0.7, 0.5, 0), blend="alpha",
                           noise=0.5),
                 decal("ground", "crack", 3.2, 2.2, color=INK2, alpha=(0.75, 0.6, 0)),
                 # max VFX-4: the rubble keeps smoking and a dust column hangs over the fall
                 L("emitter", at="ground", count=10, shape="disc", radius=1.4, dir="up", spreadDeg=20, speed=[1.0, 2.2], life=[1.6, 2.4],
                   size=[1.4, 2.6, 3.2], sizeVar=[0.8, 1.25], color=[DUST, DUST2], alpha=[0, 0.5, 0.3, 0], gravity=-0.3, drag=1.4, turbulence=0.4,
                   rotDeg=[0, 360], spinDeg=[-20, 20], texture="dust_puff", blend="alpha", soft=0.3, delay=0.15),
                 ink("ground", 0, size=1.4, speed=(0.3, 0.8), life=(1.4, 2.0), rate=4, duration=1.6, radius=1.2, shape="disc", dir_="up", gravity=-0.4,
                     rim_alpha=0.2, color=(SMOKE2, DUST)),
                 comment="T3 · settle · the fallen top hits the ground and breaks up: a wide dust ring, a burst of rubble, a crack mark"))
    D.append(vfx("lib_wick_death", 0.35,
                 flash(1, at="origin", scale=0.8),
                 dust("origin", 2, size=0.5, radius=0.1, delay=0.0),
                 chips("origin", 4, size=0.07, speed=(1.5, 3)),
                 # max VFX-4: the guttered lamp lets go a curl of smoke and a few embers
                 ink("origin", 3, size=0.55, speed=(0.6, 1.2), life=(0.5, 0.8), radius=0.12, dir_="up", gravity=-0.8, rim_alpha=0.5),
                 L("emitter", at="origin", count=6, shape="sphere", radius=0.15, dir="up", spreadDeg=50, speed=[0.8, 2.0], life=[0.4, 0.7],
                   size=[0.08, 0.03], color=["team", EMBER], alpha=[1, 0], emissive=2.0, gravity=-0.8, turbulence=1.2, texture="ember", blend="add"),
                 comment="T1 · impact · a Wick falls: its lamp gutters (a small team flash), a puff and a few chips"))
    D.append(vfx("lib_monster_fall", 1.6,
                 # max2 VFX-5c: a neutral monster falls (was the Wick's 0.35 s puff): the body hits the ground in a heavy dust ring
                 # and stone chips, the wild light it carried leaves as warm embers and a short rising wisp, a cracked mark stays
                 # 1.4 s; no team colour on the fall itself (the killer side reads from the Gleam and the kill feed)
                 flash(2, at="origin", color=EMBER, scale=0.9, light=False),
                 dust("ground", 12, size=1.6, speed=(1.6, 3.6), radius=0.9, life=(0.7, 1.2), delay=0.05, alpha=0.5),
                 chips("ground", 16, color=(CHALK, CHALK_DK), speed=(2.5, 6), life=(0.6, 1.0), size=0.2),
                 shockwave("ground", color=DUST, radius=(0.4, 2.2), width=(0.6, 0.12), life=0.5, emissive=0.0, alpha=(0.6, 0.4, 0), blend="alpha",
                           noise=0.5),
                 L("emitter", at="origin", count=18, shape="sphere", radius=0.4, dir="up", spreadDeg=40, speed=[1.2, 3.0], life=[0.8, 1.3],
                   size=[0.12, 0.05], color=[EMBER, "#FFE4B8"], alpha=[1, 0.8, 0], emissive=2.4, gravity=-1.2, drag=1.2, turbulence=1.4,
                   texture="ember", blend="add", delay=0.08),
                 ink("origin", 4, size=0.8, speed=(1.0, 2.0), life=(0.8, 1.2), radius=0.3, dir_="up", gravity=-1.0, delay=0.12, rim_alpha=0.35,
                     color=(SMOKE, SMOKE2)),
                 decal("ground", "crack", [[0, 0.5], [0.08, 1.4], [1, 1.45]], 1.4, color=CHAR, alpha=(0.7, 0.55, 0), emissive=1.2, rim=EMBER),
                 comment="T2 · impact · a neutral monster falls: a heavy dust ring and stone chips, its wild light leaves as embers and a "
                         "warm smoke curl, a cracked mark stays"))
    D.append(vfx("lib_objective_taken", 1.6,
                 # max VFX-3: a sun-shard falls in out of the sky (0.18 s), lands and cracks the plaza: then the flash, a thin shaft
                 # and an eroded sleeve of the taker's light, the ring and the crack
                 L("emitter", at="origin", offset=[0, 9.0, 0], count=1, shape="point", dir="down", spreadDeg=0, speed=[48, 48], life=[0.19, 0.19],
                   size=[[0, 2.2], [1, 2.6]], color=[WHITE, "team"], alpha=[1, 1], emissive=10, texture="shard", stretch=0.05, blend="add",
                   align="velocity", aspect=0.4),
                 L("emitter", at="origin", offset=[0, 9.0, 0], count=10, shape="sphere", radius=0.3, dir="down", spreadDeg=4, speed=[40, 46],
                   life=[0.17, 0.2], size=[0.5, 0.1], color=[DAWNGLASS, "team"], alpha=[0.8, 0.2], emissive=6, texture="streak", stretch=0.05, blend="add"),
                 flash(4, at="origin", scale=2.0, delay=0.18),
                 mesh("origin", "column", [[0, 0.3], [0.2, 1.3], [1, 1.2]], 0.85, color=[WHITE, "team"], alpha=[[0, 0.6], [0.4, 0.3], [1, 0]], emissive=4,
                      mask="top", mask_param=0.3, stretch=[1.4, 4.5, 1.4], noise=0.5, scroll=[0, 2.4], dissolve=[0, 0.25, 1], edge="team", edge_emissive=5,
                      rim="team", rim_pow=1.4, rim_emissive=5, delay=0.18),
                 mesh("origin", "shaft", [[0, 0.3], [0.2, 0.8], [1, 0.6]], 0.6, color=[WHITE, "team"], alpha=[[0, 1], [0.5, 0.4], [1, 0]], emissive=6,
                      stretch=[0.6, 6.0, 0.6], noise=0.3, scroll=[0, 3.0], delay=0.18),
                 decal("origin", "crack", [[0, 0.6], [0.1, 3.2], [1, 3.3]], 2.4, color=INK2, alpha=(0.85, 0.7, 0), emissive=3.0, rim="team", delay=0.18),
                 decal("origin", "light", [[0, 1.0], [0.2, 3.6], [1, 3.8]], 1.2, color="team", alpha=(0.7, 0.4, 0), emissive=2.4, texture="rune", delay=0.18),
                 chips("origin", 24, color=(CHALK, CHALK_DK), speed=(4, 9), life=(0.6, 1.0), size=0.24, delay=0.19),
                 dust("origin", 12, size=2.0, speed=(2.5, 5), radius=1.2, life=(0.8, 1.3), delay=0.22),
                 shockwave("origin", radius=(0.5, 6.0), width=(0.8, 0.12), life=0.7, emissive=6, delay=0.18),
                 motes("origin", 30, rise=4.0, radius=1.4, emissive=4, delay=0.18),
                 light("origin", "team", 24, 16, 0.8, delay=0.18),
                 shake(0.6, who="all"),
                 comment="T4 · Lumen · objective taken: white core flash (T4), a tall column and a wide ring in the taker's colour, motes"))
    return D
