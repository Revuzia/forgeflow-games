# POWERS-GROWTH build ledger (stage 1, the sim core) — 2026-11-16

Spec: `_spec/POWERS-GROWTH.md` v3 (owner rulings 2026-11-16 first + second: every power costs except the free list; trust and fear
coexist, two bars; slow pacing; NO pool income without believers).

## Built (all behind `u.god.bound` = `'reach.bound' in god.laws`; unbound worlds untouched)
- `src/sim/god/reach.ts` (new): `REACH` table; `setBound`; `reachSeen`; the count (roads bitmask 1 trust / 2 fear / 3 both,
  keep lines, capped at 2 per person); `measures` (per-town daily measure, attended, place factor); `credit` (the only pool writer when
  bound: town measure + cap); `reachDaily` (door offering for the road of fear, income tally by road, count, rise/fall); `chargeCheck` /
  `chargeCommit` (gate, price x size, 3x one band up, free list + free cooldowns, free clay); `reachView`, `reachPowerView`.
- `state.ts`: `ReachState`, `GodState.reach?`, `GodState.bound` getter, save/load (written only when present, sorted keys).
- `powers.ts`: one before/after hook: bound + god 0 -> reach gate (commit only on `res.ok`); else the old `restraintCheck`. Nested
  dispatches (an answer firing its deed) are never gated or charged. `powersQuery` adds `priceNow locked beyond affordable reason readyAt`.
- `belief.ts`: `miraclePotency` returns base for god 0 when bound. `acts.ts`: `meta.reach { bound }` (PLUMBING).
- `index.ts`: `reachDaily` at `t % 1440 === 917` when bound; snapshot `reach` (ReachView) only when bound. `types.ts`: `Snapshot.reach?`.
- `relationship.ts` (feast, offerings, query `reach`), `culture.ts` (`addWorship`, `sacrifice`): pay through `credit` when bound.
- `regard.ts` (bound, god 0 only): mercy does not lower fear; provoked harm costs no trust; cruelty costs half the trust; `reachSeen` stamp.
- `sim.ts`: `SimOptions.bound`; `worker.ts`: a new game is bound unless `options.bound === false`.
- `src/data/powers.json`: `tier`, `price`, `free` on all 229 (script `_harness/probes/reach-tag-powers.mjs`, idempotent; `cost` untouched,
  it is still the legacy restraint cost). Counts 110 / 13 / 39 / 45 / 22; 47 free.
- Tests: `tests/reach-measure.test.ts`, `reach-charge.test.ts`, `reach-save.test.ts`, helper `tests/reach-helpers.ts`.
- Probe: `_harness/probes/reach-pacing.ts <scenario> <help|severe|mixed|free|none> <seed> [days] [n]`.

## Deferred to later stages (not built; spec sections named)
- §2.3 modifiers (pride, open defiance, broken covenant) on count and measure; first-deed-free rule for open defiance / Tower (§3.6).
- Link ("as the people connect", §3.6), the visible threshold offering task (`TASK.offer`; today the door offering is paid in
  `reachDaily`), `templeWanted` fear clause, made-person rule (`freshen` skip), miracle widening by standing (§3.3).
- Strict position (bound + restraint): today, bound ignores `settings.restraint` for god 0; rivals still go through `restraintCheck`.
- Scenario start standings (§7.5); `origin: 'arc'` flag (nested dispatch covers answers that dispatch through the registry).
- `reachPowerView` does not know free clay (the gate does); commands with no catalogue power are not gated.
- UI (stage 5), audio cues for `reach.rose / reach.fell / reach.falling / worship.spent / reach.unbound`.
- Refusals emit no `worship.short` event (the gate changes nothing); the sentence is in the command result.

## Probe numbers: see the end of this file

## Probe numbers (reach-pacing.ts, n = 20; day each standing first reached; raw logs were in _harness/scratch/reach/)
| world | god | seeds | Whispered | Known | Worshipped | Most High |
|---|---|---|---|---|---|---|
| shore | help | 1,2,3 | 2,2,2 | 22,22,22 | - (60 d; people too few) | - |
| shore | severe | 1,2,3 | 2,2,2 | 26,29,25 | - | - |
| shore | mixed | 1,2,3 | 1,1,1 | 21,21,21 | - | - |
| shore | free spells only | 1,2 | 1,1 | 23,22 | - | - |
| shore | none | 1,2 | never | never | - | - |
| babel | help | 1 | 4 | 19 | 94 | not in 420 d |
| babel | severe | 1 | 2 | 17 | 92 | not in 200 d |
| babel | mixed | 1 | 3 | 18 | 94 | not in 200 d |
Targets (spec §5): Whispered day 1-6, Known day 17-60, Worshipped day 92-300, Most High a long game (>= day 272).
Income: shore ~38/day from 23 believers (help), 13/day under severe at day 60 (people halved); babel 250-480/day, pool pinned at cap.
Knobs: REACH.hold (pace), REACH.rite (income), REACH.terror, REACH.freeCooldown.

## Verification
- focused: node --test tests/reach-measure.test.ts tests/reach-charge.test.ts tests/reach-save.test.ts (12 tests) green.
- full: see the end of this file / the final report.
- full `bash _harness/slot.sh npm run check` (2026-11-16): detban clean, typecheck clean, tests 1015 / 1016.
  The ONE failure: `tests/audio-events.test.ts` "every sim event is mapped to a cue, or explicitly silent": the five new sim events
  are not registered in `src/audio/eventmap.ts`. That file is outside this stage's lane (and the edit was refused), so it is NOT done.
  FIX for the ui/audio lane, in `SILENT_EVENTS` (or real cues): keys `reach.rose`, `reach.fell`, `reach.falling`, `reach.unbound`,
  `worship.spent`, each with a reason string longer than 10 characters. Nothing else is needed for the check to go green.
- No existing test pin was changed; no existing test needed `bound: false` (worker tests pass with the bound default).

## Stint 2 (owner ruling 2026-11-16 third: "not rainbow, 2-3 other basics")
- Free basics now: rain, heal-person, plant, gift, extinguish, lightning, ignite (49 free in all). omen-rainbow priced 5 (tier 0).
  `wind` left priced: its default is world-wide for 3 days; `extinguish` taken instead.
- Free cooldowns: rain 60, lightning 60, ignite 60, gift 120, heal-person 30, extinguish 30. A free spell cast above its default
  radius / power is priced (half old cost x size): `priceOf` + the free branch of `chargeCheck`.
- Tag script, powers.json, spec §3.2 / §3.6 / §10 / summary, tests and the probe's `free` list updated.

## Stint 3 (2026-11-16, "fix all things not in build yet") — sim lane, IN PROGRESS (see the end for the final state)
- Code done + focused test `tests/reach-arc.test.ts` (6 tests) green: town view, clay / cooldown / size in the powers query,
  §2.3 hooks (pride, open defiance, broken covenant) with chronicle lines, link, TASK.offer, templeWanted fear clause,
  widening, scenario standings, Strict + legacy, first deed, made-person rule. Still to do when this line was written:
  pacing probe re-run, full gate, spec §9 status edit.

## Stint 3 FINAL (2026-11-16) — everything §9 listed as "Not built yet" on the sim side is built, bound worlds only
- `reach.ts`: `townState` (bits 1 proud / 2 open defiance / 4 broken covenant count, 12 d / 8 gives half, 360 d), applied in `count`
  and `measures`; `link` (trade/30, pilgrims within 360 d via `since.pilgrimFrom` | new `since.pilgT`, kin = contacts with half
  believers /3); chronicle lines `reach.rose / reach.fell / reach.town.proud|defiant|broken|back` (events.json; NO new sim event types);
  `doorOffering` + `offersToday` (TASK.offer = 60, `people/work.ts`, decision in `relDecide` while sun elevation 0.06..0.3 falling);
  `fearTown` (templeWanted clause); `reachWiden` (miracles.ts both cast paths, `meteorScale` in acts.ts); `startStanding` + `R.floor`
  (sim.ts reads `ScenarioDef.standing / standingDays`; scenarios.json: babel, coldforge 1/60; twoworlds-late, system 2/60; lookdev 4/0);
  `isStrict` (bound + settings.restraint: price = max(price, old cost)); first deed (`deedFor`, `R.deeds`, tier <= 2, once per open
  question, never spent by a free spell); made-person rule (powers.ts hook: makers `life.spawn-people`, `settlement.introduce`; the made
  get faith/trust/fear 0 and loyalty 1e-6 so `freshen` skips them); `meta.reach { bound, strict? }` (leaving legacy restraint is one-way).
- New state (optional, sorted on save): `towns[k].{n,nt,nf,nb,l,lt,lp,lk,x,k,yg,yf}`, `floor`, `deeds`, `off`.
- Query fields for the UI: see the final report (`reach`.towns/worlds/clayAll/freeBasics/strict/legacy/floor, `SettlementView.reach`,
  `powers` args + `size basePrice clay cooldown readyIn cooldownText freeDeed strict`, new query `reach.price`).
- Tests: `tests/reach-arc.test.ts` (6). Gate: `bash _harness/slot.sh npm run check` 1034 / 1034, detban clean; `npm run build` ok.
- Probe (n 20; day first reached W / K / Wo): shore s1 help 2/22/-, severe 2/29/-, mixed 1/21/-; shore s2 help 2/22/-, severe 2/38/-,
  mixed 1/23/-; babel s1 (starts Whispered by §7.5) help 0/17/115, severe 0/16/102, mixed 0/17/106 (130 d; before: 19/94, 17/92, 18/94).
  Worshipped is later because all four babel towns are proud (count single: F = believers, about 200-250 against the line 150).
  Known in babel is day 16-17 against the target floor of 17: hold 30 / top speed 2 = 15 days after the first counted day, and the start
  standing makes day 1 count. NOT retuned (hold 1/30/150/360 is an owner ruling); `hold[2]` 32 would give day >= 17 (32 / 2 + 1).
- Not done / for others: spec §9 status paragraph not edited (outside this lane); K (kin) has no test with more than one town;
  `disaster-random` filter and audio cues untouched; ARC Open Rebellion (unbuilt) has no hook.

## Review 3 fixes (2026-11-16, fix agent) — sim
- `reach.ts` `sizeK` (one size factor for `priceOf` and `sizeOf`): radius, power, scale as before, plus `everywhere` (as the widest
  brush, schema radius max / default), heads (`REACH.heads`: `life.spawn-people` count / 20, `settlement.found` count / 12,
  `settlement.introduce` people qty / 8), gift units / `REACH.giftFree` 20, rain duration / 720 x intensity, lightning wrath
  (its own, else the law) / `REACH.wrathFree` 0.3. `reach.price` / `powers` args now also take count, qty, people, items, duration,
  intensity, wrath, everywhere.
- `restraint.costScale` no longer scales a bound price: it only scales the Strict floor (`max(price, cost x scale)`).
- `REACH.freeCooldown`: `plant` 60 (so it is size-priced too), `throw` 30 (witnessed, wonder 0.2).
- `powers.ts` MAKERS: + `settlement.found` (the founded start at faith / trust / fear 0).
- `measures` keeps a town's given-so-far on a re-bind (unbind + bind in one day no longer reopens the measure; probe p1 P4).
- "1 minute more" grammar in the free cooldown refusal.
- Tests: `tests/reach-review3.test.ts` (5). Not done: no tier rise for large head counts (the price does it: 1 500 people = 1 875);
  spec text §3.2 / §3.6 not edited for the new size terms.
- Gate after review 3 fixes: check 1047 / 1047, detban clean (153 files), typecheck ok; build: see fix agent report.
