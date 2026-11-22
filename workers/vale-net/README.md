# vale-net — VALE's game server on Cloudflare

One Worker plus one SQLite-backed Durable Object (`ValeHub`), on Workers Free, built the same way as `dyefield-net`.
The Durable Object runs VALE's own server logic, `games/vale/server/hub_core.ts`: matchmaking, **friend rooms** (Start
room / Join friend by code), the server-side draft, and lockstep matches with the authoritative sim. That is the same
code `npm run server` runs on Node (`games/vale/server/hub.ts`), so the two can't drift apart.

**Not deployed.** Going live needs the owner's go-ahead (see below).

| file | what |
|---|---|
| `src/index.ts` | the stateless Worker: `GET /health` (CORS *), `WS /ws` → the hub. Origin check first (403). |
| `src/hub_do.ts` | `ValeHub` DO: accepts sockets, loads the catalog for the version in each player's `hello`, runs one `HubCore` per catalog version, daily message cap, per-IP socket cap |
| `src/env.ts` | bindings and vars |

## How it fits

- The client already speaks this protocol (`games/vale/src/contracts/net.ts`, `src/session/online_link.ts`). It goes
  online when `VALE_CONFIG.server` (in the deployed `config.js`) or `?server=` names a server. With none, every queue
  plays offline against the usual opponents, as today.
- **Catalogs:** the hub reads `vale/catalog/schema-1/<version>/catalog.json` from the game CDN's R2 bucket
  (`forgeflow-games` on isimcha85). It loads whichever version a player's game is running, so **a content release
  needs no redeploy here**. Players on the same version meet; during a rollout, old and new versions match among
  themselves.
- **One hub object.** Every player connects to the same Durable Object (`idFromName('hub')`), so quick match and friend
  rooms see everyone. A match's server sim costs about 0.2 ms per tick (measured with the Node harness), so one object
  holds many matches. It sits near whoever woke it first; far-away players see more delay.

## Budget (Workers Free, shared with dyefield-net)

- **Requests:** 100,000 Durable Object requests a day for the whole account. Incoming WebSocket messages count 20:1.
  A player sends a message per input plus a check-in every 2 s. Measured through this Worker with players on
  autopilot: about 3,000 messages per player per match, about 150 billed requests. `DAILY_MSG_CAP` (1,200,000 messages ≈ 60,000 requests) turns new players away at
  `hello` once reached. Their game then plays offline, and nothing breaks.
- **Duration:** 13,000 GB-s a day. The hub stays awake while anyone is connected; awake around the clock it would use
  about 10,800 GB-s, so it fits, but it leaves less room for dyefield-net on a busy day. Its clocks stop when nobody is
  connected, so an idle hub sleeps.
- `GET /health` shows today's count (`msgs`), refusals, the cap, and the players and matches per catalog version.

## Run locally

```
cd workers/vale-net
npm install
npm run typecheck
# a catalog over HTTP (CATALOG_URL in .dev.vars points here)
python3 -m http.server 5298 --bind 127.0.0.1 --directory ../../games/vale/dist-catalog
npx wrangler dev --local --port 8791 --ip 127.0.0.1 --var SPEED:16 --var WAIT_S:30 --var FRIEND_TICKET_S:3
```
Unset `CLOUDFLARE_API_TOKEN` first (the stored token is R2-only; wrangler then uses OAuth). `SPEED`, `WAIT_S` and
`FRIEND_TICKET_S` only take effect with `DEV=1` (from `.dev.vars`), so tests can run matches faster than real time.

Tests (the Node harness probes, pointed at the Worker):
```
cd games/vale
VALE_NET_URL=ws://127.0.0.1:8791/ws node _harness/probe_friend_room.ts   # wrangler dev with SPEED:16 WAIT_S:30
VALE_NET_URL=ws://127.0.0.1:8791/ws node _harness/probe_online.ts        # wrangler dev with SPEED:64 WAIT_S:0.5
```
In the browser: `npm run dev` in `games/vale`, then open `http://localhost:5190/?server=ws://127.0.0.1:8791/ws`.

## Going live (owner go-ahead only)

1. `cd workers/vale-net && npx wrangler login` (the isimcha85 account), then `npx wrangler deploy`.
   Check `https://vale-net.isimcha85.workers.dev/health`.
2. Point the game at it: in the deployed VALE `config.js` (CDN slugs `vale` and `vale-playtest`) set
   `server: 'wss://vale-net.isimcha85.workers.dev/ws'`. `config.js` is read at page load, so this needs no rebuild.
   Keep `games/vale/public/config.js` in step so the next build carries it.
3. The client build must include the friend-room UI (the Play with friends card). An older live build simply never
   shows the card, but it **does** start sending its matchmade queues to the server.
4. **To switch online play off:** set `server: null` in `config.js` again. Every queue goes back to offline play.
