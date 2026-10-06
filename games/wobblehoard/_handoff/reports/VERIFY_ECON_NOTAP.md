# VERIFY_ECON_NOTAP: independent verification of "short taps pay nothing" (RUNNING REPORT, first pass; ECON_NOTAP.md not yet read)

Verifier: independent (did not write the code; the engineer's report ECON_NOTAP.md is read only after the first pass).
Snapshot: tree hash `7ba0e0554ea84f88` (249 files; live tree and copy identical at copy time), made with scratchpad\tools\snap.mjs into
`...\scratchpad\verify\econ\games\wobblehoard`. It is the LIVE working tree (uncommitted ECON edits on top of HEAD 7302bca9), not a commit.

## Setup facts (deviations, stated plainly)
- The snapshot path is 279 characters. Node (ESM package-scope lookup) fails inside it: `node node_modules/typescript/bin/tsc` printed
  `ERR_PACKAGE_IMPORT_NOT_DEFINED ... "#getExePath"` there, while the same command on the live tree prints `Version 7.0.2`. So I made a
  byte-identical copy of the snapshot at a short path, `C:\Users\TestRun\AppData\Local\Temp\vq\wh`, and verified `treeHash(copy) == 7ba0e0554ea84f88`
  with the same treehash.mjs. All runs below are in that copy. Not one source file was edited.
- snap.mjs skips every folder named `dist`, which also drops `node_modules/*/dist` (vite and others): tsc in the copy said
  `Cannot find module 'vite'`. As RESUME.md section 1 prescribes, the copy's `node_modules` is a directory junction to the live
  `G\node_modules` (read only use; nothing is built, no vite cache is written). Removed at the end.
- A second short dir `...\Temp\vq\base` holds `git archive 7ac724b7^` (= b2ed8e1b, the tree before the ECON edits; its economy files are the 19f62137 state) for before/after numbers.
- No browser. No `claude -p`. No git write command. My scripts: `...\Temp\vq\scripts\tap_hunt.mjs`, `tasks_probe.mjs`.

## Status per item (first pass, updated as I go)
| item | status |
|---|---|
| tsc | CLEAN: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: no output, exit 0, 1.1 s, covers 116 src files plus _harness .ts |
| 1 tap-pays hunt | meter core: NO tap pays (400k hostile taps, 0 violations). TWO tap-adjacent paths remain, see findings F1 and F2 |
| 2 sim re-run | DONE: output hash identical to the one DESIGN 5.4 quotes (see below) |
| 3 probes | not started (waiting for the baseline sim to finish: one heavy job at a time) |
| 4 docs and quotes | in progress |

## Item 2: simulation (my own clean run, the copy above, `node _harness/sim_economy.ts`, no flags, 241.2 s)
- SHA-256 of the output without the `(elapsed ...)` line = `4c5d0cf26dce22d81eb76e7e9d1b4b4f767480c285abc0d3f0ac0bc52e5813c0`: identical to the hash DESIGN 5.4 quotes for the engineer's run. The sim is deterministic (seeded), so my run reproduces every number of that table.
- Section A, micro-sim, 400 five-minute streams per style, min per 100 SP capsule (mean), before (tree b2ed8e1b, taps paying) -> after:

| style | SP/min before -> after | active min per capsule before -> after |
|---|---|---|
| poker (74% taps) | 28.0 -> 13.5 | 3.6 -> **7.4** |
| squeezer | 28.4 -> 30.8 | 3.5 -> 3.2 |
| puller | 27.4 -> 28.8 | 3.6 -> 3.5 |
| mixed | 31.8 -> 27.3 | 3.1 -> **3.7** |
| tapper (90% taps) | 30.1 -> 11.1 | 3.3 -> 9.0 |
| holder | 28.8 -> 31.0 | 3.5 -> 3.2 |
| a PURE tapper (only taps, 1/3 to 1/2 s apart, or 1 per s) | about 28 -> **exactly 0** (0 SP in 50 streams; 8 taps/s bot 0.0; tap every 250 ms bot 0.0) | never |

- The paying styles (squeezer 3.2, puller 3.5, mixed 3.7, holder 3.2) are inside 3.0 to 3.8 by mean and by median stream (median 3.2/3.5/3.7). The mixed style is 0.1 minute from the top of the band.
- Macro, regular players, whole run: active minutes per capsule median 3.5 (p10 2.7, p90 6.1), first capsule 77.1 s, all 50 in 247 (solo) / 153 (trade) days; poker needs 1.82 times as long as the fastest style to finish all 50.
- The population (assumed 38% pokers) is NOT in band: poker 7.4 min a capsule is beyond the 5.4 minutes DESIGN 5.6 calls "the edge of grindy". The pace claim holds for the paying styles and for the regular median, not for a tap-heavy player. MERGE_COST = 2 does not depend on the poker pace (it flips to 3 only below about 1.5 min a capsule), so it stands; but it is also true that a regular player now reaches a first pair in 12.5 min (was 10.4) and 48% have one by 12 min (was 57%).

## Findings so far (first pass)
- F1 (MINOR, owner decision): taps still earn a CAPSULE through the daily Tasks. `tasks_probe.mjs`: fed 25 pure pokes 0.9 s apart through the real collection: meter sp 0 -> 0, task "gentle-pokes-20" 20/20 done, claim ok, capsule credits 0 -> 1 (same for "pokes-sleepy-10", 15 taps). 46.0% of 400 (device, day) draws offer a tap task. Bounded by 2 a day and 5 a week. The meter itself pays nothing; DESIGN 5.4 and COLLECTION 7.10 disclose it as an owner decision.
- F2 (MINOR, lead): an UNSTRETCHED pull pays a flat 0.5 SP whatever the hold (`PAY.pullFail`): pull level 0.06, held 0.02 s pays 0.5; best cadence one per 3 s = 10 SP/min = 10 min per capsule. A short outward drag past the 14 px slop is the nearest thing to a tap that still pays. Not measured in a real camera (no browser): level 0.06 needs a drag of about 6% of the body's own maximum pull.
- F3 (see item 3 once run): the shell dev hook `src/shell/debugHook.ts` `fill()` feeds POKE events, so `__WH__.shell.grant()` / `fill()` can no longer earn a capsule (14 uses in browser_shell.mjs, 5 in node_checks.ts).
- F4 (MINOR, copy): task text `medley-1` still says "Poke, squeeze and pull within twelve seconds"; the medley now needs a squeeze and a pull (a poke does nothing). Disclosed in COLLECTION.md 7.10.
- Doc discrepancy: COLLECTION.md 7.5 says the best forged mix "reaches the daily 12 at 1.65 s per touch after about 41 minutes"; my script reaches 12 capsules after 30.6 minutes (1500 touches x 1.65 s = 41.25 min is the stream length). All other forged-stream numbers reproduce (6a 0 SP; 6b 4 capsules / 339.6 SP; 6c 4; 6d 10 capsules / 883.0 SP; 6f 47.2 min; 6g 59.7 min; 6h 62.1 min).

# Second pass (continuation verifier, 2026-10-06; ECON_NOTAP.md read only after my own probe runs)

Verifier: a fresh agent continuing the cut-off one ("do not start over"). No browser, no `claude -p`, no git write command, nothing in G touched but this report.

## S0. Snapshot
- `node scratchpad\tools\snap.mjs C:\Users\TestRun\AppData\Local\Temp\vq2` printed `{"hash":"3ba41c37f82e8a48","files":249,"liveHashAtCopy":"3ba41c37f82e8a48","identical":true}`. Short path `C:\Users\TestRun\AppData\Local\Temp\vq2\games\wobblehoard`. It is the LIVE tree at local HEAD `13bf8f55` (the RENDER-R WIP on top of the economy commit `2f9cc8fc`; `git status` showed only `package-lock.json` modified).
- `tsc` there first said `vite.config.ts(12,43): error TS2307: Cannot find module 'vite'` (snap.mjs drops `dist` folders). As RESUME.md prescribes I deleted the snapshot's own copied `node_modules` and made a directory junction to `G\node_modules` (read only use); removed with `cmd /c rmdir` at the end.
- `diff -rq` of the first-pass snapshot (`vq\wh`, hash 7ba0e0554ea84f88) against this one, over `src`, `_harness`, `_spec`: only `src/render/capsule.ts`, `src/render/stage.ts`, `_harness/browser_render.mjs`, `_harness/renderview/view.ts` (RENDER WIP) and `src/shell/debugHook.ts` (the dev-hook patch) differ. So `meter.ts`, `collection/*`, `shell/xp.ts`, `sim_economy.ts`, every probe and every spec file are byte-identical to what the first pass tested: the first pass's sim hash (4c5d0cf26dce22d81eb76e7e9d1b4b4f767480c285abc0d3f0ac0bc52e5813c0) stays valid and I did NOT re-run the 4 to 9 minute simulation. I also re-hashed the engineer's saved `after_full.txt` without its elapsed line: `4c5d0cf2...13c0`, the same value; I used that file only to check quoted sim numbers (S4).

## S1. Item 3: probes in the snapshot (all run by me, logs in `...\Temp\vq2logs\`)
| Check | Result (verbatim last lines) |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | no output, exit 0 (0.8 s) |
| `node _harness/probe_economy.ts` | 160 `ok` lines, `all economy checks passed`, EXIT=0: **160/160** = the engineer's count |
| `node _harness/probe_collection.ts` | `73/74 checks passed`, EXIT=1 = the engineer's count. The one red row, verbatim: `FAIL C08 previewTouch allocates nothing: exact new-space growth over 20 000 calls (10 000 frames with a held stretch and a held squeeze)  160000 B per 20 000 calls` |
| `node _harness/probe_merge.ts` | `22/22 checks passed`, EXIT=0 |
| `node _harness/probe_collection_imports.ts` | `10/10 checks passed`, EXIT=0 |
| `node _harness/shellview/node_checks.ts` | `104/104 shell-core node checks passed`, EXIT=0 (the engineer's count with the dev-hook patch applied) |
| `node _harness/probe_app.ts` | `160/160 shell checks passed`, EXIT=0 |

**C08 on the pre-change tree (confirmed).** `git archive 7ac724b7^ games/wobblehoard | tar -x -C ...\Temp\vq2base` (7ac724b7^ = `b2ed8e1b6db390863f169bd272d22609be48f3ae`; its `meter.ts` has `poke: 0.8`, `squeezePerSecond: 0.45`), then `node _harness/probe_collection.ts`: `70/71 checks passed`, EXIT=1, the same row with the same number: `FAIL C08 previewTouch allocates nothing: ... 160000 B per 20 000 calls`. So the row is red before and after the economy change with an identical figure: not a regression. It stays red on this PC (Node v22.20.0): any harness that wants a green `probe_collection` exit code will not get one here. I did not re-investigate the engineer's V8-boxing explanation (not needed for the verdict).

**Re-specified rows: is each reason honest?** I read the engineer's full diff of `probe_economy.ts`, `probe_collection.ts` and `node_checks.ts` (`git diff 7ac724b7^ 2f9cc8fc`) against section 5 of ECON_NOTAP.md. Every changed row either inverts a clause that encoded "a tap pays" (the owner's decision) or re-pins a number to the re-tuned constants, and each carries a written `RE-SPECIFIED` reason in the code. Row by row:
- Tap rows (0.8 SP poke, poke freshness tau 0.75 s and floor 0.25, "every poke pays at least 0.2", the 250 ms double-tap gate, "a poke right after a squeeze is not penalised", fast tapping pays 0.2 to 0.36 a tap, MASHING pokes <= 45%, the 8-pokes-a-second bot, the poke-led cycler): replaced by "a tap pays 0 at 18 gaps and every freshness", a 1000-tap flood, taps between squeezes, machine-speed taps exactly 0. Honest; the same-day earlier direction is the stated reason. The poke freshness and the double-tap constants are kept (a pinned row says so) because `ghost.ts bumpTasks` reads them; I confirmed that at `ghost.ts:70`.
- Value rows (1.15 -> 1.3, 2.325 -> 2.7, 2.55 -> 3.0, 1.55 -> 1.65, 2.1 -> 2.3, 2.65 -> 2.95, `0.45`/`0.55` -> `0.6`/`0.65`): the pace re-tune; consistent with `meter.ts` (I recomputed 0.7 + 0.6 x 1 = 1.3, 0.7 + 1.5 + 0.5 = 2.7, 1.0 + 0.65 x 2 = 2.3 in S4).
- Medley rows: "poke, squeeze, pull" -> "a squeeze and a pull"; the three-kinds-spread row -> "a squeeze and a pull more than 12 s apart"; window inclusive at 12 s; new rows for old saves holding index-0 entries. Honest (a free tap would otherwise unlock a paid bonus).
- Cycler and bot rows: the cycler row KEEPS its threshold (38 to 40 SP/min, <= 40.0001) and adds `byKind[0] === 0`; the held-stretch bot keeps `<= 40.0001`; new squeeze and stretch bots use 25% of a paying human (a bound the old file did not have).
- Capsule-threshold, `sanitizeMeter` and clamp rows: only the touch used to drive them changed (poke -> squeeze held 1 s); the asserted thresholds (30/50/75/100) and behaviours are unchanged.
- `probe_collection` C08 coverage guard `paid > 500` -> `paid > 400` (482 paid of about 865 fed): a COVERAGE guard (that the random stream exercised enough paid touches), not a pay check; the equality gate (preview = what feed pays, 0 mismatches) is untouched, and the row gains `pokes > 200 && pokePaid === 0`. Honest.
- `node_checks` X06 (a poke on a chunk now pays 0, a held squeeze on it pays), "feed: real pokes move the practice meter" (three real taps pay nothing, a 1.2 s press does), "xp through the game ... the press's first contact paid a poke" (the clause is inverted: no poke gain, exactly one gain): all keep the original intent (the chunk and the frame loop reach `collection.feed`), say why, and add rows (`gainOf` 0 for a tap, noise and a backward step; constants path equals `previewTouch` over 108 hold/level pairs; eight quick real taps emit no gain, no pending arc, leave the meter view identical).
Two widenings are worth the owner knowing about, neither hidden (both are explained in the code comments), see N2 below: the "mixed" style's upper pace bound moved from 3.5 to the owner's published band edge 3.8, and "within 15%" became "within 20%". Verdict on item 3: **no loosened threshold in disguise.**

## S2. Item 1 recap: is there any path where a tap pays SP? (first-pass hunt re-run on this snapshot, plus my own collection-level hunt)
- `node vq\scripts\tap_hunt.mjs <snapshot>` (first pass's meter-core hunt, re-run): `392000 taps, 0 violations`; taps interleaved before paid touches change none of the paid pays or the final SP (3000 sequences, 0 differ); squeeze boundary 0.39999999999999997 pays 0 and 0.4 pays 0.94; old-save tap entries in `recent` cannot unlock a medley.
- NEW, my own code `vq2\scripts\coll_hunt.mjs` (real `createCollection` -> `feed` -> meter, differential): run A = 4800 random paid touches (squeezes held 0.4 to 3 s, snaps), run B = the same touches with 18,662 taps inserted between them (pokes, and releases of 0, 0.05, 0.2, 0.39, 0.3999999999999999, NaN, -1, undefined s). Result: `meter views differing between run A and run B after a paid touch: 0; taps that moved the meter view: 0; taps that emitted an event: 0; previewTouch(tap) non-zero: 0`; sanity: run A earned 143 play capsules over the 40 seeds (the paid touches really pay).
- Every pay in `src/` goes through `core/meter.ts` `addInteraction` / `previewInteraction` (grep: callers are `collection/ghost.ts`, `collection/index.ts`, `collection/meterfeed.ts` only). The shell's `xp.ts` constants path (`heldPay`) returns 0 under 0.4 s and agrees with `previewTouch` (node_checks row, 108 pairs). The server SQL in COLLECTION Appendix A and TRADE.md quote no pay constant (grep for poke / squeeze / pay in TRADE.md: no hits; the Appendix A hits are all `bad_payload`), and stay marked NOT APPLIED (13 `NOT APPLIED` marks).
- The only way a tap still leads to a reward is NOT the meter: F1 below.

## S3. Item 5: judging F1 to F4
**F1 (OWNER DECISION, not a failure): the daily Tasks still hand out a capsule for taps.** Re-run `node vq\scripts\tasks_probe.mjs <snapshot>`: `seed 7: offered gentle-pokes-20 + medley-1; fed 25 taps -> meter sp 0 -> 0 (fill 0), task "gentle-pokes-20" 20/20 done=true, claim ok=true, capsule credits 0 -> 1` (same for seeds 11, 13 and 14 with `pokes-sleepy-10`, 15 taps). 46.0% of 400 (device, day) draws offer at least one tap task. Cost to the player: 20 gentle taps 0.9 s apart = 18 s, or 10 calm taps 1.1 s apart = 11 s, for one capsule that paying play takes about 3.5 minutes to earn; bounded by 2 tasks offered a day and 5 a week. ECON_NOTAP.md decision 4, DESIGN 5.4 and COLLECTION 7.5 / 7.10 all disclose it. If "taps pay nothing" must include this, the two tasks in `src/core/drops.ts` (`gentle-pokes-20`, `pokes-sleepy-10`) have to be replaced (core lane).

**F2 (MINOR / NOTE): the cheapest paying acts, measured through the real meter with the real freshness, valve and daily cap** (my own code `vq2\scripts\f2_rate.mjs`, each script 10 minutes at 16 cadences from 250 ms to 8 s, best cadence shown; the unit is SP per minute; a paying human is 29.0, the mean of squeezer 30.8, puller 28.8, mixed 27.3 from sim A):

| script | best cadence | SP/min | worst 60 s window | min per 100 SP capsule |
|---|---|---|---|---|
| tap (poke) only | any | **0.00** | 0.00 | never |
| unstretched drag (level 0.06, held 0.05 s; `PAY.pullFail` 0.5 SP) | 3000 ms | **10.00** | 10.50 | 10.0 |
| flick stretch (level 0.40, held 0.05 s; 1.0 + 0.65 x 0.05) | 3000 ms | 20.65 | 21.68 | 4.8 |
| shortest paying press (squeeze held 0.4 s, 0.94 SP) | 2400 ms | 23.50 | 24.44 | 4.3 |
| press held 1.8 s (soft pop) | 2400 ms | 39.65 | 40.00 | 2.5 |
| unstretched drag + 0.4 s press, alternating (the medley counts ANY pull) | 1200 ms each | **36.32** | 38.44 | 2.8 |
| flick stretch + 0.4 s press, alternating | 1200 ms each | 39.18 | 40.00 | 2.6 |
| full stretch held 3 s | 2700 ms | 39.82 | 40.00 | 2.5 |

- Within the valve and the cap: every script's worst 60 s window is <= 40.00 (the valve), and 30-hour runs of the four cheapest scripts earn `capsules per UTC day 12/12` (the hard stop). So the answer to "is F2 inside the valve and the daily cap" is **yes**. The unstretched drag alone is the weak path the first pass guessed: one third of a paying human (10 SP/min = 10 minutes a capsule).
- What a "short drag past the slop" really takes (physics, not a browser): `node vq\scripts\flick_level.mjs <snapshot>` on the real SoftBody, 10 species, drag d x R outward in 0.06 s then release: d = 0.25 R fires a snap for 10 of 10 bodies (median level 0.103; between 0.05 and 0.35, so it pays the flat 0.5 SP); d = 0.1 R fires a snap for 4 of 10; d = 0.03 R for none (a level of 0.05 or less fires no snap); d = 0.5 R reaches the stretch level 0.35 for 2 of 10 (median 0.206). The grab target starts where the pointer crossed the 14 px slop (`gestures.ts` `moveBody`: `target: host.planePoint(x, y, hit.point)`), so only the travel AFTER the slop counts. Estimated screen travel beyond the 14 px (`f2_phys.mjs`; ESTIMATE from `stage.ts`: FOV 35, camera distance max(3.0, 2.4 / aspect), body restRadius 0.48 to 0.56 and `maxPull` 0.70 to 3.14 x R by family; ignores camera pitch and zoom): a snap at 1280x800 needs 7 px (pop dome) to 36 px (sticky stretch); at 390x844 4 to 22 px; the stretch level 0.35 needs 50 to 254 px at 1280x800 and 30 to 155 px at 390x844.
- **The finding behind the numbers (NOTE for the owner, not a failure of the tap rule):** the pay is dominated by touch COUNT, not by hold time. A 0.4 s press at the best cadence earns 23.5 SP/min (81% of a paying human, 4.3 min a capsule), and a tiny drag plus a 0.4 s press alternating earns 36.3 (125% of a paying human) because the medley counts an unstretched pull. All of it stays under the 40 SP/min valve and 12 a day, so no gate breaks, but "short taps pay nothing" mostly moves the threshold from a 0 s tap to a 0.4 s press.

**F3 (RESOLVED): the shell dev hook is patched.** `git show 2f9cc8fc -- src/shell/debugHook.ts` shows `POKE` replaced by `SQUEEZE: SoftEvent = { kind: 'release', ..., heldFor: 1.2 }` and `skew.ms += 3000` (3 s between squeezes: full freshness, about 28 SP/min, under the valve); `grep -n "POKE\|SQUEEZE" src/shell/debugHook.ts` in the snapshot lists only the `SQUEEZE` const and its one `feed`. `node _harness/shellview/node_checks.ts`: `104/104`, including the rows that were failing without the patch ("meter full", queue, hold-to-open, ceremony input lock). `doTask` still feeds pokes for the `pokes` tasks (correct, taps count for tasks). Not checked here: that the dev hook stays out of the production bundle (a bundle grep is the SHELL lane; the file's own header says it must not ship).

**F4 (MINOR, copy): the medley task text is stale.** `drops.ts` (`medley-1`) still reads "Poke, squeeze and pull within twelve seconds" (printed by `tasks_probe.mjs`). It stays reachable: a squeeze held >= 0.4 s and any pull within 12 s completes it (a poke is harmless but not needed). Needs a text edit in the core lane (not done in the tree I tested).

## S4. Item 4: docs and quotes
Pay constants agree everywhere (checked against `meter.ts` lines 64-90, 97-115):
- DESIGN 5.4 table: tap 0; squeeze 0.7 + 0.6 per second, cap 3 s, 1.3 at 1 s, 2.4 at 2 s (0.7 + 1.2 + soft pop 0.5), 3.0 at 3 s; soft pop +0.5 at 1.8 s; stretch 1.0 + 0.65 per second, 1.65 / 2.3 / 2.95, flat 0.5 below level 0.35; medley +2 for a squeeze and a stretch within 12 s, 25 s cooldown; freshness tau 2.4 s and 3.0 s, floor 0.03 (tap tau 0.75 s, floor 0.25, 250 ms gap kept for the Tasks panel); valve 40; daily 8 / 4 at 25% / stop at 12; ramp 30 / 50 / 75 / 100. All match.
- FUN.md section 2 points 1 to 6: 0.7 + 0.6, 1.0 + 0.65, 1.8 s soft pop, 0.4 s, the medley rule, "3.2 to 3.7 minutes in the simulation": match.
- COLLECTION: 7.5 mapping and pending-arc lines, the interface comment, the P2 row (machine-speed 4 to 5 SP/min against the sim's 5.1 and 4.4; best squeeze 40), the residual risk (12 against about 9 a day, "roughly a third" = 1.33), 7.10 (`pokes`: gentle = freshness >= 0.5 = a gap of 0.53 s or more with tau 0.75 s: 0.75 x sqrt(0.5) = 0.530 s; `GENTLE_POKE_FRESHNESS` is 0.5 in `constants.ts`), 7.12 title (3.5), the welcome-grant line (77 s = sim C 77.1): match. MERGE.md and NEXT_STEPS D-1 / D-9: 3.2 to 3.7, 3.5 regular, M = 3 first mergeable set 43.5 against 12.2, 6% / 19% against 48% / 83%: match sim O of the saved output (`min to 1st MERGEABLE set 12.2 / 43.5`, `by 12 active min 48% / 6%`, `by 25 active min 83% / 19%`). TRADE.md quotes no pay value.
- The sim numbers DESIGN 5.4 quotes match `after_full.txt` (same hash as my first-pass run): archetype table (13.5 / 30.8 / 28.8 / 27.3 / 11.1 / 31.0 SP/min; 7.4 / 3.2 / 3.5 / 3.7 / 9.0 / 3.2 min), regular median 3.5 (p10 2.7, p90 6.1), first capsule 77.1 s, first pair 12.5 min after 5 capsules, first triple 43.2 min after 14, capsules per active day 2.31 / 6.00 / 8.74, sim K 247 / 153 and Epic row 127 / 68, sim J2 1.82x.

Discrepancies found:
- **D1 (MINOR, F5 settled): COLLECTION.md 7.5 (line 410) says "the daily 12 is reached by that mix at 1.65 s per touch after about 41 minutes". It is wrong: 30.6 minutes.** Own independent script `vq2\scripts\f5.mjs` (real `meter.ts`, squeeze held 3 s alternating with a stretch held 3 s, UTC day 0, no midnight crossed): at 1.65 s per touch the 12 capsules arrive at minutes `0.3 1.4 3.4 6.3 8.5 11.4 13.6 16.4 20.0 23.5 27.1 30.6`, total credited 1055.7 SP (30 + 50 + 75 + 5 x 100 for the first 8, then 4 x 100 credited at 25%), then the hard stop. The first pass's script gave 30.6 too. "41" is the LENGTH of the 1500-touch stream (1500 x 1.65 s = 41.25 min; the 1 s stream is 25 min), not the time to the 12th capsule. Other quoted forged-stream figures reproduce (6a 0 / 0, 6b 4 capsules / 339.6 SP, 6c 4, 6d 10 capsules / 883.0 SP in 25 min, 6f 47.2, 6g 59.7, 6h 62.1 min; I re-ran `tap_hunt.mjs`: same output). Fix: "after about 31 minutes" (30.6). It matters a little: it understates how fast a forged best mix fills the day by about 10 minutes; the valve and the cap still bound it.
- **D2 (MINOR): DESIGN.md line 243 says "Epic+ first copies by trade 33%, by merge 2%, section L".** Section L of the saved sim output prints `via trade 32%, via merge 2%, via capsule 66%`; the 33% / 2% pair is section O. Wrong section tag or a one-point slip.
- **D3 (MINOR): the 2026-10-05 headline numbers are still quoted at the sites a reader sees first, flagged only inside DESIGN 5.4.** Examples: DESIGN 5.0 table (3.1 active min per capsule, 64 s, 205 / 131 days), 5.1 line 9 (131 / 205 days), 5.2 and 5.10 to 5.12 (3.1 min; "2x slower is 5.4 min"), NEXT_STEPS D-2 (205 against 131), TRADE.md line 40 (131 against 205), DESIGN risk rows 3, 5 and 12 (131 days, 3.1 min). The tag "[sim K]" points at the old canonical run (hash 855b4a63...), so they are true for that run and 5.4 says "re-quote 5.0 before using any of its numbers", but the new meter gives 247 / 153 days and 3.5 min. A one-line banner on 5.0 and on TRADE.md line 40 / NEXT_STEPS D-2 would close it. Not a pay-value error.

Verdict on item 4: every quoted PAY value agrees with `meter.ts` and the docs agree with each other on them; three quoting errors remain (D1, D2, D3), all in prose.

## S5. Further findings
- **H1 (MINOR, browser harness, not run by anyone): `_harness/browser_shell.mjs` line 664** `check('meter: a real poke moves the ring (SoftEvent -> collection.feed -> meter.ts)', moved, ...)` after `page.mouse.click(...)` and `waitUntil(... fill > 0 ..., 30000)` (comment at line 660: "poke -> 0.8 SP of the first 30"). A tap pays nothing, so this row will fail (after a 30 s wait) in the capsule-loop section. ECON_NOTAP.md section 6 flagged it for the SHELL-4 engineer; it is unchanged in the tree I tested. `node --check _harness/browser_shell.mjs`: syntax ok. I did not run a browser.
- **N1 (NOTE): `probe_collection` exits 1 on this PC** because of the pre-existing C08 allocation row (S1). It is not caused by the economy change.
- **N2 (NOTE): two re-specification widenings.** The old "mixed" row asked 3.0 to 3.5 minutes a capsule (3.3 to 4.0 for single styles, and "variety out-earns by about 15%"); the new row asks the owner's published band 3.0 to 3.8 for the four paying styles by the mean AND by the median stream. The mixed style's 3.66 would fail the old 3.5 bound, and its margin to 3.8 is 0.14 minute. The old "within 15%" became "within 20%": from sim A the four paying styles are x1.135 apart (31.0 / 27.3), so 15% would also pass. The reasons are written in the probe, the band is the owner's, and the numbers are real; I flag them because "never loosen a threshold" asks for it.
- **N3 (NOTE, owner-visible consequence, already disclosed): the pace.** The four paying styles need 3.2 / 3.5 / 3.7 / 3.2 minutes a capsule (inside 3.0 to 3.8); the poker needs 7.4 and the tapper 9.0 (beyond the 5.4 minutes DESIGN 5.6 calls the edge of grindy), and the regular population median is 3.5 with p90 6.1. `MERGE_COST = 2` does not depend on it (it flips to 3 only around 1.5 minutes a capsule). A pure tapper earns exactly 0.

## S6. Verdict of the second pass
**PASS, with the minors above.** It covers: `meter.ts`, `collection/*`, `shell/xp.ts`, the shell node checks and the docs, on the snapshot `3ba41c37f82e8a48`; no browser, so the browser harness, the real HUD sparks and a real mouse tap were NOT exercised (H1 says the harness row that expects a tap to pay is still stale). Required for PASS: (1) no path where a tap pays SP: held (392k hostile taps in the meter, 18.7k taps through the real collection with a differential: 0 differences; the capsule from the daily tap tasks is F1, an owner decision); (2) probes at the engineer's counts: held (160/160, 73/74 with the pre-existing C08 row, 22/22, 10/10, 104/104, 160/160, tsc clean); (3) docs consistent: every pay value agrees, and three prose errors remain (D1 is the only one that is a wrong measured number: 41 should be about 31 minutes). No MAJOR finding.

## S7. Not checked
- Anything in a browser (HUD sparks, ring glow, a real tap, the rewritten browser `xp` section, `browser_shell.mjs` as a whole).
- The sim was not re-run (code identical to the first pass; hash and doc quotes checked against the saved output).
- That the dev hook (`debugHook.ts`) stays out of the production bundle.
- The server SQL and the host suite (marked NOT APPLIED; not run).
- The pixel travel numbers in F2 are an estimate from the camera constants, not a measurement in a real camera.

## S8. Cleanup
Junction `vq2\games\wobblehoard\node_modules` removed with `cmd /c rmdir`; live `G\node_modules` checked intact. No process of mine left running. Scratch: `...\Temp\vq2\` (snapshot, scripts), `...\Temp\vq2logs\` (probe logs), `...\Temp\vq2base\` (pre-change archive).
