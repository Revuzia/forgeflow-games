# DYEFIELD — ONLINE contract (O0–O15)

Owner ask (2026-10-01): "im also assuming we can MATCH UP with other players in quick match or join as we do in our
other games in forgeflowgames?" → "both, right away."

Scope: real-time online matches for 2–8 humans in every MODE × RULE (TEAMS · 4 v 4 / FREE-FOR-ALL × TURF /
WASHOUT), with bots filling the empty slots. QUICK MATCH, CREATE ROOM and JOIN ROOM (a 4-character code), the same
three doors as the other ForgeFlow games. Desktop, phones (touch) and the portal iframe are all supported.
`CONTRACT.md`, `CONTRACT_FFA*.md`, `CONTRACT_WASHOUT.md`, `CONTRACT_MOBILE.md` and `CONTRACT_CONTROLS.md` still hold.
Where this file changes one of them, the change is noted in place with a `CHANGED(ONLINE)` note.

Labels used below: **[measured]** = a number from a tool run in the design session (2026-10-01); **[source]** = read
in code this session (file:line); **[cited]** = Cloudflare documentation fetched this session (URL); **[estimate]** =
arithmetic on stated assumptions; **[design]** = a decision this document makes.

**Non-negotiables**
- Single-player is untouched. Every determinism hash in `npm run probe` and `npm run probe:washout` stays identical.
  The online layer never changes what the sim does for a given set of intents. Core edits are additive only and are
  never called offline (§O12 lists the only three allowed).
- DYEFIELD's real-time traffic never touches the shared Supabase Realtime quota (100 msg/s per project, 2M/month,
  shared by 9 live games — `games/hit-parade/_research/NETCODE.md` §0.3). It uses its own Cloudflare Worker.
- $0. Workers Free limits are designed for and enforced by a usage meter (§O9). Anything that would cost money is a
  STOP (§O14).
- Every existing gate keeps passing (§O13.4).

---

## O0 Research findings (what the design rests on)

### O0.1 Cloudflare account and limits
- Account `ec597c4f0ed8f2f0232606a717389ffc` ("Isimcha85@gmail.com's Account"), wrangler 4.92.0, OAuth scopes include
  `workers (write)`, `workers_scripts (write)`, `account (read)` [measured: `wrangler whoami` with
  CLOUDFLARE_API_TOKEN unset].
- **The plan (Free or Paid) could not be read.** `GET /accounts/{id}/subscriptions` and `GET /user/subscriptions` both
  return 403 `Authentication error` with the wrangler OAuth token (no billing scope) [measured]. Script settings show
  `usage_model: standard, limits: null` for every script [measured], which both plans report. **This design assumes
  the Workers Free plan** (the stricter one). The Paid case is handled in §O9.4.
- Existing Workers on the account: `agency-rag-chat`, `ffl-lane4-unsubscribe`, `forgeflow-cron`,
  `forgeflow-games-cdn`, `kalshi-proxy`. **No Durable Object namespaces exist** (`GET .../durable_objects/namespaces`
  → `[]`) [measured]. workers.dev subdomain `isimcha85` [measured].
- Workers requests per day, whole account, last 8 days (GraphQL `workersInvocationsAdaptive`) [measured]:
  13,868–23,177 per day; `kalshi-proxy` is 13,499–22,722 of that, `forgeflow-games-cdn` 5–1,657.
- Durable Objects on the Free plan [cited: developers.cloudflare.com/durable-objects/platform/pricing/ and
  /limits/]:
  - "Durable Objects are available both on Workers Free and Workers Paid plans"; on Free, **only SQLite-backed**
    classes (`new_sqlite_classes`).
  - Free: **100,000 requests / day**, **13,000 GB-s / day** duration, 5 GB SQLite storage, 100,000 row writes / day,
    5M row reads / day. "If you exceed any one of the free tier limits, further operations of that type will fail
    with an error. Daily free limits reset at 00:00 UTC."
  - A request "includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations"; "A request is needed
    to create a WebSocket connection." **Incoming WebSocket messages are billed 20:1** ("100 WebSocket incoming
    messages would be charged as 5 requests"); **outgoing messages are free**; protocol pings are free. The
    Example 3 numbers (1 msg/s for a month on 100 objects → 12,960,100 billable requests) confirm the 20:1 ratio is
    applied.
  - CHANGED(review) — **whether the Free plan's 100,000/day counts WebSocket messages 20:1 or 1:1 is NOT stated.** The
    exact footnote (re-fetched in review from the docs partial `durable-objects-pricing.mdx`) reads: "For compute
    requests **billing-only**, a 20:1 ratio is applied to incoming WebSocket messages", and it "does not affect Durable
    Object metrics and analytics, which reflect actual usage". The Example 3 numbers are Paid-plan billing. No page says
    how the Free daily limit is enforced. Third-party calculators assume 20:1; that is not evidence. Treat it as
    **[cited, ambiguous]**: at 1:1 the Free plan carries 20× fewer messages (one 8-human match ≈ 30,000 incoming
    messages). §O9.3 now starts in a mode that is safe under either reading and switches after a one-time check.
  - CHANGED(review) — the auto-response `"p"` → `"P"`: the docs say auto-responses "will not incur additional
    wall-clock time, and so they will not be charged" (duration). They do not say the incoming `"p"` is exempt from the
    request count, and the Room never sees those messages, so the meter cannot count them. They are budgeted
    conservatively as billable (§O9.2) and their rate is lowered (§O5.2).
  - Duration is billed for 128 MB "regardless of actual usage", for the whole time a DO is awake. With the
    **Hibernation API** "Billable Duration (GB-s) charges do not accrue during hibernation"; a DO hibernates only
    when it receives no events for a short period ("alarms, incoming requests, and scheduled callbacks prevent
    hibernation. This includes setTimeout and setInterval").
  - CPU per request (each WebSocket message is one): 30 s default. WebSocket received-message size: 32 MiB.
    Soft limit 1,000 requests/s per object. `serializeAttachment` max 16,384 bytes. 100 DO classes on Free.
  - Hibernation API [cited: /durable-objects/api/state/]:
    - `acceptWebSocket(ws, tags?)`, at most 10 tags of ≤ 256 characters;
    - `getWebSockets(tag?)`, `getTags(ws)`;
    - `setWebSocketAutoResponse(pair)`, request and response ≤ 2,048 characters. The auto-response "will be returned
      without waking WebSockets in hibernation and incurring billable" duration;
    - `getWebSocketAutoResponseTimestamp(ws)`;
    - at most 32,768 hibernatable WebSockets per DO.
  - `locationHint` values `wnam, enam, sam, weur, eeur, apac, apac-ne, apac-se, oc, afr, me`, passed as
    `ns.get(id, {locationHint})`. They are best effort; without one, a DO is created near the first `get()`
    [cited: /durable-objects/reference/data-location/].
  - Paid: DO requests 1M / month included then $0.15 / million; duration 400,000 GB-s / month then $12.50 / million
    GB-s.
- Workers Free: 100,000 requests / day (reset 00:00 UTC, Error 1027 beyond), 10 ms CPU per HTTP request, 128 MB per
  isolate [cited: /workers/platform/limits/]. The Workers pricing page lists DO requests as their own line item; it
  has no sentence saying whether DO requests also count toward the Workers 100,000 [cited, unclear]. §O9.3 is sized to
  be safe either way.
- CHANGED(review) — re-verified in the review session with the wrangler OAuth token: `GET /accounts/{id}/subscriptions`
  → 403 `Authentication error` (plan still unreadable); DO namespaces `[]`; the 5 scripts have `logpush: false`, no tail
  consumers, `limits: null`, and 1 cron trigger in total (the Free plan's 5-trigger limit is not exceeded, so this does
  not discriminate either). The plan question stays with the owner (§O14).
- workerd refuses runtime WebAssembly compilation from bytes ("Wasm code generation disallowed by embedder"); a
  `.wasm` must be a static module import [cited: community/GitHub issues found by web search]. The game's physics is
  `@dimforge/rapier3d-compat`, which instantiates its WASM from embedded bytes [source: package name, `package.json`].
  Running the existing sim inside a DO would need a different Rapier build, the map GLB parse, the nav build and the
  atlas build ported to workerd. This was the deciding fact against a server-authoritative DO (§O1.3).
- Edge from this box: CF-RAY `DFW`; TLS handshake 27–90 ms after TCP connect to the CDN worker (5 samples, the box was
  loaded) [measured].

### O0.2 The DYEFIELD sim (what a host must run and what must be synced)
- `MatchWorld.step(intents)` is one 60 Hz tick; the view drains `SimEvent`s and never writes gameplay
  [source: `core/match/world.ts` header + `step()` 528–625].
- **Sim cost** [measured: `_harness/_reports`]:
  - Node probe, 8 runners with bots: tick p99 1.5–3.4 ms (`probe_match*.json`).
  - Headless Chromium iPhone 14 emulation (`mobile_qa_dist.json`), sim ms per tick: 1× 1.00 mean / 1.6 p90; 2× 2.93
    / 4.3; **4× 6.71 mean / 9.8 p90, and only 53.5 ticks/s** (the sim fell behind real time). A phone is a poor host.
- **Paint is produced only by `Painter.splat` (sphere) and `Painter.capsule` (the SHEET-DRUM strip)**, called from
  `MatchWorld.paint` (world.ts:705–714) and `MatchWorld.paintStrip` (793–802) [source]. The only other callers are the
  dev brush (runner.ts:781, game.ts:867, offline dev only) and `testsurface.ts` [source: grep]. `Painter` is
  deterministic (hashed noise, no `Math.random`) [source: painter.ts header]. So **paint syncs as an ordered list of
  paint ops with their exact arguments**, and every client's `Painter` reproduces the court texel for texel.
  - The existing `'splat'` event carries x/y/z/r/team/normal/flips but **not** `seed` or `minFacing`, and capsules
    emit no event at all [source: world.ts:709–712, 797–801; events.ts:12]. The events alone cannot reproduce paint;
    paint ops are captured at the `Painter` instead (§O5.3).
  - Paint volume: 11,474 splats per 3-minute TEAMS match, 13,797–14,009 per FFA match (≈64–78 per second)
    [measured: `probe_match.json`, `probe_match_ffa_pier18.json`].
  - The atlas is 1024² with ~622,773 texels on a map; `atlas.team` (one byte per texel) is "THE paint state of the
    game" [measured: `lookshots.json`; source: atlas.ts:54].
- **Runner capsules never collide with each other** (`CHAR_GROUPS` collide with the map and grates only)
  [source: physics.ts:65–66]. A client can predict its own runner exactly against the map and its local paint
  mirror, without the other runners.
  - CHANGED(review), verified: the KCC needs no per-tick `world.step()` on a client. Rapier scene queries use a BVH
    that only a step rebuilds; `PhysicsWorld`'s constructor steps once after inserting the static map and grate
    trimeshes (`refresh()`, physics.ts:160–176), there are no dynamic bodies, and the KCC's obstacle filter
    (`QUERY_MAP_GRATES`) never sees character capsules. So `Runner.step` → `body.move` → `computeColliderMovement`
    on a never-stepped container world gives the host's answer.
  - CHANGED(review): movement also reads **paint** (`painter.teamUnder` at the feet, runner.ts:505; `surfaceAt` on
    walls, runner.ts:865) and **kit state** (`firing` → `fireMoveMul`, the drum's `fireSpeedCap`). Both arrive from
    the host one RTT late, so prediction needs the local kit step and a predicted-own-paint facade (§O5.5).
- The projectile pool stores positions and velocities as `Float32Array` [source: projectiles.ts:86–100];
  `COMBAT.poolCapacity` 512, `MATCH.eventCap` 8192, `MAX_STEPS_PER_FRAME` 5 [source: config.ts].
- `BotDirector` builds a brain only for roster entries with `bot: true` (`director.ts:546`) and `think(intents)` writes
  only those runners' intents [source: director.ts:606–618]. `Runner.bot` is read nowhere else in core [source: grep].
- The human is hard-wired as runner 0 in `game.ts` (`const HUMAN = 0`) and in `main.ts` (`youId: 0`)
  [source: game.ts:213, main.ts:510].
- One `Painter` serves every session of an arena (the lobby backdrop included); `startSession` resets it
  [source: main.ts:473, world.ts:455–458].

### O0.3 The existing ForgeFlow online patterns (UX to keep)
- `ffg_online.js` lobby: **QUICK MATCH / CREATE ROOM / JOIN ROOM**, a 4-character code from
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous characters), "Share this code with a friend", CANCEL / BACK, and
  `window.__mp*` test hooks [source: pirates-cove/runtime/net/ffg_online.js:69–74, 123–186, 337–361].
- `covenet.js` (the real-time precedent): per-mode quick-match lobbies, bots fill empty slots, the host owns bots and
  the win check, **"Host leaving voids the match (no migration in v1)"** [source: covenet.js:1–19, 117–124].
- HIT PARADE's netcode research measured the Supabase relay (RTT median 84–191 ms; project-wide 100 msg/s cap that
  closes every live channel when exceeded) and built a WebRTC DataChannel transport with public STUN only and no TURN
  [source: hit-parade/_research/NETCODE.md §0.2–0.3; runtime/src/net/transport_rtc.ts]. DYEFIELD reuses that idea only
  as a phase-2 option (§O15).
- The portal iframe is `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals
  allow-forms"` [source: src/components/game/GamePlayer.tsx:177], so the game's origin inside the portal is the CDN
  origin `https://forgeflow-games-cdn.isimcha85.workers.dev` (not `null`). The CDN sets
  `cross-origin-embedder-policy: credentialless` [source: workers/games-cdn/src/index.js:68]; COEP does not apply to
  WebSocket connections.

---

## O1 Architecture

### O1.1 The decision [design]
- **Transport: a new Cloudflare Worker `dyefield-net`** with three SQLite-backed Durable Object classes, using the
  WebSocket **Hibernation API**: `Lobby` (one instance per quick-match queue), `Room` (one instance per room code)
  and `Meter` (one instance, the daily usage meter). $0 on Workers Free.
- **Authority: HOST-AUTHORITATIVE.** One player's browser (the *host*) runs the real `MatchWorld` and `BotDirector`
  for all 8 runners. The other players (*clients*) send intents and mirror the host.
  - Clients → host: bundled intents, 20 Hz (three ticks per bundle).
  - Host → everyone: one snapshot message at 20 Hz. It carries the runner states plus the ordered record stream of
    the last three ticks: paint ops, projectile spawns and every other `SimEvent`.
  - Every client's `Painter` replays the paint ops exactly. A painter hash every 2 s proves it, and a keyframe repairs
    any drift.
  - The local runner's movement (and, in S2, its firing feedback) is predicted and reconciled. Remote runners are
    interpolated. Hits, damage, washes, paint, scores and the clock are decided on the host only.
- **The DO is a dumb, validating relay.** It routes by the first two bytes of binary frames, parses only the small
  text control frames, enforces size and rate caps, picks the host, detects a dead host and promotes the next one.
  It never parses snapshots or intents.
- **Host loss → host migration** (§O6), not a void: the next host rebuilds the world from the last snapshot plus its
  own exact paint mirror, and play continues after a short hitch.

```
 client A ──WS──┐                         ┌── WS ── client B
 (intents 20 Hz)│   Cloudflare edge       │ (intents 20 Hz)
                ▼                         ▼
          [ Worker dyefield-net ] ── routes ──► [ Room DO "K7QX" ]
                                               │  relays: client→host, host→all, host→one
 HOST (any player's browser) ◄──WS── intents ──┤
   MatchWorld + BotDirector (8 runners)        │
   └── snapshot+records 20 Hz ──────────────►  └──► fan-out to every client (outgoing = free)
 [ Lobby DO "qm:teams:turf:<build>" ] pairs quick-match players → claims a Room
 [ Meter DO "meter" ] counts billable units per UTC day → admission cap (CHANGED(review), §O2.5)
```

### O1.2 Why this fits the free plan
- A relay DO spends microseconds of CPU per message, and DO CPU is not billed (duration is).
- Outgoing (fan-out) messages are free. Only incoming messages count, 20 per billed request. So one host upload is
  fanned out to seven clients for 1/20 of a request.
- The binding limit is DO requests: about 1,510 units per full 8-human match (§O9.2). Duration allows about 450
  matches/day.
- CHANGED(review): "fits" assumes the 20:1 ratio also applies to the Free daily limit, which the docs do not state
  (§O0.1). If it is 1:1, the same design is still $0 (Free fails with an error, it never bills) but carries about
  3 eight-human or 13 two-human matches a day. The meter starts in the mode that is safe under 1:1 and is switched by
  config after the check in §O9.3.

### O1.3 Alternatives rejected (with the evidence)
- **Supabase Realtime (the existing NetPlay):** forbidden by the hard rules and too small. It is 100 msg/s per
  project, counting the send plus each delivery, and a breach closes every live room in all 9 games
  (NETCODE.md §0.3). One 8-human DYEFIELD match at 20 Hz is ~1,280 events/s.
- **Server-authoritative sim inside the DO:** the right long-term shape, but not for this build.
  - The sim's Rapier build needs runtime WASM compilation, which workerd forbids (§O0.1).
  - The map GLB parse, the atlas build and the nav build would all have to be ported.
  - It saves no requests: clients still send the same intents.
  - The wire protocol below keeps "host" a role, so a future DO-host can speak it unchanged (§O15).
- **WebRTC P2P first:** it puts more traffic off Cloudflare, but there is no TURN (paid) for blocked NATs, it exposes
  players' IPs to each other, and it adds signalling to the first build. It is phase 2 (§O15) on the same byte format.

---

## O2 The Worker and its Durable Objects (NET-SERVER lane)

### O2.1 Deployment shape
- Directory `forgeflow-games/workers/dyefield-net/`. Worker name `dyefield-net`, URL
  `https://dyefield-net.isimcha85.workers.dev` (WebSocket `wss://dyefield-net.isimcha85.workers.dev`).
- `wrangler.toml`:
  - `main = "src/index.ts"`, `compatibility_date = "2025-06-01"` (≥ 2024-04-03 for DO RPC; supported by wrangler
    4.92).
  - `[[durable_objects.bindings]]` `LOBBY`→`Lobby`, `ROOM`→`Room`, `METER`→`Meter`.
  - `[[migrations]] tag = "v1"`, `new_sqlite_classes = ["Lobby", "Room", "Meter"]`. **Never `new_classes`**: that is
    the key-value backend, which is Paid-only.
  - `[vars]`:
    - `ALLOWED_ORIGINS = "https://forgeflow-games-cdn.isimcha85.workers.dev,https://forgeflowgames.com,https://www.forgeflowgames.com"`
    - `DAILY_UNIT_CAP = "60000"` (§O9.3)
    - CHANGED(review) `COUNT_MODE = "strict"` (`"strict"` | `"billing20"`, §O9.3) and `RAW_CAP = "55000"` (incoming
      messages + connections + RPCs per UTC day, counted 1:1; enforced only in `strict`)
    - CHANGED(review) `PER_IP_ROOM = "8"`, `PER_IP_LOBBY = "4"` (§O8; `0` = off)
    - `PROTO = "1"`
  - Local dev only: `.dev.vars` sets `DEV_ORIGINS = "http://localhost,http://127.0.0.1"`, which matches any port, and
    may lower `DAILY_UNIT_CAP` for the quota test. **No secrets exist**: the worker binds nothing but its DOs.
    CHANGED(review): `.dev.vars` also sets `PER_IP_ROOM = "0"` and `PER_IP_LOBBY = "0"` (every local test client comes
    from 127.0.0.1; T9 and scenario B open 8–9 sockets from one address) and `DEV = "1"`, which alone enables the
    dev-only `cfg.durationS` (§O3.3).

### O2.2 HTTP / WebSocket routes (the stateless Worker)

| route | method | what |
|---|---|---|
| `/health` | GET | `{ok:true, proto, version, day, units, cap, open}` (one `Meter.status()` RPC). CORS `*`. |
| `/qm?mode=&rule=&build=` | WS upgrade | → `LOBBY.idFromName("qm:"+mode+":"+rule+":"+build)` |
| `/room/new?mode=&rule=&build=` | WS upgrade | Worker draws a code, `Room.claim({quick:false, …})` RPC (≤ 3 tries on `busy`), then forwards the upgrade with `?code=` |
| `/room/<CODE>?build=&token=&ticket=` | WS upgrade | → `ROOM.idFromName(CODE)`; join, reconnect (`token`) or quick-match entry (`ticket`) |

- **Origin check first, on every upgrade.** The `Origin` header must be in `ALLOWED_ORIGINS` (or match a
  `DEV_ORIGINS` prefix in dev). Otherwise answer `403` without touching a DO. This is a browser-level filter only:
  non-browser clients can forge it, and §O8 has the rest.
- Query values are validated: `mode ∈ {teams, ffa}`, `rule ∈ {turf, washout}`, `build` matches
  `^[a-z0-9.:-]{1,40}$`, and the code is 4 characters of the room alphabet, case-folded to upper. A bad value gets
  `400`.
- **Location hint:** a new Room/Lobby stub is created with `locationHint` from `request.cf`:
  - NA with longitude < −100 → `wnam`, other NA → `enam`;
  - SA → `sam`, EU → `weur`, AS → `apac`, OC → `oc`, AF → `afr`;
  - default `enam`.
- The Worker's own CPU stays far under the Free 10 ms per request: it only parses the URL and forwards.

### O2.3 `Room` DO (one per code)
- Accepts sockets with `ctx.acceptWebSocket(ws, ["s"+slot])`. Each socket's attachment (≤ 16 KB) holds
  `{slot, token, name, kit, crew, color, device, simMs, rttMs, joinedAt, ticket?}`. Room-level state lives in
  `ctx.storage`: `{code, quick, mode, rule, build, map, preset, skill, phase, ownerSlot, hostSlot, matchNo,
  createdAt, lastActive}`.
- Auto-response `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("p","P"))` lets clients measure RTT
  to the DO for free, without waking it. `getWebSocketAutoResponseTimestamp(ws)` gives a socket's last ping (for
  pre-match idle).
- `claim(opts)` RPC:
  - It succeeds when the room is unclaimed, or closed / idle for more than 30 min (state reset).
  - Otherwise it returns `{ok:false, why:"busy"}`.
  - Quick rooms carry the expected `tickets` (one per matched player); a quick room accepts only sockets with a valid
    ticket (or a reconnect token).
- Phases: `room` → `loading` → `live` → `post` → (`room` for a rematch | `closed`). Live substates (countdown /
  playing / ended) are the host's business. The DO only knows `live`.
- Slots 0..7 are given in join order (a reconnect gets its old slot back). Max 8 humans: the 9th gets
  `err room_full`. No spectators.
- Routing rules: §O3.2 (binary) and §O3.3 (text). **Host selection and host-loss detection: §O4.4, §O6.**
- Usage counting: every incoming frame (text and binary, from every socket) increments `msgs`; every accepted socket
  and every RPC made increments `units`. The Room calls `Meter.add(ceil(msgs/20) + units)` and resets the counters:
  - every 60 s while `live` (piggy-backed on an incoming message, no timer);
  - at `post`;
  - when the last socket closes.
  - CHANGED(review): `Meter.add({units: ceil(msgs/20) + other, raw: msgs + other})` — both counts, always (§O2.5).
- Cleanup: when the last socket closes, `phase = closed`. Storage is left small (one row) and is reset by the next
  `claim`. Rooms do not schedule alarms.
- CHANGED(review) — **storage writes only on transitions.** The Free plan allows 100,000 SQLite rows written per day
  per account [cited: pricing partial]; a `ctx.storage.put` per message (e.g. keeping `lastActive` fresh) would spend
  that in ~10 minutes of one live match, and then every storage write fails (no `claim`, no new rooms). The Room
  writes storage only on `claim`, phase changes, host / owner changes and `matchNo` changes (≈ 10 rows per match);
  `lastActive`, rate buckets and counters live in memory (rebuilt after a wake). Gate: T8 asserts ≤ 20 row writes per
  match (count the `put` calls in a test build).
- CHANGED(review) — the Room reads the `u32 tick` at bytes 2–5 of every `SNAP` it relays (fixed header, §O3.2) and keeps
  `lastSnapTick` in memory, so `host {lastTick}` (§O6.2) is the tick of the last `SNAP` it actually forwarded. It still
  never parses anything else in a binary frame.
- CHANGED(review) — **the Room voids a match itself.** It counts host changes per `matchNo`. On the 4th host loss
  (§O6.3 step 6) there may be no healthy host to send `end`, so the Room broadcasts `{t:"end", matchNo,
  voided:true}` itself and goes to `post`.
- CHANGED(review) — the Room keeps the last relayed `end` text (≤ 64 KB) in memory during `post`, and sends it right
  after `welcome` to a socket that reconnects with its token during `post` (a player whose socket dropped at the horn
  still gets the slate and the stats hand-off).
- CHANGED(review) — a DO's location is fixed when its name is first used; `locationHint` only acts on that first
  `get()`. Room codes are reused over time, so an old code may live in another region (higher RTT for that room).
  Accepted: with ~10⁶ codes and ≤ a few hundred matches a day, almost every claim is a fresh name.

### O2.4 `Lobby` DO (one per mode × rule × build)
- Players connect with WS and send `qm`. The Lobby keeps the queue in memory, rebuilt from socket attachments after a
  hibernation wake (`ctx.getWebSockets()`).
- **Grouping:**
  - The first waiting player opens a *forming group*.
  - The group launches when it reaches 8 humans; or when it has ≥ 2 humans and either `QM_FILL_WAIT_S` (10 s) has
    passed since its 2nd human joined or `QM_MAX_WAIT_S` (20 s) has passed since its 1st.
  - A lone player gets `{t:"solo"}` after `QM_SOLO_WAIT_S` (45 s): KEEP WAITING or PLAY VS BOTS (offline).
  - Same-continent players are grouped first (`request.cf.continent`). The group widens to everyone at
    `QM_FILL_WAIT_S`.
- **Launch:**
  1. Check `Meter.status()` (cached ≤ 30 s). At or over the cap, send `{t:"err", code:"quota"}` to every member.
     CHANGED(review): the binding check is the Room's `Meter.admit(est)` at the match start (§O2.5, §O4.5 step 1);
     the Lobby's cached `status()` only avoids forming groups on a closed day. A refused `admit` sends `err quota` to
     every member, and they get the offline offer.
  2. Draw a code and `ROOM.claim({quick:true, mode, rule, build, tickets, hint})`; retry on `busy`.
  3. Send each member `{t:"matched", code, ticket}`. The client closes the lobby socket and opens
     `/room/<code>?ticket=`.
- **Late fill (SHOULD):**
  - A live quick Room reports `roomOpen(code, openSeats, endsAtMs)` to its Lobby on every change. An RPC from Room to
    Lobby; the Lobby keeps it in memory.
  - A new quick-match player is routed straight into a live room that has an open seat (a bot-driven runner) and
    `≥ LATE_JOIN_MIN_LEFT_S` (45 s) left. `reserve(ticket)` RPC to the Room first; fall back to queueing on refusal.
- Timers: the Lobby uses `setTimeout` only while players wait, so it is awake only then. An empty Lobby hibernates.

### O2.5 `Meter` DO (one instance, `idFromName("meter")`)
- SQLite table `day(utc TEXT PRIMARY KEY, units INTEGER)`. CHANGED(review): `day(utc TEXT PRIMARY KEY, units INTEGER,
  raw INTEGER, reserved INTEGER)`.
- `add(n)` upserts today's row (one row write per call; ≤ ~5 calls per match).
- `status()` returns `{day, units, cap, open: units < cap}`, the cap being `DAILY_UNIT_CAP`.
- Rows older than 14 days are deleted on the first `add` of a day.
- CHANGED(review) — **admission instead of a soft cap.** "Running matches always finish" let a burst of matches started
  just under the cap overshoot it by their whole remaining usage (8 rooms × ~1,500 units). Now:
  - `admit(est)` RPC at every `start` / rematch / late-fill launch: `est` = the §O9.2 per-match figure for the room's
    human count (both `units` and `raw`). It succeeds only if, for the active counting mode, `used + reserved + est ≤
    cap`; then `reserved += est`. Otherwise `err quota`.
  - `settle(est, actual)` at `post` / close: `reserved −= est`, `used += actual` (the 60 s `add`s during the match
    count toward `actual`, not twice). A reservation left by a Room that died expires at 00:00 UTC.
  - `status()` returns `{day, mode, units, raw, reserved, capUnits, capRaw, open}`.
  - In `strict` mode the binding cap is `RAW_CAP` on `raw`; in `billing20` it is `DAILY_UNIT_CAP` on `units`. Both are
    always recorded, so switching mode needs no data migration.

---

## O3 Wire protocol (shared by NET-SERVER and SYNC)

`PROTO = 1`. `NET_BUILD = VERSION + "+p" + PROTO` (e.g. `dyefield-1.4.0+p1`). CHANGED(review): plus `"+" + BUILD_ID`,
where `BUILD_ID` = the 8-character content hash in the entry chunk's file name (`new URL(import.meta.url).pathname`
→ `assets/index-<hash>.js` in a Vite build; `"dev"` under the dev server). A hotfix deploy that changes the sim but
not `VERSION` would otherwise pair old and new clients, whose paint and movement differ (a desync every 2 s, and
mispredicted movement for the whole match). Only identical builds meet:
- the Lobby name includes the build;
- a Room stores its creator's build and refuses joiners with another one: `err build` ("Update DYEFIELD: reload the
  page");
- the host also checks each client's `atlasSig` (§O4.5).

### O3.1 Framing
- **Binary frames** (`ArrayBuffer`, little-endian, `DataView`) carry the high-rate traffic. Byte 0 = `kind`.
  Byte 1 = `slot`: the sender for client→host frames, the target for host→one frames, `0xFF` for host→all frames.
  The DO reads only these two bytes and the length (CHANGED(review): plus the `u32 tick` at bytes 2–5 of `SNAP`
  frames, for `host.lastTick`, §O2.3).
- **Text frames** carry JSON control messages `{t:"…", …}`, all low-rate. The single exception is the 1-byte
  auto-response ping `"p"` → `"P"`.

### O3.2 Binary kinds and routing

| kind | name | from → to | DO routing / checks | size cap | rate |
|---|---|---|---|---|---|
| `0x01` | `INTENTS` | client → host | byte1 must equal the sender's slot, else drop; forward to the host socket only | 512 B | 20 Hz |
| `0x02` | `SNAP` | host → all | sender must be the host; forward to every other socket | 64 KB | 20 Hz |
| `0x03` | `KEYFRAME` | host → one | sender must be the host; forward to slot byte1 only | 2 MB | ≤ 1 / 10 s per target |
| `0x04` | `HANDOFF` | host → all | sender must be the host; forward to all; then the DO runs the migration of §O6.2 | 64 KB | once |

Every other kind or direction is dropped and counted.

**`INTENTS` layout:**
```
0 u8 kind=1 | 1 u8 slot | 2 u16 firstSeq | 4 u8 n (1..6) | 5 u8 flags (bit0 = focus lost)
then n × 13 B:  i8 moveX(×127) | i8 moveZ(×127) | u16 yaw(×65536/2π, wrapped) | i16 pitch(×32767/π ≈ 10430.06)
                | u8 buttons(b0 jump, b1 fire, b2 slick, b3 sub, b4 special, b5 hasAim)
                | i16×3 aim point (cm, world)
```
- The host dequantizes and clamps every intent (§O8): moveX/Z to ±1, finite numbers only, pitch to the camera limits.
- The client's own prediction uses the **same quantized values** it sent, so host and client step identical intents.

**`SNAP` layout** (SYNC finalizes the exact offsets in `runtime/src/net/proto.ts` and appends the final table to this
section as `O3.2a` before integration; the DO depends on bytes 0–1 only):
- header:
  - `kind=2 | 0xFF | u32 tick | u8 phase(0 countdown, 1 live, 2 ended) | u16 ticksLeft | u16 countdownTicks`
  - `| u8 flags(b0 hash present, b1 scoreboard present) | [u32 painterHash] | u8 nRunners`
- per runner (≈43 B):
  - `f32 x,y,z | f32 vx,vy,vz | u16 yaw | u16 aimYaw | i16 aimPitch | u16 flags`. The flags hold MoveState (3 bits),
    alive, slickForm, firing, hidden, grounded, rolling, flicking, leaping, charging, specialReady, courtFrozen.
  - `u8 hp(×255/WEAPONS.hp) | u8 tank(×255/TANK.max) | u8 special(×255) | u8 charge(×255)`
  - `| u8 respawnT(1/20 s) | u8 protectedT(1/20 s) | u8 surfacing(1/100 s) | u8 specialActive(0 none, else index+1)`
  - `| u8 specialT(1/20 s) | i8 spawnSite | u8 subCooldown(1/20 s) | u16 ackSeq`. `ackSeq` is the last consumed intent
    seq for a human runner, 0 for a bot.
- scoreboard (every 30 ticks, and in every keyframe / handoff):
  - per crew: `u16 score` (WASHOUT);
  - per runner: `u16 washes | u16 washedCount | f32 painted | u16 shots`.
  - CHANGED(review) per runner, the **seat totals** (§O7.5): `u8 seatSlot (0xFF = no human seat) | u8 seatHuman (1 =
    human-driven now) | u32 seatLiveTicks | f32 seatPainted | u16 seatWashes | u16 seatWashed` (+14 B × 8 every 30
    ticks ≈ 0.2 KB/s). A new host restores them (§O6.3), so seat totals survive migration.
- records: `u16 nRecords`, then the ordered record stream of every tick since the previous `SNAP` (§O5.3).

**`KEYFRAME` layout:**
- header: `kind | slot | u32 tick | u32 painterHash`
- `u32 compressedLen | deflate-raw(atlas.team)`, compressed with `CompressionStream("deflate-raw")`
- a full `SNAP` body with the scoreboard
- per-runner **extended block** (`Runner.netState`, §O12.2): every mutable field `Runner.step` / `stepKit` read,
  as f32/u8.

**`HANDOFF` layout:** the same header, **no paint bytes**, then the `SNAP` body + scoreboard + extended blocks + a
length-prefixed UTF-8 JSON tail `{roster, seats, matchNo, seed, migrations, botSkill, durationS}`.
- No paint bytes, because every client already holds an exact paint mirror.
- It must be encoded **synchronously** (no `CompressionStream`). It is sent from a `visibilitychange` / `pagehide`
  handler, and a phone may suspend the page right after that handler returns.
- CHANGED(review) — **at a `SNAP` boundary only.** The old host first sends the `SNAP` of its current tick k (the
  records up to and including tick k, even if fewer than 3 ticks are pending), then the `HANDOFF` with `tick = k`, and
  never steps again. A tick stepped after the last `SNAP` would have painted texels that no client ever received:
  the new host's court and everyone's mirrors would silently miss that paint.

### O3.2a Final binary layouts (SYNC, 2026-10-01 — `runtime/src/net/proto.ts` is the source; this table mirrors it)
The relay still reads only bytes 0–1 of every frame and the `u32 tick` at bytes 2–5 of `SNAP` / `HANDOFF`. Everything
below is between the host and the clients.

**`SNAP`** (all little-endian):

| offset | field | notes |
|---|---|---|
| 0 | `u8 kind = 2` | |
| 1 | `u8 0xFF` | |
| 2 | `u32 tick` | the host tick after the step (the Room reads it) |
| 6 | `u32 prevTick` | NEW: the previous SNAP's tick = the base of the record tick offsets. A client whose last applied SNAP is not `prevTick` missed one (late join / reconnect) and resyncs (KEYFRAME) |
| 10 | `u8 phase` | 0 countdown, 1 live, 2 ended |
| 11 | `u16 ticksLeft` | `round(world.timeLeft / TICK)` |
| 13 | `u16 countdownTicks` | |
| 15 | `u8 flags` | b0 painter hash present, b1 scoreboard present, b2 first SNAP of a new host |
| 16 | `[u32 painterHash]` | FNV-1a of `atlas.team` (`Painter.hash()`), every `HASH_EVERY` ticks and in a new host's first SNAP |
| … | `u8 nRunners` + nRunners × 52-byte runner blocks | below |
| … | `[scoreboard]` | every `SCOREBOARD_EVERY` ticks, the first SNAP of a new host and every SNAP after the horn |
| … | `u16 nRecords` + records | below |

**Runner block (52 B)** — changed from the ≈43 B sketch so the client reproduces the host's movement exactly:
`f32 tx, ty, tz` = the capsule **translation** (feet y = `(ty − halfHeight) − radius` for the tall / slick shape in
flags b14; Runner.x/y/z always come from the f32 translation, so the client's feet are bit-identical to the host's) ·
`f32 vx, vy, vz` · `u16 yaw` (×65536/2π) · `u16 aimYaw` · `i16 aimPitch` (×32767/π) · `u16 flags` (b0–2 MoveState walk /
slog / slick / wallslick / air, b3 alive, b4 slickForm, b5 firing, b6 hidden, b7 grounded, b8 rolling, b9 flicking, b10
leaping, b11 charging, b12 specialReady, b13 courtFrozen, b14 tall, b15 ballistic) · `u8 hp` (×255/WEAPONS.hp) ·
`f32 tank` (was u8: the dry-click rule the client predicts needs it) · `u8 special` (floor ×255) · `u8 charge` (×255) ·
`u8 respawnT` (1/20 s) · `u8 protectedT` (1/20 s) · `u8 surfacing` (whole ticks) · `u8 specialActive` (0 none, else
WEAPONS.specials index + 1) · `u8 specialT` (1/20 s) · `i8 spawnSite` · `u8 subCooldown` (1/20 s) · `u16 ackSeq` (last
consumed intent seq of a remote human, else 0) · `u8 launches`, `i8 lastSpring`, `u8 jumps`, `u8 landings` (counters mod
256: the view's spring splash / jump / land animations of remote runners).

**Scoreboard:** `CREW_SLOTS (9) × u16 score`, then per runner `u16 washes | u16 washedCount | f32 painted | u16 shots |
u8 seatSlot (0xFF none) | u8 seatHuman | u32 seatLiveTicks | f32 seatPainted | u16 seatWashes | u16 seatWashed` (24 B).

**Records:** `u8 tickOffset` (ticks after `prevTick`) `| u8 type |` payload — `1` PAINT_SPHERE `u8 team | f64 x y z |
f64 radius | u8 optMask (b0 normal, b1 minFacing, b2 edgeNoise, b3 seed) | [f64 nx ny nz] | [f64 minFacing] |
[f64 edgeNoise] | [i32 seed] | u32 flips`; `2` PAINT_CAPSULE the same with `f64 bx by bz` after `az`; `3` PSPAWN `u8 kind |
u8 variant | u8 owner | u8 team | f32 x y z | f32 vx vy vz | u32 seed | f32 dripEvery`; `16 + i` EVENT of type
`EVENT_TYPES[i]` (every SimEvent but `'splat'`; positions f32, directions i16 ×32767, string fields as indexes into the
weapons.json kit / sub / special id lists).

**`INTENTS`:** exactly §O3.2. The client clamps before quantizing (pitch to the camera limits, the aim point to the map
bounds + 20 m, else `hasAim = false`) and steps the dequantized values; the host re-applies the same clamps.

**`KEYFRAME`:** `u8 kind = 3 | u8 slot | u32 tick | u32 painterHash | u32 compressedLen | deflate-raw(atlas.team) |` the
SNAP body from `prevTick` on (`prevTick = tick`, scoreboard always, `nRecords = 0`) `|` EXT BLOCKS. Written right after
the SNAP of the same tick (the paint bytes are captured synchronously, deflated asynchronously). The host sends at most
one per 10 s per client for a hash mismatch, and a late join / reconnect one ≥ 1.1 s after the previous (the relay's 1 s
floor). The client keeps applying SNAPs while it waits and re-applies the paint records of every SNAP after the
keyframe's tick on top of it (nothing freezes).

**`HANDOFF`:** `u8 kind = 4 | u8 0xFF | u32 tick | u32 painterHash |` the SNAP body from `prevTick` on (scoreboard,
`nRecords = 0`) `|` EXT BLOCKS `| u32 jsonLen | JSON {roster, seats:[{slot, runner, human, painted, washes, washedCount,
liveTicks}], matchNo, seed, migrations, botSkill, durationS, world: MatchWorld.netState()}` (the world's private clock,
scores, respawn / protect ticks, FFA site history, killers, spawn slots: the restore is exact).

**EXT BLOCKS:** `u8 n`, then per runner `f64 ×` every numeric field of `Runner.netState()` (`RUNNER_NET_NUM` + the
private `coyote, jumpBuf, brushClock, offDyeT, wallCd, probeNx, probeNz, spawnX/Y/Z/Yaw`) `| u32` the boolean bits
(`RUNNER_NET_BOOL` + `tall, prevJump, prevFire, refilling`) `| u8 state | u8 lastGround | u8 specialActive`.

**`NET_BUILD`:** `VERSION + ":p" + PROTO + ":" + BUILD_ID`, lower-cased (`+` → `:`, so it matches `^[a-z0-9.:-]{1,40}$`
without URL escaping), e.g. `dyefield-1.4.0:p1:3f9a1c2e`.

**Notes for the relay / other lanes (SYNC behaviour the Room sees):**
- The host re-sends `roster` (with the current seats) whenever a `peer {conn:true}` arrives during a match — a late
  joiner gets its seat there (`seat {human:false}` reserves the runner first; `loaded` → `seat {human:true}` + KEYFRAME).
- Clients send no `INTENTS` before the host's first SNAP (the load / roster wait costs no frames).
- The host stops sending SNAPs 2 s after the horn (its `end` follows the final SNAP at once).

### O3.3 Text control messages

| `t` | direction | handled by | fields |
|---|---|---|---|
| `qm` | client → Lobby | Lobby | `proto, build, name, kit, crew, color, device ('kbm'\|'touch'), simMs, rttMs` |
| `queue` | Lobby → client | — | `waiting, waitedS` (on change only) |
| `solo` | Lobby → client | — | — |
| `matched` | Lobby → client | — | `code, ticket` |
| `hello` | client → Room | Room | `proto, build, name, kit, crew, color, device, simMs, rttMs, token?` |
| `welcome` | Room → client | — | `slot, token, room:{code, quick, mode, rule, map, preset, skill, phase, ownerSlot, hostSlot, matchNo}` |
| `members` | Room → all | — | `members:[{slot, name, kit, crew, color, device, conn, owner, host, rttMs}], phase` |
| `set` | client → Room | Room | any of `kit, crew, color, rttMs, simMs` (pre-match; rebroadcast `members`) |
| `cfg` | owner → Room | Room | any of `mode, rule, map ('pier18'\|'lockwell'\|'cinder'\|'random'), preset, skill` (phase `room` only); CHANGED(review) `durationS` (10–180) is accepted **only** when the Worker runs with `DEV = "1"` (local `wrangler dev`) — the test plan's short matches; production ignores it |
| `start` | owner → Room | Room | — (code rooms, ≥ 2 humans connected) |
| `assign` | Room → all | — | `matchNo, hostSlot, seed, map (resolved), preset, mode, rule, skill` |
| `roster` | host → all | relayed | `matchNo, seats:[{slot, runner}], roster:RosterEntry[], durationS, countdownS` |
| `loaded` | client → host | relayed (+`from`) | `matchNo, atlasSig` |
| `seat` | host → all | relayed | `runner, slot \| null, name, human:boolean` (late join, leave, bot takeover) |
| `resync` | client → host | relayed (+`from`) | `tick, myHash` |
| `end` | host → all | relayed; Room → `post` | `matchNo, result:MatchResult, runners:[{id, name, team, slot\|null, washes, washedCount, painted, shots}], migrations, voided`; CHANGED(review) each runner also carries `seat: {slot, human, liveTicks, painted, washes, washedCount} \| null` — the totals of the human seat holding that runner at the horn, over human-driven time only (§O7.5); `human` = that seat is human-driven at the horn (false while its player is disconnected or silent); `null` when no seat holds the runner (a bot from the start, or its player LEFT). The Room may also originate `{t:"end", matchNo, voided:true}` (§O2.3) |
| `kick` | host or owner → Room | Room | `slot, why ('idle'\|'owner')` → that socket closes with 4008 |
| `handoff` | host → Room | Room | — (graceful: the host is going away; precedes `HANDOFF`, §O6.2) |
| `host` | Room → all | — | `hostSlot, reason ('left'\|'stalled'\|'handoff'), lastTick` |
| `peer` | Room → all | — | `slot, conn:boolean` |
| `rematch` | client → Room | Room | — (phase `post`) |
| `leave` | client → Room/Lobby | Room/Lobby | — |
| `err` | DO → client | — | `code ('room_full'\|'not_found'\|'busy'\|'build'\|'proto'\|'quota'\|'rate'\|'origin'\|'bad'), msg` |

- The DO stamps `from: slot` on every relayed client message and drops relayed host messages from a non-host.
- Close codes:
  - 4000 normal leave;
  - 4004 not found;
  - 4008 kicked (idle / owner);
  - 4009 room full;
  - 4026 build or proto mismatch;
  - 4029 rate abuse;
  - 4030 quota;
  - 4031 room closed.

---

## O4 Match flow

### O4.1 Online menu (LOBBY-UI)
- The title stack gains **PLAY ONLINE** right under PLAY (`CHANGED(ONLINE)` to CONTRACT_P6_11 §20's menu).
  - CHANGED(review): `_harness/menus.py:245` asserts the title labels are exactly
    `["PLAY", "LOADOUT", "SETTINGS", "HOW TO PLAY", "CREDITS"]`, so this item fails an existing gate as written.
    LOBBY-UI is allowed exactly one edit to that gate: the expected list becomes
    `["PLAY", "PLAY ONLINE", "LOADOUT", "SETTINGS", "HOW TO PLAY", "CREDITS"]`, with a `CHANGED(ONLINE)` comment. No
    other `menus.py` assertion changes. (STATS' CAREER entry is a corner pill and does not touch the stack,
    CONTRACT_STATS §S10.3.)
- The PLAY ONLINE screen:
  - **MODE** (TEAMS · 4 v 4 / FREE-FOR-ALL) and **RULE** (TURF / WASHOUT) selectors, defaulting to the profile's;
  - **QUICK MATCH**, **CREATE ROOM**, **JOIN ROOM** (a code entry: 4 characters, upper-cased, alphabet-filtered),
    BACK.
- The player's name, kit, crew (TEAMS preference) and FFA colour come from LOADOUT (the profile), as offline.
- The screen is hidden if `WebSocket` or `CompressionStream` is missing. Then PLAY ONLINE shows disabled with
  "Your browser can't play online".

### O4.2 Quick match
- Searching card: "Finding players… N waiting", elapsed seconds, CANCEL.
- On `solo` (45 s alone): KEEP WAITING / PLAY VS BOTS. PLAY VS BOTS starts the normal offline match with the same
  mode / rule.
- On `matched`: connect to the room. Quick rooms skip the room screen and auto-start once every matched member has
  said `hello`, or 8 s after the first one did.
- The map is random (seeded by the Room), the preset `noon`, bots SWELL, the clock 3:00.
- After the horn, quick rooms offer **REMATCH** / LEAVE. When ≥ 2 humans press REMATCH within 20 s, the same room
  starts again; otherwise each REMATCH presser is re-queued in the Lobby.

### O4.3 Code rooms (CREATE / JOIN)
- The room screen:
  - the big code and "Share this code with a friend. They pick JOIN ROOM and enter it.";
  - 8 seat rows (humans with name, kit, device glyph, ping; empty seats "BOT");
  - for the owner, MODE / RULE / MAP (RANDOM + 3) / TIME OF DAY / BOTS (BREEZE / SWELL / STORM) and START (enabled
    with ≥ 2 humans connected), plus KICK per member;
  - for others the same values read-only; LEAVE for everyone.
- The owner is the creator. If the owner leaves, ownership passes to the lowest connected slot.
- After the horn: PLAY AGAIN (owner; back to the room screen with the same members, host re-picked) / LEAVE.
- Code rooms with nobody connected close (§O2.3). A room idle (no `start`) for 15 min closes with 4031.

### O4.4 Host selection [design]
At every `start` (and every migration) the Room scores each connected human and picks the best:

```
score = (device == 'kbm' ? 1000 : 0) − 10 × simMs − rttMs        (ties → lowest slot)
```
- `simMs` = the client's measured mean sim ms per tick on its lobby backdrop. The lobby `Game` runs the real sim with
  bots, so this is the device's real host capacity.
- `rttMs` = the median of its auto-response pings to the Room.
- So **a phone never hosts while a desktop / laptop is in the room**. An all-phone room picks the fastest phone.
  Measured 4× throttle: 53.5 ticks/s offline, so an all-phone match may run slightly slow; that is accepted, not
  hidden.

### O4.5 Start sequence
1. The Room checks the meter (`err quota` when closed; CHANGED(review): `Meter.admit(est)` for this room's human
   count, §O2.5 — also for a rematch / PLAY AGAIN, and a late fill re-admits the difference). It resolves `map: random` with its own RNG, draws
   `seed: u32`, sets `phase = loading`, increments `matchNo` and sends `assign`.
2. **Host roster build:**
   - Runner ids equal roster indexes (`MatchWorld` requires it, world.ts:461).
   - TEAMS: humans are split so the human counts differ by ≤ 1. Each human's crew preference is honoured while
     balance allows; otherwise the lowest slots keep theirs. SUNCREW gets ids 0..3 and GULF CREW ids 4..7. Bots fill
     each side to 4.
   - FFA: one runner per crew. Each human keeps its FFA colour first-come by slot; a taken colour moves to the lowest
     free one. Bots take the rest.
   - Bot names and kits come from `defaultRoster` / `ffaRoster` with the match seed (`mixedBotKits`). Human entries
     carry the player's name (sanitized, §O8) and kit.
   - **Every entry is built `bot: true`** (so `BotDirector` makes a brain for every runner, ready for takeover). The
     host then marks the human-driven runners with `BotDirector.setHuman(id, true)` (§O12.2).
   - The host sends `roster`.
3. Every member (the host included) loads the arena with the existing `loadArena` / `startSession` path
   (`startSession` is the SYNC lane's to extend). Each then sends `loaded {matchNo, atlasSig}`.
   - `atlasSig = hash32(atlas.size, atlas.count, FNV-1a over atlas.area[] and atlas.lin[] sampled every 997th
     texel)`.
   - A client whose `atlasSig` differs from the host's cannot mirror paint. The host answers
     `seat {runner, slot:null}`, keeps a bot on that runner, and the UI shows "This device built a different court —
     reload". Expected never; gated in the 2-browser test.
4. The host starts the countdown when every seated human is loaded, or `LOAD_TIMEOUT_S` (25 s) after `roster`. A late
   loader joins as a late joiner (§O7.1); its runner is bot-driven until then.
5. Countdown 3 s (the same `MatchWorld` countdown), live 3:00, the horn.
6. The host sends `end`. The Room goes to `post`. Every client shows the victory slate from `end.result` and calls the
   stats hook (§O11.3).

---

## O5 Host loop and client sync (SYNC lane)

### O5.1 The host tick
The host runs the offline loop (`frame` → `simStep`, 60 Hz accumulator, `MAX_STEPS_PER_FRAME`) with three changes:
- Before `director.think(intents)` + `world.step(intents)`, each remote human runner's intent is popped from its
  queue:
  - target depth 2;
  - over 6 → drop the oldest down to 2;
  - empty → repeat the last intent;
  - after `INTENT_SILENT_NEUTRAL_MS` (250 ms) of no `INTENTS` frame from that client → a neutral intent that keeps
    yaw / pitch / aim with everything else zeroed;
  - after `INTENT_SILENT_BOT_S` (3 s) → `setHuman(id, false)`: the bot takes over until frames resume, and `seat` is
    broadcast both times.
  The `BotDirector` thinks for every runner whose brain is active.
- The host's own runner takes its local intent as offline (no network, no quantization).
- Every `SNAP_EVERY` (3) ticks the host encodes one `SNAP` and sends it:
  - the runner states, `ackSeq` per human;
  - the painter hash every `HASH_EVERY` (120) ticks, computed after the tick's paint;
  - the scoreboard every 30 ticks;
  - the records of those 3 ticks.
- The host's sim must not depend on rAF while hidden: a hidden host hands off (§O6.2) instead of running in the
  background.

### O5.2 Intents (client)
- The client keeps its own 60 Hz tick (the same accumulator). Each tick:
  1. build the intent exactly as offline (`input.intent`, `airSpecial`, the aim ray);
  2. quantize it;
  3. push it to a pending ring with `seq++`;
  4. step the predicted local runner with it (§O5.5).
- Every 3 ticks: send one `INTENTS` frame with the 3 newest intents (`firstSeq`, n = 3; up to 6 after a hitch).
- `flags.b0` is set while the page is hidden or blurred. Such a client sends neutral intents at 4 Hz, as a keep-alive,
  until it is visible again. CHANGED(review): browsers clamp timers in hidden tabs to ≥ 1 s (and to once a minute
  after ~5 min), so the real rate there is ≤ 1 Hz. The host must not treat that as a fault: such a client sits at the
  250 ms neutral intent, never reaches the 3 s bot takeover while frames keep arriving at ≥ 1 Hz, and is removed by
  the 60 s idle kick (§O7.4) if it stays away.
- RTT read-outs:
  - client ↔ host: the time from sending intent `seq` to the first `SNAP` with `ackSeq ≥ seq`, less the host queue
    delay (`queue depth × TICK`); an EWMA, shown in the ping badge;
  - client ↔ DO: the free `"p"`/`"P"` auto-response, every 2 s. Auto-responses do not wake a hibernated DO and are
    not billed [cited: /durable-objects/api/state/]. CHANGED(review): the docs only say they add no duration; whether
    the incoming `"p"` counts as a request is not stated (§O0.1). Ping every 2 s only while live (the RTT badge); every
    10 s pre-match and while queued; since the Room cannot see them, at each `Meter.add` it adds the estimate
    `0.5 × sockets × liveSeconds + 0.1 × sockets × otherSeconds` to `raw` (and a twentieth of it to `units`).

### O5.3 The record stream (paint, projectiles, events)
At host-session start the SYNC lane wraps three **instance methods** (never the class) and unwraps them at dispose:
`painter.splat`, `painter.capsule` and `world.projectiles.spawn`. CHANGED(review): one `Painter` serves every session
of an arena, the lobby backdrop included (§O0.2), so the wrapper is installed only after the previous session on that
arena (the lobby `Game`) is disposed, and removed before any lobby session starts on it again; otherwise lobby paint
would be streamed into the match. Each wrapper calls through unchanged (same
arguments, same return), so the sim is byte-identical, and appends a record. After each tick the host drains the
world's events and appends them, **except `'splat'`**, which clients regenerate from the paint ops.

| record | payload | precision |
|---|---|---|
| `PAINT_SPHERE` | `u8 team, f64 x, y, z, f64 radius, u8 optMask, [f64 nx, ny, nz], [f64 minFacing], [f64 edgeNoise], [i32 seed], u32 flips` | **exact f64**; optional `SplatOpts` fields are sent only when present, so `undefined` stays `undefined` |
| `PAINT_CAPSULE` | same + `f64 bx, by, bz` | exact |
| `PSPAWN` | the `ProjectilePool.spawn` arguments: `u8 kind, u8 variant, u8 owner, u8 team, f32 x, y, z, f32 vx, vy, vz, u32 seed, f32 dripEvery` | exact (the pool is Float32) |
| `EVENT` | `u8 type` + a compact per-type payload for every `SimEvent` but `'splat'` | positions f32, directions i16 normalized, pids u8 |

- Each record is prefixed by `u8 tickOffset` (ticks after the previous `SNAP` tick) and `u8 type`.
- **Clients apply `PAINT_*` records with the same `Painter.splat` / `capsule` call and the same arguments, in order.**
  - For each `PAINT_SPHERE` the client synthesizes the `'splat'` event the host's `MatchWorld.paint` pushed:
    `{t:'splat', x, y, z, r, team, nx, ny, nz, flips}`, with `flips` from its own call. A client flip count different
    from the record's `flips` is an immediate desync signal.
  - Then it feeds the event list to the existing `drainEvents` consumers: fx, players, HUD, audio, juice, stats hook.
- After applying the records of a `SNAP` that has a hash, the client compares `painter.hash()` (FNV-1a over
  `atlas.team`) with it.
  - A mismatch sends `resync`. The host answers with a `KEYFRAME`, at most one per 10 s per client.
  - Desyncs are counted in `__NET__.stats()`. The expected count is 0 (same engine, same arguments); the safety net
    exists because `Math.hypot` precision is not specified across JS engines (it normalizes the splat normal,
    painter.ts:174).
- **Projectile visuals (clients):** clients mirror flight cosmetically, with no gameplay effect.
  - Each client keeps a cosmetic `ProjectilePool` in its container world (§O5.4). It is fed by `PSPAWN` and stepped
    each client tick by `stepProjectiles` with a **no-effect host**: `paint` returns 0, `hit` / `burst` do nothing
    (the host's events drive the FX), `land` turns a lander's slot to PUDDLE / HOVER.
  - A resting slot is removed on the host's matching `sub pop` / `special end` event for its owner, or at `maxLife`.
  - So `fx.update(…, pool)` and the audio router read a live pool exactly as offline.
  - CHANGED(review): on a `host` message (migration) clients clear the cosmetic pool: the new host's world starts with
    no projectiles (§O6.3), so old in-flight droplets would otherwise land on screen and paint nothing.
- CHANGED(review) — timing note: paint ops apply on arrival (needed for prediction, §O5.5) while remote runners and FX
  play `INTERP_DELAY` later, so a remote player's paint can appear ~100 ms before their droplet lands. `PSPAWN`
  records are therefore also applied on arrival (the droplet and its splat stay together; the droplet may start a
  little ahead of the interpolated muzzle). Cosmetic only; no gate.

### O5.4 The client's container world
A client builds the **same `MatchWorld`** as the host: same roster, map, mode, rule, seed and duration. It gets the
runners (the view reads `Runner` objects), the variant table (`kinds`), `spawnSites` and the painter binding. **The
client never calls `world.step()`.** Each frame the net layer writes:
- remote runners: interpolated snapshot fields (§O5.6), including `px/py/pz/pyaw`, so the view's alpha
  interpolation is a no-op;
- the local runner: its predicted state (§O5.5) plus the host's authoritative non-movement fields (hp, alive,
  respawnT, special, specialReady, protectedT, washes…);
- `phase`, `timeLeft`, `countdown` and WASHOUT scores (an additive `MatchWorld.netRestore` partial call, or the public
  fields).

The HUD, minimap, players, fx, juice and audio then run unchanged. The coverage numbers come from the client's own
painter, which equals the host's.

### O5.5 Local prediction and reconciliation
- **S1 (must):**
  - The local runner is stepped every client tick with `Runner.step(dt, intent, painter, localEvents)`, the same call
    `MatchWorld` makes. That is movement, slick / slog / wall-slick, jumps, springs and conveyors, against the
    client's map physics and painter mirror. Exact as long as paint and intents match.
  - On each `SNAP`:
    1. remember the pre-correction render position;
    2. load the host state of the local runner from the base block;
    3. drop pending intents with `seq ≤ ackSeq`;
    4. re-step the rest (typically RTT/16.7 ms ≈ 3–12 ticks).
  - The visual error offset (rendered position − corrected position) decays over 100 ms when < 0.5 m and snaps
    when > 2 m.
  - Private movement fields stay on the client's own values between keyframes. They are loaded from the extended
    block on keyframes only.
  - CHANGED(review) — loading a host state into the local runner (`Runner.netLoad`, §O12.2) must also move its
    Rapier capsule (`body.setFeet(x, y + MOVE.skin, z)`, as `Runner.teleport` does, `runner.ts:367`) and set the capsule
    shape to match the loaded `slickForm` / tall state (`body.setShape`, `runner.ts:314/811`). The KCC moves the
    capsule, not `runner.x`; a reconcile that writes only the fields leaves the next `Runner.step` starting from the
    old capsule position.
  - CHANGED(review) — **the local kit is stepped too (MUST, was S2).** Movement depends on kit state: `firing` applies
    `fireMoveMul`, a SHEET-DRUM roll caps the speed (`fireSpeedCap`), and `firing` starts and stops every time the
    player presses or releases FIRE. Without local kit stepping, every fire press or release mispredicts for one RTT:
    e.g. at 6 m/s with a 0.5 firing multiplier and 160 ms RTT that is ≈ 0.5 m, over the 0.35 m budget, many times a
    minute. So after `Runner.step`, the client runs `stepKit(r, intent, dt, …)` for the local runner with a
    **prediction `KitHost`**: `paint` / `paintStrip` register predicted paint (next bullet) and paint nothing,
    `damage` does nothing, `pool` is a discard pool (S1) or the cosmetic pool (S2 visuals), `emit` feeds local events
    (filtered as below), and `physics` / `runners` / `seedWord` are the container world's. Kit-private fields
    (`flickT`, `standT`, `holdT`, `prevFireHeld`, `glintT` …) stay on the client's values and are reset on the host's
    `washed` / `respawn` of the local runner (the host resets them there too, `resetKit`).
  - CHANGED(review) — **predicted own paint (MUST).** `Runner.step` reads the paint under the feet
    (`painter.teamUnder`, `runner.ts:505`) and on walls (`painter.surfaceAt`, `runner.ts:865`): own dye = slick / fast,
    enemy dye = slog. The client's mirror receives the host's paint about one RTT after the host painted it, so the
    local runner would mispredict in the two commonest moves: a SHEET-DRUM rolling over enemy turf (the strip is laid
    `KITS.drumAhead` ahead of the feet: own dye on the host, enemy dye on the client → constant slog misprediction),
    and "shoot ahead, then slick into it" (no own dye yet on the client → no slick). The client therefore steps the
    local runner with a **`PredictPainter` facade**, passed where `Runner.step` takes a `Painter`
    (`as unknown as Painter`; no core edit):
    - it answers `teamUnder` / `surfaceAt` from the mirror, except that a point inside a live predicted own-paint
      shape returns the local runner's team;
    - shapes are registered by the prediction `KitHost`: `paintStrip` → a capsule, the cosmetic pool's local landers →
      a sphere of the landing radius (S1 without visuals still steps the landers in the discard pool for this);
    - a shape lives `PRED_PAINT_TTL_MS` (600 ms) or until the mirror shows the local team at its centre;
    - `splat` / `capsule` on the facade throw (prediction never paints the mirror; the dev brush is offline only);
    - every other method delegates to the mirror.
    If the host disagrees (the droplet hit an enemy, the strip was blocked), reconciliation corrects within one SNAP.
  - Life and death are the host's.
    - While a `SNAP` says the local runner is not alive, prediction is suspended and the pending ring is cleared.
    - It restarts from the first `SNAP` after the host's `respawn` / `spawn` event.
    - Knockback (`knock`), WELLSPRING leaps and court freeze arrive through reconciliation (a short correction), never
      predicted from local guesses.
    - Springs and conveyors are predicted: they are map features inside `Runner.step`.
- **S2 (should):** local firing feedback (visuals only — CHANGED(review): the kit stepping itself moved to S1 above).
  - The prediction `KitHost` spawns into the **cosmetic** pool instead of the discard pool, and its local `shot` /
    `dry` / `tankLow` / `roll` / `flick` / `glint` / `beam` events drive the muzzle FX and audio.
  - The client then **ignores the host's `PSPAWN` and `shot` / `dry` records whose owner is the local runner** (no
    double droplets).
  - Paint, damage and washes still come only from the host.
  - Subs and specials are not predicted. They play on the host's events, one RTT late.
- Gameplay events about the local runner are taken **only from the host**: `hit`, `washed`, `respawn`, `spawn`,
  `special`, `sub`, `score`. Locally predicted `jump` / `land` / `slick` events of the local runner are used for its
  animations and sounds; the host's copies of those three for the local runner are dropped.

### O5.6 Remote interpolation and time
- Snapshots are buffered with their host tick and their arrival time. The host tick is estimated as
  `lastSnapTick + (now − arrival)/TICK`, smoothed with an EWMA of α 0.1.
- Remote runners render at `estimatedHostTick − INTERP_DELAY`:
  - `INTERP_DELAY` is 100 ms by default, clamped 66–150 ms, and set to 1.5× the measured p90 snapshot gap;
  - positions are lerped, angles take the shortest arc, discrete flags follow the newer snapshot.
- With the buffer empty, extrapolate ≤ 100 ms, then hold.
- Records play when their tick reaches the render tick for FX, which keeps FX in step with the interpolated runners.
  Paint ops are applied **on arrival**, in order, for minimum lag. The hash compare uses arrival order and is
  unaffected.

### O5.7 Match result
- The host's `world.result` is authoritative and sent in `end`. Clients show the slate from it, not from their
  container world.
- The view's local-human logic (victory / defeat stinger, "YOU") uses the local runner id, not 0 (§O12.2).

---

## O6 Host migration [design]

### O6.1 Why migration and not a void
- Host loss will be common: phones and laptops background tabs; CONTRACT_MOBILE pauses on hidden / blur / pagehide /
  back. A hidden tab stops `requestAnimationFrame`, which stops the host's sim.
- Every client already has what a restore needs:
  - an exact paint mirror (hash-checked);
  - the last snapshot of all 8 runners;
  - the clock and the scores.
- So migration costs no extra steady-state traffic.
- A void would also waste the ~1,500 quota units an 8-human match already spent.
- "Bots take over" covers non-host leavers only (§O7.3). Only the host runs bots, so a host loss needs a new host.

### O6.2 Triggers (decided by the Room DO)
- **Graceful:** the host page becomes hidden (`visibilitychange`), or the player leaves or quits.
  1. The host flushes a `HANDOFF` frame: the runner state with the extended blocks of all runners and the JSON tail,
     synchronously encoded, with no paint bytes (§O3.2).
  2. Then `{t:"handoff"}`.
  3. The Room picks the next host (§O4.4 score, the old host excluded) and sends `host {reason:'handoff'}`.
  The new host restores from the `HANDOFF` body: more exact than a plain snapshot, and the kit internals are kept.
- **Abrupt:** the host socket closes, or no frame from the host arrives for `HOST_STALL_MS` (1,500 ms) while the
  phase is `live`. The check runs on each incoming client message, so it needs no timer. The Room then sends
  `host {reason:'left'|'stalled', lastTick}` and the new host restores from its last `SNAP` (+ scoreboard).
- A stalled old host that comes back sees `host` naming someone else. It discards its world and re-enters as a client
  through the keyframe path (§O7.2).

### O6.3 The restore (new host)
1. Build a fresh `MatchWorld` (same roster, map, mode, rule and duration, `countdownS: 0`, seed = match seed ^
   (0x9e37 × migrations)). CHANGED(review): build it with `new MatchWorld(...)` directly — **never** through
   `startSession` (`main.ts:473` calls `arena.painter.reset()`) or `Game.restart()` (`game.ts:764` calls
   `p.painter.reset()`), either of which would wipe the court the restore depends on. Release the container world's
   capsules first (`releaseWorld`). The constructor queues events that must not reach the view or stats: with
   `countdownS: 0` it pushes `phase live` + `horn start` (`world.ts` constructor tail), and in FFA one `spawn` per
   runner; drain them into a scratch array and **discard** them before the first step. Then call
   **`world.netRestore(state)`** (§O12.2), which sets:
   - tick, liveTicks / timeLeft, phase, scores, the WASHOUT limit state;
   - per runner: position (teleporting the body), velocity, yaw / aim, MoveState, slickForm, hp, tank, special and
     specialReady, alive with its respawn ticks, protect ticks, spawnSite, the site history, washes, washedCount,
     painted, shots, plus the extended fields when restoring from `HANDOFF`.
   - Projectiles are cleared. Running specials end (meters kept). Kits are reset.
2. Its `Painter` is already the court. Nothing to load.
   - If its `painter.hash()` differs from the `HANDOFF` / last-`SNAP` hash, it continues anyway: its court is the
     truth from now on. Clients whose hash then differs resync from it through the normal path (§O5.3). The case is
     counted in `__NET__.stats()`.
3. `new BotDirector(world, nav, seed ^ migrations)` with `setHuman` for the connected humans.
4. Continue at `lastTick + 1` and send a `SNAP` at once. Clients reset their interpolation buffers on `host`, keep
   their paint, and resend unacked intents to the new host.
5. Visible to players: a "HOST MIGRATING…" banner (LOBBY-UI) for ≤ 1 s (graceful) or ≤ 3 s (abrupt).
6. Cap: `MAX_MIGRATIONS` 3 per match. The 4th host loss ends the match with `end {voided:true}`, no winner and no
   stats. CHANGED(review): the **Room** sends that `end` (§O2.3); a host cannot be relied on to.
7. CHANGED(review) — stats and seats across a migration: it is the same match. SYNC calls the stats `matchBegin` with
   the same `matchId` (a continuation, CONTRACT_STATS §S2.3) and never `matchAbandon`. The new host restores every
   runner's seat totals from the `HANDOFF` / last scoreboard (§O3.2) and keeps accumulating (§O7.5).

---

## O7 Late join, reconnect, leave, idle

### O7.1 Late join (code rooms; quick rooms through late fill)
- Allowed while `live` and `ticksLeft ≥ LATE_JOIN_MIN_LEFT_S × 60`.
- `welcome` shows `phase: live`. The joiner loads the arena, then sends `loaded`.
- The host takes over a bot runner: TEAMS on the side with fewer humans (tie → SUNCREW); FFA the first bot.
  - `setHuman(id, true)`;
  - broadcasts `seat {runner, slot, name, human:true}`, which renames the runner on every client (§O12.2);
  - sends a `KEYFRAME` to the joiner.
- The joiner applies the keyframe:
  - `atlas.team.set(inflate(bytes))`, `painter.recount()`, `paint.rebuildAll()`, `minimap.rebuild()`;
  - all runners from the snapshot and extended blocks;
  - its local runner = the seat.
- It discards buffered `SNAP`s with tick ≤ the keyframe tick and applies the later ones. The host writes the keyframe
  **right after a `SNAP`**, so no record falls between them.

### O7.2 Reconnect
- `welcome.token` (128-bit random) is kept in `sessionStorage` per room code.
- A dropped socket reconnects with `/room/<code>?token=` and gets its old slot back. It is allowed until the match
  ends (code rooms: for the room's lifetime).
- While disconnected, its runner is bot-driven (`peer {conn:false}` → `setHuman(false)`).
- On return: `seat` + `KEYFRAME`, exactly as a late join.
- Backoff: 0.5, 1, 2, 4 s, then "Connection lost — RETRY / LEAVE".

### O7.3 Leaving and bot takeover
- LEAVE (or the tab closed) closes the socket. The Room broadcasts `peer {conn:false}`. The host calls
  `setHuman(id, false)` and broadcasts `seat {human:false}`.
- The runner keeps its name. The online scoreboard tags it BOT. The match continues.
- With **no human left besides the host**, the match continues offline-style: the relay simply has no clients.

### O7.4 Idle kick
- Live: a human whose intents show no meaningful change for `IDLE_KICK_S` (60 s) gets kicked by the host. Meaningful
  means a movement axis, a button, or a yaw change > 0.05 rad.
  - `kick {slot, why:'idle'}` → close 4008 → bot takeover.
  - The kicked client sees "Removed for inactivity".
  - Dev override `?idlekick=<s>` for tests.
- Pre-match: a room socket with no auto-response ping for 2 min is closed by the Room on the next event (a dead
  phone).

### O7.5 Seat totals (CHANGED(review), new — for the stats hand-off)
A runner's `washes` / `washedCount` / `painted` count its whole match, including time a bot drove it (before a late
join, during a disconnect, after a 3 s silence). Stats must credit a player only with what they did. The host keeps,
per runner, the **seat** that holds it now (`seatSlot`, the Room slot) and that seat's totals:
- `seatHuman` true while `setHuman(id, true)`; `seatLiveTicks` += 1 for every live tick stepped while `seatHuman`;
- on bot → human (same slot): remember `base = {washes, washedCount, painted}` of the runner now;
- on human → bot: add `(current − base)` into the seat accumulators;
- a different slot takes the runner (late join of another player after a leave): reset the accumulators to 0;
- seat totals now = accumulators + (`seatHuman` ? current − base : 0).
They travel in the scoreboard (§O3.2, so a new host can restore them) and in `end.runners[].seat` (§O3.3). SYNC builds
CONTRACT_STATS' `OnlineFinal` from `end`: `humans` = runners with `seat?.human === true`; `me` = my runner's `seat`
(null if I hold none).

---

## O8 Anti-abuse and limits (NET-SERVER enforces; the host validates)
- Origin allowlist on every upgrade (§O2.2).
- Size caps per kind (§O3.2): client text ≤ 2 KB, host text ≤ 64 KB. Oversize frames are dropped and counted.
- Rate caps, token buckets per socket:
  - clients 60 frames/s with a burst of 60; the host 150/s with a burst of 150; the Lobby 5 text frames/s.
  - More than 200 drops in 10 s → close 4029.
- Per-IP: ≤ 4 concurrent sockets per Room and ≤ 2 per Lobby (`CF-Connecting-IP`, kept in the attachment).
  - CHANGED(review): now `PER_IP_ROOM` = 8 and `PER_IP_LOBBY` = 4 (vars, §O2.1). With 4 / 2, a household or a school
    LAN behind one public IP could not fill one room, two friends on one mobile-carrier NAT (CGNAT shares an address
    among many strangers) could block each other's quick match, and the local tests (every client is 127.0.0.1) could
    not seat 8. A Room of 8 humans is the room's own limit anyway; the real flood defence is the origin check, the
    rate caps and the meter's admission (§O2.5). Local `.dev.vars` sets both to 0 (off).
- Room membership:
  - ≤ 8 humans;
  - quick rooms require a ticket or a reconnect token;
  - code rooms: the owner can KICK;
  - codes come from a 32⁴ = 1,048,576 space and expire (§O2.3).
- Names: NFC-normalized, control and bidi characters stripped, trimmed, ≤ 16 characters, empty → `GUEST-xxxx`.
  Sanitized again by the host before the roster. No profanity filter in v1 (open question).
- The host clamps every dequantized intent: finite, |move| ≤ 1, pitch inside camera limits, aim point inside map
  bounds + 20 m (else `hasAim = false`).
- **No secrets client-side:** the relay needs no keys; there is nothing to leak.
- Trust model, stated plainly: the host is a player's browser and could cheat (edit its sim). This is acceptable
  for a casual game. The stats lane must treat online results as host-reported (§O11.3).

---

## O9 Budget

### O9.1 Rates and sizes [design + estimate]

| stream | rate | size | notes |
|---|---|---|---|
| `INTENTS` client→host | 20 Hz | 6 + 3×13 = **45 B** | the only per-client upstream |
| `SNAP` host→all | 20 Hz | ~380 B (header + 8 × ~43 B + ackSeqs) + records ≈ **0.9–1.3 KB** | records ≈ 4 paint ops (~85 B each) + 4 shots + 4 `PSPAWN` (37 B) + ~10 small events per 50 ms |
| scoreboard | every 30 ticks | ~90 B | inside a `SNAP` |
| `KEYFRAME` | late join / resync / reconnect | ~30–150 KB deflated (623 KB raw team bytes) | rare |
| control text | events | < 1 KB | |

- Per-client downstream ≈ 20–26 KB/s (≈ 200 kbps), fine on LTE. Host upstream is the same single stream (the DO fans
  out).
- DO egress is not billed.

### O9.2 Per-match billable units (3:00 match, high-rate traffic ≈ 186 s incl. countdown) [estimate]
- `units = ceil(incoming msgs / 20) + connections + RPCs` (§O0.1 billing).

| humans | incoming msgs | units | duration (Room awake ≈ 230 s × 0.125 GB) |
|---|---|---|---|
| 2 (1 client + host) | (20 + 20) × 186 ≈ 7,440 + ~60 control | **≈ 380** | ≈ 29 GB-s |
| 4 | (3×20 + 20) × 186 ≈ 14,880 + ~100 | **≈ 760** | ≈ 29 GB-s |
| 8 | (7×20 + 20) × 186 ≈ 29,760 + ~200 | **≈ 1,510** | ≈ 29 GB-s |

- Lobby: ~5 text messages + 1 connection per player, plus ~1–3 RPCs per group ≈ **2–10 units per match**, and a few
  GB-s only while players wait.
- CHANGED(review) — the per-client view, both directions (8 humans, live): each client sends 20 `INTENTS`/s (45 B +
  WS framing ≈ 1 KB/s) + 0.5 pings/s, and receives 20 `SNAP`/s (≈ 18–26 KB/s) + 0.5 pongs/s. The host sends 20
  `SNAP`/s (same 18–26 KB/s up, once: the DO fans out) and receives 7 × 20 = 140 `INTENTS`/s (≈ 7 KB/s). The DO
  receives 20 × 8 = 160 frames/s + ~4 pings/s and sends 7 × 20 + 140 = 280 frames/s (free). The table's arithmetic
  is correct for 20:1; the review adds the pings (≈ +2.5 %) and the raw counts:

| humans | raw incoming / match (frames + pings + connections + RPCs) | units at 20:1 | matches / day if the Free limit counts 1:1 (100,000) |
|---|---|---|---|
| 2 | ≈ 7,440 + 230 + ~10 ≈ **7,700** | ≈ 394 | ≈ 13 |
| 4 | ≈ 14,880 + 460 + ~15 ≈ **15,400** | ≈ 782 | ≈ 6 |
| 8 | ≈ 29,760 + 920 + ~25 ≈ **30,700** | ≈ 1,559 | ≈ 3 |

(Pings: 0.5/s per socket over ~230 s awake; units = ceil((frames + pings) / 20) + connections + RPCs. The per-day
figures in §O9.3 shift by ≈ 3 %; the admission estimates `est` use this table.)

### O9.3 Daily headroom and the soft cap [design]
- **Cap `DAILY_UNIT_CAP` = 60,000 units/day by default.**
  - If DO requests also counted toward the Workers 100,000/day that `kalshi-proxy` and the CDN use (unconfirmed,
    §O0.1), 60,000 plus the observed peak of 23,177 stays under 100,000. A runaway relay could then never take down
    the trading proxy or the game CDN with Error 1027.
  - Once the dashboard shows DO requests metered separately, raise the cap to **85,000** (an orchestrator config
    change, not code).
- Matches per day under the cap:

| humans | at 60,000 | at 85,000 | duration bound (13,000 GB-s ÷ 29) |
|---|---|---|---|
| 2 | ~157 | ~223 | ~448 |
| 4 | ~78 | ~111 | ~448 |
| 8 | ~39 | ~56 | ~448 |

- **Enforcement:**
  - The Lobby refuses new groups and `/room/new` refuses new rooms once `units ≥ cap`, with `err quota` → the UI
    says "Online is full for today — play vs bots" and offers the offline match.
  - Running matches always finish. The margin to the hard 100,000 is ≥ 15,000 units, about 10 full matches.
  - CHANGED(review): enforcement is now **admission** (`Meter.admit(est)` before every match start, §O2.5): a match
    starts only if its whole estimated usage fits, so running matches finishing can never push the day over the cap.
- The meter is self-counted (exact for our own frames). The orchestrator cross-checks it against the dashboard's DO
  metrics after day 1.

### O9.3a Counting mode (CHANGED(review), new)
The Free daily limit may count WebSocket messages 1:1 instead of 20:1 (§O0.1). The four cases:

| Free DO limit counts messages | DO requests share the Workers 100,000/day pool | what overshooting does |
|---|---|---|
| 20:1 | no | nothing at the planned rates (the design's case) |
| 20:1 | yes | the 60,000-unit cap already protects `kalshi-proxy` and the CDN (§O9.3) |
| 1:1 | no | online stops for the rest of the UTC day (DO calls fail); nothing else is affected |
| 1:1 | yes | **every Worker on the account returns Error 1027 for the rest of the UTC day: the games CDN that serves every game on forgeflowgames.com, and `kalshi-proxy`** |

None of the four costs money on Free. The last one is an outage of the whole site, so the first deploy runs in the
mode that is safe in all four:
- **`COUNT_MODE = "strict"` (default):** admission on `raw` (1:1) against `RAW_CAP` = 55,000/day (55,000 + the
  account's observed peak of 23,177 Worker requests stays under 100,000 with margin). Capacity: about one 8-human
  match plus a few 2-human matches a day, or ~7 two-human matches. Enough to launch, test and play with friends; not
  enough for a busy day.
- **Switch to `"billing20"`** (admission on `units` against `DAILY_UNIT_CAP` 60,000, the design's capacity) once the
  owner confirms the counting. The check costs nothing and risks nothing:
  1. note `/health` (`raw`, `units`);
  2. the orchestrator runs `probe_net.ts --relay wss://dyefield-net.isimcha85.workers.dev --synthetic 20000` (2
     sockets, ≈ 20,000 incoming frames, ≈ 1,000 units);
  3. the owner opens the Cloudflare dashboard (signed in) and reads **today's Durable Objects requests counted
     against the Free plan** (the plan / usage view, not the per-object analytics, which show raw counts by design).
     ≈ 1,000 + earlier usage → 20:1 confirmed → set `COUNT_MODE = "billing20"` (a `wrangler.toml` var + redeploy of
     `dyefield-net` only). ≈ 20,000 → 1:1 → stay `strict`; capacity becomes an owner decision (phase-2 RTC §O15, or
     Workers Paid, which bills 20:1 explicitly — money, so a STOP item).
  If the dashboard shows no DO-vs-Free-limit figure, `strict` stays. A deliberate "overshoot test" (sending > 100,000
  frames to see whether DO calls start failing) is NOT allowed without the owner's explicit OK, because of the last
  row of the table.
- Agents cannot read the plan or the billable usage: the wrangler OAuth token has no billing scope (`subscriptions` →
  403, re-checked in review).

### O9.4 If the account is on Workers Paid
- The same code costs $0 up to 1M DO requests and 400,000 GB-s per month (≈ 32,000 units/day).
- **Set `DAILY_UNIT_CAP = 30000` before deploying on Paid.** Otherwise overage is billed at $0.15/M requests and
  $12.50/M GB-s. That would be money, so it is a STOP item until the plan is confirmed (§O14).

### O9.5 CPU and latency targets
- **DO CPU:** routing a frame is parse-two-bytes + `send` × ≤ 7: tens of µs. An 8-human match ≈ 160 frames/s → well
  under 1 % of one core. Gated by the NET-SERVER load test (8 synthetic clients, p99 relay added latency < 5 ms on
  `wrangler dev`).
- **Host CPU:** the offline sim (1–3.4 ms/tick p99 desktop) + 1 more brain + encoding (< 0.2 ms per `SNAP`) +
  `painter.hash()` every 2 s (≈ 1 ms, one 623k-byte loop). Budget: host extra ≤ 0.5 ms per tick on desktop.
- **Client CPU:** below offline. No bots, no sim step for remote runners, cosmetic projectiles only; paint replay
  costs what the host's paint cost. Budget on the 4× phone profile: client tick ≤ offline tick at 4× (6.7 ms mean).
- **Latency:**

| item | target |
|---|---|
| client ↔ host RTT via the DO, same region | median ≤ 120 ms; playable ≤ 200 ms; > 250 ms shows a HIGH PING badge |
| own movement | 0 frames (predicted) |
| own shot FX | 0 frames (S2) / 1 RTT (S1) |
| own paint landing | ≈ 1 RTT + ≤ 50 ms |
| remote runners | `INTERP_DELAY` 100 ms behind the host |
| host migration hitch | ≤ 1 s graceful / ≤ 3 s abrupt |
| reconnect to a playing state | ≤ 5 s after the socket is back (keyframe) |

---

## O10 Platforms and online-specific behaviour
- **Portal iframe, standalone CDN, phones:** one code path. The relay URL defaults to
  `wss://dyefield-net.isimcha85.workers.dev`. A dev override `?net=ws://127.0.0.1:8787` works on localhost only.
- **Lazy load:** everything under `runtime/src/net/**` loads through a dynamic `import()` when PLAY ONLINE is opened
  (or `?net=` / `?room=` is in the URL). The offline boot path imports no net code, and `bootguard.py` /
  `bootcheck.py` budgets stay as they are.
- **Deep link (SHOULD):** `?room=K7QX` opens JOIN ROOM pre-filled. The "copy invite link" button in the room screen
  uses the current page URL (the CDN URL standalone; inside the portal, the code only).
  - CHANGED(review): inside the portal the link can be a portal link: `GamePlayer.tsx:175` already forwards the
    portal page's `?room=` into the iframe src, so `<portal origin>/games/dyefield?room=K7QX` opens the game in the
    portal (signed in, stats on) straight to JOIN ROOM. The portal origin comes from `location.ancestorOrigins[0]`
    (Chromium / Safari) or the origin of `document.referrer`, accepted only if it is on CONTRACT_STATS §S3.4's
    allowlist; otherwise fall back to the code only. (The `/games/<slug>` path is the portal's game page route,
    `pages/games/@slug`.)
- **No pause online.** `CHANGED(ONLINE)` to CONTRACT_P6_11 / CONTRACT_MOBILE M4:
  - ESC / the touch PAUSE button / blur / hidden / back open the **online menu card** (SETTINGS, HOW TO PLAY, LEAVE
    MATCH) while the match runs on.
  - The local runner gets neutral intents while the card is up, or while the page is hidden or blurred.
  - A hidden **host** hands off (§O6.2).
  - Pointer-lock loss does not pause.
- **Touch:** the existing touch controls and aim assist (aim assist uses `world.canSee`; on clients it runs on the
  container world, so remote positions are interpolated). Phones never host while a desktop is present.
- **PLAY AGAIN / LOBBY on the victory slate:** online replaces them with REMATCH / PLAY AGAIN (§O4.2–O4.3) / LEAVE.

---

## O11 Interfaces between the lanes

### O11.1 `OnlineApi` (SYNC implements in `runtime/src/net/api.ts`; LOBBY-UI imports types only)
```ts
export type OnlineMode = 'teams' | 'ffa';
export type OnlineRule = 'turf' | 'washout';
export interface OnlineProfile { name: string; kit: string; crew: 0 | 1 | 2; ffaColor: number }
export interface RoomMember { slot: number; name: string; kit: string; crew: number; color: number;
  device: 'kbm' | 'touch'; conn: boolean; owner: boolean; host: boolean; rttMs: number | null }
export interface RoomView { code: string; quick: boolean; mode: OnlineMode; rule: OnlineRule;
  map: string /* id | 'random' */; preset: string; skill: 'breeze' | 'swell' | 'storm';
  phase: 'room' | 'loading' | 'live' | 'post'; matchNo: number; members: RoomMember[];
  mySlot: number; ownerSlot: number; hostSlot: number }
export type NetErrorCode = 'room_full' | 'not_found' | 'busy' | 'build' | 'proto' | 'quota' | 'rate' | 'origin'
  | 'bad' | 'network' | 'unsupported' | 'kicked';
export type NetStatus =
  | { kind: 'idle' } | { kind: 'connecting' }
  | { kind: 'queue'; waiting: number; waitedS: number } | { kind: 'solo' }
  | { kind: 'room'; room: RoomView }
  | { kind: 'error'; code: NetErrorCode; msg: string } | { kind: 'closed'; why: string };
export interface OnlineHudState { rttMs: number | null; quality: 'good' | 'ok' | 'bad'; host: boolean;
  hostName: string; migrating: boolean;
  players: Array<{ runner: number; name: string; human: boolean; conn: boolean; rttMs: number | null }> }
export type OnlineEvent =
  | { t: 'joined'; name: string } | { t: 'left'; name: string } | { t: 'botTakeover'; runner: number }
  | { t: 'migrating' } | { t: 'migrated'; hostName: string } | { t: 'kicked'; why: string }
  | { t: 'resynced' } | { t: 'voided'; why: string };
export interface OnlineApi {
  quickMatch(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void;
  createRoom(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void;
  joinRoom(code: string, p: OnlineProfile): void;
  setProfile(p: Partial<OnlineProfile>): void;
  configure(c: Partial<{ mode: OnlineMode; rule: OnlineRule; map: string; preset: string;
    skill: 'breeze' | 'swell' | 'storm' }>): void;          // owner only
  start(): void; kick(slot: number): void; rematch(): void;  // owner / post
  keepWaiting(): void; playBotsInstead(): void; leave(): void;
  status(): NetStatus; onStatus(cb: (s: NetStatus) => void): () => void;
  hud(): OnlineHudState | null; onEvent(cb: (e: OnlineEvent) => void): () => void;
  inviteUrl(): string | null;
}
```
- LOBBY-UI builds and tests its screens against a mock (`runtime/src/net/ui/mock.ts`) until SYNC lands.
  `main.ts` (SYNC) wires the real one.

### O11.2 Menu entry
- LOBBY-UI adds `online?(): void` to `MenuHooks` and the PLAY ONLINE button calling it (menus.ts / menus.css).
- `main.ts` (SYNC) passes `online: () => openOnline()`, which lazy-loads `net/ui` and `net/api` and opens the screens
  over the lobby backdrop. The lobby `Game` keeps running behind them, as behind the menus. Its `simMs` measurement
  feeds `hello`.

### O11.3 Stats lane hook (CONTRACT_STATS, written in parallel)
- On clients, `SimEvent`s come from the record stream. **SYNC must pass the client-side event list to the same
  hooks the offline game calls**, including the stats lane's `simEvents` hook, so stats work online.
- At `end`, SYNC calls the stats lane's match-end hook with `{online: true, humans, mySeatRunner, result, migrations,
  voided}`. A `voided` match reports nothing. Online results are host-reported; treat them as casual stats, not as
  ranked or leaderboard truth.
- CHANGED(review) — the exact seam is CONTRACT_STATS §S9.1 (the line above was the pre-review sketch; where they
  differ, §S9.1 wins):
  - at every online match start: `stats.matchBegin(world, {kit, skill: room.skill, localPid, online: {matchId, localPid,
    role: 'host' | 'client', skill}})`; after a migration, the same call with the same `matchId` (a continuation);
  - at `end`: `stats.onlineEnd('complete', {result: end.result, humans, me})` built from `end.runners[].seat`
    (§O7.5); a Room-originated void: `onlineEnd('void')`; my socket gone at the horn with no reconnect:
    `onlineEnd('dropped')`;
  - never `matchAbandon` for a migration; `matchAbandon('dispose')` when I LEAVE MATCH;
  - `humans` must NOT come from `Runner.bot`: every online roster entry is built `bot: true` (§O4.5 step 2).
  - Online scores DO go to the weekly board, scaled by the room's bot tier (CONTRACT_STATS §S4), at the same trust
    level as every other client-reported FFG score.
- **File coordination:** if the STATS build also edits `game.ts`, `main.ts`, `ui/hud.ts` or `view/players.ts`, the
  orchestrator runs the two builds one after the other on those files, never both at once.
  - CHANGED(review): it does — STATS INTEGRATION edits `game.ts`, `main.ts` and `ui/menus.ts` (CONTRACT_STATS §S10).
    Fixed order: STATS INTEGRATION first (small, gated by G-S3), then SYNC (`game.ts` / `main.ts`) and LOBBY-UI
    (`menus.ts` / `menus.css` / the one `menus.py` line, §O4.1) on top. Everything else (NET-SERVER, SYNC's `net/**`
    core and probes, LOBBY-UI's `net/ui/**` against the mock, the STATS lane's own files) can run in parallel.

---

## O12 Lane split and file ownership (BUILD)

### O12.1 NET-SERVER lane
- **Owns:** `forgeflow-games/workers/dyefield-net/**`: `wrangler.toml`, `package.json` (wrangler as a dev
  dependency, or `npx wrangler`), `tsconfig.json`, `src/index.ts` (routes, origin), `src/room.ts`, `src/lobby.ts`,
  `src/meter.ts`, `src/proto.ts` (the kinds, caps, close codes and constants of §O3 / §O16, mirrored from this
  contract), `test/*.mjs` (Node 22's global `WebSocket` against `wrangler dev`), `README.md`.
- **Deliver:** §O2, §O3 routing, §O4.4 host pick, §O6.2 detection, §O7.2 tokens, §O7.4 pre-match idle, §O8, §O9.3
  meter.
- **Tests** (all against `npx wrangler dev --local` on 127.0.0.1:8787):

| test | covers |
|---|---|
| T1 | create / join / code collision retry / 9th = `room_full` / bad code = 4004 |
| T2 | quick match per mode × rule (separate queues), fill-wait timing, `solo` at 45 s (test override `QM_*` vars), ticket enforcement |
| T3 | routing: client→host only, host→all, host→one, spoofed slot byte dropped, non-host `SNAP` dropped, order kept |
| T4 | size and rate caps, 4029 close, origin 403, bad query 400 |
| T5 | host loss: socket close and 1.5 s stall → `host` promotion by score; `handoff` path; a phone never picked over a kbm member. CHANGED(review): `host.lastTick` = the tick of the last relayed `SNAP`; the 4th host loss → the Room's own `end {voided:true}`; a token reconnect during `post` receives the cached `end` |
| T6 | reconnect with token gets the same slot; a wrong token is a new member |
| T7 | pre-match idle close; owner `kick` → 4008 |
| T8 | meter: counted units match the frames sent (± connections), cap → `err quota` for new rooms/groups, running rooms unaffected. CHANGED(review): both counts (`raw`, `units`); admission refuses a start whose estimate does not fit and a burst of N simultaneous starts never ends the day above the cap; `strict` vs `billing20` pick the right cap; ≤ 20 storage row writes per Room per match |
| T9 | load: 8 synthetic clients + host at full rates for 60 s: relay added latency p50/p99, frames/s, units counted |
| T10 | hibernation: idle Lobby/Room state is rebuilt from attachments after a forced eviction (wrangler dev restart of the DO) |

- **Deploy** (only in the stage the orchestrator names, and only after T1–T10 pass):
  1. `npx wrangler deploy --dry-run` (bundle OK).
  2. `npx wrangler deploy` with `CLOUDFLARE_API_TOKEN` unset (OAuth).
  3. STOP on any plan or billing error (§O14).
  4. Verify: `curl https://dyefield-net.isimcha85.workers.dev/health` → `ok:true`; a 2-client synthetic run against
     production (≤ 2,000 frames ≈ 100 units); `/health` units increased by that amount.
  5. CHANGED(review): deploy with `COUNT_MODE = "strict"` (§O9.3a). Then an 8-socket synthetic match against
     production (`probe_net.ts --relay wss://… --clients 8 --seconds 60`: host + 7 clients from Node, real rates;
     ≈ 9,800 raw frames ≈ 500 units): every client receives every `SNAP` in order, relay-added RTT p50 / p99 over the
     real edge recorded, `/health` `raw` / `units` rose by the counted amounts (± connections). This proves the
     production relay carries 8 humans; the browser proof is §O13.3 B.
  6. CHANGED(review): the counting check of §O9.3a step 2 can run right after (it needs the owner for step 3).

### O12.2 SYNC lane (the only online lane allowed to edit `game.ts` and `main.ts`)
- **Owns:** `runtime/src/net/**` except `runtime/src/net/ui/**`:
  - `proto.ts` (codecs + O3.2a table);
  - `transport.ts` (WS + reconnect + RTT pings);
  - `host.ts`, `client.ts`, `records.ts`, `predict.ts`, `interp.ts`, `migrate.ts`, `roster.ts`;
  - `api.ts` (`OnlineApi`), `loopback.ts` (in-memory relay for Node probes);
  - `testsurface` additions as `window.__NET__`.
- Also edits `game.ts` and `main.ts`.
- The host / client sync core is **THREE-free**, so Node probes can run it.
- **Allowed additive edits outside `net/`**, each never called offline and each gated by identical probe hashes:
  - `core/match/world.ts`: `netRestore(state)` and `netState(out)` (read/write the private clock, score, respawn,
    protect, site-history and killer fields).
  - `core/runner.ts`: `netState(out)` / `netLoad(s)` covering every mutable field `step` and `stepKit` read, the
    private ones included. CHANGED(review): `netLoad` also moves the capsule (`body.setFeet`) and sets its shape for
    the loaded tall / slick state (§O5.5).
  - CHANGED(review): the seat totals of §O7.5 are host-side net state kept in `net/host.ts`, not sim state.
    `netRestore` stays sim-only and no further core edit is needed for them.
  - `core/bots/director.ts`: `setHuman(id, on)`. It skips a runner's brain while `on`. On release it re-arms the brain
    with a fresh decide on the next think.
  - `view/players.ts` + `ui/hud.ts`: `rename(id, name)` for name tags and crests.
  - In `game.ts` / `main.ts`: replace the hard-wired `HUMAN = 0` / `youId: 0` with the session's local runner id.
    Offline it stays 0, so behaviour and hashes are unchanged.
- **Deliver:** §O4.5 steps 2–6, §O5, §O6.3, §O7.1–O7.4 (host side), §O10 game-side behaviour, `__NET__` read-backs
  (status, stats: desyncs, keyframes, migrations, prediction error p50/p95, RTT, units sent), and dev params:
  - `?net=` relay URL;
  - `?netlag=<ms>` (artificial one-way delay in the client transport);
  - `?renderfps=<n>` (render throttle for multi-client tests; sim and net unaffected);
  - `?idlekick=<s>`;
  - CHANGED(review) `?autopilot=<seed>`: the local runner's intents come from a scripted driver instead of the input
    devices (seeded; walk toward a random reachable point of the container world's nav graph, turn, fire most of the
    time, jump / slick / throw a sub every few seconds, roll for SHEET-DRUM). They are real intents: quantized, sent,
    predicted and reconciled like a player's. Without it, the 6–7 undriven browser clients of scenario B would be
    idle-kicked after 60 s (§O7.4) and the test would not be an 8-human match;
  - CHANGED(review) `?netdur=<s>`: sent as `cfg.durationS`, honoured only by a `DEV` relay (§O3.3).
  - All of these are honoured only with `?dev=1` (as `?matchSeconds` is offline, `main.ts devSeconds()`).
- **Probes and harness** (SYNC owns these new files):
  - `_harness/probe_net.ts`: Node, `loopback.ts`, host + 7 clients, all modes × rules on one map plus all maps in
    TEAMS TURF. It asserts:
    - the host world hash equals the offline hash for the same seed and intents (the wrapper changes nothing);
    - every client's painter hash equals the host's at every `HASH_EVERY` and at the end;
    - 0 desyncs;
    - prediction error p95 < 0.05 m at 0 lag and < 0.35 m at `netlag` 80 ms;
    - CHANGED(review): the prediction numbers are measured per kit and in three scripted stress patterns as well as
      bot-driven play — (a) SHEET-DRUM rolling across enemy turf, (b) MIST-RASP firing 0.5 s ahead then slicking into
      the fresh dye, (c) FIRE toggled every 0.4 s while running — each must meet the same p95 at 80 ms;
    - CHANGED(review): seat totals — a late joiner's and a reconnecting client's `end.runners[].seat` equal the
      runner's counter increase over the human-driven intervals only (checked against the host's per-tick log); after
      a migration they continue from the scoreboard values;
    - CHANGED(review): the new host after a migration never calls `painter.reset` (the painter hash right after
      restore equals the last `SNAP` hash) and no constructor `phase` / `horn` / `spawn` event reaches the view;
    - migration mid-match (graceful and abrupt) completes the match with a result;
    - a late join and a reconnect end with an equal painter hash;
    - bot takeover after 3 s of silence;
    - units-per-match within ±10 % of §O9.2.
  - `probe_net.ts --relay ws://127.0.0.1:8787`: the same scenarios over `wrangler dev`.
  - CHANGED(review) relay-only modes (no sim; Node 22 `WebSocket`; send the `Origin` header of the CDN for production):
    `--relay <url> --clients <n> --seconds <s>` (a host socket sending 20 Hz `SNAP`-shaped frames + n−1 client
    sockets at 20 Hz `INTENTS`; asserts order and completeness, reports relay RTT p50 / p99 and the `/health` delta),
    and `--relay <url> --synthetic <frames>` (2 sockets, exactly that many incoming frames, for §O9.3a). Both refuse
    to run against production when `/health` says `open: false` or when the run's estimate does not fit today's
    remaining cap.
  - `_harness/netplay.py`: browser scenarios A–G of §O13.3.

### O12.3 LOBBY-UI lane
- **Owns:** `runtime/src/net/ui/**`:
  - `screens.ts`: PLAY ONLINE root, searching, solo prompt, room screen, join-code entry, errors / quota / unsupported
    / build cards;
  - `onlinehud.ts`: ping badge, HOST badge, HOST MIGRATING banner, joined / left / bot-takeover toasts, a hold-TAB
    scoreboard with humans / bots / pings, the online menu card, REMATCH / PLAY AGAIN / LEAVE controls for the
    victory slate as a standalone overlay;
  - `ui.css`, `mock.ts`.
- **May edit only** `ui/menus.ts` (the PLAY ONLINE button and the `online?()` hook) and `ui/menus.css`.
  CHANGED(review): plus the single expected-labels line of `_harness/menus.py` (§O4.1), and only after STATS
  INTEGRATION's `menus.ts` edit has landed (§O11.3).
- **Must keep:**
  - the menus' focus / gamepad / keyboard navigation model;
  - CONTRACT_MOBILE M0 viewports (the title stack with 6 items must fit 667×375 landscape without page scroll);
  - touch targets ≥ 44 px;
  - REDUCE MOTION and COLORBLIND respected.
- **Gates:** `menus.py`, `layoutcheck.py`, `mobile.py` (layout sections), `padcheck.py`, plus its own
  `_harness/netlobby.py`: every screen in the mock states, desktop + phone viewports, screenshots in `_shots/online/`.

---

## O13 Local test setup and test plan

### O13.1 Local stack
1. `cd forgeflow-games/workers/dyefield-net && npx wrangler dev --local --port 8787`. DOs run locally in workerd;
   `.dev.vars` holds `DEV_ORIGINS` and a low cap for T8.
2. The game: `npm run dev` (vite) in `games/dyefield`, or `npm run build && npm run preview` for the dist check.
3. Clients open `http://127.0.0.1:<port>/?net=ws://127.0.0.1:8787`.

All browser runs are **headless**. The box is shared and often at 100 % CPU: a wall-clock failure is confirmed by a
rerun or by tick-rate evidence (`__NET__.stats().hostTps`) before it counts.

### O13.2 Node first
`probe_net.ts` with the loopback relay proves the sync logic deterministically, with no GPU and no network. Then over
`wrangler dev`.

### O13.3 Browser scenarios (`_harness/netplay.py`)
- One Playwright process, one headless Chromium, N contexts. Desktop contexts use `?renderfps=5` except the observed
  one.
- The **phone** context: iPhone 14 device descriptor (`hasTouch`, `isMobile`, 844×390 landscape) + CDP
  `Emulation.setCPUThrottlingRate {rate: 4}`.

| scenario | what | pass |
|---|---|---|
| A | 2 desktop clients, CREATE / JOIN, TEAMS TURF, `?matchSeconds=60` (dev) | both seated; host = the creator or the better score; equal `end.result` (winner, shares to 1e-9); equal final painter hash; 0 desyncs; prediction p95 < 0.1 m; repeat with `?netlag=80`: p95 < 0.35 m, no rubber-band > 2 m. CHANGED(review): the duration comes from `?netdur=60` (a `DEV` relay); `?matchSeconds` only shapes offline deep links. Both clients `?dev=1&autopilot=<n>`, one run per kit for the client (SHEET-DRUM and MIST-RASP are the prediction stress cases, §O5.5) |
| B | 7 desktop + 1 phone, FFA WASHOUT; the 8th joins late at 30 s | host is a desktop; the phone plays (touch overlay visible, its runner moves via injected touch); late joiner's hash equals the host's. CHANGED(review) — what makes it an 8-human proof: every desktop context runs `?dev=1&autopilot=<n>`, the room `?netdur=150`; pass also requires (1) the host's `__NET__.stats()` shows 8 seated humans for ≥ 60 s at once, each remote human's `INTENTS` arriving at ≥ 15 Hz over the live window (median), (2) every human runner moved ≥ 30 m and painted > 0 m², (3) all 8 clients report the same final painter hash and the same `end.result`, 0 unrecovered desyncs, (4) the host held ≥ 55 sim ticks/s median (else the run is re-run before judging — the box is shared), (5) the relay's counted `raw` for the room within ± 10 % of §O9.2's 8-human row scaled to 150 s |
| B2 | in B: close the host page at 40 s | `host` promotion ≤ 3 s; match completes; survivors' results equal; `migrations: 1` |
| B3 | in B: `__NET__.dropSocket()` on one client | reconnect ≤ 5 s, same seat, equal hash |
| C | 3 clients QUICK MATCH TEAMS TURF, 1 QUICK MATCH FFA TURF | the 3 share a room after the fill wait, the FFA one stays queued (`solo` at the override time); roster = 3 humans + 5 bots |
| D | `?idlekick=10`, one client stops input | kicked (4008), runner → bot, "Removed for inactivity" shown |
| E | an origin not in the allowlist | rejected (also in NET-SERVER T4) |
| F | `.dev.vars` cap = 50 | new room refused with the quota card; offline fallback starts a bot match |
| G | a local page iframing the game with the portal's exact `sandbox` / `allow` attributes (GamePlayer.tsx:177–178) | QUICK MATCH works from inside the iframe; pointer lock unaffected |
| H | graceful handoff: the host page `visibilitychange` → hidden (CDP `Page.setWebLifecycleState frozen` or `document.dispatchEvent` + a `__NET__.forceHandoff()` hook) | migration ≤ 1 s; old host returns as a client via a keyframe |
| I | CHANGED(review) stats hand-off: 3 desktop clients `?dev=1&statsdev=1&autopilot=<n>`, CODE room, `?netdur=90`; the 3rd joins at 25 s; at 40 s the host page closes | every client's `__DF_STATS__.state().lastRecord` is `online: true` with `humans` from `end` (not from `Runner.bot`); the late joiner's `liveS` ≈ its seated time and its `paintedM2` excludes the bot's earlier paint; the migration produced no `abandoned` and no second record; the closed host's record is `abandoned` |

### O13.4 Gates that must stay green (desktop + mobile)
- `npm run typecheck`
- `npm run probe` and `npm run probe:washout`: **hashes identical** to the baseline recorded before the first edit.
- `bootcheck.py` (teams and FFA), the playtests, `menus.py`, `padcheck.py`, `bootguard.py`, `layoutcheck.py`,
  `mobile.py`.
- New: `probe_net.ts`, `netplay.py`, `netlobby.py`, NET-SERVER T1–T10.

---

## O14 Money gate and STOP list
- **$0 as designed:**
  - Workers Free + SQLite Durable Objects + WebSocket hibernation + public workers.dev URL;
  - no TURN, no paid plan, no Supabase Realtime;
  - no database writes from the online layer (stats are the stats lane's).
- **STOP and report (no workaround) if any of these happen:**
  1. `wrangler deploy` reports that Durable Objects need a paid plan, or asks for billing / a subscription.
  2. The account turns out to be on Workers Paid and `DAILY_UNIT_CAP` is not yet lowered to ≤ 30,000 (§O9.4).
  3. Any design change wants TURN, Cloudflare Realtime/Calls, a paid Supabase tier, a custom domain or zone on a paid
     plan, or Cloudflare WAF rate-limiting products beyond the free tier.
  4. The meter reaches 80 % of the cap on two consecutive days. That is a capacity decision for the owner: phase-2
     RTC, raising the cap after confirming separate counters, or Paid.
- Known residual risk, not money on Free: a scripted flood of upgrade requests could spend the Worker / DO daily
  quota. That would be an online-play outage, not a bill, and the origin check plus per-IP caps blunt it. On Paid it
  could become cents to dollars of overage. Covered by STOP 2.
- CHANGED(review) — not money, but an owner check before full capacity: the Free limit's message counting is
  undocumented (§O0.1). The first deploy runs `COUNT_MODE = "strict"` (safe in every case, about one 8-human match a
  day); the switch to the design capacity waits for the owner's dashboard reading (§O9.3a). If the counting turns out
  to be 1:1, the options are phase-2 RTC (no money; shows players' IPs to the host) or Workers Paid (money → STOP).
- CHANGED(review) — sharing: a concurrent session's BLOCKTOOTH netcode spec plans to "share" this relay if it lands at
  $0 (`games/blocktooth/_spec/online/netcode.md:194`). Every game on `dyefield-net` would draw on the same daily DO
  quota and the same meter cap; that is an owner decision, and a second game must get its own `Lobby` / `Room` name
  prefix and its own share of the cap before it connects. Not part of this build.

---

## O15 Phase 2 (not in this BUILD; specified so the format already fits)
- **RTC overlay:** host ↔ client WebRTC DataChannels (unordered, no retransmits for `SNAP` / `INTENTS`), adapted
  from `hit-parade/runtime/src/net/transport_rtc.ts`. Public STUN only (Google ×2 + Cloudflare), **no TURN**.
  Signalling goes through Room text messages. The same binary frames run over it, and the DO path is the fallback for
  pairs that do not connect.
  - It would move most steady traffic off the DO: about 4–5× more matches per day.
  - It exposes player IPs to the host, so it is an owner decision.
- **Server-authoritative DO host:** the DO speaks the host role of this protocol. It needs a workerd-compatible Rapier
  (`.wasm` module import), the map / atlas / nav build in workerd, and memory under 128 MB.
- **NEEDLE-GLINT lag compensation:** host-side rewind of runner positions (a 250 ms ring) for the hitscan beam only.
- **Predicted subs and specials.**

---

## O16 Constants (single table; `src/proto.ts` and `runtime/src/net/proto.ts` mirror it)

| name | value | used by |
|---|---|---|
| `PROTO` | 1 | all |
| `SNAP_EVERY` | 3 ticks (20 Hz) | host |
| `INTENT_TICKS_PER_FRAME` | 3 (max 6 after a hitch) | client |
| `HASH_EVERY` | 120 ticks | host |
| `SCOREBOARD_EVERY` | 30 ticks | host |
| `INTERP_DELAY_MS` | 100 (66–150 adaptive) | client |
| `INTENT_QUEUE_TARGET` / `_MAX` | 2 / 6 | host |
| `INTENT_SILENT_NEUTRAL_MS` | 250 | host |
| `INTENT_SILENT_BOT_S` | 3 | host |
| `HOST_STALL_MS` | 1500 | Room |
| `MAX_MIGRATIONS` | 3 | host |
| `KEYFRAME_MIN_INTERVAL_S` | 10 per client | host |
| `LOAD_TIMEOUT_S` | 25 | host |
| `LATE_JOIN_MIN_LEFT_S` | 45 | host, Lobby |
| `IDLE_KICK_S` | 60 | host |
| `PREMATCH_PING_IDLE_S` | 120 | Room |
| `ROOM_IDLE_CLOSE_MIN` | 15 | Room |
| `ROOM_RECLAIM_MIN` | 30 | Room `claim` |
| `QM_FILL_WAIT_S` / `QM_MAX_WAIT_S` / `QM_SOLO_WAIT_S` | 10 / 20 / 45 | Lobby |
| `QM_AUTOSTART_S` | 8 | Room (quick) |
| `REMATCH_WINDOW_S` | 20 | Room (quick) |
| `RATE_CLIENT` / `RATE_HOST` / `RATE_LOBBY` | 60 / 150 / 5 frames/s | DO |
| `MAX_HUMANS` | 8 | Room |
| `CODE_ALPHABET` | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, length 4 | Worker, UI |
| `DAILY_UNIT_CAP` | 60000 (85000 once counters are confirmed separate; ≤ 30000 on Paid) | Meter |
| `COUNT_MODE` | CHANGED(review) `strict` until the §O9.3a check, then `billing20` | Meter |
| `RAW_CAP` | CHANGED(review) 55000 (1:1 count; enforced in `strict` only) | Meter |
| `PER_IP_ROOM` / `PER_IP_LOBBY` | CHANGED(review) 8 / 4 (0 = off; 0 in `.dev.vars`) | Worker, DO |
| `PRED_PAINT_TTL_MS` | CHANGED(review) 600 | client |
| `PING_LIVE_S` / `PING_IDLE_S` | CHANGED(review) 2 / 10 | client |
| close codes | 4000 / 4004 / 4008 / 4009 / 4026 / 4029 / 4030 / 4031 | DO, client |
