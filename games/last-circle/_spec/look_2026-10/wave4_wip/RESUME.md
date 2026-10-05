# Wave 4 (look + feel) - PAUSED 2026-10-05 ~12:45 by the owner ("pause everything and save what data you can")

Nothing here is deployed. The LIVE site still serves the 2026-10-05 06:24Z build (`?v=1790866476`), which was verified
(bootcheck 11/11, portalcheck --live 5/5). Everything below is UNCOMMITTED work in the shared working tree plus this snapshot.

## Where everything is saved
| what | where |
|---|---|
| tracked-file changes (12 files, `git diff --binary`) | `tracked_changes.patch` (this folder) |
| 181 new files (assets, tools, gates, lc_output_pass.js) | `new_files.zip` + `new_files.txt` (this folder) |
| the 9 workers' own progress notes | `reports/*.md` (this folder) |
| full scratch evidence: screenshots, A/B sheets, probes, research | `F:\games\last-circle-wave4-save\` (`lc_improve\wave4\<lane>\`, `lc_look\`, ~856 MB) |
| the live working tree itself | still on disk, uncommitted (see git status) |
| the plan | `../PLAN.md` |
| the workflow that was running | script `...\workflows\scripts\lc-wave4-wf_a8a240a8-b32.js`, run id `wf_a8a240a8-b32` (stopped) |

To restore the tree from this snapshot onto a clean checkout: `git apply tracked_changes.patch` then unzip `new_files.zip` at the repo root.

## Owner decisions in force (do not re-ask)
Third-person ONLY (no first-person, no viewmodel, no ADS-view toggle). Camera may pull in when a wall blocks it. Colour: ship step A only
(sky/water cast); step B (exposure/albedo) is shown on an A/B sheet and NOT shipped without the owner's pick. No spend. Do NOT change the
registry `mobile_support` (stays `none`). Deploy WITHOUT `--status`. HUD anchors are signed off.

## State per lane (details in reports/)
- **ART-A (assets for clips/deaths/canopy): DONE and gated.** 17 shared clips (716 KB vs 8.8 MB per-skin), 7 Mixamo death clips in metres, ram-air canopy 1746 tris. `art_a_clips.py` PASS 10/10, `art_a_canopy.py` PASS 12/12. Per-skin originals NOT deleted (PLAYER falls back to them). Credits text in `assets/chars/clips/CREDITS_snippet.md` still to be merged into CREDITS.md.
- **ART-B (decoders, town kit, textures, fx, icons): mostly DONE.** meshopt decoder vendored; 5 textures (1.0 MB); 4 fx textures; 6 weapon icons; 81 town-kit types (60k tris, 909 KB, 100% decoded in real Chrome via `artb_decode.py`) with collider boxes. A final clean regeneration was running when stopped (`city_full_run.log`); CREDITS.md only partly done; `art_b_check.py` passes. The vendored meshopt decoder is v0.18: kit files must use vertex codec v0.
- **PLAYER: P1.5 gun hidden while gliding + P1.8 rim (16/16) and P3.1 camera wall pull-in (0 violations over 2,400 frames, control 980) DONE and verified.** P1.1 shared clips, P1.6 seeded death pick, P2.6 canopy swap, corpse sink on sim time are WRITTEN BUT NEVER RUN in a browser. Gates for those not written.
- **STORMFX: kernel done and verified** (wasm Draco = identical bytes to the JS decoder; meshopt lazy; LCOutputPass). storm.js rewritten and contracts pass (tint restores exactly, W.stormU, alpha cap, lightning 2.8x sky) but the LOOK gates FAIL (ground-band delta 7-10/255, need >= 20; streak/curtain 2.0-2.2, need <= 2.0) and palette tuning was in progress. fx.js rewritten, NOT yet browser-tested. KNOWN BUG: the StormBolt shader uses `vec3 flat`, a reserved word in GLSL ES 3.00 (LOOT lane saw the shader error in the console) - rename it.
- **LOOT: loot.js rewritten (3 instanced pools, ceiling clamp, storm fade) and boots; markers add exactly 3 draw calls; clamp 0 violations over 147 beams.** Gate run 1 partial: pickup/chest gate bugs fixed; look tuning (cleaner rings, wider far beams) and framecheck/leaktest/probe_match/bootcheck still to run.
- **SKY: maps.js sky/cloud/fog/water done and boots clean on all 3 maps.** Baked-cloud dome (sprite clouds deleted, rng draws burned so seeded worlds are byte-identical), altitude fog, step-A palette, water plane 2560 m -> 5600 m (fixes a pre-existing ocean-horizon seam). W.skyUniforms/W.skyDome provided. STILL TO DO: imgstats vs the references, framecheck/leaktest/bootcheck/probe_match gates, a final `--disk` run on the merged tree, and the STEP B A/B sheet for the owner.
- **HUD: hud.js restyle + death banner + standings built; desktop gate 49/50 then the one failure (missing space) fixed.** Phones, fallback run, layoutcheck/mobile/feelcheck/framecheck/leaktest and the side-by-side sheets still to do.
- **SIM (bot pacing): shipped in code, gates pending.** Measured in-page sweeps: baseline median match end 326 s -> 686 s, first-minute deaths 16 -> <= 12, 5 of 6 matches reach circle 5. Implementation: `K.BOT_PACE` table + STORM_PHASES.standard x1.12 (ends 269..920 s). royale.selftest 178/178. STILL TO DO: `sim_pacing.py` on the shipped defaults (10 runs incl. seed-1 replay), probe_match, botcheck, boot gate.
- **ORCH: low tier now draws straight to the canvas (no composer): -13 textures, -5 programs, -2..-7 draw calls (exact); milliseconds inconclusive on the contended box.** Warm-up and disposeMatch now call every module feature-detected. Gate 18/0/0 isolated. Open: the storm grade (OutputPass) does not exist on the low tier; low looks cleaner/more saturated than the composer path (fog blends in sRGB space) - decide if acceptable.

## Things the workers flagged for the owner/other lanes
- SMG: the in-game SMG proto has its muzzle at -Z and WPN_FLIP lists only ar + glauncher, so the SMG may be held stock-forward. Unverified in a match. (weapons.js / SIM lane)
- The sniper Meshy model has a small floating butt-stock gap. (cosmetic)
- weapons.js crosshairPoint marches the camera ray from 3 m: with the camera pulled in against a wall behind the player, a wall within ~3 m in FRONT is skipped (projectile still collides). Only matters at point-blank.
- Another lane's half-written file broke other lanes' gates several times mid-run: gates were run `--isolate` (git HEAD + own files). The merged working tree has NOT been booted or gated as a whole.

## How to resume
1. `git status --porcelain games/last-circle` and confirm the 12 modified + new files are still on disk (else restore from this snapshot).
2. Re-launch the same workflow: `Workflow({scriptPath: "<the lc-wave4 script above>", resumeFromRunId: "wf_a8a240a8-b32"})`. Each lane triages its own `<scratch>/<lane>/REPORT.md` first. If the scratch dir was cleaned, copy `F:\games\last-circle-wave4-save\lc_improve\wave4` back to `...\scratchpad\lc_improve\wave4`.
3. Order of finishing: PLAYER (run the 4 untested items) -> STORMFX (fix `vec3 flat`, tune palette, test fx.js) -> LOOT/HUD/SKY/SIM gates -> wire the new gates (`_harness/new/*.py`) into `_harness/gate.py` -> independent verify (the Verify phase of the script) -> commit lane by lane with EXPLICIT paths -> merge CREDITS snippet -> deploy without `--status` -> live bootcheck + `portalcheck --live`.
4. Then Wave 5 = Savanna town pilot (PLAN P2.1-P2.5, assets already staged by ART-B), Wave 6 = enterable houses (P3.2, needs the camera pull-in already built).

## Hazards
- Shared worktree: never `git add games/last-circle` or `-A`; add explicit paths. Other sessions have uncommitted work in `pipeline/` (game_controls.js copies, ffg_kernel_3d.js, many untracked files): not ours, do not commit them.
- `pipeline/deploy_game.py` uploads the WORKING TREE, not git: do not run it for last-circle until the Verify phase passes.
- The two playwright Chromes still open on the box belong to another session.
