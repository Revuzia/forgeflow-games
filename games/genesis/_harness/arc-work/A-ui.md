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
