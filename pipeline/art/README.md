# pipeline/art — the GENERATION layer (library-first, generate-when-needed)

**Status (2026-06-11, owner decision):** these modules are NOT dead code and must not be attic'd.
They are the on-demand asset GENERATION layer behind the engine pipeline's library-first policy:

> Use the assets we have (Kenney/CC0 library + the 75GB Unity haul on the F: junction).
> Generate with PixelLab (2D sprites) / Stability (music) only **when needed**.

## How the nightly reaches this layer

`pipeline/engine/art_fallback.py` is the ONLY sanctioned bridge. It is invoked from:
- `engine_game_emit.stage_audio` — when the music library has zero themes → one Stability track.
- `engine_authoring.pick_assets` — when the 2D character library is empty → one PixelLab hero.

Guarantees: hard budget cap (3 generations/day, `state/art_gen_budget.json`), env kill switch
(`FFG_GEN_ART=0`), silent library-fallback when API keys are missing, never raises into a build.
PixelLab spend is ledgered by `sprite_generator.py` → `state/pixellab_usage.jsonl` (portal-visible).

## Standalone tools (operator-run, not nightly)

`vision_classify`, `audio_mapper`, `enemy_sprite_mapper`, `asset_manifest`, `level_chunks`,
`mixamo_registry`, `asset_downloader` (PolyHaven/Kenney, https-only), `sprite_postprocess`,
`character_consistency`/`uniqueness`, `boss_attack_animator` — Phaser-era utilities kept as the
toolbox for asset curation and future 2D generation work. None are imported by the nightly.
