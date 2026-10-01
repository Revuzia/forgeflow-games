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
