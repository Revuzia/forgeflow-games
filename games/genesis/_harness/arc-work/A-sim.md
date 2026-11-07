# A-sim ledger (sim engineer, stage A) — trust this file

## Plan (priority order)
1. §6.1/§6.2 state + views types, emptyRel defaults, toJson key sort, migrate15 `arc` HeaderStep
2. §1 hearts: arc.ts (ARC tunables, personHeart, heartsDaily, dusk, events, chronicle heart.*), relSnapPlanet views (SettlementView.heart, MoverBlock.heart), query('hearts'), tests/arc-hearts
3. §2.1 pride (+ lastHarm at endAct), tests/arc-pride
4. §2.2-2.4 tower (tower.ts), commands, freeform, babel scenario, tests/arc-tower
5. §10 8-seed x 25y flood measurement probe (_harness/arc-work/probe-flood.ts) via slot.sh; record numbers
6. §8.1/§8.2 multi-seed probe _harness/probes/arc.ts

## Stint log
### Stint 1 (2026-11-07)
- started; scratch dir _harness/scratch/arc/
- DONE item 1 (§6.1/§6.2/§7): state.ts (all §6.1 types; HeartKind/DefyKind/Vow re-exported from types.ts; emptyRel defaults; relJson sorts defied/told/memory.peak/annals/godActs), types.ts (AnimState 40-43, HeartSign, TowerView, MoverBlock.heart, SettlementView.heart/defiant/covenant, PlanetSnap.towers/covenant/covenantOffer/age/epithet), migrate15 `arc` HeaderStep. tsc clean.
- DONE item 2 core (§1.1-1.3, §1.5, §2.1 pride): new src/sim/god/arc.ts (ARC tunables, personHeart, prideParts/prideTarget, heartsDaily w/ lazy §7 init, hysteresis, proud flag, dusk ema/low, tellOnce throttle via told, events heart/heart.proud, heartView, heartSigns -> MoverBlock.heart, heartsQuery, setPride, noteHarm). Hooks: relationship.ts (heartsDaily after conversions; heartView+heartSigns in relSnapPlanet; 'hearts' in REL_QUERIES/relQuery); regard.ts endAct -> noteHarm (lastHarm/harmLoad on god-0 non-natural harm). src/data/scripture.json (caption/line/person/share/prideWhy/remember). events.json heart.nobow/bowagain/fearful/restless/defiant/devoted/proud/cowed. tests/arc-hearts.test.ts 6/6 pass.
  gaps: cohorts not counted in shares (agents only, like meansNow); fist via TASK.defy and hurl wait for stage B; harmLoad only counted, not used yet.
- DONE: debug `pride.set` (arc.ts registerArcCommands, called from registerRelationship); agent detail (people/query.ts) gains `heart`, `heartLine`; tests/scripture_lint.test.ts (3/3; story output to add in stage C).
- §10 probe: _harness/arc-work/probe-flood.ts (forced natural floods, 8 seeds x 3, warned vs Wn-cut baseline) -> _harness/scratch/arc/flood.log. The 25-year natural-disaster form is still NOT run.
- full gate launched 01:0xZ: slot.sh npm run check -> _harness/scratch/arc/check1.log (pid in _harness/scratch/arc/check1.pid)
- §10 forced-flood probe RESULT (flood.log): 24 floods (8 seeds x 3), evacuated (>= half of members beyond danger radius or on TASK.evacuate when the water comes) 24/24 = 100 %; with the warning cut (Wn 0, orders withdrawn) 0-3 of ~30 out. Deaths warned 1 vs unwarned 1 (survivable-wrath floods rarely kill at the default, so deaths are no discriminator here). Caveat: Wn is 535 in every clone (same disaster id). Still TODO for §10.3: the 25-year natural-disaster run (deaths vs a baseline, other disasters unmoved) and the looked-at river shot (render/ui lane, or a sim-lane shot spec on port 5310).
- GATE: full `npm run check` (slot.sh) 772/773; the one failure (living-migration: old 1.5 save hash changed because emptyRel's new [] / {} defaults were saved) FIXED in state.ts relJson (empty ARC defaults are not written; emptyRel restores them on load). After the fix: tsc clean; focused living-migration, arc-hearts, determinism, save-continue, flood-warning, scripture_lint all pass (36 tests). Full suite not re-run this stint (one per stint rule) -> next stint should run it once.

### Stint 2 (2026-11-07 ~04:0xZ)
- Read verifier ledger verify-A-r1-sim.ledger.md: M1/M2 PASS; M3 harsh heart.nobow FAIL (dusk ema max 0.24-0.32, never above
  duskHigh 0.45, so dusk.low never arms) -> still OPEN (fix idea: arm from the town's own peak, e.g. low when ema < 0.55 x
  its 1-year peak after a peak >= 0.2, or rescale duskLow/duskHigh to vespers reality; needs a §1.2 contract note).
- DONE §2.2-2.4 tower core: NEW src/sim/god/tower.ts (TOWER tunables; towerDaily = yearly trigger on year-day
  hash32(planet)%yd + daily while a town has rel.since.towerArm (scenario hook, skips world age, gap and roll); leaderOk /
  leagueOf / siteOf / beginTower (great-tower Building via ps.addBuilding, name "the Tower of {placeRoot}", goal by era);
  rising(): builders B, material from each league store, growth dh, faith -0.0015/d, grievance/why.tongue -0.001/d,
  since.tLeague (pride +0.002/d clamp target+0.15 in arc.ts heartsDaily; prayer x0.7 and vespers x0.8 in relDecide),
  one speech every 2 y, tier/omen/choice at 25/50/75 %, warn heed roll on day 5 (0x70e5; sacred place if all heed;
  disabledUntil +1 y if refused), hardship abandon (0x70e2), finish / silence (godActs.silence); standing() faith drift
  for let/silence (cap 0.25); rebuild roll after a strike (0x70e4, since.tRebuild); answers confuse/strike/warn/let with
  ArcEvents + memEvents + memory; towerTask (relDecide hook: ~12 visible host builders per quarter-day on TASK.build at
  the great-tower; the warning prophet preaches at the site); towerView/towerViews -> PlanetSnap.towers; towersQuery
  -> query('towers'); towerWords (for freeform "what are they building"); commands tower.confuse/strike/warn/let/begin.
  Wiring: relationship.ts (registerTowerCommands, towerDaily after the hearts loop, towerTask + leagueDamp in relDecide,
  snap.towers, REL_QUERIES 'towers'); wrath.ts WRATHFUL += 'tower.strike'; buildings.json great-tower appended;
  events.json 17 tower.* lines; content.ts TEMPLATE_VARS += host league prophet reading a b dead. Contract notes in
  contract-changes.md. tests/arc-tower.test.ts 6/6 (no-tower refusals, begin/rise/view/query, confuse T6 core,
  strike T7 core, let + save/load + determinism, warn heed reproduces T8). tsc clean. Focused: audio-arc, audio,
  content, living-content, scripture_lint, arc-hearts (75 pass); determinism, living-migration, save-continue,
  flood-warning (27 pass).
  gaps (tower): let's side effects beyond faith drift/grievance (loyalty x0.8, rival threshold, discovery +5 %, golden
  q-0.5, later prophets cred -0.1) NOT built; omens are emitted + told but not routed through omens.ts; strike does not
  dispatch a miracle (godAct harm + direct deaths; render shows the fall from status); scattered daughters go through
  splitOff('scatter') with no >= 4 km site rule; the pride>=0.5 / langDistance check of the league is not re-applied
  daily; polity opinions -0.25 only when a relation already exists.
- Full gate launched at end of stint 2: slot.sh npm run check -> _harness/scratch/arc/check2.log (pid in check2.pid).

## NEXT (stint 3)
1. Check the stint-2 full gate log _harness/scratch/arc/check2.log (pid file check2.pid); fix any failure.
2. `babel` scenario (§6.8): needs a PeopleEntry option in src/sim/world/scenarios.ts (towns clustered within 10 km, one
   language line, pride 0.7, since.arc0 20 y back, since.towerArm = 1 on each town) + src/data/scenarios.json entry;
   test: begun <= 30 days, first tower.choice <= 2 years (T3), one speech <= 0.18 after 2 y (T5).
3. M3 dusk nobow fix (see stint 2 note).
4. Freeform §6.5 tower phrases + "what do they feel"/"what are they building" answers (freeform-signs.ts intentSigns).
5. defiance.set debug; _harness/probes/arc.ts multi-seed T2 (unattended 8 seeds x 60 y: towers on 2-5/8, none < y10,
   median first 15-35, <= 2 attempts) -> tune TOWER.towerChance; T4 (>= 50 % goal in <= 6 y, >= 2 omens, builder on site).
6. §10: "other disasters unmoved" comparison; river shot was being run by another lane (slot 1, port 5312, 03:58Z).

### Stint 3 (2026-11-07 ~06:00Z)
- stint-2 full gate check2.log: 798/798 PASS.
- DONE babel (§6.8): scenarios.ts PeopleEntry `cluster`/`pride`/`prideYears`/`towerArm` + clusterPeople(); scenarios.json
  `babel` ("One speech", plains-folk bronze, 4 x 90, mudbrick + 60 mudbrick in store). tests/arc-babel.test.ts (pass).
  Probe _harness/arc-work/probe-babel.sh (4 seeds, log scratch/arc/babel2.log): 4/4 four towns, max pair 5.4-8.1 km,
  langDistance 0; begun day 0.75; first tower.choice year 1.15; league langDistance 0 at 2.2 y; height 40-42 % at 2.2 y.
  T3 (sim part) and T5 PASS. (T3 shots = render lane.)
- DONE freeform §6.5 tower + hearts phrases: freeform-signs.ts arcIntents (first in intentSigns after `if (!p)`):
  confuse/strike/warn/let phrase sets, negation refuses with a hint, soft phrases ("let them build", "leave them be",
  "send a prophet to") only while a tower rises; "what are they building"/"why are they proud" -> towerWords;
  "what do they feel"/"are they angry"/"how do the people of X feel" -> arc.ts heartWords (words, no numbers).
  tests/arc-freeform.test.ts 3/3. (covenant/defiance/story phrases are stage B/C.)
- M3 dusk nobow fix (see contract-changes.md stint 3): peak-relative flags + hearts keep people home (vespers.away) +
  shunned rule. probe _harness/arc-work/probe-dusk.ts: harsh seed 1 nobow day ~12, calm seed 1 none.
  8-seed harsh+kind via probe-m3.sh -> scratch/arc/m3b.log (launched ~06:25Z).
- M3 RESULT (scratch/arc/m3b.log, 8 seeds, verifier probe): harsh fearful within 1 y 8/8, heart.nobow 8/8 (once each,
  low ~20 days) PASS; M2 0.17 changes / 6 days. Calm seed: no nobow. Kind (gifts only, no bless): devoted 0/8 in 2 y --
  the verifier's kind run with life.bless (verify-A-r1-kind.ts) takes devoted at ~day 22.6 (= 1.9 y) on seed 1 (loyalty
  >= 0.35 is the slow gate); 8-seed form queued -> scratch/arc/kind8.log. Not yet judged.
- heartWords groups towns that feel alike ("In Ku, Gaheis, Kith and Saabar nearly all murmur against you. They are proud.").
- NEW _harness/probes/arc.ts (§8 probe): modes `unattended <seed> [60]` (T2, T4, M2) and `babel <seed> [2.2]` (T3/T5).
  babel seed 1: on-site builder 80 % of sampled work hours, 1 omen by 28 %.
  T2 runs LAUNCHED ~06:13Z via _harness/arc-work/probe-t2.sh: seeds 1-4 -> scratch/arc/t2a.log, 5-8 -> t2b.log
  (one RESULT line per seed; ~?? min each).
- Focused tests green after all stint-3 code: arc-babel, arc-freeform, arc-hearts, arc-tower, living-relationship,
  living-integration, content, scenarios, determinism, living-migration (all pass). tsc clean.
- Full gate QUEUED: waiter (pid in scratch/arc/check3.pid) waits for another lane's `npm run check` (pid 1137, same tree)
  then runs slot.sh npm run check -> scratch/arc/check3.log.

## NEXT (stint 4)
1. Read scratch/arc/check3.log (`# fail 0`?); fix failures. If the waiter died (restart), run slot.sh npm run check once.
2. Read t2a.log / t2b.log: T2 wants towers on 2-5/8 seeds, none before y10, median first 15-35, <= 2 attempts per seed;
   T4: >= 50 % in <= 6 y (detail.half), >= 2 omens per tower reaching 75 % (detail.omens), onSitePct >= 80.
   Tune TOWER.towerChance (0.06-0.30) / leaderPride if off; re-run.
3. kind8.log: devoted within 2 y on >= 6/8 (with bless). If short, consider the devoted loyalty gate (contract §1.1).
4. §10: "other disasters unmoved" -- compare non-flood natural disasters (kind, start, deaths) live vs cut per seed
   (verify-A-r1-sim.ts world mode lacks these fields; extend in a copy in arc-work). Floods: verifier already measured
   evac 9/9 = 100 %, deaths 0 vs 0. River shot: render/ui lane (river-warning.json spec ran on 5312 ~06:10Z).
5. Tower gaps from stint 2 (let side effects, omens via omens.ts, strike via miracle, scatter >= 4 km site rule).
6. Attended pacing T2 (scripted gentle god): first tower in 7-14 y on >= 3/8.

### Stint 4 (2026-11-07 ~07:45Z)
- check3.log: 802/803; the one failure is tests/ui-thumblate.test.ts:44 (UI lane, timing under load; not sim). Not mine.
- kind8.log (verifier kind probe with gifts + life.bless, 8 seeds): `devoted` at the day-25 sample on 8/8 (quiet at day 13;
  seed 1 measured 22.6 d = 1.9 y). M3 kind: PASS (crossing between day 13 and 25 on every seed; ~2 y boundary).
- T2 (t2a/t2b, 8 seeds x 60 y): 0 towers on 8/8 -> FAIL. Max prides 0.89 / 0.82 / 0.64 / 0.44, i.e. one proud town per
  seed at most. Added exported diag `towerWhyNot(u, p)` in tower.ts (first failing leader condition per town + league
  size) and probe _harness/arc-work/probe-towerdiag.ts <seed> [years] -> scratch/arc/tdiag{1,5,6}.log (queued 07:44Z).
- §10 "other disasters unmoved": from the verifier's world results (scratch/arc/verify-A-r1-sim/live*.results vs cut*.results,
  same seeds 1-4, 6, 8): flood counts identical per seed (8/7/7/8/13/13); scheduled kinds (quake, tornado, meteor,
  meteor-shower, solar-flare, sinkhole, rift) identical counts except seed 6 quake 18 vs 19, solar-flare 3 vs 2;
  life-driven kinds (blight, infestation, stampede) differ by 0-2 from world chaos. Non-flood deaths live 7 vs cut 19
  (seed 1 stampede 0 vs 11; seed 4 sinkhole 7 vs 8). Flood deaths 0 vs 0 (survivable default; forced probe 1 vs 1).
  Verdict: MET (no systematic move; the warning only changes floods). §10 sim side DONE.
- tdiag1 (seed 1, old rule): leader 1 pride 0.62 at y19, pop 53-56 < 60 at y20-24, then qualifies from y25 but league
  needs a kin town of pride >= 0.5: its daughters (2,3,4) are < 40 people -> pride 0. tdiag5: leader peaks 0.64 at y14
  at pop 54, then the town shrinks under 40 and its pride collapses (the §2.1 pop floor).
- CHANGE (contract, ARC §2.2 (3) edited + contract-changes.md): kin villages < ARC.pridePop of one speech follow a
  qualifying leader into the league (tower.ts leagueOf). Test added (arc-tower "league: a kin village...").
- DONE tower gap "let side effects" (§2.4 let): tower.ts `towerStands(u, planet, sid)` (finished let/none tower, town in
  league, pride >= 0.6) used by regard.ts relDaily (god-0 loyalty target x0.8), prophets.ts makeProphet (credibility
  -0.1, min 0.05), chronicle.ts golden age bar q >= 3.5 instead of 4, people/knowledge.ts experiment chance x1.05.
  NOT built: rival-conversion threshold -0.05 (no single threshold found in rivals.ts; left as a gap). Test added
  (arc-tower "let, standing"). arc-tower 8/8, determinism + living-relationship pass, tsc clean.
- _harness/probes/arc.ts gains mode `attended <seed> [20]` (answers every open prayer daily); launcher
  _harness/arc-work/probe-t2att.sh -> scratch/arc/t2att.log. T2 rerun with the league change: probe-t2.sh 1-4 ->
  t2c.log, 5-8 -> t2d.log (queued 07:50Z).
- T2 rerun (league change only, t2c-oldpool/t2d-oldpool, seeds 1,5,6,7 done): seed 1 tower begun y34.9 (league 4, one
  speech 0.00 at 2 y, 2 omens, on-site 97 %), but 50 % only after 9.25 y, then abandoned at 52 % -> T4 FAIL (slow: the
  villages' stores have no material, each town paid only its own share, so the rate halved). Seeds 5, 6, 7: none.
- CHANGE (within §2.3's wording "each builder-day takes 1 unit from the host store; league towns send tribute"): tower
  material is one pool -- host store first, then the league's -- for all B units (tower.ts rising). Tests pass.
- T2 rerun #2 (pooled): probe-t2.sh 1-4 -> scratch/arc/t2e.log, 5-8 -> t2f.log (08:04Z); attended t2att.log running.
  Full gate queued: slot.sh npm run check -> scratch/arc/check4.log (pid 19437 in check4.pid).
- NOTE: render lane's slot.sh shots render-tower.json (pid 17881, port 5312) has held slot 1 since 06:32Z (> 1.5 h).
