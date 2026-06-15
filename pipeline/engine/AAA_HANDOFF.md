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

## OWNER DECISIONS NEEDED (blocking later phases)
1. **Payload budget number.** The gate default is 12MB, but the *existing* good game `void-skirmish-3d` is **16.4MB** (GLB characters: brainstem 3MB, soldier 2MB, …). Options: (a) raise budget to ~18MB, (b) Draco/meshopt-compress the GLBs (≈3-5× smaller) and keep 12MB. Recommend (b) for true AAA-on-web, but it's your call.
2. **From-scratch engine: retire for 3D, or upgrade to parity?** Recommend RETIRE for 3D (route 3D to the Three kernel) — upgrading its renderer to PBR is months. The engine stays for 2D-GI research.

## NEEDS OWNER claude -p (can't run in-session — OAuth lock)
- Validating any **regenerated** game (the in-session work is pipeline code + CI; proving a *generated* game looks AAA needs a real nightly/operator run). Commands will be filled in here per phase as the Three-kernel author target lands.

## NEXT (in progress on the loop)
- **Tier 3** — wire a Three-kernel 3D author target into the nightly (the keystone) + `build_target` CI test (3D→kernel, 2D→Phaser). Consumes the Tier-2 contract above. DO NOT enable in prod until owner validates.
- **Tier 4** — 2D real art from F: pixel packs (replace the 5 hardcoded emitter assets).
- **Tier 5** — feel/balance/audio gates + functional fixes (beatability hard-fail, placeholder/syntax guard, touch + CDN-vendor in emitter, false-gamepad strip, template logic bugs).
- **perf_gate.py** — deferred (needs the live headless harness for FPS/draw-calls); pairs with payload_gate.
