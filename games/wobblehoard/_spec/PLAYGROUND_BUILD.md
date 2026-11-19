# PLAYGROUND_BUILD: how PLAYGROUND is built, budgeted, checked and shipped

**Status:** final, 2026-11-15, by the PLAYGROUND synthesizer (design lead and technical director in one), from `_handoff/design/DIRECTION.md` (the
owner's request and decisions D1 to D12, with the 1b clarification), the five seam maps in `_handoff/maps/`, the proposals A, B, C and the judgements
JUDGE_FUN, JUDGE_FEASIBILITY and JUDGE_COHERENCE. The content specs are [`PLACES.md`](PLACES.md), [`LIFE.md`](LIFE.md) and [`QUESTS.md`](QUESTS.md);
this page is the architecture, the ownership, the contract, the budgets, the slices, the build order, the checks and the decisions. The lane briefs
are `_handoff/briefs/PG_*.md`. Where this page and a proposal or a judgement differ, this page wins; where this page and DESIGN, FUN, CUT, LOCK, UI
or TRADE differ, section 17 says exactly what changes and who changes it. Paths are relative to `games/wobblehoard`.

**What I verified in the code** before writing a technical claim (section 22 lists what I did not): `src/physics/softbody.ts` 155-200 (land
threshold 0.9 m/s, NEAR 0.01, LOAD_CONC 10), 1895-1935 (supported gravity; the float hover pulls toward x = z = 0), 1862-1874 (`moveTo` is horizontal
on the table), 2214-2295 (support, tack and land detection only at y = 0; friction cap mu x load), 2336-2352 (the slosh push only when
`!gravityOn`), 2788-2836 (grounded = 3+ near particles; strands only from a retracting fingertip), 1331-1342 (`boundRadius` on every pair),
276 and 1405 (bump memory keyed `bodyId & 15`); `src/physics/shape.ts` 68 (R 0.4 to 0.625) and 205-216 (masses normalised to a mean of 1);
`src/collection/store.ts` 50, 84-111, 225-266 (origins, row checks, unknown hoard fields dropped on load and never written), `ghost.ts` 120-170
(the restock grant uses `speciesBaseGenome`, no roll), `constants.ts` 20-50 (`ID_PATTERN`, the caps); `src/core/settings.ts` 92-111
(`resolveSettings` returns every key); `src/shell/mat.ts` 18-24, `cut.ts` 36-42 and 283 (a cut empties the mat), `game.ts` 255, 381, 548-605, 831,
`boot.ts` 90-98; `src/input/keyboard.ts` 60-125 (J and P are free); `src/ui/hoard/panel.ts` 216, 267, 357 (the ♥ and the Hearts chip);
`src/render/stage.ts` 87-88, 219, 643-649 (mat slots); `src/audio/cut.ts` 33-41 and `music.ts` 21-25, 256-264 (flavours, fields, 66 BPM);
`vite.config.ts` 9-24, 161-192 and `_harness/browser_shell.mjs` 3437 (the single 1.2 MB G0 gate); the 16 random salts in src. I ran: the typecheck
(clean before and after my contract change), the real name gate over every new name and line, a script over the catalog for the favourites and
best-friend rules, a script for the trait spreads, and a script for the Home thing spots against the mat slots.

**Revision, 2026-11-15 (the continuing synthesizer, after the first one was cut off before the briefs):** I re-read the four specs and the
judgements in full and fixed only real gaps and contradictions:
- decisions D-55 to D-59 (section 2): 20 collider primitives against a judge's 12; LIFE owns the looks; one `lifeScript` call for onboarding and
  shell-driven moments; the LIFE and quest hosts as their own lines in `simStep` (the first draft's `onStep` shortcut contradicted the SHELL-4 seam
  notes); LIFE plans every phrase and audio synthesises it (section 10 and the contract's `creature()` disagreed);
- the LIFE seam functions the shell needs (`lifeScript`, `lifeSetJournal`, `lifeSetPair`, `lifeLooks`, `lifeAddLook`, `lifeWishOf`, `lifePhrase`,
  `lifeMotif`: LIFE.md 3.1, 4.1, 12) and the motion gate's delta (LIFE.md 10.3: "units + k" counted an awake body twice);
- one more optional contract member, `SoftMetrics.memoryBusy` (section 7: the snapshot's MEMORY_BUSY flag had no source; 4 insertions, typecheck
  clean);
- the cabin's layout (PLACES 4.2: the swing's arc went through the hearth and the back wall, 5 spawn spots were 0.24 to 0.80 m from things); Home's
  Bounce Pad waits for the S2 pad physics (it was promised at the S1 Hearthlog finale); the Frostbell gift finale I8 now needs a wish the player
  granted (QUESTS 4 and 6.3: a nap or song wish can come true with no input); F1 gets a typed event (REACT LOVE);
- the checks: DT-01 (swept ranges, clearances, corners), DT-11 (two base seeds), PH-01 (the apex with GRAVITY 10), LF-18 to LF-20 (new: the water
  exit, the scripts, the looks), EC-02 (60 sim minutes, as LIFE L3 and CS-01 say), QU-07 (what counts as player-caused), T2's line reference, the
  per-place browser rule and the audio "O" note (18, 19), and `_harness/probe_chatter.ts` for AU-10 (section 5).
I then wrote the eight lane briefs `_handoff/briefs/PG_*.md` and the pointer sections in FUN.md (section 4) and NEXT_STEPS.md (section 8). Checked by me: `npx tsc --noEmit -p tsconfig.json` clean (exit 0, about 2 s) at HEAD 4fe77736 with the PLAYGROUND block; the
layout script; `GRAVITY = 10` (params.ts 16) and `LAND_MIN_SPEED = 0.9` (softbody.ts 155); the salt and seed constants in src by grep;
`splitInTwo` halves the largest piece (cut.ts 507-525), so Split in two twice makes the three pieces C6 needs; `MAT_LIMIT` (mat.ts 22),
`MAX_PIECES` (cut.ts 38), `clearMat` (cut.ts 283), `game.onStep` (831), the Space key at the screen centre (keyboard.ts 74-83), store, ghost and
settings references, the G0 row (now browser_shell.mjs 3448). Not checked: anything run on a body, a browser, a build or an audio render.

**Revision 3, 2026-11-15 (after the adversarial review: `_handoff/design/REVIEW_code-truth.md`, `REVIEW_game-truth.md`,
`REVIEW_rules-and-clarity.md`, 86 findings).** I verified every blocker and major against the code or the specs before changing anything
(section 23 says how, and lists the findings I did not adopt and why). The root fixes, each in every file it touches (the four specs, the
PLAYGROUND block of `src/contracts.ts` and the eight briefs), are decisions **D-60 to D-84** (section 2). The biggest: one physics bar in
container milliseconds through a measured phone factor, with the awake budget computed from measured costs and joint moments played turn by
turn (D-60, D-61, 14.2); a post-play "life chunk" so the first load holds only what boot needs (D-69, 14.3); body bumps carry `auto` and
the shell routes every `auto` event away from `feedback.ts` (D-62); LIFE travels with its own touch-gated `scootTo`, never `moveTo` (D-63);
the first wish no longer needs Dollop (D-70); Home's things and LIFE stay inside the camera's view, and every place gets a tall (portrait)
layout (D-67, D-68); the gift grant flushes and verifies the hoard write (D-71); typed REACT triggers, the PIECES count, the prop-to-thing
map and a RIDE state make every quest producible from LIFE's real output (D-64, D-72 to D-75); keyboard routes for switches, balls and
bubbles without taking Tab (D-77); Friends Everywhere's place-spanning quests wait for S2 and only completable quests are shown (D-78).
I re-ran the layout geometry by script (Hearthlog wide and tall pass DT-01 with 0 problems; Home's ball spots by projection), the camera
projections for B2 and M1, and the name gate on every new line (section 20). Typecheck clean after the contract change.

**Revision 4, 2026-11-16 (the second and last fix pass, after the independent confirmer, `_handoff/design/CONFIRM.md`: 9 findings unresolved and
8 new problems).** Each is fixed at its root in every file it touches, as decisions **D-85 to D-93** (section 2), or listed in section 24 (open
questions for the orchestrator). The biggest: the motion gate's floor holds one awake whole and every sleeper, and a ride moment has its riders'
allowance, so LIFE never freezes on low and S11 and S03 play on every tier (D-85, 14.2, PF-06); `auto` counts only a finger, a grab or a carry
(D-86); Home's corral bounds hold every slot and LIFE's Home targets lie between framed points (D-87); Home's five other things have laid spots,
each with the party size from which it shows, all at 3 or fewer (D-88); LIFE receives its PlaceDef and layout (D-89); use spots are exempt from
LIFE's shrink (D-90); rides stay inside the bounds and the cabin is re-laid in both layouts (D-91); the life chunk is re-budgeted from measured
data bytes, the five play-time UI modules are named, and an overflow rule says what moves or ships `shipped: false` (D-92); "Tap it yourself"
reaches every thing a tap moves (D-93). Smaller: a floater leaves the water by `scootTo` (LIFE 5.3), the Leaf Teeter's pivot is 0.24 m (PLACES
4.5), DT-09 exempts VISIT titles, F2's watchers are B02 or B18 in both pages, CS-02 cites QU-09. Scripts (scratch `pg_fix4/`, reusing the earlier
fixer's `pg_fix3/` camera model, which I re-checked against stage.ts 87-88, 255-330 and 520-535): `homebounds.mjs`, `standarea.mjs`,
`homespots.mjs` (cross-checked by `pg_fix3/check2.mjs`), `usespots.mjs`, `lampglow.mjs`, `ballroom.mjs`, `cabin_final3.mjs`, `tallsearch.mjs`,
`spawn3.mjs`, and `pg_fix3/datagen.mjs` for the data bytes. Section 22 says what I checked and what I did not.

---

## 1. The owner's five asks, traced

| Ask | Made true by (features) | Proven by (checks, section 18) | Slice |
|---|---|---|---|
| 1 Places: environments to put squishies into; more than the three examples (1b) | Home plus 9 places (PLACES 4): Hearthlog Cabin, Ripple Shore, Frostbell Ridge (the owner's three) and Rainleaf Garden, Fizzwell Tub, Cogwhistle Bench, Lanternroof, Echo Hollow, Cloudloft; built from a 14-mechanism library and 9 zone kinds (PLACES 2); the Travel sheet; a tenth place costs data plus one 45 KB chunk (PLACES 6) | DT-01, DT-13, RD-01, RD-07, RD-13, SH-07, SZ-02, FN-03 | S1 (cabin), S2 (3), S3 (5) |
| 2 Things squishies use in their own way | 62 things (6 or 7 a place), each with a family-by-thing table (PLACES 4) over 12 gaits (LIFE 5.2), warm and cold poses, a generated float table (PLACES 2.5), ground modifiers, pad gains; channel defaults by construction (PLACES 3) | DT-06, DT-10, PH-01, PH-08, PH-15, PH-16, FN-02, FN-03, FN-06 | S1 |
| 3 Several squishies at once, social, with emotes and little voices | party manager (3/4/5 wholes), LIFE brains (B01-B19), 18 social moments (LIFE 6), friendship and warmth, 24 squishmoji (LIFE 7), species voice motifs, call and answer, duets, harmony on the music, the echo (LIFE 8) | LF-01..20, AU-01..13, RD-04, RD-10, RD-11, SH-02, FN-01, FN-06 | S0, S1 |
| 4 Pieces join in, calm with many characters | one brain per cut squishy, group bubbles with count dots, one group voice, pieces count for quests, the party stays when cutting, the attention budget and the motion gate (LIFE 9, 10) | LF-07, LF-08, AU-05, SH-03, PF-03, CS-01 | S0, S1 |
| 5 A real game with purpose | the Journal: 11 chapters, 110 stamp quests as rules over typed events, stamps open places over about two weeks, 12 facts per species, wishes that lead to discoveries, 20 keepsakes, 5 gift squishies for life; no currency, no timers, no loss (QUESTS) | QU-01..12, CO-01..09, EC-01..04, CS-02, CS-04, CS-13 | S1 (Home, Hearthlog, Friends Everywhere), S2, S3 |

---

## 2. Decisions (the decision, the alternatives, why)

Where the judges disagreed, the row says so. "F" = JUDGE_FUN, "K"/"F#" in feasibility = JUDGE_FEASIBILITY, "M" = JUDGE_COHERENCE.

| # | Decision | Alternatives | Why |
|---|---|---|---|
| D-01 | Home plus **9 places**, C's set, filled to A's per-thing detail | A and B: Home plus 3 | Owner 1b ("at least 8 beyond Home"); C has the only library and the cost of an Nth place. |
| D-02 | **S1 is Hearthlog Cabin** | A, B: the beach first | All five asks with the least new physics (no water, ramps or fields); all three judges. |
| D-03 | Slices **S0 "Life at Home"** (internal milestone, exit FN-01) then S1 cabin, S2 water and cold (Ripple, Frostbell, Rainleaf), S3 fields and echo (Fizzwell, Cogwhistle, Lanternroof, Echo Hollow, Cloudloft) | A's beach-first S1; B's S1a | F and M agree on S0; C's order builds water once for three places. |
| D-04 | **Water at most 0.30 m deep everywhere**, whole-body buoyancy as a gravity scale, a generated float table; the foams and the pop dome float, everyone else wades | A 0.42 m per-particle; B 0.75 m with 0.8 m walls; C up to 0.9 m | The lowest eye anchor is about 0.40 m, so every resting body keeps its eyes above water (F11, M12, CS-07); no rims to climb (P3); text cannot lie (F7). Cost: no deep floating, and DIRECTION 5.2's example "a water-filled one floats" becomes "a water-filled one wades and sloshes" (flagged for the owner, section 3). |
| D-05 | Water has **no rims**: a render-only edge ring hides its side, a 0.4 m physics depth ramp at the edge | C's rim of bars with a 0.12 m entry | A rim is a climb; a vertical water face is hidden by foam, steam, bubbles or glowing moss. |
| D-06 | **Flush pads and turntables** (top at y = 0), the pad kicks up when struck | C: a 0.12 m pad lip and a 0.10 m turntable rim, fallback 0.06 m | Getting over a lip is unproven (K9: `moveTo` is horizontal and friction never sees it); flush is floor level with no risk. |
| D-07 | **Hops: S1 at most 3.5 cm** (vy 0.84) for every family, read through a strong squash and stretch; **S2 raises them per family** to 6 to 8 cm (12 cm big) after PH-01, with `auto` landings | F7: 6 to 8 cm in S1; feasibility and M11: at most 3.5 cm | Judges disagree. S1 fires no `land` by construction and needs no new gate; the legibility F7 wants comes from the pose in S1 and the height in S2 once PH-01 proves it on 12 families x 3 genomes and pieces. |
| D-08 | **Nothing climbs; rides on wish** (a star thought bubble beside a ride; the player sets it up) | A's climb gate | K9, M11; F13 turns "when set there" into a purpose. Climbing may come later behind a PHYS gate. |
| D-09 | **A's 12 gaits as data** on C's primitives | C's one inchworm scoot | F8. |
| D-10 | **Lean, sway, wiggle, shiver and breathing are render-side** (`setBodyPose`); LIFE's physics drivers are only `setSquash`, `hop`, `carryTo`, `scootTo` (its travel, D-63) and `nudge`; the existing `moveTo` stays the ceremonies' and the cut's | PHYS E8 lean and wiggle in physics | F16: a sleeping body can sing and sway at about zero physics cost; one less physics feature to gate. |
| D-11 | **Support on up-facing prop faces** (within 35 degrees of up) counts for supported gravity, load, grounded and land; on a tilted face gravity's tangential part is kept, so ramps still slide | today: support only near y = 0 | K1: on any prop top a body sags, creeps and never sleeps (softbody.ts 1900-1904, 2290). The tilt rule is mine: without it F1 would stop every ramp slide. |
| D-12 | **Weight transfer onto moving props**: a body supported by a moving prop adds bodyMass x g x its supported share at its contact centroid to the prop's accumulators each substep | rely on particle corrections | Mine, not in any proposal: supported gravity fades a resting body's weight to zero (softbody.ts 1906-1916), so a seesaw would never tip under a sitter. |
| D-13 | **Superseded by D-61** (revision 3). It read: movers 2 / 3 / 4 (a design floor) and deterministic units 3.0 / 4.0 / 5.5. Kept: LIFE reads no clock; the units are deterministic and in the snapshot | C: 1 / 2 / 4 with a measured `performance.now` hush; feasibility: units 1.5 / 2.5 / 4.0 | F13 and M22: LIFE must not read a clock. The numbers broke the budget at every tier (REVIEW_code-truth B2). |
| D-14 | **No detail-2 whole squishies in S1 and S2**; no run-time detail swap | A: detail 2 for every non-active member; C: chosen at spawn | The player can pick and squeeze any party member and detail-2 press, pull and fold rows are ungated (PHYS map 4); sleep does the work (B). |
| D-15 | Caps: wholes 3 / 4 / 5, pieces 4 / 6 / 6, characters 6 / 8 / 10 | C: high 6 wholes | Today's MAT_LIMIT and MAX_PIECES; feasibility. |
| D-16 | **The party stays when you cut**; only one squishy is in pieces at a time; pieces = min(MAX_PIECES, cap - (wholes - 1)) | today: a cut empties the mat (cut.ts 283) | B, C, A; the change is a SHELL task (11.4) and a CUT.md note (17, T4). |
| D-17 | The attention budget is **C's table**, phone 2 bubbles plus a wish at 0.8 starts a second; it lives in `src/life/attention.ts` (pure) | A, B: 3 bubbles at 1.5 a second; B: in the shell | F (calm for a child), feasibility and M (node-tested). |
| D-18 | Brains think at **10 Hz on sim time**, staggered by slot | B: 2 Hz; A, C: every 6th frame | F22: frame-rate independent; a notice starts within 0.15 s. |
| D-19 | **No ♥ glyph; affection is "snug"**; friendship words **Met / Friends / Close friends**; "best friends" are the 25 authored pairs | F: Met / Pals / Best pals | Judges disagree. M6: "Pals" is another game's creature word; "Best pals" next to "best friend" confuses two things (M, contradiction 17). |
| D-20 | Friendship pace: Friends at 12 points (first session), Close friends at 40, at most 20 a pair a day | A: 40 / 120; C: 6 a day | F18, M: the cute basics from Met, Friends within a session, Close friends over 2 days or more. |
| D-21 | **Warmth** per instance, 5 glow dots, never falls, a merge keeps the larger | C: max(parents) / 2 | F5, M20. |
| D-22 | **A huff starts only from a squishy-to-squishy scene event**, at most 3 s, any touch turns it into a giggle; no comfort after a cut; no "whole again" wish | A: partner put away; B: a toss, comfort after a cut; C: an unnoticed wish | F3, F4, M4. |
| D-23 | **Wishes rest in the Journal**; at most 2 re-glances then a still dot; no Daily Wishes list; the rest line is "It can wait." | A: re-glance every 12 s, Daily Wishes; B: re-open every 45 s and "No hurry"; C: fade at session end | F20, M18; "hurry" is a copy-gate word (M4), so B's kind "No hurry" became "It can wait." |
| D-24 | **24 squishmoji**, wishes reuse them | A: 41 icons | F21. |
| D-25 | Bubbles at least 36 px on a phone, 44 x 44 DOM hit areas never over the body, cream fill, ink icon, plum outline | C: 30 px; B: plum fill | F22, M16, M contradiction 20. |
| D-26 | **Bubbles in photos by default**, with a switch | C: hidden | F16, M contradiction 21. |
| D-27 | Voices: A's species motif + B's pair duet + C's echo; D pentatonic always; never in ROOM_KINDS; peak at most -20 dBFS at Voices 100% | C: by behaviour only; A: -18 dBFS at 0.6 | F17; the AUDIO map's room-dip trap; AU-03 decides the final level. |
| D-28 | Settings label **"Voices"**; **"Place sounds"** is its own slider | A, C: "Squishy chatter"; C: place sounds follow Music | M6: "chatter" fails the PROSE gate; F and M: a parent will want surf quieter than music. |
| D-29 | **Rewards: 5 gift squishies for life**, Common or Uncommon, at most 1 per UTC day, Practice shelf only; **no capsules, no squish points** | A: 3 capsules; C: 11 capsules | F15, M1, M3; B's pace proof by construction. |
| D-30 | Gifts at the finales of Hearthlog, Ripple, Frostbell, Rainleaf and Friends Everywhere | every finale | Each early gift points at the next place; the last brings the three families with no Common. |
| D-31 | **The gift grant is three steps with a deterministic id**, origin `'restock'`; step 2 flushes the hoard store and verifies the row reached storage before step 3 (D-71) | C: a hoard field; A, B: two keys with no order | M2, F14: older builds drop unknown hoard fields (store.ts 225-266). |
| D-32 | **Places open by stamps only**, no daily limit; thresholds 12 / 20 / 28 / 36 / 45 / 54 / 63 / 72 | C: at most one place a day; F28: one postcard a day | Judges disagree. M21: a daily content limit is an appointment mechanic (DESIGN 8.4); the daily limit belongs to gifts. |
| D-33 | Every finale opens at **5 of 7** main quests; Hearthlog opens when the first wish shows; the Home finale is that wish granted on the first arrival at Hearthlog with any party (the wisher need not be Dollop, D-70) | C: Home 8 = visit Hearthlog, which needs the Home finale (circular) | F1, F2. |
| D-34 | Journal tabs **Stamps / Squishies / Friends / Keepsakes** | Pages, Story, Quests | F: "Quests" is a hard word for a seven-year-old. |
| D-35 | **12 facts per species** (B's list with C's cold and ground ways) | A 6, C 16 | F19: every fact has an event and a hint. |
| D-36 | The Journal under its own key `wobblehoard:v2:journal`, its own store, `JOURNAL_MIGRATIONS` from day one | a hoard field | CORE map 4: old builds never read it, so a rollback cannot eat it. |
| D-37 | **No camera motion from autonomy anywhere**, Home included: the camera frames the play bounds | A, B, C: a party follow; F kept a clamped follow | M10 (differs from F, M section 7): a follow of a wandering party is autonomous camera motion. |
| D-38 | Tabletop gravity forced in places and with more than one body out (the exact rule, which also keeps Float working at Home, is D-83) | none addressed it | K15, F10: the hover pulls every body to the world origin. |
| D-39 | **Any non-Hand tool quiets autonomy**; memory families get no LIFE squash while their memory has not converged | only Cut pauses | M9: room for Stamp and Roll; a print must heal as FUN says. |
| D-40 | Keyboard parity: the focused squishy, a keyboard stretch, "Go play with..." with a scripted lift (`carryTo`) | Space presses the screen centre today | M7, CS-02. |
| D-41 | **Superseded by D-69** (revision 3). It read: first load at most 1300 KB, the PLAYGROUND first-load delta 60 KB target and 70 KB hard, total 1900 KB, each place 45 KB, the away chunk 120 KB, the screens chunk 45 KB. Kept: the first load at most 1300 KB, the delta 60 / 70 KB, the place, away and screens chunk caps (revision 4 lowered the away cap to 90 KB, D-92) | C 1290 / 1850; M14 1300 / 1850; F15 60 KB / 1900 | The estimate behind the 70 KB delta was 2 to 3x low on measured bytes (REVIEW_code-truth M1). |
| D-42 | Player text is lazy (`src/data/journal_text.ts`, the screens chunk) except the three bubble words; Home's chapter text (`HOME_TEXT`) and the place names load with the life chunk (D-69) | C: all data in the first load | F15; C's 12 KB estimate is about 3x low (K). |
| D-43 | Contracts carry numbers, strings and typed arrays; the id unions live in data | B: unions in contracts.ts | F24: a new place must never be a contract change. |
| D-44 | The five Settings members land **with** `src/core/settings.ts`, not in my contract change | apply them now | Mine: `resolveSettings` returns every key of `Settings`, so a key without its default breaks the typecheck; settings.ts is the SHELL lane's file (11.9). |
| D-45 | The event bus is a **typed-array ring** | A: a function with nine number arguments; B: a flat record | F23: no doubles boxed through a non-inlined call. |
| D-46 | Ceremonies in a place: the pad at (0, 0); today's hide-all, then the party is re-placed | B: the others step aside | Every ceremony and flash gate would need a re-run; C cuts it. |
| D-47 | **Fizzwell is a shallow bath over the back of the floor** (water only at z < -1.2, so the pad is dry: re-laid in revision 3, PLACES 4.6); it also fulfils FUN 1's later "Float" activity | C: 0.9 m over the whole area; the first draft's z < -0.2 flooded 1.0 m of the pad | F11, F19, M12; REVIEW_game-truth M15. |
| D-48 | Home's nap spot is a flat **Snooze Rug**, not a ring | C's basket | Mine: a 0.7 m ring overlapped a body on a mat slot by up to 0.25 m (script, PLACES 4.1). |
| D-49 | Renames for CS-05 (Puddlebrook to **Rainleaf**, Cushion Swing to Pillow Swing, Tide Pool to Rock Pool, Puddles to Splash Spots, Moon Puddle to Moon Dish) | the proposals' names | M6, CS-05: no place or thing word may share a species' first four letters. |
| D-50 | Lanternroof gets parapets; places use token colours only; play-area luminance at most 0.35 | C's brass and copper colours | M13. |
| D-51 | No animal sounds; MusicStyle per place changes field weights and mallet timbre only (key D, 66 BPM) | retune per place | D10; ceremonies and the whole-again run are fixed in key (AUDIO map 2). |
| D-52 | The first capsule's newcomer stays out; it arrives shy but says hello within 5 s; things arrive at Home one by one, each only once its spot is in view (D-67) | today: the reveal replaces the play body | A's first minute, B's shy arrival and clean minute 0; F10. |
| D-53 | The salt registry lives in `src/data/life.ts` | `src/core/rng.ts` | rng.ts is the orchestrator's frozen file (CONTRACT 2); a data module is the DATA lane's. |
| D-54 | Thing reactions: no tack or strings on props (a strand look when a tacky body leaves a prop it touched for 0.5 s); no field force on a grounded body | the proposals' "sticks to the prop", "drifts in the wind" | K2, K3, F8, F9. |
| D-55 | **At most 20 collider primitives per place** (with 8 moving props, one free ball) | JUDGE_FEASIBILITY 5 and 8: 12 collider parts | A ring alone is 4 to 6 segments and the walls 3 or 4, so 12 leaves 2 to 5 for every other thing (Hearthlog has 15, Ripple 19). A far primitive costs one bounding-sphere test against the body's cached bound radius per substep; PH-12 (at most 1.25x with 4 props in reach) gates the real cost, and DT-01 keeps the count. |
| D-56 | **LIFE owns the looks** (frost, wet, soak, sand, snow, toast), integrated in `lifeStep`; the host reads them (`lifeLooks`) | the shell host integrates them and adds them to the snapshot | The comfort behaviours, the wishes, the REACT events and the squirt game all read them, and LIFE is the node-tested pure lane; this keeps the contract's snapshot as it is (LIFE.md 3.1). |
| D-57 | **Onboarding and shell-driven moments reach LIFE through one `lifeScript` call** (FIRST_PLAY, FIRST_WISH, PLAY_WITH, POSE, CHEER, SQUIRTED) | new snapshot fields; an onboarding special case inside the brain | FN-01 cannot pass from the needs alone (LIFE.md 4.1: 22 to 30 s to play 0.4 after a squeeze); a script call is deterministic, testable and needs no contract change. |
| D-58 | **The LIFE host and the quest host are their own lines in `simStep`**, never `game.onStep` hooks | the first draft of this page: "steps 2 and 5 may start as an onStep hook" | SHELL_4.md ("Seams for PLAYGROUND" 1): onStep hooks are UI listeners that run after the capsules and ceremonies, in registration order. |
| D-59 | **LIFE plans every phrase; audio synthesises it** (`lifePhrase` fills the `phrase` array of `SquishAudio.creature`) | the first draft of section 10: the motif and the duet in `src/audio/creature.ts` | The answer mirrors the caller's phrase and the duet belongs to a pair: that is state across characters, which LIFE has and audio does not; the contract's `creature()` already takes ready syllables. Audio keeps the timbre, the snap, the echo, the group voice and the limiter. |
| D-60 | **One physics bar, two harnesses.** The bar is the phone budget per tier (14.2); in Chromium with a 4x CPU throttle it is measured as is (PF-01..03), in node it is the same number divided by the phone factor **F** (PF-05 = B / F). F is measured once, by PF-00 at step 0, before `attention.ts` fixes its caps; until then F = 4 | PF-05 at 2.0 ms in node beside PF-01 at 6.0 ms throttled | REVIEW_code-truth B2: the two bars contradicted each other (2.0 x 4 = 8.0 > 6.0). F = 4 because Chromium's physics cost on this container matches node's (SHELL_4.md 75-77 against PHYS map 4), so only the throttle remains. |
| D-61 | **The awake budget comes from measured costs, and joint moments are played turn by turn.** unitCap = (B / F - 0.20 ms of props) / 0.87 ms (an awake detail-3 whole, pressed), at least the floor of D-85 (revision 4: one awake whole plus every other whole asleep, 1.0 + 0.03 x (the tier's wholes cap - 1)): at F = 4 that is 1.06 / 1.49 / 2.64 for low / med / high; moverCap = max(1, floor(unitCap)) = 1 / 1 / 2; the unit weights are PF-00's cost ratios (a piece 0.22, a touching pair 0.25, a sleeper 0.03). A start that wakes a body must keep units at or under unitCap; one that wakes nobody needs only a mover token. Every joint moment moves one character at a time (the partner waits still and may sleep; contact approaches end at 0.04 m/s, under the wake speed). Over the cap the shell cancels the farthest untouched LIFE mover and puts untouched wholes to sleep (`sleep()`); the player's bodies are never forced | D-13's movers 2 / 3 / 4 and units 3.0 / 4.0 / 5.5; the reviewer's "low = 1 awake whole + the touched one" (at F = 4 that is 1.94 ms against low's 1.0) | B2: the old floor (2 movers + 1 touched) was 10.7 ms throttled on low, 2.7x its budget; turn-taking keeps every social moment and every quest reachable at moverCap 1 (Q4) once D-85's floor, ride allowance and soft boop are in (revision 3's floor of 1.0 froze LIFE on low and blocked S11 and S03, CONFIRM CT-B2). LIFE.md 10.3 has the table for F = 2, 3 and 4. |
| D-62 | **`auto` on body-to-body bumps too** (true unless the player is touching either body, with a finger, a grab or a carry, never a lock alone (revision 4, D-86), or threw it since its last landing); every `auto` event (land, prop bump, body bump) goes to the attention budget, never to `feedback.handle` | `auto` on lands and prop bumps only | REVIEW_code-truth B1: a body bump fires above 0.35 m/s, so its intensity is at least 0.117, and `feedback.handle` plays `audio.bump` and `haptics.pop()` above 0.05 (feedback.ts 146-151): LIFE's own boop would buzz the phone. |
| D-63 | **LIFE travels with its own driver, `scootTo`** (touch-gated, eased in and out over 0.12 s, horizontal, the corral off as for `moveTo`); `moveTo` stays the ceremonies' and the cut's and is never gated | gate the one `moveTo` | REVIEW_code-truth M3: physics has one `moveTo` (one target, one flag, softbody.ts 1213-1219); gating it breaks the ceremony slide and the cut's steering (cut.ts 213), not gating it lets LIFE scoot under the finger. |
| D-64 | **Props map back to things and parts** (`PropWorldLike.propThing`, `propPart`), in one fixed prop order (every prop of things[0] with its parts in order, then things[1] ..., walls last); the snapshot carries `thingId` for the things out now; strikes carry their cause (player, body, weather) and the striking body's slot; a USE RING record carries the part in `v` | each lane re-derives PG_PHYS's packing | REVIEW_code-truth M4, REVIEW_game-truth M16 and m1: one ThingDef is several props (5 chimes and posts, 6 ring segments), Home's things arrive one by one, and the weather alone could finish R3 and I9. |
| D-65 | **Body identity for contacts**: a writable `contactSlot` (0..31) keys the bump memory; `SoftEvent.other` names the partner of a body bump; `SoftMetrics.contacts` is a bit per slot touching | the shell infers partners | REVIEW_code-truth M5: a bump names no partner (softbody.ts 1409), the bump memory is `bodyId & 15` (1405, aliasing past 16 bodies), and nothing reported which pairs touch, so the units' contact term had no input. |
| D-66 | **LIFE decides on sim time only.** Bar lines come from t on the 66 BPM grid, the field from the place's music style; `musicClock` goes only into `creature()`'s `at` and the render sway phase, after LIFE has decided | the snapshot carried the AudioContext clock | REVIEW_code-truth M6: that clock runs in real time while `DebugHook.step` jumps sim time and is absent before unlock, so intents differed run to run with music on. |
| D-67 | **Home's view and things.** Home keeps today's framing of the mat slots in use (no camera follow of autonomy, D-37); Home's things stand at per-frame spots given in slot units (x bodyScale, as `matLayout`), clear of every slot at every scale; a thing arrives only once its spot is in view at the current party (revision 4, D-88: the data's `fromN`, laid and checked by DT-01's Home row); the Felt Ball's bounds are the visible table (`StageLike.visibleTable`) shrunk by its radius; Home's corral bounds and LIFE's Home targets are D-87's (revision 3 shrank the visible table by R + 0.2 m for both, which left the body's own slot outside the corral) | spawn and spots from a fixed list; LIFE in a disc of r 3.1 m | REVIEW_game-truth B2 (by projection only the Keepsake Shelf was in view on 1280 x 800; B03 could walk the only squishy out of a phone frame) and REVIEW_code-truth M8 (DT-01 failed at Home by its own numbers: gaps of 0.17 and 0.26 m). |
| D-68 | **A tall (portrait) layout for every place.** On a frame with aspect under 0.9 (the `matLayout` test) a place uses its tall layout: body bounds of half sizes 1.25 x 3.0 m (corner radius 0.4), things in the back band and the side strips of the tall frame (PLACES P7), rides inside the bounds; chosen at arrival, re-laid on a rotation at the next idle moment under the travel crossfade. A 1 m squishy is then about 100 CSS px at the front and 80 px at mid-depth on 390 x 844 (57 px with the wide layout framed whole) | one layout framed whole; a party-follow camera (D-37); the reviewer's 1.9 x 2.4 bounds | REVIEW_game-truth M1. My fit script shows 1.9 x 2.4 gives the same 57 px once whole bodies and the HUD insets are framed: the width binds (section 23). |
| D-69 | **The life chunk and the size re-budget.** LIFE, the quest reducer, the journal store, the LIFE and quest hosts, `props.ts` and the LIFE and quest data load in one lazy "life chunk", requested after the first frame of play (Home is today's toy until it lands, a few seconds); the first load keeps only what boot's chunks must hold, with a byte cap per lane (14.3); each place's data moves to its own lazy module (`src/data/place_<id>.ts`); the reaction cells become channel data in those modules and their words leave the build except the fact lines; every lane reports the minified bytes of each new module after every step; the total rises to D9's ceiling, 2000 KB | D-41's single estimate; the reviewer's split without the life chunk (its code alone is about 100 KB) | REVIEW_code-truth M1: one place's data is about 7.5 KB, not 1.5; code minifies to 13 to 21 B a line; a realistic first-load delta was 140 to 250 KB against a 70 KB cap. D9 counts "everything it needs before play", which the life chunk is not. |
| D-70 | **The first wish no longer needs Dollop.** FIRST_WISH's wisher: Dollop if out, else a Hearthlog fan out, else the party member out longest; natural wishes wait until it has shown; it ignores the 120 s gap; if nobody can show it by 5:00 of play, it rests in the Journal and Hearthlog opens; it is granted by the first arrival at Hearthlog with any party | Dollop only | REVIEW_game-truth B1, REVIEW_rules-and-clarity B2: Dollop can be merged away (only a hearted or locked item refuses a merge, ghost.ts 221) or left on the shelf, which stranded every place for good. |
| D-71 | **The gift grant's step 2 is a verified write**: `store.flush()`, then `report().save === 'ok'` and the row's id in the stored text, before step 3; otherwise the gift stays pending ("Your gift will wait here.") | the throttled `markDirty()` (index.ts 121, up to 2000 ms, never on a quota failure) | REVIEW_code-truth M2: step 3 wrote `granted` at once while the hoard write waited, so a crash lost the gift. |
| D-72 | **Typed REACT triggers** (`REACT_TRIGGERS` in `src/data/life.ts`: kind, condition, once per visit or per event, how `thing` is set); REACT events fire whatever behaviour wins; a REACT's thing is the zone's or patch's owning thing, or the source thing of the `lifeAddLook` that caused it (which always emits) | 18 of 23 kinds had no producer condition | REVIEW_game-truth M3, REVIEW_rules-and-clarity M6: six rules filter by thing, and LIFE saw zone kinds only. |
| D-73 | **The PIECES count**: n = the group's pieces in the zone, or that used the thing within 4 s, emitted at each new high in a visit; a cut inside a zone emits that zone's REACT as PIECES at once; the cut squishy's group leaves the non-Hand-tool quiet 1 s after the swipe | n undefined; a zone entry needed a crossing | REVIEW_game-truth M2, REVIEW_code-truth minor 14: C6 and the other eight "bits" quests could not register. |
| D-74 | **A RIDE state**: a squishy the player set on a ride stays 20 s (or to the end of its joint moment, or a touch), with a star bubble at P1 | the ride wish only | REVIEW_game-truth M6: three seconds after release LIFE could walk off the rocker. |
| D-75 | **Snuggle and peekaboo are behaviours**: S07 gathers 3 or more idle squishies into a row (one mover at a time); S13 uses two peek spots left and right of the thing as the camera sees it | detections with no driver | REVIEW_game-truth M7: R8's gift needed luck; the back-band rocks and logs put "behind" outside LIFE's targets. |
| D-76 | **Rings**: a pile counts for a ring thing when any napper's centre is inside it ("one curls up inside, friends nap against it"); B06 enters by a gap-mouth waypoint; a ring's clear opening is at least 1.35 m | "a pile of 3 fits" | REVIEW_game-truth M8, REVIEW_code-truth minor 1: the clear inner radius (0.81 m) holds two bodies only at R 0.405 or under. |
| D-77 | **Keyboard routes without taking Tab**: Tab stays the browser's; the party is one Tab stop (a toolbar of focus proxies, roving tabindex, [ and ] inside it); Enter opens the wish card or the name tag popover and reads a showing bubble; the popover's "Tap it yourself" taps a switch, flicks a ball or pokes a thing a tap swings (revision 4, D-93) by the same path as a pointer; K is derived per clause from a producer table | Tab and [ ] move the party focus; K tags by hand | REVIEW_rules-and-clarity B1 and M1, REVIEW_game-truth M9: the S1 gift finale C8 had no keyboard path, and Tab would have trapped focus (WCAG 2.1.2). |
| D-78 | **Only completable quests are shown.** A quest whose clause needs an unshipped place or a thing kind no shipped place has is hidden (and skipped by the tracker); a finale is shown once its chapter can reach 5 shown main quests; so Friends Everywhere's X4, X5, X7, X8 and X9 wait for S2, and its other quests count from S1 | its place quests "complete as places arrive" | REVIEW_game-truth M10, REVIEW_rules-and-clarity m8: in S1 only 4 of its 7 main quests were possible. |
| D-79 | **Autonomy off still completes the Journal**: a player-asked use ("Go play with...") and a ride the player set up still move that one squishy; a by-SELF clause accepts a by-PLAYER event recorded while autonomy was off; a quest still blocked shows "Needs: Squishies move on their own" and the tracker skips it | autonomy off = no motion at all | REVIEW_game-truth M12: Hearthlog's finale could not open with it off. |
| D-80 | **Every reaction cell carries a real channel** (a pose target, a render pose, a look and its level, a particle preset, a sound id or a behaviour id); DT-06 counts only cells with one; the cabin's "turn round" became "hops back from the heat when golden" | words with no mechanism | REVIEW_game-truth M13. |
| D-81 | **Tunes**: the Music Box plays 8 bars (29.1 s) at most once per 40 s and a second tap stops it; the kettle whistles 1 bar (3.6 s) every 45 to 90 s, never within 60 s of a Music Box tune; with no input, tunes sound at most 20% of a cabin visit (AU-14) | an 8-bar kettle tune every 30 to 50 s | REVIEW_game-truth M14: 58 to 97% of the time start to start. |
| D-82 | **"Kind" means family in every player line**, and the Journal shows the family name (`MATERIAL_FAMILIES[f].name`, already the Hoard's words) on every page and tile | "kind" for species in two lines | REVIEW_rules-and-clarity M4. |
| D-83 | **SUPERSEDED by D-97 (owner, 2026-11-19: Float floats everyone everywhere; see the end of this file).** **The Float rule**: Float works at Home with one squishy out; while it is on, the shell binds no PropWorld (Home's things are parked, not drawn) and LIFE issues no motion; with more than one out, or in any place, the shell forces gravity at run time (the saved setting is never changed), shows "Here your squishies stand on the ground." once a session, and never calls `setFloatMode(true)` | PH-21 "with a PropWorld bound, gravity = false is ignored" (from S0 a PropWorld is always bound at Home); P12's "autonomy paused" | REVIEW_code-truth M7, REVIEW_rules-and-clarity m11: three rules disagreed and Float died at Home. |
| D-84 | **Who the feedback belongs to**: the quest-complete haptic and `registerFx` only when the event that completed it was by PLAYER (otherwise the stamp sound is an auto UI sound with no haptic); "the player is touching" is a finger, a grab or a carry, never a lock alone; B08's emote and voice go through the attention budget as P1 | a haptic on every quest moment; HELD (with locks) silencing the party | REVIEW_game-truth M11 and m8, REVIEW_rules-and-clarity M2 and M3. |
| D-85 | **The motion gate's floor holds one awake whole and every sleeper, and a ride moment has its riders' allowance** (revision 4). unitCap = max((B / F - 0.20) / 0.87, 1.0 + 0.03 x (the tier's wholes cap - 1)): the floors are 1.06 / 1.09 / 1.12, so at F = 4 unitCap is 1.06 / 1.49 / 2.64 (compared with a 0.001 tolerance). The riders the player set on a ride are the player's bodies: while their ride moment runs (S10 teeter, S11 push), the start test and the over-budget rule add the riders' units to unitCap, so S11's one pusher may wake; at most two awake wholes come of it (a ride seats at most two, S10 wakes nobody, S11 is one rider and one pusher), which PF-06 bounds. Where a boop's two bodies and their touching pair do not fit (low and med at F = 4), S03 is a **soft boop**: the last centimetres at 0.04 m/s (the target stays asleep), the target's wobble a render wiggle | "a sleeping whole costs 0 in the start test"; drop C3, L9 and U4 from Q4's low and med promise (both CONFIRM CT-B2's options) | CONFIRM CT-B2 and N4: with the floor at 1.0, waking one of n sleeping wholes gives 1.0 + 0.03 (n - 1) > 1.0, so LIFE froze on low with 2 or 3 out, and PF-02's own "one awake, two asleep" (1.06) was over the cap; a rider on a hinge prop never sleeps (the rest test needs a static face, 8.6), so S11's pusher needed about 2.0 units against 1.0 and 1.49. A sleeper's cost is real (about 0.02 ms, PHYS map 4), so it stays in the units and the floor rises by exactly what the other wholes cost asleep; hiding C3, an S1 main quest, on low and med phones would hide a cabin quest from most players. |
| D-86 | **`auto` counts only the player's hands** (revision 4): a land, a prop bump or a body bump is `auto` unless the player is touching the body (for a body bump: either body) with a finger, a grab or a carry, or threw it since its last landing. A lock alone never counts here; it still makes the locked body HELD for its own brain and for the touch gate | count a lock as HELD for `auto` (revision 3's contract wording) | CONFIRM CT-B1 and N5: a LIFE body bumping a locked body nobody touches (LOCK.md 1 allows walking away) gave a non-`auto` bump, which reached `feedback.handle` and `haptics.pop()` (feedback.ts 150): autonomy buzzed the phone, against L7 and D-84. |
| D-87 | **Home's corral bounds hold every slot; Home's LIFE targets lie between framed points** (revision 4). `setBounds` at Home gets the smallest rectangle (corner radius 0) that holds `visibleTable` and the body of every slot in use plus 0.05 m, recomputed when the party or the frame changes, never from autonomy; LIFE's targets at Home are points on a segment between two of its **framed points**: the home slots of the characters out (`lifeSetHome`) and the use spots of the things that have arrived (D-88), so no shrink and no camera model are needed in the shell or LIFE | revision 3: the visible table shrunk by R + 0.2 m for both; the confirmer's fix: the union for `setBounds` and the union shrunk by R + 0.2 m for LIFE | CONFIRM CT-M8. My script (`pg_fix4/homebounds.mjs`): the revision 3 rule left a slot centre outside the corral in all 100 cases (n 1 to 5, both frames, 10 scales; worst 1.69 m); the union shrunk by R + 0.2 m is empty for one body on 390 x 844 (the table is 0.78 to 1.22 m wide, the shrink needs 1.20 to 1.65 m) and on 1280 x 800 with 1 or 2 out puts the body's top under the top HUD over 22 to 66 of 121 sample points of its back part. The centres at which a whole body is in view form a convex set (each corner inside each inset line is a half-plane, and the felt is a disc), so every point between two framed points is in view (`standarea.mjs`). |
| D-88 | **Home's thing spots are laid**, one per thing per frame with the smallest party from which it shows (`Spot.fromN`, every one at 3 or fewer, so every tier shows every thing); the Keepsake Shelf is 1.2 x 0.45 x 0.30 m with two rows of ten; Lamp Warmth is r 1.2 m; each thing's use spot has a whole body in view (PLACES 4.1) | revision 3: rules without numbers | CONFIRM GT-B2: only the Felt Ball had spots. My search (`pg_fix4/homespots.mjs`, cross-checked by the earlier fixer's `pg_fix3/check2.mjs`: every spot "ok") under DT-01's Home row, the in-view rule from the arrival party to 5 at every scale, a "seen" rule (the top centre not behind a slot body or another thing), no thing over 0.4 m tall in front of the front row, and a usable use spot (`usespots.mjs`, `lampglow.mjs`). The 1.8 m shelf did not fit both frames with the others. |
| D-89 | **LIFE receives its place**: `lifeSetPlace(w, placeIdx, visit, def, layout, bodyScale)` with the loaded PlaceDef, the layout in use (0 wide, 1 tall) and the body scale (Home's spots are in slot units), on travel (a new visit: visit-scoped state resets) and on a re-lay after a rotation (the same visit: nothing resets); `lifeSetHome(w, slot, x, z)` gives a character's home slot at Home | an index only (revision 3) | CONFIRM N1: D-69 put each PlaceDef in a lazy module that pure, synchronous LIFE cannot import, and the snapshot has no bounds, layout or spot field, so LF-06 could not be built and "the snapshot's place bounds" named no member. LIFE imports the PlaceDef type only (erased), so L1 holds. |
| D-90 | **Use spots are exempt from LIFE's shrink**: the R + 0.2 m shrink applies to free targets (B03 wander, B11 come back); a thing's use spot, its peek spots, a ring's gap waypoint, a swing's push spot and a ride's rider spots need only lie inside the bounds, with a body of R 0.625 there clear of every wall and every other collider (DT-01) | DT-01 checks use spots against the bounds shrunk by R + 0.2 m for the largest R | CONFIRM N2: the tall layout's shrunk half-width is 0.425 m for R 0.625, so no side-strip thing could be used (the Snug Basket's centre is at x 1.05); a body centred inside the bounds is never corralled (the corral acts only past their edge, softbody.ts 1609), and DT-01's body clearance keeps it off the walls. |
| D-91 | **Rides stay inside the bounds, and the corral leaves a rider alone**: DT-01 checks a rider's whole path (a swing's arc, a seesaw's rider spots) inside the bounds, a rider of R 0.625 on it clear of every wall and 0.625 m from every collider, and a swing's push spot (the end of its arc plus 1.3 m) with room for a pusher of R 0.625; physics turns the corral off for a body supported by a moving prop; the cabin is re-laid in both layouts (PLACES 4.2) | one of the two alone (the confirmer's either-or) | CONFIRM N3. My check (`pg_fix4/cabin_final3.mjs`, the seat's centre sweeping 1.4 sin 30 = 0.70 m): the revision 3 tall rider reached z -3.58, 0.58 m past the bounds and 0.45 m into the back wall; the wide rider of R 0.625 at z -1.85 reached 0.075 m into the back wall, and its only free push spot was 0.35 m from the kettle. DT-01 then proves the paths; the corral rule keeps a rider tossed near the edge from being dragged off. |
| D-92 | **The life chunk is re-budgeted from measured data bytes, the five play-time UI modules are named, and an overflow rule says what moves** (14.3): the life chunk 150 KB (its data measured on stand-ins at 41.5 KB as objects, 29.2 KB packed; `wishes.ts`, the moments queue, the party toolbar, the name-tag popover and the Snap shutter and preview, about 15 KB, statically imported by the LIFE host), the away chunk 90 KB (my estimate 44 to 66 KB), the total by caps 1990 KB; over a cap a lane packs, then moves into a lazier named chunk; over 2000 KB the place that opens last ships `shipped: false` | keep 110 KB and hope (the data alone is 2.6x its 16 KB estimate); raise the total past D9 | CONFIRM CT-M1: the 16 KB data share was low, five UI modules belonged to no named chunk (T1 fails on those), and nothing said what moves when a chunk or the total goes over. |
| D-93 | **"Tap it yourself" reaches every thing a tap moves or switches**: every switch (M14), every ball (M13) and every thing a tap swings (the Shake Pine's branch, chimes, bells, crystals and lanterns, a seesaw end, a swing seat; a thing of several parts taps its next part in order), each by the pointer's own path, by PLAYER | mark I4 as not K | CONFIRM RC-B1: I4's Shake Pine is neither a switch nor a ball and no behaviour bumps its trunk at 0.3 m/s, so I4 had no keyboard route while tagged K; a keyboard player should be able to do whatever a pointer tap does. |

---

## 3. What the owner may want to veto (each with the cheap way to change it)

| # | Decision | The cheap change |
|---|---|---|
| V1 | Every new name (places, things, keepsakes, chapters, quest titles) | edit the `name` and text fields in `src/data/places.ts` and `src/data/journal_text.ts`; ids are append-only and stay; DT-02 re-screens |
| V2 | Nine places beyond Home (more than the three asked for) | set `shipped: false` on a place: the unlock rule skips it and its chunk is never imported |
| V3 | The cabin first, the beach in S2 | swap the slice order in section 15 (all data exists); the beach needs S2's water physics first |
| V4 | The size budget (first load 1300, delta 70, the life chunk 150, total 2000 = D9's ceiling, 45 per place, away 90, screens 45 KB; revision 4, D-92); a tenth place beyond these nine needs the total raised past D9's 2000 KB; over the total, the place that opens last ships `shipped: false` (14.3) | the numbers in the `sizeBudget(...)` call in `vite.config.ts` (task T1) |
| V5 | Character caps (wholes 3 / 4 / 5, pieces 4 / 6 / 6, characters 6 / 8 / 10); the awake budget and movers follow from the measured phone factor (D-61: at F = 4, one mover at a time on low and med, two on high) | `MAT_LIMIT` (mat.ts 22), `MAX_PIECES` (cut.ts 38), `CHAR_CAP` in `src/life/attention.ts`; the awake budget only by measurement (PF-00), never by hand |
| V6 | **Rewards that touch the economy: 5 gift squishies for life** (Common or Uncommon, at most 1 a day) | `GIFT_LISTS` in `src/data/quests.ts` (an empty list makes that finale keepsake-only); never a capsule without re-running `sim_economy.ts` |
| V7 | **Autonomy on by default** ("Squishies move on their own") | `optionalDefaults` autonomy in `src/core/settings.ts` |
| V8 | Hops at most 3.5 cm in S1 | `HOP_VY_CAP` (physics) and `GAITS` (life.ts) after PH-01 passes |
| V9 | Water at most 0.30 m; water-filled squishies wade, they do not float | `FAMILY_REACT` densities and the pool surfaces in places.ts; DT-10 regenerates the float table; deeper water needs the eye-line rule (CS-07) changed too |
| V10 | No heart icon; affection is "snug" (a deviation from D2's example list) | one row of `EMOTE`, but a heart bubble would read as the Hoard's "hearted" (DESIGN 5.6) |
| V11 | Friendship words Met / Friends / Close friends | text in `journal_text.ts` |
| V12 | Places open by stamps only, no daily limit | `stampsToOpen` in places.ts |
| V13 | The party stays when you cut (today a cut empties the mat) | one flag in `src/shell/cut.ts` |
| V14 | The first capsule's newcomer stays out | one flag in the party manager |
| V15 | Bubbles in photos by default | the `bubblesInPhoto` default |
| V16 | "Place sounds" is its own slider | drop the setting; the ambience follows Music |
| V17 | The Journal's gifts are Practice-shelf only until a host op exists | needs the server op `wh_claim_journal_gift` (task T10) |
| V18 | Fizzwell Tub (a bathtub place) | `shipped: false` |
| V19 | Journal tab names (Stamps, Squishies, Friends, Keepsakes); "stamp" is the Journal's unit, so FUN 1's queued Stamp tool needs another name before it ships (task T12, for example "Prints") | text |
| V20 | The Float setting is overridden in places and with more than one squishy out (D-83; it still works at Home with one out) | no cheap change: the hover pulls to the world origin (softbody.ts 1918-1926); it would need a physics change |
| V21 | A tall (portrait) layout per place (D-68): portrait phones see a narrower, deeper version of each place | drop the tall layouts (`PlaceDef.tall`): portrait phones then frame the wide layout whole, with squishies about 57 px wide |
| V22 | Friends Everywhere's place-spanning quests and its finale (the Friendship Frame and a gift) wait for S2 (D-78) | none in S1: with Home and Hearthlog only, 4 of its 7 main quests can be done |

---

## 4. Architecture

```
            src/data (pure data)                       src/core/quests.ts (pure reducer)      src/collection (journal state, store, gift grant)
  places.ts  life.ts  quests.ts  journal_text.ts (lazy)          ^  applyPlayEvent                ^  feedPlay / claimGift / journal()
        |        |        |                                       |                                |
        v        v        v                                       |                                |
  src/life (pure: traits, brains, social, attention, voice plan) --LifeEvents--> src/shell (hosts) --PlayEventRing--> quest host
        ^ LifeSnapshot                    | LifeIntents                 |  stage.* (render)  audio.* (voices, ambience, props)
        |                                  v                             v
  src/shell life host  <--  bodies + PropWorld (src/physics: props, zones, drivers, sleep)  -->  src/render (place look, props, emotes, faces, poses)
```

**One frame** (`game.ts simStep` 548-562, with the PLAYGROUND steps in order; the rAF loop and `DebugHook.step` both run it, so all of it is
deterministic under the harness): (1) gestures, `flushPendingUps`; (2) **LIFE act**: apply due intents through the one arbiter (finger > cut and
ceremony > LIFE: LIFE travels only by `scootTo`, which physics pauses under a touch and which yields to `moveTo`; cut steering and ceremonies keep
`moveTo`, D-63); (3) `propWorld.beginFrame()`, `bodies.step(dt)` (collide with cached bound radii, sleeper pairs
skipped, then step), `propWorld.endFrame(dt)`; (4) `drain()`: player-caused SoftEvents to `feedback.handle` **with their source body** (per-body
pitch and pan) and to `collection.feed` (never `auto`, never `prop`); **every `auto` event** (lands, prop bumps and body bumps, D-62) to the
attention wiring instead (budgeted soft sounds, never a haptic or a shake); all of them into the play ring; (5) **LIFE sense and think** for each
character whose 0.1 s boundary passed: fill the snapshot in place, `lifeStep`, the attention filter, express (stage, audio), LifeEvents into the
ring; (6) timers, feedback, cut, capsules, ceremonies; (7) **quest host**: drain the ring into the reducer through the collection, queue moments; the
journal store saves batched (at most once per 2 s, gift steps unthrottled). Steps 2, 5 and 7 are their own lines in `simStep`, never
`game.onStep` hooks (D-58: those hooks are UI listeners run after the capsules and ceremonies in registration order, SHELL_4.md "Seams for
PLAYGROUND" 1). Those lines live in the first load and call into the life chunk once it has landed (D-69); until then Home is today's toy and
the ring keeps the player's events (touches, capsules) for the quest host to drain when it arrives.

## 5. Lanes and file ownership (DIRECTION D12; ports from SESSION3)

| Lane (brief) | Owns | Port | Report |
|---|---|---|---|
| DATA (PG_DATA) | `src/data/places.ts`, `src/data/life.ts`, `src/data/quests.ts`, `src/data/journal_text.ts`, one `src/data/place_<id>.ts` per place (lazy, D-69); `_harness/name_gate.ts`, `_harness/probe_pg_data.ts` | none (node) | `_handoff/reports/PG_DATA.md` |
| PHYS (PG_PHYS) | `src/physics/**` (softbody.ts additions, new `props.ts`); `_harness/probe_playground.ts` | 5368 | `PG_PHYS.md` |
| LIFE (PG_LIFE) | `src/life/**` (traits, world, brain, social, attention, voice, wish, step); `_harness/probe_life.ts`, `_harness/probe_life_imports.ts` | 5369 (only if a browser look is needed) | `PG_LIFE.md` |
| RENDER (PG_RENDER) | `src/render/**` (place host, `places/*.ts`, props kit, emotes, marks, water, faces, poses, looks); `_harness/browser_render.mjs` new sections, `_harness/renderview/**` | 5364 | `PG_RENDER.md` |
| AUDIO (PG_AUDIO) | `src/audio/**` (creature, ambience, props, `places/*.ts`, chain, engine, music additions); `_harness/probe_audio.mjs`, `_harness/audioview/**`, a new `_harness/audioview/life_checks.mjs`, a new node probe `_harness/probe_chatter.ts` (AU-10) | 5367 | `PG_AUDIO.md` |
| QUESTS (PG_QUESTS) | `src/core/quests.ts`; `src/collection/journal.ts`, `journal_store.ts`, and the PLAYGROUND additions in `constants.ts`, `ghost.ts`, `types.ts`, `index.ts` and `copy.ts` (the Hoard's "Gift" origin line for `jg-` ids); `_harness/probe_quests.ts`, `_harness/probe_journal.ts`, `_harness/probe_pg_economy.ts` | none (node) | `PG_QUESTS.md` |
| SHELL (PG_SHELL) | `src/shell/**` (life host, attention wiring, party, events bus, quest host, places and travel), `src/ui/**` (journal, travel, tracker, wishes, moments, gift card, settings rows), `src/input/**` (keyboard), `src/core/settings.ts`, the Settings members of `src/contracts.ts` (11.9); `_harness/browser_shell.mjs` new sections, `_harness/shellview/node_checks.ts` new sections | 5366 (prod-build uses PORT + 1: pick a port whose +1 is free) | `PG_SHELL.md` |
| VERIFY (PG_VERIFY) | nothing in src; its own scratch scripts; `_handoff/reports/PG_VERIFY_<lane>.md` | 5370..5377 | per charter |

**Starting rules:** PG_DATA, PG_LIFE, PG_QUESTS, PG_AUDIO (creature voices) and PG_RENDER (emotes, faces, poses in the renderview) can start now:
nobody else is in those files. **PG_PHYS starts only after** the queued physics work (the checkpoint-47 re-verification, then physics round 3: the
grab and carry floor, LOCK and multi-pull, the cut neck swell) is verified, in one physics owner's hands. **PG_SHELL starts only after** SHELL-4 is
verified and the UI overhaul has landed its tokens and components (the SHELL-4 engineer is in `src/shell`, `src/ui`, `src/input` and
`_harness/browser_shell.mjs` today).

## 6. The data model (`erasableSyntaxOnly`: no enums, `as const` objects; flat modules in `src/data`, probe_genome reads it non-recursively)

```ts
// src/data/places.ts (the life chunk, D-69: the id tables, the ten names, stampsToOpen, shipped, MECH_RANGES and the shared types; each
// PlaceDef lives in its own lazy module src/data/place_<id>.ts, flat in src/data as probe_genome requires, loaded with that place)
export const PLACE_IDS = ['home', 'hearthlog', 'ripple', 'frostbell', 'rainleaf', 'fizzwell', 'cogwhistle', 'lanternroof', 'echohollow', 'cloudloft'] as const; // append-only: idx is saved
export const THING_IDS = ['feltball', 'musicbox', 'snoozerug', 'warmlamp', 'keepsakeshelf', 'bouncepad',              // Home 0..5
  'hearth', 'rockerboard', 'yarnball', 'pillowswing', 'snugbasket', 'kettle',                                           // Hearthlog 6..11
  'rockpool', 'bobring', 'driftlog', 'shellchimes', 'pebbleball', 'sandmound',                                          // Ripple 12..17
  'icepond', 'glideramp', 'steampool', 'iciclebells', 'snowdriftnest', 'snowball', 'shakepine',                         // Frostbell 18..24
  'splashspots', 'leafteeter', 'mossbouncer', 'dripleaf', 'steppingstones', 'seedpod',                                  // Rainleaf 25..30
  'bathwater', 'tap', 'swirlride', 'soapslide', 'spongeraft', 'bubblepatch',                                           // Fizzwell 31..36
  'spinningcog', 'windupkey', 'springplate', 'magnet', 'steelmarble', 'tickclock', 'littlebell',                       // Cogwhistle 37..43
  'lanternline', 'vanedisc', 'hammock', 'chimneycorner', 'moondish', 'starscope',                                      // Lanternroof 44..49
  'crystals', 'glowpool', 'stoneslide', 'mossbed', 'echostone', 'humrock',                                             // Echo Hollow 50..55
  'puffpads', 'updraft', 'kiteswing', 'sunbowarch', 'cloudnest', 'cloudball'] as const;                                // Cloudloft 56..61 (append-only)
export type PlaceId = (typeof PLACE_IDS)[number]; export type ThingId = (typeof THING_IDS)[number];
export const MECH = { block: 1, bar: 2, mound: 3, ring: 4, ramp: 5, pool: 6, seesaw: 7, swing: 8, turntable: 9, chime: 10, pad: 11, floater: 12, ball: 13, switch: 14 } as const;
export const ZONE = { water: 1, current: 2, wind: 3, updraft: 4, magnet: 5, warm: 6, cold: 7, wet: 8, echo: 9 } as const;
export const MARK = { print: 1, trail: 2, dust: 3, dent: 4, glow: 5 } as const;
export const PROP_SOUND = { ball: 1, creak: 2, chime: 3, splash: 4, crunch: 5, crackle: 6, boing: 7, bell: 8, tick: 9, kettle: 10, rustle: 11, whoosh: 12 } as const;
export interface Area { readonly shape: 'disc' | 'box'; readonly x: number; readonly z: number; readonly r?: number; readonly hx?: number; readonly hz?: number; readonly yaw?: number }
export interface GroundMods { readonly grip: number; readonly glue: number; readonly peel: number; readonly drag: number }
export interface PatchDef extends Area { readonly id: string; readonly mods: Partial<GroundMods>; readonly ice?: boolean; readonly nap?: boolean; readonly mark?: number; readonly markLifeS?: number }
export interface ZoneDef extends Area { readonly id: string; readonly kind: number; readonly strength: number; readonly surfaceY?: number; readonly ramp?: number;
  readonly wave?: { readonly amp: number; readonly everyS: readonly [number, number] }; readonly flow?: readonly [number, number];
  readonly gust?: { readonly everyS: readonly [number, number]; readonly forS: number }; readonly shower?: { readonly onS: number; readonly offS: number }; readonly switchable?: boolean }
export interface ThingDef { readonly id: ThingId; readonly place: PlaceId; readonly mech: number; readonly x: number; readonly z: number; readonly yaw: number;
  readonly size: readonly [number, number, number];            // per mech: box half sizes; capsule [r, TOTAL length including both caps, 0]; [ringR, segR, gapDeg]
  readonly mu: number; readonly p: Readonly<Record<string, number>>;   // mech parameters, ranges in MECH_RANGES (DT-01)
  readonly ride: boolean;                                       // a ride the player sets up (PLACES P3)
  readonly zone?: string; readonly patch?: string;              // the zone and the ground patch this thing owns (a REACT there carries this thing, D-72)
  readonly switch?: 'zone' | 'motor' | 'tune' | 'shower' | 'echo' | 'fire' | 'comet';
  readonly notes?: readonly number[]; readonly useSpot?: readonly [number, number];
  readonly peek?: readonly [number, number, number, number];    // S13's two peek spots, left and right of the thing as the camera sees it (D-75)
  readonly push?: readonly [number, number];                    // a swing's S11 push spot: one end of the seat's arc plus 1.3 m, inside the bounds (D-91)
  readonly fromN?: number;                                      // Home only: the smallest party from which the thing shows in this frame (D-88)
  readonly verb: number; readonly icon: number; readonly look: string; readonly sound: number;
  readonly arrives?: { readonly after: string } }               // mech 0 = a patch or zone thing with no collider (the Ice Pond, the Updraft)
export interface Spot { readonly x: number; readonly z: number; readonly yaw: number; readonly use?: readonly [number, number]; readonly peek?: readonly [number, number, number, number];
  readonly push?: readonly [number, number]; readonly fromN?: number }   // the tall layout's (or Home's TALL frame's) spot of one ThingDef
export interface LayoutDef { readonly bounds: Area & { readonly round: number }; readonly walls: readonly Area[];
  readonly spawn: readonly (readonly [number, number])[] | 'matLayout';
  readonly things: readonly Spot[]; readonly zones: readonly Area[]; readonly patches: readonly Area[] }   // one per ThingDef, ZoneDef, PatchDef, same order
export interface PlaceDef { readonly id: PlaceId; readonly idx: number; readonly name: string; readonly coined?: readonly string[];
  readonly stampsToOpen: number | 'firstWish' | 0; readonly shipped: boolean; readonly night: boolean;
  readonly ground: GroundMods & { readonly mark: number; readonly markLifeS: number }; readonly patches: readonly PatchDef[]; readonly zones: readonly ZoneDef[];
  readonly things: readonly ThingDef[]; readonly bounds: Area & { readonly round: number }; readonly walls: readonly Area[];
  readonly pad: readonly [number, number, number]; readonly spawn: readonly (readonly [number, number])[] | 'matLayout';   // Home: 'matLayout' (D-67)
  readonly tall: LayoutDef;                                     // the portrait layout (D-68); the fields above are the wide layout
  readonly unit?: 'slot';                                       // Home: thing spots are in slot units, x bodyScale like stage.matLayout (D-67);
                                                                // Home's WIDE frame is the PlaceDef's own fields and its TALL frame is `tall` (D-88)
  readonly camera: { readonly yawRange: number; readonly pitch: readonly [number, number]; readonly zoom: readonly [number, number] };
  readonly light: string; readonly sky: string; readonly weather: string; readonly ambience: string; readonly music: string;
  readonly ceremonyDim: number; readonly signature: number; readonly finale: number;
  readonly reactions: readonly Reaction[] }                     // the channel of every cell of PLACES 4 (D-80); section 3's defaults fill the rest
export interface Reaction { readonly target: number; readonly family: number; readonly tag: 'P' | 'L' | 'S' | 'B'; readonly chan: number; readonly arg: number }
  // target: a thing index or 100 + a zone index; chan: a CHANNEL id (pose target, render pose, look, particle, sound, behaviour); arg: its level or id
export const PLACE_INFO: readonly Pick<PlaceDef, 'id' | 'idx' | 'name' | 'coined' | 'stampsToOpen' | 'shipped' | 'night' | 'sky'>[];   // Travel, the reducer
export const THING_KINDS: Readonly<Record<PlaceId, number>>;   // a bit per wish glyph kind (ball, bell, droplet, note, flame, sun) each place has (QUESTS 8)
export const MECH_RANGES: Readonly<Record<number, Readonly<Record<string, readonly [number, number]>>>>;
export function loadPlaceDef(id: PlaceId): Promise<PlaceDef>;   // a lazy import of src/data/place_<id>.ts; Home's is in the life chunk

// src/data/life.ts
export const SALTS = { trait: 0x7a11fe5d, motif: 0x2545f491, duet: 0x3c6ef372, life: 0x4bd6e3b1, wish: 0x6a09e667, chatter: 0x1b873593 } as const;
export interface FamilyReact { readonly density: number; readonly soakedDensity: number; readonly soakRate: number; readonly iceGrip: number; readonly catch: number;
  readonly bounceGain: number; readonly padHoldS: number; readonly warmPose: number; readonly coldSpeed: number; readonly shiver: boolean; readonly toast: boolean;
  readonly printDepth: number; readonly printLifeS: number; readonly flavour: number; readonly mechPrefs: readonly number[] }
export interface Gait { readonly name: string; readonly squash: number; readonly vyS1: number; readonly vyS2: number; readonly stepsPerS: number; readonly glide: number;
  readonly hops: boolean; readonly memoryGated: boolean; readonly maxHopsPerMin?: number }
export interface SpeciesLife { readonly place: PlaceId; readonly thing: ThingId; readonly friend: SpeciesId }
export const FAMILY_REACT: Readonly<Record<MaterialFamilyId, FamilyReact>>; export const GAITS: Readonly<Record<MaterialFamilyId, Gait>>;
export const SPECIES_LIFE: Readonly<Record<SpeciesId, SpeciesLife>>;           // `satisfies Record<SpeciesId, SpeciesLife>`: a missing species fails tsc
export const DEFAULT_REACTIONS: per mechanism or zone kind, per family: { tag, chan, arg } (PLACES 3; a place's own cells are in its PlaceDef, D-80);
export const CHANNEL;                                            // pose target, render pose (lean, sway, wiggle, shiver), look, particle, sound, behaviour
export const REACT_TRIGGERS: readonly { kind: number; cond: number; arg: number; once: 'visit' | 'event'; cooldownS: number; thing: 'zone' | 'patch' | 'source' | 'none' }[];
                                                                 // LIFE.md 4.2: every REACT kind's producer condition (D-72; DT-15)
export const EMOTE, EXPR, SYL, TOUCH, INTENT, LIFE_FLAG, LIFE_EV (the id tables of contracts.ts PLAYGROUND); BEHAVIOURS; SOCIAL; TRAIT_WORDS; BUBBLE_WORDS;
export const SCRIPT, WISH_KIND, LOOK, LOOK_RATES (LIFE.md 3.1 and 4.1; TOUCH includes SQUEEZE_1S, STRETCH_06, CUT and TOSS_HARD, LIFE.md 12;
  LIFE_FLAG includes RIDE, D-74).

// src/data/quests.ts (the life chunk: rule numbers for all 110 quests and Home's text)
export const EV, REACT_KIND, SOCIAL_KIND, USE_VERB, WISH_STATE, FACT (append-only id tables);
export interface Clause { readonly ev: number; readonly sub?: readonly number[]; readonly place?: number | 'away'; readonly thing?: number; readonly mech?: number;
  readonly family?: number; readonly minN?: number; readonly by?: 0 | 1; readonly count: number;
  readonly distinct?: 'species' | 'family' | 'thing' | 'part' | 'pair' | 'place'; readonly sameSpecies?: true; readonly v?: number }
export interface QuestDef { readonly idx: number; readonly id: string; readonly chapter: number; readonly kind: 'main' | 'finale' | 'bonus'; readonly clauses: readonly Clause[];
  readonly keys: 'K' | 'K*'; readonly playerClause?: number }    // QU-07: index of the player-caused clause on a gift finale
export const QUESTS: readonly QuestDef[]; export const CHAPTERS; export const KEEPSAKES; export const GIFT_LISTS: Readonly<Record<number, readonly SpeciesId[]>>;
export const HOME_TEXT; // titles and hints of chapter 0 (the tracker needs them before any lazy chunk)
// src/data/journal_text.ts (lazy: the screens chunk and the away chunk import it)
export const QUEST_TEXT, THING_TEXT, KEEPSAKE_TEXT, FACT_LINES, FAMILY_LINES, WISH_LINES, GIFT_LINES;
  // FAMILY_LINES: the F4..F7 line of each family (water, warm, cold, ground ways: 12 x 4), from PLACES 3. The per-thing cells of PLACES 4 are
  // design text: their channels ship in the PlaceDefs (D-80), their words do not (D-69), so the only reaction words a player reads are these.
```

## 7. The contract members (applied to `src/contracts.ts` on 2026-11-15; typecheck clean)

All in one PLAYGROUND block at the end of the file, by interface merging, so no existing member changed (`git diff --stat`: 357 insertions, 0
deletions, then 4 more insertions for `memoryBusy`). Every member is optional and documented in the file. **Revision 4 adds and renames no
member**: it rewrites four doc comments (`SoftEvent.auto`, D-86; `setBounds`, D-87 and D-91; `scootTo` on a floating body; `visibleTable`'s exact
box, D-87) and the block's header; LIFE's new `lifeSetHome` and the wider `lifeSetPlace` are LIFE values, not contract members (D-89).

| Interface | Members |
|---|---|
| `SoftEvent` | `auto?` (revision 3: on body-to-body bumps too, D-62; revision 4: only a finger, a grab or a carry stops it, never a lock alone, D-86), `prop?`, `other?` (revision 3: the partner's contact slot, D-65) |
| `SoftMetrics` | `asleep?`, `submerged?`, `onProp?`, `airborne?`, `locked?` (LOCK's planned count, declared now because the touch gate reads it), `memoryBusy?` (added by the continuing synthesizer: the host needs it for the snapshot's MEMORY_BUSY flag, and nothing else reported it; typecheck clean after it), `contacts?` (revision 3: a bit per contact slot touching, D-65) |
| `SoftBodyLike` | `mods?` (Float64Array of 8; revision 3: the wake rule and density for every family), `setBounds?` (revision 4: the corral is off on a moving prop, D-91; Home's union, D-87), `setHome?`, `setPropWorld?`, `setSquash?` (revision 3: an identical call is a no-op), `scootTo?` (revision 3, D-63; revision 4: it also glides a floating body), `hop?`, `carryTo?`, `sleepEnabled?`, `wake?`, `sleep?` (revision 3), `contactSlot?` (revision 3, D-65) |
| `PropWorldLike` (new) | `count` (revision 3: the fixed prop order), `propThing`, `propPart` (revision 3, D-64), `poses`, `zoneCount`, `zoneOn`, `beginFrame`, `endFrame`, `setZoneOn`, `setMotor`, `raycast`, `poke`, `drainStrikes` (revision 3: quads with the cause and the striking slot), `setKinematic?`, `stateHash` |
| `AddBodyOpts` | `lite?` |
| `StageLike` | `loadPlace?`, `setPlace?`, `bindProps?`, `setPlayBounds?` (revision 3: the layout in use, inside the safe insets), `visibleTable?` (revision 3, Home, D-67; revision 4: its exact box, D-87), `setObstacles?`, `setBodyGaze?`, `setBodyExpression?`, `setBodyPose?`, `setBodyLook?`, `setHeatPoint?`, `setBodyWater?`, `setBodyAsleep?`, `emoteSlots?`, `emote?`, `clearEmote?`, `emoteScreen?`, `setEmotesInPhoto?`, `stampMark?`, `bodyScreenPoint?` |
| `AudioSettings` | `chatter?`, `ambience?` |
| `SquishAudio` | `creature?` and `prop?` (revision 3: the caller reuses the object, audio keeps no reference), `musicClock?` (revision 3: never in the snapshot), `loadAmbience?`, `setAmbience?`, `musicBox?` (revision 3: the tune lengths and spacing, D-81), `setMusicStyle?` |
| `DebugHook` | `life?`, `quests?`, `travel?` |
| `LifeSnapshot`, `LifeIntents`, `LifeEvents` (new) | the LIFE seam (LIFE.md 12); revision 3: the music fields are deterministic (D-66), the RIDE flag and the touching rule, `zoneThing`, `patchThing`, `thingId` (D-64, D-72), the units' measured weights, `LifeIntents.e` (POSE's fifth argument), the PIECES count in `n2` (D-73) |
| `PlayEventRing` (new) | the shell-to-Journal event ring (QUESTS 4); revision 3: the part index in `v` for USE RING, flag bit 3 (autonomy was off) |
| `Settings` | **not yet**: `chatter?`, `ambience?`, `autonomy?`, `bubbleWords?`, `bubblesInPhoto?` land with `src/core/settings.ts` and `SETTINGS_VERSION` 3 (D-44, 11.9) |

The `PropWorldLike` factory (`buildPropWorld(place: PlaceDef, layout: 'wide' | 'tall', bodyScale: number): PropWorldLike`; `bodyScale` places
Home's slot-unit spots) and the packed layouts (stride per prop and per zone) are physics values in `src/physics/props.ts`; the shell's life chunk
imports it (D-69), not boot. The Collection interface
additions (`journal?()`, `feedPlay?(ring, nowMs)`, `claimGift?(chapter, pick)`, `warmthOf?(itemId)`, and the events `quest`, `fact`, `keepsake`,
`friend`, `unlock`, `gift`) live in `src/collection/types.ts` (the QUESTS lane), not in contracts.ts.

## 8. Physics additions (PG_PHYS; after physics round 3; E-numbers from the PHYS map)

**Order inside the lane:** E9 touch gate, E7 `setSquash`, `scootTo` and `hop`, 8.3 support on prop faces, E10 sleep (with `sleep()`), E3 bounds,
E2 modifiers, `contactSlot`, `other` and `contacts`, E4 the prop pass, E5 `props.ts` (static, hinge, ball, then slider and motor), then S2 water
(E6), then S3 fields. One physics owner, serially (M15).

### 8.1 Ground modifiers (E2)
`mods[0..3]` scale `tableMu`, the glue, `groundDamp` and a now-mutable `dragF` (baked at softbody.ts 766 and applied to the whole velocity at 2658:
ice needs it); `mods[4]` is the density for water, `mods[5]` the field catch, `mods[6]` the pad bounce gain. Written through the Float64Array, never
object fields (the V8 representation rule, softbody.ts 224-230); each eased over 0.3 s; identity = today bit for bit (PH-10 hash rows unchanged at
Home). No stiffness or damping change. **The shell writes `mods[4]` for every family** from `FAMILY_REACT` (a soaked foam lerps to its soaked
density), so the pop dome floats as the float table says. **A write wakes a sleeping body only when a modifier that acts where the body is
changes by more than 0.02** ([0..3] on the ground or a prop face, [4] only in a water zone, [5] only in wind or an updraft, [6] only on a pad);
otherwise it applies at the next wake (a drying foam's `mods[4]` changing every 0.1 s on dry ground never keeps it awake).

### 8.2 Bounds and home (E3)
`setBounds(shape, cx, cz, a, b, round)` adds a place-bounds branch to `matCorral` (softbody.ts 1600-1620): the same dead zone, brake, glide back and
rim bounce, about the place's disc or rounded rectangle; `setHome(x, z)` moves the home spot; shape -1 restores today's corral. The dead zone is the
whole bounds: a centre inside them is never touched. **The corral is off for a body supported by a moving prop** (`onProp` names a hinge or
slider prop: a rider on a seesaw, a swing or a raft), as it is today for a grabbed body and while `moveTo` or `scootTo` acts (revision 4, D-91;
DT-01 keeps every rider's path inside the bounds anyway). **At Home** the shell passes the smallest rectangle (corner radius 0) that holds
`visibleTable` and the body of every slot in use plus 0.05 m, so the corral never moves a body resting at its own slot (D-87).

### 8.3 The prop contact pass (E4) and support on prop faces
- **Where:** once per substep, between the fingertip pass and the table pass (softbody.ts about 2197-2217), on XP, against the bound world's packed
  shapes (sphere, capsule, oriented box), after a bounding-sphere test against the body's cached `bR` (a far prop costs about nothing).
- **Moving props advance per substep** (F#2): substep k sees a moving prop at pose(t0) + v x (k x H), rotation advanced by omega x k x H, as the
  fingertips advance (softbody.ts 2129); surface speed clamps (2.0 m/s for the ball and the swing seat) live in the world.
- **Coulomb friction with the prop's surface velocity**; prop friction = the prop's mu x the family's table-friction ratio.
- **Support (D-11, F#1):** a particle in contact with a face whose normal is within 35 degrees of world up counts toward `near` and `nearMass`, so
  supported gravity, the friction load, `grounded` and the land detection see it; on a face tilted more than 2 degrees, gravity's tangential part
  is kept (a body on a 14 degree ramp slides by its friction; on a flat box top it rests and may sleep).
- **Weight transfer (D-12):** a body supported by a MOVING prop adds bodyMass x g x (its supported share) at its contact centroid to that prop's
  accumulators, every substep. bodyMass = (restRadius / 0.5)^3 x frac (one unit = a default whole).
- **Impulses are mass-scaled (F#3):** the correction a body applies is accumulated x bodyMass / Mtot (Mtot = the particle count, shape.ts 216), so a
  detail-2 twin and a detail-3 body tip a seesaw within 5% and a 1/8 piece tips it an eighth as much (PH-06).
- **Fold limit only while worked (F#4):** prop-touched particles join the fold-limit list only while the contact is worked (penetration over 0.15 x
  mean edge, relative speed over 0.3 m/s, or a moving prop), mirroring the table's `worked` flag (softbody.ts 2227-2229).
- **No tack on props; no strands from props** (F#9): strands when a tacky body leaves a prop are a stage look the shell triggers.
- **Hop from a prop (F#17):** `hop` is allowed when supported by a prop face; on a moving prop the horizontal part is relative to its surface velocity.
- Thin props tunnel between particles: every collider part at least 0.16 m (P2, F#18).

### 8.4 `src/physics/props.ts` (E5; pure; one-frame lag)
Hinge1 (an angle with I, damping, limits and an optional motor), slider1 (an offset with k, damping and the pad's **kick**: when a body lands on a
flush pad its upward speed is set to gain x landing speed, capped by the apex), the free ball (translation, roll damping, a ground contact at y = r,
walls, bounds, the 2.0 m/s clamp, the steel flag for the magnet), motors and switches, strikes (`drainStrikes`, quads with the cause: the player,
a body with its contact slot, or the weather), kinematic shapes for the queued Stamp and Roll tools (`setKinematic`, M9). Integrated once per frame
after every body stepped (`endFrame`). Zero allocation; deterministic; `stateHash`. **Hinge props have no floor contact**: a seesaw board stays
above the floor because DT-01 and `MECH_RANGES` require pivot >= (L / 2) sin(limit) + (t / 2) cos(limit) with the hinge at mid-thickness (the
first cabin rocker, 1.6 m at 12 degrees on a 0.16 m pivot, reached -0.085 m: REVIEW_code-truth M9). A capsule's `size[1]` is its total length
including both caps, here and in the data. The world is built for the layout in use (`buildPropWorld(place, layout, bodyScale)`), with the
props in the fixed order of `PropWorldLike.count` and `propThing` / `propPart` filled; the Felt Ball's bounds at Home are the visible table
(D-67), elsewhere the layout's bounds.

### 8.5 Zones (E6 water in S2; fields in S3)
- **Water as a gravity scale (F#7):** g_eff = g x (1 - f_sub / density), f_sub the submerged share of the bounding sphere from the depth at the
  body's centre (with the zone's 0.4 m edge ramp); g_eff >= 0: the supported fade applies as today; g_eff < 0: it acts fully (the body rises), with
  drag 2.5 /s relative to the water. Whole body only (no per-particle buoyancy). The slosh push stays float-mode only (softbody.ts 2346): in water a
  water-filled body sloshes through its existing bulge, not a push (C's claim that it pushes in water is wrong, K4).
- **Current:** moves floating bodies and floaters only (at most 0.15 m/s).
- **Wind and updraft (F#8):** act only on a body that is airborne or floating (`metrics.airborne` or g_eff < 0); updraft = gravity x (1 - 0.4 x catch)
  while airborne in the column; under 0.25 m/s^2 nothing wakes. A grounded body gets LIFE's "hold on" pose instead (B19).
- **Magnet:** a field on props with the steel flag only; bodies are never pulled.
- Warm, cold, wet and echo are flags the shell reads for looks, LIFE and audio.

### 8.6 Sleep (E10; opt-in `sleepEnabled`)
**Rest test:** kinetic < 0.02, |centre velocity| < 0.01 m/s, supported (the table, a STATIC prop face, or floating at rest), no driver, timer or
easing active (the PHYS map 4 list: fingers, grabs, pins and pinHold, carried, moveOn, fold, burst, tremble, neck, fracDur, flatK, tableFoldT, the
tip-fold wake, air bleed, slosh, strands, squash easing), for 0.5 s. **Freeze** X, V, XP, the goal and the accumulators; metrics report asleep.
**Wake** on a finger, grab, nudge, any driver, a gravity toggle, setFrac, setNeck, reset, a mods change, a prop or zone that starts touching it, or
a contact from an awake body **only above 0.05 m/s or a 0.2 x mean-edge push in one substep** (F#5; otherwise the sleeper is fixed for that pair).
**Islands:** bodies in contact sleep together (all pass the rest test, then all sleep). **Memory families (F#6):** sleep when max |MEM - Q| < 0.02 R;
while asleep `memoryStep` runs at 1 Hz; on wake the goal eases over 0.3 s; until then they count as awake in the units. **Never** on a moving prop;
float mode never sleeps. Zero position jump on wake. A sleeping run's state hash differs from a never-sleeping one: re-baseline the hash rows that
turn it on and list them (PH-10). **Shell control (revision 3):** `sleep()` puts a body to sleep at once when it passes the rest test's bounds this
instant (false otherwise); the shell uses it for untouched party members over the awake budget (D-61) and for bodies spawned at rest on travel.
A `setSquash` identical to the one in force is a no-op and never wakes (so a converged pose sent again at 10 Hz lets the body sleep); a `mods`
write wakes only by the rule of 8.1; `scootTo` and every other driver wake.

### 8.7 LIFE drivers and the touch gate (E9, E7)
**LIFE's own travel driver, `scootTo(x, z, speed)` (D-63):** a horizontal rigid glide of the centre like `moveTo` (no momentum, the table carries
the height), eased in and out over 0.12 s, the corral off while it acts (the corral test at softbody.ts 1858 also checks the scoot flag), yielding
to `moveTo`. **It also glides a floating body** (revision 4): the glide stays horizontal and the water zone's buoyancy holds the height, as the
table holds a grounded body's; a current's drift (at most 0.15 m/s) adds to it; as the depth ramps down at the water's edge the body becomes a
sitter and the table takes over, so a floater leaves the water by the same driver (LIFE 5.3, LF-18; PH-15 adds the row). `moveTo` stays the ceremonies' and the cut's (cut.ts 213) and is never touch-gated, so PH-02's "ceremony drivers untouched" holds.
**Touch gate:** at the substep start (softbody.ts 1849-1853), while `fingers > 0 || grabbed || carried || locked > 0`, the LIFE drivers (`scootTo`,
`setSquash`, `hop`) pause and ease out within 0.12 s; ceremony drivers (`moveTo`, `setFold`, `tremble`, `burstOpen`) are untouched. `setSquash` scales the goal GB volume-preservingly in
`frameUpdate` (softbody.ts 2391-2397); refused for putty, mochi and beads while their memory has not converged (it reports `MEMORY_BUSY`). `hop`
nudges with the glue and the peel damping suspended for 10 substeps (softbody.ts 2218, 2275); caps and refusals as the contract says. `carryTo`
lifts the whole body kinematically along an arc (as the carry follows the hand, softbody.ts 1877-1897) and sets it down with no velocity; it emits
no press, grab or snap.

### 8.8 Events
`auto` on every `land`, every prop `bump` and **every body-to-body `bump`** unless the player is touching the body (for a body bump: either body)
with a finger, a grab or a carry, or threw it since its last landing (F#11, C's rule; D-62: a body bump fires above 0.35 m/s, so its intensity is
at least 0.117, and `feedback.handle` buzzes above 0.05, feedback.ts 146-151). **A lock alone never counts** (revision 4, D-86): a LIFE body
bumping a locked body nobody touches gives an `auto` bump (the lock still makes that body HELD for the touch gate and its own brain); `prop` on prop bumps; `other` (the partner's contact slot) on body bumps; land
detection also when the first support after flight is a prop face. `emit` allocates three objects per event (softbody.ts 2696-2699) and keeps
doing so: PH-11 measures allocation over windows in which no event fires, and the event rate limit bounds the rest.

### 8.9 Collide and bump memory (F#12, E13)
`boundRadius` once per body per frame (cached), asleep-asleep pairs skipped before the sphere test; the bump memory (MAX_OTHERS 16 keyed
`bodyId & 15`, softbody.ts 276, 1405) widened to 32 slots keyed by the shell-assigned **`contactSlot`** (D-65), so two partners never share a slot
(PH-19); `SoftMetrics.contacts` reports a bit per slot in contact this frame (the shell's units count the touching pairs from it). Bodies with no
contact slot keep today's key. The mass-blind push stays (changing it moves tuned stack rows).

### 8.10 What physics does not do
No height field (E1), no run-time stiffness or damping (E12), no run-time detail swap, no detail-2 wholes in S1 and S2, no per-particle buoyancy,
no second free prop, no 2-DOF joints, no tack or strands on props, no floor contact for hinge props (the floor rule keeps them clear, 8.4). Float
mode is unchanged: the Float rule is the shell's (D-83, SH-11), so physics needs no "ignore gravity = false" rule.

## 9. Render additions (PG_RENDER)

- **Place host** (`src/render/place.ts`, in the away chunk): sky presets through a `Table.setSky` (the 9 uniforms and fog, table.ts 198-204) or a
  per-place sky shader; a ground mesh with its own band-limited noise (top at y = 0; the felt is Home's); 3 to 6 backdrop cards (renderOrder -99..-51,
  low poly: drawn twice on med and high); weather through `Particles` with a normal-blend option; the three lights as stage fields, the jelly
  `uKeyDir/uRimDir/uKeyCol/uRimCol` and `KEY_TINT` re-derived per place (material.ts 329-338, 386-390); env panels as data with `EnvHub.rebuild`
  and the old cube disposed; the ceremony dim easing over at least 1.0 s; context loss rebuilds the place env (stage.ts 615-625). `setPlace` swaps
  under the ScreenFx snapshot crossfade. Home stays the default look in the stage chunk.
- **Place chunks** `src/render/places/<id>.ts` (lazy, bare `'three'` import so three stays in the stage chunk), at most 45 KB together with the
  place's audio recipe and its data module `src/data/place_<id>.ts` (the size gate sums the three, T1); the place's text is in the screens chunk
  (`journal_text.ts`), never in the place chunk. Each place draws both layouts (wide and tall, D-68) from the same kit.
- **Props kit:** shared geometries and materials per kind (MeshStandardMaterial with `hub.apply`), `InstancedMesh` for repeated statics, movers posed
  from the bound `poses`, opaque props at renderOrder 0..9 before the jellies; one instanced contact-shadow draw for props; at most 60 draw calls for
  the set and props of a place (RD-08).
- **Water:** one translucent surface per water zone drawn after the jellies (depth test on, depth write off), the render-only edge ring, the
  under-the-waterline tint per body (`setBodyWater`).
- **Body looks:** `uFrost`, `uWet`, `uSand`, `uToast` (with `uHeatPos`), `uSnow` in the jelly program, cache key `wh-jelly-v5`, each checked on the
  WH_LOW path; with every look at 0 the gallery is pixel-identical to v4 (RD-02).
- **Faces:** per-body gaze; five eased expressions, eyes only (no blush, no mouth, RD-10); the pointer wins on a touched body.
- **Render pose:** `setBodyPose` in the jelly vertex stage and the same transform on the eye anchors on the CPU (face.ts fits the beads to the sim
  footprint, so they need it; RD-11).
- **Emotes:** `src/render/emotes.ts`: one instanced, alpha-blended billboard draw, renderOrder 40+, depth test off, a pool of 8 slots, the 24 SDF
  icons (at most 4 primitives each) in one fragment shader, no texture (CSP-safe); styles say, think and group; never a flash. One accent per
  icon, at 3:1 or better on the cream fill (RD-04): the leaf is lagoon only, the moon an ink crescent with an amber fill, the postcard a sky band
  inside an ink frame (LIFE.md 7.1). **Calm or reduced motion: every bubble motion is a fade**, and a wish's re-glance is a 0.2 s opacity lift,
  not a grow (DESIGN 6.6: no pulses in Calm).
- **Particle presets for reactions (D-80):** a steam wisp (normal blend, the weather twin) for the warm cells that say "steam", drips, a
  soft bubble cling, embers; each counts against the autonomy particle cap (LIFE.md 10.1), x0.3 in Calm, none with reduced motion.
- **Marks:** one ring buffer of instanced quads (64 / 48 / 24 by tier), the decal alpha trick (decals.ts 100-104).
- **Cheaper bodies:** `setBodyAsleep` skips the fine-mesh evaluation (eyes still blink, the pose still sways); chunks use the low fine mesh
  (`AddBodyOpts.lite`, 2562 vertices) on med and high (RD-06: 6 pieces vs 2 wholes at most x1.2, from x1.32..1.45 today).
- **Camera:** in a place, `setPlayBounds` frames the whole play bounds of the layout in use (the wide layout, or the tall one on a frame with aspect
  under 0.9, D-68) so that a body anywhere inside them, its bubble included, stays inside the HUD safe insets; **no camera motion from autonomy**
  (M10) anywhere. At Home the framing stays today's framing of the mat slots in use: with LIFE on, the one-body follow (stage.ts 533) and
  `framingFor`'s live framing follow only player-caused motion (a toss) and otherwise frame the slots in use; **`visibleTable(out)`** reports one
  ground box inside the frame and outside the insets at that rest framing (D-67), **exactly** (revision 4, D-87): its z range runs from the ground
  row under the top inset line to the ground row under the bottom inset line, each clipped to the felt's z range (+-3.4 m), and its x range is
  the near row's (the narrowest: the visible ground narrows toward the camera), clipped to +-3.4 m. The shell turns it into Home's corral bounds
  (with the slots in use, D-87) and the Felt Ball's bounds; Home's things arrive by the data's `fromN` (D-88), which DT-01 proves in view and RD-16
  checks on the rendered frame. Measured by projection with the stage's constants (fov 35, pitch 0.27, target y 0.42, distance max(3.0, 2.4 /
  aspect), section 23; re-run in revision 4 by `pg_fix4/homebounds.mjs`): with one body the desktop shows no table in front of it (the bottom HUD
  covers z > 0.3 x scale) and on 390 x 844 the near row is only 0.78 to 1.22 m wide at scale 0.8 to 1.25, about the body's own width, so Home's
  spots are given in slot units and each shows only from its party size. The cut neck-swell stopgap in `framingFor` (STATUS known open) stays
  Home-only until PHYS fixes the swell.
- **Capsule spot** avoids prop footprints (`setObstacles`); the pad is clear by data.
- **Eyes seen through another body** are depth-faded (SHELL_4.md 95-98 reported a "four-eyed" look: a squishy's eyes crisp through a clear jelly in
  front of it), a must-fix for parties (RD-12).

## 10. Audio additions (PG_AUDIO)

`chatter` and `ambience` input gains created **after** `music` (the harness labels the first three `createGain()` calls, `engine_offline.js` 42);
default output bit-identical. `src/audio/creature.ts`: the synthesis of the phrase LIFE planned (`lifePhrase`, LIFE.md 12: LIFE picks the motif's
syllables, the answer, the duet and the sung notes; audio never re-plans them): the eight syllable shapes, the six flavours, pitch snapping, the
echo (a scheduled repeat, no DelayNode), the group voice, a pure `ChatterLimiter` backstop at the desktop caps, priority -1, its own rng stream (`CHATTER_SALT`), never
in `ROOM_KINDS`, silent during ceremonies and 1 s after (LIFE.md 8). `src/audio/ambience.ts`: an `AmbienceBed` shaped like `MusicBed` (its own bus,
3 s fade in, 2 s crossfade on travel, the 100 ms tick, two noise sources at different rates so the 2.5 s loop never shows, a shallow -6 dB dip under
player effects, never asking for room), joining `freeAll` and `freeMusic` on pause and mute. `src/audio/places/<id>.ts` recipes (lazy; PLACES 4
"Sound"; no animal sounds). `src/audio/props.ts`: ball, creak (a held voice per prop key with a dead-man switch), chime, splash, crunch, crackle,
boing, bell, tick (on the beat from the music clock), kettle, rustle, whoosh; a sound the player causes may use `registerFx`, one that moved by
itself never does. `musicBox` makes the bed mute its mallets while it plays: the Music Box's 8 bars (29.1 s) at most once per 40 s (a second tap
stops it), the kettle's 1-bar whistle (3.6 s) every 45 to 90 s and never within 60 s of a Music Box tune, so with no input tunes sound at most
20% of a cabin visit (D-81, AU-14). `musicClock` reports the field SOUNDING now (from the composer's field log against bar time; the readout of
`detailStats` runs up to a bar ahead); the shell uses it only for `creature()`'s `at` and the render sway phase, after LIFE has decided on sim
time (D-66). A sung note planned by LIFE as a pentatonic degree may be re-voiced here onto the sounding field's rest tones (root, fifth, ninth),
which changes no LIFE decision. `creature()` and `prop()` copy what they need from the caller's reused object and keep no reference (AU-11).
Pieces' pitch is LIFE 8.2's: x `popSize(frac)` = (0.5 / frac)^0.4, snapped from D6 to D7, 7 dB quieter. `setMusicStyle` changes field weights and
mallet timbre only; `home` is bit-identical (AU-07).

## 11. Shell additions (PG_SHELL)

### 11.1 Frame order
Section 4: steps 2, 5 and 7 are their own lines in `simStep` (D-58), not `game.onStep` hooks. Zero allocation per frame in every new step
(`emit()` allocates: never per frame). Physics allocates three objects per SoftEvent it emits (softbody.ts 2696-2699): SH-01 and SH-04 measure
windows in which no physics event fires, and the shell's own handling of an event allocates nothing.

### 11.2 The LIFE host (`src/shell/life.ts`)
Stable character ids: a whole's Hoard item id; a piece's parent id and piece index (view ids change on re-add, SHELL map 2). **Contact slots:**
every party body and piece gets a `contactSlot` 0..31 at spawn, cut and join (D-65); bump events' `other` fills `bumpA` / `bumpB`, and
`SoftMetrics.contacts` gives the touching pairs. Fills the snapshot in place from `bodies.body`, `bodies.extras`, metrics, the world's poses
(through `propThing` and `propPart`, D-64) and this step's events (copied into its own ring while draining): `thingId` for the things out now,
`zoneThing` and `patchThing` per character (from `ThingDef.zone` and `ThingDef.patch`), the RIDE flag (a carry or toss that came to rest on a ride
prop, or `carryTo`; cleared after 20 s, at the end of its joint moment, or on a touch, D-74), and the four music fields from deterministic sources
only (D-66: the place's music style, the Music setting, its own sim-time tune timers, the 66 BPM grid on sim time; never `musicClock`). Computes
`units` with PF-00's weights (LIFE.md 10.3) and the `phone` boolean (coarse pointer or short side under 600 CSS px). Sets `quiet` (a ceremony, `cut`
busy, any non-Hand tool, Travel or Journal open, the desktop Hoard's hold, a hidden tab), except for the cut squishy's own group from 1 s after the
swipe ends (D-73). **The one arbiter:** finger > cut and ceremony > LIFE; LIFE's SCOOT is sent to `scootTo` only (physics pauses it under a touch
and makes it yield to `moveTo`); ceremonies and the cut steering (cut.ts 194-215) keep `moveTo` (D-63). Never calls `fingerDown`, `grab*` or a lock
API for autonomy. **The awake budget (D-61, D-85):** while `units` is over `unitCap` (the formula with D-85's floor, from `attention.ts`; plus the
riders' units while their ride moment runs: the ride allowance) it cancels the motion of the untouched LIFE mover farthest from the frame centre
(it settles; never a ride moment's own mover, S11's pusher) and calls `sleep()` on untouched, still wholes (not RIDE, not on a moving prop),
farthest first, until `units` is back under the cap; the touched, carried, tossed and riding bodies are never forced. **The place reaches LIFE
through `lifeSetPlace(w, placeIdx, visit, def, layout, bodyScale)`** (D-89: on travel with a new visit number, and on a re-lay after a rotation
with the same one) and, at Home, **`lifeSetHome(w, slot, x, z)`** for each character's home slot (`stage.matLayout`'s slot in use), sent at spawn
and whenever the party or the frame changes, never from autonomy (D-87). After each tick it reads `lifeLooks` and writes `setBodyLook` and
`mods[4]` for every family (FAMILY_REACT's density, a soaked foam lerping to its soaked density, 8.1); it calls `lifeAddLook` with the source thing
for the pine's snow puff, the kettle's steam and the squirt game, `lifeSetJournal` when the journal's owned species, open places, known favourites
or the open places' thing kinds change (never per frame), `lifeSetPair` at spawn, cut and join and on a FRIEND event, `lifeScript` for the six
scripts of LIFE.md 4.1 (the fresh-profile flags for FIRST_PLAY and FIRST_WISH come from the journal; FIRST_WISH names its wisher by D-70), and
`lifeWishOf` for each WISH record's kind and target and for the wish card and the Wishes now list. It writes one BRING record per party member
(QUESTS 4), sets a WISH GRANTED record's `by` by QUESTS 4's rule, sets flag bit 3 on every record made while "Squishies move on their own" is off
(D-79), and turns a strike into a USE only for causes 0 (the player) and 1 (a body, whose slot names the actor): a weather strike is a sound only.

### 11.3 The party manager (evolves `src/shell/mat.ts`)
Stable ids; caps by tier (LIFE.md 10.4); spawn at the spawn spots of the layout in use (Home: `stage.matLayout`); on travel every member is spawned
at rest and put to sleep at once (`sleep()`) except the first moverCap members, who do the arrival hop (B09 through the motion gate); the party
**survives** a ceremony (`game.ts` 381's `mat.clear()` becomes a stash, restored within 0.5 s after the ceremony ends, **needs and looks kept**:
only the shelf and a trip reset them, LIFE.md 3), a Hoard card preview and travel; the first capsule's newcomer stays out when there is room;
`out` and `back` events carry the item id; the tier drop policy (sleep, then shelve with the kind line); **the Float rule (D-83)**: Float works at
Home with one squishy out, and then the shell binds no PropWorld (Home's things are parked, not drawn) and LIFE issues no motion; with more than
one out, or in a place, the shell forces gravity at run time (the saved setting is not changed), shows "Here your squishies stand on the
ground." once a session, and never calls `stage.setFloatMode(true)` (game.ts 365 does today); `sleepEnabled` on every party body.

### 11.4 Cut with a party (`src/shell/cut.ts`)
`clearMat()` (cut.ts 283) no longer empties the mat; pieces = min(MAX_PIECES, cap - (wholes - 1)); before a cut the shell puts every untouched
whole to sleep (`sleep()`); if the pieces' units (0.22 each) plus what is still awake would pass `unitCap`, it refuses kindly ("It's busy here. Put
one squishy back on the shelf to cut."): at F = 4 that never happens once the others sleep (med: 5 pieces 1.10 + 3 sleepers 0.09 = 1.19 against
1.49; low: 4 pieces 0.88 + 0.06 against 1.06, D-85); cutting a second party member reconnects the first, animated; an `onCut` / `onWhole` hook fires
from the swipe AND from the Cut bar's Split in two and Reconnect all (today they emit nothing, and `joined` is never emitted, SHELL map 4); the
cut squishy's group leaves the non-Hand-tool quiet 1 s after the swipe ends (its pieces follow, huddle and join in while the Cut tool stays in
hand; every other character stays quiet, D-73).

### 11.5 The attention wiring (`src/shell/attention.ts`)
Wraps the pure `src/life/attention.ts`; calls `stage.emote`, `audio.creature`, prop sounds from `drainStrikes` (every cause), the budgeted soft
land and bump sounds for **every `auto` event** (lands, prop bumps and body bumps: none of them reaches `feedback.handle`, which would play
`audio.bump`, `haptics.pop()` and a shake, D-62); the touch duck while **the player is touching** (a finger down, a grab or a carry; never a lock
alone, D-84); B08's afterglow emote and voice as P1 requests (budgeted; only `feedback.ts`'s own effects stay outside); Calm caps; 0 haptics and
0 camera moves from autonomy. **The quest-complete moment** plays its 10 ms haptic and uses `registerFx` only when the ring record that completed
the quest is by PLAYER; otherwise its stamp sound is an `auto` UI sound with no haptic (D-84).

### 11.6 The play-event bus (`src/shell/events.ts`)
The `PlayEventRing` (capacity 64), filled by the producers of QUESTS 4 (mat and party, `drainBody`'s touch copies and tosses, LIFE events, travel,
cut, Snap at the shot, the Journal UI, ceremony ends, gift claims); drained once a frame by the quest host into `collection.feedPlay`.

### 11.7 Travel (`src/shell/places.ts`, `src/ui/travel.ts`)
QUESTS 15: `whenIdle`, `leaving()` (reconnect a cut, release locks), `loadPlaceDef`, `stage.loadPlace` and `audio.loadAmbience` (all three
prefetched on idle when the place opens), the layout from the frame's aspect (under 0.9: the tall layout, D-68), the 0.6 s crossfade,
`buildPropWorld(place, layout, bodyScale)`, `setPropWorld`, `setBounds`, the modifiers, spawn (at rest, then `sleep()`, 11.3),
`lifeSetPlace(w, placeIdx, visit, def, layout, bodyScale)` with a new visit number (D-89), VISIT, `setAmbience`, `setMusicStyle`, `setPlayBounds`
with the layout's bounds, `setObstacles`; "Packing up..." after 300 ms; a load failure keeps the player where they were. A rotation that changes
the layout (the aspect crosses 0.9) re-lays the place at the next idle moment by the same path under the crossfade (a player act; things and
bodies are re-placed, nothing is lost), with `lifeSetPlace` called again with **the same visit number**, so LIFE keeps its visit-scoped state and
only its layout changes; until then the camera frames the current layout. A live line on arrival: "You are at Hearthlog Cabin."

### 11.8 Keyboard (`src/input/keyboard.ts`)
J the Journal, P Places. **Tab stays the browser's** (D-77: it must always reach the Journal, Places, mute and gear buttons and leave the
party; WCAG 2.1.2). **The party is one Tab stop**: a DOM toolbar of one focus proxy per party member (roving tabindex, each named like "Dollop,
Jelly Gel"), inside which [ and ] move the focus (the arrows stay the camera; with one character out, [ ] switch squishy as today); the focused
squishy shows a token ring under it at 3:1 or better and its name tag. **Space presses the focused squishy** (keyboard.ts 74-83 presses the screen
centre today); the **keyboard stretch**: hold Space on the focused squishy, then an arrow key pulls it toward that side through the real driver (a
grab that pays like a pull, because the player did it), released with Space. **Enter** on the focused squishy opens its wish card when it has a
wish, otherwise its name tag popover; either way a bubble showing over it at that moment is also read into the polite live region ("Hello!") and
counts as UI EMOTE_TAP (H6). The popover holds **"Go play with..."** (floor things: a player-asked LIFE use, which also works with autonomy off;
rides: `carryTo`) and **"Tap it yourself"**: every thing a pointer tap acts on (revision 4, D-93): every thing with a switch (M14), every ball
(M13) and every thing a tap swings (the Shake Pine's branch, every chime, bell, crystal and lantern, a seesaw end, a swing seat), each calling
the same switch or `PropWorldLike.poke` path as a pointer tap with the same impulse, recorded by PLAYER ("Tap the fireplace", "Roll the Felt Ball",
"Shake the pine", "Ring the shells"); a thing of several parts (the Shell Chimes, the Icicle Bells, the Crystals, the Lantern Line) taps its next
part in prop order at each press, so a distinct-part quest is reachable by keyboard. The bubble hit areas are `tabindex="-1"` (they move every 250
ms and must never hold focus). The Escape order tray, Settings, Journal, Places, Hoard, tool, plate, then locks; focus returns to the opener. QU-09
derives each quest's K from a producer table of these routes (D-77).

### 11.9 Settings (the exact change; one commit, so the typecheck stays clean)
In `src/contracts.ts`, add to the PLAYGROUND block:
```ts
export interface Settings {
  /** PLAYGROUND: the "Voices" slider 0..1 (= AudioSettings.chatter). Default 0.6. */ chatter?: number;
  /** PLAYGROUND: the "Place sounds" slider 0..1 (= AudioSettings.ambience). Default 0.5. */ ambience?: number;
  /** PLAYGROUND: "Squishies move on their own". Default true. */ autonomy?: boolean;
  /** PLAYGROUND: "Words under bubbles". Default false. */ bubbleWords?: boolean;
  /** PLAYGROUND: the Snap bar's "Bubbles in photo". Default true. */ bubblesInPhoto?: boolean;
}
```
and in `src/core/settings.ts`: `SETTING_KEYS` gains `'chatter', 'ambience', 'autonomy', 'bubbleWords', 'bubblesInPhoto'`; `OPTIONAL_UNITS` gains
`'chatter', 'ambience'`; `OPTIONAL_BOOLS` gains `'autonomy', 'bubbleWords', 'bubblesInPhoto'`; `optionalDefaults` returns `chatter: 0.6, ambience:
0.5, autonomy: true, bubbleWords: false, bubblesInPhoto: true` (its Pick list widened); `resolveSettings` fills the five with `??`.
**`SETTINGS_VERSION` becomes 3**; migration stays by absence (a v2 blob reads as v3 with the five defaults). Why: an older v2 build drops unknown
keys and carries them only for a blob with v > 2 (settings.ts 8-9, 118, 176-178), so with v still 2, opening the CDN build (2683d349), a rollback
or an older tab would erase Voices, Place sounds, autonomy and both bubble switches. `settingsCtl.ts` applies them with change detection;
`settingsPanel.ts` gets the rows and widens its key unions (lines 49 and 65); node_checks section 6 covers them, a v2 blob and a v3 blob read
by the old code included.

### 11.10 Screens
QUESTS 15: the Journal (`src/ui/journal/*`), the tracker (`src/ui/tracker.ts`), wish cards and bubble hit areas and word labels (`src/ui/wishes.ts`),
the moments queue (the plate slot), the gift card, the Travel sheet, the settings rows; on the UI overhaul's components and tokens; every new HUD
element in `_harness/uikit/` in every state (UI.md 5); the Journal and Travel in one lazy screens chunk. **Which chunk each play-time module ships
in** (revision 4, D-92; T1 fails on a lazy chunk it cannot name): `src/ui/wishes.ts` (wish cards, bubble hit areas, word labels; about 4 KB), the
moments queue `src/ui/moments.ts` (about 3 KB), the party toolbar `src/ui/partybar.ts` (focus proxies, roving tabindex, the focus ring and name
tag; about 3 KB), the name-tag popover `src/ui/nametag.ts` ("Go play with...", "Tap it yourself"; about 3 KB) and the Snap shutter and preview
`src/ui/shutter.ts` (about 3 KB) are imported **statically by the LIFE host** (`src/shell/life.ts`), so they ship inside the life chunk and T1
names them through it (estimates at 18 B a source line, 14.3; each lane reports the real bytes). None of them is needed before the life chunk
lands: until then Home is one squishy, today's keyboard and today's Snap bar (11.14). Revision 3 adds (QUESTS 15): the tracker
shows only a quest that can be done now (D-78, D-79); portrait and **landscape** layouts (844 x 390 and 568 x 320: the plate and the wish card in
the left half under the pill); the wish card `min(358px, 100vw - 32px)` wide (it may wrap to two lines, at most 120 px tall) and the plate
`min(320px, 100vw - 32px)`; one queue for the polite live region (quest and wish lines first, at least 2 s apart) with the new lines (a place
opens, an arrival); the Journal button's name "Journal, something new" while its dot shows; the family name on every Journal page and tile
(D-82); "New stamp: ..." for a quest moment; "Your gift will wait here for now." on a signed-in ledger; and **the Snap shutter** (11.15).

### 11.13 Home's view and things (D-67, revision 4: D-87, D-88)
Home's PlaceDef gives every thing a spot per frame (TALL and WIDE, the `matLayout` test) in slot units, multiplied by bodyScale, with the smallest
party from which it shows there (`fromN`, PLACES 4.1's table: every one at 3 or fewer). Each thing shows once its arrival event has happened
(PLACES 4.1) **and** the party is at least its `fromN` (the frame changes only with the party, a player act, or a ceremony), arriving with its
little scale-in (Calm or reduced motion: a fade); if the party later drops under `fromN` it is parked (not drawn, no collider) until the party is
back, which is not a new arrival. Said once, here and in LIFE 5.7 and PLACES 4.1:
- **The corral** (`setBounds` on every party body): the smallest rectangle (shape 1, corner radius 0) that holds `stage.visibleTable` and the body
  of every slot in use plus 0.05 m, recomputed when the party or the frame changes, never from autonomy; every slot centre is inside it, so the
  corral never moves a body resting at its slot.
- **LIFE's targets** (`lifeSetHome`, D-89): points on a segment between two framed points (the home slots of the characters out, and the use spots
  of the arrived things); no shrink. Both ends are in view by construction and the centres at which a whole body is in view form a convex set, so
  every target is in view. With one squishy on a portrait phone that is the segment from its slot to the Felt Ball's use point: it plays and
  comes home, and does not wander.
- **The Felt Ball's prop bounds**: the visible table shrunk by its radius, so a boop never rolls it out of view.
RD-16 checks, at 390 x 844 and 1280 x 800 with 1 to 5 bodies at scale 0.8, 1.0 and 1.25, every arrived thing inside the frame and outside the
insets, a whole body at every LIFE target and every use spot inside them, and every slot centre inside the corral rectangle; SH-21 checks the
same rules in node with `visibleTable` stubbed from DT-01's projection table. The spots assume the HUD insets of the earlier fixer's model (390 x 844: top 151, bottom 170, left 16,
right 60 CSS px; 1280 x 800: 120, 150, 24, 24); the real ones are measured from the DOM (`hudBinding.ts` 121-141), so DT-01's Home row reads them
from a table the UI overhaul fills, and a spot that fails on the real insets is re-laid by the DATA lane before S0's exit.

### 11.14 The life chunk (D-69)
`boot` builds the game as today; after the first frame of play the shell requests one lazy chunk holding `src/life/**`, `src/core/quests.ts`, the
journal store and its modules, the LIFE host, the quest host, the attention wiring, `src/physics/props.ts`, the life, quest and Home data, and
the five play-time UI modules of 11.10 (wishes, moments, the party toolbar, the name-tag popover, the Snap shutter and preview; D-92).
Until it lands Home is today's toy (one squishy, no brain, no things, today's keyboard, today's Snap Save) and the ring keeps the player's
events; when it lands, the hosts attach,
the journal loads, Home's things begin to arrive and the tracker pill fades in. A load failure retries on the next idle moment and never breaks
play (the toy works without it).

### 11.15 The Snap shutter and preview (QUESTS Q8)
Today one Save press captures, encodes a PNG and downloads it (hudBinding.ts 268-304), so a PHOTO could only come from a file download. The
Snap bar gets a **shutter**: it captures one clean frame (as today), shows an in-page preview from a downscaled data URL (the CSP allows
`img-src 'self' data:`, not `blob:`, index.html 13), and pushes PHOTO into the ring at that moment; **Save** (the download) is an optional button
in the preview. The Friendship Frame keeps one thumbnail of at most 12 KB (a JPEG data URL of about 160 x 120) under its own key
`wobblehoard:v2:journal.frame`, written once at the X8 photo. SH-18 checks that X8 completes with no download. The shutter and its preview
(`src/ui/shutter.ts`) ship in the life chunk (D-92): until the chunk lands, the Snap bar's Save works exactly as today, and no PHOTO is lost,
since the Journal that counts it is in the same chunk.

### 11.11 Dev hook
`life()`, `quests()`, `travel()` (dev only, out of the production bundle: the `bundle` section's grep).

### 11.12 Node checks
New sections in `_harness/shellview/node_checks.ts` with a **moving mock body** made inside the section (a local subclass of the mock with a writable
centre and metrics; `_harness/mocks.ts` is the orchestrator's file and stays as it is) and the real `SoftBody` for the touch and hop rows (the 7g
pattern) and for SH-06's boop row: two LIFE bodies with contact slots, one hopping into the other at 0.4 m/s, must give a body bump with `auto`
and `other` set, 0 `feedback.handle` calls for it and 0 haptics (mock bodies emit no bumps, so only real ones can show this).

## 12. Quests, the journal and the save (PG_QUESTS)

- **`src/core/quests.ts`:** `applyPlayEvent(st, ring, i, defs, out): number`: pure, allocation-free after warm-up, no clock (the day is injected), no
  rng; matches clauses, keeps counters and bitsets, derives FRIEND levels (with the 20-a-day pair cap), facts F0..F11, keepsakes, place openings and
  gift readiness; imports only `./rng.ts`, `../data/quests.ts`, `../data/life.ts`, `../data/catalog.ts` (and types). The capsule-roll word never
  appears in it (probe I03 scans every file in src, strings included).
- **`src/collection/journal.ts` and `journal_store.ts`:** sanitize, serialize, the two-tab merge, park, backfill; the store cloned from
  `createHoardStore` (store.ts 498-600) under `JOURNAL_KEY = 'wobblehoard:v2:journal'`, `JOURNAL_BACKUP_KEY = 'wobblehoard:v2:journal.unreadable'`,
  `JOURNAL_VERSION = 1`, `JOURNAL_MAX_CHARS = 16_000` (it parks whole under PARK_MAX_CHARS 20 000), `JOURNAL_MIGRATIONS = []` through
  `migrateVersioned` (save.ts 82-97). A newer `v` is read-only in memory; an unreadable blob is parked and replaced.
- **Format** (revision 3: the acctTag once per blob and item ids once, in `ids`; worst case about 12.8 KB with 64-character ids and about 10 KB
  with real 36-character UUIDs, under `JOURNAL_MAX_CHARS` 16 000; CO-02 measures it):
```json
{ "v": 1, "dev": "<deviceId>", "bf": 1, "st": 42, "acct": "<acctTag of the real-ledger rows, or absent>",
  "qd": "<base64 of the 128-bit done set>", "qp": [[17, 2, 0, 0, "<base64 bits>"]],
  "fx": [[0, 4127], [10, 3]], "fr": [[0, 10, 9], [3, 12, 14]], "fd": [20407, [[0, 10, 6]]],
  "ids": ["g-k2j9x0a1b2c3", "<a real item id>"], "real": [1], "wm": [[0, 17], [1, 4]], "ks": 3, "pl": 7, "pv": [5, 3, 1],
  "wi": [[3, 1, 2, 20407]], "gift": [[1, 2, 3, 20406], [2, 1, 12, 20407]], "gday": 20407,
  "cur": { "p": 1, "party": [0] }, "day": 20407 }
```
  `qd` quests done; `qp` in-progress counters and bitsets (at most 40 rows); `fx` fact masks by species idx; `fr` friendship [lo, hi, points] (at most
  128); `fd` today's points per pair; `ids` the item ids the journal names, once each (at most 100), `real` the indexes of `ids` that are real-ledger
  items; `wm` warmth as [index into `ids`, points] (at most 100); `ks` keepsakes; `pl` places open; `pv` visits; `wi` resting wishes (at most 3);
  `gift` [chapter, state 1 pending / 2 granted, species idx, day]; `gday` the last gift's day; `cur.party` indexes into `ids`.
  Worst case by field: `ids` 100 x 67 characters = 6.7 KB (64-character ids; 3.9 KB with UUIDs), `qp` about 1.5 KB, `fr` and `fd` about 1.5 KB
  each, `wm` 0.8 KB, `fx` 0.5 KB, the rest under 0.5 KB.
- **Over the cap** (defensive: the caps above keep it under): before a write that would pass 16 000 characters, drop in this order `fd` rows
  (they only bound today's points), then Met-only `fr` rows with the fewest points (never Friends or closer, never a best-friend pair, LF-15's
  rule), then `ids` entries that no field names; never `qd`, `fx`, `ks`, `pl`, `gift` or a `wm` row (warmth never falls, CS-13). If it is still
  over, the write is refused, the report says `failing`, the stored blob stays as it was, memory keeps everything, and the next change retries
  (CO-11).
- **Ids by ledger, not by prefix** (CO-10): an id is a real-ledger id when its Hoard item's `ledger` is not `'practice'`, whatever its prefix
  (the slice-1 starter keeps its old id, `types.ts` 24, and gifts are `jg-`). **Warmth across merges** (CO-06): before `wm` is pruned to the
  items still on the shelf at load, a pruned parent's warmth is moved (max) to the blend row that names it as a parent (store.ts 100-110), so a
  merge whose journal write lagged the hoard's never lowers warmth.
- **Two tabs:** every field only grows or is a max, so the merge is a union or a max (quest state max, counters max, facts OR, friendship max per pair,
  keepsakes OR, warmth max, gift state max, wishes the newest 3 of the union, `cur` last writer).
- **Backfill** (`bf`, once): F0 for every owned species; Home H1, H3 and H4 done when the shelf shows them (opened at least one capsule, owns two or
  more).
- **The gift grant:** QUESTS 11's three steps; `ghostGrantGift(save, chapter, pick, ctx)` in `ghost.ts` (origin `'restock'`, `speciesBaseGenome`,
  the deterministic id `'jg-' + deviceId + '-' + chapter`, `hasId` first, GHOST_CAP refusal); the claim refuses a second gift on the same UTC day and
  any species not on the chapter's list; Practice ledger only (M3). **Step 2 is a verified write (D-71):** after adding the row it calls the hoard
  store's `flush()` (store.ts 592) and goes on to step 3 only when `report().save === 'ok'` and the row's id is in the stored text; otherwise the
  gift stays `pending` with "Your gift will wait here." and the claim retries on the next load or claim. Collection grants only call
  `markDirty()` today (index.ts 121), which waits up to `SAVE_THROTTLE_MS` 2000 (constants.ts 29) and never writes on a quota failure (store.ts
  557), so a `granted` written at once could outlive a lost row. The Hoard's swatch shows "Gift" as the origin of a `jg-` id (copy.ts 202-203
  would say "Restock"); the stored origin stays `'restock'`.
- **Accounts (M25):** journal entries keyed by a real-ledger item id (classified by the item's `ledger`, never by its prefix) sit under the
  blob's one `acct` tag and are dropped on sign-out or an account switch (COLLECTION 4 wipes the mirror then); practice ghost ids stay. A signed-in
  ledger sees "Your gift will wait here for now." with no Yes button, and its gift stays pending in the Journal (CO-09, Q12).
- **Imports stay legal:** the collection imports only `./`, `../core/`, `../data/` and `../contracts.ts` (types): LIFE events reach the journal
  through the shell (probe_collection_imports I01..I07 unchanged).

## 13. Lazy loading and chunks

| Chunk | Holds | Loaded |
|---|---|---|
| first load | the entry, the shell's seams (the ring, the `simStep` lines that call the life chunk, the party manager, the buttons, the tracker pill's shell, the settings rows, the keyboard), `ghostGrantGift` and the collection's small hooks, and boot's three imports (`boot.ts` 94-98: physics with the drivers, sleep, support on prop faces and the prop contact pass; the stage with gaze, expressions, poses, looks, `visibleTable`, Home's thing meshes and the emote draw; audio with the chatter and ambience buses, `musicClock`, creature synthesis, the limiter and Home's prop voices) | at boot |
| **life (D-69)** | `src/life/**`, `src/core/quests.ts`, `src/collection/journal.ts` and `journal_store.ts`, the LIFE host, the quest host and the attention wiring (`src/shell/life.ts`, `src/shell/attention.ts`, the quest host), `src/physics/props.ts`, `src/data/life.ts`, `src/data/quests.ts` (all 110 rules and `HOME_TEXT`), `src/data/places.ts` and `src/data/place_home.ts`, and (revision 4, D-92) the five play-time UI modules the LIFE host imports statically: `src/ui/wishes.ts`, `moments.ts`, `partybar.ts`, `nametag.ts`, `shutter.ts` | requested after the first frame of play (never before play, so D9 does not count it) |
| away | the place host, the props kit for places, water, marks, weather, the ambience bed and the place prop voices | with the first trip (prefetched on idle when Hearthlog opens) |
| play (only if the life chunk overflows, 14.3) | the five play-time UI modules, moved out of the life chunk as one named chunk (`ui/play.ts` the facade) | with the life chunk, right after it |
| screens | the Journal, Travel and gift screens and `src/data/journal_text.ts` (all player text but the three bubble words) | on the first Journal or Places open (prefetched 30 s after the first reveal) |
| one per place | `src/render/places/<id>.ts`, `src/audio/places/<id>.ts` and `src/data/place_<id>.ts`: three dynamic imports (`loadPlace`, `loadAmbience`, `loadPlaceDef`), so three chunks the size gate sums per place (T1) | when the place opens, on idle |

Every lazy module imports `three` by the bare specifier; CSP `script-src 'self'` allows same-origin chunks (index.html 13). The size gate (T1)
names every lazy chunk by its facade module and **fails on a lazy chunk it cannot name**, so no half of a place escapes its cap.

## 14. Budgets

### 14.1 Characters: LIFE.md 10.4 (wholes 3 / 4 / 5, pieces 4 / 6 / 6, characters 6 / 8 / 10). The motion gate: LIFE.md 10.3.

### 14.2 Frame (a mid-range phone on `med`, 16.7 ms)
| Subsystem | Budget (mean, phone ms) | Its node twin on this container (B / F, F = 4 until PF-00) | How it is held |
|---|---|---|---|
| physics (bodies, props, zones) | 6.0 ms (low 4.0, high 10.0) | 1.5 ms (low 1.0, high 2.5) | sleep; the awake budget and the motion gate (D-61); no detail-2 wholes |
| LIFE + attention + quest host | 0.4 ms | 0.1 ms | 10 Hz think, at most 0.1 ms a tick at 16 characters on this container (LF-03) |
| shell (gestures, feedback, cut, bus) | 0.6 ms | 0.15 ms | zero allocation |
| UI | 1.0 ms | | the UI.md bar |
| render CPU | 4.5 ms | | sleepers skip mesh updates; lite chunk mesh |
| audio main thread | 0.5 ms | | at most 10 chatter nodes and 14 ambience nodes steady |
| GC and slack | 3.7 ms | | |

**One bar, two harnesses (D-60).** The phone is modelled as Chromium on this container with a 4x CPU throttle (PF-01..03 measure there); the node
twin is the same number divided by the **phone factor F**. **PF-00** measures F once, at step 0, before PG_LIFE fixes the caps in `attention.ts`:
one awake detail-3 whole, resting and then pressed, in Chromium with the 4x throttle against the same body in node here (one heavy job). Until
then F = 4: Chromium's physics cost on this container matches node's (two wholes about 1.2 ms in the real shell, SHELL_4.md 75-77, against 0.69 ms
a resting whole in node, PHYS map 4), so only the throttle is left. PF-00 also measures the unit weights below.

**The measured costs (PHYS map 4 and 6, this container, quiet):** an awake detail-3 whole 0.69 ms resting, 0.87 ms pressed (`c_whole` = 0.87; a
LIFE mover about 0.9); a detail-2 piece with collide 0.19 ms (six cost 1.15 ms); a touching pair +0.22 ms; a sleeper about 0.02 ms (PH-09's
target); props near an awake body about 0.2 ms (PH-12's 1.25x bar). The review's arithmetic with these numbers (REVIEW_code-truth B2) is right:
at F = 4 an awake whole is 2.8 to 3.5 ms on the phone, so low (4.0 ms) holds ONE awake whole, and the old floor of 2 movers plus a touched body
(2.67 ms here, 10.7 ms on the phone) broke it 2.7 times over.

**The awake budget (D-61, D-85; LIFE.md 10.3 has the full table):** unitCap = max((B / F - 0.20) / 0.87, 1.0 + 0.03 x (the tier's wholes cap -
1)) in awake-whole units: **the floor is one awake whole plus every other whole asleep** (1.06 / 1.09 / 1.12 for low / med / high), so waking one
of three sleeping wholes on low (0.09 + 0.97 = 1.06) is always granted and PF-02's own state (one awake, two asleep: 1.06) is not over the cap
(revision 3's floor of 1.0 refused both: CONFIRM CT-B2); the player's own touch is never refused; moverCap = max(1, floor(unitCap)); every
comparison uses a 0.001 tolerance.
| F | low unitCap / movers | med | high |
|---|---|---|---|
| 4 (until PF-00) | 1.06 / 1 (0.92 by the formula, so the floor holds: one awake whole with props and two sleepers is 1.11 ms against 1.0; if PF-02 misses with one awake body it is today's one-body cost, a PHYS perf item, not a LIFE cap) | 1.49 / 1 | 2.64 / 2 |
| 3 | 1.30 / 1 | 2.07 / 2 | 3.60 / 3 |
| 2 | 2.07 / 2 | 3.22 / 3 | 5.52 / 5 |

**The ride allowance (D-85).** The riders the player set on a ride (RIDE, D-74) are the player's bodies: while their ride moment runs (S10 teeter,
S11 push), the start test and the over-budget rule add the riders' units to unitCap. So S11's one pusher may wake against the rider it pushes
(low: rider 1.0 + two sleepers 0.06 + the pusher 0.97 = 2.03 against 1.06 + 1.0 = 2.06; med with four out: 2.06 against 2.49), and the over-budget
rule never cancels a ride moment's own mover; S10 wakes nobody (both riders are awake on a moving prop), so it needs only the mover token. At most
**two awake wholes** come of it (a ride seats at most two; S10 has two riders and no other mover, S11 one rider and one pusher), for at most the
moment's length (S10 6 to 12 s, S11 three pushes, about 10 s) or the RIDE's 20 s; **PF-06** bounds it. **The soft boop (D-85):** where a boop's
start (the booper 1.0, the target 0.97, their touching pair 0.25, plus the sleepers) would pass unitCap, which at F = 4 is every boop on low (with
all three out: 1.06 + 0.97 + 0.25 = 2.28 against 1.06) and on med (four out: 2.31 against 1.49), S03 closes its last centimetres at 0.04 m/s (the
target stays asleep) and the target's wobble is a render wiggle; on high (five out: 2.34 against 2.64) the physics boop plays.

**The scenarios, recomputed (node ms at F = 4):** PF-01 med cap (4 wholes in the cabin): the player touches one, the other three asleep: 0.87 + 3 x
0.02 + 0.2 = 1.13 ms (bar 1.5); untouched, one LIFE mover and three asleep: 0.9 + 0.06 + 0.2 = 1.16 ms. PF-02 low (3 wholes): one awake and two
asleep: 0.87 + 0.04 + 0.2 = 1.11 ms (bar 1.0: the one-body case above; 1.06 units, exactly the floor, so the gate allows it). PF-03 cut (3 wholes
and 5 pieces, med): the other two wholes asleep before the cut (11.4): 5 x 0.19 + 0.04 + 0.2 = 1.19 ms (bar 1.5; the review's 3.56 ms assumed
every whole awake). **PF-06 (the ride case, new in revision 4):** two awake wholes on a ride and the rest asleep, low or med: 2 x 0.87 + 0.2 +
0.04 = 1.98 ms in node, about 7.9 ms on the phone, against the physics bar of 4.0 (low) or 6.0 (med): over the physics share for the ride's length,
so its bar is the whole frame, at most 16.7 ms mean with the 4x throttle (physics 7.9 plus the other rows of the table without their GC slack is
15.0 ms) and physics at most 8.0 ms; if it misses, section 24 lists the choices. **PF-05 is PF-01's node twin** (bar 1.5 ms at F = 4), not a
separate 2.0 ms number. Bodies the player wakes are never refused (a touch, a toss, setting two riders on a seesaw); the shell's over-budget rule
(11.2) puts the untouched ones back to sleep, travel spawns at rest and asleep (11.3), and B09's arrival hop goes through the gate (members
without a token show a happy squint and the shared sparkle).

### 14.3 Size (D9, re-specified; V4; revision 3, D-69; revision 4, D-92)
The first estimate was 2 to 3x low (REVIEW_code-truth M1, which I re-derived): code minifies to 13 to 21 B a source line here (`cut.ts` 12 764 B
for 623 lines, `store.ts` 12 597 B, `softbody.ts` 62 860 B), and one place's data built to section 6's fields is about 7.5 KB, not 1.5 (its PlaceDef
2.3 KB, its reaction cells as `{ tag, key }` 4.1 KB, its quests 1.1 KB). LIFE alone (19 behaviours, 18 moments, wishes, the voice planner,
attention, looks, pieces, 13 functions) is about 2 500 lines, so about 45 KB. Hence the life chunk: everything LIFE and the Journal need runs
from the first seconds of play, not before it, so it loads just after play starts.
| Part | Budget (minified bytes) | Estimate | Check |
|---|---|---|---|
| today's build | 1139 KB (2683d349, STATUS) | measured | |
| UI overhaul + SHELL-4 allowance | +90 KB | UI.md 2.7 | |
| PLAYGROUND first-load delta | **60 KB target, 70 KB hard**, split into lane caps: physics 18 (drivers, sleep, support on prop faces, the prop pass in `softbody.ts`), render 16 (gaze, expressions, poses, looks, `visibleTable`, the emote draw, Home's thing meshes), audio 8 (the buses, `musicClock`, creature synthesis, the limiter, Home's prop voices), shell 12 (the ring, the `simStep` lines, the party manager, the buttons, the pill's shell, the settings rows, the keyboard), collection 2 (`ghostGrantGift`, the hooks), data 4 (any id table boot code needs) | the lane caps | SZ-01 |
| **first load** | **at most 1300 KB** | | SZ-01 |
| **life chunk** (new) | at most **150 KB** (revision 4; was 110) | LIFE about 45, the reducer, journal store and journal about 22, the LIFE and quest hosts and the attention wiring about 16, `props.ts` about 8, **the data about 42 (measured, below)**, **the five play-time UI modules about 15** (11.10): about 148, or about 135 with the two big tables packed | SZ-02 |
| away chunk | at most **90 KB** (revision 4; was 120) | the place host, the props kit, water, marks, weather, the ambience bed and the place prop voices: about 44 to 66 (my estimate at 18 B a line over about 2 450 to 3 650 lines; nobody had estimated it) | SZ-02 |
| screens chunk | at most 45 KB | Journal and Travel UI about 25, `journal_text.ts` about 18 (the reaction cells' words do not ship, D-69) | SZ-02 |
| each place chunk | at most 45 KB (9 x 45 = 405): its render module, its audio recipe and its data module together | render 30 to 36, audio 4 to 6, data 3.6 to 6.2 (the cabin's stand-in PlaceDef with both layouts: 6.2 KB as objects, 3.6 KB with its reaction channels packed) | SZ-02 |
| **whole build** | **at most 2000 KB** (D9's ceiling) | by the caps 1300 + 150 + 90 + 45 + 405 = **1990** | SZ-02 |

**The life chunk's data, measured (revision 4; CONFIRM CT-M1 estimated 22 to 30 KB against the 16 KB written here).** Stand-ins built to section
6's field lists and counts with realistic values (the earlier fixer's scratch `pg_fix3/datagen.mjs`, re-run by me), minified one file at a time by
the rolldown method below: `life.ts` 18 108 B (of it `DEFAULT_REACTIONS` as objects 4 969 B and `SPECIES_LIFE` 3 348 B), `quests.ts` 14 462 B (the
110 rules as objects 11 592 B), `places.ts` 3 838 B, `place_home.ts` 6 046 B: **41.5 KB as objects**; with the 110 rules packed as flat number
arrays (5 024 B) and the default cells packed (1 570 B), **29.2 KB**. They are stand-ins, not the real modules: PG_DATA reports the real bytes
after its first step, and 14.3's numbers follow the measurement.

**When a chunk or the total goes over (revision 4, D-92), in this order, each step reported with its bytes:**
1. **A lazy chunk over its cap** (the life chunk, a place, the away or the screens chunk): the lane first packs its largest tables as flat number
   arrays read through a small accessor (the quest rules and the default reaction cells: -6.6 KB and -3.4 KB on the stand-ins; a place's
   reaction channels: -2.6 KB on the cabin's stand-in); then it moves what is not needed at once into a lazier **named** chunk (for the life chunk:
   the five play-time UI modules into the `play` chunk of section 13, loaded right after it; for a place: nothing moves out, its render module
   trims backdrop-card detail first). Nothing ever moves into the first load, and no lane raises a cap.
2. **The whole build over 2000 KB** (SZ-02 measures it): the place that opens last and is not yet shipped stays `shipped: false` and its three
   chunks leave the build (`loadPlaceDef`, `stage.loadPlace` and `audio.loadAmbience` list only shipped places, so its modules are never
   imported); in the S3 build that is Cloudloft, then Echo Hollow, and so on in reverse opening order. Its chapter is hidden (QU-14) and its
   stamps keep counting toward the others (QU-06); the owner may raise D9's ceiling to bring it back (V4). A place that has shipped never leaves.

**Measured at every step, not at S0 only:** each lane reports the minified bytes of every new or grown module after every step, from a one-file
build in node (light): rolldown from `node_modules`, the module as the only input, every import external, `output: { minify: true, format: 'es' }`,
`write: false`; the reported number is the output's length. A lane over its first-load cap moves code into the life chunk (or its own lazy module)
before the next step. SZ-01 measures the real build once at S0. A tenth place beyond these nine does not fit 2000 KB at 45 KB: with the caps
above it needs the ten place chunks to average at most 41.5 KB ((2000 - 1300 - 150 - 90 - 45) / 10) or the owner to raise D9's ceiling (V4).

### 14.4 Per place
At most 60 draw calls for the set and props (RD-08), 8 moving props and 20 collider primitives (DT-01, in each layout), weather caps per tier x0.3
in Calm and none with reduced motion, play-area luminance at most 0.35 (RD-13). **On-screen size (RD-17):** on 390 x 844 with the tall layout a 1 m
squishy is at least 100 CSS px wide at the front of the play area and 80 px at mid-depth; on 1280 x 800 with the wide layout at least 150 px at
mid-depth. From my fit script (the stage's camera constants, the HUD insets of QUESTS 15, whole bodies and a back body's bubble inside them):
tall bounds 1.25 x 3.0 give about 101 px at the front and 83 px mid; the wide layout framed whole on a phone gives 57 px.

### 14.5 Save and allocation
Journal at most 16 000 characters (CO-02). Zero bytes allocated per 120 frames in physics with props, zones and drivers, over windows in which no
SoftEvent fires (PH-11: `emit` allocates three objects per event by design, softbody.ts 2696-2699), per 6000 LIFE ticks (LF-02), per 10 000
reducer events (QU-01), per 600 shell frames with no physics event (SH-01, SH-04); render stays under today's 8.9 KB a frame.

## 15. Slices

| Slice | Contents | Playable result | Exit |
|---|---|---|---|
| **S0 "Life at Home"** (internal milestone) | PF-00 (the phone factor and the unit weights, step 0); PHYS touch gate, `setSquash`, `scootTo`, `hop`, support on prop faces, sleep and `sleep()`, `auto` (lands, prop and body bumps), `contactSlot` / `other` / `contacts`, collide caching, the prop pass with static props and the ball, Home's bounds; LIFE traits, needs, looks, B01-B20, REACT_TRIGGERS, the six scripts (FIRST_PLAY makes FN-01 hold; FIRST_WISH with D-70's wisher), S01-S09, S12, S13, S15 turn by turn, pieces P01-P04, attention, voice planning on sim time, the wish scheduler with `lifeSetJournal`; RENDER gaze, expressions, render pose, emotes, sleep skip, lite chunk mesh, eyes through jelly, Home's camera rule and `visibleTable`; AUDIO creature voices, chatter bus, limiter, `musicClock`, Home's prop voices (ball, music box); SHELL the life chunk loader, LIFE host, party manager (stable ids and contact slots, survives ceremonies and cuts, the newcomer stays out), the bus, the attention wiring (every `auto` event), the over-budget rule, Home's arrival rule, the tracker, the Journal with Home's chapter, settings rows (v3), the party toolbar and Space; DATA all places' numbers (both layouts) and all text; QUESTS reducer, journal store, backfill | Home comes alive: Dollop plays with the ball by itself, a newcomer says hello, they sing to the Music Box and nap on the rug, all in view (the Music Box and the rug show from two out in both frames, D-88; PLACES 4.1's spot table); Home's chapter up to its wish | **FN-01** passes in node and once in the browser; SZ-01 measures the first-load delta and the life chunk |
| **S1 "Hearthlog Cabin"** (first shippable) | S0 + the place system (place host, the cabin chunk, the away chunk, Travel, the wide and tall layouts, bounds and modifiers), the cabin's 6 things (the re-laid hinge rocker and swing, the swing re-laid again in revision 4 so every rider's path stays inside the bounds, D-91, the yarn ball, the snug basket ring, the hearth's warmth, the singing kettle's whistle), warm and cold looks and poses, toast, the ambience bed with the cabin's recipe, the cabin's prop voices, wishes and wish cards, the RIDE state, moments, keepsakes and the Home shelf, the gift path (the Hearthlog gift, the verified step 2), the Snap shutter and preview, chapters Home and Hearthlog and Friends Everywhere's X1, X2, X3, X6 and X10 (its place-spanning quests and its finale are hidden until S2, D-78), the squirt-free S1 copy | all five asks in one new place: things used in each family's way, a social party, pieces joining in calmly, voices and emotes, and a Journal with onboarding | node rows (QU-13 from LIFE's real output), then PF-01..03 against the caps PF-00 set, then the browser rows; independent verifiers (PG_VERIFY) |
| **S2 "Water and cold"** | water as a gravity scale and the float table, current, the flush pad, chimes struck by contact, ice and wet patches, marks, snow and rain weather, the water surface and tint, the ceremony dim; Ripple Shore, Frostbell Ridge, Rainleaf Garden (re-laid in both layouts by DT-01) with their chapters and gifts; Friends Everywhere's X4, X5, X7, X9 and its finale X8 (the Friendship Frame and a gift); the squirt game; the raised hops per family after PH-01 | three more places; floating and wading; splash jumps; glides; the sunset, the stars, the rain that stops | per-place node and browser rows; verifiers |
| **S3 "Fields and echo"** | airborne-only wind and updraft, the magnet and the steel marble, the motor turntable, the echo; Fizzwell Tub, Cogwhistle Bench, Lanternroof, Echo Hollow, Cloudloft with their chapters | the whole world of ten places | per-place rows; a full verifier pass over the whole game |

## 16. Build order and dependencies

| Step | Work (lanes in parallel) | Needs |
|---|---|---|
| 0 | **Now, beside SHELL-4 and the UI overhaul:** the contract (done); **PF-00** (the orchestrator, one heavy job: the phone factor F and the unit weights, on today's physics, before PG_LIFE fixes `attention.ts`'s caps; until then F = 4); DATA `name_gate.ts`, the data modules and their probe; LIFE pure brains and `probe_life_imports.ts` against scripted snapshots; QUESTS reducer, journal store, gift grant, economy rig rows; AUDIO creature voices and `musicClock` in the offline harness; RENDER emotes, faces, poses and the eyes-through-jelly fix in the renderview; every lane reports its modules' minified bytes from step 0 (14.3) | this page |
| 1 | The orchestrator: the G0 split in `vite.config.ts` (T1) **after SHELL-4 closes and before any place chunk lands**; SHELL `browser_shell.mjs` 3437 (T2) | SHELL-4 verified |
| 2 | PHYS (one owner): the queued checkpoint-47 re-verification, physics round 3 (grab and carry floor, LOCK and multi-pull, neck swell), then PG_PHYS 8.1..8.9 for S0 | step 0 contract; the physics queue |
| 3 | SHELL: LIFE host, party, bus, attention wiring, quest host, tracker, Home's Journal, settings (11.9), keyboard (11.8) | SHELL-4 verified; the UI overhaul's tokens and components; steps 0 and 2 |
| 4 | **S0 exit**: FN-01 in node and once in the browser; SZ-01 measures the first-load delta (one build, a heavy job) | 0, 2, 3 |
| 5 | S1: RENDER place host and the cabin chunk; AUDIO ambience bed, the cabin recipe, prop voices; PHYS hinge and ring props, bounds, modifiers; SHELL Travel, wishes, moments, gift path; DATA the cabin and Friends Everywhere chapters | 4 |
| 6 | S1 verification: node rows (QU-13 from LIFE's real output); PF-01..03 with the 4x throttle (they check the caps PF-00 set; a miss lowers nothing by hand: it is re-measured, D-61); browser rows; independent verifiers (PG_VERIFY); a fix round | 5 |
| 7 | S2 (water once, then the three places; PH-01 raises hops per family) | 6 |
| 8 | S3 (fields, then the five places); the whole-game verification | 7 |

## 17. Changes to files I do not own (exact tasks)

| # | Owner | File | Change |
|---|---|---|---|
| T1 | INTEGRATION (the orchestrator) | `vite.config.ts` | Replace the one total gate (`G0_BUDGET_BYTES = 1.2 MB`, line 24; `sizeBudget(limit)`, lines 171-187) with `sizeBudget({ firstLoad: 1300 * 1024, total: 2000 * 1024, lifeChunk: 150 * 1024, placeChunk: 45 * 1024, awayChunk: 90 * 1024, screensChunk: 45 * 1024 })`: in `generateBundle`, compute the **first-load closure** = the entry chunk, its static imports, and the closures of the three dynamic imports in `src/shell/boot.ts` 94-98 (`physics/softbody.ts`, `render/stage.ts`, `audio/engine.ts`); name each other chunk by its facade module: the life chunk (`life/step.ts` with the hosts), **a place = the sum of `render/places/<id>.ts`, `audio/places/<id>.ts` and `data/place_<id>.ts`** (three separate dynamic imports), the away chunk = the sum of `render/place.ts` and `audio/ambience.ts`, the screens chunk = `ui/journal/*` and `ui/travel.ts`, and the `play` chunk = `ui/play.ts` only if 14.3's overflow rule made it (revision 4, D-92); **fail on any lazy chunk it cannot name** and when a lazy facade is in the first-load closure; in `closeBundle` keep the total over the whole output folder (public files included) and print `[G0] first load N of 1300 KB, life N of 150 KB, total N of 2000 KB, largest place N of 45 KB, away N of 90 KB, screens N of 45 KB`. Do it after SHELL-4 closes and before any place chunk lands. |
| T2 | SHELL | `_harness/browser_shell.mjs`, the prod-build row "dist stays under the 1.2 MB budget (G0)" (line 3448 at HEAD 4fe77736; find it by its text, SHELL-4 still moves lines) | The row "dist stays under the 1.2 MB budget (G0)" becomes "first load at most 1300 KB and the build at most 2000 KB (G0, D9)": read the build's own `[G0]` line or recompute the same two numbers; a re-specification with this written reason (the owner's D9 and this page). |
| T3 | DOCS (the orchestrator) | `_spec/CONTRACT.md` | Section 6 G0 row: "`npx tsc --noEmit -p tsconfig.json`, `npm run build`: clean; first load at most 1300 KB and the whole build at most 2000 KB, the life chunk at most 150 KB, each place (its render, audio and data chunks) at most 45 KB, the away chunk 90 KB, the screens chunk 45 KB; `vite build` itself fails over any of them and on any lazy chunk it cannot name (`vite.config.ts`); PLAYGROUND_BUILD.md 14.3". Section 2: add the rows LIFE (`src/life/**`), WORLD DATA (`src/data/places.ts`, `life.ts`, `quests.ts`, `journal_text.ts`, `place_<id>.ts`), QUESTS (`src/core/quests.ts`, the journal files in `src/collection`). Sections 4 to 8: a pointer to PLAYGROUND_BUILD.md 7 for the PLAYGROUND members. |
| T4 | DOCS | `_spec/CUT.md` | Section 2, after rule 4: "PLAYGROUND (2026-11-15): cutting keeps the party on the mat or in the place (the mat is no longer emptied); the pieces a cut may make = min(the tier's pieces, the character cap - (wholes - 1)); one squishy is in pieces at a time. Pressing another party member is not switching squishy: the first body keeps its pieces. Rule 2 (leaving reconnects) is unchanged." |
| T5 | DOCS | `_spec/DESIGN.md` | 5.13 or a new 5.14: a pointer to QUESTS.md 11 (the Journal's only economy touch is 5 gift squishies for life, origin restock; no capsule or SP rewards); 6.6: autonomy obeys Calm and reduced motion (LIFE.md 10.1, 5.2). Optional, at the Stage C doc pass. |
| T6 | CORE | `_harness/probe_catalog.ts` | none: PG_DATA copies the gate into `_harness/name_gate.ts` and a row checks the copied function sources match. |
| T7 | CORE (optional, heavy, once) | `_harness/sim_economy.ts` | a "gift" source in section K (5 picks on assumed days 1, 2, 3, 5, 9 for regular players); re-quote K (expected shift under 1 day); section C is unchanged by construction (EC-04). |
| T8 | COLLECTION server (later) | `supabase/**` | the host op `wh_claim_journal_gift` with a per-account lifetime cap of 5 and the list check (M3); until then no gifts for signed-in accounts. |
| T9 | SHELL | `src/core/settings.ts` + the Settings block of `src/contracts.ts` | section 11.9 (one change). |
| T10 | RENDER | `src/render/stage.ts` | the neck-swell stopgap in `framingFor` (STATUS known open) stays Home-only; places frame their bounds. Remove it when PHYS fixes the swell. |
| T11 | DOCS (the orchestrator) | `_spec/LOCK.md` | Rule 3 (section 2), after "switching squishy": "(PLAYGROUND, 2026-11-15: pressing another party member is not switching squishy: the first body keeps its locks, LIFE.md 5.5)". And, in rule 4's spirit: a locked lobe is HELD for its own squishy only; it never silences the party (LIFE.md 10.2, D-84). |
| T12 | DOCS (the orchestrator, before the Stamp tool ships) | `_spec/FUN.md` | Rename the queued **Stamp** tool (FUN 1), for example to **Prints**, because "stamp" is the Journal's unit ("Opens at 28 stamps", the Stamps tab, "New stamp: ..."); a child would expect stamping a squishy to earn stamps (REVIEW_rules-and-clarity m6, V19). |
| T13 | INTEGRATION (the orchestrator, step 0, one heavy job) | none (a measurement) | **PF-00**: the phone factor F and the unit weights (14.2), reported in `_handoff/reports/PG_PF00.md`, before PG_LIFE fixes `attention.ts`'s caps. |
| T14 | DOCS (the orchestrator) | `_spec/NEXT_STEPS.md` | The PLAYGROUND paragraph (about line 206) still quotes "total 1900 KB": it becomes "total 2000 KB (D9's ceiling) with a 150 KB life chunk and a 90 KB away chunk" (D-69, D-92, 14.3). FUN.md section 4's "the Float setting itself stays for one squishy at Home" already matches D-83. |

## 18. The acceptance checklist (N = node, B = browser, O = offline audio; ids per lane)

**DATA** (`_harness/probe_pg_data.ts`, N)
| Id | Check | Bar |
|---|---|---|
| DT-01 | every PlaceDef, **both layouts**: every collider inside the walls' rectangle (wide) or the tall frame (abs x at most 1.82 - 0.128 z, z -3.7 to 3.4, PLACES P7) and **every use spot, peek spot, ring gap waypoint (0.6 m outside the gap's mouth), swing push spot and rider spot inside the rounded bounds, with a body of R 0.625 centred there clear of every wall and 0.625 m from every collider but its own thing's** (a ring's inner spot: its clear inner radius), these spots being exempt from LIFE's R + 0.2 m shrink (revision 4, D-90); none in the pad, **no physics zone reaching into the pad either** (water, current, wind, updraft, magnet: a dry, still pad; warm, cold, wet and echo flags may reach its edge, PLACES P6); spawn spots at least 0.9 m from every thing, a moving prop's swept range counted (a swing's arc, a seesaw's tilt, a chime's swing), inside the bounds shrunk by 0.825 m, at least 1.0 m apart (1.25 m where the place allows), at least 5 (one per whole of the high tier); **every rider's whole path inside the rounded bounds** (a swing's seat centre over its arc, rope x sin(limit) to each side; a seesaw's rider spots) **with a rider of R 0.625 on it clear of every wall and 0.625 m from every other collider, and each swing's push spot (the end of its arc plus 1.3 m) inside the bounds with a pusher of R 0.625 clear** (revision 4, D-91: the revision 3 check took only the rider's rest spot, so the tall cabin's rider left the bounds by 0.58 m); thing-to-thing clearance at least 0.3 m with swept ranges (walls excepted); static things in the front band at most 0.4 m tall; parameters inside MECH_RANGES; **a seesaw's floor rule: pivot >= (L / 2) sin(limit) + (t / 2) cos(limit)**; every collider part at least 0.16 m thick, a ball r at least 0.20, a capsule's length taken as its total length with both caps; at most 8 moving props and 20 primitives (D-55); **a ring's clear opening at least 1.35 m** (the chord minus both segment radii: the largest body, 2 x 0.625 + 0.1); water surfaces at most 0.30 m; ramps at most 16 degrees; pads and turntables flush; swing seats at most 2.0 m/s from rope and limit (with GRAVITY 10). **Home** (spots in slot units, D-67): every thing at least 0.275 m from every body of every `stage.matLayout` slot (both frames, 1 to 5 bodies, body scale 0.8 to 1.25, R = 0.5 x scale), the free Felt Ball at least 0.05 m; things 0.3 m apart; **and, for each thing and frame, a spot that shows from its `fromN` (at most 3, revision 4, D-88): its footprint corners at y 0 and at its top inside the HUD insets at every party from `fromN` to 5 and every scale, its top centre behind no slot body and no other shown thing, nothing over 0.4 m tall in front of the front slot row, and its use spot (the lamp's glow, the rug's second napper, the pad) with a whole body in view and clear of the other slot bodies; the rug's centre within 0.65 m of slot 0 at every scale; every slot centre inside the corral rectangle (D-87); the HUD insets from the UI overhaul's table (11.13)** | all; each moved thing reported |
| DT-02 | the name gate split (PLACES 7): coined words NAME rules, the rest PROSE rules, run over every name, every player line **and every reaction cell of PLACES 3 and 4** (they are the source of the family lines); pop dome promise words; the copy words of QUESTS Q10; CS-05 **on names only** (places, things, zones, patches, keepsakes, chapters: first four letters, edit distance 2 for coined words, unique prefixes) | 0 hits |
| DT-03 | favourites: 50 rows; each place beyond Home at least 4 fans and 1 Common fan; each family in at least 2 places; the thing in the place; each gift list 3 Common or Uncommon fans of the next place; **every favourite thing has an event its fan can make by itself (a USE, or a REACT with that thing), or is a ride, or is a switch counted when the player taps it with the fan watching within 1.5 m** (QUESTS 9 F2) | all |
| DT-04 | best friends: a perfect matching, symmetric, cross-lane, tier gap at most 1 | all |
| DT-05 | FAMILY_REACT and GAITS cover 12 families, values in range; S1 hop vy at most 0.84 | all |
| DT-06 | every family has at least 3 reactions **with a real channel** (a pose target, a render pose, a look and its level, a particle preset, a sound id or a behaviour id; D-80) in every place; a cell whose only effect is a word or the place's light fails | all |
| DT-07 | the data modules are flat, acyclic, and each loads first in a bare node (probe_genome 87-120) | all |
| DT-08 | text lengths and readability (QUESTS Q10) | all |
| DT-09 | each title's verb matches its rule's event (a reviewed keyword table), **except a VISIT quest's title**, which may name the place's feel because its hint carries the verb ("Go to Ripple Shore."; QUESTS Q7: "Sand and sea", "Pitter-patter", "Bubbles up", "Tick, tock"); every hint matches its rule's count ("two times" for x2) | all |
| DT-10 | the float table is generated from density x depth x radius band; every water reaction cell agrees; every resting body's eye anchor at least 0.10 m above every water surface (CS-07) | all |
| DT-11 | the salts differ from each other, from the 16 in src and from the 2 base seeds (LIFE.md 11), re-grepped from src | all |
| DT-12 | every self-use is floor level; every ride is flagged and has a ride wish | all |
| DT-13 | each place has a signature verb event and a finale spectacle id; no mechanism is the headline of more than 3 places | all |
| DT-14 | the append-only id lists (places, things, quests, keepsakes, emotes, facts, REACT kinds, USE verbs) match a frozen lock list | equal |
| DT-15 | every REACT kind a quest or fact uses has a `REACT_TRIGGERS` row (condition, once per visit or per event, how `thing` is set); every quest rule that filters a REACT by thing names a thing that owns a zone or patch, or a `lifeAddLook` source (D-72) | all |
| DT-16 | `THING_KINDS` matches the things of each place (a bit per thing-wish glyph kind: ball, bell, droplet, note, flame, sun), so the wish scheduler's mask (LF-25) is true to the data | equal |

**LIFE** (`_harness/probe_life.ts`, `probe_life_imports.ts`, N)
| Id | Check | Bar |
|---|---|---|
| LF-01 | the same seed and snapshot script give the same intent hash over 10 sim minutes, 3 seeds; another seed differs | equal |
| LF-02 | allocation in lifeStep after warm-up | 0 B over 6000 ticks |
| LF-03 | cost at 16 characters | median at most 0.1 ms a tick |
| LF-04 | a HELD character (touched, carried or locked) gets 0 motion intents in the same tick, its queue is cancelled, and none for 1.5 s after release; **a lock with no finger down silences nobody else**: other characters' bubbles and voices go on unducked (D-84) | always |
| LF-05 | no intent kind can press, grab or lock (type-level), and the host source holds no `fingerDown`, `grab` or lock call | 0 |
| LF-06 | no free target (wander, come back) outside the bounds shrunk by R + 0.2; no target at all outside the bounds; none inside a keep-out except its own thing's use spot; a use spot, peek spot, gap waypoint, push spot or rider spot is taken as DT-01 laid it (D-90); **at Home every target lies on a segment between two framed points** (the home slots of `lifeSetHome` and the arrived things' use spots, within 0.01 m, D-87); the bounds come from `lifeSetPlace`'s def and layout (D-89), so the wide and the tall layout give different targets | 0 |
| LF-07 | a storm at the snapshot's capacity (16 characters, for example 6 wholes and 10 pieces in a synthetic snapshot, asking 50 a second): no cap of LIFE 10.1 exceeded in any rolling second, all four columns, the wish slot and wish dots included; a P1 never starved | 0 over |
| LF-08 | 6 pieces doing one action within 0.5 s give 1 bubble and 1 voice | exact |
| LF-09 | every behaviour and social moment fires in its scripted scenario (S07 gathers 3 idle squishies into a row by itself; S13 uses the two peek spots); a 5-minute visit to the cabin on med with 4 wholes and no input gives every pair one greet, at least 1 nap, and each squishy 2 to 3 thing uses | all |
| LF-10 | movers never exceed the tier's moverCap; every start that wakes a body keeps units at most unitCap; a start that wakes nobody needs only a mover token; every joint moment moves one character at a time (S15 and S18 hop together only where moverCap is 2 or more, otherwise they dance with the render sway). **Revision 4 rows (D-85):** on low at F = 4 with 3 wholes all asleep (units 0.09), a start that wakes one is granted (1.06, the cap) and a second mover is refused; one awake and two asleep is not over the cap; on med with 4 asleep likewise; with one rider the player set on the Pillow Swing and the others asleep, S11's pusher starts on low and on med (the ride allowance) and the over-budget rule never cancels it; two riders teeter on the Rocker Board on low and on med; a boop on low and med is a soft boop (the target stays asleep, its wobble a render wiggle) and on high a physics boop | always |
| LF-11 | no character is in two joint moments at once | 0 |
| LF-12 | the import purity of `src/life/**` | 0 |
| LF-13 | the huff's triggers are squishy-to-squishy scene events only (a static table), it lasts at most 3 s, ends on any touch, never in a session's first 60 s (CS-04) | all |
| LF-14 | wishes: at most 1 a squishy, 1 wish bubble on screen (a second open wish only as its still dot), 3 kept, 180 s per squishy and 120 s overall between new ones (the scripted first wish exempt, and no natural wish before it), at most 2 re-glances; the scripted first wish by 5:00 | all |
| LF-15 | friendship: at most 20 a pair a day; levels at 12 and 40; at most 128 rows; eviction never drops Friends or closer, or a best-friend pair | all |
| LF-16 | the same sim time stepped at 30 and at 60 fps gives the same decisions | equal |
| LF-17 | Calm and reduced motion: hop chains at most 3, no wiggle over 2 Hz, no bob, the Calm caps | all |
| LF-18 | (S2) water: every untouched character in a water zone heads out within 30 s by itself (a floater too) and never naps there (LIFE.md 5.3) | all |
| LF-19 | the six scripts of LIFE.md 4.1 each do what the table says in a scripted scenario; FIRST_PLAY and FIRST_WISH fire at most once per profile; **FIRST_WISH with no Dollop owned, with Dollop on the shelf, and with a touch wish due before 2:30**: the wisher is chosen by D-70, no natural wish shows first, and the wish shows by 5:00 | all |
| LF-20 | looks (LIFE.md 3.1): each rises and falls at its rate per family (a look falls at its "elsewhere" rate only while its rising cause is absent, so a cold 0.3 zone still frosts), keeps its level through a ceremony and resets on a trip or the shelf, emits its REACT once per visit at 0.5; a `lifeAddLook` emits its REACT every time with the source thing; `lifeLooks` and `lifeAddLook` allocate 0 B | all |
| LF-21 | REACT events from LIFE's real output: every kind of `REACT_TRIGGERS` fires under its condition whatever behaviour wins, with the thing set as the table says (the Rock Pool and the Surf Edge give different things) | all |
| LF-22 | PIECES: a whole already in the hearth's warmth cut into 3 gives one PIECES WARM with n = 3 at the cut; three pieces walking in single file give n = 1, 2, 3 (the third meets minN 3); the cut group moves again 1 s after the swipe with the Cut tool in hand | exact |
| LF-23 | RIDE: a squishy set on the rocker is still on it 15 s later with no input; a lone rider shows its star bubble (P1); a touch ends it | all |
| LF-24 | autonomy off: 0 hops, scoots, glides and squash poses issued, except for a player-asked use ("Go play with...") and a ride the player set up, which move only that squishy; gaze, render leans and sways, bubbles and voices stay | all |
| LF-25 | thing wishes target only the kinds in `lifeSetJournal`'s thing-kind mask (open, shipped places), and a favourite only once its place is open | 0 outside |
| LF-26 | sim time only: the same scripted run with music on, the music clock frozen, and the music clock jumping gives the same intent hash (no AudioContext reading enters LIFE, D-66) | equal |

**PHYS** (`_harness/probe_playground.ts`, N: **with no arguments the quick set, under 20 s**, which is what `run_probes.ts` runs (it passes no
arguments, run_probes.ts 12); `--full` runs every row on 12 families x 3 genomes (about 1 to 2 minutes: a heavy job); PH-13 behind `--heavy`)
| Id | Check | Bar |
|---|---|---|
| PH-01 | hops on 12 families x 3 genomes and 1/8 pieces: apex (the lowest particle's rise above the ground) within +-25% of target; S1 apex at most 3.6 cm (the ballistic 3.53 cm of vy 0.84 with GRAVITY 10) and no `land`; no second hop; no fold over 120 degrees; no hop or squash while memory is busy; the S2 raised hops with `auto` landings per family | all |
| PH-02 | the touch gate eases LIFE drivers (`scootTo`, `setSquash`, `hop`) out within 0.12 s; `moveTo` (ceremonies, the cut's steering) and every other ceremony driver untouched; `scootTo` yields to `moveTo`; a lock counts | all |
| PH-03 | static props (block, bar, mound, ring) x 12 families x 3 genomes and detail-2 pieces, dropped on and walked into: no fold over 120 degrees, no NaN, penetration at most 1% R; a body rests 3 s on a box top with creep at most 2 mm and sleeps | all |
| PH-04 | seesaw and swing with 2 bodies for 60 s: inside the limits, energy only decays; a seesaw tips under a sitter (weight transfer); teeter hops from the board; the seat at most 2.0 m/s; **a rider is never corralled while it rides** (the corral is off for a body supported by a moving prop, D-91): a rider set at a swing's or a seesaw's end next to the bounds' edge keeps its seat for 20 s | all |
| PH-05 | the ball: at most 2.0 m/s, never through a wall, rests within 6 s; no particle over 6 m/s from a prop contact | all |
| PH-06 | mass parity: one species at detail 3 and 2 tilts a seesaw within 5%; a 1/8 piece an eighth as much | within |
| PH-07 | squash poses keep the volume inside the family band (G1) | all |
| PH-08 | ground modifiers: ice glide distances rank by ice grip (Spearman at least 0.8); sand stops a slide within 0.3 s | all |
| PH-09 | sleep within 1.0 s at rest; an asleep step at most 0.03 ms; each wake cause wakes it; a pile of 3 sleeps within 3 s as an island and stays asleep 60 s; memory families sleep at max abs(MEM - Q) under 0.02 R; zero jump on wake | all |
| PH-10 | determinism with props, zones and sleep; the re-baselined hash rows listed in the report | equal |
| PH-11 | allocation with props, zones and drivers, over 120-frame windows in which no SoftEvent fires (an emitted event allocates three objects by design; reported separately per event) | 0 B per window |
| PH-12 | an awake detail-3 body with 4 props in reach (the worked-contact fold gate on) | at most 1.25x |
| PH-13 | (heavy, optional, S3) 50 species at detail 2 with rest, press, pull and hop rows | listed |
| PH-14 | `auto` on hop, pad and fall landings, prop bumps and **body-to-body bumps between two untouched bodies** (with `other` set), never on a player toss or a bump with a body the player touches (a finger, a grab or a carry); **a LIFE body bumping a locked body nobody touches gives an `auto` bump** (revision 4, D-86: a lock alone never counts), and that bump reaches no `feedback.handle` and no haptic (SH-06); the largest autonomous landing speed per family reported | exact |
| PH-15 | (S2) water: float or sit matches the generated table, 12 families x 3 radius bands; drift only when floating; no NaN; clean exits; the bulge slosh in water; **`scootTo` glides a floating body horizontally with the water holding its height, and a floater scooted to the nearest dry spot leaves the water and becomes a sitter** (revision 4, LIFE 5.3) | all |
| PH-16 | (S2) the flush pad: apex at most the cap for every family; at most 5 bounces; the sticky hold within +-0.1 s | all |
| PH-17 | (S3) wind and updraft only on airborne or floating bodies; nothing wakes under 0.25 m/s^2; the magnet moves only the steel marble | all |
| PH-18 | bounds hold 200 random 6 m/s tosses within bounds + 0.1 m | all |
| PH-19 | bound radii cached once a frame; asleep pairs skipped; with `contactSlot`s set, bump events and `contacts` bits right past 40 bodies made in a session (no two partners share a memory slot) | all |
| PH-20 | `carryTo` emits no poke, press, release, grab or snap, and lands without NaN | 0 |
| PH-21 | (moved to SH-11: the Float rule is the shell's, D-83) | |
| PH-22 | `sleep()` sleeps a body at rest at once and refuses one that is moving, on a moving prop or in float mode; an identical `setSquash` never wakes; a `mods` write wakes only when a modifier that acts where the body is changes by more than 0.02 | all |
| PH-23 | the prop order and map: `propThing` and `propPart` follow ThingDef order with walls last; `drainStrikes` reports cause 0 for a poke, 1 with the slot for a body, 2 for a gust or a wave | exact |
| PH-24 | (revision 4) Home's corral rectangle: a body resting at any slot of `stage.matLayout` (1 to 5, both frames, scale 0.8 to 1.25) with Home's `setBounds` rectangle (D-87) is never moved by the corral over 10 s; a body tossed outside it glides back inside | all |

**RENDER** (`_harness/browser_render.mjs` new sections `place`, `props`, `emote`, `marks`, `pose`; port 5364; B)
| Id | Check | Bar |
|---|---|---|
| RD-01 | each place boots (`place=<id>`): 0 console problems; the `sky` section passes | all |
| RD-02 | the 50-species gallery in each place: closest pair at least 10/255; med and low drift p90 at most 15.8; with looks at 0, Home's gallery is pixel-identical to v4 | all |
| RD-03 | the flash gate per place for every ceremony tier, with the ceremony dim easing over at least 1.0 s | at most 2 flashes a second |
| RD-04 | bubbles at least 36 CSS px on 390 x 844; the ink icon **and its one accent** each at least 3:1 on the cream fill (the leaf lagoon, the moon an ink crescent with an amber fill, the postcard's sky band in an ink frame); the edge at least 3:1 on each place's sky; never under the insets; one draw | all |
| RD-05 | sleeping bodies do 0 fine-mesh updates; 4 asleep cost at most 0.3x the CPU update of 4 awake | at most |
| RD-06 | 6 pieces vs 2 wholes frame ratio with the lite chunk mesh | at most 1.2 |
| RD-07 | 10 place swaps: programs, textures and geometries back to Home's baseline +-2; context loss in a place restores | equal |
| RD-08 | the set and props of a place | at most 60 draw calls |
| RD-09 | Calm **or** reduced motion (each on its own): bubbles fade only, a wish re-glance is a 0.2 s opacity lift (no grow), Home's thing arrivals and the keepsake drop fade, weather x0.3 or none, no camera moves | all |
| RD-10 | expressions are eyes only (no blush, no mouth) | visual pass |
| RD-11 | a swaying sleeper's eyes stay on its skin | within 1 px |
| RD-12 | eyes seen through another body's jelly are depth-faded (no four-eyed look) | visual pass |
| RD-13 | the play area's mean linear luminance at most 0.35 per place; no pastel; token colours only (CS-06) | all |
| RD-14 | no camera motion while only autonomy moves bodies, at Home and in places | 0 |
| RD-15 | water: the surface draws over the right bodies, the tint below the line, the edge ring hides the side | visual pass |
| RD-16 | Home in view (D-67; revision 4, D-87, D-88): at 390 x 844 and 1280 x 800 with 1 to 5 bodies at body scale 0.8, 1.0 and 1.25, every Home thing that shows (its `fromN` reached) lies inside the frame and outside the HUD insets with its top centre behind no body; **a whole body (its box and its top) at every LIFE target and every use spot** lies inside them; every slot centre lies inside the corral rectangle passed to `setBounds`; `visibleTable` matches the rendered frame within 0.05 m by section 9's exact definition | all |
| RD-17 | on-screen size (14.4): on 390 x 844 with the tall layout, a 1 m squishy at least 100 CSS px wide at the front of the play area and 80 px at mid-depth; on 1280 x 800 with the wide layout at least 150 px at mid-depth; every place, both layouts framed whole inside the insets | all |

**AUDIO** (`_harness/audioview/life_checks.mjs`, O; AU-10 N)
| Id | Check | Bar |
|---|---|---|
| AU-01 | creature syllables: peak inside the level band, no click (a step under 0.25), tail under -60 dB, on D pentatonic within +-10 cents | all |
| AU-02 | the 6 flavours pairwise at least 3 dB apart in at least one third-octave band | all |
| AU-03 | player effects over chatter and ambience: in-band at least 8 dB, K-weighted at least 10 LU | all |
| AU-04 | the music stem's pumping metrics unchanged with chatter and ambience running | equal |
| AU-05 | a storm of 50 requests a second: at most 2 live chatter groups (phone caps); peak at most one voice + 3 dB | all |
| AU-06 | each ambience at least 6 dB under the music long-term; pause and mute free its nodes within 0.2 s; no audible 2.5 s seam | all |
| AU-07 | every existing seeded render bit-identical (new rng streams, the default MusicStyle) | equal |
| AU-08 | sung notes on the sounding field's rest tones within +-10 cents, on the eighth grid within +-15 ms | all |
| AU-09 | chatter silent during ceremonies and for 1 s after | 0 |
| AU-10 | `ChatterLimiter` pure with synthetic time (N) | all |
| AU-11 | at most 4 nodes per syllable; 5000 syllables return to the baseline node count; changing the caller's reused `p` object and `phrase` array right after a `creature()` or `prop()` call changes nothing already scheduled (audio kept no reference) | all |
| AU-12 | the echo: one repeat at +220 ms and -12 dB, no DelayNode | exact |
| AU-13 | while the player touches (a finger down, a grab or a carry), chatter is 6 dB down and at most 1 syllable a second; **a lock with no finger down ducks nothing** (D-84) | all |
| AU-14 | with no input, tunes (the kettle's whistle, a Music Box tune) sound at most 20% of a 10-minute cabin visit; the Music Box starts at most once per 40 s and a second tap stops it; no kettle whistle within 60 s of a Music Box tune (D-81) | all |

**QUESTS and COLLECTION** (`_harness/probe_quests.ts`, `probe_journal.ts`, N)
| Id | Check | Bar |
|---|---|---|
| QU-01 | the reducer is pure and allocation-free (0 B over 10 000 events); no meter import; no capsule-roll text (probe I03) | 0 |
| QU-02 | every quest completes from its generated minimal event script; replaying changes nothing; a near-miss script does not complete it | all |
| QU-03 | the fairness rules (QUESTS Q3, Q4): no TOUCH clause accepts a press under 0.4 s (no quest needs a tap or a poke on a squishy; taps on things, switches, balls and bubbles are fine); every clause reachable at low caps with one mover at a time, **with the gate of LIFE 10.3 as revision 4 writes it** (D-85: the floor, the ride allowance for C3, L9, U4, C5, G3, and the soft boop), checked against LF-10's scripted gate, not by hand | all |
| QU-04 | the count rules (Q5) | all |
| QU-05 | each finale opens at 5 of 7 main quests (Home's at the first wish), never earlier | exact |
| QU-06 | stamp thresholds open places in order; an unshipped place is skipped and its stamps kept | exact |
| QU-07 | each gift finale has a player-caused clause: an event kind only the player makes (TOUCH, PHOTO) or a clause with `by PLAYER`; a script where LIFE alone grants a nap, song, thing or warm-up wish completes no gift finale | all |
| QU-08 | every event kind a rule uses has a named producer; a photo counts at the shutter; the producer and the reducer agree on every field a rule reads (a REACT's thing, a PIECES count, a USE RING's part in `v`, flag bit 3) | all |
| QU-09 | keyboard parity (CS-02): **K is derived per clause from a producer table of the keyboard routes** (PLAYGROUND_BUILD 11.8: Space, the stretch, "Go play with...", "Tap it yourself" for every switch, ball and thing a tap swings (D-93: the Shake Pine, chimes, bells, crystals and lanterns part by part, a seesaw end, a swing seat), Enter on a bubble, the Wishes now list, the Cut bar, the shutter, Travel), never from a hand-written tag; a quest tagged K whose clauses no route can produce fails the row (revision 3's I4); the K quests of every opened set reach every threshold | all |
| QU-10 | no path ever decrements stamps, warmth or friendship (CS-13); no main quest has a within-visit clause | 0 |
| QU-11 | a scripted regular-player stream opens the places near the times of QUESTS 7 (reported, +-50%) | reported |
| QU-12 | the wish caps of QUESTS 8 at the reducer and store level | all |
| QU-13 | every quest of a shipped chapter completes from a scripted run of the **real** `lifeStep` and the host's ring writes (node), not only from synthetic records: C6 by a cut in the warmth, R2 and R6 in the Rock Pool, the snuggle of R8, the peekaboo of R5 and E7 | all |
| QU-14 | in every slice build, every shown quest can be completed with the shipped places and their thing kinds; a quest that cannot is hidden and the tracker skips it; a finale is shown once its chapter can reach 5 shown main quests (S1: Friends Everywhere shows X1, X2, X3, X6 and X10 only) | all |
| QU-15 | the first wish with no Dollop owned, with Dollop on the shelf, and with every character held or quiet until 5:00: a wish shows (or rests in the Journal) and Hearthlog opens by 5:00 of play; H8 completes on the first arrival at Hearthlog with any party | all |
| QU-16 | autonomy off (QU-09's twin): every opening threshold is reachable with "Squishies move on their own" off, by-SELF clauses accepting by-PLAYER records that carry flag bit 3; a quest that still cannot be done shows "Needs: Squishies move on their own" | all |
| CO-01 | the journal store: save, load, hostile JSON, park, a newer version read-only | all |
| CO-02 | the worst-case journal | at most 16 000 chars |
| CO-03 | the two-tab merge is a union or a max for every field; merging a blob with itself is the identity | all |
| CO-04 | the backfill from an existing v2 hoard runs once and marks F0, H1, H3 and H4 as QUESTS 13 says | exact |
| CO-05 | the gift grant interrupted after each of its 3 steps, **step 2 with a failing storage (quota) then a reload** (the gift stays pending, never granted without a row), plus a round trip through today's `serializeHoard`, plus two tabs: exactly one gift per chapter; at most 5 for life; at most 1 a UTC day; listed species only; origin restock (the Hoard shows "Gift"); the id matches ID_PATTERN; the shelf cap keeps it waiting (CS-03) | exact |
| CO-06 | a merge keeps the larger warmth; warmth pruned to the shelf only after a pruned parent's warmth has moved to the blend row that names it (a lagging journal write never lowers warmth) | exact |
| CO-07 | probe_collection 73/74 (C08 is the known open row) and probe_collection_imports unchanged | equal |
| CO-08 | the journal touches the hoard key only through `ghostGrantGift` | 0 others |
| CO-09 | a non-practice ledger gets no gift (M3), and its plate reads "Your gift will wait here for now." with no Yes button | 0 |
| CO-10 | ids are classified by their Hoard item's ledger, not by a prefix: the slice-1 starter's old id and a `jg-` gift stay practice; real-ledger rows sit under the blob's one `acct` and leave on sign-out | exact |
| CO-11 | over the 16 000-character cap the pruning order of PLAYGROUND_BUILD 12 holds (`fd`, then Met-only `fr`, then unnamed `ids`; never warmth, facts, quests, keepsakes, places or gifts), and a refused write loses nothing in memory or in the stored blob | exact |

**ECONOMY** (N; EC-04 heavy)
| Id | Check | Bar |
|---|---|---|
| EC-01 | the probe_economy pace rows pass unchanged (3.0 to 3.8 active min a capsule) | pass |
| EC-02 | the real shell rig with LIFE on, 4 moving mock bodies and the real collection, 60 sim minutes with no input (LIFE L3: "a no-input hour"; JUDGE_COHERENCE CS-01), travelling to every place: 0 SP, 0 task progress, 0 capsules, 0 gifts claimable, 0 haptics **while more than 0 quest moments played** (the self-completed quests still show their moment, D-84), 0 camera moves; plus one 2-minute run on real SoftBodies with two LIFE bodies booping (body bumps with `auto`: 0 haptics, 0 `feedback.handle` calls for them; CS-01) | 0 |
| EC-03 | every `auto` or `prop` event is dropped before `collection.feed` (a spy) | 0 |
| EC-04 | (heavy, optional, once) sim_economy section K with 5 gifts | shift under 1 day |

**SHELL and UI** (node_checks N, browser_shell B)
| Id | Check | Bar |
|---|---|---|
| SH-01 | N: the LIFE host acts before `bodies.step` and senses after `drain()`; deterministic under `DebugHook.step` **with the music on** (two runs, equal intent hashes; no `musicClock` reading in the snapshot, D-66); 0 B per frame over 600 frames with no physics event | all |
| SH-02 | N: the party is back within 0.5 s after a ceremony, a trip and a Hoard preview | all |
| SH-03 | N: a cut with a party: the party stays; the piece limit formula; one squishy in pieces at a time | exact |
| SH-04 | N: the bus and hosts allocate 0 B a frame; 64 events in one frame arrive in order; overflow counted | all |
| SH-05 | N: a spy on `collection.feed` sees only player-caused events | 0 others |
| SH-06 | N: bumps between two untouched bodies under 0.8 m/s make no sound; **every `auto` event (lands, prop bumps, body bumps) reaches the attention wiring and never `feedback.handle`**; on two real SoftBodies booping (11.12): 0 haptics, 0 shakes | 0 |
| SH-07 | N: travel waits for idle, reconnects, releases locks, then swaps | all |
| SH-08 | N: the new settings saved by absence and applied live | all |
| SH-09 | N: the touch gate includes locks; pressing another party member keeps the first body's locks and pieces (CS-10) | all |
| SH-10 | N: any non-Hand tool quiets autonomy | all |
| SH-11 | N: the Float rule (D-83; was PH-21): Float works at Home with one squishy out (no PropWorld bound, Home's things parked, 0 LIFE motion); with more than one out or in a place gravity is forced at run time, the saved setting unchanged, the line once a session, and `setFloatMode(true)` never called | all |
| SH-12 | N: a tier drop sleeps, then shelves, with the kind line | all |
| SH-13 | N: autonomy off: 0 motion intents applied except a player-asked use and a ride the player set up (one squishy each); gaze, render leans and sways, reactions stay | all |
| SH-14 | B: keyboard only: J, P; **Tab reaches every DOM control and leaves the party** (one Tab stop, roving tabindex, [ and ] inside it, the 3:1 focus ring under the focused squishy); Space presses the focused squishy; the keyboard stretch; Enter opens the wish card or the popover and reads a showing bubble (H6); "Go play with..." and **"Tap it yourself"** (the fireplace, the Felt Ball; in S2, the Shake Pine and the Shell Chimes part by part, D-93); **C8 walked end to end by keyboard**; the Escape order, focus return | all |
| SH-15 | B: 390 x 844, 320 x 568, **844 x 390 and 568 x 320**: no overlap of pill, buttons, plate, capsule and meter; the wish card at most `min(358px, 100vw - 32px)` wide and 120 px tall, the plate `min(320px, 100vw - 32px)`; landscape puts the plate and the card in the left half under the pill; targets at least 44 px; grids take their columns from the width (CS-08) | all |
| SH-16 | B: quest moments at least 1 s from bursts, never over a reveal, one polite line each; a moment's haptic only when the completing record is by PLAYER, none for a self-completed quest; the live region is one queue (quest and wish lines first, at least 2 s apart) with the place-open and arrival lines | all |
| SH-17 | B: wish hit areas at least 44 x 44, never over the body's silhouette (CS-09), `tabindex="-1"`; every friend and place wish names its target in the card and the live region (CS-11) | all |
| SH-18 | B: Snap hides the DOM overlays; bubbles in the photo by default, off with the switch; **the shutter shows an in-page preview and pushes PHOTO at that moment, Save is optional: X8 completes with no download** (11.15) | all |
| SH-19 | B: the new-player flow in the real shell through the dev hook (FN-01), with a screenshot at each quest | pass |
| SH-20 | N: the tracker pill shows the first unfinished main quest of the current place's chapter that can be done now (K when the last input was a key, every clause's place shipped, not blocked by autonomy off), then Home's, then Friends Everywhere's; it never shows a hidden quest | all |
| SH-21 | N: Home's rules (D-67; revision 4, D-87, D-88), with `visibleTable` stubbed from DT-01's projection table: a thing shows only after its event and while the party is at least its `fromN`, and is parked (no collider) below it; **for n = 1 to 5, both frames and body scales 0.8 to 1.25, every slot centre lies inside the rectangle passed to `setBounds`**, and `lifeSetHome` gives LIFE every slot in use; the corral rectangle, the home slots and the Felt Ball's bounds follow the party and the frame, never autonomy | all |
| SH-22 | N: the awake budget (D-61, D-85): over `unitCap` (with D-85's floor, plus the riders' units while their ride moment runs) the shell cancels the farthest untouched LIFE mover, never a ride moment's own mover, and sleeps untouched still wholes until units are back under; on low with 3 out, one awake and two asleep is not over; touched, carried, tossed and riding bodies are never forced; travel spawns at rest and asleep except the first moverCap members | all |
| UI-01 | new colour pairs in `CONTRAST_PAIRS`, passing | all |
| UI-02 | reduced motion **or** Calm, each on its own: every new motion is a fade (the stamp, the Places button's scale-in, Home's thing arrivals, the keepsake drop, the wish re-glance as an opacity lift), no camera moves | all |
| UI-03 | sound off (muted or Voices at 0): the voice-to-bubble table is total, chat included (a chat shows one hello bubble on its first speaker, inside the budget); a voiced moment's bubble takes its voice's priority | all |
| UI-04 | every new HUD element in `_harness/uikit/` in every state | all |

**PERF and SIZE** (B)
| Id | Check | Bar |
|---|---|---|
| PF-00 | (step 0, once, heavy; T13) the phone factor F = one awake detail-3 whole's physics ms (resting, then pressed) in Chromium with a 4x CPU throttle over the same in node on this container, and the unit weights (a detail-2 piece, a touching pair, a sleeper once sleep exists, the props near a body); `attention.ts`'s caps are computed from them by 14.2's formula | reported |
| PF-01 | the med cap scenario in Hearthlog with a 4x CPU throttle, as the gate allows it (4 wholes: one touched and the rest asleep; then untouched, one LIFE mover and the rest asleep): physics at most 6.0 ms, LIFE and hosts at most 0.4, UI at most 1.0 (means) | at most |
| PF-02 | the low cap scenario (3 wholes, one awake): physics at most 4.0 ms (if one awake whole alone misses it, that is today's one-body cost, reported to PHYS, 14.2) | at most |
| PF-03 | the cut scenario (3 wholes and 5 pieces, med; the other wholes asleep before the cut, 11.4): physics at most 6.0 ms | at most |
| PF-04 | a 10-minute soak: no GC pause over 8 ms from src; the frame mean stable within 5% | all |
| PF-05 | N: PF-01's node twin on this container (the same scenarios) | at most 6.0 / F ms (1.5 at F = 4) |
| PF-06 | (revision 4, D-85) the ride case with a 4x CPU throttle, on low and on med, the other wholes asleep: two riders the player set on the Rocker Board teetering for 12 s; one rider on the Pillow Swing pushed three times by a LIFE pusher (the ride allowance); in Hearthlog, both layouts | physics at most 8.0 ms and the whole frame at most 16.7 ms (means over the moment); node twin at most 8.0 / F ms (2.0 at F = 4) |
| SZ-01 | first load at most 1300 KB with the UI overhaul landed; the PLAYGROUND delta at most 70 KB (target 60) and each lane inside its first-load cap (14.3), measured at S0 | at most |
| SZ-02 | total at most 2000 KB; the life chunk 150 KB (with the five play-time UI modules, D-92); each place (its render, audio and data chunks summed) 45 KB, the away chunk 90 KB, the screens chunk 45 KB; no lazy chunk the gate cannot name; over a cap or the total, 14.3's overflow order was followed and reported | at most |
| SZ-03 | no lazy module in the first-load closure | 0 |
| SZ-04 | no dev names in the production bundle | 0 |

**FUN** (the verifiers, by eye and by script)
| Id | Check | Bar |
|---|---|---|
| FN-01 | the first minute: on a fresh profile, once the player has let go for 6 s, Dollop does a visible thing use (notice, hops, a boop that moves the ball at least 0.2 m, all inside the frame) within 10 s; its first labelled bubble within 10 s of that first 6 s release (a held squishy shows no autonomous bubble, L2); the newcomer says hello within 5 s of coming out (node through the dev hook, then once in the browser at 390 x 844 and 1280 x 800). **Revision 4 caveat:** by projection, on 390 x 844 with one squishy the Felt Ball's spot leaves only 0.02 / 0.09 / 0.16 m of roll room away from the body at scale 0.8 / 1.0 / 1.25 (the best spot anywhere in that view, 0.08 m; `pg_fix4/homebounds.mjs`, `ballroom.mjs`), so the 0.2 m cannot hold there today: section 24's first question decides how; on 1280 x 800 it is 0.24 / 0.38 / 0.55 m | pass |
| FN-02 | "own way" by the fire: a screenshot by the hearth with jelly, marshmallow, mochi and slime shows 4 visibly different shapes or looks, named by the verifier | pass |
| FN-03 | every place's signature verb event fires in a 5-minute scripted visit | all |
| FN-06 | a 10-minute visit to the cabin on med with 4 wholes and no input: each squishy at least 2 social moments and 2 thing uses, one mover at a time where the caps say so; the phone bubble cap never exceeded | all |

**COHERENCE and SAFETY map** (JUDGE_COHERENCE 8): CS-01 = EC-02 + QU-07; CS-02 = QU-09; CS-03 = CO-05; CS-04 = LF-13 + DT-02; CS-05 = DT-02; CS-06
= RD-13; CS-07 = DT-10 + PH-15 + LF-18; CS-08 = SH-15; CS-09 = SH-17; CS-10 = SH-09; CS-11 = SH-17; CS-12 = SZ-01 + SZ-02; CS-13 = QU-10 + CO-06; CS-14 = LF-01 +
LF-26 + SH-01 (LIFE reads no clock, not even the music's: the units and the music fields are deterministic parts of the snapshot). CS-02 also needs
SH-14 (C8 by keyboard) and QU-09's producer table. FN-04 = QU-03 + QU-04; FN-05 = DT-02 + LF-13; FN-07 = DT-10.

## 19. Verification charters (detail in `_handoff/briefs/PG_VERIFY.md`)

Independent, fresh verifiers per lane and per slice, never the builder: (1) DATA and QUESTS (node: every DT, QU, CO, EC row re-run from scratch;
the save attacked by hand); (2) LIFE (node: determinism, storms, the huff table, the wish caps; a read of every behaviour against LIFE.md);
(3) PHYS (node: every PH row on all families, an independent prop and sleep torture set, NaN hunts, the hash rows); (4) RENDER (browser on 5370: every
RD row, screenshots of every place at 390 x 844, 320 x 568 and 1280 x 800, judged as an art director, flash and luminance by script); (5) AUDIO
(offline: every AU row; a written first-listen checklist, since nobody has heard the audio yet); (6) SHELL and UI (node then browser on 5372: every SH
and UI row, a keyboard-only walk of a whole chapter, a screen-reader name pass); (7) the WHOLE GAME, per slice (browser on 5374: a fresh-profile
10-minute play through the dev hook, FN-01, FN-02, FN-03, FN-06, a 60-minute no-input economy run (EC-02, LIFE L3), the size gates, the copy and
dark-pattern audit, a parent's eye on every place, both layouts). Each verifier writes `_handoff/reports/PG_VERIFY_<area>_<slice>.md` with real
numbers, screenshots it looked at, PASS or FAIL per id, and what it did not check.

**Harness time (JUDGE_FEASIBILITY F25):** the full render run is already about 52 minutes, so per-place browser rows run only for the places
whose chunk or shared kit changed (the report names a hash of each place chunk), with one full sweep before each slice ships. The audio "O" rows
are OfflineAudioContext renders in headless Chromium (a heavy job, one at a time), not node; only `ChatterLimiter` and the phrase planning are node.

## 20. The name gate run (2026-11-15)

The real gate code of `_harness/probe_catalog.ts` 76-298, copied unchanged into a scratch module, screened 8 coined words and 146 names with the
rules of PLACES 7 (0 hits after the renames of D-49), and 434 texts (every quest title and hint and every quoted player line in PLACES, LIFE and
QUESTS) with the PROSE rules and the copy rules: 2 hits fixed (the hint "Turn the magnet on" read as the 8-letter wide-list name "magneton";
"No hurry" used a copy-gate word), 0 left in player text.

**Revision 3:** the 557 family reaction cells of PLACES 3 and 4 had never been screened, and they are the source of the F4 to F7 family lines;
the reviewer's run of the real gate over them (REVIEW_rules-and-clarity, 1231 texts) found hits only in "stops it dead" and "stops the marble
dead" (the word "dead"), "beans in a pot" ("pot") and "clinky" (close to "slinky"): all replaced ("stops it still", "beans in a jar", "tinkly").
I then screened every new or changed name and line of this revision (4 names: Fireplace, Fireside Warmth, Window Chill, Splash Spots; 71 titles,
hints, live lines, card lines and cells) with the same gate code (its scratch copy matched `probe_catalog.ts` 76-298 line for line), the Q10 copy
words and lengths and CS-05 on the names: **0 hits**. After the last edits of PLACES, QUESTS and LIFE I screened the pages whole once more
(scratch `screen_r3.mjs`: all 948 reaction cells of PLACES 3 and 4, every quest title and hint, every quoted line of the three pages; 1042
distinct texts and the 4 names): 0 hits in player text; the 11 hits are rule rows quoting the banned words themselves (QUESTS Q10, LIFE L6's list,
the "No hurry" note, PLACES 7's "Squishy chatter" note). DT-02 now screens every cell as well as every name and line.

## 21. Risks and what limits each

| Risk | Limit |
|---|---|
| the phone is slower than the assumed factor | PF-00 measures F at step 0 and the awake budget follows by formula (D-61); every moment is turn by turn, so even moverCap 1 keeps every quest reachable; if one awake whole alone misses low's 4.0 ms, that is today's one-body cost, a PHYS perf item (STATUS known open) |
| one mover at a time reads as less lively than the proposals' scenes | the still channels carry the life (gaze, bubbles, voices, render leans and sways at about zero physics cost, L4); the caps rise with the measured factor (F = 3 gives two movers on med); the FN-06 verifier judges it by eye |
| the life chunk lands late on a slow connection | Home is today's toy until it lands and the ring keeps the player's events; a load failure retries on idle (11.14) |
| a tall layout cannot fit a place's things | the cabin's passes DT-01 with 0 problems after a scripted search (PLACES 4.2); for the S2 and S3 places the DATA lane lays both layouts with DT-01 before each slice ships, and may drop a thing from the tall layout only with a quest that still completes (QU-14) |
| prop edges crease skin, or support on props misbehaves | the worked-contact fold gate, the 0.16 m rule, PH-03 and PH-04 on 12 families x 3 genomes and pieces |
| a seesaw does not tip because a sitter is weightless | the weight transfer (D-12) and PH-04's "tips under a sitter" row |
| 3.5 cm hops read too small | the pose (squash and stretch) in S1; the raised per-family hops in S2 after PH-01; FN-01 judged by eye |
| chatter is not cute | every voice is behind a slider and a cap; a first-listen checklist in the S1 verification |
| shallow water reads as too little | the render's deep-colour gradient and caustics; floaters drift visibly; DT-10 keeps the text true; the owner may veto (V9) |
| the first load grows past 1300 KB | per-lane first-load caps measured by every lane at every step with the one-file build (14.3); LIFE and the Journal are in the post-play life chunk; SZ-01 at S0 |
| sleep changes hash rows | opt-in `sleepEnabled`; the re-baselined rows are listed (PH-10) |
| SHELL-4, the UI overhaul and physics round 3 slip | the pure lanes (DATA, LIFE, QUESTS, AUDIO creature, RENDER emotes) do not wait for them |
| a ride moment's two awake wholes overrun low's frame (revision 4) | the ride allowance is bounded (at most two awake wholes, for the moment's length, D-85) and measured by PF-06; if PF-06 misses, section 24 lists the choices; the floor never admits more than one awake whole outside a ride |
| the UI overhaul's HUD insets differ from the ones Home's spots were laid with (revision 4) | DT-01's Home row reads the insets from a table the UI overhaul fills, RD-16 checks the real frame, and the DATA lane re-lays a failing spot before S0's exit (11.13); every spot now shows by 3 out, with room to spare in the search (homespots.mjs found hundreds of candidates per thing) |

## 22. What I did not check

I ran no probe, no browser and no build: every millisecond and kilobyte here is quoted from the maps and reports (PHYS map 4 and 6, SHELL_4.md
75-77, RENDER map 8, UI.md 2.7, STATUS) or is an estimate marked as one; nobody has measured a phone. No physics behaviour in these specs has run on
a real body (support on props, the weight transfer, the flush pad's kick, the hop, sleep islands, water as a gravity scale). Nothing has been heard
or seen. The luminance figures per place are estimates until RD-13. The minute-by-minute onboarding and the day 2 / 7 / 30 tables are estimates. I
did not read `src/shell/feedback.ts`, `src/render/face.ts` or `src/audio/engine.ts` beyond the maps' line references, and I did not check that
`makeRow` accepts a `jg-` id beyond reading it (it takes any id the caller guarantees; `sanitizeRow` checks `ID_PATTERN`, store.ts 84-111).
The continuing synthesizer read both: `sanitizeRow` keeps a row whose id matches `ID_PATTERN` (store.ts 84-106), and `DEVICE_ID_PATTERN` is
`^[a-z0-9]{8,40}$` (constants.ts 50), so `'jg-' + deviceId + '-' + chapter` is at most 46 characters of `[a-z0-9-]`. A blend row keeps at most
`PARENTS_MAX` parent ids of its own parents only (store.ts 101, 110), so the load check "named as a parent of a blend row" sees one generation:
a gift row merged twice by an older build after a crash between grant steps 2 and 3 would be granted again. Revision 3 corrects what this risk
rested on: step 2 was NOT a synchronous write (the collection only calls `markDirty()`, index.ts 121, throttled by `SAVE_THROTTLE_MS` 2000 and
skipped on a quota failure, store.ts 557-567); it now is (`flush()` and a check that the row reached storage, D-71), so the window is the
milliseconds between two verified writes, then a rollback, then two merges. I accept that and list it in PG_QUESTS.

**Revision 3, what I checked and what I did not.** Checked in the code: softbody.ts 215-217 (BUMP_MIN 0.35, BUMP_NORM 3), 276 and 722 (MAX_OTHERS 16,
the per-process bodyId), 1403-1410 (the bump names no partner), 1213-1219 and 1856-1873 (one `moveTo`, the corral skip), 2690-2699 (`emit`
allocates three objects); feedback.ts 116-151 (a bump plays `audio.bump` and `haptics.pop()` above 0.05; a land shakes the stage); stage.ts
87-88, 135, 185, 213, 260-262, 643-648 (slots and camera); store.ts 96-112, 486-592 (blend parents, `flush`, `report`, the throttled write);
index.ts 121; constants.ts 25-54; settings.ts 8-14; hudBinding.ts 262-306 (Save = capture + encode + download); keyboard.ts 55-125 (no Tab
handler; G toggles gravity); game.ts 360-366, 425-440, 780-786; ghost.ts 215-225 (only a hearted or locked item refuses a merge); copy.ts 202-203;
index.html 13 (`img-src 'self' data:`); run_probes.ts 12 (no arguments); bodies.ts 165 (`contactBodies` counts bodies, not pairs); materials.ts
271-356 (the family names). Ran: the typecheck (clean after the contract change), a projection of Home's things with the stage's camera
constants (1 body: on 1280 x 800 only the shelf is in view, the ball at ndc y -1.30; on 390 x 844 the Music Box, rug, lamp and pad are off the
sides), a fit of play bounds into a 390 x 844 frame inside the HUD insets (the 3.4 x 2.4 wide layout framed whole: 57 px; tall 1.25 x 3.0: about
101 px at the front and 83 px mid), the floor rule and ring arithmetic, a randomized layout search plus an independent DT-01 check for the cabin
(`final_cabin2.mjs`: wide and tall 0 problems each, with one size per thing for both layouts, since a `ThingDef` has one size: the basket ring r
0.89 with a 120 degree gap, clear opening 1.36 m, and the yarn ball r 0.24 in both), the Felt Ball's Home spots against the slots and the
one-body view with the camera scaled by the body as stage.ts 468 does (`ballcheck2.mjs`), and the name gate on every name, line and reaction cell
(`screen_r3.mjs`, 1042 texts, 0 hits in player text). Not checked: nothing ran on a body, in a browser, a build or an audio render; the phone
factor is assumed (F = 4) until PF-00; my projection approximates `framingFor` for one body only (the real multi-body framing is RD-16's job);
the tall frame is fitted for 390 x 844 only; the S2 and S3 places' tall layouts are not laid out (the DATA lane's job, rules in PLACES P7 and
DT-01); Fizzwell's water and Cloudloft's arch are moved by hand with no DT-01 run; Home's spots beyond the Felt Ball are rules, not numbers (my
candidate spots failed the slot gap or the one-body view).

**Revision 4, what I checked and what I did not.** Checked in the code: softbody.ts 55-75 and 1585-1625 (the corral: nothing inside its dead zone,
then a brake and a glide back that stops at the zone's edge, a rim past it; params.ts 141: `matR0` 0.6, `matRim` 2.5) and 1850-1862 (the corral
test skips a grabbed body and `moveOn`); stage.ts 84-88 (the TALL chevron and the WIDE row of slots), 133-137 (TARGET_Y 0.42), 183-187 (fov
35), 210-216 (pitch 0.27), 255-330 (`fitDistance`, `hwPerNow`, `framingFor`'s one-body and several-body rules), 462-470 and 520-545 (the aim:
one body at 0.6 of its centre, several at their middle); table.ts 214-216 (the felt is a disc of r 3.5); hudBinding.ts 121-141 (the insets are
measured from the DOM's top bar and bottom row at run time). Ran, in node (light), in scratch `pg_fix4/`: `homebounds.mjs` (the corral union
holds every slot in all 100 cases; the union shrunk by R + 0.2 m is empty for one body on 390 x 844 at every scale, and on 1280 x 800 with 1 or 2
out its back part puts the body's top under the top HUD at 22 to 66 of 121 sample points; the Felt Ball's room above); `standarea.mjs` (the area
where a whole body stands in view is never empty, but with one body on the phone it is a 0.11 to 0.13 m2 patch far behind the body);
`homespots.mjs`, cross-checked by `pg_fix3/check2.mjs` ("ok" for all twelve spots), `usespots.mjs` and `lampglow.mjs` (the use spots: the
lamp's glow needs r 1.2 on the desktop, 688 grid points pass); `ballroom.mjs` (no ball spot in the one-body phone view gives 0.2 m: best
0.08 m); `cabin_final3.mjs` (both cabin layouts: 0 problems with the new ride rows; the revision 3 layout fails them), `tallsearch.mjs` and
`spawn3.mjs` (the tall swing's pivot and both layouts' spawn spots); `pg_fix3/datagen.mjs` re-run (the data bytes by rolldown one-file builds);
the typecheck after the contract's doc edits. **Not checked:** nothing ran on a body, in a browser, a build or an audio render. The Home geometry
uses the earlier fixer's model of `framingFor` (the camera settled at its target framing, round bodies of R = 0.5 x scale, yaw 0, zoom 1) and
assumed HUD insets (390 x 844: 151 / 170 / 16 / 60 CSS px; 1280 x 800: 120 / 150 / 24 / 24), not measured ones (11.13 says what happens when the
real ones differ). The data bytes are stand-ins built to section 6's shapes, not the real modules; the away chunk's 44 to 66 KB and the five UI
modules' 15 KB are line-count estimates; PF-06's 7.9 ms is arithmetic from PHYS map 4's costs at F = 4. I did not re-lay the S2 and S3 places
(the Leaf Teeter's pivot is a number change, not a DT-01 run), did not model the Felt Ball pull-back of section 24, and did not re-run the name
gate (revision 4 adds no new name; the new player lines are "Shake the pine" and "Ring the shells", plain words from the existing titles).

## 23. Review findings not adopted (revision 3; and the confirmer's, revision 4)

The three reviews (`_handoff/design/REVIEW_code-truth.md`, `REVIEW_game-truth.md`, `REVIEW_rules-and-clarity.md`) raised 86 findings, many of them
the same fault seen through two or three lenses. I verified every blocker and major myself before acting (the code lines are in section 22's
revision note; the geometry, projection and fit numbers come from my own scripts, which agree with the reviewers' within a few hundredths). Every
blocker and major is fixed at its root (D-60 to D-84 and the edits they name), and every minor is fixed. What I did **not** adopt as written, and
why, is below; in each case the fault itself is fixed another way. No rule was weakened: every bar I changed is a bar the reviews showed to be
wrong or contradictory, and section 14 shows its arithmetic.

| Finding (lens, id) | The part not adopted | Why, and what I did instead |
|---|---|---|
| CODE TRUTH B2 (the physics budget) | "for example low = 1 awake whole + the touched one" | At F = 4 two awake wholes cost 0.87 + 0.87 + 0.2 = 1.94 ms against low's 1.0 ms (the reviewer's own numbers). I adopted the method instead: PF-00 measures F, every bar is in container ms, the awake budget follows by formula (low 1.0, med 1.49, high 2.64 at F = 4; revision 4 raises low's floor to 1.06, D-85), the mover floor is 1, moments are turn by turn, the shell sleeps over-budget wholes, and Q4 is re-quoted (D-60, D-61, 14.2). |
| CODE TRUTH M1 (size) | "First load holds the ten names, stampsToOpen, Home's PlaceDef and the rules of chapters 0, 1 and 10"; "Hearthlog's PlaceDef into the away chunk"; "REACTIONS into journal_text.ts as one tag string per thing" | The data split alone leaves LIFE, the reducer, the journal and the hosts (about 100 KB by the reviewer's bytes per line) in a 70 KB first load. They run from the first seconds of play, not before it, so they and all the data now load in a post-play life chunk (D-69). Each place's data is its own lazy module, Hearthlog's included (prefetched when it opens, which is what the away chunk would have given). The reaction cells' channels are run-time data, so they ship in each PlaceDef; only the family lines are text, in `journal_text.ts`. The per-lane caps and the per-step byte reports are adopted (14.3). The total rises from my own 1900 to D9's 2000 KB ceiling to hold the life chunk; a tenth place now needs the owner (V4). |
| CODE TRUTH M2 (the gift grant) | "On load, a granted gift found on no shelf and in no blend row's parents goes back to pending" | A blend row keeps only its own parents' ids (store.ts 101, 110), so a gift merged twice leaves no trace of its id: reverting on absence would grant it a second time. With step 3 written only after step 2 is verified in storage (adopted, D-71, with the failing-storage CO-05 row), "granted with no row" cannot arise from the grant. |
| CODE TRUTH M8 (Home's spawn) | "or a disc of r 4.2" for Home's LIFE bounds | With one body a phone shows about +-0.76 m of table: a 4.2 m disc would let the only squishy walk out of view (GAME TRUTH B2). Home's LIFE bounds are the visible table instead (D-67); `spawn: 'matLayout'` and DT-01 on the real slot output are adopted. |
| CODE TRUTH minor 10 (the probe) | "or pool the events" | Pooling changes the SoftEvent objects every consumer reads (feedback, the meter, the harnesses). PH-11 measures windows with no event instead, and the quick run with no arguments plus `--full` is adopted. |
| GAME TRUTH B1 (Dollop) | "The backfill opens Hearthlog at once" | With D-70's wisher an existing save always has a wisher (the game always shows at least the play body), and the 5:00 backstop opens Hearthlog anyway; opening it at once would make the first wish, H7 and H8 meaningless for every existing player. The wisher rule, the wait for natural wishes, the gap exemption, the 5:00 backstop and the LF-19 / QU-15 rows are adopted. |
| GAME TRUTH M1 (57 px in places) | "bounds about 1.9 x 2.4" and "at least 120 CSS px" | My fit (whole bodies and a back body's bubble inside the HUD insets of QUESTS 15) gives 57 px for 1.9 x 2.4, no better than the wide layout: the width binds. 120 px needs a play area about 1.6 m wide, which cannot hold two riders on a rocker or five spawn spots. The tall layout is adopted with bounds 1.25 x 3.0 (about 101 px at the front, 83 px mid) and RD-17's bars of 100 / 80 px; the cabin's tall layout passes DT-01 (PLACES 4.2). |
| GAME TRUTH M10 (S1 Friends Everywhere) | "X4, X5, X7 and X9 count every open place (capped at the shipped count)" | Their titles say "three places" while one would count. The reviewer's other option is adopted and generalised: only quests completable in the shipped set are shown, so those four and the finale wait for S2 (D-78, QU-14). |
| GAME TRUTH M12 (autonomy off) | "or a tap on a thing next to a squishy" as a player-asked use | A tap on a thing is already that thing's action (a switch, a flick). The player-asked uses are "Go play with..." and the rides the player sets up (D-79). |
| GAME TRUTH M13 (words without channels) | "or add a yaw driver and a per-side toast memory" | A new physics driver and a new look state for one line. The supported verb is adopted ("toasts golden, then hops back from the heat"), with a channel on every cell (D-80). |
| GAME TRUTH M14 (the kettle) | "tunes sound at most 20% of a 10-minute cabin visit" with no qualifier | A child tapping the Music Box every 40 s can play tunes 73% of the time, by choice. AU-14 holds the bar with no input; the 1-bar whistle, the 45 to 90 s spacing, the 60 s separation and the Music Box's 40 s and second-tap stop are adopted. |
| GAME TRUTH M15 and m14 (Fizzwell, Cloudloft) | "re-lay now" / "re-lay by hand" as a finished layout | Fizzwell is re-laid in PLACES 4.6 (water only at z < -1.2, the pad dry) and Cloudloft's arch must leave the front band, but neither place has been through DT-01's script (S3 work, as PLACES 4.11 says for every place but the cabin). DT-01 now checks zones against the pad. |
| GAME TRUTH M7 (peekaboo spots) | positions for the log and the Hum Rock now | The two peek spots (`ThingDef.peek`) and the rule that both lie inside LIFE's targets are adopted; moving the back-band log and rock is the S2 and S3 re-lay. |
| CODE TRUTH M6 (the music clock) | "decide the field from t and the bed seed" | The bed's seed and field schedule are audio's state. LIFE takes the place's music style's main field, and audio may re-voice a sung note onto the sounding field's rest tones at synthesis (D-66), which changes no LIFE decision. |
| RULES AND CLARITY M4 (kind) | "use distinct species in those three rules" | The family is what reacts differently (who floats, who glides), so R2, I3 and X6 keep families; the reviewer's other option is adopted: "kind" means family in every player line and the Journal shows the family name on every page and tile (D-82). |
| RULES AND CLARITY M7 (landscape) | "drop landscape from PG_VERIFY 6" | UI.md 3 covers portrait and landscape. The landscape rows and the width rules are adopted instead (QUESTS 15, SH-15). |
| RULES AND CLARITY m6 (stamp) | renaming the Journal's unit | "Stamp" already names the unit in many lines and the tab; the queued tool is renamed instead (T12, V19). |

**Revision 4: the confirmer's fixes (`_handoff/design/CONFIRM.md`) not adopted as written.** Every finding is fixed; where I took another road,
the reason is here.

| Finding | The part not adopted | Why, and what I did instead |
|---|---|---|
| CT-B2 / N4 (the gate) | "let a sleeping whole cost 0 in the start test" | A sleeper costs about 0.02 ms (PHYS map 4); zero in one test and 0.03 in the over-budget rule would make the two disagree. The floor rises by exactly what the sleepers cost instead (D-85), so both tests agree and still admit one awake whole. The pusher's wake is adopted as the ride allowance, generalised to every ride moment and to the over-budget rule; the soft boop answers S03, which the confirmer listed without a fix. |
| CT-M8 (Home's bounds) | "shrink only for LIFE targets" (the union shrunk by R + 0.2 m) and "the target area is not empty" | My script shows that area empty for one body on 390 x 844 and partly out of view on 1280 x 800 with 1 or 2 out. The union for `setBounds` is adopted; LIFE's Home targets are segments between framed points (D-87), which are never empty (they always hold the home slots) and are in view by convexity; RD-16 and SH-21 check them. |
| N1 (LIFE's place) | `lifeSetBounds(w, shape, cx, cz, a, b, round)` for Home's moving bounds | LIFE's Home targets are not a bounds shape (D-87), so `lifeSetHome(w, slot, x, z)` gives it the home slots; `lifeSetPlace(..., def, layout, bodyScale)` is adopted as proposed (D-89). |
| N2 (use spots) | "DT-01 checks use spots against the bounds shrunk by R + 0.2 for the smallest R" | For every body to reach a spot it would have to be the largest R, which leaves the tall layout 0.85 m wide and no side-strip thing usable. The exemption is adopted with a body-clearance rule in DT-01 (D-90). |
| N3 (the tall swing) | "or" | Both halves are adopted: DT-01 checks the rider's whole path and its walls, and the corral leaves a rider alone (D-91); the cabin is re-laid. |
| CT-M9 / N8 (the Leaf Teeter) | the 5 degree limit | A pivot of 0.24 m keeps the 10 degree teeter (its end moves 0.156 m instead of 0.078 m: a livelier rock for the child); the floor rule needs 0.235 m. |

## 24. Open design questions for the orchestrator (revision 4)

1. **FN-01 on a portrait phone with one squishy.** By projection the one-body view on 390 x 844 holds the body and a strip in front of it: the
   Felt Ball's spot leaves 0.02 / 0.09 / 0.16 m of roll room at scale 0.8 / 1.0 / 1.25, and no ball spot in that view gives more than 0.08 m
   (my scratch script `pg_fix4/ballroom.mjs`, not in the repo), so FN-01's "a boop that moves the ball at least 0.2 m, all inside the frame" cannot pass there today. The options:
   (a) on a portrait frame with one squishy out and the Felt Ball arrived, Home's rest framing counts the ball's spot as `framingFor` already
   counts a capsule (stage.ts 266-310: "with a single squishy on a narrow portrait frame the camera pulls back and aims between the two"): by its own
   formula about a 1.28x pull-back, so the body draws about 22% smaller and the ball gets about 0.6 m of room (my estimate from the formula, not
   projected); the frame changes once, when the ball arrives a few seconds into play (the arrival rule, not autonomy, so D-37 holds); (b) on that
   frame only, FN-01's ball bar becomes "the ball moves and stays in view" (a nudge against the near edge; the notice, the hops and the boop still
   read); (c) on that frame only, the ball's bounds reach 0.25 m under the bottom HUD (it rolls a moment under the tray and back). My
   recommendation is (a): FN-01 is the first minute, and a ball that cannot roll reads as broken; but it changes today's one-squishy phone view,
   which the owner may want to see first. RENDER owns `framingFor`; whichever is chosen, RD-16 and FN-01 then check it.
2. **If PF-06 misses on low** (two awake wholes on a ride, D-85). The options: (a) accept a frame drop for at most a ride's 20 s, which only the
   player starts; (b) on low, a ride seats one rider (a second one set on it lands beside it, and the lone rider shows its "Ride with me!" star),
   which hides C5 and G3 on low by QU-14; (c) on low, S11's push becomes a render lean of the pusher (asleep at its push spot) with a
   `PropWorldLike.poke` on the seat at each return, so only the rider is awake (S10 keeps two riders: (a) or (b) still decide it). My
   recommendation: decide from PF-06's numbers; prefer (c) for S11 and (a) for S10 if the frame stays under 20 ms.

## OWNER DECISION 2026-11-17 (D-95): the swing works both ways
The owner decided: "the swing can work automatically, or a user can swing it using their mouse - should be both options".
1. **Automatic:** with a squishy riding and nobody touching, the swing keeps swinging by itself at a gentle, steady arc (a light motor or
   pumping that tops up what damping removes; it must not die after 2 to 3 half swings as PG_PHYS round 3 measured). It settles when the
   rider leaves.
2. **By hand:** the player can grab the seat (or the rider) with mouse or finger and pull or push it; release lets it swing freely from
   that arc, then it eases back to the automatic arc. A hand always wins over the motor (the touch gate).
3. Empty swing: sways a little if pushed; no motor.
The same two-way rule applies to the rocker where it makes sense. Autonomy off: the motor is off, the hand still works.

## OWNER CLARIFICATION 2026-11-17 (D-95, revised: this replaces the text above where they differ)
The owner: "i agree the swing should die after 2-3 swings, or we can choose AUTO or we can run it by hand - thats what i meant."
1. **Default (natural):** a pushed swing dies down after about 2 to 3 swings, as PG_PHYS round 3 measured. That behaviour is CORRECT:
   do not add a motor by default and do not lower the damping.
2. **AUTO (the player chooses it):** a small AUTO toggle on the swing (tap the swing or its little control; keyboard reachable). While AUTO
   is on, the swing keeps a gentle steady arc by itself, with or without a rider. AUTO is off by default and is the player's choice, not
   something squishies or autonomy switch on. Turning it off lets the swing die down naturally.
3. **By hand:** the player can always grab the seat or the rider with mouse or finger and push or pull; a hand wins over AUTO while it
   holds, and on release the swing either dies down (AUTO off) or eases back to the AUTO arc (AUTO on).
The rocker follows the same three rules.

## OWNER DECISION 2026-11-18 (D-96): the place list is seven, not ten
The owner saw concept sketches of the five undrawn places and decided: "lantern roof and cloudloft ONLY."
- **Kept (7):** Home, Hearthlog Cabin (open), Ripple Shore, Frostbell Ridge, Rainleaf Garden ("for sure must work"), Lanternroof, Cloudloft.
- **Dropped (3):** Fizzwell Tub, Cogwhistle Bench, Echo Hollow. Do not build their visuals, physics (magnet, turntable) or shell wiring.
  Their data, sound and quest rows must not ship in the build or show anywhere to the player (remove them from the chunks and from the
  quest, wish, fact and keepsake totals: no stamp, wish or count may name or depend on a dropped place). The Float setting stays as it is.
- Order: beach, mountain, garden first; then Lanternroof and Cloudloft (wind gusts and the updraft are the only new physics).
- The owner also said two open 3D places "is NOT enough": opening places is the priority after the first deploy.

## OWNER DECISION 2026-11-19 (D-97): Float floats everyone, everywhere (this replaces D-83, SH-11, V20 and P12's Float half)
The owner played the game and said: "looks like gravity is broken - float doesnt actually make them float."
1. **Float floats every squishy that is out**, with any party size (1 to 5), its cut pieces too, and at every place (Home and each place).
   Each one rises where it stands and drifts in the air (the hover and its slow bob), as one squishy alone at Home was always meant to.
2. **Inside the play area:** a floating squishy never drifts off frame, through a wall or through the floor (its hover spot is kept inside the
   place's area; a toss in the air is caught by the place's bounds).
3. **Still a toy:** while floating, squishies can be grabbed, tossed and squished, and keep their feelings, looks and voices. Their self-started
   motion (walks, hops, self-started uses of things, rides, "Go play with...") pauses and resumes on Table. The things of the place stay where they
   are and still answer the player's taps.
4. **Table brings them down again gently** (the fall is slowed to under 1 m/s until they reach the ground) and LIFE takes up its motion again.
5. The saved setting is the one truth: nothing overrides it at run time (D-83's forced table and its "Here your squishies stand on the ground." line
   are gone). Two causes were fixed with it (R10_PLAYUX 1): the table's tack layer held a resting body's foot in float mode (so Float barely lifted
   even one squishy at Home), and the hover pulled every body to the world origin (a party collapsed into the middle).

## OWNER DECISION 2026-11-19 (D-98): turn the view with the right button while cutting
The owner: "i should be able to rotate with right click even when im CUTTING".
1. With the Cut tool in hand, a right-button (or middle-button) drag turns the view exactly as it does with the Hand. It never starts a cut.
2. A left-button stroke in progress is never broken by it: the stroke still cuts when it is let go.
3. On touch, a second finger while a stroke is down drops that stroke (nothing is cut) and the two fingers turn and pinch-zoom the view as two
   fingers on empty space do with the Hand; a lone finger's stroke still cuts.
(Cause: `game.ts` routed every press with the Cut tool to the blade and returned on any button but the left one, so a right drag did nothing.)

## OWNER DECISION 2026-11-19 (D-99): cut any squishy that is out
The owner: "if i have multiple squishies out i should be able to cut any/all of them".
1. With 2 to 5 out, a cut stroke cuts the squishy it crosses, not only the one you play with: the crossed squishy becomes the one you play with
   where it stands (nobody is rebuilt or moved; the one of before stays out, whole) and the same stroke cuts it.
2. Its pieces are its own: pieces of different squishies never merge, and "Reconnect all" puts it back together at ITS spot (never into another
   squishy at the middle of the table).
3. One cut squishy at a time: while one is in pieces, a stroke across another whole squishy cuts nothing and says so in words ("One squishy at a
   time: Reconnect all, then cut another."). The piece and awake budgets are the party's (SH-03): the published kind line when the limit is reached.
4. One squishy out: the published cut, unchanged.
Not done, and why: cutting SEVERAL squishies at the same time. The cutter (`shell/cut.ts`) holds ONE tree of pieces anchored on the play body
(its identity, the HUD, Reconnect all, the joins and the piece cache all assume one cut squishy). "All at once" needs a cutter per squishy (a
map from the whole's item id to its own tree, anchor, joins and Reconnect all), the LIFE host's piece groups keyed by that id (it keys them by the
cut whole's slot already), and the piece budget shared across trees.

## OWNER DECISION 2026-11-19 (D-100): squishies crawl like slugs / snails instead of sliding
The owner: "squishies now just slide, but is there a way to be able to make them move, kind of like slugs/snails that kind of movement?"
1. A squishy that travels by itself (LIFE's SCOOT: walking to a thing, wandering, scooting to a friend) CRAWLS: a wave runs through its soft body
   from front to rear: the front stretches forward and plants, the middle bunches up into a little arch, the rear pulls in; the base grips the
   ground where it is planted; the front lifts a little as it reaches; it leans into turns; it settles back to its rest shape when it stops.
2. It is the real soft body that crawls (the wave is in its goal shape and the grip moves its particles), not an animation over a slide: a touch,
   a grab, a toss, a ceremony, a hop or a collision behaves as before, and a touch ends the crawl within the touch gate (0.12 s).
3. HOW, never WHERE or WHEN: scootTo's speed, ease, target and gate are unchanged, so travel times stay within a few per cent of the glide's
   (probe_crawl CR-03) and LIFE, quests and self-use see the same walks.
4. Per material family: stride, rhythm and arch (a jelly ripples quickly, putty and mochi creep in slow heavy pulses, the springy ones inch with a
   bounce). Less grip slips: on ice the base slides more. Cut pieces and every body size crawl too.
5. Calm (and prefers-reduced-motion) keep today's glide, bit for bit. No crawl under 0.045 m/s (LIFE's contact approach glides as before).
Code: `src/physics/crawl.ts` (in the lazy props chunk), a 4-line hook in `softbody.ts` (`crawlOn` / `crawlD`), `props.ts` (the world steps each
body's crawl in beginFrame), one line in `shell/later-life.ts` (world.calm). Proof: `_harness/probe_crawl.ts`; report `_handoff/reports/R10_LOCOMOTION.md`.
