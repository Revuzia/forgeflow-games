# Wick lane wobble: root-cause ruling (orch1, 2026-11-15)

Owner report (2026-11-15): Wicks do not walk the straight path. They drift slightly under it and curve back, mostly on the top lane near the 2nd tower.

Two diagnoses came in: the SIM lens (`wobble_sim.json`, `_harness/_tmp_wobble_sim.ts`) and the LIVE lens (`wobble_diag.json`, `_harness/_tmp_wobble_live.mjs`). I read the code they name and checked the map geometry. I also ran a counterfactual of my own, `_harness/_tmp_wobble_cf.ts` (outputs in `_design/reviews/orch1/wobble_cf_idle.txt`, `wobble_cf_idle_all.txt` and `wobble_cf_bots.txt`). It plays the same deterministic RIFT match twice:

- **base**: the match as it is now.
- **dense**: every Wick's lane path is resampled every 1 m along the *same* polyline. The vertices and the drawn road do not change, but followLane's reach loop now always aims 2.5-3.5 m ahead on the line instead of at a vertex about 9 m away.

If the dip came from the tower footprint, the nav grid, ruling 39 or separation alone, the dense run would not remove it.

## Verdict

| # | Claimed cause | Ruling |
|---|---|---|
| 1 | followLane corner-cuts each lane vertex: WAYPOINT_REACH 2.5 m, then a straight chord to a vertex about 9 m ahead | **CONFIRMED, primary.** The counterfactual removes most of it. |
| 2 | Separation spreads the 3 spawn columns where they pinch at each shared vertex | **CONFIRMED, amplifier of #1.** It mostly disappears when the vertex pinch goes. |
| 3 | After a fight, the Wick rejoins on a long diagonal to the next vertex | **CONFIRMED in code.** It is a separate, larger swing in fight zones, not the marching dip. Why fight positions sit below the road is not traced. |
| 4 | The lantern nav disc clips the outer column (s_high_lantern for team 1 on top, a_low_lantern for team 0 on bottom) | **CONFIRMED, minor.** It survives the dense run, as it should. Near the base, not the 2nd tower. |
| - | Ruling 39 (step-out, sealed strips), inner-tower footprint, nav A*, body lanes, render interpolation | **REFUTED as causes.** See below. |

The top lane is not worse than the bottom one. The bottom road dips by the same amount, but toward screen-up (toward the map centre). The owner notices it on top because there the Wicks bend down, away from the inner tower drawn above the road.

## Cause 1 (primary): waypoint corner cut in followLane

**Code**
- `src/sim/units/minions.ts:38` sets `WAYPOINT_REACH = 2.5`.
- `src/sim/units/minions.ts:132-148` is `followLane`:
  - `:142` advances `m.wp` once the Wick is within 2.5 m of the vertex.
  - `:143` aims at the vertex itself, `p[m.wp]`.
  - `:147` issues `issueMove(w, e, tx, ty, true)`, an attack-move to that vertex.
- `src/sim/movement.ts:582-585` (`stepToward`): when `nav.lineOfWalk` is clear, the path is empty and the Wick walks the straight chord.
- `minionSystem` only thinks every `MINION_THINK_TICKS = 6` ticks (`minions.ts:36`, `:243`). At 3.25 m/s that is 0.65 m per think, so the switch actually happens 1.85-2.5 m before the vertex.

**Geometry**: `content/maps/map_rift.json:852-886` (road_high) and `:888-` (road_low). Vertices are about 9.1 m apart. Bends I recomputed (+ means the inside of the curve is +y, which is screen down on the top road):

| Road vertex | Point | Bend |
|---|---|---|
| v1 | (22.8,38.6) | -13.8° |
| v2 | (26.2,30.1) | **+20.5°** |
| v3 | (32.3,23.4) | +15.7° |
| v4 | (40.0,18.6) | +12.3° |
| v5 | (48.7,15.5) | 6.9° |
| v6, v7, v8-v10 | | 5.2°, 3.7°, 2.5° |

The rest of the road mirrors these: v14-v17 on the team-1 side, and road_low with the sign flipped. The three sharpest bends are between the lantern and a_high_needle_inner (35,18.4), the 2nd tower. The tower sits 2.81 m off the v3-v4 segment on the *outside* (-y) of the curve.

**Predicted cut** at the 20.5° bend: 2.5·9.1·sin 20.5° / 11.47 = **0.69 m**. The LIVE lens measured a max of 0.74 m and medians of 0.48-0.53 m at v2/v16, every wave (39/39).

**Counterfactual**: wave-centroid lateral offset, i.e. the mean d of a wave's free Wicks per 4 m bin. Run: idle seats, towers alive, seeds 3/7/11, 8 min, 45 waves per bin. Each cell is median / max.

| Bin (s from team-0 end) | base | dense (carrot on the line) |
|---|---|---|
| road_high t0 s16 (v2 approach) | +0.43 / 0.46 | +0.21 / 0.22 |
| road_high t0 s20 | +0.35 / 0.42 | +0.09 / 0.10 |
| road_high t0 s28 (v3) | +0.50 / 0.55 | +0.16 / 0.18 |
| road_high t0 s36 (v4, by the inner tower) | +0.45 / 0.49 | +0.15 / 0.18 |
| road_high t0 s40 | +0.24 / 0.30 | +0.04 / 0.05 |
| road_high t0 s44 | +0.24 / 0.36 | +0.08 / 0.08 |
| road_high t1 s124 (mirror v14) | +0.46 / 0.48 | +0.11 / 0.11 |
| road_high t1 s128 | +0.47 / 0.51 | +0.15 / 0.15 |
| road_high t1 s132 | +0.44 / 0.55 | +0.15 / 0.17 |
| road_low t0 s36 | -0.47 / 0.48 | -0.12 / 0.13 |
| road_low t1 s132 | -0.50 / 0.56 | -0.16 / 0.19 |

Per-Wick |d| p95 drops the same way. On road_high t0:
- s16: 1.16 → 0.65
- s28: 0.82 → 0.43
- s36: 0.97 → 0.46
- s40: 0.75 → 0.11

On road_high t1:
- s124: 0.94 → 0.19
- s128: 0.91 → 0.21

Heading reversals over 90° among marching Wicks were 0 in both idle runs. The owner's "come back around" is the sawtooth recovery after each vertex, not a reversal.

The dense run still leaves about 0.1-0.2 m at the sharpest bends. A 3 m carrot still cuts slightly, which tells us how to tune the fix.

## Cause 2 (amplifier): vertex pinch plus separation

- **Spawn formation**: `minions.ts:119-121`. Rows of 3 with `COL_GAP 1.1` (`:40`).
- **Every Wick aims at the identical vertex**: `:143`. So all three columns converge on one point.
- **Separation pushes them back apart**: `separate(w, e, x, y, 0.5)` at `movement.ts:446-465`, called at `:623`.

Effect on road_high t0 s16: per-Wick max 1.29 m in base, 0.73 m in dense. The SIM lens labelled 8055 of 13636 episodes over 1 m as "push:ally-separation". Most of these vanish without the pinch. This is the same root as cause 1, not an independent cause.

## Cause 3: rejoin after a fight

`minionSystem` sets `m.chasing = false` and then calls `followLane` (`minions.ts:261-262`). followLane's forward search (`:135-140`) takes the *end vertex* of the nearest segment, up to about 9 m ahead, and walks a straight diagonal there.

The SIM lens traces show this:
- #10242: d 2.22 → 0.49 m over 7.9 m of travel.
- #6587: d 2.47 → 0.62 m.

These are the 2-3 m swings in the midfield and inner-tower fight zones. My dense run has the worst free bins (road_low t0 s92, road_high t0 s76; centroid up to 1.8 m) in midfield fight zones in both modes. So the rejoin needs its own term in the fix: aim relative to the Wick's *projection* on the line, not the vertex.

I did not refute or confirm why fight positions sit on the down side of the road. It is irrelevant to the fix.

## Cause 4 (minor): lantern clearance disc

- s_high_lantern (143.1,35.8) is 2.77 m from the v17-v18 segment.
- The lantern's nav disc is radius 1.5 + 0.35, so it reaches 0.92 m from the line.
- The outer column is 1.1 m out, so it clips the disc.

Both affected pairs keep a residual offset in the dense run, while their mirrors do not:

| Pair | base centroid | dense centroid | Mirror in dense |
|---|---|---|---|
| road_high t1 s152 | -0.64 | -0.40 | road_high t0 s8: -0.07 |
| road_low t0 s8 | +0.58 | +0.36 | |

The asymmetry follows the side of the partial last formation row (`col = (i % 3) - 1` fills col -1 first). The live lens measured 1 Wick per wave in 6-10 of 13 waves, up to 0.70 m off for about 1 s. This is near the base, not the 2nd tower.

## Refuted

- **Ruling 39 step-out** (`minions.ts:200-228`). It only runs on a held chase (`:250-251`). The SIM lens found 0 step-out ticks on free Wicks, and the LIVE lens found 279 of 729,974 frames in step-out, none while marching. `followLane`, `WAYPOINT_REACH` and the spawn formation are byte-identical on 098ac7436. The first-wave trace is byte-identical between the two commits, and own-side s36-40 mean offset is +0.40 vs +0.41.
- **Sealed strips, the inner-tower footprint and nav A\***. The tower is on the outside of the curve, 2.81 m off the line, and its disc radius is 1.45 m. There were 0 nav-path ticks and 0 structure contacts for free Wicks. The dense counterfactual leaves the tower, nav and every structure as they are, yet the dip near the tower falls from 0.45 to 0.15 m.
- **Body lanes**: `updateLane` only runs for `e.kind === 'fighter'` (`movement.ts:596`).
- **Render**: the drawn road is the same polyline (`render/terrain.ts:621`, `:805`). Drawn minus sim offset is a median of 0.005 m and a max of 0.109 m (LIVE lens).

## Fix design (do not implement here; src/sim is owned by the movement lane)

All changes go in `src/sim/units/minions.ts` (followLane and MinionState). No map content changes: the drawn road must stay the sim lane line.

1. **Carrot pursuit along the lane polyline** instead of vertex targeting.
   - Each think tick, project the Wick onto the path, searching forward only from segment `m.wp` (the loop at `:135-140` already finds the segment). This gives the arc position `s`.
   - Aim at the point `s + LOOK` on the polyline, clamped to the lane end, with `LOOK = 3.0 m`.
   - Keep `m.wp` as the segment index. It must never go backwards (the existing rule).
   - The last vertex keeps today's "hold the lane end" behaviour.
   - Use only `+ - * / Math.sqrt` (all IEEE-exact). No `Math.sin`, `cos` or `atan2`; use `dmath` if an angle is ever needed. This keeps determinism.
2. **Rejoin from the projection.** When the Wick is |d| off the line, use `LOOK = max(3.0, 1.5·|d|)` along the line from its projection. That caps the rejoin angle at about 34° and brings it back within about 1.5·|d| + 3 m of travel, instead of a diagonal to a vertex up to 9 m ahead. This covers cause 3, with no special post-fight branch.
3. **Keep each Wick's column slot.**
   - Store `slot = col·COL_GAP·0.5` (−0.55 / 0 / +0.55 m) in MinionState at spawn (`:123`).
   - Offset the carrot by `slot` along the left normal of the segment it lies on.
   - Columns then no longer pinch at a shared point, so separation (`movement.ts:623`) stops spreading them. This covers cause 2.
   - The slot also keeps the outer Wick of the partial last row 0.55 m out instead of 1.1 m, so it clears the lantern disc (0.92 m from the line). This covers cause 4.
   - Do not change separation factors or `COL_GAP`/`ROW_GAP` themselves.
4. **Re-issue rule.** `issueMove` clears the nav path and resets the watchdog every time (`movement.ts:148-150`), and an attack-move re-sent within 0.05 m is a no-op (`:134-136`). Therefore:
   - Re-issue only when the new carrot is ≥ `REPATH_DIST` (1 m, `movement.ts:68`) from the last issued point.
   - Never re-issue while `e.path.length > 0`, i.e. while the Wick is walking a nav detour round a lantern or a wall. Wait until it is finished.
   - Keep `m.lastWpX/Y` as the last issued carrot, so the `lastWpX = NaN` resets in `unblockChase` (`:218`, `:225`) and `minionSystem` (`:257`) still force a fresh order after a fight or step-out.

**What must not change**
- Determinism: same seed gives byte-identical replays. Check it with two runs and a trace hash.
- Wave schedule and composition (`waveSystem`/`spawnWave`). Wave *timing* shifts only through path length: following the line rather than its chords adds 0.81 m over the whole 164.5 m top road, about 0.25 s, and is symmetric for both teams, so the meeting point does not move.
- Ruling 39 behaviour and its probes, all of which must stay green with unchanged gate values:
  - probe_sim_minion_flow: 0 stuck, 0 idle
  - probe_sim_attack_at
  - probe_sim_hold_tower
  - probe_sim_core_orders
  - probe_input_pick_truth
- The chase, the step-out, the sealed strips, MINION_THINK_TICKS, aggro and chase ranges.
- The full bot soak gates (`--full --lineup shuffle`, seeds 1-20 and 21-40), compared with the ruling-39 runs:
  - veteran beats novice ≥ 34/40
  - bot faults 0
  - laners in lane 65-67 %
  - Wicks last-hit by fighters before 14:00 about 47 %
  - The probe suite all green (69/69, plus the new probe).

## New probe: `_harness/probe_sim_minion_lane_line.ts`

**Setup**
- Maps RIFT, BRIDGE and FRAY, every lane with more than 2 points.
- Seeds 3, 7, 11, 19, 23, 31.
- Two scenarios: (a) idle seats, towers alive, 8 min; (b) adept bots, 14 min.
- Sample every tick.

**Definitions**
- *Free (marching)* Wick: its order is not ATTACK, it is not `chasing`, it is not stepping out (`w.tick >= flankUntil`), and it has no attackable enemy within aggro range.
- *Clear* sample: the Wick is more than 3 m from the rim of any live structure, more than 3 m from any live non-allied body, and more than 16 m of arc from its own spawn end (the spawn formation converging).
- *d*: signed lateral offset from the lane polyline.
- *Rejoin*: a Wick that turns free with |d| > 1 m.

**Bars** (fail if any is broken on any lane, team or 4 m bin):

1. **Wave-centroid dip** (idle, clear, free). The mean d of each wave's free Wicks per 4 m bin, from waves with at least 15 samples in the bin. Bar: |centroid| p95 ≤ 0.25 m, max ≤ 0.35 m.
   - Today 0.46-0.55 m max at s16-36 on every side road, so it **fails**.
   - The dense counterfactual gives ≤ 0.23 m, so it would pass.
2. **Per-Wick offset** (idle, clear, free, the slot offset subtracted). Bar: |d − slot| p95 ≤ 0.6 m, max ≤ 1.2 m.
   - Today p95 is 0.82-1.16 on road_high t0 s16-36, so it **fails**.
3. **Signed bias** (idle, clear, free). The mean of d per bin, which catches a steady one-sided lean. Bar: |mean| ≤ 0.2 m.
   - Today +0.40 to +0.50 between the lantern and the inner tower.
4. **Rejoin** (both scenarios). Arc travelled until |d| ≤ 0.5 m: p95 ≤ 6 m, max ≤ 9 m. Overshoot past the line to the other side: 0 rejoins beyond 0.5 m.
   - Today 6-9 m typical, with traces up to 7.9 m on a single rejoin and 2-3 m starting offsets.
5. **No reversal** (both scenarios, free). 0 Wicks whose net 0.5 s displacement along their travel direction is < −0.3 m (heading reversed by more than 90°), with knockback, pull and fear windows excluded.
   - Idle today: 0.
   - Bots today: 26 raw frame reversals in 3 seeds × 8 min, counted before those exclusions. Check that every one is forced movement before setting the bar.
6. **No lantern detour** (idle). 0 free Wicks with `e.path.length > 0` (a nav detour) in the first 20 m of arc from their spawn with no enemy in aggro.
   - Today 1 Wick per wave in 6-10 of 13 waves on road_high t1 and road_low t0.
7. **Timing and determinism**.
   - First-wave meeting time per lane is within ±0.5 s of the pre-fix value recorded in the probe.
   - Two runs of seed 7 hash identically (x, y every tick for every Wick).
   - probe_sim_minion_flow stays at 0 stuck and 0 idle.

## Repro

```
cd /Users/sitskovich/Developer/forgeflow-games/games/vale
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH
python3 art/blender/common/heavy.py run -- node _harness/_tmp_wobble_cf.ts --seeds 3,7,11 --minutes 8 [--all 1] [--bots 1]
```

The SIM and LIVE lens repros are in `wobble_sim.json` and `wobble_diag.json`.
