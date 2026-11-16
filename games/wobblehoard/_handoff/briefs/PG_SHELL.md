# PG_SHELL lane brief: the hosts, the party, travel, the Journal screens and the keyboard

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
brief. Paths are relative to `games/wobblehoard`.

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23).** What changed for you: every `auto` event
(lands, prop bumps **and body bumps**) goes to the attention budget, never `feedback.handle` (D-62); LIFE's SCOOT goes to `scootTo` and `moveTo`
stays the ceremonies' and the cut's (D-63); you keep the awake budget with `sleep()` (D-61) and give every body a `contactSlot` (D-65); the
snapshot carries `thingId`, `zoneThing`, `patchThing`, the RIDE flag and deterministic music fields only (D-64, D-66, D-74); Home's view and
arrival rule with `visibleTable` (D-67); every place has a tall layout chosen at travel and on rotation (D-68); LIFE and the Journal load in a
**life chunk** after the first frame of play (D-69); the gift's step 2 is a verified write (D-71, in PG_QUESTS's code, driven by your claim
path); the keyboard keeps Tab for the browser (D-77); only completable quests are shown and the tracker follows SH-20 (D-78); autonomy off (D-79);
the Float rule (D-83); the quest moment's haptic only for the player's own deed (D-84); settings version 3; the Snap shutter with an in-page
preview; landscape layouts and one live-region queue.

**Revision 4 (2026-11-16, after `_handoff/design/CONFIRM.md`; PLAYGROUND_BUILD.md D-85 to D-93).** What changed for you: the awake budget's
**floor** (1.06 on low at F = 4) and the **ride allowance** (while a ride moment runs, the riders' units add to the cap and its own mover is never
cancelled; D-85); **Home's corral rectangle** is the union of `visibleTable` and every slot's body plus 0.05 m, and LIFE's Home targets come from
**`lifeSetHome`** (D-87); Home's things show by their spot's **`fromN`** (D-88, PLACES 4.1's table); **`lifeSetPlace` takes the PlaceDef, the
layout and the body scale**, with the same visit number on a re-lay (D-89); **"Tap it yourself"** reaches every thing a tap moves (D-93);
`wishes.ts`, the moments queue, the party toolbar, the name-tag popover and the Snap shutter are **imported statically by the LIFE host** and
ship in the life chunk (150 KB; D-92); `auto` never counts a lock alone (D-86).

## When you may start
**Only after SHELL-4 is verified** (both independent verifiers, STATUS "IN PROGRESS") **and the UI overhaul has landed its tokens and components**
(STATUS "QUEUED" 1, `_spec/UI.md`). The SHELL-4 engineer is in `src/shell`, `src/ui`, `src/input` and `_harness/browser_shell.mjs` today. You
continue from their HEAD: read `git log --oneline -15`, the SHELL-4 diff, and `_handoff/reports/SHELL_4.md` (above all its section "Seams for
PLAYGROUND", lines 243-334 at HEAD 4fe77736: verify every file:line there before you build; lines move). **PF-00** (T13, step 0) gives F and the
unit weights before PG_LIFE fixes the caps; the over-budget rule reads the caps from `attention.ts`, never from your own constants.

## You own
- `src/shell/**`: new `life.ts` (the LIFE host), `attention.ts` (the attention wiring), `events.ts` (the play-event ring), the quest host, `places.ts`
  (travel), the life chunk loader; the party manager grows out of `mat.ts`; additions to `game.ts`, `cut.ts`, `feedback.ts`, `hudBinding.ts`,
  `debugHook.ts`, `boot.ts`
- `src/ui/**`: `journal/*`, `travel.ts`, `tracker.ts`, `wishes.ts` (bubble hit areas and word labels), the moments queue, the gift card, the
  settings rows, the party toolbar, the Snap shutter and preview (revision 4: `wishes.ts`, `moments.ts`, `partybar.ts`, `nametag.ts` and
  `shutter.ts` are imported statically by `src/shell/life.ts`, so they ship in the life chunk, PLAYGROUND_BUILD 11.10; the Journal, Travel and the
  gift card in the screens chunk); `src/input/**` (`keyboard.ts`); `src/core/settings.ts`; **the Settings members of
  `src/contracts.ts`** (11.9, one change with settings.ts so the typecheck stays clean)
- `_harness/browser_shell.mjs` (new sections, the PF rows, the T2 G0 row), `_harness/shellview/node_checks.ts` (new sections), `_harness/uikit/`
  entries for every new HUD element
- Running report: **`_handoff/reports/PG_SHELL.md`**. Port 5366; the prod-build section serves on 5366 + 1 = 5367, which is PG_AUDIO's port: check
  it is free (`ss -ltn | grep 5367`) before that section, or run it with `--port=` a pair the orchestrator gives you. Scratch:
  `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_shell/`

## You must not touch
`src/physics`, `src/render`, `src/audio`, `src/life`, `src/data`, `src/collection`, `src/core` other than `settings.ts`, `_harness/mocks.ts` and
`_harness/run_probes.ts` (the orchestrator's), `vite.config.ts` (task T1 is the orchestrator's). Other contract members: additive and optional in the
PLAYGROUND block only, reported. No git write command.

## Read (completely)
`_spec/PLAYGROUND_BUILD.md` 2 (all decisions, above all D-13 to D-17, D-22, D-23, D-25 to D-28, D-31, D-37 to D-40, D-44, D-46, D-52, D-56 to D-58
and **D-60 to D-84**), 3 (vetoes), 4 (one frame), 7, **11 (your spec, 11.1 to 11.15)**, 12, 13 (chunks), 14, 15, 16, 17 (T2, T9), 18 (the SHELL,
UI, PF, SZ and FN rows), 19, 23; `_spec/LIFE.md` 1, 3.1, 4.1 (the scripts you send), 4.2 (the triggers whose things you fill), 5.5 and 5.6 (HELD,
quiet, autonomy off), 7.2 (bubbles, taps, words, photos, sound off), 9 and 10 (pieces, caps, the motion gate, units), 12; `_spec/QUESTS.md` 3 (only
completable quests), 4 (every event you produce and how `by` is set), 5 (flag bit 3), 7, 8, 11 (the gift's three steps), 13 (the first ten
minutes), **15 (the screens)**; `_spec/PLACES.md` 1 (P6 to P8, P12), 2.2 (patches and zones you turn into mods and flags), 4.1 (Home's view and
arrival rule) and 4.2 (the cabin's two layouts); `_spec/UI.md`; `_spec/LOCK.md` 3; `_spec/CUT.md` 2.

## Traps from the code (HEAD 4fe77736; SHELL_4.md "Seams for PLAYGROUND")
- `simStep` (game.ts 548-562): put the LIFE host and the quest host in as **their own lines**, never as `game.onStep` hooks (D-58: those run after
  the capsules and ceremonies and are UI listeners in registration order). Act (apply intents) before `bodies.step`; sense after `drain()`.
- `drainBody` sends every event of every body to `feedback.handle` (game.ts 528) and `collection.feed` (533); `feedback.handle` plays
  `audio.bump`, `haptics.pop()` and a shake for any bump over 0.05 (feedback.ts 146-151), and a body bump fires above 0.35 m/s (intensity at least
  0.117): **every `auto` event (land, prop bump, body bump) goes to the attention budget only** (SH-05, SH-06, EC-03).
- Physics has **one `moveTo`** (softbody.ts 1213-1219) that the ceremonies and the cut's steering (cut.ts 194-215) use: never touch-gate it and
  never send LIFE's SCOOT to it; SCOOT goes to `scootTo` (D-63).
- The bump memory is keyed `bodyId & 15` today (softbody.ts 276, 1405; `bodyId` per process): give every party body and piece a `contactSlot`
  0..31 at spawn, cut and join (D-65).
- `cut` is emitted only for a swipe (game.ts 650); Split in two and Reconnect all call the cutter directly (hudBinding.ts 242-243) and emit nothing:
  add typed `onCut` / `onWhole` hooks; never parse notice text for a quest.
- A cut replaces the play body (cut.ts 321 `swapTo(..., silent)`), whole-again swaps in a fresh body (376-385), and `stage.setBody` clears every
  view (bodies.ts 112): key a brain by the item id (a piece by its index in `cut.fracs()`), re-attach per-body stage state in `afterSwap`.
- `clearMat` (cut.ts 283) empties the mat on a cut: that changes (11.4). A ceremony's `beforeStart` calls `mat.clear()` (game.ts 381): stash and
  restore the party within 0.5 s, needs and looks kept (11.3).
- The shell calls `stage.setFloatMode(true)` today (game.ts 365): under the Float rule it never does where gravity is forced (D-83, SH-11).
- Space presses the screen centre (keyboard.ts 74-83): with a party it presses the focused squishy (11.8). J and P are free.
- The Snap bar's Save captures, encodes and downloads in one press (hudBinding.ts 268-304); the CSP allows `img-src 'self' data:`, not `blob:`
  (index.html 13): the shutter's preview is a downscaled data URL (11.15).
- The bottom-centre button row is full at 320 and 390 px: the Journal and Places buttons go in the top-right column (QUESTS 15).
- `inputLive` (game.ts 605), the pause `reasons` (315), `holdInput` (819) and `suspend('covered')` are the patterns for sheets.
- `SETTINGS_VERSION` is 2 and an older build drops unknown keys of a v2 blob (settings.ts 8-9, 118, 176-178): it becomes 3 (11.9).

## Build: S0 "Life at Home" (the exit is FN-01, in node through the dev hook and once in the browser)
1. **The frame** (4, 11.1) with zero allocation per frame in every new step (`emit()` allocates three objects per event, softbody.ts 2696-2699:
   never per frame, and your handling of an event allocates nothing).
2. **The life chunk loader** (11.14): `boot` builds the game as today; after the first frame of play request one lazy chunk holding `src/life/**`,
   `src/core/quests.ts`, the journal store, the hosts, the attention wiring, `src/physics/props.ts` and the life, quest and Home data. Until it
   lands Home is today's toy (one squishy, no brain, no things) and the ring keeps the player's events; when it lands the hosts attach, the journal
   loads, Home's things begin to arrive and the tracker fades in. A load failure retries at the next idle moment and never breaks play.
3. **The LIFE host** (11.2): stable character ids; **contact slots**; the snapshot filled in place (LIFE_FLAG bits from metrics: HELD includes
   `locked` for that body's own brain, `memoryBusy` into MEMORY_BUSY, `asleep`, `onProp`, `airborne`, `submerged`, **RIDE**; `thingId`,
   `zoneThing`, `patchThing` through `propThing` / `propPart`; bumps from `other`; **the four music fields from deterministic sources only**: the
   style, the Music setting, your own sim-time tune timers, the 66 BPM grid on sim time, never `musicClock`, D-66); `units` with PF-00's weights;
   the `phone` boolean (coarse pointer or short side under 600 CSS px); `quiet` (a ceremony, a cut busy, any non-Hand tool, Travel or Journal open,
   the desktop Hoard's hold, a hidden tab; the cut squishy's own group leaves it 1 s after the swipe); **the one arbiter** (finger > cut and
   ceremony > LIFE; SCOOT to `scootTo` only); **the awake budget** (D-61, D-85, SH-22: over `unitCap`, with the floor from `attention.ts` and the
   riders' units added while their ride moment runs, cancel the farthest untouched LIFE mover, never a ride moment's own mover, and `sleep()`
   untouched still wholes, farthest first; the touched, carried, tossed and riding bodies are never forced); **the place into LIFE** (D-89):
   `lifeSetPlace(w, placeIdx, visit, def, layout, bodyScale)` on travel and, with the same visit number, on a re-lay; at Home
   `lifeSetHome(w, slot, x, z)` per character (its `stage.matLayout` slot) at spawn and on every party or frame change; `lifeLooks` to `setBodyLook`
   and `mods[4]` **for every family**; `lifeAddLook` with its source thing; `lifeSetJournal(owned, openPlaces, favKnown, thingKinds)` on a journal
   or open-place change; `lifeSetPair`; **`lifeScript`** for FIRST_PLAY (a fresh profile, 6 s after the player lets go of Dollop, once ever),
   FIRST_WISH (60 s after the first reveal, at the latest 5:00; **its arg is the wisher's slot by D-70**: Dollop if out, else a Hearthlog fan out,
   else the party member out longest), POSE, CHEER, PLAY_WITH, SQUIRTED (S2); `lifePhrase` to `audio.creature` (its `at` mapped from sim time to
   `musicClock` only here, after LIFE decided); TOUCH ids per character including SQUEEZE_1S, STRETCH_06, CUT and TOSS_HARD; flag bit 3 on every
   ring record made while autonomy is off; a strike becomes a USE only for cause 0 (the player) or 1 (a body, its slot the actor), never 2 (the
   weather). Never a finger, grab or lock call for autonomy.
4. **The party manager** (11.3): stable ids; caps by tier (wholes 3 / 4 / 5 from `MAT_LIMIT`); Home's spawn at `stage.matLayout` (`spawn:
   'matLayout'`); the party survives a ceremony (a stash, needs and looks kept), a Hoard preview and travel; **the first capsule's newcomer stays
   out** when there is room (D-52); `out` and `back` events with the item id (one BRING record per member, QUESTS 4); the tier drop policy (sleep,
   then shelve with "Plumpet went back to the shelf for a rest."); `sleepEnabled` on every party body; **the Float rule** (D-83, SH-11): Float
   works at Home with one squishy out, and then you bind no PropWorld (Home's things are parked, not drawn) and LIFE issues no motion; with more than
   one out, or in a place, force gravity at run time (the saved setting is never changed), show "Here your squishies stand on the ground." once a
   session, and never call `setFloatMode(true)`.
5. **Cut with a party** (11.4): the party stays; before a cut put every untouched whole to sleep; pieces = min(MAX_PIECES, characters cap -
   (wholes - 1)); one squishy in pieces at a time; if the pieces' units would still pass `unitCap`, the kind refusal ("It's busy here. Put one
   squishy back on the shelf to cut."); `onCut` / `onWhole` from the swipe and from both Cut bar buttons.
6. **The attention wiring** (11.5) around the pure `src/life/attention.ts`; prop sounds from `drainStrikes` (every cause); the budgeted soft land and
   bump sounds for **every `auto` event**; the touch duck while the player is touching (a finger, a grab or a carry, **never a lock alone**, D-84);
   B08's afterglow emote and voice as P1 requests; Calm caps; 0 haptics and 0 camera moves from autonomy.
7. **The play-event ring** (11.6, capacity 64, overflow counted) and **the quest host** (drained once a frame into `collection.feedPlay`); WISH
   GRANTED's `by` by QUESTS 4's rule (a nap, song, thing or warm-up wish counts as the player's only after a carry, toss or "Go play with..." of
   that squishy in the 10 s before); the quest-complete moment's haptic and `registerFx` **only when the completing record is by PLAYER** (D-84).
8. **Settings** (11.9, one change: `src/contracts.ts` Settings members + `SETTING_KEYS`, `OPTIONAL_UNITS`, `OPTIONAL_BOOLS`, `optionalDefaults`,
   `resolveSettings`, **`SETTINGS_VERSION` 3**; `settingsCtl.ts` applies them live; `settingsPanel.ts` rows "Voices", "Place sounds", "Squishies move
   on their own" with its help line "When off, they stay where you put them. They still look around and chirp, and play when you ask.", "Words
   under bubbles"; node_checks section 6 reads a v2 and a v3 blob, including with the old code).
9. **Home's view and things** (11.13, PLACES 4.1, SH-21; revision 4, D-87, D-88): Home keeps today's framing of the mat slots in use; each thing
   shows after its event (the ball and the Music Box at the start, the rug after the first hello, the lamp after the first capsule, the shelf with
   the Home finale, the Bounce Pad only once pads ship in S2) **and while the party is at least its spot's `fromN`** in the frame in use (PLACES
   4.1's table; parked, no collider, below it), with a scale-in (Calm or reduced motion: a fade). **The corral rectangle** (`setBounds` on every
   party body) = the smallest rectangle (round 0) holding `stage.visibleTable` and every slot's body plus 0.05 m; **LIFE's Home targets** come
   from `lifeSetHome` (the slots) and the arrived things' use spots, never a shrunk table; the Felt Ball's bounds = the visible table shrunk by its
   radius; all three recomputed when the party or the frame changes, never from autonomy. The spots assume the HUD insets of PLAYGROUND_BUILD
   11.13: report the insets the UI overhaul really gives (`setSafeInsets`) to PG_DATA, whose DT-01 Home row re-lays a spot that fails on them. Then the **tracker pill** (SH-20: the first unfinished main
   quest of this place's chapter that can be done now, K when the last input was a key, never a hidden quest, then Home's, then Friends
   Everywhere's); **the Journal** with Home's chapter on the UI overhaul's components (the lazy screens chunk), the family name on every page and
   tile, the button's name "Journal, something new" while its dot shows; the party toolbar and Space on the focused squishy; the dev hook's
   `life()` and `quests()` (dev only: the prod-build grep proves it).
10. Node checks SH-01 to SH-13 and **SH-20 to SH-22** with a **moving mock body** made inside each section (a local subclass of the mock with a
    writable centre and metrics; `_harness/mocks.ts` stays as it is) and the real `SoftBody` for the touch, hop and boop rows (the 7g pattern: SH-06
    boops two real bodies, 0 haptics, 0 shakes); FN-01 in node through the dev hook.
11. **SZ-01 at S0**: once the orchestrator has landed task T1 (the G0 split in `vite.config.ts`), do task T2 (the prod-build row reads the build's
    own `[G0]` line: first load at most 1300 KB, total at most 2000 KB) and measure the PLAYGROUND first-load delta and each lane's cap (one build:
    a heavy job). **Your first-load cap is 12 KB** (the ring, the `simStep` lines, the party manager, the buttons, the pill's shell, the settings
    rows, the keyboard); everything else of yours goes in the life chunk (the hosts, the attention wiring and, imported statically by the LIFE host,
    `wishes.ts`, `moments.ts`, `partybar.ts`, `nametag.ts`, `shutter.ts`: about 15 KB, D-92) or the screens chunk. Until the life chunk lands, the
    keyboard and the Snap bar work as today (one squishy, Save = capture + download). After every step report the minified bytes of each
    new or grown module (14.3's one-file rolldown build); a lane over its cap moves code out before the next step.

## Build: S1 "Hearthlog Cabin" (first shippable)
12. **Travel** (11.7, QUESTS 15): the Places button (hidden until a second place opens, one 400 ms scale-in, Calm or reduced motion: a fade; the
    live line "Hearthlog Cabin is open. Find it in Places."), the postcard grid (2 columns at 390 px, 1 at 320 px, 3 on a desktop; `shipped:
    false` places are not shown), "Who's coming?", `whenIdle`, `leaving()` (reconnect a cut, release locks), `loadPlaceDef`, `stage.loadPlace` and
    `audio.loadAmbience` prefetched on idle when the place opens, **the layout from the frame's aspect** (under 0.9: the tall layout, D-68), the 0.6 s
    crossfade, `buildPropWorld(place, layout, bodyScale)`, `setPropWorld`, `setBounds` (the layout's bounds), the modifiers, spawn at rest then
    `sleep()` except the first moverCap members (B09's arrival hop through the gate), `lifeSetPlace(w, placeIdx, visit, def, layout, bodyScale)`
    (a new visit number; the same one on a re-lay after a rotation), VISIT, `setAmbience`, `setMusicStyle`,
    `setPlayBounds` with the layout's bounds, `setObstacles`; "Packing up..." after 300 ms; a load failure keeps the player where they were
    ("Hearthlog Cabin did not load. Try again."); the arrival line "You are at Hearthlog Cabin.". **A rotation that crosses aspect 0.9** re-lays the
    place at the next idle moment by the same path under the crossfade (nothing is lost); until then the camera frames the current layout.
13. Ground patches to `mods` at 10 Hz (the patch under each body's centre, `patchThing` with it); warm and cold zones to the zone mask (`zoneThing`);
    **the kettle's whistle timer** (one bar, 3.6 s, every 45 to 90 s, seeded, never within 60 s of a Music Box tune) and its steam (`lifeAddLook`
    wet +0.2 within 1.2 m, source the kettle); **the Music Box** (8 bars, at most one start per 40 s, a second tap stops it; AU-14); the
    fireplace's fire switch; the strand look when a tacky body leaves a prop.
14. **Wishes** (`wishes.ts`: 44 x 44 DOM hit areas placed from `emoteScreen` every 250 ms, never over the body's silhouette, `tabindex="-1"`; the
    wish card in the plate slot naming the friend or place, `min(358px, 100vw - 32px)` wide, at most 120 px tall; "It can wait." when it rests);
    the **Wishes now** list; the word labels under the first three bubbles; the **moments queue** (QUESTS 15: "New stamp: ...", never within 1 s of
    a burst, never over a reveal, at most 3 queued, more become "3 new stamps"; the plate `min(320px, 100vw - 32px)`); **one polite live-region
    queue** (quest and wish lines first, at least 2 s apart; SH-16); keepsakes on the Home shelf; **the gift card and the gift path**
    (`claimGift`; "Three new friends for you." while the list's place has not shipped; a signed-in ledger sees "Your gift will wait here for
    now." with no Yes button).
15. **Keyboard** (11.8, D-77): **Tab stays the browser's** (it reaches the Journal, Places, mute and gear and can leave the party); **the party is
    one Tab stop**, a DOM toolbar of focus proxies (roving tabindex, each named like "Dollop, Jelly Gel"), with [ and ] inside it; the focused
    squishy's 3:1 ring and name tag; Space on the focused squishy; the keyboard stretch (hold Space, an arrow pulls through the real driver, paid
    like a pull); **Enter** opens its wish card, else the name tag popover, and reads a showing bubble into the live region (counts as EMOTE_TAP,
    H6); the popover's "Go play with..." (floor things: PLAY_WITH, which works with autonomy off; rides: `carryTo`, never paid) and **"Tap it
    yourself"** (revision 4, D-93: every switch, every ball and every thing a tap swings: the Shake Pine, the chimes, bells, crystals and
    lanterns, a seesaw end, a swing seat; a thing of several parts taps its next part in prop order at each press; by the same path and impulse
    as a pointer tap, by PLAYER: "Tap the fireplace", "Roll the Felt Ball", "Shake the pine"); the Escape order
    (tray, Settings, Journal, Places, Hoard, tool, plate, then locks), focus back to the opener. SH-14 walks C8 end to end by keyboard.
16. **The Snap shutter** (11.15; `src/ui/shutter.ts`, in the life chunk: until it lands the Snap bar's Save works as today): a shutter button that captures one clean frame, shows an in-page preview from a downscaled data URL and pushes PHOTO
    into the ring at that moment; Save (the download) is optional in the preview; "Bubbles in photo" (`setEmotesInPhoto`) and "Pose!"; Snap hides
    the DOM overlays; the Friendship Frame's thumbnail (at most 12 KB, `wobblehoard:v2:journal.frame`) at the X8 photo (SH-18: X8 with no download).
17. **Landscape** (QUESTS 15, SH-15): at 844 x 390 and 568 x 320 the plate and the wish card sit in the left half under the pill.
18. Browser rows SH-14 to SH-19 and UI-01 to UI-04; **PF-01 to PF-04** (the Hearthlog med cap scenario with a 4x CPU throttle; low; the cut scenario
    3 wholes + 5 pieces with the others asleep; a 10-minute soak) against the caps PF-00 set; **PF-06** (revision 4: the ride case, two riders
    teetering and one rider pushed by a LIFE pusher, on low and med; physics at most 8.0 ms and the frame at most 16.7 ms); FN-03's scripted Home and Hearthlog visits, in both
    layouts.

## Build: S2 and S3
S2: water flags (`submerged` into IN_WATER, the soaked density into `mods[4]`), **the squirt game** (S14: the player's squeeze of a soaked foam;
the target is the nearest character within 1.2 m and within 60 degrees of the foam's gaze, else the nearest within 1.2 m, and a keyboard squeeze
uses the same rule: the spray, `lifeAddLook` wet +0.3 and soak -0.4, `lifeScript` SQUIRTED, SOCIAL SQUIRT in the ring), ice and wet patches,
`stampMark` on landings and every 0.25 m of travel, the Bounce Pad's arrival at Home, the three places (both layouts). S3: the switch things (a
motor, a tune, the echo, the comet), wind gusts in the zone mask only while a gust blows, the five places.

## Acceptance ids you must make pass
SH-01 to SH-22, UI-01 to UI-04, PF-01 to PF-04 and PF-06, SZ-01 to SZ-04 (with T1 and T2), FN-01 (SH-19), FN-03 (scripted visits through the dev hook); SH-05
is the node twin of EC-03; SH-11 is the Float rule (was PH-21); the existing gates stay green (`shellview/node_checks` 124/124 and up, `probe_app`
183/183, `probe_gestures` 128/128, `probe_cut`, and the SHELL-4 browser sections). One browser at a time.

## Budgets
Shell 0.6 ms and UI 1.0 ms of a 16.7 ms med frame; 0 B per 600 frames with no physics event (SH-01, SH-04); your first-load share at most 12 KB, the
hosts and the attention wiring in the life chunk (about 16 KB of its 150) with the five play-time UI modules (about 15 KB), the Journal and Travel UI in the lazy screens chunk (at most 45 KB with
`journal_text.ts`); 44 px targets; every grid takes its columns from the width (320 x 568); every new colour pair in `CONTRAST_PAIRS`; every new HUD
element in `_harness/uikit/` in every state (UI.md 5).

## Never
Idle income (autonomy must never reach `collection.feed`); a camera move or a haptic from autonomy; an `auto` event in `feedback.handle`; LIFE's
SCOOT on `moveTo`; a `musicClock` reading in the snapshot; the LIFE host on `onStep`; a quest that parses notice text; a squishy put away or a cut
as the cause of a huff; a countdown, a streak or a number badge on the Journal button; Tab captured by the party.
