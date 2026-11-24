# Last Circle - character animation acceptance standard (third-person shooter)

Single acceptance standard for the player / bot character animation, weapon holding and aiming. Written 2026-11-23 (audit8,
branch w10-anim-fix @ 7aad2ad27). Sources: the researched rules (workflow wf_3b57650e-4e2 journal result 0: Lyra / UE aim offset
and pose warping docs, Gears of War 4 inertial transitions, Kimodo foot-skate metric, Mocaponline TPS guide, Kinemation left-hand
IK, firearm-technique sources for each hold) plus the rows those sources miss (marked NEW-RULE), which are the common practice of
shipped third-person shooters (Fortnite / PUBG / Apex-style TPS): every state has an authored or procedurally believable pose,
the gun is readable from the game camera, and nothing snaps, clips or bends past a human joint.

How to read a row: **ID - what - BAR - HOW measured - GATE** (which existing gate already measures it, or NEW = needs a new gate
row; "audit8" = measured by F:/lc_p23/w10/t/ANIM/audit8 tools this round, not yet a gate).
Judging rules for every row: all 5 skins (soldier, athlete, wraith, juggernaut - the bulky armoured one - viper); desktop High
unless the row says LOW / phone; a row that cannot be measured is COULD-NOT-JUDGE and is never a pass; "worse than live" = the
same measurement on the live build (8ccb6efce = LIVE_REV ede02845 runtime) on the same box is better by more than its noise.

Cameras used for judging (row V lists what each must show):
- GAME = the game's own camera as the player has it: chase (hip, shoulder offset +0.70 m) and ADS (over-the-shoulder aim camera).
- Orbit views at 4 m, fov 30, around the actor's aim yaw: front, right, back, left, front-right 3/4, front-left 3/4, plus top (5.6 m up).
- HAND = the left-hand close-up (0.7 m).
- FAR = the player's game camera looking at another actor at 5 m, 20 m, 60 m (LOD band 0 / IK-near band / LOD1 far band).

## S - every player state has a believable full-body pose

| ID | State | BAR | HOW | GATE |
|---|---|---|---|---|
| S1 | idle / ready (each weapon class) | a weapon-specific ready pose: rifle-class stock at the shoulder or low ready, pistol two-hand low/compact ready; never a T/A pose, never arms through the body | GAME + 7 orbit views, 2 frames | audit8 (look) ; w10_gunhold chase (AR/SMG/LMG only) |
| S2 | walk (partial stick) | a walk clip (not the run played slow): play-rate scale 0.80-1.20 (Phase 2) ; arms keep the carry | orbit views + rows clip/rate | audit8 |
| S3 | run (each class) | rifle run clip with the carry; pistol one-hand low run carry or two-hand compact | orbit + GAME | audit8 |
| S4 | sprint (each class) | weapon lowered (rifle muzzle 20-60 deg down, inside the torso silhouette; pistol lowered); free arm swings, elbow 70-110 deg | rows barrelPitch, elbows + look | audit8 (research rule 13) |
| S5 | strafe L / R | cardinal strafe clip, chest and gun stay on the aim (chest-to-aim yaw within the hold's blade limit), legs face the move within +-10 deg (warp <= 45 deg) | rows chestYaw, pelvisYaw + look | rigcheck (c) (barrel vs chest >= cos 60) ; audit8 |
| S6 | diagonals FL/FR/BL/BR | blended / warped from the cardinals, no leg crossing through the other leg, chest on the aim | look front/top + rows | audit8 |
| S7 | backpedal | backward clip (rifle_run_back / walk_back), chest on the aim, NOT a 180 deg body turn | rows pelvisYaw vs aim, top view | audit8 |
| S8 | turn in place | feet stay planted while the aim turns < ~60-90 deg; a step-turn clip past it; upper body keeps the aim | rows yaw vs pelvisYaw, top view | audit8 ; Phase 2 for foot speed |
| S9 | crouch idle / crouch walk / crouch strafe | crouch clip with the weapon carry; gun not inside the head / knee; legs move at the ground speed | orbit + rows headSeg | audit8 |
| S10 | jump / fall / land (soft + hard) | take-off, air (tuck / fall loop), landing absorb; the weapon hold kept in the air | strips GAME/right/front | w10_gunhold land-pop, kerb ; audit8 |
| S11 | slide | slide clip, rifle across the chest | strip | p23_move slide (speed only) ; audit8 look |
| S12 | swim (tread + stroke) | gun put away, head and shoulders out, wrists at/below the surface | rows + look | w10_gunhold swim, swim-view, swim-head, swim-arms |
| S13 | drop: freefall + canopy | belly-down skydive arms, canopy hanging pose holding the risers | look | rigcheck (d) (chute on ground only) ; audit8 look |
| S14 | hit reaction | a visible flinch within 100 ms, also while sprinting; gun stays in the hands | rows + strip | w10_gunhold flinch ; audit8 |
| S15 | death | death clip by direction; gun leaves the hand at the loot drop; body does not sink / pop | strip | w10_gunhold death |
| S16 | downed (DBNO) + crawl | crawl clip stride-matched, no gun in hand | look | dbno gate (p23/dbno.py) ; audit8 look |
| S17 | emotes | emote plays full-body, held gun hidden, returns to the carry smoothly | strip | audit8 |
| S18 | unarmed (no weapon) idle / run / sprint / jump | relaxed unarmed clips, natural arm swing | look | audit8 |

## W - every weapon class in every weapon state

Classes in the game (runtime/sim/royale.js WEAPONS): pistol, smg, ar, burst (ar class), dmr, lmg, shotgun, sniper, glauncher
(launcher), frag + smoke (throwable), unarmed.

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| W1 | carry / ready per class | per S1; long guns: stock in/at the shoulder pocket (butt <= 5 cm from the pocket when shouldered), support hand on the handguard; pistol: two-hand compact or one-hand low | rows stockSh, lhGuard + look | w10_gunhold grip (8 long guns, idle + ADS) |
| W2 | ADS per class | stock shouldered, cheek on the stock (eye within 8 cm of the sight line), support elbow 100-145 (traditional) / <= 160 (C-clamp), never >= 170, elbow under the gun (<= 12 cm off the barrel plane); pistol isosceles (elbows 155-178, chest <= 15 deg) or Weaver | rows elbows, headLine, elbLat, chestYaw | w10_gunhold grip ; audit8 |
| W3 | hip fire per class | the gun comes up to the hip-fire / ready-aim pose and the barrel is on the shot line (<= 5 deg) from the first shot | rows barrelAim at shot frames | rigcheck (c) firing (cos 15) ; audit8 |
| W4 | recoil per class | a visible kick timed to every shot (within 1 frame), recovering in 0.1-0.25 s, scaled by class (sniper/shotgun big, smg small); the support hand stays on the gun | rows shot vs tip motion + strip | w10_gunhold flash (flash only) ; NEW |
| W5 | reload per class | the class's own reload: support hand to the mag well within 8 cm at the mag beats (shotgun per shell); gun within 0.35 m of its aim height; readable at 3-5 m; pistol its own reload | rows lhWell, tip height | w10_gunhold reload-height, reload-hand, pistol-reload |
| W6 | swap / equip / holster | the old gun goes down (>= 25 deg off the aim) and away, the new one comes up; 0.8-1.5 s total at the slower end, no one-frame jump of the hand | rows + strip | w10_gunhold swap, swap-pop |
| W7 | stowed weapons on the body | the second gun slung on the back / hip, attached to the torso (moves with it), not through the body, not floating; visible on near actors (cap 8) | look back/left/right + rows sling | w10_gunhold swap (sling count) ; audit8 look |
| W8 | throwable | grenade held in the hand, wind-up + toss overlay on the upper body, legs keep moving | strip | audit8 |
| W9 | launcher | shouldered like a long gun, its own reload (shell) | look + rows | w10_gunhold grip + reload-hand (glauncher) |
| W10 | unarmed | no floating weapon mesh, no gun hand pose | rows gunVis | audit8 |

## A - aiming

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| A1 | aim pitch (aim offset up/down) | upper body follows the camera pitch from -45 to +45 deg and beyond to the clamp; barrel within 5 deg of the aim ray at pitch 0, +45 and -45 in ADS and hip fire | rows barrelAim at adsup/adsdn/hipup/hipdn | NEW (audit8) |
| A2 | aim yaw | chest (Spine2) carries the twist spread over the spine (no single bone > ~50 %), the gun stays on the aim line while the legs run another way | rows chestYaw vs aim on strafes / diagonals | rigcheck (c) ; audit8 |
| A3 | muzzle points where the shots go | flash at the muzzle (<= 5 cm) and the shot line through the crosshair target (<= 0.10 m at 20 m) on both shoulders | gate rows | w10_gunhold flash-tip ; p23_move crosshair |
| A4 | head looks along the aim | the head turns / pitches with the aim (head forward within ~25 deg of the aim in ADS; follows pitch) | rows headZ vs aim at pitch +-45 | NEW (audit8) |
| A5 | aim-in / aim-out time | hip -> ADS 0.15-0.25 s (weapon adsTimeS), out <= 0.3 s; no overshoot > 1 cm | strips | w10_gunhold ads-pop (pop only) ; audit8 |

## H - hands, fingers, wrists

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| H1 | both hands on a two-hand gun | support hand on the handguard / forend (<= 6 cm idle + ADS, gate) and inside the forend bounds; on the pistol: support hand cupping the grip (wrist gap < 6 cm) when two-handed | rows lhGuard, wristGap | w10_gunhold grip |
| H2 | grip at the grip | the trigger hand at the pistol grip (the holder's own origin), not at the receiver / mag | look HAND + rows | rigcheck (b) (holder within 5 cm of the hand bone) |
| H3 | wrists in human range | flexion <= 54, extension <= 60, ulnar <= 40, radial <= 17 deg; trigger wrist in line with the bore within 15 deg | rows wristL/R (approx.) + look | audit8 (approx.) ; NEW precise row |
| H4 | no candy-wrapper twist | forearm-to-hand twist <= 90 deg (visible mesh wrap beyond) | rows twistL/R + look | NEW (audit8) |
| H5 | fingers | support thumb along the slide / forend (<= 20 deg), no claw, no finger through the gun | rows thumbAng + HAND look | audit8 |
| H6 | no hand through the gun | look HAND / front views | look | audit8 |

## B - body integrity and posture

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| B1 | no limb through the body / gun / head | no forearm or hand inside the torso, the gun not inside the head (head point to the gun segment >= 6 cm), not through the thigh in crouch | rows headSeg + look all views | NEW (check7 headgap measured 113/175 cells under 6 cm) |
| B2 | joints in human range | elbows 25-178 deg interior (never hyper-extended past 180, never folded < 25), shoulders not above the ear line except deliberate poses, knees 30-180 | rows elbows/knees | audit8 |
| B3 | believable posture per skin | the bulky juggernaut's arms clear its armour, no shrug / hunch artifacts; viper / athlete arm lengths reach the gun without a locked arm | look | audit8 |
| B4 | rigs intact | head-foot span 1.0-2.2 m, holder parented to the hand | rigcheck (a)(b) | rigcheck |

## T - continuity (every transition)

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| T1 | no one-frame snap | the right hand, the left hand and the muzzle (hips frame) never move > 2x the motion of the frames around it in any transition (idle<->run, run<->sprint, sprint->ADS, run<->back, strafe reversal, crouch in/out, ADS in/out standing + walking, swap AR<->SMG / AR<->pistol, equip->aim, jump take-off + landing, kerb, stairs, reload in/out, fire start, hit, emote out) | xprobe / audit8 rows: max frame step / neighbour median | w10_gunhold kerb, swap-pop, ads-pop, land-pop (subset; TRANS_FLOOR 0.01 m) ; NEW for the rest |
| T2 | blend times | mixer cross-fades 0.1-0.3 s for state changes, 0.15-0.25 s for aim | code + rows | audit8 (code) |
| T3 | no root / body-yaw teleport | body (pelvis) yaw changes <= ~15 deg per frame except authored turns; root never jumps | rows pelvisYaw | NEW |
| T4 | joint rate | no elbow / wrist angle change > ~12 deg per frame in steady locomotion unless the clip authors it (live as reference) | rows | audit8 (check7 used 12) |

## V - readability from the GAME camera

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| V1 | the gun is readable in the chase camera at rest and moving | the held gun's visible pixel share >= the live build's on every weapon class, skin and state (owner ruling 2026-11-23: the pistol ready must be visible from the chase camera at least as much as live on every skin, even with a right-side hold) | chasevis.py | w10_gunhold chase (AR / SMG / LMG only) ; NEW for pistol, shotgun, sniper, the rest |
| V2 | both arms read in the chase camera | the support arm and the gun hand are seen, not hidden behind the torso | look GAME | audit8 |
| V3 | ADS camera | the gun and the right arm frame the shot, the gun does not cover the crosshair; for scoped guns the scope view shows no stray mesh (holstered gun, own arm) | look GAME ads | NEW (audit8) |
| V4 | correctness from all sides | front, both sides, 3/4, top: the pose is correct, not just the side profile | look | audit8 |

## D - other actors, distance tiers, phones / LOW

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| D1 | 5 m | full detail: same pose as the player's own | FAR look | audit8 |
| D2 | 20 m | IK-near band: the gun in two hands, readable silhouette | FAR look | audit8 |
| D3 | 60 m (LOD1, no IK, far-skip) | the gun welded in the hand, pointing roughly along the body, no T-pose, no frozen glide pose | FAR look + rows lod | rigcheck (far-bot) ; audit8 |
| D4 | phones / LOW | look and cost exactly as live (owner rule): same arm modes, no extra solves | code diff + LOW capture vs live | mobile 48/48 ; NEW look row |
| D5 | cost | p23_tierprof kb <= 85 KB / frame every tier, bots p95 <= 3 ms; mobile 48/48; no new shader program | gates | p23_tierprof, mobile, framecheck |

## Phase 2 (ordered by the owner as a separate later phase: record, do not fix now)

| ID | What | BAR | HOW | GATE |
|---|---|---|---|---|
| F1 | planted foot slide | planted toe speed < 20 cm/s (goal 7.5), skating ratio <= 0.10, per clip and skin, incl. turn in place | toe rows (planted = toe < 5 cm two frames) | p23_move skate (ratio strafe/forward only) ; gunhold pistol slide <= 1.1 m/s |
| F2 | clip speed = ground speed | effective play-rate x stride scale 0.80-1.20 in every locomotion state, incl. crouch-walk and run | rows rate x clip speed vs spd | NEW |
| F3 | cadence | walk 100-120, jog 150-165, run 160-180, sprint 170-190 steps/min | foot strikes per minute | NEW |
| F4 | foot IK on slopes / stairs | feet on the ground on slopes and steps (leg IK) | look + toe heights | NEW |

## Audit8 result per row (branch w10-anim-fix @ 7aad2ad27 vs live 8ccb6efce, 2026-11-23)

Evidence: F:/lc_p23/w10/t/ANIM/audit8 (capture8.py: 190 scenarios x 5 skins x up to 10 views, both builds, 0 capture errors, 0 console
errors; analyze8.py -> an8.txt; flags8.txt; sheets/*.jpg looked at pose by pose; LOW captures fix8low / live8low; tierprof A/B tp_*.log).

| Row | Status | Key evidence |
|---|---|---|
| S1 idle/ready | FAIL | pistol ready hidden from the chase camera (4 skins, live visible); athlete AR ready held at arm's length |
| S3/S5/S6 run, strafe, diagonals | FAIL (pistol) | pistol compact/one-hand carry hidden in chase view on strafes / crouch |
| S7 backpedal | FAIL (both builds) | out of combat S turns the body 180 deg at 25-30 deg/frame (t_run_back, t_strafe_rev, both builds) |
| S8 turn in place | FAIL (new) | turn_ar hand/muzzle step 0.034 m x6.4 neighbours (live 0.015 x1.6) |
| S9 crouch | FAIL (new) | crouch in/out AR x5.8 / x9.5 (live x2.1); pistol crouch-in 0.050 m x8.5 (live 0.031); shotgun crouch gun and hands in front of the face |
| S10 jump/land | FAIL (pistol) | jump_pistol 0.043-0.045 m one-frame step x15-16 (live 0.028) |
| S11 slide | FAIL (new) | slide_ar muzzle 0.229 m step x4.4 (live 0.066) |
| S12 swim | PASS | w10_gunhold swim rows PASS (gates7), shots _shots/gunhold_disk/swim_*.png |
| S13 freefall / canopy | PASS | player_dive PASS 7/0/0, player_canopy PASS 12/0/0 on 7aad2ad27 (audit8/dive_fix, canopy_fix) |
| S14 hit reaction | FAIL (both) | standing hit: head moves 0.065 m with the AR, 0.012 m with the pistol; the hit clip never plays while standing |
| S15 death / S16 downed | PASS (look) | death_bot, downed_bot strips |
| S17 emote | PASS (look) | gun hidden during the dance |
| W2 ADS | FAIL (new) | soldier/athlete/viper: gun at mouth height, support arm near straight (elbow 105-129 vs live 79-82; hand far out on the guard); shotgun support elbow 86-88 (soldier/wraith) |
| W1 shotgun carry | FAIL (new) | shotgun trigger elbow folded to 30-39 deg interior (live 52-68) at ready/crouch/ADS on soldier, wraith (athlete 35-50) |
| W3/W4 hip fire, recoil | FAIL | first shot from the patrol ready leaves while the gun is still rising (muzzle travels 0.18-0.21 m in the 6 frames after the shot on burst / shotgun); per-shot kick 3-7 mm for pistol/SMG/AR/LMG (both builds) - not readable |
| W5 reload | PASS gate / minor | gate rows PASS; shotgun support hand median 0.24-0.29 m from the well (live 0.23) |
| W6 swap | FAIL (both) | visible swap 0.22 s (dip 41-46 deg, up in 13 frames) vs the 0.4 s ready delay and the 0.8-1.5 s standard; pistol -> AR support hand 0.19 m in one frame (live 0.24) |
| W7 stowed weapons | FAIL (both) | a slung pistol is placed like a rifle across the upper back, barrel up behind the neck (visible from the chase camera) |
| W8 throwable | FAIL | no grenade mesh in the hand (ready_frag: empty relaxed hands, both builds); throw start right elbow 31-69 deg/frame (live 14-19), hands 0.16-0.26 m in a frame |
| A1 aim pitch | FAIL (worse than live) | +45 deg: support hand 0.27-0.29 m above the head, trigger hand 0.11 m above the shoulder, stock off the shoulder; torso lean changes only 1-3 deg between +45 and -45 (both builds; worse on fix) |
| A4 head follows aim | FAIL (both) | head pitch changes ~16 deg for a 90 deg aim sweep on long guns (fix 0.18, live 0.21 tracking) |
| A5 aim-in/out | PASS in / minor out | in 0.20-0.22 s (live snaps in 1 frame); out 0.38-0.43 s (> 0.3 s) |
| V1 chase readability | FAIL | pistol chase hidden (cv_cmp7 20 cells; G_pistol_game.jpg); viper/soldier AR/LMG slightly under live (gates7 w10_gunhold chase) |
| V3 ADS camera | FAIL (new) | over-shoulder ADS frame: the gun sits behind the head/hair on athlete, viper, juggernaut (pistol hidden on 4 skins); live shows the gun right of the body |
| V3 scope | FAIL (both) | scoped sniper hides the body but not the slung pistol / held rifle: they float in the view |
| D1-D3 5/20/60 m | PASS / minor | AR readable at 20 m and 60 m (LOD1); the pistol is a few pixels at 20-60 m (both builds) |
| D4 phones/LOW | FAIL (new) | LOW: pistol now pistolReady centred / pistolLow one-hand / pistolAim (live: gunReady everywhere) |
| D5 cost | PASS for anim | tierprof A/B same box, no other Chrome: live kb medium 96.3 / 97.5, high 92.1 / 90.3 (FAIL) vs fix 98.6 / 95.1, 90.6 / 92.0 (FAIL); player.js share equal (~22 / ~18 KB); bots p95 live 2.2 / 1.6 ms, fix 1.3 / 1.5 ms (PASS) |
| T1 continuity | FAIL | see S8-S11, W6, W8; idle->run AR 0.048 m x4.7 (live 0.017); ADS-walk release 0.052 m (live 0.016); equip->aim AR muzzle 0.083 m x4.9 |
| T4 joint rate | FAIL (new) | juggernaut left elbow 12.1-18.4 deg/frame on strafeL/diag pistol, diag AR, run/strafe LMG, crouchwalk SMG (live 2.5-10.7) |

## Phase 2 defects recorded (do not fix in this phase)

- F1 foot slide: audit8's crude contact test (toe < 5 cm on two frames) reads planted-toe speeds of 2.9-3.9 m/s on run / strafe / back /
  diagonals on both builds (ratio over 20 cm/s 0.91-0.99), which says the contact detection itself has to be the Kimodo-style lowest-point
  test before numbers are trusted; p23_move skate rows and the gunhold pistol slide row are the current gates. Turn in place: 0.83 m/s mean,
  ratio 0.68 on both builds (feet slide while the body yaws).
- F2 clip speed vs ground speed: crouch-walk moves at 4.25 m/s on both builds on the rifle crouch set (play-rate clamp 0.4-2.6 allows far
  outside 0.80-1.20); ADS walk 3.8 m/s on the run set at 0.85x; run strafes use RUN_ON_STRAFE 4.6 / sprint strafes at 5.3 m/s.
- F3 cadence: not measured this round (needs foot-strike detection from F1).
- F4 foot IK on slopes / stairs: none in the game (no leg IK); not measured.

## Fix round 1 result (fix_r1, 2026-11-23; branch w10-anim-fix, evidence F:/lc_p23/w10/t/ANIM/fix_r1)

Tools: sweepR1.py (pistol chase sweeps swA-swD), capture8 --disk tags fixr1 / fixr1b / fixr1c (subsets, 5 skins, 0 console errors), aimrows.py,
analyze8 sections, w10_gunhold runs gh_full (all parts, 5 skins), gh_r2 / gh_r3 (re-runs after the last edits), gh_live (live trans references),
controls + gate.py set in chain_final.log. Numbers: build / live.

| Row | fix_r1 status | Evidence |
|---|---|---|
| S1 / V1 pistol ready | PASS | pistolReady back on live's gunReady rows, chest on the clip blade, muzzle canted 20 deg out; chase (16 samples) soldier idle 0.632 / 0.438, run 0.603 / 0.517, crouch 0.545 / 0.328, crouched 0.485 / 0.301, turn 0.505 / 0.269; viper idle 0.549 / 0.396, turn 0.426 / 0.167; juggernaut idle 0.085 (> 0; live 0) |
| S3 pistol run / crouch / strafe | PASS (design change) | the compact low ready and the one-hand run carry are retired: every swA / swB variant left them 0.00-0.24 visible; the two-hand ready now runs in every non-aimed pistol state |
| S7 backpedal / T3 body yaw | PASS (S7, T3) / owner decision for V1 | a gun out + moving > ~115 deg off the aim backpedals on the rifle back clips with the chest on the aim; body yaw rate-limited 8 rad/s (14 in combat), eased; t_run_back_ar body yaw 30 -> 0 deg/frame, strafe reversal 25.4 -> 7.6 deg/frame. Cost: the juggernaut's pistol backpedal is 0.068 visible vs live 0.466 (live turned the body to face the camera) |
| W7 / V3 sling | PASS (look) | a slung pistol sits in a right-thigh holster (muzzle down, from the skin's own hip joints); the scoped view hides the slung gun |
| A1 aim pitch / A4 head | PASS | mesh-space aim offset (0.75 of pitch over Spine/Spine1/Spine2, clamp 0.75 rad) + gaze after the hold + sight drop 0.3 m/rad + support slide on the guard at steep up-aim: gunhold aimpitch PASS 5 skins (support wrist 3-16 cm under the head top, butt <= 0.14 m from the joint, head follow 0.92-0.95; live 0.21) |
| W4 recoil | PASS | per-class rise + 2.5 cm push from the frame after the shot: kicks 2.8-5.9 cm (soldier smg 0.028, ar 0.057, lmg 0.059, pistol 0.032; were 3-7 mm); flash-tip still PASS |
| W8 throwable | PARTIAL | a grenade (same program as the thrown round) in the palm, its own ready pose, hidden from the release; the throw start no longer snaps (throw_frag rh 0.125 -> 0.096 m, x6.8 -> x1.1). Fingers do not close on it (no right-hand curl) |
| W6 swap | PARTIAL | swap 0.25 -> 0.45 s (lower, then draw up); pistol -> AR support hand 0.19 -> 0.04-0.05 m per frame (inertial blend incl. the support hand); the 0.8-1.5 s standard not reached (the 0.4 s ready delay is gameplay) |
| S14 hit | PASS (look) / partial number | directional mesh-space jolt on Spine1/Spine2 for every carry after the arm layers: pistol hands 0.000 -> 0.009-0.013 m; AR 0.013-0.017 (live 0.012-0.019) |
| T1 transitions | PARTIAL | <= live now: turn in place, crouch-in (AR / pistol), swap AR->SMG, throw start, equip->aim, jump (pistol); still worse than live: idle->run AR on soldier / wraith (0.039-0.042 m vs 0.015-0.016), crouch-out AR (0.033-0.043 vs 0.018-0.027), juggernaut crouch-in (gunhold crouch-pop FAIL), slide muzzle, run->sprint muzzle |
| W1 / B2 shotgun | PARTIAL | trigger elbow at the ready / aimed 47-61 deg (was 30-39), support elbow aimed 106-140 (was 86-88); running / crouched / backpedalling still 30-49 deg: the short stock cannot open it without the butt leaving the pocket (gunhold sghold FAIL) |
| D4 phones / LOW | PASS | gunhold lowlook PASS 5 skins (pistol gunReady in every state, no rifle hold, no chest squaring); the planted gate removal must FAIL (chain_final.log) |
| W2 / V3 ADS | NOT FIXED | the eye is now measured from Head -> HeadTop_End, but the ADS pose numbers did not move: the 0.10 m pocket clamp, not the eye estimate, sets the gun's height; needs a cheek-weld head tilt + an aim-camera visibility row |
| V1 sniper / viper long guns | FAIL (pre-existing on fix8, small) | sniper cells 0.001-0.021 under live; viper idle_ar 0.883 / 0.909, idle_lmg 0.793 / 0.854, run_lmg 0.758 / 0.794 (fix6 found no lever) |
| T4 juggernaut elbow | PARTIAL | support pole rate-limited to 7 rad/s; juggernaut left elbow max deg/frame (fixr1 / fix8 / live): strafeL pistol 12.8 / 18.4 / 10.7, diagBL pistol 9.7 / 18.4 / 10.7, crouchwalk SMG 3.1 / 15.4 / 2.5 (fixed, <= 1.25x live); diagFR AR 13.2 / 13.2 / 5.9, diagFL AR 12.1 / 12.1 / 5.7, strafeR LMG 12.4 / 12.8 / 7.3 (not fixed: the rifle-hold ready on the diagonals) |
| D13 fire from the ready | PARTIAL / owner decision | the ready rises in 0.07 s on a fire press (was 0.2 s); the first shot still leaves before the gun is up - holding it would delay first shots on desktop only (gameplay) |

## Check r1 result (independent QA of 4a822cee4, 2026-11-24; evidence F:/lc_p23/w10/t/ANIM/check_r1)

Captures: capture8 r1 (995 sequences x 5 skins, all views, 0 errors), r1low, r1t; live = audit8 live8 / live8low / live8t. Blind A/B on soldier,
athlete, juggernaut (blind/ranks.txt written before key.json; ranks_decoded.txt); wraith / viper unblinded. Verdict: FIX (not shippable).

| Row | check r1 | Evidence |
|---|---|---|
| V3 / W2 ADS camera | FAIL, worse than live | u_ads_game.jpg, u_wraith_viper.jpg: pistol behind the head on 5 skins, AR mostly hidden on athlete / viper / juggernaut; live shows both |
| W3 / D13 shotgun first shot | FAIL, worse than live | an_r1.txt FIRE: muzzle 0.23-0.34 m in the 6 frames after the first hip shot, 5 skins (live 0.03); blind S_hipfire_shotgun live better 2/3 |
| T1 transitions | FAIL, worse than live | trans_worse.txt: idle->run AR 5 skins (soldier 0.040 x3.5 vs 0.015), crouch-out AR 5 skins (athlete x12.9), run->sprint AR muzzle 0.120 x5.4 (3 skins), slide AR muzzle x2.8, idle->run pistol muzzle x2.6-2.7 (5 skins) |
| W1 / B2 shotgun trigger elbow | FAIL, worse than live | gate sghold 19 rows; soldier back 33.8 deg (live 50.4) |
| A1 / A4 long guns | PASS | blind adsup_ar / adsdn_ar fix better 6/6; head tracking 0.94-0.95 (live 0.21) |
| A4 pistol | FAIL (both builds) | head pitch tracking -0.39 (live -0.71): the head looks DOWN while aiming up; not in the aimpitch gate |
| S7 backpedal / W7 holster / V3 scope / W8 ready | PASS (blind fix better) | back_ar, back_pistol, ads_sniper, run_frag, ready_frag |
| S6 back-left pistol diagonal | FAIL (new) | diagBL_pistol plays rifle_sprint_left (sprint stride) at run speed on 5 skins |
| D4 LOW | differs from live | r1low: backpedal clip + body on aim, sprint low carry (0.33 m), far bots run clip (live walk clip); held grenade drawn on all tiers |

Phase 2 additions (record only): diagBL_pistol sprint-left clip stride vs ground speed (F2); pistol-row foot slide 1.21-1.31 m/s on wraith /
juggernaut / viper (F1).

## Fix round 2 result (fix_r2, 2026-11-24; branch w10-anim-fix, evidence F:/lc_p23/w10/t/ANIM/fix_r2)

Tools: gunhold.py (gate rows, 5 skins: gh_a.json / gh_a.log), live references measured with the same parts on 8ccb6efce (ghl_live.json),
sweep_r2.py (player.js / pose.js variants served over the tree: sw2.json, sw3.json), probe_run.py (cross-fade weights), capture8 --disk tag r2
(14 scenarios x 5 skins x all views, 0 console errors; sheet_r2.jpg). Numbers: build / live unless said.

| Defect | r2 status | Evidence |
|---|---|---|
| D2 W3 first hip shot | PASS (new row firstshot, 9 classes x 5 skins) | patrol ready pitch 0, cant -0.10 (was -0.05 / -0.18), pistol ready cant -0.10 (was -0.35): barrel on the shot frame AR / SMG / shotgun 9.17 -> 4.91 deg, pistol 17.18 -> 4.91 (sw2 base vs sw3 w3). Cost on the chase row: soldier idle_ar 0.841 / 0.869, juggernaut run_ar 0.279 / 0.314 (see V1 below) |
| D10 S6 back diagonals | PASS (new row diagclip) | a backward diagonal plays the back clip warped <= 45 deg (pistol and AR, BL and BR, 5 skins); was rifle_sprint_left on BL |
| D11 A4 pistol head | PARTIAL | pistol gaze (look-at on Neck / Head, cervical budget 60 deg): head follow -0.39 -> +0.47 aimed / +0.61 hip-ready (live -0.72); the aimpitch row (now incl. the pistol) needs 0.7: the rest needs the trunk to lean back with a pistol aim (spine aim offset on the pistol path) |
| D15 S4 pistol sprint | PASS (look) | out of combat on a sprint clip the pistol goes to the one-hand low carry with the free arm pumping (sheet_r2.jpg column 4, 5 skins) |
| D1 V3 aim camera | PARTIAL / FAIL vs live (new row adscam) | long guns: sight line 9 cm right / 3 cm under the eye, head cant 0.2 + nod 0.15 (eye ~8 cm from the sight line, the W2 limit): AR soldier 0.439 -> 0.570, juggernaut 0.108 -> 0.143, athlete 0.404 -> 0.349 (live 0.887 / 0.326 / 0.932); pistol aim in line with the right eye: soldier 0.296 -> 0.682, athlete 0.562 -> 0.800 (>= live), juggernaut 0 -> 0.05 (live 0.416). Live's share comes from a gun held at the chest (no cheek weld): matching it with a W2 cheek weld from this camera (1.7 m back, 0.95 m right, 0.25 m over the eye) is not reachable: OWNER DECISION (ADS camera framing per weapon, or accept) |
| D3 T1 transitions | PARTIAL | cause found for idle -> walk -> run: three.js crossFadeFrom restarts the clip it fades out at weight 1 when a switch lands inside a fade (walk's share 0.42 -> 0.65 in one frame); desktop medium+ near actors now cross-fade every base clip in flight on one smoothstep curve (probe_run.py: weights sum 1). gunhold T1 rows (neighbour-median ratio, 5 skins) still FAIL: ar/idlerun soldier x3.2, wraith x3.3, viper x2.5; pistol crouch in / out x2.2-3.6, pistol land x2.9-3.1, pistol idlerun x2.2, adswalk pistol x2.3-2.7, ar swap x2.2-2.3, land x2.0-2.1, juggernaut ar runsprint x2.6. Live on the same rows (older hips-bone frame, ghl_live): swap x7.3, land x22-44, pistol crouch x3.6-4.8, adswalk x4.2-4.6, ar idlerun x2.2-2.5 |
| D5 / D7 gate method | DONE | trans_eval = T1's own method (largest step -1..+40 frames vs the median of steps 2-4 frames around it, analyze8), right hand + LEFT hand + muzzle, from the Hips position in the drawn body's yaw; the bar is ratio <= 2 with no live escape (live reported for information); gate.py runs w10_gunhold on the 5 skins |
| D6 chase flake | DONE (method) | every running clip seeked to time 0 + 30 frames before 16 samples (a frozen clip counts as fixed); live re-measured with the same part (CHASE_LIVE2); burst / DMR / launcher cells and the aim-camera cells added. Noise band between two runs of one build: NOT measured yet (CHASE_NOISE = 0, the strictest) |
| D8 controls | DONE (registered) | gate.py NEGATIVE + aim-arms-only, low-gate-off, recoil-off, sg-fold, pistol-gaze-off, xfade-linear, diag-side, ready-cant-out, ads-centred. Not yet run in this round (sg-fold and ads-centred cannot discriminate while their rows FAIL on the build) |
| D9 shotgun trigger elbow | PARTIAL | the stock lengthened at load (weapons.js stretchStock, butt 0.07 m back behind the wrist; length 0.95 -> 0.993, lengths row PASS): soldier ready now >= 52, crouch 37.0 -> 46.6, run 46.4 -> 46.9; backpedal 33.8 -> 30.1 (worse: the back clip's shoulder). sghold FAIL 14 rows |
| D12 pistol strafe-left | PARTIAL | the arms posed as on the bladed idle by the missing blade (K 1.6): athlete 0 -> 0.099 (sw3); soldier / wraith / juggernaut / viper still 0.000 in gh_a |
| D16 Low | PARTIAL | the held grenade is drawn only on desktop medium+ near actors (weapons.js hidden by default); backpedal on the back clips and the sprint low carry on Low are live-broken exceptions (S7 / S4 FAIL on live): OWNER to confirm; far-bot walk / run clip difference not investigated |
| D17 aim-out | changed, not re-measured | RH_RDY_OUT_S 0.25 -> 0.2 |
| D18 W3 recoil | changed, not re-measured | RC_RISE pistol 0.09 -> 0.08, DMR 0.10 -> 0.085 (rise 4.6 / 4.9 deg). W3 is judged on the shot frame (before the kick); the kick is W4's designed motion |
| D4 / D6 / D13 / D14 / D19-D22 | NOT DONE | see the round report (owner rulings: swap time W6 0.45 s vs 0.8-1.5 s; juggernaut pistol backpedal; tierprof kb bar red on live) |

Chase row (gh_a, fixed phases, vs live CHASE_LIVE2): 38 cells under live, most by 0.001-0.03 (soldier idle_ar 0.841 / 0.869, athlete idle_dmr
0.862 / 0.886); larger: viper idle_lmg 0.785 / 0.860 (pre-existing), wraith crouch_pistol 0.524 / 0.566, athlete crouch_pistol 0.663 / 0.701,
juggernaut run_ar 0.279 / 0.314, juggernaut back_pistol 0.424 / 0.472; strafeL_pistol 0 on soldier / wraith / juggernaut / viper (floor > 0.05).

Phase 2 additions (record only): pistol-row foot slide on 5 skins in gh_a (wraith 1.21 m/s > 1.1).
