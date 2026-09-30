# Last Circle audit — lane: bots-match

Status: COMPLETE (see Ranked gaps at the end)

## Plan
1. Read runtime/3d/royale/bots.js, loot.js, weapons.js, window.__LC__ test surface.
2. Read DYEFIELD _harness/probe_bots.ts, probe_match.ts and BLOCKTOOTH probe_balance for reference.
3. Write a Playwright probe (scratch dir) that runs several seeds via __LC__.startMatch + fastForward and measures:
   - bots ending on starter pistol, time until most bots hold a better gun
   - stuck share (displaced < 0.4 m over 3 s while in a moving state)
   - ammo-dry share
   - seed replay determinism

## Static findings (quoted, verified this session)

### S1. Bots never read the target's hp / shield / weapon
- Target pick is pure nearest-with-stickiness: `runtime/3d/royale/bots.js:384-385`
  `const bias = bb.target === t.id ? 0.6 : 1;   // stickiness` / `if (d * bias < bestD) { bestD = d * bias; best = t; }`
- Absence: `grep -nE "\bt\.(hp|shield)|tgt\.(hp|shield)|t2\.(hp|shield)" runtime/3d/royale/bots.js` -> no hits.
  The only hp/shield reads are the bot's OWN (`bots.js:276, 292, 310, 507, 1093`).
- Reference: DYEFIELD scores targets on their hp and retreats only when losing:
  `dyefield/runtime/src/core/bots/director.ts:915` `if (e.hp < 50) s -= 2;` and `:784`
  `if (b.sk.retreatHp > 0 && b.retreatWanted && r.hp < b.sk.retreatHp && tgt.hp > r.hp + 10 && dT < b.engage + 2) {`

### S2. Bots swap BACK to the starter pistol from snipers and launchers
- `bots.js:944` slotScore = `(def.damage * pellets * def.rpm / 60) + (s.rarity || 0) * 20`
- `bots.js:971` `if (holdingConsumable || curDry || bs > curScore * 1.15) W.equipSlot(a, bestIdx);`
- Weapon table `runtime/sim/royale.js:60` pistol 20 dmg 400 rpm; `:70` sniper 105 dmg 35 rpm; `:71` glauncher 95 dmg 55 rpm.
- Computed (node): pistol 133.3, sniper 61.3, glauncher 87.1. A sniper of ANY rarity (legendary = 141.3)
  never clears 1.15 x 133.3 = 153.3, and common/uncommon/rare snipers + common/uncommon launchers get swapped
  back to the pistol on the next think. `give()` auto-equips the pickup (`loot.js:536`
  `if (cur && cur.id === "pistol" && cur.rarity === 0 && data.id !== "pistol") W.equipSlot(a, empty);`) and
  ensureGunOut undoes it within one think (0.15-0.48 s).
- Yet `pickLoot` (`bots.js:488`) and the `upgraded` test (`bots.js:264`) count a sniper as an upgrade, so LOOT drops
  from 64 to 35/20 (`bots.js:311`) — the bot stops looting while still fighting with the starter pistol.

### S3. Unseeded randomness in the sim path (a seed cannot replay a match)
- `grep -c Math.random`: bots.js 19 (lines 49, 210, 398, 418, 419, 451, 499, 500, 588, 815, 876, 983, 1160,
  1184, 1185, 1204, 1244, 1267, 1271), weapons.js 2 (`:509` pellet spread
  `const ox = (Math.random() - 0.5) * 2 * sr, oy = (Math.random() - 0.5) * 2 * sr;`, `:549` human recoil yaw),
  loot.js 1 (`:612` swap-drop scatter). So seeding bots.js alone is NOT enough: every bot shot's spread in
  weapons.js:509 is also unseeded.
- `W.rng = SIM.mulberry32(W.seed)` exists (`ffg_royale3d.js:319`) but is only used by shuffledNames (`:670`).
- Reference: DYEFIELD `runtime/src/core/rng.ts:3` "Core code never calls Math.random()"; per-bot streams
  `director.ts:332` `this.rnd = mulberry32(hash32(seed, r.id, 0xb0751));`; probe_bots.ts gates
  "same seed -> identical hash" (`probe_bots.ts:496`).

### S4. A* window centred on the start/goal MIDPOINT
- `bots.js:674` `const CELL = 1.5, GRID_R = 21;   // 1.5m cells resolve DOORWAYS (2m missed them); ~63m window`
- `bots.js:681` `const cx = (sx + tx) / 2, cz = (sz + tz) / 2;`
- `bots.js:689-690` S and T are clamped into the window with `cl(...)`.
- `bots.js:796-798`: while a path exists the wall-slide is OFF (`if (!bb.path) want += bb.wallSide * 1.05;`),
  so a garbage long-range path also disables the slide that would have got the bot round the wall.
- Harness trap (not player-facing): `ffg_royale3d.js:628` `for (let t = 0; t < seconds; t += h)` accumulates
  float error, so `fastForward(0.5, 1/30)` runs 16 steps = 0.533 s, not 0.5 s (smoke run: 120 slices -> simT 64.0).

### S5. HARNESS VALIDITY: every existing LC bot probe runs with the storm switched OFF
- `runtime/3d/royale/storm.js:111` `if (st.dps > 0 && W.phase === "match") {` — storm damage needs phase "match".
- `runtime/3d/royale/player.js:966` `if (W.phase === "drop" && !anyDrop) W.phase = "match";` — only reached from "drop".
- "drop" is set only by the lobby hand-off (`ffg_royale3d.js` begin(): `W.phase = W.mode === "practice" ? "match" : "drop";`),
  which `hud.js` showLobby fires from a `setInterval` after ~0.7 s fill + 3 x 900 ms countdown (hud.js `const fillIv = setInterval(` / `cdIv = setInterval(`).
- `_harness/botcheck.py`, `botdiag.py`, `stuckdiag.py` all do `await C.startMatch(...)` then a fully synchronous fastForward loop
  inside one evaluate, so the interval never fires: W.phase stays "lobby" for the whole run and NOBODY ever takes storm damage.
  Every STUCK/DRY number those scripts produced was measured in a match with no storm.
- Observed this session (storm-off, first probe version): seed 1 isla_viva with Math.random patched ran to simT 1066.7 with
  2 alive — a bot in ROTATE parked inside a 9 m final circle's storm (stormR 9, phase 8) for ~650 s without dying.
- Probe fix used here: dispatch the lobby's own ENTER skip (`hud.js` finishLobby) synchronously after startMatch.

## Measurements (all via 127.0.0.1:8790 + __LC__.fastForward, headless Chrome, step 1/30)

### M1. A* window experiment (scratch/probe_paths.js — VERBATIM copy of bots.js:651-743 run on the real map)
Pairs: start near a POI, straight line blocked within the first 12 m (what wallAhead hands to requestPath), 30 pairs per distance
per map. MID = shipped (window centred on midpoint). START = same code, window centred on the bot (goal clamped to the window
edge = an intermediate waypoint). "useful" = every leg clear of blocked cells AND (ends within 9 m of goal, or for START: >= 20 m
of progress). Judge samples legs every 0.75 m (stricter than the 1.5 m string-pull), so short-range "useful" is ~50% for BOTH
variants — read the MID vs START contrast, not the absolute number.

| D (m) | isla_viva MID / START | ashgrid MID / START | deepwood MID / START |
|---|---|---|---|
| 15 | 11 / 9 | 15 / 17 | 15 / 20 |
| 45 | 17 / 20 | 16 / 18 | 12 / 15 |
| 75 | 15 / 16 | 9 / 15 | 8 / 12 |
| 90 | 6 / 15 | 6 / 23 | 1 / 10 |
| 120 | **0** / 19 | **0** / 17 | **0** / 14 |
| 180 | **0** / 16 | **0** / 15 | **0** / 9 |
MID first leg clear at 120 m: 4/30, 7/30, 2/30; at 180 m: 2/30, 4/30, 1/30. Cost per call 1-8 ms either way.

Live, in real matches (storm OFF version of the harness, 320 s each), moving-state bots holding a bb.path:
- isla_viva: 505 path samples, 326 (65%) with the first leg crossing a blocked cell; 356 had goal > 63 m, 276 (78%) of those blocked.
- ashgrid: 655 samples, 230 (35%) blocked; 384 far, 129 (34%) blocked.
- deepwood: 409 samples, 181 (44%) blocked; 231 far, 128 (55%) blocked.
- Median goal distance of a pathing bot: 92 / 115 / 95 m (p90 384 / 238 / 689 m) — most requests are far beyond the 63 m window.

### M2. Loot census (replays populate()'s own rng, loot.js:163-178; standard mode)
| map (seed) | loot points | chests | floor items | floor guns (pistol) | floor ammo boxes (light) | guns per player (floor+chest)/50 |
|---|---|---|---|---|---|---|
| isla_viva (11) | 144 | 45 | 53 | 26 (4) | 13 (**1**) | 1.42 |
| ashgrid (12) | 301 | 63 | 123 | 50 (9) | 33 (13) | 2.26 |
| deepwood (13) | 262 | 66 | 105 | 50 (5) | 32 (9) | 2.32 |
Floor rarity isla_viva 16/4/4/2/0 (common..legendary). Light ammo feeds BOTH the starter pistol and the SMG
(`royale.js:60-61` `ammo: "light"`), and isla_viva spawns ONE light box on the floor for 50 players.

### S6. Bot PHYSICS depends on the CAMERA: bots > 250 m from the camera walk through walls
- `runtime/3d/royale/player.js:957` `const humanPos = (W.camera && W.camera.position) || (W.player ? W.player.pos : null);`
- `player.js:962` `const far = a.isBot && humanPos && a.pos.distanceToSquared(humanPos) > 250 * 250;`
- `player.js:1281-1282` `// far bots: cheap move, terrain only` / `a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;` — no blockedHoriz,
  and `:1286` support = `W.map.heightAt` (terrain) instead of supportAt, so a far bot ignores walls, floors and roofs.
- Consequences: (a) a bot that walks through a wall while far can be INSIDE geometry when the camera comes within 250 m (a
  stuck-in-wall bot the player walks up to); (b) the sim is not a pure function of the seed — it depends on where the camera
  is (and, online, on the HOST's camera); (c) a scoped sniper looking past 250 m can watch bots clip through buildings.
- Reference: DYEFIELD/BLOCKTOOTH keep a THREE-free sim with no view input at all (BLOCKTOOTH `src/core/types.ts:8-9`
  "All sim randomness comes from world.rng streams (mulberry32). Math.random is forbidden in sim code.").
  A LOD may skip ANIMATION (syncObj already does: `player.js:1416` `a.rig.mixer.timeScale = far ? 0 : 1;`), never collision.

### S7. Bot navigation is 2-D at TERRAIN height — bots trapped on upper floors and inside huts
- `bots.js:675-678` `function cellBlocked(W, x, z) { const g = W.map.heightAt(x, z); ... return obstacleAt(W, x, z, g); }` —
  every A* cell and every escape-cell probe (`bots.js:828` `if (!cellBlocked(W, ex, ez)) esc = { x: ex, z: ez };`) is judged at
  the TERRAIN height, never at the floor the bot is standing on.
- Measured spot (scratch/diag_spot.py, seed 1 isla_viva, "Coco Village"): bot s21 sat at (-66.7, y 10.4-11.6, 303.7) in LOOT with
  box displacement 0.00 m from t=29.9 s to t=358.9 s — the whole match. Colliders there: 2nd-floor slab
  `minX -67 maxX -58.1 minY 8.98 maxY 9.28` (stairwell gap -58.1..-53), roof `minY 12.98`, walls `8.98-10.38` and `11.48-12.98`
  on both faces of the corner. It is on the 2nd floor, jumping into the corner (y oscillates), and the terrain-level grid
  around it reads open (`.`) so the escape logic picks a cell 1.5 m away that it can never leave the floor to reach.
- Second spot (-124.8, 5.9, 339): inside a hut (walls x -130.33..-130.01 and -124.32..-124.0, z 333.57..339.81, door gap
  x -127.86..-126.46 on the z 333.6 face), LOOT goal 65-70 m away, frozen t=55-115 s. The midpoint window is at most 31.5 m
  half-width (GRID_R 21 x CELL 1.5), so once the goal is > 63 m away along either axis the bot's own cell is clamped to the window
  edge (bots.js:689) and the returned path starts somewhere else entirely (S4 made visible). Inferred, not traced frame-by-frame.

### M3. Full matches, storm ON (scratch/probe_match.py + probe_match.js; onA.json, onB.json) — 7 matches
Phase verified per run: `lobby -> drop -> match` (the ENTER skip). Idle human slot s0 (no input, like every LC probe).
Samples every 16 steps = 0.533 s. "moving" = brain state in LOOT/ROTATE/PUSH/WANDER/HUNT/FLEE/SUPPLY, not channelling a chest,
not healing, not emoting. STUCK = net displacement < 0.4 m across 7 consecutive moving samples (3.2 s).

| seed map | ends (simT) | deaths < 60 s | ACTIVE pistol at end-of-life | starter-only at end-of-life | pistol share of gun kills | 50% of alive bots HOLD non-pistol | STUCK % moving (bots ever) | all-guns-dry % (bots ever) |
|---|---|---|---|---|---|---|---|---|
| 1 isla_viva | 484.6 | 20 | 71.4% | 51.0% | 57.1% | never | 20.8% (6) | 0.1% (2) |
| 2 ashgrid | 336.6 | 24 | 67.3% | 40.8% | 55.1% | 60.3 s | 0.1% (3) | 0.3% (2) |
| 3 deepwood | 373.3 | 19 | 81.6% | 49.0% | 67.3% | never | 1.6% (6) | 3.7% (9) |
| 1 isla_viva (replay) | 376.0 | 25 | 77.6% | 57.1% | 55.3% | 94.9 s | 13.2% (5) | 0.2% (3) |
| 1 isla_viva (rand patched) | 566.0 | 18 | 67.3% | 42.9% | 52.2% | 62.4 s | 26.8% (6) | 3.4% (7) |
| 1 isla_viva (rand patched, replay) | 406.9 | 19 | 75.5% | 49.0% | 46.9% | never | 12.3% (5) | 1.5% (7) |
| 4 ashgrid | 345.5 | 18 | 77.6% | 42.9% | 65.3% | never | 1.5% (1) | 1.8% (10) |
| **pooled** | 337-566 | 18-25 of 49 | **74.1%** | 47.5% | **57.1%** (193/338) | never in 4/7 | **12.5%** (heavy-tailed) | 1.7% |

- Bots that were still alive at t >= 90 s (n=161): 59.0% ended/died HOLDING the pistol; 21.1% never carried anything else.
- Kills by weapon, 343 kills: pistol 193, smg 59, ar 51, shotgun 24, glauncher 8, storm 5, **sniper 3**.
- Carrying a sniper/launcher but holding the pistol: 23.8% of such samples (up to 68.5% in one match) — S2 in the field.
- 80% of alive bots holding a non-pistol: reached in 0 of 7 matches.
- The storm schedule (`royale.js:285-300`, standard) totals 820 s over 8 phases; every match ended at 337-566 s in storm
  phase 2-4 with the circle still 287-553 m in radius (start 784 m on isla_viva). Alive <= 10 was reached at 156-313 s, still in
  phase 1-2 (radius 597-715 m). Phases 5-8 — the "last circle" the game is named for — were never reached in 7 of 7 matches.
  The idle human slot died at 31-217 s. (Caveat: the human slot idles in every LC probe; a real player adds one fighter.)
- STUCK is concentrated in named spots, not spread thin: in seed 1 isla_viva, 6 bots produced 925 stuck samples, one bot frozen
  from t=29.9 to t=358.9 (S7). Maps/seeds without multi-storey buildings near the drops sit at 0.1-1.6%.

### M4. Does a seed replay a match? NO — and the cause is now isolated
Fingerprint = FNV hash of every actor's pos/hp/shield/alive, taken every ~5 s of sim time.
| pair (same page, seed 1 isla_viva, storm on) | result |
|---|---|
| shipping Math.random, run twice | diverge at fingerprint 5 (~25 s, first landings); winners s46 vs s22; ends 484.6 s vs 376.0 s |
| ONE global seeded Math.random for everything | STILL diverge at fingerprint 5; winners s41 vs s9; ends 566.0 vs 406.9 s |
| ROUTED: seeded stream only for calls whose caller is royale/{bots,weapons,loot,player,storm}.js, view keeps Math.random | **IDENTICAL**: 67/67 fingerprints equal, same placements, winner s46 both, simT 334.1 both |
Math.random calls in one 334 s match (routed run): bots.js 66,070; weapons.js 4,304; player.js 49; loot.js 26 — and view code
fx.js 131,825, audio.js 56,166 vs 6,099 (differs run to run), three (cdn.js) 6,600 vs 6,560.
Conclusion (verified): the sim's ONLY non-determinism is its own Math.random calls in those four files; the camera-dependent LOD
(S6) did not break same-page replay because the camera follows the same deterministic idle player. A single shared seeded stream is
NOT a fix, because audio/fx draw a wall-clock-dependent number of values from it. The fix is DYEFIELD's per-system streams.

### M5. Pooled over 11 storm-on matches (onA + onB + onD; 8 distinct seeds, seed 1 isla_viva run 4x)
- ACTIVE weapon at end-of-life = pistol: **74.8%** of 539 bot lives; starter-only (never carried anything else): 47.9%.
  Bots alive past t = 90 s (n = 252): 60.7% still HOLDING the pistol at the end, 22.6% never carried anything else.
- Kills (539): pistol 320, smg 86, ar 80, shotgun 32, glauncher 10, storm 7, **sniper 4**. Pistol = **60.2%** of gun kills.
- Time until 50% of alive landed bots HOLD a non-pistol: 60.3 / 62.4 / 94.9 / 94.9 s in 4 matches, **never in 7 of 11**.
  50% CARRY a gun that beats a common pistol: 56-108 s in 7 matches, never in 4. 80% carry one: **never in 11 of 11**.
- Carrying a sniper/launcher but HOLDING the pistol: 34.4% of those samples (S2 in the field).
- Deaths in the first 60 s (bots land ~22-27 s): 13, 18, 18, 18, 19, 19, 20, 20, 23, 24, 25 of 49 (27-51% of the lobby).
- Match end: 286.7-566.0 s; storm schedule 820 s (phases 5-8 never reached).
- STUCK share of moving samples by map: isla_viva 20.8 / 13.2 / 26.8 / 12.3 / 18.4% (seeds 1 and 7), ashgrid 0.1 / 1.5 / 3.5%,
  deepwood 1.6 / 0.5 / 0.0%. Bots ever stuck per match: 1-6 of 49. Slot s21 is stuck in 4 of 4 seed-1 runs because assignDrops is
  seeded (bots.js:169) and sends it to the same Coco Village building every time.
- DRY (no gun with any ammo): 2.3% of landed samples pooled; per match 0.1-7.2%; 2-11 bots per match ever fully dry; 0-7 die dry.

### M6. Was the pistol kill a "fought instead of grabbing the gun at his feet"? Mostly NO — it is scarcity (onD.json, 3 matches)
At each pistol kill by a bot: nearest floor gun better than a common pistol, or unopened chest, within 40 m of the KILLER
(W.nearbyLoot, +-4 m height; the victim's own death drop excluded). 85 pistol kills: better gun/chest within 5 m: 1;
within 10 m: 3; within 20 m: 12; **nothing within 40 m: 61 (72%)**. So "loot before you fight" would fix ~4% of pistol kills;
putting more guns on the map (M2) is what moves the 60%. (Hypothesis I held before measuring; the measurement killed it.)
Related, verified: bots only pick things up inside actLoot (`bots.js:905` `W.pickupItem(a, n.id);`); walkover pickup is
human-only (`loot.js:695` `const a = W.player;`), so a bot fighting or rotating walks straight over guns.

### M7. Far-LOD wall clipping, measured (scratch/probe_farwall.py, seed 1 isla_viva, 426.7 s)
Bot samples far (> 250 m from camera): 9,101, of which inside a collider footprint at body height: 392 (4.3%). Near: 3,933,
inside 504 (12.8% — inflated by the 0.2 m margin catching wall-huggers). Far-inside -> near-inside transitions (a bot that clipped
in while far and is still inside when the camera arrives): **1** in the match (s6 at t=74.1, (-279.5, 4.7, 344.1)).
Seed 2 ashgrid (407.5 s): far 7,739 samples, 114 inside (1.5%); near 2,466, 0 inside; transitions 0.
Measured player impact is therefore LOW today; the determinism/online coupling (S6) is the real cost.

## Ranked gaps (by what a player would notice)

1. **The lobby fights with the starter pistol all match — loot is too thin** (HIGH). M5: 74.8% of bot lives end holding the
   pistol, 60.2% of gun kills are pistol kills, 80% of bots never carry a better gun in 11/11 matches. M6: at 72% of pistol kills
   there was no better gun or chest within 40 m. M2: 1.42-2.32 guns per player, isla_viva spawns ONE light ammo box.
   Fix: more guns and companion ammo per floor spawn (rollFloorItem returns the gun plus 1-2 boxes of its ammo, as rollChest
   already does at royale.js:609), raise the 0.55 floor-spawn roll or add a second item per loot point, and floor light ammo.
   Files: runtime/sim/royale.js, runtime/3d/royale/loot.js. Effort M.
   Verify (real browser, storm-on probe, >= 6 seeds): census >= 3 guns/player and >= 8 light boxes per map; pistol share of gun
   kills <= 35%; pistol-at-end-of-life <= 40%; 80% of bots carry a better gun by 120 s in >= 4/6 seeds.
2. **Bots are trapped on upper floors and inside huts on isla_viva** (HIGH on that map). M5: 12-27% of moving samples stuck on
   isla_viva in 5/5 matches (0-3.5% elsewhere); one bot frozen 329 s (S7). Causes S7 (grid judged at terrain height) + S4
   (midpoint window: 0/30 useful paths at >= 120 m on all 3 maps, 9-23/30 with a bot-centred window, M1).
   Fix: floor-aware cellBlocked/obstacleAt (evaluate at the bot's support height, treat > 1.2 m drop-offs as blocked except
   ramps), centre the A* window on the bot and clamp the goal to its edge, run the escape search at floor height, and a hard
   breaker (same 2 m for > 12 s -> new goal via the nearest ramp/door). Files: runtime/3d/royale/bots.js. Effort M.
   Verify (real browser): storm-on seeds 1 and 7 isla_viva + 4 others: stuck < 2% of moving samples per match and no bot with
   > 5 episodes; probe_paths START-style useful >= 15/30 at 120-180 m.
3. **Bots swap snipers/launchers back to the pistol, and stop looting because they think they are geared** (HIGH-MED). S2 +
   M5: 34.4% of sniper/launcher-carrying samples hold the pistol; 4 sniper kills in 539. Fix: range-aware weapon choice in
   ensureGunOut (DPS x falloff at the current target distance; sniper when target > 50 m and bot is slow, launcher mid-range),
   and make `upgraded` mean "carries a gun that beats the starter" (gunScore > pistol) so LOOT stays at 64 until true.
   Files: runtime/3d/royale/bots.js. Effort S. Verify (browser): carrying-but-holding-pistol < 5%; sniper kills > 0 in most
   matches; scripted in-page check: [pistol, sniper] bot equips sniper for a 120 m target, pistol/shotgun at 10 m.
4. **Early wipe and short matches — the "last circle" never happens** (MED-HIGH, owner design call on targets). M5: 27-51% of
   the lobby dead within 60 s; every match ends at 287-566 s in storm phase 2-4 of 8. Fix: spread drops (assignDrops,
   bots.js:168-192: cap bots per POI by that POI's loot points, send the rest to randomGroundPos), let more loot (gap 1) slow
   the pistol brawl. Files: runtime/3d/royale/bots.js. Effort S. Verify (browser): median deaths < 60 s <= 12/49 and median
   match end >= 600 s (phase >= 5) over >= 6 seeds.
5. **Harness measures a match with no storm, no gates, an idle human and no replay check** (no direct player impact; highest
   leverage). S5: W.phase stays "lobby" in botcheck/botdiag/stuckdiag, so storm.js:111 never fires; they print, never gate; s0
   stands still (idle player survived 1066 s in a storm-off run). Fix: add _harness/probe_match.py + probe_match.js (port of
   scratch/probe_match.*): press ENTER after startMatch and assert phase "match"; gates for stuck, dry, pistol share, same-seed
   identical fingerprints; drive s0 with attachBrain or a player-like policy; patch the three old scripts to press ENTER.
   Files: games/last-circle/_harness/probe_match.py (new), _harness/probe_match.js (new), _harness/botcheck.py,
   _harness/botdiag.py, _harness/stuckdiag.py. Effort S. Verify (browser): prints `lobby->drop->match`, storm kills/damage > 0
   in a full match, exits non-zero on a planted failure.
6. **A seed does not replay a match** (LOW player impact; needed for bug repro and for gate 5). M4: routed seeding of only the
   sim files gives 67/67 identical fingerprints; shipping and global-seeded runs diverge at ~25 s. Fix: per-system mulberry32
   streams — keep the per-slot rng attachBrain already builds (bots.js:120) on the brain and use it at all 19 bots.js sites;
   W._spreadRng for weapons.js:509 (pattern: W._dmgRng at weapons.js:587); seeded scatter for loot.js:612. Never a shared
   global stream (audio/fx draw a wall-clock-dependent count). Files: runtime/3d/royale/bots.js, runtime/3d/royale/weapons.js,
   runtime/3d/royale/loot.js. Effort S. Verify (browser): same seed twice in one page -> identical fingerprints and placements,
   different seed -> different; no Math.random left in those three files except view-only lines.
7. **Bots never read the target's hp/shield/weapon** (MED). S1. Fix: in perceive() subtract a bonus for low target EHP and for
   the last attacker (DYEFIELD director.ts:914-916); FLEE/PUSH compare own EHP vs target EHP (director.ts:784). Files:
   runtime/3d/royale/bots.js. Effort S. Verify (browser, scripted scenario): two visible enemies at 26 m / 30 m, the farther on
   20 EHP -> bot targets it; FLEE only when losing the EHP race.
8. **Far-LOD bots walk through walls; the sim depends on the camera** (LOW measured impact: 1 clip-in per match, M7; MED for
   online/determinism). S6. Fix: LOD may drop animation only — keep blockedHoriz + supportAt for far bots. Files:
   runtime/3d/royale/player.js. Effort S. Verify (browser): probe_farwall far-inside falls to the near baseline and
   farToNearInside = 0; perf delta recorded as information.
9. **Bots never walk-over pick up** (LOW). M6: only 3/85 pistol kills had a better gun within 10 m. Fix: the human walkover
   rule (loot.js:695-707) for bots in any state. Files: runtime/3d/royale/loot.js. Effort S. Verify (browser): zero samples of
   a bot standing within 1.5 m of an acceptable gun for > 1 s without taking it.

Status: COMPLETE. Raw data: scratch/onA.json, onB.json, onC.json, onD.json, paths.json, farwall.log, diag_spot.log,
stormoff_A.json, stormoff_B.json. Probes: scratch/probe_match.{py,js}, probe_paths.{py,js}, probe_farwall.{py,js},
diag_spot.{py,js}, analyse.py. No repo file was modified.
