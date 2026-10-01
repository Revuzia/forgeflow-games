# Stage 1 - lane: missions (mission select, SM64 style)

Status: STARTED 2026-09-30. Reading spec + code.

Owned files: runtime/world/course.js (mission layer only), runtime/ui/coursecard.js,
runtime/core/save.js, runtime/game.js (mission flow only). Proof course: verdant-1 (data file
edited only to author two missions - see below).

## Log
- read CONTRACT, HARNESS_NOTES, PLAN, sm64_bar (sections 4, 10).
- DESIGN (decided after reading game.js / course.js / collectibles.js / hud.js / loopcheck / gatecheck):
  * course.js: pure `resolveMission(def, missionId)` runs BEFORE the compiler. Mission = crest id.
    Crest `mission:{name,hint,at,add:{objects,critters,coins},remove:[tag],move:{tag:{to|by}},
    set/hazards:{tag:{patch}},open:[route],close:[route],always}`; course `routes:{name:{open,whenOpen,whenClosed}}`;
    object/critter fields `tag`, `route`, `blocks`, `missions`, `notMissions`.
    missionId null (dev goto, loopcheck) => SAME def object for every course without mission features
    (verified node probe _harness/_ms_resolve.mjs: verdant-1 + ember-1 plain = IDENTITY).
  * def.crests keeps all 7 (HUD pips + loopcheck read it); only Collectibles gets `crestsLive`.
  * race crest exists only in its own mission => race timer never runs uninvited (every card run).
  * reachcheck reads def.objects raw -> mission-only content goes in mission.add / routes.whenClosed.
  * HUD (hud.js) is NOT mine: timer/deaths hidden via a documentElement class + CSS injected by game.js;
    clear panel uses existing `canStay:false` so a mission run ends at RETURN TO KEEP (100-coin crest may stay).
- BUILT (uncommitted at this line): course.js mission layer (resolveMission/missionList + validate sweep +
  crestsLive filter in _buildCollectibles), save.js (missions{runs,got}, lastMission, startMission,
  collectCrest(course, crest, mission), mission(), lastMission()) - node unit test green (scratch savetest.mjs),
  coursecard.js mission select (tiles = missions, banner, arrows/A-D/1-7/pad, card.mission), game.js mission flow
  (loadCourse {mission}, startMission, canStay:false in a mission run except coins crest, race-only run stats,
  __dev.goto(id, cp, mission), __dev.mission()). verdant-1: routes.north-door, missions on 'open' and 'boss'.
- SHARED TREE HAZARD: at 16:40 runtime/player/controller.js (player lane, mid-edit) does not parse, so the live
  tree cannot boot. Proof runs against an isolated snapshot: games/_bisect/ms1 = git archive HEAD + my 5 files
  (modulecheck there: 66 modules, 0 failing). URL http://localhost:8788/games/_bisect/ms1/games/crestbound/index.html
- Machine: CPU 100 %, 78 chrome processes at 16:45 -> hand-step (engine.stop + game.update(1/60)) for the climb.
- proof driver: _harness/_ms_proof.py (frames -> _spec/audit_2026_09_29/frames/missions/, proof.json).

## RESUME 2026-09-30 ~21:00 (second run, after the usage limit)
- Live tree now parses: modulecheck 71 modules, 0 failing; esbuild clean on course.js, coursecard.js,
  save.js, game.js, verdant-1.js.
- node probe _harness/_ms_resolve.mjs: all 13 courses validate, 0 warnings; every course without
  mission features resolves plain to IDENTITY; verdant-1 open = warden removed, north-door closed,
  +2 garrison bumblers, +5 door objects; boss = yard-bumbler moved to the ring, mill period 16,
  +3 objects (braziers + light), crest at ring centre. Race crest absent outside its own mission.
- The earlier browser proof died with "card never opened" (proof.json) against the _bisect/ms1
  snapshot. Next: debug the walk-in against the LIVE tree, then run the proof, gates, commit.
- CPU 100 %, 29 chrome procs at 21:03 (other lanes running). One browser at a time.
