# DYEFIELD — Controls contract: AIM on RMB + a special that always answers (C1–C8)

Owner (2026-09-29, playing): "SUB is E, that is great, but where is AIM and why isnt it RMB? Also i dont think the
special works."

## Findings

Both findings are verified on the shipped code, commit 8787c3e6.

**AIM does not exist.**
- There is no aim action anywhere in the game.
- RMB is bound as a second SUB key: `input.ts DEFAULT_BINDINGS.sub = ['KeyE', 'Mouse2']`.

**The special only activates on foot.**
- `combat/specials.ts stepSpecialInput` needs all of the following on the very tick of the press:
  - `intent.special`, `specialReady` and `special >= 1`;
  - no special already running;
  - `r.canFire()`.
- `runner.ts canFire()` is false in several states: slickForm (SHIFT, swimming in dye), surfacing, wallslick,
  leaping, and not tall.
- A Q press in any of those states is dropped silently, and the meter stays full.
- Sim diagnostic (`scratchpad/special/diag_special.mts`, MIST-RASP on Pier 18, real painting with refills):
  - the meter fills after 34.0 s (190.7 m²);
  - Q on foot → the special starts;
  - Q while slicked → nothing happens, and `specialReady` stays true.
- Q pressed before the meter is full gives no feedback either.

## C1 AIM action (view and input only, not the sim)

- New Action `'aim'`.
- Default bindings:
  - `aim: ['Mouse2']` (RMB);
  - `sub: ['KeyE']` only;
  - every other binding unchanged.
- **Saved-bindings migration** (`ui/settings.ts` sanitize): a saved `sub` that equals exactly the old default
  `['KeyE', 'Mouse2']` becomes `['KeyE']`, and `aim` gets `['Mouse2']`. A player-customized `sub` is kept as-is,
  and then `aim` is only defaulted to Mouse2 if Mouse2 is free.
- **Hold RMB to aim.** Pressing starts it; releasing ends it. A "toggle aim" option goes in SETTINGS, default hold,
  which is the industry norm.
- Aiming changes these, eased in about 0.15 s and eased out the same:
  - **FOV:** from the base to 0.72 × base. NEEDLE-GLINT gets a 0.5 × base scope-like zoom.
  - **Camera:** it moves in over the right shoulder, closing the distance by 35 % and raising the shoulder offset.
    The existing camera collision still applies.
  - **Look sensitivity:** × `aimSens` (new setting, 0.3–1.2, default 0.65).
    `CHANGED(review fix A-A4, 2026-09-30)`: a zoom stronger than the regular aim also scales the look by
    tan(h·zoom) / tan(h·0.72) (h = half the base vertical FOV; `view/camera.ts aimZoomLookFactor`): 1 for the regular aim,
    0.6715 for the NEEDLE-GLINT 0.5 scope (0.65 → 0.437 at the default), so the scope turns the picture at the regular
    aim's screen-relative speed instead of ~1.4× faster. The AIM SENSITIVITY slider scales both. View only.
  - **Reticle:** tightens, with a subtle edge vignette that respects reduce-motion.
- **No sim effect.** No accuracy or speed change. The aim ray already comes from the camera centre, so the zoom
  gives precision. Because of this every determinism hash stays identical, and bots are unaffected.
- **Touch:** an AIM toggle button (Ø 56) sits beside FIRE, where mobile shooters put their ADS button. It is added
  to the touch layout and reserve zones, and to mobile.py.
- **Where the binding shows up:** SETTINGS remap lists AIM (rebindable, like the others). HOW TO PLAY and the
  controls line show "RMB AIM · E JELLY CHARGE". The store `controls_keyboard` line updates the same way.

## C2 The special always answers (core)

- **Activation from any grounded or swimming state.** Pressing SPECIAL while slickForm, surfacing or wallslick pops
  the runner out of the slick (ending slick and surfacing at once, and dropping off the wall) and starts the special
  on the same tick.
  - CLOUDBURST throws as usual.
  - WELLSPRING leaps from where the runner is.
  - It still cannot activate while leaping, while not alive, or with a special already running.
- **Input buffer.** A press that cannot activate *yet* is buffered for 0.35 s and fires the first tick it becomes
  possible. "Yet" means mid-air, or the meter filling within the window. This is the standard action buffer.
- **Deny event.** A press with the meter not full, and not filling within the buffer, emits
  `{t: 'special', pid, id, phase: 'denied'}`.
- **Determinism.** Rules are the same for bots and humans.
  - If the bot director never presses special in those states, TURF hashes stay identical. Measure that.
  - If they do change, record the new hashes as a deliberate behaviour change, and re-run every bot gate on 3 maps.
- `CHANGED(CONTROLS core, 2026-09-30)` as built (`core/combat/specials.ts` `stepSpecialInput`, `Runner.popOut()`,
  `config.ts KITS.specialBufferSeconds` 0.35 / `KITS.specialReachPaint` 5, `match/events.ts`, `MatchWorld.stats`):
  - **Request.** `intent.special` held this tick (a held key keeps asking, as before), or a press (its rising edge) at
    most 21 ticks (0.35 s) ago that has not started anything yet. Presses and waits are per runner and are cleared by
    a respawn.
  - **Start.** Meter full (`specialReady`, `special >= 1`), alive, not leaping, no special running, and **on a
    surface**: grounded in any form (walking, slogging, slicked, surfacing) or on a wall. Slicked / surfacing / on a
    wall / not tall → `popOut()` first: the slick form and the surfacing end at once (one `'slick'` off event), a wall
    is let go (state `'air'`, no re-grab for 0.2 s), then the special starts on that tick (CLOUDBURST throws, WELLSPRING
    leaps from there). If the capsule cannot regrow (no head room) nothing changes and the request keeps waiting.
  - **Mid-air** is a "not yet" state: a tap waits and starts on the landing tick when that is within 0.35 s. A tap
    earlier than that lapses **silently** (a full meter is never 'denied'); a key held through the landing starts it on
    the landing tick. This is a change for a tall runner in the air, which pre-§C2 started the special in the air.
    `CHANGED(review fix A-A1, 2026-09-30, input layer only)`: a walk jump is airborne ~45 ticks, so the 21-tick wait
    swallowed every tap in the first ~55 % of a jump (apex included) with no start and no deny — "i dont think the special
    works" again. The human's input layer (`game.ts airSpecial`) now turns a SPECIAL press made in the air with a FULL meter
    (key tap or touch tap) into a held request — exactly the "key held through the landing" path above — until the special
    starts (the landing tick), the meter is no longer full, the runner dies or leaps, the match leaves `'live'`, or 1.5 s
    pass (`AIR_SPECIAL_TICKS` 90; a long fall never fires a stale press). The ready prompt reads "Q  CLOUDBURST · on
    landing" while it waits. The core rule above is unchanged (bots keep the 21-tick lapse; every determinism hash is
    unchanged); gated in `playtest.py --controls` (a real Q tap ≥ 25 ticks before the landing starts on the landing tick).
    A press while the human's own special runs is still `'denied'` by the core, but the view gives it no deny feedback
    (review fix A-A3: the special is active, the meter does not charge — "Charging — 0 %" was wrong).
  - **"Filling within the buffer"** is decided with a reach: short by at most one wash + 5 points
    (`specialCharge.pointsPerWash` 20 + `KITS.specialReachPaint` 5 = 25 points: CLOUDBURST ≥ 86.8 %, WELLSPRING
    ≥ 84.8 %) → the press waits; if the meter is still short when the 0.35 s run out → `'denied'` then (21 ticks after
    the press). Short by more → `'denied'` on the press tick, no wait. A press while a special runs (meter 0) or mid-leap
    is `'denied'`.
  - **Event shape:** `{ t: 'special', pid, id, phase: 'denied', x, y, z }`, the same member as the other phases (x, y, z
    = the presser's feet; the meter to show is `runners[pid].special`).
  - **Protection** (task 1's rule, unchanged): a special that starts, from the buffer or by popping out, ends it; a
    `'denied'` press does not.
  - **Bots:** the same code path; `bots/director.ts` is unchanged (it already surfaces before a sub or special). The
    measurement is `MatchWorld.stats.specialRuleEarly` / `specialRuleLate`: the runner-ticks where the §C2 rules decided
    differently from the pre-§C2 rule (`probe_bots` prints them per match). Bots **do** press in those states. Most
    often they press while surfacing, so a pop-out starts the special up to 7 ticks earlier. WELLSPRING bots also hold
    the press mid-air, and it now starts on the landing. So bot-match hashes changed; this is deliberate, and every
    match with early = late = 0 kept its old hash exactly. Every scripted hash is identical: `probe_match` TURF / FFA /
    WASHOUT, the TEAMS TURF pins, and the nav fingerprints. All bot gates were re-run: TEAMS TURF on 3 maps, FFA TURF on
    3 maps, and WASHOUT TEAMS + FFA on 3 maps. All non-timing gates PASS.
  - `CHANGED(CONTROLS skeptic fix, 2026-09-30)`: **a held key is not a new press.** `Runner.respawn()` sets
    `specialHeld = true` (the constructor calls it, so it covers the match start). A SPECIAL key held through a wash and
    respawn, or through the countdown, emitted `'denied'` on the first live tick with no new press; now a press needs a
    release first. A held key still asks every tick (the level request), so holding it with a full meter still starts the
    special (after a respawn, and on the first live tick after the countdown). Gated in `probe_kits` (2 checks: held
    through a wash + respawn, held through the countdown; both FAIL with the old `specialHeld = false` reset). The TEAMS
    TURF bot hashes did not move with it (the table below, re-measured after the fix); the FFA and WASHOUT bot hashes
    changed in the same pass for the spawn-site and score-limit fixes, so this fix's own share there is not separated.
  - **TEAMS TURF bot hashes, recorded** (orchestrator decision: C2's bot-hash change is deliberate; values measured
    2026-09-30 on HEAD 8fd2006e and on this tree at the same minute, every gate of these runs PASS on this tree):

    | invocation (`node _harness/…`) | HEAD 8fd2006e | now (C2) |
    |---|---|---|
    | `probe_bots.ts` (default lineup) seed 1 | 17b0884d-fab081a1 | e90ff836-25fd3762 |
    | `probe_bots.ts` (default lineup) seed 2 | 7b88f2e4-b3f9338c | e7df8182-95c6153b |
    | `probe_bots.ts --lineup mixed` seed 1 | 4501b469-6632fc71 | 6448dd3b-b3068a65 |
    | `probe_bots.ts --lineup mixed` seed 2 | 8024bf5f-0ae9ee5c | 8024bf5f-0ae9ee5c (unchanged) |
    | `--lineup mixed --map pier18 --seeds 1,2,3` | 4501b469-6632fc71 · 8024bf5f-0ae9ee5c · 2457b950-dc0e9107 | 6448dd3b-b3068a65 · 8024bf5f-0ae9ee5c · 7d44303f-dd64d01b |
    | `--lineup mixed --map lockwell --seeds 1,2,3` | e8fdb169-f3c6a5aa · 6e5905af-6a9f3c96 · 9070459a-0765b3fa | c40cea84-e2eb7f5c · def335b5-d4a09a90 · 3defd38e-d6ba3e2f |
    | `--lineup mixed --map cinder --seeds 1,2,3` | 969c7dae-f1a4f5eb · 19174bb8-ed332578 · d987249f-4492c310 | 8a66fa36-0c8ca30f · 220338a8-6ce7458d · 0eaa160f-51fc9f3a |

    Scripted and paint / nav hashes are identical to HEAD: `probe_match` teams pier18 b2bbe68c-302ad464 /
    c5a7cddf-170d5cca, lockwell 85323a32-95b8f088 / 190e61c7-0face507, cinder ac402fba-2b8de69e / e0d4dcb3-5d72659b;
    `probe_paint`; nav fingerprints pier18 f3dc8e59, lockwell 0c3a2f9c, cinder e540d154.

## C3 Special feedback (UI)

- **Ready:**
  - a clear prompt near the reticle, "Q  CLOUDBURST" / "Q  WELLSPRING", using the actual binding or the touch
    glyph;
  - the special chip pulses;
  - a ready cue. The cue exists already; make sure it plays.
- **Charging:** the chip shows a fill bar and %, not just the reticle ring.
- **Denied** (the `'denied'` event): the chip gives a short shake, a soft deny tick sounds, and "Charging — 62 %"
  shows for 0.8 s.
- **Touch:** the SPECIAL button's ring and dimming already exist. Add the deny shake.

## C4 Gates

- **`probe_kits` (node):**
  - Q while slicked starts the special and ends the slick;
  - Q while surfacing starts it;
  - Q mid-air is buffered and starts on landing within 0.35 s;
  - Q with the meter at 95 % that fills within 0.35 s starts it;
  - Q at 50 % gives `'denied'` and no start;
  - WELLSPRING from a slick leaps.
- **`playtest.py`:** a real-key test in a live match:
  - paint until ready, with no dev charge;
  - hold SHIFT to slick, press Q → the special starts;
  - an RMB hold changes the camera FOV and the sensitivity read-back, and releasing restores them;
  - E still throws the JELLY CHARGE;
  - RMB no longer throws a sub.
- **`menus.py`:** AIM appears in the remap list, and the old saved bindings migrate.
- **`mobile.py`:** the AIM button zooms, and SPECIAL pressed while slicked starts the special.
- **Hashes:** every determinism hash is unchanged, or a documented change per C2.

## C5 Lane ownership

- **Core** (worktree chain, with the FFA spawns core): `combat/specials.ts`, `runner.ts`, `combat/kits.ts` if
  needed, `bots/director.ts` (C2 fairness), `_harness/probe_kits.ts`.
- **UI stage** (main tree, after the mobile 1.3.0 commit): `input.ts`, `view/camera.ts`, `game.ts`, `main.ts`,
  `ui/settings.ts`, `ui/menus.ts`, `ui/hud.ts`, `ui/styles.css`, `touch/controls.ts` + `touch.css`,
  `game_meta.json`, the harness browser gates.
