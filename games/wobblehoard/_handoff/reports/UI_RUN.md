<!-- UI_RUN.md keeps only the blocks still being worked or with open reds. Finished blocks B0, B1, B2a, B2b, B3a, B3b, B3c, B4a, B4b, B5, B6a, B6b are in UI_RUN_ARCHIVE.md (read their 'Requests' there). -->

<!-- B3c block archived to UI_RUN_ARCHIVE.md (committed in df06cae1, 2026-10-09 by B4a) -->

<!-- B4a block archived to UI_RUN_ARCHIVE.md (2026-10-09 by B7; read its 'Requests' there) -->

<!-- B6a block archived to UI_RUN_ARCHIVE.md (2026-10-09 by B6b; its Requests: B6b consumed the screen ones, the seeding request is repeated in the B6b block) -->

<!-- B6b block archived to UI_RUN_ARCHIVE.md (2026-10-09 by B7; read its 'Requests' there) -->

<!-- B4b block archived to UI_RUN_ARCHIVE.md (2026-10-09 by B7; read its 'Requests' there) -->

<!-- B7:BEGIN -->
## B7 Polish and CSS cleanup (UI-A), legs 3 + 4 (ui-b7): DONE, awaiting commit (full report: `_handoff/reports/UI_B7.md`; pictures `_handoff/reports/ui_screens/`, 12 sheets)
**Files:** NEW `_harness/uikit/{css_audit.mjs, owner_sheets.mjs}` (owner_sheets: `--sweep` one game / 8 sizes, `--coverage`, `--sounds`, `--stress=1`, `--mode=`, `--compose`, `--rings`), `_harness/uikit/kitpage.css`. EDITED `src/ui/{layout.ts (narrow), toolbar.ts (--dk-half), toolbar.css, hud.css, overlay.css, kit.css, a11y.css, styles.css, hoard.css, title.css, trophies.css, screens/{screens.css, photo.css, screenCopy.ts}}`, `_harness/{probe_uikit.ts, browser_shell.mjs (two de-flaked rows)}`.
**Numbers:** K05 dist CSS 119 698 B raw (cap 120 000), 25.0 kB gzip summed per file; 302 B headroom (any new rule needs a deletion). K13 all ok. K08 calm / contrast / forced 61 scenes each ok; K03 stress (RTL, Arial, 50-char nickname) 93 rows ok; K09 table: 51 control kinds all wired; K16 toolbar_check 43/43. Probes green (uikit 62, screens 43, overlays 21, boot 30, optbar 42, portal 81, trophies 31, app 183); title_checks 59, b4b_checks 78; browser_shell sections listed in UI_B7.md green after two de-flakes. tsc 0.
**Found and fixed:** long names slid under the dock (fixed 276 px clearance vs a 772 px dock): `--dk-half` is measured now; tablet landscape 820-1119 px: compact dock (`WIDE_FULL_MIN_W` 1120, ask: UI.md 4.2); Settings side panel covered the dock; tiny trophy toast was two lines; a busy opener lost its icon; title chips keep words on tall phones.
**Open / next engineer:** B8 verify. Weak spots are in UI_B7.md (358x201 Menu shows 4 of 6 rows; offline + error toast at 358; merge heading flat; no exit animations). K11 strip / tiny cover rows are green only because RENDER SR2 (`render/framing.ts`, uncommitted) is in the tree.
<!-- B7:END -->

<!-- FLOAT:BEGIN -->
## FLOAT Table | Float in the toolbar (owner 2026-10-09; ui-float): DONE, awaiting commit
**Files:** `src/ui/{toolbar.ts,toolbar.css,base.css,settingsPanel.ts,screens/screenCopy.ts}`, `src/shell/hudBinding.ts`; harness `browser_shell.mjs` (NEW section `toolbar-gravity`), `probe_screens.ts`, `probe_uikit.ts`, `uikit/{b4b_checks,toolbar_check}.mjs`, `uikit/pages/b3.ts`. Pictures: `_handoff/reports/ui_float/`.
**What:** `div.dock-grav[role=group]` of two `button.dock-grav-opt` (Table | Float, aria-pressed, G) inside the Tools toolbar (arrows walk it, still ONE Tab stop); tooltip, live "Table" / "Floating", one on / off cue per CHANGE (G sounds too), caption chip for finger / key, rests in a ceremony. One setting for pair and G key. Settings row + copy GONE (`TOOLBAR_SETTING_KEYS`); setting and stored value stay. `fit()`: Hoard icon-only, then pair behind More, then tools; a strip bar keeps 320 px.
**Real game:** 1280, 888x500, 390, 844x390, 568x320, 632x355: pair in the tray, 44+ px, no overlap; 390: Hoard icon-only; 320x568: pair behind More; **358x201: Hoard Hand Cut More(Snap, Table, Float)** (5 x 44 + gaps = 236 > 206 free); strip < 700 px with a bar open: pair behind More.
**Green:** tsc 0 | probe_app 183, optbar 42, screens 43, boot 30, overlays 21 | probe_uikit 60/61 (red = base.css check, B7's, same without FLOAT) | 12/12 mutants | browser_shell toolbar-gravity 41, toolbar 13, toolbar-phone 6, desktop-boot 18, settings-panel-desktop 15, keyboard-only 12, reflow 20, hoard-meter-line 5 | toolbar_check, b4b keyboard 23/23, kit shoot 8 sizes 0 failures | K05 119 994 / 120 000 B.
**Re-specified** (the owner moved Table / Float to the toolbar on 2026-10-09): Settings gravity rows, toolbar arrow walks, b4b Tab walk 14 -> 13.
**Risks:** `toolbar` 1.4 s caption check failed in 3 loaded runs, 13/13 alone; K05 has 6 B left; a desktop Settings panel covers Float at 1280.
**Requests:** UI.md 4.2 / 4.5 / 6 (tiny More row, "Table" / "Floating", Feel without Gravity); commit.
<!-- FLOAT:END -->

<!-- UIFIX:BEGIN -->
## UIFIX Verifier findings v1/v2/v3 (ui-fix, 2026-10-09): MAJORs fixed in code, awaiting commit (live tree, no git write)
**Re-run on each finding's own repro** (real game, 8 kit sizes, seeded Hoard; px):
- **K02-a** chips: `.k-chip::after` inset -7 (border sits outside the padding box); chip row gap 14. Hit areas: title 44-52, Trophies tier chips 44-45 at 1280 / 888 / 390 / 320 / 844 / 568; 632x355 reads 43, 358x201 chips are below the fold in the scroller (not measurable).
- **K14-a** h1: the brand is `position:absolute; clip-path`, never display:none (also in Snap): exactly 1 h1 in the AX tree in Hand, Cut, Snap at all 8 sizes (24/24) and on the title (8/8).
- **F2** sticky foot of the scroller (`.hcard-actions, .hmerge-foot, .gift-foot`): Hold to merge bottom (viewport) 888x500 441 (500), 844x390 331 (390), 568x320 277 (320), 358x201 184 (201), 320x568 506 (568), 390x844 801 (844); Take 433 / 333 / 280 / 161 / 528 / 566.
- **F3** compact one-row Hoard header at 641+ wide and <= 560 high: 888x500 scroller 220 -> 356 px, plinths from y 292; 358x201 card actions are the foot (Hearted + Merge in the first view, were ~700 px down); 358x201 Gift cards are one scroll away.
- **F4** error card <= 340 high: no mascot, sticky Reload: 148..192 of 201 (was 260..304), 148..212 of 320.
- **F5** reveal plate: line form (tiny, strip, 888x500, short stack) = one line in the exact dock-row box above the dock in z: 358x201 [12,151,346,195] = dock row.
- **F1 partial:** Reveals card form tier-scaled (tier word jelly sm / md / lg, glow from Rare, wider plate + bigger gem Legendary / Mythic); icon tiles on Menu rows; earned trophy = tier pill + glow; title chips 40 px on roomy screens. Title / Pause / Achievements / Buttons scores remain art-direction judgements (UI.md 2), not re-scored.
- Minors: K04-a focus back to the opener after Trophies (`openerFor`, hudBinding.ts); M8 gift tier tracking at 320 + Photo card picture 40dvh on a short phone; dead `.meter.pulse` rules deleted.
**Not fixed:** M2, M3, M4, M5, M6 + V3-F1 (Snap behind More at 358x201: 5 x 44 + gaps = 236 > 206 free), M7, K02-b, K14-b, K14 glyph counters, K03 nits, V3-F2 (hint 11.5 % at 568x320: spec'd and tested there), stale harness rows (capsule-loop `.meter.pulse`, hoard-loop `.hud-slot`). browser_shell sections and the uikit title / hoard / b4b checks could NOT run: machine at 100 % CPU, every goto hit its 30 s timeout (title_checks 30/32). Node probes green (uikit 62, screens 43, overlays 21, boot 30, optbar 42, portal 81, trophies 31, app 183), tsc 0.
**CSS (K05, cap 120 000 B unchanged):** real `vite build` dist CSS 119 809 B raw (audit tool 119 614), 25.3 kB gzip summed / 23.3 one stream; G0 1468 KB, G0b 434 KB. Room from: dead `.meter.pulse`; `--wh-sp-N` -> `--wh-sN`; 9 `font` shorthands -> theme.ts `FONT_COMBOS` tokens (screens.css, photo.css, `.hint` keep the long form: probes pin `--wh-fs-*`; owner_sheets stress got a universal Arial rule); `--k-bd-q` quiet-border role.
**Requests:** UI.md 4.2 / 6 (line-form plate, sticky primary actions, compact Hoard header at 888x500); commit.
<!-- UIFIX:END -->
