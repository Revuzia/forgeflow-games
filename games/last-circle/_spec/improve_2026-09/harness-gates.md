# Lane: harness-gates (Last Circle vs DYEFIELD / BLOCKTOOTH)

Status: COMPLETE (2026-09-30). Read-only audit; no repo file modified. Scratch probes + JSON: scratch/hg/.

SUMMARY. Last Circle's only real gate is a Node selftest of the pure sim (royale.selftest.cjs); its three browser scripts are
un-gated measurements pointed at a dead port. All seven bugs named in the brief lived in view/runtime code (or the portal iframe) that
Node never loads; six of the seven cite an owner report in the fixing commit or its code comment (player.js:437-438 "(owner report)" for the guns), and the seventh was found on the live portal (GamePlayer.tsx:27-29). DYEFIELD/BLOCKTOOTH gate the same classes with a shared Playwright collector + boot /
playtest / numeric render-check / perf scripts that exit 0/1/2. Proposed smallest set (§5): common.py, bootcheck.py, rigcheck.py,
playtest.py (camera + audio blocks), portalcheck.py, perfcheck.py (info only), gate.py - all new files under _harness/.
Browser probes this session showed the checks are feasible AND discriminating on the current build (§6, §6b): holder-to-hand 0.02 m on
50/50 actors (0.617 m FAIL on a simulated regression), 0.0 deg camera drift with the cursor parked off-centre, every played gunshot
window = 1 report although the shipped files still hold 7- and 4-report bursts. They also exposed three things the gates must handle:
rAF is starved on this box (blank WebGL page: 2 frames in 3 s) so view checks must step the kernel synchronously; the shared :8790
server refuses connections under load; and the in-game rig audit (rig_pipeline.js) now fires 55 false warnings per match.

Legend for "catches what Node cannot": VIEW = runtime/3d / renderer / rig / camera code; INPUT = real
page.keyboard / page.mouse / touch / pad reaching the game's own input path; LAYOUT = DOM/HUD geometry;
BOOT = the page actually loading (console/page/shader errors, 404s, boot guard); PERF = frame times /
draw calls in a real GPU context; AUDIO = decoded asset + router behaviour; SIM = Node-only (catches
none of the above, but is the determinism/balance gate).

## 1. DYEFIELD _harness (C:/Users/TestRun/Claude Claw/forgeflow-games/games/dyefield/_harness)

| script | one-line purpose (from its own docstring) | catches that Node cannot |
|---|---|---|
| common.py | shared Playwright Session: headed d3d11 Chrome, occlusion OFF, collects console/page/window errors, failed requests, shader/GL diagnostics, harness-owned rAF counter (`__H_FRAMES__`) | BOOT (the collector every gate reuses) |
| bootcheck.py | CONTRACT G4: load, REAL click -> pointer lock -> play, REAL KeyW 1.5 s must move > 3 m, REAL mouse tilt + LMB hold must paint under the feet; pointer-lock loss while focused = FAIL; 0 console/page/shader errors, 0 failed requests, frames + sim ticks advancing | BOOT, INPUT, VIEW (pointer lock, minimap pixel) |
| bootguard.py | proves the index.html boot guard: 404 entry chunk / 404 preload / 404 css / slow / stalled / hidden-tab cases via page.route + CDP throttling; can target the live CDN read-only | BOOT (failure UX a player sees on a bad deploy) |
| layoutcheck.py | CONTRACT_MOBILE M6: every screen x 7 viewports (3 phones with safe-area insets, 2 tablets, 2 desktop): clip, overlap, 44 px targets, font >= 12/14 px, no page scroll, wordmark uncovered, HUD clear of touch zones | LAYOUT, INPUT (taps) |
| mobile.py | CONTRACT_MOBILE M11: device emulation + REAL CDP multi-touch: boot -> menus by taps -> match (stick moves >= 3 m, look drag >= 0.3 rad, FIRE/JUMP/SLICK/SUB/SPECIAL), portrait overlay, pinch/long-press hygiene, manifest/icons, perf info, 0 errors | INPUT (touch), LAYOUT, VIEW, BOOT, PERF (info) |
| menus.py | CONTRACT_P6_11 §20: real-input walk of the whole front end (title, loadout, settings rebind + conflict, how-to, map select, pause/quit, keyboard-only start, synthetic gamepad, renderer.info leak check after each return to lobby, layout at 1600x900 + 1280x720) | INPUT, LAYOUT, VIEW (mannequin pixel diff, GPU leak) |
| playtest.py | CONTRACT G9: a real match with REAL keys + pointer-lock mouse: paint, slick, fight, death slate text, victory slate numbers == sim, PLAY AGAIN; AUDIO: context running, music cue, >= 1 world sfx, 0 decode errors, clipping master = problem; frame p50/p90/p99 | INPUT, VIEW, AUDIO (live WebAudio), PERF (info) |
| perfcheck.py | "60 fps on a mid laptop": stand / walk (REAL W) / fire (REAL W+LMB) windows, every rAF delta + renderer counters every 250 ms; refuses to run while another automated Chrome is alive | PERF |
| abperf.py | interleaved A/B GPU-cost bench (EXT_disjoint_timer_query_webgl2) at a frozen pose; variants alternate in 8-frame blocks so the shared iGPU's drift cancels | PERF (noise-robust) |
| lookshots.py | G5 look evidence: countdown/spawn/dye close/debug/midcourt/sidedeck/golden shots; every paint stroke real input; 0 errors | VIEW (screenshots for a critic) |
| padcheck.py | FFA drop pads: RENDERED pad top vs ground by raycast at >= 64 points per pad (hover <= 3 cm, sink <= 1 cm), 1 draw object, close-ups with the sim frozen | VIEW (render-vs-geometry numeric assert) |
| build_icons.py | renders PWA icons from the favicon SVG (tool) | n/a |
| gen_ffa_spawns.ts | Node, THREE-free FFA spawn generator + fairness report | SIM |
| probe_audio.ts | Node audio gate: every shipped file ffprobe'd (codec/rate/duration/bitrate), sprite regions not silent/clipped, loop seams click-free, event->sound map complete, router driven by real bot matches with the real 24-voice pool (voice limit, splats <= 14/s) | AUDIO (asset-level: decodes the files) |
| probe_bots.ts | G8b: full 180 s 8-bot match(es), determinism, stuck / jitter gates | SIM |
| probe_combat.ts | G7 combat on real map collision (Rapier in Node) | SIM |
| probe_kits.ts | G10 kits / specials | SIM |
| probe_match.ts | match loop: countdown freeze, horns, result, determinism, wall time | SIM |
| probe_move.ts | G2 movement on the real map GLB via Rapier KCC | SIM |
| probe_nav.ts | G8a nav graph: connectivity, nodes not in geometry, symmetry, EXECUTION of every edge | SIM |
| probe_paint.ts | G1 paint atlas / coverage | SIM |
| probe_swim.ts | G6 swim / slog / wall-slick | SIM |

## 2. BLOCKTOOTH _harness (C:/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth/_harness)

| script | one-line purpose | catches that Node cannot |
|---|---|---|
| common.py | the template DYEFIELD copied: headed d3d11 Session, error/request/shader collectors, harness rAF counter + frame-time recorder (`__H_FRAMES__`, `__H_FT__`), event collector over `__BT__.events(n)` | BOOT |
| bootcheck.py | CONTRACT §15 gate 3: autostart -> slate; NUMERIC assert the titan stands inside a zebra crossing on the first play frame; REAL key to dismiss; frames + sim advancing; 0 errors of every kind | BOOT, INPUT, VIEW (numeric pose check) |
| playtest.py | gate 4: title -> select -> biome -> DROP IN by REAL keys only; steering policy on page.keyboard; `__BT__` for OBSERVATION only; moved > 20 m, ate, levelled, draft by 1/2/3, hook + dash effects, 0 errors | INPUT, VIEW, BOOT |
| playtest_v2.py | FEATURES_V2 §15.4: 11 real-input steps (goals, UPROAR by real E, power-ups, objectives, banish/lock, endless, profile persistence across reload, HUD DOM == state, gamepad stub, settings, cinematic) | INPUT, LAYOUT (HUD DOM vs state), VIEW |
| playtest_gate.py | GATEKEEPERS §8.3: 6 real-input boss-flow steps; cheats only SET state, every acceptance action is a real key / pad button | INPUT, VIEW |
| perfcheck.py | gate 5: Size V + ~250 enemies under REAL keys, p99 <= 22 ms, draws <= 450; `--prof` prints per-lane frameprof medians | PERF |
| shots.py | gate 6 evidence battery for a visual critic: menus, every titan x biome x size, HUD, bosses frozen mid-telegraph, cinematics, 1280/1920 HUD | VIEW, LAYOUT |
| bot.ts, bot_draft.ts, bot_gate.ts, bot_map.ts, bot_ult.ts | deterministic pure headless player policy used by the Node probes | SIM (tooling) |
| probe_sim.ts | gate 2: all titans x biomes, 13 sim-min, determinism hash per tick, sim ms/tick p99 | SIM |
| probe_ai, probe_balance, probe_boss3, probe_city, probe_combat, probe_econ, probe_endless, probe_evolutions, probe_gatekeepers, probe_icons, probe_map, probe_meta, probe_titan, probe_ult, probe_upgrades | per-lane Node THREE-free probes | SIM |

Key pattern: both reference games split gates into Node SIM probes AND browser gates (boot / playtest / perf /
shots / layout / mobile / menus / bootguard / padcheck) that all share ONE common.py collector. Every browser gate
has a verdict line and an exit code (0 pass / 1 fail / 2 could not judge).

## 3. Last Circle today (C:/Users/TestRun/Claude Claw/forgeflow-games/games/last-circle)

| file | what it does | gate? |
|---|---|---|
| runtime/sim/royale.selftest.cjs (423 lines) | Node asserts on the pure sim: RNG, storm plan/pacing/edge speed, damage/falloff/range band, weapon roster, loot rolls, match bookkeeping, bot tier mix, move basis, swept collision, spread, heal, sprint | YES (exit 0/1) but SIM only: line 9 `const _req = require("./royale.js");` is its only require; it never loads runtime/3d/* |
| _harness/botcheck.py (105 lines) | 3 seeds x 150 s via `__LC__.fastForward`; prints STUCK / DRY / FIRING % | NO: prints numbers, no threshold, no exit code; collects only `pageerror` (line 85) |
| _harness/botdiag.py (90 lines) | dry-ammo episodes per bot | NO: diagnostic print; collects no errors |
| _harness/stuckdiag.py (69 lines) | bots whose distance-to-goal is not closing for 4 s | NO: diagnostic print |
| _harness/bridge_host.html | stand-in portal parent answering forgeflow:load / recording forgeflow:save | manual fixture; no script drives it |

All three .py hard-code port 8788: botcheck.py:18 `URL="http://localhost:8788/games/last-circle/index.html"`,
botdiag.py:59 and stuckdiag.py:41 the same literal. The scoped server this session is on :8790, so they cannot
run as written (no `--base` flag).

## 4. Why the Node selftest could not have caught any of the seven shipped bugs (evidence)

Each bug below was shipped, then found by the OWNER in play, then fixed in view/runtime code under runtime/3d/*,
which royale.selftest.cjs never loads (its only require is line 9, `require("./royale.js")`).

| shipped bug | fixing commit (git show) | where the defect lived | what would have had to observe it |
|---|---|---|---|
| invisible guns (hand-bone lookup) | 3e1bbc34 "Hand-bone lookup only matched the OLD Meshy name (^RightHand$) ... every weapon silently fell back to the static chest socket" | runtime/3d/royale/player.js:439 `rig.scene.traverse((o) => { if (o.isBone && /^(mixamorig:?)?RightHand$|^FistR$/i.test(o.name) && !fist) fist = o; });` | a loaded rig in a browser: holder parent bone + gun-to-hand distance |
| 9 m stretched player (root motion) | 62765464 "the moment they actually played (they 404'd on the CDN until the sync) the player stretched ~9m tall" | player.js:139 `function stripRootMotion(clip)` (now drops non-root position/scale tracks, player.js:147-152) | each clip family actually PLAYING on a skinned rig: head-to-foot height; AND a 404 on a clip must fail a gate (the 404 hid the bug) |
| backwards gun at angles | a8b96f16 "running at an angle to the aim pointed the gun sideways/backwards out of the hands"; also d1562acd "AR + launcher were 180 backward" | player.js:1580-1594 barrel weld `const gunYaw = bodyFwdYaw + twist;` ; weapons.js WPN_FLIP table | barrel world +Z vs chest forward while moving at an angle to the aim; the 180 flip only by a side-view screenshot (a numeric check cannot tell stock from muzzle - that heuristic is what failed) |
| camera drift | 5adf16f4 "an unlocked-pointer cursor-follow block rotated the view ... up to 177 deg/s" | player.js updateCamera (removed block) | camera quaternion over N rendered frames with NO input |
| parachute stuck on player | 3e1bbc34 "Chute safety net: a canopy on a grounded, non-gliding actor is removed" | player.js:1075 `if (a.chute && !a.gliding && a.onGround && !a.netRemote) removeChute(a);` | every actor after landing, over many seeds and the exotic paths (roof, mantle, SPACE toggle near ground) |
| audio samples with 7 reports per shot | c663ddf3 "shot_ar_0 7 reports ... shot_smg_2 7 reports ... two thirds of AR and SMG fire ... was firing a burst per trigger pull" | runtime/3d/royale/audio.js:107 `function oneShotSlice(buf)`, audio.js:188-195 `src.start(t0, sl.off, sl.dur)` | the decoded buffer + the window actually passed to AudioBufferSourceNode.start() |
| portal pointer-lock failure | memory reference_portal_iframe_pointerlock.md + pipeline/knowledge/GAME_DOCTRINE.md:260-266 "a sandboxed frame without that token cannot pointer-lock ... Same-origin frames lock without any token, so local dev never catches a missing one" | src/components/game/GamePlayer.tsx:177 `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms"` | a real click inside a CROSS-origin iframe carrying the portal's exact sandbox string |

Absence checks (greps run this session):
- `grep -n "pointerlockerror\|MOUSE CAPTURE BLOCKED\|lockerror"` over games/last-circle/runtime/3d/*.js and royale/*.js -> 0 hits. The game never
  tells a player that capture was refused (doctrine §6 asks for it; DYEFIELD has it: dyefield/runtime/src/ui/boot.ts:380 `const h = el('h2', '', 'MOUSE CAPTURE BLOCKED');`).
  So a pointer-lock gate has no in-game signal to assert against; it must read document.pointerLockElement + console text itself.
- `grep -n "subprocess\|playwright"` in pipeline/deploy_game.py -> only wrangler upload (line 259) and deploy_portal.py (line 506).
  Nothing runs a Last Circle gate before a deploy; gates run only when an author remembers to.
- `grep -rn "performance.mark\|ResizeObserver\|renderer.info\|autoReset"` over games/last-circle/runtime -> 0 hits. A perf gate cannot read
  draw calls from the game; it must read `__LC__.W.kernel.renderer.info` itself (and info.autoReset is default true, so read inside the frame
  or wrap render).

## 5. Proposed smallest Last Circle gate set (all NEW files under games/last-circle/_harness/, adapted from DYEFIELD)

Principle carried over from both references: Node probes gate the SIM; a browser gate with ONE shared collector gates
everything a player sees or touches. Every gate prints a VERDICT line and exits 0 pass / 1 fail / 2 could-not-judge
(environment: server refused, GPU busy, focus stolen) so an environment failure is never reported as a game failure.
`__LC__` is used for SETUP and OBSERVATION (it already exposes W, startMatch, fastForward, brains at
runtime/3d/ffg_royale3d.js:618-637); every ACCEPTANCE action is real input where a player would use input.
View reads happen only after VIEW frames have run - rAF frames (asserted via the harness frame counter) or, preferably,
kernel frames stepped synchronously (tweens -> mixers -> updaters -> render; see §6 E2/E5). fastForward (ffg_royale3d.js:626-635)
steps bots/player/weapons/loot/storm only - no fx, hud, audio, mixers, render - so it may be used to SKIP time, never to judge the view.
(Spec revised after the §6 browser evidence: G2 (a)/(b)/(c) and the LOD rule below.)

| # | gate (new file) | adapted from | drives | asserts | shipped bugs it would have caught |
|---|---|---|---|---|---|
| G0 | common.py | dyefield/_harness/common.py (Session, INIT_JS, SHADER_MARKERS, diag_problems, save_report, preflight_chromes) | headed Chrome d3d11, CalculateNativeWinOcclusion off; `--base` (default http://127.0.0.1:8790/games/last-circle/index.html); `--disk` = page.route the game dir read-only from the working copy | collects console errors, page/window errors, unhandled rejections, failed requests (>= 400 + net failures), shader/GL errors, `[rig]` warnings, harness rAF counter, pointer-lock/focus timeline, and every AudioBufferSourceNode.start(buffer, off, dur) | (infrastructure for all) - also fixes the three existing scripts' hard-coded :8788 |
| G1 | bootcheck.py | dyefield/_harness/bootcheck.py | REAL click on the menu PLAY (then lobby timers), REAL click on the canvas -> pointer lock, REAL KeyW 1.5 s after landing (fastForward only to skip the glide) | 0 console errors, 0 page/window errors, 0 failed requests, 0 shader errors, 0 `[rig]` warnings; frames AND W.t advancing; pointer lock ON after the click (loss while focused = FAIL, loss after blur = NOTE + one re-lock, DYEFIELD's rule); moved > 3 m | 9 m stretch (the clips were 404ing - 62765464 - a failed-request gate flags that before the CDN sync exposes the stretch); invisible guns via the `[rig]` audit once rig_pipeline.js is fixed (see §6 E3) |
| G2 | rigcheck.py | dyefield/_harness/padcheck.py (numeric "rendered vs expected" asserts + frozen close-ups) | `startMatch` x 3 seeds; ALL actors inside the 250 m animation-LOD radius (player.js:962 `const far = a.isBot && humanPos && a.pos.distanceToSquared(humanPos) > 250 * 250;` freezes the rest, whose stale poses are invisible to a player) sampled every 15 stepped view frames through glide, canopy, landing, idle, run, rifle/pistol, swim, crouch, reload; the player (practice mode) driven by REAL keys at 8 move-vs-aim offsets (W, W+D, D, S+D, S, S+A, A, W+A) with the look yaw held, and REAL LMB for firing | per sample: (a) Euclidean head-bone-to-foot-bone distance in [1.3, 2.2] m (NOT the vertical delta: a belly-down skydive reads 0.9 m vertical); (b) `a.hand.parent === a.handBone` AND holder world position within 0.05 m of the hand bone (today exactly 0.02 m, player.js:453); (c) armed + grounded + not emoting + not swimming, sampled OUT of combat first (all 8 offsets) and then in combat: barrel (holder world +Z) . chest forward >= a per-weapon-family threshold calibrated ONCE against side-view screenshots (design basis: the 0.6 rad twist clamp + clip sway; §6b E9 measured 52 deg for a pistol strafing out of combat, so a flat cos 45 deg would fail today), chest forward derived in WORLD space from the shoulder line (up x (RightArm - LeftArm)), never from a bone-local axis; whenever the weld tracks aim (long guns on the ground; pistols in combat - keyed off the weld's own predicates, not the sticky `_armMode`), barrel . camera forward >= cos 15 deg (E9: >= 0.998 for the AR, >= 0.990 for the pistol in combat); never negative (backwards) in any state; (d) no actor with `chute && onGround && !gliding` for > 0.5 s, including a REAL Space-spam run at 12-16 m AGL and a roof landing; (e) side-view close-up PNG per weapon (the 180-degree flip of d1562acd is only judgeable by eye - its numeric heuristic is exactly what failed) | invisible guns, 9 m stretch, backwards gun at angles, parachute stuck (4 of 7) |
| G3 | playtest.py | dyefield/_harness/playtest.py (incl. its AUDIO block) | a full real-input solo match to death/win: pointer-lock mouse look, WASD, LMB, R, E loot, Esc pause/resume, post-match -> menu -> PLAY AGAIN | camera (practice mode; precondition `W.player.alive && W.phase === 'match'`, else re-run - a dead player's spectate camera read 330 deg in §6 E5): REAL cursor parked hard off-centre (page.mouse.move to 95 % x / 10 % y), then 90 view frames of NO further input with the pointer unlocked AND locked -> abs(d yaw), abs(d pitch) < 0.05 deg; a real locked mouse move of +200 px -> `input.yaw` changes by -200 x sensitivity x 0.0022 (player.js mousemove handler: `W.player.input.yaw -= mx2 * sens;`); audio: AudioContext 'running'; every buffer start made DURING a 'shotFired' dispatch (wrap W.events.emit to tag them - a 1 s generated noise buffer also passes through start()) has exactly 1 report in its PLAYED window (off, dur) (onsets >= 40 ms apart over 35 % of the file peak); N real semi-auto clicks -> shots >= N - 1 (the first click after a deliberate cursor release is swallowed by design, hud.js:112) and exactly 1 tagged start per shot; 0 errors through menu -> match -> post-match -> menu | camera drift, 7 reports per shot (2 of 7) |
| G4 | portalcheck.py | new, small; automates the two-origin matrix already written up in src/components/game/GamePlayer.tsx:39-50 (127.0.0.1:8798 framing :8799, REAL clicks, 4 sandbox variants) and generalises _harness/bridge_host.html | a parent page fulfilled by page.route at http://localhost:8790/__lc_portal (a DIFFERENT origin from 127.0.0.1) iframing the game with the sandbox + allow strings READ at run time from src/components/game/GamePlayer.tsx:177-178; headed; REAL click inside the frame | frame `document.pointerLockElement` non-null within 2 s; 0 console lines matching "Blocked pointer lock"; localStorage write/read works in the frame (allow-same-origin); forgeflow:load / forgeflow:save round-trip (bridge_host.html's fixture). Optional `--live` against the portal URL (GET only), since doctrine §6 says same-origin dev never catches a missing token | portal pointer-lock failure (1 of 7) |
| G5 | perfcheck.py | dyefield/_harness/perfcheck.py (+ blocktooth --prof pattern once frame-pipeline lands frameprof) | stand / walk (REAL W) / fire (REAL W + LMB) windows during the 50-actor drop and a mid-match fight | INFORMATION ONLY (owner rule): every rAF delta p50/p90/p99, draw calls + triangles read from W.kernel.renderer.info per frame, DPR, canvas size; refuses/flags when other automated Chromes run (DYEFIELD's contamination rule) | none of the 7 (perf regressions) |
| G6 | gate.py | tiny runner | runs `node runtime/sim/royale.selftest.cjs`, then G1-G4 (G5 info) | one verdict table; exit non-zero if any gate FAILs, 2 if any could not judge | - |

Later, paired with other lanes (not needed to catch the seven): bootguard.py (dyefield/_harness/bootguard.py; pairs with the
boot-robustness lane's index.html guard) and layoutcheck.py / mobile.py (dyefield; pairs with the mobile lane).

Files the gate work touches (file-disjoint from runtime lanes): games/last-circle/_harness/{common,bootcheck,rigcheck,playtest,
portalcheck,perfcheck,gate}.py (new) and _harness/{botcheck,botdiag,stuckdiag}.py (base URL only). No runtime file is REQUIRED
by G0-G6; the runtime fixes in §6 are separate items for the lanes that own those files.

## 6. Browser evidence gathered this session (feasibility probes; scripts + JSON in scratch/hg/)

Scripts: scratch/hg/lc_gate_probe.py (boot + rig + chute + camera + audio snapshot), rafprobe.py, blankraf.py, stepview.py.
All read-only; the game dir is served either by the running :8790 http.server or, after it refused connections,
by a read-only page.route from the working copy (never outside games/last-circle).

### E1. The shared static server is not a usable gate host under load (VERIFIED)
probe2.json (served by :8790 `python -m http.server 8790 --bind 127.0.0.1`, pid 24892, with 8 automated Chromes from other
lanes alive): desktop run `lcReady: False` after 143.7 s, console shows
`Failed to load resource: net::ERR_CONNECTION_REFUSED` x9 and
`[FFG3D] engine load failed: TypeError: Failed to fetch dynamically imported module: .../royale/player.js?v=1789530264`.
curl of the same URL alone returned 200 in 0.015 s: the refusals are the server's backlog under concurrent Chromes, not the game.
=> G0 needs `--disk` (page.route from the working copy) or its own server on a free port (DYEFIELD bootguard.py serves its own), and
connection-refused must be exit 2 ("could not judge"), never "game broken".

### E2. rAF is starved on this box right now; any gate that waits on rAF would report garbage (VERIFIED)
- blankraf.py: a blank page with a 64 px WebGL2 canvas got `d3d11 blank-page rAF frames in 3 s: 2` and `default ... 4` in headless Chrome.
- rafprobe.json: Last Circle menu `menuFrames3s: 0` (visibilityState 'visible', hasFocus true); practice match `matchFrames4s: 0`.
- probe3.json: harness rAF counter was 20 for the whole run; the "camera drift" window measured `dYawDeg: 0.0 ... frames: 0` - a
  FALSE PASS (nothing rendered, so nothing could drift), and 6 real LMB clicks produced `shotsFired: 0` (input is consumed in a kernel updater).
=> Every view gate must (1) assert the harness frame counter advanced before judging (DYEFIELD bootcheck: "frames + sim ticks advancing"),
   and (2) preferably not depend on rAF at all: step the kernel SYNCHRONOUSLY - tweens -> `_mixers[i].update(dt)` -> `_updaters` -> one
   render - which is exactly ffg_kernel_3d.js:475-491 minus requestAnimationFrame. That runs the view code (syncObj, barrel weld, camera, fx, hud, audio)
   that `__LC__.fastForward` (ffg_royale3d.js:626-635) skips. Proposed test hook: `__LC__.stepFrames(n, dt, render)` in ffg_royale3d.js next to
   fastForward (a 10-line addition; the harness can also do it from page JS today through W.kernel, as stepview.py does).

### E3. The in-game rig audit is 100 % false positive after the Mixamo re-rig (VERIFIED, player-invisible but it blinds the gate)
probe3.json console, one standard match: `[rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" - legal: RightHand, FistR]`
x10, and the same x10 for athlete, wraith, juggernaut, viper (= all 50 actors), plus `[rig] soldier FAILS the skeleton contract - missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightFore...`
once per skin. rigAudit read back: every skin `ok: False, handBone: None, missing: 18`.
Cause: runtime/3d/royale/rig_pipeline.js:36-49 lists bare names (`"Hips", "Spine02", ...`, `weapon: ["RightHand", "FistR"]`) while the shipped GLBs
now use Mixamo names - verified by reading the GLB JSON chunk: soldier.glb nodes include `'mixamorig:RightHand'`, `'mixamorig:Hips'` (THREE strips
the colon -> `mixamorigRightHand`, the name in the warning). player.js:439 was fixed for the prefix (3e1bbc34); rig_pipeline.js never was.
Effect: the one runtime guard written to catch "gun on the wrong bone" now warns on every healthy actor, so a real regression would be
indistinguishable from the noise, and G1's "0 [rig] warnings" cannot be turned on until it is fixed.
Also in the same console: `THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion.` (and Ring/Pinky 1-3, both hands)
x10 each - clip finger tracks with no matching bone. Harmless to the player, but it is 180+ warning lines per match that bury real ones;
the gate should allow-list exactly this pattern (or stripRootMotion should drop tracks with no target) rather than ignore warnings wholesale.
Fix (runtime, owner lane = characters/rig): rig_pipeline.js - accept an optional `mixamorig:?` prefix in EXPECTED_SKELETON.required/oneOf/attachPoints
matching and the Mixamo spine names (Spine/Spine1/Spine2); verify = 0 `[rig]` lines in a match console and `W._rigAudit[skin].ok === true` for all 5 skins.

### E4. Numbers the rig gate would have read on the current build (probe3.json, pre-stepping, 50 actors)
- drop snapshot: every actor's holder parent is `mixamorigRightHand` (a Bone) - the invisible-gun regression is currently absent;
  head-foot vertical span 1.41-1.50 m (no 9 m stretch); weapon-mesh-centre to hand-bone max 0.142 m (pistols).
- the naive checks misfire, which shapes the gate spec: barrel . aim-yaw = -0.993 for all 50 gliders (the weld is intentionally off while
  gliding, player.js:1566-1567), and a vertical head-foot span read 0.897 m on actors still in a stale belly-down skydive pose (no frame had
  rendered since fastForward). So G2 must (a) judge the barrel only in armed + grounded + not-emoting states against the CHEST, not the raw
  aim yaw, (b) use the Euclidean head-to-foot distance, not the vertical delta, and (c) only read poses after stepped view frames.
- chutes on grounded non-gliding actors after landing: 0 of 38.

### E5. rAF-free stepped view frames WORK and give the gates real numbers (stepview.json, VERIFIED)
stepview.py steps the kernel from page JS (tweens -> mixers -> updaters -> 1 render) - no requestAnimationFrame.
- standard match, seed 7, all 50 actors after 45 stepped frames of the drop: holder parent === a.handBone for 50/50,
  holder-to-hand-bone distance max 0.02 m (exactly the `a.hand.position.set(0, 0.02 / ws, 0)` offset, player.js:453),
  head-to-foot Euclidean span 1.337-1.52 m. After fastForward(40) + 60 stepped frames: 37 alive, span 1.373-1.52 m, 0 canopies on grounded actors.
  => current build PASSES the invisible-gun, 9 m-stretch and stuck-chute assertions; the gate has headroom (band [1.3, 2.2] m; 0.05 m holder tolerance).
- practice match, the player alive, 90 stepped frames with NO input: `dYawDeg: 0.0, dPitchDeg: 0.0`. CAVEAT: this run never moved the cursor, and
  the historic drift lived in the human-input kernel updater and was driven by `W.mouseNDC` (git show 5adf16f4: `if (document.pointerLockElement !== dom
  && W.mouseNDC && !rmbDrag) { ... inp.yaw += W._lookYawR * d;`), so this is NOT yet the discriminating condition. G3 must first park the REAL cursor
  hard off-centre with page.mouse.move (the fix commit's own check: "cursor parked hard off-centre 5 s => 0.0000 deg drift"). Note also that
  fastForward never runs that updater (ffg_royale3d.js:626-635 calls the module update()s directly, not kernel._updaters), so no fastForward-based
  script could ever have seen this bug.
  The same measurement in the standard match read `dYawDeg: 330.243` with `dInputYaw: 0` because the player had died during fastForward and the
  camera was following a spectate target: G3 must assert `W.player.alive && W.phase === 'match'` before judging, and run the look checks in
  practice mode (one human, no storm, nobody can kill the subject), as DYEFIELD playtest re-runs a timed step when its human was washed.
- 6 real LMB clicks with the pistol -> `shotsFired: 5`. The first click after entering the match is swallowed by design
  (player.js mousedown: `if (e.button === 0 && W._suppressNextShot) { W._suppressNextShot = false; return; }`), so the gate's rule is
  shots >= clicks - 1 and exactly one own-gunshot buffer start per fired shot.
- AUDIO (the 7-reports bug): every shot class emitted through the real router (`W.events.emit('shotFired', W.player, id, ...)`, the event weapons.js:567
  emits), 45 starts: `8 x fileDur=0.897 inFile=7 played=1 sliced=True`, `6 x inFile=4 played=1`, rest `inFile=1 played=1`. So the shipped files still
  contain 7- and 4-report bursts and the runtime slice (audio.js:188-195) is what makes one trigger pull one report. The gate measures exactly that
  boundary (the buffer + the (offset, duration) handed to AudioBufferSourceNode.start), which is where the bug lived.
  Discriminator needed: the same recorder also caught `fileDur=1 inFile=25 played=25 sliced=False` (a 1 s generated noise buffer, not a gunshot), so G3
  must tag starts made during a 'shotFired' dispatch (wrap W.events.emit) instead of judging every buffer.

### E6. Portrait: the in-flight kernel PORTRAIT CAMERA FIT is overwritten in a match (VERIFIED; player-visible on a phone held upright)
stepview.json portrait (390x844, practice, stepped frames): `camFov 57 aspect 0.462` while the kernel reports
`fit {... 'authoredFov': 42, 'appliedFov': 85, 'active': True}`. Two reasons, both static-verified:
- runtime/3d/royale/player.js:1905 `cam.fov = W._fovBase + (W.fovPunch || 0) * Math.min(1, W._fovBase / 57);` writes the fov EVERY frame, and the
  kernel only re-applies its fit on resize/start (uncommitted ffg_kernel_3d.js `_resize()` -> `this.applyCameraFit()`, `start()`, `boot3d()`).
- the fit latched `authoredFov: 42`, the MENU camera value (hud.js:485 `W.camera.fov = 42;`), not the in-match 57.
Horizontal view in portrait = 2*atan(tan(28.5 deg) * 0.462) = 28 deg, against 2*atan(tan(28.5 deg) * 1.778) = 88 deg on a 16:9 desktop.
The kernel's own state says "active", so a check that reads `_camFit` would PASS; only a gate that reads `camera.fov` after real match frames catches it.
Owner lane: mobile (files player.js updateCamera or ffg_kernel_3d.js); gate: a portrait case in layoutcheck/mobile (DYEFIELD pattern) asserting the
in-match horizontal fov >= the 16:9 design horizontal fov (or >= 60 deg) at 390x844.

## 7. Ranked gaps (by what a player would notice if the guarded bug class came back)

1. HIGH - No view-level rig gate (G2 rigcheck.py). Guards 4 of the 7 owner-found bugs (invisible guns, 9 m stretch, backwards gun, stuck
   canopy). The rig stack is still moving (Mixamo re-rig; memory notes HAND_AIM_ROT grips were calibrated on the old bones). Files: new
   _harness/rigcheck.py + _harness/common.py. Reference: dyefield/_harness/padcheck.py:12-17 (RENDERED geometry vs expected, numeric bands,
   exit 0/1/2 at :24). Verify: run on the current build -> PASS with the E5 numbers; then on a scratch copy with the player.js:439 regex reverted
   to `/^RightHand$/` -> FAIL "holder parent is not the hand bone" for 50/50 actors (browser required; stepped frames, not rAF).
2. HIGH - No portal pointer-lock gate (G4 portalcheck.py). A regression = no mouse-look for every portal player (the flagship is unplayable
   where it is published), and local dev cannot see it (same-origin frames lock without the token, GAME_DOCTRINE.md:260-266). The existing
   _harness/bridge_host.html:26 iframes `'../index.html'` SAME-origin with NO sandbox, so it can never catch it. Files: new _harness/portalcheck.py
   (+ reuse bridge_host.html's reply logic). Verify: headed run PASSES with GamePlayer.tsx:177's string; FAILS with a copy of that string minus
   `allow-pointer-lock` (console "Blocked pointer lock").
3. MEDIUM - No boot/error gate + no shared collector (G0 common.py, G1 bootcheck.py). The existing scripts collect only `pageerror`
   (botcheck.py:85) or nothing (botdiag.py, stuckdiag.py) and hard-code port 8788. The 9 m stretch hid behind 404'd clips (added aebe7736 2026-08-04; the
   stretch surfaced only once the CDN sync made them load, fixed 62765464 2026-08-05): a failed-request gate is the earliest possible catch. Also: environment failures (E1 connection refused, E2 rAF starvation) must exit 2,
   not 1. Reference: dyefield/_harness/common.py (INIT_JS :82, shader split :827-829, diag_problems :863), bootcheck.py:22-33.
4. MEDIUM - No audio gate (G3 audio block). The 7-reports-per-shot bug shipped for ~7 weeks (samples added e5549195 2026-07-27, fixed c663ddf3 2026-09-15); the shipped files STILL contain the bursts (E5:
   inFile=7 / inFile=4) and only the runtime slice protects players, so a refactor of sample()/oneShotSlice() would silently bring it back.
   Reference: dyefield/_harness/playtest.py:25-29 (audio after countdown: context running, >= 1 world sfx, 0 decode errors, clipping master)
   and probe_audio.ts (asset-level). Files: _harness/playtest.py (+ common.py recorder). Verify: E5 numbers PASS; forcing `sfxSlice = {}`
   in a scratch copy -> FAIL "played window holds 7 reports".
5. MEDIUM - No camera / look gate (G3 camera block). Camera drift shipped (5adf16f4); it lived in the human-input kernel updater
   (installHumanInput's W.kernel.onUpdate), which fastForward (ffg_royale3d.js:626-635) never calls, and it needed a real cursor position
   (W.mouseNDC), so no existing test path could see it. E5 measured 0.0000 deg over 90 frames but without a parked cursor (not yet
   discriminating; see §6 E7 for the parked-cursor run). Files: _harness/playtest.py.
6. MEDIUM (cross-lane) - Portrait fit is dead in a match (E6): 28 deg horizontal view on a portrait phone. Gate: a portrait case in a
   layoutcheck/mobile adaptation (dyefield/_harness/layoutcheck.py, mobile.py). Runtime fix belongs to the mobile lane (player.js:1905 or
   ffg_kernel_3d.js applyCameraFit).
7. LOW (internal, but it blinds gate 3) - rig_pipeline.js audit is 100 % false positive after the Mixamo re-rig (E3): 50 `[rig]` warnings +
   5 contract failures per match. Runtime file owned by the characters/rig lane: runtime/3d/royale/rig_pipeline.js:36-58.
8. NONE (infrastructure) - View code cannot be stepped without rAF (E2): add `__LC__.stepFrames(n, dt, render)` next to fastForward in
   runtime/3d/ffg_royale3d.js (the harness can do it via W.kernel today; the hook makes it a contract). Files: ffg_royale3d.js (controller only).
9. LOW - Perf gate absent (G5, information only per owner rule). Reference: dyefield/_harness/perfcheck.py:9-26, blocktooth/_harness/perfcheck.py:2-16.
   Files: _harness/perfcheck.py. Depends on the frame-pipeline lane for frameprof marks; draw calls can be read from W.kernel.renderer.info today.
10. LOW - botcheck/botdiag/stuckdiag are measurements with no thresholds and no exit codes; they cannot be gates until the bots lane seeds
   bots.js's Math.random (determinism). Files: _harness/botcheck.py (thresholds + exit code) after the bots lane lands.

## 8. Out-of-scope observations (named, not fixed)
- pipeline/deploy_game.py runs no gate before upload (its only subprocesses: wrangler at :259, deploy_portal.py at :506). A per-game
  _harness/gate.py (G6) is the in-lane mitigation; wiring gates into deploy is a pipeline decision for the owner.
- The in-flight index.html edit rewrote PROSE too: index.html:13, :25, :56, :69 now read `ffg_boot3d.js?v=1789530264` inside comments
  (git diff shows each comment line changed). Harmless at runtime; the next search-and-replace bump will keep touching comments.
- audio.js:95-99 comment says "Three of the thirteen ... three-round BURSTS"; commit c663ddf3 measured four files with 7/4/4/7 reports, and E5
  observed 7- and 4-report files. Stale comment only.
- stepview.json (standard, seed 7): 14 of 37 alive actors were swimming 43.7 s into the match. For the bots-match lane to judge (drop targets).

## 6b. Discriminating runs (driftpark.json, anglecheck.partial.json - practice mode, stepped frames, REAL input)

### E7. Camera drift with the REAL cursor parked hard off-centre: PASS, and the check is discriminating (VERIFIED)
driftpark.py: page.mouse.move(1216, 72) -> `ndc: {'x': 0.9, 'y': 0.8}`, pointer NOT locked, player alive, phase 'match', then 60 stepped frames:
`dYawDeg: 0.0, dPitchDeg: 0.0, dInputYaw: 0`. The removed block (git show 5adf16f4) would have produced
`wantYawR = -shape(0.9) * 3.2` rad/s (shape(0.9) = 0.99), about -3.2 rad/s = roughly 360 deg over those 2 s - so this exact check separates the
old build from the current one by four orders of magnitude.

### E8. rigcheck (b) flips on a simulated invisible-gun regression (VERIFIED, page-side only; nothing on disk touched)
driftpark.py re-parented the player's weapon holder in the test page to the old fallback socket (the player.js else-branch
`a.hand.position.set(0.32, 1.15, 0.28); a.obj.add(a.hand);` that 3e1bbc34's regex bug routed every weapon into):
before `{'parent': 'mixamorigRightHand', 'parentIsHandBone': True, 'holderToHand': 0.02, 'verdict': 'PASS'}`,
after `{'parent': 'actor_s0', 'parentIsHandBone': False, 'holderToHand': 0.617, 'verdict': 'FAIL'}`.

### E9. Barrel vs chest under REAL movement keys (anglecheck.partial.json; chest forward = up x (RightArm - LeftArm), world space)
| slot / keys | firing | weapon | armMode | barrel . chest (horizontal) | barrel . camera (3D) | chest . camera | own shots |
|---|---|---|---|---|---|---|---|
| 1 / W | no | pistol | lowReady | 0.950 | 0.862 | 0.930 | - |
| 1 / W | LMB | pistol | lowReady | 0.988 | 0.862 | 0.978 | 0 (first click after a cursor release is swallowed by design, hud.js:112) |
| 1 / D | no | pistol | lowReady | 0.609 | 0.460 | -0.353 | - |
| 1 / D | LMB | pistol | gunReady | 0.640 | 0.990 | 0.523 | 1 |
| 1 / S | no | pistol | gunReady | 0.951 | 0.998 | 0.931 | - |
| 1 / S | LMB | pistol | gunReady | 0.827 | 0.998 | 0.793 | 1 |
| 1 / S+A | no | pistol | gunReady | 0.944 | 0.998 | 0.921 | - |
| 1 / S+A | LMB | pistol | gunReady | 0.971 | 0.998 | 0.985 | 1 |
| 2 / W | no | ar | (stale label, see 4) | 0.810 | 0.998 | 0.775 | - |
| 2 / W | LMB | ar | (stale) | 0.709 | 0.998 | 0.667 | 1 |
| 2 / D | no | ar | (stale) | 0.749 | 0.999 | 0.718 | - |
| 2 / D | LMB | ar | (stale) | 0.790 | 0.999 | 0.761 | 1 |
Readings: (1) barrel . camera 0.862 = cos 30 deg is the lowReady carry's intended -0.55 rad muzzle drop (player.js:1578 `const bpitch = (!mixamoAim && a._armMode === "lowReady") ? -0.55 : a.pitch;`),
so the "while firing" assertion must be taken in gunReady, where it reads 0.990 (8 deg). (2) Strafing right out of combat the pistol points
52 deg (0.609) off the shoulder-line forward. Static reading of why: the weld aims along `bodyFwdYaw + twist` with twist clamped to 0.6 rad
(player.js:1529 `const twist = K.clamp(aimDelta, -0.6, 0.6);`), but the spine twist that should carry the chest with it is applied only when
`useMixamoGun` (player.js:1530 `if (a.armBones && useMixamoGun && armed && a.onGround ...`), and pistols do not load Mixamo gun clips
(player.js:194-196 "fall + pistol_* clips deliberately NOT loaded ... pistols use the procedural pose system"). So for pistols the barrel follows a
twisted chest that is not twisted. PLAUSIBLE (one sample, not yet confirmed by a screenshot); owner lane = characters/rig (player.js), not this lane.
(3) After the first shot the player stayed in combat (gunReady) for the S and S+A samples, so the out-of-combat backward run - the exact
a8b96f16 case - was NOT sampled here: G2 must run the 8 offsets out of combat FIRST (combat = `a.input.ads || (W.t - a.lastShotT < 1.5)`, player.js:1387, so wait >= 1.5 s of sim time
after any shot), then the firing pass.
In combat every sample kept barrel . camera >= 0.990 (<= 8 deg) and barrel . chest >= 0.827.
(4) Rifles (Mixamo gun clips) keep barrel . camera >= 0.998 in every sample but sit 35-45 deg off the shoulder-line forward (0.709-0.810) - a
bladed rifle stance turns the shoulders, so the shoulder line is NOT the barrel direction for long guns; and `a._armMode` is sticky
(player.js:1544 `if (mode) a._armMode = mode;` while Mixamo guns set mode = null), so it read the pistol's 'gunReady' on the rifle. The gate must
key states off the weld's own predicates (combat, useMixamoGun, onGround) rather than `_armMode`. This also weakens reading (2): the pistol's
52 deg may partly be stance, so it stays PLAUSIBLE until a side-view screenshot settles it.
Consequence for the gate: the barrel-vs-chest threshold has to be derived from the design (twist clamp 34 deg + clip sway), calibrated on
screenshots once, and printed per skin/weapon/offset - G2 (c) at cos 45 deg would FAIL this sample today.

### E10. What G1's collector would report on today's build (probe3.json desktop console, one standard match load, disk-served)
241 console lines: 0 errors, 0 page errors, 0 window errors; 55 `[rig]` warnings (50 "attachment issues" = every actor, 5 "FAILS the
skeleton contract" = every skin, see E3); 186 `THREE.PropertyBinding: No target node found for track: mixamorig...Hand{Middle,Ring,Pinky}{1,2,3}.quaternion`.
Failed requests: 5 `net::ERR_ABORTED` on GLBs (e.g. soldier_rifle_idle.glb, wpn_smg.glb) and 0 HTTP >= 400. DYEFIELD's collector deliberately skips
ERR_ABORTED (dyefield/_harness/common.py:572 `if f and "ERR_ABORTED" in str(f): return`) - LC's G0 should copy that rule and gate on HTTP >= 400
and real network failures only. So G1 would PASS on errors today and FAIL on `[rig]` warnings until rig_pipeline.js is fixed (or allow-listed with
an expiry) - which is the correct outcome: the audit is the regression tripwire for the invisible-gun class.

## 9. Run notes (fidelity)
- anglecheck.py was STOPPED by me after 12 of its 16 rows (slot 2 S and S+A not sampled) to free the shared box; its rows are in
  scratch/hg/anglecheck.final_partial.json. No orphaned Playwright driver of mine remained (the 8 live drivers all have live parents in other sessions).
- Machine contention this session: 8 other automated Chromes; practice-match load took 74-800 s, a standard match 320-440 s, and one stepped
  view frame cost ~2-5 s wall. None of these are Last Circle performance numbers.
- Not run: any headed / pointer-lock test (a headed Chrome steals OS focus from the user's session), any test on the live portal or CDN,
  bootguard-style fault injection (covered by the boot-robustness lane), perf measurement (contaminated box; informational anyway).
