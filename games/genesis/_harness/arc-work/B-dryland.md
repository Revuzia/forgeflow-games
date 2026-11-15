# Lane B — buildings sit on dry land (tasks 1 and 2)

Session 1, 2026-11-15. Owner bug: babel seed 307987276, "Rubolhin by the Lake", finished houses standing in lake water.

## Cause (measured, `_harness/arc-work/probe-dryland.ts`)
- Every placement rule asked only the building's OWN CELL (`f.water[cell] > 0.15`). A cell's water is its depth at the
  cell centre; between centres the water lies as the grid interpolates it (`grid.sample`), and the renderer draws it
  that way (`render/life/buildings.ts place()` samples the same field under the footprint, wet at > 0.3 m).
- Before the fix, year 0 of the owner world: 35 of 168 finished non-dock buildings in > 0.3 m (worst 2.10 m), every
  one of them in a cell with 0.00 m of water. Year 2: 42 of 233.
- Second cause, smaller: scenario worlds are not settled at day 0. Lakes rise 0.15-0.4 m in the first days; a cell
  whose ground lay 0.3 m BELOW the lake cell beside it was dry at day 0 and under 0.41 m at day 3.

## What changed
`src/sim/people/world.ts` (new section "dry ground"):
- Named constants: `WADE_DEPTH` 0.6 (isLand), `SITE_WET_MAX` 0.15, `FOOT_WET_MAX` 0.05, `STANDING_WATER_MAX` 0.3,
  `DROWNED_DEPTH` 0.5, `FLOODED_DEPTH` 0.6, `FLOOD_RUIN_DEPTH` 1.5, `SITE_FREEBOARD` 0.3.
- `dryCell(p, c)`: land and <= SITE_WET_MAX (the old test, named).
- `waterDepthAt(p, pos)`: interpolated depth at a point.
- `standingWater(p, pos, footprint)`: deepest of the point and 8 points round the footprint edge.
- `aboveWater(p, c)`: no neighbour holds standing water whose level is within SITE_FREEBOARD of this cell's ground.
- `dryAt(p, pos, footprint, cell)`: dryCell && aboveWater && standingWater <= FOOT_WET_MAX. THE placement test.

`src/sim/people/buildings.ts`:
- `waterside(def)` (dock, shipyard, anything providing 'dock' = lighthouse): exempt from footprint test and sweep.
- `findSite` spiral (was l.314): `dryAt` for everything but waterside (those keep `dryCell`).
- `findSite` dock-centre fallback (was l.265) and `shoreSite` (was l.356): `dryCell` (water buildings, unchanged rule).
- `edgeSite` (was l.396): `dryCell && aboveWater` per cell, `dryAt` per spot.
- `reviseSite` (was l.153): a non-waterside site with > 0.3 m under its footprint is given up (materials back to the
  store); a waterside site keeps the old own-cell > 0.6 rule.
- `BUILD_GAP` 1.5 and `SITE_STEEP_MAX` 0.55 named.
- NEW `floodSweep(x, st)`: finished, not ruined, not waterside, not a wonder, `standingWater > 0.3` -> `ruin(x, st, b,
  'flood')` (the existing path: 'collapsed' event with text 'flood', books lost as for any ruin).

`src/sim/people/settlement.ts`:
- `daily()` calls `floodSweep` after `decayBuildings`.
- `settlementStep`: a FALLEN town's buildings are swept once a day too (nothing else ran for them).
- `siteScore` l.143 -> `dryCell`; l.567 / l.599 -> `SITE_WET_MAX`; abandonCheck -> `DROWNED_DEPTH` / `FLOODED_DEPTH`;
  moveHeart -> `FLOOD_RUIN_DEPTH`.
- `abandonCheck`: a RUINED building under > 0.5 m still counts as built and drowned. Without this the sweep, which now
  ruins drowned houses before the count, would have stopped "most houses under water" from ever being true.

## Placement sites checked
- All ordinary building goes through `planBuilding -> findSite` (callers: settlement.ts, spawn.ts, scenarios.ts,
  god/civic.ts, space/ships.ts, space/contact.ts). Fixed in one place.
- NOT changed (src/sim/god, another agent's): direct `addBuilding` in `god/tower.ts:318` (Tower, cell-level dry rule),
  `god/defiance.ts:323` (idol, spotInCell in the town's cell), `god/sacred.ts:160` (shrine, `dryCellAt` + spotInCell),
  `god/projectiles.ts:229`. These can still put a building with its footprint in water. The sweep takes idols and
  shrines like any building; it SKIPS the Tower (function 'wonder': tower.ts keeps its own life and does not read the
  ruined flag). NEXT for the god lane: call `dryAt(p, pos, footprint, cell)` at those four sites.

## Save compatibility
- No new saved state, no version bump, no migration. Old saves load as they are; the first daily step after load ruins
  each finished non-dock building in > 0.3 m (the owner world: about 35 of 168 on day 1, told as 'collapsed').
- Proof: tests/dryland.test.ts test 1 (a house moved into the lake, save, load, one day: ruined, one 'collapsed'
  event, text 'flood'; a dock in the same water stays).

## Results after the fix (probe-dryland.ts, default grid)
- 307987276: year 0 168 finished, 0 in > 0.15 m (worst 0.03); year 1 207 finished, 0 wet, 0 lost to flood.
- 20261008: year 0 166, 0 wet; year 1 207, 0 wet, 1 lost to flood (a mine beside a pit pond that filled).
- 7: year 0 161, 0 wet; year 1 200, 0 wet, 0 lost (run before the freeboard rule was added).
- Building counts at year 0 are unchanged (168 before and after): the towns still find room.
- 3-year, 3-seed run on the final code: see "Final runs" below.

## Tests (task 2)
`tests/dryland.test.ts`, 4 tests, about 25 s CPU:
1. babel 307987276 default grid: the town exists; year 0 no finished non-dock building in > 0.3 m; over 0.25 years
   (3 days; a year here is 12 days) none stands in it two daily checks running; then the old-save sweep case.
2. and 3. babel seeds 7 and 20261008 at n 32: same invariant.
4. `aboveWater` / `dryAt` unit case.
`DRYLAND_YEARS=3 node --test tests/dryland.test.ts` runs the long form.

## Final runs
(filled in below)
