# Grid Rush — Online Multiplayer Spec

**Status:** design / implementation-ready. No game code changed by this doc.
**Author target:** the engineer wiring MP into `game.js` / `index.html` / `config.js`
(which are being edited in parallel — this spec only *proposes* the hook points).

---

## 0. TL;DR

- **Transport:** reuse the shared FFG relay — vendor `runtime/net/ffg_netplay.js`
  (the `NetPlay` class) verbatim from any existing game. Supabase Realtime
  Broadcast + Presence, pure WebSocket, **$0** (never touches Postgres). Same
  Supabase project + anon key every FFG game already uses.
- **Pattern to copy:** **Last Circle** (`games/last-circle/runtime/3d/royale/net.js`)
  — a real-time, owner-authority, deterministic-world, bots-fill-empty-slots
  model. **Cosmic Coils** (`games/cosmic-coils/runtime/net/coilnet.js`) is the
  same model with drop-in join + host migration and is the secondary reference.
  Grid Rush is a racer, which is structurally identical: each human simulates
  **its own kart**, the host simulates the **AI karts**, everyone renders the
  rest by interpolating broadcast state.
- **Field:** the local field never changes shape — always `1 + RIVAL_COUNT` = **6
  karts**. In online, up to 6 humans claim slots; every unclaimed slot stays the
  existing AI. So "6 racers, empty slots filled by AI" is already the native
  layout; MP just reassigns *ownership* of the 6 slots.
- **Determinism:** the whole track (centerline, checkpoints, item-pad layout,
  hazard placement, scenery) is built from `TRACKS[trackId].seed` via
  `mulberry32` in `track.js` — **identical on every client** as long as everyone
  builds the same `trackId`. Nothing about the static world is synced. Only live
  kart state, item-pad depletion, gadget events, and the race clock cross the wire.

### Top 5 integration steps for Grid Rush

1. **Vendor the relay + add a wrapper.** Copy `ffg_netplay.js` into
   `games/grid-rush/runtime/net/ffg_netplay.js` unchanged. Add
   `games/grid-rush/runtime/net/gridnet.js` (the Grid-Rush session: roster, slot
   assignment, state pack/unpack, interpolation) and
   `games/grid-rush/runtime/net/online-mode.js` (the `OnlineMode` object that
   implements the mode-registry contract).
2. **Add a single `this.mode` slot to the game + 8 one-line hook calls** in
   `game.js` (listed in §4). Default local play = `this.mode` stays `null`, so
   every hook is a no-op `?.()` — zero behavior change offline.
3. **Guard the local sim against remote-owned karts** (§4.2): `updateAI` skips
   `netRemote` karts; the per-racer checkpoint/item/hazard loop skips
   `netRemote` karts; the mine `onHit` callback only applies to owned karts.
   `OnlineMode.update()` interpolates the remote karts instead.
4. **Add the lobby UI + "PLAY ONLINE" button** to `index.html`'s menu (§7) and a
   `#btn-online` handler in `bindUI`. The lobby (quick-match / create / join code)
   picks the shared `trackId`, exchanges the roster, then calls `startRace()` with
   `this.mode` already set to a configured `OnlineMode`.
5. **Broadcast own kart @15 Hz, host broadcasts bots @12 Hz, item-pad + gadget +
   finish as discrete events** (§5–§6); interpolate remote karts toward their last
   packet each frame (§8). Verify with two browser tabs / two-tab quick-match.

---

## 1. The shared relay (`ffg_netplay.js`) — API reference

Path in any existing game: `runtime/net/ffg_netplay.js`
(e.g. `games/last-circle/runtime/net/ffg_netplay.js`,
`games/cosmic-coils/runtime/net/ffg_netplay.js` — byte-identical copies).

Same backend across **all** FFG games (verified — grep of every `net/*.js`):

```
SUPABASE_URL      = "https://wugoxdewcdxzfppgzohy.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS",
                    "ref":"wugoxdewcdxzfppgzohy","role":"anon",exp 2069  (full key in coilnet.js)
```

`NetPlay` is a game-agnostic room/lobby transport. It does **not** know about
karts — you layer your schema on top of `send()` / `on("msg")`.

```js
import { NetPlay } from "./ffg_netplay.js";

const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "grid-rush");
// gameId "grid-rush" namespaces the channels: ffg:grid-rush:<CODE> and ffg-lobby:grid-rush

net.on("open",  ({ room, host }) => {})   // channel subscribed; host = am I the deterministic host?
   .on("peer",  ({ present, count }) => {})// presence changed; count = peers in room
   .on("msg",   ({ from, t, d }) => {})    // a broadcast game message: type t, data d, sender peer-id
   .on("matched",({ room, host }) => {})   // quick-match paired us into a room
   .on("timeout",() => {})                 // quick-match found nobody
   .on("error", ({ status }) => {});

await net.connect();                       // lazy-loads supabase-js from esm.sh (only when going online)
await net.quickMatch(timeoutMs);           // presence-lobby auto-pair (2 lowest peer-ids); resolves {room,host}|null
await net.joinRoom("ABCD", asHostOrNull);  // private room by code; asHost=null → lowest id becomes host
net.send("st", { ... });                   // broadcast a message to the room (self excluded)
net.isHost();                              // deterministic host = lowest peer id present
net.id;                                    // this peer's sortable unique id (Date.now()+rand, base36)
net.room;                                  // current room code
net.leave();                               // remove channels
```

Key transport facts that shape our design:

- **Broadcast is fire-and-forget, `self:false`** — a sender never receives its own
  messages, and there's **no delivery ack / no ordering guarantee**. Design for
  lossy, unordered packets (state is periodic + idempotent; events are
  self-contained + idempotent).
- **Presence gives connect/disconnect**, and `count`. `host` is deterministic:
  lowest peer id present. Grid Rush uses **dynamic host = lowest id currently
  present** (like Cosmic Coils' `isHost()`), so host migration is automatic.
- **`eventsPerSecond` is 30** (hardcoded in the client). Our outbound budget:
  host = own-state 15 Hz + bot-batch 12 Hz + occasional events ≈ 27–30/s; guests
  = own-state 15 Hz. Batch bots into **one** `bots` message per tick (a list), the
  way Last Circle / Cosmic Coils do — never one message per bot.
- **`TurnClock`** (also exported) is for turn-based games; **not used** by Grid Rush.

---

## 2. Authority model

Grid Rush is **owner-authoritative with a host referee** — the exact split Last
Circle uses:

| Concern | Authority | Rationale |
|---|---|---|
| A human's own kart (pos/yaw/vel/lap/turbine/gadget held) | that human's client | you always simulate your own kart at full local fidelity; no input lag |
| The 5 (or fewer) AI karts | **host** (lowest peer id) | one brain drives the bots; guests render host snapshots |
| Item-pad depletion + the rolled gadget | the kart's **owner** (whoever touches it) | avoids double-roll disagreement; owner rolls once and broadcasts the result |
| Offensive gadget → stun on a target | the **victim's** owner | mirror Last Circle `hitYou`: attacker names the victim + effect, victim applies it to itself |
| World gadget entities (pulse mine, gravity well) | **spawner** broadcasts spawn; **victim** decides the hit | deterministic spawn params; the kart that clips a mine pops it |
| Race clock (`raceTime`) | **host** (periodic `sync`) | keeps finish times comparable across clients |
| Final standings | **host** publishes an authoritative `results` order | one source of truth once the field is in |

Guiding principle (from Last Circle/Cosmic Coils): **never let a packet drive a
kart you own**, and **never locally mutate a kart you don't own in a way the wire
doesn't correct**. Local mutation of a remote kart (e.g. `resolveCollisions`
nudging an interpolated kart, or `useItem` calling `applyStun` on a remote target)
is *cosmetically harmless* because the next interpolation packet overwrites it —
but the *authoritative* effect must always travel as a message to the owner.

There is **no rollback and no server reconciliation** — this is casual arcade
racing, not competitive netcode. Smoothing + periodic authoritative correction is
enough (and is what every shipped FFG MP game does).

---

## 3. Ownership, slots & the roster

- The field is always **6 slots, `slot = 0..5`**, matching the grid index
  `startRace()` already assigns (`placeOnGrid(racer, index, total)`), so **slot ==
  grid index == start position**. Add `racer.slot` (set it to the grid index in
  `startRace`; see §4.1).
- **Roster** (agreed in the lobby, carried in the `start` message):
  ```
  roster: [ { peer:<peerId>, slot:0..5, name:"CALLSIGN", vehicleId:"prism" }, ... ]  // humans only
  cfg:    { seed:<uint32>, trackId:"prism_boulevard" }
  ```
- **Slot → role resolution** (identical computation on every client):
  - slot present in roster → **human**. If `roster[i].peer === net.id` → **local
    player** (`isPlayer=true, netRemote=false`, `game.player = this racer`), else
    **remote human** (`isPlayer=false, netRemote=true`).
  - slot absent → **AI bot**. `netRemote = !net.isHost()` (host owns/simulates it;
    guests render it as remote). Bots keep the deterministic vehicle/name/skill
    `startRace` already gave them.
- **Global addressing = `slot`.** Every wire message keys karts by `slot`, never by
  the local `id` string ("local"/"bot-0"), because those aren't shared. Keep the
  local `id` for internal ranking; add `slot` for the wire.
- **`cfg.seed`** is broadcast for future non-track randomness (e.g. a shared item
  RNG). The track itself needs only `trackId` (its seed lives in `TRACKS`). Bots'
  vehicle/name/skill are already deterministic functions of slot in `startRace`, so
  they match on every client without syncing.

---

## 4. Mode-registry contract + exact hook points in `game.js`

The mode registry is a **single active mode object** on the game:
`this.mode` (default `null` = offline local race). All hooks are optional and
called defensively (`this.mode?.hook?.(...)`), so offline behavior is byte-for-byte
unchanged. `OnlineMode` (in `runtime/net/online-mode.js`) implements them.

### 4.1 The 8 hook points (function name → what to add)

Line numbers reference the current `game.js` you shared.

| # | Location | Add | Purpose |
|---|---|---|---|
| H1 | **constructor**, near `this.phase = 'menu';` (≈L110) | `this.mode = null;` | the registry slot |
| H2 | **`startRace()`**, inside the rival loop after `this.racers.push(r)` and player push — set `player.slot = 0;` and `r.slot = i + 1;` | give every racer a `slot` | global wire id |
| H3 | **`startRace()`**, right **before** `this.phase = 'countdown';` (≈L540) | `this.mode?.setup?.(this);` | remap ownership per roster, swap human meshes, init net |
| H4 | **`update()`**, in the `racing/finished` branch **after** `this.updateAI(dt);` and **before** `this.resolveCollisions();` (≈L690) | `this.mode?.update?.(this, dt);` | interpolate remote karts + broadcast own/bot state |
| H5 | **`update()`**, the per-racer loop (≈L692): change `if (!r.finished) {` → `if (!r.finished && !r.netRemote) {` | skip checkpoints/pads/hazards/unstick for remote karts; keep `else this.syncMesh(r)` | remote karts are driven by interpolation, not local sim |
| H6 | **`updateAI()`**, the guard (≈L767): `if (r.isPlayer \|\| r.finished) continue;` → add `\|\| r.netRemote` | host drives only its own bots; guests never AI-drive a remote bot | |
| H7 | **`checkCheckpoints()`**, right after `this.finishedOrder.push(r.id)` on finish (≈L1081) | `this.mode?.onRacerFinish?.(this, r);` | owner broadcasts its finish time |
| H8a | **`checkItemPads()`**, after `r.item = rollItem(...)` before `break` (≈L1106) | `this.mode?.onItemPickup?.(this, r, pad);` | owner broadcasts pad-down + rolled item |
| H8b | **`tryUseItem()`**, after the `for (const ev of result.events)` loop (≈L1221) | `this.mode?.onGadgetUse?.(this, racer, result);` | broadcast gadget spawn/target so remotes replay it |
| H8c | **`updateHud()`**, at the end (≈L1318) | `this.mode?.hudExtra?.(this);` | render room code / player count / net status |
| H8d | **`update()`**, replace the `_raceOver` test (≈L724-728) | see snippet below | let the mode decide the end + adopt host standings |
| H8e | **`returnMenu()`** (≈L628) and/or **`clearRace()`** | `this.mode?.dispose?.(this); this.mode = null;` | leave the room + reset registry |
| H8f | the `itemWorld.update(dt, racers, onHit)` callback (≈L702) | at the top of the `onHit` closure: `if (this.mode && !this.mode.ownsRacer(this, r)) return;` | only an owned kart's mine hit counts locally |

> H2 note: `player.slot = 0` and `r.slot = i + 1` is the *offline* default; `setup()`
> re-points `this.player` to whichever slot the local human actually took, so slot 0
> is not necessarily the local player online.

H8d snippet (the finished-phase end test):

```js
if (this.phase === 'finished') {
  const over = this.mode?.checkEnd
    ? this.mode.checkEnd(this)
    : (this.finishedOrder.length >= this.racers.length ||
       this.raceTime - this.player.finishTime > 18);
  if (over) this._raceOver = true;
  this.refreshResults();
  if (this._raceOver) this.playing = false;
}
```

### 4.2 The mode contract (what `OnlineMode` implements)

```
mode.setup(game)                 // H3 — after field built, before countdown
mode.update(game, dt)            // H4 — every racing frame
mode.onRacerFinish(game, racer)  // H7 — a racer crossed the line
mode.hudExtra(game)              // H8c — draw net HUD chrome
mode.checkEnd(game) -> bool      // H8d — is the race over for this client?
// helpers the guards call:
mode.ownsRacer(game, racer) -> bool   // H8f — do I simulate this kart?
mode.onItemPickup(game, racer, pad)   // H8a — owner broadcasts pad+item
mode.onGadgetUse(game, racer, result) // H8b — broadcast gadget event
mode.dispose(game)               // H8e — leave room, tear down
```

`ownsRacer(game, r)` = `!r.netRemote` (local player + host's bots return true;
remote humans + guest-side bots return false). This one predicate backs H6, H5,
and H8f consistently.

Everything else offline still works because `game.mode` is `null` and every call
is `?.`-guarded.

---

## 5. Message schema

All messages are `net.send(t, d)` → arrive as `{ from, t, d }`. Keyed by `slot`.
Positions quantized to 2 decimals, yaw/velocity to 3 (same precision Last Circle
uses in `pack()`); flags packed into one integer bitfield to keep packets tiny.

### 5.1 Lobby / lifecycle

| `t` | dir | `d` | when |
|---|---|---|---|
| `hello` | any→room | `{ name, vehicleId, late?:1 }` | on join; announces presence + chosen chassis. `late:1` = mid-match join request |
| `lobby` | host→room | `{ list:[{peer,slot,name,vehicleId}] }` | host re-broadcasts slot assignments whenever the roster changes pre-start |
| `start` | host→room | `{ seed, trackId, roster:[{peer,slot,name,vehicleId}] }` | host launches; every client sets `game.trackId=trackId`, builds `OnlineMode(cfg,roster)`, calls `startRace()` |

### 5.2 In-race (hot path)

| `t` | rate | owner | `d` |
|---|---|---|---|
| `st` | 15 Hz | each human (own kart) | `{ s, x,y,z, yw, vx,vy,vz, tS, lap, cp, tb, fl, it }` |
| `bots` | 12 Hz | host only | `{ list: [[s,x,y,z,yw,vx,vy,vz,tS,lap,cp,tb,fl,it], ...] }` (all host-owned bots, one message) |
| `sync` | 0.7 Hz | host only | `{ t:<raceTime>, order:[slot...] }` — clock + live standings glue |

`st` / `bots` field legend:

```
s   slot (int)
x,y,z   position          (Number, 2dp)
yw      yaw               (Number, 3dp)
vx,vy,vz velocity         (Number, 2dp)  — for dead-reckoning between packets
tS      trackS (cumulative arc-length)   — authoritative lap-progress for ranking
lap     current lap (1..LAPS)
cp      cpIndex (checkpoint progress)
tb      turbine 0..100 (int)             — HUD/boost visual for remotes
it      held item id string or 0
fl      bitfield: 1 drifting · 2 airborne · 4 phasing · 8 veil · 16 overclock · 32 stunned
```

### 5.3 Events (discrete, idempotent)

| `t` | owner | `d` | effect on receiver |
|---|---|---|---|
| `pad` | pad-taker's owner | `{ s, pad, it }` | mark `track.itemPads[pad].alive=false` (+ respawn timer), set racer(slot=s).item=it |
| `gadd` | spawner | `{ kind:'pulse_mine'\|'gravity_well', x,y,z, owner:<slot>, eid }` | spawn the same world entity (deterministic id `eid`) via `itemWorld.spawnMine/Well` |
| `gpop` | victim | `{ eid }` | remove world entity `eid` everywhere (mine detonated) |
| `hit` | attacker | `{ s:<victimSlot>, kind, stun, kill, src:<attackerSlot> }` | victim's client applies `applyStun(victimRacer, stun, kill)` **to itself**; others play FX only |
| `fx` | actor | `{ kind:'lash'\|'emp'\|'warp'\|'veil'\|'phase'\|'overclock', from?, to?, x?,y?,z? }` | pure cosmetic replay (`fx.lashBolt`, `fx.empRing`, sparks) — no state change |
| `fin` | finisher's owner | `{ s, t:<finishTime> }` | set racer(slot=s).finished=true, finishTime=t, push to finishedOrder |
| `results` | host | `{ order:[{s,t}...] }` | authoritative final standings; clients reconcile finishTimes + order |
| `bye` | leaver | `{ s }` | host re-attaches a bot brain to slot s (see §9) |
| `takeover` | host | `{ s }` | slot s reverted to host-simulated bot; mark it remote on guests |
| `possess` | late joiner (via host `assign`) | `{ peer, s, name, vehicleId }` | slot s becomes a remote human on everyone else |

---

## 6. Item-pad rolls & gadgets over the wire

The tricky part of a Mario-Kart-style racer is that `useItem` (in `items.js`)
**mutates other racers directly** (`applyStun`, `steerInvert`, `item` theft) and
`rollItem` uses `Math.random()`. We do **not** edit `items.js`. Instead:

### 6.1 Item pads (`checkItemPads` → H8a)

Only the **owner** of a kart runs `checkItemPads` for it (guaranteed by H5: the
per-racer loop skips `netRemote`). So exactly one client rolls the item for a given
pickup. `onItemPickup(game, racer, pad)` then:

```js
onItemPickup(game, racer, pad) {
  if (!this.ownsRacer(game, racer)) return;           // belt-and-suspenders
  const padIdx = game.track.itemPads.indexOf(pad);
  this.sess.send("pad", { s: racer.slot, pad: padIdx, it: racer.item });
}
```

Receivers apply `pad` idempotently: set `itemPads[padIdx].alive=false`,
`.mesh.visible=false`, `.respawn=7` (matching `checkItemPads`), and
`racer(slot).item = it`. Because pads respawn on a deterministic 7s timer in
`track.update`, and re-pickups re-broadcast, drift self-heals. (A pad that a remote
kart grabbed will show as taken locally the instant its `pad` message lands — a
sub-100ms visual pop, acceptable for a pickup.)

### 6.2 Gadget use (`tryUseItem` → H8b)

`tryUseItem` already ran `useItem` locally and produced `result.events`. Locally
mutating a **remote** target via `applyStun` is harmless (overwritten by that
target's next `st` packet), but the *authoritative* stun must reach the victim's
owner. `onGadgetUse(game, racer, result)` translates the local effect into wire
events:

```js
onGadgetUse(game, racer, result) {
  if (!this.ownsRacer(game, racer)) return;
  const id = result.def.id, S = racer.slot;
  switch (id) {
    case 'pulse_mine': {
      const e = game.itemWorld.entities[game.itemWorld.entities.length - 1];  // just spawned
      this.sess.send("gadd", { kind:'pulse_mine', x:e.pos.x, y:e.pos.y, z:e.pos.z, owner:S, eid:this.nextEid() });
      break;
    }
    case 'gravity_well': {
      const e = game.itemWorld.entities[game.itemWorld.entities.length - 1];
      this.sess.send("gadd", { kind:'gravity_well', x:e.pos.x, y:e.pos.y, z:e.pos.z, owner:S, eid:this.nextEid() });
      break;
    }
    case 'volt_lash': {
      const to = result.events.find(e => e.kind === 'lash')?.to;   // useItem resolved the target
      const v = to && game.racers.find(r => r.id === to);
      if (v) this.sess.send("hit", { s:v.slot, kind:'lash', stun:1.1, kill:0.35, src:S });
      this.sess.send("fx", { kind:'lash', from:S, to:v?.slot });
      break;
    }
    case 'mirror_fog': {
      const t = result.events.find(e => /MIRROR FOG →/.test(e.text || ''));   // or re-derive target by ranking
      const v = this.aheadOf(game, racer);
      if (v) this.sess.send("hit", { s:v.slot, kind:'mirror', stun:0, kill:0, src:S, invert:3.5 });
      break;
    }
    case 'emp_bloom': {
      for (const o of game.racers)
        if (o.slot !== S && !o.finished && o.position.distanceTo(racer.position) < 22)
          this.sess.send("hit", { s:o.slot, kind:'emp', stun:1.35, kill:0.5, src:S });
      this.sess.send("fx", { kind:'emp', x:racer.position.x, y:racer.position.y, z:racer.position.z });
      break;
    }
    case 'data_siphon': {
      // steal already applied locally to racer.item; tell the victim its item was taken
      const stolenFrom = result.events.find(e => /SIPHONED/.test(e.text||''));
      // broadcast a `pad`-style clear to the victim so their HUD empties (find nearest holder same way useItem did)
      break;   // see note: siphon target must be recomputed exactly as items.js does, then send {t:'hit',kind:'siphon'}
    }
    case 'overclock': case 'phase_skate': case 'warp_anchor': case 'static_veil':
      // self-only: the `fl`/`it` fields in your next `st` packet already convey it; send an `fx` for the visual.
      this.sess.send("fx", { kind:id, from:S });
      break;
  }
}
```

Receiver handling of `hit`: **only if `s === mySlot` (or a bot I host)** do I call
`applyStun(myRacer, d.stun, d.kill)` / set `steerInvert`. If it's another slot I
merely play FX. This is the Last Circle `hitYou` rule verbatim ("the victim applies
damage to itself").

`gadd`/`gpop`: world entities carry a deterministic `eid` (e.g.
`` `${slot}_${gadgetCounter++}` ``) so every client's `itemWorld` holds the same
entity and `gpop{eid}` removes the right one. `itemWorld.spawnMine/Well` take
`(pos, ownerId)` — pass `ownerId = "slot:"+owner` so the "your own mine won't hit
you for 20s" rule keys off slot. The **victim** decides the mine hit: H8f gates
`onHit` so only an owned kart triggers it; the owned kart then broadcasts
`gpop{eid}` and applies its own stun (the `onHit` callback already calls
`applyStun` locally — good for the owner; add the `gpop` send in the mode by
having `onHit` route through `mode.onMineHit` or by reading `itemWorld` diffs).

> **Simplification option:** if per-gadget target re-derivation is fiddly, gate
> `useItem`'s cross-kart mutation behind ownership at the source instead — but that
> **would** require an `items.js` change (out of scope here). The event-translation
> approach above keeps `items.js` untouched, which is why it's the recommended path.

---

## 7. Lifecycle — lobby → start → race → finish

### 7.1 Menu wiring (`index.html` + `bindUI`)

Add to the launch panel in `index.html`, next to `#btn-start`:

```html
<button id="btn-online" class="mode-btn ghost" type="button">🛰 PLAY ONLINE</button>
```

In `bindUI()`:

```js
document.getElementById('btn-online')?.addEventListener('click', () => {
  this.sfx.resume();
  import('./net/online-mode.js').then(m => m.openOnlineLobby(this));  // lazy: no supabase-js unless online
});
```

`openOnlineLobby(game)` renders an overlay (copy the structure of Cosmic Coils'
`openLobby` / Last Circle's `openLobby` — a `QUICK MATCH` button, `CREATE ROOM`,
and a `JOIN [code]` field). It:

1. `const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, "grid-rush")`.
2. **Quick match:** `await net.quickMatch(8000)`; on `matched`, fall into the room
   view. On `timeout`, offer create/join. **Create:** `net.joinRoom(randCode(), true)`.
   **Join:** `net.joinRoom(code, false)`.
3. `net.send("hello", { name: callsign, vehicleId: game.vehicleId })`.
4. Show connected players (from `hello`s + presence). Host sees **START GRID**
   (enabled even solo — empty slots fill with AI). The **host picks the circuit**
   in this overlay (or reuse the menu's selected `game.trackId`); that `trackId`
   goes into `start`.
5. **Host presses start:** build roster (host = lowest available slot, then others
   by sorted peer id), `net.send("start", { seed, trackId, roster })`, then locally
   `beginOnline(game, net, cfg, roster)`.
6. **Guests** on `msg t==="start"`: `beginOnline(...)` with the received cfg/roster.

`beginOnline` = set `game.trackId = cfg.trackId`; construct
`game.mode = new OnlineMode(session)` where `session` wraps `net` + roster + cfg;
close the overlay; call `game.startRace()`. `startRace` builds the deterministic
field and calls `mode.setup(game)` (H3), which reassigns ownership/meshes.

### 7.2 `OnlineMode.setup(game)` — the ownership remap

```js
setup(game) {
  const mySlot = this.roster.find(r => r.peer === this.net.id)?.slot ?? 0;
  this.mySlot = mySlot;
  const humanBySlot = new Map(this.roster.map(r => [r.slot, r]));

  game.racers.forEach((r, i) => {
    r.slot = i;                                  // slot == grid index (guaranteed by placeOnGrid order)
    const human = humanBySlot.get(i);
    if (human) {
      this.applyRole(game, r, 'human', human.vehicleId, human.name, i === mySlot);
    } else {
      // AI slot: host simulates, guests interpolate
      r.isPlayer = false;
      r.netRemote = !this.net.isHost();
    }
  });

  // re-point the local player + camera at the slot this human actually took
  game.player = game.racers[mySlot];
  game.player.isPlayer = true; game.player.netRemote = false;

  this.initInterp(game);        // per-slot {a,b} packet buffers, lastSeen map
  this.wireNet(game);           // net.on("msg", ...) → this.onMsg(game, from, t, d)
  this.t = { st:0, bots:0, sync:0 };
}
```

`applyRole` swaps a kart's mesh to the human's chosen chassis and fixes the bot
cone marker:

```js
applyRole(game, r, role, vehicleId, name, isLocal) {
  if (role === 'human') {
    // rebuild the vehicle mesh to the human's chosen chassis
    game.scene.remove(r.mesh);
    r.vehicle = VEHICLES[vehicleId] || VEHICLES.prism;
    r.mesh = buildVehicleMesh(r.vehicle);      // no AI cone for humans
    game.scene.add(r.mesh);
    r.callsign = (name || 'PILOT').slice(0,16).toUpperCase();
    r.isPlayer = isLocal;
    r.netRemote = !isLocal;
    r.skill = 1;
    game.placeOnGrid(r, r.slot, game.racers.length);   // re-seat on the grid, re-sync mesh
  }
}
```

(If rebuilding the mesh is undesirable, an alternative is to have `startRace`
consult `mode.vehicleForSlot(slot)` when it first builds each kart — a 9th hook —
so meshes are built correct the first time. The rebuild path above needs **no**
extra hook, so it's the default recommendation.)

### 7.3 Countdown & the shared clock

Countdown is already a deterministic 3.4 s in `startRace`. Clients begin it when
they process `start`, which arrives within tens of ms of each other — close enough
that `RUSH` fires near-simultaneously. Residual clock skew is corrected by the host
`sync{ t }` packets: a guest whose `game.raceTime` differs from host `t` by > 0.5 s
snaps to host `t`. Finish times are read off this (host-anchored) `raceTime`.

### 7.4 Finish

`checkCheckpoints` sets `finished/finishTime` locally for **owned** karts only
(remotes are skipped by H5; their finish arrives as `fin`). H7 `onRacerFinish`
broadcasts `fin{ s, t:finishTime }`. Receivers mark that slot finished. When the
field is fully in (or grace elapsed), the **host** broadcasts `results{ order }`;
all clients adopt it so standings never disagree. `mode.checkEnd` (H8d):

```js
checkEnd(game) {
  const allIn = game.finishedOrder.length >= game.racers.length;
  const grace = game.player.finished && (game.raceTime - game.player.finishTime > 20);
  if (this.net.isHost() && (allIn || grace) && !this._published) {
    this._published = true;
    this.sess.send("results", { order: game.ranking().map(r => ({ s:r.slot, t:r.finishTime })) });
  }
  return allIn || grace || this._adoptedResults;
}
```

---

## 8. State sync & client-side smoothing

Add two fields to remote racers (lazily, in the mode): `r.netTarget` and a per-slot
interpolation buffer `{ a, b }` (previous + latest packet, each with `at =
performance.now()`), exactly like Cosmic Coils' `interp` map and Last Circle's
`applyRemoteState`.

**Outbound (`OnlineMode.update`, H4):**

```js
update(game, dt) {
  const now = performance.now();

  // 1) interpolate every remote kart toward its latest packet
  for (const r of game.racers) {
    if (!r.netRemote) continue;
    this.applyInterp(game, r, now, dt);      // lerp pos + slerp/lerp yaw; extrapolate mildly via velocity
    game.syncMesh(r);                        // remotes are skipped by H5's loop, so sync here
  }

  // 2) broadcast my own kart @15 Hz
  if (now - this.t.st > 66) { this.t.st = now; this.sess.send("st", this.packKart(game.player)); }

  // 3) host broadcasts its bots @12 Hz (one batched message)
  if (this.net.isHost() && now - this.t.bots > 83) {
    this.t.bots = now;
    const list = [];
    for (const r of game.racers)
      if (r.slot !== this.mySlot && !r.netRemote && r.__bot) list.push(this.packKartArr(r));
    if (list.length) this.sess.send("bots", { list });
  }

  // 4) host clock/standings sync @0.7 Hz + silent-guest watchdog
  if (this.net.isHost() && now - this.t.sync > 1400) {
    this.t.sync = now;
    this.sess.send("sync", { t:+game.raceTime.toFixed(2), order: game.ranking().map(r=>r.slot) });
    this.watchdog(game, now);               // no `st` from a human for 12s → host bot-adopts the slot
  }
}
```

**`packKart` / unpack:**

```js
packKart(r) {
  return {
    s:r.slot,
    x:+r.position.x.toFixed(2), y:+r.position.y.toFixed(2), z:+r.position.z.toFixed(2),
    yw:+r.yaw.toFixed(3),
    vx:+r.velocity.x.toFixed(2), vy:+r.velocity.y.toFixed(2), vz:+r.velocity.z.toFixed(2),
    tS:+r.trackS.toFixed(1), lap:r.lap, cp:r.cpIndex, tb:Math.round(r.turbine),
    fl:(r.drifting?1:0)|(r.airborne?2:0)|(r.phasing?4:0)|(r.veil?8:0)|(r.overclockTimer>0?16:0)|(r.stun>0?32:0),
    it:r.item||0,
  };
}
```

**Inbound `st`/`bots`** → push into the slot's buffer (`a = b; b = {pos,yaw,vel,at:now,...}`),
set `r.trackS/lap/cpIndex/turbine/item` **directly from the packet** (these are
authoritative for ranking + HUD — never computed locally for remotes), decode `fl`
into the boolean flags used by `driveRacer`'s visuals / `setBoostVisual`, and stamp
`lastSeen[slot]`.

**`applyInterp`** (per frame): position = lerp between `a.pos` and `b.pos` by
`k = (now - b.at)/span` clamped to ~[0,1.5] (mild extrapolation for one dropped
packet), then add `b.vel * min(overshoot, 0.1)` dead-reckoning so fast karts don't
rubber-band on the 66 ms gap; yaw = angle-lerp via `wrapAngle` (already in
`math.js`). This is the same "interp with mild extrapolation" Cosmic Coils uses
(`k = min(1.6, ...)`).

**Rates rationale:** 15 Hz own (66 ms) keeps a 200+ km/h kart within ~a car length
between packets; 12 Hz bots batched = 12 msgs/s; host total ≈ 27–30/s ≤ the client's
30 `eventsPerSecond`. Optional LOD (Last Circle does this): bots far from the local
player go to 2–3 Hz (`if (far && tick % 5) continue;`) to save budget with a full
field.

**Collisions:** leave `resolveCollisions` running for all karts. It depenetrates +
impulses both bodies; on a remote kart the impulse is cosmetic (next `st` corrects
it), on your own kart it's the real bump feel. This matches how the shipped games
tolerate collision authority — no change needed beyond H5/H6/H8f.

---

## 9. Reconnect, desync & host migration

Copy the proven mechanisms from Cosmic Coils/Last Circle:

- **Dynamic host** = lowest peer id present (`sess.isHost()` recomputes from
  presence every check). If the host leaves, the next-lowest id becomes host and, on
  its first `update`, **adopts every bot**: flips host-owned bot slots from
  `netRemote=true` to locally simulated and re-attaches AI driving (for Grid Rush
  "re-attach" is trivial — `updateAI` will just start driving any non-`netRemote`
  bot again once H6's guard passes). Mirror Cosmic Coils' `_becomeHost`.
- **Silent-guest watchdog** (host): if a human slot sends no `st` for 12 s mid-race
  (tab closed without `bye`), host broadcasts `takeover{s}` and the slot reverts to a
  host-simulated bot — the race never stalls. Mirror Last Circle's `lastSeen` sweep.
- **Explicit leave:** `window.addEventListener('beforeunload'/'pagehide', ...)` →
  `sess.send("bye",{s:mySlot})` then `net.leave()`. Host on `bye` immediately
  bot-adopts the slot (no 12 s wait). (Grid Rush runs embedded in the portal iframe,
  so `pagehide` is required, not just `beforeunload` — Cosmic Coils documents this.)
- **Drop-in join (optional, v2):** a `hello{late:1}` mid-match makes the host answer
  with an `assign`-style packet handing a live bot slot to the joiner (Cosmic Coils'
  `_assignLate`/`possess`). For v1, **lock the roster at start** — late joiners
  spectate or wait for the next race (simpler and enough to ship).
- **Desync correction:** `st`/`bots` carry authoritative `tS/lap/cp`, so ranking
  self-corrects continuously; `sync{t}` corrects the race clock; item pads re-sync on
  every pickup + deterministic respawn; `results` reconciles final standings. There is
  no attempt at physics rollback — position converges via interpolation, everything
  score-bearing converges via periodic authoritative packets.
- **Packet loss:** all state is periodic + idempotent; all events are self-contained
  + idempotent (a duplicate `pad`/`gpop`/`fin` is a no-op; a lost one is repaired by
  the next `sync`/`results` or a re-pickup). No ordering assumptions.

---

## 10. New files (nothing else moves)

```
games/grid-rush/runtime/net/ffg_netplay.js    ← copy verbatim from any FFG game
games/grid-rush/runtime/net/gridnet.js         ← Session: roster, slots, pack/unpack, interp, onMsg
games/grid-rush/runtime/net/online-mode.js     ← OnlineMode (mode-registry impl) + openOnlineLobby()
```

`gridnet.js` mirrors `coilnet.js`'s structure: a `Session` holding `net`, `peers`,
`mySlot`, `interp`, `lastSeen`, with `packKart/onMsg/isHost/leave`; plus
`SUPABASE_URL`/`SUPABASE_ANON_KEY` constants (identical values to every other game)
and a `beforeunload`/`pagehide` bye. `online-mode.js` imports the `Session`, exposes
`openOnlineLobby(game)` for the menu, and the `OnlineMode` class implementing §4.2.

`index.html`: add `#btn-online`; `bindUI`: add its handler (both in §7.1). `config.js`:
optional `ONLINE = { MAX_PLAYERS: 6, STATE_HZ: 15, BOTS_HZ: 12, SYNC_HZ: 0.7 }` block
for tunables — not required.

---

## 11. Test plan

- **Two-tab quick-match:** open the portal build in two tabs, `QUICK MATCH` both;
  they pair (2 lowest ids), lower id = host, race starts on both; each sees the other
  kart move smoothly and 4 shared AI karts identical on both screens.
- **Create/join code:** host `CREATE ROOM`, guest `JOIN <code>`; same result.
- **Determinism check:** both clients on the same `trackId` must show item pads +
  hazards in the same places (they will — `mulberry32(seed)` — but eyeball it).
- **Gadget cross-fire:** host fires `volt_lash`/`emp_bloom` at the guest → the guest's
  kart stuns (victim-applied); mine dropped by one shows + detonates on both.
- **Finish agreement:** both clients' results panels list the same order/times
  (host `results` reconciled).
- **Host-leave migration:** host closes tab mid-race → guest becomes host, the 4 AI
  karts keep driving (don't freeze).
- **Silent-guest watchdog:** kill a guest's tab without `bye` → within 12 s its slot
  becomes an AI bot on the host and keeps racing.
- Follow the FFG rule: browser-pane preview can't screenshot a running rAF race —
  verify via a two-tab manual run + console assertions on `sess.debug()`, not a
  single-frame screenshot.
```
