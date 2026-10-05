export const meta = {
  name: 'lc-wave4',
  description: 'Last Circle look+feel Wave 4: storm, loot beams, clouds/fog/colour, HUD, deaths, canopy, camera, pacing, asset intake; then wire gates and verify',
  phases: [
    { title: 'Build', detail: '9 file-disjoint lanes' },
    { title: 'Wire', detail: 'register the new gates in gate.py' },
    { title: 'Verify', detail: 'independent re-run of the whole gate suite + side-by-sides' },
  ],
}

const REPO = 'C:/Users/TestRun/Claude Claw/forgeflow-games'
const LC = REPO + '/games/last-circle'
const SPEC = LC + '/_spec'
const PLAN = SPEC + '/look_2026-10/PLAN.md'
const REF = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_look/reference'
const LOOKDIR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_look'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/wave4'
const ASSETS = 'F:/games/forgeflow-games-assets'
const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe'

const COMMON = `
You are one lane of a parallel build on Last Circle (${LC}), a 50-player THIRD-PERSON battle royale in plain Three.js r172 ESM
(no build step; runtime/ is served as-is; three is vendored in assets/vendor/three). It is LIVE and published on forgeflowgames.com.
The merged, skeptic-checked plan is ${PLAN}. READ the sections for YOUR items (line ranges are given in your lane brief) and the
decisions table (section 2). The audit/evidence folder from the research is ${LOOKDIR}/ (lighting-post/, hud-vfx/, world-towns/,
visual-gap/, camera-characters/, next-steps/ each with shots/ and review/). The reference video frames (BridgeZone, the look the owner
wants) are in ${REF}/ - LOOK at the ones your items cite (ref_t38 etc).
Engineering bar already shipped: fixed-tick sim + interpolated view, ~15k-tri characters + LOD1, shader warm-up under the loading screen,
DPR cap 1.5, frameprof (?prof=1), native touch controls (48/48 phone gates), boot guard, and the browser gate suite
${LC}/_harness (README.md explains each gate; python _harness/gate.py --disk runs all; exit 0 pass / 1 fail / 2 could-not-judge;
--disk serves the working copy through page routing so no server is needed). Top entry of ${LC}/CHANGELOG.md summarises it.

OWNER DECISIONS (final; do not relitigate):
  - THIRD-PERSON ONLY. Build NO first-person view, NO viewmodel, NO ADS-view toggle (plan items P4.1 / D1 / D2 are CLOSED).
  - The third-person camera MAY pull in when a wall blocks it (plan P3.1 / D3 = yes): snap in on contact, ease out slowly, never rotate,
    reticle stays centred.
  - Colour: ship ONLY plan P4.2 step A (fix the cyan sky/water cast). Step B (exposure / darker albedo) is shown to the owner on an A/B
    sheet and is NOT shipped.
  - No spend of any kind. Nothing that costs money (Meshy credits, paid packs, paid APIs). Free CC0 / MIT / Mixamo-royalty-free only; say the licence.
  - Do NOT touch the registry field mobile_support, do NOT run pipeline/deploy_game.py, do NOT change any game's publish status. The
    orchestrator deploys.
  - The HUD layout was signed off (compass top, storm row, LVL chip sized like the quests, reticle pinned centre; slot column / vitals
    anchors named in plan P1.9): restyle INSIDE those anchors only.
  - NO building, NO harvesting. Maps rotate RANDOMLY (no map picker). SHIFT = sprint toggle. ONLY Mixamo animations (no Meshy
    animations; never re-generate an existing Meshy model). Never use basic primitives as final art.
  - Emissive glare bar: emissives ~3-8x the luminance of the surface they decorate, bloom halo <= 2-3x the source width; assume the first
    pass is too hot and START LOW. Applies to storm streaks, loot beams/rings, muzzle flash, tracers, lightning, rim light.

HARD RULES
  - Edit ONLY the files your lane owns (listed in your brief). Other lanes edit other files in the same working tree RIGHT NOW. A need in
    a file you do not own goes under "requests_for_other_lanes", never into that file.
  - Do NOT git commit / stash / reset / checkout / rebase / add. The orchestrator commits each lane separately.
  - Consume other lanes' APIs and assets ONLY through feature detection (the game must boot and play whether or not the other lane's piece
    has landed), and say in your report which integration points you could not test yet.
  - Node selftests never run runtime/3d/*. Every view-code change is proven in a REAL browser: after every edit to a runtime .js file, load the
    game and confirm 0 page errors and 0 failed requests (node --check is useless on ESM; a ReferenceError on every bot spawn once shipped
    in another game from a Node-only battery).
  - Counts (draw calls, triangles, programs, layouts, bytes, textures) are exact and ARE pass criteria; milliseconds are information only.
    Design targets: <= 450 draw calls, p99 <= 22 ms, but this box's Intel UHD iGPU is shared and already over; every item must be about
    net-zero on the medium tier or gate behind high. No per-frame allocation in hot paths.
  - The box is shared and contended (other sessions run browsers; RAM can be under 2 GB free): ONE browser at a time per lane, close it promptly,
    classify environment failures (refused connections, rAF starved) as could-not-judge, never as pass.
  - Servers: prefer python _harness/<gate>.py --disk (no server). If you need a URL, a scoped static server serves ONLY /games/*:
    http://127.0.0.1:{PORT}/games/last-circle/index.html (never serve the repo root: it holds .env). Playwright is installed. Test surface:
    window.__LC__ (startMatch, fastForward, stepFrames(n, dt, render), prof(), W). Reuse _harness/common.py (Session: boot, start_match,
    land, step_frames, screenshot).
  - NEW GATE SCRIPTS: write them as ${LC}/_harness/new/<yourlane>_<name>.py (create the folder if missing). Same exit codes 0/1/2, use
    _harness/common.py. A later step registers them in gate.py; do not edit gate.py yourself.
  - Scratch under ${SCR}/<lane>/. Write ${SCR}/<lane>/REPORT.md EARLY and append as you go (usage limits have killed whole runs; a file on
    disk survives, a final message does not). If REPORT.md already exists, a previous attempt of YOUR lane was killed: triage it (done /
    half-done / not started, at the top of REPORT.md), verify the game boots with 0 page errors with your files as they are, then continue;
    never revert completed work.
  - LOOK at every screenshot you take and describe what you actually see; never infer it.
  - Chat style is not your concern; your REPORT.md and structured result are what count. Be exact about numbers and honest about misses.

CONTRACTS BETWEEN LANES THIS WAVE (provide yours exactly; consume others only via feature detection):
  C-ART-CLIPS (ART-A -> PLAYER): shared clip files assets/chars/clips/<clip>.glb for each MESHY_CLIPS name in player.js (single animation,
    animations[0], translation/scale tracks stripped except Hips) and 7 Mixamo death clips named death_front, death_front_head, death_back,
    death_back_head, death_right, death_crouch_head, death_walking (all in METRES, same skeleton bone names as the existing clips).
  C-ART-CANOPY (ART-A -> PLAYER): assets/props/canopy.glb (one mesh node named Canopy; vertex colour COLOR_0 = gore mask) and
    assets/props/canopy.json {lines:[{x,y,z}...], span, hang:{x,y,z}} in metres, +Y up, nose toward -Z, origin at the harness hang point.
  C-ART-FX (ART-B -> STORMFX, HUD): assets/fx/spark.png, puff.png, glow.png, tracer.png (soft alpha textures, <= 64 KB each) and
    assets/hud/wpn_<id>.png for id in pistol smg ar shotgun sniper glauncher (white silhouette on transparent, 160x60).
  C-ART-TOWN (ART-B -> next wave): assets/props/city/** + manifest.json, assets/tex/*.jpg. Not consumed this wave.
  C-SKY (SKY -> STORMFX): maps.js sets W.skyUniforms = {top, bot} (the live THREE.Uniform objects of the sky dome shader) and
    W.skyDome (the dome mesh) once the map is built.
  C-LOOT-RENDER (LOOT): loot beams/rings/glow use renderOrder >= 6 and read the shared storm uniform W.stormU = {cx, cz, r} if present
    (STORMFX provides it from storm.js each time the circle changes); STORMFX keeps the storm wall at renderOrder 5.
  C-WARM (all): each module that adds shaders/materials exports warmObjects(W) -> Object3D[] and disposeMatch(W); the orchestrator lane
    (ORCH, ffg_royale3d.js) calls them feature-detected. STORMFX owns ffg_warmup.js.
`

const OUT = {
  type: 'object',
  properties: {
    lane: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths you modified or created' },
    summary: { type: 'string', description: '3-6 plain sentences: what changed for a player' },
    gates: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'could-not-judge'] },
      before: { type: 'string' }, after: { type: 'string' }, how: { type: 'string' } },
      required: ['name', 'result', 'after', 'how'] } },
    new_gates: { type: 'array', items: { type: 'string' }, description: 'paths of new gate scripts under _harness/new/' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'paths of before/after screenshots or contact sheets' },
    untested_integrations: { type: 'array', items: { type: 'string' } },
    requests_for_other_lanes: { type: 'array', items: { type: 'string' } },
    open_issues: { type: 'array', items: { type: 'string' } },
    report_path: { type: 'string' },
  },
  required: ['lane', 'files_changed', 'summary', 'gates', 'report_path'],
}

const LANES = [
  { key: 'ART-A', port: 8790,
    owns: 'games/last-circle/assets/chars/clips/** (new); games/last-circle/assets/props/canopy.glb and canopy.json (new); games/last-circle/_tools/art_a_* (new)',
    brief: `Offline asset production, Blender + gltf-transform. Blender 5.1 is at ${BLENDER} (headless works). gltf-transform 4.4.2 is on PATH.
Do plan P1.1 (offline half), P1.6 (the Mixamo death clips) and P2.6 (the ram-air canopy asset). Read plan lines 128-140, 216-227, 353-359.
  1. P1.1: the 17 MESHY_CLIPS (player.js ~:283-291) are md5-identical across all 5 skins under assets/chars/meshy/<skin>_<clip>.glb. Produce ONE shared
     assets/chars/clips/<clip>.glb per clip: single animation (animations[0], the only one the runtime reads), translation and scale tracks stripped
     except Hips, same bone names. Verify by loading old vs new in a browser clip-binding probe on at least two skins (athlete has 34 bones, the others 52)
     that the same tracks bind. Do NOT delete the per-skin originals (the PLAYER lane falls back to them).
  2. P1.6: bake the Mixamo death clips from ${ASSETS}/_downloaded/mixamo/animations/Rifle_8-Way_Locomotion_Pack/ ("death from the front", "death from the
     back", "death from right", "death from front headshot", "death from back headshot", "death crouching headshot front") and
     ${ASSETS}/_downloaded/mixamo/animations/Shooter_Pack/walking to dying.fbx into assets/chars/clips/death_front.glb, death_back, death_right,
     death_front_head, death_back_head, death_crouch_head, death_walking, IN METRES (the trap: centimetre roots trigger player.js's unit guard, lifting the
     start pose to 1.5-2 m; and some FBX carry an Armature root rotated +90 X scaled 0.01). First find how the existing Mixamo rifle clips were baked
     (search ${REPO}/pipeline and ${LC}/_tools for Blender scripts mentioning Rifle_8-Way or Mixamo) and reuse that retarget, do not invent a new one.
     Gate: each clip binds all its tracks on all 5 skins in a real browser (no PropertyBinding warnings), end hips height reported per clip, and the
     corpse ends DOWN (hips <= 0.6 m) for all seven. The two Meshy death2/death3 clips are against the Mixamo-only rule: do not use them.
  3. P2.6: a parametric ram-air canopy in Blender: arched, 7-9 cells, airfoil section, small stabilisers, ~1.5-2k triangles, vertex colour COLOR_0 as the
     gore (two-tone) mask so the existing instanceColor shader can still colour it. Read the current dome code (player.js ~:1926-1994) for the size, the
     line attachment points and how instanceColor is applied; match scale. Write canopy.glb and canopy.json per contract C-ART-CANOPY. Draco/meshopt
     compress. Take a render of the canopy next to ${REF}/ref_t22_parachute_downtown_storm.jpg and LOOK at both.
  Write your credits text (sources + licences: Mixamo royalty-free, original asset) to assets/chars/clips/CREDITS_snippet.md for the orchestrator to merge.` },
  { key: 'ART-B', port: 8791,
    owns: 'games/last-circle/assets/props/city/** and assets/props/cars/** (new); assets/tex/** (new); assets/fx/** (new); assets/hud/** (new); assets/vendor/three/examples/jsm/libs/** (new files only; leave the existing draco/ files); games/last-circle/_tools/art_b_* (new); games/last-circle/CREDITS.md',
    brief: `Offline asset intake, python + gltf-transform + PIL. Read plan lines 200-209, 250-265, 282-286, 288-351 (intake parts). Tasks:
  1. P2.0 decoders: vendor three r172 examples/jsm/libs/meshopt_decoder.module.js from ${REPO}/node_modules/three (MIT) into
     assets/vendor/three/examples/jsm/libs/; vendor the wasm Draco decoder files from the same three (draco_decoder.wasm + draco_wasm_wrapper.js if not
     already present beside the existing draco/ folder; do not overwrite existing files). Report exact bytes. (The STORMFX lane wires the kernel.)
  2. P2.2/P2.4 town-kit intake for the NEXT wave's Savanna pilot, from ${ASSETS}/_downloaded/cc0-city/ (Kenney City Kit Suburban, Commercial,
     Roads, Car Kit, furniture, props; CC0; SOURCES.json + LICENSE files there). Stage per palette in separate folders (the suburban and commercial
     colormaps share the filename Textures/colormap.png) under assets/props/city/{suburban,commercial,skyscraper,lowdetail,props,furniture,walls}/ and
     assets/props/cars/. Compress with gltf-transform (meshopt + quantize; prefer KTX2/UASTC or keep the 512 px colormap lossless-ish PNG; normal maps must
     not be lossy). Pick ~25 building types for a Savanna downtown + suburbs + warehouse yard + far skyline (suburban a..u subset, commercial a..n subset,
     skyscraper a..e, low-detail), ~10 street props, ~8 cars. Write assets/props/city/manifest.json: per type {file, tris, bbox_m {x,y,z}, suggested_scale,
     palette, colliders: [a few axis-aligned boxes in local metres, baked from the geometry: footprint minus porch/awning overhangs; verify them by plotting]}.
     Make recoloured palette variants of each colormap (slate / red-brick / sand roofs) as small PNGs. Report triangle counts, raw and compressed MB.
  3. Textures (Poly Haven CC0 at ${ASSETS}/_downloaded/polyhaven-textures/, e.g. aerial_asphalt_01..07, aerial_grass_rock, aerial_beach_01..03, aerial_sand):
     downscale to 1024 px JPG into assets/tex/ with names road_asphalt.jpg, sidewalk_concrete.jpg, ground_grass_rock.jpg, ground_beach.jpg,
     ground_sand.jpg (+ _n normal maps only if small). Report bytes.
  4. P1.4 particle textures from the Kenney Light Masks (${ASSETS}/_downloaded/light-masks, CC0): assets/fx/spark.png, puff.png, glow.png, tracer.png
     (soft alpha masks, <= 64 KB each, power-of-two).
  5. P1.9 weapon silhouettes: render a white silhouette on transparent, 160x60, for pistol smg ar shotgun sniper glauncher into assets/hud/wpn_<id>.png.
     Find how Last Circle builds its six guns (weapons.js / loot.js / assets) and render from our OWN geometry (original art, no licence issue). LOOK at
     the six images.
  6. CREDITS.md: add every source + licence above (you own this file; ART-A leaves a snippet at assets/chars/clips/CREDITS_snippet.md for the orchestrator).
  Gates: manifest validates against the files (script art_b_check.py: every manifest file exists, tris within +-2%, colliders non-empty); total new downloadable
  bytes reported by group; every PNG within its size cap.` },
  { key: 'PLAYER', port: 8792,
    owns: 'games/last-circle/runtime/3d/royale/player.js; games/last-circle/runtime/3d/royale/rig_pipeline.js; games/last-circle/runtime/3d/royale/nametags.js',
    brief: `Do plan P1.1 (runtime half), P1.5, P1.6 (runtime half), P1.8, P2.6 (runtime half), P3.1, plus the corpse-sink robustness fix (player.js ~:2783 uses a wall-clock
setTimeout and ignores pause and hit-stop: move it to sim time). Read plan lines 128-140, 211-227, 242-248, 353-370. In this order:
  1. P1.5 gun hidden while gliding; P1.8 faint cool rim (VALORANT-style, inside the zone-tint onBeforeCompile, new customProgramCacheKey, strength per D12:
     faint for everyone, and a coloured rim for SQUAD UP allies if cheap); expose it through the existing playerMod.warmObjects so the warm-up covers it.
  2. P3.1 third-person camera wall collision: ray/sphere cast from the eye to the desired camera position against W.map.queryColliders (budget <= 150
     collider queries per frame in total), snap in on contact, ease out slowly, NEVER rotate, reticle stays centred. Probe: across 4 yaws x several houses on
     every map the camera never ends inside or behind a wall collider; no camera heave in an open field.
  3. P1.1 runtime half: fetch each clip ONCE from assets/chars/clips/<clip>.glb (contract C-ART-CLIPS) and CLONE the AnimationClip per skin BEFORE the
     per-skin rebaseRootTracks / stripRootMotion / pruneClipTracks / rifle_reload_upper passes (those rewrite the clip for that skin's rig; sharing one clip
     object would corrupt the other skins). Fall back to the per-skin file (<skin>_<clip>.glb) if the shared file 404s.
  4. P1.6 runtime half: choose among the 7 death clips (death_front, death_front_head, death_back, death_back_head, death_right, death_crouch_head,
     death_walking) from victim.lastHit direction relative to the facing, isHead, crouched, moving; use a SEEDED pick (never Math.random(), see player.js
     ~:2775); remove any use of the Meshy death2/death3 clips. Fall back to the existing single death clip when the new files are absent.
  5. P2.6 runtime half: if assets/props/canopy.glb loads (contract C-ART-CANOPY) replace the SphereGeometry dome with it, still ONE InstancedMesh and ONE
     LineSegments, instanceColor still paints it, CHUTE_LINES from canopy.json; fall back to the dome when absent.
  ART-A is producing the clips and the canopy concurrently: if its files are not on disk yet when you reach steps 3-5, write the wiring with feature
  detection, test everything else, then re-check ${SCR}/ART-A/REPORT.md and the assets folder near the end and test the wiring for real if the files exist;
  otherwise report them under untested_integrations (do not call them passed).
  Gates: framecheck (drop-frame programs 0, actor rows unchanged or better), rigcheck 5 skins, a dlprobe-style download count showing the clip bytes fall (the
  old path fetched 17 clips x 5 skins), playtest 20 bot kills -> >= 5 distinct death clips and 0 corpses with hips > 0.6 m at clip end, lifecycle (pause during a
  corpse sink), camera-wall probe, mobile.py --disk 48/48 still, probe_match stuck < 2%, bootcheck 0 [rig] lines. Landing screenshot still shows the player's shadow.` },
  { key: 'STORMFX', port: 8793,
    owns: 'games/last-circle/runtime/3d/royale/storm.js; games/last-circle/runtime/3d/royale/fx.js; games/last-circle/runtime/3d/ffg_kernel_3d.js; games/last-circle/runtime/3d/ffg_warmup.js; games/last-circle/runtime/3d/lc_output_pass.js (new)',
    brief: `Do plan P1.2 (a storm you can see; items a-e and g, NOT the loot parts of f), P1.4 (sparks/flash/tracers that are not cubes) and the P2.0 kernel decoder swap.
Read plan lines 142-172, 200-209, 282-286. The storm today: a single additive MeshBasicMaterial cylinder (storm.js ~:45-56), measured as only a faint magenta cast.
  1. P1.2: a ShaderMaterial wall on the same single cylinder: premultiplied NORMAL blending (additive light cannot darken or desaturate what is behind it), a
     360-sample ground-reference DataTexture of max(W.map.heightAt(x,z), waterY) refreshed when the circle changes, curtain alpha ~0.3-0.4 near the ground fading with
     height, a 0-3 m brighter band at the ground, streaks spaced in WORLD metres and anti-aliased with fwidth() so they stay ~1.5-2 px at any distance, an alpha cap so a
     silhouette 20 m behind the wall keeps >= 60% contrast. Inside the storm (playerStormState): lerp scene.fog colour/density AND scene.background AND the sky dome
     top/bot uniforms (via W.skyUniforms, contract C-SKY from the SKY lane, feature-detected) toward ~#8a74b8 and restore all three EXACTLY on exit; add a 40-50% desaturation +
     light lavender tint as a uniform in a custom copy of three r172's OutputPass/OutputShader (MIT) in new lc_output_pass.js, faded over 0.5 s, neutral while the menu diorama
     renders (it shares the composer); accept it in ffg_kernel_3d.js. Provide W.stormU = {cx, cz, r} each time the circle changes (contract C-LOOT-RENDER). 3-6 purple lightning
     billboards in the storm-side sky (reference ref_t22). Export storm warmObjects(W). Glare: streaks <= 2x curtain luminance, ground band <= 2.5x, lightning <= 8x its sky.
  2. P1.4: replace the flat unlit cubes (fx.js ~:51-57) with camera-facing instanced quads using assets/fx/{spark,puff,glow,tracer}.png (contract C-ART-FX; if absent, generate
     soft procedural textures in a canvas so there are STILL no cubes), a thin bright fading tracer streak instead of the flat yellow stick, a muzzle flash; keep the 1,024-particle
     cap. Move fx quad pools to renderOrder > 5. Export fx warmObjects(W).
  3. P2.0 kernel: swap the forced Draco JS decoder (ffg_kernel_3d.js ~:26, 719 KB) for the wasm decoder (vendored by ART-B under assets/vendor/three/examples/jsm/libs/draco/ -
     feature-detect; keep the JS decoder as the fallback if the wasm file is missing or WebAssembly is unavailable), and register the meshopt decoder (assets/vendor/three/examples/
     jsm/libs/meshopt_decoder.module.js, ART-B) on the GLTFLoader so later meshopt kit files load. Keep the uncommitted-then-committed PORTRAIT CAMERA FIT and everything else intact.
  4. ffg_warmup.js: nothing to add unless a new program is not covered by warmObjects; the storm and fx extras arrive through them.
  Gates: a per-REGION A/B capture at storm phase 2 (over water) and phase 6 (over hills): ground band (0-10 m above the ground) mean delta >= 20/255, streaks visible by eye at
  150 m and side-on, luminance ratio of far scenery 0.85-1.15, side-by-side with ${REF}/ref_t100_storm_wall_eliminated_banner.jpg and ref_t84_*; framecheck 0 new programs on
  the drop frame; lifecycle PASS; the inside-storm tint restores exactly (compare scene.fog/background/uniform values before and after); feelcheck 7/7; the glare probe numbers for
  streaks, lightning, flash and tracer; no particle is a cube (draw-call and geometry check); bootcheck + mobile.py --disk 48/48 still pass.` },
  { key: 'LOOT', port: 8794,
    owns: 'games/last-circle/runtime/3d/royale/loot.js',
    brief: `Do plan P1.3 (rarity light beams + glowing floor rings as instanced draws). Read plan lines 174-198 and the P1.2 item f note (lines 159-160). Floor weapons get a thin
rarity-coloured beam with a white core fading as it rises (common ~2 m ... legendary ~14 m), CLAMPED to the first collider above it (ray-cast once at spawn: 69 of 346 floor items and 17 of
51 chests sit under a roof 2.7-7.5 m up), and a soft double glow ring under it using NORMAL blending with a dark outer edge plus a coloured emissive core (an additive ring on the bright
sand turns white and loses the rarity colour). Chests keep a gold beam. ONE InstancedMesh for beams, ONE for rings, chest glow sprites become one instanced billboard; pickup/open hides an instance
(scale 0) through the existing slot-allocator pattern (loot.js ~:295-386); survive the net take mirroring (loot.js ~:65); size the pools for 346 items + 51 chests (isla_viva seed 7). Ammo and
consumables get rings only, no beam. renderOrder >= 6 and fade beams outside the circle via W.stormU = {cx, cz, r} if present (contract C-LOOT-RENDER; STORMFX provides it, feature-detect and
degrade gracefully). Export lootMod.warmObjects(W) and make disposeMatch(W) free everything (textures flat over 3 matches). Compare with ${REF}/ref_t52_fpp_street_houses_lootbeam.jpg and ref_t84_*.
  Glare bar: beam core 3-5x the surface behind it; common/uncommon below the 0.72 bloom threshold; cap the legendary gain so it cannot mask an enemy; judge the over-sky case by eye, halo <= 2x beam width.
  Gates: an A/B probe: the ring reads as rarity-coloured on sand, grass and wood (hue error < 15 deg) at >= 1.4x floor luminance; no beam pixel above a ceiling collider; framecheck drop cluster <= 250 calls
  with a smaller loot share; leaktest flat over 3 matches; picking an item hides its beam and ring; probe_match loot census unchanged (>= 3 guns/player, >= 8 light boxes/map); 0 page errors; bootcheck.` },
  { key: 'SKY', port: 8795,
    owns: 'games/last-circle/runtime/3d/royale/maps.js (ONLY the sky dome / cloud / fog / water-colour / palette / tone-mapping regions; do not touch terrain, towns, POIs, props, colliders, minimap or clutter code)',
    brief: `Do plan P1.7 (baked-texture clouds), P1.10 (altitude-scaled fog) and P4.2 STEP A (steel-blue sky/water). Read plan lines 229-240, 267-276, 420-426. A later wave rewrites the town and
terrain parts of maps.js, so keep your edits tightly inside the sky/fog/colour code and comment them.
  1. P1.7: port the cloud shaping from three's examples/jsm/objects/Sky.js (MIT) into the dome shader, but BAKE the fbm noise once at load into a 256-512 px tiling DataTexture and sample two scrolling layers
     (procedural fbm measured 7-12.8 ms full-screen on this iGPU vs 0.65-4.4 for the baked texture). Delete the 24 sprite cloud groups (maps.js ~:642-669, drift ~:695). KEEP the birds (the owner asked for real
     clouds and birds). Expected: -43 draw calls (372 -> 329 on Isla Viva ground).
  2. P1.10: lower FogExp2.density with camera height (full below ~40 m, ~50% at 250 m+) through the uniform, NO shader recompile (check programs count unchanged). Check the thinner fog does not expose the map
     edge or the ocean horizon seam on any map.
  3. P4.2 step A: re-author sky / zenith / fog hues (maps.js ~:36-41) and water (~:591) toward steel-blue and muted teal (prototype hexes in the plan, e.g. Isla Viva sky #7fd4f0 -> #9ed0e3, zenith #2f8fd8 ->
     #5c8dc1, water #2ec9d6 -> #80c2ca; do the same family of change for Savanna and Deepwood). Do NOT change grass, roofs, characters or loot colours, and do NOT change exposure or Neutral tone mapping.
  4. Contract C-SKY: set W.skyUniforms = {top, bot} (the live uniform objects) and W.skyDome once the map is built.
  5. Produce, but do NOT ship, the STEP B A/B sheet for the owner: exposure 1.15 -> ~0.9 and a darker terrain albedo, via a scratch override (page.route patch or a query-param-free injected script), for all
     three maps, ground + drop views, next to the reference exterior frames ${REF}/ref_t08_*, ref_t22_*, ref_t52_*; also include the new clouds in the comparison. Save as ${SCR}/SKY/ab_sheet_stepB.jpg
     and imgstats (saturation, |red-blue|, brightness) per map vs the references.
  Gates: framecheck (draw-call row falls by ~40, 0 new programs on the drop frame, programs unchanged across the altitude change); sky screenshots at ground and 250 m on all 3 maps (LOOK at them); imgstats
  saturation / |red-blue| for step A vs the references; no map-edge or ocean seam in the drop shots; leaktest; bootcheck; probe_match unchanged.` },
  { key: 'HUD', port: 8790,
    owns: 'games/last-circle/runtime/3d/royale/hud.js',
    brief: `Do plan P1.9 (HUD restyle inside the signed-off anchors) and P4.3 (death banner + post-match standings). Read plan lines 250-265 and 428-429, and LOOK at ${REF}/ref_t38_*, ref_t84_*, ref_t68_*, ref_t100_*,
ref_t113_*. Bottom-left vitals: a big tabular HP number over a 4-segment blue shield bar and a 4-segment white HP bar plus a consumables row with key chips (replacing the two pill bars with % text and emoji, hud.js
~:2170-2185); bottom-right weapon card above the slot row: weapon name in rarity colour, outlined rarity tag, AUTO/SEMI chip (same rule as weapons.js ~:432), big mag count / reserve, ammo type, segmented mag bar
(today only "30 / 150", hud.js ~:2209-2214, 2708-2716); storm row reads "Circle N of 8 - X damage a second"; kill-feed rows get the weapon silhouettes assets/hud/wpn_<id>.png (contract C-ART-FX; feature-detect, fall
back to text) . DOM only, in the SAME boxes (bottomLeft at left 18 / bottom 16 / width 300; slot column at right 18 / bottom 54); segment fills use transform scaleX written only when the cached value changes (hud.js ~:2671-2688);
SVG/CSS icons instead of emoji. In touch mode the stick lives bottom-left and chat sits at bottom 128 (hud.js ~:2337): the vitals card must stay under ~64 px tall there or it is a layout change. P4.3: the
centred death card (hud.js ~:3697-3760) becomes a top banner over the live view: "Eliminated #N of 50 - eliminated by X - weapon - HEADSHOT - 31 m" (the data already exists there); the post-match screen gets a standings table
(all players, kills, damage, your row highlighted) with "Run it back" and "Find a new match" - "Find a new match" starts a new match on a RANDOM map (no map picker). Keep the spectate A/D switching working.
  Gates: layoutcheck --disk (desktop 1280x720 / 1366x768 / 1920x1080 and the phone viewports; signed-off anchors unchanged; 0 overlaps), mobile.py --disk 48/48, feelcheck 7/7, forced layouts stay 0.00 in framecheck,
  leaktest (PLAY AGAIN x3), a 1280x720 side-by-side of our HUD against ref_t84 and of the death banner against ref_t100 and the standings against ref_t113 (LOOK at them); the HUD does not allocate per frame.` },
  { key: 'SIM', port: 8791,
    owns: 'games/last-circle/runtime/sim/royale.js; games/last-circle/runtime/sim/royale.selftest.cjs; games/last-circle/runtime/3d/royale/bots.js; games/last-circle/runtime/3d/royale/weapons.js',
    brief: `Do owner decision D8 step 1: bot-match pacing. Measured: all 7 bot matches ended at 264-380 s, in circle 2 of 8 (storm phases end at 240/390/505/600/675/735/780/820 s, royale.js ~:293-307), and 9-21 bots die
in the first 60 s. Owner wants the later circles to actually happen: median match end >= 600 s and at most 12 of 49 bots dead in the first 60 s. Cheap fix FIRST: stretch/reshape the storm plan and/or soften the tier 1-3
aimErrDeg / reactionMs and the first-minute engagement rate; touch bot decision-making (bots.js tier-scaled engage terms, wider drop spread in assignDrops) only if the cheap fix cannot reach the targets, and say so.
Keep: every storm rule the selftest asserts (update the selftest deliberately where the plan intentionally changes, with a reason), the Fortnite/PUBG/Apex research the plan was built from (wall never faster than a
player), the same-seed replay identity, the skill-banded tier mix, HEAD_CHANCE cap 0.25. Measure with python _harness/probe_match.py --disk (storm ON, >= 6 seeds incl. isla_viva 1 and 7, deepwood 13, ashgrid 12):
median match end, deaths before 60 s, circle reached, pistol share, stuck %, replay identity. Then a perfcheck-style note: more bots alive for longer means more skinning and LOS work - report framecheck/perfcheck ground and
endgame numbers as information. Also: no unseeded Math.random() may appear in the files you touch. Gates: royale.selftest green; probe_match all rows incl. new pacing rows; botcheck hit registration unchanged;
the final circles (>= 5) are actually reached in most matches.` },
  { key: 'ORCH', port: 8792,
    owns: 'games/last-circle/runtime/3d/ffg_royale3d.js',
    brief: `Small orchestrator lane. (1) Plan next-steps table row "Low tier: stop running the composer": on the low graphics tier the composer stays allocated and running (ffg_royale3d.js ~:285-291); render straight
to the screen on low (and keep medium/high exactly as they are). Prove the gain with an interleaved A/B (ABAB, same pose) of python _harness/perfcheck.py --disk on low, and report it as information. Do NOT build auto-tier.
(2) Collect warmObjects(W) from every module that exports one (player, fx, storm, loot, hud...) feature-detected and pass them into ffg_warmup.warmup(kernel,{extras}); call disposeMatch(W) on every module that exports one in
the teardown (the LOOT, STORMFX and PLAYER lanes are adding warmObjects/disposeMatch concurrently): framecheck must still show 0 new programs on the drop frame and leaktest textures flat over 3 matches AFTER the other lanes land
- so re-check near the end, and again report what you could not test. (3) Keep the fixed-tick pipeline, touch install, onError card and every existing contract intact. (4) Any VERIFY-style open item that lives in ffg_royale3d.js:
the dead nameTag.material dispose branch (harmless; remove it). Gates: framecheck, leaktest, lifecycle, bootguard l1/l2, mobile.py --disk 48/48, bootcheck.` },
]

const RESUME = `
=== IF THIS IS A RE-RUN ===
If ${SCR}/<your-lane>/REPORT.md already exists, a previous attempt of THIS lane was killed (usage limits have done this). Triage first (done / half-done / not started, at the
top of REPORT.md), verify the game boots with 0 page errors with your files as they are, then finish. Never revert completed work.`

phase('Build')
const res = await parallel(LANES.map((l) => () =>
  agent(`YOUR TASK (do not substitute any other): build lane ${l.key} of the Last Circle look+feel plan (Wave 4).
Your files (the ONLY files you may edit): ${l.owns}
Your fallback test-server port: ${l.port}
Your scratch dir: ${SCR}/${l.key}/  (report at ${SCR}/${l.key}/REPORT.md)
${COMMON.split('{PORT}').join(String(l.port))}
=== YOUR LANE ===
${l.brief}
${RESUME}`, { label: l.key, phase: 'Build', schema: OUT })
))

const done = []
for (let i = 0; i < LANES.length; i++) {
  if (res[i]) done.push(res[i])
  else log(`${LANES[i].key} returned nothing - its REPORT.md on disk is the record`)
}
log(`${done.length}/${LANES.length} lanes returned`)

phase('Wire')
const newGates = done.flatMap((r) => (r.new_gates || []).map((g) => `${r.lane}: ${g}`))
const wired = await agent(`YOUR TASK (do not substitute any other): register the NEW gate scripts the Wave-4 lanes wrote into the Last Circle gate runner.
You may edit ONLY ${LC}/_harness/gate.py and ${LC}/_harness/README.md (plus move nothing else). Read ${LC}/_harness/README.md and gate.py to see how a gate is registered
(name, script, args, whether it needs rAF, how its exit code maps to the verdict table). The new scripts live in ${LC}/_harness/new/ (each named <lane>_<name>.py; list them with a directory
listing - the lanes reported: ${JSON.stringify(newGates)}). For each: confirm it runs (python <script> --disk, --help works, exit codes 0/1/2 follow the convention), then register it in gate.py
so python _harness/gate.py --disk runs it, and document it in README.md (one line: what it drives, what it asserts). If a script is broken, do NOT fix it (it belongs to a lane): list it under
"broken" with the error and leave it unregistered. Do not run the full gate suite; verification does that next. Do NOT git commit. Return a short plain report as your final text.
Write ${SCR}/WIRE/REPORT.md as you go.`, { label: 'wire-gates', phase: 'Wire' })

phase('Verify')
const table = done.map((r) => `### ${r.lane}\nfiles: ${JSON.stringify(r.files_changed)}\n${r.summary}\ngates: ${JSON.stringify(r.gates).slice(0, 3200)}\nevidence: ${JSON.stringify(r.evidence || [])}\nuntested: ${JSON.stringify(r.untested_integrations || [])}\nrequests: ${JSON.stringify(r.requests_for_other_lanes || [])}\nopen: ${JSON.stringify(r.open_issues || [])}`).join('\n\n')
const ownership = LANES.map((l) => `${l.key}: ${l.owns}`).join('\n')

const verdict = await agent(`YOUR TASK (do not substitute any other): independently VERIFY Wave 4 of the Last Circle build and produce the release table. Do not trust the lane reports: re-run everything.
Write ${SCR}/VERIFY.md early and append; scratch under ${SCR}/verify/. You are READ-ONLY on the repo (you may run scripts and write scratch).
${COMMON.split('{PORT}').join('8790')}
1. FILE OWNERSHIP: git status / git diff --stat for games/last-circle and pipeline. Map every changed or new file to its owning lane below. Flag anything outside a lane's list. (Expected and NOT ours: the pipeline
   game_controls.js copies and pipeline/engine/runtime/3d/ffg_kernel_3d.js carry another session's old uncommitted work.)
2. DESKTOP: 3 runs of boot -> menu -> standard match (real Enter, W.phase === "match") -> 60 s of RENDERED stepped play with deaths -> PLAY AGAIN -> a second match, on at least 2 different maps. 0 page errors, 0 failed requests
   (favicon excepted), 0 [rig] warnings, 0 new shader programs on the drop frame.
3. PHONES: python _harness/mobile.py --disk (all 4 devices) must be 48/48.
4. python _harness/gate.py --disk --negative-controls (exit 2 = re-run once, never a pass). Record each gate with numbers, including the newly registered ones.
5. Node: every *.selftest.cjs under runtime/.
6. INTEGRATION across lanes (things no lane could test alone): shared clips + death clips bind on all 5 skins and corpses stay down; the canopy renders and is coloured by the gore mask; the storm wall + inside-storm tint
   + loot beams fading outside the circle + lightning together in one capture, with loot beams NOT veiled by the wall; kernel wasm Draco / meshopt decoders actually load the shipped GLBs (or the JS fallback runs); the new HUD in a
   match on desktop and phone; the death banner and standings after a real death and at match end; "Find a new match" picks a random map; warmup covers the new programs (0 new programs on the drop frame); leaktest textures flat
   over 3 matches with every new resource; the camera never inside a wall.
7. SIDE-BY-SIDES: build contact sheets of OUR frames next to the matching BridgeZone reference frames in ${REF}/ for: storm wall, loot beams, HUD, death banner, standings, sky/clouds, parachute, a drop overview. Save under
   ${SCR}/verify/sheets/ and LOOK at each; describe honestly how close it is.
8. THE RELEASE TABLE, before -> now, rows: drop-frame programs, drop cluster draw calls, ground-view draw calls (clouds), download bytes to first match (use the harness dlprobe if present or measure transferred bytes), lobby textures
   m1/m2/m3, KB allocated per frame, bot match end time + deaths before 60 s + circle reached (pacing), stuck %, forced layouts per frame, storm per-region delta, loot ring hue error, death clip variety, camera-inside-wall count, and
   the step-B colour A/B sheet path for the owner.
9. Verdict per lane: SHIP / FIX-FIRST (exact defect and file:line). Then an overall RELEASE / HOLD recommendation for deploying to the CDN, and the exact commands to re-check after deploy.
LANE OWNERSHIP:
${ownership}
LANE REPORTS (claims, not facts):
${table}
WIRE REPORT: ${String(wired).slice(0, 2500)}`, { label: 'verify-wave4', phase: 'Verify', effort: 'high' })

return { verdict, lanes: done.map((r) => ({ lane: r.lane, files: r.files_changed, newGates: r.new_gates || [], untested: r.untested_integrations || [], gates: r.gates.map((g) => `${g.name}:${g.result}`) })) }
