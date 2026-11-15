# JUDGE: coherence and safety (PLAYGROUND proposals A, B, C)

Judge of the design panel, 2026-11-15. Lens: **coherence and safety**, as product owner and reviewer. I checked originality, the product rules,
the tested economy, accessibility, consistency with DESIGN, FUN, CUT, LOCK, UI and TRADE, the eyes-only faces, plain wording, and room for the
queued work. Paths are relative to G = `games/wobblehoard`. "A 337" means PROPOSAL_A.md line 337.

**Read in full:** STATUS, briefs/COMMON, briefs/SESSION3, design/DIRECTION (with 1b), PROPOSAL_A (1132 lines), PROPOSAL_B (1167), PROPOSAL_C (1285).
**Read in part, to check claims:** `_spec/REFERENCES.md`, `FUN.md`, `CUT.md`, `LOCK.md`, `UI.md` (all in full); `DESIGN.md` 5.0-5.13, 6.6-6.7, 7.1, 8, 9;
`TRADE.md` (emotes, social surfaces); `COLLECTION.md` C-5, C-6, section 4; maps PHYS 95-215, SHELL 15-30 and 130-145, RENDER (blush, additive
sprites, flash). Code: `src/collection/store.ts` 50, 96, 225-265; `src/collection/ghost.ts` 100-197; `src/collection/constants.ts` 24-41;
`src/core/genome.ts` 122-144; `src/input/keyboard.ts` 60-125; `vite.config.ts` 24; `_harness/probe_catalog.ts` 76-297; `JUDGE_FUN.md`.
**Ran (light, scratch only):** (1) the real name and language gate, copied byte for byte from `probe_catalog.ts` 76-297, over every new place,
thing, keepsake, emote, trait and setting name of all three proposals, with the NAME rules and with the PROSE rules; (2) the same PROSE gate over
the player text in A 410-750, B 330-775, C 470-815; (3) a list of the Common species by family from `src/data/catalog.ts`. No tsc (I wrote no
code), no probe, no browser, no build. Section 9 lists what I did not check.

---

## 1. Scores (coherence and safety, 0 to 10)

| Proposal | Score | One line |
|---|---|---|
| **B** (purpose first) | **7.5** | The safest on the product rules: a dark-pattern audit, no capsules, gift picks whose pace proof holds by construction, no heart glyph, hops under the `land` threshold, no detail swap, physics round 3 first. Its holes are concrete: props 0.08 m thick, a Cove a keyboard player cannot finish, a finale that needs a file download. Pre-1b: 3 places. |
| **C** (systems first) | **7.0** | The only one that meets 1b and the most coherent with the engine (R1-R10, a 14-mechanism library with checked ranges, a size budget that includes the UI overhaul, a measured awake budget). It is also the weakest on the product rules: a guilt sulk, hearts as friendship units, 11 capsules with wrong arithmetic, a gift bit an older build erases, and the lock missing from the touch gate. |
| **A** (toy first) | **6.5** | A careful economy proof and save design, the lock in the touch gate, a total sound-off table. But it has a sulk caused by the player, a wish that re-glances every 12 s, the ♥ glyph, climb hops of 0.18-0.23 m, a camera that follows the wandering party, and a size cap it cannot meet. Pre-1b: 3 places, 6 mechanism kinds. |

### 1.1 B: 7.5
**For.**
- Purpose with no economy risk. The Journal pays no SP and no capsules. It gives 4 chosen gifts for life, Common or Uncommon, from fixed lists (B 7.12, 663-684). The pace proof holds by construction, not by simulation.
- It reuses origin `'restock'`. A new origin code would make older builds drop the row: `sanitizeRow` refuses an unknown index, `store.ts` 96.
- It has the only dark-pattern audit (B 7.13) and the only guilt-copy rule (UI05). "Huff is never about the player's absence" (B 257-258). Needs reset each time a squishy comes out, so being away never matters (B 3.2).
- Autonomous hops are capped at vy 0.85 m/s, about 3.6 cm (B 264). That keeps every landing under the 0.9 m/s `land` threshold (PHYS map 107), so autonomy reaches no sound or haptic by construction.
- No run-time detail swap (B 12.2). No ♥ glyph, with a written reason (B 12.1, DESIGN 5.6 line 356).
- Every place gets a brightness cap (mean linear luminance at most 0.35) and token-only colours in OKLCH (B 1).
- Room for queued work: SHELL-4 and physics round 3 are step 0 (B 1133), and the UI overhaul goes first (B 1152).
- Its own stricter name screen led to renames, and its setting label "Voices" passes the real gate. A's and C's label does not (section 4, M6).
- It says plainly that the Journal is practice-only on this device and holds aggregates only (B 459).

**Against.**
- **Props too thin.** "Every prop is at least 0.08 m thick" (B 930). The boards are 0.08 m (B 62, 79, 95, 109, 111), the chime post has r 0.05 (B 80) and the lamp post r 0.06 (B 97). Pieces are detail 2, with a mean edge of 0.14 m (PHYS map 81-82), so they can slip through.
- **Keyboard players are blocked in the Cove.** The Tide Puddle rims are 0.8 m tall (B 76), so c2, c3, c4 and c6 all need a toss or a carry. The finale opens at 6 of 8. Space presses the screen centre (`keyboard.ts` 74-83), and the keyboard has no stretch, toss or carry. So "every quest has a keyboard path" (B 771) is false for this chapter.
- **The chapter 1 finale needs a saved file.** n10 counts `game.notePhoto()` on the Snap **save** (B 478, 504). A sandboxed portal iframe can block downloads.
- Huff after "a toss it did not like" (B 251) and comfort after a cut (B 249). Both frame the player's play as hurtful.
- The wish dot re-opens for 4 s every 45 s (B 362). That is a recurring nag, and Calm says "no pulses at all" (DESIGN 6.6).
- The camera follows the party centroid (B 957), so autonomy moves the camera.
- The attention budget sits in `src/shell` (B 392), outside the pure, node-tested lane.
- A first load of at most 1280 KB with +110 KB (B 1032) ignores the UI overhaul's about 90 KB (UI.md 2.7). Its 80 KB per place times 9 places breaks D9 (section 4, M14).
- Copy: n1 is called "Say hello" but asks for a squeeze, while n5 is the greet.

### 1.2 C: 7.0
**For.**
- It covers 1b: 9 places beyond Home (C 1.2-1.10). It has 14 mechanisms and 8 zone kinds, with parameter ranges checked by DT-01 (C 1.0), and it prices a tenth place: about 1.5 KB of data and at most 45 KB of render, with no new physics, LIFE or quest code (C 1.11).
- Its rules R1-R10 (C 0) match the PHYS map facts: flat ground, props at least 0.16 m, ball r at least 0.20, one free prop, no climbing, no autonomous haptics or camera, data in the first load and code lazy, a measured awake budget, node first.
- Its size budget is the only one that reserves the UI overhaul (C 10.3: 1139 + 90 + 60 = 1290 KB), and the only one that holds for 9 places (1290 + 120 + 9 x 45 = 1815 KB, under its 1850 KB total).
- Quest ids are append-only (C 7.4). A place that has not shipped yet is skipped by the unlock rule (C 7.6). `JOURNAL_MIGRATIONS` exists from day one (C 9.10).
- The quest fairness rules are right (C 7.3): no tap quests; a family only if it has at least 2 Commons (I checked this against the catalog); nothing above Uncommon; everything reachable at low caps.
- The player comes first: while a finger is down, other bubbles stop and voices duck 6 dB (C 5.4). Slow bumps between two untouched bodies are silent. The echo is built without a DelayNode, which keeps renders reproducible (C 5.3).
- The party stays when you cut (C 6.3). A DETAIL3_ONLY list guards detail-2 wholes. It writes "shy is gaze only" against the RENDER map's blush idea (C 12; REFERENCES 3).

**Against.**
- **Guilt cues.** It sulks when "its wish showed 3 min unnoticed, or its best friend just left" (C 398). A "Hold me" wish fires after "no touch for 3 min" (C 697). The mood is named "lonely" (C 380), and the emote is "raincloud: a bit grumpy".
- **Hearts as units.** Friendship counts in hearts, 1 to 5 (C 460, 8.3). It has the "Hold me" heart, "Twin Hearts" and the "Big Heart Quilt" (C 713-714). The Hoard's protection mark is called Heart, with a ♥ glyph and a Hearts filter (DESIGN 5.6).
- **11 capsules for life, and the arithmetic is wrong.** "Week 1 at most 6 quest capsules: +14% over 42" (C 747) counts all 7 days as active. A regular player is active on 70% of days (DESIGN 5.12), which gives about 29 play capsules in week 1. So 6 more is +20%: about 2.9 min a capsule for the regular median and about 2.7 for the fastest paying style. Both are under the 3.0 band. Nothing in the grant enforces "at most 1 a day after day 1".
- **A gift bit that older builds erase.** `questGifts` is a new field in the hoard save (C 1070). `sanitizeHoard` and `serializeHoard` keep only known fields (`store.ts` 225-265). Any older build erases the bit on its next save, for example the CDN build 2683d349 that is deployed now. The new build then grants the finale capsule **again** (C 1071).
- The touch gate is `fingers > 0 || grabbed || carried` (C 422), with no lock (LOCK.md 3 adds `metrics.locked`). LIFE could hop a body whose lobes are locked.
- **It contradicts itself.** "Autonomy never moves the camera" (C 27, 545, 1270) against "a slow party-centroid follow" (C 1017). Hearthlog opens at "8 stamps of Home's 8 main" (C 679), but Home 8 is a visit to Hearthlog. Home 2 is a stretch (C 615), so a keyboard-only player can never open the second place.
- Fizzwell Tub has water 0.9 m deep over the whole play area (C 166). Six families sit fully under it, eyes too.
- Colours outside the tokens: "warm brown", "white surf", "grey", "copper", "brass" (C 103, 118, 150, 163, 177).
- The ceremony dim lerps the sky 30% in 0.4 s (C 1008). That is a whole-screen luminance step on each side of a burst.
- A calendar gate ("Comes tomorrow", C 688, 771). Bubbles are hidden in photos (C 509). Bubbles are 30 px with no 44 px hit area (C 506).
- Warmth is halved on a merge (C 468). One salt, 0x6c1fe0a7, is used for two purposes (C 360, 928). "Squishy chatter" fails the gate (C 802).

### 1.3 A: 6.5
**For.**
- The economy proof is the cleanest on autonomy (A 7.9). LIFE has no finger, grab or lock intent at the type level. Every `auto` or `prop` event is dropped before `collection.feed`. EC-01 is a no-input party run that must give 0 SP, 0 task progress and 0 capsules. LI-10 is a grep check.
- Three gift capsules once ever, at most 1 a UTC day. If the queue is full, they wait (A 696-699). The arithmetic is right: 3 capsules / 6.0 is about 0.5 active day.
- Touch sets HELD in the same step and the drivers ease out over 0.12 s. Locks count as touch (A 3.5).
- Voices never join ROOM_KINDS, use priority -1 and their own rng, stay silent during ceremonies and peak at -18 dBFS (A 5.2).
- A total voice-to-emote table makes sound-off work (UI-03).
- Words appear under the first three bubbles, and a tap on a bubble shows its meaning (A 5.1).
- Wish hit areas are 44 x 44, projected every 250 ms and kept clear of the capsule (A 721).
- A "Wishes now" list with buttons lets a keyboard player grant every wish (A 738).
- Saves (A 9.7): a newer version is read-only; an unreadable save is parked; two tabs merge by union or max.
- Looks never change stiffness. No text promises a pop dome pop (A 2.1). No place is bright white (A 1). No animal sounds (A 9.6).

**Against.**
- B08 sulks when "its partner was put away" (A 337). That is the player's act. A wish re-glances every 12 s with no end (A 336, 623).
- A ♥ emote (A 420).
- "Daily Wishes" use a "Today:" list that changes every day (A 637). That is a soft daily checklist.
- Hops reach 0.08, 0.12 and 0.18 m times the hop scale (A 166, 357): firm silicone climbs to 0.23 m and lands at about 2.1 m/s. That leans on the `auto` flag and on fold gates nobody has run.
- The camera eases after the party's box (A 919). It stops only in Calm.
- A first load of 1280 KB with +100 KB (A 984) leaves no room for the UI overhaul. Its 1600 KB total breaks with 9 places (section 4, M14).
- PHYS step 2a starts E9 and E7 at once (A 1105), with no sequencing after the checkpoint-47 re-verification and physics round 3. Those edit the same table pass.
- The tracker pill is 36 px tall with no stated 44 px hit area (A 717).
- The species grid is 3 x 110 px and the shelf 4 x 80 px. Neither fits the 288 px content width at 320 CSS px.
- "Felt Nook". "Squishy chatter" fails the gate (A 746).
- Two similar words for two things: "best friend" for the authored species pair and "Best pals" for the earned level.

---

## 2. The best ideas the final design must keep (by proposal and section)

**From A**
1. **7.9 and EC-01, LI-10.** No paying intent exists at the type level. `auto` and `prop` events are dropped before `collection.feed`. A no-input party run must give 0 SP, 0 task progress and 0 capsules.
2. **3.5.** HELD in the same step, drivers eased out over 0.12 s, locks counted. Pushback 3 ("a hard cut would pop") is right.
3. **5.2 voice rules.** Never in ROOM_KINDS; priority -1; its own rng; silent during ceremonies; at most -18 dBFS so a player effect stands 8 dB or more above it. The species motif (every Dollop has the same three-note call). **UI-03**, the total voice-to-emote table for sound off.
4. **5.1.** Words under the first three bubbles, a **Words under bubbles** setting, and tap-a-bubble-for-meaning. The **wish hit area is 44 x 44**, projected and slid clear of the capsule (8, A 721).
5. **6.** Only one squishy in pieces at a time. A flock has 1 bubble and 1 group voice.
6. **8.** A **"Wishes now"** list with action buttons, so every wish can be granted by keyboard.
7. **9.7.** Newer versions read-only; unreadable saves parked; the two-tab union or max; warmth pruned to the shelf on load.
8. **10.3 DA-02 and DA-04.** Collider at least 0.16 m; prop clearances; readability metrics (sentences of at most 12 words, mean word length at most 4.8).
9. **Pushbacks 2 and 4.** Zero autonomous haptics. No run-time detail swap.
10. **2.1.** Looks never change stiffness or damping, and no text promises a pop dome pop. **1:** no bright white place.

**From B**
1. **7.13**, the dark-pattern audit, kept in the spec as a checked table.
2. **7.12.** Gift picks from fixed, shown lists, Common or Uncommon, origin `'restock'` (no new origin code). The gift waits at GHOST_CAP. The pace proof holds by construction.
3. **3.2 and 3.3 #17 and #18.** Needs rise only while a squishy is out, and reset each time it comes out. No neglect state. Huff is never about the player. The shy arrival.
4. **3.4.** Autonomous hops under the 0.9 m/s `land` threshold by construction. Putty may squash at most once every 2 s.
5. **1, shared rules.** Brightness cap of mean linear luminance at most 0.35; token-only OKLCH palettes; the flash gate re-run per place.
6. **5.4.** A body untouched for 1.0 s sends its `land` and `bump` events to the budget, never to `feedback.ts`.
7. **7.1, 7.14.** Practice-only, aggregates only. Journal progress is never traded or shown. Hints that name a species give trade a reason.
8. **9.8.** The `bf` backfill, so returning players skip onboarding. New settings migrate by absence.
9. **QU01, QU02, QU06, UI05.** Commons only (static walk). Every event kind has a named producer. No count over 10. Byte-identical gate extraction. No guilt words.
10. **11.2 step 0 and "Never cut".** SHELL-4 and physics round 3 come first. The attention budget, the zero-SP probe, the touch override, sleep, the Calm caps and the text gate are never cut.
11. **12.1.** No ♥ glyph, and **7.6:** a wish rests in the Journal ("No hurry").
12. **6.** Kind refusal copy: "It's busy here. Put one squishy back on the shelf to cut."

**From C**
1. **0, R1-R10**, as the spine of the build spec. Especially R2 (at least 0.16 m, ball r at least 0.20, one free prop), R3, R6, R8 and R9 (the measured `hush`).
2. **1.0.** The 14 mechanisms and 8 zone kinds, with MECH_RANGES checked by DT-01. **1.11:** the cost of a tenth place.
3. **2.5 plus DT-06.** Channel coverage: every family has at least 3 reactions in every place.
4. **5.4.** The phone caps. The touch duck. Silent slow bumps between untouched bodies. No bubbles off screen. Player feedback never budgeted.
5. **6.2, 6.3.** Group bubbles with dots. Piece-to-piece bumps silent. The party stays when you cut. The piece-limit formula. DETAIL3_ONLY, with failing species counted double.
6. **7.3.** The fairness rules. **7.4:** append-only quest ids. **7.6:** a place not yet shipped is skipped by the rule.
7. **9.5.** The sleep wake list, the float-mode rule, and `auto` on every landing the player did not throw.
8. **9.10.** `JOURNAL_MIGRATIONS` from day one, newer read-only, the worst-case size check.
9. **10.3.** The size budget with the UI overhaul reserved. **11.5:** run round 3 first, and keep the non-physics lanes in parallel.
10. **12.** Shy is gaze only (no blush). D6 limited to 1-DOF joints and one free ball.

---

## 3. What the synthesizer must add to A and B to reach the full set (1b), and what C still lacks

**A and B** stop at Home plus 3 places.
- **Places.** Take C's six extra places plus the owner's three, so there are at least 8 beyond Home. Each needs a name screened by M6, ground, zones, 4 to 6 things built from the library, family reactions per thing, 8 to 10 quests, and favourites. Each place needs at least 4 fans and at least 1 Common fan: there are only 14 Commons for 9 places, and C 2.6 is a valid start.
- **The library.** A and B have 6 mechanism kinds each (A 9.1: static, roll, hinge, pendulum, spring, float; B 9.2: static, ball, hinge, pendulum, spring, floater). 1b asks for 12 to 16. Take C 1.0 with MECH_RANGES, plus the zone kinds current, magnet, echo and updraft.
- **The Journal.** A chapter per place plus C's cross-place "Friends Everywhere".
- **Facts.** B's per-place facts (F4 to F6: water, snow, fire) become channel facts (water, warm, cold, ice, wind) so they scale to 9 places.
- **Storage.** Re-derive the bounds: about 110 quests; a keepsake bit set wider than 16 bits (A) or 24 bits (B).
- **Travel.** A sheet for 10 cards (C 8.2).
- **Size.** Re-derive the budget (M14).
- **Unlocks.** An unlock curve over weeks, set by stamps only (contradiction 7).

**C** covers 1b. It still needs A's per-thing family cells for each place's signature things: C's channel tables give "looks puzzled" for 11 of 12 families at the magnet (C 2.4). It also needs a name and copy pass under M6.

---

## 4. Must-fix list (nothing got it right, or the recommended base has it wrong)

| # | Problem (evidence) | Concrete correction |
|---|---|---|
| **M1** | **Items earned with no input, and the pace.** In all three, some finales can be finished by LIFE alone once the party has arrived. A's Cove: C2-C5, C8 and C9 can all happen autonomously, and the finale then pays a capsule. C pays 11 capsules, with the week-1 arithmetic wrong (1.2). | **No capsules from the Journal.** Items are B's gift picks only: **at most 5 for life**, Common or Uncommon, from fixed shown lists, at most 1 per UTC day (enforced in the grant function), never before the Home chapter is done. Every gift-bearing finale needs **at least one player-caused clause** (a Touch, a Toss, a player Use or a Wish GRANTED). Probe **CS-01** (section 8). |
| **M2** | **Rewards are not idempotent across two keys and older builds.** C's hoard field `questGifts` is erased by any older build (`store.ts` 225-265 keeps known fields only), which leads to a second grant. A (`g.paid` in the journal plus `ghostTaskCapsules` in the hoard) and B (`gc` plus the ghost row) write two keys with no order, so a crash between the writes either duplicates or loses the gift. Both saves are throttled. | A three-step grant with no hoard schema change: (1) write the journal `gift[ch] = pending` at once, unthrottled; (2) add the gift's ghost row with a **deterministic id** derived from (deviceId, chapter) and matching ID_PATTERN; (3) write the journal `granted`. On load, if the state is `pending` and the id is present, mark it granted; if the id is absent, grant once. `hasId` already exists (`ghost.ts` 126). Ghost rows survive older builds. Probe **CS-03**. |
| **M3** | **No server rule for Journal items.** The Journal is local, and COLLECTION C-6 says "any promotion path is a forgery path". | Journal items exist on the **Practice shelf only**. On a signed-in account, a gift needs a host op (for example `wh_claim_journal_gift`) with a per-account lifetime cap and an offer-list check. Until that op exists, signed-in players get keepsakes, facts and places only. |
| **M4** | **Guilt and negative cues.** A B08 (a partner put away, A 337). B #14 (a toss, B 251) and #12 (comfort after a cut, B 249). C B12 (an unnoticed wish, a friend gone, C 398), "Hold me" after 3 minutes with no touch (C 697), and the moods lonely, sulky, restless and the raincloud "a bit grumpy" (C 380). | A huff may start **only from a squishy-to-squishy scene event** (another took its ball or its seat). It lasts at most 3 s, and any touch turns it into a giggle. No trigger may involve the player's action, absence, inattention or elapsed time. A "touch me" wish may follow time, but it carries no negative emotion and never escalates. Comfort is only for chilly, soaked or after a huff. Copy gate words: sad, lonely, grumpy, hurt, misses you, come back, hurry (B UI05 plus these). Probe **CS-04**. |
| **M5** | **Heart means two things.** A and C have ♥ emotes. C counts friendship in hearts and has "Twin Hearts" and "Big Heart Quilt" (C 460, 713-714). The Hoard's **Heart** protects copies (DESIGN 5.6, line 356: "Every document uses this name"). | No ♥ glyph in the squishmoji. Affection is B's **snug**. Friendship levels are words (contradiction 17). Rename C's keepsakes, for example "Friends Quilt" and "Pair Charm". Write the decision as a deviation from D2's example list, with this reason. |
| **M6** | **Which gate rule applies is never said** (A DA-03, B QU06, C DT-02 each say "every name passes"). I ran the real gate. The **NAME** rules reject ordinary words: Shell and hello (contain "hell"), Button, Glass, Moon, Box (~xbox), Pool (~pooh), Ripple, Echo (~techo), Lantern (~lanturn), Twin (~twix), Seat and Sea (~seel), Arch, Brass, Cone, Slope, Nights. Under the **PROSE** rules all of these pass. The only real PROSE failure is the setting label **"Squishy chatter"** (A 746, C 802): "chatter" contains a 6-letter French term. The gate does not know "Nook" (Animal Crossing's Tom Nook and Nook's Cranny; only `animalcrossing` is listed) or "Pals" (Palworld's creatures). | Write the split into the spec. **Coined single words** (Flurrytop, Hushpeak, Lanternroof, Cloudloft, Sunfizz, Fizzwash, Fizzwell, Hearthlog, Frostbell, Puddlebrook, Cogwhistle, Toastwood, Hearthpine, Sunball: all pass) go through `denyReason`, `compoundReason` and `unsafeReason`, and are marked `coined: true` in the data. **Every other name and all copy** go through `denyReasonText` and `unsafeReasonText`. Nobody loosens the gate (COMMON: never loosen a check). Rename the label to B's **"Voices"** (it passes). No "Nook" for Home: use C's "Dusk Mat" or "Home". No "Pals". Add **CS-05**: no place or thing name within edit distance 2 of a species name, or sharing its first 4 letters (Hushpeak / Hushpuff, B), and no two places share a coined prefix (Fizzwash / Fizzwell / Sunfizz). |
| **M7** | **Keyboard parity (D11).** Space presses the screen **centre** (`keyboard.ts` 74-83). In a place with a wandering party, that is any squishy or none. The keyboard has no stretch, toss or carry. C's second place needs Home's stretch quest (C 615, 679). B's Cove finale needs 6 of 8, and 4 of those need a toss or carry. | (1) Once more than one character is out, Space presses the **focused** squishy. Tab, `[` and `]` cycle focus over wholes, with the play target's focus ring. (2) Add a keyboard stretch: hold Space, then an arrow pulls the focused squishy toward that side until Space is released. Without it, no stretch quest may count toward an opening threshold. (3) Add C's "Go play with..." popover (C 8.10). For player-only things (ramps, swings, pools, tosses), it performs a **scripted carry** to the use spot. (4) Add **CS-02** (section 8). |
| **M8** | **Locks and parties.** C's touch gate omits locks (C 422). Nobody defines LOCK rule 3 or CUT rule 2 ("switching squishy releases or reconnects") when several squishies are out. | HELD = `fingers > 0 \|\| grabbed \|\| carried \|\| (metrics.locked ?? 0) > 0`. "Switching squishy" means changing the active squishy through the switcher, the Hoard or a tool. Pressing or poking another party member is not switching: the first body keeps its locks and its pieces. Travel, the Hoard, a capsule, a merge, the Cut or Snap tool, and a tab hidden over 60 s release locks and reconnect, as today. Escape order: tray, Settings, Journal, Places, Hoard, tool, plate, **then locks** (LOCK 3: Esc releases locks only when no panel is open). Probe **CS-10**. |
| **M9** | **Room for Stamp and Roll.** Only Cut pauses autonomy (A 3.3, B 3.7, C 3.7). PHYS map 7: "repeated autonomous squash/hop on putty could set a permanent dent". That would smear a Stamp print, which FUN 1 says heals slowly. | **Any non-Hand tool** (Cut, Snap, and the queued Stamp and Roll) pauses autonomous motion. Putty, mochi and bead squeeze get no LIFE squash, pose or hop while their memory has not converged. Make the E4 prop shape format accept a kinematic, player-driven shape, so the Stamp and Roll tools reuse the prop contact pass. |
| **M10** | **Autonomy moves the camera.** A 919, B 957 and C 1017 all follow the party. That is not only a C bug; JUDGE_FUN C-idea 11 also keeps the follow. Home's existing framing (`stage.ts framingFor`) frames live body positions. | **No camera motion caused by autonomy, in any mode.** The place camera frames the whole play bounds (C's camera box contains the bounds). The player orbits and zooms as today. At Home, framing uses the corral or bounds, not live LIFE positions. |
| **M11** | **Physics robustness.** B's 0.08 m props (B 930). Unproven lips: B and C rely on a scoot over a 0.12 m lip (C 1282, "unproven"). A's climb hops reach 0.23 m. Detail-2 wholes that the player can touch are ungated in the fold, press, pull and hop rows (PHYS map 138-139). A and C build them at spawn and never swap them. | Every collider at least **0.16 m**, ball r at least 0.20 (C R2). If PH-03 fails the 0.12 m lip, every autonomous use falls back to a lip of 0.06 m or a flush pad. Autonomous hops in S1 are **at most 3.5 cm** (no `land`). Higher hops (A's 8 and 12 cm) go per family, only after PH-01 passes on 12 families x 3 genomes plus 1/8 pieces, with the `auto` landing. No climbing in S1 or S2. **No detail-2 wholes in S1** (B). After that, only species that pass C's PH-13 including the press, pull and fold rows. |
| **M12** | **Water tone.** C's Fizzwell is 0.9 m deep everywhere (C 166). A resting sinker of R 0.4 is fully under, eyes too. | No play area is deep water everywhere. Where sinkers can rest, the surface stays below the eye anchor of the smallest whole (about 0.45 m). Every body leaves water by itself within 30 s (B's water hop), and the player can always lift it out. DT-01 checks depth against eye height (**CS-07**). |
| **M13** | **Palette and flash.** C uses non-token colours (C 103, 118, 150, 163, 177) and a 0.4 s sky dim around bursts (C 1008). Cloudloft and Frostbell are pale skies. | Every place colour is an OKLCH mix of the 8 `theme.ts` tokens. Apply `probe_catalog`'s pastel rule (L at least 0.80 with chroma under 0.09 is forbidden, `T.pastelL` and `T.pastelC`) and B's play-area mean linear luminance of at most 0.35 to every place (**CS-06**). If the ceremony dim stays, it eases over at least 1.0 s and is counted in RD-03 against DESIGN 6.6 (at most 2 flashes a second). Lanternroof gets a visible parapet on its open sides, so a toss never looks like a fall off a roof. |
| **M14** | **Size.** A's and B's 1280 KB cap cannot hold: 1139 + 90 (UI overhaul, UI.md 2.7) + 100 or 110 = 1329 or 1339 KB. With 9 places, A's total is 1280 + 9 x 55 + 30 = 1805 KB, over its own 1600. B's is 1280 + 9 x 80 + 52 = 2052 KB, over D9's 2000. | First load **at most 1300 KB** (D9, not tightened), with the UI overhaul reserved. PLAYGROUND's first-load additions at most **70 KB**, measured at S0. Journal and Travel UI lazy. **At most 45 KB per place** (render plus audio). Shared away chunk at most 120 KB. Total at most 1850 KB (C). If S0 measures over 70 KB, move non-Home code into the away chunk before adding places. |
| **M15** | **Build order against the queue.** A starts PHYS at once (A 1105). The G0 split edits `_harness/browser_shell.mjs`, which SHELL-4 owns now (`vite.config.ts` 24 says it holds the same constant). C puts it at step 0 (C 1242). | PHYS order: the checkpoint-47 re-verification, then physics round 3 (ground floor, LOCK, multi-pull, neck swell), then PLAYGROUND E9, E7, E8, E10, E3 and E2, then E4 and E5, then E6, all in one physics owner's hands. Make the G0 split **after SHELL-4 closes** and before any place chunk lands. PLAYGROUND screens come after the UI overhaul's components. Every new HUD element joins `_harness/uikit/` in every state (UI.md 5). DATA, LIFE (pure), CORE quests, COLLECTION journal and AUDIO creature can start now: no other engineer is in those files. |
| **M16** | **Bubbles as tap targets.** C's bubbles are 30 px (C 506). B's are 40 x 36 with no hit area stated. Nobody says what happens when a bubble's hit area overlaps the body. | Every tappable bubble (wishes) gets a hit area of at least **44 x 44 CSS px** (A's projected DOM area). It never overlaps the body's screen silhouette: a press that starts on the body is always a poke. Drawn bubbles are at least 36 px on a phone (JUDGE_FUN F22). Probe **CS-09**. |
| **M17** | **Colour-only meaning.** The friend wish is "a gem in the friend species' body colour" (A 446) or "the friend's body colour" (C 696). The place wish is "postcard + the place's sky colour" (C 694). DESIGN 6.6: never colour-only. | The tap card and the live region always **name** the friend or the place ("Crimpo wants to see Dollop", B 7.6). The friend glyph also shows the tier gem shape. Probe **CS-11**. |
| **M18** | **Wishes that nag.** A re-glances every 12 s (A 336). B re-opens every 45 s (B 362). C bobs at 0.5 Hz without end (C 508; off only in Calm). A's "Today:" Daily Wishes (A 637). | At most 2 re-glances, then a still dot. No periodic re-show. No bob in Calm or reduced motion. A wish rests in the Journal (B), at most 3 kept, never expiring. Drop the Daily Wishes list. |
| **M19** | **Required file downloads.** The photo finale counts the Snap file save (B 478, 504; C Friends Everywhere 8). | Count a photo when the shot is taken (the preview shows). A file save is never required. |
| **M20** | **Small losses.** C halves warmth on a merge (C 468). C's within-visit clauses reset progress (C 604, `within: 'visit'`), so a counter goes down. | A merge keeps the **larger** warmth. A progress number never goes down on screen: a within-visit clause shows "this visit" without a persistent counter, or main quests have no within-visit clauses. No Journal number is ever spent or exchanged (stamps, warmth, friendship), so none becomes a currency (**CS-13**). |
| **M21** | **A calendar gate.** C: "at most one new place opens per UTC day", "Comes tomorrow" (C 688, 771). That is an appointment mechanic (DESIGN 8.4: no nudges). | Places open by **stamps only**. The once-a-day limit applies to the gift grant (M1), not to content. |
| **M22** | **Determinism and salts.** C's `hush` reads `performance.now` (C 10.2). C reuses 0x6c1fe0a7 (C 360, 928). The CORE map lists three salts but misses merge's 0x6c696e65 (`merge.ts` 391). | `hush` is a snapshot input that the dev hook and node probes can pin (**CS-14**). Keep one salt registry beside `src/core/rng.ts`, with distinct salts per purpose: never 0x9e3779b9, 0x51ed270b, 0x5bd1e995 or 0x6c696e65. |
| **M23** | **Reflow at 320 px.** A's species grid (3 x 110), A's and B's shelves (4 x 80), B's 5 x 64 grid, B's gift card (3 x 104) and C's Travel cards (2 x 167) all exceed the 288 px content width at 320 CSS px. | Every grid takes its column count from the width. Every layout lists its 320 x 568 version, checked by SH-10 / UI01 (**CS-08**). |
| **M24** | **Reduced motion and LIFE.** Only C dampens autonomy there (C 8.10: hops x0.6, no wiggle). | With reduced motion or Calm: C's mover caps, no hop chains over 3, wiggle at most 2 Hz or off, no bobbing bubbles. Calm also lowers the attention caps, as all three already do. |
| **M25** | **Account switch.** Warmth and `party` are keyed by item ids. COLLECTION 4 wipes the mirror on an account switch ("kids share tablets"). | Tag journal entries for real items with `acctTag`, and drop them on sign-out or an account switch. Practice ghost ids stay. |

---

## 5. Contradictions the synthesizer must decide (with my recommendation)

| # | Topic | A | B | C | Recommendation |
|---|---|---|---|---|---|
| 1 | Places | Home + 3 | Home + 3 | Home + 9 | **C's 9** (1b) |
| 2 | First new place (S1) | Cove | Cove | Cabin | **Cabin** (C 11.2). It needs no water, slopes or wind, so it is the lowest physics risk. "Own way" there must show in bodies (C's warm poses plus A's gaits). Water starts S2. |
| 3 | Item rewards | 3 capsules | 4 gift picks | 11 capsules | **Gift picks, at most 5 for life, no capsules** (M1) |
| 4 | ♥ glyph | yes | no | yes, and hearts as units | **No ♥** (M5) |
| 5 | Autonomous hop height | 8 / 12 / 18 cm x scale | at most 3.6 cm | at most 3.5 cm | **At most 3.5 cm in S1.** Up to 8 to 12 cm per family after PH-01. No climbing in S1 or S2 (M11). This is compatible with JUDGE_FUN F7 once PH-01 passes. |
| 6 | Detail-2 wholes | at spawn, low and med | none | at spawn plus DETAIL3_ONLY | **None in S1**; C's rule after PH-13 with the touch rows (M11) |
| 7 | What opens a place | 5 pages | finale, or 7 / 6 quests | stamps plus 1 a day | **Stamps only.** No calendar gate. A finale is never required (M21). |
| 8 | Wish lifetime | never expires, re-glance every 12 s | rests in the Journal, re-opens every 45 s | fades at session end | **Rests in the Journal**, at most 2 re-glances, no periodic re-show (M18) |
| 9 | Sulk and huff triggers | partner put away | ball taken, a toss | unnoticed wish, friend gone | **Squishy-to-squishy scene events only** (M4) |
| 10 | Warmth on merge | max | max | max / 2 | **max** (M20) |
| 11 | Camera in a place | follows the party | follows the centroid | rule says none, 9.6 follows | **No autonomous camera motion** (M10) |
| 12 | Touch gate | includes locks | includes locks | no locks | **Includes locks**, with the party rules (M8) |
| 13 | Gift origin | `'task'` | `'restock'` | `'task'` | **`'restock'`**: a chosen species with a base genome is what restock does. Never a new code (`store.ts` 96). |
| 14 | Gift-paid record | journal only | journal only | hoard field | **Three-step grant with a deterministic ghost id** (M2) |
| 15 | Where the attention budget lives | `src/life` (pure) | `src/shell` | `src/life` (pure) | **`src/life/attention.ts`**, node-tested. The shell only wires it. |
| 16 | Phone profile | coarse pointer OR short side < 600 | coarse AND short side < 600 | coarse OR width < 700 | **A's rule.** It errs toward the calmer caps on touch devices. |
| 17 | Friendship words | Met / Pals / Best pals (plus a "best friend" fact) | Met / Pals / Close pals | hearts 1 to 5 | **Met / Friends / Close friends.** "Best friends" is reserved for the 25 authored pairs (a fact). No hearts, no "Pals" (M5, M6). |
| 18 | Friendship pace | 20 a visit, 40 a day | 20 a day; Friends at 12 | 6 a day | **B's**: Friends within the first session, Close friends over at least 2 days |
| 19 | Chatter while touching | (not stated) | no new syllable while any finger is down | duck 6 dB, 1 syllable a second | **C's duck.** With five-finger multi-pull (LOCK 1.3), B's rule would silence most play. |
| 20 | Bubble style | cream fill, ink icon | plum fill, cream icon | cream fill, ink outline | **Cream fill, ink icon, a plum or ink outline**: it reads on night places, where plum vanishes. Measure it per place sky (RE04 / RD-04). |
| 21 | Bubbles in photos | yes, switch | yes, switch | hidden | **Yes, with a switch, default on** |
| 22 | Place sounds setting | own slider | own slider | follows Music | **Its own slider**, for sound-sensitive players |
| 23 | Size gates | 1280 / 1600 | 1280 / 1650 | 1290 / 1850 | **1300 first load / 1850 total, at most 45 KB per place** (M14) |
| 24 | LIFE think rate | 10 Hz | 2 Hz | 10 Hz | **10 Hz, staggered** (A, C) |

---

## 6. Which proposal is the base for each area

| Area | Base | Take from the others (and the must-fixes that apply) |
|---|---|---|
| **Places and things** | **C** (1.0-1.11, R1-R3) | A's per-thing family cells for each place's signature things. B's brightness cap and token rule. M11, M12, M13, M6 (names). |
| **Life and social play** | **A** for the catalogue (3.3 B01-B14, P01-P02, 4 S01-S11, 3.5) | **B's rules** on top: needs reset on coming out (3.2), huff never about the player, held and shy arrival (3.3 #17, #18), hops under `land` (3.4). **C's runtime discipline**: still behaviours so bodies sleep, mover tokens, no character in two joint behaviours (LF-11), `hush`. M4, M8, M9, M24. |
| **Emotes and voices** | **A** (5.1 to 5.2: motif, pentatonic snap, cheapest voice, UI-03, words under bubbles) | B's set without ♥ (snug), at 24 icons. C's group bubble dots and echo. C's phone caps. M5, M16, M17, M18. |
| **Pieces and the attention budget** | **C** (5.4, 6) | A's one squishy in pieces at a time and the flock. B's untouched-body events into the budget (5.4). M10. |
| **The Journal and rewards** | **B** (7: gifts, audit, rest-in-Journal, backfill, QU01 and QU02) | C's chapter per place, append-only ids, fairness rules, stamps and the cross-place chapter. A's first wish as the first trip. M1, M2, M3, M20, M21. |
| **The screens** | **B** (8.1 to 8.6) | C's postcard Travel grid (the only one sized for 10 places). A's wish card, Wishes now list and 44 px projected hit areas. M7, M16, M23, built on the UI overhaul (M15). |
| **Architecture and build order** | **C** (9, 10.4, 11) | A's S0 "Life at Home" milestone and EC-01. B's step 0 and "Never cut". M2, M8, M14, M15, M22. |

---

## 7. Where I differ from JUDGE_FUN

- **Camera.** JUDGE_FUN keeps "the party-centroid follow clamped to a box" as a C idea (its section 2, C 11) while also saying "no autonomous camera moves". A follow of a wandering party **is** autonomous camera motion. Drop it (M10).
- **Calendar gate.** JUDGE_FUN F28 keeps one postcard a day with softer copy. I would drop the day gate entirely and put the daily limit on gifts only (M21).
- **Hops.** F7's 6 to 8 cm normal hop is fine **after** PH-01 passes. Until then, S1 ships at 3.5 cm or less (M11).
- **Agreed**, and they need no second argument: F3 (sulks), F5 (warmth), F6 (no ♥), F11 (water), F15 (no capsules), F16 (bubbles in photos), F20 (wishes rest).

---

## 8. Checks to add to the acceptance list (ids for the verifier; node first)

- **CS-01** A 60-sim-minute run with no input: autonomy on, travel by the dev hook to every place, the quest reducer live. Expected: 0 SP, 0 task progress, 0 capsules, 0 gifts claimable, 0 haptics, 0 camera moves. This extends A's EC-01.
- **CS-02** A static check per chapter: the quests completable from the **keyboard event set** (focused-squishy press, keyboard stretch, "Go play with...", Travel, wishes) reach the opening and finale thresholds.
- **CS-03** Interrupt a gift grant after each of its 3 steps. Then do a round trip through the current `serializeHoard` (15 fields), and run two tabs. Each case gives exactly one gift per chapter.
- **CS-04** The trigger table of sulk and huff contains no player action, absence or timer. No copy word from M4 appears in player text.
- **CS-05** The name-gate split of M6 gives 0 hits. Place and thing names are not near species names, and coined prefixes are unique.
- **CS-06** Every place colour is a token mix. Nothing is pastel. The play-area mean linear luminance is at most 0.35.
- **CS-07** In every pool, a resting sinker's eye anchor stays above the surface. Every body leaves water by itself within 30 s.
- **CS-08** At 320 x 568, every Journal, Travel, gift and shelf layout fits 288 px with no horizontal scroll.
- **CS-09** Bubble hit areas are at least 44 x 44 and never overlap the body silhouette. A press on the body is always a poke.
- **CS-10** A locked body gets 0 LIFE motion. Pressing another party member keeps its locks. Travel releases them.
- **CS-11** Every friend and place wish names its target in the tap card and the live region.
- **CS-12** First load is at most 1300 KB with the UI overhaul landed. Each place chunk is at most 45 KB. The total fits the budget.
- **CS-13** No reducer or UI path ever decrements stamps, warmth or friendship points (no currency).
- **CS-14** With `hush` pinned by the dev hook, the real shell's LIFE intent hash is equal across 3 runs.

---

## 9. What I did not check

- I did not run tsc, any probe, the economy sim, a browser or a build. I did not hear any voice.
- The name results are from the real gate code, run on my own transcription of the names. I did not run them through `probe_catalog.ts` itself or through a future `name_gate.ts`.
- I did not verify any physics claim. That covers hops, prop contact, lips, water, sleep and detail-2 behaviour. The costs quoted are the PHYS map's.
- My economy figures re-derive C 7.11 from DESIGN 5.4 and 5.12 (6.0 capsules per active day, 70% active days). They are arithmetic, not a sim run.
- I did not open `src/ui/hoard/panel.ts`; the ♥ glyph and Hearts chip are from JUDGE_FUN and DESIGN 5.6.
- I did not check `stage.ts framingFor`'s behaviour; I relied on STATUS line 30.
- I did not check whether a sandboxed portal iframe blocks downloads on every browser. M19 asks for no dependency either way.
- I did not check the 390 x 844 pixel layouts beyond the proposals' numbers and the SHELL map's free-space notes.
