# Pipeline → AAA — running handoff

Tracks the AAA-pipeline build: what's done (CI-verified), what needs the OWNER (claude -p / a decision), and the regen/validation commands. Source plan: 8-agent investigation (task w2r9wgntz); keystone diagnosis in `.claude/.../memory/reference_forgeflow_games_hosting.md`.

## Keystone (why this work exists)
The nightly routes EVERY new game — including 3D — to the **weak from-scratch `forgeflow-engine`** (Blinn-Phong, no PBR/tonemap/post-FX, GLB textures discarded) via `engine_target.json {author:true}`. The project's **AAA Three.js kernel** (`runtime/3d/ffg_kernel_3d.js`: AgX tonemap, soft shadows, EffectComposer + UnrealBloom, MeshStandard PBR) already powers the good games (void-skirmish-3d, warboard-chess, iron-tide) but the generator doesn't target it. F: holds 40 Poly Haven PBR sets + 40 HDRIs referenced by nothing. Fix = integration + gating, not a renderer rewrite.

## DONE (CI-green, committed) — no claude -p needed
- **`gates/render_quality_gate.py`** — deterministic, static-source AAA render gate. Reads a game's bundled render JS and asserts the AAA-3D floor (AgX/ACES toneMapping + shadowMap + lights + EffectComposer/bloom). PASSES the 3 Three-kernel games, FAILS the from-scratch-engine path, SKIPS 2D. (PBR/sRGB/textured are advisory now → required in Phase 2.) No browser (post-FX blacks out under SwiftShader; state-via-source instead).
- **`gates/payload_gate.py`** — shippable-byte budget (default 12MB) so Phase-2 textures/HDRIs can't bloat a single-file game. Excludes dev cruft.
- **`gates/genre_render_contract.json`** — per-genre required/advisory markers.
- **`gates/test_render_gates.py`** — CI (in `run_all_tests.py`); 14 checks; PASS.

## OWNER DECISIONS NEEDED (blocking later phases)
1. **Payload budget number.** The gate default is 12MB, but the *existing* good game `void-skirmish-3d` is **16.4MB** (GLB characters: brainstem 3MB, soldier 2MB, …). Options: (a) raise budget to ~18MB, (b) Draco/meshopt-compress the GLBs (≈3-5× smaller) and keep 12MB. Recommend (b) for true AAA-on-web, but it's your call.
2. **From-scratch engine: retire for 3D, or upgrade to parity?** Recommend RETIRE for 3D (route 3D to the Three kernel) — upgrading its renderer to PBR is months. The engine stays for 2D-GI research.

## NEEDS OWNER claude -p (can't run in-session — OAuth lock)
- Validating any **regenerated** game (the in-session work is pipeline code + CI; proving a *generated* game looks AAA needs a real nightly/operator run). Commands will be filled in here per phase as the Three-kernel author target lands.

## NEXT (in progress on the loop)
- **Tier 2** — F: asset staging: `pipeline/art/material_library.py` (PolyHaven PBR by surface; FIX: sets on disk have NO normal maps — re-download `nor_gl` or derive from displacement) + `hdri_library.py` + KTX2/resize transcode (to satisfy the payload gate).
- **Tier 3** — wire a Three-kernel 3D author target into the nightly (the keystone) + `build_target` CI test (3D→kernel, 2D→Phaser). DO NOT enable in prod until owner validates.
- **Tier 4** — 2D real art from F: pixel packs (replace the 5 hardcoded emitter assets).
- **Tier 5** — feel/balance/audio gates + functional fixes (beatability hard-fail, placeholder/syntax guard, touch + CDN-vendor in emitter, false-gamepad strip, template logic bugs).
- **perf_gate.py** — deferred (needs the live headless harness for FPS/draw-calls); pairs with payload_gate.
