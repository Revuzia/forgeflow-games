# R12: League of Legends Parity Benchmark (graphics, attacks, abilities, cooldowns, camera, HUD, performance)

**Project:** VALE (Forgeflow Games), an original browser-based competitive lane-brawler (custom Three.js / WebGL2 client)
**Date:** 2026-10-20
**Reference:** League of Legends (LoL), current patch as of autumn 2026. We treat it as a **minimum quality bar to meet or beat. We do not copy its designs.** Every VALE fix below is an original design.
**Status:** working document, not committed. It supersedes the LoL-bar parts of r04 and r06 where the two disagree (see section 5).

**Bottom line.** VALE's technology, camera, HUD skeleton and accessibility are at or above LoL. Its in-match presentation is not. There are **five blockers**:
1. Hovering an enemy freezes the 3D view.
2. No ability telegraph or aim indicator is drawn at all.
3. Ten of sixteen fighters have no model.
4. No measured run holds 60 fps at 1080p.
5. The ground is brighter than the effects that must read on top of it.

There are also **fourteen major gaps**, mostly in how attacks, wind-ups, crowd control and impacts are shown. Until the blockers are fixed, VALE's standard is below LoL's. The work order is in section 3.

---

## 1. Method and sources

### 1.1 How the LoL bar was measured

Three research passes collected the bar, and two judges then compared VALE against it.

**Pass A: full-match gameplay footage.** Seven official Riot videos.
- Frames were drawn from the paused video into a canvas, and brightness, saturation and sizes were read from the pixel data rather than judged by eye.
- Brightness is Rec.709 luma on a 0–255 scale; p50 is the median pixel and p95 the 95th percentile. Saturation is HSV, 0–1. All sizes are converted to 1080p.
- Timing traces sampled at 30 or 60 fps.

**Pass B: ability and attack clips.** Ten champions, stepped frame by frame.
- The clips are Riot's own videos on its champion pages. They are 1056×720 at exactly 30 fps, so one frame is 33.3 ms. They are effectively 1:1 crops of 1080p play: champions measure 90–130 px tall.
- Champions covered: Darius (basic attack, passive, Q, R), Lux (Q, R), Brand (W), Jinx (Q minigun and rocket basic attacks, R), Zed (R), Akali (E), Malphite (R), Janna (E) and Nidalee (R).
- One official spotlight video gave in-game scale.
- One community full-game video was used only for the full player HUD at 1080p.

**Pass C: Riot's published standards.**
- The full 37-page VFX Style Guide (2017).
- Riot dev blogs and red posts on the 2014 map update.
- Riot's graphics-pipeline article and the 2021 clarity article.
- A Riot VFX artist's realtimevfx.com write-up.
- The LoL wiki settings page.
- One extra 1080p gameplay video used to calibrate the camera.

**VALE side.** The judges measured VALE with:
- harness captures at 1080p (`bm_*` frames);
- a luma script run on the same frames;
- a layer-only telegraph probe that renders only the overlay pass and counts its pixels;
- the harness perf report (`_harness/_reports/perf_1080.json`);
- direct code reading. Code claims below were spot-checked against the tree on 2026-10-20.

**Images.** No LoL images, video or audio are in the repo. Analysis frames (`gp_*`, `frame_*`, per-champion `*_f*.jpg`) and the VALE captures (`lol_ref/vale/bm_*`) live only in the session scratchpad: `/private/tmp/claude-501/-Users-sitskovich-Developer-forgeflow-games/4e79f165-d0b0-4b1f-a3d3-f4bc44cd631b/scratchpad/lol_ref/`.

**Caveats.**
- YouTube compression softens fine detail.
- Most non-broadcast footage is zoomed in by the editor; overhead bars measuring over 150 px give it away. Sizes were taken only from frames at the normal camera distance.
- The Worlds footage uses the spectator camera and broadcast HUD.
- Sound was not studied; all clips were watched muted.
- The pre-cast aim indicators were seen only in practice-tool footage. Enemy-side ground-warning colours were inferred, not observed.
- VALE perf runs were taken against the Vite dev server on a machine loaded by other agents. Even the best of them misses the bar.
- The second judge's gap list reached synthesis truncated after its ninth item. Everything that arrived is merged below; anything after that cut-off was not seen.

### 1.2 Sources

| # | Source | Used for |
|---|---|---|
| V1 | Summoner's Rift Preview (2014), https://www.youtube.com/watch?v=FiSNHAJHu-c | Layer priority, 2014 player HUD, cooldown behaviour, camera |
| V2 | Summoner's Rift Gameplay (2014), https://www.youtube.com/watch?v=WHTCprqzexo | Environment values, no HUD |
| V3 | How To: Dominate with Zaahen, https://www.youtube.com/watch?v=qQNuoySpVMc | Targeting indicators, skillshot timing, floating text (1080p60) |
| V4 | Locke Champion Spotlight, https://www.youtube.com/watch?v=ynG4T9yLKFs | In-game scale, basic attack, lost-HP flash, impact envelope |
| V5 | Worlds 2026 Play-In Day 1 Highlights, https://www.youtube.com/watch?v=1730_cjUjfE | Current-patch values, impact envelope, no-shake tracking, kill banner |
| V6 | Season 1 2026 Dev Update, https://www.youtube.com/watch?v=R5Ff-0aUpIk | Current player HUD |
| V7 | The Strong Gather (2025 gameplay trailer), https://www.youtube.com/watch?v=1GF5DayBPS4 | Seasonal map dressing |
| C1 | Champion pages with embedded ability clips, e.g. https://www.leagueoflegends.com/en-us/champions/darius/ (clips served from `lol.dyn.riotcdn.net/x/videos/champion-abilities/…`) | Frame-by-frame attack and ability timing |
| C2 | Garen top gameplay, community upload, https://www.youtube.com/watch?v=vczYSIgZgVE | Full 1080p player HUD, FPS counter |
| C3 | 1080p no-commentary gameplay, https://www.youtube.com/watch?v=fJQdB3UCGCA | Camera calibration (310-unit circle), minimap camera box |
| R1 | Riot VFX Style Guide (2017), https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf (read via https://web.archive.org/web/20201207180246/ of that URL) | Value, colour, shape, timing and importance rules |
| R2 | Style guide announcement, https://web.archive.org/web/20201112042217/https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/ | Context for R1 |
| R3 | 2014 map update dev blog, https://www.surrenderat20.net/2014/06/update-to-summoners-rift-headed-to-pbe.html | Layer hierarchy with UI on top |
| R4 | Red post collection, https://www.surrenderat20.net/2014/06/red-post-collection-more-on-summoners.html | Particles above characters above environment |
| R5 | Camera dev-blog posts, https://www.surrenderat20.net/2014/06/red-post-collection-dev-blog-on-sr.html and https://www.surrenderat20.net/2014/11/red-post-collection-updated-summoners.html | FOV lowered, camera pulled back, trapezoid view |
| R6 | A trip down the LoL graphics pipeline, https://www.riotgames.com/en/news/trip-down-lol-graphics-pipeline | Skinned-mesh lighting, outlines, prebaked shadows, frame triangle budget |
| R7 | Anatomy of a LoL missile, part 2, https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-2-what-are-we-communicating-with-our-vfx/13062 | 1–10 importance per viewer, status-effect language |
| R8 | Clarity in League (2021), https://www.leagueoflegends.com/en-gb/news/dev/clarity-in-league/ | Clarity rules, hard-CC prominence, skin parity |
| R9 | VFX clarity updates, https://devtrackers.gg/leagueoflegends/p/95a9bd74-nocturne-viktor-malzahar-and-ignite-visual-effects-updates | What clarity passes change in practice |
| R10 | LoL wiki settings, https://wiki.leagueoflegends.com/en-us/Settings | Camera lock modes, toggles |

---

## 2. Scorecard by dimension

Each row says what LoL does (measured where possible), where VALE is now, and the gap IDs from section 3. B = blocker, M = major, m = minor.

| Dimension | LoL bar (measured) | VALE now | Verdict |
|---|---|---|---|
| **Camera** | Pitch ≈ 53–56° (ground-circle squash 0.71–0.86). Champions 105–130 px, about 10–12 % of screen height. About 3,000 game units visible across screen centre. Free or locked camera. No shake (V5, C1). | 52° pitch, fighters 96–132 px, zoom 24.5–33 m, four camera modes, edge pan, spectator zoom. Shakes on ultimates and impacts. | **Matches**, except shake (m4) |
| **Environment value** | Terrain at 25–40 % brightness. Lane p50 88–91 with 23–45 levels of spread, walls 36–39, jungle 27–45. Frame p50 ≈ 58, p95 76–129. Ground saturation 0.17–0.40. Values above ≈ 180 kept for VFX and UI (V1, V2, V5). | Lane p50 158–169 at saturation 0.08–0.15. Frame p50 93–169, p95 167–176. Canopy p95 up to 168. | **Far below** (B5) |
| **Environment craft and life** | Painted blades with dark-to-light tips. Brazier flames (luma 148, saturation 0.65). Team banners, glowing plants, critters, quadrant tinting (V1, V5). | Good walls and coursed stone. Plastic-looking faceted crowns, static trees, flat boulders, brush that buries your own fighter, no ambient life. | Below (M11, M14) |
| **Characters** | Every selectable champion is finished. The value range is wider than the ground's. Rim outline on hover (R6). | 6 of 16 fighters finished at a high spec (17–22k tris, 15 clips, 2 skins). 10 have no mesh. Hovering crashes the renderer. No always-on outline. | **Blocker** (B1, B3), M10 |
| **Minions** | About 55 % of champion height, team-tinted armour, the two sides differ in shape (V1). | Both teams use the same white-hooded model. The hoods out-value the fighters (p95 226). | Below (M8) |
| **Structures** | ≈ 216×264 px, ≈ 2.2× champion height. Damage shown gradually; rubble on death (V4, V5). | 400–605 px, up to 4× fighter height, no occlusion handling. Pop out of existence on death. | Below (M9) |
| **Basic attacks** | Wind-up 250–400 ms in three readable poses. Swing trail or tracer, muzzle flash ≈ 0.3× champion height, impact starburst ≈ 0.7× victim height for ≈ 200 ms, victim flash 1–2 frames (C1, V4). | Melee wind-up 0.53–0.58 s, no swing trail, 3 shared projectiles without muzzle flash. Light-hit impact near invisible. No reaction on the victim. | Below (M5, M6) |
| **Ability telegraphs** | Every ability shows a ground indicator: translucent fill, bright 2–3 px rim, range circle. Delayed areas give 0.6–0.7 s of warning with a fixed edge and an inner timer (V3, C1 Brand W, R1). | The layer draws 0 px. Warnings would start only at release. 7 delayed areas are under 0.6 s and 3 are hidden from enemies. | **Blocker** (B2), M1 |
| **Ability anticipation** | Anticipation, then main hit, then dissipation on every effect. Wind-ups of 9–20 frames (300–670 ms). Releases in 2–4 frames (C1, R1). | No authored wind-up layer anywhere (0 in content/vfx.json). 48 of 54 timed casts have no cast VFX. | Below (M3) |
| **Ultimates** | About 1 s envelope: ≈ 0.25–0.3 s build, one frame at 2.3–2.5× scene brightness, ≈ 0.25–0.3 s hold, 0.3–0.45 s fade. No shake. 2–3× normal size, ≥ 6 layers (V4, V5, C1). | 15–20 layers. Flash of 0.06 s with no hold. Frame-median lift only 1.19×. Partly sold by shake. | Below (M13) |
| **Signature colour** | Every champion has its own effect hue; hit sparks share a warm white; team colour lives in indicators and rims (C1, R1). | 161 of 162 defs are team-tinted. Kits are interchangeable in colour. | Below (M12) |
| **Crowd control** | Every CC has an in-world visual for its full duration. Status words above bars. Hard CC reads stronger than damage (C1, V5, R7, R8). | 5 of 17 statuses have a visual, each a 1 s one-shot. No words or icons on the bars. | Below (M2) |
| **Cooldowns and Dial Bar** | Clockwise wipe; whole seconds, then one decimal under 1 s, then M:SS for long ones; white wash on ready over 0.25–0.3 s; gold border while active; red tint while locked; "not ready" text; buff row (V1, V6, C2). | Core sweep, decimals, rank pips, cost, no-mana tint, recast ring, charges and silence slash all present. Missing: M:SS, ready wash, active border, lock tint, buff row, refused-press text, regen readout. | Core **matches**; M4, m1 |
| **Overhead bars** | Champion 105–110×10 px plus a 4 px mana strip, 22–24 px level box. Minion 56–62×5–6, turret 250–265×20. Lost HP flashes bright for 2–4 frames, then drains (C2, V4). | Fighter 82×9, minion 40×4, structure 120×10. The self bar's damage trail is invisible. | Below (M7) |
| **Combat text and HUD suite** | Damage numbers coloured by type, gold pops, kill banner with two portraits (≈ 70 ms in, ≈ 3.3 s hold, ≈ 0.3 s out), minimap portraits ≈ 30–36 px (V3, V5, C2). | Numbers, gold pops, kill feed, scoreboard, death recap, ping wheel and minimap all present. Kill banners are text-only, the minimap uses dots, and nothing marks your own death on the world. | Mostly **matches**; m2, m3 |
| **Performance** | 1080p60 is the floor. One player capture read 134 fps. A typical frame is ≈ 200k triangles (R6, C2, V5). | 42–51 fps on High at best, p95 33 ms, p99 84 ms, 1.05–1.35 M triangles, 433–436 draw calls, CPU-bound. | **Blocker** (B4) |
| **Render tech and accessibility** | Prebaked static shadows, FXAA. Colourblind mode moves only "self" to yellow (R6). | HDR chain, N8AO, fitted PCF shadows, LUT, SMAA. Full deutan, protan and tritan alternates. | **Exceeds** |

---

## 3. Gaps in priority order

Blockers come first, then majors ordered by how much they hurt a player's ability to read and play a fight, then minors. Effort: S (≤ 1 day), M (a few days), L (one to two weeks), XL (multi-week art production).

### B1. Hovering an enemy freezes the 3D world (blocker, S)
- **LoL bar:** hovering a unit draws a clean rim outline at no frame cost: red for enemies, cyan for allies.
- **VALE now:** `Actor.setOutline` (src/render/actors.ts:585–601) adds outline copies as children inside `this.model.traverse(...)`.
  - The traversal then visits each new copy and copies it again. The probe saw the node count go from 32 to 8,840, followed by `RangeError` every frame.
  - The world stops drawing while the DOM HUD keeps ticking.
  - Hover-to-attack is the most common input in the genre, so this fires constantly.
- **Fix spec:**
  1. Collect first, then add: `const meshes: Mesh[] = []; this.model.traverse(o => { const m = o as Mesh; if (m.isMesh && !m.userData.valeOutline) meshes.push(m); });`. Then create one copy per collected mesh and tag it with `copy.userData.valeOutline = true`.
  2. Build the hull once in `attach()` with `visible = false`, so the first hover does not hitch. The show and hide paths (line 609 and `hideOutline`) toggle only meshes with `userData.valeOutline`, not by material identity.
  3. Hover style:
     - enemy and neutral units: 2.5 px in enemy #FF9A1F;
     - allies (new, in `renderer.updateActors`): 1.5 px in ally #3F9CFF.
  4. Harness test: hover an enemy for 3 s (180 frames). Assert the scene node count is unchanged after the first hover and the console has no errors.
- **Files:** src/render/actors.ts, src/render/renderer.ts, src/input/controller.ts, _harness/

### B2. No telegraph or aim indicator is ever drawn (blocker, S)
- **LoL bar:**
  - Every skillshot, ground area and own-aim indicator sits at ground level: a translucent fill with a bright 2–3 px rim and a thin range circle.
  - Enemy areas use a warm ramp with a darker inner element.
  - Delayed areas warn for 0.6–0.7 s with a fixed edge ring and a shrinking inner timer (C1 Brand W, V3, R1 page 26).
- **VALE now:** 0 px drawn.
  - The vertex shader maps quad XY to world XZ (`w = aA.xy + f*uv.x + s*uv.y`, telegraphs.ts:56–62) without the y flip that rings.ts:31 applies. That mirrors the winding.
  - The ShaderMaterial at line 163 has no `side`, so FrontSide culls every quad.
  - Forcing DoubleSide in page memory produced 226,643 px (`bm_telegraphs_if_doublesided_a.png`). The rest of the system works, and the underlying design is good.
  - Affected: enemy delayed areas, zones, cone and rect skillshots, and the player's own Q/W/E/R aim (`bm_marund_aim_a1/a3/ult.png`).
- **Fix spec:**
  1. Add `side: DoubleSide` to the ShaderMaterial in src/render/overlay/telegraphs.ts:163 (import it from three).
     - Alternative: flip the local v axis in VERT, `mix(lo, hi, vec2(position.x, -position.y) + 0.5)`, matching rings.ts:31, and negate the sweep progress so it stays clockwise on screen.
  2. Harness regression on every quality tier, using the layer-only render:
     - inject an enemy delayed area with `renderer.injectEvents([{e:'area', delay:0.6, telegraph:'everyone', shape:{kind:'circle', radius:3}, …}])`;
     - set `renderer.setAim({shape:'rect', length:9, width:0.9, …})`;
     - render 2 frames;
     - fail if the injected area draws < 5,000 px, or a1 aim mode draws < 20,000 px, at 1080p.
  3. Re-capture `bm_marund_aim_*` and one enemy delayed cast. Confirm the 3 px enemy edge at 90 %, the sweep closing exactly at landing, and the 150 ms landing flash.
- **Files:** src/render/overlay/telegraphs.ts, src/render/overlay/rings.ts, _harness/pw.mjs

### B3. Ten of sixteen fighters have no art and render as invisible bodies (blocker, XL; S gate first)
- **LoL bar:** every selectable champion is finished: model, about 15 clips, signature VFX, portrait, icon and splash. Nothing selectable is a placeholder.
- **VALE now:** only burdam, ervet, hesmi, kemdo, marund and odrum have a GLB, portrait, splash and icon.
  - The other ten are ardit, dunsom, ilsheta, lisvel, nurrow, rishal, sukri, tunlan, ulkro and vashil. They exist in content/fighters, and bots pick them; the pick screen shows glyph placeholders.
  - In a non-dev build, `actors.ts` draws them as "no mesh, overlays only": floating bars on an invisible body.
- **Fix spec:**
  - **Gate now (S):** a fighter is `artReady` only when `art.model`, portrait, icon and splash all resolve in the dist catalog. Exclude non-ready fighters from:
    - the pick pool;
    - the store;
    - `src/session/draft_brain.ts` bot picks;
    - `?queue` presets.
  - **Full fix (XL):** build the ten through the art 2.0 pipeline (art/blender/fighters/*.py) at the shipped spec:
    - 17–22k triangles;
    - 15+ clips, including crit and cast_a1–3/ult;
    - a role silhouette per tokens `fighter.roles`, and an accent of ≤ 5 %;
    - portrait, icon, splash and 2 skins;
    - each must pass the 64 px silhouette, grayscale and facing tests in tokens `fighter.silhouette`.
- **Files:** content/fighters/*.json, art/blender/fighters/, art/out/fighters/, src/session/draft_brain.ts, src/render/actors.ts

### B4. No measured run reaches 60 fps at 1080p (blocker, L)
- **LoL bar:**
  - 60 fps at 1080p is the floor. The official footage is 1080p60 with no repeated frames, and one player capture read 134 fps.
  - Riot's pipeline article puts a typical frame at about 200k triangles, about 90k of them particles, inside a 16.66 ms budget (R6).
- **VALE now** (High, 1080p, Apple M5):
  - densest RIFT fight: 42.6 fps average, p95 33.4 ms;
  - a second run: 51 fps, p95 33.4 ms, p99 83.7 ms;
  - the latest `perf_1080.json` (15:05, heavily loaded machine): 6.1 fps on High.
  - The renderer's own CPU `frameMs` is 35.7 ms on High and 37.3 ms on Low. **Low is not faster, so the bottleneck is CPU-side.**
  - Scene load: 1.05–1.35 M triangles (5–7× LoL), 433–436 draw calls, 52–55 programs, 137 actors.
- **Fix spec:**
  1. **Gate.** A harness perf step on a production build (`vite build` + preview), on an idle machine: RIFT densest fight (t = 900 s), 1080p, DPR 1, 10 s.
     - High must reach avg ≥ 60 fps, p95 ≤ 16.7 ms, p99 ≤ 25 ms, and renderer CPU `frameMs` ≤ 6 ms.
     - Low must reach p95 ≤ 16.7 ms.
     - Write the result to `_harness/_reports/perf_1080.json` and fail the run on a miss.
  2. **High budgets:** ≤ 500k scene triangles, ≤ 300 draw calls (≤ 450 is acceptable for the first gate while instancing lands), ≤ 40 shader programs. Medium and Low scale down proportionally.
  3. **CPU first:**
     - skip `mixer.update` for actors outside the frustum + 2 m;
     - tick off-focus wick mixers at 15 Hz beyond 12 m from focus;
     - LOD or instance wicks, which are most of the 137 actors;
     - move the Dial Bar cooldown text and sweep to an imperative rAF writer, as WorldLayer does. All ~20 slot components currently read `model.frame.value` and are suspected of re-rendering every sim tick; confirm with the profiler;
     - throttle `document.elementFromPoint` in `overHud()` to the hover cadence;
     - make DynamicResolution recognise CPU-bound frames, since its 0.8 floor cannot help them.
  4. **Triangles:**
     - report `sceneTris` per group (grass, canopy, terrain, clutter, actors, VFX);
     - cap grass blades per thicket by tier, with one instanced draw per chunk;
     - cull clutter and grass to the camera trapezoid (28.5 × 17.3 m) + 4 m;
     - Dialwood LOD: ≤ 750 triangles near focus, ≤ 250 beyond 15 m;
     - merge static clutter;
     - drop N8AO to quality 'Low' while the dynamic-resolution scale is below 0.9.
- **Files:** src/render/renderer.ts, src/render/actors.ts, src/render/terrain.ts, src/render/terrain_clutter.ts, src/render/quality.ts, src/render/post.ts, src/ui/hud/dialbar.tsx, src/input/controller.ts, _harness/

### B5. The ground owns the brightness band reserved for effects and UI (blocker, L)
- **LoL bar:**
  - Riot's stated layer order is UI first, then effects, then characters and units, then environment (R3, V1). In V1 Riot says "the first thing you should see is the UI, followed by visual effects".
  - Measured: lanes are the brightest terrain at luma p50 88–91, with only 23–45 levels of spread on walkable ground. Walls sit at 36–39, jungle at 27–45, foliage p50 43–52.
  - Frame p50 is 67–83 in player footage (≈ 58 across Worlds frames), p95 103–114, ground saturation 0.17–0.40.
- **VALE now:**
  - Lane stone p50 158–169 at saturation 0.08–0.15. Whole-frame p50 93–169 (BRIDGE 143, FRAY centre 169), p95 167–176. Canopy p50 82–91, p95 132–168.
  - Wick hoods reach p95 226, brighter than fighters.
  - Marund's ultimate lifted the frame median only from 157 to 187 (1.19×), because there was no headroom left.
  - The cause is VALE's own value law: tokens `grade.maps.rift.valueLstar` lanes [62, 68], map lane colour #A29A86.
- **Fix spec:** rebase the environment, not the lights, so fighters and VFX keep their values.
  1. tokens.json `grade.maps.*.valueLstar`:
     - **rift:** lanes [36, 41], campClearings [30, 35], jungleFloor [12, 20], wallTops [20, 28], wallFaces [12, 16], inscriptionBand ≤ 46, standingShadow [14, 18], fallenShaft [24, 30];
     - **bridge:** lane [36, 41], chasm [8, 16];
     - **fray:** honed plate [34, 40], hourLines ≤ 48.
  2. Re-derive `content/maps/map_*.json art.colors` under the unchanged sun. For example, lane #A29A86 becomes ≈ #5C574C (about ×0.31 in linear).
     - Raise ground chroma to C* 12–18 (HSV saturation ≈ 0.22–0.35).
     - Make the terrain.ts band mapping and the terrain_glsl.ts edge light honour the new bands, and cap the painted edge light at L* ≤ 48.
  3. LUT `vale_grade_01`: move the contrast pivot from 0.42 to 0.33.
  4. Acceptance, measured in the harness with VFX and UI hidden:
     - lane p50 85–100;
     - walkable p95 − p5 ≤ 45;
     - frame p50 55–75, p95 ≤ 130, p99 ≤ 160;
     - no environment pixel above 180, except authored lamp emissives covering ≤ 2 % of pixels;
     - fighters keep tokens `fighter.valueLstar` top25 at 70–85 (≥ 30 L* above lane);
     - wick hoods L* ≤ 65;
     - a T4 flash raises the fight-area mean by ≥ 2.0×.
  5. Re-run readability on all three maps at 720p Low, the camera sign-off tier.
- **Files:** _design/tokens.json, content/maps/map_rift.json, content/maps/map_bridge.json, content/maps/map_fray.json, src/render/terrain.ts, src/render/terrain_glsl.ts, art/out/grade/vale_grade_01.cube, tools/terrain_textures.py

### M1. Ground warnings start too late, are too short, or are hidden from enemies (major, M)
- **LoL bar:**
  - Delayed areas give 0.6–0.7 s of warning.
  - Long-range ultimates give about 670 ms of warning that everyone sees, and leaps show a landing alert.
  - Visibility is decided per ability and per viewer (R7), and hard CC must be clearly warned (R8).
- **VALE now:**
  - `director.ts` makes telegraphs only from `area` events, which fire at release. The `cast` event at wind-up start (castTime 0.1–0.4 s) draws nothing on the ground, so an instant area shows only a 150 ms flash after the hit.
  - Dash ultimates that land an area show no landing marker. Example: Marund's Domefall is a 0.3 s cast plus a 7 m dash at 12 m/s, ≈ 0.88 s, then a 3.5 m stun.
  - Damaging delayed areas under 0.6 s, as checked in content on 2026-10-20: dunsom a1 0.4 s, marund a3 0.5 s, odrum a1 0.5 s, sukri a1 0.5 s, sukri ult (second area) 0.25 s, vashil a1 0.4 s, vashil ult (inner area) 0.5 s.
  - Of those, marund a3, sukri a1 and sukri ult are `telegraph: "ally_only"`, so enemies never see them.
- **Fix spec:**
  1. **Wind-up telegraph** in director `cast`. When castTime > 0 and the ability is `telegraph: everyone` or contains a delayed area, push a telegraph:
     - timing: start = now, land = now + castTime (+ the area delay when it lands at the cast point);
     - shape: from `targeting.indicator`, falling back to the first area or zone shape (reuse the areaShape logic in src/input/abilities.ts);
     - anchor: the clamped cast point, or the caster for self, cone and rect shapes;
     - enemy style: HARM edge at 90 % and 3 px, fill rising 16 % → 30 %, sweep from 12 o'clock;
     - the matching `area` event replaces this telegraph instead of stacking a second one.
  2. **Dash-to-point** abilities with an on-arrive area draw an enemy-visible landing telegraph at the clamped point, with land = now + castTime + distance/speed.
  3. **Content:** every damaging or CC delayed area gets delay ≥ 0.6 s, and `ally_only` comes off marund a3, sukri a1 and sukri ult. Re-run the balance sims afterwards.
  4. **Content-build lint:** an area with delay > 0 and damage or CC must have telegraph ≠ `ally_only`/`none` and delay ≥ 0.6.
- **Files:** src/render/director.ts, src/render/renderer.ts, src/input/abilities.ts, content/fighters/{dunsom,marund,odrum,sukri,vashil}.json, tools/

### M2. Most crowd control is invisible, and none is named (major, L)
- **LoL bar:**
  - Every CC has an in-world visual that lasts its full duration: roots as rings, marks as icons, knock-ups as real airtime.
  - Words such as STUNNED or AIRBORNE sit above the bars and stay readable in 6–10-effect teamfights.
  - Hard CC reads stronger than damage-only effects (C1, V5, R7, R8).
- **VALE now:**
  - Only stun, root, slow, silence and reveal have VFX (content/client.json `vfxStatus`), out of 17 status kinds.
  - Each is a 1.0 s one-shot fired once (director.ts:252–258), so a 1.25 s root loses its visual before it ends.
  - No status words or icons, only a 2 px CC strip. tokens `hud.overheadBar.statusIconPx` 14 / `maxStatusIcons` 3 is specified but not implemented.
- **Fix spec:**
  1. Director `status`: spawn with `loopWhile` bound to the (entity, status) pair. Stop when that kind leaves `EntityView.statuses` or `remaining` ≤ 0, the same way zones loop.
  2. Author and map the 12 missing kinds. Hard CC plays at T3 and debuffs at T1, and each must read at 96–132 px:

     | Status | Visual |
     |---|---|
     | airborne | ground shadow ring, dust at launch and landing, vertical streak |
     | taunt | HARM tether to the taunter |
     | fear | jittering shade wisps |
     | sleep | slow drifting glyph |
     | disarm | broken-weapon chip orbiting the head |
     | haste | low ground speed streaks |
     | invisible | allies see the unit at 35 % alpha with a shimmer |
     | untargetable | 40 % dither plus an edge rim |
     | unstoppable | pale rim shell |
     | grievous | dark ichor rim |
     | armor_shred, resist_shred | cracked-plate chips |

  3. src/render/overlay/bars.ts: up to 3 status icons of 14 px over the bar.
  4. Hard-CC word on fighters: STUNNED / ROOTED / AIRBORNE / SILENCED / ASLEEP / FEARED / TAUNTED / DISARMED / UNSTOPPABLE.
     - 13 px caps, weight 700, 2 px ink outline;
     - HARM on enemies, chalk-hi on self and allies;
     - 4 px above the name, fading in over 70 ms;
     - drawn from the BarLayer label atlas, with strings in content/strings.en.json.
  5. Raise the CC timer strip from 2 px to 3 px.
- **Files:** src/render/director.ts, src/render/overlay/bars.ts, src/render/renderer.ts, content/client.json, content/vfx.json, content/strings.en.json, _design/tokens.json

### M3. Casts have no anticipation (major, L)
- **LoL bar:**
  - Every effect runs anticipation, then main hit, then dissipation (R1).
  - Wind-ups are 9–20 frames (300–670 ms): Darius Q holds a raised axe for 600 ms, Lux Q forms an orb at the wand for 300 ms.
  - Releases take 2–4 frames. Instant ultimates still get a short tell, such as Darius R's 3-frame shadow. Charge-ups show a visual timer.
- **VALE now:**
  - The `phase: 'windup'` layer type is parsed (defs.ts:146) and playable (system.ts:576). But 0 of 1,083 layers in content/vfx.json use it, and the director never fires it.
  - 48 of the 54 abilities with castTime > 0 have no cast VFX at all.
  - The accent emissive ramp is too small to read at 96–132 px. Ultimates get only the generic 0.8 s `lib_ult_windup` ring.
- **Fix spec:**
  1. **Director:** on `cast` with castTime ≥ 0.12 s, spawn the ability's `present.windupVfx` (new field) with phase `windup`:
     - anchored to the weapon socket (`FighterArt.sockets`) and following the caster;
     - lifetime = castTime;
     - killed on cancel, fizzle or state change;
     - visible to enemies.
  2. **Author wind-ups** for all 54 timed casts.
     - T2:
       - socket glow ramping emissive 0.8 → the tier cap (T2 3.0, T3 6.0) over castTime;
       - 6–12 particles converging (radial −2) in the fighter's signature colour (M12; palette primary until that lands);
       - a 0.8 m ground ring at the caster, alpha 40 %;
       - for targeted or line abilities, a 0.1 s glint along the aim;
       - a release burst of 2–4 frames (66–133 ms) at castTime.
     - T4: keep `lib_ult_windup` and add a signature charge layer at least 1.5× the T2 size.
  3. **Instant ultimates and casts under 0.12 s:** a 100–130 ms silhouette flash or socket flare before release.
  4. **Acceptance:** re-capture `bm_marund_cast_*`. A visible charge must show from frame 1 of the cast.
- **Files:** src/render/director.ts, src/render/vfx/system.ts, src/render/vfx/defs.ts, content/vfx.json, content/fighters/*.json

### M4. The HUD hides your own loss of control, buffs and refused presses (major, M)
- **LoL bar:**
  - A row of ≈ 26 px buff and debuff icons with stack counts and coloured borders sits above the bar.
  - Abilities and items tint dark red while you cannot use them, and a "not ready" message appears.
  - The 2015 HUD update made loss of control more prominent, and an optional screen flash marks it (C2, V6).
- **VALE now:**
  - Nothing reads `EntityView.buffs` or `statuses` except the silence check in dialbar.
  - There is no lock tint, CC chip or buff row.
  - A refused press only shakes the slot by 3 px.
- **Fix spec:**
  1. **Buff/debuff row** in src/ui/hud/dialbar.tsx, placed above the HP bar via `FRAME.dialbar`:
     - 26 px icons, buffs then debuffs, at most 12 before a `+n` chip;
     - a clockwise ink duration sweep from 12 o'clock;
     - stack count bottom-right in Mono 11/700;
     - border in ally azure for buffs and HARM for debuffs;
     - tooltip with the name and remaining seconds.
  2. **`.is-locked`** on every ability and item slot during any hard CC: `filter: saturate(0.4) brightness(0.55)`, a #5A1A12 overlay at 45 %, and the status glyph.
  3. **CC chip** 36 px above the Dial Bar: glyph, word and a draining remaining/duration bar. It enters over 70 ms and leaves over 200 ms.
  4. **Refused-press caption:** 1.2 s above the Dial Bar, reading "Not ready", "Not enough {resource}" or "Silenced". Keep the shake.
  5. **Optional settings**, both off by default:
     - `access.locFlash`: a 150 ms HARM edge vignette at 20 % when hard CC lands;
     - `access.damageFlash`: a 120 ms ink vignette pulse.
- **Files:** src/ui/hud/dialbar.tsx, src/ui/hud/index.tsx, src/ui/styles/hud.css, src/session/settings.ts, content/strings.en.json, src/contracts/sim.ts

### M5. Basic attacks are slow, thin and barely land (major, L)
- **LoL bar:**
  - Wind-up 250–400 ms (Darius 400 ms, Locke ≈ 270 ms) in three readable poses: windup, swipe, finish.
  - Melee: a slash streak ≈ 1× champion length for ≈ 130 ms, and a white-gold starburst ≈ 0.7× victim height for ≈ 200 ms.
  - Ranged: a muzzle flash ≈ 0.3× champion height and a tracer ≈ 0.5× champion length.
  - Damage numbers appear on the impact frame (C1, V4).
- **VALE now:**
  - Melee windup 0.34–0.36 at base attack speed 0.62–0.68 (0.53–0.58 s); ranged 0.28–0.30 (0.41–0.47 s).
  - No melee fighter has a swing trail.
  - The 7 ranged fighters share 3 projectiles. `lib_arrow` is 2 layers, ≈ 40 px long, with no release flash.
  - `lib_hit_phys_light` (flash 0.45 m at 1.5 for 0.05 s plus chips) is invisible on stone.
  - Marund's attack sheet shows almost no pose change.
- **Fix spec:**
  1. **Timing** (`attack.windup` in content/fighters): melee → 0.25–0.28 (0.37–0.44 s); ranged → 0.21–0.24 (0.31–0.37 s). Re-run the balance sims afterwards.
  2. **Melee swing trail** (`attack.present.vfx`), a ribbon at socket `weapon`:
     - lives from 60 % of the windup to 60 ms after impact;
     - width 0.25–0.4 m, life 0.12 s;
     - signature colour, emissive ≤ 1.5 (T1);
     - the crit variant doubles the width and uses the T2 cap.
  3. **Ranged:** a per-fighter projectile with at least 3 layers:
     - core;
     - trail ribbon ≥ 0.9 m (≥ 0.5× fighter height), width 0.16 m, life 0.2 s;
     - shed sparks;
     - a release flash at the socket (0.05 s, radius 0.3 m), and a 1–2 frame tip glint at 70 % of the windup.
  4. **Hits** (`lib_hit_phys_light`, `lib_hit_magic`):
     - flash core 1–2 frames, radius max(0.6 m, 0.35× victim height), L* ≥ 90;
     - an oriented slash or spark mesh 0.8–1.0 m along attacker → victim for 100–130 ms;
     - 4–6 radial streaks over 0.15–0.2 s, chips settled by 0.4 s;
     - an `ink` blend body with a light rim, so it reads on pale stone.
     - `lib_hit_phys_heavy` gets radius ≥ 0.8 m, and `lib_crit` a starburst ≥ 0.7× victim height. Raise the T1 `maxEmissive` in tokens to allow this.
  5. **Animation** (attack1/attack2 in art/blender/fighters): hold anticipation ≥ 4 frames, strike in 2, follow through ≥ 4. The weapon tip travels ≥ 0.6× fighter height.
  6. **Acceptance:** re-capture `bm_marund_atk_sheet`. The impact must be legible at the default zoom.
- **Files:** content/fighters/*.json, content/vfx.json, _design/tokens.json, src/render/actors.ts, art/blender/fighters/

### M6. A struck unit never reacts (major, M)
- **LoL bar:** the victim gets a 1–2 frame white or pink impact flash, and its bar flashes the lost segment (C1 Darius Q, V4).
- **VALE now:**
  - No hit flash on the victim's materials and no hit-reaction clip.
  - `FeelL.hitFlash`, `hitStop` and `squash` are parsed (defs.ts:283) but never consumed; renderer.ts reads only `shake`.
  - tokens `vfx.impact.victimRimMs: 80` is unimplemented.
- **Fix spec:**
  1. Add a per-actor additive flash. Template materials are shared, so either:
     - add one additive overlay copy built like the outline hull (MeshBasic, AdditiveBlending, depthTest on); or
     - clone materials once in `attach()`.
     Either way, drive a `uHitFlash` uniform (world_material.ts).
  2. Trigger `actor.flash(k, colour)` from director `damage` (basic attacks) and `hit` (abilities), only when the target is visible to the viewer.
     - k: 0.45 for T1, 0.7 for T2/T3, 1.0 for T4, ×1.3 on crit.
     - Colour: physical #FFF3E2, magic #FF7BD5, true damage inverted to ink #0B0D11.
  3. Envelope: peak on the impact frame, about 80 ms visible, exponential decay with τ = 70 ms, cleared by 150 ms.
  4. Use `FeelL.hitFlash` as a multiplier on k, and keep `hitStop` at 0, since LoL uses none.
- **Files:** src/render/actors.ts, src/render/world_material.ts, src/render/director.ts, src/render/renderer.ts, src/render/vfx/defs.ts

### M7. Overhead bars are undersized and the self trail is invisible (major, M)
- **LoL bar:**
  - Champion bar 105–110×10 px with a 4 px mana strip, a 22–24 px level box and 13–15 px names.
  - Minion bars 56–62×5–6; turret bars 250–265×20 with segment ticks.
  - Lost HP flashes bright for 2–4 frames, then drains (C2, V4).
- **VALE now:**
  - Fighter bar 82×9 plus 82×4, level chip 18 px, name 12/14. Minion 40×4, shown only when damaged or targeted. Structure 120×10.
  - Your own fill is Noonwhite #F4EFE2, the same colour as the damage trail, so your own trail cannot be seen.
- **Fix spec:**
  1. tokens `hud.overheadBar`:
     - hp [104, 10], resource [104, 4], levelChipPx 22, name 14/15;
     - minion [58, 5], always shown on screen for enemies and for allies when damaged;
     - structure [220, 16] with ticks every 25 %;
     - monster [104, 8].
  2. Mirror these in the bars.ts constants and shader box sizes.
  3. Self fill becomes Sap #63D88B, matching the Dial Bar HP. Keep the Noonwhite trail and the self double-frame end shape.
  4. Add a 2–4 frame bright flash (L* 95) on the lost-HP span before the existing 150 ms hold and 450 ms shrink.
- **Files:** src/render/overlay/bars.ts, src/render/palette.ts, _design/tokens.json, src/ui/styles/hud.css

### M8. Both teams' Wicks look identical and out-value the fighters (major, M)
- **LoL bar:** minions wear broad team-tinted armour and differ in shape and weapon between sides. They are about 55 % of champion height and sit below champions in visual priority (V1).
- **VALE now:**
  - content/units.json has no `art.teamModels` for shieldwick, glimwick, greatwick or brightwick, even though `_aubade` and `_serenade` GLBs exist in art/out/units. Structures already use `teamModels`.
  - Team identity rests on a ≈ 5 % visor accent, and the white hoods reach p95 226.
- **Fix spec:**
  1. Add `"teamModels": ["assets/units/<kind>_aubade.glb", "assets/units/<kind>_serenade.glb"]` to the four wick kinds. FFA falls back to `art.model`.
  2. Art pass (art/blender/units/wick_*.py):
     - hood and robe top values at L* ≤ 65, body 25–50;
     - a palette-driven relationship accent covering 25–35 % of silhouette pixels (cloak trim, hood band, lantern glass), ally azure and enemy marigold;
     - shape language that differs in 64 px grayscale: Aubade upright and spired, Serenade rounded and domed;
     - heights 52–79 px, at most 60 % of fighter height.
  3. Acceptance: testers split mixed waves in a 64 px grayscale crop at ≥ 95 % accuracy.
- **Files:** content/units.json, art/blender/units/wick_{brightwick,glimwick,greatwick,shieldwick}.py, art/out/units/, src/render/actors.ts

### M9. Structures are oversized, can hide units and vanish on death (major, L)
- **LoL bar:** turrets are ≈ 216×264 px, ≈ 2.2× champion height. Damage shows gradually, invulnerable turrets look shielded, and the destroyed tower leaves rubble (V4, V5).
- **VALE now:**
  - Lane structures are 400–478 px and the Hourbell 605 px, about 4× a fighter.
  - At 52° pitch a structure hides about 0.78× its height of lane behind it, with no occlusion handling.
  - No damage states. On death the structure sinks 0.5 m over 0.6 s and is disposed (renderer.ts:523–524).
- **Fix spec:**
  1. Do one of the following:
     - rescale tower art to ≤ 2.6× fighter height (≈ 5 m, ≈ 260–300 px); or
     - keep the height and add occlusion handling: a depth-fail pass that draws units behind a structure as a relationship-colour silhouette at 45 % alpha, and fade the structure's upper half to 35 % while your fighter is in its occlusion shadow.
  2. Damage states at 66 % and 33 % HP: crack decals and chipped meshes, an accent-emissive flicker, and falling chips at each threshold.
  3. Death: a 1.5–2 s fall (the top collapses, a dust ring, shards), then a persistent ruin ≤ 1.5 m tall (`art.ruin` on the UnitDef). Do not sink and dispose.
  4. A visible shell layer while invulnerable.
- **Files:** art/blender/units/, content/units.json, src/contracts/catalog.ts, src/render/renderer.ts, src/render/actors.ts, content/vfx.json

### M10. Units have no always-on outline (major, M)
- **LoL bar:** Riot draws per-mesh outlines on skinned meshes (champions, minions, towers) by default, with a thicker outline on hover (R6).
- **VALE now:** units separate from the ground by value alone, which the bright ground undermines. The only outline is the broken hover hull (B1).
- **Fix spec:**
  1. After B1, give every skinned unit a permanent 1.0 px ink outline: #0B0D11 at 60 % alpha, using the same inverted hull with `uOutlinePx = 1.0` and `depthWrite` false. A unit-masked depth/normal Sobel pass in post.ts is an acceptable alternative.
  2. Hover raises the outline to the B1 widths and colours.
  3. Budget ≤ 0.4 ms at 1080p High. Batch the hull copies with the instanced unit path, so draw calls do not double.
- **Files:** src/render/actors.ts, src/render/post.ts, src/render/renderer.ts

### M11. Foliage looks plastic, trees are static and brush buries your own fighter (major, L)
- **LoL bar:**
  - Painterly but graphic: painted edges hide the geometry.
  - Brush is dense blades with dark-to-light painted tips, and it reacts to units walking through.
  - Foliage sits in the dark band (p50 ≈ 45–52), and flames are the only warm highlights (V5).
- **VALE now:**
  - Dialwood crowns are faceted blobs with lacquer hot spots (the COLOR_0.a gloss mask is 1 on plates). Canopy p50 82–91 and p95 132–168, about 2× LoL.
  - Trees do not sway, and boulders are flat-shaded grey facets.
  - Thicket blades (≈ 1.25 m) never bend, part or fade, so fighters in or beside brush are lost.
- **Fix spec:**
  1. dialwood.py:
     - gloss mask 0 on plates (roughness ≥ 0.75), so specular peaks stay at L* ≤ 48;
     - a baked vertex-colour gradient from 0.45 at the crown bottom and interior to 1.0 at the top;
     - ≥ 20 plates per crown with ±15 % scale and ±10° jitter;
     - target canopy p50 45–60 and p99 ≤ 115 after B5.
  2. Tree sway in terrain.ts: tip offset ≤ 4 cm at 0.2–0.4 Hz, with a per-tree phase, weighted by vertex height.
  3. stones.py and scatter.py: painted rock albedo with edge highlights and AO, no flat facets.
  4. Thickets:
     - bend blades away from any unit within 0.8 m (120 ms ease in, 400 ms out, ≤ 16 unit positions passed as a uniform array);
     - fade blades to 35 % alpha within 1.2 m of your own fighter and of visible allies;
     - enemies stay hidden per vision.
- **Files:** art/blender/props/dialwood.py, art/blender/props/stones.py, art/blender/props/scatter.py, src/render/terrain.ts, src/render/terrain_clutter.ts, src/render/terrain_glsl.ts

### M12. Fighters cannot be told apart by their effects (major, L)
- **LoL bar:** every champion owns a signature hue. Hit sparks share a warm white, and team colour lives in indicators, rings and rims rather than the whole effect (C1, R1).
- **VALE now:**
  - 161 of 162 defs set `teamTint`, and 539 layer colours are `team`. The rest are shared neutrals (chalk, ink, glass, greys).
  - Fighter palettes are near-neutral, so every kit reads as the same relationship blue or orange plus grey chips.
- **Fix spec:**
  1. Add `vfx: { signature, secondary }` to each fighter JSON.
     - Signature saturation ≥ 0.55 and value 0.7–0.95.
     - Hue outside tokens `vfx.reservedHuesHSV`: ally 200–225, harm 28–50, heal 125–150, rose 340–350.
     - No two fighters within 25° of hue unless their values differ by ≥ 25 L*.
  2. Support `"color": "signature" | "secondary"` in defs.ts and system.ts, resolved from the caster.
  3. Re-author the per-fighter defs:
     - ≥ 50 % of a kit's emissive layers in signature;
     - `team` only on the danger edge (shockwave rims, ground-ring edges, the enemy danger rim), ≤ 35 % of layers;
     - ally effects keep 65 % opacity.
  4. Fighter models get a signature-hue zone covering 15–25 % of the silhouette at L* 55–80, separate from the ≤ 5 % relationship accent.
- **Files:** content/fighters/*.json, content/vfx.json, src/render/vfx/defs.ts, src/render/vfx/system.ts, art/blender/fighters/, _design/tokens.json

### M13. Ultimate impacts have no envelope (major, M)
- **LoL bar:** two separately traced events matched (V5 3:22.4, V4 2:56.6):
  - ≈ 0.25–0.3 s build;
  - an optional 2-frame dip;
  - one frame at 2.3–2.5× fight-area brightness with saturation dropping;
  - a 0.25–0.3 s hold;
  - a 0.3–0.45 s fade with a half-life of ≈ 0.12 s;
  - about 1 s in total, with no shake.
  - Riot's guide has ultimates win on value range and size, never on full-screen white (R1).
- **VALE now:**
  - No exposure or scene-flash control; only a 3–4 px shake.
  - `marund_ult_domefall` flashes for 0.06 s, and its cream dome #D0C6B3 sits on a cream plaza. The frame median lifted only 1.19×.
- **Fix spec:**
  1. A `feel.exposure` curve in defs.ts and system.ts, applied by post.ts as a multiply pass before ToneMappingEffect. The default T4 curve:
     - ×0.92 for 66 ms;
     - a local radial lift centred on the impact (radius = the ability's area) reaching ≥ 2.0× fight-area mean for 1 frame;
     - ≥ 1.4× held for 250–300 ms;
     - an exponential fade with a 0.12 s half-life over 300–450 ms;
     - never full-screen white.
  2. Re-author every `*_ult_*` and `lib_ult_*` def:
     - the primary element differs from the ground by ≥ 25 L* and carries the signature hue;
     - a 1–1.5 s ground mark at L* ≤ 55 as the dissipation;
     - dome and shell meshes fade with eased alpha over ≥ 0.3 s.
  3. Keep ultimates at 2–3× normal ability radius with ≥ 6 layers. The layer count is already met.
- **Files:** src/render/post.ts, src/render/vfx/defs.ts, src/render/vfx/system.ts, src/render/renderer.ts, content/vfx.json

### M14. The world has no ambient life (major, L)
- **LoL bar:** live brazier flames (warm, saturation ≈ 0.65), team banners, small glowing plants, critters, and water with lily pads, ripples and insects. Quadrants are tinted so players know where they are (V1, V5).
- **VALE now:**
  - The T0 ambient tier is defined in tokens (maxEmissive 0.8, ≤ 0.5 Hz) but has zero effects.
  - Motion is limited to grass sway, shallow ripples and BRIDGE mist.
  - The RIFT centre is an empty grey plaza (p50 167, saturation 0.08).
- **Fix spec:**
  1. Author ≥ 4 T0 `amb_*` defs per map, each at L* ≤ 60, ≤ 0.5 Hz and kept out of gameplay zones:
     - **RIFT:** canopy motes (≤ 30 on screen); resin-lamp flames on base structures and the noonline shrine (saturation ≈ 0.6, L* 55–60); dust in the gnomon shaft; shallows glints and insects;
     - **BRIDGE:** gorge updraft dust and birds below the deck;
     - **FRAY:** stall lanterns and swaying bunting.
  2. 1–2 critter types per map (3 clips each) that take off when a unit comes within 3 m.
  3. Slow cloth sway on faction banners.
  4. Spawn points in `content/maps/*.json art.ambient`, driven by a new src/render/ambient.ts.
  5. A `settings.video.ambientEffects` toggle, default on, with density by tier.
  6. ±4 % hue tint per jungle quadrant.
- **Files:** content/vfx.json, content/maps/map_{rift,bridge,fray}.json, src/render/terrain.ts, src/render/ambient.ts (new), src/session/settings.ts, art/blender/props/

### m1. Dial Bar states still missing (minor, M)
- **LoL bar:**
  - Long cooldowns show M:SS.
  - When ready, the icon washes white and settles over 0.25–0.3 s.
  - A gold border shows while the ability's effect is active.
  - Bars show "+regen", and an 8-stat panel is available (V1, C2).
- **VALE now:**
  - `cdText` (src/ui/hud/ctx.ts:33) prints "217" and "184" for long cooldowns.
  - Ready is a 45 %-wide glint only.
  - No active border, no regen readout and no stats panel.
- **Fix spec:**
  1. `cdText`: for s ≥ 60, use `` const t = Math.ceil(s - 0.001); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; ``. Rounding up before splitting avoids a "1:60" at 119.5 s.
  2. Ready: also animate the whole `.aslot` from `brightness(1.9) saturate(0.4)` to normal over 250 ms with the `dawn` ease.
  3. `.is-active`: a 2 px chalk-hi border while `av.activeRemaining > 0`, exposed from the sim view.
  4. A quiet "+x.x" regen readout at the right end of the HP and resource bars.
  5. An optional 8-stat flyout on the portrait.
- **Files:** src/ui/hud/ctx.ts, src/ui/hud/dialbar.tsx, src/ui/styles/hud.css, src/contracts/sim.ts

### m2. Death, level-up and kill banners are under-presented (minor, M)
- **LoL bar:**
  - On death the world desaturates to grey.
  - Level-up is a deliberate moment.
  - Kill banners show two round portraits and a coloured rule: ≈ 70 ms in, ≈ 3.3 s hold, ≈ 0.3 s out (V5).
- **VALE now:**
  - Only HUD elements grey on death (hud.css:165, 173).
  - `lib_level_up` is a faint pale-blue column, nearly invisible on stone.
  - Banners are text-only and enter over 240 ms.
- **Fix spec:**
  1. post.ts: add a saturation and value uniform after the LUT. On your own death, ramp to saturation 0 and value ×0.85 over 400 ms; restore over 300 ms on respawn. With reduceMotion, use a 120 ms cut instead.
  2. Rebuild `lib_level_up`:
     - a column at L* 85–90 in the signature hue, radius 0.9 m;
     - two rising rings over 1.0 s;
     - a "LEVEL UP" caption over the bar for 900 ms.
  3. src/ui/hud/top.tsx: 48 px round portraits with relationship rings on kill and multikill banners. 70 ms in, 3.5 s life, ≈ 300 ms out.
- **Files:** src/render/post.ts, src/render/renderer.ts, content/vfx.json, src/ui/hud/top.tsx, src/ui/styles/hud.css

### m3. Minimap fighters are anonymous dots (minor, M)
- **LoL bar:** round champion portraits ≈ 30–36 px on a 264–290 px minimap, with team rings (C2, V5).
- **VALE now:** discs of radius 6.4·k (≈ 13–16 px) filled with muddy palette primaries. Rings, the camera trapezoid, timers and fog are already present.
- **Fix spec:**
  1. In src/ui/hud/minimap.tsx (≈ line 320), draw each fighter's icon.png clipped to radius 13·k (≈ 26 px at 352 px width).
  2. Keep the existing relationship ring (2·k), the self gnomon wedge and the enemy heading wedge.
  3. Fall back to the disc only when no icon exists, and preload the icons with the match.
- **Files:** src/ui/hud/minimap.tsx

### m4. VALE shakes the camera where LoL never does (minor, S)
- **LoL bar:** frame tracking through the largest flashes and ultimates (Darius R, Jinx R, Malphite R, V5 3:22.7) shows no shake and no hit-stop. Shake exists only as a player option.
- **VALE now:** VALE shakes in three places:
  - 27 VFX feel layers shake 4 px × value for 90 + 60 × value ms;
  - your own ultimate adds 3 px for 100 ms (director.ts:147);
  - structure falls add 4 px for 120 ms.
- **Fix spec:**
  1. Set `shake` to 0 on all 27 feel layers and rely on the M13 envelope instead.
  2. Remove the own-ultimate shake.
  3. Keep structure falls at ≤ 4 px for 120 ms, scaled by `access.screenShake`.
  4. Default `access.screenShake` to 0.5.
- **Files:** content/vfx.json, src/render/director.ts, src/session/settings.ts

### m5. No distortion, and thin secondary shapes on some T2 kits (minor, M)
- **LoL bar:**
  - Ultimates, empowered states and turret shots use heat haze and lensing.
  - Every ability carries 4–6 layers between its core and its particles, such as a glow or trail, a ground mark and a lingering effect (R1, C1).
- **VALE now:**
  - The `distort` layer type is accepted by defs.ts but never drawn.
  - Mean layer count is a healthy 6.7, but kits such as `burdam_a1_chop` and `burdam_a3_wound` lean on thin rings and sparse chips.
- **Fix spec:**
  1. Implement `distort` in VfxPass as a screen-space UV offset from a scrolling normal sprite.
     - Strength ≤ 0.015 UV, drawn into the HDR buffer before bloom.
     - T3/T4 and the turret-shot ramp only, off on Low.
  2. Audit T2 defs so each has a mid-scale secondary shape (a glow sprite or ribbon at 0.6–1.0 m) between core and chips.
- **Files:** src/render/vfx/system.ts, src/render/vfx/shaders.ts, src/render/post.ts, content/vfx.json

---

## 4. Where VALE already matches or beats the bar

- **Camera framing.**
  - 52° pitch sits inside LoL's measured 50–58° (best estimate 53–56°).
  - Fighters are 96–132 px tall against LoL's 105–130.
  - The 10 m maximum ability range fits the 10.2 m of ground ahead, the same proportion as LoL's skillshots against ≈ 1,360 units ahead.
  - Zoom runs 24.5–33 m, with locked, semi-locked, free and scout modes, edge pan and a 20–44 m spectator zoom. That equals or exceeds LoL's settings (R10).
- **Interpolation.** The sim runs at 30 Hz with interpolated render positions, the same split LoL uses. Crossfades are 100 ms (60 ms into attacks), and the attack impact frame lines up with the sim's release frame.
- **Render and post technology.** HDR half-float chain, N8AO, bloom (threshold 1.0), Neutral tone map, a 33³ LUT, vignette, SMAA, and view-fitted PCF shadows (2048² on High, 4096² on Ultra). That is beyond LoL's prebaked static shadows and FXAA (R6).
- **Fighter asset spec** (for the six finished fighters): 17–22k triangles (LoL skins ≈ 13k), a texel-density spec, 15 clips, 2 skins each, a wind-up accent glow, and rim plus key light.
- **VFX library structure.** 162 defs with mean 6.7 and median 6 layers (LoL 4–6), ultimates at 15–20 layers. T0–T4 tiers with emissive and L* caps. Allies drawn at 65 % opacity and your own basic attacks at 85 %. Velocity-aligned, stretched particles meet the guide's motion-blur rule.
- **Telegraph design**, once B2 is fixed: enemy fill 16 → 30 % with a 3 px edge at 90 % and a 1 px keyline, a clockwise sweep that closes on landing, MAX blending so overlaps never stack, and cool ally edges against warm enemy edges. This matches the guide's per-relationship ramps.
- **Dial Bar core.** Clockwise ink sweep with a hand line, whole seconds then one decimal under 1 s, a 360 ms glint plus 240 ms ring on ready, cost and desaturation on no-mana, rank pips, a level-up "+", recast ring, charges, silence slash, a refused-press shake and a cast pulse. The icons are painted and the frames bevelled.
- **Overhead bar logic.** Fixed screen size, light ticks every 100 HP and heavy ticks every 1,000, a 150 ms hold and 450 ms damage trail on enemy and ally bars, a hatched shield segment, a CC timer strip, relationship end shapes and team glyphs on structures.
- **Combat text.** Damage numbers coloured by type, with crits at 1.5×, merged per 0.5 s with at most 8 on screen. Heals and gold pops. Move and attack ground markers.
- **HUD suite.** A sky strip with the clock and objective timers, a kill feed with portrait chips, an announcer plate, the Tab scoreboard, a death recap, a 9-kind ping wheel, ally frames, and a minimap with fog, the camera trapezoid and camp timers. Always-on HUD coverage is 10.8 %, under LoL's ≈ 13 %.
- **Accessibility.** Deutan, protan and tritan alternates for every relationship colour, HUD and minimap scale, and reduce-motion handling. That is deeper than LoL's colourblind mode.
- **Relationship ground rings** under every fighter (solid for self, dashed for allies, notched for enemies), and tower range rings that appear within 4 m.
- **Wall and brush construction.** Coursed cut-stone walls with moss caps and painted edge light, and dense solid-blade thickets with sway. The jungle floor (p50 ≈ 25) already sits in LoL's band.
- **Base identity.** Aubade spires against Serenade domes give the two bases clearly different shape language. RIFT's carved numeral landmarks aid orientation, matching LoL's practice of different motifs for each base and each quadrant.
- **Fog of war and per-viewer VFX visibility.** Value ×0.55, saturation ×0.4, tinted, a 1.5 m edge, identical on every tier. This matches the per-viewer importance rating Riot describes (R7).
- **Projectile speed on screen.** Fighter projectiles at 18–22 m/s are ≈ 1,480–1,800 px/s, in LoL's range (Jinx's minigun tracer ≈ 1,400 px/s).

---

## 5. Corrections to earlier research

1. **"Pure white is reserved for ultimates"** (r04 §3, r06 key takeaway 1 and the value table, r07 key takeaway 2) is not in Riot's style guide.
   - The guide says to avoid 0 % and 100 % value and saturation, so effects are not confused with UI or environment.
   - It gives ultimates the widest value *range*, plus size and strong animation.
   - Its value diagram puts the **UI** at the top.
   - VALE's tokens rule (white allowed only in T4 cores) is compatible with this, provided the white stays local (M13) and the UI keeps the top of the value range.
2. **The hierarchy has the UI on top:** UI, then effects, then characters and units, then environment (R3, V1). r06's value ladder should add the UI above threat VFX. B5 is the practical consequence.
3. **Telegraph visibility is decided per ability and per viewer** (R7). That settles r04's open question and backs the M1 rule that damaging delayed areas may not be ally-only.

## 6. Not measured, still open

- Basic-attack foot planting, turn speed and locomotion blending, frame by frame.
- Death and respawn presentation and the level-up burst. Neither appeared in the sampled footage; m2 is based on Riot's HUD notes and the judges' reading.
- Out-of-mana icon tint. The HUD footage champion has no mana.
- Audio sync for wind-ups and impacts. The clips were watched muted; see r07.
- The enemy-side colour of a delayed-area ground warning. It was inferred from the guide's per-relationship ramps, not seen.
- A clean VALE perf number on an idle machine with a production build. B4's gate produces it.
