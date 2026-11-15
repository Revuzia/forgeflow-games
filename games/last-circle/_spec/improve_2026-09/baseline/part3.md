
## ANSWERS - what a player sees
(a) A 404'd runtime module
  - The entry file (ffg_boot3d.js): a normal-looking loading splash for 30 s, then "Still loading. If this doesn't clear, reload ..." forever. It never turns red, never says "could not load", and never retries.
  - Any other module (e.g. royale/hud.js, sim/royale.js): red bar + "Could not load the game engine - this network may be blocking cdn.jsdelivr.net" within ~3 s. The cause is wrong: it is our own file. At 30 s it is replaced by "Still loading ...". No auto-retry, no button.
(b) jsdelivr blocked (request refused): red bar + the engine message within ~1 s. That message is correct, but it is overwritten at 30 s by "Still loading". There is NO fallback, so the game can never run on that network. jsdelivr black-holed (request hangs): 30 s of normal splash, then "Still loading ..." forever.
(c) 150 kbps: the live CDN measured 53.5 s to the menu (689 KB). The time-based bar sits at 92% from ~20 s, and at ~30 s the player is told to reload, which restarts the no-store JS download. There is no byte, size or elapsed-time feedback.
(d) WebGL unavailable: after ~1.28 MB downloads, red bar + "Last Circle could not start. Reload the page to try again." Reloading cannot help, and the message does not mention WebGL or hardware acceleration. Separately, if the WebGL context is LOST mid-session, the player sees a silent grey dead canvas while the UI still invites them to drop in.
(e) The sitelock rejects the host: after ~1.28 MB downloads, red bar + "Last Circle isn't licensed to run on <host>." At 30 s it is replaced by "Still loading ... reload", so the one terminal message is erased.

## GAPS (ranked by what a player notices)

G1 HIGH - jsdelivr is a single point of failure, no fallback
  evidence: index.html:19 `<link rel="modulepreload" href="https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js" crossorigin>`; index.html:21 importmap -> cdn.jsdelivr.net. cdn_block run: 0 B from jsdelivr, engine message at t1, game never starts.
  reference: games/blackridge/index.html:17 `"three": "./assets/vendor/three/build/three.module.js"`, games/ascendant/index.html:28 (same). blackridge's vendored three.module.js / three.core.js have the same md5 as forgeflow-games/node_modules/three (0.172.0), the exact version LC pulls. (DYEFIELD/BLOCKTOOTH bundle three via Vite, so they have no third-party CDN at runtime.)
  fix: copy from forgeflow-games/node_modules/three (0.172.0) into games/last-circle/assets/vendor/three/: build/three.module.js, build/three.core.js, examples/jsm/{loaders/GLTFLoader.js, loaders/DRACOLoader.js, controls/OrbitControls.js, utils/SkeletonUtils.js, utils/BufferGeometryUtils.js, postprocessing/{EffectComposer,RenderPass,UnrealBloomPass,OutputPass,Pass,ShaderPass,MaskPass}.js, shaders/{CopyShader,OutputShader,LuminosityHighPassShader}.js} (the 18 jsdelivr URLs in the baseline resource list). Point index.html:19 and :21 at ./assets/vendor/three/. LC already vendors draco under the same layout (assets/vendor/three/examples/jsm/libs/draco/), so this only fills in the tree.
  caveat (information): the CDN worker serves every .js as no-store (workers/games-cdn/src/index.js:101-104), so self-hosted three (~270 KB br) is re-downloaded on every visit, where jsdelivr is cached. Optional follow-up in the SHARED worker: an immutable rule for a versioned vendor path (e.g. assets/vendor/three@0.172.0/). Not required for correctness.
  files: games/last-circle/index.html, games/last-circle/assets/vendor/three/** (new)   effort: S
  verify: headless Playwright: route **/cdn.jsdelivr.net/** -> abort; window.__LC__ must appear with zero jsdelivr requests in performance.getEntriesByType('resource'). Also a live-CDN check after deploy (the new vendor files upload AFTER index.html - see G8 - so land G8 first or accept a one-time window).

G2 HIGH - the 30 s poll erases every failure message and tells slow links to reload
  evidence: index.html:60-63 (quoted above) overwrites #lc-splash-tip without knowing that ffg_boot3d.js:14-22 splashFail() already painted a terminal failure. Reproduced in mod404_hud, cdn_block and sitelock: the specific message at t20 becomes "Still loading" at t32. Live 150 kbps: the "reload" advice appears ~23 s before the menu would have loaded. index.html:9: the bar is a 9 s CSS animation (`animation:lcBootBar 9s ... forwards`, keyframe 100% = 92%).
  reference: DYEFIELD runtime/index.html:44-296 - one guard object owns the card: `W.__DF_BOOT__ = { handoff, fail, info }` (:263-294). The loading line never overwrites a terminal card (`if (shown || W.__DF_MAIN__) return;` :231). The status line shows real bytes + visible seconds via PerformanceObserver (:95-107, :234 "Loading... <size> · <s> — slow connection, still loading") and never says "reload" while bytes are still arriving. A stall verdict needs 60 s VISIBLE + 20 s with no new bytes + an unanswered HEAD probe (:57-60, :214-239).
  fix: replace the inline poll with a small head guard exposing window.__LC_BOOT__ = {handoff(), fail(title, detail)}. ffg_boot3d.js splashFail() calls __LC_BOOT__.fail(); splashDone() and the __LC__ poll call handoff(). Build the slow line from resource-timing bytes + visible time. Put a RELOAD button on terminal cards (inside the portal iframe, a browser reload reloads the whole portal).
  files: games/last-circle/index.html, games/last-circle/runtime/3d/ffg_boot3d.js   effort: S-M
  verify: bootfault.py mod404_hud/cdn_block/sitelock with --wait 45: the specific message must still be on screen at t45. slow150: no "reload" text while __LC__ is pending and bytes are growing. Headless Playwright is enough.

G3 HIGH - no load-error capture, no auto-retry, wrong cause named
  evidence: an entry 404 shows nothing for 30 s (mod404_entry). ffg_boot3d.js:79 always blames jsdelivr (`splashFail("Could not load the game engine — this network may be blocking cdn.jsdelivr.net. Reload to try again.")`), which is wrong for mod404_hud and mod404_sim. ffg_royale3d.js:44 `s.onload = res; s.onerror = rej;` rejects with a bare Event (console: "[FFG3D] engine load failed: Event"). grep "addEventListener(\"error\"|unhandledrejection" over runtime/ index.html game_controls.js: 0 hits.
  reference: DYEFIELD runtime/index.html:168-193. A capture-phase `W.addEventListener('error', onLoadErr, true)` (:256) names the file and GETs it for the HTTP status (:184). One automatic cache-busting reload is guarded by sessionStorage 'dyefield.bootRetry' (:161-170, :182, :229). _harness/bootguard.py cases b1-b4.
  fix: (1) the head guard from G2 adds the capture-phase listener for own-origin <script>/modulepreload. (2) In the ffg_boot3d.js catch, probe the kernel URL and the resolved `three` URL (fetch, no-store) and name what actually failed. (3) One auto-retry (?lcretry=a<t>, sessionStorage flag); this also covers the deploy window (G8). (4) At ffg_royale3d.js:44, reject with `new Error("failed to load " + s.src)`.
  files: games/last-circle/index.html, runtime/3d/ffg_boot3d.js, runtime/3d/ffg_royale3d.js (lines 40-46 only)   effort: M
  verify: Playwright: an entry 404 -> "could not load" card within 5 s naming ffg_boot3d.js + HTTP 404, exactly one automatic reload, no second. A hud.js 404 -> the card names hud.js, not jsdelivr.

G4 HIGH - one exception in any frame freezes the game forever, silently
  evidence: ffg_kernel_3d.js:469-493 `const loop = () => { ... for (const u of this._updaters) u(dt, ...); ... this._raf = requestAnimationFrame(loop); }`. There is no try, and the next rAF is scheduled only at the end. frame_throw run: frame counter 195 -> 195 -> 195 over 5 s, `running: true`, an uncaught pageerror, and nothing on screen.
  reference: DYEFIELD runtime/src/game.ts:503-513 `this.raf = requestAnimationFrame(loop); ... try { this.frame(now); } catch (e) { cancelAnimationFrame(this.raf); this.fail(e); }`. game.ts:556-566 fail() pauses input/audio and shows "The match stopped" with the error.
  fix: schedule rAF first and wrap the body in try/catch. On error, log and show a card (MAIN MENU / RELOAD) via __LC_BOOT__.fail or a kernel onError hook that the royale genre installs. At minimum, never let the loop die silently.
  files: games/last-circle/runtime/3d/ffg_kernel_3d.js (start(), lines 469-493; separate from the other session's uncommitted PORTRAIT CAMERA FIT hunk but in the same file, so coordinate)   effort: S
  verify: Playwright: push a throwing updater via window.__FFG3D__.kernel._updaters; a visible error card must appear within 1 s (and/or frames keep advancing if the policy is skip-and-continue).

G5 MEDIUM - a failed match load is an infinite loading screen
  evidence: hud.js:760 `startMatch({ mapId: randomMap(), mode: m.id });` and ffg_royale3d.js:551 `onAgain: () => { ...; startMatch(...); }` have no catch. player.js:290 `if (!urls.length) throw new Error("no character skins available");`. Runs: GLB 404 -> rejected, screen stuck on "Building Isla Viva... / LOADING OPERATIVES 0/90". GLB network drop -> startMatch never settles (one loader promise never settles, see above), stuck on "BUILDING TERRAIN...". The kernel's loadGLTF/loadCharacter (ffg_kernel_3d.js:358-420) have no timeout.
  reference: DYEFIELD main.ts:652-657 routes errors during 'loading' to fail('DYEFIELD could not start', ...). Its loading flows return early on failure (main.ts:706-708 comment "each flow returns straight after its last await").
  fix: catch inside startMatch() (ffg_royale3d.js:296-307, the single choke point for all three callers): tear down, call hudMod.showMenu(W, startMatch), and show a "Couldn't load the match - check your connection" notice. Add a per-asset timeout (Promise.race, e.g. 30 s) to kernel loadGLTF/loadCharacter so a never-settling load cannot wedge a match.
  files: games/last-circle/runtime/3d/ffg_royale3d.js, runtime/3d/ffg_kernel_3d.js (loadGLTF/loadCharacter)   effort: S-M
  verify: Playwright: after __LC__, route **/*.glb* -> 404 and -> abort, then call __LC__.startMatch. Within 35 s, W.phase === "menu" and a notice is visible.

G6 MEDIUM - WebGL unavailable gets a misleading "reload" message (after 1.28 MB downloads)
  evidence: nowebgl run. ffg_kernel_3d.js:74 `this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });` throws inside ffg_boot3d.js start(), which shows "Last Circle could not start. Reload the page to try again." (ffg_boot3d.js:98).
  reference: DYEFIELD main.ts:660-664 `if (!hasWebGL2()) { fail('WebGL 2 is required', '... hardware acceleration switched on, then reload.') }`; renderer.ts:146-157 hasWebGL2().
  fix: a hasWebGL2() check at the top of ffg_boot3d.js BEFORE the engine import (three r172 is WebGL2-only), showing a specific card. This also saves the 1.28 MB download.
  files: games/last-circle/runtime/3d/ffg_boot3d.js   effort: S
  verify: Playwright with --disable-webgl --disable-webgl2: the card mentions WebGL 2 / hardware acceleration within 2 s, and three.module.js is never requested.

G7 MEDIUM - WebGL context loss is silent
  evidence: grep "webglcontextlost|contextlost" over runtime/ index.html game_controls.js -> 0 hits. ctxlost run: the lobby shows "CLICK OR PRESS ENTER TO DROP IN NOW" over a grey dead canvas (scratch/shot_ctxlost_after_start.png). Context loss is most common on phones and backgrounded tabs, so it matters for the in-flight mobile work.
  reference: DYEFIELD main.ts:687-705 (preventDefault, pause, "Graphics were reset by the device ... Press RELOAD", webglcontextrestored -> location.reload()).
  fix: in Kernel3D.mount(), add both listeners on renderer.domElement. On lost: stop(), set W.paused, show a card. On restored: reload.
  files: games/last-circle/runtime/3d/ffg_kernel_3d.js (mount), card via the G2 guard API   effort: S
  verify: Playwright: WEBGL_lose_context.loseContext() -> card within 1 s; restoreContext() -> the page reloads.

G8 MEDIUM - deploy uploads index.html first; runtime upload failures are non-fatal
  evidence: see "Deploy window" above (deploy_game.py:230, :182, :257, :262-265; worker index.js:9, :101-104; ~3.7 s/file).
  reference: DYEFIELD is immune to mixed module graphs by construction (hashed, immutable chunk names, worker index.js:88-92), and its guard auto-retries a missing chunk once (bootguard.py b1/b2).
  fix: in upload_to_r2, upload every other file first and index.html (then game_meta.json) LAST. For games without hashed builds, add runtime/**/*.js to the critical set and abort before index.html if any of them fails. The G3 auto-retry covers the remaining window.
  files: pipeline/deploy_game.py (SHARED by every game; the next deploy of any game is the real test)   effort: S
  verify: dry-run/print the upload order for last-circle and dyefield; index.html must be last. Simulate a failure (monkeypatch subprocess for one runtime file) -> non-zero exit and index.html not uploaded. No browser needed.

G9 LOW-MED - SQUAD UP dead-ends when esm.sh is unreachable
  evidence: esmprobe run (CREATE ROOM/JOIN disabled, "Connecting..." forever). ffg_netplay.js:41 `const mod = await import("https://esm.sh/@supabase/supabase-js@2");` is a third-party CDN AND a floating major version. net.js:258-287 enter() has no try/catch.
  fix: try/catch in enter() -> show "Couldn't reach the online service" and re-enable the buttons. Pin an exact supabase-js version (ideally vendor it).
  files: games/last-circle/runtime/3d/royale/net.js, games/last-circle/runtime/net/ffg_netplay.js (a per-game copy, per its own header)   effort: S
  verify: Playwright: route **/esm.sh/** -> abort, open SQUAD UP, click CREATE ROOM -> error text shown and buttons enabled within 10 s.

G10 LOW - sitelock runs after the full engine download
  evidence: ffg_boot3d.js:64-67 computes siteOk, but it is only checked at :107, after the imports at :70-81. The sitelock run downloaded 1,276,201 B first. (The message being erased is G2.)
  fix: move the ALLOW/SUFFIX check above the imports and return early.
  files: games/last-circle/runtime/3d/ffg_boot3d.js   effort: S
  verify: Playwright via --host-resolver-rules MAP rehost.example 127.0.0.1: card within 1 s, and no jsdelivr or runtime requests beyond ffg_boot3d.js.

G11 LOW - smaller boot holes
  - boot3d returns null silently for an unregistered genre (ffg_kernel_3d.js:508 `... return null; }`), and ffg_boot3d.js:94-95 then calls splashDone(): the splash is removed and the page is blank. fix: throw instead of returning null. file: ffg_kernel_3d.js.
  - resolveContent() has no r.ok check (ffg_boot3d.js:85-86). content.json is served `public, max-age=86400` (live header) and fetched with default caching, so a changed content.json can stay stale for up to 24 h for a returning player. This is latent: content.json has not changed since commit 7d940755. fix: fetch("./content.json" + V, {cache:"no-cache"}) + an r.ok check. file: ffg_boot3d.js.
  - runtime/3d/royale/net.js:31-32 import ../../net/ffg_netplay.js and ffg_rtc.js WITHOUT the ?v= tag (baseline resources show "/runtime/net/ffg_netplay.js" with no query). Harmless today because the worker serves .js as no-store.
  - The ?v= bump in the in-flight index.html diff also rewrote prose in comments ("ffg_boot3d.js?v=1789530264:10" at index.html:69, also :13, :25, :56), because the bump is a global replace. Cosmetic; tell the session that owns the bump tool.
  - Mobile: the desktop-only card claims "there are no touch controls yet" (ffg_boot3d.js:51) while game_controls.js already shows a joystick + FIRE/JUMP/RELOAD, and the card only appears after the whole engine downloads. The in-flight mobile work owns this, so this lane reports it without fixing it.

G12 INFO - no boot gate in _harness
  evidence: _harness/ holds only botcheck.py, botdiag.py, stuckdiag.py, bridge_host.html (ls). DYEFIELD _harness/bootguard.py runs 11 cases (a, b1, b2, b3, b4, c, d, f, e1, e2, e3; docstring lines 17-38).
  fix: games/last-circle/_harness/bootguard.py (new; _harness is dev-only per deploy_game.py DEV_ONLY_DIRS and never ships). Seed it from scratch/bootfault.py + hangprobe5.py + esmprobe.py. Cases: a normal; b1 entry 404; b2 runtime module 404; b3 retry flag already set; c slow (CDP throttle, no failure card, no "reload" text); d stalled (jsdelivr/three never answers); e cdn blocked (must still boot after G1); f hidden time excluded; g no WebGL; h sitelock; i content.json 404; j frame throw; k context lost; l GLB failure at match start -> back to menu; m esm.sh blocked in SQUAD UP.
  files: games/last-circle/_harness/bootguard.py (new)   effort: M
  verify: the gate exits 0 on the fixed build and non-zero on the current one for cases b1, e, j, l.

## Suggested file-disjoint lanes
  L-A (boot guard): index.html, runtime/3d/ffg_boot3d.js, runtime/3d/ffg_royale3d.js lines 40-46 -> G2, G3, G6, G10, G11 (boot parts)
  L-B (vendoring): assets/vendor/three/** + index.html lines 19-22 only -> G1 (run after L-A or merge with it; both touch index.html)
  L-C (kernel resilience): runtime/3d/ffg_kernel_3d.js -> G4, G7, the G5 timeout part, the G11 null-return (coordinate with the uncommitted PORTRAIT CAMERA FIT edit in the same file)
  L-D (match-load recovery): runtime/3d/ffg_royale3d.js startMatch (296-307) -> the G5 catch part
  L-E (online): runtime/3d/royale/net.js, runtime/net/ffg_netplay.js -> G9
  L-F (deploy, shared pipeline): pipeline/deploy_game.py -> G8
  L-G (gate): _harness/bootguard.py -> G12

Scratch evidence: C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/audit/scratch/ (bootfault.py, hangprobe2-5.py, esmprobe.py, mobileprobe.py, mobilehit.py, loadprobe.py, out_*.json, shot_*.png)
