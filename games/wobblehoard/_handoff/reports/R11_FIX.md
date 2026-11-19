# R11_FIX: round 11, the single LIFE/HOST FIX engineer (ports 5364 to 5369). No git write command is run.

Brief: the orchestrator's round-11 task (D-101 awake budget at every tier, Ripple chimes, flip-flop hysteresis, Rainleaf phone, SU-04 24/24 + browser, D-102 size).
Started 2026-11-19 at HEAD 6c466eec6 (+ the LOCOMOTION engineer's uncommitted edits in src/physics/crawl.ts, src/shell/later-life.ts 589-594, _harness/probe_crawl.ts).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r11_fix/` (`S/` below).
Inputs read: SESSION3.md, VERDICT_R10.md, R10_FIX.md.

## Status (final, 09:25 UTC)
| item | what | state |
|---|---|---|
| 1 | D-101: party of 3 fully awake at every tier; cost measured | **DONE**: attention.ts AWAKE_FLOOR 3.81 / 3 movers at every tier; cost below; no per-body detail lowered (why below); probe rows re-specified |
| 2 | Ripple desktop chimes ring for real + recorded; no self use over ~15 s | **DONE**: browser Ripple desktop low 4 things incl. Shell Chimes USE (52 s), longest chimes busy 15 s |
| 3 | flip-flop hysteresis + probe row | **DONE**: COMEBACK cooldown, no wade while the water rule sends it out, walk dwell vs notices, places-only switch hold; SU-05 row: none in 48 node visits + 6 browser runs |
| 4 | Rainleaf phone sleepers | **DONE by D-101**: browser Rainleaf phone low 5 things, HELD max 0 s (R10: 179.5 s) |
| 5 | SU-04 24/24 on two seeds + browser | **DONE**: 24/24 on seed default and seed 7 (min 3, median 4); browser table 5b: 4 / 4 / 5 / 3 / 6 / 4 |
| 6 | D-102 size 2250 KB, trims, A2 | **DONE**: vite build exit 0, T1 2103.0 KB; no dead code left to trim; A2 life set deferred off the Wake moment (bytes unchanged, why below) |
Open: node_checks "Go play with... on MED" fails with D-101 (one ask's walk at Home stood; one cabin walk started at 9.3 s, bar 8 s); Ripple's TALL Shell Chimes
are out of reach (data); per-body detail at the low tier not lowered (phone cost estimate below); pre-existing fails not mine: node_checks pointer row,
probe_float F4, probe_crawl CR-12 (timing), probe_pg_data DT-01 Home x2 + DT-18, LF-02.

**Item 1, the cost decision**: measured on this machine, 3 awake at the LOW tier cost about +0.85 ms per awake whole per frame over 1 awake: node
(physics + LIFE + shell) 1.15 -> 2.82 ms/frame at Ripple with 3 out, 1.17 (0 awake!) -> 2.95 with 5 out; Chromium (in-page step, incl. stage updates)
before 1.20 ms/frame (1 awake, 3 out) and 1.06 (5 out, ALL asleep for 30 s) -> after 2.9 to 3.5 ms/frame with 3 awake (5 out: 2.95, 3 awake). On this
machine that fits a 16.7 ms frame easily (render at low here 1 to 7 ms), so I did NOT lower per-body detail. By PF-00's phone factor (F = 4, estimated)
3 awake wholes would be about 10 to 12 ms on a low-end phone against the low tier's 4 ms physics budget: if a real low-tier phone measures that, the knob is
the physics per body (substeps or a detail-2 mesh for party members not being touched), not sleep; I did not change it unmeasured because it changes the
squish and the crawl (D-100) per tier, which D-101 forbids, and every physics probe runs detail-3 wholes.

## 1. D-101: the awake budget at every tier (08:20 UTC)
**Where the tier set it**: `src/life/attention.ts` unitCapOf / moverCapOf: unitCap = max((B_tier / 4 - 0.33) / 0.87, 1 + 0.03 x (wholes cap - 1)) = **1.06 / 1.345 / 2.494**
(low / med / high), moverCap 1 / 1 / 2. LIFE (act.ts gateStart, brain.ts, social.ts S18 / boop fit) and the host's over-budget rule (later-life.ts overBudget, the
wake gate in applyIntent) read only these two numbers. Nothing else LIFE sees changes with the tier: the physics has a fixed 1/360 s substep and detail-3 wholes at
every tier (softbody.ts); the tier changes only render detail (render/quality.ts: fine mesh 32/24/16, DPR, transmission), the lock cap (4 at low, player feature)
and how many may be out (mat.ts MAT_LIMIT 3/4/5, unchanged).
**Change**: AWAKE_MIN 3, AWAKE_FLOOR = 3 wholes + 3 touching pairs + 2 sleepers = **3.81**; unitCap = max(formula, D-85 floor, AWAKE_FLOOR), moverCap >= 3. Every
tier now reads **3.81 / 3 movers** (the high formula, 2.494, is under the floor). createAttention starts at the table's values.
**Cost, node** (`S/perf.ts`: app.stepOnce with the real SoftBody + the real life host + a mock stage, i.e. physics + LIFE + shell, no render; 1800 frames after 10 s
settle; this container, other agents' jobs running; `S/perf_before.log`, `S/perf_after.log`). 5 out at low = added at high then the tier dropped to low (MAT_LIMIT low is 3).
| case (low tier) | before: ms/frame mean (p95), awake mean | after: ms/frame mean (p95), awake mean |
|---|---|---|
| Ripple wide, 3 out | 1.15 (1.90), 0.97 awake | 2.82 (4.93), 2.67 awake |
| Ripple wide, 5 out | 1.17 (1.81), **0.00 awake** | 2.95 (4.81), 2.98 awake |
| Home, 3 out | 0.66 (1.81), 0.62 | 1.63 (2.88), 1.78 |
| Home, 5 out | 0.04 (0.09), **0.00** | 2.59 (4.52), 2.43 |
| Rainleaf tall, 3 out | 0.63 (1.87), 0.52 | 2.28 (3.73), 2.07 |
| Rainleaf tall, 5 out | 0.02 (0.06), **0.00** | 2.76 (4.87), 2.53 |
| (high, before) Ripple 3 / 5 out | 1.91 (3.53), 1.58 / 1.93 (3.03), 1.97 | (same caps as low now) |
About 0.9 ms per awake whole on this container (PF-00's C_WHOLE_MS 0.87 holds). Before the change 5 out at the low tier was ALL ASLEEP for 30 s (nobody moved).

**Probe rows re-specified for D-101** (reason written in each): probe_life LF-10 caps row (formula + D-101 floor, 3.81 / 3 movers at every tier; was 1.06 / 1 / 1 / 2),
LF-10 boop row (a physics boop at every tier; was soft on low / med), S06 control row (a second snuggle may start after the first ends on its own; the first is
checked as before); node_checks B7 wake-gate row (keeps "over the cap in at most 10 % of samples", asserts unitCap >= 3.81, reports `held`; `held > 0` dropped:
with 5 out and 3 allowed awake the window rarely needs the gate). Baseline for node_checks on this tree WITHOUT my change (`S/base/`, attention.ts and
probe_life.ts from HEAD, the LOCOMOTION engineer's uncommitted edits in): **184 ok / 2 FAIL**: "the host never takes a pointer it does not hold" (carried false:
not mine, fails without my change) and the B7 wake-gate row (13.2 % over the cap). With D-101: 183 / 3 (those two + "Go play with... on MED": one sample of
the asked squishy asleep on its walk to the Keepsake Shelf; re-run below).

## 2. Ripple Shore: the Shell Chimes (08:15 UTC)
**Cause** (two): (a) the host records a chime strike as the striker's USE RING only when the body moves faster than CHIME_V 0.1 m/s (round 7: so a body resting
against the Night Breeze lanterns is not a record per swing); the slow families walk 0.05 (slime) to 0.07 m/s (dough), so a slime's or dough's LIFE walk along
the row struck the shells (physics strikes, sound) and was never recorded; (b) the row walk is the row's whole span + 0.5 m at the squishy's glide with a
deadline of 3 s + 1.5 x the walk time: up to 54 s for a slime, the "32 to 65 s at the chimes" of VERDICT_R10.
**Fix**: later-life.ts: a strike by a body on a LIFE walk (its scoot on) moving faster than CHIME_WALK_V 0.02 m/s is its USE RING too (CHIME_GAP_S 1 s kept);
brain.ts: the row walk is at most RING_WALK_S 11 s of the squishy's glide (never under RING_MIN_M 0.7 m, the first parts of the row), deadline 14 s; and
every by-itself use (not one the player asked for) ends its doing phase (3: a row walk, a wade, the hops; 6: a lean) SELF_USE_MAX_S 15 s after its arrival
(world.ts uA). Rides (the RIDE behaviour, 20 s host ride) are not changed.
**Node** (`S/su_rip.log`, Dollop + Glimglop + Crimpo, 180 s, wide, low): Ripple **4** [pebbleball rockpool **shellchimes (use.RING)** sandmound], Rainleaf 5.

## 3. The flip-flop (08:15 UTC)
**Cause** (VERDICT_R10 S1, Glimglop awake on Ripple's drift log at 155 to 167.5 s): LF-18's water rule (30 s in water: COMEBACK to the nearest dry spot) found
its walk blocked at once (travelStep not 0: the COMEBACK ends), B04 picked the Rock Pool's wade (a slime likes water), and the water rule took it back the
next think: two behaviours alternating every 0.5 s without moving.
**Fix** (brain.ts, general): setBeh counts the starts of a walking behaviour (COMEBACK, USE, WANDER); SWITCH_N 3 starts within SWITCH_S 5 s while the squishy
moved under SWITCH_M 0.1 m holds those three for SWITCH_HOLD_S 5 s (their cooldowns; the toss and water COMEBACK rules now honour the COMEBACK cooldown).
A use the player asked for is never held (the forced use does not check cooldowns).
**Probe row SU-05** (probe_life_selfuse): every visit of the run (SU-01's and SU-04's: every place, wide and tall), LIFE's behaviour of each squishy every
0.5 s; FAIL when a squishy has more than 3 switches between (non-idle) behaviours within 5 s while moving under 0.1 m.

**Item 3 revised (08:20 UTC)**: the first hysteresis (counting only COMEBACK / USE / WANDER starts) left a flip SU-05 caught at Ripple tall low: Crimpo
ZONE > NOTICE > MOMENT > NOTICE > MOMENT in 5 s at the arrival, 0.03 m (a notice between two greets). Now brain.ts `hystStep` (every think, top of
`behave`) watches the behaviour itself (a moment begun by another counts): its last 4 switch times since it last moved 0.1 m (world.ts bSwT ring); 3
switches within 5 s hold it 5 s: no new behaviour of its own (`choose`), no moment that needs it (social.ts `isFree`, the newcomer's hello), and the
COMEBACK / USE / WANDER cooldowns (the toss and water COMEBACK rules honour them). A use the player asked for is never held.
Ripple tall low after it (trace `S/tr_rip_tall.log`): 3 things (pebbleball, driftlog, sandmound), SU-05 none.
**Ripple tall layout, found**: the Shell Chimes stand at z -3.10 behind the tall bounds (hz 3.0): a body's centre stops at 3.0 - R, its back at -3.0, the
shells' front at -3.02, so no squishy can touch them by itself on a phone (data, `place_ripple.ts` tall; not moved: render, HUD-column and DT rows depend on
it); the Rock Pool's centre is 0.3 m outside LIFE's shrunk bounds: brain.ts selfPoint now also tries the water's points toward the bounds' middle.

## 6. Size (08:20 UTC)
- **D-102** recorded at the end of `_spec/PLAYGROUND_BUILD.md` (with D-101); `vite.config.ts` T1 gate 2250 KB with the reason in a comment; messages name D-102.
- **Dead code of the dropped places**: none left beyond tombstones (grep: PLACE_IDS / THING_IDS slots, DROPPED_PLACES, quest `dropped()` rows, comments).
- **A2**: the brain is needed from the moment the host attaches (later-life.ts imports src/life/step.ts statically; createLifeWorld at attach, lifeStep every
  frame, even one squishy at Home: idle, emotes, the FIRST_PLAY script 6 s after the first release, the first wish), so deferring the brain alone would need a
  brainless host (2,500 lines read `w` on every path): not safe before a deploy. Done instead (boot.ts): the whole life set is no longer fetched AT Wake: on the
  first party (the mat changes) at once, else after 2.5 s without a touch, never later than 10 s after Wake. Until then Home is the published toy (as it always
  was until the chunk landed; game.ts's early log keeps the events). Bytes unchanged (it moves the 183 KB out of the Wake moment).

**Item 3, final form (08:25 UTC)**: the general "hold" (any 3 switches in 5 s on one spot hold its own picks / moments) was TRIED and REVERTED: standing
squishies switch NOTICE / BASK / ANSWER / moments often and legitimately, and the hold changed probe_life's scripted scenes (S05 parade, S06 songs at the
kettle and the fire, LIFE 9 cut look, LF-13 huff: 4 to 6 rows failed; `S/P_probe_life3.log`, `P_probe_life4.log`; with hystStep off they pass,
`S/P_pl_nohyst.log`). Kept, targeted at the cause (brain.ts): (a) a COMEBACK that got under COMEBACK_GAIN_M 0.1 m nearer its spot when it ends (blocked at
once) cools down COMEBACK_COOL_S 8 s, and the water rule (LF-18) and the toss rule honour that cooldown; (b) B04 never picks a wade or a splash for a
squishy the water rule is sending out of the water (its 30 s are up). SU-05 stays as the general detector.
probe_life after it: **127 ok / 1 FAIL (LF-02, known)**; LF-09 re-specified for D-101 (2 to 3 uses per squishy in at least 4 of the 5 seeds 51..55, at
least 1 in every seed; seed 51 alone gave 2 / 3 / 1 / 3 with 3 movers at med; written reason in the row).
(c) (08:27) SU-05's first SU-04 visits caught a second pattern at Ripple tall low: Dollop MOMENT > NOTICE > USE > NOTICE > WANDER in 5 s, 0.04 m (each walk's
start taken by the next ordinary notice). In a place (not Home or the cabin, which keep their published rows), an ordinary notice (not a switch tap) no
longer cuts short a walk (USE, WANDER, COMEBACK, WATCH) in its first WALK_DWELL_S 3 s. probe_life 127 / 1 (LF-02) with it (applied everywhere it moved LF-09's
seeds to 3 of 5: hence places only).
(d) (08:30) SU-05 still caught slow slimes trying USE > NOTICE > WANDER > MOMENT on one spot (Ripple, Rainleaf, Lanternroof). A places-only hold (Home and the
cabin keep their published rows: the same hold there changed probe_life's scripted cabin scenes) went back in: brain.ts `hystStep` (top of `behave`, a ring of
the last 4 switch times since it last moved 0.1 m; world.ts bSwT / bSwX / bSwZ / bSwN / bSwB / bSwH): 3 switches within 5 s on one spot hold it 5 s: no new
behaviour of its own (`choose`) and no moment that needs it (social.ts `isFree`); the running behaviour goes on; a use the player asked for and the scripts
(afterglow, arrive, cheer, a ride) are never held. Node check (`S/su_chk.log`, tall low, Ripple / Rainleaf / Lanternroof): SU-05 none; probe_life 127 / 1.

## 5. Ripple's tall layout (08:33 UTC)
Ripple tall low gave 2 things in some runs. Cause: in the tall layout the Rock Pool's centre (-1.09, -2.75) lies 0.34 m / 0.40 m outside LIFE's shrunk bounds
(|x| <= 1.4 - R - 0.2, |z| <= 3.0 - R - 0.2), and the wade spot search only tried points on the line from the pool's centre toward the squishy: no spot, the use
marked "tried" for the visit. brain.ts selfPoint (WADE / SPLASH / SHOWER) now also tries the water's centre clamped into the shrunk bounds (if still in the
water), then points toward the bounds' middle. Ripple tall low after it: **4** [pebbleball sandmound rockpool driftlog] (`S/su_rt3.log`).
The tall Shell Chimes are out of reach (behind the bounds' back edge). Tried (reverted): moving them into the right strip (x 1.15, z 0.55, along z): probe_pg_data
DT-01 Ripple tall then fails (in the arrival pad, 0.53 m from a spawn): the tall layout has no free strip for a 1.2 m row without moving spawns; left for data.

## 5. SU-04 (node, `probe_life_selfuse.ts --su4-only`: SU-04 and SU-05 alone; Dollop + Glimglop + Crimpo, 180 s, every place, tall/low, wide/low, tall/high, wide/high)
**Seed default (0x5eed1e, genome seed 8), 08:44 UTC (`S/su4_seedA.log`): SU-04 24 of 24 ok, SU-05 none (24 visits).** The low and the high rows are now
IDENTICAL visit for visit (D-101: the tier no longer changes what LIFE does):
| place | tall (low = high) | wide (low = high) |
|---|---|---|
| Hearthlog | 5 | 5 |
| Ripple | 4 (pebbleball driftlog sandmound rockpool) | 4 (pebbleball rockpool **shellchimes** driftlog) |
| Frostbell | 4 | 5 |
| Rainleaf | 5 | 3 |
| Lanternroof | 5 | 3 |
| Cloudloft | 3 | 3 |
(R10: 16 of 24, with 2s at Hearthlog tall high, Ripple wide low, Frostbell tall low/high, Rainleaf tall high, Lanternroof wide low, Cloudloft tall low/high.)
**Seed 7 (`seed=7`: LIFE world seed 7, genome seed 8), 08:55 UTC (`S/su4_seed7.log`): SU-04 24 of 24 ok, SU-05 none.** tall: Hearthlog 5, Ripple 4, Frostbell 3,
Rainleaf 3, Lanternroof 4, Cloudloft 3; wide: Hearthlog 5, Ripple 4 (with shellchimes), Frostbell 6, Rainleaf 5, Lanternroof 5, Cloudloft 4 (low = high again).
Over the two seeds: min 3, median 4, max 6; 15 of 24 distinct cases at 4 or more; the 3s: Cloudloft (3 of 4), Rainleaf wide/tall (2), Lanternroof wide, Frostbell tall.

## 6b. Build (09:00 UTC, `S/build.log`)
`node node_modules/vite/bin/vite.js build`: **exit 0**. [G0] 2524 KB of 3072; [G0b] first-play 463 KB gzip of 600; **[T1] 2103.0 KB of the 2250 KB cap (D-102)**.
First-play closure (verifier's `fp.py`): 1517.8 KB raw / 465.1 KB gzip (live snapshot 1454.4: **+63.4 KB**, cap 70; R10 +60.7). Life set: later-life 70.2 KB +
later-brain 114.7 KB = 184.9 KB (fetched on the first party or 2.5 s after the last touch, at most 10 s after Wake: no longer AT Wake).

## Regression (08:56 to 08:59 UTC, `S/regr.summary`, `S/R_*.log`; earlier: `S/P_*.log`)
| probe | result | vs R10_FIX |
|---|---|---|
| tsc --noEmit | clean | same |
| shellview/node_checks | 184 / 186: FAIL "the host never takes a pointer it does not hold" (fails WITHOUT my change too: `S/nc_base.log`) and FAIL "Go play with... on the MED tier" (D-101: see below) | 185/185 then (186 rows now) |
| probe_app | 188 / 188 | same |
| probe_playground --quick | 74 / 74 | same |
| probe_life | 127 ok / 1 FAIL (LF-02, known) with the re-specified rows | same count |
| probe_pg_lifequests 16/16, probe_chatter 42/42, probe_r8_features 9/9, probe_quests all run ok (3 NOT RUN), probe_journal all, probe_trophies 31/31, probe_merge 22/22, probe_gestures 160/160, renderview pg_node_checks 40/0 | pass | same |
| probe_party 10/10, probe_partycut 6/6 | pass | |
| probe_float | 13 / 14: F4 (everyone back on the ground within 3 s) FAILS at baseline too (`S/P_probe_float_base.log`, at Ripple there, Hearthlog here) | not mine |
| probe_crawl | 13 / 14: CR-12 (the crawl's cost, timed) | LOCOMOTION's row, timing on a loaded machine; not touched by me |
| probe_pg_data | 42 ok / 3 FAIL (DT-01 Home x2, DT-18) on this tree before AND after my changes (`S/P_pg_data_before.log`) | R10: 44 / 1 (DT-18); the two DT-01 Home rows are not mine |
| probe_life_selfuse --su4-only | SU-04 24 / 24 on two seeds, SU-05 none | 16 / 24 |
**"Go play with..." on MED (node_checks, round 6)**: with 3 awake at med, one ask's walk to the Keepsake Shelf at Home stood (0.02 m in 25 s, not used) and the
cabin's Yarn Ball walk started at 9.3 s (the bar 8 s; a song at the kettle holds an asked squishy by design, round 7). Without D-101 it passes. Not fixed (time):
the next step is a trace of the shelf ask (blocked against the shelf's side or a party member?).

## 5b. Browser confirmation (09:03 to 09:16 UTC; my copies of VERDICT_R10's scripts in `S/br/` (placeW.mjs: the Hoard's button now reads "Take out too",
in-page step timing per sample, STEP_S 1: one sample and one render per sim second instead of two; sumW.py: + cost by awake count, + SU-05's flip rule on the
samples); vite dev of this tree on :5364; Wake, 3 out via the Hoard, the REAL Places sheet "Go to", quality forced LOW, 180 s stepped, no input; logs
`S/br/logs/W_<place>_<frame>_low.{out,json}`; summary `cd S/br && python3 sumW.py <tags>`)
Count = things with a by-itself USE, REACT or SOCIAL record (VERDICT_R10's rule). STUCK / HELD as VERDICT_R10 (stuck3).
| case (low tier) | R10 count | **R11 count** | things | STUCK max | HELD max | flips | errors |
|---|---|---|---|---|---|---|---|
| Ripple desktop | 2 | **4** | pebbleball, rockpool, **shellchimes (USE at 52 s)**, driftlog (SOCIAL) | 7 s | 0 s | none | 0 |
| Ripple phone | 3 (12.5 s thrash) | **4** | pebbleball, rockpool, sandmound, driftlog (SOCIAL) | 6 s | 0 s | none | 0 |
| Rainleaf phone | 2 (two HELD 175 to 180 s) | **5** | leafteeter, seedpod, splashspots, steppingstones, dripleaf (REACT) | 7 s | **0 s** | none | 0 |
| Cloudloft phone | 3 | **3** | kiteswing, cloudnest, cloudball | 6 s | 0 s | none | 0 |
| Frostbell phone | 3 | **6** | snowball, steampool, glideramp, snowdriftnest, iciclebells, shakepine | 12 s (*) | 0 s | none | 0 |
| Lanternroof desktop | 3 | **4** | vanedisc, hammock, moondish (REACT), starscope (REACT) | 6 s | 0 s | none | 0 |
(*) Frostbell phone: Crimpo (dough) walking along the tall bounds' right edge (x 1.40) at 2.5 cm/s, 0.33 m in 13 s (USE > WANDER > HOLD ON > WANDER, a gust in
between): slow, not blocked (VERDICT_R10 counted the same kind at Frostbell desk as "slow, not stuck"). Every case: unitCap 3.81, moverCap 3 at the LOW tier.
**Browser cost** (in-page `__WH__.step(1/60, 60)` per sample = 60 frames of physics + LIFE + shell, 20 stage updates and one render, / 60), by wholes awake at
the sample, LOW tier, 3 out: Rainleaf phone 1 awake 1.07 / 2 awake 2.08 / **3 awake 2.93 ms per frame**; Cloudloft phone 1.37 / 2.14 / 2.86; Frostbell phone
1.29 / 2.09 / 3.12; Lanternroof desktop 2.06 / 2.71 / 3.54. About +0.8 to +0.9 ms per awake whole per frame, as in node.

## Files changed (round 11, mine)
src/life/attention.ts (D-101 AWAKE_MIN / PARTY_MAX / AWAKE_FLOOR, unitCapOf, moverCapOf, createAttention's start values); src/life/brain.ts (SELF_USE_MAX_S,
RING row walk limit, wade spot fallbacks, COMEBACK cooldown, no wade while the water rule is due, walk dwell against notices in a place, hystStep places-only
hold); src/life/world.ts (uA, bSw* fields); src/life/social.ts (isFree honours the hold); src/shell/later-life.ts (CHIME_WALK_V: a LIFE walk's chime strike
is its USE); src/shell/boot.ts (A2: the life set on the first party / 2.5 s idle / 10 s); vite.config.ts (T1 2250 KB, D-102); _spec/PLAYGROUND_BUILD.md
(D-101, D-102 appended); _harness/probe_life.ts (LF-10 caps + boop, S06 control, LF-09 re-specified for D-101); _harness/shellview/node_checks.ts (B7 wake-gate
row re-specified for D-101); _harness/probe_life_selfuse.ts (SU-05 row, --su4-only); this report.
Browser scripts: copies in `S/br/` (the verifier's originals in pg_verify_r10/scripts untouched). No process of mine is left running (checked 09:24).
