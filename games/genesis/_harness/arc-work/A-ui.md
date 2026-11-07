# A-ui ledger (UI engineer, stage A) — trust this file

Sim lane is in parallel (A-sim.md): it owns types.ts views, events.json, freeform-signs, the §10 8-seed probe.
UI builds ahead on `__GENESIS__.arc.stub` (§6.7) with local mirror types in src/ui/arc.ts until types.ts lands.

## Plan (priority order)
1. testsurface `arc` {hearts, towers, story, stub} + stub injection into the next snapshot (§6.7)
2. audio: eventmap cues/null for every §6.3 event, new SFX cues (crowd.jeer, crowd.hymn, toil.drums, toil.chant,
   ui.great, babel.babble, masonry.collapse, crowd.cheer); tests/audio-arc.test.ts
3. §1.4 heart glyph icons (ui/icons.ts) + HUD chip glyph + proud tower mark + defiant pulse; tests/ui-arc-hearts
4. §1.4 Hearts layer (overlays.ts LAYERS) + palette ΔE>=15 test (M5)
5. §1.4 inspector person caption + settlement Hearts section
6. §2.5 Decision card (ui/decision.ts), pill, keys 1-4, slow-down setting, tower inspector card; tests/ui-arc-decision (T10)
7. chronicle: tower.* / heart.* lines show (kind god) — check chronicle filter handles them
8. §10: river-warning shot looked at (888x500), spec in _harness/arc-work/
9. shots M4/T3 once sim lands; gate green

## Stint log
### Stint 1 (2026-11-07)
- started
- DONE item 1: src/client/arcstub.ts (arcStub/applyArcStub, patched in SimClient.receive so lookdev too);
  worldview.ts copies towers/covenant/covenantOffer/age/epithet into PlanetView (optional fields); testsurface `arc`
  {hearts,towers,story,stub} (stub requests a full snapshot). tests/ui-arc-stub.test.ts 3/3.
  NOTE: sim landed §6.2 types in src/sim/types.ts already (HeartSign, HeartKind, TowerView, Vow, SettlementView.heart...).
- DONE item 2: eventmap.ts `ARC_CUES` table (every §6.3 event: cue or null; cueFor falls back to it); sfx.ts new
  recipes crowd.jeer, crowd.hymn, toil.drums, toil.chant, ui.great, babel.babble, masonry.collapse, crowd.cheer,
  crowd.shout, stone.knock, covenant.chime, covenant.chime.broken, ui.deny (stage B/C cues too). Music untouched.
  tests/audio-arc.test.ts 4/4; audio.test + audio-authored 44/44.
- DONE item 3: src/ui/hearts.ts (pure: captions fallback, shareWords, heartGlyph, heartHover, duskWords, HEART_COLORS
  per CvdPalette incl. monochrome, heartAlpha, deltaE); icons heart, heart-devoted/fearful/restless/defiant/proud;
  hud.ts name chip glyph after the name (+ proud tower mark, 10 s fist pulse on a new SettlementView.defiant.tick);
  living.ts PrayerMarks also marks hearts from orbit (`.gn-lmark-heart`, clickable, markedHearts()); CSS in styles.css.
- DONE item 4: Hearts layer in overlays.ts OVERLAYS (id hearts) + hearts() fill (quiet unshaded, proud rim on edge
  cells) + hover words + legend with captions. tests/ui-arc-hearts.test.ts 3/3 (M5 ΔE>=15 all 5 palettes).
  NOT YET LOOKED AT in a shot (do with item 9 / stub shot).
- DONE item 5 (code; not yet looked at): inspector person line (personHeartLine from agent detail `heart`), settlement
  "Hearts" section (settlementHearts: caption+share words, mood line, 4 share bars, Pride gn-pride (+prideWhy words on
  hover if detail carries `prideWhy`), Defiance gn-defy, dusk "x of y at the shrine (a year ago, z)", theyCall,
  remember, answered). Reads heart from deps.live(ref) (mirror, carries stub) then detail view.
- DONE item 6a (code+unit; NOT yet looked at): src/ui/decision.ts — towerChoice (pure words/buttons), DecisionState
  (pure: open/pill/forced, slow-down 10x above 30x and restore), DecisionCard DOM (Esc/keys 1-4 on focus, Look at it,
  Decide later -> pill, layout: top-centre under --gn-time-b; class gn-decision-left under the time panel when the
  inspector would be covered). Mounted in shell.ts (`ui.decision`, updated each frame from primary planet towers).
  Pref game.slowGreat (default true; settings toggle "Slow down for great moments"). Test surface arc.decision() /
  arc.choose(key) / arc.later(). tests/ui-arc-decision.test.ts 5/5.
  Placement note: the pill sits where the card was (top-centre), not "left of the time controls" — the time panel is
  at the far left at 888x500, so nothing fits left of it. (UI placement only; no §6 contract change.)
  TODO 6b: tower inspector card (picking a tower -> needs a pick path for TowerView; render lane draws it) with the same
  buttons via decision.openFor(id); "tower.begun" toast "Look at it" (toasts/eventmap via chronicle?).
- DONE: toasts.ts tower.* toasts (begun/confused/struck/finished/heeded/refused/abandoned/rebuilt/warned; claim the
  sim's chronicle line, plain fallbacks; click = look at it) and heart toasts (to defiant / devoted only).
- §10 UI: lookdevgod.ts flood warning now sets params.rise/silt (cleared at the warning's end) so a lookdev shot can
  show the warned river; spec _harness/arc-work/specs/river-warning.json (before vs warning, 888x500). NOT RUN YET.
- Shots: _harness/arc-work/specs/ui-hearts.json launched 01:03Z via slot (PID 7012, log
  _harness/scratch/arc/shots-hearts.log, PNGs in _shots/arc-hearts-*.png); very slow under load (npm check running).
- Focused tests 01:15Z: ui-living, ui-logic, ui-flood-*, ui-fixr3, ui-defaults, ui-arc-*, audio-arc: 47/47 pass.
- 01:27Z shot run 7012: arc-hearts-chips FAILED (page.screenshot timeout 600 s: software GL starved while the sim
  lane's full `npm run check` (slot 2, PID 6382) ran). Remaining shots of the spec were still going. tsc clean.
- No §6 contract changed this stint (contract-changes.md not needed).

## NEXT (stint 2 starts here)
1. kill -0 7012; if done, LOOK at _shots/arc-hearts-{layer,orbit,inspector}.png (888x500): chip glyph legible?
   layer colours/legend? inspector Hearts section fits? If the chips shot failed again, rerun only it when the machine
   is quieter: node _harness/shots.mjs _harness/arc-work/specs/ui-hearts.json --only=arc-hearts-chips --port=5311 via slot.sh.
   Consider wait 120 instead of 240 in the spec if the step is the slow part.
2. Run _harness/arc-work/specs/river-warning.json (§10.3c) through slot.sh; LOOK: river higher+browner than before.
3. Decision card shot: stub a tower (G.arc.stub('towers', [{ id:1, pos, cell, name, host, league, height:20, goal:80,
   tiers:2, material:'mudbrick', style:0, status:'rising', builders:9, begun:0, ended:-1, answer:'none', choiceOpen:true,
   canAnswer:['confuse','strike','warn','let'] }])) at 888x500 with UI, with and without the inspector open; then
   G.arc.later() -> pill shot. Check it never covers time controls / inspector.
4. 6b: tower inspector card (InspectRef kind for a tower; data from pv.towers + query('towers') once the sim has it)
   with buttons -> decision.openFor(id). Needs a pick path: render lane draws the tower (render/life/tower.ts).
5. freeform help text (ui/help.ts / freeform examples) for the §6.5 phrases; 'open-book' UI intent hook (stage C).
6. Full gate: `_harness/slot.sh --status` first; when no check runs on this tree: setsid nohup _harness/slot.sh npm run
   check > _harness/scratch/arc/check-ui.log 2>&1 & ; fix anything of mine; then npm run build.
7. Once the sim sends SettlementView.heart / TowerView for real: M4 shot (fearful village ~120 m, >=5 lookUp/fist poses,
   chip legible at orbit + region) and T3/T10 shots in the babel scenario.
- 01:29Z started the full gate: slot.sh npm run check (wrapper PID 12229), log _harness/scratch/arc/check-ui.log.
  Next stint: read the log tail; "# fail 0" and exit 0 = gate green for this stint's code.

### Stint 2 (2026-11-07, from 04:00Z)
- Stint-1 gate (wrapper 12229) finished: check-ui.log 778/778 pass, fail 0 -> GREEN.
- LOOKED at _shots/arc-hearts-layer.png: legend (5 swatches + "Unshaded..." note) legible, fits under the time panel;
  chip "Band of Isobar" shows heart glyph + proud tower mark. No fill visible: that town was a wandering band (no
  territory) -> correct, needs a settled town (done on lookdev in ui-decision.json). arc-hearts-orbit.png: orbit mark
  (heart+tower) legible over the land. chips + inspector shots FAILED (screenshot timeout under load 14).
- New spec _harness/arc-work/specs/ui-decision.json (lookdev, homestead town + neighbour stubbed; card, card+inspector,
  hearts inspector section, pill + Hearts layer). Launched 04:01Z via slot (PID 28296, port 5311, log
  _harness/scratch/arc/shots-decision.log, PNGs _shots/arc-decision-*.png, arc-hearts-insp.png).
- DONE 6b (code + unit): tower inspector card. host.ts InspectRef gains { kind:'tower' }; decision.ts towerCard (pure)
  + DecisionCard.chooseFor(towerId,key); inspector.ts tower card (rows, towns of one speech with pride words as links,
  the answer buttons while canAnswer, Look at it); shell.ts deps tower/answerTower/lookAtPos; app.ts pickTower
  (projected axis, wins over builders in front) in onClick, entityBodyPos 'tower' (marker + Look key, 260 m).
  tests/ui-arc-towercard.test.ts 2/2 (+ decision 5/5). tsc clean. NOT YET LOOKED AT in a shot.
- 04:16Z decision shot 1 FAILED again (page.screenshot 600 s timeout: the screenshot waits for a fresh software-GL
  frame). FIX: test surface G.hold(on) (app.ts `held`: the rAF loop draws nothing new while held unless a frames()/
  capture waiter is pending; the last frame stays on the canvas). ui-decision.json scripts start G.hold(false) and end
  G.hold(true). Use the same pattern in every UI (non-canvasOnly) shot spec. Relaunched 04:17Z (slot ticket #25,
  log _harness/scratch/arc/shots-decision.log).
- DONE help text: controlstext.ts livingRows gains 'hearts' and 'a great tower' rows (help window + CONTROLS.md,
  regenerated with node _harness/gen-controls.ts; ui-meta 4/4).
- Item 7 chronicle: no change needed (kind chips are generic; tower.*/heart.* lines are kind god and show).
- NOTE 04:10Z: ui-living / ui-fixr3 / ui-logic real-sim tests fail with "content has 30 problems" (events.json tower.*
  ask for {host}/{league}/{reading} the chronicle cannot fill; buildings great-tower work 1e9 out of range) = the sim
  lane's in-progress tower content, not UI code. Re-run them once A-sim lands tower.ts.
- freeform EXAMPLES: not yet extended (sim freeform-signs has no arc phrases yet; add "how do the people of {town}
  feel?" once it answers).
- 04:39Z LOOKED at _shots/arc-decision-card.png (lookdev, 888x500): card at [254,168,380,170] under the time panel,
  not over time controls/planet bar. DEFECTS: title row clipped by the flex column (overflow:hidden header shrank to 0)
  and every answer's words cut by an ellipsis ("they will scatter, and spe..."). FIX (decision.ts draw + styles.css):
  children flex-shrink 0; title shares its row with Look at it / Decide later; meta on its own 10.5 px line; the four
  answers 2x2, label line + words in full on up to two lines (line-clamp, full text in title); budget 15+18+14+28+83+12
  = 170 px. Inspector tower buttons use one column. NOT YET RE-SHOT.
- LOOKED at the render lane's §10.3c pair _shots/arc-river-before.png / arc-river-warning.png (+ their crop
  _harness/scratch/arc/render/river-crop.png): during the warning the river is clearly browner/grey with silt; "higher"
  is barely visible (sand margins near identical at this distance). Render lane owns the verdict/fix (A-render.md).
- 04:49Z LOOKED at _shots/arc-decision-insp.png: the card stayed centred OVER the inspector (layout() ran only on a
  redraw). FIX: DecisionCard.update calls layout() every frame while open (toggles gn-decision-left only on change).
  Also: lookdev inspector has no story ("fabricated for the look") -> the Hearts inspector section needs source=worker.
- 04:50Z relaunched ui-decision.json (card, card+inspector, pill+Hearts layer) PID 10203 slot 2, port 5311, log
  _harness/scratch/arc/shots-decision.log.
- New spec _harness/arc-work/specs/ui-towercard.json (worker sandbox town; Hearts inspector section, tower inspector
  card via select {kind:'tower'}, tower pick by click). Queued 04:50Z ticket #28 (PID 10498) on port 5313 (5311 busy),
  log _harness/scratch/arc/shots-towercard.log; PNGs _shots/arc-hearts-insp.png, arc-tower-card.png, arc-tower-pick.png.
- 05:03Z decision rerun: arc-decision-card FAILED again at page.screenshot (600 s) even with G.hold(true) -> the
  capture stall is the loaded machine (load ~16: render-perf shots + someone's npm run check 1280), not our frames.
  The run continues (insp, pill). tsc clean; ui-arc-* + audio-arc + ui-meta pass (stint end 05:05Z).

## NEXT (stint 3 starts here)
1. kill -0 10203 (ui-decision run) / 10498 (ui-towercard, ticket #28, port 5313). LOOK at whatever PNGs landed:
   _shots/arc-decision-card.png (if it failed again, its fix is also visible in arc-decision-insp.png), arc-decision-
   insp.png (card must now sit LEFT under the time panel, clear of the inspector; title row + 2x2 answers with full
   words), arc-decision-pill.png (pill top-centre; Hearts layer fill on the homestead town (fearful violet + proud
   rim) and its neighbour (defiant crimson)), arc-hearts-insp.png (Hearts section fits), arc-tower-card.png,
   arc-tower-pick.png (click on the tower axis selects {kind:'tower'}). Rerun failed shots with
   --only=<name> when load is lower (uptime < 8). Fix what looks wrong.
2. Gate: slot.sh --status; when no `npm run check` runs on this tree: setsid nohup _harness/slot.sh npm run check >
   _harness/scratch/arc/check-ui.log 2>&1 &. Known non-UI failures until A-sim finishes tower content: ui-living,
   ui-fixr3, ui-logic real-sim tests ("content has 30 problems": events.json tower.* placeholders, great-tower work).
3. When A-sim lands tower.ts/freeform: add freeform example "how do the people of {town} feel?"; T3/T10 shots in the
   babel scenario (real TowerView); M4 live shot (fearful village, poses, chip legible at orbit + region).
4. §10: render lane owns "higher" (barely visible in arc-river-warning.png); UI side done (toast headline, warned river
   in lookdev). Sim lane owns the 25-year natural-flood run.

### Stint 3 (2026-11-07, from 07:02Z)
- Stint-2 runs: 10203 (decision) 0/3 (all page.screenshot timeouts); 10498 (towercard) produced arc-hearts-insp.png
  (3536 s, 748 s/frame!) then was gone. LOOKED at arc-hearts-insp.png: Hearts section reads well (caption, line, bars,
  Pride/Defiance, dusk line below the fold = inspector scrolls); DEFECT share words cut ("about …", "hardly…") in the
  2-col grid. FIX styles.css `.gn-insp-hearts .gn-insp-grid` (58 px label, 10.5 px value, no max-width). NOT re-shot.
- Root cause of the capture timeouts: hold(true) still renders every frame a frames() waiter asks for (and the harness
  waits spec.frames after the script) -> each is a minutes-long software-GL frame and the capture queues behind it.
  NEW test-surface mode G.hold('ui') (app.ts `held: boolean | 'ui'`): the frame loop runs (UI, camera, waiters) but
  renderer.render is skipped unless a capture/thumb waiter is pending; the canvas keeps its last picture. Use it in
  every UI-layout shot. ui-decision.json card/insp now use hold('ui'); pill renders 4 real frames (Hearts layer).
- Freeform: EXAMPLES + 'how do the people of {town} feel?'; while a tower is rising with choiceOpen the box offers
  'confuse their tongues', 'warn the builders', 'let the tower stand' first. tests/ui-arc-freeform.test.ts 2/2
  (sim answers the hearts question in words; chips match T_CONFUSE/T_WARN/T_LET). ui-freeform-examples 2/2.
- 07:04Z ui-decision.json relaunched (slot PID 24290, port 5311, log scratch/arc/shots-decision3.log).
- NEW spec _harness/arc-work/specs/ui-babel.json (T10 live: babel seed 1, step until choiceOpen, card / pill / tower
  inspector, all hold('ui')). Chained via _harness/arc-work/run-ui-babel.sh <pid> (waits for 24290, then slot.sh on
  5311): waiter PID 25055, log scratch/arc/shots-babel.log.
- 07:15Z ui-decision 3/3 in minutes (card 152 s incl. boot, insp 2 s) -> hold('ui') WORKS. LOOKED:
  arc-decision-card: card under the time panel, title row + meta + why fine; DEFECT answers clipped top and bottom
  (gn-btn centres content + 6 px gap in a 40 px box) and "Send a prophet to war..." cut. FIX: .gn-decision-opt
  justify flex-start, gap 1, 48 px, letter-spacing 0; label 10.5 px/14 px; card max-height 186 (decision.ts comment).
  arc-decision-insp: card moved LEFT under the time panel, clear of the inspector -> OK. arc-decision-pill: pill at
  top-centre reads like a world label -> pill now has the proud-tower icon + "DECIDE" tag (decision.ts, styles.css).
  Hearts legend OK. NO Hearts fill visible on lookdev (lookdev towns have no territory) -> verify on worker.
- NEW spec ui-babel2.json (live babel: hearts inspector with fixed grid, card2 with the answer fixes + scroll metrics,
  Hearts layer fill over the 4-town cluster with 4 stubbed hearts). Chained after ui-babel via run-ui-babel2.sh
  (waiter PID 26770, log scratch/arc/shots-babel2.log).
- 07:16Z ui-babel 3/3 (LIVE sim, real TowerView): babel seed 1 tower begun day 0.5, first choiceOpen after 14.5 days
  (~1.2 y <= 2 y, T3 timing) -> Decision card opened by itself on the real tower (old CSS: answers clipped, fixed
  since); pill "The tower at Ashuk by the Lake" at top-centre; tower inspector card (select {kind:'tower'}) LOOKED:
  rows Status/Height "21 m of about 80"/Tiers/Built of/Years/Builders/Your answer, towns of one speech with pride words.
  §10 LIVE BONUS: the river's flood warning toast appeared in this run ("Rain hangs over the hills above Ashuk by the
  Lake and the river climbs its banks; they take their stores and go up to high ground. The people of Ashuk by the Lake
  go out ahead of the flood...") as the headline -> §10 UI verified live at 888x500.
  DEFECT: the centred card overlapped that toast column (bottom-left). FIX decision.ts layout(): when the news column
  meets the card, the card steps right of it (left = toasts.right+10, below .gn-faith) if it fits, else (inspector on
  the right) the column yields its top (max-height, .gn-toasts-yield clips the oldest). Cleared when the card closes.
  NOT YET SHOT (needs a run with a toast up: ui-babel3.json).
- 07:27Z ui-babel2 3/3 LOOKED: arc-babel-hearts-insp: share words in full ("about half", "hardly any") -> FIXED OK.
  arc-babel-card2: answers in full on two lines, card 380x186 (scrollHeight 184) -> OK; prophet label 1 px short
  ("warn th...") -> opt padding 3px 4px 3px 5px. arc-babel-layer (live territory, stubbed hearts): violet fill with the
  white proud rim on Shenyaar, orbit marks heart+tower and a crimson fist mark on the defiant town; pill now shows the
  tower icon + DECIDE -> M5 visual OK at orbit (closer view not shot; the camera was at whole-planet distance).
- Sim lane's gate check3.log (07:02Z): 802/803, the 1 fail = tests/ui-thumblate.test.ts:38 (timer race under load:
  copy at 80 ms vs 20 ms late window). De-flaked (copy at 400 ms, wait 450). 3/3 runs pass alone.
- 07:30Z full gate queued: slot.sh npm run check (PID 28145) -> scratch/arc/check-ui3.log (~32 min once it has a slot).
- ui-babel3.json (card placement with the news column up; card alone + with tower inspector) running in slot 2
  (PID 27580) -> scratch/arc/shots-babel3.log, PNGs _shots/arc-babel3-{card,insp}.png.
- 07:40Z ui-babel3 2/2 LOOKED: arc-babel3-card: with the flood warning + a nature toast up, the card stepped right
  (394,182 380x186: right of the news, below the worship panel), nothing covered -> OK (card mid fade-in in the shot:
  hold('ui') frames are instant, the 0.28 s gnInspIn was not finished; not a defect). arc-babel3-insp: card LEFT under
  the time panel, inspector right, news column yielded to 72 px -> but a half-cut toast showed under the card edge.
  FIX: yieldToasts hides (visibility) any toast whose top is above the column's clipped top; restored on close.
  Rerun queued: slot.sh ui-babel3.json -> scratch/arc/shots-babel3b.log (waits behind the gate).
- 07:58Z ui-babel3 rerun LOOKED arc-babel3-insp.png: card left, inspector right, the half-cut toast is hidden whole
  (only "+4 more" shows below the card), "Send a prophet to warn them" in full -> OK.
- ARC.md §2.5 placement text updated (186 px; pill top-centre; news-column rule) + contract-changes.md entry.
- GATE (stint 3 code): slot.sh npm run check -> scratch/arc/check-ui3.log: 805/805 pass, fail 0 -> GREEN.
  npm run build exit 0.

## NEXT (stint 4 starts here)
UI side of §1, §2 and §10 is built and looked at. Left:
1. M4 live (with render lane): a fearful village (real sim heart, not stub) at ~120 m with >= 5 lookUp/fist poses;
   the HUD chip glyph at orbit + region is already seen (arc-hearts-orbit, arc-hearts-layer, arc-babel-layer).
   Render lane owns the pose shot (render-hearts.json); UI only confirms the chip on the same frame.
2. Optional: a closer Hearts-layer shot on live territory (arc-babel-layer was at whole-planet distance; the violet
   fill + white proud rim showed on one town). Spec ui-babel2.json shot 3: lower dist (e.g. 4000) and frames 3.
3. Stage B/C UI (defiance answer, covenant confirm, Book reader) is not in this brief's items (§1, §2, §10).
4. Whenever UI code changes: focused tests node --test tests/ui-arc-*.test.ts tests/audio-arc.test.ts, then one gate.
Shot recipe that works on this loaded machine: UI-layout shots run under G.hold('ui') (minutes, not timeouts).

### Stint 4 (2026-11-07, from 08:40Z)
- Sim lane has real hearts now (arc.ts heartsDaily/heartSigns; M3 harsh fearful 8/8 within 1 y).
- NEW spec specs/ui-m4.json (M4 LIVE, no stub: sandbox seed 1, M3 harsh recipe in the browser until query('hearts')
  says fearful, one more lightning, village at 120 m with UI + region 2500 m; returns per-agent HeartSign counts).
  Launched 08:41Z slot 2 (PID 29021, port 5311), log _harness/scratch/arc/shots-m4.log, PNGs _shots/arc-m4-*.png.
- 08:56Z ui-m4 2/2 (LIVE): harsh recipe -> fearful after 7 days (fearful share 1.0, caption "They watch the sky");
  per-agent signs fear 35 / none 15 of 50 -> sim sends MoverBlock.heart for real. LOOKED arc-m4-region.png (2500 m):
  HUD chip "Shenyaar by the Sea" + violet fearful-eye glyph legible, live (no stub) -> chip at region: OK.
  arc-m4-village.png (120 m on the settlement pos): village top-left under the time panel, hazy, no people readable
  (fear-signed folk sheltering indoors after the storm) -> M4 frame NOT made yet.
- 08:57Z ui-m4b.json (calm day + one lightning, camera on the densest outdoor fear/fist knot at 120 m and 45 m, then
  Hearts layer on the live heart at 1500 m): slot 2 PID 30212, port 5311, log scratch/arc/shots-m4b.log.
- 09:2xZ ui-m4b 3/3 (LIVE, no stub) LOOKED:
  arc-m4b-120.png: camera on the outdoor fear knot at 120 m; 33 people on screen, 17 with HeartSign fear (all signs:
  27 fear, 9 pray, 12 none); people a few px tall at 120 m, the HUD chip ("...by the Sea" + violet eye) sits half under
  the time panel at this framing (world label, not a defect). M4 data path: >= 5 fear-signed on screen -> MET (count).
  arc-m4b-45.png (+ crop scratch/arc/m4b-crop.png): 16 on screen, 8 fear-signed, figures readable, some arms raised;
  pose legibility verdict belongs to the render lane (arc-pose-fear/fist on stubs were theirs).
  arc-m4b-layer.png (1500 m, Hearts layer on the REAL heart): violet "They watch the sky" fill over Shenyaar's
  territory, chip with the fearful-eye glyph, legend 5 swatches + note in the layer panel -> M5/§1.4 live: OK.
- No UI code changed in stint 4 (shots only); last gate including all UI code: A-sim check4.log 807/807 (08:38Z).
  Focused ui-arc-* + audio-arc 19/19 at 08:45Z.

## NEXT (stint 5, if any)
UI side of §1, §2, §10 is built, ported to live src, looked at live, gate green. Nothing open in the UI lane except:
- If the render lane wants a bigger-pose M4 frame: spec specs/ui-m4b.json (live recipe) can be reused at dist 30-60.
- Rerun focused tests / one gate only if UI code changes (e.g. after sim/render contract changes).
