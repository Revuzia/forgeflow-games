# BLACKRIDGE PVP — BOT OBJECTIVE AI

**How nine bots genuinely understand and play Team Deathmatch, Capture the Flag and Free-for-All.**

Status: **DESIGN PROPOSAL**, written 2026-08-20 against the build on disk.
Authority order unchanged: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` >
the v1 design docs (`combat_spec.md`, `level_design.md`, `architecture.md`) > `_design/expansion/pvp_design.md`
> **this document**. Where this document needs something a freeze rule forbids, it is raised in
Part 12 as an amendment request, never assumed.

Owner's directive (verbatim, 2026-08-19): *"the campaign is not much of a campaign… Turn it into a
PVP map instead. the same map can be multiple modes - 1. 5v5 , 2. Capture the Flag, 3. FFA. Each
game will have a maximum of 10 players. At this point thats me, the tester, and 9 ai (npcs). **They
need to know the full rules of each game, and fight to win/survive.** We will start with the same
MAP for all 3 modes. Campaign is now PVP and this game has no campaign mode atm. 30fps is fine."*

Scope of this document: **the per-mode objective layer that sits above the existing combat FSM** —
what a bot wants, what it is allowed to know, how it decides, and how we prove it actually plays the
objective rather than shooting at people near one. It does **not** re-specify the modes' rules
(match driver lane), the spawn director (`pvp_design` Part 2), the map carve (`pvp_design` §3.3), or
the weapon/HP deltas (`pvp_design` Part 4). It consumes those and says exactly what it needs from them.

---

## PART 0 — EVIDENCE LEDGER (verified on disk this session)

Load-bearing facts. Every design decision that rests on one cites it by number. Anything not listed
here and not cited is labelled **inferred** or **assumed** where it appears.

**E1 — The AI is a two-file brain plus two services, and it is already fairness-audited.**
`core/ai/botfsm.js` (1007 lines) is the FSM + fire control; `core/ai/squad.js` (405) is the token
director, bark scheduler and engagement referee; `core/ai/perception.js` (185) is the awareness
meter; `core/ai/nav.js` (533) is the grid bake + A* + string pulling. The fairness invariants are
enumerated in the botfsm header (`botfsm.js:8-20`) and asserted by `core/ai/ai.selftest.cjs`
(header, lines 2-14: 30-seed fairness battery, engagement-ends battery, ≤4 brains/tick, AI CPU
≤ 1.5 ms, determinism, plus a child run of `core/sim/sim.selftest.cjs`).

**E2 — There is no team concept anywhere in the sim.** `sim.spawnBotFromSpec` builds the bot record
at `core/sim/sim.js:195-232` with `id, archetype, pos, yaw, hp:100, alive, state, band, squadId,
wave, spawnId, patrol, vel, grounded, cmd, percept, flinch*, lastHitT, weapon` — **no `team`
field**. `core/ai/perception.js:69` reads `const player = S.player` as *the* target.
`core/ai/squad.js:271-287` re-arbitrates fire tokens against `S.player`. This confirms
`pvp_design` E1: generalising "the player" into "an actor on the other team" (G2) is the
prerequisite for everything below, and it is **not this document's work** — this document is written
to sit on top of a completed G2.

**E3 — Bots cannot mantle, jump or slide.** `core/sim/player.js:587-617` (`stepBotLocomotion`) reads
only `cmd.yaw`, `cmd.crouch`, `cmd.sprint`, `cmd.moveX/moveZ`; it applies gravity and
`world.moveCapsule`. `cmd.jump` is never read. Mantle lives exclusively in the player path
(`player.js:96-109, 272-290`, on `p._m`). **Consequence: any route that requires the E7 kiosk→balcony
mantle (`pvp_design` §3.3) is human-only, and the arcade balcony is a bot dead-end** (two stairwells
in, same two out). Lane data must say so or a flag carrier will path into it.

**E4 — Bot movement vocabulary is walk 4.6 / sprint 6.4 / crouch 2.4.** `stepBotLocomotion` selects
`MOVE.CROUCH | MOVE.SPRINT | MOVE.WALK` (`player.js:596`); `botfsm.js:938` documents "bots never
tac-sprint" and mirrors only the normal sprint-out column. So a bot **cannot** outrun a human on
tac-sprint (7.3 m/s, `combat_spec §1.1`). Every intercept/chase estimate below is built on 4.6–6.4.

**E5 — The shared-knowledge channel already exists and is already the only one.**
`squad.js:153-161` — `noteLastKnown(botId, pos, t)` / `squadLastKnown(botId)` store **one**
last-known position per squad. `combat_spec §5.4`: *"Squad shares one blackboard: last-known player
pos (the ONLY wallhack-free shared fact — bots never read the true player transform outside their
own perception)."* `botfsm.js:812-834` proves the discipline holds at the trigger: a bot fires at
`player.pos` **only** when `visibleFresh` (`P.seesPlayer && t - P.lastSeenT <= 0.3`); the SUPPRESS
path fires at the *last-known* with a deliberate ±0.5 m lateral offset.

**E6 — The fairness constants and where they are enforced.** `BANDS` at `botfsm.js:35-40`
(recruit 650–800 ms … veteran 300–420 ms, σ 0.030…0.012); roll-once-and-latch at
`botfsm.js:222-238` (`rerollArmed`, re-armed only after the target is lost ≥ 2 s,
`botfsm.js:239-242`); ≤2 fire tokens per squad at `squad.js:87-97`; ≤3 damaging attackers per
250 ms window at `squad.js:26-28, 146-151`; muzzle-block + friendly-on-ray at
`botfsm.js:969-986`; blow-counted bursts at `botfsm.js:619-633`.

**E7 — There are already two "the director overrides the bot" hooks.** `brain.forceFlank` and
`brain.forceDisengage` (`botfsm.js:145`), written by the referee (`squad.js:338, 356`) and consumed
at the top of `planCombat` (`botfsm.js:370-399`). **The objective layer needs exactly one more hook
of the same shape**, not a new FSM.

**E8 — The FSM state set is frozen at eight strings.** `botfsm.js:4-6`, R17: `patrol | suspicious |
alert | combat | flank | suppress | retreat | dead`. This design **adds none**.

**E9 — Brains are dormant outside mission phases.** `botfsm.js:164`: `if (phase !== "infil" &&
phase !== "assault" && phase !== "exfil") return;`. A match driver that invents a phase string
freezes all nine bots.

**E10 — Think cadence and the arena's headroom.** `botfsm.js:51-52, 180-196`: ≤ 4 brains think per
tick, 0.15 s near / 0.4 s far, round-robin; near/far is decided by `hdist(bot.pos, S.player.pos)`
(`botfsm.js:190`) — another `S.player` read G2 must generalise. At **9 bots** (not the budgeted 12)
every bot gets a think slot every ~2.25 ticks (37 ms), far inside the 150 ms near interval: the
scheduler is not the constraint in a 10-actor match.

**E11 — Cover scoring reads the live player transform in two places.** `pickCover` penalises nodes
inside the player's aim cone using `player.yaw` unconditionally (`botfsm.js:584-586`), and
`enterFlank` falls back to `sim.state.player.pos` when no last-known exists
(`botfsm.js:474`). Both are legitimate single-player heuristics and both become **information the
bot did not earn** the moment the target is a human in PVP. Named as an out-of-scope finding in
Part 12 with a fix.

**E12 — Grenade eligibility is gated on a *static* target.** `botfsm.js:450-466`: fire-token holder
AND `squad.playerStaticFor(t) >= 6` AND range 8–30 m AND solvable arc AND ≤ 1 live mission-wide AND
20 s squad cooldown AND past the latched reaction. `squad.js:375-380` tracks "static" as ≤ 2.5 m of
drift.

**E13 — Nav is a walkable grid with A*, string pulling and a reachability flood fill.**
`nav.js:426-473` `findPath` returns a **string-pulled** (shortest, straightest) polyline;
`nav.js:475-497` `randomPoint`; `nav.js:499-502` `reachable`. **This is why bots beeline: the pathing
layer's job is the shortest line, so route *choice* has to be made above it.**

**E14 — Authored map data available today.** `colliders.js:57-61` exports `cover: [{pos, dir,
height}]` built from `layout.js` props; `colliders.js:73` exports `nodes` — the frozen 15-key R24
set (`layout.js:544-560`: `dock_spawn … exfil`), of which only `arcade_ground`, `arcade_upper`,
`plaza_center`, `plaza_west`, `gallery_mid` fall inside the LANTERNWALK arena bounds
(X ∈ [−48,+26], Z ∈ [−34,+22], `pvp_design` §3.3). **There is no lane, route, junction or approach
data anywhere.** Part 5 asks for it.

**E15 — Scenario posing already exists for tests.** `botfsm.js:186-187, 199` honour
`bot._scenarioPinned` (posed bots never consume a think slot and never act); `content.json`
`scenarios` is the R10 battery. Part 11's scripted tests are built on this mechanism, not a new one.

---

## PART 1 — THE OBJECTIONS THAT ARE NOW VOID (stated explicitly, as instructed)

`_design/expansion/pvp_design.md` §1.2 excluded two of the three modes the owner has now asked for.
Both exclusions were reasoned; the reasoning is re-examined here rather than waved away, because one
of the two arguments is genuinely dead and the other is merely *cheap to solve now*, and conflating
them would be a lie.

**"Objective modes with carried flags — carrier state is the hardest thing to replicate under client
authority (E4); a desynced flag is an unloseable match."** — **VOID, completely.** That objection is
a netcode objection and there is no netcode. With one human and nine bots the entire match runs in
one browser, in one `sim.step` loop, against one authoritative state object. There is no replication,
no host authority, no client-authority trust problem, no lag compensation, no rewind window, no
version handshake. Flag ownership is a field on a local object. **Every argument in `pvp_design`
Parts 6 and 1.0.1 is inapplicable to this build**, and this document does not inherit any constraint
derived from them.

**"Free-for-all — the spawn director's core signal is *team* influence (Part 2.4); FFA spawning is a
genuinely different algorithm and would ship worse."** — **Partly void, and the remainder is cheap.**
The half that was about shipping risk under netcode (a second spawn algorithm to desync, to
validate host-side, to keep deterministic across peers) is gone with the netcode. The half that is
real — an influence map whose cells carry `±1.0` **by team** (`pvp_design` §2.4) has no meaning when
every actor is hostile to every other — is a genuine algorithmic difference, and it is solved in
four lines rather than a redesign: in FFA the grid becomes a **per-observer threat field**, deposited
as `+1.0` for *every* actor and evaluated as *"how much of the map's population is near this
point"*, so `influence(p)` for a spawning actor is simply `−(density at p)` and the safety term does
the rest. That is a spawn-director change, owned by the spawn lane; this document flags it as a
dependency (Part 13) and does not pretend it is free.

**One more consequence worth naming, because it changes what "bot AI" even means here:** the
distinction between "the bots" and "the netcode's bot backfill" (`pvp_design` Part 7) disappears.
There is no backfill. **Nine bots are the game.** If they do not understand the modes, there is no
mode. That is why this document exists and why its acceptance criteria (Part 11) are pass/fail on
*objective outcomes*, not on plausible-looking behaviour.

---

## PART 2 — THE SHAPE OF THE SOLUTION

### 2.1 One sentence

**A per-team commander decides WHERE each bot should be and WHETHER it may shoot; the existing,
audited FSM decides everything about HOW it fights when it gets there.**

The objective layer never aims, never rolls a reaction, never touches a σ, never grants a metre of
sight. It writes a small intent struct per bot; the FSM reads it in three places.

### 2.2 The monotonic fairness rule (the binding constraint on this whole document)

> **The objective layer may move a bot's feet and may withhold its fire. It may never grant
> information, speed, accuracy, reaction, health, or ammunition.**

Every knob specified below is one-directional: it can only make a bot *less* immediately lethal
(hold fire, walk instead of shoot, decline a flank, expose itself by carrying a flag) or move it to a
different place. Consequences that matter:

- The audited fairness surface remains an **upper bound**. `ai.selftest.cjs`'s 30-seed battery
  cannot regress, because nothing the layer does can add a shot, shorten a reaction, or shrink a
  jitter. Part 11 asserts this mechanically, not by argument.
- The layer draws from its **own RNG stream** — `sim.rng.obj`, a new `mulberry32` alongside
  `movement/weapons/bots/fx/audio` (doctrine §4: *"Each independent system owns its OWN mulberry32
  stream"*). If it drew from `rng.ai` it would shift every downstream reaction and jitter roll and
  the on/off comparison in Part 11.6 would be impossible to write.
- **Radio moves feet, never the crosshair.** A shared contact can send a bot somewhere. It can never
  become an aim point. The existing code already enforces this at `botfsm.js:812-834` (E5) and this
  layer does not touch that code path.

### 2.3 Module map

| File | New? | Owns | THREE-free |
|---|---|---|---|
| `core/ai/objective.js` | **new** | the per-team commander: situation read, role assignment, task generation, posture, the respawn ledger | yes |
| `core/ai/roles/{tdm,ctf,ffa}.js` | **new** | one mode's quota table, role-utility terms and break rules — the only per-mode code | yes |
| `core/ai/comms.js` | **new** | the team blackboard (Tier R, Part 4): contact ring, teammate state, objective calls, staleness | yes |
| `core/level/lanes/<mapId>.js` | **new** | authored lane graph, routes, approaches, stations (Part 5) | yes |
| `core/ai/botfsm.js` | **edited, ~40 lines** | reads `bot._obj` in 3 places (§2.5) | — |
| `core/ai/squad.js` | **edited, ~25 lines** | per-team instances; blackboard split from tokens (§4.4) | — |
| `core/ai/perception.js` | edited by **G2**, not by this lane | target list + hysteresis | — |

### 2.4 Tick order and budget

`objective.js` runs inside `aiStep`, **before** `squad._tick`, as slot 3a of the existing sim tick
(`sim.js:142` — `aiStep(sim, nav, squad, DT)`, architecture §3.9). It is not a new tick slot.

- **Commander cadence: 2 Hz per team, staggered** — team A on ticks where `tick % 30 === 0`, team B
  on `tick % 30 === 15`. Two teams therefore never think on the same tick.
- **Event-driven re-run**: a Tier-W objective event (flag taken/dropped/returned/captured, our
  carrier died, score changed the posture band) forces an immediate commander pass for the affected
  team, rate-limited to once per 0.5 s per team. This is what makes a defender turn around *now*
  instead of up to 500 ms later.
- **Per-bot cost in `think()` is O(1)**: read `bot._obj`, compare three numbers.
- **Budget: ≤ 0.25 ms/tick amortised**, measured by an `OBJ_PERF` counter mirroring `AI_PERF`
  (`botfsm.js:56`). At 9 bots × ≤6 roles the assignment pass is ~54 utility evaluations twice a
  second per team. Headroom against the ≤1.5 ms AI budget (E10, architecture §8) is large, and the
  owner's 30 fps target makes it larger: the sim is fixed-dt 1/60 (`sim.js:34` — `const DT = 1/60`), so a 30 fps frame
  runs two ticks and at most one commander pass.

### 2.5 The intent struct (the entire contract between the layers)

```js
bot._obj = {
  role:        'attack'|'escort'|'defend'|'intercept'|'return'|'carry'|'lane'|'trade'|'hunt'|'evade',
  reason:      <one of a CLOSED vocabulary — Part 11.8>,
  assignedT:   <sim time>,      holdUntil: <sim time>,   // latch, §6.2
  anchor:      [x,y,z] | null,  anchorKind: 'lane'|'station'|'cutoff'|'stand'|'flag'|'freeform',
  route:       { laneId, wpIndex, dir:+1|-1 } | null,     // Part 5
  priority:    0..1,            // goal ownership, §2.6
  firePolicy:  'free'|'defensive'|'hold',   selfDefenseM: 12,
  posture:     'press'|'balanced'|'control',
  breakFight:  false,           // ONE-SHOT: release tokens and move NOW (E7-shaped hook)
  noRetreat:   false, noFlank: false, noGrenade: false,
};
```

Nothing in that struct is a number the FSM uses for aiming. That is the point.

### 2.6 The three FSM edits (and nothing else)

1. **Goal ownership**, in `planCombat` (`botfsm.js:359`), after the existing `forceDisengage` /
   retreat / `forceFlank` blocks:
   - `priority ≥ 0.75` → the goal is `obj.anchor`, pathed via the lane graph (Part 5), and
     `pickCover` (`botfsm.js:557`) is restricted to candidates within **6 m of the current path
     leg** — the bot advances cover-to-cover *along its route* instead of picking the best cover
     in the neighbourhood.
   - `0.40 ≤ priority < 0.75` → the goal stays the FSM's, but `pickCover` gains
     `+2.5 × inObjectiveBand(node)` (the term `pvp_design` §7.3.5 already specified) so the bot
     drifts toward where it is wanted while fighting normally.
   - `priority < 0.40` → **byte-identical to today**. This is the campaign-equivalent path and it is
     what the regression battery runs.
2. **`breakFight`**, handled immediately above the existing `forceDisengage` block, in the same
   shape (`botfsm.js:370-376`): release tokens (`squad.release`), set the goal to `obj.anchor` with
   sprint, set `brain.taskLockUntil = t + 3.0`, and **stay in `combat`** (E8 — no new state). A bot
   that breaks off is still a soldier who will shoot someone who steps in front of it; it is simply
   no longer choosing this fight.
   In `act()` the movement freeze becomes `wantHold = visibleFresh && t >= brain.taskLockUntil`
   (`botfsm.js:789-790`) — otherwise a task-locked bot stops dead the moment it sees anyone, which is
   exactly the "escort that never escorts" failure.
3. **Fire policy**, one line at the single `wantFire` computation (`botfsm.js:850`):
   ```js
   if (obj.firePolicy === 'hold') wantFire = false;
   else if (obj.firePolicy === 'defensive' &&
            !(d3 <= obj.selfDefenseM || t - (bot.lastHitT ?? -9) < 2.0)) wantFire = false;
   ```
   Monotonic by construction: it can only remove a shot.

`noRetreat` gates the retreat roll (`botfsm.js:379-392`), `noFlank` gates the token-less flank roll
(`botfsm.js:412-415`), `noGrenade` gates eligibility (`botfsm.js:450`). All three are removals.

---

## PART 3 — WHAT A BOT WANTS: the common decision spine

Before the per-mode chapters, four pieces of machinery every mode uses. They exist so the three
modes are three quota tables and three utility functions, not three AIs.

### 3.1 The situation read (2 Hz, per team)

```
situation = {
  score:  { us, them, limit },              // Tier W
  clock:  { elapsed, limit, remaining },    // Tier W
  urgency: max(progress, timeFrac),         // progress = max(us,them)/limit
  pressure: clamp(-(us - them) / K, -1, +1) * urgency,   // K = 8 kills (TDM), 1 capture (CTF), 6 (FFA)
  enemyLive: <respawn ledger, §3.3>,
  ours:   [ per-teammate: pos, hp, alive, role, carrying, lastContactBearing ],
  flags:  <mode state, Tier W>,
  contacts: <Tier R ring, ≤6 entries, 8 s decay>,
}
```

`pressure > +0.45` → **PRESS**, `pressure < −0.45` → **CONTROL**, else **BALANCED**. Hysteresis band
±0.10 and a **10 s minimum posture hold**, so a team does not oscillate at the threshold.

### 3.2 Posture, expressed through levers that already exist

| Posture | Mechanism | Existing lever |
|---|---|---|
| PRESS | preferred bands halve; flank roll 0.5 → 0.75; converge cap 2 → 3; retreat roll 0.6 → 0.45; accept fights below 60 hp | `squad.pushActive()` — already consumed by `prefBand` (`botfsm.js:85-88`) and by the push branch of `planCombat` (`botfsm.js:421-426`). The commander sets the team's push flag; **no new code path in the FSM.** |
| BALANCED | today's behaviour | — |
| CONTROL | preferred bands ×1.25 (capped at the archetype max); flank roll 0.5 → 0.20; no pursuit beyond 20 m from the anchor; retreat roll 0.6 → 0.80; `pickCover` weights `blocksLOS` ×1.4 | `noFlank`, `priority`, and the existing cover terms |

**A team that is ahead late genuinely plays differently**: it stops flanking, stops chasing, sits at
longer range behind hard cover near its own half, and lets the clock work — which is precisely what a
human team does and precisely what makes losing feel like losing rather than like the bots got
bored.

### 3.3 The respawn ledger (the highest-value fair behaviour in the document)

The killfeed is public. The human sees it; the bots may read exactly the same thing.

```
enemyLive(t) = teamSize − |{ kills of an enemy actor in the feed with (t − killT) < respawnDelay }|
```

If `enemyLive ≤ 2`, the team goes PRESS for the remainder of that respawn window regardless of the
score pressure, and in CTF the commander re-weights toward `attack`. **This is bots understanding
that "three of them just died" is the moment to take the point** — derived entirely from public
information, symmetric with what the human can do, and it is the single behaviour that will most make
the bots read as players rather than targets.

Deliberately excluded: enemy respawn *timers* (not on the HUD), enemy hp, enemy loadouts, enemy
positions on death (the killfeed says who, not where — the *killer's* position is known only if a
teammate perceived it, which is Tier R, §4.2).

### 3.4 Latching, at the objective layer

Doctrine §2's roll-once-and-latch is a rule about certainty-by-reroll, and it applies to decisions,
not only to reactions. Therefore:

- **A role is assigned once per triggering event and latched for ≥ 4 s** (`holdUntil`). It is
  re-decided early only on a **preempting event**: a Tier-W objective event, our carrier's death, or
  the bot's own death.
- **A route is chosen once at pickup and latched**; re-chosen only on a route-invalidating event
  (damage taken from a bearing, a teammate contact call on that route), and never more often than
  once per 5 s.
- **A break-off decision is rolled once**, not evaluated every think. A bot that decided to hold its
  ground does not re-decide 6 times a second and end up doing neither.

Without this the layer becomes a per-tick coin-flip machine and the bots vibrate — the exact failure
doctrine §2 describes for reaction rolls, one level up.

---

## PART 4 — WHAT A BOT IS ALLOWED TO KNOW

This is the part the owner's requirement lives or dies on: bots must "know the full rules" without
knowing anything a player could not know. Three tiers, and **every fact a bot uses must belong to
exactly one of them.**

### 4.1 Tier P — perception (unchanged, per-bot, earned)

`core/ai/perception.js` as it stands, generalised by G2 to a target list. Sight through the awareness
meter with the night light-factor; hearing (gunshot 300 m alert / 120 m accurate, sprint steps 14 m,
walk 7 m, crouch 2.5 m, reload 10 m, slide 12 m, grenade bounce 20 m) which **updates last-known only
and caps awareness at 0.85** (`perception.js:118-171`, `combat_spec §5.2`); muzzle flash sets the
shooter's effective light to 1.0 for 1.2 s within 120 m LOS (`perception.js:90-101`).

Two consequences this document *uses*, both already in the model and both honest:

- **A bot can tell that someone is shooting, and roughly from where.** That is the muzzle-flash rule
  plus the gunshot hearing table. It is what makes the FFA third-party logic (§9.3) and the TDM
  converge logic (§7.4) legitimate rather than telepathic.
- **A bot cannot tell how hurt anyone is.** Enemy hp is never readable. Where "weakest target"
  behaviour appears below, it is built from two observable proxies only: *I* damaged them (I know my
  own damage), or I had LOS while they were hit (the impact FX are visible, `combat_spec §4.2`).

### 4.2 Tier R — the radio (per team; **does not exist in FFA**)

A squad with radios legitimately shares things. `combat_spec §5.4` already grants exactly one shared
fact and calls it *"the ONLY wallhack-free shared fact"*. This design widens it to the smallest set
that a real fireteam would have on comms, and no further:

| Shared | Fidelity | Justification |
|---|---|---|
| Teammate position, hp, alive, role, carrying-flag | exact | they are on your team; the human's HUD shows friendly pips at ≤40 m through geometry (`pvp_design` §5.3) and this is the AI's equivalent |
| Enemy contacts: `{pos, t}` ring, ≤ **6** entries, **8 s** staleness | as perceived by the writer, written at the writer's own think cadence (0.15/0.4 s) | this is `squad.noteLastKnown` (E5) widened from 1 slot to 6. 8 s matches the existing staleness bound at `botfsm.js:316` and `botfsm.js:811` |
| Contact bearing when a teammate is engaging | **quantised to 45° sectors** | "contact, west" is a callout; "he's at (−12.4, 0, 3.1)" is a wallhack |
| Objective calls: escort request, intercept call, returning call, "flag's on me" | flag, not position | position of the enemy carrier comes from the beacon (§4.3), never from the radio |

**Hard rule (E5): a Tier-R fact may set a goal. It may never set an aim point.** The trigger path
(`botfsm.js:844-885`) is untouched by this document; it still fires only at `visibleFresh` targets,
and SUPPRESS still fires at a last-known with a lateral offset.

### 4.3 Tier W — the rules broadcast (everyone, including the human, identically)

**Tier W is defined as: exactly what the HUD shows the human.** If the HUD does not show it, no bot
gets it. This is the whole fairness argument for objective awareness, and it is checkable — Part 11.7
makes it a test.

| Fact | Human sees it as | Bot reads it as |
|---|---|---|
| Score, both teams | score bar (`pvp_design` §5.3.1) | `situation.score` |
| Clock / rotation countdown | clock | `situation.clock` |
| Killfeed rows (killer, weapon, victim) | killfeed | the respawn ledger (§3.3) |
| Flag state: at base / taken by team X / dropped at P / returned / captured | HUD banner + objective marker | `situation.flags` |
| **Dropped flag position** | objective marker, exact | exact |
| **Carried flag position — the beacon** | compass pip + distance, refreshed every **3.0 s**, quantised to **6 m** | identical: a `{pos, t}` sample, 3 s old at worst, ±6 m |
| Your own team's spawn state | your HUD | own team only |

The **beacon** is the one piece of enemy-position information a bot receives without perceiving it,
and it is granted only because the human receives the same sample at the same rate with the same
error. It is what makes CTF interception playable for either side. Between beacons the bot has
nothing but its own eyes and the last sample — so a carrier who cuts into the service corridor
(`pvp_design` E6) after a beacon genuinely disappears for up to 3 seconds, for bots and human alike.

### 4.4 FFA has no Tier R — and the caps still bind

In FFA every actor is on its own team, so the radio is empty by construction. That is the structural
reason FFA bots do not gang up (§9.5). But the fairness caps in `squad.js` are a **referee**, not a
comms channel, and they must not vanish with the radio. Therefore:

> Split `squad.js`'s per-squad entry into **tokens/fire-window (keyed by squad)** and
> **blackboard (keyed by `commsGroup`)**. `commsGroup` = team id in TDM/CTF, **bot id** in FFA.

Concretely: `entry.fire`, `entry.suppress`, `entry.flank`, `entry.grenadeReadyT` stay where they are
(`squad.js:61-65`); `entry.lastKnown/lastKnownT` (`squad.js:64`) move into `comms.js` keyed by
`commsGroup`. `fireAuthOk`/`noteFireAuth` (`squad.js:146-151`) stay **global and per-victim-human**
(`pvp_design` §7.3.4): ≤3 damaging attackers on any *human* per 250 ms, and — new for FFA — **≤2
simultaneous fire-token holders whose current target is the same human** (§9.5).

### 4.5 The explicit ban list

A bot must never read, and no code path below reads: an enemy's hp, an enemy's weapon or ammo, an
enemy's aim direction (see E11 and Part 12.1), an enemy's exact position without perception or a
beacon, an enemy's respawn timer, an enemy bot's `_obj` struct or role, the sim's own future
(pathing to where a target "will be" beyond the ±30 % velocity-lead error already specified at
`combat_spec §5.5`).

---

## PART 5 — THE MAP LAYER (why bots stop beelining)

E13 is the mechanism behind every "the bots just run at me in a straight line" complaint that a
shooter has ever received: `nav.findPath` string-pulls, so a raw path to a distant goal is by
construction the shortest and therefore usually the most exposed line across the map. **Route choice
has to happen above the pathfinder.**

### 5.1 The lane graph (authored data, new, per map)

`core/level/lanes/lanternwalk.js` exports:

```js
{
  junctions: { J_PLAZA_S: [-5,0,12], J_PLAZA_N: [-8,0,-12], J_ARCADE_G: [-32,0,-7],
               J_CROSS: [-26,0,-23], J_CORRIDOR_W: [0,0,-22], J_GALLERY_N: [20,0,-14],
               J_GALLERY_S: [20,0,6], J_CUT: [12,0,-16] },
  lanes: [
    { id:'L_CENTRE',   a:'J_PLAZA_S', b:'J_PLAZA_N',    wp:[...], band:[20,38], exposure:0.85, cover:0.8, vertical:false, botTraversable:true },
    { id:'L_WEST_G',   a:'J_PLAZA_N', b:'J_ARCADE_G',   wp:[...], band:[5,14],  exposure:0.30, cover:0.6, vertical:false, botTraversable:true },
    { id:'L_ALLEY',    a:'J_ARCADE_G',b:'J_CROSS',      wp:[...], band:[5,14],  exposure:0.35, cover:0.5, vertical:false, botTraversable:true },
    { id:'L_CROSS',    a:'J_CROSS',   b:'J_PLAZA_N',    wp:[...], band:[16,24], exposure:0.55, cover:0.6, vertical:false, botTraversable:true },
    { id:'L_CROSS_E',  a:'J_CROSS',   b:'J_CORRIDOR_W', wp:[...], band:[16,24], exposure:0.50, cover:0.6, vertical:false, botTraversable:true },
    { id:'L_CORRIDOR', a:'J_CORRIDOR_W', b:'J_GALLERY_N', wp:[...], band:[4,10], exposure:0.15, cover:0.3, vertical:false, botTraversable:true },
    { id:'L_EAST',     a:'J_GALLERY_N', b:'J_GALLERY_S', wp:[...], band:[8,18], exposure:0.30, cover:0.5, vertical:false, botTraversable:true },
    { id:'L_CUT',      a:'J_GALLERY_N', b:'J_PLAZA_N',   wp:[...], band:[12,22], exposure:0.60, cover:0.5, vertical:false, botTraversable:true },
    { id:'L_BALCONY',  a:'J_ARCADE_G',  b:'J_ARCADE_G',  wp:[[-33,4.2,-14]], band:[22,35], exposure:0.45,
      cover:0.4, vertical:true, botTraversable:true, throughGoing:false, note:'E3 — the E7 mantle exit is human-only; for bots this is an overlook with one way in and out' },
  ],
  approaches: { A_STAND: ['L_CENTRE','L_EAST','L_WEST_G'], B_STAND: ['L_CROSS','L_ALLEY','L_CROSS_E'] },
}
```

Two rings exist and are the point (`pvp_design` carve rule 2): *west* PLAZA_S → CENTRE → PLAZA_N →
CROSS → ALLEY → ARCADE_G → WEST_G → PLAZA_N, and *east* PLAZA_N → CUT → GALLERY_N → CORRIDOR →
CORRIDOR_W → CROSS → PLAZA_N.

**`throughGoing:false` on `L_BALCONY` is E3 made into data.** Without it the flag carrier climbs to
the best overlook on the map and cannot get down the far side, because bots cannot mantle. A lane
whose only exit for a bot is its entrance is never a route; it is a post.

### 5.2 How a lane changes what a bot does

- **Anchors are lane waypoints, not raw points.** A bot ordered to `attack` gets
  `route:{laneId, wpIndex, dir}` and paths from waypoint to waypoint with `nav.findPath`
  (each leg short, so string-pulling produces a sensible local line rather than a map-crossing
  diagonal).
- **Cover is scored along the leg** (§2.6 item 1): candidates within 6 m of the current leg. The bot
  therefore moves cover-to-cover *down the lane*.
- **Route scoring** (used by carriers, attackers and rotating defenders):
  ```
  routeScore(R) = − 1.0 × (length(R) / mapDiag)
                  − 1.6 × Σ_legs exposure(leg)
                  − 2.2 × contactDensity(R)      // Tier R contacts within 10 m of the polyline, 8 s decayed
                  + 1.1 × friendlyDensity(R)     // living teammates within 12 m of the polyline
                  + 0.8 × bandFit(R, my weapon)  // marksman prefers L_CENTRE, cqb prefers L_CORRIDOR/L_EAST
  ```
  Chosen once, latched (§3.4). **Note what this produces without any special-casing:** a Vesper bot
  carrying a flag with two teammates near the corridor takes the corridor; a lone Corvus bot with the
  plaza empty takes the plaza; and everybody avoids the lane a teammate just called contact on.
- **Verticality is used by role, not by everybody.** `vertical:true` lanes score `+1.2` for
  `marksman` archetypes holding (`defend`, `lane` roles) and `−3.0` for any role with a destination
  (`carry`, `attack`, `return`) — because a bot that goes up there with a job has to come back down
  the way it came (E3).

### 5.3 What the map lane must deliver

Authoring the polylines is level-design work, not AI work. The AI's requirements on it are exactly
five, and all five are gate-checkable (Part 11.9): every waypoint is on walkable nav
(`nav.onNav`); every lane's endpoints are junctions; consecutive waypoints are ≤ 12 m apart and
mutually `nav.reachable`; the graph contains at least one cycle; and every lane carries an honest
`botTraversable` / `throughGoing` pair verified against E3 (no mantle, no jump).

---

## PART 6 — MODE 1: TEAM DEATHMATCH (5v5)

**Rules the bots hold:** two teams of five, 100 HP-equivalent rules per `pvp_design` Part 4, kills
score for the team, first to the kill limit **or** highest at the clock wins, 4 s respawns, friendly
fire off, no objective on the map. *(The limit and clock belong to the match-driver lane; the AI
reads them from Tier W and does not hardcode them. `pvp_design` §1.1's Skirmish numbers — 75 kills /
10:00 — were written for 6v6 and should be re-derived for 5v5 by that lane.)*

### 6.1 Roles: TDM has one role and a lane assignment

Deliberate simplification. In deathmatch, "role" is a fiction; what actually differentiates good
teams is **where they are**. So every TDM bot has `role:'lane'` plus a lane assignment and a posture,
with two transient overlays (`trade`, and PRESS-time `attack`).

### 6.2 Map presence: the anti-funnel quota

Recomputed at each commander pass, latched ≥ 8 s per bot:

| Posture | Max bots per lane | Minimum coverage |
|---|---|---|
| BALANCED | **2** of 5 | ≥ 1 bot on a lane that leads back to our own spawn cluster (the rotation guard) |
| PRESS | **3** of 5 | rotation guard relaxed to 0 for ≤ 20 s |
| CONTROL | **2** of 5 | ≥ 2 lanes covered, both adjacent to our half |

Assignment is a greedy fill by lane utility:
```
laneUtility(L, bot) = 1.4 × bandFit(L, bot.weapon)
                    + 1.1 × contactDensity(L)          // go where the enemy is known to be
                    + 0.7 × (posture==='press' ? enemyHalfness(L) : ourHalfness(L))
                    − 1.5 × occupancy(L) / quota(L)     // the funnel brake
                    − 0.6 × navDist(bot, L.entry) / mapDiag
```

**The funnel brake is the load-bearing term.** Without an occupancy penalty, five bots each
independently score the lane with the most contacts highest, and the entire team walks into one
corridor and dies to one grenade — the classic bot-team failure, and one the human will notice
within a single match. Part 11.2 measures it.

### 6.3 Push versus hold, per lane

A lane is judged locally, not just globally:

- **Push it** (advance to the lane's far junction) when: ≥ 2 friendlies on the lane **and** ≤ 1
  enemy contact on it within 8 s **and** posture ≠ CONTROL. The bot's `priority` rises to 0.75 so
  cover is picked along the leg.
- **Hold it** (occupy the best cover node within 10 m of the current junction, facing the lane)
  when: I am the only friendly on it, or ≥ 2 enemy contacts are live on it, or posture = CONTROL.
- **Give it up** (rotate to the adjacent lane on the ring) when: 2 teammates have died on this lane
  within 10 s. This is the "stop feeding the meat grinder" rule, and it uses only the public killfeed
  plus teammate positions.

### 6.4 Trading and focusing fire — with a hard cap

**Converge (the trade).** When a teammate dies, the killfeed is public and the dead teammate's last
contact is on the radio. The **≤2** nearest living teammates with `navDist ≤ 35 m` receive a
`trade` overlay for **6 s**: anchor = the dead teammate's last contact, `priority` 0.75, posture
unchanged.

**The cap of 2 is the design.** Uncapped convergence *is* funnelling wearing a tactical costume: five
bots trading one death is five bots arriving one at a time into a set crosshair. Two is a trade;
three is a rout; five is a highlight reel for the human.

**Crossfire, not stacking.** When two teammates both perceive the same target, the second one's
cover scoring gains `−1.2` for candidate nodes whose bearing to the target is within **20°** of the
first's. Combined with the existing 4 m claim spacing (`botfsm.js:579-583`), this produces two angles
on one target instead of two bots behind one dumpster — which is what "focusing fire" actually means
mechanically, and it is achieved without any bot knowing anything new.

**The fairness cap is untouched.** However many bots converge, `fireAuthOk` still admits ≤3 damaging
attackers on a human per 250 ms (E6, `squad.js:146-151`) and ≤2 fire tokens per squad. Convergence
changes *where* bots are, not *how many can shoot you*. Part 11.6 asserts this under the new layer.

### 6.5 Score and clock

- **Behind, late** (`pressure > +0.45`): PRESS. Bands halve via the existing push lever, lane quota
  rises to 3, flank roll rises, the rotation guard is dropped for up to 20 s, and bots will take a
  fight at 45 hp they would decline at 45 hp in BALANCED (retreat roll 0.6 → 0.45). They are
  spending lives for kills because kills are the only currency left.
- **Ahead, late** (`pressure < −0.45`): CONTROL. Longer bands, no flanks, no pursuit past 20 m from
  the anchor, cover weighting shifts to hard-LOS-blocking nodes, retreat roll rises to 0.8. The team
  holds two adjacent lanes on its own half of the ring.
- **Match point** (either team one kill from the limit): the leading team adds `noFlank` and
  `firePolicy:'free'` at maximum band; the trailing team goes full PRESS and additionally targets
  the **lane with the fewest known enemies** rather than the most — the last kill is cheaper on an
  empty lane.
- **Respawn ledger** (§3.3) overrides posture for its window: `enemyLive ≤ 2` → PRESS regardless.

---

## PART 7 — MODE 2: CAPTURE THE FLAG (the richest one)

### 7.1 The ruleset the bots must actually hold

This is a *proposal to the match-driver lane*; the AI consumes whatever it lands, but it needs these
five rules to exist, because four distinct behaviours below are derived from them:

1. Each team has a flag on a stand in its own half. Touching the enemy flag picks it up.
2. Carrying it to **your own stand** scores **1 capture** — **only if your own flag is home**.
3. On the carrier's death the flag **drops where the carrier died** and its position is public.
4. A dropped flag returns to its stand when touched by its **own** team, or automatically after
   **30 s**.
5. First to **3 captures**, or most at the clock; 5 s respawns.

Rule 2 is the one that makes CTF a game rather than a race, and it is the one a naive bot fails
first: a bot that runs a flag into a stand it cannot score at, and dies there, has not understood the
mode. §7.6 handles it explicitly.

**Proposed flag positions on LANTERNWALK** (map lane's call; these are *estimates from the published
coordinates in `pvp_design` §3.3* and are not nav-verified): **A_STAND (−4, 0, +14)** at the plaza
south / ramp head inside the `SC_SOUTH` pocket; **B_STAND (−26, 0, −20)** at the cross-street west
end by the arcade north door, inside `SC_NORTH`. Distances to the arena centroid (−11, 0, −6):
21.2 m and 20.5 m — **3.4 % apart**, inside `pvp_design` carve rule 3's ±8 % contract. Three genuinely
different routes exist between them (§7.7). The map lane must confirm both stands sit on walkable
nav with ≥3 approaches each, and re-measure the route lengths with `nav.findPath` rather than
trusting my arithmetic.

### 7.2 Situations (the state a commander reads, all Tier W)

| # | Situation | Meaning |
|---|---|---|
| S0 | NEUTRAL | both flags home |
| S1 | WE_CARRY | we hold theirs, ours home → **we can score** |
| S2 | THEY_CARRY | they hold ours, ours gone → we cannot score even if we grab theirs |
| S3 | BOTH_CARRY | mutual → **nobody can score until a flag comes home** |
| S4 | OURS_DROPPED | our flag is on the ground somewhere, ticking toward auto-return |
| S5 | THEIRS_DROPPED | their flag is on the ground |

### 7.3 Roles and quotas (5 slots; the human occupies one and cannot be commanded)

| Situation | attack | escort | defend | intercept | return | float |
|---|---|---|---|---|---|---|
| S0 NEUTRAL | 2 | 0 | 2 | 0 | 0 | 1 |
| S1 WE_CARRY | 0 | 2 (+carrier) | 2 | 0 | 0 | 0 |
| S2 THEY_CARRY | 1 | 0 | 1 | 3 | 0 | 0 |
| S3 BOTH_CARRY | 0 | 1 (+carrier holding) | 0 | 3 | 0 | 0 |
| S4 OURS_DROPPED | — | — | — | — | **1–2 (nearest)** | rest keep prior roles, +1 "deny" suppressing near the flag |
| S5 THEIRS_DROPPED | 2 (nearest resumes pickup) | 0 | 2 | 0 | 0 | 1 |

**The human is a wildcard the commander plans around, not a unit it commands.** The commander infers
the human's *effective* role from teammate-tier facts only (position relative to our stand / their
stand / our carrier, and whether he is carrying), and subtracts one from the matching quota. If the
human grabs the enemy flag, the situation becomes S1 and two bots become escorts **for him** — which
is the single most satisfying thing bot teammates can do, and it costs nothing but a quota lookup.

**Reassignment** is event-driven (§3.4): flag taken / dropped / returned / captured, carrier death,
own death. Otherwise a role is latched 4 s. Within a role, the *assignment of which bot* is a greedy
match on role utility:

```
u(attack)    = 1.2×routeReady + 0.8×hpFrac + 0.6×bandFit(theirHalf) − 0.9×navDist(me, theirStand)/mapDiag
u(defend)    = 1.3×(1 − navDist(me, ourStand)/mapDiag) + 0.5×bandFit(ourApproaches) + 0.3×(1 − hpFrac)
u(escort)    = 1.5×(1 − navDist(me, ourCarrier)/mapDiag) + 0.7×hpFrac − 1.0×inFightNow
u(intercept) = 1.4×cutoffFeasible(§7.8) + 0.6×bandFit(beaconLane) + 0.4×hpFrac
u(return)    = 2.0×(1 − navDist(me, droppedFlag)/mapDiag)          // deliberately the largest constant
```

`u(return)`'s constant is the largest in the table on purpose: returning your own flag flips S2→S0
and re-enables your entire offence. It is the highest-leverage action in CTF and the bots must value
it that way.

### 7.4 Attacker

Goes and gets the flag. Chooses a route by §5.2's `routeScore` (so the second attacker usually takes
a *different* lane from the first — `friendlyDensity` is positive but `contactDensity` and the
funnel brake dominate once one lane is occupied). `priority` 0.75, `firePolicy:'free'`,
`noFlank:false`. On arriving within 8 m of the enemy stand, priority rises to 0.95 and the bot pushes
the touch even under fire — the grab is worth a trade.

If the stand is **held** (≥2 live enemy contacts within 12 m of it), the first attacker requests
suppress (`squad.requestSuppress`, existing) and the second flanks via a different approach from
`approaches[B_STAND]`. This is the existing suppress+flank pair (`botfsm.js:406-416`) pointed at a
place instead of at a person.

### 7.5 Defender

- **Guards the approaches, not the flag.** Picks a cover node with LOS to the stand at **8–18 m**,
  on the highest-weighted approach lane not already covered by a teammate. Two defenders must be
  ≥ 12 m apart **and** on different approach lanes — one grenade must never remove the defence.
- **Leash.** While our flag is home, a defender does not pursue further than **18 m** from its
  anchor. This is the anti-"the whole defence chased one guy into the plaza" rule, and it is the
  behaviour that makes an attacking human's decoy play *work*, which is exactly what it should do.
- **Retreat suppressed** (`noRetreat:true`) only while an enemy contact is within 15 m of the
  stand: a defender that runs away to heal has failed at the one thing it was for. Note this is
  monotonic — it makes the defender easier to kill.
- **On FLAG TAKEN**, instantly (event-driven pass, ≤0.5 s): every defender becomes an interceptor.
  Before the first beacon arrives (up to 3 s) their target is **our own stand** — the correct
  last-known carrier position, free and honest — and they move to the approach lanes leading away
  from it. That is exactly what a human defender does in the first two seconds, and it means the
  transition is not visibly blind.

### 7.6 The carrier (a state, not an assignment — whoever touches it)

**Route.** Chosen once at pickup by `routeScore` (§5.2), latched, re-picked at most every 5 s and
only on damage-from-a-bearing or a teammate contact call on the route. Carriers **never** take a
`throughGoing:false` lane (E3 — the balcony is a trap for a bot with somewhere to be).

**Movement.** `priority` 0.95; sprint (6.4 m/s) whenever no enemy is perceived within 25 m and
hp ≥ 60; walk with the gun up otherwise. Cover-to-cover along the leg (§2.6). `taskLockUntil` keeps
it moving when it sees someone — the carrier does not stop to fight (§2.6 item 2).

**Fire policy: `defensive`, `selfDefenseM = 12`.** It shoots what is in the way (≤12 m, or anything
that has hit it in the last 2 s) and ignores everything else. `noFlank:true`, `noGrenade:true`
(a carrier stopping for a 1.2 s grenade windup, `combat_spec §5.9`, is a carrier dying).

**Calls for help.** On pickup: bark `flagtaken` ("Flag's up, moving!"). Every 6 s while carrying:
`carrier` with the sector ("Carrier, west lane"). On dropping below 50 hp with an enemy perceived:
`escortme`. These are honest information leaks in the `combat_spec §5.10` tradition — the enemy human
hears them at the same range he hears any bark, which is the same deal the campaign's flank and
grenade barks make.

**Drop-on-death is understood, and it changes the route.** A bot carrier knows that dying drops the
flag publicly where it falls. Therefore:
- Below **30 hp** with the remaining route longer than ~10 s, the carrier re-scores routes with
  `friendlyDensity` weighted **×2.5** — it deliberately dies *near its own team* so the flag is
  re-picked rather than returned. That is a genuinely game-literate decision and it is derived
  purely from rule 3.
- It never enters the retreat heal-idle (`noRetreat:true`). A carrier crouched in a corner
  regenerating for 8 s is a stalled match.

**The stall breaker (doctrine §2, "every bout ends", applied to objectives).** If the carrier's
nav-distance to its scoring stand has not fallen by ≥ **5 m in 12 s**, it commits: shortest route,
`priority` 1.0, sprint, ignore route exposure entirely, for 10 s. If it dies, the mode's normal drop
rules apply and the match moves on. A CTF match must never be able to end 0–0 because a bot found a
comfortable corner.

**Rule 2 awareness (S3 BOTH_CARRY).** The carrier **does not path into its own stand** when our flag
is out. It moves to the best cover node **10–18 m** from the stand — near enough to score the instant
our flag returns, far enough not to be camped — sets `firePolicy:'free'` (it is now a defender of
itself), and holds. On the `flagReturned` event it resumes immediately. A bot that runs a flag into a
dead stand and dies there is the single clearest signal that the AI does not know the rules; this
clause exists so that never happens, and Part 11.3 tests it directly.

### 7.7 Escort — how three bots protect a carrier without dying to one grenade

Escorts do **not** follow the carrier. They occupy **stations defined relative to the carrier's
route**, re-solved each commander pass:

| Station | Position | Job |
|---|---|---|
| **POINT** | 12–18 m **ahead** along the route polyline | walks the carrier's next leg first; its contact call reroutes the carrier |
| **WING** | 8–12 m lateral, on the side with the longer open sightline | covers the flank the route exposes |
| **TRAIL** | 10–15 m **behind** | watches the pursuit the carrier cannot see |

Constraints, all numeric and all testable:
- **Minimum 8 m between any two escorts.** The frag does 110 at centre and 15 at 5.5 m
  (`combat_spec §5.9`); 8 m guarantees a **2.5 m margin** outside the lethal radius, so one grenade
  can never take two escorts. A station whose occupant would come within 8 m of another escort is
  rejected and the next-best station is used.
- **Nobody enters the carrier's 6 m bubble.** Same reason, plus the carrier must never be blocked by
  a friendly capsule — note `fireBlocked` already holds fire for a friendly within 0.6 m of the ray
  at ≤15 m (`botfsm.js:974-985`), so clumping also silences your own escorts.
- Escorts are `firePolicy:'free'`, `priority` 0.75, `noRetreat:true` while within 20 m of the
  carrier (you do not leave the carrier to heal).
- **Escorts break off for exactly one thing**: OUR flag being dropped where they are the nearest
  returner (§7.9's hard break). Everything else, they stay.

### 7.8 Interceptor — the piece that makes bots look intelligent

The naive implementation — path to the carrier's beacon — never catches anybody, because a
tail-chase between actors of equal speed never closes. Bots that chase from behind look stupid and
are harmless. So:

**Interceptors cut off. They do not chase.**

1. From the beacon (`{pos, t}`, ≤3 s old, ±6 m — §4.3), infer the carrier's lane: the lane whose
   polyline is nearest the beacon. Infer its direction: toward its own stand along the lane graph.
   *This is inference from public data, not privileged knowledge — the human does the identical
   inference from the identical compass pip.*
2. For every waypoint `w` on the inferred remaining route:
   `ETA_me(w) = navDist(me, w) / 5.5` (blended walk/sprint, E4) and
   `ETA_them(w) = navDist(beacon, w) / 4.6` (assume they walk — deliberately **conservative**:
   if they are sprinting we under-commit, which errs toward the human, satisfying §2.2).
3. Pick the `w` maximising `ETA_them(w) − ETA_me(w)` subject to that margin being **≥ 1.5 s** —
   enough to arrive and set up rather than arrive mid-stride.
4. If **no** waypoint clears 1.5 s: **abandon the chase**. Re-role immediately — go take *their* flag
   (S2 → the counter-attack is now the best play) or fall back to our stand for the reset. A bot that
   knows a cap is unstoppable and spends the next 20 seconds running after it has not understood the
   game.
5. On arrival, hold the cutoff as a normal cover post facing the lane. `firePolicy:'free'`,
   `noFlank:true` (the flank is the cutoff).

### 7.9 Returner, and the abandon-the-fight rules in full

**Returner.** Our dropped flag's position is public and static. `u(return)` (§7.3) sends the nearest
1–2 by **nav** distance (never euclidean — the map has walls). `priority` 1.0, `firePolicy:'defensive'`
at 10 m, `noRetreat:true`. If the flag is guarded, the *second* returner goes for the touch while the
first takes the suppress token (`squad.requestSuppress`) — the existing suppress machinery, aimed at
a place.

**When a bot abandons a fight — the complete, ordered rule set.** Evaluated at the commander pass and
on preempting events; rolled once and latched (§3.4).

| Tier | Rule | Condition |
|---|---|---|
| **NEVER** | do not turn your back | took damage from a **perceived** target within the last **1.0 s**, or a target is `visibleFresh` within **8 m**. *A bot that runs from a man 6 m away who is shooting it is not tactical, it is broken — and the human will read it as broken.* |
| **NEVER** | survival first | `retreat` is active and latched (hp < 35, `botfsm.js:379-392`) |
| **HARD** | return our flag | our flag is dropped, I am one of the ≤2 nearest by nav, path ≤ 40 m |
| **HARD** | stop the cap | enemy carrier within 20 m of their stand **and** §7.8 says I have a feasible cutoff |
| **HARD** | our carrier is dying | escort within 25 m of a carrier below 40 hp with a perceived enemy near it |
| **SOFT** | recall to defence | our stand has ≥1 enemy contact <15 m and defenders <2 — leave **if** hp ≥ 40 and no target `visibleFresh` within 2 s |
| **SOFT** | escort call | carrier requested escort and I am within 30 m — same conditions |
| **NO** | everything else | a fight in progress outranks a routine reposition |

A HARD break sets `breakFight` (§2.6 item 2): tokens released, goal set, `taskLockUntil = t + 3`,
state stays `combat`. The bot runs, and shoots whatever steps in front of it on the way.

### 7.10 CTF score and clock

- **Down 0–2 with less than `T_round` left** — where `T_round = routeLength/4.6 + 10 s` (grab + run,
  measured on the map, ≈ 25–30 s on LANTERNWALK) — the losing team **stops defending**: quota goes
  `attack 3 / escort 0 / defend 1 / float 1`, posture PRESS. Conceding a capture you have no time to
  answer costs nothing; a tie you cannot break costs the match.
- **Up 2–0 with under a minute**: quota `defend 4 / attack 1`, posture CONTROL, defender leash tightens
  from 18 m to 12 m. Sit on it.
- **Sudden-death / final-capture states** are whatever the match driver defines; the AI reads them
  from Tier W and maps them onto PRESS/CONTROL. No hardcoded rule numbers in `objective.js` — a mode
  rule change must not require an AI change (doctrine §4: *data without a consumer is a lie*, and its
  converse — a consumer with hardcoded data is a drift waiting to happen).

---

## PART 8 — MODE 3: FREE-FOR-ALL

### 8.1 What changes structurally

Ten actors, ten teams. `team` is unique per actor, so `damage.js`'s friendly-fire gate never fires
and every actor is a valid target for every other. `commsGroup` = the bot's own id, so **the radio is
empty** (§4.4). The token/fire-window referee stays global (§4.4) so the human is still protected by
the ≤3-in-250 ms cap.

There is no commander in the team sense; `objective.js` runs a **per-bot** solo pass at the same 2 Hz
with the FFA role table: `hunt`, `lane`, `evade`.

### 8.2 Target selection — observable facts only

At each think, among candidates with `awareness ≥ 0.5` (Tier P only — there is nothing else):

```
targetScore(C) = 1.0 × awareness(C)
               + 0.8 × inPreferredBand(C, my weapon)
               + 0.6 × engagedElsewhere(C)      // I can SEE muzzle flashes near C — perception.js:90-101
               + 0.5 × damagedMeRecently(C)     // my own damage log; ≤5 s
               + 0.4 × iHurtThem(C)             // I dealt ≥40 to C in the last 8 s — my own log
               + 0.7 × isScoreLeader(C)         // ONLY in the last 25% of the clock, or leader within 2 of the limit
               − 0.6 × (navDist(me, C) / 40)
               − 1.0 × behindHardCover(C)
               − 1.2 × perceivedAttackersOn(C)  // the anti-dogpile term, §8.5
```

Target switching keeps G2's hysteresis: swap only if the new candidate exceeds the current by
**0.25** or the current has been lost ≥ **2 s** (`pvp_design` §7.3.3) — which also protects the
latched reaction roll (E6) from being re-armed by indecision.

**Not "nearest".** Nearest produces a dogpile on whoever is central, and in a 10-actor arena that is
usually the human. **Not "weakest" in the omniscient sense.** `iHurtThem` and `engagedElsewhere` are
the only weakness proxies, and both are things this bot personally observed (§4.1).

### 8.3 Opportunism — the third-party verb

FFA's signature play. A bot may push a fight it can *see* between two other actors, but only if:
hp ≥ 60, both parties are perceived and ≥ 20 m from me, and I can reach a firing position that is
**≥ 45° off the axis between them** (a flank on the fight, not a walk into the middle). The existing
flank machinery does this — `enterFlank` already selects cover ≥50° off an axis
(`botfsm.js:486-504`) — the objective layer only supplies a different axis (the fight's axis rather
than the player-to-squad axis) and the eligibility gate.

### 8.4 Disengaging when a third party arrives

Rolled once, latched, 4 s window:

> If I am in a fight and a **third** actor becomes perceived within 20 m, **and my hp < 60**, break:
> `evade` role, `firePolicy:'defensive'`, goal = the cover node maximising the minimum distance to
> *both* known threats while blocking LOS to at least one, `priority` 0.75.

Above 60 hp the rule does not fire — a healthy bot in a won duel finishing it and then turning is
correct play, and making every bot flinch at the sight of a third party produces a lobby where
nothing ever dies.

### 8.5 The degenerate case: nine bots dogpiling the human

This is the failure mode that would define FFA, and it is prevented by four independent mechanisms so
that no single tuning mistake can resurrect it:

1. **No radio (structural).** Nobody tells anybody where the human is. In TDM/CTF a team converges
   because it shares contacts; FFA bots physically cannot. This alone removes the mechanism by which
   dogpiles form.
2. **The diversity term** (`−1.2 × perceivedAttackersOn(C)`). A bot that can see two people already
   shooting at a target scores that target 2.4 lower and goes elsewhere. It is grounded in the
   muzzle-flash rule (§4.1), i.e. it is a thing the bot genuinely observes.
3. **Token caps, retargeted.** Existing: ≤3 damaging attackers on a human per 250 ms. New for FFA:
   **≤2 fire-token holders may have the same human as their current target**; the third is refused a
   token and takes suppress/flank/reposition, exactly as `botfsm.js:406-416` already handles
   tokenlessness.
4. **Symmetric leader-hunting.** The `isScoreLeader` term applies to *whoever leads*, human or bot,
   with the identical constant and the identical timing gate. If the human is winning late, he gets
   hunted — that is correct FFA and it is the same treatment a leading bot receives. Part 11.5 tests
   the symmetry explicitly, because "the bots gang up on the player" must be false as a *mechanism*,
   not merely absent on the seeds we happened to run.

### 8.6 FFA score and clock

- **Behind, late**: hunt. Move toward the loudest recent stimulus — the gunshot hearing table gives
  a 300 m alert radius and a 120 m accurate sector (`perception.js:128-138`), so "go where the
  shooting is" is a legitimate perception-driven behaviour, not a map-wide oracle. Bands halve.
- **Ahead, late**: survive. Prefer lanes with low `exposure` and cover, avoid the last 3 heard
  gunshot positions by ≥ 25 m, longer bands, retreat roll 0.6 → 0.8, `noFlank`. A leading bot playing
  the edges of the map for the last 45 s is exactly what a leading human does.
- **Kill-limit awareness**: a bot one kill from winning drops its opportunism gate (§8.3 requires
  hp ≥ 60; at match point it takes the fight at hp ≥ 40) and prefers the *safest* available kill,
  which the `behindHardCover` and distance terms already encode.

---

## PART 9 — FAIRNESS AUDIT: this layer against doctrine §2, line by line

Doctrine §2's AI-honesty rules are binding and are not negotiable for "better" bots. Each is checked
against what this document adds.

| Doctrine rule | Status under the objective layer |
|---|---|
| **Roll reactions ONCE per incoming swing and latch** | Untouched. The layer never writes `brain.reactionS`, `confirmT`, or `rerollArmed` (`botfsm.js:222-238`). It has its own RNG stream (§2.2) so it cannot even perturb the roll sequence. |
| **Count BLOWS not decision ticks for burst limits** | Untouched (`botfsm.js:619-633`). `firePolicy` can suppress a pull; it never decrements a burst. |
| **Commit while mid-swing; no reactive self-cancel** | Preserved and *extended*: role, route and break-off decisions are all latched (§3.4), and `flank` remains committed (`botfsm.js:307-310`). `breakFight` is a director decision at the commander cadence, not a per-tick reaction — the same class of thing as the existing referee's `forceFlank`/`forceDisengage` (E7). |
| **Cap simultaneous attackers with tokens** | Untouched and *strengthened*: caps stay global per human victim; FFA adds a same-target token cap (§8.5.3). Convergence (§6.4) changes positions, never the cap. |
| **Reaction delay 300–800 ms + ~0.018 rad jitter** | Untouched. `BANDS` (`botfsm.js:35-40`) is not read or written by this layer. Per `pvp_design` §7.2, **Veteran is not offered in PVP**; default Regular (500–700 ms). |
| **Every bout ends** | Preserved (the referee at `squad.js:326-359`) and extended to objectives: the carrier stall breaker (§7.6), the intercept-abandon rule (§7.8.4), the 4 s role latch, and the 6 s trade window all guarantee no task runs forever. |
| **A timeout verdict must never reward passivity** | Applied at the mode level: the losing team stops defending when a capture is no longer answerable (§7.10), and Part 11.1 fails a bot-only match that ends 0–0. |
| **Telegraph honesty / barks are information, never fake** | New barks (`flagtaken`, `carrier`, `escortme`, `intercept`, `returning`, `capped`) fire **only** on the real event they name, per `combat_spec §5.10`'s explicit ban on fake lines. A `carrier` bark carries the true sector. Vocabulary addition is a freeze amendment (Part 12.4). |
| **No damage multipliers, no HP inflation, ever** | Untouched. Bots and humans share HP per `pvp_design` §7.2/§4.5 (R16 across teams). |

**And the one rule this document adds to that list**, because the layer creates a new way to cheat
that doctrine never had to name: **§2.2's monotonic rule.** Any future objective-layer knob that
could *increase* a bot's lethality, sight, or speed is out of contract, and Part 11.6 is the machine
that catches it.

---

## PART 10 — WHAT THIS LAYER DOES **NOT** DO (so nobody "finds" it missing)

- **No new FSM states** (E8). Every behaviour above is a goal, a fire policy, or a suppression of an
  existing roll.
- **No adaptive difficulty.** `pvp_design` §7.2 rules it out and the reason stands: rubber-banding a
  reaction roll to the human's performance is invisible manipulation and it breaks roll-once-and-latch.
- **No bot voice comms simulation beyond the existing bark budget** (per-bot 4 s, global 2 s,
  `squad.js:184-192`). Objective-critical barks join the mandatory family (priority ≥3) that already
  bypasses cooldowns.
- **No learning, no persistence, no per-match memory.** Deterministic from seed, per doctrine §4.
- **No bot mantling, jumping or sliding.** E3 — that is a locomotion feature, not an AI feature, and
  inventing it here would be a lie in lane data.
- **No pathing to where a target "will be"** beyond the ±30 % velocity-lead error already in
  `combat_spec §5.5`.

---

## PART 11 — HOW THIS IS TESTED

Doctrine §5: *done = observed effect*, and *"Play the game to find what audits can't."* Everything
below is headless, deterministic, exit-coded, and runs in Node against the real sim — the pattern
`core/ai/ai.selftest.cjs` already establishes (E1), including its `customColliders()` micro-worlds
and its `bot._scenarioPinned` posing (E15).

**New files:** `core/ai/objective.selftest.cjs` (the batteries below) and a `pvpScenarios` block in
`content.json` holding the posed setups, mirroring the existing R10 `scenarios` contract so the
content gate validates their references the same way (`mission.js:124-133`).

### 11.1 Gate 0 — the modes actually resolve (the acceptance criterion)

Bot-only matches, no human, 20 seeds each, on LANTERNWALK:

| Mode | PASS condition |
|---|---|
| TDM | reaches the kill limit before the clock in **≥ 15/20** seeds; no match ends 0–0; `stuckBotSeconds == 0` |
| CTF | **≥ 1 capture in ≥ 17/20** seeds; median time-to-first-capture ≤ 150 s; **no seed ends 0–0**; no flag is held by one carrier for > 60 s without the stall breaker firing |
| FFA | the leader reaches ≥ 60 % of the kill limit in **≥ 18/20** seeds |

**If CTF cannot produce captures without a human, the bots do not understand CTF.** This gate is the
whole owner requirement compressed into one number, and it is checked before any tuning discussion.

### 11.2 Battery TDM

- **T-TDM-1 — no funnel.** Sample lane occupancy every 1.0 s over 20 seeds. FAIL if any team has
  ≥4 of 5 members on one lane for > 10 consecutive seconds, or if any lane sits unoccupied by *both*
  teams for > 40 % of the match.
- **T-TDM-2 — the trade.** Pose a 5v5; kill one bot with a scripted damage call from a known
  position. PASS if **≤2** living teammates within 35 m nav retask to that position within 2.0 s
  (assert the count is exactly capped, both directions), and ≥1 arrives within 8 s on seeds where a
  path exists.
- **T-TDM-3 — posture responds to the score.** Same seed, three runs, forcing the score at 75 % clock
  to (behind 8) / (level) / (ahead 8). Assert **signs**, not magnitudes: mean preferred band shrinks
  when behind and grows when ahead; flanks-per-minute rises when behind and falls when ahead; mean
  distance from own spawn cluster rises when behind and falls when ahead. Sign assertions survive
  tuning; magnitude assertions do not.
- **T-TDM-4 — crossfire, not stacking.** In a posed two-attacker/one-target scene, assert the second
  bot's chosen cover node is ≥20° off the first's bearing to the target in ≥ 16/20 seeds.

### 11.3 Battery CTF — the scripted scenarios the owner's requirement names

Each is a posed scene, a fixed seed, a bounded run, and a single assertion about what the bot *did*.

- **T-CTF-1 — a bot picks up a flag and routes home.** One bot, enemy flag, no enemies.
  PASS: `flagTaken` emitted ≤ 6 s; nav-distance to its own stand strictly decreases over every
  rolling 10 s window (tolerance 2 m); `flagCaptured` emitted before 90 s; the path never enters a
  `throughGoing:false` lane.
- **T-CTF-2 — a defender abandons a duel to chase a carrier.** Defender in a live duel at 20 m; fire
  the `flagTaken` event with a beacon.
  PASS: within (think interval + 0.4 s) its `role` is `intercept`, `breakFight` fired, tokens
  released, and it has physically moved ≥ 10 m toward a **cutoff** node within 4 s.
  **Paired negative:** identical scene with the duel opponent at 6 m dealing damage.
  PASS: the bot does **not** turn its back within 1.0 s of taking damage (the NEVER rule, §7.9) —
  this is the test that keeps "objective-driven" from becoming "suicidal".
- **T-CTF-3 — escorts do not clump.** Carrier + 3 escorts, 30 s, sampled at 4 Hz.
  PASS: minimum pairwise escort distance ≥ 6 m on ≥ 95 % of samples; **never** two escorts within
  5.5 m (the frag radius) for > 0.5 s continuously; no escort inside the carrier's 6 m bubble;
  and a scripted frag detonated at the escort centroid kills **≤1** escort.
- **T-CTF-4 — the returner.** Drop our flag at a known point; three defenders at 15 / 30 / 60 m nav.
  PASS: exactly ≤2 are assigned `return`; the **nav-nearest** (not euclidean — verify with a wall
  between the euclidean-nearest and the flag) is one of them; `flagReturned` fires within
  1.5 × the walk ETA.
- **T-CTF-5 — the carrier knows rule 2.** Force S3 BOTH_CARRY.
  PASS: the carrier's position stays 10–18 m from its own stand for ≥ 15 s and it **never enters the
  stand radius**; on a scripted `flagReturned` it enters and captures within (distance/4.6 + 2 s).
- **T-CTF-6 — interception geometry.** Carrier walking a known lane; interceptor placed where a
  tail-chase cannot close but a cutoff can.
  PASS: the chosen goal is *ahead* of the carrier along the lane
  (`dot(goal − beacon, laneDir) > 0`) and the bot reaches that waypoint before the carrier in
  ≥ 15/20 seeds.
- **T-CTF-7 — no hopeless chase.** Carrier 8 m from its stand; bot 60 m away.
  PASS: no intercept goal is set; the bot re-roles within 2.0 s (asserted on the `objrole` event).
- **T-CTF-8 — the stall breaker.** Pin a carrier with `_scenarioPinned` dummies blocking its route.
  PASS: after ≤ 12 s of < 5 m progress, `priority` reaches 1.0, the route switches to shortest, and
  nav-distance to the stand falls within the next 8 s.
- **T-CTF-9 — the human wildcard.** Script the human picking up the enemy flag.
  PASS: within 1.0 s the team situation is S1 and **2 bots** hold `escort` with stations solved
  against the *human's* route; no bot is assigned `attack`.

### 11.4 Battery FFA

- **T-FFA-1 — no teaming, and no radio.** 9 FFA bots, 20 seeds. Assert
  `comms.sharedWrites === 0` (structural: the blackboard is per-bot). Behavioural: for every pair
  that accumulated ≥5 s of mutual LOS at ≤25 m, at least one targeted the other at some point.
  FAIL on any pair that co-existed in sight for ≥15 s with zero mutual targeting.
- **T-FFA-2 — no dogpile.** 9 bots + a **passive stationary dummy** in the human slot (so the metric
  measures the AI, not the tester's skill). Sample at 1 Hz the number of bots whose current target is
  the dummy. PASS: 95th percentile ≤ 3, mean ≤ 2.0; and the dummy's share of total damage dealt is
  ≤ 1.5 × the median bot's share.
- **T-FFA-3 — third-party disengage.** A duels B at 15 m; introduce C perceived at 18 m.
  PASS: with A at 55 hp, A breaks to cover with `firePolicy:'defensive'` within 2.0 s in ≥ 16/20
  seeds; with A at 95 hp, the break fires in < 10 % of seeds.
- **T-FFA-4 — leader-hunting is symmetric.** Two mirrored runs, identical seeds: the score lead given
  to the human slot, then to a bot. PASS: mean number of bots targeting the leader in the final 25 %
  of the clock differs by ≤ 15 % between runs.

### 11.5 Battery: map usage (the "don't beeline" gate)

- **T-MAP-1** — over 20 bot-only matches, the ratio (path length actually travelled) / (straight-line
  distance) between a bot's task assignment and its arrival has median ≥ **1.15** — bots demonstrably
  do not take the straight line — while the 95th percentile stays ≤ 2.2 (they are not sightseeing).
- **T-MAP-2** — zero bot paths ever enter a `throughGoing:false` lane while holding a
  destination role (`carry`, `attack`, `return`). This is the E3 regression gate.
- **T-MAP-3** — every lane waypoint passes `nav.onNav`, every consecutive pair passes
  `nav.reachable`, the lane graph contains a cycle. Bake-time, exit-coded (§5.3).

### 11.6 Battery: fairness regression (the most important one)

Re-run `ai.selftest.cjs`'s existing 30-seed fairness battery **with the objective layer live**, in
each of the three modes, asserting every existing invariant unchanged: zero pre-reaction shots; one
reaction roll per confirm episode; ≤2 fire tokens per squad; ≤3 damaging attackers on a human per
250 ms; zero muzzle-blocked pulls; blow-counted bursts; ≤4 brains/tick; AI CPU ≤ 1.5 ms;
**objective CPU ≤ 0.25 ms**.

Plus the new, decisive one — **the monotonicity assertion**:

> Run the same seed twice, once with the objective layer's fire-withholding and role assignment
> active and once with `firePolicy` forced to `'free'` and `priority` forced to 0. Assert that every
> bot's `reactionLog` (`botfsm.js:234`) and every entry of `AI_PROBE.jitter` (`botfsm.js:966`) are
> **bit-identical** between the two runs, and that the number of shots fired in the layered run is
> **≤** the number in the unlayered run.

Bit-identical reaction and jitter logs prove the layer never touched the lethality RNG (which is only
possible because of the separate `rng.obj` stream, §2.2). The shot-count inequality proves
monotonicity in the direction that matters. **If either assertion fails, the layer has become a
cheat and the build does not ship.**

### 11.7 Battery: the information audit (Tier W = the HUD)

An automated check that no bot reads a fact the HUD does not publish:

- `objective.js`, `comms.js` and `roles/*.js` are grepped at test time for the forbidden reads:
  `state.player.pos`, `.hp`, `.yaw`, `.weapon`, and any enemy actor field outside
  `{id, team, alive}`. Non-zero matches **fail the build**. (Crude, and exactly the kind of crude
  that catches the real regression six months from now.)
- The HUD's published-fact list and the Tier-W table (§4.3) live in **one** shared constant,
  `PUBLIC_FACTS`, consumed by both the HUD and `objective.js`. A fact the bots use but the HUD does
  not render is then impossible to write, rather than merely discouraged — doctrine §4's
  *"data without a consumer is a lie waiting for an audit"*, run in reverse.
- Beacon fidelity is asserted: no bot ever reads a carrier position sample newer than 3.0 s or more
  precise than 6 m.

### 11.8 Observability (so a human can audit a match by reading it)

`sim.emit('objrole', { botId, role, reason, t })` on every assignment, with `reason` drawn from a
**closed vocabulary** (`FLAG_TAKEN`, `FLAG_DROPPED`, `CARRIER_NEEDS_ESCORT`, `CUTOFF_FEASIBLE`,
`CUTOFF_INFEASIBLE`, `TRADE`, `LANE_QUOTA`, `POSTURE_PRESS`, `POSTURE_CONTROL`, `RESPAWN_LEDGER`,
`STALL_BREAKER`, `LEASH`, …). Free-text reasons are banned — an enum is greppable, testable, and
cannot drift into fiction. The test harness dumps a role timeline per match; a reviewer reads one CTF
match's timeline and confirms it tells a coherent story.

### 11.9 The one test a machine cannot run

Doctrine §5: *"Play the game to find what audits can't."* Before ship, one human plays one match of
each mode, and the transcript must contain, in CTF, at least one of each: a bot grabbing the enemy
flag unprompted, a bot intercepting and killing a carrier, a bot returning a dropped flag, and a bot
escorting the *human* carrier. If the batteries pass and that session does not produce those four
events, the batteries are measuring the wrong thing.

---

## PART 12 — OUT-OF-SCOPE FINDINGS IN THE EXISTING CODE (named, not silently fixed)

These are real, they are in shipped code, and they become fairness issues specifically because the
target becomes a human. Each is flagged with a recommendation; none is changed by this document.

1. **`pickCover` reads the live player yaw unconditionally** (E11, `botfsm.js:584-586`): the
   ±15° "don't run at the barrel" penalty is computed from `player.yaw` whether or not the bot can
   see the player. Against a bot-fighting-campaign-player this is a harmless heuristic; against a
   human in PVP it is *knowing where you are looking through a wall.*
   **Recommendation:** gate the term on `P.seesPlayer || t - P.lastSeenT < 1.5`, else use the yaw as
   of the last sighting. Cheap, and it removes the only through-wall read in cover scoring.
2. **`enterFlank` falls back to the true player position** (E11, `botfsm.js:474`:
   `(lk && lk.pos) || (P && P.lastKnown) || sim.state.player.pos`). The fallback fires exactly when
   the bot has *no* legitimate knowledge.
   **Recommendation:** if neither last-known exists, do not flank — return and stay in `combat`.
3. **Last-stand and retreat semantics are per-*squad* and campaign-shaped** (`botfsm.js:321-327,
   379-392`, `squad.js:236-245`). In a 5v5 with 5 s respawns, "squad reduced to 1" fires constantly
   and grants a permanent +25 % aggression (`botfsm.js:629`).
   **Recommendation:** disable last-stand in respawn modes; base the retreat gate on *living
   teammates within 40 m* rather than a raw squad count.
4. **The bark vocabulary is frozen (R13)** and this design needs six new kinds (§7.6, Part 9).
   **Freeze-amendment request**, with the `combat_spec §5.10` honesty rule attached: each new bark
   fires only on the true event it names.
5. **`aiStep` is gated on campaign phase strings** (E9, `botfsm.js:164`). A match driver must run the
   sim at `phase:'assault'` during a live match, or extend the gate.
   **Recommendation:** reuse `'assault'` — it costs nothing and leaves A1's headless weapon probes
   (which rely on `'menu'` dormancy, `botfsm.js:22-26`) untouched.
6. **Think-cadence and token re-arbitration are keyed to `S.player`** (E10, `botfsm.js:190`;
   `squad.js:271-287`). Both must key to *nearest enemy actor* under G2, or in a 10-actor match every
   bot on the far side of the map thinks at the near rate because the human happens to be close.

---

## PART 13 — DEPENDENCIES AND OPEN QUESTIONS

**From the teams/perception lane (G2 — this document is written on top of it and cannot ship first):**
1. `team` on every actor; `perceive()` iterating an enemy list and keeping the highest-awareness
   candidate as `bot.percept.target`, with the 0.25/2 s switching hysteresis (`pvp_design` §7.3.2-3).
2. `squad.js` instanced per team, with the tokens/blackboard split of §4.4.
3. The `S.player` reads at `botfsm.js:190`, `botfsm.js:474`, `botfsm.js:584-586`, `squad.js:271-287`,
   `squad.js:375-380` generalised (Part 12 items 1, 2, 6).

**From the match-driver lane:**
4. The Tier-W event stream and the `PUBLIC_FACTS` constant shared with the HUD (§4.3, §11.7):
   score, clock, killfeed rows, flag states, dropped-flag positions, and the **3 s / 6 m carrier
   beacon**. The beacon is a *mode* feature, not an AI feature — if the HUD does not show the human a
   carrier pip, the bots must not get one either, and CTF interception becomes much weaker for both
   sides.
5. Confirmation of the CTF ruleset (§7.1), especially **rule 2** (own flag must be home to score) —
   §7.6's hold-near-stand behaviour is derived from it and is wrong without it.
6. `phase:'assault'` during live matches (Part 12.5).

**From the map lane:**
7. `core/level/lanes/lanternwalk.js` per §5.1, with the five gate-checkable properties of §5.3, and
   honest `botTraversable` / `throughGoing` flags verified against E3 (no mantle, no jump).
8. Nav-verified flag stand positions and route lengths (§7.1 — my figures are estimates from
   published coordinates, not measurements).

**From the spawn lane:**
9. The FFA influence-map variant (Part 1): per-actor density instead of ±team, so FFA spawning is not
   the mode's weak point.

**For the owner:**
10. **Bot difficulty default.** `pvp_design` §7.2 rules Veteran out of PVP and defaults to Regular
    (500–700 ms reaction). With **nine** bots rather than a mixed lobby, Regular across the board may
    read as either "fair" or "easy" — recommend shipping the Recruit/Regular/Hardened selector on the
    lobby screen and defaulting to Regular, then re-deciding after the first real session. This is a
    preference question, not a technical one.
11. **Team composition on the human's side.** The human plays with 4 bot teammates. Recommend they
    default to Regular as well: bot teammates that are noticeably worse than bot enemies is the
    oldest complaint in the genre, and R16's no-inflation rule means the only honest lever is the
    band — which must therefore be the same on both sides.

---

## PART 14 — BUILD ORDER (each step's done-condition is an observed effect)

1. **G2 first, verified headless.** Two teams of bots, no objective layer, `ai.selftest.cjs` green
   with the fairness battery running in a two-team world. *Done = a 5v5 bot-only Skirmish on
   Meridian Ward that ends, with zero fairness regressions.* Nothing below matters if this fails.
2. **`comms.js` + `objective.js` skeleton + TDM roles.** Lane graph authored for LANTERNWALK.
   *Done = T-TDM-1 (no funnel) and Gate 0/TDM pass over 20 seeds.*
3. **The monotonicity harness (§11.6) — built before CTF, not after.** It is the gate that keeps
   every later behaviour honest, and it is far cheaper to write now than to retrofit onto three
   modes' worth of tuning.
4. **CTF.** Flags, beacon, roles, carrier, escort stations, interception, returner.
   *Done = Gate 0/CTF (≥17/20 seeds produce a capture, bot-only) plus the full §11.3 battery.*
5. **FFA.** Solo comms group, target scoring, third-party logic, the four anti-dogpile mechanisms.
   *Done = Gate 0/FFA plus §11.4, especially T-FFA-2 and T-FFA-4.*
6. **The human session (§11.9)** on all three modes, then tune — and re-run §11.6 after every tuning
   pass, because tuning is exactly where a monotonicity violation gets introduced by accident.

---

*Design sign-off: every on-disk claim in Part 0 traces to a file read this session and is cited by
line. Where this document proposes numbers that were not measured — LANTERNWALK route lengths, flag
stand positions — it says so and routes them to the lane that can measure them. Where the existing
code already does something the design needs, the design uses it rather than replacing it: the
objective layer adds one hook of a shape the referee already established, one intent struct, and
three lines inside `botfsm.js`. Everything lethal still runs through the audited path.*
