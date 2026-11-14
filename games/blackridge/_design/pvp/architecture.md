# BLACKRIDGE — PVP CONVERSION: TECHNICAL ARCHITECTURE

Status: **BUILD CONTRACT**. Written 2026-08-20 against the code on disk.
Authority order unchanged: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` >
`_design/architecture.md` (the v1 freeze) > this document. Where this document adds to the
frozen contracts it does so as an explicit **freeze amendment** (Part 10) — never as an
assumption.

Scope: **how the code goes from a campaign mission driver to a three-mode match driver**,
specified precisely enough that 10 build lanes work in parallel without negotiating and
without two lanes owning one file.

Owner's directive (verbatim): *"the campaign is not much of a campaign, i fight two bad guys
and then i wandered for 2 minutes and foud nothing. Turn it into a PVP map instead. the same
map can be multiple modes - 1. 5v5 , 2. Capture the Flag, 3. FFA. Each game will have a
maximum of 10 players. At this point thats me, the tester, and 9 ai (npcs). They need to know
the full rules of each game, and fight to win/survive. We will start with the same MAP for all
3 modes. Campaign is now PVP and this game has no campaign mode atm. 30fps is fine."*

---

## PART 0 — THE FACT THAT CHANGES EVERYTHING, AND THE OBJECTIONS IT VOIDS

**One human + nine bots means the entire match runs in ONE browser, in one `sim`, on one
fixed-dt clock.** There is no network, no host, no guest, no replication, no envelope, no
interpolation buffer, no lag compensation, no client-authority trust boundary, no rewind
window, no relevance culling, no determinism handshake, no host migration.

`_design/expansion/pvp_design.md` §1.2 excluded two of the owner's three modes, and both
exclusions were netcode arguments:

> *"**Free-for-all** — the spawn director's core signal is team influence (Part 2.4); FFA
> spawning is a genuinely different algorithm and would ship worse."*
> *"**Objective modes with carried flags** — carrier state is the hardest thing to replicate
> under client authority (E4); a desynced flag is an unloseable match."*

**Both objections are VOID under this brief, and I rely on that in Parts 3 and 4:**

- The carried-flag objection was *entirely* replication ("a desynced flag"). With one
  simulation there is nothing to desync. Flag carriage becomes what it actually is in a
  local sim: three enum values and a carrier id (Part 3).
- The FFA objection was that the influence map's signal is *team* sign. It still is — FFA is
  modelled as "every actor is its own team" (Part 2.4), which makes the influence field
  *per-spawning-actor* instead of *per-team*. That is a parameter of the same algorithm, not
  a second algorithm (Part 4.6). It is roughly 25 lines.

Everything in `pvp_design.md` **PART 6 (fairness/anti-cheat)** and **§1.0.1 (transport
budget)** is therefore out of scope for this build and must not be implemented. What survives
from that document and is implemented here: **PART 2** (spawn director) in full, **PART 3.0**
(carve doctrine) and **§3.3** (the Lanternwalk carve) for the arena, **PART 4** balance deltas
(deferred, Part 9), **PART 5** match flow, and **§7.3** (the team-AI change list).

**30 fps is the accepted target.** Nothing in this plan assumes a 60 Hz *render*. The sim
still steps at a fixed `dt = 1/60` exactly (`core/sim/sim.js:34`) — that is the determinism
contract, not a frame rate — and boot's accumulator already runs up to 5 sim steps per
rendered frame (`_design/architecture.md` §5). At 30 fps that is 2 steps/frame, well inside
the clamp. **No sim tick rate change. No dt change.** Anyone proposing a 30 Hz sim to "save
CPU" is proposing to invalidate every seeded battery in the repo.

### 0.1 Evidence ledger (verified on disk this session)

Every load-bearing claim below traces to a file read in this session.

**E1 — the mission driver's frozen surface is exactly three methods.**
`core/sim/mission.js:3-4`: *"Frozen exports makeMission(content, emit) {start, tick,
forfeit}"*. `core/sim/sim.js:304` constructs it (`if (content) sim.mission = makeMission(content, sim.emit)`),
`sim.js:174` ticks it (`if (sim.mission && state.phase !== "menu") sim.mission.tick(sim)`),
`runtime/boot.js:214` forfeits it, `boot.js:274-275` starts it. **A match driver that exports
the same three methods drops into all four call sites unchanged.** This is the single most
important structural fact in this plan.

**E2 — there is a precedent for the sim calling back into the driver.**
`core/sim/damage.js:50`: `if (sim.mission) sim.mission.onPlayerDeath(sim);`. Death
notification from `damage.js` into the driver is an established pattern, not an invention.

**E3 — the view already reaps actors that vanish from `state.bots`.**
`core/chars/soldiers.js:705`: `if (!bot) { removeActor(rec.botId); continue; } // checkpoint restore reap`.
Consequence: **respawn-by-new-botId needs ZERO edits to `soldiers.js`.** Corpse removal is a
`state.bots` splice; the view disposes the actor on the next frame by itself.

**E4 — there is no team concept anywhere in the sim.** Confirmed again this session:
`core/sim/damage.js:28` signs `applyDamage(sim, who, amount, attacker, part, src)` with no
team parameter and no friendly-fire branch; `core/ai/perception.js:69` reads
`const player = S.player;` as *the* target and `:112` writes `P.lastKnown = player.pos.slice()`.
`core/ai/botfsm.js` reads `sim.state.player` at lines 189, 219, 361, 474, 560, 615, 955.
**Generalising "the player" into "an enemy actor" is the largest single change in this plan.**

**E5 — squad arbitration is already keyed by `bot.squadId`, not by a global.**
`core/ai/squad.js:58-70` (`function entry(sqId)`) keeps a `squads` Map keyed by squad id, and
`squadIdOf(botId)` reads `b.squadId`. Consequence: **two teams do not need two squad
instances.** Distinct `squadId` values per team already isolate fire tokens, flank claims and
last-known sharing. This is materially smaller than `pvp_design.md` §7.3.4 assumed.

**E6 — the contract gate exists and is the model to copy.**
`core/sim/mission.js:28-135` `validateContent()` walks every spawn/wave/objective/archetype/
node/weapon/scenario reference and `:140-143` throws at construction on any dangling ref. Node
and weapon halves run at `start()` (`:405-406`) once colliders and weapons exist. The PVP
content gate (Part 6.3) is a re-authoring of this function, not a new idea.

**E7 — scenario poses reference mission wave spawn ids.**
`content.json` S1/S2/S3/S8 use `{"spawn": "sp_plaza_a2"}` etc.; `core/test/scenarios.js:229-236`
resolves them through `findSpawn(id)` against `content.mission.spawns.waves`. **Deleting the
waves dangles four scenarios and would break the shot battery.** Part 7.1 specifies the fix.

**E8 — the harness entry points.** `_harness/perfprobe.py:541` calls
`__FPS__.__test.startMission({seed})` then `:551` `autoplay('rusher', 30)`;
`_harness/playprobe.py:75-78` calls `startMission({seed})` then `autoplay(profile, seconds)`;
`_harness/shotbattery.py:268` requires `['setScenario','capture','hud','state','counters']`
on the test surface. **`startMission` must survive as a name** (Part 7.2).

**E9 — engine caps.** `core/sim/mission.js:23` `ENGINE_BOT_CAP = 12`;
`core/ai/botfsm.js:52` `MAX_THINKS = 4`; `_design/architecture.md` §8 budgets sim tick ≤ 3 ms
with AI ≤ 1.5 ms at 12 bots. **Nine bots is inside the budget that already ships**, but nine
bots *all alive all match* is a heavier steady state than the campaign's waves — Part 8 gates
it with a measurement, not an assurance.

**E10 — nav exposes exactly what the spawn director and the flags need.**
`core/ai/nav.js:426 findPath`, `:475 randomPoint`, `:499 reachable`, `:505 lightAt`. No nav
changes are required by this plan.

---

## PART 1 — THE MATCH DRIVER

### 1.1 The structural ruling

`core/sim/mission.js` is **deleted**. `core/match/match.js` replaces it and exports the same
frozen triple, so the four existing call sites (E1) do not move:

```js
export function makeMatch(content, emit, opts = {}) // → match  {start, tick, forfeit, …}
```

`core/sim/sim.js` changes in exactly one place:

```js
// was: if (content) sim.mission = makeMission(content, sim.emit);
if (content) {
  sim.match = makeMatch(content, sim.emit, { mode: opts.mode || "deathmatch", rng: rng });
  sim.mission = sim.match;   // the frozen name boot.js/damage.js/sim.step already use
}
```

**`sim.mission` and `sim.match` are the SAME object.** The alias is not decoration: it means
`boot.js:174` (`sim: () => sim`), `boot.js:214` (`mission.forfeit(sim)`), `boot.js:229`
(`ctx.mission()`), `sim.js:174` (tick slot 6) and `damage.js:50` all keep working with zero
edits. New code says `sim.match`; old code says `sim.mission`; there is one object.

**`sim.state.phase` keeps its frozen enum** (`'menu'|'infil'|'assault'|'exfil'|'won'|'lost'`,
`architecture.md` §3.5.1) and the match maps onto it so every existing consumer — HUD, audio
music stinger, boot's menu return, `isMissionLive(ctx)` at `core/hud/hud.js:43` — works
untouched:

| match phase | `sim.state.phase` | meaning |
|---|---|---|
| `warmup` | `infil` | 5 s pre-match, actors spawned + frozen, HUD countdown |
| `live` | `assault` | the match |
| `overtime` | `exfil` | sudden death |
| `ended` (human's team won / drew) | `won` | end screen |
| `ended` (human's team lost) | `lost` | end screen |

The true match phase lives at `sim.state.match.phase` and is what mode modules read.

### 1.2 `sim.state.match` — the new state block (frozen shape)

Added to `sim.state` alongside `player`/`bots`/`objectives`/`counters`. **Plain data only**
(JSON-safe: arrays, numbers, strings, booleans, null) so `sim.snapshot()` at `sim.js:181`
keeps working.

```js
sim.state.match = {
  modeId: 'deathmatch' | 'ctf' | 'ffa',
  phase:  'warmup' | 'live' | 'overtime' | 'ended',
  clock:  0.0,          // seconds inside the CURRENT phase
  elapsed: 0.0,         // seconds since 'live' began
  timeLeft: 600.0,      // seconds remaining in the current phase (0 if untimed)
  teams: [              // length 2 for team modes; length 10 for FFA
    { id: 0, name: 'BLACKRIDGE', tint: '#d9a441', score: 0, captures: 0, actors: [0,1,2,3,4] },
    { id: 1, name: 'VEKTOR',     tint: '#7c9fd0', score: 0, captures: 0, actors: [5,6,7,8,9] }
  ],
  actors: [ /* 10 roster slots, §1.3 */ ],
  flags: [ /* CTF only, Part 3 — [] in other modes */ ],
  result: null,         // null until 'ended': {result:'win'|'draw', winnerTeam, reason}
  spawnStress: 0,       // cumulative director relaxation steps (Part 4.4 gate reads it)
  mode: { /* mode-owned public sub-state, §1.6 */ }
};
```

### 1.3 The actor roster — the identity that survives death

The single most important modelling decision after teams. **A `botId` is a body; an `actorId`
is a player.** Bots die, their corpse lingers, the corpse is reaped from `state.bots`, and a
**new** `botId` is spawned for the same `actorId`. This is what makes E3 pay off (no
`soldiers.js` edits) and it is what makes a scoreboard possible.

```js
// sim.state.match.actors[i], i === actorId, 0..9
{
  actorId: 0,
  name: 'RAVEN 2-1',     // display name; killfeed + scoreboard read this
  kind: 'human' | 'bot',
  team: 0,               // int; in FFA team === actorId
  archetype: 'rifleman_a', // content.archetypes key (carries the team tint, §2.6)
  band: 'regular',       // combat_spec §5.5 difficulty band
  who: 'P' | <botId>,    // the CURRENT body. 'P' never changes; bot bodies rotate.
  alive: true,
  score: 0, kills: 0, deaths: 0, assists: 0, streak: 0, bestStreak: 0,
  captures: 0, returns: 0,       // CTF; 0 elsewhere
  respawnAtT: -1,                // sim time the respawn director fires; -1 = not queued
  protectedUntilT: -1,           // spawn protection expiry (Part 4.5)
  spawnPointId: null,            // last point used (recency scoring)
  duty: null                     // Part 5 — the mode's instruction to this actor's brain
}
```

`match.actorOf(who)` maps `'P'|botId → actor` through a private `Map` rebuilt on every
respawn (never a linear scan in the tick).

**The human is always `actorId 0`, always `who === 'P'`, always `team 0` in team modes.** The
owner is the tester; putting them on a fixed team makes every screenshot, probe and bug report
comparable across runs. In FFA `team === 0` too, because in FFA `team === actorId` and the
human is actor 0 — the same rule, no special case.

### 1.4 Match tick order (FROZEN — probes reason about this)

Called from `sim.js` tick slot 6, once per sim step, `dt = 1/60`:

```
1.  clock advance; phase transitions (warmup→live→overtime→ended)
2.  spawn-protection expiry + cancellation (fire/ADS/grenade/objective-touch)
3.  respawn director: drain the respawn queue (Part 4)
4.  mode.tick(m, dt)                      ← objective entities live here (flags, zones)
5.  duty assignment: mode.assignDuties(m) at 2 Hz (every 30 ticks, phase-offset by actorId)
6.  scoring commit (queued deltas → team/actor totals, `match:score` events)
7.  mode.checkWin(m) → if non-null, endMatch()
8.  influence grid rebuild at 5 Hz (every 12 ticks)
9.  sim.state.objectives refresh from mode.hudModel(m).objectives
```

Nothing in steps 1–9 allocates per tick after `start()`. The scoring queue, the respawn queue
and the influence grid are preallocated arrays reused in place — the same discipline
`mission.js:181-189` uses for `sim.state.objectives`.

### 1.5 The frozen match surface

```js
match.start(sim)      // full contract gate w/ colliders+weapons (E6), build roster,
                      // seed teams, spawn all 10 actors, emit match:start, enter 'warmup'
match.tick(sim)       // §1.4
match.forfeit(sim)    // the REAL loss path (doctrine §6): ends the match with the human's
                      // team marked forfeited. boot.js:214 (ESC → Abandon) already calls it.

// --- additions (private, documented for the other lanes) ---
match.onActorDeath(sim, ev)      // called by damage.js — the E2 pattern, generalised
match.onPlayerDeath(sim)         // KEPT as a thin alias so damage.js:50 needs no rename
match.freeze(on)                 // halt clock + respawns + mode.tick (scenarios, Part 7.1)
match.mode                       // the live mode module (read-only)
match.snapshot()                 // JSON-safe match state (probes)
match.setMode(id)                // pre-start only; throws if phase !== 'menu'
match.drainRadio()               // returns [] — kept so hud.js:1040 drainRadioInto() lives
match.drainSetPieces()           // returns [] — kept so the A6 blackout drain lives
```

`drainRadio`/`drainSetPieces` returning `[]` is deliberate: the v2.2 freeze amendment (b) made
those drains the contract for HUD subtitles and the blackout set-piece. Returning empty arrays
retires the campaign content without editing two view files that a concurrent wave may hold.

### 1.6 THE MODE MODULE INTERFACE (the contract three agents build against)

One file per mode under `core/match/modes/`. A mode module is **THREE-free, allocation-free
after `start`, and deterministic** — it may only draw randomness from `m.rng.match`.

```js
// core/match/modes/<id>.js
export function createMode(ctx) // → mode
// ctx (constructed once by match.js, BEFORE any sim exists):
//   { id, content, arena, rules, rng, log }
//   rules = deep-merge(mode.defaults, content.modes[id])  — mode reads m.rules at runtime
```

The returned object. **Only `id`, `teamCount`, `defaults`, `start`, `tick` and `checkWin` are
required**; `match.js` null-checks every other member, so FFA can be 90 lines and CTF can be
400 without either agent negotiating with the other.

```js
mode.id           : string                     // must equal the filename stem
mode.teamCount    : 2 | 'perActor'             // 'perActor' ⇒ FFA teaming (Part 2.4)
mode.defaults     : object                     // rule numbers; content.modes[id] overrides

// ---- lifecycle -----------------------------------------------------------
mode.start(m)                    // after roster + first spawns exist; seed mode.state
mode.tick(m, dt)                 // slot 4. Objective entities update HERE.
mode.end(m, outcome)             // outcome = {result, winnerTeam, reason}; final bookkeeping

// ---- event sinks (all optional; match.js calls them, never the bridge) ----
mode.onSpawn(m, ev)              // ev {actor, pointId, pos:[3], yaw, protectedUntilT}
mode.onKill(m, ev)               // ev {attacker, victim, headshot, weaponId, assists:[actorId],
                                 //     attackerTeam, victimTeam, pos:[3], t}
                                 //     attacker === null for world/self/fall deaths
mode.onDeath(m, ev)              // ev {actor, attacker, pos:[3], t} — fires for EVERY death,
                                 //     including suicides and friendly-fire-suppressed cases.
                                 //     Drop-the-flag logic lives here, not in onKill.
mode.onObjectiveEvent(m, ev)     // ev {kind, actor, target, pos, t} — the mode's own fan-in:
                                 //     match.js re-dispatches anything the mode emitted via
                                 //     m.objectiveEvent(...) so a mode has ONE place that
                                 //     handles 'flag_taken' whether it came from tick or touch

// ---- scoring -------------------------------------------------------------
// Modes NEVER write scores directly. They call m.addScore / m.addTeamScore, which queue
// deltas that slot 6 commits and emits. This keeps score mutation in one auditable place
// and makes the "score is monotone non-decreasing" selftest assertion possible.
mode.scoreForKill(m, ev) → [{actor, points, reason}, ...]   // default: 100 kill / 25 assist

// ---- winning -------------------------------------------------------------
mode.checkWin(m) → null | { result:'win'|'draw', winnerTeam:int|null, reason:string }
                                 // called EVERY tick (slot 7). Returning non-null ends the
                                 // match immediately and irrevocably.

// ---- the bots-understand-the-rules seam (Part 5) -------------------------
mode.assignDuties(m)             // 2 Hz. Sets actor.duty for every living BOT actor.
                                 // This is where "the bots know the rules" is implemented.

// ---- the spawn director's mode hooks (Part 4) ----------------------------
mode.spawnVeto(m, actor, point) → bool      // V7: mode-specific hard veto
mode.spawnBias(m, actor, point) → 0..1      // the 14 × modeTerm score term

// ---- the view's data (Part 6.4) ------------------------------------------
mode.hudModel(m) → { headline, clockS, us, them, objectives:[{id,label,state}], markers:[…] }
                                 // PLAIN data, rebuilt into a preallocated object; the
                                 // match HUD reads it each frame. No THREE, no functions.
```

**Match facade `m` (what mode modules are handed, and the ONLY sim access they get):**

```js
m.sim, m.state          // state === sim.state.match
m.rules, m.arena, m.rng // rng.match — the deterministic mode stream (Part 10 amendment c)
m.time                  // sim.state.time
m.elapsed, m.timeLeft, m.phase
m.actors                // the roster array
m.actorOf(who)          // 'P'|botId → actor|null
m.bodyOf(actor)         // actor → sim player object or bot record (live, do not retain)
m.posOf(actor)          // [3] — the body's position, or its death position if dead
m.teamOf(who)           // int
m.areEnemies(a, b)      // bool — the ONE truth (Part 2.2)
m.living(team)          // → array of living actors on team (preallocated scratch, do not keep)
m.livingEnemiesOf(actor)
m.addScore(actor, points, reason)
m.addTeamScore(team, points, reason)
m.requestRespawn(actor, delayS)   // queue; the director picks the point
m.setDuty(actor, duty)            // Part 5
m.objectiveEvent(kind, data)      // fan-in to mode.onObjectiveEvent + emits `objective`
m.emit(type, data)                // the sim bus (frozen vocabulary + Part 10 additions)
m.endMatch(outcome)               // for modes that end outside checkWin (rare; prefer checkWin)
m.world, m.nav, m.colliders, m.weapons
m.spawnPoints, m.clusters         // the authored arena data
m.dist(a, b)                      // horizontal metres between two actors/positions
```

**Rules that make three parallel implementations safe:**

1. A mode module **may not import another mode module**, `sim.js`, `botfsm.js`, `hud.js`, or
   anything under `core/view/`, `core/render/`, `core/fx/`, `core/chars/`.
2. A mode module **may not write `sim.state`** except through `m.*` helpers and its own
   `m.state.mode` sub-object. Writing `sim.state.player.hp` from a mode is a defect.
3. A mode module **may not read wall-clock time** (`Date.now`, `performance.now`).
4. A mode module **owns exactly two files**: `modes/<id>.js` and `modes/<id>.selftest.cjs`.
   Its rule numbers live in `mode.defaults` inside its own file. It does **not** edit
   `content.json` — the data lane authors the `content.modes[<id>]` override block once, in
   wave 1, from the table each mode agent publishes in this document's Part 8.
5. The registry is written **once** by the match-core lane and then frozen:
   ```js
   // core/match/match.js — written in wave 1, never edited again
   import { createMode as deathmatch } from "./modes/deathmatch.js";
   import { createMode as ctf }        from "./modes/ctf.js";
   import { createMode as ffa }        from "./modes/ffa.js";
   const MODES = { deathmatch, ctf, ffa };
   ```
   Three imports exist from day one; the three files can land in any order because
   `match.js`'s gate reports a missing mode as a content error, not a crash.

### 1.7 The three modes' rule tables (authored here so the mode agents do not negotiate)

Adapted from `pvp_design.md` PART 1 for a 10-actor, single-browser match. Deviations from that
document are marked **[Δ]** with the reason.

#### `deathmatch` — 5v5 team deathmatch

| Rule | Value | Note |
|---|---|---|
| Teams | 2 × 5 | **[Δ]** 6v6 → 5v5: the owner specified 10 actors |
| Score limit | **50 kills** | **[Δ]** 75 → 50: 10 actors, not 12, and the campaign's ~8 min session length is the target |
| Time limit | **8:00** | **[Δ]** 10:00 → 8:00, same reason |
| Respawn delay | 4.0 s (0 s on the first spawn of the match) | as designed |
| Score | 100/kill, 25/assist (≥40 dmg within 5 s), 0/death | as designed |
| Win | first team to 50, else highest at 0:00; tie → 2:00 overtime, first kill wins; still tied → draw | as designed |
| Spawns | fully dynamic, both teams (Part 4) | as designed |

#### `ctf` — capture the flag

| Rule | Value |
|---|---|
| Teams | 2 × 5 |
| Capture limit | **3 captures** |
| Time limit | **10:00** |
| Respawn delay | **5.0 s** (a lost fight must cost a rotation) |
| Pickup | horizontal ≤ **1.2 m** and vertical ≤ **2.0 m** from the flag; instant, no hold |
| Capture | carrier touches **own** flag stand while own flag is `home` |
| Return | own-team actor touches own `dropped` flag → instant return home |
| Drop | on carrier death, at `world.supportAt(deathPos)`; also on carrier leaving `arena.bounds` |
| Auto-return | **30 s** after the drop |
| Score | 100/kill, 25/assist, **200/capture**, **50/return**, **75/carrier-kill** |
| Win | first to 3, else most captures at 0:00; tie → 2:00 overtime, first capture wins; still tied → draw |
| Flag stands | `content.flags[].home` — Part 6.2 |

#### `ffa` — free-for-all

| Rule | Value |
|---|---|
| Teams | 10 × 1 (`teamCount: 'perActor'`) |
| Score limit | **25 kills** |
| Time limit | **8:00** |
| Respawn delay | **3.0 s** (nobody has a team to wait for) |
| Score | 100/kill, **no assists** (there are no allies to assist — a mode with no teams should not pay for teamwork) |
| Win | first to 25, else highest at 0:00; tie → 2:00 overtime, first kill wins; tie of ≥2 at 0 kills → draw |
| Spawns | Part 4.6 FFA variant |

---

## PART 2 — THE TEAM MODEL

### 2.1 Assignment

`match.start()` builds the roster deterministically from `content.teams` + `content.botRoster`
and the chosen mode:

- Actor 0 = the human, `who:'P'`, `team: 0`.
- Actors 1–9 = bots, assigned to teams by the mode's `teamCount`:
  - `2` → actors 1–4 join team 0 (the human's team), actors 5–9 form team 1.
  - `'perActor'` → `team = actorId` for all ten.
- Archetype and band per bot come from `content.botRoster[i]` (authored, not random) so a
  seeded match is reproducible and so team composition is balanced by construction: each
  5-actor team gets **2 rifleman, 2 cqb, 1 marksman** in team modes; FFA uses the same nine
  archetypes in a fixed order.
- Bot difficulty band default **`regular`** for every bot (`combat_spec` §5.5: 500–700 ms
  reaction, σ 0.022). `veteran` is not used in PVP — `pvp_design.md` §7.2's reasoning holds
  exactly as written and is not netcode-dependent.

### 2.2 `areEnemies` — the one truth

```js
// core/match/roster.js — the ONLY place this rule exists.
export function areEnemies(a, b) { return a != null && b != null && a !== b && a.team !== b.team; }
```

Everything that needs "is this a valid target / a valid damage recipient / an enemy for spawn
scoring" calls it via `m.areEnemies` or `sim.match.areEnemies`. **A second inline `!==` team
comparison anywhere in the codebase is a defect**, because it is how the AI and the damage
system drift apart.

Cheap path for the hot loops: `bot.team` is also mirrored onto every bot record and onto
`sim.state.player.team` at spawn, so `perception.js` and `ballistics.js` can compare ints
without a roster lookup. The mirror is written in exactly one function
(`roster.bindBody(actor, body)`) and never elsewhere.

### 2.3 Friendly fire

**OFF between different actors on the same team. ON for self-damage at 100%.**
Implemented in `core/sim/damage.js`, at the top of `applyDamage`, before any state mutation:

```js
if (attacker != null && attacker !== who && sim.match && sim.match.sameTeam(attacker, who)) {
  return;   // no damage, no hurt event, no flinch, no counters, no perception stimulus
}
```

Returning *before* the `hurt` emit is deliberate and load-bearing: `perception.js:174-181`
turns "being hit" into instant awareness 1.0 toward the attacker, so a teammate's stray round
would otherwise hand a bot a free wallhack toward its own ally.

Self-damage stays live so grenade discipline is real (`cmd.grenade`, R6). A bot that frags
itself is a bot the player gets to laugh at; a bot that cannot is a bot with a free weapon.

**Blocking is unaffected.** `ballistics.js` still raycasts against teammate capsules — a
teammate's body stops your bullet. This is the correct behaviour (it makes crowded lanes
matter) and it means **`core/sim/ballistics.js` is not edited by this plan at all**, which
matters for Part 9.

### 2.4 FFA is the degenerate case, and yes, we model it that way

**Ruling: FFA is implemented as ten teams of one.** `team === actorId`. There is no `if (ffa)`
branch in `damage.js`, `perception.js`, `botfsm.js`, `squad.js`, the spawn director, the
scoreboard, or the killfeed.

What that simplifies, concretely:

| System | Team modes | FFA — what changes |
|---|---|---|
| `areEnemies` | `a.team !== b.team` | identical; every pair differs |
| Friendly fire | suppressed same-team | never triggers (nobody shares a team) |
| Perception target list | enemy-team actors | all nine others; same code |
| `squad.js` | `squadId = 't0_a'…'t1_b'` | `squadId = 'ffa_<actorId>'` → each bot is its own squad; **`squad.js` needs no FFA branch** (E5) |
| Killfeed / scoreboard | grouped by team | grouped by team = ten groups of one; the UI collapses `teams.length > 2` into a single ranked list |
| Spawn director | team influence field | **the one real difference**: the influence field is built *per spawning actor* rather than per team (Part 4.6), ~25 lines |
| Duty assignment | mode-specific roles | `ffa.assignDuties` sets every bot to `roam`/`hunt`; simplest of the three |

The **only** place FFA is not free is the influence map's sign convention, and Part 4.6
specifies it as a parameter of the same function.

### 2.5 How `team` threads through each subsystem

| System | Change | Owner lane |
|---|---|---|
| **Damage** (`damage.js`) | FF gate (§2.3); kill/assist attribution to `actorId` not `'P'`; `damageLog` ring per body for assists; corpse reap timer; `counters.kills` now counts only the human's kills (so the existing HUD/probe semantics survive) | W1 |
| **Perception** (`perception.js`) | candidate list = enemy actors, not `S.player`; per-candidate awareness meters; target selection + hysteresis (Part 5.2) | W3 |
| **Bot brain** (`botfsm.js`) | every `sim.state.player` read (lines 189/219/361/474/560/615/955, E4) becomes `bot.percept.targetBody`; cover scoring gains the duty term (Part 5.3) | W3 |
| **Squad** (`squad.js`) | fire-token cap becomes **per target**, and only enforced when the target is the human (Part 5.4); `squadId` values come from the roster | W3 |
| **HUD** | team score bar, killfeed with team colours, scoreboard, objective markers — all in NEW files (`match_hud.js`, `scoreboard.js`); **`hud.js` is not edited in waves 1–2** | W8 |
| **Spawns** | the whole director is team-aware by construction | W2 |
| **View / characters** | **no change.** Team read ships as per-team archetype tints (§2.6) | — |

### 2.6 Visual team read without touching the renderer

`pvp_design.md` §3.1 wants a faction rim tint on the character material. That is a material
change with a real shader-permutation risk (`architecture.md` §8: `programs delta == 0` is a
FAIL-class gate) and `core/chars/*` sits next to files a concurrent wave is holding.

**v1 ruling: team identity ships through the `tint` field that already exists in
`content.archetypes`** (`content.json:246`, `:251`, `:257`). The data lane authors six
archetype entries instead of three:

```
rifleman_a / cqb_a / marksman_a  → tint '#c8a05a' (warm, team 0)
rifleman_b / cqb_b / marksman_b  → tint '#6f90bd' (cool, team 1)
```

Same `bodyGlb`, same weapon, same numbers. Zero code changes, zero new materials, zero new
programs. FFA uses the warm set for the human's opponents and gives the human no body anyway.

**This is a stopgap and is flagged as one.** The proper rim term (visible from behind, which a
diffuse tint is not) is Part 9's deferred list, scheduled after the concurrent aim wave frees
the render files.

---

## PART 3 — FLAG ENTITIES (CTF)

Sim-side, THREE-free, deterministic, per doctrine §4. `core/match/flags.js` is owned by the
CTF lane and imported only by `modes/ctf.js`.

### 3.1 State

```js
// sim.state.match.flags — length 2 in CTF, [] in every other mode. Plain data.
{
  id: 'flag_t0',
  team: 0,                     // the team that DEFENDS it; the other team captures it
  home: [-3.0, 0.0, 14.0],     // the stand; authored in content.flags[]
  pos:  [-3.0, 0.0, 14.0],     // current world position (== home when 'home';
                               //  == carrier body pos, refreshed every tick, when 'carried')
  state: 'home' | 'carried' | 'dropped',
  carrier: null,               // actorId of the carrier, or null
  carrierWho: null,            // 'P' | botId — the BODY, so the view can attach without a lookup
  takenT: -1,                  // sim time carriage began
  droppedT: -1,                // sim time of the drop
  returnAtT: -1,               // sim time of the auto-return (droppedT + 30)
  lastCarrierTeam: null,       // for the carrier-kill bonus
  touchLockUntilT: -1          // 0.35 s re-touch lock, §3.4
}
```

**Invariant, asserted every tick by the CTF selftest:** exactly one of
`{state==='home' && carrier===null}`, `{state==='carried' && carrier!==null}`,
`{state==='dropped' && carrier===null}` holds for each flag, and no actor carries two flags.

### 3.2 Transitions (all inside `ctf.tick` / `ctf.onDeath`)

| From | Trigger | To | Effects |
|---|---|---|---|
| `home` | enemy actor within 1.2 m h / 2.0 m v, `phase==='live'` | `carried` | `flag{state:'taken'}`; carrier `duty` → `carry`; enemy team's `assignDuties` flips to `intercept` |
| `carried` | carrier dies (`onDeath`) | `dropped` | pos = `world.supportAt(deathPos)`; `returnAtT = t + 30`; killer gets the 75-pt carrier bonus |
| `carried` | carrier leaves `arena.bounds` (should be impossible; Part 6.5 clamps) | `dropped` | as above, plus a warning counter |
| `carried` | carrier touches own flag stand while own flag is `home` | `home` | capture: +1 team capture, +200 actor score, flag teleports home, `flag{state:'captured'}` |
| `dropped` | **defending**-team actor within touch radius | `home` | return: +50 actor score, `flag{state:'returned'}` |
| `dropped` | **attacking**-team actor within touch radius | `carried` | pickup, `flag{state:'taken'}` |
| `dropped` | `t >= returnAtT` | `home` | `flag{state:'reset', reason:'timeout'}` |
| `dropped` | stuck (§3.4) | `home` | `flag{state:'reset', reason:'unreachable'}` |
| any | `phase → 'ended'` or `match.freeze(true)` | frozen | no transitions while frozen |

While `carried`, `flag.pos` is written from the carrier body's position **every tick** in
`ctf.tick`. The view therefore never needs an event to track a moving flag — continuous data
is state, not events (`architecture.md` §4).

### 3.3 The events the view consumes

**One new event type**, `flag`, with a `state` discriminator (Part 10 amendment b). One type
rather than five keeps the freeze small and lets one `bridge.register("flag", …)` handle
everything.

```js
{ type: 'flag', data: {
    flagId: 'flag_t0', team: 0,
    state: 'taken' | 'dropped' | 'returned' | 'captured' | 'reset',
    by: <actorId>|null,          // who caused it
    byWho: 'P'|<botId>|null,     // the body, for positional audio
    carrier: <actorId>|null,     // after the transition
    pos: [3],                    // where it happened
    reason: 'timeout'|'unreachable'|null
} }
```

Consumers:
- `core/match/flagview.js` (view-side, W8): a **pooled** pair of flag objects created at boot
  (never `new` in a handler); on `taken` it parents to the carrier's actor root through
  `soldiers`' public accessor or, failing that, follows `flag.pos` each frame; on
  `dropped/returned/captured/reset` it re-places. **The default implementation follows
  `sim.state.match.flags[i].pos` every frame and never reparents** — parenting to a skinned
  actor is a bind-pose trap (doctrine §1) and following a position costs nothing.
- `core/hud/match_hud.js` (W8): the flag status strip and the "YOUR FLAG IS OUT" banner.
- `core/audio/*`: no edit — the audio lane may register `flag` later; nothing breaks if it
  never does.

### 3.4 Reset, stuck, and the anti-degenerate rules

Named because each one is a real way a CTF match becomes unwinnable and unloseable:

1. **Unreachable drop.** After a drop, `nav.reachable(flag.pos, flag.home)` is evaluated once
   (E10). False → immediate `reset` with `reason:'unreachable'`. This catches a body that dies
   on a roof, in a gap, or on the wrong side of a carve wall.
2. **Out of bounds / below the world.** `flag.pos` outside `arena.bounds`, or
   `pos[1] < bounds.min[1]` → immediate `reset`.
3. **Auto-return 30 s.** Covers everything the first two miss.
4. **Re-touch lock 0.35 s.** After any transition, that flag ignores touches for 0.35 s. Without
   it, a carrier dying on their own stand can capture-and-drop in consecutive ticks.
5. **No carry-two.** An actor already carrying a flag cannot take the other one. In a 2-flag
   CTF this can only happen through a bug, and the invariant assert catches it.
6. **Stalemate breaker.** If both flags are `carried` for **60 continuous seconds**, both
   carriers' positions are published to every actor's `duty.goal` (bots converge) and the HUD
   posts `FLAGS CONTESTED`. No teleport, no forced reset — the match ends on the clock if it
   must, and `checkWin`'s time limit guarantees it does.
7. **Frozen during `warmup` and after `ended`.** No touches, no timers.

### 3.5 The doctrine boundary, stated

`core/match/flags.js` imports **nothing** but `core/match/roster.js` helpers. It has no
`three` import, runs under Node, and its whole behaviour is exercised by
`core/match/modes/ctf.selftest.cjs`. `core/match/flagview.js` imports `three` and reads
`sim.state.match.flags` + the `flag` event, and writes nothing back. That split is the
doctrine §4 line and it is not negotiable.

---

## PART 4 — THE SPAWN SYSTEM

Implements `pvp_design.md` PART 2 in full. Two files, both THREE-free and Node-testable:
`core/match/spawns.js` (director) and `core/match/influence.js` (grid). Nothing else in the
repo may choose a spawn point.

Because there is no host and no client, `pvp_design.md`'s host-authority machinery
(host-owned selection, `spawn{actorId,pointId,t}` reliable sends, host migration re-arm with
×1.4 widened vetoes) is **deleted, not implemented**. The director is a pure function of sim
state plus one deterministic RNG stream.

### 4.1 Authored data

`content.spawnPoints[]`, exactly as `pvp_design.md` §2.1:

```jsonc
{ "id": "sp_south_04", "pos": [-8.0, 0.0, 14.5], "yaw": 3.14,
  "cluster": "SC_SOUTH", "cover": 0.8, "zoneHint": "plaza_south" }
```

**Requirements, gate-checked by `tools/arena_probe.mjs` (Part 6.3):** 30–50 points; every
point nav-walkable; ≥ 2.0 m from any collider face; ≥ 8 m of unobstructed view along `yaw`;
every cluster ≥ 6 points spread over ≥ 250 m²; 4 clusters for Meridian Ward
(`SC_SOUTH`, `SC_NORTH`, `SC_EAST`, `SC_WEST` — the anchors are already specified metre-exact
in `pvp_design.md` §3.3 against the real `layout.js`, so the data lane transcribes rather than
invents).

### 4.2 Hard vetoes (evaluated first; any hit rejects the point)

| # | Veto | Value |
|---|---|---|
| V1 | An enemy within | **22 m** |
| V2 | An enemy has LOS to head height 1.55 m at the point, within | **60 m** (`world.losBlocked`) |
| V3 | Point inside an enemy's view cone without LOS | **±35°, ≤ 40 m** |
| V4 | A friendly spawned at this point in the last | **1.5 s** |
| V5 | A live grenade, or an explosion in the last 1.5 s, within | **12 m** |
| V6 | A teammate died within 8 m of this point in the last | **5 s** |
| V7 | `mode.spawnVeto(m, actor, point)` returns true | mode-specific |

`V7` in each mode: `deathmatch` → always false. `ctf` → within **12 m of either flag's current
position**, and within **15 m of your own flag stand while your flag is `carried`** (so a
defender cannot spawn on top of a carrier who is escaping). `ffa` → always false.

**Relaxation ladder, exactly as designed, one step at a time, re-scoring after each:**
`V3 off → V6 off → V2 60→30 m → V1 22→14 m`. Every step increments
`sim.state.match.spawnStress`. If nothing survives the full ladder: spawn at the cluster
centroid with **3.0 s** protection instead of 1.5 s, and log it. **Never fail to spawn.**

### 4.3 Score (argmax over survivors) — the `pvp_design.md` §2.3 formula, verbatim

```
score(p) =  40 * min(1, dNearestEnemy(p) / 55)
          + 22 * (1 - min(1, dNearestFriendly(p) / 35))
          + 18 * influence(p)                    // -1..+1
          + 14 * mode.spawnBias(m, actor, p)     // 0..1
          + 10 * p.cover
          - 20 * recency(p)                      // 1.0 if used <12 s ago → 0 at 24 s
          - 15 * facing(p)                       // max over enemies ≤60 m of clamp0(cos θ)
          +  6 * rng.spawn()
```

Weights are the tuning surface. Two properties survive tuning and are asserted by the
selftest: safety **saturates** at 55 m, and the friendly term is a **proximity** term.

### 4.4 Influence map + flip

- 4 m cells over `arena.bounds`, rebuilt at **5 Hz** (match tick slot 8).
- Each living actor deposits ±1.0 by team with linear falloff to 0 at 25 m.
- Each kill deposits ±2.0 at the victim's position.
- Whole grid ×0.85 per second toward 0.
- `influence(p)` = the cell at `p`, normalised −1..+1 **from the spawning actor's point of
  view** (their team positive).

**Flip:** a team's home cluster mean < −0.35 for 3 consecutive seconds → flip to the highest
influence cluster that is not the enemy's home cluster. Hysteresis 12 s.

**Trap override:** ≥3 of a team's last 5 spawns died within 6 s of spawning and within 20 m of
their spawn point → flip immediately ignoring hysteresis, widen V1→32 m and V2→80 m for 20 s,
and post one HUD line to that team: `SPAWN COMPROMISED — FALLING BACK`. Naming it is part of
the design.

**Gate:** median `spawnStress` per match ≤ **0.5**, and **zero deaths within 2.0 s of
spawning** across the 20-seed battery. That second number is the director's actual pass/fail.

### 4.5 Spawn protection

**1.5 s of full damage immunity**, cancelled early and permanently by: firing, ADS, throwing a
grenade, or touching a flag. Movement, sprint and slide do **not** cancel it.

Implementation: `actor.protectedUntilT`; `applyDamage` returns early when
`sim.match.isProtected(who)` — the same early-return slot as the friendly-fire gate, so both
live in one place. Cancellation is checked in match tick slot 2 by reading
`player.weapon.state`/`ads` and `bot.cmd.fire/ads/grenade` — **the sim's existing state, no new
plumbing**.

A protected actor cannot be a valid "threat" for the bot cover-scoring term and cannot pick up
or return a flag (a protected carrier would be an unkillable capture).

Enemy-visible tell: **deferred** (it wants a material change; see Part 9). Until then,
protection is 1.5 s and its absence of a tell is a known, logged shortfall — it costs an
attacker at most one burst.

### 4.6 The FFA variant (the ONE genuine difference, ~25 lines)

`makeInfluence(bounds, { perActor })`. With `perActor: true`:

- The grid is not team-signed. It stores **one scalar per cell: total hostile pressure** —
  every living actor deposits **+1.0** with the same 25 m falloff, kills deposit **+2.0**.
- `influence(p, forActor)` returns `-normalise(cell − ownContribution(p, forActor))`, i.e. the
  spawning actor's own deposit is subtracted and the sign is flipped, so "high pressure" scores
  low exactly as "enemy influence" does in team modes. Same argmax, same sign convention.
- The **friendly-proximity term is dropped** (weight 22 → 0; nobody is friendly) and its weight
  is redistributed: safety 40 → **52**, cover 10 → **18**. Both numbers live in
  `SCORE_WEIGHTS.ffa` next to `SCORE_WEIGHTS.team` in `spawns.js`, so the difference is one
  table, readable at a glance.
- Vetoes V4 and V6 (friendly-keyed) are disabled in FFA; V1/V2/V3/V5 apply against **all**
  other actors.
- Cluster flip is per-actor rather than per-team: an actor whose last spawn cluster is the
  highest-pressure cluster flips to the lowest, hysteresis 12 s, same trap override on that
  actor's own last 3 spawns.

`spawns.selftest.cjs` runs the FFA battery as a first-class case, not an afterthought.

---

## PART 5 — HOW BOTS LEARN THE RULES

This is the owner's first-order requirement (*"They need to know the full rules of each game,
and fight to win/survive"*) and it is the part most likely to be faked. The design principle
is `pvp_design.md` §7.3.5's: **bots do not get a new FSM state, they get a new reason to prefer
certain places** — with exactly one addition, because CTF genuinely needs one.

### 5.1 The duty channel

Each mode writes `actor.duty` at 2 Hz. `botfsm.js` reads it in exactly **three** places.

```js
actor.duty = {
  role: 'attack' | 'defend' | 'carry' | 'recover' | 'escort' | 'intercept' | 'hunt' | 'roam',
  goal: [x,y,z] | null,     // the place this role wants the bot to be
  radius: 8.0,              // "close enough"
  weight: 0..1,             // 0 = advisory, 1 = overrides combat-seeking
  targetHint: <actorId>|null // e.g. the enemy carrier for 'intercept'
}
```

The three read sites in `botfsm.js`:

1. **`setGoal` (`botfsm.js:346`)** — when the bot has no fresh combat target, the nav goal
   becomes `duty.goal` instead of the patrol/advance heuristic.
2. **`pickCover` (`botfsm.js:557`)** — the cover score gains `+ 2.5 * weight * proximityTerm(cover, duty.goal)`,
   which is `combat_spec` §5.8's existing scoring function with one more term. A defender takes
   cover **near the thing it defends**; an attacker takes cover **toward** the objective.
3. **The `weight ≥ 0.8` override (new, ~20 lines)** — a flag carrier, and only a flag carrier,
   suppresses `flank`/`push`/`suppress` transitions and paths to `duty.goal` while still using
   cover, still shooting back, still reloading, still retreating on low HP. Without this a
   carrier stops to fight and CTF never scores. **This is the single new behaviour in the whole
   AI change**, it is bounded to one branch, and `ai.selftest.cjs --teams` asserts it does not
   touch the reaction latch, the token cap, or the jitter roll.

Everything else — reaction rolls, aim jitter, muzzle-block, burst discipline, flinch,
retreat-regen — is untouched. **The audited fairness surface does not move.**

### 5.2 Perception: from "the player" to "an enemy"

`perceive(bot, sim, world, dt, rngAi)` keeps its frozen signature (`architecture.md` §3.9).
Internals change (E4):

```js
bot.percept = {
  target: 'P' | <botId> | null,   // the CURRENT target body
  targetActor: <actorId> | null,
  seesTarget: bool,
  seesPlayer: bool,               // ALIAS kept: (target === 'P' && seesTarget) — scenarios.js
                                  //   and testsurface read this; do not delete it
  lastKnown: [3]|null, heardAt: [3]|null, firstSeenT, awareness,
  byTarget: { <who>: { awareness, lastSeenT, lastKnown, firstSeenT, ... } }
}
```

- Candidate list = `sim.match.livingEnemyBodiesOf(bot)`; falls back to `[S.player]` when
  `sim.match` is absent, so `ai.selftest.cjs`'s single-target batteries still run.
- **Awareness is metered per candidate** in `byTarget`, using the existing fill formula
  (`perception.js:107-115`) unchanged.
- The bot's target is `argmax(awareness)` **with hysteresis**: swap only if the challenger's
  awareness exceeds the incumbent's by **≥ 0.25**, or the incumbent has been unseen for
  **≥ 2.0 s**, or the incumbent is dead. This is `pvp_design.md` §7.3.3 and it is mandatory:
  without it a bot in a 5v5 twitches between three targets, hits nothing, and — worse —
  re-rolls its latched reaction, violating `combat_spec` §5.6.
- **Reaction latch is per target.** `byTarget[who].firstSeenT` and the latched reaction roll
  live inside the per-target record, so re-acquiring an old target does not buy a fresh roll and
  switching targets does not cancel an in-flight one.

**Cost control (this is a real budget problem, not a theoretical one).** Naive per-candidate
LOS is 9 bots × up to 9 candidates × 60 Hz ≈ 4 860 raycasts/s, which will not fit the 1.5 ms AI
slice (E9). Three mandatory mitigations, all asserted by the selftest:

1. **Scalar prefilter before any raycast**: distance > `detectRange(1.0)` (= 80 m) or
   `facingFactor(ang, d) === 0` (`perception.js:35-41`) rejects a candidate for free.
2. **Round-robin LOS**: each bot LOS-tests at most **2** surviving candidates per tick, cycling
   in id order. Awareness fill is scaled by the *actual* interval since that candidate was last
   evaluated, so the meter is interval-correct rather than rate-halved.
3. **Global cap `MAX_LOS_PER_TICK = 12`**, priority to (a) the bot's current target, (b) the
   nearest candidate. `ai.selftest.cjs --teams` asserts the per-tick call count never exceeds it
   across a 3 000-tick 5v5.

### 5.3 Squad: fire tokens become per-target

`makeSquad()` stays a single instance (E5 — `squads` is already keyed by `bot.squadId`, so the
two teams isolate themselves as soon as the roster assigns distinct ids). Two changes:

```js
squad.requestToken(botId, targetWho)   // ADDITIVE parameter; old 1-arg calls still work
squad.release(botId, targetWho)
```

**The ≤2-simultaneous-token cap and the ≤3-damaging-attackers-per-250 ms cap now apply per
TARGET, and are only enforced when the target is a human** (`targetWho === 'P'`). The caps
exist to protect *the audience* from being deleted by five simultaneous bursts
(`architecture.md` §0.12, `combat_spec` §5.7). Bots shooting bots are not the audience: capping
them would make bot-vs-bot fights unnaturally slow and would starve the human of the impression
that a war is happening around them.

`squadId` values come from the roster: `t0_a`, `t0_b`, `t1_a`, `t1_b` in team modes (2–3 bots
each), `ffa_<actorId>` in FFA. No squad code branches on the mode.

### 5.4 What each mode's `assignDuties` actually does

Authored here so three agents implement three coherent behaviours rather than three
interpretations. Each runs at 2 Hz over living bot actors only.

**`deathmatch.assignDuties`** — team fighting with map awareness:
- Compute the team's **centre of mass** and the **contact centroid** (mean position of enemies
  seen by anyone on the team within the last 4 s; falls back to the influence grid's peak
  hostile cell).
- Bots within 18 m of the contact centroid → `role:'attack'`, `goal` = contact centroid,
  `weight 0.35` (advisory: combat-seeking still leads).
- The two bots furthest from it → `role:'roam'`, `goal` = the highest-value un-owned cluster
  anchor, `weight 0.5` — this is what stops the whole team stacking one lane, and it is what
  makes the map read as contested.
- A bot whose team is **losing by ≥ 8** gets `weight 0.6` toward the contact centroid (press);
  a bot whose team is **winning by ≥ 12** in the last 90 s gets `role:'defend'` at the team's
  strongest cluster, `weight 0.45` (hold what you have). Both are legible to the player and
  neither touches combat fairness.

**`ctf.assignDuties`** — the mode where the bots must genuinely understand the rules:
- **If our flag is `carried` by an enemy** → the 2 nearest bots to that carrier get
  `role:'intercept'`, `goal` = carrier position, `targetHint` = carrier actorId, `weight 0.7`.
  Nothing else in the AI needs to know what a flag is: interception is "go to that place and
  the existing brain will fight what it finds."
- **If our flag is `dropped`** → the nearest bot gets `role:'recover'`, `goal` = flag position,
  `weight 0.8` (it must actually walk onto it — recovery does not happen incidentally).
- **If a teammate is carrying** → the 2 nearest bots to the carrier get `role:'escort'`,
  `goal` = a point 6 m ahead of the carrier along its path home, `weight 0.5`.
- **The carrier itself** → `role:'carry'`, `goal` = own flag stand, `weight 1.0` (the §5.1
  override).
- **Everyone else** → alternating `attack` (goal = enemy flag stand, `weight 0.5`) and
  `defend` (goal = own flag stand, `weight 0.5`), with a floor of **at least 1 defender** while
  our flag is `home` and **at least 2 attackers** while neither flag is carried. The floors are
  what prevent both degenerate states: an empty base, and five bots turtling on a stand.

**`ffa.assignDuties`** — everyone is hostile, nobody is an ally:
- `role:'hunt'` when a target is known: `goal` = the target's last known position,
  `weight 0.3` (barely more than the brain already does).
- `role:'roam'` otherwise: `goal` = a **weighted** pick among cluster anchors, biased **away**
  from the highest-pressure influence cells and toward the actor's own last-known kill
  locations. The FFA read the player should get is "everyone is circling," not "everyone
  converges on one room."
- The leader (`score` rank 1) gets `weight 0.15` — no coordinated dogpile. In a mode with no
  teams, bots ganging the leader is an emergent alliance, which is exactly the thing FFA says
  does not exist.

---

## PART 6 — WHAT DIES, WHAT IS RETAINED, AND THE NEW CONTENT SCHEMA

### 6.1 Deleted outright

| Thing | Where | Note |
|---|---|---|
| The mission driver | `core/sim/mission.js` (554 lines) | **file deleted**; git history is the record. Do not leave an unreferenced copy — an unreachable driver is how the next agent "fixes" the wrong file |
| The 6 mission beats + phases + beat checkpoints | `content.json` `mission.beats`, `mission.phases`, `mission.death` | beat-checkpoint respawn (R22) is replaced by the spawn director |
| The 13 waves / **44 scripted spawns** | `content.json` `mission.spawns.waves` | replaced by the roster + director |
| The 8-objective chain and its unlock graph | `content.json` `mission.objectives` | `sim.state.objectives` survives as a **shape** and is repopulated by `mode.hudModel()` |
| Radio lines + subtitle beats | `content.json` `mission.beats[].radio` | `drainRadio()` survives returning `[]` (§1.5) so `hud.js:1040` needs no edit |
| Set-pieces (transformer blackout, fuel drums) as **live-match behaviour** | `content.json` `mission.beats[].setPieces` | `pvp_design.md` §3.0 rule 5: a mid-match lighting change is a fairness event with no counterplay. **The blackout hook survives for scenario captures only** (§6.6) |
| The mission trigger vocabulary | `mission.js:24` `TRIGGER_KINDS` + `content._contract.triggers` | no beats ⇒ no triggers |
| Weapon-crate pickups (`pk_vesper_crate`, `pk_corvus_nest`) | `content.json` `pickups[]` | tied to beats. **The systemic ammo walkover (`pk_ammo_walkover`) is RETAINED** — it is the grenade/ammo economy `pvp_design.md` §4.4 B13 depends on |
| `mission.title` / `fiction` / campaign `path` | `content.json` | the fiction survives as arena and team names |

### 6.2 Retained, unchanged

`core/level/layout.js` geometry (the arena is carved *from* it, additively);
`core/level/colliders.js` node keys (the R24 15-key set — the arena data references them);
`core/sim/world.js`, `ballistics.js`, `player.js`, `grenades.js`; `core/ai/nav.js`;
`core/weapons/*`; every render, fx, chars and audio module; the whole event vocabulary;
`content.json`'s `archetypes` (extended per §2.6), `pois`, `signage`, `reverbZones`, and
`pickups[pk_ammo_walkover]`.

### 6.3 The new `content.json` and its contract gate

```jsonc
{
  "version": 2,
  "_owner": "data lane (W4) — sole owner. Other lanes request changes via needsElsewhere.",
  "_contract": {
    "nodes":  "every node ref resolves against buildColliders().nodes (the R24 15 keys)",
    "weapons":"every weapon ref resolves against WEAPONS (warden/vesper/corvus/pike)",
    "modes":  "every key of `modes` must exist in match.js's MODES registry",
    "spawns": "every spawnPoints[].cluster must exist in clusters; every point must be nav-walkable",
    "flags":  "every flags[].team must exist in teams; every home must be nav-reachable from every cluster",
    "gate":   "core/match/contract.js throws on ANY dangling ref — content-internal half at makeMatch(), node/weapon/nav half at match.start()"
  },

  "arena": {
    "id": "lanternwalk",
    "sourceMap": "meridian_ward",
    "bounds": { "min": [-48, -6, -34], "max": [26, 30, 22] },
    "diagM": 92.6,
    "lightingProfile": "campaign",        // 'pvp' lands with W10 (Part 9)
    "outOfBounds": { "graceS": 5.0, "warnAtS": 5.0 }
  },

  "teams": [
    { "id": 0, "name": "RAVEN",  "tint": "#c8a05a", "archetypeSuffix": "_a" },
    { "id": 1, "name": "VEKTOR", "tint": "#6f90bd", "archetypeSuffix": "_b" }
  ],

  "botRoster": [
    { "slot": 1, "archetype": "rifleman", "band": "regular", "name": "RAVEN 2-2" },
    { "slot": 2, "archetype": "cqb",      "band": "regular", "name": "RAVEN 2-3" },
    /* … 9 entries, slots 1..9; team is assigned by the mode, not authored here … */
  ],

  "clusters": {
    "SC_SOUTH": { "anchor": [-3, 0, 14],    "role": "team0_default" },
    "SC_NORTH": { "anchor": [-24, 0, -22.5],"role": "team1_default" },
    "SC_EAST":  { "anchor": [20, 0, 7],     "role": "flip" },
    "SC_WEST":  { "anchor": [-42, 0, -3],   "role": "flip" }
  },

  "spawnPoints": [ /* 30–50 entries, §4.1 shape */ ],

  "flags": [
    { "id": "flag_t0", "team": 0, "home": [-3.0, 0.0, 14.0], "yaw": 3.14 },
    { "id": "flag_t1", "team": 1, "home": [-24.0, 0.0, -22.5], "yaw": 0.0 }
  ],

  "modes": {
    "deathmatch": { "scoreLimit": 50, "timeLimitS": 480, "respawnDelayS": 4.0 },
    "ctf":        { "captureLimit": 3, "timeLimitS": 600, "respawnDelayS": 5.0,
                    "flagReturnS": 30, "touchRadiusM": 1.2 },
    "ffa":        { "scoreLimit": 25, "timeLimitS": 480, "respawnDelayS": 3.0 }
  },

  "archetypes": { "rifleman_a": {…}, "cqb_a": {…}, "marksman_a": {…},
                  "rifleman_b": {…}, "cqb_b": {…}, "marksman_b": {…} },

  "pickups": [ { "id": "pk_ammo_walkover", "kind": "ammo_rule", "magsPerPickup": 1 } ],
  "pois": {…}, "signage": [...], "reverbZones": {…},
  "scenarios": { "S1": {…}, …, "C1": {…}, "menu": {…}, "bench": {…} }
}
```

**The contract gate — `core/match/contract.js`, `export function validateContent(content, opts)`
— is a re-authoring of `mission.js:28-135` (E6) and enforces, referential-integrity-as-a-gate
per doctrine §4:**

1. Every `modes` key exists in `match.js`'s `MODES` registry, and every registry entry has a
   `modes` block (both directions — a mode with no data is as broken as data with no mode).
2. Every `botRoster` entry's `archetype` resolves after the team suffix is applied, for **both**
   suffixes (`rifleman` + `_a` and `_b` must both exist).
3. Every `archetypes[*].weapon` resolves in `WEAPONS`.
4. Every `spawnPoints[].cluster` exists in `clusters`; every cluster has ≥ 6 points; no
   duplicate point ids; 30 ≤ count ≤ 50.
5. Every `flags[].team` exists in `teams`; exactly one flag per team in a `ctf`-capable arena.
6. Every node reference resolves in `colliders.nodes` (deferred half, at `start()`).
7. Every `spawnPoints[].pos` and `flags[].home` is inside `arena.bounds`, is nav-walkable, and
   `nav.reachable` from every other cluster anchor (deferred half, at `start()`).
8. Every scenario's `mode` exists; every scenario bot's `archetype` and `weapon` resolve; every
   `nearNode` resolves; `extends` targets exist.
9. `teams.length === 2` and `botRoster.length === 9`.

Content-internal checks (1–5, 8, 9) throw at `makeMatch()`; the nav/collider checks (6, 7) throw
at `match.start()`; both are also runnable standalone via
`node core/match/match.selftest.cjs --contract` — the exact split `mission.js` already uses,
and the exact command the CI-equivalent gate runs.

### 6.4 `sim.state.objectives` survives as the HUD's contract

`core/hud/hud.js` renders an objective tracker from `sim.state.objectives` and registers the
`objective` event. Rather than edit `hud.js` (Part 9), each mode fills that array through
`mode.hudModel(m).objectives`:

| Mode | objectives shown |
|---|---|
| `deathmatch` | `{id:'dm_score', label:'ELIMINATE — 50', state:'active'}` |
| `ctf` | `{id:'ctf_take', label:'TAKE THE ENEMY FLAG', state:…}`, `{id:'ctf_cap', label:'CAPTURE — 0/3', state:…}`, `{id:'ctf_defend', label:'DEFEND YOUR FLAG', state:…}` |
| `ffa` | `{id:'ffa_score', label:'LAST ONE STANDING — 25', state:'active'}` |

State transitions emit the frozen `objective` event, so the HUD ping audio and the tracker
animation work with zero edits. This is the cheapest possible way to give three modes a legible
goal in the existing UI.

### 6.5 Arena bounds without a carve (v1), with a carve (W10)

`pvp_design.md` §3.0 rule 1 is absolute: **no invisible walls, ever.** But the carve (its
edits E1–E10) is level-design work that cannot land in wave 1 and partly touches files a
concurrent wave holds (Part 9).

**v1 ruling, and it is a stated deviation:** the arena is bounded by `arena.bounds` enforced as
a legible, conventional out-of-bounds rule — the HUD posts `RETURN TO THE ARENA — 5…1` and the
actor dies on expiry (`match.onOutOfBounds`, a death with `attacker: null`). This is a
recognised convention in the genre and it is honest; it is **not** an invisible wall (nothing
silently blocks movement) and it is **not** the final answer.

**W10 replaces it with geometry**, using `pvp_design.md` §3.3's edits E1–E5 authored as
**colliders in `layout.js` plus visible props in `props.js`** — stacked freight containers, a
collapsed gantry, a customs barricade, a welded fire door. Both files are free of the
concurrent wave (Part 9), so this can land without touching `level.js`. When it does, the
out-of-bounds timer stays as a backstop and should never fire.

### 6.6 The blackout hook: dead in matches, alive for captures

The transformer blackout is banned during a live match (`pvp_design.md` §3.0 rule 5) but the
shot battery's S1/C1 poses pin `worldState.blackout` and `core/test/scenarios.js` drives it
(`applyWorldHooks`). A capture is not a match.

Ruling: the `lights.setBlackout(bool)` API and the `scenarios.js` world hook are **retained
verbatim**; the match driver simply never calls them, and `match.freeze(true)` (which every
scenario asserts before capturing) makes it structurally impossible for a live match to. The
`content.json` `setPieces` **data** is deleted; the **capability** is not.

---

## PART 7 — HARNESS IMPACT

Rule for this whole part: **the harness is the reason we can tell truth from hope. It does not
get broken to make a refactor convenient.** Every `.py` file below keeps its name, its CLI, and
its output artefact paths.

### 7.1 `_harness/shotbattery.py` (952 lines) — re-pointed, not rewritten

The Python is **unchanged**. What changes is the content and `scenarios.js`:

1. **Scenario ids stay exactly as they are**: `S1…S9`, `C1`, `menu`, `bench` (R10). Every
   `_shots/iterNN/<id>.png` path, every critic reference image, every `_w3`/`_w7`/`_w8` pose
   note and every `mustShow` clause keeps its meaning. This is not sentiment: the blind A/B
   critic loop diffs against reference-bar screenshots, and renaming the battery throws away
   every reference frame in the repo.
2. **`bots[].spawn` references are replaced with explicit poses** (E7). `{"spawn":"sp_plaza_a2"}`
   becomes `{"archetype":"rifleman_b","pos":[8,0,-8],"yaw":1.5708,"team":1}` — the *same
   coordinates*, transcribed from the wave the ref pointed at, so the framing does not move.
   `scenarios.js:229-236 findSpawn()` is deleted.
3. **`"beat": N` becomes `"mode": "<id>"`; `"clockS"` stays** and now means the match clock.
   `scenarios.js`'s beat fast-forward is replaced by `match.setMode(id)` + `match.freeze(true)`
   + a clock write.
4. **The "mission wave spawner locked" hack (`scenarios.js:639`) is deleted** and replaced by
   `match.freeze(true)`: no clock, no respawns, no `mode.tick`, no duty assignment. This is
   strictly better — the old hack worked by starving a trigger, which is what caused the C1
   blackout bug documented at `content.json`'s `_w7` note.
5. **Poses that never depended on the mission are untouched**: S4, S5, S7 (pure visual crops),
   S6 (pause overlay), S9 (single posed bot), `menu`.
6. `C1`'s script (sprint → stop → fire → reload) is unchanged; its `_pose_fix_iter05/07`
   coordinates are unchanged because the geometry is unchanged.
7. `bench` still `extends: "S1"` + `autoplay('objective', 30)` — with the `objective` profile
   re-pointed (§7.3).

**Self-verify:** `python _harness/shotbattery.py --only S1,S4,S6 --iter NN` produces three PNGs
whose framing is pixel-comparable to the last campaign iteration.

### 7.2 `_harness/perfprobe.py` (609 lines) — the worst case gets harder, and that is correct

`perfprobe.py:541` calls `__test.startMission({seed})` and `:551` `autoplay('rusher', 30)` (E8).

1. **`__test.startMission(opts)` is retained as a first-class name** and gains an optional
   `mode`: `startMission({seed, mode})` defaults to `{mode:'deathmatch'}`. `startMatch` is added
   as the primary alias (it was already promised by freeze amendment R11). **No Python edit.**
2. **The measured worst case changes and the probe must be told.** The campaign's steady state
   was 2–8 alive bots in waves; a 5v5 with respawns is **9 bots alive continuously for 8
   minutes**, all animating, most visible in the plaza. This is a genuinely heavier scene than
   anything the perf budget was measured against.
   **Action:** `perf-combat` gains a second sample point, `perf-match`, that runs
   `startMatch({mode:'deathmatch'})` + `autoplay('rusher', 45)` and asserts the
   `architecture.md` §8 budgets at **30 fps** (`p50 ≤ 33.3 ms`, `p99 ≤ 50 ms` — restated for the
   owner's accepted target, not the 60 fps row), `draw calls ≤ 320 median`, `programs delta 0`.
   The 60 fps rows stay in the report as information.
3. `perfprobe`'s AI-slice instrument becomes load-bearing: `sim tick CPU ≤ 3 ms, AI ≤ 1.5 ms`
   at 9 bots with per-target perception (§5.2) is the number most likely to break. If it
   breaks, the fix is the LOS budget in §5.2, not the actor count — the owner specified 10.

### 7.3 `_harness/playprobe.py` (295 lines) — re-pointed gates

`playprobe.py` currently asserts campaign propositions: *"optimal beats novice on every seed"*,
*"rusher full-mission win rate ≥ bar"* (`:233`, `:250`).

| Old gate | New gate |
|---|---|
| `objective` profile paths to the active objective and finishes the mission | **`objective` becomes the mode-aware profile**: in `deathmatch` it moves toward `duty`-style contact; in `ctf` it takes/returns flags; in `ffa` it hunts. Gate: it **scores** in every mode |
| `rusher` full-mission win rate ≥ bar | `rusher` **team** win rate over 10 seeds in `deathmatch` ≥ 0.30 (a rusher on a 5-actor team should sometimes win and sometimes not; 1.0 or 0.0 both indicate broken bots) |
| `optimal` beats `novice` on every seed | unchanged in spirit: `optimal`'s **actor score** beats `novice`'s on ≥ 8/10 seeds. Skill must still be real |
| `idle` never wins | unchanged, and now sharper: `idle` must finish **last or second-to-last** in FFA every seed. If standing still places mid-table, the bots are not playing |

`core/test/autoplay.js` profiles gain **team awareness**: `nearest alive bot` becomes `nearest
living enemy actor` in every profile. That is a one-predicate change per profile and it is
where "the harness understands teams" lives.

### 7.4 `_harness/matchprobe.py` — NEW, and it is the one that answers the owner

A scripted playtest that drives a **full match to completion**, per mode, headlessly, through
the real path (`__test.step()` synchronous stepping — hidden tabs have no rAF, `architecture.md`
§6).

```
python _harness/matchprobe.py --mode all --seeds 10
```

For each (mode, seed) it starts a match, steps until `sim.state.match.phase === 'ended'` or a
tick ceiling, and asserts:

| # | Assertion | Why it is the right gate |
|---|---|---|
| 1 | **Every match ends**, by score limit or clock, within `timeLimitS + overtime + 10 s` | doctrine §2: every engagement ends |
| 2 | `result` is exactly one of win/draw and `winnerTeam` is consistent with the final scores | catches the "unloseable match" class |
| 3 | **Zero deaths within 2.0 s of spawning**, all seeds | the spawn director's actual pass/fail |
| 4 | Median `spawnStress` ≤ 0.5 | an under-built arena, not a tuning problem |
| 5 | `stuckBotSeconds === 0` (no bot with < 0.5 m displacement over 20 s while alive and not in cover) | the classic "bots stand in a doorway" failure |
| 6 | **CTF: ≥ 1 capture is scored by BOTS ALONE** across the 10 seeds with the human idle | **the single most important assertion in this document.** If bots never capture with no human helping, they do not understand CTF, whatever the code says |
| 7 | CTF: no flag spends > 45 s in `dropped`; every flag ends `home` or `carried` | the stuck-flag class |
| 8 | FFA: ≥ 6 of the 10 actors record ≥ 1 kill | catches "one bot farms, nine wander" |
| 9 | DM: `|mean team margin|` < 8 kills over 10 seeds | neither spawn cluster is the winning one |
| 10 | Zero friendly-fire damage events in team modes; zero page errors | §2.3 |
| 11 | Zero same-seed divergence: two runs of the same (mode, seed) produce identical `match.snapshot()` hashes | determinism, and it is the assertion that keeps every other number meaningful |

Assertions 1–5, 9 and 11 also run **in Node** via `core/match/match.selftest.cjs --mode all
--seeds 20`, which is faster and is the gate lanes run per commit; `matchprobe.py` is the
in-browser confirmation at the layer the player actually sees (doctrine §5).

### 7.5 Untouched harness files

`bootcheck.py`, `shotserver.py`, `deployverify.py`, `ablate.py`, `occlusion.py`, `levers.py`,
`a3pick.py`, `a3spec.py`, `lanec_ground.py`, `aimfeel.py` — **no edits**. `bootcheck.py`'s ready
expression is `!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)`, all three of which
still exist. `aimfeel.py` belongs to the concurrent wave and must not be touched by anyone here.

---

## PART 8 — THE BUILD PLAN

Ten workstreams. **No file is owned twice.** Every lane codes against this document, so waves
overlap in time — wave 2 does not wait for wave 1 to *finish*, only to *land its interface*,
and the interface is specified here rather than in wave 1's head.

### 8.1 Ownership table

| Lane | Files owned (exclusive) | Wave |
|---|---|---|
| **W1 MATCH CORE** | `core/match/match.js`, `core/match/roster.js`, `core/match/contract.js`, `core/match/match.selftest.cjs`, `core/sim/sim.js`, `core/sim/damage.js`, `core/sim/sim.selftest.cjs`, `core/rng.js`, `runtime/boot.js` · **DELETES** `core/sim/mission.js` | 1 |
| **W2 SPAWN DIRECTOR** | `core/match/spawns.js`, `core/match/influence.js`, `core/match/spawns.selftest.cjs` | 1 |
| **W3 TEAM AI** | `core/ai/perception.js`, `core/ai/botfsm.js`, `core/ai/squad.js`, `core/ai/duty.js`, `core/ai/ai.selftest.cjs` | 1 |
| **W4 ARENA + CONTENT** | `content.json`, `core/level/layout.js`, `core/level/colliders.js`, `core/level/props.js`, `tools/arena_probe.mjs` | 1 |
| **W5 MODE: DEATHMATCH** | `core/match/modes/deathmatch.js`, `core/match/modes/deathmatch.selftest.cjs` | 2 |
| **W6 MODE: CTF** | `core/match/modes/ctf.js`, `core/match/flags.js`, `core/match/modes/ctf.selftest.cjs` | 2 |
| **W7 MODE: FFA** | `core/match/modes/ffa.js`, `core/match/modes/ffa.selftest.cjs` | 2 |
| **W8 MATCH SHELL** | `core/hud/match_hud.js`, `core/hud/scoreboard.js`, `core/hud/menu.js`, `core/match/flagview.js` | 2 |
| **W9 HARNESS** | `core/test/scenarios.js`, `core/test/autoplay.js`, `core/test/testsurface.js`, `_harness/playprobe.py`, `_harness/matchprobe.py`, `_harness/perfprobe.py` | 3 |
| **W10 DEFERRED (post-aim-wave)** | `core/pvp/pvp_tuning.js`, `core/hud/hud.js` (3-line debrief copy), `core/render/lighting.js`, `core/chars/soldiers.js` (rim tint), the §3.3 carve visuals | 4 |

Files nobody in this plan touches, listed so the point is unmissable:
`core/sim/ballistics.js`, `core/sim/player.js`, `core/sim/world.js`, `core/sim/grenades.js`,
`core/input.js`, `core/weapons/*`, `core/level/level.js`, `core/level/materials.js`,
`core/fx/*`, `core/render/*` (until W10), `core/audio/*`, `core/chars/*` (until W10),
`core/view/bridge.js`, `core/events.js`, `core/gfx.js`, `core/perf.js`, `core/settings.js`,
`core/hud/pause.js`, `core/hud/settings_ui.js`, `core/ai/nav.js`.

### 8.2 Dependency order

```
WAVE 1  (start together, day 1 — everything below codes against THIS document)
  W1 MATCH CORE  ──┐
  W2 SPAWNS      ──┤ no lane blocks another: W2/W3/W4 depend on the *contract*,
  W3 TEAM AI     ──┤ not on W1's code landing
  W4 ARENA+DATA  ──┘
        │  gate: node core/match/match.selftest.cjs --contract  →  exit 0
        │        node tools/arena_probe.mjs                     →  exit 0
        ▼
WAVE 2  (three modes in parallel + the shell)
  W5 DEATHMATCH ── W6 CTF ── W7 FFA ── W8 SHELL
        │  gate: node core/match/match.selftest.cjs --mode all --seeds 20 → exit 0
        │        python _harness/bootcheck.py → RESULT OK
        ▼
WAVE 3  (harness re-point; needs a real match to point AT)
  W9 HARNESS
        │  gate: python _harness/matchprobe.py --mode all --seeds 10 → exit 0
        │        python _harness/shotbattery.py --only S1,S4,S6 → 3 PNGs at bar
        ▼
WAVE 4  (gated on the CONCURRENT aim wave being verified green — Part 9)
  W10 DEFERRED
```

**Why W3 (team AI) is wave 1 and not wave 2:** it is the highest-risk change in the plan
(`pvp_design.md` risk 2 — it touches the audited fairness surface) and it is the only lane
whose failure invalidates everything downstream. It gets the longest runway and its selftest is
the first gate anyone runs.

**Why the three modes are wave 2 and genuinely parallel:** each owns two files, imports nothing
from its siblings, and is tested by its own headless battery. Three agents can start the moment
Part 1.6 is read; they integrate when W1's `match.js` lands, and integration is an import, not a
negotiation.

### 8.3 Per-lane definition of done (doctrine §5 — observed effect, not "compiles")

| Lane | Self-verification command | Passing means |
|---|---|---|
| **W1** | `node core/match/match.selftest.cjs --contract && node core/match/match.selftest.cjs --seeds 20` | Contract gate throws on every one of 9 seeded dangling-ref fixtures; a 10-actor match runs 3 000 ticks deterministically; two runs of one seed hash identically; friendly fire deals 0 damage; kill/assist attribution matches a hand-computed fixture |
| **W2** | `node core/match/spawns.selftest.cjs` | 2 000 spawn selections across 20 seeds and all 3 modes: zero picks within 22 m of a living enemy unless the ladder relaxed (and each relaxation incremented `spawnStress`); no point reused inside 12 s unless forced; median `spawnStress` ≤ 0.5; the FFA battery passes as a first-class case |
| **W3** | `node core/ai/ai.selftest.cjs --teams` | 30 seeds, 5v5 bots-only, 3 000 ticks: zero friendly-fire damage; ≤2 fire tokens per **human** target at all times; a target switch never re-rolls a latched reaction; hysteresis holds (no bot switches target more than once per 2 s); `MAX_LOS_PER_TICK ≤ 12`; the existing single-target fairness battery still passes unchanged |
| **W4** | `node tools/arena_probe.mjs` | 30–50 spawn points, all nav-walkable, ≥2.0 m clearance, ≥8 m forward view; 4 clusters each ≥6 points over ≥250 m²; both flag homes reachable from every cluster anchor; every point and flag inside `arena.bounds`; rotational balance (`pvp_design.md` §3.0 rule 3): spawn-centroid distance ±8%, cover count ±15%, longest sightline ±10 m |
| **W5** | `node core/match/modes/deathmatch.selftest.cjs` | 20 seeds: every match ends; score monotone; win fires exactly once; `|mean team margin| < 8`; a team losing by 8 measurably presses (duty weights change) |
| **W6** | `node core/match/modes/ctf.selftest.cjs` | 20 seeds, **human idle**: ≥1 capture scored by bots alone; the flag invariant holds every tick; no flag `dropped` > 45 s; every transition in the §3.2 table is exercised at least once across the battery; every match ends |
| **W7** | `node core/match/modes/ffa.selftest.cjs` | 20 seeds: every match ends; ≥6 of 10 actors score ≥1 kill; no actor is ganged (no target receives >40% of all damage); an idle actor finishes last or second-to-last |
| **W8** | `python _harness/bootcheck.py` then, in the page, one live match to the end screen | Boot RESULT OK; score bar, killfeed, scoreboard (TAB), objective markers and the flag strip all update from real events; **zero edits to `hud.js`** |
| **W9** | `python _harness/matchprobe.py --mode all --seeds 10` and `python _harness/shotbattery.py --only S1,S4,S6` | The 11 assertions of §7.4; three battery PNGs at the visual bar with framing comparable to the last campaign iteration |
| **W10** | `python _harness/perfprobe.py perf-match` and the full 11-shot battery | 30 fps budgets met at 9 alive bots; `programs delta 0`; carve geometry visible on every arena edge (boundary raycast every 2 m finds a renderable within 0.5 m) |

### 8.4 The integration gate the owner should ask for

Before anything ships: **`python _harness/matchprobe.py --mode all --seeds 10` exits 0, and a
human plays one match of each mode to completion and reports back.** Assertion 6 of §7.4 —
*bots capture the flag with the human standing still* — is the one that answers the owner's
actual question. Everything else is scaffolding for it.

---

## PART 9 — OVERLAP WITH THE CONCURRENT AIM WAVE

A separate wave is concurrently fixing aim accuracy, ADS framing, the viewmodel, the ground and
mouse input, touching `core/sim/ballistics.js`, `core/weapons/*`, `core/input.js`,
`core/hud/hud.js`, `core/level/level.js` and `core/fx/*`.

**This plan was written to have a null intersection with that set in waves 1–3.** The
avoidances are deliberate and each one has a design consequence worth knowing:

| Their file | How this plan avoids it | Consequence |
|---|---|---|
| `core/sim/ballistics.js` | The friendly-fire gate lives in `damage.js`, not in the raycast. Teammates still **block** bullets, which is the behaviour we want anyway | none — arguably a better design |
| `core/weapons/*` | The `pvp_tuning.js` fork (HP 110, `steadyMult` 1.0, recoil jitter, Corvus ADS) is **deferred to W10** | v1 PVP ships on single-player weapon numbers. Two consequences the owner should know: Vesper's 200 ms melt and Pike's 158 ms two-tap exist against the human. Against `regular`-band bots with a 500–700 ms reaction they are rare. Changing spread constants now would also **confound the aim wave's own measurements**, which is the stronger reason to wait |
| `core/input.js` | Bots write `bot.cmd` directly; the human's cmd path is untouched | none |
| `core/hud/hud.js` | All PVP UI is in **new** files (`match_hud.js`, `scoreboard.js`) with their own `attach(bridge, ctx)`. The match emits the frozen `mission:start`/`mission:end`/`objective` events, so `hud.js`'s existing handlers work as-is | **one known cosmetic defect:** `hud.js`'s debrief will say `MISSION COMPLETE` / `MISSION FAILED` instead of `VICTORY` / `DEFEAT`. It is a 3-line copy change scheduled in W10 after the aim wave releases the file. It is logged, not hidden |
| `core/level/level.js` | The arena carve is authored as **colliders in `layout.js` + visible props in `props.js`**, neither of which the aim wave holds | none for waves 1–3; the PVP lighting profile (`pvp_design.md` §3.1) needs `lighting.js` and is W10 |
| `core/fx/*` | The flag's 3D representation is `core/match/flagview.js`, a new file | none |

**Recommended sequencing for the owner:**

1. Run **waves 1–3 of this plan concurrently with the aim wave.** They do not collide.
2. **Do not start W10 until the aim wave's own verification is green.** W10 touches
   `hud.js`, `lighting.js`, `weapons/*` and `soldiers.js` — every one of them either theirs or
   adjacent to theirs.
3. **The aim wave should land first in the sense that matters**: PVP is where aim quality is
   most exposed (nine bots shooting back, a scoreboard recording every miss). If the aim fix
   lands *after* PVP goes live, the first PVP playtest measures the old aim and the owner will
   read it as a PVP problem.
4. One coordination point to name explicitly: if the aim wave changes `effectiveSpread` or the
   crosshair truth model, **W3's `ai.selftest.cjs --teams` fairness battery must be re-run**,
   because bot aim reads the same constants. That re-run is cheap and should be a checklist
   item on the aim wave's own definition of done.

---

## PART 10 — FREEZE AMENDMENTS REQUIRED

`_design/architecture.md` §4 requires an approved, appended amendment for any new event type.
These are the amendments this plan needs; append verbatim to that file's changelog.

```
- v3.0 2026-08-20 (PVP conversion — the campaign mission driver is replaced by a
  three-mode match driver; see _design/pvp/architecture.md):
  a. `core/sim/mission.js` is DELETED. `core/match/match.js` exports
     makeMatch(content, emit, opts) returning the SAME frozen triple
     {start, tick, forfeit}. sim.match === sim.mission (one object, two names)
     so boot.js, damage.js and sim.step's tick slot 6 are unchanged.
     drainRadio()/drainSetPieces() survive returning [] (v2.2 amendment b's
     contract is honoured, its content retired).
  b. NEW event type `flag` — {flagId, team, state:'taken'|'dropped'|'returned'|
     'captured'|'reset', by, byWho, carrier, pos:[3], reason}. Consumers:
     core/match/flagview.js, core/hud/match_hud.js. CTF only.
  c. NEW event types `match:start` {matchId, mode, teams, epoch},
     `match:state` {phase, prev}, `match:score` {team, actorId, points, reason},
     `respawn` {who, actorId, team, pointId, pos:[3], yaw, protectedUntilT}.
     Consumers: core/hud/match_hud.js, core/hud/scoreboard.js, audio (optional).
     The match ALSO emits the frozen mission:start / mission:end / objective so
     every existing consumer (fx pool clear, soldiers clear, hud debrief +
     objective tracker, audio stinger, boot's menu return) is unchanged.
  d. ADDITIVE fields, no new types: `death` and `hurt` gain
     {victimActor, attackerActor, victimTeam, attackerTeam};
     `mission:end` gains {match:{modeId, result, winnerTeam, teams, actors}}.
     Existing consumers ignore unknown fields.
  e. sim.state gains `match` (shape in _design/pvp/architecture.md §1.2) and
     every actor body gains `team:int`. sim.state.phase keeps its frozen enum
     and is driven from the match phase per that document's §1.1 table.
  f. core/rng.js makeStreams() gains two streams: `match` and `spawn`
     (deterministic mulberry32, same construction as the existing four).
  g. __test gains startMatch(opts) / matchState() / setMode(id) / endMatch();
     startMission(opts) is RETAINED as an alias that defaults mode:'deathmatch'
     (_harness/perfprobe.py:541 and playprobe.py:75 depend on the name).
  h. content.json version 2 — mission{} is replaced by arena/teams/botRoster/
     clusters/spawnPoints/flags/modes. Scenario IDs S1-S9/C1/menu/bench are
     UNCHANGED (R10 stands); their `beat` field becomes `mode`.
```

---

## PART 11 — DEFERRED, WITH REASONS

Named rather than dropped, per doctrine (an out-of-scope finding is reported, never silently
discarded).

1. **The `pvp_design.md` PART 4 balance deltas** (HP 110, `steadyMult` 0.55→1.00, recoil jitter
   cuts, Corvus ADS 340→380 ms and settle 0.35 s, scoped flinch ×2, scope glint, tac-sprint
   4.0→2.5 s, grenades 2→1, hitstop off). **Why deferred:** they land in `weapon_data.js` and
   `damage.js` constants that the concurrent aim wave is measuring against; changing them now
   confounds two investigations at once. **The seam ships in wave 1 anyway** —
   `createSim({tuning:'sp'|'pvp'})` and `core/pvp/pvp_tuning.js` exist with an identity delta
   set — so W10 is a data change, not a refactor. `hitstop off` is the one worth pulling
   forward if it is cheap: it is view-only and it is genuinely wrong in a 10-actor match.
2. **Spawn-protection visual tell** (§4.5) — wants a material change; W10.
3. **Faction rim tint** (§2.6) — ships as archetype tints in v1; the proper rim term is W10.
4. **The full Lanternwalk carve** (`pvp_design.md` §3.3 E1–E10) — colliders + props land in W4
   as a first pass; the diegetic visual treatment and the PVP lighting profile are W10. Until
   then the arena edge is an out-of-bounds timer (§6.5), which is a stated deviation from the
   "no invisible walls" rule and is not one.
5. **`hud.js` debrief copy** — Part 9; W10.
6. **Multi-map (`pvp_design.md` G1)** — the owner said *"We will start with the same MAP for all
   3 modes."* `content.arena.sourceMap` exists in the schema so a second arena is data plus a
   `buildLayout(mapId)` signature change later, but **no map registry is built now.** Building
   it now would be a large refactor of the file everything reads, for a requirement the owner
   explicitly deferred.
7. **Networking, in every form.** Part 0.

---

## PART 12 — OPEN QUESTIONS FOR THE OWNER

1. **Match length.** I set deathmatch/FFA to 8:00 / 50 kills / 25 kills and CTF to 10:00 /
   3 captures, down from `pvp_design.md`'s 10:00 / 75, because the actor count dropped from 12
   to 10 and a browser session wants to be shorter than a campaign mission. If you want longer
   matches, these are one line each in `content.modes` — say the word and the numbers move.
2. **Does the human always play team 0?** I fixed it (§1.3) because it makes every probe, every
   screenshot and every bug report comparable. A "random team each match" toggle is trivial but
   it makes seeded runs non-comparable, so I would not add it.
3. **Bot difficulty.** Default `regular` for all nine, no selector (matching R30's no-difficulty-
   selector ruling for the campaign). If you want a Recruit/Regular/Hardened picker in the mode
   select screen, that is W8 plus one roster field — but `veteran` should stay out for the
   reason `pvp_design.md` §7.2 gives: at 300–420 ms reaction a bot beats human reaction often
   enough that losing to it stops reading as fair.
4. **Is the campaign truly gone, or archived?** This plan **deletes** `mission.js` and the
   mission content. If you might want the campaign back, say so now and W1 archives the driver
   and the content block to `_design/attic/` instead — cheap now, expensive later.

---

*Every on-disk claim in Part 0.1 traces to a file read this session and is cited by file:line.
Where this plan defers or deviates from `pvp_design.md` or the v1 freeze, it says so at the
point of deviation and gives the reason, rather than quietly designing around it.*
