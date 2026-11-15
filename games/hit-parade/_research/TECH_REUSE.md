# HIT PARADE - TECH REUSE plan

Lane: tech_reuse (2026-09-29). Every file path, number and quote below was read or measured this session.
Sources: `games/dyefield` (v1.2.0, `runtime/src/main.ts:187` `VERSION = 'dyefield-1.2.0'`), `games/blocktooth`,
`pipeline/deploy_game.py`, `pipeline/generate_cover.py`, `pipeline/knowledge/GAME_DOCTRINE.md`, dyefield's
`node_modules/three` (0.186.0), global `@gltf-transform/cli` 4.4.2, the live CDN (read-only GETs).
Lane working files: `_research/tech_reuse/` (test GLBs, renders, JSON). Scripts: `tools/research/tech_*`.

## Outcome in five lines
1. Base HIT PARADE on **dyefield's** stack and shell (Vite root `runtime/`, boot guard, touch/mobile layer, WebAudio
   engine, settings, harness). It is the newer project, and its harness was derived from blocktooth's
   (`dyefield/_harness/common.py:2` "pattern: blocktooth/_harness").
2. Take three generic modules from **blocktooth**: the fixed-step loop with `timeScale` (for hit-stop and slow-mo),
   shader warm-up and the frame profiler. Also take its save/bests pattern and its TV "broadcast" UI structure.
3. **Skinned GLB compression works.** resize -> WebP -> meshopt cut a Mixamo character from 5,494,020 to 554,320 bytes.
   The same clip frame rendered in three 0.186 kept silhouette IoU >= 0.99735 at three clip times, with the same
   69 bones and no page errors. I looked at the renders (section F).
4. For compressed geometry, pick **meshopt, not Draco.** The meshopt decoder is one ES module (29,256 bytes) and it
   compresses animation too. KTX2 cannot be built here because `toktx` is not on PATH.
5. Deploy the **built `dist/`**, and put `thumbnail.png` in `runtime/public/` first. Otherwise
   `deploy_game.py` makes a paid xAI cover call by itself. Use `--status unpublished --no-portal`, then check the
   live URL with the version-fingerprint command. I tested that command against live dyefield today.

---

## (a) Copy verbatim (edits limited to the header comment, plus the one-line exceptions named in rows 6 and 9)

| # | source | destination | why it is safe verbatim |
|---|---|---|---|
| 1 | `games/dyefield/tsconfig.json` | `games/hit-parade/tsconfig.json` | `include` is `runtime/src/**/*.ts`, `_harness/**/*.ts`, `vite.config.ts`: the same layout. Strict, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `resolveJsonModule` |
| 2 | `games/dyefield/runtime/src/core/rng.ts` (55 lines, 0 imports) | `runtime/src/core/rng.ts` | `mulberry32`, `hash32`, `hash01` (CONTRACT §4.2). Only line 1 names DYEFIELD |
| 3 | `games/dyefield/runtime/src/core/glb.ts` (434 lines, 0 imports) | `runtime/src/core/glb.ts` | THREE-free GLB reader for Node probes (arena collision / extras). `artUrl()` resolves `../../../art/gltf/`, which matches the skeleton in (c). Lines 1 and 6 name DYEFIELD in comments only |
| 4 | `games/dyefield/runtime/src/audio/seam.ts` (19 lines) | `runtime/src/audio/seam.ts` | pure loop-seam crossfade, shared by the engine and the probe |
| 5 | `games/dyefield/runtime/src/audio/voices.ts` (70 lines) | `runtime/src/audio/voices.ts` | pure voice-stealing pool (score = priority + level) |
| 6 | `games/blocktooth/src/core/loop.ts` (290 lines) | `runtime/src/app/loop.ts` | `GameLoop` with a fixed accumulator, `MAX_STEPS_PER_FRAME`, the accumulator discarded while `simEnabled=false`, `timeScale` ("scales SIM time only (hit-stop / slow-mo)"), and a 240-frame stats ring. Its only import is `{ MAX_STEPS_PER_FRAME, SIM_DT } from './config.ts'`: change that one path to `'../core/config.ts'`, and the HIT PARADE config must export both names. It moves out of `core/` because its own header says "This file is app-side (it needs rAF + a wall clock)" |
| 7 | `games/blocktooth/src/render/warmup.ts` (70 lines) | `runtime/src/view/warmup.ts` | `warmup(renderer, scene, camera)`: forces everything visible, runs `compileAsync` into a HalfFloat RT, renders once, then does the canvas pass and restores state. Imports only `three` |
| 8 | `games/blocktooth/src/render/frameprof.ts` (232 lines) | `runtime/src/view/frameprof.ts` | `?prof=1` profiler: per-section ms, GPU timer queries, the worst 50 frames. `import type` three only |
| 9 | `games/dyefield/_harness/build_icons.py` (78 lines) | `_harness/build_icons.py` | renders SVG to the four PWA icons in headless Chrome. **Edit only** the `NAVY` and `GLYPHS` constants to the HIT PARADE favicon mark (original art, no spend) |

Do **not** copy `dyefield/dist/`. It is a stale build (Sep 29 01:14) that has neither `icons/` nor `manifest.webmanifest`.

---

## (b) Adapt: the file and the exact edits

Global rename table, applied to every adapted file:
`__DF__`->`__HP__` · `__DF_BOOT__`->`__HP_BOOT__` · `__DF_MAIN__`->`__HP_MAIN__` · CSS ids/classes `df-*`->`hp-*`
(`#df-boot`, `.df-card`, `html.df-touch/df-kbm`, `#df-touch`) · env `DF_FROZEN`->`HP_FROZEN` · storage keys
`dyefield.*`->`hitparade.*` · URL marker `dfretry`->`hpretry` · dev port 5186->**5320**, preview 5187->**5321**,
bootguard dev 5198->**5322**. Ports 5320-5329 had no LISTEN entry in `netstat`, and no vite config in `games/` uses
them. Configs in `games/` use 5178/5179/5186/5187; the dyefield and blocktooth harness scripts reference ports between 5178 and 5294.

| source | destination | exact adaptation list |
|---|---|---|
| `dyefield/vite.config.ts` | `vite.config.ts` | (1) plugin name `'dyefield-harness-endpoints'`->`'hit-parade-harness-endpoints'`; (2) `server.port 5320`, `preview.port 5321`; (3) `process.env.DF_FROZEN`->`process.env.HP_FROZEN`; (4) if Rapier is not used: `optimizeDeps.include: ['three']` and delete the `vendor-rapier` codeSplitting group. Keep all of the rest: `root: runtime/`, `publicDir: runtime/public`, `base: './'`, `fs: { strict: true, allow: [ROOT] }`, no-store headers, `/__shot` + `/__report`, `css.postcss` inline empty, `sourcemap: false`, `vendor-three` group, `target es2022` |
| `dyefield/package.json` | `package.json` | see (c). Same pins; new scripts; drop `art` |
| `dyefield/runtime/index.html` | `runtime/index.html` | Keep the whole boot-guard IIFE (load-failure capture listener, one auto-retry, a watchdog that counts visible time only, the `?bootguard=` scale, `handoff/fail/info`). Edit: the rename table; title/description/theme-color; the `RK` key `'hitparade.bootRetry'`; every "DYEFIELD could not load/start" string and the dev hint; the `mode()` deep-link key list (`map, kit, bots, seed, matchSeconds, preset, autostart, brush, crew, mode`)->the HIT PARADE deep links (`episode, round, seed, roundSeconds, fighter, autostart, dev`); replace the mode-line logic with the show name. Restyle the critical boot card and inline favicon to the HIT PARADE look. Keep the M5/M9 meta tags and the manifest link |
| `dyefield/runtime/public/manifest.webmanifest` | `runtime/public/manifest.webmanifest` | name/short_name/description/colors only. Keep `display fullscreen`, `orientation landscape`, `start_url ./index.html`, `scope ./` and the three icons. No service worker (CONTRACT_MOBILE M9) |
| `dyefield/runtime/public/game_meta.json` (+ blocktooth's) | `runtime/public/game_meta.json` | keys that ship today: `title, short_description, description, genre, sub_genre, difficulty, controls_keyboard, tags, art_direction` (+ optional `controls_gamepad`, which `deploy_game.py` reads). **No `status` key** (deploy ignores it). Copy must never claim a mode the code lacks (doctrine §6) |
| `dyefield/runtime/src/ui/boot.ts` (409) | `runtime/src/ui/boot.ts` | keep `BootUI` cards (loading / play / blocked / error), `RotateOverlay`, `Fullscreen`, `homeScreenTip`, `installPageHygiene`, `watchTouchMode`. Replace `MODE_LINE*` with the show's strap line, `HOME_TIP` text, `HOME_TIP_KEY`, the rename table. Keep the "mouse capture blocked after 2+ pointerlockerrors with zero locks" behaviour |
| `dyefield/runtime/src/input.ts` (310) | `runtime/src/input.ts` | keep the mode detection (`?touch=1\|0` pins it), hybrid switching, per-tick latches, the `TouchState` merge and `takeTouchLook()`. Replace the `Action` union: `moveF/B/L/R, jump, fire, slick, sub, special, pause, debug, map` -> `moveF/B/L/R, light, heavy, grab, dodge, block, special (finisher), taunt, lockon, pause, debug`. New `DEFAULT_BINDINGS` (e.g. LMB light, RMB heavy, E grab, SPACE dodge, SHIFT block, Q finisher, F taunt, MMB/Tab lock-on). **Add gamepad polling** from `blocktooth/src/core/input.ts` (the Gamepad API is there; dyefield has gamepad in menus only, `getGamepads` appears only in `ui/menus.ts`) |
| `dyefield/runtime/src/touch/controls.ts` + `touch.css` | `runtime/src/touch/` | keep the Pointer-Events engine (floating stick, look zone, `setPointerCapture`, multi-touch, safe-area, 44 px floor, haptics). Replace the button set FIRE/JUMP/SLICK/SUB/SPECIAL with LIGHT (big thumb button) / HEAVY / GRAB / DODGE / FINISHER (charge ring = ratings meter) + PAUSE. `setKit()`->drop; `setMeters({finisherFrac, finisherReady, grabReady})`; the `WEAPONS` import -> none |
| `dyefield/runtime/src/touch/aimassist.ts` (94) | `runtime/src/touch/aimassist.ts` | pure function; retune for melee: `range` = the lock-on radius, a wider cone (8 deg -> ~25 deg). The "firing" gate becomes "attack pressed". Keep "never snaps, never through walls" |
| `dyefield/runtime/src/ui/settings.ts` (260) | `runtime/src/ui/settings.ts` | keep `SettingsStore` (localStorage in try/catch, field-by-field sanitize, `on()` change events, the M8 touch fields). Drop `ProfileStore` crew/kit/map/botSkill. Add `gore: 'splatter' \| 'sparks' \| 'confetti'` (the BRIEF's settings toggle), `screenShake`, `reduceFlashing` (from blocktooth `Settings`), `hitStopScale`, `camDistance`. Drop the imports of `core/match/roster.ts` and `TeamId` |
| `blocktooth/src/core/save.ts` (219) | `runtime/src/ui/save.ts` | pattern: `DEFAULT_SETTINGS` frozen, versioned keys (`blocktooth.settings.v1`), every storage touch in try/catch, `loadBest/saveBest`. Replace with HIT PARADE `SeasonSave { episodeUnlocked, upgrades, cash, bestRatings[ep], bestScore[ep], seen }`, key `hitparade.season.v1`, sanitized per field |
| `dyefield/runtime/src/ui/menus.ts` (1698) + `menus.css` | `runtime/src/ui/menus.ts` | keep the machinery: `[data-nav]` spatial focus (arrows / d-pad / stick), Enter/Space/pad A, Esc/pad B back, hover-moves-focus for mouse only, the key-remap capture that suspends `Input`, the FULLSCREEN toggle, the touch variants, and the `@media (max-height: 500px)` phone layout. Replace the screens `title\|loadout\|play\|settings\|howto\|credits\|pause` -> `title\|season (episode select)\|upgrades (locker)\|settings\|howto\|credits\|pause`. All copy is new. Assign `screenBefore` on every navigation (doctrine §6) |
| `blocktooth/src/ui/broadcast.ts` (762) | `runtime/src/ui/broadcast.ts` | **the TV-show frame pattern**: freeze-frame `openSlate` with a LIVE bug + lower third, `sizeUp`-style full-width banner sweep, a queued/deduped `alert` strap system, a print-style end page (`tabloid`) -> HIT PARADE: episode open slate, "RATINGS SPIKE" / host caption straps, results = ratings sheet. Keep the epoch guard ("Deferred work is guarded by an epoch (doctrine §4)"). All strings go to `data/strings.json` (blocktooth §12: `data/strings.ts` "holds ALL copy") |
| `dyefield/runtime/src/ui/hud.ts` + `slates.ts` + `juice.ts` | `runtime/src/ui/hud.ts`, `juice.ts` | juice keeps its surface (`onEvents`, `update`, `trauma`, hit markers, a damage vignette with a direction arc, `setReduceMotion`). The HUD is new (show bug top-left, SCORE comic frame top-right, portrait + HP + finisher bars bottom-left, ROUND + timer bottom-right). Reuse the M6 rule "HUD blocks reserve the touch zones" |
| `dyefield/runtime/src/view/renderer.ts` (500) | `runtime/src/view/renderer.ts` | keep: WebGL2 check, DPR cap `min(1.5, DPR)`, the adaptive governor (p90 windows, hysteresis, deep floor), Neutral tone mapping, sRGB, `PCFShadowMap`, `info.autoReset=false`, front-to-back opaque sort, the touch profile (antialias off at DPR >= 2, shadow 1024/512). Add: the EffectComposer path (see (F) and gotcha E36) |
| `dyefield/runtime/src/view/camera.ts` (187) | `runtime/src/view/camera.ts` | keep the spring/trauma/reduce-motion structure. New rig: close over-shoulder (fighters ~60% of frame height per BRIEF), orbit-to-frame the exchange, punch-in on heavy hits, finisher cams. Replace `CAMERA` from `core/config.ts` |
| `dyefield/runtime/src/audio/{engine,index,router,types,manifest}.ts` + `build/build_audio.py` + `CREDITS.json` | `runtime/src/audio/` | engine: keep the buses, panners, voice pool, loops, music sequencer, ducking, Ogg + AAC twin fallback, low-priority lazy `preload()`, limiter meter, `stats()`. router: rewrite `EVENT_SOUNDS` for HIT PARADE `SimEvent`s (hits by weight, wall splat, slam, stomp, finisher, crowd cheer/boo/gasp, host sting, round horn). Keep "typecheck forces every `SimEvent` type into it". Add a crowd bed whose intensity follows the ratings meter. `build_audio.py`: new source list + cues; it regenerates `manifest.ts`/`CREDITS.json` (never hand-edit, per its header). Registering music for the slug uses `state/music_assignments.json` (the header names it). That is a state file, so it belongs to the audio lane and the owner |
| `dyefield/runtime/src/main.ts` + `game.ts` + `testsurface.ts` | same names | keep: boot order (params -> WebGL2 check -> loading card -> shared loads -> arena -> session -> warm-up), the error card on any failure, `__PAUSE__` install/remove (game.ts:445), pointer-lock flow, touch flow (TAP TO PLAY, fullscreen + orientation lock, back trap `armBackTrap`, blur/pagehide pause, rotate overlay pause, the ~60 fps cap on high-Hz screens), `webglcontextlost` card (main.ts:689), one `GameAudio` per page, `VERSION = 'hit-parade-<semver>'` (the live fingerprint). `testsurface.ts` -> `window.__HP__ = { version, state(), shot(name), events(n), perf(), audio(), touch(), dev: {teleport, spawn, god, setRatings, setTimeLeft, freeze, step} }`, where dev functions throw unless `?dev=1` (dyefield testsurface.ts:282) |
| `dyefield/_harness/common.py` (1065) | `_harness/common.py` | edit: `PORT = 5320`; `ensure_server` env `HP_FROZEN="1"` (common.py:379) + log text; every `__DF__` -> `__HP__` (14 hits); `wait_phase` phases; replace `CAM_SENSITIVITY`, `match_info`, `hud_info`, `aim_info`, `wait_alive`, `wait_match_phase` with HIT PARADE readers. Keep unchanged: `FLAGS` (d3d11, occlusion off, no background throttling), `INIT_JS` (error capture, harness rAF counter, pointer-lock loss log), `lock_loss_cause`, `ForegroundWatch`, `preflight_chromes`, `automated_chromes`, `save_report`, `Session`, `GpuShare`, `wait_warm`, `mouse_turn` |
| `dyefield/_harness/bootcheck.py` (480) | `_harness/bootcheck.py` | keep: the flow shape, focus-theft tolerance, the verdict rules ("BOOTS CLEAN": 0 console/page/shader errors, 0 failed requests, frames + ticks advancing), exit codes 0/1/2, and the non-local-base `/__shot` skip (bootcheck.py:387). New steps: `/?episode=1&dev=1` -> ready -> a REAL click (pointer lock) -> play -> round countdown -> a REAL `W` hold 1.5 s moves > 3 m -> a REAL LMB x3 combo on the nearest thug lands >= 1 `hit` event (enemy HP falls, SCORE > 0, the ratings meter rises) -> shots |
| `dyefield/_harness/bootguard.py` (622) | `_harness/bootguard.py` | `PREFIX = "/hit-parade/"` (line 65); `__DF_MAIN__` setter trap -> `__HP_MAIN__`; `'dyefield.bootRetry'` -> `'hitparade.bootRetry'` (line 348); `dfretry` -> `hpretry`; `--dev-base` default `http://localhost:5322/`; the modulepreload case b2 targets `vendor-three` if Rapier is dropped; card titles "HIT PARADE could not load/start", "did not start". Cases a, b1-b4, c, d, f, e1-e3 all carry over |
| `dyefield/_harness/playtest.py` (1185) | `_harness/playtest.py` | same real-input philosophy ("the camera is turned by real pointer-lock mouse motion, never by writing its yaw"). New flow: a full round by real keys and mouse: combos, a grab + throw, a wall splat, a knockdown + stomp, a finisher when the meter is full, round clear, the ratings/results screen with numbers equal to the sim's, NEXT / RETRY. Keep the AUDIO assertions block (context running, music cue, >= 1 world SFX, 0 decode errors, the clipping check) and page-side frame timing |
| `dyefield/_harness/perfcheck.py` (378) | `_harness/perfcheck.py` | keep: refusal while another automated Chrome is alive (exit 3), `--wait-clear`, page-side rAF recorder, p50/p90/p99/max, draws/tris, exit codes 0/1/2/3/4. New windows: `stand` / `brawl` (REAL keys into a crowd of 6-8 enemies + audience impostors) / `finisher` (camera cut + FX burst) |
| `dyefield/_harness/abperf.py` (452) | `_harness/abperf.py` | keep the interleaved A/B method (blocks of 8 frames, GPU time via `EXT_disjoint_timer_query_webgl2`, 25th percentile). Replace the variants (surfaces/dye knobs) with post-FX knobs (`nopost`, `nosmaa`, `nooutline`, `crowd=0`) and the bench pose |
| `dyefield/_harness/mobile.py` (1953) | `_harness/mobile.py` | keep: device emulation contexts (M0), CDP `Input.dispatchTouchEvent` multi-touch, the safe-area override, the iPhone no-fullscreen emulation, the hygiene checks (pinch, long-press, contextmenu), install checks, per-device error gate, the informational perf block. Replace the match checks with: stick moves >= 3 m, look drag >= 0.3 rad, LIGHT held/tapped lands hits, DODGE, GRAB, FINISHER when charged, PAUSE -> card -> RESUME, blur/pagehide pause, portrait overlay |
| `dyefield/_harness/menus.py` (982) | `_harness/menus.py` | keep: the real-click/real-key walk, the synthetic gamepad (replaced `navigator.getGamepads`), the leak check (`renderer.info` after each return), the 1600x900 + 1280x720 layout checks. New screen list |
| `dyefield/_harness/layoutcheck.py` (686) | `_harness/layoutcheck.py` | keep `DEVICES`, `LAYOUT_JS`, `check_page()` (clip / overlap / 44 px targets / font floors / page never scrolls / wordmark uncovered / HUD vs touch zones as circles). New `steps` list |
| `dyefield/_harness/lookshots.py` (324) | `_harness/lookshots.py` | G5 inputs: episode open slate, close cam mid-combo, wall splat frame, finisher frame, each arena set, the results screen (real input for every action; dev teleport only for stations) |
| `dyefield/_spec/CONTRACT.md` §0/§2/§6/§7/§8 + `CONTRACT_MOBILE.md` M0-M12 | `_spec/CONTRACT.md`, `_spec/CONTRACT_MOBILE.md` | keep §0 ground rules word for word (own your files, THREE-free core, erasable TS, no `Math.random` in core, no primitive hero assets, real-input verification, utf-8, never `claude -p`, one headed Chrome for perf numbers), the §2 axis/yaw conventions, and the gate-table format. Replace the gate contents (see (c)). The mobile contract carries over nearly whole: button names and the aim-assist numbers change |

Rapier (`@dimforge/rapier3d-compat 0.20.0`): I recommend **omitting it** at first. A brawler on authored flat sets
can collide in the THREE-free sim with capsule-vs-segment walls/props (XZ plane + floor height). That keeps knockback
and wall splats deterministic in Node probes, and it removes the measured 2,851,770-byte `vendor-rapier-*.js` chunk
(the same size in both games' `dist/assets`). If multi-level sets need a character controller, add it back at the
same pin.

---

## (c) Proposed project skeleton

### package.json (versions pinned to dyefield's; fonts from blocktooth's pins)
```json
{
  "name": "hit-parade",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "HIT PARADE - a close-camera 3D beat 'em up framed as a live TV death-show. Three.js + TypeScript + Vite. `npm install && npm run dev`.",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "probe": "node _harness/probe_data.ts && node _harness/probe_combat.ts && node _harness/probe_ai.ts && node _harness/probe_show.ts && node _harness/probe_episode.ts --seeds 1,2,3",
    "check": "npm run typecheck && npm run probe",
    "assets": "python tools/build_assets.py all"
  },
  "dependencies": {
    "@fontsource/anton": "^5.3.0",
    "@fontsource/barlow-condensed": "^5.3.0",
    "three": "0.186.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/three": "0.186.0",
    "typescript": "7.0.2",
    "vite": "8.3.0"
  }
}
```
Toolchain measured in `games/dyefield`: `node v22.20.0`, `tsc Version 7.0.2`, `vite/8.3.0`, Python
`playwright 1.58.0`. Probes run as `node _harness/probe_x.ts` (dyefield's `probe` script does exactly this, with no
flag). A comic display face (splash words) is optional and would be a new dependency. Pin it at install time,
because neither project has one.

### vite.config.ts
dyefield's file with the four edits in (b). The result: dev `http://localhost:5320` (strictPort), preview 5321,
`HP_FROZEN=1` = no HMR/watch.

### tsconfig.json
Verbatim from dyefield ((a) #1).

### Directory layout
```
games/hit-parade/
  README.md  package.json  package-lock.json  tsconfig.json  vite.config.ts
  _spec/      BRIEF.md CONTRACT.md DESIGN.md CONTRACT_MOBILE.md
  _research/  (lane outputs; never inside dist/, see the note below)
  data/       fighters.json moves.json (frame data: startup/active/recovery ticks, hitstop, knockback, clip names)
              enemies.json bosses.json episodes.json (sets, waves, timers) upgrades.json show.json (ratings rules,
              multipliers, host caption pools) strings.json (ALL copy)
  art/        blender/*.py (headless sources, committed) · src/ (FBX/Blender inputs, or pointers to F:\) ·
              gltf/*.glb (COMPRESSED outputs, committed; loaded via new URL('../../../art/gltf/x.glb', import.meta.url))
              renders/ (QA PNGs, gitignored)
  tools/      build_assets.py compress_glb.py (the gltf-transform chain in section F) research/  (dev-only)
  runtime/    Vite root
    index.html                boot guard (adapted)
    public/                   game_meta.json thumbnail.png manifest.webmanifest icons/  (copied verbatim into dist/)
    src/
      main.ts game.ts input.ts testsurface.ts
      app/loop.ts             blocktooth GameLoop (rAF + wall clock; NOT core)
      core/                   THREE-free, DOM-free, deterministic, runs under plain node
        types.ts config.ts (SIM_DT = 1/60, MAX_STEPS_PER_FRAME = 5) data.ts (JSON via `with { type: 'json' }`)
        rng.ts glb.ts
        sim/  world.ts fighter.ts moves.ts hits.ts (hitboxes, sim-side hitstop ticks, knockback, wall/floor
              impacts) grabs.ts props.ts arena.ts (collision) events.ts
        ai/   director.ts (attack tokens <= 2) brains.ts bosses/*.ts
        show/ score.ts ratings.ts episode.ts (rounds, timer, results)
      view/   renderer.ts post.ts (composer) camera.ts fighters.ts (skinned GLB, AnimationMixer, clip map by NAME)
              fx.ts (splatter/sparks/confetti per setting, speed lines, smears) arena.ts crowd.ts (baked impostors)
              warmup.ts frameprof.ts
      ui/     boot.ts hud.ts broadcast.ts juice.ts menus.ts menus.css settings.ts save.ts results.ts icons.ts styles.css
      audio/  index.ts engine.ts router.ts types.ts manifest.ts(gen) seam.ts voices.ts CREDITS.json(gen)
              assets/*.ogg + *.m4a(gen) build/build_audio.py
      touch/  controls.ts touch.css aimassist.ts
  _harness/   common.py bootcheck.py bootguard.py playtest.py perfcheck.py abperf.py mobile.py menus.py
              layoutcheck.py lookshots.py build_icons.py probe_*.ts   _reports/ (gitignored)
  _shots/     (gitignored)
  dist/       (gitignored; the ONLY thing deployed)
```
Note on `_research/`: `deploy_game.py` `DEV_ONLY_DIRS` does not list `_research`. That does not matter, because
the deploy source is `dist/` and `_research/` is never inside it. Never deploy the game root.

Git: the parent `forgeflow-games/.gitignore` already ignores `node_modules/` and `dist/` globally (lines 1-2).
Add a block like dyefield's (lines 72-83) for `games/hit-parade/_shots/`, `_harness/_reports/`,
`_harness/__pycache__/`, `art/renders/*.png`, and `games/hit-parade/_research/**/*.glb` (this lane left test GLBs of
up to 5.5 MB in `_research/tech_reuse/`). I did not edit `.gitignore` (outside this lane).

### Gates (the dyefield G-table format, HIT PARADE content)
| gate | command | pass |
|---|---|---|
| G0 types | `npm run typecheck` | 0 errors |
| G1 data | `node _harness/probe_data.ts` | every move -> an existing clip name in its GLB, every episode -> existing enemies/boss/set, every string key resolves (doctrine §4 "Referential integrity is a gate") |
| G2 combat | `node _harness/probe_combat.ts` | frame data as authored; hitstop ticks; knockback distances; wall splat triggers on a wall within range and not through it; stomp only on downed; the same seed gives the same hash twice |
| G3 AI + episode | `node _harness/probe_ai.ts && node _harness/probe_episode.ts` | <= 2 attack tokens; reaction delay 300-800 ms (doctrine PROMPT CORE 4); a scripted player clears ep 1 in the target window and loses some seeds |
| G4 boot | `python _harness/bootcheck.py --headless` | BOOTS CLEAN + real-input combo lands |
| G5 look | `python _harness/lookshots.py` + a Read of every PNG | vision review |
| G6 play | `python _harness/playtest.py` | full round by real input, results = sim |
| G7 shell | `python _harness/menus.py && python _harness/bootguard.py` | MENUS OK, all bootguard cases |
| G8 mobile | `python _harness/mobile.py --headless && python _harness/layoutcheck.py --headless` | PASS |
| G9 perf | `python _harness/perfcheck.py --headless` (ALONE) | p99 budget met; the report says "Intel UHD iGPU" |

---

## (d) Deploy + verify command sequence
Run from `C:/Users/TestRun/Claude Claw/forgeflow-games` unless noted. CDN = `https://forgeflow-games-cdn.isimcha85.workers.dev`.
Measured today: `CDN/hit-parade/index.html` -> **404**, so the slug is free on the CDN (I did not query the registry).

```bash
# 0. install + gates (in games/hit-parade)
npm install
npm run check                                   # G0-G3
npm run build                                   # -> dist/ (base './', no .map files)
python _harness/bootcheck.py --headless         # auto-starts vite :5320 with HP_FROZEN=1 if down
python _harness/playtest.py --headless
python _harness/menus.py
python _harness/bootguard.py                    # builds into a TEMP dir, serves it under /hit-parade/
python _harness/mobile.py --headless && python _harness/layoutcheck.py --headless
python _harness/perfcheck.py --headless         # alone; exits 3 if another automated Chrome is alive

# 1. cover (owner standing rule: xAI key art; ~$0.02 per call per generate_cover.py docstring).
#    --out is a DIRECTORY: the code writes <out>/thumbnail.png (the docstring example "--out path/to/save.png" is wrong).
python pipeline/generate_cover.py --slug hit-parade --title "HIT PARADE" \
  --description "<premise; say it is character-driven: the template bans human figures unless the game is>" \
  --art "<art direction>" --out games/hit-parade/runtime/public
#    Read the PNG, then rebuild so dist/ carries it:
(cd games/hit-parade && npm run build)
ls games/hit-parade/dist/thumbnail.png games/hit-parade/dist/game_meta.json   # BOTH must exist (see E54)

# 2. dry run, then deploy (status explicit; a NEW slug lands 'unpublished' anyway; publishing = owner's toggle)
python pipeline/deploy_game.py --game-dir games/hit-parade/dist --slug hit-parade --dry-run
python pipeline/deploy_game.py --game-dir games/hit-parade/dist --slug hit-parade --status unpublished --no-portal

# 3. verify the LIVE effect (not the exit code)
B=https://forgeflow-games-cdn.isimcha85.workers.dev/hit-parade
curl -s -o /dev/null -w "index %{http_code}\n" "$B/index.html"          # expect 200
curl -s -D - -o /dev/null "$B/index.html" | grep -i cache-control        # expect no-store (measured on dyefield)
JS=$(curl -s "$B/index.html" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s --compressed "$B/$JS" | grep -o "hit-parade-[0-9.]*" | head -1  # expect the new VERSION
curl -s -o /dev/null -w "meta %{http_code}\n" "$B/game_meta.json"; curl -s -o /dev/null -w "thumb %{http_code}\n" "$B/thumbnail.png"
(cd games/hit-parade && python _harness/bootguard.py --base "$B/index.html")         # client-side faults only; the CDN sees plain GETs
(cd games/hit-parade && python _harness/bootcheck.py --headless --base "$B/")        # /__shot skipped for non-local bases
(cd games/hit-parade && python _harness/playtest.py --headless --base "$B/")         # one real bout on production (doctrine §5)
# 4. after the OWNER publishes: verify mouse-look ON forgeflowgames.com (portal iframe), not only the CDN URL (doctrine §6),
#    and run python pipeline/deploy_portal.py so the prerendered /games/hit-parade page exists.
```
I tested the fingerprint pipeline in step 3 against live dyefield: it printed `assets/index-FbOklSHM.js`, then `dyefield-1.2.0`.
Redeploys: repeat build + step 2 + step 3. Hashed `assets/*` bust themselves. The stable-named `public/` files
(game_meta.json, thumbnail.png, manifest, icons) are served `max-age=86400` (measured), so without a purge token
they stay stale for up to a day.

---

## (e) Gotchas the two projects (and the doctrine behind them) already paid for, applied here
Each item: the rule, then its source and a quote.

**Build / config**
- E1 Isolate PostCSS. `dyefield/vite.config.ts`: "css.postcss is inline + empty: isolates the game from forgeflow-games/postcss.config.js". blocktooth: otherwise the portal's Tailwind "would otherwise run over this game's stylesheet".
- E2 No-store on dev. `vite.config.ts`: "no-store headers so every reload re-fetches every ES module (doctrine §6: \"ES modules cache hard\")".
- E3 Freeze the dev server while agents edit. `dyefield/vite.config.ts`: "DF_FROZEN=1 (harness runs while other agents edit): no HMR and no file watching". Memory `project_blocktooth.md`: "Parallel agents + Vite HMR bounced each other's test pages to the title".
- E4 Never ship sourcemaps. `vite.config.ts`: "never ship .map files (they embed the full TS source) to the public CDN".
- E5 `base: './'`. `vite.config.ts`: "so a built dist/ can be hosted from any sub-path (portal / CDN folder)".
- E6 `fs.allow: [ROOT]`, because `data/` and `art/` sit beside `runtime/` (vite.config.ts header).
- E7 Erasable TS only. `dyefield/_spec/CONTRACT.md` §0: "`erasableSyntaxOnly` (no `enum`, `namespace` or parameter properties); relative imports **with `.ts` extensions**; JSON via `import x from '…json' with { type: 'json' }`".
- E8 `node --check` is not a gate. `blocktooth/_spec/CONTRACT.md` §0.4: "**`node --check` is NOT a gate** (it passes broken ESM)". Gate with a real `import()`.
- E9 Core purity. `dyefield CONTRACT` §0: "`runtime/src/core/**` never imports `three` and never touches the DOM"; "no `Math.random()` in `core/`".
- E10 Big vendor chunks are normal. blocktooth `vite.config.ts`: "Rapier's compat build inlines its WASM (~2 MB of base64)". Measured 2,851,770 bytes.

**Boot / shell (portal contracts, GAME_DOCTRINE §4-§6)**
- E11 Boot guard as a classic script at the end of `<head>`. `dyefield/runtime/index.html`: "A <script>/<link> load error does not bubble, so a CAPTURE-phase window 'error' listener hears it". Exactly one auto-retry is guarded by sessionStorage.
- E12 Never a blank canvas. `main.ts`: "Any failure lands on the error card with the message (never a blank canvas)."
- E13 Pause gates the step, and the accumulator is discarded. Doctrine §5: "A pause that only the rAF path respects cannot be tested — gate the step function itself, and discard the accumulator during pause". `blocktooth loop.ts` does both.
- E14 `window.__PAUSE__ = { pause, resume, toggle }`; ESC pauses and never destroys; forfeit goes through the verdict path (doctrine §6: "ESC must NEVER destroy a bout silently").
- E15 Assign `screenBefore` on navigation (doctrine §6: "Settings→Back stranded players in the wrong screen for months").
- E16 Gate hotkeys during bouts (doctrine §6: "Tab opened the armoury over a running fight; clicks fired attacks").
- E17 Pointer lock inside the portal needs the iframe's `allow-pointer-lock` + `allow-same-origin`. Same-origin dev never catches it, so verify on the portal. After 2+ `pointerlockerror`s with zero locks show "MOUSE CAPTURE BLOCKED — reload the page" (doctrine §6; `dyefield/ui/boot.ts` header implements it).
- E18 Epoch-guard every deferred callback. Doctrine §4: "An unguarded `setTimeout(endMatch, 3200)` from a finished bout nulled the NEXT match". `blocktooth/ui/broadcast.ts`: "Deferred work is guarded by an epoch".
- E19 Storage can throw on the property read. `blocktooth/src/core/save.ts`: "sandboxed iframes (the portal), private windows, disabled storage and quota errors all throw — sometimes on the mere `window.localStorage` property read".
- E20 Handle WebGL context loss. CONTRACT_MOBILE M4: preventDefault, pause, "Graphics were reset by the device — RELOAD".

**Input / mobile**
- E21 Latch presses per tick. `dyefield/input.ts`: "Presses are LATCHED until the next tick consumes them, so a tap shorter than one tick ... still jumps". This is critical for fast combo inputs; doctrine PROMPT CORE 3 also wants "Buffer inputs 0.35 s".
- E22 Input mode lives on `<html>`, never on the UA. M1: "all CSS keys off that class, never off a user-agent test"; `?touch=1|0` pins it for harnesses.
- E23 No pointer lock in touch mode; START/TAP TO PLAY is the fullscreen + orientation gesture, and failures are silent (M4).
- E24 Android system BACK pauses. `game.ts` A-A6: "every play entry by touch pushes one same-document history entry (the \"back trap\")".
- E25 iOS audio. M4: "iOS only resumes an AudioContext inside touchend or click". `audio/README.md`: "iOS / iPadOS Safari before 18.4 cannot decode Ogg" -> ship AAC twins.
- E26 Page hygiene (M5): `touch-action: none` on the canvas, iOS `gesture*` prevented, `overscroll-behavior: none`, `100dvh`.
- E27 Cap at ~60 fps on 90/120/144 Hz phones. `game.ts` A-A10: "the extra frames were heat and battery".
- E28 No service worker. M9: "Deploys are no-store and hash-named, and a service worker cache would serve stale builds."
- E29 A title card can cover the wordmark. M6: "That overlap was a defect in 1.1.0 and 1.2.0". The layout gate checks it.

**Rendering / perf**
- E30 Chrome here renders on the Intel iGPU whatever you ask. `renderer.ts`: "Chrome does NOT honour it on Windows — 'default', 'low-power' and 'high-performance' WebGL2 contexts all report the Intel UHD". Perf numbers are iGPU numbers.
- E31 Change render scale rarely. `renderer.ts`: "that reallocation measured 257–383 ms in one frame. A governor that reacts to every noisy window pays that hitch over and over".
- E32 r186 has no soft PCF enum. `renderer.ts`: "three r186 removed PCFSoftShadowMap (it warns and falls back); PCFShadowMap is the soft PCF path".
- E33 Neutral, not AgX. Memory `project_dyefield.md`: "AgX turned the toy palette tan/grey (measured)". `renderer.ts` records "CHANGED(integrator) from AgX".
- E34 Warm-up into a HalfFloat RT first, then the canvas. `blocktooth/render/warmup.ts`: "Programs are keyed per render-target variant". Memory `reference_threejs_warmup_colorspace.md`: "The real killer: the program cacheKey includes the OUTPUT COLOUR SPACE". With a composer (HalfFloat RT) this matters directly.
- E35 Honest counters. Doctrine §3: "`renderer.info.autoReset = false` + reset per FRAME, or with any composer the numbers describe the last pass only (this hid ~2× of real cost)".
- E36 A composer silently drops MSAA. `EffectComposer.js:69` creates its target as `new WebGLRenderTarget(..., { type: HalfFloatType })` with no `samples` (grep for `samples` in EffectComposer.js / RenderPass.js: 0 hits). So `antialias: true` no longer applies. Use `SMAAPass` (its doc: it "operates in `linear-srgb` so this pass must be executed before OutputPass") or pass your own RT with `samples`.
- E37 Fixed light pools. Doctrine §3: "Visible-light COUNT is a shader-permutation key ... never add/remove at runtime". blocktooth §0.7: "never add/remove THREE lights after first render".
- E38 Skinned meshes: `frustumCulled = false` (doctrine §3: "bind-pose bounds lie"). The test page does this.
- E39 Front-to-back opaque sort. `renderer.ts`: "4–8 % less GPU time per frame on all three maps".
- E40 Perf only on a quiet machine, or interleaved A/B. `perfcheck.py` refuses "while another automated Chrome is alive". `abperf.py`: "absolute frame times drift by 2–3× within minutes".
- E41 An occluded or hidden window pauses rAF. `common.py`: "A hidden / occluded window pauses requestAnimationFrame, which makes a healthy game look frozen". Use headed + `--disable-features=CalculateNativeWinOcclusion`, or headless with the same d3d11 flags.
- E42 Crowds are impostors (doctrine §3: "bake the real character into an atlas ... UNLIT material"). BRIEF: cartoon crowds, never pills.
- E43 Never gate boot on a fat asset (doctrine §3). Audio waits for the first arena (`audio/README.md` A-A11: "nothing is fetched at `createAudio`; call `audio.preload()` once the first arena is up").

**Assets / GLB pipeline (measured in section F)**
- E44 resize -> WebP -> meshopt keeps skinning intact (numbers in F).
- E45 meshopt **duplicates the skin**: the file goes from 1 skin to 2 (69 joints each). three then builds `skeletons 2`, `bonesShared True`. Key any code by bone NAME, never by `mesh.skeleton` identity.
- E46 A Mixamo FBX -> Blender -> GLB export carries the character's own T-pose action. The exported `animations[0]` was `Armature|mixamo.com|Layer0` (207 channels, 0.067 s) ahead of `clip`. Select clips by name; doctrine §1: "PURGE all other actions before export or they ship in the GLB and `animations[0]` plays the wrong clip."
- E47 Mixamo FBX also exported unused `TEXCOORD_1`/`TEXCOORD_2` and `KHR_materials_specular`. `optimize` pruned the UV sets (section F).
- E48 Prefer meshopt to Draco. Draco needs `libs/draco/gltf/*` hosted (`draco_decoder.wasm` 192,420 + `draco_wasm_wrapper.js` 58,456 bytes) behind `setDecoderPath`. gltf-transform's own help says "Draco compresses geometry; Meshopt and quantization compress geometry and animation". Sizes were within 2% (below).
- E49 KTX2/Basis cannot be authored here: `which toktx` -> not found. The `etc1s`/`uastc` commands and `--texture-compress ktx2` need it.
- E50 The CDN does not compress GLB: a request with `Accept-Encoding: gzip, br` returned `Content-Length: 65008` and no `Content-Encoding` (the JS entry did get `Content-Encoding: br`). The on-disk GLB size is the download size.
- E51 Blender logs vanish under the Python wrapper. Memory `project_dyefield.md`: "The machine's usercustomize console silencer swallows Blender stdout under `python art/build.py` ... run blender.exe directly for logs."
- E52 Axes. `dyefield CONTRACT` §2: "**author forward as Blender −Y**, and it arrives as glTF/three **+Z**"; yaw 0 faces +Z.
- E53 If any Meshy body is used: repair materials at load and never pose against the bind pose (doctrine §1: "The bind pose is degenerate. Never render, measure, or pose against it.").

**Deploy**
- E54 A missing thumbnail triggers a paid cover. `deploy_game.py` `deploy_one`: "Cover: keep an existing thumbnail.png; otherwise try to generate one (xAI)." -> `generate_cover(...)`. `dist/thumbnail.png` must exist before deploy.
- E55 Deploy `dist/`, never the source dir. Memory `project_blocktooth.md`: "deploy the BUILT dist/, never the source dir".
- E56 Publish state is not the file's. `deploy_game.py`: "The file is ignored now; --status is the deliberate path"; "a brand-new game lands as 'unpublished' for the owner to publish manually". Two stale records contradict the code: the module docstring ("3. Set status to 'published'") and memory `project_games_publish_toggle.md` ("sets `status='published'` on EVERY deploy"). The code as read today preserves status.
- E57 `generate_cover.py --out` is a directory and writes `thumbnail.png` in it. Memory `reference_forgeflow_games_deploy.md`: generating "menu art" with `--out games/<slug>` "CLOBBERS the catalog card".
- E58 Cache (measured on dyefield): `index.html` and `assets/index-*.js` -> `Cache-Control: no-store, no-cache, must-revalidate, private`; `game_meta.json`, `thumbnail.png`, `.glb`, `.ogg` -> `public, max-age=86400`. Purging needs a separate token (`deploy_game.py`: "the R2-Edit deploy token can't purge"). Never hand-edit a hashed asset in place (memory `reference_hashed_asset_cache_bust.md`: "the Cloudflare edge cache (and browsers) keep serving the OLD content under that URL for up to 24h").
- E59 `verify_live()` defaults to checking `content.json`, which these games do not ship: `dyefield/content.json` -> 404 (measured). A 404 there is not a failure.
- E60 A missing key on the CDN returned **404** today (`dyefield/no_such_file_xyz.js` -> 404, 14 bytes). The `deploy_game.py` comment "the CDN worker returns 200 \"not found\" bodies for missing keys" did not reproduce on this path.
- E61 `/__shot` does not exist on a deployed build. `bootcheck.py:387`: "on a non-local base the call would only log a harness-made 404. Skip it there."
- E62 `--seed-manifest` masks new files. Memory `reference_forgeflow_games_deploy.md`: "any brand-new files already created before seeding get masked and silently never upload".
- E63 A deploy writes `C:/Users/TestRun/Claude Claw/state/r2_manifest_<slug>.json` (a hardcoded path in `upload_to_r2`). That is the tool's own bookkeeping; expect it in `git status`.
- E64 A published game's detail page needs a portal rebuild. `deploy_game.py`: "a hard load of a new game's URL fell through the Pages catch-all ... to the HOMEPAGE". Run `deploy_portal.py` when the owner publishes.

**Harness / orchestration**
- E65 Another session's headed Chrome steals focus, drops pointer lock, and the game pauses. Memory `project_dyefield.md`: "Proven environmental: `bootcheck.py --headless` = BOOTS CLEAN on the same code". `common.py` `lock_loss_cause()` classifies focus theft vs a game bug.
- E66 Too-short timeboxes cause false FAILs. Memory `project_dyefield.md`: "a 45 s `--match-seconds` timebox ends before the fight/death step (use 90)".
- E67 Lanes write skeleton reports early; run 3 at a time. Memory `project_blocktooth.md`: "Usage/session limits killed whole fan-outs 5+ times (17 lanes → 0 reports)".
- E68 CRLF breaks workflow scripts, and bash heredocs eat backslashes. Memory `project_blocktooth.md`: "Workflow scripts written by Python on Windows get CRLF → the permission hook rejects them". Write them with the Write tool.
- E69 Start every lane brief with "YOUR TASK (do not substitute any other)" (memory `project_blocktooth.md`).
- E70 A hidden Browser pane never fires rAF. Memory `reference_ffg_preview_verification.md`: "when the Browser pane is HIDDEN the page never composites, so **requestAnimationFrame never fires**". Use the Playwright harness, not the pane.

---

## (F) Appendix - three 0.186 addons and the gltf-transform skinned-GLB test

### three 0.186.0 addons (in `games/dyefield/node_modules/three`; `@types/three` 0.186 has a `.d.ts` for every one)
`package.json` exports `"./addons/*": "./examples/jsm/*"`. Import lines, from each file's `@three_import` tag:
```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';   // 29,256 bytes, wasm embedded
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';             // + host libs/draco/gltf/* ; setDecoderPath()
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';               // + host libs/basis/* (transcoder 527,333 B wasm)
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';        // exports: retarget, retargetClip, clone
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';  // ctor (renderer, renderTarget?)
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';        // ctor (resolution, scene, camera, selectedObjects)
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';          // tone mapping + sRGB from renderer settings
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';              // ctor () ; runs BEFORE OutputPass
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';              // ctor ()
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'; // ctor (resolution, strength, radius, threshold)
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';  // cheap full-frame smear option
```
GLTFLoader lists `KHR_draco_mesh_compression`, `KHR_mesh_quantization`, `KHR_texture_basisu`, `EXT_meshopt_compression`,
`EXT_texture_avif` and `EXT_texture_webp`. `setMeshoptDecoder` must come before loading (the loader throws "setMeshoptDecoder
must be called before loading compressed files"). Dyefield itself uses no composer (it imports only GLTFLoader,
SkeletonUtils, BufferGeometryUtils, RoomEnvironment and OrbitControls), so the post chain is new work. It inherits E34-E36.
`DRACOLoader.setDecoderConfig` warns it "will be removed in r194".

### gltf-transform 4.4.2 on a skinned, textured, animated GLB
Input (built for this test by `tools/research/tech_fbx_to_glb.py` in Blender 5.1.2): the Mixamo `Swat.fbx` plus
`Action_Adventure_Pack/hard landing.fbx`, giving `_research/tech_reuse/gt_src.glb`, 5,494,020 bytes: 1 skin with 69 joints
(`mixamorig:Hips`...), 3 skinned primitives, 6 PNG textures (two 1024^2, four 512^2), 2 animations.
Facts: `tools/research/tech_glb_facts.mjs` (glTF Transform SDK from the global CLI; decodes meshopt).
Render check: `tools/research/tech_skin_compare.py` + `tech_skin_view.html` (headless Chrome, three 0.186,
GLTFLoader + MeshoptDecoder, clip `clip` frozen at t = 0.30 / 1.00 / 1.60 s, a fixed camera, alpha silhouette + RGB diff).

| variant | command(s) | bytes | skins x joints | weight sums | textures | clip keys | silhouette IoU vs src (t .30/1.00/1.60) | mean RGB diff inside |
|---|---|---|---|---|---|---|---|---|
| src | - | 5,494,020 | 1 x 69 | [1, 1] | png 1024/512 | 2951 | - | - |
| A | `meshopt` | 4,666,924 | 2 x 69 | [1, 1] (u8 norm) | png unchanged | 2951 | 0.99876 / 0.99959 / 0.99735 | 0.56 / 0.36 / 0.763 |
| B | `resize --width 512 --height 512` then `webp --quality 85` | 1,363,512 | 1 x 69 | [1, 1] | webp 512 | 2951 | (not rendered) | |
| **C** | B then `meshopt` | **554,320** | 2 x 69 | [1, 1] | webp 512 | 2951 | 0.99876 / 0.99959 / 0.99735 | 2.719 / 3.1 / 2.661 |
| D | `optimize --compress meshopt --texture-compress webp --texture-size 512` | 500,404 | 2 x 69 | [1, 1] | webp 512 | 1941 (resampled) | 0.99864 / 0.99931 / 0.99736 | 2.953 / 3.42 / 2.906 |
| E | `webp` then `resize` (order swapped) | 1,300,960 | 1 x 69 | [1, 1] | webp **512** | 2951 | (not rendered) | |
| F | B then `draco` | 543,876 | (not decoded: my facts script has no Draco decoder) | | | | (not rendered) | |

gzip -9 sizes, for reference only (the CDN does not compress GLB, E50): src 4,871,693 · B 751,997 · C 425,882 · D 371,002 · F 406,584.
In the browser, every rendered variant loaded with `skinnedMeshes 3`, `maxBones 69`, 0 page errors, and a skinned
bounding box within 0.0003 m of the source at every tested time.
**What the renders look like** (I Read `skin_test/skin_sheet_t0.30.png` and `skin_sheet_t1.60.png`): all four
columns (src, A, C, D) show the same soldier in the same pose. At t = 0.30 it is the crouched landing, hands down.
At t = 1.60 it is the rising stance, knees bent, arms out. The textures are intact at 512 px (vest, helmet goggles,
face), and there are no stretched vertices, T-poses or exploded limbs. I cannot tell the columns apart by eye; the
diffs above are the measured difference.
Observations with numbers: `optimize` (D) also simplified geometry (body vertices 7,516 -> 7,370; head 3,753 -> 3,733),
pruned the unused `TEXCOORD_1/2` and flattened one node (73 -> 72). `resize` shrank textures that were already WebP (E),
even though its help text says "Resize PNG or JPEG textures".

**Recommended chain.** Put it in `tools/compress_glb.py`: blender.exe export -> gltf-transform -> `art/gltf/`.
- Hero and enemy bodies (close camera): the tested **C chain** (resize -> webp -> meshopt), which leaves geometry
  untouched. For heroes use a 1024 cap in place of the tested 512. That cap is untested here, but it is the same
  commands with a different number. Then re-run `tech_skin_compare.py` on the result.
- Sets and props: the tested **D** (`optimize ... --compress meshopt --texture-compress webp --texture-size N`).
- Before export, purge extra actions in Blender (E46). Load with `loader.setMeshoptDecoder(MeshoptDecoder)`.

### Files this lane wrote
- Report: `_research/TECH_REUSE.md` (this file).
- Data: `_research/tech_reuse/glb_facts.jsonl`, `skin_test/skin_compare.json`, `skin_test/skin_sheet_t{0.30,1.00,1.60}.png`,
  `skin_test_bones/skin_compare.json`, test GLBs `gt_*.glb` (ignore or delete them; up to 5.5 MB each).
- Scripts: `tools/research/tech_fbx_to_glb.py`, `tech_glb_facts.mjs`, `tech_skin_view.html`, `tech_skin_compare.py`.
