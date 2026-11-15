# Lane: feel-juice-ui — Last Circle vs DYEFIELD / BLOCKTOOTH

Status: COMPLETE (15 gaps, G1-G15; ranked by first-60-seconds player feel). Evidence PNG/JSON in scratch/fju/.
Scope: hit feedback, screen shake, hitstop, damage numbers, kill confirmation, camera kick, menu
transitions, loading card, settings, audio mixing / voice caps. READ-ONLY audit; no repo file changed.

## Method (what was actually run)
- Static read: `runtime/3d/royale/{fx,audio,hud,weapons}.js`, `runtime/3d/ffg_royale3d.js`,
  `runtime/3d/royale/player.js` (camera + hurt/kill), `index.html`, `game_controls.js`.
- Reference read: BLOCKTOOTH `src/audio/{audio,sfx}.ts`, `src/render/{fx,camera}.ts`, `src/core/loop.ts`, `src/game.ts`;
  DYEFIELD `runtime/src/ui/{juice,menus,settings,boot}.ts`, `ui/{menus,styles}.css`, `audio/{voices,engine,router}.ts`.
- Real browser: Playwright headless Chromium (ANGLE d3d11) against the running scoped server
  `http://127.0.0.1:8790/games/last-circle/index.html`, driven via `window.__LC__`.
  Scripts + PNGs + probe JSON: `scratch/fju/` (shots.py, shots2.py, shots3.py; probes*.json).
  Screenshot timing note: each headless screenshot costs ~0.5-1 s of wall time on this box, so the
  "t30 / t200 / t800" file names are the WAIT before the capture, not the true age of the frame.
  Where timing matters I used a MutationObserver DOM log (ms-accurate) instead of the picture.
- Test-harness artefacts to ignore: post-match "Damage dealt 0 / Accuracy 100%" in 32_post_match.png
  is because the victory was forced with `W.killActor`; the target bots were pinned with
  `isDummy/netRemote` flags so a hit could be placed on the camera ray.

## Screenshots (scratch/fju/)
| file | what it shows |
|---|---|
| 01_splash.png | index.html splash (system-font wordmark, time-based bar) |
| 02_menu.png / 20_menu_clean.png | first-run HOW TO PLAY modal over menu / menu |
| 21_settings.png | settings modal |
| 04_loading.png | match loading card |
| 05_drop.png | drop: DEPLOY banner painted over the LVL chip + quest card |
| 06_match_hud.png | on the ground, HUD (ammo "16 / 36" under the portal control bar) |
| 40_target.png, zz_40_target.png | pistol reticle at rest (sub-pixel lines, near invisible) |
| 41_hit_t30.png, zz_41_hit_t30.png | pistol hit: "+"-shaped marker, blue "18" shield number over name tag |
| 44_pistol_x4.png | four pistol hits |
| 45_kill_t30.png, 46_kill_t200.png | kill: white "5", death burst; ELIMINATED banner over LVL chip + quest |
| 47/48 | after the kill (banner expired) |
| 10_after_player_hurt.png | death card: nametag + subtitle collide, no backdrop |
| 30_victory_t700ms.png | VICTORY ROYALE banner over LVL chip + quest card |
| 32_post_match.png | post-match card (static) |

## Findings (ranked by what a player feels in the first 60 seconds)

### G1 [HIGH] Damage numbers pile into an unreadable column over the victim's name tag
- Seen: `50_smg_sustained.png` — a 1 s SMG burst stacks "18 20 22 21 22 19 2" on top of the nameplate
  "ZeroBuildZoe"; neither the numbers nor the name can be read. Probe (probes4.json): 30 damage numbers
  created for 30 SMG hits in 3.7 s of play, 4 still alive at the end of the burst.
- Code: fx.js:391 `const el = document.createElement("div");` and fx.js:399 `dmgLayer.appendChild(el);`
  (one new DOM node per hit, no pool, no cap). fx.js:475 `dmgNumber(W, victim.pos.x + ...` always passes
  scale 1, so a 105 sniper body shot is the same 26 px as an 18 pistol chip (fx.js:395
  `fontSize: Math.round(26 * (scale || 1)) + "px"`). Spawn height `victim.pos.y + 2.1` = the name-tag height.
  fx.js:564 `const w2 = rect.clientWidth, h2 = rect.clientHeight;` is a per-frame layout read.
- Reference: DYEFIELD shows NO per-hit numbers — it tiers the marker instead
  (`juice.ts:111 const TIERS = [` chip < 20 / solid < 45 / heavy >= 45, a scale per tier);
  BLOCKTOOTH's floating words are a fixed pool with a live cap (`render/fx.ts:44 const CAP_WORDS = [3, 4, 5]`).
- Fix (fx.js only): one ACCUMULATING number per victim: while a victim keeps taking your damage inside
  ~0.8 s the same node re-pops and its value grows (18 -> 38 -> 60 ...), then floats off; a pool of ~12
  nodes built at init; size by damage tier (+ bigger/red for the killing blow, yellow for head); spawn beside
  the tag (screen-right offset, ~1.7 m) not on it; canvas size from a ResizeObserver, not clientWidth per frame.
- Verify (REAL BROWSER — Node never runs fx.js): SMG burst on a pinned target via __LC__: at most 1 live
  number per victim, createElement count flat after warm-up, screenshot shows a legible number clear of the tag.

### G2 [HIGH] The kill-confirm marker never shows; the hit marker is a "+" that looks like the reticle
- Kill confirm overwritten. weapons.js:724 `W.hurtActor(t, dmg, p.ownerId, p.weaponId, isHead);` kills and
  emits actorDied -> hud.js:2704 `R.hitmark.style.color = "#ff4d4d";` (40 px, 280 ms); THEN weapons.js:728
  `if (owner) W.events.emit("hitMarker", owner, t, dmg, isHead);` -> the hitMarker handler resets it to white
  26 px with hud.js:2672 `R._hitT = setTimeout(() => { if (R.hitmark) R.hitmark.style.opacity = "0"; }, isHead ? 170 : 120);`
  (the actorDied handler even clears `R._hitHeadUntil = 0`, so nothing blocks the overwrite).
  Measured (probes3.json, MutationObserver): on the killing pistol shot the marker's final state was
  `rgb(255, 255, 255)` / `26px`, hidden 113 ms later. The red kill X was never painted.
- Shape: hud.js:1814 `transform: "translate(-50%,-50%) rotate(45deg)" ... "✕"`. A ✕ rotated 45° is an upright
  "+", the same shape as the pistol/SMG reticle (`cross4`). `zz_41_hit_t30.png` shows it reading as the
  reticle flashing. No pop/scale; one colour for every body hit.
- Reference: DYEFIELD juice.ts draws four ticks at 45/135/225/315° (CSS `.dfj-mark i:nth-child(1) { transform:
  rotate(45deg) translateY(-20px); }`), pops scale over 90 ms (juice.ts:479 `const pop = this.reduce ? 0 :
  Math.max(0, 1 - this.markT / 0.09);`), tiers colour by damage (juice.ts:111), and a kill LATCHES
  (`this.markKill = kill || (live && this.markKill)`) with a ring pop and juice.ts:117 `const KILL_LIFE = 0.5;`.
- Fix (hud.js only): 4 CSS ticks on the diagonals + a ring element; a kill latch later hitMarker events cannot
  downgrade inside 0.5 s; pop scale on every hit; colour tiers (shield blue / body white / head yellow / kill red + ring).
- Verify (REAL BROWSER): pistol kill on a pinned bot: the MutationObserver's LAST marker state is the kill
  style and opacity stays 1 for >= 250 ms; screenshot at the kill shows diagonal ticks + ring.

### G3 [HIGH] Pistol/SMG reticle is sub-pixel at rest (practically invisible)
- Measured (probes3.json): reticle box 26x26 px, `transform: translate(-50%, -50%) scale(0.45725)`; pistol
  arms are `cross4(5, 8, 2)` (2 px thick, 8 px long) so on screen ~0.9 px thick and ~3.7 px long.
  `zz_40_target.png` (4x zoom): the reticle is almost impossible to find on the target.
- Code: hud.js:2318 `const bloom = Math.max(0.4, Math.min(3.2, 0.35 + spreadNow * 0.55));` and hud.js:2321
  `R.cross.style.transform = \`translate(-50%,-50%) scale(${bloom})\`` scale the WHOLE element, stroke included.
- Reference: DYEFIELD reticle is a fixed 34 px SVG (styles.css:145 `.df-ret { position: absolute; left: 50%;
  top: 50%; width: 34px; height: 34px; ...`); state changes colour/opacity, never shrinks the stroke.
- Fix (hud.js only; reticle stays pinned centre as signed off): bloom moves the arms outward (gap = base +
  spread) with fixed 2 px thickness and >= 6 px length.
- Verify (REAL BROWSER): each arm's getBoundingClientRect at rest / crouched-still / sprinting: thickness
  >= 2 px, length >= 6 px; screenshots on bright and dark ground.

### G4 [HIGH] Big announcements (DEPLOY / ELIMINATED / VICTORY / LEVEL) paint over the LVL chip and quest card
- Seen: `05_drop.png` (DEPLOY over "LVL 1" and "Reach the final 5"), `46_kill_t200.png` (ELIMINATED
  STORMSURFERSAM over both), `30_victory_t700ms.png` (victory title + LAST ONE STANDING + CHALLENGE COMPLETE
  over both). First thing on screen in every match and on every kill.
- Code: hud.js:1927 `R.annWrap = h("div", { position: "absolute", left: "50%", top: "14%", ...`; at 720p 14%
  = 101 px, exactly the LVL chip row (y ~95-118) with the quest card below it (to y ~168). Same collision for
  the damage/gunfire ring: hud.js:2368 `const RAD = Math.min(wpx, hpx) * 0.36;` puts an indicator straight
  ahead at y = 360 - 259 = 101 px, on the LVL chip (red diamond in `10_after_player_hurt.png`).
- Reference: DYEFIELD _harness/layoutcheck.py gates this defect class ("overlap ... the HUD blocks do not
  overlap one another"); BLOCKTOOTH fx.ts places set-piece words in bands below the nameplate
  (`const GATE_STAGGER_BAND: WordBand = { topMin: 0.22, centerMax: 1 / 3 };`).
- Fix (hud.js only; the signed-off top stack does not move): start the announcement band below the quest
  card's measured bottom (+12 px) instead of a fixed 14%, re-space stormMsg (22%) / pickupMsg (27.5%) under
  it, and keep the indicator ring's top arc below that line (ellipse, or RAD derived from the band).
- Verify (REAL BROWSER): at 1280x720 and 1920x1080 fire DEPLOY / ELIM / VICTORY and assert the annWrap rect
  does not intersect the LVL-chip or quest-card rects; screenshots.

### G5 [HIGH] Ammo counter sits under the portal's fullscreen/mute/pause bar
- Seen in every match screenshot (`06_match_hud.png` "16 / 36", `50_smg_sustained.png` "0 / 999").
- Code: hud.js:1760 `const br = h("div", { position: "absolute", right: "18px", bottom: "16px", ...` holding
  hud.js:1762 `R.ammoText`; game_controls.js:306 `"position:fixed", "bottom:8px", "right:8px",
  "z-index:2147483600",` paints on top. game_controls.js:955 already documents the rule for its own buttons:
  "bottom:54px — the control bar occupies roughly y 8..42. Never overlap it."
- Reference: DYEFIELD layoutcheck.py clip/overlap checks every HUD block against every control.
- Fix (hud.js only): lift the slot/ammo column to bottom >= 54 px (or move the count left of the slots).
- Verify (REAL BROWSER): ammoText rect does not intersect `#__ff_controls__` at 1280x720 / 1366x768 / 1920x1080.

### G6 [MEDIUM] Menu wordmark cut off on common laptop viewports; operative preview starts T-posed / empty
- Measured (probes5.json): the 72 px "LAST CIRCLE" title's top is at -57 px on 1280x720 and -33 px on
  1366x768 (fine at 1920x1080: top 123). `20_menu_clean.png`, `60_menu_1366x768_t1.png`: only the lower half
  of the letters shows, under the top bar; the RETICLE swatches are cut at the bottom edge too.
- Code: hud.js:625-627 `const wrap = h("div", { position: "absolute", inset: "0", display: "flex",
  flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "64px 24px 40px",`
  (a centred column taller than the viewport overflows BOTH ends); hud.js:633 sizes the title by width only
  (`fontSize: "clamp(42px, 7vw, 72px)"`).
- Preview: `20_menu_clean.png` (~2.5 s after menu) shows SGT. BRICK in a T-pose, `60_menu_1366x768_t1.png`
  shows an empty preview; by `60_menu_1280x720_t9.png` he dances. hud.js:1005 loads rifle_idle / cheer / dance
  as three awaited GLB fetches before anything but `rig.animations[0]` plays.
- Reference: DYEFIELD layoutcheck.py ("scroll: the page never scrolls ... long panels scroll inside
  themselves"; "title: the DYEFIELD wordmark is not covered") at every viewport.
- Fix (hud.js showMenu only): title `min(7vw, 9vh)`; a max-height rule that tightens gaps / drops the
  tagline; flex-start + overflow-y:auto when content > viewport; keep the preview hidden (or neutral idle)
  until the first menu clip resolves.
- Verify (REAL BROWSER): wordmark rect fully inside the viewport and below the top bar at the 3 viewports;
  preview at t = 1 s is not a bind pose.

### G7 [MEDIUM] Death card collides with the world and repeats itself
- Seen: `10_after_player_hurt.png`: the floating name tag "OneShotOna" is painted through the subtitle
  "#45 of 50 · by CraftyKat (Assault Rifle)"; "Spectating CraftyKat" / "A / D — watch someone else" sit on
  bare world; the bottom bar repeats "SPECTATING CRAFTYKAT · 44 ALIVE · [A] / [D] TO SWITCH".
- Code: hud.js:2938 `const box = h("div", { position: "absolute", top: "26%", left: "50%", transform:
  "translateX(-50%)", textAlign: "center" }, null, L);` (no panel; only the recap grid has a background).
- Reference: DYEFIELD's end slates are cards (menus.css `.df-tally`), and its confetti is clipped around the
  card ("never drawn over the victory card", juice.ts header).
- Fix (hud.js only): wrap title + subtitle + recap + button in the existing PANEL style; drop the duplicate
  in-card spectate line.
- Verify (REAL BROWSER): die to a bot at 5-10 m; screenshot legible; no world name tag reads through the card.

### G8 [MEDIUM] Shield break has no visual beat
- `grep -n "\.broke" fx.js hud.js audio.js` -> only audio.js:645 `if (info.broke) blip(1800, 0.25, 0.2,
  "sawtooth", ...)`. fx.js/hud.js never read `info.broke`; probes3.json: the breaking hit
  `{"dmg": 21, "toShield": 14, "broke": true}` drew the same blue "21" as any shield hit.
- Reference: DYEFIELD gives its big hit one special beat ("a wash adds a longer X + a ring pop", juice.ts header).
- Fix (fx.js + hud.js): a shield-blue shard burst at the chest from the existing fx pool, a one-off blue ring
  on the hit marker, and the number for that hit in a "BROKEN" style.
- Verify (REAL BROWSER): shoot a 50-shield pinned target until broke=true; the burst + ring appear on that hit only.

### G9 [MEDIUM-LOW] Music pumps on every one of your own shots
- Code: audio.js:594 `if (own) duckMusic();` -> audio.js:320 `musicDuck.gain.setTargetAtTime(0.62, t, 0.02);`
  then release. Measured (probes4.json): 30 duck calls in a 3.7 s SMG burst (one per round): the score dips
  ~-4 dB about 8 times a second while the trigger is held.
- Reference: BLOCKTOOTH sfx.ts:309-310 "ONLY the big stings pull the band down ... ordinary combat voices never
  duck (the busy-play balance is the bus levels, not a pumping side-chain)".
- Fix (audio.js only): duck once per engagement (hold while you fired in the last ~0.6 s, then release),
  shallower (~-2 dB); keep the explosion duck.
- Verify (REAL BROWSER): the same SMG burst yields <= 2 duck ramps; listen-check that the music stops pulsing.

### G10 [LOW] No SFX voice limiter / per-frame audio budget
- Code: every positional sound builds fresh nodes: audio.js:412-413 `const p = ctx.createPanner();
  p.panningModel = "HRTF";` plus BufferSource + Gain (+ Biquad for range). Only two cues are rate-limited:
  audio.js:701 `ctx.currentTime - lastImpactT < 0.035` and audio.js:719 `ctx.currentTime - lastWhizT < 0.06`.
  `grep -n "MAX_VOICES\|VoicePool" audio.js` -> no hits.
- Measured (probes2.json, 180 s of a live 50-player match via fastForward): 80 bot gunshots inside audible
  radius (0.44/s), peak 5 overlapping in a 0.5 s window, 35 nearby footsteps. It does NOT bite in the first
  minute; it is a worst-case guard (final circle, launcher splash, 9-pellet shotguns).
- Reference: BLOCKTOOTH audio.ts:31 `export const MAX_VOICES = 24;`, sfx.ts:322 `const FRAME_BUDGET = 4;`,
  sfx.ts:324 `const LOW_RATE = 40, LOW_BURST = 10;`, sfx.ts:460 steal-lowest-priority; DYEFIELD
  audio/voices.ts:17 `export class VoicePool` (score = priority + audible gain), engine.ts:30
  `const LOOP_CAP = 12;`, and _harness/probe_audio.ts asserting "the voice limit holds".
- Fix (audio.js only): a small pure VoicePool (own gun / hitmarker / kill > enemy gun > footsteps > impacts),
  cap ~24, steal lowest-score oldest.
- Verify: Node selftest for the pure pool policy PLUS a real-browser spy (wrap createBufferSource + 'ended')
  showing live sources <= cap during a scripted 10-bot firefight around the player.

### G11 [LOW] Screen changes are hard cuts; kill-feed rows pop in and vanish
- Code: hud.js:115-116 `function layer(name, styles) { if (R[name]) { clear(R[name]); R[name].remove(); }`
  (menu -> loading -> lobby -> HUD each replace the previous layer in one frame); hud.js:1229
  `L.remove(); R.lobby = null;`; feed rows hud.js:2714 `setTimeout(() => el.remove(), 6000);` (no animation).
- Reference: DYEFIELD styles.css:51 `.df-hud { position: absolute; inset: 0; opacity: 0; transition: opacity
  .25s ease; }`; styles.css:115 feed rows `animation: dfFeedIn .22s ease-out; transition: opacity .8s ease;`.
- Fix (hud.js only): 150-250 ms opacity fade on layer swaps; feed rows slide in and fade out.
- Verify (REAL BROWSER): sample both layers' opacity across a swap; a feed row has a non-zero animation duration.

### G12 [LOW] Settings: FOV reads "20%"; screen shake ignores the OS reduced-motion setting
- `21_settings.png`: "Field of view 20%" for the 57° default. hud.js:3325 feeds `(fov - 50) / 35` to the shared
  slider whose label is hud.js:3502 `Math.round(val * 100) + "%"`.
- `grep -rn "prefers-reduced-motion" runtime game_controls.js` -> 0 hits; ffg_royale3d.js loadSettings default
  `shake: 1`. Reference: DYEFIELD juice.ts:253 `this.reduce = o.reduceMotion ?? prefersReducedMotion();`.
- Fix: hud.js per-slider formatter (FOV in degrees); ffg_royale3d.js loadSettings: default shake to 0.5 when
  `(prefers-reduced-motion: reduce)` matches and nothing is stored.
- Verify (REAL BROWSER): settings shows "57°"; with Playwright reduced_motion="reduce" + clean storage the
  Screen shake row starts on HALF.

### G13 [LOW] Post-match card is static
- `32_post_match.png`: every stat is printed at once; no count-up, no stamp on the placement.
- Reference: DYEFIELD menus.css:333 `.df-tally .row { ... transition: transform .25s cubic-bezier(.2,1.6,.4,1); }`,
  menus.css:352 `@keyframes dfStamp { 0% { opacity: 0; transform: scale(2.6) rotate(-18deg); } ...`.
- Fix (hud.js showPostMatch only): stagger rows in, count XP up, stamp "#1 OF 50".
- Verify (REAL BROWSER): screenshots 0.2 s and 1.5 s after open differ; final values equal today's.

### G14 [LOW] Hitstop freezes the camera and HUD, not just the sim
- Code: ffg_royale3d.js:580-582 `if (W.hitstopT > 0) { W.hitstopT = Math.max(0, W.hitstopT - dt); if (!W.net)
  step *= 0.12;` and the scaled step then feeds every module incl. playerMod.update (camera), fxMod, hudMod.
- Reference: BLOCKTOOTH core/loop.ts:16 "timeScale scales SIM time only (hit-stop / slow-mo). Rendering always runs".
- Fix (ffg_royale3d.js frame pipeline): scaled step for bots/weapons/loot/storm; real dt for fx/hud and the
  camera part of player.update.
- Verify (REAL BROWSER): during a kill hitstop the damage number and camera shake keep real-time motion.

### G15 [NONE-LOW, internal] No feel read-back or feel/layout harness; per-shot allocations
- LC `_harness/` holds only botcheck.py, botdiag.py, stuckdiag.py, bridge_host.html; `grep -rn readback`
  over runtime/ and _harness/ -> 0 hits. G2's overwrite is exactly what a read-back gate would catch.
  Hot-path allocations: fx.js:65 `const c = new THREE.Color(o.color != null ? o.color : 0xffcc66);` on every
  particle spawn, fx.js:247 `dir: new THREE.Vector3(dx, dy, dz), stretch: len,` on every tracer (49 bots fire
  through the same global event); per-frame layout reads fx.js:564 and hud.js:2367.
- Reference: DYEFIELD juice.ts `readback(): JuiceReadback;`, _harness/playtest.py:1014 `jb = dfd(sess, "juice")`,
  _harness/layoutcheck.py, _harness/probe_audio.ts.
- Fix: `__LC__.feel()` read-back (marker last state, live damage numbers, shake, duck count, live voices) +
  `_harness/feelcheck.py` (pinned-bot hit / kill / SMG, from scratch/fju/shots3.py + shots4.py) +
  `_harness/layoutcheck.py` (the rect checks of G4 / G5 / G6). One cached Color scratch + a per-slot dir
  vector in fx.js.
- Verify: the new harness FAILS on today's build for G2 / G4 / G5 / G6 and passes after those fixes.

## What already meets the bar (do not redo)
- Camera kick per weapon + FOV punch, player-only gating, decay tuned below fire interval (fx.js SHOT_SHAKE /
  SHOT_FOV; player.js updateCamera, incl. coherent sine shake + roll and the Screen shake OFF/HALF/FULL setting).
- Headshot: yellow number, larger marker, 30 ms hitstop, higher ping (fx.js:311, hud.js hitMarker, audio.js:683).
- Hurt vignette scaled by damage, low-HP tint, damage direction ring, gunfire/footstep indicators.
- Shader prewarm before play (fx.js prewarm + compileAsync in startMatch); honest loading bar (W.loadProgress).
- Audio: recorded gunshots with range lowpass, HRTF, -6 dBFS limiter, storm bed, ambience, room tone,
  endgame music thinning, per-class audible radius. The mix itself is in good shape; G9/G10 are the gaps.

## Out-of-lane notes (named, not audited)
- Trademark: hud.js:2989 and hud.js:3012 print "VICTORY ROYALE", Epic Games' Fortnite phrase; the subtitle
  "LAST ONE STANDING" could be promoted to the title.
- No gamepad support: `grep -rln getGamepads runtime game_controls.js` -> no files (DYEFIELD ships padcheck.py).
- Menu operative preview runs its own WebGLRenderer + rAF (hud.js pvLoop `pvR.render(pvScene, pvCam)`): a
  second GL context on the menu (perf lane).
- Console on every boot: "[rig] soldier FAILS the skeleton contract — missing: [Hips, ...]" for 5 skins
  (probes.json errors). In-match poses looked fine in screenshots (rig lane).
- Test run 1 (probes.json): after 865 s of fastForward the storm read CLOSED with 2 actors still alive and
  the match not over (loop cap hit). Not investigated here; gameplay lane may want to check endgame closure.

## File map for the fixes (keeps lanes file-disjoint)
- fx.js: G1, G8 (particles), G15 (allocations)
- hud.js: G2, G3, G4, G5, G6, G7, G8 (marker ring), G11, G12 (label), G13
- audio.js: G9, G10
- ffg_royale3d.js: G12 (default), G14
- _harness/ (new files): G15
