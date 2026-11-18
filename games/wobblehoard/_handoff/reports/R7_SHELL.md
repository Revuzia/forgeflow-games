# R7_SHELL: round 7, the SHELL lane (src/shell, src/ui, src/input, src/render, vite.config.ts, the shell + render harness; ports 5364, 5366). No git write command is run.

Brief: the orchestrator's round-7 task (SESSION3.md machine rules; D-95 revised, D-96 at the end of `_spec/PLAYGROUND_BUILD.md`; R6_DATA / PHYS / RENDER / SHELL).
No earlier R7_SHELL report existed: this is the first round-7 shell engineer. Started 2026-11-18 at HEAD 99d081c14 (working tree clean; live = 23c684a60).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r7_shell/` (`S/` below).
R6_SHELL's final run (section 4 there) did NOT finish: its browser crashed in `fix2-dock` at 07:37 (every later section "browser has been closed"),
357/376 by then with 2 real cut-real FAILs (quick switch / hidden-tab reconnect) and a page.goto timeout in shift-hint-reflow under load 8-9.

**My working files (14; nothing committed, no git write run)**: src/shell/later-life.ts, src/shell/lifeLink.ts, src/shell/debugHook.ts (dev only), src/shell/hudBinding.ts
(section 5A'), src/ui/thingAuto.ts, src/ui/later-play.ts, src/render/stage.ts, src/render/place.ts, src/render/particles.ts, src/render/places/lanternroof.ts, vite.config.ts,
_harness/browser_shell.mjs, _harness/shellview/node_checks.ts, _harness/probe_app.ts (browser_render.mjs is back to HEAD's). Plus `_handoff/reports/R7_SHELL_open_s3.patch`
and this report.

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 0 | baseline (tsc + the node probes the brief lists) on HEAD | DONE 08:20 (section 0) |
| 1 | R6_SHELL section 4's run on the current tree with the three S2 places opened in a scratch copy; squirtFx draws; squirt drops vs the sea | RUN `S/s2run1` 08:05 to 09:00 (section 1: 183 ok, 10 FAIL, each explained; fixes: harness carry, pgClear, sheet re-spec); squirtFx draws (checked); drops: kind-4 bead (section 1); the rest of the sections run in item 5's final run |
| 2 | Lanternroof + Cloudloft end to end; playthrough 1280x800 + 390x844 in a scratch copy; `R7_SHELL_open_s3.patch` | WIRED (section 2). S3 runs 1 and 2 (2c, 2d) found and I fixed: walls took taps (product), the comet never on screen (render), a squishy stranded on the chimney above the frame (product), Auto chips over lanterns / the vane / a face / the seat (UI), the phone pill's wrap (UI), and harness faults; their final rows run in section 5. Patch written and checked |
| 3 | Home, phone, one out: the Felt Ball must not cover the squishy | DONE 09:15 (render: stage.ts `ballFrames`, measured: section 3) |
| 4 | polish: Journal / Places sheet height on wide layouts; R6_SHELL leftovers | DONE (checked, section 4): the Places panel's `height: auto` on wide IS in this tree; the Journal keeps its card height by design; R6's other leftovers |
| 5 | final browser run: published sections + pg-playthrough + pg-phone + every place section; counts vs 497/509 | RUNNING since 09:55 (section 5): part A, then R7_LIFE's insets reading and part B, then the extras C |

## 0. Baseline (DONE 08:20; `S/tree_base` = `git archive` of HEAD 99d081c14, logs `S/base/`, one probe after another)
tsc 0 errors (2.0 s). probe_app **188/188**, shellview/node_checks **176/176** (105 s), probe_gestures **160/160**, probe_merge **22/22**, probe_trophies **31/31**,
probe_playground (quick) **73/73** (37 s), probe_pg_lifequests **16/16**, probe_life **121 ok / 1 FAIL** (LF-02, known), probe_chatter **42/42**,
renderview/pg_node_checks **40 ok / 0 FAIL**, probe_journal **29 ok**, probe_quests **46 ok, 3 NOT RUN**, probe_pg_data **3 FAIL** (the known three: Home B5 one-out
phone ball, the cabin's tall rocker in the camera model, Cloudloft tall spawns), probe_screens 43/43, probe_overlays 21/21, probe_uikit 62/62. = the brief's numbers.
Tools (scratch `S/`): `mk_tree.sh` (git archive HEAD + the other lane's frozen working files + mine), `freeze_others.sh`, `sync_mine.sh` (`mine.txt`: src/shell, src/ui,
src/input, src/render, vite.config.ts, the shell + render harness), `flip_s2.sh` (= R6_SHELL_open_s2.patch), `probes.sh`, `run_browser.sh <out>` (TREE, SECS).

## 1. R6's unfinished run (`S/s2run1`, 08:05 to 09:00, stopped by me in pg-places to chase its carry failures; the rest runs in the final run)
Per section (ok/FAIL): shift-hint-reflow 3/0, **cut-real 12/0** (the PC's two known rows passed this time), fix2-dock 5/1, cut-swell 3/0, cut-low 2/0, hoard-phone 8/0,
menu-pause 20/0, fullscreen-gate 3/0, toasts 8/0, modal-layers 4/0, ui-sounds 7/0, keyboard-only 12/0, prod-build 9/0 (G0 2479 KB, G0b 466 KB gzip, later-life 147.1 KB),
pg-playthrough 24/3, pg-phone 10/0, pg-home5 1/0, pg-places (desktop: Ripple, Frostbell) 8/5, then stopped. 183 ok, 10 FAIL. The FAILs:
- **fix2-dock FAIL** "small landscape 568x320: ... the Snap strip (the two pieces still out)
  under 5 % of each": `snapPiecesOut worst 0.095, per [0.095, 0.095]` (FIX5 R2.6's run: ok, `worst 0.035, per [0.035, 0.019]`; same strip box [225,13,443,107]).
  First guess was round 6's hint pill in the HUD insets, but the shot (`snapstrip_small_568x320.png`) shows the hint at the TOP left there (not counted: only below
  half the height counts), so that change was reverted unproven (hudBinding.ts is HEAD's again). The section runs on wall time (not stepped): the pieces settle where
  the frame timing lets them (3.5 % -> 9.5 % against a 5 % bar). Re-run alone pending, to tell a flake from a regression.
- **pg-playthrough FAIL** "PG Home: a click on the Music Box plays its tune ...; a second click stops it": `tap1: "body"`: 40 s into LIFE a squishy stood in front of
  the box and the click went to it, as it should (the host gives a press to a squishy in front of a thing). A harness timing row, not the product: re-specified to wait
  (up to 15 s of sim) until no squishy's disc covers the box's centre (`matInfo` discs x 1.1), then click; the assertion is unchanged. The same wait (`pgClear`) is used
  by the new S3 rows' taps (Star Scope, Chimney Corner, Cloud Ball).
- **pg-playthrough FAIL** "PG Travel sheet: Home and Hearthlog Cabin as postcards ...": `cards [home:true, hearthlog:true, ripple:false, frostbell:false, ...]`: the
  S1 build's row (exactly Home and the cabin). **Re-specified** per the brief to the places that ship (reason in the row): every shipped place in PLACE_INFO's order,
  Home and the cabin open, "Go to" only on the cabin, each open card's "N of M stamps", each shut card's "Opens at N stamps", no unshipped place listed or named.
- **pg-playthrough FAIL** "PG D-95 the hand on the seat": `tap "miss"`, the seat moved by a drag of the rider (a squishy in front of the seat took the press, as D-95
  means it to). Same robustness re-spec: the press waits until no squishy's disc covers the seat (`pgClear`); assertion unchanged.
- **pg-places (desktop)**: ok: the 28-stamp opening (lines, pill), the sheet, Ripple's arrival, R3 by three taps, home, Frostbell's arrival, Frostbell "three things on their
  own" (passes); FAIL: Ripple "three things on their own" (used: Pebble Ball; reacted: Rock Pool; social: Pebble Ball = 2: the LIFE lane's B04, R7_LIFE item 1), and
  **every carry**: R9, R7 (Wisplet into the Rock Pool) and I7: `carried: false, lifted: 32` (carryOnto's lift never makes physics carry). **Cause (a harness bug, R6's
  carryOnto, never verified in a full run)**: `S/dbg_carry*.mjs` (Ripple, fresh pointer ids, metrics each 8 steps): the finger stays a PRESS (fingers 1, `press` 0.5 ->
  0.67, compression 0.1 to 0.2) and the body never rises, whether awake or asleep, before or after the stay, before or after real mouse clicks; one lift in the first
  debug run did carry (fingers 0 at step 8: a grab). gestures.ts `outwardPull` commits a press to a PULL only when the press is off the body's screen centre (0.1 r or
  more) and the drag leaves outward; carryOnto pressed AT the centre (the dev view's sx/sy), so the drag was a RUB, a pull only when the two centres happened to
  differ. The product is right (a player grabs a squishy anywhere but its exact middle and pulls outward). **Fix (harness)**: carryOnto (and my tossOut) press 0.55 of the
  body's screen radius above its centre (`matInfo` r) and lift from there (an outward drag). Verified in the S3 run below (U2, U3, L4 and the tosses carry by it).
- Squirt drops (R6_RENDER open item: low contrast against the lagoon sea). squirtFx IS wired and draws (`S/squirt.mjs`, the render harness's own Ripple scenario
  on 5364: 12 drops + the 7-mote splash, Calm 4, a squirt at nobody, false at Home). First try (core over a rim, two streak sprites a drop) judged on the shot
  (`S/squirt_mine/crop_desktop.png`, 3x): still a soft pale smear on the teal sea, the rim invisible (lagoon-ink on a lagoon sea), and two sprites a drop can swap
  their draw order (the pool swap-removes the dead). **Kept fix (render)**: `particles.ts` kind 4, a water drop: ONE sprite, a glossy bead (shaded, a white glint) inside
  a dark ring of its own colour (the ring reads on a pale sea or sand, the bead and glint on a deep one); `place.ts` emits each drop as kind 4 at 0.8 of the streak's
  half size (6 to 8 cm across: a bead is not stretched), colour `tok('lagoon','cream',0.35,1.05)`. One sprite a drop, so the render row "R6 squirt" is HEAD's again
  (12 + 7, Calm 4: my earlier re-spec of it is undone; browser_render.mjs = HEAD). **Checked** (`S/squirt_mine2`, the render harness's own Ripple scenario on 5364):
  drops 19 (12 + 7), Calm 4, at nobody 19, refused at Home and for an unknown squirter, 0 console errors; the shot 0.2 s into the arc (`S/squirt_mine2/crop_desktop.png`,
  3x) shows a chain of distinct pale-aqua beads, each with its dark ring and glint, clear against the teal sea (round 6's soft streak smear is gone).

## 2. Lanternroof and Cloudloft (code written; runs pending)
What each needed from the shell, and what is wired (src/shell/later-life.ts unless named):
| item | wiring |
|---|---|
| travel, ambience, music | generic (PLACE_INFO + `loadPlaceDef` + `audio.setAmbience({place})` / `setMusicStyle(next.music)`: 'roof' and 'cloud' exist in audio; their `later-place-*` chunks named by vite.config.ts) |
| things bound to props | generic (`bindProps`); the Vane Disc has NO prop (physics builds no turntable, D-96): the host keeps its turn (below) |
| Night Breeze -> render | NEW `windLook()`: once a frame the strongest gust level of the place's gusting wind zones (`world.gustLevel`, on LIFE's clock via setGust) -> `stage.thingFx(-1, 3, level)` when it changes: Lanternroof's lanterns sway, streaks drift, the vane turns with it (a look without wind ignores it: Frostbell / Cloudloft return false) |
| the Vane Disc | NEW `vaneSetup / vaneStep / vaneTap`: it turns while the gust of the wind zone it stands in is >= 0.35 or for 3 s after a poke; whoever stands on it while it turns rides: one USE SPIN each turn (L4; by PLAYER when the player set it there within 6 s or poked it), its eyes follow the turn (`setBodyGaze` on a point turning with it, released after). A tap on the disc (no prop for the ray: its painted disc on the floor, when no prop and no squishy is nearer along the ray) pokes it (`thingFx(k, 1, 1)`, its whoosh, LIFE notices). Render: `lanternroof.ts` turns the rose with the gust level (1.4 rad/s at full, eased 0.5 s; a quarter with reduced motion) and spins 3 s after a poke |
| Star Scope | NEW `switch: 'comet'` tap: `thingFx(k, 1, 1)` (the look's 6 s comet; none with reduced motion), its whoosh, USE SWITCH by PLAYER (L7), `lifeThingTap` (LIFE's GAZE_SKY for every squishy on screen: L2); one comet at a time (a tap while it flies is taken, nothing more) |
| Chimney Corner | NEW: a tap, or LIFE's USE NAP naming it (a nap at its warm foot), breathes deeper (`thingFx(k, 1, 1)`). Render bug fixed: `thingFx(3, 1)` set `breath = 1`, overwritten by the next line of the same frame; now a 2.5 s swell of the warm pool and the air. The heat point is the warm thing's spot IN THE LAYOUT IN USE (the wide spot was sent on phones too, over the look's own: also the live cabin's fire on a phone) |
| updraft, wind push, guard, Puff Pads, Sunbow Arch, cloud floor | physics from the PlaceDef (R6_PHYS 2.3 / 2.4); pad kicks -> USE BOUNCE (existing `drainProps`); the dents are the look's (bodies feed) |
| taps, AUTO chips | generic: lanterns (chime: USE RING by PLAYER with its part, L3), Cloud Ball (ball), hammock / Kite Swing (swing: poke; AUTO chip via `autoThings`) |
| finales | generic: the chapter's finale quest (L8 SING of 3, U8 PARADE of 3) done in its place -> `thingFx(-1, 2, 1)` for 20 s (Lanternroof's lantern song, Cloudloft's sunrise + bow) |
| opening, postcards | generic: stamps 36 / 45 (PLACE_INFO), the open line + moment, the tracker pill's VISIT, `drawPostcard` for both ids |
Dev view (`life()`): `vane {turning, poked, riders, tapAt}`, `comet`, each thing's `edge`; the Lanternroof look's `stats()` (gust, driven, vaneW, comet, puff, glow).
Harness: `pg-places-s3` / `pg-places-s3-phone` (browser_shell.mjs; run only on a build that ships the two) and 3 node_checks rows (the dev path); the R6 sheet row of
`pg-places` re-specified to "every shipped place in order, open by its stamps" (a build may ship the two as well). Scratch: `S/flip_s3.sh` (= the patch to come).

### 2c. S3 run 1 (`S/s3run1`, 09:06 to 09:14, `S/tree_s3` = HEAD + my lane + `flip_s3.sh`): 10 ok, 8 FAIL; what it found
- ok: the 45-stamp opening (both open lines said and shown, the pill "Next: Up on the roof"), the Places sheet (4 postcards drawn, "Go to" on both, "0 of 10 stamps"),
  Lanternroof's arrival on both frames (party of three in the frame, its things bound, L1), 0 console errors / failed requests (both).
- **Harness bugs (mine)**: the look's stats and the projection were called as `__WH__.stageObj()` / `__WH__.project()`; both live under `__WH__.shell` (so `look: {}`
  failed the gust row, and the Vane Disc row threw, ending each section before Cloudloft). Fixed.
- **L3 2 of 3 (both frames)**: the harness tapped lanterns 0, 2, 4; a squishy stood in front of one (the press is the squishy's, as it should be). The taps now take
  lanterns no squishy's disc covers (`pgClearPart`, waits up to 15 s of sim); the assertion is unchanged.
- **PRODUCT BUG: the Star Scope tap was "wall" (both frames).** A place wall is a 2.4 m physics box (PROPS.WALL_H, the cabin's log walls); Lanternroof's walls are drawn
  as a knee-high parapet, so from the camera the unseen part of the FRONT wall (z 2.55 wide, 3.25 tall) stood over everything near the front: the Star Scope, the
  hammock's seat (D-95's grab), the chimney, the Moon Dish. A player's tap there did nothing. **Fix (later-life.ts `propOnRay`)**: a wall never takes a press; the ray
  goes on from the wall's far side (walls are the world's last props, one box each in the layout's order: the slab exit from the pose's centre and the layout's half
  sizes), used by the thing tap and the seat grab. The cabin's walls are drawn tall and stand behind everything: nothing there changes (a tap on them was "wall",
  now "miss"; neither is a thing tap).
- **Judged on the shots** (pg_lanternroof_*_{desktop,phone}.png): (1) the hammock's Auto chip, under its beam, stood over two of the five lanterns on the phone and over
  the Vane Disc on the desktop; the chip stops the press, so those lanterns could not be tapped. **Fix**: the host lists the screen spots of the place's other things
  (`autoAvoid`, lifeLink.ts: every part of every thing but a hinge ride's, 22 px; the Vane Disc's painted ellipse) and `ui/thingAuto.ts` keeps the chip off them as it
  keeps off the HUD (the nearest free spot around its anchor). (2) The phone's two-line tracker pill broke "Next: Moon watchers · 0 of" / "2". **Fix
  (`ui/later-play.ts`)**: the count is one unit (no-break spaces) held to the title by its dot: "Next: Moon watchers ·" / "0 of 2". (3) The bodies read well on the
  roof's warm tiles (Dollop red, Chunkle orange, Wisplet lavender, each with a clear edge); the front parapet rail is drawn at the play area's front edge and the roof
  goes on in front of it on a phone (a strip of tiles above the hint): plausible, kept.

### 2d. S3 run 2 (`S/s3run2`, 09:20 to 09:50, the same tree with 2c's fixes): pg-places-s3 17 ok / 3 FAIL, pg-places-s3-phone 10 / 5, console 4 / 0
(Stopped at 09:50 by my own job's 30-min background limit (I launched it without a timeout), during the phone's Cloudloft rows after U2: U3, the ball, the chip,
the toss and home did not run on the phone; every one of them runs in section 5's final run. Every FAIL below has its cause found and a fix in place.)
Desktop: the opening row FAILED for timing only (`live: ""`: the open lines come 1.5 s after the attach and the pill showed first; run 1 passed it): the row now
waits up to 15 s for the lines and their moments before it reads them, and its moment filter also takes "N places are open" (it filtered "is open" only, so the
"more than three" branch could never pass). Then ok: the sheet; Lanternroof's arrival; **the gust** (level 1, look driven, vaneW 0.57, the host's vane turning);
**L3** (lanterns 0, 3, 4: the squishy-covered one skipped; glow 0.60); **L7 + L2** (tap "starscope" with the wall fix, comet on, GAZE_SKY of two kinds); **the
Vane Disc poke** (tap "vanedisc" at (970, 344), vaneW 1.06); **L4** (Chunkle carried onto the disc, err 0.023 m, rode a gust); **the chimney** (puff 1); **the
hammock's Auto chip** (now at (1010, 273), above the Vane Disc, inside, clear of the HUD); **the toss** right (carried, never past the bounds: worst -0.46 m);
home. Cloudloft: arrival (wide, three in frame, U1); **U2 FAIL 2 of 3**: the third carry, to the BACK pad (z -1.9), ended 0.78 m short (the steering ran out of
screen above), so its drop missed; U2 counts three bounces on any pad, so the drops now go to the two front pads in turn (harness; assertion unchanged); **U3** (two
squishies over the Updraft, err 0.009 / 0.037 m, LIFT of two kinds); **the Cloud Ball** (tap, rolled 0.92 m); **the Kite Swing's chip** (inside, clear of HUD).
Shots judged: (1) the comet: NOT seen in the desktop comet shot (`pg_lanternroof_comet_desktop.png`, 2 s into its 6 s): measuring where it flies (`S/comet.mjs`);
(2) the Kite Swing's chip stood over Dollop's face (Dollop dropped on the pad beside the swing): **fix**: the host adds each squishy's face (0.7 of its screen
radius) to `autoAvoid` as a SOFT spot, and `ui/thingAuto.ts` keeps a chip where it is while that spot stays free (a squishy walking by moves it once, not to and
fro) and gives the faces up before it would hide a chip (so the published chip rows cannot lose their chip to a squishy standing by); (3) Wisplet (pale lavender)
on Cloudloft's near-white cloud tops: its top edge is 1.36 : 1 in luminance against the floor behind it (samples (212,177,190) vs (234,214,177)), its base 3.1 : 1
over the dent; it reads (hue, shading, the dent's shadow), softly; Dollop and Chunkle read strongly.
(4) **The Cloudloft toss FAILED my own first bar** (worst 0.42 m past the bounds' edge in flight; back inside 6 s later): that bar (0.15 m) was the WALLED side's. R6_PHYS
2.4's guard limits an OPEN side at the edge + the corral's rim (PG.boundsRim 0.6) + 0.05 m; the row now takes the guard's own limit per place (walled: the inner face;
open: + 0.65 m) plus 0.1 m (one frame of a 6 m/s throw before the reflection). A row I wrote this round, set to the physics' documented limit, not a published one.
Phone: the opening (both lines said and shown), the sheet, Lanternroof's arrival (tall, three in frame), the gust (vaneW 0.71), L3 (lanterns 0, 1, 2), the vane poke,
the chimney puff, the hammock's chip (moved off the lanterns by `autoAvoid`: (70, 236)). **L7 FAIL** on one extra clause of mine: L7 + L2 done, the comet on, but
LIFE's GAZE intent count did not grow within 2 s (desktop 1, phone 0: LIFE's own timing; L2's GAZE_SKY records of two kinds ARE the gaze): the clause is dropped
from my row, the count kept for information. **L4 FAIL**: the carry to the tall layout's Vane Disc (1, -2.34) caught on the Chimney Corner (1.42, -0.9; 0.7 m tall)
and set Chunkle down on it (`onProp` 6, 1.19 m short): `carryOnto` takes a `via` floor point now (round the chimney: left of it and behind it), as a hand would.
**And the shot of it (`pg_lanternroof_vane_phone.png`) showed a PRODUCT problem**: a squishy on top of the 1.4 m chimney (a block's box is 2 x size[1] tall) stood above
the phone frame's top edge, half cut off, behind the HUD's buttons, and stayed there (the following toss row could not even press it: "carried": false, its
centre at the tall bounds' edge). A player can set one there just as the harness did. **Fix (later-life.ts `perchDown`)**: a squishy resting ON top of a block
thing at least 0.6 m tall (its centre above the top face: one leaning on the side, as at the chimney's warm nap foot, stays; the Chimney Corner 1.4 m, the cabin's
hearth 0.9 m; Home's blocks are all lower) for 1.5 s, untouched and not in a toss, is carried
down (carryTo, 0.9 s, no event, never paid) to the floor beside it on the side toward the play area's middle. New node row (node_checks, round 7): a squishy set
on the chimney is on the floor beside it, toward the middle, within 5 s. (The phone's Lanternroof toss FAIL, "carried": false with its centre at the bounds' edge, was
that same squishy up on the chimney.) **Phone U2 FAIL (2 of 3)**: the tall layout's Puff Pads lie at z -2.1, -3.2 and -3.15 (all at the back); the carries ended 0.28,
1.61 and 1.72 m from them (a straight carry up the phone's frame lifts the squishy more than it takes it back); U2 counts three bounces on any pad, so on a phone
the three drops now go to the front pad.

### 2e. The Star Scope's comet was never on screen (render fix)
R6_RENDER flew it on a 60 x 26 m card 100 m behind the roof (head at y -1.6 .. -4.7 m) and noted it "not seen in a browser shot". In the S3 desktop shot 2 s into its
flight it is nowhere: the place camera's low pitch and long lens put that path above the frame's top edge (measured: `S/comet.mjs`, section 2f). **Fix
(`render/places/lanternroof.ts`)**: the comet is set in VIEW space by its own vertex shader: a band along the top of the frame at 60 m (past the roof, in front of the
skyline: the parapet, pots and lanterns still cover it, depth-tested), the head on a path in frame coordinates per layout (wide (-0.42, 0.86) -> (0.36, 0.74):
above the back wall, right of the title and pill; tall (-0.85, 0.95) -> (0.0, 0.88): above the play slot, left of the top buttons), sizes in half frame heights
(head 3 px, tail about 140 px on both frames), never culled. The shell's eyes-follow-the-comet (`cometGaze`) now looks at that same point in the world (the head's
frame point at 60 m through the camera's matrices; round 6's fixed (-24..6, 9..7, -60) did not follow the drawn comet). Same 6 s, the same fade, none with reduced motion.
**Measured (`S/comet.mjs`, the place camera after a dev trip to Lanternroof)**: desktop camera (0, 7.42, 10.83), pitched 0.6 rad down, 23 degree lens: round 6's comet
path projected to y -723 .. -651 px (far above the 800 px frame), the skyline's top to -603, the back wall's top to 146; phone (390 x 844, 35 degree lens): the old path
at y -355 .. -306. With the fix: the comet is drawn on both (`S/comet2/top_desktop_2.png`: head and tail at about (410..540, 60..75) above the back wall, clear of the
title, the pill and the buttons; `S/comet2/top_phone_2.png`: at about (0..85, 15..35) CSS px over the city's lit windows, left of the top buttons, above the pill).
0 console errors on both.

### 2a. R7_LIFE's request: a USE per strike (DONE 08:50, code)
R7_LIFE measured (their SU-03, HEAD) 1002 USE RING records in 300 s at Lanternroof from ONE squishy resting against the Lantern Line while the Night Breeze swung the
lanterns into it: `drainProps` wrote a USE for every body strike (cause 1) on a chime. Now a body's chime strike is its USE RING only when the body itself moves into
it (its speed over `CHIME_V` 0.1 m/s, or tossed) and at most one a second per body (`CHIME_GAP_S`); the same for the Shake Pine (a body's USE SHAKE only with a
puff, which is at most one a second). Sounds are unchanged (every strike still rustles or rings). The player's taps are untouched (USE by PLAYER per tap).

### 2a''. R7_LIFE's other requests to the shell (their section 5)
- **LIFE's own get-on onto a ride (DONE 09:40, code)**: `INTENT.USE` with `b === 1` (B04 SELF_USE.RIDE) -> `useRide(i, k, self = true)`: the same lift (and the
  swing's steadying hand), but no `c.setT`, so the ride's USE is by SELF and no player quest (I7, R9, the rides) counts it; and the host calls LIFE's
  `lifeSetSelfRides(w, true)` after `createLifeWorld`, looked up on the module (`LIFE_STEP.lifeSetSelfRides?.(...)`) so HEAD's LIFE (which has no such switch) is
  left as it is and both trees typecheck. AUTO is untouched. Seen in a run only where the LIFE lane's files are in the tree (the final run, section 5).
- **The over-budget rule and edge things ("for information")**: not changed. The rule (stop the scooting body farthest from (0, 0) when over the awake budget) is a
  published row's (FIX5 B7); "farthest from its own target" needs LIFE's walk target in the host, and this round's one final run could not also re-prove B7.
  A next round's item if the owner wants edge uses to finish more often.

### 2a'. Many places opening at one load (found writing the S3 rows)
A save that reaches several places when a build ships them together (45 stamps with all five shipped: five "X is open. Find it in Places." lines at the attach):
the moments queue holds three and turned the rest into "N new stamps" (the stamp wording, said aloud, for places). Now, above three lines, each is still SAID
and ONE moment shows "5 places are open. Find them in Places."; three or fewer are shown one by one as before (R6's pg-places row: three).

### 2b. The life chunk's 150 KB cap (SZ-02) and `later-brain`
One-file sizes (rolldown, the module alone, minified; `S/size.mjs`): HEAD's life chunk was **147.1 KB** of 150 (prod-build in `S/s2run1`). Round 7 adds to it:
`shell/later-life.ts` 50 119 -> 53 340 B (+3 221, after moving two dev-view helpers out: the Vane Disc's tap points and each thing's front point are now found by the
harness through a new dev-only `__WH__.project(x, y, z)` in debugHook.ts, never in a build), and the LIFE lane's working files: `life/brain.ts` +9 781, `life/world.ts`
+1 328, `data/life.ts` +993, others +202 (at 08:35). So the life chunk would be about 162 KB. **Fix (vite.config.ts; D-92's overflow rule "over a cap a lane packs,
then moves into a lazier named chunk")**: LIFE's brain (src/life/**) is its own lazy chunk `later-brain` (rolldown `codeSplitting` group, `includeDependenciesRecursively:
false`: only the brain's modules move, so nothing a first play loads can land in it; `laterChunkName` names a facade-less all-src/life chunk `later-brain`). The life
chunk imports it, so it loads with it (vite preloads a dynamic import's dependencies in parallel). probe_app's chunk-names row asserts the new name (188/188).
Build check pending (the `S/after_s2.sh` chain builds `tree_mine` first).

## 3. The Felt Ball on a phone with one squishy out (DONE 09:15: measured, kept)
A/B in the browser (`S/ball.mjs`, rseed 4242, one squishy out, Home, the life chunk landed, 4 s of sim; HEAD = `S/tree_base`, mine = HEAD + my lane; shots `S/ball_head/`,
`S/ball_mine/`; the ball's screen radius taken as 0.46 x the body's):
| frame | HEAD: squishy (centre, r px); ball (centre); ball at | overlap | mine: squishy; ball; ball at | overlap |
|---|---|---|---|---|
| 390x844 | (195, 376) r 128.4; (297, 512); (0.331, 1.087) pushed in | **17.3 px over the squishy** | (152, 372) r 93.4; (297, 462); (0.717, 1.087) its own spot | **clear by 33.7 px** |
| 360x640 | (180, 295) r 118.5; (287, 420); (0.365, 1.019) | **8.3 px over** | (141, 291) r 85.4; (284, 377); (0.757, 1.087) | **clear by 41.8 px** |
A tap on the ball (FN-01's first play): HEAD rolls it 0.17 m (its bounds hold it), mine about 1.0 m (room to roll). 0 console errors both. The cost: on a phone with the
ball out and ONE squishy, the squishy is drawn at 73 % of its old size (r 128 -> 93 px), left of the middle, the ball beside it to the right (judged: clean, "Dollop and
its ball"; before, the ball sat on Dollop's lower right). Wide frames and parties are unchanged (ballFrames only on a portrait frame with one whole body at Home).
probe_pg_data's DT-01 "Home B5 one out" stays FAIL until its camera model (the LIFE lane's file) gains this rule (request below). A nearer data spot (e.g. the tall spot
at x 0.62 instead of 0.76) would cost less zoom: an option for the LIFE lane, not needed for the fix.

## 4. Polish: the sheets on wide layouts, R6_SHELL's leftovers (DONE, checked on shots)
- **The Places sheet on wide**: R6's run saw the desktop sheet "run to the bottom with an empty half" because `height: auto` on wide (journal.css line 7,
  `body[data-layout="wide"] #wh-travel.jn { height: auto; max-height: min(100%, 720px) }`) was "not yet in that tree". It is in this one (HEAD): the S3 run's desktop
  sheet (`pg_s3_sheet_desktop.png`, four postcards in two rows) ends 24 px under its last card (150 to 650 of 800 px). Nothing to change.
- **The Journal on wide** keeps its 720 px card (`.jn` height min(100%, 720px)) on purpose: it has four tabs, and a card that fits each tab would jump in height at
  every tab switch; its Stamps list (60) fills it and scrolls inside (`pg_journal_desktop.png`). Kept.
- **R6's other leftover** (section 3 there, "not in the brief, not fixed"): on a phone the tracker pill and the right column cover the top of the TALL cabin's kettle
  and the hearth's right third (the play UI's slot is not in the HUD insets). Counting the slot changes every place's phone framing (and Home's, unless split by
  place); not in this brief, so left as R6 left it, for the owner's call. The phone's two-line pill itself reads better now (section 2c).

## 6. Node probes on HEAD + my lane (`S/tree_mine`, 09:52, one probe after another; logs `S/probes_mine/`)
tsc 0. probe_app **188/188**; shellview/node_checks **180/180** (176 at HEAD + 4 new round-7 rows, all ok: Lanternroof's gusts heard (weather 0.8 x3) and sent to
the look (109 levels, max 1, back to 0), the vane turned 7 of 26 s and its rider wrote a USE SPIN; the Star Scope's comet (tap "starscope", one comet at a time:
3 -> 4 -> 4, +4 records) and the chimney's breath (tap "chimneycorner"); the perch: set on the chimney, on the floor 0.80 m from it toward the middle within 5 s
(y 0.50, x -1.82); Cloudloft's breeze heard (0.4 x2), a pad bounce by itself, LIFT naming the Updraft); probe_gestures **160/160**, probe_merge **22/22**,
probe_trophies **31/31**, probe_playground (quick) **73/73** (38 s), probe_pg_lifequests **16/16**, probe_life **121 ok / 1 FAIL** (LF-02, the known one), probe_chatter
**42/42**, renderview/pg_node_checks **40 ok / 0 FAIL**, probe_journal all ok, probe_quests all ok (3 NOT RUN, as at HEAD), probe_pg_data **3 FAIL** (the known three:
Home B5 one-out, Hearthlog tall, Cloudloft tall: data / camera-model rows of the LIFE lane, unchanged by mine), probe_screens **43/43**, probe_overlays **21/21**,
probe_uikit **62/62**. Every probe that passed at HEAD passes; nothing loosened. (On the integrated tree, i.e. with the LIFE lane's working files, these are the LIFE
lane's to run: their files change probe_life / quests / pg_data rows.)

## 5. THE final run (part A DONE 11:06; then the A/B and re-run below, part B `S/final1b`, the extras `S/final1x`)
Tree `S/tree_final` (made 09:55, typechecks) = HEAD + the LIFE lane's 16 working files frozen then (the live tree typechecked; they include R6_SHELL_open_s2.patch,
applied by R7_LIFE, and their B04 self-use work) + my lane's working files + `flip_s3.sh` (all five later places shipped). In three jobs (each must finish inside one
2-hour background slot; my 09:20 job was cut at its 30-minute default): **A** = FIX5 R2.6's 32 sections exactly (the published ones + pg-playthrough, pg-phone,
pg-home5, console-and-network: the set behind 497/509); **B** = pg-places, pg-places-phone, pg-places-s3, pg-places-s3-phone + console-and-network; **C** =
trophies_check (game), lock_browser, photo_check (dev, phone, standalone), b4b_checks.

### 5A. Part A (`S/final1a`, 09:55:46 to 11:06:29): browser_shell **505/510** (FIX5 R2.6: 497/509; round 4: 494/497)
Per section (ok / FAIL): desktop-boot 18/0, mouse-gestures 19/0, shift-pull 9/0, shift-hint-reflow 3/0, shift-touch 2/0, settings-panel-desktop 15/0, hoard-loop 34/0,
toolbar 12/1, snap-mat 9/0, cut-real 10/2, toolbar-phone 6/0, toolbar-gravity 41/0, toolbar-grid 48/0, toolbar-sweep 32/0, toolbar-k04 6/0, cut-touch 4/0, cut-x 15/0,
fix2-dock 5/1, cut-swell 3/0, cut-low 2/0, hoard-phone 8/0, menu-pause 20/0, fullscreen-gate 3/0, toasts 8/0, modal-layers 4/0, ui-sounds 7/0, keyboard-only 12/0,
prod-build 9/0 (G0 2501 KB of 3 MB, G0b 466 KB gzip of 600, later-life **58.2 KB** of 150: the `later-brain` split), **pg-playthrough 26/1, pg-phone 10/0** (+1: round 6's
pill-wrap row, passes with 2c's one-unit count), **pg-home5 1/0** (worst pair 2.8 %), console-and-network 104/0. 510 rows (FIX5's 509 + that pill row).
The 5 FAILs, each classified:
- (1) toolbar "the caption chip goes after about 1.4 s": **load timing**, FIX5's (1) and round 4's final-run FAIL exactly (FIX5 R2.11 measured the 1.4 s timer firing
  on time when the page is free; SwiftShader frames of up to 3 s while the life chunk and Home's things compile).
- (2, 3) cut-real "a quick switch reconnects at once" (`tsw {p:2, x:1}`) and "hidden 30 s ... over 60 s comes back whole" (`short 3, long 1`): **the PC's own on this
  machine**, the same numbers as FIX5's (2, 3), round 4 and the PC's published tree 9211d66ba (round 4's A/B). (s2run1 passed both, 12/0: they come and go.)
- (4) fix2-dock "small landscape 568x320 ... the Snap strip (the two pieces still out) under 5 % of each": `snapPiecesOut worst 0.095, per [0.095, 0.095]`, the SAME
  numbers as s2run1's (FIX5: 0.035 / 0.019): **not a flake** on this tree; the shot (`snapstrip_small_568x320.png`) shows the two halves' tops under the strip's
  bottom edge (y 107). My lane's framing change cannot reach it (`ballFrames` needs a portrait frame and one whole body). A/B below (5A').
- (5) pg-playthrough "PG Home: a click on the Music Box plays its tune": `tap1 "body"` again, after my s2run1 wait (`pgClear`, 15 s of sim): the shot 40 s in
  (`pg_home_party_desktop.png`) shows Dollop (the orange one) standing in front of the box, covering all of it, and it stayed there the whole wait (s2run1 had
  a squishy there too). The product's press is right (it is the squishy's). **What it is: a Home layout overlap.** With three out the party's slots are
  x = 1.455, 0, -1.455 at z 0 (the row's own log, `PG party`), and the Music Box's spot is (2.25, -1.05) slot units, right behind the first slot from the
  1280 x 800 camera (box centre (1160, 321), Dollop's disc about (1120, 330) r 130 px): while the party rests at its slots the player cannot click the box.
  A harness way round it was tried and **reverted** (5A'): the row stays a FAIL, reported, with a request (LIFE/DATA lane: Home's spots).

### 5A'. After part A: the fix2-dock A/B and fix, the insets reading, the pg-playthrough try (11:07 to 11:25, one job after another on 5366)
- **fix2-dock alone on git-archived trees** (`S/dock_ab.sh`, `git archive <commit>` + the working node_modules, each tree's own harness; the section's code is
  identical from 559efebe4 to HEAD): HEAD 99d081c14 **FAIL 0.095 / 0.095**; HEAD + my lane FAIL 0.095 / 0.095 (so not my lane); the live release 23c684a60
  **ok 0.035 / 0.019**; round 5's end 559efebe4 ok 0.035 / 0.019 (FIX5's numbers); **HEAD with 23c684a60's hudBinding.ts ok 0.035 / 0.019**: the cause is
  round 6's hint-pill inset (hudBinding.reportInsets, "count the hint pill in the HUD insets"). hud.css hides the pill (`visibility: hidden`) for the whole Cut
  and Snap tool session, but its layout box still has a height, so its empty slot was counted: at 568 x 320 the strip layout hangs it at the bottom (its top
  at about 216 of 320), the camera pulled back and aimed higher, and the halves' tops went under the Snap strip.
- **Fix (src/shell/hudBinding.ts, one condition)**: the pill counts only while neither the Cut nor the Snap tool is in hand (the 'tool' handler already reports
  the insets again on every tool change). With the Hand (where the pill shows) nothing changes: R6's cabin Rocker Board row and the insets reading below keep it.
  **Checked**: fix2-dock alone on HEAD + my lane with the fix: **ok 0.019 / 0.019**. The sections a Cut / Snap session touches run again on the final tree
  with the fix (part A2, below).
- **Insets** (R7_LIFE's request): 1280 x 800 bottom **130** (the pill at 670), 390 x 844 bottom 174, top 56 on both (the Requests section, LIFE (6)).
- **The Music Box row, a harness try, reverted**: `pgUncover` (when a squishy still covers the box after the wait, lift it aside by a real carry, then click)
  on the final tree (`S/final1a_pg`, pg-playthrough alone, 25/27): the Music Box row passed (tap1 "musicbox", the tune on and off), but the lift became a
  STRETCH (`carried: false`, the outward pull ran out of room above), which stamped H3 "A big stretch" early (and two stretch trophies), so the tracker pill
  pointed at H6, which the wish tap then completed: two published B3 pill rows FAILED ("shown": false). A harness move that changes the published flow is not
  acceptable: browser_shell.mjs is part A's again (only a comment added at the row naming the layout overlap). The row stays the one real FAIL above.
- The final tree since 11:07: + the LIFE lane's brain.ts of 10:04 (their asked-use fix, R7_LIFE section 1; typechecks) and, since 11:25, my hudBinding.ts
  fix and the reverted harness. Parts A2, B and C run on it.

### 5A2. Part A2 (`S/final1a2`, 11:25 to 11:49): the sections a Cut or Snap tool session touches, again, with the fix: **148/150**
toolbar 13/0 (the caption timing row passed this time), snap-mat 9/0, cut-real 10/2 (the PC's two, as in part A), toolbar-phone 6/0, toolbar-grid 48/0,
toolbar-sweep 32/0, cut-touch 4/0, cut-x 15/0, **fix2-dock 6/0** (568 x 320 Snap strip: fixed), cut-swell 3/0, cut-low 2/0.
**Part A with A2 in place of its sections: 505 + 1 (fix2-dock) + 1 (the caption row) = 507/510**; the 3 FAILs left: cut-real's two (the PC's own on this
machine) and the Music Box row (the Home layout overlap, request LIFE (7)).

### 5B. Part B (`S/final1b`, from 11:49, the final tree with the fix): every place section
**pg-places (desktop, 20.5 min) 16/5, pg-places-phone (26 min) 16/5** (R6_SHELL's S2 rows: never run whole before; s2run1 stopped in the desktop one).
Passing on both frames: the Places sheet (my re-spec), each place's arrival by the sheet (three out, the layout, "You are at ...", the VISIT stamp), **"on their
own (no input) ... at least three different things" at all three places** (the LIFE lane's B04 self-use: s2run1's Ripple failed it), G7, the Leaf Teeter's
Auto chip, home again x3, 0 console errors; R3 and I9 on the desktop; R9, I7 and the opening row on the phone. The FAILs, classified:
- the opening row (desktop: `"live": ""`): read before the lines came (they come 1.5 s after the attach): **harness, fixed** (waits up to 15 s for the lines
  and moments before it reads them, as my S3 row; assertion unchanged).
- R9, I7, I4 (desktop): carries ended 0.6 to 2.4 m short of things at the BACK (the Sand Mound at z -1.75, the ramp's top, the pine's branch at z -2): the
  hand's drag plane faces the camera, so the squishy that happened to come first (at the front) could not be taken that far back before the pointer ran out
  of frame: **harness, fixed** as a player does it: the squishy NEAREST the spot, and a short carry is picked up again where it landed and carried on (up to
  two more; every carry logged). (R9 and I7 passed on the phone.)
- R3 and I9 (phone): tapped at the positions read before the stay, after a squishy had walked the row by itself (LIFE's RING) and set it swinging: 1 of 3,
  4 of 5: **harness, fixed** (pgClearPart: each tap at the part's position now, on one no squishy covers, as the S3 lanterns).
- I4 (phone): the pine's tap hit the squishy set under its branch (`"tap": "body"`, as it should; I4 itself completed): **harness, fixed** (an uncovered
  part: trunk or branch both poke it; the same for the Drip Leaf).
- R7 (both): Wisplet set in the Rock Pool (err 0.009) walked out of the water within the 24 s wait (`pg_ripple_squirt_desktop.png`: dry, at the Driftwood
  Log): its soak never reached 0.6 (a marshmallow soaks 0.06 a second: about 10 s in the water), so no squirt: **LIFE lane request** (8) below.
- G4 (phone): three carries, two of them right over the Moss Bouncer (err 0.02), and no bounce at all (`have 0`; the desktop 3 of 3): not measured further;
  likely the drop height (a carried body is held at about its rest height over a pad toward the camera in the tall frame). Not fixed (request below).
The fixed harness runs both S2 sections again after part C (`S/final1b2`, 5B').

## 3-old. (notes written before the measurement)
probe_pg_data's DT-01 "Home B5 one out" proves no data spot can work with the shipped camera ("3597 spots tried"), so the render option: `stage.ts ballFrames()`: on a
portrait frame, at Home, with exactly ONE whole body shown and the ball shown (`setHomeThing(0)` now remembers its spot), the ball's SPOT (never its live position) counts in
`framingFor` like a waiting capsule (`solo`: pull back and aim between the two); the camera and `visibleTable` (the ball's bounds) both use it, so the ball stands at its
tall spot (0.76, 1.06) beside the squishy. Expected cost (hand calculation from framingFor): the one-body portrait framing pulls back about x1.3 (the squishy ~23 % smaller
on a phone with the ball out). To be measured in the browser before it is kept.

## Not done, and known issues (kept current)
- Cloudloft's pale squishies on the near-white cloud tops: measured, read softly (top edge 1.36 : 1), not changed (requests, Render).
- R6's leftover on a phone: the tracker pill and the right column over the top of the TALL cabin's kettle and the hearth's right third (section 4): not changed.
- The over-budget rule's choice of body (LIFE's "for information"): not changed (2a'').
- `perchDown` covers block things only; a squishy set on another tall static part (Cloudloft's Sunbow Arch top bar) is not lifted down.
- A straight drag up the TALL frame lifts a squishy more than it takes it back: the harness reaches the back of the tall layouts with a waypoint or the front pad;
  a player tosses. The gesture's carry plane is not this lane's change this round.
- probe_pg_data's three known FAILs stay (Home B5 one-out until the LIFE lane's camera model gains `ballFrames`; Hearthlog tall; Cloudloft tall spawns).
- ~~fix2-dock's 568 x 320 Snap strip row~~: not a flake, a round-6 regression (the hint pill's hidden slot counted in the insets): FIXED in hudBinding.ts (5A').
- The published row "a click on the Music Box plays its tune" FAILS in the final run: Dollop at its party slot covers the box on a desktop with three out
  (5A (5)): a Home layout overlap, request LIFE (7); a harness way round it changed the published flow and was reverted.

## Requests to other lanes (kept current)
- **LIFE lane (src/data, probe_pg_data)**: (1) DT-01 "Home B5 one out" models the camera: once the render's `ballFrames` is kept, the probe's model needs the same rule
  (its row says so: "then this model gains that framing"); (2) ~~Lanternroof WIDE: the hammock hides the Vane Disc~~ checked on the shots, nothing needed: the place
  camera looks 0.6 rad down (not 8.6 degrees), the disc shows behind the hammock's posts (`pg_lanternroof_vane_desktop.png`) and a tap reaches it (s3run2: (970, 344)).
  (3) The Vane Disc TURNS now (the host turns it with the Night Breeze's gust and after a poke; `world.ts selfUseOf` still says "the turntable (not built in physics:
  it would not turn)"): a squishy standing on it while a gust blows rides it (the host writes USE SPIN by SELF, L4), so B04 may send one to stand on it by itself
  (walk onto its spot, stay through a gust: the spot is `def.things[k]` / tall; nothing else is needed from the shell).
  (4) Done for you (2a''): LIFE's own get-on is lifted without the player's mark (`INTENT.USE` b 1) and `lifeSetSelfRides(w, true)` is called (looked up by name).
  (6) **Your section 3's question, measured** (`S/insets.mjs`, the final tree, `stageInfo().insets` = what hudBinding.reportInsets sent): on **1280 x 800** the
  reported bottom row is **130** (top 56): the hint pill hangs at 670..706 and is counted (the dock's row starts at 732, so without the pill it would be 68),
  at Home 1.5 s and 9.5 s after the first play and at the cabin 4 s after travel; on 390 x 844: top 56, bottom **174** (your model's number). So the desktop's
  STAGE_INSETS bottom is 130 while the Hand is the tool (with the Cut or Snap tool in hand the pill is hidden and, since round 7's fix in 5A', not counted).
  (7) **Home's Music Box behind the first party slot** (5A (5)): with three out the party rests at x = 1.455, 0, -1.455 (z 0) and the box's spot is
  (2.25, -1.05) slot units: on a 1280 x 800 desktop Dollop at its slot covers the whole box (the published row "a click on the Music Box plays its tune"
  FAILS on it twice: s2run1 and the final run). A spot clear of the three slots' screen discs from the wide camera (further right or further forward), or a
  probe_pg_data row "no Home thing hides behind a party slot", would settle it; the render's slot spacing is published (B8 Home 5 rows), so I left it.
  (8) **R7 "A squirt for a friend" cannot complete in the browser**: Wisplet, set by the player in the Rock Pool, walked out of the water before it soaked
  (part B, both frames: soak 0 after 24 s; on the desktop it was at the Driftwood Log). A squishy the player has just set in water should stay there long
  enough to soak (a marshmallow needs about 10 s), e.g. no new B04 use for some seconds after a player's carry (`setT` is the host's; LIFE sees CARRIED end).
  (9) **G4 on the phone: drops onto the Moss Bouncer did not bounce** (0 of 3; the desktop 3 of 3): with PADS_OK off this is the pad's kick from the player's
  drop alone; worth a node row with the tall layout's pad and a drop from the carry's height.
  (5) For information: src/life/** is its own lazy chunk `later-brain` now (vite.config.ts, 2b), loaded with the life chunk; nothing to do on your side. Your
  application of `R6_SHELL_open_s2.patch` to the working files is noted: my `R7_SHELL_open_s3.patch` is made against the working files (S2 shipped) and is
  checked with `git apply --check` there.
- **Orchestrator**: `_handoff/reports/R7_SHELL_open_s3.patch` ships Lanternroof and Cloudloft (`shipped: true` in places.ts PLACE_INFO and both PlaceDefs); apply it
  from the repo root on the working tree as it is (with R6_SHELL_open_s2.patch already applied by R7_LIFE). Whether to ship them is the owner's call (section 5's run
  is with all five open in a scratch copy).
- **Render (src/render is this lane's this round; left for a measured A/B next round)**: Cloudloft's pale squishies (Wisplet) read softly against the near-white
  cloud tops (2d (3)); a dimmer cream rim at Cloudloft (`light().rimI` 2.6 and the "cream rim" panel) would darken their top edges. Not changed blind: R6_RENDER
  tuned that light over six shot rounds, and this round's one machine slot went to the final run.
