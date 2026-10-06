# ECON lane brief: XP that rewards every way of playing (owner request, `_spec/FUN.md` section 2)

> **Session 2 (2026-10-06): read RESUME.md right after COMMON.md. It supersedes the paths, the machine rules and the "where the previous engineer stopped" parts below (the work moved to the owner's Windows PC). Verification charters: VERIFY.md.**

**You own:**
- `src/core/meter.ts` and `src/collection/meterfeed.ts`
- `src/collection/index.ts` and `src/collection/types.ts` (only for the new preview member)
- `_harness/sim_economy.ts`, `_harness/probe_economy.ts`, `_harness/probe_collection.ts` (meter rows only)
- `_spec/DESIGN.md` section 5.4, and the meter numbers in `_spec/COLLECTION.md`, `_spec/MERGE.md` and `_spec/NEXT_STEPS.md` where
  they quote pay values

You use no browser and no port. Your scratch folder is `scratchpad/econ/`.

**Read first:**
- `src/core/meter.ts` (its header is the rule book)
- `src/collection/meterfeed.ts` and `ghost.ts`
- `_harness/sim_economy.ts` (the reference simulation and its player archetypes)
- `_spec/DESIGN.md` section 5 (5.4 interactions and pay; the 3.1-3.8 active minutes per capsule that set MERGE_COST = 2)
- `_spec/FUN.md` section 2
- `src/contracts.ts`, the PULL INTENSITY note: a 'snap' intensity is now the pull level (1.0 = the family's maxPull), and `heldFor`
  is the seconds held

## What the owner reported

"Dragging out to stretch and holding it should slowly give XP as well, not just hold and drop, or hold squish. A quick poke doesn't
do anything, but it should give a little bit of XP."

**Measured today, on the real collection:**
- A poke pays 0.8 SP, but the anti-mash freshness rule ((gap / 0.9 s)^2, floor 0.03) makes ordinary fast tapping (2-3 taps a
  second) pay almost nothing.
- A pull pays a flat 1.8 SP, whether it was held 0.5 s or 3 s.
- A squeeze pays 0.7 + 0.45 per second held (capped at 3 s), plus a soft pop.
- The first meters are 30, 50 and 75 SP, then 100 SP per capsule.

## Change

1. **Stretch-and-hold pays per second held**, like a squeeze: a base plus a per-second rate while the pull level was at least 0.35,
   up to the same hold cap. A pull that never reached 0.35 pays the "never stretched" rate. Use the 'snap' event's `heldFor` (check
   in `src/physics/softbody.ts` that it is the seconds the pull was held, and report it if not).
2. **Ordinary tapping always pays a small visible amount.** Soften the poke freshness: for example a shorter tau and a higher floor,
   so 2-3 taps a second still earn. Machine-speed mashing stays bounded by the per-minute valve and the daily cap; show the bot
   numbers.
3. **Keep the pace.**
   - Re-tune the pay constants with the simulation, so median active minutes per capsule for human archetypes stays in 3.0-3.8 and
     no archetype is far faster than another (a puller must not be much faster than a poker).
   - Report the full sim table before and after.
   - If the pace cannot stay in band, say so: MERGE_COST = 2 depends on it.
4. **Pending preview for the UI.** Add a pure, allocation-free `collection.previewTouch?(kind, heldS, level)`, returning the SP that
   touch would pay if it ended now, including freshness. The shell draws a growing "pending arc" with it while a squeeze or stretch
   is held. Add it to the `Collection` interface, documented.
5. Update `probe_economy` and `probe_collection` (re-specify only the rows the owner's change makes obsolete, each with a written
   reason), and `DESIGN.md` 5.4 and the quoted numbers elsewhere.
6. **The server SQL drafts in COLLECTION and TRADE mirror these rules** (time budget and plausibility checks). Update the quoted pay
   values and macros in those drafts so they stay consistent, and keep them marked NOT APPLIED.

## Report
- The new rules.
- The sim table before and after: per archetype SP/min and minutes per capsule, bots, and the valve.
- The probe counts.
- The `previewTouch` signature.
- The docs updated.
- Known issues.

Time box: about 3 hours.
