# Last Circle — "Play with friends" port brief (for the PC session)

Written 2026-11-22, 6:50 PM CT, on the Mac. The feature was built and tested on the Mac against an OLD copy of Last
Circle (Oct 5). The live game (?v=1795386861, released from the PC) is far newer, so **port the behaviour onto the
current PC source**; do not copy the Mac files over. `reference/` holds the Mac version as a guide.

## Already live (nothing to do)
Cloudflare relay **`https://last-circle-net.isimcha85.workers.dev`** (Worker `last-circle-net`, isimcha85 account,
source `workers/last-circle-net/` in the Mac checkout, README there). Health: `GET /health`. Allowed origins:
`forgeflow-games-cdn.isimcha85.workers.dev`, `forgeflowgames.com`, `www.forgeflowgames.com`. Locally it runs with
`npx wrangler dev --local --port 8791` and accepts any localhost origin.

## What to change in the game

1. **Transport.** Add `runtime/net/ffg_cfroom.js` (in this folder; drop-in, no dependencies). In `royale/net.js`
   replace `new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "last-circle")` with `new RoomNet(netBaseUrl())`; remove the
   Supabase URL/key. API: `connect()` (health probe), `createRoom()` → code, `joinRoom(code)`, `send(t, d)`,
   `isHost()`, `leave()`, fields `id room owner ids peerCount`, events `open peer msg owner lost rejoined`,
   `setFrozen(bool)`. Errors carry `err.code`: 4004 no such room, 4009 full, 4029 full for today, "unreachable".
   Served from localhost it talks to `http://127.0.0.1:8791`; anywhere else to the live relay.
   Keep `ffg_rtc.js` (P2P state); `rtc` signaling is sent with `d.to` and the transport addresses it to that peer only.
2. **Menu.** A "PLAY WITH FRIENDS · Start a room or join with a code" card in the mode-card column (green accent),
   replacing the small "🌐 SQUAD UP" button. Card emits `openOnline` as before.
3. **Lobby** (`openLobby`): START ROOM (server picks the 4-char code) / "— OR —" / code box (4 chars, uppercase,
   Enter joins, keys don't leak to the game) + JOIN FRIEND. In a room: big code, invite link box, COPY INVITE LINK,
   COPY CODE, mode (Standard / Quick · 5 min), **teams: ALL ON ONE TEAM / TWO TEAMS / EVERYONE FOR THEMSELVES**
   (host picks; guests see it; sent as `mode {mode, teams}`), roster (HOST, PLAYER n, TEAM A/B, IN A MATCH),
   START MATCH (host only) or "Waiting for the host to start…", LEAVE ROOM. Plain-text errors per code.
   Invite link: inside forgeflowgames.com → `<site origin>/games/last-circle?room=CODE`, else current URL + `?room=`.
   The PC build already has a team pick (D5, `W.settings.teamMode`) — merge with it rather than adding a second one.
4. **Teams into the match.** `cfg.teams`; humans get `team`: squad → "sq", two → slot%2 ? "sqB" : "sqA", ffa → null;
   actor creation uses `hu.team` when present.
5. **Host = room owner.** Only the owner's `start` / `mode` are accepted. The relay hands ownership to the
   longest-present player when the host leaves (20 s grace on a drop); the transport freezes `host` during a match.
6. **Party stays together.** Post-match button reads **BACK TO ROOM** in a room (`returnToRoom`: reset per-match
   state, `setFrozen(false)`, send `back`, reopen the lobby). Leaving a running match sends `bye`. On host loss guests
   play on locally and KEEP the room; outside a running match only `hello back mode start rtc` are handled.
7. **No late join.** `hello {name, busy}`; players inside a match reply busy → newcomer sees "The host is finishing a
   match — you'll play in the next one". START excludes peers still IN A MATCH. Max = host + 3 friends.
8. **Lobby feel (offline Quick + Battle Royale).** Fill over 8–15 s total (fill + the 2.7 s count), arrivals in
   uneven bursts over a trickle, shuffled grid; skip only after full. Practice and online keep the short fill.
   Quick card tag "FIGHTING IN 10 SECONDS" → "5-MINUTE MATCHES".
9. **No bots wording** outside Practice: lobby text "Every empty spot … filled by opponents"; host-left banner
   "HOST LEFT / THE MATCH CONTINUES — KEEP FIGHTING"; game_meta.json description (no "AI opponents"/"replace a bot").
   Also update the live Supabase games-row description.

## Test (what passed on the Mac)
Relay protocol test 23/23 (`workers/last-circle-net/test/rooms.mjs`). Browser: START ROOM → code+link; second tab
via `?room=` and via typed code; host mode/team change seen by guest; START → same seed/map/mode, slots 0/1(/2),
each sees the others, P2P open; TWO TEAMS → s0:sqA, s1:sqB on both; late joiner waits; BACK TO ROOM for host and
guest; match 2 with three tabs; host LEAVE ROOM → next player becomes host. Use a no-cache static server
(`serve_nocache.py`) — plain `http.server` served stale modules.

## Release
Relay is already live, so just release the game as usual. Rulings: `RULINGS.md`.
