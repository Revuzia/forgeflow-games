# BLOCKTOOTH ONLINE: engine + netcode feasibility (lane: netcode)

Status: DONE (read-only research + scratch prototypes, 2026-10-01). No game code was edited, nothing was deployed or
committed. Prototypes ran in a `git archive HEAD` copy in the session scratchpad. Copies of the lab scripts and raw
results are in `_spec/online/netcode_lab/` (see §9).

Labels: **[measured]** = a number from a run in this session (the file is named); **[source]** = read in code this
session (file:line, relative to `games/blocktooth/` unless the path starts with `forgeflow-games/`); **[cited]** = from
another project doc, which cites the web source; **[estimate]** = arithmetic on stated assumptions; **[inferred]** = my
reading, not measured.

Siblings: `vs_design.md` (rules: 10:00 match + 0:45 LAST CALL, card-rail drafts, no gate locks, bots fill, take over a
bot seat during OPEN HOUSE), `platform.md` (stats/achievements/leaderboard), `mp_refs.md`.

---

## 1. Outcome

1. **Recommendation: host-clocked deterministic lockstep over a WebRTC mesh (a hybrid).** Every peer runs the full
   sim. Guests send 4-byte inputs to the host. The host is the clock and the input authority: it publishes one
   confirmed input frame per tick, and when a guest's input is late it repeats that guest's last input, so a lagging
   guest never stalls the others. Bots are simulated on every peer and cost no bandwidth. A state hash every 30 ticks
   catches desyncs. If the host leaves, the next-lowest peer id takes over the clock, because every peer already holds
   the full state. As a cosmetic layer, each guest predicts only its own titan's movement on screen.
2. **Hard prerequisite: deterministic math.** Today the sim gives different results in different browsers [measured]:
   - Firefox 146 and WebKit 26 diverge from Node in the first 300 ticks.
   - Chromium 145 diverges from Node 22 within 900-8,100 ticks. Two Chrome versions are enough to desync.

   A prototype `detmath` (pure-JS sin/cos/atan2/exp/log/pow/hypot built only from IEEE-exact operations) made all four
   engines **bit-identical over 3 runs x 60 checkpoints x 18,000 ticks**. GATE 2 still passed and the step time did not
   change measurably (0.39 vs 0.41 ms per tick) [measured, §6.4].
3. **Supabase Realtime cannot carry any 4-player real-time stream.** The free project cap is 100 events/s, shared by
   every FFG game. A room broadcast to 4 subscribers bills 4 events per send. Inputs at 30 Hz would cost 480 events/s,
   and snapshots cost more [cited + estimate, §4]. Supabase stays for the lobby, quick match, WebRTC signalling and
   match control. The game stream goes over WebRTC DataChannels.
4. **Host-authoritative snapshots are feasible on bandwidth over WebRTC, but not recommended.** A 4-player
   interest-filtered snapshot is p50 1.3-1.5 KB and p95 3.0-6.3 KB [measured byte model, §6.2], about 60-285 KB/s of
   host upload at 15 Hz. The real cost is elsewhere:
   - a replication schema across every view-read field (side tables included);
   - an event-forwarding channel (up to 17.6 KB of events in one tick [measured]);
   - a host leaving ends the match.
5. **The sim is cheap enough for every peer to run.** With one titan, `stepWorld` takes 0.27-0.58 ms on average and
   1.06-1.76 ms at p99 (Node, this PC) [measured]. Most of that is the city's traffic (`stepCity` 41-70 %). The titan's
   own systems take 9-21 %. Four titans are estimated at 1.6-2.1x one titan, so ~0.5-1.2 ms per tick, about 3 % of the
   33 ms tick [estimate, §6.1].
6. **The N-titan refactor is the large item:** about 3,500-5,500 sim LOC touched or new, plus 2,000-3,500 view/app LOC
   and about 1,700-2,400 net + harness LOC [estimate, §2-§3]. The biggest lever is a "player cursor": keep `w.titan` /
   `w.upgrades` / `w.ult` as a cursor bound per player, so titan-scoped systems need few edits.

---

## 2. N-titan refactor audit (sim)

### 2.1 What assumes ONE titan today [source]

- `World` holds one `titan: TitanState` (`src/core/types.ts:604`), built once in `createWorld` (`src/core/world.ts:54`).
- Per-player state is spread over World, not TitanState:
  - `upgrades` (`types.ts:612`), `run` (`:613`), `input` (`:615`), `meta`, `ult`, `tally` and `gates` (`:620-626`);
  - `titanId` (`:597`), read in 58 places across 18 files.
- `hurtTitan` reads `w.titan`, `w.upgrades.shield` and `w.ult.invulnT` together (`src/titans/titansim.ts:671-695`). A
  per-player refactor has to swap all of them as one unit.
- Hostile damage tests only the one titan circle (`src/combat/damage.ts:438-459`, `hurtTitanByShape` /
  `damageTitanArea`). Titan-side `damageArea` hits enemies, boss parts, buildings and props, but no other titan
  (`damage.ts:229-260`).
- **Events carry no owner.** There are 105 `w.events.push` sites (grep), for example `enemyKilled` at
  `damage.ts:385`. `processTriggers` / `chargeUltimate` / `stepTally` read this tick's events
  (`world.ts:146-152`), so with 4 players every kill would credit every player.
- The director spawns relative to the titan, picks the enemy mix and caps by `w.titan.rank`, and holds a
  boss-framing camera distance inside the sim (`src/ai/director.ts:92`, `:147`, `:175`, `:186`, `:284-345`).
- Raw reference counts (grep `\bw\.titan\b`): 450 refs in 64 files, plus 249 `const T = w.titan` aliases.
  Other per-player fields: `w.upgrades` 68, `w.ult` 43, `w.gates` 75, `w.tally` 28, `w.input` 18.
- The sim freezes for drafts, the pause screen, slates and run end (`world.ts:114-118`, `game.ts:9-14`; the draft
  gate is at `game.ts:1539`). Hit-stop scales sim time through `loop.timeScale` (`game.ts:1793`, `:1815`). The app
  calls straight into the sim: `pickUpgrade` / `rerollOffer` / `banishCard` / `lockCard` (`game.ts:87`), `endFinale`
  (`meta/gates.ts:383`), `continueEndless` (`meta/endless.ts:69`) and cheats. Online, each of these must become an
  input word or be disabled.
- **Hidden state outside World** (important for resync and late join, harmless for lockstep). The sim keeps many side
  tables:
  - keyed by World: `combat/spatial.ts:34`, `combat/damage.ts:72`, `combat/pickups.ts:64`, `ai/enemies.ts:481`,
    `titans/kits/molo.ts:64`, `titans/kits/briarwick.ts:128`;
  - keyed by entity: `combat/pickups.ts:55-59` (latchOnLand / collectNext), `combat/projectiles.ts:78`,
    `combat/telegraphs.ts:54`, `ai/bosses/caisson4.ts:113`, `ai/bosses/index.ts:1274`;
  - keyed by city: `city/citysim.ts:161` (the repair-crew book: stage / prog / downT per building);
  - keyed by offer: `upgrades/draft.ts:286-288`, `upgrades/engine.ts:268`.

  Also, the RNG streams are closures with private state (`src/core/rng.ts:4-12`), so a World cannot be cloned or
  serialized. Module-level scratch buffers (e.g. `titansim.ts:95-96`, `enemies.ts:424-478`) are reset per call or per
  step (`enemies.ts:1109`). Several Worlds stepping in one process stay independent [measured: an interleaved replay
  World matched a fresh replay bit for bit, `measure_net2` `replayFromQuantizedLog_matchesQ: true`].
- Determinism sweep [source]: no `Math.random` / `Date` / `performance.now` / DOM in sim code (grep: comments only).
  Every `.sort` has a total-order tiebreak (e.g. `briarwick.ts:660`, `objectives.ts:392`, `traffic.ts:42`). **But there
  are about 520 calls to engine-approximated Math functions** in the sim + bot: sin 125, cos 120, hypot 169, atan2 53,
  tan 18, pow 8, exp 7, log 4, atan 2, asin 1. That is the cross-browser blocker (§6.4).

### 2.2 Recommended refactor shape: PlayerState + cursor [design]

- Add `PlayerState { slot, titan, upgrades, ult, tally, meta, input, director, bot | null, ko }` and `w.players[4]`.
- Keep the old field names as a **cursor**: `bindPlayer(w, i)` points `w.titan / w.upgrades / w.ult / w.tally /
  w.meta / w.input` at player i. Titan-scoped systems (`stepUltimate`, `stepTitan`, kit hooks, `stepUpgrades`,
  `processTriggers`, `chargeUltimate`, `stepTally`, pickup collect) then run inside
  `for (i of players) { bindPlayer(w, i); ... }` almost unchanged.
- Stamp the owner on events centrally. `w.events` becomes a sink whose `push` writes `ev.p = w.cur`, so none of the 105
  sites change. Triggers, UPROAR charge and tally read only their own player's events.
- Titan-owned delayed damage (projectiles, hazards, telegraphs, BRIARWICK pods, VOLT-KITE wires) stores `ownerSlot`.
  The step binds that owner before resolving, so kill credit and lifesteal go to the right titan.
- World-scoped hostile systems loop over the titans or choose one:
  - per-enemy target slot with hysteresis, for enemies and bosses;
  - hostile shapes test every titan;
  - per-player director rings, which reject spawn points inside any titan's view;
  - the pickup magnet goes to the nearest titan.
- PvP is new code: titan-side shapes also test the other titans' circles (excluding self), plus KO / respawn / ring
  logic per `vs_design.md`.
- Bot seats: port `_harness/bot.ts` into the sim. It is already deterministic and pure (`bot.ts:1-6`). Its per-world
  memory (`bot.ts:87-104`) moves into `PlayerState.bot`, and it gains rival targeting.
- Risk of the cursor: a system that forgets to bind gets silent mis-attribution. Mitigation: a dev-build assert that
  `w.cur` is valid inside titan-scoped steps, plus probe checks that per-player tallies add up.

### 2.3 Size estimate per group [estimate; LOC = lines touched or new, not file size]

| Group | Files (current lines) | Work | Est. LOC |
|---|---|---|---|
| Core contract | `core/types.ts` 991, `core/world.ts` 172, `core/config.ts` 1162 | PlayerState, cursor, per-player step loop, event sink, mode flag (solo/VS), run end per mode, `createWorld({players})` | 250-400 |
| Titan-scoped (cursor) | `titans/titansim.ts` 704, `titans/kits/*` 1612, `upgrades/*` 1756, `meta/ultimate.ts` 631, `meta/tally.ts` 268, `meta/perks.ts` 129 | titan-titan body collision; card-rail drafts (offer per player, pick/reroll as input); grow/XP per player | 200-400 |
| World-scoped, must choose a titan | `ai/enemies.ts` 1171 (93 `T.` lines), `ai/director.ts` 429, `combat/*` 1869, `city/citysim.ts` 665 + `traffic.ts` 178, `meta/objectives.ts` 485, `powerups.ts` 263, `gates.ts` 392, `endless.ts` 230 | target slots, owner slots, all-titan hostile tests, per-player director, magnet to nearest, VS gate rules (no locks; PUBLIC TENDER per vs_design §4), endless off in VS | 1,200-2,000 |
| Bosses | `ai/bosses/*` 4,646 (234 `T.` lines) | VS keeps shared gatekeepers (vs_design §4.2): target choice + damage share. City boss off in VS v1 | 300-600 (~0 if bosses are off) |
| PvP + bot titans | new; port `_harness/bot.ts` 668 | titan-vs-titan damage, KO/respawn/elimination, ring, scoring; in-sim bot brain with PvP behaviour | 1,000-1,800 |
| Determinism | about 520 call sites + new `core/detmath.ts` | mechanical replace + a grep gate that bans `Math.(sin\|cos\|tan\|atan2?\|asin\|acos\|exp\|log\|pow\|hypot\|cbrt)` in sim dirs | 550 replaced + ~200 new |
| **Sim total** | | | **~3,500-5,500** |

---

## 3. Camera / HUD / view impact

- **Camera** (`render/camera.ts`, 4 `w.titan` refs at `:191`, `:210`, `:334`, `:363`) follows the local slot. The
  auto-distance curve stays a function of the local titan's height (`core/config.ts:455`). At Size V that is 560-617 m,
  zoom capped at 880 m (`config.ts:420-425`). Rivals of very different size share the frame. Measured ground view
  radius of one titan: p50 95-149 m, p95 320 m, max about 420 m [measured, `measure_net` viewR], against a city
  about 1 km across (bounds ±476-661 m). Rivals are usually off-screen, so they need edge arrows (`render/markerview.ts`
  exists, 171 lines).
- **Sim-side camera coupling:** the director's boss-framing hold uses `cameraDistance(w.titan.height)`
  (`ai/director.ts:284-345`). In VS it becomes per player, or off when no boss is up. The spawn ring "just off camera"
  must be off every titan's camera.
- **Titan view:** `titans/titanview.ts` (684 lines) mounts one model for `w.titanId` (`:150-177`). It needs a
  per-slot instance (model, animator, palette, nameplate, team outline). Four skinned titans means a perf re-check
  (perfcheck). Two players may pick the same titan, so a palette or rim colour per slot is required.
- **FX / audio:** `render/fx.ts` (60 `T.` lines; `:851`, `:1308`, `:1347`) and `audio/sfx.ts:381-400` anchor to "the"
  titan. They switch to the event's `p` slot. Local titan at full volume, rivals spatialized.
- **HUD:** `ui/hud.ts` (`:317`, `:523-542`) shows the local player. Add a 4-row standings strip (size/LV, KOs), a KO
  feed (the `ui/broadcast.ts` ticker) and a match/phase clock. `ui/draft.ts` (679 lines, modal) becomes the
  non-blocking CARD RAIL (vs_design §2).
- **Cinematics** (cinecam opening, finale, tabloid end, pause) are single-player only. VS gets a countdown start, a
  standings end and a spectate camera after elimination. Spectate is cheap under lockstep because every peer holds the
  whole world.
- **App** (`game.ts`, 1971 lines):
  - online state machine: lobby → countdown → match → results;
  - no `simEnabled = false` and no `timeScale` hit-stop online (hit-stop becomes camera/FX only);
  - quantize the input to the 4-byte wire form BEFORE the local sim uses it (§6.3);
  - wire in the session; upload stats at the end.
- **View/app total:** about 2,000-3,500 LOC [estimate].

---

## 4. Transport budget

- **Supabase Realtime free plan** [cited from `forgeflow-games/games/hit-parade/_research/NETCODE.md:110-118`, which
  read `supabase/realtime` and the docs]:
  - **100 messages/s per PROJECT**, as a 60 s rolling average. Going over it closes every live channel on the project.
  - 200 concurrent connections, presence 20 msg/s, payload up to 256 KB, 2M messages/month.
  - Billing: one message per send plus one per receiving subscriber.
  - The client `eventsPerSecond` parameter is a no-op (`NETCODE.md:126-134`), so the
    `forgeflow-games/pipeline/engine/runtime/net/ffg_netplay.js:43` `eventsPerSecond: 12` limits nothing.
- **4 humans in one broadcast room = 4 billed events per send** [estimate from the billing rule]:

  | Stream over Supabase | events/s | vs the 100/s project cap |
  |---|---|---|
  | lockstep inputs, 4 senders x 30 Hz | 480 | 4.8x |
  | inputs batched to 10 Hz | 160 | 1.6x |
  | host snapshots 15 Hz + guest inputs 10 Hz | 60 + 120 = 180 | 1.8x |
  | per-guest private channels (2 events/send), host 10 Hz + guests 10 Hz | 60 + 60 = 120 | 1.2x |

  Every real-time layout breaks the cap even with no other FFG game online. **Supabase = lobby + presence + signalling
  + START/RESULT only.** Rough cost per match: about 200-400 events [estimate], so about 5k-10k matches/month inside 2M.
- **WebRTC DataChannels** have no per-message billing. Code to reuse:
  - `forgeflow-games/games/hit-parade/runtime/src/net/transport_rtc.ts` (1v1 pair: unreliable `in` + reliable `ctl`
    channels, public STUN, no TURN; `:1-11`);
  - `forgeflow-games/games/last-circle/runtime/net/ffg_rtc.js` `RTCMesh` (full mesh of up to 3 connections per client
    for 4-human rooms, lower id offers, unreliable channel; `:1-22`).
- **NAT failure (no TURN):**
  - A guest that cannot reach the host P2P can have its inputs forwarded by another peer it can reach, since the mesh
    is pre-opened.
  - Otherwise, a Supabase relay for that ONE guest at 10 Hz (~40 events/s). That means one relayed guest at a time
    project-wide, like HIT PARADE's relay slot (`transport_relay.ts:1-10`).
  - Otherwise, the seat goes to a bot ("couldn't connect").
  - TURN or a Cloudflare Durable Object relay costs money or may cost money: the owner's gate. DYEFIELD's online lane is
    designing a DO relay (`workers/dyefield-net`, per project memory; not built in the repo yet: `find` for
    `dyefield-net` returned nothing). BLOCKTOOTH should share it if it lands at $0.
- **Quick match for 4:** `NetPlay.quickMatch` pairs only the two lowest ids (`ffg_netplay.js:78-106`). VS needs a
  4-seat variant. The lowest waiting id hosts. The next up-to-3 ids join its room. The host starts at 4 humans or after
  a countdown, filling the empty seats with bots. Join by code uses `NetPlay.joinRoom` (`:49-76`) as is. Keep the lobby
  small and short-lived because of the presence limit (20 msg/s).

---

## 5. Netcode options compared

| | A. Pure lockstep (mesh, all wait for all) | B. Host-authoritative snapshots + prediction | **C. Host-clocked lockstep (recommended)** |
|---|---|---|---|
| Who simulates | every peer | host only; guests render mirrors | every peer |
| Wire per guest | ~1-2 KB/s [estimate] | 20-95 KB/s down (15 Hz, p50-p95) + events [measured model] | ~1-2 KB/s down, ~1 KB/s up |
| Bots | free (deterministic) | host only | free (deterministic) |
| Cross-browser determinism | **required** | not required | **required** (detmath, proven in §6.4) |
| One laggy player | stalls everyone | only that player | only that player (its late input is repeated) |
| Own-input latency | max RTT of all peers + buffer | ~0 for own movement (predicted), others ~RTT/2 + 100 ms interp | RTT to host + ≤1 tick; cosmetic own-titan prediction hides most of it |
| Host leaves | n/a (no host) | match over (guests lack full state) | migrate the clock to the next id; state already local |
| New feature cost later | none (deterministic by construction + probe) | every view field joins the snapshot schema | none (deterministic by construction + probe) |
| Desync | possible; detected by hash | impossible | possible; detected by hash within 30 ticks |
| Join / take-over mid-match | needs state or input-log replay | natural | input-log replay join (§7.3) |
| Rollback-style correction | — | — | **not used.** World is an object graph with side tables, not a flat buffer. Re-simulating W ticks per frame at ~1 ms (p99 several ms) is not worth it. HIT PARADE can roll back because its whole state is ≤4 KB Int32Array (`hit-parade/_research/NETCODE.md:27`) |

Why C over B:
- B's replication layer has to mirror everything the views read: enemies, boss data/parts, projectile and telegraph
  extras, which live in WeakMaps (`projectiles.ts:78`, `telegraphs.ts:54`), hazards, about 1,000 moving cars,
  buildings, objectives, upgrades / UPROAR for the HUD, and every event for FX.
- That schema would need upkeep with every future feature, and B loses the match when the host closes the tab.
- C keeps one code path for solo and online. The game stays exactly the game.
- C's whole price is determinism discipline. §6.4 shows it is achievable on this codebase, and the 4-engine probe makes
  it a mechanical gate.

---

## 6. Measurements (scratch copy of HEAD b3005a22; Node 22.20 on this PC unless noted)

### 6.1 Step cost: can a host / every peer run it? [measured, `results/m_*.json`, `results/n_*.json`]

Each run is a full bot-played run to the clear (1,099-1,200 s of sim).

| Run | step avg | p95 | p99 | max (and when) |
|---|---|---|---|---|
| molo/grideast | 0.58 ms | 1.11 | 1.76 | 24.6 (JIT warm-up ticks 0-274) |
| voltkite/whitestacks | 0.27 | 0.62 | 1.06 | 35.2 (ticks 0-366) |
| hearthback/lockwater | 0.32 | 0.61 | 1.16 | 96 (one tick at start); 5.8 ms worst after warm-up |
| briarwick/grideast (seed 7) | 0.54 | 1.09 | 1.75 | 33.5; 12.2 ms worst late spike |

Share of step time by system [measured]:
- `stepCity` (traffic + repair crews): 41-70 %
- `stepEnemies`: 8-25 %
- `stepTitan`: 6-11 %
- `stepDirector`: 4-8 %
- `stepPickups`: 1-6 %
- everything else: ≤3 % each

4-titan model [estimate]: city x1 + titan-scoped systems x4 + enemy-scoped systems x2.5 (if the director scales its
budget with players). That gives **1.6-2.1x one titan, about 0.5-1.2 ms avg and ~2-4 ms p99**, against a 33.3 ms tick.
A phone 3-5x slower stays under ~6 ms per tick on average [estimate; measure in H5].

Browser cross-check [measured]: 18,000 bot ticks (10 sim-minutes) ran in 3.3-4.5 s in Chromium, Firefox and WebKit,
about 0.2 ms per tick, bot and hashing included.

### 6.2 Snapshot size (option B) [measured counts x a quantized byte model in `measure_net.ts`]

Byte model: titan 24 B, enemy 12, projectile 14, pickup 9, telegraph 16, hazard 14, moving car 9, boss 48 + 6 per
part, header 8.

Peak live counts in one solo run:
- enemies 58-103 (p95 37-64)
- pickups 252-611 (p95 62-458)
- projectiles ≤22
- telegraphs ≤13
- hazards ≤28
- **moving traffic props up to 1,020** (cars are sim objects you can crush and eat)

| Snapshot (per guest per send) | p50 | p95 | max |
|---|---|---|---|
| whole world, 1 titan | 2.7-9.0 KB | 3.9-9.8 KB | 6.1-10.2 KB |
| interest-filtered (inside the view radius), 1 titan | 0.70-1.05 KB | 2.4-6.0 KB | 5.4-9.9 KB |
| interest-filtered, 4 titans (enemies x2.5) [estimate on measured] | 1.25-1.53 KB | 3.0-6.3 KB | 5.8-10.3 KB |

Events a host would also forward, as JSON per tick: avg 167-324 B, p99 2.0-3.6 KB, max 6.0-17.7 KB [measured].
Building floors changed per 10 ticks: p95 6-21, max 124 [measured].

Full dynamic state as JSON (resync / late-join payload, side tables NOT included): **247-519 KB, 4-13 ms to
stringify** [measured]. That is over Supabase's 256 KB payload cap. Binary would be far smaller, since most of it is
9,000 props' coordinates.

### 6.3 Input bytes and the lockstep payload [measured, `measure_net2.ts`]

- Wire input: **4 bytes per player per tick**: mx and mz as int8 x127, a flags byte (ability, abilityHeld, dash,
  ultimate) and a byte reserved for the card-rail pick or reroll. That is 16 B per tick for 4 players.
- **Replaying a run from its 4-byte input log plus draft picks reproduces the run bit for bit** (`replayFromQuantizedLog_matchesQ:
  true` on all 4 configs). Inputs + picks are the complete lockstep payload.
- Using quantized inputs instead of float inputs changes the run from tick 0. So the local player's sim must also step
  the decoded input, not the raw one.
- Draft picks: 40-45 per run (one per pick tick). Negligible.
- Packet estimates [estimate]:
  - guest → host: 8 B header + 4 redundant inputs x 4 B = 24 B at 30 Hz, so ~0.7 KB/s payload (~2.5 KB/s with
    UDP/DTLS/SCTP overhead).
  - host → each guest: 8 B + 3 redundant frames x (16 B + 1 B late-mask) = 59 B at 30 Hz, so ~1.8 KB/s.
  - host upload for 3 guests: ~5-12 KB/s.
  - state hash: 4 B every 30 ticks.

### 6.4 Cross-engine determinism [measured, `results/xres*.json`, `xnode*.json`]

The same bot-driven run was bundled with rolldown and run in Node 22.20, Chromium 145.0.7632.6, Firefox 146.0.1 and
WebKit 26.0 (Playwright browsers on this PC). Each run hashed the world every 300 ticks: titan, enemies, pickups, every
prop, every building's floors and HP, and the boss.

| Engine | native Math: bits differ from Node | native: first checkpoint divergence | with detmath prototype |
|---|---|---|---|
| Chromium 145 | sin, cos, pow | tick 900 / 4,800 / 8,100 (3 runs) | **all 60 checkpoints identical, 3/3 runs** |
| Firefox 146 | sin, cos, tan, pow, hypot | tick ≤300, 3/3 runs | **identical, 3/3** |
| WebKit 26 | sin, cos, tan, atan2, exp, log, pow, hypot, asin | tick ≤300, 3/3 runs | **identical, 3/3** |

- `detmath.ts` uses fdlibm-style kernels built only from + - * /, `Math.sqrt`, floor and bit ops. Max relative error
  against V8 is ≤3.3e-16 for sin, cos, tan, atan2, asin, log, exp and hypot, and 1.6e-15 for pow [measured,
  `detmath_acc.ts`].
- With detmath, probe_sim still gives **GATE 2: PASS**: molo clear at 1,214 s (native 1,190 s), voltkite at 1,076 s,
  and step avg 0.39 ms vs 0.41 native [measured].
- Chaos check: one 1-ulp change to `titan.x` grew into a different enemy count after 2,073 ticks (69 s) and a titan
  position more than 1 cm off after 5,771 ticks in 1 of 4 runs. The other 3 absorbed it [measured, `n_*.json`]. Small
  float differences do turn into visible gameplay divergence within about a minute, and the hash flags them at once.
- Limits: all four engines ran on one x64 Windows PC. Because detmath uses only operations IEEE-754 defines exactly, it
  should match on ARM, macOS and iOS by construction [inferred]. One real iPhone/Mac run of the probe is still the
  final check.
- Production form: explicit `import { sin, cos, ... } from 'core/detmath.ts'` in sim modules plus the grep ban. Do not
  monkey-patch the global `Math`: three.js and the views do not need it.

---

## 7. Recommendation detail, risks

### 7.1 Session design (option C)

- **Seats:** 4. Slot 0 = host (lowest peer id). Empty seats get bot brains, simulated identically on every peer.
- **START (reliable):** seed, biome, mode, per-slot `{titan, palette, RunMeta, bot?}` (`sanitizeRunMeta` per player,
  so everyone builds the same world), input delay D, tick-0 wall time.
- **Clock:** the host ticks at 30 Hz from a Worker-driven clock, not rAF. A hidden host tab throttles rAF/timers (the
  Last Circle notes describe the ~1 Hz throttle, `last-circle/runtime/3d/royale/net.js:588-592`). Each confirmed frame
  = `{tick, 4 x input, lateMask}`.
- **Guest input:** stamped for tick `confirmed + lead`, with `lead = ceil((RTT + jitter_p95) / 33.3 ms)` (expect 2-5
  ticks).
  - Late at the host → that guest's previous input is repeated and becomes canonical. The flag tells the guest's UI.
  - Missing for 3 s → an AFK bot drives the seat until inputs resume.
- **Fairness:** the host self-delays its own input by the median guest lead. A tunable default; otherwise the host has
  0 latency.
- **Cosmetic prediction:** a guest renders its own titan ahead of the last confirmed state by integrating its
  unconfirmed inputs through movement only (`titanMaxSpeed`, building collision through the citysim index), blending
  back on confirm. Render-side only, never fed to the sim.
- **Desync:** every peer hashes the state (like `_harness/probe_sim.ts:153-180`, over all players) every 30 ticks and
  sends the hash on the unreliable channel.
  - v1: majority wins; a peer outside the majority drops to "connection problem", gets a bot seat and the match is
    marked unrated for it.
  - v2 (after rng-as-data + side tables move into World): full-state resync.
- **Host leaves:** the next-lowest id sends its last confirmed tick, and the others confirm. It becomes the clock and
  input authority. The pre-opened mesh means no new handshake is needed.
- **Results / stats:** every peer computes the same final standings. Each reports through the platform path. The
  server can require agreement from at least 2 reporters per `match_id`; `report_match_result` is idempotent by
  match_id (`forgeflow-games/supabase/migrations/0004_game_ratings.sql`, per project memory; `platform.md` owns this).
  A tampered client desyncs and cannot agree.

### 7.2 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Cross-engine float divergence | **blocking today** (§6.4) | detmath + grep ban + 4-engine probe as a gate on every sim change |
| New hidden nondeterminism (Map/Set iteration over ids, unsorted object keys, a sort without a tiebreak) | medium | N-peer harness on mixed engines; keep the hash wide (props, buildings, side-table counts) |
| Latency / jitter for guests (RTT + buffer) | medium for feel | cosmetic own-titan prediction; adaptive lead; soft-warn at RTT > 200 ms in the lobby |
| Host leaves | low (migration) | harness scenario H2-e |
| Host tab backgrounded | medium | Worker clock; clock watchdog on guests (no frame for 1 s → elect a new authority) |
| Guest tab backgrounded | low | AFK bot after 3 s; on return, catch up at ~0.2-1.2 ms per tick (60 s behind ≈ 1-2 s of catch-up) |
| NAT blocks P2P (no TURN) | medium | mesh forwarding; one project-wide Supabase relay slot; else a bot seat; TURN or DO relay = owner money gate |
| Supabase project cap (shared by all FFG games) | high if misused | no game stream on Supabase (§4); batched presence; short lobbies |
| Low-end phone CPU (full sim + 4 titans + rendering) | medium | measure (H5); traffic LOD is sim-safe only if deterministic and identical on all peers |
| Mid-match take-over of a bot seat (vs_design OPEN HOUSE) | medium | input-log replay join (§7.3), capped to the first 4 min |
| Refactor misattribution (cursor not bound) | medium | dev asserts + per-player tally probes |

### 7.3 Joining a running match without serialization [design + estimate]

The host keeps the full input log: 16 B per tick, 115 KB at 4:00 before compression, mostly repeats. A joiner:
1. downloads the log over the reliable DataChannel;
2. fast-forwards from tick 0 while live frames buffer;
3. takes the seat.

At ~0.2 ms per tick (solo, measured in browsers) x 1.6-2.1 for 4 titans, 7,200 ticks take about 3-4 s on desktop
[estimate], longer on phones. This avoids building full-state serialization for v1.

---

## 8. Test harness needed

| ID | Harness | Gate |
|---|---|---|
| H1 | `probe_xengine` (prototype in `netcode_lab/`): the same bot run in Node + Chromium + Firefox + WebKit through Playwright (all installed in `AppData/Local/ms-playwright`) | every checkpoint hash identical. **FAILS today; PASSES with detmath** |
| H2 | `probe_net4.ts` (Node, headless): 4 in-process peers, each with its own World, over HIT PARADE's `core/net/loopback.ts` `SimLink` (measured-trace delays, loss, duplicates) + synthetic P2P profiles; template `hit-parade/_harness/probe_netsim.ts` | (a) all hashes equal at every checkpoint; (b) game speed ≥96 % under jitter; (c) late input → repeat, never a stall; (d) forced desync on one peer detected ≤30 ticks and the majority continues; (e) kill the host at a random tick → migration, hashes still equal; (f) AFK guest → bot takes the seat deterministically; (g) input-log replay join at 2:00 matches the live peers; (h) final standings agree on every peer |
| H3 | grep gate in `npm run check` | no engine Math transcendentals in sim dirs + the bot; no `Math.random`/clock |
| H4 | `online4.py` browser e2e: **4 separate `chromium.launch()` browsers** with `--disable-renderer-backgrounding --disable-background-timer-throttling`, and `page.bring_to_front()` on the client being checked. Project memory's 2-client gotcha: a backgrounded page throttles rAF and looks like a relay bug | quick match 2 humans + 2 bots; join by code with 4 humans; close the host tab mid-match → the match continues; hide one tab → it catches up; standings identical |
| H5 | perf with 4 titans + bots, desktop and mobile CPU throttle (perfcheck, run ALONE) | sim ms per tick and frame time; information, never a blocker (owner rule) |
| H6 | mixed-engine live pair: one Chromium + one Firefox + one WebKit client in one match (H4 rig) | no desync over a full 10:45 match |

---

## 9. Lab files (copies in `_spec/online/netcode_lab/`)

To re-run, copy them into `_harness/` of a scratch `git archive` checkout.

- `measure_net.ts`: per-tick entity counts, snapshot byte model, event volume, full-state JSON size and cost.
- `measure_net2.ts`: subsystem shares (needs a scratch `world.ts` instrumented with `globalThis.__prof` timers), spike
  census, 1-ulp chaos test, 4-byte input codec + replay proof.
- `detmath.ts` + `detinstall.ts` + `detmath_acc.ts`: the deterministic-math prototype and its accuracy check.
- `xengine_entry.ts` / `xengine_det_entry.ts` + `xrun*.py` / `xnode*.mjs` / `xpage*.html`: the cross-engine probe.
  Bundle with `node_modules/.bin/rolldown <entry> --format iife --platform browser -o out/xengine.js`.
- `results/`: raw JSON from every run quoted above.
