# R11_FIX: round 11, the single LIFE/HOST FIX engineer (ports 5364 to 5369). No git write command is run.

Brief: the orchestrator's round-11 task (D-101 awake budget at every tier, Ripple chimes, flip-flop hysteresis, Rainleaf phone, SU-04 24/24 + browser, D-102 size).
Started 2026-11-19 at HEAD 6c466eec6 (+ the LOCOMOTION engineer's uncommitted edits in src/physics/crawl.ts, src/shell/later-life.ts 589-594, _harness/probe_crawl.ts).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r11_fix/` (`S/` below).
Inputs read: SESSION3.md, VERDICT_R10.md, R10_FIX.md.

## Status
| item | what | state |
|---|---|---|
| 1 | D-101: party of 3 fully awake at every tier; measure cost | code done (attention.ts), node cost measured; probes being re-run; browser cost pending |
| 2 | Ripple desktop: Shell Chimes walk rings for real + recorded; no self use over ~15 s | fixed in code (brain.ts, later-life.ts); node Ripple wide low 4 things incl. shellchimes RING |
| 3 | Ripple phone flip-flop COMEBACK/USE: hysteresis + probe row | hysteresis in brain.ts + SU-05 row in probe_life_selfuse |
| 4 | Rainleaf phone sleepers | not started |
| 5 | SU-04 24/24 on two seeds + browser table | not started |
| 6 | D-102 size gate 2250 KB, trims, A2 brain chunk deferral | gate set + D-101/D-102 appended to PLAYGROUND_BUILD.md; build/trims/A2 pending |

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
