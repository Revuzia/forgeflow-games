# Stage 1 - lane: creatures (signature enemies + realm bosses)

Status: COMPLETE 2026-10-01 (see STATUS at the end). Started 2026-09-30. Owned files: runtime/entities/** (critters.js + new files),
plus harness-only files under _harness/ (the test arena data + its driver).

## Design decisions (so a usage limit cannot erase them)
- Existing critters (gnasher, bumbler, skitter, warden, fen) stay BIT-IDENTICAL: the new roster lives in
  NEW files (runtime/entities/creatures.js, runtime/entities/bosses.js) built by factory functions that
  receive the Critter base + helpers from critters.js (no ESM import cycle: the new files never import
  critters.js). critters.js only gains an exported kit object and registry lines at the bottom.
- Reward drop = `events.emit('coins', n, pos)` -> course.js -> ONE course.dropCoins (as built; see STATUS).
- Boss defeat fires `_trigger('boss')` -> collectibles spawns the `boss` crest (collectibles.js:1892 matches
  'warden-down' OR 'boss'). Bosses do NOT emit 'down' (that would toast "WARDEN DEFEATED" in game.js).
- The Warden stays registered as `warden` = the mini-boss.
- Test arena = a course def under _harness/ swapped into the page's COURSE_CACHE entry for a real course id
  (in-page only, nothing on disk changes), so every creature + boss is fought in the real game loop.

## Baseline
- loopcheck --headless verdant-1,ember-1,azure-3 BEFORE any edit: that first run never finished (its log is empty).
  Superseded by the A/B in REGRESSION below (lane base vs lane head, same everything else).

## Log
- read CONTRACT, HARNESS_NOTES, PLAN, sm64_bar (sections 5, 7), critters.js in full, course.js critter
  wiring (_buildCritters, onPoundLand, _detectStand, trigger, dropCoins), collectibles.trigger, game.js
  _findWarden (matches kind 'warden' only -> realm bosses need game.js to also match `isBoss` for the HUD
  hp bar + boss music mood: integration residual, not this lane's file).

## RESUME 2026-09-30 (second run, after the usage limit)
- Found on disk (uncommitted): runtime/entities/creatures.js (2654 lines: Creature base, StarRing,
  MarkerSet, ShotSet + Burrower, Podspitter, SlagCrab, EmberImp, Skater, SnowCub, Sentry, Puffer),
  runtime/entities/bosses.js (2278 lines: Boss base + Bramblehide, Slagmaw, Hoarhorn, Gyrarch),
  critters.js +49 lines at the bottom only (ROSTER_KIT, CRITTER_ROLES, registry spread),
  _harness/cr_arena.js (arena def per realm), _harness/cr_bot.js (hand-stepped real-key bot),
  _harness/_cr_smoke.mjs (Node smoke, not a gate). The page driver `_cr_arena.py` was NOT yet written.
- Re-verified at resume: esbuild parses all 5 files; modulecheck 71 modules, 0 failing;
  `node _harness/_cr_smoke.mjs` -> SMOKE OK for all 12 kinds (construct, 20 s scripted drive, reset replays
  bit-identical, dispose).
- Next: bootcheck --headless (keep) -> COMMIT; then write _harness/_cr_arena.py and prove every kind.
- COMMITTED c55df6df (21:2x): entities + arena + bot (modulecheck 71/0, smoke 12/12; bootcheck --headless reached
  state 'keep' with 0 console/page errors, but its verdict printed FAIL "never reached a live state (stuck at 'title')"
  because leave_title() has a 45 s WALL-CLOCK budget and the box measured frameMs 10427 at 100 % CPU).
- Integration added after the commit (hero lane's contracts, read from controller.js/carry.js, not edited):
  * Creature.onAttack(player, pos, kind, dir) -> onStrike with normalised verbs (punch/kick/slidekick/dive/throw):
    controller.strikeAt prefers onAttack over its onPound-at-the-fist fallback. Slag crab: a blow on the shell clonks.
  * bosses: hitRadius (strikeAt pre-filter) bramblehide 6.6 (bud is ~5.6 m behind), slagmaw 2*(arenaR+1) (bombs
    anywhere; onStrike checks each), hoarhorn 1.9, gyrarch 1.6.
  * Slagmaw bombs = carry.js contract objects (carryable getter only while DARK, pos, onPickup/onCarry/onThrow/
    onDrop/onStrike, course) registered via a DYNAMIC import of ../player/carry.js (never a link failure if absent);
    a throw within ~40 deg of the boss is steered into the grate; a free throw bursts where it lands.
- Driver: _harness/cr_arena.py (one browser for all realms; boot measured 324 s under load) + _harness/cr_scenarios.js
  (one closed-loop proof per kind). Frames -> _shots/cr_arena/<realm>/, records -> _harness/cr_arena_<realm>.json.
- loopcheck plan: frozen snapshots _bisect/s1cr2base (entities from c55df6df~1) vs _bisect/s1cr2new (current
  entities), both = the same 21:33 copy of every other lane's files, so any loopcheck difference is this lane's.

## PROOFS (cr_arena.py, real keys, hand-stepped game.update(1/60), frames read)
- VERDANT (run 2, 21:36-22:30, _harness/cr_arena_verdant.json, _shots/cr_arena/verdant/01-27):
  * burrower: noticed Nim at 8.94 m (f79) -> dive, tunnel, tele (orange ring at the mound, frame 03), pop, dazed,
    dig, tunnel, tele, pop, dazed -> STOMP (hop maxY 3.36) -> defeat, gone; coin counter 0 -> 3. 0 bumps.
    (first tele fired at its 9 m range leash, 2 m short of Nim, so the "toss" did not land on him: toss unproven.)
  * podspitter: noticed at 12.93 m -> aim, tele (ring at Nim's feet, frame 08), spit x2 (both seeds missed the
    sidestepping hero) -> STOMP on the pod -> defeat; coins paid (counter 3 -> 6 during the stomp bounce).
  * bramblehide: intro toast read from the DOM "BRAMBLEHIDE · THE ROOT TYRANT / WHO TRAMPLES MY MEADOW? ..."; fight
    25.4 s game time: slamTele ring -> slam -> stuck -> POUND the bud (hp 3->2), phase2 line + thorn volley (5 rings,
    frame 16), stuck -> pound (2->1), phase3 line, double slam (yank then stuck) -> pound (1->0) -> defeat line, defeat
    anim 3.42 s -> bossDown -> course trigger 'boss' -> boss crest present -> walked to it -> crest counter +1, game
    state 'clear'. Said: intro, hurt1, phase2, hurt2, phase3, defeat. Hero never bumped.
- Cost: 0.31-0.77 s wall per game frame at 82-100 % CPU (97 chrome processes on the box).
- Fixed after reading frame 01: lurking burrower showed only fur tufts (face under the mound) -> BR_LURK -0.28.
- EMBER run 1 (22:05-22:55, _harness/cr_arena_ember.json, _shots/cr_arena/ember/01-22):
  * slagcrab: noticed at 7.92 m -> stalk, tele (claw up, seams flare: frame 03), snap, recover -> STOMP -> coins +3.
    The clonk/flip beats did not happen (the hop started inside its 2.7 m snap reach) -> scenario now hops from 3.3 m.
  * emberimp: noticed at 9.92 m, cackle, 13 crouch(flare)/hop cycles, NOT defeated: its hops were blocked by the
    BAY B sign post in the lane (same cause as the burrower's short tunnel) -> signs moved; pound loop now frame-driven.
  * strike:slagcrab: the hero lane's PUNCH (real KeyF, controller.strikeAt -> Creature.onAttack) defeated it
    (defeatHow 'punch'), coins +3.
  * slagmaw: intro toast "SLAGMAW · THE CRUCIBLE GLUTTON / FRESH ORE! ..."; bomb LIFTED with KeyF (carry contract,
    f2757); hp 3->2 at f2974 (no pound-kick before it: the held/released bomb), phase2 line + fire ring, pound-kick
    bombKicked f3538 -> hp 2->1, phase3 line + march; then 150 s without the last hit: the bot drifted out of the ring
    (boss slept 'dormant') and dark bombs sat under the next volley's rings. Policy fixed (kick from 1.6 m, allowed
    unless a bomb lands on him first; hold point clamped inside the ring; walk back in when it sleeps; throw press
    retried after the 0.26 s lift). Rerun pending.
- RIME run 2 (23:3x, _harness/cr_arena_rime.json, _shots/cr_arena/rime/):
  * skater: noticed -> tele (scrabble) -> slide (sidestepped) -> spin -> dizzy (stars) -> STOMP; coins +3.
  * snowcub: clap -> windup -> shove (ball rolls, sidestepped: no ballHit) -> watch -> sulk -> scoop -> windup ->
    POUND beside -> defeat; coins +3.   * strike:snowcub: PUNCH (KeyF) -> defeat 'punch', coins +3.
  * hoarhorn: reached the floe by a jump, intro toast "HOARHORN · LORD OF THE FLOE / OFF MY FLOE, SPRAT...", charge ->
    TEETER at the lip twice, but 0 hits: the bot slid off the ICE (friction 1.6) and spent 9991 of 10430 frames in
    the sea, then swam under the north shore and died below killY. Fixes: arena sea surface raised to -0.5 (0.5 m
    freeboard, shore slab reaches below it), velocity-SERVO steering (bot.servo brakes on ice), stand spots 3 m in
    from the lip, sea recovery (swim to the lip, surface-jump out). Rerun pending.
- AZURE run 2: sentry: track -> tele (red aim beam, frame 02) -> fire (sidestepped) -> cool -> POUND -> coins +3.
  puffer: within 5 m inflate -> puffed (a bounce platform, frame 06) -> warn -> deflate -> drift -> defeat -> gone ->
  RESPAWN after its 10 s -> drift -> inflate; coins +3.  strike:sentry: PUNCH -> defeat 'punch', coins +3.
- AZURE run 2 gyrarch (23:45-01:00, 5517 s wall at 258 ms/frame): intro toast "GYRARCH · THE CLOCKWORK SUN / TICK.
  TOCK. ..."; 11 aim/fire/vent/close cycles, the bot boarded gears 8 times and rode 58 s, 0 hits. Two causes:
  (1) HARNESS: its leap re-pressed an already-held Space (no new press, no jump: 800 'leaps'); fixed (fresh press,
  rise clear of the body, ride the gear's inner edge). (2) GAME BUG, fixed in bosses.js: the body shove sphere
  (r 1.26 + capsule 0.38 at the core) reached 0.2 m ABOVE the crown deck, so any hero landing on the crown was shoved
  off before the pound could land - the core was unreachable. The shove now only applies below the deck.
- puffer bounce was never proven: the puffed collider top was 1.70 m, 0.21 m under a single jump apex (1.91 m);
  real-key hops never got on. FIXED in creatures.js: the puffed ball SAGS (PF_SQUASH 0.8) -> collider top ~1.44 m.
- HARNESS: a __dev.goto straight from the TITLE left the title menu open; a later key press reached it and sent the
  game to 'loading' mid-proof (rerun 1 puffer froze in 'puffed'; run 2 gyrarch ended in gs 'loading'). cr_arena.py
  now leaves the title with its own button first; the bot logs every game-state change into each record.
- RERUN 2 (01:09-, title left first; game state stayed 'playing' through every proof):
  * puffer: inflate -> puffed (collider top 1.64 m at the jump) -> real-key hop landed on it -> BOUNCE: hero vy 19.06,
    apex 7.16 m (a triple jump peaks at 3.58 m) -> the pop-pound was too late (it had begun to deflate) -> pound
    beside it while deflating -> defeat -> coins +3 -> respawned after 9.27 s. Pop-at-apex scenario fix pending rerun.
  * gyrarch: 31 boardings, 116 s riding gears, 2 leaps -> ONE CROWN POUND LANDED (hit hp3->2 'pound' f5819, lines
    hurt1 + phase2) -> no further leap: the leap gate was too strict (inner-edge 0.45 m). Relaxed (0.8 m, gear within
    1.5 m of the deck, may leap in the last of 'fire'); rerun pending.
  * HOARHORN DEFEATED: charge -> teeter -> POUND beside -> pushed -> fall (dunk) hp 3->2 (f474), phase2 + frost
    breath cycles, teeter -> pound -> dunk 2->1 (f1153), phase3 double charges, teeter/pound/push x3 -> dunk 1->0
    (f5150) -> defeat line, defeat 3.22 s -> bossDown -> trigger 'boss' -> crest present -> taken (crest counter +1).
    Said intro, hurt1, phase2, hurt2, phase3, defeat. Hero in the sea 250 frames, climbed out by surface-jumps.
    (On the walk to the crest the bot fell in the floe/shore channel once: game 'dead' -> respawn at cp-ring, which
    is beside the crest.)
- GAME BUG FOUND BY THE ARENA, FIXED (creatures.js): a critter ctx's `world` is the course bundle
  {broadphase, killVolumes, volumes, course} with NO raycast, so Critter._groundY always returned its fallback and
  every `world.raycast` in the roster was skipped. Effects measured in the arena: the burrower never left its mound
  (its first telegraph was at HOME, 9 m from Nim), the ember imp hopped in place at home for 2680 frames, the
  snowball burst the frame it was shoved (the cub's "sulk" was a miss by construction), the sentry's line of sight
  was always clear. The roster now casts against the course BROADPHASE (Creature._cast, parking its own colliders
  for the call); the five original critters keep the bundle, untouched. Node sim of the imp now hops 10 -> 19 m.
  Every enemy proof is being re-run on the fixed code; the three defeated bosses (bramblehide, slagmaw, hoarhorn)
  only probe the floor with a fallback equal to the flat arena floor, so their proofs are unaffected.
- FINAL RE-PROOF on the fixed code (03:37-, `cr_arena.py ... --only <enemies, strikes, gyrarch>`, frames r0337_*/r0342_*/r0344_*):
  * burrower: notice 8.94 m -> dive -> TUNNELED 7.97 m from home -> tele 0.37 m from Nim (ring under his feet) -> pop
    TOSSED him (vy 7.5, bump) -> dazed -> dig -> tunnel -> tele (sidestepped) -> pop -> dazed -> STOMP -> coins +3.
  * podspitter: notice 12.89 m -> aim/tele/spit x2 (both seeds missed the sidestepper) -> STOMP on the pod -> +3.
  * strike:podspitter: PUNCH -> defeat 'punch' -> +3.
  * slagcrab: hop from 3.3 m -> SHELL + CLONK -> tele/snap (backed off) -> recover -> POUND beside -> FLIPPED -> POUND
    -> defeat -> +3.   * emberimp: cackle -> 4 crouch(flare)/hop cycles toward Nim -> POUND as it landed -> defeat
    -> +2 (its drop).   * strike:slagcrab: PUNCH -> defeat 'punch' -> +3.
  * skater: tele -> slide (sidestepped, no bump) -> spin -> dizzy -> STOMP -> +3.
  * snowcub: clap -> windup -> shove: the ball ROLLS (frame r0344_09) -> sidestepped -> watch -> sulk -> scoop ->
    POUND -> +3.   * strike:snowcub: its ball HIT Nim (ballHit) -> cheer -> PUNCH x3 -> defeat 'punch' -> +3.
  * sentry: track -> tele (beam) -> fire -> cool -> POUND -> +3.
- (record found at resume 3, not logged before) SLAGMAW DEFEATED in the 02:01 ember rerun (fixed bot policy, code before
  the broadphase fix): intro -> 3 x (dark bomb -> POUND beside it -> bombKicked into the grate) hp 3->2 (f3724) ->2->1
  (f4351) ->1->0 (f4871); said intro/hurt1/phase2/hurt2/phase3/defeat; defeat 3.42 s -> bossDown -> trigger 'boss' ->
  crest present -> taken (crest counter +1, game 'clear'). Frames r0201_10..24.

## RESUME 3 (2026-10-01 06:5x, one browser at a time)
- The shared :8788 server (started 09-29, BEFORE the backlog-256 fix) refused module loads under load: the first boot
  sat 675 s on ERR_CONNECTION_REFUSED. cr_arena.py gained `--port`; every run below uses a private serve_nocache.py on
  :8817. Box: 77-94 % CPU, 34-43 chrome processes (other workflows); 56-502 ms per hand-stepped game frame.
- PUFFER POP AT THE APEX (07:15, frames r0715_01..05): notice 4.97 m -> inflate -> puffed (collider top 1.44 m) ->
  each try on a FRESH puffed cycle: jump on -> BOUNCE (hero vy 19.06, apex 6.94 m; a triple jump peaks at 3.58 m) ->
  air control holds him over the ball -> at the top of the bounce POUND. Tries 1-3 bounced but drifted off the ball
  (no pound: the air floor keeps ~half the launch speed, so a hero who lands on the ball moving keeps moving); try 4
  bounced, came down on the ball again, and at the second apex (5.52 m over the top, vy 0.92, 0.02 m off centre,
  ball 'puffed' at 1.63 s) POUNDED -> defeat 'pop' -> coins +3 -> respawned after 9.57 s.
- GYRARCH run 3 (07:15, 300 s cap, 55.9 ms/frame): 45 boardings, 169 s on gears, 12 leaps -> 2 CROWN POUNDS
  (hp 3->2 f6396, 2->1 f15962), not defeated. The leap log split it cleanly: the 3 leaps that ran up in the VENT took
  off at 5.7-6.0 m/s from 3.06-3.71 m and 2 pounded the core (the miss left from 3.71 m); the 9 that started in
  'fire' took off on frame 1-4 at 6 m/s SIDEWAYS (still sidestepping the bolt) and never came within 3.2 m.
  Policy fixed (harness only): start a leap only from a settled stand, jump on the speed TOWARD the crown (>= 5 m/s)
  from <= 3.35 m, abort a run-up that cannot get there. Rerun queued after the slagmaw rerun.
- SLAGMAW DEFEATED ON THE CURRENT CODE (07:51-08:11, frames r0751_01..15, 357 ms/frame): intro toast + line ->
  lobTele rings -> lob -> a bomb cools DARK -> POUND beside it -> bombKicked into the grate: hp 3->2 (f565), phase2
  line + fire ring (hopped) -> kick -> 2->1 (f1193), phase3 line + march -> kick -> 1->0 (f1714) -> defeat line ->
  defeat 3.42 s -> bossDown -> trigger 'boss' -> crest present -> walked to it -> crest counter +1, game 'clear'.
  Said intro/hurt1/phase2/hurt2/phase3/defeat; fight 25.8 s; 0 bumps. (The carry route — lift a dark bomb with the
  action key and throw it into the grate — was proven in ember run 1, hp 3->2 at f2974.)
- GYRARCH run 4 (08:12-08:42, frames r0812_01..13, 95 ms/frame): the run-up leap works — 2 leaps, 2 crown pounds
  (take-off 6.96 / 5.47 m/s toward the crown from 3.25 m, pound 0.65 / 0.61 m off the core, 0.55 / 0.46 m over the
  deck): hp 3->2 at f1597 (27 s into the fight), 2->1 at f4085 (68 s). Then 236 s of phase 3 on the gears with NO
  leap: the bot's "settled" gate compared the hero's velocity with the gear's linVel, but player.vel is relative to
  the deck (collide.js carryOn moves him by linVel in position), and a phase-3 gear near its peak moves ~1.9 m/s, so
  the gate never opened. Fixed to the hero's own speed (< 1.5 m/s); rerun queued.
- GYRARCH run 5 (08:48-09:28, frames r0848_*, 131 ms/frame), with the deck-relative speed gate: again 2 leaps, 2 crown
  pounds (hp 3->2 f1597 — the same frame as run 4: the fight is deterministic — 2->1 f6469), then ~196 s of phase 3
  on a gear with NO opening. Not the bot: the GAME. Modelled (scratch gyr_timing2.py, the boss state machine + the
  gear clock, the bot's gate): phase 3 alternates a 7.09 s sweep cycle and a 5.0 s plain one = 12.09 s, two 6.0 s
  gear periods, so a rider's gear peak and the vent RESONATE — over 80 start phases x 3 gears a one-gear rider
  could get 0 windows in 240 s (phases 1-2: first window <= 18.7 s, gaps <= 21.3 s). FIXED in bosses.js:
  GY_TC[2] 6.0 -> 5.0 s (worst first window 17.7 s, gaps <= 20 s, >= 22 windows per 240 s). Phases 1-2 untouched.
  modulecheck 71/0, `node _harness/_cr_smoke.mjs` SMOKE OK 12/12 after the change. Committed b48e2ef4.
- GYRARCH DEFEATED (run 6, 09:50-09:59, frames r0950_01..17, 34 ms/frame): intro toast + line; phase 1 ride ->
  run-up leap in the vent (6.96 m/s from 3.26 m) -> crown POUND 0.65 m off the core -> hp 3->2 (f1597), hurt1 +
  phase2 lines; phase 2 leap (6.51 m/s from 3.31 m) -> pound -> 2->1 (f6457), hurt2 + phase3 lines, floor sweeps
  (hopped / ridden over); phase 3: one leap landed on the crown 1.17 m off the core (no pound), the next (5.41 m/s
  from 3.09 m, pound 0.60 m off) -> 1->0 (f12760) -> defeat line -> defeat 4.02 s (it sinks, the gears settle to
  the floor) -> bossDown -> trigger 'boss' -> crest present -> walked to it -> crest counter +1, game 'clear'.
  Said intro/hurt1/phase2/hurt2/phase3/defeat. 5 leaps, 0 leap fails, 3 pounded, 3 hit; fight 209.5 s game time.

## REGRESSION — the five original critters (gnasher, bumbler, skitter, warden, fen)
A/B on frozen snapshots that differ ONLY in this lane's files: `games/_bisect/s1crfin_new` = HEAD ab3368db's
runtime (git archive), `games/_bisect/s1crfin_base` = the same with runtime/entities/ from 2a51c2c2 (= c55df6df~1,
before the lane's first entities commit: critters.js reverted, creatures.js + bosses.js absent). Served by a private
serve_nocache.py on :8817, `?quality=low&autoscale=0`, headless, one browser at a time. (The GY_TC fix above came
later and touches only Gyrarch, which none of these courses place.)
1. BIT-EXACT TRACE (`_harness/_cr_trace.py`, scratch): per course, course.reset() + clock 0, the hero on the spawn
   and each checkpoint, 900 hand-stepped frames of course.update(1/60) + player.update(1/60), every original
   critter's pos / yaw / linVel / clock / state / hp / collider boxes + the hero's pos folded into an FNV-1a hash
   per frame. keep (fen x2), verdant-1 (gnasher 1, bumbler 3, skitter 2, warden 1), ember-1 (bumbler 3, skitter 2,
   warden 1), azure-3 (gnasher 1, bumbler 2, skitter 2, warden 1): 24 stations, 24/24 hashes IDENTICAL base vs new
   (and every 60/300/600/900-frame mark), 0 deaths, 0 errors, 0 console errors. The hashes move every mark (the
   bumblers walk, the skitters fly): the trace is live, not a constant.
2. LOOPCHECK (`_harness/_cr_loopwrap.py` = loopcheck.py unchanged with widened setup budgets; keep + the three
   courses + gates): base 297/303, new 300/302. 296 rows have the same pass/warn; the 8 that differ are all
   WALL-CLOCK rows under the loaded box (77-94 % CPU): "respawn completes (<= 950 ms ceiling)" (base 2024 / 1799 /
   1179 / 1211 ms fail where new passes; ember-1 cp1 the other way, 2570 ms) and "the game clock advanced 1.5 s"
   (engine.elapsed stalled 20 s — present in whichever run stalled: base keep cp4 + ember-1 crest-boss, new ember-1
   cp1). The 36 detail differences after stripping wall-clock numbers are live-loop timing: the sweep's end clock
   (21.6 vs 21.7), camera lens coordinates +-0.01 m, a station on a mover 0.13 m along its path, coinsBest 4 vs 3
   (coins the live loop collected). Every sweep (20 s per checkpoint, 90 s per crest station), every determinism
   row ("hazards bit-identical at t=5.0 s") and every spawn / collect / save row passes in BOTH, with 0 warnings
   (no critter crush) and 0 page errors. Verdict: no behaviour difference; the five original critters are unchanged.

## STATUS (final, 2026-10-01) — what stage 2 builds on

Files: `runtime/entities/creatures.js` (Creature base + the 8 enemies), `runtime/entities/bosses.js` (Boss base +
the 4 realm bosses), `runtime/entities/critters.js` (+49 / -1 lines: the header comment, two imports, and a block at the bottom —
ROSTER_KIT, the registry spread, exports CRITTER_ROLES / CREATURE_INFO / BOSS_INFO / ROSTER_CLASSES; no class body changed).
Arena harness (dev only): `_harness/cr_arena.js` (one arena per realm), `cr_arena.py` (driver; `--port` for a private
serve_nocache.py), `cr_scenarios.js` (one closed-loop proof per kind), `cr_bot.js` (real-key bot).

### Placing them (course def `critters: [...]`, or a mission's `add.critters`)
Every roster kind reads: `kind`, `p:[x,y,z]` (or `path[0]`), `yaw` (CONTRACT yaw, 0 faces -Z), optional `name`,
`notice` (m), `coins`, `respawn` (s; 0 = stays down until the course resets), `color` (body tint), `range` (leash m,
default 9: burrower / slagcrab / emberimp). `CRITTER_ROLES[kind]` = `{realm, name, role:'enemy'|'boss'|'miniboss'|'npc'}`.

| kind | realm | fields it reads | how Nim beats it | drop |
|---|---|---|---|---|
| burrower | verdant | `p`, `range` (tunnel leash) | sidestep the trembling ring (the pop tosses you), STOMP it while it is dazed; a pound near a running mound flushes it out; punch/kick | 3 |
| podspitter | verdant | `p`, `yaw` | walk out of the marked ring; STOMP the pod (single-jump height) or pound its root; punch | 3 |
| slagcrab | ember | `path` (+`loop`, `speed` 1.2) or `p`, `range` | a jump at it shells it up (clonk); bait the snap, then stomp it recovering, or POUND beside it -> flipped -> stomp/pound; punch | 3 |
| emberimp | ember | `p`, `range` | its touch burns (shove); STOMP or POUND it as it lands a hop; punch | 2 |
| skater | rime | `path` (+`loop`, `speed` 1.1) | sidestep the belly slide; STOMP it while it sits dizzy; punch | 3 |
| snowcub | rime | `p`, `yaw` | sidestep the rolling ball; STOMP it any time or POUND beside it; punch | 3 |
| sentry | azure | `path` (+`loop`, `speed` 1.4): its rail | step out of the aim beam before the bolt; STOMP the dome or POUND beside it; punch | 3 |
| puffer | azure | `p` or `path` (+`loop`, `speed` 0.9), `hover` (m, 1.2), `power` (bounce apex, 5.5) | puffed it is a BOUNCE PLATFORM (higher than a triple jump); POUND it while puffed (from the top of a bounce) = POP; deflated, stomp it; punch when not puffed; floats back after 10 s | 3 |

Bosses read: `kind`, `p`, `yaw`, `arena:{c:[x,z], r}` (the ring: it wakes when Nim enters, sleeps 3 s after he
leaves r+4 with hp kept), `hp` (3), `title`, `lines:{intro,hurt1,phase2,hurt2,phase3,defeat}` (overrides),
`trigger` (default `'boss'`), `color`. The course must carry a crest `{id, type:'boss', spawnAt:[x,y,z]}`:
collectibles.trigger('boss') spawns it when the defeat animation ends.

| kind | realm | extra fields | how Nim beats it (3 hits) |
|---|---|---|---|
| bramblehide | verdant | arena r 11 | out of the slam ring, then POUND the glowing BUD while the tail is stuck; phase 2 adds a thorn volley (5 rings), phase 3 slams twice |
| slagmaw | ember | arena r 11 | a slag bomb lands hot, then cools DARK: POUND beside it (it flies back into the grate) or PICK IT UP (action key) and THROW it at Slagmaw; phase 2 adds a fire ring (jump it), phase 3 marches |
| hoarhorn | rime | `floe:{half, depth, y}` (`false` = no floe), arena r 8 | sidestep its belly charge near the lip; while it TEETERS, stomp / pound beside / punch it into the sea; phase 2 frost breath, phase 3 double charge |
| gyrarch | azure | `hover` (6.2), arena r 11 (its 3 gears orbit inside) | ride a gear up, take a RUN-UP across it and leap onto the crown while it VENTS, POUND the core; a closed crown zaps; phase 2 fans 3 bolts, phase 3 adds a floor sweep |

### Interfaces stage 2 needs
- **Boss flag**: every boss has `isBoss === true`, `hp`, `hpMax`, `phase`, `engaged`, `hud {type,name,hp,hpMax,phase}`,
  `displayName`, `title`, `said[]`, `arenaC`, `arenaR`. `game.js _findWarden` matches kind 'warden' ONLY (not this
  lane's file): add `|| c.isBoss` there and the HUD hp bar plus the existing mood bridge (`audio.setMood('boss')` ->
  the recorded boss track, released 4 s after the mood drops) light up for every realm boss.
- **Boss events** (`boss.events.on(name, fn)`): `'intro'(boss)`; `'say'(key, line, boss)` (also toasted through
  `ctx.say` or `game.hud.toast`); `'hit'(hp, boss, how)`; `'state'(s, boss)`; `'defeated'(boss, 'boss')` at the START
  of the defeat animation; `'bossDown'(boss)` when it ends, the same frame as `'trigger'('boss', boss)` (course
  trigger -> the boss crest). Per boss: bramblehide `'stuck'`, slagmaw `'bombKicked'` / `'bombHeld'` / `'bombThrown'`,
  hoarhorn `'teeter'` / `'pushed'`, gyrarch `'vent'`. Bosses never emit `'down'` (game.js toasts WARDEN DEFEATED on it).
- **Music**: no boss calls `setMusicMood` itself. Wire it from the events: `'intro'` -> `setMusicMood('boss')`,
  `'bossDown'` -> `setMusicMood('course')` (then the crest's `'fanfare'`); or rely on the `_findWarden` bridge above.
- **Enemy events**: `'notice'(c)`, `'state'(s, c)`, `'defeated'(c, how)` (how = stomp | pound | pop | punch | kick |
  slidekick | dive | throw), `'coins'(n, pos)` (course.js turns it into ONE dropCoins), `'bump'(c)`, `'lost'(c)`,
  plus `'clonk'` (slagcrab), `'spit'` (podspitter), `'fire'` (sentry), `'ballHit'` (snowcub), `'bounced'` (puffer).
- **Strikes** (the hero lane's `controller.strikeAt`): every roster kind and boss implements
  `onAttack(player, pos, kind, dir)` (preferred by strikeAt) -> `onStrike(player, verb, pos, dir)`; verbs normalised
  to punch / kick / slidekick / dive / throw. `hitRadius` (strikeAt's reach pre-filter; default 0.6 when absent, which
  the 8 enemies use): bramblehide 6.6 (the bud lies ~5.6 m behind the hips), slagmaw 2*(arenaR+1) (its bombs lie
  anywhere in the ring; onStrike checks each), hoarhorn 1.9, gyrarch 1.6.
- **Stomp / pound**: `course._detectStand -> onStand(player)`, `course.onPoundLand -> onPound(player, pos)`, and the
  controller's own `_notifyPound(groundCollider)` -> `onPound(player, collider)` for the critter under a pound (the
  puffer pop and the Gyrarch crown pound arrive this way).
- **Carry**: Slagmaw's dark bombs are carry-contract objects, registered through a dynamic import of
  `player/carry.js` (a missing carry.js never breaks the boss).
- **World probe**: the roster raycasts the course broadphase (`Creature._cast`, its own colliders parked for the
  call); the five original critters keep their ctx untouched.

### Proven in the arena (real keys, hand-stepped game.update(1/60), frames read) — on the final code
| kind | run / frames | the proof |
|---|---|---|
| burrower | verdant 03:37, r0337_01-05 | notice -> tunnel 7.97 m -> tele under Nim -> pop TOSSED him -> dazed -> 2nd tele sidestepped -> STOMP -> +3 |
| podspitter | verdant 03:37, r0337_06-12 | notice -> tele ring -> 2 seeds sidestepped -> STOMP; strike: PUNCH -> +3 each |
| slagcrab | ember 03:42, r0342_01-05, 10-11 | clonk off the shell -> snap baited -> POUND -> flipped -> POUND -> +3; strike: PUNCH -> +3 |
| emberimp | ember 03:42, r0342_06-09 | cackle -> 4 flare/hop cycles toward Nim -> POUND as it landed -> +2 |
| skater | rime 03:44, r0344_01-05 | tele -> slide sidestepped -> spin -> dizzy -> STOMP -> +3 |
| snowcub | rime 03:44, r0344_06-13 | windup -> the ball ROLLS -> sidestepped -> sulk -> POUND -> +3; strike: ballHit -> PUNCH -> +3 |
| sentry | azure 03:45, r0345_01-04, 10-11 | track -> aim beam -> bolt sidestepped -> POUND -> +3; strike: PUNCH -> +3 |
| puffer | azure 07:15, r0715_01-05 | puffed platform (top 1.44 m) -> BOUNCE to 6.94 m -> POUND at the apex -> POP -> +3 -> back in 9.57 s |
| bramblehide | verdant 21:36, 11-27 | 3 x pound the stuck bud -> defeat -> crest taken |
| slagmaw | ember 07:51, r0751_01-15 | 3 x pound beside a dark bomb (kicked into the grate) -> defeat -> crest taken (carry/throw route: ember run 1) |
| hoarhorn | rime 01:20, r0120_01-18 | 3 x teeter -> pound/push -> dunk -> defeat -> crest taken |
| gyrarch | azure 09:50, r0950_01-17 | 3 x ride a gear, run-up leap in the vent, crown POUND -> defeat -> crest taken |
(Bramblehide and Hoarhorn were fought before the broadphase fix 816f7616; they read the floor through `_groundY`
only, and the arena floor is flat at the fallback height, so the fix cannot change those fights. Slagmaw was refought
after it and fought the same: 3 hits, 25.8 s.)

### Residuals (outside this lane's files, or information)
- game.js `_findWarden` sees kind 'warden' only: realm bosses get no HUD hp bar and no automatic boss music until
  `|| c.isBoss` is added there or stage 2 wires `setMusicMood` from 'intro' / 'bossDown' (see Interfaces).
- No shipped course places a stage-1 creature or realm boss yet: that is stage 2 (placement fields above).
- Performance is information: the arena measured 34-502 ms per hand-stepped frame while other workflows held the box
  at 77-94 % CPU (34-43 chrome processes); the course sim alone (trace) runs 900 frames x 6 stations in 0.5-8.6 s.
- The puffer's pop needs a hero who lands on the ball slowly: the air floor (AIR_KEEP_FRAC 0.45, movement feel, not
  touched) keeps ~half the launch speed, so a fast landing bounces him off sideways (tries 1-3 of the 07:15 run).
