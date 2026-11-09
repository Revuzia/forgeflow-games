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
