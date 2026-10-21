"""VALE per-kit anticipation and basic attacks (r12 M3, M5, M12): generated from the fighter records.

For every fighter, from content/fighters/<id>.json (kit timings, targeting, attack kind):

  <f>_<slot>_windup     every timed cast (castTime >= 0.12 s): Present.windupVfx. The clock is fitted so 1.0 def
                        second = the wind-up (the director fits it to the sim's release tick); sustained while the
                        cast winds up, cancelled with it; `phase: release` layers fire on the release frame.
                        Skeleton (the bible's T2 anticipation, ultimates at 1.5x and the T4 charge cap):
                          - a signature charge at the casting socket, visible from the first frame (alpha 0.6),
                            emissive 0.8 -> the tier cap (T2 3, ult 6) over the wind-up
                          - the fighter's MOTIF (below): what the kit gathers before it lets go
                          - a 0.8 m signature ring at the feet (the caster's own read, self included), a closing
                            team edge outside it (the relationship read for everyone else)
                          - a 0.1 s glint along the aim for point / direction / unit casts
                          - the release: 2-4 frames (66-133 ms) of flare + burst in the family's material
                          - ultimates add a lensing bulge at the socket (distort, T4)
  <f>_atk_swing         melee: attack.present.windupVfx, fitted to the attack wind-up (1.0 = the impact frame):
                        the SLASH, a synthesized arc ribbon (RibbonL.arc) swept round the fighter in its facing
                        frame over the blow: from 78 % of the wind-up to ~35 ms past the impact (≈ 130 ms at base
                        attack speed), accelerating into the hit, sub-frame points every 4° so it is a clean
                        crescent at any frame rate, fading over 140 ms after. The
                        arc's reach, height and tilt are the kit's own swing (Burdam's falling cleave, Kemdo's
                        rising cut, Ervet's flat backhand …); a bone-tracked trail is not used (it traced the
                        wind-back and the recovery, and half the roster has no blade-tip bone). A small tip glint
                        and the kit's material (dust, embers, glass, ink) sit at the weapon. A crit doubles its
                        width at T2 (the director spawns it with scale 2).
  <f>_atk_draw          ranged: attack.present.windupVfx: the socket gathers and a tip glint at 70 %.
  <f>_atk_shot          ranged: attack.present.vfx, the fighter's own projectile: a release flash at the weapon,
                        a core in the family's material, a >= 0.9 m signature trail, shed sparks.

Motifs are VALE's own (the thing each fighter works with): Ardit's tilted pane, Burdam's tally marks,
Dunsom's dusk crook, Ervet's blade edge, Hesmi's rising shard, Ilsheta's lamp, Kemdo's focusing lens,
Lisvel's drawn line, Marund's courses, Nurrow's lullaby motes, Odrum's resin glob, Rishal's glass lines,
Sukri's cup of noon light, Tunlan's shadow hands, Ulkro's run-up streaks, Vashil's bell rings.
Colours: "signature" / "secondary" (the caster's FighterDef.vfx), "team" only on the danger edges.
"""
from __future__ import annotations

import json
from pathlib import Path

from vfxkit import CHALK, CHALK_DK, DUST, DUST2, INK, INK2, NOON, WHITE, L, vfx

GAME = Path(__file__).resolve().parent.parent.parent
FIGHTERS = GAME / "content" / "fighters"

WINDUP_MIN = 0.12
SIG, SEC = "signature", "secondary"

# family: lumen (additive light, glass) · shade (ink with a light rim) · stone (opaque chips + light)
# sock: where the kit gathers · tip: the weapon point a swing trail rides · motif · swing / shot style
KIT: dict[str, dict] = {
    "ardit":   dict(fam="lumen", sock="weapon", tip="weapon_tip", motif="pane", swing="glass", arc=(1.3, 70, -80, 14, 1.05, 0.46)),
    "burdam":  dict(fam="stone", sock="weapon", tip="weapon_tip", motif="tally", swing="heavy", arc=(1.5, 85, -65, 24, 1.15, 0.62)),
    "dunsom":  dict(fam="shade", sock="weapon", motif="crook", shot="ink"),
    "ervet":   dict(fam="lumen", sock="weapon", tip="blade_tip", motif="blade", swing="glass", arc=(1.45, -80, 78, 8, 1.0, 0.5)),
    "hesmi":   dict(fam="shade", sock="weapon", tip="weapon_tip", motif="shard", swing="heavy", arc=(1.35, 80, -70, 20, 1.1, 0.58)),
    "ilsheta": dict(fam="lumen", sock="weapon", motif="lamp", shot="lamp"),
    "kemdo":   dict(fam="lumen", sock="lens", tip="weapon_tip", motif="lens", swing="heat", arc=(1.35, -72, 80, -20, 1.05, 0.5)),
    "lisvel":  dict(fam="lumen", sock="weapon", motif="draw", shot="arrow"),
    "marund":  dict(fam="stone", sock="weapon", tip="weapon_tip", motif="course", swing="heavy", arc=(1.6, 62, -58, 14, 0.85, 0.6)),
    "nurrow":  dict(fam="shade", sock="weapon", tip="weapon_tip", motif="lull", swing="ink", arc=(1.25, -75, 72, 14, 1.05, 0.5)),
    "odrum":   dict(fam="stone", sock="weapon_tip", motif="resin", shot="pellet"),
    "rishal":  dict(fam="lumen", sock="weapon", tip="weapon_tip", motif="glint", swing="glass", arc=(1.3, 76, -76, -12, 1.0, 0.44)),
    "sukri":   dict(fam="lumen", sock="weapon", motif="cup", shot="mote"),
    "tunlan":  dict(fam="shade", sock="hand_r", motif="puppet", shot="moth"),
    "ulkro":   dict(fam="lumen", sock="weapon", motif="dart", shot="dart"),
    "vashil":  dict(fam="lumen", sock="weapon", motif="bell", shot="note"),
}


# ── the fighter records ──────────────────────────────────────────────────────────────────────────
def records() -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(FIGHTERS.glob("*.json"))]


def timed_casts(rec: dict) -> list[tuple[str, dict, str]]:
    """(windup id, ability record, slot) for every cast of the kit (forms and recasts too) with castTime >= 0.12"""
    out = []
    kits = [("", rec["kit"])]
    for form, fm in (rec["kit"]["passive"].get("forms") or {}).items():
        if fm.get("kit"):
            kits.append((form, fm["kit"]))
    for form, kit in kits:
        for slot in ("a1", "a2", "a3", "ult"):
            a = kit.get(slot)
            if not a:
                continue
            for ab, tag in [(a, "")] + ([(a["recast"]["ability"], "recast")] if a.get("recast") else []):
                if (ab.get("castTime") or 0) >= WINDUP_MIN:
                    parts = [rec["id"], slot] + ([form] if form else []) + ([tag] if tag else []) + ["windup"]
                    out.append(("_".join(parts), ab, slot))
    return out


def is_melee(rec: dict) -> bool:
    return not rec["attack"].get("projectileSpeed")


# ── motifs: what the kit gathers (k = size, cap = the tier's emissive cap) ─────────────────────────
def motif(name: str, S: str, k: float, cap: float) -> list:
    e2 = min(cap, 3.0)
    if name == "pane":      # a pane of dawnglass tilts up at the weapon, glints sliding in across it
        return [L("mesh", at="caster", socket=S, follow=True, shape="disc", scale=[[0, 0.2 * k], [0.6, 0.62 * k], [1, 0.7 * k]], life=1.0, fitTime=True,
                  hold=1.0, color=[SEC, SIG], alpha=[[0, 0.45], [0.8, 0.75], [1, 0.75]], emissive=[[0, 1.0], [1, e2]], rim=SIG, rimPow=1.4,
                  rimEmissive=e2, noise=0.25, rotateDeg=[62, 0, 0], blend="add"),
                L("emitter", at="caster", socket=S, rate=int(26 * k), duration=0.9, shape="disc", radius=0.7 * k, dir="in", speed=[1.6 * k, 2.4 * k],
                  life=[0.22, 0.3], size=[0.2 * k, 0.05], color=[NOON, SIG], alpha=[0, 1, 0], emissive=e2, texture="glint", blend="add",
                  space="local")]
    if name == "tally":     # the tally: three red notches flick on round the weapon, grit lifts off the ground
        return [L("emitter", at="caster", socket=S, bursts=[[0.15, 1], [0.45, 1], [0.75, 1]], shape="ring", radius=0.42 * k, dir="none",
                  speed=[0, 0], life=[0.5, 0.6], size=[0.42 * k, 0.4 * k], color=[SIG, SEC], alpha=[[0, 1], [0.7, 1], [1, 0]], emissive=e2,
                  rotDeg=[75, 105], texture="streak", blend="add", space="local", fitTime=True, hold=0.6),
                L("emitter", at="caster", socket="base", rate=int(22 * k), duration=0.9, shape="disc", radius=0.7 * k, dir="up", spreadDeg=20,
                  speed=[0.8, 1.6], life=[0.3, 0.45], size=[0.09, 0.09, 0.05], sizeVar=[0.6, 1.3], color=[CHALK, CHALK_DK], alpha=[1, 1, 0],
                  gravity=2, texture="chip", blend="chip", spinDeg=[-300, 300], rim=SIG, rimAlpha=0.5, secondary=True)]
    if name == "crook":     # the dusk crook: an ink spiral winds up the hand under a signature rim, ink drawn in
        return [L("mesh", at="caster", socket=S, follow=True, shape="spiral", scale=[[0, 0.25 * k], [1, 0.62 * k]], stretch=[1, 1.3, 1], life=1.0,
                  fitTime=True, hold=1.0, color=INK, alpha=[[0, 0.6], [0.3, 0.95], [1, 0.95]], emissive=0, rim=SIG, rimEmissive=e2, rimPow=1.2,
                  blend="ink", spinDeg=-260, offset=[0, -0.25 * k, 0]),
                L("emitter", at="caster", socket=S, rate=int(20 * k), duration=0.9, shape="sphere", radius=0.75 * k, surface=True, dir="in",
                  speed=[1.0 * k, 1.6 * k], life=[0.3, 0.4], size=[0.16 * k, 0.32 * k, 0.1], color=[INK, INK2], alpha=[0, 0.9, 0], texture="wisp",
                  blend="ink", rim=SIG, rimAlpha=0.7, soft=0.2, space="local")]
    if name == "blade":     # the blade's edge: a crescent of glass light runs along it, shards drawn in
        return [L("mesh", at="caster", socket=S, follow=True, shape="crescent", scale=[[0, 0.3 * k], [1, 0.75 * k]], life=1.0, fitTime=True, hold=1.0,
                  color=[SIG, SEC], alpha=[[0, 0.5], [1, 1]], emissive=[[0, 1.2], [1, e2]], mask="sweep", maskParam=[[0, 0.2], [1, 1.05]],
                  align="camera", rotateDeg=[0, 0, 30], blend="add"),
                L("emitter", at="caster", socket=S, rate=int(24 * k), duration=0.9, shape="sphere", radius=0.8 * k, surface=True, dir="in",
                  speed=[1.8 * k, 2.6 * k], life=[0.2, 0.3], size=[0.24 * k, 0.18 * k, 0], color=[SIG, NOON], alpha=[0, 1, 0], emissive=e2,
                  texture="shard", align="velocity", aspect=0.45, blend="add", space="local")]
    if name == "shard":     # the fallen needle: a shard rises in her hand, its shadow pools at her feet
        return [L("mesh", at="caster", socket=S, follow=True, shape="spike", scale=[[0, 0.15 * k], [1, 0.7 * k]], stretch=[1.4, 1.0, 1.4], life=1.0,
                  fitTime=True, hold=1.0, color=[INK2, INK], alpha=[[0, 0.7], [1, 1]], emissive=0, rim=SIG, rimEmissive=e2, rimPow=1.6, blend="ink",
                  offset=[0, -0.2 * k, 0]),
                L("decal", at="caster", follow=True, shape="circle", style="ink", radius=[[0, 0.4 * k], [1, 0.95 * k]], life=1.0, fitTime=True,
                  hold=1.0, color=INK, alpha=[[0, 0.35], [1, 0.7]], rim=SIG),
                L("emitter", at="caster", socket="base", rate=int(14 * k), duration=0.9, shape="ring", radius=0.9 * k, dir="in", speed=[1.0, 1.8],
                  life=[0.35, 0.5], size=[0.3 * k, 0.6 * k, 0.2], color=[INK, INK2], alpha=[0, 0.85, 0], texture="ink_puff", blend="ink", rim=SIG,
                  rimAlpha=0.6, soft=0.3, secondary=True)]
    if name == "lamp":      # the healing lamp: a lamp-glow swells over the hand, warm motes rise off it (help is up)
        return [L("sprite", at="caster", socket=S, offset=[0, 0.22 * k, 0], texture="flare", size=[[0, 0.3 * k], [1, 0.7 * k]], color=[SIG, SEC],
                  emissive=[[0, 1.2], [1, e2]], alpha=[[0, 0.7], [1, 1]], life=1.0, fitTime=True, hold=1.0, soft=0.15),
                L("emitter", at="caster", socket=S, rate=int(26 * k), duration=0.95, shape="sphere", radius=0.25 * k, dir="up", spreadDeg=30,
                  speed=[0.6, 1.3], life=[0.4, 0.6], size=[0, 0.14 * k, 0], color=[SIG, NOON], alpha=[0, 1, 0], emissive=e2, gravity=-0.6,
                  turbulence=0.8, texture="mote", blend="add")]
    if name == "lens":      # the burning glass: a ring of light focuses down on the lens, embers drawn into the hot spot
        return [L("shockwave", at="caster", socket=S, mode="vertical", radius=[[0, 0.95 * k], [1, 0.12 * k]], width=[0.07, 0.16], life=1.0,
                  fitTime=True, color=[SIG, SEC], alpha=[[0, 0.6], [0.8, 1], [1, 1]], emissive=e2, sharp=2.0, blend="add"),
                L("emitter", at="caster", socket=S, rate=int(30 * k), duration=0.92, shape="sphere", radius=0.7 * k, surface=True, dir="in",
                  speed=[1.6 * k, 2.4 * k], life=[0.2, 0.3], size=[0.1, 0.03], color=[SIG, "#FFD9A8"], alpha=[0, 1, 0.3], emissive=e2,
                  texture="ember", stretch=0.03, blend="add", space="local")]
    if name == "draw":      # the morning line: light runs out along the aim from the bow, motes gather on the string
        return [L("emitter", at="caster", socket=S, rate=int(30 * k), duration=0.9, shape="line", length=2.4 * k, width=0.12, dir="none", speed=[0, 0],
                  life=[0.18, 0.26], size=[0.22 * k, 0.06], color=[SIG, NOON], alpha=[0, 0.9, 0], emissive=e2, texture="glint", blend="add"),
                L("emitter", at="caster", socket=S, rate=int(22 * k), duration=0.9, shape="sphere", radius=0.6 * k, surface=True, dir="in",
                  speed=[1.4 * k, 2.0 * k], life=[0.22, 0.3], size=[0.1, 0.03], color=[SIG, SEC], alpha=[0, 1, 0.4], emissive=e2, texture="mote",
                  blend="add", space="local")]
    if name == "course":    # the mason's courses: two rings of jade light laid one over the other up his body, mortar grit
        return [L("mesh", at="caster", socket="base", follow=True, shape="ringwave", offset=[0, 0.25, 0], scale=[[0, 0.6 * k], [0.4, 1.25 * k], [1, 1.25 * k]],
                  life=1.0, fitTime=True, hold=1.0, color=[SIG, SEC], alpha=[[0, 0.55], [0.4, 0.9], [1, 0.9]], emissive=[[0, 1.0], [1, e2]],
                  align="up", blend="add", spinDeg=40),
                L("mesh", at="caster", socket="base", follow=True, shape="ringwave", offset=[0, 1.0, 0], delay=0.4, scale=[[0, 0.5 * k], [0.4, 1.05 * k], [1, 1.05 * k]],
                  life=0.6, fitTime=True, hold=1.0, color=[SIG, SEC], alpha=[[0, 0], [0.3, 0.85], [1, 0.85]], emissive=[[0, 1.0], [1, e2]],
                  align="up", blend="add", spinDeg=-40),
                L("emitter", at="caster", socket="base", rate=int(18 * k), duration=0.9, shape="ring", radius=0.6 * k, dir="up", spreadDeg=15,
                  speed=[0.6, 1.4], life=[0.3, 0.5], size=[0.08, 0.08, 0.05], sizeVar=[0.6, 1.3], color=[CHALK, CHALK_DK], alpha=[1, 1, 0], gravity=2,
                  texture="chip", blend="chip", spinDeg=[-300, 300], rim=SIG, rimAlpha=0.5, secondary=True)]
    if name == "lull":      # the lullaby: slow motes circle the hand in a widening spiral under a soft ink veil
        return [L("emitter", at="caster", socket=S, rate=int(24 * k), duration=0.95, shape="ring", radius=0.5 * k, dir="up", spreadDeg=10,
                  speed=[0.15, 0.35], life=[0.5, 0.7], size=[0, 0.15 * k, 0], color=[SIG, SEC], alpha=[0, 1, 0], emissive=e2, orbitDeg=220,
                  texture="mote", blend="add", space="local"),
                L("sprite", at="caster", socket=S, texture="ink_puff", size=[[0, 0.4 * k], [1, 0.8 * k]], color=INK, emissive=0,
                  alpha=[[0, 0.3], [1, 0.6]], life=1.0, fitTime=True, hold=1.0, blend="ink", rim=SIG, rimAlpha=0.6, soft=0.3)]
    if name == "resin":     # the resin glob: a bead of gold resin swells at the pouch, drops fall from it
        return [L("mesh", at="caster", socket=S, follow=True, shape="orb", scale=[[0, 0.12 * k], [1, 0.38 * k]], life=1.0, fitTime=True, hold=1.0,
                  color=[SIG, SEC], alpha=1, emissive=[[0, 0.6], [1, min(cap, 2.0)]], rim=SEC, rimEmissive=e2, rimPow=1.6, noise=0.4, wobble=0.06,
                  blend="chip"),
                L("emitter", at="caster", socket=S, rate=int(10 * k), duration=0.9, shape="point", dir="down", spreadDeg=20, speed=[0.2, 0.5],
                  life=[0.35, 0.5], size=[0.08 * k, 0.06], color=[SIG, SEC], alpha=[1, 1, 0], gravity=9, texture="drop", blend="chip", rim=NOON,
                  rimAlpha=0.4)]
    if name == "glint":     # glass lines: hard glints slide in straight to the blade (lines, not motes)
        return [L("emitter", at="caster", socket=S, rate=int(34 * k), duration=0.9, shape="ring", radius=1.3 * k, dir="in", spreadDeg=4,
                  speed=[5 * k, 7 * k], life=[0.14, 0.2], size=[0.42 * k, 0.04], color=[SIG, NOON], alpha=[0, 1, 0.2], emissive=e2, texture="streak",
                  stretch=0.06, blend="add", space="local")]
    if name == "cup":       # the cup of noon light: a small sun fills in the cup, light drawn into it
        return [L("mesh", at="caster", socket=S, follow=True, shape="orb", scale=[[0, 0.12 * k], [1, 0.36 * k]], life=1.0, fitTime=True, hold=1.0,
                  color=[SIG, NOON], alpha=[[0, 0.7], [1, 0.95]], emissive=[[0, 1.2], [1, e2]], rim=SEC, rimEmissive=e2, rimPow=1.6, noise=0.3,
                  blend="add"),
                L("emitter", at="caster", socket=S, rate=int(26 * k), duration=0.92, shape="sphere", radius=0.7 * k, surface=True, dir="in",
                  speed=[1.4 * k, 2.2 * k], life=[0.22, 0.32], size=[0.12, 0.04], color=[SIG, SEC], alpha=[0, 1, 0.4], emissive=e2, texture="mote",
                  blend="add", space="local")]
    if name == "puppet":    # shadow hands: ink wisps knot into a shape at her fingers, her lamp flickers
        return [L("emitter", at="caster", socket=S, rate=int(26 * k), duration=0.95, shape="sphere", radius=0.35 * k, dir="random", speed=[0.2, 0.6],
                  life=[0.35, 0.5], size=[0.2 * k, 0.45 * k, 0.25], color=[INK, INK2], alpha=[0, 0.95, 0], turbulence=4, turbulenceScale=3,
                  texture="wisp", blend="ink", rim=SIG, rimAlpha=0.75, soft=0.2, space="local"),
                L("sprite", at="caster", socket="head", offset=[0.3, -0.15, 0], texture="flare", size=[0.4 * k, 0.5 * k], color=[SIG, SEC],
                  emissive=[[0, 1.0], [0.5, e2], [1, 1.4]], alpha=[[0, 0.8], [1, 1]], life=0.5, repeat=0.5, hold=0, soft=0.15)]
    if name == "dart":      # the run-up: side streaks thrown back from the feet, glints at the throwing hand
        return [L("emitter", at="caster", socket="base", offset=[0, 0.2, 0], rate=int(24 * k), duration=0.9, shape="disc", radius=0.3, dir="back",
                  spreadDeg=12, speed=[2.5, 4], life=[0.14, 0.22], size=[0.36 * k, 0.06], color=[SIG, SEC], alpha=[0.85, 0], emissive=e2, drag=2,
                  texture="streak", stretch=0.06, blend="add"),
                L("emitter", at="caster", socket=S, rate=int(18 * k), duration=0.9, shape="sphere", radius=0.4 * k, surface=True, dir="in",
                  speed=[1.2, 1.8], life=[0.2, 0.28], size=[0.18 * k, 0.04], color=[NOON, SIG], alpha=[0, 1, 0], emissive=e2, texture="glint",
                  blend="add", space="local")]
    if name == "bell":      # the bell: rings of struck glass pulse out of it, faster as the note builds
        return [L("shockwave", at="caster", socket=S, mode="vertical", radius=[[0, 0.15 * k], [1, 0.75 * k]], width=[0.08, 0.02], life=0.3,
                  color=[SIG, SEC], alpha=[0.9, 0], emissive=e2, blend="add", repeat=0.32),
                L("emitter", at="caster", socket=S, rate=int(20 * k), duration=0.92, shape="sphere", radius=0.6 * k, surface=True, dir="in",
                  speed=[1.2 * k, 1.8 * k], life=[0.22, 0.3], size=[0.1, 0.03], color=[SIG, NOON], alpha=[0, 1, 0.4], emissive=e2, texture="mote",
                  blend="add", space="local")]
    raise SystemExit(f"unknown motif {name}")


def release(fam: str, S: str, k: float, cap: float, ult: bool) -> list:
    """the release frame: 2-4 frames (66-133 ms) of flare + a burst in the family's material"""
    e2 = min(cap, 3.0)
    out = [L("sprite", phase="release", at="caster", socket=S, texture="flare", size=[1.0 * k, 0.6 * k], color=[SIG, SEC], emissive=cap,
             alpha=[1, 0], life=0.1, space="world", hold=0),
           L("shockwave", phase="release", at="caster", radius=[[0, 0.3 * k], [1, 1.1 * k]], width=[0.16, 0.04], life=0.16, color="team",
             alpha=[0.8, 0], emissive=e2, blend="add")]
    if fam == "shade":
        out.append(L("emitter", phase="release", at="caster", socket=S, count=int(6 * k), shape="sphere", radius=0.15, dir="out", spreadDeg=120,
                     speed=[2.5 * k, 4.5 * k], life=[0.18, 0.3], size=[0.3 * k, 0.5 * k, 0.2], color=[INK, INK2], alpha=[0.95, 0.8, 0],
                     drag=3, texture="ink_puff", blend="ink", rim=SIG, rimAlpha=0.7, soft=0.25))
    elif fam == "stone":
        out.append(L("emitter", phase="release", at="caster", socket=S, count=int(8 * k), dir="forward", spreadDeg=70, speed=[3 * k, 6 * k],
                     life=[0.25, 0.4], size=[0.12, 0.12, 0.06], sizeVar=[0.6, 1.3], color=[CHALK, CHALK_DK], alpha=[1, 1, 0], gravity=12, bounce=0.3,
                     texture="chip", blend="chip", spinDeg=[-500, 500], rim=SIG, rimAlpha=0.5))
    out.append(L("emitter", phase="release", at="caster", socket=S, count=int(8 * k), dir="forward", spreadDeg=50, speed=[4 * k, 7 * k],
                 life=[0.08, 0.16], size=[0.18, 0.04], color=[SIG, NOON], alpha=[1, 0], emissive=cap, texture="spark", stretch=0.04, blend="add"))
    if ult:
        out.append(L("flash", phase="release", at="caster", socket=S, radius=0.75, life=0.08, color=SIG, intensity=cap, core=WHITE))
    return out


def windup(id_: str, rec: dict, ab: dict, slot: str) -> dict:
    kit = KIT[rec["id"]]
    ult = slot == "ult"
    k, cap = (1.5, 6.0) if ult else (1.0, 3.0)
    S = kit["sock"]
    tk = ab["targeting"]["kind"]
    aim = tk in ("point", "direction", "unit")
    layers = [
        # the charge: at the socket, visible from frame 1, the light climbing to the tier cap over the wind-up
        L("sprite", at="caster", socket=S, texture="glow", size=[[0, 0.5 * k], [1, 0.95 * k]], color=[SIG, SEC], emissive=[[0, 0.8], [1, cap]],
          alpha=[[0, 0.6], [0.9, 1], [1, 1]], life=1.0, fitTime=True, hold=1.0, soft=0.2),
        # the caster's own read at the feet (signature; reads on self against pale stone), the team edge closing outside it
        L("decal", at="caster", follow=True, shape="ring", style="light", radius=0.8 * k, life=1.0, fitTime=True, hold=1.0, color=SIG,
          alpha=[[0, 0.35], [0.3, 0.5], [1, 0.65]], emissive=1.4),
        L("shockwave", at="caster", radius=[[0, 1.55 * k], [1, 0.9 * k]], width=[0.05, 0.08], life=1.0, fitTime=True, color="team",
          alpha=[[0, 0], [0.25, 0.5], [1, 0.75]], emissive=1.6, sharp=2.0, blend="add"),
        *motif(kit["motif"], S, k, cap),
        *release(kit["fam"], S, k, cap, ult),
    ]
    if aim:
        layers.append(L("emitter", at="caster", socket=S, delay=0.86, count=2, dir="forward", spreadDeg=4, speed=[7, 9], life=[0.08, 0.1],
                        size=[0.32 * k, 0.08], color=[NOON, SIG], alpha=[1, 0], emissive=min(cap, 3.0), texture="glint", stretch=0.05, blend="add"))
    if ult:
        # stored light bends the air round the socket as the ultimate charges (T4 lensing; off on Low)
        layers.append(L("distort", at="caster", socket=S, follow=True, mode="bulge", size=[[0, 0.6], [1, 1.6]], strength=[[0, 0.003], [1, 0.011]],
                        life=1.0, fitTime=True))
    who = rec["name"]
    return vfx(id_, 1.0, *layers, comment=f"{'T4' if ult else 'T2'} · {kit['fam']} · {who} {slot} wind-up ({ab['id']}, {ab['castTime']} s, fitted): the "
               f"{kit['motif']} motif gathers at {S} in {who}'s signature, a signature ring at the feet with a closing team edge"
               f"{', an aim glint' if aim else ''}; the release flares for 0.1 s")


# ── basic attacks ────────────────────────────────────────────────────────────────────────────────
def pale(hx: str, k: float) -> str:
    """the signature lifted k of the way to white, kept below the near-white line (no channel past 0.86 linear on all
    three at once), so a hot edge keeps the fighter's hue instead of turning dawnglass below T4"""
    rgb = [int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    out = [c + (1 - c) * k for c in rgb]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in out]
    if min(lin) > 0.86:
        j = lin.index(min(lin))
        out[j] = 0.9
    return "#%02X%02X%02X" % tuple(round(c * 255) for c in out)


def swing(rec: dict) -> dict:
    kit = KIT[rec["id"]]
    style = kit.get("swing", "glass")
    tip = kit.get("tip", "weapon_tip")
    blend = "ink" if style == "ink" else "add"
    R, a0, a1, tilt, h, w = kit["arc"]
    hot = pale(rec["vfx"]["signature"], 0.6)
    arc = dict(at="caster", delay=0.78, span=0.3, arcDeg=[a0, a1], arcTiltDeg=tilt, arcHeight=h, arcEase=1.5, fit=True)
    layers = [
        # the slash: the head sweeps the kit's arc over the blow (78 % of the wind-up -> ~35 ms past the impact),
        # accelerating into the hit; it lets go and fades over ~150 ms. Three bands on one arc, so it reads on pale
        # stone for every viewer: an ink body under a signature rim (the value read), the signature light over it
        # (the identity read), and a hot leading edge in the signature's own pale tint.
        L("ribbon", **arc, arcRadius=R, width=[[0, 0.0], [0.5, w * 0.8], [0.9, w * 1.15], [1, w * 0.7]], life=0.16, color=[INK2, INK],
          alpha=[[0, 0.0], [0.35, 0.5], [0.9, 0.85], [1, 0.9]], emissive=0, noise=0.25, scroll=4.0, blend="ink", rim=SIG, rimAlpha=1.0),
        L("ribbon", **arc, arcRadius=R + w * 0.05, width=[[0, 0.0], [0.55, w * 0.5], [0.9, w * 0.78], [1, w * 0.45]], life=0.14,
          color=[SIG, SEC], alpha=[[0, 0.0], [0.4, 0.6], [0.9, 1.0], [1, 1.0]], emissive=3.0 if blend == "add" else 2.0, noise=0.18,
          scroll=4.0, blend="add"),
        L("ribbon", **arc, arcRadius=R + w * 0.22, width=[[0, 0.0], [0.7, w * 0.16], [1, w * 0.24]], life=0.09, color=[hot, SIG],
          alpha=[[0, 0.0], [0.6, 0.7], [1, 1.0]], emissive=3.0, noise=0.0, blend="add"),
        # the impact glint at the weapon on the blow
        L("sprite", at="caster", socket=tip, delay=0.97, texture="glint", size=[0.7, 0.2], color=[NOON, SIG], emissive=3.0, alpha=[1, 0], life=0.07,
          space="world", hold=0),
    ]
    if style == "heavy":
        layers.append(L("emitter", at="caster", socket="base", delay=0.95, count=5, shape="disc", radius=0.4, dir="out", spreadDeg=30, speed=[1, 2.2],
                        life=[0.35, 0.55], size=[0.4, 0.7, 0.85], color=[DUST, DUST2], alpha=[0, 0.4, 0.2, 0], gravity=-0.2, drag=2.8,
                        rotDeg=[0, 360], texture="dust_puff", blend="alpha", soft=0.3, secondary=True))
    elif style == "heat":
        layers.append(L("emitter", at="caster", socket=tip, delay=0.6, rate=40, duration=0.45, dir="up", spreadDeg=60, speed=[0.4, 1.2],
                        life=[0.2, 0.35], size=[0.08, 0.03], color=[SIG, "#FFD9A8"], alpha=[1, 0], emissive=3.0, texture="ember", blend="add",
                        secondary=True))
    elif style == "glass":
        layers.append(L("emitter", at="caster", socket=tip, delay=0.8, rate=50, duration=0.25, dir="none", speed=[0, 0], life=[0.12, 0.2],
                        size=[0.16, 0.0], color=[NOON, SIG], alpha=[1, 0], emissive=3.0, texture="glint", blend="add", secondary=True))
    elif style == "ink":
        layers.append(L("emitter", at="caster", socket=tip, delay=0.8, rate=30, duration=0.3, dir="none", speed=[0, 0], life=[0.25, 0.4],
                        size=[0.18, 0.32, 0.1], color=[INK, INK2], alpha=[0.9, 0.6, 0], texture="ink_puff", blend="ink", rim=SIG, rimAlpha=0.7,
                        soft=0.25, secondary=True))
    return vfx(f"{rec['id']}_atk_swing", 1.0, *layers,
               comment=f"T1 · {kit['fam']} · {rec['name']} basic swing (fitted, 1.0 = the impact): the slash, a {R} m arc swept "
                       f"{a0}° -> {a1}° (tilt {tilt}°) round the fighter over the blow: an ink body under a signature rim, the "
                       f"signature light, a hot leading edge; it fades ~150 ms after; a glint at the {tip} on the impact; twice as "
                       f"wide on a crit")


def draw(rec: dict) -> dict:
    kit = KIT[rec["id"]]
    S = kit["sock"]
    return vfx(f"{rec['id']}_atk_draw", 1.0,
               L("sprite", at="caster", socket=S, texture="glow", size=[[0, 0.28], [1, 0.55]], color=[SIG, SEC], emissive=[[0, 0.8], [1, 2.0]],
                 alpha=[[0, 0.5], [1, 1]], life=1.0, fitTime=True, hold=1.0, soft=0.2),
               L("emitter", at="caster", socket=S, rate=18, duration=0.8, shape="sphere", radius=0.4, surface=True, dir="in", speed=[1.2, 1.8],
                 life=[0.15, 0.22], size=[0.1, 0.03], color=[SIG, NOON], alpha=[0, 1, 0.3], emissive=2.0, texture="mote", blend="add", space="local"),
               L("emitter", at="caster", socket=S, delay=0.7, count=2, dir="forward", spreadDeg=6, speed=[3, 5], life=[0.06, 0.09], size=[0.34, 0.07],
                 color=[NOON, SIG], alpha=[1, 0], emissive=2.0, texture="glint", stretch=0.04, blend="add"),
               comment=f"T1 · {rec['name']} basic draw (fitted): the shot gathers at the {S}, a tip glint at 70 % of the wind-up")


def shot(rec: dict) -> dict:
    kit = KIT[rec["id"]]
    style = kit["shot"]
    S = kit["sock"]
    muzzle = [L("sprite", at="origin", socket=S, texture="flare", size=[0.62, 0.5], color=[SIG, NOON], emissive=2.0, alpha=[1, 0], life=0.05,
                space="world", hold=0),
              L("emitter", at="origin", socket=S, count=4, dir="forward", spreadDeg=40, speed=[3, 5], life=[0.06, 0.12], size=[0.12, 0.03],
                color=[SIG, NOON], alpha=[1, 0], emissive=2.0, texture="spark", stretch=0.03, blend="add")]
    trail = [L("ribbon", at="path", width=[0.0, 0.18], life=0.12, color=[SIG, SEC], alpha=[0, 0.7], emissive=2.0, noise=0.3, blend="add")]
    sheds = [L("emitter", at="path", rate=34, shape="point", dir="back", spreadDeg=40, speed=[0.4, 1.4], life=[0.12, 0.24], size=[0.09, 0.02],
               color=[SIG, SEC], alpha=[0.9, 0], emissive=2.0, drag=2, texture="glint", blend="add", secondary=True)]
    if style == "ink":       # Dunsom: a dusk dart of ink under an indigo rim, an ink wake that sinks
        core = [L("mesh", at="path", shape="shard", scale=0.5, life=0.6, hold=1, color=INK, alpha=1, emissive=0, rim=SIG, rimPow=1.2, rimEmissive=2.0,
                  blend="ink", align="velocity", stretch=[0.75, 0.75, 1.8])]
        trail = [L("ribbon", at="path", width=[0.0, 0.2], life=0.14, color=[SIG, SEC], alpha=[0, 0.6], emissive=2.0, noise=0.3, blend="add"),
                 L("ribbon", at="path", width=[0.0, 0.3], life=0.22, color=INK2, alpha=[0, 0.75], emissive=0, blend="ink", rim=SIG, rimAlpha=0.6)]
        sheds = [L("emitter", at="path", rate=22, shape="point", dir="back", spreadDeg=35, speed=[0.1, 0.4], life=[0.2, 0.32], size=[0.12, 0.26, 0.3],
                   color=[INK, INK2], alpha=[0, 0.85, 0], gravity=0.6, texture="ink_puff", blend="ink", rim=SIG, rimAlpha=0.6, soft=0.3, secondary=True)]
    elif style == "lamp":    # Ilsheta: a lamp-flame mote, its glow, warm sparks shed
        core = [L("mesh", at="path", shape="orb", scale=0.3, life=0.6, hold=1, color=[NOON, SIG], alpha=0.95, emissive=2.0, rim=SIG, rimPow=1.5,
                  rimEmissive=2.0, noise=0.4),
                L("sprite", at="path", texture="flare", size=[0.7, 0.8], color=SIG, emissive=2.0, alpha=[1, 1, 0.8], life=0.6, hold=1, soft=0.2, follow=True)]
    elif style == "arrow":   # Lisvel: an arrow of morning light, a long aqua streak
        core = [L("mesh", at="path", shape="spike", scale=0.6, life=0.5, hold=1, color=[NOON, SIG], alpha=1, emissive=2.0, rim=SIG, rimEmissive=2.0,
                  align="velocity", stretch=[0.16, 0.16, 1.5])]
        trail = [L("ribbon", at="path", width=[0.0, 0.14], life=0.16, color=[SIG, SEC], alpha=[0, 0.75], emissive=2.0, noise=0.15, blend="add")]
    elif style == "pellet":  # Odrum: a sling-pellet of set resin, gold drips shed on the way
        core = [L("mesh", at="path", shape="orb", scale=0.26, life=0.6, hold=1, color=[SIG, SEC], alpha=1, emissive=0.8, rim=NOON, rimEmissive=2.0,
                  rimPow=1.6, noise=0.4, blend="chip", spinDeg=400)]
        sheds = [L("emitter", at="path", rate=20, shape="point", dir="back", spreadDeg=50, speed=[0.4, 1.0], life=[0.3, 0.45], size=[0.07, 0.05],
                   color=[SIG, SEC], alpha=[1, 1, 0], gravity=8, texture="drop", blend="chip", rim=NOON, rimAlpha=0.4, secondary=True)]
    elif style == "mote":    # Sukri: a drop of noon light, a lemon glow
        core = [L("mesh", at="path", shape="orb", scale=0.28, life=0.6, hold=1, color=[NOON, SIG], alpha=0.95, emissive=2.0, rim=SEC, rimEmissive=2.0,
                  rimPow=1.4),
                L("sprite", at="path", texture="glow", size=[0.75, 0.8], color=SIG, emissive=2.0, alpha=[1, 1, 0.8], life=0.6, hold=1, soft=0.2, follow=True)]
    elif style == "moth":    # Tunlan: a shadow-moth puppet, ink wings under a plum rim, fluttering
        core = [L("mesh", at="path", shape="crescent", scale=0.55, life=0.6, hold=1, color=INK, alpha=1, emissive=0, rim=SIG, rimEmissive=2.0,
                  rimPow=1.2, blend="ink", align="velocity", wobble=0.12, rotateDeg=[0, 180, 0])]
        trail = [L("ribbon", at="path", width=[0.0, 0.26], life=0.18, color=[SIG, SEC], alpha=[0, 0.55], emissive=2.0, noise=0.5, blend="add")]
        sheds = [L("emitter", at="path", rate=24, shape="point", dir="back", spreadDeg=60, speed=[0.2, 0.6], life=[0.25, 0.35], size=[0.14, 0.24, 0.1],
                   color=[INK, INK2], alpha=[0, 0.9, 0], turbulence=3, texture="wisp", blend="ink", rim=SIG, rimAlpha=0.7, soft=0.2, secondary=True)]
    elif style == "dart":    # Ulkro: a lime-fletched dart, a hard streak
        core = [L("mesh", at="path", shape="spike", scale=0.5, life=0.5, hold=1, color=[CHALK, CHALK_DK], alpha=1, emissive=0.5, rim=SIG,
                  rimEmissive=2.0, blend="chip", align="velocity", stretch=[0.18, 0.18, 1.3]),
                L("sprite", at="path", texture="glint", size=[0.45, 0.45], color=SIG, emissive=2.0, alpha=1, life=0.5, hold=1, follow=True)]
    elif style == "note":    # Vashil: a struck note: a glass bead ringing, rings shed behind it
        core = [L("mesh", at="path", shape="orb", scale=0.3, life=0.6, hold=1, color=[SEC, SIG], alpha=0.9, emissive=2.0, rim=NOON, rimEmissive=2.0,
                  rimPow=1.6, noise=0.3)]
        sheds = [L("shockwave", at="path", mode="vertical", radius=[[0, 0.12], [1, 0.55]], width=[0.06, 0.02], life=0.22, color=[SIG, SEC],
                   alpha=[0.9, 0], emissive=2.0, blend="add", repeat=0.08)]
    else:
        raise SystemExit(f"unknown shot {style}")
    return vfx(f"{rec['id']}_atk_shot", 0.6, *muzzle, *core, *trail, *sheds,
               comment=f"T1 · {kit['fam']} · {rec['name']} basic shot ({style}): a release flash at the {S}, the {style} core, a signature trail"
                       f" (>= 0.9 m at speed), shed sparks")


def plan() -> dict[str, dict]:
    """fighter id → {windups: {ability id: windup def id}, attack: {windupVfx, vfx?}}"""
    out = {}
    for rec in records():
        if rec["id"] not in KIT:
            continue
        wu = {ab["id"]: wid for wid, ab, _ in timed_casts(rec)}
        att = {"windupVfx": f"{rec['id']}_atk_swing"} if is_melee(rec) else {"windupVfx": f"{rec['id']}_atk_draw", "vfx": f"{rec['id']}_atk_shot"}
        out[rec["id"]] = {"windups": wu, "attack": att}
    return out


def defs() -> list:
    D = []
    for rec in records():
        if rec["id"] not in KIT:
            continue
        for wid, ab, slot in timed_casts(rec):
            D.append(windup(wid, rec, ab, slot))
        if is_melee(rec):
            D.append(swing(rec))
        else:
            D.append(draw(rec))
            D.append(shot(rec))
    return D
