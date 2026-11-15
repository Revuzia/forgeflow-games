# Lane INT — integrator checkpoint

Started 2026-10-01 (first INT agent, user request "Try again"). Port 8930.
No INT.md existed at start. Server: `python _harness/qa_server.py 8930`
(started by this agent in the background; it may still be listening).
Scratchpad logs: C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/9e9ff830-6ecf-420d-ba55-625913a5412e/scratchpad

## Done
1. src/main.js WIRED (all in `[MEANING LAYER]` regions):
   - imports (Q/W/R/U modules + bus as questBus; NOT GlassCounter — hud pill).
   - `const mctx = {}` declared beside realmToken (before enterRealm), filled
     by Object.assign after `let bossKillsSeen` (before initInput).
   - construction order: QuestSystem; RelicCaches, WakeTrials, Bounties,
     WaypointBeacon (+ beacon.set(quests.waypoint)); Modifiers, Relics, Boons,
     Shop, BoonPick, DriftmarkToast, ShrineMenu; hud.attach({shop,bus}),
     QuestTracker, Compass, Dialogue, Toasts, Interact, Journal, WorldMap,
     IntroCard, Ending; minimap.attachQuest(mctx).
   - enterRealm: shop.setRealm after wake.applyRealm; W setRealm after
     landmarks.setRealm; after `realmToken = token`: emit 'realm:entered' +
     R/U setRealm.
   - warm-up: W seeds + warmUpMeshes + finishWarmUp.
   - frame: ending.drive() after rig.update; mods.update after spellHits;
     Q/W/R logic (incl. empty relics/boons/shop.update) after
     progression.update; U UI before hud.update().
   - pointerlockchange guard `&& !anyModalOpen() && !input.panel`.
   - SNOWFLOW: bus, meaning (mctx), quests, world{}, rewards{}, ui{}.
   - howTo 'Panels' text; index.html #hint line (e/j/m) — only that line.
2. src/core/input.js [INTEGRATOR] _mapKey: in play, M is taken in the
   capture phase (map) so game_controls.js's window M = MUTE never fires
   (committed game_controls.js:224/451 binds KeyM -> toggleMute). Menus: M
   still mutes.
3. modulecheck "MODULECHECK OK broken=0 chunk-errors=0" (pageerror 'reading
   width' = boot() on a page with no canvas). bootcheck run1: draws/tris
   30 / 1914134; "NOT BOOTING CLEAN" only for bootGone=False at the 2.5 s
   read (phase 'ready', 0 errors) — starved box.
4. Node: qa_wiring_node.mjs (NEW) "=== 26 / 26 wiring checks PASS ===";
   lanes: questmachine 57/57, worldact "SUMMARY 71 checks, 0 failed",
   rewards unit 21/21, ledger 32/32, ui_node 30/30, lane-U 36/36 (re-run
   after the input.js change: U 36/36, R-UI 30/30).
5. Acceptance RUN 1 (meaning_run1.log; STOPPED by me at wall ~5900 s):
   PASS W0, A1a intro, A1b tracker, A1c walk+Echo, A2a surf 150.5 m in
   12.41 game-s, A2b kill 5 (boltKills 0 / scripted 5), A2c first ding
   57.25 s, A3 beacon+compass (shrine_w 287 m), A4 not armed (6 normal + 12
   test samples) then armed, A5 Rime Edge 1.0800 (floaters 15 -> 16), A6a
   caches (lore +13 glass, Frostglass Lens). FAIL A6b = PROBE: relics.js
   auto-wears a found relic, my click took it OFF (leash 48 -> 40). Fast
   travel same realm OK (dStand 0). FAIL A7a trial: only 9.5 game-s in 2406
   wall-s — the shell had PAUSED itself (shot meaning_13_trial = PAUSED
   menu); rest of run stalled -> stopped.
6. Probe fixes for run 2: relic flow = take off then wear (measure both);
   killPack surfs at the pack and casts the arc; pause guard (logs
   pointerlockchange/blur, auto-resumes via shell.resume(), reported);
   A10b M vs mute; A15 dev keys 7/7; trial wall cap 3600 s.
7. qa_battery_int.py (NEW) + lane browser probe pages patched to REUSE
   main.js's systems (qa_ui_page.js, qa_rewards_page.js, qa_worldact.js,
   qa_questcore.py).

8. Acceptance RUN 2 (meaning_run2.log): "=== 20 / 22 ... PASS === page
   errors: 0 first ding: 26.77 s". FAIL A5 = probe contamination (a 2nd hit
   on the QA target; run 3 attribution: a bolt 'splash' from the mouse click
   on the boon card — pinned input.locked makes a DOM click count as LMB);
   FAIL A11 = probe read trials 2 game-s after CONTINUE, before lane W
   rebuilt the realm (live list empty). Both fixed in the probe.
9. Acceptance RUN 3 (meaning_run3.log, json scratchpad
   qa_meaning_out_run3.json): "=== 22 / 22 meaning-layer acceptance checks
   PASS ===   page errors: 0   first ding: 25.21 s game time", EXIT=0.
   Menu 1.46 fps; boots 129 s / 7 s. A5 spikes 15.056 -> 16.2605 = 1.0800;
   A6b leash 48 (found, auto-worn) -> 40 (off) -> 48 (on) = x1.20; A7a gold
   29.79 s (par 36.4); A14 draws 38.17 vs 34 = +4.17 (2/1/1); A11 diff {}.
   ENV: 2 auto-resumes (real pointer lock dropped with no modal/panel and no
   window blur at page 415.1 s and right after CONTINUE; the shell paused as
   designed; the probe resumed via shell.resume()).

## In flight
- BATTERY run 1: scratchpad battery_run1.log, per-script logs in
  scratchpad/battery/.

## Next
- then `python _harness/qa_battery_int.py --logs <scratchpad>` (one browser
  at a time). qa_boss A likely needs the quest advanced (questGate):
  planned fix = advance quests.main[r] until bossUnlocked(r,'realm').
