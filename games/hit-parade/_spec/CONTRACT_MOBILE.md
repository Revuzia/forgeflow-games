# HIT PARADE — Mobile contract (M0–M12)

Adapted from `games/dyefield/_spec/CONTRACT_MOBILE.md` (the proven M0–M12 spine) for a versus fighting game: no look
zone, no aim assist; a floating 8-way stick and the SIMPLE "PAD" button arc from `_research/FIGHTING_DESIGN.md` §5c.
`CONTRACT.md` still holds; where this file extends it the change is noted `CHANGED(UI)`. Owner: lane UI (touch layer,
HUD, menus) with lane SHELL (input merge, boot cards, page hygiene) per M12.

**Non-negotiables**
- The deterministic sim is untouched: touch produces the same CONTRACT §4.4 input word as keys / pads / AI / net, fed
  to player 0 only. Online, touch players get no timing advantage (CONTRACT §10; FIGHTING_DESIGN §5c).
- Desktop keyboard / pad behaviour and copy are unchanged. Every desktop gate stays green.

## M0 Target envelope

| class | CSS viewport (landscape) | DPR | safe insets (l, t, r, b) | browsers |
|---|---|---|---|---|
| small phone | 667×375 (iPhone SE) | 2 | 0 | iOS Safari 16.4+ |
| phone | 844×390 (iPhone 12–14) · 852×393 (14 Pro / 15) · 915×412 (Pixel 7) | 2.6–3 | 47/0/47/21 · 59/0/59/21 · 0 | iOS Safari 16.4+, Android Chrome 110+ |
| tablet | 1180×820 (iPad Air) · 1024×768 | 2 | 0/0/0/20 | iPadOS Safari, Android Chrome |

Landscape only on touch devices; portrait shows the rotate overlay (M4). Desktop windows of any shape keep working.

## M1 Input method: detection and switching (lane SHELL, `input.ts`)

- `Input.mode: 'kbm' | 'touch'`, reflected on `<html>` as the class `hp-touch` or `hp-kbm`; all CSS keys off that
  class, never off a user-agent test. `?touch=1|0` pins it (harnesses, desktop testing).
- Boot: `touch` if `matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0`, else `kbm`.
- Hybrid devices: a touch `pointerdown` switches to `touch`; a real mouse move or a bound key switches to `kbm`;
  never mid-gesture (only while `Input.touch.active === 0`). Not persisted.

## M2 Touch controls (`runtime/src/touch/controls.ts` + `touch.css`, lane UI)

Pointer Events only (`pointerType === 'touch'`), each touch tracked by `pointerId` and captured
(`setPointerCapture`). The overlay root is `#hp-touch` (z 30: above the HUD 10 and broadcast 20, below the menus 40),
`touch-action: none`, shown only in touch mode while a bout is in play or paused behind the card; hidden in menus.
Any number of simultaneous touches work (stick + two buttons is the baseline).

**Layout = SIMPLE "PAD"** (landscape, right-handed by default; `touchLeftHanded` mirrors it). CSS px × `touchScale`,
button centres measured from the right / bottom SAFE edges (`TOUCH` + `CLUSTER` in controls.ts are the source of truth):

| control | centre (dx, dy) | Ø | behaviour |
|---|---|---|---|
| STICK (floating) | home: 34 px + radius in from the bottom-left safe corner | base 120, knob 52 | a touch starting in the left 45 % below the top HUD band (18 % of the height, 56–120 px). Origin = where the thumb lands (touch-down alone reads neutral); past the rim the origin follows the finger. Radial deadzone 15 %. **8-way sectors with a 60° UP sector** so a jump needs intent: 7 / 8 / 9 = 120–150° / 60–120° / 30–60°; 4 / 6 = 150–202.5° / 337.5–30°; the down family 45° each. Output = the screen-relative UP / DOWN / LEFT / RIGHT bits; holding away = block, down-away = crouch block (the sim reads it from the word). A faint UP-sector wedge is drawn on the base. |
| SP | 62, 70 | 84 | S. A SHOWTIME ring shows bars / 3. |
| H | 150, 44 | 72 | H |
| M | 156, 128 | 72 | M |
| L | 238, 86 | 72 | L |
| PARRY | 84, 160 | 64 | the PARRY macro bit (= M+H); dimmed during STAGE FRIGHT |
| IMPACT | 160, 212 | 60 | IMPACT; dimmed during STAGE FRIGHT |
| THROW | 240, 172 | 60 | the THROW macro bit (= L+M) |
| SUPER | 50, 244 | 64 | the S+H macro; shown only while SHOWTIME holds ≥ 1 bar, pulses at 3 (`setMeters`) |
| ASSIST | 318, 40 | 52 | a tap latches ASSIST for 1 s (holding a modifier while tapping L is awkward on glass); held = held |
| PAUSE | top centre, max(96 px, 20 % of the height) below the top safe edge | 44 | on release inside the button (+12 px slop) → `onPause` handlers (the ESC pause path) |
| STEP IN / STEP OUT (CHANGED(UI3D)) | 58, 196 / 130, 196 from the LEFT (stick-side) safe edge, mirrored when left-handed | 56 | bit 13 STEP_IN (circle away from the camera) / bit 14 STEP_OUT (toward it), CONTRACT §35.2: a tap = sidestep, a hold = circle-walk round the ring (the sim tells them apart by hold time); 14 px over the stick base |

Closest pairs keep ≥ 12 px of gap at scale 1 (e.g. H↔M 84 px apart vs 72 px of radii).

**Rules for every control**
- Hit targets ≥ 44×44 CSS px at any `touchScale` (clamped 0.8–1.3); all controls inside `env(safe-area-inset-*)`.
- Idle opacity `touchOpacity` (0.35–1, default 0.75); a pressed control is 1.0, scaled 0.94.
- A press stays alive while the thumb slides off the button (captured) until it lifts.
- No text selection, no long-press callout, no tap highlight.
- Haptics (`haptics`, default on, feature-detected `navigator.vibrate`, a no-op on iOS): 8 ms per press;
  [12, 40, 12] when SHOWTIME reaches 3 bars.
- **Movable / resizable** (SF4 CE, Brawlhalla precedent): `editLayout(true)` shows the EDIT LAYOUT bar (hint, SMALLER,
  BIGGER, RESET, DONE); dragging a button moves it, a tap selects it for resizing (0.7–1.5×). DONE calls the `onLayout`
  handlers with `TouchLayout = { [buttonId]: { dx, dy, s } }` (px offsets in the right-handed frame, mirrored at
  placement when left-handed); game.ts stores it in `settings.touchLayout` and `setOptions({ layout })` applies it.

**API** (the only surface other modules use)
```ts
export interface TouchOptions { scale: number; opacity: number; leftHanded: boolean; haptics: boolean; layout: TouchLayout | null }
export type TouchLayout = Record<string, { dx: number; dy: number; s: number }>;
/** CONTRACT §18.5: input.ts owns the instance (Input.touch); the overlay writes it */
export interface TouchState { held: number; latched: number; active: number }
export class TouchControls {
  constructor(host: HTMLElement, state: TouchState, opts?: Partial<TouchOptions>);
  readonly root: HTMLElement;
  setVisible(on: boolean): void;                  // touch mode + a bout on screen (game.ts decides every frame)
  setOptions(o: Partial<TouchOptions>): void;
  setMeters(m: { showtime: number; nerve: number; stageFright: boolean }): void;   // P1's snapshot, per frame, cheap
  setEditLabels(l: { hint; smaller; bigger; reset; done }): void;                 // strings.json touch.*
  onPause(fn: () => void): () => void;
  onLayout(fn: (l: TouchLayout) => void): () => void;
  editLayout(on: boolean): void;
  readWord(): number;                             // held | latched, clears latched (what input.ts does each tick)
  vibrate(pattern: number | number[]): void;
  readback(): Record<string, unknown>;            // M10
  dispose(): void;
}
```
**Input merge (lane SHELL, `input.ts`)**: each sim tick, player 0's word ORs `touch.held | touch.latched`, then clears
`touch.latched` (CONTRACT §18.5). `held` = stick direction bits | held buttons | the ASSIST latch; `latched` = every bit
pressed since the last tick, so a tap shorter than one tick still reaches the sim once. SOCD cleaning runs on the merged
word, as for keys.

## M3 Assists (CHANGED(UI): replaces dyefield's aim assist)

No aim assist. The touch assists are all ALREADY in the game's input model and apply equally to every device:
SIMPLE controls (S + direction specials, S+H supers, ASSIST auto-combo) and the 7-frame SIMPLE buffer (CONTRACT §1).
The ASSIST latch (M2) and the SUPER macro button only change how those same bits are pressed on glass. CLASSIC on
touch is allowed (motions on the stick) but not the default. The optional SWIPE scheme (FIGHTING_DESIGN §5c) is
reserved by the `touchScheme: 'swipe'` setting and is NOT built in v1.

## M4 Play flow on touch (lane SHELL `main.ts` / `game.ts` / `ui/boot.ts`; lane UI prompts)

- No pointer lock anywhere (a fighting game never needs it). The PRESS START card reads TAP TO START in touch mode.
- **Fullscreen + orientation:** on the first TAP TO START (a user gesture), where supported:
  `document.documentElement.requestFullscreen({ navigationUI: 'hide' })`, then `screen.orientation.lock('landscape')`,
  both in try/catch, silent on failure (iPhone Safari has no element fullscreen → M9). A FULLSCREEN toggle sits in the
  title corner and on the pause card (menus.ts), hidden when `document.fullscreenEnabled` is false.
- **Pause triggers in touch mode:** the PAUSE button; `visibilitychange` → hidden; `pagehide`; the rotate overlay
  appearing; `blur`. Never auto-resumes: the pause card needs a tap on RESUME. Online bouts keep running behind the card
  (NETCODE 3.8; the card says so).
- **Rotate overlay** (`boot.ts`): full screen when touch mode and `innerHeight > innerWidth`; a live bout pauses.
- **Platform prompts** (lane UI): the keyboard hint bar hides; the pause card's CONTROLS legend shows the touch buttons
  (L / M / H / SP / PARRY / IMPACT / THROW / ASSIST); the title reads TAP TO START; SETTINGS leads with TOUCH CONTROLS;
  VS / cards / ending read TAP TO CONTINUE.
- **Audio:** unlock on `pointerup` / `touchend` (iOS only resumes an AudioContext inside touchend / click); resume on
  visible. The iOS mute switch silences WebAudio (platform behaviour).
- **WebGL context loss:** `preventDefault`, pause, a "Graphics were reset by the device — RELOAD" card.

## M5 Page hygiene (lane SHELL `index.html`; lane UI CSS)

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`.
- Pinch / double-tap zoom never reach the page: `touch-action: none` on the canvas and `#hp-touch`,
  `touch-action: manipulation` on every button, `gesture*` events prevented (iOS); `visualViewport.scale` stays 1.
- `html, body`: `overscroll-behavior: none`; full height `100dvh` (fallback `100vh`).
- UI chrome: `user-select: none`, `-webkit-touch-callout: none`, `-webkit-tap-highlight-color: transparent`; text inputs
  (room code, display name, initials) stay selectable.
- Touch mode: `contextmenu` prevented on the game and the UI. Hover styles are for mouse only (`@media (hover: hover)`
  and `pointerType === 'mouse'` for hover-moves-focus): a tap never leaves a sticky focus.

## M6 Responsive layout (lane UI `menus.css`, `styles.css`, `hud.ts`, `menus.ts`)

- Every menu screen, card, confirm, the results / ladder / VS / slate cards and the live HUD fit every M0 viewport:
  no control clipped outside the viewport or the safe area; no two controls overlap (judged on the unskewed layout box
  — the comic skew is paint only, and side padding keeps 6 px beyond a notch inset for it); every tap target ≥ 44×44;
  body text ≥ 12 px, buttons and labels ≥ 14 px; long panels (SETTINGS, TRAINING, MOVE LIST, CREDITS) scroll inside
  themselves with momentum; the page never scrolls.
- Phone landscape breakpoint `@media (max-height: 500px)` (+ `(max-width: 700px)` refinements); sizes run on one unit
  `--u = max(8px, min(1vw, 1.7778vh))`.
- **HUD blocks reserve the touch zones** (html.hp-touch): the top band holds both sides (portrait, name, health, NERVE,
  and SHOWTIME moved up from the bottom corners); the TV bug shrinks to a LIVE dot over the timer; PAUSE sits under the
  timer; the host caption becomes a subtitle between the stick's home and the ASSIST chip (hidden below 720 px width —
  the host is heard, not captioned); straps sit under P1's bars; P2's combo counter and callouts stop 278 px in from
  the right edge (left of the THROW / IMPACT column); at most 2 callouts per side; the training frame data becomes a
  one-line strip under P1's bars with an 8-row input display below it. Left-handed mirrors all of it
  (`html.hp-touch:has(#hp-touch.lh)`). The 1-second ROUND / FIGHT / K.O. sweeps may cross the arc (transient, and the
  buttons draw on top).
- The title's HIT PARADE logo is never covered (bug, corner buttons, network plate).

## M7 Performance profile (lane VIEW `renderer.ts`, SHELL `main.ts`)

- Touch + quality auto: start at the floor scale and let the governor climb; DPR cap `min(1.5, DPR)`; shadow map ≤ 1024
  (512 after 5 s on the floor); antialias off at creation on touch devices with DPR ≥ 2 (measure and record).
- Target: hold 60 fps where the phone can, never below 30. Verified here by emulation only (iGPU at phone resolution
  with 4× CPU throttle) — reports say so plainly. Budgets: sim step ≤ 0.25 ms desktop (CONTRACT §4.1) → ≤ 1 ms at 4×
  throttle; GPU memory ≤ 300 MB (iOS Safari tab limit).

## M8 Settings (lane SHELL `ui/settings.ts` fields; lane UI `menus.ts` rows)

Fields (sanitized, persisted, defaulted; old saves load): `touchScale` 0.8–1.3 (1), `touchOpacity` 0.35–1 (0.75),
`touchLeftHanded` (false), `haptics` (true), `touchLayout` (null), `touchScheme` ('pad'; 'swipe' reserved).
SETTINGS shows a TOUCH CONTROLS card first in touch mode (on desktop only with `?touch=1`): BUTTON SIZE, OPACITY,
LEFT-HANDED, VIBRATION, RESET LAYOUT; EDIT LAYOUT itself happens over a bout (drag the real buttons). Changes apply
live through `settings.on()`.

## M9 Install / PWA (lane SHELL `runtime/public/`)

`manifest.webmanifest` (name / short_name HIT PARADE, start_url `./index.html`, scope `./`, display fullscreen with
display_override [fullscreen, standalone], orientation landscape, icons 192 / 512 / maskable 512), `apple-touch-icon`
180, the apple / mobile web-app meta tags. iPhone Safari (no element fullscreen, not standalone): a one-time tip on the
title and the pause card — "Tip: Share → Add to Home Screen plays HIT PARADE full screen." **No service worker**
(no-store, hash-named deploys; a worker cache would serve stale builds).

## M10 Deep links and harness hooks

- `?touch=1|0` (M1). Harnesses emulate devices with Playwright (`has_touch`, `is_mobile`, viewport, DPR, a mobile UA)
  plus CDP `Emulation.setSafeAreaInsetsOverride`, and drive REAL touches with CDP `Input.dispatchTouchEvent`
  (multi-touch). No synthetic calls into TouchControls internals.
- `__HP__.touch()` (the integrated game) and `__UILAB__.touch()` (the UI lab) return `TouchControls.readback()`:
  `{ visible, editing, dir, held, latched, active, stick: {active}, assist, leftHanded, scale, opacity, layout,
  buttons: [{id, rect: {x, y, w, h}, dimmed, hidden}], stats: {presses, dirWords, reads} }`. CHANGED(UI): the shell's
  dev surface should also expose `__HP__.dev.touchWord()` (= `touch.readWord()`) for mobile.py's game mode.

## M11 Gates

- `python _harness/mobile.py --headless` — per M0 device: boot in touch mode + layout; stick sectors (right, 45° →
  up-right, 80° → up, 20° → right, down-left, deadzone, release); each button's bit by a real tap; SUPER macro; the
  ASSIST 1 s latch; three simultaneous touches; PAUSE → card → RESUME by taps; EDIT LAYOUT drag → saved + moved; menus
  by taps; pinch keeps scale 1, no page scroll, a long-press selects nothing; 0 page errors.
  Runs now against the UI lab; `--game` (integration) adds the touch bout: the stick walks P1 ≥ 0.3 m, an L tap makes a
  HIT / WHIFF event, portrait → rotate overlay → landscape → pause card.
- `python _harness/layoutcheck.py --headless` — every menu screen + 8 HUD states × 7 devices (the M0 set + 1280×720 +
  1600×900) against M6 (clip, safe, overlap, 44 px, fonts, scroll, title, HUD-vs-thumb-zones incl. captions / straps /
  combos / callouts).
- Screenshots `_shots/mobile_<device>_<step>.png`, `_shots/layout_<device>_<step>.png`; a reviewer reads them.
- Desktop regression stays green: `menus.py` (keys + synthetic pad), bootcheck, playtest, the probes.

## M12 Lane ownership

- **UI**: `touch/controls.ts`, `touch/touch.css`, `ui/**` except boot / settings / save, `data/strings.json`
  (touch.* copy), `_harness/mobile.py`, `layoutcheck.py`, `menus.py`, this file.
- **SHELL**: `input.ts` (M1 mode, the §18.5 merge), `main.ts` / `game.ts` (M4 flow: construct `TouchControls` with
  `input.touch`, `setVisible` each frame, `setMeters` from P1's snapshot, `onPause` → the ESC pause path,
  `onLayout` → `settings.set({ touchLayout })`, settings → `setOptions`), `ui/boot.ts` (TAP TO START card, rotate
  overlay, fullscreen, home-screen tip), `ui/settings.ts` (M8 fields), `index.html` / `runtime/public/` (M5, M9).
- **VIEW**: M7 renderer profile.
- Cross-lane calls fixed here: the TouchControls API (M2), `Input.touch` (§18.5), `hud.setTouchMode(on)` /
  `menus.setTouchMode(on)` (both also follow `html.hp-touch` by themselves), the M8 field names.

## CHANGED(UI) P2 (2026-09-30)
- **M2 labels fit their discs** (P1 verifier: labels overflowed on an iPhone, DPR 3): words of 4+ letters (PARRY, IMPACT,
  THROW, SUPER, ASSIST) use the condensed face (Bebas Neue); after every layout and once the web fonts load,
  `TouchControls.fitLabels()` scales a label down (never below 9 px) until its measured glyph box fits the chord of its disc
  at the label's half height (minus the 3 px ring and 3 px air). Read-back `readback().labels = [{id, w, avail, fs, fit}]`;
  `mobile.py` gates `labels_fit` / `game_labels_fit` on every device (DPR 2-3).
- **M6 host caption on touch** (P1 verifier D6: the caption covered the fighters' feet): a one-line subtitle on the bottom
  edge BELOW the floor line (24 px high at `max(2px, safe-bottom - 14px)`), between the stick's home and the ASSIST chip;
  measured at 844x390, closest camera: feet end 355 px, the strip starts 364 px. Desktop / kbm: the ticker sits in the top
  band between the show bug and SCORE (styles.css `.hpb-cap`).
- **M6 bonus rounds**: BRAWL BREAK / HECKLER TOSS show the bonus panel at the top right in place of P2's bars (fighter 1 is
  absent), above the button arc.

## CHANGED(UI3D) (2026-09-30, the 3D ring - CONTRACT §35.2 / §35.16)
- **M2 STEP pair:** `stepin` / `stepout` buttons above the stick home (table above), part of `TouchLayout` / EDIT LAYOUT and of
  `readback().buttons`; violet discs with an orbit arc (IN's bows up = away from the camera, OUT's bows down). `readWord()` and
  `TouchState` carry bits 13 / 14 (mask 0x7fff); input.ts SOCD drops both-held to neutral.
- **M6:** P1's combo counter, callouts and the training input display start 176 px in from the left safe edge (right of the
  STEP pair); left-handed, P2's combo / callouts and the input display move in from the right the same way. The pause CONTROLS
  legend leads with the IN / OUT discs (one row: SIDESTEP / HOLD: CIRCLE).
- **M11 gates added:** `mobile.py` - taps on IN / OUT set exactly bit 13 / 14; a held IN stays held across reads and clears on
  release; stick + OUT together (2 touches); the pair sits above the stick base; EDIT LAYOUT drags IN; `--game`: a held IN
  circle-walks P1 round P2 (sidewalk, distance kept, >= 30 deg) and an OUT tap sidesteps (dir 'out'). `layoutcheck.py` -
  `howto` and `movelist_patch` screens on every device.
