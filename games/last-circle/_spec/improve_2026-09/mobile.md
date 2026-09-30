# Last Circle — MOBILE lane audit (vs DYEFIELD CONTRACT_MOBILE)

Status: COMPLETE. Read-only: no repo file was modified. The full running log, with every intermediate reading, is
in `scratch/mobile_runlog.md`. Probe scripts are `scratch/lc_mobile.py`, `lc_input.py`, `lc_layouts.py`,
`lc_shots.py` and `lc_verify.py`. Their logs are `input_pixel7.log`, `layouts.log`, `shots.log` and `verify.log`.
Screenshots are in `scratch/shots/`.

## Plain answer: can a phone player get into a match, move, aim, shoot, loot and read the HUD?

The device is a Pixel 7 held landscape (915x412), emulated in Chrome with a touch screen and real CDP touch events.

| Verb | Result | Evidence |
|---|---|---|
| Get into a match | **Only with a workaround.** A first-time visitor is shown a "DESKTOP-ONLY" card, then a "KEYBOARD + MOUSE REQUIRED" card, then the HOW TO PLAY card. The HOW TO PLAY card's only exit button, GOT IT, is drawn below the bottom of the screen on every landscape phone. Rotating the phone to portrait brings it on screen. On an iPhone SE, QUICK MATCH and BATTLE ROYALE are off the top of the menu, so only PRACTICE can be started. | measured rects; S2, S3 |
| Move | **Yes.** The stick moved the runner 8.49 m in 1.5 s and steers the parachute glide (5.1 m in 1 s). The stick is digital, though. A 25% push does nothing, and a 45% push is already full speed. | input_pixel7.log |
| Aim / look | **No.** A 160 px drag in the look zone turned the camera by exactly 0 rad (yaw 0, pitch 0). | input_pixel7.log |
| Shoot | **Barely.** The first FIRE press after any menu is swallowed (the magazine stayed 16 → 16). Holding FIRE on the pistol for 2 s fired exactly one shot. Shots always go through the centre of the screen, and the camera cannot turn, so the player can only shoot straight ahead. | input_pixel7.log |
| Loot | **Partly.** Walking over items picks them up. Chests show "[HOLD E] Open chest", but no touch button sends E. The player cannot switch weapon slots, so heals, shields and any gun picked up after the pistol can never be selected. | S6; input_pixel7.log |
| Read the HUD | **Poorly.** The ammo count "16 / 36" sits under the Fullscreen/Mute/Pause bar. The shield and HP bars sit under the stick. Slots 4 and 5 sit under JUMP and FIRE. "CLICK TO LOOK AROUND" stays pinned mid-screen for the whole match. | S5 |

Measured against the industry standard for mobile shooters:

- **Twin-stick.** Only half works: the left stick moves the player, but the right-side look does nothing.
- **Fire button.** There is one, but it eats the first press after a menu and fires only once per tap on semi-automatic weapons.
- **Auto-fire option.** None.
- **Landscape-first.** No. There is no rotate prompt and no orientation lock. In portrait, the live camera view is cut to about 27° across (the fit is verified to be undone after one frame; see gap 9).

## Environment caveat (read before trusting any timing)

The box is shared. `tasklist` showed 112 chrome.exe and 39 python.exe during the run. Chrome's d3d11 renderer reported "Intel(R) UHD Graphics ... D3D11", and on it a trivial WebGL page took 16.32 s to screenshot, against 0.14 s on SwiftShader. Other lanes were saturating the iGPU. Because of that:

- **Perf is information only.** The menu measured 0.006–0.1 fps on the iGPU and 1.3 fps on SwiftShader, with long tasks of 30 s to 127 s.
- **Input checks used `tick()`.** One `tick()` runs every kernel updater once: the same per-frame pipeline the rAF loop runs, minus the draw. Input itself was always real CDP touches.
- **Screenshots used SwiftShader,** with the page's loops frozen only for the moment of capture.

## Ranked gaps (player-visible first)

### 1. HIGH — Touch look and aim are dead

- **Last Circle.** The generic page layer maps Last Circle to its `shooter` archetype. At `game_controls.js:810` the entry is `"last-circle": "shooter",`, and `:752-753` defines that archetype's LOOK zone as synthetic mousemove events. `player.js:847-848` then drops every one of those events, because no pointer lock is held: `const locked = document.pointerLockElement === dom;` / `if (!locked && !rmbDrag) return;`. Mobile browsers never grant pointer lock.
- **Measured.** A 160 px drag gave dyaw 0 and dpitch 0. With the stick, look and FIRE all held together, the player moved 3.76 m while dyaw stayed 0. Shots aim through the screen centre (hud.js:2300-2302), and the game deliberately never turns the camera by itself (player.js:871-878), so the player cannot aim at all.
- **DYEFIELD.** It owns a native touch layer. `runtime/src/touch/controls.ts:1-4` uses Pointer Events tracked by pointerId with setPointerCapture. `:56-57` sets a radial deadzone of 0.12 and 0.0040 rad of look per px. Look reaches the game through `input.ts:167` `takeTouchLook()`.
- **Fix.**
  1. Port DYEFIELD's TouchControls/TouchState to a new `runtime/3d/royale/touch.js`: a floating analog stick, a look zone that accumulates radians, and FIRE with drag-to-aim.
  2. In `player.js` installHumanInput, merge the analog stick into input.mx/mz and take the touch look into input.yaw/pitch.
  3. Set `game_controls.js` PROFILES `"last-circle": "native"` so the generic overlay steps aside.
- **Verify.** Browser only. A real 160 px look drag must turn the camera by at least 0.3 rad on a Pixel 7 emulation.

### 2. HIGH — The first-run HOW TO PLAY card cannot be dismissed on a landscape phone

- **Last Circle.** `hud.js:3172` builds the card with `const box = h("div", Object.assign({ padding: "26px 34px", width: "520px", display: "flex", ... }, PANEL)` and gives it no maxHeight and no overflow. By contrast, CAREER (`hud.js:3224`) and SETTINGS (`hud.js:3275`) both have `maxHeight: "82vh", overflowY: "auto"`. ESC does not close the card either: the escPressed handler at `hud.js:2775-2778` handles only settings, bigmap and pause.
- **Measured.** GOT IT sits at:

  | Device | Viewport | GOT IT rect | On screen? |
  |---|---|---|---|
  | iPhone SE | 667x375 | [265,405,402,450] | no |
  | iPhone 14 | 852x393 | [357,414,495,459] | no |
  | Pixel 7 | 915x412 | [389,423,526,468] | no |
  | Pixel 7 portrait | 412x915 | [137,710,275,755] | yes |

  Screenshot S2 shows the card with its header cut off at the top and no button.
- **DYEFIELD.** CONTRACT_MOBILE M6 requires long panels to scroll inside themselves, every control inside the safe area, and every tap target at least 44 px. HOW TO PLAY shows a touch-controls panel.
- **Fix.** In `hud.js` showHowToPlay:
  - add maxHeight `calc(100dvh - 24px)` and overflowY auto;
  - make ESC and a tap outside the card close it;
  - show a touch-controls section in touch mode.
- **Verify.** Browser only. The GOT IT rect must fall inside the viewport on 667x375, 852x393 and 915x412, and a real tap must close the card.

### 3. HIGH — The touch layer lacks most of the verbs a BR needs

- **Last Circle.** The shooter profile has only FIRE, JUMP and RELOAD (`game_controls.js:752-753`). Everything else is keyboard- or mouse-only:
  - **Chests** need a 2 s hold of E: `loot.js:729` `if (target && target.type === "chest" && a.input.interactDown)`, with `CHEST_OPEN_S = 2.0` at `loot.js:744`. The prompt reads "[HOLD E] Open chest" (`hud.js:2200`).
  - **Heals and shields** are used by selecting their slot and then firing (`weapons.js:364` "consumable 'weapon' — fire = use").
  - **Slots** can be selected only with keys 1-5 or the mouse wheel (`player.js:736-740`, `:854-863`).
  - **The big map** opens only on KeyM (`player.js:765`). The minimap is a fixed 180 px canvas with no click handler (`hud.js:1804-1806`).
  - **ADS** is on RMB, **sprint** on Shift and **crouch** on C.
- **Measured.** Standing at a chest, the HUD showed "[HOLD E] Open chest" and the touch buttons were [look, stick, FIRE, JUMP, RELOAD]. After a tap and 70 frames, the slots were unchanged. No HUD slot element has a click handler.
- **DYEFIELD.** CONTRACT_MOBILE M2 gives each verb a sized button (JUMP, SLICK, SUB, SPECIAL, PAUSE), plus MAP on a tap of the minimap.
- **Fix.**
  1. Add to `touch.js`:
     - USE, which latches interactDown while held;
     - an ADS toggle;
     - auto-sprint when the stick is pushed fully forward.
  2. In `hud.js`, make the slots tappable in touch mode (at least 44 px) and make a minimap tap open the big map.
  3. Add `hud.setTouchMode`, so prompts read "HOLD USE" instead of "[HOLD E]" and "CLICK TO LOOK AROUND" is hidden.
- **Verify.** Browser only.
  - Holding USE by the chest for 2 s must change the slots.
  - Tapping slot 2 must change inventory.active.
  - Tapping the minimap must open the big map.

### 4. HIGH — The fire button eats the first press and has no auto-fire

- **Last Circle.** The mousedown handler starts with `player.js:808` `tryLock();` and then `:809` `if (e.button === 0 && W._suppressNextShot) { W._suppressNextShot = false; return; }`. The flag is set by releaseCursor at `hud.js:112`. Semi-automatic weapons fire only on the mousedown edge (`weapons.js:400-406`).
- **Measured.**
  - First FIRE after the menu: magazine 16 → 16, and `_lmbDown` false while held.
  - FIRE held for 2 s: 16 → 15, one shot.
  - Pointer-lock requests in the session: 3.
- **DYEFIELD.** CONTRACT_MOBILE M4: no pointer lock in touch mode, 0 lock requests, checked by `_harness/mobile.py` LOCK_JS. M2: FIRE is held-means-firing.
- **Fix.**
  - In touch mode, skip tryLock and `_suppressNextShot` (`player.js`).
  - In touch mode, re-arm the semi-auto edge at the weapon's fire interval while FIRE is held; call this the "auto-fire" option (`weapons.js`).
- **Verify.** Browser only. The first FIRE press must drop the magazine, a 2 s hold on the pistol must fire at least 3 rounds, and pointer-lock requests must be 0.

### 5. HIGH — Two "desktop only" cards block the way in, and the portal badge says "Desktop only"

- **Last Circle, boot card.** `ffg_boot3d.js:104-110` shows `desktopOnlyCard`: "LAST CIRCLE IS DESKTOP-ONLY ... there are no touch controls yet" (`:51`). Screenshot `lc_pixel7_01_boot.png` shows that card with the touch stick and buttons drawn over it.
- **Last Circle, menu card.** `hud.js:824-838` shows "KEYBOARD + MOUSE REQUIRED". Both comments (`ffg_boot3d.js:40-41` and `hud.js:816-820`) claim that no touch handler exists. That has been stale since game_controls.js v3 (2026-09-15).
- **Portal.** `src/lib/mobile.ts:18-21` reads `games.mobile_support`. `supabase/migrations/0007_games_mobile_support.sql:48` backfills every row to 'none', and only cosmic-coils and ascendant are set to 'full' (`:52-53`). The page renders "Desktop only" (`pages/games/@slug/+Page.tsx:104`, `src/components/game/GameCard.tsx:106`) and "Touch: Not supported — desktop only." (`+Page.tsx:144`). The live row was not queried.
- **Fix.**
  - Once gaps 1–4 land, remove both cards (`ffg_boot3d.js`, `hud.js`), or replace them with the rotate overlay from gap 8.
  - Then set `mobile_support` to 'partial' or 'full'. That is a registry write needing the service key, and whether to make it is the owner's call.
- **Verify.** Browser only. A touch boot must go straight to the menu with no PLAY ANYWAY or CONTINUE ANYWAY card. The portal detail page must show the mobile badge after the registry change.

### 6. MEDIUM — The generic overlay sits over the menus, and taps in its look zone are fragile

- **Last Circle.** The overlay mounts at boot and stays on every screen (`lc_pixel7_01_boot.png`, S3). Its look zone covers the right 60% of the screen ([366,0,915,412]). A tap there is replayed as a click only if it passes `game_controls.js:1114` `const wasTap = !touch.lookMoved && (Date.now() - touch.lookStartT) < 400;`. That check measures the time between the two event handlers running, not the touch's own timestamps.
- **Measured on this box.** CONTINUE ANYWAY and RESUME both failed to respond to real taps: 3 of 3 on the iGPU and 3 of 3 on SwiftShader. The page's own log shows the gap between the touchstart and touchend handlers at 2.2 s, 2.4 s, 9.0 s and 16.1 s, which is what a main-thread stall produces. When the page was idle, PLAY ANYWAY worked on the first tap.
- **Impact on a real phone.** Plausible, not proven: it takes a stall over 400 ms, such as loading or a frame hitch.
- **DYEFIELD.** CONTRACT_MOBILE M2 shows the overlay only while a match is in play; menus get native taps.
- **Fix.** This is subsumed by gap 1: set PROFILES to "native" and have `touch.js` setVisible only during a match. If the generic layer is kept anywhere, compare `e.timeStamp` values instead of Date.now (`game_controls.js`, the shared page layer).
- **Verify.** Browser only. Real taps on CONTINUE ANYWAY and RESUME must work on the first try.

### 7. MEDIUM — Menus, lobby and HUD have no phone layout

- **Last Circle.** There is no `@media` layout rule in hud.js. The grep for "@media" across hud.js, index.html and game_controls.js returned nothing. The HUD uses fixed pixel positions:
  - HP and shield bars: `hud.js:1728` `left: "18px", bottom: "16px", width: "300px"`, under the stick;
  - weapon slots: `hud.js:1760` `right: "18px", bottom: "16px"`, under FIRE and JUMP;
  - minimap: 180 px at `hud.js:1804`.

  The menu's keyboard hint line (`hud.js:1065`, "WASD MOVE · MOUSE AIM/FIRE ...") is not tagged `.kbd-hint`, the class that game_controls.js:277 hides on touch devices. The control bar buttons are 26x26 px.
- **Measured, Pixel 7 menu.** 32 text elements are clipped off the top; the wordmark sits at y -207..-126. 15 tap targets are under 44 px and 8 text nodes are under 12 px.
- **Measured, iPhone SE menu.** 40 clipped. QUICK MATCH is at [121,-163,546,-71] and BATTLE ROYALE at [121,-61,546,9], so only PRACTICE can be started (S3).
- **Measured, in match.** The '25%' shield bar overlaps the stick by 1610 px², the '100%' HP bar by 1495 px², and the ammo '16 / 36' overlaps the control bar by 1898 px². Slot '4' sits under JUMP and slot '5' under FIRE (S5).
- **Measured, portrait.** The minimap covers the storm timer and alive panel (S7).
- **DYEFIELD.** CONTRACT_MOBILE M6: a phone-landscape `@media (max-height: 500px)` breakpoint, a compact HUD that reserves the thumb zones, targets of at least 44 px, text of at least 12 px, and self-scrolling panels.
- **Fix.** In `hud.js`, add a touch/phone class and CSS in ensureAAAStyles:
  - a scrollable menu column that pins the mode cards first;
  - a responsive lobby grid;
  - a compact HUD that clears the stick, the buttons and the bar;
  - `.kbd-hint` on the keyboard hint line.

  If the bar stays, give its buttons 44 px in touch mode (`game_controls.js`, shared).
- **Verify.** Browser only. A port of DYEFIELD's layoutcheck on 667x375, 852x393, 915x412 and 1180x820 must report 0 clipped, 0 overlaps with touch controls, targets ≥ 44 and fonts ≥ 12.

### 8. MEDIUM — Page hygiene, lifecycle and install

- **Last Circle, page.**
  - `index.html:3`: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`, with no viewport-fit=cover and no interactive-widget.
  - `index.html:5` uses `height:100%`, not 100dvh.
  - There is no manifest and no apple-mobile-web-app meta (both measured false).
- **Last Circle, lifecycle.** A grep of runtime/ for `visibilitychange|pagehide|webglcontextlost|orientation.lock|screen.orientation|wakeLock|vibrate` found only `audio.js:573`, which only mutes the audio on hide. So:
  - there is no pause on app switch, no context-lost card and no orientation lock;
  - game_controls.js pauses only when the player leaves fullscreen (`:454-462`);
  - audio unlocks only on pointerdown and keydown (`audio.js:569-570`). iOS resumes audio only in touchend or click (inferred, not tested on WebKit).
  - There is no rotate prompt in portrait (measured: no rotate text).
- **DYEFIELD.**
  - `runtime/index.html:5` sets the viewport meta, `:10` the manifest link and `:12-15` the apple meta.
  - `main.ts:113-114` calls `requestFullscreen({ navigationUI: 'hide' })` and `:689` handles webglcontextlost.
  - `game.ts:405-421` pauses on hidden, pagehide and blur.
  - `ui/boot.ts:33,160` provides `RotateOverlay` with "Turn your device sideways to play".
- **Fix.**
  - `index.html`: set the meta tags and dvh, and link a new `manifest.webmanifest` plus icons.
  - `hud.js`: add the rotate overlay.
  - `ffg_royale3d.js`: pause on hidden, pagehide and blur in touch mode; add a context-lost card; on the first touch gesture, go fullscreen and lock to landscape.
  - `audio.js`: also unlock on touchend.
- **Verify.** Browser only.
  - A portrait viewport must show the rotate overlay and pause the match.
  - Dispatching visibilitychange with the page hidden must pause a match that was not already paused. This run's check was inconclusive because the match was already paused.
  - The manifest must return 200.

### 9. MEDIUM-LOW — The portrait camera fit is undone every frame

- **Last Circle.** The fit is in the uncommitted kernel work of another session (ffg_kernel_3d.js `applyCameraFit`). It runs on resize and start. `player.js:1905` `cam.fov = W._fovBase + (W.fovPunch || 0) * Math.min(1, W._fovBase / 57);` then rewrites the fov every frame.
- **Measured (lc_verify.py).**
  - After resizing to portrait: fov 85, fit active (authored 57, applied 85).
  - After one full updater pass: fov 57.

  At aspect 0.45, a vertical fov of 57 is about 27.5° across, against about 100° in landscape. A player holding the phone upright sees a sliver.
- **Fix.**
  - `player.js`: right after line 1905, call `W.kernel.applyCameraFit && W.kernel.applyCameraFit()`. The kernel adopts the new value as authored and widens it.
  - Keep the rotate overlay from gap 8 for touch devices, because Last Circle is landscape-first.
  - This builds on the in-flight kernel change; do not revert it.
- **Verify.** Browser only. In portrait, fov must stay above 57 after 10 live frames.

### 10. MEDIUM — No aim assist for thumbs

- **Last Circle.** There is no aim assist anywhere; a case-insensitive grep for `aimassist|aim assist|aim-assist|magnet|slowdown` over runtime/3d found nothing.
- **DYEFIELD.** `runtime/src/touch/aimassist.ts:61` `export function aimAssist(...)` implements M3: 0.45 × strength slowdown within 6°, and magnetism of no more than 22°/s, only while firing. It is on in touch mode only.
- **Fix.** Add a new pure `runtime/3d/royale/aimassist.js` and call it from `player.js` in touch mode only. It needs a visibility test (`weapons.js` already has a ray march).
- **Verify.** Browser plus a Node unit test. The unit test covers the pure function: it never acts through walls and never snaps. In the browser, the check is a turn toward a visible foe while firing.

### 11. LOW — No touch performance profile

- **Last Circle.** The DPR cap is `min(dpr, tier)` (`ffg_royale3d.js:171`), and the measured DPR was 1.5 on a 1372x618 canvas. A touch device defaults to 'medium' graphics (measured). There is no DynRes.
- **Correction.** The task brief said there was no shader warmup. That is wrong: `ffg_royale3d.js:444` already awaits `compileAsync`.
- **DYEFIELD.** CONTRACT_MOBILE M7:
  - the touch cap stays `min(1.5, DPR)`;
  - shadows are ≤ 1024 on touch, dropping to 512 on the floor;
  - antialias is off when DPR ≥ 2;
  - a GPU memory budget of 300 MB.
- **Fix.** In `ffg_royale3d.js`, choose touch defaults ('low', or medium without shadows) and add shadow and antialias rules. This overlaps the perf lane's DynRes work.
- **Verify.** Browser only; the numbers are information, not a pass/fail gate.

### 12. LOW (internal, but needed to prove 1–11) — No mobile gate

- **Last Circle.** `_harness/` contains only botcheck.py, botdiag.py, stuckdiag.py and bridge_host.html.
- **DYEFIELD.** `_harness/mobile.py` (1989 lines) and `layoutcheck.py` (686 lines, DEVICES at `:66`) use real CDP multi-touch through the `Touch` class at `mobile.py:353`.
- **Fix.** Port both into a new `_harness/mobile.py` and `_harness/layoutcheck.py`. On this box, launch with `--use-angle=swiftshader`, because the iGPU is shared: d3d11 starved every frame in this audit.
- **Verify.** It runs on SE, iPhone 14, Pixel 7 and iPad, and exits non-zero on the current build.

## Suggested file-disjoint lanes (mirrors DYEFIELD M12)

- **INPUT.**
  - New `runtime/3d/royale/touch.js`.
  - New `runtime/3d/royale/aimassist.js`.
  - `runtime/3d/royale/player.js`: gaps 1, 3, 4 and 9.
  - `runtime/3d/royale/weapons.js`: gap 4, auto-fire.
  - `game_controls.js`: gaps 1 and 6, the PROFILES entry only.
- **UI.**
  - `runtime/3d/royale/hud.js`: gaps 2, 3, 5, 7 and 8.
  - `runtime/3d/ffg_boot3d.js`: gap 5.
  - `index.html`, plus a new `manifest.webmanifest` and icons: gap 8.
  - `runtime/3d/royale/audio.js`: gap 8.
- **LIFECYCLE/PERF.** `runtime/3d/ffg_royale3d.js`: gaps 8 and 11. It may collide with the perf lane.
- **HARNESS.** New `_harness/mobile.py` and `_harness/layoutcheck.py`: gap 12.
- **Registry.** `games.mobile_support` for gap 5 is not a repo file. Flip it after gate 12 passes, and only on the owner's OK.

## Out of scope, noted

The console logged several "Failed to load resource" errors (404 and ERR_CONNECTION_REFUSED) during the session. The URLs were not captured; they are probably network or relay probes. This is for the net lane.
