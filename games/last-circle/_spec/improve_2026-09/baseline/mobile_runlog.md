# Last Circle — MOBILE lane audit (vs DYEFIELD CONTRACT_MOBILE)

Status: IN PROGRESS (written early; appended as evidence lands). Read-only audit, no repo files modified.

## Static findings so far

1. Touch layer EXISTS but is the generic page-level one. game_controls.js:810 `"last-circle": "shooter",` ->
   game_controls.js:752-753 `shooter: { stick: "wasd", look: true, buttons: [B("FIRE", "Mouse0"), B("JUMP", "Space"), B("RELOAD", "KeyR")] },`
   It synthesizes KeyboardEvents + mouse/pointer events (game_controls.js:73-79). No LOOT(E), SPRINT(Shift), ADS(RMB),
   weapon switch (1-5/wheel), MAP(M), crouch(C), drop(Q).
2. LOOK is dead without pointer lock: player.js:847-848
   `const locked = document.pointerLockElement === dom;` / `if (!locked && !rmbDrag) return;`
   The look zone only emits synthetic mousemove (game_controls.js:1109), and mobile browsers have no pointer lock.
3. Two "desktop only" gates stack in front of a phone player:
   ffg_boot3d.js:51 card "LAST CIRCLE IS DESKTOP-ONLY ... PLAY ANYWAY" (gated at ffg_boot3d.js:104-110), then
   hud.js:825-837 modal "KEYBOARD + MOUSE REQUIRED ... CONTINUE ANYWAY". Both comments claim no touch handler exists
   (ffg_boot3d.js:40-41, hud.js:816-820) — stale since game_controls.js v3 (2026-09-15) added one.
4. index.html:3 viewport is `width=device-width, initial-scale=1.0` — no viewport-fit=cover, no interactive-widget,
   no manifest, no apple-mobile-web-app tags, no 100dvh (index.html:5 uses height:100%).

(browser evidence pending)

## Browser evidence (Playwright, Chrome, Pixel 7 landscape 915x412 DPR 2.625, is_mobile + has_touch, real CDP touches)
Box is SHARED and heavily loaded during this run (tasklist: 112 chrome.exe, 39 python.exe). Screenshots often time out
(>25 s for a compositor frame after the 3D menu starts) — timing numbers are information only.

- media: coarse=true, fine=false, anyFine=false, maxTouchPoints=1; viewport meta 'width=device-width, initial-scale=1.0';
  no manifest; no apple-mobile-web-app-capable.
- Boot: DESKTOP-ONLY card shown (shot lc_pixel7_01_boot.png). The generic touch overlay IS mounted at the same time
  (profile 'shooter', html 'ffg-touch ffg-mobile ffg-landscape'): LOOK zone [366,0,915,412] (right 60%), stick
  [20,252,160,392], FIRE [837,292,903,358], JUMP [761,292,827,358], RELOAD [837,216,903,282], control bar
  (Fullscreen/Mute/Pause 26x26 px buttons) [811,370,907,404]. So the card says "no touch controls" while touch
  controls are drawn over it.
- PLAY ANYWAY sits INSIDE the look zone. A tap there is swallowed by the look zone (touchstart preventDefault) and
  replayed as a synthetic click only if <400 ms and <8 px (game_controls.js:1114 `const wasTap = !touch.lookMoved && (Date.now() - touch.lookStartT) < 400;`).
  Idle page: 1 tap works (event log: pointerdown/touchstart on .ffgt-look, then synthetic S pointerdown..click on BUTTON).
  Loaded page: run 2 needed 2 taps; run 3 the CONTINUE ANYWAY tap did NOT dismiss the kbm modal (shot lc_pixel7_05_lobby.png
  still shows it). Every menu button in the right 60% of the screen depends on this replay.
- First-run menu: KEYBOARD + MOUSE REQUIRED modal (zIndex 71) over HOW TO PLAY (zIndex 70). HOW TO PLAY's only exit,
  GOT IT, measured at [389,430,526,475] on a 412 px-tall viewport = BELOW THE SCREEN. hud.js:3172
  `const box = h("div", Object.assign({ padding: "26px 34px", width: "520px", display: "flex", ... }, PANEL), null, L);`
  has no maxHeight/overflow (compare CAREER hud.js:3224 and SETTINGS hud.js:3275 which have `maxHeight: "82vh", overflowY: "auto"`).
  ESC is the only other exit (no key on a phone). => a first-run phone player is STUCK on the tutorial.
- Menu layout: 'LAST CIRCLE' wordmark measured at top -206 (off the top), level/XP strip at -110, daily challenges at -69:
  the menu column is taller than 412 px and centred, so its top is clipped (32 clipped text elements). No @media rule
  anywhere in hud.js (grep '@media' hits only 0 layout rules; only keyframes/hover at hud.js:72-76).

### Probe 2 (lc_input.py, Pixel 7 landscape, frameless: 'tick' = one call of every kernel updater, no draw)
- PLAY ANYWAY: one real tap worked this time (card at [389,245,526,286]).
- First-run modals measured: CONTINUE ANYWAY [345,237,570,283]; HOW TO PLAY 'GOT IT' [389,423,526,468] with H=412 -> FAIL, off-screen.
- CONTINUE ANYWAY: a real tap did NOT dismiss the modal (2nd time observed; both times the page was busy building
  the 3D menu). DOM-clicked for setup.
- Menu layout: 32 clipped text elements (wordmark at y -207..-126, level strip, daily challenges all above the top edge),
  15 tap targets under 44 px, 8 text nodes under 12 px.
- QUICK MATCH card [71,132,496,224]: its centre (283,178) is LEFT of the look zone, so the tap is native -> the
  match flow started (phase 'lobby'). Real taps work outside the look zone.

## Static: why look/aim cannot work, and what else is missing
- Shots always go through SCREEN CENTRE (hud.js:2300-2302 "Reticle pinned to SCREEN CENTER in every mode ... shots aim
  through center (weapons.js crosshairPoint)"). With the camera frozen (player.js:847-848) and no camera auto-follow
  (player.js:871-878 "NO UNCOMMANDED CAMERA MOTION"), a phone player can only shoot wherever the camera happened to face.
- FIRE synthesizes mousedown on the canvas -> player.js:808 `tryLock();` asks for pointer lock on every press
  (DYEFIELD M4: 0 lock requests in touch mode).
- Loot: walkover auto-pickup works (loot.js:692 "walk over items -> auto-pickup whenever there's room") but chests need
  HOLD E for 2 s (loot.js:694, :729 `if (target && target.type === "chest" && a.input.interactDown)`, CHEST_OPEN_S=2.0 at
  loot.js:744) and the HUD prompt reads "[HOLD E] Open chest" (hud.js:2200). There is no E button in the shooter profile.
- Heal / shield: consumables are used by selecting the slot then firing (weapons.js:364-365 "consumable 'weapon' — fire =
  use"); slot select is keys 1-5 / wheel only (player.js:736-740, :854-863). No slot control on touch, HUD slots have no
  click handler (hud.js onclick list: menu/settings/pause/post only). => a phone player can never heal or shield up
  except by the gun-slot being empty.
- Map: minimap is a fixed 180x180 canvas top-left (hud.js:1804-1806) with no click handler; the big map opens on KeyM
  only (player.js:765 `if (e.code === "KeyM") W.events.emit("toggleBigMap");`).
- ADS (RMB), sprint (Shift), crouch (C), drop (Q), emotes: no touch path.
- HUD geometry is fixed px with no @media: slots `right: "18px", bottom: "16px"` (hud.js:1760) under FIRE/JUMP
  (game_controls.js:956 wrap `right:12px;bottom:54px`); HP/shield bars `left: "18px", bottom: "16px", width: "300px"`
  (hud.js:1728) under the stick (game_controls.js:1016-1021, bottom-left, 104-150 px).
- Portrait camera fit (uncommitted ffg_kernel_3d.js) is applied only on resize/start; Last Circle rewrites cam.fov EVERY
  frame at player.js:1905 `cam.fov = W._fovBase + (W.fovPunch || 0) * Math.min(1, W._fovBase / 57);` so the fit is
  overwritten on the next frame in a match (it survives only in the menu, where hud.js:485 sets fov 42 once).
- Portal: "Desktop only" comes from Supabase public.games.mobile_support (src/lib/mobile.ts:4-5,18-21), default
  'none' backfilled by supabase/migrations/0007_games_mobile_support.sql:48 `UPDATE public.games SET mobile_support = 'none' WHERE mobile_support IS NULL;`
  (only cosmic-coils and ascendant set 'full' at :52-53). Rendered at pages/games/@slug/+Page.tsx:104 and
  src/components/game/GameCard.tsx:106, plus "Touch: Not supported — desktop only." at +Page.tsx:144. Live row not
  queried (read-only audit; the registry needs the service key to write anyway).

### Run 1 of lc_input.py stalled in the match (kernel draw loop starving the main thread on the shared box). Run 2 stops
### the draw loop after entering the match (SETUP) and drives frames with tick(). Results appended below when in.
- Run 1 in-match read-back before the stall: phase match, player grounded at spawn (Quick), pistol mag 16, touch
  controls look [366,0,915,412] stick [20,252,160,392] FIRE [837,292,903,358] JUMP [761,292,827,358] RELOAD [837,216,903,282].
- Lifecycle (static): Last Circle has NO visibilitychange/pagehide/blur pause, NO webglcontextlost handler, NO
  orientation lock, NO wake lock (grep of runtime/ for visibilitychange|pagehide|webglcontextlost|orientation.lock|
  screen.orientation|wakeLock|vibrate -> only audio.js:573 visibilitychange, which only mutes audio).
- Audio unlock (static, not WebKit-verified): audio.js:569-570 `window.addEventListener("pointerdown", unlock ...)` /
  keydown only. iOS resumes an AudioContext only inside touchend/click (DYEFIELD CONTRACT_MOBILE M4). And the overlay
  stops native pointerdown at its root (game_controls.js:923-926), so taps on stick/look never reach that listener.

## DRAFT RANKED GAPS (player-visible first)
1 HIGH  Cannot look/aim on touch (look zone -> synthetic mousemove -> dropped without pointer lock, player.js:847-848).
2 HIGH  First-run HOW TO PLAY cannot be dismissed on a landscape phone (GOT IT off-screen, no scroll, ESC only).
3 HIGH  Missing verbs: open chests (HOLD E), heal/shield (slot + fire), weapon switch, ADS, sprint, map.
4 HIGH  Two "desktop only" blocking cards on boot + portal "Desktop only" badge (mobile_support none).
5 MED+  Generic overlay drawn over menus; right-60% taps depend on a replay that is lost under main-thread load.
6 MED   Menus/lobby/HUD have no phone layout: menu top clipped, <44 px targets, <12 px text, HUD under the thumbs.
7 MED   Page hygiene/lifecycle: viewport-fit, dvh, manifest, fullscreen+landscape lock, rotate overlay, app-switch pause,
        context-lost card, iOS audio unlock.
8 MED   Portrait camera fit overwritten every frame (player.js:1905); landscape-first needs a rotate overlay anyway.
9 MED   No aim assist for thumbs (DYEFIELD aimassist.ts).
10 LOW  No touch perf profile / DynRes (a match shader warmup DOES exist: ffg_royale3d.js:444 compileAsync). Long tasks 30-127 s on this shared box = info only.
11 LOW  No mobile harness gate (_harness has botcheck/botdiag/stuckdiag/bridge_host only).
12 LOW  Control-bar buttons 26x26 px (<44), pointer-lock requested on every FIRE press.

## IN-MATCH RESULTS (lc_input.py run 2, Pixel 7 landscape, real CDP touches, tick()-driven frames)
- DROP: stick steers the glide: 5.1 m horizontal in 1 s, FFG_TOUCH held ['KeyW'].        PASS
- MOVE: stick forward 1.5 s -> 8.49 m, held ['KeyW'], input.mz 1.                         PASS
- MOVE analog: 25% deflection -> 0.32 m/1 s, held [] (per-axis deadzone 0.30, game_controls.js:709 `deadzone: 0.30`);
  45% deflection -> 5.42 m/1 s, held ['KeyW'] = full speed. The stick is DIGITAL (4 keys), no walk speed.
- LOOK: 160 px drag in the look zone -> dyaw 0, dpitch 0, pointerLockElement null.         FAIL (camera cannot turn)
- FIRE (first press after the menu): magazine 16 -> 16, W._lmbDown false while held, pointer-lock requests 1.  FAIL
  Cause: player.js:809 `if (e.button === 0 && W._suppressNextShot) { W._suppressNextShot = false; return; }` — the
  first press after any menu/modal is eaten as the "acquire the mouse" click.
- FIRE held 2 s (pistol): 16 -> 15 = ONE shot per press; semi-autos never repeat while held, no auto-fire.
- JUMP: y 14.46 -> 15.71.                                                                  PASS
- RELOAD: state ready -> reloading.                                                        PASS
- HUD under the thumbs (measured rect intersections): shield '25%' bar 1610 px2 and hp '100%' bar 1495 px2 under the
  stick; slot digits '4' under JUMP and '5' under FIRE; ammo '16 / 36' 1898 px2 under the Fullscreen/Mute/Pause bar.
- HUD prompt on a phone: 'CLICK TO LOOK AROUND' (hud.js:1901) shown permanently (no lock is ever held on touch).

## Layout sweep (lc_layouts.py; menu DOM measurements after resizing one page)
- HOW TO PLAY 'GOT IT': SE 667x375 [265,405,402,450] OFF; iPhone 14 852x393 [357,414,495,459] OFF; Pixel 7 915x412
  [389,423,526,468] OFF; Pixel 7 portrait 412x915 [137,710,275,755] on-screen. (iPad reading discarded: resize lag.)
- Menu on iPhone SE 667x375: 40 clipped text nodes; mode cards QUICK MATCH [121,-163,546,-71] (ENTIRELY above the
  screen), BATTLE ROYALE [121,-61,546,9] (only its bottom 9 px on screen), PRACTICE [121,19,546,89]. An SE player can
  only start PRACTICE. iPhone 14 852x393: 33 clipped; cards at y 119-211 / 221-291 / 301-371 (reachable).
- Look-zone tap mechanism: with the kernel draw loop stopped, the CONTINUE ANYWAY tap was STILL swallowed; the page's
  own event log shows touchstart at 277156 ms and touchend at 293296 ms (16.1 s apart on this saturated box). The replay
  test measures handler time (Date.now) not the touch's own timestamps, so any main-thread stall > 400 ms between the
  two handlers drops the tap. On a real phone this needs a hitch (loading, compile) to bite — plausible, not proven.

## More in-match results (lc_input.py run 2, continued)
- stick + look + FIRE together: moved 3.76 m, dyaw 0, FIRE held (heldMouse [0]) -> multi-touch registers, look dead.
- LOOT: SETUP teleport beside the nearest chest; HUD shows "[HOLD E] Open chest", W.interactHint 'chest'; touch
  controls = look, stick, FIRE, JUMP, RELOAD (no E). A tap on the prompt + 70 frames: slots unchanged. FAIL.
- Weapon slots: 0 HUD slot elements with a click handler near the bottom-right. FAIL (no way to switch/heal).
- PAUSE: the control-bar Pause button (26x26 at [876,374,902,400]) opened the pause card. PASS.
  RESUME [274,133,641,179] (centre inside the look zone): real tap did NOT resume. FAIL (same look-zone replay loss).
- App switch pause: probe reported paused, but the match was ALREADY paused (RESUME had failed) -> INCONCLUSIVE.
  Static: no visibilitychange/pagehide/blur pause anywhere in runtime/ (grep above); game_controls.js only auto-pauses
  on leaving fullscreen (game_controls.js:454-462).
- Pinch inside the look zone: visualViewport.scale 1, scrollY 0 (touch-action:none on the zone). PASS (left 40% not tested).
- Pointer-lock requests during the session: 3 (every FIRE press calls tryLock, player.js:808). DYEFIELD M4 wants 0.
- Render (INFORMATION): DPR 1.5 (tier cap), canvas 1372x618, graphics 'medium' default on a phone.
- Portrait mid-match (match paused at the time): fov 85, aspect 0.45, camFit {active, authored 57, applied 85};
  no rotate prompt; html 'ffg-touch ffg-mobile ffg-portrait'. HUD under the stick/JUMP/FIRE/bar in portrait too.
  Because the match was paused, player.js:1905's per-frame write never ran here; lc_shots.py re-checks with live ticks.
- iPad 1180x820 menu: 2 clipped (wordmark top -7; the keyboard hint line "WASD MOVE · MOUSE AIM/FIRE · RMB ADS ..."
  hud.js:1065 at y 807-851, i.e. partly below the screen) — and that line is a KEYBOARD hint shown on a touch device;
  it does not use the .kbd-hint class game_controls.js:277 hides on touch.
- Console: several "Failed to load resource" 404 / ERR_CONNECTION_REFUSED during the session (URLs not captured;
  likely network/relay probes — out of this lane, flagged for the net lane).

## Harness note: why screenshots/frames starved
trivial_shot.py (a 300x150 WebGL clear + text): d3d11 ANGLE = "Intel(R) UHD Graphics ... D3D11" took 16.32 s to
screenshot; SwiftShader took 0.14 s. The Intel iGPU is saturated by the other lanes' browsers, so every WebGL call
stalls the page's main thread. That is what produced the 30-127 s long tasks, the ~0 fps and the look-zone tap
losses in this audit. The loss MECHANISM (handler-time 400 ms window) is real; its frequency on a real phone is not
measured. Screenshot pass re-run on SwiftShader (lc_shots.py).

## Screenshots (scratch/shots/, SwiftShader pass lc_shots.py; loops frozen for the capture only)
- lc_pixel7_01_boot.png — "LAST CIRCLE IS DESKTOP-ONLY" card with the stick/RELOAD/JUMP/FIRE overlay drawn over it.
- lc_pixel7_05_lobby.png (misnamed; it is the menu) — "KEYBOARD + MOUSE REQUIRED" modal over the 3D menu + overlay.
- S1_pixel7_menu_first_run_modals.png — first-run stack on a Pixel 7.
- S2_pixel7_howto_gotit_offscreen.png — HOW TO PLAY: header cut at top, keyboard-only key list, NO 'GOT IT' on screen.
- S3_se_menu_cards_clipped.png — iPhone SE: QUICK MATCH and BATTLE ROYALE are above the screen; only PRACTICE shows;
  stick and FIRE/JUMP/RELOAD sit on top of the OPERATIVE panel.
- S4_pixel7_menu.png — Pixel 7 menu (wordmark/level strip off the top).
- S5_pixel7_match_hud_touch.png — in match: "CLICK TO LOOK AROUND" pinned mid-screen; slots 4/5 under JUMP/FIRE;
  ammo "16 / 36" hidden under the Fullscreen/Mute/Pause bar; shield/HP bars under the stick.
- S6_pixel7_chest_hold_e_prompt.png — "[HOLD E] Open chest" beside a chest; no button can do it.
- S7_pixel7_portrait_match.png — portrait: the 180 px minimap covers the storm timer / alive panel and compass; slots
  under the stick; the kernel's widened fov is in effect (the view is not cropped).
