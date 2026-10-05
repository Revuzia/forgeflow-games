# ORCH lane report (Wave 4)  -- file owned: games/last-circle/runtime/3d/ffg_royale3d.js

## TRIAGE (top of file, keep current)
- Fresh start (no previous REPORT.md). 2026-10-05.
- Baseline BEFORE my edits (working tree had no other-lane changes in runtime/ yet): `python _harness/bootcheck.py --disk` -> PASS 11/0/0, 42 s, 0 console/page/window errors, 0 failed requests, 0 shader errors.

## Findings so far (verified by reading code this session)
- ffg_royale3d.js:285-291: low tier only sets `kernel.bloom.enabled=false`; composer (RenderPass + disabled bloom + OutputPass) still renders every frame via kernel._frame (`this.composer.render(dt)`, ffg_kernel_3d.js:751).
- hud.js:823 does `if (!W.kernel.composer) W.kernel.enableBloom(...)`: so simply nulling kernel.composer on low would make the menu REBUILD a composer. Plan: install a composer-shaped "direct" object instead.
- Sky ShaderMaterials (maps.js:632 match sky, hud.js:649 menu sky) write `gl_FragColor = vec4(col,1.0)` with NO tonemapping_fragment / colorspace_fragment include. In the composer path OutputPass tone-maps + sRGB-encodes them; drawn straight to the canvas they would come out unencoded (too dark). Needs a safety net here + a request to SKY/HUD lanes.
- Dead branch confirmed: `a.nameTag` is `{visible, cell, actor}` (nametags.js:101, player.js:614) - it never has `.material`.
- ffg_royale3d.js warmMatch() already collects player + fx warmObjects only (hardcoded); needs generalising to every module.

## PROGRESS LOG
### [11:40] edits landed in ffg_royale3d.js (all feature-detected; booted + gated isolated)
1. DIRECT_POST / routePost / releasePost / ensureOutputChunks added before W.applyGraphics; applyGraphics now routes the composer: low -> kernel.composer = DIRECT_POST (a composer-shaped object whose render() is renderer.render(scene,camera); passes [], readBuffer null), medium/high -> real composer exactly as before. `?lowpost=1` keeps the composer on low (A/B arm + rollback).
2. warmMatch(): loops MATCH_MODS + EXTRA_MODS (touch, dynamic) + WARM_ONLY (net) and calls mod.warmObjects(W) feature-detected, deduped, per-provider try/catch; W._warm.by = per-provider counts, W._warm.post = "direct"|"composer".
3. teardownMatch(): MATCH_MODS.concat(EXTRA_MODS) disposeMatch loop; dead nameTag.material branch REMOVED.
4. Bug found by my own gate and fixed: the first ensureOutputChunks wrote `... gl_FragColor=vec4(c,1.);   #include <tonemapping_fragment>` (one-line shader) -> "invalid character" shader errors (70 of them) and a dead sky. An #include must start its own line; now prefixed with "\n". Re-gated: 0 shader errors.
- New gates: _harness/new/orch_lowpost.py (functional + look), _harness/new/orch_lowpost_ab.py (information-only ABAB).
- orch_lowpost.py --isolate (git HEAD for everything but my file): 18 pass / 0 fail / 0 cnj. Same-pose direct vs composer: whole-frame mean abs diff 7.0-7.6 /255, sky strip <= 13.7; sky is NOT dark (raw-linear sky would be ~100+ off).
- LOOK (I viewed _harness/_shots/orch/sheet_*): direct (top) vs composer (bottom). Direct is cleaner and more saturated: sea R 73 vs 96, island sand B 174 vs 192, sky B 248 vs 240. Cause (reasoned from three's fog_fragment + getUnlitUniformColorSpace, not yet proven by experiment): with a canvas target, fog and transparent blends mix in sRGB-encoded space, with the composer they mix in linear HDR. So low now looks less hazy in the distance. Reported as information; `?lowpost=1` / LOW_POST constant = rollback.
- hand-off: the storm-grade OutputPass (kernel lc_output_pass.js, another lane) exists only on the composer, so the LOW tier will not get the storm grade; kernel.setGrade is a no-op there.

### [11:55] A/B #1: stepped GPU-synced bench (orch_lowpost_ab.py --isolate --no-lp --reps 2 --frames 60), ashgrid seed 1234, low, 1280x720, same landed pose (-60, 7.84, 406.5) in all 4 arms. INFORMATION.
| arm | route | p50 ms | p90 | p99 | draw calls | tris | textures | geometries | programs |
| A1 | composer (?lowpost=1) | 138.65 | 355.66 | 1549.62 | 312 | 1,995,872 | 130 | 232 | 34 |
| B1 | direct               | 189.40 | 576.93 | 1657.56 | 310 | 1,995,869 | 117 | 231 | 29 |
| A2 | composer              |  77.90 | 103.74 |  128.54 | 317 | 1,995,882 | 130 | 228 | 34 |
| B2 | direct               | 231.45 | 868.04 | 1511.80 | 310 | 1,995,869 | 117 | 227 | 29 |
- EXACT counts (the pass criteria kind): direct = -13 textures, -5 programs, -2..-7 draw calls; tris equal (so the gain is real in memory/program/call counts).
- MILLISECONDS (information): in this stepped back-to-back mode direct was SLOWER on this box in both pairs (median of p50: A 108.3 -> B 210.4). Box was heavily contended (5-6 other automated Chromes; p99 1.5 s even in A1). Hypothesis (unproven): the stepped loop never lets the shared iGPU/compositor release the visible default framebuffer between frames, so a direct frame pays the release stall BEFORE its first draw while the composer frame draws into private RTs first; rAF-paced play hides it. Next: the lc_liveprobe (perfcheck engine) rAF windows ABAB (running).

### [12:35] A/B #2 and #3 (information; BOTH dominated by box contention, so no ms conclusion yet)
- perfcheck engine (lc_liveprobe via orch_lowpost_ab.py --no-stepped, isolated, ashgrid seed 1234, low, ABAB, profile dgpu-uncapped, windows drop 8 s / ground 15 s). rAF ms, pageerrors 0 in all 4, graphics=low in all 4:
  A1 composer drop p50 11.1 p99 67.2 | ground p50 12.9 p99 344.9 (569 frames)
  B1 direct   drop p50 13.2 p99 1342.9 | ground p50 15.0 p99 1467.8 (281 frames)
  A2 composer drop p50 20.5 p99 194.9 | ground p50 35.1 p99 792.0 (178 frames)
  B2 direct   drop p50 26.5 p99 344.9 | ground p50 31.6 p99 634.2 (255 frames)
  -> A1 vs A2 (same arm, same build) differ 2.7x, i.e. run-to-run noise >> any effect. No conclusion either way.
- in-page flip (the skeptic's tierprobe2 method: one page, composer<->direct every 12 frames, ABBA, GPU-synced): the box was saturated (8+ other lanes running Chromes; frame times 3-6 SECONDS), composer p50 4385.6 vs direct 4429.1 ms, paired round deltas -1157..+3108 ms, direct faster in 6 of 10 rounds. UNUSABLE. To retry near the end when quieter.
- The only skeptic-grade evidence of the ms gain remains the plan's tierprobe_interleaved.json (low DPR1 111 -> 78 ms p50, in-page interleaved) - not reproduced by me.
