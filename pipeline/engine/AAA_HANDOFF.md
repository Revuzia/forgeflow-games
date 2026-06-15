# Pipeline → AAA — running handoff

Tracks the AAA-pipeline build: what's done (CI-verified), what needs the OWNER (claude -p / a decision), and the regen/validation commands. Source plan: 8-agent investigation (task w2r9wgntz); keystone diagnosis in `.claude/.../memory/reference_forgeflow_games_hosting.md`.

## Keystone (why this work exists)
The nightly routes EVERY new game — including 3D — to the **weak from-scratch `forgeflow-engine`** (Blinn-Phong, no PBR/tonemap/post-FX, GLB textures discarded) via `engine_target.json {author:true}`. The project's **AAA Three.js kernel** (`runtime/3d/ffg_kernel_3d.js`: AgX tonemap, soft shadows, EffectComposer + UnrealBloom, MeshStandard PBR) already powers the good games (void-skirmish-3d, warboard-chess, iron-tide) but the generator doesn't target it. F: holds 40 Poly Haven PBR sets + 40 HDRIs referenced by nothing. Fix = integration + gating, not a renderer rewrite.

## DONE (CI-green, committed) — no claude -p needed
- **`gates/render_quality_gate.py`** — deterministic, static-source AAA render gate. Reads a game's bundled render JS and asserts the AAA-3D floor (AgX/ACES toneMapping + shadowMap + lights + EffectComposer/bloom). PASSES the 3 Three-kernel games, FAILS the from-scratch-engine path, SKIPS 2D. (PBR/sRGB/textured are advisory now → required in Phase 2.) No browser (post-FX blacks out under SwiftShader; state-via-source instead).
- **`gates/payload_gate.py`** — shippable-byte budget (default 12MB) so Phase-2 textures/HDRIs can't bloat a single-file game. Excludes dev cruft.
- **`gates/genre_render_contract.json`** — per-genre required/advisory markers.
- **`gates/test_render_gates.py`** — CI (in `run_all_tests.py`); 14 checks; PASS.

## DONE — Tier 2: F: asset staging (CI-green, committed) — no claude -p
The libraries the Tier-3 Three-kernel author target will call to dress scenery with REAL PBR + IBL:
- **`art/material_library.py`** — indexes the 40 F: Poly Haven PBR sets by surface (grass/ground/rock/sand/concrete/metal/wood/brick; all 8 buckets backed by real sets), `pick(theme, surface, seed)` → deterministic real set (sha1-seeded, not salted `hash()`). F: absent → `root()` None, `pick()` None (callers skip).
- **`art/texture_transcode.py`** — `stage_material()` resizes a set to 1k/512 WebP for MeshStandard (map/roughnessMap/aoMap/normalMap) and **derives the missing tangent-space normal** (OpenGL nor_gl, +Y) from the displacement height map (the sets ship none). `stage_material_to_budget()` steps 1024→512→256 to fit a byte budget. Displacement is consumed, not shipped (web normal carries the detail at zero geometry cost). Measured: a full set @1024 = **827KB**.
- **`art/hdri_library.py`** + **`art/_hdr_codec.py`** — `pick(theme, seed)` → real 2k `.hdr`; `stage()` prefilters via a pure-numpy RGBE decode→box-downsample→re-emit (no imageio/openexr/toktx on this box). Measured: 6.6MB 2k → **517KB** @512×256, mean radiance preserved to 0.3%. (Indexed 40: 24 indoor + 16 day; the a–b alphabetical slice has no night/dusk yet → `pick` falls back gracefully.)
- **Source fix:** `art/asset_downloader.py` requested the non-existent key `"Normal"`; the Poly Haven files API names it `nor_gl`/`nor_dx` — so 0 normals ever downloaded. Fixed to fetch `nor_gl` → `nor_gl.jpg`, which `material_library` prefers over the derived normal on future re-downloads.
- **`gates/test_asset_staging.py`** — in `run_all_tests.py`; 38 checks; pick() returns real on-disk files, staged channels incl. a validated normal map (blue/Z>180, R/G~128), HDRI re-decodes to 512×256, material+IBL added payload **1.34MB ≤ 2.5MB** target. **Skips clean (exit 0) if F: not mounted** → CI stays green anywhere. Now **8/8 suites green**.

Regen/validate (no claude -p): `python pipeline/art/material_library.py` · `python pipeline/art/hdri_library.py` · `python pipeline/art/texture_transcode.py` · `python pipeline/engine/run_all_tests.py`.

**Tier-3 contract (what's ready to consume):** `material_library.pick(theme,surface,seed)` + `texture_transcode.stage_material(mat, out_dir, size)` → `{files:{diffuse,rough,ao,normal: Path}}`; `hdri_library.pick(theme,seed)` + `hdri_library.stage(hdri, out_path, target_h)` → small `.hdr`. The kernel author target stages these into a game dir, then binds `MeshStandardMaterial({map,roughnessMap,aoMap,normalMap})` + `RGBELoader → PMREM → scene.environment` in `ffg_kernel_3d.js`.

## DONE — Tier 3: Three-kernel 3D render target (the keystone) — CI-green, committed, PROD-OFF
Routes 3D genres to the AAA Three.js kernel (PBR + IBL + bloom) with real F: materials instead of the from-scratch engine — **but gated OFF so production routing is unchanged** until you validate.
- **`engine/kernel_target.py`** — `choose_render_target(genre, content)` → `"three-kernel"` only for 3D genres AND only when enabled; **None by default** (caller keeps existing routing — no blind prod flip; naively disabling the from-scratch engine would send 3D→Phaser, which we do NOT do). `assemble_kernel_game()` builds a void-skirmish-3d-shaped dir: canonical kernel + generic scene templates + `content.json` material/IBL manifest + staged Poly Haven materials & a prefiltered `.hdr` (Tier-2 libs). `verify_kernel_game()` = structure + render gate (`three-kernel` markers) + payload budget. Measured assembly: **1.16MB**, render gate PASS.
- **`engine/kernel_target.json`** — `{"enabled": false}` (committed OFF). The flip is a one-line repo change, not an env/Task-Scheduler change.
- **`engine/runtime/3d/ffg_scene.js` + `ffg_scene_boot.js`** — FIXED generic templates (version like the kernel). `buildEnvironment()` binds `MeshStandardMaterial` (map/roughnessMap/aoMap/normalMap) + `RGBELoader → kernel.setEnvironment` IBL + bloom/GTAO; `buildGameplay()` is the **claude -p extension point** (scaffold ships a lit, textured, orbitable scene; gameplay is layered on top).
- **`engine/v2_pipeline.py`** — kernel branch inserted ahead of the engine branch, **guarded by `choose_render_target(...)=="three-kernel"`** → dead while OFF (test_orchestrator still green). On success: marks milestones DONE + `READY_TO_DEPLOY` like the engine path; any failure falls through to existing routing.
- **`engine/asset_downloader.py` normal-key fix** (Tier-2) means future re-downloads carry real `nor_gl` normals the kernel materials prefer.
- **`gates/test_kernel_target.py`** — in `run_all_tests.py`; 28 checks; routing OFF-by-default + 3D→kernel/2D→None when on + assembled dir passes the render gate as `three-kernel` (the exact thing the from-scratch path FAILS) within payload. **9/9 suites green.**

### OWNER VALIDATION — required before flipping prod (run in cmd.exe, NOT an interactive Claude session — OAuth lock)
The in-session work is pipeline code + deterministic gates; proving a *generated* 3D game looks AAA in a real browser is the owner step (headless WebGL screenshots black out under bloom — that's why the gate is static-source).
```
:: 1. assemble a 3D scaffold with real F: assets and run the deterministic gates
set FFG_KERNEL_TARGET=1
python pipeline\engine\kernel_target.py tactics3d
python pipeline\engine\gates\render_quality_gate.py games\_kernel\demo-kernel
python pipeline\engine\gates\payload_gate.py games\_kernel\demo-kernel
:: 2. EYEBALL it in a browser (PBR ground + scenery, sky-tinted IBL, soft shadows, bloom):
::    serve the repo and open  games/_kernel/demo-kernel/index.html  (needs network for the three@0.172 CDN)
python -m http.server 8123    ::  then browse http://localhost:8123/games/_kernel/demo-kernel/
```
If the render looks AAA: (a) set `kernel_target.json {"enabled": true}` to route 3D genres to the kernel, then (b) the NEXT step (Tier-3b, needs claude -p) is wiring a kernel-authoring pass that overrides `ffg_scene.js buildGameplay()` to add the actual genre (units/turns/projectiles/win-lose) on top of this renderer — the scaffold deliberately ships render-only so it's verifiable without claude -p. Until then, leaving it OFF changes nothing.

## OWNER DECISIONS NEEDED (blocking later phases)
1. **Payload budget number.** The gate default is 12MB, but the *existing* good game `void-skirmish-3d` is **16.4MB** (GLB characters: brainstem 3MB, soldier 2MB, …). Options: (a) raise budget to ~18MB, (b) Draco/meshopt-compress the GLBs (≈3-5× smaller) and keep 12MB. Recommend (b) for true AAA-on-web, but it's your call.
2. **From-scratch engine: retire for 3D, or upgrade to parity?** Recommend RETIRE for 3D (route 3D to the Three kernel) — upgrading its renderer to PBR is months. The engine stays for 2D-GI research.

## NEEDS OWNER claude -p (can't run in-session — OAuth lock)
- Validating any **regenerated** game (the in-session work is pipeline code + CI; proving a *generated* game looks AAA needs a real nightly/operator run). Commands will be filled in here per phase as the Three-kernel author target lands.

## DONE — Tier 4: 2D real-art variety from F: pixel packs (CI-green, committed)
The emitter's hardcoded 5-asset map shipped EVERY platformer with the same `tile_0000` hero and every shooter the same pair — generated 2D games looked identical. Now slug-seeded from the real packs.
- **`art/twod_asset_selector.py`** — scans the F: packs (pixel-platformer Characters, platformer-art-deluxe Base pack Player/Enemies/Items, pixel-shmup Ships) into role pools and `select_asset_set(template, slug)` deterministically picks a DIFFERENT real sprite per slug, returning the exact `{"sprites": {...}}` shape `_stage_assets` consumes. Role keys MATCH the templates: platformer=`hero`+`star`, shooter=`hero`+`foe`. Returns None for the 3D `collect` template (keeps GLB models) and when F: is absent (→ old ASSET_SETS/colour). Pools: platformer hero 33 / star 12, shooter hero 12 / foe 12.
- **`engine/engine_game_emit.py`** — `build()` now calls the selector first, falls back to `ASSET_SETS` on any failure. (NOTE: emitter renders STATIC sprite quads; animated walk-cycles — Kenney new-platformer-pack, absent on F: — are a future tier. See [[project_kenney_enemies]].)
- **`engine/test_no_primitives.py`** — extended (now 39 checks, was 26): selector returns real on-disk files per template, hero≠foe (shooter), hero varies ≥3 distinct across 7 slugs, `collect`→None, deterministic, and an INTEGRATION check that two slugs emit different sprites AND both still pass the no-naked-primitives actor gate. **9/9 suites green.** (This gate CAUGHT a real regression mid-build: the selector first used key `coin`, but the platformer template reads `star` → `COIN_SPR` went null → naked-primitive fail; fixed by aligning keys.)

## NEXT (remaining on the loop)
- **Tier 5** — feel/balance/audio gates + functional fixes (beatability hard-fail, placeholder/syntax guard, touch + CDN-vendor in emitter, false-gamepad strip, template logic bugs).
- **perf_gate.py** — deferred (needs the live headless harness for FPS/draw-calls); pairs with payload_gate.
- **Tier 3b** (needs claude -p, owner-run) — kernel-authoring pass overriding `ffg_scene.js buildGameplay()` to add real gameplay on the kernel renderer. Gated behind owner sign-off of the Tier-3 render.
- **3 existing 3D games** — already kernel PBR+IBL (procedural textures). Only genuinely-additive upgrade = real F: HDRI IBL (pipeline-level pass, theme-matched); do NOT inject mismatched ground photoscans. Deploy + browser eyeball = owner.
