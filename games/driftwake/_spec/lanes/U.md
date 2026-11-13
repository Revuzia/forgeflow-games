# Lane U — player-facing UI checkpoint

Started 2026-09-30 by the first Lane U agent (port 8925). No U files existed.

## Owned files
src/ui/questTracker.js, journal.js, worldMap.js, dialogue.js, toasts.js,
introCard.js, ending.js, compass.js (new), src/core/input.js,
src/ui/hud.js (Wake Glass counter only), src/ui/minimap.js (blips only).
NEW (flagged in report): src/ui/interact.js (E router + shrine prompt).
Probe: _harness/qa_ui_node.mjs (node). Browser probe: _harness/qa_ui.py (TODO).

## Design decisions (binding for resume)
- input.js: edges interactPressed/journalPressed/mapPressed (cleared by
  endFrame); panel stack openPanel(name,onKey,{cursor})/closePanel/panelOpen/
  requestLock; capture-phase keydown delivers ALL keys to the top panel and
  stops them (so the shell's bubble Esc never sees a panel's Esc).
  input.panel = top panel name (main.js pause guard must read it).
- journal/map do NOT freeze time (QUEST §7: only boon pick + shrine menu are
  modals); they release the pointer (cursor panels) and close themselves when
  'ui:open' {panel:'boon'|'shrine'} arrives. J<->M switch panels.
- E order (interact.js): cache -> shrine menu -> dialogue skip (typing line
  first press, advance second). caches.readsInput set false by the router.
- questTracker owns the EFFECTIVE waypoint (`target`): map pin
  ('waypoint:pin', documented in events.js lane U block) over quest wp;
  re-asserts beacon.set(pin) per frame on mismatch; clears at 15 m.
- intro: save section 'quest.introSeen'; arms on reason 'new'; opens only when
  FFG.shell.phase==='playing' (harness-neutral); freezes time; own rAF clock.
- ending: freezes time, own rAF wall clock, ending.drive() hook AFTER
  rig.update (camera override); restores S keys exactly; 'ending:done'.
- hud.js: Wake Glass pill inside #hud (attach({shop,bus})). Integrator builds
  ONE of hud pill / lane R GlassCounter (recommend hud pill).
- minimap.js: attachQuest(ctx); pips refreshed on events + readyRealm change;
  _drawQuest(g) reads rider pos from Float64Array _qv (no double crosses).

## Done + proven
- node: `node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_ui_node.mjs`
  -> "=== 36 / 36 lane-U node checks PASS ===" (run 2, +C6 trials/bounties
  in journal+map; earlier "35 / 35") (real Q/W/R systems, real
  heightfield mirror). INFO: hud.update whole 95.8 B/call (PRE-EXISTING
  template strings for HP/mana text, not lane U); minimap.update whole 15.8
  B/call (pre-existing, performance.now path). Lane-U paths at floor.

## Browser probe
- written: _harness/qa_ui.py + _harness/qa_ui_page.js (port 8925, ?menu=1,
  real PLAY click, real keys/mouse, 14 checks U1-U14, shots _shots/ui_*.png).
  Page wiring = hud.update wrap (frame hook before endFrame), post.update wrap
  (ending.drive after rig.update), shell.pause wrap (= main.js guard).
- RUN 1 (ui_browser1.log): boot 453 s, 0.56 fps at menu, 0.16 fps at end;
  "=== 12 / 14 lane-U browser checks PASS ===   page errors: 0".
  FAIL U1 + U13 = PROBE timing: intro (9.4 s) and ending (~70 s) run on the
  WALL clock and finished inside the probe's round trips (state read after
  close). Behaviour itself OK (ending: drives 8, restored true, ending:done
  1). FIX: probe-controlled clocks (intro.now / ending.now) in qa_ui.py.
  Visual fixes after run 1: map relief 4-tap low-pass + hypsometric shading
  (diag _harness/ui_diag_map.mjs), waypoint drawn as a pin on a stem,
  tracker count moved beside the progress bar, dialogue 'E skip' badge to
  the header row, journal scrollbars frost-styled, cache line reworded.
  Node after these: 36/36 (ui_node_run3.log).
- RUN 2 (ui_browser2.log) INVALID: the persistent profile kept run 1's save,
  the menu showed CONTINUE / NEW RUN, no PLAY -> stopped by me (no leftover
  processes). FIX: init script removes 'driftwake_save' before page scripts;
  fail fast (U0) when PLAY is missing.
- RUN 3 (ui_browser3.log): boot 162 s, 4.36 fps at menu ->
  "=== 14 / 14 lane-U browser checks PASS ===   page errors: 0" EXIT=0.
  Visual review of its shots: flyover/credits showed the HUD because the
  probe PINS input.locked (no real lock under Playwright) -> FIX: ending adds
  body.dw-cinematic which hides every HUD element (CSS, lock-independent);
  skip label moved bottom-left (game_controls bar is bottom-right).
  Node after: 36/36 (ui_node_run4.log, E1 asserts the cinematic class).
- RUN 4 (ui_browser4.log, FINAL code): boot 15 s, 9.35 fps menu / 6.29 end
  -> "=== 14 / 14 lane-U browser checks PASS ===   page errors: 0" EXIT=0;
  U13 hudHiddenDuring true, hudHiddenAfter false. Shots _shots/ui_01..21.
- STATUS: DONE pending integration (main.js hooks above). Nothing in flight.

## Integrator hooks (main.js) — also in the final report
1. imports QuestTracker, Compass, Dialogue, Toasts, Interact, Journal,
   WorldMap, IntroCard, Ending (src/ui/*.js).
2. after lanes Q/W/R exist on the shared ctx (ctx needs bus, input, overlay,
   S, set, rig, character, terrain, shrine, progression, quests, caches,
   trials, bounties, beacon, bosses, portal, relics, boons, shop, shrineMenu,
   realms, getRealm): hud.attach({shop, bus}) (NOT lane R GlassCounter);
   questTracker, compass, dialogue (ctx.dialogue=), toasts, interact,
   journal, worldMap, introCard, ending; minimap.attachQuest(ctx).
3. frame (before endFrame, after progression/quests/W/R updates):
   interact, questTracker, compass, dialogue, toasts, journal, worldMap,
   introCard, ending .update(dt).
4. `ending.drive();` right after rig.update(...), before post.update.
5. startShell pointerlockchange: `&& !anyModalOpen() && !input.panel`.
6. enterRealm end: setRealm(token) on tracker/compass/dialogue/toasts/
   journal/worldMap/interact.
7. Lane W hook #6 (E) is REPLACED by Interact; do not add both.
