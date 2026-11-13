# Last Circle: world foundation and real towns. Merged BUILD PLAN (2026-10-12)

Owner ask (verbatim): "This game needs significant improvements - things like, but not limited to, industry standard concepts for all of these -
physics, collisions, placement. We have bots getting stuck in houses, they need better path finding, we have floating objects like trees or rocks, they
need to be grounded, i also want a graphic polish, real city rather than so much open space. Compare this game to things like PUBG, fortnite, etc. Make
improvements based on that."

Status: PLAN ONLY. No game file was changed; this is the only repo file written.

**Do we need more research? No.** Four research lanes (placement, collision, navigation, city) measured every defect named above
on git HEAD `bbd6aeae`, and a skeptic re-derived each lane's headline numbers. Graphics polish was already researched and
skeptic-checked in `_spec/look_2026-10/PLAN.md`; it is merged here, not re-planned. What is still unknown (phone cost of the nav
bake, the exact draw-call cost of a finished town) is measured by the gates inside the waves, not by another research round.

Evidence (scratch, not in the repo), written `W/` below:
`C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_world/`
(`placement/`, `collision/`, `navigation/`, `city/`, each with a `review/` folder from the skeptic). Look-plan evidence: `.../scratchpad/lc_look/`.

## 0. How this plan was built

- **Primary source:** the four lanes' structured results and the skeptic verdict on each recommendation. Merge rules: what the skeptic
  CUT is dropped (section 5); where it said MODIFY, its corrected version is used; its MISSING items are added where a probe or a code
  citation backs them.
- **Gaps, stated plainly:** some lane and skeptic texts reached this merge cut off part-way: placement R4 (part) to R8, collision R3 (part)
  to R9, navigation N1 (part) onward, city R3 (part) onward. For those I used the lane's recommendation, the skeptic's probe outputs in
  `W/*/review/`, and the raw summaries. Each such item is marked **(no full skeptic verdict reached the merge)**.
- **Re-verified for this merge (tool output at HEAD `bbd6aeae`, 2026-10-12):**
  - `maps.js:2022` `M.compose(P.set(it.x, it.y - bbox.min.y * s, it.z), Q.setFromAxisAngle(...), S.set(s, s, s));` and `:2023` `M.multiply(meshLocal);` (only Y is re-centred).
  - `maps.js:2037` `const topY = it.y + (kind === "car" ? 1.6 : kind === "container" ? 2.8 : kind === "barrel" ? 1.6 : 6);`
  - `maps.js:1976` `const propColliderKinds = { palm: 0.5, tree: 0.6, pine: 0.55, birch: 0.5, rocks: 1.4, car: 1.6, container: 2.2, barrel: 0.55 };`
  - `maps.js:521-522` `const edge = skirt && (...)` / `posA.setY(i, edge ? h - 0.35 : h);`
  - `maps.js:741` `const hw = opts.rotY ? (Math.abs(Math.cos(opts.rotY)) * w + Math.abs(Math.sin(opts.rotY)) * d) / 2 : w / 2;`
  - `maps.js:971` `const h = heightAt0(x, z);` ... `:975` `props[kind].push({ x, y: h, z, s, ry: rng() * Math.PI * 2 });`
  - `maps.js:1127` `const y = heightAt0(x, z), H = 3.4, T = 0.32, doorW = 1.4, winW = 1.2;`
  - `maps.js:1181` `if (A) road(p.x - R * 0.95, p.z, p.x + R * 0.95, p.z, 7); else road(...)` (one street per town, no land check).
  - `maps.js:1848` `const wildN = 130;`  `maps.js:2364` `heightAt: heightAt0, groundAt: heightAt0, surfaceAt,`
  - `maps.js:1987` `try { root = await W.kernel.loadGLTF(url); } catch (e) { ...; continue; }` (a failed GLB drops that kind's colliders).
  - `maps.js:208-221` mkCollider comment: "Past 4 shapes V8 goes megamorphic"; `maps.js:376` `const rng = W.SIM.mulberry32(seed ^ 0xabcdef);`
  - `bots.js:1070` `const CELL = 1.5, GRID_R = 21;` `:1073` `const NAV_L = 3;` `:1041` wallAhead probe height; `:1649` `if (d < 1.8) bb.moveTo = null;`
  - `bots.js:1928-1929` `a.yaw = Math.atan2(...)` / `a.input.mz = -1;` vs `player.js:1552` `a.yaw = inp.yaw; a.pitch = inp.pitch;` (the heal-retreat yaw write is dead).
  - `bots.js:2134-2137` raw fight input (`inp.mz = 1` / `-0.7`, `inp.mx = bb.strafeDir * ...`, random `inp.jump = true`); `bots.js:900` hard breaker covers moving states only.
  - `player.js:1232` `const STEP_UP = 0.55;` `:1283` `if (c.kind === "ramp") continue;` `:1684` `a.pos.y += a.vel.y * dt;` (point landing test).
  - `loot.js:483` `const gy = Math.max(y - 0.4, W.map.heightAt(x, z));` (chest +0.20 m). `_harness/probe_match.js:52` MOVING set excludes ENGAGE/HEAL/CAMP.
  - `royale.js:452` `var OFF_FRAC = [0.06, 0.10, 0.22, 0.34, 0.46, 0.55, 0.60, 0.60];` `net.js:451-452` "cross-version rooms mid-deploy".
  - Staged kit (untracked, Wave 4 ART-B): `assets/props/city/manifest.json` has 81 types; collider modes footprint 29, bbox 36, bands 8, elevation 5, pole 3.
  - `_harness/gate.py:42-54` registers 13 gates (bootcheck ... perfcheck) plus `node_selftests()` for every `runtime/**/*.selftest.cjs`.
- **Screenshots looked at for this merge:** `W/placement/shots/A_rock_floating.png` (orange rock cluster hanging at palm-crown height
  over a grass slope); `W/collision/out/shot_isla_viva_palm_walkthrough.png` (soldier inside a palm trunk, only backpack and boots
  showing); `W/city/shots/CITY_SHEET.jpg` (three near-empty drop views; Savanna street of ~10 box houses; Isla Viva map centre a
  bare green slope; Isla Viva street camera underwater; target-sim layout with grid towns and compounds).

### Where lanes and skeptics measured different numbers, and which is right

| Topic | Lane | Skeptic / other lane | Which is right, and why |
|---|---|---|---|
| Rock draw offset | placement p50 33.5-35.3 m, max 92.4 m (5 seeds x 3 maps); collision p50 32.3-34.8 m, max 44.6-80.3 m (seed 7) | skeptic analytic 21.8-46.2 m scatter, 43.6-92.6 m quarry | **All agree.** The analytic range is the truth (offset = GLB origin offset x norm 0.689 x scale). Collision's lower max is seed 7 only |
| Rocks in the air | placement: wholly in the air 40-51%; collision: float > 0.2 m 41-47% | skeptic: wholly above physics ground 53/47/43% | **Different definitions, same defect.** Use placement's "wholly in the air" for the owner number and the gate's "> 0.2 m" share as the threshold |
| Rocks buried | placement 19-27% fully buried; collision 31-42% buried > 0.5 m | skeptic 23/25/30% | Different thresholds (fully vs lowest vertex). Both say about a quarter or more |
| Near-ring ground drop | placement 3.3-3.5% of samples > 0.10 m, p99 0.28-0.29 m | skeptic analytic 3.7%, p99 0.28 m | **Agree.** |
| Clip into props | collision palm 0.48, birch 0.38, car 0.25-0.41, container 0.44, barrel 0.33-0.41 m | skeptic palm 0.55, birch 0.35, car 0.32, container 0.49, barrel 0.38 m | **Agree within sampling.** 52% of live sprints ended > 10 cm inside a prop (lane, measured live) |
| Indoor wall-grind | nav lane 19.7% of indoor movement ticks (6 matches, 3 maps) | skeptic 15.72% (ashgrid s5, 1 match); visible grind (runs >= 0.5 s) 5.26% | **Both real.** The per-tick % includes sub-0.5 s bumps a player cannot see; the gate uses the skeptic's per-state and visible-run rows |
| Top-floor reachability | nav lane top-floor exits 3/12 -> 12/12 with NAV_L 6 (ashgrid s11) | skeptic s5: exits already 7/7 at HEAD; inbound 19/28 -> 28/28 | **Skeptic.** The 3/12 is seed-specific; the inbound gain reproduces. 10 of 13 failed upstairs walks ended within 0.1 m horizontally of the goal, so floor-blind arrival is the main cause |
| Phantom ramp walls | 22.0% up / 8.8% down (821) | 16.9% / 11.7% (402) | Same order. Reproduced, but its share of the walk failures is unmeasured, so it ships only if needed |
| Enterable buildings | city lane 39/37/35 (Savanna/Isla/Deepwood), median 165 m | skeptic seed-7 detector 33/38/33, median 181.9/93.4/196.3 m | **Different detectors.** The citycheck gate pins ONE detector and re-measures the baseline on the Wave-4 commit |
| Lattice bake time | 174-207 ms | 237-344 ms (box loaded by Wave 4) | **Skeptic** as the planning number (worst case); phone 2-4x |
| Outdoor wall-grind | 0.43% | 0.86% (s5) | Seed and map variance; the gate is "no regression vs the Wave-4 baseline", not a fixed number |

---

## 1. Summary for the owner (plain English)

- **Rocks are drawn in the wrong place.** Every rock is drawn 20 to 90 metres away from where the game thinks it is. About half of all
  rocks hang in the air (one 24 m up), about a quarter are buried out of sight, and each one leaves an invisible wall on empty grass.
  A small code fix puts every rock back on its spot. PUBG and Fortnite use Unreal's placement tools, which set each object onto the
  drawn ground with "sink" and "slope" settings.
- **Trees, bushes, cars and buildings float on slopes.** About 1 in 6 palms and bushes on Isla Viva, half the cars on Savanna and
  Deepwood, and almost every shipping container stand partly in the air. 86-94% of houses and nearly every tower have an edge in the
  air (towers up to 6 m), and every house roof floats 20 cm above its walls. We will sink props slightly into the ground and flatten
  a pad under every building, the way Unreal flattens ground under roads and buildings.
- **The drawn ground and the real ground disagree.** Along straight lines every 200 m, the ground is drawn up to 35 cm lower than
  where players, loot and trees actually stand. In Unreal and Unity the walkable ground is the drawn ground. We will make ours match.
- **You walk into things, and bullets hit air.** Half of all sprints into a palm, barrel, car or container end with your body inside
  it, and near cars and trees up to 2 in 3 chest-high bullets stop on empty air. Turned walls (the shipwreck) have invisible walls up
  to 8 m thick. PUBG and Fortnite give each object a simple collision shape that matches what you see; we will do the same.
- **We keep our own physics.** A full physics engine (the one our paintball game uses) measured 50-100 times slower per character
  here and would fix none of these mismatches. The problem is the data, not the engine.
- **Bots "stuck in houses" is real, just not what the old test measured.** Bots rarely freeze outright, but indoors they push into
  walls about 1 moment in 5, against 1 in 230 outdoors, mostly while fighting or healing, because fight moves ignore walls. A third of
  healing bots back up towards the enemy because of a bug. Bots reach only 6 of 19 upstairs rooms. PUBG's bots walk on a hand-made
  walking map with door and stair links; we will fix the fight moves and upstairs now, and give towns a precomputed walking map.
- **The open space is real.** Each map has only 35-39 buildings you can enter. From a random spot on Savanna or Deepwood the nearest
  one is about 165-176 m away, over 20 seconds of sprinting. We already have as many named places as PUBG; what we lack is buildings
  per place and the small 2-6 house farm clusters PUBG scatters between towns.
- **Town streets run into the sea.** On Isla Viva, Jungle Market's street is partly underwater in 99 matches out of 100. The new
  town builder fits towns to dry land.
- **The last circle always ends near the map centre** (within about 117 m, 1,000 matches checked). On Savanna that is open grass, on
  Isla Viva a bare steep volcano slope, on Deepwood the river. The densest downtown goes there on Savanna; the other two need a fitting
  endgame area (your call, below).
- **What we will build:** real street-grid towns from free building kits we already have, a dense downtown at the map centre, about
  24 small house clusters between towns, then walk-in furnished houses with stairs. Target: the nearest enterable building is under
  90 m away for half the map (165 m today). No spending is needed for any of it.
- **Why the tests missed all this:** they only checked "frozen for 3 seconds while walking" and never checked whether things touch the
  ground or match their collision. New permanent checks measure each defect, and each must fail on today's build before it is trusted.
- **Order:** finish the graphics wave already running, then fix ground, collision and bots, then build the town pieces, then towns on
  Savanna, then the other maps, then furnished interiors.

---

## 2. Decisions only the owner can make

| # | Question | Recommended answer | Why |
|---|---|---|---|
| O1 | Switch to a physics engine (Rapier, as DYEFIELD uses) or fix our own collision? | **Fix ours.** | Measured on the same colliders: Rapier's character controller 104-138 us per actor vs 0.8-2.2 us today, about 5-7 ms per tick for 50 actors instead of ~0.1 ms, plus ~1 MB download. Doors already work (107/108 entries) and no sprint crossed a thin wall (0/288). Every measured defect is collider data not matching the drawn mesh, which an engine does not fix. $0 either way |
| O2 | Towns on all three maps (themed), or a 4th city-only map? | **Savanna pilot first (no decision needed). Then themed towns on all three:** coastal/resort towns on Isla Viva, lodge/cabin villages on Deepwood, from the same kit with palette swaps. A 4th city map later only if you still want one. | Maps rotate randomly, so a city-only 4th map would leave 3 matches in 4 as open as today. This **replaces** the look plan's D5 lean (4th map). Decide after you see Savanna screenshots |
| O3 | Which buildings can you walk into? | **Every building that has loot, and at least 80% of houses and shops.** Closed shells only for skyline towers and back-of-block fill (at most 20% of buildings). At most 3 walkable floors; no skyscraper roofs | PUBG loots almost every house room by room. Closed kit shells cost a third of the triangles of a furnished house, so shells give the skyline and the enterable houses give the fights |
| O4 | The final circle always lands within ~117 m of the map centre. On Isla Viva that is a bare 41-47% volcano slope; on Deepwood the river (phase-6 circles median 10% water; 21 of 150 final circles > 25% water). Build an endgame area there, or make the storm avoid it? | **Build fitting endgame areas and leave the storm unchanged:** a ruined crater-rim village on the volcano and a mill-and-bridge compound across the Deepwood river (Savanna's downtown core covers it there). | Changing where circles land changes match flow, which Wave 4's pacing work just tuned (look-plan D8). Structures fix the cover problem without touching the storm |

Already decided (not asked again): third-person only, so look-plan D1/D2 and P4.1 (first-person) are cut; camera pull-in is approved
and in Wave 4 (look-plan D3); no spend, so look-plan D6 resolves to the free CC0 kits; random map rotation; no building or harvesting;
Mixamo-only animation; `mobile_support` untouched.

---

## 3. Phased build plan (waves of file-disjoint lanes)

**Rules for every wave.**
- Wave 4 (storm, loot beams, sky/clouds/fog, HUD, death clips, canopy, camera wall pull-in, bot pacing) lands FIRST. Wave 5 branches
  from Wave 4's merge commit, and every HEAD baseline in this plan is **re-measured on that commit** before any threshold is applied
  (Wave 4 changes bot pacing and the very `actEngage` lines that N0a edits).
- No two lanes in one wave edit the same file. Cross-lane rules are written as contracts (C-*) both lanes implement.
- Every wave ends with an **independent verify** (a fresh agent that did not build the wave runs `python _harness/gate.py --disk`
  including the new gates and `--negative-controls`, plus the wave's own gate list) and then a **deploy without `--status`**:
  `python pipeline/deploy_game.py --game-dir games/last-circle --slug last-circle --dry-run`, then the same without `--dry-run`, then the
  live check: one no-store fetch of `index.html` for the new `?v=`, `bootcheck.py --base <CDN index URL>`, `portalcheck.py --live`.
  Environment failures (map-load timeouts, crashed Chrome) are could-not-judge (exit 2), never a pass.
- Budget: design targets p99 <= 22 ms and <= 450 draw calls. This UHD iGPU is already far over 22 ms at HEAD (look plan: medium DPR 1.0
  p50 84.6-154 ms), so every lane must be about **net-zero on the medium tier** or switch on only at high. Draw calls and triangles
  are exact; GPU ms on this shared box are information. Isla Viva's drop view is already 515 calls at HEAD (city lane), so Wave 4's
  -43 cloud calls and loot-beam instancing savings must be confirmed before Isla Viva towns ship.
- Determinism: squad clients rebuild the world from `W.seed`. Any new generator uses its own sub-RNG; any change that reshuffles the
  shared map RNG (`maps.js:376`) bumps a generator version (Wave 7, lane 7C).

### Look-plan items: where each one lands

| Look-plan item | Lands in |
|---|---|
| P1.1 clip dedupe, P1.2 storm, P1.3 loot beams/rings, P1.5 gun hidden while gliding, P1.6 Mixamo deaths, P1.7 baked clouds, P1.8 rim, P1.9 HUD restyle, P1.10 altitude fog, P2.6 canopy, P3.1 camera pull-in, low-tier composer off, bot pacing | **Wave 4** (per its brief and its `_harness/new/` gate files: `player_dlcount.py`, `stormfx_storm.py`, `loot_beams_rings.py`, `player_dive.py`, `player_deaths.py`, `sky_fogcurve.py`, `player_rim.py`, `hud_checks.py`, `player_canopy.py`, `player_camwall.py`, `orch_lowpost.py`, `sim_pacing.py`). Wave 5 kickoff confirms each against Wave 4's merge commit |
| P1.4 non-cube hit sparks and tracer | Wave 4 if `stormfx_fx.py` covers it; otherwise lane 6G below |
| P2.0 meshopt intake + decoder | Wave 6, lane 6C |
| P2.1 street-grid towngen + plateau | plateau/pads: Wave 6 lane 6A; generator: Wave 6 lane 6B; wiring: Wave 7 lane 7A |
| P2.2 Kenney kit shells | module: Wave 6 lane 6C; placement: Wave 7 lane 7A |
| P2.3 keep enterable loot lots | Wave 7 lanes 7A + 7C |
| P2.4 street props, cars, town names | Wave 7 lane 7A |
| P2.5 textured ground | Wave 6 lane 6A (Poly Haven CC0, staged `assets/tex/`) |
| P3.2 furnished enterable houses | Wave 8 |
| P4.1 first-person | **Cut** (owner: third-person only) |
| P4.2 colour grade (D4), P4.3 death banner/standings (D7) | Unchanged owner calls in the look plan; not part of this plan |

---

### WAVE 5: World foundation (grounding, collider data, bot movement, the gates that see it)

Goal: everything the player can see touches the ground, collides where it is drawn, and bots stop grinding walls indoors, on all three
maps, before any town is built on top.

**Contracts for this wave**
- **C-RAMP** (5B + 5C): a ramp is a 0.3 m sloped slab. It is walkable from its low edge; its sides and underside block movement; bullets
  and sight test only the slab band, not the wedge beneath it. 5C implements it in movement and segment tests; 5B makes `obstacleAt`
  and nav rasterisation agree.
- **C-COLL** (5A, read by all): Wave 5 adds **no new collider shape**. Everything stays an axis-aligned box from `mkCollider`, so the
  ~25 reader sites and the single hidden class (`maps.js:208-221`) are untouched. Shapes are made exact with sizing, quarter-turns and
  chains of small boxes instead.

**Lane 5A: Ground and prop data** (placement R1/R2/R3 + structural fixes; collision R1/R3 + collider table) 
- Files: `runtime/3d/royale/maps.js`, `runtime/3d/royale/loot.js` (chest and floor-item base lines only), new
  `_tools/bake_prop_colliders.mjs`, new `assets/props/prop_colliders.json`.
- Player sees: rocks on the ground where you bump into them; no invisible 6 m pillars on grass; no trees, bushes, cars, barrels or
  containers floating on slopes; no 35 cm groove along chunk borders; house roofs sitting on their walls, ranger-tower roofs on posts,
  benches with legs, container stacks touching; chests and floor loot resting on the ground; no 8 m invisible wall beside the shipwreck.
- Technique:
  1. **Rocks only, re-centre the mesh** (skeptic-corrected R1): at instancing subtract the footprint centre (27.35 x s, 0.42 x s), rotated
     by ry, so drawn rocks sit on the seeded spot their collider and the nearPoi check already use. **Trees never move their mesh**: their
     collider moves to a baked trunk-anchor offset (palm/birch bbox centres are canopy-weighted, so a bbox re-centre would push trunks
     0.98-1.01 m x s farther from their colliders).
  2. **Baked per-asset collider table** (`prop_colliders.json`, generated offline from the GLBs by `bake_prop_colliders.mjs`): footprint,
     anchor offset, half-sizes and drawn top per kind; colliders are built from the table **whether or not the GLB loads** (fixes
     `maps.js:1987`, which today lets squad clients disagree about cover). Trunks and barrels: square of the trunk/barrel diameter (the
     corner overhang is 0.41 r, ~0.1 m). Rocks: one box per sub-mesh (4), so quarry clusters do not get walls between rocks; top = drawn top
     (0.735 x s, not 6 m). Containers: exact quarter-turn boxes (their ry is already a quarter turn, `maps.js:1563`), top = drawn top
     (1.277 x s, not 2.8 m). **Fix car scale first** (cars are toy-scale, 3.5 x 1.5 x 1.0 m, because the 1.6 m norm uses the longest side);
     ry=0 cars get an exact box, random-ry cars a chain of 2-3 boxes along the body.
  3. **Rotated walls and planks as chains of small boxes** (skeptic's cheaper option instead of an OBB narrowphase): `addBox` with rotY
     splits into <= 1 m segments, each its own AABB, same height. The excess drops from up to 8.4 m to <= ~0.5 m staircase. Same for the
     rotated pier deck (the invisible walkable floor beside it) and log piles. The water-tower tank (cylinder over a square collider,
     `maps.js:1796/1818`) becomes a plus-shaped pair of boxes.
  4. **Near-ring skirt** (placement R2 = collision R6): keep perimeter vertices at their true height and add a 0.5-1.0 m vertical skirt
     inside the same chunk BufferGeometry (Leadwerks: cracks are "usually [covered] by adding a small, angled skirt around every patch").
  5. **Footprint grounding** (placement R3, skeptic-corrected): per kind, precompute base-contact points from the trunk/base band (not the
     bbox). y = min(ground at those points) - embed (trees 0.10-0.15 m, bushes 0.10 m). Slope limits per kind with **draw-then-reject**
     (s and ry drawn before any rejection, so the RNG stream is unchanged). Cars/containers: tilt capped at 8 deg, colliders stay axis-aligned.
     Cars on roads wait for the road-corridor pads in Wave 6 (most car float is the road surface, `maps.js:1032-1043, 1070`).
  6. **Structural fixes with no slope involved:** house roof deck down 0.20 m onto the walls (`maps.js:1142`); ranger roof onto its posts
     (`:941`, 0.97 m gap); bench legs (`:1172`); awning onto posts (`:1164`); stacked containers on the real lower height (`:1568`, median
     0.39 m gap); fences as segments following the ground (`:1278, 1393`); pier piles (`:947-948`); chest base at the ground (`loot.js:483`,
     +0.20 m today) and floor-item rings at ground + ring offset (`loot.js:422`).
  7. **Ramp authoring** (C-RAMP, maps.js side): slope <= 45 deg, low edge snapped to the terrain (lip <= 0.1 m), top end overlapping the deck;
     the 11.3 m ranger tower gets a switchback (`maps.js:927-944`).
- Effort L (S + S + M + S items in one file). Perf: 0 draw calls; skirt +~5.5k triangles in the 3x3 near ring; build time +30-60 ms per map
  on desktop, 2-4x on phones; 0 per frame.
- Determinism: no extra random draws (draw-then-reject); colliders from a baked table, not from GLB load success. Rocks move to their
  intended spots, so cover and some bot routes change deterministically on every client. Rocks 1-2.5 m tall become mantle-able and stop
  blocking sight above them (a gameplay change, not an owner call; re-check `botcheck.py`).
- Licence: code only, $0.

**Lane 5B: Bot movement fixes** (navigation N0a + N0b, skeptic-corrected) 
- Files: `runtime/3d/royale/bots.js` only.
- Player sees: bots fighting or healing indoors strafe along the room, back out through the door, or hold behind cover instead of
  running in place against a wall or hopping; healing bots back away from you, not towards you; bots climb to upstairs loot and come back.
- Technique:
  1. **Heal retreat bug first:** `bots.js:1928` writes `a.yaw`, which `player.js:1552` overwrites every tick, so the retreat follows the old
     input yaw (34% of heal ticks with a threat moved TOWARD it, ashgrid s5). Steer `input.yaw` towards the face-threat yaw instead.
  2. **Wall-aware fight/heal/reload steering** (a grid version of Detour's `moveAlongSurface`, https://recastnav.com/classdtNavMeshQuery.html):
     before any state writes raw `inp.mx/mz`, probe 0.9 m ahead at the floor height there; if blocked, try the mirrored strafe, then the wall
     tangent, else zero that axis; flip `strafeDir` on contact; heal retreat picks a free direction away from the threat or the cached exit;
     no random fight hop under a roof. Apply in actEngage (2127-2137), actHeal (1923-1933), fireOnTheMove (1604-1615). Add a progress breaker
     for ENGAGE/HEAL/CAMP (exempt from the hard breaker at `bots.js:900`), as Unreal's path follower does block detection
     (https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/AIModule/UPathFollowingComponent).
  3. **Multi-storey:** NAV_L 3 -> 6 (`bots.js:1073`; +~111 KB). Floor-aware arrival: actLoot (1649), actMove (1623) and the progress test
     (1468-1471) arrive only when |dy| < 1.5; the waypoint-consume rule (1489-1490) applies above and below; actMove passes ty
     (`bots.js:1622` passes none today); CLOSEIN/HUNT targets carry y (`bots.js:657`). The marched `wallAhead` probe (N0b b) ships **only if**
     upstairs walks stay under target after these, and keeps the arm's-length stuckT probe.
  4. C-RAMP: `obstacleAt` and nav rasterisation treat ramp sides and undersides as blocked.
- Effort S-M. Perf: ~10-20 extra `queryColliders` per frame with ~24 bots fighting (verdict cached 0.1 s); budget <= 150/frame. Mean path
  query 16.89 -> 13.18 ms (ashgrid s5) with NAV_L 6.
- Determinism: pure function of sim state and the bot's seeded rng; same-seed replay row in `probe_match` must stay identical.

**Lane 5C: Mover and shot fixes** (collision R4 ramps + landing sweep from R5 + crosshair march) **(no full skeptic verdict reached the merge past R3)**
- Files: `runtime/3d/royale/player.js`, `runtime/sim/royale.js`, `runtime/sim/royale.selftest.cjs`, `runtime/3d/royale/weapons.js`.
- Player sees: nobody hides bullet-proof under a ramp; you cannot walk through a ramp's side; no falling through a roof after a 27-52 m
  drop from a sky island or the crane; the crosshair distance reads hits on what you aim at.
- Technique: C-RAMP in `segmentRamp` (`royale.js:251-264`, test the slab band) and `blockedIn` (`player.js:1283` stops skipping ramps; block
  sides/underside). **Landing sweep:** test the feet segment y0 -> y1 against slab tops each tick instead of a point (`player.js:1684`); drops
  of >= 26.7 m pass a slab today. Crosshair point (`weapons.js:510-516`, 0.75 m march, boxes only): march against ramps too and use the
  segment test, not a point test. Pure functions in `sim/royale.js` with Node selftest cases.
- Effort M. Perf: ~0 (one extra segment test per falling actor per tick).
- Determinism: plain doubles, fixed order, fixed 1/60 tick.

**Lane 5D: The gates that see these defects** (placement R8, collision gate, navigation G1 skeptic-corrected)
- Files (all new unless noted): `_harness/placementcheck.py` + `_harness/placement_census.mjs` + `_harness/three_hooks.mjs` (Node resolve hook
  for `three` and `three/addons/`, proven in `W/placement/gate_proto/` to import the unmodified `maps.js`), `_harness/collisioncheck.py` +
  `_harness/probe_collision.js` (promoted `W/collision/probe/colprobe.py`, `analyse.js`, `live.js`), `_harness/navcheck.py` +
  `_harness/probe_rooms.js` + `_harness/probe_ticks.js` (promoted `W/navigation/probe_rooms.js`, `probe_stuck.js`, `probe_verify.js`),
  `_harness/gate.py` (register the three gates and their negative controls), `_harness/README.md`.
- Player sees: nothing directly; these regressions stop shipping green.
- What they assert: section 4 below. Each must **FAIL on the Wave-4 commit** and PASS on the merged Wave 5.
- Effort M. Cost: placementcheck is Node-only (no browser, minutes); collisioncheck and navcheck load one Chrome per map (map load 58-197 s
  on this box).

**Wave 5 verify:** placementcheck, collisioncheck, navcheck (section 4 thresholds); `probe_match.py` all rows with identical same-seed
fingerprints; `royale.selftest.cjs`; `framecheck.py` (0 new programs, queryColliders <= 150/frame); `feelcheck.py`; `playtest.py`;
`botcheck.py` as information (cover changes); `bootcheck.py`. Then deploy without `--status` and the live check.

---

### WAVE 6: City building blocks and one ground truth (new modules, each testable alone)

Goal: build every piece the towns need as separate files with their own tests, and fix the ground under every existing building, so
Wave 7 is wiring, not invention.

**Contracts:** **C-PAD** (6A provides, 6B and 7A use): `registerPad(rect|poly, height, falloffM)` and `registerCorridor(polyline, width)`
before terrain build; pads combine into the baked height lattice. **C-LAYOUT** (6B provides): `towngen.layout(seed, poi, heightFn, waterY, theme)`
returns pure data: blocks, roads graph, parcels (each quarter-turned), compounds, door/stair/room records. **C-KIT** (6C provides):
`citykit.place(list) -> {meshes, colliders}` with colliders from the manifest. **C-NAV** (6D provides): `navgrid.bakeTile(colliders, heightFn, rect, cell)`
and `navgrid.findPath(...)`.

**Lane 6A: Terrain ground truth, pads under every building, textured ground** (placement R4 + R5; look P2.5) **(placement R4 onward: no full skeptic verdict reached the merge)**
- Files: `runtime/3d/royale/maps.js`, `assets/tex/**` (staged CC0 ground textures, downscaled to 1024 px).
- Player sees: houses, huts, towers, the mall, barns and landmarks sitting on flat ground with no gap under any wall; no doorway half
  buried; ramps start at ground level; roads lie on the ground (no grass poking through, no floating asphalt); textured sand, grass and rock.
- Technique: split `buildMap` into layout -> pads -> terrain (terrain is built first today, `maps.js:487-544`, before any POI exists). Pads =
  footprint at the median footprint height + 3-6 m smoothstep falloff; road corridors flattened across their width (Unreal landscape splines
  Raise/Lower Terrain, per the placement lane; its URL was cut off before the merge, so the citable source here is Wildlands' terraformed road
  heightmaps stamped onto the terrain, https://80.lv/articles/procedural-world-building-in-ghost-recon-wildlands/). Reject or shift any lot with > 1.0 m relief; fallback
  plinth band of 0.3 m. Bake `heightAt0` plus pads into a 609 x 609 Float32 lattice at 2.63 m pitch; `map.heightAt` = triangle-exact interpolation
  with three's PlaneGeometry diagonal; near chunks, far chunks (every second node), `meshY` and `road()` read the same function (Unreal Landscape
  collision mip 0, https://dev.epicgames.com/documentation/unreal-engine/landscape-collision-guide-in-unreal-engine; Unity TerrainCollider "matches
  the geometry of the Terrain", https://docs.unity3d.com/Manual/class-TerrainCollider.html). Interim street fix: trim or shift today's town
  streets off water (Jungle Market 99.5% of seeds wet). P2.5: Poly Haven `aerial_grass_rock`, `aerial_beach_01..03`, `aerial_sand` at 1024 px
  (any albedo change also touches the minimap `maps.js:2304` and grass clutter `:2161`).
- Effort L. Perf: build +237-344 ms per map and +1.48 MB RAM (skeptic, worst case under load); runtime `heightAt` 1.4-15x cheaper (helps bot nav
  and `losBlocked`); textures ~3-5 MB download (estimate), 0 draw calls.
- Determinism: pads derive only from the seeded layout; the Float32 bake uses the same IEEE operations on every client. Ground near POIs changes
  on every seed vs today (same on all clients of one version). Physics ground moves by at most p99 0.012-0.038 m outside pads.

**Lane 6B: Town layout generator** (city R1 + R2, skeptic-corrected; look P2.1 generator part)
- Files: new `runtime/3d/royale/towngen.js`, new `runtime/3d/royale/towngen.selftest.cjs` (THREE-free, runs under `gate.py`'s node_selftests).
- Player sees: nothing until Wave 7.
- Technique: port only BLOCKTOOTH's grid and parcel bisection (`games/blocktooth/src/city/citygen.ts`, `splitBlock` 182-219; ~150-250 of its 753
  lines). Block pitch 56 m (keeps blocks inside the bot planner's 64 m window), roads 10 m, sidewalks 3 m, lots quarter-turned so colliders stay exact
  boxes. Drop or shift blocks below waterY + 0.8; T-junction or jog on any street longer than ~150 m (the Outpost's straight 250 m street has 36%
  of rays open to 200 m inside the town vs 23% outside). Road graph connects to the nearest grid edge node, never diagonally through blocks.
  Compounds: deterministic farthest-point fill on a fixed grid over dry land, >= 60 m from towns, within ~720 m of centre, stored as a separate list
  (not POIs: no labels, no roads, no landing heat on the signed-off HUD). Emits door, stair and room records for every enterable parcel (N2 data).
  Sub-RNG `mulberry32(W.seed ^ hash(poi.id))`.
- Effort M. Perf: build-time only. Determinism: pure function of seed + height function, stable ordering. Licence: in-house.

**Lane 6C: City kit module and asset intake** (city R3 skeptic-corrected; look P2.0 + P2.2 module)
- Files: new `runtime/3d/royale/citykit.js`, `runtime/3d/ffg_kernel_3d.js` (loader: meshopt decoder; swap the 719,410 B forced Draco JS decoder
  `ffg_kernel_3d.js:26` for wasm Draco or meshopt), new vendored `runtime/3d/libs/meshopt_decoder.module.js` (three r172, MIT, 24,850 B),
  new `_tools/city_intake.mjs` (gltfpack/meshopt), `assets/props/city/**`, `assets/props/cars/**`, `CREDITS.md`.
- Player sees: nothing until Wave 7 (then: glass and stone towers, gabled houses, a far skyline).
- Technique: one InstancedMesh per building type **per district** with a computed bounding sphere (map-wide instancing never culls,
  `maps.js:2003-2014`). Colliders from `manifest.json` per type, built whether or not the GLB loads (manifest readme). One shared texture per
  palette key (suburban and commercial colormaps differ). Far LOD: the `low-detail-building-*` meshes are **different buildings** (skeptic), so
  far districts collapse to one merged proxy per district beyond ~250 m instead of a per-type swap. Palette tables for O2 themes.
- Effort M. Perf (look-plan skeptic, measured): 300 buildings chunked per POI = +20 calls, +378k triangles (268 -> 288; 2.06 M -> 2.44 M) on the
  Savanna ground view with shadows. Download ~2.1 MB once (props/city 0.89 MB + cars 0.18 MB + textures 1.03 MB). Licence: CC0 (manifest licence
  field: Kenney City Kit Suburban/Commercial/Roads, Car Kit, Furniture Kit). $0.

**Lane 6D: Baked layered nav grid for towns** (navigation N1, skeptic MODIFY: justified by the coming city, not by a current defect) **(no full skeptic verdict reached the merge)**
- Files: new `runtime/sim/navgrid.js`, new `runtime/sim/navgrid.selftest.cjs`.
- Player sees: nothing until Wave 7 (then: bots taking sensible routes through dense blocks and multi-storey houses on the first try).
- Technique: port Blackridge's `core/ai/nav.js` bake pattern: a list of floors per cell (no layer cap), the player.js capsule exactly (r 0.45,
  step 0.55, headroom 1.8), nodes anchored at the passing sample, flood-fill pruning of islands. Typed edges walk/drop/ramp (DYEFIELD style), CSR typed
  arrays, A* plus funnel. Lazy synchronous bake per 32 m tile over town/POI rects (0.5 m cells in buildings). Industry pattern: Recast/Detour
  ("powers AI navigation features in Unity, Unreal, Godot, O3DE", https://github.com/recastnavigation/recastnavigation) with door/jump links
  (Unreal NavLinkProxy, https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/AIModule/ANavLinkProxy). Recast-WASM stays an
  owner-approved fallback only.
- Effort M. Perf (estimate, not measured): <= 8 ms per tile on this box, 1-2 MB per town; queries well under 1 ms vs 3.7-16.9 ms today. Must be
  measured on the iGPU box and a phone.
- Determinism: pure function of seeded colliders and the height function; lazy tiles built synchronously on first query, so replays match.

**Lane 6E: City and perf gates**
- Files: new `_harness/citycheck.py` + `_harness/probe_city.js` (promoted `W/city/city_probe*.py`, `analyze.py`, with ONE pinned enterable-building
  detector), new `_harness/perf_district.py` (fixed-camera calls/triangles vs a `--rev` baseline), `_harness/placementcheck.py` (add pad, doorway and
  ramp-start rows; owned by this lane in Wave 6), `_harness/gate.py`, `_harness/README.md`.

**Lane 6F (optional, ship only behind its gates): swept collide-and-slide mover** (collision R5) **(no full skeptic verdict reached the merge)**
- Files: `runtime/3d/royale/player.js`, `runtime/sim/royale.js`, `runtime/sim/royale.selftest.cjs`.
- Player sees: smooth sliding along walls and corners with no snags; no sprinting up 60 deg slopes at full speed.
- Technique: iterative swept circle with skin 0.01-0.02 m, up to 4 bumps, step-up = up/forward/down sweep (Quake III `PM_SlideMove` /
  `PM_StepSlideMove`, https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_slidemove.c), walkable slope ~45 deg (Unreal,
  https://dev.epicgames.com/documentation/en-us/unreal-engine/walkable-slope-in-unreal-engine). Pure function in `sim/royale.js`.
- Effort L. Perf: estimate <= 0.5 ms per tick for 50 actors (today 0.04-0.11 ms). Risk medium: every actor's feel changes. **If `feelcheck.py`
  or the door/thin-wall rows regress, park it**; Wave 5 already fixed the measured defects (fall-through, ramps).
- Determinism: plain doubles, fixed iteration order, fixed tick.

**Lane 6G (only if Wave 4 did not ship it): look P1.4 hit sparks and tracer** - files `runtime/3d/royale/fx.js`, `runtime/3d/ffg_warmup.js`; Kenney
Light Masks CC0; gate `feelcheck.py` + glare probe + 0 new programs on the drop frame.

**Wave 6 verify:** `towngen.selftest.cjs` (every block on dry land; parcels quarter-turned; same seed -> identical layout; 200 seeds); `navgrid.selftest.cjs`
(synthetic town: every room <-> street reachable; tile bake <= 8 ms here); placementcheck with pad rows (section 4); collisioncheck and navcheck still
green; `probe_match.py` (identical fingerprints); `framecheck.py`; `dlprobe`-style download count; `bootcheck.py`. Deploy without `--status` and live check.
(6B-6D modules are not wired into the live game yet, so the player-visible change of this deploy is 6A, plus 6F/6G if they passed.)

---

### WAVE 7: Savanna city pilot (then 7b: the other two maps after O2)

**Lane 7A: Town integration** (city R1-R3 corrected; look P2.1 wiring, P2.2 placement, P2.3, P2.4; O4 Savanna endgame)
- Files: `runtime/3d/royale/maps.js`.
- Player sees: from the plane, real towns: dark asphalt blocks with lane lines and sidewalks, houses on lots facing the street, a downtown of
  mid-rises and towers at the map centre where the final circles end; farm and house clusters between towns; parked cars, street lights,
  hydrants, benches (static cover, no driving); town names and roads on the minimap.
- Technique: replace `town()` (`maps.js:1178-1240`) and the six lone downtown towers (`:1510, 1521`) with towngen layouts: a 3 x 3 block core on
  Downtown Core (0,0); 2 x 2 / 3 x 2 towns on Outpost, Metro and Mall; 2 industrial yards; ~24 compounds of 2-4 enterable houses + 1 shed + fence
  + cars. Pads via C-PAD. Kit shells via C-KIT only for skyline and back-of-block (<= 20%, O3). **Enterable loot-bearing buildings on every block**
  (today's `house()`/`tower()` on parcels until Wave 8), so the census stays >= 3 guns per player. Street props from the Kenney Car Kit, cc0-city
  props and Quaternius CC0, replacing the primitive `addBox` lamp posts and benches (`maps.js:1149-1175`). Grass tufts masked off roads, sidewalks
  and footprints (`:2141-2151`); roads and block outlines on the minimap (`:2294-2310`). Compound buildings merged per chunk per material with a
  distance cull, shadow pass costed explicitly. `W.map.genVersion` exported.
- Industry basis: PUBG compounds "with 2 to 6 buildings" (https://www.invenglobal.com/pubg/articles/2985/the-farming-route-of-l-shaped-1-level-flat-house-check-out-each-room-thoroughly);
  Erangel "dotted with small outcroppings of buildings" (https://pubg.wiki.gg/wiki/Erangel); Tilted Towers 35-43 chests at the map centre
  (https://gamesradar.com/fortnite-chest-locations/).
- Effort L. Perf: target vs `--rev <Wave-6 commit>` at fixed cameras: <= +40 draw calls and <= +25% triangles; drop view <= 450 calls; compounds
  ~+8-12 calls at street level (estimate). `perfcheck.py` on the iGPU as information.
- Determinism: towngen sub-RNG. Removing `town()`'s draws from the shared map RNG reshuffles everything placed after it on every seed: still
  deterministic, but old and new clients disagree, hence 7C's version guard.

**Lane 7B: Bots in towns** (navigation N1 wiring + N2 partial)
- Files: `runtime/3d/royale/bots.js`.
- Technique: use `navgrid` tiles inside town and compound rects (the 64 m window search stays outdoors); door waypoints first; `pickLoot` scores by
  path cost, not straight-line distance; `assignDrops` (`bots.js:223-345`) counts compound loot points (the drop cap scales with loot points,
  `bots.js:231`).
- Effort M. Perf: per-query cost must fall (gate below). Determinism: sim state only.

**Lane 7C: Loot and version guard** (city R2 loot move; city R9 version guard) **(no full skeptic verdict reached the merge for R9)**
- Files: `runtime/3d/royale/loot.js`, `runtime/3d/royale/net.js`.
- Technique: move ~60 of the 130 wild loot spots (`maps.js:1848` count read via the map) into compound buildings; refuse or warn when a squad
  guest's `genVersion` differs from the host's (today `net.js:451-452` tolerates cross-version rooms mid-deploy, which would now mean different maps).
- Effort S.

**Lane 7D: Gate thresholds** - files `_harness/citycheck.py`, `_harness/navcheck.py`, `_harness/gate.py`, `_harness/README.md`: make citycheck permanent
in `gate.py` with the Savanna thresholds; raise navcheck to cover town tiles.

**Wave 7 verify:** citycheck on Savanna seeds 7 + 2 more (section 4); `towngen.selftest.cjs` 200 seeds; placementcheck (pads, roads, kit buildings
grounded); collisioncheck (kit colliders: clip p95 <= 0.10 m); navcheck (all town rooms, compounds); `probe_match.py` (stuck rows, path search usable
>= 15/30 at 120 m and 180 m, identical fingerprints, >= 3 guns per player); `perf_district.py`; `framecheck.py --map ashgrid` (drop cluster <= 250 calls,
0 new programs); `leaktest.py` (instances freed in `disposeMapResources`, textures flat over 3 matches); `layoutcheck.py`; a drop-shot side-by-side with
BridgeZone ref t08/t22 for the owner. Deploy without `--status`, live check.

**Wave 7b (after O2): Isla Viva and Deepwood towns.** Lanes: maps.js (themes, O4 endgame areas: crater-rim village, mill-and-bridge compound; never a
grid core on the volcano or across the river), towngen.js (theme tables), citykit.js + palettes. Same gates per map; Isla Viva additionally needs the
drop view under 450 calls (515 at HEAD).

---

### WAVE 8: Enterable furnished interiors (look P3.2 + navigation N2)

**Lane 8A: House grammar** - new `runtime/3d/royale/housegen.js` + `housegen.selftest.cjs`. Modular houses on a 2.5 m grid (rectangle or L, 1-3
walkable storeys) from `cc0-city/walls` and `furniture`. Doors use `wallDoorwayWide` (2.26 m; the 1.4 m doors leave bots "an 0.8 m free band",
`bots.js:1295-1297`). Window pieces authored or rescaled to the existing cover rule (sill 1.20 m, header 2.30 m, `maps.js:1113-1125`); never let
kit visuals and colliders disagree. Stairs = ramp collider + Quaternius CC0 stair visual. Emits rooms, doors and stairs as nav links (Detour
off-mesh connections / door area flags, https://github.com/recastnavigation/recastnavigation/blob/main/RecastDemo/Include/Sample.h).
**Lane 8B: Interior integration** - `maps.js`: swap parcel houses to housegen output; floors instead of terrain grass (grass masked indoors);
`surfaceAt` floors for footsteps; indoor ambient term (the hemisphere light and IBL are not occluded indoors); batch per material per district
(12-16 calls), furniture hidden beyond ~60 m.
**Lane 8C: Bots indoors** - `bots.js`: route over the room graph, steer straight inside convex rooms, "which room and floor am I on" for cover and clearing.
**Lane 8D: Per-room loot** - `loot.js`: loot points per room; Wave 4's beam ceiling clamp re-verified indoors.
**Lane 8E: Interior gates** - new `_harness/interiorcheck.py`; `navcheck.py` thresholds raised; `gate.py`; promote Wave 4's `player_camwall.py` if not already in `gate.py`.
- Effort L. Perf: ~4k triangles per furnished storey, 150-300k in a town view after culling (estimate); ~0.25 MB meshopt download. Licence: CC0
  (Kenney Furniture Kit, Quaternius). Determinism: housegen sub-RNG per parcel.
- **Wave 8 verify:** interiorcheck (floor not terrain, >= 3 furniture pieces in view, ceiling visible, every map); navcheck all rooms incl. upper floors
  >= 98%; Wave 4 camera-wall probe inside every sampled house; `framecheck.py` queryColliders <= 150/frame; `probe_match.py`; `perf_district.py`.
  Deploy without `--status`, live check.

---

## 4. Gates that would have caught today's defects (permanent in gate.py)

Every gate: exit 0 PASS, 1 FAIL, 2 could-not-judge (environment). Each has a **negative control** registered in `gate.py --negative-controls` that
must FAIL. Baselines below are HEAD `bbd6aeae`; thresholds apply after re-measuring on the Wave-4 commit.

**placementcheck.py** (Node only, no browser; 3 maps x seeds 1, 7, 1234, 31337, 2026; imports unmodified `maps.js` through the three resolve hook)
- Anchor-to-visual-base offset <= 0.5 m for every instanced prop (HEAD rocks p50 33.5-35.3 m, max 92.4 m).
- Rocks floating > 0.2 m: < 5% (HEAD 40-54% depending on definition); fully buried: < 2% (HEAD 19-27%).
- Non-rock props: every base vertex within [-embedMax, +0.10 m] of the rendered near surface; per kind float > 0.10 m <= 2% (HEAD palm 16%, bush 12-18%,
  car 17-63%, container 89%).
- |physics ground - rendered near surface| p99 <= 0.05 m on 20k dry-land samples (HEAD 0.28-0.29 m; 3.3-3.5% > 0.10 m); after Wave 6: <= 1e-4 m.
- Collider top within 0.3 m of the drawn top (HEAD rock 6 m vs ~0.9 m drawn; container 2.8 m vs 2.04-2.81 m).
- No structure piece without contact (HEAD: every house roof 0.20 m, ranger roofs 0.97 m, container stacks median 0.39 m, steeple piece 9.05 m).
- Chests: base gap p50 <= 0.05 m (HEAD 0.20 m).
- Wave 6 rows: grounded structure base edges <= 0.10 m above the near surface (HEAD 86-94% of houses, 98-100% of towers over 0.10 m); doorway clearance
  >= 2.0 m (HEAD min 1.16 m, 8 below the 1.85 m capsule); ramp start step <= 0.55 m (HEAD 42 over); roads float > 0.10 m <= 1% near (HEAD 7.3-19.6%).
- Negative controls: restore the Y-only re-centre (must FAIL); restore the 0.35 m perimeter drop (must FAIL); plant +0.3 m on one tree (must FAIL).

**collisioncheck.py** (one Chrome per map, `--rev`/`--disk`, seed 7; drives the real `stepActor` and the game's segment tests)
- Per kind: clip p95 <= 0.10 m and clip > 25 cm in < 5% of instances (HEAD 80-92% for palm, birch, car, container, barrel); gapMax p95 <= 0.15 m.
- Live sprints ending > 10 cm inside a prop: <= 2% (HEAD 363/704 = 52%).
- Phantom rock walks: 0 of 36 stop > 0.3 m from a drawn rock (HEAD 36/36 on open ground).
- Body-height bullet agreement with the drawn mesh >= 85% (HEAD 0% for rocks; 34-83% for other kinds).
- Rotated walls: gap <= 0.5 m (HEAD up to 8.4 m; 1,158 m2 of phantom collider at seed 7).
- Ramps: hide area under ramps 0 m2; every ramp climbable from the ground and descendable; foot lip <= 0.1 m.
- Fall probe: drops of 5-60 m onto 0.3 m slabs, 0 pass-through. Doors >= 99% entries (HEAD 107/108); thin-wall sprints 0 crossings (HEAD 0/288).
- Negative control: serving the Wave-4 commit must FAIL.

**navcheck.py** (one Chrome per map; isla_viva, ashgrid, deepwood; >= 40 upper rooms across 3 maps)
- Door-reachability walk (real controller, street -> room -> street, 30 s each way): ground floors >= 98% (HEAD 53/53 in, 52/53 out); upper floors in and out
  >= 85% after Wave 5 (HEAD 6/19 in, 9/19 out), >= 98% after Wave 8.
- All-state tick metric, per state@location: ENGAGE + HEAL indoor blocked <= 3%; visible grind (blocked runs >= 0.5 s) <= 1.5% of indoor movement ticks
  (HEAD 5.26%); outdoor no regression vs the Wave-4 baseline. Location is labelled "roof edge", not "door" (the probe flag means within 1.6 m of a roof edge).
- Heal direction: heal ticks moving toward a known threat <= 5% (HEAD 34%).
- Phantom ramp walls <= 2% (only if the marched probe ships). `probe_match` long-path and replay rows unchanged.
- Negative controls: NAV_L 3 must fail the top floors; raw strafe must fail ENGAGE indoor; the dead `a.yaw` heal write must fail the heal row.
- Why the old gate missed it: `probe_match.js:52` counts only LOOT/ROTATE/PUSH/WANDER/HUNT/FLEE/SUPPLY and needs 3 s of near-zero movement, so it
  reported 0.08-0.26% while indoor grind was 15.7-19.7% of movement ticks.

**citycheck.py** (Node replay of the layout + one Chrome for the pinned detector; Savanna seed 7 + 2 seeds, then each themed map)
- Land within 25 m of an enterable building >= 10% (HEAD 2.1-3.4%); median distance to one <= 90 m and p90 <= 150 m (HEAD 165-182 m / 351-360 m); land
  more than 150 m away <= 10% (HEAD 55-62%).
- 0 town road vertices below waterY (HEAD Jungle Market wet on 99.5% of 200 seeds).
- Over 200 seeds: every named town >= 6 enterable buildings (HEAD Container Yard, Rubble Row, Banana Farm, Ranger Ridge, Hunter's Hollow, Fire Watch: 0).
- Endgame (threshold proposed by this merge, not by a lane; tune on the Wave-4 baseline): the final-circle area holds >= 10 static cover pieces on
  >= 90% of seeds per map (HEAD: phase-6 circle median 16-33 pieces, final circle median 0 with no roof slab on 98-196 of 100-200 seeds).
- Negative control: the Wave-6 commit (no towns) must FAIL.

**perf_district.py**: fixed cameras (drop 330 m, street, endgame) vs a `--rev` baseline: <= +40 calls, <= +25% triangles; drop view <= 450 calls.

**interiorcheck.py** (Wave 8): floor not terrain; >= 3 furniture pieces in view; ceiling visible; no kit visual/collider disagreement at window sills and headers.

---

## 5. Cut, and why (one line each)

- **Rapier or any physics engine:** 50-100x slower per actor (104-138 us vs 0.8-2.2 us), ~1 MB, and fixes none of the authoring mismatches.
- **Re-centring every GLB on its bbox centre:** palm/birch centres are canopy-weighted; trunks would move 0.98-1.01 m x s farther from their colliders.
- **Colliders sized from the full bbox for trees:** a ~7 m wide collider (the crown).
- **New collider shapes (cylinder, convex hull, OBB) in Wave 5:** ~25 reader sites and the one-hidden-class rule (`maps.js:208-221`); exact boxes,
  quarter-turns and box chains reach the gate thresholds first. Revisit only if collisioncheck still fails after Wave 5.
- **"Routes do not change" (placement R1 risk line):** false once colliders are resized; bots block on any collider top above y + 0.55.
- **Pitch/roll-fitted cars and containers with axis-aligned colliders:** mismatch; tilt capped at 8 deg instead.
- **Per-car slope fit for road cars:** most car float is the road surface; fixed by road corridors (Wave 6).
- **CDLOD morphing / the CDLOD fork link:** skirts fit the per-chunk rebuild; cite the original only if ever needed.
- **"Indoor blocked <= 3%" across all states as N0a's only gate:** unreachable by N0a alone (moveToward states leave 6.2%); per-state and visible-run rows instead.
- **Marched `wallAhead` probe as a first fix:** its share of the walk failures is unmeasured, and it reverts the audit-S4 rule; conditional only.
- **"Top-floor exits 3/12 -> 12/12" as the headline:** seed-specific; already 7/7 on another seed.
- **Baked nav grid justified by today's maps:** long trips 30/30 and ground rooms 53/53 already pass; it is built for the city (Wave 6-7).
- **Recast-WASM now:** an owner-approved fallback only, if the in-house grid fails its gates.
- **3 x 3 grid core on the Isla Viva volcano or across the Deepwood river:** 39 m relief / 41% grade and river water; O4 endgame areas instead.
- **Compounds as POIs:** 24-30 new labels, landing-heat and roads on the signed-off HUD; a separate list instead.
- **"Match frame < 5 M triangles" as a budget:** 2.6x HEAD's 1.9 M street frame; +25% vs baseline instead.
- **Merged chunks called HLOD:** that is static batching; HLOD is a far proxy, used for far districts only.
- **Early deaths "<= 12 of 49 at 60 s" as a city gate:** a pacing target (look-plan D8, Wave 4); information only.
- **`low-detail-building-*` as the far LOD of each type:** they are different buildings; one merged proxy per far district instead.
- **Kenney shells for every building, shells replacing house()/tower():** deletes interior loot, window cover rules and the bot drop cap (look plan).
- **A city-only 4th map as the first move:** random rotation leaves 3 matches in 4 unchanged.
- **First-person view (look-plan D1/D2/P4.1):** owner decided third-person only.
- **Building, harvesting, a map picker, paid packs, Meshy credits:** owner rules.

---

## 6. Industry references used

| Claim | Source |
|---|---|
| Foliage placement: Z Offset, Align to Normal, Ground Slope Angle, Collision with World | https://dev.epicgames.com/documentation/unreal-engine/open-world-tools-property-reference-in-unreal-engine |
| PCG projects points onto the landscape | https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PCG/UPCGLandscapeData/ProjectPoint |
| Landscape collision mip 0 = full-resolution heightmap | https://dev.epicgames.com/documentation/unreal-engine/landscape-collision-guide-in-unreal-engine |
| Unity TerrainCollider matches the terrain geometry | https://docs.unity3d.com/Manual/class-TerrainCollider.html |
| Chunk cracks covered with skirts | https://www.leadwerks.com/community/blogs/entry/1163-large-scale-terrain-algorithms/ |
| Procedural roads stamped into terrain (Wildlands) | https://80.lv/articles/procedural-world-building-in-ghost-recon-wildlands/ |
| Simple vs complex collision; per-mesh simple primitives | https://dev.epicgames.com/documentation/en-us/unreal-engine/simple-versus-complex-collision-in-unreal-engine ; https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-collisions-with-static-meshes-in-unreal-engine |
| Separate Visibility/Camera trace channels | https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-response-reference-in-unreal-engine |
| Walkable floor angle ~45 deg | https://dev.epicgames.com/documentation/en-us/unreal-engine/walkable-slope-in-unreal-engine |
| Networked CharacterMovement prediction | https://dev.epicgames.com/documentation/en-us/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine |
| Fortnite moved to Chaos physics (11.50) | https://www.neowin.net/news/epic-is-changing-fortnites-physics-engine-in-the-next-season-of-chapter-2/ |
| PUBG vault/climb ~2.3 m | https://www.pcgamer.com/uk/pubg-test-servers-to-roll-out-vaulting-and-climbing-features-next-week |
| Quake III slide/step move | https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_slidemove.c |
| Recast/Detour powers Unity/Unreal/Godot nav | https://github.com/recastnavigation/recastnavigation |
| Detour moveAlongSurface | https://recastnav.com/classdtNavMeshQuery.html |
| Unreal navigation system, NavLinkProxy, path-follower block detection | https://dev.epicgames.com/documentation/en-us/unreal-engine/navigation-system-in-unreal-engine ; https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/AIModule/ANavLinkProxy ; https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/AIModule/UPathFollowingComponent |
| Erangel towns, compounds, Miramar city-centric, Sanhok density | https://pubg.wiki.gg/wiki/Erangel ; https://pubg.wiki.gg/wiki/Miramar ; https://pubg.wiki.gg/wiki/Sanhok |
| PUBG compound of 2-6 buildings | https://www.invenglobal.com/pubg/articles/2985/the-farming-route-of-l-shaped-1-level-flat-house-check-out-each-room-thoroughly |
| Tilted Towers chest count, map centre | https://gamesradar.com/fortnite-chest-locations/ |
| Fortnite Chapter 2 named locations | https://www.gamespot.com/articles/fortnite-chapter-2s-new-map-revealed/1100-6470557/ |
| HLOD = far proxy | https://dev.epicgames.com/documentation/en-us/unreal-engine/hierarchical-level-of-detail-in-unreal-engine |
| three.js InstancedMesh | https://threejs.org/docs/#api/en/objects/InstancedMesh |

## 7. Evidence index (scratch)

- Placement: `W/placement/census_summary.txt`, `census_extra.txt`, `census.json` (16 MB), `shots/` (A rock floating, B rock collider spot, C2 palm on
  chunk border, D2 house slope base, E roof gap, F tower volcano, G2 chest, J ranger roof, L bench, M container stack, P sky islands, Q mall slope,
  R road float), `gate_proto/` (three resolve hook).
- Collision: `W/collision/out/colprobe_*_s7.json`, `colliders_*_s7.json`, `colprobe_verdict.json` (PASS 3/3 measured, 0 page errors), walk-through and
  phantom-collider shots; `W/collision/node/rapier_bench.mjs`, `cost_compare.mjs`, `fallthrough.cjs`.
- Navigation: `W/navigation/out_*.json`, probes `probe_rooms.js`, `probe_stuck.js`, `probe_verify.js`; skeptic `review/skeptic_ashgrid_5.json`.
- City: `W/city/data/all_metrics.json`, `target_sim_ashgrid.json`, `shots/CITY_SHEET.jpg`; skeptic `review/indoor.out`, `los.out`, `cover.out`,
  `endgame_*.out`, `storm_check.out`, `towns_isla.out`.
- Look plan: `_spec/look_2026-10/PLAN.md` and `.../scratchpad/lc_look/`.
