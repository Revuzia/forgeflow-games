<!-- B0:BEGIN -->
# UI_RUN: running report (resume file; one block per engineer, edit only your own block)

## B0 Foundations (UI-A), leg 1 (ui-b0), started 2026-10-08
**Rule:** read this first; continue from "Next"; never redo "Done".

### Done
- Read UI_BUILD.md, UI.md, RESUME.md, UI_SQUISH_NOW.md; verified UI.md 3.1 numbers with theme.ts's own formula (all match).
- `src/ui/theme.ts`: colour (surface2/3, gelHi, lip, ok, plumBright, selTint, glass, scrim, ring + halo, coral gel stops, wash, gloss, rim), TIERS (rarity frames, copied from rarity.ts), MEDALS, JELLY stops, type, space, radii, sizes, elevation, motion, ease, z, ring. CONTRAST_PAIRS 20 -> 85, all pass. `CONTRAST_PAIRS` and `JELLY` are `/* @__PURE__ */` so the game bundle drops them (checked in a scratch build: 0 hits).
- `src/ui/icons.ts` (60 icons, one family), `motion.ts`, `layout.ts` (layoutFor, installLayout, bindSlots, KIT_SIZES).
- `src/ui/base.css` (body-level `--k-*` roles), `kit.css` (all 3.3 components, `k-` prefix), `a11y.css` (Calm, Quality low, contrast-more, forced-colors hooks).
- `_harness/uikit/` (index.html, kit.ts, kitpage.css, mock.ts, parts.ts = the reference DOM, pages/{types,index,b0}.ts, shoot.mjs) and `_harness/probe_uikit.ts` (50 checks, auto-run by `npm run check`).
- Sheets read and fixed: forced-colors backplate on selected controls, invisible busy dots, 4-way segmented wrapping mid-word, disabled+checked segment, 22 px links, clean/shelf icons, 40 px segment faces (now 44), 568x320 kit overflow (kit page only).
- Green (final): tsc --noEmit clean; probe_app 183/183; node_checks 0 FAIL; probe_uikit 50/50; browser_shell --only=desktop-boot,settings-panel-desktop,reduced-motion --port=5432 37/37; shoot B0: the full 8 sizes x 4 modes run had 4 failures, all the kit page's own 568x320 overflow (fixed); re-run of 568x320 / 844x390 / 320x568 x 4 modes = 12 pages, 0 failures, 0 controls under the 0.85 hit-box floor. Scratch build: G0 1156 KB of 3072, G0b 345 KB of 600 (CONTRAST_PAIRS and JELLY are absent from the bundle).

### Decisions (with reasons)
- UI.md's "plum #b894f2" collides with `PALETTE.plum` `#2a1744` that `probe_app.ts:165` asserts exactly. Not loosened: new colour = `DERIVED.plumBright` (`--wh-plum-bright`); jelly tone name stays `plum`.
- Body attribute is `data-calm="true"` (hudBinding.ts:178), so hooks use `body[data-calm="true"]`, never the bare attribute (it also matches "false").
- Inline `:root` styles (installTheme) beat sheet `:root` rules, so mode overrides live on `body` as `--k-*` roles (base.css).
- New font stack is `--wh-font-ui`, NOT `--wh-font`: `styles.css:5` owns `--wh-font`; overriding it restyles every existing screen. B3a swaps it when it moves the HUD rules.
- Kit classes are `k-` prefixed (old `.panel .toast .seg .icon .cta` coexist). base/kit/a11y.css are imported ONLY by the kit page at B0; wiring = three `import` lines (main.ts or hudBinding.ts) at B2/B3a. dom.ts / toyTray.ts / panel.ts / meterRing.ts untouched (their icon paths are verbatim in icons.ts, so migrating is pixel-identical).
- Forced hover / focus / pressed states on the sheet are painted by CDP (`data-force`), so kit.css carries no test-only selectors.

### Next
B0 is complete. Orchestrator: commit and apply the requests below. Next batch: B2 (glyph sheet and V1 gate first). The kit page takes ?batch=B2 once B2 adds pages/b2.ts to pages/index.ts.

### Open stubs / requests to the orchestrator
- K05 CSS: base+kit+a11y = 25.5 KB minified (5.8 KB gzip, lightningcss). The tree's CURRENT dist CSS is 53.0 KB (scratch build; UI.md's "42,087 B" is the 2026-10-05 dist), so the 80 KB cap leaves 27 KB for ALL of B0..B7. B0 is a ratchet in probe_uikit (<= 26 KB); B2-B7 must delete the old rules their kit classes replace (styles.css 23 KB min, hoard.css 29 KB min), or K05 must be re-specified.
- B3a: `Settings.quality` has no body hook yet: set `body.dataset.quality` (a11y.css `body[data-quality="low"]`).
- B5: move rarity frame / tell hexes out of `core/rarity.ts` (copy now in theme.ts `TIERS`; probe_uikit checks they match until then).
<!-- B0:END -->

<!-- B1:BEGIN -->
## B1 UI sound (AUDIO): DONE in leg 1 (ui-b1)
- **Files:** new `src/audio/ui.ts`, `_harness/audioview/ui_checks.mjs`, `_harness/audioview/engine_tests_ui.js`; edited `src/audio/engine.ts` (`ui()` hook), `src/input/haptics.ts` (`uiTap`, `UiTapKind`, option `coarse`), `_harness/probe_audio.mjs` (`--only-ui`, `--no-ui`, lab row), `_harness/audioview/view.js` + `index.html` (hooks, lab row). `core/settings.ts` needed nothing (the freeze already had `uiSounds`).
- **Last green:** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (clean); `node _harness/probe_audio.mjs --only-ui --port=5435` = 180/180 (2 min). Existing live engine suites on this saturated machine fail 10-12 timing / real-time-audio checks WITH and WITHOUT the change (same classes, different sets per run); not a regression.
- **Measured (nobody listened):** every kind's output peak <= 0.1194 (-18.5 dBFS), worst case over 44.1/48 kHz and start phase; kinds 25..590 ms audible, 108..1266 ms declared end; edges click-free; pitch set D E F# A B, strongest peak within 1 cent of a declared note; 206 overlapping pairs <= 0.1197. Bundle: +3,649 B raw, +1,277 B gzip first-play (real A/B `vite build`).
- **Lesson:** a voice rendered 10 ms into a fresh context under-reports short sounds by up to 1.3 dB (cold compressor); calibrate in the running engine (the probe renders at t0 = 0.3 s).
- **Do not edit `src/audio/*` or `_harness/audioview/*.js` while a probe runs** (the Vite dev server full-reloads the page).
- **Requests to the orchestrator:** (1) `AudioSettings.uiSounds?: boolean` (additive, contracts.ts) and `settingsCtl.ts` passing `uiSounds: s.uiSounds` in `audio.setSettings` (the engine already reads it structurally; probe proves it). (2) B4 `ui/uiSound.ts`: call `hoverSoundAllowed(e.pointerType)` (exported by `audio/ui.ts`) before a pointerenter 'tick', pass `calm`, call `haptics.uiTap` itself. (3) Listening check: ui sounds do not make room in the music (music.ts untouched); in the offline mix tick, off, open, back, close sit 4..14 dB under the music's RMS over their span: if they get lost, add ROOM_KINDS entries (an audio change, needs independent audio verification).
- **Observation (not ours):** two identical offline engine sessions differ by 4.2e-3 in the `land` window (seed 77, `_harness/audioview/engine_offline.js`): a pre-existing run-to-run difference of the land voice.
<!-- B1:END -->

<!-- B2a:BEGIN -->
## B2a Jelly glyph sheet (UI-B), leg 2 (ui-b2a): DONE, STOPPED FOR THE OWNER'S APPROVAL
**Rule:** nothing is built on the lettering until the owner approves it (no title card, lockup, boot, panel headings).

### Done
- `src/ui/jelly/glyphs.ts` (50 glyphs, one centre-line path each, cap-100 grid), `jelly.ts` (ensureJellyDefs, jellyWidth, jelly with optional bounce), `jelly.css`.
- Kit page `_harness/uikit/pages/b2.ts` (batch B2 in `pages/index.ts`; sections jelly-words, jelly-alpha, jelly-big, jelly-tones, jelly-anatomy, jelly-spacing), rows in `kitpage.css`.
- `_harness/uikit/glyph_sheet.mjs`: K14 counter raster test + the six PNGs (`node _harness/uikit/glyph_sheet.mjs [--counters] [--shots] [--try=cands.json]`, own vite on 5431).
- PNGs + sheet_report.json (holds the counter numbers) in `_handoff/reports/ui_glyph_sheet/` (6 PNGs, 455-607 KB each).
- Last green: tsc --noEmit clean; glyph_sheet.mjs 0 failures (counter rule worst ratio 1.19); Calm sheets byte-identical to normal below the header line.

### Decisions (with reasons)
- Weights are NOT UI.md's start values: md body 20 / outline 26 (spec 18 / 30), sm body 18 / outline 25 (spec 14 / 22). The counter rule limits the OUTLINE (clear = centre distance - outline; B and 8 have 40), not the body, so a heavier body costs nothing. Shade pass is 20 wide, 3 down (flush with the outline edge).
- A is an arch (round apex), 4 has a curved diagonal, 8 is two stacked rings, 6 and 9 open their aperture (a closed pocket made a second hole), 0 is narrower than O. A triangle A or 4 cannot reach 4 px at cap 36 under any outline above 20.
- Commands used: M L H V C Q. ADV 10, SPACE_W 40; round and diagonal glyphs have tighter sidebearings (x from 7 to 9 where a round or diagonal side overshoots).
- Gloss is a user-space gradient (white .9 at y 5 to .25 at y 95); body gradient 3 stops. sm = 3 passes, flat. No-drawing fallback (forced-colors, contrast more) shows the real text in system 800 (forced-colors checked by picture).
- `bounce` (fixed tilt and lift per letter) is OPTIONAL and shown for the owner's choice only.

### What the pictures show (art-director reading of `ui_glyph_sheet/*.png`)
- **Jelly:** a body gradient (pale top, saturated middle, darker belly), a darker rim under every stroke, a white gloss line that fades toward the base, a soft contact shadow. Reads as glossy caramel candy at 56 px and up. On the dark panel the ink outline vanishes (ink is almost the panel colour), so the silhouette is the body; on white the ~1 px outline (1.1 px at cap 36) draws the edge.
- **Letterforms:** one weight, round caps, soft corners (E F L spine corners, Z, rounded bowls); arch-topped A, stem-plus-chevron K, curved-diagonal 4, two-ring 8, 0 narrower than O. Rhythm is even in HOHOH / OOOO / HHHH, AVATAR, LTRY, ILLINOIS after the optical-spacing pass (round and diagonal sides tightened, ADV 10).
- **Cap 24 (sm):** flat colour, 3 passes, A-Z, 0-9 and punctuation all legible; the look-alike row (O 0 Q, I 1, S 5, B 8, Z 2, G 6) holds at 24 and 36. Jelly cues are minimal there by spec.
- **Counters (K14, outline silhouette, 4x supersampled):** cap 36 inscribed-circle px: A 8.8, B 4.8+4.8, D 8.3, O 10.8, P 7.8, Q 9.4, R 6.3, 0 5.5, 4 5.5, 6 7.8, 8 4.8+4.8, 9 7.8 (rule 4); cap 24 smallest 3.3 (B, 8; rule 2). Every size from 24 to 120 passes.
- **390x844:** no horizontal scroll; long words (UNCOMMON, LEGENDARY, WAKE IT UP) are shrunk to fit by the sheet (the product needs fitJelly). Calm: byte-identical (nothing animates yet); forced-colors was screenshotted and shows the real text in system 800 (contrast-more uses the same rule via --k-jelly-svg; not pictured).
- **Weak spots, honestly:** pale tones (cream, common, mythic, diamond, silver) look washed on white at cap 36; rare (purple) is the dimmest tone; `&` and `%` are the least refined glyphs; the 3 has a pointed waist; the optional bounce at 1.2 is subtle and lets a few pairs touch; the lockup needs a real scene behind it to judge the outline.

### Next (after approval)
B2b: titleCard lockup (fitJelly, setJelly, pokeJelly, wobble), boot card, brand in hud.ts. Wire jelly.css (one import line). Measured cost: +2.7 KB gzip JS, +0.6 KB gzip CSS, glyph table 3.1 KB raw of 8 KB.

### Requests / open
- None for contracts.ts. Do not edit `src/ui/jelly/**` while a probe runs against port 5431.
- The mythic tone is near-white with a blue shade; the prism (TIERS.mythic.prism) is B5's.
<!-- B2a:END -->
