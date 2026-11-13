# Lane Q — quest engine checkpoint

Resumed 2026-09-30 by the third Lane Q agent (two earlier agents killed by usage
limits, no checkpoint file existed). STATUS: DONE (lane work); main.js hooks
are the integrator's.

## Starting state (orchestrator measurement)
- node probe qa_questmachine_node.mjs: 54/55, only B16 failed
  (steady quest.update frames allocate) — questNewSpaceBytes [549016,452496,21232].

## Done
1. B16 diagnosed: NOT a source allocation. V8 heap-sampling profile (inspector
   HeapProfiler.startSampling, interval 32) put every residue byte in
   _refreshWaypoint / _wpDormant (the 4 Hz waypoint poll); --trace-opt showed
   TurboFan compiling exactly those functions when the residue vanished.
   Unoptimized V8 tiers box every double result as a HeapNumber; a 4 Hz
   function reaches TurboFan only after ~100-250k frames. 12-window run:
   [2849448,352480,2496,2496,...] with the empty-loop floor = 2496 bytes.
2. Probe fixed honestly (_harness/qa_questmachine_node.mjs B16): windows run
   until one reaches the empty-loop INSTRUMENT FLOOR, then 3 more windows must
   stay at floor+1KB; a scavenge inside a window invalidates it; pre-tier-up
   windows are reported.
3. Static review: questSystem/questData/storyText/QUEST_DESIGN boss names =
   live roster (Icewall/Shrinebreaker, Gatekeeper of Brass/Warden of the
   Sundered Gate, Furnace Guardian/Volcanic Plate Knight). "Moraine" appears
   in owned files only in explanatory comments + QUEST §2's rename note.
4. Added C6/C7 (realm-boss floor 8). Node probe 57/57:
   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_questmachine_node.mjs
5. qa_questcore.py (browser proof) updated: serves via qa_server.py 8921,
   15-min boot budget, 2 attempts then NOT RUN with measured fps, rAF fps
   probe after boot, wall stamps.
6. OUT OF SCOPE finding: Math.random IS called in combat/enemies.js (spawn
   yaw/orbit/strafe :846/:859-861 + AI), combat/encounters.js (:830, :911-958),
   combat/combatData.js:860. Not lane Q files. Probe F1 keeps its enemies.js
   exemption (removing it fails F1 at enemies.js:846 via _spawnPack).
7. Stale comments fixed in questData.js / storyText.js ("18 steps" heading
   is now "20 steps (Cold 8, Sand 6, Ash 6)" in QUEST §2).
8. Browser proof PASSED: python _harness/qa_questcore.py -> "29/29 checks
   passed; page errors: 0", EXIT=0. Boot 180 s (attempt 1), 0.16 fps at
   boot (machine later sped up); first ding 28.43 s game time; mini NOT armed
   over 18 samples while cold.4 open, armed 3.22 s after the 3rd shrine;
   reload boot 56 s; cold.6 survived register + CONTINUE.

## Integrator hooks (main.js) — see the lane report for exact snippets
- import QuestSystem + bus; construct after `let bossKillsSeen`; 
  `quests.update(dt)` right after `progression.update(dt)`;
  `questBus.emit("realm:entered", {realm: token})` right after
  `realmToken = token;` in enterRealm; optional `quests` on SNOWFLOW.
