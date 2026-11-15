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

---

## 1. The owner's five asks, traced

| Ask | Made true by (features) | Proven by (checks, section 18) | Slice |
|---|---|---|---|
| 1 Places: environments to put squishies into; more than the three examples (1b) | Home plus 9 places (PLACES 4): Hearthlog Cabin, Ripple Shore, Frostbell Ridge (the owner's three) and Rainleaf Garden, Fizzwell Tub, Cogwhistle Bench, Lanternroof, Echo Hollow, Cloudloft; built from a 14-mechanism library and 9 zone kinds (PLACES 2); the Travel sheet; a tenth place costs data plus one 45 KB chunk (PLACES 6) | DT-01, DT-13, RD-01, RD-07, RD-13, SH-07, SZ-02, FN-03 | S1 (cabin), S2 (3), S3 (5) |
| 2 Things squishies use in their own way | 62 things (6 or 7 a place), each with a family-by-thing table (PLACES 4) over 12 gaits (LIFE 5.2), warm and cold poses, a generated float table (PLACES 2.5), ground modifiers, pad gains; channel defaults by construction (PLACES 3) | DT-06, DT-10, PH-01, PH-08, PH-15, PH-16, FN-02, FN-03, FN-06 | S1 |
| 3 Several squishies at once, social, with emotes and little voices | party manager (3/4/5 wholes), LIFE brains (B01-B19), 18 social moments (LIFE 6), friendship and warmth, 24 squishmoji (LIFE 7), species voice motifs, call and answer, duets, harmony on the music, the echo (LIFE 8) | LF-01..17, AU-01..13, RD-04, RD-10, RD-11, SH-02, FN-01, FN-06 | S0, S1 |
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
| D-10 | **Lean, sway, wiggle, shiver and breathing are render-side** (`setBodyPose`); physics drivers are only `setSquash`, `hop`, `carryTo` and the existing `moveTo` and `nudge` | PHYS E8 lean and wiggle in physics | F16: a sleeping body can sing and sway at about zero physics cost; one less physics feature to gate. |
| D-11 | **Support on up-facing prop faces** (within 35 degrees of up) counts for supported gravity, load, grounded and land; on a tilted face gravity's tangential part is kept, so ramps still slide | today: support only near y = 0 | K1: on any prop top a body sags, creeps and never sleeps (softbody.ts 1900-1904, 2290). The tilt rule is mine: without it F1 would stop every ramp slide. |
| D-12 | **Weight transfer onto moving props**: a body supported by a moving prop adds bodyMass x g x its supported share at its contact centroid to the prop's accumulators each substep | rely on particle corrections | Mine, not in any proposal: supported gravity fades a resting body's weight to zero (softbody.ts 1906-1916), so a seesaw would never tip under a sitter. |
| D-13 | **Movers 2 / 3 / 4** (a design floor) **and deterministic units** 3.0 / 4.0 / 5.5 (provisional; PF-01 sets them before S1 ships) | C: 1 / 2 / 4 with a measured `performance.now` hush; feasibility: units 1.5 / 2.5 / 4.0 | Judges disagree. F9: pair play needs 2 movers on low; F13 and M22: LIFE must not read a clock. If PF-01 misses the phone budget it lowers the unit caps and, on low, joint moments start only while nothing is touched. |
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
| D-31 | **The gift grant is three steps with a deterministic id**, origin `'restock'` | C: a hoard field; A, B: two keys with no order | M2, F14: older builds drop unknown hoard fields (store.ts 225-266). |
| D-32 | **Places open by stamps only**, no daily limit; thresholds 12 / 20 / 28 / 36 / 45 / 54 / 63 / 72 | C: at most one place a day; F28: one postcard a day | Judges disagree. M21: a daily content limit is an appointment mechanic (DESIGN 8.4); the daily limit belongs to gifts. |
| D-33 | Every finale opens at **5 of 7** main quests; Hearthlog opens when the first wish shows; the Home finale is that wish granted on arrival | C: Home 8 = visit Hearthlog, which needs the Home finale (circular) | F1, F2. |
| D-34 | Journal tabs **Stamps / Squishies / Friends / Keepsakes** | Pages, Story, Quests | F: "Quests" is a hard word for a seven-year-old. |
| D-35 | **12 facts per species** (B's list with C's cold and ground ways) | A 6, C 16 | F19: every fact has an event and a hint. |
| D-36 | The Journal under its own key `wobblehoard:v2:journal`, its own store, `JOURNAL_MIGRATIONS` from day one | a hoard field | CORE map 4: old builds never read it, so a rollback cannot eat it. |
| D-37 | **No camera motion from autonomy anywhere**, Home included: the camera frames the play bounds | A, B, C: a party follow; F kept a clamped follow | M10 (differs from F, M section 7): a follow of a wandering party is autonomous camera motion. |
| D-38 | Tabletop gravity forced in places and with more than one body out | none addressed it | K15, F10: the hover pulls every body to the world origin. |
| D-39 | **Any non-Hand tool quiets autonomy**; memory families get no LIFE squash while their memory has not converged | only Cut pauses | M9: room for Stamp and Roll; a print must heal as FUN says. |
| D-40 | Keyboard parity: the focused squishy, a keyboard stretch, "Go play with..." with a scripted lift (`carryTo`) | Space presses the screen centre today | M7, CS-02. |
| D-41 | **Size:** first load at most 1300 KB with the UI overhaul reserved; the PLAYGROUND first-load delta 60 KB target and 70 KB hard; total 1900 KB; each place 45 KB; the away chunk 120 KB; the screens chunk 45 KB | C 1290 / 1850; M14 1300 / 1850; F15 60 KB / 1900 | Judges disagree on the total. The Journal text and screens leave the first load (F15), so they need their own 45 KB chunk; 1300 + 120 + 45 + 9 x 45 = 1870 fits 1900 with 30 KB to spare, under D9's 2000. |
| D-42 | Player text is lazy (`src/data/journal_text.ts`) except Home's chapter, the place names and the three bubble words | C: all data in the first load | F15; C's 12 KB estimate is about 3x low (K). |
| D-43 | Contracts carry numbers, strings and typed arrays; the id unions live in data | B: unions in contracts.ts | F24: a new place must never be a contract change. |
| D-44 | The five Settings members land **with** `src/core/settings.ts`, not in my contract change | apply them now | Mine: `resolveSettings` returns every key of `Settings`, so a key without its default breaks the typecheck; settings.ts is the SHELL lane's file (11.9). |
| D-45 | The event bus is a **typed-array ring** | A: a function with nine number arguments; B: a flat record | F23: no doubles boxed through a non-inlined call. |
| D-46 | Ceremonies in a place: the pad at (0, 0); today's hide-all, then the party is re-placed | B: the others step aside | Every ceremony and flash gate would need a re-run; C cuts it. |
| D-47 | **Fizzwell is a shallow bath over half the floor**, the pad dry; it also fulfils FUN 1's later "Float" activity | C: 0.9 m over the whole area | F11, F19, M12. |
| D-48 | Home's nap spot is a flat **Snooze Rug**, not a ring | C's basket | Mine: a 0.7 m ring overlapped a body on a mat slot by up to 0.25 m (script, PLACES 4.1). |
| D-49 | Renames for CS-05 (Puddlebrook to **Rainleaf**, Cushion Swing to Pillow Swing, Tide Pool to Rock Pool, Puddles to Splash Spots, Moon Puddle to Moon Dish) | the proposals' names | M6, CS-05: no place or thing word may share a species' first four letters. |
| D-50 | Lanternroof gets parapets; places use token colours only; play-area luminance at most 0.35 | C's brass and copper colours | M13. |
| D-51 | No animal sounds; MusicStyle per place changes field weights and mallet timbre only (key D, 66 BPM) | retune per place | D10; ceremonies and the whole-again run are fixed in key (AUDIO map 2). |
| D-52 | The first capsule's newcomer stays out; it arrives shy but says hello within 5 s; things arrive at Home one by one | today: the reveal replaces the play body | A's first minute, B's shy arrival and clean minute 0; F10. |
| D-53 | The salt registry lives in `src/data/life.ts` | `src/core/rng.ts` | rng.ts is the orchestrator's frozen file (CONTRACT 2); a data module is the DATA lane's. |
| D-54 | Thing reactions: no tack or strings on props (a strand look when a tacky body leaves a prop it touched for 0.5 s); no field force on a grounded body | the proposals' "sticks to the prop", "drifts in the wind" | K2, K3, F8, F9. |

---

## 3. What the owner may want to veto (each with the cheap way to change it)

| # | Decision | The cheap change |
|---|---|---|
| V1 | Every new name (places, things, keepsakes, chapters, quest titles) | edit the `name` and text fields in `src/data/places.ts` and `src/data/journal_text.ts`; ids are append-only and stay; DT-02 re-screens |
| V2 | Nine places beyond Home (more than the three asked for) | set `shipped: false` on a place: the unlock rule skips it and its chunk is never imported |
| V3 | The cabin first, the beach in S2 | swap the slice order in section 15 (all data exists); the beach needs S2's water physics first |
| V4 | The size budget (first load 1300, delta 70, total 1900, 45 per place, away 120, screens 45 KB) | the numbers in the `sizeBudget(...)` call in `vite.config.ts` (task T1) |
| V5 | Character caps (wholes 3 / 4 / 5, pieces 4 / 6 / 6, characters 6 / 8 / 10) and movers 2 / 3 / 4 | `MAT_LIMIT` (mat.ts 22), `MAX_PIECES` (cut.ts 38), `CHAR_CAP` and `MOVER_CAP` in `src/life/attention.ts` |
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
| V19 | Journal tab names (Stamps, Squishies, Friends, Keepsakes) | text |
| V20 | The Float setting is overridden in places | no cheap change: the hover pulls to the world origin (softbody.ts 1918-1926); it would need a physics change |

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
ceremony > LIFE; cut steering keeps its `moveTo`); (3) `propWorld.beginFrame()`, `bodies.step(dt)` (collide with cached bound radii, sleeper pairs
skipped, then step), `propWorld.endFrame(dt)`; (4) `drain()`: SoftEvents to `feedback.handle` **with their source body** (per-body pitch and pan),
to `collection.feed` only for player-caused kinds (never `auto`, never `prop`), and into the play ring; (5) **LIFE sense and think** for each
character whose 0.1 s boundary passed: fill the snapshot in place, `lifeStep`, the attention filter, express (stage, audio), LifeEvents into the
ring; (6) timers, feedback, cut, capsules, ceremonies; (7) **quest host**: drain the ring into the reducer through the collection, queue moments; the
journal store saves batched (at most once per 2 s, gift steps unthrottled). The first version may run steps 2 and 5 as a `game.onStep` hook (831):
one frame of latency, invisible.

## 5. Lanes and file ownership (DIRECTION D12; ports from SESSION3)

| Lane (brief) | Owns | Port | Report |
|---|---|---|---|
| DATA (PG_DATA) | `src/data/places.ts`, `src/data/life.ts`, `src/data/quests.ts`, `src/data/journal_text.ts`; `_harness/name_gate.ts`, `_harness/probe_pg_data.ts` | none (node) | `_handoff/reports/PG_DATA.md` |
| PHYS (PG_PHYS) | `src/physics/**` (softbody.ts additions, new `props.ts`); `_harness/probe_playground.ts` | 5368 | `PG_PHYS.md` |
| LIFE (PG_LIFE) | `src/life/**` (traits, world, brain, social, attention, voice, wish, step); `_harness/probe_life.ts`, `_harness/probe_life_imports.ts` | 5369 (only if a browser look is needed) | `PG_LIFE.md` |
| RENDER (PG_RENDER) | `src/render/**` (place host, `places/*.ts`, props kit, emotes, marks, water, faces, poses, looks); `_harness/browser_render.mjs` new sections, `_harness/renderview/**` | 5364 | `PG_RENDER.md` |
| AUDIO (PG_AUDIO) | `src/audio/**` (creature, ambience, props, `places/*.ts`, chain, engine, music additions); `_harness/audioview/**`, a new `_harness/audioview/life_checks.mjs` | 5367 | `PG_AUDIO.md` |
| QUESTS (PG_QUESTS) | `src/core/quests.ts`; `src/collection/journal.ts`, `journal_store.ts`, and the PLAYGROUND additions in `constants.ts`, `ghost.ts`, `types.ts`, `index.ts`; `_harness/probe_quests.ts`, `_harness/probe_journal.ts`, `_harness/probe_pg_economy.ts` | none (node) | `PG_QUESTS.md` |
| SHELL (PG_SHELL) | `src/shell/**` (life host, attention wiring, party, events bus, quest host, places and travel), `src/ui/**` (journal, travel, tracker, wishes, moments, gift card, settings rows), `src/input/**` (keyboard), `src/core/settings.ts`, the Settings members of `src/contracts.ts` (11.9); `_harness/browser_shell.mjs` new sections, `_harness/shellview/node_checks.ts` new sections | 5366 (prod-build uses PORT + 1: pick a port whose +1 is free) | `PG_SHELL.md` |
| VERIFY (PG_VERIFY) | nothing in src; its own scratch scripts; `_handoff/reports/PG_VERIFY_<lane>.md` | 5370..5377 | per charter |

**Starting rules:** PG_DATA, PG_LIFE, PG_QUESTS, PG_AUDIO (creature voices) and PG_RENDER (emotes, faces, poses in the renderview) can start now:
nobody else is in those files. **PG_PHYS starts only after** the queued physics work (the checkpoint-47 re-verification, then physics round 3: the
grab and carry floor, LOCK and multi-pull, the cut neck swell) is verified, in one physics owner's hands. **PG_SHELL starts only after** SHELL-4 is
verified and the UI overhaul has landed its tokens and components (the SHELL-4 engineer is in `src/shell`, `src/ui`, `src/input` and
`_harness/browser_shell.mjs` today).

## 6. The data model (`erasableSyntaxOnly`: no enums, `as const` objects; flat modules in `src/data`, probe_genome reads it non-recursively)

```ts
// src/data/places.ts (first load: numbers and the ten place names only)
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
  readonly size: readonly [number, number, number];            // per mech: box half sizes; [r, length, 0]; [ringR, segR, gapDeg]
  readonly mu: number; readonly p: Readonly<Record<string, number>>;   // mech parameters, ranges in MECH_RANGES (DT-01)
  readonly ride: boolean;                                       // a ride the player sets up (PLACES P3)
  readonly zone?: string; readonly switch?: 'zone' | 'motor' | 'tune' | 'shower' | 'echo' | 'fire' | 'comet';
  readonly notes?: readonly number[]; readonly useSpot?: readonly [number, number]; readonly verb: number; readonly icon: number;
  readonly look: string; readonly sound: number; readonly arrives?: { readonly after: string } }
export interface PlaceDef { readonly id: PlaceId; readonly idx: number; readonly name: string; readonly coined?: readonly string[];
  readonly stampsToOpen: number | 'firstWish' | 0; readonly shipped: boolean; readonly night: boolean;
  readonly ground: GroundMods & { readonly mark: number; readonly markLifeS: number }; readonly patches: readonly PatchDef[]; readonly zones: readonly ZoneDef[];
  readonly things: readonly ThingDef[]; readonly bounds: Area & { readonly round: number }; readonly walls: readonly Area[];
  readonly pad: readonly [number, number, number]; readonly spawn: readonly (readonly [number, number])[];
  readonly camera: { readonly yawRange: number; readonly pitch: readonly [number, number]; readonly zoom: readonly [number, number] };
  readonly light: string; readonly sky: string; readonly weather: string; readonly ambience: string; readonly music: string;
  readonly ceremonyDim: number; readonly signature: number; readonly finale: number }
export const PLACES: readonly PlaceDef[]; export const MECH_RANGES: Readonly<Record<number, Readonly<Record<string, readonly [number, number]>>>>;

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
export const REACTIONS: per place, per thing or zone, per family: { tag: 'P' | 'L' | 'S' | 'B'; key: string } (PLACES 3 and 4; the text is in journal_text.ts);
export const EMOTE, EXPR, SYL, TOUCH, INTENT, LIFE_FLAG, LIFE_EV (the id tables of contracts.ts PLAYGROUND); BEHAVIOURS; SOCIAL; TRAIT_WORDS; BUBBLE_WORDS.

// src/data/quests.ts (first load: rule numbers for all 110 quests and Home's text)
export const EV, REACT_KIND, SOCIAL_KIND, USE_VERB, WISH_STATE, FACT (append-only id tables);
export interface Clause { readonly ev: number; readonly sub?: readonly number[]; readonly place?: number | 'away'; readonly thing?: number; readonly mech?: number;
  readonly family?: number; readonly minN?: number; readonly by?: 0 | 1; readonly count: number;
  readonly distinct?: 'species' | 'family' | 'thing' | 'part' | 'pair' | 'place'; readonly sameSpecies?: true; readonly v?: number }
export interface QuestDef { readonly idx: number; readonly id: string; readonly chapter: number; readonly kind: 'main' | 'finale' | 'bonus'; readonly clauses: readonly Clause[];
  readonly keys: 'K' | 'K*'; readonly playerClause?: number }    // QU-07: index of the player-caused clause on a gift finale
export const QUESTS: readonly QuestDef[]; export const CHAPTERS; export const KEEPSAKES; export const GIFT_LISTS: Readonly<Record<number, readonly SpeciesId[]>>;
export const HOME_TEXT; // titles and hints of chapter 0 (the tracker needs them before any lazy chunk)
// src/data/journal_text.ts (lazy: the screens chunk and the away chunk import it)
export const QUEST_TEXT, THING_TEXT, KEEPSAKE_TEXT, FACT_LINES, WISH_LINES, REACTION_TEXT, GIFT_LINES;
```

## 7. The contract members (applied to `src/contracts.ts` on 2026-11-15; typecheck clean)

All in one PLAYGROUND block at the end of the file, by interface merging, so no existing member changed (`git diff --stat`: 357 insertions, 0
deletions). Every member is optional and documented in the file.

| Interface | Members |
|---|---|
| `SoftEvent` | `auto?`, `prop?` |
| `SoftMetrics` | `asleep?`, `submerged?`, `onProp?`, `airborne?`, `locked?` (LOCK's planned count, declared now because the touch gate reads it) |
| `SoftBodyLike` | `mods?` (Float64Array of 8), `setBounds?`, `setHome?`, `setPropWorld?`, `setSquash?`, `hop?`, `carryTo?`, `sleepEnabled?`, `wake?` |
| `PropWorldLike` (new) | `count`, `poses`, `zoneCount`, `zoneOn`, `beginFrame`, `endFrame`, `setZoneOn`, `setMotor`, `raycast`, `poke`, `drainStrikes`, `setKinematic?`, `stateHash` |
| `AddBodyOpts` | `lite?` |
| `StageLike` | `loadPlace?`, `setPlace?`, `bindProps?`, `setPlayBounds?`, `setObstacles?`, `setBodyGaze?`, `setBodyExpression?`, `setBodyPose?`, `setBodyLook?`, `setHeatPoint?`, `setBodyWater?`, `setBodyAsleep?`, `emoteSlots?`, `emote?`, `clearEmote?`, `emoteScreen?`, `setEmotesInPhoto?`, `stampMark?`, `bodyScreenPoint?` |
| `AudioSettings` | `chatter?`, `ambience?` |
| `SquishAudio` | `creature?`, `musicClock?`, `loadAmbience?`, `setAmbience?`, `prop?`, `musicBox?`, `setMusicStyle?` |
| `DebugHook` | `life?`, `quests?`, `travel?` |
| `LifeSnapshot`, `LifeIntents`, `LifeEvents` (new) | the LIFE seam (LIFE.md 12) |
| `PlayEventRing` (new) | the shell-to-Journal event ring (QUESTS 4) |
| `Settings` | **not yet**: `chatter?`, `ambience?`, `autonomy?`, `bubbleWords?`, `bubblesInPhoto?` land with `src/core/settings.ts` (D-44, 11.9) |

The `PropWorldLike` factory (`buildPropWorld(place: PlaceDef): PropWorldLike`) and the packed layouts (stride per prop and per zone) are physics
values in `src/physics/props.ts`; the shell reaches it through the same lazy physics import as `SoftBody` (boot.ts 94-98). The Collection interface
additions (`journal?()`, `feedPlay?(ring, nowMs)`, `claimGift?(chapter, pick)`, `warmthOf?(itemId)`, and the events `quest`, `fact`, `keepsake`,
`friend`, `unlock`, `gift`) live in `src/collection/types.ts` (the QUESTS lane), not in contracts.ts.

## 8. Physics additions (PG_PHYS; after physics round 3; E-numbers from the PHYS map)

**Order inside the lane:** E9 touch gate, E7 `setSquash` and `hop`, 8.3 support on prop faces, E10 sleep, E3 bounds, E2 modifiers, E4 the prop
pass, E5 `props.ts` (static, hinge, ball, then slider and motor), then S2 water (E6), then S3 fields. One physics owner, serially (M15).

### 8.1 Ground modifiers (E2)
`mods[0..3]` scale `tableMu`, the glue, `groundDamp` and a now-mutable `dragF` (baked at softbody.ts 766 and applied to the whole velocity at 2658:
ice needs it); `mods[4]` is the density for water, `mods[5]` the field catch, `mods[6]` the pad bounce gain. Written through the Float64Array, never
object fields (the V8 representation rule, softbody.ts 224-230); each eased over 0.3 s; identity = today bit for bit (PH-10 hash rows unchanged at
Home). No stiffness or damping change.

### 8.2 Bounds and home (E3)
`setBounds(shape, cx, cz, a, b, round)` adds a place-bounds branch to `matCorral` (softbody.ts 1600-1620): the same dead zone, brake, glide back and
rim bounce, about the place's disc or rounded rectangle; `setHome(x, z)` moves the home spot; shape -1 restores today's corral.

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
walls, bounds, the 2.0 m/s clamp, the steel flag for the magnet), motors and switches, strikes (`drainStrikes`), kinematic shapes for the queued
Stamp and Roll tools (`setKinematic`, M9). Integrated once per frame after every body stepped (`endFrame`). Zero allocation; deterministic;
`stateHash`.

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
turn it on and list them (PH-10).

### 8.7 LIFE drivers and the touch gate (E9, E7)
**Touch gate:** at the substep start (softbody.ts 1849-1853), while `fingers > 0 || grabbed || carried || locked > 0`, the LIFE drivers (LIFE's
`moveTo`, `setSquash`, `hop`) pause and ease out within 0.12 s; ceremony drivers are untouched. `setSquash` scales the goal GB volume-preservingly in
`frameUpdate` (softbody.ts 2391-2397); refused for putty, mochi and beads while their memory has not converged (it reports `MEMORY_BUSY`). `hop`
nudges with the glue and the peel damping suspended for 10 substeps (softbody.ts 2218, 2275); caps and refusals as the contract says. `carryTo`
lifts the whole body kinematically along an arc (as the carry follows the hand, softbody.ts 1877-1897) and sets it down with no velocity; it emits
no press, grab or snap.

### 8.8 Events
`auto` on every `land` and prop `bump` unless the body was thrown by the player since its last landing (F#11, C's rule); `prop` on prop bumps;
land detection also when the first support after flight is a prop face.

### 8.9 Collide and bump memory (F#12, E13)
`boundRadius` once per body per frame (cached), asleep-asleep pairs skipped before the sphere test; the bump memory (MAX_OTHERS 16 keyed
`bodyId & 15`, softbody.ts 276, 1405) widened to 32 slots keyed by a shell-assigned slot index, so two partners never share a slot (PH-19). The
mass-blind push stays (changing it moves tuned stack rows).

### 8.10 What physics does not do
No height field (E1), no run-time stiffness or damping (E12), no run-time detail swap, no detail-2 wholes in S1 and S2, no per-particle buoyancy,
no second free prop, no 2-DOF joints, no tack or strands on props; with a PropWorld bound, `gravity = false` is ignored (P12).

## 9. Render additions (PG_RENDER)

- **Place host** (`src/render/place.ts`, in the away chunk): sky presets through a `Table.setSky` (the 9 uniforms and fog, table.ts 198-204) or a
  per-place sky shader; a ground mesh with its own band-limited noise (top at y = 0; the felt is Home's); 3 to 6 backdrop cards (renderOrder -99..-51,
  low poly: drawn twice on med and high); weather through `Particles` with a normal-blend option; the three lights as stage fields, the jelly
  `uKeyDir/uRimDir/uKeyCol/uRimCol` and `KEY_TINT` re-derived per place (material.ts 329-338, 386-390); env panels as data with `EnvHub.rebuild`
  and the old cube disposed; the ceremony dim easing over at least 1.0 s; context loss rebuilds the place env (stage.ts 615-625). `setPlace` swaps
  under the ScreenFx snapshot crossfade. Home stays the default look in the stage chunk.
- **Place chunks** `src/render/places/<id>.ts` (lazy, bare `'three'` import so three stays in the stage chunk), at most 45 KB with the place's audio
  recipe and text.
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
  icons (at most 4 primitives each) in one fragment shader, no texture (CSP-safe); styles say, think and group; never a flash.
- **Marks:** one ring buffer of instanced quads (64 / 48 / 24 by tier), the decal alpha trick (decals.ts 100-104).
- **Cheaper bodies:** `setBodyAsleep` skips the fine-mesh evaluation (eyes still blink, the pose still sways); chunks use the low fine mesh
  (`AddBodyOpts.lite`, 2562 vertices) on med and high (RD-06: 6 pieces vs 2 wholes at most x1.2, from x1.32..1.45 today).
- **Camera:** `setPlayBounds` frames the whole place; **no camera motion from autonomy** (M10) anywhere: at Home with LIFE on, the one-body follow
  (stage.ts 533) and `framingFor`'s live framing follow only player-caused motion (a toss) and otherwise frame the slots in use. The cut neck-swell
  stopgap in `framingFor` (STATUS known open) stays Home-only until PHYS fixes the swell.
- **Capsule spot** avoids prop footprints (`setObstacles`); the pad is clear by data.
- **Eyes seen through another body** are depth-faded (SHELL_4.md 95-98 reported a "four-eyed" look: a squishy's eyes crisp through a clear jelly in
  front of it), a must-fix for parties (RD-12).

## 10. Audio additions (PG_AUDIO)

`chatter` and `ambience` input gains created **after** `music` (the harness labels the first three `createGain()` calls, `engine_offline.js` 42);
default output bit-identical. `src/audio/creature.ts`: syllables, flavours, the species motif, pitch snapping, the pair duet, the echo (a scheduled
repeat, no DelayNode), the group voice, a pure `ChatterLimiter` backstop at the desktop caps, priority -1, its own rng stream (`CHATTER_SALT`), never
in `ROOM_KINDS`, silent during ceremonies and 1 s after (LIFE.md 8). `src/audio/ambience.ts`: an `AmbienceBed` shaped like `MusicBed` (its own bus,
3 s fade in, 2 s crossfade on travel, the 100 ms tick, two noise sources at different rates so the 2.5 s loop never shows, a shallow -6 dB dip under
player effects, never asking for room), joining `freeAll` and `freeMusic` on pause and mute. `src/audio/places/<id>.ts` recipes (lazy; PLACES 4
"Sound"; no animal sounds). `src/audio/props.ts`: ball, creak (a held voice per prop key with a dead-man switch), chime, splash, crunch, crackle,
boing, bell, tick (on the beat from the music clock), kettle, rustle, whoosh; a sound the player causes may use `registerFx`, one that moved by
itself never does. `musicBox` makes the bed mute its mallets while it plays. `musicClock` reports the field SOUNDING now (from the composer's field log
against bar time; the readout of `detailStats` runs up to a bar ahead). `setMusicStyle` changes field weights and mallet timbre only; `home` is
bit-identical (AU-07).

## 11. Shell additions (PG_SHELL)

### 11.1 Frame order
Section 4. Steps 2 and 5 may start as a `game.onStep` hook. Zero allocation per frame in every new step (`emit()` allocates: never per frame).

### 11.2 The LIFE host (`src/shell/life.ts`)
Stable character ids: a whole's Hoard item id; a piece's parent id and piece index (view ids change on re-add, SHELL map 2). Fills the snapshot in
place from `bodies.body`, `bodies.extras`, metrics, the world's poses and this step's events (copied into its own ring while draining). Computes
`units` (LIFE.md 10.3) and the `phone` boolean (coarse pointer or short side under 600 CSS px). Sets `quiet` (a ceremony, `cut` busy, any non-Hand tool,
Travel or Journal open, the desktop Hoard's hold, a hidden tab). **The one arbiter of `moveTo`:** finger > cut and ceremony > LIFE (cut steering,
cut.ts 194-215, keeps priority). Never calls `fingerDown`, `grab*` or a lock API for autonomy.

### 11.3 The party manager (evolves `src/shell/mat.ts`)
Stable ids; caps by tier (LIFE.md 10.4); spawn at the place's spawn spots (Home: `stage.matLayout`); the party **survives** a ceremony (`game.ts`
381's `mat.clear()` becomes a stash, restored within 0.5 s after the ceremony ends), a Hoard card preview and travel; the first capsule's newcomer
stays out when there is room; `out` and `back` events carry the item id; the tier drop policy (sleep, then shelve with the kind line); the Float
override (P12) with its line shown once; `sleepEnabled` on every party body.

### 11.4 Cut with a party (`src/shell/cut.ts`)
`clearMat()` (cut.ts 283) no longer empties the mat; pieces = min(MAX_PIECES, cap - (wholes - 1)); a units overflow sleeps the farthest untouched
whole, then refuses kindly ("It's busy here. Put one squishy back on the shelf to cut."); cutting a second party member reconnects the first,
animated; an `onCut` / `onWhole` hook fires from the swipe AND from the Cut bar's Split in two and Reconnect all (today they emit nothing, and
`joined` is never emitted, SHELL map 4).

### 11.5 The attention wiring (`src/shell/attention.ts`)
Wraps the pure `src/life/attention.ts`; calls `stage.emote`, `audio.creature`, prop sounds from `drainStrikes`, the budgeted soft land and bump
sounds for `auto` events; the touch duck; Calm caps; 0 haptics from autonomy.

### 11.6 The play-event bus (`src/shell/events.ts`)
The `PlayEventRing` (capacity 64), filled by the producers of QUESTS 4 (mat and party, `drainBody`'s touch copies and tosses, LIFE events, travel,
cut, Snap at the shot, the Journal UI, ceremony ends, gift claims); drained once a frame by the quest host into `collection.feedPlay`.

### 11.7 Travel (`src/shell/places.ts`, `src/ui/travel.ts`)
QUESTS 15: `whenIdle`, `leaving()` (reconnect a cut, release locks), `stage.loadPlace` and `audio.loadAmbience` (prefetched on idle when the place
opens), the 0.6 s crossfade, `buildPropWorld`, `setPropWorld`, `setBounds`, the modifiers, spawn, `lifeSetPlace`, VISIT, `setAmbience`,
`setMusicStyle`, `setPlayBounds`, `setObstacles`; "Packing up..." after 300 ms; a load failure keeps the player where they were.

### 11.8 Keyboard (`src/input/keyboard.ts`)
J the Journal, P Places; with more than one character out, Tab and [ ] move the focus between party members and **Space presses the focused
squishy** (keyboard.ts 74-83 presses the screen centre today); the **keyboard stretch**: hold Space on the focused squishy, then an arrow key pulls
it toward that side through the real driver (a grab that pays like a pull, because the player did it), released with Space; Enter on a focused wish
opens its card; the name tag popover's "Go play with..." (floor things: a player-asked LIFE use; rides: `carryTo`); the Escape order tray,
Settings, Journal, Places, Hoard, tool, plate, then locks; focus returns to the opener.

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
0.5, autonomy: true, bubbleWords: false, bubblesInPhoto: true` (its Pick list widened); `resolveSettings` fills the five with `??`. Migration is by
absence (v stays 2). `settingsCtl.ts` applies them with change detection; `settingsPanel.ts` gets the rows and widens its key unions (lines 49 and
65); node_checks section 6 covers them.

### 11.10 Screens
QUESTS 15: the Journal (`src/ui/journal/*`), the tracker (`src/ui/tracker.ts`), wish cards and bubble hit areas and word labels (`src/ui/wishes.ts`),
the moments queue (the plate slot), the gift card, the Travel sheet, the settings rows; on the UI overhaul's components and tokens; every new HUD
element in `_harness/uikit/` in every state (UI.md 5); the Journal and Travel in one lazy screens chunk.

### 11.11 Dev hook
`life()`, `quests()`, `travel()` (dev only, out of the production bundle: the `bundle` section's grep).

### 11.12 Node checks
New sections in `_harness/shellview/node_checks.ts` with a **moving mock body** made inside the section (a local subclass of the mock with a writable
centre and metrics; `_harness/mocks.ts` is the orchestrator's file and stays as it is) and the real `SoftBody` for the touch and hop rows (the 7g
pattern).

## 12. Quests, the journal and the save (PG_QUESTS)

- **`src/core/quests.ts`:** `applyPlayEvent(st, ring, i, defs, out): number`: pure, allocation-free after warm-up, no clock (the day is injected), no
  rng; matches clauses, keeps counters and bitsets, derives FRIEND levels (with the 20-a-day pair cap), facts F0..F11, keepsakes, place openings and
  gift readiness; imports only `./rng.ts`, `../data/quests.ts`, `../data/life.ts`, `../data/catalog.ts` (and types). The capsule-roll word never
  appears in it (probe I03 scans every file in src, strings included).
- **`src/collection/journal.ts` and `journal_store.ts`:** sanitize, serialize, the two-tab merge, park, backfill; the store cloned from
  `createHoardStore` (store.ts 498-600) under `JOURNAL_KEY = 'wobblehoard:v2:journal'`, `JOURNAL_BACKUP_KEY = 'wobblehoard:v2:journal.unreadable'`,
  `JOURNAL_VERSION = 1`, `JOURNAL_MAX_CHARS = 16_000` (it parks whole under PARK_MAX_CHARS 20 000), `JOURNAL_MIGRATIONS = []` through
  `migrateVersioned` (save.ts 82-97). A newer `v` is read-only in memory; an unreadable blob is parked and replaced.
- **Format** (worst case about 7 KB, CO-02 measures it):
```json
{ "v": 1, "dev": "<deviceId>", "bf": 1, "st": 42,
  "qd": "<base64 of the 128-bit done set>", "qp": [[17, 2, 0, 0, "<base64 bits>"]],
  "fx": [[0, 4127], [10, 3]], "fr": [[0, 10, 9], [3, 12, 14]], "fd": [20407, [[0, 10, 6]]],
  "wm": [["g-k2j9x0a1b2c3", 17]], "ks": 3, "pl": 7, "pv": [5, 3, 1],
  "wi": [[3, 1, 2, 20407]], "gift": [[1, 2, 3, 20406], [2, 1, 12, 20407]], "gday": 20407,
  "cur": { "p": 1, "party": ["g-k2j9x0a1b2c3"] }, "day": 20407 }
```
  `qd` quests done; `qp` in-progress counters and bitsets (at most 40 rows); `fx` fact masks by species idx; `fr` friendship [lo, hi, points] (at most
  128); `fd` today's points per pair; `wm` warmth by ghost id (at most 100, pruned to ids still on the shelf at load); `ks` keepsakes; `pl` places
  open; `pv` visits; `wi` resting wishes (at most 3); `gift` [chapter, state 1 pending / 2 granted, species idx, day]; `gday` the last gift's day.
- **Two tabs:** every field only grows or is a max, so the merge is a union or a max (quest state max, counters max, facts OR, friendship max per pair,
  keepsakes OR, warmth max, gift state max, wishes the newest 3 of the union, `cur` last writer).
- **Backfill** (`bf`, once): F0 for every owned species; Home H1, H3 and H4 done when the shelf shows them (opened at least one capsule, owns two or
  more).
- **The gift grant:** QUESTS 11's three steps; `ghostGrantGift(save, chapter, pick, ctx)` in `ghost.ts` (origin `'restock'`, `speciesBaseGenome`,
  the deterministic id `'jg-' + deviceId + '-' + chapter`, `hasId` first, GHOST_CAP refusal); the claim refuses a second gift on the same UTC day and
  any species not on the chapter's list; Practice ledger only (M3).
- **Accounts (M25):** journal entries keyed by a real (non-ghost) item id carry the `acctTag` and are dropped on sign-out or an account switch
  (COLLECTION 4 wipes the mirror then); practice ghost ids stay.
- **Imports stay legal:** the collection imports only `./`, `../core/`, `../data/` and `../contracts.ts` (types): LIFE events reach the journal
  through the shell (probe_collection_imports I01..I07 unchanged).

## 13. Lazy loading and chunks

| Chunk | Holds | Loaded |
|---|---|---|
| first load | the entry, the shell (with the LIFE host, party, bus, quest host, tracker, buttons, settings rows), `src/life/**`, `src/core/quests.ts`, the journal store and gift grant, the data numbers and Home's text, and boot's three imports (`boot.ts` 94-98: physics with the prop pass, sleep, drivers and `props.ts`; the stage with Home, the props kit core, emotes, faces, poses and looks; audio with creature voices, the chatter bus and Home's prop voices) | at boot |
| away | the place host, the props kit for places, water, marks, weather, the ambience bed and the place prop voices | with the first trip (prefetched on idle when Hearthlog opens) |
| screens | the Journal, Travel and gift screens and `src/data/journal_text.ts` | on the first Journal or Places open (prefetched 30 s after the first reveal) |
| one per place | `src/render/places/<id>.ts` and `src/audio/places/<id>.ts`, loaded together | when the place opens, on idle |

Every lazy module imports `three` by the bare specifier; CSP `script-src 'self'` allows same-origin chunks (index.html 13).

## 14. Budgets

### 14.1 Characters: LIFE.md 10.4 (wholes 3 / 4 / 5, pieces 4 / 6 / 6, characters 6 / 8 / 10). The motion gate: LIFE.md 10.3.

### 14.2 Frame (a mid-range phone on `med`, 16.7 ms)
| Subsystem | Budget (mean) | How it is held |
|---|---|---|
| physics (bodies, props, zones) | 6.0 ms (low 4.0, high 10.0) | sleep; the motion gate; no detail-2 wholes; PF-01 sets the unit caps |
| LIFE + attention + quest host | 0.4 ms | 10 Hz think, at most 0.1 ms a tick at 16 characters (LF-03) |
| shell (gestures, feedback, cut, bus) | 0.6 ms | zero allocation |
| UI | 1.0 ms | the UI.md bar |
| render CPU | 4.5 ms | sleepers skip mesh updates; lite chunk mesh |
| audio main thread | 0.5 ms | at most 10 chatter nodes and 14 ambience nodes steady |
| GC and slack | 3.7 ms | |

**Quiet-container proxy (PF-05):** the med S1 scenario (4 wholes, 1 touched, 1 LIFE mover, 2 asleep, the cabin's props) at most 2.0 ms of physics a
frame in node: 0.87 (touched) + 0.9 (a mover) + 2 x 0.02 (asleep) + about 0.2 (props near the awake ones) = about 2.0 ms from the PHYS map's
numbers. The phone factor is unknown: PF-01 runs the same scenario in Chromium with a 4x CPU throttle.

### 14.3 Size (D9, re-specified; V4)
| Part | Budget | Estimate | Check |
|---|---|---|---|
| today's build | 1139 KB (2683d349, STATUS) | measured | |
| UI overhaul + SHELL-4 allowance | +90 KB | UI.md 2.7 | |
| PLAYGROUND first-load delta | **60 KB target, 70 KB hard**, measured at S0 | LIFE 12, data numbers and Home text 10, quests reducer and journal store 7, shell hosts and screens-shell 12, physics prop pass, sleep, drivers and props.ts 10, render emotes, faces, poses and looks 8, audio creature voices and chatter 6: about 65 | SZ-01 |
| **first load** | **at most 1300 KB** | | SZ-01 |
| away chunk | at most 120 KB | | SZ-02 |
| screens chunk | at most 45 KB | Journal and Travel UI about 25, journal_text about 18 | SZ-02 |
| each place chunk | at most 45 KB (9 x 45 = 405) | render 30 to 38, audio 4 to 6, text in the screens chunk | SZ-02 |
| **whole build** | **at most 1900 KB** | 1300 + 120 + 45 + 405 = 1870 | SZ-02 |

If S0 measures more than 70 KB, move non-Home code into the away chunk before adding a place (M14). A tenth place fits the 1900 KB total; an
eleventh needs the total gate raised by 45 KB (D9 allows 2000).

### 14.4 Per place
At most 60 draw calls for the set and props (RD-08), 8 moving props and 20 collider primitives (DT-01), weather caps per tier x0.3 in Calm and none
with reduced motion, play-area luminance at most 0.35 (RD-13).

### 14.5 Save and allocation
Journal at most 16 000 characters (CO-02). Zero bytes allocated per 120 frames in physics with props, zones and drivers (PH-11), per 6000 LIFE ticks
(LF-02), per 10 000 reducer events (QU-01), per 600 shell frames (SH-01, SH-04); render stays under today's 8.9 KB a frame.

## 15. Slices

| Slice | Contents | Playable result | Exit |
|---|---|---|---|
| **S0 "Life at Home"** (internal milestone) | PHYS touch gate, `setSquash`, `hop`, support on prop faces, sleep, `auto`, collide caching, bump memory, the prop pass with static props and the ball, Home's bounds; LIFE traits, needs, B01-B19, S01-S09, S12, S13, S15, pieces P01-P04, attention, voice planning; RENDER gaze, expressions, render pose, emotes, sleep skip, lite chunk mesh, eyes through jelly, Home's camera rule; AUDIO creature voices, chatter bus, limiter, `musicClock`, Home's prop voices (ball, music box); SHELL LIFE host, party manager (stable ids, survives ceremonies and cuts, the newcomer stays out), the bus, the attention wiring, the tracker, the Journal with Home's chapter, settings rows, keyboard focus and Space; DATA all places' numbers and all text; QUESTS reducer, journal store, backfill | Home comes alive: Dollop plays with the ball by itself, a newcomer says hello, they sing to the Music Box and nap on the rug; Home's chapter up to its wish | **FN-01** passes in node and once in the browser; SZ-01 measures the first-load delta |
| **S1 "Hearthlog Cabin"** (first shippable) | S0 + the place system (place host, the cabin chunk, the away chunk, Travel, bounds and modifiers), the cabin's 6 things (hinge rocker and swing, the yarn ball, the snug basket ring, the hearth's warmth, the singing kettle), warm and cold looks and poses, toast, the ambience bed with the cabin's recipe, the cabin's prop voices, wishes and wish cards, moments, keepsakes and the Home shelf, the gift path (the Hearthlog gift), chapters Home, Hearthlog and Friends Everywhere (its place quests complete as places arrive), the squirt-free S1 copy | all five asks in one new place: things used in each family's way, a social party, pieces joining in calmly, voices and emotes, and a Journal with onboarding | node rows, then PF-01..03 (sets the unit caps), then the browser rows; independent verifiers (PG_VERIFY) |
| **S2 "Water and cold"** | water as a gravity scale and the float table, current, the flush pad, chimes struck by contact, ice and wet patches, marks, snow and rain weather, the water surface and tint, the ceremony dim; Ripple Shore, Frostbell Ridge, Rainleaf Garden with their chapters and gifts; the squirt game; the raised hops per family after PH-01 | three more places; floating and wading; puddle jumps; glides; the sunset, the stars, the rain that stops | per-place node and browser rows; verifiers |
| **S3 "Fields and echo"** | airborne-only wind and updraft, the magnet and the steel marble, the motor turntable, the echo; Fizzwell Tub, Cogwhistle Bench, Lanternroof, Echo Hollow, Cloudloft with their chapters | the whole world of ten places | per-place rows; a full verifier pass over the whole game |

## 16. Build order and dependencies

| Step | Work (lanes in parallel) | Needs |
|---|---|---|
| 0 | **Now, beside SHELL-4 and the UI overhaul:** the contract (done); DATA `name_gate.ts`, the data modules and their probe; LIFE pure brains and `probe_life_imports.ts` against scripted snapshots; QUESTS reducer, journal store, gift grant, economy rig rows; AUDIO creature voices and `musicClock` in the offline harness; RENDER emotes, faces, poses and the eyes-through-jelly fix in the renderview | this page |
| 1 | The orchestrator: the G0 split in `vite.config.ts` (T1) **after SHELL-4 closes and before any place chunk lands**; SHELL `browser_shell.mjs` 3437 (T2) | SHELL-4 verified |
| 2 | PHYS (one owner): the queued checkpoint-47 re-verification, physics round 3 (grab and carry floor, LOCK and multi-pull, neck swell), then PG_PHYS 8.1..8.9 for S0 | step 0 contract; the physics queue |
| 3 | SHELL: LIFE host, party, bus, attention wiring, quest host, tracker, Home's Journal, settings (11.9), keyboard (11.8) | SHELL-4 verified; the UI overhaul's tokens and components; steps 0 and 2 |
| 4 | **S0 exit**: FN-01 in node and once in the browser; SZ-01 measures the first-load delta (one build, a heavy job) | 0, 2, 3 |
| 5 | S1: RENDER place host and the cabin chunk; AUDIO ambience bed, the cabin recipe, prop voices; PHYS hinge and ring props, bounds, modifiers; SHELL Travel, wishes, moments, gift path; DATA the cabin and Friends Everywhere chapters | 4 |
| 6 | S1 verification: node rows; PF-01..03 with the 4x throttle (they set the unit caps); browser rows; independent verifiers (PG_VERIFY); a fix round | 5 |
| 7 | S2 (water once, then the three places; PH-01 raises hops per family) | 6 |
| 8 | S3 (fields, then the five places); the whole-game verification | 7 |

## 17. Changes to files I do not own (exact tasks)

| # | Owner | File | Change |
|---|---|---|---|
| T1 | INTEGRATION (the orchestrator) | `vite.config.ts` | Replace the one total gate (`G0_BUDGET_BYTES = 1.2 MB`, line 24; `sizeBudget(limit)`, lines 171-187) with `sizeBudget({ firstLoad: 1300 * 1024, total: 1900 * 1024, placeChunk: 45 * 1024, awayChunk: 120 * 1024, screensChunk: 45 * 1024 })`: in `generateBundle`, compute the **first-load closure** = the entry chunk, its static imports, and the closures of the three dynamic imports in `src/shell/boot.ts` 94-98 (`physics/softbody.ts`, `render/stage.ts`, `audio/engine.ts`); name each other chunk by its facade module (`render/places/<id>.ts` with its audio recipe = a place chunk; `render/place.ts` = the away chunk; `ui/journal/*` and `ui/travel.ts` = the screens chunk); fail when a lazy facade is in the first-load closure; in `closeBundle` keep the total over the whole output folder (public files included) and print `[G0] first load N of 1300 KB, total N of 1900 KB, largest place N of 45 KB, away N of 120 KB, screens N of 45 KB`. Do it after SHELL-4 closes and before any place chunk lands. |
| T2 | SHELL | `_harness/browser_shell.mjs` 3437 | The row "dist stays under the 1.2 MB budget (G0)" becomes "first load at most 1300 KB and the build at most 1900 KB (G0, D9)": read the build's own `[G0]` line or recompute the same two numbers; a re-specification with this written reason (the owner's D9 and this page). |
| T3 | DOCS (the orchestrator) | `_spec/CONTRACT.md` | Section 6 G0 row: "`npx tsc --noEmit -p tsconfig.json`, `npm run build`: clean; first load at most 1300 KB and the whole build at most 1900 KB, each place chunk at most 45 KB, the away chunk 120 KB, the screens chunk 45 KB; `vite build` itself fails over any of them (`vite.config.ts`); PLAYGROUND_BUILD.md 14.3". Section 2: add the rows LIFE (`src/life/**`), WORLD DATA (`src/data/places.ts`, `life.ts`, `quests.ts`, `journal_text.ts`), QUESTS (`src/core/quests.ts`, the journal files in `src/collection`). Sections 4 to 8: a pointer to PLAYGROUND_BUILD.md 7 for the PLAYGROUND members. |
| T4 | DOCS | `_spec/CUT.md` | Section 2, after rule 4: "PLAYGROUND (2026-11-15): cutting keeps the party on the mat or in the place (the mat is no longer emptied); the pieces a cut may make = min(the tier's pieces, the character cap - (wholes - 1)); one squishy is in pieces at a time. Pressing another party member is not switching squishy: the first body keeps its pieces. Rule 2 (leaving reconnects) is unchanged." |
| T5 | DOCS | `_spec/DESIGN.md` | 5.13 or a new 5.14: a pointer to QUESTS.md 11 (the Journal's only economy touch is 5 gift squishies for life, origin restock; no capsule or SP rewards); 6.6: autonomy obeys Calm and reduced motion (LIFE.md 10.1, 5.2). Optional, at the Stage C doc pass. |
| T6 | CORE | `_harness/probe_catalog.ts` | none: PG_DATA copies the gate into `_harness/name_gate.ts` and a row checks the copied function sources match. |
| T7 | CORE (optional, heavy, once) | `_harness/sim_economy.ts` | a "gift" source in section K (5 picks on assumed days 1, 2, 3, 5, 9 for regular players); re-quote K (expected shift under 1 day); section C is unchanged by construction (EC-04). |
| T8 | COLLECTION server (later) | `supabase/**` | the host op `wh_claim_journal_gift` with a per-account lifetime cap of 5 and the list check (M3); until then no gifts for signed-in accounts. |
| T9 | SHELL | `src/core/settings.ts` + the Settings block of `src/contracts.ts` | section 11.9 (one change). |
| T10 | RENDER | `src/render/stage.ts` | the neck-swell stopgap in `framingFor` (STATUS known open) stays Home-only; places frame their bounds. Remove it when PHYS fixes the swell. |

## 18. The acceptance checklist (N = node, B = browser, O = offline audio; ids per lane)

**DATA** (`_harness/probe_pg_data.ts`, N)
| Id | Check | Bar |
|---|---|---|
| DT-01 | every PlaceDef: things inside the bounds, none in the pad, at least 0.9 m from every spawn spot; parameters inside MECH_RANGES; every collider part at least 0.16 m thick, a ball r at least 0.20; at most 8 moving props and 20 primitives; ring gaps with a chord of at least 1.0 m; water surfaces at most 0.30 m; ramps at most 16 degrees; pads and turntables flush; swing seats at most 2.0 m/s from rope and limit | all |
| DT-02 | the name gate split (PLACES 7): coined words NAME rules, the rest PROSE rules; pop dome promise words; the copy words of QUESTS Q10; CS-05 (first four letters, edit distance 2 for coined words, unique prefixes) | 0 hits |
| DT-03 | favourites: 50 rows; each place beyond Home at least 4 fans and 1 Common fan; each family in at least 2 places; the thing in the place; each gift list 3 Common or Uncommon fans of the next place | all |
| DT-04 | best friends: a perfect matching, symmetric, cross-lane, tier gap at most 1 | all |
| DT-05 | FAMILY_REACT and GAITS cover 12 families, values in range; S1 hop vy at most 0.84 | all |
| DT-06 | every family has at least 3 non-empty reactions in every place | all |
| DT-07 | the data modules are flat, acyclic, and each loads first in a bare node (probe_genome 87-120) | all |
| DT-08 | text lengths and readability (QUESTS Q10) | all |
| DT-09 | each title's verb matches its rule's event (a reviewed keyword table) | all |
| DT-10 | the float table is generated from density x depth x radius band; every water reaction cell agrees; every resting body's eye anchor at least 0.10 m above every water surface (CS-07) | all |
| DT-11 | the salts differ from each other and from the 16 in src | all |
| DT-12 | every self-use is floor level; every ride is flagged and has a ride wish | all |
| DT-13 | each place has a signature verb event and a finale spectacle id; no mechanism is the headline of more than 3 places | all |
| DT-14 | the append-only id lists (places, things, quests, keepsakes, emotes, facts) match a frozen lock list | equal |

**LIFE** (`_harness/probe_life.ts`, `probe_life_imports.ts`, N)
| Id | Check | Bar |
|---|---|---|
| LF-01 | the same seed and snapshot script give the same intent hash over 10 sim minutes, 3 seeds; another seed differs | equal |
| LF-02 | allocation in lifeStep after warm-up | 0 B over 6000 ticks |
| LF-03 | cost at 16 characters | median at most 0.1 ms a tick |
| LF-04 | a HELD character (touched, carried or locked) gets 0 motion intents in the same tick, its queue is cancelled, and none for 1.5 s after release | always |
| LF-05 | no intent kind can press, grab or lock (type-level), and the host source holds no `fingerDown`, `grab` or lock call | 0 |
| LF-06 | no scoot or hop target outside bounds - (R + 0.2) or inside a keep-out | 0 |
| LF-07 | a storm (10 wholes and 30 pieces asking 50 a second): no cap of LIFE 10.1 exceeded in any rolling second, all four columns; a P1 never starved | 0 over |
| LF-08 | 6 pieces doing one action within 0.5 s give 1 bubble and 1 voice | exact |
| LF-09 | every behaviour and social moment fires in its scripted scenario; a 5-minute default visit gives each squishy about 1 nap, 3 to 4 greets and 2 to 3 thing uses (+-1) | all |
| LF-10 | movers never exceed the tier's moverCap; every start keeps units at most unitCap; joint moments reserve together | always |
| LF-11 | no character is in two joint moments at once | 0 |
| LF-12 | the import purity of `src/life/**` | 0 |
| LF-13 | the huff's triggers are squishy-to-squishy scene events only (a static table), it lasts at most 3 s, ends on any touch, never in a session's first 60 s (CS-04) | all |
| LF-14 | wishes: at most 1 a squishy, 2 on screen, 3 kept, 180 s per squishy and 120 s overall between new ones, at most 2 re-glances; the scripted first wish by 5:00 | all |
| LF-15 | friendship: at most 20 a pair a day; levels at 12 and 40; at most 128 rows; eviction never drops Friends or closer, or a best-friend pair | all |
| LF-16 | the same sim time stepped at 30 and at 60 fps gives the same decisions | equal |
| LF-17 | Calm and reduced motion: hop chains at most 3, no wiggle over 2 Hz, no bob, the Calm caps | all |

**PHYS** (`_harness/probe_playground.ts`, N, with `--quick`; PH-13 heavy)
| Id | Check | Bar |
|---|---|---|
| PH-01 | hops on 12 families x 3 genomes and 1/8 pieces: apex within +-25% of target; S1 apex at most 3.5 cm and no `land`; no second hop; no fold over 120 degrees; no hop or squash while memory is busy; the S2 raised hops with `auto` landings per family | all |
| PH-02 | the touch gate eases LIFE drivers out within 0.12 s; ceremony drivers untouched; a lock counts | all |
| PH-03 | static props (block, bar, mound, ring) x 12 families x 3 genomes and detail-2 pieces, dropped on and walked into: no fold over 120 degrees, no NaN, penetration at most 1% R; a body rests 3 s on a box top with creep at most 2 mm and sleeps | all |
| PH-04 | seesaw and swing with 2 bodies for 60 s: inside the limits, energy only decays; a seesaw tips under a sitter (weight transfer); teeter hops from the board; the seat at most 2.0 m/s | all |
| PH-05 | the ball: at most 2.0 m/s, never through a wall, rests within 6 s; no particle over 6 m/s from a prop contact | all |
| PH-06 | mass parity: one species at detail 3 and 2 tilts a seesaw within 5%; a 1/8 piece an eighth as much | within |
| PH-07 | squash poses keep the volume inside the family band (G1) | all |
| PH-08 | ground modifiers: ice glide distances rank by ice grip (Spearman at least 0.8); sand stops a slide within 0.3 s | all |
| PH-09 | sleep within 1.0 s at rest; an asleep step at most 0.03 ms; each wake cause wakes it; a pile of 3 sleeps within 3 s as an island and stays asleep 60 s; memory families sleep at max abs(MEM - Q) under 0.02 R; zero jump on wake | all |
| PH-10 | determinism with props, zones and sleep; the re-baselined hash rows listed in the report | equal |
| PH-11 | allocation with props, zones and drivers | 0 B per 120 frames |
| PH-12 | an awake detail-3 body with 4 props in reach (the worked-contact fold gate on) | at most 1.25x |
| PH-13 | (heavy, optional, S3) 50 species at detail 2 with rest, press, pull and hop rows | listed |
| PH-14 | `auto` on hop, pad and fall landings and prop bumps, never on a player toss; the largest autonomous landing speed per family reported | exact |
| PH-15 | (S2) water: float or sit matches the generated table, 12 families x 3 radius bands; drift only when floating; no NaN; clean exits; the bulge slosh in water | all |
| PH-16 | (S2) the flush pad: apex at most the cap for every family; at most 5 bounces; the sticky hold within +-0.1 s | all |
| PH-17 | (S3) wind and updraft only on airborne or floating bodies; nothing wakes under 0.25 m/s^2; the magnet moves only the steel marble | all |
| PH-18 | bounds hold 200 random 6 m/s tosses within bounds + 0.1 m | all |
| PH-19 | bound radii cached once a frame; asleep pairs skipped; bump events right past 40 bodies made in a session | all |
| PH-20 | `carryTo` emits no poke, press, release, grab or snap, and lands without NaN | 0 |
| PH-21 | with a PropWorld bound, `gravity = false` is ignored | exact |

**RENDER** (`_harness/browser_render.mjs` new sections `place`, `props`, `emote`, `marks`, `pose`; port 5364; B)
| Id | Check | Bar |
|---|---|---|
| RD-01 | each place boots (`place=<id>`): 0 console problems; the `sky` section passes | all |
| RD-02 | the 50-species gallery in each place: closest pair at least 10/255; med and low drift p90 at most 15.8; with looks at 0, Home's gallery is pixel-identical to v4 | all |
| RD-03 | the flash gate per place for every ceremony tier, with the ceremony dim easing over at least 1.0 s | at most 2 flashes a second |
| RD-04 | bubbles at least 36 CSS px on 390 x 844; the icon at least 3:1 on the fill; the edge at least 3:1 on each place's sky; never under the insets; one draw | all |
| RD-05 | sleeping bodies do 0 fine-mesh updates; 4 asleep cost at most 0.3x the CPU update of 4 awake | at most |
| RD-06 | 6 pieces vs 2 wholes frame ratio with the lite chunk mesh | at most 1.2 |
| RD-07 | 10 place swaps: programs, textures and geometries back to Home's baseline +-2; context loss in a place restores | equal |
| RD-08 | the set and props of a place | at most 60 draw calls |
| RD-09 | Calm and reduced motion: bubbles fade only, weather x0.3 or none, no camera moves | all |
| RD-10 | expressions are eyes only (no blush, no mouth) | visual pass |
| RD-11 | a swaying sleeper's eyes stay on its skin | within 1 px |
| RD-12 | eyes seen through another body's jelly are depth-faded (no four-eyed look) | visual pass |
| RD-13 | the play area's mean linear luminance at most 0.35 per place; no pastel; token colours only (CS-06) | all |
| RD-14 | no camera motion while only autonomy moves bodies, at Home and in places | 0 |
| RD-15 | water: the surface draws over the right bodies, the tint below the line, the edge ring hides the side | visual pass |

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
| AU-11 | at most 4 nodes per syllable; 5000 syllables return to the baseline node count | all |
| AU-12 | the echo: one repeat at +220 ms and -12 dB, no DelayNode | exact |
| AU-13 | while the player touches, chatter is 6 dB down and at most 1 syllable a second | all |

**QUESTS and COLLECTION** (`_harness/probe_quests.ts`, `probe_journal.ts`, N)
| Id | Check | Bar |
|---|---|---|
| QU-01 | the reducer is pure and allocation-free (0 B over 10 000 events); no meter import; no capsule-roll text (probe I03) | 0 |
| QU-02 | every quest completes from its generated minimal event script; replaying changes nothing; a near-miss script does not complete it | all |
| QU-03 | the fairness rules (QUESTS Q3, Q4) | all |
| QU-04 | the count rules (Q5) | all |
| QU-05 | each finale opens at 5 of 7 main quests (Home's at the first wish), never earlier | exact |
| QU-06 | stamp thresholds open places in order; an unshipped place is skipped and its stamps kept | exact |
| QU-07 | each gift finale has a player-caused clause | all |
| QU-08 | every event kind a rule uses has a named producer; a photo counts at the shot | all |
| QU-09 | keyboard parity (CS-02): the K quests of every opened set reach every threshold | all |
| QU-10 | no path ever decrements stamps, warmth or friendship (CS-13); no main quest has a within-visit clause | 0 |
| QU-11 | a scripted regular-player stream opens the places near the times of QUESTS 7 (reported, +-50%) | reported |
| QU-12 | the wish caps of QUESTS 8 at the reducer and store level | all |
| CO-01 | the journal store: save, load, hostile JSON, park, a newer version read-only | all |
| CO-02 | the worst-case journal | at most 16 000 chars |
| CO-03 | the two-tab merge is a union or a max for every field; merging a blob with itself is the identity | all |
| CO-04 | the backfill from an existing v2 hoard runs once and marks F0, H1, H3 and H4 as QUESTS 13 says | exact |
| CO-05 | the gift grant interrupted after each of its 3 steps, plus a round trip through today's `serializeHoard`, plus two tabs: exactly one gift per chapter; at most 5 for life; at most 1 a UTC day; listed species only; origin restock; the id matches ID_PATTERN; the shelf cap keeps it waiting (CS-03) | exact |
| CO-06 | a merge keeps the larger warmth; warmth ids pruned to the shelf | exact |
| CO-07 | probe_collection 73/74 (C08 is the known open row) and probe_collection_imports unchanged | equal |
| CO-08 | the journal touches the hoard key only through `ghostGrantGift` | 0 others |
| CO-09 | a non-practice ledger gets no gift (M3) | 0 |

**ECONOMY** (N; EC-04 heavy)
| Id | Check | Bar |
|---|---|---|
| EC-01 | the probe_economy pace rows pass unchanged (3.0 to 3.8 active min a capsule) | pass |
| EC-02 | the real shell rig with LIFE on, 4 moving mock bodies and the real collection, 30 sim minutes with no input, travelling to every place: 0 SP, 0 task progress, 0 capsules, 0 gifts claimable, 0 haptics, 0 camera moves; plus one 2-minute run on real SoftBodies (CS-01) | 0 |
| EC-03 | every `auto` or `prop` event is dropped before `collection.feed` (a spy) | 0 |
| EC-04 | (heavy, optional, once) sim_economy section K with 5 gifts | shift under 1 day |

**SHELL and UI** (node_checks N, browser_shell B)
| Id | Check | Bar |
|---|---|---|
| SH-01 | N: the LIFE host acts before `bodies.step` and senses after `drain()`; deterministic under `DebugHook.step`; 0 B per frame over 600 frames | all |
| SH-02 | N: the party is back within 0.5 s after a ceremony, a trip and a Hoard preview | all |
| SH-03 | N: a cut with a party: the party stays; the piece limit formula; one squishy in pieces at a time | exact |
| SH-04 | N: the bus and hosts allocate 0 B a frame; 64 events in one frame arrive in order; overflow counted | all |
| SH-05 | N: a spy on `collection.feed` sees only player-caused events | 0 others |
| SH-06 | N: bumps between two untouched bodies under 0.8 m/s make no sound | 0 |
| SH-07 | N: travel waits for idle, reconnects, releases locks, then swaps | all |
| SH-08 | N: the new settings saved by absence and applied live | all |
| SH-09 | N: the touch gate includes locks; pressing another party member keeps the first body's locks and pieces (CS-10) | all |
| SH-10 | N: any non-Hand tool quiets autonomy | all |
| SH-11 | N: the Float setting is overridden in places and with more than one body, the line once | all |
| SH-12 | N: a tier drop sleeps, then shelves, with the kind line | all |
| SH-13 | N: autonomy off: 0 motion intents applied; gaze and reactions stay | all |
| SH-14 | B: keyboard only: J, P, Tab and [ ] focus, Space presses the focused squishy, the keyboard stretch, "Go play with...", the Escape order, focus return | all |
| SH-15 | B: 390 x 844 and 320 x 568: no overlap of pill, buttons, plate, capsule and meter; targets at least 44 px; grids take their columns from the width (CS-08) | all |
| SH-16 | B: quest moments at least 1 s from bursts, never over a reveal, one polite line each | all |
| SH-17 | B: wish hit areas at least 44 x 44, never over the body's silhouette (CS-09); every friend and place wish names its target in the card and the live region (CS-11) | all |
| SH-18 | B: Snap hides the DOM overlays; bubbles in the photo by default, off with the switch; a photo counts at the shot | all |
| SH-19 | B: the new-player flow in the real shell through the dev hook (FN-01), with a screenshot at each quest | pass |
| UI-01 | new colour pairs in `CONTRAST_PAIRS`, passing | all |
| UI-02 | reduced motion and Calm: fades, no camera moves | all |
| UI-03 | sound off: the voice-to-bubble table is total | all |
| UI-04 | every new HUD element in `_harness/uikit/` in every state | all |

**PERF and SIZE** (B)
| Id | Check | Bar |
|---|---|---|
| PF-01 | the med cap scenario in Hearthlog with a 4x CPU throttle: physics at most 6.0 ms, LIFE and hosts at most 0.4, UI at most 1.0 (means); sets the unit caps | at most |
| PF-02 | the low cap scenario: physics at most 4.0 ms | at most |
| PF-03 | the cut scenario (3 wholes and 5 pieces, med): physics at most 6.0 ms | at most |
| PF-04 | a 10-minute soak: no GC pause over 8 ms from src; the frame mean stable within 5% | all |
| PF-05 | N: the quiet-container proxy, the med S1 scenario | at most 2.0 ms physics |
| SZ-01 | first load at most 1300 KB with the UI overhaul landed; the PLAYGROUND delta at most 70 KB (target 60), measured at S0 | at most |
| SZ-02 | total at most 1900 KB; each place chunk 45 KB, the away chunk 120 KB, the screens chunk 45 KB | at most |
| SZ-03 | no lazy module in the first-load closure | 0 |
| SZ-04 | no dev names in the production bundle | 0 |

**FUN** (the verifiers, by eye and by script)
| Id | Check | Bar |
|---|---|---|
| FN-01 | the first minute: on a fresh profile, once the player has let go for 6 s, Dollop does a visible thing use (notice, hops, a boop that moves the ball at least 0.2 m) within 10 s; its first labelled bubble within 30 s of the start; the newcomer says hello within 5 s of coming out (node through the dev hook, then once in the browser) | pass |
| FN-02 | "own way" by the fire: a screenshot by the hearth with jelly, marshmallow, mochi and slime shows 4 visibly different shapes or looks, named by the verifier | pass |
| FN-03 | every place's signature verb event fires in a 5-minute scripted visit | all |
| FN-06 | a 10-minute default visit on med with 4 wholes: each squishy at least 2 social moments and 2 thing uses; the phone bubble cap never exceeded | all |

**COHERENCE and SAFETY map** (JUDGE_COHERENCE 8): CS-01 = EC-02 + QU-07; CS-02 = QU-09; CS-03 = CO-05; CS-04 = LF-13 + DT-02; CS-05 = DT-02; CS-06
= RD-13; CS-07 = DT-10 + PH-15; CS-08 = SH-15; CS-09 = SH-17; CS-10 = SH-09; CS-11 = SH-17; CS-12 = SZ-01 + SZ-02; CS-13 = QU-10; CS-14 = LF-01 + SH-01
(LIFE reads no clock, so the hush of C does not exist: the units are part of the snapshot). FN-04 = QU-03 + QU-04; FN-05 = DT-02 + LF-13; FN-07 = DT-10.

## 19. Verification charters (detail in `_handoff/briefs/PG_VERIFY.md`)

Independent, fresh verifiers per lane and per slice, never the builder: (1) DATA and QUESTS (node: every DT, QU, CO, EC row re-run from scratch;
the save attacked by hand); (2) LIFE (node: determinism, storms, the huff table, the wish caps; a read of every behaviour against LIFE.md);
(3) PHYS (node: every PH row on all families, an independent prop and sleep torture set, NaN hunts, the hash rows); (4) RENDER (browser on 5370: every
RD row, screenshots of every place at 390 x 844, 320 x 568 and 1280 x 800, judged as an art director, flash and luminance by script); (5) AUDIO
(offline: every AU row; a written first-listen checklist, since nobody has heard the audio yet); (6) SHELL and UI (node then browser on 5372: every SH
and UI row, a keyboard-only walk of a whole chapter, a screen-reader name pass); (7) the WHOLE GAME, per slice (browser on 5374: a fresh-profile
10-minute play through the dev hook, FN-01, FN-02, FN-03, FN-06, a 30-minute no-input economy run, the size gates, the copy and dark-pattern audit,
a parent's eye on every place). Each verifier writes `_handoff/reports/PG_VERIFY_<area>_<slice>.md` with real numbers, screenshots it looked at,
PASS or FAIL per id, and what it did not check.

## 20. The name gate run (2026-11-15)

The real gate code of `_harness/probe_catalog.ts` 76-298, copied unchanged into a scratch module, screened 8 coined words and 146 names with the
rules of PLACES 7 (0 hits after the renames of D-49), and 434 texts (every quest title and hint and every quoted player line in PLACES, LIFE and
QUESTS) with the PROSE rules and the copy rules: 2 hits fixed (the hint "Turn the magnet on" read as the 8-letter wide-list name "magneton";
"No hurry" used a copy-gate word), 0 left in player text.

## 21. Risks and what limits each

| Risk | Limit |
|---|---|
| the phone is slower than the assumed factor | the unit caps are set by PF-01 with a 4x throttle before S1 ships; caps fall, the mover floor stays |
| prop edges crease skin, or support on props misbehaves | the worked-contact fold gate, the 0.16 m rule, PH-03 and PH-04 on 12 families x 3 genomes and pieces |
| a seesaw does not tip because a sitter is weightless | the weight transfer (D-12) and PH-04's "tips under a sitter" row |
| 3.5 cm hops read too small | the pose (squash and stretch) in S1; the raised per-family hops in S2 after PH-01; FN-01 judged by eye |
| chatter is not cute | every voice is behind a slider and a cap; a first-listen checklist in the S1 verification |
| shallow water reads as too little | the render's deep-colour gradient and caustics; floaters drift visibly; DT-10 keeps the text true; the owner may veto (V9) |
| the first load grows past 1300 KB | measured at S0; non-Home code moves to the away chunk before any place is added |
| sleep changes hash rows | opt-in `sleepEnabled`; the re-baselined rows are listed (PH-10) |
| SHELL-4, the UI overhaul and physics round 3 slip | the pure lanes (DATA, LIFE, QUESTS, AUDIO creature, RENDER emotes) do not wait for them |

## 22. What I did not check

I ran no probe, no browser and no build: every millisecond and kilobyte here is quoted from the maps and reports (PHYS map 4 and 6, SHELL_4.md
75-77, RENDER map 8, UI.md 2.7, STATUS) or is an estimate marked as one; nobody has measured a phone. No physics behaviour in these specs has run on
a real body (support on props, the weight transfer, the flush pad's kick, the hop, sleep islands, water as a gravity scale). Nothing has been heard
or seen. The luminance figures per place are estimates until RD-13. The minute-by-minute onboarding and the day 2 / 7 / 30 tables are estimates. I
did not read `src/shell/feedback.ts`, `src/render/face.ts` or `src/audio/engine.ts` beyond the maps' line references, and I did not check that
`makeRow` accepts a `jg-` id beyond reading it (it takes any id the caller guarantees; `sanitizeRow` checks `ID_PATTERN`, store.ts 84-111).
