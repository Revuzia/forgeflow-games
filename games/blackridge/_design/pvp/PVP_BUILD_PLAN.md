# BLACKRIDGE — PVP BUILD PLAN (AUTHORITATIVE)

Status: **BUILD CONTRACT.** Written 2026-08-20 by the build director, synthesising
`modes.md`, `arena.md`, `bot_ai.md` and `architecture.md` and adjudicating every conflict
between them.

Authority order: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` >
`_design/combat_spec.md` + `_design/level_design.md` + `_design/architecture.md` (the v1
freeze) > **this document** > the four PVP design docs > `_design/expansion/pvp_design.md`.

**Where this document rules, it overrides all four design docs.** Where it is silent, the
four docs stand, in their declared domains (Part 0.2). Where a design doc and this document
disagree and this document did not notice, this document is wrong — but say so in a lane
report rather than choosing silently.

Owner's directive (verbatim): *"the campaign is not much of a campaign, i fight two bad guys
and then i wandered for 2 minutes and foud nothing. Turn it into a PVP map instead. the same
map can be multiple modes - 1. 5v5 , 2. Capture the Flag, 3. FFA. Each game will have a
maximum of 10 players. At this point thats me, the tester, and 9 ai (npcs). They need to know
the full rules of each game, and fight to win/survive. We will start with the same MAP for all
3 modes. Campaign is now PVP and this game has no campaign mode atm. 30fps is fine."*

---

## PART 0 — HOW THIS DOCUMENT DECIDES

### 0.1 The fact all four docs rely on, restated once so no lane re-derives it

**One human plus nine bots means the entire match runs in ONE browser, in ONE `sim`, on one
fixed-dt clock.** There is no network, no host, no guest, no replication, no interpolation
buffer, no lag compensation, no client-authority trust boundary, no rewind window, no
relevance culling, no determinism handshake, no host migration, no join/leave, no
anti-cheat.

`_design/expansion/pvp_design.md` §1.2 excluded two of the owner's three modes and both
exclusions were netcode arguments. **Both are VOID, and this plan relies on that in Parts 1,
3 and 4:**

- *"Objective modes with carried flags — carrier state is the hardest thing to replicate
  under client authority (E4); a desynced flag is an unloseable match."* — **entirely void.**
  There is nothing to replicate. The flag is three enum values and a carrier id on one local
  object, read by the same code that reads bot health. **CTF ships** (lanes W8/W9).
- *"Free-for-all — the spawn director's core signal is team influence (Part 2.4); FFA
  spawning is a genuinely different algorithm and would ship worse."* — **half void, and the
  remaining half is solved rather than used as a cut.** The shipping-risk half (a second
  algorithm to desync and validate host-side) died with the netcode. The real half — a grid
  whose cells carry ±1.0 *by team* has no meaning when every actor is hostile — is a
  scoring-weight problem, solved in Part 1 C8 and Part 3.5. **FFA ships** (lane W9).

Consequently **out of scope, do not build**: `pvp_design.md` PART 6 in its entirety
(cheating, relevance culling, hit-claim validation, suspicion counters, vote-kick,
determinism handshake), §1.0.1 (relay/transport budget), §7.4 (join/leave/takeover, host
migration, bot brain re-attach), and lane N1 (`core/net/*`). The one rule inside PART 6 that
survives is not an anti-cheat rule at all: **bots must never read a live enemy transform.**
That is a doctrine §2 AI-honesty rule and it is enforced in Part 5.

**30 fps is the accepted target.** The sim still steps at fixed `dt = 1/60` (`core/sim/sim.js:34`)
— that is the determinism contract, not a frame rate. At 30 fps that is two sim steps per
rendered frame, so **the per-frame AI budget doubles**: ≤3.0 ms AI and ≤8 brain-thinks per
rendered frame. Nothing in this plan assumes a 60 Hz render, and every timing is expressed
in seconds evaluated in the sim, never in frames. Anyone proposing a 30 Hz sim to "save CPU"
is proposing to invalidate every seeded battery in the repo.

### 0.2 The adjudication rule

Roughly forty numbers, names and structures differ across the four docs. They are not
adjudicated by seniority or by recency. They are adjudicated by this rule, declared once:

> **MEASUREMENT beats ARITHMETIC beats ASSERTION. A claim produced by a probe run against
> real colliders, or by reading the real call site, outranks a number scaled from a
> superseded document.**

That resolves into four **domain authorities**. Inside its domain a doc wins by default and
this document only intervenes where it is provably wrong:

| Doc | Authority over | Why |
|---|---|---|
| **`arena.md`** | geometry, bounds, spawn-point set, veto radii, flag positions, sightlines, cover, `ZONE_BASE`, nav bake | Every number came from `_design/pvp/arena_probe.mjs` run against the real `core/level/colliders.js`. It also caught three defects its own carve created (a 72.0 m through-line, a 68.8 m artery, base-room tubes) and fixed them in the edit list. |
| **`architecture.md`** | code structure, module boundaries, file ownership, event vocabulary, freeze amendments, harness impact | Every structural claim traces to a call site read on disk (E1–E10, all re-verified in Part 0.3). |
| **`modes.md`** | rules, rule numbers, edge cases, termination proofs, match flow, HUD | The only doc that ruled every edge case and proved termination state by state. |
| **`bot_ai.md`** | bot objective behaviour, the information model, the fairness proof | The only doc that supplies a *machine* that proves the objective layer is not a cheat, and the only one that solves the beeline problem at the right layer. |

### 0.3 Evidence ledger — verified by the build director this session

Everything below was read on disk while writing this plan, not inherited from the four docs.
Where it contradicts a design doc, the contradiction is named in Part 2.

| # | Fact | Source |
|---|---|---|
| **V1** | `makeMission(content, emit)` exports the frozen triple `{start, tick, forfeit}`. Constructed at `core/sim/sim.js:309`, ticked at `sim.js:179`, forfeited at `runtime/boot.js:214`, started at `boot.js:275`. **A match driver exporting the same triple drops into all four sites unchanged.** | `core/sim/mission.js:1-4`, `sim.js:179,309`, `boot.js:214,275` |
| **V2** | `const ENGINE_BOT_CAP = 12;` and the spawn drain honours it. **10 actors leaves 2 of headroom.** | `core/sim/mission.js:23,318` |
| **V3** | `damage.js:50` — `if (sim.mission) sim.mission.onPlayerDeath(sim);`. Death notification from the sim into the driver is an established pattern. | `core/sim/damage.js:50` |
| **V4** | No team concept anywhere. `applyDamage(sim, who, amount, attacker, part, src)` has no team parameter; `perception.js:69` is literally `const player = S.player;`. **Generalising this is the single largest change in the build.** | `core/sim/damage.js:28`, `core/ai/perception.js:69` |
| **V5** | `soldiers.js:705` — `if (!bot) { removeActor(rec.botId); continue; } // checkpoint restore reap`. **Respawn-by-new-botId needs ZERO `soldiers.js` edits.** | `core/chars/soldiers.js:705` |
| **V6** | `squad.js:43` — `const squads = new Map(); // squadId → entry`, and `squadIdOf(botId)` at `:77-79` reads `b.squadId`. **Two teams do not need two squad instances.** | `core/ai/squad.js:43,58,77-79` |
| **V7** | Bots are dormant unless phase ∈ {`infil`,`assault`,`exfil`}: `botfsm.js:164`. | `core/ai/botfsm.js:164` |
| **V8** | `stepBotLocomotion` reads only `cmd.yaw/crouch/sprint/moveX/moveZ`. **`cmd.jump` is never read; mantle is player-only** (`p._m`, `player.js:343`). Bots cannot mantle, jump or slide. | `core/sim/player.js:587-600`, `:343` |
| **V9** | `sim.flags.noTarget` already exists and is honoured by **both** `perception.js:71` and `ballistics.js:132`, with a public setter `sim.setNoTarget(on)` at `sim.js:265`. **This is the warm-up freeze lever — no new flag is needed.** | `core/ai/perception.js:71`, `core/sim/ballistics.js:132`, `sim.js:265` |
| **V10** | `makeStreams()` returns exactly **four** streams: `spread, ai, mission, fx`. There is no `bots`, no `movement`, no `audio`, no `obj`, no `match`, no `spawn`. | `core/rng.js:21-28` |
| **V11** | `bakeNav(colliders, opts)` defaults `cell = 1.0`; called at `runtime/boot.js:160` as `bakeNav(colliders)` **with no opts**. `GRID_MAX = 160`, `FOOT_R 0.2`. | `core/ai/nav.js:38-49`, `boot.js:160` |
| **V12** | `nav.js:337` — an unknown POI zone key falls through to **0.1**, not to `DEFAULT_AMBIENT 0.35`. | `core/ai/nav.js:32-37,337` |
| **V13** | The accumulator clamp in `boot.js` is **5** steps (`while (acc >= DT && steps < 5)`), discarding the remainder at 5. | `runtime/boot.js:341,347` |
| **V14** | **Hitstop does not exist.** `grep -rn "hitstop\|hitStop" core/ runtime/` returns zero matches. | grep, this session |
| **V15** | `__test.startMission()` is called by **eleven** harness files, not two: `aimfeel.py:381`, `ads_blend_probe.py:44`, `deployverify.py:171`, `lanec_ablate.py:48`, `lanec_audit.py:134`, `lanec_gate.py:180`, `lanec_ground.py:98`, `lanec_redhunt.py:106`, `lanec_slot.py:95`, `perfprobe.py:541`, `playprobe.py:75`. **Six of those belong to the concurrent aim wave.** `testsurface.js:634` already defines `t.startMatch` as an alias of `t.startMission`. | grep, `core/test/testsurface.js:634` |
| **V16** | `aimfeel.py` deliberately uses a **real mission, never `setScenario`**, and reads `player.alive`, `player.weapon`, `phase` while taking timing numbers. It does **not** enable god mode. | `_harness/aimfeel.py:377-395` |
| **V17** | `lanec_ground.py` samples `blvd_cye_seam` at (37.0, 1.65, −36.0) and `street_customs` at (−6.0, 1.65, −37.0) — **both outside the Lanternwalk arena** (X ≤ +24.5, Z ≥ −34.5). | `_harness/lanec_ground.py:31-39` |
| **V18** | `content.json` top-level keys today: `_owner, _contract, version, mission, archetypes, pois, signage, pickups, reverbZones, scenarios`. Archetypes: `rifleman, cqb, marksman, heavy`. Scenarios: `S1..S9, C1, menu, bench`. Four scenarios reference mission wave spawn ids via `{"spawn": …}`, resolved by `scenarios.js:229 findSpawn`. | `content.json`, `core/test/scenarios.js:229,298,639` |
| **V19** | `core/match/` **does not exist yet.** Nothing has been built. | `ls core/match` → no such directory |

---

## PART 1 — THE CONFLICT REGISTER

Every material disagreement between the four docs, its ruling, and why. Rulings are binding
on all lanes.

### C1 — Mode identifiers

**Conflict.** `deathmatch` (architecture) vs `skirmish` (modes) vs `tdm` (arena, bot_ai).

**RULING.** Code id **`tdm`**; display name **"SKIRMISH"**; the two are separate fields
(`mode.id`, `mode.displayName`). Ids: `tdm`, `ctf`, `ffa`. Files
`core/match/modes/{tdm,ctf,ffa}.js`.

**Why.** `tdm` is already authored into arena.md's fifty spawn points as a `modes:[...]`
string, so choosing anything else means hand-editing 50 data rows. The `deathmatch`/`skirmish`
disagreement was a code-id versus display-name collision; separating the two fields dissolves
it rather than picking a loser.

### C2 — Team names and tints

**Conflict.** RAVEN/VEKTOR `#c8a05a`/`#6f90bd` (architecture) vs AMBER/SLATE `#d9a441`/`#7c9fd0`
(modes) vs ALPHA/BRAVO and WEST/EAST (arena).

**RULING.** Team ids `0` and `1`. Names **AMBER** and **SLATE**. Tints **`#d9a441`** and
**`#7c9fd0`**. The human is always actor 0, always `'P'`, always **AMBER**. Arena's WEST/EAST
are *spawn-side* labels and are remapped once, here: **AMBER = WEST side**
(`SC_LANTERN` + `SC_ARCADE` + `SC_WEST`), **SLATE = EAST side** (`SC_MARKET` + `SC_GALLERY` +
`SC_NORTH`). ALPHA/BRAVO are retired as names.

**Why.** AMBER/SLATE derive from `pvp_design §3.1`'s faction rim tints and are the only pair
carrying an authored colour rationale. **VEKTOR is the campaign's antagonist faction** — naming
a PVP team after the enemy we just deleted re-imports fiction the owner cut.

### C3 — Arena bounds

**Conflict.** X ∈ [−48,+26], Z ∈ [−34,+22] = 74 × 56 m (architecture, modes, both inherited
from `pvp_design §3.3`) vs X ∈ [−48.5,+24.5], Z ∈ [−34.5,+14.6] = 73.0 × 49.1 m, **2593 m²
connected walkable** (arena, measured).

**RULING.** **arena.md.** `bounds = {min:[−48.5,−2,−34.5], max:[24.5,14,14.6]}`.

**Why.** Measurement beats inheritance. The other two transcribed a figure from a document
written for 12 actors and six maps. The shrink is itemised and every cut is a dead end: the
ramp stub (−192 m²), the plaza south strip (−160 m²), the market-street stub (−137 m²), the
gallery east strip (−45 m²). **Consequence, which lanes must propagate:** every area-derived
number in `modes.md` was computed against "74 × 56 = 4144 m²" and is now computed against
2593 m² of walkable ground. That invalidates modes.md's FFA veto arithmetic (see C7) and
softens its score-limit arithmetic (see C12).

### C4 — Flag stand positions

**Conflict.** Four different answers:
- architecture: `[−3,0,14]` and `[−24,0,−22.5]` — which are the **spawn cluster anchors**.
- modes: `(−10,0,+16.5)` and `(−26,0,−23)`.
- bot_ai: `(−4,0,+14)` and `(−26,0,−20)`, self-labelled *"estimates … not nav-verified"*.
- arena: **`FLAG_WEST (−33.5, 0, +12.0)`** in the carved Lantern Yard, **`FLAG_EAST (+6.5, 0, −30.0)`**
  in the carved Exchange House.

**RULING.** **arena.md.**

**Why.** It is the only answer where the flags sit in rooms *built for them*: two 11 × 8 m
volumes that are exact 180° rotational mirrors, three 4.0 m doors each at mirrored offsets,
four interior cover pieces each mirrored piece-for-piece, and measured travel parity
(mid→flag 42.0 / 40.0 m = 4.9% apart; attacker-spawn→enemy-flag 80.0 / 76.0 m = 5.1% apart).
The probe also caught and fixed a 63.3 m door-to-door tube through both rooms. architecture's
positions are literally the spawn anchors, which violates modes.md's own V8 (no spawn within
6 m of a stand) by construction; bot_ai defers to the map lane explicitly.

**Consequences lanes must propagate:**
- modes.md §3.1's derived geometry is **void**: stand-to-stand is not 42.6 m, it is **82.0 m
  of nav path, 12.8 s at 6.4 m/s sprint**.
- modes.md §3.7's anti-turtle tie-break ("a team that never attacked scores the full 42.6 m")
  becomes **82.0 m of nav path**, and *flag pressure is measured as nav distance, not euclidean*.
- modes.md §3.7's CTF-overtime COLLAPSE exemption arithmetic is recomputed and **survives with
  a larger margin**: plaza centre (−5,0,0) → FLAG_WEST = 30.9 m, → FLAG_EAST = 32.1 m, both far
  outside the 12 m ring. The 8.0 m stand exemption ruling stands unchanged.
- **A new defect falls out of this, which no doc caught** — see C7b.

### C5 — Spawn point set

**Conflict.** 30–50 points / 4 clusters `SC_SOUTH|NORTH|EAST|WEST` (architecture); 38 points /
same 4 clusters (modes); **50 points / 7 clusters, every one probe-validated** (arena).

**RULING.** **arena.md.** 50 points, 7 clusters (`SC_WEST, SC_ARCADE, SC_LANTERN, SC_NORTH,
SC_MARKET, SC_GALLERY, SC_PLAZA`). Team modes use 44 across 6; FFA unlocks `SC_PLAZA` and uses
all 50 across 7. The 4-cluster scheme is retired — its anchors were authored against the
*un-carved* map.

### C6 — Spawn-point authoring contract

**Conflict.** ≥2.0 m clearance, cluster spread ≥250 m² (architecture, modes) vs **≥1.5 m
clearance, cluster bbox ≥110 m² plus a ≥14 m max-pair-separation clause** (arena).

**RULING.** **arena.md**, plus its `yaw` clamp: every spawn yaw must lie within **±60° of its
cluster's inward normal**, re-taking the best-view yaw inside that cone. Forward view stays
≥8 m and points-per-cluster stays ≥6 in all three docs — no conflict there.

**Why.** The probe measured that a 2.0 m bubble **failed 41 of 51 candidates** in a 6–7 m-wide
gallery and alley, and 250 m² is geometrically impossible in a 7 m corridor. The failure the
250 m² rule guards against is a grenade wiping a spawn cluster, which is a *pair-separation*
problem — so the amendment measures it directly rather than through a proxy that the geometry
cannot satisfy.

### C7 — Spawn veto radii

**Conflict.** Three incompatible tables.

| | architecture | modes | arena |
|---|---|---|---|
| team V1 / V2 / V3 | 22 m / 60 m / ±35° ≤40 m | 22 / 60 / 40 (verbatim) | **12 / 25 / ±35° ≤20** |
| FFA V1 / V2 / V3 | same radii, reweighted | **14 / 30 / 22** + V10 cluster cooldown 3 s | (not separately specified) |

**RULING — the single merged table, binding:**

| # | Veto | **Team modes** | **FFA** |
|---|---|---|---|
| V1 | living enemy (team) / any living actor (FFA) within | **12.0 m** | **10.0 m** |
| V2 | LOS to head height 1.55 m at the point, within | **25.0 m** | **20.0 m** |
| V3 | inside a view cone ±35°, within | **20.0 m** | **16.0 m** |
| V4 | a friendly (team) / any actor (FFA) spawned at this point in the last | 1.5 s | 1.5 s |
| V5 | live grenade, or explosion in the last 1.5 s, within | 12.0 m | 12.0 m |
| V6 | a teammate (team) / any actor (FFA) died within 8 m of this point in the last | 5.0 s | 5.0 s |
| V7 | `mode.spawnVeto(m, actor, point)` | mode hook | mode hook |
| V10 | **cluster cooldown** — any actor spawned in this cluster within | — | **3.0 s** |

`V7` per mode: `tdm` → always false. `ctf` → within **12 m of either flag's current position**,
and within **15 m of your own stand while your own flag is `CARRIED`** (so a defender cannot
spawn on top of an escaping carrier). `ffa` → always false. Foothold's V7 is retired; there is
no Foothold.

**Relaxation ladder** (one step at a time, re-scoring after each, each step incrementing
`spawnStress`): team → `V3 off → V6 off → V2 25→15 → V1 12→8`. FFA →
`V3 off → V6 off → V10 off → V2 20→13 → V1 10→7`. If nothing survives the full ladder: spawn
at the cluster centroid with **3.0 s** protection instead of the mode default, and log it.
**Never fail to spawn.**

**Why.** arena.md's team numbers are the only ones with evidence: measured mean actor
separation is 31 m; a 22 m veto disc is 1520 m² against 2593 m² of walkable ground, so with
five enemies alive it vetoes essentially the whole arena and **the ladder, not the scorer,
chooses every spawn** — which is the exact failure `pvp_design` PART 2 exists to prevent. A
60 m LOS veto in an arena where **0.0% of rays reach 55 m** is not a signal, it is a duplicate
of V1. modes.md's FFA radii (14/30/22) were derived against 4144 m² gross rather than 2593 m²
walkable **and are looser than arena's team radii**, which is backwards: FFA has nine threats,
not five, so its radii must be ≤ the team ones, never larger. Hence FFA sits one notch tighter.
modes.md's **V10 is kept** — it is the only doc that named the "spawned next to the guy who
spawned a second ago" failure, and it is FFA-specific and cheap.

### C7b — NEW DEFECT: five spawn points sit inside their own flag room

**Conflict.** None of the four docs caught this, because arena.md authored the spawn set and
modes.md authored the constraint, and nobody ran one against the other.

**The measurement** (arithmetic from arena.md's own coordinates, C4's flag positions, and
modes.md §4.3.3's V8/V9):

| Point | Position | Distance to its own flag | Verdict |
|---|---|---|---|
| `sp_l1` | (−32.0, 0, 12.5) | **1.58 m** to FLAG_WEST | violates V8 (≥6 m) |
| `sp_l3` | (−33.0, 0, 9.5) | **2.55 m** | violates V8 |
| `sp_l2` | (−39.5, 0, 11.5) | 6.02 m, open room, direct LOS | violates V9 (no LOS to own stand under 10 m) |
| `sp_m7` | (6.5, 0, −32.0) | **2.00 m** to FLAG_EAST | violates V8 |
| `sp_m8` | (4.0, 0, −27.5) | **3.54 m** | violates V8 |

**RULING.** modes.md's V8/V9 **survive** — its reasoning is correct: a spawn inside your own
flag room turns a defensive wipe into an instant free re-defence, which deletes the attacker's
reward for winning the fight. Therefore those five points carry `modes: ["tdm","ffa"]` and are
**disabled in CTF**.

**Consequence, which is a real task, not a note.** That drops `SC_LANTERN` to **4** and
`SC_MARKET` to **5** CTF-eligible points, below the ≥6-per-cluster contract. **W4 must author
+3 CTF-only points on the Lantern Yard's plaza/arcade approaches and +2 in the market-street
pocket, probe-validated**, and `tools/probe_arena.mjs` gains a **per-mode** cluster-count
assertion so this class of defect cannot recur silently.

### C8 — The FFA spawn score function

**Conflict.** Three different fixes for the same known break.
- architecture: keep `min(1, dNearest/55)`, raise its weight 40→52, drop the friendly term.
- modes: **replace** single-nearest with crowd repulsion `1/(1 + Σ_a exp(−d/18))`, weight 55,
  plus an unsigned `danger(p)` grid at −26.
- arena: keep single-nearest but **saturate at 30 m not 55**, weight 55, plus `+18 × spread(p)`
  (an unsigned grid).

**RULING — merged, and the merge is not a compromise, it is the union of two different signals:**

```
score_ffa(p) = 55 * ffaSafety(p)        // modes.md 4.4 — crowd repulsion over ALL actors
             + 18 * spread(p)           // arena.md 2.5.3 — unsigned, time-decayed 4 m grid
             + 12 * p.cover
             - 20 * recency(p)          // 1.0 if used <12 s ago → 0 at 24 s
             - 18 * facing(p)           // max over ALL actors within 40 m of clamp0(cos θ)
             -  8 * clusterHeat(p)      // 1.0 if any actor spawned in p.cluster <3.0 s ago
             +  6 * rng.spawn()

ffaSafety(p) = 1 / (1 + Σ_{a ≠ spawner, alive} exp(−d(p,a) / 18))
```

Team modes keep `pvp_design §2.3`'s function verbatim (safety saturating at 55 m, the
friendly-**proximity** term at 22, signed `influence(p)` at 18). Both weight tables live side
by side as `SCORE_WEIGHTS.team` and `SCORE_WEIGHTS.ffa` in `spawns.js`, readable at a glance.

**Why.** modes.md supplies the decisive argument and it is the only one that addresses the
actual break: single-nearest fails **silently** — *"a point 60 m from one actor and 8 m from
three others scores a perfect 40"* — and in a 2593 m² arena with ten actors that configuration
is common, not exotic. arena.md's 30 m saturation makes the term less binary but still counts
one actor. architecture's reweighting does not touch the break at all. Its worked values are
adopted as the tuning intent: one actor at 22 m → safety 0.772; **three** at 22 m → 0.530; one
at 60 m → 0.965.

`spread(p)` is **not** a competing safety term and is not double-counted: crowd repulsion is
instantaneous geometry, `spread` is time-decayed *history* (deaths deposit +2.0 and decay at
×0.85/s), so the two answer different questions. modes.md's separate `−26 × danger(p)` **is**
dropped — it is `spread(p)` with the sign flipped, and keeping both would double-count the
same grid.

`facing` narrows 60 → **40 m** because only 0.8% of measured rays exceed 40 m and none exceed
55 m; beyond 40 m the term is noise.

### C9 — Where the bot objective layer lives

**Conflict.** Three architectures for one layer.
- architecture: `actor.duty = {role, goal, radius, weight, targetHint}` written by
  `mode.assignDuties(m)`, read by botfsm in 3 places; file `core/ai/duty.js`.
- modes: `bot.obj = {role, goal, urgency}`; file `core/match/bot_objective.js`; hooks H1/H2/H3.
- bot_ai: `bot._obj` — a 12-field intent struct; files `core/ai/objective.js` +
  `core/ai/roles/{tdm,ctf,ffa}.js` + `core/ai/comms.js` + `core/level/lanes/<mapId>.js`; three
  botfsm edits; a monotonic fairness rule; its own RNG stream.

**RULING. bot_ai.md's architecture, with architecture.md's ownership seam — and the seam is
cut here, once, so no lane negotiates it:**

```
mode.assignDuties(m)            →  actor.duty = {role, target, urgency, targetHint}
   (in core/match/modes/<id>.js — PURE MODE SEMANTICS, no map knowledge, THREE-free)
                                        ↓  read at 2 Hz
core/ai/objective.js  +  roles/<mode>.js  +  comms.js  +  lanes/lanternwalk.js
                                        ↓
bot._obj = { role, reason, assignedT, holdUntil, anchor, anchorKind, route,
             priority, firePolicy, selfDefenseM, posture, breakFight,
             noRetreat, noFlank, noGrenade }
                                        ↓  read at 4 named sites
core/ai/botfsm.js
```

**`actor.duty` and `bot._obj` both exist and are NOT the same thing. Do not merge them.**
`duty` says *what the rules want* (mode's job); `_obj` says *where to stand, which lane to
take, and whether to shoot* (AI's job). `core/match/bot_objective.js` is **not built** —
putting AI code in the match lane is what created the three-way split in the first place.

**Why.** (a) bot_ai is the only doc that supplies the machine proving the layer is not a cheat
— its own `rng.obj` stream plus a same-seed assertion that `reactionLog` and `AI_PROBE.jitter`
are **bit-identical** with the layer on and off. That test is worth more than the design.
(b) bot_ai is the only doc that solves the beeline problem at the right layer: `nav.findPath`
string-pulls (`nav.js:426-473`), so a raw path to a distant goal is *by construction* the
shortest and therefore most exposed line — architecture and modes both hand the bot a raw
`goal:[x,y,z]` and would reproduce exactly the straight-line behaviour the owner will notice
in one match. (c) The specific behaviours the owner asked for — cutoff-not-chase interception,
escort stations at ≥8 m, the BOTH_CARRY hold at 10–18 m — exist only in bot_ai.

### C10 — How many botfsm.js edit sites, and which

**Conflict.** architecture: 3 (setGoal, pickCover, a `weight ≥ 0.8` carrier override).
modes: 3 (H1 pickCover, H2 planCombat, H3 patrol anchor). bot_ai: 3 (goal ownership in
planCombat, a `breakFight` branch, one `firePolicy` line at `wantFire`).

**RULING. Exactly FOUR named sites, and no others:**

| # | Site | Change |
|---|---|---|
| **H1** | `planCombat` goal ownership (`botfsm.js:359`, after the existing `forceDisengage`/retreat/`forceFlank` blocks) | `priority ≥ 0.75` → goal is `_obj.anchor` pathed via the lane graph and `pickCover` is restricted to candidates within 6 m of the current path leg. `0.40 ≤ priority < 0.75` → goal stays the FSM's, `pickCover` gains `+2.5 × inObjectiveBand(node)`. `priority < 0.40` → **byte-identical to today**. |
| **H2** | `breakFight`, immediately above the existing `forceDisengage` block (`botfsm.js:370-376` — the same shape as the referee's existing hook) | release tokens, set goal, `brain.taskLockUntil = t + 3.0`, **stay in `combat`** (no new FSM state). In `act()`, `wantHold = visibleFresh && t >= brain.taskLockUntil`. |
| **H3** | Fire policy, one line at the single `wantFire` computation (`botfsm.js:850`) | `'hold'` → false; `'defensive'` → false unless within `selfDefenseM` or hit in the last 2.0 s. **Monotonic: it can only remove a shot.** |
| **H4** | `patrol` / `alert` anchor | `brain.anchor = bot._obj.anchor`. |

`noRetreat` gates the retreat roll (`:379-392`), `noFlank` the token-less flank roll
(`:412-415`), `noGrenade` eligibility (`:450`). All three are removals.

**Why.** bot_ai's three are correct and its `priority`-graded goal ownership **subsumes**
architecture's carrier override while also fixing the "escort that never escorts" failure
(`taskLockUntil`). modes.md's **H3 patrol anchor is added as H4 and is not optional**: with
the campaign gone there are no authored patrol routes, so an idle bot has no anchor at all
and would stand still — the classic "bots stand in a doorway" failure, at spawn, in the first
playable build. See also Part 4's **patrol floor** requirement on W3.

### C10b — bot_ai's Part 12 findings 1, 2 and 6 are promoted to in-scope

bot_ai names them as out-of-scope findings. **This document rules them IN-SCOPE for lane W3,
in the same commit as the perception generalisation**, because each is a through-wall read
that is a harmless single-player heuristic today and becomes a **wallhack the moment the
target is a human**:

1. `pickCover` reads `player.yaw` **unconditionally** for the ±15° "don't run at the barrel"
   penalty (`botfsm.js:584-586`) — i.e. it knows where you are looking through a wall. Gate it
   on `seesTarget || t − lastSeenT < 1.5`, else use the yaw as of the last sighting.
2. `enterFlank` falls back to `sim.state.player.pos` when no last-known exists
   (`botfsm.js:474`) — the fallback fires **exactly when the bot has no legitimate knowledge**.
   If neither last-known exists, do not flank; return and stay in `combat`.
3. Think cadence and token re-arbitration are keyed to `S.player` (`botfsm.js:190`,
   `squad.js:271-287`). Both must key to *nearest enemy actor*, or every bot on the far side of
   the map thinks at the near rate because the human happens to be close.

Shipping any of these into a PVP build is shipping a cheat. They are W3 acceptance criteria,
not notes.

### C11 — Bot difficulty bands

**Conflict.** architecture: all `regular`, no selector, veteran banned. modes: mixed bands per
mode, three presets, veteran available in HARD. bot_ai: recommend a selector, default regular,
veteran out, and warns that bot teammates weaker than bot enemies is *"the oldest complaint in
the genre"*.

**RULING. modes.md's mixed bands and its three presets (CASUAL / STANDARD / HARD), default
STANDARD.** Bands are fixed at spawn-in for the whole match and are **printed on the
scoreboard**. No adaptive difficulty, no rubber-banding, no HP or damage multipliers, and
roll-once-and-latch stays intact.

**bot_ai's objection is examined and does not apply.** modes.md gives the human's side 4 bots
(1 hardened / 2 regular / 1 recruit) and the enemy 5 (1 hardened / 3 regular / 1 recruit). Per
*bot*, the mixes are 25/50/25% and 20/60/20% — statistically the same quality. The enemy's
extra strength is the extra **body**, which is exactly modes.md's stated intent: *the human is
supposed to be the strongest actor on their own team.* **Upheld as written.**

**Why not architecture's flat `regular`.** A lobby where every bot is identical produces a flat
scoreboard and no story — which is precisely the complaint that killed the campaign. Band
spread is what produces a ladder, and in FFA the ladder *is* the mode's payload.

**Veteran** — modes.md's narrow amendment to `pvp_design §7.2`'s blanket ban is **accepted and
built, defaulted OFF**: available only inside HARD, capped at 1, labelled on the mode-select
card as `HARD — includes one VETERAN bot (reacts in 300-420 ms)`. The ban's premise was a
public mixed lobby where a losing human cannot judge whether the loss was fair; with one human
who explicitly selected HARD, that premise does not hold. **This is an owner decision** (Part 8
item 2) — the code path ships; the preset stays off until the owner says otherwise.

### C12 — Score limits and time limits

**Conflict.** TDM 50 kills / 8:00 (architecture, arena) vs 60 / 10:00 (modes). CTF 3 captures /
10:00 (architecture) vs 3 / 12:00 (modes). FFA 25 / 8:00 (architecture, arena) vs 25 / 10:00
(modes).

**RULING.**

| Mode | Score limit | Time limit | Respawn | Protection |
|---|---|---|---|---|
| `tdm` | **50 kills** | **8:00** | 4.0 s (0 s first spawn) | 1.5 s |
| `ctf` | **3 captures** | **12:00** | 5.0 s (8.0 s during PRESSURE) | 1.5 s |
| `ffa` | **25 kills** | **8:00** | 3.0 s (0 s first spawn) | **2.0 s** |

**Why.** TDM and FFA take the shorter figures because arena.md measured what the other two
assumed: median time-to-contact **1.5 s** and P(enemy already in line of sight) **75.3%**, on
an arena **13.5% smaller** than the one modes.md scaled its 60 from. Higher contact rate on
less ground means the same kill count arrives sooner, so 50 lands the target window better
than 60. CTF keeps **12:00** because arena measured flag separation at **82.0 m of path
(12.8 s sprint each way)** — longer than any doc assumed — so three captures genuinely needs
the clock.

**All six numbers are labelled ARITHMETIC, not measurement**, per modes.md §12.6's own
honesty. The acceptance battery measures median regulation length; if the median falls outside
**6:00–10:00** (TDM/FFA) or **6:00–12:00** (CTF), **the number changes, not the design** — one
line each in `content.modes`. Expect exactly one tuning pass after the first battery.

### C13 — Overtime

**Conflict.** architecture: 2:00, first **kill** wins. modes: 3:00 cap, no respawns, first
**death** loses it for their team, COLLAPSE ring arms at OT+60 s.

**RULING. modes.md, in full**, including COLLAPSE (centre plaza `(−5,0,0)`, r 12.0 → 6.0 m over
30 s, 5 → 15 HP/s over 20 s), the CTF 8.0 m stand exemption (C4 recomputed it and it survives
with a larger margin), and FFA's last-leader-standing.

**Why.** *First death loses* is what makes zero-contact rule **against** the passive side,
which doctrine §2 explicitly requires; *first kill wins* punishes nobody for hiding. And
COLLAPSE is the termination proof: at 15 HP/s a 110 HP actor outside the ring dies in 7.3 s, so
overtime terminates within **60 + 20 + 7.3 ≈ 88 s**, comfortably inside the 3:00 cap.
architecture's 2:00 has no terminator behind it and can run out with nothing having happened.

### C14 — Warm-up length and the warm-up freeze

**Conflict.** architecture 5.0 s (mapped onto `sim.state.phase = 'infil'`) vs modes 3.0 s.

**RULING. 3.0 s**, mapped onto `'infil'`. The rules card is on screen for the full 3 s.

**Why.** 5 s of frozen countdown three times a session is 15 s of nothing; 3 s is enough to
read a five-line rules card.

**And the mechanism, which no doc specified.** `botfsm.js:164` accepts `infil`, so bots
**think during warm-up** and would try to move and shoot. Rather than invent a freeze flag:
during warm-up the match calls **`sim.setNoTarget(true)`** — an existing, tested lever
(V9: honoured by `perception.js:71` *and* `ballistics.js:132`) — and zeroes `bot.cmd.fire` /
`bot.cmd.moveX/moveZ`. On `live` it calls `sim.setNoTarget(false)`. No new flag, no freeze
amendment, and `ai.selftest.cjs:168`'s existing noTarget battery already covers the lever.

### C15 — Personal points, and FFA assists

**Conflict.** architecture: 100 kill / 25 assist / 200 capture / 50 return / 75 carrier kill,
**and no assists at all in FFA**. modes: 100 / 25 / **500** capture / 50 grab / 100 return /
150 carrier kill / 50 defend kill / 50 escort assist.

**RULING. modes.md's ledger, in full, including assists in FFA.**

**Why.** Personal points are scoreboard-only in both docs and are never a win condition, so the
richer ledger costs nothing and buys the thing the human needs: a scoreboard that *tells the
story of who did the objective work*, which is the evidence that the bots played. modes.md also
defines every term precisely (grab / return / carrier kill / defend kill within 12.0 m /
escort assist within 15.0 m of a living friendly carrier) and rules that they stack.
architecture's FFA no-assist reasoning — *"a mode with no teams should not pay for teamwork"* —
misreads what an assist is: it is **damage you did to someone who then died**, not teamwork,
and in a ten-actor scrum most damage is traded. Removing it makes the scoreboard lie. The win
condition stays kills-only, so nothing about the mode changes.

### C16 — Campaign: deleted, unwired, or archived

**Conflict.** architecture **deletes** `core/sim/mission.js` (554 lines) and the mission content
outright. modes keeps both **on disk and contract-valid but unreachable**. arena recommends
preserving the campaign *map* as the visual-gate reference.

**RULING. ATTIC — and it is neither of the two on offer.**
`core/sim/mission.js` → **`_design/attic/mission.js`**. `content.mission` (plus `pickups`
except `pk_ammo_walkover`, and the campaign scenario data) → **`_design/attic/content_campaign.json`**.
Both out of the import graph, both in git, both recoverable in one move.

**Why not delete.** The owner said *"this game has no campaign mode **atm**"* — *atm* is doing
work in that sentence (arena.md Part 8.2 caught it). Deletion is one-way; the attic is one file
move. architecture itself offered this as its Part 12.4 fallback: *"cheap now, expensive later."*

**Why not modes.md's leave-it-wired.** architecture's own §6.1 argument applies against
modes.md's ruling: *"an unreachable driver is how the next agent 'fixes' the wrong file."* A
file on the import path that nothing calls is a trap.

**Consequence.** modes.md §12.7's claim that `sim.selftest.cjs --contract` keeps passing against
campaign content is **void**. The contract gate is re-authored against the PVP schema (C19)
and the campaign half retires with the content.

### C17 — Map file structure

**Conflict.** arena recommends splitting into `core/level/maps/{meridian_ward,lanternwalk}.js`
so the campaign map survives as the visual-gate reference. architecture and modes both **defer**
the multi-map registry (`pvp_design` G1) as refactor risk for a requirement the owner deferred.

**RULING. Do the split, in WAVE 1, and it is mandatory — but it is a file move, not a registry.**

```
core/level/maps/meridian_ward.js   ← today's layout.js content, byte-identical
core/level/maps/lanternwalk.js     ← the carve (arena.md Part 1, E1–E19)
core/level/layout.js               ← ~10 lines: re-export, defaulting to lanternwalk
```

`buildLayout(seed)` **keeps its signature in wave 1.** No `buildLayout(mapId)` change, no
registry, no refactor of the file everything reads — which is exactly what architecture and
modes were refusing, correctly.

**Why it must happen now rather than later, and this is the part no doc has.** Verified this
session (V17): the concurrent aim wave's `lanec_ground.py` samples `blvd_cye_seam` at
(37.0, −36.0) and `street_customs` at (−6.0, −37.0). **Both are outside the Lanternwalk arena.**
`lanec_gate.py`'s `neonwedge` pose at (5, 8) sits beside the new `pk_van` (X[0.9,3.1] Z[5.4,10.6]),
and `lanec_ground`'s `arcade_seam` at (−32, −20.5) sits ~1 m from the new `arc_part_1`
(X[−33.5,−32.5] Z[−19,−12]). A single-file mutation of `layout.js` **silently invalidates the
aim wave's ground and z-fight reference poses mid-investigation.** Preserving
`maps/meridian_ward.js` is what lets those probes keep running. arena.md's "nice-to-have split"
is therefore a hard sequencing requirement — see Part 6, overlap **O2**.

### C18 — Is the carve wave 1 or deferred?

**Conflict.** architecture defers the carve to W10 and ships v1 with an **out-of-bounds
countdown** instead, on the grounds that the carve *"partly touches files a concurrent wave
holds."* arena makes the carve wave-1 geometry.

**RULING. arena.md — THE CARVE IS WAVE 1.**

**Why architecture's premise is wrong on the facts.** The carve lands in `layout.js` /
`maps/lanternwalk.js` and `props.js`, and architecture's own Part 9 table lists neither as held
by the aim wave. The only adjacent file is `level.js`, and arena §0.1 A7 verified that
`level.js:1089-1132` renders `layout.walls` generically by `kind` and gives a `kind:"wall"` box
a concrete wall for free — **zero `level.js` edits are required by the carve.** The one new
renderable (`case "container":`) goes in `props.js:buildKind()`, which the aim wave does not
hold.

**And the deferral has a cost architecture did not price.** Shipping a 73 × 49 m arena bounded
by an invisible timer inside a 120 × 120 m campaign map means the first playtest is played *on
the campaign map, with a countdown* — which is the thing the owner complained about, wearing a
HUD line. `pvp_design §3.0` rule 1 is absolute: no invisible walls, ever.

**What is preserved from architecture's caution.** The out-of-bounds timer ships as a
**backstop that must never fire** (a probe asserts zero out-of-bounds deaths across the
battery). And **E19 is split**: its `ZONE_BASE`/nav half is wave 1 (it is a bot-fairness bug —
see C20); its `core/render/lighting.js` intensity half is **wave 5**, because `lighting.js` is
genuinely adjacent to the aim wave's render work.

### C19 — content.json shape

**Conflict.** architecture: `content.json` v2, top-level `arena / teams / botRoster / clusters /
spawnPoints / flags / modes`, `mission` deleted. modes: a nested `pvp` block **alongside** a
retained `mission`. arena: top-level `arena` + `modes`, `mission` deleted.

**RULING. architecture's top-level v2 schema**, with modes.md's rule tables slotted into
`modes.*` and arena's data into `arena.{bounds, clusters, spawnPoints, vetoOverrides, flags}`.
`mission` moves to the attic (C16).

**Why.** A nested `pvp` block only made sense while the campaign stayed wired alongside it.
It does not, so the nesting buys nothing and costs every reader one indirection.

**The contract gate** (`core/match/contract.js`) is a re-authoring of `mission.js:28-135`'s
`validateContent()`, same two-phase split: content-internal checks throw at `makeMatch()`;
node / weapon / nav checks throw at `match.start()`. It enforces, at minimum: every `modes` key
exists in the `MODES` registry **and vice versa**; every roster archetype resolves after both
team suffixes; every weapon resolves in `WEAPONS`; every `spawnPoints[].cluster` exists, no
duplicate ids, 40–50 points, **≥6 per cluster per mode** (C7b); every `flags[].team` exists,
exactly one flag per team; every node ref resolves against the arena's 17-key set; every spawn
and flag home is inside `arena.bounds`, nav-walkable, and `nav.reachable` from every cluster
anchor; `teams.length === 2`; `botRoster.length === 9`.

### C20 — nav bake: `ZONE_BASE` and cell size

**Conflict.** arena requires three new `ZONE_BASE` entries and `bakeNav(colliders, {cell:0.75})`.
architecture states flatly that **`core/ai/nav.js` is not touched by the plan**.

**RULING. arena.md, and both halves are wave-1 blockers.**

- **`ZONE_BASE` gains** `poi_lanternyard: 0.22`, `poi_exchange: 0.20`, `poi_corridor: 0.15`,
  and `poi_alleys` rises 0.05 → **0.16** to match the PVP lighting profile's 18% floor. Owner:
  lane **W3** (it is a bot-fairness change — `perception.js` reads `nav.lightAt(x,z)` for the
  `combat_spec §5.1` light factor).
- **The bake call site** `runtime/boot.js:160` becomes `bakeNav(colliders, {cell: 0.75})`.
  Owner: lane **W1** (it is a one-line edit in a file W1 already owns — no ownership conflict
  with W3).

**Why the cell size is a blocker.** Default `cell: 1.0` against the arena's 73 × 49 bounds with
`FOOT_R 0.2` can mark the north corridor's **2.0 m pier gaps** unwalkable and **silently sever
the artery**. Every rotation behaviour in bot_ai Part 6 then dies, and the symptom presents as
"the bots won't go north", which reads as an AI bug and will be debugged in the wrong file. At
0.75 m the grid is 97 × 65 = 6305 cells, well inside `GRID_MAX 160` (V11) and the 150 ms bake
budget.

**Correction to arena.md while we are here.** arena §0.1 A3 states that a POI zone with no
`ZONE_BASE` entry *"silently becomes a bright room to the AI"* at `DEFAULT_AMBIENT 0.35`.
**Verified false** (V12): `nav.js:337` falls through to **`0.1`**, not 0.35 — `DEFAULT_AMBIENT`
applies only to collider sets with no zones at all. The fix is still required and still a
fairness bug; the direction is the opposite of what the doc says (interiors would read
*darker* than authored, so bots over-estimate their own concealment).

### C21 — Squad instancing and the token cap

**Conflict.** architecture: **one** squad instance; distinct `squadId` values isolate teams
(cites V6). modes: *"two instances in team modes; ten instances in FFA."* bot_ai: one instance,
with tokens keyed by squad and the blackboard keyed by `commsGroup`.

**RULING. One instance (architecture, verified V6) with bot_ai's split.**
`entry.fire`, `entry.suppress`, `entry.flank`, `entry.grenadeReadyT` stay keyed by `squadId`.
`entry.lastKnown` / `lastKnownT` move into `core/ai/comms.js` keyed by **`commsGroup`** =
team id in TDM/CTF, **bot id in FFA**. `squadId` values come from the roster: `t0_a`, `t0_b`,
`t1_a`, `t1_b` in team modes; `ffa_<actorId>` in FFA.

**Fire-token cap, stated once as the authority:** the ≤2-simultaneous-token cap and the
≤3-damaging-attackers-per-250 ms window apply **per target and are enforced only when the
target is a human** — plus, new for FFA, **≤2 fire-token holders may have the same human as
their current target**. The caps exist to protect *the audience*; bots shooting bots are not
the audience, and capping them would make bot-vs-bot fights unnaturally slow and starve the
human of the impression that a war is happening.

**Why.** V6 was re-verified this session: `squads` is already a Map keyed by squad id.
modes.md's ten instances buy nothing that one Map does not already give, and cost ten
allocations plus a mode branch.

### C22 — Flag rendering

**Conflict.** modes §3.1/§3.5.4: the flag is *"parented to the carrier's back socket."*
architecture §3.3: *"the default implementation follows `flag.pos` every frame and **never
reparents** — parenting to a skinned actor is a bind-pose trap (doctrine §1)."*

**RULING. architecture.** A pooled pair of flag meshes, created at boot, never `new` in a
handler, whose transform is written each frame from `sim.state.match.flags[i].pos` plus the
carrier's yaw and a fixed back-offset. modes.md's actual requirement — *visible from behind at
any distance the actor is visible at* — is satisfied by that, at lower risk and lower cost.

### C23 — Corvus and the long lane

**Conflict.** modes §1.7: *"Lanternwalk deliberately has no 45 m+ lane, so Corvus is a weak
pick."* arena §1.0: the Storm Gallery's centre lane is a **measured 46 m clear run** (all five
of its cover pieces are wall-huggers — `gal_shelf_1` X[17.05,17.55], `gal_shelf_2`
X[22.45,22.95], `gal_dump_1/2` likewise), and Corvus two-shots to 63.8 m at 110 HP.

**RULING. arena.md** — measured against `layout.js:416-425`.

**Consequence, which is a change of reason and not of number.** The archetype spread stays as
modes.md authored it (per team of 5: 1 `cqb`, 3 `rifleman`, 1 `marksman`; FFA's 9: 3 `cqb`,
4 `rifleman`, 2 `marksman`) — but the reason changes from *"Corvus is a weak pick"* to **"the
arena has exactly one long lane, so a second marksman has nowhere to be."** Same number,
honest reason. `pvp_design`'s original justification — that the long band belonged to another
map in a six-map portfolio — is void, because there is no portfolio: **this is the only map, so
every weapon needs a home on it.**

### C24 — E7, the reverse mantle

**Conflict.** modes §1.2 instructs the build to execute `pvp_design §3.3` edits **E1–E10
including E7**, the kiosk-roof-to-balcony reverse mantle. arena proves E7 unbuildable and
replaces it with **L4**, an alley scaffold stair. bot_ai (E3) proves bots cannot mantle at all.

**RULING. arena's L4, plus bot_ai's `throughGoing:false` on the balcony lane.** modes.md's
instruction to build E7 is **void**.

**Why.** Both halves verified. There is no window at y 4.2 — `arc_e_b2` is solid to y 5.3 and
the window band `arc_e_m1..m4` runs y[5.3,7.3] (`layout.js:173-181`); a 2.6 → 5.3 m rise is
2.7 m against `combat_spec §1.5`'s **1.35 m** mantle cap, twice the budget. And separately
(V8, re-verified this session): `stepBotLocomotion` never reads `cmd.jump`, so no bot could use
it anyway. A lane whose only exit for a bot is its entrance is not a route, it is a post — and
without `throughGoing:false` a flag carrier will path onto the best overlook on the map and be
unable to get down the far side.

### C25 — The PART 4 balance deltas (110 HP, `steadyMult`, recoil jitter, Corvus ADS)

**Conflict.** modes: implement `core/pvp/pvp_tuning.js` and `createSim({tuning:'pvp'})` now.
arena: adopt unchanged. architecture: **defer all of it** to the post-aim-wave lane, because it
lands in constants the concurrent aim wave is measuring against.

**RULING. architecture's deferral, with modes.md's seam.** `createSim({tuning:'sp'|'pvp'})` and
`core/pvp/pvp_tuning.js` ship in **wave 1 with an identity delta set**, so the wave-5 change is
a data flip, not a refactor. The deltas themselves — 110 HP, regen 5.0 s @ 28 HP/s,
`steadyMult` 0.55 → 1.00, the four recoil-jitter cuts, Corvus `adsTime` 340 → 380 ms and settle
0.35 s, scoped flinch ×2, scope glint, tac-sprint 4.0 → 2.5 s, grenades 2 → 1 — land in **wave 5**.

**Why.** These constants are exactly what the aim wave is taking before/after measurements
against. Changing them mid-investigation confounds two investigations at once and makes the aim
wave's own numbers unreadable. That is a stronger reason than the file-collision one.

**State the consequence loudly, because the owner will feel it:** **v1 PVP plays on
single-player weapon numbers at 100 HP.** Vesper's 200 ms four-shot melt and Pike's 158 ms
two-headshot exist against the human. Against `regular`-band bots reacting in 500–700 ms they
are rare. This is a known, logged, temporary shortfall with a named end date (wave 5), not an
oversight.

**Two items drop off the deferred list entirely:**
- **Hitstop.** modes lists "hitstop 0" as a delta; architecture calls it *"the one worth
  pulling forward if it is cheap."* **Verified (V14): hitstop does not exist in the codebase.**
  `grep -rn "hitstop\|hitStop" core/ runtime/` returns zero matches. `pvp_design §4.4 B12` was
  banning a feature that was never built. **Nothing to do. Remove it from every list.**
- **Friendly fire OFF** is not deferred — it ships in wave 1 (Part 3.4), because it is a
  `damage.js` gate, not a weapon constant.

### C26 — RNG streams

**Conflict.** bot_ai wants `sim.rng.obj` *"alongside `movement/weapons/bots/fx/audio`"*. modes
references `rng.bots` and `rng.match`. architecture's amendment (f) adds `match` and `spawn`.

**RULING, correcting all three.** Verified (V10): `makeStreams()` returns exactly
**`{spread, ai, mission, fx}`**. There is no `bots`, `movement`, `weapons` or `audio` stream.

`makeStreams()` gains **three**: **`match`**, **`spawn`**, **`obj`** — same `mulberry32`
construction, same fixed-offset derivation, so creating them never advances an existing
stream. `mission` is **retained under its name** (renaming it changes nothing and risks a stale
import) and simply goes unused after the attic move. modes.md's `rng.bots` callsign draw uses
**`rng.match`**.

**`rng.obj` is load-bearing and is not optional.** The objective layer must draw from its own
stream, or the monotonicity assertion in Part 5 (bit-identical `reactionLog` and jitter with
the layer on versus off) is **impossible to write** — because a shared stream would shift every
downstream reaction and jitter roll. Owner: lane W1.

### C27 — Accumulator clamp

**Conflict.** modes §0.3 requires *"at most 3 sim steps per rAF"* and a `counters.simStepsDropped`.
architecture states boot *"already runs up to 5 sim steps per rendered frame … well inside the
clamp."*

**RULING. modes.md — clamp to 3.** Verified (V13): `boot.js:341` is `while (acc >= DT && steps < 5)`
and `:347` discards the remainder at 5.

**Why.** At 30 fps the normal case is 2 steps per frame. A 5-step clamp therefore permits a
**2.5× sim burst** on any hitch, which is how a hitch spirals into a stall. 3 gives one step of
catch-up headroom and no more. One-line change, lane W1, plus the `simStepsDropped` counter.

### C28 — Bot brain reset on respawn

**Conflict.** modes §5.6 requires `bot._brain = null; bot.percept = null` on every bot respawn.
architecture does not mention it.

**RULING. modes.md, mandatory, and it is a W3 selftest assertion.**

**Why.** Without it a respawned bot carries a latched reaction, a stale confirmed target and an
8-second-old `lastKnown` from a life that ended. That breaks `combat_spec §5.6`'s
roll-once-and-latch semantics **and** produces the single most damaging complaint a shooter can
get: *"the bot knew where I was before it could see me."*

### C29 — Remaining conflicts, ruled compactly

| # | Conflict | Ruling | Why in one line |
|---|---|---|---|
| C29a | Match/mode registry: `sim.mission` deleted vs aliased | **architecture** — `sim.match === sim.mission`, one object, two names | Keeps `boot.js:214/275`, `damage.js:50` and `sim.js:179` at zero edits (V1, V3). |
| C29b | `sim.state.phase`: new enum vs frozen | **Both agree** — keep the frozen enum; warmup→`infil`, live→`assault`, overtime→`exfil`, ended→`won`/`lost`. `sim.state.match.phase` is the real state. | `botfsm.js:164`'s dormancy gate (V7) accepts all three, so bots run with zero lines changed. |
| C29c | CTF capture rule | **Both agree** — your own flag must be `AT_STAND` to score | Makes defence a real job and makes a simultaneous double capture structurally impossible, deleting an ordering edge-case class. |
| C29d | Bot callsigns: authored roster names vs a 9-of-12 seeded draw | **modes** for names (drawn from `rng.match`), **architecture** for roles (archetype + band authored per roster slot) | Names read as people; authored roles make a seeded match reproducible and team composition balanced by construction. |
| C29e | Spawn-protection visual tell | **Deferred to wave 5** (it wants a material change) | Costs an attacker at most one burst; logged as a known shortfall, not hidden. |
| C29f | Team visual read: rim uniform vs archetype tints | **architecture for v1** — per-team archetype `tint` entries (`rifleman_a/_b` etc.), zero code, zero new materials; the proper rim term is wave 5 | `architecture.md §8`'s `programs delta == 0` is a FAIL-class gate; a second material is a shader permutation. |
| C29g | Scenario ids after the campaign dies | **architecture** — S1–S9/C1/menu/bench keep their **ids**; only the data is re-authored, `{"spawn":…}` refs (V18) become explicit `{archetype,pos,yaw,team}` at the same coordinates | Renaming the battery throws away every reference frame in the blind A/B critic loop. |
| C29h | `startMission` retained? | **architecture, and harder** — retained, and its no-arg default is redefined (Part 6, O1) | Eleven harness files call it (V15), not two; six belong to the aim wave. |
| C29i | Multi-map registry (`pvp_design` G1) | **Deferred** — but the *file split* is not (C17) | `buildLayout(seed)` keeps its signature; a registry is worth its refactor risk only when a second arena exists. |
| C29j | CTF bot-capture bar: ≥1 of 10 seeds (arch) / ≥8 of 20 (arena) / **≥17 of 20** (bot_ai) | **Two bars, both named** — ≥8/20 gates *CTF playable*; **≥17/20 gates SHIP** | A mode where bots cap once in ten tries is indistinguishable from a mode that is broken; a mode where they cap 85% of the time is understood. |
| C29k | `heavy` archetype | **Deleted** (arena) | It exists for campaign beat 6, and `pvp_design §7.2`/R16 forbid HP variation between actors — all ten are the same HP. |
| C29l | Foothold / Blackline zones and sites | **Not built.** Coordinates retained as `poi` anchors only | The owner named three modes; the plaza-centre anchor `(−5,0,0)` is reused by COLLAPSE, which is the only live consumer. |

---

## PART 2 — CORRECTIONS THE DESIGN DOCS NEED

Errors found by verification, listed so they are fixed rather than propagated.

| # | Doc | Claim | Verified reality |
|---|---|---|---|
| **X1** | modes §1.6, architecture §11.1 | "hitstop 0" / "hitstop off is worth pulling forward" | **Hitstop does not exist** (V14). Zero grep matches in `core/` or `runtime/`. Remove from all lists. |
| **X2** | arena §0.1 A3 | An unknown POI zone "silently becomes a **bright** room to the AI" (0.35) | `nav.js:337` falls through to **0.1** (V12). The bug is real but inverted: interiors read *darker* than authored. |
| **X3** | bot_ai §2.2, modes §1.1 | RNG streams `movement/weapons/bots/fx/audio`; `rng.bots` | Only `{spread, ai, mission, fx}` exist (V10). See C26. |
| **X4** | architecture §7.2, §9 | `startMission` is called by `perfprobe.py:541` and `playprobe.py:75` | **Eleven** files call it (V15); six belong to the concurrent aim wave. See Part 6 O1. |
| **X5** | architecture §9 | Waves 1–3 have "a null intersection" with the aim wave's file set | True of *files*, false of *behaviour and geometry* — O1 and O2 in Part 6 are real collisions with no shared file. |
| **X6** | modes §1.2, §3.1 | Build E1–E10 including E7; stands at (−10,0,16.5)/(−26,0,−23); stand-to-stand 42.6 m | E7 unbuildable (C24); stands superseded (C4); separation is **82.0 m of path** (C4). |
| **X7** | modes §4.4 | FFA veto arithmetic against "74 × 56 m = 4144 m²" | Arena is **2593 m² of walkable ground** (C3). Radii re-derived in C7. |
| **X8** | modes §5.2.4 | "Two `squad.js` instances in team modes; ten in FFA" | `squads` is already a Map keyed by `squadId` (V6). One instance. See C21. |
| **X9** | architecture §8.1 | `core/ai/nav.js` is not touched | `ZONE_BASE` must gain three entries and `poi_alleys` must rise, or the AI light factor is wrong in three rooms (C20). |
| **X10** | arena §2.2 vs modes §4.3.3 | The 50-point set and the V8/V9 stand constraints are mutually consistent | **They are not.** Five points sit inside their own flag room (C7b). Needs +5 CTF-only points. |
| **X11** | architecture §6.5 | The carve "partly touches files a concurrent wave holds" | It touches `layout.js` and `props.js`; `level.js` renders `kind:"wall"` generically for free (C18). |
| **X12** | modes §12.7 | The campaign stays "contract-valid so the existing selftests keep passing" | The contract gate is re-authored against the PVP schema; the campaign half retires with the content (C16, C19). |

---

## PART 3 — THE FROZEN CONTRACTS

Everything ten lanes code against. **These are frozen at plan sign-off. A lane that needs a
change requests it in a lane report; it does not make it.**

### 3.1 The match driver surface

```js
export function makeMatch(content, emit, opts = {})   // → match {start, tick, forfeit, …}
```

Same frozen triple as `makeMission` (V1), so all four existing call sites are unchanged.
`sim.js:309` becomes:

```js
if (content) {
  sim.match = makeMatch(content, sim.emit, { mode: opts.mode || "tdm", rng });
  sim.mission = sim.match;               // ONE object, two names
}
```

Additions, all private but documented so lanes do not invent parallel ones:
`match.onActorDeath(sim, ev)`, `match.onPlayerDeath(sim)` (thin alias so `damage.js:50` needs
no rename), `match.freeze(on)`, `match.mode`, `match.snapshot()`, `match.setMode(id)`,
`match.drainRadio() → []`, `match.drainSetPieces() → []`.

### 3.2 `sim.state.match` — plain JSON-safe data only

```js
sim.state.match = {
  modeId: 'tdm' | 'ctf' | 'ffa',
  phase:  'warmup' | 'live' | 'overtime' | 'ended',
  clock, elapsed, timeLeft,
  teams:  [ {id, name, tint, score, captures, actors:[…]}, … ],   // 2, or 10 in FFA
  actors: [ /* 10 roster slots, §3.3 */ ],
  flags:  [ /* CTF only; [] elsewhere */ ],
  result: null,          // {result:'win'|'draw'|'forfeit', winnerTeam, reason}
  spawnStress: 0,
  mode: { /* mode-owned public sub-state */ }
};
```

### 3.3 The actor roster — identity survives death

**A `botId` is a body; an `actorId` is a player.** Bots die, the corpse is spliced out of
`state.bots`, the view reaps it by itself (V5 — zero `soldiers.js` edits), and a **new** `botId`
is spawned for the same `actorId`.

```js
{ actorId, name, kind:'human'|'bot', team, archetype, band,
  who:'P'|<botId>, alive,
  score, kills, deaths, assists, streak, bestStreak, captures, returns,
  respawnAtT, protectedUntilT, spawnPointId,
  duty: null }        // ← the MODE's channel (C9). bot._obj is the AI's, and is separate.
```

The human is always `actorId 0`, `who 'P'`, `team 0` (AMBER). In FFA `team === actorId`, so the
human is still team 0 — the same rule, no special case.

### 3.4 Teams, `areEnemies`, friendly fire

```js
// core/match/roster.js — the ONLY place this rule exists.
export function areEnemies(a, b) { return a != null && b != null && a !== b && a.team !== b.team; }
```

**A second inline team comparison anywhere in the codebase is a defect** — it is how the AI and
the damage system drift apart. `bot.team` and `sim.state.player.team` are mirrored ints for the
hot loops, written in exactly one function (`roster.bindBody`).

**FFA is ten teams of one** (`team === actorId`). There is no `if (ffa)` branch in `damage.js`,
`perception.js`, `botfsm.js`, `squad.js`, the scoreboard or the killfeed. The **only** genuine
difference is the spawn score function (C8).

**Friendly fire OFF between different actors on the same team; self-damage ON at 100%.** The
gate lives at the **top of `applyDamage`, before the `hurt` emit**:

```js
if (attacker != null && attacker !== who && sim.match && sim.match.sameTeam(attacker, who)) return;
```

Returning before the emit is load-bearing: `perception.js:174-181` turns being hit into instant
awareness 1.0 toward the attacker, so a teammate's stray round would otherwise hand a bot a free
wallhack toward its own ally. **Teammates still block bullets** — `core/sim/ballistics.js` is
not edited at all by this plan, which also removes an aim-wave collision.

### 3.5 The mode-module interface

One file per mode under `core/match/modes/`. **THREE-free, allocation-free after `start`,
deterministic, drawing only from `m.rng.match`.** Only `id`, `teamCount`, `defaults`, `start`,
`tick` and `checkWin` are required; `match.js` null-checks every other member.

```js
mode.id, mode.displayName, mode.teamCount (2 | 'perActor'), mode.defaults
mode.start(m) / tick(m, dt) / end(m, outcome)
mode.onSpawn(m, ev) / onKill(m, ev) / onDeath(m, ev) / onObjectiveEvent(m, ev)
mode.scoreForKill(m, ev) → [{actor, points, reason}, …]
mode.checkWin(m) → null | {result, winnerTeam, reason}
mode.assignDuties(m)              // 2 Hz — writes actor.duty (C9)
mode.spawnVeto(m, actor, point) → bool        // V7
mode.spawnBias(m, actor, point) → 0..1
mode.hudModel(m) → {headline, clockS, us, them, objectives:[…], markers:[…]}
```

**Rules that make parallel mode work safe.** A mode module may not import a sibling mode,
`sim.js`, `botfsm.js`, `hud.js`, or anything under `core/view|render|fx|chars`. It may not write
`sim.state` except through the `m.*` facade and its own `m.state.mode`. It may not read
wall-clock time. It owns exactly two files and does **not** edit `content.json`. Modes never
write scores directly — they call `m.addScore` / `m.addTeamScore`, which queue deltas that the
match commits in one auditable place.

### 3.6 Match tick order (FROZEN — probes reason about this)

```
1. clock advance; phase transitions (warmup→live→overtime→ended)
2. spawn-protection expiry + cancellation (fire / ADS / grenade / flag touch)
3. respawn director: drain the respawn queue
4. mode.tick(m, dt)                      ← objective entities (flags, COLLAPSE) live here
5. duty assignment: mode.assignDuties(m) at 2 Hz, phase-offset by actorId
6. scoring commit (queued deltas → totals, `match:score` events)
7. mode.checkWin(m) → if non-null, endMatch()
8. influence / danger grid rebuild at 5 Hz
9. sim.state.objectives refresh from mode.hudModel(m).objectives
```

Nothing in 1–9 allocates per tick after `start()`.

### 3.7 The bot intent struct and the monotonic fairness rule

```js
bot._obj = { role, reason /* CLOSED enum */, assignedT, holdUntil,
             anchor, anchorKind, route:{laneId, wpIndex, dir},
             priority /*0..1*/, firePolicy:'free'|'defensive'|'hold', selfDefenseM,
             posture:'press'|'balanced'|'control', breakFight,
             noRetreat, noFlank, noGrenade };
```

> **THE BINDING CONSTRAINT: the objective layer may move a bot's feet and may withhold its
> fire. It may never grant information, speed, accuracy, reaction, health, or ammunition.**

Every knob is one-directional. The audited fairness surface therefore remains an **upper
bound**, and that is asserted mechanically, not argued (Part 5, AC-14).

### 3.8 The information tiers

| Tier | Contents | Access |
|---|---|---|
| **P — perception** | sight through the awareness meter with the night light factor; hearing; muzzle flash | per-bot, earned, unchanged |
| **R — the radio** (team modes only; **absent in FFA**) | teammate pos/hp/alive/role/carrying (exact); enemy contacts as a **≤6-entry, 8 s** `{pos,t}` ring; contact bearings **quantised to 45° sectors**; objective calls | per `commsGroup` |
| **W — the rules broadcast** | **defined as exactly what the HUD publishes to the human**, through one shared `PUBLIC_FACTS` constant consumed by both the HUD and `objective.js` | everyone, identically |

**Hard rule: a Tier-R fact may set a goal. It may never set an aim point.** The trigger path
(`botfsm.js:812-834`) is untouched — bots still fire only at `visibleFresh` targets, and
SUPPRESS still fires at a last-known with a lateral offset.

The **carrier beacon** is the one piece of enemy-position information a bot receives without
perceiving it: a `{pos, t}` sample refreshed every **3.0 s**, quantised to **±6 m**. It is
granted only because the human receives the identical sample at the identical rate with the
identical error. A carrier who cuts into the north corridor genuinely disappears for up to three
seconds — for bots and human alike.

**The ban list**, and no code path below reads any of it: enemy hp, enemy weapon or ammo, enemy
aim direction, enemy exact position without perception or a beacon, enemy respawn timers,
another bot's `_obj`.

### 3.9 The lane graph

`core/level/lanes/lanternwalk.js` exports `{junctions, lanes, approaches}`. Each lane carries
`{id, a, b, wp[], band, exposure, cover, vertical, botTraversable, throughGoing}`.
Five gate-checkable properties: every waypoint passes `nav.onNav`; every lane's endpoints are
junctions; consecutive waypoints are ≤12 m apart and mutually `nav.reachable`; the graph
contains at least one cycle; every lane's `botTraversable`/`throughGoing` pair is honest against
V8 (no mantle, no jump). **The arcade balcony lane is `throughGoing:false`.**

**Why the lane graph exists at all:** `nav.findPath` string-pulls (`nav.js:426-473`), so a raw
path to a distant goal is by construction the shortest and most exposed line. **Route choice
cannot live in the pathfinder.**

### 3.10 Event vocabulary — freeze amendments required

Append verbatim to `_design/architecture.md`'s changelog:

```
- v3.0 2026-08-20 (PVP conversion; see _design/pvp/PVP_BUILD_PLAN.md):
  a. core/sim/mission.js MOVES to _design/attic/mission.js. core/match/match.js
     exports makeMatch(content, emit, opts) returning the SAME frozen triple
     {start, tick, forfeit}. sim.match === sim.mission (one object, two names)
     so boot.js, damage.js and sim.step's tick slot 6 are unchanged.
     drainRadio()/drainSetPieces() survive returning [].
  b. NEW event `flag` — {flagId, team, state:'taken'|'dropped'|'returned'|
     'captured'|'reset'|'revealed'|'captureBlocked', by, byWho, carrier,
     pos:[3], reason}. Consumers: core/match/flagview.js, core/hud/match_hud.js.
  c. NEW events `match:start` {matchId, mode, difficulty, teams, seed, epoch},
     `match:state` {phase, prev}, `match:score` {team, actorId, points, reason},
     `respawn` {who, actorId, team, pointId, pos:[3], yaw, protectedUntilT},
     `objrole` {botId, role, reason, t}, `pressure` {on}, `collapse`
     {armed, radius}, `leaderMark` {actorId, on}.
     The match ALSO emits the frozen mission:start / mission:end / objective so
     every existing consumer (fx pool clear, soldiers clear, hud debrief +
     objective tracker, audio stinger, boot's menu return) is unchanged.
  d. ADDITIVE fields, no new types: `death` and `hurt` gain {victimActor,
     attackerActor, victimTeam, attackerTeam}; `mission:end` gains
     {match:{modeId, result, winnerTeam, teams, actors}}.
  e. sim.state gains `match`; every actor body gains `team:int`.
     sim.state.phase KEEPS its frozen enum, driven from the match phase.
  f. core/rng.js makeStreams() gains `match`, `spawn` and `obj` (same
     mulberry32 construction). `mission` is retained and goes unused.
  g. __test gains startMatch(opts)/matchState()/setMode(id)/endMatch().
     startMission(opts) is RETAINED and its NO-ARG DEFAULT becomes
     {mode:'tdm', bots:0} — see PVP_BUILD_PLAN Part 6 O1.
  h. content.json version 2 — mission{} moves to the attic and is replaced by
     arena/teams/botRoster/clusters/spawnPoints/flags/modes. Scenario IDs
     S1-S9/C1/menu/bench are UNCHANGED (R10 stands).
  i. R24 node key set becomes per-map. The lanternwalk set is the 17 keys in
     PVP_BUILD_PLAN Part 4 W4.
  j. NARROW amendment to pvp_design §7.2: the Veteran band is available only
     inside the HARD preset, capped at 1, labelled on the mode-select card,
     OFF by default. Owner decision, Part 8 item 2.
  k. Six new bark kinds: flagtaken, carrier, escortme, intercept, returning,
     capped. Each fires ONLY on the true event it names (combat_spec §5.10).
```

---

## PART 4 — THE WORKSTREAM MATRIX

**Ten lanes. Five waves. No file is owned twice.** Every lane codes against Part 3, so waves
overlap in time — a wave does not wait for the previous one to *finish*, only to *land its
interface*, and the interface is in this document rather than in a lane's head.

### 4.1 Ownership table

| Lane | Wave | Files owned (EXCLUSIVE) | Implements | Frozen interface it publishes | Self-verification |
|---|---|---|---|---|---|
| **W1 · MATCH CORE & SIM SEAM** | 1 | `core/match/match.js`, `core/match/roster.js`, `core/match/contract.js`, `core/match/match.selftest.cjs`, `core/sim/sim.js`, `core/sim/damage.js`, `core/sim/sim.selftest.cjs`, `core/rng.js`, `runtime/boot.js`, `core/pvp/pvp_tuning.js` · **MOVES** `core/sim/mission.js` → `_design/attic/` | arch 1.1–1.6, 2.1–2.3, 6.1–6.3, 10; modes 1.4–1.5, 5.2.1; this plan C1–C2, C14, C16, C19–C20 (call site), C25–C27, C29a–C29b | Part 3.1–3.6 in full; `areEnemies`; the mode-module interface; the `m` facade; `bakeNav(colliders,{cell:0.75})`; 3-step accumulator clamp; `rng.{match,spawn,obj}`; `createSim({tuning})` with an identity delta set | `node core/match/match.selftest.cjs --contract && node core/match/match.selftest.cjs --seeds 20` |
| **W2 · SPAWN DIRECTOR** | 1 | `core/match/spawns.js`, `core/match/influence.js`, `core/match/spawns.selftest.cjs` | arena 2.4–2.5; modes 4.3–4.4; arch 4.2–4.6; this plan C7, C8 | `makeSpawns(arena, opts) → {pick(m, actor) → {pointId, pos, yaw, stress}}`; `makeInfluence(bounds,{perActor}) → {deposit, decay, at, spread}`; `SCORE_WEIGHTS.{team,ffa}` as one table | `node core/match/spawns.selftest.cjs` |
| **W3 · TEAM AI (highest risk)** | 1 | `core/ai/perception.js`, `core/ai/botfsm.js`, `core/ai/squad.js`, `core/ai/nav.js`, `core/ai/ai.selftest.cjs` | arch 5.2–5.3; bot_ai 4.1/4.2/4.4 + **Part 12 items 1, 2, 6**; modes 5.2, 5.6; arena 5.3; this plan C10, C10b, C20, C21, C28 | `perceive()` signature frozen; `bot.percept` shape incl. the `seesPlayer` alias and `byTarget`; `squad.requestToken(botId, targetWho)`; `bot.team`; the **four** `bot._obj` read sites H1–H4; `MAX_LOS_PER_TICK = 12`; **the patrol floor** (below) | `node core/ai/ai.selftest.cjs --teams` |
| **W4 · ARENA, CONTENT & LANES** | 1 | `core/level/maps/meridian_ward.js`, `core/level/maps/lanternwalk.js`, `core/level/layout.js`, `core/level/colliders.js`, `core/level/props.js`, `core/level/lanes/lanternwalk.js`, `tools/probe_arena.mjs`, `content.json`, `_design/attic/content_campaign.json` | arena Part 1 (E1–E19 **minus** the `lighting.js` half), 2.1–2.3, 3, 5.1–5.2, 6.1; bot_ai 5.1–5.3; modes Part 8; this plan C3–C7b, C16–C19, C23–C24 | `buildLayout(seed)` **signature unchanged**, defaulting to lanternwalk; frozen `colliders` shape; the 17-key arena `NODES` set; the lane-graph export shape; `content.json` v2 | `node tools/probe_arena.mjs` (gates G-A…G-K) **and** `node core/match/match.selftest.cjs --contract` |
| **W5 · MODE: TDM** | 2 | `core/match/modes/tdm.js`, `core/match/modes/tdm.selftest.cjs` | modes Part 2, 2.5; arch 1.7, 5.4; bot_ai Part 6; this plan C12–C13, C15 | `mode.id === 'tdm'`, `displayName 'SKIRMISH'`, `teamCount 2`, `defaults {scoreLimit:50, timeLimitS:480, respawnS:4.0, protectS:1.5}` | `node core/match/modes/tdm.selftest.cjs` |
| **W6 · MATCH SHELL & HUD** | 2 | `core/hud/match_hud.js`, `core/hud/scoreboard.js`, `core/hud/mode_select.js`, `core/hud/menu.js`, `core/match/flagview.js` | modes Part 6, Part 7; arch 2.6, 3.3, 6.4; this plan C22, C29f | `attach(bridge, ctx)` per file; `PUBLIC_FACTS` (shared with `objective.js`, Part 3.8); **zero edits to `core/hud/hud.js`** | `python _harness/bootcheck.py` → `RESULT OK`, then one live match to the end screen |
| **W7 · OBJECTIVE AI (the commander)** | 3 | `core/ai/objective.js`, `core/ai/comms.js`, `core/ai/roles/tdm.js`, `core/ai/roles/ctf.js`, `core/ai/roles/ffa.js`, `core/ai/objective.selftest.cjs` | bot_ai Parts 2–9 in full; modes 5.3–5.5; arch 5.1, 5.4; this plan C9, C10, C21 | `bot._obj` (Part 3.7); the monotonic rule; `commsGroup`; the closed `reason` enum; `OBJ_PERF ≤ 0.25 ms/tick` | `node core/ai/objective.selftest.cjs` |
| **W8 · MODE: CTF** | 3 | `core/match/modes/ctf.js`, `core/match/flags.js`, `core/match/modes/ctf.selftest.cjs` | modes Part 3 in full; arch Part 3; bot_ai Part 7; this plan C4, C7b, C12–C13, C15 | `mode.id === 'ctf'`, `defaults {captureLimit:3, timeLimitS:720, respawnS:5.0, respawnPressureS:8.0, …}`; the flag state machine and its every-tick invariant | `node core/match/modes/ctf.selftest.cjs` |
| **W9 · MODE: FFA** | 3 | `core/match/modes/ffa.js`, `core/match/modes/ffa.selftest.cjs` | modes Part 4; arch 1.7, 4.6, 5.4; bot_ai Part 8; this plan C8, C12–C13, C15 | `mode.id === 'ffa'`, `teamCount 'perActor'`, `defaults {scoreLimit:25, timeLimitS:480, respawnS:3.0, protectS:2.0, leaderMark:{atScore:15, orLeadBy:5}}` | `node core/match/modes/ffa.selftest.cjs` |
| **W10 · HARNESS** | 4 | `core/test/scenarios.js`, `core/test/autoplay.js`, `core/test/testsurface.js`, `_harness/matchprobe.py`, `_harness/playprobe.py`, `_harness/perfprobe.py` | arch Part 7; modes 10.2–10.4; bot_ai Part 11; this plan Part 5, Part 6 O1 | `__test.startMatch/matchState/setMode/endMatch`; **`startMission({}) → {mode:'tdm', bots:0}`**; the `matchprobe` assertion set | `python _harness/matchprobe.py --mode all --seeds 20` **and** `python _harness/shotbattery.py --only S1,S4,S6` |
| **W11 · DEFERRED (aim-wave-gated)** | 5 | `core/hud/hud.js` (3-line debrief copy), `core/render/lighting.js`, `core/chars/soldiers.js` (rim tint), `core/weapons/weapon_data.js` — plus the `pvp_tuning.js` **data** flip | modes 1.6; arena E19 lighting half; arch Part 11; this plan C18, C25, C29e–C29f | the PVP delta set becomes non-identity; the PVP lighting profile; the faction rim uniform | `python _harness/perfprobe.py perf-match` **and** the full 11-shot battery |

> Eleven rows, ten build lanes: **W11 is the deferred lane** and is gated on an external wave,
> not on this plan. Lanes W8 and W9 may be run by two agents in parallel — they import nothing
> from each other.

**Files nobody in this plan touches, listed so the point is unmissable:**
`core/sim/ballistics.js`, `core/sim/player.js`, `core/sim/world.js`, `core/sim/grenades.js`,
`core/input.js`, `core/weapons/*` (until W11), `core/level/level.js`, `core/level/materials.js`,
`core/level/vehicles.js`, `core/fx/*`, `core/render/*` (until W11), `core/audio/*`,
`core/chars/*` (until W11), `core/view/bridge.js`, `core/events.js`, `core/gfx.js`,
`core/perf.js`, `core/settings.js`, `core/hud/hud.js` (until W11), `core/hud/pause.js`,
`core/hud/settings_ui.js`.

### 4.2 Three lane requirements that are easy to miss and expensive to omit

**W3 · THE PATROL FLOOR — not optional.** The campaign's authored patrol routes die with the
mission content, and W7's commander does not exist until wave 3. Without an anchor, an idle bot
in wave 2 stands still — the classic "bots stand in a doorway" failure, in the *first playable
build*. W3 therefore ships a **minimal anchor at hook H4**: with no `_obj`, `brain.anchor` =
the nearest cluster anchor, or the highest-influence cell if one is available. ~15 lines, and it
is the difference between first-playable working and not.

**W7 · CODE AGAINST A LANE STUB.** W7 needs `core/level/lanes/lanternwalk.js`, which W4 owns and
which cannot be authored before the carve exists. W4 therefore ships **`core/level/lanes/_stub.js`
in wave 1** — a four-junction ring against the un-carved plaza — so W7 can build and test against
the real schema from day one. `objective.js` imports by `arena.id` with `_stub` as the fallback.

**W4 · THE SPAWN DATA IS PROBE-EMITTED, NOT HAND-COPIED.** `tools/probe_arena.mjs --emit` writes
the `arena.spawnPoints`, `arena.clusters` and `arena.flags` blocks straight into `content.json`
from measured geometry. Hand-transcribing fifty points with per-point clearance and view figures
is how C7b happened once already.

### 4.3 Wave order and gates

```
WAVE 1 — FOUNDATION (4 lanes, fully parallel; all code against Part 3)
  W1 MATCH CORE ──┐
  W2 SPAWNS      ──┤  no lane blocks another — they depend on the CONTRACT,
  W3 TEAM AI     ──┤  not on each other's code landing
  W4 ARENA+DATA  ──┘
     GATE:  node core/match/match.selftest.cjs --contract   → exit 0
            node core/match/spawns.selftest.cjs             → exit 0
            node core/ai/ai.selftest.cjs --teams            → exit 0
            node tools/probe_arena.mjs                      → exit 0
            python _harness/bootcheck.py                    → RESULT OK
        ▼
WAVE 2 — FIRST PLAYABLE (2 lanes)
  W5 MODE: TDM ── W6 MATCH SHELL
     GATE:  node core/match/modes/tdm.selftest.cjs          → exit 0
            ★ THE OWNER PLAYS ONE FULL SKIRMISH MATCH ★
        ▼
WAVE 3 — COMPREHENSION + THE OTHER TWO MODES (3 lanes; W8 ∥ W9)
  W7 OBJECTIVE AI ── W8 MODE: CTF ── W9 MODE: FFA
     GATE:  node core/ai/objective.selftest.cjs             → exit 0
            node core/match/modes/{ctf,ffa}.selftest.cjs    → exit 0
            Gate 0: bot-only CTF caps in ≥8/20 seeds        (playable bar)
        ▼
WAVE 4 — PROOF (1 lane)
  W10 HARNESS
     GATE:  python _harness/matchprobe.py --mode all --seeds 20  → exit 0
            (the full Part 5 acceptance battery, incl. the ≥17/20 SHIP bar)
        ▼
WAVE 5 — BALANCE & POLISH (gated on the aim wave being verified green)
  W11 DEFERRED
     GATE:  python _harness/perfprobe.py perf-match          → 30 fps budgets
            full 11-shot battery at the visual bar
```

**Why W3 is wave 1 and not later.** It is the highest-risk change in the plan — it touches the
audited fairness surface — and it is the only lane whose failure invalidates everything
downstream. It gets the longest runway and its selftest is the first gate anyone runs.

**Why W7 is wave 3 and not wave 2.** bot_ai's own build order puts the commander before CTF, and
first-playable does not need it: arena.md **measured** that with ten actors on 2593 m² the median
walk to the nearest actor is 1.5 s and 75.3% of positions already have an actor in line of sight.
"Wandered for two minutes and found nothing" is structurally impossible on this arena even before
the commander exists. What wave 2 lacks is bots *spreading across lanes by quota* — which is a
quality gap, not a playability gap, and it is honest to say so.

---

## PART 5 — ACCEPTANCE CRITERIA

"The PVP game works" means every criterion below is **measured and recorded**, not asserted.
Each names its instrument. Where a bar differs between the playable gate and the ship gate, both
are given.

### 5.1 Termination — no mode may hang

| # | Criterion | Instrument |
|---|---|---|
| **AC-1** | **Every match reaches `phase === 'ended'`**, by score limit or clock, within `timeLimitS + 180 + 15 s`, across 20 seeds × 3 modes | `matchprobe.py --mode all --seeds 20` |
| **AC-2** | **The watchdog never fires.** It exists so that a bug produces a finished match and a loud log line instead of a hung game; a single firing is a FAIL and a bug report, not a tuning note | same |
| **AC-3** | `result` is exactly one of win / draw / forfeit, and `winnerTeam` is consistent with the final scores, every seed | same |
| **AC-4** | `stuckBotSeconds === 0` — no bot with <0.5 m displacement over 20 s while alive and not in cover | same |
| **AC-5** | CTF: `flagStuckResets === 0`; no flag spends >45 s `DROPPED`; every flag ends `AT_STAND` or `CARRIED`; the three-state invariant holds **every tick** | `ctf.selftest.cjs` + `matchprobe` |
| **AC-6** | CTF: the stalemate forced reset fires **≤1 per match**; `flag:captureBlocked` fires **at least once across the battery** (proving the rule is reachable and the teaching line works) | same |
| **AC-7** | **Determinism:** two runs of the same `(mode, seed)` produce identical `match.snapshot()` hashes | `match.selftest.cjs --seeds 20` |
| **AC-8** | Zero out-of-bounds deaths across the whole battery — the OOB timer is a backstop that must never fire, because the carve bounds the arena (C18) | `matchprobe.py` |

### 5.2 Spawning

| # | Criterion | Instrument |
|---|---|---|
| **AC-9** | **Zero deaths within 2.0 s of spawning**, all modes, all seeds. *This is the spawn director's actual pass/fail.* | `matchprobe.py`, `spawns.selftest.cjs` |
| **AC-10** | Median `spawnStress` per match **≤ 0.5**. A higher value means the relaxation ladder, not the scorer, is choosing spawns — which is an under-built arena, not a tuning problem | same |
| **AC-11** | No spawn point reused within 12 s unless the ladder forced it, and every relaxation step incremented `spawnStress` | `spawns.selftest.cjs` (2000 selections × 20 seeds × 3 modes) |
| **AC-12** | The FFA battery passes as a **first-class case**, not an afterthought: `ffaSafety` counts all nine others, `spread()` is unsigned, V10 fires | same |

### 5.3 The bots demonstrably play the objective

These are the owner's requirement made measurable. **Every one names a specific observable
behaviour with a numeric bar.**

| # | Behaviour | PASS condition | Instrument |
|---|---|---|---|
| **AC-13** | **A CTF bot picks up a flag and routes it home, unprompted.** One bot, enemy flag, no enemies on the map | `flag:taken` within 6 s; nav-distance to its own stand **strictly decreases over every rolling 10 s window** (2 m tolerance); `flag:captured` before 90 s; the path never enters a `throughGoing:false` lane | `T-CTF-1`, `objective.selftest.cjs` |
| **AC-14** | **Bots capture with the human standing still.** Bot-only CTF, scripted **Idle** persona in the human slot | **≥8/20 seeds** produce ≥1 capture = *CTF playable*. **≥17/20 seeds, no seed 0–0, median time-to-first-capture ≤150 s** = *SHIP*. If bots never capture without help, they do not understand CTF whatever the code says | `matchprobe.py --mode ctf --seeds 20` |
| **AC-15** | **A defender breaks off a duel to intercept a carrier.** Defender in a live duel at 20 m; fire `flagTaken` with a beacon | Within (think interval + 0.4 s) its role is `intercept`, `breakFight` fired, fire tokens released, and it has **physically moved ≥10 m toward a cutoff node within 4 s** | `T-CTF-2` |
| **AC-16** | **…and does NOT do so suicidally.** *(the paired negative — this is what keeps "objective-driven" from meaning "walks into bullets")* Identical scene, opponent at 6 m dealing damage | The bot **does not turn its back within 1.0 s** of taking damage from a perceived target | `T-CTF-2b` |
| **AC-17** | **Interceptors cut off, they do not tail-chase.** Carrier walking a known lane; interceptor placed where a tail-chase cannot close but a cutoff can | The chosen goal is **ahead** of the carrier along the lane (`dot(goal − beacon, laneDir) > 0`) and the bot reaches that waypoint before the carrier in **≥15/20 seeds** | `T-CTF-6` |
| **AC-18** | **…and abandons a hopeless one.** Carrier 8 m from its stand; bot 60 m away | **No intercept goal is set**; the bot re-roles within 2.0 s (asserted on the `objrole` event) | `T-CTF-7` |
| **AC-19** | **A bot returns its own dropped flag, by nav distance not line of sight.** Flag dropped at a known point; three defenders at 15 / 30 / 60 m nav, with a wall between the *euclidean*-nearest and the flag | Exactly ≤2 assigned `return`; the **nav-nearest** is one of them; `flag:returned` within 1.5× the walk ETA | `T-CTF-4` |
| **AC-20** | **The carrier knows it cannot score while its own flag is out.** Force BOTH_CARRY | The carrier holds **10–18 m** from its own stand for ≥15 s and **never enters the stand radius**; on a scripted `flagReturned` it enters and captures within (distance/4.6 + 2 s). *A bot that runs a flag into a dead stand is the clearest possible signal the AI does not know the rules* | `T-CTF-5` |
| **AC-21** | **Bots escort the HUMAN carrier.** Script the human picking up the enemy flag | Within 1.0 s the team situation is S1 and **exactly 2 bots hold `escort`** with stations solved against the *human's* route; **no bot is assigned `attack`** | `T-CTF-9` |
| **AC-22** | **Escorts do not clump.** Carrier + 3 escorts, 30 s, sampled at 4 Hz | Minimum pairwise escort distance ≥6 m on ≥95% of samples; never two escorts within **5.5 m** (the frag radius) for >0.5 s; none inside the carrier's 6 m bubble; **a scripted frag at the escort centroid kills ≤1 escort** | `T-CTF-3` |
| **AC-23** | **TDM: no funnel.** Lane occupancy sampled every 1.0 s over 20 seeds | **No team has ≥4 of 5 on one lane for >10 consecutive s**; no lane sits unoccupied by *both* teams for >40% of the match | `T-TDM-1` |
| **AC-24** | **TDM: the trade, capped.** Kill one bot with a scripted damage call from a known position | **≤2** living teammates within 35 m nav retask to that position within 2.0 s (assert the cap in **both** directions); ≥1 arrives within 8 s where a path exists | `T-TDM-2` |
| **AC-25** | **TDM: posture responds to the score.** Same seed, three runs, score forced at 75% clock to behind-8 / level / ahead-8 | **Sign assertions only** — preferred band shrinks when behind and grows when ahead; flanks/min rises when behind, falls when ahead; mean distance from own spawn cluster rises when behind, falls when ahead. *(Sign assertions survive tuning; magnitude assertions do not.)* | `T-TDM-3` |
| **AC-26** | **FFA: the bots are playing, not milling.** 20 seeds | **Hardened bots' mean final placing is better than regulars', which is better than recruits'.** Band ordering must survive in the scoreboard | `matchprobe.py --mode ffa` |
| **AC-27** | **FFA: ≥6 of the 10 actors record ≥1 kill** (catches "one bot farms, nine wander") | as stated | same |
| **AC-28** | **FFA: no dogpile on the human.** 9 bots + a **passive stationary dummy** in the human slot (so the metric measures the AI, not the tester) | p95 of simultaneous bots targeting the dummy **≤3**, mean **≤2.0**; the dummy's share of total damage dealt **≤1.5×** the median bot's | `T-FFA-2` |
| **AC-29** | **FFA: leader-hunting is symmetric.** Two mirrored runs, identical seeds, the lead given first to the human slot then to a bot | Mean bots targeting the leader in the final 25% of the clock differs by **≤15%** between runs. *"The bots gang up on the player" must be false as a mechanism, not merely absent on the seeds we ran* | `T-FFA-4` |
| **AC-30** | **Bots do not beeline.** 20 bot-only matches | Median (path travelled)/(straight-line distance) from assignment to arrival **≥1.15**, p95 **≤2.2** | `T-MAP-1` |
| **AC-31** | **Side balance.** 20 seeds with sides swapped | TDM `\|mean margin\|` **< 8 kills**; CTF `\|mean margin\|` **< 1.0 captures**. Neither spawn cluster set is the winning one | `matchprobe.py` |

### 5.4 The bots are not cheating

| # | Criterion | PASS condition | Instrument |
|---|---|---|---|
| **AC-32** | **THE MONOTONICITY ASSERTION — the decisive one.** Same seed, run twice: once with the objective layer live, once with `firePolicy` forced `'free'` and `priority` forced 0 | Every bot's `reactionLog` (`botfsm.js:234`) and every entry of `AI_PROBE.jitter` (`botfsm.js:966`) are **BIT-IDENTICAL** between runs, **and** the layered run's shot count is **≤** the unlayered run's. *If either fails, the layer has become a cheat and the build does not ship.* | `objective.selftest.cjs` |
| **AC-33** | **The honesty probe.** A scripted human who never fires and never enters any bot's view cone | **Zero bots ever set a goal within 10 m of the human's true position** | `ai.selftest.cjs --teams` |
| **AC-34** | **No through-wall reads.** `objective.js`, `comms.js` and `roles/*.js` grepped at test time for `state.player.pos`, `.hp`, `.yaw`, `.weapon`, and any enemy actor field outside `{id, team, alive}` | Non-zero matches **fail the build**. Crude, and exactly the kind of crude that catches the real regression six months from now | `objective.selftest.cjs` |
| **AC-35** | **Tier W == the HUD.** The HUD's published-fact list and the bots' Tier-W list are **one shared `PUBLIC_FACTS` constant** consumed by both | A fact the bots use that the human cannot see is impossible to write, not merely discouraged. Beacon fidelity asserted: no bot ever reads a carrier sample newer than 3.0 s or more precise than 6 m | W6 + W7 selftests |
| **AC-36** | **The existing fairness surface is unchanged.** Re-run `ai.selftest.cjs`'s 30-seed battery with the layer live, in all three modes | Zero shots before the rolled reaction; one reaction roll per confirm episode; a target switch **never** re-rolls a latched reaction; hysteresis holds (no bot switches target more than once per 2 s); ≤2 fire tokens per human target; ≤3 damaging attackers on a human per 250 ms; zero muzzle-blocked pulls; bursts count blows; ≤4 brains/tick; **and the existing single-target battery passes unchanged** | `ai.selftest.cjs --teams` |
| **AC-37** | **Zero friendly-fire damage events in team modes; self-damage still lands at 100%** | as stated | `matchprobe.py`, `sim.selftest.cjs` |
| **AC-38** | **No HP or damage inflation.** All ten actors share one HP value; band affects only reaction, jitter, forced-miss, burst pause and headshot intent | as stated | `sim.selftest.cjs --pvp` |

### 5.5 The human finds combat — with an upper bound as well as a lower one

**No design doc measured the spawn-conditioned case.** arena.md measured P(actor in line of
sight) = 75.3% and median nearest actor 9.8 m at **uniformly random walkable positions** — but a
*spawn point* is not a random position: the vetoes deliberately push it away from enemies (V1
12 m, V2 25 m LOS). The spawn-conditioned number is therefore **necessarily worse than 75.3%**
and must be measured, not inherited.

| # | Criterion | PASS condition |
|---|---|---|
| **AC-39** | **Time from spawn until an enemy is in the human's line of sight**, measured over ≥200 spawns per mode with the `objective` autoplay persona walking its duty goal | **median ≤ 3.0 s, p90 ≤ 8.0 s, worst ≤ 15.0 s** |
| **AC-40** | **The upper bound**, so "found combat fast" does not become "spawn-killed" | **AC-9** — zero deaths within 2.0 s of spawning. AC-39 and AC-9 together bracket the target: contact fast, but never instantly |
| **AC-41** | **Median regulation match length** | TDM **6:00–10:00**, CTF **6:00–12:00**, FFA **6:00–10:00**. Outside the window, the score/time **numbers change** (one line in `content.modes`), not the design (C12) |
| **AC-42** | **Passivity never wins.** The **Idle** persona, every mode, every seed | The match still ends; Idle never wins, never draws, and **never finishes above last place in FFA**. If standing still places mid-table, the bots are not playing |

### 5.6 30 fps with 10 actors — verified against 30, not 60

Measured in the **new worst case**: 10 actors alive, ≥6 shooting, plaza centre, rain on, grenades
in flight. This is a genuinely heavier steady state than anything the v1 perf budget was measured
against — the campaign's was 2–8 bots in waves; this is 9 bots alive continuously for 8 minutes.

| # | Criterion | Bar |
|---|---|---|
| **AC-43** | Frame time | **p50 ≤ 33.3 ms** (30 fps), **p99 ≤ 40 ms** (no frame worse than 25 fps) |
| **AC-44** | Sim CPU | **≤ 3.0 ms per tick**, i.e. ≤6.0 ms per rendered frame at 2 steps/frame |
| **AC-45** | AI share | **≤ 1.5 ms per tick** at 9 bots **with per-target perception** — the number most likely to break |
| **AC-46** | Objective layer | **≤ 0.25 ms per tick** amortised (`OBJ_PERF`) |
| **AC-47** | LOS budget | `MAX_LOS_PER_TICK ≤ 12` never exceeded across a 3000-tick 5v5 |
| **AC-48** | `simStepsDropped === 0` over a full match on the reference rig, with the **3-step** accumulator clamp (C27) | as stated |
| **AC-49** | Draw calls ≤ 320 median; **`programs delta === 0`** during the first firefight | a second material for the team tint is a shader permutation and is FAIL-class |

**If AC-45 fails, the fix is the LOS budget (scalar prefilter → round-robin 2 candidates/bot/tick
→ 1/bot/tick), not the actor count.** The owner specified ten.

### 5.7 The one a machine cannot run

Doctrine §5: *done = observed effect*, and *"play the game to find what audits can't."*

**AC-50.** Before ship: **one human plays one full match of each mode in a real browser on the
deployed URL**, confirms the version marker and one new-code fingerprint, and confirms by
observation that (a) every match ended with a banner, (b) a CTF capture happened, (c) the FFA
leader marker armed and was visible, (d) the killfeed named bots as bots with their difficulty
band on the scoreboard. **A probe-green build that has never finished a live CTF match is not
done.**

**AC-51.** That CTF session's transcript must contain **all four** of: a bot grabbing the enemy
flag unprompted; a bot intercepting and killing a carrier; a bot returning a dropped flag; a bot
escorting the **human** carrier. *If the batteries pass and this session does not produce those
four events, the batteries are measuring the wrong thing.*

---

## PART 6 — SEQUENCING WITH THE CONCURRENT PLAYFEEL WAVE

A separate wave is concurrently fixing aim accuracy, ADS occlusion, hip viewmodel/hands, a ground
glitch and mouse feel, touching `core/sim/ballistics.js`, `core/weapons/*`, `core/input.js`,
`core/hud/hud.js`, `core/level/level.js` and `core/fx/*`.

**Assume it lands FIRST, and build on top of it.** That is the correct order for a reason
stronger than file collisions: **PVP is where aim quality is most exposed.** Nine bots shooting
back and a scoreboard recording every miss will surface an aim defect immediately — and if the
aim fix lands *after* PVP goes live, the first PVP playtest measures the old aim and the owner
will read it as a PVP problem. A shooter whose aim is wrong cannot be tested for balance.

### 6.1 The overlaps — all of them

architecture.md claimed a *"null file intersection"* for waves 1–3. That is **true of files and
false of behaviour** (X5). Two of the seven overlaps below share no file at all.

| # | Overlap | Severity | Verified | Safe order / mitigation |
|---|---|---|---|---|
| **O1** | **`__test.startMission()` is the aim wave's entry point too.** Eleven harness files call it, six of them the aim wave's: `aimfeel.py:381`, `ads_blend_probe.py:44`, `lanec_{ablate:48, audit:134, gate:180, ground:98, redhunt:106, slot:95}.py`. `aimfeel.py` deliberately uses a **real mission, never `setScenario`**, does **not** enable god mode, and reads `player.alive` while taking timing numbers (V15, V16). The moment `startMission` spawns nine hostile bots, every one of those probes changes underneath the aim wave **with no shared file edited** | **CRITICAL** | V15, V16 | **MANDATORY, lane W1/W10, wave 1: `startMission({})` with no arguments defaults to `{mode:'tdm', bots:0, clock:paused}`** — a live sim, a live player, a real weapon, a real arena, and **zero bots**. That is behaviourally what the aim probes already get, and it never changes under them. **`startMatch({mode, seed})` is the PVP entry** that spawns nine. One default; six probes protected. |
| **O2** | **The carve deletes geometry the aim wave's ground probes sample.** `lanec_ground.py` samples `blvd_cye_seam` (37.0, −36.0) and `street_customs` (−6.0, −37.0), **both outside** the arena (X ≤ 24.5, Z ≥ −34.5). `lanec_ground`'s `arcade_seam` (−32, −20.5) sits ~1 m from the new `arc_part_1`; `lanec_gate`'s `neonwedge` (5, 8) sits beside the new `pk_van` | **CRITICAL** | V17 | **MANDATORY, lane W4, wave 1: the `core/level/maps/{meridian_ward,lanternwalk}.js` split** (C17). `meridian_ward.js` is byte-identical to today's `layout.js` content, so the lane-C probes keep sampling preserved geometry until they are re-pointed. **Re-pointing them is a W11 task, not a W4 one** — the aim wave finishes its investigation on the map it started on. |
| **O3** | `core/hud/hud.js` — the aim wave holds it | Low | — | All PVP UI ships in **new** files with their own `attach(bridge, ctx)`. The match emits the frozen `mission:start` / `mission:end` / `objective` events, so `hud.js`'s existing handlers work as-is. **One known cosmetic defect, logged not hidden:** the debrief will read `MISSION COMPLETE` / `MISSION FAILED` instead of `VICTORY` / `DEFEAT`. Three-line copy change, W11. |
| **O4** | `core/level/level.js` — the aim wave holds it | **None** | arena A7 (`level.js:1089-1132`) | The carve needs **zero `level.js` edits**: `walls` render generically by `kind`, and `kind:"wall"` gets a concrete wall for free. The one new renderable (`case "container":`) goes in `props.js:buildKind()`, which the aim wave does not hold. |
| **O5** | `core/sim/ballistics.js` — the aim wave holds it | **None** | Part 3.4 | The friendly-fire gate lives at the top of `applyDamage` in `damage.js`, **before the `hurt` emit** — deliberately, because `perception.js:174-181` turns being hit into instant awareness 1.0 toward the attacker. Teammates still **block** bullets, which is the behaviour we want anyway. **`ballistics.js` is not edited by this plan at all.** |
| **O6** | `core/weapons/*` and the spread constants | Medium | C25 | **All PART 4 balance deltas are deferred to W11** so they cannot confound the aim wave's own before/after. The seam ships in wave 1 with an identity delta set. **One coordination item for the aim wave's own definition of done: if it changes `effectiveSpread` or the crosshair truth model, `node core/ai/ai.selftest.cjs --teams` must be re-run**, because bot aim reads the same constants. That re-run is cheap and belongs on their checklist, not ours. |
| **O7** | `core/input.js` and `core/fx/*` | **None** | — | Bots write `bot.cmd` directly; the human's cmd path is untouched. The flag's 3D representation is a new file (`core/match/flagview.js`), and it never reparents (C22). |

### 6.2 The recommended order, stated as instructions

1. **The aim wave lands and verifies green first.** It is foundational; nothing below changes it.
2. **Waves 1–4 of this plan run concurrently with it** — but only after O1's `startMission`
   default and O2's map split are in, both of which are wave-1, lane-W1/W4 work. Land those two
   items **first, before any other PVP code**, and tell the aim wave they landed.
3. **Do not start W11 until the aim wave's own verification is green.** W11 touches `hud.js`,
   `lighting.js`, `weapon_data.js` and `soldiers.js` — every one of them either theirs or
   adjacent to theirs.
4. **Re-run `ai.selftest.cjs --teams` after the aim wave lands**, whatever the order turns out to
   be. Bot aim reads the same constants as human aim, and a change to either is a change to the
   fairness surface W3 was audited against.

---

## PART 7 — RISKS, RANKED

| # | Risk | Why it is ranked here | Mitigation |
|---|---|---|---|
| **R1** | **W3's perception generalisation breaks the audited fairness surface.** `perception.js:69` is `const player = S.player;` (V4) — generalising it to a target list is the single largest change in the build, and a mistake produces bots that are subtly better or worse than their band. Nobody notices until the owner says *"they feel like cheats."* | It is the one failure that invalidates every downstream measurement, and it is invisible to inspection | The 0.25/2.0 s target hysteresis ships in the **same commit** as the generalisation, never after; the reaction latch lives **inside** `byTarget[who]` so re-acquiring an old target buys no fresh roll and switching cancels none; the **monotonicity harness (AC-32) is built in wave 1 by W3, before the objective layer exists**, so it is a true baseline; the existing single-target battery must still pass unchanged (AC-36) |
| **R2** | **Per-candidate perception blows the AI budget.** 9 bots × 9 candidates × 60 Hz ≈ 4860 raycasts/s against a 1.5 ms slice — doubled per rendered frame at 30 fps | It is arithmetic, not a hypothetical, and the owner's frame target makes it worse not better | Three mandatory, selftest-asserted mitigations: scalar prefilter before any raycast (`d > detectRange` or `facingFactor === 0` rejects for free); round-robin **2 LOS candidates per bot per tick** with **interval-correct** awareness fill (so the meter is not merely rate-halved); global `MAX_LOS_PER_TICK = 12`. **If it still misses, reduce to 1 candidate/tick before ever reducing the actor count** — the owner specified ten |
| **R3** | **The bots do not understand CTF, and it is discovered in wave 3.** This is the owner's headline requirement and it is the last thing built | Late discovery of the primary requirement is the most expensive failure available | **Gate 0 (AC-14) is written in wave 1 as an empty failing test** and is the first thing W8 makes pass. W8's *first* deliverable is not a mode — it is AC-13: one bot, one flag, no enemies, grabs and routes home. Two bars are named (≥8/20 playable, ≥17/20 ship) so partial progress is visible rather than binary |
| **R4** | **The nav bake severs the north artery.** Default `cell:1.0` with `FOOT_R 0.2` can mark the corridor's 2.0 m pier gaps unwalkable (V11) | Every rotation behaviour dies, and the symptom presents as "the bots won't go north" — which will be debugged in the AI, in the wrong file, for a day | `bakeNav(colliders, {cell:0.75})` at `boot.js:160` (W1) **plus** the G-F loop probe run against the **baked nav**, not the collider set (W4). Both wave 1 |
| **R5** | **Five spawn points sit inside their own CTF flag room** (C7b) — `sp_l1` at 1.58 m, `sp_l3` at 2.55 m, `sp_m7` at 2.00 m, `sp_m8` at 3.54 m, `sp_l2` with direct LOS at 6.02 m | Verified, concrete, and it silently drops two clusters below the ≥6-point contract | W4 disables those five for CTF (`modes:["tdm","ffa"]`), authors **+3** CTF-only points on the Lantern Yard approaches and **+2** in the market-street pocket, and `probe_arena.mjs` gains a **per-mode** cluster-count assertion so the class of defect cannot recur |
| **R6** | **The aim wave's probes break with no shared file edited** (O1, O2) | Two critical cross-wave collisions that architecture.md's file-intersection analysis could not see | The `startMission({}) → 0 bots` default and the preserved `maps/meridian_ward.js`. **Both are wave 1 and both must land before any other PVP code** |
| **R7** | **v1 ships on single-player weapon numbers at 100 HP** (C25). Vesper's 200 ms melt and Pike's 158 ms two-tap exist against the human | It is a real playfeel shortfall the owner will feel in the first session | Against `regular`-band bots (500–700 ms reaction) both are rare. The `pvp_tuning.js` seam ships wave 1 with an identity delta set, so wave 5 is a **data flip, not a refactor**. Told to the owner up front (Part 8 item 3) rather than discovered |
| **R8** | **The score and time limits are arithmetic, not measurement** — and two of the four docs did their arithmetic against an arena that then shrank 13.5% (C3, C12) | Guaranteed to need one adjustment; the risk is treating the adjustment as a design failure | AC-41 measures median regulation length. Outside the window, **the number changes, not the design** — one line each in `content.modes`. Budget for exactly one tuning pass after the first battery |
| **R9** | **Mode rule tables drift from the content data** — `mode.defaults` in code, overrides in `content.modes` | Silent divergence between what the HUD says and what the mode does | The contract gate asserts **both directions**: every `modes` key exists in the `MODES` registry *and* every registry entry has a data block. A mode with no data is as broken as data with no mode |
| **R10** | **Ten lanes across five waves is a substantial build** and wave 1 is ~60% of it | Schedule risk, not technical risk | Wave 1's four lanes are genuinely parallel (they depend on Part 3, not on each other). **First playable is the end of wave 2, not wave 5** (Part 9) |
| **R11** | **The commander's route latching produces bots that look decisive but stale** — a 4 s role latch and a 5 s route latch mean a bot can be walking toward something that stopped mattering | It is the natural failure of the fix for the *opposite* problem (per-tick vibration) | Latches are broken by **preempting events**, not by timers: any Tier-W objective event, our carrier's death, or the bot's own death forces an immediate commander pass, rate-limited to once per 0.5 s per team. AC-15's 0.4 s bar measures exactly this |

---

## PART 8 — DECISIONS THE OWNER MUST MAKE

Each is a real fork; each has my recommendation and its reason. None blocks wave 1.

1. **The campaign: attic or deleted?** I ruled **attic** (C16) — `mission.js` and the campaign
   content move to `_design/attic/`, out of the import graph, recoverable in one move — because
   you wrote *"no campaign mode **atm**."* **If *atm* was just a turn of phrase and the campaign
   is genuinely gone, say so and it is deleted instead.** Cheap now, expensive later.

2. **The Veteran bot in HARD.** This narrows `pvp_design §7.2`'s blanket ban (C11). The code path
   ships and the preset is **OFF by default**. Enabling it puts **one** bot reacting in 300–420 ms
   in HARD matches, labelled on the mode-select card. My reasoning: the ban's premise was a public
   lobby where a losing human cannot judge whether the loss was fair — with one human who
   explicitly chose HARD, that premise does not hold. **Your call to flip it on.**

3. **You will feel v1's weapon numbers.** PVP ships first on the single-player balance at 100 HP
   (C25, R7), because changing those constants now would corrupt the concurrent aim wave's own
   measurements. The PVP set (110 HP, `steadyMult` 1.0, reduced recoil jitter, Corvus ADS changes,
   tac-sprint 2.5 s, 1 grenade) lands in wave 5. **If you would rather have the PVP numbers early
   and accept a muddier aim investigation, say so** — the seam ships in wave 1 either way, so it
   is a data flip whenever you want it.

4. **Match lengths.** TDM 50 kills / 8:00, CTF 3 captures / 12:00, FFA 25 kills / 8:00 (C12).
   These are **arithmetic, not measurement**, and the battery measures the real median. If you
   want longer matches, each is one line in `content.modes` — say the word and the numbers move.

5. **Do you always play AMBER (team 0)?** I fixed it (Part 3.3) because it makes every probe,
   screenshot and bug report comparable across runs. A "random team each match" toggle is trivial
   but it makes seeded runs non-comparable, so I would not add it.

6. **FFA spawns on the arcade balcony?** The balcony is the map's only power position. arena.md's
   residual R4 leaves two optional upper-floor spawn points unvalidated (the probe's grid is
   ground-only). Recommendation: **validate against the baked y = 4.2 floor and enable for FFA
   only** — a team-mode spawn on the power position is a free hold.

7. **`maps/meridian_ward.js` is now load-bearing, not optional.** arena.md offered the map split
   as a build-effort trade; O2 turns it into a hard requirement, because the aim wave's ground
   probes sample geometry the carve deletes. **This is effectively decided** — but you should know
   the consequence: the arena becomes a *derived* edit, auditable as a diff, and the campaign map
   survives as the reference for the six critic shot framings and the `visual_target` scorecard.

---

## PART 9 — SCOPE, HONESTLY

### 9.1 The size of this

**This is a substantial build: ten lanes across five waves, and it replaces the game's driver.**
It is not a feature added to Blackridge; it is a different game running on Blackridge's engine,
map and combat model. Concretely, it deletes a 554-line mission driver, replaces the entire
content schema, carves the map, generalises the AI's single most fundamental assumption (that
there is exactly one target in the world), and adds three mode implementations plus a commander
layer above the FSM.

What makes it tractable rather than heroic is how much already exists and is reused verbatim:
the combat FSM and its whole audited fairness surface; the squad token director and engagement
referee; the perception meter with its night light factor and hearing table; nav's A*, string
pulling and reachability; the entire event bus and view bridge; every render, fx, chars and audio
module; `soldiers.js`'s existing reap (V5), which makes respawn free; `squad.js`'s existing
squad-id keying (V6), which makes teams free; `sim.flags.noTarget` (V9), which makes the warm-up
freeze free; and `level.js`'s generic wall renderer (O4), which makes the carve free of the one
file we could not touch.

**Wave 1 is roughly 60% of the work** and its four lanes are genuinely parallel. Waves 2–4 are
each substantially smaller than wave 1.

### 9.2 First playable — end of wave 2

> **One mode, against nine bots, on the real arena, ending with a result banner.**

At the end of wave 2 the owner can play **SKIRMISH 5v5**: human plus four bots against five bots,
on the carved Lanternwalk, with the spawn director live, teams and friendly fire correct,
per-target perception, mixed difficulty bands, a team score bar, a killfeed, a held-TAB scoreboard
with bot glyphs and bands, a respawn timer, and a match that ends on the score limit or the clock
with `VICTORY` / `DEFEAT`.

**That is the earliest point at which the owner's complaint is answerable, and the arena is why.**
`arena_probe.mjs` measured, on the carved geometry: median walk to the nearest actor **1.5 s**,
p90 **2.9 s**, worst case in 1500 trials **7.4 s**, and **75.3%** of positions already have an
actor in direct line of sight. *"I wandered for 2 minutes and found nothing"* is structurally
impossible on 2593 m² with ten actors and respawns — before a single line of objective AI exists.

**What first playable deliberately does NOT have,** so nobody reports these as bugs:
CTF and FFA (wave 3); the commander, so bots fight competently but do not spread across lanes by
quota (wave 3); the PVP balance numbers, so it plays at 100 HP on single-player weapon constants
(wave 5); the faction rim tint, shipping as archetype tints (wave 5); the PVP lighting profile
(wave 5); a `VICTORY` string in the `hud.js` debrief, which will still read `MISSION COMPLETE`
(wave 5, O3).

### 9.3 The milestone ladder

| Milestone | Wave | What the owner can do | The bar |
|---|---|---|---|
| **Foundation green** | 1 | Nothing playable — but a 10-actor match runs 3000 ticks deterministically, headless, on the carved arena, with teams and spawns correct | Four selftests + `probe_arena.mjs` exit 0; `bootcheck.py` RESULT OK |
| **★ FIRST PLAYABLE** | 2 | **Play SKIRMISH 5v5 against 9 bots, start to finish, in a browser** | AC-1, AC-9, AC-39, AC-43 measured on TDM; the owner finishes one match |
| **All three modes** | 3 | Play CTF and FFA; bots demonstrably play the objective | AC-13 through AC-31; Gate 0 CTF at the ≥8/20 playable bar |
| **Proven** | 4 | Trust the numbers | The full Part 5 battery, including the ≥17/20 CTF ship bar and AC-32's monotonicity assertion |
| **Balanced & polished** | 5 | Play it as intended | AC-43…AC-49 at 30 fps; PVP tuning live; AC-50/AC-51 live-session confirmation |

---

*Every on-disk claim in Part 0.3 was read this session and is cited by file and line. Every
conflict between the four design docs is ruled in Part 1 with its reason. Where verification
contradicted a design doc, Part 2 says so by name rather than quietly designing around it. The
two cross-wave collisions in Part 6 (O1, O2) share no file with the concurrent aim wave and were
found by reading its probes, not its file list — they are the reason this plan orders two
specific wave-1 tasks ahead of everything else.*

---

## PART 10 — OWNER AMENDMENTS (2026-08-20, BINDING — override any conflicting ruling above)

**A1 — THE CAMPAIGN STAYS. C16 is OVERRULED.** The owner's words: "do not delete campaign,
leave it - add the pvp mode." Therefore:
- `core/sim/mission.js` is NOT moved to the attic. It stays wired and the campaign stays
  playable. W1's file list loses that MOVE action; everything else in W1 stands.
- `content.json` v2 RETAINS the `mission` block (and `archetypes`/`pois`/`pickups` the
  campaign needs) alongside the new `arena`/`modes` blocks. W4 does not split campaign
  content into the attic; the contract gate validates BOTH.
- The menu (W6 `mode_select.js`/`menu.js`) offers FOUR entries: CAMPAIGN, SKIRMISH (5v5 TDM),
  CAPTURE THE FLAG, FREE-FOR-ALL.
- `__test.startMission()` KEEPS its campaign behaviour unchanged. This RESOLVES the Part 0
  startMission finding more cleanly than W10's redefinition: the 11 harness callers (6 of them
  aim-wave probes) keep exactly the semantics they were written against. Matches start ONLY
  via the new `__test.startMatch({mode, seed, bots})`. W10's row is amended accordingly:
  no `startMission({}) → {mode:'tdm', bots:0}` redefinition.
- The campaign must still PASS its smoke test after the PVP build: mission starts, beats fire,
  bots spawn, no page errors. Breaking the campaign is a regression, not an acceptable cost.

**A2 — VISUALS MUST NOT REGRESS.** The owner: "ensure we do not drop visuals." The final
proof wave captures the shot battery and compares against the current build's frames; any
frame that reads worse than the pre-PVP build is a FAIL to fix, not a note. The PVP lighting
profile (W11/E19) may change the ARENA's look only in ways the balance rationale requires,
and never below the current visual bar.

**A3 — 30 FPS is the accepted perf bar (owner, earlier today): GPU ≤ 33.3 ms by timer query,
all phases, including perf-match with 10 actors.** Traversal currently measures ~41.9 ms and
must be brought inside the bar.
