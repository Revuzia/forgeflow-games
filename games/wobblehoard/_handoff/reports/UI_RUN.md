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
