# UX evidence notes (raw observations, no opinions)

Collected 2026-11-15T06:33:20-06:00 on game HEAD `e5ea2bac1`. Viewports 1920x1080 and 1366x768. See index.json for every file.

## Method and limits

- Real Chrome (channel chrome, ANGLE Metal), fresh temporary profile, deviceScaleFactor 1, headless, one heavy slot.
- Paired shots: the same state is captured at 1920x1080, the browser viewport is then resized live to 1366x768 and captured again. Cold-load phases use a separate fresh load per viewport.
- Match phases pause the sim (setTimeScale 0) around some shots to catch a moment; each such step says so in desc.
- Layout facts come from a DOM scan per shot (overflow clipping, ellipsis, text outside the viewport, smallest font); raw numbers only.
- Machine load (1-min load average) is stored on every step (`load1` in index.json). Timings taken under load are labelled with it.
- Dev-server phases load unbundled modules; their load times are not a cold-load measure. Only the `cold*` phases use the production build.

## Timings, cold first run, cold1366

- Machine load average at start 3.81, at end 3.
- Navigation commit: 12 ms (Node side).
- First contentful paint: 77 ms. Largest contentful paint: 432 ms (SECTION.hband plate stg).
- First canvas in DOM: 15 ms. Nav bar in DOM: 268 ms. Home screen in DOM: 268 ms (page clock; Node-side 503 ms).
- Resources by Home: 28 requests, 5781850 encoded bytes, 7433007 decoded; by extension {'js': 8, 'css': 1, 'json': 2, 'woff2': 8, 'hdr': 1, 'cube': 1, 'webp': 6, 'svg': 1}.
- Long tasks (start ms, duration ms) before Home: [[103, 73], [178, 76], [297, 55]].
- Frame pacing from navigation to Home: {'frames': 9, 'windowMs': 268, 'avgFps': 32, 'p50ms': 16.7, 'p95ms': 133.3, 'maxMs': 133.3, 'over33ms': 1, 'over50ms': 1}. Home idle 5 s: {'frames': 342, 'windowMs': 5793, 'avgFps': 59.3, 'p50ms': 16.7, 'p95ms': 16.7, 'maxMs': 83.4, 'over33ms': 1, 'over50ms': 1}.
- Warm reload (same context, HTTP cache): Home at 216 ms (page clock), Node-side 301 ms; resources 28.
- Play click to Play screen shown: 1004 ms (Node side).
- Find match click to HUD in DOM: 19758 ms (page clock); to first two animation frames after the HUD: 19775 ms; Node-side flow 20553 ms (includes the driver's own click waits).
- Stages from the Find match click (page clock ms): {'queue': 77, 'draft': 7564, 'loading': 16656, 'hud': 19758}.
- First 32+ s of match frame pacing: {'frames': 2303, 'windowMs': 38419, 'avgFps': 60, 'p50ms': 16.7, 'p95ms': 16.7, 'maxMs': 50, 'over33ms': 1, 'over50ms': 0}.
- Resources by the first match frame: 250 requests, 54691014 encoded bytes; largest [['/catalog/assets/c08026cd11e1-glass_belfry.glb', 1744092, 12170], ['/catalog/assets/e056aa49908d-sky.hdr', 1687306, 126], ['/catalog/assets/2b8de80ba599-odrum.glb', 1189612, 17911], ['/catalog/assets/1302f15cd177-burdam.glb', 1186956, 18017], ['/catalog/assets/b83e1497a596-rishal.glb', 1186868, 18171], ['/catalog/assets/6f2504255aea-ardit.glb', 1184260, 13887], ['/catalog/assets/3e54a7bfd707-ervet.glb', 1183936, 16609], ['/catalog/assets/1fd9a02ae95a-ilsheta.glb', 1181636, 18017]].

## Timings, cold first run, cold1920

- Machine load average at start 5.1, at end 3.88.
- Navigation commit: 16 ms (Node side).
- First contentful paint: 89 ms. Largest contentful paint: 620 ms (IMG.aimg is-ok ).
- First canvas in DOM: 18 ms. Nav bar in DOM: 302 ms. Home screen in DOM: 302 ms (page clock; Node-side 1067 ms).
- Resources by Home: 28 requests, 5781850 encoded bytes, 7433007 decoded; by extension {'js': 8, 'css': 1, 'json': 2, 'woff2': 8, 'hdr': 1, 'cube': 1, 'webp': 6, 'svg': 1}.
- Long tasks (start ms, duration ms) before Home: [[121, 84], [208, 78], [305, 71]].
- Frame pacing from navigation to Home: {'frames': 10, 'windowMs': 302, 'avgFps': 33.8, 'p50ms': 16.7, 'p95ms': 133.4, 'maxMs': 133.4, 'over33ms': 1, 'over50ms': 1}. Home idle 5 s: {'frames': 390, 'windowMs': 6602, 'avgFps': 59.1, 'p50ms': 16.7, 'p95ms': 16.8, 'maxMs': 100.1, 'over33ms': 1, 'over50ms': 1}.
- Warm reload (same context, HTTP cache): Home at 196 ms (page clock), Node-side 268 ms; resources 28.
- Play click to Play screen shown: 931 ms (Node side).
- Find match click to HUD in DOM: 20881 ms (page clock); to first two animation frames after the HUD: 20903 ms; Node-side flow 22727 ms (includes the driver's own click waits).
- Stages from the Find match click (page clock ms): {'queue': 73, 'draft': 8731, 'loading': 17705, 'hud': 20881}.
- First 32+ s of match frame pacing: {'frames': 2774, 'windowMs': 46232, 'avgFps': 60, 'p50ms': 16.7, 'p95ms': 16.7, 'maxMs': 16.8, 'over33ms': 0, 'over50ms': 0}.
- Resources by the first match frame: 250 requests, 57745030 encoded bytes; largest [['/catalog/assets/c08026cd11e1-glass_belfry.glb', 1744092, 13498], ['/catalog/assets/e056aa49908d-sky.hdr', 1687306, 109], ['/catalog/assets/f911ea88cb79-lisvel.glb', 1189204, 18164], ['/catalog/assets/1302f15cd177-burdam.glb', 1186956, 19462], ['/catalog/assets/6f2504255aea-ardit.glb', 1184260, 15805], ['/catalog/assets/fa7a6f2e4dde-marund.glb', 1182156, 18463], ['/catalog/assets/fa7a6f2e4dde-marund.glb', 1182156, 19361], ['/catalog/assets/80efea6152eb-tunlan.glb', 1182004, 17564]].

## Console, network and page errors (every warning and error, grouped)

### cold1366: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 0}
- none

### cold1920: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 0}
- none

### draft: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 9, 'debug': 9}
- none

### hud: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 1}
- none

### hud_bridge: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 1}
- none

### hud_dead: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 1}
- none

### hud_fray: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 1}
- none

### menus: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 1, 'debug': 1}
- none

### post_fray: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 1}
- none

### post_rift: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 2, 'debug': 1}
- none

### practice: 0 lines, 0 distinct; info/log/debug counts {'log': 0, 'info': 1, 'debug': 1}
- none

Total lines across phases: 0.

## Layout facts (DOM scan per shot)

Kinds: clipped-x / clipped-y (own text wider/taller than its box with overflow hidden), ellipsis-truncated, line-clamped, outside-viewport (text element whose box leaves the viewport and no scrolling ancestor explains it), outside-scroll-ancestor (box beyond a scrolling ancestor: normally scrolled-away content), scrollable (a scroll area with extra content).

### cold1366: 0 distinct non-scroll findings in 29 shots
- none

### cold1920: 1 distinct non-scroll findings in 31 shots
- clipped-y `span.skel` "" x5 e.g. 1920x1080/cold1920_001_boot_01.png, 1920x1080/cold1920_001_boot_01.png, 1920x1080/cold1920_001_boot_01.png

### draft: 5 distinct non-scroll findings in 181 shots
- ellipsis-truncated `span.frow__name.t-caption` "maeve_in_amber" x4 e.g. 1920x1080/draft_148_fray_standard_08_match.png, 1366x768/draft_149_fray_standard_08_match.png, 1920x1080/draft_150_fray_standard_first_match_frame.png
- ellipsis-truncated `span.frow__name.t-caption` "mina_noonmark" x4 e.g. 1920x1080/draft_148_fray_standard_08_match.png, 1366x768/draft_149_fray_standard_08_match.png, 1920x1080/draft_150_fray_standard_first_match_frame.png
- ellipsis-truncated `span.frow__name.t-caption` "oda_longlight" x2 e.g. 1366x768/draft_149_fray_standard_08_match.png, 1366x768/draft_151_fray_standard_first_match_frame.png
- ellipsis-truncated `span.frow__name.t-caption` "dax_shadeline" x2 e.g. 1366x768/draft_149_fray_standard_08_match.png, 1366x768/draft_151_fray_standard_first_match_frame.png
- ellipsis-truncated `span.frow__name.t-caption` "twomark_tess" x2 e.g. 1366x768/draft_149_fray_standard_08_match.png, 1366x768/draft_151_fray_standard_first_match_frame.png

### hud: 0 distinct non-scroll findings in 61 shots
- none

### hud_bridge: 0 distinct non-scroll findings in 28 shots
- none

### hud_dead: 0 distinct non-scroll findings in 20 shots
- none

### hud_fray: 3 distinct non-scroll findings in 28 shots
- ellipsis-truncated `span.frow__name.t-caption` "noor_lampwright" x16 e.g. 1920x1080/hud_fray_013_fray_idle.png, 1366x768/hud_fray_014_fray_idle.png, 1920x1080/hud_fray_015_fray_minimap_crop.png
- ellipsis-truncated `span.frow__name.t-caption` "belle_of_noon" x8 e.g. 1366x768/hud_fray_014_fray_idle.png, 1366x768/hud_fray_016_fray_minimap_crop.png, 1366x768/hud_fray_018_fray_scoreboard.png
- ellipsis-truncated `span.frow__name.t-caption` "candlewick_ro" x8 e.g. 1366x768/hud_fray_014_fray_idle.png, 1366x768/hud_fray_016_fray_minimap_crop.png, 1366x768/hud_fray_018_fray_scoreboard.png

### menus: 1 distinct non-scroll findings in 86 shots
- ellipsis-truncated `span.offer__name.t-body-s` "Gorgewalk Longbow" x2 e.g. 1366x768/menus_046_shop.png, 1366x768/menus_050_shop_item_selected.png

### post_fray: 2 distinct non-scroll findings in 28 shots
- ellipsis-truncated `span.frow__name.t-caption` "oda_longlight" x1 e.g. 1366x768/post_fray_014_end_banner_early.png
- ellipsis-truncated `span.frow__name.t-caption` "ruth_afterlight" x1 e.g. 1366x768/post_fray_014_end_banner_early.png

### post_rift: 0 distinct non-scroll findings in 28 shots
- none

### practice: 0 distinct non-scroll findings in 28 shots
- none

### Smallest text per shot (px), lowest ten across all phases

- 10 px at 1366x768/cold1366_019_cold_flow_14_match.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_020_first_match_frame_0.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_021_first_match_frame_3s.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_022_first_match_hint_1.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_023_first_match_hint_2.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_024_first_match_hint_3.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_025_first_match_hint_4.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_026_first_match_after_move_click.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_027_first_match_ability_tooltip.png: span.hmenu__key "Esc"
- 10 px at 1366x768/cold1366_028_first_match_after_Q.png: span.hmenu__key "Esc"

### Document scroll (documentElement scroll size larger than the viewport)

- none

## Observations recorded by the driver, in order

### cold1366
- [1s, load 3.81, step `home`] home inventory on first load {"dialogs": 0, "toasts": 0, "nav": ["HOME", "PLAY", "COLLECTION", "SHOP", "PROFILE", "SETTINGS"], "buttons": ["FIND A MATCH", "RANKED SEASON Opens at account level 20.", "SKINS IN THE SHOP Spend the Candles you ", "SPARRING PRACTICE Any fighter, the full ", "YOUR COLLECTION Every fighter is free. S", "PLAY FRAY"], "canvases": 1, "fonts": "10/23", "title": "VALE", "lang": "en", "storage": ["vale.profile.v1"]}
- [6s, load 3.67, step `home_settled`] video settings after first-run calibration {"preset": "high", "renderScale": 1, "shadows": 2, "ao": 1, "bloom": true, "antialias": "smaa", "particles": 2, "scatter": 2, "fpsCap": 0, "maxDpr": 1, "fullscreen": false, "ambientEffects": true, "dynamicResolution": true}
- [9s, load 3.61, step `first_flow`] Play: stations and queue cards on first visit {"modes": ["RIFT", "BRIDGE", "FRAY", "The uncarved hour"], "queues": ["QUICK QUICK Win: 100 Candles · Loss: 70 Candles", "DRAFT STANDARD Reach level 3 to play Draft.", "RANKED ? RANKED Reach level 20 to play Ranked.", "LANTERN DRILL CO-OP Win: 80 Candles · Loss: 60 Candles"]}
- [64s, load 3, step `first_match`] hud feed/hint text lines at 32 s ["Right-click the ground to move."]
- [67s, load 3, step `first_match_input`] tooltip text on ability hover ["LANCING RUN Q Ability 1 · Rank 0 of 5 Cooldown 14 s Cost 60 Light Range 7 m Ardit runs up to 7 m behind the pavise and stops at the first enemy fighter he meets. They take 70 (+50% Power, +3% bonus Health) magic damage and are knocked airborne for 0.75 s. Hold Shift for every rank. Level up · Ctrl +"]

### cold1920
- [2s, load 5.1, step `home`] home inventory on first load {"dialogs": 0, "toasts": 0, "nav": ["HOME", "PLAY", "COLLECTION", "SHOP", "PROFILE", "SETTINGS"], "buttons": ["FIND A MATCH", "RANKED SEASON Opens at account level 20.", "SKINS IN THE SHOP Spend the Candles you ", "SPARRING PRACTICE Any fighter, the full ", "YOUR COLLECTION Every fighter is free. S", "PLAY FRAY"], "canvases": 1, "fonts": "10/23", "title": "VALE", "lang": "en", "storage": ["vale.profile.v1"]}
- [7s, load 5.66, step `home_settled`] video settings after first-run calibration {"preset": "high", "renderScale": 1, "shadows": 2, "ao": 1, "bloom": true, "antialias": "smaa", "particles": 2, "scatter": 2, "fpsCap": 0, "maxDpr": 1, "fullscreen": false, "ambientEffects": true, "dynamicResolution": true}
- [10s, load 5.36, step `first_flow`] Play: stations and queue cards on first visit {"modes": ["RIFT", "BRIDGE", "FRAY", "The uncarved hour"], "queues": ["QUICK QUICK Choose your role and fighter before you queue. Everyone starts at the first ho", "DRAFT STANDARD Pick your roles, ban one fighter per team, then pick in turns. Matches run ", "RANKED ? RANKED Draft with one ban per team while the roster is 16 strong. Your rating mov", "LANTERN DRILL CO-OP Your team against five bots that play at an easy pace. A calm place to"]}
- [72s, load 3.96, step `first_match`] hud feed/hint text lines at 32 s ["Right-click an enemy to attack it. Shift + right-click (or A, then click) attacks the enemy nearest your cursor; on open ground you walk there and hit the first enemy in range. Hold Z to target fighters only."]
- [75s, load 3.88, step `first_match_input`] tooltip text on ability hover ["LANCING RUN Q Ability 1 · Rank 0 of 5 Cooldown 14 s Cost 60 Light Range 7 m Ardit runs up to 7 m behind the pavise and stops at the first enemy fighter he meets. They take 70 (+50% Power, +3% bonus Health) magic damage and are knocked airborne for 0.75 s. Hold Shift for every rank. Level up · Ctrl +"]

### draft
- [5s, load 2.68, step `boot`] profile seeded to level 25 so every queue is unlocked (the fresh-profile lock states are in the menus phase)
- [345s, load 15.28, step `custom_flow`] custom CTA label "START GAME"

### hud
- [45s, load 39.58, step `rift_flow_05_draft`] rift: flow to HUD took 36871 ms
- [45s, load 39.58, step `pregame`] first poll after HUD {"phase": "pregame", "time": -26.5, "scale": 1, "level": 1, "dead": false, "respawnIn": 0, "gold": 100, "items": 2, "skill": 0, "nearFighters": 5, "ended": false, "evs": []}
- [99s, load 42.8, step `shop`] shop facts {"sections": ["SUGGESTED · ARDIT", "STARTERS", "CONSUMABLES", "BOOTS", "BASIC", "CORE", "APEX"], "tags": ["ALL ITEMS", "ATTACK", "CRITICAL", "ON HIT", "MAGIC", "HASTE", "DEFENSE", "SUSTAIN", "SPEED", "SUPPORT", "VISION", "UTILITY", "DIALWOOD"], "tiles": 62, "gold": "100", "access": "You can shop anywhere in your base, or while you wait to return."}
- [108s, load 43.38, step `shop`] search "blade" tiles 1
- [156s, load 52.17, step `tooltips`] ability slot count 6
- [185s, load 34.39, step `tooltips`] ability tooltip DOM (last) []
- [225s, load 19.69, step `levelup`] level-up {"level": 2, "skillPoints": 0, "time": 108.3}
- [444s, load 3.47, step `late`] captured events ["levelup", "items", "fight", "late"]
- [444s, load 3.47, step `late`] last poll {"phase": "live", "time": 900.2, "scale": 4, "level": 12, "dead": false, "respawnIn": 0, "gold": 499, "items": 5, "skill": 0, "nearFighters": 1, "ended": false, "evs": []}

### hud_bridge
- [49s, load 3.58, step `bridge_flow_12_loading`] bridge: flow to HUD took 42930 ms

### hud_dead
- [31s, load 4.43, step `rift_flow_12_loading`] rift: flow to HUD took 26186 ms
- [208s, load 3.45, step `dead`] death {"time": 1256.3, "level": 14, "respawnIn": 37.03333333333353}
- [208s, load 3.45, step `dead`] captured ["teamfight", "dead"]
- [208s, load 3.45, step `dead`] last poll {"phase": "live", "time": 1256.3, "scale": 8, "level": 14, "dead": true, "respawnIn": 37.03333333333353, "gold": 492, "items": 4, "skill": 0, "nearFighters": 5, "ended": false, "evs": [{"e": "dmg", "t": 1255.0666666666666, "other": "fighter", "dir": "in"}, {"e": "dmg", "t": 1255.0666666666666, "other": "fighter", "dir": "in"}, {"e": "dmg", "t": 1255.5, "other": "fighter", "dir": "in"}, {"e": "dmg", "t": 1255.9, "other": "fighter", "dir": "in"}, {"e": "dmg", "t": 1256.1666666666667, "other": "fighter", "dir": "in"}, {"e": "dmg", "t": 1256.1666666666667, "other": "fighter", "dir": "in"}, {"e": "died", "t": 1256.1666666666667}, {"e": "takedown", "t": 1256.1666666666667, "mine": "death"}]}

### hud_fray
- [25s, load 4.2, step `fray_flow_12_loading`] fray: flow to HUD took 19373 ms

### menus
- [6s, load 4.76, step `home`] home buttons ["FIND A MATCH", "RANKED SEASON Opens at account level 20. Five plac", "SKINS IN THE SHOP Spend the Candles you earn on ne", "SPARRING PRACTICE Any fighter, the full map, alone", "YOUR COLLECTION Every fighter is free. Skins chang", "PLAY FRAY"]
- [6s, load 4.76, step `home`] top bar null
- [13s, load 4.62, step `play`] mode stations ["RIFT", "BRIDGE", "FRAY", "The uncarved hour"]
- [47s, load 4, step `play_FRAY_q0`] play mode The uncarved hour failed: TimeoutError: locator.click: Timeout 4000ms exceeded.
Call log:
  - waiting for locator('.station').
- [67s, load 3.81, step `collection`] collection tabs ["FIGHTERS 16", "SKINS 0/32"]
- [71s, load 3.5, step `collection`] tab "FIGHTERS 16" of collection failed: TimeoutError: locator.click: Timeout 4000ms exceeded.
Call log:
  - waiting for locator('.scr:not(.i
- [75s, load 3.46, step `collection`] tab "SKINS 0/32" of collection failed: TimeoutError: locator.click: Timeout 4000ms exceeded.
Call log:
  - waiting for locator('.scr:not(.i
- [84s, load 3.35, step `fighter_detail`] fighter_detail tabs []
- [88s, load 3.48, step `loadout`] loadout tabs ["SHADELINE", "WARMSTONE 2/2", "HOURTURN"]
- [95s, load 3.47, step `loadout_tab_shadeline`] tab "WARMSTONE 2/2" of loadout failed: TimeoutError: locator.click: Timeout 4000ms exceeded.
Call log:
  - waiting for locator('.scr:not(.i
- [105s, load 3.56, step `shop`] shop tabs []
- [112s, load 3.35, step `profile`] profile tabs ["OVERVIEW", "HISTORY 0", "RATING"]
- [119s, load 3.3, step `profile_tab_overview`] tab "HISTORY 0" of profile failed: TimeoutError: locator.click: Timeout 4000ms exceeded.
Call log:
  - waiting for locator('.scr:not(.i
- [129s, load 3.27, step `settings`] settings tabs ["VIDEO", "AUDIO", "CONTROLS", "ACCESSIBILITY", "GAMEPLAY", "CREDITS"]

### post_fray
- [32s, load 9.25, step `fray_flow_12_loading`] fray: flow to HUD took 26497 ms
- [33s, load 9.25, step `fast_forward`] progress {"t": 32.6, "scale": 16, "level": 6}
- [63s, load 9.3, step `fast_forward`] progress {"t": 519, "scale": 16, "level": 7}
- [76s, load 8.33, step `postgame_summary`] postgame tabs ["SUMMARY", "HOUR BOARD", "GLEAM LEAD"]
- [88s, load 6.79, step `postgame_tab_gleam-lead`] postgame text (default tab) "FRAY · STANDARD 3rd of 10 You kept your hour longer than seven others. Last one standing · 9:43 played SUMMARY HOUR BOARD GLEAM LEAD GLEAM LEAD BY MINUTE Above the line, your team was ahead. 0 5 10 +1,000 −1,000 Minute CHOOSE ANOTHER MODE RETURN HOME PLAY AGAIN"
- [88s, load 6.79, step `postgame_tab_gleam-lead`] postgame buttons ["SUMMARY", "HOUR BOARD", "GLEAM LEAD", "CHOOSE ANOTHER MODE", "RETURN HOME", "PLAY AGAIN"]

### post_rift
- [28s, load 5.47, step `rift_flow_12_loading`] rift: flow to HUD took 23814 ms
- [28s, load 6.07, step `fast_forward`] progress {"t": -6, "scale": 16, "level": 1}
- [59s, load 6.62, step `fast_forward`] progress {"t": 475.6, "scale": 16, "level": 7}
- [89s, load 8.38, step `fast_forward`] progress {"t": 955.8, "scale": 16, "level": 12}
- [126s, load 7.97, step `postgame_summary`] postgame tabs ["SUMMARY", "SCOREBOARD", "GLEAM LEAD"]
- [136s, load 7.12, step `postgame_tab_gleam-lead`] postgame text (default tab) "RIFT · LANTERN DRILL DEFEAT Your Hourbell fell quiet. The light holds for another day. Hourbell silenced · 23:31 played SUMMARY SCOREBOARD GLEAM LEAD GLEAM LEAD BY MINUTE Above the line, your team was ahead. 0 5 10 15 20 +3,597 −3,597 Minute CHOOSE ANOTHER MODE RETURN HOME PLAY AGAIN"
- [136s, load 7.12, step `postgame_tab_gleam-lead`] postgame buttons ["SUMMARY", "SCOREBOARD", "GLEAM LEAD", "CHOOSE ANOTHER MODE", "RETURN HOME", "PLAY AGAIN"]

### practice
- [8s, load 2.93, step `practice_setup`] practice rows ["Map Practice on any map that ends at a core. RIFT BRIDGE", "Infinite Gleam Your Gleam never runs out. ON", "No cooldowns Abilities and spells are ready the moment you cast them. OFF", "Wicks Waves of Wicks walk the roads. Turn them on or off at any time in the match. ON", "Structures Needles and Lanterns shoot and can be broken. Off, they neither shoot nor take damage. ON", "Training targets Targets stand still and never attack. They heal to full 4 s after the last hit. 3", "Starting level 1", "Sparring partner A fighter on the other team, played by a bot. None"]
- [8s, load 2.93, step `practice_setup`] practice CTA "START PRACTICE"
- [22s, load 3.1, step `practice_08_loading`] practice flow to HUD ms 13654
- [56s, load 3.12, step `practice_hud`] practice panel text "PRACTICE BENCH ADD 5,000 GLEAM LEVEL UP REFRESH COOLDOWNS NO COOLDOWNS FULL HEAL MOVE TO A POINT The map WICKS STRUCTURES RESET MATCH Training targets PLACE A TRAINING TARGET REMOVE ALL TARGETS Health Armor Resist Speed PAUSED ×1 ×2 ×4 ×8 ×16 Damage you dealt CLEAR Last hit — This burst — Per second — Last 5 s — Total —"
- [71s, load 3.19, step `practice_hud`] practice positions {"me": [8.5, 55], "d": null, "kinds": {"fighter": 1, "structure": 24, "minion": 2}}
- [78s, load 3.17, step `practice_hud`] events after fight {"phase": "live", "time": 22.5, "scale": 1, "level": 5, "dead": false, "respawnIn": 0, "gold": 55000, "items": 0, "skill": 5, "nearFighters": 1, "ended": false, "evs": [{"e": "levelUp", "level": 2, "t": 11.43333333333333}, {"e": "levelUp", "level": 3, "t": 13.733333333333334}, {"e": "levelUp", "level": 4, "t": 13.93333333333333}, {"e": "levelUp", "level": 5, "t": 14.133333333333333}]}

## Timings of the draft / queue flows (dev server, real time)

- rift_quick: flow 24989 ms, reached HUD: True, page-clock marks queue 7626, draft 14116, loading 23948, hud 29249
- rift_draft: flow 59221 ms, reached HUD: True, page-clock marks queue 6556, draft 12747, loading 59911, hud 65297
- rift_ranked: flow 57553 ms, reached HUD: True, page-clock marks queue 6799, draft 12897, loading 58341, hud 62752
- rift_lantern-drill: flow 27965 ms, reached HUD: True, page-clock marks queue 6630, draft 12846, loading 30111, hud 34526
- bridge_standard: flow 47668 ms, reached HUD: True, page-clock marks queue 6594, draft 13104, loading 46587, hud 50773
- fray_standard: flow 44524 ms, reached HUD: True, page-clock marks queue 7049, draft 13398, loading 35228, hud 47263
- custom: {'flowMs': 72196, 'marks': {'longtasks': [[1004, 103], [1108, 107], [1298, 202], [8746, 55], [8804, 58], [10373, 1231], [12030, 58], [12214, 157], [12375, 168], [12944, 78], [13066, 71], [13187, 63], [13379, 58], [13560, 61], [13633, 833], [14474, 53], [14995, 166], [15170, 131], [15433, 137], [15575, 131], [15710, 140], [15910, 53], [16061, 218], [16282, 107], [16392, 119], [16520, 1618], [34409, 290], [36333, 56], [40082, 206], [40538, 268], [43496, 210], [44353, 264], [44922, 1193], [46206, 266], [49329, 253], [54025, 59], [54165, 234], [54402, 246], [56674, 272], [59071, 292], [60981, 270], [62050, 262], [67771, 290], [68457, 273], [69875, 54], [72275, 90], [72820, 1178], [74008, 418], [74466, 84], [75492, 217]], 'canvas': 223, 'fcp': 386, 'lcp': 1740, 'lcp_el': 'IMG.aimg is-ok ', 'home_screen': 1295, 'nav': 1295, 'draft': 9055, 'loading': 70431, 'hud': 75459, 'hud_2raf': 75702, 'now': 80945}}

## Files that were shrunk to stay under 1.5 MB

- 1920x1080/hud_dead_015_hud_dead_recap.png: 1678700 -> 996202 bytes (palette-256)
- 1920x1080/menus_039_loadout.png: 2276158 -> 696714 bytes (palette-256)
- 1920x1080/draft_098_rift_lantern-drill_04_draft.png: 2119939 -> 688025 bytes (palette-256)
- 1920x1080/cold1920_027_first_match_hint_4.png: 2545658 -> 1023566 bytes (palette-256)
- 1920x1080/draft_013_rift_quick_06_loading.png: 2324977 -> 696443 bytes (palette-256)
- 1920x1080/hud_fray_005_fray_flow_05_draft.png: 2068764 -> 634110 bytes (palette-256)
- 1920x1080/practice_015_practice_dummy.png: 2232704 -> 952857 bytes (palette-256)
- 1920x1080/draft_072_rift_ranked_09_draft.png: 2118246 -> 679429 bytes (palette-256)
- 1920x1080/draft_144_fray_standard_06_draft.png: 2037593 -> 641095 bytes (palette-256)
- 1920x1080/post_rift_006_rift_flow_06_draft.png: 2070534 -> 709565 bytes (palette-256)
- 1920x1080/practice_011_practice_07_loading.png: 2304875 -> 720135 bytes (palette-256)
- 1920x1080/draft_050_rift_draft_16_loading.png: 2321510 -> 701413 bytes (palette-256)
- 1920x1080/hud_fray_001_fray_flow_01_queue.png: 2370553 -> 761992 bytes (palette-256)
- 1920x1080/practice_007_practice_03_draft.png: 2176149 -> 700130 bytes (palette-256)
- 1920x1080/cold1920_024_first_match_hint_1.png: 2591311 -> 1027444 bytes (palette-256)
- 1920x1080/hud_fray_008_fray_flow_08_draft.png: 2189418 -> 687494 bytes (palette-256)
- 1920x1080/menus_055_profile_tab_rating.png: 2282935 -> 767031 bytes (palette-256)
- 1920x1080/menus_005_play_scrolled.png: 2394780 -> 749219 bytes (palette-256)
- 1920x1080/draft_140_fray_standard_04_draft.png: 2073669 -> 635492 bytes (palette-256)
- 1920x1080/post_rift_023_postgame_tab_scoreboard_scrolled.png: 1779639 -> 676807 bytes (palette-256)
- 1920x1080/menus_037_fighter_detail_scrolled.png: 2084884 -> 661988 bytes (palette-256)
- 1920x1080/hud_bridge_025_bridge_midgame.png: 2331731 -> 737351 bytes (palette-256)
- 1920x1080/draft_011_rift_quick_05_draft.png: 2018699 -> 653138 bytes (palette-256)
- 1920x1080/menus_029_practice_scrolled.png: 2285963 -> 682204 bytes (palette-256)
- 1920x1080/draft_160_custom_04_draft.png: 2088787 -> 689588 bytes (palette-256)
- 1920x1080/menus_051_profile.png: 2197715 -> 736228 bytes (palette-256)
- 1920x1080/draft_123_bridge_standard_07_draft.png: 2205836 -> 618960 bytes (palette-256)
- 1920x1080/hud_bridge_001_bridge_flow_01_queue.png: 2304547 -> 724600 bytes (palette-256)
- 1920x1080/practice_013_practice_hud_idle.png: 2242261 -> 957737 bytes (palette-256)
- 1920x1080/draft_168_custom_08_draft.png: 2159120 -> 656886 bytes (palette-256)
- 1920x1080/draft_084_rift_ranked_15_draft.png: 2027721 -> 652676 bytes (palette-256)
- 1920x1080/menus_041_loadout_tab_shadeline.png: 2276740 -> 695390 bytes (palette-256)
- 1920x1080/draft_018_rift_draft_play.png: 2347239 -> 733695 bytes (palette-256)
- 1920x1080/cold1920_006_play_rift_coop.png: 2387428 -> 746854 bytes (palette-256)
- 1920x1080/menus_025_custom.png: 1937986 -> 677337 bytes (palette-256)
- 1920x1080/menus_071_settings_tab_accessibility.png: 2309826 -> 745229 bytes (palette-256)
- 1920x1080/menus_045_shop.png: 2467661 -> 741441 bytes (palette-256)
- 1920x1080/draft_132_fray_standard_play.png: 2360239 -> 757705 bytes (palette-256)
- 1920x1080/hud_dead_011_rift_flow_11_loading.png: 2168856 -> 780845 bytes (palette-256)
- 1920x1080/post_fray_012_fray_flow_12_loading.png: 2313505 -> 676474 bytes (palette-256)
- 1920x1080/post_fray_010_fray_flow_10_draft.png: 2071036 -> 655642 bytes (palette-256)
- 1920x1080/hud_010_hud_shop_open.png: 1883585 -> 668869 bytes (palette-256)
- 1920x1080/cold1920_018_cold_flow_12_loading.png: 2440700 -> 763085 bytes (palette-256)
- 1920x1080/practice_012_practice_08_loading.png: 2304449 -> 721704 bytes (palette-256)
- 1920x1080/menus_079_settings_tab_credits_scrolled.png: 2432232 -> 801085 bytes (palette-256)
- 1920x1080/cold1920_021_cold_flow_15_match.png: 2525433 -> 1010726 bytes (palette-256)
- 1920x1080/menus_035_fighter_detail.png: 2188028 -> 660182 bytes (palette-256)
- 1920x1080/menus_009_play_rift_q0_quick.png: 2390995 -> 749132 bytes (palette-256)
- 1920x1080/menus_033_collection_scrolled.png: 2384222 -> 718529 bytes (palette-256)
- 1920x1080/menus_067_settings_tab_controls.png: 2278806 -> 743903 bytes (palette-256)
- 1920x1080/draft_107_rift_lantern-drill_first_match_frame.png: 2391682 -> 967215 bytes (palette-256)
- 1920x1080/hud_054_hud_fight.png: 2398000 -> 827963 bytes (palette-256)
- 1920x1080/draft_174_custom_11_draft.png: 2154911 -> 663753 bytes (palette-256)
- 1920x1080/hud_056_hud_fight_live.png: 2392414 -> 823816 bytes (palette-256)
- 1920x1080/draft_026_rift_draft_04_draft.png: 2260640 -> 734519 bytes (palette-256)
- 1920x1080/hud_bridge_005_bridge_flow_05_draft.png: 2238553 -> 639254 bytes (palette-256)
- 1920x1080/menus_013_play_rift_q2_ranked.png: 2397377 -> 761127 bytes (palette-256)
- 1920x1080/post_fray_027_after_postgame_leave.png: 2340432 -> 696898 bytes (palette-256)
- 1920x1080/hud_032_hud_tip_ability_ult.png: 2450519 -> 958004 bytes (palette-256)
- 1920x1080/draft_030_rift_draft_06_draft.png: 2054294 -> 717983 bytes (palette-256)
- 1920x1080/menus_017_play_bridge.png: 2314229 -> 739055 bytes (palette-256)
- 1920x1080/cold1920_005_play_first_visit.png: 2411358 -> 754004 bytes (palette-256)
- 1920x1080/draft_056_rift_ranked_01_queue.png: 2381792 -> 751470 bytes (palette-256)
- 1920x1080/post_rift_007_rift_flow_07_draft.png: 2143922 -> 673597 bytes (palette-256)
- 1920x1080/post_rift_019_postgame_tab_summary.png: 1850088 -> 687801 bytes (palette-256)
- 1920x1080/hud_fray_009_fray_flow_09_draft.png: 2208531 -> 705201 bytes (palette-256)
- 1920x1080/post_fray_023_postgame_tab_hour-board_scrolled.png: 1761086 -> 662318 bytes (palette-256)
- 1920x1080/draft_080_rift_ranked_13_draft.png: 2109895 -> 675551 bytes (palette-256)
- 1920x1080/hud_dead_010_rift_flow_10_draft.png: 2016999 -> 652609 bytes (palette-256)
- 1920x1080/draft_150_fray_standard_first_match_frame.png: 2060941 -> 966900 bytes (palette-256)
- 1920x1080/cold1920_030_first_match_after_Q.png: 2617517 -> 1093233 bytes (palette-256)
- 1920x1080/practice_003_practice_setup_scrolled.png: 2325949 -> 692648 bytes (palette-256)
- 1920x1080/cold1920_003_home_first_paint.png: 2337670 -> 694833 bytes (palette-256)
- 1920x1080/draft_087_rift_ranked_17_loading.png: 2497383 -> 1015330 bytes (palette-256)
- 1920x1080/hud_052_hud_tip_item.png: 2515721 -> 958395 bytes (palette-256)
- 1920x1080/draft_040_rift_draft_11_draft.png: 2124056 -> 684043 bytes (palette-256)
- 1920x1080/cold1920_007_cold_flow_01_queue.png: 2401239 -> 749107 bytes (palette-256)
- 1920x1080/menus_085_nav_hover_shop.png: 2285886 -> 749021 bytes (palette-256)
- 1920x1080/draft_042_rift_draft_12_draft.png: 2117272 -> 680521 bytes (palette-256)
- 1920x1080/post_fray_007_fray_flow_07_draft.png: 2201369 -> 694030 bytes (palette-256)
- 1920x1080/draft_046_rift_draft_14_draft.png: 2023096 -> 647779 bytes (palette-256)
- 1920x1080/post_rift_021_postgame_tab_scoreboard.png: 1887204 -> 667893 bytes (palette-256)
- 1920x1080/hud_038_hud_scoreboard.png: 1985759 -> 761473 bytes (palette-256)
- 1920x1080/menus_063_settings_tab_video_scrolled.png: 2354793 -> 774303 bytes (palette-256)
- 1920x1080/hud_044_hud_ping_tap.png: 2585353 -> 1001132 bytes (palette-256)
- 1920x1080/draft_088_rift_ranked_first_match_frame.png: 2324729 -> 954404 bytes (palette-256)
- 1920x1080/draft_162_custom_05_draft.png: 2103441 -> 643798 bytes (palette-256)
- 1920x1080/hud_008_hud_idle_live.png: 2408443 -> 991716 bytes (palette-256)
- 1920x1080/menus_073_settings_tab_accessibility_scrolled.png: 2362184 -> 779537 bytes (palette-256)
- 1920x1080/draft_014_rift_quick_07_match.png: 2355831 -> 1015440 bytes (palette-256)
- 1920x1080/cold1920_012_cold_flow_06_draft.png: 2065594 -> 707730 bytes (palette-256)
- 1920x1080/practice_009_practice_05_draft.png: 2103920 -> 678612 bytes (palette-256)
- 1920x1080/hud_026_hud_tip_ability_a1.png: 2545231 -> 1005339 bytes (palette-256)
- 1920x1080/cold1920_022_first_match_frame_0.png: 2590496 -> 1025385 bytes (palette-256)
- 1920x1080/post_fray_013_end_banner_early.png: 1773377 -> 931592 bytes (palette-256)
- 1920x1080/draft_051_rift_draft_17_loading.png: 2443103 -> 1147384 bytes (palette-256)
- 1920x1080/hud_bridge_006_bridge_flow_06_draft.png: 2238411 -> 633840 bytes (palette-256)
- 1920x1080/draft_036_rift_draft_09_draft.png: 2118301 -> 678328 bytes (palette-256)
- 1920x1080/draft_076_rift_ranked_11_draft.png: 2123999 -> 682952 bytes (palette-256)
- 1920x1080/draft_170_custom_09_draft.png: 2154724 -> 656181 bytes (palette-256)
- 1920x1080/draft_172_custom_10_draft.png: 2159939 -> 663672 bytes (palette-256)
- 1920x1080/post_rift_010_rift_flow_10_draft.png: 2014756 -> 653723 bytes (palette-256)
- 1920x1080/draft_106_rift_lantern-drill_08_loading.png: 2333984 -> 700425 bytes (palette-256)
- 1920x1080/draft_134_fray_standard_01_queue.png: 2379607 -> 767058 bytes (palette-256)
- 1920x1080/cold1920_028_first_match_after_move_click.png: 2622419 -> 1093693 bytes (palette-256)
- 1920x1080/hud_bridge_008_bridge_flow_08_draft.png: 2232132 -> 624239 bytes (palette-256)
- 1920x1080/menus_003_play.png: 2412560 -> 754506 bytes (palette-256)
- 1920x1080/hud_fray_019_fray_ping_wheel.png: 2044321 -> 939423 bytes (palette-256)
- 1920x1080/draft_016_rift_quick_first_match_frame.png: 2333552 -> 955811 bytes (palette-256)
- 1920x1080/cold1920_026_first_match_hint_3.png: 2587139 -> 1028246 bytes (palette-256)
- 1920x1080/menus_069_settings_tab_controls_scrolled.png: 2340354 -> 768421 bytes (palette-256)
- 1920x1080/draft_078_rift_ranked_12_draft.png: 2116120 -> 680074 bytes (palette-256)
- 1920x1080/practice_001_practice_setup.png: 2350329 -> 768511 bytes (palette-256)
- 1920x1080/hud_dead_007_rift_flow_07_draft.png: 2124019 -> 667432 bytes (palette-256)
- 1920x1080/menus_015_play_rift_q3_lantern-drill.png: 2391917 -> 749632 bytes (palette-256)
- 1920x1080/menus_043_loadout_tab_hourturn.png: 2276412 -> 693755 bytes (palette-256)
- 1920x1080/cold1920_025_first_match_hint_2.png: 2588946 -> 1023254 bytes (palette-256)
- 1920x1080/draft_066_rift_ranked_06_draft.png: 2054988 -> 720625 bytes (palette-256)
- 1920x1080/practice_025_practice_damage_meter.png: 2233829 -> 949266 bytes (palette-256)
- 1920x1080/cold1920_002_boot_02.png: 2302941 -> 762456 bytes (palette-256)
- 1920x1080/hud_dead_006_rift_flow_06_draft.png: 2087189 -> 716139 bytes (palette-256)
- 1920x1080/hud_bridge_007_bridge_flow_07_draft.png: 2243788 -> 635087 bytes (palette-256)
- 1920x1080/hud_034_hud_tip_hp.png: 2508813 -> 974582 bytes (palette-256)
- 1920x1080/post_rift_011_rift_flow_11_draft.png: 2017529 -> 655029 bytes (palette-256)
- 1920x1080/hud_fray_017_fray_scoreboard.png: 1715396 -> 774351 bytes (palette-256)
- 1920x1080/hud_020_hud_shop_tag_1.png: 1965251 -> 754255 bytes (palette-256)
- 1920x1080/draft_009_rift_quick_04_draft.png: 2015624 -> 651201 bytes (palette-256)
- 1920x1080/draft_130_bridge_standard_first_match_frame.png: 2205612 -> 953383 bytes (palette-256)
- 1920x1080/menus_001_home.png: 2337807 -> 694857 bytes (palette-256)
- 1920x1080/cold1920_013_cold_flow_07_draft.png: 2153066 -> 675366 bytes (palette-256)
- 1920x1080/draft_064_rift_ranked_05_draft.png: 2056419 -> 666790 bytes (palette-256)
- 1920x1080/hud_fray_021_fray_shop.png: 1622127 -> 671894 bytes (palette-256)
- 1920x1080/post_rift_017_postgame_summary.png: 1850192 -> 688749 bytes (palette-256)
- 1920x1080/post_fray_025_postgame_tab_gleam-lead.png: 1745985 -> 671429 bytes (palette-256)
- 1920x1080/draft_090_rift_lantern-drill_play.png: 2352569 -> 732373 bytes (palette-256)
- 1920x1080/hud_bridge_012_bridge_flow_12_loading.png: 2326434 -> 702289 bytes (palette-256)
- 1920x1080/post_rift_025_postgame_tab_gleam-lead.png: 1745226 -> 670853 bytes (palette-256)
- 1920x1080/post_fray_006_fray_flow_06_draft.png: 2084418 -> 632842 bytes (palette-256)
- 1920x1080/hud_028_hud_tip_ability_a2.png: 2556443 -> 1013489 bytes (palette-256)
- 1920x1080/draft_001_rift_quick_play.png: 2353258 -> 736468 bytes (palette-256)
- 1920x1080/hud_bridge_009_bridge_flow_09_draft.png: 2219467 -> 620956 bytes (palette-256)
- 1920x1080/draft_054_rift_ranked_play.png: 2354360 -> 740827 bytes (palette-256)
- 1920x1080/post_fray_005_fray_flow_05_draft.png: 2068607 -> 634680 bytes (palette-256)
- 1920x1080/draft_052_rift_draft_first_match_frame.png: 2376979 -> 966493 bytes (palette-256)
- 1920x1080/hud_050_hud_items_owned.png: 2554818 -> 982760 bytes (palette-256)
- 1920x1080/post_fray_008_fray_flow_08_draft.png: 2210697 -> 701423 bytes (palette-256)
- 1920x1080/hud_030_hud_tip_ability_a3.png: 2463968 -> 958733 bytes (palette-256)
- 1920x1080/menus_061_settings_tab_video.png: 2356731 -> 771280 bytes (palette-256)
- 1920x1080/post_fray_001_fray_flow_01_queue.png: 2365956 -> 751837 bytes (palette-256)
- 1920x1080/draft_121_bridge_standard_06_draft.png: 2217550 -> 622427 bytes (palette-256)
- 1920x1080/draft_127_bridge_standard_09_loading.png: 2323397 -> 699152 bytes (palette-256)
- 1920x1080/draft_146_fray_standard_07_draft.png: 2039769 -> 643016 bytes (palette-256)
- 1920x1080/draft_117_bridge_standard_04_draft.png: 2223751 -> 632483 bytes (palette-256)
- 1920x1080/hud_001_rift_flow_01_queue.png: 2286442 -> 747993 bytes (palette-256)
- 1920x1080/draft_082_rift_ranked_14_draft.png: 2023904 -> 647003 bytes (palette-256)
- 1920x1080/hud_005_rift_flow_05_draft.png: 2018882 -> 653055 bytes (palette-256)
- 1920x1080/draft_111_bridge_standard_01_queue.png: 2305425 -> 737989 bytes (palette-256)
- 1920x1080/menus_007_play_rift.png: 2413901 -> 755884 bytes (palette-256)
- 1920x1080/hud_fray_023_fray_fight.png: 1968055 -> 827255 bytes (palette-256)
- 1920x1080/draft_070_rift_ranked_08_draft.png: 2124425 -> 677932 bytes (palette-256)
- 1920x1080/draft_003_rift_quick_01_queue.png: 2367669 -> 740426 bytes (palette-256)
- 1920x1080/menus_053_profile_tab_overview.png: 2194866 -> 737393 bytes (palette-256)
- 1920x1080/draft_148_fray_standard_08_match.png: 2187196 -> 1073782 bytes (palette-256)
- 1920x1080/hud_fray_011_fray_flow_11_draft.png: 2070817 -> 655350 bytes (palette-256)
- 1920x1080/menus_077_settings_tab_credits.png: 2426377 -> 798560 bytes (palette-256)
- 1920x1080/practice_019_practice_levelup_moment.png: 2248970 -> 943700 bytes (palette-256)
- 1920x1080/hud_dead_008_rift_flow_08_draft.png: 2107804 -> 670315 bytes (palette-256)
- 1920x1080/hud_dead_001_rift_flow_01_queue.png: 2406329 -> 753357 bytes (palette-256)
- 1920x1080/practice_008_practice_04_draft.png: 2101527 -> 670913 bytes (palette-256)
- 1920x1080/menus_031_collection.png: 2337317 -> 696904 bytes (palette-256)
- 1920x1080/hud_dead_005_rift_flow_05_draft.png: 2111345 -> 684911 bytes (palette-256)
- 1920x1080/draft_142_fray_standard_05_draft.png: 2186455 -> 701166 bytes (palette-256)
- 1920x1080/hud_dead_009_rift_flow_09_draft.png: 2012701 -> 651903 bytes (palette-256)
- 1920x1080/menus_019_play_bridge_q0_standard.png: 2293386 -> 726718 bytes (palette-256)
- 1920x1080/post_rift_012_rift_flow_12_loading.png: 2410493 -> 759847 bytes (palette-256)
- 1920x1080/hud_bridge_011_bridge_flow_11_loading.png: 2366654 -> 796638 bytes (palette-256)
- 1920x1080/post_fray_021_postgame_tab_hour-board.png: 1812957 -> 666639 bytes (palette-256)
- 1920x1080/menus_083_settings_controls_rebind_listening.png: 2290040 -> 746909 bytes (palette-256)
- 1920x1080/menus_021_play_fray.png: 2379631 -> 764712 bytes (palette-256)
- 1920x1080/draft_100_rift_lantern-drill_05_draft.png: 2060094 -> 654771 bytes (palette-256)
- 1920x1080/hud_bridge_027_bridge_midgame_scoreboard.png: 1726462 -> 672902 bytes (palette-256)
- 1920x1080/hud_022_hud_shop_tag_2.png: 1898620 -> 741137 bytes (palette-256)
- 1920x1080/hud_014_hud_shop_search_empty.png: 1833376 -> 726664 bytes (palette-256)
- 1920x1080/hud_fray_010_fray_flow_10_draft.png: 1535111 -> 526478 bytes (palette-256)
- 1920x1080/cold1920_011_cold_flow_05_draft.png: 2089317 -> 677670 bytes (palette-256)
- 1920x1080/menus_065_settings_tab_audio.png: 2364420 -> 777395 bytes (palette-256)
- 1920x1080/draft_164_custom_06_draft.png: 2171354 -> 662446 bytes (palette-256)
- 1920x1080/draft_020_rift_draft_01_queue.png: 2379399 -> 742861 bytes (palette-256)
- 1920x1080/hud_042_hud_ping_wheel.png: 2560632 -> 983199 bytes (palette-256)
- 1920x1080/draft_048_rift_draft_15_draft.png: 2026803 -> 653828 bytes (palette-256)
- 1920x1080/cold1920_029_first_match_ability_tooltip.png: 2545036 -> 1033792 bytes (palette-256)
- 1920x1080/hud_dead_017_hud_dead_later.png: 1608186 -> 1026957 bytes (palette-256)
- 1920x1080/hud_fray_025_fray_midgame.png: 2269659 -> 761272 bytes (palette-256)
- 1920x1080/hud_004_rift_flow_04_draft.png: 2136911 -> 677902 bytes (palette-256)
- 1920x1080/draft_032_rift_draft_07_draft.png: 2053355 -> 722262 bytes (palette-256)
- 1920x1080/hud_fray_027_fray_midgame_scoreboard.png: 1893481 -> 753936 bytes (palette-256)
- 1920x1080/hud_058_hud_midgame.png: 2439638 -> 970292 bytes (palette-256)
- 1920x1080/draft_180_custom_14_match.png: 2419555 -> 1018884 bytes (palette-256)
- 1920x1080/hud_060_hud_midgame_scoreboard.png: 1989768 -> 734145 bytes (palette-256)
- 1920x1080/post_fray_009_fray_flow_09_draft.png: 2217605 -> 707626 bytes (palette-256)
- 1920x1080/menus_075_settings_tab_gameplay.png: 2364228 -> 780765 bytes (palette-256)
- 1920x1080/draft_109_bridge_standard_play.png: 2292765 -> 726194 bytes (palette-256)
- 1920x1080/hud_bridge_017_bridge_scoreboard.png: 1800003 -> 762997 bytes (palette-256)
- 1920x1080/cold1920_015_cold_flow_09_draft.png: 2111921 -> 674292 bytes (palette-256)
- 1920x1080/practice_017_practice_shop_rich.png: 1759924 -> 704120 bytes (palette-256)
- 1920x1080/draft_119_bridge_standard_05_draft.png: 2227495 -> 632833 bytes (palette-256)
- 1920x1080/menus_047_shop_scrolled.png: 2301855 -> 687997 bytes (palette-256)
- 1920x1080/cold1920_020_cold_flow_14_loading.png: 2342475 -> 702637 bytes (palette-256)
- 1920x1080/draft_028_rift_draft_05_draft.png: 2056633 -> 666793 bytes (palette-256)
- 1920x1080/draft_096_rift_lantern-drill_03_none.png: 2105159 -> 678361 bytes (palette-256)
- 1920x1080/draft_034_rift_draft_08_draft.png: 2123626 -> 678210 bytes (palette-256)
- 1920x1080/hud_012_hud_shop_search_blade.png: 1800439 -> 700323 bytes (palette-256)
- 1920x1080/draft_154_custom_01_none.png: 2012063 -> 671514 bytes (palette-256)
- 1920x1080/draft_074_rift_ranked_10_draft.png: 2117483 -> 683392 bytes (palette-256)
- 1920x1080/post_fray_017_postgame_summary.png: 1891693 -> 668378 bytes (palette-256)
- 1920x1080/hud_003_rift_flow_03_draft.png: 2079584 -> 715854 bytes (palette-256)
- 1920x1080/post_rift_009_rift_flow_09_draft.png: 2115002 -> 670330 bytes (palette-256)
- 1920x1080/hud_fray_013_fray_idle.png: 2011064 -> 974155 bytes (palette-256)
- 1920x1080/draft_128_bridge_standard_10_match.png: 2463005 -> 1058223 bytes (palette-256)
- 1920x1080/hud_fray_007_fray_flow_07_draft.png: 2154970 -> 669126 bytes (palette-256)
- 1920x1080/hud_006_hud_first_frame.png: 2397257 -> 962909 bytes (palette-256)
- 1920x1080/hud_bridge_021_bridge_shop.png: 1853341 -> 710301 bytes (palette-256)
- 1920x1080/practice_021_practice_level_pips.png: 2247333 -> 951421 bytes (palette-256)
- 1920x1080/menus_049_shop_item_selected.png: 2446086 -> 725661 bytes (palette-256)
- 1920x1080/cold1920_008_cold_flow_02_queue.png: 1659949 -> 757852 bytes (palette-256)
- 1920x1080/draft_178_custom_13_draft.png: 2084875 -> 609641 bytes (palette-256)
- 1920x1080/draft_007_rift_quick_03_none.png: 2021066 -> 654287 bytes (palette-256)
- 1920x1080/menus_023_play_fray_q0_standard.png: 2361239 -> 758443 bytes (palette-256)
- 1920x1080/hud_024_hud_shop_tag_3.png: 1883725 -> 737694 bytes (palette-256)
- 1920x1080/cold1920_023_first_match_frame_3s.png: 2591177 -> 1030800 bytes (palette-256)
- 1920x1080/draft_102_rift_lantern-drill_06_draft.png: 2017360 -> 652817 bytes (palette-256)
- 1920x1080/cold1920_017_cold_flow_11_draft.png: 2017940 -> 650322 bytes (palette-256)
- 1920x1080/cold1920_004_home_settled.png: 2338143 -> 699254 bytes (palette-256)
- 1920x1080/draft_158_custom_03_draft.png: 2241639 -> 714478 bytes (palette-256)
- 1920x1080/hud_dead_013_hud_teamfight.png: 2806038 -> 928239 bytes (palette-256)
- 1920x1080/practice_006_practice_02_draft.png: 2207028 -> 721435 bytes (palette-256)
- 1920x1080/menus_059_settings_scrolled.png: 2350698 -> 771302 bytes (palette-256)
- 1920x1080/post_rift_027_after_postgame_leave.png: 2340355 -> 697908 bytes (palette-256)
- 1920x1080/draft_068_rift_ranked_07_draft.png: 2053876 -> 721130 bytes (palette-256)
- 1920x1080/draft_166_custom_07_draft.png: 2154910 -> 651865 bytes (palette-256)
- 1920x1080/cold1920_016_cold_flow_10_draft.png: 2119519 -> 678397 bytes (palette-256)
- 1920x1080/draft_044_rift_draft_13_draft.png: 2110118 -> 677716 bytes (palette-256)
- 1920x1080/draft_062_rift_ranked_04_draft.png: 2088504 -> 686576 bytes (palette-256)
- 1920x1080/draft_086_rift_ranked_16_loading.png: 2322164 -> 701373 bytes (palette-256)
- 1920x1080/hud_016_hud_shop_item_hover.png: 2032695 -> 759594 bytes (palette-256)
- 1920x1080/draft_115_bridge_standard_03_none.png: 2220202 -> 631863 bytes (palette-256)
- 1920x1080/post_fray_019_postgame_tab_summary.png: 1889040 -> 668697 bytes (palette-256)
- 1920x1080/draft_038_rift_draft_10_draft.png: 2117045 -> 681914 bytes (palette-256)
- 1920x1080/draft_104_rift_lantern-drill_07_draft.png: 2022552 -> 655092 bytes (palette-256)
- 1920x1080/hud_bridge_023_bridge_fight.png: 2335810 -> 854512 bytes (palette-256)
- 1920x1080/post_fray_011_fray_flow_11_loading.png: 2267256 -> 776853 bytes (palette-256)
- 1920x1080/hud_bridge_010_bridge_flow_10_draft.png: 2062060 -> 615204 bytes (palette-256)
- 1920x1080/draft_125_bridge_standard_08_draft.png: 2064599 -> 615489 bytes (palette-256)
- 1920x1080/hud_dead_012_rift_flow_12_loading.png: 2321721 -> 707186 bytes (palette-256)
- 1920x1080/hud_002_rift_flow_02_draft.png: 2103110 -> 682083 bytes (palette-256)
- 1920x1080/post_rift_008_rift_flow_08_draft.png: 2127822 -> 672055 bytes (palette-256)
- 1920x1080/post_rift_001_rift_flow_01_queue.png: 2400339 -> 749237 bytes (palette-256)
- 1920x1080/menus_011_play_rift_q1_draft.png: 2392846 -> 756779 bytes (palette-256)
- 1920x1080/hud_fray_006_fray_flow_06_draft.png: 2083703 -> 630892 bytes (palette-256)
- 1920x1080/hud_bridge_019_bridge_ping_wheel.png: 2326059 -> 936944 bytes (palette-256)
- 1920x1080/cold1920_019_cold_flow_13_loading.png: 2342619 -> 702423 bytes (palette-256)
- 1920x1080/draft_176_custom_12_draft.png: 2147230 -> 659829 bytes (palette-256)
- 1920x1080/post_rift_013_end_banner_early.png: 2667196 -> 996183 bytes (palette-256)
- 1920x1080/post_rift_005_rift_flow_05_draft.png: 2101764 -> 683553 bytes (palette-256)
- 1920x1080/hud_018_hud_shop_item_selected.png: 2032217 -> 763471 bytes (palette-256)
- 1920x1080/cold1920_014_cold_flow_08_draft.png: 2134501 -> 674221 bytes (palette-256)
- 1920x1080/draft_092_rift_lantern-drill_01_queue.png: 2371262 -> 736950 bytes (palette-256)
- 1920x1080/practice_023_practice_cast_vfx.png: 2233551 -> 947201 bytes (palette-256)
- 1920x1080/menus_027_practice.png: 2347625 -> 772028 bytes (palette-256)
- 1920x1080/hud_048_hud_levelup.png: 2603002 -> 987898 bytes (palette-256)
- 1920x1080/menus_057_settings.png: 2356031 -> 769795 bytes (palette-256)
- 1920x1080/draft_156_custom_02_draft.png: 2280726 -> 733200 bytes (palette-256)
- 1920x1080/hud_bridge_013_bridge_idle.png: 2333707 -> 1060014 bytes (palette-256)
- 1920x1080/hud_036_hud_stats_ledger.png: 2489434 -> 992120 bytes (palette-256)
- 1920x1080/draft_152_custom_lobby.png: 1939125 -> 676163 bytes (palette-256)
