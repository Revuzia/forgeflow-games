# last-circle-net — Last Circle friends-room relay

Cloudflare Worker + two SQLite-backed Durable Objects (WebSocket Hibernation API), modeled on `../dyefield-net`.
Workers Free plan. **Not deployed yet** — deploy only when the owner says so (isimcha85 account, OAuth, `CLOUDFLARE_API_TOKEN` unset).

The game stays peer-run exactly as before (the room's host browser simulates the opponents; the world is deterministic
from the seed). This relay only carries the room's messages; it never looks inside them. Most of the high-rate state
goes browser-to-browser over WebRTC (`games/last-circle/runtime/net/ffg_rtc.js`) once that opens; the relay is the
signaling path and the fallback.

| file | what |
|---|---|
| `src/index.ts` | stateless Worker: `/health`, `WS /room/new`, `WS /room/<CODE>`; origin check first (403) |
| `src/room.ts` | `Room` DO, one per 4-character code: claim, join, presence, relay, directed `to`, meter batching, expiry |
| `src/meter.ts` | `Meter` DO (`idFromName("meter")`): daily usage (UTC), `strict` / `billing20` counting |
| `src/env.ts` | vars, code alphabet, origin check, close codes |
| `test/rooms.mjs` | protocol test against `wrangler dev` (23 checks) |

## Run locally

```
cd workers/last-circle-net
npx wrangler dev --local --port 8791     # reads .dev.vars: DEV=1, localhost origins
node test/rooms.mjs                      # in another shell
```
The game picks the relay itself: served from localhost/127.0.0.1 it uses `http://127.0.0.1:8791`; anywhere else
`https://last-circle-net.isimcha85.workers.dev` (`PROD_NET_URL` in `runtime/net/ffg_cfroom.js`). `?net=` can point
it at another *local* relay only.

## Protocol

- `WS /room/new?id=<peer>` — claims a random unused code (≤ 4 tries), opens the creator as the room's **owner** (host).
- `WS /room/<CODE>?id=<peer>` — join or rejoin (case-insensitive). Same id again replaces the old socket (close 4001).
- `id` = `^[A-Za-z0-9_-]{4,40}$`.
- Relay → client: `{k:"welcome", room, id, owner, ids}` then `{k:"presence", ids, owner}` on every join/leave;
  every other client's message as `{from, t, d}`.
- Client → relay: `{t, d}` (t ≤ 16 chars, text ≤ 16 KB); add `to:<peer>` to send to one peer only (WebRTC signaling).
  Text `ping` gets `pong` from the runtime without waking the room.
- Per-socket cap 120 msgs/s (excess dropped, never disconnected). Up to `MAX_SOCKETS` (8) sockets; the game itself
  seats host + 3 friends, extras watch the lobby.
- Close codes: 4004 no such room (never claimed / expired), 4009 full, 4029 new rooms closed for today, 4400 bad id,
  1013 could not find a free code. A refused socket also gets `{k:"err", code, why}` first.
- An empty room keeps its code 15 minutes (rejoin after a drop), then forgets it.
- Host hand-over: when the owner closes with 1000 (LEAVE ROOM / MAIN MENU) the longest-present player becomes owner
  at once; on any other close (a drop) after a 20 s grace if the owner has not rejoined. Presence carries the owner.

## Daily meter and the Free plan

Durable Object requests on Workers Free are 100,000/day **per account**, shared with `dyefield-net` and any VALE
worker. Cloudflare bills incoming WebSocket messages 20:1, but whether the Free daily limit counts them 20:1 is not
documented (see `games/dyefield/_spec/CONTRACT_ONLINE.md` §O0.1). So, like DYEFIELD:
- `COUNT_MODE = "strict"`: messages + connections counted 1:1 against `RAW_CAP` (20,000) — a small slice next to
  DYEFIELD's 55,000.
- `COUNT_MODE = "billing20"`: `ceil(messages/20) + connections` against `UNIT_CAP` (20,000) — switch once the owner's
  dashboard confirms 20:1 counting.
Only **new rooms** are refused when the cap is reached (the lobby says "Friend rooms are full for today"); rooms already
open keep running. Rooms report to the meter in batches (every 200 messages or 30 s, and when the room empties), so
the meter can undercount by up to one batch per room if a room is evicted from memory between reports.

Rough cost per 12-minute standard match, 2 players, if WebRTC fails and everything rides the relay: ~25 msgs/s in →
~18,000 raw. With WebRTC open (tested locally: it opens), the relay carries only signaling and events: a few hundred.

## Deploy (when the owner says so)

```
cd workers/last-circle-net && unset CLOUDFLARE_API_TOKEN && npx wrangler deploy
curl https://last-circle-net.isimcha85.workers.dev/health
```
Then upload the game build (its friends lobby already points at that URL). Deploy the Worker **before** the game: the
current live game still uses the Supabase path, and the new game build has no Supabase fallback.
