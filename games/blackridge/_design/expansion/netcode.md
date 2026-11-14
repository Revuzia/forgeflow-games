# BLACKRIDGE — PVP NETCODE DESIGN

Status: **DESIGN / PROPOSAL**. Not binding until A0 accepts the freeze amendments in §7.
Authority order unchanged: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` >
this document. Where this document needs the v1 freeze to move (it does — §7), that is a
freeze-amendment *request*, not a ruling.

Scope: how PVP works **over the wire** for a browser game with no dedicated game servers.
Map carving, mode design, and campaign-environment expansion are other documents' jobs; this
one owns transport, authority, tick rates, prediction, hit registration, failure, and the
measured milestones that prove each step.

Every load-bearing claim below is either **[verified]** — quoted from a file I read this
session, path given — or **[unverified]** — a vendor/pricing/limit claim I could not confirm
from code and that must be measured before it is designed against. Nothing is stated from
memory.

---

## 0. Executive answer, up front

1. **FFG's substrate is Supabase Realtime Broadcast/Presence, and it is a pub/sub relay, not
   a game server.** Every FFG multiplayer game shares one file lineage
   (`ffg_netplay.js`, 14 copies on disk). It is fine for turn-based play, adequate for a
   10 Hz snapshot game with ≤4 humans, and **structurally wrong as the hot path for a twitch
   FPS** — traffic scales O(H²) in room size and the transport answers over-rate by
   *dropping the connection*, i.e. ending the match.
2. **Exactly one FFG game has already solved most of this**: Last Circle
   (`games/last-circle/runtime/3d/royale/net.js` + `runtime/net/ffg_rtc.js`) moves the
   high-rate state stream onto **unreliable WebRTC DataChannels** and keeps Supabase for
   signaling, critical messages, and fallback. That two-tier transport is the right answer
   for Blackridge and we adopt it wholesale.
3. **We do NOT adopt Last Circle's authority model.** Last Circle gives each client authority
   over its own HP (`hitYou` → "the victim applies damage to itself"). For a 50-player battle
   royale with friends that is a defensible trade. For a competitive PVP shooter it is a
   one-line god-mode cheat. Blackridge PVP is **host-authoritative with client-side prediction
   and server-side rewind (favour-the-shooter)** — the Chroma Hide model
   (`games/chroma-hide/runtime/net/chromanet.js`) scaled up to twitch rates.
4. **Blackridge's sim is unusually well-suited to this and unusually badly shaped for it at
   the same time.** Well-suited: `sim.step(cmd)` is a fixed 1/60 command-driven, THREE-free,
   Node-runnable, seeded-deterministic simulation — that is *exactly* the shape prediction,
   reconciliation, rollback and a future headless referee all require. Badly shaped: the sim
   has **one player and N bots**, and bots use a **simplified locomotion path with no slide,
   no mantle, no jump, no tac-sprint**. A remote human cannot be modelled as a bot without
   losing the game's signature verbs. §7 is the refactor that fixes this, and it is the
   single largest engineering item in the whole plan — larger than the networking itself.
5. **Honest expectation setting.** At 50 ms RTT this feels like CoD. At 100 ms it feels like
   CoD on a bad day — peeker's advantage is decisive because Blackridge's own TTK table is
   **200–320 ms** [verified: `_design/combat_spec.md:174-180`], which is *comparable to the
   round trip*. At 200 ms it is playable but players will report "I died behind cover" and
   they will be **factually correct** — that is the price of favour-the-shooter and it is the
   same price CoD pays. Region-blind matchmaking on a global player base will produce 200 ms
   matches; a soft RTT cap in matchmaking is not optional polish, it is part of the design.

---

## 1. WHAT EXISTS — the real FFG net stack

### 1.1 File inventory (all paths verified this session)

| Path | Lines/size | What it is |
|---|---|---|
| `pipeline/engine/runtime/net/ffg_netplay.js` | 143 | **The substrate.** `NetPlay` — Supabase Realtime channel wrapper (Broadcast + Presence) + `TurnClock`. |
| `pipeline/engine/runtime/net/ffg_online.js` | 362 | 2-player strict-alternation turn machine + lobby UI over `NetPlay`. Turn-based only. |
| `pipeline/engine/runtime/net/ffg_seatplay.js` | 21 KB | N-seat (2–5) lockstep turn machine. Heartbeat roster, per-seat `seq`, outbound pacing queue. |
| `pipeline/engine/runtime/net/ffg_ratings.js` | 3.8 KB | Elo/W-L client. Writes via `report_match_result` RPC. **Postgres, not hot path.** |
| `games/last-circle/runtime/net/ffg_rtc.js` | 107 | **`RTCMesh`** — P2P DataChannel overlay. The only WebRTC in the portfolio. |
| `games/last-circle/runtime/3d/royale/net.js` | 755 | The realtime shooter precedent. Peer-relay, envelope merge, budget shedding, watchdogs, bot backfill. |
| `games/chroma-hide/runtime/net/chromanet.js` | — | **Host-authoritative** precedent (~10 Hz snapshots). |
| `games/chroma-hide/runtime/sim/net_protocol.js` | — | Pure, Node-testable pack/unpack with quantization. |
| `games/chroma-hide/runtime/net/loopback.js` | 45 | **In-process test double** — N endpoints, same pack/unpack, no Supabase. |
| `games/luminascape/net/lumina_net.js` | 21.9 KB | "Positions sync at 10 Hz, host world re-syncs" — third realtime user. |

`find games -name ffg_netplay.js` returns **14 copies** — aether-isles, checkers, chroma-hide,
cosmic-coils, dungeon-forge, elysium-realms, grid-rush, iron-tide, last-circle, luminascape,
neon-veil, pirates-cove, tide-breakers, warboard-chess. **There is no shared module; each game
vendors its own copy and they have drifted.** That drift is load-bearing (see §1.4).

### 1.2 What `NetPlay` actually guarantees

From the file header [verified: `pipeline/engine/runtime/net/ffg_netplay.js:1-23`]:

> "Broadcast/Presence are a pure WebSocket relay — they NEVER touch Postgres, so there are no
> database fees; they run on Supabase's free Realtime quota (200 concurrent conns, 2M
> msgs/mo)."

The API surface, verbatim from the same file:

```js
net.on("open", ({host}) => ...).on("peer", ({present}) => ...).on("msg", ({t,d}) => ...);
await net.connect(); await net.quickMatch();   // or net.joinRoom("ABCD", true/false)
net.send("fire", {x,y});
```

Room = a channel `ffg:<gameId>:<code>`; matchmaking = a lobby channel `ffg-lobby:<gameId>`
where presence sorts peer ids and the **lexically lowest id is the deterministic host**
(`ffg_netplay.js:64`). That deterministic-lowest-id rule is reused everywhere — Last Circle's
roster painter depends on it [verified: `royale/net.js:237-240`] and `RTCMesh` uses the same
comparison to pick the WebRTC offerer without glare [verified: `ffg_rtc.js:51`].

Guarantees, stated plainly:

- **Ordered, reliable, JSON-only, relay-hop.** Every message is a WebSocket frame to
  Supabase's edge and back out to each subscriber. No unreliable/unordered mode. No binary.
- **No server-side logic.** Nothing validates, nothing arbitrates, nothing persists. Whatever
  a client broadcasts, every other client receives verbatim.
- **Presence gives you a roster and departures**, but coarsely — Last Circle's copy had to
  patch `peer` to fire on *count* change, not just the 1↔2 boolean flip, because "going 2 → 3
  → 4 never re-fired, so a room of 3-8 sat on the lobby's first reading and the host started
  blind" [verified: `games/last-circle/runtime/net/ffg_netplay.js`, presence sync comment].
  `ffg_seatplay.js:16-17` independently worked around the same defect with a 3 s HELLO
  heartbeat, because "NetPlay's `peer` event only fires at the 1<->2 boundary".

### 1.3 The limits — what the code says, and what is actually verified

This is the part where I must be careful, because the numbers in the codebase **do not agree
with each other** and none of them were verified against Supabase this session.

| Limit | Value asserted | Where | Status |
|---|---|---|---|
| Concurrent connections | 200 | `ffg_netplay.js:7` header | **[unverified]** — code comment, not measured |
| Monthly messages | 2,000,000 | `ffg_netplay.js:7` header | **[unverified]** — code comment |
| Per-connection message rate | **100 msg/s** | `royale/net.js:129` | **[unverified]** but load-bearing in shipped code |
| Billing unit | one message **per receiving subscriber** | `royale/net.js:5-9` | **[unverified]**, drives all the O(H²) math |
| Over-rate behaviour | **connection is DROPPED, not throttled** | `royale/net.js:123-129` | **[unverified]** but treated as fact by shipped code |
| Declared `eventsPerSecond` | **12** (pipeline copy) vs **30** (last-circle copy) | see below | **[verified]** — the drift is real |

The rate ceiling is quoted verbatim from `royale/net.js:123-129` because the whole design
hangs on it:

> "Supabase Realtime does not throttle a connection that exceeds its rate — it DISCONNECTS
> it, which mid-match means the game simply ends for everyone in the room. So the load
> shedding has to live on this side, and it has to shed the cheap things: a missing tracer is
> invisible, a dropped socket is the match. 100 msg/s is the free-project ceiling and every
> send is billed once per receiving subscriber, hence 100/H."

And the O(H²) consequence, from the same file's header [verified: `royale/net.js:5-13`]:

> "Supabase Realtime bills one message per RECEIVING subscriber, so a room of H humans costs
> H per send and total traffic grows as H². At 8 humans the timer traffic alone is several
> times the free-project 100 msg/s ceiling, and Realtime does not shed load at the cap, it
> DROPS THE CONNECTION — i.e. the match ends in a disconnect."

`MAX_GUESTS = 3` [verified: `royale/net.js:314`] — **host + 3, i.e. 4 humans is the measured
practical ceiling of the pure-Supabase path in a shipped FFG shooter.**

### 1.4 The `eventsPerSecond` drift — a finding worth its own paragraph

The pipeline master declares 12:

```js
this.sb = createClient(this.url, this.anonKey, { realtime: { params: { eventsPerSecond: 12 } } });
```
[verified: `pipeline/engine/runtime/net/ffg_netplay.js:43`]

Last Circle's copy declares 30, with this comment [verified: `games/last-circle/runtime/net/ffg_netplay.js`]:

> "…12 has been under-declaring by roughly half since the game shipped, which also made every
> capacity estimate against this transport ~2x optimistic. 30 is the honest number for the
> CURRENT send rates… This file is a PER-GAME COPY (`find games -name ffg_netplay.js` → 14 of
> them)".

Two consequences for Blackridge:

- **Blackridge must vendor its own copy** (`games/blackridge/core/net/ffg_netplay.js`) and
  declare its own `eventsPerSecond`, per the established per-game-copy convention. Editing
  the pipeline master would silently change 13 other games.
- **Any capacity number derived from the 12-value is wrong by ~2×**, in *both* directions
  depending on which side of the bug you were on. This is the strongest possible argument for
  §8's rule: **every rate in this document is a hypothesis until the phase-1 harness measures
  it on the live transport.**

### 1.5 How Last Circle actually does realtime — the pattern we inherit

`royale/net.js` is the only shipped FFG file that runs a shooter over this transport. Its
techniques, all of which Blackridge adopts:

1. **Determinism from a shared seed replaces most traffic.** "The world is DETERMINISTIC from
   the shared seed (terrain, POIs, loot spawns, chest contents, storm plan), so only live
   state is relayed" [verified: `royale/net.js:20-22`].
2. **Envelope merge — one billed message carries everything.** Cosmetic events, bot snapshots
   and the match clock all ride the state packet: "the ride-along is free because messages,
   not bytes, are the billed unit" [verified: `royale/net.js:147-151`].
3. **Rate scales with room size.** `const stateMs = H <= 2 ? 83 : H === 3 ? 125 : 200;`
   [verified: `royale/net.js:645`] — 12 / 8 / 5 Hz, keeping the state term at 48 / 72 / 80
   msg/s under the 100 ceiling.
4. **A hard outbound budget with a CRITICAL allowlist.** `sendBudgetLeft()` returns
   `Math.max(8, Math.floor(100 / H)) - S.sendWinN` and non-critical messages are dropped
   [verified: `royale/net.js:130-143`]; `CRITICAL_MSG` protects state/hitYou/died/start/sync
   [verified: `royale/net.js:121`].
5. **Audibility/relevancy gating.** Gunfire relays are suppressed when no remote human is
   within 250 m; far bots snapshot at 1/5 rate [verified: `royale/net.js:66-79`, `:634-635`].
6. **WebRTC overlay for the high-rate stream.** `RTCMesh` — full mesh, ≤3 connections per
   client, Google STUN only, **no TURN**, deterministic offerer by lower peer id, and the
   channel is deliberately unreliable [verified: `ffg_rtc.js:1-23, 51-53`]:

   > "The data channel is UNRELIABLE ({ordered:false, maxRetransmits:0}) on purpose: the state
   > envelope is a snapshot stream — a lost packet is superseded by the next one 83-200 ms
   > later, and retransmitting stale state is worse than dropping it."

   And the fallback discipline, verbatim: "any RTC failure is byte-identical to the pre-RTC
   behaviour" [verified: `ffg_rtc.js:11-12`]; "a NAT-blocked pair simply never opens and that
   peer keeps riding Supabase" [verified: `ffg_rtc.js:16-18`].
7. **Watchdogs both directions.** Guest watches host silence (8 s → `hostLost`), host watches
   guest silence (12 s → bot takeover) [verified: `royale/net.js:707-724`].
8. **Clock slew, not snap**, with an explicit backgrounded-tab escape hatch [verified:
   `royale/net.js:534-550`] — see §6.4, this is the FFG gotcha the harness must handle.

### 1.6 What Last Circle gets *wrong* for a competitive shooter

Stated bluntly because the design depends on not copying it:

```js
if (t === "hitYou") {
  const victim = W.actorById.get(d.target);
  if (!victim) return;
  const mine = victim === W.player || (S.net.isHost() && victim.isBot && !victim.netRemote);
  if (mine && victim.alive) W.hurtActor(victim, d.dmg, d.attacker, d.weapon, d.isHead);
```
[verified: `royale/net.js:417-423`]

The victim's own client decides whether it takes damage, and how much — the header says so
outright: "hits on a human are sent to the victim's client ('hitYou') — the victim applies
damage to itself (client authority over own HP)" [verified: `royale/net.js:23-25`]. In a
play-with-friends BR that is a reasonable simplification. In PVP with strangers and a rating
attached it is **immortality in three lines of console**. Blackridge PVP cannot use it.

Chroma Hide already made the opposite choice and documented why [verified:
`games/chroma-hide/runtime/net/chromanet.js:29-33`]:

> "Who is allowed to speak authoritatively. Snapshots and match events are the host's word;
> without this check ANY peer could broadcast a forged win, catch or phase change and every
> client would apply it unquestioned."

Chroma Hide is the model. Its snapshot cadence is 10 Hz driven off an accumulator
[verified: `games/chroma-hide/runtime/game.js:1133` — `if (this._snapAccum >= 0.1) { ... this.net.sendSnapshot(this.sim); }`],
its wire format is a separate pure module with quantization (`Q = 100` centimetre positions,
yaw→byte at ≈1.4° resolution) [verified: `runtime/sim/net_protocol.js:26-31`], and it has an
in-process loopback double so host/guest logic is testable **without Supabase at all**
[verified: `runtime/net/loopback.js:1-9`]. All three are adopted.

---

## 2. ARCHITECTURE CHOICE

### 2.1 The three candidates, judged honestly

**(a) Peer-relay / distributed authority** (Last Circle). Each client simulates its own actor
and broadcasts state; hits are asserted to the victim.
*Pros:* lowest latency-to-feel for your own movement (zero, it's local); simplest; already
shipped and debugged in this codebase; no host advantage.
*Cons:* **no authority anywhere.** Damage, position, kills, and score are all client-asserted.
Trivially cheatable. Two clients can and do disagree about the world; Last Circle's own
comments document exactly this class of bug being hunted for months. Unacceptable for PVP
with strangers or ratings.
**Verdict: rejected** as the PVP model. Retained as the *degraded* mode after host loss (§5.2).

**(b) Host-authoritative** (Chroma Hide, scaled to twitch rates). One player's browser runs
the only real simulation; guests send input and render authoritative snapshots, with local
prediction for their own actor.
*Pros:* a single truth; kills are decided in one place; cheating requires being the host, not
merely being a player; bot backfill is free because the host already runs the AI; it matches
the sim's existing shape (`sim.step(cmd)` consuming one command struct per tick).
*Cons:* **host advantage is real and unfixable** — the host has 0 ms input latency and 0 ms
hit latency, everyone else pays their RTT. Host CPU now runs 12 actors + AI + its own render;
the perf budget already allocates "sim tick CPU ≤ 3 ms; AI share ≤ 1.5 ms (≤4 brains think/tick,
12 bots max)" [verified: `BUILD_PLAN.md` §5.2] and that budget was written for single-player.
Host disconnect ends or degrades the match. **A cheating host cheats for everyone.**
**Verdict: ADOPTED** for phases 1–5.

**(c) Lightweight authoritative referee** — the sim runs on a neutral server (Cloudflare
Durable Object / Worker with WebSocket hibernation), all clients are guests.
*Pros:* removes host advantage, removes host migration, removes host cheating, makes ratings
meaningful. And Blackridge can *actually do this*, which most browser games cannot: the sim is
THREE-free and Node-runnable by contract [verified: `core/sim/sim.js:2-4` — "THREE-free,
Node-runnable, fixed dt = 1/60 EXACTLY, deterministic"], and there is already a Node selftest
that runs it headlessly (`core/sim/sim.selftest.cjs`, 47 KB). The same module that runs in the
browser would run in the DO. That is a genuinely rare position to be in.
*Cons:* **it costs money**, and FFG's entire multiplayer posture is "$0, free tier, no Postgres
on the hot path". Durable Objects require a paid Workers plan and bill wall-clock/CPU
[**unverified** — I did not check current Cloudflare pricing this session and will not invent
a figure; §6 phase N6 makes pricing verification the first task of that phase]. It is also a
new deploy target next to the existing R2/Pages path.
**Verdict: DEFERRED to phase N6, designed-for from day one.** The protocol in §3 is written so
that swapping the authority from "the host's browser" to "a DO running the same sim module"
changes the transport and the trust model but **not the message shapes**. That is the whole
reason to specify it now.

### 2.2 The transport, decided

Two tiers, copied from Last Circle's structure and its exact fallback discipline:

- **Tier 1 — WebRTC DataChannel, unreliable + unordered**, carrying input packets (guest→host)
  and snapshot packets (host→guest). Binary `ArrayBuffer`, not JSON.
- **Tier 2 — Supabase Realtime Broadcast**, carrying: signaling, lobby, `start`, roster,
  match-end, chat, **and the complete fallback state path** if a DataChannel never opens or
  dies mid-match.

**Topology change from Last Circle: STAR, not MESH.** Last Circle needs a mesh because every
client owns its own actor and must reach every other client. Blackridge is host-authoritative,
so every packet's destination is the host or comes from the host. Each guest holds **exactly
one** peer connection; the host holds H−1. This is strictly less connection state, strictly
fewer NAT traversal failures to survive, and it scales to more players than a mesh does.
`RTCMesh` as written already supports this — a guest simply never calls `ensurePeer` on
anyone but the host.

**No TURN server.** Same call as Last Circle: STUN only, and a pair that cannot traverse NAT
silently falls back to the Supabase relay for that pair. Cost of a TURN service is a spend
decision that has not been made; the fallback makes the game work anyway, slower.

### 2.3 What is genuinely achievable — and what player experience results

**Achievable on this substrate:**
- 60 Hz local simulation and rendering (already true).
- 20 Hz authoritative snapshots and 30 Hz input from every client, over DataChannels, for up
  to ~8 humans on a healthy host uplink (§5.5 for the arithmetic).
- Client-side prediction that makes your own movement and shooting feel **instant** regardless
  of ping. This is the single biggest lever and it works completely.
- Favour-the-shooter lag compensation, so your crosshair being on someone means a hit.

**Not achievable, and we should stop pretending otherwise:**
- **Sub-frame fairness between two players at different pings.** There is no referee at the
  network's midpoint. Someone always wins the tie.
- **Anti-cheat.** A browser client with devtools open is not trustworthy and never will be.
  Host authority raises the cost of cheating from "trivial" to "you must be the host or you
  must forge inputs the host will accept"; §4.4 lists what the host can and cannot catch.
- **Ranked integrity while a player is the host.** See §4.5 — the recommendation is that
  ratings stay off until N6.
- **A tick rate above 20 Hz snapshot on the Supabase fallback path.** The fallback is a
  degraded mode by construction; at H=4 on Supabase, Last Circle's own scaling says 5 Hz.

**Player experience at realistic RTT.** Blackridge's TTK is the context that makes this hard —
"Warden near: 4 shots → 3 × 80 ms = **240 ms**… Vesper near: 4 shots → **200 ms**"
[verified: `_design/combat_spec.md:176-177`]. Latency of the same order as TTK means the loser
of a duel frequently dies before their own client shows them taking damage.

| RTT | Guest's view of the world is behind by | What it feels like |
|---|---|---|
| **50 ms** | ~125 ms (25 ms one-way + 100 ms interp buffer) | Indistinguishable from local for movement. Trades feel fair. Occasional "he shot me first" on simultaneous peeks. Ship-quality. |
| **100 ms** | ~150 ms | Own movement still perfect (prediction). Remote players are a full 150 ms of animation behind — at Vesper sprint speed 6.4 m/s [verified: `core/sim/player.js:21`] that is **~1 metre of position error you are shooting into**, which rewind corrects. Peeker's advantage is decisive: the player who initiates the peek wins most trades. Players will notice. Still fun. |
| **200 ms** | ~250 ms | Rewind is at its 250 ms cap (§3.6). "I died behind cover" becomes a routine, *correct* observation — the shooter genuinely had you in the open on their screen a quarter-second ago. Grenades and pushes feel laggy. Playable; not competitive. |
| **>250 ms** | beyond the rewind cap | Shots at moving targets start missing outright because the rewind is clamped. **Matchmaking should refuse to pair here** and the lobby should say why. |

The one thing that must be said out loud: **the host experiences none of this.** In a 6-player
lobby, one player is having a LAN experience and five are not. Mitigations in §4.5.

---

## 3. THE NETWORK MODEL

### 3.1 Rates

| Stream | Rate | Direction | Transport | Reliability |
|---|---|---|---|---|
| Simulation | **60 Hz** fixed, `DT = 1/60` | local, every client | — | — |
| Input packet | **30 Hz** (every 2nd tick), carrying the last **4** commands | guest → host | RTC | unreliable |
| Snapshot | **20 Hz** (every 3rd tick) | host → each guest | RTC | unreliable |
| Full baseline snapshot | on join, on desync, ≤1 Hz | host → one guest | Supabase | reliable |
| Discrete events (kill, spawn, objective, match end) | on occurrence | host → all | Supabase | reliable, ordered |
| Signaling / lobby / roster | on occurrence | any → all | Supabase | reliable |

**Why 60 Hz sim is non-negotiable:** `sim.step(cmd)` is contractually "ONE fixed tick, dt =
1/60 exactly. No other dt exists" [verified: `_design/architecture.md:274`]. Changing it
invalidates every tuned constant in `combat_spec.md` — TTK, recoil patterns, slide decay
(`SLIDE_TAU: 0.55`), buffer windows (`BUFFER_S: 0.35`) [verified: `core/sim/player.js:19-37`].
The network runs *at a divisor of* the sim rate; it never changes the sim rate.

**Why 20 Hz snapshot, not 30 or 60:** at 12 actors × 12 bytes (§3.2), 20 Hz is 3.0 KB/s per
receiver, 60 Hz is 9.1 KB/s per receiver, and the host pays that **per guest**. At 8 players
the host's uplink is 21 KB/s at 20 Hz versus 64 KB/s at 60 Hz. Consumer uplinks are the
constraint, not downlinks. 20 Hz with 100 ms interpolation is the CoD-era standard and is
visually indistinguishable once entity interpolation is correct.

**Why input carries 4 commands:** on an unreliable channel, redundancy is cheaper than
retransmission. Each 30 Hz packet repeats the previous 3 commands (~7 bytes each), so a single
lost packet is invisible and three consecutive losses are needed to actually stall the host's
view of your input. This is the standard Quake3/Source trick and it costs ~21 bytes/packet.

### 3.2 Snapshot vs input-delta — the decision, and the wire format

**Snapshot, delta-compressed against the last snapshot the client acknowledged.** Not lockstep,
not input-delta broadcast.

Lockstep (what `ffg_seatplay.js` does — "Perfect-information LOCKSTEP: every client runs the
same deterministic sim from a shared seed; only the acting authority's move… crosses the wire"
[verified: `ffg_seatplay.js:5-9`]) is correct for board games and **fatal for an FPS**: it makes
every client wait for the slowest, which at 60 Hz means every frame is gated on the worst ping.

The wire format follows Chroma Hide's precedent (a **separate pure module**, Node-testable, no
transport imports) but goes binary because DataChannels carry binary and messages-not-bytes is
no longer the billing unit once we are off Supabase.

Proposed `core/net/protocol.js` (pure, THREE-free, Node-runnable, unit-tested):

```
ACTOR RECORD — 12 bytes
  u8   id            actor id (0 = host player, 1..N players, 64.. bots)
  i16  x, y, z       centimetres. Map bounds are X,Z ∈ [-60,+60] m  → ±6000 cm, fits i16.
  u8   yaw           ≈1.4° resolution (Chroma Hide's yawToByte)
  i8   pitch         ±1.45 rad clamp [verified: core/sim/player.js:81] → ~0.7° resolution
  u8   hp            0..100
  u8   weapon        weapon table index
  u8   flags         crouch | ads | reloading | sliding | mantling | grounded | firing | alive

SNAPSHOT HEADER — 8 bytes
  u32  tick          host sim tick (authoritative clock; replaces Last Circle's clock slew)
  u16  ackInputTick  the newest input tick the host has consumed from THIS guest
  u8   actorCount
  u8   flags         full-baseline | delta | matchPhase-changed
```

12 actors + header ≈ **152 bytes/snapshot**, ≈ **3.0 KB/s per receiver at 20 Hz**, before
delta compression. Delta (send only actors whose bytes changed since `ackTick`) typically
halves that in real play because standing/dead actors emit nothing.

```
INPUT PACKET — 8 + 4×7 = 36 bytes
  u32  tick          client sim tick of the newest command
  u16  ackSnapTick   newest snapshot this client has applied  ← drives host-side rewind
  u8   count         (=4)
  u8   reserved
  ×4:  i8 moveX, i8 moveZ, u8 yaw, i8 pitch, u16 buttons, u8 seqLow
```

`buttons` bitfield maps 1:1 onto the frozen cmd struct [verified: `_design/architecture.md:252-254`]:
`{moveX, moveZ, yaw, pitch, jump, crouch, sprint, fire, ads, reload, switchTo, interact}` plus
`grenade` from `sim.js`'s `NULL_CMD` [verified: `core/sim/sim.js:36-40`]. **The wire struct is
the cmd struct.** That is not a coincidence — it is the payoff of the sim already being
command-driven.

Supabase fallback path: the same records, base64'd into the JSON `d` field, at the reduced
rates in §5.4.

### 3.3 Interpolation buffer

Remote actors render at `hostTick − interpDelay`, where:

```
interpDelay = clamp(2 × snapshotInterval + jitterEstimate, 100 ms, 250 ms)
            = clamp(100 ms + jitter_p95, 100, 250)
```

Two snapshot intervals (100 ms at 20 Hz) is the floor: one interval to always have a newer
snapshot to interpolate *toward*, one for jitter headroom. `jitterEstimate` is the p95 of
inter-arrival deviation over a 3 s window, recomputed each second, and it **only ever grows
fast and shrinks slowly** (grow immediately, decay 5 ms/s) — a buffer that shrinks eagerly
stutters on the next jitter spike.

The buffer is **displayed in the HUD** next to ping, because a player who can see "you are
150 ms behind" is a player who files a coherent bug report instead of "hit reg is broken".
This mirrors Last Circle's `W._netStats.lastSeenAgeMs`, and its honest label discipline:
"the HUD labels it SYNC, not ping" [verified: `royale/net.js:691-692`].

### 3.4 Client-side prediction and reconciliation (local player)

The local player's own actor is **never** rendered from a snapshot. It is simulated locally at
60 Hz from local input, exactly as in single-player, and corrected when the host disagrees.

```
each tick T:
  cmd = input.buildCmd()
  ring.commands[T % 128] = cmd
  stepLocalActor(sim, myActor, cmd, DT)        // NOT sim.step — see below
  ring.states[T % 128] = cheapSnapshot(myActor)
  if (T % 2 === 0) net.sendInput(lastFour(ring.commands, T))

on snapshot S arrives (carries S.ackInputTick = A, and my actor's authoritative state):
  err = distance(S.myActor.pos, ring.states[A % 128].pos)
  if (err < 3 cm) accept, do nothing                     // dead zone: no correction at all
  else:
    myActor := S.myActor                                  // snap to authority
    for (t = A+1 .. currentTick):                         // replay unacked commands
      stepLocalActor(sim, myActor, ring.commands[t % 128], DT)
    if (err > 1.5 m) hard-snap the camera, else blend the visual offset out over 150 ms
```

**Two things make this cheap enough to be real, and they are the reason Blackridge can do this
at all:**

1. **Replay must re-simulate ONLY the local player, not the whole world.** `sim.step(cmd)`
   runs the full tick — player, then AI, then all bot locomotion and weapons, then projectiles,
   grenades, damage, mission [verified: `core/sim/sim.js:124-179`]. The perf budget allows
   "sim tick CPU ≤ 3 ms" [verified: `BUILD_PLAN.md` §5.2]. Replaying 6 ticks of *that* after
   every snapshot at 20 Hz would burn ~18 ms per correction inside a 16.7 ms frame budget —
   an instant, guaranteed p99 failure against `BUILD_PLAN` §5.2's "p99 ≤ 33.3 ms… FAIL". So
   §7's refactor must expose a **`stepLocalActor(sim, actor, cmd, dt)` path that runs
   movement + weapon state machine only** — no AI, no other actors, no mission. That is
   `stepPlayer` + `stepActorWeapon` and nothing else, and it should measure in the tens of
   microseconds. Budget: **replay of 15 ticks (250 ms) ≤ 1.0 ms**, asserted by a probe.
2. **`sim.snapshot()` cannot be used for the ring buffer.** It is
   `return JSON.parse(JSON.stringify(state));` [verified: `core/sim/sim.js:181-183`] — a full
   deep clone of every bot, at 20 Hz, allocating garbage in the hot path, against a budget line
   that reads "per-frame allocations: **0** in any update()" [verified: `BUILD_PLAN.md` §5.2].
   The ring buffer stores a flat `Float32Array` of the local actor's ~24 predicted fields,
   written in place. Zero allocation after construction.

### 3.5 Entity interpolation (remote actors)

Remote players and host-simulated bots are **rendered, never simulated** on a guest. They hold
a small history of received snapshots and are interpolated:

- **Position:** linear between the two snapshots bracketing `renderTime`. Not cubic — at
  20 Hz over ≤250 ms, hermite/catmull overshoots on direction changes and produces the
  "sliding on ice around corners" tell.
- **Yaw:** shortest-arc lerp. **Pitch:** linear.
- **Stance/ADS/reload/firing flags:** these are *edges*, not levels. They apply at the
  snapshot boundary and drive the existing anim derivation. Blackridge already has the
  mapping — `deriveBotAnim(b)` picks `hit / fire / crouch_walk / run / walk / aim / idle`
  from speed and recency [verified: `core/sim/sim.js:322-339`] — so a remote actor's anim
  comes from the same function, fed by interpolated velocity. **This is why remote humans
  will animate correctly for free**, and it is exactly the class of bug Last Circle had to
  fix by hand: "every peer and (on a guest) every bot was frozen at createActor's defaults:
  never crouching…, never reloading…, and pitch 0 forever" [verified: `royale/net.js:503-510`].
  Learn it once here instead of shipping it and patching it.
- **Extrapolation:** if the newest snapshot is older than `renderTime`, extrapolate at most
  **100 ms** on last known velocity, then freeze the actor in place. Never extrapolate through
  a wall — clamp the extrapolated position with `world.moveCapsule` [verified: available at
  `_design/architecture.md:325`]. A frozen enemy reads as lag; an enemy sliding through
  concrete reads as a broken game.
- **Never extrapolate HP or death.** Death arrives as a reliable event.

### 3.6 Lag compensation — favour the shooter, and its exact cost

Blackridge is *not* hitscan. R5 ruled swept sub-stepped projectiles: "Warden 700 m/s, Corvus
850, Vesper/Pike 999 'hitscan'" [verified: `BUILD_PLAN.md` R5; `core/sim/ballistics.js:1-6`].
That materially changes lag compensation, in our favour, and the design must say how.

**The rewind:**

1. The host keeps a **rewind ring** of every actor's capsule (pos, stance→height, yaw) for the
   last **500 ms** = 30 entries at 60 Hz. 12 actors × 30 × 16 bytes ≈ **5.8 KB**. Trivial.
2. A guest's input packet carries `ackSnapTick` — the snapshot it had actually applied when it
   pressed fire. The host computes
   `rewindMs = (hostTick − ackSnapTick)/60 × 1000 + guestInterpDelay`, where `guestInterpDelay`
   is reported by the guest in its hello/heartbeat.
3. **`rewindMs` is clamped to 250 ms**, hard. Beyond that the host resolves against present-time
   positions and the guest simply misses — which is the correct, honest behaviour and is what
   makes the >250 ms matchmaking cap in §2.3 necessary rather than optional.
4. The host restores every *other* actor's capsule to `hostTick − rewind`, calls the **same**
   `fireShot(sim, shooter, weapon, origin, aimDir, rng)` [verified: frozen signature,
   `core/sim/ballistics.js:5-6`], then restores present-time capsules.
5. **The projectile is spawned in the rewound past but lives forward in host present time.**
   Only the *spawn transform and the first sub-step* are rewound. A Warden round at 700 m/s
   crossing 40 m takes 57 ms; the target has 57 ms of host-time to move out of its path, and
   it moves in *real* host time, not rewound time. This is strictly less exploitable than
   pure-hitscan rewind and strictly more physical.

**The cost, stated without euphemism.** Favour-the-shooter means: **a player who has already
reached cover on their own screen can still be killed**, by up to `rewindMs` of history. At
100 ms RTT that is ~150 ms — at sprint speed 6.4 m/s, **just under a metre past the corner**.
At 200 ms it is a quarter-second and ~1.6 m. Those deaths are not bugs; they are the design
choosing the shooter over the target, because the alternative (favour the target) means your
crosshair being dead on someone produces no hit, which players experience as the game being
broken rather than the network being slow.

Two mitigations that are worth the complexity:
- **Cap the rewind at 250 ms** (above), so the worst case is bounded and printable.
- **Instrument it.** The host counts `rewindKills` bucketed by `rewindMs`, and the debrief
  reports the distribution. When someone says "hit reg is broken", we answer with the
  histogram. This is the doctrine §5 rule — measure at the layer the player sees — applied to
  the one part of netcode where players' subjective reports are systematically unreliable.

### 3.7 What the deterministic fixed-dt sim gives us for free — exactly

This section exists because the determinism is the single biggest asset in this design, and it
is worth being precise about which parts are free and which are not.

**Free, today:**

1. **Prediction is not an approximation.** Client and host run *byte-identical movement code*
   at *byte-identical dt*. `DT = 1/60` is a module constant, not a frame delta
   [verified: `core/sim/sim.js:34`]; the loop accumulates and steps in whole ticks
   [verified: `runtime/boot.js:339-347`]. So a guest replaying its own commands from an
   authoritative state reaches **the exact same float result the host reached**, and the
   reconciliation dead-zone (§3.4) can be 3 cm instead of 30 cm. Games without a fixed-dt sim
   cannot do this; they eat a permanent correction jitter and hide it with smoothing.
2. **The command struct is already the wire format.** `input.buildCmd()` returns a flat,
   JSON-safe struct of exactly the fields the sim consumes [verified:
   `_design/architecture.md:252-254`]. No serialization design work; no "which of these 40
   fields does the server need" archaeology.
3. **The world needs no synchronization at all.** The map is built from a seed —
   `buildColliders(seed)` → `buildLayout(seed)` [verified: `core/level/colliders.js:29-30`] —
   and colliders derive "ENTIRELY from layout.js — the single source — so visuals… and
   collision can never drift" [verified: `core/level/colliders.js:3-5`]. Ship the seed in the
   `start` packet and every client's geometry is identical. This is the same lever Last Circle
   used ("the world is DETERMINISTIC from the shared seed"). It also gives us a free desync
   guard: **the `start` packet carries a hash of `buildColliders(seed).boxes`, and a client
   whose hash disagrees refuses to join instead of playing in a different building.**
4. **The referee migration path (option c) is nearly free.** The sim is THREE-free and
   Node-runnable *by contract*, with a 47 KB Node selftest proving it
   (`core/sim/sim.selftest.cjs`). Whatever runs in the host's browser runs unmodified in a
   Durable Object.
5. **Headless netcode tests need no browser.** Two `createSim()` instances in one Node process,
   a fake link with configurable latency/jitter/loss, and a state hash. That is phase N0 and it
   catches most netcode bugs before Playwright is ever involved.

**NOT free — determinism the sim does not currently have:**

6. **RNG stream ordering is global, not per-actor.** `makeStreams(seed)` returns four
   free-running streams — `spread`, `ai`, `mission`, `fx` — and the header's stated invariant is
   only that streams don't interfere with *each other*: "One mulberry32 stream per system so
   replaying any one system from a seed never depends on how often another system rolled"
   [verified: `core/rng.js:1-4`]. Inside `rng.spread`, the Nth roll depends on **how many shots
   everyone has fired**. A guest predicting its own shot cannot know its index in that global
   sequence, so **predicted spread will not match host spread**, and the guest's tracers will
   diverge from the shots that actually resolved. Required fix (§7, N3): derive the spread roll
   from `mulberry32(hash(seed, shooterId, shotSeq))` — a *pure function of the shot*, not a
   position in a stream. Then a guest predicts its own pellet spread exactly and its tracer is
   truthful.
7. **Float determinism across machines is not guaranteed by any of this.** `Math.hypot`,
   `Math.atan2` and friends are implementation-defined in the last bits across JS engines and
   CPUs. This design **never depends on cross-machine bit-exact agreement** — the host is
   authoritative and corrections are continuous, so a 1e-7 divergence is absorbed by the dead
   zone. It matters only if someone later proposes true lockstep. Do not propose true lockstep.

---

## 4. HIT REGISTRATION + AUTHORITY

### 4.1 Who decides a kill

**The host, and only the host.** Guests never apply damage to anyone, including themselves.
A guest's `fire` is an *intent* in its input packet; the resulting damage, death, kill credit
and score come back as authoritative snapshot state plus a reliable `death` event.

The event vocabulary already carries what is needed —
`death {victim, attacker, headshot, pos, dir}` and `hurt {victim, attacker, amount, hp, part, dir}`
[verified: `_design/architecture.md`, event table §4] — and both already flow through the frozen
sim→view bridge. **PVP adds no new event types**, which is exactly what the freeze wants.

### 4.2 The damage path

`applyDamage(sim, who, amount, attacker, part, src)` [verified: `core/sim/damage.js:29`] is
already actor-addressed (`who: 'P' | botId`) and already routes death, counters, flinch and
regen through one function. On the host, PVP damage is *the same call* with a player id in
`who`. There is no second damage path, no "network damage" function, and no opportunity for
the two to drift. That single property removes an entire bug class that Last Circle spent
months on.

### 4.3 What the host validates on every input packet

The host treats every guest input as hostile until it passes:

| Check | Rule | Rejection |
|---|---|---|
| Rate | ≤ 65 commands/s sustained over 2 s (60 Hz + slack) | drop excess, log |
| Monotonic tick | `tick` strictly increasing; reject replays | drop |
| Tick lookahead | `tick ≤ hostTick + 6` (100 ms) | clamp |
| Movement | speed implied by consumed commands ≤ `MOVE.TAC` (7.3 m/s) × 1.1, or `SLIDE_ENTRY` (7.8) during a valid slide [verified: `core/sim/player.js:20,25`] | the host *never applies the guest's position at all* — it applies the guest's **commands** to its own sim, so speed is bounded by construction |
| Fire rate | weapon `rpm` from the weapon table; a fire edge inside the cooldown is ignored | drop the shot |
| Ammo / reload | host owns mag/reserve; a fire with `mag == 0` is a dry click | drop |
| Aim delta | yaw change > 25 rad/s sustained → flag (aim-snap heuristic) | flag only, never auto-kick |
| Shot origin | derived by the host from the host's own actor position, **never from the packet** | n/a — there is no origin field on the wire |

The structural point: **the input packet contains no position, no velocity, no hit claim, and
no damage number.** It contains buttons and a look direction. Everything else the host derives.
That is what makes host authority meaningful rather than ceremonial.

### 4.4 Exploits this opens — the honest list

| Exploit | Possible? | Why / mitigation |
|---|---|---|
| God mode / damage immunity | **No** (host) | Guests never write HP. This is the specific Last Circle hole we are closing. |
| Damage inflation ("I did 500") | **No** | No damage number on the wire; the host computes it from its own weapon table. |
| Teleport / speed hack | **No** | Host applies commands, not positions. Bounded by `MOVE` constants. |
| Fire-rate hack | **No** | Host owns the weapon state machine (`stepActorWeapon`). |
| **Aimbot** | **Yes** | Unfixable client-side. A perfect look direction is a legal input. Mitigation: the aim-delta flag (§4.3) plus a post-match report — headshot ratio, mean time-to-target-acquisition, snap-angle histogram — surfaced to the owner, never auto-enforced. |
| **Wallhack / radar** | **Yes, by default** | Snapshots contain every actor's position, so anyone with devtools sees through walls. **Mitigation (phase N5): relevancy culling.** The host omits actors that the receiving player cannot see and has not seen in the last 1 s, using the existing `world.losBlocked(a, b)` [verified: `_design/architecture.md:328`]. Cost at 8 humans + 4 bots: ≤66 pairs × 20 Hz = **1320 LOS raycasts/s** on the host, against a 3 ms sim budget — affordable, and it also *shrinks* snapshots. Caveat, stated because it always surprises people: culling makes audio and hit-feedback for unseen enemies harder, so keep a 1 s "recently seen" grace and never cull an actor who has damaged you in the last 2 s. |
| **Malicious host** | **Yes, totally** | The host can do anything. Mitigations: (1) ratings off until N6 (§4.5); (2) the guest runs a *shadow* copy of the sim and counts gross contradictions — damage with no line of sight, HP changes with no attacker, a kill credited to a player who never fired — and shows "session integrity: N anomalies" in the debrief; (3) N6 removes the hole entirely. |
| Lag switch / deliberate packet loss | **Partly** | Loss makes you *harder to hit* (your snapshots stop updating and remotes freeze you). Mitigation: freeze an actor after 100 ms of extrapolation (§3.5) but **keep it damageable at its last position**, and drop a player whose input gap exceeds 3 s to a bot (§5.3). |
| Forged room/start packets | **No** | `chromanet.js` already enforces "snapshots and match events are the host's word" [verified: `chromanet.js:29-33`]; the same `hostId` check applies. |

### 4.5 Ratings — the recommendation

`ffg_ratings.js` exists and writes real Elo through a `SECURITY DEFINER` RPC
[verified: `pipeline/engine/runtime/net/ffg_ratings.js:1-9`]. **Do not wire Blackridge PVP into
it in phases N1–N5.** In a host-authoritative topology where the host is a player, a rated ladder
is a ladder that rewards hosting. Options, with a pick:

- **Recommended:** PVP is **unranked** through N5. The debrief shows per-match stats and the
  portal shows "matches played", nothing Elo-shaped. Revisit at N6.
- Alternative if the owner wants a ladder sooner: rate only matches where **no participant was
  the host** — impossible in this topology — or rate with a "host played" flag and exclude those
  rows from leaderboards, which is a database complication for a mode with no players yet.

Also worth naming as an out-of-scope finding: `ffg_ratings.js` also documents that "Ratings ONLY
change from online games vs another logged-in player… vs-AI never reports". Bot-backfilled PVP
matches (§5.4) are partly vs-AI, which is a second, independent reason the rating question is
not as simple as calling the RPC.

---

## 5. FALLBACK + SCALE

### 5.1 Packet loss

DataChannels are unreliable by design [verified: `ffg_rtc.js:20-23`], so loss is the normal
case, not an error:

- **Lost snapshot:** the next one supersedes it 50 ms later; interpolation covers the gap
  because the buffer is 100 ms ≥ 2 intervals. Invisible below ~10% loss.
- **Lost input packet:** covered by the 4-command redundancy (§3.1). Three consecutive losses
  (rare) leave the host with a gap; the host **repeats the last received command** for up to 6
  ticks, then applies `NULL_CMD` [verified: exists at `core/sim/sim.js:36-40`] — i.e. the player
  coasts to a stop rather than continuing to sprint into a wall.
- **Sustained >15% loss:** the client shows a link warning and the interp buffer grows toward
  its 250 ms cap. No mode change.
- **Never retransmit state.** Verbatim from the precedent: "retransmitting stale state is worse
  than dropping it" [verified: `ffg_rtc.js:21-23`].

### 5.2 Host disconnect and host migration

Last Circle already solved the *degradation* half and its solution is directly reusable —
`hostLost(W)` converts every remote actor to a bot and continues the match offline, with the
rationale quoted here because it is the right instinct [verified: `royale/net.js:561-565`]:

> "The host is gone (clean bye, crash, or dead socket): convert the match to a LOCAL
> CONTINUATION rather than stranding the guest in a frozen world."

For Blackridge PVP, three tiers, in order of ambition:

1. **N1–N4 — end the match honestly.** Host loss (8 s of silence, per Last Circle's watchdog
   [verified: `royale/net.js:707-715`]) → all guests show "Host disconnected — match ended",
   the partial scoreboard, and no result is recorded. This is worse UX than migration and
   *far* better than a silently-wrong match. Ship this first.
2. **N5 — host migration.** Possible precisely because the sim is deterministic and every guest
   already holds a recent authoritative snapshot. Procedure: on host loss, the surviving peers
   sort by peer id (the existing deterministic rule); the lowest becomes host; it promotes its
   most recent snapshot to authoritative, spawns bot brains for any actor it cannot attribute,
   re-broadcasts `start:migrated` with its tick, and every other guest re-baselines. **Cost:
   a visible 1–2 s hitch and up to 250 ms of lost history.** Score and objectives survive
   because they are in the snapshot; in-flight projectiles do not, and that is acceptable.
3. **N6 — not applicable.** With a referee there is no host to migrate.

### 5.3 Guest disconnect → bot backfill

This is where Blackridge is *better positioned than any other FFG game*, because the bots are
not an afterthought: the sim already spawns, steers and fires them through the player's own
weapon code paths, with a full fairness model (300–800 ms reaction, ≤2 fire tokens,
muzzle-block raycast) [verified: `_design/combat_spec.md:6-10`].

Mechanism, following Last Circle's `bye` → `takeover` handshake [verified: `royale/net.js:461-482`]:

- Guest input silent for **3 s** → the host attaches an AI brain to that actor. The body keeps
  fighting; the scoreboard marks it `[BOT]`.
- The disconnected player reconnecting within **60 s** reclaims the actor (host detaches the
  brain, re-associates the peer id).
- Bot-backfilled actors are **excluded from any post-match stat that could feed a rating**.

**How backfill interacts with the net model — three specific effects:**

1. **Bots cost nothing extra on the wire.** They are already in the host's sim and already in
   every snapshot; a bot and a remote human are the *same 12-byte record*. Swapping one for the
   other changes zero bytes. (Contrast Last Circle, where bots needed a whole separate `bots`
   stream before the envelope merge.)
2. **Bots cost host CPU, and the budget is already tight.** `BUILD_PLAN` §5.2 allows "AI share
   ≤ 1.5 ms (≤4 brains think/tick, 12 bots max)". A 6v6 with 8 humans + 4 backfill bots is
   within it. **A 6v6 that mass-disconnects into 12 bots is not tested by anything today** and
   must be a probe in N5.
3. **Bots make the lobby always full**, which is the difference between a mode that is playable
   at launch and a mode nobody can find a game in. Chroma Hide made the same call: "empty slots
   are host-simulated bots so a lobby always feels full" [verified: `chromanet.js:6-7`].
   Blackridge should ship PVP with bot-fill **on by default** and a lobby toggle.

### 5.4 The Supabase fallback mode

When a guest has no DataChannel (NAT failure, WebRTC blocked by policy/extension), that guest
rides Supabase and the whole room reduces rates for it — the host sends **that guest** snapshots
at the Last Circle ladder [verified: `royale/net.js:645`]: 12 Hz at 2 humans, 8 Hz at 3, 5 Hz at
4+, with the interp buffer widened to `2 × interval` accordingly (167/250/400 ms). Input from
that guest drops to 10 Hz with 8-command redundancy.

**Hard rule inherited verbatim from the precedent:** "any RTC failure is byte-identical to the
pre-RTC behaviour" [verified: `ffg_rtc.js:11-12`]. The fallback is not a special mode with its
own code; it is the same protocol on a slower pipe.

**Hard cap:** if more than 3 guests are on the Supabase fallback simultaneously, the host stops
admitting players and the lobby says "network capacity reached". Better an honest small lobby
than a mid-match mass disconnect from a rate breach — which is Realtime's documented
over-rate behaviour [verified: `royale/net.js:123-129`].

### 5.5 Maximum realistic player count

| Path | Max humans | Binding constraint |
|---|---|---|
| Supabase-only (fallback for everyone) | **4** | The measured, shipped `MAX_GUESTS = 3` [verified: `royale/net.js:314`], O(H²) billing, 100 msg/s ceiling |
| RTC star + host-authoritative, **target** | **8** (4v4) | Host uplink 7 × 3.0 KB/s ≈ **21 KB/s**; host CPU for 8 humans + 4 bots inside the 3 ms budget |
| RTC star, **stretch** | **12** (6v6) | Host uplink 11 × 3.0 KB/s ≈ **33 KB/s** sustained — fine on cable/fibre, **marginal on many home uplinks**, and one bad host degrades everyone |
| With an N6 referee | **12–16** | Server uplink instead of a player's; CPU and cost become the constraint |

**Design target: 4v4 (8 humans) as the shipping mode; 6v6 gated behind a measured host-uplink
check.** The map supports it — playable bounds are X,Z ∈ [−60,+60], i.e. 120 × 120 m
[verified: `_design/level_design.md:39`], which is a *campaign* space; PVP arenas carved from it
will be smaller and 4v4 is the right density for a carve of that size. That sizing conversation
belongs to the map document; the netcode's answer is simply that **8 is comfortable, 12 is a
stretch, and anything above 12 needs option (c)**.

---

## 6. PHASED PLAN

Doctrine §5 governs every gate: "Done = observed effect in the LIVE system. Compiles/probe-passes
are proxies" [verified: `pipeline/knowledge/GAME_DOCTRINE.md` §5]. Every phase below therefore
names a **measured** acceptance test and the number it must produce. No phase is done because
code exists.

### 6.0 Two prerequisites that block phase N1

**(a) The sim refactor (§7).** Non-negotiable and larger than the netcode.

**(b) A two-client harness that does not lie.** There is none today: I checked every Playwright
harness in the repo for multi-client capability and found that only five files anywhere open two
pages at all (`games/driftwake/_harness/qa_flee.py`, two driftwake review scripts,
`pipeline/qa/boss_bot.py`, `pipeline/qa/playtest_bot.py`) and **none of them drives two clients of
one networked match**. Blackridge's own harness — `bootcheck.py`, `playprobe.py`, `perfprobe.py`,
`shotbattery.py`, `deployverify.py` — is entirely single-client [verified: read this session].
So `_harness/netprobe.py` is new work, specified in §6.4.

### 6.1 The phases

---

**N0 — Protocol + loopback, in Node. No browser, no Supabase, no rendering.**

Build: `core/net/protocol.js` (pure pack/unpack, §3.2), `core/net/loopback.js` (LoopbackHub,
copied in spirit from `games/chroma-hide/runtime/net/loopback.js`), a fake link with
configurable latency/jitter/loss, and `core/net/net.selftest.cjs`.

*Measured acceptance:*
1. Round-trip every field of a randomized 12-actor snapshot 100,000 times; assert position error
   ≤ 1 cm, yaw error ≤ 1.4°, and **zero** flag/HP/weapon corruption.
2. Two `createSim()` instances, host + guest, 10,000 ticks of scripted input, ideal link:
   **state hashes identical at every 60th tick.**
3. Same run at 50/100/200 ms latency, 20 ms jitter, 2% loss: guest's **reconciled local-actor
   position error p95 ≤ 5 cm, max ≤ 25 cm**, and reconciliation replay cost **p99 ≤ 1.0 ms**.
4. Exit code 0; run it in CI alongside `sim.selftest.cjs`.

*Why this is first:* it is the cheapest place to find 80% of the bugs, it needs no network, and
it produces the number (replay cost) that decides whether §3.4 is viable at all.

---

**N1 — 2-player deathmatch, one carved arena, host-authoritative, NO prediction.**

Deliberately ugly: the guest renders its own actor from snapshots, so its own movement lags by
its ping. This isolates transport + authority from prediction.

Build: `core/net/session.js` (star topology over `NetPlay` + `RTCMesh`), lobby (create/join code,
reusing the existing overlay patterns), host snapshot loop at 20 Hz, guest input at 30 Hz, kill
feed, match end, `?room=CODE` deep link (Last Circle's invite pattern
[verified: `royale/net.js:103-111`]).

*Measured acceptance — the two-client test:*
1. `netprobe.py --clients 2` (§6.4): both clients boot green, join the same room, match starts.
2. **Guest kills host and host kills guest**, each confirmed on BOTH clients: `sim.counters.kills`
   increments on the host, and the guest's HUD kill feed shows the same row. (This is the
   `playprobe.py` parity discipline — "HUD hitmarker count == sim `shotsHit`" [verified:
   `BUILD_PLAN.md` §5.4] — applied across clients.)
3. **Both clients' scoreboards agree at match end.** Any disagreement = fail.
4. **Measured and reported, not asserted:** median and p95 RTT, snapshot inter-arrival p95,
   billed Supabase msg/s (must be < 20 with RTC up), bytes/s each way. **These are the first real
   numbers against this transport and they replace every estimate in this document (§1.4).**
5. Zero page errors on either client; `__FFG_FALLBACKS__` empty on both (ship blocker, [verified:
   `BUILD_PLAN.md` §5.8]).

---

**N2 — Client-side prediction + reconciliation.**

Build: the §3.4 ring buffers, `stepLocalActor`, the correction blend, the HUD net readout
(ping / sync / buffer).

*Measured acceptance:*
1. `netprobe.py --latency 100` — guest's **own** actor position on screen matches its input with
   no perceptible lag: assert **predicted-vs-authoritative p95 error ≤ 5 cm** over a 60 s scripted
   run, sampled from the in-page test surface.
2. **Mispredictions/minute ≤ 6** at 100 ms / 2% loss (counter exposed on `__FPS__.__test`).
3. **Zero hard snaps** (>1.5 m corrections) in 60 s of legal movement including slides, mantles
   and jumps — the verbs bots don't have (§7) are precisely where prediction breaks first, so the
   scripted run must include all three.
4. Frame budget holds: `perfprobe.py` p99 ≤ 33.3 ms **on the guest with the net loop running**
   [verified gate: `BUILD_PLAN.md` §5.2].

---

**N3 — Entity interpolation + lag-compensated hit registration.**

Build: §3.5 interpolation, the 500 ms rewind ring, `rewindMs` clamp, the rewind histogram.

*Measured acceptance:*
1. **Hit-rate parity test.** Scripted: a strafing target at 20 m, 200 Warden shots fired with the
   crosshair pinned on the target's rendered capsule. Offline baseline hit rate `H0`. Online at
   50/100/200 ms: **hit rate ≥ 0.95 × H0 at 50 and 100 ms**, and the 200 ms number is *reported*,
   not asserted, because the rewind clamp legitimately costs hits there.
2. **Behind-cover measurement.** Scripted: the target runs to full cover; the shooter keeps
   firing. Count deaths occurring after the victim's own client shows it fully occluded, bucketed
   by `rewindMs`. **Report the distribution; assert only that no death exceeds the 250 ms clamp.**
   This is the number we hand anyone who says hit reg is broken.
3. Remote animation parity: a scripted remote actor crouch-walks, sprints, slides, reloads and
   dies; assert the observing client's rendered anim state matches the host's `bot.anim`/actor
   anim at ≥95% of sampled frames. (Directly targets the Last Circle failure quoted in §3.5.)

---

**N4 — RTC star transport hardened + Supabase fallback proven.**

Build: relevancy culling groundwork, the outbound budget (Last Circle's `sendBudgetLeft` shape),
link warnings, reconnect.

*Measured acceptance:*
1. **Kill the DataChannel mid-match** (close it from the test surface). The match **continues** on
   Supabase; assert no page error, no scoreboard divergence, and measure the rate drop
   (12 → 5 Hz ladder engaged).
2. **Never breach the ceiling:** across a 5-minute 4-player match, peak billed Supabase msg/s
   stays under `100/H` [verified rule: `royale/net.js:129-135`] with RTC down entirely.
3. Simulated 10% loss for 30 s: no desync, no crash, scoreboards still agree at end.

---

**N5 — 4v4, bot backfill, host migration, relevancy culling.**

*Measured acceptance:*
1. **8 clients** (§6.4 scales the harness) complete a full match; scoreboards agree on all 8.
2. Kill 3 guests mid-match: **bots take over within 3 s**, the match still ends, `stuckBotSeconds
   == 0` [verified bar: `BUILD_PLAN.md` §5.4].
3. **Kill the host mid-match:** migration completes in **≤ 2 s**, the score survives, the match
   ends normally on all surviving clients.
4. Host perf under full load: 8 humans + 4 bots, `perfprobe.py` on the host — **sim tick ≤ 3 ms,
   AI ≤ 1.5 ms, p99 frame ≤ 33.3 ms** [verified budget: `BUILD_PLAN.md` §5.2].
5. Relevancy culling on: assert a guest's snapshot contains **no actor it has neither seen in the
   last 1 s nor been damaged by in the last 2 s**, and that hit rate from N3 is unchanged.

---

**N6 — (Optional, owner decision) Authoritative referee.**

First task of the phase, before any code: **verify current Cloudflare Durable Object pricing and
CPU accounting, and produce a measured cost-per-match** by running the existing
`core/sim/sim.selftest.cjs` workload in a DO. Do not design against a remembered price.

*Measured acceptance:* a match with **no player as host**; every N1–N5 acceptance test re-run and
passing against the referee; measured cost per 10-minute 8-player match; and only then, the
ratings conversation from §4.5.

### 6.2 What each phase adds, in one line each

| Phase | Adds | Without it |
|---|---|---|
| N0 | Wire format, loopback, state hash, measured replay cost | You debug netcode through a browser, at 100× the cost |
| N1 | Two humans can actually shoot each other, authoritatively | — |
| N2 | Your own movement feels local at any ping | The mode is unplayable above 60 ms |
| N3 | Your crosshair being on someone means a hit | Players correctly report "hit reg is broken" |
| N4 | Works on real networks, degrades instead of dying | Random mid-match mass disconnects |
| N5 | A mode with enough players to be fun | A 1v1 tech demo |
| N6 | Fairness and a meaningful ladder | Host advantage forever, no ratings |

### 6.3 STOP rule

`BUILD_PLAN` §5.6's plateau rule applies unchanged: two consecutive iterations with no
improvement in the phase's measured numbers → **stop, escalate to the owner through the session
outbox** (Telegram is automations-only) with the trend table and an honest assessment. Netcode has
an especially seductive failure mode — endless smoothing constants that make a graph prettier
without making the game better. The gate is the *measured* number in the phase's acceptance test,
not how it looks.

### 6.4 `_harness/netprobe.py` — the two-client test, and the rAF gotcha

The known FFG gotcha, and it is not folklore — it is documented in shipped code
[verified: `royale/net.js:539-541`]:

> "The >3 s escape hatch covers a BACKGROUNDED TAB — rAF throttles to ~1 Hz while
> ffg_royale3d.js:364 caps each step at Math.min(dt, 0.05), so that clock falls behind without
> bound and could never slew back."

**A backgrounded or occluded Playwright page does not run `requestAnimationFrame`, so it does not
step its sim, so it does not send input, so it does not receive — and the harness sees a dead
client and reports a broken netcode that is fine.** Blackridge's memory index records the same
lesson from the preview launcher: "hidden Browser pane = no rAF = false 'broken'".

Three defences, all required:

1. **Launch flags.** Blackridge's harness `FLAGS` today are
   `["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
   "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]`
   [verified: `_harness/bootcheck.py`, `_harness/playprobe.py`]. `netprobe.py` must add
   **`--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`,
   `--disable-renderer-backgrounding`**. The existing `CalculateNativeWinOcclusion` flag covers
   only part of the problem (Windows occlusion detection), not renderer backgrounding.
2. **Separate browser *contexts*, and windowed positions.** Two contexts (not two tabs in one
   window — one is always hidden), each launched headed with an explicit `--window-position` so
   both are genuinely on screen side by side. Headless also works and is preferred for CI, but
   the flags above are still required.
3. **Prefer the synchronous step path for determinism.** `boot.js` exposes
   `ctx.stepFrames = stepFrames` [verified: `runtime/boot.js:382`], whose whole reason for
   existing is stated in the file: "hidden tabs have no rAF; without this every automated check
   sees a dead game" [verified: `runtime/boot.js:301-303`]. For the *deterministic* assertions
   (N0-style checks run in-page), the probe drives both clients with `stepFrames(n)` and pumps
   the network between batches. For the *timing* assertions (RTT, jitter, interp), it must use the
   real rAF loop with the flags above — because `stepFrames` changes the timing being measured.

    **Both modes are needed and they measure different things. A netprobe that only uses
    `stepFrames` will report perfect netcode on a link it never exercised.**

Skeleton of the probe's contract, so it is unambiguous:

```
netprobe.py --clients N --latency MS --loss PCT --seconds S --url ...
  → boots N contexts, asserts READY_EXPR on each
  → client 0 creates the room; 1..N-1 join by code
  → drives each client via __FPS__.__test (autoplay personas already exist:
    rusher / optimal / novice / camper [verified: _harness/personas.js])
  → collects per-client: counters, scoreboard, net stats, console errors
  → exits 0 iff every client's scoreboard agrees AND every phase assertion holds
  → prints one JSON row per client, then a verdict table (playprobe.py's format)
```

Reuse `playprobe.py`'s existing autoplay personas as the PVP drivers — they already dispatch real
`KeyboardEvent`/`MouseEvent` through the input layer [verified: `_harness/playprobe.py` docstring],
which is the doctrine requirement ("instrument the real path, not a proxy").

---

## 7. THE REFACTOR THIS ALL DEPENDS ON (freeze-amendment requests to A0)

Stated separately because it is the honest bottom line: **the networking is the smaller half of
this project.** The sim as built has one player and N simplified bots.

**Evidence.** `stepPlayer(state, cmd, world, weapons, dt, sim)` opens with `const p = state.player;`
[verified: `core/sim/player.js:72-73`] — it is hard-bound to the singleton. `stepBotLocomotion`
[verified: `core/sim/player.js:587-617`] handles yaw, stance, accel/decel, gravity and
`moveCapsule` — and **nothing else**: no slide, no mantle, no jump, no tac-sprint, no air control,
no coyote time, no input buffering. Those are exactly the verbs `BUILD_PLAN` R7 shipped as the
game's signature ("slide — 'the MW2019 signature verb'"). A remote human driven through the bot
path would be a human who cannot slide, mantle or jump. **Remote players must run the player
path.**

| # | Change | Why | Freeze impact |
|---|---|---|---|
| N-R1 | Generalize `stepPlayer` → `stepActor(sim, actor, cmd, dt)`; `state.player` becomes `actors[0]` or keeps an alias | Remote humans need the full verb set | **Amends `sim.state` shape (architecture §3.5.1)** — the big one |
| N-R2 | `state.players[]` alongside `state.bots[]`, or one unified `actors[]` with a `kind` field | PVP has N humans | Same amendment |
| N-R3 | Per-shot RNG: `mulberry32(hash(seed, shooterId, shotSeq))` for spread | §3.7 item 6 — otherwise predicted tracers lie | Amends `core/rng.js` contract; **must be verified not to change single-player TTK/spread probe results** |
| N-R4 | `stepActorWeapon` emits view events for **all** local-visible actors, not only `isP` | `if (isP) sim.emit("ads", …)` [verified: `core/sim/player.js:433`] — remote players would be silent | Additive; no new event types |
| N-R5 | `stepLocalActor(sim, actor, cmd, dt)` — movement + weapon only, no AI/mission | §3.4 — full `sim.step` replay blows the frame budget | Additive export |
| N-R6 | Cheap fixed-size snapshot/restore for the rewind + prediction rings | `sim.snapshot()` is `JSON.parse(JSON.stringify(state))` [verified: `core/sim/sim.js:182`] — unusable at 20 Hz against the "0 allocations" budget | Additive |
| N-R7 | `damage.applyDamage` `who` accepts player ids | Already actor-addressed; mostly free | Additive |
| N-R8 | Blackridge vendors `core/net/ffg_netplay.js` with its own `eventsPerSecond` | §1.4 — 14 copies, editing the master hits 13 other games | New file |
| N-R9 | Mode split: `mission.js` is campaign-only; PVP gets `core/sim/modes/dm.js`, `tdm.js` | `sim.step` calls `sim.mission.tick(sim)` unconditionally when not in menu [verified: `core/sim/sim.js:174`] | Additive; `phase` enum gains PVP states — **amends §3.5.1's phase list** |

**N-R1/N-R2 are a genuine `sim.state` freeze amendment and must go to A0 before any netcode is
written**, because every consumer of the frozen shape — HUD, soldiers, bridge, all the probes,
`sim.selftest.cjs` — reads `state.player` and `state.bots`. The compatibility-preserving option is
to keep `state.player` as a **live alias** of `state.actors[myIndex]` so single-player and every
existing probe are untouched. That is the recommended shape, and the acceptance test for the
refactor is simply: **every existing selftest and probe passes unchanged, with zero edits**, before
one line of network code lands.

---

## 8. RULES THIS DOCUMENT BINDS ITSELF TO

1. **Every rate in this document is a hypothesis.** 20 Hz, 30 Hz, 100 ms buffer, 250 ms rewind cap
   — all are *starting values from precedent*, not measurements. N1's acceptance test produces the
   first real numbers on this transport and this document gets rewritten against them. §1.4 is why:
   the codebase's own capacity estimates were ~2× wrong for the entire shipped life of Last Circle.
2. **No phase is done because code exists.** Done = the measured number in that phase's acceptance
   test, observed on two or more live clients (doctrine §5).
3. **Verdicts never round up.** A phase that hits 4 of 5 acceptance criteria is reported as
   partial, with the failing number printed.
4. **Anything that changes the frozen sim shape goes to A0 first** — §7, not a side effect of a
   netcode commit.
5. **Do not copy client-authoritative damage.** §1.6. If a future agent finds `hitYou` convenient,
   this line is the reason it was rejected on purpose.

---

## 9. OPEN QUESTIONS FOR THE OWNER

1. **Ratings.** Recommendation: unranked through N5 (§4.5). Confirm, or accept a host-flagged
   ladder.
2. **Target player count.** Recommendation: **4v4 (8 humans)** as the shipping mode, 6v6 behind a
   measured host-uplink check (§5.5). 6v6 makes one player's home upload the mode's ceiling.
3. **Phase N6 (referee) — is a paid Cloudflare Workers plan on the table at all?** If never, then
   host advantage and an unranked mode are permanent design facts and the marketing copy must say
   "play with friends", not "competitive". (Doctrine §6: "Store copy is a CONTRACT: never advertise
   a mode that does not exist in the code".)
4. **TURN server.** No budget assumed; without it, a small percentage of players ride the slow
   Supabase fallback permanently. Acceptable? (Recommendation: yes, ship without TURN, measure the
   fallback rate in N4, revisit only if it exceeds ~10%.)
5. **Sequencing against the campaign expansion.** The §7 refactor touches `sim/player.js`,
   `sim/sim.js` and `core/rng.js` — the same files a multi-environment campaign expansion will
   touch. Doing both concurrently on one branch is how the "two agents, one frozen file" failures
   happen. Recommendation: **land N-R1…N-R7 first, verify every existing probe passes unchanged,
   then fan out.**
