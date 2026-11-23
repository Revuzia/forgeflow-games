# Friends rooms — rulings (2026-11-22)

The owner delegated the open calls ("do what is industry standard"). Decided by how party / private-match
flows work in the big battle royales and by how this repo already runs DYEFIELD's relay.

1. **The party stays together after a match.** The post-match button reads BACK TO ROOM instead of PLAY AGAIN
   when you played in a friends room: everyone returns to the same room (same code, same friends), and the host
   starts the next match from there. MAIN MENU leaves the room. Leaving a match the others are still in sends
   `bye`, so a guest's seat is taken over at once and, if it was the host, guests play on locally right away.
   A guest whose host left keeps the room and can still go BACK TO ROOM afterwards.
2. **No joining a match in progress.** Private BR matches lock at start. Someone who opens the code or link
   while the room is mid-match lands in the room's lobby with "The host is finishing a match — you'll play in
   the next one", sees who is IN A MATCH, and is in the next match. Players still finishing the previous match
   are left out of the next one (the leader can launch without them; they rejoin the room after).
3. **Host hand-over.** If the host leaves the room (LEAVE ROOM / MAIN MENU), the longest-present player
   becomes host. A host whose connection merely drops keeps the room for 20 s to reconnect first. The host role
   never changes in the middle of a running match (host = authority over the opponents).
4. **Deploy order** (when the owner gives the go-ahead): deploy `workers/last-circle-net` first, then the game.
   Server before client is standard; the new client has no fallback to the old transport.
5. **Daily cap stays conservative**: `COUNT_MODE=strict`, `RAW_CAP=20000`. The free plan's Durable Object
   requests are shared by the whole account (dyefield-net already budgets 55,000). Switch to `billing20` only
   once the Cloudflare dashboard confirms 20:1 counting, as DYEFIELD's contract already specifies. Full meter =
   new rooms refused with a plain message; running rooms never cut.
6. **Invite link**: inside forgeflowgames.com the link is the site's game page (`/games/last-circle?room=CODE`),
   which forwards the code into the game; outside it, the current page with `?room=`. Code = 4 characters
   without lookalikes (0/O, 1/I/L), case-insensitive; an expired or mistyped code says so in plain words.
7. Player-facing text never says bots/AI/CPU: the old "Everyone else stays a bot" lobby line and the
   "PLAYERS NOW BOT-CONTROLLED" host-left banner were reworded ("filled by opponents", "THE MATCH CONTINUES").
