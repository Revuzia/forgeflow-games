# HIT PARADE - Mixamo clip inventory + move mapping

Lane: animations/mixamo. Status: COMPLETE. Every number below is measured (Blender 5.1.2 headless) or
read off a render I inspected this session; the machine-readable version is `mixamo_inventory.json`.
Rig transfer (can these clips go on the character bodies?) is answered in `rig_compat.md`.

## What is in the folder (measured)

- **628 clips in 25 pack dirs**, all 30 fps. **99 are exact duplicates** of a clip in another pack (same frames,
  hips path and effector speeds), so there are **529 distinct motions**. Duplicate sets: Magic_Locomotion_Pack and
  Magic_Spell_Pack are subsets of Pro_Magic_Pack; Sword_and_Shield_Pack = Pro_Sword_and_Shield_Pack minus 2 draw
  clips; Creature_NPC_Pack is a subset of Creature_Pack; Shooter_Pack shares 7 clips with Basic_Shooter_Pack;
  Extra/WithSkin share one breathing idle and Extra holds the skateboard clip twice (skin / no skin).
- **610 clips are on the X Bot skeleton** (65 bones; bind identical to `X Bot.fbx` except one thumb bone, maxdiff
  0.0169). `Extra/` (6) and `WithSkin/` (12) use a different 41-bone rig with the hips rest at z=0 - not X Bot.
- **All 610 X Bot clips carry 195 location + 260 rotation + 195 scale fcurves** (65 bones; counted by
  `mixamo_fcurve_count.py`), but only `Hips` translation varies (627 of 628 clips; `WithSkin/falling_idle_ws70`
  has none). Strip the 64 constant location tracks (and scale tracks) before three.js, or the clip imposes X Bot's
  bone lengths on other bodies (see rig_compat.md).
- **Stances are side-on.** Hips yaw at frame 1 vs the model's forward axis: Pro_Magic idle -58.3 deg, sword & shield
  idle -54.5 deg, axe idle -50.1 deg; Male_Locomotion idle -5.2, mutant idle 0.0. So reach below is measured on the
  MODEL axes (forward = rest toe direction), which is what an auto-facing controller turns toward the target.
- **Root motion** is in the hips track (hips travel columns). Locomotion and many attacks travel; e.g.
  `Creature_Pack/jump attack` moves the hips 2.26 m forward, `Soccer_Game_Pack/throw in` 3.26 m.

## Method

1. `mixamo_inventory.py` samples every integer frame of every clip: timing, hips travel/height, loop error, and the
   speed of hands/feet/knees/elbows/head RELATIVE TO THE HIPS. Automatic contact = the fastest end-effector's
   speed peak, then the first frame it stops extending or drops below 50% of peak; a foot peak with the knee bent
   under 100 deg is re-labelled a knee strike (that is how `kneeing soccerball` came out as `LeftKnee` f13).
2. 209 clips were rendered on the X Bot mesh (6 frames each, contact frames boxed) into
   `renders_mixamo/sheets/xbot_00..34.png`, and 16 ambiguous ones again at 1-4 frame spacing
   (`renders_mixamo/sheets/dense_00..03.png`). I read every sheet; the contact frames in the table are the
   render-judged ones; the Source column says where the automatic pick was wrong.
3. `mixamo_contact_measure.py` then measured the striking part at each judged frame AND scanned frames
   [judged-8, judged+3] for the **front pass**: the frame where the striker is farthest in front of the hips on the
   model forward axis. Sweeping strikes cross the front BEFORE the visible end of the motion: `mutant punch` is a
   right-to-left hook whose fist is 0.62 m in front at f9 (+6 deg) but 68 deg to the LEFT at the judged f11.
   **Use the front-pass frame to time hitboxes for a target straight ahead** (strikes, kicks, knees, swings);
   use the judged frame for floor impacts (slams, ground pound) and releases (throws). Reach is in metres on
   the X Bot (hips 1.04 m): multiply by the body's hip ratio (rig_compat.md).

Columns: **contact** = render-judged frame (time from clip start) and the strike direction there, degrees from
model forward (+ right, - left). **front pass** = measured frame the striker is farthest forward. **reach** =
forward/side/height of the striker at the front pass, metres, + its direction. **travel** = hips start->end on
model axes (fwd/right). **unarmed**: yes / prop (reads as a held-prop move) / no (weapon or shield pose baked in).

## Move-mapping table

### Light strikes

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Rising backfist / backhand slap | `Pro_Melee_Axe_Pack/standing melee attack backhand` | 3.17 (96) | f37 (1.20s) -133 deg | f32 (1.03s) | RightHand | 0.64/+0.21/1.30, +19 deg | +0.01 / +0.02 | 0.88-0.97 | yes | render: rising backhand ends high-behind at f37 (auto; auto LeftHand f26 = windup); hand passes the front at f32 (front pass) |
| Double palm strike to the side | `Pro_Magic_Pack/Standing 2H Magic Attack 01` | 2.67 (81) | f36 (1.17s) +38 deg | f39 (1.27s) | RightHand | 0.90/+0.25/1.16, +15 deg | +0.00 / +0.00 | 0.83-0.97 | yes | auto, confirmed |
| Long spear-hand jab | `Pro_Magic_Pack/Standing 2H Magic Attack 03` | 4.27 (129) | f32 (1.03s) +15 deg | f35 (1.13s) | RightHand | 0.92/+0.18/1.20, +11 deg | -0.00 / +0.00 | 0.80-0.97 | yes | auto, confirmed (straight arm) |
| Palm strike into sweep follow-through | `Pro_Magic_Pack/Standing 1H Magic Attack 02` | 2.20 (67) | f24 (0.77s) -39 deg | f21 (0.67s) | RightHand | 0.78/-0.00/1.17, -0 deg | +0.00 / +0.00 | 0.76-0.95 | yes | auto, confirmed (palm push); the auto f39 follow-through ends behind the body (dropped) |
| Headbutt (WEAK: low amplitude) | `Soccer_Game_Pack/header soccerball` | 1.90 (58) | f27 (0.87s) -176 deg | f30 (0.97s) | Head | -0.24/-0.05/1.75, -169 deg | -0.00 / +0.00 | 0.90-1.03 | yes | dense render + Head speed peak (only 1.14 m/s); head stays BEHIND the hips at contact (reach -0.34 m); not recommended; zombie neck bite has a stronger head lunge |
| Wild one-arm swing (feral thug) | `Scary_Zombie_Pack/zombie attack` | 2.50 (76) | f30 (0.97s) +54 deg | f33 (1.07s) | RightHand | 0.86/-0.08/1.21, -5 deg | +0.01 / -0.00 | 0.86-0.98 | yes | dense render (arm fully extended f30; auto f35 late) |

### Heavy strikes

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Haymaker hook (the reference's big hook) | `Pro_Melee_Axe_Pack/standing melee attack horizontal` | 2.40 (73) | f28 (0.90s) +27 deg | f29 (0.93s) | RightHand | 0.77/+0.01/1.15, +1 deg | -0.00 / +0.01 | 0.80-0.91 | yes | dense render (auto f30 = end of sweep); swing carries axe weight; fist reads as grip |
| Overhead hammer-fist / 1H sledgehammer smash | `Pro_Melee_Axe_Pack/standing melee attack downward` | 2.27 (69) | f26 (0.83s) +3 deg | f26 (0.83s) | RightHand | 0.82/+0.04/1.10, +3 deg | +0.00 / -0.00 | 0.88-0.95 | yes | auto, confirmed in render (arm at bottom of chop); also a stomp-alternative on a doubled-over enemy |
| Spinning backfist (stance version) | `Pro_Magic_Pack/Standing 1H Magic Attack 01` | 2.30 (70) | f26 (0.83s) +23 deg | f29 (0.93s) | RightHand | 0.86/+0.01/1.22, +1 deg | +0.01 / -0.00 | 0.83-0.93 | yes | auto, confirmed (arms flung wide) |
| Crouch-and-rise uppercut (proposal) | `Pro_Magic_Pack/Standing 2H Magic Attack 05` | 3.53 (107) | f22 (0.70s) +45 deg<br>f64 (2.10s) +19 deg | f25 (0.80s)<br>f65 (2.13s) | RightHand | 0.64/+0.30/0.33, +25 deg<br>0.52/+0.03/1.33, +3 deg | +0.00 / -0.00 | 0.51-0.97 | yes | auto; render shows hand to floor f22, rising arm f64; needs trimming |
| Brute heavy hook, right-to-left (enemy / boss) | `Creature_Pack/mutant punch` | 1.10 (34) | f11 (0.33s) -68 deg | f9 (0.27s) | RightHand | 0.62/+0.07/0.83, +6 deg | -0.00 / +0.00 | 0.76-0.91 | yes | auto f11 (arm fully extended, render) = END of the hook, 68 deg to the left; fist passes the front at f9 (front pass); rig-proof clip; hunched stance: hips start 0.911 m vs 1.043 rest |
| Overhead claw haymaker (brute) | `Creature_Pack/mutant swiping` | 2.40 (73) | f41 (1.33s) +17 deg | f41 (1.33s) | LeftHand | 0.80/+0.25/0.87, +17 deg | -0.00 / -0.04 | 0.70-0.96 | yes | dense render (torso whips down f40, reach f42; speed peak f39) |

### Kicks

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Front push kick (knockback into wall-splat) | `Pro_Melee_Axe_Pack/standing melee attack kick ver. 1` | 1.87 (57) | f19 (0.60s) +8 deg | f22 (0.70s) | RightFoot | 0.97/+0.10/1.16, +6 deg | -0.00 / +0.00 | 0.88-1.03 | yes | auto, confirmed (leg fully extended) |
| Front snap kick | `Pro_Melee_Axe_Pack/standing melee attack kick ver. 2` | 1.40 (43) | f21 (0.67s) +7 deg | f24 (0.77s) | RightFoot | 1.01/+0.01/1.12, +1 deg | -0.00 / +0.00 | 0.88-0.94 | yes | auto, confirmed |
| Punt kick on a doubled-over / downed enemy | `Soccer_Game_Pack/goalkeeper drop kick` | 3.90 (118) | f65 (2.13s) +12 deg | f66 (2.17s) | RightFoot | 0.95/-0.08/0.79, -5 deg | +3.46 / +0.23 | 0.82-1.17 | yes | auto, confirmed (leg extended forward-up); trim the ball-drop lead-in (starts ~f57) |
| Run-up field-goal punt (finisher on downed enemy) | `Soccer_Game_Pack/soccer penalty kick` | 1.50 (46) | f25 (0.80s) +23 deg | f27 (0.87s) | RightFoot | 0.84/+0.11/0.42, +7 deg | +3.01 / +0.80 | 0.87-1.01 | yes | auto, confirmed |
| Running kick | `Soccer_Game_Pack/strike foward jog` | 1.27 (39) | f15 (0.47s) +4 deg | f18 (0.57s) | RightFoot | 1.08/-0.10/1.15, -5 deg | +3.06 / -0.00 | 0.89-1.21 | yes | auto, confirmed |
| Toe-poke / low kick on downed (weak) | `Soccer_Game_Pack/kick soccerball` | 0.57 (18) | f8 (0.23s) -15 deg | f11 (0.33s) | LeftFoot | 0.87/-0.20/0.45, -13 deg | +0.00 / -0.00 | 0.93-1.01 | yes | auto, render shows small side-foot pass; low amplitude |
| Front kick (right) | `Pro_Sword_and_Shield_Pack/sword and shield kick` | 1.20 (37) | f17 (0.53s) +3 deg | f19 (0.60s) | RightFoot | 1.06/+0.13/1.05, +7 deg | +0.00 / +0.00 | 0.88-1.03 | yes | dense render (extended f16-18; foot speed peak f14); left forearm held forward (shield side) - mild |

### Knees

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Clinch / grab KNEE STRIKE (left) | `Soccer_Game_Pack/kneeing soccerball` | 0.90 (28) | f13 (0.40s) -20 deg | f16 (0.50s) | LeftKnee | 0.42/-0.14/0.89, -18 deg | -0.00 / -0.00 | 0.98-1.01 | yes | auto hit list + rig-proof render (sheet's LeftFoot f24 pick is the foot re-planting); knee 0.742 m high, 0.388 m ahead of hips at f13 |
| Knee strike (right, quick) | `Soccer_Game_Pack/kneeing soccerball (2)` | 0.60 (19) | f9 (0.27s) +23 deg | f7 (0.20s) | RightKnee | 0.41/+0.18/0.93, +24 deg | -0.00 / -0.01 | 0.97-1.01 | yes | dense render (knee at hip height f9-13; auto speed peak f5) |

### Slams, sweeps, spins (AoE)

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Spinning backfist / spinning clothesline (360 AoE) | `Pro_Melee_Axe_Pack/standing melee attack 360 high` | 3.17 (96) | f33 (1.07s) +46 deg | f32 (1.03s) | RightHand | 0.74/+0.10/1.15, +8 deg | -0.03 / +0.01 | 0.81-1.00 | yes | auto, confirmed (arms flung wide mid-spin); reference shows a spinning back-fist |
| Running leap double-axe-handle / sledgehammer leap slam | `Pro_Melee_Axe_Pack/standing melee run jump attack` | 3.67 (111) | f53 (1.73s) -2 deg | f52 (1.70s) | LeftHand | 0.93/-0.02/0.88, -1 deg | +3.72 / +0.00 | 0.57-2.12 | yes | auto, confirmed (crouched landing smash); hands meet overhead in the leap; also a ground-slam finisher |
| Double-fist GROUND POUND (AoE shockwave; also stomp alt on downed) | `Pro_Magic_Pack/Standing 2H Magic Area Attack 01` | 2.97 (90) | f40 (1.30s) +45 deg | f38 (1.23s) | RightHand | 0.55/+0.49/1.02, +42 deg | +0.01 / -0.00 | 0.58-1.01 | yes | dense render (hands reach floor f40; auto f39) |
| Rage burst (arms flung wide, radial push) | `Pro_Magic_Pack/Standing 2H Magic Area Attack 02` | 3.13 (95) | f56 (1.83s) +105 deg | f48 (1.57s) | RightHand | 0.53/+0.07/1.16, +8 deg | -0.00 / +0.00 | 0.70-1.01 | yes | auto, confirmed (T-shape burst); pair with ratings-meter special |
| Bicycle flip-kick finisher (airborne, overhead) | `Soccer_Game_Pack/scissor kick` | 2.77 (84) | f25 (0.80s) +38 deg | f23 (0.73s) | RightFoot | 0.87/+0.25/1.33, +16 deg | -0.27 / -0.20 | 0.14-1.17 | yes | auto, confirmed (foot at top); lands on back, standing by f84 |
| Slide-tackle leg sweep (knockdown) | `Soccer_Game_Pack/soccer tackle` | 2.73 (83) | f27 (0.87s) -140 deg | f21 (0.67s) | legs (feet-first slide) | 0.85/-0.37/0.45, -23 deg | +3.95 / -0.78 | 0.16-0.98 | yes | dense render (legs along floor f26-28; auto RightFoot f21 = before slide) |
| Diving slide takedown | `Soccer_Game_Pack/soccer tackle (2)` | 1.77 (54) | f19 (0.60s) -146 deg | f11 (0.33s) | body | -0.12/-0.15/0.81, -130 deg | +4.62 / -0.02 | 0.24-0.97 | yes | render (on the floor sliding at f19); up by f47 |
| Leap GROUND SLAM (boss) | `Creature_Pack/jump attack` | 3.80 (115) | f51 (1.67s) -9 deg | f51 (1.67s) | LeftHand | 0.71/-0.11/0.40, -9 deg | +2.26 / -0.14 | 0.47-2.58 | yes | auto, confirmed (crouched landing, hands to floor); hips travel 2.26 m forward |
| Leap ground slam (in-place variant) | `Creature_Pack/mutant jump attack` | 3.70 (112) | f51 (1.67s) -8 deg | f51 (1.67s) | LeftHand | 0.69/-0.10/0.32, -8 deg | +1.74 / -0.16 | 0.47-2.58 | yes | auto, confirmed |
| Spinning sweep AoE - ENTER (stand to flair) | `Breakdance_Pack/flair (3)` | 1.67 (51) | f36 (1.17s) +178 deg<br>f43 (1.40s) +45 deg | f29 (0.93s)<br>f46 (1.50s) | legs | 0.53/+0.58/0.03, +48 deg<br>1.03/-0.19/0.11, -11 deg | +0.59 / -0.91 | 0.33-0.99 | yes | auto, legs out on hands at f36-43; chain: flair (3) -> flair (2) loop -> flair (exit) |
| Spinning sweep AoE - LOOP (legs at hip height all loop) | `Breakdance_Pack/flair (2)` | 1.00 (31) | - | - | - | - | -0.00 / +0.00 | 0.35-0.75 | yes | dense render (legs circle continuously); LeftFoot peak 12.06 m/s |
| Spinning sweep AoE - EXIT to standing | `Breakdance_Pack/flair` | 2.47 (75) | f5 (0.13s) +32 deg | f6 (0.17s) | legs | 0.99/+0.31/0.13, +17 deg | +0.15 / +0.04 | 0.35-1.08 | yes | auto; standing by f75 |
| Swipes spin-kick AoE (legs whip at hip-to-head height) | `Breakdance_Pack/breakdance swipes` | 3.00 (91) | f75 (2.47s) -27 deg<br>f79 (2.60s) -38 deg | f76 (2.50s)<br>f81 (2.67s) | LeftFoot/RightFoot | 0.82/-0.20/0.97, -14 deg<br>0.90/-0.23/0.51, -14 deg | -0.13 / -0.46 | 0.65-1.04 | yes | dense render (strike window f70-82; auto LeftHand f88 is not the strike) |
| Floor leg sweep (ankle-level trip AoE) | `Breakdance_Pack/breakdance footwork 1` | 3.17 (96) | f56 (1.83s) -147 deg<br>f72 (2.37s) +46 deg | f49 (1.60s)<br>f74 (2.43s) | LeftFoot | 0.25/-0.11/0.04, -24 deg<br>0.60/+0.46/0.05, +37 deg | +0.00 / +0.00 | 0.28-0.69 | yes | dense render (legs flat on floor f54-58, f74-78) |
| Floor sweep variant | `Breakdance_Pack/breakdance footwork 2` | 1.60 (49) | f11 (0.33s) -133 deg | f5 (0.13s) | legs | 0.51/-0.70/0.04, -54 deg | -0.00 / +0.00 | 0.29-0.71 | yes | render (leg extended on floor f11) |

### Grabs, shoves, throws, pick-ups

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Double-palm shove (push into wall / hazard) | `Pro_Magic_Pack/Standing 2H Magic Attack 02` | 2.63 (80) | f40 (1.30s) +4 deg | f43 (1.40s) | LeftHand | 0.92/-0.11/1.17, -7 deg | +0.01 / +0.00 | 0.82-0.95 | yes | auto, confirmed (two-hand thrust) |
| Flying spear tackle | `Soccer_Game_Pack/soccer tackle (3)` | 2.30 (70) | f15 (0.47s) +33 deg | f18 (0.57s) | body | 0.20/+0.16/1.17, +39 deg | +0.00 / +0.00 | 0.18-1.16 | yes | dense render (body horizontal f13-17; auto RightFoot f11 = take-off) |
| Overhead two-hand ENEMY THROW | `Soccer_Game_Pack/throw in` | 2.77 (84) | f50 (1.63s) +9 deg | f50 (1.63s) | RightHand | 0.81/+0.12/1.19, +9 deg | +3.26 / +0.42 | 0.82-1.04 | yes | auto, confirmed (release); hands overhead f42-47 = hold point for the victim |
| One-arm overhand prop throw (bottle / brick) | `Soccer_Game_Pack/goalkeeper overhand throw` | 2.83 (86) | f49 (1.60s) -14 deg | f48 (1.57s) | RightHand | 0.94/-0.07/1.24, -5 deg | +3.93 / -0.03 | 0.86-0.98 | prop | auto, confirmed (release); has a run-up (hips travel forward) |
| Underarm bowl (roll a prop / hazard) | `Soccer_Game_Pack/goalkeeper pass` | 3.13 (95) | f39 (1.27s) +14 deg | f40 (1.30s) | RightHand | 0.71/+0.17/0.34, +13 deg | +0.82 / -0.13 | 0.66-0.97 | prop | render (low forward release) |
| Pick up prop / enemy from floor, carry at chest | `Soccer_Game_Pack/goalkeeper scoop` | 2.50 (76) | - | - | - | - | +4.03 / +0.50 | 0.72-0.96 | yes | render |
| Low two-hand grab (pick-up) | `Soccer_Game_Pack/goalkeeper catch` | 2.03 (62) | - | - | - | - | +0.93 / +0.78 | 0.81-0.98 | yes | render |
| Clinch GRAB + headbutt (enemy grab move) | `Scary_Zombie_Pack/zombie neck bite` | 4.07 (123) | f23 (0.73s) +31 deg<br>f29 (0.93s) -25 deg | f25 (0.80s)<br>f32 (1.03s) | RightHand/Head | 0.55/+0.30/1.30, +29 deg<br>0.43/-0.01/1.48, -2 deg | -0.00 / -0.01 | 0.80-0.96 | yes | auto, confirmed (arms reach f23, head lunge f29); shoves away f93-107 |
| Kneel over downed body (feral enemy only) | `Scary_Zombie_Pack/zombie biting` | 6.60 (199) | f28 (0.90s) +41 deg | f27 (0.87s) | Head | 0.58/+0.42/0.61, +36 deg | -0.00 / -0.01 | 0.37-0.95 | yes | auto, render (head to floor); head-bite read; not a hero move |

### One-handed prop moves (pipe)

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Spinning low pipe swing (shin-level AoE) | `Pro_Melee_Axe_Pack/standing melee attack 360 low` | 2.50 (76) | f30 (0.97s) +11 deg | f30 (0.97s) | RightHand | 0.71/+0.14/0.68, +11 deg | +0.00 / +0.00 | 0.81-1.04 | prop | auto, confirmed (crouched, arms low); low spin reads weak without a prop |
| 2-swing pipe string | `Pro_Melee_Axe_Pack/standing melee combo attack ver. 1` | 4.67 (141) | f64 (2.10s) -91 deg<br>f95 (3.13s) +178 deg | f60 (1.97s)<br>f88 (2.90s) | RightHand | 0.75/-0.17/1.10, -13 deg<br>0.61/+0.15/1.34, +14 deg | +1.56 / -0.00 | 0.83-0.99 | prop | auto, strong swings visible in render; 141 frames long (4.7 s) |
| 3-swing pipe string | `Pro_Melee_Axe_Pack/standing melee combo attack ver. 2` | 4.20 (127) | f30 (0.97s) +19 deg<br>f59 (1.93s) +11 deg<br>f80 (2.63s) +0 deg | f30 (0.97s)<br>f60 (1.97s)<br>f80 (2.63s) | RightHand/LeftHand/RightHand | 0.72/+0.24/0.97, +19 deg<br>0.55/+0.31/0.89, +29 deg<br>0.95/+0.00/0.84, +0 deg | +0.00 / -0.00 | 0.75-0.94 | prop | auto, swings visible |
| 2-swing pipe string (short) | `Pro_Melee_Axe_Pack/standing melee combo attack ver. 3` | 2.73 (83) | f31 (1.00s) -10 deg<br>f53 (1.73s) +128 deg | f30 (0.97s)<br>f49 (1.60s) | RightHand | 0.72/+0.30/0.98, +23 deg<br>0.43/+0.10/1.05, +13 deg | +0.00 / -0.00 | 0.79-0.89 | prop | auto, swings visible |
| 1H pipe horizontal swing | `Pro_Sword_and_Shield_Pack/sword and shield attack (2)` | 1.30 (40) | f19 (0.60s) +28 deg | f18 (0.57s) | RightHand | 0.76/-0.07/1.24, -5 deg | +2.64 / -1.13 | 0.82-0.94 | prop | auto, confirmed; left arm tucked (shield side) |
| Lunge thrust (pipe / knife) | `Pro_Sword_and_Shield_Pack/sword and shield attack (3)` | 1.73 (53) | f23 (0.73s) -39 deg | f24 (0.77s) | RightHand | 0.77/-0.05/0.70, -4 deg | +2.41 / +0.01 | 0.65-0.93 | prop | auto; full extension at f28 in render |
| 1H vertical chop | `Pro_Sword_and_Shield_Pack/sword and shield slash` | 1.50 (46) | f20 (0.63s) -24 deg | f19 (0.60s) | RightHand | 0.83/+0.15/1.06, +10 deg | +0.00 / -0.00 | 0.76-0.88 | prop | auto, render (chop down f17-20) |
| 4-swing 1H combo | `Pro_Sword_and_Shield_Pack/sword and shield slash (2)` | 3.53 (107) | f22 (0.70s) +4 deg<br>f38 (1.23s) +9 deg<br>f49 (1.60s) -41 deg<br>f76 (2.50s) +28 deg | f22 (0.70s)<br>f38 (1.23s)<br>f52 (1.70s)<br>f74 (2.43s) | RightHand/RightHand/LeftHand/RightHand | 0.81/+0.05/1.08, +4 deg<br>0.82/+0.14/0.99, +9 deg<br>0.73/+0.12/1.13, +10 deg<br>0.55/+0.14/1.04, +14 deg | +2.45 / -0.02 | 0.45-1.38 | prop | auto, render |
| Rising 1H swing | `Pro_Sword_and_Shield_Pack/sword and shield slash (3)` | 1.57 (48) | f25 (0.80s) -5 deg | f25 (0.80s) | RightHand | 0.69/-0.06/1.21, -5 deg | +0.01 / +0.00 | 0.86-1.01 | prop | auto, render (arm high f30) |
| Hop overhead chop (landing) | `Pro_Sword_and_Shield_Pack/sword and shield attack` | 2.33 (71) | f41 (1.33s) +94 deg | f35 (1.13s) | RightHand | 0.70/+0.18/1.59, +14 deg | +3.63 / +0.01 | 0.38-1.82 | prop | auto LeftHand f41 = crouched landing (render); weapon hand measured |

### Two-handed prop moves (bat / sledgehammer)

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Bat / pipe overhead-diagonal chop (2H) | `Great_Sword_Pack/great sword slash` | 1.27 (39) | f22 (0.70s) -50 deg | f19 (0.60s) | RightHand | 0.67/-0.11/1.38, -9 deg | +0.00 / +0.00 | 0.85-0.99 | no | auto, render (hands low-left at f22 = end of chop); 2H grip measured |
| Bat horizontal swing (2H) | `Great_Sword_Pack/great sword slash (3)` | 1.83 (56) | f24 (0.77s) -82 deg | f27 (0.87s) | LeftHand | 0.42/-0.33/0.81, -38 deg | -0.01 / +0.00 | 0.79-1.00 | no | auto, render |
| Sledgehammer overhead chop | `Great_Sword_Pack/great sword slash (4)` | 1.80 (55) | f42 (1.37s) +15 deg | f43 (1.40s) | RightHand | 0.54/+0.12/1.32, +12 deg | +1.15 / -0.00 | 0.90-0.99 | no | dense render (impact f41-43; auto f25 = windup) |
| 3-swing 2H combo | `Great_Sword_Pack/great sword slash (2)` | 3.53 (107) | f26 (0.83s) -13 deg<br>f59 (1.93s) +77 deg<br>f80 (2.63s) -45 deg | f25 (0.80s)<br>f53 (1.73s)<br>f81 (2.67s) | RightHand/LeftHand/RightHand | 0.65/+0.02/1.30, +2 deg<br>0.49/-0.28/0.83, -29 deg<br>0.36/-0.12/1.09, -18 deg | +3.16 / -0.00 | 0.81-1.05 | no | auto, render |
| Low crouch swing (2H) | `Great_Sword_Pack/great sword slash (5)` | 1.43 (44) | f13 (0.40s) +14 deg | f16 (0.50s) | RightKnee(auto)/hands | 0.46/-0.02/0.46, -3 deg | +0.02 / +0.00 | 0.49-0.62 | no | auto, render (low lunge) |
| Bat 360 swing AoE | `Great_Sword_Pack/great sword high spin attack` | 1.87 (57) | f18 (0.57s) -143 deg | f11 (0.33s) | RightHand | 0.62/-0.28/1.49, -24 deg | +2.38 / -0.01 | 0.89-1.05 | no | auto, render (arms extended at chest) |
| Leaping 2H overhead smash | `Great_Sword_Pack/great sword jump attack` | 2.17 (66) | f16 (0.50s) -165 deg<br>f34 (1.10s) -37 deg | f8 (0.23s)<br>f33 (1.07s) | LeftHand | 0.06/-0.36/0.95, -81 deg<br>0.58/-0.34/1.26, -31 deg | +3.25 / +0.08 | 0.89-1.22 | no | auto, render (chop f16, landing f34) |
| Sledgehammer GROUND SMASH (overhead into floor) | `Great_Sword_Pack/great sword casting` | 4.80 (145) | f72 (2.37s) -6 deg | f69 (2.27s) | hands | 0.81/-0.11/0.84, -8 deg | -0.00 / +0.00 | 0.55-1.00 | no | dense render (hands reach floor f72; auto f67) |
| Sliding low swing (2H) | `Great_Sword_Pack/great sword slide attack` | 2.13 (65) | f28 (0.90s) +90 deg<br>f41 (1.33s) -49 deg | f20 (0.63s)<br>f38 (1.23s) | hands | 0.18/+0.22/0.82, +50 deg<br>0.58/-0.01/0.82, -1 deg | +3.56 / +0.07 | 0.36-0.99 | no | auto, render (kneeling lunge f28-41) |
| Bat-butt jab / 2H thrust | `Great_Sword_Pack/great sword attack` | 1.20 (37) | f16 (0.50s) +28 deg | f17 (0.53s) | RightHand | 0.56/+0.22/1.38, +22 deg | +0.00 / -0.00 | 0.89-1.00 | no | auto, confirmed |
| Kick while holding a 2H weapon | `Great_Sword_Pack/great sword kick` | 1.50 (46) | f17 (0.53s) +41 deg | f19 (0.60s) | RightFoot | 1.07/+0.09/1.01, +5 deg | +0.00 / -0.00 | 0.94-1.04 | no | dense render (leg extended f16-18; auto f20); hands clasped at chest |
| Knee-chamber push kick holding 2H weapon | `Great_Sword_Pack/great sword kick (2)` | 1.73 (53) | f23 (0.73s) -6 deg | f25 (0.80s) | LeftFoot | 1.04/-0.04/1.27, -2 deg | -0.00 / -0.00 | 0.87-1.03 | no | auto, confirmed |
| 2H weapon block (bat held horizontal) | `Great_Sword_Pack/great sword blocking` | 0.50 (16) | - | - | - | - | -0.02 / +0.10 | 0.76-0.99 | no | render |
| 2H weapon idle | `Great_Sword_Pack/great sword idle` | 2.00 (61) | - | - | - | - | +0.00 / +0.00 | 0.99-0.99 | no | render |
| Gut-hit react while holding 2H weapon | `Great_Sword_Pack/great sword impact (2)` | 1.20 (37) | - | - | - | - | -0.00 / +0.00 | 0.79-0.99 | no | render |

### Hit reactions

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Heavy head-hit react (from left) | `Pro_Melee_Axe_Pack/standing react large from left` | 1.00 (31) | - | - | - | - | +0.01 / +0.00 | 0.86-0.90 | yes | render; recovers by f31 |
| Heavy head-hit react (from right) | `Pro_Melee_Axe_Pack/standing react large from right` | 1.70 (52) | - | - | - | - | -0.01 / -0.00 | 0.87-0.88 | yes | render; recovers by f52 |
| Body-blow fold (doubles the thug over; opens knee/punt follow-ups) | `Pro_Melee_Axe_Pack/standing react large gut` | 1.47 (45) | - | - | - | - | +0.00 / -0.02 | 0.88-0.92 | yes | render; folded f10-27, recovers f45 |
| Light hit react - front | `Pro_Magic_Pack/Standing React Small From Front` | 1.17 (36) | - | - | - | - | +0.00 / +0.00 | 0.92-0.95 | yes | render |
| Light hit react - back | `Pro_Magic_Pack/Standing React Small From Back` | 1.27 (39) | - | - | - | - | -0.00 / +0.00 | 0.92-0.96 | yes | render |
| Light hit react - left | `Pro_Magic_Pack/Standing React Small From Left` | 1.20 (37) | - | - | - | - | -0.00 / +0.00 | 0.90-0.94 | yes | render |
| Light hit react - right | `Pro_Magic_Pack/Standing React Small From Right` | 0.97 (30) | - | - | - | - | -0.00 / -0.00 | 0.93-0.95 | yes | render |
| Heavy hit react - front | `Pro_Magic_Pack/Standing React Large From Front` | 1.37 (42) | - | - | - | - | -1.13 / +0.00 | 0.88-0.96 | yes | render |
| Heavy hit react - back (pitched forward) | `Pro_Magic_Pack/Standing React Large From Back` | 1.67 (51) | - | - | - | - | +1.62 / -0.00 | 0.79-0.98 | yes | render |
| Heavy hit react - left | `Pro_Magic_Pack/Standing React Large From Left` | 1.33 (41) | - | - | - | - | -0.01 / +1.26 | 0.85-0.95 | yes | render |
| Heavy hit react - right | `Pro_Magic_Pack/Standing React Large From Right` | 1.63 (50) | - | - | - | - | -0.00 / -1.12 | 0.92-0.98 | yes | render |
| Body-blow fold react | `Pro_Sword_and_Shield_Pack/sword and shield impact (2)` | 0.97 (30) | - | - | - | - | -0.00 / +0.00 | 0.87-0.94 | yes | render |
| (unusable) | `Basic_Shooter_Pack/hit reaction` | 0.43 (14) | - | - | - | - | +0.00 / +0.00 | 0.98-1.00 | no | render; rifle-hold pose throughout |

### Blocks

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| High cover-up guard (hold) | `Pro_Melee_Axe_Pack/standing block idle` | 1.67 (51) | - | - | - | - | -0.00 / +0.00 | 0.74-0.79 | yes | render; hands at face; right hand curled like a grip |
| Guard knocked back (block stagger) | `Pro_Melee_Axe_Pack/standing block react large` | 1.00 (31) | - | - | - | - | -0.01 / -0.03 | 0.69-0.75 | yes | render |
| Crossed-forearm guard - enter | `Pro_Magic_Pack/Standing Block Start` | 0.50 (16) | - | - | - | - | -0.06 / +0.11 | 0.85-0.93 | yes | render |
| Crossed-forearm guard - hold | `Pro_Magic_Pack/Standing Block Idle` | 2.77 (84) | - | - | - | - | +0.00 / -0.00 | 0.83-0.87 | yes | render |
| Guard hit / chip stagger | `Pro_Magic_Pack/Standing Block React Large` | 1.30 (40) | - | - | - | - | -0.00 / -0.00 | 0.85-0.90 | yes | render |
| Crossed-forearm guard - exit | `Pro_Magic_Pack/Standing Block End` | 1.20 (37) | - | - | - | - | +0.07 / -0.11 | 0.85-0.92 | yes | render |
| Shield block | `Pro_Sword_and_Shield_Pack/sword and shield block` | 0.57 (18) | - | - | - | - | +0.26 / +0.03 | 0.76-0.88 | no | render; left forearm held flat forward = shield pose |

### Knockdowns / KOs

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| KO - falls face-down | `Pro_Magic_Pack/Standing React Death Forward` | 3.67 (111) | - | - | - | - | +1.37 / +0.06 | 0.13-1.01 | yes | render; knees f45, prone f89; ends face DOWN (prone) (measured chest-forward z -0.99, hips 0.13 m) |
| KO - falls onto back | `Pro_Magic_Pack/Standing React Death Backward` | 3.53 (107) | - | - | - | - | -0.89 / +0.12 | 0.13-0.98 | yes | render; lying from f86; ends face UP (on back) (measured chest-forward z +1.00, hips 0.13 m) |
| KO - twists and lands on back (hit from left) | `Pro_Magic_Pack/Standing React Death Left` | 3.43 (104) | - | - | - | - | -0.13 / -0.97 | 0.13-0.98 | yes | render; lying from f83; ends face UP (on back) (measured chest-forward z +0.98, hips 0.12 m) |
| KO - kneels, then falls face-down (hit from right) | `Pro_Magic_Pack/Standing React Death Right` | 3.50 (106) | - | - | - | - | +0.24 / +1.37 | 0.12-0.93 | yes | render; on floor from f64; ends face DOWN (prone) (measured chest-forward z -0.96, hips 0.13 m) |
| Swept-leg victim (falls, ends prone-propped like fallen idle) | `Soccer_Game_Pack/soccer trip` | 1.53 (47) | - | - | - | - | +4.07 / +1.23 | 0.19-0.97 | yes | render; pair with sweeps/slide tackle; ends face DOWN (prone) (measured chest-forward z -0.64, hips 0.21 m) |
| Heavy KO - staggers back, lands on back | `Creature_Pack/mutant dying` | 3.47 (105) | - | - | - | - | -0.99 / +0.05 | 0.16-0.91 | yes | render; on floor from f84; ends face UP (on back) (measured chest-forward z +0.96, hips 0.20 m) |
| KO from 2H stance (folds, lands on back) | `Great_Sword_Pack/two handed sword death` | 2.40 (73) | - | - | - | - | -0.87 / +0.00 | 0.12-0.99 | no | render; starts in 2H grip; ends face UP (on back) (measured chest-forward z +0.96, hips 0.13 m) |
| Theatrical KO (arms flung up, lands on back) | `Pro_Sword_and_Shield_Pack/sword and shield death` | 2.30 (70) | - | - | - | - | -1.26 / -0.04 | 0.14-0.96 | yes | render; on floor from f56; ends face UP (on back) (measured chest-forward z +0.99, hips 0.15 m) |
| KO fold forward (curled on floor) | `Rifle_8-Way_Locomotion_Pack/death from the front` | 3.43 (104) | - | - | - | - | +1.05 / -0.27 | 0.20-1.06 | yes | render; first ~10 frames in a rifle-carry pose: crossfade from f10; ends on side / sitting (measured chest-forward z -0.24, hips 0.21 m) |
| KO pitched forward (hit from behind) | `Rifle_8-Way_Locomotion_Pack/death from the back` | 2.97 (90) | - | - | - | - | +1.14 / -0.27 | 0.17-1.01 | yes | render; rifle-carry start; ends on side / sitting (measured chest-forward z +0.05, hips 0.22 m) |
| KO fall sideways | `Rifle_8-Way_Locomotion_Pack/death from right` | 3.30 (100) | - | - | - | - | -0.10 / -0.90 | 0.14-0.98 | yes | render; rifle-carry start; ends on side / sitting (measured chest-forward z +0.44, hips 0.21 m) |
| KO collapse (head hit) | `Rifle_8-Way_Locomotion_Pack/death from front headshot` | 2.83 (86) | - | - | - | - | -0.26 / +0.30 | 0.14-0.99 | yes | render; rifle-carry start; ends face UP (on back) (measured chest-forward z +0.92, hips 0.14 m) |
| KO to knees then forward | `Rifle_8-Way_Locomotion_Pack/death from back headshot` | 3.70 (112) | - | - | - | - | +0.98 / +0.05 | 0.16-0.98 | yes | render; rifle-carry start; ends face DOWN (prone) (measured chest-forward z -0.90, hips 0.19 m) |
| KO from crouch | `Rifle_8-Way_Locomotion_Pack/death crouching headshot front` | 1.90 (58) | - | - | - | - | +0.96 / +0.12 | 0.11-0.85 | yes | render; rifle-carry start; ends face DOWN (prone) (measured chest-forward z -0.99, hips 0.14 m) |
| KO flail, falls on back | `Scary_Zombie_Pack/zombie death` | 2.80 (85) | - | - | - | - | -1.04 / +0.15 | 0.13-0.97 | yes | render; ends face UP (on back) (measured chest-forward z +0.98, hips 0.18 m) |

### Downed states

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Downed idle loop (target for stomps/punts/finishers) | `Soccer_Game_Pack/fallen idle` | 1.30 (40) | - | - | - | - | -0.00 / -0.00 | 0.21-0.22 | yes | render; ends face DOWN (prone) (measured chest-forward z -0.60, hips 0.21 m) |
| Beaten enemy crawls away (finisher target) | `Scary_Zombie_Pack/zombie crawl` | 5.13 (155) | - | - | - | - | +2.22 / +0.00 | 0.09-0.26 | yes | render; ends face DOWN (prone) (measured chest-forward z -0.77, hips 0.15 m) |

### Getups

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Getup from prone | `Soccer_Game_Pack/standing up` | 1.67 (51) | - | - | - | - | -0.05 / +0.94 | 0.21-0.96 | yes | render; standing by f51; ends face DOWN (prone) (measured chest-forward z -0.68, hips 0.96 m) |
| Stylish getup (floor freeze to standing) | `Breakdance_Pack/crossleg freeze` | 2.03 (62) | - | - | - | - | +0.42 / -0.02 | 0.49-1.07 | yes | render; standing by f50-62 |
| Floor-to-standing stylish getup | `Breakdance_Pack/breakdance footwork to idle` | 3.63 (110) | - | - | - | - | +0.60 / +0.26 | 0.33-1.02 | yes | render |

### Evades

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Sideways dive evade + getup | `Soccer_Game_Pack/goalkeeper diving save` | 3.17 (96) | - | - | - | - | +1.86 / -2.24 | 0.17-1.07 | yes | render; up by f96 |
| Forward dive-roll evade + getup | `Soccer_Game_Pack/goalkeeper diving save (2)` | 3.20 (97) | - | - | - | - | +1.06 / +2.80 | 0.17-1.04 | yes | render; up by f97 |
| Sideways sprawl + getup (or knocked-flat-and-up react) | `Soccer_Game_Pack/goalkeeper body block` | 2.63 (80) | - | - | - | - | +0.69 / -0.26 | 0.17-0.96 | yes | render |
| Long sprawl + getup | `Soccer_Game_Pack/goalkeeper body block (3)` | 3.40 (103) | - | - | - | - | +0.23 / -0.85 | 0.18-0.93 | yes | render |

### Idles and HP states

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Armed brawler idle (pipe in hand) | `Pro_Melee_Axe_Pack/standing idle` | 1.80 (55) | - | - | - | - | -0.00 / -0.00 | 0.88-0.92 | no | render; right fist low in an axe grip |
| Fighting-stance idle (side-on, lead hand up) | `Pro_Magic_Pack/standing idle` | 1.80 (55) | - | - | - | - | +0.00 / +0.00 | 0.87-0.93 | yes | render; ALL Pro_Magic reacts start/end in this stance |
| Brute idle (hunched) | `Creature_Pack/mutant idle` | 12.97 (390) | - | - | - | - | +0.01 / -0.00 | 0.91-0.94 | yes | render; 390 frames |
| Cocky bouncing idle (showman enemy) | `Breakdance_Pack/breakdance ready` | 1.40 (43) | - | - | - | - | +0.08 / +0.45 | 0.99-1.03 | yes | render |
| Shield stance idle | `Pro_Sword_and_Shield_Pack/sword and shield idle` | 3.60 (109) | - | - | - | - | -0.01 / +0.00 | 0.88-0.89 | no | render; shield pose |
| LOW-HEALTH idle (hand at side) | `Male_Injured_Pack/injured idle` | 9.23 (278) | - | - | - | - | +0.00 / -0.00 | 0.95-1.00 | yes | render |
| Low-health idle, doubled over | `Male_Injured_Pack/injured hurting idle` | 5.97 (180) | - | - | - | - | -0.00 / +0.00 | 0.84-0.99 | yes | render |
| Stagger / stunned idle | `Male_Injured_Pack/injured stumble idle` | 5.07 (153) | - | - | - | - | +0.00 / +0.00 | 0.78-1.00 | yes | render |
| DAZED idle (after head hits) / drunk enemy idle | `Male_Drunk_Pack/drunk idle` | 7.40 (223) | - | - | - | - | +0.00 / +0.00 | 1.00-1.04 | yes | render |
| Dazed idle, arms out for balance | `Male_Drunk_Pack/drunk idle variation (2)` | 5.37 (162) | - | - | - | - | -0.00 / +0.00 | 0.91-1.03 | yes | render |

### Taunts (ratings)

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Battle-cry taunt (crowd hype) | `Pro_Melee_Axe_Pack/standing taunt battlecry` | 2.83 (86) | - | - | - | - | +0.00 / -0.00 | 0.82-0.94 | yes | render |
| Chest-thump taunt | `Pro_Melee_Axe_Pack/standing taunt chest thump` | 2.53 (77) | - | - | - | - | +0.02 / -0.00 | 0.86-0.95 | yes | render |
| Play-to-the-crowd hype pose (arms up) | `Pro_Magic_Pack/Standing 2H Cast Spell 01` | 2.17 (66) | - | - | - | - | +0.08 / +0.03 | 0.65-1.04 | yes | render |
| Boss roar taunt | `Creature_Pack/mutant roaring` | 5.37 (162) | - | - | - | - | +0.00 / +0.00 | 0.78-0.93 | yes | render |
| Boss flex taunt | `Creature_Pack/mutant flexing muscles` | 4.40 (133) | - | - | - | - | +0.00 / -0.00 | 0.81-0.95 | yes | render |
| Showboat freeze taunt (big ratings bonus) | `Breakdance_Pack/breakdance freeze var 1` | 4.13 (125) | - | - | - | - | +1.23 / -0.74 | 0.82-1.19 | yes | render; returns to the toprock pose shape, but turns +42 deg and travels 1.23 m (measured) |
| Showboat handstand taunt | `Breakdance_Pack/breakdance freezes` | 6.70 (202) | - | - | - | - | -0.16 / -0.65 | 0.73-1.54 | yes | render |
| One-hand spin showboat loop | `Breakdance_Pack/breakdance 1990 (2)` | 0.50 (16) | - | - | - | - | +0.00 / +0.00 | 1.16-1.18 | yes | render |
| Dance-step taunt | `Breakdance_Pack/breakdance uprock` | 2.10 (64) | - | - | - | - | +0.00 / -0.00 | 0.82-1.02 | yes | render |
| Rally flex (arms spread, chest out) | `Pro_Sword_and_Shield_Pack/sword and shield power up` | 2.37 (72) | - | - | - | - | +0.00 / -0.00 | 0.85-0.95 | yes | render |
| Beg / tap-out plea (enemy begging before finisher) | `Male_Injured_Pack/injured wave idle` | 5.03 (152) | - | - | - | - | +0.00 / +0.00 | 0.93-1.01 | yes | render |
| Feral roar taunt | `Scary_Zombie_Pack/zombie scream` | 2.80 (85) | - | - | - | - | +0.00 / -0.00 | 0.68-0.97 | yes | render |

### Locomotion

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Relaxed (out-of-combat) idle | `Pro_Melee_Axe_Pack/unarmed idle` | 1.80 (55) | - | - | - | - | -0.00 / -0.00 | 1.01-1.02 | yes | render |
| Stance walk forward (lock-on) | `Pro_Magic_Pack/Standing Walk Forward` | 1.13 (35) | - | - | - | - | +1.89 / +0.00 | 0.92-0.98 | yes | render |
| Stance walk back | `Pro_Magic_Pack/Standing Walk Back` | 1.20 (37) | - | - | - | - | -1.45 / +0.00 | 0.93-0.99 | yes | measured only |
| Stance strafe left | `Pro_Magic_Pack/Standing Walk Left` | 1.17 (36) | - | - | - | - | -0.00 / -1.55 | 0.93-1.00 | yes | render; lead arm raised high |
| Stance strafe right | `Pro_Magic_Pack/Standing Walk Right` | 1.20 (37) | - | - | - | - | +0.00 / +1.65 | 0.93-0.99 | yes | measured only |
| Stance run forward | `Pro_Magic_Pack/Standing Run Forward` | 0.73 (23) | - | - | - | - | +2.88 / -0.00 | 0.90-0.98 | yes | measured only |
| Stance run back | `Pro_Magic_Pack/Standing Run Back` | 0.63 (20) | - | - | - | - | -2.06 / +0.00 | 0.96-1.04 | yes | measured only |
| Stance run left | `Pro_Magic_Pack/Standing Run Left` | 0.77 (24) | - | - | - | - | -0.00 / -2.69 | 0.92-1.00 | yes | measured only |
| Stance run right | `Pro_Magic_Pack/Standing Run Right` | 0.77 (24) | - | - | - | - | +0.00 / +3.03 | 0.89-1.00 | yes | measured only |
| Sprint | `Pro_Magic_Pack/Standing Sprint Forward` | 0.57 (18) | - | - | - | - | +3.20 / -0.00 | 0.91-0.98 | yes | measured only |
| Low-health limp walk | `Male_Injured_Pack/injured walk` | 1.63 (50) | - | - | - | - | +2.09 / +0.00 | 0.86-1.03 | yes | render |
| Low-health limp run | `Male_Injured_Pack/injured run` | 0.63 (20) | - | - | - | - | +1.56 / +0.00 | 0.84-1.03 | yes | render |
| Dazed stagger walk | `Male_Drunk_Pack/drunk walk` | 3.00 (91) | - | - | - | - | +2.60 / -0.00 | 0.95-1.05 | yes | render |
| Dazed lurching run | `Male_Drunk_Pack/drunk run forward` | 1.83 (56) | - | - | - | - | +4.76 / -0.00 | 0.82-0.97 | yes | render |
| Feral four-limb crawler run | `Scary_Zombie_Pack/running crawl` | 0.63 (20) | - | - | - | - | +1.45 / -0.02 | 0.51-0.57 | yes | render |
| Hero neutral idle | `Male_Locomotion_Pack/idle` | 8.30 (250) | - | - | - | - | -0.00 / -0.00 | 1.03-1.03 | yes | render |
| Hero walk | `Male_Locomotion_Pack/walking` | 1.03 (32) | - | - | - | - | +1.72 / -0.00 | 0.95-1.03 | yes | render |
| Hero run | `Male_Locomotion_Pack/standard run` | 0.73 (23) | - | - | - | - | +3.24 / -0.00 | 0.84-0.93 | yes | render |
| Hero strafe run left | `Male_Locomotion_Pack/left strafe` | 0.67 (21) | - | - | - | - | -0.00 / -3.01 | 0.90-0.95 | yes | render |
| Hero strafe run right | `Male_Locomotion_Pack/right strafe` | 0.63 (20) | - | - | - | - | +0.00 / +2.88 | 0.90-0.95 | yes | measured only |
| Hero jump | `Male_Locomotion_Pack/jump` | 2.17 (66) | - | - | - | - | -0.00 / +0.00 | 0.75-1.30 | yes | measured only |

### Host / NPC gestures

| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Enemy shrug taunt / host gesture | `Gestures_Pack_Basic/being cocky` | 2.87 (87) | - | - | - | - | +0.00 / +0.00 | 0.98-1.03 | yes | render; subtle |
| Dismissive wave (host / enemy) | `Gestures_Pack_Basic/dismissing gesture` | 3.27 (99) | - | - | - | - | +0.00 / -0.00 | 1.02-1.04 | yes | render; subtle |
| Host / NPC reaction | `Gestures_Pack_Basic/angry gesture` | 2.17 (66) | - | - | - | - | +0.00 / +0.00 | 1.01-1.03 | yes | render; subtle; all 15 gestures are cutscene/menu scale |

Prop reach: for hand-held props the reach column is the KNUCKLES; add the prop length (a bat or pipe adds
roughly its own length along the forearm direction) when sizing weapon hitboxes.

## Weapon-pose flags (held-weapon pose baked in)

- **Great_Sword_Pack = two-handed grip, measured.** In 17 of 19 rendered clips the hands stay within 0.25 m of each
  other on >= 89% of frames (median hand distance 0.072-0.168 m). Unarmed they read as clasped fists; use them only
  with a 2H prop (bat, pipe, sledgehammer). The 2 deaths are the exceptions (grip breaks as the body falls).
- **Pro_Sword_and_Shield_Pack**: idle, block, crouch block, impact hold the LEFT forearm flat in front (shield); not
  unarmed. Its attacks are right-hand 1H swings (pipe); its kick, power up, impact (2) and deaths are usable unarmed.
- **Pro_Melee_Axe_Pack**: `standing *` clips are axe-armed (right fist curled as a grip, swings carry axe weight);
  the idle is not unarmed. The single swings read as big haymaker / hammer-fist / backfist / spin arm swings
  unarmed (rendered); the combos read as prop strings. `unarmed *` clips are relaxed unarmed locomotion.
- **Rifle_8-Way deaths** start in a rifle-carry pose for ~10 frames (both forearms forward): crossfade in after it.
- **Basic_Shooter hit reaction**: rifle hold throughout - unusable. Rifle/pistol/bow locomotion packs and
  Action_Adventure/Shooter were measured (JSON) but not rendered or mapped: not needed for a melee brawler.
- **Weak but usable**: soccer `header` (head moves only 1.14 m/s), soccer `kick soccerball` / `kick up` (small
  taps), Gestures_Pack_Basic (all 15 are head-nod / hand-flick scale - fine for host cutaways, invisible in combat).

## Locomotion speeds (measured, X Bot scale)

Pro_Magic stance locomotion is **4-way** (Walk/Run Forward, Back, Left, Right + Sprint Forward): no diagonals, so an
8-way lock-on strafe needs blending. Speed = hips horizontal path / duration; loop = first-vs-last pose error.

| clip | dur s | travel fwd/right m | speed m/s | loop err deg |
|---|---|---|---|---|
| `Pro_Melee_Axe_Pack/unarmed idle` | 1.80 | -0.00 / -0.00 | 0.02 | 1.9 |
| `Pro_Magic_Pack/Standing Walk Forward` | 1.13 | +1.89 / +0.00 | 1.67 | 0.0 |
| `Pro_Magic_Pack/Standing Walk Back` | 1.20 | -1.45 / +0.00 | 1.22 | 0.1 |
| `Pro_Magic_Pack/Standing Walk Left` | 1.17 | -0.00 / -1.55 | 1.34 | 0.0 |
| `Pro_Magic_Pack/Standing Walk Right` | 1.20 | +0.00 / +1.65 | 1.39 | 0.0 |
| `Pro_Magic_Pack/Standing Run Forward` | 0.73 | +2.88 / -0.00 | 3.93 | 0.0 |
| `Pro_Magic_Pack/Standing Run Back` | 0.63 | -2.06 / +0.00 | 3.26 | 0.0 |
| `Pro_Magic_Pack/Standing Run Left` | 0.77 | -0.00 / -2.69 | 3.51 | 0.0 |
| `Pro_Magic_Pack/Standing Run Right` | 0.77 | +0.00 / +3.03 | 3.95 | 0.0 |
| `Pro_Magic_Pack/Standing Sprint Forward` | 0.57 | +3.20 / -0.00 | 5.65 | 0.0 |
| `Male_Injured_Pack/injured walk` | 1.63 | +2.09 / +0.00 | 1.29 | 0.0 |
| `Male_Injured_Pack/injured run` | 0.63 | +1.56 / +0.00 | 2.47 | 5.2 |
| `Male_Drunk_Pack/drunk walk` | 3.00 | +2.60 / -0.00 | 0.88 | 0.0 |
| `Male_Drunk_Pack/drunk run forward` | 1.83 | +4.76 / -0.00 | 2.60 | 0.0 |
| `Scary_Zombie_Pack/running crawl` | 0.63 | +1.45 / -0.02 | 2.34 | 16.6 |
| `Male_Locomotion_Pack/idle` | 8.30 | -0.00 / -0.00 | 0.01 | 0.0 |
| `Male_Locomotion_Pack/walking` | 1.03 | +1.72 / -0.00 | 1.67 | 0.0 |
| `Male_Locomotion_Pack/standard run` | 0.73 | +3.24 / -0.00 | 4.42 | 0.0 |
| `Male_Locomotion_Pack/left strafe` | 0.67 | -0.00 / -3.01 | 4.52 | 0.0 |
| `Male_Locomotion_Pack/right strafe` | 0.63 | +0.00 / +2.88 | 4.54 | 28.4 |
| `Male_Locomotion_Pack/jump` | 2.17 | -0.00 / +0.00 | 0.29 | 0.0 |

## Chains that line up (measured end/start poses)

Lying orientation = chest-forward vector at the last (or first) frame, from `mixamo_lying_check.py`:

- **Knockdown -> downed -> getup (face-down chain):** `soccer trip` ends chest-z -0.64 / hips 0.21 m, `fallen idle`
  loops at chest-z -0.60 / hips 0.21 m, and `standing up` STARTS at chest-z -0.60 / hips 0.21 m: one continuous chain.
  Face-down KOs that can feed it: React Death Forward, React Death Right, S&S death (2), zombie dying, rifle back /
  crouching headshot.
- **Face-up KOs have NO matching getup in these packs** (React Death Backward/Left, mutant dying, both 2H deaths,
  S&S death, zombie death, rifle front headshot all end chest-up). Use them as final KOs for enemies, or source a
  face-up getup elsewhere (cmu_pilot lane / another Mixamo download).
- **Spinning sweep:** `flair (3)` (stand -> flair) -> `flair (2)` loop (first/last pose error 0.0 deg) -> `flair` (exit to
  stand by f75).
- **Block:** Pro_Magic `Block Start` -> `Block Idle` (loop error 0.0 deg) -> `Block React Large` -> `Block End`.
- **Reacts return to the Pro_Magic stance** (side-on, hips -58.3 deg from model forward), not to a square boxing idle:
  either make `Pro_Magic_Pack/standing idle` the fighting idle or crossfade ~0.2 s out of every react.
- **Showboat freezes** return to the toprock pose SHAPE (renders) but turn and travel on the way (measured net hips
  yaw / travel fwd,right m): freeze var 1 +42 deg / +1.23,-0.74; freeze var 2 -5 deg / +1.23,-0.06; freeze var 3 -857 deg / -1.03,+1.75; freeze var 4 -773 deg / +0.93,+0.74; freezes -0 deg / -0.16,-0.65.
  Apply their root yaw/travel (or re-face the model) before chaining them. `flair (2)` turns exactly +360 deg per loop
  with 0.00 m travel.

## Contact picks the automatic detector got wrong (fixed by renders)

- `Pro_Melee_Axe_Pack/standing melee attack horizontal`: dense render (auto f30 = end of sweep) -> contact f28
- `Pro_Magic_Pack/Standing 2H Magic Area Attack 01`: dense render (hands reach floor f40; auto f39) -> contact f40
- `Pro_Magic_Pack/Standing 1H Magic Attack 02`: auto, confirmed (palm push); the auto f39 follow-through ends behind the body (dropped) -> contact f24
- `Soccer_Game_Pack/kneeing soccerball`: auto hit list + rig-proof render (sheet's LeftFoot f24 pick is the foot re-planting) -> contact f13
- `Soccer_Game_Pack/kneeing soccerball (2)`: dense render (knee at hip height f9-13; auto speed peak f5) -> contact f9
- `Soccer_Game_Pack/soccer tackle`: dense render (legs along floor f26-28; auto RightFoot f21 = before slide) -> contact f27
- `Soccer_Game_Pack/soccer tackle (3)`: dense render (body horizontal f13-17; auto RightFoot f11 = take-off) -> contact f15
- `Soccer_Game_Pack/header soccerball`: dense render + Head speed peak (only 1.14 m/s); head stays BEHIND the hips at contact (reach -0.34 m) -> contact f27
- `Creature_Pack/mutant punch`: auto f11 (arm fully extended, render) = END of the hook, 68 deg to the left; fist passes the front at f9 (front pass) -> contact f11
- `Creature_Pack/mutant swiping`: dense render (torso whips down f40, reach f42; speed peak f39) -> contact f41
- `Breakdance_Pack/flair (2)`: dense render (legs circle continuously) -> hitbox active through the loop
- `Breakdance_Pack/breakdance swipes`: dense render (strike window f70-82; auto LeftHand f88 is not the strike) -> contact f75,79
- `Breakdance_Pack/breakdance footwork 1`: dense render (legs flat on floor f54-58, f74-78) -> contact f56,72
- `Great_Sword_Pack/great sword slash (4)`: dense render (impact f41-43; auto f25 = windup) -> contact f42
- `Great_Sword_Pack/great sword casting`: dense render (hands reach floor f72; auto f67) -> contact f72
- `Great_Sword_Pack/great sword kick`: dense render (leg extended f16-18; auto f20) -> contact f17
- `Pro_Sword_and_Shield_Pack/sword and shield kick`: dense render (extended f16-18; foot speed peak f14) -> contact f17
- `Scary_Zombie_Pack/zombie attack`: dense render (arm fully extended f30; auto f35 late) -> contact f30

## Front pass vs judged frame (>= 3 frames apart: time the hitbox on the front pass)

| clip | judged frame, dir | front pass frame | reach fwd m at front pass |
|---|---|---|---|
| `Pro_Melee_Axe_Pack/standing melee attack backhand` | f37, -133 deg | f32 | 0.64 |
| `Pro_Melee_Axe_Pack/standing melee attack kick ver. 1` | f19, +8 deg | f22 | 0.97 |
| `Pro_Melee_Axe_Pack/standing melee attack kick ver. 2` | f21, +7 deg | f24 | 1.01 |
| `Pro_Melee_Axe_Pack/standing melee combo attack ver. 1` | f64, -91 deg | f60 | 0.75 |
| `Pro_Melee_Axe_Pack/standing melee combo attack ver. 1` | f95, +178 deg | f88 | 0.61 |
| `Pro_Melee_Axe_Pack/standing melee combo attack ver. 3` | f53, +128 deg | f49 | 0.43 |
| `Pro_Magic_Pack/Standing 2H Magic Area Attack 02` | f56, +105 deg | f48 | 0.53 |
| `Pro_Magic_Pack/Standing 2H Magic Attack 02` | f40, +4 deg | f43 | 0.92 |
| `Pro_Magic_Pack/Standing 2H Magic Attack 01` | f36, +38 deg | f39 | 0.90 |
| `Pro_Magic_Pack/Standing 2H Magic Attack 03` | f32, +15 deg | f35 | 0.92 |
| `Pro_Magic_Pack/Standing 1H Magic Attack 01` | f26, +23 deg | f29 | 0.86 |
| `Pro_Magic_Pack/Standing 1H Magic Attack 02` | f24, -39 deg | f21 | 0.78 |
| `Pro_Magic_Pack/Standing 2H Magic Attack 05` | f22, +45 deg | f25 | 0.64 |
| `Soccer_Game_Pack/kneeing soccerball` | f13, -20 deg | f16 | 0.42 |
| `Soccer_Game_Pack/strike foward jog` | f15, +4 deg | f18 | 1.08 |
| `Soccer_Game_Pack/soccer tackle` | f27, -140 deg | f21 | 0.85 |
| `Soccer_Game_Pack/soccer tackle (2)` | f19, -146 deg | f11 | -0.12 |
| `Soccer_Game_Pack/soccer tackle (3)` | f15, +33 deg | f18 | 0.20 |
| `Soccer_Game_Pack/header soccerball` | f27, -176 deg | f30 | -0.24 |
| `Soccer_Game_Pack/kick soccerball` | f8, -15 deg | f11 | 0.87 |
| `Breakdance_Pack/flair (3)` | f36, +178 deg | f29 | 0.53 |
| `Breakdance_Pack/flair (3)` | f43, +45 deg | f46 | 1.03 |
| `Breakdance_Pack/breakdance footwork 1` | f56, -147 deg | f49 | 0.25 |
| `Breakdance_Pack/breakdance footwork 2` | f11, -133 deg | f5 | 0.51 |
| `Great_Sword_Pack/great sword slash` | f22, -50 deg | f19 | 0.67 |
| `Great_Sword_Pack/great sword slash (3)` | f24, -82 deg | f27 | 0.42 |
| `Great_Sword_Pack/great sword slash (2)` | f59, +77 deg | f53 | 0.49 |
| `Great_Sword_Pack/great sword slash (5)` | f13, +14 deg | f16 | 0.46 |
| `Great_Sword_Pack/great sword high spin attack` | f18, -143 deg | f11 | 0.62 |
| `Great_Sword_Pack/great sword jump attack` | f16, -165 deg | f8 | 0.06 |
| `Great_Sword_Pack/great sword casting` | f72, -6 deg | f69 | 0.81 |
| `Great_Sword_Pack/great sword slide attack` | f28, +90 deg | f20 | 0.18 |
| `Great_Sword_Pack/great sword slide attack` | f41, -49 deg | f38 | 0.58 |
| `Pro_Sword_and_Shield_Pack/sword and shield slash (2)` | f49, -41 deg | f52 | 0.73 |
| `Pro_Sword_and_Shield_Pack/sword and shield attack` | f41, +94 deg | f35 | 0.70 |
| `Scary_Zombie_Pack/zombie neck bite` | f29, -25 deg | f32 | 0.43 |
| `Scary_Zombie_Pack/zombie attack` | f30, +54 deg | f33 | 0.86 |

## Pack overview

| pack dir | clips | duplicates | duration range s | rendered | notes |
|---|---|---|---|---|---|
| Pro_Melee_Axe_Pack | 47 | 0 | 0.60-11.27 | 21 |  |
| Pro_Magic_Pack | 56 | 0 | 0.50-11.17 | 30 |  |
| Soccer_Game_Pack | 54 | 0 | 0.50-10.50 | 27 |  |
| Creature_Pack | 19 | 0 | 0.60-12.97 | 8 |  |
| Breakdance_Pack | 34 | 0 | 0.50-9.60 | 34 |  |
| Gestures_Pack_Basic | 15 | 0 | 1.57-9.43 | 15 |  |
| Great_Sword_Pack | 51 | 0 | 0.37-7.50 | 19 |  |
| Pro_Sword_and_Shield_Pack | 51 | 0 | 0.27-8.67 | 21 |  |
| Male_Injured_Pack | 20 | 0 | 0.50-9.23 | 6 |  |
| Male_Drunk_Pack | 12 | 0 | 1.10-7.40 | 5 |  |
| Rifle_8-Way_Locomotion_Pack | 49 | 0 | 0.50-3.70 | 6 |  |
| Scary_Zombie_Pack | 12 | 0 | 0.63-6.60 | 12 |  |
| Male_Locomotion_Pack | 10 | 0 | 0.63-8.30 | 4 |  |
| Action_Adventure_Pack | 22 | 0 | 0.23-9.90 | 0 |  |
| Basic_Shooter_Pack | 16 | 0 | 0.27-3.30 | 1 |  |
| Creature_NPC_Pack | 12 | 12 | 0.87-5.23 | 0 |  |
| Extra | 6 | 1 | 0.63-9.93 | 0 | 41-bone non-X Bot rig |
| Female_Locomotion_Pack | 10 | 0 | 0.67-8.33 | 0 |  |
| Lite_Longbow_Pack | 7 | 0 | 0.87-5.10 | 0 |  |
| Magic_Locomotion_Pack | 16 | 16 | 0.57-2.33 | 0 |  |
| Magic_Spell_Pack | 13 | 13 | 1.80-4.27 | 0 |  |
| Pistol_Handgun_Locomotion_Pack | 20 | 0 | 0.50-3.73 | 0 |  |
| Shooter_Pack | 15 | 7 | 0.53-3.07 | 0 |  |
| Sword_and_Shield_Pack | 49 | 49 | 0.27-8.67 | 0 |  |
| WithSkin | 12 | 1 | 0.63-10.00 | 0 | 41-bone non-X Bot rig |

## Files

- `mixamo_inventory.json` - every clip: timing, hips, effectors, automatic hits, loop error, duplicates, render sheet,
  hand distance, and the `hit_parade` block for mapped clips.
- `renders_mixamo/sheets/xbot_NN.png` (35 sheets, 209 clips) + `dense_NN.png` (4 sheets) - X Bot contact sheets.
- `renders_mixamo/proof/` - rig-transfer proof (see rig_compat.md).
- Scripts: `tools/research/mixamo_inventory.py`, `mixamo_render_sheet.py`, `mixamo_montage.py`,
  `mixamo_build_specs.py`, `mixamo_contact_measure.py`, `mixamo_build_report.py`, `mixamo_rig_compat.py`,
  `mixamo_rig_proof.py`, `mixamo_proof_montage.py`, `mixamo_proof_compare.py`, `mixamo_proof_diff.py`.
