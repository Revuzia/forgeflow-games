# BLOCKTOOTH ONLINE: the plan to approve

Status: PLAN FOR OWNER APPROVAL (2026-10-01). Read-only synthesis of the four lane docs in this folder:
`platform.md` (site, login, stats, achievements, leaderboards), `mp_refs.md` (how our other online games do it),
`vs_design.md` (the 4-titan VS rules), `netcode.md` (how the online match runs, with measurements). No game code,
portal code, schema or deploy was changed. Every fact below cites its source: `doc §n` refers to a sibling doc
(which carries the file:line evidence); `file:line` refers to code I checked myself this session. **[estimate]**
marks a rough number, **[inferred]** marks my reading.

Spot-checks I ran myself this session: `recordBests` is at `src/game.ts:1489` (platform.md says 1488, so the file
has moved by 1 line since that lane read it); `World.titan: TitanState` is at `src/core/types.ts:604`; the sim
freezes for drafts (`src/core/world.ts:114-116` comment); `src/data/goals.ts` has 46 `id: 'g_` goals;
`public/game_meta.json` still says "single-player". BLOCKTOOTH HEAD has moved on since the netcode lane measured
(`b3005a22` → `861779e3`, repair-crew changes), so line numbers will keep moving while the game is being built.

---

## 1. What players get (owner summary)

1. BLOCKTOOTH goes on forgeflowgames.com like our other games. You still decide when it goes public.
2. If they're signed in, every run they finish is saved to their account: kills, tonnage, size reached, time, and
   which titan and city.
3. Personal records for each titan in each city, kept in the cloud, so they carry over to another computer.
4. 46 achievements (the game's existing goals), plus about 8 new VS ones. They give site XP like other games.
   Anything already earned as a guest is credited the first time they sign in.
5. Leaderboards on the game's page: fastest clear per city, biggest appetite (most tonnage in a run), endless
   score, lifetime totals, and later VS wins.
6. A BLOCKTOOTH card on each player's profile page.
7. **Phase B, VS mode ("ZONING DISPUTE"):** 4 titans in one city. For 4 minutes everyone races to grow. Then they
   can fight. In the last 3 minutes a closing ring forces the final fight, and the last titan standing wins.
   Matches last 10 minutes.
8. Quick Match finds other players. Bots fill any empty seat, so a match always has 4 titans. Friends can join with
   a 4-letter room code or an invite link.
9. Practice VS against 3 bots works offline and ships before online play.
10. Phase A (stats, achievements, leaderboards) is small and ships first. Phase B (online VS) is a big rebuild of the
    game's core and comes after.

---

## 2. Decisions this plan already makes (where the lane docs disagreed)

| Topic | Decision | Why |
|---|---|---|
| Which database | Stats, achievements and leaderboards go on project **`qkidwgyapmitrdxnavmi`**. Live match rooms stay on `wugoxdewcdxzfppgzohy`. | The brief named wugox for everything. Accounts, the games list and achievements actually live on qkid, and wugox has no `profiles` table (platform.md §2). |
| How the game knows who is signed in | Through the portal's **message bridge** (`src/lib/gameBridge.ts`), plus a new "who am I" message. **Do not copy `ffg_ratings.js`.** | `ffg_ratings.js` can't see the login (the game runs on a different site) and points at the wrong project. Its RPC `report_match_result` doesn't exist on either project (platform.md §3.2). LAST CIRCLE's bridge use is the working model (§4.3). |
| Netcode | **Option C from netcode.md:** every player's browser runs the full game. The host sets the clock and passes everyone's inputs along. The game stream goes over **WebRTC** (peer to peer). Supabase only handles the lobby, quick match, connection setup and start/result messages. | mp_refs.md recommended host-run snapshots, mainly because the game's maths gives different results in different browsers. The netcode lane then measured that problem and fixed it: with a prototype `detmath`, all four browser engines matched bit for bit over 3 runs of 18,000 ticks each (netcode.md §6.4). C needs about 1-2 KB/s per player (snapshots: 20-95 KB/s). Bots cost no bandwidth, and if the host leaves the match carries on (netcode.md §5). |
| Who runs the bots and enemies | Every browser runs them identically (lockstep). | This replaces vs_design.md's "host runs the bots, each player runs their own enemies" (§8, §10). That idea was marked as the netcode doc's call. |
| Taking over a bot seat mid-match | Allowed until **3:00** (inside the 4-minute growth phase). | vs_design.md §10 says 3:00. netcode.md §7.2 caps it at 4:00. The earlier cutoff keeps the catch-up replay short (netcode.md §7.3). |
| Confirming a VS winner | Each player can only record their own result. A win counts on the boards only when **every human reporter names the same winner and at least 2 humans reported**. A match with 1 human and 3 bots counts toward personal stats only. | This combines platform.md §8 (agreement among human reports) with netcode.md §7.1 (at least 2 reporters agree). It also avoids the old ratings function's hole, where one player could record wins against anyone (mp_refs.md §5.4). |
| Ratings / Elo | Not in v1. VS WINS boards first. A rating can come later and only counts after 10 matches. | platform.md §8 RPC 2 and §10.3. The design builds the rating from head-to-head pairs of humans (vs_design.md §9). |
| 4-player quick match | New code. Up to 4 waiting players with the same game version are grouped. The lowest peer id hosts. After a short wait the host starts and bots fill the empty seats. | The shared NetPlay quick match only ever pairs 2 players (`pipeline/engine/runtime/net/ffg_netplay.js:78` `quickMatch`; mp_refs.md §2). |

---

## 3. Phase A: forgeflowgames.com + login + stats + achievements + leaderboards (solo game, ships first)

**Goal:** a signed-in player's solo runs, achievements and records show up on forgeflowgames.com. The game's
simulation code is not touched.

### A.1 What gets built
1. **Database migration `forgeflow-games/supabase/migrations/0008_blocktooth_stats.sql` (on qkid, needs your OK)**
   - **Tables:** `bt_runs` (every finished run), `bt_player_stats` (lifetime), `bt_titan_stats` (per titan),
     `bt_bests` (records per titan and city, mirroring the game's local record book), plus `bt_vs_matches` and
     `bt_vs_results`. The VS tables are created now and stay empty until Phase B.
   - **Read access:** everyone can read, so leaderboards work for guests. Clients can't write directly.
   - **Server functions:** `bt_submit_run`, `bt_report_vs`, `bt_leaderboard` and `bt_player_card`. Each checks the
     login, ignores a repeated submission (`run_nonce` / `match_id`) and rejects impossible numbers. The full SQL
     sketch is in platform.md §8.
2. **Achievements:** load the 46 goals into game 52 using the existing service-role function
   `seed_game_achievements` (bronze 12 / silver 16 / gold 13 / diamond 5 = 990 XP, platform.md §9). This is the same
   way `scripts/run_game_pipeline.py` `_seed_achievements` does it. `deploy_game.py` does not seed achievements.
3. **Portal bridge** (`src/lib/gameBridge.ts`): three new messages, `forgeflow:whoami` → `forgeflow:identity`,
   `forgeflow:run_result` → `bt_submit_run` + ack, and `forgeflow:vs_result` → `bt_report_vs` + ack. It also re-sends
   identity whenever the player signs in or out. Today the bridge checks the login only once, when Play is pressed
   (platform.md §3.3, §10.1). All of this is additive, so other games are unaffected.
4. **Portal UI:** a "RECORDS & LEADERBOARDS" panel on `pages/games/@slug/+Page.tsx`. It shows board, city and titan
   tabs, plus "your records", and appears only for slugs listed in a `GAME_STATS_PANELS` map. Also a BLOCKTOOTH card
   on `pages/profile/+Page.tsx` (platform.md §10.4).
5. **Game side** (BLOCKTOOTH `src/`; no sim changes):
   - a small `src/net/portal.ts` bridge client that does nothing when the game runs outside the portal or the
     player is a guest;
   - post `run_result` and `game_over {score: tonnage}` from `recordBests` (`src/game.ts:1489`);
   - post `forgeflow:achievement` when a goal completes, and once after sign-in for every goal already earned
     (`profile.done`);
   - sync the cloud profile through `forgeflow:save`/`load`, using LAST CIRCLE's write-lock (never save before a
     successful load);
   - a "Sign in to save your stats" line on the end screen for guests, and the board rank from the ack printed on the
     end screen ("#7 ON THE GRID-EAST BOARD").
6. **`public/game_meta.json`:** fix the run length ("8 to 12 minutes" → about 20) and add `controls_gamepad` and
   `"mobile_support": "none"`. Never put `status` in this file (platform.md §6.2). The `multiplayer`/`online` tags
   wait for Phase B.

### A.2 Ship sequence (each step is done when its effect is seen)
1. You OK the migration and the achievement tiers (§5, decisions D1-D2).
2. Apply 0008 in one transaction together with a SQL self-test: act as a fake signed-in user, submit a run, submit
   it again and expect `{already:true}`, submit an impossible run and expect it rejected, then remove the test rows.
   Then seed the achievements. Check by reading back with the public key: 6 `bt_*` tables exist, and game 52 has 46
   achievement rows.
3. Deploy the game: `python pipeline/deploy_game.py --game-dir games/blocktooth/dist --slug blocktooth`. It stays
   unpublished. Check: the CDN returns 200 and the registry `build_version` changed.
4. Deploy the portal (`python pipeline/deploy_portal.py`). Check: LAST CIRCLE's existing portal check still passes,
   and the new panel renders for a test slug.
5. **You publish** with the toggle, then run `deploy_portal.py` again so the game's own page is built (the toggle
   doesn't rebuild the portal, platform.md §6.5).
6. Live check: you (or a test account you choose) play one signed-in run on forgeflowgames.com. A public read then
   shows exactly 1 new `bt_runs` row, updated `bt_bests`, and the `user_achievements` row for any goal earned.
   A guest can see the board.

### A.3 Phase A gates and tests
| Gate | Pass condition |
|---|---|
| `npm run check` / build (game) and portal build | clean |
| Solo GATE 2 (`_harness/probe_sim.ts`) | hashes unchanged (Phase A must not touch the sim) |
| Bridge-host Playwright test (copy LAST CIRCLE `_harness/bridge_host.html` + `portalcheck.py` into `games/blocktooth/_harness/portal/`) | a scripted run sends exactly one `run_result` with valid fields; goal completion sends the right `achievementSlug`; the guest flow sends nothing; standalone play makes no errors |
| SQL self-test inside the migration transaction | duplicate rejected, bounds enforced, a client can't insert directly |
| Live signed-in run (step A.2.6) | rows observed by REST read |

**Effort [estimate]:** about 1,600-2,600 lines in total. SQL 350-500, portal 600-900, game side 400-700,
harness 300-500. With 4 parallel lanes, roughly 1-2 build days, plus the time to get your OKs.

**One limit (platform.md §8):** run results come from the player's browser, so a determined cheater can fake a run.
The server's bounds stop junk, not a carefully crafted cheat. The boards are casual. Checking runs by replaying them
on the server is possible later, because the game is deterministic.

---

## 4. Phase B: online VS (4 players, bots fill, quick match + join code)

### B.1 What gets built
- **Rules:** as in `vs_design.md` (pitch §0). 10:00 match plus up to 0:45 LAST CALL:
  - **OPEN HOUSE 0:00-4:00:** growth only; rival hits push but do no damage.
  - **HOSTILE TAKEOVER 4:00-7:00:** knockouts with respawn, losing 2 levels.
  - **FINAL NOTICE 7:00-10:00:** no respawns, and the ring closes.
  - **No size locks in VS:** the 3 gatekeepers become shared "PUBLIC TENDER" events whose rewards are split by damage.
  - **No city boss.**
  - **PvP damage** is a % of the victim's max HP, with a capped size edge.
  - **CARD RAIL drafts:** the game never pauses.
  - **Comeback rules**, plus bots at 3 difficulty levels, spectating and rematch.
- **Netcode (Option C, netcode.md §7.1):**
  - inputs are 4 bytes per player per tick;
  - the host clock runs in a Worker, so a hidden host tab doesn't slow it;
  - a late guest's previous input is repeated, so nobody waits;
  - a state hash every 30 ticks catches desyncs;
  - if the host leaves, the next player takes over the clock;
  - joining a bot seat replays the input log;
  - each guest's own titan is predicted on screen only, never in the sim.
- **Transport:**
  - Supabase Realtime on wugox for the lobby, presence, signalling and START/RESULT, about 200-400 messages per
    match (netcode.md §4);
  - WebRTC for the 30 Hz input stream, reusing LAST CIRCLE's `ffg_rtc.js` and HIT PARADE's `transport_rtc.ts`
    patterns;
  - HIT PARADE's TS `netplay.ts` as the room layer (pinned library, version gating, send budget), widened from 2 to
    4 players.
- **Join paths:** Quick Match fills to 4 and then bots. A room code or the `?room=CODE` invite link also works; the
  portal already passes it into the game (platform.md §5). A human can take over a bot seat until 3:00.
- **Results:** every peer computes the same standings. Each signed-in human sends `forgeflow:vs_result` through the
  bridge built in Phase A. The 8 VS achievements are seeded (D3).

### B.2 Build order (milestones)
1. **B-0 Deterministic maths (must come first).** Add `src/core/detmath.ts` and switch the roughly 520 browser-
   dependent maths calls to it. Add a grep ban on `Math.sin/cos/...` in sim folders and the cross-browser probe as a
   gate. This changes solo gameplay very slightly; molo's test clear moved from 1,190 s to 1,214 s
   (netcode.md §6.4). GATE 2 baselines are re-recorded once (D5).
2. **B-1 Multi-titan core contract.** Add `PlayerState` plus a "current player" pointer (`bindPlayer`), and an event
   sink that tags every event with its player. Add `createWorld({players})` and a solo/VS mode flag. Solo stays
   byte-identical after B-0.
3. **B-2 Offline VS BOTS (1 human + 3 bots).** Covers all VS rules, PvP, the CARD RAIL, tenders, the ring, the bot
   brain, the HUD and spectating. **Ships as a playable practice mode.** It proves the rules before any netcode
   (vs_design.md §14).
4. **B-3 Online.** 4-player quick match and room codes, the lockstep session, host migration, bot-seat takeover,
   reporting results, rematch.
5. **B-4 Publish VS:** `game_meta.json` tags get `multiplayer`, `online`, `pvp` and `bots`, and the description
   mentions VS. The game page gets the "Online: 4-player VS" line and the VS boards.

### B.3 Phase B effort [estimate, from netcode.md §2.3 and §3]
- Sim: 3,500-5,500 lines touched or new.
- Camera, HUD and screens: 2,000-3,500.
- Networking and tests: 1,700-2,400.
- **Total about 7,200-11,400 lines.**
- This is several times bigger than Phase A. Most of it is turning a game built around one titan (450 `w.titan`
  references in 64 files, netcode.md §2.1) into one that holds 4.

---

## 5. Owner decisions (each has a default this plan builds unless you change it)

| # | Decision | Recommended default |
|---|---|---|
| D1 | Apply migration `0008_blocktooth_stats.sql` on the live shared database (qkid). This is a schema change, so it waits for your OK. | **Yes, as specced** (platform.md §8). Adds tables only. No existing table changes. |
| D2 | Achievement tiers and XP for the 46 goals. Seeding uses the private service key. | **Yes:** bronze 12 / silver 16 / gold 13 / diamond 5, 990 XP total (platform.md §9) |
| D3 | VS achievements (8): SYNDICATED (finish a match), CERTIFIED HEADLINE (win), CROSSOVER EPISODE (knock out a rival), HOSTILE TAKEOVER (knock out the leader), ZONED RESIDENTIAL (win without being knocked out), NETWORK EXCLUSIVE (win against 3 humans), ENSEMBLE CAST (win with all 4 titans), RATINGS WAR (10 wins) | **Yes.** This merges platform.md §9 and vs_design.md §13. Seed them in B-4. |
| D4 | When to publish | **After the Phase A local tests pass.** The bridge can't be tested on the real site while the game is unpublished, because the page says "Game Not Found" (platform.md §3.3). Publishing stays your toggle. |
| D5 | Accept the small solo gameplay shift from deterministic maths (B-0) | **Yes.** It's required for online play. The 20-minute pacing gate must still pass after the change. |
| D6 | Last 3 minutes: elimination, or respawns all match with the winner by score? | **Elimination** (vs_design.md §15.1). It's the more dramatic finish. |
| D7 | VS match length | **10:00 + up to 0:45** (vs_design.md §3) |
| D8 | How long Quick Match waits for humans before bots fill | **20 s, plus a "Start now with bots" button** (vs_design.md §10, button added) |
| D9 | Do wins in matches with only 1 human (3 bots) count on the VS WINS board? | **No:** personal stats only. Boards need at least 2 humans, so nobody can farm bots. |
| D10 | Can guests (not signed in) play online? | **Yes**, shown as GUEST-xxxx, with no stats or board entries. |
| D11 | Spend for players whose home network blocks direct connections: a paid relay (TURN) or a Supabase plan upgrade. Which plan the project is on was **not checked** (mp_refs.md §7). | **$0 for now:** P2P only. Another peer can forward inputs, there is one free Supabase relay slot for the whole project, and otherwise the player gets a bot seat with a "couldn't connect" message. Revisit if many players fail to connect. |
| D12 | VS rating (Elo) | **Later**, after VS WINS boards. It counts only after 10 matches. |
| D13 | City boss cameo / 2v2 teams | **Not at launch** (vs_design.md §15.2-3) |
| D14 | Phones for VS | **Desktop only at launch.** `mobile_support` is `none` today. Phone performance with 4 titans gets measured first (netcode.md §8 H5). |
| D15 | Site-wide problems found along the way (not BLOCKTOOTH bugs): the weekly season label repeats every month; the /leaderboards page is probably empty for everyone; any signed-in user can give themselves achievements and XP; online "rated" matches in 5 games are silently unrated | **Separate follow-up tasks, not part of this plan** (platform.md §11). Ask for them by name when you want them. |

---

## 6. Build lanes, file ownership, gates

Rule: each lane owns its files exclusively. A lane that needs a change in another lane's file sends that owner a
short request and doesn't edit the file itself. Paths are relative to `forgeflow-games/` (portal) or
`forgeflow-games/games/blocktooth/` (game).

### 6.1 Phase A lanes (all 4 run in parallel)
| Lane | Owns | Output | Gate |
|---|---|---|---|
| A-SQL | `supabase/migrations/0008_blocktooth_stats.sql`, `games/blocktooth/_harness/portal/seed_achievements.py`, the SQL self-test | migration + seed script (applied only after D1/D2) | self-test inside the transaction; read-back counts |
| A-PORTAL | `src/lib/gameBridge.ts`, new `src/lib/btStats.ts`, new `src/components/game/StatsPanel.tsx`, `pages/games/@slug/+Page.tsx`, `pages/profile/+Page.tsx` | bridge messages + panel + profile card | portal build; LAST CIRCLE portal check still passes; panel renders only for mapped slugs |
| A-GAME | new `src/net/portal.ts`; hook lines in `src/game.ts` (at `recordBests`), `src/meta/goals.ts`, `src/core/save.ts`, the end-screen UI file; `public/game_meta.json` | the game's bridge client + emits + cloud profile | `npm run check`; GATE 2 hashes unchanged |
| A-QA | `_harness/portal/bridge_host.html`, `_harness/portal/portalcheck.py` | local stand-in portal + Playwright checks | the A.3 table |

Note: BLOCKTOOTH is still being built by other lanes (HEAD moved during this research). A-GAME's few hook lines in
`src/game.ts` should land when the current build lane is not editing that file.

### 6.2 Phase B lanes
Serial first: **B-DET** (detmath + the swap across the sim + grep ban), then **B-CORE** (`src/core/types.ts`,
`src/core/world.ts`, the VS block in `src/core/config.ts`, event sink, `PlayerState`/`bindPlayer`). Both touch files
across the whole sim, so nothing else edits the sim while they run.

Then in parallel:
| Lane | Owns | Work |
|---|---|---|
| B-TITAN | `src/titans/*`, `src/upgrades/*`, `src/meta/ultimate.ts`, `tally.ts`, `perks.ts` | per-player titans; titan bodies push each other apart; CARD RAIL offers in the sim (pick/reroll as an input) |
| B-WORLD | `src/ai/enemies.ts`, `src/ai/director.ts`, `src/ai/bosses/*`, `src/combat/*`, `src/city/*`, `src/meta/objectives.ts`, `powerups.ts`, `gates.ts`, `endless.ts` | enemies pick a titan to target; damage remembers who caused it; hostile hits test every titan; one director per player; hooks where PvP damage gets called; tenders replace the locks; demolition crews outside the ring |
| B-VS | new `src/vs/*` (phases, ring, PvP formula, KO/respawn/elimination, crown, scoring, tenders) + `src/vs/bot/*` (port of `_harness/bot.ts` with RING/RIVAL/TENDER layers) | the VS rules as pure modules called through B-WORLD's hooks |
| B-NET | new `src/net/*` except `portal.ts` (room layer, 4-player quick match, WebRTC host star, Worker clock, input codec, hash, host migration, replay join) | the lockstep session. It can start during B-DET against the 1-titan World. |
| B-VIEW | `src/render/*`, `src/titans/titanview.ts`, `src/audio/*`, `src/ui/*`, `src/game.ts` | camera follows your own titan; up to 4 titan models with seat colours; FX/sound per player; HUD standings + KO feed; CARD RAIL UI; lobby, countdown, spectate, front-page end card, rematch |
| B-QA | `_harness/vs/*`, `_harness/net/*` | all the probes below |

The one shared-folder exception: `src/titans/titanview.ts` belongs to B-VIEW, and the rest of `src/titans/` to
B-TITAN.

### 6.3 Phase B gates (all must pass before online goes live)
| ID | Gate | Pass condition |
|---|---|---|
| H1 | Cross-browser probe (Node + Chromium + Firefox + WebKit; prototype in `netcode_lab/`) | every checkpoint hash identical. **Fails today; passes with detmath** (netcode.md §6.4) |
| H3 | grep ban in `npm run check` | no browser-dependent maths functions, `Math.random` or clocks in sim folders or the bot |
| G2 | Solo GATE 2 | passes; hashes frozen after B-DET's one re-baseline; solo unchanged by every later lane (VS code only runs in VS mode) |
| VP | 4-bot VS pacing probe (seeds 1337/7/99 × 3 cities, REGULAR bots) | vs_design.md §14.3: median end 9:00-10:45, never past 10:45; median LV 14-19 at 4:00 and 28-35 at 7:00; at least 35 % of floors standing at 7:00; equal-size 1v1 time to kill 12-20 s; the leader at 7:00 wins at most 50 % of matches |
| H2 | **Multi-client headless test** `_harness/net/probe_net4.ts`: 4 peers in one Node process over a simulated link (delay, loss, duplicates) | (a) hashes equal at every checkpoint; (b) game speed ≥96 % under jitter; (c) a late input is repeated and never stalls; (d) a forced desync is caught within 30 ticks; (e) killing the host → migration, hashes still equal; (f) an AFK guest → a bot takes the seat; (g) replay-join at 2:00 matches the live peers; (h) final standings agree on every peer |
| H4 | `online4.py`: 4 separate Chromium browsers, with background throttling off and `bring_to_front` on the client being checked | quick match 2 humans + 2 bots; room code with 4 humans; closing the host tab → the match continues; hiding a tab → it catches up; identical standings |
| H6 | Mixed browsers: one Chromium + one Firefox + one WebKit player in one match | no desync over a full 10:45 match |
| H5 | Performance with 4 titans, desktop and throttled phone CPU, run alone | for information, never a blocker |
| VR | VS reporting through the bridge stand-in | a 2-human + 2-bot match → 2 `bt_vs_results` rows + 1 `bt_vs_matches` row with the winner set when the reports agree; a guest makes no row and doesn't block the others |
| DEV | One real iPhone or Mac running the H1 probe | identical hashes. The netcode lane expects this by construction but hasn't tested it (netcode.md §6.4). |

---

## 7. Risks

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| Faked runs or results (the browser reports them) | A, B | medium | server-side bounds, no repeated submissions, agreement rules for VS; boards framed as casual; replay checking possible later |
| Portal deploy breaks another game's bridge use | A | low | the new messages are additive; LAST CIRCLE portal check is a gate |
| Can't test on the live site until published | A | low | local stand-in portal (A-QA); final live check right after you publish |
| Game files still changing under other build lanes | A, B | medium | A-GAME keeps its edits to a few hook lines; Phase B starts after the current build lane releases the sim |
| Browsers disagree on maths, so the online game desyncs | B | **blocking today** | detmath + grep ban + the 4-browser probe on every sim change; one real Apple device check |
| A hidden nondeterminism (iteration order, an unsorted list) | B | medium | wide state hash; mixed-browser H2/H6 runs |
| Refactor credits the wrong titan (the "current player" pointer isn't set) | B | medium | dev-build asserts; probe checks that per-player tallies add up |
| Four titans eat the city bare before the fight | B | medium | repair crews from minute 1; VP gate measures floors standing at 7:00 |
| Players behind strict home networks can't connect peer to peer | B | medium | forward through another peer; one relay slot; otherwise a bot seat. Paid relay = D11. |
| Supabase's message cap is shared by every FFG game (100/s on the free plan; plan not checked) | B | high if misused | no game stream on Supabase; short lobbies; one relayed room at a time across the project |
| Guests feel 100-200 ms of input delay | B | medium | own-titan prediction on screen; adaptive lead; warn in the lobby above 200 ms round trip |
| Host tab hidden or closed | B | low-medium | Worker clock; clock watchdog on guests; host migration |
| Phone CPU with 4 titans | B | medium | desktop-only at launch (D14); measure in H5 |
| Phase B is large (about 7-11k lines) | B | schedule | VS BOTS ships first as a playable milestone, so value lands before the netcode is finished |
