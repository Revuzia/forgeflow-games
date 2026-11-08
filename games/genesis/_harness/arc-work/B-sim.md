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
