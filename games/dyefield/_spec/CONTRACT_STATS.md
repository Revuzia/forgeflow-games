# DYEFIELD — STATS contract (S0–S14)

Owner ask (2026-10-01): "As this game is on forgeflowgames now, im assuming players that are logged in will have STATS
based on their game play" → "both, right away." (the second half of the ask, online match-up, is the ONLINE lane's
contract; this file covers stats and names the exact seam the online lane plugs into, §S9).

This file is the spine of the STATS lane. `CONTRACT.md`, `CONTRACT_FFA.md`, `CONTRACT_WASHOUT.md`,
`CONTRACT_MOBILE.md` and `CONTRACT_CONTROLS.md` still hold. Nothing here changes the simulation.

**Non-negotiables**
- The stats layer only READS the sim. `npm run probe` and `npm run probe:washout` print the same determinism hashes
  before and after (§S12 G-S3). `runtime/src/core/**` is not edited by this lane.
- Standalone play (the CDN URL), phone play and play inside the portal frame keep working with no account, no network
  and blocked storage. Outside the portal every bridge call is a silent no-op.
- $0: no new service, no paid plan, no Supabase Realtime traffic. Everything rides the portal's existing postMessage
  bridge and existing tables. The only production write is the additive achievement seed (§S7), done in the stage that
  says so.
- No PII leaves the game: no names (the LOADOUT name, bot names, online names), no user ids (the game never learns
  one), no room codes. The only identifiers are two random tokens the game makes itself (§S5).

---

## S0 What exists today (verified 2026-10-01, this session)

**The portal bridge** (`forgeflow-games/src/lib/gameBridge.ts`, read in full):
- `initGameBridge(slug, id)` runs when the player presses PLAY on the game page (`GamePlayer.tsx startGame`). The
  signed-in user is resolved asynchronously (`supabase.auth.getUser().then(...)`). Until it resolves, `currentUserId`
  is null and every bridge message below is **silently dropped**. There is no acknowledgement for any message.
- Source check: a message is accepted only from an `<iframe>` in the portal page (`f.contentWindow === event.source`).
  Replies go to that frame at its origin.
- `forgeflow:score {score}` → `submitScore(user, game, score)` when `score` is a finite number. `leaderboard_scores`
  is **one row per (user, game)**: keep-highest within the current "season week", replaced when the week label
  changes. The column is an integer (`played_leaderboards` returns `score integer`), so the game sends integers.
  `forgeflow:game_over` / `forgeflow:level_complete` with a score do the same.
- `forgeflow:achievement {achievementSlug}` → looks the row up by `(game_id, slug)` in `achievements`; if the user has
  no `user_achievements` row for it, inserts one and grants `points` XP (× the Badge-of-the-Day multiplier). Re-sending
  an unlocked slug is a no-op (two reads). **XP comes only from achievements** (bridge comment, 2026-05-06).
  - CHANGED(review) — two races in that path (read in `gameBridge.ts:191–231` and `auth.ts:134–148`, review session):
    1. `addXP` is a read-modify-write of `profiles.xp` (`getProfile` → `update xp = old + amount`). Two unlocks
       processed at the same time both read the same `xp`, and one grant is **lost**. A first DYEFIELD match can unlock
       5–8 achievements at once, so posting them back to back would lose XP.
    2. The unlock checks "already unlocked?", then inserts, **ignores the insert's error**, then calls `addXP`. Two
       posts of the SAME slug in flight together both pass the check; the second insert fails on
       `UNIQUE (user_id, achievement_id)` (migration 0003 line 92) but its XP is still granted: **double XP**.
    - A slug with no `achievements` row (not seeded yet) is dropped silently (`data?.id` is null), with no reply.
    The game works around all three (§S3.3 pacing + per-session dedupe, §S7 seed-before-deploy); the portal-side fix is
    out of scope (§S13.5).
- `forgeflow:save {data, slot}` → read-modify-write of `game_saves(user, game, slot)` through
  `mergePreservingKeys(stored, incoming)` (`src/lib/saveMerge.ts`): objects merge key by key, a key the payload does not
  mention is kept, scalars and arrays: **incoming wins**. If the read fails, nothing is written. `__replace: true`
  means "wipe" (DYEFIELD never sends it).
- `forgeflow:load {slot, _reqId}` → replies `forgeflow:save_loaded {data, _reqId}` with the stored record or `null`.
  **The portal replies only when a user is signed in** (`if (currentUserId && currentGameId)`). Signed out = no reply.
- Play time / "Recently Played": the portal writes `user_game_activity` itself (on PLAY, then every 5 min). Nothing for
  the game to do.

**The live portal DB** (read-only queries with the service key, values never printed):
- `games`: DYEFIELD is `id 53`, slug `dyefield`, status `published`,
  game_url `https://forgeflow-games-cdn.isimcha85.workers.dev/dyefield/index.html`.
- `achievements`: 85 rows over 6 games, **0 for dyefield**. XP scale: bronze 5 (22 rows), silver 15 (27), gold 30
  (26) — the tier table of migration 0003 and of the Achievements page (`bronze 5 / silver 15 / gold 30 /
  diamond 60`). Only last-circle deviates (20–100). Per-game totals: 155–455 XP over 6–25 achievements.
- `leaderboard_scores`: 1 row in total (vector-storm). `game_saves`: 1 row in total (ascendant).
  `user_achievements`: 33 rows.
- **Migration 0004 (ratings) is NOT in production.** The PostgREST schema lists exactly three RPCs:
  `find_users`, `played_leaderboards`, `seed_game_achievements` — no `report_match_result`. `match_results` returns
  `PGRST205 Could not find the table`. The production `game_ratings` table has columns
  `(id, user_id, game_id, rating, created_at)` — a different table from 0004's `(user_id, game_slug, rating, wins,
  losses, …)`, and it has 0 rows. See §S9 for what this means for online W/L.

**What the portal shows a signed-in player** (`pages/profile/+Page.tsx`, `pages/achievements/+Page.tsx`,
`pages/leaderboards/+Page.tsx`): level + XP bar (from achievements), the last 20 achievements, weekly-leaderboard
trophies, Recently Played; the Achievements page lists every game's achievements with locked / unlocked state; the
Leaderboards page ranks each played game's weekly best scores (`played_leaderboards`). **No page shows win / loss.**

**DYEFIELD today**: no bridge code at all (`grep forgeflow|postMessage|window.parent runtime/` → only an audio build
path). A signed-in player currently gets "Recently Played" and nothing else.

**Therefore, the answer to "will logged-in players have STATS":**
- On the **portal**: achievements (+ XP / level), the weekly leaderboard score, Recently Played. This contract wires
  all three.
- In the **game**: a full CAREER (matches, W/L/D per mode and rule, records, totals, per-kit / per-map wins, online
  record, achievements, recent matches), saved locally for everyone and to the player's account through the portal's
  cloud save when signed in, so it follows the account to every device.
- A portal-side W/L / rating page is **not** possible without portal + DB work (§S9.4, gated).

---

## S1 Module layout and file ownership

The STATS lane owns, and is the only writer of:

| Path (under `games/dyefield/`) | What |
|---|---|
| `runtime/src/stats/index.ts` | `Stats` facade: `create()`, `start()`, the three Game hooks (§S10), CAREER + toast handles, `window.__DF_STATS__` |
| `runtime/src/stats/types.ts` | `MatchRecord`, `CareerCounters`, `Slot`, `CloudRecord`, `LocalStore`, `StatsWorldView`, `OnlineMatchInfo`, `PortalState` |
| `runtime/src/stats/recorder.ts` | per-match accumulator: Game hooks in → one `MatchRecord` out. THREE-free, DOM-free |
| `runtime/src/stats/score.ts` | the leaderboard score (§S4). Pure |
| `runtime/src/stats/baselines.ts` | generated table for §S4 (header names the generator command, seeds, date). Pure data |
| `runtime/src/stats/achievements.json` | the 29 achievement definitions (§S6). **Single source of truth** for the game AND the seeder |
| `runtime/src/stats/achievements.ts` | imports the JSON (`with { type: 'json' }`), attaches the detectors by slug. Pure |
| `runtime/src/stats/career.ts` | buckets, slots, apply-a-record, merge, display fold, localStorage I/O (§S5). Pure except the I/O helpers |
| `runtime/src/stats/portal.ts` | the bridge client: framing detection, origin allowlist, load / save / score / achievement posts, retry, outbox (§S3) |
| `runtime/src/stats/ui/career_panel.ts` | the CAREER screen body (§S8.1), a standalone DOM module |
| `runtime/src/stats/ui/toast.ts` | the achievement toast (§S8.2), a standalone DOM module |
| `runtime/src/stats/ui/stats.css` | styles for both, built on the `styles.css` tokens (`--ink`, `--cream`, `--display`, `--body`, `--edge`, `--drop`, …) |
| `_harness/probe_stats.ts` | node probe: detectors, score, merge properties, hash invariance, baselines generator (§S12 G-S1) |
| `_harness/statscheck.py` | browser gate with the mock portal (§S12 G-S2) |
| `forgeflow-games/pipeline/seed_dyefield_achievements.py` | the seeder (§S7) |

The STATS lane does **not** edit `main.ts`, `game.ts`, `ui/menus.ts`, `ui/hud.ts`, `ui/slates.ts`, `testsurface.ts`,
`runtime/src/core/**`, `package.json` or any existing gate. It may import read-only from them (types, `TICK`,
`KIT_ICONS`, `MAP_THUMBS`, `crewLook`, `WEAPONS`, `playableMaps`). The INTEGRATION stage wires the few lines in §S10
and adds `"probe:stats": "node _harness/probe_stats.ts"` to `package.json`.

`recorder.ts`, `score.ts`, `baselines.ts`, `achievements.ts`, `career.ts` must import nothing from THREE or the DOM
(the node probe imports them). `portal.ts` and `ui/*` may use the DOM.

---

## S2 Per-match record

### S2.1 Inputs

The recorder reads a `StatsWorldView` — a structural subset that `MatchWorld` already satisfies (no adapter needed
offline; the online lane supplies one for a guest if its guests do not run a `MatchWorld`, §S9):

```ts
interface StatsWorldView {
  readonly mode: 'teams' | 'ffa';
  readonly rule: 'turf' | 'washout';
  readonly def: { readonly id: string };            // 'pier18' | 'lockwell' | 'cinder'
  readonly phase: 'countdown' | 'live' | 'ended';
  readonly tick: number;                            // sim ticks (TICK = 1/60 s, core/config.ts)
  readonly limit: number;
  readonly endedBy: 'horn' | 'limit' | null;
  readonly result: MatchResult | null;              // core/match/world.ts
  readonly runners: ReadonlyArray<{ readonly id: number; readonly team: number; readonly kit: string;
    readonly bot: boolean; readonly washes: number; readonly washedCount: number; readonly painted: number }>;
}
```

and these `SimEvent`s (core/match/events.ts), copied by value as they arrive (the drained array and its objects are
the Game's; the recorder never keeps a reference):

| Event | Used for |
|---|---|
| `{t:'phase', phase:'live'}` / `'ended'` | live start tick / end tick → `liveS`; `'ended'` triggers finalize |
| `{t:'washed', victim, by, cause}` | wash streak, splashdowns |
| `{t:'hit', victim, by}` | last foe to hit each victim (TURF splashdown credit) |
| `{t:'special', pid, phase:'start'}` | specials used |
| `{t:'sub', pid, phase:'throw'}` | subs thrown |

`localPid` = the local player's runner id (0 offline; the online lane passes its own).

CHANGED(review) — exact clock: events carry no tick and up to `MAX_STEPS_PER_FRAME` (5) ticks are drained per frame, so
the tick seen at drain time can be 4 ticks late. Use `liveTick = round(w.countdownS / TICK)` (the countdown ends on
exactly that tick, `world.ts step()`); at finalize, `liveS = w.durationS` when `endedBy === 'horn'` (exact), and
`(w.tick − liveTick) × TICK` read at the drain that carried `'ended'` when `endedBy === 'limit'` (≤ 4 ticks late,
≤ 0.07 s). Online matches use §S9's seated time instead.

### S2.2 The record

```ts
interface MatchRecord {
  id: string;            // random 8-char base36, made at matchBegin (no seed, no room code)
  at: number;            // Date.now() at finalize
  v: 1;                  // record schema
  mode: 'teams' | 'ffa'; rule: 'turf' | 'washout'; map: string; kit: string;
  skill: 'breeze' | 'swell' | 'storm';           // the bot tier the match was started with
  online: boolean; humans: number;               // runners with bot === false at finalize
  result: 'win' | 'loss' | 'draw';
  place: number;         // TEAMS: 1 = win or draw, 2 = loss. FFA: my crew's standings rank (1..8, ties share a rank)
  crews: number;         // crews in the standings (2 in TEAMS, 8 in FFA)
  turfPct: number;       // my crew's share × 100, 1 decimal (result.shares[myTeam]; TEAMS = the crew's turf)
  crewScore: number;     // WASHOUT: result.scores[myTeam]; TURF: 0
  washes: number;        // runners[localPid].washes (credited washes)
  washed: number;        // runners[localPid].washedCount (every cause)
  paintedM2: number;     // round(runners[localPid].painted) — weighted m² credited to me (floors count most)
  specials: number; subs: number; splashdowns: number;
  bestStreak: number;    // most credited washes in a row with no 'washed' of me between them
  liveS: number;         // (endTick − liveTick) × TICK, 1 decimal
  endedBy: 'horn' | 'limit';
  score: number;         // §S4 (0 when not eligible)
  scoreV: 1;
  eligible: boolean;     // §S2.4
  dev?: true;            // only under ?statsdev=1
}
```

Result for the local player (myTeam = `runners[localPid].team`):
- TEAMS: `result.winner === myTeam` → win; `winner === 0` → draw; else loss. (The game's stinger treats a TEAMS draw
  as a victory; stats do not.)
- FFA: `winner === myTeam` → win; `winner === 0 && tied.includes(myTeam)` → draw; else loss. `place` = my crew's
  `standings[].rank`.

Splashdown = a `washed` event with `cause === 'sea'`, the victim on another crew, and either `by === localPid`
(WASHOUT credits sea washes) or `by === null` with my `hit` on that victim inside the last
`WASHOUT.seaCreditS` (5 s) by tick (TURF never credits sea washes; the recorder applies the same 5 s window itself).

### S2.3 Lifecycle

- `matchBegin` opens a record. A second `matchBegin` while one is open and not ended → the open one is **abandoned**.
- The `'phase' 'live'` event stamps `liveTick`. The `'phase' 'ended'` event stamps `endTick` and **finalizes** (reads
  `result` and the runner counters from the view at that moment).
- `matchAbandon` (QUIT MATCH, LOBBY from the pause card, a failed session, a restart before the horn) → abandoned.
  Abandoned records are never scored, never count as a match, a win or a loss, never unlock anything; only
  `career.abandoned` grows.
- Belt and braces: if a `matchBegin` / `matchAbandon` arrives for a view whose `phase === 'ended'` and that record was
  not finalized yet, finalize it first. CHANGED(review): the same check runs on every `simEvents` call (an offline
  record whose view says `ended` is finalized even if its `'ended'` event was never seen).
- CHANGED(review) — online records (an `OnlineMatchInfo` was given) are finalized **only** by `onlineEnd()` (§S9.1),
  never by the `'phase' 'ended'` event: a client's container world is never stepped, so its `result` / `endedBy` stay
  null, and its runner counters can be up to 29 ticks stale (scoreboard cadence). A `matchBegin` carrying the same
  `online.matchId` as the open record is a **continuation** (host migration swapped the world): the recorder swaps
  its view and keeps everything; it is never an abandon.

### S2.4 Eligibility (anti-cheese)

A finalized record is **eligible** (counts in the career W/L, scores, unlocks) when all hold:
1. it ended naturally (`endedBy` horn or limit) — never abandoned;
2. `liveS >= 60` (WASHOUT limit endings observed at 173–176 s in today's bot runs; 60 s only excludes freak endings);
3. **participation**: `paintedM2 >= 100 || washes >= 1` (a SWELL bot paints 300–1600 m² per 3:00; an idle player
   paints 0 — this stops "AFK while the bots win");
4. stats are enabled for the session (§S11: not a `?dev=1` session unless `?statsdev=1`);
5. online only: the match was not voided and the local player was connected at the end (§S9). CHANGED(review): for
   online records `liveS` = my **seated** live time and `paintedM2` / `washes` / `washed` = my seat's own totals
   (§S9.1 `OnlineFinal.me`), never the runner's lifetime totals (a late joiner or a reconnecting player takes over a
   runner a bot was driving; the bot's paint and washes are not theirs).

A finished record that fails 2–3 counts as `career.idle` and nothing else. Under `?statsdev=1` rule 2 is waived (short
`?matchSeconds` harness matches); rule 3 is kept.

Honesty note for the owner: every FFG score and achievement is reported by the client (any player can type a
`postMessage` into the browser console). These rules stop accidental and casual inflation — dev links, quits, idling,
farming easy bots (§S4) — not a determined cheater. That is the same trust level as every other game on the site.

---

## S3 The bridge client (`stats/portal.ts`)

### S3.1 States

```ts
type PortalState = 'standalone' | 'probing' | 'signed-in' | 'guest';
```
- `standalone`: `window.parent === window` (or reading `parent` throws). Never posts anything. Final.
- `probing`: framed; a `forgeflow:load` is out and no reply has arrived yet.
- `signed-in`: a `forgeflow:save_loaded` reply arrived (the portal answers **only** for a signed-in user, §S0). Stays
  signed-in for the page's life (a portal sign-out reloads the page).
- `guest`: framed, and every probe of the boot schedule timed out. Not final: any later reply flips to `signed-in`.

### S3.2 Messages (exact shapes)

| Direction | Message | When |
|---|---|---|
| game → portal | `{type:'forgeflow:load', slot:1, _reqId:'dfs-<n>-<base36 time>'}` | boot probes, re-probes (§S3.3) |
| portal → game | `{type:'forgeflow:save_loaded', data, _reqId}` | accepted only if `ev.source === window.parent`, the origin is allowlisted (§S3.4) and `_reqId` matches the pending one (an absent `_reqId` is tolerated, as in ascendant's portalsync) |
| game → portal | `{type:'forgeflow:score', score:<int>}` | an eligible record finalized with `score > 0`, state `signed-in` (else into the outbox) |
| game → portal | `{type:'forgeflow:achievement', achievementSlug:'<slug>'}` | an unlock, state `signed-in` (else into the outbox); CHANGED(review): always through the paced achievement queue (§S3.3), never back to back |
| game → portal | `{type:'forgeflow:save', slot:1, data:<thin CloudRecord, §S5.3>}` | after a record finalizes (debounced 1.5 s) and on `pagehide` / `visibilitychange: hidden`; only when `readOk` (§S3.3). CHANGED(review): at most one save per `SAVE_MIN_GAP_MS` (4,000 ms; a later request coalesces into one save at the end of the gap), and the `pagehide` / hidden save is sent only when the slot changed since the last save |

All posts use `window.parent.postMessage(msg, '*')` inside try/catch (the portal origin differs between production,
`*.pages.dev` previews and the harness; nothing sent is secret). DYEFIELD never sends `__replace`.

### S3.3 Probing, retries, the outbox

- **Boot probe schedule** (from `Stats.start()`): probe at 0 s; a probe that gets no reply within 6 s times out; retry
  after 1.5 s, 4 s, 8 s, 16 s (5 probes ≈ 60 s). All timed out → `guest`. Rationale: the portal resolves the user
  asynchronously after PLAY and drops messages until then (§S0), and a post-deploy cold boot can be slow (the
  ascendant incident).
- **Re-probes**: in `guest` / after a timeout, one probe at every finalize and every time the CAREER panel opens.
- **`null` must be confirmed**: a `null` reply (no row yet — or a portal read error, which also returns `null`) is
  accepted as "empty account" only after a second probe 3 s later also returns `null`. Until then the state is
  `signed-in` but `readOk` stays false.
- **`readOk`** = a reply this session that was either a valid v1 record (§S5.3 validation) or a confirmed `null`. No
  `forgeflow:save` is ever sent before `readOk`. An unreadable record (wrong shape, `v > 1`) → `readOk` stays false for
  the session: the game shows the local career and never pushes (the portal keeps the record).
  - CHANGED(review): a record finalized while `signed-in` but before `readOk` (the confirm probe is out, or the record
    is unreadable) goes to `pending` (§S5.2), like `probing`. Score and achievement posts are NOT held back by
    `readOk`: a reply already proved the player is signed in. `pending` is applied at the first `readOk` (this session
    or a later one); it holds at most 50 records (oldest dropped).
- **Outbox** (persisted in the local store, §S5.2): `{k:'ach', slug}` and `{k:'score', score, at}` items queued while
  the state is not `signed-in`. Flushed on the transition to `signed-in`. A score item older than 6 h is dropped unsent
  (the portal stamps the CURRENT week on arrival). Achievement items never expire. Max 64 items (oldest score items
  dropped first).
- CHANGED(review) — **paced achievement queue** (the portal's unlock path loses XP when two unlocks run together and
  double-grants when one slug runs twice together, §S0):
  - Every achievement post (a fresh unlock, an outbox flush, a guest claim, the self-heal) goes through ONE queue that
    lives in the outbox. The queue posts **one** `forgeflow:achievement`, then waits `ACH_GAP_MS` (3,000 ms; the
    portal's unlock is 7 sequential DB round trips) before the next. An item leaves the queue when it is posted; a
    reload resumes the rest.
  - **One post per slug per page session** (an in-memory `postedThisSession` set): a slug already posted this session
    is skipped, whatever path queued it again (claim + outbox + self-heal on the same first sign-in is the common
    case).
  - Score and save posts do not wait for the queue (different tables; no shared row with `profiles.xp`).
  - Several unlocks at the end of one match therefore reach the portal over N × 3 s; the toasts are local and show at
    once (§S8.2).
- **No other retries**: the portal never acknowledges score / achievement / save, so a post made in `signed-in` is
  considered delivered. Self-heal: once per 7 days per account (stamp `achSyncAt` in the local account bucket), after
  `readOk`, re-queue every achievement unlocked in the display career (the portal no-ops the ones it has: ≤ 29 × 2
  reads), paced as above (CHANGED(review)). It also repairs unlocks the portal dropped because a row was not seeded
  yet; seeding before the deploy (§S7) keeps that window empty.
- CHANGED(review) — **repair push**: the portal's save is a read-modify-write with no lock, so two saves landing
  together (two devices, or one device's two quick saves) can write back a stale copy of a slot (§S5.3). After every
  `readOk`, if the cloud copy of MY slot is behind my local bucket on any counter, push once (a thin push, as always).

### S3.4 Origin allowlist (replies only)

A `save_loaded` is accepted only from: `https://forgeflowgames.com`, `https://www.forgeflowgames.com`,
`https://forgeflow-games.pages.dev`, `https://*.forgeflow-games.pages.dev` (the Pages project is `forgeflow-games`,
`pipeline/deploy_portal.py`), and `http(s)://localhost:<any>` / `http(s)://127.0.0.1:<any>` (harness). Anything else
is ignored (the state stays `probing` → `guest`). Outgoing posts are not restricted (§S3.2).

---

## S4 The leaderboard score

One integer per eligible match. The portal keeps each player's **best match of the week**, so the score must mean the
same thing whichever mode, rule, map, kit and bot tier the match was.

```
t      = max(liveS, 30) / 60                              // live minutes
E      = BASELINE[map][mode][rule][kit]                   // per-minute medians, baselines.ts
cap    = CAP[skill]                                       // CHANGED(review): breeze 1.5 · swell 2.5 · storm 3.0
pPerf  = min(cap, (paintedM2 / t) / max(E.paint, 100))     // paint vs. an average SWELL runner with this kit, here
wPerf  = min(cap, (washes / t)    / max(E.wash, 1.0))      // washes, likewise
(wp, ww) = rule === 'turf' ? (0.7, 0.3) : (0.3, 0.7)
base   = 1000 × (wp × pPerf + ww × wPerf)
bonus  = TEAMS: win 250 · draw 100 · loss 0
         FFA:   round(250 × (crews − place) / (crews − 1))   // 1st 250 … last 0; tied crews share their rank's bonus
factor = TIER[skill]                                       // CHANGED(review): online too (skill = the room's bots)
score  = eligible ? max(0, round((base + bonus) × factor)) : 0      // integer; ceiling (3000 + 250) × 1.6 = 5200
```

CHANGED(review) — two farming holes closed:
- **Online used factor 1.0 whatever the bots were.** A code room's owner picks BREEZE / SWELL / STORM bots
  (CONTRACT_ONLINE §O4.3), so "create a room with a friend + 6 BREEZE bots" scored 1.0 instead of TIER.breeze. The
  factor is now always `TIER[skill]` of the bots in the match; quick-match rooms are SWELL (= 1.0), so ordinary online
  play is unchanged.
- **A single 3× cap made BREEZE the best farm for strong players.** TIER is calibrated on a SWELL bot, which is far
  from the cap against BREEZE, but a strong human reaches the cap there easily: (3000 + 250) × TIER.breeze can beat
  what the same human scores against STORM. A per-tier cap makes the ceilings rise with difficulty:
  BREEZE (1500 + 250) × TIER.breeze < SWELL (2500 + 250) × 1.0 < STORM (3000 + 250) × TIER.storm.
- TIER itself is computed from **uncapped** bases (the cap must not flatten the calibration).

Why this is fair across modes and rules:
1. **Normalised where it is measured.** 1000 = an average SWELL bot with your kit, on your map, in your mode and rule.
   FFA paints more per runner than TEAMS (today's pier18 runs: FFA 853–1615 m², TEAMS 500–1143 m²), WASHOUT paints less
   and washes more (WASHOUT TEAMS 7–22 washes vs. TURF TEAMS 2–22): dividing by the matching baseline cancels that, and
   per-kit baselines cancel the roller-paints / charger-washes split.
2. **Rates, not totals**: a WASHOUT match that ends at the limit early is not punished for being short.
3. **The rule picks the weight, never zeroes the other skill**: TURF is won by paint (0.7), WASHOUT by washes (0.7).
4. **Caps (CHANGED(review): 1.5× / 2.5× / 3× by bot tier)** stop farming one stat (e.g. painting an empty corner of
   an FFA court all match) and keep easy bots from out-scoring hard ones.
5. **Equal result expectation**: an average TEAMS player wins half the time (expected bonus 125); an average FFA
   player finishes 4.5th of 8 (expected bonus 250 × 3.5 / 7 = 125). Neither mode is favoured.
6. **Bot tier factor**: beating BREEZE bots is worth less than beating STORM bots, so the weekly board cannot be
   farmed on BREEZE. CHANGED(review): online matches use the factor of the room's bot tier (quick match = SWELL =
   1.0); the human opponents are not calibrated, and the scale stays the same.
7. **Integer**, because `leaderboard_scores.score` is an integer column.

`baselines.ts` is generated, never hand-tuned (`node _harness/probe_stats.ts --baselines --write`):
- **E cells**: bot-only matches with the shipping mixed lineup, SWELL, 3:00, the real WASHOUT limits; maps
  pier18 / lockwell / cinder × TEAMS / FFA × TURF / WASHOUT, seeds 1–5 (60 matches, ≈ 7 s each). Each cell =
  the median over every runner of that kit of `painted / t` and `washes / t`.
- **TIER**: the human slot (id 0) plays at SWELL while every other runner plays at the tier (`BotDirector` takes a
  per-runner skill array, `core/bots/director.ts:478`), 12 combos × seeds 1–3; `TIER[t] = clamp(median base of slot 0
  in SWELL-vs-SWELL / median base of slot 0 in SWELL-vs-t, 0.6, 1.6)`; `TIER.swell = 1`. CHANGED(review): the bases
  here are computed **without** the cap; the generator FAILS if `TIER.breeze ≥ 1`, `TIER.storm ≤ 1`, or the ceilings
  `(1000 × CAP[t] + 250) × TIER[t]` are not strictly increasing breeze < swell < storm.
- The file header records the command, seeds, date, and the `npm run probe` hash lines it was made against. A balance
  change that moves a cell by > 15 % regenerates it; `scoreV` bumps when the formula (not the table) changes.

The score is submitted once, at finalize, for an eligible record with `score > 0` (bots-only and online both count).
Abandoned, idle and voided matches never submit.

---

## S5 Career, local store and cloud save (`stats/career.ts`)

### S5.1 Counters

```ts
interface WLD { m: number; w: number; l: number; d: number }
interface CareerCounters {
  matches: number; wins: number; losses: number; draws: number;   // eligible records only
  idle: number; abandoned: number;
  byMode: { teams_turf: WLD; teams_washout: WLD; ffa_turf: WLD; ffa_washout: WLD };
  byKit: Record<'mist-rasp' | 'sheet-drum' | 'needle-glint' | 'pop-well', WLD>;
  byMap: Record<'pier18' | 'lockwell' | 'cinder', WLD>;
  online: WLD & { void: number };
  storm: WLD;                          // offline matches started at STORM
  podiums: number;                     // FFA place <= 3
  limitWins: number;                   // WASHOUT wins by the limit
  washes: number; washed: number; paintedM2: number; specials: number; subs: number; splashdowns: number;
  liveS: number;
}
interface Bests { score: number; turfPctTeams: number; turfPctFfa: number; washes: number; paintedM2: number; streak: number }
interface Slot { c: CareerCounters; best: Bests; ach: Record<string, number>; recent: MatchRecord[]; at: number }
```
Every number in a slot only ever grows (counters add, bests take the max, `ach[slug]` = first-unlock time and is
never removed). `recent` = the slot's last 5 eligible records, newest first.

### S5.2 Local store (everyone; `localStorage`, every access in try/catch)

Key `dyefield.career.v1` (`dyefield.career.dev.v1` under `?statsdev=1`, so harness runs never touch a real career):

```ts
interface LocalStore {
  v: 1;
  dev: string;                              // device token: 12 random base36 chars, made once
  guest: Slot;                              // matches played while not signed in (standalone, phone, guest frame)
  accts: Record<string, Slot & { since: number; achSyncAt: number }>;   // by account tag (§S5.3)
  pending: MatchRecord[];                   // finalized while the portal state was 'probing' (assigned later)
  outbox: Array<{ k: 'ach'; slug: string } | { k: 'score'; score: number; at: number }>;
  lastTag: string | null;
}
```
- A finalized record is applied to: the current account's bucket (`signed-in` with `readOk`), the `guest` bucket
  (`standalone` / `guest`), or `pending` (`probing`, and CHANGED(review) `signed-in` without `readOk`); `pending` is
  applied as soon as the state resolves (to the guest bucket if the boot schedule ends in `guest`).
- **Guest claim**: on the first `readOk` of an account on this browser, a non-empty `guest` slot is folded into that
  account's bucket (counters added, bests maxed, achievements unioned — and posted, §S6.3), then reset. This is the
  expected "played first, signed in later" flow. (The first account to sign in on a shared browser gets the guest
  progress — documented, accepted.)
- Storage partitioning: the CDN page inside the portal frame and the CDN page opened directly are different storage
  buckets in modern browsers. They are different "devices" here — correct by construction.
- Blocked storage: the store lives in memory for the session; nothing throws.
  - CHANGED(review): with blocked storage the device token would be new on every page load, so every session would
    add a new ~2 KB slot to the cloud record forever (slots are never pruned). Instead, when a write-then-read test of
    `localStorage` fails at boot, the session is **storage-less**: its slot key is `nostore-${tag}` (one shared slot
    per account for every storage-less session). At `readOk` it takes the cloud copy of that slot as its base, applies
    this session's records on top, and pushes the whole slot as usual. Sequential storage-less sessions add up
    correctly; two storage-less sessions of one account running at the same time can lose one session's counters (the
    single-writer rule is broken only there; accepted, rare). Achievements and scores are unaffected.

### S5.3 Cloud record (signed-in; `game_saves` slot 1) — one writer per key

The portal merges by key and "incoming scalar wins" (§S0). The record is shaped so that **every key has exactly one
writer**, which makes that merge exactly right:

```ts
interface CloudRecord {
  v: 1;
  game: 'dyefield';
  tags: Record<string, number>;     // account tag(s) → first-seen ms. Union-only.
  slots: Record<string, Slot>;      // key `${deviceToken}-${tag}`; written only by that device, for that account
}
```
- **Account tag**: on a confirmed-empty account the device makes a random 10-char tag and pushes `{tags:{[tag]:now}}`.
  On later reads the device picks its local bucket by matching any key of `tags` against `accts` (several matches:
  the oldest bucket). No match → a new bucket under the oldest tag. The tag lets one browser keep several accounts'
  careers apart without ever learning who the user is.
- **Thin pushes**: a push sends only `{v:1, game:'dyefield', tags:{[myTag]:t}, slots:{[mySlotKey]: mySlot}}`. The
  portal's merge keeps every other device's slot untouched; my slot's values come from my local bucket, which is
  always ≥ the cloud copy (single writer).
  - CHANGED(review) — "untouched" holds per write, not across concurrent writes: `saveGameData` reads the row, merges,
    then upserts, with no lock or version check (`gameBridge.ts:248–276`). If device A's and device B's saves
    interleave (both read before either writes), the later upsert carries the OLD copy of the other device's slot,
    and that device's newest counters are lost from the cloud until it pushes again. Each device's local bucket still
    has them, and the repair push (§S3.3) restores them at that device's next `readOk`. Nothing is lost for good while
    the device keeps its storage; the display may lag by one session. The node probe models this race (§S12 G-S1.6).
- **Validation** of a read: `v === 1`, `tags` and `slots` plain objects, every slot's `c` an object. Anything else is
  unreadable (§S3.3: read-only session, no push). Unknown keys are preserved on display and never written.
- Size: a slot ≈ 2 KB; slots are never pruned (they carry the totals). Twenty devices ≈ 40 KB of jsonb — fine.

### S5.4 The display career

- `signed-in` + `readOk`: fold over every slot of the cloud record, with my own slot replaced by my local bucket (it is
  newer): counters **summed**, bests **maxed**, achievements **unioned** (earliest time), recent = the newest 10 over
  all slots.
- otherwise: the `guest` slot (plus `pending`).

Achievement thresholds that count matches (`matches_25`, `all_kits`, `online_wins_10`, …) are evaluated on the display
career, so progress on a phone and a PC adds up.

---

## S6 Achievements

### S6.1 The set — 29 achievements, 340 XP

Standard FFG tier points (bronze 5 / silver 15 / gold 30; §S0). 340 XP sits inside the live range of other games
(155–455). `achievements.json` holds exactly these rows (`slug, name, description, tier, points, secret:false`); the
seeder writes them, the game detects them. Slugs ≤ 64 chars, names ≤ 80, descriptions ≤ 240 (the pipeline's limits).
Every detector runs at **finalize, on eligible records only** (§S2.4) — nothing unlocks mid-match or from a quit.
`r` = the record, `C` = the display career after applying `r`.

| # | slug | name | description | tier | XP | detector |
|---|---|---|---|---|---|---|
| 1 | `first_match` | Wet Paint | Finish your first match. | bronze | 5 | `C.matches >= 1` |
| 2 | `first_win` | First Splash | Win your first match. | bronze | 5 | `r.result==='win'` |
| 3 | `teams_turf_win` | Floor Is the Score | Win a TEAMS · TURF match. | bronze | 5 | teams, turf, win |
| 4 | `teams_washout_win` | Harbor Sweep | Win a TEAMS · WASHOUT match. | bronze | 5 | teams, washout, win |
| 5 | `ffa_turf_win` | Crew of One | Win a FREE-FOR-ALL · TURF match. | silver | 15 | ffa, turf, win |
| 6 | `ffa_washout_win` | Last Dry Runner | Win a FREE-FOR-ALL · WASHOUT match. | silver | 15 | ffa, washout, win |
| 7 | `ffa_podium` | On the Podium | Finish in the top three of a FREE-FOR-ALL match. | bronze | 5 | ffa, `r.place <= 3` |
| 8 | `washout_limit` | To the Limit | Win a WASHOUT match by reaching the score limit. | silver | 15 | washout, win, `endedBy==='limit'` |
| 9 | `kit_mist_rasp` | Rasp Regular | Win a match with the MIST-RASP. | bronze | 5 | win, kit `mist-rasp` |
| 10 | `kit_sheet_drum` | Drum Roll | Win a match with the SHEET-DRUM. | bronze | 5 | win, kit `sheet-drum` |
| 11 | `kit_needle_glint` | Glint in the Eye | Win a match with the NEEDLE-GLINT. | bronze | 5 | win, kit `needle-glint` |
| 12 | `kit_pop_well` | Pop Goes the Well | Win a match with the POP-WELL. | bronze | 5 | win, kit `pop-well` |
| 13 | `all_kits` | Full Locker | Win a match with each of the four kits. | silver | 15 | `C.byKit[k].w >= 1` for all 4 |
| 14 | `map_pier18` | Pier Pressure | Win a match on PIER 18 PLAZA. | bronze | 5 | win, map `pier18` |
| 15 | `map_lockwell` | Lock and Load | Win a match on LOCKWELL WORKS. | bronze | 5 | win, map `lockwell` |
| 16 | `map_cinder` | Reef Raider | Win a match on CINDER REEF. | bronze | 5 | win, map `cinder` |
| 17 | `all_maps` | Harbor Tour | Win a match on all three arenas. | silver | 15 | `C.byMap[m].w >= 1` for all 3 |
| 18 | `turf_50` | Half the Harbor | Help your crew cover half the court in a TEAMS · TURF match. | silver | 15 | teams, turf, `r.turfPct >= 50` |
| 19 | `paint_1500` | Dye Hard | Paint 1,500 m² of turf in one match. | silver | 15 | `r.paintedM2 >= 1500` |
| 20 | `washes_10` | Riptide | Wash 10 rivals in one match. | silver | 15 | `r.washes >= 10` |
| 21 | `streak_5` | Undertow | Wash 5 rivals in a row without being washed. | silver | 15 | `r.bestStreak >= 5` |
| 22 | `splashdown` | Splashdown | Send a rival into the sea. | bronze | 5 | `r.splashdowns >= 1` |
| 23 | `flawless` | Bone Dry | Win a match without being washed once — and paint at least 600 m² doing it. | gold | 30 | win, `washed===0`, `paintedM2 >= 600` |
| 24 | `storm_win` | Weathered the Storm | Win a match against STORM bots. | silver | 15 | `!online`, skill `storm`, win |
| 25 | `matches_25` | Harbor Regular | Finish 25 matches. | silver | 15 | `C.matches >= 25` |
| 26 | `matches_100` | Dockside Legend | Finish 100 matches. | gold | 30 | `C.matches >= 100` |
| 27 | `online_first` | Open Water | Finish an online match. | bronze | 5 | `r.online` |
| 28 | `online_win` | Crowd Pleaser | Win an online match. | silver | 15 | `r.online`, win |
| 29 | `online_wins_10` | Harbor Champion | Win 10 online matches. | gold | 30 | `C.online.w >= 10` |

Tally: 14 bronze (70) + 12 silver (180) + 3 gold (90) = 340 XP. Coverage: both modes (3–7), both rules (3–8), all four
kits (9–13), all three maps (14–17), online (27–29). "Win" excludes draws. Thresholds were set against today's SWELL
bot runs on pier18 (painted 300–1615 m², washes 0–23, crew turf 28–35 % in TEAMS TURF): each performance one is at or
beyond the best bot, so it reads as an achievement, and every one is reachable. The online three ship seeded now and
unlock once the online lane ships.

### S6.2 Unlock flow

At finalize, for each detector that is true and whose slug is not yet in the bucket's `ach`: set
`ach[slug] = r.at`; show a toast (§S8.2); then queue `forgeflow:achievement` in the paced queue (§S3.3; it posts
only while `signed-in`, else waits in the outbox). Several unlocks at once → queued in table order, posted 3 s apart;
toasts queue.

### S6.3 Claims and re-sync

On a guest claim (§S5.2) every newly-claimed slug is posted (one toast: "N achievements saved to your account").
The 7-day self-heal re-post (§S3.3) covers posts the portal dropped.

---

## S7 Seeder (`forgeflow-games/pipeline/seed_dyefield_achievements.py`)

- Input: `games/dyefield/runtime/src/stats/achievements.json` (the same file the game imports).
- Credentials, as `pipeline/deploy_game.py`: URL = `.env` `VITE_SUPABASE_URL` (else `providers.supabase_forgeflow.url`);
  key = env `FFG_SERVICE_ROLE_KEY` else `api_config.json → providers.supabase_forgeflow.service_role_key`. Never print a
  key, a URL with a key, or a user id.
- Steps:
  1. Resolve the game: `GET /rest/v1/games?slug=eq.dyefield&select=id,slug,status` → exactly one row (expect id 53;
     refuse to run on 0 or > 1).
  2. Validate the JSON: 29 rows, unique slugs, tier ∈ {bronze, silver, gold}, points = 5 / 15 / 30 by tier, lengths.
  3. Read the existing rows for that game (`GET /rest/v1/achievements?game_id=eq.<id>&select=*`), and **always** write a
     backup first: `forgeflow-games/state/backups/dyefield_achievements_<UTC yyyymmddThhmmss>.json` (all existing
     dyefield rows, even when empty).
  4. Plan: per slug → `insert` (missing), `same` (present and identical), `differs` (present, any of name /
     description / tier / points / secret different). Print the plan table. **Default = dry run: stop here, exit 0.**
  5. `--apply`: `POST /rest/v1/achievements?on_conflict=game_id,slug` with
     `Prefer: resolution=ignore-duplicates,return=representation`, body = the `insert` rows only (`game_id`, `slug`,
     `name`, `description`, `tier`, `points`, `secret`; `icon` / `icon_url` left null like every other row). Additive and
     idempotent: never `UPDATE`, never `DELETE`; a `differs` row is reported, left alone, and makes the exit code 3
     (the owner decides).
  6. Verify: re-read, every slug present with the JSON's tier and points; exit non-zero on any mismatch.
- Why not the `seed_game_achievements` RPC the game pipeline uses: its body is not in this repo, and the pipeline's
  own comment says it "caps insertions per game" at an unknown cap; a silent cap below 29 would be invisible. The
  direct upsert-ignore is transparent and verifiable (service_role keeps write rights after 0005, which revoked only
  anon / authenticated).
- Exit codes: 0 ok · 1 setup / network · 2 validation · 3 `differs` rows present · 4 verify failed.
- CHANGED(review) — **order: seed BEFORE the game build that posts achievements goes live.** The portal drops an
  achievement post whose slug has no row, silently (§S0). If the game deploys first, every unlock in that window is
  lost on the portal (it stays in the local career). The self-heal (§S3.3) repairs it within 7 days at the latest; the
  correct order makes the repair unnecessary. The orchestrator runs `--apply` and its verify, then deploys the game.

---

## S8 UI

### S8.1 CAREER panel (`stats/ui/career_panel.ts`)

`createCareerPanel(store: StatsHandle): { el: HTMLElement; refresh(): void; summary(): string }` — the body of a Menus
screen (Menus supplies the screen, the scrim, the header with BACK, and ESC / pad B; §S10.3).

Content, top to bottom (a single scroll column; two tile columns from 700 px up, one below):
1. **Account line**: signed-in + readOk → "Saved to your ForgeFlow account"; framed guest → "Playing as a guest — sign
   in on forgeflowgames.com to save your career and earn XP"; standalone → "Saved on this device — play on
   forgeflowgames.com and sign in to keep it on your account"; probing → "Connecting to your account…".
2. **Tiles**: MATCHES · WINS · WIN RATE (wins / matches, whole %) · BEST SCORE.
3. **Modes**: a 2 × 2 grid TEAMS·TURF / TEAMS·WASHOUT / FFA·TURF / FFA·WASHOUT, each "W–L–D".
4. **Records**: best score, best crew turf % (TEAMS), best turf % (FFA), most washes, best streak, most painted m².
5. **Totals**: washes, times washed, painted m², specials, subs, splashdowns, time played (h m, from `liveS`).
6. **Kits** (KIT_ICONS + name + "W / M") and **Arenas** (MAP_THUMBS + name + "W / M").
7. **Online**: "W–L–D · N voided", or "Play online to start your record."
8. **Achievements**: "N / 29 · X XP", a grid of all 29 (tier colour, name, description, XP; locked ones dimmed —
   none are secret).
9. **Recent**: the last 10 eligible matches (mode·rule, arena, kit icon, result, turf % or washes, score).

Rules: toy-bright Menus look (Lilita One heads, Nunito body, ink outline, hard drop); every number via
`toLocaleString('en-US')`; no layout shift when data arrives; each section header is a focusable `[data-nav]`
element that `scrollIntoView({block:'nearest'})`s on focus, so arrows / d-pad scroll the panel; touch scrolls natively;
`summary()` = "12 W · 31 matches" (or "No matches yet") for the title entry.

### S8.2 Achievement toast (`stats/ui/toast.ts`)

`createToaster(uiRoot: HTMLElement, o: { reduceMotion(): boolean; sound?(s: 'click'): void }): { show(a: AchievementDef, xp: boolean): void; note(text: string): void; dispose(): void }`
- Mounts its own `#df-ach-toast` into `#ui`: top-centre, `top: max(10px, env(safe-area-inset-top))`, width
  `min(420px, 92vw)`, height ≤ 64 px, `z-index: 35` (above the touch overlay 30, below the menus 40),
  `pointer-events: none`, `role="status"` / `aria-live="polite"`.
- One toast: tier chip (bronze `#cd7f32` / silver `#c0c0c0` / gold `#ffd700` — the portal's colours), "ACHIEVEMENT",
  the name, and "+15 XP" only when the state is `signed-in` (else "Saved on this device"). 3.2 s each, queued; more than
  3 waiting collapse to "+N more". Reduce motion → fade only.
- Unlocks happen at finalize, so toasts play over the victory slate: the toast must not cover the slate's buttons (G-S2
  measures it at 1280 × 720 and 852 × 393).
- `hud.ts` and `slates.ts` are untouched.

---

## S9 Online seam (for the ONLINE lane) — what counts

### S9.1 The info the online layer hands to `matchBegin`

CHANGED(review) — this seam was rewritten so it matches CONTRACT_ONLINE (§O11.3, which had a different end call) and
the online sim as designed. Three defects in the first version: (1) online rosters are built with **every entry
`bot: true`** (CONTRACT_ONLINE §O4.5 step 2; `Runner.bot` is readonly, set at construction, `runner.ts:291`), so
"runners with `bot === false`" counted 0 humans and every online match would have been scored as a bot match; (2) a
client's container world is never stepped, so finalizing on its `'phase' 'ended'` event read a null `result`;
(3) late joiners and reconnecting players inherit a runner a bot was driving, and its lifetime counters.

```ts
interface OnlineMatchInfo {
  matchId: string;          // the online layer's own per-match id (never shown, never stored in the record)
  localPid: number;         // my runner id in this match
  role: 'host' | 'client';  // CHANGED(review): 'client' (CONTRACT_ONLINE's term), was 'guest'
  skill: 'breeze' | 'swell' | 'storm';   // CHANGED(review): the room's bot tier (quick match: 'swell'), for §S4
}
interface OnlineFinal {     // CHANGED(review): built by SYNC from the host's `end` message (CONTRACT_ONLINE §O3.3)
  result: MatchResult;      // end.result (carries endedBy)
  humans: number;           // runners whose seat is human-driven at the horn (end.runners[].seat?.human === true)
  me: { seatedLiveTicks: number; painted: number; washes: number; washedCount: number } | null;
                            // my seat's own totals (human-driven time only, §O7.5); null if I hold no seat at the end
}
```
- `matchBegin(w, {…, online: OnlineMatchInfo})` at the start of every online match (each rematch is a new `matchId`).
  A second `matchBegin` with the **same** `matchId` = host migration swapped the world: continuation (§S2.3).
- `stats.onlineEnd(status: 'complete' | 'void' | 'dropped', fin?: OnlineFinal)` — the ONLY finalize of an online
  record. `fin` is required for `complete`. `void` = the match was voided (the 4th host loss, CONTRACT_ONLINE §O6.3);
  `dropped` = I am not connected when the match ends (reconnect failed).
- Events: SYNC feeds the client's synthesized `SimEvent`s through the same `simEvents` hook (CONTRACT_ONLINE §O5.3), so
  streaks, splashdowns, specials and subs are counted from my seat's events. Events before my seat began (a late join)
  are not seen and do not count.
- Record fields for an online record: `paintedM2 = round(fin.me.painted)`, `washes`, `washed` from `fin.me`;
  `liveS = fin.me.seatedLiveTicks × TICK`; `skill = online.skill`; `result` / `place` / `turfPct` / `crewScore` from
  `fin.result` exactly as §S2.2; `endedBy = fin.result.endedBy`.

### S9.2 What counts as an online match

An online record is `online: true` when `OnlineMatchInfo` was given **and** CHANGED(review) `fin.humans >= 2`. It counts
(eligible) when §S2.4 holds (the 60 s rule applies to SEATED live time: a late joiner with less than 60 s seated is
`idle`) and the status is `complete`. Then:
- W / L / D for me exactly as §S2.2 (TEAMS: my crew's result; FFA: sole first = win, tied first = draw, else loss);
- `C.online` gets the W/L/D; the record also counts in every other counter (mode, rule, kit, map);
- the score is submitted (CHANGED(review): factor `TIER[online.skill]`, §S4) and achievements fire (27–29 included);
- `void` → `C.online.void++` only (no W/L, no score, no unlocks); `dropped` → abandoned.
- An `OnlineMatchInfo` match that ends with `fin.humans < 2` (everyone else left) counts as an offline-style bot match:
  `online: false`, tier factor of the bots' tier.
- Trust: online results are reported by the host's browser (CONTRACT_ONLINE §O8). They count on the weekly board at
  the same trust level as every other client-reported FFG score (§S2.4 honesty note).

### S9.3 Where online W/L shows

In the CAREER panel (all devices, via the cloud save) and through achievements on the portal profile.

### S9.4 Why not `report_match_result` / `ffg_ratings.js`

Verified this session: the RPC and `match_results` do not exist in production, and production `game_ratings` is a
different table (§S0). Every call from tide-breakers / warboard-chess / chroma-hide / pirates-cove's `ffg_ratings.js`
therefore fails (its `reportResult` swallows the error and returns null) — and `game_ratings` has 0 rows, which
matches. Two more blockers: the RPC is 1-v-1 (`p_white` / `p_black`) while DYEFIELD is 4 v 4 / 8-crew FFA with bots;
and `ffg_ratings.currentPlayer()` reads a Supabase session from the CDN origin's own storage, where the portal (a
different origin) never writes one (inferred from the origins; the 0-row table is consistent with it). DYEFIELD does
not call it. A real portal-side W/L / rating needs a reconciled migration, a portal page and an identity hand-off from
portal to game — a production schema change, so it is an owner decision (open question), not part of this build.

---

## S10 Integration API (the INTEGRATION stage's few lines)

### S10.1 `game.ts` — three optional hooks on `GameHooks`

```ts
/** a MATCH world was created (the constructor, and restart() after it builds the next world); never for the lobby */
matchBegin?(w: MatchWorld, cfg: Readonly<MatchConfig>, matchNo: number): void;
/** this frame's drained sim events, match sessions only. READ-ONLY: copy what you need, never keep `events` */
simEvents?(events: readonly SimEvent[], w: MatchWorld): void;
/** a match world is being discarded before its horn (dispose: QUIT MATCH / LOBBY / error; restart before the end) */
matchAbandon?(w: MatchWorld, why: 'dispose' | 'restart'): void;
```
Call sites (each guarded `this.mode === 'match'`):
- constructor, right after `this.world = this.makeWorld();` → `hooks.matchBegin?.(this.world, p.config, this.matchNo)`;
- `restart()`: before `this.releaseWorld(this.world)` → `if (this.world.phase !== 'ended') hooks.matchAbandon?.(this.world, 'restart')`;
  after `this.matchNo++` → `hooks.matchBegin?.(this.world, p.config, this.matchNo)`;
- `drainEvents()`: after `const lobby = …`, `if (!lobby) this.p.hooks?.simEvents?.(out, this.world);` (before the
  switch; the hook must not mutate `out` or its objects);
- `dispose()`: before `this.releaseWorld(this.world)` → `if (this.world.phase !== 'ended') hooks.matchAbandon?.(this.world, 'dispose')`.

The hooks are wrapped by the Stats facade in try/catch: a stats bug can never stop a frame.

### S10.2 `main.ts`

```ts
import { createStats } from './stats/index.ts';
const stats = createStats({ uiRoot, version: app.version, dev: app.dev, statsDev: params.get('statsdev') === '1',
  reduceMotion: () => settings.get().reduceMotion, sound: (s) => audio.ui(s) });
stats.start();                                                   // once, at boot: the first portal probe
hooks.matchBegin = (w, cfg, n) => stats.matchBegin(w, { kit: w.runners[0].kit, skill: cfg.skill, online: null, localPid: 0 });
hooks.simEvents  = (ev, w) => stats.events(ev, w);
hooks.matchAbandon = (w, why) => stats.matchAbandon(w, why);
// Menus option (S10.3): new Menus(uiRoot, { …, career: stats.career })
```
The online lane replaces `online: null, localPid: 0` with its `OnlineMatchInfo` for online sessions.
CHANGED(review): concretely, SYNC keeps a module-level `currentOnline: OnlineMatchInfo | null` in `main.ts` (null
offline) and the hook passes `{ kit: w.runners[info.localPid].kit, skill: info.skill, online: info, localPid:
info.localPid }` when it is set. SYNC never calls `matchAbandon` for a host migration (the Game is not disposed; only
its world is swapped) and calls `stats.onlineEnd(...)` at `end` / void / drop (§S9.1).

CHANGED(review) — **who edits `game.ts`, `main.ts` and `ui/menus.ts`, in what order**: this INTEGRATION stage and the
ONLINE lanes (SYNC: `game.ts` / `main.ts`; LOBBY-UI: `menus.ts` / `menus.css`) touch the same files. They never run at
the same time. Order: (1) STATS INTEGRATION lands its lines and passes G-S3; (2) SYNC and LOBBY-UI rebase their edits
on top of it. The STATS lines are small and stay as written; SYNC's `HUMAN → localPid` change also replaces
`w.runners[0]` in the hook above.

### S10.3 `ui/menus.ts`

- `Screen` gains `'career'`; the constructor option gains `career?: { el: HTMLElement; refresh(): void; summary(): string }`.
- Screen: `const car = this.mkScreen('career'); car.append(el('div', 'dfm-scrim full'), this.header('CAREER', ''), o.career.el);`
  and `show('career')` calls `o.career.refresh()` (the header's BACK, ESC and pad B already work).
- Entry: a pill button `#dfm-career` (`CAREER` + a trophy glyph, `[data-nav]`) in the title's `.dfm-corner-row`,
  between the profile card and FULLSCREEN, opening `career`. **Not** a sixth main-stack item: `_harness/menus.py`
  asserts the title stack is exactly PLAY / LOADOUT / SETTINGS / HOW TO PLAY / CREDITS, and the profile card's
  `b` / `.txt span` text, so neither is touched. (A main-stack item is the owner's call — open question.)
- The entry must pass `menus.py` layout (no overlap / off-screen), `layoutcheck.py` and `mobile.py` at their viewports.

No `hud.ts` / `slates.ts` change: the toast mounts itself (§S8.2).

---

## S11 Dev, harness and read-back

- `?dev=1` without `?statsdev=1` → stats are **off** for the session (dev links can set `matchSeconds`, brush,
  `__DF__.setTimeLeft / damage / teleport`): no record, no post, no store write. The CAREER panel still opens (shows the
  stored career).
- `?statsdev=1` (with or without `?dev=1`) → stats on, store key `dyefield.career.dev.v1`, records carry `dev: true`,
  the 60 s rule is waived. Posting is unchanged (the harness's mock portal records it; the real portal frame never
  carries this flag — its iframe src is `game_url?v=…[&room=…]`).
  - CHANGED(review): anyone can add `&statsdev=1` to the iframe src in devtools, which would post short (< 60 s) matches
    to the real portal. Under `?statsdev=1` the client therefore posts score / achievement / save **only after** a
    `save_loaded` reply whose `event.origin` is `http(s)://localhost:*` or `http(s)://127.0.0.1:*` (the harness's mock
    portal). Replies from forgeflowgames.com or `*.pages.dev` leave a statsdev session in local-only mode (state
    reported as `signed-in`, `sent` stays empty). (A determined player can still post by hand from the console; this
    only removes the ready-made shortcut.)
- `window.__DF_STATS__` (always installed, read-only snapshots): `state()` →
  `{ version:'stats-1', portal, readOk, bucket:'guest'|'account'|'pending'|null, outbox:n, sent: last 50 posted
  {type, slug?, score?, at}, lastRecord, display: {counters, bests, ach}, achDefs: 29 }`; `career()` → the display
  career; `cloudPreview()` → the thin payload the next push would send.

---

## S12 Test plan and gates

### G-S1 `node _harness/probe_stats.ts` (node, headless, owned by the lane)
1. **Hash invariance**: TEAMS TURF / FFA TURF / TEAMS WASHOUT / FFA WASHOUT on pier18 seed 1 — `world.hash()` at the
   horn with a recorder attached (fed every tick's events) equals the hash without one. FAIL on any difference.
2. **Detectors on real matches**: 12 bot matches (3 maps × 2 modes × 2 rules, seed 1, human slot = SWELL bot): every
   record is eligible, its fields equal the world's (`washes`, `washedCount`, `round(painted)`, `result`, shares), each
   detector's verdict equals an independent recomputation, `liveS` equal to `durationS` for horn endings and within
   CHANGED(review) 5 ticks (0.084 s) of the sim clock for limit endings (§S2.1), with events delivered in frame-sized
   batches of 1–5 ticks as the Game does.
3. **Detectors on fixtures**: one hand-built record per achievement that must fire and one near-miss that must not
   (e.g. `paintedM2 1499`, a draw for every win rule, `flawless` with 599 m²).
4. **Lifecycle**: begin → abandon → nothing counted but `abandoned`; begin → begin → first abandoned; idle (0 paint,
   0 washes) → `idle` only; `liveS < 60` → idle; statsdev waives 60 s.
5. **Score**: bot medians per (mode, rule) within 900–1100 (by construction); integer; 0 for ineligible; FFA bonus
   250 → 0 over places; ceiling ≤ 5200. INFO: per-kit median scores. CHANGED(review): per-tier caps applied (a
   BREEZE fixture with both perfs at 2.9 scores `(1500 + bonus) × TIER.breeze`); ceilings strictly increasing
   breeze < swell < storm; an online record with `skill: 'breeze'` uses TIER.breeze.
6. **Merge properties** (randomised, 500 cases): fold is order-independent; merging a record twice = once for the
   display (one writer per slot); a thin push merged into a cloud record through a JS port of `mergePreservingKeys`
   never lowers another slot's value; guest claim adds exactly once; an unreadable record → no push.
   CHANGED(review) adds: (a) **interleaved saves** — two devices' read-modify-writes interleaved (both read, then both
   write) lose the earlier writer's newest slot in the cloud, and that device's next `readOk` + repair push restores
   it exactly; (b) **storage-less sessions** — 3 sequential storage-less sessions of one account sum correctly in the
   `nostore-<tag>` slot and add no other slot; (c) `signed-in` without `readOk` → records land in `pending` and are
   applied once at the first `readOk`.
7. `--baselines [--write]`: regenerates `baselines.ts` (§S4); without `--write` it checks the committed table is within
   15 % per cell (INFO when the sim changed on purpose).
8. CHANGED(review) **Online seam** (fixtures, no network): (a) `matchBegin` twice with one `matchId` → one record,
   nothing abandoned; (b) an online record is NOT finalized by a `'phase' 'ended'` event, only by `onlineEnd`;
   (c) a late-join fixture (`fin.me.seatedLiveTicks` = 50 s) → `idle`, while the runner's lifetime counters (bot
   time included) are never read; (d) `fin.humans` 2 → `online: true` although every runner has `bot: true`;
   `fin.humans` 1 → `online: false`; (e) `void` → only `online.void` grows.
9. CHANGED(review) **Paced queue** (fake clock): 8 unlocks at one finalize + a guest claim of 3 overlapping slugs + a
   due self-heal → posts are ≥ 3,000 ms apart, each slug at most once per session, and the queue survives a simulated
   reload (store round-trip) with the rest still pending.
Exit 0 all pass · 1 a gate failed · 2 setup failure. Wall target < 4 min (baselines mode excluded).

### G-S2 `python _harness/statscheck.py --headless` (browser, owned by the lane)
The mock portal is a parent page on a **different origin** from the game, as `last-circle/_harness/portalcheck.py`
does: Playwright routes `http://localhost:5186/__df_portal` to an inline page that iframes
`http://127.0.0.1:5186/?…` with the `sandbox` and `allow` strings **read at run time from
`src/components/game/GamePlayer.tsx`**. The stand-in speaks the bridge exactly like `gameBridge.ts`: frame-source check;
`load` answered only when "signed in"; `save` → a JS port of `mergePreservingKeys`; `score` → keep-highest; achievement
→ idempotent by slug. It records every message in `window.__MSGS__`. No real DB, no network beyond localhost.
Matches use `?statsdev=1&dev=1&matchSeconds=45&autostart=1&bots=breeze`, with FIRE and movement driven the way
`_harness/playtest.py` drives them, so participation is real.

Scenarios (each a fresh browser context):
- **S-a standalone** (the game URL opened directly): state `standalone`, a finished match lands in the guest slot,
  `__DF_STATS__.state().sent` is empty.
- **S-b signed-in, empty**: two `null` replies → readOk; after a finished match the portal received, in order, the
  achievement posts (`first_match`, …), one integer `score` equal to `lastRecord.score`, then one thin `save` whose
  merge yields `tags` + one slot; a second match → the same slot updated, no other key touched.
- **S-c signed-out → sign-in**: no replies; state `guest` after the schedule; a finished match → guest slot, zero
  score / achievement posts, outbox non-empty; the stand-in starts answering → the next probe flips to `signed-in`,
  the outbox drains, the guest slot is claimed and pushed.
- **S-d rich cloud**: a seeded record with another device's slot → CAREER totals = sum; after a match the other slot is
  byte-identical.
- **S-e corrupt / future record** (`v: 2`, `slots: "x"`) → no `save` posted all session; CAREER shows local.
- **S-f quit mid-match** (pause → QUIT MATCH) → no score / achievement / save posts; `abandoned` +1.
- **S-g slow portal** (replies after 9 s) → retries, then synced; no push before the reply.
- **S-h foreign origin** (parent served from `http://evil.localhost:5186`) → replies ignored, state `guest`.
- CHANGED(review) **S-i burst unlocks**: a fresh signed-in account finishes one match that unlocks ≥ 4 achievements →
  the stand-in's `__MSGS__` shows the `forgeflow:achievement` posts ≥ 2.9 s apart (wall clock), no slug twice, all of
  them delivered within `N × 3 s + 5 s`; the score and save posts are not delayed by the queue.
- CHANGED(review) **S-j blocked storage**: the context blocks `localStorage` (an init script that makes the getter
  throw); signed in; two matches in two page loads → the stand-in's merged record has exactly one slot,
  `nostore-<tag>`, holding both matches.
- CHANGED(review) **S-k statsdev under a production origin**: Playwright routes `https://forgeflowgames.com/__df_portal`
  (intercepted, never fetched from the network) to the same stand-in page, so its replies come from an allowlisted,
  non-localhost origin; the game frame carries `?statsdev=1` → state `signed-in`, and no score / achievement / save
  post all session. A second context on the same page without `statsdev` only checks that the `load` reply from that
  origin is accepted (state `signed-in`); posting itself is covered by S-b.
- **UI**: CAREER opened via `#dfm-career` (mouse, keyboard Enter, pad A), BACK / ESC return to the title; screenshots
  at 1280 × 720 and 852 × 393 (touch); `menus.py`-style layout check on the panel; the toast's box never intersects a
  `.df-victory .df-btn` box; reduce-motion toast has no transform animation.
Reports to `_harness/_reports/statscheck.json`; shots to `_shots/stats_*.png`.

### G-S3 Existing gates after INTEGRATION (the integration stage runs them)
`npm run typecheck`; `npm run probe` and `npm run probe:washout` — capture their hash lines **before** wiring and diff
after (identical); `python _harness/menus.py --headless`, `layoutcheck.py`, `mobile.py`, `padcheck.py`,
`bootcheck.py`, `bootguard.py`, `playtest.py` — all pass. Other sessions load this box to 100 % CPU: a wall-clock fail
is confirmed by a rerun or tick-rate evidence before it is called real.

### G-S4 Seeder
`python pipeline/seed_dyefield_achievements.py` (dry run) prints 29 `insert`, 0 `differs`, writes the backup, exits 0.
`--apply` runs only in the seeding stage; then a read-only re-query shows 29 dyefield rows, 340 points in total.
CHANGED(review): the seeding stage runs (and verifies) **before** the game deploy that ships the bridge (§S7).

### G-S5 Real end-to-end (reserved for the orchestrator, after deploy + seed)
On forgeflowgames.com with the owner signed in (signing in is the owner's action), play one TEAMS · TURF match on
SWELL to the horn, painting normally. Then read-only via REST (service key, game_id 53): `user_achievements` has
`first_match` (+ any others the slate's toasts showed); `leaderboard_scores` has the slate's score for this week;
`game_saves` slot 1 holds `{v:1, game:'dyefield', tags, slots}` with this device's slot; `profiles.xp` rose by the sum
of the unlocked points. Reload the game page: CAREER shows the match from the cloud.

---

## S13 Out-of-scope findings (named, not fixed here)

1. **Ratings are dead site-wide**: migration 0004 is not in production and cannot apply as written (its
   `CREATE TABLE IF NOT EXISTS game_ratings` would skip the existing, different table, then
   `CREATE INDEX … (game_slug, rating)` fails on the missing column). The ranked-play features of tide-breakers,
   warboard-chess, chroma-hide and pirates-cove silently do nothing. Recommendation: a separate, owner-approved portal
   task.
2. **Profile header always "0 games played · 0h 0m"**: nothing in `src/`, `pages/`, `supabase/` or `workers/` writes
   `profiles.games_played` or `profiles.total_play_time_seconds` (grep; the only writer is the absent 0004 RPC).
3. **Weekly seasons are week-of-the-MONTH**: `getCurrentSeasonWeek()` (`src/lib/auth.ts:163`) builds
   `ceil((monday.getDate() + jan1.getDay()) / 7)`, so labels repeat every month (`2026-W05` for the last Monday of
   several months) and a stale best can survive into a "new" week with the same label.
4. **Early bridge messages are dropped**: a message that arrives before `getUser()` resolves is lost with no reply
   (DYEFIELD works around it with probes + the outbox; a portal-side queue would fix it for every game).
5. CHANGED(review) **Achievement unlock races (every game)**: `addXP` is read-modify-write (concurrent unlocks lose
   XP), and `unlockAchievement` ignores its insert error and still grants XP (concurrent duplicate posts double the
   XP). Games that post several unlocks at once (most of them) are affected today; DYEFIELD paces its posts (§S3.3).
   Recommendation: a portal-side RPC that inserts with `ON CONFLICT DO NOTHING` and only on an actual insert does
   `xp = xp + points` in one statement. A production schema change → owner-approved portal task.
6. CHANGED(review) **Unknown slugs are dropped silently**: a post for a slug without an `achievements` row gets no
   reply and no retry. Hence seed-before-deploy (§S7).

## S14 Lane ownership (parallel build)

| Lane | Owns | Must not edit |
|---|---|---|
| STATS (build) | everything in §S1 | `core/**`, `main.ts`, `game.ts`, `menus.ts`, `hud.ts`, `slates.ts`, `testsurface.ts`, `package.json`, existing gates |
| INTEGRATION | the lines in §S10, `package.json` `probe:stats` | `runtime/src/stats/**` (bugs go back to STATS) |
| ONLINE | its own modules; supplies `OnlineMatchInfo` / `onlineEnd(status, OnlineFinal)` (§S9.1) | `runtime/src/stats/**` |
| SEED (orchestrator stage) | runs §S7 `--apply` after a dry run, **before** the game deploy (CHANGED(review)) | — |

CHANGED(review): INTEGRATION runs before the ONLINE lanes' edits to `game.ts`, `main.ts`, `ui/menus.ts` (§S10.2);
they are never edited by two lanes at once.

Checkpoint for the STATS build lane: `scratchpad/online/stats/PROGRESS.md`, one dated line per milestone.
