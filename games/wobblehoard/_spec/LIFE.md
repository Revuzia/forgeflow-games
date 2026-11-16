# LIFE: squishies that are a little bit alive

**Status:** final design, 2026-11-15 (the PLAYGROUND synthesizer). The decision behind it is DIRECTION D1: a pure-logic lane gives every character on
screen a small brain whose only outputs are intents; any touch overrides it at once. Read with [`PLACES.md`](PLACES.md) (the things and how each
family reacts), [`QUESTS.md`](QUESTS.md) (wishes, discoveries, the Journal) and [`PLAYGROUND_BUILD.md`](PLAYGROUND_BUILD.md) (contract, lanes,
budgets, checks). Paths are relative to `games/wobblehoard`.

**Revision, 2026-11-15 (the continuing synthesizer):** seven fixes, nothing else changed (checks LF-18 to LF-20 are new). (1) The looks (frost, wet, soak, sand, snow,
toast) had no owner, yet comfort, the soaked density in water, REACT events and the squirt game all read them: LIFE now integrates them (3.1).
(2) FN-01's first ball play could not happen from the needs alone (a squeeze leaves play at 0.1 and B04 needs 0.4, 22 to 30 s away), and the
scripted first wish, "Go play with...", Pose and the cheers are shell-driven: one `lifeScript` entry carries them (4.1, 12). (3) The wish
scheduler needs the owned species, the open places and the known favourites, and joint moments need the friendship levels: `lifeSetJournal` and
`lifeSetPair` (12). (4) A squishy never stays in water by itself for more than 30 s (5.3; JUDGE_COHERENCE M12, CS-07). (5) The S1 hop cap's apex
is computed with the physics' own gravity (10 m/s^2, `params.ts` 16) and the salt list names the two base seeds it missed (11). (6) The motion
gate read "units + k", which counts an already awake body twice; it now adds only what the start wakes, as LF-10 checks (10.3). (7) Who plans
a voice was split two ways (the build page gave the motif to audio, the contract's `creature()` takes ready syllables): LIFE plans every phrase
and hands it over with `lifePhrase`; audio only synthesises (12).

**Revision 3, 2026-11-15 (after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23):** (1) the motion gate's caps come from
measured costs and a measured phone factor, and every joint moment moves one character at a time (10.3, 6.1); (2) LIFE travels with its own
`scootTo`, never `moveTo` (5.1); (3) LIFE decides on sim time only, music included (8.4); (4) the first wish has a wisher even with no Dollop
(4.1); (5) every REACT kind has a typed trigger and a thing (4.2), and PIECES carry the group's count (9); (6) a RIDE state keeps a rider on its
ride (B20), snuggle and peekaboo are behaviours (6.1), a ring pile counts with one napper inside (5.3); (7) Home's LIFE bounds are the visible
table (5.7); (8) "the player is touching" never means a lock alone, and B08 is budgeted (10.2); (9) a ceremony keeps needs and looks, and a look
falls only while its cause is absent (3, 3.1); (10) autonomy off still lets a player-asked use and a ride move that one squishy (5.6); (11) one
wish bubble on screen, one piece group everywhere (10.1), and the colours and Calm fades of the bubbles (7).

**Owner asks this page serves:** ask 2 (things used "in their own way": the gaits, poses and family reactions), ask 3 (several squishies at once,
social and cute, with emotes and little voices), ask 4 (pieces join in, and the feedback stays calm with many characters).

---

## 1. The rules

| # | Rule | Why |
|---|---|---|
| L1 | **LIFE is pure**: `src/life/**` imports only `./`, `../core/`, `../data/` and `../contracts.ts` (types); no DOM, three, physics, render, audio, shell, timers, `Date.now`, `Math.random` or `performance.now`. Same seed and same snapshots give the same intents, bit for bit (LF-01, LF-12). | Determinism under the dev hook; node-testable. |
| L2 | **The player comes first.** A touch, grab, carry or lock on a character makes its brain HELD in the same step (section 5.5); player-caused feedback (`feedback.ts`) is never budgeted; while the player is touching (a finger down, a grab or a carry, never a lock alone), other bubbles stop and other voices duck. | DIRECTION D1; C 5.4; a lock may stay while the player watches (LOCK.md 1), so it must not silence the party. |
| L3 | **Autonomy can never pay.** No intent kind presses, grabs or locks; every autonomous landing and prop bump carries `auto` and is dropped before `collection.feed`; the quest reducer never sees a meter function. A no-input hour earns 0 squish points, 0 task progress, 0 capsules, 0 gifts (EC-02). | DESIGN 5.4 (taps pay nothing; release and snap are the only paying kinds, `meterfeed.ts` 43-65). |
| L4 | **Mostly still, so bodies sleep.** Most behaviours do not translate the body: gaze, blinks, expressions, bubbles and the render-side lean and sway cost about nothing. Only scoot, hop, glide and the last centimetres to a contact are physics, and they need a mover token (section 10.3); every joint moment moves one character at a time while the others wait still (and may sleep). | A resting awake body costs 0.69 ms, asleep it should cost about 0.02 (PHYS map 4, 6); on the phone (F = 4) a med frame holds about 1.5 awake wholes (10.3). |
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

Three needs, 0..1, per whole squishy **while it is out**. They start at play 0.3, company 0.3, rest 0.2 **every time it comes out** (a trip or
the shelf), so being away never makes a squishy needier. A ceremony is not coming out: its stash and restore (the reveal hides the party for a
few seconds) keeps every need and look as it was, so a nap pile can still form after a capsule (REVIEW_game-truth m5: a reset at every reveal
put rest back to 0.2, and the 8:30 pile of QUESTS 13 could not happen by 10:00). A need only ever chooses a behaviour or a wish, never a loss.
Rates are per second of sim time x (0.5 + the trait).

| Need | Rises | Falls | At 0.8 |
|---|---|---|---|
| play | +0.010 awake and untouched (x bouncy) | -0.3 a thing use; -0.4 its loved touch; -0.2 any touch; -0.4 a toss | a thing use, or a thing or ride wish |
| company | +0.008 when nobody is within 2 m (x chatty) | -0.5 any social moment; -0.2 a friend within 2 m; -0.3 a player touch | a greet, or a friend wish |
| rest | +0.004 awake, +0.010 while hopping or bouncing (x dozy); x1.5 in a warm zone or on a nap spot | -0.02 while napping (to 0) | a nap |

**Comfort** is not a need but the body's looks: frost, wet or soak, sand or snow over 0.5 make it seek the remedy (a warm zone, the sun, the
water) or show a remedy wish. **The mood** is derived for the face only, never shown as a word: happy (a joy event in the last 8 s), sleepy (rest
over 0.7), playful (play over 0.6), curious (a notice in the last 4 s), otherwise content.

### 3.1 Looks (session state, integrated by LIFE; `LOOK_RATES` in `src/data/life.ts`)

LIFE owns six look levels per character, 0..1, integrated in `lifeStep` from the zone mask, the ground patch flags and the family numbers
(PLACES 2.4), reset to 0 each time a squishy comes out (a trip or the shelf; a ceremony keeps them), like the needs. The host reads them after each
tick (`lifeLooks`, section 12) and writes `StageLike.setBodyLook` and the density into `mods[4]` for every family (a foam's lerp(dry, soaked, soak),
PLACES 2.4); a few host events add to a look (`lifeAddLook`, with the thing that caused it: the pine's snow puff +0.5, the kettle's steam wet +0.2
within 0.6 m, the squirt's wet +0.3 on the target and soak -0.4 on the foam). A look crossing 0.5 upward emits its REACT event once per visit
(FROST, SOAK, SNOWCAP, TOAST ...); **a `lifeAddLook` emits its REACT every time, with its source thing** (so a snowball first never hides the
pine's snow cap, I4). **A look falls at its "elsewhere" rate only while its rising cause is absent** (so a weak cold zone still frosts: in the
cabin's Window Chill, cold 0.3, frost rises at 0.015 per s and does not fall). **A character that comes out, arrives or is cut inside a zone enters
it at once** (its REACT and its B15 reaction are due, no crossing needed). Pieces carry their own levels.

| Look | Rises (per s) | Falls (per s, only while its rising cause is absent) | Notes |
|---|---|---|---|
| frost | 0.05 x the cold strength | 0.10 in a warm zone, 0.02 elsewhere | |
| wet | 0.30 in rain, a shower, a splash spot or water | 0.05 dry, 0.15 in a warm zone | |
| soak | the family's soak rate (foams only) in water or rain | 0.10 in a warm zone, 0.02 elsewhere | the density follows it in water |
| sand | 0.10 on sand while moving, to at most 0.6 | 0.02 | |
| snow | 0.03 on snow while still, to at most 0.3; +0.5 per pine puff, +0.3 per snowball (PLACES 4.4) | 0.20 while moving, 0.10 in a warm zone | |
| toast | 0.04 x the warmth (families with `toast` only), up to 0.75 x the warmth where it stands, never burnt | 0.01 | marshmallow only today; Home's Warm Lamp (warm 0.4) caps it at 0.3 as PLACES 4.1 says, the hearth (1.0) at 0.75 |

---

## 4. Behaviours (`BEHAVIOURS` in `src/data/life.ts`, run by `src/life/brain.ts`)

Utility choice: the highest of base x trait x need, plus a seeded noise of +-0.05 and +0.15 for the current behaviour, after cooldowns; ties by
behaviour id, then character slot. **Moves?** = needs a mover token (section 10.3); "still" behaviours let the body sleep. W = whole, F = face
piece, C = chunk.

| Id | Behaviour | Trigger (score) | Moves? | Motion | Emote / voice | Ends | Cooldown | Who |
|---|---|---|---|---|---|---|---|---|
| B01 | idle | always (0.10) | still | breathing, blinks, a look about every 2.2..5.8 s | none | anything better | none | W F C |
| B02 | notice | a thing moves within 1.5 m, a body arrives, a land or bump within 1.5 m, or a new thing or squishy within the perception radius not seen this visit (0.9, once per target per visit) | still | gaze within 0.15 s, then a render lean of 0.06 R toward it | question if curious > 0.5; a rising chirp | 1.5 s | 4 s per source | W F |
| B03 | wander | play > 0.3, nothing of interest within 1.5 m, untouched 4 s (0.3 + 0.4 play x bouncy) | moves | gait steps to a point inside bounds - (R + 0.2) (at Home: the visible table shrunk by R + 0.2, 5.7), outside the things' 0.4 m keep-outs | none | arrived, or blocked 2 s | 6 s | W F |
| B04 | use a thing | play > 0.4 and a free floor-usable thing within 3 m (0.3 + 0.5 play + 0.3 [favourite] + family affinity) | moves, then still or riding | walk to its use spot, then the mechanism use (5.3) in the family's way (PLACES 3, 4) | the thing's icon (ball, bell, star, droplet, note); a joy call | the use is done (3..12 s), or rest > 0.8 | 15 s per thing | W F |
| B05 | bask or warm up | a comfort look > 0.5 with a remedy zone within 3 m, or a warm zone within 2 m and dozy > 0.5 (0.7), or a warm zone within 3 m it has not been in this visit (0.5: everyone goes to look at the fire once) | moves, then still | walk in, then the family's warm pose (PLACES 2.4); a family with `toast` whose toast passes 0.6 hops once away from the heat point (about 0.3 m) and basks on there, so "toasts golden, then hops back from the heat" is a real behaviour (PLACES 4.2, D-80) | sun, flame or droplet | the look under 0.1, or 15 s | 20 s | W F |
| B06 | nap | rest > 0.75, or dozy > 0.6 with a nap spot within 2 m (0.8 + 0.4 dozy) | moves, then still | walk to a nap spot (a rug, a warm corner, or a ring: first to a waypoint 0.6 m outside its gap's mouth, then in through the gap) or beside a sleeping friend; settle; **the body sleeps** | sleepy eyes; one zzz (one per pile) | a touch; rest < 0.1 after 30..90 s; a toss landing within 1 m (it wakes with a blink) | 30 s | W F C |
| B07 | show a wish | the wish scheduler gives it a slot (QUESTS 8) (0.7) | still | face the camera, one small hop (a squash pulse for families that do not hop) | a thought bubble with the wish glyph; an asking phrase | granted; it goes back to the shelf (the wish rests in the Journal) | QUESTS 8 | W F |
| B08 | afterglow | the player released, snapped or poked it (1.0) | still | spring back (physics), gaze to the camera | its loved touch: sparkle and a happy squint, a chirp an octave up (+1 warmth, at most 3 a day); else a giggle 40% of the time. Its bubble and voice are **budgeted as P1** requests (10.2): quick taps across a party never pass the caps | 1.5 s | none | W F C |
| B09 | arrive | a trip ended, or it came out (1.0) | one hop, through the motion gate | one arrival hop (a pulse for non-hoppers) for the members that get a mover token; the others arrive asleep (the shell spawns them at rest) and show a happy squint; a NEW squishy keeps 0.5 m of extra distance and looks down between glances for 20 s (the shy arrival), and still says hello within 5 s from where it is (that hello is an S01 greet with the nearest party member, whatever the distance, so it counts for H5 and friendship) | one shared sparkle for the party | 1 s (20 s shy) | per visit | W F C |
| B10 | love its place | its first 10 s in its favourite place, once per visit (0.95) | still | a big squash and stretch pose, a render wiggle at 3 Hz for 0.6 s | sparkle; the joy call | 2 s | per visit | W F |
| B11 | come back | outside bounds - 0.4 m after a toss (1.0) | moves | gait back toward the middle | none | inside | none | W F C |
| B12 | pose | the Snap tool is in hand, or "Pose!" is pressed (1.0) | still | stop, face the camera, happy eyes | one sparkle | the tool changes | none | W F |
| B13 | watch | the player touches another character within 3 m, or a cut starts nearby (0.6) | still | gaze at it | one shared wow if it is tossed or cut | the touch ends | none | W F |
| B14 | cheer | a quest completes, a squishy is whole again, a friend arrives (shell-scripted, 1.0) | one hop | one small hop | star or sparkle; a trill | 1.2 s | none | W F |
| B15 | zone reaction | its first entry into a warm, cold, wet, water or wind zone this visit (a character that comes out, arrives or is cut inside a zone enters it at once, 3.1) (0.95) | still | the family pose and look (PLACES 2.4, 3.1); the REACT **event** fires by its trigger (4.2) whatever behaviour wins, so B15 is only the pose and the bubble | sun, flame, snowflake, droplet or bubbles | 2..4 s | per zone per visit | W F C |
| B16 | huff | ONLY a squishy-to-squishy scene event: another squishy took the ball it was chasing, or the seat or spot it was walking to (0.5) | still | leans away from the other (a render lean of 0.08 R) | puff; one low coo | at most 3 s; any touch or a greet from the other turns it into a giggle | 5 min; never in a session's first 60 s | W |
| B17 | comfort | a Met-or-closer friend within 2.5 m is chilly (frost > 0.5), soaked (> 0.5) or just huffed; cuddly > 0.4 (0.85) | moves | walk over, lean in, the last centimetres by a `scootTo` at 0.04 m/s to contact (under the 0.05 m/s wake speed, so a still friend stays asleep) | snug; a low hum, the other answers higher | 3 s | 30 s | W F |
| B18 | answer a thing | the kettle whistles, the clock chimes, a tune plays, the echo stone is on; chatty > 0.5 (0.7) | still | gaze at the thing | its own call answers the thing (Use LISTEN) | the phrase ends | 20 s | W F |
| B19 | hold on | a wind gust while it is on the ground (0.8) | still | a render lean into the gust (0.08 R), squinting eyes | none (a gust is not worth a bubble) | the gust ends | none | W F C |
| B20 | ride (RIDE) | the player set it on a ride: a carry or toss that came to rest on a ride prop, or `carryTo` (the RIDE flag) (1.0, above every other choice but HELD) | still on the ride (no SCOOT or HOP off it), or its ride moment (S10, S11) | stays for 20 s, or until its joint moment ends, or a touch; a lone rider on a two-rider ride shows a **star** bubble meaning "Ride with me!" as a P1 request (outside the wish caps, inside the bubble caps) | star | 20 s, the moment's end, or a touch | none | W F C |

**Pieces** run their own small set (section 9): P01 follow, P02 huddle, P03 hop together, P04 join in.

### 4.1 Scripts the shell asks for (`lifeScript`, section 12; `SCRIPT` ids in `src/data/life.ts`)

| Script | The shell sends it when | What LIFE does |
|---|---|---|
| FIRST_PLAY | a fresh profile at Home, the player has let go of Dollop for 6 s, once ever (or during the first capsule's wait if the player never pauses) | Dollop's play need is raised to at least 0.6 and its next B04 is the Felt Ball (notice, hops, a boop), so FN-01 holds by design: after a squeeze (play 0.3 - 0.2 = 0.1) the need alone would reach B04's 0.4 only after 0.3 / (0.010 x (0.5 + bouncy)) = 22 to 30 s |
| FIRST_WISH | 60 s after the first capsule's reveal, at the latest at 5:00 of play (QUESTS 8; a backfilled save: 60 s into its first session) | **The wisher** (the slot arg the shell sends, D-70): Dollop if it is out; else a squishy out whose favourite place is Hearthlog Cabin (Dollop, Crimpo, Thumbly, Capnap, Hushpuff, Pastrel); else the party member out longest. It shows the place wish for Hearthlog Cabin through B07; the scripted wish ignores the 120 s gap and the 180 s per squishy, and **no natural wish shows before it**. If no character can show it by 5:00 of play (all held or quiet), the wish rests in the Journal at once ("A wish for a warm place: Hearthlog Cabin. It can wait.") and Hearthlog opens. It is granted by the first arrival at Hearthlog Cabin with any party (H8) |
| PLAY_WITH | the keyboard's "Go play with..." on a floor thing (arg = the thing idx) | the focused squishy's next behaviour is that use (B04), started at once if it has a mover token; its USE event carries by PLAYER |
| POSE | the Snap tool is picked (arg 1) or put away (arg 0), or "Pose!" is pressed | B12 for every character on screen |
| CHEER | a quest completes, a squishy is whole again, a friend arrives (arg = the slot that caused it) | B14 for up to two characters near it |
| SQUIRTED | the shell ran the squirt game (S14) on a target (arg = the foam's slot) | the target's wow, then its giggle |

### 4.2 REACT triggers (`REACT_TRIGGERS` in `src/data/life.ts`; D-72, DT-15, LF-21)

Every REACT kind of QUESTS 4 has one producer condition here. **The event fires whatever behaviour wins** (B15 and B05 are only the poses and the
bubbles). **Its thing** comes from the character's `zoneThing` (the thing owning the strongest zone at its centre) or `patchThing` (the thing
owning the patch under it), or from the source thing of the `lifeAddLook` that caused it, or is -1. "Visit" = once per character per zone or
thing per visit; "event" = every time, with the cooldown shown. A piece group's event is a PIECES record (section 9).

| REACT | Condition | Once | Thing |
|---|---|---|---|
| FLOAT | in a water zone, not grounded (it floats by the float table) for 1 s | visit | zone |
| WADE | in a water zone with a surface of 0.12 m or more, grounded, for 1 s | visit | zone |
| SOAK | soak crosses 0.5 upward (foams) | visit | zone (rain: -1) |
| TOAST | toast crosses 0.5 upward (families with `toast`) | visit | zone |
| RISE | mochi dough's warm pose (1.06) reached in a warm zone of 0.6 or more | visit | zone |
| OOZE | slime goo's warm pose (0.82) reached in a warm zone of 0.6 or more | visit | zone |
| WARM | in a warm zone of 0.5 or more for 2 s | visit | zone |
| SHIVER | in a cold zone for 2 s, a family with `shiver` | visit | zone (a whole-place cold: -1) |
| FROST | frost crosses 0.5 upward | visit | zone |
| SNOWCAP | snow crosses 0.5 upward; or any `lifeAddLook` of snow (the pine's puff, a snowball) | visit; a `lifeAddLook`: event | source (pine, snowball), else -1 |
| GLIDE | a glide on a patch with grip under 0.5 that carries it 0.5 m or more | event, 10 s cooldown | patch |
| SPLASH | a landing (a hop, a toss, a drop, a splash jump) into a shallow water zone (surface under 0.12 m) | event, 5 s cooldown | zone |
| DRIFT | floating and carried 0.3 m or more by a current | visit | zone |
| LIFT | airborne inside an updraft column for 0.3 s | event, 5 s cooldown | zone |
| RATTLE | a bead squeeze within 0.6 m of a switched-on magnet | visit | the magnet |
| GLOW | in a water zone with the glow flag (the Glow Pool) for 1 s | visit | zone |
| GAZE_SKY | idle within 1.5 m of a sky thing (the Moon Dish) for 3 s at night; or any character on screen when the Star Scope's comet crosses | visit; the comet: event | the dish or the scope |
| PRINT | its first print mark on a marking ground or patch | visit | patch, else -1 |
| SHOWER | under the Drip Leaf's zone while it drips (the rain's on-phase or a tap) for 1 s | event, 20 s cooldown | the drip leaf |
| FIZZ | in the Bubble Patch zone for 1 s | visit | zone |
| HOLD_ON | B19 starts (a gust while grounded) | event, one per gust | -1 |
| DRY | soak or wet falls under 0.1 inside a warm zone after reaching 0.5 | visit | zone |
| LOVE | B10 starts in its favourite place | visit | -1 |

---

## 5. How a squishy moves by itself

### 5.1 The primitives (physics drivers on contracts.ts PLAYGROUND; render poses on StageLike)

| Primitive | Exact recipe | Cost and safety |
|---|---|---|
| **Scoot** (travel) | `scootTo(x, z, speed)` at the family glide speed (5.2), never `moveTo` (that one is the ceremonies' and the cut's, and is not touch-gated: PLAYGROUND_BUILD D-63) + the gait overlay: squash pulses at the step rate and, for hopping families, a small hop per step + a render lean of 0.05 R toward travel | no airtime from the glide; the glide is not in V, so the rest test also checks drivers (PHYS map 4); physics pauses it under a touch and eases it out within 0.12 s |
| **Hop** | `setSquash(anticipation, 0.12)`, then 0.12 s later `hop(vx, vy, vz)` (glue and peel suspended for 10 substeps); in the air the squash eases to 1.06; landing is physics. **S1 cap: vy at most 0.84 m/s (a ballistic apex of 0.84^2 / (2 x 10) = 3.53 cm with the physics' GRAVITY 10, `params.ts` 16; landing 0.84 m/s, under the 0.9 m/s `land` threshold, softbody.ts 155), and every landing is `auto` anyway.** At most one hop per 0.8 s per body | PH-01 gates it per family x 3 genomes and 1/8 pieces |
| **Glide** | on a patch with grip under 0.5: one `nudge` of 0.6..1.0 m/s horizontal; friction and the place's drag carry it | real momentum: the ice fun is physics |
| **Pose** | `setSquash(target, 1.5)` for warm, cold and rest poses (PLACES 2.4); ended by any touch; putty, mochi dough and bead squeeze only while their memory has converged (5.4) | a pose that has converged is a fixed goal, so the body can still sleep |
| **Render pose** | `setBodyPose`: a lean at most 0.1 R; a sway at most 0.05 R at at most 4 Hz (sing, nuzzle, the clock's beat: LIFE gives the phase from sim time on the 66 BPM grid in `LifeIntents.e`, and the host may swap in `musicClock`'s beat for the render only, D-66); a shiver 7 Hz at most 0.015 R for 0.5 s; slow breathing while asleep | about zero physics cost, so a sleeping body can sing and sway (JUDGE_FEASIBILITY F16); the eye anchors follow it (RD-11) |
| **Contact** | the last centimetres of a nuzzle, comfort, pile or snuggle: `scootTo` at 0.04 m/s until a contact starts (a bump or a gap under 0.03 m), then stop | the only physics part of a nuzzle; under the 0.05 m/s wake speed, so the partner it reaches stays asleep (PLAYGROUND_BUILD 8.6) |
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
| ring (nest) | walk to a waypoint 0.6 m outside the gap's mouth, in through the gap, settle, nap; one curls up inside and friends nap against it (a pile counts for the ring when any napper's centre is inside it: the rings' clear inner radii, 0.80 m for the Snug Basket and the Snowdrift Nest and 0.85 m for the Cloud Nest, hold one body; PLAYGROUND_BUILD D-76, PLACES 2.1 M4) | drop or toss it in |
| rug, moss bed, warm corner (nap patches) | walk on, settle, nap | carry it there |
| pad | walk on, one small hop; the pad's gain does the rest (at most 5 bounces) | drop it on |
| turntable | walk on, ride round (friction with the surface velocity) | set it on; wind the motor |
| ball | walk or hop into it toward a partner or a target; chase it | flick it (`PropWorldLike.poke`) |
| chime, bell, crystal, lantern | bump past it (a contact strikes it) | tap it |
| pool, puddle, dish | walk in and out anywhere; floaters float, the rest wade (PLACES 2.5); a splash jump is one small hop that lands in it; **after 30 s in water by itself it heads out** to the nearest dry spot (a floater by `moveTo` on the surface), and it never naps in water (S2; LF-18, CS-07) | toss or carry it in (a squishy the player set in water stays until it has had its 30 s) |
| block, bar, mound | lean on it; peekaboo at its two peek spots (left and right of it as the camera sees it, `ThingDef.peek`, S13); parade under an arch | set it on a mound (it slides off) |
| swing | push a friend's seat from behind (floor level) | **ride**: set it on the seat (it stays, B20), poke to push |
| seesaw | two on it teeter by themselves: small hops in turn (a hop from a supported prop face, PLAYGROUND_BUILD.md 8.3) | **ride**: set two on the ends (each stays, B20) |
| ramp, raft, mound top | watch and cheer when another slides | **ride**: set it at the top or on it |
| switch | never; it watches, and answers a tune. A switch that is a squishy's favourite thing counts for F2 when the player taps it while that squishy is within 1.5 m and watching it (B02 or B18) | tap it (or "Tap it yourself" by keyboard) |

A squishy that wants a ride shows a **ride wish**: a star in a thought bubble beside the ride (QUESTS 8). Granting it (the player sets it there) is
the purpose; the slide or swing gets a cheer from the others.

### 5.4 Memory families (putty, mochi dough, bead squeeze)

No LIFE squash, pose or hop while the family's plastic memory has not converged (max |MEM - Q| over 0.02 R; physics reports it as
`SoftMetrics.memoryBusy`, which the host copies into the snapshot's `MEMORY_BUSY` flag), so a Stamp print, a dent or a stud print heals exactly as FUN 1 and CUT 1 say; they still glide, lean (render) and use things. Putty never
hops at all. (JUDGE_COHERENCE M9.)

### 5.5 What the player's touch does to the brain

**HELD = fingers > 0 || grabbed || carried || locked > 0** (SoftMetrics, contracts.ts; LOCK.md 3 counts a lock as a hand). In the same step: its
queued intents are dropped; the physics touch gate eases every LIFE driver out within 0.12 s (a hard cut would pop the goal under the finger); its
gaze goes to the pointer; it issues no autonomous bubble or voice. **HELD is for its own brain only.** "The player is touching" (the duck of
8.4 and the bubble stop of 10.2) means a finger down, a grab or a carry somewhere, never a lock alone: a lobe left locked while the player
watches never silences the party (LOCK.md 1 allows walking away from a lock). **On release:** B08 afterglow for 1.5 s, then **1.5 s of grace**
before any new LIFE motion, so the player can keep playing; a squishy the player set on a ride gets B20 instead (it stays 20 s). A partner in a
joint behaviour waits 2 s, then does a small "your turn" hop. A toss landing faster
than 3 m/s shows a swirl and a little wiggle; three tosses within 20 s give "a little dizzy" and 5 s of rest. **Play never causes a huff.**
**Pressing another party member is not switching squishy:** the first body keeps its locks and its pieces (JUDGE_COHERENCE M8; LOCK 3 and CUT 2
release on switching through the switcher, the Hoard or a tool, on travel, a capsule, a merge and a tab hidden over 60 s).

### 5.6 When LIFE is quiet (no new motion; gaze, expressions and needs keep working)

A ceremony; a cut neck or join; **any non-Hand tool in hand** (Cut, Snap, and the queued Stamp and Roll: with Snap they pose, B12), except
**the cut squishy's own group from 1 s after the swipe ends** (its pieces follow, huddle and join in while the Cut tool stays in hand, so ask 4
shows at the moment the child is looking); the Travel or Journal sheet open; the desktop Hoard holding input; a hidden tab. Calm effects do not
quiet LIFE; they lower the caps (section 10).
**"Squishies move on their own" off:** LIFE keeps gaze, expressions, bubbles, voices, wishes, reactions (looks and their REACT events) and the
render leans and sways (they do not move the body), and issues no hop, squash pose, glide or scoot, **except** for a use the player asked for
("Go play with...") and a ride the player set up (B20, S10, S11): those move that one squishy, because the player asked (PLAYGROUND_BUILD D-79). The
help line says so: "When off, they stay where you put them. They still look around and chirp, and play when you ask."

### 5.7 Keeping squishies inside the place

Three layers: physics `setBounds` (the corral's brake and rim bounce about the place's area, replacing the home spot for LIFE bodies; `setHome`
moves the home to where a body last rested); LIFE never targets a point outside the bounds shrunk by R + 0.2 m, nor inside a thing's 0.4 m
keep-out except its use spot; walls and parapets are static boxes (LF-06, PH-18). The bounds are the layout in use (the wide one, or the tall one
on a portrait frame, PLACES P7). **At Home** the bounds are the visible table (`StageLike.visibleTable`: the table inside the frame and outside
the HUD insets at the rest framing of the mat slots in use), recomputed when the party or the frame changes and never from autonomy, so the only
squishy can never wander out of a phone's view (one body shows about +-0.76 m of table on 390 x 844; PLAYGROUND_BUILD D-67).

---

## 6. Social play

### 6.1 Pair and group moments

"n" counts characters, and **pieces count** (a low-tier player can reach 4 with pieces). Points go to the species pair (6.2). **Every joint
moment moves one character at a time** (the others wait still, leaning and swaying by render, and may sleep; only S15 and S18 move two together,
and only where moverCap is 2 or more), so it can start with one mover token; it also reserves the units of every body it will wake (a boop wakes its target) and starts only if they fit (10.3). No character is in two
joint moments at once (LF-10, LF-11). **Who:** W a whole, F a face piece, C a chunk; a piece group takes part as one character. "Awake" in a
moment means not napping (LIFE), never "physics-awake": a still squishy in a snuggle or a song may be asleep in physics.

| Id | Moment | Who | Starts when | Emote | Voices | Physics (one mover at a time) | Ends | Points |
|---|---|---|---|---|---|---|---|---|
| S01 | greet | W F | another whole within 1.6 m, this pair not greeted this visit (a friend-wish grant greets once more, with no points, QUESTS 8) | hello on both | the first two syllables of its motif; the other answers 0.35..0.7 s later with the same rhythm, the contour mirrored | one hello hop toward it (or a lean) | 2.5 s | +1 once per pair per visit |
| S02 | chat | W | two met squishies within 1.5 m, both idle | none (the voices carry it); hello on the first only; with sound off (muted or Voices at 0) one hello bubble on the first speaker | 2..4 alternating syllables from each one's motif | small leans toward each other (render) | 3..5 s | +1 a chat, at most 3 a visit |
| S03 | boop | W F | bouncy > 0.6, another idle within 1.2 m, and the units for both bodies fit (the target wakes) | giggle on the booped one | a chirp, then a giggle trill | a hop into it at 0.4 m/s (a soft bump of intensity about 0.13, `auto`: no haptic, no feedback.ts) | the wobble settles | +1 |
| S04 | nuzzle | W F | both idle within 1.0 m, and Friends or closer, or either cuddly >= 0.6 | snug (with the sparkle badge for best friends) | purr, purr back (a duet in thirds for Friends) | both lean 0.1 R toward each other (render); one closes the last centimetres at 0.04 m/s | 3..6 s | +2 |
| S05 | copy, follow the leader | W F C | a curious one within 2 m sees a hop or a thing use; with 3 or more and a leader with bouncy >= 0.6, a little parade | star on the copier (on the leader for a parade) | the copier repeats the leader's phrase one step higher; a chirp at each turn | the same action 0.6 s later; a parade goes **turn by turn**: each in turn glides up behind the one in front (0.7 m gaps), like a little caterpillar | 3 copies, or the loop is done | +1 (each neighbour pair in a parade) |
| S06 | sing together | W F C | 2+ idle within 2.5 m of a tune (Music Box, the kettle's whistle, a tapped chime row, the fire puff) or 2 chatty friends, once per 2 min per place | one shared note bubble | each sings its motif on the place's field's rest tones (8.4), on the eighth grid of the sim-time 66 BPM clock, for 2 bars | a render sway on the beat (no physics) | 2 bars (7.3 s at 66 BPM) | +1 per pair, at most 3 pairs a song |
| S07 | snuggle | W F C | **a behaviour**: 3 or more idle (not napping) within 2.5 m, any one of them happy (a joy event in the last 8 s); they gather into a row by contact, one at a time (each a contact approach at 0.04 m/s), then lean in contact for 6 s | one shared snug | a soft hum fading | the gathering glides, one mover at a time; then leaning in contact (render) | 8 s after the row forms | +1 per touching pair |
| S08 | nap pile | W F C | 2+ napping in contact (B06), each walking in on its own turn; for a ring, one curls up inside and the others nap against it | one zzz for the pile | one soft yawn, then silence | contact, then sleep as one island | a touch wakes one; the rest wake over 1..3 s | +1 per pair per pile |
| S09 | comfort | W F | B17 | snug, then a sparkle on both | a low coo, then a rising chirp | walk over, lean in (the approach at 0.04 m/s) | 3 s | +2 |
| S10 | teeter | W F C | two on one seesaw (set there by the player: both RIDE) | swirl | a trill at each tip | small hops in turn rock it (both already awake on a moving prop: no body to wake) | 6..12 s | +2 |
| S11 | push the swing | W F | one on a swing or hammock (set there by the player: RIDE) and **any other squishy within 2.5 m** (not a friendship level) | star on the pusher | a coo from the rider at each swing | the pusher walks into the seat along the swing's direction of travel, from an end of its arc that lies inside LIFE's targets (from the side for the cabin's wide layout, from the front for its tall one, PLACES 4.2) | 3 pushes | +1 |
| S12 | pass the ball | W F C | two within 2.5 m of a ball, one bouncy > 0.5 | ball | a chirp at each touch | each in turn boops the ball toward the other | 3 passes, or the ball stops | +1 |
| S13 | peekaboo | W F | **a behaviour**: two idle within 3 m of a thing with peek spots (`ThingDef.peek`: left and right of it as the camera sees it, both inside LIFE's targets); each walks to one spot in turn | question, then sparkle | a rising chirp, a giggle | the walks, one at a time; then lean out and back 2 or 3 times (render) | 4 s | +1 |
| S14 | squirt game | W (the foam), any target | **the player** squeezes a soaked foam with another character within 1.2 m: the nearest one within 60 degrees of the foam's gaze, else the nearest within 1.2 m (a keyboard squeeze uses the same rule) | wow on the target, then giggle | a splash, the target's surprised chirp | a 12-drop spray arc (4 in Calm) in 0.4 s; target wet +0.3; the foam's soak -0.4 | 1.5 s | +1 |
| S15 | twin dance | W | two of the **same species** within 2 m, once per visit | sparkle on both | a unison hum | mirrored hops with no delay where moverCap is 2 or more; otherwise a mirrored render sway (it still counts as MIRROR) | 4 s | none (a discovery, QUESTS 9) |
| S16 | echo talk | W F | in Echo Hollow, a squishy calls and hears its echo | hello | its call, the echo, then its own answer to the echo | none | 2 exchanges | +1 with whoever answers too |
| S17 | duet | W | Friends or closer, both present and free, once per visit | snug with notes | a two-voice phrase in thirds on the pair's own 2-note call | a sway (render) | 2 bars | +2 |
| S18 | twirl | W | Close friends, once per visit | snug with the sparkle badge | a duet with a held last note | two hops each around one another where moverCap is 2 or more; otherwise a turn each, then a shared render sway | 3 s | +2 |

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
| 9 | star | a five-point star | amber | "I did it!" (in a thought bubble: "A ride, please!"; beside a lone rider, B20: "Ride with me!") | after a ride or a long glide; the ride wish; a lone rider |
| 10 | swirl | a spiral | dusk | "Whee!" | a toss, a slide, a turntable, a teeter |
| 11 | puff | a small cloud puff | dusk | "Hmph!" | the huff (at most 3 s) |
| 12 | sun | a disc with 8 short rays | amber | "Warm and happy" | the sun, the lamp, basking |
| 13 | flame | a teardrop flame | coral | "Toasty!" | the hearth, the chimney |
| 14 | snowflake | six short spokes | lagoon | "Brr, chilly" | cold zones, frost |
| 15 | droplet | a teardrop | lagoon | "Splash!" | water, rain, puddles, a soak |
| 16 | bubbles | three circles of three sizes | lagoon | "Fizzy!" | floating, the bath, the bubble patch |
| 17 | leaf | an almond with a midrib | lagoon (one accent, as the rule says) | "So calm" | the garden, calm moments outdoors |
| 18 | moon | an ink crescent | amber fill (a cream outline would vanish in the cream bubble) | "The moon!" | moon gazing, bedtime, the night places |
| 19 | ball | a circle with a seam arc | amber | "Let's play!" | pass the ball; a play wish |
| 20 | bell | a bell outline and a clapper | amber | "Ding!" | chimes, bells, crystals, lanterns |
| 21 | shell | a fan of five ribs | coral | "A shell!" | Ripple Shore |
| 22 | postcard | a small card in an ink frame with a sky band | the place's sky band, inside the ink frame (some skies are near cream) | "I want to go somewhere" | place wishes only (the card names the place) |
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
- **Motion:** in 0.15 s (scale 0.6 to 1.0 with a 6% overshoot), hold 1.6 s, out 0.25 s. Calm **or** reduced motion (either one alone): a 0.25 s
  fade only. Never a flash (alpha only, no white burst). **Nothing bobs or pulses, ever.**
- **Repeats:** at most one bubble per character; the same icon from the same character or group is dropped within 4 s.
- **Wishes:** stay until granted; **one wish bubble on screen** (the wish slot of 10.1); any other open wish on screen shows only as its still
  14 px dot (0.25 of a bubble, inside the at-once cap); at most **two re-glances** (a 0.2 s grow at 8 s and at 30 s after showing; in Calm or
  with reduced motion a 0.2 s opacity lift instead, never a grow), then the still dot; a tap, a hover or keyboard focus grows it again. No periodic
  re-show (JUDGE_COHERENCE M18).
- **Tapping:** a tappable bubble (a wish, or any bubble while the "Tap a bubble" quest is open) has a **44 x 44 CSS px DOM hit area** placed from
  `StageLike.emoteScreen`, never over the body's silhouette (a press that starts on the body is always a poke; CS-09). A tap shows its meaning
  for 2 s; a wish tap shows the wish card (QUESTS 13), which always **names** the friend or place (never colour only; CS-11).
- **Words:** the first three bubbles a new player sees carry a one-word label under them ("curious", "hello", "loves it"); after that only with
  "Words under bubbles" on. Labels are DOM, `aria-hidden`, and join the Snap hide list.
- **Photos:** bubbles are 3D, so they are in Snap photos by default; the Snap bar's "Bubbles in photo" switch turns them off (JUDGE_FUN F16).
- **Sound off** (muted, or Voices at 0): every voice phrase has its bubble (the total table of section 8.3, chat included; UI-03), requested at
  the priority its voice had, inside the bubble budget. A wish is also told once in the polite live region ("Dollop has a wish: a warm place"),
  at most once per 20 s, through the region's one queue (QUESTS 15).
- **Keyboard:** Enter on the focused squishy reads a bubble showing over it into the polite live region and counts as a bubble tap (QUESTS 15);
  the 44 px hit areas are `tabindex="-1"`.

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
| chat | 2 or 3 syllables from its motif, alternating with the partner | chatting (sound on: no bubble, the voices carry it; sound off: one hello bubble on the first speaker) |
| joy | the motif and a rising trill | happy (sparkle or star) |
| loved touch | a chirp an octave up | its loved touch (sparkle) |
| sleepy | one slow falling coo, then silence | sleepy (zzz) |
| wish | the motif ending on an upward chirp | asking (the wish bubble) |
| granted | a trill up and a hum | thank you (sparkle) |
| sing | the motif's notes taken from the place field's rest tones (8.4), on the sim-time eighth grid, 2 bars | singing (note) |
| huff | one low coo, 5 semitones down before the snap | hmph (puff) |
| comfort | coo, coo; the other answers higher | there, there (snug) |
| peep | pieces: one 45 ms blip (a group voice for several) | pieces at play (the group bubble) |
| answer a thing | the motif aimed at the kettle, the clock or the tune | answering (note) |

**The pair duet** (Friends and closer): a 2-note call fixed for the pair, from `mulberry32(hashString(a) ^ hashString(b) ^ DUET_SALT)`, sung in thirds.
**The echo** (Echo Hollow): one scheduled repeat at +220 ms, -12 dB, low-passed, counted as half a voice. **The group voice** (pieces): one voice
with 2 or 3 detuned oscillators (+-10 cents) at one piece's level + 2 dB, never N voices.

### 8.4 Harmony and the mix

**Harmony** only in Sing together, the duet and the finales. **LIFE decides on sim time only** (D-66): the bar lines come from the snapshot's `t`
on the 66 BPM grid (a bar is 3.636 s), the field is the place's music style's main field (`musicField`), and each singer takes a different rest
tone of that field (root, fifth, ninth), enters on the next sim-time bar line and sings on the eighth grid for 2 bars; at most 3 singers voiced on
a desktop and 2 on a phone (the rest sway). LIFE never reads `musicClock` (its AudioContext clock runs in real time while `DebugHook.step` jumps
sim time, and is absent before the audio unlocks): after LIFE has decided, the shell maps each start to the next audible eighth or bar line for
`creature()`'s `at`, and audio may re-voice a sung degree onto the sounding field's rest tones; the pentatonic is safe over all four fields, so a
mismatch never clashes. The same sim time gives the same intents whatever the AudioContext clock does (frozen, running or jumping: LF-26).
**Levels:** a whole squishy's syllable peaks at most -20 dBFS at Voices 100% (about -24 dBFS at the default 60%); pieces 7 dB lower; a
player's effect must stand at least 8 dB in-band and 10 LU above chatter (AU-03). **Mix rules:** a new `chatter` input gain created after `music`
(the harness labels the first three gains, AUDIO map 1); creature kinds are never in `ROOM_KINDS`, so the music never dips for chatter; priority -1
(stolen before any player sound); its own rng stream (`CHATTER_SALT`; never a draw from `engRng`, so every existing seeded render stays bit-exact,
AU-07); silent during ceremonies and for 1 s after (the ceremony owns the moment, and its C-rooted motifs would clash, AUDIO map 6); while the
player is touching (a finger down, a grab or a carry; never a lock alone, 5.5), other voices duck 6 dB and slow to 1 syllable a second until
0.6 s after the release. **Sound off:** every phrase maps to
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
(copy a nearby whole squishy's thing use as a group). A group counts as one mover (10.3).
**The PIECES count (D-73):** a group's REACT or USE becomes a PIECES record whose `n2` is **the group's piece count at a new high for this visit**:
the pieces inside the zone (for a zone REACT), or the pieces that used the thing within the last 4 s (for a USE or a thing REACT). So three pieces
walking into the warmth in single file give n = 1, then 2, then 3 (the third meets C6's `minN 3`), and a group that hops on the pads together
gives one record with its count. **A cut inside a zone** emits, at the cut, each zone REACT the new group stands in, once, as PIECES with the
pieces inside it (a whole already in the hearth's warmth cut into 3 gives one PIECES WARM with n = 3), whatever the whole's own once-per-visit
REACT already did.
**On a cut:** cutting is play. The brain stays (on the face piece); the mood is "surprised" for 2 s (one "oh" group bubble, wide eyes on the face
piece), then "playful"; needs freeze except rest; **1 s after the swipe ends the group leaves the Cut tool's quiet** (5.6: it may follow, huddle,
hop together and join in while the Cut tool stays in hand); every other party member gives **one shared wow** and the most curious walks over to look. No
comfort after a cut and no "whole again" wish (JUDGE_FUN F4). **Whole again:** one sparkle and a trill (B14), and up to two friends nearby cheer with
one shared sparkle; discovery "its pieces like to play" the first time the pieces used a thing (QUESTS 9). LIFE never joins pieces by itself (that
would undo the player's act). Leaving a place reconnects first (CUT.md 2 rule 2).

---

## 10. The attention budget, the motion gate and the character caps (`src/life/attention.ts`, pure)

### 10.1 Caps for everything autonomous

| Channel (autonomous only) | Phone | Phone, Calm | Desktop | Desktop, Calm |
|---|---|---|---|---|
| bubbles on screen at once (a wish's still dot counts 0.25) | 2, + the wish slot | 1, + the wish slot | 4, + the wish slot | 2, + the wish slot |
| the wish slot: wish bubbles at full size on screen | 1 (any other open wish shows only as its dot) | 1 | 1 | 1 |
| bubble starts (refill per s, burst) | 0.8, 2 | 0.4, 1 | 1.5, 3 | 0.7, 2 |
| gap between two bubbles of one character | 2.5 s | 4 s | 2.5 s | 4 s |
| creature voices at once (a group voice counts 1) | 2 | 1 | 3 | 1 |
| syllable starts (refill per s, burst) | 3, 4 | 1.5, 2 | 4, 6 | 2, 3 |
| piece groups: bubbles / voices at once (only one squishy is in pieces at a time, section 9) | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
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
and sound 6 dB quieter. **The player comes first:** player-caused feedback goes through today's `feedback.ts` and is never budgeted; B08's
afterglow bubble and voice and B20's lone-rider star are **P1 requests** (they follow a player act, but they are LIFE's, so quick taps across a party
never pass the caps); while the player is touching (a finger down, a grab or a carry; never a lock alone, 5.5), P2 and P3 bubbles stop and other
voices duck (8.4) until 0.6 s after the release. Bumps between two untouched bodies closing under 0.8 m/s are silent; every other `auto` event
(lands, prop bumps and **body bumps**: physics flags a body bump `auto` unless either body is HELD or was thrown, D-62) plays a budgeted soft
variant, never through `feedback.ts` (which would play a bump sound, `haptics.pop()` and a shake). A sound-off voiced moment's bubble asks at
its voice's priority.

### 10.3 The motion gate (deterministic: no measured frame time)

**The budget behind the gate (PLAYGROUND_BUILD 14.2, D-60, D-61).** The phone budget for physics is 4.0 / 6.0 / 10.0 ms a frame (low / med / high);
on this container that is B / F, where F is the phone factor PF-00 measures once (F = 4 until then: Chromium costs what node costs here, so only the
4x throttle remains). Measured costs here: an awake detail-3 whole 0.87 ms pressed (0.69 resting), a detail-2 piece 0.19 ms, a touching pair +0.22
ms, a sleeper about 0.02 ms, the props near an awake body about 0.2 ms (PHYS map 4 and 6). So **unitCap = (B / F - 0.20) / 0.87** awake-whole
units, never under 1.0, and **moverCap = max(1, floor(unitCap))**:

| F | low unitCap / moverCap | med | high |
|---|---|---|---|
| 4 (provisional, until PF-00) | 1.0 / 1 | 1.49 / 1 | 2.64 / 2 |
| 3 | 1.30 / 1 | 2.07 / 2 | 3.60 / 3 |
| 2 | 2.07 / 2 | 3.22 / 3 | 5.52 / 5 |

**units** = 1.0 per awake whole + 0.22 per awake piece + 0.03 per sleeping body + 0.25 per pair of awake bodies in contact (the pairs from
`SoftMetrics.contacts`), computed by the shell from the bodies' flags (the same every run); PF-00 re-measures the weights. **The gate:** LIFE may
**start** moving k characters (a piece group counts 1) only if **movers + k <= moverCap**, and, when the start wakes bodies, **units + delta <=
unitCap**, where delta = 0.97 for each sleeping whole it wakes (a boop's target included) and 0.19 for each sleeping piece; a start that wakes
nobody (its bodies are already awake, for example two riders the player set on the rocker) needs only the mover token (LF-10). **Every joint moment
moves one character at a time** (6.1), so every moment and every quest works at moverCap 1. **Over the cap** (the player woke bodies: a touch, a
toss, a ride; or a trip), the shell cancels the motion of the untouched LIFE mover farthest from the frame centre (it settles) and puts untouched,
still wholes to sleep (`sleep()`), farthest first, until units are back under unitCap; it never forces a touched, carried, tossed or riding body.
On travel the party is spawned at rest and asleep; B09's arrival hop goes through the gate (members without a token show a happy squint). The old
floor of 2 movers on low (D-13) is gone: with F = 4 two awake wholes plus props cost 1.94 ms against low's 1.0 ms (REVIEW_code-truth B2); pair play
survives because pairs take turns.

### 10.4 Character caps

| Tier | Whole squishies out | Pieces (of the one cut squishy) | Characters in all | Brains |
|---|---|---|---|---|
| low | 3 | 4 | 6 | 3 |
| med | 4 | 6 | 8 | 4 |
| high | 5 | 6 | 10 | 5 |

The wholes are today's `MAT_LIMIT` (mat.ts 22) and the pieces today's `MAX_PIECES` (cut.ts 38). **Pieces a cut may make = min(MAX_PIECES, characters
cap - (wholes - 1))**: with 4 wholes out on med a cut makes at most 5 pieces. **The party stays when you cut** (today a cut empties the mat, cut.ts 283;
re-specified in PLAYGROUND_BUILD.md 11.4). Before a cut the shell puts every untouched whole to sleep; only if the new pieces (0.22 units each) and
what is still awake would pass unitCap does it refuse kindly: "It's busy here. Put one squishy back on the shelf to cut." (At F = 4 that does not
happen once the others sleep: med 5 pieces + 3 sleepers = 1.19 units against 1.49; low 4 pieces + 2 sleepers = 0.94 against 1.0.) **No detail-2 whole squishies in S1 and S2**
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
  0x5eed1e55, 0x57155), and from the two base seeds those salts are XORed with (0x57a15b00, the audio engine's default seed, engine.ts 79;
  0x0d011009, the starter Dollop's seed, genome.ts 110): TRAIT_SALT 0x7a11fe5d, MOTIF_SALT 0x2545f491, DUET_SALT 0x3c6ef372, LIFE_SALT
  0x4bd6e3b1, WISH_SALT 0x6a09e667, CHATTER_SALT 0x1b873593 (audio). The probe re-greps src for `^ 0x` and `mulberry32(0x` so the list stays
  current. (DT-11; JUDGE_FEASIBILITY F21, JUDGE_COHERENCE M22.)
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
export function lifeScript(w: LifeWorld, slot: number, script: number, arg: number): void;      // section 4.1 (SCRIPT ids)
export function lifeSetJournal(w: LifeWorld, owned: Uint32Array, openPlaces: number, favKnown: Uint32Array, thingKinds: number): void;
  // on a journal change, never per frame: owned species (bit per catalog idx, 2 words), open places (bit per place idx, shipped ones only),
  // favourite place and thing known (2 bits per species, 4 words), and the thing-wish glyph kinds present in the open, shipped places (a bit per
  // kind: ball, bell, droplet, note, flame, sun; from THING_KINDS): the wish scheduler's only inputs from the Journal. A thing wish asks only for a
  // kind in that mask, and a favourite place or thing only once its place is open (QUESTS 8; LF-25)
export function lifeSetPair(w: LifeWorld, slotA: number, slotB: number, level: number, best: boolean): void;
  // at spawn, cut and join, and on a FRIEND event: 0 none, 1 Met, 2 Friends, 3 Close friends; best = an authored best-friend pair
export function lifeLooks(w: LifeWorld, slot: number, out: Float32Array): void;                 // frost, wet, soak, sand, snow, toast (3.1)
export function lifeAddLook(w: LifeWorld, slot: number, look: number, amount: number, thing: number): void;
  // a host event adds to a look (3.1) and emits that look's REACT at once with `thing` (the pine, the kettle, the foam's thing or -1), every time
export function lifeWishOf(w: LifeWorld, slot: number, out: Int32Array): boolean;               // its open wish: [WISH_KIND, target idx]
export function lifePhrase(w: LifeWorld, intent: number, out: Float32Array): number;            // a VOICE intent's syllables (4 floats each, the
  // layout of SquishAudio.creature's `phrase`) planned by src/life/voice.ts: the motif, the mirrored answer, the duet, the sung notes; returns n
export function lifeMotif(speciesIdx: number, out: Float32Array): number;                       // a species' 3-syllable call (the Journal's "Its song")
// src/life/attention.ts (pure; the shell applies only what it grants)
export function createAttention(): Attention;
export function attentionFilter(a: Attention, s: LifeSnapshot, out: LifeIntents): void;           // drops or merges EMOTE and VOICE intents in place
export function motionGate(a: Attention, s: LifeSnapshot, k: number): boolean;                   // section 10.3
```

**Inside `lifeStep`:** reset out.n and ev.n; integrate needs, looks and zone entries (REACT events by `REACT_TRIGGERS`, 4.2, with the snapshot's
`zoneThing` or `patchThing`; PIECES records at a new high, 9); for each character: HELD first (cancel, gaze released to the pointer), RIDE next
(B20), chunks follow their group, a behaviour still running continues unless interrupted, otherwise choose (utility argmax, joint moments locking
both partners in the same call and moving them one at a time); plan voices (call and response, harmony slots on the sim-time 66 BPM grid, never
the AudioContext clock); run the attention filter. **What the shell host does with it** (PLAYGROUND_BUILD.md 11.2): applies due intents through its one arbiter (finger > cut and
ceremony > LIFE; SCOOT goes to `scootTo`, never `moveTo`) before the next `bodies.step`; sends granted EMOTE and VOICE intents to the stage and
audio (a VOICE's `at` mapped onto `musicClock` there, after LIFE decided); reads `lifeLooks` and writes the looks and `mods[4]` for every family;
turns LifeEvents into play-event ring records (with `lifeWishOf` for a wish's kind and target); never calls a finger, grab or lock API for autonomy. **TOUCH ids** (data) include a squeeze held 1 s or more and a pull to level 0.6 or more as their own ids,
because the touch wish is granted by them (QUESTS 8), CUT for a cut that starts on a character (B13), and TOSS_HARD for a toss that lands
faster than 3 m/s (5.5). These eight functions are LIFE values, not contract members: the snapshot, intents and events stay as `src/contracts.ts`
declares them. **Who plans a voice:** LIFE's `src/life/voice.ts` plans every phrase (which syllables, which pentatonic steps, when, the answer's
mirror, the pair duet from `DUET_SALT`, the sung notes on the sounding field); `src/audio/creature.ts` synthesises it (timbre by flavour, the pitch
snap, the echo, the group voice, the limiter).

## 13. Not checked

Nobody has heard a creature voice or seen a squishmoji; "cute" is a design intent until the S1 verifiers listen and look (AUDIO map 6). No hop,
pose, render sway or sleep has been run on a real body: the numbers in sections 5 and 10 are targets for PH-01, PH-09, RD-11 and PF-01. The trait
spreads in section 2 are from one seed per species without the twist.
