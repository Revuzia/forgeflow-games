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
