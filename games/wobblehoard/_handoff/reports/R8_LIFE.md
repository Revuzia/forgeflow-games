# R8_LIFE: round 8, the LIFE lane (src/life, src/data, src/physics, src/audio, src/core/quests.ts, src/collection/journal*.ts and their probes; ports 5367, 5369). No git write command is run.

Brief: the orchestrator's round-8 task ("fix all the missing items then deploy"): SESSION3.md machine rules; D-95 revised, D-96; R7_LIFE / R7_SHELL "Not done",
known issues and requests. No earlier R8_LIFE report existed: first round-8 life engineer. Started 2026-11-18 14:50 UTC at HEAD 5578962b7 (working tree clean).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r8_life/` (`S/` below).
The other engineer this round is R8_SHELL (src/shell, src/ui, src/input, src/render, shell harness).

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 0 | baseline (tsc, my probes on HEAD) | DONE 14:58 (section 0) |
| 1 | SQUIRT: a squishy the player set in water stays to soak (R7_SHELL request 8) + probe row | DONE 15:40 (section 1): SQ-01 (real physics + host) and LF-29 pass; HEAD fails SQ-01 |
| 0b | the seven-place build (R8_SHELL applied R7_SHELL_open_s3.patch): probe_quests QU-14 x2 re-specified | DONE 15:45 (section 0b) |
| 2 | Moss Bouncer on a phone: tall-layout pad drop bounces (request 9) + node row per pad per tall layout | DONE (section 2): physics carry lift + no tack while carried + no depth cap on the carrying hand; PH-16 (round 8) 30/30 (HEAD 0/30); physics A/B: no row lost |
| 3 | Home's Music Box behind the first party slot (request 7) + probe_pg_data row | ROW WRITTEN (DT-18, FAILS honestly: section 3); no data spot can pass under the existing Home rules; R8_SHELL declined their options with reasons: the owner's call |
| 4 | DT-01: camera model ballFrames (request 1); Cloudloft tall spawns | DONE: Home B5 passes (model + Felt Ball TALL spot re-laid); **Cloudloft tall passes** with R8_SHELL's per-layout pitch range (camPitch, hx 1.8) and a re-lay (section 4); probe_pg_data 43 ok / 1 FAIL (DT-18) |
| 5 | Vane Disc self-use (request 3); Lanternroof / Cloudloft SU-01 | DONE: SPIN, LF-30 ok; SU-01 Lanternroof 5/5; Cloudloft 3/5 with HEAD's host (HEAD 3/5 too), 4/5 = pass on the integrated snapshot (section 9) |
| 6 | LF-02 allocation per 1000 ticks | EXPLAINED (section 6): Maglev / baseline-tier code of the per-think decisions boxes doubles; not removed; LF-02 stays FAIL |
| 8 | R8_SHELL's requests (1), (3), (4), (5), (6), (7 G0b) | DONE / answered (section 8; G0b: +97 B for this lane, not met) |
| 9 | final regression on the integrated snapshot | DONE (section 9) |
| 7 | SOUND measured offline: per-sound table + mix | DONE (section 7): Home's thing strikes were SILENT before a trip (fixed in engine.ts); 76 sounds, no clip, no DC, no cut-off; 14 mixes + the worst moment pass the three rules |

## 0. Baseline (HEAD 5578962b7 = round 7's integrated code; `S/tree_head` = `git archive HEAD`; `S/probes.sh`, logs `S/base/`, one probe at a time)
tsc 0 errors (2.0 s). probe_life **124 ok / 1 FAIL** (LF-02, known: new-space growth 88752, 152384, 80128, -13259240, 103488, 81064 B per 1000 ticks);
probe_quests all ok, 3 NOT RUN; probe_journal all ok; probe_pg_data **41 ok / 2 FAIL** (DT-01 Home B5 one out on a phone; DT-01 Cloudloft tall, 3 spawn problems);
probe_pg_lifequests 16/16; probe_chatter 42/42; renderview/pg_node_checks 40 ok / 0. = R7_LIFE's final numbers. (shellview/node_checks on this code: R7_SHELL 6b,
179/180, SH-22 B7 wake gate 11.8 % vs 10 %: not re-measured.)

## 0b. The seven-place build (R8_SHELL applied `R7_SHELL_open_s3.patch` in the working tree: Lanternroof and Cloudloft ship)
probe_quests then FAILED two QU-14 rows (2 FAILED; 3 NOT RUN), both written for a five-place build. **Re-specified** (`_harness/probe_quests.ts`, the reason in the code):
(1) "this build shows exactly the shipped places' chapters": the shipped-set table gains the seven-place set (H, C, R, I, G, L, U 1..10 and all ten X; an unknown set
still fails with its name); (2) "the tracker never shows a hidden quest, and hidden X does not complete from its own events": with all seven shipped no kept quest is
hidden, so its second half runs on the S1 build's definitions (Home and Hearthlog shipped, built in the row) with X8, its hidden finale there (and now also asserts X8 IS
hidden there); the tracker half is unchanged. probe_quests: **all run checks pass, 3 NOT RUN** (as at HEAD). probe_pg_lifequests 16/16, probe_chatter 42/42, probe_journal
all ok on the seven-place tree.

## 1. SQUIRT: a squishy the player set in water stays to soak (DONE)
**Reproduced first** (scratch `S/sq.ts`: the real physics and the shell's life host as `probe_life_selfuse.ts` builds them; Wisplet CARRIED by `body.grab` into Ripple's
Rock Pool, autonomy on): set down at the pool's front (2.30, -0.12), HEAD's LIFE ran B08 afterglow, B15 zone, B02 notice, then **B05 bask at 7.5 s walked it out** (soak
0.67 at 10 s, then falling 0.1 a second: 0 by 16 s); set down on or against the Bob Ring (the pool's centre) the host's RIDE held it 20 s instead (a floater is a ride),
which is why a carry to the centre seemed to work. R7_SHELL's browser row saw the first case (soak 0 after 24 s, Wisplet at the Driftwood Log).
**Fix (LIFE; `data/life.ts SET_IN_WATER`, `life/brain.ts touchPass` + `mayMove`, `life/act.ts gateStart`, `life/world.ts` 3 arrays, `life/step.ts` resets)**: a hold that
included CARRIED, let go, whose body is down in water (LIFE's water zone or physics' IN_WATER, not airborne) within 4 s, starts a STAY: no self-started motion (mayMove
false unless asked; gateStart refuses a new mover token, so a moment's walk that would take it as a partner does not start either) until the stay ends. A foam stays until
its soak would reach 1 + 6 s (a marshmallow 0.06/s: about 22 s; slow rise about 12 s), at least 12 s, at most 25 s; any other family 12 s. A new touch or the player's ask
("Go play with...") ends it; none for a carry let go on dry ground or for a squishy in water by itself; LF-18's "out after 30 s in water" is later than the 25 s cap.
Zero allocation (typed arrays, a per-family soak-rate table).
**Rows**: `probe_life_selfuse.ts` **SQ-01** (NEW, runs first; `--squirt-only` runs it alone, 9 s wall, light): real physics + host, autonomy on: Wisplet carried by the
player into the Rock Pool stays in the pool all 20 s and starts no motion of its own (LIFE's mover token never taken), soak >= 0.5 (from 7.5 s, 1 at 20 s); then Dollop is
carried beside the pool and Wisplet squeezed 0.6 s by a physics finger: the squirt arc drawn (`squirtFx` 1) and a **SOCIAL SQUIRT record at Ripple Shore
(wisplet -> dollop)** = R7's record (probe_pg_lifequests R7 already proves that record completes R7). **On HEAD: FAIL** ("starts no motion of its own (first at 7.5 s)");
**on my tree: ok, ok**. `probe_life.ts` **LF-29** x2 (kinematic, light): a marshmallow carried into the pool stays 22.2 s with 0 own motions (first after: 29.6 s), a gummy
12.0 s with 0; the stay ends on a new touch and on the ask; none on sand or after walking in by itself. probe_life **126 ok / 1** (LF-02, known).

## 2. Pads: a drop from carry height did not bounce (DONE)
**Measured first** (scratch `S/x/pad.ts`, `S/x/pad2.ts`: buildPropWorld of each place and layout + setBounds as the shell sends them + a real `grab` carry, no shell):
a body DROPPED on any pad from 0.1 m or more bounces (5 kicks) in every layout, wide and tall: the tall layout data is not the cause (Rainleaf's tall Moss Bouncer at
(-1.45, -1.3) lies 0.05 m past the bounds' side; the corral moves a body on it 5 cm inward, still on the pad). But a body CARRIED by the hand with the hand target at the
floor (what a phone's drag plane gives when the carry comes toward the camera: R7_SHELL 5B) was let go at its REST height and never bounced: **0 kicks on every pad of
every layout** (HEAD), and the carry ended up to 0.9 m short of its target. Three physics causes (src/physics/softbody.ts):
(1) the carry's floor was the body's rest height (`hfloor`, the carry's `tyc`): a low hand held the body AT the floor, so the let go set it down with no fall, and a pad
kicks a landing only (PAD_LAND 0.3 m/s); (2) the table's tack layer (`glue`) still held a carried body's foot, so a hand slightly above the floor stayed glued: the body
hung stretched with its lowest point at 0.000 m; (3) the GROUND FIX depth cap (`reach`) measured "how far into the body" from where the grab BEGAN (t0), which a carry
leaves behind: a low target was pushed back along the grab's tilted normal, so the carry stopped short (Cloudloft's Puff Pad: 0.91 m short).
**Fix**: (1) `CARRY_LIFT_K` 0.2: a carried body is held at least 0.2 x its rest radius above its rest height (10 cm for a Dollop of R 0.51; the hand's floor likewise);
(2) the tack layer is off while carried (`glue x (carried ? 0 : glueK)`: "a carried body is in the hand, not on the mat"); (3) the depth cap is not applied to the hand
that carries (the carry keeps its own limits: at most maxPull ahead of the body, never under the lifted rest height). A let go from the lowest carry is now a 10 cm fall
(about 1.4 m/s): the pad kicks it; anywhere else it lands with a small thud, as a let go from higher always did.
**Row** (`_harness/probe_playground.ts`, the `pad` section, PH-16 (round 8)): EVERY pad of EVERY layout, tall and wide (Home's Bounce Pad, the Moss Bouncer, the three Puff
Pads: 10 pads; jellygel in the quick set, + marshmallow and sticky stretch with `--only=pad`/`--full`): carried from 1 m in front at the lowest height the hand can hold
it (hand target at the floor), let go over the pad's centre: >= 1 kick. **HEAD: 0 kicks on all 30** (let go at centre 0.395 m = rest height); **mine: 30/30, 5 kicks
each, let go 0.01 m off the pad's centre**. probe_playground --only=pad 3/3.
**Physics regression A/B** (HEAD tree vs HEAD + this lane, the same commands, one at a time; logs `S/phys_head/`, `S/phys_mine/`):

| probe | HEAD | mine |
|---|---|---|
| probe_softbody | 115/116 (G1p fails) | 115/116 (the same G1p) |
| probe_lock | 81/87: 3 known open + 3 FAIL (orders crimpo, slots cushlet, perf) | 82/87: 2 known open + the same 3 FAIL (perf: 6 locks 1.36 ms vs 2 bodies 0.85 ms; HEAD 1.03 vs 0.67: a CPU-time ratio row, the same verdict) |
| probe_lock_shell | 96/96 | 96/96 |
| probe_gestures | 160/160 | 160/160 |
| probe_playground (quick) | 73/73 | 74/74 (+ PH-16 round 8) |

No row passes on HEAD and fails with the change; one "known open" lock row now passes.

## 3. Home's Music Box behind the first party slot (row written; the fix needs the shell / render lane)
**Row DT-18** (`_harness/probe_pg_data.ts`, NEW, `hideRow`): for every Home thing with a collider (not the rug), parties of 1 to 5 from its fromN, phone and desktop, 10
scales x 3 rest shapes: at most 50 % of its on-screen silhouette (the box of its projected footprint corners at the floor and its top) behind NEARER slot bodies (the
model's bodyEll, nearer by depth) and its centre (the tap point) behind none. **It FAILS** (model, worst over scales and shapes): WIDE Music Box 45 / 54 / 41 / 42 % at
n 2..5 and its centre behind a body at n3; WIDE Warm Lamp 70 / 95 / 35 % at n 3..5; WIDE Keepsake Shelf 36..68 %; WIDE Bounce Pad 73..78 %; TALL Keepsake Shelf
95..87 % at n 2..5 (the Felt Ball 34..45 % WIDE, every TALL spot but the shelf 0 %).
**No data spot can pass** (`DT18SEARCH=<id>:<phone|desktop>[:box]`, a 0.05 slot-unit grid, each candidate checked by DT-18 AND the whole existing Home row for that
thing): the WIDE Music Box over the back half (-3.2..3.2 x -3.2..-0.3, 8 000+ spots) and the front (z 0.2..1.8, also with fromN 3): **only its current spot passes the
existing Home rules** (the rest fail "n2..5 out of view" (the front is under the bottom HUD band), "behind a body", slot gap or off the felt); the TALL Keepsake Shelf
the same (only its current spot). Each Home spot is pinned by the round-5 rules; the party row covers the back of the felt at 3 to 5 out and the front is below the HUD.
**The model is also not the browser**: in R7_SHELL's shot (`r7_shell/final1a/shots/pg_home_party_desktop.png`, 1280 x 800, 3 out) the party is drawn about 200 px right
of the frame's centre and larger (Dollop's disc (1120, 330) r 130 px, its slot 1.455 m) while the model puts that slot body at (1014, 389) r 144 and the box at y 410
(the browser: 321): the model's box TOP clears Dollop's shoulder, the browser's box is wholly behind Dollop. One known difference fixed here: the model's desktop
STAGE_INSETS bottom 78 -> **130** px (R7_SHELL 5A' measured it; the hint pill counted since round 6). That moves the band framing's lens, not the relative positions,
and it shows a real round-6 regression the model had hidden: **DT-01 Home now FAILS "WIDE snoozerug: use spot n2 not wholly in view"** (the second napper's spot).
(Also kept the old DT-01 rows as they were.) Request to R8_SHELL below (7).

## 4. DT-01: the camera model in line with the render; Home B5; Cloudloft tall
- **The model gains R7_SHELL's `ballFrames`** (`_harness/probe_pg_data.ts cam()`, stage.ts framingFor read line by line; its text pinned in `stageModel` so a change
  fails the row): on a portrait frame with ONE whole body at Home and the Felt Ball out, the ball's SPOT (x body scale, BALL_FRAME_R 0.3) counts like a waiting capsule:
  the solo extents (the body's silhouette reach hw x 1.06 + 0.05 s, the ball's box), and unless they already fit at the current want (+0.06) the camera pulls back to
  ((ax1 - ax0) / 2 + 0.06 + 0.12 (az1 - az0) / 2) / hwPer and aims at their middle (mx, TARGET_Y s, mz x 0.8); visibleTable follows that aim (stage.ts 1301). Iterated
  with SR2's band demand to the fixed point, as before. The B5 one-out search now builds each candidate's own camera (the framing moves with the ball's spot).
- **The desktop's reported bottom row 78 -> 130 px** (STAGE_INSETS; R7_SHELL 5A' measured it): see section 3 (it exposed the WIDE Snooze Rug's second-napper spot out
  of view at 2 out: **re-laid** `useSpot` (-0.25, -1) -> **(-0.42, -0.91)**, still 2R from slot 0 (RUGSEARCH: the angles 25..95 and 335 degrees pass; the nearest taken)).
- **Home B5 one out on a phone: PASSES** after re-laying the Felt Ball's TALL spot (0.76, 1.06) -> **(0.75, 1.20)** (the model with ballFrames: at the old spot it
  covered 4.8 px of the body (1.8 %) in the worst scale and shape; R7_SHELL's browser measured Dollop clear by 33.7 px there, so the model is the stricter): now covers
  0.0 px (0.3 % by the area sample), 0 % hidden, 0.48 m from the body, 1.05 m of first-play roll. DT-01 Home (every thing, both frames, n 1..5) ok.
- **Cloudloft tall (3 spawn problems): not fixable by data at hx 1.4** (R7_LIFE's search stands; re-derived): the tall bounds hx 1.4 leave spawn x in +-0.575, so five
  spots 1.0 m apart are a zigzag 2.4 m long, and 0.9 m of clearance around it needs a free 2.6 x 4.2 m rectangle of the 2.8 x 6.0 m area. Request to R8_SHELL (11).
- **Cloudloft tall: DONE (16:50) with R8_SHELL's answer (their LIFE (5))**: `LayoutDef.camPitch?` (data/places.ts, optional, additive); Cloudloft's tall layout
  `camPitch: [0.6, 0.9]`, bounds hx **1.8** (RD-17's bars: the model's shipped camera frames it at pitch 0.60, lens 35, a 1 m squishy **104.7 px at the front, 87.7 px
  at the middle** of 390 x 844, bars 100 / 80), and a **re-lay** found by a new dev tool in probe_pg_data (`LAYOUTSEARCH=cloudloft:<steps>[:seed]`, a local search
  from the round-6 draft under every DT-01 rule, the shipped camera, and four rules of its own: the three pads 1.0 m apart with their centres inside the bounds (the
  draft had two at z -3.2, behind the bounds), every thing's front at most 2.9 m (the framing's depth stays R8_SHELL's), RD-17's bars, and the arch's middle where
  brain.ts selfPoint ARCH can stand a squishy (the draft's arch at x -1.5 was outside it: never usable by itself on a phone)). Now: Puff Pads (-1.11, -2.58) in the
  Updraft (-1.11, -2.68), (0.21, -2.72), (-1.58, -1.67); Sunbow Arch (-0.54, -2.65) along z beside the first pad; Kite Swing (1.42, -1.64) along z, push (1.42, 0.36);
  Cloud Nest (0.50, 1.75) gap toward the middle (yaw -1.64); Cloud Ball (-1.08, 2.54); Breeze and Sun full width (hx 1.8); spawn (-0.95, 0.5), (-0.9, -0.5),
  (-0.05, 0.05), (0.05, -0.95), (0.95, 0.05). **DT-01 Cloudloft tall 0 problems, and in the shipped camera 0 problems.** `SPAWNMAP=<id>:<tall|wide>` (the valid spawn
  grid and the greedy 1.0 m set) is the other new dev tool. The render (render/places/cloudloft.ts) and physics read these from the data (p.tx/tz included).
- **R8_SHELL's LIFE (3), (5), (6) in the camera model** (`placeCam`): the pinned lines now are later-life.ts `const pr = ... camPitch ?? next.camera.pitch;` and
  `stage.setPlayBounds?.(..., pr[0], pr[1])`, place.ts `return fitPlace(..., pitchMin, pitchMax);`, `if (top > 0 && w < 0.9 * h) top += w > 380 ? PLACE_COL_PX :
  PLAY_SLOT_PX;`, `export const PLAY_SLOT_PX = 52;`, `export const PLACE_COL_PX = 156;`; the model passes the layout's pitch range and adds 156 (the top-right
  column's foot) on a tall frame wider than 380 px, 52 otherwise. Every strict place's camera row passes (14 rows).

## 5. The Vane Disc by itself (code done; SU-01 measurement below)
`SELF_USE.SPIN` (17, data/life.ts; the pop dome likes it): a turntable standing in a wind zone with gust data (`world.ts gustZoneAt`) is a by-itself thing. `selfOk`: a whole,
while a gust of that zone blows (until 0.8 s before its end) or the next one starts within 7 s (LIFE's own gust clock, which the host's Night Breeze and the disc's
turn follow); `selfPoint`: the disc's middle; arrived: a swirl bubble, the use counted (`selfDone`), and it stays until that gust has ended + 0.5 s (at most 16 s).
LIFE writes no record: the host's `vaneStep` writes the rider's USE SPIN by SELF when the disc turns under it (R7_SHELL 2). **LF-30** (probe_life, NEW): in the Night
Breeze it is a SPIN thing (with the gusts off, none); a pop dome at Lanternroof starts it and stands on the disc's middle during a gust (75 of 350 gust samples in
120 s; traced: on it from 16.7 s through the gust 16.6..19.1 s). probe_life 127 ok / 1 (LF-02).
**SU-01 measured** (`probe_life_selfuse.ts places=lanternroof,cloudloft`, the real physics + HEAD's host, 5 parties x 300 s, `S/su_r8a.log`): **Lanternroof 5/5**
(4 4 5 4 4 things: the Vane Disc by EVERY party now, its USE SPIN by SELF from the host; Moon Dish, Hammock, Star Scope, Chimney Corner; R7's integrated build 5/5,
HEAD's host alone 3/5 in run 5) - **Cloudloft 3/5 FAIL** (3 2 2 3 4: Cloud Ball, Cloud Nest, Sunbow Arch, the Updraft once). **HEAD's tree gives the same, 3/5
FAIL** (3 3 2 2 3, `S/su_head_cloud.log`): Cloudloft's SU-01 fails at HEAD too (R7's 4/5 in 1b was a good draw), not a regression of this round. The cheap levers
are gone: the Puff Pads by themselves need the pad rim pin fixed (PADS_OK off; re-tested with this round's physics, `S/tree_mine/_harness/xpadpin.ts`: after the
bounces a scoot away from the pad stops 0.78 m from its middle with its scoot released) and the Kite Swing is a ride the host lifts rarely. Not done.
SU-02 2/2, SU-03 ok (most 3 episodes; raw host records most 12).

## 6. LF-02 (allocation per 1000 ticks): what allocates, why it is harmless (not removed)
Scratch scripts `S/lf02/xalloc*.ts` (the probe's own crowd: 6 wholes + a cut squishy's 10 pieces in the cabin, high tier):
- **LF-02 as written measures a FRESH world made after the JIT warmed on three others**: `--trace-deopt` shows every optimized LIFE function (lifeStep, think, behave,
  choose, socialPick, travelStep, inBounds... 40 of them) deopting with "wrong map" on its first call with the new world (`--trace-generalization`: the world's
  fields go const -> mutable at lifeSetPlace / copyPlace), so its windows run partly in lower tiers: 88 752 .. 152 384 B per 1000 ticks.
- **One world for the whole run** (the game's case: one LIFE world a session), warmed 20 000 ticks, still allocates **33 392, 50 896, 133 248, 68 064, 185 248,
  228 544 B per 1000 ticks** (warmed 7 000: 818 304 .. 96 576). `%GetOptimizationStatus` after the 20 000 ticks: lifeStep, behave, choose, integrate run in TurboFan,
  but the per-THINK decision code that runs only a few times a second sits in **Maglev**: clearOfThings, inKeepOut, freeSpot, inBounds' callers, freeTarget,
  travelTo, emitHop / emitPose / emitScoot, startMoment, updateMoment, beginPicked, pushEvent (and a few in Ignition/Sparkplug: emitCancel, abortFor, addLook...).
  The sampling heap profiler (minor-GC objects included) on that warmed world puts LIFE's allocation in exactly those: inKeepOut via clearOfThings / freeSpot
  (168 KB of the sampled 950 KB over 6000 ticks), updateMoment 54 KB, inBounds (chunkThink) 45 KB, emitReact 42 KB, startBask 27 KB, idleLook 24 KB, freeTarget 18 KB,
  runUse 16 KB: double temporaries boxed as 16-byte HeapNumbers by mid-tier code. `--no-maglev` makes it worse (332 360 .. 556 192 B: Sparkplug boxes more), which
  confirms the tiering cause; no single site allocates (no object, array or closure is made per tick: integrate's per-tick path is ~0).
- **Why it is harmless**: 33..230 B a tick = 2..14 KB a second at 60 fps for 16 characters; V8's young generation (1 MB semi-space growing to 16 MB) then needs a
  scavenge for LIFE's share every ~70 s or more, each well under 1 ms for dead HeapNumbers, against a 16.7 ms frame (the render and physics allocate far more:
  probe_collection's C08 row and CUT-D's per-step allocation are the known ones). Removing it would mean rewriting the target searches and moments in integer
  milli-units everywhere (as round 4 did for the per-tick path), a large change for no visible gain, so it is not done this round; LF-02 is NOT loosened and stays FAIL.

## 7. SOUND: every sound rendered offline and measured (DONE)
**Tool**: `_harness/sound_survey.ts` (NEW, dev only, no dependency): the REAL engine (`createAudio()`) run offline in Chromium through `_harness/audioview/engine_offline.js`
(an OfflineAudioContext stands in for the live one; the engine's own clock, timers and lazy imports), through the game's master chain at the default settings
(master 0.8, music 0.45, Voices 0.6, Place sounds 0.5). Per sound: peak and active RMS (dBFS), duration above -60 dB re its peak, spectral centroid, clipped samples
(|x| >= 0.999), DC, a click at the start (the largest one-sample step in the first 0.5 ms, re the peak; > 0.5 flagged), a cut-off (the shortest fall of the 1 ms
envelope from -20 to below -60 dB re its loudest ms anywhere in the render: under 2 ms flagged; "none" = the sound fades past the render end or never falls that far),
the onset after the call (ms), and any sound more than 12 dB over its group's median peak. Run: `node _harness/sound_survey.ts --port=5367 --json=FILE` (87 s; logs
`S/sound4.log`, `S/sound4.json`, the tunes `S/sound4_thing.*`).

**What it found and what was fixed (src/audio)**
- **Every place thing's strike was SILENT at Home until the player had travelled** (`S/sound1.log`, HEAD's engine: chime, splash, crunch, boing, bell, tick, rustle,
  whoosh, the held creak, the squirt: peak -240 dBFS). Their voices live in the away chunk (ambience.ts / things.ts), which only `loadAmbience` (a trip) imported;
  life_voices `prop()` dropped a strike while `h.away()` was null. At Home that is the **Bounce Pad's boing and the Keepsake Shelf's and Music Box's bell** on a first
  play. **Fix** (`engine.ts`): `ensureAway()` imports the chunk and makes its Ambience once (shared with `loadAmbience`, which now calls it); `prop()` of any kind but
  the ball with no away chunk yet starts that import and plays a copy of the strike when it arrives within `AWAY_LATE_S` 0.35 s (else it is dropped, counted). The chunk
  still never loads at boot or at the first unlock (only at the first such strike). Measured with the chunk cached: the strike sounds 15..35 ms after the call.
  `life_voices.ts`: the three held-voice blocks (ball roll, creak, rustle / whoosh) are one helper `hold()` (same behaviour; it paid for some of the bytes below).
- Not defects (by design, stated): a creak **strike** has no voice (a hinged thing's sound is its held creak while it moves: the row "creak (held 2 s)"); the
  cabin fire's crackle is a **swell of the cabin's bed**, measured against the same bed (same seed) without it: **+3.6 dB over its 5 s** (designed +4 dB roar and a
  denser crackle); the **tick** is a 4 ms click by design (its 0.25 ms rise is the sound) and no shipped thing uses it (Cogwhistle was dropped, D-96).
- The four styles without a low-pass or thinning (home, shore, garden, cloud) render the **same first 30 s** (a style only reweights the field drift; the first field
  is shared): measured equal to 0.1 dB. Noted, not changed (a design point: a style is heard once the field first drifts).

**Per sound** (master 0.8; a voice row is four phrases (greet, joy, huff, sleepy) and a piece's peep through the Voices bus; ambience / music rows from 2 s):

| group | sound | peak dBFS | RMS dBFS | dur s | centroid Hz | start step | fall ms | onset ms | clipped | DC | note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ambience | hearthlog | -29.4 | -45.1 | 18 | 1407 | 0.08 | none |  | 0 | -2.8e-06 |  |
| ambience | ripple | -27.6 | -46.1 | 18 | 971 | 0.03 | none |  | 0 | -3.9e-06 |  |
| ambience | frostbell | -32.1 | -51.7 | 18 | 3145 | 0.08 | none |  | 0 | 8.3e-09 |  |
| ambience | rainleaf | -24.4 | -51.3 | 18 | 5504 | 0.03 | none |  | 0 | 2.3e-07 |  |
| ambience | lanternroof | -28.1 | -45.1 | 18 | 1371 | 0.06 | none |  | 0 | -5.8e-06 |  |
| ambience | cloudloft | -27.7 | -47.9 | 18 | 3126 | 0.09 | none |  | 0 | -5e-09 |  |
| music | home (home) | -15.7 | -30.6 | 30 | 611 | 0 | none |  | 0 | -2.5e-07 |  |
| music | hearthlog (cabin) | -15 | -30.2 | 30 | 629 | 0 | none |  | 0 | -2.5e-07 |  |
| music | ripple (shore) | -15.7 | -30.6 | 30 | 611 | 0 | none |  | 0 | -2.5e-07 |  |
| music | frostbell (ridge) | -15.7 | -31.1 | 30 | 594 | 0 | none |  | 0 | 1.1e-07 |  |
| music | rainleaf (garden) | -15.7 | -30.6 | 30 | 611 | 0 | none |  | 0 | -2.5e-07 |  |
| music | lanternroof (roof) | -15.1 | -30.3 | 30 | 627 | 0 | none |  | 0 | -2.5e-07 |  |
| music | cloudloft (cloud) | -15.7 | -30.6 | 30 | 611 | 0 | none |  | 0 | -2.5e-07 |  |
| thing | ball | -17.7 | -31.1 | 0.2 | 259 | 0.01 | 144 | 14 | 0 | 6e-08 |  |
| thing | chime | -17.4 | -32.1 | 1.28 | 611 | 0.01 | 830 | 17 | 0 | -8.8e-08 |  |
| thing | splash | -22 | -38.4 | 0.36 | 2303 | 0.03 | 59 | 17 | 0 | -1.9e-08 |  |
| thing | crunch | -30.6 | -48.2 | 0.17 | 4146 | 0.01 | 11 | 21 | 0 | 6.8e-10 |  |
| thing | boing | -20.2 | -32.6 | 0.63 | 233 | 0 | 281 | 17 | 0 | 9.2e-08 |  |
| thing | bell | -18.9 | -32.9 | 2.08 | 620 | 0.01 | none | 17 | 0 | 2.2e-07 |  |
| thing | tick | -38.7 | -51.9 | 0.01 | 3314 | 0.57 | 15 | 33 | 0 | -1.1e-09 | click at start |
| thing | rustle | -28.7 | -44.6 | 0.63 | 5949 | 0.05 | 10 | 35 | 0 | 2.7e-08 |  |
| thing | whoosh | -32.8 | -47.1 | 0.72 | 2157 | 0.03 | 124 | 145 | 0 | -1.5e-08 |  |
| thing | ball (auto, budgeted) | -22.1 | -35 | 0.17 | 259 | 0.01 | 144 | 14 | 0 | 2.2e-08 |  |
| thing | creak (held 2 s) | -35.8 | -49.3 | 1.89 | 785 | 0.01 | 85 | 90 | 0 | 1.3e-08 |  |
| thing | Music Box tune (tune 0) | -20.7 | -36 | 26.52 | 1552 | 0.03 | 865 | 185 | 0 | -1.2e-07 |  |
| thing | kettle whistle (tune 1) | -27.1 | -31.6 | 3.6 | 1132 | 0 | 68 | 205 | 0 | -3.5e-11 |  |
| thing | squirt (splash 0.3, size 0.12) | -25 | -41.2 | 0.29 | 2253 | 0.04 | 45 | 17 | 0 | 6.6e-09 |  |
| thing | splash (a squishy in water: 1.0) | -21.1 | -36.9 | 0.41 | 2381 | 0.11 | 75 | 15 | 0 | 1.5e-08 |  |
| voice | slowrise (capnap, flavour 2) | -29.4 | -36.8 | 5.33 | 548 | 0 | 11 | 6 | 0 | -2.7e-06 |  |
| voice | marshmallow (wisplet, flavour 2) | -29.2 | -36.6 | 5.33 | 629 | 0 | 11 | 7 | 0 | -4.7e-06 |  |
| voice | mochidough (crimpo, flavour 4) | -28.3 | -35.3 | 5.33 | 646 | 0.01 | 10 | 7 | 0 | -7.9e-08 |  |
| voice | jellygel (dollop, flavour 0) | -27.6 | -34.4 | 5.33 | 742 | 0.01 | 8 | 7 | 0 | -2.6e-08 |  |
| voice | waterfill (puddlo, flavour 0) | -28.6 | -34.6 | 5.33 | 530 | 0 | 8 | 7 | 0 | -3.3e-08 |  |
| voice | putty (kneadle, flavour 4) | -28.2 | -34.7 | 5.33 | 672 | 0 | 10 | 7 | 0 | -3.6e-08 |  |
| voice | stickystretch (twangle, flavour 1) | -28.5 | -38.5 | 5.33 | 1145 | 0.01 | 9 | 7 | 0 | -1.1e-10 |  |
| voice | slimegoo (wrigglo, flavour 1) | -28.7 | -38.9 | 5.33 | 1063 | 0.01 | 7 | 7 | 0 | 1.2e-09 |  |
| voice | firmsilicone (boingle, flavour 5) | -28.1 | -37.7 | 5.33 | 1240 | 0.01 | 7 | 7 | 0 | 1.8e-08 |  |
| voice | popdome (dimpla, flavour 5) | -28.1 | -37.8 | 5.33 | 1354 | 0.01 | 8 | 7 | 0 | -4.6e-09 |  |
| voice | gummy (chunkle, flavour 0) | -28.6 | -34.2 | 5.33 | 603 | 0.01 | 8 | 6 | 0 | -2e-08 |  |
| voice | beadsqueeze (crumbit, flavour 3) | -28.2 | -38.8 | 5.33 | 956 | 0.03 | 10 | 5 | 0 | -5.4e-08 |  |
| interaction | poke | -13.6 | -28.2 | 0.14 | 424 | 0.03 | 64 | 14 | 0 | 8.6e-08 |  |
| interaction | land | -12.8 | -26.9 | 0.12 | 189 | 0.01 | 80 | 14 | 0 | -1.8e-07 |  |
| interaction | pop | -12.8 | -26.9 | 0.06 | 1523 | 0.23 | 53 | 14 | 0 | -4.2e-08 |  |
| interaction | release | -13.1 | -28.2 | 0.38 | 334 | 0.02 | 301 | 14 | 0 | -2.9e-07 |  |
| interaction | bump | -15.3 | -27.6 | 0.15 | 238 | 0.01 | 80 | 14 | 0 | 2.7e-07 |  |
| interaction | lift | -12.9 | -27.5 | 0.22 | 375 | 0.02 | 121 | 15 | 0 | -8.4e-08 |  |
| interaction | toss | -12.8 | -29.3 | 0.21 | 2846 | 0 | 96 | 17 | 0 | -4.5e-08 |  |
| interaction | strand | -13.4 | -28.4 | 0.11 | 1621 | 0.15 | 23 | 14 | 0 | 6.9e-08 |  |
| interaction | autoThud (land) | -15.3 | -30.4 | 0.13 | 181 | 0.01 | 78 | 14 | 0 | 5.3e-08 |  |
| interaction | meterFull | -13.6 | -26.6 | 0.2 | 809 | 0.12 | 108 | 14 | 0 | -5.2e-08 |  |
| interaction | capsule grab | -15.9 | -27.6 | 0.28 | 831 | 0 | 161 | 14 | 0 | 3.2e-07 |  |
| interaction | capsule crack | -16.1 | -34 | 0.04 | 2392 | 0.46 | 21 | 14 | 0 | 1.6e-09 |  |
| interaction | capsule burst | -10.3 | -27 | 0.36 | 899 | 0.11 | 68 | 14 | 0 | 1.1e-07 |  |
| interaction | reveal common | -10.2 | -26.9 | 0.6 | 321 | 0 | 219 | 14 | 0 | 4.5e-08 |  |
| interaction | reveal uncommon | -11.8 | -26.2 | 1 | 599 | 0 | 131 | 14 | 0 | 5.6e-08 |  |
| interaction | reveal rare | -9.8 | -26.5 | 1.94 | 670 | 0 | 182 | 25 | 0 | 6.9e-09 |  |
| interaction | reveal epic | -10.4 | -25.9 | 2.54 | 798 | 0 | 23 | 30 | 0 | 5e-07 |  |
| interaction | reveal legendary | -9.5 | -26.7 | 3.23 | 795 | 0 | 28 | 30 | 0 | -1.4e-08 |  |
| interaction | reveal mythic | -10.6 | -25.3 | 3.58 | 470 | 0 | 40 | 280 | 0 | 3.6e-07 |  |
| interaction | cut start | -13.2 | -30.8 | 0.28 | 2194 | 0 | 49 | 28 | 0 | -2.3e-07 |  |
| interaction | cut separate | -13.6 | -27.9 | 0.09 | 875 | 0.03 | 44 | 14 | 0 | -1e-07 |  |
| interaction | rejoin | -13.7 | -30 | 0.37 | 595 | 0 | 152 | 15 | 0 | 1.4e-07 |  |
| interaction | squish (held 1.2 s) | -22.4 | -41.4 | 1.11 | 2370 | 0.01 | 59 | 165 | 0 | -3.3e-08 |  |
| interaction | ui tick | -28.9 | -39 | 0.04 | 1175 | 0.03 | 52 | 15 | 0 | -1.3e-08 |  |
| interaction | ui press | -22.5 | -35 | 0.14 | 477 | 0 | 150 | 14 | 0 | -2.8e-08 |  |
| interaction | ui select | -22.4 | -34.5 | 0.17 | 900 | 0.01 | 182 | 14 | 0 | 8.7e-08 |  |
| interaction | ui on | -22.9 | -35.2 | 0.28 | 788 | 0 | 227 | 14 | 0 | -2.7e-07 |  |
| interaction | ui off | -24.1 | -35 | 0.27 | 771 | 0.01 | 225 | 14 | 0 | -2.9e-09 |  |
| interaction | ui open | -22.9 | -35.2 | 0.31 | 791 | 0.01 | 247 | 15 | 0 | -1.6e-08 |  |
| interaction | ui close | -24.3 | -35.6 | 0.29 | 746 | 0.01 | 243 | 14 | 0 | -2.2e-08 |  |
| interaction | ui back | -24.2 | -35.1 | 0.2 | 671 | 0.01 | 180 | 14 | 0 | -3.3e-08 |  |
| interaction | ui error | -22.3 | -35.1 | 0.38 | 444 | 0.01 | 298 | 14 | 0 | -1.2e-07 |  |
| interaction | ui toast | -22.4 | -35 | 0.39 | 1090 | 0 | 336 | 14 | 0 | 7.8e-08 |  |
| interaction | ui trophy | -22.5 | -36.4 | 0.72 | 1088 | 0.01 | 454 | 15 | 0 | -2.1e-09 |  |
| interaction | ui sticker | -22.4 | -33.6 | 0.21 | 846 | 0.01 | 197 | 14 | 0 | 1.5e-08 |  |
| thing | crackle (the cabin fire: its bed swells) | -28.3 | -43 | 8 | 1172 | 0.07 | none |  | 0 | -1.5e-05 | the bed with the puff against the same bed without: 3.6 dB over 4.5..9 s (-0.0 dB before it) |

No sound clips (0 samples at |x| >= 0.999 anywhere), DC is under 1.5e-5 everywhere, no cut-off (the shortest fall is 7 ms: the voices' phrase ends), no click at a
start but the tick's (by design), no sound 12 dB over its group's median. Levels by group: ambience beds -24..-32 peak / -45..-52 RMS; music -15..-16 / -30..-31;
thing strikes -17..-31 peak (the crunch and whoosh the quietest of the used ones); voices -27.6..-29.4 / -34..-39 (all twelve families within 1.8 dB of peak);
the player's own interaction sounds -9.5..-16 (reveals the loudest, -9.5..-11.8); UI -22..-29.

**The mixes** (each place: its ambience + its music + three voices at 4.0 / 4.4 / 4.8 s + the ball and a D5 chime at 4.2 / 4.6 s; stems tapped before the master;
the master's peak after it). Rules: the master never clips; the voices' RMS above the ambience's; no stem's RMS more than 12 dB over the median of the others:

| place (style) | master | master peak dBFS | clipped | voices RMS / peak | ambience RMS | music RMS | things RMS / peak | voices over ambience dB | most over peers dB | rules |
|---|---|---|---|---|---|---|---|---|---|---|
| home (home) | 0.8 | -18.2 | 0 | -38.2 / -28.6 | - | -36.7 | -31.8 / -18.3 | - | 4.9 (things) | ok |
| home (home) | 1 | -14.3 | 0 | -38.2 / -28.6 | - | -36.7 | -31.8 / -18.3 | - | 4.9 (things) | ok |
| hearthlog (cabin) | 0.8 | -17.8 | 0 | -38.2 / -28.8 | -46.7 | -36.7 | -31.8 / -18.1 | 8.5 | 6.4 (things) | ok |
| hearthlog (cabin) | 1 | -14 | 0 | -38.2 / -28.8 | -46.7 | -36.7 | -31.8 / -18.1 | 8.5 | 6.4 (things) | ok |
| ripple (shore) | 0.8 | -18.1 | 0 | -38.2 / -28.8 | -48.1 | -36.7 | -31.8 / -18.1 | 9.9 | 6.4 (things) | ok |
| ripple (shore) | 1 | -14.3 | 0 | -38.2 / -28.8 | -48.1 | -36.7 | -31.8 / -18.1 | 9.9 | 6.4 (things) | ok |
| frostbell (ridge) | 0.8 | -17.9 | 0 | -38.2 / -28.8 | -51.1 | -36.7 | -31.8 / -18.1 | 12.9 | 6.4 (things) | ok |
| frostbell (ridge) | 1 | -14.1 | 0 | -38.2 / -28.8 | -51.1 | -36.7 | -31.8 / -18.1 | 12.9 | 6.4 (things) | ok |
| rainleaf (garden) | 0.8 | -17.9 | 0 | -38.2 / -28.8 | -52.6 | -36.7 | -31.8 / -18.1 | 14.4 | 6.4 (things) | ok |
| rainleaf (garden) | 1 | -14 | 0 | -38.2 / -28.8 | -52.6 | -36.7 | -31.8 / -18.1 | 14.4 | 6.4 (things) | ok |
| lanternroof (roof) | 0.8 | -18.1 | 0 | -38.2 / -28.8 | -46.7 | -36.7 | -31.8 / -18.1 | 8.5 | 6.4 (things) | ok |
| lanternroof (roof) | 1 | -14.2 | 0 | -38.2 / -28.8 | -46.7 | -36.7 | -31.8 / -18.1 | 8.5 | 6.4 (things) | ok |
| cloudloft (cloud) | 0.8 | -18 | 0 | -38.2 / -28.8 | -49.9 | -36.7 | -31.8 / -18.1 | 11.7 | 6.4 (things) | ok |
| cloudloft (cloud) | 1 | -14.1 | 0 | -38.2 / -28.8 | -49.9 | -36.7 | -31.8 / -18.1 | 11.7 | 6.4 (things) | ok |

**The worst moment** (Home, master 1: the music, three voices, a legendary reveal, a pop, a poke, the ball and the shelf's bell inside 0.3 s): master peak **-4.0 dBFS,
0 clipped**. All 14 mixes pass the three rules (the voices 8.5..14.4 dB over the beds; the things the loudest stem at most 6.4 dB over the median). The music's RMS in
the mix rows (-36.7, over 2..9 s) is under its solo rows (-30.2..-31.1, over 2..32 s): different windows, and the engine makes room under the voices and the player's
strikes; not separated further.

**First-play download (G0b)**: measured with `S/g0b.mjs` (browser_shell's prod-build rule: gzip -9 of every non-later html / js / css): HEAD **477,107 B**; this lane
**477,204 B (+97 B)**: physics (the carry lift and tack fix, item 2) +39 B in the index chunk, this sound fix +58 B in the engine chunk (after the `hold()` fold).
The gate (600 KB) passes; the rule "must not grow" is NOT met by 97 B: two real defects (silent Home strikes; pad drops that never bounced) cost those bytes; no
asset or dependency added. The away chunk itself (later-away 8.9 KB + later-away-sound 5.0 KB gzip) now loads on the first thing strike at Home instead of on the
first trip.

## 8. R8_SHELL's requests to this lane (their report, Requests)
- **(1) probe_quests QU-14 x2 with all seven places**: done (section 0b).
- **(3) probe_pg_data's place camera follows the play slot row**: `placeCam` now adds PLAY_SLOT 52 px to the reported top row on a tall frame, as place.ts
  `PlaceHost.fit` does, and pins `if (top > 0 && w < 0.9 * h) top += PLAY_SLOT_PX;` and `export const PLAY_SLOT_PX = 52;`: every strict place's tall row in the
  shipped camera still passes (0 problems).
- **(4) probe_journal CO-12 row 3** ("trophy behaviour is unchanged by the Journal"): re-specified with the reason in the code: the saves are compared with `species`
  left out (the trophies' gift sweep in achievementsBinding.ts counts a gifted species at once, the sweep PG_QUESTS round 3 asked for), and B's `species` must
  equal the species owned after the grant. probe_journal: all checks pass (CO-07 74/74 this run).
- **(5) the layout's own pitch range** and **(6) the top-right column on a tall frame**: done in data and the model (section 4); Cloudloft tall re-laid, passes.
- **(2) node_checks SH-22 B7 wake gate (11.8 % vs 10 %)**: not worked on (below the brief's seven items); node_checks re-run at the end (final regression).

## 9. Final regression (17:30; `S/tree_int` = a snapshot of the integrated working tree with both lanes' changes; one probe at a time; logs `S/final/`)
`npx tsc --noEmit -p tsconfig.json` clean (working tree and snapshot).

| probe | result | against round 8's start |
|---|---|---|
| probe_app | 188/188 | 188/188 |
| shellview/node_checks | **184/184** (SH-22 B7 passed this run) | R8_SHELL's 184/184 |
| probe_gestures | 160/160 | 160/160 |
| probe_trophies / probe_merge | 31/31 / 22/22 | same |
| probe_playground (quick) / `--only=pad` | 74/74 / 3/3 (PH-16 round 8 30/30) | 73/73 (the new PH-16 row) |
| probe_pg_lifequests | 16/16 | 16/16 |
| probe_life | 127 ok / 1 FAIL (LF-02, section 6) | 124 ok / 1 (LF-29 x2, LF-30 new) |
| probe_chatter | 42/42 | 42/42 |
| renderview/pg_node_checks | 40 ok / 0 | 40 / 0 |
| probe_journal | all pass | all pass (CO-12 re-spec) |
| probe_quests | all run checks pass (3 NOT RUN, other lanes') | same (QU-14 re-spec) |
| probe_pg_data | 43 ok / 1 FAIL (DT-18, the owner's call) | 41 ok / 2 FAIL (Home B5, Cloudloft tall: both pass now) |
| probe_life_selfuse `--squirt-only` | SQ-01 x2 ok | (new) |
| probe_audio `--only-life` (HEAD + this lane, twice; HEAD once) | 79/80 each: one AU-07 fingerprint row fails per run, a different one each run (mine: engine_nomusic_mix 1.0e-2, then voice_land 3.9e-3; HEAD: ceremony_capsule_rare 1.7e-3); those renders have no thing strike, so not this change: a flaky row | - |

**probe_life_selfuse `--quick`** (one party, 120 s, a smoke run): HEAD + this lane SU-01 Lanternroof 1 thing (vanedisc) and SU-02 4/6, HEAD 3 things and 5/6; the
same quick run with `--trace` (the same party, the sim stepped in 1 s instead of 10 s chunks) gives Lanternroof **3 things** (vanedisc, moondish, hammock) and
SU-02 ok: one 120 s party is noise-bound. The rows' own run (5 parties x 300 s, all seven places, the integrated snapshot, 26 min, `S/final/su_full_int.log`):
**SU-01 ok at every place** (Hearthlog, Ripple, Frostbell, Rainleaf, Lanternroof, **Cloudloft**: 4 of 5 parties each, the row's bar; Lanternroof's best party used
all five things, the Vane Disc among them), **SU-02 ok (6 of 6 places)**, **SU-03 ok** (most 7 episodes, bar 8), SQ-01 x2 ok. Cloudloft's 3/5 of section 5 (HEAD's
host) is 4/5 with R8_SHELL's host this run.

## Requests to other lanes (kept current)
- ~~R8_SHELL (11) Cloudloft's tall layout needs room~~: answered (their LIFE (5)); used, Cloudloft tall passes (section 4).
- **R8_SHELL (7) Home: the Music Box (and the lamp, shelf, pad at 3 to 5 out) behind the party.** Data cannot move it (section 3). Options in your lane: (a) the Home
  party framing (stage.ts framingFor / the WIDE slots) leaves the things behind the row visible (e.g. the camera higher for parties of 3+, or slots 3 / 4 a little
  forward); (b) the host's press: a quick click (no drag) whose ray first meets a RESTING squishy and then a Home switch thing within that squishy's silhouette goes to
  the thing (D-95's "a squishy in front takes the press" kept for drags and holds); (c) a browser measurement of every Home thing against the slot bodies at
  1280 x 800 and 390 x 844 for 1..5 out (projected box vs each body's disc), so probe_pg_data's model can be calibrated to it (the model's slot-1 body is 106 px left
  of where the browser draws Dollop, section 3). The published row "a click on the Music Box plays its tune" stays red until one of these lands.
  R8_SHELL answered (their section 5 (7)): none built, their judgement stated; **the owner's call** (the box's spot off the party row's line, or a smaller party row).
- **R8_SHELL, your LIFE (7) (G0b)**: this lane's first-load bytes are now **+97 B** over HEAD (`S/g0b.mjs` on HEAD + this lane: 477,204 B): the physics carry / tack
  fix +39 B and the Home-strike sound fix +58 B (section 7; the engine's held voices folded into one helper already, which gzip barely counts). With your net -66 B
  the round is +31 B. I found nothing else of mine to take out without dropping a fix or a guard's message; if you can spare 31 B more, the round is flat.

## Not done / known issues (kept current)
- **DT-18 FAILS** (Home's Music Box, lamp, shelf, pad behind the party at 3 to 5 out; section 3): no data spot passes the existing Home rules; R8_SHELL declined
  the press and framing options with reasons (their section 5 (7)): **the owner's call** (the box's spot off the party row's line, or a smaller party row at Home).
- **LF-02 FAILS** (allocation per 1000 ticks; section 6): explained (Maglev / baseline-tier per-think code), estimated harmless, not removed.
- SU-01 Cloudloft: 3/5 with HEAD's host (section 5), **4/5 (passes) on the integrated snapshot** (section 9); the Puff Pads by themselves still wait for the pad rim
  pin fix (PADS_OK off), the Kite Swing is a ride the host lifts rarely: the row's margin there is one party.
- **G0b +97 B for this lane** (+31 B for the round with R8_SHELL's -66 B; section 7): the rule "must not grow" is not met; the gate (600 KB) passes.
- **node_checks SH-22 B7** (R8_SHELL's LIFE (2)): not worked on; it passed in the final regression (184/184) and in R8_SHELL's run; it has failed on other runs.
- A thing strike at Home that waits more than 0.35 s for the away chunk (a slow first fetch) is dropped, as a strike before the life voices are here always was;
  every later strike plays. The four plain music styles render the same first 30 s (section 7). The tick voice has no shipped user (D-96).
- probe_pg_data gained two env-gated dev tools (SPAWNMAP, LAYOUTSEARCH) and `placeCam` returns its frame (`f`); no row changed by them.
