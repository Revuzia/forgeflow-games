# dyefield-net — DYEFIELD real-time relay

Cloudflare Worker + three SQLite-backed Durable Objects (WebSocket Hibernation API), built to
`games/dyefield/_spec/CONTRACT_ONLINE.md` (§O2, §O3 routing, §O4.4, §O6.2, §O7.2, §O7.4, §O8, §O9.3). $0 on Workers Free.
DYEFIELD's real-time traffic never touches Supabase Realtime.

| file | what |
|---|---|
| `src/index.ts` | the stateless Worker: `/health`, `/qm`, `/room/new`, `/room/<CODE>`; origin check first (403), query validation (400), location hints |
| `src/room.ts` | `Room` DO, one per 4-character code: dumb validating relay, host pick, host-loss detection, void on the 4th loss, cached `end`, usage meter, admission |
| `src/lobby.ts` | `Lobby` DO, one per `qm:<mode>:<rule>:<build>`: quick-match grouping, `solo`, late fill |
| `src/meter.ts` | `Meter` DO (`idFromName("meter")`): daily usage in both counts, admission/reservations |
| `src/proto.ts` | kinds, caps, close codes, §O16 constants, validators, the admission estimate |
| `test/*.mjs` | T1–T10 against `wrangler dev` (`npm test`); `relay_probe.mjs` = load / synthetic CLI, also for production |

## Run locally

```
cd forgeflow-games/workers/dyefield-net
npm run dev            # wrangler dev --local --port 8790 (reads .dev.vars: DEV=1, localhost origins, per-IP caps off)
npm run typecheck      # wrangler types + tsc
npm test               # all suites (each starts its own wrangler dev on 127.0.0.1:8790 with a fresh state dir)
node test/run_all.mjs t3 t5     # some suites; report → test/_reports/net_server.json
```
Unset `CLOUDFLARE_API_TOKEN` in the shell first (the stored token is R2-only; wrangler then uses OAuth).
Test-only overrides go on the command line, never into `wrangler.toml`: `npx wrangler dev --local --port 8787 --var RAW_CAP:50`
(`--var` beats `.dev.vars`; verified). Every §O16 timing constant can be overridden this way (see `DEFAULTS` in `src/proto.ts`).

## Routes

| route | |
|---|---|
| `GET /health` | `{ok, proto, version, day, mode, units, raw, reservedUnits, reservedRaw, capUnits, capRaw, used, reserved, cap, open, writes}` — `used/reserved/cap` are the active mode's. CORS `*`. Cached per isolate `HEALTH_CACHE_MS` (2 s). |
| `WS /qm?mode=&rule=&build=` | → Lobby |
| `WS /room/new?mode=&rule=&build=` | meter check (cached 30 s) → claim a random code (≤ 3 tries) → Room, as its owner |
| `WS /room/<CODE>?build=&token=&ticket=` | join / reconnect (`token`) / quick-match entry (`ticket`) |

`mode ∈ teams|ffa`, `rule ∈ turf|washout`, code = 4 chars of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (case-folded).
`build` must match `^[A-Za-z0-9._:+-]{1,40}$` — **send it with `encodeURIComponent`** (`+` → `%2B`; an un-encoded `+`
that arrives as a space is mapped back, but do not rely on it). This is a superset of §O2.2's `^[a-z0-9.:-]{1,40}$`,
which cannot hold §O3's own `NET_BUILD` (`dyefield-1.4.0+p1+<Vite hash>`; Vite hashes use `A–Z a–z 0–9 _ -`).

Allowed origins: `wrangler.toml` `ALLOWED_ORIGINS` (exact). Local: `.dev.vars` `DEV_ORIGINS` = scheme+host entries that
match any port (`http://localhost`, `http://127.0.0.1`; `http://localhost.evil.com` does not match).

## Protocol as implemented (for the SYNC and LOBBY-UI lanes)

Everything in §O3 holds. Additions and exact behaviours the client must know:

**Room → client text**
- `welcome {slot, jid, token, room:{code, quick, mode, rule, map, preset, skill, phase, ownerSlot, hostSlot, matchNo, durationS}}`
  — the reply to `hello`. `jid` = join number, unique per room: a reconnect keeps it; a new player who got a freed slot
  number gets a new one. `room.hostSlot` is −1 outside `loading`/`live`.
- A socket that says `hello` while the room is `loading`/`live` (late join or reconnect) gets the running match's
  `assign` right after `welcome`. During `post`, a token reconnect gets the cached `end` text right after `welcome`
  (the identical string the host sent; also after a hibernation — it is stored with the `post` write).
- `assign {matchNo, hostSlot, seed, map (resolved), preset, mode, rule, skill, durationS, humans:[slot…]}` —
  `durationS` is `null` (= 180) except in DEV.
- `members {members:[{slot, jid, name, kit, crew, color, device, conn, owner, host, rttMs}], phase, room}` — only
  members who said `hello`; disconnected-but-seated members appear with `conn:false`.
- `peer {slot, jid, conn, left?, rejoin?, from:-1}` — `conn:false, left:false` = dropped, reconnectable (bot drives the
  runner); `conn:false, left:true` = gone for good (`leave`, close 4000, kick, refused hello): the seat is free and
  its seat totals end (§O7.5 "its player LEFT"); `conn:true, rejoin:true` = same player back (same `jid`).
- `host {hostSlot, reason:'left'|'stalled'|'handoff', lastTick, matchNo, migrations, from:-1}` — `lastTick` = tick
  (bytes 2–5) of the last SNAP the Room relayed (for `handoff`: the HANDOFF frame's tick). `migrations` = host losses
  so far in this match.
- `end {matchNo, voided:true, why:'host_lost'|'no_host', from:-1}` — Room-originated void (4th host loss, or no
  connected human left who can host). Host-sent `end` is relayed with `from` = host slot.
- `kicked {why:'idle'|'owner'}` precedes close 4008.
- Quick rooms: `solo` + close 4000 `requeue` when fewer than 2 matched players said `hello` within `QM_AUTOSTART_S`
  (8 s); `rematch {votes:[slot…]}` while REMATCH votes come in; `requeue` + close 4000 to a lone REMATCH presser when
  the 20 s window ends (and to non-voters when ≥ 2 voters restart). The client re-queues through `/qm`.
- `err {code, msg}` codes as §O3.3; `busy` closes with **1013** (standard "try again later"; §O3.3 lists no code).
  A per-address refusal is `err rate` + 4029.

**Client → Room**
- `set` is accepted in every phase for `rttMs`/`simMs` (they feed the host pick at a migration); `name`, `kit`,
  `crew`, `color`, `device` only in `room`/`post`.
- `start` / `cfg` are owner-only and code-room-only (quick rooms have no owner: `ownerSlot −1`). PLAY AGAIN = the
  owner's `rematch` in `post` → phase `room` (then `start`); `start` directly from `post` also works.
- `cfg.durationS` (10–180) only when the Worker runs with `DEV = "1"`.

**Lobby**: `qm` (proto + build must equal the lobby's) → `queue {waiting, waitedS}` on change → `matched {code,
ticket}` then close 4000 `matched`. `solo` once after `QM_SOLO_WAIT_S` alone; sending `qm` again (KEEP WAITING) re-arms
it. `leave` → close 4000.

**Relay rules** (the DO reads bytes 0–1, the length, and the u32 tick at 2–5 of SNAP/HANDOFF only)
- `INTENTS` → the host socket only; byte 1 must equal the sender's slot. Silently discarded (not counted as abuse)
  outside `loading`/`live` or while no host is connected.
- `SNAP` / `KEYFRAME` / `HANDOFF` only from the host. The first SNAP of a match moves the Room `loading → live`.
- `KEYFRAME` relay floor: 1 per second per target (the host's own rule is 10 s).
- `HANDOFF` is relayed to everyone, then the Room migrates at once (reason `handoff`); a `{t:"handoff"}` text is
  accepted before or after it.
- **Liveness**: while `live`, any frame from the host refreshes it; 1.5 s without one (checked on every incoming
  client message) → `stalled` migration. The host must therefore send SNAPs continuously from the countdown on. While
  `loading` (roster sent, arenas loading, no SNAP yet) the limit is 30 s. A freshly promoted host gets 1.5 s extra
  until its first frame.
- **Host pick** (§O4.4 score, ties → lowest slot). At a migration, candidates must also look alive (a frame in the
  last 3 s) and not be a former host of this match that stalled or handed off; if nobody qualifies, anyone connected.
- Caps: client text 2 KB, host text 64 KB, INTENTS 512 B, SNAP 64 KB, KEYFRAME 2 MB, HANDOFF 64 KB. Rate buckets:
  client 60/s burst 60, host 150/s burst 150, lobby 5/s. More than 200 counted drops in 10 s → `err rate` + 4029
  (the member stays reconnectable). Counted drops = oversize, over-rate, spoofed slot, wrong sender, bad JSON,
  unknown kind / `t`.
- Seats: slots 0–7, lowest free first. Outside a match, a dropped member keeps its seat `RECONNECT_GRACE_S` (60 s);
  inside a match, until the match ends. When the last socket closes the room goes `closed`, but a token reconnect
  within 60 s revives it in its previous phase (a relay restart drops every socket at once).
- Pre-match idle: in `room`/`post`, a socket with no `"p"` ping and no message for 120 s is closed 4008 on the next
  event. A code room with no START for 15 min closes 4031. No alarms: all checks run on the next event.

## Meter (§O2.5, §O9.3, §O9.3a)

- Every request is counted once, by the DO that receives it: connections (each upgrade fetch), every incoming frame,
  RPCs served (`claim`, `reserve`, `roomOpen`, every Meter call). `raw` counts 1:1; `units` counts frames at 1/20.
  Auto-responded pings (`"p"`) never reach the Room, so it adds the §O5.2 estimate (0.5/s per socket live, 0.1/s
  otherwise) at each flush.
- Flushes: every 60 s while live (piggy-backed on traffic), at `post`, when the last socket closes; the Lobby at each
  group launch and when it empties.
- **Admission**: every START / rematch / late fill calls `Meter.admit(est)`; `est` for n humans and d seconds =
  frames 20·n·(d+6) + pings 0.5·n·(d+50) + (5+2.5·n) → 2 humans 7,680 raw / 394 units, 8 humans 30,705 / 1,559
  (§O9.2 table). It succeeds only if used + reserved + est ≤ cap for the active mode. A refused admission sends
  `err quota` + close 4030 to every member. Live flushes release the same amount of reservation; `post`/close
  releases the rest. A reservation left by a dead Room expires with its UTC day.
- `COUNT_MODE = "strict"` (deployed default): cap `RAW_CAP` 55,000 on `raw`. `"billing20"`: cap `DAILY_UNIT_CAP`
  60,000 on `units`. Switching is a `wrangler.toml` var change + redeploy of this worker only, after the owner's
  dashboard reading (§O9.3a). On Workers Paid set `DAILY_UNIT_CAP` ≤ 30,000 first (§O9.4 — a STOP item).
- `/room/new` and Lobby launches also refuse when the (cached) status says `open:false`.

## Storage cost

The Room writes its single storage row only on transitions: claim, START, first SNAP (live), host change, `post`
(with the `end` text), close, late-fill reserve. Everything else (cfg, joins, owner changes, disconnects) is
mirrored into every connected socket's attachment (free, survives hibernation). Measured: 3–4 rows for a 2-human
match, 11 for an 8-human match (gate ≤ 20). The Meter writes ≤ 2 rows per call, ≈ 4 calls per match.

## Deploy (only in the stage the orchestrator names; §O12.1)

```
unset CLOUDFLARE_API_TOKEN
npx wrangler deploy --dry-run --outdir .wrangler/dry     # bundle OK
npx wrangler deploy                                      # STOP on any plan / billing / subscription prompt (§O14)
curl https://dyefield-net.isimcha85.workers.dev/health   # ok:true, mode strict
node test/relay_probe.mjs --relay wss://dyefield-net.isimcha85.workers.dev --origin https://forgeflowgames.com --clients 2 --seconds 30
node test/relay_probe.mjs --relay wss://dyefield-net.isimcha85.workers.dev --origin https://forgeflowgames.com --clients 8 --seconds 60
node test/relay_probe.mjs --relay wss://dyefield-net.isimcha85.workers.dev --origin https://forgeflowgames.com --synthetic 20000   # §O9.3a step 2
```
`relay_probe.mjs` refuses to run against production when `/health` says `open:false` or the run's estimate does not
fit today's remaining cap. Its JSON shows completeness/order, relay latency p50/p90/p99 and the `/health` deltas.
Each production 8-human probe reserves the full 3:00 estimate (30,705 raw in strict mode) until it ends.

## DEV-only hooks (inactive unless `DEV = "1"`, i.e. local `.dev.vars`)

`/__dev/env`, `/__dev/meter`, `/__dev/meter/set?raw=&units=&reservedRaw=&reservedUnits=`, `/__dev/room/<CODE>`
(state, row-write counts, relay stats, instance id), `/__dev/lobby?mode=&rule=&build=`; query params `devcode=`
(codes for `/room/new`, to force collisions), `devip=` (stands in for `CF-Connecting-IP`, which is empty locally),
`devcont=` (continent); the `dbg` text message; `cfg.durationS`; var `DEV_QUICK_DURATION_S` (quick-room length).

## Known limits

- Hibernation was proven with real local evictions (workerd evicts a DO ~10 s after its last event). `ctx.abort()`
  is not usable as a stand-in: it also drops hibernatable sockets (measured 1006).
- The Lobby's late-fill list (open seats reported by live quick rooms) is memory-only: lost if the Lobby hibernates
  (late fill is a SHOULD; matching falls back to a new group).
- Same-continent grouping is observable only at the 8-player cap: the group widens to everyone at `QM_FILL_WAIT_S`,
  which is never later than a 2–7 player group's own launch time.
- Ping counts are estimates (the Room cannot see auto-responses).
