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
- GATES, first pass (22:10-22:40, CPU 99 %, 73-88 chrome procs, private server :8913):
  * modulecheck 71 / 0 failing.
  * loopcheck --headless keep + verdant-1: keep 46/46; verdant-1 77/80 — the 3 failures are respawn TIMING
    only (cp1 2985 ms, cp4 1483 ms vs 950 ceiling; median 776 vs 700); every functional row passes,
    including "a crest collects", "written to the save", "clear card resolves". G.lastRespawnMs is a WALL
    stamp (the death timeline is wall-driven) and keep's samples in the same run were 433/492/428/12.
    The mission layer adds no per-frame work. Log: frames/missions/loopcheck_run1.log.
  * gatecheck --headless --no-enter: 319 passed, 8 failed — 5x "floor to stand on" (dropped +0.6 m,
    "ended" +0.37..0.54 m after a 900 ms WALL wait = ~1-2 frames ran), 2x walk-in never reached the
    volume (hero still at its start spot after the 3.4 s WALL budget), 1x azure-3 cancel -> 'paused'.
    None of the 8 involve the mission UI (the card never opened in 7 of them). Re-driving the same rows
    hand-stepped with real W / Escape: _harness/_ms_gateprobe.py. Log: gatecheck_noenter_run1.log.
- _ms_gateprobe.py (shipping build, gatecheck's own DROP/LANDED/AIM/place/SET_CRESTS, hand-stepped,
  REAL held W + REAL Escape) on the 6 gates gatecheck failed: 42 rows, 0 failed, 0 page errors
  (log frames/missions/gateprobe_handstepped.log). Floors: grounded after 90 frames at every stand-out spot.
  Walk-ins: all raise the card; real Escape returns control to 'keep' every time. => the 8 gatecheck rows
  were the wall-clock waits under load, not the build.
  OUT-OF-SCOPE OBSERVATION: at rime-2, azure-1, azure-2 and azure-3 (0, -0.6) the walk-in needs exactly
  329 hand-stepped frames (5.5 s game time) with the hero in 'bonk' against the wall before the card rises
  (ember-3/4: 9-23 frames; azure-3 +0.6: 18). gatecheck's walk budget is 3.4 s. Owner: gates / controller.
- loopcheck verdant-1 rerun (22:55): 76/83 — worse, and still only timing rows: three "engine.elapsed
  stalled for 20000 ms" (the renderer got no frame in 20 s of wall) + respawn wall stamps 1115-1298 ms.
  game.js stamps lastRespawnMs with performance.now (line ~2123), so it is a wall measure. Log loopcheck_run2.log.
- DIRECT MISSION BOOT (_ms_direct.py, ?dev=1&course=verdant-1&mission=open): the run's record is mission
  'open' (north-door closed; boss + race absent) -> 3 real jumps -> crest -> celebration hand-stepped until
  the panel rose -> 14_direct_open_clear_panel.png: COURSE CLEAR, CREST ON THE RAMPARTS, ONE button
  'RETURN TO KEEP' (focused), the run timer + skull hidden in the HUD -> real Enter -> Keep. Save:
  missions {open:{runs 1, got ['open']}}. (The under-roof crest lens frame was inside the cone roof:
  the rampart crest sits inside the tower's roof volume — deleted, not evidence.)
- loopcheck keep + verdant-1, run 3 (23:00): 130/132 — keep 45/46 (cp1 respawn 963 ms vs 950 ceiling: the
  SAME keep row passed at 433 ms in run 1; the Keep has no mission features and resolves to the identical
  def), verdant-1 79/80 (cp4 respawn 1258 ms; median 684 <= 700 now passes), gates 6/6. Only wall-stamped
  respawn rows ever fail and they flip run to run on the same build => load. Log loopcheck_run3.log.
- coursecard.js: padDirNow() made closure-free (padOn helper).
- gatecheck --no-enter run 2 (23:02, CPU 65 %): 1 floor row (azure-2, ended +0.08 m, wall wait) and then
  "rime-1: cancelling the card (offset +0.0 m) returns control state='paused'" — and the harness never
  resumes, so every later rime/azure row failed in 'paused' (log gatecheck_noenter_run2.log). Same symptom
  as run 1's azure-3 row. Investigating because the card is this lane's:
  * _ms_pauseprobe.py (gatecheck's own place/walk_in on the LIVE loop + real Escape, Game.pause wrapped,
    window keydown listeners before and after the card): 12 cycles on rime-1 / azure-3 / rime-2, all back
    to 'keep', ZERO pauses; the Escape keydown NEVER reached the window bubble phase (input.js's listener),
    i.e. the card consumes it. Not reproduced outside a full gatecheck run.
  * next: the same Game.pause instrumentation INSIDE a full gatecheck run ($TEMP gatecheck_diag.py).
- ROOT CAUSE of "cancelling the card returns control: state='paused'" (gatecheck_diag_paused_cause.log, a full
  gatecheck run with Game.pause + card.close/_choose + every key and state change logged):
  the card's close() removed `.on` only in the 180 ms fade's onfinish; on the starved frame clock that
  fired > 2 s late. gatecheck's walk_in reads `.cb-card.on` as "card open", so the NEXT walk broke out
  after 141 ms (state still 'keep', no card), "raised" was true, and its Escape went to the Keep:
  window bubble -> input.js latched pause -> _readInputActions -> pause('input') -> every later row
  'paused'. FIX (coursecard.js close()): `.on` comes off at once; the fade runs under `cc-leaving`
  (display only, pointer-events none). `.on` now means open, exactly when `_open` is true.
- gatecheck --no-enter after the close fix (23:35-23:44, CPU 100 %): 240 passed, 54 failed, ZERO "returns
  control" failures and no 'paused' cascade (log gatecheck_noenter_after_closefix.log). The 54: 35 walk-ins
  + 14 sealed walk-ins whose hero never reached the trigger inside gatecheck's 3.4 s WALL budget (event log:
  W held 3.4-3.5 s, state never left 'keep', hero moved < 0.1 m at verdant-2) + 5 floor drops (900 ms wall).
  The same rows hand-stepped: _ms_gateprobe.py 42/42.
