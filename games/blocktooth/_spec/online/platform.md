# BLOCKTOOTH ONLINE: ForgeFlow Games platform audit (lane: platform)

STATUS: COMPLETE, 2026-10-01. Read-only research. No game code, portal code, schema or deploy was changed.
Live probes were read-only: anon/publishable-key REST GETs, plus RPC calls that either return data
(`find_users`, `played_leaderboards`) or fail with "function not found" before running anything.

Labels: **verified** = seen this session in a file (file:line) or a live response. **inferred** = reasoned
from verified facts, not observed directly. **assumed** = not checked.

---

## 1. Outcome (read this first)

1. **The brief has one project wrong.** ForgeFlow Games uses TWO Supabase projects (verified, §2):
   - `qkidwgyapmitrdxnavmi` holds the games registry, accounts (`profiles`), achievements and
     leaderboards. The portal runs on it, and so does `deploy_game.py`.
   - `wugoxdewcdxzfppgzohy` is used only for Realtime multiplayer (the NetPlay lobby and rooms). Its `public.profiles` table does
     not exist.
2. **Games do not read the logged-in player directly.** `ffg_ratings.js` (and HIT PARADE's port of it) claims
   to read a "same-origin" session. That fails for two separate reasons. First, games are served from
   `forgeflow-games-cdn.isimcha85.workers.dev`, a different origin from `forgeflowgames.com`. Second, the
   file points at the wrong project. The one path that works is the **postMessage bridge**: the game sends
   messages to the portal page that frames it (`src/lib/gameBridge.ts`), and the portal writes with its own
   session. LAST CIRCLE uses it today for scores, achievements and cloud saves (§3).
3. **No game has working win/loss ratings.** The `report_match_result` RPC from migration 0004 does not exist on
   either project (verified: PGRST202 with the exact parameter names). `match_results` and `game_leaderboard`
   are also missing. A `game_ratings` table does exist on qkid, but with a different, older set of columns
   (no `game_slug` column).
4. **Usable platform infrastructure for BLOCKTOOTH:** accounts and profiles, per-game achievement definitions
   plus unlocks with XP, a weekly score board (`leaderboard_scores`) and cloud saves (`game_saves`), all
   reachable through the bridge. **Missing:** per-player game STATS, per-titan/per-city records, VS match
   results, per-game leaderboard boards, portal UI for any of these, and a bridge message that tells the game
   who is signed in (needed for VS nameplates and match reporting).
5. **BLOCKTOOTH is already in the registry** (verified: id 52, `status=unpublished`, CDN index and thumbnail
   both return 200). It has **0 achievements seeded**. `deploy_game.py` does not seed achievements; only the
   macro pipeline does (§6).
6. **Recommendation:** one new migration on qkid, `0008_blocktooth_stats.sql`, with 6 tables and 4 SECURITY DEFINER RPCs,
   and clients get no direct write access (§8). Seed the 46 local goals as platform achievements with the
   existing service-role RPC (§9). Add 3 bridge messages (`forgeflow:whoami`, `forgeflow:run_result`,
   `forgeflow:vs_result`), a stats/leaderboard panel on the game detail page, and a BLOCKTOOTH card on the
   profile page (§10).

---

## 2. Two Supabase projects (verified; corrects the brief and two memory notes)

| Project ref | Holds | Evidence |
|---|---|---|
| `qkidwgyapmitrdxnavmi` | `games` registry (43 rows), `profiles` (3), `achievements` (85), `user_achievements` (33), `leaderboard_scores` (1), `game_saves`, `daily_badge`, `user_game_activity`, `leaderboard_trophies`, `friendships`, an old-shape `game_ratings` | `forgeflow-games/.env` sets `VITE_SUPABASE_URL=https://qkidwgyapmitrdxnavmi.supabase.co`. Prerender fallback at `pages/games/@slug/+onBeforePrerenderStart.ts:9`. Live REST GETs with the publishable key return the row counts shown (Content-Range). |
| `wugoxdewcdxzfppgzohy` | Realtime Broadcast + Presence for every MP game; `df_scores`/`df_dungeons` (Dungeon Forge, 0006); `game_events` | `pipeline/engine/runtime/net/ffg_netplay.js` is project-agnostic. Each game hard-codes wugox, e.g. `games/last-circle/runtime/3d/royale/net.js:34`, `games/hit-parade/runtime/src/net/netplay.ts:12`. Live: `profiles`, `achievements`, `game_ratings` → 404 42P01 "relation does not exist". `games` → 200 with 0 rows. `df_scores` → 3 rows. |

Stale records to fix (out of scope, flagged):
- Memory `reference_forgeflow_games_deploy.md` says the `games` table lives on wugox. It lives on qkid.
- Memory `reference_ffg_registry_service_key.md` says "`report_match_result()` exists". The live probe says it does not
  exist on qkid (PGRST202 "Could not find the function public.report_match_result(p_black, p_game, p_match_id,
  p_result, p_white)"). It is missing on wugox too.

Migrations are applied by hand. The files say "Apply via Supabase Dashboard → SQL Editor" (`0002_user_accounts.sql:2`,
`0004_game_ratings.sql:2`). The live schema has drifted from them (verified):
- `achievements` has `icon_url` and `icon` columns. 0003:74 only defines `icon`.
- `user_game_activity` has no `high_score` or `created_at` column. 0003:131-132 defines both.
- `leaderboard_scores` has no `updated_at` column (live keys: created_at, game_id, id, score, season_week, user_id). 0002:109 defines it.
- `games` has `has_mobile_support`, `inspired_by`, `play_count`, `rating_sum`, `rating_count`, `screenshot_urls`. None of these come from a migration file.
- `game_ratings` (qkid) has columns `id, user_id, game_id, rating, created_at` (verified by per-column selects), and 0 rows. It is not 0004's table. It looks like a star-rating table that goes with `games.rating_sum/rating_count` (inferred).
- `seed_game_achievements(p_game_id, p_rows)` and `played_leaderboards(p_season_week)` exist live (PostgREST hint names
  their signatures; `played_leaderboards` and `find_users` returned 200 `[]`). `seed_game_achievements` is not defined
  in any migration file. 0005:58-59 only revokes and grants it.

**Rule for BLOCKTOOTH:** every new table and RPC goes on **qkid**, because that is where `auth.uid()` from the portal
session is valid. Realtime matchmaking stays on wugox. It needs no auth.

---

## 3. How a game gets the logged-in player

### 3.1 The path that works: the postMessage bridge (verified)
- The portal renders the game in an iframe. `src/components/game/GamePlayer.tsx:167-181`: `src=game.game_url + ?v=<build_version>-<nonce>`,
  and at :175 it forwards the portal's `?room=` query param into the iframe. Sandbox:
  `allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms` (:177);
  allow=`autoplay; fullscreen; gamepad; pointer-lock` (:178).
- The game URL is cross-origin. `deploy_game.py:828` sets `game_url = https://forgeflow-games-cdn.isimcha85.workers.dev/<slug>/index.html`.
  GamePlayer's own comment says so: "The game is served cross-origin from the CDN worker" (`GamePlayer.tsx:66-67`).
- Clicking Play calls `initGameBridge(slug, id)` (`GamePlayer.tsx:99-103`). That reads the PORTAL session with
  `supabase.auth.getUser()` (`gameBridge.ts:36-39`), and from then on routes `forgeflow:*` messages that come from an
  embedded iframe (source check at `gameBridge.ts:105-107`):

| Message (game → portal) | Portal action | Table | Cite |
|---|---|---|---|
| `forgeflow:score {score}` | `submitScore`: keeps the season best | `leaderboard_scores` | gameBridge.ts:117-122, auth.ts:171-193 |
| `forgeflow:achievement {achievementSlug}` | looks up `(game_id, slug)`, inserts the unlock, adds XP = points × daily-badge multiplier | `achievements`, `user_achievements`, `profiles.xp` | gameBridge.ts:124-131, 181-231 |
| `forgeflow:level_complete` / `forgeflow:game_over {score}` | `submitScore` | `leaderboard_scores` | gameBridge.ts:134-150 |
| `forgeflow:save {data, slot}` | read-merge-write (never drops keys) | `game_saves` | gameBridge.ts:152-157, 248-276; saveMerge.ts:17-29 |
| `forgeflow:load {slot,_reqId}` → `forgeflow:save_loaded {data,_reqId}` | reply to the sending frame | `game_saves` | gameBridge.ts:159-177 |
| (on Play) | upserts the activity row, sets online status | `user_game_activity`, `profiles` | gameBridge.ts:39-52 |

- XP comes ONLY from achievements (`gameBridge.ts:54-59`). The platform level is the sum of achievement points.
- Guests and standalone play are no-ops: `currentUserId` is null (`gameBridge.ts:119,127`). The SDK no-ops when `top===self`
  (`public/forgeflow-sdk.js:22-29`).
- **The game never learns WHO is signed in.** No bridge message returns identity. The only reply type is
  `forgeflow:save_loaded` (grep of `forgeflow:[a-z_]+` across the repo, every hit listed). VS nameplates and match
  reporting need one (§10.1).

### 3.2 The path that does not work: `ffg_ratings.js` / HIT PARADE `ratings.ts` (verified defects)
- `pipeline/engine/runtime/net/ffg_ratings.js:13-15` creates a supabase-js client on **wugox** and calls `auth.getUser()`
  (:29-42), with the comment "same localStorage session key the portal uses (same origin)" (:22-23).
  HIT PARADE copies it (`games/hit-parade/runtime/src/net/ratings.ts:2,31-32`).
- Defect 1, origin (verified): the iframe origin is the CDN worker and the portal origin is `forgeflowgames.com`
  (`workers/games-cdn/wrangler.toml:10` `ALLOWED_ORIGIN`; `GamePlayer.tsx:66`). localStorage is partitioned by origin, so the
  game cannot see the portal's session.
- Defect 2, project (verified): even on the same origin, the portal session belongs to qkid. supabase-js stores it
  under `sb-<project-ref>-auth-token` (inferred from supabase-js defaults; the HIT PARADE comment at ratings.ts:19 confirms
  the key pattern), so a wugox client never finds it. wugox has no `profiles` table either.
- Defect 3, RPC (verified): `report_match_result` does not exist on either project. HIT PARADE found the same thing on
  2026-09-30 (`ratings.ts:53-58`).
- Result (inferred): `currentPlayer()` returns null in the portal iframe for every player, so every "rated" match in
  chess, tide-breakers, pirates-cove, chroma-hide and hit-parade is silently unrated. **BLOCKTOOTH must not copy
  `ffg_ratings.js`.**

### 3.3 Guest → sign-in edge cases (verified gaps)
- `initGameBridge` captures the user once (`gameBridge.ts:36-39`) and has no `onAuthStateChange`. A player who signs in
  after pressing Play files nothing until a page reload.
- `useGame` loads only `status='published'` (`src/hooks/useGames.ts:61`). While BLOCKTOOTH is unpublished the detail page
  shows "Game Not Found" (`pages/games/@slug/+Page.tsx:34-41`), so **the bridge cannot be exercised on forgeflowgames.com
  before publishing.** Test against a local bridge host instead. LAST CIRCLE has one
  (`games/last-circle/_harness/bridge_host.html`, `portalcheck.py`); ASCENDANT has `_harness/portal_stub.html`.
- Clipboard (inferred): the iframe `allow=` has no `clipboard-write` (`GamePlayer.tsx:178`), so `navigator.clipboard`
  inside the game is likely blocked on the portal. Show the room code and invite link as text, or ask the portal to copy
  them via a bridge message.

---

## 4. Existing STATS / ACHIEVEMENTS / LEADERBOARD infrastructure

### 4.1 Schema (migration file:line → live status on qkid)
| Object | Defined | Live (qkid) | Writers | Notes |
|---|---|---|---|---|
| `profiles` (level, xp, total_play_time_seconds, games_played, is_online, current_game_slug) | 0002:14-27 | 3 rows | signup trigger (0003:15-59), UserMenu upsert, `addXP` (auth.ts:134-148) | public read; owner update (0002:36-46) |
| `leaderboard_scores` (user, game_id, score, season_week) | 0002:102-111 | 1 row (2026-W02, from 2026-05-06) | bridge `submitScore` | owner insert/update (0002:125-134). See §11 for the week-label bug. |
| `game_saves` (+slot) | 0002:139-147, 0003:309-326 | 0 rows; `slot` column present | bridge save | owner all (0002:151-155) |
| `achievements` (game_id, slug, name, description, tier, points, secret, icon) | 0003:65-77 | 85 rows: game 6:25, 2:21, 13:16, 41:9, 40:8, 19:6 | service role only (0005:39-43,53-59) | **BLOCKTOOTH (52): 0** |
| `user_achievements` | 0003:87-103 | 33 rows | bridge (owner insert 0003:101-103) | public read |
| `daily_badge` | 0003:108-118 | 0 rows | none (0005:45-47) | 2× XP spotlight |
| `user_game_activity` | 0003:124-147 | **0 rows** | bridge on Play | drives `played_leaderboards` (§11) |
| `leaderboard_trophies` | 0003:151-167 | 0 rows | no writer in repo (grep) | weekly trophies, never awarded |
| `friendships`, `find_users()` | 0003:173-247 | 0 rows / exists | friends page | |
| `played_leaderboards(p_season_week)` | 0003:253-303 | exists, 200 `[]` | – | the only leaderboard read the portal uses |
| `game_ratings` / `match_results` / `report_match_result` / `game_leaderboard` (0004) | 0004:18-142 | **not applied** (old-shape `game_ratings`; others missing) | – | §3.2 |
| `df_dungeons` / `df_scores` (Dungeon Forge) | 0006 | on **wugox**, anon insert | game direct | the precedent for game-owned leaderboard tables (anon, unauthenticated) |
| `games.mobile_support` | 0007 | present | deploy_game from game_meta.json (deploy_game.py:611-613) | |

### 4.2 Portal UI that exists
| Page | Reads | Cite | Gap for BLOCKTOOTH |
|---|---|---|---|
| `/profile` | profile header (level, games_played, play time), last 20 unlocked achievements, trophies, recently played | `pages/profile/+Page.tsx:21-48, 76` | No per-game stats or records. "Recently Played" is empty because `user_game_activity` has 0 rows. |
| `/achievements` | all achievements grouped by game, daily badge, my unlocks | `pages/achievements/+Page.tsx:16-41` | BLOCKTOOTH appears automatically once its rows are seeded. |
| `/leaderboards` | `played_leaderboards` RPC only, signed-in only, current `season_week` | `pages/leaderboards/+Page.tsx:31-49, 65-76` | One number per game per week. No per-mode, per-titan or per-city boards. |
| `/games/<slug>` detail | game row, GamePlayer, description, controls, tags, screenshots | `pages/games/@slug/+Page.tsx:46-199` | **No leaderboard, stats or achievements panel and no "Play online" mention**. The sidebar holds only screenshots (:168-182). |
| `/friends` | friendships, `find_users` | `pages/friends/+Page.tsx:22-85` | none needed |

### 4.3 Games that already write stats or achievements (grep of `forgeflow:` emitters)
- **LAST CIRCLE** (id 19): `forgeflow:achievement` (`runtime/3d/ffg_royale3d.js:155-160`), `forgeflow:save`
  (:161-167), `forgeflow:game_over` with score = placement×100 + kills×200 + victory×1500 (:868-879), and a cloud
  restore with a write-lock (`runtime/3d/royale/hud.js:897-940`). 6 achievements seeded with custom points 20-100 (live).
  **This is the reference implementation for BLOCKTOOTH.**
- **ASCENDANT** (id 50): cloud save/load (`runtime/net/portalsync.js:10-12, 146, 229`).
- **COSMIC COILS** (id 23): `forgeflow:game_over` (`runtime/3d/game.js:246`).
- Legacy template games send `forgeflow:level_complete` (pipeline/templates/*).
- Nobody writes per-player game stats beyond one score. **No platform table exists for game-specific stats.**

---

## 5. Online play (relevant platform facts only; netcode is the netcode lane's)
- `NetPlay` (`pipeline/engine/runtime/net/ffg_netplay.js:105-199`) is **2-player**: presence `present = ids.length >= 2`
  (:143), and quick match pairs "the two lowest peer-ids" (:156-185). A 4-player lobby with bot fill needs the
  N-player pattern from LAST CIRCLE / HIT PARADE's own net layers, not the stock class (inferred; see netcode.md).
- Room channel `ffg:<gameId>:<CODE>` (:133), lobby `ffg-lobby:<gameId>` (:160), on wugox with the anon key. That is
  fine, because Realtime needs no auth.
- Invite links: the portal already forwards `?room=` from `forgeflowgames.com/games/blocktooth?room=ABCD` into the iframe
  (`GamePlayer.tsx:175`). BLOCKTOOTH only needs to read `room` from its own `location.search`.
- Identity inside a match must come from the bridge (§10.1) and is carried in Presence. It is self-asserted, so treat it
  as display data. Results are trusted server-side only per reporter (`auth.uid()`).

---

## 6. Putting BLOCKTOOTH on forgeflowgames.com: exact steps and gotchas

Current state (verified live): registry row id 52, `status=unpublished`, `game_url` = CDN index, `thumbnail_url` =
`.../blocktooth/thumbnail.png?v=e46435bd`, `mobile_support=none`, `build_version=20261001T161109Z`, genre `action`,
tags include `singleplayer`. CDN `index.html` → 200, `thumbnail.png` → 200.

1. **Build:** `npm run build` in `games/blocktooth` → `dist/` (base `./`, per the `vite.config.ts` header). `dist/` contains
   `index.html`, `assets/` (content-hashed), `fonts/`, `game_meta.json`, `thumbnail.png` (verified listing).
2. **game_meta.json** lives in `public/game_meta.json` and is copied into dist. Fields `deploy_game.py` reads
   (`insert_game_metadata`, deploy_game.py:577-613): title, description, short_description, genre, sub_genre,
   controls_keyboard, controls_gamepad, difficulty, tags, mobile_support, plus art_direction for cover generation (:784).
   Before VS ships, update it:
   - `tags`: drop `singleplayer`, add `multiplayer`, `online`, `pvp`, `bots` (DYEFIELD's live tags are the model).
   - `description`: it currently says "BLOCKTOOTH is a single-player survivor-like" and "A run lasts roughly 8 to 12 minutes".
     The run is ~20 minutes now (`src/data/goals.ts:27`, owner decision 11), so update both.
   - add `controls_gamepad` (currently folded into controls_keyboard).
   - add `"mobile_support": "none"` explicitly (only written when declared, deploy_game.py:606-613).
   - **Do not put `status` in the file.** deploy_one strips it (deploy_game.py:757-767). Publishing is the toggle's job.
3. **Thumbnail:** keep `public/thumbnail.png`. deploy_one generates an xAI cover only when the file is missing
   (deploy_game.py:777-797). The URL is cache-busted by an md5 of the bytes (:829-836). Gotcha: `generate_cover.py --out
   games/<slug>` overwrites `thumbnail.png` (memory `reference_forgeflow_games_deploy.md`).
4. **Deploy:** `python pipeline/deploy_game.py --game-dir games/blocktooth/dist --slug blocktooth`.
   - Upload order: body, then `index.html`, then `game_meta.json` last. A failure in a critical file withholds the entry page
     (deploy_game.py:11-19, 376-470).
   - CF cache purge for uploaded keys (:832).
   - Registry PATCH with the **service-role key** (since 0005). Stamps `build_version` and `updated_at` (:615-618).
     **Never changes status** on an existing row (:619-630); a new row lands `unpublished`.
   - Then runs `deploy_portal.py` to refresh the prerender (:683-713). Skip with `--no-portal`.
   - `--status published` exists (:853-855) but is the owner's call. Publishing = owner toggle (`client-portal/functions/
     api/admin-game-publish.ts:5-17`, which writes `status` on qkid).
5. **After the owner publishes:** the toggle does NOT rebuild the portal (admin-game-publish.ts only PATCHes status, :74-77).
   The catalog card appears within about 60 s (runtime React Query, `useGames.ts:16-18`). The **detail page prerender**
   only exists after `python pipeline/deploy_portal.py` runs, because prerender enumerates `status=eq.published` slugs
   (`+onBeforePrerenderStart.ts:14`). Until then a hard load falls through the SPA catch-all (`public/_redirects:3`).
6. **Achievements seeding** (not done by deploy_game.py): call `seed_game_achievements(52, rows)` with the service key,
   the same way `scripts/run_game_pipeline.py:5007-5081` does (`_seed_achievements`). It is idempotent per (game_id, slug). Rows: §9.
7. **New SQL** (§8) is applied the way previous migrations were: by hand in the SQL editor, or via the Management API
   (memory `reference_ffg_registry_service_key.md`). It is a schema change on a live shared DB, so it needs explicit owner OK.
8. **Verify (done = observed):** CDN 200 for index + an asset; registry row `build_version` changed; after publish,
   `forgeflowgames.com/games/blocktooth` title + iframe src; a signed-in test run creates rows in `bt_runs` /
   `user_achievements` (REST read).
9. Optional: add `blocktooth` to `IMMUTABLE_HASHED_GAMES` in `workers/games-cdn/src/index.js:87` (DYEFIELD only today)
   for year-long caching of hashed assets. That is a worker deploy and a separate change.

---

## 7. What is MISSING for BLOCKTOOTH

| Need (owner ask) | Exists? | Missing piece |
|---|---|---|
| Logged-in player identity in game | partial (portal session via bridge; game blind) | `forgeflow:whoami` → `forgeflow:identity` bridge reply; re-check on auth change |
| STATS per player (per titan, per city, best times, kills, size reached) | no | tables `bt_player_stats`, `bt_titan_stats`, `bt_bests`, log `bt_runs`; RPC `bt_submit_run`; bridge `forgeflow:run_result` |
| VS wins/losses, placements | no (0004 not applied, 2-player only) | `bt_vs_matches`, `bt_vs_results`, RPC `bt_report_vs`; bridge `forgeflow:vs_result` |
| ACHIEVEMENTS | infra yes, rows no | seed 46 goal rows + ~6 VS rows for game 52; game emits `forgeflow:achievement` on goal completion + one-time backfill |
| LEADERBOARD | weekly single-score only, gated on an empty table | RPC `bt_leaderboard(board, titan, biome, period)`; detail-page panel; also emit `forgeflow:game_over` so the generic page lists BLOCKTOOTH |
| Online quick match + join | transport yes (2-player class) | N-player lobby (netcode lane); invite link via existing `?room=` passthrough |
| Cross-device unlock sync | infra yes | `forgeflow:save/load` of the local `Profile` with LAST CIRCLE's write-lock pattern |
| Portal UI | no | detail-page "Records & Leaderboards" panel, profile-page BLOCKTOOTH card, "Online: 4-player VS" line |

---

## 8. Recommended schema: `supabase/migrations/0008_blocktooth_stats.sql` (on qkid)

Design rules:
- Clients get **read-only RLS** (public SELECT, so leaderboards work for guests). **No INSERT/UPDATE grants.**
  All writes go through SECURITY DEFINER RPCs granted to `authenticated` only, keyed on `auth.uid()`. This is the 0004
  pattern (0004:33-37, 134), with stricter grants.
- Idempotent per run (`run_nonce`) and per VS report (`match_id, user_id`), so a retried postMessage never double-counts.
- Plausibility bounds in the RPC. Honest limit: results are still **client-authoritative**. A determined player can
  forge a run, because the sim runs in their browser. Bounds stop junk, not a crafted cheat. Leaderboards should be framed
  as casual. A later hardening option is replay validation, since the sim is deterministic at 30 Hz: submit seed + input
  log and re-sim server-side (inferred feasible; out of scope here).
- Enum values mirror the game: `TITAN_IDS` ['molo','voltkite','hearthback','briarwick'] (`src/core/types.ts:41`),
  `BIOME_IDS` ['grideast','whitestacks','lockwater'] (:42), `BOSS_IDS` ['caisson4','irongully','parkade6'] (:23).
  Run result is `'clear'|'dead'` (`types.ts:491`). Size rank is 0..4 (`meta/tally.ts` TallyV2.peakRank).

```sql
-- 1. Every finished run (solo, endless continuation, or VS), append-only audit + source for "weekly" boards
create table public.bt_runs (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  run_nonce     text not null check (char_length(run_nonce) between 8 and 64),
  mode          text not null check (mode in ('solo','vs')),
  titan         text not null check (titan in ('molo','voltkite','hearthback','briarwick')),
  biome         text not null check (biome in ('grideast','whitestacks','lockwater')),
  result        text not null check (result in ('clear','dead','vs_win','vs_place')),
  placement     smallint check (placement between 1 and 4),          -- VS only
  duration_s    integer not null check (duration_s between 5 and 14400),
  clear_s       numeric(7,1) check (clear_s > 0),                     -- solo clears only; lower is better
  level         smallint not null check (level between 1 and 99),
  peak_rank     smallint not null check (peak_rank between 0 and 4),  -- SIZE I..V
  kills         integer not null check (kills >= 0),
  crushed       integer not null default 0 check (crushed >= 0),
  tonnage       bigint  not null check (tonnage >= 0),
  blocks        integer not null default 0 check (blocks >= 0),
  bosses        smallint not null default 0,                          -- containment bosses defeated
  gate_kills    smallint not null default 0 check (gate_kills between 0 and 99),
  endless_s     integer not null default 0,
  endless_score integer not null default 0,
  titans_eaten  smallint not null default 0,                          -- VS: rival titans defeated
  vs_match_id   text,
  build_version text,
  created_at    timestamptz not null default now(),
  unique (user_id, run_nonce)
);
create index bt_runs_board_clear on public.bt_runs (biome, clear_s) where result = 'clear';
create index bt_runs_board_ton   on public.bt_runs (biome, tonnage desc);
create index bt_runs_user        on public.bt_runs (user_id, created_at desc);
create index bt_runs_week        on public.bt_runs (created_at desc);

-- 2. Lifetime per player (profile card + "lifetime" boards)
create table public.bt_player_stats (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  runs int not null default 0, clears int not null default 0, deaths int not null default 0,
  play_s bigint not null default 0, kills bigint not null default 0, tonnage bigint not null default 0,
  blocks bigint not null default 0, bosses int not null default 0,
  best_level smallint not null default 0, best_peak_rank smallint not null default 0,
  vs_matches int not null default 0, vs_wins int not null default 0, vs_top2 int not null default 0,
  vs_titans_eaten int not null default 0, vs_rating int not null default 1200, vs_peak_rating int not null default 1200,
  updated_at timestamptz not null default now()
);
create index bt_player_vs on public.bt_player_stats (vs_wins desc);

-- 3. Per titan (titan mastery panel)
create table public.bt_titan_stats (
  user_id uuid references public.profiles(id) on delete cascade,
  titan   text check (titan in ('molo','voltkite','hearthback','briarwick')),
  runs int not null default 0, clears int not null default 0, play_s bigint not null default 0,
  kills bigint not null default 0, best_level smallint not null default 0, best_tonnage bigint not null default 0,
  vs_wins int not null default 0,
  primary key (user_id, titan)
);

-- 4. Records per (titan, city): a 1:1 cloud mirror of the local record book
--    (core/save.ts bestKey(titan, biome, stat); BEST_STATS = tonnage, blocks, kills, level, peakRank,
--     survivedS, clearS + endless endlessS/endlessScore/rematches; ui/broadcast.ts:58, game.ts:1488-1505)
create table public.bt_bests (
  user_id uuid references public.profiles(id) on delete cascade,
  titan text, biome text,
  clears int not null default 0,
  clear_s numeric(7,1),                 -- lower is better (null = never cleared)
  tonnage bigint not null default 0, blocks int not null default 0, kills int not null default 0,
  level smallint not null default 0, peak_rank smallint not null default 0, survived_s int not null default 0,
  endless_s int not null default 0, endless_score int not null default 0, rematches smallint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, titan, biome)
);

-- 5/6. VS matches (4 seats, humans + bot fill). One row per human reporter; the match row aggregates.
create table public.bt_vs_matches (
  match_id   text primary key check (char_length(match_id) between 8 and 80),  -- e.g. blocktooth:<room>:<startNonce>
  biome      text not null, humans smallint not null check (humans between 1 and 4),
  bots       smallint not null check (bots between 0 and 3),
  winner_id  uuid references public.profiles(id),    -- set only when the human reports agree (see RPC)
  reports    smallint not null default 0,
  created_at timestamptz not null default now()
);
create table public.bt_vs_results (
  match_id  text references public.bt_vs_matches(match_id) on delete cascade,
  user_id   uuid references public.profiles(id) on delete cascade,
  titan text not null, placement smallint not null check (placement between 1 and 4),
  claimed_winner uuid,                  -- who this reporter saw win (a human id, or null = a bot won)
  titans_eaten smallint not null default 0, peak_level smallint not null default 0, survived_s int not null default 0,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.bt_runs enable row level security;  -- same 3 lines for every bt_* table:
create policy bt_runs_read on public.bt_runs for select using (true);
revoke insert, update, delete, truncate on public.bt_runs from anon, authenticated;
```

### RPCs (SECURITY DEFINER, `set search_path = public`, `grant execute ... to authenticated` only)
1. **`bt_submit_run(p jsonb) returns jsonb`**
   - Requires `auth.uid()`. Validates enums and bounds:
     - `kills <= duration_s * 60` (generous; the gate bot fields about 2.2k foes in ~20 min per goals.ts:30-31)
     - `peak_rank` 0..4; `clear_s <= duration_s`; `result='clear' ⇒ clear_s not null`
   - `insert ... on conflict (user_id, run_nonce) do nothing`. A repeat returns `{already:true}`.
   - Upserts `bt_player_stats`, `bt_titan_stats` and `bt_bests` (GREATEST per stat, LEAST for clear_s).
   - Bumps `profiles.games_played` and `profiles.total_play_time_seconds`. The profile header reads both
     (`pages/profile/+Page.tsx:76`), and nothing writes play time today (inferred from grep: only the 0002 default).
   - Returns `{new_bests:[...], board_rank:{clear:n, tonnage:n}}` so the tabloid can print "#7 ON THE GRID-EAST BOARD".
2. **`bt_report_vs(p jsonb) returns jsonb`**
   - Requires `auth.uid()`. Upserts the match row (first reporter creates it), then inserts the caller's own
     `bt_vs_results` row. **A player can only write their own row.**
   - `winner_id` is set when every human reporter's `claimed_winner` agrees (unanimous among reports), or when
     `humans=1` (solo human vs bots).
   - `vs_wins` and the titan's `vs_wins` are credited only when the winner is confirmed. `vs_matches`, `vs_top2` and
     `vs_titans_eaten` credit the reporter's own row.
   - Also inserts a `bt_runs` row (mode 'vs') via the same path as 1.
   - Optional rating (phase 2): FFA Elo across the human players of a confirmed match, treated as pairwise results
     ordered by placement with K/(humans-1). Bots never move ratings.
3. **`bt_leaderboard(p_board text, p_titan text default null, p_biome text default null, p_period text default 'all')`**
   returns `(rank, user_id, username, avatar_url, value, titan, biome, achieved_at)`. Granted to `anon, authenticated`
   (public read). Boards in §10.3. `p_period in ('week','all')`, where week means `created_at >= date_trunc('week', now())`
   (UTC Monday; do NOT reuse `getCurrentSeasonWeek`, §11).
4. **`bt_player_card(p_user uuid)`** returns jsonb with lifetime, per titan, per city bests and VS for the profile and detail panels
   (one round trip). Public.

---

## 9. Achievements: map the 46 local goals to platform rows (game_id 52)

Source: `src/data/goals.ts:48-167` (21 general incl. 6 gatekeeper, 16 titan, 9 city; header :4).
Slug = the local goal id (stable; "Id kept: a met goal stays met", goals.ts:133). name/description = `name`/`desc`.
`secret=false`. Points follow the tier defaults the pipeline uses (bronze 5 / silver 15 / gold 30 / diamond 60,
`run_game_pipeline.py:5036`). LAST CIRCLE used custom points of 20-100 (live rows). Tiers below are a proposal, by difficulty:

| Tier | Goals |
|---|---|
| bronze (12) | g_first_broadcast, g_zoning_change, g_change_order, g_paperwork, g_signal_boost, g_running_errands, g_molo_speed_bump, g_bw_green_thumb, g_hb_full_pressure, g_ge_parking_violation, g_ws_thaw, g_lw_port_closed |
| silver (16) | g_skyline_adjusted, g_city_got_smaller, g_crowd_control, g_live_coverage, g_urban_renewal, g_still_on_air, g_gate_tipped_off, g_gate_line_crossed, g_molo_bite_sized, g_vk_grid_down, g_hb_warm_welcome, g_bw_rewilded, g_ge_rate_hike, g_ws_hairline, g_lw_shipping_delays, g_ge_curb_appeal |
| gold (13) | g_one_take, g_double_feature, g_gate_hang_up, g_gate_without_a_dent, g_gate_reissued, g_molo_curbside_pickup, g_vk_six_way_splice, g_vk_power_outage, g_hb_rolling_boil, g_bw_full_bloom, g_ws_cold_storage, g_lw_early_closing, g_full_programming |
| diamond (5) | g_gate_over_the_limit, g_molo_three_course, g_vk_coast_to_coast, g_hb_continental_drift, g_bw_canopy_cover |

12 + 16 + 13 + 5 = 46. Total = 12×5 + 16×15 + 13×30 + 5×60 = 990 XP. That reaches platform level 5 by itself (level 6 needs 1000)
(auth.ts:89-101). Vector Storm, by comparison, has 25 rows.

New VS achievements (proposal, about 6): `vs_first_match` "SYNDICATED" (finish a VS match, bronze), `vs_first_win`
"TOP OF THE HOUR" (win, silver), `vs_eat_titan` "CROSSOVER EPISODE" (defeat a rival titan, bronze),
`vs_full_house` "NETWORK EXCLUSIVE" (win a lobby of 4 humans, gold), `vs_win_each_titan` "ENSEMBLE CAST" (win with all 4,
diamond), `vs_win_10` "RATINGS WAR" (10 wins, gold).

Emission (game side):
- When `meta/goals.ts` marks a goal done, post `{type:'forgeflow:achievement', achievementSlug: goal.id}`.
  The portal is idempotent: it checks for an existing unlock (`gameBridge.ts:193-200`).
- **One-time backfill:** on boot, after `forgeflow:identity` confirms a signed-in user, post an achievement message for
  every id in `profile.done` (`meta/profile.ts:26-27`), so local progress made as a guest is credited.
- Seeding requires the service key (`seed_game_achievements` is service-role only, 0005:58-59). Run it once like
  `_seed_achievements` (`run_game_pipeline.py:5055-5081`).

Caveat (verified): `user_achievements` allows owner INSERT (0003:101-103) and `profiles` allows owner UPDATE including
`xp` (0002:42-46). Any signed-in user can self-grant achievements and XP with the public key. This is platform-wide and
existed before BLOCKTOOTH (§11).

---

## 10. Integration points

### 10.1 Bridge additions (portal `src/lib/gameBridge.ts` + game)
| New message | Direction | Handler |
|---|---|---|
| `forgeflow:whoami {_reqId}` | game → portal | reply `forgeflow:identity {_reqId, signedIn, id, username, avatar_url, level}` to the source frame (same reply pattern as `save_loaded`, gameBridge.ts:159-177). Also push `forgeflow:identity` on `supabase.auth.onAuthStateChange` (fixes §3.3). No token is passed into the iframe. |
| `forgeflow:run_result {payload}` | game → portal | `supabase.rpc('bt_submit_run', {p: payload})`, then reply `forgeflow:run_result_ack {_reqId, data}` (new bests / board rank for the tabloid). |
| `forgeflow:vs_result {payload}` | game → portal | `supabase.rpc('bt_report_vs', {p: payload})` + ack. |
| (optional) `forgeflow:request_login` | game → portal | open the UserMenu sign-in from an in-game "Sign in to save stats" button. |
| (optional) `forgeflow:copy {text}` | game → portal | the portal copies an invite link (iframe lacks clipboard-write, §3.3, inferred). |

Keep the RPC names generic if a second game wants stats later (e.g. `game_submit_run(p_game, p)` with a per-game
validator). For now a BLOCKTOOTH-specific pair is simpler and safer.

### 10.2 Game side (BLOCKTOOTH, `src/`)
- **Run end:** `Game.recordBests(w, result)` at `src/game.ts:1488-1505` already computes `runFigures(w, result)`
  (`ui/broadcast.ts:58-80`), which has tonnage, blocks, kills, level, peakRank, survivedS and clearS, plus the endless
  figures. Post `forgeflow:run_result` from the same spot. Add `run_nonce` (random per run), mode, titan, biome,
  duration, `crushed` (`w.tally.crushed`), `bosses` (`w.tally.bossesDefeated`), `gate_kills` (`w.tally.gateKills`) and
  `build_version`. Also post `forgeflow:game_over {score: tonnage}` so BLOCKTOOTH shows on the generic `/leaderboards`
  page (LAST CIRCLE pattern, `ffg_royale3d.js:868-879`).
- **Goals:** emit achievements where goals complete (meta/goals.ts evaluation). Backfill as described in §9.
- **Cloud profile:** `forgeflow:save {data:{profile, best}}` and `forgeflow:load`. Merge as union of `done`, max of `best`
  and max of the `life` counters. Do not push before a successful read; copy LAST CIRCLE's write-lock (`royale/hud.js:897-940`).
  Storage keys today: `blocktooth.profile.v1`, `blocktooth.best.v1` (`src/core/save.ts:37-38`).
- **Standalone / guest:** every call is a no-op when `window.parent === window` or `signedIn=false` (SDK convention,
  `public/forgeflow-sdk.js:22-29`).

### 10.3 Leaderboards (which boards)
On the detail page and in-game "THE BOARD", served by `bt_leaderboard`:
1. **FASTEST CLEAR**: one per city (GRID-EAST / WHITE STACKS / LOCKWATER), `clear_s` ascending, with a titan filter (all / each of 4).
   This mirrors goal EARLY CLOSING and the local `clearS` record.
2. **BIGGEST APPETITE**: most `tonnage` in one run, per city.
3. **EXTENDED COVERAGE**: best `endless_score` (`meta/endless.ts:211-225`), per city.
4. **VS WINS**: weekly and all-time. **VS RATING**: phase 2, min 10 matches.
5. **TITANS EATEN** (VS, all-time).
6. **LIFETIME**: total kills and total tonnage (vanity; profile-linked).

Periods: `week` (UTC Monday, computed server-side) and `all`. Top 100 rows plus "your rank" row.

### 10.4 Portal UI (forgeflow-games repo)
- `pages/games/@slug/+Page.tsx`: add a "RECORDS & LEADERBOARDS" section below the description (main column; the sidebar
  :168-182 is too narrow for tables) with board / city / titan tabs, plus "Your records" when signed in. Also add a line
  "Online: 4-player VS with quick match + invite code". Render it only for slugs with a stats module (a
  `GAME_STATS_PANELS[slug]` map), so other games are unaffected.
- `pages/profile/+Page.tsx`: a BLOCKTOOTH card from `bt_player_card` (lifetime, best per city, favourite titan, VS W/top-2).
- `/leaderboards` keeps working for BLOCKTOOTH via `leaderboard_scores` once `user_game_activity` is fixed (§11).
- Portal deploy = `python pipeline/deploy_portal.py` (memory `reference_forgeflow_games_deploy.md`).

### 10.5 Acceptance criteria (proposed)
- A signed-in solo run on the portal creates exactly one `bt_runs` row, updates `bt_bests`, and a re-sent message
  returns `{already:true}`. All checked by REST read.
- Finishing FIRST BROADCAST creates one `user_achievements` row for slug `g_first_broadcast` (game 52), and profile XP rises by its points.
- A 2-human + 2-bot VS match produces 2 `bt_vs_results` rows and one `bt_vs_matches` row with `winner_id` set when the
  claims agree. A guest in the same match produces no row and does not block the others.
- The detail page board shows the run for a guest viewer (public read).

---

## 11. Out-of-scope findings (named, not fixed)

1. **0004 ratings never applied** (verified, §3.2). Every "rated" online game is unrated, and `ffg_ratings.js` is broken
   by origin and project too. Recommend: fix the platform-wide identity path (bridge `whoami`) once, then apply a
   corrected 0004 on qkid. qkid's existing `game_ratings` has a different shape, so the new table needs another name
   (e.g. `game_elo`) to avoid a collision. Needs owner OK (schema change).
2. **`getCurrentSeasonWeek()` is wrong** (verified, `src/lib/auth.ts:163-169`). It uses day-of-MONTH, so labels run
   W01..W05 and repeat every month. The only live row is labelled `2026-W02` with a `created_at` of 2026-05-06. Weekly
   seasons therefore collide across months.
3. **`submitScore` upserts `onConflict: "user_id,game_id"`** (`auth.ts:184-191`), while 0002:110 declares
   `UNIQUE (user_id, game_id, season_week)`. If the live constraint matches the file, the upsert fails with no matching
   constraint, and the error is only `console.error`'d. The live constraint is not visible to the anon key (unverified).
4. **`/leaderboards` is empty for everyone** (inferred from verified facts). `played_leaderboards` only returns games in
   the caller's `user_game_activity` (0003:270-284), and that table has **0 rows** live even though the bridge upserts it
   on every signed-in Play (`gameBridge.ts:46-52`). The cause is not verified. Candidates: a missing `(user_id, game_id)`
   unique constraint making the upsert fail silently, or no signed-in plays since it shipped.
5. **Self-grantable achievements and XP** via owner-write RLS on `user_achievements` / `profiles` (verified policies,
   0003:101-103, 0002:42-46). Move unlock + XP into a SECURITY DEFINER RPC platform-wide when competitive features matter.
6. **Bridge captures the user once** with no auth listener (`gameBridge.ts:36-39`). §10.1 fixes this for BLOCKTOOTH.
7. **Stale memory notes** (§2): `reference_forgeflow_games_deploy.md` (registry project) and
   `reference_ffg_registry_service_key.md` ("report_match_result exists").
8. `leaderboard_trophies` and `daily_badge` have no writers (grep). The profile "Trophies" panel and the 2× badge are
   permanently empty.

---

## 12. Suggested order of work
1. Owner OK on the qkid migration `0008_blocktooth_stats.sql` (§8) and the achievement tier table (§9).
2. Portal: bridge `whoami` / `run_result` / `vs_result` + auth listener. Test on a local bridge host before publish (§3.3).
3. Game: run_result at `recordBests`, achievement emits + backfill, cloud profile sync, then VS reporting after the
   netcode lane lands N-player matches.
4. Seed achievements (service key), deploy the game (§6), deploy the portal with the detail panel.
5. The owner toggles publish, then run `deploy_portal.py` for the prerender (§6 step 5).
