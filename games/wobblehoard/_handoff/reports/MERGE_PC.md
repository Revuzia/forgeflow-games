# MERGE_PC: origin/squish-keeper-pc (THEIRS, live) into claude/exciting-faraday-2dakqx (OURS, PLAYGROUND)

Date 2026-11-16. Merge in progress in the working tree (`git merge --no-commit`): HEAD f661db85, MERGE_HEAD 9211d66b, base 1e5a1159.
No git write command was run. The 9 conflicted files are resolved in the working tree but are still unstaged (`UU`). The orchestrator stages and commits them.
src/shell, src/ui and src/input are byte-identical to THEIRS (`git diff MERGE_HEAD -- src/shell src/ui src/input` is empty). I did not edit them.

## Result

- `npx tsc --noEmit -p tsconfig.json`: **0 errors** (exit 0). No extra fixes were needed in OUR new files.
- No conflict markers are left in the tree (dist, node_modules and _live_snapshot excluded).
- Node probes: see the table below. Every count matches what was expected. The one failure not on the expected list (DT-11) is pre-existing on OURS.
- `vite build`: OK. G0 2117 KB of 3072, G0b 511 KB gzip of 600. Both pass. All 5 required strings are in dist/assets.

## Per-file resolution

### src/render/core.ts (1 hunk)
- Hunk 1 (`halo.set` at the end of `update`): OURS added `this.noHalo ? 0 : ...` (RD-06 lite chunk). THEIRS added `if (this.hidden) { blob/halo invisible }` (CUT3 LOD). **Union**: OURS's `noHalo` term is in the halo alpha, and THEIRS's `hidden` line follows it. THEIRS's `* (this.cut ? this.kept : 1)` on `hs` was auto-merged and is kept.

### src/render/bodyview.ts (4 hunks)
1. Constructor signature: kept OURS's `lite = false` parameter. Kept THEIRS's `isPiece = isCutPiece(inner.piece)` and `chunk = chunk && !isPiece` (THEIRS no longer assigns `this.chunk = chunk` directly). Also kept `this.lite = lite`.
2. Face and core creation: kept THEIRS's `hubRef`, `this.face = this.makeFace(hub)` and `core.setPiece(...)`. Kept OURS's `core.noHalo = lite && this.chunk` (now uses the piece-aware `this.chunk`). OURS's `this.face.pose = this.pose` moved **into `makeFace()`**, so a face rebuilt after a merge publishes a new PieceInfo (`rebuildFace`) also gets the render pose.
3. Start of `update`: kept OURS's sleep gate on `j.update()` (`asleep`, `fineUpdates`) and OURS's player-motion latch. THEIRS's `if (isPiece && body.piece !== facePiece) rebuildFace()` is inserted right after the jelly update. It runs whether the body is asleep or not.
4. Face update: kept OURS's pose and look uniforms. The face call is now THEIRS's guard `!this.chunk && this.face.eyeCount > 0` plus OURS's 7th argument `touched`.
- Auto-merged parts I checked: THEIRS's `setLod`, `planeIsFace`, `faceLod`, and `core.update(..., j.caps)`. OURS's `fineFreqFor` and `applyQuality`. With `lite` false, `fineFreqFor` returns `spec.fineFreq`, so THEIRS's behaviour is unchanged.

### src/render/face.ts (5 hunks)
1. Header comment: kept both paragraphs (CUT2, then PLAYGROUND).
2. Imports: kept THEIRS's `PieceEye/PieceEyes` and `wholeRef` imports, plus OURS's `RenderPose` import and the `EXPR_*` exports.
3. Constructor: OURS's `shySide` and `irisBase` are assigned **before** THEIRS's early `return` for a piece with no eye (they are readonly and must be definitely assigned). Then come THEIRS's `anchors` and `wanted`.
4. Methods: dropped OURS's copy of `anchorFootprint`, because THEIRS moved that logic to wholeRef.ts and OURS had not changed it. Kept OURS's `setExpression`, `setEyeAlpha`, `lookToward` and the `update(..., touched = false)` signature.
5. Eye anchor in `update`: THEIRS's `calibrate(eye)` runs first, so the bias is measured without expressions. Then OURS's sleepy/proud offsets, then OURS's render pose, then `eyeWorld` (OURS) and `centreOut` (THEIRS), both written after the pose, then THEIRS's `updateClip`. With no expression and no pose, every number is THEIRS's.
- **Semantic fixes needed because THEIRS made eye count variable (0, 1 or 2 per face):**
  - `setEyeAlpha(e, a)`: OURS indexed `mats[e*2]` by slot. A piece holding only slot 1 has only `mats[0..1]`. It now finds the drawn eye with `slot === e` and uses its index.
  - Iris uniform: OURS wrote `irisU[0]` and `irisU[1]` unconditionally, which would crash on a 0-eye or 1-eye piece. It is now a loop over `irisU`.
- Shader key: OURS left `wh-eye-v1` and THEIRS bumped it to `wh-eye-v2` (INK_BACK and clip planes). OURS's change (a shared uniform object for uIris) does not change the program, so `wh-eye-v2` stays.

### src/render/material.ts (4 hunks)
1. `JellyUniforms`: union. OURS's uPose, uPoseC, uLook, uHeat, uToastCol, uFrostCol, uSandCol, uSnowL, then THEIRS's uCapRough, uCapCoat, uCapTint, uCapDepth, uCapGlow.
2. EMISSIVE_STAGE seam lines: took THEIRS's text (`jSeam *= 1.0 - jCap` and the cut-face rim glow). OURS had only rewritten these lines' `//` comments into `${/* */''}` form, with no change to the code. OURS's toast lines right after the hunk were auto-merged and are kept.
3. Uniform values: union of both sets.
4. Program cache key: **both sides bumped `wh-jelly-v4` to `v5` for different programs**. OURS's v5 adds the render pose and the looks block. THEIRS's v5 adds the aCap/jCap cut face. The merged program uses **`wh-jelly-v6-...`** so it never shares a key with either v5 program. The comment in the code explains this.
- Auto-merged parts I checked: the vertex stage has both `${POSE_VERT}` and THEIRS's `vCap/vCapP/vCapD`. THEIRS's `jCap` global, cut-face tint, thickness, `WH_LOW` alpha, grain gate, roughness and clearcoat replaces are present. OURS's looks block, toast tint, `setLight`, `keep` getter and `whiteBalance(tint)` are present.

### src/render/stage.ts (5 hunks)
1. `StageDev`: union. THEIRS's `eyeCentres(...)` plus OURS's emotes, homeKit, loadLifeLook, autoFraming, placeHost.
2. Start of `updateCamera`: OURS's place camera (`play`) keeps its early return. Before that return it now calls `framer.clear(); framer.ease(dt); applyLens(false)`, so THEIRS's SR2 band-framing lens shift cannot stay frozen while a place is shown. The lens eases back to none. After it comes THEIRS's `framer.measure` / `framer.clear()`. At Home (`play` null), the code path is exactly THEIRS's.
3. `addBody`: kept THEIRS's idempotence loop (an existing view's id is returned) and passes OURS's `!!opts?.lite`.
4. `dispose`: union. OURS's `emotes/home` dispose and `placeHost.enter(..., null)` plus THEIRS's `lockfx.dispose()`.
5. DEV properties: union. THEIRS's `eyeCentres` plus OURS's dev getters.
- Auto-merged parts I checked: `framingFor`. THEIRS's piece-group (`grp`) block comes before OURS's slot-based loop (`framePoint`/`slotXZ`). The `grp` reach and aim read live centres, which is THEIRS's behaviour. OURS's `rest` parameter is kept. The other changes merged cleanly: `assignLod`, `lockfx.update`, `framer.setInsets`, `framer.reset()` in `clearBodies`, `applyLens(true)` in `applySize`, OURS's `fadeOccludedEyes`, places, emotes and `setBody*` APIs.

### src/audio/engine.ts (3 hunks)
1. Imports: union. OURS's `LifeVoices`/`Ambience` types plus THEIRS's `ui.ts` imports.
2. `setSettings`: union. OURS's `chatter` and `ambience` plus THEIRS's `uiSounds` switch.
3. Methods: OURS's PLAYGROUND block (creature … setAmbience), its closing `},`, then THEIRS's `ui(p)`. THEIRS's ceremony hold and its `started.ui` and `throttled.ui*` counters were auto-merged next to OURS's host counters, with no key clash.

### _harness/renderview/view.ts (1 hunk)
- Imports: union, `makePg` (OURS) and `makeCut2` (THEIRS). Both are used: `cut2:` in the dev API and `const PG = makePg(...)`.

### _harness/audioview/view.js (1 hunk)
- Union: `Object.assign(window.AV, lifeApi)` (OURS: renderPhrases, phraseLeak, CR_CONST), then THEIRS's `window.AV.uiConsts` and `hoverSoundAllowed`. No key overlaps.

### _harness/probe_audio.mjs (7 hunks)
- Header comment and imports: union (`lifeChecks`, `uiChecks`).
- Flags: `onlyLife` and `onlyUi` both exist, and `only3 = only3 || onlyRoom || onlyCut || onlyLife || onlyUi`.
- Sections: the life block runs on `(!only3 || onlyLife)` and the UI block on `(!only3 || onlyUi)`. The round3, room, cut and live-engine-3 blocks each skip on `!onlyLife && !onlyUi`. So `--only-life` runs only life, `--only-ui` runs only UI, and a full run runs both. `node --check` passes. This probe needs a browser and was not run (as instructed).

## Other edits
None outside these 9 files. tsc was clean right after the resolution, so no OUR new files needed changes.

## Other checks
- `src/contracts.ts` (auto-merged) is coherent. `SoftMetrics.locked?: number` is declared twice: once by THEIRS (LOCK) and once by OURS's PLAYGROUND interface-merging block, which declared it in advance of LOCK. Both have the same type and meaning, and tsc accepts them. `uiSounds?` appears in two different interfaces, AudioSettings and Settings, as THEIRS intended. `AddBodyOpts` merges `piece?` (THEIRS) and `lite?` (OURS).
- Other files changed on both sides and auto-merged: `_harness/browser_render.mjs`, `_harness/browser_shell.mjs` (`node --check` OK) and `_harness/shellview/node_checks.ts` (130/130).
- `src/ui/toyTray.ts` is deleted, as on THEIRS. Nothing in OURS imports it (tsc is clean).

## Probes (merged tree)

| probe | result | expected |
|---|---|---|
| probe_app.ts | 183/183 | 183 (THEIRS STATUS) |
| probe_gestures.ts | 160/160 | |
| probe_merge.ts | 22/22 | |
| probe_economy.ts | all passed (163 ok rows) | |
| probe_catalog.ts | all passed (130 ok rows) | |
| probe_collection.ts | 74/74 | (STATUS mentions C08 failing on that PC; passes here) |
| shellview/node_checks.ts | 130/130 | 130 (THEIRS STATUS) |
| probe_life.ts | 95 ok, 1 fail (LF-02 allocation) | 95 ok, 1 fail LF-02 |
| probe_life_imports.ts | all LF-12 rows ok (5) | |
| probe_pg_data.ts | 30 ok, **1 FAIL DT-11** | see below |
| probe_quests.ts | all run checks passed (44 ok), 4 NOT RUN | identical on OURS alone |
| probe_journal.ts | all passed (21 ok) | identical on OURS alone |
| probe_chatter.ts | 42/42 | 42/42 |
| renderview/pg_node_checks.ts | 35 ok, 0 FAIL | 35 ok |

DT-11 ("new salt in src: 0x2c1b3c6d") is **pre-existing on OURS and not caused by the merge**. The constant is in OURS's `src/audio/music.ts:826` (the music style "thin" draw), and the probe's KNOWN list does not include it. I extracted HEAD with `git archive` into the scratchpad and ran the probe there: it fails the same way. I left it alone because it is OURS's in-progress work. The probe's own remedy is to add the salt to the row's list once the constant is confirmed distinct, which is a decision for the PLAYGROUND owner.

## Build (`node node_modules/vite/bin/vite.js build`)
- Built in about 1 s with no errors. There are 2 INEFFECTIVE_DYNAMIC_IMPORT warnings, both in THEIRS's code (`physics/piece.ts`, `physics/softbody.ts`).
- Largest chunks: stage 571.57 kB (gzip 163.45), index 475.24 kB (175.51), three.core 207.17 kB (55.02), engine 69.01 kB (25.12), catalog 39.19 kB, lifelook 23.79 kB, hearthlog 17.13 kB, place 16.23 kB, life_voices 15.61 kB, later-screens 15.47 kB, ambience 12.94 kB, ui 12.36 kB, later-trophies 9.75 kB. CSS index is 98.34 kB (gzip 19.68).
- **G0 2117 KB of 3072: pass. G0b 511 KB gzip of 600: pass.** For comparison, THEIRS alone (built from `git archive MERGE_HEAD` in the scratchpad) gives G0 1934 and G0b 435. The +76 KB of G0b comes from OURS's lazy PLAYGROUND chunks (place_*, lifelook, life_voices, ambience, hearthlog …). The G0b rule counts every non-`later-*` chunk, even lazy ones. three.core also moved into its own shared chunk.
- Strings found in dist/assets: `wobblehoard:v1:ach`, `forgeflow:achievement`, `forgeflow:whoami` and `forgeflow:identity` are in index-*.js. `Trophies` is in index-*.js and later-trophies-*.js.
- dist/ is gitignored. It was left from this build.

## Doubts / things to watch
1. **Eye clip and render pose on a piece**: on a cut piece, THEIRS clips the eye beads against the jelly's live cut faces (`JellyView.caps`). OURS's render pose moves the eye anchors and the skin in the vertex shader. Whether `caps` include the pose is untested. If a pose is applied to a straddled piece, the clip plane could sit slightly off the posed face. Nothing calls `setBodyPose` yet, because PLAYGROUND is not wired.
2. **`lite` and THEIRS's lod.ts**: OURS's `BodyView.fineFreqFor` (lite) lowers the frequency, then THEIRS's `JellyView.rebuild` lowers it again by frac (lod.ts `fineFreqFor`), so a lite chunk would get both reductions. The shell never passes `lite`, so this only matters once PLAYGROUND is wired.
3. **autoFraming and pieces**: OURS's `framePoint` gives a mat slot to every visible non-chunk view. THEIRS's true pieces are not `chunk`, so with autoFraming on (LIFE at Home, not wired) each piece would take a slot. THEIRS's piece-group framing (`grp`) still widens the framing from the pieces' live centres.
4. **Place camera and SR2 framing**: in a place, I chose to release the band-framing lens (clear and ease to 0) instead of measuring. If places should also respect the HUD band, this needs a design decision. Home behaviour is exactly THEIRS's.
5. **Duplicate `SoftMetrics.locked` declaration** in contracts.ts (same type, compiles). It can be deleted from the PLAYGROUND block when convenient.
6. **OURS's shell and UI work is gone**, because the shell was taken from THEIRS. OURS's PLAYGROUND hooks in the shell (if any existed in hudBinding/game/debugHook) must be re-wired later. The node probes do not reveal any loss.
7. Nothing renders in this merge without a browser. Shader compile (the `wh-jelly-v6` program with pose, looks and cut face) has not been tried on a GPU. Run `browser_render.mjs` and `probe_audio.mjs` once a browser run is allowed.
