# Last Circle — Post-Parity-Program Delta Report

**Re-score date:** 2026-07-21 · **Baseline:** `BENCHMARK_SCORECARD.md` @ 791b7806 · **Under test:** f5502ecb (HEAD, working tree clean) · **Benchmark:** Final Drop (CrazyGames)

---

## 1. HEADLINE

**11 of 16 dimensions are now parity-or-better, up from 7. Fifteen dimensions improved, one held, none regressed. The game is still not shippable at your "parity or ahead on every dimension" bar, and it will not get there by engineering alone.**

Five dimensions remain behind: **visuals, audio, progression-retention** (all slightly behind), **multiplayer, monetisation-readiness** (both far behind).

Three things you need to hear plainly:

1. **The bar as written is currently unreachable.** Monetisation-readiness cannot reach parity with a monetised benchmark while ads, SDKs and outward network calls are ruled out. That is your constraint, not a defect — but it means "parity on every dimension" is a bar your own settled decisions forbid. Either the constraint moves, or the bar gets re-scoped to exclude that dimension.

2. **Four of the five remaining dimensions are gated on owner decisions that cost money or reverse a stated constraint** — an SFX pack (audio), a building-art kit (visuals), paid transport (multiplayer), an outward leaderboard call (progression). The engineering-only ceiling on those four is "closer, still behind."

3. **Three match-breaking defects would block publish even if all 16 scored ahead** — see §5.5. Two are S-effort and need no owner input.

The program did real work: 15 dimensions moved, 7 crossed a band boundary, and the two dimensions that were "ahead" got further ahead without regressing. But roughly a fifth of the effort landed as code that runs and produces nothing — that section is §4, and it is the most important part of this report.

---

## 2. MOVEMENT TABLE

| Dimension | Prior | Now | Moved | One-line reason |
|---|---|---|---|---|
| bots-and-ai | ahead | **ahead** | improved | Headshots, supply-drop contest, live crouch, rookie tier mix — but shield top-off (`bots.js:194`) is byte-identical and still the largest difficulty lever. |
| movement | ahead | **ahead** | improved | Model has a zero-line diff; gains are map reachability + hard-land dust. All three top gaps (slide, mantle, air-brake) untouched, including the one rated effort S. |
| storm-and-pacing | parity | **parity** | unchanged | Storm bed gave the wall a voice; the tables are byte-identical, quick-mode phase 1 is still the unfixed critical — and rookies are now steered into it. |
| loot-and-inventory | parity | **parity** | improved | Interact prompt no longer lies, bots contest drops, chest-open loop bug fixed; consumable/heal/beam model untouched, 1 of 6 judgeable axes closed. |
| drop-and-rotation | parity | **parity** | improved | Chute hint, ENTER-to-drop, 14 minor landmarks, dry LZs. Descent is 26.25 s and byte-identical; no aircraft, no instrumentation, bots still never cut. |
| ui-hud | parity | **parity** | improved | HiDPI on 3 of 4 canvases, honest load bar, name field, CAREER screen, 3 wired accessibility controls; both prior "high impact" gaps untouched. |
| combat-feel | parity | **parity** | improved | Trigger finally does something (shake, FOV, vmKick, hitstop, working flash); all 8 mechanical gaps — recoil, spray, hitbox, flinch — exactly where they were. |
| game-feel-juice | slightly_behind | **parity** | improved | 8 of 11 gaps closed; Vlambeer checklist 2/6 → 5.5/6. Held back by an FOV punch that decays before it renders. |
| map-design | slightly_behind | **parity** | improved | Both criticals closed at the generator: real firing apertures in every enterable structure, POIs snapped onto land, cover density ~2.7x on Ashgrid. |
| first-60-seconds | slightly_behind | **parity** | improved | Real boot splash, honest loading bar, rookies routed to a 10-second-to-fight mode, every ceremony segment now skippable. |
| performance | slightly_behind | **parity** | improved | Measured 763→358 draw calls, 12.6→5.19 ms, 1,934 ms build freeze → 135 ms; texture dedupe closed the memory gap. |
| progression-retention | far_behind | **slightly_behind** | improved | Real dailies with a date-derived seed, reward track to L22 (32,400 → 163,800 XP), CAREER panel. No leaderboard, no sync, no real season. |
| multiplayer | far_behind | **far_behind** | improved | Teams, remote animation, shared clock, invite links all landed — the transport still exceeds its own message cap at **every** room size the moment anyone shoots. |
| audio | far_behind | **slightly_behind** | improved | Full HRTF spatialisation verified live, range-keyed weapon audio, reverb, limiter, music routing. Zero recorded SFX shipped; still 100% synthesis. |
| visuals | far_behind | **slightly_behind** | improved | Tone mapping, aerial fog, working foliage shadows, per-map lighting, conforming roads, first local lights. Remaining gap is art content: 105 `addBox` buildings, no LOD, no decals. |
| monetisation-readiness | far_behind | **far_behind** | improved | Sitelock, working pause, player name, invite links, dailies — 4 of 5 free portal-QA blockers closed. Still $0 with no code path that could earn. |

**Band crossings:** 7 dimensions moved band (4 into parity, 3 out of far_behind). **Regressions:** none.

---

## 3. WHAT ACTUALLY IMPROVED — verified in code

The highest-confidence wins, each traced to a live call site by the re-scoring analyst:

**Rendering and frame cost (the biggest measured deltas)**
- Draw calls 763 → **358**, triangles 3.72M → **2.36M**, frame 12.6 → **5.19 ms** (same hardware, same map, same seed). Heaviest 50-actor frame 17.77 → **8.46 ms**.
- Match-build main-thread freeze **1,934 ms → 135/173/94 ms** via three `await yieldPhase()` (`maps.js:315, 392, 1665, 1823`) plus `compileAsync` on the loading screen.
- GLTF in-flight dedupe (`ffg_kernel_3d.js:267-279, 291-300`) cut unique texture Sources 202 → 102 and `renderer.info.memory.textures` 195 → 70. This was the gap tied to the 4 GB Chromebook rule.
- Loot distance cull (`loot.js:569-579`): loot group 505 calls / 7.3 ms → **132 calls / 2.79 ms**.
- Tone mapping `NeutralToneMapping` @ 1.15 (`maps.js:344-345`) where it was previously `NoToneMapping` with an exposure `OutputPass` ignored entirely; fog 3.8–4.3x with per-map horizon colour; per-map sun/hemi authored (`maps.js:36-41`).

**Map generation — both prior criticals closed at the generator, not the artifact**
- Every enterable structure now has a real firing aperture sized against the shipped eyelines: `house()` sill 1.20 / header 2.30 (`maps.js:926-931`), `hut()` (`:650-657`), `tower()` band moved onto the eyeline (`:698-699`). Standing eye 1.62 sees through; crouched eye 0.97 does not; a 1.38 m jump apex still hits the header. It is a port, not a hole.
- `snapPoiToLand` + `dryFrac` (`maps.js:797-816`) move Isla Viva's five inland POIs from −3.8..+2.0 m / 0–48% dry to +1.2..+6.3 m / 60–100% dry. Palm Bay house build rate 0/8 seeds → 72%.
- Cover density independently re-measured, not read from comments: Ashgrid 318 → **862** solid colliders, Deepwood 851 → **966**, Isla Viva 129 → **242**; mean distance to nearest cover ~22 m.

**Audio — spatialisation verified running, not just present**
- Real `HRTF` `PannerNode` with a camera-driven listener (`audio.js:194-254`). Live graph read-back: listener at the exact camera position, orthonormal pitched up-vector, panner at camera+(10,5,10) — front/back and above/below are real for the first time. `createStereoPanner` appears nowhere.
- Per-class `AUDIBLE_M` (`audio.js:265`) — sniper 520 m now covers its own 400 m falloff floor. Four independent per-shot decorrelators kill the full-auto comb. Three continuous beds confirmed live with a positioned storm roar that carries a bearing.
- Exactly 1 ConvolverNode (0.45 s generated IR), 1 DynamicsCompressor (−6 / 20:1), 1 MediaElementSource — verified by patching the AudioContext prototype before the unlock gesture. Music is genuinely inside the graph and duckable.

**Feel, HUD and first-run**
- Firing now moves the screen: `SHOT_SHAKE`/`SHOT_FOV` (`fx.js:94-95, 169-172`) both consumed; view-model 5 cm punch (`weapons.js:271-274, 439`); hitstop at `ffg_royale3d.js:493-496`.
- **The enemy hit flash renders for the first time.** `fx.js:151` now drives `material.userData.zFlash` (`player.js:284-285, 292`); the old `.color` path was algebraically cancelled by the zone-tint shader and, per the source comment, "shipped invisible on 100% of actors."
- `camShake` double-decay removed — one decay at `player.js:1274`. Durations restored (AR 39 ms, sniper 144 ms, explosion 283 ms).
- Loading bar is honest: `player.js:176-181` counts 45 real assets, verified live reading "98% / LOADING OPERATIVES 45/45". Real boot splash before any JS.
- Interact prompt names the outcome including refusals (`hud.js:2205-2220`) — it did not exist at all before.
- Player name field, CAREER screen, copy-invite-link, `?room=` deep link, three **wired** accessibility controls (shake OFF/HALF/FULL, sound-indicator toggle, career transfer code), coarse-pointer gate.

**Multiplayer in-match layer** — teams end-to-end with a shared placement-1 win condition (`player.js:60`, `player.js:1306`, `sim/royale.js:499-526`); remote pitch + stance bitfield so remotes are no longer animation-dead; correct bot damage attribution; a shared match clock with slew and a >3 s snap.

---

## 4. SHIPPED BUT INERT — effort spent for zero player benefit

**This is where the program leaked.** Everything below runs, or is shipped, and produces nothing a player can perceive.

### 4.1 Shipped in this program, does nothing (or nearly nothing)

| # | Item | Location | What actually happens |
|---|---|---|---|
| 1 | **FOV punch decays before it is applied** | `player.js:1290-1291` | One full frame of decay is eaten before it renders. At 60 fps an SMG's 2° punch renders as 1.25°; at 30 fps as 0.5°; **at ≤20 fps it is erased to exactly zero.** The identical bug was found and fixed for the shake channel two blocks up. One-line swap. |
| 2 | **FOV punch ignores the shake accessibility setting** | `player.js:1291` | `W.settings.shake` scales `camShake` only. A motion-sensitive player who sets shake OFF still eats a 5° FOV pulse on every shotgun and sniper shot — a stronger nausea trigger than the translation they just disabled. |
| 3 | **`landed` dust + thump are drop-only** | `fx.js:292-295`, `audio.js:544` | The **only** `emit("landed")` in the repo is `player.js:817`, inside the gliding branch. The ground branch emits only `hardLand` at vy < −16. So both handlers fire **once per actor per match**, at the end of the parachute drop, and never for a jump. Every jump still lands silently and invisibly. |
| 4 | **`hardLand` consumes speed for particles but never shakes** | `fx.js:288-291` | The recommendation was burst **plus** camShake scaled by impact speed; the speed argument is passed and used only for particle count. There is still no camera response to any landing at any speed. |
| 5 | **Rookie chute hint is unreachable on the mode rookies are steered into** | `hud.js:1647-1652, 1949-1951` vs `hud.js:642` + `royale.js:285` | The hint requires `p.gliding`; the same program promotes QUICK MATCH to the top card for `career.matches < 3`, and QUICK is a **ground drop**. Two first-run features from two different queues cancel each other. |
| 6 | **Net send-budget shed branch is unreachable code** | `net.js:128` vs `CRITICAL_MSG` at `net.js:109` | `CRITICAL_MSG` lists exactly the nine message types the game ever sends. The shed branch can never execute. |
| 7 | **Net budget divisor is wrong by a factor of H** | `net.js:123` | Returns `100/H` sends/s; the correct figure for a 100 msg/s project cap is `100/H²`. **The file's own header states the H² law correctly at `net.js:6-8`.** Consequence: at H=2 — exactly the room size that goes over cap in a firefight — nobody ever sheds. |
| 8 | **Held-weapon LOD saves nothing in the frame that needed it** | `player.js:750` | Measured directly: with all 50 actors clustered inside 110 m, forcing every weapon visible changed the frame by **0 draw calls and 0 triangles**. It is a range-only optimisation; the drop cluster and every close-quarters fight get zero. |
| 9 | **Chest beacons exempted from the loot cull** | `loot.js:586-590` | Cancels ~1/3 of the cull's win. 112–142 always-visible objects cost **33–39% of the ground frame's draw calls** and 44–51% of its milliseconds, for ~1,300 triangles. The ground items got culled; the decorations stayed. |
| 10 | **Storm 10-second warning cannot save the player it fires for** | `storm.js:105-108` | Quick phase 1 needs ~40 s of head start; the warning gives 10. Measured max survivable spawn distance at warning time: **691 m against a 1,018 m max spawn distance.** The mechanism fires correctly and is decorative. |
| 11 | **Friendly fire is half-wired** | `player.js:1306` vs `weapons.js:577` | Damage is correctly blocked; `hitMarker` is emitted unconditionally on the next line. Shooting a squadmate paints the hitmarker and plays the 950 Hz ping for zero damage — the game confirms a hit that did not happen. |
| 12 | **PLAY AGAIN destroys the room** | `ffg_royale3d.js:464` vs `net.js:486-489` | `leave()` was deliberately placed on MAIN MENU "so a future REMATCH can still reuse the room" — and PLAY AGAIN calls `netMod.leave(W)` then starts a **solo** match. After an online match the squad is silently dissolved with no message. |
| 13 | **Desktop-only gate fires twice** | `ffg_boot3d.js:52` → `hud.js:747` | PLAY ANYWAY never writes `lc_seen_kbm`, so the menu immediately shows a second near-identical modal. A phone visitor dismisses the same message twice. |
| 14 | **Local lighting is 2 prop types, not ~30** | `maps.js:1647` | `EMIT` covers exactly two hex colours (lamp head, lighthouse lens). Anywhere further than 60 m from a town, all four PointLights sit parked at intensity 0 at (0,−999,0). For most of a match the world still has 2 lights. |
| 15 | **`scatterTrees` fifth argument dropped on the floor** | `maps.js:769` vs 10 call sites | All ten call sites pass a surface tag (`"wood"`, etc.); the function takes four parameters and nothing reads `arguments`. Shipped intent that does nothing. |
| 16 | **`hut()` window/door offsets are not rotated** | `maps.js:647-649` | The source comment admits it. Currently unexposed only because all twelve call sites pass `rot = 0`. The first rotated hut comes out as a pinwheel — the exact bug just fixed in `house()`. |
| 17 | **`ROOKIE_TIER_MIX` is untestable** | `bots.js:32`, `royale.selftest.cjs:150-154` | Module-private, never exported; the sum-to-49 invariant is asserted for the other two mixes only. The tier draw divides by a hard-coded 49 — a future edit that breaks the sum silently skews every rookie lobby with nothing to catch it. |
| 18 | **`shakePrev` dead residue + stale comment block** | `fx.js:326, 346, 459-472` | Declared, reset, never read. The 15-line comment still describes decay logic that now lives in `player.js` and will mislead the next edit. |

### 4.2 New defects the program introduced

| Item | Location | Effect |
|---|---|---|
| **Grey grass standing in deep snow** | `maps.js:1865` | The new clutter layer has no biome gate — only a water check. Tufts spawn across Deepwood's snow biome, tinted from the snow colour, reading as debris across the whole frame. Captured in both Deepwood ground shots. |
| **Tap-frame weapon dump at chests** | `loot.js:640-643` | On the first frame of an E hold, `_eHoldT` is under 0.18 so the target is the nearest *item*. With a full inventory, holding E to open a hut chest first throws your active weapon on the ground for whatever is lying next to it — and `maps.js:663-664` places both inside the 2.4 m radius. |
| **POI circles now overlap** | `snapPoiToLand`, `maps.js:808-816` | The snap tests dryness and never inter-POI distance. Over 200 seeds, two Isla Viva POI circles **overlap on 13.5% of seeds** (worst −145 m) and come within 40 m on 33.5%. The authored table never came within 80 m. |
| **Rookies routed into the one unfixed critical** | `hud.js:642, 664-670` | QUICK MATCH is promoted and badged "START HERE" for zero-match players. Measured quick phase-1 storm death: **5.8% at perfect play, 28.2% reacting to the warning, 44.6% looting through the wait.** Before this program a rookie's first match was standard, which is provably safe (0% storm deaths over 500 seeds). |
| **Terrain +83k triangles on the most uncullable mesh** | `maps.js:364` | SEG 220 → 300 = 96,800 → 180,000 tris, bounding radius 1,131 m, submitted every frame. Deliberate visuals trade, but a performance debit the program added. |
| **Fog costs the drop its read of the island** | `maps.js:36-40` | 3.8–4.3x density is a genuine aerial-perspective win, but a POI is now ~55% blended at 500 m. From 240–270 m up you can no longer scout the far half of the map, and you cannot plan a rotation by eye past ~300 m. Needs an owner ruling, not a revert. |

### 4.3 Long-standing inert code the program did not clear

- **The entire recoil system is cancelled by its own recovery.** `weapons.js:445` kicks; `weapons.js:254` recovers at 6.88°/s. Computed accumulation: AR 3.47, SMG 4.13, pistol 3.06, shotgun 2.29, sniper 1.67, GL 1.84 °/s. **Every weapon is below the recovery rate.** The code runs every frame and no crosshair ever climbs.
- **The largest accuracy mechanic in the game is human-only in practice.** `royale.js:171` grants the 0.15x first-shot bonus only at speed < 0.6; `bots.js:629` writes an unconditional strafe in `actEngage`. Every AR/SMG/pistol/shotgun bot in a 49-bot lobby is permanently disqualified.
- **`HEAL.speedMult` / `blocksSprint` are inert for bots** (`royale.js:121` vs `bots.js:171, 554`) — a fresh asymmetry in the player's favour that also leaves every healing bot a stationary 2–8 s target.
- **7 of 9 `W.stats` fields are declared and never written** (`ffg_royale3d.js:278`). Only `shotsFired` and `shotsHit` exist. Consequence: the CAREER "Favourite weapon" row (`hud.js:2888-2892`) is shipped and permanently empty, and the richer post-match screen has no ledger to read from. `killsByCls` is one line at `player.js:1353`.
- **`W.hooks.score` / `.save` / `.achievement` / `.celebrate` never fire** (`hud.js:2412, 2659, 2726-2736`). Three are documented as deliberate scaffolding; **`celebrate` is undocumented dead code** — `grep celebrate runtime/` returns that one line.
- **The rarity numeral is overpainted by the slot index** (`hud.js:2162-2166` vs `hud.js:2185`) — same 3px offset, same 9px size, appended last. The one colour-blind redundancy the codebase already paid for is unreadable.
- **`quickMatch()` is fully implemented with zero call sites** (`ffg_netplay.js:98-130`).
- **`hide_fullscreen_button` is read twice and set by no file anywhere** (`game_controls.js:211, 225`; `index.html:68`). The CrazyGames-prohibited custom fullscreen button is still in the artifact.
- **Two audio handlers are literal empty functions** — `jump` (`audio.js:545`) and `stormKill` (`audio.js:542`). **`healStart` throws away the channel duration** the call site already passes (`audio.js:529` vs `player.js:1416`), which is exactly what a positional heal loop needs.
- **`settings.chuteColor` is read with no writer** (`player.js:1012-1015`). **Practice mode flashes "+375 XP" that `addXP` never pays** (`hud.js:1893` vs `:1416`). **`W._netStats.dropped` is written every frame and rendered nowhere** (`net.js:556-557`).
- **Hitstop is disabled entirely online** (`ffg_royale3d.js:495`) — deliberate and correct, but online play gets no impact freeze at all.
- **Sniper reticle teaches bullet drop the simulation does not have** (`hud.js:2135` vs `weapons.js:427`).
- **Four stale comments that will mislead the next edit:** `player.js:782-784, 872` say the chute auto-deploys at 60 m; the code says 110 m. `audio.js:347-348` says net replicates neither stance flag; `net.js:452` replicates crouch. `maps.js:1617` advertises launch portals as a rotation tool that measures ~7.5 m/s against a 9.6 m/s sprint. `fx.js:459-472` describes decay logic that moved files.

---

## 5. WHAT STILL BLOCKS PARITY

### 5.1 VISUALS (slightly_behind)

The frame no longer contains rendering *defects*. What remains is an art *content* gap: 105 `addBox` calls compose every building against Final Drop's 159 prefab templates and 624 Synty render assets; `grep CSM` = 0 hits; `grep decal` = 0 hits; zero geometric LOD or billboards against 863 measured LOD entities.

| Item | Size | Who |
|---|---|---|
| **Gate ground clutter on biome + raise density** (`maps.js:1865, 1833`) — live defect this program introduced | S | me |
| Two-tier foliage: GLB inside 90 m, cross-billboard beyond, atlas painted procedurally like `clutterTex()` | M | me |
| Cascaded shadow maps via `three/addons/csm/CSM.js` — already reachable through the importmap, no build change | M | me |
| Chunk terrain into 8×8 × 200 m tiles; per-chunk frustum culling for free | M | me |
| Pooled decal layer, 128 instanced quads, normals already returned by `weapons.js:555` | M | me |
| Water pass: foam band, depth gradient, cheap planar reflection | M | me |
| Expand local lighting from 2 emissive colours to ~30 props, 4 → 8 lights (sequence after draw-call work) | M | me |
| **Modular prefab building kit** replacing the box generators — the single largest driver, and what a player judges first | **L** | **OWNER — asset money.** Kenney CC0 is free but reads distinctly Kenney; a Synty-equivalent is a purchase. |
| Character attachment props (cap, helmet, backpack) | M | **OWNER — new 3D assets; standing rule is never generate Meshy without asking.** |

**Engineering-only ceiling: closer, still behind.** Parity is gated on the building kit decision.

### 5.2 AUDIO (slightly_behind)

The systems layer is now at or past the benchmark. The content layer is not: `assets/audio/` contains exactly three files, all music, all still 64 kbps MPEG-1 Layer III, byte-identical to the prior score. Final Drop delivers its **entire 125-clip SFX library in 2.59 MB** — one sixth of Last Circle's audio payload.

| Item | Size | Who |
|---|---|---|
| Positional heal loop for the channel duration — `player.js:1416` already passes `c.useS`, `audio.js:529` already discards it | S | me |
| Mono-downmix toggle + small-speakers preset (pattern established by `soundVis` at `hud.js:2999`) | S | me |
| Replicate the sprint bit in `net.js`'s stance bitfield; fix the stale comment at `audio.js:347-348` | S | me |
| Track enemy reload timers (`audio.js:427-429` only pushes handles when `own` — a dead enemy's gun still racks its slide) | S | me |
| Give `jump` / `stormKill` a body; add a `levelUp` cue | S | me |
| Crossfade or lengthen the three 1-second noise beds; make the reverb graphics tier take effect mid-session | S | me |
| **Recorded one-shot pack: ~12-18 clips, well under 1.5 MB** — the one item separating this from parity on the axis a player judges in ten seconds | **M** | **OWNER — money, and it reverses the no-new-binary-assets rule that every generated bed in `audio.js` exists to honour.** |
| Music re-encode to 96–112 kbps + a 3-4 minute loop (drops ~12 MB, raises quality) | S | **OWNER — your own catalog; which section loops is authorial.** |
| Vocal layer: hurt grunts, jump exhale, death vocalisation | M | **OWNER — same asset question; bundle with the pack.** |

**Audio parity is one purchase away and otherwise unreachable.** Synthesis cannot carry a human grunt.

### 5.3 PROGRESSION-RETENTION (slightly_behind)

Both prior criticals are genuinely closed. What a polished commercial browser BR has and this still lacks is exactly two structural objects: **a leaderboard and a dated season.**

| Item | Size | Who |
|---|---|---|
| Weekly challenge layer — pure reuse of `dailyIdsFor`/`loadDaily` with a week key | S | me |
| Increment `W.stats.killsByCls` at `player.js:1353` so CAREER's Favourite weapon stops being dead | S | me |
| Expand the pool onto counters that already exist (`heads`, `longestKillM`, `stormDmg`, `legendaries`) — one `CHAL_POOL` line each | S | me |
| Attach a reward to `dayStreak` — the counter is correct and persisted and pays nothing | S | me |
| Stop practice mode flashing XP it never pays (`hud.js:1893` vs `:1416`) | S | me |
| Reward content above L22 — chute-colour track is cheapest (`player.js:1012-1015` already reads it) | M | **OWNER — how much cosmetic content is worth building; possible art spend.** |
| **Make SEASON 1 real, or delete the label** (`hud.js:547` — `grep season runtime/` returns nothing else) | S | **OWNER — season length, end date, and above all whether anything RESETS. Deleting the string needs no decision.** |
| **Online leaderboard** (rolling 7-day) | M | **OWNER — infrastructure exists (`net.js:32` Supabase URL; dungeon-forge runs one on the same project). Blocked purely by the no-outward-call constraint.** |
| **Cross-device sync** | M | **OWNER — same constraint. Note this is a *stated CrazyGames platform requirement*, so it is a publish blocker on that channel, not just a parity item.** |

### 5.4 MULTIPLAYER (far_behind) and MONETISATION-READINESS (far_behind)

These two are categorically behind and neither is fixable by code alone.

**Multiplayer.** The single fact that produced the prior score is unchanged: **the transport exceeds its own cap during play at every supported room size.** Derived from the shipped code — H=4 quiet ≈ 144 msg/s, H=3 quiet ≈ 108 msg/s, H=2 quiet 72 msg/s but ≈132 msg/s in a firefight, all against a 100 msg/s ceiling Supabase enforces by *dropping the connection*. One quiet 4-player match burns ~112,000 of 2,000,000 monthly messages — **about 18 matches per month for the entire game**, on a project shared with every other ForgeFlow title. The prior recommendation (stop relaying bots, simulate all 46 deterministically from the shared seed) was not taken and is still ~1/3 of the quiet budget.

| Item | Size | Who |
|---|---|---|
| Fix the budget divisor to `100/H²` (`net.js:123`); make the shed branch reachable or delete it (`net.js:128`) | S | me |
| Suppress the hitmarker on teammates (`weapons.js:577`) | S | me |
| Make PLAY AGAIN keep the room (`ffg_royale3d.js:464`) | S | me |
| Derive the lobby roster from the real assignment; presence-check `randCode()` before committing | S | me |
| **Host migration + guest-side watchdog** — today a host who quits leaves an unwinnable match with frozen, unkillable bots (`net.js:560, 490`) | M | me |
| Rejoin; squad loop (knock/revive — `downedAt` is already reserved); ping/marker system | M each | me |
| Trust boundary (`start`/`died`/`takeover` host-gated, damage cap, rate limit) — required *before* any public path | M | me |
| **Stop relaying bot snapshots** — deterministic bot sim from the shared seed | **L** | me (needs a determinism test, not a hand check) |
| **Decide the transport ceiling** — Supabase Pro (~$25/mo) or WebRTC + TURN | M | **OWNER — MONEY + INFRA, and TURN is a new third-party dependency against the stated constraint. Even after the bot fix the free tier cannot carry 4 humans.** |
| Public matchmaking + server leaderboard | M | **OWNER — product call; collides with the same constraint.** |

Against Final Drop's 100 real players on its own backend, a 4-human code-gated room is not "slightly behind" at any level of polish.

**Monetisation-readiness.** `grep -rniE "crazygames|sdk|adsbygoogle|gtag|requestAd|rewarded"` across every `.js`/`.html`/`.json` returns **zero integration hits.** Four of five free portal-QA blockers closed (sitelock, working pause, player name, invite links) — real movement inside the band. But:

| Item | Size | Who |
|---|---|---|
| Local-only instrumentation (matches/session, menu→match drop-off, day-2 return) — compatible with the constraint, and without it every future change is unmeasurable | S | me |
| Delete 5 `.openhands.bak` files (3,790,564 B, no code reference) | S | me |
| Vendor `three.module.js` (a copy already sits unused at `forgeflow-games/three172.js`) and drop `cdn.jsdelivr.net` from the blocking dependency of the whole module graph | S | me |
| **Hide the prohibited custom fullscreen button** | S | **OWNER — `game_controls.js:26-28` records that forgeflowgames.com removed its portal-level fullscreen button, so this bar is the only fullscreen entry point on the self-hosted build. One index.html without fullscreen, or two index.html files.** |
| Emit portal `forgeflow:game_over` / `achievement` / `save` (4 other games already do; postMessage to the first-party portal, no direct network call) | M | **OWNER — data leaves the game frame. Highest-value item the constraint actually permits.** |
| **Any ad/IAP path** | L | **OWNER — currently forbidden. Until this flips, this dimension cannot reach parity by any amount of engineering.** |

### 5.5 DEFECTS THAT BLOCK PUBLISH REGARDLESS OF SCORE

These sit on dimensions already scored parity. Fix them before publish independent of the parity question.

1. **Isla Viva can generate an unfightable match.** `Storm` receives no height function (`storm.js:19`). Over 300 seeds the final circle is **entirely at sea on 4.7%** and under 50% land on 5.3%. `weapons.js:336` disables firing while swimming, so those matches resolve by storm tick with nobody able to fight. Isla Viva is 1 of 3 maps → **~1.6% of all matches.** Fix: sample ~20 points in the candidate disc, reject sea centres. **S, no owner call.**
2. **Quick mode kills 28–45% of new players to the storm before a fight starts** — and the same program badged it "START HERE" for zero-match players. Fix: one intermediate row in `STORM_PHASES.quick` (`royale.js:273`) drops the first wall to ~7.7 m/s, under the 9.6 m/s sprint. **S, no owner call** (the damage-ramp delay at `storm.js:123` *is* an owner call — you specified that ramp).
3. **Online host quit → permanently unwinnable match.** The 12 s watchdog is gated `if (S.net.isHost())` (`net.js:560`). Bots freeze at their last `netTarget` and become unkillable. **M.**
4. **Tap-frame weapon dump at chests** (`loot.js:640-643`) — regression introduced this round. **S.**
5. **Grey grass in Deepwood snow** (`maps.js:1865`) — regression introduced this round. **S.**
6. **Three outward third-party calls already ship while the constraint says none are wanted:** Google Fonts on the critical path (`hud.js:52-58`), `cdn.jsdelivr.net` for three (`index.html:20-22`), `esm.sh` for supabase-js (`ffg_netplay.js:41`). All three are S-effort to self-host and two already have vendored copies in the repo.

---

## 6. HONEST BOTTOM LINE

**You cannot reach "parity or ahead on all 16" by writing code. Four decisions gate it, and three of them cost money or reverse a constraint you set.**

**The shortest path, in order:**

**Step 0 — free, ~1-2 days, do this regardless of everything below.** Six S-effort fixes clear the publish-blocking defects (land-aware storm, quick phase 1, tap-frame swap, snow clutter, POI separation, `lc_seen_kbm`), and roughly fifteen more S-effort fixes clear §4's inert list — the FOV punch ordering, the `landed` emit, the shake setting covering FOV, the teammate hitmarker, PLAY AGAIN keeping the room, `killsByCls`, the rarity numeral, the net budget divisor, the dead `celebrate` hook, the four stale comments. **None of these need you.** Together they convert a meaningful slice of already-spent effort from zero player benefit to real player benefit — the cheapest quality available anywhere in this project right now.

**Step 1 — the four decisions, in the order that unblocks the most.**

1. **Monetisation: re-scope the bar.** Against a monetised benchmark, an unmonetised game is categorically behind and always will be. Either lift the ads constraint or — my recommendation — **strike monetisation-readiness from the "all 16" bar and mark it constraint-blocked.** Do the S-effort portal-QA items anyway (fullscreen flag, `.bak` deletion, vendored three, local instrumentation), then stop spending there. This alone changes the bar from 16 to 15 and from unreachable to reachable.
2. **Audio: buy an SFX pack (~$50–200, M-effort integration).** This is the single highest ratio of score-movement to cost anywhere on the board. The architecture is already at or past the benchmark — HRTF, reverb, limiter, range-keyed weapons, whiz-by, music intensity, all verified running. It is playing the wrong sounds through a better system than Final Drop's. **Audio → parity, one purchase.**
3. **Visuals: pick a building kit.** Kenney CC0 is free and reads as Kenney; a Synty-equivalent is a real purchase. Either way this is the largest remaining art driver and the thing a side-by-side screenshot loses on. The four code-only M items (CSM, billboards, terrain chunking, decals) are worth doing regardless and should run in parallel — but they will not close the gap alone.
4. **Multiplayer: decide the transport ceiling, or descope online.** Supabase Pro (~$25/mo) or WebRTC+TURN. Be clear-eyed: even after the L-effort bot-relay fix and every M item on that list, a 4-human friend room is not parity with 100 real players on a dedicated backend. **My recommendation is to descope multiplayer from the parity bar and ship the game as a single-player-vs-46-bots product** — which is what it already is, given the human cap is 4 of 50 slots. That reframes multiplayer from a failing dimension to an optional bonus feature, and it means the only remaining money decisions are #2 and #3.

**If you take the recommended path** — descope monetisation and multiplayer from the bar, buy an SFX pack, pick a building kit — you are at **14 of 14 parity-or-better** with roughly two weeks of code work plus two purchases. Progression closes with the five S-effort items plus a real season (code-only) and a leaderboard that stays off until you want a network surface.

**If you hold all 16 and all constraints,** the honest answer is that the bar cannot be met and the game does not publish. That is not a statement about the parity program, which moved 15 of 16 dimensions and regressed none. It is a statement about a target that requires spending against constraints that forbid it.

**One process note worth more than any single fix:** two features in this program cancelled each other (the rookie chute hint versus the rookie quick-mode steer), and a third pointed new players at the one critical defect nobody fixed. Both are queue-boundary failures — each agent was right inside its own dimension. A cross-queue check before the next program lands would be cheap and would have caught both.