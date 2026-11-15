# Lane B — buildings sit on dry land (tasks 1 and 2)

Session 1, 2026-11-15. Owner bug: babel seed 307987276, "Rubolhin by the Lake", finished houses standing in lake water.

## Cause (measured, `_harness/arc-work/probe-dryland.ts`)
- Every placement rule asked only the building's OWN CELL (`f.water[cell] > 0.15`). A cell's water is its depth at the
  cell centre. Between centres the ground runs down toward the lake cell's bed and the lake's level runs out flat over
  it (that is what the renderer draws: `render/planet/fieldpack.ts` waterLevel, `ocean.ts`). A house in a dry cell
  beside a lake cell can stand metres deep.
- Pre-fix placement (old buildings.ts / settlement.ts / world.ts from git, measured with the final `standingWater`),
  babel year 0, finished non-dock buildings in more than 0.3 m:
  307987276: 23 of 168 (worst 2.10 m); seed 7: 5 of 167 (worst 9.41 m); 20261008: 9 of 167 (worst 3.22 m).
- Second cause, smaller: scenario worlds are not settled at day 0. Lakes rise 0.15-0.4 m in the first days; a cell
  whose ground lay 0.3 m BELOW the lake cell beside it was dry at day 0 and under 0.41 m at day 3.

## The measure (three tries; the reasons matter for whoever touches it next)
1. Blended cell depths (`grid.sample(water)`). Wrong on steep shores: beside a 9 m deep sea cell it reads metres of
   water on ground well clear of the sea. The god-test helper town Aru (n 20, a +0.6 m spit between sea cells) found no
   room: 15 tests failed (worship, pens, temple "no room left", infants walking 763 m).
2. Drawn sheet minus drawn ground (fieldpack's waterLevel rule mirrored, over `curvedSurface`). Right at lakes, wrong
   on hillsides: a 3 cm rain film is a "wet" cell with a level, the level tilts down the slope, the curved ground
   sags under the chord, and the reading is 0.5-1 m. Seed 20261008 lost 13 granaries of a hill town in two years.
   (The renderer discards that leaning sheet in the fragment shader.)
3. FINAL: the LESSER of the two. `waterDepthAt = max(0, min(blended depth, drawn level - curved ground))`.
   No detail relief in the ground (the drawn sheet drapes over the bumps as a film; with it a 5 cm film over a hollow
   read half a metre).

## What changed
`src/sim/people/world.ts` (new section "dry ground"):
- Named constants: `WADE_DEPTH` 0.6 (isLand), `SITE_WET_MAX` 0.15, `STANDING_WATER_MAX` 0.3, `DROWNED_DEPTH` 0.5,
  `FLOODED_DEPTH` 0.6, `FLOOD_RUIN_DEPTH` 1.5, `SITE_FREEBOARD` 0.3.
- `dryCell(p, c)`: land and <= SITE_WET_MAX (the old test, named).
- `waterDepthAt(p, pos, rise)`: the measure above; `rise` lifts standing water (cells deeper than 0.3 m) by that much.
- `standingWater(p, pos, footprint, rise)`: deepest of the point and 8 points round the footprint edge.
- `aboveWater(p, c)`: no neighbour holds standing water whose level is within SITE_FREEBOARD of this cell's ground.
- `dryAt(p, pos, footprint, cell)`: dryCell && aboveWater && standingWater(with the lake 0.3 m higher) <= 0.15.
  THE placement test. A lake must rise about 0.45 m before the sweep takes a house placed by it.

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
  moveHeart -> `FLOOD_RUIN_DEPTH`. (Same numbers, same comparisons: no behaviour change in these.)
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

## Results after the fix (final code, `bash _harness/arc-work/probe-dryland.sh`, default grid, 3 years = 36 days)
| seed | y0 finished / in > 0.3 m | y3 finished / in > 0.3 m | lost to flood in 3 y |
|---|---|---|---|
| 307987276 | 168 / 0 | 245 / 0 | 0 |
| 7 | 167 / 0 | 276 / 0 | 0 |
| 20261008 | 167 / 0 | 269 / 0 | 1 (a mine at a pit pond that filled in rain, day 9) |
- Year-0 building counts are the same as before the fix (168 / 167 / 167): the towns still find room.
- Aru (the god-test helper town, n 20): 19 buildings placed, none in water.

## Tests (task 2)
`tests/dryland.test.ts`, 4 tests, about 25 s CPU:
1. babel 307987276 default grid: the town exists; year 0 no finished non-dock building in > 0.3 m; over 0.25 years
   (3 days; a year here is 12 days) none stands in it two daily checks running; then the old-save sweep case.
2. and 3. babel seeds 7 and 20261008 at n 32: same invariant.
4. `aboveWater` / `dryAt` unit case.
`DRYLAND_YEARS=3 node --test tests/dryland.test.ts` runs the long form.

## Final runs (2026-11-15, final code)
- `bash _harness/slot.sh npm run check`: detban clean (152 sim files), typecheck clean, 1002 tests, 1001 pass, 1 fail.
- The one failure is `tests/arc-determinism.test.ts` "save at year 40, load, run to year 80 equals a straight run"
  (Lane C's new test, 42 min). NOT caused by this work: the same test run on a tree copy with the three files as they
  were before this lane (git 66cec8a3 versions of buildings.ts, settlement.ts, world.ts) fails the same way (different
  hashes, same assertion). With `ARC_TRACE=1` on the live tree the first differing day is day 153 after year 40.
  Owner: Lane C (src/sim/god).
- `npm run build`: passes.
- `node --test tests/dryland.test.ts`: 4/4, 22-28 s wall.
- `_harness/arc-work/probe-dryland-reload.ts 1 4 12` (babel seed 1, n 20, save at year 4, load, compare each year to
  year 12): equal every year. The flood sweep and the dry-site rules do not disturb save/load.
- Hash or golden pins changed: NONE. No test outside tests/dryland.test.ts was edited.

## Open / NEXT
1. God lane: `god/tower.ts:318`, `god/defiance.ts:323`, `god/sacred.ts:160`, `god/projectiles.ts:229` place buildings
   with `addBuilding` directly. Call `dryAt(p, pos, footprint, cell)` there. The sweep skips the Tower ('wonder').
2. Render lane D task 3: the renderer's own wet test (`render/life/buildings.ts` place(), blended depth > 0.3) is not
   the sim's measure; on steep shores it calls dry houses wet. Mirror `world.ts waterDepthAt`.
3. Task 3 (graduated wet state, one chronicle line per town): the sweep ruins at once and tells only 'collapsed'
   events. An old save of the owner world loses about 23 buildings on its first day, with no chronicle line.
4. A whole town cell under more than 0.3 m for a daily check (a real flood) ruins every building in it. Intended by
   the task; the graduated state of task 3 is where to soften it.
5. Not seen by eye: no shot of Rubolhin was taken (no browsers in this stint).
