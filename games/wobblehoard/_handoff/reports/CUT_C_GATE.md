# CUT_C_GATE: integration gate on the real stack (CUT3), 2026-10-09

Real SoftBody, stage and shell, Chromium + SwiftShader, REAL mouse swipes and buttons, 960x600 and 390x844 (toolbar in every picture). Pictures: `_handoff/reports/cut_c_gate/` (6 sheets, all looked at). No repo edits (drivers are in my scratch folder); `tsc` clean at the start. The machine ran at 100 % CPU throughout: only ratios, counts and shapes mean anything.

## 1. Plain verdict for the owner
**Cutting as much as you want works. The star's tips come off, the middle can be cut again, Minis go on and on, and Reconnect all always gives back the exact squishy. Three things are not right yet.**
- 20 presses of Split in two make 21 pieces, 24 Minis each have a face, 64 pieces were made on the real stack with no NaN and nothing off screen. At 64 the bar says "That's a lot of pieces! Reconnect some to keep cutting." and Split in two is dimmed. Whole again in 1.5 to 1.7 s every time.
- **Float / Table is in the toolbar** (the two round buttons right of the tools in every picture); the harness section for it passes 41 of 41 at 8 screen sizes.
- A star's first tip taken off the top does not fall to the table: it drops onto the star's face and creeps there (0.2 m/s for 6 s, never rests) and is nearly invisible (a patch of sparkle). Side tips fall and rest.
- At 960x600 the Cut bar covers the lower 15 percent of the frame: two of the five star tips and the base of a pile are under it, so the swipe line for those two tips starts on the bar and does nothing (4 of 5 tips at 960, 5 of 5 on the phone). One swipe across several tips could not be shown in a browser by me (below).
- With many pieces lying on each other the physics does not let them sleep, so the cost at 24 and 64 pieces is above the budget in my measurement (section 3).

## 2. What I see in each picture
| Sheet | Verdict |
|---|---|
| 01 star tips 960 (granulo) | whole star above the bar, base hidden under it. Top tip swiped off: a sparkly cap sits on a flat stump at +0.25 s, at +6 s it is gone from the top and not seen (perched on the face). Five swipes: top and both arms off (small glittery crumbs by the bar), flat stumps, the two legs under the bar untouched. Split in two after that: two halves with a clear glassy gap between the eyes, eyes one each. |
| 02 star tips phone | all five tips cut (5 swipes, 6 pieces), four small crumbs on the mat each with a cyan pool, flat pale stumps, then the middle cut again. Clear of the dock. |
| 03 Split x20 960 | 21 orange shards, two big wedges with one eye each, pale glassy faces, the counter says "21 pieces" (no "of N"); Reconnect all: whole dollop. The lowest shards are partly under the bar. |
| 04 / 05 Minis | 24 little dollops, each with its own two eyes, sizes read, the big ones on a shadow; a swipe through a 29 px mini makes 25 (the new one stands on top, with eyes). Whole again afterwards. Same on the phone. Overlapping minis show four eyes (RENDER's old note). |
| 06 many pieces 960 | 24 pieces: a clump of glassy shards, one big eye; 64 pieces: a field of shards, the kind line in the bar, "64 pieces", Split in two dimmed. The lower third of the 64 heap and an eye are under the bar. |

## 3. Numbers (bars: CUT3.md 3 and 5)
| Id | Result |
|---|---|
| U01 | browser: 20 presses -> 21 pieces, shares 1.000000000000, Reconnect all whole in 1.533 s (radius, genome, item equal). node `cutter_checks --only=u01`: 12 species, shares 1 +- 1e-9, **bit for bit whole** (4 of 4 rows with u04). |
| U02 | browser granulo: tip 1 = 0.0078 of the squishy, cut in 0.33 s of sim, **no launch** (rise 0.026 m, bar 0.06) but **not at rest in 6 s** (windowed 0.21 m/s on 960, 0.20 phone) = FAIL as run. 5 of 5 tips on the phone, 4 of 5 at 960 (lower legs under the bar). The 12 family reps and the 3+ lobe species were NOT run by me (PHYS's own run: 230 of 252 within every bar). |
| U03 | NOT shown by me in a browser: the dev probe's best line at 960 starts on the SQUISH KEEPER wordmark and crosses the Cut bar (no player can draw it; elementFromPoint says svg / cutbar); on the phone the line is drawable and the answer is "That would make a piece too thin. Try another angle." (3 parts, one sliver; SHELL's open item). Node rows (SHELL / PHYS) are theirs, not re-run. |
| U04 | browser: 63 presses -> **64 pieces** (45 min wall), shares 1, no NaN, 0 off screen, 64 views; ceiling: bar kind line, Split dimmed, press answers `limit`, hit counted; the live-region line was not captured within 0.5 s at 0.3 to 0.6 s frames (row FAIL as run); re-run with the ceiling lowered to 6 (dev hook): live line "That's a lot of pieces! Reconnect some to keep cutting." ok, Reconnect all 1.6 s, the next press cuts again. node u04: 64 pieces, `limit`, Reconnect all whole, cuts again: ok. |
| U04 cost | node, my `perf_ladder.mjs`: real bodies and Cutter, dollop, Split-in-two spam, INTERLEAVED against 2 whole bodies (min of 40 x 4 frames): 2 pieces asleep 0.003 x; 6: 2.9 x right after the cut (5 awake, 810 particles), 0.001 x at rest; 12: 0.87 x (7 awake); **24: 3.1 x right after, 2.25 x after 8 s (21 awake, 882 particles): bar 1.5 x NOT met**; **64: 16 x, then 8.4 x (50 awake, 3,150 particles; bar 1,926 awake): NOT met**. The same hour `cutter_checks u04` gave 0.71 x at 24 but its 2-whole reference was 300 ms (noise); SHELL measured 1.44 to 1.59 x earlier. So: probably missed, noisy; the cause is stable: pieces lying on pieces never sleep. Browser awake / total particles: 2: 1,284 -> 0 at rest; 6: 972 -> 162; 12: 822 -> 660; 24: 966 -> 924 of 1,008; 64: 1,920 -> 1,620 of 2,148 (14 asleep). Browser frame ms are unusable (98 ms for ONE whole body). |
| U05 | Minis 24 of 24 with both eyes at full share on both viewports, 25 of 25 after a swipe through a small one, smallest share 0.031, Reconnect all exact (1.57 s / 1.67 s). Minis below 1/32 by swipes: not exercised. |
| U06 | browser, 6 pieces: a sleeping piece (share 0.126) did not move (0.0 m in 0.5 s) and woke on a touch (all 5 sleepers woke). node `probe_many --only=sleep,wake,acct`: 16 of 16; a sleeper costs 0.07 us (bar 10 us), +0 solver steps in 2 s, pose bit for bit; wakes on touch, hit, contact, join, gravity change; accountant 0 of 480 frames off. At 24 pieces after 6 s my run found no sleeper (924 of 1,008 awake). |
| U07 | not re-run at 24 pieces. harness `cut-real` (the leave paths: Hoard, quick switch, hidden 30 s / 60 s, capsule, reload) 12 of 12 ok. |
| Volumes | node, 12 family reps, mesh volume against share x whole: first Split in two worst 0.09 % (capnap, the rest 0.00 %); after 5 more presses (6 pieces) worst 0.62 % (capnap), total 0.9954 to 1.0000 (bar 3 %). |
| X13 launch | 36 cuts (12 reps x Split in two, swipe between the eyes, level swipe) through the shell's Cutter: **0 break a launch bar**; worst rise 0.009 m (0.06), up 0.42 m/s (1.0), peak 0.90 m/s (1.2), resets 0. (CUT_A_GATE: dollop climbed 0.64 m.) |
| Bundle | G0 1,468 KB of 3,072; G0b 434 KB gzip of 600 (harness `prod-build`; was 1,327 / 400). |

## 4. The whole browser harness (`browser_shell.mjs --quick`, 18:58 to 20:01): 84 of 146 rows
**Not a valid verdict: from `capsule-loop` on, 60 of 67 sections died on `page.goto: Timeout 30000ms exceeded` (a cold Vite server needs over 30 s for its first page at 100 % CPU) or `waitForFunction 120000ms`, while my own runs and other sessions overlapped. Its `prod-build` preview also takes PORT+1 = 5511, my first port.** Clean sections: node-core (130 of 130), desktop-boot 18, mouse-gestures 19, hook-deterministic 13, settings-panel-desktop 15, console-and-network 4, prod-build 5 of 6.
| Section | Row (verbatim start) | Class |
|---|---|---|
| shift-pull | `desktop hint: pointer wording plus "Shift + drag pulls both sides" ... Shift while stretched fully locks a pull; Esc lets go (font 14px, lines 1)` | LOCK team (new hint text vs the check) |
| 60 sections (shift-hint-reflow ... lab-panel, prod-mode; prod-build last row) | `section ran to the end  page.goto: Timeout 30000ms exceeded` / `Cannot destructure property 'page' of 'C' as it is null` / `waitForFunction: Timeout 120000ms` | LOAD, not product |
Re-run (cut / toolbar / lock subset on its own server, 20:02 to 20:44, stopped when my cold server started the timeouts again): shift-hint-reflow 3 of 3, shift-touch 2 of 2, cut-real 12 of 12, toolbar-phone 6 of 6, **toolbar-gravity 41 of 41**, toolbar 12 + 1 FAIL (`Enter on Cut picks it ...`: the 1.4 s caption chip had already gone, `show:"false"`: timing under load, UI team's row), snap-mat 8 + 1 FAIL (`Snap: the brand, name plate, ring and hint step aside ...` hud `hidden,hidden,hidden,visible`: the hint stays visible: UI team), toolbar-grid 15 + 4: **`K11 390x844 (stack) hand / cut / snap: no overlap ... clash:["brand x fs"]`: the wordmark overlaps the full-screen button on a 390 px phone = real, UI team**, then a goto timeout (load). NOT re-run clean: cut-x, cut-touch, cut-low, cut-swell, fix1-*, fix2-*, toolbar-sweep, toolbar-k04, shift-pull, and the 30 sections not about cutting. Needs a quiet machine and a warm server.

## 5. Requests to other lanes
- **PHYS**: pieces resting on other pieces never sleep: 21 to 24 awake at 24 pieces, 50 awake (3,150 particles) at 64; either sleep stacked pieces or cap the awake set (repro `node perf_ladder.mjs`, `cutter_checks --only=u04`). A top tip cut off lands on the star's face and creeps (granulo tip 1, both viewports): toss it clear or let it slide off.
- **UI / RENDER**: put the Cut options bar into the safe insets (it hides the lower 15 % at 960x600); brand x full-screen clash at 390x844 (K11); `snap-mat` and `toolbar` rows vs the current UI.
- **SHELL**: `multiSwipe` probe ignores the UI (wordmark, bar); U03 in a browser still open; kind line in the live region at 64 pieces needs a longer wait in the harness row.
- **LOCK**: `shift-pull` hint row.
- **Orchestrator**: run the harness alone on a warm server (or raise its 30 s goto); give the harness a port that does not collide with the lane ports (it uses PORT+1).
## 6. Not done
Whole-harness rerun of the starved sections; U02 on 12 reps + 3+ lobes and U03 in a browser; a phone run to 64; Minis cut below 1/32; U07 at 24; one more calm perf run for U04.
