# R7_LIFE: round 7, the LIFE lane (src/life, src/data, src/core/quests.ts, src/collection/journal*.ts and their probes; ports 5367, 5369). No git write command is run.

Brief: the orchestrator's round-7 task (SESSION3.md machine rules; D-95 revised, D-96; R6_DATA / R6_PHYS / R6_RENDER / R6_SHELL reports).
No earlier R7_LIFE report existed: first round-7 life engineer. Started 2026-11-18 08:00 UTC at HEAD 99d081c14 (tree clean but R7_SHELL.md).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r7_life/` (`S/` below).
The other engineer this round is R7_SHELL (src/shell, src/ui, src/input, shell harness).

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 0 | baseline (tsc, my probes), the self-use rig | DONE 08:40 (section 0) |
| 1 | by-itself uses of every thing kind (brain.ts B04 + wander), USES_FULL, probe rows, the 300 s x 5 parties x 6 places measurement | DONE: the integrated build (1b) meets the target at all six places (5 5 5 5 4 4 of 5 parties); my lane's tree alone (HEAD's host) 5 of 6: **Lanternroof 3 of 5** without R7_SHELL's ride lift and Vane Disc |
| 4 | regressions (section 4): the asked use ("Go play with...") made robust after node_checks N1 failed on my tree | DONE: my lane's tree passes every probe that passed at HEAD but ONE S1-only shell row (a re-spec asked of R7_SHELL); the integrated tree: B7 wake gate 11.8 % vs 10 % (section 4) |
| 2 | open Ripple / Frostbell / Rainleaf (R6_SHELL_open_s2.patch) + re-spec QU-06, QU-14 x2 (and the S1-session rows) | DONE 09:20: patch APPLIED (`git apply`, after runs 3 and 4 met the target); re-specs pass (section 2) |
| 3 | DT-01: Cloudloft tall (3), Home B5 Felt Ball one out on a phone, Hearthlog tall in the shipped camera | DONE where data can: Hearthlog tall passes (the pill at 670 modelled); Home B5 and Cloudloft tall NOT fixable by data (section 3) |

## 0. Baseline (HEAD 99d081c14, `S/tree_head` = `git archive HEAD`; `S/probes.sh`, logs `S/base/`, one probe at a time)
| check | HEAD |
|---|---|
| tsc | 0 errors (2.1 s) |
| probe_life | 121 ok, 1 FAIL (LF-02, known: new-space growth 88752 .. 157968 B per 1000 ticks) |
| probe_quests | 46 ok, 3 NOT RUN |
| probe_journal | 29 ok (all) |
| probe_pg_data | 40 ok, 3 FAIL (DT-01 Home B5; DT-01 Hearthlog tall in the shipped camera, rocker 669 px vs the model's 618; DT-01 Cloudloft tall, 3 spawn spots) |
| probe_pg_lifequests | 16/16 |
| probe_chatter | 42/42 |
| probe_playground (quick) | 73/73 (38 s) |
| renderview/pg_node_checks | 40 ok, 0 FAIL |

**The self-use rig as a probe**: `_harness/probe_life_selfuse.ts` (NEW, mine): R6_SHELL's `scratch_selfuse.ts` (node_checks section 13's host: the REAL physics, the
shell's life host `later-life.ts`, LIFE; no rendering, no input) made a probe. Every play-event record the host writes BY SELF that names a thing (USE, a REACT
naming it, a social moment around it) counts that thing as used; it reads the records as they are drained into the journal (`collection.feedPlay`), so it
also knows WHO used what (per species, so per family). Parties (Dollop + two; 11 of 12 families): wisplet+chunkle, puddlo+boingle, gloopsy+kneadle,
twangle+dimpla, capnap+burrbin. Rows: SU-01 (>= 3 different things in 300 s at each of the six places, for 4 of 5 parties), SU-02 (families prefer different
things), SU-03 (no squishy over USE_MAX by-itself USE records a visit). About 35 s of wall time per 300 s stay, 30 stays: ~18 min, a heavy job.

**The baseline numbers (HEAD, `S/selfuse_base.log`, 5 parties x 6 places x 300 s, 18 min)**: SU-01 passes at Hearthlog (5 of 5 parties: the Snug Basket, the kettle,
the Yarn Ball, the hearth; one party also the Pillow Swing by a push) and Frostbell (5 of 5: Steam Pool, Snowball, Ice Pond, Snowdrift Nest, Shake Pine); FAILS at
Ripple (0 of 5: the Pebble Ball and one of the Rock Pool / Driftwood Log), Rainleaf (0 of 5: the Seed Pod, sometimes the Drip Leaf or a splash), Lanternroof (1 of 5:
the Moon Dish's gaze, the chimney's warmth or nap, the lanterns struck) and Cloudloft (1 of 5: the Cloud Ball, the Cloud Nest). SU-02 passes (6 of 6). SU-03 (USE
records) FAILS at HEAD: at Lanternroof Burrbin has **1002** USE RING records in 300 s and Dollop 14: a body resting against the lantern line while the Night Breeze
swings the lanterns into it is struck again and again, and the host writes a USE per strike (a shell request, section 5). SU-03 now counts use EPISODES (one
squishy's records on one thing less than 10 s apart are one use) and lists the raw records as info.

## 1. By-itself uses of every kind of thing (the main item; code written, measuring)
**What a squishy now does by itself** (LIFE 5.3's "By itself" column, PLACES 4's "They do by themselves", the brief's list; `src/data/life.ts SELF_USE` and
`FAMILY_SELF`, `src/life/world.ts copyPlace` -> `selfUseOf`, `src/life/brain.ts useCandidate` / `selfOk` / `selfPoint` / `runSelf`):
| kind (SELF_USE) | things | what it does (physics does the rest) | its record |
|---|---|---|---|
| BALL, ICE | every ball; the Ice Pond | as before (a boop; one glide nudge) | USE ROLL / STEP (LIFE), GLIDE REACT |
| WADE | Rock Pool, Steam Pool | walks in (a wader 0.45 of the way in, a floater deeper), stays 6..12 s (+4 for a family that likes it), walks out to the nearest dry spot | USE WADE (LIFE, once it is in the water); FLOAT / WADE / SOAK / WARM REACTs (looks.ts) |
| SPLASH | Splash Spots (3 puddles), shallow water | walks into the nearest puddle, 1 to 3 small splash-jumps, walks out | USE WADE; SPLASH REACT per landing |
| GAZE | Moon Dish, Star Scope (a sky switch is a sky thing now) | at night, sits beside it and looks up 5 s | GAZE_SKY REACT (looks.ts allows B04's still gaze phase) |
| RING | Shell Chimes, Icicle Bells, Lantern Line | walks along the row on the side toward the middle, its side reaching 0.1 m past the parts, end to end | the host's USE RING per strike (no LIFE record) |
| PAD | Moss Bouncer, Puff Pads, Home's Bounce Pad | walks to the pad's middle (Home: its use spot), one small hop: the pad's gain does the rest | the host's USE BOUNCE per run of kicks |
| UPDRAFT | the Updraft (light families: catch >= 0.5) | to the Puff Pad standing in the column (else its middle), one hop | LIFT REACT |
| CLIMB | Sand Mound, Glide Ramp | from the foot (a ramp: its downhill end) up over the top; on it, the host's RIDE follows and LIFE records its own slide; short of it, it leans against it (no record) | USE SLIDE (LIFE, rideThink: its own climb) |
| LEAN | Driftwood Log | beside it on its side, a lean pose 4..6 s | USE LEAN |
| ARCH | Sunbow Arch | walks under it, stands 2.5 s | USE STEP |
| BUMP | Shake Pine | a boop into the trunk (scoot + hop) | the host's USE SHAKE + snow puff when the branch swings |
| STONES | Stepping Stones | end to end along the path (hopping families hop their gait) | USE STEP |
| SHOWER | Drip Leaf | only while it rains where it stands: under the leaf 4 s | SHOWER REACT |
| NEST | nests, basket | B06 (unchanged: naps when tired) | USE NAP |
| RIDE | seesaws, swings | NOT started: needs the host's lift of LIFE's own get-on (request, section 5; `lifeSetSelfRides`) | (USE ROCK / SWING by SELF from rideThink, ready) |
Not used by itself: the Vane Disc (the turntable is not built in physics: it would not turn), the Bob Ring (a floater), switches (B18 answers tunes; the
Fireplace, Music Box, Warm Lamp, kettle stay the player's), the chimney corner and the warm zones (B05 bask, unchanged), Home's shelf.
**Each in its own way by family** (FAMILY_SELF, from PLACES 3 and 4's cells): the kinds a family LIKES add 0.2 to B04's score (slow rise: wade, gaze, shower,
nest; marshmallow: wade, updraft, nest, shower; jelly: ball, pad, climb, ring; water fill: wade, splash, ball, ice; putty: climb, lean, nest; sticky: ball, ride,
arch; slime: wade, lean, nest; firm: pad, ice, climb, ring, bump; pop dome: pad, updraft, wade, arch; gummy: ball, pad, splash, stones; bead: ring, ball,
stones, bump); what its body cannot do is NEVER a candidate (putty and slime never hop: no splash jump, pad, updraft; the heavy ones fall straight in the
updraft; sticky and slime do not glide). A floater floats, a foam soaks, the wader wades: physics and looks.ts make each family's use look its own.
**Variety without noise**: `USES_FULL` 2 -> **3** in a place that offers two or more kinds of by-itself use (`usesFull(w)`); Home and the cabin (one kind:
the ball, until rides are lifted) keep 2, so LF-09 and the Home rows are unchanged. In such a place a thing the squishy already used this visit loses 0.5
and one a friend used in the last 20 s loses 0.1 (the party spreads over the place's things); a thing with no use point in the bounds is marked tried.
**Wander targets**: a third of B03's wanders in such a place go to look at a thing the squishy has not used yet (a free spot 0.5..1.0 m beyond its
footprint), so they pass the things, notice them and come within B04's 3 m.
**Found on the way (real physics + the shell host, traced with `probe_life_selfuse.ts --trace`)**: (1) a gait hop that lands on a flush pad's rim pins the
body there: LIFE now makes no gait hop while the body stands on a prop (`act.ts travelStep`); (2) a body left on a pad's rim stays there for minutes under
the shell's over-budget rule (it stops the scooting body farthest from (0, 0) and hushes it until it sleeps): pad parts are now keep-outs for free targets
(a wander or a nap never ends on a pad, `world.ts inKeepOut`) and a pad use stopped on the rim steps off again instead of hopping there (`padOff`);
(3) a failed climb's "lean" first wrote USE LEAN on the Glide Ramp: a verb outside the place's caps (probe_pg_lifequests QC caught it): a USE always carries
the thing's own verb now, a failed climb writes nothing; (4) the ball-only huff (B16) now needs a ball, as HUFF_TRIGGERS says (two may wade in one pool).

### 1a. Measurements (real physics, `probe_life_selfuse.ts`, 5 parties x 6 places x 300 s, no input; logs `S/selfuse_*.log`)
| place | HEAD (parties passing / things per party) | run 1 (first code) | run 3 (final code) |
|---|---|---|---|
| Hearthlog Cabin | 5/5 (4 4 4 5 4) | 5/5 (4 4 4 5 4) | **5/5** (4 4 4 5 4) |
| Ripple Shore | **0/5** (2 2 2 2 2) | **5/5** (4 4 4 5 5: Rock Pool, Pebble Ball, Sand Mound slide, Driftwood Log, Shell Chimes) | **5/5** (3 4 4 5 5) |
| Frostbell Ridge | 5/5 (4 5 4 4 4) | 5/5 (5 5 5 5 6: + the Glide Ramp's slide, the Icicle Bells) | **5/5** (5 4 4 4 5) |
| Rainleaf Garden | **0/5** (2 1 1 1 2) | 3/5 (2 3 2 4 3) | **4/5** (5 4 1 3 4: Splash Spots, Seed Pod, Stepping Stones, Drip Leaf, a teeter) |
| Lanternroof | 1/5 (2 2 1 2 3) | 2/5 (2 4 2 2 3) | **4/5** (1 3 3 3 3: Moon Dish, Star Scope, Chimney Corner) |
| Cloudloft | 1/5 (2 2 2 2 3) | 3/5 (2 3 2 3 3) | **4/5** (4 3 2 3 3: Cloud Ball, Cloud Nest, Sunbow Arch, the Updraft) |
SU-02 (families prefer different things): 6 of 6 places at HEAD and in every run. SU-03 (use episodes per squishy, at most 8): run 1 most 6, run 3 most 6.
**Run 3: all SU rows pass** (`S/selfuse_r3.log`, rc 0). Its info line still showed the host's strike flood: Ripple Boingle **3778** USE records (a body
left against the Shell Chimes' end part), Frostbell up to 155: so after a row walk the squishy now steps 0.6 m away from the row, and a row keeps free
targets off along its whole span (it was its middle point only). **Run 4** (+ the row step-away and the row keep-out; `S/selfuse_r4.log`): Hearthlog **5/5**, Ripple **5/5** (3 5 4 4 3), Frostbell **5/5** (5 5 4 6 5), Rainleaf
**5/5** (4 4 4 3 4), Lanternroof **3/5** (3 3 4 2 2), Cloudloft **2/5** (2 2 2 3 3); SU-02 6/6, SU-03 ok (most 7 episodes); the strike flood remains in the host's
records (Ripple Boingle 910). So Ripple, Frostbell and Rainleaf meet the target in runs 3 and 4 (item 2: opened); Lanternroof and Cloudloft swing between
runs (4/5 in run 3, 3/5 and 2/5 in run 4): their back things (the Lantern Line, the Sunbow Arch) are the walks the over-budget rule stops most, and their
pads and rides are off (section 5). Run 5 adds two reaches: in a place of several kinds a thing nobody in the party used yet draws a squishy from 4.5 m (was
3 m), and a warm spot a thing makes (the chimney, the steam pool) from 4.5 m for one that has not warmed there.
**Run 5** (+ the two 4.5 m reaches; `S/selfuse_r5.log`, `S/tree_mine` = HEAD + my lane, so HEAD's shell host): Hearthlog **5/5** (4 4 4 5 4), Ripple **5/5**
(4 3 4 4 4), Frostbell **5/5** (4 5 5 5 5), Rainleaf **5/5** (4 3 4 3 4), **Lanternroof 3/5 (FAIL: 2 3 3 2 3)**, Cloudloft **4/5** (3 3 3 2 3); SU-02 6/6; SU-03 ok
(most 6 episodes; raw host records most 82, Ripple Burrbin on the Shell Chimes). Lanternroof's things by itself are four with HEAD's host: the Moon Dish and
the Star Scope (gazes), the Chimney Corner (its warmth, a nap) and the Lantern Line; the Hammock waits for the host's lift of LIFE's own get-on, the Vane
Disc has no physics. In run 5 no party struck the Lantern Line (in runs 3 and 4 neither), so a party that misses the chimney's warmth has two: the two
failing parties (Wisplet + Chunkle: Moon Dish, a moment by the Hammock; Twangle + Dimpla: Moon Dish, Star Scope). R7_SHELL's working host adds the
Hammock (LIFE's own get-on, lifted, section 5) and the Vane Disc's turn (a body standing on it while a gust turns it rides: USE SPIN by SELF), so the
integrated build has six by-itself things at Lanternroof; measured on the integrated tree in 1b.
### 1b. The integrated build (`S/tree_all` = HEAD + both lanes' working files at 10:5x, final LIFE code; `S/selfuse_all.log`, `S/selfuse_all2.log`)
With R7_SHELL's host (LIFE's own get-on lifted, `lifeSetSelfRides` on; the Vane Disc's turn; a chime's USE only for a body moving into it) the same rig,
5 parties x 300 s, no input: **Hearthlog 5/5** (5 5 6 5 6: + the Rocker Board and the Pillow Swing by themselves), **Ripple 4/5** (2 5 3 4 4), **Frostbell
5/5** (4 5 4 5 5), **Rainleaf 5/5** (3 5 4 5 3: + the Leaf Teeter), **Lanternroof 5/5** (4 5 4 3 4: Vane Disc, Hammock, Moon Dish, Star Scope, Chimney
Corner), **Cloudloft 4/5** (3 2 3 3 4: + the Kite Swing once); SU-02 6/6; SU-03 ok (most 7 episodes; raw host records most 16, the strike flood gone).
**So the target holds at all six places in the integrated build**; on my lane's tree alone (HEAD's host) Lanternroof is 3/5 (run 5).
Family preferences seen (run 3, SU-02 info): at Ripple the putty climbs the Sand Mound and leans on the log, slime and the foams go to the Rock Pool, the bead
squeeze and the jelly walk the Shell Chimes, the firm one rings them; at Rainleaf the marshmallow stands under the Drip Leaf and splashes, gummy and pop dome
hop the stones, the putty and the slime keep to the Seed Pod (no hops); at Cloudloft the slow rise and the gummy go to the Updraft, the jelly, gummy, firm
and sticky ones walk under the Sunbow Arch, the slime, putty and marshmallow nap in the Cloud Nest.
Run 1 -> run 3 changes: pads off (PADS_OK, the pin below), pad parts keep-outs, the rim step-off, quiet uses (a gaze, a stand under the drip) do not spend
the budget, a new thing nobody in the party used gains 0.1, a thing's last user is per visit (tU / tUT were carried from the last place's index).

## 4. Regressions and the asked use (final numbers; one probe at a time; trees in `S/`)
**Trees**: `tree_mine` = HEAD + my lane (src/life, src/data with the S2 flip, quests/journal, my probes); `tree_noflip` = the same without the flip;
`tree_flip` = HEAD + the flip patch only; `tree_shell` = HEAD + R7_SHELL's working files only; `tree_all` = HEAD + every working file of both lanes (the
integrated build; `S/mk_all.sh`).
**My lane's tree (`tree_mine`, final code, `S/fin2/`)**: tsc 0; probe_life **124 ok / 1** (LF-02, the known one: 88752 .. 152384 B per 1000 ticks, HEAD
157968; LF-28 x3 ok); probe_quests **all ok, 3 NOT RUN**; probe_journal **all ok**; probe_pg_data **41 ok / 2** (HEAD 40 / 3: Home B5, Cloudloft tall,
section 3); probe_pg_lifequests **16/16**; probe_chatter **42/42**; renderview/pg_node_checks **40 ok / 0**; probe_trophies **31/31**; probe_merge **22/22**;
probe_app **188/188**; probe_gestures **160/160**; probe_playground **73/73** (quick, 38.5 s); shellview/node_checks **175/176** (without the flip
**176/176**, `S/nc4_noflip`): the one is section 5's S1-only row.
**node_checks found three of my regressions; fixed (brain.ts)**: on my first final tree node_checks was 173/176. Traced with a scratch copy of the probe (dev
prints only, `S/nc_dbg*.log`): (1) N1 "Go play with..." on the MED tier: the asked squishy (a) stayed in a CHAT / GREET moment, which an ask never broke,
(b) waited for the one mover token held by two squishies' moment walk-up (yieldToken skipped moment members), (c) asked where it already stood at the
Keepsake Shelf's use spot, went straight to the boop, never yielded the token and slept 12 s, (d) asked while asleep with the units already over the cap
(2.03 vs 1.345), its 4 s allowance (one whole above the CAP) never fitted. Fixes: an ask ends the by-itself moment the squishy is in (not a song, a teeter or
a push: `keepsMoment`); `yieldToken` takes the token from a moment's walker after the by-itself movers; `useGate` (the act's start of an asked use yields and
uses the allowance too); `askAllow` = one whole's wake above the units awake NOW. By-itself behaviour is unchanged by all four (only `pW` / asked paths).
(2) The Shake Pine row (Frostbell): the play body, set under the pine, was greeted by Thudge and walked off before the tap (a once-a-visit GREET the HEAD
trajectory had spent earlier); passes after (1) on both trees (trajectory; nothing in the row's path is chance-free). (3) The S2 dev path row: section 5.
**The integrated tree (`tree_all`, `S/nc4_all`)**: node_checks **179/180** (R7_SHELL's 4 new rows pass, N1 passes): **FAIL B7 the budget's wake gate**:
over the cap in 17 of 144 fine samples (11.8 %, the row allows 10 %). `tree_shell` passes it (180/180), `tree_mine` / `tree_noflip` pass it: only the
combination fails, deterministically (the same 17 in five runs with my later fixes, which act only on asks). It depends on the history before the window
(the S2 dev-path visits run before it): with my "no gait hop on a prop" rule removed everywhere it passes (2 of 144) but D-95 AUTO and the S2 row fail
instead; removed at Home only, or Home's pad keep-out removed, it still fails (17). Not fixed: chaos in a shared rig, not a rule of mine I can name.

## 5. Requests to other lanes and the orchestrator (kept current)
- **R7_SHELL (`_harness/shellview/node_checks.ts`, ~line 1937): re-specify the S1-only row "PLAYGROUND S2 by the dev path (not shipped: the sheet's path
  refuses each)"**. With the flip (item 2) Ripple, Frostbell and Rainleaf ship; the row asserts `shut === false` (the Travel sheet's path refuses each).
  With my LIFE the party earns more stamps before it, so Ripple is OPEN by its stamps and `host.travel('ripple')` succeeds (`shut: true`): correct
  behaviour. It passes on `tree_flip` and `tree_all` only because fewer stamps were earned there. Suggested: `shut === !(shipped && open by stamps)`
  per place ("the sheet's path refuses a place that does not ship or is not open yet"); the rest of the row unchanged. Not edited: R7_SHELL's file.
- **R7_SHELL: an asked use while on a ride by accident.** The host sets RIDE for 20 s on ANY body on a ride prop (a walk across the Rocker Board too), and
  LIFE's brain gives way to RIDE, so an ask waits up to 20 s (seen in `tree_all`'s N1 trace: asked to the yarn ball, its walk crossed the Rocker Board, then
  asked to the kettle 10.7 s late). Asked: `playWith` on a riding body that the player did not set there clears `rideUntil` (as a touch does).
- **Orchestrator: B7 in the integrated build** (section 4): 11.8 % vs 10 %; passes in each lane's tree alone.
- **DONE by R7_SHELL (their 2a''; in `tree_all`, not in `tree_mine`)**: the two requests below, the get-on lift (b = 1, no `c.setT`, `lifeSetSelfRides`) and
  the strike flood (`CHIME_V` 0.1 m/s, `CHIME_GAP_S` 1 s; the Shake Pine's USE only with a puff).
- **R7_SHELL (`src/shell/later-life.ts`): LIFE's own get-on onto a ride** (the brief: "teeters, rockers and swings (get on; AUTO stays the player's choice)").
  LIFE never climbs (LIFE 5.3): today the only way onto a seat or a board is the shell's lift for "Go play with..." (`INTENT.USE` -> `useRide` -> `carryTo`),
  which sets `c.setT`, so the landing writes a USE **by PLAYER** ("a ride the player set up"): a LIFE get-on through it would complete player quests (I7, R9,
  the rides) dishonestly. Asked: (1) `case INTENT.USE: useRide(i, a | 0, b === 1)`: with `b === 1` (LIFE's own get-on) lift it exactly as now but do NOT set
  `c.setT` (no PLAYER record); (2) once that is in, call `lifeSetSelfRides(w, true)` (new, `src/life/step.ts`) after `createLifeWorld`. LIFE then picks
  seesaws and swings by itself (B04 SELF_USE.RIDE: walks to 1 m from it, `INTENT.USE` with `out.b = 1`), and records its own USE ROCK / SWING by SELF from
  `rideThink` once it sits there (written and ready; LF-28 checks no ride starts while the flag is off). AUTO is never touched (setAuto stays the player's).
- **R7_SHELL: the chime strike flood**: the host writes a USE RING per strike; a body resting against the Lantern Line in the Night Breeze is struck again and
  again: at HEAD Burrbin had **1002** USE RING records in a 300 s Lanternroof visit (Ripple and Frostbell up to 67 in run 1). It floods the 64-record ring
  (dropped records) and the distinct-part quests. One USE per part per body per few seconds (like PAD_USE_GAP_S) would do; I saw a `chimeT` field appear
  in the working later-life.ts, so this may be in hand.
- **PHYS (or the orchestrator: no PHYS lane this round): a body on a flush pad's rim is pinned.** On the real physics with the shell host, a squishy whose
  walk stops with its foot on a pad (the Moss Bouncer, the Puff Pads) stays there for the rest of the visit: every later scoot is "blocked" (no 2 cm in 2 s)
  while `onProp` is the pad (traces: Cloudloft, Dollop on Puff Pad part 1 from 55 s to 180 s; Rainleaf, Chunkle on the Moss Bouncer from 18 s). In isolation
  (scratch `S/x/pad.ts`, `S/x/pad2.ts`, no shell): the walk onto the pad and the bounce work (5 kicks), but after the bounce a scoot off the pad one way is
  carried back to the rim (x -1.5 asked, the body ends at +0.6 and stays 20 s), and a gait hop that lands on the rim pins it. Until fixed LIFE starts no pad
  use by itself (`brain.ts PADS_OK = false`, one flag; the PAD kind and its act are written: walk to the middle, one small hop) and keeps free targets off pads.
- **PHYS: the Vane Disc (turntable) is not built**, so "ride it when the breeze turns it" (PLACES 4.8) and Lanternroof's L4 (USE SPIN) cannot happen by
  itself or at all; LIFE gives it no self-use.
- **The over-budget rule and edge things (R7_SHELL, for information)**: with 3 wholes on the high tier (unitCap 2.49) the host stops the scooting body
  farthest from (0, 0) and hushes it until it sleeps; walks to things at the edges (chime rows, the arch, the pads, the stones) are the ones stopped most.
  It is the attention budget ("the attention budget still rules"), so LIFE keeps it; picking the mover farthest from its OWN target instead of from the
  place's middle would let edge uses finish.

## 3. DT-01 (the phone layouts)
- **The hint pill as a bottom HUD row** (`_harness/probe_pg_data.ts`, re-specified with the reason in the code): round 6 counts the hint pill in the HUD insets
  (`hudBinding.ts reportInsets`) and it hangs at 670 px on 390 x 844 (R6_SHELL section 3, measured in the browser: insets top 56, bottom 174). The model had
  the pill at 618 and the reported bottom row at 130: now STAGE_INSETS phone bottom 174, PLACE_HUD phone bottom 174 (the HUD from 670), HUD_INSETS phone
  bottom 170 -> 174 (stricter). The desktop is unchanged: nobody measured the desktop pill since round 6 (at 16f6ba6fc it hung at 672..704 on 1280 x 800, so
  the reported bottom row there may now be 128, not 78: a browser measurement for R7_SHELL or the next data lane; the desktop rows pass either way today).
- **Hearthlog Cabin tall in the shipped camera: FIXED by the model** (no data change): 0 problems (the rocker's floor above 670, as R6_SHELL saw in the
  browser: clear by 28 px). probe_pg_data 40 ok / 3 FAIL -> **41 ok / 2 FAIL**.
- **Home B5 (the Felt Ball with one squishy out on a phone): NOT fixable by a spot.** With the pill at 670 the row's own proof still finds none: "no spot can
  with the shipped camera (3597 spots tried)"; it covers 48.3 px of the body (16.9 %). The one-out portrait view holds the ball within about +-0.31 m of the
  middle, so every spot is in front of or behind the body: it needs the framing (RENDER, PLAYGROUND_BUILD 24.1 (a)) or the shell (R7_SHELL's item 3).
- **Cloudloft tall (3 spawn problems): NOT fixed; an owner's / orchestrator's call stands.** Five spawn spots 1.0 m apart and 0.9 m clear of every collider
  need the whole 2.8 m width of the tall bounds over 1.64 m (the 2-1-2 pattern) + 0.9 m each side = 3.44 m of the 6 m depth; the 2.1 m Cloud Nest, the three
  Puff Pads (0.9 m discs), the Kite Swing's 0.9 x 1.58 m sweep box and the arch posts must share the other 2.56 m. Even with the nest's gap toward the spots
  (a spot on its gap axis may be 1.11 m from its centre, 1.49 m at x +-0.575) it does not fit; a search over nest position and gap direction, ball, arch and
  swing depth (scratch `S/x/cl.py`, the probe's own distance rules) found no 5-spot set. What would: a 4-spot rule for this tall layout, the Kite Swing out
  of the tall layout, or a smaller shared nest together with one of those (the nest alone at R 0.85 gains 0.2 m, not enough).

**Probe rows for it** (`_harness/probe_life.ts` LF-28, kinematic host, light): three wholes, 300 s, no input: B04 acts on >= 3 different things at each S2 / S3
place (Ripple 5, Frostbell 5, Rainleaf 4, Lanternroof 3, Cloudloft 3+); every USE LIFE writes carries the thing's own verb (0 off), the putty never starts a
hop use, no ride starts while the host's lift is off; with `lifeSetSelfRides(w, true)` a squishy walks to the Leaf Teeter, asks the lift with b = 1 and,
once the host's RIDE is on, writes one USE ROCK by SELF. `_harness/probe_life_selfuse.ts` SU-01..SU-03 (heavy, the real physics) is the measure itself.

## 2. Opening Ripple Shore, Frostbell Ridge and Rainleaf Garden
- **Re-specified rows** (each with the reason in the code: "this S1 build ships only Home and Hearthlog" -> the places that ship, read from PLACE_INFO):
  probe_quests **QU-06** (row 3: stamps open exactly the shipped places whose threshold they reach, never an unshipped one: checked at 20 stamps and at the
  most this build's shown quests give), **QU-14** (row 3: the shown set per shipped set: Home's 10, Hearthlog's 10 and X1 X2 X3 X6 X10 with the two; + R, I,
  G 1..10 and all ten X once the three ship; an unknown set fails with its name; row 5: the hidden quest whose own events must not complete it is X8 in the S1
  build, the first hidden quest with a script (L1) once X8 is shown; row 4's label "this S1 build" -> "this build", its check was already the shipped set);
  probe_pg_lifequests **QU-13, QU-13 (low), QU-08, QU-03** (the scripted session plays Home and the cabin only: the rows check the S1 places' quests, H1..H10,
  C1..C10, X1 X2 X3 X6 X10, in every build that shows them; the S2 places' quests have their own rows: QC, R7, QL, and SU-01).
- **Dry run** (scratch tree = HEAD + my files + `R6_SHELL_open_s2.patch` by `patch -p3`): probe_quests all pass (3 NOT RUN), probe_pg_lifequests 16/16,
  probe_life 124 ok / 1 (LF-02 known), probe_journal all, probe_pg_data 41 ok / 2 (the two of section 3), probe_chatter 42/42. Without the flip the same.

## 6. Not done / open (final, 11:1x)
- Lanternroof meets the self-use target only with R7_SHELL's host (1b: 5/5); my lane's tree alone 3/5 (run 5). The Lantern Line is walked but rarely struck
  (its lanterns hang 0.26..0.54 m up; with R7_SHELL's CHIME_V rule a slow walker's touch is not a USE): no party in runs 3..5 or 1b got a Lantern Line record.
- Pads by themselves stay off (`PADS_OK = false`) until PHYS fixes the rim pin (section 5); the Vane Disc is ridden only through R7_SHELL's host turn.
- DT-01 Home B5 and Cloudloft tall (section 3): not fixable by data; RENDER / the owner.
- shellview/node_checks: the S1-only S2 dev-path row needs R7_SHELL's re-spec (section 5); the integrated build's B7 wake gate 11.8 % vs 10 % (section 4).
- LF-02 (allocation) as at HEAD. Lanternroof and Cloudloft are NOT set shipped (the orchestrator's step).
