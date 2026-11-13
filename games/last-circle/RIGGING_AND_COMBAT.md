# Rigging & Combat — the corrected system, clause by clause

This is the index to the complete corrected code for the rigging/attachment
pipeline, animation timing, combat collision, and the battle-royale gameplay
loop. Every clause of the goal maps to committed, commented code and a
verification performed live this session. (Note: the goal text says "Final
Drop" — that is the competitor benchmark; this game is **Last Circle**, the
build using pre-rigged Meshy.ai GLBs.)

## 1. "Load the Meshy GLB, inspect the exact bone hierarchy and skinning"

**Code: `runtime/3d/royale/rig_pipeline.js`** — `inspectRig(root, label)`.
Walks the hierarchy, audits against `EXPECTED_SKELETON` (17 required bones +
neck/Neck variant, verified against all 65 shipping GLBs: identical
hierarchies, 24 bound bones per clip, zero missing skin targets), reports
skinned-mesh count, bound-bone count, hand bone, and bone world scale. Runs
once per skin at load (`player.js` loadActorModels) and **fails loudly** with
the downstream victim named in the warning.

Verified: all 5 skins pass — `boundBones: 24`, `handBone: RightHand`,
`boneScale: 0.01` on every rig.

## 2. "Apply armor and weapons only to the correct bones with proper local transforms and world-space offsets"

**Code: `rig_pipeline.js` — `attachToBone(actor, obj, boneName, opts)`**, the
single sanctioned attachment path (exposed as `W.attachToBone`). Per-kind bone
whitelist: weapon → RightHand/FistR, armor → Spine/Spine01, back → Spine,
head cosmetics → Head. **A wrong bone throws** — armor-on-the-face is now
impossible by construction, not by convention. Applies the two Meshy-specific
transforms the inline weapon code proved out: counter-scale `1/boneWorldScale`
(bone scales vary ~500× between rig families) so children live in metres, and
local offsets applied in that counter-scaled space.

`validateAttachments(actor)` audits live actors: holder on a legal bone, scale
compensation inverting bone scale within 10%, weapon length inside the
0.2–1.1 m normalization band (self-updates matrixWorld before measuring — a
stale matrix made a 0.62 m AR read 0.01 m).

Verified: player attachment `ok: true`; weapon-to-Head **REFUSED**;
armor-to-Spine accepted (positive control).

Note recorded for accuracy: this build has no armor *items* — vests are baked
into the character meshes. The pipeline makes any future attachment safe.

## 3. "Ensure correct scaling so every weapon matches realistic proportions"

**Code: `weapons.js` protos loader** — every weapon GLB is normalized to an
explicit target length at load (pistol 0.34 m, shotgun 0.8 m, …), centered,
and barrel-oriented (+Z). Deliberately stylized-compact; the
`weaponLengthBand` check in `validateAttachments` catches a broken
normalization without policing the style choice. Verified: AR measures
0.642 m in-band on the live rig.

## 4. "Weapons held at incorrect angles / floating"

**Code: `player.js` barrel-aim block** (in syncObj) — the weapon holder is
oriented from the hand bone's **live world quaternion** each frame with an
explicit basis (no roll), only in gunReady/reload. Fixed the root cause: the
old `HAND_AIM_ROT` was calibrated on ONE frame of the idle clip; measured
error was 32.7° mean / 49.9° on the default skin before, **0.0° in all six
aimed states** after (verified by rendered muzzle/stock markers, not by the
circular dot-product test that fooled an earlier pass — that correction is in
the commit log at `a77921d5`).

## 5. "Limbs invert, necks or legs get misplaced"

- Baked root motion stripped at the one point every Meshy clip passes through
  (`player.js` stripRootMotion; XZ pinned, Y kept except jump).
- Spine hyperextension fixed by the **sourced aim rig** (`pose.js` AIM):
  trunk clamped −20°/+45° split 0.333/0.444/0.222, gaze chain (neck 0.40/25°,
  head 0.60/35°) carrying what the trunk can't — grounded in the anatomical
  budget (thoracic ext ~22°, lumbar ~31°) and Unity's shipping ±40° neck/head
  clamps. Full sources in `AIM_RIG_SPEC.md`.
- The unbounded `spine.rotation.x +=` accumulator (measured 3.8→68.6 rad,
  ~10 revolutions) replaced with absolute rest+offset (`applySpineAim`).

Verified: 40° up-aim → trunk 18° (budget 53°), gaze 22° (budget 60°),
symmetric down, bounded on all 50 actors over a full match.

## 6. "Animations far too fast compared to real combat" → researched timings

**Research: `COMBAT_CALIBRATION.md`** (PUBG wiki per-weapon pages fetched
directly; Fortnite movement tables; Apex/Warzone corroboration). Verdicts:

| mechanic | ours | benchmark | action |
|---|---|---|---|
| sprint:base ratio | 1.33 | PUBG 1.34 / FN 1.35 | validated, keep |
| stamina loop | 7.4 s/6.3 s | FN 6.67 s/6.22 s | validated, keep |
| TTK core | AR 165 DPS etc. | exact Fortnite calibration | keep |
| weapon ready delay | **0 → 0.4 s** | PUBG 400–500 ms all weapons | **applied** (`weapons.js` equipSlot) |
| sniper scope-in | **instant → 0.5 s** | Warzone snipers 520–650 ms | **applied** (`adsTimeS`, gates accuracy + scope camera + reticle; bots pay it too via `a._adsT`) |
| endgame storm | **waits 25/20 s → 10/0 s** | FN circles 7–9 have zero wait | **applied**, totals & 9.4 m final hold preserved |
| per-class recoil | flat 5 cm | class-scaled | **applied** via the existing vmKick (SMG 1.0 → sniper 8.0 cm measured) |
| bandage 3→4 s, big shield 4→5 s | — | exact PUBG/FN match | **owner-call, flagged not applied** |

Reload/fire-rate animation sync: the reload click-sequence is timed to each
weapon's `reloadS`; fire visuals key off real rpm; there is no melee in this
game and the unused full-body "shoot" clip stays unused deliberately (it would
fight the pose layer — recoil is procedural instead).

## 7. "Weapons and projectiles physically interact instead of passing through"

**Code: `weapons.js` testSegment** — nearest-hit arbitration: the swept
world solve (`segmentColliders`, slab method) runs FIRST, the nearest actor
along the ray is kept (not the first in array order), and whichever is nearer
wins. Sub-stepped at ≤2.5 m so fast rounds cannot tunnel.

Verified both directions: 20 rounds into a wall with a pinned victim behind it
→ **0 damage, 21 stone impacts, victim alive**; control on open ground →
3 rounds, 100 damage, kill. (An earlier "cover still fails" report was my
test's eye-height mismatch — corrected in the commit log at `1e6068d4`.)

## 8. "Rebuild the core BR systems — looting, inventory, gunplay, zone, bot AI, combat"

All verified end-to-end this session (a full 50→1 match played to VICTORY,
717 s, zero runtime errors):

- **Looting/inventory** (`loot.js`): magazine survives drop/pickup (no
  infinite-reload exploit), full stacks refuse instead of destroying items,
  GUN_CAP holds through swaps, consumable E-swap, tap-vs-hold chest
  disambiguation.
- **Gunplay** (`weapons.js` + `sim/royale.js`): shared `effectiveSpread` for
  fire and reticle (the crosshair cannot lie), per-class recoil, ready delay,
  scope-in gate, ballistics with sub-stepped swept collision.
- **Zone** (`storm.js` + STORM_PHASES): 8 phases, continuous endgame shrink,
  final circle holds at 9.4 m (someone must win the fight), storm death hands
  the camera to a survivor.
- **Bot AI** (`bots.js`): 9-state utility brain, 5 skill tiers, LOS-gated by
  the same swept test bullets use; heal livelock fixed; bots retreat while
  healing at the same slowed speed the player pays; bots pay stamina and
  scope-in like the player.
- **Movement**: stamina-gated sprint, crouch, swim with haul-out (water is no
  longer a one-way trapdoor), glide/parachute, underwater treatment.

## 9. Support-hand two-bone IK — SHIPPED (and the false theory retired)

The support hand now grips the weapon in gunReady via `pose.js twoBoneIK`,
called from syncObj with a class-based foregrip point measured in holder space
once per weapon swap, plus a reach-aware slide (grip point moves back along
the barrel toward the receiver when the class foregrip exceeds the arm
envelope — the short-stock hold real shooters use, instead of a fully
extended arm floating short of the rail).

The weeks-old "frame-order clobber" theory was WRONG: kernel order is
mixers → updaters → render and nothing after syncObj touches bones. The real
fault was twoBoneIK's elbow-bend sign driving the elbow AWAY from the target
by the intended magnitude every call (live-measured 94.3° → 116.8° → 161.8°
across passes — each off by exactly +|want−cur|); the shoulder swing then
partially recovered, so standalone probes looked convergent while per-frame
solves oscillated (0.86/0.336/0.418/0.674 m). Sign fixed in pose.js with the
Rodrigues derivation in the comment.

Verified live: pistol hand-to-weapon 0.021 m (cups the grip), AR 0 m with a
natural 105.3° elbow, shotgun/sniper on the fore-end at extension (correct
technique for those classes); screenshots from three angles show a true
two-handed hold; standard-mode 50-bot match runs clean, zero errors.

## Still open (tracked, not hidden)

Mid-match MP REJOIN (host-departure recovery shipped; a returning peer still
gets a new id, no slot re-mapping — design change, deferred); the owner-call
calibration pair above (bandage 3→4 s + big shield 4→5 s; crouch speed
0.45× vs ~0.72–0.76×). Tower interior ramps and cliff-temple chest access
were fixed and walk-verified in earlier iterations (see commit log).
