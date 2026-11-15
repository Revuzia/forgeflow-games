# JUDGE: fun and purpose (PLAYGROUND proposals A, B, C)

Judge of the design panel, 2026-11-15. Lens: **fun and purpose**, as a lead game designer and as a parent watching a seven-year-old play.
Paths are relative to G = `games/wobblehoard`.

**Read in full:** `_handoff/STATUS.md`, `briefs/COMMON.md`, `briefs/SESSION3.md`, `design/DIRECTION.md` (with 1b), `PROPOSAL_A.md` (1132 lines),
`PROPOSAL_B.md` (1167), `PROPOSAL_C.md` (1285). **Looked up to check claims:** `_handoff/maps/PHYS.md` 107, 219, 231; `src/physics/softbody.ts` 155;
`src/data/catalog.ts` (signatures, tiers, families); `src/ui/hoard/panel.ts` 216, 354, 374-376; `_spec/DESIGN.md` 356; `_spec/CUT.md` 1-30;
`_spec/UI.md` 21-33. **Ran:** one short node script that counted the catalog's species by family and tier. Nothing else: no tsc (I wrote no code),
no probe, no browser. Section 8 lists what I did not check.

**Facts from the code that the judgement leans on**
- A body is R 0.4 to 0.625 m (`shape.ts:68`, PHYS map 219), so 0.8 to 1.25 m across. A `land` event fires at 0.9 m/s (`softbody.ts:155`), which is a
  drop of about 4 cm. The PHYS map (231) gives the choice: hops under 4 cm, or higher hops with a "quiet land" flag.
- The catalog has **14 Commons**, not 25. Three families have no Common at all: slime goo, slow-rise and putty. The bead squeeze Common is Crumbit.
  Dollop (the starter) is jelly gel, and its signature touch is a poke (`catalog.ts:215`).
- The Hoard's protection mark is called **Heart** where players see it. It has a ♥ glyph, "Hearted" tags and a **"Hearts" filter chip**
  (`panel.ts:216, 374-376`; DESIGN 5.6 at line 356: "Every document uses this name").

---

## 1. Scores (fun and purpose, 0 to 10)

| Proposal | Score | One-line verdict |
|---|---|---|
| **A** (toy first) | **7.5** | The most alive and the most delightful inside what it covers: the best first minute, 12 family gaits, specific family-by-thing tables for every thing. It has only 3 places (written before 1b), and its story thins out after day 7. |
| **C** (systems first) | **7.0** | The only proposal that meets 1b: 9 places, a 14-mechanism library and a real path over weeks. It is also the least alive: life is mostly in the eyes, every family scoots the same way, and hops are under 4 cm. The things repeat across places. It has three tone bugs (a guilt sulk, warmth halved on merge, hearts used for friendship) and one logic bug in the onboarding unlock. |
| **B** (purpose first) | **6.5** | The best-reasoned purpose: chosen gift picks, a dark-pattern audit, wishes that lead to discoveries, a backfill for players who already have a shelf. But it has a quiet first minute, hops of 3.6 cm, a huff when you toss, and comfort after a cut. It has only 3 places, and the story is finished in about a week. |

### 1.1 The five owner asks: does each become visibly true?

| Ask | A | B | C |
|---|---|---|---|
| 1 Places | **Partly**: Home + 3 (Cove, Flurrytop, Toastwood); pre-1b | **Partly**: Home + 3 (Sunfizz, Hushpeak, Hearthpine); pre-1b | **Yes**: Home + 9, each with its own ground, zones, light, weather and sound (1.2-1.10) |
| 2 Things, "in their own way" | **Yes, strongest**: a family-by-thing table for every thing in every place (2.2); 12 gaits and hop scales (2.1); only some families can climb, so the others need your hand | **Yes**: one family-by-place table (2.2); real float lines worked out from density ("big ones sit in the shallows", a soaked slow-rise sinks slowly) | **Mostly**: three channel tables (2.2-2.4) that cover any place by construction (DT-06). But all families scoot the same way, the magnet column is "looks puzzled" for 11 of 12 families, and many self-uses are "when set there" (player only) |
| 3 Social, cute | **Yes**: 11 interactions plus the best-pal twirl; the boop and the squirt game are the cutest moments in the panel | **Yes**: 9 interactions; mirror dance gives repeat copies a use | **On paper yes** (12 interactions, the echo, the duet), but the caps of 1 / 2 / 4 movers (6.3) and nuzzles gated at 2 hearts (6 points a day, 4.2) mean that day-1 players rarely see the cutest moments |
| 4 Pieces, calm | **Yes**: one flock, one bubble, one group voice; "ducklings" behind the face piece | **Yes**: one bubble per parent; "piece parade"; pieces count toward group-size quests | **Yes, strongest**: group bubbles with count dots, voices duck while you touch, and a pieces quest in every chapter |
| 5 Purpose | **Good to day 7**: 37 pages, wishes, 300 discoveries, keepsakes; thin by day 30 | **Good to day 7**: 37 quests, 600 facts, 24 keepsakes, gift picks; the story is done by about day 7 | **Yes over weeks**: 110 quests, stamps open places, a cross-place chapter. Some quests are chores (x5 and x8 counts), and the finales repeat |

### 1.2 Why A scores 7.5
- **The first minute (A 0, 7.7) is the one a child smiles at.** You let go of Dollop and it looks at the Felt Ball, gives a tiny question bubble,
  hops three wobbly hops and boops the ball. The first capsule's newcomer **stays out** (7.7 at 1:30) and says hello with a mirrored call. No menu
  trip is needed.
- **"In their own way" is physical, not only a look.** It has 12 gaits (sink, pad, plod, jiggle, slosh, shuffle, peel, ooze, boing, bob, chew,
  crunch) with their own hop scales and step rates (2.1). Putty and slime never hop: they lean and glide. The climb gate (hop scale 0.8 or more)
  means "the toy teaches you who needs help". Every cell of 2.2 names something you would actually see (M1 to M15).
- **The moments are specific and surprising.** Burrbin's studs leave a dotted print on Kneadle that heals over 40 s (M3). On the Pine Swing, the
  water inside goes the other way to the swing (M8). The Kettle sings and the chatty ones answer it (M13). A marshmallow toasts, then hops round to
  toast its other side (M4).
- **Finales change the place** (7.3). At the sunset hug the sky warms to sunset. At the snowy snuggle the snow slows and the stars come out.
  The fireside song plays with the music.
- **It teaches the vocabulary.** The first three bubbles carry a word ("loves it", "hello", "curious"), and quest H7 is "Tap a bubble to see what it
  means" (5.1).
- **Against it.** Only 3 places. Its hops go up to 0.12 m, and the climb hop is 0.18 m at vy 1.90 m/s. That route depends on an unproven `auto`
  land and on the fold gate (A admits this in "Not checked"). It has 41 icons (24 squishmoji plus 17 wish glyphs), too many for a child to learn.
  Its Daily Wishes are replaced every day, a mild checklist. It sulks when you put a partner away (B08). It uses the ♥ icon. There are no
  cross-place quests. Day 30 is "the collection itself".

### 1.3 Why C scores 7.0
- **It meets 1b, with taste.** Ripple Shore, Frostbell Ridge, Puddlebrook Garden (rain showers, puddle jumps), Fizzwell Tub (floaters and sinkers
  everywhere, a boat on the tap swirl), Cogwhistle Bench (wind-up cog, magnet), Lanternroof (moon gazing, a vane the breeze turns), Echo Hollow (the
  cave repeats every voice), Cloudloft (an updraft that floats marshmallows). The **postcard and stamp** frame (7.6, 8.2) is the clearest
  "why go on" for a child: "Needs 12 stamps", "A new postcard arrived!".
- **Pieces get a purpose.** Slot 6 of every chapter is a pieces quest (7.4). Group bubbles show 1 to 3 dots for the count (5.1, 6.2). While you
  touch anything, other bubbles stop and other voices duck 6 dB (5.4). This is the strongest calm design for many characters.
- **Against it, for fun:**
  - **Too still.** R4 keeps each squishy still at least 60% of the time (LF-10: motion 40% or less). Movers are capped at 1 / 2 / 4 (6.3). Low
    therefore allows **one** autonomous mover, so pass-the-ball, teeter and follow-the-leader cannot run as designed on low.
  - **Too small.** Hops are at most 3.5 cm (3.4), which is 2.8% to 4.4% of a body's width: a twitch, not a hop. Every family uses the same
    inchworm scoot. There is no per-species voice motif: phrases are picked by behaviour only (5.3).
  - **Repetition.** 6 nap bowls, 5 chimes, 5 pools, 5 balls, 4 spring pads, and 4 ramps that squishies use only "when set there". The
    nine place finales are 3 nap piles, 3 sing-alongs, 1 parade, 1 warm-up and 1 machine. Six main quests are x5 of one deed (yarn ball, shell
    chimes, mushroom, spring plate, lanterns, puff pads), and two bonus quests are x5 and x8 (brass bell, icicle bells).
  - **Tone bugs.** B12 sulks when "its wish showed 3 min unnoticed" (3.3). The "Hold me" wish fires after "no touch for 3 min" (7.7). A merge
    halves warmth: "max(parents)/2" (4.3). Friendship is shown as "hearts" (4.2), the same word and glyph as the Hoard's protection mark.
  - **Logic and economy bugs.** The Home finale and the Hearthlog unlock contradict each other (must-fix F1). Finale gating is not stated. 11
    capsules for life take the fastest paying style to about 2.8 min a capsule in week 1 (7.11), outside the 3 to 4 band. Bubbles are cut from
    photos (5.2, 11.1).

### 1.4 Why B scores 6.5
- **The purpose design is the most careful.** Gift picks (7.4, 7.12) are a *choice* of three named Commons or Uncommons, each with a reason ("All
  three love Sunfizz Cove"). That is a reward that points you at the next place, and it cannot move the pace. B also has the dark-pattern audit
  (7.13). Wishes lead to discovery: 40% of place and thing wishes point at an undiscovered favourite (7.6). A wish rests in the Journal with "No
  hurry". There is a backfill so existing players skip onboarding (9.8), and QU01 proves "everything with Commons". Hints name a species to look
  for, which gives trade a reason (7.14). The mirror dance gives repeat copies a use (4.1, 7.14). Things arrive at Home one by one (1.1).
- **Against it.** Minute 0 is "as clean as today" (1.1): only a Music Box. At 0:25 the pill sends a new player into the Restock menu (7.10). Hops
  are at most 3.6 cm (3.4). Thinking every 0.5 s can make reactions late. It huffs at "a toss it did not like" (3.3 #14), and toss is a core verb.
  It comforts a pal that "was cut" (3.3 #12), which frames cutting as hurting. n1 is titled "Say hello" but asks for a squeeze, while n5 "Hello,
  hello" is the greet: a child will mix them up. Only 3 places, and the story ends around day 6 to 8 (7.11).

---

## 2. The best ideas each proposal brings (the final design must keep these)

**From A**
1. **The first minute** (0, items 1 to 3) as the S0 acceptance scenario. The newcomer **stays out** after its reveal (7.7 at 1:30).
2. **12 family gaits with hop scales and step rates** (2.1). The **climb gate as a later stretch**: "the toy teaches you who needs help".
3. **The moments table M1 to M15** (0), especially M3 (stud print), M4 (toast and turn round), M8 (slosh against the swing), M12 (soak, sink, dry
   and rise), M13 (the Kettle sings and they answer).
4. **Specific family-by-thing tables** (2.2): every thing in a place gets one cell per family, as the standard that C's channel tables must be
   filled to.
5. **Social S03 boop, S09 squirt game, S11 pass the ball, S05 sing at a singing spot, the best-pal twirl** (4).
6. **The species voice motif**: "every Dollop has the same three-note call" (5.2), plus discovery D5 "Dollop's song" with a play button (7.5).
7. **Words under the first three bubbles, and "Tap a bubble to see what it means"** (5.1, quest H7). The **Wishes now** list in the Journal, with
   keyboard grants (8).
8. **Finales that change the place** (7.3): sunset, stars, the fireside song.
9. **The first wish is the first trip**: Dollop dreams of a place, you go, the wish is granted on arrival, and that is the Home finale (7.3 H*,
   7.7 at 3:30 to 4:10).
10. **Warmth as 5 glow dots** with simple, visible unlocks (4): at 3 it hops toward you, at 5 it leaves a faint sparkle trail.
11. **The Tick Clock on the music beat** (1.4, M5), and **Shake Pine snow on a friend's head** (M10).

**From B**
1. **Gift picks instead of capsules** (7.4, 7.12): one chosen squishy per finale from a fixed, shown list, each tied to the next place, bounded
   for life, with origin `'restock'`. If the shelf is full, the gift waits.
2. **The dark-pattern audit table** (7.13) as a checked list in the spec.
3. **Wishes lead to discoveries** (7.6: 40% point at an undiscovered favourite). A wish **rests** in the Journal ("No hurry"). The first wish is
   scripted and easy.
4. **Mirror dance**: two copies of one species dance alike (4.1, F11), so repeat copies matter.
5. **"Every way is fine"** (c6): see three kinds of squishy in the water. This quest teaches "in their own way" by itself.
6. **Pieces count toward group sizes** (7.4 c9, h6, h7), so a low-tier player can reach 4 with pieces.
7. **Things arrive at Home one by one** (1.1), so Home grows as you play.
8. **Backfill for returning players** (9.8 `bf`), and **QU01: every quest can be done with Commons**.
9. **Hints that name a species**, such as "Its best friend loves Hearthpine Cabin" (7.7). Never a blank "???".
10. **Shy arrival** (3.3 #18): a new squishy keeps a little distance and looks down for 20 s.
11. **The floating rule worked out** (2.1): the sphere-model float line gives "big ones sit in the shallows" and "sinkers sit with their tops out".
12. **The Places button stays hidden until a second place opens** (8.1), so minute 0 stays clean.

**From C**
1. **The world**: 9 places (1.2-1.10), the **14-mechanism library** (1.0) and **the cost of a tenth place** (1.11: about 1.5 KB of data and 45 KB
   of render, no new physics, LIFE or quest code).
2. **Postcards and stamps** (7.6, 8.2): stamps open places, and a new place "arrives" as a postcard.
3. **The signature gimmicks:** Echo Hollow's **echo talk** (squishies answer their own echo, 1.9, 5.3); Cloudloft's **updraft hover** (1.10);
   Puddlebrook's **drip-leaf shower** that soaks a foam so it squirts (1.5); Fizzwell's **floaters and sinkers everywhere** with a boat on the tap
   swirl (1.6); Cogwhistle's **wind-up cog** (1.7); Lanternroof's **moon gazing** (1.8).
4. **Channel reaction tables plus DT-06** (2.2-2.5): every family has at least 3 reactions in every place, by construction.
5. **Follow the leader, push the swing, peekaboo, the duet at 3 levels, the teeter** (4.1).
6. **Calm for many characters:** while the player touches anything, other bubbles stop and voices duck 6 dB (5.4). Group bubbles carry count dots
   (5.1). Bumps between two untouched bodies under 0.8 m/s are silent.
7. **A pieces quest in every chapter** (7.4 slot 6).
8. **A cross-place chapter, "Friends Everywhere"** (7.4).
9. **Warm poses through `setSquash`** (2.1: mochi rises 1.06, slime oozes flat 0.80). In a place with no water, families still differ in their
   bodies, not only in looks.
10. **The quest grammar's fairness rules** (7.3): a main quest may name a family only if it has at least 2 Commons, and every clause must be
    reachable at low caps.
11. **No autonomous camera moves**, and the party-centroid follow clamped to a box (5.4, 9.6).

---

## 3. Must-fix list (nobody got it right, or the recommended base gets it wrong)

| # | Problem (where) | Correction |
|---|---|---|
| F1 | **C's onboarding unlock contradicts itself.** Home #8 is "Off to the cabin!" `Visit{hearthlog}` (7.4), yet Hearthlog needs "Home finale (8 stamps of Home's 8 main)" (7.6). Meanwhile 7.10 gives the finale at 3:20 and H8 is done only at 3:40. | Use A's shape. Hearthlog opens when the first wish is **shown** (Home 7). The Home finale is "Dollop's wish comes true", granted on arrival at the cabin, and it gives the Felt Star. Home then has 7 main quests, and the visit is the finale. |
| F2 | **C never says when a finale opens**, and its slot 7 ("Who loves the shore?" `Discover{FAV_PLACE}`) needs a squishy you may not own (each place has only 1 to 3 Commons among its fans, 2.6). | Every finale opens at **5 of 7** main quests (A and B use 7 of 9). Move "Who loves X?" to the bonus quests. |
| F3 | **Sulks caused by the player.** C B12: an unnoticed wish or a friend leaving. A B08: you put its partner away. B #14: a toss it did not like. | A sulk or huff may start **only from a squishy-to-squishy event in the scene** (another took its ball or its seat). It lasts at most 3 s and any touch turns it into a giggle. Never from the player's play, absence or inattention. Put this in the dark-pattern audit as a checked rule. |
| F4 | **B comforts a pal that "was cut"** (3.3 #12, 4.1). | Cutting is play. After a cut the others give one shared "wow" and the most curious one comes to look (A 6). Whole again gets a cheer (C B16). Comfort fires only for chilly, soaked or after a sulk. |
| F5 | **C halves warmth on a merge** (4.3: "max(parents)/2"). That is a loss, which D8 forbids. | The merge result takes the **larger** parent's warmth (A, B). |
| F6 | **Hearts mean two things.** C counts friendship in "1 to 5 hearts" (4.2) and its "Hold me" wish uses a heart (7.7). A and C use a ♥ emote. The Hoard's Heart, with a ♥ glyph and a "Hearts" filter chip, protects a copy from merging (`panel.ts:216, 374`). | No ♥ glyph in squishmoji. Affection is B's **snug** (two blobs leaning together, coral), and best pals are snug plus a sparkle. Friendship levels are the words **Met / Pals / Best pals** (A). The "Hold me" wish shows the squeeze or stretch glyph (B). |
| F7 | **Hops too small to read** in B and C: 3.6 cm and 3.5 cm, which is 2.8% to 4.4% of a body's width. | A whole squishy's normal hop is **0.06 to 0.08 m** (vy 1.1 to 1.26 m/s) and the big hop is 0.12 m (firm silicone, pop dome). The quiet `auto` land flag (PHYS map 231) routes the landing through the attention budget and never through `feedback.ts`. Keep at most 3.5 cm for scoot steps, pieces, and putty and mochi (memory). Climbing (A) waits for a PHYS gate, like B's PH12. |
| F8 | **Every family moves the same way** in C (an inchworm scoot, 3.4). | Use A's 12 gaits (2.1) on top of C's primitives. A gait is data: squash depth, hop scale, step rate, and glide or hop. |
| F9 | **One mover on low** (C 6.3) breaks pair play. | Allow at least **2 movers on low**, 3 on med, 4 on high (B's awake units). A joint behaviour (teeter, pass, nuzzle, follow) reserves its tokens together or does not start. C's measured "hush" (10.2) stays as the safety net. |
| F10 | **Nobody guarantees the first minute** in the spec. | Add check **FN-01**: in a fresh profile, once the player has let go for 6 s, Dollop does a visible thing use (notice, then hop, then boop) within 10 s. It shows its first labelled bubble within 30 s of the start. The newcomer greets within 5 s of coming out. Run it scripted through the dev hook. |
| F11 | **Sinkers fully under water in Fizzwell Tub** (C 1.6: the surface is 0.9 m over the whole area). A small sinker (R 0.4, top at 0.8 m) sits completely under, eyes too. A parent may read that as drowning. | In every pool and bath, a resting sinker keeps its **eyes above the surface**: depth at most 0.5 m where sinkers can sit, deeper only where floaters drift. Or B's **water hop** takes it back up within 30 s. DT-01 checks the depth against the largest sinker's eye height. |
| F12 | **Things repeat across C's places**, and the finales repeat too. | Every place gets **one signature verb** found nowhere else (list in 6.2) and a **place spectacle at its finale** (A 7.3). No mechanism is the headline thing in more than 3 places. |
| F13 | **"When set there" rides** (C: Glide Ramp, Soap Slide, Marble Ramp, Stone Slide, rides on the swings) leave the squishy with no say in it. | The squishy shows a **ride wish** (a star in a thought bubble) beside the ride (B 1.0). Granting it is the purpose, and the slide gets a cheer from the others. |
| F14 | **Chores in C's quests** (six main quests at x5 of one deed, a bonus at x8). | A main quest repeats one deed **at most 3 times**, a bonus at most 5. Prefer **distinct** ("three different squishies...", as B c6 and C's own `distinct`) over plain counts, because distinct teaches "in their own way". |
| F15 | **Quest capsules move the pace.** C has 11 (about 2.8 min a capsule for the fastest style in week 1). A has 3. | **No capsule from quests.** Use B's gift picks, at most **5 for life** across all chapters (Commons and Uncommons only, each "loves the next place"). Other finales give a keepsake and the place spectacle. The pace then holds by construction (B 7.12). |
| F16 | **Bubbles cut from photos** (C 5.2). | Bubbles appear in photos by default, with a "Bubbles in photo" switch (A, B). The best-friends photo is the shareable moment. |
| F17 | **C has no species voice identity** (5.3). | A's species motif (3 syllables, 2 intervals, the same for every copy), B's pair duet, and C's call and response and echo. |
| F18 | **Friendship pace.** C at 6 points a day and 8 for 2 hearts means most pairs cannot nuzzle by themselves on day 1. | The cute basics run from **Met**: greet, boop, and nuzzle for cuddly ones (A S02 gate). **Pals** come within the first session (B: 12 points; B estimates 8 to 12 points for 15 minutes together). **Best pals** take 2 to 3 days (A's daily cap). Friendship unlocks extras (duet, twirl, nap side by side), never the basics. |
| F19 | **C's discovery bits 13 and 14 (trait words) have no event** (7.8). | Define them: the first trait word comes after its signature touch twice, the second after 3 visits. Otherwise drop them. Keep 10 to 12 facts per species, every one with a named event and a hint. |
| F20 | **Wishes that expire or nag.** C's wishes fade at session end. A's Daily Wishes are replaced each day. A's and C's touch wishes fire after 3 minutes without a touch. | B's rule: a wish **rests** in the Journal ("No hurry") until granted. Drop the "Today:" Daily Wishes list. A wish may follow time without touch, but an unanswered wish never causes sadness (F3). |
| F21 | **Too many icons to learn** (A: 41). | At most **24 squishmoji**. Wish glyphs reuse them inside a thought bubble, and the place wish is C's postcard with the place's sky colour. |
| F22 | **Small bubbles** (C: 30 CSS px with a 20 px icon on a phone). | At least **36 px on a phone** with a 22 px icon, 4 primitives or fewer. Squishmoji use the stroke and rounded ends of the UI.md icon family (`UI.md` 33). |
| F23 | **Copy that confuses.** B n1 "Say hello" is a squeeze. C Fizzwell 5 "Splash together" is `Social{GREET} x3`. | Every title says what you do: "A gentle squeeze"; "Bath-time hellos". Add check **DT-09**: a title's verb matches its rule's event (a table reviewed by hand). |
| F24 | **No cross-place threads in A and B**, and only one in C. | Keep C's Friends Everywhere. Add 3 travel threads, for example "Take Dollop's best friend to Dollop's favourite place", "A nap in three places", "One squishy in water, snow and sun". Each uses existing events. |
| F25 | **C's magnet works for one family only** (2.4: 11 "looks puzzled"). | The magnet also pulls a **steel marble** (an M13 ball flag), so every player can play with it. Bead squeezes roll to it too. Crumbit is the Common bead squeeze. |
| F26 | **A menu trip at 0:25** (B 7.10, the Restock). | Use A's rule: the first capsule's squishy stays out. The Restock gift is offered after the Home finale, not before the first greet. |
| F27 | **Name clashes if the set is mixed.** A's "Fizzwash Cove" with C's "Fizzwell Tub"; B's "Hushpeak" with the species Hushpuff. | Pick one name per prefix across places and species. Run the name gate on the final set (DT-02). |
| F28 | **"Comes tomorrow"** (C 8.2) is honest but reads like a lock. | The card says "A new postcard comes each day you play". No countdown, and a stamp shortfall is shown as stamps ("Needs 12 stamps"). |

---

## 4. Contradictions the synthesizer must decide

| Topic | A | B | C | Recommendation |
|---|---|---|---|---|
| How many places | Home + 3 | Home + 3 | Home + 9 | **C's 9** (1b). Fill each with A's level of detail. |
| First new place (S1) | the Cove | the Cove | the cabin | **The cabin** (C 11.2: no water or slopes needed). It is also the most social place: song by the fire, nap piles, marshmallow toasting. Condition: S1's "own way" must show in **bodies**, not only looks (A's gaits plus C's warm poses). S2 starts with water. |
| Hop height | 8 cm normal, 12 big, 18 climb | at most 3.6 cm | at most 3.5 cm | **6 to 8 cm normal, 12 cm big**, with an `auto` quiet land (F7). No climbing in S1 and S2. |
| Who climbs | some families climb | none: rides on request | none: "when set there" | **Rides on request** (B's star wish) now. A's family climb gate later, behind a PHYS check. |
| Heart icon | ♥ for "I love this" | none (snug) | ♥, and hearts for friendship | **No ♥**; snug; levels in words (F6). |
| Quest rewards | 3 capsules once | 4 gift picks for life | 11 capsules for life | **Gift picks, at most 5 for life**; zero capsules (F15). |
| What opens places | 5 pages of the current chapter | the finale, or 7 / 6 quests | stamps, and from the 3rd place on at most 1 a day | **Stamps** (C's thresholds retuned so one place opens every 1 or 2 sessions), plus **at most one new postcard a day from the 4th place on** (F28). The finale is never needed to open a place. |
| Movement duty | lively (awake 4 / 5 / 7) | awake wholes 2 / 3 / 4 | 60% still; movers 1 / 2 / 4 | **Movers 2 / 3 / 4**, joint behaviours reserve tokens (F9), and C's run-time hush stays. |
| Thinking rate | 10 Hz | 2 Hz | 10 Hz | **10 Hz** (staggered). A notice must start within 0.15 s. |
| Friendship pace | Pals 40 (at least a day), Best 120 (at least 3 days) | Pals 12, Close 40, 20 a day | 6 a day, levels 3 / 8 / 16 / 30 / 50 | **Pals within the first session, Best pals in 2 to 3 days**, and the basics from Met (F18). |
| Sulk trigger | partner put away | ball taken, a toss | unnoticed wish, friend gone | **Scene events between squishies only** (F3). |
| Warmth on merge | max | max | max / 2 | **max** (F5). |
| Wish lifetime | never expires, plus Daily Wishes | rests in the Journal | fades at session end | **Rests in the Journal** (B). |
| Facts per species | 6 | 12 | 16 | **12**: B's list with C's cold, ice and wind "ways", because there are more places. Every fact has an event and a hint (F19). |
| Voice identity | species motif | species print | by behaviour only | **Species motif** (A), plus the pair duet (B) and the echo (C). |
| Bubbles on a phone | 3 at once, 1.5 starts a second | 3, 1.5 | 2 + 1 wish, 0.8 | **2 + 1 wish, 0.8 a second** on a phone (calm for a child); A or B on desktop; C's touch duck everywhere. |
| Bubbles in photos | yes, switch | yes, switch | no | **Yes, with a switch** (F16). |
| Number of icons | 41 | 24 | 24 | **24** (F21). |
| Journal tab names | Pages / Squishies / Friends / Keepsakes | Story / ... | Quests / ... | **Stamps / Squishies / Friends / Keepsakes**: matches the stamp idea and avoids "Quests", a hard word for a seven-year-old. |
| Settings for place sounds | own slider | own slider | follows Music | **Its own slider** (A, B). A child's parent will want surf quieter than music, or the other way round. |

---

## 5. Which proposal is the base for each area

| Area | Base | Take in from the others |
|---|---|---|
| **Places and things** | **C** (1.0-1.11: 9 places, 14 mechanisms, zones, cost of a tenth place) | A's per-thing specificity and things worth keeping (Kettle, Tick Clock, Shake Pine, Warm Stone, Puff Cushion, Bob Ring, Book Steps later); one signature verb per place (6.2); F11 to F13, F25 |
| **Life and social play** | **A** (3, 4: traits, gentle needs, B01-B14, P01-P02, S01-S11, gaits, the first minute) | C's sleep discipline and mover tokens (with F9), follow the leader, push the swing, duet, echo talk; B's mirror dance and shy arrival; F3, F7, F8, F18 |
| **Emotes and voices** | **A** (5.1-5.2: motif, first-three labels, tap to learn, harmony on the sounding field) | B's snug with no ♥ (F6); C's group bubble with count dots, the echo, the phone caps; F21, F22 |
| **Pieces and the attention budget** | **C** (5.4, 6: exact caps, touch duck, group merge, pieces quests per chapter, party stays on a cut) | A's duckling flock and "one squishy in pieces at a time"; B's pieces count toward size and its unit budget; desktop caps from A or B |
| **The Journal and rewards** | **B** (7: gift picks, dark-pattern audit, wishes lead to discoveries, rest-in-Journal, backfill, Commons-only probe) | C's chapter per place, Friends Everywhere, stamps and postcards, append-only quest ids; A's finale spectacles and first-wish-first-trip; F1, F2, F14, F15, F19, F20, F24 |
| **The screens** | **B** (8: concrete phone layout, the gift card, the Places button hidden until needed, "3 of yours love it", moments queue) | **C's postcard Travel grid** (the only one sized for 10 places, 8.2) in place of B's 4-card sheet; A's wish card, Wishes now list and bubble words; F16, F22, F23 |
| **Architecture and build order** | **C** (9, 10.4, 11: node first, the cabin first, S2 water opens 3 places, S3 fields) | A's S0 "Life at Home" (B's S1a) as the first milestone, with FN-01 (F10) as its exit check; B's backfill |

---

## 6. What the synthesizer must add to reach the full set (1b)

### 6.1 A and B
Both stop at Home + 3. The synthesizer takes **C's six extra places** (Puddlebrook, Fizzwell, Cogwhistle, Lanternroof, Echo Hollow, Cloudloft). It
fills each to A's standard: 5 or 6 things, a family-by-thing row for each thing (not only C's channel cells), 8 to 10 quests in the B and C
grammar, a favourites table (every place at least 4 fans and at least 1 Common), budgets per place chunk, and one finale spectacle. A's and B's
Journals need the **Friends Everywhere** chapter plus the travel threads of F24. They also need stamp thresholds that spread 9 places over weeks.
There are only 14 Commons for 9 places, so most places get just one Common fan. C's favourites table (2.6) is the right start, and no main quest
may depend on owning that one Common (F2).

### 6.2 One signature verb and one finale spectacle per place (so the world is not one place reskinned)

| Place | Signature verb (nowhere else) | Finale spectacle |
|---|---|---|
| Home | things arrive one by one; the keepsake shelf rings | the first wish comes true as you travel |
| Hearthlog Cabin | marshmallows toast and turn round (A M4); the kettle sings and they answer (A M13) | the fire swells and everyone sings with the music (A T*) |
| Ripple Shore | soak a foam in the pool, then squeeze it to squirt a friend (A S09) | the sky warms to sunset and they nuzzle in a row (A C*) |
| Frostbell Ridge | glide on the ice pond; a bump on the pine drops a snow cap on a friend (A M1, M10) | the snow slows and stars come out over a snuggle (A F*) |
| Puddlebrook Garden | puddle jumps; the drip leaf showers whoever is under it | the rain stops and the leaves drip one by one in key |
| Fizzwell Tub | floaters bob and sinkers sit, side by side; ride the boat on the tap swirl | bubbles rise in a slow column around the party |
| Cogwhistle Bench | wind the cog and ride it round; the magnet rolls the steel marble | the cog, the spring plate and the bell play one tune together (C's machine) |
| Lanternroof | gaze at the moon; the breeze turns the vane they sit on | the lanterns glow one by one in time with their song |
| Echo Hollow | call into the cave and answer the echo (C 1.9) | the crystals glow a scale as they sing |
| Cloudloft | marshmallows float in the updraft; bounce pad to pad | the sun rises and a soft bow of light arcs over the parade |

All the spectacles are looks and sound only, with no flash, inside the existing flash gate. Calm gives a slow fade.

---

## 7. Fun checks the synthesizer should add to the acceptance list (ids for the verifier)

- **FN-01** First minute (F10). Scripted in node through the dev hook, then once in the browser.
- **FN-02** "Own way" by the fire: a screenshot by the Hearthlog hearth with 4 families (jelly, marshmallow, mochi, slime) shows 4 visibly
  different body shapes or looks. The verifier judges it by eye and must name the differences.
- **FN-03** Every place has its signature verb in data. Its producing event fires in a 5-minute scripted visit.
- **FN-04** No main quest needs more than 3 of one deed; every main quest can be done with Commons at low caps (B QU01 and C QU-03 merged).
- **FN-05** Copy gate: no "sad", "lonely", "misses you", "hurt", "come back" or "hurry" in player text. A sulk's trigger table contains no player action.
- **FN-06** In a 10-minute default visit on med with 4 wholes, each squishy shows at least 2 social moments and 2 thing uses, and the phone bubble
  cap is never exceeded (C LF-09, with the movement floor of F9).
- **FN-07** A sinker in every pool keeps its eye line above the surface at rest (F11).

---

## 8. What I did not check

I did not run the name or language gate on any name. I did not hear any voice or ambience (nobody has, AUDIO map). I measured no hop, prop, water
or sleep cost. Whether a 6 to 8 cm hop with an `auto` land passes the fold gate on all 12 families is a PHYS question that F7 depends on. I did
not check the economy sims: the pace claims in F15 rest on B 7.12 and C 7.11 as written. I did not check whether 9 places' stamp thresholds land at
"one place every 1 or 2 sessions"; the synthesizer must re-derive them from the chapter sizes. I did not open the render, audio or shell code
beyond the lines cited above. I did not check the 390 x 844 layouts beyond reading the proposals' pixel numbers.
