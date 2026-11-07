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

## NEXT (stint 2)
1. Run the full gate once via slot.sh (confirm 773+ green).
2. §2.2-2.4 tower: src/sim/god/tower.ts (towerYearly, league, site, TowerState, labour/tiers, omens, the four answers tower.confuse/strike/warn/let, tower.begin debug, TowerView in relSnapPlanet, query('towers'), events tower.*, chronicle tower.* lines), babel scenario, tests/arc-pride + arc-tower. Read ARC §2.2-2.7, §6.4, §6.5, §8.2.
3. defiance.set debug (needs §3 defiance; trivial setter like setPride).
4. Freeform phrases §6.5 for tower + "what do they feel" (hearts query answer).
5. _harness/probes/arc.ts multi-seed: M1 (100 % towns have heart after day 2), M2 (kind changes <= 1 per 6 days median, nobow <= 1 / 2 y), M3 harsh/kind runs; T-lines.
6. §10 25-year natural run + river shot.
