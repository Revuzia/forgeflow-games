# UI_SQUISH_NOW: honest audit of the current Squish Keeper interface (short form, stopped early on the coordinator's order)

Source of truth: stable build `C:/Users/TestRun/AppData/Local/Temp/cdnb/games/wobblehoard/dist` (assets dated 2026-10-07 22:01) plus a read of `src/ui/*`. Screenshots (219 PNGs, 1280x800, 390x844 @2x, 320x568, 844x390; prefixes A boot/errors, B play session, C sub-states, CF forced-colors) are in `<scratchpad>/ui/squish_now/shots/`. Scripts and JSON are beside them.
**Caveat:** the dist is older than the working tree. It lacks the landscape / 320 px strip rules (`hoard.css:442-495`) and the "T toys, C cut" Settings text, so the `small_` and `land_` shots show the layout before SHELL-4 fixes. Every run: 0 console errors, 0 CSP violations.
**Gate note:** the brief's "G0 = 1229 KB" is stale. `vite.config.ts:26-31` (owner, 2026-10-08) now says G0 = 3 MB folder, G0b = 600 KB first-play gzip. Measured dist: 1.626 MiB, first-play gzip 339 KiB, CSS 49.4 KB (10 KB gzip).

## 1. Inventory
- **About 24 surfaces/states captured:** boot line, 12 s watchdog line, title (warming and ready), 3 error cards (no WebGL, boot failure, context give-up), play HUD, quick switcher (max 5), meter ring, capsule button and pips, reveal plate, Settings (panel on desktop, bottom sheet on phone), Hoard shelf / filters / grid / Daily gift / Today, detail card (owned, unowned), merge pad, slot picker, last-copy modal, Tidy-up, Toys tray, Cut bar, Snap bar, toast, offline banner, "Put back" mat chip.
- **Controls:** about 26 control families. Largest per-state counts: Hoard filters 34, Hoard shelf 32, merge 20, card 16. Settings = 4 sliders, 6 switches (5 when haptics are off), 2 radios, 1 select, close. HUD = 8 (mute, gear, Hoard, Toys, capsule, 2 switcher, play target).
- **Tokens (`theme.ts`):** 15 colour tokens (8 palette + 7 derived), 20 contrast pairs, all pass (lowest: control edge on panel 3.87). There are **no** tokens for type, spacing, radius, elevation or motion. `--radius` has 0 uses.
- **CSS drift (`styles.css` + `hoard.css`, 1,980 declarations):**
  - 21 distinct radii (85 uses)
  - 22 font sizes (109 uses)
  - 33 box-shadows
  - 22 transitions
  - 12 z-indexes
  - 83 padding values
  - 72 px literals
  - 4 keyframes (`wob`, `breathe`, `wh-pulse`, `wh-dot`)
- **Fonts:** zero `@font-face`. Stack starts `ui-rounded, "SF Pro Rounded", ...` and resolved on this PC to **Segoe UI Black (900)** and **Segoe UI Bold (700)** (`D_fonts.json`). Display type is just heavy system bold, and it will differ per OS. Weights in use: 700/800/900, plus 400 for body copy.
- **Icons:** `dom.ts` has 6 stroke icons (gear, close, soundOn/Off, table, float, stroke 2). `toyTray.ts:35` has 4 more (hand, cut, snap, star; stroke 1.8 set in CSS). Plus a 3-path cabinet glyph (`panel.ts:619`), a capsule glyph (`meterRing.ts:77`), 6 tier gems (`gem.ts`) and procedural species icons.
- **Ad-hoc text glyphs (11 kinds):** ♥ ♡ ◷ ‹ → + ? … “ ” · (`panel.ts:267,268,327,357,374`, `merge.ts:93,97,205`). Counts are plain text: "x3", "(14)".
- **Hard-coded colours outside tokens:** about 39 literals (`styles.css` 9, `hoard.css` 21 of which about 16 are black shadow alphas, `boot.css` 3, `index.html` 1, `gem.ts` 2, `speciesIcon.ts` 3), plus 16 tier hexes in `core/rarity.ts`.
- **Touch targets under 44 px:** 3 (2 distinct controls). Hoard button 42x44 at 320 px; the native Tidy checkbox 22x22 (its row is 44 px tall); the nametag (see weakness 4).
- **Control states:**
  - `:active` exists for 3 of 26 families (icon-btn, capsule-btn, cta).
  - 12 `:hover` rules, 0 `@media (hover:hover)` guards (sticky hover on touch).
  - HUD buttons compute `transition: all 0s`, so hover snaps with no easing.
  - Sliders, switches and plinths have no hover state.
  - No `prefers-contrast` or `forced-colors` rules.
- **UI sound: none.** No audio call in `src/ui`, `hudBinding.ts` or `hoardEnv.ts`; the `SquishAudio` interface (`contracts.ts`) has no UI voice. Haptics fire only on squish events.
- **Not present:** pause menu, title menu, how-to-play, credits, achievements, stats, jelly display type, `_harness/uikit`, and the Cut "Clean cut / Minis" switch (0 matches in `src`).

## 2. Where the word "Toys" appears (what a toolbar replaces)
Visible to players:
1. Button label `toyTray.ts:53` (`toys-btn-word`). Hidden at 480 px and under by `hoard.css:500`, so phones show only a star icon.
2. Tray heading `toyTray.ts:56` (`.toys-title`, `hoard.css:376`, 12 px uppercase, tracked, aria-hidden).
3. Settings strings (source only; the dist is older): `settingsPanel.ts:84` ("T toys" in the shortcut hint) and `:104` (keys line).

Accessibility names:
4. Menu `aria-label` "Toys" (`toyTray.ts:55`).
5. Button `aria-label` "Toys, Hand in hand" (`toyTray.ts:71`).

Wiring (not visible):
6. `aria-controls="wh-toys"` and the `T` key (`keyboard.ts:2,31,32,92-96`, `boot.ts:146`, `hudBinding.ts:46,94-102,194,318-338`).
7. CSS classes and states: `.toys`, `.toys-btn*`, `.toys-title`, `.toys-list`, `.toy*`, `body[data-toys]` (`hoard.css:333,359-382,391,410,460-482,497-508`).
8. Icon key `'toys'` (a star path, also the Hand-state icon, `toyTray.ts:39,52,69`).
9. Harness: `browser_shell.mjs` has 50 lines with "toys" (`.toys-btn` 32, `.toy[data-tool` 22, `wh-toys` 2); `_spec/FUN.md` and `UI.md` also mention it.

Keep (product word "toy", not the button): `titleCard.ts:31,35` ("A squishy toy that squishes back"), `hudBinding.ts:73` (canvas aria-label), the `index.html` meta description. Shortcuts today: T tray, C Cut. Snap has no key, and Hand is reached by Escape.

## 3. Worst weaknesses (file and screenshot)
1. **Toys is a hidden popover, not a toolbar** (`B_desktop_15_toys_open`, `B_phone_15_toys_open`). The active tool is invisible until opened. The Hand state shows a star, which reads as "favourites". The tray covers the squishy and the hint pill. Files: `toyTray.ts`, `hoard.css:359-388`.
2. **Title lockup is flat** (`A_desktop_02_title_ready`, `A_phone_02`). Per-letter `color-mix` gradient text on Segoe UI Black with a hard 4 px drop-shadow (`styles.css:436-448`). No gloss, no jelly. The promise pill is a heavy dark slab that overlaps the squishy's tip (desktop) and is oversized on phone.
3. **Everything is bold** (29 uses of weight 900, 30 of 800). Merge pad shows 24 text styles at once (11 sizes). No hierarchy (`B_desktop_36_merge_pad`).
4. **Phone bottom row is overstuffed** (`B_phone_01_play_hud`, `B_small_01_play_hud`).
   - Nametag clips "COMM" (tier word).
   - At 320 px the name becomes "D…" and "Cri…".
   - The capsule label disappears.
   - With a "Put back" chip and a capsule waiting, the nametag collapses to a 22 px sliver (`B_phone_42_mat_out_chip`, `C_phone_29_mat_out_chip`).
   - Source cause: the stacked `.hud-bottom:has(...)` overrides in `hoard.css:42-58`.
5. **Tidy-up names break one letter per line** on phone and 320 px (`B_phone_41_tidy_pad`, `B_small_41_tidy_pad`). `.out` is a 6-column grid with `overflow-wrap:anywhere` on `.out-name` (`hoard.css:255,260`). A real layout bug.
6. **Hold-to-merge label is unreadable while filling** (`C_desktop_24_merge_hold_forced_55pct`). Ink label on the unfilled track measures 1.48:1 (`hoard.css:273-280`).
7. **HUD wordmark sits straight on the scene.** Measured on pixels: worst 3.4:1 on desktop, 2.99:1 on phone (17 px, so not "large text") (`B_phone_01`, `contrast.cjs`).
8. **Forced-colors is broken** (`CF_desktop_00`, `_01`, `_02`):
   - Title letters and the HUD wordmark render as black blocks (`-webkit-text-fill-color: transparent`).
   - The "Open" capsule button is a black pill.
   - Switch and slider fills vanish, so on/off is not visible.
   - The selected Table/Float option looks the same as the other.
9. **No material or depth.** Panels are opaque `#1d1538` with a single shadow. `backdrop-filter` appears only on `.icon-btn` (`styles.css:107`). Only `.cta`, `.capsule-btn` and `.cta-btn` have a "gel" lip. This is far from the "soft jelly glass" in UI.md section 2.
10. **Press and hover are inconsistent** (see section 1). Disabled buttons are muddy brown at opacity .5 ("Take this one", "Saving…": `B_desktop_31_hoard_gift`, `B_desktop_25_snap_saving`).
11. **Toasts** (`A_desktop_09`, `A_phone_09_toast_contextlost`): a single text pill at bottom 24 px that sits on top of the Hoard and Toys buttons. On phone it wraps to 3 lines and covers the nametag. No icon, no variants (`styles.css:513`).
12. **Offline banner collides with the reveal plate** on desktop (`B_desktop_43_forced_offline_banner...`, `styles.css:521` vs `:261`).
13. **Hoard header has two identical X buttons** stacked 8 px apart (close the Hoard, dismiss the note) (`B_desktop_26_hoard_shelf`).
14. **Settings is a long run-on** (60-word keys line `settingsPanel.ts:104`; panel scrolls 995 vs 714 px on desktop, 915 vs 489 on phone). Native select and coral-ringed slider thumbs clash with the amber accent (`B_desktop_13_settings_bottom`).
15. **Loading is a bare 18 px text line** (`A_desktop_00_loading_boot`). "Warming up…" is a dead-looking button at opacity .7 (`A_desktop_01`). Empty states are sparse: Gift and Today panels are half empty (`B_desktop_31`, `_33`).
16. **Rare plinth border reuses the default control edge colour** (`hoard.css:141`).

## 4. Keep
- Palette and measured contrast table: 20 pairs, body text 15 to 16:1 (`theme.ts`).
- Focus ring: 3 px lagoon with offset 2, about 10:1; all 12 Tab stops show it (`B_desktop.json` focus tour).
- 44 px targets everywhere except the three above. Safe-area insets. Dialog roles, live region, roving-tabindex grid, Escape order, focus return.
- Rarity is never colour-only: gem shape plus text label (`gem.ts`).
- Procedural species icons and silhouettes for unowned species (the best-looking part: `B_desktop_26_hoard_shelf`).
- "Wake it up" CTA: amber gel, 6 px lip, coral glow (`styles.css:464-487`). Friendly error card with the blob mascot (`A_desktop_07_error_nowebgl`).
- Meter ring with pending arc and sparks. Boot watchdog line without script (`boot.css`). Calm / reduced-motion handling (title animation confirmed off). Kind copy tone.
- Strict CSP with CSSOM-only styles (0 violations in every run).

## 5. Not done (stopped at the coordinator's request)
No full-text contrast sweep beyond the wordmark; no toast shot at 320 px; no touch-hover test. The landscape and 320 px captures predate the SHELL-4 strip layout. The `plate_wait` step timed out in the play runs, but the plate was captured (`B_desktop_08_capsule_open_t2`).
