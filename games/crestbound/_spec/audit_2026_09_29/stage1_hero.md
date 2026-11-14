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

## Proofs (run 2)
- feelcheck --headless via `_s1h_run.py feelcheck --vclock` (private server 127.0.0.1:8964):
  "VERDICT: FEEL OK (0 failing)" — apex1 1.911, apex2 2.600, apex3 3.578, longjump 7.428 m,
  backflip 3.221, sideflip 3.007, wallkick_vy 12.000, pound_hang 0.200 s, pound_fall 40.0,
  poundjump 2.882, coyote early YES / late NO, surface_hop_dry YES. Log: _harness/_s1h_feel_vclock.log.
  (The real-clock run on the loaded box: 40 OK, 5 FAIL — the documented load artifacts.)
- reachcheck.mjs: "14 registered courses: 14 authored, 0 failing" RESULT OK. tuning.js untouched.
- inputcheck --headless: 37 PASS, "0 of 37 checks failing". Log: _harness/_s1h_inputcheck.log.
- `_s1h_verbdrive.py` (REAL KeyboardEvents through input.__test.press, hand-stepped 1/60 s):
  combo (punch1 -> punch2 -> kick), punch (verdant-1 bumbler squished through onPound, +4 coins),
  ledge (fell short: grabbed at feet 1.83 under a 3.20 lip, climbed, standing at 3.20),
  shimmy (1.575 m along the lip, stops at the lip end x 2.992, crouch drop -> fall, NO pound),
  mantle (2.20 lip, feet 1.874 -> ledgeClimb mantle, standing at 2.20), nograb (5.0 m lip, 6
  distances, 0 grabs), clear (1.20 lip: 6 of 6 jumps land on top, 0 grabs), airkick (jump1 apex
  1.911 = untouched), slidekick (crouch-run 6.4 -> 10.46 m/s, slideKick -> land), carry (pickup,
  carry-walk 5.55 m/s, throw, crate flew 4.84 m and broke), putdown (crate set down 0.78 m ahead
  at rest height), throwhit (thrown crate squishes a bumbler), hurt (bumbler walks into Nim:
  hurtT 0.55, voice 'hurt' 1), voice (offline f0 jump1 304 < jump2 359 < jump3 405 Hz).
- Bugs found BY the proofs and fixed (commit 0b22a284): slide kick was demoted to 'fall' the
  substep it left the ground (walk-off rule); a crouch that let go of a ledge also started a
  ground pound; `__test.teleport` (used by launch.js) kept a ledge grip; strikes now also reach
  a creature's `onStrike`. Commit (hero.js): STRIKE_LAMBDA 38 — at the old 14 the jab was at
  ~45 % extension on its hit frame (portrait: mitten at belt height); now visibly extended.
- `_s1h_clipshots.py` (heroshots' own SEIZE/POSE): 39 portraits of every new clip,
  _shots/stage1_hero/clips/ (+ _sheet*.png contact sheets). READ: punch side views show the jab
  and the cross extended, kick/air kick/slide kick legs out, ledge hang both arms up (front view;
  the behind view hides the far arm behind the head), pickup/put-down/carry overhead/throw,
  hard landing, skid, turn shuffle, hurt recoil, look-at (lookW 1), celebrate crouch/spin/pump,
  stretch, sit, doze, shiver, cold sit (knees hugged), pant, brow wipe.

## Final state (run 2, 2026-09-30)
Commits: 64d1367f (all lane work), 0b22a284 (proof-found controller fixes), hero STRIKE_LAMBDA,
voice budget ring, voice gate cleanup. Every commit preceded by modulecheck 71/0 and
`bootcheck --headless` on keep "BOOTS CLEAN".
- FINAL feelcheck (vclock, on the committed controller): "VERDICT: FEEL OK (0 failing)" —
  _harness/_s1h_feel_final.log. Same numbers as the first vclock run.
- FINAL verb driver: 14 of 15 PASS in one pass (_s1h_verbdrive_final.log); `punch` failed in that
  pass because the setup stood Nim 1.15 m from a walking bumbler for 30 frames, inside its contact
  radius, so the bumbler's hit stunned him and the stun cancelled the punch (designed: a hit
  interrupts a strike). Setup changed to stand on the bumbler's path at 1.3 m: punch PASS (hit on
  frame 2, squished, +4 coins); re-run with throwhit, both PASS.
- voicelive: a REAL Space press -> 'jump' event -> jump1 bark (f0 299 Hz, 0.25 s) on the GAME's
  running AudioContext; analyser peak RMS 0.0411 vs 0 before the press.
- voice rate limit (`node _harness/_s1h_voicespam.mjs`): 2400 barks offered over 10 s of mashing,
  20 fired, worst 5 per 2.5 s window (the BUDGET), min gap 0.133 s; 'hurt' still gets through.
- heroshots.py (existing 33 states x 3 phases, via _s1h_run.py --base, --skip-extras): 99 shots,
  0 errors; p50 contact sheets read — no regression visible (_shots/stage1_hero/_heroshots_p50_*.png).

## Residual (named, not fixed — outside this lane's files)
- No dedicated attack/grab key: the verbs ride the existing DIVE action (KeyF/KeyX, pad X/Square)
  read by context, plus crouch (C/Ctrl/Shift, pad B) and jump. input.js could add
  `attackPressed`/`grabPressed`; the controller already ORs them in. HUD/sign text still says DIVE.
- Course data cannot place crates yet: course.js would call `spawnCrate(player, p)` for each
  `{kind:'crate', p}` and `clearCarryables(course)` on dispose (stage 2).
- feelcheck.py false-fails under load with the real clock (5 rows); recommend it adopt the
  `--vclock` injection (or hand-stepping) itself. serve_nocache.py's listen backlog (5) refuses
  module loads under the multi-lane load; recommend `request_queue_size = 128`.
- Panting is keyed to the ember realm, shivering to the rime realm or snow/ice footing — not to
  distance from a lava/ice volume.
- game.js calls `hero.celebrate(sec)` behind a typeof guard; the hero celebrates off
  `game.state === 'clear'` instead, so that call stays a no-op.
