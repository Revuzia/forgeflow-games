# DYEFIELD — Mobile contract (M1–M12)

Owner request (2026-09-29): "ensure this game will work well on a mobile device and things are all set up
according to industry standard." This contract is the spine for the mobile work. `CONTRACT.md` and
`CONTRACT_FFA.md` still hold. Where this file changes one of them, the change is noted in place with a
`CHANGED(MOBILE)` note.

**Non-negotiables**
- The deterministic sim is untouched. `runtime/src/core/**` is not edited, so the teams and FFA determinism hashes
  in `npm run probe` stay identical.
- Desktop keyboard and mouse behaviour is unchanged, including the brief's exact strings on keyboard. Every
  existing desktop gate must still pass: bootcheck, playtest, menus, padcheck, bootguard and the probes.

## M0 Target envelope

| class | CSS viewport (landscape) | DPR | browsers |
|---|---|---|---|
| small phone | 667×375 (iPhone SE) | 2 | iOS Safari 16.4+ |
| phone | 844×390 / 852×393 (iPhone 14/15) · 915×412 (Pixel 7) | 2.6–3 | iOS Safari 16.4+, Android Chrome 110+ |
| tablet | 1180×820 (iPad Air) · 1024×768 | 2 | iPadOS Safari, Android Chrome |

The game is **landscape-only on touch devices**, which is standard for mobile action games. Portrait gets the
rotate overlay (M4). Desktop windows of any shape keep working as today.

## M1 Input method: detection and switching

- `Input.mode: 'kbm' | 'touch'`, plus `Input.onMode(fn) → unsubscribe`. The mode is reflected on `<html>` as the
  class `df-touch` or `df-kbm`, and all CSS keys off that class, never off a user-agent test.
- **At boot:** `touch` if `matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0`, else `kbm`.
  The override `?touch=1|0` wins for harnesses and for testing on desktop.
- **Hybrid devices** (a touchscreen laptop, or an iPad with a keyboard):
  - a `pointerdown` with `pointerType === 'touch'` switches to `touch`;
  - a real `mousemove` (non-zero movement, `pointerType === 'mouse'`) or a `keydown` of a bound key switches to
    `kbm`;
  - switching is instant and never happens mid-gesture (only when no touch is down).
- The mode is not persisted.

## M2 Touch controls (`runtime/src/touch/controls.ts` + `touch.css`)

Built with the Pointer Events API only, using `pointerType === 'touch'` and tracking each touch by `pointerId`.
- The overlay root is `#df-touch`, above the canvas and below the menus and cards, with `touch-action: none`.
- It is shown only in `touch` mode while a match session is in play or paused-behind-card. It is hidden in menus.
- Every control uses `setPointerCapture`.
- Any number of simultaneous touches work: move, look and FIRE together is the baseline (3 touches).

**Layout.** Landscape, right-handed by default. `touchLeftHanded` mirrors the whole layout. Sizes are CSS px
× `touchScale`.

| control | where | size | behaviour |
|---|---|---|---|
| MOVE (floating stick) | touch starts anywhere in the left 45 % of the screen below the top HUD band | base Ø 120, knob Ø 52 | Base appears where the thumb lands. Output is analog `moveX`/`moveZ` in [−1, 1] with a radial deadzone of 0.12 and a linear response after it. Past the rim the base follows the finger (drag-follow). Released → 0. When idle, a faint base shows at its home spot so players know it exists. |
| LOOK | any touch in the right 55 % that does not start on a button | — | Drag rotates the camera: Δyaw = −dx × 0.0040 rad × `touchSens` × accel, and Δpitch = −dy × 0.0032 rad × `touchSens` × accel, where accel = 1 + 0.6 × clamp((speed − 600 px/s) / 1400, 0, 1). |
| FIRE | right, thumb arc, bottom | Ø 88 | Held = fire held. A drag that starts on FIRE also looks (fire-and-aim, the COD Mobile / Splatoon-style convention). The icon is the current kit's. |
| JUMP | right of FIRE / below | Ø 64 | Press latches `jump`. |
| SLICK | left of FIRE | Ø 64 | Held = `slick` held (swim and drink). |
| SUB | above FIRE | Ø 56 | Press latches `sub`. Dimmed while the tank is below the sub's cost. |
| SPECIAL | above-left of FIRE | Ø 64 | Press latches `special`. A conic charge ring shows 0..1, and a ready pulse plays when full. Dimmed when not ready. |
| PAUSE | top-left, inside the safe area | Ø 44 | Calls the pause handler (the same path as ESC). |
| MAP | tap on the HUD minimap | — | Triggers the `map` UI action. |

**Rules for every control**
- Hit targets are at least 44×44 CSS px at any `touchScale` (clamped 0.8–1.3).
- Controls sit inside `env(safe-area-inset-*)`.
- Opacity is `touchOpacity` (0.35–1, default 0.75). A pressed control is 1.0 and scaled 0.94.
- There is no text selection, no long-press callout and no tap highlight.
- **Haptics** (`haptics`, default on, feature-detected `navigator.vibrate`, a no-op on iOS):
  - a button press gives 8 ms;
  - being WASHED gives 60 ms;
  - special ready gives [12, 40, 12].

**API** (the only surface other modules use)
```ts
export interface TouchOptions { sens: number; scale: number; opacity: number; leftHanded: boolean; haptics: boolean }
export class TouchControls {
  constructor(host: HTMLElement, state: TouchState, opts: TouchOptions);
  readonly root: HTMLElement;
  setVisible(on: boolean): void;             // shown only in touch mode while a match is on screen
  setOptions(o: Partial<TouchOptions>): void;
  setKit(kitId: string): void;               // FIRE icon
  setMeters(m: { specialFrac: number; specialReady: boolean; subReady: boolean }): void;   // per frame, cheap
  onPause(fn: () => void): () => void;
  vibrate(pattern: number | number[]): void; // respects `haptics`
  dispose(): void;
}
/** Shared with Input (input.ts owns the instance): TouchControls writes, Input.intent()/takeTouchLook() read. */
export interface TouchState {
  moveX: number; moveZ: number;              // analog, camera-relative, |v| ≤ 1
  lookYaw: number; lookPitch: number;        // accumulated radians since the last takeTouchLook()
  held: Set<'fire' | 'slick'>;
  latched: Set<'jump' | 'sub' | 'special'>;
  active: number;                            // touches currently down (mode switching waits for 0)
}
```

**Input merge (`input.ts`)**
- `intent()`:
  - movement is the touch analog vector when its magnitude > 0, else the keyboard digital one;
  - booleans are keyboard OR touch;
  - touch latches are consumed like keyboard latches.
- `takeTouchLook(): { dyaw, dpitch }` returns the accumulated radians and zeroes them.
- If the sim reads only the direction of `moveX`/`moveZ` (it normalises), analog still steers correctly. Do not
  change the sim.

## M3 Aim assist (`runtime/src/touch/aimassist.ts`, touch only, `aimAssist` default ON)

A pure function with no THREE and no DOM. The Game calls it once per frame in touch mode.
```ts
export function aimAssist(i: {
  camYaw: number; camPitch: number; eye: {x:number;y:number;z:number};
  foes: ReadonlyArray<{x:number;y:number;z:number;visible:boolean}>;   // chest points, visible = world.canSee
  range: number; firing: boolean; moving: boolean; dt: number; strength: number;   // strength 0..1
}): { slow: number; dyaw: number; dpitch: number };
```
- **Slowdown:** while the reticle is within 6° of a visible foe in range, the look gain × (1 − 0.45 × strength).
- **Magnetism:** only while firing AND (moving OR looking). Turn toward the nearest foe inside 8° at no more than
  22°/s × strength, and pitch at half that.
- It never snaps, never acts through walls (`visible` false) and never acts on a foe beyond `range`.
- It is off in `kbm` mode.
- Industry reference: mobile shooters use slowdown plus a light rotational pull on touch only.

## M4 Play flow on touch (`main.ts`, `game.ts`, `ui/boot.ts`)

- **No pointer lock** in touch mode. The play card reads TAP TO PLAY, and a tap starts play.
  - A lost pointer lock never pauses in touch mode.
  - START on the map select goes straight to the countdown.
- **Fullscreen and orientation:**
  - On the TAP TO PLAY or START gesture, where it is supported, call
    `document.documentElement.requestFullscreen({ navigationUI: 'hide' })` and then
    `screen.orientation.lock('landscape')`. Both are wrapped in try/catch and failures are silent. iPhone Safari
    has no element fullscreen, so M9 covers it.
  - A FULLSCREEN toggle sits in the title screen corner and on the pause card, on desktop too. It is hidden when
    `document.fullscreenEnabled` is false.
- **Pause triggers in touch mode:** the PAUSE button; `visibilitychange` to hidden; `pagehide`; the rotate
  overlay appearing; and `blur` (an incoming call or app switch).
  - After a pause the game never auto-resumes. It shows the pause card and needs a tap to RESUME.
- **Rotate overlay** (`boot.ts` `RotateOverlay`): shown when in touch mode and `innerHeight > innerWidth`.
  - It is full-screen with a phone-rotating icon and the text "Turn your device sideways to play".
  - A live match pauses while it shows.
  - `new RotateOverlay(onChange: (shown: boolean) => void)`, `.shown`, `.dispose()`.
- **Platform prompts** (`hud.setTouchMode(on)`, `menus.setTouchMode(on)`):
  - Keycap badges (for example special → Q) become the touch button's glyph.
  - The low-tank toast in touch mode is `LOW_TANK_TOAST_TOUCH = 'Tank low — hold SLICK on your color to drink'`.
    The brief's SHIFT line stays exactly as it is in `kbm`.
  - The keyboard hint bar (↑↓←→ MOVE / ENTER SELECT) is hidden.
  - HOW TO PLAY shows a touch-controls panel.
- **Audio:** the unlock gestures include `pointerup` and `touchend`. iOS only resumes an AudioContext inside
  touchend or click. The context resumes on returning to visible. The mute switch on iOS silences WebAudio; that
  is platform behaviour, not a bug.
- **WebGL context loss:** handle `webglcontextlost` by calling preventDefault, pausing, and showing a card
  ("Graphics were reset by the device — RELOAD"). `webglcontextrestored` also leads to a reload, which is the
  simplest correct path.

## M5 Page hygiene (`index.html`, `styles.css`)

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`.
- Pinch-zoom and double-tap zoom never reach the page:
  - `touch-action: none` on the canvas and the touch layer;
  - `touch-action: manipulation` on every button;
  - `gesturestart`, `gesturechange` and `gestureend` are prevented (iOS);
  - `visualViewport.scale` must stay 1 through a pinch on the game.
- `html, body`: `overscroll-behavior: none`, which stops pull-to-refresh and rubber-banding.
- Full height uses `100dvh`, with a `100vh` fallback, so the mobile URL bar never hides the HUD.
- UI chrome: `-webkit-user-select: none`, `user-select: none`, `-webkit-touch-callout: none`,
  `-webkit-tap-highlight-color: transparent`. Text inputs, such as the profile name, stay selectable.
- In touch mode, `contextmenu` is prevented on the game and the UI.
- Hover-only affordances are wrapped in `@media (hover: hover)`, so a tap never leaves a sticky hover or focus
  state. The menus' "hover moves focus" behaviour happens for mouse pointers only.

## M6 Responsive layout (`menus.css`, `styles.css`, `hud.ts`, `menus.ts`, `boot.ts` cards)

- Every menu screen, the pause and quit cards, the loading / play / error / rotate cards, the victory slate
  (teams and FFA) and the live HUD in both modes must fit every M0 viewport:
  - no control is clipped outside the viewport or outside the safe area;
  - no two controls overlap;
  - every tap target is at least 44×44 CSS px;
  - body text is at least 12 px, and buttons and labels at least 14 px.
  - Long panels (SETTINGS, HOW TO PLAY, CREDITS) scroll inside themselves with momentum. The page never scrolls.
- Phone-landscape breakpoint: `@media (max-height: 500px)`, with `(max-width: 950px)` refinements.
  - A compact HUD: crests, timer, share bar and minimap scale down.
  - HUD blocks reserve the touch zones: the right-bottom thumb arc and the left-bottom stick.
  - The kill feed holds 3 items at most.
- The title screen's profile card must never cover the DYEFIELD wordmark at any width, desktop included. That
  overlap was a defect in 1.1.0 and 1.2.0.

## M7 Performance profile (`view/renderer.ts`, `main.ts`)

- **Touch mode + quality `auto`:** start at the regular floor scale, then let the existing governor climb.
  - The cap on touch is `min(1.5, DPR)`, unchanged.
  - Shadow-map size on touch is ≤ 1024, and it drops to 512 when the governor sits on the floor for 5 s.
  - Where the renderer can switch the WebGL context's `antialias` at creation, turn it off on touch devices with
    DPR ≥ 2. Measure and record the effect.
- Target: on a mid-range phone, hold 60 fps where the phone can and never fall below 30. On this machine that is
  verified by emulation only: an iGPU at phone resolution with 4× CPU throttling. The report must say so plainly.
- Budget:
  - **Sim:** measure the sim's ms per tick at 4× CPU throttle and report it. Budget ≤ 8 ms at 4×, so that
    MAX_STEPS_PER_FRAME never spirals.
  - **GPU memory:** estimate texture and buffer bytes from `renderer.info` and the atlas sizes. Budget ≤ 300 MB,
    for iOS Safari's tab limit.

## M8 Settings (`ui/settings.ts` fields, `ui/menus.ts` rows)

- New `Settings` fields, sanitized, persisted and with defaults:
  - `touchSens` 0.3–3 (1);
  - `touchScale` 0.8–1.3 (1);
  - `touchOpacity` 0.35–1 (0.75);
  - `touchLeftHanded` (false);
  - `aimAssist` (true);
  - `haptics` (true).
- Old saved settings must load unchanged. Sanitization fills the defaults.
- SETTINGS gains a TOUCH CONTROLS group. It is visible in touch mode, and on desktop only with `?touch=1`.
  - It shows the six rows plus a live preview: the controls overlay drawn at the current scale and opacity.
  - Changes apply live, through `settings.on()`.

## M9 Install / PWA (`runtime/public/`)

- `manifest.webmanifest`, linked from index.html:
  - `name` DYEFIELD, `short_name` DYEFIELD;
  - `start_url` './index.html', `scope` './';
  - `display` 'fullscreen' with `display_override` ['fullscreen', 'standalone'];
  - `orientation` 'landscape';
  - `background_color` and `theme_color` #2f86dc;
  - icons: 192, 512, and a maskable 512.
- Icons are PNGs rendered from the existing favicon mark. It is original art, so no new generation spend.
- `apple-touch-icon` 180.
- Meta tags: `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`
  black-translucent, `apple-mobile-web-app-title` DYEFIELD.
- On iPhone Safari (no element fullscreen, not standalone), the pause card and title screen show a one-line tip
  once per device (localStorage): "Tip: Share → Add to Home Screen plays DYEFIELD full screen."
- **No service worker, deliberately.** Deploys are no-store and hash-named, and a service worker cache would
  serve stale builds. Home-screen install works without one.

## M10 Deep links and harness hooks

- `?touch=1|0` (M1). Harnesses emulate devices with Playwright (`has_touch`, `is_mobile`, viewport, DPR) and drive
  real touches with CDP `Input.dispatchTouchEvent`, including multi-touch. There are no synthetic shortcuts into
  TouchControls internals.
- `__DF__.touch()` returns the read-back:
  `{ mode, visible, stick: {x, y, active}, lookRad: {yaw, pitch}, held, buttons: [{id, rect, dimmed}], assist: {slow, dyaw} }`.

## M11 Gate: `_harness/mobile.py` (headless Chromium, device emulation, real touch events)

It runs on each M0 device (iPhone SE, iPhone 14, Pixel 7, iPad) in landscape, plus portrait checks. For each
device:
1. **Boot → lobby:** `html.df-touch`; there are 0 pointer-lock requests; the title layout passes the M6 checks
   (overlap, clip, safe area, target ≥ 44, font ≥ 12); the wordmark is uncovered.
2. **Menus by taps:** PLAY → MODE FFA → map → START, plus LOADOUT, SETTINGS (the TOUCH group), HOW TO PLAY and
   CREDITS, each checked against M6.
3. **Match** (teams on one device, FFA on another; both modes across the run):
   - TAP TO PLAY; the stick moves the runner ≥ 3 m; a look drag changes yaw by ≥ 0.3 rad;
   - FIRE held raises the human's `painted`; JUMP leaves the ground;
   - SLICK held on own dye gives state slick, and the tank refills;
   - SUB throws a jelly; SPECIAL fires when charged (a dev charge hook is allowed for setup, not for the press);
   - three simultaneous touches (stick + look + FIRE) all register;
   - PAUSE → pause card → RESUME.
4. **Portrait:** the overlay shows, the match pauses, and landscape brings back the pause card.
5. **Hygiene:** a pinch on the canvas leaves `visualViewport.scale` at 1; `scrollY` stays 0; a long-press opens no
   menu or selection.
6. **Page and install:** the manifest and icons return 200 with the right sizes, and the meta tags are present.
7. **Perf (informational):** fps and governor scale at device size, sim ms per tick at 4× CPU. These go in the
   report, not the verdict, because of the iGPU.
8. **Errors:** 0 console, page or shader errors, and 0 failed requests.

Screenshots go to `_shots/mobile_<device>_<step>.png`, and a reviewer looks at them.

**Desktop regression** (must stay green): `npm run probe` (unchanged hashes), bootcheck teams and FFA, the playtests
(FFA and teams, one map each at least), `menus.py`, `padcheck.py` and `bootguard.py`.

## M12 Lane ownership (parallel build)

- **INPUT lane**
  - owns: `touch/controls.ts`, `touch/touch.css`, `touch/aimassist.ts`, `input.ts`, `game.ts`, `main.ts`,
    `view/renderer.ts`, `audio/index.ts`;
  - adds the new `Settings` fields in `ui/settings.ts` (types, defaults, sanitize) and nothing else there.
- **UI lane**
  - owns: `ui/menus.ts`, `ui/menus.css`, `ui/styles.css`, `ui/hud.ts`, `ui/boot.ts`, `ui/slates.ts`,
    `index.html` (keep the boot guard intact) and `runtime/public/` (manifest, icons);
  - calls only the APIs named here.
- **Calls across the lanes**, fixed here so the lanes need not wait on each other:
  - `hud.setTouchMode(on)`, `menus.setTouchMode(on)`;
  - `BootUI.setTouch(on)`, which makes the play card read TAP TO PLAY;
  - `new RotateOverlay(onChange)`;
  - the Settings field names in M8;
  - `LOW_TANK_TOAST_TOUCH` exported from `hud.ts`;
  - the TouchControls API, which `game.ts` and `main.ts` construct and feed.
