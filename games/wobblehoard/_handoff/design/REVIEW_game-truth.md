# REVIEW: game truth (an adversarial read of the final PLAYGROUND design)

**Reviewer:** an independent reviewer who did not write the design. Lens: GAME TRUTH (can a new player actually do and see what the specs promise?).
**Date:** 2026-11-15. **Read:** `_handoff/STATUS.md`, `briefs/COMMON.md`, `briefs/SESSION3.md`, `design/DIRECTION.md`, `_spec/PLACES.md`, `_spec/LIFE.md`,
`_spec/QUESTS.md`, `_spec/PLAYGROUND_BUILD.md`, the PLAYGROUND block of `src/contracts.ts` (481-841), every `_handoff/briefs/PG_*.md`, `_spec/DESIGN.md` 5.4,
`_spec/CUT.md` 2. **Code read to test claims:** `src/render/stage.ts` (camera constants 135, 185, 213, 260-262, mat slots 87-88), `src/render/face.ts` 1-10,
`src/physics/softbody.ts` 2326-2354 (slosh), `src/shell/game.ts` 424-440 (tool switch keeps pieces), `src/collection/ghost.ts` 147-160 and 221 (restock day,
only hearted items refuse a merge), `src/data/catalog.ts` (families and tiers, by a node script). **Run:** two short node scripts in my scratch folder
(the catalog list; a geometry and rate script for the numbers below). Nothing else was run: no browser, no build, no probe, no sim.
Paths are relative to `games/wobblehoard`. Line numbers are at the tree as I read it.

Severity: **BLOCKER** = a lane would build the wrong thing or the game breaks a rule; **MAJOR** = costs a rework or leaves an owner ask unmet;
**MINOR** = polish.

---

## 1. The walk-through (a new player, using only the specs)

| When | What the specs promise | What actually holds | Finding |
|---|---|---|---|
| 0:00 to 0:40 | H1 by a held squeeze | holds | |
| 0:40 | FIRST_PLAY: Dollop hops to the Felt Ball at (0, 1.6) and boops it (FN-01) | on a 1280 x 800 desktop the ball sits below the frame (ndc y -1.68); on a phone Home's other things are far off the sides | B2 |
| 1:30 | first reveal, the newcomer stays out and says hello (H5); the Snooze Rug arrives | the hello holds (B09's rule); the rug arrives off-screen | B2 |
| 2:00 to 2:30 | Dollop's scripted postcard wish 60 s after the reveal | a natural touch wish can show first; and the script needs Dollop owned and out | B1 |
| 3:30 to 5:30 | travel, H8, C1, C10 | holds (the moments queue merges the four plates) | |
| 5:30 to 7:00 | "Dollop and the newcomer walk to the hearth"; marshmallows toast "and turn round" | nothing sends a non-dozy squishy to the hearth (B05 needs dozy > 0.5 or a comfort look; Dollop is "bouncy and chatty", LIFE 2); C2 still completes by a wander into the 1.8 m zone or a carry. "Turn round" has no mechanism | M13 |
| 7:00 to 8:30 | the kettle (C7) and the rocker (C5) | C7 holds; C5 needs a ride hold and the rocker barely fits two riders; the kettle's tune fills most of the visit | M6, m4, M14 |
| 8:30 to 10:00 | "two pile into the Snug Basket" | the basket's inner radius (0.81 m) holds one R 0.5 body; and the 8:30 reveal reset rest to 0.2, so at 10:00 rest is 0.67 in the warmth at median dozy (needs 0.75) | M8, m5 |
| first session | C6 (cut into three by the fire), C8 (the gift finale) | C6 cannot register as written; C8 has no keyboard path | M2, M9 |
| day 2 (S1 build) | Ripple Shore's finale, the second gift | Ripple is not shipped in S1; Friends Everywhere stalls at 4 of 7 main quests, so its gift finale never opens; the gift card names a place the player cannot see | M10, m7 |
| day 2 (S2) | the sunset hug R8 (a gift finale) | S07 snuggle has no behaviour that brings three into contact; R3 can be done by the breeze alone | M7, m1 |
| day 7 | 6 or 7 places, about 55 stamps | the stamp thresholds hold (every threshold has more open quests than it needs); 12 species can never find their favourite thing; E7 peekaboo has no driver; Fizzwell's bath floods the ceremony pad; three "distinct part" quests have no part field | M4, M7, M15, M16 |
| day 30 | every place, gold-edged pages | 12 pages can never turn gold (F2); U9's two nappers do not fit in the Cloud Nest; the Sunbow Arch breaks the front-band rule | M4, M8, m15 |

**The attention budget, worst case from the caps (LIFE 10.1, 10.4).** Phone med, 4 wholes with one cut into 5 pieces (8 characters, the cap): bubbles on
screen at most 2 + 1 wish slot, plus a second wish that QUESTS 8 allows on screen (a 0.25 dot after its re-glances): 3.25 bubble-equivalents; starts
0.8 a second (burst 2); 2 voices (the piece group voice counts 1); 3 syllables a second (burst 4); 2 autonomous thing sounds a second; 24 particles a
second. Desktop high, 10 characters: 4 + 1 (+ a dot), 1.5 starts a second (burst 3), 3 voices, 4 syllables a second (burst 6), 3 thing sounds a second,
48 particles. The worst one-second burst on a desktop is 6 syllable onsets + 3 thing sounds on top of the ambience (the cabin's crackle runs to 9 a
second) and the music. That is busy but bounded, and under AUDIO's 10 extra live nodes. **The caps hold; the noise leaks are the channels outside the
table:** the B08 afterglow (m8), the kettle's tune (M14), and the quest-complete haptic and stamp sound when autonomy finished the quest (M11).

**The economy (DESIGN 5.4).** No reward breaks the pace, by construction: nothing new feeds the meter, the Journal pays no capsule or squish point,
gifts are 5 for life at most 1 a UTC day, `carryTo` and every autonomous landing never pay, and touches on pieces or on several party members share
the meter's per-kind freshness (DESIGN 5.4: "seconds since your last touch of the SAME kind"), so a bigger party earns nothing extra. I did not run
`_harness/sim_economy.ts`: no new number feeds it. The gift's origin `'restock'` does not use up the daily Restock (ghost.ts 147-160 tracks the
Restock by `ghostRestockDay`, not by origin).

**The owner's five asks.** (1) Places: S1 shows Home and the cabin, S3 all ten: true by S3, but on a phone a place frames squishies at about 57 px
wide (M1). (2) Things used in their own way: mostly true in the cabin, but the cabin's signature verb and about 5 of the 12 hearth cells are only
words (M13), and Home's things stand outside the camera's frame (B2). (3) Social: greet, chat, boop, nuzzle, sing and pass hold in S1; the two
rides need a hold (M6); snuggle and peekaboo have no driver (M7). (4) Pieces, calm: one bubble and one group voice holds, but pieces do nothing while
the Cut tool is in hand and their quests cannot register (M2). (5) Purpose: true in S1 except the Dollop strand (B1), Friends Everywhere in S1 (M10)
and keyboard players at the Hearthlog finale (M9).

---

## 2. Findings

### B1 (BLOCKER) The whole unlock chain hangs on Dollop being owned and out when FIRST_WISH fires
- **Where:** QUESTS 7 (Hearthlog "opens when the first wish shows"), 8 ("Dollop shows a postcard of Hearthlog Cabin"), 13 (backfill: "the first-wish
  script still runs, so everyone gets the first trip"); LIFE 4.1 FIRST_WISH ("Dollop shows the place wish ... through B07, inside the wish caps");
  `lifeScript(w, slot, ...)` takes a character slot (LIFE 12); `src/collection/ghost.ts` 221 (only a hearted item refuses a merge).
- **What is wrong:** Dollop is an ordinary Common (5.45% a capsule) and can be merged away (MERGE_COST 2) or left on the shelf. An existing save may
  hold no Dollop at all; a new player may merge a capsule Dollop with the starter; any player may switch to the newcomer. Then the script has no slot:
  no first wish, so Hearthlog never opens, H8 (the Home finale) can never complete, Friends Everywhere never opens (it needs 2 finales), and Home
  gives at most 9 stamps against Ripple Shore's 12. The player is stranded for good, with no line telling them why. Second hole: a natural wish can
  show first. A squeeze- or pull-lover newcomer out at 1:30 reaches play 0.6 (the touch wish) in about 30 s, at about 2:00; then either the reducer
  opens Hearthlog on the wrong wish (no postcard), or the 120 s gap between new wishes (QUESTS 8, QU-12) pushes the scripted wish past the 5:00
  promise.
- **Fix:** FIRST_WISH picks Dollop if Dollop is out, else the party member out longest (a Hearthlog fan first); the postcard and the card line name
  that squishy. Natural wishes wait until the first wish has shown, and the scripted wish ignores the 120 s gap. If no one can show it by 5:00 of
  play (all held, quiet), Hearthlog opens anyway and H8 accepts the first trip there with any party. The backfill opens Hearthlog at once for an
  existing save. Add LF-19 and QU-06 rows: no Dollop owned; Dollop on the shelf; a touch wish due before 2:30.

### B2 (BLOCKER) Home's things and Home's LIFE area lie outside the camera frame, and the camera never follows autonomy
- **Where:** PLACES 4.1 (things at (0, 1.6), (2.4, -1.4), (-2.3, -1.3), (2.2, 1.6), (0, -2.85), (-2.2, 1.6); "a disc of r 3.1 m when LIFE drives
  them"); PLAYGROUND_BUILD 9 "Camera" (at Home "otherwise frame the slots in use") and D-37; LIFE B03 (wander to any point inside bounds - (R + 0.2)).
  Camera from `src/render/stage.ts`: fov 35 (185), pitch 0.27 (213), TARGET_Y 0.42 (135), distance `max(3.0, 2.4 / aspect)` (260).
- **What is wrong:** by my projection with those constants, one body at Home shows a half-width of 0.76 m at the table centre on 390 x 844 and 1.51 m
  on 1280 x 800. Screen positions (ndc x, y; anything past +-1 is off-screen): Felt Ball 0.00, -0.70 on the phone but **0.00, -1.68 on the desktop**
  (below the frame, so FN-01's ball play happens out of view); Music Box 2.48 / 1.07; Snooze Rug -2.41 / -1.04; Warm Lamp 4.01 / 2.78; Bounce Pad
  -4.01 / -2.78; only the Keepsake Shelf (0.00, 0.14) is in view. The spot check in PLACES 4.1 tested clearance from the mat slots, not visibility.
  Worse, B03 lets the only squishy wander up to 2.4 m from the centre while the phone shows +-0.76 m (a body is gone past 1.26 m), and the camera never
  follows autonomy. In the first minute a phone player can lose their only squishy off the edge, with no way to reach it. S0's promised result ("they
  sing to the Music Box and nap on the rug") happens out of view. The 2-to-5-body layouts widen the frame, but the front things (z 1.6) and the rug
  stay out of it on a phone.
- **Fix:** at Home, LIFE's bounds = the frame of the slots in use minus (R + 0.2) m, recomputed when the party changes (a player act, so no
  autonomous camera); Home's things get per-layout spots inside that frame, and a thing arrives only once its spot is in view (the Music Box and the
  lamp at the frame's side edges, the ball at z of about 0.7). Add an RD row: at 390 x 844 and 1280 x 800, with 1 to 5 bodies, every Home thing that
  has arrived and every LIFE target sit inside the frame and outside the HUD insets.

### M1 (MAJOR) In a place on a phone, framing the whole play area makes every squishy about 57 CSS px wide
- **Where:** PLACES P7 (bounds 3.4 x 2.4 half sizes) and P8 ("the camera frames the whole play bounds"); QUESTS 15 (390 x 844 is the target).
- **What is wrong:** a portrait phone shows 0.757 m of half-width per unit of framing, so 3.4 m needs a framing of 4.49x. A 1 m body is then 390 / 6.8
  = 57 px wide at the table centre (258 px at Home today), before the 60 px right inset. The toy's core is squeezing and stretching a body under a
  finger; at 57 px a finger covers it, a two-sided pull does not fit, and the 36 to 46 px bubbles sit over bodies barely bigger than they are. The
  desktop is fine (188 px).
- **Fix:** give each PlaceDef a portrait layout: bounds of about 1.9 x 2.4 half sizes with the things re-banded into the back and front bands, and
  DT-01 run on both layouts. Add an RD row: a whole squishy at least 120 CSS px wide on 390 x 844 in every place. Do not fix this with a camera
  that follows the party (D-37).

### M2 (MAJOR) The nine "bits" quests cannot register as written, and pieces do nothing while the Cut tool is in hand
- **Where:** QUESTS 4 (PIECES: "sub = the underlying USE verb or REACT kind, n (pieces)"), 5 (`minN`), the main quests C6, R6, I6, G6, T6, W6, L6, E6
  and U6 (all `minN 3`); LIFE 4 B15 ("its first entry ... this visit", once per zone per visit), 9 ("piece events of the same kind within 0.5 s merge"),
  5.6 (any non-Hand tool keeps LIFE quiet); contracts.ts `LifeEvents.n2` "the participants". Note: `setTool` keeps the pieces
  (`src/shell/game.ts` 429-440), so pieces live on in Hand mode.
- **What is wrong:** (a) Nothing says whether `n` is the group size or the pieces that did it in the same 0.5 s. (b) For once-per-visit kinds (WARM,
  FLOAT, WADE, GLOW), the natural move for "Cut a squishy into three, near the fire" is to cut it where it stands. But the whole already fired REACT
  WARM on its way in, and the brain is kept (L5), so no PIECES WARM ever comes. (c) If the cut is made outside, P01 brings the pieces in single
  file, 0.6 m apart at 0.10 to 0.32 m/s, so their entries are seconds apart. Under the "participants" reading that is three events with n = 1, and
  `minN 3` never passes. The same holds for GLIDE, SPLASH, SPIN and BOUNCE unless the group acts within 0.5 s. (d) Right after a cut the Cut tool is
  in hand and LIFE is quiet, so the pieces sit still until the player picks the Hand. No hint says so, and ask 4 ("pieces should be able to
  perform similar interactions") is invisible at the moment the child is looking.
- **Fix:** say that a PIECES record's `n2` is the group's piece count when any piece of the group does the REACT or USE. A cut emits each zone
  REACT the new group stands in, once, as PIECES. Lift the quiet for the cut squishy's group 1 s after the swipe ends (the Cut tool stays in hand).
  Add a LIFE 6.1 "Who" column (W, F, C) saying which joint moments pieces join. Add LF and QU-02 rows built from LIFE's output, not from a generated
  script: cut a whole that is already in the hearth's warmth into 3, which gives one PIECES WARM with n = 3.

### M3 (MAJOR) Most REACT kinds have no trigger, and zone or patch reactions have no rule for their `thing`
- **Where:** QUESTS 4 REACT (23 sub-kinds); LIFE 3.1 (only the six looks crossing 0.5) and B15 (a zone entry, with an icon but no kind); contracts.ts
  `LifeSnapshot.zoneMask` ("zone kinds at the centre as bits") and `LifeEvents.thing`.
- **What is wrong:** RISE, OOZE, WARM (B15 or B05?), SHIVER, GLIDE, SPLASH, DRIFT, LIFT, RATTLE, GLOW, GAZE_SKY, PRINT, SHOWER, FIZZ, HOLD_ON, DRY,
  FLOAT and WADE have no stated producer condition. They decide C2, C9, R2, I3, I4, G2, G7, G9, T2, T4, T7, L2, L5, E2, U3, X6, X7 and the facts
  F4 to F7. It is also unclear whether the event fires when B15 loses the utility choice at that moment (an event or a behaviour?). Several rules
  filter by `thing` (R2 rockpool, I3 icepond, I4 shakepine, G7 dripleaf, T4 bubblepatch, E2 glowpool), but LIFE sees zone kinds only. It cannot tell
  the Rock Pool from the Surf Edge (both water), and it gets the pine's snow through `lifeAddLook` with no source. QU-02 passes from generated
  scripts, so nothing catches the gap until a browser playthrough.
- **Fix:** a `REACT_TRIGGERS` table in `src/data/life.ts`: kind, the condition (a look over 0.5, a zone entry by kind, a pose start, a glide over
  0.5 m, a landing in shallow water ...), once per visit or per event, and how `thing` is set. The host sets `thing` from the zone or patch under
  the body (ThingDef.zone already links them), and `lifeAddLook` takes a source thing. Events fire whatever behaviour wins; B15 is only the look.
  DT row: every REACT kind used by a quest or fact has a trigger row.

### M4 (MAJOR) Twelve species can never find their favourite thing, so their pages never turn gold and their thing wishes cannot come true
- **Where:** QUESTS 9 F2 ("a USE of its favourite thing (by itself, or a ride you set up)"); QUESTS 4 USE verbs (ROLL ... SHAKE: no bask, glide, fizz,
  shower or gaze verb); PLACES 2.1 M14 (a switch is "never" used by a squishy); PLACES 5 favourites; QUESTS 8 (a thing wish "is granted when it uses
  one"; 40% point at the undiscovered favourite).
- **What is wrong:** each of these favourite things is a patch, a zone or a player-only switch with no self-use USE event. Crimpo and Hushpuff: Hearth
  (a bask is B05, not a USE). Boingle: Ice Pond (GLIDE is a REACT). Acornel: Drip Leaf. Marigel: Stepping Stones. Rattlebead: Bubble Patch.
  Glimglop: Tap (switch). Burrbin: Horseshoe Magnet (switch; the scoot is a behaviour). Selenuff: Moon Dish (GAZE_SKY is a REACT). Skeinara: Star
  Scope (switch). Dimpla: Echo Stone (switch). Wisplet: Updraft (LIFT is a REACT). Four are Commons (Crimpo, Boingle, Dimpla, Wisplet). Crimpo is
  Dollop's best friend and a cabin fan, so the gap shows in S1: 40% of Crimpo's thing wishes ask for the Hearth (flame) and none can be granted.
- **Fix:** F2 and the thing wish are found by any USE **or REACT** with `thing` = the favourite. For a switch favourite, they count when the player
  switches it while that squishy is within 1.5 m and watching (B13 or B18). Add a DT-03 row: every favourite thing has an event the squishy can
  make by itself, or a ride.

### M5 (MAJOR) A thing wish can ask for a kind of thing that no open place has
- **Where:** QUESTS 8 (thing wish: "no such thing here, or its favourite thing is here"; glyphs ball, bell, droplet, note, flame, sun); LIFE 12
  `lifeSetJournal` (owned species, open places, known favourites only).
- **What is wrong:** in S1 only Home and Hearthlog exist. There is no bell (chimes ship in S2) and no water (droplet), so a bell or droplet wish
  can never come true. Under the 40% steer, an undiscovered favourite in an unopened place gives the same dead wish: Puddlo, the S1 gift, wishes for
  the Rock Pool. Each squishy has at most 1 open wish, and a resting wish keeps that slot until a 4th wish elsewhere pushes it out.
- **Fix:** `lifeSetJournal` also takes a bitmask of thing kinds present in open, shipped places. The wish scheduler only picks a kind in that mask,
  and a favourite only once its place is open. LF-14 row: no wish targets a kind outside the mask.

### M6 (MAJOR) Nothing keeps a squishy on a ride while the player fetches the second one
- **Where:** PLACES P3 and 4.2 (the Rocker Board: "set two squishies on the ends"; "one alone shows a star wish for a partner"); LIFE 5.5 (afterglow
  1.5 s, grace 1.5 s, then free), B07 (the only "still until granted" behaviour), S10, S11 ("a friend near"); QUESTS 8 (a ride wish needs play > 0.7,
  at most one per place, 120 s since any new wish); quests C3, C5 (S1 main), G3, L9, U4.
- **What is wrong:** after the first rider is set down, LIFE may wander, greet (a hello hop toward a partner) or nap 3 s later, and slide off the
  board. The star wish that would hold it (B07) seldom starts: the carry cost play 0.2 (any touch), and on arrival the 120 s gap usually blocks it.
  S10 needs both riders on the board at once, so C5 becomes a race. S11's "a friend near" may mean Friends (12 points, not reached in the first
  minutes) or any squishy.
- **Fix:** add a RIDE state. A squishy the player set on a ride stays (no SCOOT or HOP off) for 20 s, or until its joint moment ends, or until a
  touch. It shows the star bubble without the wish caps. S11's "friend" means any other squishy within 2.5 m. LF row: a rider set on the rocker is
  still on it 15 s later with no input.

### M7 (MAJOR) Snuggle and peekaboo are detections with no behaviour that brings squishies into them
- **Where:** LIFE S07 ("3+ awake and happy in contact for 6 s"; happy = "a joy event in the last 8 s", LIFE 3) and S13 ("two on opposite sides of a
  block, bar or mound"); quests R8 (a **gift** finale), R5 and E7 (main).
- **What is wrong:** nothing moves three awake squishies into mutual contact. S04 and B17 join pairs, and B06 joins sleepers, which gives S08, not
  S07. Each of the three also needs a joy event inside the same 8 s window. So R8's gift can only come from luck or from the player carrying three
  together, and each carried one is free to leave 3 s after release. S13 has the same gap, plus geometry: the driftwood log and the Hum Rock stand
  in the back band, so "behind" them is outside LIFE's targets (bounds shrunk by R + 0.2 = 0.7 m leave z >= -1.7, and the log's back face is at
  z -1.58).
- **Fix:** make S07 a behaviour. When 3 or more are idle within 2.5 m and any one had a joy event in the last 8 s, they gather in a row by the
  contact primitive. Define "happy" as a mood any one of them has. Make S13 a behaviour on the thing's two use spots, left and right of it as the
  camera sees it (two `useSpot`s in ThingDef). LF-09 rows for both.

### M8 (MAJOR) The ring nests are too small for the piles the specs promise
- **Where:** PLACES 2.1 M4 (ring r 0.70..1.00, segments r 0.08..0.10), 4.2 Snug Basket ("a pile of 3 fits"), 4.4 Snowdrift Nest, 4.10 Cloud Nest;
  QUESTS 13 (8:30 to 10:00, "two pile into the Snug Basket"), U9 ("Two squishies nap in the Cloud Nest", `thing cloudnest, minN 2`); LIFE B06.
- **What is wrong:** the clear inner radius is 0.81 m (basket) and 0.75 m (both nests). Two circles fit only if R <= 0.405 / 0.375, three only if
  R <= 0.376 / 0.348, but bodies are R 0.40 to 0.625 (shape.ts 68). Even the range maximum (r 1.0, segment 0.08: inner 0.92) holds two only at
  R <= 0.46. Resting soft bodies spread rather than shrink. So "a pile of 3 fits" is false, and U9 cannot be met if "in the nest" means inside.
  The clear width of the gap is 1.20 m (basket) and 1.10 m (nests), narrower than an R 0.625 body. No rule makes B06 approach through the gap
  mouth (B03 ends "blocked 2 s").
- **Fix:** a pile counts for a ring thing when any napper's centre is inside the ring. Change the copy to "one curls up inside, friends nap against
  it". B06 gets a gap-mouth waypoint. DT-01 checks the clear gap width against 2 x 0.625 + 0.1 m. Or widen M4 to r 1.4 where a place has the room.

### M9 (MAJOR) The keyboard cannot tap a thing's switch, yet the Hearthlog gift finale needs one
- **Where:** QUESTS 6 "Keys" (84: Space on the focused squishy, "Go play with..." for uses and rides, Wishes now, the Cut bar, Snap, Travel), 15 and
  PLAYGROUND_BUILD 11.8 (no "tap a thing" action); quests marked K that need a switch: C8 (gift), G7, T7, W2, W4, E4, L7; H6 "Tap a bubble" (only a
  wish bubble has a keyboard path: "Enter on a focused squishy with a wish").
- **What is wrong:** a keyboard-only player cannot finish "Fireside song", so no Hearthlog gift, no second finale and no Friends Everywhere. QU-09
  (CS-02) would fail on the real build while the K column says it passes.
- **Fix:** the name-tag popover's "Go play with..." also lists the place's switch things as "Tap the Hearth", and each one emits USE SWITCH by
  PLAYER. Enter on a focused squishy that has a bubble shows that bubble's meaning (UI EMOTE_TAP). Add both to SH-14.

### M10 (MAJOR) In the S1 build, Friends Everywhere cannot finish and its gift finale never opens
- **Where:** QUESTS 6.10 (X4 "Sing together in three places", X5 "Visit three places beyond Home", X7 water + cold + fire, X9 nap piles in three
  places; X8 opens at 5 of the 7 main quests); PLAYGROUND_BUILD 15 S1 ("chapters Home, Hearthlog and Friends Everywhere (its place quests complete as
  places arrive)"); QUESTS 15 (the tracker shows "the first unfinished main quest"; locked chapters read "Opens at N stamps").
- **What is wrong:** with only Home and Hearthlog shipped, X4, X5 and X7 (and X9) are impossible. Only X1, X2, X3 and X6 remain, 4 of 7, so X8 (the
  Friendship Frame and a gift) can never open in S1. The tracker can sit on an impossible quest. The Journal can show Ripple Shore as "Opens at 12
  stamps" to a player who has 25, because nothing hides unshipped chapters there (Travel hides them).
- **Fix:** in S1, X4, X5, X7 and X9 count "every open place" (cap the count at the number of shipped places), or Friends Everywhere waits for S2.
  The tracker skips a quest it cannot complete in the shipped set. The Journal hides an unshipped place's chapter just as Travel does. QU-06 row:
  in every slice build, every shown quest is completable.

### M11 (MAJOR) A quest finished by autonomy still buzzes the phone and plays the stamp sound
- **Where:** QUESTS 15 (the quest-complete moment: "one soft procedural stamp sound ... (a player-caused UI sound) and one 10 ms haptic tick
  (player-caused)"); LIFE L7 ("Autonomy never vibrates the phone"); EC-02 ("60 sim minutes with no input ... 0 haptics").
- **What is wrong:** H2, H5, H10, C2, C4, C7, C9, C10, X1 and X6 complete with no input, because their rules are by SELF or any. Each one fires the
  moment, so a no-input hour at Hearthlog buzzes the phone several times. EC-02 then fails, or a lane quietly drops the haptic for all quests.
- **Fix:** the haptic tick fires only when the event that completed the quest has `by` PLAYER. The stamp sound may stay as a UI cue, never through
  `registerFx`. Add an EC-02 row that counts quest moments in the no-input hour and expects 0 haptics with more than 0 moments.

### M12 (MAJOR) With "Squishies move on their own" off, whole kinds of quest and wish become impossible, and nothing says so
- **Where:** LIFE 5.6 (autonomy off: no hop, squash, pose, glide or `moveTo`); QUESTS 15 help line ("When off, they stay where you put them. They still
  look around and chirp."); the by SELF rules H2 and C4, and the moves inside C3, C5, R4, R5, G3, G5, I5, S12; QUESTS 8 (a thing wish is granted when
  it "uses one").
- **What is wrong:** H2, C3, C4 and C5 cannot happen, so Hearthlog's finale reaches only C1, C2, C6, C7 (4 of 7) and never opens. Without it there
  is no second finale and no Friends Everywhere, and every thing wish becomes impossible. A parent who switches it off to calm the screen locks
  the child out of most of the game.
- **Fix:** with autonomy off, a player-asked use ("Go play with...", or a tap on a thing next to a squishy) still moves that one squishy. Rules that
  need by SELF accept by PLAYER while autonomy is off. Quests that still cannot complete show "Needs: Squishies move on their own". Add a QU-09
  twin: every threshold is reachable with autonomy off.

### M13 (MAJOR) Several "in their own way" reactions are only words, the cabin's signature verb among them
- **Where:** PLACES 4.2, line 281 ("marshmallows toast golden and **hop round to toast their other side**") and line 303 (the signature verb);
  LIFE 5.1 (the primitives: scoot, hop, glide, pose, render lean and sway, contact: no turn); contracts.ts `setHeatPoint` ("toast browns the side of a
  body facing it"); `src/render/face.ts` 3-7 (the eyes are fixed to the body's +Z front); PLACES 4.2 cells; LIFE B16 ("turns away 30 degrees (render
  lean)"); DT-06 counts non-empty cells.
- **What is wrong:** no primitive turns a body about its vertical axis, and the toast look is computed from the heat point in world space. A "turned"
  marshmallow would brown on the same side, so the signature verb has neither a mechanism nor a visible result. Cabin cells with no channel behind
  them: the hearth column for firmsilicone, popdome and beadsqueeze ("basks": a sun bubble only, the same for all three) and slowrise ("dries out":
  in S1 nothing is soaked). Also waterfill's "steam wisps" (no look channel, `setBodyLook` has frost, wet, sand, toast, snow), stickystretch's
  "stringier look", marshmallow's "puffs up as it swings" and "fluffs up", waterfill's "a slower slosh look", slowrise's "rises even slower" (tagged B,
  but it describes physics recovery, which P11 forbids changing at run time), and the kettle's "the steam soaks it a little" (soak rises only in water
  or rain, LIFE 3.1). A huff "turns away" by a lean. FN-02 only checks 4 families at the hearth, so this passes every row.
- **Fix:** every REACTIONS cell carries its channel (a pose target, a look and its level, a sound id, a behaviour id, a particle preset), and DT-06
  counts only cells with a real channel. For the cabin, replace "turn round" with a supported verb, for example "marshmallows toast golden, then
  hop back from the heat when they are done", or add a yaw driver and a per-side toast memory to PHYS and RENDER. Give the bask-only families one
  visible thing each (the firm and pop dome squash pulse at 0.5 Hz, the bead's rattle on each settle).

### M14 (MAJOR) The Singing Kettle's tune fills most of the cabin visit and mutes the music
- **Where:** PLACES 4.2 (the kettle "sings by itself every 30 to 50 s"); PG_AUDIO 48 ("musicBox ... the tune is 8 bars in the sounding field, at most once
  per 12 s") and 59 ("The kettle's song is a `musicBox` tune"); contracts.ts `musicBox` (the bed mutes its mallets while it plays); LIFE B18 and S06.
- **What is wrong:** 8 bars at 66 BPM last 29.1 s. Every 30 to 50 s (start to start) that is 58 to 97% of the time, and still 37 to 49% if the gap
  runs from the end. All that time the bed's mallets are muted, every chatty squishy answers on each song, and S06 can start. The cabin turns into
  a kettle loop. "At most once per 12 s" cannot hold for a 29 s tune either.
- **Fix:** the kettle sings a 1-bar whistle phrase (3.6 s) every 45 to 90 s, never within 60 s of a Music Box tune. The Music Box keeps 8 bars but at
  most once per 40 s, and a second tap stops it. Add an AU row: over a 10-minute cabin visit, tunes sound at most 20% of the time.

### M15 (MAJOR) Fizzwell's bath floods half the ceremony pad
- **Where:** PLACES 4.6 (Bath Water "a box over the back half, z < -0.2, with the 0.4 m depth ramp at its front edge"), P6 (the pad, r 1.2 at (0, 0), "no
  thing in it"), PLAYGROUND_BUILD D-47 ("the pad dry").
- **What is wrong:** the pad spans z -1.2 to 1.2, so the water covers 1.0 m of it, at full 0.28 m depth from z -0.6. A floater revealed there floats
  during its reveal. The fix is a move of more than 1.0 m, past the DATA lane's 0.5 m allowance, and once the edge is at z -1.2 the Swirl Ride
  (r 0.7 at z -1.4) and the Bubble Patch (its edge 1.10 m from the centre, inside the pad) no longer fit.
- **Fix:** re-lay Fizzwell now: move the pad to the dry front (for example (0, 1.0) with a front-band height waiver), or confine the water to
  z < -1.2 and re-place the swirl ride, the raft, the slide and the bubble patch. DT-01 should also check zones against the pad, not only colliders.

### M16 (MAJOR) Three "distinct part" quests have no part field in any event
- **Where:** QUESTS 5 (`distinct: 'part'`, 8 bits), R3 ("Ring three different shells"), L3 ("Light three different lanterns"), E3 ("Ring three
  different crystals"); contracts.ts `LifeEvents` (kind, sub, a, b, n2, thing) and `PlayEventRing` (no part); `drainStrikes` gives a prop index.
- **What is wrong:** the reducer and the producer are in two lanes (QUESTS and SHELL), and nothing says where the part goes (`v`? `sub`? a prop
  index?). The rules cannot be checked from the events as typed, and QU-02's generated scripts will pass whatever the reducer expects.
- **Fix:** document in the PLAYGROUND block that `PlayEventRing.v` carries the part index (0..7, the prop's order within its thing) for USE RING. The
  host maps the prop index to (thing, part) from the PlaceDef. Add a QU-08 row that the producer and the reducer agree on it.

### m1 (MINOR) The weather rings the shells and the bells by itself, so two quests finish with nobody doing anything
- **Where:** PLACES 4.3 Shell Chimes ("a wave's breeze rings one now and then"), 4.4 Icicle Bells ("a wind gust rings them too"); R3 and I9 have no `by`
  and no species.
- **Fix:** strikes from weather make a sound but no USE event. A USE RING needs an actor, a squishy or the player.

### m2 (MINOR) X10 "Grant five wishes" can complete with no input
- **Where:** QUESTS 6.10 X10 `WISH{GRANTED} x5` (any `by`); nap, song, thing and warm-up wishes come true by themselves (QUESTS 4 WISH).
- **Fix:** `by PLAYER` on X10, so the title's verb is true (Q7). Keepsake 15, "ten wishes come true", may stay any.

### m3 (MINOR) Rule Q3 ("No quest needs a tap") is broken by nine quests as written
- **Where:** QUESTS Q3; H6 (tap a bubble), H9 (flick the ball, a `poke` on a prop), C8, G7, T7, W2, W4, E4, L7 (tap a switch).
- **What is wrong:** QU-03 checks Q3, so the check must either fail or be weakened.
- **Fix:** restate Q3 as "No quest needs a tap on a squishy (a poke); taps on things and bubbles are fine" (that is the DESIGN 5.4 rule it protects).

### m4 (MINOR) The Rocker Board is too short and too close to the wall for two riders, and its end goes into the floor
- **Where:** PLACES 4.2 Rocker Board (1.6 m along x at (2.45, -0.55), pivot 0.16, limit 12 degrees); the right log wall at x 3.4.
- **What is wrong:** the board's right end is 0.15 m from the wall. Two R 0.5 riders need 2.0 m, so they overlap or the wall pushes the right one
  inward over the pivot. At 12 degrees the end drops 0.8 x sin 12 = 0.166 m, more than the 0.16 m pivot, so the board's end goes 6 mm into the
  floor. DT-01 has no end-clearance rule.
- **Fix:** a 2.2 m board with at least 0.6 m to the wall (or one running along z). Add the DT-01 rule half-length x sin(limit) < pivot height.

### m5 (MINOR) Every capsule reveal counts as "coming out", so needs and looks reset every 3 to 4 minutes
- **Where:** LIFE 3 ("every time it comes out (a trip, the shelf, a ceremony)"), 3.1 (looks "reset to 0 each time a squishy comes out"); QUESTS 13 8:30 to
  10:00.
- **What is wrong:** a golden marshmallow goes white at each reveal, and frost and soak vanish. Rest restarts at 0.2, which needs 158 s at median
  dozy (105 s in the warmth) to reach B06's 0.75. So the onboarding's pile right after the 8:30 reveal is not reachable by 10:00 (rest 0.67 in the
  warmth).
- **Fix:** a ceremony's stash and restore keeps needs and looks. Only the shelf and a trip reset them.

### m6 (MINOR) The look rates cancel in a weak cold zone
- **Where:** LIFE 3.1 frost (rises 0.05 x the cold strength; falls "0.02 elsewhere").
- **What is wrong:** in the cabin's Window Draught (cold 0.3), frost rises at 0.015 and falls at 0.02 if "elsewhere" means "not warm", so it never
  rises. That kills PG_LIFE S1's "the cold draught gives ... FROST" and Echo Hollow's Cave Cool (0.3). The snowball adds +0.3 in PLACES 4.4 but +0.5
  in LIFE 3.1.
- **Fix:** a look falls at its "elsewhere" rate only while its rising cause is absent. Make the snowball one number.

### m7 (MINOR) In S1, the Journal names places the player cannot see
- **Where:** PLACES 5 gift list line ("All three love Ripple Shore."), QUESTS 9 F3 hint ("Its best friend loves Frostbell Ridge."), QUESTS 7 (unshipped
  places are not shown in Travel).
- **Fix:** while a named place is unshipped, the gift card says "Three new friends for you." and the F3 hint names the friend's family instead.

### m8 (MINOR) Is the B08 afterglow budgeted? The specs disagree
- **Where:** LIFE B08 (its sparkle or 40% giggle with a voice), L2 and 10.2 ("player-caused feedback ... is never budgeted"), the 10.1 header
  "autonomous only".
- **What is wrong:** if lanes treat the afterglow as player-caused, quick taps across 8 characters give one bubble each (5 on a phone med with
  one piece group) against the cap of 2 + 1.
- **Fix:** B08's emote and voice go through the budget as P1. Only `feedback.ts` effects stay outside it.

### m9 (MINOR) The wish and piece-group caps disagree between pages
- **Where:** QUESTS 8 ("2 on screen") against LIFE 10.1 ("+1 kept for a wish"); LIFE 10.1 "piece groups ... desktop 2" while LIFE 9 allows one
  squishy in pieces at a time.
- **Fix:** one wish slot plus at most one more wish as a dot; piece groups 1 everywhere.

### m10 (MINOR) With sound off, a chat has no bubble
- **Where:** LIFE 8.3 (chat: "none: a chat is never budget-critical"), 7.2 and UI-03 (the voice-to-bubble table must be total); DIRECTION D11.
- **Fix:** with sound off, a chat shows one "hello" bubble on the first speaker at its start.

### m11 (MINOR) A friend wish can be impossible within the visit
- **Where:** QUESTS 8 (a friend wish is granted when "they greet or nuzzle"); LIFE S01 (once per pair per visit), S04 (Friends, or cuddly >= 0.6).
- **What is wrong:** if the friend was out earlier in the visit, the greet is spent, and a non-cuddly Met pair cannot nuzzle.
- **Fix:** the grant greets once more, ignoring the per-visit limit and giving no points.

### m12 (MINOR) The place-wish rule is a garbled sentence
- **Where:** QUESTS 8 ("its favourite place (or, 40% of the time while undiscovered, its favourite) is open and not here").
- **Fix:** "an open place that is not here; while its favourite place is undiscovered and open, 40% of these are its favourite."

### m13 (MINOR) "Never before the Home chapter is done" is ambiguous for gifts
- **Where:** QUESTS 11 (gift bound).
- **What is wrong:** if it means all 10 Home quests, H3 (K\*) and H10 (a nap pile) hold back the first gift.
- **Fix:** "never before the Home finale."

### m14 (MINOR) The Sunbow Arch breaks the front-band height rule, and moving it hits the nest
- **Where:** PLACES 4.10 (Sunbow Arch 1.3 m high at (0.9, 1.6); Cloud Nest ring r 0.85 at (2.6, 1.3)), P7 (front-band statics at most 0.4 m); U8
  (finale).
- **What is wrong:** a move of 0.5 m or less into the side band collides with the Cloud Nest (clearance 0.3 m).
- **Fix:** re-lay Cloudloft by hand before S3, with the arch in the back band.

### m15 (MINOR) A Journal gift shows "Restock" as its origin in the Hoard
- **Where:** QUESTS 11 step 2 (origin `'restock'` for older-build safety); `src/collection/copy.ts` 202-203 (`originCopy('restock')` = "Restock").
- **Fix:** the Hoard shows "Gift" for an item whose id starts with `jg-`, and keeps the stored origin unchanged.

### m16 (MINOR) FN-01's first-bubble bar conflicts with the HELD rule
- **Where:** FN-01 ("its first labelled bubble within 30 s of the start"); LIFE L2 (a held squishy issues no autonomous bubble); QUESTS 13 (H1 at 0:05 to
  0:40, the player holding).
- **Fix:** the bar reads "within 10 s of the first 6 s release".

---

## 3. What I did not check

- No run of anything heavy: no browser, build, probe suite or `sim_economy.ts`. The screen positions in B2 and M1 come from my own projection of
  the camera constants in `stage.ts` (fov 35, pitch 0.27, TARGET_Y 0.42, distance `max(3.0, 2.4 / aspect)`), with one body at the rest framing and
  zoom 1. I did not model the multi-body reframing exactly. A screenshot at 390 x 844 and 1280 x 800 with Home's things placed would confirm it in
  a minute.
- The ring packing in M8 treats bodies as rigid circles. Real soft bodies squash by some 10 to 20%, which still does not make two R 0.5 bodies fit
  in a 0.81 m radius.
- The need and look times in m5 and m6 use LIFE 2's trait spreads (one seed per species, no twist), not a run of LIFE.
- I checked DT-01 geometry only where I cite it (Hearthlog's rocker, Fizzwell's pad, Cloudloft's arch). The other places' positions are unchecked
  design intent, as PLACES 4.11 says.
- I did not check every one of the 110 quests' title-to-event verbs (DT-09), every player line against the name gate, or any physics claim (support
  on props, weight transfer, the swing seat holding a body).
- Nobody has seen or heard any of this. "Cute", "calm" and "noisy" above are judged from the caps and the timings, not from a playthrough.
