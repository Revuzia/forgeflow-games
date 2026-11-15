# LIFE: squishies that are a little bit alive

**Status:** final design, 2026-11-15 (the PLAYGROUND synthesizer). The decision behind it is DIRECTION D1: a pure-logic lane gives every character on
screen a small brain whose only outputs are intents; any touch overrides it at once. Read with [`PLACES.md`](PLACES.md) (the things and how each
family reacts), [`QUESTS.md`](QUESTS.md) (wishes, discoveries, the Journal) and [`PLAYGROUND_BUILD.md`](PLAYGROUND_BUILD.md) (contract, lanes,
budgets, checks). Paths are relative to `games/wobblehoard`.

**Owner asks this page serves:** ask 2 (things used "in their own way": the gaits, poses and family reactions), ask 3 (several squishies at once,
social and cute, with emotes and little voices), ask 4 (pieces join in, and the feedback stays calm with many characters).

---

## 1. The rules

| # | Rule | Why |
|---|---|---|
| L1 | **LIFE is pure**: `src/life/**` imports only `./`, `../core/`, `../data/` and `../contracts.ts` (types); no DOM, three, physics, render, audio, shell, timers, `Date.now`, `Math.random` or `performance.now`. Same seed and same snapshots give the same intents, bit for bit (LF-01, LF-12). | Determinism under the dev hook; node-testable. |
| L2 | **The player comes first.** A touch, grab, carry or lock on a character makes its brain HELD in the same step (section 5.5); player-caused feedback is never budgeted; while the player touches anything, other bubbles stop and other voices duck. | DIRECTION D1; C 5.4. |
| L3 | **Autonomy can never pay.** No intent kind presses, grabs or locks; every autonomous landing and prop bump carries `auto` and is dropped before `collection.feed`; the quest reducer never sees a meter function. A no-input hour earns 0 squish points, 0 task progress, 0 capsules, 0 gifts (EC-02). | DESIGN 5.4 (taps pay nothing; release and snap are the only paying kinds, `meterfeed.ts` 43-65). |
| L4 | **Mostly still, so bodies sleep.** Most behaviours do not translate the body: gaze, blinks, expressions, bubbles and the render-side lean and sway cost about nothing. Only scoot, hop, glide and the last centimetres to a contact are physics, and they need a mover token (section 10.3). | A resting awake body costs 0.69 ms, asleep it should cost about 0.02 (PHYS map 4, 6). |
| L5 | **One brain per whole squishy; a cut squishy keeps one brain** that leads its pieces as a group. | No messaging, no double booking; pieces add no brains (C R5). |
| L6 | **No guilt, no loss.** Needs exist only while a squishy is out and reset each time it comes out; nothing decays; a huff starts only from a squishy-to-squishy event in the scene, lasts at most 3 s and any touch turns it into a giggle. No "sad", "lonely", "grumpy", "hurt", "misses you", "come back" or "hurry" anywhere (LF-13, DT-02). | JUDGE_FUN F3, JUDGE_COHERENCE M4; DESIGN 8.4. |
| L7 | **Autonomy never vibrates the phone and never moves the camera.** | A buzz for something the player did not do feels broken (A pushback 2); M10. |
| L8 | **Eyes only.** Expressions are the two bead eyes (open, squint, sleepy lids, wide, gaze); no mouth, no blush. | REFERENCES.md 3; the art-direction rule. |

---

## 2. Personality: five traits, a pure function of the genome (`src/life/traits.ts`)

Never stored, so a merged, traded or restocked squishy carries its personality. `fv` = `feelOf(MATERIAL_FAMILIES[family].physics)` (materials.ts
439); `EYE_NOTICE` = wide 1, oval 0.6, dot 0.45, sleepy 0.15; `EYE_SLEEP` = sleepy 1, oval 0.25, dot 0.2, wide 0; `j` = a seeded twist of +-0.08 from
`mulberry32(seed ^ TRAIT_SALT)` (section 11). Each trait is clamped to 0..1.

| Trait (the Journal word) | Formula | Spread over the 50 templates (min / median / max) | Drives |
|---|---|---|---|
| bouncy | 0.55 bounce + 0.35 fv.bouncy + 0.1 [signature poke] + j | 0.17 / 0.52 / 0.89 | wander, boop, ball play, hop rate |
| curious | 0.45 stretch + 0.35 EYE_NOTICE + 0.2 fv.stretchy + j | 0.26 / 0.53 / 0.90 | notice, copy, peekaboo, the perception radius (1.2 + 1.0 x curious m) |
| cuddly | 0.5 (1 - firmness) + 0.3 fv.squashy + 0.2 [signature squeeze] + j | 0.10 / 0.39 / 0.84 | nuzzle, comfort, snuggle, nap piles |
| chatty | 0.25 + 0.35 EYE_NOTICE + 0.25 gloss + j | 0.38 / 0.65 / 0.82 | how often it speaks, sings and answers things |
| dozy | 0.6 EYE_SLEEP + 0.4 fv.slowRise + j | 0.07 / 0.37 / 0.82 | rest need, naps |

The spreads are mine, measured on 2026-11-15 with `speciesBaseGenome(id, 7)` and the real `feelOf` (no twist). The Journal shows the two traits
furthest above their medians ("Bouncy and chatty" for Dollop, "Dozy and cuddly" for Capnap, "Cuddly and dozy" for Wisplet). **Its loved touch** is
the catalog `signature` (poke 19, squeeze 20, pull 11 species, catalog.ts 88): that touch makes it beam.

---

## 3. Needs and moods (session state only, never saved)

Three needs, 0..1, per whole squishy **while it is out**. They start at play 0.3, company 0.3, rest 0.2 **every time it comes out** (a trip, the
shelf, a ceremony), so being away never makes a squishy needier. A need only ever chooses a behaviour or a wish, never a loss. Rates are per second
of sim time x (0.5 + the trait).

| Need | Rises | Falls | At 0.8 |
|---|---|---|---|
| play | +0.010 awake and untouched (x bouncy) | -0.3 a thing use; -0.4 its loved touch; -0.2 any touch; -0.4 a toss | a thing use, or a thing or ride wish |
| company | +0.008 when nobody is within 2 m (x chatty) | -0.5 any social moment; -0.2 a friend within 2 m; -0.3 a player touch | a greet, or a friend wish |
| rest | +0.004 awake, +0.010 while hopping or bouncing (x dozy); x1.5 in a warm zone or on a nap spot | -0.02 while napping (to 0) | a nap |

**Comfort** is not a need but the body's looks: frost, wet or soak, sand or snow over 0.5 make it seek the remedy (a warm zone, the sun, the
water) or show a remedy wish. **The mood** is derived for the face only, never shown as a word: happy (a joy event in the last 8 s), sleepy (rest
over 0.7), playful (play over 0.6), curious (a notice in the last 4 s), otherwise content.

---

## 4. Behaviours (`BEHAVIOURS` in `src/data/life.ts`, run by `src/life/brain.ts`)

Utility choice: the highest of base x trait x need, plus a seeded noise of +-0.05 and +0.15 for the current behaviour, after cooldowns; ties by
behaviour id, then character slot. **Moves?** = needs a mover token (section 10.3); "still" behaviours let the body sleep. W = whole, F = face
piece, C = chunk.

| Id | Behaviour | Trigger (score) | Moves? | Motion | Emote / voice | Ends | Cooldown | Who |
|---|---|---|---|---|---|---|---|---|
| B01 | idle | always (0.10) | still | breathing, blinks, a look about every 2.2..5.8 s | none | anything better | none | W F C |
| B02 | notice | a thing moves within 1.5 m, a body arrives, a land or bump within 1.5 m, or a new thing or squishy within the perception radius not seen this visit (0.9, once per target per visit) | still | gaze within 0.15 s, then a render lean of 0.06 R toward it | question if curious > 0.5; a rising chirp | 1.5 s | 4 s per source | W F |
| B03 | wander | play > 0.3, nothing of interest within 1.5 m, untouched 4 s (0.3 + 0.4 play x bouncy) | moves | gait steps to a point inside bounds - (R + 0.2), outside the things' 0.4 m keep-outs | none | arrived, or blocked 2 s | 6 s | W F |
| B04 | use a thing | play > 0.4 and a free floor-usable thing within 3 m (0.3 + 0.5 play + 0.3 [favourite] + family affinity) | moves, then still or riding | walk to its use spot, then the mechanism use (5.3) in the family's way (PLACES 3, 4) | the thing's icon (ball, bell, star, droplet, note); a joy call | the use is done (3..12 s), or rest > 0.8 | 15 s per thing | W F |
| B05 | bask or warm up | a comfort look > 0.5 with a remedy zone within 3 m, or a warm zone within 2 m and dozy > 0.5 (0.7) | moves, then still | walk in, then the family's warm pose (PLACES 2.4) | sun, flame or droplet | the look under 0.1, or 15 s | 20 s | W F |
| B06 | nap | rest > 0.75, or dozy > 0.6 with a nap spot within 2 m (0.8 + 0.4 dozy) | moves, then still | walk to a nap spot (a ring, a rug, a warm corner) or beside a sleeping friend; settle; **the body sleeps** | sleepy eyes; one zzz (one per pile) | a touch; rest < 0.1 after 30..90 s; a toss landing within 1 m (it wakes with a blink) | 30 s | W F C |
| B07 | show a wish | the wish scheduler gives it a slot (QUESTS 8) (0.7) | still | face the camera, one small hop (a squash pulse for families that do not hop) | a thought bubble with the wish glyph; an asking phrase | granted; it goes back to the shelf (the wish rests in the Journal) | QUESTS 8 | W F |
| B08 | afterglow | the player released, snapped or poked it (1.0) | still | spring back (physics), gaze to the camera | its loved touch: sparkle and a happy squint, a chirp an octave up (+1 warmth, at most 3 a day); else a giggle 40% of the time | 1.5 s | none | W F C |
| B09 | arrive | a trip ended, or it came out (1.0) | one hop | one arrival hop (a pulse for non-hoppers); a NEW squishy keeps 0.5 m of extra distance and looks down between glances for 20 s (the shy arrival), and still says hello within 5 s from where it is | one shared sparkle for the party | 1 s (20 s shy) | per visit | W F C |
| B10 | love its place | its first 10 s in its favourite place, once per visit (0.95) | still | a big squash and stretch pose, a render wiggle at 3 Hz for 0.6 s | sparkle; the joy call | 2 s | per visit | W F |
| B11 | come back | outside bounds - 0.4 m after a toss (1.0) | moves | gait back toward the middle | none | inside | none | W F C |
| B12 | pose | the Snap tool is in hand, or "Pose!" is pressed (1.0) | still | stop, face the camera, happy eyes | one sparkle | the tool changes | none | W F |
| B13 | watch | the player touches another character within 3 m, or a cut starts nearby (0.6) | still | gaze at it | one shared wow if it is tossed or cut | the touch ends | none | W F |
| B14 | cheer | a quest completes, a squishy is whole again, a friend arrives (shell-scripted, 1.0) | one hop | one small hop | star or sparkle; a trill | 1.2 s | none | W F |
| B15 | zone reaction | its first entry into a warm, cold, wet, water or wind zone this visit (0.95) | still | the family pose and look (PLACES 2.4, 3.1) | sun, flame, snowflake, droplet or bubbles | 2..4 s | per zone per visit | W F C |
| B16 | huff | ONLY a squishy-to-squishy scene event: another squishy took the ball it was chasing, or the seat or spot it was walking to (0.5) | still | turns away 30 degrees (render lean) | puff; one low coo | at most 3 s; any touch or a greet from the other turns it into a giggle | 5 min; never in a session's first 60 s | W |
| B17 | comfort | a Met-or-closer friend within 2.5 m is chilly (frost > 0.5), soaked (> 0.5) or just huffed; cuddly > 0.4 (0.85) | moves | walk over, lean in, the last centimetres by a slow glide to contact | snug; a low hum, the other answers higher | 3 s | 30 s | W F |
| B18 | answer a thing | the kettle sings, the clock chimes, a tune plays, the echo stone is on; chatty > 0.5 (0.7) | still | gaze at the thing | its own call answers the thing (Use LISTEN) | the phrase ends | 20 s | W F |
| B19 | hold on | a wind gust while it is on the ground (0.8) | still | a render lean into the gust (0.08 R), squinting eyes | none (a gust is not worth a bubble) | the gust ends | none | W F C |

**Pieces** run their own small set (section 9): P01 follow, P02 huddle, P03 hop together, P04 join in.

---

## 5. How a squishy moves by itself

### 5.1 The primitives (physics drivers on contracts.ts PLAYGROUND; render poses on StageLike)

| Primitive | Exact recipe | Cost and safety |
|---|---|---|
| **Scoot** (travel) | `moveTo(target, stiffness = speed / 3)` at the family glide speed (5.2) + the gait overlay: squash pulses at the step rate and, for hopping families, a small hop per step + a render lean of 0.05 R toward travel | no airtime from the glide; the glide is not in V, so the rest test also checks drivers (PHYS map 4) |
| **Hop** | `setSquash(anticipation, 0.12)`, then 0.12 s later `hop(vx, vy, vz)` (glue and peel suspended for 10 substeps); in the air the squash eases to 1.06; landing is physics. **S1 cap: vy at most 0.84 m/s (apex 3.5 cm, landing 0.84 m/s, under the 0.9 m/s `land` threshold), and every landing is `auto` anyway.** At most one hop per 0.8 s per body | PH-01 gates it per family x 3 genomes and 1/8 pieces |
| **Glide** | on a patch with grip under 0.5: one `nudge` of 0.6..1.0 m/s horizontal; friction and the place's drag carry it | real momentum: the ice fun is physics |
| **Pose** | `setSquash(target, 1.5)` for warm, cold and rest poses (PLACES 2.4); ended by any touch; putty, mochi dough and bead squeeze only while their memory has converged (5.4) | a pose that has converged is a fixed goal, so the body can still sleep |
| **Render pose** | `setBodyPose`: a lean at most 0.1 R; a sway at most 0.05 R at at most 4 Hz (sing, nuzzle, the clock's beat: the phase comes from `musicClock`); a shiver 7 Hz at most 0.015 R for 0.5 s; slow breathing while asleep | about zero physics cost, so a sleeping body can sing and sway (JUDGE_FEASIBILITY F16); the eye anchors follow it (RD-11) |
| **Contact** | the last centimetres of a nuzzle, comfort or pile: `moveTo` at 0.08 m/s until a contact starts (a bump or a gap under 0.03 m), then stop | the only physics part of a nuzzle |
| **Settle** | release every driver; physics sleeps after its rest test (PLAYGROUND_BUILD.md 8.6) | |

### 5.2 The twelve gaits (`GAITS: Record<MaterialFamilyId, Gait>` in `src/data/life.ts`)

A gait is data on the primitives: how deep the anticipation squash is, the hop speed, how often it steps, how fast it glides, and whether it hops
at all. **S2 raises the hop** for each family that passes PH-01 with `auto` landings (normal 6 to 8 cm, vy 1.10 to 1.26 m/s; big 12 cm, vy 1.55,
for firm silicone and pop dome); until then every family stays at the S1 cap. The JUDGE_FUN worry that 3.5 cm is too small to read (F7) is answered
in S1 by the squash and stretch around each hop (an 18 to 25% squash, then 6% stretch in the air), which reads more than the height, and in S2 by
the raised hop (PLAYGROUND_BUILD.md decision D-07).

| Family | Gait | Anticipation squash | Hop vy S1 (S2 after PH-01) | Steps per s | Glide m/s | Mode and character |
|---|---|---|---|---|---|---|
| slowrise | sink | 0.78 | 0.60 (0.90) | 0.5 | 0.18 | long squash, small rise, lands flat and rises slowly |
| marshmallow | pad | 0.75 | 0.70 (1.10) | 0.9 | 0.22 | deep soft squash, a floaty-looking hop |
| mochidough | plod | 0.90, only with its memory converged | 0.45 (0.60), at most 1 hop per 6 s | 0.6 | 0.18 | leans, then a small hop; glides otherwise |
| jellygel | jiggle | 0.84 | 0.80 (1.20) | 1.2 | 0.26 | a medium hop and a long wobble after landing |
| waterfill | slosh | 0.86 | 0.70 (1.00) | 0.8 | 0.22 | a low hop; it waits for its slosh to settle before the next |
| putty | shuffle | none | never hops | 0 | 0.12 | leans toward the target and glides (a hop would set a dent: PHYS map 7) |
| stickystretch | peel | 0.85 | 0.75 (1.10) | 0.9 | 0.20 | a hop with the glue only half suspended: a visible peel off the ground |
| slimegoo | ooze | none | never hops | 0 | 0.10 | leans and glides, leaving a trail mark |
| firmsilicone | boing | 0.88 | 0.84 (1.55 big) | 1.4 | 0.32 | quick hops, a double bounce on landing |
| popdome | bob | 0.90 | 0.80 (1.40) | 1.1 | 0.28 | short stiff hops, lands flat |
| gummy | chew | 0.86 | 0.75 (1.20) | 1.6 | 0.28 | quick small hops |
| beadsqueeze | crunch | 0.86, only with its memory converged | 0.70 (0.90) | 0.8 | 0.22 | a low hop, a crunch tick on landing |

Pieces hop at vy x 0.8, apex at most 3.5 cm in every slice, horizontal x cbrt(frac). Calm or reduced motion: hop heights x 0.6, at most 3 hops in a
chain, no wiggle above 2 Hz, no bubble bob (JUDGE_COHERENCE M24).

### 5.3 Using each mechanism (PLACES 2.1)

| Mechanism | By itself | With the player |
|---|---|---|
| ring (nest) | walk in through the gap, settle, nap | drop or toss it in |
| rug, moss bed, warm corner (nap patches) | walk on, settle, nap | carry it there |
| pad | walk on, one small hop; the pad's gain does the rest (at most 5 bounces) | drop it on |
| turntable | walk on, ride round (friction with the surface velocity) | set it on; wind the motor |
| ball | walk or hop into it toward a partner or a target; chase it | flick it (`PropWorldLike.poke`) |
| chime, bell, crystal, lantern | bump past it (a contact strikes it) | tap it |
| pool, puddle, dish | walk in and out anywhere; floaters float, the rest wade (PLACES 2.5); a puddle jump is one small hop that lands in it | toss or carry it in |
| block, bar, mound | lean on it; peekaboo around it; parade under an arch | set it on a mound (it slides off) |
| swing | push a friend's seat from behind (floor level) | **ride**: set it on the seat, poke to push |
| seesaw | two on it teeter by themselves: small hops in turn (a hop from a supported prop face, PLAYGROUND_BUILD.md 8.3) | **ride**: set two on the ends |
| ramp, raft, mound top | watch and cheer when another slides | **ride**: set it at the top or on it |
| switch | never; it watches, and answers a tune | tap it |

A squishy that wants a ride shows a **ride wish**: a star in a thought bubble beside the ride (QUESTS 8). Granting it (the player sets it there) is
the purpose; the slide or swing gets a cheer from the others.

### 5.4 Memory families (putty, mochi dough, bead squeeze)

No LIFE squash, pose or hop while the family's plastic memory has not converged (max |MEM - Q| over 0.02 R, physics reports it as the `MEMORY_BUSY`
flag), so a Stamp print, a dent or a stud print heals exactly as FUN 1 and CUT 1 say; they still glide, lean (render) and use things. Putty never
hops at all. (JUDGE_COHERENCE M9.)

### 5.5 What the player's touch does to the brain

**HELD = fingers > 0 || grabbed || carried || locked > 0** (SoftMetrics, contracts.ts; LOCK.md 3 counts a lock as a hand). In the same step: its
queued intents are dropped; the physics touch gate eases every LIFE driver out within 0.12 s (a hard cut would pop the goal under the finger); its
gaze goes to the pointer; it issues no autonomous bubble or voice. **On release:** B08 afterglow for 1.5 s, then **1.5 s of grace** before any new
LIFE motion, so the player can keep playing. A partner in a joint behaviour waits 2 s, then does a small "your turn" hop. A toss landing faster
than 3 m/s shows a swirl and a little wiggle; three tosses within 20 s give "a little dizzy" and 5 s of rest. **Play never causes a huff.**
**Pressing another party member is not switching squishy:** the first body keeps its locks and its pieces (JUDGE_COHERENCE M8; LOCK 3 and CUT 2
release on switching through the switcher, the Hoard or a tool, on travel, a capsule, a merge and a tab hidden over 60 s).

### 5.6 When LIFE is quiet (no new motion; gaze, expressions and needs keep working)

A ceremony; a cut neck or join; **any non-Hand tool in hand** (Cut, Snap, and the queued Stamp and Roll: with Snap they pose, B12); the Travel or
Journal sheet open; the desktop Hoard holding input; a hidden tab. Calm effects do not quiet LIFE; they lower the caps (section 10).
**"Squishies move on their own" off:** LIFE keeps gaze, expressions, bubbles, voices, wishes and reactions (looks only), and issues no hop,
squash, pose, glide or `moveTo`.

### 5.7 Keeping squishies inside the place

Three layers: physics `setBounds` (the corral's brake and rim bounce about the place's area, replacing the home spot for LIFE bodies; `setHome`
moves the home to where a body last rested); LIFE never targets a point outside the bounds shrunk by R + 0.2 m, nor inside a thing's 0.4 m
keep-out except its use spot; walls and parapets are static boxes (LF-06, PH-18).

---

## 6. Social play

### 6.1 Pair and group moments

"n" counts characters, and **pieces count** (a low-tier player can reach 4 with pieces). Points go to the species pair (6.2). Every joint moment
reserves its movers and units together or does not start, and no character is in two joint moments at once (LF-10, LF-11).

| Id | Moment | Starts when | Emote | Voices | Physics | Ends | Points |
|---|---|---|---|---|---|---|---|
| S01 | greet | another whole within 1.6 m, this pair not greeted this visit | hello on both | the first two syllables of its motif; the other answers 0.35..0.7 s later with the same rhythm, the contour mirrored | one hello hop toward it (or a lean) | 2.5 s | +1 once per pair per visit |
| S02 | chat | two met squishies within 1.5 m, both idle | none (the voices carry it); hello on the first only | 2..4 alternating syllables from each one's motif | small leans toward each other | 3..5 s | +1 a chat, at most 3 a visit |
| S03 | boop | bouncy > 0.6, another idle within 1.2 m | giggle on the booped one | a chirp, then a giggle trill | a hop into it at 0.4 m/s (a soft bump of intensity about 0.13) | the wobble settles | +1 |
| S04 | nuzzle | both idle within 1.0 m, and Friends or closer, or either cuddly >= 0.6 | snug (with the sparkle badge for best friends) | purr, purr back (a duet in thirds for Friends) | both lean 0.1 R toward each other; the last centimetres to contact | 3..6 s | +2 |
| S05 | copy, follow the leader | a curious one within 2 m sees a hop or a thing use; with 3 or more and a leader with bouncy >= 0.6, a little parade | star on the copier (on the leader for a parade) | the copier repeats the leader's phrase one step higher; a chirp at each turn | the same action 0.6 s later; a parade loop with 0.7 m gaps | 3 copies, or the loop is done | +1 (each neighbour pair in a parade) |
| S06 | sing together | 2+ idle within 2.5 m of a tune (Music Box, the kettle's song, a tapped chime row, the hearth's fire puff) or 2 chatty friends, once per 2 min per place | one shared note bubble | each sings its motif on the sounding field's rest tones, on the eighth grid, for 2 bars (section 8.5) | a render sway on the beat | 2 bars (7.3 s at 66 BPM) | +1 per pair, at most 3 pairs a song |
| S07 | snuggle | 3+ awake and happy in contact for 6 s (the beach finale's row) | one shared snug | a soft hum fading | leaning in contact | 8 s | +1 per touching pair |
| S08 | nap pile | 2+ napping in contact (B06) | one zzz for the pile | one soft yawn, then silence | contact, then sleep as one island | a touch wakes one; the rest wake over 1..3 s | +1 per pair per pile |
| S09 | comfort | B17 | snug, then a sparkle on both | a low coo, then a rising chirp | walk over, lean in | 3 s | +2 |
| S10 | teeter | two on one seesaw (set there by the player) | swirl | a trill at each tip | small hops in turn rock it | 6..12 s | +2 |
| S11 | push the swing | one on a swing or hammock (set there by the player) and a friend near | star on the pusher | a coo from the rider at each swing | the pusher walks into the seat from behind | 3 pushes | +1 |
| S12 | pass the ball | two within 2.5 m of a ball, one bouncy > 0.5 | ball | a chirp at each touch | each boops the ball toward the other | 3 passes, or the ball stops | +1 |
| S13 | peekaboo | two on opposite sides of a block, bar or mound | question, then sparkle | a rising chirp, a giggle | lean out and back 2 or 3 times (render) | 4 s | +1 |
| S14 | squirt game | **the player** squeezes a soaked foam with another squishy within 1.2 m in front of it | wow on the target, then giggle | a splash, the target's surprised chirp | a 12-drop spray arc (4 in Calm) in 0.4 s; target wet +0.3; the foam's soak -0.4 | 1.5 s | +1 |
| S15 | twin dance | two of the **same species** within 2 m, once per visit | sparkle on both | a unison hum | mirrored hops with no delay | 4 s | none (a discovery, QUESTS 9) |
| S16 | echo talk | in Echo Hollow, a squishy calls and hears its echo | hello | its call, the echo, then its own answer to the echo | none | 2 exchanges | +1 with whoever answers too |
| S17 | duet | Friends or closer, both present and free, once per visit | snug with notes | a two-voice phrase in thirds on the pair's own 2-note call | a sway | 2 bars | +2 |
| S18 | twirl | Close friends, once per visit | snug with the sparkle badge | a duet with a held last note | two hops each around one another | 3 s | +2 |

### 6.2 Friendship (per species pair; QUESTS keeps it in the journal)

Per **species pair**, so it survives merges and trades and the player learns "Dollop and Crimpo are friends". **Levels:** Met (1 point), Friends (12),
Close friends (40). "Best friends" is reserved for the 25 authored pairs (PLACES 5): a fact you discover, not a level. **Pace:** at most 20 points per
pair per UTC day (a best-friend species pair earns x1.5 before the cap); never decays. Two squishies out together for 15 minutes earn about 8 to 12
points (a greet 1, chats 3, nuzzles 2 to 4, a song 1, a pile 1, a ball game 1 or 2), so a pair becomes Friends within the first session, and Close
friends takes at least 2 days. **Unlocks:** from Met, the basics: greet with call and answer, chat, boop, and a nuzzle for cuddly ones; Friends: a
nuzzle for every pair, comfort, their own 2-note duet call, nap side by side first; Close friends: the twirl, a 3-part harmony with a third friend, a
ribbon on their row in the Journal. **Storage:** sparse rows [species idx low, species idx high, points] (at most 128 of 1225 possible) plus today's
points per pair; when full, the Met-only pair with the fewest points is dropped, never a best-friend pair and never a pair at Friends or closer.

### 6.3 Warmth (per squishy instance; the word "Heart" already means the Hoard's protection mark, DESIGN 5.6)

0..50 points per Hoard item (at most 100 items, the shelf cap), shown as **5 glow dots** (at 5, 15, 25, 35 and 50). +1 for its loved touch (at most 3
a day), +3 for a granted wish, +2 for a visit to its favourite place (once a day), +1 for a nap in its favourite place (once a day). **Never falls.** A
merge result takes the **larger** parent's warmth (JUDGE_FUN F5). Unlocks: 1 dot, no shy arrival; 3 dots, it hops toward the camera when you bring it
out; 5 dots, a faint sparkle trail on its hops (at most one every 2 s, off in Calm). Pieces have no item id: their deeds count for the parent.

---

## 7. Squishmoji: our own drawn emotes (D2)

### 7.1 The 24 icons (`EMOTE` ids in `src/data/life.ts`; drawn as SDF shapes in one fragment shader, `src/render/emotes.ts`)

Each icon is at most 4 primitives (circle, ring, segment, arc, triangle) in the UI.md icon family's style (one stroke width, rounded terminals,
`UI.md` 33): ink line art with one token accent fill, inside a cream bubble. **There is no heart icon:** "Heart" is the Hoard's protection mark,
with a ♥ glyph and a "Hearts" filter (`src/ui/hoard/panel.ts` 216, 267, 357; DESIGN 5.6), so a heart bubble would read as "this one is hearted".
Affection is **snug**. This deviates from DIRECTION D2's example list on purpose (JUDGE_FUN F6, JUDGE_COHERENCE M5).

| Id | Name | Drawing | Accent | Meaning (shown when tapped) | Used by |
|---|---|---|---|---|---|
| 1 | snug | two round blobs leaning together | coral | "I like you" | nuzzle, comfort, snuggle, a friend wish |
| 2 | hello | three short nested arcs | lagoon | "Hello!" | greet, the echo |
| 3 | giggle | a wavy squiggle | amber | "Hee hee!" | boop, a huff that ends, the squirt target |
| 4 | sparkle | a four-point twinkle | amber | "Ooh, wow!" | discoveries, arrival, a granted wish, its loved touch |
| 5 | question | a curl and a dot | lagoon | "What's that?" | notice |
| 6 | wow | a burst ring and a dot | amber | "Oh!" | a splash, falling snow, a cut nearby, a fast slide |
| 7 | zzz | three small z strokes stepping up | dusk | "Sleepy..." | nap, nap piles (once at the start) |
| 8 | note | an eighth note | lagoon | "La la la!" | singing, tunes |
| 9 | star | a five-point star | amber | "I did it!" (in a thought bubble: "A ride, please!") | after a ride or a long glide; the ride wish |
| 10 | swirl | a spiral | dusk | "Whee!" | a toss, a slide, a turntable, a teeter |
| 11 | puff | a small cloud puff | dusk | "Hmph!" | the huff (at most 3 s) |
| 12 | sun | a disc with 8 short rays | amber | "Warm and happy" | the sun, the lamp, basking |
| 13 | flame | a teardrop flame | coral | "Toasty!" | the hearth, the chimney |
| 14 | snowflake | six short spokes | lagoon | "Brr, chilly" | cold zones, frost |
| 15 | droplet | a teardrop | lagoon | "Splash!" | water, rain, puddles, a soak |
| 16 | bubbles | three circles of three sizes | lagoon | "Fizzy!" | floating, the bath, the bubble patch |
| 17 | leaf | an almond with a midrib | felt and lagoon | "So calm" | the garden, calm moments outdoors |
| 18 | moon | a crescent | cream outline | "The moon!" | moon gazing, bedtime, the night places |
| 19 | ball | a circle with a seam arc | amber | "Let's play!" | pass the ball; a play wish |
| 20 | bell | a bell outline and a clapper | amber | "Ding!" | chimes, bells, crystals, lanterns |
| 21 | shell | a fan of five ribs | coral | "A shell!" | Ripple Shore |
| 22 | postcard | a small card with a sky band | the place's sky band | "I want to go somewhere" | place wishes only (the card names the place) |
| 23 | squeeze | two soft brackets pressing a dot | coral | "A slow squeeze, please" | touch wishes only |
| 24 | stretch | a dot with two rounded arrows out | coral | "A big stretch, please" | touch wishes only |

Bubble flags: a small **sparkle badge** on a snug bubble for close friends and best friends; **count dots** (1 to 3) on a group bubble. Wishes reuse
these icons inside a thought bubble (no extra wish glyphs: 24 icons in all, JUDGE_FUN F21).

### 7.2 Bubble rules

- **Styles:** say (round, a tail toward the body); think (round, three trailing dots: wishes only); group (a double outline, a smaller icon, count
  dots for pieces). Fill cream at 0.92 alpha, ink icon, a 1.5 px plum outline (it reads on night places, where a plum fill would vanish); the
  edge stands at least 3:1 against every place's sky pixels (RD-04).
- **Size:** at least 36 CSS px on a phone with a 22 px icon; 40 px with a 26 px icon on a desktop; a group bubble x0.85; a wish 40 / 46 px.
  "Phone" = a coarse pointer or the short viewport side under 600 CSS px (one boolean from the shell).
- **Anchor:** 1.3 x rest radius above the body's top, inside the HUD safe insets and the frame room, stacked upward when two overlap, slid clear of
  the capsule like the hint pill; never over the reveal plate; off-screen characters show none.
- **Motion:** in 0.15 s (scale 0.6 to 1.0 with a 6% overshoot), hold 1.6 s, out 0.25 s. Calm and reduced motion: a 0.25 s fade only. Never a flash
  (alpha only, no white burst). **Nothing bobs or pulses, ever.**
- **Repeats:** at most one bubble per character; the same icon from the same character or group is dropped within 4 s.
- **Wishes:** stay until granted; at most **two re-glances** (a 0.2 s grow at 8 s and at 30 s after showing), then a still 14 px dot (it counts
  0.25 of a bubble); a tap, a hover or keyboard focus grows it again. No periodic re-show (JUDGE_COHERENCE M18).
- **Tapping:** a tappable bubble (a wish, or any bubble while the "Tap a bubble" quest is open) has a **44 x 44 CSS px DOM hit area** placed from
  `StageLike.emoteScreen`, never over the body's silhouette (a press that starts on the body is always a poke; CS-09). A tap shows its meaning
  for 2 s; a wish tap shows the wish card (QUESTS 13), which always **names** the friend or place (never colour only; CS-11).
- **Words:** the first three bubbles a new player sees carry a one-word label under them ("curious", "hello", "loves it"); after that only with
  "Words under bubbles" on. Labels are DOM, `aria-hidden`, and join the Snap hide list.
- **Photos:** bubbles are 3D, so they are in Snap photos by default; the Snap bar's "Bubbles in photo" switch turns them off (JUDGE_FUN F16).
- **Sound off:** every voice phrase has its bubble (the total table of section 8.4; UI-03). A wish is also told once in the polite live region
  ("Dollop has a wish: a warm place"), at most once per 20 s.

---

## 8. Voices (procedural; no samples, no words; `src/audio/creature.ts`)

### 8.1 The cheapest phone voice

One oscillator with a cached `PeriodicWave` per flavour, one envelope gain, one formant biquad, and a panner only when the voice is off centre: 3 or
4 nodes, contours by `frequency` and `detune` automation only, never extra LFO nodes or a DelayNode (AUDIO map 5; a DelayNode echo broke
reproducible renders, SOUND.md).

### 8.2 Syllables, the species motif and pitch

**Syllables** (`SYL` ids): chirp (a rise of 5 semitones in 90 ms), coo (a fall of 4 in 160 ms), purr (flat 180 ms, a 28 Hz amplitude flutter by a
precomputed gain curve), hum (flat 220 ms, +-15 cents vibrato), trill (3 notes of 55 ms up the pentatonic scale), yawn (500 ms, a slow 3-step fall
with a breath of noise), chitter (4 x 40 ms falling), peep (pieces: a 45 ms blip).
**The species motif:** 3 syllables and 2 intervals (-2..+2 pentatonic steps) from `mulberry32(hashString(speciesId) ^ MOTIF_SALT)`, the syllable
types weighted by flavour (foam: coo, purr; firm: chirp, trill; gel: chirp, coo, hum; sticky: chirp, coo; beads: trill, chitter; dough: hum, coo).
**Every Dollop has the same three-note call**, at its own pitch, so a child learns who is calling; the Journal's "Its song" fact has a play button.
**Pitch:** a whole squishy's base is D5 (587 Hz) x `pitchRatio(genome)` (genome.ts 140-144, about 0.70 to 1.43), snapped to the nearest D major
pentatonic note (D E F# A B) from A4 to D6 (440 to 1175 Hz); in a cold place one semitone lower before the snap. Pieces: x `popSize(frac)` =
(0.5 / frac)^0.4 (audio/cut.ts 129), snapped from D6 to D7 (1175 to 2349 Hz), 7 dB quieter, above the mallet's top note. Always snapped, music on or
off; the pentatonic is safe over all four music fields (AUDIO map 1).
**Timbre** by the six flavours of `FAMILY_FLAVOUR` (audio/cut.ts 35-41): gel clear (harmonics 1, 0.3, 0.1); sticky nasal (1, 0.6, 0.5, 0.3, a band-pass
at 1.6 kHz, Q 3); foam breathy (1, 0.15 and 20% noise through a band-pass at 2f); beads grainy (3 ms ticks at the onset, a 12 per s flutter); dough
dark (1, 0.5, 0.2, a low-pass at 1.2 kHz); firm bright (1, 0.7, 0.5, 0.4, 0.3, a small upward onset chirp).

### 8.3 Phrases, call and response, the pair duet, the echo, the group voice

| Phrase | Made of | Meaning (and its bubble with sound off) |
|---|---|---|
| greet | the motif's first two syllables | hello (hello) |
| answer | the caller's rhythm, its contour mirrored, a pentatonic third or fourth away, 0.35..0.7 s after the call ends (seeded) | hello back (hello) |
| chat | 2 or 3 syllables from its motif, alternating with the partner | chatting (none: a chat is never budget-critical) |
| joy | the motif and a rising trill | happy (sparkle or star) |
| loved touch | a chirp an octave up | its loved touch (sparkle) |
| sleepy | one slow falling coo, then silence | sleepy (zzz) |
| wish | the motif ending on an upward chirp | asking (the wish bubble) |
| granted | a trill up and a hum | thank you (sparkle) |
| sing | the motif's notes taken from the sounding field's rest tones, on the eighth grid, 2 bars | singing (note) |
| huff | one low coo, 5 semitones down before the snap | hmph (puff) |
| comfort | coo, coo; the other answers higher | there, there (snug) |
| peep | pieces: one 45 ms blip (a group voice for several) | pieces at play (the group bubble) |
| answer a thing | the motif aimed at the kettle, the clock or the tune | answering (note) |

**The pair duet** (Friends and closer): a 2-note call fixed for the pair, from `mulberry32(hashString(a) ^ hashString(b) ^ DUET_SALT)`, sung in thirds.
**The echo** (Echo Hollow): one scheduled repeat at +220 ms, -12 dB, low-passed, counted as half a voice. **The group voice** (pieces): one voice
with 2 or 3 detuned oscillators (+-10 cents) at one piece's level + 2 dB, never N voices.

### 8.4 Harmony and the mix

**Harmony** only in Sing together, the duet and the finales: `musicClock` gives the SOUNDING field and its bar time (the harness readout runs up to a
bar ahead, AUDIO map 1); each singer takes a different rest tone of that field (root, fifth, ninth), enters on the next bar line, and sings on the
eighth grid for 2 bars; at most 3 singers voiced on a desktop and 2 on a phone (the rest sway). With the music off it uses the home field on its own
66 BPM grid. **Levels:** a whole squishy's syllable peaks at most -20 dBFS at Voices 100% (about -24 dBFS at the default 60%); pieces 7 dB lower; a
player's effect must stand at least 8 dB in-band and 10 LU above chatter (AU-03). **Mix rules:** a new `chatter` input gain created after `music`
(the harness labels the first three gains, AUDIO map 1); creature kinds are never in `ROOM_KINDS`, so the music never dips for chatter; priority -1
(stolen before any player sound); its own rng stream (`CHATTER_SALT`; never a draw from `engRng`, so every existing seeded render stays bit-exact,
AU-07); silent during ceremonies and for 1 s after (the ceremony owns the moment, and its C-rooted motifs would clash, AUDIO map 6); while the
player touches anything, other voices duck 6 dB and slow to 1 syllable a second until 0.6 s after the release. **Sound off:** every phrase maps to
the bubble in the table above (UI-03 checks the table is total).

---

## 9. Pieces

| A piece can | A piece cannot |
|---|---|
| scoot and hop (vy x 0.8, at most 3.5 cm), lean, glide on ice, float or wade by its family, react to zones (looks and poses scaled by size), ride and bounce on things, roll a ball, ring a chime, nap in a pile, join a song as part of one group voice, count toward a quest's group size | gaze or make expressions (chunks have no face, eyes-only rule), wish, huff, greet on its own, sing a solo, gain friendship or warmth of its own (its deeds count for the parent), climb, wander more than 1.2 m from its face piece |

**One brain, one bubble, one voice.** All pieces of one squishy form one **group** under its one brain; the face piece keeps the eyes, the traits
and the needs and leads. A group has at most 1 bubble (with count dots) and 1 group voice at a time; piece events of the same kind within 0.5 s
merge into that one bubble; piece-to-piece bumps inside a group are silent unless the player caused them. **Only one squishy is in pieces at a
time** (CUT.md 2 rule 4 limits pieces of ONE squishy; cutting another party member first reconnects the first, animated).
**Group moves:** P01 follow (a chunk more than 0.6 m from the face piece scoots behind it: a little line like ducklings); P02 huddle (the face piece
idle for 20 s: the pieces gather within 0.6 m, a gentle gathering, never sad); P03 hop together (a jiggle wave, hops staggered 0.12 s); P04 join in
(copy a nearby whole squishy's thing use as a group).
**On a cut:** cutting is play. The brain stays (on the face piece); the mood is "surprised" for 2 s (one "oh" group bubble, wide eyes on the face
piece), then "playful"; needs freeze except rest; every other party member gives **one shared wow** and the most curious walks over to look. No
comfort after a cut and no "whole again" wish (JUDGE_FUN F4). **Whole again:** one sparkle and a trill (B14), and up to two friends nearby cheer with
one shared sparkle; discovery "its pieces like to play" the first time the pieces used a thing (QUESTS 9). LIFE never joins pieces by itself (that
would undo the player's act). Leaving a place reconnects first (CUT.md 2 rule 2).

---

## 10. The attention budget, the motion gate and the character caps (`src/life/attention.ts`, pure)

### 10.1 Caps for everything autonomous

| Channel (autonomous only) | Phone | Phone, Calm | Desktop | Desktop, Calm |
|---|---|---|---|---|
| bubbles on screen at once | 2 (+1 kept for a wish) | 1 (+1) | 4 (+1) | 2 (+1) |
| bubble starts (refill per s, burst) | 0.8, 2 | 0.4, 1 | 1.5, 3 | 0.7, 2 |
| gap between two bubbles of one character | 2.5 s | 4 s | 2.5 s | 4 s |
| creature voices at once (a group voice counts 1) | 2 | 1 | 3 | 1 |
| syllable starts (refill per s, burst) | 3, 4 | 1.5, 2 | 4, 6 | 2, 3 |
| piece groups: bubbles / voices at once | 1 / 1 | 1 / 1 | 2 / 1 | 1 / 1 |
| autonomous land, bump and prop sounds per s | 2 | 1 | 3 | 1.5 |
| effect particles from autonomy per s | 24 | 8 | 48 | 16 |
| haptics from autonomy | 0 | 0 | 0 | 0 |
| camera moves from autonomy | 0 | 0 | 0 | 0 |

Why these numbers: a phone shows 2 bubbles plus a wish at 0.8 starts a second because a child should read each one (JUDGE_FUN contradiction table:
"calm for a child"); the voice caps are the AUDIO map's backstop proposal (2 at once, 3 starts a second; 1 and 1.5 in Calm), which keeps chatter
under 10 extra live nodes (AUDIO map 5). The audio engine keeps its own pure `ChatterLimiter` (shaped like `BumpLimiter`, interact.ts 90-123) at the
desktop row, so a shell bug can never flood it.

### 10.2 Who wins a slot

**Priority** = class (P1 a wish or a quest moment 3.0; P2 a whole squishy 2.0; P3 a piece group 1.0) + (1 - its distance from the screen centre,
normalised 0..1) + 0.3 for a friend pair + 0.2 for a first-time event - 0.5 for the same icon in the last 10 s; ties by character slot. Requests
that find the bucket empty are **dropped, not queued** (a P1 waits up to 2 s); only wishes persist, as state. Off-screen characters show no bubbles
and sound 6 dB quieter. **The player comes first:** player-caused feedback goes through today's `feedback.ts` and is never budgeted; while the player
touches anything, P2 and P3 bubbles stop and other voices duck (8.4) until 0.6 s after the release. Bumps between two untouched bodies closing under
0.8 m/s are silent; other autonomous lands and prop bumps (`auto`) play budgeted soft variants, never through `feedback.ts`.

### 10.3 The motion gate (deterministic: no measured frame time)

LIFE may **start** moving k bodies (a piece group counts 1) only if **movers + k <= moverCap** and **units + k <= unitCap**:

| Tier | moverCap | unitCap (provisional) |
|---|---|---|
| low | 2 | 3.0 |
| med | 3 | 4.0 |
| high | 4 | 5.5 |

**units** = 1.0 per awake whole + 0.35 per awake piece + 0.03 per sleeping body + 0.3 per pair of awake bodies in contact, computed by the shell
from the bodies' flags (the same every run). Why: an awake detail-3 body costs about 0.69 to 0.87 ms on this container, a touching pair adds 0.22
ms (0.3 units), six detail-2 pieces cost 1.0 to 1.16 x two wholes in the real shell (SHELL_4.md 75-77: 1.207 vs 1.223 ms, then 1.3 vs 1.123), so a
piece is about 0.35 units, and a sleeper is about 0.02 ms (PHYS map 4, to be measured by PH-09). **Joint moments reserve all their tokens and units
together or do not start.** The mover floor of 2 on low is a design floor (pair play needs it, JUDGE_FUN F9); the unit caps are set by PF-01 (med
cap scenario, CPU throttle 4x) before S1 ships: if a phone budget is missed, PF-01 lowers unitCap, and on low a joint moment then starts only while
nothing is touched. Above 1.3 x unitCap (for example after the player brought many out) the farthest untouched mover settles within 1 s.

### 10.4 Character caps

| Tier | Whole squishies out | Pieces (of the one cut squishy) | Characters in all | Brains |
|---|---|---|---|---|
| low | 3 | 4 | 6 | 3 |
| med | 4 | 6 | 8 | 4 |
| high | 5 | 6 | 10 | 5 |

The wholes are today's `MAT_LIMIT` (mat.ts 22) and the pieces today's `MAX_PIECES` (cut.ts 38). **Pieces a cut may make = min(MAX_PIECES, characters
cap - (wholes - 1))**: with 4 wholes out on med a cut makes at most 5 pieces. **The party stays when you cut** (today a cut empties the mat, cut.ts 283;
re-specified in PLAYGROUND_BUILD.md 11.4). If a cut would push units over 1.3 x unitCap, the shell first puts the farthest untouched whole to sleep;
if that is not enough it refuses kindly: "It's busy here. Put one squishy back on the shelf to cut." **No detail-2 whole squishies in S1 and S2**
(sleep does the work; the player can pick and squeeze any party member, and detail-2 press, pull and fold rows are ungated: PHYS map 4). When the
quality tier drops, the shell sleeps untouched wholes first; only if the wholes still exceed the cap does it send the most recently brought out
untouched one back to the shelf, with the line "Plumpet went back to the shelf for a rest."

---

## 11. Determinism, randomness and cost

- **Think rate:** each character thinks when sim time crosses its next 0.1 s boundary, offset by its slot (slot x 0.1 / 16), so behaviour does not
  depend on the frame rate (LF-16); motion intents are applied every step.
- **Random streams:** one per character, `mulberry32((genome.seed ^ LIFE_SALT ^ Math.imul(visit + 1, 0x85ebca6b)) >>> 0)` kept in a `Uint32Array`, so
  one squishy's draws never shift another's.
- **Salts** (one registry, `SALTS` in `src/data/life.ts`, with a probe that they differ from each other and from the 16 already in src: 0x9e3779b9,
  0x51ed270b, 0x5bd1e995, 0x6c696e65, 0x6e616d65, 0xeee1e5, 0xf0f0f0, 0x6117e7, 0x5f3759df, 0xce2e, 0x57a45, 0x0c070c07, 0x2f6b3c1d, 0x6d757369,
  0x5eed1e55, 0x57155): TRAIT_SALT 0x7a11fe5d, MOTIF_SALT 0x2545f491, DUET_SALT 0x3c6ef372, LIFE_SALT 0x4bd6e3b1, WISH_SALT 0x6a09e667,
  CHATTER_SALT 0x1b873593 (audio). (DT-11; JUDGE_FEASIBILITY F21, JUDGE_COHERENCE M22.)
- **Zero allocation** per tick after the world is built (struct of arrays, capacity 16); at most 0.1 ms a tick at 16 characters on this container
  (LF-02, LF-03).

---

## 12. The LIFE step interface

Types are in `src/contracts.ts` (PLAYGROUND block: `LifeSnapshot`, `LifeIntents`, `LifeEvents`); values are in `src/life/**`.

```ts
// src/life/step.ts (pure; allocates only in createLifeWorld)
export interface LifeWorld { /* struct of arrays: needs, behaviour, timers, cooldowns, pair cooldowns 16 x 16, rng states, group table */ }
export function createLifeWorld(seed: number, maxChars: number): LifeWorld;                       // once per session
export function lifeSetPlace(w: LifeWorld, placeIdx: number, visit: number): void;               // on travel: resets visit-scoped state
export function lifeAdd(w: LifeWorld, slot: number, genome: Genome, kind: 0 | 1 | 2, group: number, warmth: number, isNew: boolean): void;  // at spawn, cut, join
export function lifeRemove(w: LifeWorld, slot: number): void;
export function lifeStep(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, ev: LifeEvents): void;  // zero allocation
// src/life/attention.ts (pure; the shell applies only what it grants)
export function createAttention(): Attention;
export function attentionFilter(a: Attention, s: LifeSnapshot, out: LifeIntents): void;           // drops or merges EMOTE and VOICE intents in place
export function motionGate(a: Attention, s: LifeSnapshot, k: number): boolean;                   // section 10.3
```

**Inside `lifeStep`:** reset out.n and ev.n; integrate needs and zone entries (React events once per zone per visit); for each character: HELD
first (cancel, gaze released to the pointer), chunks follow their group, a behaviour still running continues unless interrupted, otherwise choose
(utility argmax, joint moments locking both partners in the same call); plan voices (call and response, harmony slots on the music clock); run the
attention filter. **What the shell host does with it** (PLAYGROUND_BUILD.md 11.2): applies due intents through its one arbiter (finger > cut and
ceremony > LIFE) before the next `bodies.step`; sends granted EMOTE and VOICE intents to the stage and audio; turns LifeEvents into play-event ring
records; never calls a finger, grab or lock API for autonomy.

## 13. Not checked

Nobody has heard a creature voice or seen a squishmoji; "cute" is a design intent until the S1 verifiers listen and look (AUDIO map 6). No hop,
pose, render sway or sleep has been run on a real body: the numbers in sections 5 and 10 are targets for PH-01, PH-09, RD-11 and PF-01. The trait
spreads in section 2 are from one seed per species without the twist.
