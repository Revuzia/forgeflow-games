# Stage 1 - lane: creatures (signature enemies + realm bosses)

Status: STARTED 2026-09-30. Owned files: runtime/entities/** (critters.js + new files),
plus harness-only files under _harness/ (the test arena data + its driver).

## Design decisions (so a usage limit cannot erase them)
- Existing critters (gnasher, bumbler, skitter, warden, fen) stay BIT-IDENTICAL: the new roster lives in
  NEW files (runtime/entities/creatures.js, runtime/entities/bosses.js) built by factory functions that
  receive the Critter base + helpers from critters.js (no ESM import cycle: the new files never import
  critters.js). critters.js only gains an exported kit object and registry lines at the bottom.
- Reward drop = `_awardCoins(n, pos)` -> course.dropCoins (same path the bumbler uses).
- Boss defeat fires `_trigger('boss')` -> collectibles spawns the `boss` crest (collectibles.js:1892 matches
  'warden-down' OR 'boss'). Bosses do NOT emit 'down' (that would toast "WARDEN DEFEATED" in game.js).
- The Warden stays registered as `warden` = the mini-boss.
- Test arena = a course def under _harness/ swapped into the page's COURSE_CACHE entry for a real course id
  (in-page only, nothing on disk changes), so every creature + boss is fought in the real game loop.

## Baseline
- loopcheck --headless verdant-1,ember-1,azure-3 BEFORE any edit: running (scratchpad loop_base.json).

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
