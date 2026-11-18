# R8_SHELL: round 8, the SHELL lane (src/shell, src/ui, src/input, src/render, src/collection but journal*.ts, vite.config.ts, the shell + render harness; ports 5364, 5366). No git write command is run (only `git apply` of the named patch, as the brief allows).

Brief: the orchestrator's round-8 task (owner: "fix all the missing items then deploy"; SESSION3.md machine rules; D-95 revised and D-96; R7_LIFE / R7_SHELL work lists).
No earlier R8_SHELL report existed: this is the first round-8 shell engineer. Started 2026-11-18 at HEAD 5578962b7 (working tree clean; live = 23c684a60).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r8_shell/` (`S/` below).

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 0 | apply `R7_SHELL_open_s3.patch` (all seven places open); re-spec probe rows that say only some places ship | DONE (section 0): patch applied; node_checks S2 dev-path row re-specified; LIFE rows listed (Requests) |
| 1 | the S2 + S3 place sections with the fixed harness; fix every product fault | DONE (section 1b): run 87/94 on `S/tree4`; product fixes: leaf tap, carry over the ground, column gaps + PLACE_COL_PX, set-down not a toss; harness fixes: sideways lift, gust sampling; LIFE rows listed |
| 2 | Cloudloft: pale squishies on near-white cloud tops (A/B) | DONE (section 2): measured A/B/C/D on both frames; no variant beats A beyond noise (B is worse): A kept |
| 3 | phone leftovers: play slot / column over the tall cabin; drag up the tall frame; perchDown on bars | DONE: 3a, 3c (node rows ok); 3b measured in the browser (section 3b'): kettle and hearth clear on 390 x 844 |
| 4 | Who's coming? chips, the photo frame, Journal gifts in the trophies | DONE: node 9/9 + browser `r8-features` 8/8 (desktop and phone); the browser check found and I fixed a Keepsakes page crash |
| 5 | LIFE requests: (11) Cloudloft tall camera; (7) Home Music Box | (11) DONE (section 5, LIFE adopted it in their model); (7) answered, not built (owner's call) |
| 6 | ONE final run on the final tree (`S/tree_final`, 17:41) | RUNNING: job A (published + pg-* + r8-features), then B (every place section), then C (extras) |

## 0. The S3 patch, the re-specs, the baseline (tree `S/tree1` = the working tree after the patch: HEAD 5578962b7 + the flip + my re-spec)
- `git apply --check games/wobblehoard/_handoff/reports/R7_SHELL_open_s3.patch` ok, then applied from `/home/user/forgeflow-games`: `places.ts` PLACE_INFO Lanternroof
  and Cloudloft `shipped: true`, both PlaceDefs `shipped: true`. All seven places ship in the working tree. tsc 0 errors.
- **Re-specified (my lane)**: shellview/node_checks "PLAYGROUND S2 by the dev path (not shipped: the sheet's path refuses each)" asserted `shut === false`; with the
  places shipped the sheet's path takes a place exactly when it ships AND its stamps opened it (later-life.ts `travel`), and how many stamps the party has by then
  is LIFE's trajectory (R7_LIFE section 5's request). Now: the sheet path's answer equals "shipped and open" (PLACE_INFO + the host's `openPlaces()` read just
  before), the dev path loads each, the rest unchanged; the reason is written at the row. It passes. The browser rows (pg-playthrough's sheet row, pg-places'
  and pg-places-s3's sheet rows) were already "every shipped place" since round 7: nothing else in my lane says only some places ship.
- **The LIFE lane's rows that fail with all seven shipped** (run on `S/tree1`, light probes one after another, `S/p0_life/`): probe_quests **QU-14 x2**: "this build
  (shipped: home hearthlog ripple frostbell rainleaf lanternroof cloudloft) shows exactly the shipped places' chapters and Friends Everywhere's quests" (the row's
  table knows no all-seven set: it lists H, C, R, I, G, L, U 1..10 and X1..X10 shown) and "the tracker never shows a hidden quest ... and hidden (none) does not
  complete from its own events" ("7 quests offered: X1 X2 X3 X4 X6 X5 X7": with every place shipped no quest of a shipped place is hidden, so the row's "first hidden
  quest with a script" is none). Request LIFE (1) below. probe_pg_data's two FAILs are the known ones (Home B5, Cloudloft tall), not the flip; probe_journal,
  probe_pg_lifequests 16/16, probe_chatter 42/42, probe_app 188/188, probe_trophies 31/31, probe_merge 22/22 pass.
- **Baseline of my lane's probes on `S/tree1`** (`S/p1_base/`, one after another): shellview/node_checks **179/180** (the one FAIL: SH-22 B7 "the budget's wake gate
  ... over the cap in at most 10 % of 6-a-second samples": 17 of 144 = 11.8 %, R7_SHELL 6b's integrated-tree number; the re-specified S2 row passes), probe_gestures
  160/160, probe_playground (quick) 73/73, probe_pg_lifequests 16/16, renderview/pg_node_checks 40 ok / 0, probe_screens 43/43, probe_overlays 21/21, probe_uikit
  62/62, probe_life 124 ok / 1 (LF-02, known).
- **G0b baseline** (a `vite build` of `S/tree1`, `S/build_tree1.log`; exact bytes by `S/g0b.mjs`, the config's own rule): G0 2502 KB, **G0b 477,107 B gzip (466 KB)**;
  later-life 59.6 KB raw, later-brain 111.5 KB. Every first-load change of this round is measured against 477,107 B.

## 1. The place sections: what round 7's last (partial) run showed, and the fixes before this round's run
R7's S2 re-run with the fixed harness (`r7_shell/final1b2`, stopped by the container at 14:48) finished the DESKTOP S2 section: 19 ok / 2 FAIL, and the phone one
up to Frostbell (8 ok / 1 FAIL, then "browser has been closed"). The FAILs and what was done:
- **G7 (desktop) "A shower from the leaf"**: `"tap": "shakepine"` (stale: the Frostbell pine's), so the row's tap at the Drip Leaf's prop centre (the stalk's
  middle, 0.8 m up) never reached the leaf: the squishy the row had just set under the leaf stands in front of it (shot `pg_rainleaf_stay_desktop.png`: Wisplet under
  the leaf, the stalk hidden behind it, the big leaf above). **PRODUCT fault**: the big leaf a player taps has NO prop (the stalk is the thing's only prop), so a
  click on the drawn leaf was a miss. **Fix (later-life.ts `leafTap`)**: the Drip Leaf's big leaf as rainleaf.ts draws it (from the stalk's top, 1.58 m, toward the
  drip zone, dLen + 0.35 long, 0.95 wide, tipped 0.32 rad) takes a press that reaches it before any prop (a squishy in front of the LEAF still takes it). **Harness**:
  G7 taps the middle of the drawn leaf (`__WH__.shell.project`), where a player taps; assertion unchanged. New node row (round 8): with a squishy set under the leaf,
  a still click on the leaf's middle: tap "dripleaf", the Leaf Drip zone on: **ok** (it was a miss before: the ray passes over the squishy and the stalk).
- **R9 (desktop) "Slide off the mound"**: carry 2 ended 0.82 m short of the Sand Mound (z -1.75, the back) and the picking-up-again could not lift it (`carried:
  false, lifted 32`). The published pull holds the hand on the camera-facing plane through the press, so a drag up the frame LIFTS more than it takes back: the
  same cause as round 7's phone L4 / U2 / I7 and item 3's "straight drag up the tall frame". **PRODUCT fix (item 3, below): a carried squishy in a place moves over
  the ground.**
- **Ripple (phone) "three things on their own"**: 2 (the Pebble Ball used; the Pebble Ball and the Driftwood Log as social spots): LIFE's own uses (B04, the LIFE
  lane's); this round's run re-measures it (R7's part B had all three places passing on both frames).

### 1b. This round's place run (`S/run_places1`, tree `S/tree4` = the working tree at 15:21 with 3a, 3c, the leaf tap, 3b's slot row; all four sections, both frames)
- **Desktop S2: 21 ok / 1 FAIL.** G7 (the leaf) and R9 (the mound) pass now. The FAIL, **R7 "A squirt for a friend"**: the Wisplet soaked (0.8; R8_LIFE's
  stay-to-soak works) and squirted once, but the friend was never set beside it: `{"carried": false, "lifted": 32}`. The friend (Dollop) rested on top of the Sand
  Mound at the back, 147 px under the frame's top (shot `pg_ripple_squirt_desktop.png`), and the harness's lift is always UP the frame: it ran into the top edge.
  **Measured on the real physics** (`S/mound/mound.ts`, node_checks' rig, a body resting on the mound's top, onProp 13): a pull from its upper part lifts it after
  216 px up; from its side, after 216 px right or down-right; never straight down (the pull goes into the floor: physics' ground fix). So a player can pick it up
  (sideways, toward where it should go); **HARNESS fix** (`carryOnto`): when less than half the lift's 340 px is free above the press, the press goes on the body's
  side toward the target (or toward the room) and the lift goes across the frame; a body with room above lifts exactly as before. Assertion unchanged.
- **Phone Ripple** (running): "three things on their own" 2 (Pebble Ball, Sand Mound; LIFE's own uses: the LIFE lane's, as R7's phone); **R3 "Ring the
  shells" 1 of 3**: the two clear shells were tapped at (313, 163.5) and (339.7, 163.5) px; the shot (`pg_ripple_stay_phone.png`) shows the Shell Chimes at the
  back right BEHIND the top-right column (Journal / Places / party buttons, 330..374 x 64..212 px) and the second tap fell in the column's 8 px gap, which the
  column's box took. **PRODUCT fixes**: (1) `ui/hud.css`: the column's box no longer takes presses, only its buttons do (`.hud-life { pointer-events: none }`,
  `.hud-life > * { pointer-events: auto }`); (2) `render/place.ts PLACE_COL_PX` 156: on a tall frame wider than 380 px a place's framing keeps the column clear
  too (the top row + 156 px = 212 px, the column's foot), not only the play slot (52); the same lens and squishy size (width-bound fit), the floor a quarter
  flatter (constant's comment has the numbers); at 380 px and under hud.css hangs the column lower (124..272) and only the slot is kept clear there (known issue).
- **Phone Ripple R7 "A squirt for a friend": ok** (the stay-to-soak and the friend's carry). **Phone Frostbell I7 "Down the glide ramp": 1 of 2** with both carries
  on the ramp's top (err 0.023 / 0.033 m). The harness's second carry takes the squishy NEAREST the top: the one it had just set there (LIFE keeps a squishy set on
  a ride on it 20 s). A carry let go is a "toss" until the body LANDS (`tossed`; the ride's USE by PLAYER needs it false), and a squishy picked up from the ramp's
  top and set back with the carry over the ground never falls, so no land event came and it stayed a toss: **PRODUCT fault** (a player setting the same squishy
  back on a ride got nothing). **Fix (later-life.ts sense)**: a carry let go while the body already rests on something (`onProp >= 0` or `grounded`) is set down, not
  tossed. (Checked on the real physics in node, `S/mound/ramp.ts`: carries onto the ramp's top twice, each let go and slid; the browser check is the final run.)
- **Whole run: 87/94** (desktop S2 21/1, phone S2 18/4, desktop S3 every row ok, phone S3 2 FAIL, console 8/0; 15:21 to 17:09). The other three FAILs:
  - **phone Frostbell I4 "Snow from the pine"**: I4 itself done, but the row's tap was `"body"`: no part of the pine was clear (shot `pg_frostbell_play_phone.png`:
    the Shake Pine stands at the frame's right edge, its branch's centre at x 397 of 390 px, its crown BEHIND the top-right column, Chunkle in front of the
    trunk). The column part is the PRODUCT fault fixed above (PLACE_COL_PX); the branch outside the frame is the tall layout's spot (LIFE data: request (8)).
  - **phone Lanternroof "the Night Breeze ... the Vane Disc turns while it blows"**: `vaneW 0.158` (bar 0.2) read at the gust's rising edge (level 0.611, the
    host's vane already turning): the look's spin eases in. **Harness fix**: the look is read again while the same gust blows (up to 1.5 s, level over 0.4)
    and its fastest spin counts; the bar is unchanged.
  - **phone Cloudloft "a hard toss toward the left side"**: in flight never past the guard (worst -0.066 m against 0.1); 6 s later the squishy rested at
    x -1.481 against the tall bounds' 1.4 + 0.05: 3 cm outside, at the back-left (z -2.665), inside the corral's rim: bringing a squishy back inside the bounds
    after a landing is LIFE's corral (request (8)); not a shell fault I can find (the toss is the published flick; my carry over the ground only changes a
    carry's height, and the in-flight part passes).
  - phone Ripple "three things on their own" (2): LIFE's own uses (B04), the LIFE lane's, as in R7's phone run.

### 3a. A carried squishy in a place moves over the ground (src/shell/game.ts seam + later-life.ts `carryPoint`; item 3's drag, item 1's carries)
`game.ts` wraps the gesture host's `planePoint` (3 lines, first-load): `life?.carryPoint?.(...) ?? planeAt(...)`. `later-life.ts carryPoint` (life chunk): at Home, or
for any pull that is not a carry, null (the published camera-facing plane, unchanged). In a place, once physics carries the body (`metrics.carried`), the hand's
target is the pointer's ray on the LEVEL plane at the height the hand had at the pick-up (the published plane's point for that pointer: no jump), kept inside the
place's reach (bounds + 0.3 m, their front reach), and at most `CARRY_LEAD` 0.9 x the body's rest radius ahead of the body across the floor (each move asks again
from where the body is now). The lead clamp is needed: without it the far target (the level plane near the horizon) put physics' own lead clamp and follow speed
limit to work and the height was not held (measured in node, a scratch tree: a 120 px drag up the frame lifted the squishy 1.22 / 1.38 / 1.37 / 1.27 m at Ripple,
the cabin, Frostbell, Cloudloft). With it (`S/nc3.log`): the same drag takes it back **2.97 / 2.65 / 3.34 / 3.31 m** with the height held (dy 0.05 / 0.15 / 0.05 /
0.05 m); at Home the same gesture is the published carry (dz 0.19, dy 0.45: it rises more than it goes back). New node rows (Cloudloft's carry over the ground;
Home keeps the published carry): both **ok**. No physics file touched (the LIFE lane's softbody.ts round-8 carry lift, CARRY_LIFT_K, is in the snapshot).

### 3c. perchDown covers static bars (later-life.ts `perchTop`)
Round 7 lifted a squishy down from the top of a BLOCK at least 0.6 m tall. Now any static thing's top: a block's top face, a bar's (an arch's top bar at p.height,
a standing bar's top, a lying bar's 2 r: the Driftwood Log's 0.36 m stays below the 0.6 m line); rides and movers never (`ride`, pads, seesaws, swings, water).
Set down on the floor beside it toward the middle (a bar: its own radius + the body's + 0.15 m out; an arch is walked under). New node row (round 8): a squishy set
on top of the Sunbow Arch rests on it (9 samples on the bar), then stands on the floor beside it within 5 s (y 0.49, (-1.23, -1.37)): **ok**.

### node_checks after these (`S/tree3`, `S/nc3.log`): **183/184** (the 4 new rows ok; the one FAIL is SH-22 B7, 11.8 %, as at the baseline)
### G0b, and the carry seam moved out of the first-play download (16:10)
A build of the working tree at 15:58 (`S/tree5`) measured **G0b 477,353 B (+246 over the round's 477,107)**. Split by building the same tree with my four first-load
files at HEAD (`S/tree6h`): the LIFE lane's first-load changes +112 B (softbody.ts in the index chunk, the audio engine, data), mine the rest. Mine are now:
(1) the carry seam lives in the life chunk (later-life.ts wraps `game.host.planePoint` while attached, gives it back on dispose; game.ts is HEAD's again; the
`carryPoint` member left lifeLink.ts); (2) the stage only passes the pitch range on (fitPlace checks it); (3) the gift sweep is one condition; (4) **a dead debug log
removed from the first-play download**: `src/shell/cut.ts` printed `TOSSDBG` + a JSON dump when a global `__WH_TOSS_DBG` was set, which nothing sets (CUT-C fix
round, 2026-10-10): -113 B gzip. **Now (`S/tree7`): G0b 477,153 B = +46 B over the round's start: my lane net -66 B, the LIFE lane's +112 B** (request LIFE (7)).
node_checks on `S/tree7` (the seam in the life chunk): **184/184** (`S/nc7.log`; SH-22 B7 passed this run); probe_r8_features 9/9, probe_app 188/188, probe_trophies
31/31, renderview/pg_node_checks 40/0, probe_gestures 160/160, probe_merge 22/22, probe_screens 43/43, probe_overlays 21/21, probe_uikit 62/62 (`S/p7`).

### 3b. The phone's play slot over the tall cabin's kettle and hearth (src/render/place.ts, the away chunk; R6_SHELL's leftover)
On a tall frame the play UI's slot under the top row (`.pl-slot`: the tracker pill, the stamp moments) spans most of the width (16..314 of 390 px) and hangs at
64..~108 px, but a place's framing kept only the top ROW (56) clear: the back of a tall layout stood under it (R7's `pg_cabin_phone.png`: "New stamp: A wish comes
true" over the kettle, the hearth's top under it and its right edge under the Journal column). **Fix**: `PlaceHost.fit` adds `PLAY_SLOT_PX` 52 to the top row on a
TALL frame (w < 0.9 h) when the HUD reported one; a wide frame keeps the slot a corner (not a row); Home's framing never comes here (unchanged). Measured in the
browser: section 3b' below (pending the machine). **probe_pg_data's place camera model must follow** (request LIFE (3)).

## 4. The three designed features that were never built (each in a lazy chunk; the simplest reading of each spec, said here)
- **"Who's coming?"** (QUESTS 15: "Under the grid, Who's coming?: 56 px chips of the party (gem, colour, name under), up to the tier's whole cap, the current party
  preselected, and Change (a shelf picker)"): `ui/later-journal.ts` (the `later-journal` chunk) + journal.css. Under the postcards: a chip per squishy out now
  (`host.partyNow()`: the party IS the wholes out, up to the tier's cap by the mat's own rule), its tier's gem, its colour (the Hoard's swatch of its genome) and its
  name under it, all pressed (= comes along). A tap leaves one at Home (unpressed: dimmed, "stays at Home" said); the trip (any postcard's "Go to ...", unchanged)
  first puts the unpressed ones back on the shelf (`mat.remove`), then the host's travel path; the squishy in hand always comes (its chip aria-disabled). "Change"
  closes the sheet and opens the Hoard (its shelf brings others out: the shelf picker). Simplest reading: the spec's ONE primary "Go to ..." button is kept as each
  open postcard's own "Go to" (the published flow and every harness row use it).
- **The photo frame** (QUESTS 6.10 / 10: the Friendship Frame keepsake "a thumbnail of the X8 photo, at most 12 KB under its own key, shows in it on the Journal page";
  PLAYGROUND_BUILD 11.15: 160 x 120 JPEG data URL, `wobblehoard:v2:journal.frame`, written once at the X8 photo): NEW `ui/later-frame.ts` (its own `later-frame`
  chunk, imported only when X8 completes) makes the thumbnail (the photo cropped to fill 160 x 120, the best JPEG quality that fits 12 000 characters) and writes it
  ONCE; the life host keeps the last photo (Snap's Save already wrote the PHOTO record X8 counts: `hudBinding` now hands it the PNG blob, `note('photo', blob)`) and
  at X8's stamp stores it (`createFrameWatch`); the Journal's Keepsakes page shows it in the Friendship Frame tile once found (`host.frameThumb()`, an `<img>` from
  a data URL: the CSP's img-src allows data:). Simplest reading: the X8 photo is the last photo before X8's stamp (the PHOTO record of that Save completes it);
  the Snap shutter / preview of 11.15 is not part of this item (Save stays the shutter).
- **Journal gifts in the trophies** (PG_QUESTS round 3's "trophies' gift sweep", the designed line that was never put in): a gift squishy that lands on the shelf
  is counted by the trophies at once, as a restock is (`achievementsBinding.ts attach()`: the collection's `gift` event with state `granted` -> the species sweep;
  one condition, first-load). Simplest reading of "Journal gifts shown in the trophies shelf": the gifted species shows in the Trophies' species count (and can earn
  its collector trophy) right after the grant, not at the next capsule or merge. **probe_journal CO-12 row 3 forbids exactly this** (its save comparison includes
  the species counter): request LIFE (4) below, the re-spec PG_SHELL asked for in round 4.
- **Node rows**: NEW `_harness/probe_r8_features.ts` (light, 0.5 s): **9/9** (FR-01..05 the frame: the cover crop, the quality walk under 12 000 characters, written
  once / refused / quota, the host's wiring at X8 only, the lazy import and the pieces in place; GS-01 the gift counted at once (species 1 -> 2 = owned); WC-01..03
  the structure of "Who's coming?" (the DOM is the browser check's)). Browser checks: pending (section `r8-features`, desktop and phone).

## 2. Cloudloft: pale squishies on the near-white cloud tops (measured A/B; `S/cloud_ab.mjs`, renderview `pg.outlineContrast`, port 5364)
One squishy per family at Cloudloft's middle, 150 ticks settled, the WCAG contrast ratio across its outline (2 px inside against 2 px outside, every edge pixel):
median, 20th percentile, and the median of the top third; 1280 x 800 and 390 x 844. Variants (`S/cloud_variant.py`): A as is; B a violet rim light
(`rim: tok('dusk','lagoon',0.3,0.9)`); C a soft contact shadow (the dent wider and darker); D darker cloud tops around each body (a wide shade, -32 %).
| frame | worst family median (A / B / C / D) | worst p20 (A / B / C / D) | the pale families' medians in A |
|---|---|---|---|
| desktop | 1.35 / 1.31 / 1.36 / 1.36 (waterfill) | 1.13 / 1.10 / 1.13 / 1.14 | marshmallow 2.03, mochidough 2.13, firmsilicone 2.01, popdome 1.95 |
| phone | 1.44 / 1.37 / 1.46 / 1.48 | 1.14 / 1.10 / 1.14 / 1.13 | marshmallow 2.04, mochidough 2.13, firmsilicone 2.06, popdome 1.81 |
Every family's outline reads at a median of 1.35 or more in A; the pale families are the HIGHEST (about 2.0), the lowest are the clear ones (waterfill,
gummy, slimegoo: their own translucency, not the cloud). B lowers most families (slowrise 1.85 -> 1.46 on the desktop); C and D change the medians by 0.04 at
most (the contact dent and the shade sit under the body, where the outline's outer samples mostly see sky and far cloud). **Kept A** (no change shipped).

### 3b'. The tall cabin in the browser with the column kept clear (`S/cabin_phone.mjs` on `S/tree8`, the cabin's tall layout, 1 out)
390 x 844: play slot 16..279 x 64..108, column 330..374 x 64..160, hearth 236..366 x 244..333, kettle 164..208 x 277..329: **0 % under the slot, the column
and the top row** (R7's `pg_cabin_phone.png` had the moment over the kettle and the hearth's right edge under the column). 360 x 640 (the column at 124..220
there, only the slot kept clear): kettle clear, **the hearth 22 % under the column** (known issue below).

### 4'. The browser check of the three features (`r8-features`, `S/r8feat4`, desktop and phone): **8/8**
The first runs found: (1) **PRODUCT bug: the Journal's Keepsakes page did not render at all** (TypeError "undefined is not iterable"): my Friendship Frame
lookup used `KEEPSAKE_TEXT.findIndex(([name]) => ...)`, and findIndex visits the retired keepsakes' holes (5, 6, 8; forEach skips them): fixed
(`k?.[0]`), the page renders and shows the photo; (2) harness: the seed's PENDING gift is granted by the store at load (so there was no card to pick):
the row now makes chapter 1's gift READY (Home's and the cabin's finales done) and picks Puddlo in the card: the Trophies' "Small Shelf" goes 1 -> 2 of 10 at
once; (3) harness: the Menu's tooltip (shown on keyboard focus after the Escape) hung over the Journal button and took the click (pre-existing, known issue);
(4) harness: the chips measured 54 px through the sheet's opening scale: their CSS size (offsetHeight) is 56 px on both frames.
Also fixed in review: the carry seam (now in the life chunk) kept the first carry's height for the next carry of the same squishy (`carryB` reset when no
squishy is carried).

### G0b on the final tree (`S/dist_final`): **477,144 B** (+37 over the round's 477,107: the LIFE lane's +112, my lane's net -75); G0 2511 KB of 3072;
`later-frame` 1.1 KB, `later-life` 63.2 KB, `later-journal` 12.8 KB.

## 5. The LIFE lane's requests
### (11) Cloudloft's tall layout needs room: a per-layout camera pitch range (src/render/placeview.ts, place.ts, stage.ts; src/contracts.ts additive; later-life.ts)
**Measured first** (scratch `S/cam/*.ts`, the shipped fit: placeview's fitPlace in placeBand of the reported rows, 390 x 844, top 56 + PLAY_SLOT 52, bottom 174):
the place camera already frames whatever bounds the layout gives, and the visible floor is wider than the bounds (hx 1.4 today: the floor's half width is 2.22 m
at the back, 1.86 at the middle, 1.50 at the front edge). What stops a wider tall layout is the fit itself: it scores a framing by a 1 m squishy's size only, and once
the width binds (hx 1.7 and more) that size barely changes with the pitch, so the FLATTEST pitch wins: hx 1.8 picks 0.15 rad and the layout's 6 m of depth fill
110 px of the frame (hx 1.9: 83 px). A global floor would change every tall framing on other frames (360 x 640: 0.35-0.40 -> 0.60 and the bars missed), so it is per layout:
- `fitPlace(..., pitchMin = 0.15, pitchMax = 0.9)` (memo keyed by them), `PlaceHost.fit(..., pitchMin, pitchMax)`, `StageLike.setPlayBounds(cx, cz, hx, hz, pitchMin?, pitchMax?)`
  (contracts.ts: optional, additive; a range outside 0.05..1.4 falls back to 0.15..0.9), and the shell passes the layout's own `camPitch` when its data has one, else the
  place's `camera.pitch` (P8; every place has [0.15, 0.9] today, so **no framing changes now**: identical numbers for all seven places, both layouts).
- What a tall layout with `camPitch: [0.6, 0.9]` gets on 390 x 844 (bounds hz 3.0; lens, pitch, a 1 m squishy front / mid px (bars 100 / 80), the floor's depth on
  screen, the floor's visible half width back / middle / front edge):

| tall hx | lens | pitch | front / mid px | depth px | floor half width (m) |
|---|---|---|---|---|---|
| 1.4 (today) | 35 | 0.60 | 133.4 / 107.0 | 354 | 2.22 / 1.86 / 1.50 |
| 1.7 | 35 | 0.60 | 110.7 / 91.9 | 303 | 2.52 / 2.16 / 1.80 |
| 1.8 | 35 | 0.60 | 104.7 / 87.7 | 313 | 2.62 / 2.26 / 1.90 |
| 1.85 | 35 | 0.60 | 102.0 / 85.8 | 265 | 2.67 / 2.31 / 1.95 |
| 1.9 | 17 | 0.60 | 101.1 / 92.8 | 306 | 2.29 / 2.12 / 1.95 |
| 2.0 | 35 | 0.60 | 94.6 / 80.5 (bars missed) | 274 | 2.82 / 2.46 / 2.10 |

  RD-17's front bar (100 px on 390 px) caps a tall layout's bounds at hx 1.95 whatever the camera does (the front corners' centres span the frame), so "hx >= 2.0"
  is not reachable inside RD-17; **hx 1.8 with camPitch [0.6, 0.9]** shows >= 2.0 m of floor each side everywhere but the front 0.8 m (z > 2.2; 1.90 m at the front
  edge) with both bars met. Request LIFE (5) below has the data and model lines.

### (7) Home's Music Box behind the party: answered, not built (my judgement, said here)
- (b) "a quick click on a RESTING squishy goes to the switch thing behind it": a still click on a squishy is a POKE, the game's first gesture ("Tap to poke"); with
  the box behind Dollop's right half, a player poking Dollop there would start the tune instead. Not done.
- (a) the Home party framing: the box is about 1 m behind the first slot and 0.3 m tall; from Home's camera (pitch 0.27 rad) a thing that far behind a 1 m squishy
  only shows over it at about 43 degrees of pitch, and sideways perspective pulls it toward the middle, behind the body: no framing change of the size this round
  allows (Home's framing is pinned by the published Home rows and LIFE's model) uncovers it. Not done.
- a UI answer (a "Play" chip like D-95's Auto chips, shown while a squishy covers the box): possible in the life chunk (`ui/thingAuto.ts` places chips clear of
  the HUD and the faces), but it adds a control on Home's main screen for a thing that is hidden only with 3 or more out, and the published row would need a
  re-spec to click the chip. I judged it not better than the owner's call on Home's spots and did not build it.
- So the published row "a click on the Music Box plays its tune" stays the known FAIL with 3 out on 1280 x 800 (R7_SHELL 5A: box centre (1160, 321), Dollop's
  disc (1120, 330) r 130 px), and DT-18 stays red: **the owner's call** (move the box's spot off the party row's line, or a smaller party row at Home).

## 6. THE final run (all seven places open; three jobs, one at a time on 5366)
Tree `S/tree_final` = the live working tree at 17:41 (both lanes' files; tsc 0), then `S/tree_final2` at 18:51 (+ the tall pitch floor below).
### 6A. Job A on `S/tree_final` (17:42 to 18:51): the 32 published sections of R7's part A + `r8-features`: **browser_shell 519/522**
(R7's final part A: 505/510; FIX5 R2.6: 497/509.) pg-playthrough all ok (the Music Box row passed this run: no squishy rested in front of the box), pg-home5 ok,
r8-features 8/8, prod-build ok (G0 2511 KB, G0b 466 KB), console-and-network ok. The 3 FAILs:
- (1, 2) cut-real "leaving: a quick switch reconnects at once" (`pieces 2`) and "hidden 30 s keeps the pieces; hidden over 60 s comes back whole" (`short 3,
  long 1`): **the PC's own on this machine**, the same rows and numbers as R7's final part A, FIX5's (2, 3) and round 4 (the published tree 9211d66ba too).
- (3) pg-phone "D-95: a finger on the swing seat is the hand" (`tap ""`): **PRODUCT fault of my column row**: with 156 px of the frame's top kept clear the
  tall fit went flat (0.40 rad at the cabin) and Dollop stood in front of the Pillow Swing's seat (`pg_cabin_auto_phone.png`: the top 300 px only the log wall,
  the party pressed against the swing). **Fixed** (`TALL_PITCH_MIN` 0.6 in placeview.ts fitPlace, for a tall frame wider than 380 px, where the column row is kept clear): the
  tall fit keeps the 0.60 rad the tall framings had (the cabin 108 / 89 px, the others 111 / 92: RD-17's bars met; depth 326..336 px; pg_node_checks 40/0,
  probe_pg_data's camera rows pass with it). Re-run in job B2.

### 6B. Job B on `S/tree_final2` (18:51 to 20:15): pg-places, pg-places-phone, pg-places-s3, pg-places-s3-phone + console: **84/94**
Passing now that failed in item 1's run: desktop R7 "A squirt for a friend" (the sideways lift), phone R3 "Ring the shells" (the column kept clear and its
gaps open), phone I7 "Down the glide ramp" (set down, not a toss), phone Lanternroof Night Breeze (the gust sampling), phone Ripple "on their own", phone G4,
desktop Cloudloft U2/U3, every Lanternroof row on both frames; 0 console errors on all four sections. The 10 FAILs:
- (1-4) **the four Places-sheet rows** (S2 and S3, both frames): every listed field right (cards, "Go to", "0 of 10 stamps", 7 of 7 postcards drawn); the row's
  pattern `/...|coming/i` on the WHOLE sheet took the new "Who's coming?" section (item 4, QUESTS 15's own words) for a "coming soon" card. **Harness,
  re-specified with the reason at the row**: "coming" is checked on the postcards' grid (`.jn-cards`), the dropped places' names still on the whole sheet.
- (5) desktop Ripple "three different things on their own" (2): LIFE's own uses (B04); it passed on the phone this run and failed there in item 1's.
- (6, 7) **desktop R9 and I7: 1 of 2**, both carries on target (err 0.02 to 0.05 m): the first squishy set on the mound's / ramp's top is held there by its
  ride (the host's RIDE hold, D-74, 20 s) and the second, 4 s later, landed on it. **Harness**: the second set waits until the top is free (up to 24 s), as a
  player's would; the assertion is unchanged. (Whether a SLIDE ride should hold a squishy at its top at all is a design question: "Slide off the mound".)
- (8) phone Frostbell I4 (I4 itself done; the tap was `"body"`): the Shake Pine's branch at x 383 of 390 px with the party in front of its trunk: LIFE (8a).
- (9) **phone Cloudloft U2 "Boing on the puffs": 1 of 3**, on LIFE's re-laid tall layout (hx 1.8, the pads at (-1.11, -2.58), (0.21, -2.72), (-1.58, -1.67)):
  the row drops three times onto the front-most pad (set down 0.8 m in front, picked up again, carried back: every carry on target, err 0.01 to 0.2 m) and
  one bounce counted. Not found this round (no time left for a trace): **open** (the pads moved at 16:48, after item 1's run, where it passed on the phone).
- (10) phone Cloudloft "a hard toss toward the left side": in flight inside the guard (worst -0.271 m); 6 s later 0.07 m past bounds + 0.05 (x -1.916 of
  1.8): the corral's walk back, LIFE (8b), as in item 1's run.

## Not done, and known issues (kept current)
**Not done**
- Home's Music Box behind the party (LIFE (7)): answered, not built (section 5): the owner's call. DT-18 stays red; the published Music Box row passed in
  this final run (no squishy in front of the box this time) and failed in R7's: it depends on where the party rests.
- phone Cloudloft U2 "Boing on the puffs" on the re-laid tall layout: 1 of 3 bounces, cause not found (section 6B (9)).
- the Cloudloft A/B kept A (no variant helped beyond noise); the clear families (waterfill, gummy, slimegoo) have the lowest outline contrast (median 1.35 to
  1.6), not the pale ones.
- LIFE's option (c) for (7), a browser table of every Home thing against the slot bodies for 1 to 5 out: not measured.
**Known issues**
- At 380 px wide and under (360 x 640) the top-right column hangs at 124..272 px and only the play slot is kept clear: the tall cabin's hearth is 22 % under
  the column there (390 x 844: 0 %).
- The Menu button's tooltip, shown on keyboard focus after an Escape closes the Menu or Trophies, hangs over the Journal button and takes a click there until
  focus moves (pre-existing; the r8 rows let focus go first).
- With the column row kept clear and the 0.6 rad floor, a 1 m squishy in a place on 390 x 844 is 108..111 px at the front (was 133..149): RD-17's 100 / 80
  bars are met; the frame's top ~170 px show the place's back wall / sky.
- cut-real's two "leaving" rows: the PC's own on this machine (R7, FIX5 and round 4 the same).
- G0b 477,144 B, +37 over the round's start: the LIFE lane's first-load +112 B (request LIFE (7)); my lane is net -75 B.
- A SLIDE ride (the Sand Mound, the Glide Ramp) holds a squishy the player set on it at its top for the RIDE hold's 20 s (D-74): "Slide off" is slow there.

## Requests to other lanes (kept current)
- **LIFE (1), probe_quests QU-14 x2 with all seven places shipped** (the S3 patch is applied in the working tree): (a) the shown-set table needs the all-seven row
  (every chapter H, C, R, I, G, L, U 1..10 and X1..X10 shown once all seven ship); (b) "the tracker never shows a hidden quest ... and hidden (X) does not complete
  from its own events" has no hidden quest with a script left when every place ships: re-specify it with that reason (e.g. the hidden-quest half checks a quest of a
  shipped-but-closed place, or is "not applicable: nothing is hidden in an all-shipped build" with the tracker half kept). Not edited: your file.
- **LIFE (3), probe_pg_data's place camera model (`placeCam`) must follow the shipped place framing (R8_SHELL 3b)**: `src/render/place.ts` `PlaceHost.fit` now adds
  `PLAY_SLOT_PX` (52, exported there) to the reported top row on a TALL frame (`w < 0.9 h`, when a top row is reported): the play UI's slot (tracker pill, stamp
  moments) is a row there. Your pinned lines are still present verbatim (`const B = placeBand({ top, right, bottom, left }, w, h, this.band);`), so the pin does
  not trip, but the model is now one row short on the phone: `placeBand({ top: I.t + (tall ? PLAY_SLOT_PX : 0), ... })` (and a pin on the new line
  `if (top > 0 && w < 0.9 * h) top += PLAY_SLOT_PX;`). The framing gets a little smaller on phones in places (the band 52 px shorter): the DT-01 tall rows may move.
- **LIFE (4), probe_journal CO-12 row 3 ("trophy behaviour is unchanged by the Journal ... equals the save without one")**: the orchestrator's round-8 brief asks for
  "Journal gifts shown in the trophies"; the designed line (PG_QUESTS round 3, "the trophies' gift sweep") is now in `achievementsBinding.ts attach()`, so the gifted
  species is counted at once and the row's byte comparison differs in `counters.species` (B 2, A 1). The re-spec PG_SHELL wrote in round 4 (PG_SHELL.md R4.2 note):
  compare the saves with `species` left out, and assert B's `species` equals the species owned after the grant (written reason: "the trophies count a gifted species at
  once, the sweep PG_QUESTS asked for"). Your file, not edited. My probe_r8_features GS-01 checks the new behaviour.
- **LIFE (5), your request (11) answered (section 5): a layout's own camera pitch range.** To use it: (a) `src/data/places.ts` `LayoutDef` gains
  `readonly camPitch?: readonly [number, number]` (radians; the shell already reads it with a cast, `(lay as { readonly camPitch?: ... }).camPitch ?? next.camera.pitch`);
  (b) Cloudloft's `tall` sets `camPitch: [0.6, 0.9]` and its bounds' hx (1.8 meets RD-17's bars; table in section 5), then the re-lay; (c) **probe_pg_data's
  `placeCam` pins changed text**: later-life.ts now reads `stage.setPlayBounds?.(b.x, (z0 + z1) / 2, hx, (z1 - z0) / 2, pr[0], pr[1])` (and
  `const pr = (lay as { readonly camPitch?: readonly [number, number] }).camPitch ?? next.camera.pitch;`), place.ts
  `return fitPlace(cx, cz, hx, hz, w, h, B[0], B[1], B[2], B[3], pitchMin, pitchMax);`: the model passes the same range,
  `fitPlace(..., B[3], (L.camPitch ?? P.camera.pitch)[0], (L.camPitch ?? P.camera.pitch)[1])`. Until then the pins report "the place camera's code changed"
  (a true statement: no framing number changed, every range is the default).
- **LIFE (6), the place camera's tall top row changed again (section 1b, 16:00)**: `PlaceHost.fit` now reads
  `if (top > 0 && w < 0.9 * h) top += w > 380 ? PLACE_COL_PX : PLAY_SLOT_PX;` with `export const PLACE_COL_PX = 156;` (PLAY_SLOT_PX 52 kept): on 390 x 844 the
  model's top row is 56 + 156 = 212 (the top-right column's foot), not 56 + 52. Same lens and squishy size on every tall layout; the back of each layout is drawn
  about 100 px lower (DT-01's tall "under the bottom HUD" margins shrink; the column no longer covers the back-right things).
- **LIFE (7), G0b (the first-play download must not grow)**: the working tree measures 477,153 B against the round's 477,107 B; my lane is net -66 B (section 3,
  "G0b"), the LIFE lane's first-load changes add +112 B (the index chunk: softbody.ts's carry changes and data; the `engine` chunk +63 B). Please take 46 B or more
  out of your first-load modules (or tell me and I look for more in mine).
- **LIFE (8), from the place run (section 1b)**: (a) Frostbell's TALL Shake Pine stands at the phone frame's right edge (its branch's centre at x 397 of 390 px
  in `pg_frostbell_play_phone.png`): a spot further in; (b) Cloudloft tall: a squishy tossed to the left side rested 3 cm outside bounds + 0.05 m six seconds
  after landing (x -1.481, z -2.665): the corral's walk back; (c) phone Ripple "three different things on their own" got 2 (Pebble Ball, Sand Mound) in 5 min.
- **LIFE (9), no action needed**: the tall pitch floor (section 6) lives in `placeview.ts fitPlace` (`TALL_PITCH_MIN` 0.6 for a tall frame wider than 380 px), which
  probe_pg_data's model imports; place.ts keeps the line your model pins. probe_pg_data on the working tree at 19:05: 43 ok / 1 FAIL (DT-18 only, as yours).
- **LIFE (2), still open from R7 (10)**: shellview/node_checks SH-22 B7 "the budget's wake gate" is 11.8 % over the cap (17 of 144 fine samples, bar 10 %) on the
  integrated code (HEAD + the S3 flip); it passed (180/180) on round 7's shell lane alone. Its cause is in the interplay of B04's own uses at Home with the wake gate
  (R7_LIFE section 4); I look at the shell's over-budget rule's side too (item 5).
