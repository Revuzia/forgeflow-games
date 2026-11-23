# VERDICT_R14: independent check of Squish Keeper round 14 (bigger rooms, carry, multicut) before a deploy (2026-11-23)

**VERDICT (15:59 UTC): NOT READY to deploy. BLOCKER F1: a physics guard newly red (probe_softbody per-family hostile fuzz: a slime body inverts and goes NaN; the live tree passes; bisected to the raised Float hover HOVER_ABOVE 0.6). MAJOR: Home's things now sit outside the camera's view and the party uses 1 to 2 of them (live: 2) (F2); a carry let go by Home's back rim jumps 4 m (F3); 9 node_checks rows newly red, not re-specified (F4); the set-down no longer starts the Updraft float / ramp glide (F5). PASS: build gates (T1 2144.3 / 2250, first play +3.6 KB), regression (23/23, 21/21, saves both ways, one-out cut same as live, 0 errors), MULTICUT ready, CARRY first try 66 of 68 at the places, rooms 2.6 to 3.0 times with 3 to 5 things used at the six places.**

Verifier: independent; wrote no file in `src` or `_harness`, ran no git write command.
Tree checked: a copy (tar, excluding node_modules / dist / _shots / _renders / _live_snapshot / _handoff) of the working tree at 13:06 UTC
(HEAD fed9853ab + uncommitted round 14 edits, 70 paths in `git status`); `diff -rq` of src / _harness / vite.config.ts / index.html against G at copy time: empty.
Reference ("live"): `git archive 6c495e9c1` (the build that is live now), built in scratch.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify_r14/` (`S/` below): `snap/` (the copy), `live/` (6c495e9c1),
`scripts/` (R12's, copied), `logs/`, `shots/`.
Ports: 5370 dev of the copy, 5371 prod of the copy (static), 5372 live prod (static), 5373 live dev.

## How to continue if cut off
Never redo a check marked DONE below. Scripts in `S/scripts/`.

## Checks
### (1) Build, tsc, sizes, node probes (DONE 13:18 but the live hostile-fuzz comparison; logs `S/logs/tsc.log`, `build.log`, `build_live.log`, `probes/`)
- `tsc --noEmit -p tsconfig.json`: **exit 0**. `vite build` of the copy: **exit 0**; of 6c495e9c1: exit 0.
- Sizes (copy vs live 6c495e9c1, same machine, same vite): `[G0]` 2565 vs 2532 KB of 3072; `[G0b]` 465 vs 464 KB gzip of 600; **`[T1]` 2144.3 vs 2111.1 KB of the 2250 cap: pass, +33.2 KB, 105.7 KB headroom**.
- **First play** (`fp.py`: html + every non-`later-`, non-`life_` asset): **1523.4 KB raw / 467.0 gzip vs live 1519.8 / 465.7: +3.6 KB raw, +1.3 gzip** (the room camera, carry rest and party cutter ride lazy chunks: `later-life` 88.4 vs 73.8, `later-lifelook` 30.5 vs 23.8, `later-shared` +~2).
- Live reference for the node probes: R13's final run of 6c495e9c1 (`scratchpad/final13/`): node_checks 185/186, probe_app 188/188, probe_gestures 160/160, probe_cut 17/17, probe_float 16/16, probe_crawl 14/14.

| Probe (on the copy, one at a time) | Result | vs live |
|---|---|---|
| probe_gestures | 176/176 | 160/160 (+16 rows) |
| probe_carry (new) | 11/11 | new |
| probe_partycut | 27/27 | 10/10 at R12 (re-specified for D-103) |
| probe_app | 188/188 | same |
| probe_party | 10/10 | same |
| probe_merge | 22/22 | same |
| probe_pg_data | 95 ok / 0 FAIL | DT-18 was a known FAIL at R12: now passes |
| probe_float | 16/16 | same |
| probe_playground (quick) | 74/74 | same |
| probe_cut | 17/17 (148 s) | same |
| **probe_softbody** | **114/116: G1 per-family hostile fuzz FAIL ("slimegoo/wrigglo: inverted mesh @frame 169 ... volume NaN"), G1p 515 B vs 512 (allocation, information)** | G1's wrigglo row was ok in every earlier log in scratch (6 logs, rounds 4 to 8). **Re-run of the per-family hostile fuzz alone (`--families-hostile`, 13:46): LIVE 2/2 pass (71.5 s); NEW 1/2: the same slimegoo/wrigglo inversion at frame 169, volume NaN** (`S/logs/HOSTILE_{live,snap}.out`): **a physics guard newly red in round 14** |
| **shellview/node_checks** | **176/186: 10 FAIL** | **185/186: 9 NEW reds** |

The node_checks reds (`S/logs/probes/shellview_node_checks.ts.log`); only 2 rows were re-specified for round 14 (piece cap, Home carry); these were not:
1. "a place's framing reaches its front things" (cabin tall 3.3 m / wide 2.4 m): tall 4.300, wide 3.040: a row pinned to the old room sizes (stale data row).
2. "thing taps: a click on the Music Box plays its tune": the click lands on the Felt Ball (tap1 feltball), no tune.
3. "(round 9) Home: a still click on the Music Box behind a RESTING squishy goes to the box": tap feltball, no tune.
4. "D-95 AUTO: the cabin offers one control each for the Pillow Swing and the Rocker Board ... on screen": only the swing's chip ([["pillowswing",false,640,121]]).
5. "(round 6) Go play with... on MED with 3 out" (red on live too: the known one).
6. "(round 7) Lanternroof: the Vane Disc turns while the breeze blows and the squishy standing on it rides it": used [], riders 0.
7. "(round 7) Lanternroof's taps: Star Scope sends the comet": the tap lands on `dripleaf`, no comet.
8. "(round 7) Lanternroof: a squishy set on top of the Chimney Corner hops down within 5 s": stayed at y 0.476 beside? (x -2.469).
9. "(round 7) Cloudloft: a squishy dropped onto a Puff Pad bounces ... Updraft LIFT": used [], reacted [updraft].
10. "(round 8) Cloudloft: a squishy set on top of the Sunbow Arch rests on it, then is set down": onArch 0.
Rows 2-4 and 6-10 test player-facing behaviour at positions that moved with the bigger rooms; whether the product or the row is wrong is judged by real input in (3) / (4) below.

### (2) Regression vs the live build 6c495e9c1 (RUNNING; scripts `S/scripts/runR14.sh` phases; logs `S/logs/`)
Method: R9 / R12's scripts. The live reference for the published steps is R13's final arun of the 6c495e9c1 build (`scratchpad/final13/A_new_{desk,phone}.out`, run on
G/dist built at the commit's minute, 2026-11-19 16:46), copied to `S/logs/A_live_{desk,phone}_f13.out`.
- **Cut with ONE squishy out, desktop** (`cut1.mjs` on each tree's dev server, life attached; `S/logs/CUT1_{new,live}_desk.json`, `cmpCut1.py`): pieces 2, 3, 4, 5, 6, 7 on both;
  particles 1284 / 966 / 648 / 810 / 972 / 1014 on both; fractions equal within 0.001, the last sliver of the sixth cut 0.020 vs 0.021 (0.217 vs 0.215 beside it: the
  piece moved a hair, the stroke is aimed at the biggest piece's centre); **phone: IDENTICAL** (pieces, particles 1284 / 966 / 648 / 810 / 972 / 1134, every fraction); the same lines ("Cut into 4 pieces. Silver trophy: Four Little Ones."); Reconnect all 642
  particles, "Whole again." on both; 0 errors. **Same as live** (the same tolerance R12 accepted).

- **A_new_desk (1280x800, prod build of the copy): 23 of 23 published steps ok, 0 console / page / request errors** (392 s; `S/logs/A_new_desk.out`, shots
  `S/shots/A_new_desk_*`). `cmpA.py` vs live: only the random capsule / merge results differ (Glugbean / Hooplet vs Wisplet / Puddlo); Cut "Cut into 2 pieces. Bronze trophy:
  Clean Cut.", Reconnect "Whole again." (the live run's arun missed that line: timing), lock "Locked in place." / "Let go. Silver trophy: As Far As It Goes.", Float
  "Floating" / "Table": the same lines. One line absent: "Hearthlog Cabin is open. Find it in Places." (live's desktop run got its first wish late, in the keyboard
  step; this run got no wish: journal `pl 1, wi []`; live's own PHONE run also ended with `pl 1, wi []`): timing of the first wish, not counted as a finding.
- **A_new_phone (390x844): 21 of 21 steps ok, 0 errors** (323 s). Differences from live: random capsule / merge only (plus the merge trophy line landing one step later).

- **Saves crossing both ways** (`loadsave.mjs`, prod builds; `S/logs/LS_*.json`, shots `S/shots/LS_*`): R12's `seed_p3` (6 owned, 45 stamps) played on the LIVE build
  (Journal, Places sheet, "Go to Hearthlog Cabin": "New stamp: Come in from the snow") -> its save on the NEW build: **"46 of 80 stamps"**, all seven Places cards open
  with "Go to" (`home..cloudloft :true`), the cabin card "1 of 10 stamps", the play squishy Glimglop Legendary, the trip to the cabin works (the room's "Drag to carry"
  tip appears once); -> that new save back on the LIVE build: "46 of 80 stamps", seven open, the trip works. 0 errors in all three.
  The settings / hoard chain (`savetest.mjs`): R13's live arun save (`store_L0_live_arun.json`) -> new (A1) -> new with "Squishies move on their own" switched off (A2)
  -> LIVE (A3) -> new (A4): the same play squishy (Puddlo, Common), "Hoard, 2 of 50 species, a gift is waiting", shelf (Puddlo, Wisplet), Trophies 8 / 20, the same hoard
  ghosts (`g-oiay9e:8, g-mdpf53:3`) in all four; the stored `autonomy: false` survives the trip through live and back. 0 errors in all four.
  **Saves: PASS both ways.**
- **Cut / reconnect lines** (`crun.mjs`, prod, one out; `S/logs/C_new_{desk,phone}.out`): on both frames "Cut into 2 pieces. Bronze trophy: Clean Cut.", "Whole again.",
  "Bronze trophy: Whole Again.", "Cut into 2 pieces.", "Whole again."; 0 errors (as R12 on the live line).

### (3a) Bigger rooms: floor area by the data (DONE 13:25; `src/data/place_*.ts` of both trees, rounded-box area 4 hx hz - (4 - pi) round^2)
| room | live (6c495e9c1) | new | ratio |
|---|---|---|---|
| Home (disc; one out keeps the published camera, the room is used with 2+ out) | r 3.4 m: 36.3 m2 | r 5.5 m: 95.0 m2 | **2.62** |
| the six places, wide (desktop) | 6.8 x 4.8 m: 32.1 m2 | 11.0 x 7.8 m: 84.3 m2 | **2.63** |
| Hearthlog tall (phone) | 2.5 x 6.0: 14.9 m2 | 4.6 x 9.8: 44.7 m2 | **3.01** |
| Ripple / Frostbell / Rainleaf / Lanternroof tall | 2.8 x 6.0: 16.7 m2 | 4.6 x 9.8: 44.7 m2 | **2.68** |
| Cloudloft tall | 3.6 x 6.0: 21.5 m2 | 5.8 x 9.8: 56.5 m2 | **2.63** |
Volume: walls (cabin, Lanternroof) 2.4 -> 3.4 m (`props.ts WALL_H`); fastest toss 6 -> 7.5 m/s (`softbody.ts TOSS_MAX`: a straight-up toss peaks 1.83 -> 2.87 m);
Float hover 0.35 -> 0.6 m over rest; pad apex cap 0.35 -> 0.5 m (Home pad, Moss Bouncer 0.42). Every room is over the brief's 2.5 times.
NOTE (published toy, one squishy out at Home): TOSS_MAX and the Float hover are global, so with ONE out a toss can fly 25 % faster and Float hovers 0.25 m higher than live;
the felt is drawn r 5.6 m (was 3.5) and the wheel zooms out further at Home alone (`stage.ts` tZoom max). By design (D-104) but they touch the published toy.

### (3c) MULTICUT by real input (`S/scripts/mc.mjs`: Home, 3 out by the Hoard, LOW tier, sim stepped between real mouse / CDP-touch events; strokes are real drags with the Cut tool; logs `S/logs/MC_{desk,phone}.json`, `sumMC.py`; shots `S/shots/MC_*`)
**Desktop (DONE 13:51, 0 console / page errors):**
- Crimpo cut alone: "Cut into 2 pieces. Bronze trophy: Clean Cut."; then a stroke across Glimglop (the play squishy) **while Crimpo is in pieces: cut** ("Cut Glimglop into 2 pieces."),
  no "One squishy at a time" anywhere; the Cut bar shows "Reconnect one" with a chip per cut squishy ("Reconnect Glimglop (2 pieces)", "Reconnect Crimpo (2 pieces)", 32 px
  tall; `S/shots/MC_desk_cutB.png`).
- **ONE stroke across all three**: "Cut Dollop into 2 pieces. Cut Glimglop into 3 pieces. Cut Crimpo into 3 pieces." (8 pieces; `MC_desk_three.png`: the chips row reads
  well; the two red / fiery squishies' pieces stand in one heap in the middle and are hard to tell apart, MINOR look). (My "across two" stroke also caught the third,
  which stood behind the second on screen: by the rule "every squishy the stroke crosses".)
- **Reconnect one** (a tap on Glimglop's chip): Glimglop whole 0.25 m from where it stood when cut ("Glimglop is whole again. Bronze trophy: Whole Again."), the other two
  stay in pieces. **Reconnect all**: every one whole at its own spot (0.25 / 0.32 / 0.00 m off), at least 1.28 m apart, "Crimpo is whole again. Dollop is whole again.".
- **Pieces never cross-merge**: with the Hand, a piece of one squishy dragged onto a piece of another and held 2 s: pieces 2 / 2 / 2 before and after.
- **Float with three cut**: all six pieces rise (0.28 -> 0.78, 0.87 -> 1.35 m ...), still 2 / 2 / 2; Table brings every piece down.
- **The budget**: strokes across all three: 8 -> 11 -> 12 pieces, then the Cut bar's line itself reads **"12 pieces is the most at once. Reconnect one to cut more."**
  (on screen: `.cutbar-text`, 277,595, visible; `MC_desk_budget.png`); a further stroke cuts nothing past 12.
- Hiding the tab 5 s keeps the 12 pieces; **leaving** (Places sheet to the cabin) with 12 pieces: the party arrives WHOLE (3 out, 1 / 1 / 1), back Home whole.
- Arranging the row first took three carries: two picked up at the first press, the third not (its press point lay where the play squishy overlapped it; see (3b)).
**Phone 390x844 (DONE 13:52, CDP touch, 0 errors):** the same story: Glimglop cut, then Dollop cut while Glimglop is in pieces ("Cut Dollop into 2 pieces.", chips with
faces and counts, names hidden at this width); one stroke across all three: "Cut Dollop into 3 pieces. Cut Glimglop into 3 pieces. Cut Crimpo into 2 pieces."; Reconnect one
(Dollop's chip): whole 0.07 m from its spot, the others stay cut; Reconnect all: whole (0.01 / 0.25 m; the third, 1.29 m, had walked before its first cut: my
reference spot was taken earlier, not a fault); a piece dragged onto another squishy's piece: 2 / 1 / 2 before and after (no merge); Float with two cut: every piece
rises and comes down on Table; the budget at 12: **the toast "That's 12 pieces out, the most at once. Reconnect a squishy to cut more." at the top** (`MC_phone_budget.png`;
the bar's own line is hidden at this width); tab hidden 5 s keeps pieces; leaving to the cabin arrives whole, back Home whole.
Judged as a designer (`MC_phone_budget.png`): with 12 pieces out at Home on a phone the camera has pulled back so far that the pieces are about 25 to 45 px across and the
three squishies' pieces read as one jumble in the left half of the felt; MINOR (the room camera keeps every piece in view at the cost of size).
**MULTICUT: READY on both frames** (the owner's complaint, "told to recombine to cut another", is gone: no refusal in any run; strokes across two / three, per-squishy
Reconnect, budget line shown, no cross-merge, leave / hide / Float all fine).

### (3a) Bigger rooms in the browser (`S/scripts/rooms_cmp.mjs`: Wake, 3 out by the Hoard, LOW tier, every place by the real Places sheet, 8 s settle; on the new build also the
wheel / pinch to the whole room and to a close view, a Shift + right-drag / two-finger pan, the room's corners projected; the SAME script on the live build's dev server;
`S/logs/RC_{new,live}_{desk,phone}.json`, `sumRC.py`, shots `S/shots/RC_*`)
**Phone 390x844, new build (DONE 14:36, 0 errors; the live phone comparison runs later, 4 places):** one out at Home r 85 px (the published camera);
3 out, the camera by itself: Home r 40-45 px (u 0.41), Hearthlog 32-33 (u 0.77), Ripple 34-35 (0.77), Frostbell 39-40 (0.68), Rainleaf 38-39 (0.70), Lanternroof 37-38 (0.72),
Cloudloft 40-41 (0.66); every squishy in frame; all four room corners in frame at the default view at 5 of the 6 places (Cloudloft 2 of 4).
Pinched out to the whole room: r 26-27 px and 4 of 4 corners at the five places; **Home 17-18 px** (the whole r 5.5 m felt on a 390 px screen: the squishies are
34 px blobs, `RC_new_phone_home_whole.png`); **Cloudloft: a turned, far view, r 13-14 px, two corners outside the frame** (`RC_new_phone_cloudloft_whole.png`,
`_pan.png`: the arch and the swing seen at an angle, the felt-less cloud floor filling the frame); not separated from a turn my two-finger pinch may have caused
(MINOR until reproduced; every other place's pinch kept the view straight). Two-finger pan at the whole view barely moves (the view is already the room; by design);
at Home the pan moved the view and eased back within 8 s.

**Desktop 1280x800 (DONE 14:11; 0 errors on both builds):** one squishy at Home: r 183 px at (640, 347) on BOTH builds (the published camera, untouched).
| place | squishy radius on screen, 3 out, the camera by itself (new / live) | ratio | view factor u | room corners in frame: default / whole-room view |
|---|---|---|---|---|
| Home (3 out) | 96-108 / 107-124 px | 0.87 | 0.57 | 3 of 8 / 8 of 8 (r 47 px) |
| Hearthlog | 79-82 / 77-82 | 1.01 | 0.62 | 1 / 4 of 4 (r 49) |
| Ripple | 67-72 / 77-87 | 0.82 | 0.72 | 2 / 4 of 4 (r 49-52) |
| Frostbell | 72-73 / 75-85 | 0.91 | 0.68 | 1 / 4 of 4 |
| Rainleaf | 73-77 / 79-88 | 0.88 | 0.67 | 2 / 4 of 4 |
| Lanternroof | 68-71 / 72-81 | 0.90 | 0.71 | 2 / 4 of 4 |
| Cloudloft | 66-73 / 71-83 | 0.88 | 0.72 | 2 / 4 of 4 |
Every squishy in frame on both builds at every place. The wheel zooms out to the whole room (u 1: every corner inside the frame, between the HUD rows: front corners at
y 617 just above the dock band at 618) and in to a close view (u 0.36, r 125-199 px); a Shift + right-drag pans (the view centre moves 1.2 m for 260 px, then eases back to the
party within 8 s). **On-screen size 82 to 101 % of live: the squishies still read clearly** (owner floor about 70 %).
Judged (`RC_new_desk_ripple_default.png`, `_whole.png`, `RC_new_desk_hearthlog_default.png`): the beach and the cabin read as bigger rooms with more between the things;
the camera by itself frames the party (the three stand bunched in the middle at arrival); at the whole-room view the front third of Ripple's sand is empty (only the
Pebble Ball): a MINOR "empty-looking" note; in the cabin's default view the fire and the Rocker Board are cut by the frame's edges (the camera follows the party, by design)
and the Rocker Board's end sits under "Put back"; both AUTO chips show.

### (3a / 3b) Per place: 180 s with no input, then CARRY by real input (`S/scripts/p14.mjs`; Wake, 3 out by the Hoard, LOW tier (unitCap 3.81, moverCap 3), the real Places sheet;
W = 360 stepped half-seconds, no input, things used by themselves (LIFE's selfUsed / reacted / social), 0.5 m floor cells visited, sleep; CARRY = for each of the three
squishies: press on its upper middle and drag at once toward the front-left spot (0.9 m inside the room's corner), steering it like a player watching it (the finger moves by
the gap between the squishy and the spot on screen, at most 40 px per 1/20 s), hold still 0.25 s, let go; then the same from front left to back right (the far corner);
the sim is stepped between real input events (the house method: SwiftShader runs at 3 to 6 fps in real time); logs `S/logs/P_<place>_<frame>.json`, `sumP.py`)
**Home, desktop (DONE 14:18, 0 errors):**
- W: things used by themselves **2** (Felt Ball, Snooze Rug; social at the rug); every squishy also asleep 46 to 68 s of the 180 s (NAP 169 s of 540 squishy-seconds);
  roamed 12.25 m2 of 0.5 m cells (of 95 m2), each up to 3.1 to 3.9 m from where it started; the camera kept all three in frame 100 % of the samples (view u 0.54 to 0.65).
  Home's things moved out to the rim (Music Box x 3.9, lamp x -4, pad (-3.2, 1.4)) while LIFE's reach at Home stayed 3 m (`brain.ts`: "Home keeps round 4's numbers"):
  the far things are not visited. (A live-build Home run for comparison is queued.)
- CARRY: **all 6 carries picked up at the first press** (in hand at the first move), the squishy reached the spot (0.19 to 0.28 m at release; the view scrolled under the
  hand in every one: 16 to 47 frames). **But after the let go the squishy did not stay where it was put in 4 of 6**: 0.65, 0.80, **3.54** and **1.97 m** away 2.4 s later
  (FL_to_BR_1: let go at (3.60, -3.61), resting at (2.84, -0.15); FL_to_BR_2: let go at (2.63, -3.20), at (2.23, -5.13) on the felt's rim); the heights after the let go
  pump 0.35 / 0.40 m (a crawl), so LIFE walked it off right away (autonomy on). Re-measured with a position trace at 0.4 s / 1 s on the next runs.
- Extras: a NAPPING squishy (asleep, IDLE) picked up by the same drag and set 0.12 m from the spot; FLOAT: a floater carried 1.3 m up, set down, **0 m drift 3 s later**,
  still floating; Home's Bounce Pad: carried onto the pad and let go: lands (0.61 -> 0.45 m) and rebounds only 0.08 m (Glimglop is slime: the family does not bounce).
- "Go play with... the Music Box" (name tag popover, real taps): "Dollop goes to play with the Music Box.", walks at 2 s, reaches it (0.66 m) at 15 s from 4.62 m away;
  asleep on 4 of the 30 samples of the walk.
**Home, phone 390x844 (DONE 14:21, 0 errors):**
- W: things used by themselves **1** (Felt Ball) + a reaction to the Warm Lamp = 2; asleep 64 to 97 s of 180 each; roamed 7.5 m2 of cells, at most 2.2 to 2.8 m from the start;
  all three in frame 100 % (u 0.41 to 0.50).
- CARRY: 5 of 6 picked up at the first press; the sixth press landed where another squishy stood in front of the intended one and carried THAT one (right by the rule:
  what is under the finger is taken). Each reached the spot (0.18 to 0.29 m at release); 2.4 s after the let go 0.49 to 1.06 m away.
- TWO FINGERS (phone): both squishies in hand together (10 of 10 samples), both carried about 6.5 m to the felt's far rim (one drag up the screen), set down there
  (`S/shots/P_home_phone_twofingers.png`: the two sit on the back rim, drawn against the dark backdrop; the Music Box and the lamp are cut by the frame's sides).
- A resting squishy (MOMENT) carried and set 0.33 m from the spot; Float: carried 1.4 m up, 0 m drift after 3 s; the Bounce Pad: set on it, rebound 0.05 m.
- "Go play with... the Music Box": said and walking at 2 s, but **not there after 20 s** (6.9 m away at the ask, 1.76 m at best): the asked walk across the bigger Home takes
  longer than 20 s on the phone (MINOR: the node_checks PLAY_WITH row is red on live too).

### (5) Sound (DONE 14:37; `node _harness/sound_survey.ts --port=5376` on the copy, 90 s; `S/logs/SOUND.out`)
76 sounds through the game's own master chain: **0 clipped samples, worst master peak -4.0 dBFS** (master 1.0), no silent sound; every place mix (Home and the six, master 0.8
and 1.0) `noClip: true`, master peaks -19.5 to -14.0 dBFS, voices (-38.2 dB RMS) 8.5 to 14.4 dB over the ambience; 0 page errors. One note: the thing "tick" starts with a
click (as R12's E1, MINOR, pre-existing). `src/audio` is unchanged since the live commit (`git diff 6c495e9c1 -- src/audio`: empty): no new risk. Nobody listened.
**Ripple Shore, desktop (DONE 14:45, 0 errors):**
- W: things used by themselves **5** (Pebble Ball, Drift Log, Rock Pool, Shell Chimes, Sand Mound; a reaction at the pool); roamed 16.5 m2 of cells, up to 5.6 m from the
  start (paths 12 to 20 m); asleep 48 to 68 s each; all three in frame 100 % (u 0.62 to 0.86).
- CARRY: **6 of 6 picked up at the first press and brought to the spot** (0.14 to 0.24 m at release; 9.2 m front-left to back-right); with the position trace: each LANDED
  0.34 to 0.62 m from where it was let go (about one squishy width; the body hangs from the finger at its top and drops) and stayed there (2.4 s later 0.25 to 0.70 m).
  Edge scroll: 1 to 15 steps at the frame's edge, the view moved under the hand on 3 to 15. (`P_ripple_desk_carry_BR_0.png`.)
- Extras: a napping squishy (NAP) carried and set 0.32 m from the spot; a floater carried and kept (0 m drift).
- Actions: carried into the Rock Pool (floats on the Bob Ring, y 0.88) and onto the Sand Mound (rests on it); "Go play with... the Sand Mound" said (Dollop already beside it,
  asleep through it); travel Home by the Places sheet: arrived in 9.3 s, 3 out.
**Ripple Shore, phone (DONE 14:48, 0 errors; two squishies carried):**
- W: things used **4** (Rock Pool, Drift Log, Pebble Ball, Shell Chimes; social at the ball); 13.75 m2 of cells, up to 3.8 m from the start; asleep 0.5 / 3.5 / 47 s;
  in frame 100 % (u 0.72 to 0.86).
- CARRY: 4 of 4 picked up at the first press and brought to the spot (0.02 to 0.29 m; front left (-1.4, 4) to back right (1.4, -4), 8.5 m); the hand rides 1.29 to 1.37 m
  high on the phone; landed 0.39 to **1.46 m** from where it was let go (the two back-right let-gos: by the Rock Pool's rim, it slid into the water: ZONE).
- TWO FINGERS: both in hand together (10 of 10 samples), both moved about 3.5 m, set down. A resting one carried (0.43 m from the spot); a floater kept (0 m drift).
**Cloudloft, desktop (DONE 14:57, 0 errors):**
- W: things used **3** (Cloud Ball, Sunbow Arch, Kite Swing; social at the swing); 21.5 m2 of cells, up to 5.6 m from the start (paths to 27 m); asleep 23 to 48 s; in frame 100 %.
- CARRY: 6 of 6 at the first press, to the spot (0.05 to 0.27 m), landed 0.31 to 0.65 m from the let go, stayed.
- Puff Pads: carried onto them and let go slowly: it sinks in (0.82 -> 0.44 m) and is kicked up 2 s later (0.91 m). **Updraft: carried in and let go: it is SET DOWN
  (0.52 -> 0.40 m), no float**: the level carry holds a squishy about 0.2 m over the floor and a slow let go sets it down, so the published "let it go high in the Updraft and it
  floats down" (stamp U3 "Float down slowly") no longer follows from a carry; a re-check with the hold-then-pull lift is queued.
- "Go play with... the Kite Swing": walks at 0.5 s and reaches it from 7.96 m in 3.5 s (no sleep on the way). Travel Home: 13.3 s, 3 out.
**Cloudloft, phone (DONE 15:00, 0 errors; one squishy carried):** W: things used **5** (Puff Pads, Cloud Ball, Kite Swing, Cloud Nest, Sunbow Arch) + a reaction to the
Updraft; 21.5 m2 of cells, up to 4.2 m; asleep 10 to 52 s; in frame 100 %. CARRY: 2 of 2 at the first press, to the spot (0.19 / 0.22 m), rested 0.37 / 0.69 m from the let go.
**Frostbell Ridge, desktop (DONE 15:08, 0 errors):**
- W: things used **5** (Snowball, Glide Ramp, Ice Pond, Icicle Bells, Steam Pool); 19 m2 of cells, up to 5.5 m (paths to 28 m); asleep 27 to 50 s; in frame 100 %.
- CARRY: 6 of 6 at the first press, to the spot (0.12 to 0.22 m), landed 0.27 to 0.84 m from the let go (three BR let-gos end RIDING a thing).
- Glide Ramp: carried to the ramp's top end and let go slowly: **it stays at the top** (y 0.58 for 2.4 s, 0.2 m from the spot): no glide down (the set-down zeroes the
  speed; the published pick-up dropped it with speed). Ice Pond: set on the ice, crawls there. "Go play with... the Snowball": walks at 2 s, there at 15.5 s from 4.75 m.
  Travel Home 12.4 s, 3 out.
**Frostbell Ridge, phone (DONE 15:11, 0 errors; one squishy carried):** W: things used **4** (Snowball, Steam Pool, Glide Ramp, Ice Pond); 14 m2 of cells, up to 5.2 m;
asleep 27 to 65 s; in frame 100 %. CARRY: 2 of 2 at the first press, to the spot (0.05 / 0.14 m), rested 0.66 / 0.83 m from the let go (the hand rides 1.0 to 1.2 m high).
**Rainleaf Garden, desktop (DONE 15:18, 0 errors):**
- W: things used **3** (Leaf Teeter, Seed Pod, Stepping Stones) + a reaction to the Drip Leaf = 4; 21.75 m2 of cells, up to 5.0 m; asleep 22 to 50 s; in frame 100 %.
- CARRY: **5 of 6** at the first press, to the spot (0.05 to 0.29 m), landed 0.30 to 0.64 m from the let go. **The sixth (front left -> back right, the third squishy,
  standing on the Stepping Stones in the front-left corner, LIFE: USE) was not picked up by the press on its upper middle** (nothing in hand; nothing else taken):
  not a first-try success (MINOR: a squishy using a thing in a corner).
- Moss Bouncer: set on it, it sinks (0.67 -> 0.44 m) and is kicked up 1.8 s later (1.05 m). Drip Leaf: set under it. "Go play with... the Leaf Teeter": there in 3 s
  from 7 m. Travel Home 9.3 s, 3 out.
**Rainleaf Garden, phone (DONE 15:20, 0 errors; one squishy carried):** W: things used **4** (Seed Pod, Leaf Teeter, Splash Spots, Stepping Stones) + the Drip Leaf
= 5; 11.75 m2 of cells, up to 3.6 m; asleep 24 to 45 s; in frame 100 %. CARRY: 2 of 2 at the first press, to the spot (0.16 / 0.24 m); the hand rose to **1.93 m** over a
thing on the way to the back right, rested 0.84 m from the let go.
**Hearthlog Cabin, desktop (DONE 15:27, 0 errors):**
- W: things used **5** (Yarn Ball, Rocker Board, Kettle, Snug Basket, Pillow Swing) + the hearth = 6; 21.75 m2 of cells, up to 5.4 m (paths to 29 m); asleep 11 to 47 s; in frame 100 %.
- CARRY: 6 of 6 at the first press, to the spot (0.04 to 0.28 m), landed 0.16 to 0.76 m from the let go, stayed.
- Pillow Swing and Rocker Board: carried on and let go: each rides it (y 0.62 / 0.69). "Go play with... the Rocker Board" (already beside it). Travel Home 12.5 s, 3 out.
**Hearthlog Cabin, phone (DONE 15:29, 0 errors; one squishy carried):** W: things used **3** (Yarn Ball, Rocker Board, Snug Basket) + the hearth + the Pillow Swing
(social) = 5; 17.5 m2 of cells, up to 4.3 m; asleep 1.5 to 44 s; in frame 100 %. CARRY: 2 of 2 at the first press, to the spot (0.19 / 0.27 m), rested 0.71 / 0.87 m from the let go.
**Lanternroof, desktop (DONE 15:36, 0 errors):**
- W: things used **3** (Lantern Line, Chimney Corner, Vane Disc) + reactions (Moon Dish, chimney) + the hammock (social) = 5; **28.75 m2 of cells** (the most), up to 5.8 m
  (paths to 32 m); asleep 8 to 27 s; in frame 100 %.
- CARRY: 6 of 6 at the first press, to the spot (0.01 to 0.30 m), landed 0.13 to 0.61 m from the let go.
- Vane Disc: set on it, it rides (y 0.71 to 0.78). Chimney Corner: carried up to its top (the hand rose to 1.88 m over it) and let go: it sits there 1.8 s, then hops down
  (1.97 -> 1.29 m, still coming down at 2.4 s): the perch-down works (node_checks row 8 is a rig problem). "Go play with... the Star Scope": there at 9.5 s from 3.1 m,
  "New stamp: Moon watchers". Travel Home 11.1 s, 3 out.
**Lanternroof, phone (DONE 15:38, 0 errors; one squishy carried):** W: things used **4** (Lantern Line, Vane Disc, Chimney Corner, Hammock) + reactions (Star Scope,
Moon Dish) = 6; 16.75 m2 of cells, up to 4.2 m; asleep 14.5 to 63 s; in frame 100 %. CARRY: 2 of 2 at the first press, to the spot (0.17 / 0.22 m), rested 0.34 / 0.40 m from the let go.

### (4) Published place actions most at risk (in the place runs above, plus `P3_cloudloft_desk`: the published lift = press, hold still 0.6 s, pull up past the line, carried 2.0 m
high over the thing, let go; heights every 0.1 s for 5 s; logs `S/logs/P3_cloudloft_desk.json`, shot `S/shots/P3_cloudloft_desk_holdlift.png`)
- **Pad bounces**: Puff Pads (Cloudloft) and Moss Bouncer (Rainleaf) set down by a carry: the squishy sinks in and is kicked up about 2 s later (to 0.91 / 1.05 m); Home's
  Bounce Pad: rebound 0.05 to 0.08 m (slime); Puff Pads dropped from 2.0 m by the published lift: 1.93 -> 0.41, rebound to 0.55 m (Glimglop, slime: the family barely bounces).
  The pads also get used by themselves (Cloudloft phone W: Puff Pads).
- **The Updraft (Cloudloft)**: carried in and let go slowly: SET DOWN (0.52 -> 0.40 m), no float. Dropped from 2.0 m by the published lift: falls to the floor in 0.6 s
  (1.96, 1.82, 1.61, 1.35, 1.04, 0.69, 0.40: close to a free fall), then rises a little (0.39 -> 0.55 m). **"Float down slowly" was not seen by player input** (R12 saw it on the
  earlier build from a 1.2 m drop). The Updraft is reacted to by itself (Cloudloft phone W).
- **The Glide Ramp (Frostbell)**: carried to its top and let go slowly: stays at the top 2.4 s (no glide).
- **Asked walks ("Go play with...", name tag popover, real taps)**: Cloudloft Kite Swing 7.96 m in 3.5 s; Rainleaf Leaf Teeter 7.0 m in 3 s; Frostbell Snowball 4.75 m in 15.5 s;
  Lanternroof Star Scope 3.1 m in 9.5 s ("New stamp: Moon watchers"); Home Music Box 4.6 m in 15 s (desktop) but **not reached in 20 s on the phone** (6.9 m).
- **Travel home** (Places sheet) from Ripple, Cloudloft, Frostbell, Rainleaf, Hearthlog, Lanternroof (desktop): arrived in 9.3 to 13.3 s, 3 out every time, 0 errors.
- **Squirt at the beach: NOT CHECKED** (the seed has no foam squishy; R12's capsule route did not fit the time). The Rock Pool still takes a carried squishy (floats, y 0.88).

### (3b) Home carry re-check with a position trace (`P2_home_desk`, 15:45, same method, the squishy's position 0.4 s / 1 s / 2.4 s after the let go)
- 6 of 6 picked at the first press and brought to the spot (0.04 to 0.27 m). Landed: 0.14, 0.44, 0.28 m from the let go (good) but **3.90 m, 0.90 m and 1.38 m** in three.
- **FL_to_BR_0: let go at (4.23, -3.48) by the back-right rim of the felt (r 5.48 of 5.5): 0.4 s later the squishy stands at (3.36, 0.32), 3.9 m away beside the Music Box**
  (`S/shots/P2_home_desk_carry_BR_0.png`; the first run's FL_to_BR_1 did the same: let go (3.60, -3.61), found at (2.84, -0.15)). The R14_ROOMS check saw the same at 12:52
  (`_harness/_reports/browser_rooms.json`: "toBack ... rest 3.08"). A player who carries a squishy to the back of Home and lets go sees it jump back across the felt.
- FL_to_BR_2: the finger rested near the frame's top edge (y 50); the room view kept scrolling the hand back during the 0.25 s rest, so the squishy kept going and landed
  1.38 m further back than where it was when the finger stopped (by design the edge scroll moves a still finger's hand; it reads as an overshoot).

### (2b) Every published gesture, by real input (`S/scripts/gest.mjs`, Home with 3 out = a room, autonomy off so the squishy under test holds still; the dev spy's audio calls,
the body's compression / carried flag, the camera; `S/logs/G_new_{desk,phone}_n3.json`, `sumG.py`). With ONE squishy out the machine is the published one (probe_carry K2,
probe_gestures; the arun steps poke / squeeze / stretch / lock / cut / float / keyboard pass on both frames, above). In a room (a place, Home with 2+ out), D-104 / D-105:
| gesture | desktop (mouse) | phone (touch) | in a room |
|---|---|---|---|
| poke | tap: poke sound, compression 0.03 | same (0.03) | **works, unchanged** |
| squish | press and hold 1.5 s: compression 0.12, pops | 0.17 | **works, unchanged** (a hold that does not move) |
| rub | hold still first, then move: as published, the first move decides pull or rub (my 30 px circle went outward and became a pull that lifted it) | same | **changed**: a rub must now start from a still hold; a quick move carries |
| stretch | hold still 0.6 s, then drag outward: stretches and, past the line, lifts (moved 0.6 m) | lifts (1.6 m) | **changed**: only after a still hold (the hint pill says "hold, then drag out to stretch"); a quick drag carries |
| pull both sides | Shift + drag: two grabs, pops, not carried | two fingers on the body: two grabs, pops | **works, unchanged** |
| carry (new) | a drag that starts on a squishy within 0.4 s: in hand at the first move | same | see (3b) |
| toss | carry + a fast flick: flew 4.3 m | 4.1 m | **works** (from a carry; a slow let go sets down instead) |
| orbit (turn the view) | right-drag on empty space: the camera turns | one finger on empty space | **works, unchanged** |
| zoom | wheel: the room camera's zoom (close view .. whole room) | pinch | **works** (now a room zoom) |
| pan (new) | Shift + right-drag: moves the view (1.2 m for 260 px at a place; clamped when the whole room is in view) | two fingers dragged together: 1.5 m | new; not taught in "How to play" or the hint pill (MINOR) |
0 console errors in both runs.

### Late results
- **Live Home, 3 out, 180 s, desktop** (`PLIVE_home_desk`, the same script on 6c495e9c1, 15:54, 0 errors): things used **2** (Felt Ball, Snooze Rug) + the Warm Lamp
  (reaction) = 3; 8.25 m2 of cells (new: 12.25), up to 2.6 m from the start (new: 3.9); asleep 42 to 73 s. So Home's variety is as live; the bigger Home adds roaming only.
- **F1 bisected** (15:58; two scratch copies of the tree, one constant each, `probe_softbody.ts --families-hostile`): `S/fa` (TOSS_MAX back to 6): **still FAILS** (wrigglo
  inverted at frame 169, NaN); `S/fb` (`softbody.ts` HOVER_ABOVE back to 0.35, the live float height): **2/2 PASS** (wrigglo settles 2.92 s, volume 1.0000). The fuzz toggles
  gravity (Float) mid-press: **the raised Float hover (0.35 -> 0.6 m, D-104 "volume bigger") is what turns a slime body inside out**, and Float is a published button
  any player can press. Logs `S/logs/HOSTILE_{fa,fb}.out`.
- **Phone, on-screen size vs live** (`RC_live_phone`, 4 places, 0 errors): one out at Home r 85 px at (176, 327) on both builds (published camera unchanged);
  3 out: Home 40-45 vs 45-51 px (0.89), Hearthlog 32-33 vs 40-42 (0.80), Ripple 34-35 vs 42-44 (0.81), Cloudloft 40-41 vs 41-46 (0.94): every ratio over the 70 % floor.

### Home's things with 3 out, by real input (`home.mjs`, R9's; seed `seed_home` = all Home things arrived; `S/logs/HM_n3_desk.out`, 15:51, 0 errors)
At the camera's own view with 3 out on desktop, **only the Felt Ball is on screen**: the Music Box (projected at x 1690), the Keepsake Shelf (1411), the Warm Lamp (-83) and
the Bounce Pad (-129, 643) are all OUTSIDE the 1280 px frame (`S/shots/HM_n3_desk_desk_party.png`); clicks meant for them land nowhere. Once the view had moved (a carry),
a still click through a resting squishy on the Music Box played its tune ("through musicbox", tune on), so the tap itself works when the box is in view. The covering
squishy still pokes, squeezes, stretches and carries; "Who's coming?" chips 56 px. This is what node_checks rows 2 and 3 meet.

## Summary

### Per place (floor area new / live from the data; things used BY THEMSELVES in 180 s with no input, 3 out, LOW tier, desktop / phone (with reactions and social in brackets);
carry first-try = picked up at the first press and brought to the spot)
| place | area ratio desk / phone | things used desk / phone | squishy size vs live (desk) | carry first try (desk / phone) | READY |
|---|---|---|---|---|---|
| Home (2+ out) | 2.62 / 2.62 | **2 (2) / 1 (2)**; live desk 2 (3) | 0.87 | 6/6 / 5/6 (the 6th took the squishy in front) | **no**: fewer than 3 things; the let go at the back rim jumps 3.9 m |
| Hearthlog Cabin | 2.63 / 3.01 | 5 (6) / 3 (5) | 1.01 | 6/6 / 2/2 | yes |
| Ripple Shore | 2.63 / 2.68 | 5 (5) / 4 (4) | 0.82 | 6/6 / 4/4 | yes (squirt not checked) |
| Frostbell Ridge | 2.63 / 2.68 | 5 (5) / 4 (4) | 0.91 | 6/6 / 2/2 | yes (MINOR: a set-down on the Glide Ramp does not glide) |
| Rainleaf Garden | 2.63 / 2.68 | 3 (4) / 4 (5) | 0.88 | 5/6 / 2/2 | yes (MINOR: one squishy on the Stepping Stones not picked) |
| Lanternroof | 2.63 / 2.68 | 3 (5) / 4 (6) | 0.90 | 6/6 / 2/2 | yes |
| Cloudloft | 2.63 / 2.63 | 3 (3) / 5 (6) | 0.88 | 6/6 / 2/2 | yes with a MAJOR: the Updraft's float-down not reproduced by player input |
Every run: 0 console / page / request errors; the camera kept all three squishies in frame in 100 % of the samples at every place on both frames; roaming 7.5 to 28.75 m2 of
0.5 m cells per 180 s (up to 5.8 m from the start).

### The owner's three requests
- **(a) Bigger rooms: READY at the six places, NOT READY at Home.** Every room is 2.6 to 3.0 times the live floor (brief: 2.5), walls 3.4 m, toss apex 2.9 m; the squishies stay
  82 to 101 % of their live size on desktop; zoom / pan / whole-room view work; 3 to 5 things used by themselves at every place on both frames. Home with 3 out: 2 / 1 things
  (live: 2), its things now sit outside the camera's view at the rim, and its whole-room view is a bare felt (17 px squishies on a phone).
- **(b) Carry: READY with one MAJOR.** 66 of 68 carries in the place runs picked up at the first press (the two misses: a press that took the squishy standing in front, one squishy on Rainleaf's Stepping Stones)
  and every carried one reached the spot; the view scrolls at the edges; napping, resting, floating squishies and cut pieces carry; two fingers carry two on the phone. But at
  Home a let go by the back rim makes the squishy jump about 4 m (2 of 12 desktop Home carries), and the slow let go (a set-down) no longer triggers the Updraft float or the ramp glide.
- **(c) Multicut: READY** on both frames: strokes across two and three squishies, cut B while A is in pieces with no refusal, per-squishy Reconnect at their own spots, no
  cross-merge, the budget line shown at 12, leave / hide / Float with several cut all fine, 0 errors.

### Findings
| # | severity | finding | repro | evidence |
|---|---|---|---|---|
| F1 | **BLOCKER** | A physics guard newly red: `probe_softbody` G1 per-family hostile fuzz, `slimegoo/wrigglo` inverts at frame 169 and its volume goes NaN. The same fuzz passes on the live tree (2/2). | `node _harness/probe_softbody.ts --families-hostile` in the tree (63 s) vs in `git archive 6c495e9c1` | `S/logs/HOSTILE_snap.out`, `HOSTILE_live.out`, `probes/probe_softbody.ts.log` |
| F2 | MAJOR | Home with 2+ out: the camera's own view shows only the Felt Ball; the Music Box, Shelf, Lamp and Pad were moved to the rim and sit outside the frame (new). The party uses 2 things by itself on desktop, 1 on the phone (bar 3); the LIVE build's Home uses 2 too (`PLIVE_home_desk`: Felt Ball, Snooze Rug), so the variety shortfall is not new, but the bigger Home did not fix it (LIFE's Home reach kept at 3 m); roaming grew 8.25 -> 12.25 m2. | Home, 3 out by the Hoard, LOW, 180 s no input | `P_home_{desk,phone}.json`, `HM_n3_desk_desk_party.png`, `RC_new_desk_home_whole.png` |
| F3 | MAJOR | Home carry: a let go by the felt's back rim makes the squishy jump about 4 m across the felt within 0.4 s (2 of 12 desktop Home carries; R14_ROOMS's own check saw it too). | Home desk, 3 out, drag a squishy from the front left to the back right (to about r 5.3), hold still, let go | `P2_home_desk.json` FL_to_BR_0, `P2_home_desk_carry_BR_0.png` |
| F4 | MAJOR | `shellview/node_checks` 176/186: 9 rows newly red and not re-specified (live 185/186). By real input: the AUTO chips, the chimney perch-down, the Vane Disc ride, the Star Scope ask and the Music Box tap (when in view) work; the reds are rigs pinned to old positions, but they sit in the gate unexplained. | `node _harness/shellview/node_checks.ts` | `S/logs/probes/shellview_node_checks.ts.log` |
| F5 | MAJOR | The slow let go (set-down) changed published place actions: at Cloudloft a squishy carried into the Updraft is set down (no float), and a 2.0 m drop by the hold-then-pull lift fell to the floor in 0.6 s (no "Float down slowly" seen); at Frostbell a squishy set at the Glide Ramp's top stays there. | Cloudloft desk: carry into the Updraft, let go; or hold 0.6 s, pull up, carry over it, let go | `P_cloudloft_desk.json`, `P3_cloudloft_desk.json`, `P_frostbell_desk.json` |
| F6 | MINOR | After a set-down the squishy lands 0.2 to 0.9 m from where the finger let go (it hangs from its top); near the frame's edge the view keeps scrolling the hand while the finger rests, so it overshoots (1.38 m). | any place, carry and let go near an edge | `P_*` carry rows `land04VsRelease` |
| F7 | MINOR | Phone whole-room views: Home's squishies 17 px; at Cloudloft the pinch-out ended in a turned far view (13 px, two corners outside the frame), not separated from my pinch. | 390x844, pinch out fully | `RC_new_phone_home_whole.png`, `RC_new_phone_cloudloft_whole.png` |
| F8 | MINOR | "Go play with... the Music Box" at Home on the phone: not there after 20 s (6.9 m). | Home phone, 3 out, name tag, Go play with | `P_home_phone.json` |
| F9 | MINOR | One-out published toy touched by global constants: TOSS_MAX 6 -> 7.5, Float hover +0.25 m, the desktop Keepsake Shelf now needs 2 out (fromN 2), the wheel zooms out further at Home alone. Looks the same in the arun shots. | code: `softbody.ts` 179 / 319, `place_home.ts` | `A_new_phone_toast_1500.png` vs R13's |
| F10 | MINOR | 12 pieces on a phone: the camera pulls back until pieces are 25 to 45 px and the three squishies' pieces read as one heap. | Home phone, cut all three to 12 | `MC_phone_budget.png` |
| F11 | MINOR | Pan / zoom (new) are not taught in "How to play" or the hint pill. | - | `screenCopy.ts`, hint lines |
| F12 | MINOR | Rainleaf: a squishy using the Stepping Stones in the front-left corner was not picked up by a press on its upper middle. | Rainleaf desk carry | `P_rainleaf_desk.json` FL_to_BR_2 |
| F13 | MINOR (pre-existing) | The thing "tick" sound starts with a click. | sound_survey | `S/logs/SOUND.out` |

### Ready to deploy: **NO**, because
a physics guard that is green on the live build is red on this one (F1: a body goes NaN under the project's own hostile fuzz), and at Home, the room every player starts in,
the bigger room is not yet playable as designed: its things sit outside the camera's view and the party uses 1 to 2 of them (F2), and a carry let go at the back of the felt
jumps 4 m (F3). The node_checks gate has 9 unexplained new reds (F4). Regression is clean (published steps, saves both ways, one-out cut, 0 errors), multicut is ready, and
the six places meet the room and carry bars.

### The smallest set of changes for a deployable build
1. F1: the bisect points at `softbody.ts` HOVER_ABOVE 0.6 (back at 0.35 the fuzz passes 2/2; TOSS_MAX is not it). Smallest change: HOVER_ABOVE back to 0.35 (the live
   float height); or keep 0.6 and fix the float spring so a slime under hostile input does not invert (a NaN guard alone is not a fix). Then `probe_softbody` (the full set)
   back to the live count and probe_float re-run.
2. F2: at Home with 2+ out, either give LIFE the place numbers for reach when Home is a room (`brain.ts` reach2 / freeTarget keep round 4's Home numbers on `w.home`) or bring
   Home's things in from the rim so the default view and the party reach them; re-measure 3+ things by themselves on both frames.
3. F3: make a let go near the Home rim set the squishy down where it hangs (find what moves it 4 m in 0.4 s: the rim / corral rescue or the LIFE home), re-run the
   front-left to back-right carry at Home 6 times per frame.
4. F4: re-specify the 9 node_checks rows with written reasons for the new positions (keeping what they guard: the Music Box tap, the Star Scope, the chimney and arch
   perch-downs, the pad bounce, the vane ride, both AUTO chips) or fix what they find; 185/186 again.
5. F5 (can ship as a known change only if the owner accepts it): a set-down inside the Updraft or on the Glide Ramp's top should still start the float / the glide.

### What was not checked
- The squirt at the beach (no foam squishy in the seed); "Go play with" at Ripple / Hearthlog (the asked squishy was already beside the thing).
- Real phones, real frame rates and the render cost of the bigger rooms (SwiftShader only; R14_ROOMS's own perf item is open); nobody listened to the sound.
- Gestures with one squishy out against the live build by a gesture script (covered only by the arun steps and probe_gestures / probe_carry K2).
- 4 or 5 squishies out; a ceremony, a merge, a quick switch or the Hoard with several cut; a tab hidden over 60 s by the browser (only a 5 s emulated hide; probe M14 covers 60 s).
- Quality tiers other than LOW for the 180 s runs; the extras (napping / floating / two fingers) at Cloudloft, Frostbell, Rainleaf, Hearthlog, Lanternroof.
- Edge chips for out-of-view squishies (never triggered: the camera kept all three in frame in every sample).
