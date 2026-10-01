# DYEFIELD — WASHOUT contract (W1–W10)

Owner request (2026-09-29): "i know that the point of dyefield is to paint as much of the field as possible, but
also there should be a version where its vs other people with amount of kills." Scope, as the owner chose: a
kills-scored mode against bots only. Online play is not in scope.

WASHOUT is a second RULE beside TURF, the paint mode that shipped. It works in both MODES: TEAMS · 4 v 4 and
FREE-FOR-ALL. It must work on desktop and on mobile (CONTRACT_MOBILE). `CONTRACT.md`, `CONTRACT_FFA.md` and
`CONTRACT_MOBILE.md` still hold. Where this file changes one of them, the change is noted in place with a
`CHANGED(WASHOUT)` note.

**Non-negotiables**
- TURF is untouched. The rule option defaults to `'turf'`, and every existing determinism hash in `npm run probe`
  (teams and FFA) must stay identical.
- Every desktop gate and `_harness/mobile.py` must still pass.

## W1 The rule

- `MatchOptions.rule?: 'turf' | 'washout'`, default `'turf'`. Add `type MatchRule` and
  `parseMatchRule(raw, fallback)` to `core/types.ts`, beside `MatchMode`.
- **Score:** in WASHOUT a wash credited to a runner scores one point.
  - TEAMS: the crew's score is the sum of its runners' credited washes.
  - FFA: each crew is one runner, so its score is that runner's washes.
- **Sea washes:** a runner who falls into the sea is credited to the last foe who damaged them within the previous
  5 s (`lastHitBy` / `lastHitT`, recorded on every damaging hit). With nobody in that window, no one scores.
  There is no self-penalty, to keep it friendly.
- **Paint:** keeps all its gameplay: movement, slick, refill, special charge. It does not score, except as a
  tie-break.
- **Score limit:** it lives in data, in `data/weapons.json → washout`, with `teamLimit` and `ffaLimit`.
  - Tune each limit on bot-only matches (W8), so the leader reaches it in roughly 35–65 % of 3:00 matches,
    measured over seeds 1–8 on all 3 maps.
  - Write the measured distribution into the `_changes` log.
  - Reaching the limit ends the match at once through the existing `end()` path: horn, freeze, result.
  - `CHANGED(WASHOUT follow-up, 2026-09-30)`: the limit is **per map**. It lives in `data/maps.json → <map>.washout`
    `{teamLimit, ffaLimit}`; `data/weapons.json → washout` `teamLimit` / `ffaLimit` (51 / 20) is only the fallback
    for a map without its own block (or with a bad value). Core API: `washoutLimitFor(def, mode)` in
    `core/match/world.ts`; `MatchWorld.limit` is the value the match plays to.
    - Why: one value per mode reached unevenly across the maps (TEAMS 51: pier18 4/8, lockwell 8/8, cinder 0/8;
      FFA 20: pier18 8/8, lockwell 4/8, cinder 1/8).
    - The target is now **per map and mode**: the leader reaches that map's limit in 35–65 % of its bot-only
      matches over seeds 1–8 (`npm run probe:washout:tune`, which gates every map and mode and prints the pick:
      the in-band limit whose reach is closest to 50 %, a tie going to the one nearest the median).
    - Values, re-tuned on the final core code of 2026-09-30 (after CONTRACT_CONTROLS C2, the FFA spawn fixes — no mist
      rule in the unseen test, the chest at feet + `MOVE.skin`, the regenerated pier18 / cinder `ffaSites` — and the
      held-SPECIAL fix), each the tuner's pick: pier18 **52 / 23** (62.5 % / 62.5 %), lockwell **59 / 17** (50.0 % /
      37.5 %), cinder **45 / 17** (62.5 % / 50.0 %); all maps together TEAMS 14 of 24 (58.3 %), FFA 12 of 24 (50.0 %).
      The per-map distributions are in the `data/maps.json` `_changes` log. (The first tuning, measured after the
      spawn-protection fixes below, gave pier18 52 / 24, lockwell 59 / 19, cinder 46 / 18; on the final code lockwell FFA
      reached 19 in 25.0 % and cinder FFA 18 in 12.5 % of the matches, outside the band.)
- **Time:** the same 3:00 match with the same horns. At the horn the higher score wins.
- **Tie-breaks at the horn:**
  - TEAMS: the higher turf share wins, so paint is the tie-breaker. An exactly equal share is a draw.
  - FFA: fewer times washed wins, then the higher turf share. Exactly equal is a draw, with `tied` listing the
    crews.
- **Spawn protection, WASHOUT only:** for 2.0 s after a respawn, or until the runner fires, subs or uses a special
  (whichever comes first), the runner takes no damage and cannot be washed. It shows as `Runner.protectedT > 0`.
  TURF is untouched: the field does not change behaviour there, so its hashes stay identical.
  - `CHANGED(WASHOUT follow-up, 2026-09-30)` (skeptic review), what "fires, subs or uses a special" means exactly:
    - it ends only on an action that **happens**: the kit fires (a stream or burst shot, a drum roll or flick windup, a
      NEEDLE-GLINT charge), a sub is thrown, a special starts. A press that does nothing (a SPECIAL with no special
      ready, fire or sub on a dry tank, a sub on cooldown) keeps it;
    - it also ends the moment the runner **deals damage from any source**, including a CLOUDBURST or jelly thrown
      before its wash that outlives it (damage a protected victim blocks is not dealt, so it keeps it);
    - a **wash clears it** (only the sea can wash a protected runner): `protectedT` is 0 on a dead runner, and the next
      respawn grants a fresh 2.0 s.
    - Gated in `probe_match --rule washout` (dev scenarios) and `probe_bots --rule washout` (invariants over every
      bot match).
  - `CHANGED(SPAWNS)` (CONTRACT_FFA_SPAWNS §S4): "WASHOUT only" becomes **WASHOUT, and FFA in either rule**. TURF FFA
    respawns get the same protection with the same end rules; TEAMS TURF still never sets it (its hashes are unchanged).
    Gated in `probe_match --mode ffa` (both rules) and `probe_bots --mode ffa` (invariants).
- `CHANGED(WASHOUT follow-up, 2026-09-30)`: the `'score'` event is pushed **immediately after** its `'washed'` event
  (before the wash burst's `'splat'` and a `'special'` ready); gated in both probes.

## W2 Result and events

- `MatchResult` gains `rule`, `scores: number[]` (length CREW_SLOTS, indexed by crew) and `limit: number`.
  `endedBy: 'horn' | 'limit'` records how the match ended.
- `CrewStanding` gains `washes`, `washed` and `score`. In WASHOUT, standings sort by score, then fewer washed,
  then share, then crew id. `rank` follows that same order.
- New event `{ t: 'score', crew, score, pid }` on every credited wash in WASHOUT, for the HUD pop and audio.
- `MatchWorld.scores(): number[]` gives live scores for the HUD, read cheaply every frame.

## W3 Bots (`core/bots/director.ts`, rule-aware)

- In WASHOUT, bots hunt:
  - raise the weight of fight and chase;
  - engage from further out, using the kit's effective range;
  - keep painting only for mobility, refill and escape: paint targets near fights and along routes toward foes;
  - never shoot a protected runner, and do not camp spawn pads.
- They keep all the existing safety behaviour: stale path, perched, failJumpWall, the standoff breaker and the
  sea-edge care.
- **Gates** (`probe_bots --rule washout`, TEAMS mixed lineup and FFA mixed lineup, 3 maps, seeds 1,2,3):
  - no stuck bot;
  - no fight standoff longer than 5 s;
  - TEAMS: both teams score at least 5 in every match;
  - FFA: at least 6 of the 8 crews score at least 1, and total washes are at least 25;
  - deterministic (the same hash when replayed);
  - under 25 s of wall time per match.

## W4 Menus and profile (`ui/menus.ts`, `ui/settings.ts` Profile)

- **PLAY gets a RULE selector** beside MODE, with two options:
  - **TURF**, the default: "Cover the most floor"; and
  - **WASHOUT**: "Most washes wins".
- The rule persists in the Profile as `rule`: sanitized, defaulting to `'turf'`, and old saves load unchanged.
  Deep link `?rule=washout`; `?rule` is added to main.ts DEEP_KEYS and to the index.html static-card mirror.
- **Mode lines:**

  | where | TURF | WASHOUT |
  |---|---|---|
  | teams match | `'Harbor Cup • 4 v 4'` (the brief's line, exact) | `'Harbor Cup • Washout · 4 v 4'` |
  | FFA match | `'Harbor Cup • Free-for-all'` | `'Harbor Cup • Washout · Free-for-all'` |
  | no mode picked | `MODE_LINE_ALL` becomes `'Harbor Cup • 4 v 4 · Free-for-all · Washout'` | same |

  That last row covers the title, the lobby card, the static card and the page title, so every option is visible
  up front (the owner's rule from 2026-09-28). `fillModeLine` wraps only between phrases.
- **HOW TO PLAY** shows the WASHOUT rule text when WASHOUT is picked: "Washout: wash the other side. Most washes
  when the horn sounds — or the first to the limit — wins. Paint still moves you, refills you and charges your
  special."
- The profile card shows the picked mode and rule, for example "TEAMS · WASHOUT".
- `CHANGED(review fixes A-A9 / A-A8, 2026-09-30, UI only)`: HOW TO PLAY card 1 also swaps its PICTURE in WASHOUT (a
  wash — dye stream, burst, "+1" — and the two crew score chips; `HOW_ART.washout`, data-art `washout`; TURF keeps the
  court + tug bar, byte-identical). Opened from the pause card, HOW TO PLAY teaches the RUNNING match (its mode and
  rule, `Menus.setMatchRule` from main.ts), not the saved profile's pick — a deep link plays `?rule=` / `?mode=`.

## W5 HUD (`ui/hud.ts`, `ui/styles.css`)

- **TEAMS WASHOUT:** the top bar shows two big score chips around the timer, SUN n and GULF n in crew colours with
  their marks, each with a small "/ limit". The turf tug bar stays underneath as a thin tie-break indicator, with a
  small label "TURF (tie-break)".
- **FFA WASHOUT:** the FFA panel shows your washes, your rank and a live top 3 by score (name and washes).
- **On your credited wash:** a "+1" pop near the reticle, reduced-motion aware, plus the existing hit marker.
- **Spawn protection** shows as a soft shimmer ring on the protected runner (view side) and "PROTECTED" on your own
  HUD while it lasts.
- Everything fits the mobile layouts (CONTRACT_MOBILE M6) and stays clear of the touch zones.
- `CHANGED(review fixes, 2026-09-30, view only — no core, every hash unchanged)`:
  - A-A5: the FFA panel ranks exactly as the standings — score, then FEWER times washed, then turf, then crew id
    (`setScores(scores, washed)`; it used to skip the washed key, so ties named a different #1–#3 than the slate).
  - A-A6: a LIMIT ending freezes the timer at the time that was left (a horn ending still reads 0:00).
  - A-A8: the WASHOUT countdown names the objective under the digits: "WASHOUT · Most washes wins · first crew to
    52" (FFA: "first to 23"); TURF's countdown is unchanged.
  - A-A2: on phones the TEAMS WASHOUT kill-feed cap follows the gap to the GULF chip
    (`min(170px, 50vw − safe-right − 184px)`): 170 px wherever it fits, ~150 px on a 667 px phone; the verb stays
    `washed`.

## W6 Victory slate (`ui/slates.ts`)

- **TEAMS WASHOUT:**
  - the stamp "THE HARBOR CHOSE A COLOR." (the brief's line) above the two final scores;
  - a scoreboard of all 8 runners with name, kit icon, W (washes) and D (washed), grouped by crew, your row
    highlighted;
  - "LIMIT REACHED" or "TIME" as the ending tag;
  - the tie-break note when turf decided it.
- **FFA WASHOUT:** 8 standings by score with W and D, the winner's podium, and the draw handling the same as FFA
  TURF.
- It fits every M0 mobile viewport and the desktop viewports.

## W7 Audio and juice

- The existing stingers.
- A short "score" cue for your own credited wash: reuse the kill-confirm sound if it exists, else a pitched variant
  of the hit sound. No new asset spend.
- Confetti as today.

## W8 Harness gates

- **`probe_match`** (node):
  - WASHOUT teams and FFA: the limit ends the match early with `endedBy 'limit'`;
  - the horn ending uses the tie-breaks: construct ties with dev hooks;
  - sea credit within 5 s, and no credit after it;
  - spawn protection blocks damage for 2 s and ends when the runner fires;
  - TURF hashes are unchanged;
  - TURF has no protection and no score events.
- **`probe_bots --rule washout`:** the W3 gates, then the limit tuning run (W1) with its distribution printed.
- **`playtest.py --rule washout`**, TEAMS and FFA on 1 map each, with real input:
  - the HUD score chips update when a wash is credited: a bot wash counts;
  - the human's own shots can wash a bot within the fight window: dev placement is allowed for setup only;
  - the victory slate shows the scoreboard with W and D, and PLAY AGAIN works.
- **`menus.py`:** the RULE selector (aria-checked, persisted), the mode lines, and the HOW TO PLAY text.
- **`layoutcheck.py` and `mobile.py`:** the WASHOUT HUD and slate on the 4 phones and the desktop sizes. A touch
  player can score: FIRE on a foe in range washes them.
- **Desktop regressions:** probe (hashes), bootcheck teams and FFA, TURF playtests on 2 maps, menus, padcheck and
  bootguard.

## W9 Store copy and docs

- **`game_meta.json`:**
  - `short_description` and `description` gain WASHOUT ("or switch the rule to WASHOUT: most washes wins");
  - the tag "deathmatch" is added.
- **README:** a RULES section; the gates list gets the new gates.
- **Version:** bump to `dyefield-1.4.0`.

## W10 Lane ownership

- **CORE lane:** `core/types.ts` (rule), `core/match/world.ts`, `core/runner.ts` (lastHitBy, protectedT),
  `core/bots/director.ts`, `data/weapons.json` (the washout block), `_harness/probe_match.ts`,
  `_harness/probe_bots.ts`.
- **UI lane:** `ui/menus.ts`, `ui/menus.css`, `ui/hud.ts`, `ui/styles.css`, `ui/slates.ts`, `ui/boot.ts`,
  `ui/settings.ts` (Profile.rule), `index.html` (the static card and deep-link mirror), `runtime/public/game_meta.json`,
  and `view/players.ts` (the protection shimmer).
- **Integration:** `main.ts`, `game.ts`, `testsurface.ts` (a read-back `match().rule`, `scores`,
  `standings[].washes/washed`), and every harness except probe_match and probe_bots.
- **Calls across the lanes:** `MatchWorld.rule`, `MatchWorld.scores()`, the `MatchResult` / `CrewStanding` fields
  in W2, the `'score'` event, `Runner.protectedT`, `Profile.rule`, and the HUD/slate entry points:
  - `hud.setRule(rule, limit)` and `hud.update(...)`, which read `world.scores()` through the Game;
  - `slates.victory(...)`, which reads `result.rule` and `result.scores`.
