# Last Circle — build plan to the BLOCKTOOTH / DYEFIELD bar

Source: the 8 audit lanes in this folder (frame-pipeline, boot-robustness, harness-gates, bots-match, mobile,
feel-juice-ui, characters-art, live-measure). Every item below cites the lane that measured it; the file:line quotes
live in those lane files. I spot-checked these quotes against the working copy this session (grep, all matched):
ffg_royale3d.js:282 `wantExt = Math.min(620, ...)`, ffg_kernel_3d.js:475 `const dt = Math.min(0.05, ...)`,
ffg_kernel_3d.js:374/:397 castShadow on every mesh, weapons.js:379 `wpn.cd -= dt;` / :435 `wpn.cd = 60 / def.rpm;`,
ffg_royale3d.js:444 compileAsync, fx.js:445 renderer.compile, index.html:61 "Still loading..." overwrite,
bots.js:675 cellBlocked / :681 midpoint window, player.js:962 far-bot LOD, hud.js:1927 annWrap top 14%,
hud.js:2318 reticle bloom scale, audio.js:594 `if (own) duckMusic();`, rig_pipeline.js:49 `weapon: ["RightHand", "FistR"]`,
game_controls.js:810 `"last-circle": "shooter",`.

Also checked this session:
- `git diff --stat games/last-circle` shows index.html (+/-12) and runtime/3d/ffg_kernel_3d.js (+91), both uncommitted, from the other session.
- `ls games/last-circle/_harness` lists botcheck.py, botdiag.py, bridge_host.html, stuckdiag.py. There is no `_tools/`.
- `ls assets/vendor/three` finds only `examples/jsm/libs/draco/`.
- pipeline/engine/runtime/game_controls.js has the same md5 as the Last Circle copy (247244852e82...). build_order.py:243-245 copies it into each game.
- deploy_game.py:646-655 takes `--game-dir --slug [--metadata --dry-run --force --status --no-portal]`. CDN_BASE is https://forgeflow-games-cdn.isimcha85.workers.dev (deploy_game.py:472).
- DEV_ONLY_DIRS (deploy_game.py:62-74) includes `_harness` and `_tools`, so neither ships.

Rules for every lane: stay inside your files. Never revert the other session's work in index.html or ffg_kernel_3d.js.
Any consumer of another lane's API must feature-detect it (`kernel.viewW ?? el.clientWidth`, `mod.disposeMatch && ...`,
`W.touch && W.touch.active`). That way lanes can land in any order and each stays green on its own. View code is proven
only in a real browser, because Node selftests never run runtime/3d/*. Perf numbers are information, not a blocker.
The box is shared: gates step frames directly (W.kernel tweens -> mixers -> updaters -> render) instead of waiting on rAF, and they exit 2 (could not judge) on environment failures.

---------------------------------------------------------------------------------------------------
## 1. What a player will notice, ranked (player impact first, then verification cost)

| # | change | what the player sees today (measured) | cheapest proof | lane |
|---|---|---|---|---|
| 1 | Character triangle diet: decimate the 5 bodies to ~15k, add a ~2.5k far LOD1, give shadows to nearby actors only, cap the glide shadow box | Drop frame 9.9 M tris, 86.5% of them character shadows. Ground cluster 32.9 M tris. Drop cluster 20.1 M. Bodies are 245k-632k tris each (DYEFIELD bar is 12k) | framecheck counts (exact; do not depend on the GPU) | L2, L5, L4 |
| 2 | Real shader warm-up: one composer.render() into the RT under the loading screen, chute and LOD included | 27 programs compile on the first drop frame (3/3 runs). After the lobby appears it ignores Enter for 4.3-9.2 s (median) | framecheck: new programs on drop frame 1 == 0 | L3, L4, L5, L7 |
| 3 | Guns and ammo on the floor | 74.8% of bot lives end holding the pistol. 60.2% of gun kills are pistol kills. isla_viva has 1 light-ammo box | probe_match storm-on, 6 seeds | L6 |
| 4 | Bot navigation that knows about floors | isla_viva: 12-27% of moving time stuck. One bot sat in a corner for 329 s. 0/30 usable paths beyond 120 m | probe_match + probe_paths | L6 |
| 5 | Bots use snipers and launchers by range, spread their drops and read target EHP | 34.4% of bots carrying a sniper or launcher are holding the pistol. 4 sniper kills in 539. 27-51% of the lobby dies in the first 60 s | probe_match | L6 |
| 6 | Hit feedback: kill-confirm marker, readable reticle, one accumulating damage number, shield-break beat | The kill marker is overwritten in the same frame. The reticle is ~0.9 px. SMG numbers stack over the name tag | feelcheck read-back + screenshots | L7 |
| 7 | HUD collisions: banners below the quest card, ammo above the portal bar, menu wordmark on-screen | Every match: DEPLOY/ELIM/VICTORY cover the LVL chip, and the ammo count is under the fullscreen/mute bar. At 1280x720 the wordmark top is at -57 px | layoutcheck rects | L7 |
| 8 | Boot resilience: vendored three, a head guard that never erases a failure, named failures + one auto-retry, a frame throw shows a card, a failed match load returns to the menu, WebGL checks | jsdelivr blocked = the game never starts. Every failure message becomes "Still loading... reload" at 30 s. One thrown frame = frozen forever. A GLB 404 = infinite loading screen | bootguard (headless is enough) | L9, L3, L4 |
| 9 | Texture leak on PLAY AGAIN | Textures at the lobby go 44 -> 86 -> 177 over 3 matches | leaktest | L4 plus owners (Stage 0 census) |
| 10 | Frame-rate-independent combat: carry the cooldown overshoot now, fixed tick + interpolation after | SMG fires 600 rpm at 60 Hz (designed 720). Jump apex 1.356 m at 144 Hz vs 1.190 m at 20 Hz. Below 20 fps the match runs in slow motion | in-page CADENCE probe; jump apex at 20/144 Hz via stepFrames | L6 (carry), L4 + L5 (tick) |
| 11 | Phones: native touch layer (look, fire, USE, ADS, slots, map), HOW TO PLAY dismissable, no "desktop only" cards, phone HUD layout, portrait fit kept, rotate overlay | Camera cannot turn (dyaw 0). The first FIRE press is eaten. Chests can't be opened. GOT IT is off-screen on every landscape phone | mobile.py real CDP touch | L10, L5, L7, L6, L3 |
| 12 | Drop-cluster draw calls: one instanced draw for parachutes, one atlas billboard for nametags | Drop cluster 482 calls (budget 450). Chutes are 200 of them, nametags 49 | framecheck | L5 |
| 13 | Hitches: forced layout, allocation, mixer LOD that does nothing | 1.00 forced layout per drop frame. 554.5 KB allocated per match frame. queryColliders runs 423x per frame. timeScale-0 mixers still evaluate | framecheck (CDP LayoutCount, heap sampling) | L3, L5, L6, L7 |
| 14 | Audio polish: music stops pumping on own shots, voice cap | 30 duck ramps in a 3.7 s SMG burst | playtest audio block | L8 |
| - | Enablers (no direct player effect): gate suite, frameprof, `__LC__.stepFrames/prof/feel`, fixing the rig-audit false positives | 0 browser gates. About 235 false `[rig]`/binding warnings per load bury real ones | each gate FAILS on today's build | L1, L3, L4, L5 |

### Deliberately left out (and why)
- **DynRes controller.** The frame is bound by vertices and skinning, not fill (ffg_royale3d.js:157-160 plus the draw attribution). Only the DPR budget cap (<= 1.5) goes in. Re-measure after #1.
- **Map-wide instanced prop culling and foliage LOD** (characters-art W1: effort L, already BUILD_ORDER #55) and **map structure shadow casters** (W2). The glide shadow-box cap covers the measured drop hot spot.
- **Dropped-loot instancing** (live-measure G6: the endgame peaked at 480/481 calls in 2 of 9 runs). Re-measure after #12; build it next only if the endgame stays over 450.
- **Gamepad, PWA manifest/icons, 44 px portal control-bar buttons.** The bar lives in the shared game_controls.js used by 42 games. The shared worker's immutable-cache rule for vendored three is also out, and so is gating preserveDrawingBuffer.
- **Low-value juice** (feel G11 fades, G13 post-match count-up): marked STRETCH inside L7 and done only if L7's gates are already green.
- **Registry `games.mobile_support` flip, "VICTORY ROYALE" wording (Epic's phrase, hud.js:2989/:3012), and match-pacing targets.** These are the owner's calls (section 7).

---------------------------------------------------------------------------------------------------
## 2. Stage 0 — before any lane edits (read-only, ~1 h)

1. **Freeze the cross-lane contracts** below. They are copied into each lane's brief.
   - C1: `kernel.viewW / kernel.viewH`. CSS px, cached by a ResizeObserver. Provided by L3. Read by L5, L7 (fallback: clientWidth).
   - C2: `kernel.onError(fn)` plus `window.__LC_BOOT__ = {handoff(), fail(title, detail, actions?), info(msg)}`. L9 provides the guard, L3 calls onError from the loop catch, L4 installs the royale error card (MAIN MENU / RELOAD).
   - C3: `kernel.prof` with begin(name)/end(name)/gpuBegin/gpuEnd. It is a no-op unless `?prof=1`. Provided by L3 (ffg_frameprof.js). L4 marks the modules.
   - C4: mixer policy flags on AnimationMixer. The kernel skips `m._ffgSkip === true` and ticks `m._ffgRate` (1, 2 or 4) with accumulated dt. L3 implements the policy, L5 sets the flags.
   - C5: fixed tick split. Modules export `tick(W, SIM_DT)` and `frame(W, dt, alpha)`. `update(W, dt)` stays as tick + frame(alpha = 1), so the old orchestrator still works. L4 drives it, and L5 splits player.js. bots, weapons, loot and storm are tick-only already.
   - C6: touch state. touch.js writes `W.touch = {active, mx, mz, fire, jump, use, ads, sprint, reload, pause}` plus `W.touch.takeLook() -> {dyaw, dpitch}` (radians), and `hud.setTouchMode(W, on)`. L10 writes it. L5 consumes it in installHumanInput. L7 implements setTouchMode and tappable slots (they call `W.equipSlot`). L6 reads `W.touch.fire` for semi-auto re-arm.
   - C7: warm-up. `ffg_warmup.js: warmup(kernel, {extras: Object3D[]})` comes from L3. `playerMod.warmObjects(W)` (L5) and `fxMod.warmObjects(W)` (L7) return extras. L4 calls warm-up in _startMatch before showLobby, and fx.prewarm is retired.
   - C8: dispose. Each module exports `disposeMatch(W)`. L4 calls all of them in the _startMatch teardown next to ffg_royale3d.js:355-356.
   - C9: test surface (L4). `__LC__.stepFrames(n, dt, render)` runs synchronous kernel frames. `__LC__.prof()` reads frameprof. `__LC__.feel()` merges `hudMod.readback(W)` and `fxMod.readback(W)` (L7) and the audio duck/voice counters (L8: `audioMod.readback(W)`).
2. **Attribute the texture leak.** It is unidentified today; live-measure names candidate producers only. In scratch, extend leaktest.py with a per-group texture census at the match-2/3 lobby. Walk scene + protos + the fx/loot/weapon/nametag caches, and diff `renderer.info.memory.textures` against the texture set still reachable. Output: owner file per surviving texture group. That decides which lane's `disposeMatch` must free what. The candidates are loot.js:314/:416 (L6), weapons.js:247 (L6), player.js:554 CanvasTexture (L5) and fx.js:129/:155 (L7).
3. **Check the in-flight edits.** Run `git status` / `git log -3 -- games/last-circle`. If the other session has committed index.html or ffg_kernel_3d.js, build on HEAD. If not, L9 and L3 build on the working copy. Their commit message says the PORTRAIT CAMERA FIT hunk and the ?v= bump came from the concurrent session.
4. **Keep the baseline.** `scratch/_reports/lc_liveprobe_base_20260930_003158.json`, framepump5/6/7_out.json, leaktest.log and onA-onD.json are the "before" column. Do not re-run them before the lanes land.

---------------------------------------------------------------------------------------------------
## 3. Build lanes (file-disjoint; one owner per file)

| lane | owns (and only these) |
|---|---|
| L1 HARNESS | games/last-circle/_harness/** (new files + botcheck.py, botdiag.py, stuckdiag.py) |
| L2 ASSETS | games/last-circle/_tools/char_lod.py (new); assets/chars/meshy/{athlete,juggernaut,soldier,viper,wraith}.glb; assets/chars/meshy/*_lod1.glb (new) |
| L3 KERNEL | runtime/3d/ffg_kernel_3d.js (hot, holds the in-flight portrait fit); runtime/3d/ffg_frameprof.js (new); runtime/3d/ffg_warmup.js (new) |
| L4 ORCHESTRATOR | runtime/3d/ffg_royale3d.js (hot) |
| L5 ACTORS | runtime/3d/royale/player.js (hot); runtime/3d/royale/rig_pipeline.js; runtime/3d/royale/nametags.js (new) |
| L6 SIM+BOTS | runtime/sim/royale.js (+ royale.selftest.cjs); runtime/3d/royale/{bots,weapons,loot,maps}.js |
| L7 HUD+FX | runtime/3d/royale/hud.js (hot); runtime/3d/royale/fx.js |
| L8 AUDIO | runtime/3d/royale/audio.js (+ new audio_pool.selftest.cjs if the pool is split into a pure helper inside audio.js) |
| L9 BOOT+NET | index.html (hot, holds the in-flight ?v= bump); runtime/3d/ffg_boot3d.js; assets/vendor/three/** (new, except the existing draco/); runtime/3d/royale/net.js; runtime/net/ffg_netplay.js |
| L10 TOUCH | runtime/3d/royale/touch.js (new); runtime/3d/royale/aimassist.js (new) + aimassist.selftest.cjs (new); pipeline/engine/runtime/game_controls.js AND games/last-circle/game_controls.js (PROFILES line 810 only; the two stay byte-identical) |
| L11 DEPLOY | pipeline/deploy_game.py (shared by every game; see section 7) |
| INTEGRATION | games/last-circle/CHANGELOG.md, the final ?v= bump in index.html (after L9 has landed) |

Untouched: pose.js, storm.js, content.json, game_meta.json.

### L1 HARNESS — build first; every other gate runs on it (effort M-L)
Changes:
- **common.py**, adapted from dyefield/_harness/common.py (INIT_JS :82, _on_reqfail :565-574, shader split :827-829, diag_problems :863).
  - `--base` defaults to http://127.0.0.1:8790/games/last-circle/index.html. `--disk` serves the game dir read-only via page.route, which avoids the :8790 connection refusals seen under load.
  - `step_frames()` pumps the kernel directly.
  - Exits 0 pass / 1 fail / 2 could not judge. It refuses to judge (2) when the server refuses connections or rAF is starved on a check that needs rAF.
  - It is the lobby helper: it presses Enter so W.phase really reaches "match" (bots S5: every old probe ran with the storm off).
- **bootcheck.py.** Real PLAY click, real canvas click (pointer lock), real W held 1.5 s -> moved > 3 m. Requires 0 errors, 0 failed requests, 0 shader errors and 0 `[rig]` warnings, with frames and W.t advancing. The PropertyBinding "No target node" pattern is allow-listed until L5 removes it.
- **bootguard.py.** Seeded from scratch/bootfault.py, hangprobe5.py and esmprobe.py. Cases:
  - a: normal
  - b1: entry 404
  - b2: hud.js 404
  - b3: retry flag already set
  - c: slow150
  - d: three never answers
  - e: jsdelivr blocked
  - g: no WebGL
  - h: sitelock
  - i: content.json 404
  - j: frame throw
  - k: context lost
  - l: GLB failure at match start
  - m: esm.sh blocked in SQUAD UP
- **rigcheck.py.** The harness-gates spec (a)-(e): head-to-foot distance in [1.3, 2.2] m; holder parent === hand bone and within 0.05 m; barrel vs chest / camera per weapon family; no chute stuck on the ground for more than 0.5 s, including a real Space-spam run; a side-view PNG per weapon.
- **playtest.py.** Real-input solo match. Parked-cursor camera drift < 0.05 deg. Locked mouse +200 px -> yaw per sensitivity. Exactly 1 report per shot in the played window. PLAY AGAIN loop with 0 errors.
- **portalcheck.py.** Headed Chrome, second origin, sandbox string parsed from src/components/game/GamePlayer.tsx:177-178, real click -> pointerLockElement set within 2 s. Optional `--live` (GET only).
- **framecheck.py**, from scratch/framepump5/6/7.py. Exact counters, independent of the GPU:
  - draws/tris by pass and group;
  - new programs on the first drop frame and on sampled frames;
  - CDP LayoutCount per frame;
  - KB allocated per frame (heap sampling);
  - queryColliders calls per frame;
  - geometries across 10 SPACE toggles.
- **leaktest.py** (promoted, plus the Stage-0 census). **perfcheck.py**: lc_liveprobe.py promoted, information only, records the box's other-Chrome count. **probe_match.py + probe_match.js**: storm-on, fingerprints, pistol/stuck/dry/sniper stats, same-seed replay; from scratch/probe_match.*, probe_paths.*, probe_farwall.*.
- **feelcheck.py** (scratch/fju shots3/4 logic via `__LC__.feel()`). **layoutcheck.py** and **mobile.py**, ported from dyefield/_harness (DEVICES list; real CDP multi-touch via the Touch class; `--use-angle=swiftshader` on this box).
- **gate.py.** Runs `node runtime/sim/royale.selftest.cjs`, the other Node selftests and then every browser gate, and prints one verdict table.
- Retarget botcheck/botdiag/stuckdiag to common.py's `--base` and the lobby helper.

Acceptance (browser; this is the lane's own proof):
- On TODAY's build, framecheck FAILS (27 new programs on drop frame 1). feelcheck FAILS (kill marker, reticle). layoutcheck FAILS (annWrap overlap, ammo under the bar, wordmark). bootguard FAILS b1, e, j and l. mobile.py FAILS (look drag dyaw 0). leaktest FAILS (44 -> 86 -> 177). probe_match FAILS the replay and pistol gates. bootcheck FAILS on 55 `[rig]` warnings.
- rigcheck PASSES today (holder 0.02 m on 50/50 actors) and FAILS when the holder is re-parented in the page (0.617 m, driftpark.json).
- portalcheck PASSES with the real sandbox string and FAILS without allow-pointer-lock.

### L2 ASSETS — offline, no runtime file (effort S)
Changes:
- `_tools/char_lod.py` drives the installed `gltf-transform simplify` (CLI 4.4.2). This fixes the generator; the GLBs are its output.
  - LOD0: `--ratio 15000/<tris> --error 0.01` for all 5 bodies.
  - LOD1: ~2,500 tris written as `<skin>_lod1.glb`.
  - It asserts that `skins[0].joints` has identical order and length, that JOINTS_0, WEIGHTS_0 and UV survive, and that tris are within budget.
  - Keep the Draco encoding so the DRACOLoader path is unchanged.
- The `*.glb.pre_mixamo.bak` files are not inputs.

Gates:
- Offline (python): each LOD0 has <= 16k tris and each LOD1 <= 3k, with an identical joint list.
- Browser: the scratch/chars/charprobe5.py drop cluster is <= 2.0 M tris (was 20.07 M) and the ground cluster <= 2.5 M (was 32.91 M). rigcheck PASSES on all 5 skins. abrender.py A/B at the 4.2 m follow distance (soldier + juggernaut) has mean |diff| <= ~1.1/255, and the screenshots are eyeballed.

### L3 KERNEL — ffg_kernel_3d.js + 2 new files (effort M)
Build on the uncommitted PORTRAIT CAMERA FIT hunk (applyCameraFit, visualViewport nudges). Do not revert it.

Changes:
- a. `start()` loop: schedule rAF first and wrap the body in try/catch. On a throw, cancel the loop and call `this.onError(e)`; the default is console.error plus `__LC_BOOT__.fail` (boot G4, DYEFIELD game.ts:503-513).
- b. Call `this.applyCameraFit()` after the updaters and before render. One place fixes both per-frame fov overwrites (hud.js:485 menu, player.js:1905 match), so neither L5 nor L7 has to touch the fit.
- c. A ResizeObserver on the parent caches viewW/viewH (C1) and drives `_resize`. Keep the window resize and orientation nudges. Nothing reads clientWidth per frame (blocktooth renderer.ts:105-124).
- d. Set `renderer.info.autoReset = false` and reset once per frame, so the honest counters include the shadow and bloom passes.
  - Add `ffg_frameprof.js`: a port of blocktooth/src/render/frameprof.ts with the types stripped (ring, worst-50, LoAF, GPU timer queries), active only with `?prof=1`.
  - Marks: tweens / mixers / updaters / render.
  - BUDGET: `{drawCallsMax: 450, p99Ms: 22, dprMax: 1.5}` (C3).
- e. Mixer policy flags `_ffgSkip` / `_ffgRate` (C4). Today mixers tick at ffg_kernel_3d.js:489-equivalent (line shifted by the in-flight hunk).
- f. `setDpr(tierDpr)` -> effectiveDpr = max(0.5, min(devicePixelRatio, tierDpr, 1.5)).
- g. `webglcontextlost` (preventDefault, stop, onError card) and `webglcontextrestored` -> reload.
- h. loadGLTF/loadCharacter get a 30 s Promise.race that rejects `new Error("timed out loading " + url)`.
- i. An unregistered genre throws instead of `return null` (boot G11).
- j. `ffg_warmup.js` (C7), a port of blocktooth/src/render/warmup.ts:24-69 adapted to the composer:
  - force visible, set frustumCulled = false, and set InstancedMesh count >= 1;
  - compileAsync with the composer's readBuffer bound;
  - run ONE real `composer.render()` (RT, shadow-depth, bloom and output programs; uploads textures and buffers);
  - restore exactly.

Gates:
- bootguard j (throw -> card within 1 s) and k (lost -> card; restored -> reload).
- Portrait 390x844 in a match: fov > 57 after 10 stepped frames (scratch/lc_verify.py). At 16:9, fov stays bit-identical.
- `?prof=1`: `__LC__.prof()` returns per-section mean/max plus GPU ms (after L4). Without the flag, no extra calls.
- `?` plus DPR-2 emulation: the high tier renders at 1.5.
- framecheck: drop-frame forced layouts = 0.00. This completes when L5 and L7 switch their reads.

### L4 ORCHESTRATOR — ffg_royale3d.js (effort L, in two phases)
Phase A (Wave 1-2):
- a. Replace the warm-up at :421-446 with `ffg_warmup.warmup(kernel, {extras: [...playerMod.warmObjects?.(W), ...fxMod.warmObjects?.(W)]})`, run before showLobby.
- b. Glide shadow box, :282: cap the altitude widening (e.g. `ext + min(120, (agl-40)*2.4)`), and while gliding above 40 m AGL refresh the shadow map every 3rd frame (`shadowMap.autoUpdate = false; needsUpdate` on the cadence). Must keep the ground shadowed in the drop screenshot.
- c. Frameprof marks per module (bots, player, weapons, loot, storm, net, fx, hud, audio) plus `__LC__.prof()`, `__LC__.stepFrames(n, dt, render)` and `__LC__.feel()` (C9).
- d. `startMatch` catch (:296-307, the single choke point for all 3 callers): tear down, `hudMod.showMenu`, and a "Couldn't load the match - check your connection" notice. The script loader at :40-46 rejects `new Error("failed to load " + s.src)`.
- e. Teardown calls every `disposeMatch(W)` (C8). Install `kernel.onError` -> error card.
- f. applyGraphics routes the tier DPR through `kernel.setDpr`.
  - Touch defaults: medium, shadows <= 1024, AA off at DPR >= 2 (CONTRACT_MOBILE M7).
  - loadSettings: default shake 0.5 under `prefers-reduced-motion` with no stored value.
- g. Lifecycle: pause on visibilitychange hidden / pagehide in non-net modes (in net modes, mute only). Hitstop scales sim time only (feel G14).
- h. fastForward uses an integer step count (bots S4: `fastForward(0.5, 1/30)` currently runs 16 steps).

Phase B (only after the Wave-2 integration numbers exist; the fixed tick, frame G4):
- Port blocktooth/src/core/loop.ts:230-289: accumulator, SIM_DT 1/60, MAX_STEPS 5, drop-the-debt guard, timeScale.
- The tick runs bots, player.tick, weapons, loot, storm and net. The frame runs player.frame(alpha), fx, hud and audio.
- fastForward calls the same tick.

Gates:
- framecheck: 0 new programs on drop frame 1 and on every sampled drop/match frame (with L3 and L5). The lobby answers Enter (`lobby_skip_s`) in < 0.5 s in lc_liveprobe.
- lc_liveprobe drop window: shadow share < 30% of tris (was 60-80%). The drop screenshot still shows ground shadows.
- leaktest `3 ashgrid`: textures at the m2/m3 lobby are within ±5 of m1 (needs the owners' disposeMatch).
- bootguard l: GLB 404 and abort at match start -> W.phase "menu" plus a notice within 35 s.
- The Playwright `reduced_motion="reduce"` run shows shake at HALF. A hidden-tab dispatch pauses an unpaused solo match.
- Phase B:
  - jump apex identical within 1 cm at dt 1/20 vs 1/144 (stepFrames);
  - SMG 720 ±6 rpm at 20-165 Hz;
  - the same seed via the live tick and via fastForward gives identical fingerprints (probe_match);
  - no visible stutter at 144 Hz, which needs a real display (manual/owner);
  - a SQUAD UP two-client session still syncs (UNCERTAIN, see section 7).

### L5 ACTORS — player.js, rig_pipeline.js, nametags.js (effort L)
Changes (in this order):
- a. Near-only shadows in the per-actor loop (player.js:973-1004). The body casts only if within 45 m and not (gliding and AGL > 40); the weapon only within 20 m. Keep a reference to the body SkinnedMesh when materials are cloned (:358-412).
- b. LOD1 swap by camera distance (> ~35 m) using L2's `*_lod1.glb` bound to the same skeleton. Set a fixed per-body bounding sphere at load (removes the 126-242 ms first-cull CPU skinning). Feature-detect: if a LOD1 file 404s, stay on LOD0.
- c. Mixer policy through C4: skip far (> 250 m) and off-screen actors, half rate at mid range. Dispose corpse mixers. Remove the `mixer.timeScale = far ? 0 : 1` hack (:1416).
- d. Far bots keep `blockedHoriz` + `supportAt` (bots S6, :1281-1286). The LOD drops animation only, never collision.
- e. Parachute: shared geometry and materials, one InstancedMesh for canopies (instanceColor from CHUTE_COLORS) plus one merged LineSegments. Deploy and remove toggle a slot, so nothing is allocated (:1329-1377).
- f. Nametags: `nametags.js` draws every name into one atlas CanvasTexture and renders them all with one instanced billboard. Keep the visibility rules (:992-1004).
- g. Skip the pose/IK/barrel-weld layer for actors outside the frustum.
- h. rig_pipeline.js:36-58 accepts an optional `mixamorig` prefix and the Mixamo spine names. At load, drop clip tracks that have no target bone (removes about 235 warnings per load).
- i. The mousemove `getBoundingClientRect` (:840) uses a cached rect and viewW/viewH (C1).
- j. Touch consumption (C6) in installHumanInput when `W.touch?.active`:
  - skip tryLock and `_suppressNextShot` (:808-809);
  - mx/mz come from the stick and yaw/pitch from `takeLook()`;
  - map fire/jump/use/ads/sprint/reload and the slot taps;
  - call `aimassist.js` (L10) in touch mode only.
- k. Export `warmObjects(W)` (a hidden chute instance and LOD1 meshes) and `disposeMatch(W)` (nametag atlas; any per-match textures the Stage-0 census assigns to player.js).
- l. Phase B (with L4): split into `tick` and `frame` (C5). Keep prevPos/prevYaw per actor, lerp in syncObj, and apply mouse yaw/pitch per frame.

Gates (browser):
- framecheck:
  - drop frame 1: `shadow:actors` tris < 0.5 M (was 8.57 M);
  - skinned tris per visible actor < 30k;
  - match-frame total < 5 M (was 16.5 M);
  - drop cluster calls <= 250 (was 482): `actor-chute` <= 2, `actor-nametag` 1;
  - geometries flat across 10 SPACE toggles.
- rigcheck PASS. bootcheck: 0 `[rig]` lines, and `W._rigAudit[skin].ok` for all 5.
- probe_farwall: farToNearInside = 0 (perf delta recorded as information).
- The landing screenshot still shows the player's own shadow.
- mobile.py (with L10):
  - a 160 px look drag -> dyaw >= 0.3 rad;
  - stick + look + FIRE held together all register;
  - the first FIRE after the menu drops the magazine;
  - `__H_LOCKREQ__ = 0`.

### L6 SIM+BOTS — royale.js, bots.js, weapons.js, loot.js, maps.js (effort L)
Changes:
- a. Loot economy.
  - `rollFloorItem` returns the gun plus 1-2 boxes of its own ammo (as rollChest does at royale.js:609).
  - Raise the 0.55 floor-spawn roll, or add a second item per loot point.
  - Guarantee light ammo. Target >= 3 guns per player on every map.
- b. Floor-aware navigation.
  - cellBlocked/obstacleAt (bots.js:652-679) are evaluated at the bot's support height. Drops > 1.2 m count as blocked except on ramps.
  - Centre the A* window on the bot and clamp the goal to its edge (:681-690). Run the escape search at floor height (:828).
  - Keep the wall-slide when a path is bad (:798).
  - Hard breaker: same 2 m for > 12 s -> a new goal via the nearest ramp or door.
- c. `ensureGunOut` scores weapons by DPS x falloff at the target distance (sniper beyond ~50 m while slow, launcher at mid range). `upgraded` means gunScore > pistol, so LOOT stays at 64 until it is true (bots.js:264, :944, :971).
- d. `assignDrops` caps bots per POI in proportion to that POI's loot points; the rest go to randomGroundPos (bots.js:168-192).
- e. `perceive()` gives a low-target-EHP bonus plus a last-attacker bonus. FLEE/PUSH compare own EHP with the target's (DYEFIELD director.ts:784, :914-916).
- f. Per-system seeded streams, never a shared global stream.
  - bots.js: the per-slot rng from :120 at all 19 sites.
  - weapons.js:509: `W._spreadRng`; :549 gets its own stream too.
  - loot.js:612: a seeded scatter.
- g. Cadence carry (weapons.js:379/:435): `wpn.cd += 60/def.rpm` with cd clamped >= -dt first.
- h. Semi-auto re-arm while `W.touch?.fire` is held, at the weapon's fire interval.
- i. Allocation. Hard rule: the sim stays Node-testable.
  - queryColliders (maps.js:2131-2151): reused out array, a per-query stamp instead of a Set, a numeric cell key.
  - testSegment (weapons.js:619-700): squared-distance broad-phase and one query per projectile per frame.
  - findPath: pooled typed arrays plus a binary heap.
  - moveBasis (royale.js:192): out-param.
- j. `disposeMatch(W)` for loot clones and material clones (loot.js:314, :416) and weapon clones (weapons.js:247), as the Stage-0 census assigns.
- k. The walkover pickup rule (loot.js:695-707) applies to bots too.

Gates:
- Node: `node runtime/sim/royale.selftest.cjs` green, plus new cases for the rollFloorItem ammo companion and moveBasis out-param parity.
- Browser, probe_match storm-on, >= 6 seeds (including isla_viva seeds 1 and 7):
  - pistol share of gun kills <= 35%;
  - pistol at end of life <= 40%;
  - carrying a better gun but holding the pistol < 5%;
  - sniper kills > 0 in most matches;
  - stuck < 2% of moving samples and no bot with > 5 episodes;
  - s21 (seed 1) leaves Coco Village;
  - the same seed twice gives identical fingerprints and placements, and a different seed differs.
- Census: >= 3 guns per player and >= 8 light boxes per map. probe_paths >= 15/30 usable at 120-180 m.
- CADENCE probe: SMG 720 ±6 rpm at 20-165 Hz.
- framecheck: < 100 KB allocated per match frame (was 554.5) and queryColliders calls per frame well below 423.
- botcheck hit registration unchanged.
- Pacing (INFORMATION until the owner sets targets): median deaths before 60 s and median match end.

### L7 HUD+FX — hud.js, fx.js (effort L)
P1:
- fx: one accumulating damage number per victim.
  - ~0.8 s window, a pool of 12 nodes, size tiers, red for the kill, yellow for the head, placed beside the name tag.
  - Shield-break shard burst.
  - Scratch Color and a per-slot dir vector (fx.js:65, :247).
  - viewW via C1 (fx.js:564).
  - `readback`, `warmObjects` and `disposeMatch` (fx.js:129/:155).
- hud: hit marker.
  - A kill latch that later hitMarker events cannot downgrade for 0.5 s (hud.js:2672/:2704).
  - Four diagonal ticks plus a ring and a 1.38 -> 1 pop.
  - Colour tiers: shield blue, body white, head yellow, kill red.
- hud: the reticle arms move outward instead of scaling. Fixed 2 px thickness, >= 6 px long, still pinned to the centre (hud.js:2318-2321).
- hud: announcements.
  - The announcement band anchors below the quest card's measured bottom + 12 px (hud.js:1927). stormMsg and pickupMsg sit under it.
  - The indicator ring's top arc stays below the band (hud.js:2368).
- hud: the slot/ammo column moves to bottom >= 54 px (hud.js:1760).
- hud: menu (hud.js:625-633, :1005).
  - The wordmark is `min(7vw, 9vh)`, with flex-start plus overflow-y:auto when the menu overflows.
  - The operative preview stays hidden until its first clip resolves.
- hud: HOW TO PLAY gets `maxHeight: calc(100dvh - 24px)` plus overflowY, closes on ESC or a tap outside, and gets a touch section (hud.js:3172).
- hud, touch mode:
  - `setTouchMode(W, on)` (C6): "HOLD USE" prompts; slots tappable at >= 44 px; a minimap tap opens the big map; "CLICK TO LOOK" hidden.
  - A phone `@media` layout that clears the thumb zones. `.kbd-hint` on the hint line (hud.js:1065).
  - A rotate overlay for touch in portrait.
- hud: remove the "KEYBOARD + MOUSE REQUIRED" card (hud.js:824-838), only after mobile.py passes (it lands last in the lane).
- hud: death card in PANEL, without the duplicate spectate line (hud.js:2938). FOV label in degrees (hud.js:3325/:3502).
- hud: loading bar animates with a transform, not width (hud.js:1104). stepIndicators and :2260 read viewW (C1). Dirty flags replace the per-frame joins (hud.js:2080-2081). `readback(W)`.

STRETCH: layer fades and feed row animations (G11), post-match stagger and stamp (G13).

Gates (browser):
- feelcheck:
  - pistol kill on a pinned bot: the marker's last state is the kill style, held at opacity 1 for >= 250 ms;
  - SMG burst: <= 1 live number per victim, createElement flat after warm-up;
  - shield-break burst on the breaking hit only.
- layoutcheck desktop, 1280x720 / 1366x768 / 1920x1080:
  - annWrap does not intersect the LVL chip or the quest card;
  - ammoText does not intersect `#__ff_controls__`;
  - the wordmark is fully in the viewport;
  - reticle arms >= 2 px x >= 6 px at rest, crouched-still and sprinting.
- layoutcheck and mobile, 667x375 / 852x393 / 915x412 / 1180x820:
  - 0 clipped elements, 0 overlaps with touch controls;
  - targets >= 44 px, fonts >= 12 px;
  - GOT IT is on-screen and one tap closes it;
  - tapping slot 2 changes `inventory.active`, and a minimap tap opens the map.
- Settings reads "57°". framecheck: forced layouts per match frame 0.00.

### L8 AUDIO — audio.js (effort S)
Changes:
- Duck once per engagement: hold while you fired within the last ~0.6 s, about -2 dB, and keep the explosion duck (audio.js:594, :320).
- A VoicePool with cap 24, a frame budget of 4 and steal-lowest-score. Priority: own gun / hitmarker / kill > enemy gun > footsteps > impacts. Keep the pool policy a pure function inside audio.js so it can be tested in Node.
- Unlock audio on touchend as well (audio.js:569-570).
- `readback(W)` exposes the duck count and live voices.

Gates:
- Node: the pool-policy selftest.
- Browser:
  - the same 3.7 s SMG burst gives <= 2 duck ramps (was 30);
  - live sources <= cap in a scripted 10-bot firefight;
  - playtest: exactly 1 report per shot.

### L9 BOOT+NET — index.html, ffg_boot3d.js, vendored three, net (effort M)
Build on the in-flight ?v= bump (keep the tag scheme).

Changes:
- index.html:
  - The head guard `window.__LC_BOOT__ = {handoff, fail, info}` replaces the :56-63 poll (DYEFIELD runtime/index.html:44-296). A terminal card is never overwritten.
  - The status line shows resource-timing bytes and visible seconds, and says "reload" only after a stall verdict (60 s visible + 20 s with no new bytes + an unanswered HEAD).
  - A capture-phase `error` listener for our own scripts and modulepreloads. One auto-retry guarded by sessionStorage. A RELOAD button.
  - :19 and :21 point at `./assets/vendor/three/`.
  - Viewport `viewport-fit=cover`, `100dvh`. The splash bar animates with `transform: scaleX` (index.html:9-11).
- Vendor three r172: copy the 18 files the baseline pulled from jsdelivr out of forgeflow-games/node_modules/three (0.172.0; blackridge's copy has the same md5), listed in boot-robustness G1.
- ffg_boot3d.js:
  - splashFail -> `__LC_BOOT__.fail`.
  - A `hasWebGL2()` card and the sitelock check both run BEFORE the engine import.
  - The catch probes the kernel and three URLs to name the real failure (not always "jsdelivr", :79).
  - content.json is fetched `{cache: "no-cache"}` with an `r.ok` check.
  - LAST step, after mobile.py passes: remove `desktopOnlyCard` (:104-110, :51).
- net.js `enter()` gets try/catch -> "Couldn't reach the online service" with the buttons re-enabled. ffg_netplay.js:41 is pinned to an exact supabase-js version (which version is UNCERTAIN; read the one esm.sh currently resolves).

Gates (headless is enough), bootguard:
- a;
- b1: card within 5 s naming ffg_boot3d.js + HTTP 404, then exactly one auto reload;
- b2: the card names hud.js;
- b3, d, i;
- c slow150: no "reload" text while bytes grow;
- e jsdelivr blocked: `__LC__` appears with 0 jsdelivr resource entries;
- g: WebGL2 card within 2 s, and three is never requested;
- h: card within 1 s;
- m: error text plus enabled buttons within 10 s;
- every terminal message is still on screen at t45.

### L10 TOUCH — touch.js, aimassist.js, the PROFILES line (effort M)
Changes:
- touch.js, a port of dyefield/runtime/src/touch/controls.ts:
  - Pointer Events with pointerId and setPointerCapture;
  - a floating stick (deadzone 0.12) and a look zone at 0.0040 rad/px;
  - FIRE (hold, drag-to-aim), JUMP, RELOAD, USE (hold), ADS toggle, PAUSE, and auto-sprint at full deflection;
  - visible only while a match is playing;
  - writes `W.touch` (C6).
- aimassist.js: the DYEFIELD M3 pure function (slowdown 0.45 x strength within 6°, magnetism <= 22°/s only while firing, visibility via a callback).
- Set `"last-circle": "native"` in pipeline/engine/runtime/game_controls.js:810 and copy the file to games/last-circle/game_controls.js. That fixes the generator, and the md5 stays identical.

Gates:
- Node: aimassist.selftest.cjs. It never acts through walls, never snaps, and does nothing unless firing.
- Browser, mobile.py on SE, iPhone 14, Pixel 7 and iPad with real CDP touch:
  - look drag >= 0.3 rad;
  - holding USE 2 s at a chest opens it;
  - holding the pistol FIRE 2 s fires >= 3 rounds (with L6);
  - no overlay on the menus, and first-tap menu buttons work;
  - the portrait rotate overlay shows (with L7).

### L11 DEPLOY — pipeline/deploy_game.py (effort S; shared; needs the owner's OK)
Changes:
- Upload every other file first, then index.html, then game_meta.json LAST (:230 rglob order puts index.html first today).
- For games without hashed builds, count runtime/**/*.js failures as critical and abort before index.html (:182, :262-265).

Gates (no browser):
- `--dry-run` prints the order for last-circle and dyefield, with index.html last.
- A monkeypatched failure of one runtime file -> non-zero exit, and index.html is not uploaded.

Shared-pipeline note: the next deploy of ANY game is the real test.

---------------------------------------------------------------------------------------------------
## 4. Sequencing

- **Wave 1 (parallel):** L1, L2, L3, L6, L8, L9 (everything except removing the desktop card), L11 (if approved), and L7's P1 desktop items.
- **Wave 2 (parallel, needs L1's gates):** L4 phase A, L5 a-k, L7 touch/phone items, L10.
- **Integration checkpoint 1:** run the full gate list. Re-run framecheck and lc_liveprobe.
- **Wave 3:** L4 phase B + L5 l (fixed tick). Then L9's and L7's "desktop only" card removals, once mobile.py is green.
- **Integration checkpoint 2, then deploy.**

The critical path is L1 -> L5 -> integration, since L5 carries the largest measured win and the most cross-lane contracts.

---------------------------------------------------------------------------------------------------
## 5. INTEGRATION + QA (after all lanes land)

1. Commit one commit per lane to master and push (project rule). The integration stage writes CHANGELOG.md and does the single final ?v= bump in index.html.
2. Node:
   - `node runtime/sim/royale.selftest.cjs`
   - `node runtime/3d/royale/aimassist.selftest.cjs`
   - the audio pool selftest.

   These prove the SIM only.
3. Browser: `python _harness/gate.py --disk`. The server on :8790 is only a fallback, and must never be started or pointed at the repo root. Every gate must exit 0; an exit 2 is re-run, never counted as a pass.
   - bootcheck: 0 errors, 0 failed requests, 0 shader errors, 0 `[rig]` lines.
   - bootguard: all cases.
   - rigcheck: 3 seeds.
   - playtest: drift, 1 report per shot, PLAY AGAIN loop.
   - portalcheck: headed.
   - framecheck: every threshold in L3, L4, L5, L6 and L7.
   - feelcheck, and layoutcheck (desktop + phones).
   - mobile: 4 devices.
   - probe_match: >= 6 seeds, storm on.
   - leaktest: 3 ashgrid.
   - perfcheck: information only.
4. Before/after table, re-run exactly as recorded in live-measure.md:
   - `python -u lc_liveprobe.py --reps 3 --label after`
   - `python lc_liveprobe_table.py "_reports/lc_liveprobe_after_*.json"`, set against `_reports/lc_liveprobe_base_20260930_003158.json`
   - `python -u leaktest.py 3 ashgrid`
   - framepump5/6/7 (tris by pass, programs on drop frame 1, layouts per frame, KB per frame)
   - charprobe5 (drop and ground cluster)

   Report each row as before -> after, with the number of other Chromes on the box during both runs. Milliseconds are information. Counts, triangles, programs, layouts and bytes are exact and are the pass criteria.
5. Deploy: from `C:/Users/TestRun/Claude Claw/forgeflow-games`, run
   `python pipeline/deploy_game.py --game-dir games/last-circle --slug last-circle`, with NO `--status`, so the owner's publish toggle is not touched.
   - Read the portal's `games` row status (GET) before and after, and confirm it is unchanged.
   - If L11 did not land, accept the documented one-time mixed-module window. L9's single auto-retry covers it.
6. Live verify:
   - `https://forgeflow-games-cdn.isimcha85.workers.dev/last-circle/index.html` returns 200 and carries the new ?v= tag.
   - The vendor files return 200.
   - Headless Playwright against the live URL: `__LC__` appears, 0 page errors, 0 failed requests, 0 jsdelivr requests, and a practice `startMatch` reaches W.phase "match" with frames advancing.
   - `portalcheck.py --live` (GET only).
   - If the CDN lags beyond ~5 min, report "deployed, verification pending" with the exact command. Never re-deploy just to hurry verification.

---------------------------------------------------------------------------------------------------
## 6. Acceptance summary: done means these numbers were observed

| metric | before (measured) | after (target) |
|---|---|---|
| drop frame 1 tris / shadow:actors tris | 9.91 M / 8.57 M | < 1.5 M / < 0.5 M |
| ground cluster tris | 32.91 M | <= 2.5 M |
| drop cluster draw calls | 482 | <= 250 |
| new programs on drop frame 1 | 27 | 0 |
| Enter -> drop from the lobby | 4.3-9.2 s median | < 0.5 s |
| forced layouts per drop frame | 1.00 | 0.00 |
| KB allocated per match frame | 554.5 | < 100 |
| lobby textures, matches 1/2/3 | 44 / 86 / 177 | within ±5 |
| SMG rpm at 60 Hz | 600 | 720 ±6 at 20-165 Hz |
| pistol share of gun kills / bot lives ending on the pistol | 60.2% / 74.8% | <= 35% / <= 40% |
| isla_viva stuck share of moving time | 12-27% | < 2% |
| same-seed replay | diverges at ~25 s | identical |
| `[rig]` + binding warnings per load | ~235 | 0 |
| jsdelivr blocked | never boots | boots |
| touch look drag 160 px | dyaw 0 | >= 0.3 rad |

---------------------------------------------------------------------------------------------------
## 7. Uncertain, or the owner's call (flagged)

- **Texture-leak producer: UNKNOWN.** Stage 0's census decides which lane frees what. If it comes out as three-internal (for example composer or shadow RTs recreated per match), it moves to L3 or L4.
- **Fixed tick vs online play: UNVERIFIED.** net.js host/client sync under an accumulator has not been traced. Phase B ships only if a two-client SQUAD UP session still syncs. Otherwise ship only L6's cadence carry and stop.
- **Decimation.** A/B was checked only on soldier and juggernaut (mean |diff| 0.56-1.06/255). athlete, viper and wraith get eyeball close-ups in L2's gate. Juggernaut at 25k instead of 15k is the owner's choice if plate highlights matter.
- **Perf numbers.** The box was saturated: 8-15 other Chromes, rAF starved, and the Intel vsync path could not render. All ms figures are information only. A quiet-box perfcheck run is still owed for real p99 against the 22 ms target.
- **Mobile.** The touch work was checked only on emulated Pixel/SE/iPhone in Chromium. The iOS audio-unlock-on-touchend fix is inferred, not tested on WebKit.
- **game_controls.js.** build_order.py:243-245 copies the canonical file into games at build. Whether Last Circle (hand-built) is ever rebuilt by it is unknown, which is why L10 edits both copies.
- **The concurrent session.** It may commit or keep editing index.html or ffg_kernel_3d.js while L3 and L9 run. Check `git log` before each lane commit, and rebase rather than overwrite.
- **Owner decisions:**
  - (1) Flip `games.mobile_support` to 'partial' after mobile.py passes. This is a registry write with the service key.
  - (2) Replace the "VICTORY ROYALE" wording (hud.js:2989/:3012) with "LAST ONE STANDING"?
  - (3) Match-pacing targets (deaths before 60 s, match length). Gated as information until set.
  - (4) Land L11, the change to the shared deploy_game.py.
  - (5) The exact supabase-js version to pin.
