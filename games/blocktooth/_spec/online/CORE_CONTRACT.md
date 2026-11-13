# BLOCKTOOTH ONLINE: the multi-titan core contract (lane B-CORE, milestone B-1)

Status: IMPLEMENTED and verified (2026-10-05, see §11). This is the spec every parallel Phase-B lane (B-TITAN, B-WORLD,
B-VS, B-NET, B-VIEW, B-QA) builds against. It describes code that exists in the tree, not a plan. Sources:
`netcode.md` §2, `vs_design.md` §3-§13, `ONLINE_PLAN.md` §4 / §6.2-6.3.

One-paragraph summary: the `World` now holds `players: PlayerState[]` (1 in solo, 1..4 in VS). The old per-player World
fields (`w.titan`, `w.upgrades`, `w.ult`, `w.tally`, `w.meta`, `w.input`, `w.director`, `w.titanId`) are a **cursor**
that `bindPlayer(w, slot)` points at one player, so the ~450 existing `w.titan` references work unchanged for whichever
player is bound. `w.events` is a **sink** that stamps every event with the bound slot (`ev.p`). `stepWorldN(w, inputs)`
runs the per-player systems once per seat in slot order and the world-scoped systems once. **Solo (mode `'solo'`, one
seat) runs the exact pre-B-CORE call sequence; no VS code runs in solo.**

---

## 1. What changed, by file (B-CORE touched only these)

| File | Change |
|---|---|
| `src/core/types.ts` | `PlayerState`, `PlayerRun`, `CardRailState`, `GameMode`, `MAX_PLAYERS`; `World` gains `mode players cur pl view vs`; `RunOptions` gains `mode players view` and `titan` became optional; `SimEvent = SimEventBody & { p?: number }`; `TitanInput` gains `railPick? railReroll?`; `RunStats.result` gains `'vs'`, `RunPhase` gains `'vsend'`, `RunCtx.result` gains `'vs'`; new VS `SimEvent`s (§5.3) |
| `src/core/players.ts` (NEW) | `EventSink`, `createEventSink`, `bindPlayer`, `unbindPlayer`, `withPlayer`, `emitAs`, `isOwnEvent`, `assertBound`/`setBindAsserts`, `seatActive`, `creditTonnage`, `creditBlock`. Imports TYPES ONLY (no import cycles) |
| `src/core/world.ts` | `createWorld` (solo or VS, N seats), `stepWorld` (= `stepWorldN` with one input), `stepWorldN`, `setViewSlot` |
| `src/core/config.ts` | the `VS` block (every number from `vs_design.md` §3-§13) + `xpToNextFor`, `cumXpAtFor`, `xpToNextVs`, `paceStretchFor` |
| `src/vs/types.ts` (NEW, **B-VS owns**) | `VsWorld`, `PlayerVs`, `BotMemory`, `TenderState`, `RingState`, `VsPhase`, `BotLevel`, `PlayerSeat` |
| `src/vs/state.ts` (NEW, **B-VS owns**) | `createVsWorld`, `createPlayerVs`, `createBotMemory`, `vsSpawnPoints` |
| `src/vs/step.ts` (NEW stubs, **B-VS owns**) | the 4 per-tick hooks `vsBeginTick vsAfterTitans vsStepWorld vsEndTick` |
| `src/upgrades/rail.ts` (NEW stub, **B-TITAN owns**) | `stepRail(w)`, the CARD RAIL step |
| `src/upgrades/engine.ts`, `src/meta/ultimate.ts`, `src/meta/tally.ts` | titan-scoped event readers skip events with `e.p !== w.cur` (1 line each; `runRange` also in the smash de-dupe pre-pass). `ultimate.ts` `FIRE` scratch gained `slot` so one player's `chargeUltimate` never takes back another's fire |
| `src/city/citysim.ts` | the 3 `w.run.tonnage += ..` / `w.run.blocksLeveled++` sites call `creditTonnage` / `creditBlock` (world total + bound player; solo adds the same numbers) |
| `src/titans/kits/molo.ts`, `briarwick.ts` | per-titan WeakMap caches re-keyed `World` → `w.titan` (two MOLOs no longer share a vacuum set) |
| `_harness/probe_core.ts` (NEW), `package.json` | `npm run probe:core` (1,643 checks), now part of `npm run check` |
| `_harness/probe_city.ts`, `probe_meta.ts`, `probe_sim.ts` | type-only: the stand-in World gets the new fields; 2 `run.result` casts |

Ownership after B-CORE: types.ts / world.ts / players.ts / the `VS` block of config.ts stay **B-CORE's**. A lane that
needs a change there sends a request (it does not edit). Everything marked "B-VS owns" / "B-TITAN owns" above is that
lane's from now on.

---

## 2. The data model

```ts
interface PlayerState {
  slot: number;            // == index in World.players
  titanId: TitanId;  titan: TitanState;  upgrades: UpgradeState;  ult: UltState;  tally: RunTally;
  meta: RunMeta;           // VS: fresh pool (no unlocks, no perk), palette kept
  input: TitanInput;       // this tick's command (humans: stepWorldN writes it; bots: the VS bot brain writes it)
  director: DirectorState; // per-player PvE director
  rail: CardRailState;     // CARD RAIL timing + cadence (inert in solo)
  run: PlayerRun;          // { tonnage, blocksLeveled, peakRank }: this player's credited slice of World.run
  vs: PlayerVs;            // src/vs/types.ts: eliminated, respawnT, koCount, evictions, assists, pvpDealt, score, ...
  bot: BotMemory | null;   // null = human seat
}
interface CardRailState { open; openedT; expireT; chest; seq; sinceDraft; openingDone; data }   // see types.ts
```

`World` additions: `mode: 'solo'|'vs'`, `players`, `cur` (bound slot, -1 = unbound), `pl` (bound PlayerState), `view`
(the local seat; the sim never reads it), `vs: VsWorld | null`.

What stays WORLD-level (shared by all seats): `city`, `enemies projectiles telegraphs hazards pickups`, `boss`, `map`
(objectives + power-ups), `gates`, `endless`, `rng`, `nextId`, `cheats`, `run` (phase / result / endT / world totals).

* `World.run.tonnage / blocksLeveled / peakRank` are the **world totals** (solo: identical to player 0's). The
  per-player slice is `PlayerState.run`. Credit tonnage through `creditTonnage(w, tons)` and blocks through
  `creditBlock(w)`: they add to the world total and to the BOUND player (nobody when unbound).
* The current draft offer is still `upgrades.offer` (per player), so `draft.ts` `rollOffer / pickUpgrade / rerollOffer`
  work on it unchanged; `rail` holds only the rail's timing and cadence.

### 2.1 createWorld

```ts
createWorld({ biome, seed, mode?: 'solo'|'vs', players?: PlayerSeat[], view?: number, titan?, meta? }): World
interface PlayerSeat { titan: TitanId; meta?: RunMeta; bot?: 'rookie'|'regular'|'veteran' | null }
```
* Solo (default): `{ titan, biome, seed, meta }` exactly as before (every existing caller compiles and behaves the
  same), or `players: [oneSeat]`. Solo with `players.length !== 1` throws.
* VS: `{ mode: 'vs', players: [1..4 seats], biome, seed, view? }`. >4 or 0 seats throws. `bot` set = bot seat.
* VS differences at creation: seats spawn at `vsSpawnPoints(city, n)` (slot 0 = the solo spawn, slots 1-3 = the
  crosswalk nearest the mirror of it, >= 2 road pitches apart); `meta` per seat is sanitized to the fresh pool;
  `w.gates.unlocked = 4` (no size locks); `w.vs = createVsWorld(city)` (phase `'countdown'`, `startT = VS.countdownS`).
* After creation the cursor is bound to `view` (default 0).

---

## 3. The cursor (bindPlayer)

```ts
bindPlayer(w, slot): PlayerState      // cur = slot; titan/titanId/upgrades/ult/tally/meta/input/director/pl alias players[slot]
unbindPlayer(w): void                 // VS world phases: cur = -1, cursor falls back to slot 0; NO-OP in solo
withPlayer(w, slot, fn): T            // bind, run, then restore the previous state (bound slot OR unbound)
emitAs(w, slot, ev): void             // push ev with an explicit p (does not touch the binding)
setViewSlot(w, slot): void            // app/view: follow a seat (rebinds the cursor); the sim never reads w.view
assertBound(w, where) / setBindAsserts(on)   // dev assert: throws if cur < 0 when asserts are on
```

Rules (these are what keeps solo identical and VS correct):

1. **Mutate through the cursor, never replace it.** `w.titan.hp -= x` is right; `w.titan = ...` is silently undone by
   the next `bindPlayer`. (No code in the tree replaces a cursor field; harness probes only assign `w.input`, which
   is fine because they do not go through `stepWorldN`.)
2. **Solo never unbinds.** `cur` is always 0, so solo world-scoped steps push events with `p = 0` and every solo
   system sees exactly what it saw before.
3. **VS world-scoped phases run UNBOUND** (`cur = -1`). The cursor fields then point at **slot 0** as a deterministic
   fallback (identical on every peer, so a mistake is wrong but never a desync). It is only a fallback for code not
   converted yet: world-scoped code in VS must name its target titan(s) explicitly (loop `w.players`) and bind an owner
   (`withPlayer`) before resolving anything that belongs to a titan.
4. **The cursor never depends on the view.** Every tick starts with `bindPlayer(w, 0)`, binds each seat explicitly,
   and ends with `bindPlayer(w, w.view)` so the existing view / HUD / audio code (which reads `w.titan` after the step)
   shows the local seat. Never read cursor fields inside the sim and assume they are the view seat.
5. A titan-scoped system must work for the bound player only and must be called inside a bind (`assertBound` in dev).

---

## 4. The per-tick order (exact; `stepWorldN` in `src/core/world.ts`)

Player order is **always slot order 0..n-1**, in every per-player block, on every peer. Eliminated seats
(`players[i].vs.eliminated`) are skipped in every per-player block; dead / KO'd seats are NOT skipped (the systems
already early-out on `!titan.alive`).

| # | Step | Scope | Binding | Solo | VS |
|---|---|---|---|---|---|
| 0 | `if (run.result) return`; clear events; latch inputs (`null` = keep previous); `bindPlayer(0)`; `snapshotPrev` (all titans); `tick++; t += dt` | tick | slot 0 | yes | yes |
| 1 | **`vsBeginTick(w)`** | VS hook | unbound | - | yes |
| 2 | `stepCity`, `rebuildEnemyGrid` | world | solo 0 / VS unbound | yes | yes |
| 3 | per seat: `stepUltimate`, `stepTitan`, `stepDirector` | player | bound | yes | yes |
| 4 | **`vsAfterTitans(w)`**, **`vsStepWorld(w)`** (VS) / `stepGates`, `stepEndless` (solo) | VS hook / world | unbound | gates+endless | hooks |
| 5 | `stepEnemies`, `stepBoss`, `rebuildEnemyGrid`, `stepProjectiles`, `stepTelegraphs`, `stepHazards`, `stepPickups` | world | solo 0 / VS unbound | yes | yes |
| 6 | per seat: **`stepRail`** (VS only), `stepUpgrades` | player | bound | yes | yes |
| 7 | `flushGateBreach` (solo only) | world | 0 | yes | - |
| 8 | per seat: `processTriggers` (reads only `ev.p === cur`) | player | bound | yes | yes |
| 9 | `settleGateBreach` (solo only) | world | 0 | yes | - |
| 10 | `stepObjectives`, `stepPowerups` | world | solo 0 / VS unbound | yes | yes |
| 11 | per seat: `chargeUltimate`, `stepTally` (read only `ev.p === cur`) | player | bound | yes | yes |
| 12 | `flushGateBreach` (solo only) | world | 0 | yes | - |
| 13 | per seat: `peakRank` (player + world) | player | - | yes | yes |
| 14 | `checkRunEnd` (solo) / **`vsEndTick(w)`** (VS) | world / VS hook | 0 / unbound | yes | hook |
| 15 | `compact` every 30 ticks; `bindPlayer(w.view)` | tick | view | yes | yes |

Solo's call sequence is the old `stepWorld` verbatim: with one seat, one bind, and the VS branches skipped, every system
sees the same inputs in the same order (verified, §11).

### 4.1 The four VS hooks (`src/vs/step.ts`, B-VS fills them)

* `vsBeginTick`: phase clock + banners, COUNTDOWN freeze, ring schedule, respawn / spawn-protection / CLEARED timers,
  **the VS bot brain writing `w.players[i].input` for every `bot !== null` seat**, tender scheduling.
* `vsAfterTitans`: titan-titan body collision and STOMPED, PvP resolution queued by the titan steps, ring mortar paint.
* `vsStepWorld`: PUBLIC TENDER spawn / hunt / payout, the FRONT PAGE crown, demolition crews outside the ring.
  (Replaces `stepGates` + `stepEndless`, neither of which runs in VS; `stepBoss` still runs, for the tender rigs.)
* `vsEndTick`: KO -> EVICTED / elimination processing, assists, placement, VS SCORE, the winner. When the match is
  decided set `w.run.result = 'vs'`, `w.run.phase = 'vsend'`, `w.run.endT = w.t` and push `vsEnd`. **Do not push
  `runEnd` in VS** (its type stays `'clear'|'dead'`; solo-only sfx/app paths read it).

All four are called unbound and may read/write any `w.players[i]` directly. Determinism rules apply (slot order, `w.rng`
streams only, no Map/Set iteration order, no clocks, no engine Math: `npm run detban` scans `src/vs/*` automatically).

### 4.2 Inputs

```ts
stepWorld(w, input)               // SOLO + single-seat entry: input = slot 0's command (other seats keep their last)
stepWorldN(w, inputs: (TitanInput|null|undefined)[])   // inputs[i] = seat i; null/undefined/missing = keep previous
```
* "Keep previous" is the late-guest rule (netcode.md §7.1): the net layer passes `null` for a seat whose frame is late,
  or the repeated input explicitly; both end up the same.
* Bot seats: whatever the caller passes for a bot slot is latched, then `vsBeginTick` overwrites it with the brain's
  output. The net layer should pass `null` for bot seats.
* **Quantize before stepping** (netcode.md §6.3): the caller must feed `stepWorldN` the *decoded* wire input for every
  seat including its own.
* CARD RAIL input: `TitanInput.railPick` (1..3 = pick that card, edge) and `railReroll` (edge). Consumed by
  `stepRail`. The wire form is the 4th input byte.

---

## 5. Events

### 5.1 The sink
`w.events` is an `EventSink` (a real `Array` subclass: `length = 0`, indexing, `for..of` all work; `slice/filter/map`
return plain Arrays). `push()` stamps `ev.p = w.cur` on any event that has no `p` yet. An explicit `p` wins
(`emitAs`, or pre-set). None of the 105 push sites changed. Events carry no other new field.

### 5.2 What `p` means
`p` = the slot of the player whose systems **produced** the event (the bound player when it was pushed), `-1` = pushed in
a VS world phase with nobody bound. Conventions the lanes must keep so the readers work:

| Event family | `p` must be | Why |
|---|---|---|
| a titan's own actions: `titanAttack ability dash smash floorBreak propDestroyed buildingCollapse enemyHit enemyKilled pickup levelUp rankUp upgradeProc ultFire/Pulse/End arc vent bloom* wireDetonate ...` | the acting / collecting titan | triggers, UPROAR charge and the tally read only `p === cur` |
| `titanHurt`, `titanHeal`, `leash` | the **victim** (apply the hurt inside `withPlayer(w, victim, ...)`) | `chargeUltimate` charges the victim from `titanHurt`; `hurt` triggers fire for the victim |
| PvP: `rivalHit {from, to}` | the attacker (`from`) | the victim also gets its own `titanHurt` (p = victim) when HP is lost |
| world-only: `waveStart alert gateSpawn boss* telegraph* enemyFire rebuild vsPhase tender* crown ringStep vsEnd` | `-1` or the owning slot as the VS lane decides; tag it explicitly (`emitAs`) | |
| hostile damage to buildings (`noCredit`) | unchanged: still `noCredit: true`; nobody's triggers fire | |

### 5.3 New VS events (in `SimEventBody`, B-VS may add fields, never rename)
`vsPhase`, `rivalHit`, `evicted`, `eliminated`, `respawn`, `tenderMarker`, `tenderSpawn`, `tenderPaid`, `crown`,
`ringStep`, `vsEnd`; CARD RAIL: `railOffer`, `railPick`.

### 5.4 Readers
`processTriggers`, `processTriggersFrom`'s `runRange`, `chargeUltimate`, `stepTally` skip events whose `p !== w.cur`.
`stepTally` therefore counts only that player's kills / floors / ults. World-scoped readers (`bosses/index.ts` dash and
ultFire scans, `cityview`, views, `game.ts`) see **all** events and may use `ev.p` to pick a slot. `isOwnEvent(w, e)`
is the helper. A stand-in test world with no cursor (`cur`/`p` undefined) compares equal, so old probes still work.

---

## 6. Solo byte-identity: what is mode-gated

* Every VS hook, `stepRail`, `vsSpawnPoints`, the VS meta sanitising and `gates.unlocked = 4` run only when
  `w.mode === 'vs'`.
* The `VS` config block and `xpToNextFor / cumXpAtFor / paceStretchFor` are never read in solo; in solo the `For`
  helpers return the shipped `xpToNext / cumXpAt / PACE_STRETCH`.
* `creditTonnage / creditBlock` add the same numbers to `w.run` as the old `+=` sites.
* Event objects gain one numeric field `p` (always 0 in solo). Nothing in the sim, the hash or a probe reads it
  except the new `e.p !== w.cur` filters, which never fire in solo.
* **Never** make a solo code path depend on `w.mode`, `w.players.length` or `w.view`. If a system needs different VS
  behaviour, branch on `w.mode === 'vs'` and keep the solo branch byte-identical (GATE 2 hashes: §11).

---

## 7. VS config (`VS` in `src/core/config.ts`)

Every number from `vs_design.md` §3-§13 as one object: `phase` (240/420/600/645), `countdownS`, `takeoverUntilS` (180),
`seatColors`, `pacing`, `catchUp`, `crown`, `ko`, `pvp`, `kitPct`, `contact`, `tender` (+ `gates` schedule), `ring`,
`rail`, `director`, `score`, `bots`, `rematch`. All are **[proposal]** values for the VP pacing probe to tune.

Mode-aware pacing helpers (use these wherever sim code reads the XP / time curve and a `World` is in hand):
`xpToNextFor(w.mode, level)`, `cumXpAtFor(w.mode, level)`, `paceStretchFor(w.mode)`. B-TITAN / B-WORLD own switching
the call sites (`titansim.ts` xpToNext sites, `director.ts:176`, the `RANK_SCHEDULE_S` band: `VS.pacing.scheduleBand`
is false).

---

## 8. Lane checklists (what each lane must do against this contract)

**B-TITAN** (`src/titans/*`, `src/upgrades/*`, `meta/ultimate.ts tally.ts perks.ts`)
* Fill `upgrades/rail.ts stepRail` (§4 table row 6; contract in the file header).
* Titan-titan body collision and STOMPED: write the function, B-VS calls it from `vsAfterTitans`.
* `hurtTitan` must be called inside `withPlayer(w, victim, ...)` for any hostile / PvP hit.
* Switch `xpToNext` / `cumXpAt` / rubber-band sites to the VS curve via the `For` helpers; the schedule band and gate
  locks are off in VS.
* Known per-player hazards: `ultimate.ts FIRE` scratch is one slot (two ults firing on one tick: only the later is
  take-back-able; take-back should be disabled in VS since drafts never pause); module scratch buffers are fine (reset
  per call); WeakMaps keyed by `UpgradeState` (`engine.ts INDEX/PENDING`, `draft.ts OFFER_IS_CHEST/DELIVERED`) are
  already per player; `meta/goals.ts FILED` is app-level (solo).

**B-WORLD** (`ai/*`, `combat/*`, `city/*`, `meta/objectives powerups gates endless`)
* World-scoped systems run unbound in VS (§3 rule 3): every `w.titan` read in `enemies.ts` (22), `bosses/*` (~170),
  `damage.ts`, `projectiles/telegraphs/hazards`, `targeting.ts`, `pickups.ts`, `objectives.ts`, `powerups.ts`,
  `director.ts`, `citysim.ts` is currently "slot 0" in VS. Convert: per-enemy target slot, hostile shapes test every
  titan, titan-owned projectiles/hazards/telegraphs store `ownerSlot` and the step binds it (`withPlayer`) before
  resolving, pickups belong to a slot, the magnet goes to the nearest titan.
* `director.ts` is per player (`w.director` is the cursor): it runs inside the per-seat block (row 3), bound; use
  `VS.director`.
* `combat/damage.ts` `TickBook`: one `hits` Map and one `healed` counter per **World** per tick. The aggregated
  `enemyHit` event is stamped with whoever hit the enemy first that tick, and lifesteal's per-tick cap is shared:
  key both by owner slot.
* `combat/pickups.ts` `PickBook`, `ai/enemies.ts pendingByWorld`, `combat/spatial.ts grids` are world-scoped (fine).
* Tonnage / blocks credit: keep using `creditTonnage / creditBlock` and make sure the owner is bound.
* No size locks in VS (`gates.unlocked = 4`), `stepGates` / `stepEndless` are not called in VS; the PUBLIC TENDER
  replacement is B-VS's `vsStepWorld`, built on the boss framework (`w.boss`, a single slot) with B-WORLD's target /
  damage-share changes.

**B-VS** (`src/vs/*`)
* Own `types.ts`, `state.ts`, `step.ts` (§1). Fill the four hooks (§4.1). Keep every number in `VS`.
* The bot brain is a port of `_harness/bot.ts`; per-seat memory is `PlayerState.bot` (`BotMemory`), output is
  `w.players[i].input` written in `vsBeginTick`. Determinism: "dodge chance" is a hash of the telegraph id, never an
  rng draw.
* End the match through `vsEndTick` (§4.1).

**B-NET** (`src/net/*` except `portal.ts`)
* `simport.ts` `soloWorldPort` becomes a `vsWorldPort`: `createWorld({ mode: 'vs', players, biome, seed, view })`,
  `stepWorldN(w, inputs)`. Pass `null` for late / bot seats. **`hashWorld` must hash every player**
  (`for (const p of w.players)`: titan, tally, run, upgrades.owned, rail, vs) plus the world totals; today it hashes
  only the cursor (`w.titan`, `w.upgrades`). `probe_core.ts hashAll` is a worked example.
* Spawn / seat layout comes from the START message (titan, bot level per slot); `RunMeta` is ignored in VS except
  palette.
* A late joiner replays the input log through `stepWorldN` from tick 0.

**B-VIEW** (`src/render/*`, `ui/*`, `audio/*`, `game.ts`)
* After every `stepWorldN` the cursor is already on `w.view`, so existing `w.titan` reads show the local seat. To draw
  another seat (rival models, nameplates, spectate) read `w.players[i]` directly, or `setViewSlot` to follow one.
* Never call `stepWorld`'s solo "frozen for a draft" path in VS; the CARD RAIL is state + input words.
* Events carry `ev.p`: FX / audio pick the seat with it. VS ends with `run.result === 'vs'` + a `vsEnd` event (no
  `runEnd`).
* App calls into the sim outside a tick (cheats, drafts) run bound to the view seat (events get its `p`).

**B-QA** (`_harness/vs/*`, `_harness/net/*`)
* `probe_core.ts` is the template (cursor aliasing, stamping, per-seat tally == stamped events, view independence,
  determinism). The "per-player tallies add up" check lives there and should be reused by the VP probe.
* Turn `setBindAsserts(true)` on in VS probes.

---

## 9. Compatibility notes

* Every existing `createWorld({ titan, biome, seed, meta })` and `stepWorld(w, input)` call compiles and behaves as
  before. `RunOptions.titan` is now optional (required unless `players` is given; a solo world without either throws).
* `World.run.result` / `RunCtx.result` / `RunPhase` gained `'vs'` / `'vsend'`; the only code that had to change for it
  were three `?? 'timeout'` casts in solo probes.
* Stand-in test worlds (`probe_city.ts`, `probe_combat.ts`) may omit `players`: `creditTonnage / creditBlock` tolerate
  it and `e.p !== w.cur` compares `undefined === undefined`.
* `erasableSyntaxOnly` is on: no enums, no parameter properties. `EventSink` declares `host!:` as a plain field.

## 10. Known gaps (deliberately not B-CORE's)

* VS world-scoped systems still target slot 0 (§3 rule 3, B-WORLD).
* `damage.ts TickBook`, `ultimate.ts FIRE` single-slot scratch (B-WORLD / B-TITAN, §8).
* `vsSpawnPoints` is a simple mirror layout; B-VS may replace it.
* The VS hooks and `stepRail` are empty stubs: a 4-seat VS world today steps four independent titans in one city with
  the solo PvE aimed at seat 0, no PvP, no end condition.
* `src/net/simport.ts hashWorld` hashes only the cursor (B-NET, §8).

## 11. Verification (all run 2026-10-05 on the final tree; logs in `_harness/scratch/partb/CORE/`)

* `tsc --noEmit` over `src/**` + `_harness/*.ts` + `_harness/net/*.ts` (config `CORE/tsconfig.json`): clean. (The repo's own
  `npm run typecheck` also sweeps other sessions' `_harness/scratch` trees, which are not clean; unrelated.)
* `npm run detban`: PASS (62 sim files). `vite build`: OK.
* `npm run probe:core`: 1,643/1,643 checks (negative control: stamping every event p = 0 fails 11).
* **GATE 2 `--det 2`, solo, final tree** (`g2_fresh_final.txt`, `g2_full_final.txt`): hashes EQUAL the baselines
  (`RESUME/g2_fresh.txt`: molo/grideast `e9d2c850`, briarwick/lockwater `c678febb`; `RESUME/g2_full.txt`: `2b22b988`,
  `d5c43fb2`), 12/12 clears each, and the whole log is identical to the baseline apart from wall / ms timing. The only
  violation is the known seed-sensitive `bot died in 0 of 12 runs`.
  (Re-frozen 2026-10-06 after BRIARWICK's Size I lash floor was removed: the briarwick/lockwater hashes are now `4e31ce66`
  (fresh) and `75411b17` (full); the molo hashes `e9d2c850` / `2b22b988` are unchanged.)
* Every other probe, new tree vs a `git archive HEAD` copy run side by side (`out_new` / `out_head`): ai, boss3, city,
  combat, econ, endless, evo, gk, icons, map, meta, titan, ult, upg produce identical logs and exit codes (apart from
  timing). Pre-existing, unchanged: `city` rc 1 ("generateCity too slow" under CPU load), `map` rc 1 (whitestacks
  placement), `gk` rc 1 (3 known fails: 6c x2, 7).
* Net layer on the new World (`probe_net4.ts`, from a copy): 10 of 11 scenarios PASS at `--minutes 3`; `join` FAILs only
  because it needs a >= 4 min match (my flag), and PASSES at its default 4 min.
* Browser: production build of the final tree, `bootcheck.py --headless`: BOOTS CLEAN (0 console / page / GL errors,
  titan on a zebra, sim and frames advancing).
