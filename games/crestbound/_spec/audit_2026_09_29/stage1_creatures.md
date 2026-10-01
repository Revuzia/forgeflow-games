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
