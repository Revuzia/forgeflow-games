# CMU mocap -> HIT PARADE fighting clips

**Status: DONE (2026-09-29).** I mined 84 CMU takes and cut them into 752 single-move segments. 260 of those were checked by eye on stick-figure contact sheets. A working CMU->Mixamo retarget script produced 15 pilot GLBs on X Bot, and I rendered and checked every one.

**Short version:** CMU gives us usable-to-clean sources for jab, cross, hook, body blow, front kick, roundhouse, side kick, knee, getup-from-back, getup-from-front and fall-backward. It gives only *usable* (never clean) uppercuts, one fall-forward (and it is a dive), acrobatic-only spin/jump kicks, and **no usable elbow strike, no hit reactions, no wall-splat, no throws**.

Usage rights: the CMU page (quoted in READMEFIRST.txt, line 177) says the data "is free for use in research and commercial projects worldwide". CMU asks for the acknowledgement "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." That line belongs in the game credits.

---------------------------------------------------------------------------------------------------

## 1. Outputs (all under `_research/animations/`)

| file | what |
|---|---|
| `cmu_segments.json` | Every segment: take, start / contact / end (source frames at 120 fps), final class, quality, auto class, review notes, metrics (peak speed, elbow angle, velocity direction, lead side, foot drift, spike frames, combo contamination). `meta` explains every field. |
| `cmu_segments_auto.json` | Raw classifier output before the review merge. |
| `review_verdicts.json` | My by-eye verdict per reviewed segment (class correction, quality, note), plus 7 hand-cut segments. |
| `best_candidates.json` + `sheets/best_00..11.png` | The curated best list below, as 4-frame contact sheets. |
| `cmu_pilot/p00..p15_*` | Pilot retargets: `.glb` (X Bot mesh plus one 60 fps clip), 12 renders per clip (4 frames x 3 views), `_strip.png` composite, `_report.json` (gate numbers), `pilot_jobs.json`, `pilot_run.log`. |

Tools (ASCII, rerunnable):
- `tools/cmu_retarget.py`: **the retarget** (Blender headless, job file in and GLBs out). Options: `mirror` (swap left and right; turns a southpaw take into an orthodox one), `fist` (constant finger curl).
- `tools/research/bvh_lib.py`: numpy BVH parser + forward kinematics (BVH Y-up units -> Blender Z-up metres, x 0.0254/0.45).
- `tools/research/cmu_segment.py`: strike / getup / fall detection, segmentation, geometric classifier, quality metrics.
- `tools/research/cmu_sheets.py`, `best_sheets.py`, `overview_sheets.py`: contact sheets. `merge_segments.py`: the review merge. `compose_pilot.py`: pilot strips.
- `tools/research/probe_xbot.py`, `probe_fist.py`: rig probes.

Regenerate: `python tools/research/cmu_segment.py _research/animations`, then `python tools/research/merge_segments.py _research/animations`, then `"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python tools/cmu_retarget.py -- _research/animations/cmu_pilot/pilot_jobs.json`.

## 2. Measured facts about the source

- Every candidate take is **120 fps** (Frame Time .0083333). Frame 0 of every file is Hahne's synthetic calibration T-pose (READMEFIRST: "Every BVH file has a T-pose added as its new first frame"). The segmenter never uses frame 0.
- **Duplicate files** (md5 identical): 77_16 = 139_16, 77_17 = 139_17, 77_18 = 139_18, 105_59 = 91_59. Only one copy of each is used.
- The CMU bind pose is **not** a Mixamo T-pose. The thighs splay about 20 deg outward (LeftLeg offset 2.44, -6.70). Several joints have zero length (Hips, LHipJoint, LowerBack, Neck, Spine1, finger bases). LeftHandIndex1 hangs off **LeftFingerBase**, not LeftHand. Mapping the hand to LeftHand gave 28-34 deg errors in the gate until I fixed it.
- Skeleton size differs per subject. Thigh+shin length ratio X Bot/CMU measured 0.988 (subject 86) to 1.192 (subject 144).
- The boxing subjects spend long stretches **southpaw**. All 10 cleanest isolated jabs (other hand below 2 m/s) are right-hand jabs thrown from a right-foot-forward stance. `mirror: true` converts them. Pilots p01 and p02 are mirrored and render as orthodox left jabs.

## 3. How segments were found and rated

1. FK every take. Hand strikes: peaks of fist speed relative to the hips above 2.2 m/s. Kicks: ankle speed above 3.0 m/s. Knees: knee speed above 1.8 m/s. Contact = max reach (arm extension, or hips-to-foot distance plus height). Start = the nearest guard before contact (arm-extension minimum, with hysteresis) or the last frame the kicking foot was planted. End = the next guard or planted frame. Filters drop retractions (arm-extension gain below 10%, horizontal reach gain below 8 cm), steps (foot below 0.30 m), hops, kick chambers, and running (hips above 2 m/s).
2. Geometric class. Punches use the elbow angle at contact, the velocity direction over the last 50 ms (forward / lateral / up), and contact height against the upper chest. Jab vs cross uses the lead foot measured along the fighter's target line. Kicks use the kick direction against the hips facing (front below 50 deg, side above 65 deg), lateral velocity plus hip turn (roundhouse), support-foot height (jump) and yaw span (spin). Getups and falls use hips height crossings, and the chest facing up or down tells back from front.
3. Quality metrics: planted-foot drift (cm of horizontal path while the foot is within 3 cm of the floor), spike frames (a main joint more than 3 cm off its 5-frame median), and other-hand peak speed (combo contamination).
4. **By eye**: 4-frame stick-figure sheets (3/4 view on the striking side, mirrored so forward is always screen-right, plus top and side path panels) for 260 segments. I corrected classes where they were wrong. Examples: 135_11 kicks were side kicks, not front kicks. The 86_08 "jump kicks" are kicks on the toes. 139_18 is a getup from the back. Every karate "body blow" is a low block. 113_13 f1038 "knee" is a kick retraction.

## 4. Best-candidate list (frames = source frames @120 fps; P = retargeted pilot)

Quality: **clean** = reads correctly, whole move, no glitches. **usable** = right move with a caveat (slow, trimmed, combo, casual form, acrobatic).

| move | take | start/contact/end | quality | notes |
|---|---|---|---|---|
| **jab** | 14_02 | 4937/4953/5004 | clean | southpaw, 7.3 m/s, elbow 158 deg -> **P p01 (mirrored)** |
| jab | 13_18 | 1427/1445/1495 | clean | southpaw, 6.5 m/s, elbow 162 deg -> **P p02 (mirrored)** |
| jab | 14_03 | 469/489/546 | clean | southpaw, 6.6 m/s (mirror) |
| jab | 14_02 | 3520/3534/3582 | clean | southpaw, 7.5 m/s (mirror) |
| jab | 17_10 | 1579/1609/1661 | usable | orthodox (no mirror needed), 5.9 m/s, steps after |
| jab | 13_17 | 1191/1211/1275 | usable | orthodox, elbow only 125 deg at contact |
| **cross** | 13_17 | 222/239/300 | clean | 7.6 m/s, elbow 166 deg -> **P p03** |
| cross | 14_02 | 2808/2822/2893 | clean | 8.0 m/s |
| cross | 14_03 | 1748/1763/1822 | clean | 8.2 m/s |
| cross | 14_01 | 2592/2608/2666 | clean | 6.9 m/s |
| **hook** | 14_03 | 4060/4078/4148 | clean | rear right, arm swings wide then across, 8.6 m/s -> **P p04** |
| hook | 79_08 | 256/314/332 | clean | right, 11.7 m/s, big arc -> **P p13** |
| hook | 14_01 | 3490/3509/3565 | clean | orthodox LEAD hook, elbow 95 deg |
| hook | 14_01 | 2857/2917/2986 | clean | wide left hook, 7.4 m/s |
| hook | 14_02 | 1974/1989/2058 | clean | southpaw rear hook, 7.0 m/s |
| **uppercut** | 14_02 | 1704/1759/1831 | usable | southpaw rear, fist waist->chin, elbow 99 deg -> **P p05 (mirrored)** |
| uppercut | 17_10 | 1559/1573/1637 | usable | rear, fist rises 0.33 m, elbow 106 deg |
| uppercut | 14_01 | 2119/2136/2208 | usable | lead shovel, elbow 116 deg |
| uppercut | 13_18 | 55/88/160 | usable | lead, slow 2.9 m/s |
| **body blow** | 14_03 | 3232/3245/3270 | clean | dip + rear straight to the body, 6.8 m/s -> **P p06** (window end cut by the next punch) |
| body blow | 144_14 | 852/891/920 | clean | deep crouch + straight to the body (3.5 m/s) |
| body blow | 144_20 | 680/714/749 | clean | same pattern, right hand |
| body blow | 13_17 | 4603/4620/4692 | usable | lead body shot with a dip |
| **front kick** | 144_05 | 310/360/428 | clean | guard stance, 1.05 m, **returns to stance** -> **P p07** |
| front kick | 135_04 | 337/375/409 | clean | karate mae-geri 1.16 m, steps through |
| front kick | 144_06 | 874/920/986 | clean | 1.27 m, returns to stance |
| front kick | 86_06 | 3450/3509/3579 | clean | push kick (teep) 0.97 m, arms casual |
| front kick | 113_13 | 910/991/1087 | clean | high snap 1.29 m |
| front kick | 144_09 | 855/902/997 | clean | LEFT leg, 1.37 m |
| **roundhouse** | 135_07 | 70/118/173 | clean | head-high 1.38 m, steps through -> **P p08** |
| roundhouse | 135_07 | L 389/442/502, L 1124 (R 772: use 723/772/824; the planted-foot search opened this window at 607) | clean | 3 more from the same take (both legs) |
| roundhouse | 135_01 | 3724/3760/3807 | usable | second take, 1.12 m |
| roundhouse | 144_05 | 1395/1441/1508 | usable | body height 0.57 m; the index calls the take "front kicking", so check before use |
| **side kick** | 135_11 | 577/608/682 | clean | yoko-geri 1.31 m -> **P p14**; 6 more clean in 135_11 (both legs, e.g. L 1278/1307/1375) |
| side kick | 143_24 | 263/297/342 | clean | left, 0.84 m |
| **knee** | 86_06 | 6218/6272/6368 | clean | **clinch knee**: hands grab and pull down, knee to chest -> **P p09** |
| knee | 86_06 | 6473/6527/6627, 6709/6770/6882 | clean | 2 more from the same take |
| knee | 135_02 | 1393/1431/1475 | usable | karate knee lift + step, second take (also 3088/3121/3176) |
| **jump kick** | 90_05 / 90_06 / 90_07 | 252/282/333, 392/435/482, 658/699/748 | usable | airborne turning kicks (support foot 0.69-0.73 m up); flashy special moves only |
| **spin kick** | 88_06 | 11/68/178 | usable | jump spin kick from a crouch (acrobatic) |
| spin kick | 87_01 | 204/256/314 | usable | aerial tornado-style, body near horizontal |
| **getup-back** | 140_08 | 174/534/651 | clean | flat on back -> sit -> crouch -> stand -> **P p10** |
| getup-back | 140_09 | 92/452/622 | clean | same pattern |
| getup-back | 139_18 | 111/361/607 | usable | legs slide 63 cm while pulled in |
| getup-back | 140_03 | 268/628/878 | usable | half on side; still lead-in |
| **getup-front** | 139_16 | 164/234/484 | clean | prone -> all fours -> crouch -> stand, 2.7 s -> **P p11** |
| getup-front | 140_01 | 200/275/678 | clean | prone push-up |
| getup-front | 140_02 | 223/320/768 | clean | feet drift 33 cm |
| getup-front | 139_17 | 183/263/713 | clean | long still lead-in, trim it |
| **fall-backward** | 90_18 | 38/116/198 | clean | rug pull, flat on the back -> **P p15** |
| fall-backward | 90_17 | 340/427/528 | usable | banana-peel slip; lands SEATED |
| **fall-forward** | 90_16 | 375/447/500 | usable | **a forward dive** (airborne start, belly-flop) -> **P p12**; the ONLY forward fall |
| stagger | 104_13 | 60/150/300 | usable | "StumbleWalk": lurch forward, flailing; keeps going to f550 |
| stagger (light) | 91_59 | 30/81/160 | usable | small stumble step and recover |
| extras | 79_94 | 241/321/721 | usable | bodybuilder flexes: **TV-show taunt / victory pose** |
| extras | 18_05 | 121/301/438 | usable | lean-back two-arm pull (grab / throw setup; partner not in file) |
| extras | 74_04, 74_06 | 134/169/192, 149/177/212 | usable | soccer-style **punt**: kick a downed enemy |
| extras | 135_01 | 2968/3019/3081 | usable | knee lift + downward **stamp** (stomp a downed enemy) |
| extras | 135_09 / 135_06 | 289/305/(401), 2034/2053/2125 | usable | karate lunge punch (big step-in straight); 135_09's arm stays out in the kata so the guard search stopped at 310; extend to about 401 by hand |
| extras | 86_06 | 4868/4894/4944 | usable | diagonal downward chop, 9.1 m/s |
| extras | 17_10 | 2129/2176/2197 | usable | duck, then rising hook (counter) |

Coverage requested (at least 2 good sources each): jab, cross, hook, front kick, roundhouse, knee, getup-back and getup-front all have **2 or more**. Uppercut has 4, but all are only **usable**. Roundhouse and knee have their clean sources inside one take each (135_07, 86_06), with usable second takes.

### Moves with NO usable source (say it plainly)
- **Elbow strike: none.** Of 11 contacts with the elbow bent under 85 deg, the best (13_17 f752) reads as a guard/cover as much as an elbow. Rated junk.
- **Clean uppercut: none.** 4 usable, as listed above.
- **Stumble-type fall-forward: none.** 90_16 is a dive. 111_12 and 113_08 are slow deliberate lie-downs.
- **Hit reactions** (head snap, body-hit recoil, knockback), **wall splat, grabs/throws, finishers: none** in CMU. 18_05 is only a pull.
- **Grounded spin/back kick: none**; only the acrobatic 87_01 / 88_06 / 90_05-07.
- Not examined (out of scope, possibly useful): blocks 144_07/08 (Left_Blocks), 144_26/27 (Right_Blocks); 76_02-04 (feint attacks, avoid attacker, guard pose).

## 5. Retarget pilot (`tools/cmu_retarget.py`) - results

Method (the script header has the full math): the driftwake world-space delta, plus a per-bone **rest-alignment rotation C(n)**, the minimal rotation from the CMU rest bone direction to the X Bot rest bone direction. That absorbs the splayed CMU bind pose and the zero-length joints. CMU-only joints (LHipJoint, RHipJoint, LowerBack offset, Neck, finger bases, thumbs) are never mapped. Their rotation is already folded into the children's GLOBAL rotations. The clip is yawed so the attack direction (chest->fist or hips->foot at contact; start facing for falls; final facing for getups) points down Blender -Y (glTF +Z). Root: the mid-hip point is scaled by the thigh+shin ratio, and the vertical is re-based so a planted source ankle lands on X Bot's rest ankle height (0.087 m). Horizontal travel is kept, starting at the origin. Fingers: `fist: 80` curls every finger segment +80 deg about local X; I checked that +X closes into the palm on both hands (close-up render). CMU has no finger data.

**Gate:** on every output frame, the angle between each evaluated X Bot bone axis and the matching source bone direction. **Max 0.000 deg on all 16 clips**, every frame. The gate does catch errors: it read 28-34 deg before the FingerBase fix.

| pilot | source frames | out frames @60 | leg ratio | min foot z (m) | frames foot < -3 cm | hips z at 4 picks (m) |
|---|---|---|---|---|---|---|
| p00 T-pose check | 13_17 f0 | 1 | 1.001 | -0.067 | 1 | 0.94 |
| p01 jab L (mirrored) | 14_02 4937/4953/5004 | 35 | 1.040 | -0.032 | 1 | 0.89/0.93/0.93/0.96 |
| p02 jab L (mirrored) | 13_18 1427/1445/1495 | 35 | 1.008 | 0.027 | 0 | 0.94/0.95/0.93/0.95 |
| p03 cross R | 13_17 222/239/300 | 40 | 1.001 | -0.018 | 0 | 0.91/0.93/0.93/0.95 |
| p04 hook R | 14_03 4060/4078/4148 | 45 | 1.058 | -0.053 | 6 | 0.91/0.93/0.94/0.91 |
| p05 uppercut R (mirrored) | 14_02 1704/1759/1831 | 65 | 1.040 | 0.005 | 0 | 0.99/0.93/0.90/0.92 |
| p06 body blow R | 14_03 3232/3245/3270 | 20 | 1.058 | -0.026 | 0 | 0.87 (all four) |
| p07 front kick R | 144_05 310/360/428 | 60 | 1.192 | 0.005 | 0 | 0.93/1.01/1.05/0.96 |
| p08 roundhouse R | 135_07 70/118/173 | 53 | 1.071 | 0.029 | 0 | 0.83/0.97/1.12/0.86 |
| p09 knee R | 86_06 6218/6272/6368 | 76 | 0.988 | 0.011 | 0 | 0.97/0.95/0.96/0.98 |
| p10 getup back | 140_08 174/534/651 | 240 | 1.152 | 0.039 | 0 | 0.19/0.20/0.44/0.96 |
| p11 getup front | 139_16 164/234/484 | 161 | 1.133 | -0.047 | 45 | 0.03/0.45/0.56/0.90 |
| p12 fall forward | 90_16 375/447/500 | 64 | 1.030 | 0.012 | 0 | 1.55/1.32/0.01/0.11 |
| p13 hook R | 79_08 256/314/332 | 39 | 1.048 | 0.029 | 0 | 1.00/1.00/1.01/1.01 |
| p14 side kick R | 135_11 577/608/682 | 54 | 1.071 | 0.037 | 0 | 0.93/1.03/1.13/0.85 |
| p15 fall backward | 90_18 38/116/198 | 81 | 1.030 | 0.019 | 0 | 0.98/0.90/0.14/0.18 |

What the renders show (I read every `_strip.png`):
- **Pose: right.** The T-pose frame lands as an X Bot T-pose (arms level, legs straight). Jabs and crosses extend fully at head height from guard with the other fist up. Hooks swing out and across the face. The front kick chambers, extends and returns. The roundhouse reaches head height with the support leg straight. The side kick is thrust sideways. The knee is a clinch knee. The getups go lying -> sit / all fours -> crouch -> stand. Fists read as fists.
- **Facing: right.** On every strike the fist or foot at contact points at the red forward post (Blender -Y, glTF +Z). The hips yaw changes through the move as it should (cross: -133 deg at start to -67 deg at contact).
- **Scale: right.** Proportions follow X Bot; the thigh+shin ratio is applied per subject (table).
- **Hips height: right for standing and lying.** X Bot's rest hips head is at 1.043 m. Fighting stances measure 0.87-1.01 m (knees bent, as in the source), a kick at contact rises to 1.05-1.13 m, and lying frames measure 0.01-0.20 m. Feet sit on the floor: after excluding Blender's synthetic Toe_End leaf tail, 12 of 15 motion clips never go more than 3 cm under the floor, and p01 touches -3.2 cm on 1 of 35 frames. **Exceptions:** p04 (toe tip down to -5.3 cm on 6 of 45 frames, pivoting) and the prone getup p11 (pointed toes down to -4.7 cm on 45 of 161 frames). The T-pose frame's feet are 6.7 cm under, because Hahne's frame 0 is synthetic (hips higher than the motion frames imply). Foot IK or a floor clamp in-game would remove the residue.
- **GLBs verified by parsing**: each holds 1 skin, 2 meshes, and 1 animation sampled at 60 fps with rotation, translation and scale channels on 65 nodes. Durations match the windows (for example p01 is 0.583 s / 35 keys and p10 is 4.0 s / 240 keys).

## 6. Caveats and next steps (recommendations)
1. **Use `mirror: true` for the southpaw boxing takes** (13_18, 14_01-03, 15_13 when right-leading). That doubles the clean jab/hook pool for an orthodox hero; mirrored clips could also serve a southpaw enemy.
2. Many windows need trims before shipping: combo contamination (the `other_hand_peak_ms` field; for example 14_01 f996's jab opens on the end of a cross), still lead-ins on getups (139_17, 140_03/04), the p06 end cut by the next punch, and the p05 end drifting into the next punch.
3. The GLBs keep horizontal root travel (lunges, getups step 0.3-1 m). The game can strip it or use it as root motion. The GLBs also carry the X Bot mesh and scale tracks: strip both for production (about 2 MB each now).
4. Source speed varies a lot (144_xx punches 3.0-3.6 m/s; boxers 6-11.7 m/s). Time-scale the slow ones, or prefer subjects 13, 14, 17 and 79 for "fast, brutal".
5. The missing moves (elbow, hit reactions, wall splat, throws, stomp variety, finishers) need another library or hand-keying. Mixamo's own packs are the obvious next place to look.
6. 492 auto segments were not viewed by eye (quality `unreviewed`). Their auto class is a good lead, not a verdict. The sheet tools can render any subset: `cmu_sheets.py <json> <dir> <prefix> 6 "<filter>"`.
