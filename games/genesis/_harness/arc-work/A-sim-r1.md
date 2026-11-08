# A-sim-r1 ledger (sim engineer, stage A round 1 fixes)
Items (brief index): 0 strike double regard | 1 decision card offer | 2 confuse cold deaths | 3 seed in tower rolls |
4 warn heed retune | 5/12 attended T2 pacing | 6 M3 kind | 7 let finishes.
## Stint 1 (2026-11-07 ~18:3xZ)
- started; no prior ledger.
- CODE landed in src/sim/god/tower.ts (tsc clean, arc-tower 11/11):
  #0 strike: trust/noteHarm left to regard for members inside STRIKE_R=1500; members beyond get the witness class
     (provoked/foretold -0.05, unprovoked -0.2 x cruelty(w)); noteHarm only for towns not in currentAct().seen.
  #1 offerChoice(): first card level-based (height >= 25 % && choices 0 && openToAnswer); refusal in heedRoll reopens
     (choices = max(choices,1), tower.choice).
  #3 u.seed on every tower roll; exported heedDie(u,tower,sid) / rebuildDie(u,tower,year).
  #4 heed = clamp(cred(0.4+faith0) - 0.3 pride + 0.3 fear + 0.1 trust + 0.15 x since.tRefusals, .05,.9); faith0 = faith +
     since.tDrain (tower's own drain, reset at beginTower); host heeding or league < 2 after heeds = heeded abandonment (sacred).
  #7 hardship abandon skipped when answer === 'let'.
- RUNS: scratch/arc/A-sim-r1/warn1.log, strike1.log (verify-A-r1-tower.sh warn|strike 1..8 via slot.sh, 18:38Z).
- RUNS 18:45Z: warn2.log (A-sim-r1-warn.sh 1..8, base-0.1 formula), confuse1.log (verify confuse 4 1 5 8 2 3 6 7, SCATTER_SITE 3.4 bar). strike1.log killed? no: running.
- #2 code: scatter site bar SCATTER_SITE 3.4 (the bud bar) else splitOff's own search. Measuring (confuse1.log).
- #6 DIAG (not fixed yet): probe _harness/arc-work/A-sim-r1-kind.ts <seed> (7 s/seed, no slot needed). Seed 1, spec kind run
  (answer open prayers, else 40 bread every 3 days, 24 days = 2 y): 0 prayers opened, 8 gifts; means faith/fear/trust/loyalty
  d3 .20/.05/.15/.04 -> d24 .46/.04/.49/.12, quiet throughout. Loyalty relaxes to faith x clamp(trust+0.5 fear) at 5 %/day
  (regard.ts:483), so devoted (loyalty >= .35) needs faith x trust >= .35 (e.g. .6 x .6): a direct dL on help is undone by
  the relax. Candidate fixes: (a) gift witness magnitude larger / help also lifts the relax target ("favour" term) ;
  (b) a town opens a thanks/blessing prayer when content (new prayer kind = §6 contract change); (c) spec: add life.bless.
- #5/#12 PLAN (not done): option (c) "favour as pride": prayers.ts answered() -> r.since.chosenN (decayed, half-life 3 y);
  arc.ts prideParts F = max(1 - faith, clamp(chosenN / 3)). Note leaderOk needs pride >= 0.62 too, so (b) alone (roll
  base 0.55) cannot work. Then probe-t2att.sh 1..8 and probe-t2.sh 1..8 via slot.sh.
- #5 code (c) landed: prayers.ts answered() since.chosenN/chosenT; arc.ts chosenOf(), F = max(1-faith, chosen). Unattended worlds untouched (no answered prayers). RUN t2att1.log (probe-t2att.sh 1..8, 20 y) queued 18:5xZ.
- #6 TRIED + REVERTED: help witness dL = 0.1 x mk (regard.ts): loyalty d24 .12 -> .21 on seed 1, faith still .46 (< .5):
  no devoted. Seed 2 opened ONE prayer (day ~16); answering it jumped faith .33 -> .55, trust .37 -> .68, devoted day 22.
  So the lever is answerable prayers (or a much larger gift effect). Next: consider a content town's "thanks"/"blessing"
  prayer kind (contract change §6) or gifts as answered need; measure with A-sim-r1-kind.ts 1..8.
- tests/arc-tower-r1.test.ts NEW (5 tests: strike trust unprovoked/provoked + harmLoad +1, rebuild-from-30 % card, warn at
  10 % refused after 25 % reopens, seeded dice). Focused: arc-tower, arc-tower-r1, arc-hearts, prayers-pause, arc-babel,
  arc-freeform -> 39/39 pass; tsc clean. ARC.md §2.1 F and §2.4 heed edited; contract-changes.md "Stint r1-1" added.
- #3 measured strike1.log (7/8 seeds read): dead 1-10, no rebuild in 5 y: the gate is the HOST's pride (seed 1 host 0.53
  at y5 < 0.6), not the dice any more (dice now differ per world: test). Not a defect of the seeding.
- #4 first result warn2.log seed 1: first warning heeded by town 1 (die .089); 3 re-warnings all refused (cred falls
  0.05 per failed warning). Rest of the seeds pending.
## NEXT (stint 2)
1. Read warn2.log (A-sim-r1-warn.sh 1..8): need firstHeed >= 1 on 2-5/8 and status abandoned+sacred on >= 1/8. If the
   sacred branch never comes, stop the -0.05 cred loss compounding (e.g. floor cred at 0.2 for warnings) or raise +0.15.
2. Read confuse1.log (verify confuse 4 1 5 8 2 3 6 7): deaths.cold in d30 must be ~0 (baseline 0 on all 8). If still cold
   deaths, look at deathsAt keys (cold@<newTown>:<days>) and give scatter daughters starter fuel / delay in winter.
3. Read t2att1.log (probe-t2att.sh 1..8, 20 y): firstYear <= 14 on >= 3/8. If not, add option (b) chance x2 while attended.
4. #6 M3 kind: see DIAG above. #7: re-run verify-A-r1-tower.sh let 1..8 (finished 8/8 expected).
5. Gate: npm run check via slot.sh (another agent's check pid 3485 was running at 18:38Z on this tree: wait for it).

## LEAD NOTE 2026-11-08 (owner rulings; supersedes NEXT items 1-3 and #5/#6 plans)
See contract-changes.md "Owner rulings 2026-11-08": chosen term removed, T2 attended dropped, confuse indirect deaths
accepted (no scatter shelter fix), heed made very rare. Remaining for this lane: #6 M3 kind run (hearts must respond to
the god's acts: a town the god helps over 2 years can become devoted; justice, not favour), #7 let re-run, gate.

## Stint 2 (2026-11-08 ~18:2xZ, after the owner rulings)
- #6 M3 kind FIXED (regard.ts keptBy / KEPT_GAIN 0.8 / KEPT_LOYALTY 0.3, see contract-changes "Stage A sim r1, stint 2").
  Diag: a fresh sandbox town never needs anything in 2 y (hardDays 0, 0 prayers even with natural disasters on or with no
  gifts), so the run is 8 gifts; per gift faith ~+0.035; loyalty's aim faith x trust lagged. Runs (A-sim-r1-kind.sh):
  kind0.log before 0/8; kind1 (aim term only) 0/8; kind2 (GAIN .5) 4/8; kind3 (GAIN .8) 7/8 devoted day 19-23.
- #2 confuse: act kills no one (test); indirect cold/hunger deaths of the daughter towns counted after 1 y
  (tw.scatter.lost) and told once (tower.lost line + event). New test in arc-tower-r1.test.ts.
- #4 warn (lead's heedRoll): warn3.log 8 seeds x up to 3 warnings: heed per town max 0.075, median 0.016-0.027, 0 heeds
  in ~80 rolls (rare, as ruled); seed 1 run twice: identical RESULT (reproducible). Sacred place on heed and provoked
  strike after refusal: unit tests (arc-tower T8, arc-tower-r1). warn4.log = WARN_N=1 + strike right after refusal.
- #7 let: let2.log 8/8 finished at goal 80 (y5.1-5.5), later strike/confuse on the standing tower work.
- #1 card / #3 seeded dice: arc-tower-r1 tests green (6/6).
- Focused: arc-hearts, living-relationship, prayers-pause, arc-tower, arc-tower-r1 60/60; living-content,
  living-integration, mods, omnipotence, people 92/92; tsc clean.
