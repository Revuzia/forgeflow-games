# B-sim ledger (sim engineer, stage B: §3 Open defiance) — trust this file

## Plan
1. harmLoad weights in regard.ts endAct (w 1 / 0.5 provoked-foretold, x(1+dead/10), once per act key); defiance daily
   target in arc.ts heartsDaily (§3.1 + memory biases); harm jolt (trust < 0.4).
2. Acts (arc.ts defy*): curse (dusk, hourly), hurl (hourly, god storm/disaster/bolt near), burn, idol; TASK.defy 59
   (defs.ts, tasks.ts anim), HeartSign fist/hurl; idol building; events `defy`, chronicle defy.*.
3. Answers: classified in regard.ts endAct (wrath/mercy/sign; patience at day 10 in daily); effects; defy.answered;
   ArcEvent 'answer'; memory; godActs; `defiance.answer`, `defiance.set`; query('defiance'); heart.answered words.
4. Memory: arcYearly decay (0.9727 / 0.99 landmark), daughters x0.7, newborn bias in freshen; defiance/revolt/sign uses.
5. Freeform phrases; save migration note; tests/arc-defiance.test.ts; probe D-lines multi-seed; gate via slot.sh.

## Stint 1 (2026-11-08 ~23:1xZ)
- started; read BRIEF, ARC §0/3/6/7/8/9.2/10.4, A-sim ledgers, B-ui. No runs started yet.
- CODE (tsc clean): src/sim/god/defiance.ts NEW; hooks in arc.ts (noteHarm weights, inherit, defianceDaily, answered words,
  hurl/fist signs, heartWords late act), regard.ts (endAct harm weights + jolt + answerFromAct, freshen bias, witness
  mercy-on-open-answer, relDaily idol x0.8 + sign memory), relationship.ts (registerDefianceCommands, hourly
  defianceHourly at dusk, god storm tracking for weather.paint + miracle.storm, revolt +0.1 & mercy bar, conversions idol
  bar, SettlementView.defiant, query 'defiance', fearMigration carryMemory), wrath.ts WRATHFUL += defiance.answer,
  freeform-signs.ts defyIntents (first in intentSigns), defs.ts TASK.defy 59, tasks.ts anim, buildings.json idol,
  events.json defy.* (12 ids), migrate15 doc. contract-changes.md "Stage B sim" entry.
- tests/arc-defiance.test.ts NEW 13/13.
- D2 harsh (spec M3 harsh = storm every 4 months, 3 y; probe `arc.ts harsh`), quick serial run 8 seeds: hurl on 5/8
  (seeds 2,4,5,6,7). With the verifier's extra bolt (HARSH_BOLT=1) fear sits at 0.95-0.99 and only 2/8 throw (terror rule).
- RUNS (slot.sh, 23:33Z): scratch/arc/B-sim/unatt1.log (unattended 1..8, 60 y: defiant town-years, burns),
  pairs1.log (dmercy/dwrath 1..4, 26 y: def25, newborn10).
- D5 pairs (pairs1.log, dmercy/dwrath 1..4, 26 y): FAIL as specified. Only 1-2 defiant acts per run (curse), each
  answered; def25 mercy/wrath 0.014/0.029, 0.016/0.016, 0.144/0.117, 0.016/0.016 (diff < 0.1 on 4/4); newborn10 trust
  0.353/0.477, 0.047/0.076, 0.006/0.157, 0.478/0.711 (differs >= 0.05 on 4/4 but HIGHER after wrath: the LIVING rally
  after a survived harm, regard.ts weathered, lifts trust more than the mercy bias). Memory at y11 mercy 0.51-1.06 /
  wrath 0.51. Why: once defiance.set's hold ends (30 days = 2.5 game years) both towns' targets clamp at 0 (0.4 pride -
  0.5 trust < 0 with no harm), so the memory biases (<= 0.08-0.10) act on a zero target. D5 needs either a sustained
  provocation in both arms (e.g. the harsh storms continued), or larger memory weights: an owner/lead call, NOT tuned.
- Memory halving (0.9727/y), >= 0.70 with a rubble landmark (0.99^25 = 0.78), daughters x0.7: unit tests (arc-defiance).
- Focused: arc-hearts/tower/tower-r1/freeform, scripture_lint, content, living-migration/content, prayers-pause 74/74;
  living-relationship, determinism, save-continue, flood-warning, mods, omnipotence, living-sacred 93/93; detban clean.
- GATE: slot.sh npm run check queued 23:40Z -> scratch/arc/B-sim/check1.log.
- D2 unattended (unatt1.log, 8 seeds x 60 y): 0 defiant acts, 0 burns, defiant town-years 0 % on 8/8 (defMax 0.13-0.32):
  PASS (<= 10 %, <= 1 burn). Towers/hearts unchanged in kind from stage A.
- GATE check1.log (00:0xZ): 859/860; the one failure was the D1 terror subtest (float32 fear 0.9 = 0.89999998 slipped
  under `>= 0.9`). FIX: DEFY.terror compared with a 1e-4 epsilon (person and town mean). Focused re-run green.
  Re-run of the full gate: check2.log (queued 2026-11-09 ~00:1xZ).
- GATE check2.log: npm run check 860/860 GREEN (detban + tsc + suite), via slot.sh.

## NEXT (open)
1. D5 generations (mercy vs wrath, def at +25 y >= 0.1 lower on >= 3/4; newborn trust) does NOT pass: lead/owner call
   needed (see the D5 line above). Probe ready: `_harness/arc-work/B-sim-runs.sh pairs` (arc.ts dmercy|dwrath).
2. D3 shot (defiance.set + god storm, >= 4 hurl agents, arcs): not shot by the sim lane; B-ui NEXT 1 plans the live run.
   Note: a 30-person test town has ~5 bold members (hurl needs boldness >= 0.6), so use babel (70-110 per town).
3. Not built: "a prophet's word there" as a sign answer; the stage-C keepers (legends) and betrayed/kept uses.

## Stint 2 (2026-11-09, lead ruling on D5)
- ARC.md §8 D5 rewritten per the lead (same provocation 25 y after the answers; defiance or fear differs >= 0.1 on >= 3/4;
  remember/answered words tell which); contract-changes entries added (D5 ruling, prophet's word).
- BUILT "a prophet's word there": prophet.foretell -> answerByWord (sign), line defy.word; test (arc-defiance 14/14).
- Probe arc.ts dmercy|dwrath: 27 y = harsh year, answers to y26, then the harsh protocol 1 y in both arms (prov.*).
- pairs2.log (weights as spec): words tell which on 4/4 (mercy towns "the mercy after the wrong" / "shown mercy
  twice"; wrath towns "the anger of the sky" / "struck once"), but defMean/fearMean diffs 0.01-0.08: FAIL numerically.
- Raised memory weights in proportion: DEFY.memK = 3 on the §0.4 wrath/patience/mercy defiance terms, the newborn bias
  and its caps, and the mercy revolt bar (pride/humbled/tower terms untouched). Runs: pairs3.log, unatt2.log (05:20Z).
- pairs3.log (memK 3): STILL FAIL. defMean mercy/wrath 0.113/0.051, 0.100/0.149, 0.155/0.232, 0.095/0.020; fearMean
  0.149/0.121, 0.150/0.158, 0.144/0.149, 0.080/0.091 -> diff >= 0.1 on 0/4 (by sign the mercy arm is LESS defiant on
  2/4 only). Words still tell which answer on 4/4. Why the numbers do not separate: (1) each arm gets only 1-2 answers
  (curse acts are rare once the hold ends), so memory w at y26 ~0.5; (2) defiance moves 0.03/day and a game year is 12
  days, so the provocation year moves it only ~30 % toward its target; (3) the memory terms bias a target that sits near
  its 0 clamp in both arms, and the newborn fear/trust seeds wash out in the daily drift within a year; (4) the two arms
  diverge in towns and population over 25 years, noise ~0.05-0.1. memK reverted to 1 (spec numbers): raising it bought
  nothing measurable. Lead call needed (e.g. memory scaling the reaction to harm itself, or a longer provocation).
- GATE: check3.log queued (memK 1, prophet's word, probe changes).
- check3.log 860/861: only tests/worker.test.ts pacing ("1000x runs 680 ticks/s") under load (render shots + my unatt2
  probe in the other slots); passes alone 2/2. unatt2.log (8 seeds x 60 y, the new code): 0 acts on 8/8 (D2 kept).
- GATE check4.log: npm run check 861/861 GREEN via slot.sh.
## NEXT
1. D5 (provoked form) fails numerically at memK 1 and 3 (see above); words pass. Lead call. Probe: B-sim-runs.sh pairs.
2. D3 shot: UI/render lanes (lead).

## Stint 3 (2026-11-09 ~15:00Z, lead ruling: memory scales the reaction to harm)
- BUILT defiance.ts harmReaction (k = DEFY.reactK 0.5): witness fear x(1+k wf), trust loss x(1-k wm), jolt
  x(1-k wf)(1+k wm); wm = mercy + 0.5 patience + 0.5 sign. ARC.md §0.4/§3.1/D5 and contract-changes updated. Test 15/15.
- pairs4.log: defMean/fearMean/trustMean mercy vs wrath: s1 .237/.080, .141/.128, .219/.391 (def .16, trust .17) PASS;
  s2 .016/.147, .138/.168, .690/.381 (def .13, trust .31) PASS; s3 .235/.203, .144/.177, .297/.267 FAIL (max .033);
  s4 .093/.016, .083/.106, .453/.635 (trust .18) PASS -> 3/4 PASS. Words 4/4. CAVEAT: directions are not consistent
  (the mercy arm has less trust on s1/s4, more on s2), so part of each gap is the arms drifting apart over 25 y.
- RUNS: unatt3.log (D2 recheck), GATE check5.log (queued).
- unatt3.log: 0 acts on 8/8 (D2 kept). check5 861/862 (worker pacing under load again; passes alone); check6 was killed
  by my waiter's time limit; GATE check7.log: npm run check 862/862 GREEN via slot.sh. Stage B sim done; next: stage C.
