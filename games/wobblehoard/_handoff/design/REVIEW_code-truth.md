# REVIEW: the PLAYGROUND design against the real code (lens: CODE TRUTH)

Reviewer: an adversarial reviewer who did not write the design. Date 2026-11-15. Tree: HEAD 4fe77736 plus the uncommitted PLAYGROUND spec,
contract and brief changes (`git status`: `_spec/*.md`, `src/contracts.ts`, `_handoff/briefs/PG_*.md`).
Read: `_spec/PLACES.md`, `LIFE.md`, `QUESTS.md`, `PLAYGROUND_BUILD.md`, the PLAYGROUND block of `src/contracts.ts` (lines 481-841), the eight
`_handoff/briefs/PG_*.md`, and the code each claim rests on (cited below by file and line).

**Ran:** `npx tsc --noEmit -p tsconfig.json`: exit 0, 1.3 s. A rolldown minify of single modules in node (scratch script
`/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/review_ct/minsize.mjs`, light), and a scratch model of one
place's data built to the field lists of PLAYGROUND_BUILD 6 (`datasize.mjs`, same folder). Measured minified bytes per source line:
`shell/cut.ts` 12 764 B (20.5 B a line), `collection/store.ts` 12 597 B (21.0), `shell/ceremonies.ts` 4 225 B (15.3), `render/stage.ts`
15 492 B (17.2), `audio/engine.ts` 13 641 B (16.7), `physics/softbody.ts` 62 860 B (22.1), `data/catalog.ts` 32 117 B (46.6).
**Not checked:** nothing was run on a body, a browser, a build or an audio render; I did not re-run DT-01's geometry for any place but the cabin
lines I quote; I did not read `src/render/face.ts`, `material.ts`, `src/audio/music.ts` beyond the lines named, `_spec/LOCK.md` or `_spec/UI.md`
beyond line 21; I did not re-derive the trait spreads, the favourites script or the name gate.

Severity: **blocker** = a lane builds the wrong thing or the game breaks a rule; **major** = a rework or an owner ask left unmet; **minor** = polish.

---

## Blockers

### B1. Body-to-body bumps carry no `auto`, so autonomy will buzz the phone and make unbudgeted bump sounds
- **Where:** `src/contracts.ts` 495-498 (`auto` is set "on every 'land' and every prop 'bump'"); PLAYGROUND_BUILD 8.8; PG_SHELL brief "Traps" 40-41
  ("send `auto` and `prop` events to the attention budget only"); `src/shell/feedback.ts` 146-151; `src/physics/softbody.ts` 1403-1410.
- **What:** a body-to-body `bump` fires only when the contact closes faster than 0.35 m/s (contracts 179) with intensity = speed / 3, so every
  body bump has intensity of at least 0.117. `feedback.handle` plays `audio.bump` for it and `haptics.pop()` whenever intensity is over 0.05
  (feedback.ts 148-150). LIFE's own boop is "a hop into it at 0.4 m/s (a soft bump of intensity about 0.13)" (LIFE 6.1 S03); teeters, piles,
  parades, pass the ball and nuzzle contacts make more. The contract gives the shell no way to tell these from a toss, so a shell built to the
  brief sends them through feedback: a haptic from autonomy (breaks LIFE L7 and EC-02's "0 haptics") and a bump sound SH-06 says must be silent
  below 0.8 m/s. EC-02 runs on mock bodies, which emit no bumps, so it would pass anyway.
- **Fix:** in the contract and PLAYGROUND_BUILD 8.8, set `auto` on body-to-body `bump` too: true unless either body is HELD or was thrown by the
  player since its last landing. In PG_SHELL's traps, route every `auto` event (land, prop bump, body bump) to the attention budget, never to
  `feedback.handle`. Add a real-SoftBody row to SH-05 or EC-02 with two LIFE bodies booping, and check that 0 haptics were called.

### B2. The physics frame budget is broken by the measured costs at every tier, and PF-05 contradicts PF-01
- **Where:** PLAYGROUND_BUILD 14.2 (physics 4.0 / 6.0 / 10.0 ms), 563-565 (PF-05), 18 PF-01..PF-03 (4x CPU throttle); D-13 (movers 2 / 3 / 4
  "a design floor"), D-15 (wholes 3 / 4 / 5); LIFE 10.3; measured costs from `_handoff/maps/PHYS.md` 172-179.
- **What, with numbers.** Measured: an awake detail-3 whole costs 0.69 ms resting and 0.87 ms pressed (a mover about 0.9, 14.2); a touching pair
  adds 0.22 ms; six detail-2 pieces cost 1.15 ms (0.19 each); on the loaded dev machine a whole costs 1.6 to 2.3 ms. PF-01 to PF-03 multiply the
  container by a 4x throttle: an awake whole becomes 2.8 to 3.5 ms and a piece 0.77 ms.
  - **low (4.0 ms):** the design floor of 2 movers plus 1 touched body = 2.67 ms in node, **10.7 ms** throttled (2.7x over). One touched body and
    one mover = 7.1 ms. Only ONE awake whole fits (3.5 ms), so the floor cannot pass PF-02.
  - **med (6.0 ms):** PF-05's own scenario passes its 2.0 ms node bar, then costs **8.0 ms** under PF-01's throttle: the two bars contradict each
    other (PF-05 would need 1.5 ms). At the unit cap (4 awake) it is about 3.5 ms in node and 14 ms throttled. Even with no phone factor, 4 awake
    wholes on the loaded machine cost 6.4 to 9.2 ms.
  - **high (10.0 ms):** unitCap 5.5 is about 4.8 ms in node and 19 ms throttled.
  - **cut (PF-03, med):** 3 wholes and 5 pieces is 4.75 units, under the 1.3 x 4.0 = 5.2 refusal line, so it is allowed with all of them
    awake: 3 x 0.87 + 5 x 0.19 = 3.56 ms in node, **14.2 ms** throttled.
  The only lever the spec names is "PF-01 lowers unitCap", which cannot go under the mover floor and does not bound the bodies the PLAYER wakes:
  a touch, a toss, or the arrival hop B09 that every party member does on each trip.
- **Fix:** before PG_LIFE writes `attention.ts`, settle the phone factor with one measurement: run one detail-3 body throttled against the same
  body unthrottled on this container. Then state every budget in container milliseconds, so that PF-05 and PF-01 are the same bar. Set the
  per-tier awake budget from the measurements, for example low = 1 awake whole + the touched one, with the rest asleep or still (singing and
  swaying are render-only, so they can be asleep). Lower the low-tier mover floor to 1, or keep 2 only for pieces. Add a shell rule that
  untouched wholes over the awake budget stop moving and are allowed to sleep, rather than only refusing a cut. Re-quote Q4 ("every clause
  reachable at low caps"): S07 snuggle needs 3 awake bodies.

---

## Majors

### M1. The first-load size estimate is 2 to 3x low on measured bytes, and the named fix cannot recover it
- **Where:** PLAYGROUND_BUILD 14.3 (delta 60 KB target, 70 KB hard, "about 65"), PLACES 6 ("about 1.5 KB in the first load" per place), D-42,
  PG_DATA brief "Budgets"; `vite.config.ts` 24.
- **What:** the first-load budget is 1300 KB = 1139 KB today + 90 KB for the UI overhaul (UI.md 21 says it fills the 1229 KB gate) + 70 KB, so
  70 KB is the real ceiling.
  - **Data.** One place modelled to the field lists of section 6: PlaceDef 2.3 KB, its REACTIONS cells as `{ tag, key }` for 7 columns x 12
    families 4.1 KB, its 10 quests 1.1 KB. That is about 7.5 KB a place, not 1.5. All ten places cost about 75 KB, more than the whole hard cap.
    For comparison, `catalog.ts` is 32 KB minified.
  - **Code.** At the measured 13 to 21 B a source line, LIFE's 12 KB is 600 to 900 lines for 19 behaviours, 18 social moments, the wish
    scheduler, the voice planner, attention, looks, pieces and 13 API functions. The shell's 12 KB is less than `cut.ts` alone (12.8 KB). The
    quests reducer, journal store and gift grant at 7 KB is about half of `store.ts`.
  - A realistic delta is 140 to 250 KB. "Move non-Home code into the away chunk" cannot recover it: LIFE, the reducer, the journal and the hosts
    all run at Home from minute 0.
- **Fix:** keep only what Home needs in the first load: the ten names and `stampsToOpen`, Home's PlaceDef, and the rules of chapters 0, 1 and 10.
  Move each other PlaceDef and its quest rules into that place's chunk, or the away chunk for Hearthlog, loaded when the place opens. Move
  `REACTIONS` out of `life.ts` into `journal_text.ts`: it is text keys, and LIFE uses `FAMILY_REACT`, `GAITS` and `LOOK_RATES`. Encode a
  thing's reactions as one tag string. Give each lane a first-load byte cap that sums to 60 KB. Require every lane report to give the minified
  bytes of each new module, using the one-file rolldown script above (node, light, no build), after every step, so the overrun shows at step 0
  and not at SZ-01.

### M2. A chosen gift can be lost: grant step 2 is a throttled hoard write, not a synchronous one
- **Where:** QUESTS 11 (the three steps), PLAYGROUND_BUILD 12 and 22 ("a crash in the milliseconds between two synchronous writes"), PG_QUESTS
  item 8; `src/collection/index.ts` 121 (`changed()` calls `store.markDirty()`); `store.ts` 561-567 (`schedule` waits out `SAVE_THROTTLE_MS` =
  2000, `constants.ts` 32); `store.ts` 557 (a failed write only sets `dirty`).
- **What:** every collection grant only marks the hoard dirty. The write follows up to 2 s later, or never if storage refuses it (quota). The
  journal writes step 3 (`granted`) unthrottled at once. A kill, crash or quota failure inside that window leaves the journal at `granted` with
  no ghost row. Load recovery looks only at `pending` gifts, so that gift is gone for good. The accepted risk in section 22 rests on a
  synchronous step 2 that the store does not do. `pagehide` flushes cover normal closes only.
- **Fix:** step 2 calls `store.flush()` and confirms the row reached storage (`report().save === 'ok'` and the id is in the stored text) before
  step 3 runs. If it did not, the gift stays `pending` with "Your gift will wait here." Also on load: a `granted` gift whose id is on no shelf and
  in no blend row's parents goes back to `pending`. Add a CO-05 row: step 2 with a failing storage, then a reload.

### M3. The touch gate cannot tell LIFE's `moveTo` from a ceremony's or the cut's
- **Where:** PLAYGROUND_BUILD 8.7 and PG_PHYS step 1 ("LIFE's `moveTo`, `setSquash` and `hop` pause and ease out within 0.12 s; ceremony drivers
  are untouched"); PH-02; `src/contracts.ts` 153-154 (`moveTo` is a ceremony driver); `softbody.ts` 1213-1219 and 1863-1873 (one target, one
  flag, no owner and no ease); `src/shell/cut.ts` 213 (cut steering uses the same `moveTo`).
- **What:** physics sees one `moveTo` with no source. Gating it while HELD also gates cut steering and ceremony slides, so PH-02's "ceremony
  drivers untouched" fails. Not gating it leaves LIFE's scoot running under the player's finger. The "ease out within 0.12 s" has nothing to act
  on: `moveTo` is on or off at a fixed rate.
- **Fix:** add a LIFE-only driver to the PLAYGROUND block, for example `scootTo?(x: number, z: number, speed: number): boolean`. It is gated by
  the touch gate, eases out over 0.12 s, is horizontal only and leaves the corral as `moveTo` does (softbody.ts 1858). Keep `moveTo` for
  ceremonies and the cut, never gated. Change LIFE 5.1 "Scoot", D-10 and 11.2's arbiter to name it.

### M4. Props have no link back to things or parts, and the order of `poses` is not defined
- **Where:** `src/contracts.ts` 562-592 (`PropWorldLike`: `count`, `poses` "8 floats per prop", `drainStrikes` gives a prop index, `raycast`
  returns a prop index), 609-610 (`bindProps` "place order"), 499-500 (`SoftEvent.prop`), 762-767 (`LifeSnapshot` things); PlayEventRing.thing
  (826); QUESTS R3 (`distinct 'part'`).
- **What:** one ThingDef becomes several props. The Shell Chimes are 5 hinges plus frame posts, the Snug Basket 6 ring segments, the kettle a
  block and a sphere. Three lanes need prop index to thing index and part: the shell (USE events with `thing` and `part`, prop bumps, taps by
  `raycast`), render (which mesh each pose drives) and the LIFE host (which `thingX`, `thingZ` and `thingState` row each live thing is). Nothing
  carries it. "Place order" is not defined, so every lane would re-derive the packing PG_PHYS chooses. The snapshot also has no thing id and no
  present flag, but Home's things arrive one by one, so the live list is not `PlaceDef.things`.
- **Fix:** add `readonly propThing: Int16Array` (place-local thing index per prop) and `readonly propPart: Uint8Array` to `PropWorldLike`. Define
  `poses` as every prop in ThingDef order, parts in order, walls last. Add `thingId: Int16Array` (or a present byte) to `LifeSnapshot`, with
  `nThings` = the things out now.

### M5. Body identity is missing everywhere LIFE and the units model need it
- **Where:** PLAYGROUND_BUILD 8.9 ("32 slots keyed by a shell-assigned slot index"), PH-19; `LifeSnapshot.bumpA/bumpB` (contracts 768-771); LIFE
  10.3 ("+0.3 per pair of awake bodies in contact, computed by the shell from the bodies' flags"); `softbody.ts` 353, 722 (`bodyId` is a
  per-process counter), 1405 (`bodyId & 15`), 1409 (`emit('bump', ...)` names no partner).
- **What:** (a) no contract member lets the shell assign the 8.9 slot. (b) A `bump` event does not say which body was hit, so the shell cannot
  fill `bumpA/bumpB`. (c) No flag or metric says which bodies touch, so the deterministic `units` contact term has no input. (`bodies.contactBodies`
  counts the bodies that take part in contact, not the pairs touching, bodies.ts 165.)
- **Fix:** add a writable `contactSlot?: number` (0..31) to `SoftBodyLike`, keying the bump memory and the next two members. Add
  `SoftEvent.other?: number` (the partner's slot, on body bumps). Add `SoftMetrics.contacts?: number` (a bit per slot touching this frame). The
  shell then fills the bumps and the contact term from those. Until then PH-19 cannot be met: the bump memory still collides past 16 bodies.

### M6. The music clock leaks wall-clock time into LIFE's decisions
- **Where:** `LifeSnapshot.musicField`, `musicOn`, `musicBoxOn`, `beatPhase` (contracts 734-738), filled from `SquishAudio.musicClock`
  (676-677, AudioContext time); LIFE 6.1 S06 (enters "on the next bar line"), 8.4; PLAYGROUND_BUILD 4 and SH-01 ("deterministic under
  `DebugHook.step`"), CS-14.
- **What:** LIFE reads no clock (L1), but the snapshot carries the AudioContext clock. That clock runs in real time while `DebugHook.step`
  advances sim time in jumps, and it is absent until the audio unlocks. When a song starts, which rest tone each singer takes and the voice
  `delayS` all depend on it, so the intent hash differs from run to run whenever music is on. LF-01 passes in node on scripted snapshots and
  hides it; SH-01 and CS-14 cannot hold.
- **Fix:** LIFE decides on sim time only. Use the music's own 66 BPM grid from `t` for bar lines, and decide the field from `t` and the bed's
  seed, or not at all. The AudioContext reading goes only into the `at` the shell passes to `creature()` and the render sway phase, after LIFE has
  decided. SH-01 runs with music on and asserts equal intent hashes over two runs.

### M7. Float mode dies at Home, and three rules disagree about when it applies
- **Where:** PLAYGROUND_BUILD 8.10 and PH-21 ("with a PropWorld bound, `gravity = false` is ignored"); S0 binds a PropWorld at Home (the Felt
  Ball, M13; PLAYGROUND_BUILD 15); PLACES P12 (Float only "for a single squishy at Home with autonomy paused"); SH-11 (overridden "in places and
  with more than one body"); `src/shell/game.ts` 364-365, 783; `src/input/keyboard.ts` 105-110 (the G key).
- **What:** from S0, Home always has a PropWorld bound, so PH-21 silences the existing Float setting and the G key at Home too. The shell still
  calls `stage.setFloatMode(true)`, so the stage draws float mode while the body sits. P12 also overrides Float with autonomy on (the default),
  which reverts every saved `gravity: false` with no line, while SH-11 keeps it at Home with one body.
- **Fix:** pick one rule and write it in P12, 8.10, SH-11 and PH-21. Suggested: Float works at Home with one squishy out; while it is on the
  shell binds no PropWorld (Home's things are parked) and LIFE issues no motion. Everywhere else the shell forces gravity, shows the line once, and
  never calls `setFloatMode(true)`. Physics then needs no "ignore" rule; PH-21 becomes a shell row.

### M8. Home's spawn and bounds contradict DT-01 and the mat slots by the spec's own numbers
- **Where:** PLACES 4.1 (spawn = `stage.matLayout(n)`; LIFE bounds "a disc of r 3.1 m"; "the smallest gap between a thing's edge and a body is
  0.17 m (a shelf corner) and at least 0.26 m for every other thing"); `src/render/stage.ts` 87-88 (`MAT_SLOTS_TALL[3]` = (1.8, -2.6),
  `MAT_SLOTS_WIDE[3]` = (2.6, 0)), 643-648 (x body scale); DT-01 (spawn at least 0.9 m from every thing, inside bounds - 0.825 m); PG_DATA S1
  ("DT-01 passes for Home and Hearthlog with no move"); `PlaceDef.spawn` (PLAYGROUND_BUILD 6, a fixed list).
- **What:** (a) The 0.9 m spawn rule is centre to thing edge (0.625 + 0.275). Home's gaps of 0.17 and 0.26 m plus R 0.625 give 0.80 and 0.885 m,
  so DT-01 fails at Home for every thing. (b) The 4th mat slot (med's cap) is 3.16 x s from the centre on a portrait phone, which is outside the
  r 3.1 bounds at every body scale from 0.98 up. On a wide frame it is 2.6 x s, outside the LIFE target disc (3.1 - (R + 0.2), with R = 0.5 x s)
  from s = 0.94 up. So on med and high the 4th and 5th wholes spawn where the place corral at once glides them inward, which is autonomous
  motion with no intent, and B11 fires. (c) A fixed `spawn` list cannot express a layout that depends on the frame and the body scale.
- **Fix:** Home's PlaceDef sets `spawn: 'matLayout'`, and DT-01 checks the actual `matLayout` output: both frames, n = 1 to 5, scale 0.8 to 1.25,
  against Home's things and bounds. Make Home's LIFE bounds a rounded rectangle that holds every slot plus R + 0.2, or a disc of r 4.2. Move the
  shelf and the lamp so that every gap is at least 0.9 - R, or make Home's spawn rule its own.

### M9. The cabin's Rocker Board goes through the floor before it reaches its limit
- **Where:** PLACES 4.2 (board 1.6 x 0.16 x 0.6, "pivot 0.16 m, limit 12 degrees"), 2.1 M7 ("pivot 0.12..0.20 m; limit at most 14 degrees"),
  DT-01 ("a seesaw's footprint is its board"); PLAYGROUND_BUILD 8.4 (hinge with limits only, no prop-floor contact); P1.
- **What:** with the hinge at mid-thickness, the low corner at 12 degrees is at 0.16 - 0.8 sin 12 - 0.08 cos 12 = **-0.085 m**. With the hinge on
  the bottom face it is still -0.006 m. A sitter on the low end is then pushed below y = 0 by the prop pass while the table pass holds every
  particle at y >= 0: a squeeze between two passes in the same substep. The board is also drawn into the floor. With pivot at most 0.20 m and
  thickness at least 0.16 m, MECH_RANGES' 14 degrees is only safe for boards up to about 1.0 m long.
- **Fix:** add a floor rule to DT-01 and MECH_RANGES: pivot >= (L/2) sin(limit) + (t/2) cos(limit). For the cabin, either pivot 0.25 m with a
  12 degree limit, or a 5.7 degree limit at pivot 0.16 (the end touching the floor is the limit). Or give hinge props a floor contact in
  `props.ts`, and say which in 8.4.

### M10. Photo quests need a Snap preview that does not exist, so two gift finales would force a file download
- **Where:** QUESTS Q8 ("counts when the shot is taken (the preview shows), never on a file save"), X8 (S1 gift finale), G8 (S2 gift finale), the
  dark-pattern row "a file download to finish a quest: no"; the Friendship Frame "the photo shows in it on the Journal page" (275); `src/shell/hudBinding.ts`
  268-304 (Save = capture, `toBlob`, download, in one press; no preview); journal format (PLAYGROUND_BUILD 12: no photo field, 16 000 chars).
- **What:** today the shot IS the file save, so PHOTO can only be produced by downloading a PNG. Every photo finale then puts a file on a child's
  device, the pattern QUESTS 12 promises never happens. The Frame's photo has no storage: a capture is hundreds of KB, against a 16 000-character
  journal. No lane brief designs the missing preview.
- **Fix:** give PG_SHELL a shutter step: the Snap bar's shutter captures, shows an in-page preview (a downscaled data URL; the CSP allows
  `img-src data:` but not `blob:`), PHOTO is pushed at the shutter, and Save is optional. The Frame keeps one thumbnail of at most about 12 KB
  (JPEG data URL, about 160 x 120) under its own key `wobblehoard:v2:journal.frame`, or drop "the photo shows in it". Add an SH-18 row that X8
  completes with no download.

---

## Minors

1. **The Snug Basket cannot hold "a pile of 3".** PLACES 4.2 (ring r 0.90, segments r 0.09, "a pile of 3 fits"), M4 (r 0.70 to 1.00). The inner
   clear radius is 0.81 m. Three of the smallest wholes (R 0.40) need 0.40 x (1 + 2/sqrt 3) = 0.86 m, and two average wholes (R 0.5) need 2.0 m
   across against 1.62 m, so the basket holds one average whole. The S08 pile there will jostle against the segments. Fix: either a ring of
   r >= 1.35 (two R 0.625 wholes; re-lay the cabin), or make the basket a nap patch with a ring look, and correct the text.
2. **A capsule's `size[1]` is undefined (segment or total length), and the cabin's spawn check depends on it.** PLAYGROUND_BUILD 6 (`[r, length,
   0]`), PLACES 4.2 (seat "r 0.09 x 0.7 m along z" at z -1.85). If 0.7 is the segment between cap centres, which is the natural capsule
   parameter for physics, spawns (0.7, -0.55) and (-0.85, -0.55) are 0.86 m from the seat's swept box, not 0.95, and fail DT-01's 0.9 m. Fix:
   define `size[1]` as the total length including the caps in the data model and in `props.ts`, and re-run the cabin script.
3. **The contract's capacity is 16, but LF-07 tests 40 characters.** Contracts 713 and 721 say at most 16; PLAYGROUND_BUILD 18 LF-07 says "10
   wholes and 30 pieces". Fix: make LF-07 16 characters (for example 6 wholes and 10 pieces) asking 50 a second.
4. **A POSE intent needs 5 arguments; `LifeIntents` has 4.** Contracts 785-789 (`a`, `b`, `c`, `d`) against `setBodyPose` (626: lean x, lean z,
   sway amplitude, sway Hz, sway phase). Fix: add `e: Float32Array`, or say the host takes the phase from the beat.
5. **The wish caps contradict each other.** LIFE 10.1 allows phone bubbles "2 (+1 kept for a wish)"; QUESTS 8 and LF-14 allow "2 on screen"
   wishes. With 2 wishes and 2 other bubbles, LF-07 fails while LF-14 passes. Fix: one rule, for example "wishes count inside the at-once cap and
   only 1 is shown per phone frame".
6. **The five new settings are lost on a rollback.** PLAYGROUND_BUILD 11.9 ("v stays 2"); `src/core/settings.ts` 8-9, 118, 176-178. An older v2
   build drops unknown keys and carries them only for a blob with v > 2. Opening the CDN build (2683d349), a rollback, or an older tab erases
   Voices, Place sounds, autonomy and both bubble switches. Fix: set `SETTINGS_VERSION` to 3; migration stays by absence.
7. **The contract says no object per call, but `creature` and `prop` take one; it must also forbid audio keeping it.** Contracts 488-489 against 674
   and 686. SH-01's 0 B a frame forces the shell to reuse one parameter object and one `phrase` array. Fix: add "the caller reuses `p` and
   `phrase`; audio copies what it needs during the call and never keeps a reference", and test it in AU-11.
8. **Sleep control is underspecified.** (a) No member lets the shell put a body to sleep, yet LIFE 10.4, PLAYGROUND_BUILD 11.4 and SH-12 say "the
   shell puts the farthest untouched whole to sleep"; the contract has only `wake()` and `sleepEnabled`. (b) 8.6 wakes a body on "any driver"
   and "a mods change", so if the host re-sends a converged SQUASH pose at 10 Hz, or a drying foam's `mods[4]` changes every 0.1 s (11.2), the
   body never sleeps, though LIFE 5.1 says a converged pose may. (c) `mods[4]` is written only for the foams (11.2), so pop dome keeps
   density 1 and sits, against the float table (PLACES 2.5, S2). Fix: add `sleep?(): boolean` (freeze now if under a looser rest bound); make
   an identical `setSquash` a no-op; wake only on a change of a modifier that acts where the body is; write `mods[4]` for every family from
   `FAMILY_REACT`.
9. **T1 cannot attribute the two halves of a place chunk, and nobody owns a joint facade.** PLAYGROUND_BUILD 13 ("render and audio ... loaded
   together"), 17 T1. `StageLike.loadPlace` and `SquishAudio.loadAmbience` are separate dynamic imports, so `render/places/<id>.ts` and
   `audio/places/<id>.ts` (and `render/place.ts` against `audio/ambience.ts`) become separate chunks. T1 names only the render facades and says
   nothing about lazy chunks it cannot name, so the audio halves escape every per-chunk cap. Section 9 also puts place text in the place chunk,
   while 14.3 and D-42 put it in the screens chunk. Fix: T1 sums the render and audio chunk of a place (and of the away chunk) and fails on any
   lazy chunk it cannot name. Pick one home for place text.
10. **`probe_playground`'s run shape.** `_harness/run_probes.ts` 12 runs every probe with no arguments, and PG_PHYS "You own" says "`--quick` for
    the default run", which is ambiguous. My estimate of PH-01, 03, 04, 09 and 18 on 12 families x 3 genomes is 1 to 2 minutes at 0.7 to 0.9 ms a
    body-frame: a heavy job inside every `run_probes`. PH-11 (0 B per 120 frames "with props, zones and drivers") also fails whenever an event
    fires, because `emit` allocates three objects per event (`softbody.ts` 2696-2699). Fix: with no arguments the probe is the quick set (under
    20 s); add `--full`. Measure PH-11 over windows with no event, or pool the events.
11. **Journal ids and warmth.** (a) "Entries keyed by a real (non-ghost) item id" (12) has no test. Ghost ids are `'g-'` + 12 characters, but the
    slice-1 starter keeps its old id (`types.ts` 24) and gifts are `'jg-'`, so a prefix test would tag Dollop's and the gifts' warmth with the
    acctTag and drop it on sign-out. Fix: classify by the Hoard item's `ledger`. (b) `wm` is pruned "to ids still on the shelf at load". After a
    merge whose journal write lagged the hoard's, the parents' warmth is pruned and the child's is never set, so warmth falls (against CS-13).
    Fix: before pruning, move a pruned parent's warmth to the blend row that names it (`store.ts` 100-110).
12. **The journal's worst case leaves out account ids.** CO-02 and "about 7 KB" (12). With real ids of up to 64 characters (`ID_MAX_LEN`) plus a
    32-hex acctTag, 100 `wm` rows are about 10.7 KB. With 40 `qp` rows holding pair sets (about 4 KB), 128 `fr` and 128 `fd` rows (about 3 KB) and
    `fx`, the total is about 18.8 KB, over `JOURNAL_MAX_CHARS` 16 000, and the behaviour over the cap is not defined (a refused write loses
    progress). Fix: put the acctTag once per blob, not per row; key `wm` by a short index; define the order of pruning over the cap.
13. **A Journal gift shows "Restock" in the Hoard.** Origin `'restock'` (QUESTS 11) and `src/collection/copy.ts` 202-203 give "Restock" as its
    origin line. Fix: `originCopy` says "A gift from the Journal" for `'jg-'` ids (PG_QUESTS owns `copy.ts`'s addition, or it is reported to
    the collection owner).
14. **C6 may never complete: what counts as entering a zone for a new character?** QUESTS C6 (`PIECES{WARM, place hearthlog, minN 3}`); LIFE B15
    ("its first entry into a warm ... zone this visit"). Pieces made by a cut are born inside the hearth's warmth. If an "entry" is a crossing
    from outside to inside, they never enter. Fix: define in LIFE 3.1 and 4 that a character that comes out, arrives or is cut inside a zone
    enters it at once.

---

## Things I tried to break and could not
- Interface merging of `SoftEvent`, `SoftMetrics`, `SoftBodyLike`, `AddBodyOpts`, `StageLike`, `AudioSettings`, `SquishAudio`, `DebugHook`: all are
  interfaces, every member is optional, and the typecheck is clean. 11.9's Settings recipe matches `settings.ts` 91-110 (`ResolvedSettings` =
  `Required<Settings>`).
- Lazy chunks under the CSP: `script-src 'self'` allows same-origin dynamic chunks, and Vite's preload links are same-origin. The Travel postcard
  gradients are set through the CSSOM, which `style-src 'self'` allows. The only CSP trap I found is the `blob:` image in M10.
- The `'jg-'` id: at most 3 + 40 + 1 + 2 = 46 characters inside `ID_PATTERN`; origin `'restock'` is a known code (`store.ts` 50, 96); the
  restock's own once-a-day state is `ghostRestockDay`, not the rows, so a gift row does not block the daily Restock.
- The salts: the 16 `^ 0x` / `mulberry32(0x` constants in `src` match LIFE 11 exactly, and none of the six new salts is in `src`.
- The swing: seat speed sqrt(2 x 10 x 1.4 x (1 - cos 30)) = 1.94 m/s and seat height 0.41 m, as written. The hearth and basket clearance is 0.51
  m and the basket's warmth 0.76, as written. Character caps: low 2 + 4 = 6, med 3 + 5 = 8, high 4 + 6 = 10 after a cut, as the formula says.
- `moveTo` copies its target (`softbody.ts` 1216), so a host can reuse one V3. Supported gravity drops to 0 as soon as a body leaves the table
  (`supp` at 2290 is not eased), so the ballistic hop arithmetic holds for the impulse itself.
