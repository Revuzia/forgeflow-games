# BLOCKTOOTH ONLINE — multiplayer references (lane: mp_refs)

STATUS: COMPLETE (2026-10-01). Read-only research. No game code edited, nothing deployed or committed.
Sibling file: `netcode.md` (lane netcode: N-titan refactor, transport budget, measurements). This file covers
**how the existing ForgeFlow real-time MP games do it** and what BLOCKTOOTH can reuse.

Labels: **[src]** = read in code this session (path:line). **[doc]** = Supabase docs fetched this session (URL).
**[prior]** = a measurement another lane recorded in the repo (cited file), not re-run here. **[est]** = arithmetic on
stated assumptions. **[inferred]** = my reading, not directly verified.

Path roots: `FG` = `C:/Users/TestRun/Claude Claw/forgeflow-games`. `ES` = `F:/GrokUI/projects/default` (Ember
Sanctum source; the repo folder `FG/games/ember-sanctum` is built dist only, per its README.md).

---

## 1. Outcome (read this first)

1. **Nothing in the portfolio does "4-human quick match with bots filling" today.** `NetPlay.quickMatch()` pairs
   exactly the **two lowest peer ids** in the lobby [src: `FG/pipeline/engine/runtime/net/ffg_netplay.js:86-92`].
   Rooms larger than 2 exist only via **room codes** (Last Circle up to 4 humans, Pirate's Cove Armada up to 10
   slots, LuminaScape, Chroma Hide). Pirate's Cove quick match = 2 humans paired, then the host auto-starts after
   2.5 s with bots filling the rest [src: `FG/games/pirates-cove/runtime/net/covenet.js:104-113, 158-160`].
   BLOCKTOOTH must ADD an N-player quick match (fill-to-4 with a short wait, then bots).
2. **Best model to copy: Chroma Hide's host-authoritative design** (host runs the sim, guests send intent, host
   broadcasts ~10 Hz snapshots + discrete events, an explicit authority gate, roster = humans + fill bots, a pure
   node-testable wire module, and an in-process loopback hub for headless tests) [src:
   `FG/games/chroma-hide/runtime/net/chromanet.js:1-11`, `sim/net_protocol.js:85-116`, `net/loopback.js:1-9`].
   Add Last Circle's operational lessons: envelope merge, outbound budget, host/guest watchdogs, host-lost →
   bots take over, bot takes over a leaver's slot, `?room=` deep link, WebRTC overlay [src:
   `FG/games/last-circle/runtime/3d/royale/net.js`].
3. **Lockstep / input relay is a poor fit for BLOCKTOOTH** even though the sim is fixed-step: the sim core +
   titans call non-exactly-specified Math functions **148 times** (`grep Math.(sin|cos|atan2|exp|pow|hypot)` over
   `src/core/*.ts src/titans/*.ts`), which ECMA-262 does not pin across engines [prior: HIT PARADE
   `_research/NETCODE.md` §2.4, citing tc39.es]. Cross-browser desync risk is high [inferred]. Snapshots tolerate it.
4. **The binding constraint is Supabase message budget, not CPU.** Free plan: **100 msgs/s per project**, 200
   concurrent connections, 2M msgs/month, 256 KB broadcast payload, presence 20 msgs/s [doc]. Billing = 1 per send +
   1 per receiving subscriber [doc]. A 4-human room over the relay costs roughly 80-160 events/s depending on rates
   (§6) — i.e. ONE busy BLOCKTOOTH room can consume the whole project cap shared by every FFG game, and a 20-minute
   relayed match is ~100k messages (~5% of the monthly quota) [est]. **BLOCKTOOTH needs (a) a shorter VS match,
   (b) WebRTC P2P for the state stream (Last Circle `RTCMesh` precedent) with the relay as fallback, and (c) a
   project-wide relay-room cap.** Which Supabase plan the project is on was **not verified** this session (code
   comments throughout assume Free; see §7).
5. **Ratings RPC is 1v1 only** (`white`/`black`/`draw`) [src: `FG/supabase/migrations/0004_game_ratings.sql:59-61,
   45`]. A 4-player FFA needs a new RPC (placement-based multi-Elo or simple W/L/placement stats). The current RPC
   also has an abuse hole (§5.4).

---

## 2. NetPlay transport (`ffg_netplay.js`) — what it actually does

Canonical copy: `FG/pipeline/engine/runtime/net/ffg_netplay.js` (143 lines). It is **vendored per game**, 16 copies,
5 distinct md5 prefixes found this session: `38c803d7` (aether-isles, checkers, chroma-hide, elysium-realms,
grid-rush, iron-tide, neon-veil, pirates-cove, tide-breakers, warboard-chess), `c21f78ec` (cosmic-coils,
dungeon-forge, luminascape, and Ember Sanctum's `ES/src/netplay.js`), `a54b4ed5` last-circle, `daee49ad`
edge-keeper, `0b8f29e0` pipeline/engine. HIT PARADE has a TypeScript port `FG/games/hit-parade/runtime/src/net/netplay.ts`.

| Topic | Behaviour | Evidence |
|---|---|---|
| Transport | Supabase Realtime Broadcast + Presence; supabase-js lazy-loaded from esm.sh on first online use | [src] pipeline copy `:39-45` |
| Room | channel `ffg:<gameId>:<CODE>`, `broadcast {self:false, ack:false}`, presence keyed by peer id | `:53-55` |
| Peer id | `Date.now().toString(36)+"_"+random` — sortable; lexically lowest = host | `:29-30` |
| Host election | in a room: lowest presence id on first `sync` with >=2 present (unless `asHost` passed) | `:61-64` |
| Quick match | presence in `ffg-lobby:<gameId>`; the two lowest ids pair into room `(a.slice(-4)+b.slice(-4)).toUpperCase()`, lower id = host | `:78-104` |
| Lobby linger fix | base copy untracks immediately (orphaned the first peer); the 38c803d7 copies join the room first and linger **4 s** + also fire on presence `join` | [src] `pirates-cove/runtime/net/ffg_netplay.js:101,106` |
| `peer` event | base: fires only on the 1<->2 boundary. Last Circle's copy fires on every **count** change and passes `ids` (needed for rooms >2) | [src] `last-circle/runtime/net/ffg_netplay.js:84` |
| Send | one broadcast event `msg` with `{from, t, d}`; JSON | pipeline `:108-112` |
| Leave | `removeChannel` room + lobby | `:114-118` |
| No reconnect | there is no rejoin/resume logic in NetPlay itself; `CHANNEL_ERROR`/`TIMED_OUT` only emit `error` | `:70` |
| `eventsPerSecond` | 12 in most copies, 30 in last-circle/luminascape/ES. HIT PARADE's lane measured it is a **no-op** on the wire (server reads only apikey/token/log_level) — so last-circle's comment that the server rate-limits the connection to it is wrong | [prior] `hit-parade/_research/NETCODE.md:126-131`; [src] `last-circle/.../ffg_netplay.js:45-58` |
| Version pinning | last-circle and HIT PARADE pin `supabase-js@2.117.2`; most copies float on `@2` | [src] last-circle `:44`, `hit-parade/runtime/src/net/netplay.ts:17` |
| Proto/build gating | HIT PARADE puts `proto`+`build` in presence meta and pairs only identical versions; adds a token-bucket send budget (20 burst / 12 per s), binary broadcast (`bin` event), one shared client per page with its own auth storage key | [src] `netplay.ts:41-61, 73-88, 123, 253-299, 320-332` |

**TurnClock** (in the same module) is turn-based only — irrelevant for BLOCKTOOTH except as a lobby countdown.

---

## 3. Per-game reference table

| | Last Circle (BR) | Pirate's Cove arena | Ember Sanctum duel | LuminaScape co-op | Chroma Hide |
|---|---|---|---|---|---|
| File | `FG/games/last-circle/runtime/3d/royale/net.js` (807) + `runtime/net/ffg_rtc.js` (107) | `FG/games/pirates-cove/runtime/net/covenet.js` (701) | `ES/src/online.js` (230) | `FG/games/luminascape/net/lumina_net.js` (490) | `FG/games/chroma-hide/runtime/net/chromanet.js` (129) + `sim/net_protocol.js` (116) |
| Humans per room | **max 4** (host + 3), truncated at START; extras told "room full" (`:366-367, 357, 391-395`) | 2 / 4 / 10 slots by mode (`:25-29`) | 2 | unbounded (no cap found) | `lobbySize` (humans sliced to it, `net_protocol.js:88-90`) |
| Entry | **room code only** + `?room=CODE` invite link + copy-link button (`:103-111, 196-222, 344-347`) | host code / join code / **quick match** per mode lobby `pirates-cove-<mode>` (`:79-113`) | quick match / host / join (`:92-121`) | host / join / quick match (`:206-240`) | host / join / quick match (`chromanet.js:62-64`) |
| Bot fill | 50 actors; humans take slots s0..sK, rest stay bots; host simulates all bots (`:26-29`) | host fills to `slots` with named bots (`:158-160`) | none (vs-AI is separate) | none | `buildRoster` humans + bots to lobbySize (`net_protocol.js:85-97`) |
| Sync model | **hybrid**: deterministic world from shared seed; each human simulates OWN actor and broadcasts state; host simulates bots and ships snapshots; hits sent to victim who applies them (client authority over own HP) (`:13-24`) | each captain owns own HP (shooter sends `hit`, victim applies); host owns bots + win check (`:16-18`) | each player owns own HP; victim applies `hit`; dier broadcasts `down` (`online.js:11-18`) | host owns world (gzip keyframe chunks); everyone streams own position | **host-authoritative**: guests send INPUT; host sims and broadcasts SNAP + EVENTs; authority gate drops wrong-side messages (`net_protocol.js:99-116`) |
| State rate | own state **12/8/5 Hz** at 2/3/4 humans; bot snapshots 10/8/6.25 Hz ride the host state packet (`:653-703`) | own state 10 Hz (`:248`), bot state 8 Hz (`:249`) | 15 Hz (`online.js:188-200`) | 10 Hz out, 30 Hz interp tick (`:244-253`) | host SNAP 10 Hz (`game.js:1132-1133`); guest INPUT every 4th frame (~15 Hz at 60 fps [inferred]) + immediate on discrete change (`game.js:1144-1160`) |
| Payload | `pack()`: id, x,y,z (2 dp), yaw, pitch, hp, shield, glide, weapon, flag byte (`:792-806`); one 46-bot list "~3.7 KB" per its comment (`:726-727`) | `{x,z,yaw,sp,hp,dead}` 1 dp (`:361`); bots list same shape (`:451`) | `{x,z,f,hp,hpMax}` (`online.js:192-198`) | `{m,x,y,z,yaw,w}`; world keyframe base64 chunks of **60,000 chars**, 60 ms apart (`:52, 316-320`) | actor as fixed int array, cm positions, yaw byte, flags bitfield (`net_protocol.js:31-35`) |
| Interpolation | `pos.lerp(target, dt*K)`, `K = max(4, 800/stateMs)` follows send rate; velocity/onGround derived from interp motion (`net.js:699`, `player.js:2461-2490`) | exp smoothing `1-exp(-8dt)` (`:345-348`) | `1-exp(-12dt)` (`online.js:47-55`) | `1-exp(-10dt)` (`:143-150`) | keeps applying latest snapshot each frame (`game.js:1162-1165`); phase may never rewind (`:1169-1173`) |
| Clock | host stamps `t` on its state packet; guests slew ±0.05 s/packet, snap if >3 s off (`:587-603, 708`) | none | none | none | `timeLeft` inside SNAP |
| Leave / host loss | `bye` on unload; host re-attaches bot brain to a leaver's slot + `takeover`; guest watchdog 8 s → `hostLost()` converts all remotes to local bots and continues offline; host watchdog 12 s per guest (`:382-384, 514-535, 619-635, 764-777`) | host leaves → match void, no migration (`:117-124`) | presence lost while live → duel void (`online.js:83-89`) | peer leaves → ghosts pruned (`:267-277`) | `peerLeft` emitted on presence departure (`chromanet.js:52-59`) |
| Reconnect | none (a returning tab is a new peer id) | none | none | none | none |
| Budget / shedding | outbound budget `max(8, floor(100/H))` msgs/s; CRITICAL types never shed; cosmetic events queued and ride the state packet (envelope merge) (`:116-157, 709-731`) | none | none | 60 ms gaps between keyframe chunks | throttled guest input |
| P2P | `RTCMesh`: state envelope over unreliable DataChannels (`ordered:false, maxRetransmits:0`), Google STUN, no TURN, lower id offers, signalling over the room channel; falls back to one Supabase broadcast if any peer lacks a channel (`ffg_rtc.js:12-22, 47-60, 85-94`; `net.js:737-742`) | — | — | — | — |
| Anti-cheat | none beyond victim-applies-damage; host check on `bots` messages | `bst`/`bfire` accepted only from `_hostId` (`:141-142`) | none | none | **authorizeMsg** gate: SNAP/EVENT only from hostId, INPUT/SHOT acted on only by host (`net_protocol.js:99-116`) |
| Result reporting | none (no `report_match_result`) | arena: none (only the naval DUEL in `ffg_navalfree3d.js:1355-1369` reports) | none | n/a | (has `ffg_ratings.js` copy; call site not traced) |

Ratings reporters found: `pirates-cove` / `tide-breakers` naval duel (`ffg_navalfree3d.js:1338-1369`),
warboard-chess, HIT PARADE (`runtime/src/net/online_flow.ts:788-797` — reports only when both peers' sim-derived
RESULT agrees and both are signed in).

---

## 4. Patterns worth stealing (with the reason each exists)

1. **Join = take over a bot slot** (Last Circle `net.js:26-29`, Chroma Hide `buildRoster`). Roster is built by the
   host from sorted peer ids, broadcast in START with seed + map; every client builds the identical world.
2. **Seeded deterministic world, relay only live state** (Last Circle `net.js:13-14`). BLOCKTOOTH already generates
   the city from `opts.seed` (`src/core/world.ts:43-44`), so START `{seed, biome, roster}` reproduces the map on
   every client for free; only titans/enemies/destruction deltas need syncing.
3. **Envelope merge** — messages, not bytes, are billed, so cosmetic events + bot snapshots ride the one periodic
   state packet (Last Circle `net.js:145-157, 709-731`). Payload cap is 256 KB [doc], far above any snapshot.
4. **Outbound budget with a CRITICAL whitelist** (Last Circle `net.js:116-143`) — but note the 100 is **per project**,
   not per connection [doc + prior NETCODE.md:226-227], so budget per room must assume other games' traffic too.
5. **Host-lost continuation** (Last Circle `net.js:614-635`): every client can run the full sim, so on host loss
   remotes become local bots and the match stays winnable. For BLOCKTOOTH host-authoritative that means guests must
   be able to promote their last snapshot to a local World — easier if snapshots are full-state.
6. **Leaver → bot brain** (Last Circle `net.js:514-526`) and **12 s silent-guest watchdog** (`:769-777`).
7. **Rate-scaled interpolation constant** `K = 800/stateMs` (Last Circle `net.js:699`).
8. **Host-stamped clock + slew** (Last Circle `net.js:587-603`) — BLOCKTOOTH's director/gates are time-driven
   (`stepDirector`, `stepGates`, `world.ts:132-133`), so guests must follow host time, not free-run.
9. **Authority gate as a pure function + loopback hub** (Chroma Hide `net_protocol.js:99-116`, `loopback.js`) — lets
   the whole host/guest flow run headless in node with the real pack/unpack; only the socket layer needs a live
   2-tab test. Fits BLOCKTOOTH's THREE-free sim + `_harness` style.
10. **Proto/build in presence; pair only identical builds; pinned supabase-js; one client per page** (HIT PARADE
    `netplay.ts:17, 73-88, 263-266`). Prevents a stale cached client from joining a new-protocol room.
11. **Invite deep link `?room=CODE` + copy-link** (Last Circle `net.js:103-111, 196-222`).
12. **Result agreement before rating** (HIT PARADE `online_flow.ts:788-797`).

---

## 5. Gaps / risks found in the references (do not copy these)

1. **Quick match is 2-only** (§1.1). An N-player version must handle: presence-diff fan-out on a busy lobby (presence
   limit 20 msgs/s on Free [doc]), all waiting peers agreeing on the same group (sort ids, chunk into 4s, lowest of
   each chunk hosts — deterministic like the existing pair rule), a fill timeout (e.g. 8-12 s) after which the group
   starts with bots, and linger before untracking (measured presence visibility 144-2,686 ms [prior:
   `hit-parade/_research/NETCODE.md:145-147`] → 4 s linger leaves ~1.3 s margin; HIT PARADE uses 6 s).
2. **No reconnect anywhere.** A reload = new peer id = a new player. BLOCKTOOTH should persist the peer id in
   sessionStorage per room and give a grace window (HIT PARADE design: 10 s) during which the slot is bot-driven and
   can be reclaimed [prior design: NETCODE.md §3.8].
3. **Client-authoritative HP** (Last Circle, Cove, Ember) means any client can ignore damage. Acceptable for casual
   co-op/vs, not for ranked. Host-authoritative BLOCKTOOTH removes this for guests (the host itself is still trusted).
4. **`report_match_result` abuse hole [src, inferred from the SQL]**: the RPC only checks that `auth.uid()` is one of
   the two ids (`0004_game_ratings.sql:75-77`); the other id is any profile uuid, and uuids are public via
   `game_leaderboard` (`:137-142`). A signed-in user can therefore self-report wins against arbitrary profiles with
   fresh `match_id`s and farm Elo. First report wins (idempotent by match_id, `:80-85`), so the loser cannot
   contradict it. Out of BLOCKTOOTH scope to fix, but a new multi-player RPC must not repeat it (e.g. require every
   participant's matching report, or host+one-guest co-signature, before applying).
5. **`leaderboard_scores` accepts any client-written score** (owner-write RLS only, `0002_user_accounts.sql:124-133`).
   Fine for single-player bests, not trustworthy as a competitive leaderboard.
6. **Public channels + one shared anon key**: anyone can broadcast on any `ffg:*` channel, and sustained >100 msgs/s
   closes channels project-wide. Docs: with "Allow public access" on, "anyone holding your project's anon key can
   subscribe to and broadcast on any public channel"; turning it off forces `config.private: true` + RLS on
   `realtime.messages` [doc: supabase.com/docs/guides/realtime/settings]. Portfolio-wide owner decision.
7. **Last Circle budget comment frames 100/s as per connection** (`net.js:123-135`) — it is per project [doc].

---

## 6. Supabase Realtime limits that matter (fetched 2026-10-01)

| Limit | Free | Pro | Pro (no spend cap) | Source |
|---|---|---|---|---|
| Concurrent connections | 200 | 500 | 10,000 | [doc] supabase.com/docs/guides/realtime/limits |
| Messages per second | 100 | 500 | 2,500 | same |
| Channel joins per second | 100 | 500 | 2,500 | same |
| Channels per connection | 100 | 100 | 100 | same |
| Presence messages per second | 20 | 50 | 1,000 | same |
| Broadcast payload | 256 KB | 3,000 KB | 3,000 KB | same |
| Monthly messages | 2M, no overage | 5M incl., $2.50 per 1M over | | [doc] .../platform/manage-your-usage/realtime-messages |

- Counting: "Each broadcast message counts as one message sent plus one message per subscribed client that receives
  it" [doc, realtime-messages page]. With `self:false`, a room of H humans costs **H per send** (1 + H-1).
- Enforcement: "channels that exceed the average are closed with `Too many messages per second`, which supabase-js
  recovers from by rejoining"; presence over-rate closes with `Too many presence messages per second`, per client
  `Client presence rate limit exceeded` [doc: .../realtime/settings]. The limiter is a project-wide 60 s rolling
  average per the realtime server source [prior: NETCODE.md:101-112].
- Measured relay latency (one vantage, DFW edge): RTT median 145.6 ms, p99 327.7 ms, 0 loss in 2,340 pings, **1.88%
  out-of-order** — so every packet needs a sequence number [prior: NETCODE.md:17-20, 92-94]. Connect + join →
  SUBSCRIBED 404-613 ms [prior: NETCODE.md:144].

**BLOCKTOOTH budget arithmetic [est]** (4 humans, all on the relay, host-authoritative):
events/s = host snapshot S × 4 + 3 guests × input rate I × 4 = 4S + 12I.
- S=10, I=10 → **160/s** (over the Free project cap alone).
- S=6, I=5 (inputs change-driven, coalesced) → **84/s** (84% of the whole project's cap for one room).
- 2 humans, S=10, I=10 → 40/s.
- Monthly: at 84/s a 20-minute match = ~100,800 messages → ~20 such matches exhaust 2M; a 6-minute VS match ≈
  30,240 → ~66/month if nothing else used the project.
- With the WebRTC overlay carrying snapshots + inputs (Last Circle pattern), the relay carries only lobby, START,
  signalling, critical events and fallback: on the order of a few hundred messages per match [est]. TURN-less P2P
  fails for a planning figure of 15-30% of pairs [prior: NETCODE.md §2.3, cited sources], so the fallback path and a
  project-wide "one relayed room at a time" cap (HIT PARADE design: presence on `ffg-relay:<game>`, NETCODE.md
  §3.1) are required, not optional.

---

## 7. What BLOCKTOOTH can reuse as-is vs. must add

### Reuse as-is (vendor a copy, per portfolio convention)
- **NetPlay room layer**: start from HIT PARADE's TS port (`hit-parade/runtime/src/net/netplay.ts`) — already TS +
  Vite-compatible, pinned supabase-js, proto/build gating, count-change `peer` event, send budget, binary broadcast,
  6 s linger, one shared client per page. Change only `GAME_ID`. (Its `onPresence` treats only the 2 lowest ids as
  players, `netplay.ts:225-238` — must be widened to 4.)
- **RTCMesh** (`last-circle/runtime/net/ffg_rtc.js`) for the high-rate stream, signalling over the room channel —
  port to TS; consider HIT PARADE's 3-STUN list (`NETCODE.md` §3.1). For 4 players use a **star** (host ↔ each guest,
  3 connections on the host) rather than full mesh, since the host is the only authority [inferred].
- **Ratings client** (`hit-parade/runtime/src/net/ratings.ts` / `pipeline/engine/runtime/net/ffg_ratings.js`) for
  `currentPlayer()` (same-origin portal session) and the 1v1 RPC if a 1v1 VS mode is offered.
- **Patterns** in §4 (roster/bot-slot takeover, seeded world, envelope merge, CRITICAL budget, watchdogs, host-lost
  continuation, clock slew, authority gate, loopback test hub, `?room=` link).
- BLOCKTOOTH-side assets: seeded city generation (`world.ts:43-44`), fixed 30 Hz step (`config.ts:121-122`), events
  array per tick (`world.ts:121`, usable as the EVENT stream), existing local goals/achievements (`src/meta/*`).

### Must add
1. **N-titan World** (World has one `titan`, `world.ts:54`) — covered by the netcode lane.
2. **N-player quick match** (fill-to-4 + timeout + bots), deterministic grouping, proto/build gating (§5.1).
3. **Host-authoritative snapshot protocol**: pure `net_protocol.ts` (quantized titans/enemies/boss/destruction
   deltas + sequence number + host tick), guest input packets (move vector, ability/dash/ult edges — the
   `TitanInput` shape, `world.ts:35`), authority gate, loopback hub tests.
4. **Destruction sync**: city blocks leveled are world state; send them as host EVENTs (id lists), not in every
   snapshot, plus a late-join/drift `sync` like Last Circle's (`net.js:536-541`) [inferred design].
5. **Guest presentation**: guests render remote titans/enemies from snapshots with interpolation; their own titan
   needs client-side prediction or it will feel ~150-300 ms laggy (relay RTT median 145.6 ms [prior]) — none of the
   reference games predict; they all let each client own its avatar instead [src §3]. Decide: own-avatar authority
   (Last Circle style, simpler, cheatable) vs host authority + local prediction/reconcile (fairer, more work).
6. **Reconnect grace** (§5.2) and **host-lost continuation** for a host-authoritative sim (guest promotes snapshot
   to a local World).
7. **Multi-player result reporting**: a new SECURITY DEFINER RPC (e.g. `report_ffa_result(game, match_id,
   placements[])`) with a participant co-signature rule so it does not inherit §5.4, plus per-player stats rows
   (kills, peak size, placement) for the STATS/leaderboard the owner asked for. Schema changes go through a
   migration the owner applies (portal convention per `0004_game_ratings.sql:2`).
8. **Relay cap + budget**: project-wide relayed-room limit and a per-room send budget sized for H=4 (§6).
9. **Shorter VS match length** than the 20-minute run, or the relay economics fail (§6) [est].

### Open items for the owner (not acted on)
- **Supabase plan unverified.** Every code comment assumes Free (e.g. `pipeline/engine/runtime/net/ffg_netplay.js:7`,
  `last-circle/.../net.js:9`); I did not query the dashboard/management API. Check: Supabase dashboard → project
  wugoxdewcdxzfppgzohy → Settings → Billing (or Realtime → Settings shows the per-project limits). Pro raises the cap
  to 500 msgs/s and 5M/month [doc] — a spend decision (gated).
- TURN (Cloudflare $0.05/GB [prior, cited]) would cut the 15-30% relay fallback — spend decision.
- Public-channel DoS exposure and the `report_match_result` farming hole are portfolio-wide, pre-existing.
