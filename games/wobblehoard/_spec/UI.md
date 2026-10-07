# UI: an AAA-standard interface for Squish Keeper (menus, buttons and their states, title, type, motion, sound)

**Status:** owner request, 2026-10-07 (chat): "Make nicer menus, buttons select, title, font, etc. It should be AAA+ industry standard."
Designed here; built by the SHELL lane (`src/ui/**`, `src/ui/*.css`, `index.html`, `src/shell/hudBinding.ts` for markup hooks), with a small AUDIO part (UI
sounds) and an independent verification (art direction, accessibility, performance). The 3D toy is already strong; the interface around it is clean but basic
(a flat gradient title, plain glass pills, system text). The goal: the interface feels as crafted as the squishy, on a phone and on a desktop.

## 1. Owner decisions (chat, 2026-10-07)
| # | Decision |
|---|---|
| 1 | **Fonts: no font files, no outside assets** (the zero-assets rule and the strict CSP stay: `font-src 'none'`). Typography is made with (a) an **original drawn logo** (the SQUISH KEEPER wordmark as our own vector or CSS art, jelly gloss and wobble) and (b) a carefully tuned **system font stack** with a real type scale, tabular numerals for the meter and counts. |
| 2 | **Queue place: right after the shell stage** (SHELL-4: Cut tool, toy tray, Snap), so the new tray and bars are restyled with everything else and the preview and CDN build looks polished. The physics round and ffgames follow. |

## 2. The quality bar (what "AAA" means here, and how it is checked)
1. **One design language, used everywhere**: "soft jelly glass". Frosted glass panels with an inner highlight and a soft layered shadow; gel buttons with a gloss and a press that squashes and springs back; superellipse-feeling radii; three depth layers (scene, HUD, modal). Every screen, bar, card and toast uses the same tokens: nothing is styled one-off.
2. **A complete state matrix for every control**: default, hover, focus-visible, pressed, selected / on, disabled, loading and error, designed and screenshot-checked (see the UI kit, section 5). No control has a missing or default-browser state.
3. **Hierarchy and typography**: one scale (display / title / heading / body / caption / label, with line heights and tracking), one numeric style, titles in caps with tracking, no more than two weights on a screen, readable at 320 px. Text never sits on a busy background without a plate or scrim that measures 4.5:1.
4. **Motion with purpose**: springs (critically damped, 120 to 260 ms), a press squash (about 0.96 with a small overshoot), panels that enter and leave with a short choreographed stagger, the title letters that wobble when poked. Only `transform` and `opacity` animate; no layout thrash; reduced motion and Calm effects (DESIGN 6.6) replace motion with fades, and nothing flashes.
5. **Sound and touch**: a small procedural UI sound set (tick on hover on a mouse only, soft press, select, toggle on and off, open, close, error), quieter than the toy, ducked under the music, off with mute; light haptics on touch where supported. Never required to play.
6. **Accessibility is part of "AAA"**: WCAG 2.2 AA at least: text 4.5:1 and UI parts 3:1 (measured by a script on the real pixels, not by eye), a visible focus ring of 3:1 on every control, touch targets of at least 44 CSS px, reflow at 320 px, keyboard order and Escape handling, live-region lines, `prefers-reduced-motion`, `prefers-contrast` (more contrast: solid plates, no blur), `forced-colors` (high-contrast mode still usable).
7. **Performance and size**: the interface costs at most 1 ms of main-thread time per frame during play, no extra canvas, no layout shift when a state changes; the whole production bundle stays inside the G0 gate (1229 KB; about 1139 KB today, so the whole UI polish has roughly 90 KB to live in: vector icons and CSS, no images).
8. **Nothing breaks**: every existing shell check still passes (the three title checks may be re-specified with a written reason only if the DOM of the title changes: the accessible name stays "SQUISH KEEPER", one h1), the strict CSP holds (no inline script or style: set styles through the CSSOM only), the product rules hold (no paywall, ads or currency, kind wording).

## 3. The screens in scope (each gets the full treatment)
Title card and boot; the play HUD (wordmark, name plate, meter ring, hint, quick switcher, Hoard and Toys buttons, capsule dock, settings and mute buttons); the Settings panel (sliders, switches, selects, segmented controls, the keys line); the Hoard (gallery, filters, sorts, detail card, hearts, the Practice shelf label); the merge pad (previews, odds lines, hold button, the last-copy modal, results); Tasks and Restock; the toy tray, the Cut bar and the Snap bar; the reveal and ceremony plates; toasts and live announcements; error and offline cards; the loading state. Phone, tablet and desktop, portrait and landscape.

## 4. The title (the first thing every player sees)
An original **SQUISH KEEPER** lockup: letters drawn as jelly (a gradient body, a glossy highlight, a soft contact shadow), a subtle idle wobble that follows the 3D toy, a squish when the letters are poked, a short, confident intro on the first frame (letters drop and settle, the tagline fades in, the button breathes). One big, inviting primary button ("Wake it up") with the full gel treatment and a clear focus state, the sound note beneath it, the live 3D scene behind a gentle scrim. Reduced motion: a static lockup and a fade. Accessible name stays "SQUISH KEEPER" (one h1); the in-game wordmark uses the same art at small size.

## 5. How it is built and checked
**Design system first.** `src/ui/theme.ts` stays the single source of tokens (colour, type scale, spacing, radii, elevation, motion durations and easings); the CSS files consume them as custom properties. Then the shared components (buttons, switches, sliders, segmented controls, chips, cards, panels, modals, tooltips, toasts, icons), then the screens in three batches (title and HUD; Settings, Tasks, Restock; Hoard, merge pad, tray and bars).
**The UI kit.** A harness page `_harness/uikit/` shows every component in every state at 1280x800, 390x844 and 320x568, in normal, Calm and high-contrast, so the whole system can be seen, screenshotted and compared at once. It is also the verifiers' map.
**Icons.** One original icon family (SVG paths in code, one stroke width, rounded terminals), replacing every ad-hoc glyph.
**Audio (small).** `SquishAudio.ui?({ kind })`, additive and optional, procedural, in the existing synthesis style; the shell calls it on press, select, toggle, open and close; rate-limited; never on mobile hover.
**Checks.** A contrast script over the real rendered pixels for every text and control; a keyboard walk of every screen; a 44 px target check on touch; reflow at 320 px; reduced motion, Calm, `prefers-contrast` and `forced-colors` runs; the bundle gate; the existing browser shell harness; frame cost with the HUD animating.
**Independent verification** (three fresh verifiers): (1) an **art director** who scores every screen against the bar (hierarchy, consistency, polish, delight) and lists anything cheap or inconsistent with a screenshot; (2) **accessibility and robustness** (the measured items above, keyboard, screen-reader names, small phones, long names, RTL-safe layout, the offline and error states); (3) **performance, size and regression** (bundle, frame cost, the whole shell harness, the CSP).

## 6. Out of scope here
New game features, new screens that have no feature behind them, localisation (the layout must survive longer strings, but translations are not part of this), changing the 3D look.
