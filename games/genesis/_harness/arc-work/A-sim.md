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
