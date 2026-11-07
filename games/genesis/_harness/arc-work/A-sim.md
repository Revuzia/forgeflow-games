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
- T2 rerun #2 RESULT (pooled material + follow rule; t2e/t2f): towers on 1/8 (seed 1 only, y34.9; half at 9.25 y,
  abandoned at 52 %, 2 omens, on-site 97 %, league 4, one speech 0.00) -> T2 FAIL (needs 2-5/8), T4 FAIL (half > 6 y).
  Pooling did not change seed 1: the stores hold NO tower material at all (have = 0.5 throughout).
  Attended (t2att, gentle god answering 56-222 prayers in 20 y): 0/8 towers; leader prides 0.15-0.66 (faith lowers the
  F term) -> attended T2 FAIL.
- Focused after all stint-4 code: arc-tower 8/8 (2 new), arc-babel, arc-hearts, determinism, living-relationship,
  discovery, knowledge-loss, save-continue, living-migration all pass; tsc clean.

## NEXT (stint 5)
1. GATE: scratch/arc/check4.log (full npm run check with all stint-4 code, 08:20-08:38Z): 807/807 PASS. Run it once
   again only after new code.
2. T2/T4 tuning (all knobs in tower.ts TOWER; any change to a bold §2.2/§2.3 number -> ARC.md + contract-changes.md):
   a. Material: no store ever holds mudbrick/brick/stone-block in the unattended world, so dh is always halved. Proposal:
      for `mudbrick` the league digs its own (have = 1 when the host knows mudbrick and the site is land), or let the
      tower's material units be bought from the store's raw clay/stone items; then half at ~3.8 y with B 9 (T4 PASS math).
   b. Leaders: seeds 5 and 6 reach pride 0.64 at pop 54 (< leaderPop 60) and then shrink. Try leaderPop 50 (seed 5 y14
      would then qualify; chance gate keeps "none before y10"). Re-run probe-t2.sh 1-8 (2 x ~13 min through slot.sh).
   c. Attended: a gentle god raises faith, which lowers pride (F = 1 - faith): 0/8 by y20. The spec's attended window
      (7-14 y) also sits under towerMinYear 10. Needs an owner/spec decision or an extra pride source for a favoured,
      prosperous town (e.g. P/U weight) -- note it as a §8.2 tension in contract-changes.md before tuning.
3. Rival-conversion threshold -0.05 under a standing tower (§2.4 let) still not built (find the conversion rule in
   god/rivals.ts / belief.ts). Other stint-2 tower gaps: omens via omens.ts, strike via a miracle, scatter >= 4 km.

### Stint 5 (2026-11-07 ~09:20Z)
- NEW tower.ts `towerCandidates(u, p)` (probe export: each town's raw §2.2 inputs) + probe _harness/arc-work/probe-tcand.ts
  (trigger off; one `C` line per check day) launched by probe-tcand.sh -> scratch/arc/tc-a.log, tc-b.log (8 seeds x 60 y,
  DONE). Offline evaluator _harness/arc-work/tcand-eval.mjs (GRID env JSON; recomputes the roll with the world seed).
- FOUND: the yearly roll hashFloat(planet.id, year, 0x70e1) was the same on every seed (same planet id) -> world seed added.
- CHANGES (ARC §2.2/§2.3 edited, contract-changes.md stint 5): roll + u.seed; TOWER.leaderPop 60 -> 50; towerChance
  0.15 -> 0.25; TOWER.rollBase (0.6, unchanged, named); rising(): builders who know mudbrick mould what stores lack
  (have = 1). Offline prediction: 3/8 begun (y14.8, 17.8, 24.8), median 17.8, max 1 attempt.
- DONE gap: rival-conversion threshold under a standing tower (disciples.ts conversion bar 0.5 -> 0.45 for rival gods,
  via towerStands).
- test added: arc-tower "empty stores: builders who know mudbrick mould their own" (arc-tower 9/9, arc-babel pass, tsc 0).
- LIVE T2 re-run launched 09:35Z: probe-t2.sh 1-4 -> scratch/arc/t2g.log, 5-8 -> t2h.log (~13 min each).
- LIVE T2 (t2g/t2h, seeded roll, leaderPop 50, chance 0.25, mould rule): towers on 3/8 (seeds 1 y24.9, 3 y17.9, 5 y14.9),
  median 17.9, 1 attempt each, none < y10 -> T2 unattended PASS (matches the offline prediction exactly).
  T4: seed 1 half 5.75 y, 3 omens, finished, on-site 93 % PASS; seed 3 (league of 2) half 8.08 y FAIL, 3 omens, on 92 %;
  seed 5 abandoned (hardship) at 23 %, on-site 17 %.
- CHANGE: TOWER.crew = 4 (least builders per league town, was 2; ARC §2.3 edited) -> re-run tower seeds: probe-t2.sh 3 1
  -> scratch/arc/t2i.log, probe-t2.sh 5 -> t2j.log (10:0xZ).
- PROBE FIX: _harness/probes/arc.ts on-site sampling used the planet clock hour (night at a far-side site): now samples
  when sunElevation at the tower > 0.35. (t2i seed 3 / t2j started on the old probe file.)
- DONE gap: scatter >= 4 km (tower.ts confuse: searchSite with rings sized to 1.6 x 4 km / cell spacing, skip < 4 km of
  home or < BUD_APART of any live town, score > 0; else the budding path's own site). arc-tower T6 asserts it.
- Tower-seed re-run with crew 4 (t2i/t2j): seed 3 half 4.25 y, 3 omens, finished (on-site 95 %, OLD probe); seed 1 half
  2.83 y, 3 omens, finished, on-site 55 % (NEW daylight probe); seed 5 abandoned (hardship) at 42 %, 1 omen, on 17 %.
  => T2 unattended PASS; T4 half/omens PASS on every attempt not abandoned; T4 on-site (>= 80 %) FAIL under the
  corrected daylight sampling (55 %; babel seed 1 1.2 y: 69 % -> 77 % after TOWER.shift 120 -> 360).
- CHANGE: TOWER.shift = 360 (visible builder's TaskSpec work at the tower, was 120).
- Focused after all stint-5 code: arc-tower 9/9, arc-babel, arc-hearts, arc-freeform, determinism, living-migration,
  save-continue = 37 pass; tsc 0. Full gate launched 09:57Z: slot.sh npm run check -> scratch/arc/check5.log (pid in
  check5.pid).

## NEXT (stint 6)
1. GATE: read scratch/arc/check5.log (`# fail 0`?); fix failures (a seed-bound test may move: the tower roll now uses
   u.seed, leaderPop 50, chance 0.25, crew 4, mould rule, shift 360, scatter site). If the run died, run it once.
2. T4 on-site: under daylight sampling a builder is at the tower in only ~55-77 % of work hours. Diagnose with a probe
   (at sampled moments: host members' tasks, `pressing`, isNight, how many decide per quarter-day; towerTask returns
   null for everyone when the hash misses -- the `return null` on the hash miss (tower.ts towerTask) also stops the loop
   over other towers). Likely fixes: keep a standing crew (the same ~12 ids for a whole day, hashed on the day, not each
   decision), or let a builder re-pick the tower when its shift ends. Then re-run probe-t2.sh 1 3 5 + babel 1-4.
3. Attended pacing T2: tension recorded in contract-changes.md (stint 5) -- owner/spec call; do not tune blindly.
4. Remaining small tower gaps: omens through omens.ts (would double the chronicle line: readOmen tells its own `omen`
   line; needs `starlings`/`halo` kinds appended to OMEN_KINDS), strike through a miracle dispatch.

### Stint 6 (2026-11-07 ~10:10Z)
- check5.log (stint-5 code): 808/808 PASS.
- T4 on-site DIAGNOSED: probe _harness/arc-work/probe-onsite.ts <seed> [years] (babel; hourly daylight samples at the tower;
  env SHIFT=n overrides TOWER.shift, PERIOD=d tests a day crew) + probe-walk.ts (per builder task: walk vs work ticks).
  The host lies 1-1.5 km from the site; the walk out takes ~750 ticks (2 m/tick) vs a 360-tick shift, then builders go
  home to drink. A day-long standing crew (tried) made it WORSE (60 %: the whole crew walks/works/drinks in step).
  FIX: quarter-day relays kept; the hash miss now `continue`s (was `return null`, which also skipped other towers);
  TOWER.shift 360 -> 600. Babel 2 y on-site: seed 1 83 -> 99 %, seed 2 86 -> 97 %, seed 3 97 %.
- DONE tower gap "omens via omens.ts" (in spirit, no new OMEN_KINDS: adding kinds would leak into god.omen's enum and
  the UI's omen tables): tower omens are picked by fit (lightning only in a storm, stormSeverity > 0.15; a halo only
  with sunElevation > 0.1; starlings always; the turn's kind when it fits, else hash 0x70f1 among fitting), and every
  league town reads it like a natural omen (god -1: faith +0.1, feared -> fear +0.05 / trusted -> trust +0.03,
  godSeen, sees_god, an `omen:tower.<kind>` act). One chronicle line (the tower's own). Test arc-tower "omens by fit".
- Strike via a miracle dispatch: NOT done, by design -- godAct(harm) + direct deaths; render draws the fall from status.
- RUNNING (10:24Z): T2/T4 tower seeds with shift 600: slot.sh probe-t2.sh 1 3 -> scratch/arc/t2k.log, 5 -> t2l.log.
- RUNNING: T7 8 seeds: slot.sh probe-strike.sh 1..8 (babel, rise 0.6 y, strike at default wrath in daylight, remains
  after 5 y) -> scratch/arc/strike8.log. seed 1 quick check: 9 on site, 3 dead (<= 50 %, <= 10), remains stand.
