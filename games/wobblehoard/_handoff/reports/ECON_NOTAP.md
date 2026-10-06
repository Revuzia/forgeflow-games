# ECON_NOTAP: "short taps pay nothing" (owner decision 2026-10-06)

Engineer: the second ECON-NOTAP engineer (the first was cut off by a usage limit after about 11 minutes; its work is the WIP commit `7ac724b7`, which I reviewed line by line and kept).
Branch `claude/exciting-faraday-2dakqx`, local HEAD `7302bca9` at the start. Game folder G = `games/wobblehoard`. No git write command, no browser, no `claude -p`.

**STATUS: DONE, with two things left for other lanes** (see "Needs another lane"): the dev meter accelerator `src/shell/debugHook.ts` still feeds POKES (patch ready, the live
tree's `node_checks` fails without it), and the browser harness's capsule-loop row "a real poke moves the ring" (outside the xp section I may edit) must be changed by the SHELL-4 engineer.

## 1. The new rules (src/core/meter.ts is the rule book; its header says all of this)

* **A tap pays 0 SP**: the `poke` SoftEvent, and a "squeeze" released under 0.4 s (the meter always paid that as a poke). At any gap, any freshness, any number: 1000 taps pay 0
  (probed). `PAY.poke = 0`. A tap sends no spark, shows no pending arc and does not move the ring. Done at the root, in the meter's rules, not in the UI.
* **A tap is still a touch**: it stamps `lastMs[0]` and `lastEventMs`, is refused if its time is hostile, is counted by `ghost.ts bumpTasks` (the Tasks panel) and by the profile
  statistics (`stats.pokes`). It never enters the medley window (`recent`), never touches the valve ledger, never moves `sp`.
* **Kept inert, not removed (my choice, justified):** the poke freshness (tau 0.75 s, floor 0.25) and the 250 ms double-tap gap (`FRESHNESS_TAU_SECONDS[0]`, `FRESHNESS_FLOORS[0]`,
  `POKE_MIN_GAP_MS`, `detail.freshness`, `detail.doubleTap`). They multiply a base of 0 and change no pay. They stay because `src/collection/ghost.ts bumpTasks` (not my file) reads
  `detail.freshness` and `detail.doubleTap` to count "gentle" and "calm" pokes for the daily tasks "Twenty gentle pokes" and "Ten pokes with a calm pause between", and the owner said taps still
  count for the Tasks panel. Removing them would silently break those tasks. A probe row pins them (tap 450 ms later reports freshness 0.36, under 250 ms reports `doubleTap`).
* **Squeeze held >= 0.4 s**: 0.7 SP + **0.6** SP per second held (was 0.45), hold counted up to 3 s, soft pop +0.5 SP at 1.8 s. 0.39 s pays 0, 0.4 s and 0.41 s pay.
* **Stretch held (snap)**: 1.0 SP + **0.65** SP per second held (was 0.55), up to 3 s; 0.5 SP flat if it never stretched (level under 0.35).
* **Medley**: +2 SP when a **squeeze and a stretch** (the two PAID kinds) land within 12 s, either order, window inclusive, then a 25 s cooldown. A tap neither joins nor completes it; an
  older save's index-0 (tap) medley entries are dropped by `sanitizeMeter` and masked in the pay calc. The Tasks panel's `medleys` task still reads `detail.medley`, so it stays reachable.
* Freshness for squeezes (tau 2.4 s) and pulls (tau 3.0 s), floor 0.03, the valve (40 SP/min), the daily cap (8 / 4 at 25% / stop at 12) and the capsule ramp (30/50/75/100) are unchanged.
* `Collection.previewTouch(kind, heldS, level)`: a poke previews 0 (explicit early return in `src/collection/index.ts`), a squeeze under 0.4 s previews 0, the rest unchanged. Signature unchanged.
* Shell (`src/shell/xp.ts`): `gainOf` now returns 0 for a gain at or under `GAIN_EPS = 1e-6` SP (the same threshold `game.ts emitGain` already used, `if (sp > 1e-6)`), so a 0 SP touch emits no
  `gain` event, hence no sparks (HUD) and no glow, and no ring move. The constants-only pending path (`heldPay`) already returned 0 under 0.4 s and agrees with `previewTouch` (checked at 108
  hold/level pairs, worst difference 0). `game.ts` and `hudBinding.ts` need no change.

## 2. DECISIONS FOR THE OWNER (veto points)

1. **The medley, my choice (a): a squeeze and a stretch within 12 s.** Why: (b) removing it leaves the mixed style at 4.3 minutes a capsule (out of the band; without the medley the puller is
   3.8) and makes the daily task "medley-1" unreachable; (c) keeping three kinds lets a free tap complete a paid bonus. With (a), a tap cannot unlock anything and the task stays reachable. The
   medley is worth +17% SP/min to the mixed style and +7% to +9% to a squeezer or puller (sim, medley 0 vs 2 at the final constants: mixed 23.4 -> 27.3, squeezer 28.7 -> 30.8, puller 26.4 -> 28.8,
   holder 29.2 -> 31.0 SP/min). A third option I did not apply: medley 3 SP (mixed 3.4 min). To veto: set `PAY.medley` to 0 and change/replace the medley task in `src/core/drops.ts`.
2. **The tapper consequence, plainly.** A player who only taps now earns exactly 0 SP (probed: 50 five-minute streams, 0.0). The two mostly-tapping archetypes earn only through the holds and
   stretches they also do: **poker 28.0 -> 13.5 SP/min (3.6 -> 7.4 minutes a capsule)**, **tapper 30.1 -> 11.1 (3.3 -> 9.0)**. Because the assumed population is 38% pokers, the whole population slows:
   regular median active minutes per capsule 3.0 -> **3.5** (p10 2.6 -> 2.7, p90 3.8 -> **6.1**), first capsule 63 -> **77 s** (poker 134 s), all 50 species for regular willing traders (sim K)
   203 / 131 -> **247 / 153** days solo / with trade, devoted capsules per active day 9.9 -> 8.7, and the slowest archetype is now 1.82x the fastest to finish all 50 (it was 1.11x). The paying styles
   are unaffected (they are in the band, below). If the owner wants the 2026-10-05 timeline back, the lever is the capsule cost (about 85 SP restores the regular median to about 3.0), or a bigger
   squeeze and stretch pay (which pushes the paying styles under 3.0 minutes). I applied neither: the brief said re-tune only the squeeze and stretch constants, into the band.
3. **The pay re-tune**: `squeezePerSecond` 0.45 -> 0.6 and `pullPerSecond` 0.55 -> 0.65 (nothing else). Reason: with taps free the first engineer's unchanged pay left the paying styles at 3.6 / 3.8 / 4.0 minutes a
   capsule (squeezer / puller / mixed), mixed out of the 3.0 to 3.8 band. A grid (`squeezeBase` 0.7 to 0.9, `squeezePerSecond` 0.45 to 0.6, `pullBase` 1.0 to 1.2, `pullPerSecond` 0.55 to 0.7, two seed sets,
   scratch `grid_out.txt`, `grid2_out.txt`) showed the mixed style (40% free taps) as the binding constraint; the two per-second rates are the smallest change that puts every paying style in the band with margin
   on both sides, and they move pay toward holding, the owner's direction. Bases and the soft pop are unchanged.
4. **A tap can still lead to a capsule through the daily tasks** (not through the meter): "Twenty gentle pokes" and "Ten pokes with a calm pause between" still count taps, as the owner asked ("taps still
   count as taps for the Tasks panel"). 20 gentle taps take about 11 seconds and a completed task pays a capsule (worth about 3.5 minutes of paying play), bounded by 2 tasks offered a day and 5 a week.
   If "a tap pays nothing" should include this, those tasks must be replaced in `src/core/drops.ts` (not my file).
5. The task text "Poke, squeeze and pull within twelve seconds" (`drops.ts`, id `medley-1`) is now over-specified: a squeeze and a pull complete it, the poke is harmless but not needed. Text change belongs to the core lane.

## 3. The simulation, before and after (`node _harness/sim_economy.ts`, no flags; scratch `econ_notap\`)

BEFORE = the unmodified tree (the first engineer's baseline `before_full.txt`; I re-ran `--micro` on a `git archive` of the committed `19f62137` tree: section A byte-identical; the full output has the SHA-256
`9d030f8166038689e89c1e9d2e19957d49c1ed35f2aad55d59a9675d7a72b9b6` that DESIGN 5.4 quoted for it). AFTER = this tree, `after_full.txt`, SHA-256 (without the elapsed line) `4c5d0cf26dce22d81eb76e7e9d1b4b4f767480c285abc0d3f0ac0bc52e5813c0`,
524 s on this PC under load (222 s before). The sim inputs were not modified after that run started (mtimes checked).

Section A, per archetype (400 five-minute streams through the real meter; minutes per capsule at 100 SP):

| Archetype | taps / squeezes / pulls per min | SP/min before -> after | min per capsule before -> after (mean / median stream after) | SP share poke / squeeze / pull after |
|---|---|---|---|---|
| poker | 19.9 / 4.4 / 2.7 | 28.0 -> 13.5 | 3.6 -> 7.4 (7.4 / 7.6) | 0 / 62 / 38% |
| **squeezer** | 2.7 / 14.2 / 2.8 | 28.4 -> 30.8 | 3.5 -> **3.2** (3.25 / 3.22) | 0 / 80 / 20% |
| **puller** | 2.7 / 3.0 / 13.5 | 27.4 -> 28.8 | 3.6 -> **3.5** (3.48 / 3.46) | 0 / 24 / 76% |
| **mixed** | 8.8 / 6.7 / 6.7 | 31.8 -> 27.3 | 3.1 -> **3.7** (3.66 / 3.66) | 0 / 51 / 49% |
| tapper (extra) | 66.3 / 3.7 / 3.3 | 30.1 -> 11.1 | 3.3 -> 9.0 | 0 / 56 / 44% |
| holder (extra) | 2.1 / 2.5 / 10.1 | 28.8 -> 31.0 | 3.5 -> 3.2 | 0 / 19 / 81% |

* The four paying styles need 3.2 to 3.7 minutes a capsule, by the mean and by the median stream, inside the 3.0 to 3.8 band; fastest / slowest x1.13 (also on a second seed set: 3.25 / 3.35 to 3.76).
* The pace of the squeezing, pulling and mixed styles stays in the band, so **MERGE_COST = 2 stands** (it flips to 3 only at about 1.5 minutes a capsule; sim O: with M = 3 the first mergeable set takes 43.5 minutes against 12.2).
* Bots and valve: taps at 8 a second 0.0 SP/min (before 0.1), a tap every 250 ms **0.0** (before 40.0); machine-speed squeezing (0.45 s hold every 0.5 s) 5.1 SP/min and stretching (0.3 s every 0.5 s) 4.4 (freshness floor,
  new bots); best-cadence squeeze (1.8 s every 2.4 s) 39.9, full stretches held 3 s back to back 38.9 -> 39.2, tap-squeeze-stretch cycler 40.0 -> 40.0 (valve 40); paying humans 29.0 SP/min. Daily cap unchanged: at most 12 capsules a day.
* Section C: regular median active minutes per capsule 3.0 -> 3.5 (p10 2.6 -> 2.7, p90 3.8 -> 6.1); first capsule 62.9 -> 77.1 s (poker 64.4 -> 133.7, squeezer 64.4 -> 59.5, puller 65.8 -> 62.6, mixed 57.8 -> 67.2); first pair
  10.4 -> 12.5 minutes (5 capsules both); first triple 36.5 -> 43.2 minutes; capsules per active day casual / regular / devoted 2.64 / 7.19 / 9.90 -> 2.31 / 6.00 / 8.74.
* Section K (regular willing traders, p50 day, solo / trade): all 50 203 / 131 -> 247 / 153; Epic row 99 / 54 -> 127 / 68. Section L route shares do not move (Epic+ first copies by trade 33% -> 32%, by merge 1% -> 2%).
  Section J2 (slowest / fastest archetype, all 50, trade world): 1.11x -> 1.82x. Sim sections that read the archetype SP share (J affinity, off by default) now see a poker share of 0 for taps.
* The archetypes were NOT redefined; the table shows the plain consequence of the rule. The sim edits: the section A text, the `Behaviour` doc, the new bots `sqmash`, `sqbot`, `pullmash`, and a population line (the WIP commit's work plus mine).

## 4. Probe counts (final runs on the final tree; logs in scratch `final_*.txt`)

| Check | Before (unmodified tree) | After |
|---|---|---|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | clean | **clean** (no output, exit 0) |
| `probe_economy.ts` | 152 / 152 | **160 / 160** |
| `probe_collection.ts` | 70 / 71 (the C08 allocation row already failed) | **73 / 74** (the same C08 allocation row, see Known issues) |
| `probe_merge.ts` | 22 / 22 | **22 / 22** |
| `probe_app.ts` | 160 / 160 (session-start baseline; no xp rows in it, none needed changing) | **160 / 160** |
| `probe_collection_imports.ts` | not run before | 10 / 10 |
| `shellview/node_checks.ts`, LIVE tree | 100 / 100 (session-start baseline) | **FAILS** (12 ok, then 5 FAIL and a crash): it needs the `debugHook.ts` patch below |
| `shellview/node_checks.ts`, scratch copy of the live tree WITH `_handoff/reports/ECON_NOTAP_debugHook.patch` | n/a | **104 / 104** |
| `sim_economy.ts` | runs | runs (section A to Q), 524 s |
| `browser_shell.mjs` | not run (no browser allowed); `node --check` syntax OK | |

New / changed rows in `probe_economy` (all counted above): a tap pays 0 at 18 gaps and every freshness (including after paid touches and right after a short squeeze); a flood of 1000 taps pays 0 (no SP, capsule, valve bucket or medley
entry, ring empty) and leaves a meter that holds SP exactly as it was; taps between two squeezes change neither; 0.39 s pays 0 and 0.4 / 0.41 s pay; the unpaid tap does not unlock the medley (tap+squeeze, tap+pull, squeeze+taps,
pull+taps, 50 taps around either, a squeeze under 0.4 s standing in for the squeeze, a saved window holding old tap entries); a tap between a squeeze and a pull is ignored and does not extend the 12 s window; the window is inclusive at 12 s;
the cooldown; 23 medleys in 10 minutes of squeeze/stretch alternation; the Tasks-panel inputs are kept; a pure tapper earns 0; taps pay 0 at 1.1 to 12 a second; machine-speed squeezing and stretching under 25% of a paying human; the best-cadence
bots held to the valve; a squeeze-plus-stretch machine for 80 hours never exceeds 40 SP in a minute nor 12 capsules a day. `probe_collection`: `previewTouch('poke', ...)` is 0 for every argument, freshness and meter state, in both call forms;
a flood of 1000 pokes through `feed` leaves the meter view byte-identical with no event, and the next held squeeze pays 1.42 SP; the preview-equals-feed row now also covers taps (276 pokes among 865 fed touches, none paid, 0 mismatches). `node_checks`: see section 5.

## 5. Re-specified rows (each owner decision: "short taps pay nothing"; none loosened for a rule that still holds)

`probe_economy.ts`:
* "a first poke pays 0.8 SP" -> a tap pays 0 (it paid 0.8). "heldS is a pull field only" poke half -> pays 0. "a squeeze held under 0.4 s is paid as a poke" (0.8) -> it is a tap, 0; 0.39 / 0.4 / 0.41 s boundary.
* The poke freshness rows (tau 0.75 s; "ordinary tapping always pays a little", floor 0.25; every poke pays at least 0.2 SP; the 250 ms double-tap gate that stopped a poke paying; "a poke right after a squeeze is not penalised" 0.8) were the
  owner's EARLIER same-day direction; replaced by "a tap pays 0 at every gap", plus a row that the Tasks inputs (`doubleTap`, `freshness`) are still reported.
* Squeeze / stretch values (1.15 -> 1.3, 2.325 -> 2.7, 2.55 -> 3.0, 1.55 -> 1.65, 2.1 -> 2.3, 2.65 -> 2.95 SP, `0.45`/`0.55` -> `0.6`/`0.65`): the pace re-tune (decision 3).
* Medley rows: "poke, squeeze, pull" -> "a squeeze and a pull"; "three kinds spread over more than 12 s" -> "a squeeze and a pull more than 12 s apart" (the old row's squeeze and pull 7 s apart now correctly pay).
* Capsule-threshold row: filled the meter with pokes every 1.5 s -> squeezes held 1 s every 3 s (same expected thresholds 30/50/75/100).
* Archetype rows: "every single-style player within 15%", "variety pays by about 15%", "minutes per capsule in the owner band" for poker / tapper, "every style incl. the tapper needs 3.0 to 3.8 and none is >20% faster" and
  "a puller is not faster than a poker by more than 10%" -> the same bands asserted for the four PAYING styles (squeezer, puller, mixed, holder: mean and median, within 20%, puller and holder within 10% of the squeezer, mixed within 20% of
  the fastest), plus "the tap share of SP is exactly 0 in every archetype" and "a pure tapper earns 0". The poker / tapper pace is an INFO line, not a gate (it is the owner's decision's plain consequence). "Variety out-earns" has no
  replacement: it is false now (decision 2).
* Mashing rows: "fast tapping pays at least 0.2 SP a tap and the valve holds it", "a burst of taps pays 0.2 to 0.36 SP", "MASHING pokes earns at most 45%" -> taps pay 0 at any rate; mashing squeezes and stretches still <= 45% of a paying human.
* Bot rows: "a poke every 250 ms and full stretches are held to the valve; 8 pokes a second earn ~0" -> taps at machine speed earn exactly 0; new bot rows for machine-speed squeezing / stretching / best-cadence squeeze (threshold 25% of a paying human).
* `sanitizeMeter(saved, now)` row: the freed meter was shown to pay with a poke -> with a squeeze held 1 s. The clamp row: squeeze 1e300 = the 3 s cap, 3.0 SP (was 2.55); a negative hold is a tap, 0 (was 0.8).
`probe_collection.ts` C08: the coverage guard "paid > 500" (a third of the touches are pokes, which pay nothing; 482 paid) -> "paid > 400"; the equality gate (preview = what feed pays, 0 mismatches) is untouched; the arc-growth row's text 0.55 / 0.45 -> 0.65 / 0.6.
`shellview/node_checks.ts`: X06 (a poke on a chunk "pays like on a whole squishy", `sp > 0`) -> the poke pays 0 and a squeeze held 1.2 s on the chunk pays through `collection.feed`; "feed: real pokes ... move the practice meter"
(`fill > 0`) -> three real taps are counted and pay nothing, and a held press moves it; "xp through the game ... the press's first contact paid a poke" (`gains.some poke`) -> no poke gain, exactly one gain (the squeeze). New rows: `gainOf` is 0 for a
tap, noise and a backward step; the constants path agrees with `previewTouch`; eight real quick taps emit no gain, no pending arc, leave the meter view identical and still count as taps. `probe_app.ts` had no row encoding a poke pay: unchanged.

## 6. What the browser harness xp section must now expect (SHELL-4 runs it; I could not)

`_harness/browser_shell.mjs` section `xp` was rewritten (syntax checked with `node --check`, NOT run): (1) a quick real-mouse tap: the poke lands (audio.poke +1), no spark launched, none flying, no `glow=soft`, no pending arc, meter fill and ring offset unchanged;
(2) the stretch rows are unchanged; (3) a squeeze held 1.2 s, deterministic (sim paused and stepped through the hook, like the stretch): the pending arc is present and grows over four samples, the release launches >= 3 sparks, the ring fills (>= 1% of its
length, arc drawn = meter), the new screenshot is `xp_squeeze_sparks_desktop.png` (the old `xp_poke_sparks_desktop.png` is gone; `xp_tap_nothing_desktop.png` is new); (4) Calm effects uses a held squeeze (soft glow, no sparks). The squeeze comes after the stretch, so
it also completes a medley bonus (a pull within 12 s sim time): the arc includes it (previewTouch counts it), so the honesty is unaffected. Calm steps the sim 4 s first so the squeeze freshness is full. If a row fails in the browser, suspect the new squeeze
helper (a real press must compress the body above 0.08 for a release event) before suspecting the economy.
**Outside the xp section, not edited (needs the SHELL-4 engineer):** `browser_shell.mjs` lines about 660 to 664, capsule-loop section: `check('meter: a real poke moves the ring ...')` with `await page.mouse.click(...)` then `fill > 0` will now fail (a tap pays nothing).
Replace the click with a held press (for example the `squeezeHold` helper of the xp section, or `wh.pointerDown`, `wh.step(1/60, 72)`, `wh.pointerUp`) and say "a held squeeze moves the ring"; the comment at line 646 ("pokes on a clock pushed ahead") should say squeezes after the debugHook patch.

## 7. Needs another lane

* **`src/shell/debugHook.ts` (SHELL; not edited by me)**: `shell.fill` and `shell.grant` (the dev meter accelerator used by node_checks and most browser sections) fill the ring with POKE events 2 s apart. Pokes pay nothing, so the ring never fills:
  node_checks' "meter full", "queue", "hold-to-open" and "ceremony: input is locked" rows fail and the run then crashes; every browser section that earns a capsule through the hook is broken. Patch ready and verified: `_handoff/reports/ECON_NOTAP_debugHook.patch`
  (feed `release` with `heldFor` 1.2, 3 s apart: full freshness, about 28 SP/min, under the 40 SP/min valve). `git apply --check --ignore-whitespace -p1 games/wobblehoard/_handoff/reports/ECON_NOTAP_debugHook.patch` passes from the repo root.
  With it, in a scratch copy of the working tree: node_checks 104 / 104. Apply it before anything else runs the shell harness. Also `debugHook.ts` `doTask` still feeds pokes for `pokes` tasks (correct: taps count for tasks) and a poke-led medley (harmless).
* `src/core/drops.ts`: the medley task text (decision 5) and, if the owner wants, the poke tasks (decision 4).
* `src/shell/hudBinding.ts` line ~220: the comment "a poke 3, a squeeze or a stretch 4 to 6" (sparks) is stale: a poke has no sparks now (a squeeze or stretch pays 1.3 SP and up, so 4 to 6 sparks, unchanged).
* `_spec/CUT.md` X06: "pays a poke on a piece like a poke on a whole squishy" (a poke pays 0 now; the node_checks row X06 was re-specified as above).
* For the INPUT agent: no hint string promises XP for a tap, but these present poking as the thing to do: `src/ui/hint.ts` lines 24 to 26 ("Tap to poke · hold to squish · drag out to stretch", the pointer and keyboard variants), `src/ui/playTarget.ts` line 22 (`wh-play-help`),
  `src/ui/settingsPanel.ts` line 104 (keys line), `src/ui/hoard/panel.ts` line 345 ("poke it, squeeze it, stretch it"), `src/shell/hudBinding.ts` line 307 and `src/ui/toyTray.ts` line 12 ("Hand: poke, squish, stretch"). "Squish to earn capsules" (`src/collection/copy.ts` line 21, `src/ui/hoard/panel.ts` line 343)
  is accurate (squish = hold). A hint like "hold to squish and earn" would now be informative: that is the INPUT agent's call.

## 8. Docs changed

* `_spec/DESIGN.md`: 5.4 rewritten (both owner steps, the meter table, the before / after archetype table, the plain consequence, the re-tune and its grid, bots, results, the task caveat, the new hash and what moved in the 5.0 headline numbers), 5.1 line 1, the line-58 meter row. The rest of the file still
  quotes the 2026-10-05 canonical run; 5.4 says so and says to re-quote 5.0 first.
* `_spec/FUN.md` section 2 rewritten truthfully: point 1 is now "Taps are free play", point 2 carries the new rates, point 6 the medley; "every touch earns" no longer appears.
* `_spec/COLLECTION.md`: 7.5 measured numbers (re-measured on `meter.ts` alone: 1500 forged pokes 1 s apart now earn 0 capsules, 1500 squeezes 4, the best forged mix 10 in 25 minutes, cyclers 47 / 60 / 62 minutes to the daily 12), a new "later the same day" paragraph (the host code and the SQL need no change; the draft stays NOT APPLIED and is not
  re-run), the P2 plausibility row, the `pokes` and `medleys` task rows, the SoftEvent mapping, the pending-arc line, the interface comment, the residual-risk line (12 vs about 9 a day, roughly a third), the 7.12 telemetry title, the 63 s -> 77 s welcome-grant line, and the Appendix C forged stream (squeezes instead of pokes). All still marked NOT APPLIED.
* `_spec/MERGE.md` (the owner's-rule paragraph: 3.2 to 3.7 and 3.5 minutes, M = 3 numbers 43.5 vs 12.2, 6% / 19% vs 48% / 83%) and `_spec/NEXT_STEPS.md` (D-1, D-9). `_spec/TRADE.md`: no pay value is quoted there (its SQL mirrors no pay rule), so no edit.
* Code comments: `src/core/meter.ts` header and field docs (WIP plus the new constants), `src/collection/meterfeed.ts`, `types.ts` (`previewTouch`), `index.ts`, `src/shell/xp.ts`. grep for "every touch earns", "ordinary tapping", "quick poke", "tap pays": the only remaining hits are the historical sentences that now say "was".

## 9. Known issues and what I did not do

* **`probe_collection` C08 "previewTouch allocates nothing" fails on this PC, on the UNMODIFIED tree too** (baseline `before_probe_collection.txt`: 160000 B per 20 000 calls). My experiment (`alloc_exp.mjs`): every call form (bound, direct, wrapper) boxes about one 16-byte number per loop iteration on Node v22.20.0 /
  V8 12.4.254.21-node.33 (the earlier engineer saw it pass on Linux, Node 22.22). It is the engine not inlining `previewTouch` into the caller's loop, not an allocation in the module; a function that returns a fractional number cannot be guaranteed allocation-free when it is not inlined. Left as is (not
  loosened); costs 8 bytes a call in the real frame loop. The meter's own preview allocation row (`probe_economy`, fresh worker) passes.
* The browser harness is unrun (no browser allowed); the xp section and the squeeze helper are written from the existing stretch code and the node checks, so expect to adjust them.
* The tuning is fitted to the sim's seeds; I checked a second seed set (`grid2_out.txt`: the final constants averaged over seed sets 0 and 500 give squeezer 3.24, puller 3.45, mixed 3.67, holder 3.23 minutes, slowest 3.69 and fastest 3.22 over both sets;
  final run, seed 0: 3.25 / 3.48 / 3.66 / 3.23). The margins to the band edges are about 0.1 minute on the mixed side (3.8) and 0.2 on the squeezer and holder side (3.0).
* Section O's header label "(~X min/capsule)" still uses the legacy mean of poker, squeezer and puller (4.1 now); the measured regular value is the first row (3.5). Not changed (it would change the output for a label).
* Stats: a tap still bumps the profile counters and notifies listeners on every tap (the Tasks panel shows progress), which is the same work as before.
* The scratch copy used for the patched node_checks run and the junction were removed at the end; no stray processes were left (checked).

## 10. Files changed (all mine unless noted)

`src/core/meter.ts`, `src/collection/index.ts`, `meterfeed.ts`, `types.ts`, `src/shell/xp.ts`; `_harness/sim_economy.ts`, `probe_economy.ts`, `probe_collection.ts`, `shellview/node_checks.ts`, `browser_shell.mjs` (xp section only);
`_spec/DESIGN.md`, `FUN.md`, `COLLECTION.md`, `MERGE.md`, `NEXT_STEPS.md`; new `_handoff/reports/ECON_NOTAP.md` and `ECON_NOTAP_debugHook.patch`. Not mine and modified by others in the tree: `_harness/browser_render.mjs`, `_harness/renderview/view.ts` (RENDER lane), `package-lock.json` (pre-existing).
