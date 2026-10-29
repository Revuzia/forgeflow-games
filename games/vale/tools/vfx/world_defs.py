"""VALE world VFX: the Hour spells' own looks (lib_spell_*), item actives (lib_item_*) and the team buffs' hits
(lib_buff_*): shared presets, so lib_* (CONTRACT §9.5). W4 re-key handoffs, integration run 2 (engine-r2-01 / engine-r2-02);
until these existed the content reused the generic lib_* presets.

House rules as everywhere (tools/vfx/lib_defs.py): Lumen is light in team colour, Shade is ink under a Noonwhite rim;
T1 stays under emissive 2.0, T2 under 3.0; zones loop a 1 s def with a 1.05 s crossfade while the zone lives; a ring
thrown outward is harm or control, motes rising are help. Built into content/vfx.json by tools/vfx/build_vfx.py.
"""
from __future__ import annotations

from vfxkit import (CHALK, CHALK_DK, DAWNGLASS, EMBER, INK, INK2, NOON, SAP, L, chips, decal, flash, light, mesh, shockwave, vfx)

RESIN = "#D9A15A"      # warm resin amber (Resinburn): the burn of sap, never the heal hue
SAP_WARM = "#B8D98A"   # sap-light: SAP warmed toward honey, still inside the help read
HOUR = "#E8D9B4"       # the hour-dial's pale brass-chalk (Hourstring / Stillhour)


def defs() -> list:
    D = []

    # ── Hour spells ────────────────────────────────────────────────────────────────────────────────────────────
    # Glint Step: the caster's shadow stays where they stood (zone glint_shadow, 1.2 m, 2.5 s): a hard-edged ink shadow
    D.append(vfx("lib_spell_glint_shadow", 1.0,
                 decal("ground", "ink", 1.0, 1.05, color=INK, alpha=(0, 0.82, 0.82, 0), emissive=0.0, rim=NOON, fit=True),
                 shockwave("ground", color=NOON, radius=(1.0, 1.0), width=(0.05, 0.05), life=1.05, emissive=1.2, alpha=(0, 0.8, 0.8, 0),
                           sharp=4.0, noise=0.1, fit=True),
                 L("emitter", at="ground", rate=5, shape="disc", radius=0.75, dir="up", spreadDeg=20, speed=[0.05, 0.2], life=[0.7, 1.0],
                   size=[0.3, 0.55, 0.6], color=[INK, INK2], alpha=[0, 0.7, 0.5, 0], gravity=-0.02, drag=2.0, rotDeg=[0, 360],
                   texture="ink_puff", blend="ink", rim=NOON, rimAlpha=0.35, soft=0.25, fit=True),
                 comment="T1 · Shade · Glint Step's shadow (zone loop, 1.2 m): a hard-edged ink shadow where the caster stood, a thin "
                         "crisp Noonwhite edge, a little ink breath lifting off it"))

    # Saplight: a 3 m pool of warm sap-light at the caster's feet for 4 s (zone saplight_pool; it heals: help rises)
    D.append(vfx("lib_spell_saplight_pool", 1.0,
                 decal("ground", "light", 1.0, 1.05, color=SAP_WARM, alpha=(0, 0.42, 0.42, 0), emissive=1.0, rim=SAP, fit=True),
                 shockwave("ground", color=SAP, radius=(0.985, 1.0), width=(0.06, 0.06), life=1.05, emissive=1.8, alpha=(0, 0.9, 0.9, 0),
                           sharp=2.2, noise=0.35, fit=True),
                 L("emitter", at="ground", rate=14, shape="disc", radius=0.95, dir="up", spreadDeg=8, speed=[0.35, 0.7], life=[0.8, 1.2],
                   size=[0, 0.16, 0.1, 0], color=[SAP_WARM, SAP], alpha=[0, 1, 0.8, 0], emissive=1.8, drag=0.6, turbulence=0.3,
                   texture="mote", blend="add", fit=True),
                 L("emitter", at="ground", rate=4, shape="disc", radius=0.7, dir="up", spreadDeg=0, speed=[0.2, 0.3], life=[0.9, 1.1],
                   size=[0, 0.5, 0], color=SAP_WARM, alpha=[0, 0.35, 0], emissive=1.2, texture="glow", blend="add", fit=True, secondary=True),
                 comment="T1 · Lumen · Saplight (zone loop, 3 m): a warm sap-light floor under a soft sap edge, motes and a slow glow "
                         "rising (help rises)"))

    # Glass Pane: the pane sets around the caster and slows enemies within 3 m (area at self, 3 m)
    D.append(vfx("lib_spell_glass_pane_set", 0.7,
                 flash(2, at="origin", color=DAWNGLASS, scale=0.7, light=False),
                 L("shockwave", at="ground", radius=[[0, 0.15], [0.45, 0.95], [1, 1.0]], width=[0.32, 0.07], life=0.5,
                   color=[DAWNGLASS, "team"], alpha=[[0, 1], [0.6, 0.85], [1, 0]], emissive=2.4, sharp=3.0, noise=0.15, fit=True),
                 L("shockwave", at="ground", delay=0.08, radius=[[0, 0.1], [0.5, 0.82], [1, 0.86]], width=[0.18, 0.04], life=0.42,
                   color=DAWNGLASS, alpha=[0.7, 0.5, 0], emissive=1.8, sharp=3.0, fit=True),
                 decal("ground", "frost", [[0, 0.2], [0.35, 0.95], [1, 1.0]], 0.7, color=DAWNGLASS, alpha=(0.55, 0.45, 0), emissive=1.2,
                       rim="team", texture="frost", fit=True),
                 L("emitter", at="ground", count=16, shape="ring", radius=0.9, offset=[0, 0.1, 0], dir="none", speed=[0, 0], life=[0.3, 0.55],
                   size=[0, 0.18, 0], color=[NOON, DAWNGLASS, "team"], alpha=[0, 1, 0], emissive=2.6, texture="glint", blend="add",
                   delay=0.18, fit=True),
                 comment="T2 · Lumen · Glass Pane sets: a dawnglass ring runs out to 3 m and sets there (slows on its edge), a frosted "
                         "floor behind it, glints catch along the set ring"))

    # ── item actives ───────────────────────────────────────────────────────────────────────────────────────────
    # Hourstring 'Strike the Hour': a 3 m dial-tick burst at the target (12 hour-ticks flick out, the ring strikes)
    D.append(vfx("lib_item_strike_the_hour", 0.8,
                 flash(2, at="ground", color=HOUR, scale=1.0),
                 shockwave("ground", color=[HOUR, "team"], radius=(0.2, 1.0), width=(0.3, 0.06), life=0.32, emissive=2.6, sharp=2.5, fit=True),
                 [L("emitter", at="ground", count=12, shape="ring", radius=0.35, dir="out", spreadDeg=0, speed=[7.5, 7.5], life=[0.26, 0.26],
                    size=[0.42, 0.3, 0], color=[HOUR, "team"], alpha=[1, 1, 0], emissive=2.6, drag=2.4, texture="streak", stretch=0.06,
                    blend="add", align="velocity", fit=True)],
                 decal("ground", "light", [[0, 0.6], [0.2, 1.0], [1, 1.0]], 0.8, color=HOUR, alpha=(0.5, 0.35, 0), emissive=1.2, rim="team", fit=True),
                 chips("ground", 8, color=(CHALK, CHALK_DK), speed=(2.5, 5)),
                 comment="T2 · Lumen · Strike the Hour: a pale brass flash, a team ring out to 3 m, twelve dial-ticks flick out evenly "
                         "like the marks of a dial face, an hour-light floor, chips"))

    # Stillhour 'Hold the Hour': a stopped-light stance around the caster for 1.5 s (light held still: motes that do not move)
    D.append(vfx("lib_item_hold_the_hour", 1.5,
                 flash(2, at="origin", color=HOUR, scale=0.6, light=False),
                 L("shockwave", at="caster", follow=True, offset=[0, 0.05, 0], radius=[[0, 0.9], [0.1, 1.15], [1, 1.15]], width=[0.06, 0.06], life=1.5,
                   color=[HOUR, "team"], alpha=[[0, 0], [0.1, 1], [0.85, 1], [1, 0]], emissive=2.2, sharp=3.5),
                 L("emitter", at="caster", count=22, shape="sphere", radius=1.0, offset=[0, 0.9, 0], surface=True, dir="none", speed=[0, 0],
                   life=[1.4, 1.5], size=[[0, 0], [0.08, 0.14], [0.9, 0.14], [1, 0]], color=[NOON, HOUR, "team"], alpha=[[0, 0], [0.08, 1], [0.9, 1], [1, 0]],
                   emissive=2.4, texture="glint", blend="add", follow=True),
                 L("decal", at="caster", shape="circle", style="light", radius=1.2, life=1.5, color=HOUR, alpha=[[0, 0], [0.1, 0.4], [0.85, 0.4], [1, 0]],
                   emissive=1.0, rim="team", follow=True),
                 comment="T2 · Lumen · Hold the Hour: a still ring of hour-light round the caster and glints hung motionless in the air "
                         "around them for 1.5 s (time held), a pale floor"))

    # ── team buffs ─────────────────────────────────────────────────────────────────────────────────────────────
    # Resinburn: the stuck resin ignites on the struck target (magic damage)
    D.append(vfx("lib_buff_resin_ignite", 0.6,
                 flash(1, at="target", color=RESIN, scale=1.0),
                 L("sprite", at="target", texture="flare", size=[[0, 0.5], [0.3, 0.95], [1, 1.0]], color=[RESIN, EMBER], emissive=2.0,
                   alpha=[[0, 1], [0.5, 0.7], [1, 0]], life=0.16, rotDeg=[0, 360], space="world"),
                 L("emitter", at="target", count=10, shape="sphere", radius=0.25, dir="up", spreadDeg=70, speed=[1.5, 3.5], life=[0.3, 0.55],
                   size=[0.14, 0.04], color=[RESIN, EMBER], alpha=[1, 0], emissive=2.0, gravity=-1.0, turbulence=1.0, texture="ember", blend="add"),
                 L("emitter", at="target", count=3, shape="sphere", radius=0.2, dir="up", spreadDeg=30, speed=[0.4, 0.8], life=[0.4, 0.6],
                   size=[0.35, 0.6], color=[INK2, INK], alpha=[0.6, 0], texture="ink_puff", blend="ink", rim=RESIN, rimAlpha=0.5, soft=0.2,
                   rotDeg=[0, 360], secondary=True),
                 light("target", RESIN, 3, 3, 0.2),
                 comment="T1 · impact · Resinburn ignites: the stuck resin flares warm amber on the target, embers spit up, a curl of "
                         "dark smoke"))

    # ── world moments (engine-r2-05) ────────────────────────────────────────────────────────────────────────────
    # the Noon Toll (FRAY rules.noonToll): every fighter still standing is in the light for the reveal (5 s, follows them;
    # the director fits the clock to the mode's reveal): a thin pale noon column over them, a pale floor glow at their
    # feet, a few motes of light falling. A presence, not a heal (no rising motes) and not a shield (no shell)
    D.append(vfx("lib_world_noon_toll", 5.0,
                 # every layer rides the fighter ('caster' = the lit fighter, its body centre: the column starts under the
                 # ground and stands ~2.5 m over it; the floor glow tracks x / z)
                 mesh("caster", "pillar", 1.0, 5.0, color=[NOON, "#F4EFE2"], alpha=[[0, 0], [0.04, 0.09], [0.9, 0.07], [1, 0]], emissive=0.9,
                      rim=NOON, rim_pow=3.5, rim_emissive=1.8, noise=0.3, scroll=[0, -0.6], stretch=[1.15, 3.9, 1.15], offset=[0, -1.4, 0],
                      follow=True),
                 L("decal", at="caster", shape="circle", style="light", radius=0.85, life=5.0, color=NOON, alpha=[[0, 0], [0.04, 0.3], [0.92, 0.25], [1, 0]],
                   emissive=0.9, rim=NOON, follow=True),
                 L("emitter", at="caster", rate=6, shape="disc", radius=0.45, offset=[0, 1.4, 0], dir="down", spreadDeg=6, speed=[0.7, 1.1],
                   life=[1.8, 2.4], size=[0, 0.09, 0.07, 0], color=[NOON, "#F4EFE2"], alpha=[0, 1, 0.8, 0], emissive=1.8, drag=0.2,
                   texture="mote", blend="add", follow=True),
                 comment="T2 · Lumen · the Noon Toll: a thin pale noon column over each fighter still standing for the reveal, a pale "
                         "floor glow at their feet, motes of light falling (they are seen by all; a presence, not a heal or a shield)"))
    # the Noon Toll's bell over the plate: a chime ring runs out across the Noonplate, a second behind it, a pale centre
    D.append(vfx("lib_world_noon_chime", 1.6,
                 L("shockwave", at="ground", radius=[[0, 1.5], [0.35, 15.0], [1, 24.0]], width=[0.5, 0.15], life=1.4, color=[NOON, "#F4EFE2"],
                   alpha=[0.9, 0.6, 0], emissive=1.8, sharp=2.0, noise=0.2),
                 L("shockwave", at="ground", radius=[[0, 1.0], [0.35, 11.0], [1, 18.0]], width=[0.35, 0.1], life=1.3, color=NOON,
                   alpha=[0.7, 0.45, 0], emissive=1.4, sharp=2.0, noise=0.2, delay=0.25),
                 decal("ground", "light", [[0, 1.5], [0.2, 3.0], [1, 3.2]], 1.2, color=NOON, alpha=(0.5, 0.3, 0), emissive=1.2),
                 comment="T2 · Lumen · the Noon Toll's bell over the plate: a pale chime ring runs out across the Noonplate, a second "
                         "behind it, a soft pale centre"))
    # the Dawn Seal ending (RIFT rules.dawnSeal.until, 7:00; engine-r2-03): each standing sealed Needle sheds its dawnglass
    # seal: a cool glass flash, the shell's shards fall away round it, a glass ring settles on the ground
    D.append(vfx("lib_world_seal_break", 1.2,
                 flash(2, at="origin", color=DAWNGLASS, scale=1.2),
                 L("emitter", at="origin", count=26, shape="sphere", radius=1.1, offset=[0, 1.2, 0], surface=True, dir="out", spreadDeg=40,
                   speed=[1.5, 3.5], life=[0.6, 1.0], size=[0.26, 0.2, 0.0], sizeVar=[0.6, 1.4], color=[DAWNGLASS, "team"], alpha=[1, 1, 0],
                   emissive=2.4, gravity=9.0, drag=0.6, texture="shard", blend="add", align="velocity", aspect=0.45),
                 L("emitter", at="origin", count=14, shape="sphere", radius=1.3, offset=[0, 1.6, 0], dir="none", speed=[0, 0.3],
                   life=[0.5, 0.9], size=[0, 0.12, 0.08, 0], color=[NOON, DAWNGLASS], alpha=[0, 1, 0.7, 0], emissive=2.6, gravity=1.5,
                   texture="glint", blend="add"),
                 L("shockwave", at="ground", radius=[[0, 1.2], [0.35, 2.6], [1, 3.2]], width=[0.3, 0.06], life=0.6, color=[DAWNGLASS, "team"],
                   alpha=[0.9, 0.6, 0], emissive=2.2, sharp=2.2, noise=0.3),
                 comment="T2 · Lumen · the Dawn Seal ends: a sealed Needle sheds its dawnglass seal, a cool glass flash, the shell's "
                         "shards falling away round it and glints hanging a moment, a glass ring settling on the ground"))
    # each Gorge Wind step (WorldView.gorgeWind rising, sudden death; engine-r2-04): a gust across the map, drawn round the
    # viewer's camera focus (a 70 x 44 m field, the line starting 35 m upwind): long pale wind streaks low over the ground
    # (weather, not an ability: no ring, no flash)
    D.append(vfx("lib_world_gorge_gust", 1.8,
                 L("emitter", at="origin", count=170, shape="line", length=70.0, width=44.0, offset=[-35, 1.4, 0], dir="forward", spreadDeg=4,
                   speed=[18, 26], life=[0.9, 1.4], size=[2.0, 1.5, 0], color=[CHALK, NOON], alpha=[0, 0.45, 0], emissive=0.9,
                   texture="streak", stretch=0.1, blend="add", align="velocity", fit=False),
                 comment="T2 · world · a Gorge Wind step: a gust runs across the whole map, long pale wind streaks low over the "
                         "ground (weather, not an ability)"))
    return D
