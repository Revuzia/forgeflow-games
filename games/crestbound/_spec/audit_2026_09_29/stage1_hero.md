# Stage 1 — HERO lane (verbs, animation, voice) — PROGRESS

Owner files: runtime/player/hero.js, runtime/player/controller.js, NEW runtime/core/voice.js,
NEW runtime/player/carry.js. Nothing else. Probe scripts are new `_harness/_s1h_*.py` files.

## Status log
- 2026-09-30 start: read CONTRACT.md, HARNESS_NOTES.md, PLAN.md, sm64_bar.md (sections 1 + 7).
- Read controller.js (3419 lines), hero.js structure, critters.js hooks, input.js, game.js wiring.

## Facts found (quoted from the tree, this session)
- input.js has NO attack/grab action (`ACTIONS` = jump crouch dive pound orbit* recenter peek
  interact pause restart toCheckpoint mute fullscreen dev camToggle). input.js is not this lane's
  file, so the verbs ride the EXISTING bindings the SM64 way: the DIVE button (KeyF / KeyX, pad X)
  is the "B button" — punch at rest, dive at speed, pick up near a carryable, throw while carrying.
  The controller also honours `input.attackPressed` / `input.grabPressed` if the input lane ever adds
  them (duck-typed), so a dedicated key needs zero controller changes.
- Critter hooks (critters.js:11): `onPound(player, pos)`, `onDive(player)`, `onStand(player)`.
  NOBODY called `onDive` before this lane (grep: only the definitions). physWorld (game.js:415)
  exposes `critters`, `scene`, `game`, `course` to the Player.
- Gnasher `onPound` is the POST pound (3 frees it) — punches must not count as post pounds, so the
  gnasher is skipped by the attack fallback (only an explicit `onAttack` would reach it).
- Warden `onPound` only lands while `dizzy`, on the back — a punch/kick at the dizzy back is a hit.
- feelcheck walls: kick wall 10 m tall; kick shaft 16 m tall (hero tops out ~14.1 m, so the ledge
  window [feet+0.10, feet+1.80] never reaches the 16 m lip) — ledge grab cannot move a feel row.
- heroshots.py has a HARD-CODED STATES list (not the controller's) and no `--headless` flag
  (headless is its default). New states are shot by `_harness/_s1h_verbshots.py`, which imports
  heroshots' own SEIZE/FINDSPOT/POSE JS so the capture method is identical.

## Design (in progress)
- Attack button (dive binding): grounded + speed < dive.minSpeed -> punch1 -> punch2 -> kick
  combo; crouch held + attack at speed >= dive.minSpeed -> slideKick; airborne + below the air-dive
  speed -> airKick; otherwise the unchanged dive. Near a carryable -> pick up; carrying -> throw.
- Ledge grab: airborne, FALLING, fresh wall contact, heading into the wall, lip in
  [feet+0.10, feet+height+0.30], lip walkable (n.y >= 0.75), stand spot above it clear -> hang
  (or a quick mantle if the lip is within 0.95 m of the feet). Hang: jump / stick-in = climb,
  stick-away / crouch = drop, stick-sideways = shimmy along the lip (re-probed every substep).

## RESUME 2026-09-30 (run 2) — what the tree holds (verified this run)
- esbuild parses all 4 owned files; `node _harness/modulecheck.mjs` -> 71 modules, 0 failing.
- controller.js: +1093 lines — ATK table, punch1/punch2/kick combo, airKick, slideKick (+hop),
  ledgeHang/ledgeClimb (grab, mantle, shimmy, drop, re-probe), pickup/throw/put-down, hurt via stun(),
  strikeAt() dispatch, voice forwarded from `_ev`. All 9 new states in STATES.
- hero.js: +720 lines — poses for every new state, hard-landing 3-point, celebrate (crest, via
  game.state==='clear'), overlays: turn-lean/shuffle, carry, air-throw, hurt, look-at, post-hardland
  head shake, skid chatter, idle stretch/sit/doze, shiver (rime/snow/ice), pant (ember), squint.
- voice.js (583 lines) and carry.js (605 lines) complete.
- `_harness/_s1h_verbdrive.py` written (13 tests) but NEVER RUN before the limit.
- Next: bootcheck keep -> COMMIT -> feelcheck -> verbdrive -> inputcheck -> heroshots.

## Run 2 log
- COMMITTED 64d1367f (controller, hero, voice, carry, this note) after
  `bootcheck.py --headless` on keep: "VERDICT: BOOTS CLEAN", 0 console / page errors.
- HARNESS INFRA (measured): the shared `serve_nocache.py 8788` refuses module requests under the
  80+ Chrome load (failed requests: RenderPass.js / ShaderPass.js / UnrealBloomPass.js
  `net::ERR_CONNECTION_REFUSED`; its ThreadingTCPServer has the default listen backlog of 5).
  A private server is needed. Script-file servers from this lane die after ~40-50 s with exit
  code 127 (no traceback; cause unknown, three tries); an inline `python -c` server with
  `request_queue_size = 256` on 127.0.0.1:8964 survives (polled 100 s). Use it.
- `_harness/_s1h_run.py <gate> ...` runs an existing gate unchanged with (a) leave_title timeout
  >= 600 s (the 45 s wall-clock deadline false-fails: feelcheck "never left the title (state=keep)")
  and (b) `--vclock`: a virtual clock injected at the top of MEASURE_JS — each real animation frame
  advances game time exactly 1/60 s and performance.now() reads the same clock.
- feelcheck --headless (real clock, 85 Chromes on the box): 40 OK, 5 FAIL — pound_hang "no hang
  phase observed (state crouch)", pound_fall 0.19, poundjump_apex 1.909 (states jump1,fall,land),
  coyote_late, surface_hop_dry "0 of 3 rising frames". These are the rows HARNESS_NOTES documents
  as load artifacts (a press/release collapsing into one frame); vclock run pending to decide.

## THE CARRY CONTRACT (runtime/player/carry.js) — for stage 2 and the creatures lane
An object is carryable by Nim when it exposes:
- `carryable: true` (a getter is fine; false refuses for now), `pos: THREE.Vector3` (world centre;
  the carrier writes it while held), `onPickup(player) -> bool` (false refuses; stop your own
  physics/AI — the carrier owns `pos` from now on), `onThrow(player, vel)` (released with a world
  velocity, a SHARED vector — copy it; you own the flight).
- optional: `carryRadius` (default 0.45), `carryHeavy` 0..1 (slows the carrier, default 0.2),
  `carryHoldY` (default 1.95), `onCarry(player, holdPos, yaw, dt)` (default: pos.copy(holdPos) and
  mesh.position/rotation.y), `onDrop(player, pos)` (crouch while carrying sets it down; absent ->
  onThrow with zero velocity), `onStrike(player, kind, pos, dir) -> bool` (a punch/kick/thrown
  object hit it), `held` (true while carried), `course` (retired when that course unloads),
  `update(dt, world, player)` (ticked by the Player via updateCarryables), `dispose()`.
- Discovery (allocation-free): `registerCarryable(obj)` / `unregisterCarryable(obj)`; OR be in
  `world.critters` with `carryable === true`; OR be in a `world.carryables` array.
- Built-in proof: `spawnCrate(playerOrWorld, [x, y, z], {size, respawn, yaw, theme})` — a wooden
  crate (two merged draws) that rests, gets nudged, is carried overhead, thrown in an arc, set down,
  breaks on a hard impact or on a creature (and strikes it), and respawns at home.
- Already adopted: bosses.js Slagmaw bombs (`_carryHandle`), creatures.js `onAttack`/`onStrike`.

## STRIKES — how the verbs reach creatures (controller.js `strikeAt`)
`player.strikeAt(x, y, z, r, kind, dirX, dirZ, source)` offers a blow to every critter within
`r + (c.hitRadius ?? 0.6)`: `c.onAttack(player, pos, kind, dir)` if defined (truthy = counted),
else the EXISTING entry points — `onDive(player)` for 'dive'/'slideKick', `onPound(player, pos)`
at the fist/boot/crate for everything but 'dive' (never the gnasher: its onPound is the POST pound).
Kinds: punch1 punch2 kick airKick slideKick dive throw. Carryables get `onStrike`.
