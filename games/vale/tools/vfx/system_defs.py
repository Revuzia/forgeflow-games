"""VALE system VFX (lib_status_* · lib_windup* · lib_cast_flare): the looks the director plays for states
and moments that carry no ability of their own. Mapped in content/client.json (`vfxStatus`, `vfxEvents`).
Built into content/vfx.json by tools/vfx/build_vfx.py (lane L2a: the VFX system).

Statuses (r12 M2): one SUSTAINED instance per (unit, status kind), held for the status' whole duration
(src/render/director.ts). Every held element uses the same envelope: in over 80 ms, held at life × 0.75,
out over 250 ms when the status ends; `phase: release` layers mark the end. Anchors: `target` = the unit;
sockets `top` (over the head), `base` (the feet, airborne height included), `ground` (under the unit at
y 0), `chest`. Colours: "team" = the VICTIM's relationship colour (an enemy stunned reads HARM, you read
Noonwhite); "element" on a taunt = the TAUNTER's relationship colour. Tiers (the director): hard control
T3, movement / protection T2, light debuffs T1 (no decals, emissive <= 2). Every look carries an INK element with a
team rim besides its light, so it reads on pale stone for every viewer (your own Noonwhite included).

Each look is VALE's own, read by silhouette before colour (96-132 px fighters):
  stun          the stopped hour: a hollow dial at the head (ink + team rings), sun-motes riding it like hour marks
  root          pinned to the hour-line: ink bands coil the feet, three ink stakes driven in a pace around them
  slow          dawnglass mire: a glass shackle on a dark band at the shins, a dark mire with frost, flakes sinking
  silence       the muffled bell: a dark ink bell set over the head, a thin team lip, ink breath leaking
  disarm        the broken edge: the two halves of a snapped blade circle the hands in a cracked ring, chips falling
  airborne      the left-behind shadow: an ink shadow and team ring on the ground, wind streaking up
  taunt         the drawn line: a taut tether to the taunter (taunter's colour), a ring at the feet
  fear          shade wisps: jittering ink wisps around the head over a shivering ink crown
  sleep         dusk motes: a slow breathing glow at the head, motes drifting up lazily, an ink veil
  haste         low side streaks (the movement grammar) thrown back from the feet
  invisible     (seen by allies only) a dawnglass shimmer column with rim light
  untargetable  under glass: a dawnglass bell-jar over the unit, dithered, rim-lit
  unstoppable   a chalk-bright rim shell, chalk flakes shed
  reveal        a thin team sun-shaft on the unit, a narrowing ring every 1.4 s
  grievous      the sap runs black: ink drops dripping from the chest, a dark band
  armor_shred   a cracked chalk plate band around the chest, chips flaking off
  resist_shred  the same band in orchid glass (the magic colour), glass flakes

Wind-ups (r12 M3): `lib_windup` is the generic anticipation for any timed cast without its own
(Present.windupVfx); its clock is fitted so `duration` (1.0) = the cast time: the socket glow ramps
0.8 -> the T2 cap over the wind-up (`fitTime`), motes converge, a 0.8 m ring at the feet at 40 %, a glint
along the aim near the end, and the RELEASE burst (2-4 frames) on the sim's release frame (`phase:
release`; a cancelled cast never plays it). `lib_windup_ult` is the T4 charge at 1.5x. `lib_cast_flare`
marks casts under 0.12 s.
"""
from __future__ import annotations

from vfxkit import CHALK, CHALK_DK, DAWNGLASS, DUST, DUST2, INK, INK2, NOON, ORCHID, ROSE, WHITE, L, vfx

HOLD = 0.75


def ha(peak: float = 1.0) -> list:
    """the sustained envelope: in 80 ms, held at life x HOLD, out over the rest (250 ms at life 1)"""
    return [[0, 0], [0.08, peak], [HOLD, peak], [1, 0]]


def held(type_: str, **kw) -> dict:
    """a held layer on the unit (life 1.0, hold 0.75, tracks the unit)"""
    kw.setdefault("at", "target")
    kw.setdefault("life", 1.0)
    kw.setdefault("hold", HOLD)
    kw.setdefault("follow", True)
    return L(type_, **kw)


def defs() -> list:
    D = []
    # ── hard control (T3) ────────────────────────────────────────────────────────────────────────
    D.append(vfx("lib_status_stun", 1.0,
                 # the stopped hour, read by silhouette from the top-down camera: a HOLLOW dial round the head (ink ring,
                 # team ring inside it, the head showing through) with five sun-motes riding it like the hour marks of a
                 # stopped clock; at head height, below the bar, so the bar never covers it
                 held("mesh", socket="head", offset=[0, 0.12, 0], shape="ringwave", scale=[[0, 0.3], [0.1, 1.12], [1, 1.12]], color=INK, alpha=ha(0.95),
                      emissive=0, rim="team", rimEmissive=2.0, rimPow=1.4, blend="ink", spinDeg=-90, align="up"),
                 held("mesh", socket="head", offset=[0, 0.14, 0], shape="ringwave", scale=[[0, 0.25], [0.1, 0.98], [1, 0.98]], color="team",
                      alpha=ha(1.0), emissive=3.4, blend="add", spinDeg=160, align="up", noise=0.2, mask="band", maskParam=0.3),
                 L("emitter", at="target", socket="head", offset=[0, 0.16, 0], rate=8, shape="ring", radius=0.47, dir="none", speed=[0, 0],
                   life=[0.6, 0.66], size=[0, 0.3, 0.3, 0], color=[NOON, "team"], alpha=[0, 1, 1, 0], emissive=4.2, orbitDeg=240, texture="mote",
                   blend="add", space="local"),
                 L("emitter", at="target", socket="head", offset=[0, 0.15, 0], rate=8, shape="ring", radius=0.47, dir="none", speed=[0, 0],
                   life=[0.6, 0.66], size=[0, 0.4, 0.4, 0], color=[INK, INK2], alpha=[0, 0.9, 0.9, 0], orbitDeg=240, texture="mote",
                   blend="ink", rim="team", rimAlpha=0.8, space="local"),
                 held("decal", shape="ring", style="light", radius=0.85, color="team", alpha=ha(0.6), emissive=1.6),
                 L("shockwave", at="target", socket="head", offset=[0, 0.14, 0], mode="vertical", radius=[[0, 0.15], [1, 0.85]], width=[0.14, 0.03],
                   life=0.22, color="team", alpha=[1, 0], emissive=4.0, blend="add"),
                 L("emitter", at="target", socket="head", offset=[0, 0.14, 0], count=8, shape="ring", radius=0.3, dir="out", spreadDeg=20,
                   speed=[2.5, 4], life=[0.12, 0.22], size=[0.14, 0.03], color="team", alpha=[1, 0], emissive=4.0, texture="spark", stretch=0.04,
                   blend="add"),
                 L("shockwave", phase="release", at="target", socket="head", offset=[0, 0.14, 0], mode="vertical", radius=[[0, 0.7], [1, 0.1]],
                   width=[0.06, 0.1], life=0.16, color="team", alpha=[0.9, 0], emissive=3.0, blend="add"),
                 comment="T3 · Lumen · stunned — the stopped hour: a hollow dial at the head (an ink ring with a team rim, a team ring "
                         "inside it, the head showing through), five sun-motes on ink riding it like a stopped clock's hour marks, a ring at the "
                         "feet; below the bar, distinct from silence's dark bell by silhouette; it snaps shut at the end"))
    D.append(vfx("lib_status_root", 1.0,
                 held("mesh", socket="base", shape="spiral", scale=[[0, 0.3], [0.1, 1.05], [1, 1.05]], stretch=[1, 0.7, 1], color=INK, alpha=ha(1.0),
                      emissive=0, rim="team", rimEmissive=3.2, rimPow=1.5, blend="ink", twist=-2.5),
                 *[held("mesh", socket="base", offset=[f, -0.04, r], shape="spike", scale=[[0, 0.0], [0.06, 0.82], [1, 0.82]], stretch=[1.4, 1.0, 1.4],
                        color=[INK2, INK], alpha=ha(1.0), emissive=0, rim="team", rimEmissive=3.0, rimPow=1.6, blend="ink")
                   for (f, r) in ((0.62, 0.0), (-0.31, 0.54), (-0.31, -0.54))],
                 held("decal", shape="circle", style="ink", radius=1.0, color=INK, alpha=ha(0.85), rim="team"),
                 L("emitter", at="target", socket="ground", count=9, shape="ring", radius=0.55, dir="up", spreadDeg=50, speed=[1.5, 3], life=[0.25, 0.4],
                   size=[0.12, 0.12, 0.07], color=[CHALK, CHALK_DK], alpha=[1, 1, 0], gravity=12, bounce=0.3, texture="chip", blend="chip",
                   spinDeg=[-400, 400], rim="team", rimAlpha=0.5),
                 L("emitter", phase="release", at="target", socket="ground", count=10, shape="ring", radius=0.6, dir="up", spreadDeg=60, speed=[1.5, 3.2],
                   life=[0.25, 0.42], size=[0.12, 0.11, 0.06], color=[INK2, CHALK_DK], alpha=[1, 1, 0], gravity=12, bounce=0.3, texture="chip",
                   blend="chip", spinDeg=[-500, 500], rim="team", rimAlpha=0.5),
                 comment="T3 · Shade · rooted — pinned to the hour-line: ink bands coil the feet under a team rim, three ink stakes with team edges "
                         "driven in a pace around them, a 1 m ink pool; the stakes break into chips when it ends"))
    D.append(vfx("lib_status_silence", 1.0,
                 # the muffled bell, read by silhouette: a DARK ink bell set down over the head (a filled dark dome from
                 # the top-down camera, where stun is a bright hollow dial), a thin team lip at its rim, ink breath
                 # leaking from under it
                 held("mesh", socket="head", offset=[0, -0.12, 0], shape="dome", scale=[[0, 0.3], [0.1, 0.78], [1, 0.78]], stretch=[1, 1.35, 1],
                      color=INK, alpha=ha(0.97), emissive=0, rim="team", rimEmissive=2.2, rimPow=2.2, noise=0.3, blend="ink"),
                 held("mesh", socket="head", offset=[0, -0.12, 0], shape="ringwave", scale=[[0, 0.3], [0.1, 0.86], [1, 0.86]], color="team",
                      alpha=ha(1.0), emissive=3.0, blend="add", align="up", mask="band", maskParam=0.35),
                 L("emitter", at="target", socket="head", offset=[0, -0.15, 0], rate=10, shape="ring", radius=0.36, dir="down", spreadDeg=40,
                   speed=[0.1, 0.35], life=[0.45, 0.65], size=[0.14, 0.36, 0.44], sizeVar=[0.8, 1.2], color=[INK, INK2], alpha=[0, 0.85, 0],
                   drag=2.4, turbulence=0.6, rotDeg=[0, 360], spinDeg=[-40, 40], texture="ink_puff", blend="ink", rim=NOON, rimAlpha=0.5, soft=0.2),
                 L("shockwave", phase="release", at="target", socket="head", offset=[0, 0.05, 0], mode="vertical", radius=[[0, 0.2], [1, 0.95]],
                   width=[0.1, 0.02], life=0.24, color=DAWNGLASS, alpha=[0.9, 0], emissive=2.4, blend="add"),
                 comment="T3 · Shade · silenced — the muffled bell: a dark ink bell set over the head with a team rim and a thin team lip, "
                         "ink breath leaking from under it (a dark filled dome from above, never stun's bright hollow dial); a pale ring rings "
                         "out when the voice returns"))
    D.append(vfx("lib_status_disarm", 1.0,
                 # the broken edge: the two halves of a snapped blade (ink with team-lit breaks) turn over the head
                 *[held("mesh", socket="chest", offset=[0, 0.1, 0], shape="blade", scale=[[0, 0.4], [0.1, 1.35], [1, 1.35]], color=INK, alpha=ha(1.0),
                        emissive=0, rim="team", rimEmissive=3.0, rimPow=1.2, edge="team", edgeEmissive=3.0, edgeWidth=0.1, dissolve=0.18, noise=0.9,
                        noiseScale=2.2, blend="ink", spinDeg=110, align="flat", rotateDeg=[0, rot, 0])
                   for rot in (0, 180)],
                 held("mesh", socket="chest", offset=[0, 0.08, 0], shape="ringwave", scale=[[0, 0.4], [0.1, 1.15], [1, 1.15]], color="team", alpha=ha(0.8),
                      emissive=2.6, blend="add", align="up", noise=0.6, dissolve=0.3, spinDeg=-60),
                 L("emitter", at="target", socket="chest", rate=6, shape="ring", radius=0.6, dir="down", spreadDeg=30, speed=[0.2, 0.6],
                   life=[0.3, 0.45], size=[0.1, 0.1, 0.06], color=[INK2, CHALK_DK], alpha=[1, 1, 0], gravity=9, texture="chip", blend="chip",
                   spinDeg=[-400, 400], rim="team", rimAlpha=0.5),
                 L("emitter", at="target", socket="chest", count=10, shape="sphere", radius=0.2, dir="out", spreadDeg=160, speed=[2, 4], life=[0.25, 0.4],
                   size=[0.12, 0.11, 0.06], color=[CHALK, CHALK_DK], alpha=[1, 1, 0], gravity=12, bounce=0.3, texture="chip", blend="chip",
                   spinDeg=[-500, 500], rim="team", rimAlpha=0.5),
                 comment="T3 · Shade/chip · disarmed — the broken edge: the two halves of a snapped blade (ink, team-lit breaks) circle the "
                         "body at the hands inside a cracked team ring, chips fall; it starts with the weapon knocked to pieces"))
    D.append(vfx("lib_status_airborne", 1.0,
                 held("decal", shape="circle", style="ink", radius=0.8, color=INK, alpha=ha(0.85), rim="team"),
                 held("decal", shape="ring", style="light", radius=1.05, color="team", alpha=ha(0.7), emissive=2.0),
                 L("emitter", at="target", socket="base", rate=26, shape="disc", radius=0.45, dir="up", spreadDeg=6, speed=[2.6, 4.2], life=[0.16, 0.26],
                   size=[0.4, 0.07], color=[NOON, "team"], alpha=[0.9, 0], emissive=3.0, texture="streak", stretch=0.07, blend="add"),
                 L("emitter", at="target", socket="base", rate=10, shape="disc", radius=0.4, dir="up", spreadDeg=8, speed=[2.2, 3.4], life=[0.18, 0.28],
                   size=[0.34, 0.08], color=[INK, INK2], alpha=[0.85, 0], texture="streak", stretch=0.06, blend="ink", rim="team", rimAlpha=0.6),
                 L("emitter", at="target", socket="ground", count=8, shape="ring", radius=0.6, dir="out", spreadDeg=30, speed=[0.8, 1.8], life=[0.45, 0.7],
                   size=[0.45, 0.9, 1.1], color=[DUST, DUST2], alpha=[0, 0.5, 0.3, 0], gravity=-0.2, drag=2.8, rotDeg=[0, 360], spinDeg=[-30, 30],
                   texture="dust_puff", blend="alpha", soft=0.3),
                 L("emitter", phase="release", at="target", socket="ground", count=9, shape="ring", radius=0.6, dir="out", spreadDeg=30, speed=[1, 2.2],
                   life=[0.45, 0.7], size=[0.45, 0.95, 1.15], color=[DUST, DUST2], alpha=[0, 0.55, 0.3, 0], gravity=-0.2, drag=2.8, rotDeg=[0, 360],
                   spinDeg=[-30, 30], texture="dust_puff", blend="alpha", soft=0.3),
                 comment="T3 · airborne — the left-behind shadow: an ink shadow and a team ring stay on the ground under the unit, light and ink "
                         "streaks rush up past it; dust at the launch and at the landing"))
    D.append(vfx("lib_status_taunt", 1.0,
                 held("beam", **{"from": "target"}, to="caster", socket="chest", width=0.1, color=["element", "element"], alpha=ha(1.0), emissive=3.4,
                      noise=0.05, freq=1.0, scroll=-3.0, core=1.8, taper=[0.45, 1.0]),
                 held("decal", shape="ring", style="light", radius=0.74, color="element", alpha=ha(0.7), emissive=2.0),
                 L("sprite", at="target", socket="top", offset=[0, 0.2, 0], texture="flare", size=[0.55, 0.62], color="element", emissive=3.4,
                   alpha=[0, 1, 0], life=0.6, repeat=0.6, hold=0),
                 comment="T3 · taunted — the drawn line: a taut tether from the unit to its taunter in the TAUNTER's relationship colour, "
                         "a ring at the feet, a slow glare over the head (1.7 Hz)"))
    D.append(vfx("lib_status_fear", 1.0,
                 L("emitter", at="target", socket="top", offset=[0, -0.1, 0], rate=20, shape="sphere", radius=0.55, dir="random", speed=[0.3, 0.8],
                   life=[0.35, 0.55], size=[0.2, 0.52, 0.36], color=[INK, INK2], alpha=[0, 0.95, 0], turbulence=5, turbulenceScale=3, rotDeg=[0, 360],
                   spinDeg=[-90, 90], texture="wisp", blend="ink", rim="team", rimAlpha=0.7, soft=0.2, space="local"),
                 held("mesh", socket="top", offset=[0, 0.14, 0], shape="ringwave", scale=[[0, 0.3], [0.1, 0.8], [1, 0.8]], color=INK, alpha=ha(0.95),
                      emissive=0, rim="team", rimEmissive=3.0, rimPow=1.2, wobble=0.07, noise=0.8, blend="ink", align="up", spinDeg=-90),
                 held("decal", shape="circle", style="ink", radius=0.85, color=INK, alpha=ha(0.65), rim="team"),
                 comment="T3 · Shade · feared — shade wisps: ink wisps with team rims jitter round the head over a shivering ink crown, an ink pool"))
    D.append(vfx("lib_status_sleep", 1.0,
                 held("mesh", socket="top", offset=[0, -0.12, 0], shape="orb", scale=[[0, 0.2], [0.1, 0.42], [1, 0.42]], stretch=[1, 0.8, 1], color=INK,
                      alpha=ha(0.55), emissive=0, rim=DAWNGLASS, rimEmissive=1.8, rimPow=2.0, noise=0.5, blend="ink"),
                 L("sprite", at="target", socket="top", offset=[0, 0.32, 0], texture="glow", size=[0.5, 0.75], color="team", emissive=2.4,
                   alpha=[0, 0.9, 0], life=1.8, repeat=1.8, hold=0, soft=0.2),
                 L("emitter", at="target", socket="top", offset=[0, 0.25, 0], rate=4, shape="disc", radius=0.16, dir="up", spreadDeg=20, speed=[0.22, 0.38],
                   life=[1.1, 1.4], size=[0, 0.16, 0.22, 0], color=[DAWNGLASS, NOON], alpha=[0, 0.9, 0.6, 0], emissive=2.0, gravity=-0.03, drag=0.3,
                   turbulence=0.6, texture="mote", blend="add"),
                 held("decal", shape="ring", style="light", radius=0.62, color="team", alpha=ha(0.35), emissive=0.8),
                 comment="T3 · asleep — dusk motes: a dim ink veil over the eyes with a glass rim, a slow breathing glow (0.55 Hz), motes "
                         "drifting up lazily, a dim ring"))
    # ── movement and protection (T2) ─────────────────────────────────────────────────────────────
    D.append(vfx("lib_status_slow", 1.0,
                 held("decal", shape="circle", style="ink", radius=0.9, color=INK2, alpha=ha(0.6), rim="team"),
                 held("decal", shape="circle", style="frost", radius=0.8, color=DAWNGLASS, alpha=ha(0.5), emissive=0.8),
                 held("mesh", socket="base", offset=[0, 0.3, 0], shape="ringwave", scale=[[0, 0.35], [0.1, 0.82], [1, 0.82]], color=[DAWNGLASS, "team"],
                      alpha=ha(0.95), emissive=2.4, noise=0.5, blend="add", align="up", spinDeg=24),
                 held("mesh", socket="base", offset=[0, 0.28, 0], shape="ringwave", scale=[[0, 0.35], [0.1, 0.95], [1, 0.95]], color=INK, alpha=ha(0.7),
                      emissive=0, rim="team", rimEmissive=1.6, blend="ink", align="up", spinDeg=-24),
                 L("emitter", at="target", socket="base", offset=[0, 0.4, 0], rate=12, shape="ring", radius=0.36, dir="down", spreadDeg=20, speed=[0.2, 0.5],
                   life=[0.4, 0.6], size=[0.14, 0.04], color=[DAWNGLASS, "team"], alpha=[0, 0.9, 0], emissive=2.0, texture="shard", blend="add"),
                 comment="T2 · Lumen · slowed — dawnglass mire: a glass shackle on a dark band at the shins, a dark mire with frost underfoot "
                         "(team rim), glass flakes sink (left behind as the unit drags on)"))
    D.append(vfx("lib_status_invisible", 1.0,
                 held("mesh", socket="base", shape="column", scale=0.9, stretch=[0.8, 2.0, 0.8], color=DAWNGLASS, alpha=ha(0.22), emissive=0.6,
                      rim=DAWNGLASS, rimEmissive=2.4, rimPow=2.4, noise=0.7, scroll=[0.2, 0.8], blend="add"),
                 L("emitter", at="target", socket="base", rate=6, shape="aura", radius=0.4, height=1.8, dir="up", speed=[0.1, 0.3], life=[0.3, 0.5],
                   size=[0, 0.12, 0], color=DAWNGLASS, alpha=[0, 1, 0], emissive=2.4, texture="glint", blend="add", space="local"),
                 comment="T2 · Lumen · unseen (allies only see it) — a dawnglass shimmer column with rim light, glints"))
    D.append(vfx("lib_status_untargetable", 1.0,
                 held("mesh", socket="base", shape="dome", scale=[[0, 0.7], [0.1, 1.2], [1, 1.2]], stretch=[1, 3.2, 1], color=DAWNGLASS, alpha=ha(0.32),
                      emissive=0.8, rim=NOON, rimEmissive=2.6, rimPow=2.2, noise=0.6, noiseScale=3.0, dissolve=0.2, edge=DAWNGLASS, edgeEmissive=2.0,
                      edgeWidth=0.06, blend="add"),
                 held("decal", shape="ring", style="light", radius=0.66, color=NOON, alpha=ha(0.5), emissive=1.2),
                 comment="T2 · Lumen · untargetable — under glass: a dithered dawnglass bell-jar stands over the unit, rim-lit, a pale ring"))
    D.append(vfx("lib_status_unstoppable", 1.0,
                 held("mesh", socket="chest", offset=[0, -0.1, 0], shape="orb", scale=1.05, stretch=[0.95, 1.9, 0.95], color=NOON, alpha=ha(0.12),
                      emissive=0.6, rim="team", rimEmissive=3.0, rimPow=2.4, noise=0.3, blend="add"),
                 held("decal", shape="ring", style="ink", radius=0.85, color=INK, alpha=ha(0.75), rim="team"),
                 L("emitter", at="target", socket="base", rate=8, shape="disc", radius=0.35, dir="up", spreadDeg=60, speed=[1, 2], life=[0.3, 0.45],
                   size=[0.1, 0.1, 0.06], color=[INK2, CHALK_DK], alpha=[1, 1, 0], gravity=9, texture="chip", blend="chip", spinDeg=[-400, 400],
                   rim="team", rimAlpha=0.5),
                 comment="T2 · unstoppable — a bright team-rimmed shell round the body over a dark ring at the feet, flakes shed off it"))
    D.append(vfx("lib_status_reveal", 1.0,
                 held("mesh", socket="base", shape="pillar", scale=[[0, 0.1], [0.12, 0.5], [1, 0.5]], stretch=[0.6, 6.0, 0.6], color="team", alpha=ha(0.4),
                      emissive=1.8, noise=0.4, scroll=[0, 1.2], mask="top", maskParam=0.35, blend="add"),
                 L("shockwave", at="target", radius=[[0, 0.9], [1, 0.32]], width=[0.07, 0.04], life=0.6, color="team", alpha=[0, 0.9, 0], emissive=2.0,
                   sharp=1.6, blend="add", repeat=1.4),
                 comment="T2 · Lumen · revealed — a thin team sun-shaft stands on the unit, a ring narrows onto it every 1.4 s"))
    # ── light debuffs (T1: no decals, emissive <= 2) ────────────────────────────────────────────
    D.append(vfx("lib_status_haste", 1.0,
                 L("emitter", at="target", socket="base", offset=[0, 0.14, 0], rate=16, shape="disc", radius=0.35, dir="back", spreadDeg=12, speed=[2.5, 4],
                   life=[0.16, 0.26], size=[0.44, 0.08], color="team", alpha=[0.85, 0], emissive=2.0, drag=2, texture="streak", stretch=0.07, blend="add"),
                 L("emitter", at="target", socket="base", offset=[0, 0.1, 0], rate=10, shape="disc", radius=0.35, dir="back", spreadDeg=12, speed=[2.2, 3.4],
                   life=[0.16, 0.26], size=[0.4, 0.1], color=[INK, INK2], alpha=[0.8, 0], drag=2, texture="streak", stretch=0.06, blend="ink", rim="team",
                   rimAlpha=0.6),
                 L("emitter", at="target", socket="base", offset=[0, 0.55, 0], rate=6, shape="disc", radius=0.3, dir="back", spreadDeg=10, speed=[2, 3],
                   life=[0.12, 0.2], size=[0.3, 0.06], color=[NOON, "team"], alpha=[0.6, 0], emissive=2.0, drag=2, texture="streak", stretch=0.06,
                   blend="add"),
                 comment="T1 · hasted — low side streaks (the movement grammar), light over ink so they read on pale stone, thrown back from the "
                         "feet against the travel"))
    D.append(vfx("lib_status_grievous", 1.0,
                 L("emitter", at="target", socket="chest", rate=9, shape="sphere", radius=0.36, surface=True, dir="down", spreadDeg=30, speed=[0.2, 0.6],
                   life=[0.32, 0.42], size=[0.13, 0.09], color=[INK, INK2], alpha=[1, 1, 0], gravity=7, texture="drop", blend="ink", rim="team", rimAlpha=0.5),
                 # outside the body (r 0.43-0.68 m) so the top-down camera sees it round the shoulders
                 held("mesh", socket="chest", offset=[0, -0.15, 0], shape="ringwave", scale=1.35, color=INK, alpha=ha(0.95), emissive=0, rim="team",
                      rimEmissive=1.6, noise=0.7, dissolve=0.15, blend="ink", align="up", spinDeg=30),
                 comment="T1 · Shade · grievous wounds — the sap runs black: ink drops drip from the chest, a dark band with a team rim"))
    D.append(vfx("lib_status_armor_shred", 1.0,
                 # the band stands OUTSIDE the body (r 0.5-0.78 m) so the top-down camera sees it round the shoulders
                 held("mesh", socket="chest", offset=[0, -0.05, 0], shape="ringwave", scale=1.55, color=[INK2, INK], alpha=ha(1.0), emissive=0,
                      dissolve=0.32, noise=0.9, noiseScale=2.4, edge="team", edgeEmissive=2.0, edgeWidth=0.12, rim=CHALK, rimEmissive=1.2, blend="ink",
                      align="up", spinDeg=20),
                 L("emitter", at="target", socket="chest", rate=5, shape="ring", radius=0.44, dir="down", spreadDeg=40, speed=[0.3, 0.8], life=[0.28, 0.38],
                   size=[0.11, 0.11, 0.06], color=[INK2, CHALK_DK], alpha=[1, 1, 0], gravity=10, texture="chip", blend="chip", spinDeg=[-400, 400],
                   rim="team", rimAlpha=0.5),
                 comment="T1 · chip · armour shred — a cracked dark plate band round the chest (team-lit cracks), plate chips flaking off"))
    D.append(vfx("lib_status_resist_shred", 1.0,
                 held("mesh", socket="chest", offset=[0, -0.05, 0], shape="ringwave", scale=0.98, color=INK, alpha=ha(0.9), emissive=0, rim=ORCHID,
                      rimEmissive=1.6, blend="ink", align="up", spinDeg=-20),
                 held("mesh", socket="chest", offset=[0, -0.03, 0], shape="ringwave", scale=0.9, color=[ORCHID, ROSE], alpha=ha(0.95), emissive=2.0,
                      dissolve=0.32, noise=0.9, noiseScale=2.4, edge="team", edgeEmissive=2.0, edgeWidth=0.1, blend="add", align="up", spinDeg=-20),
                 L("emitter", at="target", socket="chest", rate=5, shape="ring", radius=0.44, dir="down", spreadDeg=40, speed=[0.3, 0.8], life=[0.28, 0.38],
                   size=[0.12, 0.04], color=[ORCHID, ROSE], alpha=[1, 0], emissive=2.0, gravity=6, texture="shard", blend="add"),
                 comment="T1 · Lumen · resist shred — the cracked band in orchid glass (the magic colour) over a dark band, glass flakes falling"))
    # ── anticipation (r12 M3) ─────────────────────────────────────────────────────────────────────
    def windup(id_: str, k: float, cap: float, ring: float, comment: str, core: str | None = None) -> dict:
        rel = [
            L("sprite", phase="release", at="caster", socket="weapon", texture="flare", size=[0.9 * k, 0.5 * k], color="element", emissive=cap,
              alpha=[1, 0], life=0.1, space="world"),
            L("emitter", phase="release", at="caster", socket="weapon", count=int(8 * k), dir="forward", spreadDeg=50, speed=[4 * k, 7 * k],
              life=[0.08, 0.16], size=[0.16, 0.04], color="element", alpha=[1, 0], emissive=cap, texture="spark", stretch=0.04, blend="add"),
            L("shockwave", phase="release", at="caster", radius=[[0, 0.3 * k], [1, 1.1 * k]], width=[0.16, 0.04], life=0.18, color="team",
              alpha=[0.8, 0], emissive=min(cap, 3.0), blend="add"),
        ]
        if core:
            rel.append(L("flash", phase="release", at="caster", socket="weapon", radius=0.5 * k, life=0.08, color="element", intensity=cap, core=core))
        return vfx(id_, 1.0,
                   L("sprite", at="caster", socket="weapon", texture="glow", size=[[0, 0.25 * k], [1, 0.62 * k]], color="element",
                     emissive=[[0, 0.8], [1, cap]], alpha=[[0, 0.3], [0.9, 1], [1, 1]], life=1.0, fitTime=True, hold=1.0, soft=0.2),
                   L("emitter", at="caster", socket="weapon", rate=int(36 * k), duration=0.92, shape="sphere", radius=0.75 * k, surface=True, dir="in",
                     speed=[1.4 * k, 2.2 * k], radial=-2, life=[0.22, 0.32], size=[0.09, 0.03], color=["element", "team"], alpha=[0, 1, 0.4],
                     emissive=min(cap, 3.0), texture="mote", blend="add", space="local", secondary=True),
                   L("decal", at="caster", follow=True, shape="ring", style="light", radius=ring, life=1.0, fitTime=True, hold=1.0, color="team",
                     alpha=[[0, 0], [0.25, 0.4], [1, 0.4]], emissive=1.0),
                   L("emitter", at="caster", socket="weapon", delay=0.86, count=2, dir="forward", spreadDeg=4, speed=[7, 9], life=[0.08, 0.1],
                     size=[0.3 * k, 0.08], color=[NOON, "element"], alpha=[1, 0], emissive=min(cap, 3.0), texture="glint", stretch=0.05, blend="add"),
                   *rel, comment=comment)
    D.append(windup("lib_windup", 1.0, 3.0, 0.8,
                    "T2 · anticipation (generic, fitted to the cast time) — the fighter's light gathers at the weapon socket (0.8 -> 3.0 over the "
                    "wind-up), motes converge on it, a 0.8 m team ring at the feet at 40 %, a glint along the aim near the end; on the release "
                    "frame a 0.1 s flare, sparks forward and a small ring (a cancelled cast just fades)"))
    D.append(windup("lib_windup_ult", 1.5, 6.0, 1.3,
                    "T4 · ultimate charge (generic, fitted to the cast time) — the T2 anticipation at 1.5x, the glow climbing to 6, a white-core "
                    "flash on the release frame", core=WHITE))
    D.append(vfx("lib_cast_flare", 0.14,
                 L("sprite", at="caster", socket="weapon", texture="flare", size=[0.5, 0.75], color="element", emissive=3.0, alpha=[[0, 0.6], [0.35, 1], [1, 0]],
                   life=0.12, hold=0),
                 L("emitter", at="caster", socket="weapon", count=5, shape="sphere", radius=0.35, surface=True, dir="in", speed=[2, 3], life=[0.08, 0.12],
                   size=[0.1, 0.03], color="element", alpha=[1, 0], emissive=2.6, texture="glint", blend="add"),
                 comment="T2 · instant cast flare — a 120 ms socket flare and a few glints drawn in (casts under 0.12 s)"))
    return D
