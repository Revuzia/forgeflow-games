# HIT PARADE - Mixamo rig compatibility (X Bot clips -> character bodies)

Lane: animations/mixamo. Status: COMPLETE (measurement + visual proof). All numbers below were
measured this session with Blender 5.1.2 headless; scripts in `tools/research/`.

## Verdict (read this first)

**Naive bone-name clip sharing is NOT safe for any of the 7 bodies tested, and for none of the 79
character FBXs in the folder. Bake each clip onto each body in Blender with a world-space retarget
(body bones) plus a parent-relative copy for finger bones ("hybrid"), then export per body.**

| body | naive by name (three.js, clip unmodified) | naive, translation stripped + hips scaled | world-space retarget (body) | what to ship |
|---|---|---|---|---|
| Prisoner B Styperek | FAILS: sinks 0.068-0.090 m into floor | small errors (shoulders 18.3 deg swing, feet 12.6 deg) | looks right | hybrid retarget. Cannot close its RIGHT fist: 20 right-hand finger bones missing (render-verified) |
| Brute | FAILS: sinks 0.135-0.168 m into floor | close; feet 9.9 deg, neck/head 7.0 deg off | looks right | hybrid retarget; hide `BattleAxe_GEO` mesh, ignore `Weapon`/`Hair1-4`/eye bones |
| Whiteclown N Hallin | not rendered (hip ratio 1.098: the raw X Bot hips track would sink it, inferred) | spine 9.5 deg, feet 7.2 deg | expected right (same class as Prisoner/Brute) | hybrid retarget |
| Kachujin G Rosales | not rendered (hip ratio 1.088) | shoulders 16.8 deg, spine 8.1 deg | expected right | hybrid retarget; rig carries 8 `Bow` bones (bow prop) |
| Mutant | not rendered (hip ratio 0.888) | spine 9.5 deg, shoulders 13.0 deg; 28 finger bones missing | expected right | hybrid retarget; hands stay in bind shape (no finger bones) |
| Ch01_nonPBR | binds NOTHING: bone prefix is `mixamorig12:` | shoulders 18.5 deg; arm/hand roll 5-6 deg | expected right | rename prefix, hybrid retarget |
| Ch44_nonPBR | sinks 0.011-0.018 m | FAILS visibly: feet on pointed toes (15 deg foot swing), render-verified | feet right, but RIGHT THUMB sticks up at punch contact (render-verified) | hybrid retarget: correct feet AND closed fist (render-verified) |

"Expected right" = not rendered this session; the per-bone numbers put those bodies in the same
class as Prisoner/Brute (upper-arm rest within 0-3.2 deg of X Bot, differences concentrated in
spine/neck/shoulder/feet), where the retarget was render-verified.

## Why (the mechanism, measured)

1. **Every clip is on the exact X Bot bind.** All 610 X Bot-skeleton clips in the 23 X Bot packs
   have rest-orientation maxdiff 0.0169 vs `Pro_Melee_Axe_Pack/X Bot.fbx`, and that maximum sits on
   one finger bone (`RightHandThumb3`); body bones match. (`Extra/` and `WithSkin/` hold 18 clips on
   a different 41-bone rig with the hips rest at z=0: rest maxdiff 0.79-0.83. Not X Bot clips.)
2. **No character matches the X Bot bind.** Across all 79 character FBXs the worst body-bone
   maxdiff is >= 0.103 on every body (none below 0.05). The X Bot neck sits 5.95-30.6 deg from
   every character's; feet 0.4-47 deg (median 8.5). Upper arms, by contrast, are nearly identical for
   the named bodies (Prisoner/Whiteclown/Kachujin 0.0 deg, Brute 0.8, Mutant 3.2) and worst on
   ChNN bodies (up to 18.1 deg, Ch05).
3. **What each transfer does with that difference** (per bone, C = rest difference):
   - three.js AnimationMixer bound by name copies X Bot's *absolute* parent-relative rotations, so
     each body bone takes X Bot's bone direction and the body mesh is mis-posed by exactly C. It
     also applies the clip's translation tracks: all 610 X Bot clips carry 195 location fcurves (65
     bones x 3, counted); only `Hips` varies, so the body gets X Bot's bone offsets and X Bot's
     absolute hips height (1.0427 m).
   - Blender action reassign (`naive_blender`) re-applies X Bot's *local deltas from rest* on the
     body's own rest: anatomy kept, but delta axes are the body's, so limbs drift where bone rolls
     differ (Ch44 punch arm raised above X Bot's; `compare_upper.png`).
   - World-space retarget (driftwake `blender_retarget.retarget_action`, reused verbatim) applies
     X Bot's *world-space delta from rest* on the body's rest: anatomy kept (feet flat, head carried
     as sculpted). Its identity gate passes on both proof clips: worst error 6.4e-07 (tolerance 1e-4).
     Weak spot: fingers, whose rests differ most between bodies (worst finger maxdiff 0.25-1.00),
     so a fist can come out with the thumb up.
   - Hybrid (new here): retarget for body bones, parent-relative copy for the finger bones, so the
     fist shape is X Bot's relative to the retargeted hand.
4. **Hips height.** Lowest skinned-vertex height per variant (0 = feet on floor; X Bot itself
   -0.005..-0.000 m):

| clip / body (hip ratio) | naive_blender | three.js raw | naive_three (scaled hips) | retarget_dw (driftwake hips) | retarget / hybrid (scaled hips) |
|---|---|---|---|---|---|
| mutant punch / Brute (1.168) | -0.003 | -0.153..-0.135 | -0.037..-0.030 | **+0.196..+0.199** | -0.046..-0.043 |
| mutant punch / Prisoner (1.043) | +0.017..+0.021 | -0.073..-0.068 | +0.005..+0.008 | **+0.226..+0.230** | +0.011..+0.015 |
| mutant punch / Ch44 (0.983) | -0.047..+0.004 | -0.018..-0.011 | -0.039..-0.035 | **+0.189..+0.204** | -0.021..-0.006 |
| kneeing / Brute | -0.030..-0.017 | -0.168..-0.165 | -0.029..-0.026 | +0.010..+0.021 | -0.036..-0.024 |
| kneeing / Prisoner | -0.004..+0.003 | -0.090..-0.086 | -0.006..-0.001 | +0.036..+0.043 | -0.004..+0.003 |
| kneeing / Ch44 | -0.014..-0.011 | -0.018..-0.017 | -0.037..-0.032 | +0.025..+0.027 | -0.020..-0.018 |

   The driftwake hips rule baselines the hips at the clip's MEDIAN height. The mutant clips stand
   crouched (hips start 0.911 m vs X Bot rest 1.043 m), so the body is lifted about 0.13 m x hip
   ratio and floats ~0.2 m. If reused, replace it: the rest-relative hips delta (what
   naive_blender does) kept feet within -0.047..+0.021 m across all 18 body-frames tested.

## Visual proof (rendered and inspected this session)

Clips: `Creature_Pack/mutant punch` (frames 5 windup, 11 contact, 19 follow-through) and
`Soccer_Game_Pack/kneeing soccerball` (7, 13 contact, 21). Bodies: Brute and Prisoner (asked) plus
Ch44_nonPBR as a stress body (largest measured hand roll, 16.6 deg). Seven variants each (xbot
reference, naive_blender, naive_three_raw, naive_three, retarget_dw, retarget, hybrid); Workbench,
orthographic; views 3/4, side, feet close-up, upper close-up, both hands.
(f11 of the punch is the END of a right-to-left hook - the fist passes the front at f9, see
MIXAMO_CLIPS.md - which does not matter here: every variant is compared at the same frames.)
Renders: `renders_mixamo/proof_frames/` (756 PNGs), sheets in `renders_mixamo/proof/`.

What the renders show:
- `renders_mixamo/proof/compare_feet.png`: on Ch44, `naive_three` puts both feet on pointed toes
  (heels lifted) at punch f5 and f11 and on the standing foot at kneeing f13, while X Bot's feet
  are flat; `naive_blender`, `retarget`, `hybrid` keep Ch44's heels down. On Brute/Prisoner the
  same error exists but is subtle at this scale.
- `renders_mixamo/proof/proof_*__zoom.png`: `naive_three_raw` shows Brute's boots cut by the floor
  (0.14-0.17 m sink); `retarget_dw` shows a gap under both feet on all three bodies for the punch.
- `renders_mixamo/proof/compare_rhand.png` (punch contact f11): X Bot makes a closed fist. Brute:
  fist in every variant. Ch44: `retarget` gives a thumb-up hand, `hybrid` a closed fist matching
  X Bot. Prisoner: a half-open hand in EVERY variant (its rig has no right-hand finger bones).
- `renders_mixamo/proof/diff_*.png` + `diff_stats.json`: pixel difference `naive_three` vs
  `retarget` (identical hips rule, so rotation-only). Feet view at contact: Brute 656 / 1373 px,
  Prisoner 778 / 1556 px, Ch44 11502 / 12357 px (punch / kneeing). `upper` view counts are inflated
  because that camera re-centers on the neck, which moves between variants.

**Which looks right:** for Brute and Prisoner, `naive_blender`, `retarget` and `hybrid` all read
as the source motion with feet planted; `naive_three_raw` (the literal three.js result) is wrong
(sunk) and `retarget_dw` is wrong (floating). For Ch44 only `hybrid` gets both the feet and the
fist right. **Ship `hybrid` with a rest-relative hips rule.**

## Pipeline recommendation for the game

1. Per body: import the body FBX, rename the bone prefix to `mixamorig:` (16 of 79 bodies use
   `mixamorig1:`..`mixamorig12:`; three.js binds tracks by exact node name, so an unrenamed Ch01
   clip animates nothing).
2. Retarget each needed clip with `blender_retarget.retarget_action` (body bones) + finger local
   copy (`mixamo_rig_proof.py` `hybrid_prep`), hips = body rest + (X Bot hips - X Bot rest) x hip
   ratio; drop horizontal root motion if the controller owns position.
3. Export one GLB per body with rotation tracks + hips translation only (strip the 64 constant
   location tracks per clip). Gate: re-render each clip's contact frame on the body and look.
4. Hide prop meshes shipped inside character FBXs (Brute `BattleAxe_GEO`; Paladin WProp carries
   `Shield_joint`/`Sword_joint`; Erika Archer With Bow Arrow carries `arrow`).

Out-of-scope anomalies (found, not fixed): Ch09_nonPBR's LeftHand rest points 172.8 deg away from
X Bot's (twist -94.9 deg), a broken or posed hand; Medea (hip 0.100 m, top 0.162 m) and Pirate
(0.371 m / 0.626 m) measure far too small for adult bodies (import scale or stray low bones, not
investigated); Ch09 / Ch19 hips 0.63 / 0.58 m.

## Measurement tables

Source: `_work/rig_0..3.json` (`tools/research/mixamo_rig_compat.py`). Reference:
`Pro_Melee_Axe_Pack/X Bot.fbx` (65 bones, hip 1.0427 m, top 1.8197 m). Sanity row:
`Soccer_Game_Pack/X Bot.fbx` vs reference = 0.0000 on every body bone.

### Per-bone rest maxdiff (matrix_local 3x3, max abs element difference vs X Bot)

| bone | Prisoner | Brute | Whiteclown | Kachujin | Mutant | Ch01 | Ch44 |
|---|---|---|---|---|---|---|---|
| Hips | 0.0129 | 0.0129 | 0.0129 | 0.0129 | 0.0129 | 0.0129 | 0.0129 |
| Spine | 0.1223 | 0.0011 | 0.1645 | 0.1414 | 0.1644 | 0.0378 | 0.0742 |
| Spine1 | 0.1354 | 0.0011 | 0.1633 | 0.0848 | 0.0766 | 0.0378 | 0.0742 |
| Spine2 | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.0122 | 0.0487 |
| Neck | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.1215 |
| Head | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.1215 | 0.1215 |
| LeftShoulder | 0.3123 | 0.0306 | 0.0815 | 0.2096 | 0.1639 | 0.2479 | 0.2114 |
| LeftArm | 0.0000 | 0.0130 | 0.0000 | 0.0000 | 0.0552 | 0.1050 | 0.1333 |
| LeftForeArm | 0.0000 | 0.0026 | 0.0175 | 0.0175 | 0.0000 | 0.1096 | 0.1472 |
| LeftHand | 0.0000 | 0.0026 | 0.0175 | 0.0175 | 0.0000 | 0.0959 | 0.3037 |
| RightShoulder | 0.3123 | 0.0306 | 0.0815 | 0.2096 | 0.1644 | 0.2479 | 0.2113 |
| RightArm | 0.0000 | 0.0130 | 0.0000 | 0.0000 | 0.0552 | 0.1018 | 0.1334 |
| RightForeArm | 0.0000 | 0.0026 | 0.0175 | 0.0175 | 0.0000 | 0.1067 | 0.1478 |
| RightHand | 0.0000 | 0.0026 | 0.0175 | 0.0175 | 0.0000 | 0.1098 | 0.3057 |
| LeftUpLeg | 0.0093 | 0.0020 | 0.0521 | 0.0111 | 0.0334 | 0.0807 | 0.1015 |
| LeftLeg | 0.0103 | 0.0097 | 0.0297 | 0.0063 | 0.0085 | 0.0598 | 0.1146 |
| LeftFoot | 0.2165 | 0.1020 | 0.1015 | 0.0445 | 0.0819 | 0.1215 | 0.2500 |
| LeftToeBase | 0.2050 | 0.0661 | 0.0019 | 0.0040 | 0.0001 | 0.1924 | 0.2639 |
| RightUpLeg | 0.0093 | 0.0020 | 0.0521 | 0.0111 | 0.0334 | 0.0753 | 0.1015 |
| RightLeg | 0.0103 | 0.0097 | 0.0297 | 0.0063 | 0.0086 | 0.0596 | 0.1147 |
| RightFoot | 0.2165 | 0.1020 | 0.1015 | 0.0445 | 0.0819 | 0.1298 | 0.2478 |
| RightToeBase | 0.2050 | 0.0661 | 0.0019 | 0.0040 | 0.0001 | 0.1947 | 0.2639 |
| worst finger | 0.2528 (LeftHandThumb1) | 0.2577 (LeftHandThumb1) | 0.2528 (LeftHandThumb1) | 0.2534 (LeftHandThumb1) | 1.0000 (RightHandPinky1) | 0.3673 (RightHandPinky2) | 0.8901 (RightHandPinky3) |

### Same bones as swing / twist angles in degrees (swing = bone direction differs; twist = roll about the bone)

| bone | Prisoner | Brute | Whiteclown | Kachujin | Mutant | Ch01 | Ch44 |
|---|---|---|---|---|---|---|---|
| Hips | 0.7 / -0.0 | 0.7 / 0.0 | 0.7 / -0.0 | 0.7 / -0.0 | 0.7 / -0.0 | 0.7 / -0.0 | 0.7 / -0.0 |
| Spine | 7.0 / 0.0 | 0.1 / 0.0 | 9.4 / 0.0 | 8.1 / 0.0 | 9.4 / 0.0 | 2.2 / 0.0 | 4.3 / 0.0 |
| Spine1 | 7.8 / 0.0 | 0.1 / 0.0 | 9.4 / 0.0 | 4.9 / 0.0 | 4.4 / 0.0 | 2.2 / 0.0 | 4.3 / 0.0 |
| Spine2 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 0.7 / 0.0 | 2.8 / 0.0 |
| Neck | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 |
| Head | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 | 7.0 / 0.0 |
| LeftShoulder | 18.3 / 4.5 | 2.4 / -0.4 | 6.3 / 1.0 | 16.8 / 1.2 | 12.9 / -0.9 | 18.5 / -5.1 | 17.1 / -3.0 |
| LeftArm | 0.0 / 0.0 | 0.8 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 3.2 / -0.0 | 4.8 / -5.9 | 8.8 / -3.5 |
| LeftForeArm | 0.0 / 0.0 | 0.2 / -0.0 | 1.0 / 0.0 | 1.0 / 0.0 | 0.0 / -0.0 | 3.5 / -6.2 | 8.5 / -4.7 |
| LeftHand | 0.0 / 0.0 | 0.2 / -0.0 | 1.0 / 0.0 | 1.0 / 0.0 | 0.0 / -0.0 | 6.5 / 5.3 | 20.2 / -16.4 |
| RightShoulder | 18.3 / -4.5 | 2.4 / 0.4 | 6.3 / -1.0 | 16.8 / -1.2 | 12.9 / 0.9 | 18.7 / 5.0 | 16.8 / 3.1 |
| RightArm | 0.0 / -0.0 | 0.8 / -0.0 | 0.0 / -0.0 | 0.0 / -0.0 | 3.2 / 0.0 | 5.0 / 5.7 | 8.5 / 3.7 |
| RightForeArm | 0.0 / 0.0 | 0.2 / 0.0 | 1.0 / 0.0 | 1.0 / 0.0 | 0.0 / 0.0 | 3.6 / 6.1 | 8.6 / 4.9 |
| RightHand | 0.0 / 0.0 | 0.2 / 0.0 | 1.0 / 0.0 | 1.0 / 0.0 | 0.0 / 0.0 | 6.5 / -6.1 | 19.6 / 16.6 |
| LeftUpLeg | 0.5 / 0.0 | 0.1 / -0.0 | 3.0 / -0.0 | 0.6 / -0.0 | 1.9 / -0.0 | 5.7 / 0.1 | 7.0 / 0.2 |
| LeftLeg | 0.6 / -0.0 | 0.6 / -0.0 | 1.7 / 0.0 | 0.4 / 0.0 | 0.5 / 0.0 | 3.5 / -0.0 | 7.1 / -0.2 |
| LeftFoot | 12.6 / -2.2 | 9.9 / -1.4 | 7.2 / 0.0 | 3.2 / 0.0 | 6.4 / 0.0 | 9.7 / -0.2 | 15.0 / -1.0 |
| LeftToeBase | 11.8 / 0.0 | 3.8 / 0.0 | 0.1 / 0.0 | 0.2 / 0.0 | 0.0 / 0.0 | 11.3 / -4.1 | 15.3 / 3.3 |
| RightUpLeg | 0.5 / -0.0 | 0.1 / -0.0 | 3.0 / -0.0 | 0.6 / -0.0 | 1.9 / 0.0 | 5.5 / -0.1 | 6.8 / -0.2 |
| RightLeg | 0.6 / -0.0 | 0.6 / 0.0 | 1.7 / -0.0 | 0.4 / -0.0 | 0.5 / 0.0 | 4.3 / 0.1 | 7.2 / 0.3 |
| RightFoot | 12.6 / 2.2 | 9.9 / 1.4 | 7.2 / 0.0 | 3.2 / 0.0 | 6.4 / 0.0 | 11.0 / -0.3 | 15.0 / 0.9 |
| RightToeBase | 11.8 / -0.0 | 3.8 / -0.0 | 0.1 / 0.0 | 0.2 / 0.0 | 0.0 / 0.0 | 11.4 / 5.7 | 15.3 / -3.0 |

### Body facts

| body | bones | prefix | hip height m (ratio vs X Bot 1.0427) | missing vs X Bot | extra bones |
|---|---|---|---|---|---|
| Prisoner | 47 | mixamorig: | 1.088 (1.043) | 20 finger bones (RightHandIndex1, RightHandIndex2...) | LeftEye, RightEye |
| Brute | 72 | mixamorig: | 1.218 (1.168) | none | Hair1, Hair2, Hair3, Hair4, LeftEye, RightEye, Weapon |
| Whiteclown | 67 | mixamorig: | 1.145 (1.098) | none | LeftEye, RightEye |
| Kachujin | 75 | mixamorig: | 1.134 (1.088) | none | Bow1, Bow2, Bow3, Bow4, Bow5, Bow6, Bow7, Bow8, Leye, Reye |
| Mutant | 37 | mixamorig: | 0.925 (0.888) | 28 finger bones (LeftHandIndex1, LeftHandIndex2...) | none |
| Ch01 | 65 | mixamorig12: | 0.976 (0.936) | none | none |
| Ch44 | 65 | mixamorig: | 1.025 (0.983) | none | none |

### All 79 character FBXs (summary row per body)

| body | bones | prefix | hip m | worst body-bone maxdiff (bone) | worst swing deg (bone) | worst twist deg (bone) | missing |
|---|---|---|---|---|---|---|---|
| Aj | 83 | mixamorig: | 0.833 | 0.209 (RightShoulder) | 12.4 (RightShoulder) | -0.8 (LeftFoot) | 0 |
| Arissa | 73 | mixamorig: | 0.964 | 0.213 (LeftFoot) | 16.6 (LeftFoot) | 0.4 (LeftShoulder) | 0 |
| Brute | 72 | mixamorig: | 1.218 | 0.121 (Spine2) | 9.9 (LeftFoot) | -1.4 (LeftFoot) | 0 |
| Castle Guard 02 | 43 | mixamorig: | 1.000 | 0.495 (LeftShoulder) | 34.0 (LeftShoulder) | 2.1 (LeftShoulder) | 24 |
| Ch01_nonPBR | 65 | mixamorig12: | 0.976 | 0.248 (LeftShoulder) | 18.7 (RightShoulder) | -6.2 (LeftForeArm) | 0 |
| Ch02_nonPBR | 65 | mixamorig: | 0.959 | 0.255 (LeftShoulder) | 19.0 (RightShoulder) | 9.2 (RightHand) | 0 |
| Ch03_nonPBR | 65 | mixamorig: | 1.016 | 0.264 (LeftShoulder) | 19.5 (RightShoulder) | 6.4 (LeftHand) | 0 |
| Ch05_nonPBR | 65 | mixamorig: | 0.972 | 0.297 (LeftArm) | 18.1 (RightArm) | 7.3 (RightHand) | 0 |
| Ch06_nonPBR | 65 | mixamorig9: | 0.951 | 0.289 (LeftShoulder) | 20.6 (LeftShoulder) | 6.7 (LeftHand) | 0 |
| Ch07_nonPBR | 65 | mixamorig8: | 0.991 | 0.224 (LeftShoulder) | 17.6 (LeftShoulder) | -4.5 (LeftToeBase) | 0 |
| Ch08_nonPBR | 65 | mixamorig7: | 0.969 | 0.309 (LeftShoulder) | 21.5 (LeftShoulder) | 6.9 (LeftHand) | 0 |
| Ch09_nonPBR | 65 | mixamorig6: | 0.633 | 1.992 (LeftHand) | 172.8 (LeftHand) | -94.9 (LeftHand) | 0 |
| Ch10_nonPBR | 65 | mixamorig5: | 1.051 | 0.210 (RightShoulder) | 16.7 (RightShoulder) | -9.6 (LeftForeArm) | 0 |
| Ch15_nonPBR | 65 | mixamorig: | 0.945 | 0.223 (RightShoulder) | 17.3 (RightShoulder) | 6.6 (LeftHand) | 0 |
| Ch16_nonPBR | 65 | mixamorig: | 0.927 | 0.209 (LeftShoulder) | 16.9 (LeftShoulder) | 6.8 (LeftHand) | 0 |
| Ch17_nonPBR | 65 | mixamorig1: | 0.932 | 0.206 (LeftShoulder) | 16.1 (LeftShoulder) | 6.1 (LeftHand) | 0 |
| Ch19_nonPBR | 57 | mixamorig1: | 0.577 | 0.306 (LeftShoulder) | 21.5 (LeftShoulder) | 1.9 (RightForeArm) | 8 |
| Ch20_nonPBR | 65 | mixamorig6: | 0.969 | 0.242 (LeftToeBase) | 17.2 (RightShoulder) | -5.2 (LeftForeArm) | 0 |
| Ch21_nonPBR | 65 | mixamorig: | 0.942 | 0.249 (LeftShoulder) | 18.6 (LeftShoulder) | -3.8 (RightToeBase) | 0 |
| Ch22_nonPBR | 65 | mixamorig2: | 0.988 | 0.230 (LeftShoulder) | 17.8 (LeftShoulder) | 3.1 (LeftFoot) | 0 |
| Ch23_nonPBR | 65 | mixamorig: | 0.991 | 0.210 (RightShoulder) | 17.0 (RightShoulder) | -6.9 (LeftForeArm) | 0 |
| Ch24_nonPBR | 65 | mixamorig: | 0.932 | 0.301 (LeftShoulder) | 21.2 (RightShoulder) | -5.5 (LeftForeArm) | 0 |
| Ch25_nonPBR | 65 | mixamorig: | 0.956 | 0.229 (LeftShoulder) | 17.7 (LeftShoulder) | 10.8 (RightForeArm) | 0 |
| Ch26_nonPBR | 65 | mixamorig1: | 0.994 | 0.246 (LeftShoulder) | 18.7 (LeftShoulder) | 2.9 (RightToeBase) | 0 |
| Ch29_nonPBR | 65 | mixamorig1: | 0.962 | 0.308 (LeftShoulder) | 21.6 (RightShoulder) | 7.7 (RightHand) | 0 |
| Ch31_nonPBR | 65 | mixamorig9: | 0.942 | 0.223 (LeftToeBase) | 16.8 (RightShoulder) | -6.0 (RightHand) | 0 |
| Ch33_nonPBR | 65 | mixamorig7: | 0.975 | 0.212 (LeftShoulder) | 16.8 (LeftShoulder) | 6.6 (RightForeArm) | 0 |
| Ch34_nonPBR | 65 | mixamorig: | 0.960 | 0.332 (LeftShoulder) | 23.3 (LeftShoulder) | 11.1 (RightForeArm) | 0 |
| Ch35_nonPBR | 65 | mixamorig: | 0.999 | 0.208 (RightShoulder) | 16.8 (RightShoulder) | -6.9 (LeftForeArm) | 0 |
| Ch39_nonPBR | 65 | mixamorig: | 0.913 | 0.257 (LeftShoulder) | 19.2 (LeftShoulder) | -9.0 (RightFoot) | 0 |
| Ch40_nonPBR | 65 | mixamorig: | 1.095 | 0.211 (RightShoulder) | 16.8 (RightShoulder) | -5.4 (LeftForeArm) | 0 |
| Ch42_nonPBR | 65 | mixamorig: | 0.957 | 0.214 (LeftShoulder) | 17.3 (RightShoulder) | 5.7 (LeftHand) | 0 |
| Ch44_nonPBR | 65 | mixamorig: | 1.025 | 0.306 (RightHand) | 20.2 (LeftHand) | 16.6 (RightHand) | 0 |
| Ch45_nonPBR | 65 | mixamorig1: | 0.983 | 0.395 (RightToeBase) | 23.3 (RightToeBase) | 14.0 (RightHand) | 0 |
| Ch49_nonPBR | 65 | mixamorig: | 0.969 | 0.213 (LeftShoulder) | 17.1 (LeftShoulder) | -6.6 (RightHand) | 0 |
| Ch50_nonPBR | 49 | mixamorig1: | 1.040 | 0.206 (LeftShoulder) | 16.4 (LeftShoulder) | 6.3 (RightForeArm) | 16 |
| Demon T Wiezzorek | 79 | mixamorig: | 1.234 | 0.426 (LeftShoulder) | 26.6 (LeftShoulder) | 3.5 (LeftShoulder) | 0 |
| Ely By K.Atienza | 67 | mixamorig: | 0.980 | 0.211 (LeftShoulder) | 16.9 (LeftShoulder) | -1.5 (LeftFoot) | 0 |
| Erika Archer | 67 | mixamorig: | 1.042 | 0.104 (Neck) | 6.0 (Neck) | -0.7 (LeftForeArm) | 0 |
| Erika Archer With Bow Arrow | 70 | mixamorig: | 1.042 | 0.104 (Neck) | 6.0 (Neck) | -0.7 (LeftForeArm) | 0 |
| Eve By J.Gonzales | 65 | mixamorig: | 0.813 | 0.236 (LeftShoulder) | 17.9 (LeftShoulder) | 1.4 (LeftShoulder) | 0 |
| Exo Gray | 112 | mixamorig: | 0.964 | 0.324 (Neck) | 18.6 (Neck) | 4.5 (LeftFoot) | 0 |
| Ganfaul M Aure | 99 | mixamorig: | 1.190 | 0.441 (RightShoulder) | 28.9 (RightShoulder) | -7.7 (RightToeBase) | 0 |
| Girlscout T Masuyama | 67 | mixamorig: | 1.024 | 0.240 (LeftToeBase) | 17.4 (RightShoulder) | 5.2 (RightFoot) | 0 |
| Heraklios By A. Dizon | 65 | mixamorig: | 0.990 | 0.286 (LeftFoot) | 21.6 (LeftFoot) | -0.9 (LeftFoot) | 0 |
| Kachujin G Rosales | 75 | mixamorig: | 1.134 | 0.210 (LeftShoulder) | 16.8 (LeftShoulder) | 1.2 (LeftShoulder) | 0 |
| Knight D Pelegrini | 66 | mixamorig: | 1.187 | 0.405 (RightShoulder) | 26.2 (RightShoulder) | 2.8 (LeftShoulder) | 0 |
| Lola B Styperek | 67 | mixamorig: | 1.138 | 0.210 (LeftShoulder) | 13.8 (LeftShoulder) | -1.6 (LeftFoot) | 0 |
| Maria J J Ong | 65 | mixamorig: | 1.052 | 0.301 (LeftFoot) | 22.6 (LeftFoot) | -1.2 (LeftFoot) | 0 |
| Maria WProp J J Ong | 65 | mixamorig: | 1.052 | 0.301 (LeftFoot) | 22.6 (LeftFoot) | -1.2 (LeftFoot) | 0 |
| Maw J Laygo | 64 | mixamorig: | 0.974 | 0.353 (LeftFoot) | 22.1 (LeftFoot) | -1.9 (LeftFoot) | 8 |
| Medea By M. Arrebola | 69 | mixamorig: | 0.100 | 0.246 (RightShoulder) | 18.4 (LeftShoulder) | -1.6 (RightShoulder) | 0 |
| Mutant | 37 | mixamorig: | 0.925 | 0.164 (Spine) | 12.9 (RightShoulder) | -0.9 (LeftShoulder) | 28 |
| Nightshade J Friedrich | 68 | mixamorig: | 1.241 | 0.209 (LeftShoulder) | 12.1 (RightShoulder) | -1.7 (LeftFoot) | 0 |
| Paladin J Nordstrom | 67 | mixamorig: | 0.956 | 0.208 (LeftShoulder) | 12.9 (LeftShoulder) | 0.7 (LeftFoot) | 0 |
| Paladin WProp J Nordstrom | 69 | mixamorig: | 0.956 | 0.208 (LeftShoulder) | 12.9 (LeftShoulder) | 0.7 (LeftFoot) | 0 |
| Parasite L Starkie | 69 | mixamorig: | 1.131 | 0.304 (LeftFoot) | 18.4 (LeftFoot) | -3.6 (LeftFoot) | 0 |
| Peasant Girl | 69 | mixamorig: | 1.130 | 0.169 (Spine) | 9.7 (Spine) | 1.8 (LeftShoulder) | 0 |
| Peasant Man | 43 | mixamorig: | 0.889 | 0.197 (LeftShoulder) | 13.2 (LeftShoulder) | 1.7 (LeftShoulder) | 24 |
| Pirate By P. Konstantinov | 76 | mixamorig: | 0.371 | 0.709 (LeftFoot) | 47.0 (LeftFoot) | -4.7 (RightShoulder) | 0 |
| Prisoner B Styperek | 47 | mixamorig: | 1.088 | 0.312 (LeftShoulder) | 18.3 (LeftShoulder) | 4.5 (LeftShoulder) | 20 |
| Pumpkinhulk L Shaw | 66 | mixamorig: | 1.013 | 0.416 (LeftShoulder) | 27.3 (LeftShoulder) | 2.6 (LeftShoulder) | 0 |
| Skeletonzombie T Avelange | 73 | mixamorig: | 1.167 | 0.249 (LeftShoulder) | 14.3 (LeftShoulder) | 2.9 (LeftShoulder) | 0 |
| Sporty Granny | 99 | mixamorig: | 0.872 | 0.207 (Spine) | 11.9 (Spine) | 2.2 (RightShoulder) | 0 |
| Survivor A Lusth | 69 | mixamorig: | 1.101 | 0.149 (Spine1) | 8.6 (Spine1) | -0.3 (LeftLeg) | 0 |
| Swat | 69 | mixamorig: | 0.965 | 0.213 (LeftFoot) | 16.6 (LeftFoot) | -1.1 (LeftToeBase) | 0 |
| Ty | 69 | mixamorig: | 0.847 | 0.175 (LeftShoulder) | 11.3 (LeftShoulder) | -2.6 (LeftShoulder) | 0 |
| Uriel A Plotexia | 72 | mixamorig: | 1.095 | 0.286 (LeftFoot) | 17.6 (LeftFoot) | -1.8 (LeftFoot) | 0 |
| Vampire A Lusth | 99 | mixamorig: | 1.218 | 0.354 (LeftShoulder) | 28.2 (LeftShoulder) | 0.9 (LeftShoulder) | 0 |
| Vanguard By T. Choonyung | 65 | mixamorig: | 1.061 | 0.210 (LeftShoulder) | 15.6 (LeftShoulder) | -1.4 (LeftFoot) | 0 |
| Warrok W Kurniawan | 81 | mixamorig: | 0.968 | 0.344 (LeftLeg) | 26.1 (LeftShoulder) | -1.2 (LeftShoulder) | 0 |
| Warzombie F Pedroso | 72 | mixamorig: | 1.035 | 0.322 (LeftShoulder) | 20.1 (LeftShoulder) | 2.8 (LeftShoulder) | 0 |
| Whiteclown N Hallin | 67 | mixamorig: | 1.145 | 0.165 (Spine) | 9.4 (Spine) | 1.0 (LeftShoulder) | 0 |
| Yaku J Ignite | 65 | mixamorig: | 1.103 | 0.193 (LeftShoulder) | 11.1 (LeftShoulder) | -1.1 (LeftFoot) | 0 |
| Zombiegirl W Kurniawan | 63 | mixamorig: | 1.076 | 0.408 (LeftShoulder) | 26.8 (LeftShoulder) | 2.6 (LeftShoulder) | 4 |
| akai_e_espiritu | 65 | mixamorig: | 1.122 | 0.208 (RightShoulder) | 12.3 (RightShoulder) | 7.1 (LeftFoot) | 0 |
| castle_guard_01 | 43 | mixamorig: | 0.999 | 0.413 (LeftShoulder) | 27.0 (LeftShoulder) | 3.2 (LeftFoot) | 24 |
| copzombie_l_actisdato | 67 | mixamorig: | 1.060 | 0.522 (Neck) | 30.6 (Neck) | -10.4 (LeftUpLeg) | 0 |
| exo_red | 112 | mixamorig: | 0.964 | 0.324 (Neck) | 18.6 (Neck) | 4.5 (LeftFoot) | 0 |
| goblin_d_shareyko | 69 | mixamorig: | 0.989 | 0.333 (RightLeg) | 19.8 (LeftLeg) | -14.5 (LeftLeg) | 0 |
