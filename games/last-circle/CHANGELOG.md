# Last Circle — CHANGELOG

Source of truth for this game's history and design decisions.
Design research: `forgeflow-games/state/research_battle_royale.json` (Fortnite building/storm, Final Drop browser formula, PUBG ballistics/loot, Apex shields/feedback).

## 2026-10-27 — Wave 8 + parity waves P1 / P2 / P3: team modes, revives, fall damage, grenades, new guns, furnished houses (?v= set at deploy)

One release for four waves of work: Wave 8 (furnished interiors) and the parity waves P1, P2 and P3 (what the big battle royales do that we did
not). Every map's world and loot changed, so `MAP_GEN_VERSION` is 7 (Wave 8's 6 never shipped): an older page and this one cannot share a squad
room, and the lobby says so. Plan `_spec/parity_2026-10/PLAN.md`; the owner's calls are in `_spec/parity_2026-10/OWNER_DECISIONS.md` (OD-1..OD-16).
Phones are unchanged (no new touch controls, same phone visuals).

**Play with a team**
- Four modes on the main menu: **Solo, Duos, Trios and Squads**. In a team mode the empty seats are filled with **bot teammates**; they follow you,
  fight beside you, show their health in the squad panel and wear a team-coloured name tag.
- **Knock-and-revive (team modes only)**: a lethal hit knocks you down instead of killing you while a teammate is still up. You crawl and bleed out
  slowly; a teammate holds **E** beside you to bring you back. When the whole team is down, the team is out. Solo is unchanged: you die.
- **Pings**: middle mouse marks a spot or an enemy for the team (on screen, on the compass and on the big map). On the drop, a pin on the big map
  steers your glide there.

**Fights**
- **Fall damage**: drops up to about 4 m are free, 10 m costs about 38 hp, 15 m about 72, and a fall of about 19-20 m kills from full health.
  Armour never takes fall damage, water and parachute / glider landings are always free (also stepping straight off a roof you just glided onto),
  and a hard landing staggers you for 0.4 s. Bots play by the same rule and do not walk off deadly drops.
- **Grenades**: a **frag** (throw it, it bounces and goes off) and a **smoke** grenade (a thick cloud that blocks sight, for you and for the bots).
  Both are found on the floor and in chests.
- **Three new guns**: the **Marksman Rifle** (hard-hitting semi-auto, 10 rounds), the **Light Machine Gun** (75 rounds, slow to reload) and the
  **Burst Rifle** (three-round bursts). All use medium ammo.
- Recoil follows a learnable pattern per gun, shots spread a little more while you keep firing, and hits, shield hits and a breaking shield each
  have their own sound and marker.
- **Supply drops** fall from the sky as the storm closes (follow the beacon, hold E to open; better loot inside). A player who dies leaves a
  **death pile**: everything they carried in one spot with one marker in the colour of the best item in it. Bots loot shields from piles too.
- Loot depends on where you land: busy named places hold better loot, and one hot zone per match is marked on the big map.

**Movement and look**
- Slide out of a sprint (crouch while sprinting), turn on the spot, crouch-walk and strafe with proper animations, a falling pose and a hard-landing
  pose. Every new move is a Mixamo animation.
- **Furnished houses** (Wave 8): every building you can enter on all three maps has real rooms - beds, kitchens, bathrooms, sofas, shelves, desks,
  stairs between floors - and bots find their way through them.
- The towns got their own character: Savanna's Container Yard and Old Mall, Deepwood's Logging Camp woodyards and a fire lookout tower, rock and
  ruin cover between the towns, smoother roads, launch portals on the ground, livelier water, trees that move in the wind and dirt and wear on walls.

**Settings**
- **Graphics: LOW, MEDIUM, HIGH and ULTRA**, picked for your machine on first start and changeable any time.
- The settings menu has tabs (**Game, Video, Audio, Controls, Accessibility**), every key can be **rebound**, and there are **colour-blind modes**
  (Protan, Deutan, Tritan, with a strength slider) that also recolour the HUD's enemy, damage and squad colours.

**Bots**
- Better bots: they back off to heal, use cover, throw frags and smoke, get out of a grenade's way, revive their team, and walk the
  furnished houses, stairs and top floors (rooms reached: ground floors 360 / 360, upper floors 239 / 240 in the nav test).

**Sound**
- Guns sound different near, at middle distance and far away; new sounds for the three new guns; hurt, knocked, revive and death voices (three
  voices); footsteps that match the ground (new: sand, dirt, water and metal, beside grass, wood, concrete and snow).

**Performance**
- The per-frame memory churn of the busiest map (Isla Viva) went from 94 KB to 79 KB per frame in the last pass (limit 100). Drop and match frames
  stay within the triangle and draw-call bars on all three maps.

**Owner follow-ups (decided, not fixed in this release)**
- **OD-14**: Deepwood's Logging Camp brick wall reads only +12 % contrast where the bar is +30 % (every other wall passes). Accepted for this
  release; raised to +30 % (or the industry norm) right after it is live.
- **OD-16**: bots' median shield 600 s into a match is 25 (the bar is 75, kept). Accepted for this release; the next wave adds the shield
  economy: bots go for big shields inside the next circle beyond their 60 m search, and supply drops carry more big shields.
- **OD-15** (the next wave, right after this release is live): the facade fix above plus bullet drop, scope glint and zoom steps, doors on
  houses (bots use them too), cascaded shadows on High / Ultra and more character variety from the existing skins, a hard-landing consequence and
  terminal velocity, diving underwater, ziplines, and an inventory screen where you can drop items. Not in it: armour or boost items, gamepad, a
  bigger online relay.

## 2026-10-19 — Wave 7b: themed towns on Isla Viva and Deepwood, and the endgame areas (?v=1792458191)

Plan `_spec/world_2026-10/PLAN.md`, Wave 7b. Three stages, each independently verified; the final run of `gate.py --disk --negative-controls` on
the frozen release tree: 85 of 85 counted gates and 7 of 7 selftests pass, 131 of 131 planted-fault controls caught. `MAP_GEN_VERSION` is 5
(Savanna's world is byte-identical to the last build; Isla Viva and Deepwood changed).

- **Isla Viva** reads as a pastel resort island: red-tile and coral roofs, palms, promenades, walled compounds and a docks village; the volcano rim
  holds a ruined crater village of stone huts on a basalt cone, with stairs the real mover climbs 120 of 120 times. Land within 25 m of a building you
  can enter: 37-42 % (was 9-10 %). Chests 69 (was 53), 4.84 guns + chests per player.
- **Deepwood** reads as timber lodge towns; Riverside Mill has a mill wheel and a timber bridge with rails, lamps and stone piers across the river
  (walked across the full 8.5 m width on 200 seeds: 2,000 of 2,000 walking and sprinting). Final-circle cover on 96 % of seeds (bar 90 %).
- Enterable buildings: Isla Viva 97.5 %, Deepwood 99.6 %. Town roads under water: 0 of 200 seeds on every map (was 200 of 200).
- Performance: per-frame memory Isla Viva 58.8 KB (was ~60 live; peaked at 118 during the build and was fixed), Savanna 74.2; worst themed
  view +19 draw calls over the old build, drop views 140-223 calls (limit 450), phone tier within its bar. Savanna's endgame view is now within
  the +40 bar against the pre-town build on all five test seeds.
- Bots: heal-pockets 99.87 %, top-floor paths 186 of 186, the same seed replays identically under heavy CPU load.
- Phones: an in-world loot label can no longer draw under a touch control.

**Known and NOT fixed**: Deepwood allocates ~94 KB per frame (bar 100; the live build reads 54 there) - watch it. The crater village is sparse at eye
height, Deepwood's drop view is washed out by snow and rain, and buildings are still boxes with bare interiors (furnished interiors are Wave 8).

## 2026-10-15 — Wave 7 completion: a taller, more varied Savanna, safer squads, bots off the roofs (?v=1792092800)

Closes the gaps the Wave-7 verifiers named, before Wave 7b (themed towns on Isla Viva and Deepwood) and Wave 8 (furnished interiors). Independently
verified; the full `gate.py --disk --negative-controls` found only four harness defects (two stale plant controls, a roof-exit row that counted a roof
firefight as a stall, a loot-pool row that read a bot's legitimate slot reuse as a leak), all fixed with their controls re-proven.

**Savanna**
- Skyline: buildings over 30 m go from 12 to 35-40, over 60 m from 0 to 14-20, over 80 m from 0 to 1-3; the tallest from about 50 m to 81-87 m.
  More variety (52-57 distinct looks of ~60 downtown buildings, was 37-42; 18 roof colours, cornices, three-storey fronts), 5-9 landmark lots per
  seed (gas station, market, clock-tower plaza, sports court with stands and floodlights), richer compounds (4.4-4.7 buildings each; hay, troughs,
  windbreaks, crop fields), and a cooler town ground with a pale kerb ring so towns read from the plane (edge density in the 330 m drop view +41-72 %).
  The drop view is still hazy: the global fog is signed off and untouched.
- Cost: draw calls at the three fixed cameras are within the plan's bars on all five test seeds against BOTH the old build and Wave 7 (worst +3 vs
  Wave 7, +22 vs Wave 6; bar +40), triangles at most x0.69 / x0.82 of them, phone tier 25/25; queryColliders 121 per frame.
- `MAP_GEN_VERSION` is 4 (3 was Wave 7): Savanna's world changed; Isla Viva and Deepwood hash identically.

**Squads**: a client whose `towngen.js` / `citykit.js` import fails (retried once) now sets `W.mapFallback`, and `net.js` takes it out of the squad room with
an on-screen message instead of advertising a version it does not hold; solo play is unaffected. The squad-guard test now also runs against the live CDN
(63 of 63 on the seven guard cases). The supply-crate shader program is linked where it is created (loot.js) instead of by a duplicate in fx.js.

**Movement**: the 6 mm window in the mover (the wall test and the support test disagreed about the feet) is closed: the exhaustive sweep of every isolated
rock on three maps reads 0 of 13,808 sprints inside a rock (live: 5 of 12,464). Doors, stairs, ramps, mantles and feel are unchanged (collisioncheck 17/17,
worldlive 8/8, navcheck 10/10, feelcheck 7/7 x3, 21 matches: circle 5 or later in 21 of 21).

**Bots in towns**: top-storey rooms reached 70 of 70 (was 63 of 71): a tower's landing slab starts 0.61 m past its stair, so the grid pruned the storey above as
an island; stair-end bridge edges fix it. Bots that landed on a roof no longer stand there (natural landings, 72 touchdowns: longest stand 9.0 s -> 2.4 s,
landings standing 3 s or more 6 -> 0). Real stalls (wanting to move with zero input) 0.50 % -> 0.24 % of moving ticks. Sim cost per tick is unchanged
(0.553 ms; the nav bake is still most of Savanna's excess).

**Gates**: roofland (roof landings), rocksweep, simcost, genversion, coldcache, the squad fallback cases and the live squad test are registered; perf_district
runs on five seeds; framecheck for Deepwood is blocking; roof-exit and the loot pickup rows judge what they should (time outside a firefight; slot
ownership), and every changed row still fails the planted fault or the frozen build (the live Wave-7 build still fails roof-exit, 3 of 40).

**Known and NOT fixed**
- Bot paths whose first leg is blocked did not improve (about 3-4 % of sampled paths; 96 % are the outdoor planner rounding wall corners).
- KB allocated per Savanna frame is 97.6-98.4 against the 100 bar (87 at Wave 7): thin, watch it. The rock sweep's deepest overlap reads 0.100 m on Ashgrid
  against a bar of more than 0.10 m. Outpost streets still use a crude, oversized brick texture.

## 2026-10-14 — Wave 7: the Savanna city (?v=1792031930)

Plan `_spec/world_2026-10/PLAN.md`, Wave 7 of 8, Savanna only (Isla Viva and Deepwood towns are Wave 7b). Owner ask: "real city rather than so much
open space". Built as three stages of file-disjoint lanes, each independently checked; the final full run `gate.py --disk --negative-controls` is
OVERALL PASS (61 of 61 rows, every planted-fault control detected).

**What players see on Savanna**
- Downtown is a 4x4 plateau with about a dozen towers; Metro Plaza, Old Mall and the Outpost are street-grid towns with crosswalks, curbs, hydrants,
  benches, street lights and parked cars (static cover, no driving); link roads join the towns; about 30 fenced compounds sit between them.
  The live build is a bare X of road with six lone blocks.
- Every house and every tower is enterable (189-204 houses, 35-44 towers; 88 % of all buildings, the rest are skyline shells under the 20 % cap).
  Interiors are still empty rooms with a stairwell and loot (furnished interiors are Wave 8).
- Roads and towns are on the map overview; the final circles end in the downtown. Loot is richer: 6.2 guns + chests per player (was 4.96).

| measured on Savanna (seeds 7 / 1234 / 2026 unless noted) | live before | now |
|---|---|---|
| land within 25 m of an enterable building | 3.1-3.5 % | 16.7 / 17.9 / 17.5 % |
| median / p90 distance to an enterable building | 150-163 m / 337-370 m | 67.5 / 63.4 / 64.5 m and 121.6 / 119.9 / 119.2 m |
| land more than 150 m from one | 50-55 % | 2.6 / 3.5 / 2.8 % |
| every named town has >= 6 enterable buildings (200 seeds) | 1 town of 9 | all 9 (>= 7) |
| colliders, seed 7 | 2,739 | 9,485 (queryColliders per frame 123.8, bar 150) |
| draw calls drop / street / endgame, seed 7 | 278 / 188 / 166 | 173 / 170 / 169 (bar: +40 over live; drop view 199-221, bar 450) |
| triangles, seed 7 | - | x1.056 / x1.129 / x1.232 of live (bar x1.25) |
| shader programs compiled after the first drop frame (Savanna / Deepwood) | 1 / 1 (a 523 ms hitch mid-drop on Savanna) | 0 / 0 |
| ground height NaN (Savanna seeds of 200) | 7 | 0 (also fixed on live's Isla Viva seed 17 and Deepwood seed 12) |
| kit buildings that poke or phantom past their collider at body height | 27 / 21 of 81 types | 0 / 0 |
| bot indoor blocked ticks on Savanna | 1.97 % | 0.76 % (indoor share of bot time 1.9-4.1 % -> 10-12.7 %) |
| bot paths first-blocked on Savanna | 10.6 % | 3.2 % |
| bot-match median length, 21 fresh matches | 755.5 s | 724.9 s (circle 5 or later in 19 of 20, same as live) |

**Under the hood**
- Wired the Wave-6 modules: `towngen.js` lays out the towns, `citykit.js` places the CC0 kit with exact colliders, pads and corridors go through the
  height lattice; the kit GLBs (~2 MB) load only on Savanna and a failed GLB leaves identical colliders. A failed `towngen.js` / `citykit.js` import is
  retried once, then plays the old layout and reports `map.genVersion` honestly.
- **Squad version guard**: the room handshake carries `MAP_GEN_VERSION` (now 3; live is 2, a client without the export counts as 1). A guest whose
  version differs is refused with a "your game is out of date" message and a RELOAD PAGE button; same-version players are never refused, in either join
  order. Loot now settles on floors on all three maps, so Isla Viva and Deepwood loot positions differ from v2 too (the maps themselves are identical).
- **Bots in towns**: `navgrid.js` is loaded and baked on a fixed tick schedule (the same seed replays identically to the last tick, also under heavy CPU
  load); bots plan through town and compound tiles with door waypoints, loot is chosen by path cost, drop counts use compound loot; outdoors and on the
  other maps the old planner is unchanged, and a missing `navgrid.js` falls back to it with 0 errors.
- Kit collider table regenerated by the intake tool (`_tools/art_b_city.py`), deterministic; mid-match shader compiles fixed in the warmup.
- Gates: citycheck is now blocking for Savanna (200 seeds), perf_district, lootcheck, nancheck, navtown, kitcollide, warm_programs, squadguard_live,
  Savanna/Deepwood framecheck, layoutcheck, mobile and rigcheck; the kill-marker check guards its subject through the landing, the resource-leak check
  compares rounds on the same map, the rock-sprint row no longer judges a capsule held off a rock's box against a 14 cm pebble (no bar changed; the
  old build still fails it the same way); the chest-beacon row judges open-sky chests only (a roofed chest shows no beacon from the air, 63 % of
  Savanna's chests). Every changed row still fails its planted fault or the frozen build.

**Known and NOT fixed**
- Still thin: the skyline tops out near 54 m, compounds read as two houses on open grass, many buildings repeat the same brick look, haze washes out
  the 330 m drop view, interiors are empty (Wave 8). 2-3 downtown top-storey rooms per seed have no bot route and bots that land on a downtown roof stand
  about 10 s.
- Squad: pages from before this build have no guard: a new host leaves them out and a new guest refuses an old host, but a client whose `towngen.js`
  import fails twice builds the old layout while advertising version 3 (nothing listens for the fallback yet).
- Cost: on this slow test box the Savanna sim costs about twice live (12-18 s vs 5-6 s per match, ~0.36 ms per tick) and 11-13 frames over 50 ms occur
  against 1 on live (none over 100 ms; worst 63.6 ms); on two other seeds the new city adds more draw calls than the +40 bar at some cameras (seed 1:
  +57 / +37 / +35; seed 31337 endgame +42; absolute counts stay low: drop view 210-243 with actors). Phone-tier endgame triangles are x1.247 of the x1.25 bar.
- A real player.js window (6 mm between the wall test and the support test) lets 5 of 13,432 swept rock sprints walk 0.57-1.26 m into a rock; deepwood
  `framecheck` stays information; `towngen` link roads still cross water on Isla Viva (124 of 200 seeds) and Deepwood (157 of 200) - Wave 7b.

## 2026-10-13 (night) — Wave 6: the ground tells the truth, textured terrain, and the town toolkit (?v=1791946668)

Plan `_spec/world_2026-10/PLAN.md`, Wave 6 of 8. One player-visible lane (the ground) and three new modules that are NOT wired into the
game yet: the towns themselves are Wave 7.

**What players see**
- Textured ground: moss and pebbles on grass and rock, rippled sand, cracked asphalt on roads (four CC0 textures, 792 KB, no extra draw calls).
- Every house, hut, tower and landmark stands on a flat pad with no gap under a wall; doorways clear the player (minimum 2.39 m, was 1.16 m);
  ramps start at the floor; roads lie on the ground and no longer run into the sea; the thin dark crack at the Ashgrid chunk border is gone.
- Deepwood's steeple used to stand in the river; it now stands on a dry bank and the river pinches to a pond beside it.

| measured (5 seeds x 3 maps unless noted) | live before | now |
|---|---|---|
| placementcheck rows | 14 pass, 5 fail | 19 of 19 (and 19 of 19 on 15 fresh seeds, 1,539 structures) |
| drawn ground vs walkable ground, p99 | 0.012 / 0.037 / 0.023 m | 0.0000016 - 0.0000036 m |
| house / tower base edges more than 10 cm in the air | 85-93 % / 98-100 % | 0 % |
| pads flat within 1 mm | - | 679 of 679 |
| seeds with a town road under water (200 seeds) | 200 of 200 (Isla Viva, Deepwood) | 0 of 200 |
| draw calls (drop view, three maps) | - | unchanged (-7 to +7 is noise); 311 / 281 / 178 with actors, limit 450 |
| map build | - | lattice 1.48 MB, bake 77-101 ms; match load +0.8-1.0 s (one sample) |
| bot-match median length, 36 fresh matches | 721.1 s | 729.8 s |
| deaths in the first 60 s, worst match | 8 | 6 |

**Town toolkit (unwired, each tested alone)**
- `towngen.js`: street-grid towns, house clusters and compounds as pure data. 200 seeds x 3 maps: 0 failures; enterable buildings 97.3 / 93.0 / 99.7 %;
  every town at least 6 enterable buildings; same seed gives a byte-identical layout (600 of 600).
- `citykit.js`: places the CC0 city kit as instanced districts with exact quarter-turn colliders; identical colliders when every kit file fails to
  load; no leak over 3 dispose cycles; in a match +16 draw calls and +117k triangles at street level.
- `navgrid.js`: a layered nav grid for towns. Misses its own bars, named below.

**Gates**: ground-match now 1e-4 m (was 0.05), base-edges, doorway-clearance, roads-float and pads are blocking rows that fail on the live build; new
`perf_district`, `citykit_probe`, `citycheck` (information until Wave 7) and three module selftests; bootcheck's walk row retries after a quarter
turn when a random landing ends facing a wall (it failed 1 run in 12 on the live build too; a planted dead W key still fails all four headings);
the kill-marker pin now has a clear line of fire (the taller Ashgrid pad turned a fence into legitimate cover).

**Known and NOT fixed**
- Squad rooms have no map-version guard (`net.js` hello/start carry none): a guest on a stale page builds different ground from the host, so remote
  players can look floating or buried. Wave 5 had the same exposure; the guard is Wave 7's.
- `navgrid.js`: 13 of 360,000 checked segments are grid-walkable but blocked for the real mover (0.0036 %, bar was 0); the 8 ms tile bake is missed
  (building tiles 4.1 / 8.6 / 3.8 ms median, 17-32 ms at p90) and town memory is 0.29-6.1 MB against 1-2 MB. Fix before it is wired.
- `towngen.js`: link roads between towns still cross water on 124 of 200 Isla Viva and 157 of 200 Deepwood seeds; the endgame area has too little
  cover on Isla Viva and Deepwood (23.0 % and 41.5 % of seeds pass; endgame-cover is judged at the second-last circle and stays information-only).
- Storm circle 5 was reached in 31 of 36 fresh matches (live: 35 of 36; p about 0.10, not significant) - watch it. Bots dropped into the ocean never
  get out (Isla Viva seeds 33 and 34 exceed 2 % stuck on both builds). Isla Viva roads-float reads 0.74 % against the 1 % bar (thin margin);
  Deepwood fence boards float up to 0.99 m on 1 of 17.
- The two Wave-5 stairs on fresh seeds (Isla Viva seed 23, Deepwood seed 65537) are unchanged.

## 2026-10-13 (later) — Wave 5 leftovers closed: healers out of stair pockets, walkable stairs, level containers, solid rocks (?v=1791925742)

The four residuals named in the entry below are fixed and the full gate run is now all green: `gate.py --disk --negative-controls`
OVERALL PASS, 31 of 31 planted-fault controls caught (7 of them new).

| measured | live before this build | now |
|---|---|---|
| healers blocked indoors (navcheck heal-indoor, 9 matches) | 264 of 2285 ticks (11.55 %) | 0 of 3663 |
| ramp-pocket probe: healer placed beside / under every stair gets out within 2 s | 16.23 % | 98.69 % (2495 of 2528) |
| stairs walkable down (worldlive, 81 ramps) | 80 of 81 | 81 of 81 (up 80 of 80) |
| stairs failing a walk, 5 fresh seeds x 3 maps (420 ramps) | 21 walks on 14 ramps | 3 walks on 2 ramps |
| containers drawn leaning on a slope | 25, up to 8 degrees, clip p95 0.16 m | 0 (all level), clip p95 0.00 m |
| sprints ending inside the drawn mesh | 23 of 704 | 1 of 704 |
| rock sprints ending inside a rock (of 192) | 2 (16 under the old definition) | 0 |
| bot-match median length, 27 fresh matches | 729.5 s | 734.4 s |
| matches reaching storm circle 5 (of 27) | 26 | 25 |

- **Healers**: the retreat no longer picks a heading into a stair's side or underside, and a healer pinned twice walks out.
- **Stairs**: the Ashgrid stair that could not be walked down is fixed at its geometry; the same walk now passes on 5 more seeds per map.
- **Containers** are placed level; the low side is sunk instead of tipping the box (Ashgrid has 149 containers, was 162, because
  slope spots that cannot hold a level box are skipped). The world's other props, loot points and POIs are identical to the live build.
- **Rocks**: a low rock part beside a taller one no longer forms a two-step staircase into the tall box.
- **Gates**: four new rows (heal-pockets, ramps-walk-fine, container-lean, sprints-rocks), each failing on the live build and on
  Wave 4; the kill-marker hold is judged in game time (it flaked under load), the hud_cycle guard race is fixed, navcheck reads 9 matches.
  The rock-sprint definition now ignores hull-only overlaps with no drawn rock (checked independently: 0 of 192 real overlaps).
- Download +22 KB (maps.js, bots.js, the collider table).

Known and NOT fixed: two stairs on fresh seeds (isla_viva seed 23 at (-41.35, -30.8) cannot be climbed - same on the live build;
deepwood seed 65537 at (46.15, 39.2) lifts a sprinting player); a bot on isla_viva seed 23 holds still with no input for a while
(no gate row sees it); a deepwood bot stalls 2.3 s on seed 902 at (35.6, 6.6, 40.7) on both builds; outdoor-blocked sits at 0.92-1.06 %
against its 1.08 % limit on both builds; a client that fails to fetch the collider table now also differs in which containers exist.

## 2026-10-13 — World foundation: grounded props, real collision, bots that stop sticking (?v=1791894423)

Owner: "bots getting stuck in houses, they need better path finding, floating objects like trees or rocks, they need to be
grounded ... physics, collisions, placement." Decision: fix our own collision (axis-aligned boxes, no physics engine; a measured
engine cost 104-138 us per actor against 0.8-2.2 us). Plan: `_spec/world_2026-10/PLAN.md` (Wave 5 of 8; the city/town layout
and furnished interiors are Waves 6-8, not in this build). Built as four lanes plus a fix round, independently verified.

| measured (5 seeds x 3 maps unless noted) | before (Wave 4) | after |
|---|---|---|
| rocks floating / buried | 38-49 % / 22-29 % | 0 % / 0 % |
| stacked containers floating (uppers off the one below) | 92 % of 63, worst 3.33 m | 0 of 70, worst 0.05 m |
| other props floating more than 10 cm | measured per kind in `_harness/README.md` | 0.0 % (pine and one bush 0.1 %) |
| ground-vs-drawn-ground mismatch p99 | 0.28 m | 0.012-0.037 m |
| live sprints that end inside a palm / barrel / car (of 64) | 15 / 32 / 7 | 0 / 0 / 0 |
| collision sprints ending inside the drawn mesh, all kinds | 327 of 704 | 23 of 704 (3.3 %) |
| indoor bot ticks heading the wrong way while healing | 22.5 % | 0.40 % |
| indoor bot ticks blocked for 0.1 s or more while fighting | 20.5 % | 0.10 % |
| upper rooms bots can get into (of 83 / of 81) | 35 | 76 |
| ramps steeper than 45 degrees (375 ramps) | 91 | 0 |
| bot-match median length, 18 fresh matches | 663.9 s | 736.5 s |
| matches reaching storm circle 5 (of 18) | 8 | 15 |
| bot deaths in the first 60 s, worst match | 16 | 7 |

(The three pacing rows were measured one change before the last one - the healer walk-out below; `sim_pacing` 11/11 still passes after it.)

- **Grounding**: every prop kind sits on the drawn ground at its real anchor; container stacks rest on the container below;
  a hut chest takes the height at its own spot (it hung 0.70 m over a slope on deepwood seed 1).
- **Colliders**: baked per kind from the model files (`assets/props/prop_colliders.json`, `_tools/bake_prop_colliders.mjs`,
  deterministic: two fresh loads hash identically on all three maps, so squad clients still rebuild the same world);
  leaning trunks take their box from the scale of each tree.
- **Ramps and stairs**: a ramp is a 0.3 m sloped slab you can walk up from its low edge; its sides and underside block you and
  bullets only test the slab band. Landing on a stair no longer drops you through.
- **Bots**: wall-aware steering, routes to the top floor, no grinding on walls, a second pin while healing now walks the bot out.
  Pacing table retuned so the later circles are reached (bots hold and trade fire at range; sim-tested, not yet human-played).
- **Gates**: three new (`placementcheck`, `collisioncheck`, `navcheck`) plus `worldcheck` / `worldlive`; four gate definitions
  were corrected where they measured the wrong thing (table in `_harness/README.md`, every one still fails on the Wave-4 build).

Known and NOT fixed in this build (named, small, none worse than Wave 4): containers lean up to 8 degrees on slopes while their
box stays level (clip p95 0.15 m, 6 of 64 container sprints); rock stairs where a 0.4 m part sits beside a 1.07 m rock (16 of
192 rock sprints); one ashgrid interior stair at (221.75, 224) cannot be walked down (fails identically on Wave 4); a healer
tucked beside a tower stair on isla_viva seed 7 now frees itself after 2.45 s (was 11.7 s) - navcheck heal-indoor reads 10.4 %
on that one event against a 1.5 % bar. The full gate run on this tree is therefore not all-green: collisioncheck (clip,
sprints), worldlive (ramps-walk) and navcheck (heal-indoor) are red for the reasons above; everything else passed.

## 2026-10-12 — Look + feel pass toward the BridgeZone reference (?v=1791854656)

Owner: "I want Last Circle to look a little more like this" (a BridgeZone video) and "improve this game based on how well you
have been building games". Third-person stays (owner decision). Plan: `_spec/look_2026-10/PLAN.md`; evidence + before numbers:
`_spec/look_2026-10/wave4_wip/`. Built as nine file-disjoint lanes, independently verified, then the full gate suite
(`_harness/gate.py --disk --negative-controls`) on this exact tree: every gate PASS and all 15 planted-fault controls caught.

| measured | before | after |
|---|---|---|
| download to first match | 24.3 MB | 16.3 MB |
| drop-cluster draw calls | 175 | 127 |
| ground-view draw calls (isla_viva) | 130 / 135 | 107 / 83 |
| KB allocated per frame | 96.5 | 66.9 |
| median bot-match length | 320 s | 701 s |
| bot deaths in the first 60 s (median / worst) | 16 / 21 | 2 / 9 |
| matches reaching storm circle 5 | 0 of 9 | 8 of 9 |
| camera ending inside a wall (pull-in off vs on) | 3,857 | 0 |
| death falls | 1 | 7 (Mixamo, seeded pick by hit direction) |

- **Storm you can see**: a lavender wall with falling streaks and a brighter ground band (ground delta 21.7-26.7/255, was a faint
  cast), purple lightning, and a hazy purple-grey grade while you are inside it.
- **Loot**: rarity-coloured light beams (clamped under roofs) and glowing floor rings, as instanced draws (3 extra calls total).
- **Sky**: baked-texture clouds (sprite clouds deleted, same seeded world), altitude-scaled fog, steel-blue sky/water. The
  exposure/darker-albedo option ("step B") is NOT shipped; the A/B sheet is for the owner to judge.
- **HUD** restyled inside the signed-off anchors: big HP number with segmented shield/health bars, weapon card (rarity, AUTO/SEMI,
  ammo), "Circle N of 8" storm card, kill feed with gun silhouettes, a top "Eliminated #N" banner, and a standings table with
  "Run it back" / "Find a new match" (random map). The landing marker no longer lingers after touchdown.
- **Camera**: pulls in when a wall blocks it and eases back out; it never rotates (pure dolly; reticle stays centred).
- **Characters**: a faint cool rim light so dark skins stop reading as black cut-outs (green for squad allies); gun hidden under
  the parachute; ram-air canopy replaces the half-sphere; animation files loaded once instead of five times.
- **Effects**: hit sparks, muzzle flash and tracers are soft textured quads, not cubes. Muzzle flash re-tuned after measuring: its
  brightest pixel was 8.1-8.4x the surface behind it (glare bar is 8x). The three muzzle sparks made up ~0.5 of a ~1.3 peak, so they
  now have their own dimmer style row; the check reads 2.6-4.1x over five runs with the same look.
- **Low graphics tier** draws straight to the screen (no post-processing composer): -13 textures, -5 programs.
- **Bot pacing**: pacing table (notice/chase/push ranges, landing separation, endgame from circle 5) and the storm timeline
  x1.12, so matches reach the late circles. Quick mode keeps legacy pacing.
- **Decoders**: wasm Draco decoder with the JS decoder as fallback, and a lazy meshopt decoder for the town kit.
- **Staged, not used yet**: the Kenney city kit (81 types with baked colliders), cars, road/ground textures. The towns themselves
  are Wave 7.
- Gate scripts under `_harness/new/`; four stale harness locators fixed (the post-match button is now "Run it back").

## 2026-10-01 — Built to the DYEFIELD / BLOCKTOOTH bar (?v=1790866476)

Owner: "Improve this game based on how well you have been building games — ie DYEFIELD and
BLOCKTOOTH." An 8-lane audit (`_spec/improve_2026-09/*.md`, plan in `PLAN.md`) measured Last Circle
against those two builds, then three build waves landed it, each re-checked by an independent
verifier in a real browser. Before numbers: `_spec/improve_2026-09/baseline/`.

| measured | before | after |
|---|---|---|
| drop frame 1 triangles / character-shadow triangles | 9.91 M / 8.57 M | ~0.87 M / 0 |
| drop-cluster draw calls | 482 | 175 |
| shader programs compiled on the first drop frame | 27 | 0 |
| lobby -> drop after pressing Enter | 4.3-9.2 s | ~0.04 s |
| forced layouts per frame | 1.00 | 0.00 |
| KB allocated per match frame | 554.5 | 77 |
| lobby textures over 3 matches (PLAY AGAIN leak) | 44 / 86 / 177 | 132 / 132 / 132 |
| SMG fire rate | 600 rpm at 60 Hz | 720 at 20-165 Hz |
| jump height at 20 vs 144 fps | 1.19 vs 1.356 m | identical |
| pistol share of gun kills / bot lives ending on pistol | 60.2 % / 74.8 % | ~17 % / ~33 % |
| bots holding a pistol while carrying better | 24.4 % (Wave 1) | 2 % |
| isla_viva bot stuck time | 12-27 % | < 1 % |
| same seed replays identically | no (diverged ~25 s) | yes |
| [rig] + animation-binding warnings per load | ~235 | 0 |
| cdn.jsdelivr.net blocked | game never starts | boots (three r172 vendored) |
| phone: look / move / fire / loot | none (camera could not turn) | 48/48 on Pixel 7, iPhone 14, SE, iPad |

- **Characters**: bodies were 245k-632k triangles (DYEFIELD's budget is 12k). `_tools/char_lod.py`
  regenerates ~15k LOD0 + ~2.5k far LOD1 with attribute-aware decimation; the stock simplifier
  garbled faces, so faces/hands were checked by eye on all five bodies.
- **Frame pipeline** (the owner-approved BLOCKTOOTH approach): fixed 1/60 tick with an interpolated
  view, ResizeObserver-cached size, DPR cap 1.5, shader warm-up under the loading screen,
  `?prof=1` frame profiler, mixer LOD, near-only shadows, one instanced draw for parachutes and one
  atlas billboard for name tags. Online squad play runs the same tick (two-client sync measured
  equivalent to the old stepping; it also stops a 144 Hz player out-jumping a 30 Hz one).
- **Death animations**: two of the three death clips carried an FBX Armature root, so 13 of 21
  corpses were placed ~94 m away (they "vanished"). Rebased; those two clips also turned out to be
  fall-and-recover, so every corpse uses the true death clip for now. Real variety needs new clips.
- **Boot**: a head guard that never overwrites a failure, named failures with one auto-retry,
  WebGL2/sitelock checks before the engine import, a failed match load returns to the menu.
- **Phones**: native touch layer (stick, look, FIRE/JUMP/RELOAD/USE/ADS/PAUSE, aim assist only
  while firing), touch HUD mode, rotate overlay; the "desktop only" cards are gone.
- **Feel**: one accumulating damage number per victim, kill-latched hit marker, readable reticle,
  HUD collisions fixed, music ducks once per engagement, voice cap 24.
- "VICTORY ROYALE" (Epic Games' trademarked phrase) now reads "LAST ONE STANDING".
- **Gates**: `_harness/gate.py --disk` runs every browser gate (bootcheck, bootguard, rigcheck,
  playtest, portalcheck, framecheck, leaktest, feelcheck, layoutcheck, mobile, probe_match,
  lifecycle) — Node selftests never execute runtime/3d, which is how view crashes used to ship.

## 2026-07-21 — Firing a gun moved nothing on screen, and frame order ate the first kick (?v=102)

Game-feel pass from the Final Drop benchmark. The INFORMATIONAL feedback layer
was already ahead of the benchmark — coalesced damage numbers, the announcement
queue, threat arrows, the death recap — but the PHYSICAL layer was absent:
`camShake =` existed in exactly two places in the whole codebase (explosion,
player hurt), neither of which is your own gun. At the SMG's 720 rpm you pulled
a trigger every 83 ms and nothing on screen moved.

- **SHOT KICK AND FOV PUNCH.** fx.js:94-95 now carries per-weapon tables —
  camShake 0.045 smg / 0.06 pistol / 0.07 ar / 0.18 glauncher / 0.20 shotgun /
  0.26 sniper, FOV punch 2-5° — raised in the shotFired handler and gated on
  `a === W.player`. That gate is mandatory, not defensive: shotFired is the
  GLOBAL event and all 49 bots fire through it (audio.js gates the same way), so
  an ungated kick would shake your camera on every gunshot on the island.
- **THE FRAME ORDER ATE MOST OF THE KICK — this is the trap to remember.**
  ffg_royale3d.js:501-505 runs player (which is where the camera reads camShake)
  → weapons (which emits shotFired, which raises it) → fx. A kick raised on frame
  N is therefore not READ until frame N+1, and the decay used to run
  unconditionally in between. Measured against the shipped constants: at 60 fps
  an SMG's 0.045 reached the camera as 0.015 — 67% eaten — and at 20 fps the
  decay term dt*1.8 = 0.09 is LARGER than every pistol, SMG and AR kick in the
  table, so on a slow machine those three weapons would have rendered no shake at
  all. The explosion (up to 0.5) and hurt (0.12) shakes have always lost that
  same frame; they were simply big enough to hide it. The decay now belongs next
  to the camera that consumes it.
- **HITSTOP IS SOLO-ONLY, AND THAT IS DELIBERATE.** W.hitstopT (0.05 on your own
  kill, 0.03 on a headshot, 0.07 inside an 8 m explosion — fx.js:229/244/267)
  scales the frame step to 0.12 at ffg_royale3d.js:493, but only when `!W.net`.
  net.js broadcasts own-actor state at 12 Hz and the host swaps a silent guest
  for a bot after 12 s without state, so slowing the sim on one client drifts it
  off the link and reads to everyone else as a dropout. hitstopT is decremented
  with the REAL dt, so the freeze is the same wall-clock length whatever scale is
  applied. Do not "improve" this into a shared slowdown.
- **THE HIT FLASH MULTIPLIES THE SAVED COLOUR — never lerp it toward white.**
  player.js's `BODY_GAIN = 3.2` (:240 today) multiplies every actor's base colour,
  so those channels sit well above 1; blending toward (1,1,1) would DARKEN a hit
  actor, which is the opposite of a flash. fx.js:426-431 copies the saved colour
  and scales it UP (×(1 + 1.1k) over 70 ms, with the shield-blue / health-red
  split the hurt particles already use). Emissive stays off-limits for the reason
  recorded in the comment block above BODY_GAIN — Meshy's emissiveMap was
  stripped because it re-lit the cast fullbright in shade.
- New `lc_settings` key: **`shake`**, default 1, clamped to 0-1 on load
  (ffg_royale3d.js:561 and :574), multiplied into camShake at player.js:1256.
  Camera shake is a motion-sickness accommodation the same way FOV is, so 0 has
  to be reachable — the clamp deliberately avoids `|| 1`, which would bounce a
  stored 0 straight back to full. That is the same persistence trap that left a
  0 sensitivity slider bricking mouse-look on every future launch.

Verified: every number above is quoted out of the shipped files as they stand
(fx.js SHOT_SHAKE/SHOT_FOV, the module order at ffg_royale3d.js:500-505, the
`!W.net` gate at :493, the clamp at :574), and the 67% / 100% figures are that
decay rate applied to those kick magnitudes at 60 and 20 fps. Sim selftest 96/96.

Open, NOT fixed here: camShake is currently decayed in TWO places — player.js
immediately after the camera reads it, and fx.js:460 behind a `shakePrev` guard
that skips the frame the value rose. Two independent fixes for the one ordering
trap landed in the same wave, so on any frame where the shake does not rise it
decays at 3.6/s instead of 1.8/s and a kick rings roughly half as long as either
author intended. Both are correct alone; one has to go, and the one to keep is
player.js's, because the camera is the consumer. This pass owned CHANGELOG.md
only, so it is flagged rather than repaired. DRAFT.

## 2026-07-21 — Bot grenades always fell short, and stuck-detection was dead code (?v=91, LIVE)

Two bot defects from the full-game sweep.

- **BOTS AIMED AN ARCING WEAPON ALONG A STRAIGHT LINE.** bots.js computed a flat
  firing solution with no arc term anywhere in the file, while weapons.js
  launches the grenade launcher at speed 26 with gravity -18 and a +3 vertical
  boost. Measured against the game's own integration, a flat aim lands at 8.56 m
  NO MATTER the target range — 25 m short at 34 m. Every bot holding a launcher
  was harmless.
- Now solved properly. The textbook ballistic formula is WRONG here because of
  that +3 launch boost: solving without it overshot by ~8 m at every range
  (measured, before I shipped it). The solver bisects on a closed-form range that
  includes the boost — no integration loop, 24 cheap iterations, run on the
  think cadence.
- **STUCK-DETECTION COULD NEVER FIRE.** The test read `inp.mz || inp.mx`, but
  those are zeroed 13 lines above it and only set by the state switch BELOW it,
  so the `&&` never held, stuckT never accumulated, and a bot that walked into a
  wall ground against it for the rest of the match. The test now runs after the
  state has expressed its movement intent.

Verified live against the shipped launch parameters: level shots land 11.90 /
19.91 / 27.94 / 33.98 m for 12 / 20 / 28 / 34 m targets, uphill (+3 m, +6 m) and
downhill (-3 m, -5 m) all within 0.95 m, versus a flat aim's fixed 8.56 m.

(My first verification of the uphill case reported a 19 m error — that was the
TEST terminating on `y <= dy`, which is true throughout the ascent. Corrected to
"crosses the target height while descending".) Selftest 89/89. DRAFT.

## 2026-07-21 — Ammo eaten at cap, and no gun after your last bandage (?v=89, LIVE)

Two inventory defects from the full-game sweep.

- **AMMO BOXES AT THE RESERVE CAP WERE DESTROYED AND ANNOUNCED AS A PICKUP.**
  give() clamped the reserve and returned true regardless, so pickup() marked
  the box taken and deleted it while the HUD flashed "PICKED UP MEDIUM AMMO" —
  you watched ammo you could not carry vanish off the floor, and it was gone for
  the rest of the match. The correct predicate already existed in wouldAccept()
  two functions above; only bots ever consulted it. give() now refuses, so the
  box stays put until you have spent some rounds.
- **USING YOUR LAST BANDAGE LEFT YOU UNABLE TO SHOOT.** The slot is emptied at
  the START of the heal channel, but nothing re-equipped, so a.weapon still read
  "consumable:<id>" with a slotRef pointing at an orphaned object — the next
  click routed straight back into useConsumable, which returned false. The human
  was stuck holding nothing until they thought to press a number key. Bots
  recovered through ensureGunOut; the human had no equivalent. Emptying the
  ACTIVE slot now auto-equips the first gun you are carrying.

Verified live: an ammo box at 240/240 is refused and wouldAccept agrees with
give (planner and taker consistent), while below cap it is accepted and clamps
to 240; using a 1-count bandage empties the slot and moves the active slot from
3 to 0 holding the AR, ready to fire. Selftest 89/89. DRAFT.

## 2026-07-21 — "50 distinct opponents" was 10 clones of each skin (?v=88, LIVE)

From the full-game sweep, and confirmed by measuring before touching anything.

- The per-actor variety tint was `color.offsetHSL(hue, 0.02, +/-0.07)`. Every
  Meshy GLB ships a baseColorTexture with NO baseColorFactor, so material.color
  starts at pure white (H0 S0 L1) and an offset from L1 clamps. MEASURED across
  the ten actors sharing the soldier skin: #ffffff, #fbfbfb, #fcfcfc, #fefefe,
  #f8f8f8, #fdfdfd, #faf9f9 — the darkest was 97.3% white. Ten identical
  soldiers, and the same for every other skin.
- baseColor MULTIPLIES the texture, so the tint has to be an actual colour
  rather than a nudge away from white. Now setHSL across the full hue wheel at
  sat 0.38-0.58 / lightness 0.60-0.78.
- Tuned by RENDERING it, not by reading the numbers: the first attempt (sat
  0.16-0.30, lightness 0.82-0.94) produced hex values that differed but actors
  that still looked identical on screen. The capture is what rejected it.

Honest scope: this is a subtle per-actor WASH, not dramatic team colours. The
uniform is dark olive and a pale tint multiplied against dark fabric stays dark,
so the separation reads most on skin and light fabric. Real at-a-glance identity
would need per-skin accent materials, which is an asset job, not a code one.

Verified live: five actors sharing the soldier skin now carry #e2afeb / #c6e9ef
/ #e8e9b7 / #efd7e6 / #f3f0cf and are visibly distinct in a render.
Selftest 89/89. DRAFT.

## 2026-07-21 — The jump animation never played, and the crouch freeze was undone (?v=86, LIVE)

Two animation defects from the full-game sweep, both verified against the actual
shipped GLB rather than taken on trust.

- **THE JUMP CLIP SHOWED ONLY ITS STANDING LEAD-IN.** Decoding
  soldier_jump.glb directly: Meshy's "Basic_Jump" runs 5.93s and the Hips
  translation sits flat at baseline Y 94.7 until t=1.73s, peaking at 253.0 at
  t=2.07s. The game's airtime is 2*jumpV/|gravity| = 2*7.8/22 = 0.709s and the
  clip was played from t=0 — so ONE HUNDRED PERCENT of every visible jump was
  the clip standing still, and the character never appeared to leave the ground.
  playAnim gained a `startAt` seek and jump now begins at t=1.70.
- **THE ?v=51 CROUCH FREEZE WAS BEING UNDONE ONE CALL LATER.** playAnim's
  falsy-zero fix was real, but the vendored kernel's play() then did
  `setEffectiveTimeScale(opts.timeScale || 1)` — the same bug one layer down —
  which only bites when the clip CHANGES, i.e. exactly when you crouch from
  standing. So a stationary crouching player still marched in place. FIXED AT
  THE GENERATOR as well (pipeline/engine/runtime/3d/ffg_kernel_3d.js); 14 games
  vendor a copy of this kernel.

That is the third falsy-zero timeScale of this session (player.js ?v=51,
hud.js ?v=73, kernel here) — same pattern, three layers.

Verified live: crouching from standing leaves the crouch action at timeScale 0
(genuinely frozen); the jump action starts at t=1.70 of a 5.93s clip, so the
0.709s of airtime shows 1.70 -> 2.41 and covers the peak at 2.07.
Selftest 89/89. DRAFT.

## 2026-07-21 — Sound came from the wrong ear, and bullets hit in silence (?v=85, LIVE)

Two audio defects from the full-game sweep.

- **POSITIONAL AUDIO PANNED BACKWARDS.** audio.js derived the camera's right
  vector as `(fwd.z, -fwd.x)` — the exact NEGATION of the right vector the rest
  of the game uses (sim.moveBasis: fwd (-sin,-cos), right (cos,-sin), i.e.
  `(-fwd.z, fwd.x)`; player.js builds its shoulder offset from the sim's
  version). Every positional sound therefore played in the WRONG EAR at every
  heading — gunfire actively told you to look the wrong way, which in a battle
  royale is worse than no positional audio at all.
- Same three lines: the horizontal projection was not normalised, so looking up
  or down shrank fwd's xz length and silently flattened the pan toward centre.
- **BULLET IMPACTS WERE ENTIRELY SILENT.** weapons.js emits four impact surfaces
  (flesh / stone / wood / dirt) and only fx.js listened — for the visual. In a
  shooter the impact is how you learn you MISSED and what you hit instead; rounds
  cracking off a wall beside you are the texture of a firefight. Now voiced,
  short and quiet so full-auto does not become a wall of noise, with flesh left
  to the hitmarker that already owns "you hit them".

Verified live: replicating the shipped pan maths against the sim's canonical
right vector gives +0.8 for a source on your right at yaw 0 / 1.57 / 3.14 /
-1.05 / 2.40 and -0.8 on your left (the sweep measured -0.800 for a right-hand
source before this), and looking up or down no longer flattens it. The impact
listener count is now 1 where it was 0.

Honest limit: a synthetic browser tab cannot start an AudioContext without a
user gesture, so what is verified is registration and the pan MATHS, not audible
output. Selftest 89/89. DRAFT.

## 2026-07-21 — REGRESSION FIX: every match after the first was lit wrong (?v=83, LIVE)

Two lighting defects the full-game sweep caught. The first is mine, from ?v=58.

- **Stale sun target.** ?v=58 made the shadow volume follow the player and
  captured the sun's DIRECTION per match as
  `sun.position - sun.target.position`. But `sun.target` was never reset — it
  sat wherever followShadow parked it at the end of the previous match. The
  sweep replayed the shipped storm math over 3000 seeds and put the final circle
  a median 178 m from origin, which turned the intended ~50deg near-noon key into
  a median ~31deg raking light pointing in a random compass direction, and in
  5.8% of matches pushed the focus past the shadow camera's 400 m far plane so
  the match rendered with NO shadows at all. Correct only on the first match of
  a session. The target is now reset to origin before the direction is taken.
- **The menu never got its tone mapper back.** A match sets NoToneMapping for
  its bright-daylight look (maps.js) and the menu restored only the EXPOSURE, so
  from the second visit onward the cinematic menu rendered unlit. It now restores
  ACESFilmicToneMapping too.

Verified live across four consecutive matches, walking the player far from
origin each time so a stale target would show: sun elevation is 50.2deg every
match with a spread of 0.00deg, while the shadow target still tracks the player
to a different place each match (460,-340 / 520,-380 / 580,-420). Tone mapping
reads 0 (None) in a match and 4 (ACESFilmic) once back in the menu.
Selftest 89/89. DRAFT.

## 2026-07-21 — The two screens that END every match had unclickable buttons (?v=82, LIVE)

The full-game sweep's headline finding, and the worst thing it found.

- Pointer lock is requested on any canvas click (player.js:425) — i.e. the first
  time you shoot. It was released in exactly TWO places in the whole runtime:
  showMenu and togglePause (grep for exitPointerLock returned 2 hits). Neither
  showDeath NOR showPostMatch released it. While pointer lock is held every mouse
  event is delivered to the locked canvas, so the buttons on the death screen
  ("MATCH STATS") and the post-match screen ("PLAY AGAIN" / "MAIN MENU") could not
  be clicked at all. The player had to guess that Esc frees the mouse; nothing
  said so. Those are the two screens that terminate EVERY match.
- Now released by one helper on every overlay the player is expected to click:
  the death screen, the post-match screen, drop select (you choose your landing
  zone by clicking the map), the how-to card, settings, and the online lobby.

Verified live by instrumenting document.exitPointerLock and driving a REAL death
through hurtActor: the death screen releases it (with MATCH STATS present),
endMatch's post-match screen releases it (PLAY AGAIN + MAIN MENU present), and
drop select releases it (map canvas present).

Honest limit: a synthetic test cannot ACQUIRE pointer lock — the browser
requires a real user gesture — so what is verified here is that the release now
fires on those paths, plus the source fact that it previously did not fire at
all. Selftest 89/89. DRAFT.

## 2026-07-21 — E-swap silently destroyed a consumable stack (?v=81, LIVE)

Found by the full-game sweep. Straight data loss.

- The E-swap branch dropped the outgoing item only `if (old.kind === "weapon")`,
  but the overwrite on the very next line was unguarded. So pressing E on a floor
  gun while a CONSUMABLE stack was the active slot replaced the stack with the
  weapon and never spawned it — up to 15 bandages, 6 mini shields or 3 medkits
  gone, with no drop and no warning. The swap branch is reached exactly when you
  are full, which is the normal mid-match state.
- Now the outgoing item is dropped whatever it is, stack count intact.

Verified live: with 15 bandages active and a full inventory, E-swapping onto a
floor sniper puts the sniper in the slot AND leaves a 15-count bandage stack on
the ground (count preserved exactly); swapping while a weapon is active still
drops that weapon. Selftest 89/89. DRAFT.

## 2026-07-21 — REGRESSION FIX: the ?v=64 gun cap froze every bot's loadout (?v=80, LIVE)

Caught by the full-game sweep, and it was mine: a side effect of the carry cap
shipped this morning, not a pre-existing bug.

- ?v=64 moved the 3-gun cap into give() so it applied to bots as well as the
  human. But bots have NO swap path — grep for "swap" across the runtime returns
  only the human's E-swap call sites — so once a bot held three guns (the
  starter pistol from spawn plus the first two it touched) wouldAccept refused
  every weapon forever and pickLoot skipped them entirely. About a minute into
  every match, 49 of 50 arsenals were permanently frozen: chest rolls that are
  55% rare-or-better were wasted, and supply drops — the game's only legendary
  source and its one deliberate contested-POI event — were contested by nobody.
  The endgame got EASIER the longer a match ran, which is backwards.
- Bots may now trade UP at the cap: the worst gun is dropped for a clearly
  better one. The human is untouched — walking over a gun at the cap still
  refuses, and E-swap still swaps the ACTIVE slot.
- **A second bug found while verifying the first:** picking the "worst" gun by
  sustained DPS nominated a LEGENDARY SNIPER (35 rpm) over a common SMG, so a
  bot would have thrown away the best gun it will ever find for a common pistol.
  Worst is now rarity-first, and a trade may never go DOWN in rarity.

Verified live: a bot capped on three commons takes a legendary sniper and stays
at three; a bot holding a legendary sniper REFUSES a common pistol and keeps the
sniper; a same-rarity upgrade (AR over shotgun) still trades; the human is never
auto-traded by walkover and E-swap still works at the cap. Selftest 89/89.
DRAFT.

## 2026-07-21 — Emotes now reach the people you are playing with (?v=78, LIVE)

- Online play has no voice and no text chat, so the two emotes ARE the
  communication channel — and they were never relayed. A friend waving at you
  from a rooftop simply did not happen on your screen. The "emote" event was one
  of the handlers-with-no-listener found earlier today.
- Relayed both ways now, following the same shape as the existing gunfire relay:
  only locally-simulated actors broadcast, and peers replay through the SAME
  playback path the local emote uses, so a remote wave looks identical to yours
  rather than being a second, subtly different system.
- **A hazard caught during verification:** my first version stored
  `a.emoting = "cheer"` (a bare string) while the local path stores `{t: 4.2}`
  and stepActor does `a.emoting.t -= dt`. netRemote actors skip stepActor, so it
  tested clean — but this game deliberately hands a slot back to a BOT when a
  peer disconnects, and that bot WOULD run stepActor and throw on a string in
  strict mode. Now the same {t} shape, and the takeover case is asserted.

Verified live: emoting locally fires the event net.js relays; a peer's emote
plays on their actor with anim "cheer" and the matching {t} shape; and flipping
that peer to a bot mid-emote runs 10 frames of stepActor with NO throw, the
timer correctly ticking 2.40 -> 2.23. Selftest 89/89. DRAFT.

## 2026-07-21 — Sprint was free, so walking was pointless (?v=76, LIVE)

A DELIBERATE BALANCE CHANGE, not a bug fix — stating that plainly because it
changes how every fight and all 49 bots behave.

- The movement spread penalty was a flat 1.4x for any speed over 1 m/s. Walking
  and sprinting therefore cost EXACTLY the same accuracy, so sprint was free and
  plain walking was a strictly dominated state: there was never a reason to
  choose it. (Crouch, added in ?v=49, made that worse by giving a third option
  that beat walking outright.)
- The penalty is now graded by actual speed: still 1.00x, crouch-walk pace
  (~2.7 m/s) 1.20x, walk (6.0) 1.45x, sprint (9.6) 1.72x, capped at 1.8x. Walking
  is now the deliberate middle option it was always supposed to be, and closing
  ground at full sprint costs you the first exchange.
- The first-shot-accuracy test used an exact `movePen === 1` compare, which a
  continuous penalty would have broken silently; it is now a speed tolerance
  (< 0.6 m/s), so a slow creep keeps the bonus.
- Cheap to do safely only because ?v=73 had already collapsed fire() and the
  reticle onto ONE model — the crosshair picked this up for free and shows it.

Verified live: reticle scale still 1.18 / walk 1.55 / sprint 1.77, with
crouch-walk at 0.97; sim spread agrees at 2.175deg walking vs 2.58deg sprinting.
7 new selftest assertions pin the curve and its cap (89 passing, was 82).
DRAFT.

## 2026-07-21 — First-run onboarding (?v=75, LIVE)

- There was no onboarding of ANY kind. This is a browser BR: it gets opened cold
  from a link, with no install, no manual and nobody to ask. Several verbs were
  simply undiscoverable — the parachute redeploy, crouch, and both emotes (which
  appeared in no control surface at all until ?v=67).
- A first-run HOW TO PLAY card now opens once, listing the eleven things that are
  not guessable, and explains the two mechanics a new player will otherwise
  misread: that SHIFT is a toggle, and that the reticle grows when shots will
  scatter. Dismissal is remembered, and the card is reachable any time from the
  menu.
- Deliberately NOT a forced tutorial or a scripted first match — one screen and a
  button. A player who already knows battle royales loses two seconds.

Verified live: first run auto-opens with all 11 key rows and the SHIFT-toggle,
crouch and emote lines present; GOT IT dismisses it and stores the flag; a second
showMenu does NOT auto-open it; the menu button re-opens it on demand.
Selftest 82/82. DRAFT.

## 2026-07-21 — You were locked to your killer's camera (?v=74, LIVE)

- On death, spectating was pinned to whoever killed you and only ever moved on
  when THEY died. With friends in the room that is the worst possible default:
  you sit watching the stranger who shot you while your friend is still playing.
- A / D (or the arrow keys) now step through the survivors, and a readout shows
  who you are watching, how many are left, and the keys. The initial pin to the
  killer is kept — that first moment is worth seeing — it is just no longer a
  cage. Dummies are excluded, so the practice range never appears in the list.

Verified live after a real death (driven through hurtActor): spectating starts
on the killer, D steps s2 -> s3 -> s4, A steps back to s3, the camera focus
follows each change, every target is alive, and the bar reads
"SPECTATING HIGHGROUNDHERA · 49 ALIVE · [A] / [D] TO SWITCH". Selftest 82/82.
DRAFT.

## 2026-07-21 — The crosshair now tells the truth (?v=73, LIVE)

The item the earlier synthesis called "the highest-value one not in the twelve",
and it turned out to be quietly hiding work shipped earlier today.

- fire() computed spread inline; the crosshair guessed with a DIFFERENT, cruder
  formula that knew only `moving` and `ads`. So the reticle never showed:
  crouch (the 38% tighter cone sold in ?v=49 — byte-identical to standing on
  screen), airborne (a 2x penalty), rarity, first-shot accuracy (0.15x, the
  single biggest term), or even the weapon's own base spread — a shotgun (4.0deg)
  and a sniper (0.15deg) drew the SAME reticle. The player was never shown when
  they were accurate.
- Both now read one shared sim.effectiveSpread(). 16 new selftest assertions pin
  the exact behaviour fire() had before the extraction, term by term and in
  combination, so this stayed a refactor and not a balance change (82 passing,
  was 66).
- Rejected on purpose, per the original review: the ADS-settle half of that
  proposal. It is a sniper balance change wearing a HUD fix's clothes and it
  would retune 49 bots.
- **Found while verifying:** my first version wrote `p.lastShotT || -9`, which
  treats a legitimate lastShotT of 0 as missing — so every shot looked like a
  first shot. Same falsy-zero class as the playAnim timeScale bug fixed earlier
  today. The verification caught it because the first-shot reticle and the
  spraying reticle came back identical.

Verified live, reticle scale per state: AR first shot 0.47 vs spraying 1.18;
crouched first shot 0.43; airborne+moving 2.66 vs moving 1.50; shotgun 2.55 vs
sniper first shot 0.40. Selftest 82/82. DRAFT.

## 2026-07-21 — Reload progress + kill attribution names the weapon (?v=71, LIVE)

- **Reload had no progress UI at all** — just the word "RELOADING…" in the ammo
  readout — while healing and chest-opening both show a filling bar. A 4-second
  shotgun reload with no sense of how far along you are is the difference
  between pushing and dying. Added a bar under the crosshair.
- **Kill attribution threw the weapon away.** The kill feed was handed a
  weaponId and built "killer ⚔ victim" without it, and the death screen printed
  the RAW INTERNAL ID — "by CoachCarter (glauncher)". The one place a player
  learns what killed them showed them a variable name. Display names now live in
  sim/royale.js next to the weapon table (WEAPON_NAMES + weaponName()), so the
  feed, the death screen and anything added later share one source.

Verified live: sim maps the six ids plus "storm" to Pistol / SMG / Assault Rifle
/ Shotgun / Sniper / Grenade Launcher / the Storm; the feed row reads
"You ⚔ CoachCarter · Grenade Launcher"; the reload bar is hidden before, fills
0% -> 50% -> 90% across a 4 s shotgun reload, and hides again on ready; and a
real death (driven through hurtActor, not a synthetic event) reads
"#50 of 50 · by CoachCarter (Sniper)". Selftest 66/66. DRAFT.

## 2026-07-21 — Swimming ignored every collider (?v=70, LIVE)

- The swim branch integrated straight into position — `a.pos.x += a.vel.x * dt`
  with no collision test at all, while the ground branch right below it does an
  axis-separated blockedHoriz check. So you swam THROUGH the shipwreck hull and
  through piers, and solid geometry simply did not exist in water.
- Now uses the same axis-separated test. The probe height is raised 0.45 m,
  which widens blockedHoriz's built-in step allowance for a swimmer: a low deck
  near the waterline stays something you can haul out onto, while a hull stops
  you dead. (blockedHoriz already ignores colliders whose top is within STEP_UP,
  so this is a nudge to that existing rule, not a new mechanism.)

Verified live against the real shipwreck hull on isla_viva (15.1 x 18.2 x 3.2 m,
minX 462.44): starting 5 m outside and swimming into it travels 4.55 m and stops
at x 461.99 — 0.45 m short, exactly the player capsule radius — and never enters
the box. Control in the opposite direction covers 9.54 m freely, so swimming
itself is untouched. Selftest 66/66. DRAFT.

## 2026-07-21 — Loot proximity queries were an unindexed full scan (?v=69, LIVE)

- nearby() walked EVERY item and EVERY chest, hypot'ing each one, on every call.
  Bots call it once per frame while looting (bots.js actLoot) on top of a 90 m
  planning query per think, and early in a match dozens of bots are looting at
  once. Now a spatial hash over loot (24 m cells), the same technique maps.js
  already uses for colliders, so a query only touches the cells inside its
  radius. Distance compares are squared, with one sqrt per surviving candidate.
- Items are indexed on spawn (including runtime drops via dropItem) and the grid
  clears with the rest of the loot state between matches.

Verified live: a query centred exactly on each indexed item finds it (0 misses),
and cell-boundary offsets in five directions all still find it (0 misses) —
those are the two tests that are NOT circular. Sorted nearest-first order is
preserved, which callers rely on. Measured cost after the change: 2.4 µs for the
per-frame r=2.4 query and 14.9 µs for the r=90 planning query.

Honest limits of this measurement: I did not keep a before-number for the old
full scan, so no speedup FACTOR is claimed here — the argument is structural
(cells within the radius instead of every entry) plus the absolute costs above.
Two earlier verification attempts also produced false "mismatch" counts because
the reference set was built from nearby() itself at y=0, and nearby() applies a
|dy| < 4 filter — so the reference silently excluded everything not near sea
level. Selftest 66/66. DRAFT.

## 2026-07-21 — SHIFT toggles sprint on and off (?v=68, LIVE)

Owner direction: "Make SHIFT click activate sprint/run, on and off."

- ?v=67 added a HOLD/TOGGLE option but defaulted to HOLD. TOGGLE is now the
  DEFAULT: one press starts running, another stops it, and you never hold the
  key down. HOLD is still available in Settings for anyone who prefers it.
- The latch clears when you stop moving forward, so you cannot wander back into
  a fight still sprinting from three minutes ago with no way to notice, and it
  is cleared with the rest of the input state between matches.

Verified live through the real frame path (input rebuild + world step): walking
covers 5.32 m in one second, one SHIFT press with the key RELEASED covers
8.51 m with input.sprint true, a second press returns it to 5.32 m, and
releasing forward clears the latch.

(Note for future testing: the input struct is rebuilt inside the KERNEL's
updater list, so calling player.update() directly does not exercise the
keyboard path at all — the first two attempts at this verification measured
walking three times and then measured a stale latch left on by the attempt
before. Drive kernel._updaters and zero the latch first.)

## 2026-07-21 — Accessibility + control settings (?v=67, LIVE)

Four UX findings from the gap scan, all of them table stakes for the genre.

- **Field of view had no control at all** — hardcoded 57 (70 sprinting). An FOV
  slider is both standard and a motion-sickness accommodation. Now 50-85, and
  the sprint kick rides on top of whatever you pick.
- **Sprint and ADS were hold-only.** Holding a key or a mouse button for a whole
  match is an accessibility problem, not a preference. Both now offer
  HOLD / TOGGLE. Latches clear with the rest of the input state between matches,
  and HOLD mode ignores a stale latch entirely.
- **Emotes were invisible.** The game ships two (dance on B, cheer on N) and
  they appeared in no control surface and could not be rebound. They are now
  first-class entries in the keybind list, so they route through the same
  remap/conflict/reset machinery as everything else.
- **Rarity was communicated by HUE ALONE**, which is exactly the thing a
  red-green colourblind player cannot read — a legendary and a common differed
  only by the colour of a 3px strip. Weapon slots now carry the tier as a
  numeral (I-V) as well. The pickup line added in ?v=66 already names the tier
  in words, so rarity is now legible three ways.

Verified live: camera FOV follows the slider (57 -> 57, 80 -> 80); a Shift press
latches sprint on and a second press off, while HOLD mode ignores a set latch;
settings lists Field of view, Sprint, Aim down sights and both Emote rows (bound
to B and N); slot chips render I / III / V for rarities 0 / 2 / 4 and consumables
get no numeral. Selftest 66/66. DRAFT.

## 2026-07-21 — Supply drops you can find, loot you can read (?v=66, LIVE)

More lower-ranked gap-scan findings, plus a systematic sweep that found the real
scope of one of them.

- **Supply drops were invisible.** They are the ONLY source of legendary loot,
  and the entire presentation was one flashed line at spawn: no map marker, no
  world beacon, no landed cue. Now tracked and drawn on the minimap and the big
  map — a pulsing gold ring while it falls, a filled diamond once it is down —
  with an announcement on the way in and a flash when it lands.
- **Pickups never said what you picked up.** A blip played and that was all, so
  a legendary was indistinguishable from a common without opening the inventory.
  Now named: "PICKED UP LEGENDARY SNIPER", "PICKED UP BIG SHIELD x2",
  "PICKED UP HEAVY AMMO".
- **Three feedback events were emitted into the void.** A diff of every
  emit("x") against every listener showed hardLand, propBreak and
  supplyDropLanded had no handler anywhere — a heavy landing, a barrel bursting
  and the legendary crate touching down were all silent. All three now have
  positional audio.
  (First pass of that diff reported 22 dead events; that was a bad regex —
  audio.js registers through a bare `on("x")` helper with no dot, so nearly
  every listener in the file was missed. Corrected count was 6, of which these
  three were real gaps; the other three are covered elsewhere or duplicate an
  existing cue.)

Verified live: audio registers exactly one listener for each of the three; the
supply marker tracks spawn -> landed and paints 16 gold pixels on the minimap;
inbound and landed flashes both fire; all three pickup kinds name themselves
correctly. Selftest 66/66. DRAFT.

## 2026-07-21 — Requeue without the round-trip + a career you can see (?v=65, LIVE)

First two of the lower-ranked gap-scan findings.

- **No PLAY AGAIN.** The post-match screen offered only MAIN MENU, so playing a
  second match meant tearing the world down, rebuilding the cinematic 3D menu
  world, re-reading the skin GLBs, and pressing PLAY — a long wait between two
  matches of a browser BR, at exactly the moment the player most wants another
  go. PLAY AGAIN now requeues straight into a fresh random map in the same mode
  (and tears down any net session first, so it cannot inherit a dead room).
- **The career was invisible outside one screen.** Level, XP and the lifetime
  record were computed and stored but only ever rendered on the post-match
  panel, so on returning the next day the menu showed no evidence the player had
  ever played. The menu now carries a compact strip: level, XP bar with the
  exact threshold, lifetime matches/wins/kills/best placement, and the next skin
  unlock with its level.

NOT attempted, deliberately: the unlock track still dead-ends at level 10. There
are only five skin GLBs, so any further reward needs new cosmetic assets — a
Meshy spend and an owner decision about adding characters — and inventing a
hollow reward would be worse than the dead end. The cheapest real option, if
wanted, is level-gated colour variants of the existing five, reusing the
per-actor hue/lightness tinting loadActorModels already applies to bots.

Verified live: menu reads LVL 4, "900 / 2900 XP", "12 matches · 2 wins · 31
kills · best #1", "NEXT: BULWARK @ LVL 6"; the post-match screen offers PLAY
AGAIN and MAIN MENU, and PLAY AGAIN lands in phase "lobby" without passing
through the menu. Selftest 66/66. DRAFT.

## 2026-07-21 — Bots hoarded five guns and twitched beside loot (?v=64, LIVE)

Closes the half of build-order #11 that ?v=62 deliberately left open.

- **The 3-gun carry cap was HUMAN-ONLY.** It lived inside the `a = W.player`
  walkover branch — its own comment explains why it exists ("hoarding 5 guns
  left NO room for shield potions, which read as 'shields don't work'") — while
  give() itself had no cap at all. So a well-looted bot filled all five slots
  with guns and could never pick up a shield or a heal again for the rest of the
  match. The cap now lives in give(), so it applies to every actor. An explicit
  E-swap still works at the cap: it REPLACES the active weapon, so it can never
  raise the count.
- **pickLoot re-selected exactly what give() had just refused.** It scored loot
  by type and distance with no idea whether the item could be taken, so a
  fully-kitted bot walked to a gun, was refused, re-planned, and walked to the
  same gun again — twitching in the open next to loot it could not hold. Both
  now consult one shared predicate (W.wouldAcceptItem) that mirrors give()'s
  rules, so the planner and the taker can never disagree.

Verified live: a bot offered five guns accepts exactly three, and a shield then
FITS (slots read ar / smg / shotgun / mini_shield x2 / empty) — the actual point
of the cap. The predicate agrees with give() on refuse-gun, accept-swap and
accept-ammo. The human is still capped at three and an E-swap at the cap leaves
the count at three. And a capped bot stood directly on a floor AR targeted it 0
times across 12 thinks. Selftest 66/66. DRAFT.

## 2026-07-21 — Online session was never torn down (?v=63, LIVE)

Build-order #12 — the last of the ranked twelve.

- **W.net and the session object were cleared in exactly ONE place: the lobby
  CANCEL button.** Finish an online match, return to the menu, and the session
  stayed live — so every subsequent OFFLINE match kept broadcasting 12 Hz player
  state and 10 Hz bot snapshots into a dead room, replaying phantom events
  against deterministic s0..s49 slot ids that collide by construction.
- Worse for solo players, and a direct consequence of this morning's online-pause
  fix: togglePause reads `!!W.net`, so with a stale session ESC stopped pausing
  OFFLINE matches for the rest of the page session. Reproduced, then fixed.
- Teardown is on the MAIN MENU click rather than inside endMatch, so a future
  REMATCH can still reuse the room.
- **Lobby player count was edge-triggered on a boolean.** ffg_netplay emitted
  "peer" only when `ids.length >= 2` CHANGED, so a room going 2 -> 3 -> 4 never
  re-fired and the lobby sat on its first reading — the host started blind. The
  payload already carried `count`; nobody was ever told about it. Now emits on
  count change too (and on someone leaving), without spamming duplicate syncs.

Verified live: with a stale session ESC leaves paused=false (the symptom),
net.leave() nulls W.net, and offline pause then works again. The real presence
handler — captured out of ffg_netplay.js through a stubbed transport — emits
counts [1,2,3,4,3] across a filling-then-draining room and 0 duplicates on
repeated syncs at the same count. Selftest 66/66. DRAFT.

## 2026-07-20 — Bots stood in the open pulling a dead trigger (?v=62, LIVE)

Build-order #11, first half.

- **ensureGunOut's scoring body was dead code.** Its guard read
  `if (a.weapon && !a.weapon.id.startsWith("consumable")) return;` — and every
  actor is CREATED holding a pistol, so it returned immediately for every bot in
  every match. A bot locked onto the first gun it ever touched, never upgraded,
  and once mag AND reserve hit zero it aimed correctly and pulled a dead trigger
  forever while a loaded pistol sat in slot 0.
- **It was also called from the wrong place** — only actLoot and actEngage — so
  a bot rotating across the map with a dry gun did not re-evaluate until it
  happened to engage someone, which is exactly the moment it needed to already
  be holding a loaded gun. Now runs once per think() for every state (and off
  the per-frame act path entirely).
- **Scoring gained pellets and ammo.** Raw `damage` is PER PELLET, so a
  legendary shotgun scored below the starter pistol; and a dry gun now scores 0
  so it can never win. Verified: a bot holding a pistol upgrades to a loaded
  legendary shotgun.
- **Guarded against thrash:** it never re-equips the slot already held, and only
  acts on a real reason (consumable out, gun dry, or >15% better available).
  equipSlot rebuilds the weapon object, so an unguarded call every think would
  cancel reloads and re-clone the weapon mesh.

Verified live: a bot holding a dry AR swaps to its loaded pistol; a bot holding
a pistol upgrades to a legendary shotgun; 30 thinks while already holding the
best gun produce 0 equip calls, and 20 thinks with EVERY slot dry also produce 0.

STILL OPEN from this build-order item (not attempted here): bots have no 3-gun
carry cap (the human's is inside an `if (a === W.player)` block in loot.js), so a
well-looted bot fills all five slots with guns and can never pick up shields or
heals; and pickLoot re-selects an item give() just refused, producing a twitch
loop. Both are loot.js changes and are tracked in GAP_SCAN.md. DRAFT.

## 2026-07-20 — The kill you just made was the one beat you never saw (?v=60, LIVE)

Build-order #9.

- **announce() had no priority at all.** It was last-write-wins over one shared
  node and one timer, and R._annUntil was assigned once and never read — the
  comment above it claiming "higher-priority calls override" was simply untrue.
  Because match.eliminate() drops the alive count BEFORE the actorDied emit, and
  weapons.update runs before hud.update in the same frame, the "ELIMINATED X"
  banner for the kill that took the lobby to 10/5/2 was overwritten by
  "10 REMAIN" before the browser ever painted it. Zero paints, every time.
- Now prioritised (victory 3 > elimination/level-up 2 > milestone/deploy 1) and
  equal-or-lower calls QUEUE rather than drop — the alive milestone marks itself
  spent in R._aliveMark BEFORE announcing, so a dropped "FINAL 2" was gone for
  the rest of the match. Queue is capped so a kill spree cannot back up forever.
- **The winning kill's banner was destroyed in the frame it was born:** endMatch
  went straight to showPostMatch, which calls hideHUD() and removes the layer the
  announcement lives in. The match cut from a firefight to a DOM panel. Now the
  live world holds ~2.6s on "VICTORY ROYALE" first (phase "over" is already
  whitelisted in the frame gate and already blocks damage), and any key or click
  skips straight to the stats.

Verified live. Ordering: DEPLOY -> kill emitted -> "ELIMINATED WKEYWARRIOR"
survives the same-frame milestone -> at t+2.2s the queued "10 REMAIN" plays.
Victory beat on a clean page: at t+0 and t+1.2s the banner reads VICTORY ROYALE
with the stats grid still absent; by t+3.2s the stats are up. Selftest 66/66.
DRAFT.

## 2026-07-20 — Hit feedback doubled and collapsed (?v=59, LIVE)

Build-order #10. Three defects in the feedback for a single shot.

- **TWO live hitMarker listeners** were registered on the same event (audio.js
  had a sine 1000/1300 ping AND a square 950/1400 one), so every hit played a
  detuned flam — and a 9-pellet shotgun blast fired 18 phase-coherent
  oscillators into a destination with no limiter, which audibly clipped. Removed
  the unguarded duplicate; the surviving one has the null guard and the wider
  headshot pitch split.
- **Per-pellet damage numbers stacked on one pixel.** fx.js spawned a number per
  actorHurt, so a 90-damage blast printed nine coincident "10"s instead of one
  readable "90". Now coalesced per victim per frame — summed, headshot ORed,
  colour precedence head > shield > body — and flushed in update(). The buffer
  is capped because fastForward skips fx.update entirely.
- **A headshot inside a blast was invisible.** The HUD marker was last-write-wins,
  so a body pellet landing after a head pellet reset it to plain white 26px.
  Headshot styling now holds for its duration.

Verified live with a point-blank 9-pellet blast: exactly ONE damage number
reading "90" (matching the 90 dealt), a single registered hitMarker listener,
and a head-then-body pellet sequence leaving the marker yellow at 34px. DRAFT.

## 2026-07-20 — Shadows existed on ~1% of the map (?v=58, LIVE)

Build-order #8.

- The kernel builds the sun with `const d = 80`, so the shadow camera covered a
  160 m box — and NOTHING in the entire runtime ever touched `sun.target`
  (grep: zero references), so that box sat over world origin (0,0,0) for the
  whole match. The maps are 1600 m. Roughly 1% of the playable area had shadows;
  everywhere the player actually fights, characters and buildings rendered as
  flat cutouts — while the 2048/4096 depth pass ran every frame regardless.
- The volume now FOLLOWS the camera focus, keeping the sun's direction (captured
  per match as an offset, because buildMap re-aims the sun for each map's
  daylight). Centre is snapped to whole shadow-texel steps or the world shimmers
  as you walk.
- Extents tightened to 55 m (70 m on high) and set in W.applyGraphics, which
  already owns tier fidelity, rather than in the vendored kernel literal — so
  medium now resolves better than high did before. Added shadow bias
  (-0.0004) and normalBias (0.02); neither was set anywhere.
- No kernel edit was needed: the game's orchestrator adds sun.target to the
  scene and drives it. Last Circle's kernel copy already diverges from the
  pipeline template and 14 games vendor their own, so this keeps the blast
  radius at zero.

Verified live: with the player parked at (600,600) — 848 m from origin, where
there was previously no shadow at all — the character casts a contact shadow on
the sand; moving to (-320,140) the volume tracks within 2 m, the sun direction
is unchanged (0.53, 0.77, 0.35), the centre lands on exact 0.054 m texel steps,
and a palm shadows the grass. DRAFT.

## 2026-07-20 — Challenge XP you could never earn + keybinds that ate each other (?v=57, LIVE)

Build-order #5 and #6.

- **CHALLENGES WERE EVALUATED STRICTLY IN ORDER.** The update polled only
  chs[W._chalIdx] and advanced that pointer solely when the CURRENT challenge
  completed — and pickChallenges always puts CHAL_POOL[0] ("Survive 3 minutes")
  in slot 0. So a player who died at 2:30 with four kills and 600 damage earned
  ZERO challenge XP: the elimination and damage cards were never even polled.
  That withheld 465-625 XP from exactly the player whose match awards ~100-355.
  All three are now evaluated independently; the card still shows one at a time.
- Gated on being ALIVE, which the same change makes newly necessary: dying does
  not end the match and W.t keeps running, so a parallel pass would let a corpse
  in the spectator seat bank "Survive 3 minutes" and "Reach the final 10"
  without playing — the same exploit class already closed for practice mode.
- **REBINDING A KEY NEVER RELEASED THE OLD DEFAULT.** canon() maps physical ->
  canonical and falls through to identity, so after rebinding Map to Q, BOTH Q
  and M opened the map — forever, persisted to lc_settings. The action's default
  key now gets an explicit __unbound sentinel.
- **AND IT SILENTLY KILLED WHATEVER OWNED THE NEW KEY.** Rebinding Move Forward
  onto D left strafe-right unreachable while the settings row still displayed
  "D". Conflicts are now refused with "already: <action>" instead of stealing.
  Unbound actions display "—", and there is a RESET TO DEFAULTS button — until
  now only devtools could undo a bad rebind.

Verified live: at t=150 with 2 kills the elim challenge awards while survive
does not; after dying, t=400 still does not award survive. Rebinding Map to Q
yields {KeyM:"__unbound", KeyQ:"KeyM"} so Q opens the map and M does nothing;
rebinding Forward onto Q is refused with "already: Map" and leaves the remap
untouched; RESET clears it. Selftest 66/66. DRAFT.

## 2026-07-20 — Match teardown leaked ~55 animation mixers PER MATCH (?v=56, LIVE)

Build-order #7. Frame time degraded monotonically the longer you played, with
no in-game recovery — only a page reload.

- The whole teardown was `group.clear()` + `actors.length = 0` + resetBrains().
  Clearing a group detaches meshes but the kernel keeps every AnimationMixer in
  its per-frame update list until an explicit disposeMixer — which nothing
  called. 50 skeletons per match accumulated and kept being ticked forever.
- Teardown now disposes each actor's mixer and its nametag CanvasTexture BEFORE
  the roster is dropped (dispose first, or the references are already gone).
- weapons.reset() returns live rounds to the pool — the projectile list is
  module-level, so rounds fired in one match kept flying in the next with their
  meshes parented to a cleared group. fx.reset() clears floating damage numbers,
  which are DOM nodes and otherwise hang over the menu.
- **A SECOND leak the scan did not catch, found only by measuring:** after
  fixing the roster the count STILL climbed by exactly 5 a match. Five is the
  skin count — preloadMeshySkin builds a throwaway clone per skin purely to warm
  the gltf cache, and kernel.loadCharacter registers that clone's mixer too (its
  own comment says so). Those are never actors, so the roster teardown could not
  see them. Now disposed at the end of the preload.

Verified live across five back-to-back matches: kernel mixer count is 51 every
time (50 rigged actors + 1 baseline), growth 0. Before the second fix the same
measurement read 61 -> 66 -> 71 -> 76. Selftest 66/66. DRAFT.

## 2026-07-20 — Weapon swap fired a hybrid weapon (?v=54, LIVE)

Build-order #4. Two bugs in one code path.

- **Hybrid weapon.** stepWeapon cached `const wpn = a.weapon` BEFORE applying
  inp.slot, so after a swap every read for the rest of that frame — def, cd,
  magAmmo, state — came from the OUTGOING weapon object, while fire() stamps
  `a.weapon.id` and `.rarity` (the INCOMING weapon) onto the projectile.
  Swapping shotgun -> sniper on a live trigger therefore spawned def.pellets = 9
  projectiles each resolving as 105 sniper damage against 200 EHP, and the
  outgoing object's ammo decrement was written to an orphan. The slot switch now
  happens first, and a runtime invariant asserts def describes the weapon whose
  id will be stamped.
- **Swap cancelled the fire-rate timer.** equipSlot handed back a weapon with
  cd: 0, so tap-2-tap-1 double-pumped the shotgun past its 0.857 s cycle. Each
  slot now remembers its own remaining cooldown AND the incoming weapon inherits
  whatever the outgoing one still owed — a timer cannot be dodged by swapping.

Verified live: a plain shotgun shot deals 106 and sets cd 0.857; swapping
shotgun->sniper on the fire edge now deals exactly 105 (one sniper round, not a
9-pellet sniper burst); and fire -> tap 2 -> tap 1 carries the cooldown
0.857 -> 0.84 -> 0.84 with 0 extra damage from the second pump. Selftest 66/66.
DRAFT.

## 2026-07-20 — COVER NOW STOPS BULLETS (?v=53, LIVE)

Build-order #1 from the gap scan, and the biggest gameplay defect in the game:
positioning, peeking and holding a building — the load-bearing BR mechanic —
did not actually exist.

- **The bug:** testSegment only asked whether a sub-step's END POINT landed
  inside a box. Sub-steps run up to 2.5 m (an AR at 300 m/s covers 5 m per frame
  at 60 fps), so a 0.32 m wall — the real thickness on these maps — was only
  caught when the endpoint happened to land inside it, roughly 13% of the time.
  Ramps were worse: `if (c.kind !== "box") continue` skipped every ramp
  collider, so tower interior ramps stopped 0% of shots.
- **The fix:** a proper swept segment-vs-AABB (slab) test, plus a sloped test
  for ramps, both living in sim/royale.js so they are pure and node-testable.
  Impact FX and grenade bounces now use the ENTRY point and the ENTRY FACE
  normal; the old bounce derived its normal from the overshot endpoint.
- Colliders are queried along the WHOLE sub-step, not just around its endpoint —
  otherwise a wall crossed mid-step was never even a candidate.
- **Bot line-of-sight shared the identical flaw** (maps.js losBlocked
  point-sampled every ~3 m and skipped ramps), so bots shot through cover too.
  It now uses the same sweep, chunked into 24 m spans: the collider grid is
  16 m, so sweeping a 200 m sightline in one query would pull ~169 cells and
  slab-test everything in them for every bot against every candidate target.
  Measured after chunking: 0.024 ms per LOS call.
- 15 new selftest assertions (66 total, was 51): the 2.5 m step across a 0.32 m
  wall, entry-face normal, shots over/short/past, segments starting inside,
  ramp surface clamping, ramp hit/clear, nearest-wins, and dead colliders.

Verified live on a real 7 x 3.4 x 0.32 m map wall with shooter and target 10 m
apart across it: firing a full AR burst through the wall deals **0 damage** and
leaves 9 impacts on the wall face, while the same burst at the same range on
open ground deals **100 and kills**. DRAFT.

## 2026-07-20 — Two real defects from the adversarial gap scan (?v=52, LIVE)

A 131-agent scan (8 dimensions, every finding then run past a "prove it already
exists" refuter and a "is it worth building" judge) raised 61 findings; 6 were
refuted as already shipped. These are the first two fixes, both verified against
the source before touching anything.

- **M OPENED THE MAP *AND* MUTED THE GAME — PERMANENTLY.** Two window keydown
  listeners both owned KeyM: game_controls.js toggleMute and player.js
  toggleBigMap. Close the map with ESC and the game stayed muted, across
  reloads, for the whole portal origin. Confirmed live: the test browser was
  still muted from an earlier press. FIXED AT THE GENERATOR: the mute hotkey now
  honours CFG.mute_hotkey (mirroring the fs_hotkey pattern that was already
  there) in pipeline/engine/runtime/game_controls.js and
  pipeline/templates/shared/game_controls.js as well as this game's copy — that
  file ships in 35 games. Last Circle sets mute_hotkey:false because M is its
  map key. The corner mute button is untouched.
- **PARACHUTE A/D STEERING WAS MIRRORED.** The glide derived its strafe axis
  inline as (cos, +sin) while ground movement uses (cos, -sin). The two axes
  were therefore not perpendicular — their dot product is -sin(2*yaw) — so
  holding D under the canopy pulled partly backwards at every non-cardinal
  heading, and sweeping the mouse rotated the drift at double rate. This is the
  opening 30 seconds of every match. Both call sites now consume one shared
  sim.moveBasis(yaw).
- The suite passed 46/46 with that bug live, so the basis is now asserted
  directly in the node selftest (perpendicularity and unit length at 32 headings,
  plus right = forward rotated -90 degrees). 51 passed, 0 failed.

Verified live: holding D at yaw 0 / 0.7 / 2.1 / -1.3 gives right 5.82 and
forward 0.00 at every heading (previously forward went to -3.75 off-axis);
pressing M leaves the mute state unchanged. DRAFT.

## 2026-07-20 — Crouch, finished: authored clip + honest hit capsule (?v=51, LIVE)

Completes the crouch shipped at ?v=49, which deliberately left the hit capsule
at full height because the model could not visibly crouch.

- **Meshy crouch clip.** There is no endpoint to enumerate the action library
  (/openapi/v1/animations/actions parses "actions" as a task id and 400s), so
  candidates came from the published Animation Library Reference: 524
  Cautious_Crouch_Walk_Forward, 523 (backward), 527 Crouch_Walk_Left_with_Gun,
  54 Squat_Stance. Baked all four on soldier and measured them.
  - 54 DISQUALIFIED: head sweeps 1.60 -> 1.27 -> 0.72 over 4.8s. It is a
    squat-down-and-up motion, not a stance you can hold.
  - 527 is a LEFT strafe; 523 is backward. 524 is the forward crouch walk and won.
  Rolled out to all five skins as <skin>_crouch.glb (49 Meshy credits total).
- **heightMult is measured, not guessed: 0.86.** 524 puts the head bone at 1.34m
  (max 1.36 across the cycle) vs 1.62 standing, and the standing capsule sits
  0.18m above the head bone -> 1.36+0.18 = 1.54m -> 0.86. The original 0.62 guess
  would have been a lie: this is a cautious crouch walk, not a deep squat.
- **The capsule only shrinks for an actor that actually HAS the clip**
  (a.hasCrouchClip). If a skin's clip ever fails to bake it still stands upright,
  and shrinking its capsule would reintroduce exactly the shoot-through problem
  this work existed to avoid.
- One clip covers both stances: crouch-walk paced by ground speed, and standing
  still freezes it on a crouched pose instead of marching in place.
- **DEFECT found while wiring it:** playAnim did `(opts && opts.timeScale) || 1`,
  so an explicit timeScale of 0 (falsy) silently became full speed — "freeze this
  clip" did the opposite. Now null-checked.

Verified live: clip resolves on all five skins; capsule 1.80 standing / 1.548
crouched / 1.80 when crouching without the clip; anim = "crouch" moving and
still, timeScale 0.97 moving and 0 still; and a side-by-side capture through the
real input path shows the model visibly folded with its feet on the ground.
Selftest 46/46. DRAFT.

## 2026-07-20 — Crouch (?v=49, LIVE)

grep for crouch|slide|mantle|vault|prone across runtime/ returned nothing (the
only "climb" was a portal-ascent comment, the only "Vaulted" a bot name). The
game had no crouch at all.

- Crouch is a stance with a real trade: 45% movement speed for a 38% tighter
  hipfire cone and a lower camera. Ground-only, and sprinting always wins so you
  stand up to run.
- Bound to C, NOT Ctrl — this is a browser game sitting next to WASD, and
  Ctrl+W closes the tab. Rebindable like any other action (added to ACTIONS).
- Camera dip is eased, not snapped; sim exports actorEyeY()/actorHeight() so
  stance is computed in one place for camera, muzzle origin and hit capsule.

WHAT IS NOT IN THIS CHANGE, and why: the crouch does NOT shrink your hit
capsule. It was built that way first (0.62x profile), which requires the model
to visibly come down. These Meshy rigs have no crouch clip, so a procedural
leg-fold was written and then REJECTED on the evidence: offscreen captures of
standing-vs-crouched showed the character kneeling in mid-air, and a second
attempt with automatic foot re-planting still would not read as a crouch —
there is no IK here to keep the feet planted. Shipping a 1.12m capsule under a
model that plainly still stands would mean shots at a visible head passing
through it, which is worse than having no crouch profile. heightMult is pinned
at 1 with the reasoning recorded in sim/royale.js; it goes to ~0.62 in the same
change that lands an authored crouch clip from the Meshy animation library (the
route the run animation already took).

Verified live by driving real movement frames: 5.32m walking vs 2.39m crouched
in one second (ratio 0.449 against a 0.45 spec), sprint-while-holding-crouch
travels 8.51m with crouching=false, eye height 1.62 -> 0.97, capsule 1.80 in
both stances. Selftest 46/46. DRAFT.

## 2026-07-20 — Death recap (?v=45, LIVE)

The death screen said "#37 of 50 · by CraftyKat (sniper)" and stopped there,
which answers none of the questions you actually have when you die.

- Recap block: FINAL BLOW (range in metres, HEADSHOT when it was one),
  YOU DEALT (damage you did to the person who killed you), THEY HAD LEFT
  (their remaining HP/shield), plus a "SO CLOSE." line when you had them at
  25 HP or less. That last number is the whole point of a death screen.
- W.match.damage only holds per-ATTACKER totals, so "you had them down to 12"
  was not answerable from existing state. hurtActor now also records per-PAIR
  damage (victim.dmgFrom[attackerId]) and the last hit's detail (range,
  headshot, attacker HP/shield at the moment of the blow).

Verified live with a staged fight: foe placed 47m out and chunked to 12 HP,
then killing the player with a headshot produced exactly "47m · HEADSHOT",
"88 damage", "12 HP", and the SO CLOSE line. Selftest 46/46. DRAFT.

## 2026-07-20 — Performance readout (?v=44, LIVE)

A browser game runs on unknown hardware and an unknown network, and the player
had no way to tell a bad connection from a bad GPU from a bad game.

- Opt-in FPS readout (Settings -> Performance readout), colour-coded: green >=50,
  amber 30-49, red <30. Averaged over ~0.5s so it reads as a number, not a strobe.
- Online it also shows SYNC — the age of the freshest state packet from any peer,
  published by net.js as W._netStats.lastSeenAgeMs. Deliberately NOT called
  "ping": net.js records lastSeen timestamps, not round-trip time, so labelling
  it ping would be a lie.
- Defaults to off; persists with the rest of settings.

Verified live by driving hud.update at fixed frame deltas: 60/40/24/12 fps all
read back exactly, colours cross at the right thresholds, SYNC segment appears
only when a net session and stats exist, and the toggle hides the element.
Selftest 46/46. DRAFT.

## 2026-07-20 — Levels now pay out: skin unlocks (?v=43, LIVE)

Levelling granted nothing. The bar filled, the number went up, and the game
handed back no reward — so the whole progression loop (which the previous batch
had just given career stats and a level-up banner) still terminated in nothing.

- MENU_SKINS gained unlockLevel: SGT. BRICK / DASH free, NIGHTFALL at 3,
  BULWARK at 6, STINGER at 10.
- The locker still lets you browse locked skins — seeing what level 10 buys is
  the point — but shows "🔒 LOCKED · REACHES LEVEL n", tints the dot amber, and
  does not equip or persist them.
- player.js reads lc_skin straight from localStorage, so rather than teach it
  about unlocks (and import hud), showMenu sanitises the stored value: a locked
  skin left over from cleared progress is rewritten to the first unlocked one.
- The level-up banner now names the reward — "SKIN UNLOCKED · NIGHTFALL" — or
  points at the next one ("NEXT UNLOCK · BULWARK AT LEVEL 6"). Extracted as the
  pure levelUpSub(lvl) so it is testable without a built world.

Verified live: at level 1 exactly SGT. BRICK + DASH read OPEN and the other
three LOCKED; at level 10 all five OPEN; a seeded lc_skin of "viper" at level 1
was rewritten to "soldier" on boot; levelUpSub returns the right line for levels
1–11. Selftest 46/46. DRAFT.

## 2026-07-20 — PRACTICE RANGE (it was advertised but never existed) (?v=41, LIVE)

The practice lobby promised "RANGE TARGETS SOUTH, MOVEMENT COURSE EAST". Grep
for either string across the whole runtime returned exactly one hit: the
advertisement itself. Practice mode was an empty map with a full loadout.

- **Range built:** five dummies at 12/22/35/55/80m, laid out due south of
  wherever practice drops you and sat on the terrain. They take damage through
  the real pipeline (W.hurtActor), so hitmarkers, damage numbers and headshot
  detection all work — then they reset instead of dying, because a range you can
  permanently delete in six seconds is not a range.
- Dummies are deliberately NOT registered with W.match: they cannot touch
  alive-count, placement, or the victory check (verified: aliveCount stays 1 and
  match.over stays false after 470 damage across all five).
- **Live range readout:** SHOTS · HITS · ACC · HEADSHOTS · DMG · DOWNS.
- **XP/career exploit closed (found while building this):** XP was awarded from
  damage regardless of mode, and the new career record folded in every match.
  With a no-death dummy range that makes levelling a matter of standing still
  and holding the trigger. Practice now earns no XP, completes no challenges and
  banks no career stats, and the post-match screen says so.
- Lobby line now describes what actually exists (no movement course is claimed).

Verified live: 5 dummies rigged and in-scene at the right distances/bearing;
alive after 120 damage with hp reset and pops counted; hurt events still fire per
hit; XP frozen at level 3/120 and career frozen at 7 matches after farming 2400
damage; readout renders "SHOTS 15 · HITS 12 · ACC 80% · HEADSHOTS 3 · DMG 470 ·
DOWNS 2". Selftest 46/46. DRAFT.

## 2026-07-20 — DROP SELECT + match re-entrancy guard (?v=39, LIVE)

The biggest remaining structural gap vs Final Drop and the genre generally: the
opening decision did not exist for the player.

- **DROP SELECT (new):** every bot picks a named POI to land at (bots.assignDrops),
  while the human was dropped "high over a random point" (player.js spawnAll) —
  simultaneously the worst loot odds on the field and the removal of the choice
  every battle royale opens with. New landing-zone map between lobby and drop:
  click any zone (clicks snap to a POI), lock in with DROP, 12s auto-lock so
  online clients advance together. If you never pick, you get the QUIETEST named
  zone instead of a random dump.
- **Contested-zone heat:** the rings are coloured off the bots' ACTUAL declared
  drop targets (assignDrops runs before the lobby), not a guess — QUIET / LIGHT /
  CONTESTED / HOT with the inbound count drawn inside each ring. Verified on
  isla_viva: Banana Farm 10, Jungle Market 9, Volcano Rim 6, Palm Bay 2.
- Chosen LZ is marked on the minimap while you fall (drawMinimap, drop phase only).
- **DEFECT — startMatch re-entrancy:** it clears the world (actors, brains) and
  THEN awaits the map build and model load. A second call landing inside those
  awaits interleaves with the first, and the match ends up with two full rosters.
  Reproduced: two concurrent calls gave 98 actors in a 50-player match. Reachable
  from a fast double-click on PLAY / PLAY AGAIN. Now guarded — verified two
  concurrent calls yield 50 actors on the first call's map.
- Drop-map labels: names moved onto backing pills and counts moved inside the
  rings after a capture showed four labels colliding at the south of the island.

Verified live: player lands at exactly the chosen POI coords with the glide
intact (playerXZ === poiXZ, alt 269, gliding true), 49/49 bots declare targets,
screen opens and closes, phase advances to drop. Sim selftest 46/46. DRAFT.

## 2026-07-20 — BR parity: career stats, match moments + 2 real defects (?v=36, LIVE)

From a code-verified gap analysis vs Final Drop (fetched its shipped 1309-asset
manifest + script bundle) and BR genre conventions. This batch = retention + game
feel + defects. NOTE: building/harvesting stays OUT (owner decision) even though
Final Drop ships it.

- **CAREER STATS (new):** showPostMatch computed kills/damage/accuracy/placement every
  match and threw them away — only {level,xp} persisted. Added a lifetime `career`
  record (matches, wins, kills, damage, bestPlacement, top10s, timeAliveS) folded in
  at match end and surfaced on the post-match screen.
- **LEVEL-UP now exists (DEFECT):** `W.events.emit("levelUp")` fired on every level and
  had ZERO listeners — the bar filled, the level ticked over, and the player was never
  told. Added a "LEVEL n" banner + a post-match LEVEL UP line.
- **MATCH MOMENTS (new):** a big centre-screen announcement layer — "DEPLOY · N PLAYERS"
  at match start, alive-count milestones (25/10/5 remain, FINAL 2), and per-kill
  "ELIMINATED <name>" with streak escalation (DOUBLE/TRIPLE/QUAD KILL, RAMPAGE). The
  match had a flat counter and no rising arc.
- **ONLINE PAUSE EJECT (DEFECT):** ESC set W.paused, which early-returns the whole frame
  pipeline INCLUDING netMod.update — the 12Hz state broadcast stopped and the host's
  silent-guest watchdog swapped you for a bot after 12s. Opening the menu ejected you
  from a match with friends. Online now shows a non-blocking overlay and never freezes
  the sim; offline behaviour unchanged.
- **Docs hazard:** sim/royale.js's header still claimed it owned "the building grid…
  and harvesting". Rewrote it with an explicit NO BUILDING / NO HARVESTING —
  do-not-reintroduce note so a future parity pass can't read it as a spec.

Verified live: career keys present, DEPLOY / LEVEL 7 / ELIMINATED+DOUBLE KILL banners
all render, online pause leaves paused=false with the online note, offline pause still
pauses. Sim selftest 46/46.

## 2026-07-20 — BRIGHT lighting + street furniture + landmarks (?v=32, LIVE)

Visual polish, now that offscreen-render-target capture unlocked real pixel review
(a background browser tab blacks out the default framebuffer, but rendering to a
WebGLRenderTarget + readPixels bypasses the throttle — captures POSTed to a local
cap_server for viewing).

- **LIGHTING (biggest win):** the scene rendered as a muddy dusk — ACES Filmic
  tonemapping was crushing + desaturating everything. Switched matches to
  NoToneMapping with rebalanced lights (sun 2.05 warm, hemisphere 1.25 with a
  lighter ground colour, exposure 1.0) + reduced in-match bloom to 0.14. Result:
  bright vibrant daylight — green grass, tan sand, red roofs read clearly, like the
  reference. Verified by capture on isla + deepwood.
- **Street furniture:** lamp posts, market stalls, benches, hydrants along town
  streets (cosmetic). Towns now read as lived-in settlements.
- **Hero landmarks:** isla lighthouse, ashgrid water tower, deepwood chapel steeple.

## 2026-07-20 — proper UPRIGHT run animation (?v=29, LIVE) — Meshy regen

The gated D10 item, now done (owner authorized the Meshy spend). The shipped run was
Meshy action **16 "RunFast"** which leaned ~55° ("running bent over"), band-aided by a
per-frame spine counter-rotation. Replaced with a proper upright run and the hack deleted.

Pipeline: `pipeline/meshy_lc_run.py` (adapts meshy_rig_anims_v2.py). The 5 rig_task_ids
were gone (expired), so re-rigged from the shipped base GLBs.
- **Bake-off** on soldier: re-rig (5cr) + 5 candidate run actions [14,15,510,534,538]
  (15cr), each measured for torso lean (Hips→Neck world tilt) + foot motion. Pixel-free
  ruler validated first: old RunFast = 54.7° avg, walk = 5.5°.
- Winner: **action 510 "Standard_Forward_Charge"** — 11.7° lean, strongest stride,
  clean retarget onto the shipped base (so a run-clip-only swap works, no full re-rig).
- **Rollout** (32cr): re-rig the other 4 skins + animate 510 + swap all 5 `<skin>_run.glb`.
  Verified shipped: soldier 11.7° / athlete 5.7° / wraith 3.0° / juggernaut 2.9° /
  viper 11.4° avg lean (all upright, foot motion 0.59–0.80 = clean legs).
- Removed the `_runLean` spine counter-rotation block + flags in player.js (at ~3-12°
  it would over-straighten and tip the model backward).
Meshy spend: 20 (bake-off) + 32 (rollout) = 52 credits; balance 5195 → 5143.

## 2026-07-20 — Final Drop parity build (?v=18 → 28, LIVE)

Multi-session /loop closing the gap to the Final Drop reference the owner benchmarks
against. Item-by-item tracker: `PARITY_PROGRESS.md`. Each item was gate-verified (ESM
syntax + sim selftest 46/46) and live-verified on the CDN by driving the frame
pipeline via `k._updaters` and inspecting scene/DOM/state (a hidden/background browser
tab throttles WebGL to black, so pixel screenshots weren't possible — visual QA of the
actual look is pending the owner opening the live URL).

- **Textures (Pass A):** procedural CanvasTexture PBR (grain albedo + Sobel normal maps)
  on terrain (world-planar UV, over the vertex-colour biome tint), all structures
  (brick/panel), and water (ripple). Unified graphics authority `W.applyGraphics` —
  applied at BOOT, drives DPR + shadow-map res + anisotropy per tier and syncs the
  shell `ffg_settings.quality` key, so "High" finally takes effect on load (was inert).
- **World density (Pass B):** road network (nearest-neighbour tree over POIs → textured
  asphalt ribbons) + town-builder (houses on streets, front doors to the road, terracotta
  roofs, parking lots) on isla + deepwood + a new ashgrid savanna outpost; farmland
  (crop rows + barn + silo + fence) for the Farm POIs (isla Banana Farm relocated inland
  off the waterline); distinct biome zones — a deepwood northern SNOW biome + an ashgrid
  eastern DESERT; traversal fixes (interior tower ramp now emerges through a cut
  stairwell hole, overpass ramp reaches its deck, sky-island rim collider 0.86→0.92·rad).
- **Meta + MP (Pass C):** XP/level bar + rotating in-match challenge cards (persistent
  `lc_progress`, match-end XP); both MP MUST desyncs fixed (host-bot chest-opens mirror
  to guests; grenade/barrel splash routes through net authority); barrel-anchored muzzle
  flash; spectator HUD follows `W._camFocus` not the corpse.
- **Polish (Pass D):** menu golden-hour light no longer leaks into matches; headshot
  hitmarker + ping; compass ribbon; umbrella glide (canopy deploys at 110m + gentle auto
  forward-glide); bot coverReflex on sim-time (fastForward determinism); supply-drop
  cadence spread late; remote gunfire FX relay (guests see/hear remote shots); full
  keybind rebind list; +1 selftest (quick tier-mix).
- **Gated / deferred:** D10 real upright RUN clip needs a Meshy regen ($ spend, awaits
  owner OK) — a code-only "measured lean" was tried and reverted (Meshy spine
  `rotation.x` is bind-pose-dominated so an absolute-lean measure reads noise; kept the
  working relative fixed-delta nudge). B5 ramp terracing + B4 street-furniture props are
  optional feel refinements.

## 2026-07-12 — v4.12 destructible world: barrel collision + explosive barrels + shootable trees (?v=18, LIVE)

Owner playtest (vs Final Drop reference): "walked through a barrel — these should be
explosive; shooting trees should damage them; explosives should damage the things
around them." Root cause: `propColliderKinds` (maps.js) listed palm/tree/pine/birch/
rocks/car/container but NOT barrel → barrels had zero collision. Built a destructible-
props system:

- **maps.js:** added `barrel` to `propColliderKinds` (collision restored); each prop
  collider now carries its instance `idx` + `hp` (`propHP`: barrel 1, tree 46, pine 58,
  palm 42, birch 40; rocks/car/container = indestructible cover). New `W.map.destroyProp(col)`
  shrinks the InstancedMesh instance to nothing + marks the collider dead; `queryColliders`
  now skips dead colliders so shots + players pass through the gap.
- **weapons.js:** a direct bullet hit on a destructible prop chips its hp — barrels
  DETONATE on any hit (full splash + knockback), trees drop once hp is gone. `explode()`
  now also levels nearby trees and CHAIN-detonates nearby barrels (depth-capped at 3 to
  bound recursion) — explosions damage the environment, not just actors.

VERIFIED LIVE (ashgrid, 40 barrels/80 trees): destroyProp flips dead false→true and the
collider leaves queryColliders; shooting a barrel point-blank → 2 pistol shots → barrel
destroyed + player HP 100→55 (45 blast dmg). Mouse confirmed 1:1 (HUD reticle `mousePx`
and shot ray `mouseNDC` derive from the same mousemove; point-blank shot landed dead-center).
Sim selftest 45/45.

**Still staged (owner's Final Drop-parity list):** real towns per biome (houses/roads/
cars — currently only trees+sky-islands, "gets boring"); tower/ramp redesign (ramps too
vertical for BR — match Final Drop terracing) — folds in the un-climbable-ramp + platforms-
in-water/steep items from task #40; grenades as a throwable; distinct RUN animation (sprint
exists at 9.6 m/s but plays the walk clip sped up — Meshy run clip leans ~30°, needs
investigation before regen per owner's no-guess rule); scorch/crater decals + tree-fall FX.

## 2026-07-12 — v4.11 gap-review fixes: semi-auto, sniper, grenade, sky, poses, savanna structures (?v=17, LIVE)

Acted on the multi-agent gap review (all 6 subsystem audits completed this session).
Fixes shipped + verified (sim selftest 45/45):

- **Semi-auto fire (weapons.js + player.js):** held LMB used to auto-cycle the
  pistol/sniper/shotgun/launcher (the every-frame input rebuild overwrote the
  single-shot guard). Now auto weapons (SMG/AR) fire while HELD; semi weapons fire
  once per CLICK, gated on a mousedown edge `W._fireEdge` (set on click, cleared on
  release/consume). VERIFIED LIVE frame-by-frame: held pistol → mag 16→15 (ONE shot)
  then flat while held; held SMG → 14 shots. 
- **Sniper (royale.js):** removed `gravity:true` (speed 500→700) — it was the only
  bullet that dropped, so a center hold missed at its own 200-400m band; now hitscan-
  straight like the arsenal, aim = impact.
- **Grenade launcher (weapons.js):** was exploding on walls/crates but bouncing on
  terrain; now bounces off box faces too (detonates on the 2s fuse) — consistent bank-shots.
- **Held-SPACE (player.js):** edge-gated (`!e.repeat`) — key auto-repeat was strobing
  the chute (deploy/cut/deploy) and multi-firing swim strokes.
- **Sky (maps.js):** clouds raised 130-230m→320-460m (no longer pass THROUGH them as
  flat cards during the drop); bird flocks 75-130m→120-180m (clear of islands); sky
  dome now recenters on the camera each frame (no parallax, no far-plane clip at map edges).
- **Per-match updater leak (maps.js):** cloud/bird/water `onUpdate` closures were never
  removed on rebuild → ran forever over detached sprites. Now tracked + spliced out of the
  kernel loop each `buildMap` (self-contained, no shared-kernel change).
- **Poses (pose.js + player.js):** added a `lowReady` carry (gun lowered out of combat,
  snaps to gunReady on ADS/fire — verified live on deepwood); restore the weapon if an actor
  is killed mid-emote (was leaving corpses empty-handed); weighted the spine aim-bend.
- **Savanna structures (maps.js):** warmed the old grey concrete palette (C_CONC/CONC2/
  METAL) to sandstone/adobe so the buildings read as a weathered savanna outpost, not grey
  city blocks. Texture sweep of all 3 maps: every object properly coloured/complete.

**Gap review — remaining OPEN items (filed, not yet fixed):** Movement: interior tower
ramps dead-end into the upper-floor slab (un-climbable, maps.js tower()); overpass ramp
under-shoots the deck; sky-island collider is 0.86× the visible grass (rim fall-through).
UI: two uncoordinated graphics-settings systems (kernel ffg_settings.quality vs LC
lc_settings.graphics) — LC tier never applies at boot; orphaned keybind capture; ESC over
open Settings un-pauses under the modal; spectate shows the corpse's HUD. MP-only: host-bot
chest-opens not mirrored to guests (net.js:36 `a===W.player` → `!a.netRemote`); grenade
splash + remote gunfire fx bypass the net-authority path. Menu bloom/exposure still leaks
into matches (judgement call — established look). Cosmetic: muzzle flash spawns at the eye
not the barrel.

## 2026-07-12 — v4.10 Savanna recolor (grey→colour) + aim-pitch un-invert (?v=16, LIVE)

Owner playtest: dropped into the old `ashgrid` map and reported "you've removed
all colours from the game." Investigated live + in code — NO global desaturation
(isla_viva/deepwood stay fully colourful, verified live). The grey was `ashgrid`
itself: `colorAt` returned `[g,g,g]` pure grey (asphalt) under a grey sky
`#aab6c4` — grey BY DESIGN, predating v4.9. The v4.9 fog thinning just made the
whole grey expanse visible (denser fog used to hide it in haze). A lifeless grey
map is still bad, so:

- **`ashgrid` → "Savanna" (maps.js:19, 104-110, 623):** warm golden-hour sky
  `#e7cf98`, and `colorAt` now returns golden savanna grass with green/ochre
  variation (`fbm`-driven patches) instead of `[g,g,g]`; sandy washes low, warm
  sun-baked bluffs high; island grass tops `#a7ad55`; themeColor warmed to
  `#e0854a`. Fits the acacia trees already on the map. Verified live ground-level
  + drop-in: warm, colourful, alive (was flat grey). mapId key stays `ashgrid`.
- **Aim-pitch UN-INVERTED (player.js:794):** the armed pose layer was called with
  `-a.pitch`, but `input.pitch > 0` = looking UP (verified: mouse-up → +pitch; a
  live mouse-look test read +0.106 on up-look; `aimDir`/camera both use
  `sin(pitch)`), and `tiltDir(+)` raises the muzzle — so the gun/torso tilted the
  WRONG way (down when you looked up) for every armed player. Now passes `a.pitch`
  un-negated. Verified live: look up → pistol raises & points up; look down →
  pistol lowers to the hip.
- Sim selftest 45/45.

**Gap review (multi-agent, this session) — OPEN items, not yet fixed:** HIGH:
semi-auto fire is defeated — the every-frame input rebuild (player.js input
updater) overwrites weapons.js's `inp.fire=false`, so pistol/sniper/shotgun/
launcher auto-repeat while LMB is held (needs a mousedown-EDGE gate). MEDIUM:
sniper round has gravity while all other bullets are hitscan-fast → drops below
the reticle at 200-300m (drop `gravity:true` or add holdover); grenade detonates
on boxes but bounces on terrain (box branch checks `splash` before `bounce`);
menu render-state (bloom + exposure 1.12 + warm sun 1.85) leaks into matches
because buildMap never restores it (architectural — the established look, changing
it is a judgement call); per-match `kernel.onUpdate` closures (cloud/bird/water)
never removed → leak that compounds each match; cloud sprites read as flat cards
at 130-230m (raise altitude + fade near camera); sky dome (r=1312) clips the 2000
far-plane at map corners + parallaxes (recenter on camera). LOW: no low-ready
pose (gun always at chest); emote-holster not restored if killed mid-emote;
muzzle flash originates at the eye not the barrel. Movement/UI-HUD/Bots audits
did not finish (session limit) — re-run needed.

## 2026-07-12 — v4.9 real sky + proper freefall/canopy + click-to-play menu (?v=15, LIVE)

Owner round: "do the falling boneless, realsky and clouds and birds, run to
check mouse look, and fix the menu." All done, verified in live play (pump +
rAF-shim + canvas→JPEG upload pipeline), then deployed to the CDN (?v=15) and
re-verified on the live workers.dev URL.

- **REAL SKY (`maps.js`):** added a gradient sky dome (ShaderMaterial, horizon→
  zenith), 24 drifting cloud groups (soft radial-gradient billboard sprites,
  3–5 puffs each), and 3 looping bird flocks (V-silhouette sprites) — all
  map-agnostic off each map's `sky` colour. Verified from altitude: fluffy
  clouds + V-birds render against the dome (shots `skydive_gamecam`,
  `birds_close`). **Fog thinned** (isla_viva 0.0011→0.0006, ashgrid
  0.0013→0.0007, deepwood 0.0016→0.0009) so the ground no longer washes white
  when you look down while dropping — the dome now covers the far distance, the
  fog is just light atmospheric haze (storm keeps its own heavier weather).
- **PROPER FREEFALL + CANOPY (`pose.js`):** the skydive/hang arm+leg targets
  were single straight lines (no elbow/knee bend) → the "boneless spread-eagle"
  and "arms rammed straight up" the owner flagged. Rebuilt both with real joint
  articulation: skydive = box/arch (upper arms out at shoulder level, forearms
  bent ~90° so hands come up-and-forward; thighs splayed back, knees bent so the
  shins kick up) — verified live (bones: head down-forward, hips up, feet kicked
  up-and-back, hands forward-spread; shot `skydive_fixed`). Canopy hang = upper
  arms reach up-and-out to the risers, forearms angle back up to the toggles
  (bent elbows, not straight up), legs dangle with a slight knee bend — verified
  live under an open chute (shot `hang_frozen`). No Meshy regen — pure runtime
  pose layer.
- **MENU click-to-play (`hud.js`):** removed the separate "▶ DROP IN" button;
  each of the 3 glass mode cards (BATTLE ROYALE / QUICK MATCH / PRACTICE) is now
  the play button — one click launches that mode, with a ▶ chevron affordance
  and a "CHOOSE A MODE TO DEPLOY" hint. Already glassmorphic (backdrop-filter
  blur 18px, saturate 1.35, rounded, blue glow). Verified on the LIVE deploy:
  3 cards, each `onclick` launches, no DROP IN button, glass confirmed.
- **MOUSE-LOOK verified LIVE:** the existing model is correct — any mousedown
  requests pointer lock, then `mousemove`'s `movementX/Y` drive `input.yaw/pitch`
  (cursor-follow aim is the lock-denied fallback). Proven in a live match via
  the RMB-drag path (same yaw code): movementX=140 drove yaw 0.000→−0.246→−0.493,
  movementY drove pitch 0→0.106, and the camera world-dir rotated (−0.057,−0.998)
  → (0.418,−0.904). (Real pointer-lock *engagement* still needs a focused real
  browser — the headless preview tab is `hidden`.)
- Sim selftest 45/45. `HAND_AIM_ROT` gun calibration and the 5-skin roster
  (drifter cut) unchanged.
- **Test-harness note:** reviving a dead actor (`hp:0`) in the verify harness
  leaves `a.obj` detached from the scene (death path `victim.obj.parent.remove`,
  player.js:893) → the body renders nowhere. It is a *test artifact only*
  (normal freefall never kills you); re-add with `k.scene.add(a.obj)` to inspect.

## 2026-07-09 — v4.8 per-skin weapon calibration (level barrel on all 5)

wraith + juggernaut aimed ~35° high with the shared grip rotation (their
Meshy hand-bone rest differs). Auto-calibrated each rig LIVE (measure barrel
world dir → rotate to forward+level) and baked the five per-skin hand
rotations into `HAND_AIM_ROT`. Verified in live play: dot 1.0, muzzle level on
soldier/athlete/wraith/juggernaut/viper (montage in scratchpad).

**Verification-pipeline lesson (never crash the preview again):** driving the
game with a setTimeout pump + rAF shim (needed because the headless tab is
hidden) leaks a WebGL context on every `startMatch`; ~15 restarts wedged the
renderer. Rules: (1) RELOAD the page between skin tests, don't loop
`startMatch`; (2) `clearInterval(window.__pump)` + restore `requestAnimationFrame`
BEFORE any navigate, or CDP navigation hangs 300s on the still-busy page;
(3) cap matches per page load.

## 2026-07-09 — v4.7 HOTFIX: revert per-frame gun aim (it broke the cast)

The v4.6 "skin-independent per-frame barrel aim" was the cause of the viper
body contortion AND the "gun points backward" — verified in LIVE play (see
below). Removed it entirely; the weapon uses the static per-skin grip rotation
set at load. Measured all 5 fighters after the revert: barrel points FORWARD
on every skin (dot 0.97–0.99 soldier/athlete/viper; 0.80 wraith/juggernaut,
which additionally tilt up ~35° — leveling tracked separately). Viper runs
upright, no contortion.

**Verification method fixed for good:** the headless preview tab runs *hidden*,
so `requestAnimationFrame` never fires → the game loop stalls → earlier
"verified" claims were reading frozen state. Live play is now driven via a
setTimeout pump + rAF shim, and frames are captured by copying the WebGL canvas
to a JPEG POSTed to a tiny local upload server (scratchpad/upload_server.py)
and read back as an image. ALWAYS verify through that pipeline, never a static
eval, never a frozen frame.

## 2026-07-09 — v4.6 BLACK-SCREEN fix, upright run, skin-independent gun aim

Owner round 8 (screenshots): matches loaded pitch black, characters ran bent
over with the gun pointing the wrong way. All three root-caused + verified in
real gameplay renders (not just measurements — a lesson below).

- **BLACK MATCHES FIXED**: the concurrent v4.4 menu overhaul's
  `teardownMenuWorld` slammed `scene.background`/fog to dark navy 0x0a1622 at
  **10× fog density (0.012)** as a "placeholder for maps.js" — but teardown
  runs AFTER buildMap, so dense dark fog swallowed every match. Removed the
  override; the map owns the sky (each map's daytime `sky`/`fog` now shows).
- **UPRIGHT RUN**: player locomotion no longer uses the Meshy RunFast clip
  (leans ~30° forward — the "running bent over" the owner kept flagging). All
  ground movement plays the UPRIGHT walk clip, sped up by ground speed to a
  jog/sprint. Movement speed unchanged (9.6 m/s); only posture is upright.
- **SKIN-INDEPENDENT GUN AIM**: the Meshy rigs do NOT share a hand-bone
  orientation — soldier's points forward, **juggernaut's points straight
  DOWN** — so no single hand rotation can aim every gun forward (soldier was
  fine, juggernaut fired backward). The weapon holder is now re-oriented EVERY
  FRAME so the barrel (+Z) points along the actor's aim vector, compensated
  through the (fresh) hand-bone world quaternion. Verified in-render for
  soldier/juggernaut/viper — all point forward. (Lesson: a separate-eval
  measurement read a stale matrix mid-animation and looked broken; the actual
  per-frame render was correct — always confirm with a screenshot.)
- Tracers already shortened in v4.5 (len 4, life .22 — a dash); the long gold
  columns in-scene are LOOT BEAMS (chest markers), not tracers. The pistol/AR
  molded on the soldier's vest is baked into the Meshy model (one skinned
  mesh), not a code-added weapon.

## 2026-07-09 — v4.5 weapon GRIP anchoring, first-person scope, Scrap cut

Owner round 7 (screenshots): guns weren't held IN the hand, Scrap's arms/run
looked broken, you saw your own body when sniping, tracers too long, wanted
mouse-look. Diagnosed each in real gameplay this time (not isolated poses).

- **WEAPON GRIP ANCHORING** (the "hold it in the hand" fix): guns were
  normalized then CENTERED, so the fist held the barrel's midpoint and the
  weapon floated across the chest. Now a data-driven grip anchor (centroid of
  the bottom-third vertex cluster = the handle, à la the Claudecraft "grip y"
  metadata) is placed AT the hand; long guns nudge +Z so the stock clears the
  arm. Verified: pistol / AR / sniper all sit in the fist, barrel forward.
- **SCRAP (drifter) CUT**: measured every rig's idle torso lean — Scrap's
  Meshy rig shipped a **27° baked-in forward slouch** (all 5 others sit at
  1-5°), so his every clip hunched and his arms read broken. Unfixable without
  regen (which risked the same slouch on a "street raider"); owner cut him.
  Roster is now soldier / athlete / wraith / juggernaut / viper (5).
- **FIRST-PERSON SCOPE**: aiming a scoped weapon (sniper) drops to first-person
  at the eye and HIDES your own body, so it no longer blocks the shot (owner:
  "when sniping im in the way of the cursor and can see myself"). Non-scope ADS
  (AR etc.) pulls tight over the right shoulder so the body sits left of a
  clear reticle. Body re-shows the instant ADS releases.
- **MOUSE-LOOK PRIMARY**: any click now grabs pointer lock → moving the mouse
  looks around; RMB is ADS only (was: must hold RMB to drag-look). Cursor-
  follow aim stays as the lock-denied fallback.
- **SHORTER TRACERS** (len 9→4, life 0.4→0.22 — a punchy dash, not a beam) and
  **quieter gunshots** (gains −35%).
- NOTE: this rides on top of the concurrent v4.4 menu overhaul (another
  session) — committed together per owner direction.

## 2026-07-08 — v4.4 AAA menu / UI polish (live Three.js cinematic)

Owner: "I expected this UI to be significantly more polished, more 3js, highly
professional and AAA standard." The menu was CSS gradient + SVG islands with a
tiny character canvas — mid-tier indie, not Fortnite/Apex lobby energy.

- **LIVE 3D MENU BACKDROP** on the main kernel WebGL canvas: procedural tropical
  island (vertex-colored terrain), ocean, purple storm ring (brand), floating
  sky islands, atmospheric dust points, god-ray planes, golden-hour sky shader
  dome, optional real prop GLBs (palm/tree/rocks/pine). Cinematic orbit camera
  + elev bob runs every frame while `phase==="menu"` (`updateMenuWorld`).
- **GLASS UI OVER THE WORLD**: translucent panels with backdrop-blur so the 3D
  scene reads through; Orbitron/Rajdhani type; animated title reveal; mode
  cards with icon tiles + hot selection chrome; glowing DROP IN CTA; top
  season chrome bar. Character bay gets metallic stage floor, blue emissive
  ring, rim/kick lights, ACES tonemap on the preview renderer, corner
  brackets, pulse dots.
- **Loading / lobby / post-match** restyled to the same glass + display-type
  system; shimmer load bar; lobby slot highlight for self.
- Bloom enabled on the menu path for storm-ring glow. Teardown clears menu3d
  group + restores fog when match starts.

## 2026-07-08 — v4.3 FIST SURGERY + full animation-state pass (AAA sweep)

Owner round 6: "hands look mangled… why can't closed be a fist?" + "check ALL
models, ALL animations, ALL bones." The definitive hand finding: a close-up
contact sheet (all 12 hands rendered tile-by-tile) proved **every one of the
six models shipped with OPEN modeled hands** — the "fists" prompt never truly
worked, gloves just hid it at distance. Meshy rigs have NO finger bones and
the rigging API can't add them, so hands can only be closed in the MESH.

- **FIST SURGERY (`tools/curl_fists.mjs`)**: closes hands in the bind
  geometry — verts past the knuckle line get a progressive curl around the
  knuckle axis PLUS quadratic compaction into a fist-center ball, with
  sphere-blended normals (pure rotation looked like mangled hooked fingers —
  owner called it). Finger axis = principal axis of the hand vert cloud via
  covariance power iteration (forearm→hand direction fails on rigs with
  bent-back bind wrists — the athlete's palms-up shrug). Meshy IBMs carry
  non-rigid armature scales → NEVER trust bone matrices for positions; use
  vertex clouds. Backups: *.openhands.bak beside each GLB (gitignored).
  Verified per-hand on a 6-tile close-up sheet (render ALL tiles in ONE
  frame with preserveDrawingBuffer — the buffer wipes between browser frames).
- **JUMP + SWIM clips** (Basic_Jump 86 / Swim_Forward 569, all six rigs,
  ~25cr): airborne actors used to play IDLE (no clip matched "jump");
  swimming was run@0.6. Both verified live (SPACE → jump clip; river → real
  freestyle stroke).
- **AIM PITCH** (AAA upper-body layer): gunReady/reload target dirs tilt with
  the camera's vertical aim + Spine01/Spine02 bend — the gun visibly tracks
  where you aim up/down (verified at steep up-aim).
- **BACKPEDAL** plays the stride in REVERSE (negative setEffectiveTimeScale)
  when moving against facing in combat — no more moonwalking (verified
  ts=-1.31 under ADS+S).
- Meshy balance after: 989cr. gen-scripts live in session scratchpad; the
  temp dir gets purged by the OS — `meshy_lc5.py` silently became 0 BYTES and
  "ran" successfully (empty file exits 0). Check file sizes before batches.

## 2026-07-08 — v4.2 particles were NEVER rendering, emote locker, leg posing, storm feel

Owner round 5. The headline find: **no particle had ever rendered in a match**
— fx.js adds its InstancedMesh to the "fx" scene group once at page init, and
startMatch `g.clear()`s every group before the first match begins. Muzzle
flashes, tracers, impact bursts, explosions: all silently orphaned since the
groups-clear was introduced. That was the real "when shooting i dont see
bullets". Fixed with a self-healing re-adopt in fx.update.

- **TRACERS you can see**: bolts now FLY with the round instead of a static
  140ms muzzle blink; cosmetic speed cap 200 m/s (hitscan 999 m/s crosses the
  screen in one frame — the eye never sees it; the damage ray is already
  resolved). Thicker (0.15), brighter gold, 0.4s life, bigger 3-color muzzle
  flash. Bots' fire uses the same global event → incoming fire reads too.
- **EMOTE LOCKER**: the menu turntable now plays cheer (greeting) → dance
  loop per skin instead of Meshy's arms-out idle ("show his character off").
  Clip files load on demand into the preview mixer; raw-idle + relax layer
  stays as fallback while a skin is still baking.
- **LEG POSING** for skydive (arched back-spread) and canopy hang (legs
  together, slight knee bend) — pose.js now steers UpLeg/Leg/Foot chains too;
  clip legs read wrong mid-air (frozen run stride).
- **STORM FEEL** (owner: "shrinks too much too quickly" + "damage should
  increase the longer you're in it"): standard table rebuilt — 8 phases,
  ~13.5 min, gentler early cuts (~58-64% radius kept vs ~46%); per-actor
  RAMPING storm damage +50% per 6s soaked (cap 3×), decays when back inside
  — verified live: ticks 1,1,1,1,1,1.5×6,2. Final phase still dps 12
  (selftest pins it).
- **RELOAD SFX**: mechanical sequence timed to the weapon's reloadS — mag
  release click → mag drop → seat clunk → slide rack (was two beeps).

## 2026-07-08 — v4.1 runtime arm-pose layer, ramp render fix, per-weapon ADS

Owner round 4 with screenshots: the Meshy ARMED clips retarget broken on these
rigs (Alert folded both arms across the face — "broken bone animation"), menu
idle stood arms-out, the tower ramp rendered backwards ("im in the wall"), and
ADS needed per-weapon zoom. No model regeneration needed — the rigs are fine;
the ARMS are now owned by code.

- **ARM-POSE LAYER (`pose.js`)** — the Dungeon Forge relaxArms technique,
  generalized: every frame AFTER the mixer (kernel updates mixers before game
  updaters) each arm chain is slerped toward actor-local target directions.
  Modes: `relax` (menu/unarmed — arms hang naturally), `gunReady` (two-handed
  gun at chest — replaces ALL armed clips), `skydive` (arms swept back),
  `hang` (hands up on the risers — the canopy shot finally looks real),
  `reload` (muzzle dips, left hand works the receiver, driven by
  weapon.state==="reloading"). Clips own legs/torso; arms always read right on
  every rig. Armed clips (idlearmed/walkarmed/runarmed) NO LONGER LOAD; files
  stay on the CDN. POSES exported for live tuning. **Verify pose work
  UNPAUSED** — W.paused stops the layer but kernel mixers keep running, so
  paused screenshots show the raw clip drifting back (cost 20 min).
- **RAMP RENDER FIX**: addRamp's slab was inverted for dir 2/3 (visual rose
  −Z while the collider rose +Z — players walked "inside the wall" on the
  correct collider) and completely FLAT for dir 0/1 (rotateZ on the slab's
  long axis is a no-op). All four dirs now match supportAt exactly; dir 0/1
  collider footprints also had width/run swapped — fixed (highway ramp is now
  a real 26m run, not a 9m cliff).
- **PER-WEAPON ADS** (`adsFov` in sim): sniper 20 + scope overlay (verified
  via real RMB), AR 42, launcher 45, SMG 47, pistol 48, shotgun 49.
- Menu turntable applies `relax` — the locker pose looks natural, not the
  Meshy library arms-out idle.

## 2026-07-08 — v4.0 fist cast, armed locomotion, portals, cursor-aim, skin locker

Owner playtest round 3 ("characters hold hands out / run odd / don't hold
weapons, shots don't go where the mouse points, no weapon cursors, chests on
roofs unreachable, falling off islands is death — need portals, menu needs
polish"). All fixes verified live with real key/mouse events + screenshots.

- **SIX-FIGHTER FIST CAST**: full regenerated Meshy roster — soldier (SGT.
  BRICK) / athlete (DASH) / drifter (SCRAP, regenerated once: first roll came
  out open-palmed) / wraith (NIGHTFALL, the all-black-with-helmet one) /
  juggernaut (BULWARK) / viper (STINGER) — all prompted "hands clenched into
  tight fists" (Meshy rigs have NO finger bones; open hands can only be fixed
  at generation). Meshy also hallucinated base pedestals under some models
  (athlete stood on a red disc everywhere) — stripped by connected-component
  analysis + a radius/up-normal triangle cut in the GLB optimizer.
- **ARMED LOCOMOTION** (the "hands out / odd run" fix): 18 new Meshy library
  clips — idlearmed=Alert(2), walkarmed=Walk_Forward_While_Shooting(234),
  runarmed=Run_and_Shoot(98) — for all six rigs; armed actors now hold the
  gun up in idle, walk, and run. Anim pace now TRACKS ground speed
  (setEffectiveTimeScale retune, never restart — restart-per-frame stutters).
- **CURSOR AIM**: without pointer lock the shot ray now goes through the OS
  cursor (unproject → capsule/terrain march), the per-weapon reticle RIDES the
  cursor, and the OS arrow is hidden over the canvas during play. Verified:
  bot at NDC(-0.31,0.05), one click, exactly one pistol hit.
- **LAUNCH PORTALS + CHUTE REDEPLOY**: every sky island carries a glowing
  ring portal (+ up to 4 ground portals at POIs) — walk in → ballistic boost
  (~80m, half-gravity) → skydive handover → canopy failsafe at 60m. SPACE in
  any mid-air fall ≥12m AGL re-opens the parachute, so stepping off an island
  is an escape, not a death. Portal whoosh in audio.js.
- **ROOF ACCESS**: every tower() gets an exterior ramp along the +X wall
  (ends short of the parapet; step sideways onto the slab — verified climb to
  y=12.9 on ashgrid), shipwreck gets a boarding plank, deepwood barn a hay
  ramp. Rooftop chests are all reachable on foot now.
- **MENU 2.0**: layered animated backdrop (bobbing sky-island SVGs, drifting
  clouds, rotating storm ring, vignette), gradient title, stacked mode cards,
  and a SKIN LOCKER — live 3D turntable preview (extra WebGLRenderer, real
  meters so no Box3 scaling), ‹/› + dots, choice persists in localStorage
  `lc_skin` and the player spawns as it (bots keep rotating the cast).
- **SPEED AUDIT**: walk 6.0 / sprint 9.6 m/s already exceeds Fortnite
  (~5.7/6.5-7), Apex (~7.4), Warzone (~6.7) — the "feels slow" was fixed-rate
  anims + narrow FOV, not m/s. Base FOV 53→57, sprint 64→70.
- **WEAPON MOUNT AUTO-ALIGN**: Meshy renders some "side view" props at a 3/4
  angle (sniper sat diagonal in its bbox and looked like a scrunched blob in
  hand). The mount now searches yaw for minimum cross-width and flips 180° by
  vertex-density (muzzle end is thin, stock end dense).
- **HARDENING**: brains[] now clears between matches (stale brains from the
  previous match kept thinking into detached actors forever); the human input
  struct is rebuilt every frame from live key/button state (a phantom
  input episode drained the whole pistol reserve mid-test — mx/mz/fire/ads
  can no longer stick); emotes holster the gun (hidden during dance/cheer,
  restored after).
- Meshy spend this round: drifter regen + 18 armed clips ≈ 300cr (2286 start
  → 1079 after). Raw GLBs re-downloadable by task id (state/meshy_raw got
  wiped mid-session by an outside process — task ids in scratchpad state
  JSONs saved the day; download URLs live ~3 days).

## 2026-07-07 — v3.0 Meshy cast + the "did you actually play it" patch

Owner playtest feedback round 2 + new requirement: original AI-generated
characters. Everything below verified live via real MouseEvents/KeyboardEvents
+ screenshots (not just sim runs).

- **MESHY AI CHARACTER CAST** (owner requirement: no reused fantasy rigs):
  4 original battle-royale characters generated on the owner's Meshy account —
  commando / runner / raider / specter — text-to-3d→refine(PBR)→rig(1.8m)→
  animate (idle 0 / walk 30 / run 16 / death 8). 188 credits total (2286→2098).
  Optimized 8MB→~0.7MB base + 25-68KB clip-only GLBs (gltf-transform+sharp,
  512px webp). Clips merged into the cached gltf at load (renamed idle/walk/
  run/death); per-actor hue tints for 50 distinct looks. Old Quaternius chars
  DELETED. **Gotchas:** do NOT bbox-normalize Meshy rigs (bind-pose bbox reads
  ~0.1m from tiny armature scales → 26m giants; rigs are authored at real
  meters). Hand bone = `RightHand`, world scale ~0.065 → scale-compensate the
  weapon holder; grip tuned live to (0, -90°, +90°). Raw GLBs in
  state/meshy_raw (not repo); pipeline scripts in session scratchpad.
- **AIM FIXED — the real bugs found by tracing actual projectiles:**
  (1) fixed-120m camera-convergence missed uphill targets → replaced with a
  true CROSSHAIR RAYCAST (camera ray vs actor capsules + terrain + colliders;
  projectile flies muzzle→that point). (2) **recoil never recovered** — every
  shot permanently kicked pitch up; after a few clicks the reticle sat ~2m
  above the target ("my pistol doesn't work"). Recoil now tracks in
  accumulators and re-centers over ~0.3s. (3) FIRST-SHOT ACCURACY: deliberate
  standing shots get 0.15× spread. Verified: crosshair-on-chest real clicks
  land (4/6 even 0.5m off-center), damage events fire.
- **Drop v2**: SPACE now TOGGLES the parachute open/cut/open repeatedly
  (verified open→cut→open); failsafe auto-deploy 60m first-time / 22m hard
  floor after manual toggles. Freefall pose fixed — belly-DOWN (sign flip;
  was falling face-up "on my back") and near-frozen mid-stride limbs
  (timeScale 0.05; 0.35 looked like jogging in the sky). No forced forward
  drift (AFK players used to slide ~100m into the ocean).
- **Body facing**: characters now turn toward their RUN direction outside
  combat (pure camera-facing read as "running sideways"); they square up to
  the camera while aiming/shooting (1.5s combat window).
- **Movement**: walk 6.0 / sprint 9.6 (9.2 effective, verified via real
  keys), ads 3.8, accel 0.13, sprint FOV 64. Stuck-ADS clears on blur.
- **Combat feedback**: per-PROJECTILE tracers (every weapon, every shotgun
  pellet — bright 22-34m streaks, colored for sniper/GL); damage numbers
  26px w/ stroke; PER-WEAPON CROSSHAIRS (pistol/smg tight cross · AR wide
  cross · shotgun spread ring · sniper fine dot + scope on ADS · GL arc
  chevron) with movement bloom.
- **Audio coverage**: footsteps (stride-distance emitter, self quiet/enemies
  loud), weapon-switch click, parachute deploy whoosh + cut, kill-confirm
  two-tone; chest open/pickup/reload/shield-break already covered. Chests
  verified opening (hold-E 2s channel).
- **NPC battle model** (owner: "run from storms but FIGHT once safe"):
  rotation urgency = meters-past-safety vs time-left (95 only when genuinely
  pressed, 40 when there's time); live enemy ≤40m scores 88+ and dominates.
  Soak: 8/9 living bots in ENGAGE mid-game, 43 gun kills vs 6 storm.
- Shield potions verified end-to-end (pickup room preserved by the ≤3-gun
  auto-pickup cap; slot-select + click → bar rises 0→25).

## 2026-07-05 — v2.1 drop/feel/AI polish (owner screenshot feedback)

- **Skydive + parachute drop** (was: rigid straight-down fall): freefall is
  belly-down (~70° tilt, banks into turns, run-clip limbs read as spread),
  fast fall −20 (dive −34 on SHIFT) with forward air inertia; a composed
  parachute (gored dome + suspension lines, per-actor color) auto-deploys at
  60 m AGL → upright pendulum sway, −5.5 fall; camera tracks the dive
  (pitch bias −0.62 freefall / −0.18 canopy, dist 9-10). Chute removed on
  landing. Bots get the identical sequence.
- **Gun actually in hand**: weapon holder is now parented to the rigs'
  `FistR` bone (scale-compensated) instead of a fixed chest offset that
  floated at head height — guns ride the skeleton through every animation.
  Armed actors use the rigs' `Idle_Weapon`/`Run_Holding` holding poses.
- **Character variety**: 5th rig (wizard) + per-actor procedural hue/light
  shifts on cloned materials — 50 visually distinct opponents (verified:
  red vs blue wizards etc. in a lineup shot).
- **Input fixed for lock-less contexts**: LMB ALWAYS fires (previously the
  first click was swallowed requesting pointer lock — if lock was denied the
  game was unplayable); unlocked = hold-RMB-drag rotates the camera (and
  ADSes); locked = mouse-look + RMB ADS.
- **Storm slowed to real BR pacing**: standard ~10.75 min of storm
  (12-13 min matches), quick ~4 min. Selftest asserts the envelope.
- **Bots fight like players now** (the "ran right past me" fix):
  engage-on-sight outranks everything when the target is LIVE and close;
  ~160° vision cone + unconditional awareness within 15 m; reload = sprint
  for lateral cover; FLEE blends escape vectors toward the circle (never
  flees INTO storm); phase≥4 rotates early; wider skill spread (tier1 7.5°
  err/700 ms → tier5 0.9°/210 ms). Balance loop discovered in soak tests:
  pure aggression gridlocked the lobby into eternal starter-pistol duels
  (0% looting) — fixed with FIGHT FATIGUE (14 s stalemate → break off,
  6 s re-target cooldown) and "distant enemies don't stop an un-geared bot
  from looting" (>35 m). Result: 46/49 gun kills, 3 storm deaths, 75%
  upgraded by late-game, winner with kills.
- Playtested via screenshots: freefall pose, canopy descent (player + bot
  chutes), armed lineup (variety + guns in hands), swimming (player + bot),
  chest beam visible at range; live-fire input verified with real
  MouseEvents (fire w/o pointer lock, RMB-drag rotate 0.53 rad).

## 2026-07-05 — v2.0 pure BR shooter rework (owner direction)

Owner feedback: drop the Fortnite building identity entirely; make it a clean
battle-royale SHOOTER. Full rework in one session:

- **Building/harvesting/materials REMOVED everywhere** — sim (BuildGrid,
  BUILD, MATERIALS gone; selftest now asserts their absence), building.js
  deleted, all build keys/UI/HUD mats, bot wall-up/box/ramp-push behaviors,
  net build mirroring. Map structures remain as static cover.
- **Arsenal = 6 guns**: pistol / SMG / AR / shotgun / sniper / **grenade
  launcher** (new: arcing fused shells, bounce, burst on body hit; replaces
  rocket launcher). Pickaxe melee + hand grenades removed. **Everyone spawns
  with a common pistol** (16 mag + 36 light) — verified all 6 weapons score
  kills in soak tests; storm kills fell from ~30% to 8% of eliminations on
  standard (fights actually resolve).
- **Swimming**: deep water = real swim (surface buoyancy + bob, swim/sprint-swim
  speeds, no shooting while swimming, SPACE = stroke hop, splash FX/audio).
  Replaces the old push-back-to-shore hack.
- **Controls simplified** to WASD / SPACE / SHIFT / LMB / RMB(ADS) / R / E
  (+ 1-5/scroll slots, M map, ESC). Crouch, quick-heal (T), and every build
  key removed; settings keybind list trimmed to match. Scroll now cycles
  weapon slots.
- **Loot rework**: chests are UNMISSABLE (large chest model + gold rarity
  ring + pulsing glow sprite + vertical light beam, all removed on open) and
  take a **2-second HOLD-E channel** (progress ring on the HUD crosshair;
  bots obey the same 2s rule). Items: walk-over auto-pickup whenever there's
  room; **tap E swaps the ground item with your active slot** when full.
  Death drops now include the EQUIPPED weapon (all slots + ammo).
- **Directional indicators** (industry standard): white footstep icons on the
  screen-edge ring for moving players within 30 m (1.4 s per-actor throttle),
  gunfire chevrons for shots 12-250 m away, red arcs toward whoever damaged
  you. All fade ~1 s, positioned by world bearing relative to camera yaw.
- **Neutral characters**: the Quaternius rigs' baked weapon meshes
  (Ranger_Bow / Rogue_Dagger / Warrior_Sword / Cleric_Staff) are stripped at
  load — nobody holds anything except their actual gun (starting pistol is
  now visible in hand from spawn via equip-on-load).
- Bots: FARM state + build behaviors removed; new **flanker** personality
  (arcing strafe pushes) replaces "builder"; suppression reflex = sprint to
  lateral cover when shot by an unseen attacker; chest opens channel 2 s;
  loot brain rewritten around "upgrade off the starter pistol" (14/26 alive
  bots upgraded by t=150 in soak).
- Verified in preview: full matches on isla standard (t≈7:40, 45/49 gun
  kills, winner 6 kills) + deepwood quick; swim/hold-E/indicators/walkover
  all exercised through the real input paths; sim selftest 44/44; zero
  console errors.

## 2026-07-03 — v1.0 initial build (full game, one session)

**What it is:** 50-player third-person battle royale with Fortnite-style building.
1 human + 49 AI opponents (friends can join online and replace bots). Three maps,
three modes, full loot/storm/build/combat loop, win/lose/stats screens.

### Architecture
- FFG 3D kernel (`ffg_kernel_3d.js`, shared with Pirate's Cove/Tide Breakers) + new genre `royale`.
- **Rules core** `runtime/sim/royale.js` — pure, deterministic, node-tested
  (`royale.selftest.cjs`, 47 asserts): weapons/damage/falloff, storm phase math
  (nested seeded circles), BuildGrid (slots, HP ramp, support graph, cascade
  destroy), loot tables, match bookkeeping.
- **Genre modules** `runtime/3d/royale/*`: maps, player, weapons, building,
  loot, storm, bots, hud, audio, fx, net. Orchestrated by `ffg_royale3d.js`
  (shared world object `W`, fixed frame pipeline, `window.__LC__` debug hook
  with synchronous `fastForward` for deterministic testing).
- **Bots are players structurally**: brains write the same input struct the
  keyboard does; movement/weapons/building are one code path.
- **Multiplayer**: Supabase Realtime (NetPlay). World is deterministic from the
  shared seed; only live state relays. Host simulates bots (10Hz snapshots);
  each human simulates themselves (12Hz); hits on remote actors route to their
  owning client. Guests take over bot slots; disconnect → bot brain re-attaches
  (explicit `bye` + 12s host watchdog). Loot item ids are derived from source
  (`f:`/`cb:`/`dd:`/`sd:`/`sw:` prefixes) so pickup mirroring never desyncs.
  VERIFIED live with 2 clients (host tab + same-origin iframe): identical seeds,
  slot takeover, bot snapshots flowing, 0m relay error on player state.

### Maps (seeded procedural, 1600m)
- **Isla Viva** — tropical: radial island, volcano+crater, beaches, 8 POIs
  (Palm Bay, Coco Village, Volcano Rim, Shipwreck Cove, Cliff Temples, Lagoon
  Docks, Jungle Market, Banana Farm), palms/trees instanced + harvestable.
- **Ashgrid** — urban: bowl downtown with multi-floor enterable towers (interior
  ramps, roof chests), overpass, container yard + motor pool (metal), crane
  high-point, rubble cover field.
- **Deepwood** — forest: rolling hills, river+lake carve, ranger towers,
  logging camp, quarry (brick), cabins, fire watch.
- **Proving Grounds** — practice-only: range with distance markers, build lot,
  movement course.
- Batched box-geometry structures (one mesh per color) + InstancedMesh props;
  static collider spatial hash; analytic heightAt shared with minimap render.

### Systems
- Weapons: pickaxe/pistol/SMG/AR/shotgun/sniper/rocket/grenade; rarity tiers
  (+8% dmg, −10% spread per tier); real projectiles with travel + drop
  (sniper/rocket), pellets, splash+knockback, recoil, reload, falloff to 40%.
- Building: wall/floor/ramp/stair; 10 mats; wood/brick/metal HP ramp
  (90→150 / 100→300 / 110→500); door edits; support-graph cascade destroy;
  ghost preview + turbo-build for the human; bots build via the same tryBuild.
- Loot: seeded floor spawns + chests (golden ring, burst on open), supply drops
  (2/match, drift down into next circle), death drops (deterministic, seeded by
  victim id), 5-slot inventory, ammo/mats auto-pickup.
- Storm: 7 phases standard (~8.5 min storm → 10-13 min match), 5 quick (~3.5 min);
  final circle HOLDS at ~10 m (r=0 storm-killed every survivor simultaneously —
  someone must WIN the fight); violet additive wall (hidden pre-shrink +
  practice); minimap current+next rings + outside-veil; warnings + sirens.
- Bots (49): utility state machine (DROP/LOOT/FARM/ROTATE/ENGAGE/FLEE/HEAL/
  CAMP/PUSH/WANDER) over per-bot blackboard; 5 skill tiers (reaction 600→220 ms,
  aim error 6°→1°, build ability none→edit-plays) × 6 personalities (rusher,
  builder, camper, loot_goblin, rotator, sniper); staggered thinking (150/400 ms
  near/far); vision cone + LOS + hearing (shots 250 m); aim model with acquire
  overshoot, tracking warm-up, motion penalty, smooth error wobble; burst fire
  discipline; wall-up reflex on damage; box-up heal; ramp pushes; third-party
  drift; endgame aggression (camp off, +engage, duel aim 0.55×).
- HUD/UI: menu (mode+map cards), lobby fill (50 named slots + countdown), HUD
  (bars, slots w/ rarity, mats, ammo, minimap, kill feed, storm timer, alive,
  interact hints, hitmarkers, damage numbers, storm/hurt tints, sniper scope),
  big map (M), pause, settings (volumes, sensitivity, graphics presets,
  click-to-rebind keymap via canonical-code remap), death→spectate (killer
  hand-off), post-match stats, victory + confetti.
- Audio: procedural Web Audio SFX (per-class gunshots w/ distance+pan to 260 m,
  builds, impacts, shield break, chests, heals, storm sirens, UI); music =
  3 unique Laser Sequence tracks (menu/match/endgame) per no-duplicate rule.
- FX: single 1024-cube InstancedMesh particle pool (muzzle, tracers, impacts,
  explosions, debris, chest bursts) + DOM damage numbers + camera shake.
- Perf: 51 fps / 25 draw calls / ~500 k tris with 50 actors in preview (DPR 1.5,
  shadows 1024); far-bot LOD (cheap physics + frozen mixers >250 m), staggered
  AI, spatial hashes, particle/projectile pooling.

### Bugs found & fixed during preview verification
- **Versioned-import dual-instance**: `import "./x.js"` (bare) alongside
  `import("./x.js?v=")` = TWO module instances (empty genre registry / null K).
  All intra-runtime imports must propagate `?v=`.
- Emitter dropped 4th event arg (tracer dir undefined).
- Build cell `Math.round` → walls a cell above the builder (never grounded).
- Bot plan-stall: state unchanged → onEnter never re-ran → idle forever.
- **Sticky-crouch**: glide-dive set input.crouch, nothing cleared it → every bot
  crawled at 2.2 m/s all match.
- **Mats starvation loop**: nobody could afford a first wall → kills dropped no
  mats → no one EVER built. Fix: 50 starting wood (humans too), Fortnite-scale
  harvest (14+8/swing), 50-count mats pickups. 61-103 builds/match after.
- **r=0 final circle** crowned a corpse (winner at −11 HP); holds at ~10 m now.
- Stale MATCH OVER overlay leaked into the next match (layer cleanup).
- Rock cluster normalized by height → house-sized blob (compact props normalize
  by max dimension).
- Spectated actor's nametag filled the screen (focus tag hidden; tags culled).
- Preview gotchas confirmed: plain `http.server` serves stale ESM (use
  serve_nocache.py); `window.open` blocked (2nd client = same-origin iframe).

### Match-quality numbers (fastForward soak tests)
- Standard/Isla: hot-drop fights from t≈60 s, 40%→88% armed (t=100→300),
  61 builds, winner 1-13 kills, full match 9-11 min, storm kills ≈15/49.
- Quick/Ashgrid: complete in ~6.5 min, 103 builds.
- Deepwood: verified spawn/fights/POIs; player got shotgunned by a bot (good).

### Known limitations (v1)
- Mid-match join syncs t/builds/loot but not in-flight projectiles.
- Bot pathing is steering-based (no navmesh); rare storm stragglers die dumb
  (tier-appropriate, honestly).
- Stairs render stepped but share ramp collision; roof piece not implemented.
- No swimming — deep water pushes back to shore (Fortnite-pre-swim rule).
