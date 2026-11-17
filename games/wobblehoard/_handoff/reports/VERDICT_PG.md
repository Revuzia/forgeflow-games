# VERDICT_PG: independent verification of PLAYGROUND on the working tree (2026-11-17, second attempt)

Verifier: independent; wrote no file in `src` or `_harness`, ran no git write command. This replaces the cut-off first attempt (its tree had 11
uncommitted files that are now committed in cae532c34; `src` is byte-identical to what it tested). Running report: Status line below.

- Tree under test: the working tree at HEAD **cae532c34** (clean: `git status` empty; `diff -rq src` against HEAD empty), copied with `git archive
  HEAD games/wobblehoard` into scratch `pg_verify_r2/snap` and built there (`vite build` 0.58 s: [G0] 2399 KB of 3072, [G0b] 461 KB gzip of 600).
- Published reference: `_live_snapshot/2026-11-16` (every file OK against its `SHA256SUMS`), served statically; `origin/squish-keeper-pc`
  (9211d66ba, `git archive` into `pg_verify_r2/pc`) for the node probes.
- Scratch (all scripts, logs, screenshots): `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify_r2/`
  (`scripts/`, `logs/`, `shots/`, `probes_new/`, `probes_pc/`). Below, `S/` means that folder. Ports: 5374 new build (static), 5375 live build
  (static), 5376 vite dev of the snapshot (the dev hook `?dev=1`).
- Machine: SwiftShader WebGL, about 1 to 7 fps at 1280x800. Real-input runs use the exact CSS viewports with deviceScaleFactor 0.5 on desktop and
  1 on the phone and hold 2.4x longer; LIFE and the swing are stepped deterministically through `__WH__.step`.

Status: FINAL (all four parts run; 17:40 UTC). Nothing of mine is left running (`ps` for headless_shell, vite, _harness, serve.mjs: empty).

## Verdict

| Part | Verdict | One line |
|---|---|---|
| A. No regression against the published game | **PASS** | every published step behaves the same on both builds at 1280x800 and 390x844; saves cross both ways with nothing lost; 0 console errors, 0 failed requests |
| B. PLAYGROUND as the owner asked | **FAIL** | one BLOCKER (a sleeping squishy is split in two after a trip) and four MAJOR (the cut shelves the party; the wish card, tracker and party controls are not built; "coming later" lists 8 unshipped places; the Felt Ball covers the squishy on a phone) |
| C. Performance and download | **PASS** | Home with 1 out: frame interval unchanged, script +0.4 to +1.2 ms per frame; first play +55.7 KB raw / +19.7 KB gz; life, journal and place code load only after Wake |
| D. Node probes | **FAIL** | 40 probes run; 8 have failing rows: 5 fail identically on the published PC tree (same rows, same numbers, not regressions); 3 exist only in this tree and fail 4 rows (LF-02, DT-01, DT-11, FM) |

## A. No regression (PASS)

Same script, same seed, same timings on both builds (`S/scripts/arun.mjs`; seed = a save made by the live build plus a second Dollop for the merge,
`S/logs/seed_live_2dollops.json`): title, Wake, poke, first squeeze (toast "Hello, Squishy" and the live line "Bronze trophy: Hello, Squishy."), first
stretch, 8 to 9 holds earn a capsule, open it ("New! <name>"), the Hoard (Shelf, Gift with the same three daily choices, Today), merge with the
"This uses your last Dollop. Merge anyway?" modal, Cut (2 pieces, "Clean Cut"), Reconnect all ("Whole again."), Snap with a real PNG download
("Photo saved."), lock by Shift at full stretch ("Locked in place.", Escape "Let go. Silver trophy: As Far As It Goes."), Float / Table, Settings
(Music 45 -> 42 and Calm on are saved), Trophies (8/20 and the same screen), keyboard (Space tap and hold squeeze, 1/2/3, G, M, H, ?, P, Escape,
Tab walk). Every step returned ok on both builds and both sizes; logs `S/logs/A_{live,new}_{desk,phone}.json`, screenshots
`S/shots/A_{live,new}_{desk,phone}_*.png` (looked at: toast_0400, toast_1500, cut_pieces, reconnect, cut_done, trophies_screen, settings_open).
Differences, all expected: the new build adds the Journal button (and Places once open), an emote bubble, the Felt Ball, three settings rows (Voices,
Place sounds, "Squishies move on their own") and writes settings `v: 3` and `wobblehoard:v2:journal`. Capsule and merge results differ between runs of
the SAME build too (live gave Sproutle, Glugbean and Thudge in three runs), so they are random, not a regression.
- A phone run of the new build announced no "Whole again." once; a targeted re-test (`S/scripts/crun.mjs`, cut and reconnect twice, both builds,
  390x844 touch) gave the identical line sequence on both builds ("Cut into 2 pieces." ... "Whole again." ... "Bronze trophy: Whole Again."). Not a
  regression.
- "Five soft pops in a row" ended 3/5 and 2/5 on the new build against 5/5 on live with the same script. The streak needs squeezes of 1.8 s of SIM
  time; on SwiftShader each frame is clamped to 1/20 s, so a slower frame shortens the simulated hold of the same wall-clock press. A frame-rate
  effect of this machine, not a rule change (`collection/ghost.ts` 76-79 unchanged), but it shows the new build's frames are slightly slower here.
- Save compatibility (`S/scripts/savetest.mjs`, logs `S/logs/S_A*.json`): live save on live (A0) and on new (A1) show the same play body, "Hoard, 2 of
  50", shelf, Trophies 8/20 and all settings; new build changes Voices and autonomy (A2, settings `v: 3`, `autonomy: false`); that save on live (A3,
  the rollback) and back on new (A4) loses nothing (8 trophies, same ghosts, `autonomy: false` kept, profile `{v, instance, stats}` intact, ach
  counters only grew by the test's own squeezes). Hoard JSON diffs between A0 and A1 are only the meter fields the test's own squeeze changed.
- Pressing where the new Felt Ball overlaps the squishy on a phone still squeezes the squishy on both builds (`S/scripts/balltest2.mjs`: overlap
  1 squeeze each), so input is not regressed (the look is, see B M4).
- 0 console errors, 0 page errors, 0 failed requests, 0 HTTP errors in every A, C and K run on both builds.

## B. PLAYGROUND (FAIL)

What works, seen in the running game (dev hook `S/scripts/b3run.mjs`, `S/scripts/b4run.mjs`, desktop 1280x800 and phone 390x844, logs `S/logs/B_b3_desk.json`,
`S/logs/B4_b4_{desk,phone}.json`):
- **Several out at once, social:** 3 and 5 out at Home through the Hoard's "Bring out" (with the mat's SwiftShader frame guard lifted by the dev
  hook). With 3 out, 40 s: 9 emotes, 18 voices, 14 scoots, 25 hops, 49 poses, up to 3 bubbles at once, bubbles "Hello!", "I like you", "Sleepy...", "A
  wish: I want to go somewhere"; with 5 out, 30 s: 14 emotes, 19 voices, up to 4 bubbles, social moments in 47 of 75 behaviour samples. 0 haptics and 0
  poke/release/pop sounds from autonomy (spy deltas over the no-input windows). Screenshots `S/shots/B_b3_desk_home3_t20.png`, `B4_b4_desk_home3.png`
  (three voice bubbles at once), `B_b3_desk_home5.png`.
- **The cabin:** Travel by the real Places sheet (loop running, real click): 13.6 to 14.7 s from the click to "You are at Hearthlog Cabin. New stamp: A
  wish comes true New stamp: Come in from the snow", both layouts (wide on desktop, tall on the phone), back home by the sheet with the party (3 out).
  In 90 s with 3 out and no input: Dollop on the Snug Basket (prop 4) and USE 7 of 30 samples, Puddlo uses the basket on the phone, naps, social
  moments 15 to 20 of 30 samples per squishy, "Hmph!", "Let's play!", "I like you" bubbles, 0 haptics. Screenshots `B4_b4_desk_cabin_t18.png`,
  `B4_b4_phone_cabin_arrive.png`, `B4_b4_phone_cabin_t54.png`.
- **The swing (D-95 revised)** (seat pose read from the stage's bound prop poses, 10 samples per sim second, `S/logs/B4_b4_desk.json` step swing):
  natural: a hand drag on the seat pushed it to 28 deg, then it swings freely and dies down with AUTO off (peaks 25.8, 22.2, 19.2, 16.6, 14.3,
  12.3, 10.6, 9.1, 7.9, 6.9, 5.9, 4.7 over 14 s); **AUTO** (the chip, `aria-pressed` true, live line "The Pillow Swing moves by itself.") keeps a
  steady +-10.0 deg arc for 20 s with nobody on it; **by hand** with AUTO on, a finger on the seat holds it at -9.1 deg for 2.5 s (the hand wins),
  released it eases back to +-10 deg; AUTO off: 9.3 deg decays to 1.4 deg in 16 s ("The Pillow Swing slows down by itself."). Same on the phone's
  tall layout (+-10.0 AUTO arc, hand holds at 4.0 deg, off decays 9.3 -> 1.4). The Rocker Board: AUTO +-5.0 deg, off settles. AUTO is off by
  default and only the player's chip turns it on. Keyboard: both chips are Tab stops in the cabin, Space and Enter toggle with the live line
  (`S/logs/K_desk.json`).
- **The Journal:** opens from its dock button (mouse and keyboard), Stamps / Squishies / Friends / Keepsakes tabs, "Wishes now: Dollop still wishes to
  visit Hearthlog Cabin. It can wait.", chapters with plain kind lines ("Pull it out, then let go."), Escape closes it and focus returns to the Journal
  button, Tab stays inside the open dialog and is never trapped on the play screen. Quests complete from real play: H1, H2, H4 to H8, C1, C7, C10 in
  these runs. `B_b3_desk_journal.png`.
- **Pieces join in calmly:** a cut of the play squishy into 3 pieces gives 3 LIFE characters (one group: `kind` 1 and 2), at most 1 bubble at a time
  over 24 s, 7 voices, 0 haptics from autonomy (`cut_party` step).
- Copy: no "sad, lonely, grumpy, hurt, misses you, come back, hurry", no "Pals" or "Nook" in any player string (grep over `src/data/journal_text.ts`,
  `src/ui/later-journal.ts`, `src/ui/wishes.ts`, `src/shell/later-life.ts`, `src/life/*.ts`, `src/shell/hudBinding.ts`; the only hit is a code comment).

### Findings for B
**BLOCKER B1. After a trip, a squishy that was asleep at Home is drawn in two places: its jelly stays at its old Home spot, its eyes and glow
float at its real spawn spot.** Repro (`S/scripts/ghost.mjs`, dev hook, 1280x800): Wake, grant 3 capsules, bring two out (3 on the mat), step until
all three sleep (Wisplet asleep at x -1.63), `__WH__.travel('hearthlog', true)`, step 1 s and 5 s: the life host and the mat put Wisplet at its spawn
(2.15, 0.55; on screen 979, 425) and keep it asleep, but the white Wisplet jelly is drawn on the Snug Basket at the left (its Home x) while only a
glowing orb with closed eyes hangs at 979, 425 (`S/shots/G_home_before.png`, `S/shots/G_cabin_5s.png`). The first desktop B4 run shows the same with
Petalop through the real Places sheet: its blue jelly at the basket, its pink aura and eyes at the right (`S/shots/B4_b4_desk_cabin_arrive.png`, 6 s
after arrival; fixed by `B4_b4_desk_cabin_t18.png` once it woke). 2 of 3 trips with a member asleep at Home showed it. A press on the visible
jelly finds no body; a press on the floating eyes pokes the hidden one. Likely cause: `later-life.ts` 1383-1390 `place()` moves a body with
`placeAt` and 1373-1379 sleeps every member past `moverCap`; a body already asleep is not re-uploaded by the stage until it wakes. Travel with a party
is the headline of this slice, so this blocks release.

**MAJOR B2. Cutting with a party sends the whole party back to the shelf.** Repro (`S/scripts/b3run.mjs` steps party5 then cut_party): 5 out at Home,
Cut tool, a swipe across the play squishy: live line "The other 4 went back on the shelf. Cut into 2 pieces."; after "Reconnect all" only the play
squishy is out (`chars: 1`). `src/shell/cut.ts` 770-773 and 813-816 still call `d.clearMat()` on the first cut and say `matCleared` (cutText.ts 80),
the PC behaviour. PLAYGROUND_BUILD 1 ask 4 ("the party stays when cutting"), T4 (CUT.md: "the mat is no longer emptied") and SH-03 require the party
to stay; the pieces only "join in" a party of one. Screens: `S/shots/B_b3_desk_home5.png` (before), `S/shots/B_b3_desk_cut_party_after.png`
(after). The shell's report does not list this.

**MAJOR B3. The play-time UI that makes the wishes and quests visible is not built** (PG_SHELL.md R4b "NOT built", confirmed in the build): no wish card
(tapping "A wish: I want to go somewhere" speaks "Dollop wishes for a warm place: Hearthlog Cabin." only to the screen-reader live region; a sighted
child sees two "New stamp" toasts and a new map button, `S/shots/B4_b4_phone_wish_card_try1.png`), no quest tracker pill ("Next: ..."), no name-tag
popover ("Go play with...", "Tap it yourself"), no party toolbar (a keyboard player cannot address the 2nd to 5th squishy except by the published
"Play with" swap), no "Who's coming?" on the Places sheet, no Snap shutter / preview. The Journal exists and lists the quests, but play itself gives
no visible direction (owner ask 5).

**MAJOR B4. The Places sheet lists the 8 unshipped places as "coming later"** (`S/shots/B4_b4_desk_travel_sheet.png`: "Ripple Shore: coming later" ...
"Cloudloft: coming later"). QUESTS 15: "a place with `shipped: false` is not shown at all (no 'coming soon' card)"; QUESTS 7 / PG_VERIFY 7.6: no line
names a place that has not shipped. `src/ui/later-journal.ts` 237.

**MAJOR B5. On a phone the Felt Ball parks dead centre in front of the play squishy**, covering about a quarter of its front and the squeeze dent
under the finger (`S/shots/A_new_phone_toast_0400.png`, `A_new_phone_reconnect.png`, `BALL2_new_overlap_hold.png`; live: `A_live_phone_toast_0400.png`,
`BALL2_live_overlap_hold.png`). Every phone player sees it on Home; with 3 out it sits in front of Dollop again (`B4_b4_phone_home3_try1.png`). The
first-play ball use on the phone moves it only 0.10 m (FN-01 asks 0.2 m; PLAYGROUND_BUILD 18 FN-01's revision-4 caveat predicted this).

**MINOR B6. FN-01's first labelled bubble:** on desktop no bubble showed in the 18 s after the first 6 s release in 2 of 2 fresh profiles (samples every
1 s, `B4_b4_desk.json` first_play; the ball use did come at 6 to 9 s and moved the ball 0.23 m); on the phone 1 of 2 profiles showed "What's that?" at
7 s. On desktop the rolled ball ends hidden behind Dollop (`S/shots/B4_b4_desk_home_firstplay.png`).

**MINOR B7. With 5 out the awake budget is exceeded for long stretches** (PLAUSIBLE: quality high, no touch, samples every 2 s: units 4.03, 4.28,
4.03, then 3.06 for 12 s, against `unitCap` 2.494; `S/logs/B_b3_desk.json` samples t=p5). SH-22 / D-61 say the shell sleeps untouched wholes over the
cap.

**MINOR B8. Layout and overlap on the play screen:**
- the "New stamp" toasts lie over open sheets and the top-right column: over the Trophies title on the phone (`S/shots/A_new_phone_trophies_screen.png`),
  over the Journal and Places buttons on arrival (`S/shots/B4_b4_phone_cabin_arrive0.png`); the "Squishies are resting, filling slowly" toast covers
  the "Put back 4" chip on desktop (`S/shots/B_b3_desk_home5.png`);
- the AUTO chips jump to the top edge whenever a toast shows (y 90 -> 15 on both sizes; `src/ui/thingAuto.ts` CHROME includes `.toast`), a moving
  target;
- Home with 5 on desktop is one long row: the left squishy is about 80 percent hidden behind the red one and the lamp, ball and Music Box are hidden
  behind bodies (`B_b3_desk_home5.png`); on the phone a party of 3 is small in the top half and the bottom 40 percent of the floor is empty
  (`B4_b4_phone_home3_try1.png`);
- the cabin's tall layout: the Rocker Board lies under the hint pill and the quick-switch row, the kettle is cut by the left edge
  (`B4_b4_phone_cabin_t54.png`; declared in PG_SHELL.md R4b);
- in a party the bottom-left quick-switch row shows squishies that are NOT out (the published "Play with" swap) while the party itself has no chips:
  on a phone with Dollop, Dollop and Tadpolo out the row showed three others (`B4_b4_phone_home3_try1.png`).

**MINOR B9. The natural swing, empty, dies down in about 5 to 6 swings, not "about 2 to 3"** (owner, D-95 revised): from a 28 deg push the
peaks are 25.8, 22.2, 19.2, 16.6, 14.3, 12.3 after 3 full swings, under 5 deg only after about 12 s. The seat's data damping is unchanged since round 3
(0.25 /s in every commit since 56ae52c74), and PG_PHYS measured 2 to 3 half swings WITH a rider; I did not measure a ridden natural swing.

**MINOR B10. Places postcards are blank gradient tiles** with no "N of 25 stamps" or "3 of yours love it" line (QUESTS 15), and "Journal (J)" /
the J key do nothing (the J key was pressed on the play screen: no Journal).

## C. Performance and download (PASS)

- Home with 1 out, prod builds, same seed (`S/scripts/perf.mjs`, DPR 0.5, 12 s windows, 2 runs per build; logs `S/logs/C_{live,new}{1,2}.json`):
  steady-state script time per frame live 5.91 / 6.53 ms, new 7.07 / 7.07 ms (+0.5 to +1.2 ms); first window (life chunk warming, first-play LIFE)
  live 6.62 / 6.93, new 8.53 / 9.82; frame interval (GPU-bound here) live 151.1 / 151.2 ms, new 151.7 / 161.3 ms. With a 4x CPU throttle at DPR 0.25
  (`S/scripts/perfT.mjs`, 3 windows x 2 runs): script per frame live 21.7, 21.0, 20.8, 20.6 (mean 21.0) against new 22.2, 21.9, 24.2, 22.0 (mean 22.6,
  +7 percent); frame interval live 91.3 to 93.5 ms, new 89.2 to 101.0 ms (same within noise). Not a meaningful frame-cost change; LIFE and the host
  cost about 1.5 ms of a throttled frame, inside the 2.0 ms the spec gives LIFE, the shell and the UI.
- 3 and 5 out: on the prod builds the mat's 30 ms frame guard refuses a third squishy on SwiftShader on BOTH builds (2 out at most), so the published
  comparison stops at 2 out (live 6.0 to 6.7 ms script per frame, new 5.3 to 8.0). The new build alone on the dev server (`S/scripts/perfdev.mjs`,
  unminified, quality high, guard lifted): 3 out 14.7 to 15.2 ms script per frame and 1.0 to 2.5 ms physics; 5 out 19.9 ms and 3.0 ms physics (2
  asleep); the cabin with 5 (4 asleep) 15.8 ms and 0.82 ms physics (`S/logs/P_dev.out`). The cabin on prod with 2 out: 7.1 ms script per frame
  (`C_new1`). In real time, rocker or swing AUTO on costs the same as off (`S/logs/R_desk.json`: 528 / 516 / 539 ms frames, GPU-bound).
- First-play download (everything a new player fetches before Wake: html, the entry, css and every non-lazy chunk; `S/scripts/sizes.py`-style sums in
  this report's command log): new 1476.0 KB raw / 452.3 KB gz, live 1420.3 KB / 432.6 KB: +55.7 KB raw (+3.9 percent), +19.7 KB gz. The life set
  (`life_voices`, `later-life`, `later-shared` x2, `later-lifelook`, `later-journal-text`, `later-place-home-data`: 280.4 KB raw / 100.9 KB gz) is
  requested only after Wake (request log of `C_new1`: before Wake 845 KB of chunks, Wake to play+8 s the life set; live fetches nothing after Wake).
- Module check with a sourcemap build (`S/logs/chunkmods.txt`): no `life/*`, `collection/journal*`, `core/quests`, `data/places`, `data/life`,
  `data/quests`, `data/place_*`, `ui/later-journal` or `render/places/*` module is in `index`, `stage`, `engine`, `ui`, `catalog`, `dsp`,
  `three.core`, `rarity` or `rng`. SZ-02 total js+css 1928.2 KB raw (cap 2000): pass.
- Other gate: **MAJOR C1 (known, declared). The life chunk `later-life` is 203.45 KB raw (198.7 KB in the sourcemap build's count) against SZ-02's
  150 KB** cap; PG_SHELL.md R4.2 says D-92's overflow moves were not done. SZ-01's absolute 1300 KB is missed by both builds (live 1420, new 1476);
  the PLAYGROUND delta (+55.7 KB) is inside its 70 KB.

## D. Node probes (FAIL)

Every `_harness/probe_*.ts` (38, with `run_probes.ts`'s own arguments: `probe_truecut` and `probe_many` with `--quick`), `shellview/node_checks.ts`
and `renderview/pg_node_checks.ts`, one at a time on the snapshot (`S/scripts/runprobes.sh`, logs `S/probes_new/<name>.log`, exit codes and seconds
in `S/probes_new/summary.txt`). The failing ones were then run on the published PC tree (`S/probes_pc/`). `tsc` was not re-run by me (the build
compiles; the lanes report it clean).

Passing: probe_app 187/187, probe_boot 30/30, probe_catalog all, probe_chatter 42/42, probe_collection_imports 10/10, probe_cut 17/17, probe_economy
all, probe_families 22/22, probe_flush 11/11 (quick set), probe_genome (exit 0), probe_gestures 160/160, probe_journal all, probe_life_imports all,
probe_lock_shell 96/96, probe_lockfx 15/15, probe_many 43/43 (--quick), probe_materials all, probe_merge 22/22, probe_neck 8/8, probe_optbar 42/42,
probe_overlays 21/21, probe_parts 11/11, probe_pg_economy all run (2 rows NOT RUN: "other lanes' code not there yet"), probe_playground 54/54 (quick
set), probe_portal 82/82, probe_quests all run (3 rows NOT RUN, same reason), probe_screens 43/43, probe_tips (exit 0), probe_trophies 31/31,
probe_uikit 62/62, shellview/node_checks 165/165, renderview/pg_node_checks 40 ok / 0 FAIL.

| Probe | Failing row(s) on this tree | On the published PC tree (9211d66ba) |
|---|---|---|
| probe_collection 73/74 | C08 previewTouch allocates 160 000 B / 20 000 calls | **same row fails** (73/74) |
| probe_lock 81/87 (3 known open) | LOCK orders crimpo (fold 175 deg > 120); LOCK slots cushlet; LOCK perf (6 locks 1.33 ms > 2 bodies 0.88 ms) | **same 3 rows fail**, same values (fold 175; perf 1.26 vs 0.81 ms) |
| probe_softbody 115/116 (full run) | G1p warmUp covers a lone finger: 2976 B / 2976 B | **same row fails**, 2976 / 2976 B |
| probe_species 25/31 | press matrix left at rest 110 deg; FULL PULL putty; RUBS waterfill, putty, slimegoo, beadsqueeze | **same 6 rows fail**, identical measured values |
| probe_truecut 104/113 (--quick) | G2, G3 x2, G4 x4, G7 nested, L2 rest pose | **same 9 rows fail** |
| probe_life 117/118 | LF-02 lifeStep allocates (88 760 to 157 968 B per 1000-tick window, bar 0) | probe not on the PC tree (LIFE is new); PG_LIFE reports it as its own open row |
| probe_pg_data | DT-01 "stage.ts camera changed (fov 35, pitch 0.27, TARGET_Y 0.42 ...)": Home's spot geometry was validated against an older camera and is not re-proved; DT-11 a new salt `0x2c1b3c6d` in `src/audio/music.ts` 826 not in the row's list | probe not on the PC tree |
| probe_pg_lifequests 12/13 | FM friendMaskOf allocates 32 B over 10 000 calls (bar 0) | probe not on the PC tree |

**MINOR D1.** The four new-tree-only failures: LF-02 and FM are allocation bars (garbage, no visible effect measured here); DT-01's guard means the
Home geometry proof (things in view from their `fromN`) no longer matches the camera that ships, which is consistent with B5 (the ball in front of
the squishy on a phone); DT-11 is a stale list. None of the five shared failures is a regression.

## Every finding by severity

| Id | Severity | Part | One line | Screens |
|---|---|---|---|---|
| B1 | **BLOCKER** | B | after a trip a squishy asleep at Home is drawn in two places (jelly at the old Home spot, eyes and glow at its cabin spot); repro `S/scripts/ghost.mjs` | `G_home_before.png`, `G_cabin_5s.png`, `B4_b4_desk_cabin_arrive.png` |
| B2 | MAJOR | B | a cut with a party sends the party to the shelf ("The other 4 went back on the shelf."); `cut.ts` 770-773, 813-816 | `B_b3_desk_home5.png`, `B_b3_desk_cut_party_after.png` |
| B3 | MAJOR | B | no wish card, tracker pill, name-tag popover, party toolbar, "Who's coming?" or Snap shutter: a tapped wish speaks only to the screen reader | `B4_b4_phone_wish_card_try1.png` |
| B4 | MAJOR | B | Places lists 8 unshipped places "coming later" (QUESTS 15 forbids it) | `B4_b4_desk_travel_sheet.png`, `J_phone_places.png` |
| B5 | MAJOR | B | on a phone the Felt Ball parks in front of the squishy and covers its front and the squeeze dent; its first-play roll is 0.10 m | `A_new_phone_toast_0400.png`, `BALL2_new_overlap_hold.png` |
| C1 | MAJOR (known) | gates | the life chunk is 203.45 KB raw against SZ-02's 150 KB | (build log `S/logs/build.log`) |
| B6 | MINOR | B | FN-01: no labelled bubble within 10 s of the first 6 s release on desktop (2 of 2), the rolled ball ends hidden behind Dollop | `B4_b4_desk_home_firstplay.png` |
| B7 | MINOR (plausible) | B | 5 out: units 3.06 to 4.28 against unitCap 2.494 for 20 s with no touch | (log `B_b3_desk.json`) |
| B8 | MINOR | B | toasts over sheets and the top-right column; AUTO chips jump to the top when a toast shows; crowded 5-row Home; small party on a phone; cabin rocker under the hint; the quick-switch row shows squishies not out | `A_new_phone_trophies_screen.png`, `B_b3_desk_home5.png`, `B4_b4_phone_home3_try1.png`, `B4_b4_phone_cabin_t54.png` |
| B9 | MINOR | B | the empty natural swing takes about 5 to 6 swings to settle, not "about 2 to 3" | (log `B4_b4_desk.json` swing) |
| B10 | MINOR | B | blank postcard art without stamp lines; no J shortcut | `J_phone_places.png` |
| D1 | MINOR | D | LF-02, FM allocations; DT-01 camera guard; DT-11 stale salt list | (logs `S/probes_new/`) |

A failed life chunk (both lazy files aborted, `S/scripts/failchunk.mjs`): Wake, a squeeze (counted) and the Hoard all work as published, the Journal
and Places buttons stay hidden, 0 page errors (the console logs the aborted fetches only). Good.

## What I did not check
- Audio of any kind (no listening here; no offline render of voices, the kettle or the cabin bed), AU rows.
- Landscape phones (844x390, 568x320) and 320x568; screen-reader names beyond the keyboard walk; Calm and reduced-motion variants of the new motion.
- FN-02 (four families by the fire), FN-03 (5-minute scripted visits), FN-06 (a 10-minute cabin visit on med with 4 wholes), the 60-minute
  no-input economy run (EC-02); my no-input windows were 30 to 90 s.
- PF-01 to PF-04 and PF-06 with a 4x throttle in the cabin, and a ridden swing or rocker (riders set by the player); a natural swing WITH a rider.
- Autonomy off in the browser; Float and lock with a party; Snap with a party; a cut on a phone with a party.
- The S2 places (not shipped) and every place other than Home and Hearthlog Cabin.
- `tsc --noEmit` (not re-run by me).
- The implementer reports were read only after my own runs (PG_SHELL.md to find its untested gaps: it lists none of B1, B2, B4 or B5).
