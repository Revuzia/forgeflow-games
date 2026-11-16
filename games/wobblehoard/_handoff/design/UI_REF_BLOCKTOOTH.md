# UI reference audit: BLOCKTOOTH (the quality bar for Squish Keeper's interface)

Author: UI-reference lens (read-only audit, 2026-10-08). Nothing under `games/wobblehoard/src`, `_harness`, `public` or any other game was edited,
no git write command was run, nothing was installed. Evidence labels used below:

- **[live]** = measured or seen in the published build on the games CDN this session (Playwright + SwiftShader, screenshots listed in section 12).
- **[src]** = read in `games/blocktooth` in the monorepo worktree (file:line). **The worktree is OLDER than the live build** (see 1.3).
- **[bundle]** = read from the live `index-CgtquYHa.js` / `index-CXEYHTMt.css` / `game_controls.js` downloaded with curl from the public CDN.
- **[not captured]** = exists per code but I did not get a screenshot; stated so you do not assume it was seen.

---

## 0. Verdict in ten lines

1. BLOCKTOOTH is premium because of ONE idea executed on every surface: "a panicked local TV news package". Boot card, title, pause (a TV test card),
   settings ("Station Engineering"), draft (science-desk dossiers), end screen (a newspaper front page), toasts, even the fatal card, all live inside that metaphor.
2. It is built from flat colour, thick ink outlines, HARD offset shadows (zero blur), halftone dots, scanlines and paper grain. It is the opposite of soft jelly.
   Copy its STRUCTURE (one metaphor, state coverage, choreography, sound-per-action, pooled DOM), not its SURFACE (skew, hard shadows, all-caps, 8 px text).
3. It uses real font files: Anton + Barlow Condensed (5 cuts) + Space Mono (2 cuts) = 8 woff2 files, 164,436 bytes [live]. Squish Keeper may not.
   Roughly the "type" is half fonts, half layout (caps, tracking, stroke + stacked shadow, scale system). The layout half is portable.
4. Everything is sized in one unit `--u = max(8px, min(1vw, 1.7778vh))`: 12.8 px at 1280x720, 19.2 px at 1920x1080 and a floor of 8 px on a phone [src styles.css:18] [live].
   That is why it looks identical at any 16:9 size and why it is unusable on a phone (section 9). The game declares `"mobile_support": "none"` [src game_meta.json:24].
5. 14 distinct screens/surfaces, 52 buttons in the DOM at once, 59 original vector glyphs, 16 keyframe sets, 10 procedural UI sounds, 7 music track ids = 6 songs (section 2, 5, 6).
6. Best single ideas to steal: hover = keyboard selection = one `is-sel` state; focused card grows (flex-grow 1.45) and lifts 1u while the rest desaturate;
   paper spin-in reveal (950 ms, overshoot at 78%); draft deal-in stagger (420 + 90*i ms); stamps for state changes; bottom hint bar with key chips;
   two-press "armed" confirmation; hold-to-confirm for destructive pad actions; input arming windows (160 to 1000 ms) that swallow carry-over mashing.
7. Worst things to avoid: no `:focus-visible` anywhere (buttons are `tabindex=-1`, `.bt-screen { outline: none }`), no `:active`, text as small as 6.7 px, phone layout collapse,
   teal and red text on cream at 3.5 to 3.96:1, the ForgeFlow controls bar covering the CONFIRM / BACK buttons, ~174 KB of CSS, inline scripts and runtime `<style>` injection (illegal under SK's CSP).
8. Portal integration is the reference implementation for what SK must add: `forgeflow:achievement {achievementSlug}`, `forgeflow:save/load` with a write lock,
   `forgeflow:game_over {score}`, `forgeflow:whoami`, `window.__PAUSE__`, the `game_controls.js` bar (bottom-right 126x34 px) (section 8).
9. SK today has none of: a goals/achievements screen, a bridge, a thumbnail file, a README, UI sounds, a real loading card (section 11).
10. SK already beats it on: real focus rings (`styles.css:45`), phone support, a live region (`announcer.ts`), reduced-motion handling in four CSS blocks (`styles.css:530, 543`, `hoard.css:316, 433`).

---

## 1. How to SEE it (and what I could and could not see)

### 1.1 Live build (used)
- URL (public, no login): `https://forgeflow-games-cdn.isimcha85.workers.dev/blocktooth/index.html` (base from `pipeline/deploy_game.py:716`, `CDN_BASE`).
  Response headers [live curl -I]: 200, `Cache-Control: no-store, no-cache, must-revalidate, private`, `Access-Control-Allow-Origin: *`,
  `cross-origin-embedder-policy: credentialless`. **No Content-Security-Policy header** is sent by the CDN.
- Portal route: `https://forgeflowgames.com/games/blocktooth`. A non-JS fetch returned the catalog home page (the known SPA prerender fallback in the Bible, around line 475 to 485),
  and in that catalog BLOCKTOOTH is listed with no "Mobile" label. I did not exercise the framed game on the portal, so the portal-side achievements page is **[not captured]**.
- Query parameters I used (all are the game's own documented dev flags, client side only): `?dev=1&quality=0&rscale=0.35&autostart=1&noslate=1&seed=1337`.
  `window.__BT__` (state(), newRun(), cheat.*, dismiss()) was used to reach drafts, the MASS BREACH banner, a boss and the end screen. Cheats used: `xp`, `rank`, `level`, `boss`, `ult`, `objective`, `powerup`, `gateKill`, `finaleSkip`, `noSpawns`, `god`.
- Harness: Playwright 1.58 from `wobblehoard/node_modules` through `_harness/pw.mjs` `launch()` (SwiftShader WebGL2). One browser at a time, no ports opened (the game is remote).
  Scripts (kept in the scratch folder): `bt_front.mjs` (boot, title, goals, select), `bt_run.mjs`, `bt_run2.mjs`, `bt_run3.mjs` (loading, opening, HUD, pause, settings, draft, banners, boss, end).
  Scratch folder: `C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad/ui/blocktooth/`
  (`shots/` = 84 PNGs, `live/` = downloaded public CDN files, `*.log` / `*.json` = run logs).
- Viewports: 1280x800 dpr 1 (desktop) and 390x844 dpr 2 isMobile hasTouch (phone), as asked.
- The machine was loaded by other jobs: in-run screenshots took 6 to 130 s each and a few caught transitions mid-fade. Where that matters it is flagged in section 12.

### 1.2 Local build (not possible, by design)
`games/blocktooth/node_modules` and `dist` do not exist (`ls` -> "No such file or directory"). Dependencies are `three 0.186.0`, `@dimforge/rapier3d-compat 0.20.0`,
`@fontsource/anton|barlow-condensed|space-mono ^5.3.0`, `vite 8.3.0`, `typescript 7.0.2` [src package.json]. Rule was "never install into the monorepo", so I fell back to the live build plus reading CSS / TS / README / `game_meta.json` / thumbnail.

### 1.3 The live build is NEWER than the worktree source (important)
Differences found [live] vs [src]:
- Title has three chips, `G GOALS & RECORDS`, `V VS PRACTICE`, `O ONLINE VS`; the worktree has only the G chip (`menus.ts:124`). `grep "VS PRACTICE|ONLINE VS"` over `games/blocktooth` finds nothing.
  `V` opens the select screen titled "VS Practice - Zoning Dispute" (confirm button reads NEXT), `O` opens "Online VS - Zoning Dispute" (one TITAN tab, button CONTINUE).
- The live `index.html` carries the shared ForgeFlow controls bar (`window.GAME_CONFIG = { touch: false, mute_hotkey: false }` + `<script src="./game_controls.js?v=3.1">`), absent from the worktree `index.html`.
- Live CSS reserves the bar on the HUD ticker only (`.bt-ticker{...;right:142px}`, `.bt-title-lower .bt-ticker{margin-right:142px}`), nothing else.
- Live bundle adds `forgeflow:vs_result` / `forgeflow:vs_result_ack` and 8 `vs_*` goal ids. Git: worktree head touching blocktooth is `f2a2d4c1 "online Part A"`.
All numeric measurements below that carry [live] come from the deployed build; file:line citations are the older tree and still match everywhere I compared.

---

## 2. Inventory: every screen and system (14 surfaces + the HUD cluster)

Count of interactive elements: 52 `<button>` elements exist in the DOM at the title (all screens are pre-built and hidden), 27 `<svg>`, 1,005 `<div>`, 1,445 elements total [live].
Every screen is a `div.bt-layer.bt-screen` with `role="dialog"` + `aria-label`; layers are z-indexed 9 (markers) / 10 HUD / 12 boss bar / 20 banners / 40 slate / 42 draft / 44 select / 46 title / 48 pause / 49 goals / 50 tabloid / 55 toasts / 60 settings [src styles.css:47-56, hud_v2.css:8-11, screens_v2.css:9].

| # | Surface | What it is / structure | Controls and states | Entry / exit and motion | Evidence |
|---|---|---|---|---|---|
| 1 | **Boot card** `#boot` | Radial navy field (#1f3057 -> #14213d 55% -> #0c1426), halftone dot overlay (9 px grid, .16 opacity, masked to the edges), scanlines (.22), red "WARD-7 LIVE" bug top-left, red skewed band "SPECIAL REPORT", BLOCKTOOTH wordmark (Anton `clamp(56px,10.5vw,190px)`, ink + jade stacked shadows, a "bite" mask at the top-right corner), italic sub, progress bar 46vw max 640 px with marching coral/gold hazard stripes, status line in Space Mono. | No controls. `role=status aria-live=polite`. Status strings cycle: PATCHING INTO WARD-7... / WARMING UP THE CAMERA VAN... / SEATING THE NEWS DESK... / ON AIR IN 3... 2... / DEVELOPING THE SIGHTING PHOTOS... / SURVEYING THE BLOCKS... / ROLLING OUT THE CITY... / FOCUSING THE LENS... / WE ARE LIVE [src game.ts:181]. Bar width = 6% + 94% x progress. | Shown at boot AND reused for every run load (the "patching in" card). Fade .35 s. Red dot blinks `steps(2)` 1.1 s. Reduced motion stops the dot and the stripes. | desktop_01, desktop_21_loading_1, phone_01, phone_21_loading_2 |
| 2 | **No-WebGL2 card** `#nogpu` and **Fatal card** `#fatal` | Full-screen 7-colour bar field behind a navy card with 4 px cream border, ink offset shadow .7em, h1 Anton, h2 gold, `<pre>` stack in Space Mono on ink, one coral button. Copy: "NO SIGNAL / WARD-7 cannot reach your graphics card", "TECHNICAL DIFFICULTIES / WARD-7 has lost the feed" [src index.html:83-100]. | One button (RELOAD / RELOAD THE BROADCAST), hover and focus-visible both go gold (`index.html:67`), the only place a real focus style exists. `role=alertdialog`. A 60 s boot guard shows the fatal card if main.ts never runs (`index.html:125`). | Boot-guard script in `<head>` (inline, classic) shows it. | **[not captured]** (cannot trigger without breaking the page; markup + CSS read) |
| 3 | **Title** | Full-bleed painted dusk scene made of divs only: sky gradient (#0e1832 0, #1d2d52 38%, #6b4a6e 62%, #ff8f6b 80%, #ffcf8a 100%), striped sun (26u disc, gold -> coral, 1.2u stripes), THREE parallax skyline bands (far 160 s, mid 95 s, near 55 s crawl) with lit windows, street with lane dashes, halftone + scanline overlays. Top-left WARD-7 bug + wall clock, red "SPECIAL REPORT / WARD SEVEN MUNICIPAL ALERT" band, **the logo**, sub-plate "a WARD-7 special report", gold tagline plate "YOU EAT THE STREET. YOU OUTGROW THE BLOCK.", blinking red "PRESS ENTER" plate, "OR PRESS (A) - CLICK ANYWHERE", chips, ticker "PLEASE STAND BY" with headline crawl (70 s loop), legal line. | Press anywhere / Enter / pad A / Start = play. Chips G, V, O (live) open GOALS / VS PRACTICE / ONLINE VS. Chip click does not start the game (`stopPropagation`). Input armed after 350 ms. Hover on the chip is a 1 px nudge (`.bt-btn:hover` translate -.08u): effectively invisible (desktop_04 is identical to desktop_03). | Leaves with `.38 s ease-in` (opacity 0, scale 1.04, brightness 2) or a 120 ms hold under reduced flashing. 5 "crumbs" fall out of the bite every 2.6 s (staggers .5 / 1.1 / 1.7 / 2.2 s). No intro animation. No h1 (a div with `aria-label`). | desktop_02, 03, 04, 18; phone_02, 03, 18 |
| 4 | **GOALS & RECORDS** (this is the achievements screen) | Full-screen manila case binder on a navy desk. Header: bug, title "GOALS & RECORDS", sub "WARD-7 PERMIT OFFICE - CASE BINDER", rotated gold stamp "0 / 46 GOALS FILED". 7 index tabs (GENERAL, MOLO, VOLT-KITE, HEARTHBACK, BRIARWICK, CITIES, RECORDS) each with a coloured top edge. Sheet with punched holes. One row per goal: round glyph, name (Anton), "ONE RUN" tag, condition, progress bar + "0 / 2,000", and an "ISSUES" chip showing what it unlocks (card / perk / colourway / restructure) with its own glyph. Done rows get a rubber stamp FILED + date. RECORDS tab = 4 titans x 3 zones table of bests (LV, SIZE, CLEAR, EXTENDED, SCORE; "NO BROADCAST" hatched when empty). | Keys: left/right = tabs, up/down = rows, Esc = back, wheel scrolls, tabs clickable. Row states: default, `is-sel` (coral left edge, white wash, offset shadow), `done` (teal left edge, teal glyph, FILED stamp). `role=tablist/tab/list/listitem`, `aria-selected`. | Opens from title or select (G / pad X / chip); Esc returns to the same screen, step, titan. Sound `ui('back')` on exit. | desktop_05, 06, 07_tab1/5/6; phone_05, 06, 07 |
| 5 | **Select (2 steps)** | Step 1 "SUBJECT IDENTIFICATION - choose your titan": 4 portrait cards (live-rendered 320x320 3D portraits, radial-gradient glow per titan, "ON AIR" red tag on the focused one, outlined numeral 01-04), right column "SUBJECT FILE" dossier (name 3.6u coloured with ink stroke, species italic, role plate, HANDLING pips, tagline with coral rule, 3 lore bullets, VITALS 4 pip meters, AUTO / HOOK / DASH kit rows with key chips), under it a COLOURWAY row (3 swatches: canonical + 2 unlockable, locked = grayscale + padlock + "LOCKED - FILE <goal>") and a tilted manila "NEXT PERMIT PENDING" slip with paper clip and PENDING stamp. Step 2 "choose a drop zone": 3 biome cards painted in CSS (sky, sun/moon, skyline, windows, snow / rain animations), lore column "ZONE FILE" (HALVARD RESPONSE 7 meters, CONTAINMENT ASSET phases, CONDITIONS), DESK RECORD, STARTING PERK row (arrows, 8 values, locked ones dimmed with a padlock). Bottom confirm bar: key hints (left/right CHOOSE, up/down OPTIONS or CARDS, ENTER CONFIRM) + G chip + ESC BACK + big coral CONFIRM / DROP IN. Step tabs top-right "1 TITAN / 2 DROP ZONE" (parallelograms; active coral, done teal). | Mouse hover on a card selects it (`mouseenter`), click chooses, click again or the bar confirms. Keys: arrows, 1/2/3 jump, Enter, Esc, G. Down from cards moves the "row focus" to palette / perk rows (gold border + "triangle" marker), arrows change the value. States: `is-sel`, `is-picked` (lift -1.6u scale 1.04), unfocused cards `saturate(.55) brightness(.72)`, hover `saturate(.8) brightness(.9)`. | Card focus: `flex-grow` 1 -> 1.45, translateY(-1u), `.22s cubic-bezier(.2,.8,.2,1)`; portrait scale 1.06; plate flips navy -> cream; rays (repeating-conic-gradient) fade in. Screen fade-in 220 ms. Confirm on step 1 pulses the card scale 1.1. | desktop_08..17; phone_08..17 |
| 6 | **VS PRACTICE / ONLINE VS select** (live only) | The same select layout with a different header, one or two step tabs and button label (NEXT / CONTINUE). | same | same | desktop_19, desktop_20 |
| 7 | **Opening: STREET CAM cinematic** (default) or **freeze-frame slate** (setting) | Full 3D shots with a camcorder overlay: 4 cream corner brackets, centre cross, top OSD "REC 00:00:02:13 WARD-7 STREET CAM [battery]", video static for the first 0.35 s, per-biome colour grade, lens frost / rain, a news lower-third (BREAKING + place + clock, headline, SUBJECT chip + sighting line, sub strap) sliding in and collapsing into the HUD bug, bottom-right "SKIP > ANY KEY". FULL 6.85 s, SHORT about 3 s, REDUCED has no crane. | Any key / pad button / click skips (armed 350 ms), 0.25 s blend to gameplay. Slate variant: halftone, viewfinder, "FREEZE FRAME" chip + camera id + timecode, blinking "PRESS ANY KEY". | Driven by the shot clock (a hitch slows the overlay exactly as the camera). | desktop_22_opening_2, _5; phone_22_opening_a, _b |
| 8 | **HUD** (play) | See 2.1. | | | desktop_30, 31, 43c, 44b, 45..49; phone_30, 45 |
| 9 | **Pause = TV test card** | 7 SMPTE-style colour bars (top 64%), castellation row, PLUGE strip, scanlines, WARD-7 bug, centre card (44u, 3 px cream border + 3 px ink outline, ink offset shadow .8u): "TEST CARD" tab, title "WE'LL BE RIGHT BACK" (Anton 4.2u, red text-shadow), sub "WARD-7 IS EXPERIENCING A MONSTER", 4 numbered items 01-04 (RESUME / SETTINGS / RETRY / QUIT TO TITLE), key line. Right: **LOADOUT** panel (cream, "EVERY PERMIT ON THE SUBJECT", count, starting perk, BANISH/LOCK/REROLL charges, one row per owned card: glyph, name + L2/MAX/EVO badge, desc, stacks). | Selected item = cream bar + coral left edge + 0.4u shift + trailing triangle. Retry and Quit need a SECOND press: row turns red ("armed"), blinking line "CONFIRM RETRY - THE CITY WILL BE REBUILT", row shakes translateX -3%/2%/0 220 ms; moving the selection disarms. Esc / P resumes. Settings opens on top; pause dims to .25 meanwhile. | Fade-in 160 ms. Auto-pauses on `visibilitychange` and on window `blur`. | desktop_32 (mid-fade), 33, 37; phone_32b |
| 10 | **Settings = "STATION ENGINEERING"** | Cream header with red WARD-7 tag, title, sub "PICTURE & SOUND ADJUSTMENTS"; 9 rows 2.9u high: MASTER VOLUME / MUSIC / EFFECTS (20 notched segments each, teal -> gold from step 11 -> coral from step 16, taller toward the right, value "80%"), PICTURE QUALITY (LOW MEDIUM HIGH), SCREEN SHAKE, REDUCE FLASHING, REDUCE MOTION (OFF / ON pills), OPENING (OFF SHORT FULL), DONE (coral button). Key line. | Segment click sets the level, pill click sets the option, rows are selected by `mouseenter`. Selected row = navy2 wash + coral left edge. Selected pill = coral fill, ink border. Reduce flashing previews live. Persisted in `localStorage` `blocktooth.settings.v1` (8 fields). Settings are NOT reachable from the title (only from pause). | Panel enters translateY(4%) scale(.97) -> none, 200 ms. | desktop_34, 35, 36; phone_36 |
| 11 | **Draft = "MUTATION REPORT"** | Blueprint grid backdrop (blur 3px, saturate .6, teal grid lines every 2u), header "WARD-7 / FILED BY THE WARD-7 SCIENCE DESK", title Anton 5.4u with coral stamp-shadow, plates "LEVEL 2 FILING - MOLO", "REROLL 1 - BANISH 2 - LOCK 2", "SLOTS 0/8". 3 manila dossier cards (24u x 26u): case-number tab ("CASE 07-472"), slot-status tab ("NEW - TAKES A SLOT (1/8)"), rarity rubber stamp (ROUTINE / NOTABLE / ALARMING / CLASSIFIED), glyph tile, name, dashed rule in the rarity colour, ruled description, paper-clipped "specimen photo" emblem (2 letters, family colour, halftone), tags, STACKS pips "0 -> 1", big circled key number 1/2/3. Corner buttons (X banish, square lock) on the focused card; HELD badge, NEW ribbon, evolution cards (gold -> coral frame + shimmer + "EVOLVES x" + "REPLACES x - KEEPS y"). | 1/2/3 pick instantly, left/right + Enter, click, R reroll, X banish (pad: hold Y 0.5 to 0.6 s), C lock. Focused card lifts -1.2u, scale 1.035, coral outer ring; unfocused `saturate(.75) brightness(.86)`; picked: lift -2u, scale 1.07, "FILED" stamp rotated -14deg 4.5u red; dropped: opacity .25. Refused banish: card wiggles + "CAN'T BANISH - YOU OWN IT" (`aria-live=polite`). | Deal-in: each card from translateY(60%) rotate((i-1)*9deg) scale(.8) opacity 0 to translateY(-4%) rotate((i-1)*-1.5deg) scale(1.02) at 70% then settle, duration 420 + 90*i ms; header from translateY(-60%) 380 ms. Banish out: 350 ms `cubic-bezier(.5,0,.8,.4)` rotate(-7deg) + BANISHED stamp. Input armed 260 ms. | desktop_40, 41, 42_*, phone_40..42 |
| 12 | **End = "THE WARD SEVEN WITNESS"** | A rotated (-1.4deg) newspaper front page, 72u x 52.5u (921.6 x 672 px at 1280x800), paper texture, ear boxes (EXTRA! / LATE CITY EDITION; ONE TOKEN / weather), masthead Anton 4.2u (53.76 px), motto, dateline with today's date and a running vol/no., headline 6.3u (80.64 px) "THE CITY GOT SMALLER.", subhead (3 variants per outcome), the freeze-frame **photo of your own run** (640x400 captured from the canvas, grayscale .55 sepia .3 contrast 1.25 + halftone dots) with a rubber stamp SUBJECT PREVAILS / SUBJECT DOWN, caption, BY THE NUMBERS (9 rows with dotted leaders, NEW RECORD stamps), RECORD BOOK (6 rows, "NO RECORDS FELL" / "n RECORDS FELL" note), pull-quote from a pool, boss status box, drop-cap story, INSIDE TODAY box, sidebar. Right column: 4 buttons KEEP GOING [K] (gold, EXTENDED COVERAGE tag, clears only), RETRY [R], CHANGE TITAN [C], TITLE [T]; key hint; account line (portal state); **NEW ON THE RECORD** clipping listing the goals this run filed and what each issued. | Selected button = coral fill, translateX -.8u, trailing triangle; click or key; button pulse scale 1.08 -> 1 160 ms; input armed 1000 ms (400 ms reduced). Variants: clear page, death page, EXTENDED COVERAGE EDITION ("IT WOULD NOT LEAVE."), gatekeeper "HELD AT SIZE II BY CORDON-2". | Paper spins in from rotate(-700deg) scale(.06) to rotate(-10deg) scale(1.06) at 78% then rotate(-1.4deg), 950 ms `cubic-bezier(.2,.7,.2,1)`; buttons slide in over 1300 ms (hidden until 60%). Press-room sound `ui('print')`. | desktop_50, 51, 52; phone_50 |
| 13 | **Toasts and banners** | (a) v2 toast stack (cream card, glyph tile, red kicker "GOAL MET", Anton heading, teal sub "UNLOCKED: SIDEWALK SALE - NEXT RUN"); (b) broadcast alerts, two kinds: urgent strap (boss / elite / phase / gate; red "WARD-7 ALERT" tab + title 2.3u + gold sub + hazard-stripe end) and compact toast under the bug; tone variants red / coral / teal; (c) **MASS BREACH** full-width banner (red diagonal stripes 1.2 s marching, ink borders, tilted cream SIZE card with roman numeral 5u, title 7.2u, navy sub strap in gold); (d) objective tracker rows (up to 6, 2.2u each); (e) screen markers (up to 12: chip "OVERLOAD SITE 0.7 BLK" or edge arrow disc + pointer); (f) onomatopoeia words in the world ("BRRING!", "GNASH!", "KA-THUMMM!", "TIMBERRR!", "BIGGER!", "DING!"). | Toast stack: each holds 4.5 s (RESTRUCTURED 2 s, revive 3.5 s), new toasts start at least 3 s apart, at most 2 on screen, 2 pooled nodes, enter/exit by transform + opacity `.25s cubic-bezier(.2,.8,.2,1)` (exit translateX(-115%)), hidden while any full screen is open and their timers pause; keyed toasts can jump the queue (`front`) and drop themselves (`alive()`). Alerts: urgent 2.9 s, toast 3.6 s, gap 260 ms, queue max 4, deduped, urgent first. | MASS BREACH 2.3 s `cubic-bezier(.6,0,.3,1)`. | desktop_43c (banner), 44b (toast), 45, 49; phone_44b, 45 |
| 14 | **ForgeFlow controls bar** (platform, not the game) | `#__ff_controls__` fixed bottom 8 / right 8, 126 x 34 px at 1280x800 (box 1146,758), 4 buttons 26x26: Fullscreen (F), Mute, Pause / Menu, Report a bug; `rgba(0,0,0,.5)` + blur(6px), radius 9, opacity .65 -> 1 on hover [live + bundle]. | Pause calls `window.__PAUSE__.toggle()`. | z-index 2147483600: above everything. **It overlaps the CONFIRM / BACK / REROLL buttons** (desktop_08, 13, 17, 40, 05..07). | every desktop shot |

### 2.1 HUD cluster (all measured [live] at 1280x800, u = 12.797 px)
| Piece | Box (x, y, w x h) | Notes |
|---|---|---|
| Station bug | 20, 18, 272 x 28 | red 4.5 px left edge, pulsing red dot, "WARD-7 LIVE", cream clock (14:06), teal run timer "T+0:02"; `drop-shadow(.22u .22u 0 rgba(27,20,38,.55))` |
| Counters TONNAGE / BLOCKS / CRUSHED | 1010, 18, 250 x 45 | three skewX(-10deg) cream tabs, navy label strip in gold, Anton 24.32 px numerals, tabular figures, coloured bottom edge (coral / teal / red) |
| Objective tracker | right column under the counters, row 2.2u | navy .9 rows with coloured left edge + glyph + name + life bar |
| Status card | 20, 612, 294 x 138 | cream, 2 px ink border, shadow 5.12 px; header navy (name Anton 1.5u, role gold, LV tab coral), SIZE roman-numeral box, HP / GROW / XP bars with 10% ticks and a damage trail, dash pips (skewed parallelograms), key chips |
| Ticker "WARD-7 WIRE" | 0, 770, 1138 x 30 (reserved 142 px for the platform bar) | red label with clipped corner, 70 s CSS crawl, live items injected on big moments |
| UPROAR meter | 380, 689, 521 x 14 | 10 ticks, tab with E key + percent, gold "READY" + shine sweep 1.1 s |
| Ability bar | 380, 709, 521 x 49 | 10 slots 3.8u; empty slots dashed; rarity = shape + pattern + colour (see 4.6); badges L2 / MAX / EVO |
| ACTIVE panel | 1042, 683, 218 x 69 | cream, coloured top edge, cooldown dial built from two rotated half-discs (no conic gradient), READY ring pulse 1.4 s |
| Zoom hint | 1060, 655, 199 x 21 | gold-edged chips: WHEEL + - Z RESET, dims to .5 after use |
| Boss plate | top centre, 44u wide | red tag + cream title tab, name Anton 2.3u, PHASE n tab, HP bar with notches at 66% / 33% and a cream damage trail, STRAIN meter 10 skewed segments, subtitle line that changes with the boss attack (`attack` tone pink) |
| Vignette / hurt flash | full screen | low-HP red radial pulse .9 s alternate; hurt = inset 6u red shadow |

Per-frame rule [src hud.ts / abilitybar.ts headers]: DOM built once and pooled; every write goes through `TextSlot` / `VarSlot` / `ClassSlot` (change-only; numeric custom properties quantised to 0.002); only transform and opacity change per frame; text at 4 to 10 Hz; no layout reads. This is why a 1,445-element UI costs almost nothing during play.

### 2.2 Systems that exist but have NO dedicated screen
- **Stats**: no stats screen. They appear as BY THE NUMBERS + RECORD BOOK on the end page, the RECORDS tab, YOUR BEST ON FILE on a select card (`LV {lv} - SIZE {size} - {time}`), DESK RECORD.
- **How to play**: no screen. Controls are taught by the select dossier (AUTO / HOOK / DASH with key chips), the HUD key chips, the zoom hint, a one-time UPROAR hint toast, the key line under settings, and `game_meta.json`.
- **Credits / about**: none in game. Credits live in README only (three.js MIT, Rapier Apache-2.0, three OFL fonts via Fontsource, Vite, TypeScript) [src README.md:578-586]. The title shows a legal line "FOOTAGE UNVERIFIED - WARD SEVEN MUNICIPAL ALERT - RESIDENTS ADVISED TO BE ELSEWHERE".
- **Settings from the title**: not available; only via pause.

---

## 3. Type system (how it gets its display lettering)

### 3.1 Fonts (real files, bundled by Fontsource; no network at runtime) [src styles.css:8-15, 31-33] [live]
| Role | Family | Cuts loaded | File sizes (latin woff2) |
|---|---|---|---|
| Display (`--f-display`) | Anton 400 | 1 | 18,612 B |
| UI (`--f-ui`, body of everything) | Barlow Condensed | 500, 500 italic, 600, 700, 800 | 21,424 / 23,940 / 22,308 / 22,444 / 22,464 B |
| Mono (`--f-mono`) | Space Mono | 400, 700 | 16,520 / 16,724 B |
Total fetched 164,436 B in 8 files. Fontsource emits 24 `@font-face` blocks (every unicode-range subset); only latin is fetched, but the CSS carries all 24 (9,334 B of the 182,882 B stylesheet). Fallbacks: `Impact, 'Arial Narrow Bold', sans-serif`; `'Arial Narrow', sans-serif`; `ui-monospace, Consolas, monospace`.
Boot card (inline CSS in index.html) uses the same families with `clamp()` sizes, so the loading screen is already in brand voice.

### 3.2 Scale (px at 1280x800; every value is N x u, u = 12.8 px)
| Use | Font | Size | Tracking | Evidence |
|---|---|---|---|---|
| Title logo | Anton | 12.5u = 160 px, line-height 1.02 | .01em (1.6 px) | measured |
| MASS BREACH title | Anton | 7.2u = 92 px | .02em | src |
| Headline (newspaper) | Anton | 6.3u = 80.64 px | .005em | measured |
| Draft title | Anton | 5.4u = 69.12 px | .04em | measured |
| Masthead / pause title | Anton | 4.2u = 53.76 px | .03em | measured / src |
| Select title, boss name | Anton | 2.3u = 29 px | .06em | src |
| Settings title | Anton | 2.2u = 28 px | .04em | src |
| Menu item | Anton | 1.9u = 24.3 px | .06em | src |
| Counter numerals | Anton | 1.9u = 24.32 px, tabular | | measured |
| Primary button | Anton | 1.5u = 19.2 px (confirm 1.8u = 23.04 px measured) | .04em | measured |
| "PRESS ENTER" | Anton | 2.6u = 33.28 px | .14em (4.66 px) | measured |
| Draft description | Barlow Condensed 600 | 1.5u = 19.2 px / line 1.9u = 24.3 px | .01em | measured |
| Dossier bullets | Barlow Condensed 500 | 1.06u = 13.6 px | | src |
| Labels | Barlow Condensed 800 | .6u to .9u = 7.7 to 11.5 px | .1 to .3em | src |
| Key chips | Space Mono 700 | .62u to .95u = 7.9 to 12 px (chip border 1 px, radius 3.6 px) | 0 | measured |
| Numbers, clocks, case numbers | Space Mono 700 | .55u to 1u = 7 to 12.8 px | -.04em to .08em | src |
Rules: everything is `text-transform: uppercase` on `.bt-layer` (paper surfaces switch back with `text-transform: none`); two weights per surface is NOT respected (Barlow shows 500/600/700/800 plus italic); line-height 1.15 base; `font-variant-numeric: tabular-nums` on counters and the clock.
Smallest text in the shipped UI: `.bt2-rec-kv small` .52u = 6.7 px, `.bt2-uchip-txt i` .55u = 7 px, `.bt-foot-line .bt-key` .62u = 7.9 px. On a phone (u = 8 px) the same rules give 4.2 to 5 px text.

### 3.3 How the "drawn" display lettering is faked in CSS (title) [src styles.css:799-866]
- The logo is ONE `<span class="bt-logo-fill">BLOCKTOOTH</span>` inside `div.bt-logo[aria-label]`; no heading element.
- Fill cream `#f4ecd8`; `-webkit-text-stroke: .45u #1b1426` with `paint-order: stroke fill` (outline sits outside the fill); `text-shadow: .55u .55u 0 #ff6f5e, 1.05u 1.05u 0 #1b1426` (two hard stacked offsets); `transform: skewX(-6deg)` (matrix c = -0.105).
- The "bite" out of the top-right corner = THREE `radial-gradient` masks composited with `mask-composite: intersect` (circle radius `--bite` 3.1u, then .78x and .74x at other positions). The crumbs are 5 absolutely positioned 0.9u boxes with `bt-crumb` (translate to (1.5u, 14u), rotate 260deg, opacity 0 -> 1 -> 0, `cubic-bezier(.5,0,.9,.6)`, 2.6 s infinite).
- Variants of the same trick: boot wordmark (ink + jade shadows, `.045em` / `.09em`, a smaller bite mask), pause title (red text-shadow .3u), draft title (coral shadow .4u + stroke .22u), level flash (gold, stroke .14u, shadow .22u), stat plates.
This is a layout recipe (stroke + stacked offset shadow + skew + mask) that works with ANY face; with Anton's weight it reads as poster lettering. For SK the owner already chose drawn SVG glyphs; the portable lessons are: (1) stroke and shadow are outside the glyph (`paint-order`), (2) one small signature "damage" (the bite) that animates (crumbs), (3) the same lettering recipe reused at five sizes so the brand is consistent.

---

## 4. Design tokens and surface treatment

### 4.1 Custom properties (`:root`, styles.css:17-35) plus page shell (index.html:12)
`--u max(8px, min(1vw, 1.7778vh))`, `--navy #14213d`, `--navy2 #1f3057`, `--navy3 #0c1426`, `--cream #f4ecd8`, `--paper #efe5cb`, `--coral #ff6f5e`, `--red #e63946`, `--teal #2f7f86`, `--teal2 #4fb3b0`, `--gold #ffd166`, `--ink #1b1426`, `--track #2a3350`, `--f-display`, `--f-ui`, `--f-mono`, `--shadow-ink calc(var(--u)*.3) calc(var(--u)*.3) 0 var(--ink)`; shell adds `--jade #3fae7f`. That is 13 colour tokens + 3 font tokens + 1 shadow + 1 unit = 18.
Component-local custom properties do the rest: `--rc` (rarity colour), `--titan` / `--c1` / `--c2` / `--glow` (per-titan card), `--kc` (tracker kind colour), `--p` / `--c` / `--hold` (0 to 1 fills), `--a` / `--b` (cooldown dial angles), `--lvticks`, `--tst-top`, `--sky-c`, `--nw` / `--nh` (text-wrap notch), per-biome `--sky --sky2 --sun --body --roof --glass --lit --sign --road --walk --line --leaf`.
The token system is NOT complete: the CSS contains 40+ distinct raw hex literals outside `:root` (e.g. `#6b4a6e`, `#ff8f6b`, `#ffcf8a`, `#c9bfa6`, `#2f9fa8`, `#8a63d2`, `#ffc53d`, `#f0a81c`, `#e9d9ac`, `#d9c796`, `#3a2a10`, `#b8792a`, `#a4521f`, `#c2412f`, `#c7a13a`, `#2f4fa8`) and rgba blends of ink/cream. Rarity colours: common `#c9bfa6`, rare `#2f9fa8`, epic `#8a63d2`, legendary `#ffc53d` (tracker chips use `#3fb8c0 / #a07ce8`). Family colours: survival `#ff6f5e`, mobility `#4fb3b0`, growth `#ffd166`, offense `#e63946`, smash `#c9a47a`, mutation `#a07ce8`, ult `#f4ecd8` [src icons.ts:323-330]. Test-card bars: `#d9d2c0 #ffd166 #69cfcc #3fae7f #ff6fb0 #e63946 #2f4fa8`.

### 4.2 Contrast of the palette (computed this session, WCAG relative luminance)
| Pair | Ratio | Used for |
|---|---|---|
| cream on navy | 13.57 | body on dark |
| gold on navy | 11.08 | labels |
| ink on gold | 12.40 | gold plates |
| cream on navy3 | 15.60 | |
| coral on navy / navy on coral | 5.85 | buttons |
| teal2 on navy | 6.40 | pips, tabs |
| **teal on cream** | **3.96** (3.72 on paper) | species line, kit tags, ISSUES kind, goal bar numbers: fails 4.5 for small text |
| **red on cream / cream on red** | **3.54** | NEW RECORD stamps, red tags |
| **coral on cream** | **2.32** | stamps and numerals on paper |
| **gold on cream** | **1.22** | never used as text on cream (good) |
| cream at 55% on navy | 5.05 | dim hint text (`rgba(244,236,216,.55)`) |
Everything legible is high contrast on navy; the weak spots are the cream "paper" surfaces with teal / red / coral small text.

### 4.3 Radii, borders, depth
- **Radii: almost none.** 17 uses of `border-radius: 50%` (dots, dials, glyph discs, round key badges), tabs `.35u to .5u` on the top corners, key chips `.28u` (3.6 px), glyph tiles `.3u`, padlock `.12u`; everything else is square. Parallelograms replace radius: `skewX(-10deg)` counters, `-12deg` pips, `-14deg` pips, `-16deg` boss segments, `-10deg` select tabs, `-8deg` boot band.
- **Borders:** 2 to 4 px solid ink (`.12u` to `.45u`), e.g. panel = `.3u` cream border + `.3u` ink outline (a double frame); plates add a `.35u` to `.45u` coloured left edge as the status colour. Chrome snaps borders to whole device pixels (`.22u` = 2.8 px renders 2 px at DPR 1).
- **Shadows: HARD OFFSETS, zero blur.** Distinct recipes: `calc(u*.2..0.8) calc(u*.2..0.8) 0 rgba(27,20,38,.5..0.7)` (about ten offset / alpha variants), `--shadow-ink` (ink, .3u) on buttons, `filter: drop-shadow(.22u .22u 0 rgba(27,20,38,.55))` on bug / counters, paper = `0 1.4u 3u rgba(0,0,0,.55), .5u .5u 0 rgba(0,0,0,.3)` (the only soft shadow), inset `0 -.35u 0 var(--titan)` as a coloured bottom bar. Elevation = bigger offset (.2u chip -> .45u card -> .8u modal). The only blur in the game's own CSS is two `backdrop-filter` rules (slate: saturate .72 contrast 1.12 sepia .14; draft backdrop: blur 3px saturate .6); the platform bar adds a third on its own. No glass anywhere else.
- **Texture overlays** (the "premium" grain): halftone `radial-gradient(circle, rgba(27,20,38,.55) 30%, transparent 33%)` on a .6u grid, multiply, opacity .5, masked to the edges (`.soft` .22); scanlines `repeating-linear-gradient(0deg, rgba(8,10,24,.22) 0 1px, transparent 1px 3px)` at .5 (pause .7, title .35); paper `repeating-linear-gradient(0deg, rgba(120,100,60,.035) 0 1px, transparent 1px 4px)` + radial highlights; manila gradients `#fbf5e6 -> #f4ecd8`, `#f1d99a -> #e3c479` (permit slip); blueprint grid lines `rgba(79,179,176,.08)` every 2u (draft), gold variant for chests.

### 4.4 Panel language (what replaces "glass")
Two paper types and one dark type: (1) **navy plate** (`#14213d`, cream text, gold labels, coloured left edge), (2) **cream card** (`#f4ecd8`, ink text, ink border, hard shadow), (3) **manila paper** (`#efe5cb`/`#fbf5e6` gradient, grain, tab and clip props). State is shown by swapping plate type (selected plate flips navy -> cream) and by the coloured edge, never by blur or opacity alone.

### 4.5 Buttons and controls (all states) [src styles.css:88-98, 906-920, 952-957]
| Control | Default | Hover | Selected | Pressed | Disabled / other |
|---|---|---|---|---|---|
| `.bt-btn.coral` | Anton 1.5u, coral fill, navy text, 2 px ink border, ink shadow .3u | translate(-.08u,-.08u) (about 1 px) | n/a | none (no `:active`) | n/a |
| `.bt-btn.ghost` | navy .6 fill, cream text + border, no shadow | same nudge | | none | `.off` opacity .45 |
| Menu item | Anton 1.9u cream on transparent, numbered 01-04 in mono | `mouseenter` selects it | cream bar, navy text, coral left edge, translateX(.4u), trailing triangle | `onTap` on click | `armed` = red fill + blinking confirm line |
| Settings pill | Anton 1.15u (14.72 px), min-width 5.2u (66.56 px), 23 px high, 1 px cream .35 border, text .6 | row select | coral fill, ink border, navy text | click sets | |
| Volume segment | 20 notches, `rgba(244,236,216,.16)` | | teal / gold / coral by range, height 35% -> 86% | click sets level | |
| Card (titan, biome, dossier) | desaturated | select on `mouseenter` | lift + grow + plate flip + rays | `is-picked` | `is-dropped` .25 opacity |
| Key chip | Space Mono, 1 px border, `rgba(244,236,216,.1)` fill | | `.dark` variant | | |
| Corner button (X / lock) | navy, 2 px cream border, ink shadow | red (banish) / gold (lock) fill | | | `.off` .35 |
| Tab (goals) | manila `#d9c796`, coloured top edge `inset 0 .3u 0 var(--tc)` | translateY(.1u) | paper `#efe5cb`, up | | |
State coverage verdict: default, hover (cards and rows only), selected, armed, picked, dropped, held, locked (grayscale + padlock), done (stamp) are all designed. **Missing: `:focus-visible` (none in 165 KB of CSS), `:active`, a visible disabled style for most buttons, any loading state on controls, any error state on controls.** Every `el('button')` the game builds in `src/ui/*.ts` sets `tabIndex = -1` (19 construction sites, checked by grep; only the two error-card buttons in `index.html` and the platform bar's buttons are normally focusable), and key input is a custom `UiKeys` driver (window keydown capture, arming window, gamepad polling) rather than the browser focus model.

### 4.6 Icons: one original family drawn in code [src icons.ts]
- 59 glyphs, `viewBox 0 0 24 24`, built from helper primitives (`circle`, `ellipse`, `ring`, `poly`, `rect`, `star`, `arcBand`, `spiral`, `bar`) or hand paths. Each has a MAIN path filled with the family colour and an optional DETAIL path filled cream; both stroked 2 px ink, `stroke-linejoin: round`, `vector-effect: non-scaling-stroke`, `aria-hidden`.
- Contrast guard: `barFill()` deepens a pale family colour toward a saturated target (`DEEPEN` table) until it is at least 1.9:1 against the slot face `#fbf5e6` and never below luminance .12.
- Distinct glyph per bar slot: `barGlyphs()` walks candidates (own glyph, trigger glyph, family spares, shared tail) so ten slots never repeat a glyph.
- Rarity is encoded by shape and pattern AS WELL AS colour: common plain, rare = outline + offset ring, epic = chamfered octagon `clip-path`, legendary = four corner rivets + thicker border, evolution = gold-coral gradient border + shimmer + corner flag.
- Text glyphs also used: triangle (selection pointer), play triangles on perk arrows, diamond (ticker separator), bullet arrow (lore bullets), circled A (pad hint). These depend on font fallback.
- No CSS-only icon sprite: icons are inline SVG strings (`innerHTML`), CSP-safe, but they carry `stroke="#1b1426"` attributes (presentation attributes are fine under `style-src 'self'`).

---

## 5. Motion

Single-easing doctrine: almost everything uses `cubic-bezier(.2,.8,.2,1)` (an ease-out with a long tail, used 8 times in CSS and as the default of the `pulse()` WAAPI helper [src dom.ts:83]); exits use `cubic-bezier(.5,0,.8,.4)` or `ease-in`; big sweeps use `cubic-bezier(.6,0,.3,1)`; only the paper spin uses `(.2,.7,.2,1)`. There is no spring physics: overshoot is baked into keyframes (offset .7 / .78).
| Moment | Duration | Curve | What moves |
|---|---|---|---|
| Hover nudge / press | .12 s | linear default | translate(-.08u), box-shadow, background |
| Card focus (draft) | .14 s | `(.2,.8,.2,1)` | translateY(-1.2u) scale(1.035), filter, opacity .2 s |
| Select card focus | .22 s | `(.2,.8,.2,1)` | flex-grow 1 -> 1.45, translateY(-1u), filter .2 s |
| Row / chip transitions | .12 s | | border-color, background |
| Tracker row | .2 s | `(.2,.8,.2,1)` | translateX(110%) + opacity |
| Toast in / out | .25 s | `(.2,.8,.2,1)` | translateX(-115%), opacity |
| Screen fades | 160 / 180 / 200 / 220 ms | WAAPI default | opacity (select, pause, slate, settings with translateY(4%) scale(.97)) |
| Title leaving | .38 s | ease-in | opacity, scale 1.04, brightness 2 |
| Draft deal-in | 420 + 90*i ms (header 380 ms) | | translateY 60% -> -4% -> 0, rotate (i-1)*9deg -> (i-1)*-1.5deg -> 0, scale .8 -> 1.02 -> 1 |
| Draft pick / banish | .14 s / .35 s | `(.2,.8,.2,1)` / `(.5,0,.8,.4)` | FILED stamp; banish: translateY(4u) rotate(-7deg) scale(.9) opacity 0 |
| Pause retry armed | 220 ms | | translateX -3% / 2% / 0 shake |
| Tabloid paper | 950 ms | `(.2,.7,.2,1)` | rotate(-700deg) scale(.06) -> rotate(-10deg) scale(1.06) at 78% -> rotate(-1.4deg) |
| Tabloid buttons | 1300 ms | | translateX(30%) hidden until 60% |
| Slate lower third | 560 ms | `(.2,.9,.2,1)` | slide in; exit 200 ms ease-in translateX(-8%) |
| MASS BREACH | 2300 ms | `(.6,0,.3,1)` | sweep; stripes 1.2 s linear loop |
| Alerts | 2900 ms urgent / 3600 ms toast | `(.55,0,.35,1)` | gap 260 ms, queue 4 |
| Ambient loops | 0.5 to 160 s | linear / steps | blink `steps(1)` 1.1 to 1.2 s (62% on), marching stripes .7 s, ready ring 1.4 s ease-out, shimmer 2.8 to 3.2 s, skyline 55 / 95 / 160 s, ticker 70 s, snow 6 s, rain .5 s |
16 `@keyframes`: `bt-blink, bt-blink-soft, bt-breaking, bt-crawl, bt-crumb, bt-dot, bt-intro-fill, bt-rain, bt-ring, bt-snow, bt-stripes, bt-title-out, bt-vig, bt2-ring, bt2-shimmer, bt2-sweep`.
Reduced motion: CSS `@media (prefers-reduced-motion: reduce)` forces `animation-duration .001s` + iteration 1 on every `.bt-layer` descendant and stops the crawls (the ONLY `@media` rule in 165 KB of CSS); in JS `flashesReduced()` (the in-game REDUCE FLASHING setting OR the OS media query) swaps spins and deals for 250 to 400 ms fades, shortens input arming, and a global class `bt-reduce-flash` disables a named list of loops (blink, stripes, shimmer, vignette pulse, ready rings, speed lines). REDUCE MOTION (setting) additionally selects the REDUCED cinematic and removes camera punch.

---

## 6. Sound

### 6.1 UI sound set (procedural WebAudio, no samples) [src sfx.ts:2244-2326, GAP table sfx.ts:306-307]
| Kind | Where it fires | Synthesis | Min gap |
|---|---|---|---|
| `move` | arrow / WASD on select, pause, draft, end only (keydown capture, at least 70 ms apart); not on hover, not on goals / settings | triangle 880 Hz, 40 ms, vol .34 | .03 s |
| `confirm` | title start, select confirm, pause resume / retry, tabloid choice | two square beeps 660 -> 990 Hz (60 ms + 100 ms, 70 ms apart), lowpass 2400 | .05 s |
| `back` | quit, back from goals, leaving select | 660 -> 440 Hz, lowpass 1800 | .05 s |
| `draft` | MUTATION REPORT opens | 3 white-noise whooshes 90 ms apart (1800 -> 4200 Hz) + bells MIDI 81 and 84 | .2 s |
| `pick` | a card is filed | thump 150 -> 60 Hz + pink-noise burst + bells MIDI 79 and 86 | .15 s |
| `banish` | rubber stamp | thump 200 -> 70 Hz + pink burst + paper-rustle highpass | .15 s |
| `lock` | padlock shackle | clangs 1400 and 2100 Hz + bandpass click | .1 s |
| `goal` | GOAL MET | bell MIDI 88 + 6 typewriter ticks 75 ms apart | .35 s |
| `slate` | opening freeze-frame | shutter bursts + FM zap 1800 -> 120 Hz + brass + thump | .5 s |
| `print` | the front page rolls off the press | 4 press thumps + clangs 180 ms apart + carriage bell MIDI 93 | .5 s |
No sound on hover or click for buttons, settings, tabs, goals rows; no haptics. UI voices use the `ui` voice slot (priority 4); hard cap 24 voices.
### 6.2 Mix and music [src audio.ts, music.ts]
Graph: voices -> sfx bus -> -3 dB shelf -> glue compressor (thr -22 dB, knee 10, ratio 2.5, make-up undone) -> master -> compressor -> x0.5 -> soft clip. Defaults master .8, music .6, sfx .8 (settings steps of 5%). Music ducks only under big stings: breach [.65, hold 1.6 s, release 1.2 s], siren [.45, 2.4, 1.0], phase [.4, 1.0, .8], bossDown [.55, 2.2, 1.5], ult [.5, 1.0, .9]. Tracks: title / select = one "WARD-7 news theme" (D dorian, 108 bpm, intensity .95 title, .45 select, crossfade 1.5 s, never restarts between them), three biome tracks (118 / 96 / 104 bpm), boss (140 bpm), tabloid press theme (92 bpm, swing .22, tuba, typewriter, bell). Five layers per track faded by intensity; look-ahead scheduler 25 ms / 100 ms horizon.
**Not listened to by me**; this section is from code. (No automatic playback possible in the capture, `--mute-audio`.)

---

## 7. Accessibility and robustness (what exists, with numbers)

Present:
- `role="dialog"` + `aria-label` on every screen layer (title, select, goals, pause, settings, draft, tabloid, slate, cinematic); `role=listbox/option/aria-selected` on titan, biome and draft cards; `role=tablist/tab/aria-selected` and `role=list/listitem` on goals; `role=menu/menuitem` on pause; `role=status aria-live=polite` on the boot card; `role=alertdialog` on the two error cards; glyph SVGs `aria-hidden`; one `aria-live=polite` (the "can't banish" note). 37 lines that set a role or aria attribute in `src/ui` (counted from a grep of `aria-|setAttribute('role'`).
- Keyboard and gamepad for every screen (arrows / WASD, Enter, Space, Esc, P, 1/2/3, R, X, C, G, K, T; pad d-pad, stick with auto-repeat 380 then 130 ms, A, B, X, Y-hold, LB, Start). Hold-to-confirm for pad BANISH (0.5 to 0.6 s) so a mash cannot trigger it.
- Anti-leak input design: each screen sets `input.mode = 'ui'`, swallows presses for an arming window (title 350, select 250, draft 260, pause 200, settings 180, tabloid 1000 ms), closes on a macrotask so the closing key never becomes a gameplay edge, restores focus on close.
- Settings: REDUCE FLASHING, REDUCE MOTION, SCREEN SHAKE, OPENING (skip), independent volumes; OS `prefers-reduced-motion` honoured; auto-pause on hidden tab and on window blur (`game.ts:2051-2058`); boot guard + fatal card + no-WebGL card.
- Redundant encodings: rarity = frame shape + rubber stamp + colour; every bottom bar repeats the keys as chips.
Absent or weak (all verified in CSS / DOM):
- **No focus ring anywhere** (`:focus` / `:focus-visible` grep over the three stylesheets: no matches; `.bt-screen { outline: none }`); buttons `tabindex=-1`; Tab key is passed through, so keyboard users get the custom selection highlight only after pressing arrows.
- No `prefers-contrast`, no `forced-colors`, no `prefers-color-scheme` (one `@media` rule in the whole CSS).
- No h1: the title is a div with `aria-label`; the hidden error cards contain the only `h1` elements in the DOM (NO SIGNAL, TECHNICAL DIFFICULTIES).
- Settings rows are not sliders or switches (plain divs); no live region for the HUD, toasts or alerts.
- Touch targets: title chips are 156 x 29 px (desktop) and 97 x 18 CSS px (phone); confirm button 180 x 39 px; none reach 44 px on a phone.
- Text size: 6.7 to 10 px labels at 1280 wide (section 3.2). Small teal / red / coral text on cream is 2.3 to 3.96:1 (section 4.2).
- **Phone is broken by design** (`mobile_support: none`): at 390 wide `--u` floors at 8 px, so the title logo is clipped on both sides (phone_03), select cards collapse to 14 px slivers beside a 248 px dossier (phone_08, 13), the goals rows wrap and the "ONE RUN" tag collides with "ISSUES" (phone_05), the HUD's UPROAR meter overlaps the status card (phone_30), draft cards run off both edges (phone_40), the pause test card is clipped on the left (phone_32b), the end page is clipped (phone_50). Only the boot card (clamp-based), settings (phone_36) and the toast / boss plate are usable.
- **The ForgeFlow bar covers the primary action** on select, goals, draft (desktop_08, 13, 17, 40; the bar sits at 1146..1272 x 758..792, the CONFIRM / DROP IN / BACK / REROLL buttons live at about 1070..1250 x 755..790). Only the ticker reserves 142 px.
- Inline scripts and inline handlers (`onclick="location.reload()"`, boot guard, `GAME_CONFIG`) and runtime-injected `<style>` strings (`bossbar.ts GATE_CSS`) would all be blocked by SK's strict CSP.

---

## 8. ForgeFlow portal integration (what the reference does; SK has none of it yet)

### 8.1 Messages (game <-> portal), `window.parent.postMessage(msg, '*')`; portal listener is `src/lib/gameBridge.ts:256` and only trusts messages whose `event.source` is an embedded iframe
| Direction | Type | Payload | Notes |
|---|---|---|---|
| game -> portal | `forgeflow:whoami` | `{_reqId}` | 3 tries, 4 s apart; no answer -> client stays "silent" for good (older portal / plain iframe) [src portal.ts:90-93, 249-261] |
| portal -> game | `forgeflow:identity` | `{_reqId?, signedIn, id, username, avatar_url, level}` | also pushed unsolicited on sign-in / sign-out (no `_reqId`); no token ever enters the frame; guests get `{signedIn:false}` |
| game -> portal | `forgeflow:achievement` | `{achievementSlug}` (or numeric `achievementId`) | slug = the goal id (e.g. `g_first_broadcast`); portal inserts the unlock and adds XP = points x daily-badge multiplier; **XP only comes from achievements** [gameBridge.ts:282, 54-59]; sent at most once per account per page; on the first signed-in identity every goal already in the profile is posted once (catch-up) [portal.ts:303-321] |
| game -> portal | `forgeflow:game_over` | `{score}` (finite number; 0 is valid) | BLOCKTOOTH sends `score = tonnage` after each filed run; also accepted: `forgeflow:score {score}`, `forgeflow:level_complete {score}` (season best per game per ISO week, `leaderboard_scores`) |
| game -> portal | `forgeflow:save` | `{slot: 1, data: {blocktooth: {v: 1, profile, best}}}` | portal does read-merge-write (never drops keys), table `game_saves` |
| game -> portal | `forgeflow:load` | `{slot: 1, _reqId}` | 3 tries x 12 s |
| portal -> game | `forgeflow:save_loaded` | `{_reqId, data}` | reply goes to the real sender frame at its origin |
| game -> portal | `forgeflow:run_result` | `{_reqId, payload: RunResultPayload}` (run_nonce, titan, biome, result clear/dead, duration_s, clear_s, level, peak_rank, kills, tonnage, blocks, bosses, ...) | routed only for slugs in `GAME_STATS_RPC` (`blocktooth: bt_submit_run`); ack `forgeflow:run_result_ack {_reqId, data:{board_rank, already, error, reason}}` waited 15 s; queue max 4 while waiting for identity |
| game -> portal | `forgeflow:vs_result` (+ `_ack`) | VS match payload | live build only |
Rules the client enforces [src portal.ts header]: no-op outside the portal (`window.parent === window`); guests send nothing; **cloud write lock**: nothing is saved until `save_loaded` has answered for this account (an empty account, `data: null`, counts as an answer, a timeout does not); merge = union of done goals (earliest stamp), better of each best, max of lifetime counters, local-only perk / palette; sanitised on the way out.
Other hooks: `window.__PAUSE__ = {pause, resume, toggle}` (the bar's Pause button), `window.__BTPORTAL__` (stats counters for debugging), `?v=<build_version>-<nonce>` on the iframe URL, `?room=` forwarded for invites.
Iframe, from `GamePlayer.tsx:177-178`: `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms"`, `allow="autoplay; fullscreen; gamepad; pointer-lock"` (no `clipboard-write`).

### 8.2 Achievements as the platform sees them [src `_harness/portal/seed_achievements.py`, `_spec/online/platform.md` section 9]
- Game id 52; 46 local goals seeded as 46 platform achievements: slug = goal id (`g_first_broadcast`, `g_zoning_change`, ...), `name`, `description`, `secret: false`, `tier`, `points`. Tiers (owner decision D2): bronze 12 / silver 16 / gold 13 / diamond 5; points 5 / 15 / 30 / 60 => 990 XP total.
- Seeding is done by RPC `seed_game_achievements(p_game_id, p_rows)` with the service-role key (service_role only since migration 0005), idempotent per (game_id, slug); `deploy_game.py` does NOT seed, the macro pipeline or the script does. The script refuses to run if `goals.ts` and its tier table disagree and has `--verify` / `--apply` / dry-run.
- The in-game screen (GOALS & RECORDS) and the portal's `/achievements` page show the same ids; the in-game screen shows more (progress, what each issues).

### 8.3 Registry and store assets
- `public/game_meta.json` fields consumed by `deploy_game.py`: `title`, `short_description`, `description`, `genre`, `sub_genre`, `difficulty`, `controls_keyboard`, `controls_gamepad`, `tags`, `art_direction`, `mobile_support` (written only when declared). **Never put `status` in it** (publishing is the owner's toggle). BLOCKTOOTH's file has 11 keys: `description` 2,266 characters in the news-desk voice (SK's is 1,752), `short_description` 237 (SK 256), 11 tags (SK 13), `mobile_support: "none"`, `controls_gamepad` split out (SK leaves it empty and adds `controls_touch`).
- `public/thumbnail.png`: 1280 x 720 PNG, 1,602,979 bytes, an illustrated key art (isometric city, big green monster, citizens, "DINER" and "TOYS" shop signs). Deploy cache-busts with an md5 query (`thumbnail.png?v=<8 hex>`) because the CDN sends max-age 86400; it is only generated when missing, and `generate_cover.py --out games/<slug>` overwrites it.
- README: 586 lines (what it is, 20-minute pacing, controls table, URL params, screens flow, project layout, architecture, test surface, gates, credits and licences).
- Deploy: `python pipeline/deploy_game.py --game-dir <dist> --slug <slug>` (body, then `index.html`, then `game_meta.json` last; CF cache purge; registry PATCH with the service key; new rows land `unpublished`).
### 8.4 The shared controls bar every game ships (`game_controls.js` v3.1) [bundle + live DOM]
- Element `#__ff_controls__`: fixed, bottom 8 px, right 8 px, padding 4 / 5, gap 4, radius 9, `rgba(0,0,0,.5)` + `backdrop-filter: blur(6px)`, `opacity .65` (1 on hover), z-index 2147483600; 4 buttons 26x26 (radius 6, `rgba(255,255,255,.08)`): Fullscreen (key F), Mute, Pause / Menu (`__PAUSE__.toggle()`), Report a bug. Measured 126 x 34 px at (1146, 758) in a 1280 x 800 window, i.e. 32% of a 390 px phone width.
- It wraps `Audio` and `AudioContext` at load (universal mute), blocks the context menu page-wide, requests Keyboard Lock on Esc in fullscreen (a tap reaches the game, a hold exits), sets `html.ffg-desktop|ffg-touch` and `ffg-portrait|ffg-landscape`, emits `ffg:device` / `ffg:orientation`, and (touch devices) overlays a virtual stick + buttons that SYNTHESISE key events.
- Config via `window.GAME_CONFIG` BEFORE the script: `hide_controls`, `hide_bug_button`, `fs_hotkey`, `slug`, `touch: false | {stick, buttons, look, ...}`, `mute_hotkey`. BLOCKTOOTH uses `{touch: false, mute_hotkey: false}` (desktop only; M is its minimap key).
- Inference (not tested): the bar builds its own `<style>` element with `textContent` and `index.html` sets `GAME_CONFIG` inline; under SK's strict CSP (`script-src 'self'; style-src 'self'`) the inline config and that `<style>` would be blocked (the bar itself uses `style.cssText`, which is CSSOM and allowed). SK needs an external config script and a check that the bar still renders under the CSP the CDN would send (today it sends none).

---

## 9. What makes it feel premium (ranked by contribution)

1. **One metaphor, 100% coverage, with matching copy.** Every string is in-world ("WE'LL BE RIGHT BACK", "STATION ENGINEERING", "FILE ONE", "THE CITY GOT SMALLER."), even error text and the confirm line. No generic labels. ~490 lines of copy in `strings.ts` + 114 in `strings_screens.ts`.
2. **A signature prop per screen** (test card, dossier, binder, newspaper, permit slip, paper clip, punched holes, rubber stamp, case number): each screen has a physical object to look at, not just a panel.
3. **Typographic hierarchy that never wavers**: one ultra-condensed display face for names and numbers, one condensed text face, one mono for data; uppercase + generous tracking; numerals always the biggest thing on a plate.
4. **Hard, consistent depth**: one shadow idea (ink offset, bigger = higher), one border idea (thick ink + coloured left edge), no gradients on UI chrome except texture. Reads crisp at any size.
5. **State is theatre, not tint**: selection flips plate colour, grows the card, adds a pointer; picking stamps FILED; banishing stamps and drops the card; goals file a dated stamp; "armed" turns a row red and blinks a warning line. Each state change is an event the eye can see from across the room.
6. **Choreography with a point**: stagger + overshoot on deals, a spin-and-settle for the big reveal, banners that sweep, toasts that queue politely and yield to full screens. Durations are short (120 to 420 ms) except for deliberate set pieces (950 ms paper, 2.3 s banner, 6.85 s cinematic) that are skippable.
7. **Information density with order**: dossier columns (identity, lore, vitals, kit, record) fit a screen without scrolling, with meters drawn as pips, never plain numbers alone.
8. **Redundant, reassuring input**: key chips everywhere, 1/2/3 shortcuts, pad parity, anti-mash guards, two-press destructive confirms, hold-to-banish.
9. **Audio matched to the prop**: stamps thump, the goal chime is a bell + typewriter, the paper rolls with a press and a carriage bell, the select theme is the title theme thinned (.45 vs .95) so menus never restart the music.
10. **Engineering discipline underneath**: pooled nodes, change-only writes, transform-only motion, deferred work guarded by an epoch, every storage read in try/catch, a boot guard, a fatal card, a WebGL2 card.

---

## 10. Reusable ideas for a soft, squishy toy (and what NOT to copy)

SK facts that constrain the translation (from `_spec/UI.md`): no font files and `font-src 'none'`; strict CSP, styles through the CSSOM only; original drawn jelly alphabet as SVG; a real toolbar (Hand / Cut / Snap) replacing the "Toys" button; the production bundle gate G0 = 1229 KB with about 86 to 90 KB of headroom for the whole UI; phone-first (`mobile_support: "full"`); kind wording, no ads or paywall.

| Blocktooth device | Why it works | SK translation (proposal, soft jelly) |
|---|---|---|
| One in-world metaphor on every surface | Coherence reads as budget | Pick ONE: "a toy shop shelf and a capsule machine" (capsules, price tags become soft stickers, shelf edges, felt). Name the surfaces in that voice but keep copy plain and kind (Hoard already exists). Boot, error, offline and loading cards must wear it too. |
| Hover = keyboard selection = one `is-sel` state | One state to design and test | Unify `:hover`, `:focus-visible` and the "active tool" into one "lifted jelly" look (scale 1.04, brighter gloss, +1 elevation step); the dock's active tool adds a squash-and-settle. Keep SK's real focus ring on top (Blocktooth has none). |
| Focused card grows and lifts while the rest desaturate (`flex-grow 1.45`, -1u, saturate .55 brightness .72, `.22 s (.2,.8,.2,1)`) | Directs the eye without a border | Species / Hoard gallery: focused tile swells with a jelly overshoot (scale 1 -> 1.06 -> 1.04, 220 ms), neighbours dim to ~.8 opacity and settle 1 px down. Never flat flex-grow jumps on phone: use transform only. |
| Draft deal-in stagger (420 + 90*i ms, rotate (i-1)*9deg, overshoot at 70%) | Makes a set of options feel dealt, not shown | Capsule reveal and "3 candidates" moments: items drop in with 80 to 100 ms stagger and a small rotation, one soft bounce (offset .7). Under Calm: opacity only. |
| Paper spin-in (950 ms, -700deg, overshoot 78%) | The big payoff gets a signature | Rarity reveal plate: a gel seal / sticker slaps down with a 3-step squash (1.25 -> .92 -> 1.0) instead of a spin; duration scales with rarity (the SK spec already wants a grander reveal). |
| Rubber stamps for state change (FILED, BANISHED, PENDING, ISSUED, NEW RECORD) | State changes are visible events | "Sticker slap" for collected / new / favourite / merged states: a round gel sticker with a gloss, 6deg random tilt, squash on land, plus the SK UI sound. Replace stamp text with a short kind word. |
| Binder with index tabs for achievements, rows = glyph + name + condition + bar + "ISSUES" unlock chip, done rows stamped with a date | Achievements double as a roadmap (what it unlocks, how far) | "Sticker album" with tabs (Species / Rarity / Care / Cuts); rows keep glyph + name + condition + progress bar + unlock chip; done rows get a sticker and date. Counter "0 / N filed" becomes "n / N stickers". This is the screen SK must add for the portal achievements. |
| NEXT PERMIT PENDING slip on select | A visible next goal, always in view | A small "next sticker" tag on the Hoard / title with a progress ring. |
| Bottom hint bar with key chips + big primary button | Keys always discoverable | The toolbar dock itself: icon buttons with 1-key hints as small chips, labels on hover / focus / live region (owner decision 3). On touch, replace chips with the tool names under the icons. |
| Two-press "armed" confirm; hold-to-banish; arming window that swallows carry-over taps (160 to 1000 ms) | Protects destructive actions and rapid taps | Cut / Reconnect all / Release: first press arms (button turns warm, label becomes "Tap again", 2.5 s auto-disarm), or press-and-hold with a filling ring. Add a 250 ms input arm when a panel opens under a held finger. |
| Toast queue rules (4.5 s hold, 3 s gap, max 2, hidden under full screens, keyed + `alive()`) | Calm, never stacked | Reuse as-is for SK toasts and the announcer. |
| Loading card = same card, 9 status lines, striped progress | Waiting is branded | "Warming up the jelly... Finding the felt... Wobbling the camera..." + a soft jelly progress bar (gradient fill with a moving gloss). Same card for boot, reload and recovery. |
| Opening cinematic that is skippable by any key (armed 350 ms), 3 lengths + reduced | Delight without punishment | A 2 s "wake-up" intro on first run only (squishy opens eyes), skippable, off under Calm. |
| Sound per prop, thinned theme in menus, ducking only on stings | Menus feel authored | SK UI sound set (procedural, in SK's existing synthesis style): tick (hover on mouse only), soft press, select, toggle on / off, open, close, error, sticker-slap, capsule-open; gap table like `GAP` (30 to 500 ms); quieter than the toy; mute-aware. |
| Redundant rarity encoding (shape + stamp + colour) | Colour-blind safe | Rarity = gel shape (bubble, flower, star...) + sparkle count + colour + name; never colour only. |
| Pooled DOM, change-only writers, transform-only HUD | Near-zero cost | Copy the `TextSlot` / `VarSlot` / `ClassSlot` pattern for the meter ring and counts. |
| Scale unit `--u` | Resolution independence | Use a clamped unit with a floor that keeps text at least 12 px and targets at least 44 px (Blocktooth's 8 px floor is the failure). |
| `pulse()` WAAPI one-shot helper | Restart a flourish without layout | Equivalent helper for squash / settle one-shots; WAAPI `animate()` is CSP-safe. |
| Fatal / no-WebGL cards in the same style | Failure still feels designed | SK `errorCard.ts` already exists: restyle with the shelf metaphor. |

What NOT to copy: skew and parallelograms (they say "broadcast", not "soft"), hard offset ink shadows and square corners (SK = superellipse radii and layered soft shadows with an inner highlight), all-caps everywhere, text below 12 px, the 8 px phone floor, `tabindex=-1` buttons and no focus ring, no `:active`, teal / red / coral small text on cream (3.5:1 or less), inline scripts / inline `<style>` injection, `innerHTML` for copy, a 174 KB stylesheet, duplicate tokens as raw hexes, the controls bar colliding with the primary button, no h1 on the title, and the sound that only plays on keyboard (SK needs touch haptics and press sounds).

Budget reality check: BLOCKTOOTH's whole stylesheet is 173,548 B raw (27,269 B gzip) without the 24 `@font-face` blocks, the JS entry chunk is 1,671,240 B raw (577,551 B gzip), the 8 font files add 164,436 B. SK has roughly 86 to 90 KB for ALL UI polish (UI.md section 2.7), so the component CSS must be an order of magnitude leaner than 174 KB: tokens + 10 shared components + icon paths in code, no per-screen one-off art. Today SK's UI CSS is `styles.css` 29,630 B + `hoard.css` 39,062 B + `boot.css` 1,232 B + `dev.css` 1,638 B = 71,562 B raw.

---

## 11. Squish Keeper gaps against this bar (evidence from files read this session)

| Gap | Evidence | Blocktooth does |
|---|---|---|
| No achievements / goals / records screen and no portal bridge at all | `grep forgeflow:\|__PAUSE__\|GAME_CONFIG\|game_controls\|achievement` over `wobblehoard/src`, `index.html`, `public/*.json` = 0 matches | GOALS & RECORDS + `forgeflow:achievement` (46 ids, tiers, XP), save / load with write lock, game_over score, whoami |
| No `game_controls.js` bar and no `__PAUSE__` hook | `wobblehoard/index.html` (33 lines) has no such script | Every ForgeFlow game ships the bar; the portal removed its own fullscreen button |
| No `thumbnail.png` and no `README.md` | `wc` -> "public/thumbnail.png: No such file", no `README.md` at the game root | 1280x720 PNG 1,602,979 B + 586-line README |
| `game_meta.json` is stale for the new UI | art_direction says "plain system-style lettering"; tags include `singleplayer`; description says collecting / merging "are being built" | meta describes the actual look and screens; platform doc says drop `singleplayer` only for multiplayer |
| No real loading card | `index.html:28` `<div id="boot" role="status">SQUISH KEEPER</div>`; `boot.css` 1,232 B | boot card = brand art + progress + 9 status lines, reused between loads |
| No UI sound API | `grep ui?.(|uiSound|'press'|'toggle'` over `src/audio` = no matches | 10 UI sounds + menu tick + music themes |
| Title is basic (flat gradient wordmark, system text) | `_spec/UI.md` header + `titleCard.ts` (per-letter spans, one CTA "Wake it up") | painted scene, logo with signature damage, secondary chips, ticker, intro |
| No stats / records surface, no "next unlock" surface | no matching files in `src/ui` (only hoard panel) | RECORDS table, DESK RECORD, YOUR BEST, NEXT PERMIT |
| No credits / about | none in `src/ui` listing | README only (same gap) |
| Pause / settings / error surfaces not yet in one metaphor | `settingsPanel.ts` + `errorCard.ts` exist; theme work is pending (UI.md section 1) | pause = test card, settings = Station Engineering, error = Technical Difficulties |
| No toast / banner system beyond the announcer | `announcer.ts` is a live region only | queue rules + 3 banner kinds + GOAL MET toast |
| Controls bar corner not reserved | SK HUD has capsule dock, settings and mute buttons (UI.md section 3) which will meet the 126 x 34 px bar | Blocktooth only reserved the ticker |
Where SK is already ahead: real `:focus-visible` rings on 6 selectors (`styles.css:45, 243, 344-345, 353, 368, 485`, `hoard.css:382`), `prefers-reduced-motion` blocks in `styles.css:530, 543` and `hoard.css:316, 433`, a live region, phone-first layout, 44 px `--tap` token, `<canvas role="img" aria-label>`, a strict-CSP-clean index.

---

## 12. Screenshot index (absolute directory: `<scratch>/ui/blocktooth/shots/`, 84 files, PNG; desktop 1280x800 dpr 1, phone 390x844 dpr 2 so 780x1688)

Scratch root: `C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad/ui/blocktooth/shots/`
| Screen | Desktop file | Phone file | Caveat |
|---|---|---|---|
| Boot card | `desktop_01_boot_card.png` | `phone_01_boot_card.png` | |
| Title | `desktop_02_title_t0.7s`, `03_title_t3s`, `04_title_chip_hover`, `18_title_after_back` | `phone_02`, `03`, `18` | hover is visually identical to 03 |
| GOALS & RECORDS | `05_goals_general`, `06_goals_general_scrolled`, `07_goals_tab1_molo`, `07_goals_tab5_cities`, `07_goals_tab6_records` | `phone_05`, `06`, `07_*` | no FILED stamp captured (0 / 46 on a clean profile) |
| Select step 1 | `08_select_step1_molo`, `09_..._voltkite`, `10_..._briarwick`, `11_..._colourway_row`, `12_..._colourway_changed` | `phone_08..12` | |
| Select step 2 | `13_..._biome_grideast`, `14_..._whitestacks`, `15_..._lockwater`, `16_..._perk_row`, `17_..._perk_changed` (locked perk shown) | `phone_13..17` | |
| VS PRACTICE / ONLINE VS | `19_vs_practice_screen` (mid-fade, dimmed), `20_online_vs_screen` | not captured | live-only screens |
| Loading card | `21_loading_1` ("FOCUSING THE LENS...") | `phone_21_loading_2` ("ROLLING OUT THE CITY...") | other status lines not captured |
| Opening (STREET CAM) | `22_opening_2`, `22_opening_5` (second is the cut to gameplay) | `phone_22_opening_a`, `_b` | |
| HUD | `30_play_hud`, `31_play_moving` | `phone_30_play_hud` | |
| Pause | `32_pause` (mid-fade), `33_pause_sel_settings`, `37_pause_retry_armed` (empty LOADOUT) | `phone_32b_pause_loadout` (1 card) | **`desktop_32b_pause_loadout.png` is gameplay, not the pause screen** (the first Esc was swallowed after the draft); use 37 and phone_32b |
| Settings | `34_settings`, `35_settings_row_quality`, `36_settings_done_row` | `phone_36_settings_done_row` | |
| Draft | `40_draft`, `41_draft_card2_selected`, `42_draft_picked_forced_state` (FILED stamp forced by adding `is-picked`, because the real state lasts 280 ms), `42_draft_picked` (already closed) | `phone_40..42` | |
| MASS BREACH banner | `43c_massbreach_banner_paused_1.1s` (animations paused at 1.1 s with `getAnimations()`), `43_`, `44_` (play, banner gone) | `phone_43c` (banner not visible: capture timing) | |
| GOAL MET toast | `44b_toast_goal_met` (timers stretched 20x) | `phone_44b_toast_goal_met` | |
| Boss plate + urgent alert | `45_boss_alert`, `45_boss_alert_1.5s`, `46_boss_plate_5s` | `phone_45_boss_alert` | |
| UPROAR meter | `47_uproar_ready`, `48_uproar_fired` | not captured | |
| Tracker + markers + toast | `49_tracker_markers` | not captured | |
| Victory finale | `50a_finale_banner` ("TIMBERRR!", "BIGGER!", LOAD SHED stamp) | not captured | |
| End page (clear) | `50_tabloid_clear`, `51_tabloid_clear_settled`, `52_tabloid_btn_focus` (mid-press animation, one button blank) | `phone_50_tabloid_clear` | death page, EXTENDED COVERAGE edition, boss phases 2/3, gatekeeper plates, overflow draft, banish / lock actions, cinematic REDUCED variant: **[not captured]** |
Run logs: `front_desktop.log|json`, `front_phone.log|json`, `run_desktop.log`, `run2_desktop.log`, `run3_desktop.log`, `run3_phone.log` (all `problems: []` except AudioContext device errors under headless, WebGL ReadPixels stall and the SwiftShader parallel-compile warning).
Live downloads kept for reference: `live/index.html`, `live/index.css`, `live/index.js`, `live/game_controls.js`.

## 13. Things I did not check
Audio by ear; HUD frame cost; portal-side achievements page and detail page with the framed game; signed-in states (account line variants `guest` / `filed`, `forgeflow:run_result` ack); gamepad navigation; Safari / Firefox; the VS gameplay itself; the death and EXTENDED COVERAGE end pages; high-contrast or forced-colors rendering (none exists to test).
