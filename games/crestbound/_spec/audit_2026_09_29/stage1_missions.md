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
- COMMIT 17b4e786 (21:20): course.js / coursecard.js / save.js / game.js / verdant-1.js + _ms_* probes.
  Evidence before commit: modulecheck 71/0, esbuild clean, bootcheck --headless (keep): 0 console /
  page / shader errors, state reached 'keep', frames advancing; its verdict flagged only "left title
  False" — leave_title's 45 s budget ran out at frameMs 4880 (machine at 100 % CPU, 62 chrome procs).
- game.js: `?dev=1&course=<id>&mission=<crestId>` boots straight into a mission (urlMission()).
- SERVER FINDING: the shared :8788 server (serve_nocache.py, socketserver default request_queue_size 5)
  REFUSES module fetches under the multi-lane load (ERR_CONNECTION_REFUSED on hud.js, menu.js,
  coursecard.js, data/index.js, util.js, tuning.js -> boot stuck at INITIALISING). Also :8795 is already
  taken by someone's `http.server`. This lane runs a private no-cache server with a 512 backlog on
  127.0.0.1:8913 (scratch serve_ms.py) and passes --url to every harness.
- PROOF RUN 1 (live tree via :8913, 21:30): the hand-stepped walk raised the card in 11 frames; card opened on
  MISSION 1 (first unclaimed); 4x real ArrowRight -> MISSION 5; real Enter -> verdant-1 in mission 'boss':
  crests built = sigils, coins, secret, boss, wing (open + race ABSENT), def.crests still 7.
- FIX (coursecard.js, uncommitted at this line): a key or stick still HELD from the walk-in no longer steers the
  card. Keyboard: `e.repeat` on arrows / WASD / digits is swallowed. Pad: show() samples the pad; directions are
  ignored until it reads neutral once (rAF watch only while held). Without this, walking in with the stick
  pushed fed padNav 'up' + its 0.12 s auto-repeat into nav.move(-1), flicking focus ENTER<->BACK.
- PROOF RUN 1 RESULT (exit 0, 0 page errors; frames in %TEMP%/ms/proof1, superseded by run 2):
  * mission 5 (boss): crests built sigils/coins/secret/boss/wing; yard-bumbler at (-6.8, 16.79, -49) on the
    ring; mill period 16; north-door ray from the courtyard: no hit (open); timers + deaths display:none.
  * mission 1 (open): crests built open/sigils/coins/secret/wing; warden gone; garrison bumblers at
    (-4.66, 9.39, -31) and (6.71, 9.39, -26.5) + yard-bumbler in the courtyard; mill 11; north-door ray HIT
    at 3.83 m (barred).
  * climb with real Space presses (3 jumps, 142 hand-stepped frames) -> crest -> clear panel showed ONLY
    'RETURN TO KEEP' -> real Enter -> Keep. Save: crests ['open'], missions {boss:{runs 1, got []},
    open:{runs 1, got ['open']}}, lastMission 'open'.
  * BUG FOUND: the reopened card showed got [] and the cursor on the CLAIMED mission 1 — game.js hands
    card.show() the Save MODULE, and the card read `save.crests` off it (pre-existing: the gate's card never
    marked a claimed crest). FIXED in coursecard.js (a module is read through course(id)).
  * the race-pad check was invalid: a teleport onto the pad + 1.8 s wall settle at ~4 s/frame ran ~0 frames.
    Driver v2 walks onto the pad with a held KeyW, hand-stepped (the race starts on the step-on edge).
- Driver v2: stations are rendered deterministically (engine stopped, sim hand-stepped, lens set, ONE frame
  rendered) — run 1's station frames showed the PREVIOUS station under load.
- PROOF v2 RUN 1 (mission 5) DONE, frames in frames/missions/01..04_*.png, log frames/missions/proof_run1.log:
  card opened on mission 1, 4 real ArrowRight -> mission 5 (02_card_mission5: tile 5 outlined); V1 courtyard:
  north door OPEN, no bumblers in the yard; V2 ring: Warden + its squire bumbler; V3 tower: NO crest; V4
  overview; walked (real KeyW, 150 frames) across the race start spot: raceMs -1, timers/deaths display none.
  Then the Playwright driver died ("Connection closed while reading from the driver") — the box ran out of
  commit (bash fork 0xC000012D; 88 chrome procs). Driver got --skip-run1 / --name and dumps json per run.
- PROOF v2 RUN 2+3 DONE (frames/missions/05..13, proof_run2.json; 0 page errors):
  * mission 1 frames: 06_open_v1_courtyard = north door BARRED (timber leaf, iron straps) + three bumblers in
    the yard (two red-hat garrison + the yard bumbler); 06_open_v2_ring = the ring EMPTY (no Warden, no
    squire, no braziers) and the barred door visible on the right. Compare 04_boss_v1 / 04_boss_v2.
  * crest by 3 real Space jumps (142 frames) -> Keep. SAVE: crests ['open'], bestMs open 6629,
    missions {open:{runs 1, got ['open']}}, lastMission 'open'; Save.crestTotal() 1.
  * reopened card (12_card_after_crest): tile 1 GOLD with 0:06.629, cursor on MISSION 2 (first unclaimed),
    button RE-ENTER — the coursecard save-module fix, observed.
  * held D (1 keydown + 2 repeat keydowns): cursor 2 -> 3 (ONE step).
  * Digit6 -> mission 6: only the race crest of the race kind built; walking onto the pad (real KeyW):
    race started at frame 14, raceMs 1517, runstatsOff false, timers + deaths display flex (13_race_running:
    RACE clock top centre, run timer + skull top right). Mission 5 walk over the same spot: raceMs -1,
    display none.
  * 10_clear_panel caught the celebration orbit (state clear, lens inside the tower's cone roof) before the
    panel rose — the panel's single RETURN TO KEEP was recorded in the first pass (proof_run0_firstpass.log).
    CAMERA NOTE (not this lane): at the rampart crest the clear orbit puts the lens INSIDE the cone roof
    (08_crest_taken, 10_clear_panel).
  * DISK: C: hit 100 % (216 MB free) at 22:04 — "[Errno 28] No space left on device" on one screenshot
    (retry succeeded). Deleted my own scratch frames (16 MB).
