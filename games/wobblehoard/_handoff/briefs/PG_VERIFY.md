# PG_VERIFY: independent verification charters for PLAYGROUND (per lane, per slice, and the whole game)

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
page and the lane brief of what you verify (`_handoff/briefs/PG_<LANE>.md`). The specs are `_spec/PLACES.md`, `_spec/LIFE.md`, `_spec/QUESTS.md` and
`_spec/PLAYGROUND_BUILD.md` (section 18 holds every check id and its bar; section 19 the charters in short; section 23 the review findings that
were not adopted, and why). Paths are relative to `games/wobblehoard`.

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84).** New rows to re-run: DT-15, DT-16, LF-21 to
LF-26, PH-22, PH-23 (PH-21 moved to SH-11), RD-16, RD-17, AU-14, QU-13 to QU-16, CO-10, CO-11, SH-20 to SH-22 and PF-00; changed bars: PF-05 =
6.0 / F ms, SZ-02 total 2000 KB with a 110 KB life chunk, FN-01's bubble within 10 s of the first 6 s release. New attacks are marked **(r3)**.

**Revision 4 (2026-11-16, after `_handoff/design/CONFIRM.md`; PLAYGROUND_BUILD.md D-85 to D-93).** New rows to re-run: PH-24, PF-06; changed
rows: DT-01 (rider paths, push spots, use spots with a body clear, Home's laid spots with `fromN`), DT-09 (VISIT exempt), LF-06 (use spots exempt,
Home's segment rule), LF-10 (the floor, the ride allowance, the soft boop), PH-04 (riders never corralled), PH-14 (a locked untouched body's bump is
`auto`), PH-15 (`scootTo` on a floater), RD-16 (a whole body at every LIFE target and use spot, every slot inside the corral rectangle), SH-14,
SH-21, SH-22, QU-03, QU-09 ("Tap it yourself" for every thing a tap swings), SZ-02 (the life chunk 150 KB, the away chunk 90 KB, the overflow
order). New attacks are marked **(r4)**. FN-01 at 390 x 844 waits for PLAYGROUND_BUILD 24's first question: report it, do not fail the slice on
it alone.

## Rules for every verifier
- **Never the builder.** A fresh verifier per lane and per slice. You change no file in `src` or `_harness` and run no git write command. You may
  read git (`git log`, `git show`, `git archive`).
- **Work on a snapshot of the commit your task names**, never the live tree (other engineers are editing it): `git archive <commit> games/wobblehoard |
  tar -x -C <scratch>/snap`, then link the dependencies: `ln -s /home/user/forgeflow-games/games/wobblehoard/node_modules <snap>/games/wobblehoard/node_modules`.
  Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify_<area>_<slice>/`.
- **Ports** (SESSION3: verifiers 5370 to 5377): RENDER 5370 and 5371; SHELL and UI 5372 and 5373 (prod-build uses PORT + 1); the WHOLE GAME 5374 and
  5375; AUDIO 5376 and 5377. DATA, QUESTS, LIFE and PHYS are node only. One heavy job at a time (a browser run, a build, a full probe suite, an
  offline audio render, a perf measurement, any node job over 60 s); kill everything you start (`ps -eo pid,args | grep -E
  "headless_shell|vite|_harness"` shows nothing of yours when you finish).
- **Your report** is `_handoff/reports/PG_VERIFY_<area>_<slice>.md` (for example `PG_VERIFY_LIFE_S1.md`), the only repo file you write. Keep it as a
  running report (agents get cut off). For every check id: PASS or FAIL, the number you measured against its bar, the command that measured it.
  Every finding: an id, a severity (MAJOR = breaks a gate, a safety or product rule, an owner ask or a core feel; MINOR = visible or measurable but the
  game works; NOTE), a repro command with its output, the file and line when known. Name every screenshot you looked at. End with what you did not
  check. Never round up, never loosen a bar, never accept a stub you wrote as proof of the real thing.
- **Write your own checks too**, not only the lane's probes: the lane's probe can be wrong. Each charter below lists the attacks to make.

## 1. DATA and QUESTS (node)
Re-run from scratch: `npx tsc --noEmit -p tsconfig.json`; `_harness/probe_pg_data.ts` (DT-01 to DT-16, T6); `probe_quests.ts` (QU-01 to QU-16);
`probe_journal.ts` (CO-01 to CO-11); `probe_pg_economy.ts` (EC-01 to EC-03); `probe_genome`, `probe_catalog`, `probe_collection` (73/74 with C08
the known open row) and `probe_collection_imports` unchanged.
Attacks:
- Re-implement DT-01's geometry yourself (footprints, capsules by their total length, swept ranges, clearances, spawn rules, the pad and the
  physics zones, **the seesaw floor rule, the ring's clear opening, the tall frame**) for every shipped place **in both layouts (r3)** and compare;
  the cabin must give 0 problems in each with PLACES 4.2's numbers; Home's spots against `stage.matLayout`'s real output (stage.ts 87-88, both
  frames, 1 to 5 bodies, scale 0.8 to 1.25). **(r4)** Add the ride rows yourself (a swing's seat centre over its whole arc, L sin(limit) to each
  side, inside the rounded bounds; a rider of R 0.625 clear of the walls and 0.625 m from every other collider; the push spot with a pusher of R
  0.625 clear) and check that the revision 3 cabin fails them and the revision 4 one passes; re-project Home's twelve spots with your own camera
  model (from stage.ts) and confirm each shows from its `fromN` (at most 3), is behind no slot body and has a use spot with a whole body in view;
  confirm the Leaf Teeter's pivot meets the floor rule (0.235 m needed). Re-derive DT-10's float table by hand for three families; run the real name gate
  (`_harness/probe_catalog.ts` 76-298) over every name, player line **and reaction cell (r3)** yourself.
- For every quest: build the minimal event stream by hand from QUESTS 6 and confirm it completes; a near miss (one count short, the wrong place, the
  wrong `by`, **the wrong thing on a REACT, a PIECES n one short, a repeated part in `v` (r3)**) does not. Confirm a LIFE-only stream (no player
  event) completes **no gift finale** (QU-07: I8 needs a wish the player granted) and not X10 (r3).
- **(r3) Shown quests:** with the S1 shipped set, list every shown quest and prove each can complete (QU-14: Friends Everywhere shows X1, X2, X3, X6
  and X10 only); with autonomy off, prove every opening threshold is reachable (QU-16) and find one quest that shows "Needs: Squishies move on
  their own".
- **(r3) The first wish:** with no Dollop owned, with Dollop on the shelf, and with every character held until 5:00, Hearthlog opens by 5:00 of
  play and H8 completes on the first arrival with any party (QU-15).
- Attack the save by hand: hostile JSON (wrong types, huge arrays, a 2 MB string, `__proto__` keys, a newer `v`), two tabs writing alternately, a blob
  merged with itself (identity), a gift grant interrupted after each of its three steps, **step 2 with a failing storage (quota) then a reload:
  the gift stays pending, never granted without a row (r3)**, a round trip through today's `serializeHoard`, the shelf at `GHOST_CAP`, two claims
  on one UTC day, a species not on the list, a signed-in ledger (no gift, the "for now" line). Exactly one gift per chapter, at most 5 for life.
  **(r3)** The worst-case blob with 64-character ids under 16 000 characters; a forced over-cap write drops only `fd`, then Met-only `fr`, then
  unnamed `ids`, and a refused write loses nothing (CO-11); the slice-1 starter's old id stays practice and a `jg-` gift shows "Gift" in the Hoard
  (CO-10).
- Confirm the reducer imports no meter function, contains neither roll function's name (I03) and allocates 0 B over 10 000 events.
- Recompute the stamps pace (QU-11, with the gift pair Puddlo and Boingle) and the gift arithmetic of QUESTS 11 with your own numbers; say where
  you differ.

## 2. LIFE (node)
Re-run `probe_life.ts` and `probe_life_imports.ts` (LF-01 to LF-26). Attacks: grep `src/life` for `Date`, `performance`, `Math.random`, `setTimeout`,
`moveTo`, any DOM or three import, **any music clock read (r3)**; three seeds x 10 sim minutes give equal hashes run to run and different hashes
between seeds; **the same run with the music clock frozen and jumping gives the same hash (LF-26, r3)**; the same sim time stepped at 30 and 60 fps
decides the same (LF-16); a storm at the snapshot's capacity (16 characters, for example 6 wholes and 10 pieces, LF-07) asking 50 times a second
never exceeds a cap of LIFE 10.1 in any rolling second, in all four columns, the wish slot included, and a P1 is never starved; a HELD character (touch, carry or a lock on it) gets 0 motion intents in the
same tick and none for 1.5 s after, **and a lock with no finger down silences nobody else (r3)**; the huff's trigger table (read the code, not only
the probe) contains no player act, absence or timer; the wish caps; FIRST_PLAY makes Dollop's ball use start within 10 s of a 6 s pause, and fires
once per profile; **(r3)** the motion gate's caps equal the formula of PLAYGROUND_BUILD 14.2 at the F that PF-00 reported (recompute them), units
never pass unitCap after a start that wakes a body, and every joint moment moves one character at a time; **(r4)** on low with three wholes all
asleep one start is granted (the floor, 1.06) and LIFE never stays frozen with two or three out; S11's pusher starts on low and med against a rider
the player set (the ride allowance) and is never cancelled by the over-budget rule; a boop on low and med is a soft boop (the target stays asleep);
at Home every target lies on a segment between framed points, and with one squishy on a portrait phone B03 never fires; every `REACT_TRIGGERS` kind fires under
its condition with the right thing (LF-21); a cut in the warmth gives PIECES n = 3 at once (LF-22); a rider set on the rocker is still there 15 s
later (LF-23); autonomy off issues no motion but the player-asked use and the ride (LF-24); no thing wish outside the thing-kind mask (LF-25); no
natural wish before the scripted first wish; looks rise, fall and reset as LIFE 3.1 says (a cold 0.3 zone still frosts). Then read every behaviour
and social moment of LIFE 4 and 6 against the code and list each one that differs.

## 3. PHYS (node; one physics run at a time)
Re-run `probe_playground.ts` (with no arguments the quick set; then `--full`: PH-01 to PH-23 without PH-21, which is SH-11 now; PF-05 at 6.0 / F ms)
and every existing physics gate (`probe_softbody --quick`, `probe_species`, `probe_families`, `probe_cut`) plus the shell's `probe_app` and
`probe_gestures` with no PropWorld bound and sleep off: they must be unchanged. Attacks: your own torture set on 12 families x 3 genomes and detail-2
pieces: drop on and walk into every static prop shape; rest 3 s on a box top (creep at most 2 mm, then sleep); a seesaw with two sitters for 60 s
(it tips under a sitter, energy only decays, **its low end never goes below y = 0 at the limit (r3)**); a swing pushed hard (seat at most 2.0 m/s);
the ball flicked at walls (never through, at most 2.0 m/s); a pile of 3 that must sleep as an island and stay asleep 60 s; wake on every cause with
zero position jump; NaN hunts (huge `dt`, a prop under a body at spawn, a body dropped between two props); hop apex and landing speed per family
(the S1 cap: apex at most 3.6 cm, no `land`); `carryTo` emits nothing that pays; mass parity (detail 3 against detail 2 within 5%, a 1/8 piece an
eighth). **(r3)** Two real untouched bodies booped together give a body `bump` with `auto` and `other` set (and with a body a finger, a grab or a
carry is on, not `auto`; **(r4)** with a locked body nobody touches, `auto`); **(r4)** a rider set at a swing's or a seesaw's end next to the bounds'
edge is not corralled for its 20 s (the corral is off on a moving prop), and a body resting at any Home slot is never moved by Home's corral
rectangle (PH-24); `scootTo` glides a floating body out of the water;
`scootTo` pauses under a finger while `moveTo` (a ceremony slide, the cut's steering) runs untouched; 40 bodies made in a session with contact
slots never share a bump-memory slot; `sleep()` refuses a moving body; an identical `setSquash` never wakes; a drying foam's `mods[4]` on dry
ground never keeps it awake; `drainStrikes` names the cause (a poke 0, a body 1 with its slot, a gust 2); `propThing` and `propPart` follow ThingDef
order with walls last. List the re-baselined hash rows and check each reason. S2 adds water against the generated float table, the pad, ice; S3
the fields.

## 4. RENDER (browser on 5370; you can see images: judge every screenshot as a demanding art director)
Re-run the new `browser_render.mjs` sections (`place`, `props`, `emote`, `marks`, `pose`, **`homeview`, `size` (r3)**; RD-01 to RD-17) and the old
full harness once per slice. Screenshots of every shipped place **in both layouts** at 390 x 844, 320 x 568 and 1280 x 800 (and 844 x 390 for the
wide layout on a landscape phone): name what looks cheap, muddy, too dark, too bright or confusing. Measure by your own script: the flash gate around
every ceremony tier in each place (at most 2 flashes a second, the ceremony dim easing over at least 1.0 s), the play-area mean linear luminance (at
most 0.35), bubble size (at least 36 CSS px on a phone) and contrast (icon and its one accent on the fill, edge on the place's sky, at least 3:1),
draw calls per place (at most 60), 10 place swaps returning programs, textures and geometries to Home's baseline +-2, context loss in a place.
**(r3)** The on-screen width of a 1 m squishy per place and layout (RD-17: tall at least 100 px at the front and 80 px mid on 390 x 844; wide at
least 150 px mid on 1280 x 800); at Home with 1 to 5 bodies at scale 0.8, 1.0 and 1.25, every arrived thing and every LIFE target inside the frame
and outside the insets, and `visibleTable` within 0.05 m of the rendered frame (RD-16); **(r4)** a whole body (box and top) at every LIFE target and
every use spot in view, every slot centre inside the corral rectangle, Home's things showing exactly from their `fromN`, and the soft boop's render
wiggle on the booped body (no flash, 2 Hz at most in Calm); Calm alone and reduced motion alone each turn every new
motion into a fade (the stamp, the Places button, Home's arrivals, the keepsake drop, the wish re-glance as an opacity lift). Look for: eyes seen
through another body's jelly (RD-12), a swaying sleeper's eyes off its skin (RD-11), any mouth or blush (RD-10), any camera motion while only
autonomy moves bodies (RD-14), any bobbing bubble, any non-token colour. Per-place rows only where a chunk changed, one full sweep before the slice
ships.

## 5. AUDIO (offline, headless Chromium on 5376)
Re-run `probe_audio.mjs` and `audioview/life_checks.mjs` (AU-01 to AU-14) and `probe_chatter.ts` (AU-10). Attacks: every existing seeded render
bit-identical (AU-07); a storm of 50 phrase requests a second (at most 2 live groups at the phone caps, the peak at most one voice + 3 dB); 5000
syllables return to the baseline node count; **(r3)** change the caller's reused `p` object and phrase array right after `creature()` and `prop()`:
nothing scheduled changes (AU-11); a 10-minute cabin visit with no input has tunes at most 20% of the time, no kettle whistle within 60 s of a
Music Box tune, the Music Box at most one start per 40 s and stopped by a second tap (AU-14); a lock with no finger down ducks nothing (AU-13); no
DelayNode anywhere in `src/audio` (grep); chatter silent through a ceremony and 1 s after; the touch duck; each ambience 6 dB under the music long
term, freed within 0.2 s on pause and mute, no audible 2.5 s seam (autocorrelation). Nobody can listen in this container: render WAVs of every
syllable, flavour, the kettle's whistle, place ambience and finale to your scratch folder, analyse them, and fill in the lane's **first-listen
checklist** with what the analysis can and cannot say, so the owner can listen later.

## 6. SHELL and UI (node, then browser on 5372)
Re-run `shellview/node_checks.ts` (SH-01 to SH-13, **SH-20 to SH-22**) and the new `browser_shell.mjs` sections (SH-14 to SH-19, UI-01 to UI-04,
PF-01 to PF-04, SZ-04, the T2 G0 row), plus the SHELL-4 sections once. Attacks: a **keyboard-only walk of a whole chapter** (Home, then Hearthlog
Cabin, **C8 end to end with "Tap it yourself" (r3)**: J, P, Tab out of the party and back, [ and ] inside the party toolbar, Space on the focused
squishy, the keyboard stretch, Enter reading a showing bubble, "Go play with...", the Escape order ending with locks, focus return; **Tab must
never be trapped (r3)**); a screen-reader name pass over every new control (names, roles, "Journal, something new", the one polite live-region
queue with the place-open and arrival lines, no keyboard trap); 390 x 844, 844 x 390, 568 x 320 and 320 x 568 with no overlap of the pill, the
buttons, the plate, the capsule and the meter, every target at least 44 px, **the plate and the wish card in the left half under the pill in
landscape (r3)**; wish hit areas never over the body's silhouette (a press on the body is always a poke); every friend and place wish names its
target in the card and the live region; Snap hides the DOM overlays and **X8 completes at the shutter with no download (r3)**; a spy on
`collection.feed` sees only player-caused events; **two real bodies booping give 0 haptics and 0 shakes (SH-06, r3)**; **a self-completed quest
plays its moment with no haptic (r3)**; the tracker never shows a hidden quest or one blocked by autonomy off (SH-20); Home's things arrive only in
view (SH-21; **(r4)** by their `fromN`, and for n = 1 to 5, both frames and scales 0.8 to 1.25 every slot centre inside the `setBounds` rectangle);
over the awake budget the shell sleeps untouched wholes and never a touched one, and never cancels a ride moment's own mover (SH-22, r4); a v2 settings blob reads as v3 and an old v2
build keeps the new keys (11.9); travel waits for idle, reconnects a cut and releases locks, and **picks the tall layout on a portrait frame and
re-lays on a rotation (r3)**; the Float rule (SH-11); a cut with a party keeps the party; a tier drop sleeps, then shelves with the kind line;
autonomy off gives 0 motion intents but the player-asked use and the ride. Judge every new screen as a product designer and a parent of a
seven-year-old: is every line plain and kind, is anything a nag?

## 7. The WHOLE GAME, per slice (browser on 5374; the slice's commit)
1. **A fresh profile, 10 minutes, through the dev hook** with screenshots at each quest of QUESTS 13: FN-01 (after a 6 s pause Dollop's ball use
   within 10 s, moving the ball at least 0.2 m, all in the frame; **the first labelled bubble within 10 s of that first 6 s release**; the
   newcomer's hello within 5 s), the first wish and the first trip, the Home finale, the cabin's first quests. **(r3)** Repeat the first minutes
   with Dollop merged away (an existing save): a wish still shows and Hearthlog opens by 5:00.
2. **FN-02**: a screenshot by the fireplace with a jellygel, a marshmallow, a mochidough and a slimegoo: name the four different shapes or looks you
   see. **FN-03**: every shipped place's signature verb event fires in a 5-minute scripted visit, in both layouts. **FN-06**: a 10-minute default
   visit on med with 4 wholes: each squishy has at least 2 social moments and 2 thing uses, and the phone bubble cap is never exceeded.
3. **The no-input economy run** (EC-02 / CS-01): 60 sim minutes with autonomy on, travelling to every shipped place: 0 squish points, 0 task progress,
   0 capsules, 0 gifts claimable, 0 haptics (while self-completed quest moments still play), 0 camera moves. Then the economy pace rows (EC-01)
   unchanged.
4. **Size** (one build): SZ-01 first load at most 1300 KB with the UI overhaul landed, the PLAYGROUND delta at most 70 KB and each lane inside its
   first-load cap (physics 18, render 16, audio 8, shell 12, collection 2, data 4 KB); SZ-02 total at most **2000 KB**, the life chunk at most 150
   KB (r4, with the five play-time UI modules), each place (render, audio and data chunks summed) at most 45 KB, the away chunk 90 KB (r4), the
   screens chunk 45 KB; **(r4)** that `wishes.ts`, the moments queue, the party toolbar, the name-tag popover and the Snap shutter sit inside the life
   chunk (no unnamed lazy chunk), and, if any cap was passed, that PLAYGROUND_BUILD 14.3's overflow order was followed; SZ-03 no lazy module in the
   first-load closure; SZ-04 no dev names in the bundle. **(r3)** Check that Home works as today's toy before the life chunk lands (throttle the
   network) and that a failed life chunk load never breaks play.
5. **Performance (r3):** read PF-00's report (the phone factor F and the unit weights), recompute the caps by the formula (**(r4)** with the floor:
   one awake whole plus every sleeper), and confirm PF-01 to PF-03 ran against those caps with a 4x CPU throttle; **(r4)** PF-06, the ride case
   (two riders teetering; one rider pushed by a LIFE pusher) on low and med: physics at most 8.0 ms, the frame at most 16.7 ms.
6. **The copy and dark-pattern audit**: re-check QUESTS 12's table against the real strings and behaviour (no streak, countdown, decay, guilt line,
   nag, number badge, timer, a sulk caused by the player, a file save to finish a quest, a quest locked behind a setting without its "Needs:"
   line); the copy words (sad, lonely, grumpy, hurt, misses you, come back, hurry) in no player string; no heart icon and no "Pals" or "Nook"; no
   line that names a place that has not shipped; "kind" only ever meaning a family.
7. **The owner's five asks** (PLAYGROUND_BUILD 1): for each ask, say what you saw in the running game that makes it visibly true in this slice, and
   what is still missing. S1 must show all five in Hearthlog Cabin: things used in each family's own way, a social party with emotes and voices,
   pieces joining in calmly, and a Journal with onboarding.
8. **A parent's eye** on every shipped place: anything scary, sad, flashing, too loud, too busy, or unkind; anything a child could read as loss.
