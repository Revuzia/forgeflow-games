# BLACKRIDGE — PVP MODE DESIGN (expansion v1)

Status: **DESIGN PROPOSAL**, written 2026-08-19 against the v1 build on disk.
Authority order is unchanged: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md`
> the v1 design docs > **this document**. Nothing here re-litigates a BUILD_PLAN ruling
(R1–R31); where PVP needs something a ruling forbids, it is raised in Part 11 as a
freeze-amendment request, never assumed.

Scope of this document: **the PVP mode itself** — rules, maps, balance deltas, match
flow, fairness, bot backfill, and the architecture generalizations PVP forces. The
campaign biome set is a *sibling deliverable*; every dependency on it is marked
**[BIOMES]** and listed in Part 11. Map carving is specified against whatever geometry
that designer lands, plus one fully-worked example carved from the map that already
exists on disk.

Owner's directive (verbatim): *"I want a pvp mode ultimately, where we have MULTIPLE
maps from different areas of the campaign, which im assuming has things like outdoor,
or forest, or office, or various areas to fight/explore."*

---

## PART 0 — EVIDENCE LEDGER (what was verified on disk this session)

Load-bearing facts. Everything below traces to a file read this session; design that
rests on one of these cites it by number.

**E1 — There is no team concept anywhere in the sim.**
`grep -n "team\|faction" core/sim/sim.js core/sim/damage.js core/ai/botfsm.js` → **zero
matches**. `core/sim/damage.js:29` signs `applyDamage(sim, who, amount, attacker, part, src)`
where `who` is `'P' | botId`; there is no friendly-fire concept because there are no
friendlies. `core/ai/perception.js:69-140` reads `S.player` directly as *the* target
(`const player = S.player; … P.lastKnown = player.pos.slice()`). **PVP's single largest
sim change is generalizing "the player" into "an actor on the other team."**

**E2 — The map is one hardcoded function.**
`core/level/layout.js` (777 lines) is Meridian Ward, authored metre-exact, exported as
`buildLayout(seed)`; the `seed` parameter is explicitly documented as *reserved* ("wave-1
placement uses no RNG so layout, colliders and nav are bit-identical for every seed").
`core/level/colliders.js` (80 lines) is a pure transform of it. **There is no map id
anywhere.** Multi-map is a registry refactor, not a data addition.

**E3 — FFG already has a two-tier net stack, and its limits are documented in-repo.**
- `games/last-circle/runtime/net/ffg_netplay.js` — Supabase Realtime Broadcast+Presence,
  "a pure WebSocket relay … 200 concurrent conns, 2M msgs/mo", room channel
  `ffg:<gameId>:<code>`, deterministic host = lowest peer id.
- `games/last-circle/runtime/3d/royale/net.js:1-30` — **"Supabase Realtime bills one
  message per RECEIVING subscriber, so a room of H humans costs H per send and total
  traffic grows as H². … Realtime does not shed load at the cap, it DROPS THE
  CONNECTION"**; last-circle therefore truncates its rooms to 4 humans.
- `games/last-circle/runtime/net/ffg_rtc.js:1-23` — unreliable P2P DataChannel mesh
  (`{ordered:false, maxRetransmits:0}`), Google STUN only, **no TURN**, deterministic
  offerer by lexical peer id, explicit design note that a NAT-blocked pair "simply never
  opens and that peer keeps riding Supabase."

**E4 — The authority model in the only shipped FFG shooter is client-authoritative.**
`royale/net.js:20-21`: *"hits on a human are sent to the victim's client ('hitYou') — the
victim applies damage to itself (client authority over own HP)."* Each human simulates
its own actor; the host simulates the bots. There is no server. This is the honest
starting point for Part 6.

**E5 — Weapon numbers.** `core/weapons/weapon_data.js` is complete and TTK-verified
against the 150–400 ms band (`combat_spec §2.1`): Warden 28 body / 750 rpm, Vesper 25 /
900, Corvus 60 / 257, Pike 30 / 380; 100 HP, regen 4.5 s delay @ 35 HP/s
(`core/sim/damage.js:12-14`); `SPREAD_MODEL.steadyMult 0.55`; recoil `jitter` 0.12 /
0.18 / 0.10 / 0.15.

**E6 — Engine caps.** BUILD_PLAN R23: **8 live bots (content) / 12 (engine budget)**;
perf budget `sim tick CPU ≤ 3 ms, AI share ≤ 1.5 ms (≤4 brains think/tick, 12 bots max)`.
Draw budget ≤ 320 median. The 12-actor ceiling is a *rendering and AI* ceiling and applies
to remote humans too — they are skinned actors like any bot.

---

## PART 1 — MODES

### 1.0 The population ceiling (this decides everything else)

Two independent caps, both hard:

| Cap | Value | Source |
|---|---|---|
| **Human peers per match** | **8** | E3 — full mesh at 8 = 7 DataChannels per client; Supabase relay fallback cannot carry 8 (see 1.0.1) |
| **Total live actors** | **12** | E6 — R23 engine budget, ≤4 AI brains thinking per tick |

**Ruling: 6v6 with a maximum of 4 humans per team; every empty slot is a bot (Part 7).**
A full human lobby is 4v4 + 4 bots. One human alone is 1v6-with-5-friendly-bots and the
match still starts. This is the *only* configuration that respects both caps without
hoping for a population that a browser game does not have.

**1.0.1 — Why the relay cannot carry the room.** Supabase Broadcast bills per receiving
subscriber (E3). At H=8, one 15 Hz state stream costs 15 × 7 = 105 msg/s **from a single
sender** — already over the documented 100 msg/s project ceiling, and the documented
failure mode is disconnection, not throttling. Therefore:

- **RTC mesh carries state** (unreliable DataChannel, per-peer, unbilled).
- **Supabase carries signalling + rare reliable events only** (join/leave, match start,
  round transitions, score commits, kick) — ~2–5 msg/s room-wide.
- **A peer whose mesh never opens (no TURN, E3) gets a private bridge channel**
  `ffg:blackridge:<code>:b:<peerId>` between it and the host — a 2-subscriber channel,
  so each message bills 1, not 7. Host mirrors a merged 8 Hz envelope down it; the
  stranded peer sends its own state up at 8 Hz. Cost: 16 msg/s per stranded peer.
  **Hard cap 2 stranded peers (32 msg/s).** A third stranded peer is told honestly
  ("your network can't reach the other players directly") and offered: play against
  bots locally, or requeue. Never silently degrade the whole room to save one peer.

### 1.1 The three modes

Ranked. Ship order is the rank order; Blackline has an explicit gate.

---

#### MODE 1 — **SKIRMISH** (team deathmatch) — *ships first, always available*

The mode that must exist because it is the mode that always works: no objective state to
replicate, no round structure to desync, no dead time. It is also the honest testbed —
if Skirmish is not fun, no objective layer will save the shooting.

| Rule | Value |
|---|---|
| Teams | 6v6 (≤4 humans/team, rest bots) |
| Score limit | **75 kills** |
| Time limit | **10:00** |
| Respawn delay | **4.0 s** (0 s for the first spawn of the match) |
| Win | First team to 75, or highest score at time; **tie → 2:00 sudden-death overtime, first kill wins**; still tied (nobody dies) → draw, recorded as a draw |
| Spawns | Fully dynamic both teams (Part 2) |
| Score | 100 per kill, 25 per assist (≥40 damage within 5 s of the kill), 0 for deaths |

Assists are scored because in a 12-actor arena with 5-shot TTKs, a large fraction of
damage is traded; a kill-only scoreboard lies about who did the work.

---

#### MODE 2 — **FOOTHOLD** (rotating capture zone) — *ships first*

The mode that makes the maps matter. A single active zone that moves on a fixed rotation
forces the whole lobby onto known ground at known times, which does three things Skirmish
cannot: it gives the spawn director a stable prediction of where the fight is (Part 2.4),
it makes power positions and rotation routes readable, and it gives bots a legible goal
(Part 7.3). Rotation is *fixed and published*, not random — players learning the rotation
is the mode's skill floor.

| Rule | Value |
|---|---|
| Teams | 6v6 |
| Score limit | **200 points** |
| Point rate | **1 pt/s** to the team that has ≥1 living member inside the zone and the enemy has **0** |
| Contested | Both teams present → **neither scores** (no "majority holds" — it rewards stacking, and with bots in the lobby a headcount rule is exploitable) |
| Zone | Cylinder r = **7.0 m**, height 4.0 m (so a balcony above the zone is *out* of it — the power position overlooks, it does not hold) |
| Rotation | **5 authored zones per map, fixed order, 60 s each**, then the next zone arms. 5 s pre-arm warning (HUD + audio), zone marker visible map-wide through geometry at reduced opacity |
| Time limit | **10:00** |
| Respawn delay | **5.0 s** (longer than Skirmish: losing a hold must cost something) |
| Win | First to 200, or highest at time; tie → the team holding the active zone at 0:00 wins; nobody holding → draw |
| Score | 100/kill, 25/assist, **1 per point earned while personally inside the zone**, 150 for a "break" (first kill inside a zone the enemy was scoring in) |

Spawn-protected players (Part 2.5) **do not count** as zone occupants, in either
direction — otherwise a spawn flip next to the zone freezes the score.

---

#### MODE 3 — **BLACKLINE** (round-based, no respawn) — *ships gated*

One life per round, attackers carry a relay charge, defenders hold two sites. This is the
mode with the most tension and the most ways to be miserable: a dead player is a
spectator, and a browser lobby that loses two peers mid-round has a 3v5. **It ships only
if the Part 9.3 lobby gate passes**; otherwise it goes in the first post-launch update
with the same spec.

| Rule | Value |
|---|---|
| Teams | **4v4** (8 actors, not 12 — a no-respawn mode with 12 actors ends in 25 s) |
| Rounds | First to **6 round wins**, sides switch after round 6 (max 11 rounds) |
| Round timer | **1:45** |
| Charge | Attackers spawn with the charge on one carrier; on carrier death it drops and is pickable (2.0 s pickup, interrupted by damage) |
| Plant | **4.0 s**, cancellable; only inside site A or B (r = 4 m) |
| Detonation | **40 s** after plant |
| Defuse | **7.0 s**, cancellable; **partial defuse persists** (a defuse resumed within 10 s keeps its progress — the "half-defuse bait" is a real read, not a coin flip) |
| Round win | Attackers: detonation **or** wipe. Defenders: defuse, wipe, **or** timer expiry with no plant |
| Buy/loadout | None. Loadout is chosen between rounds, free, from the same three primaries |
| Spawns | **Fixed per side per round** — the dynamic director is OFF (Part 2.6) |
| Dead players | Free-cam spectate of living teammates only (no enemy cam — that is a live wallhack for a voice-comms party) |

---

### 1.2 Modes deliberately NOT in v1 (so nobody "finds" them missing)

- **Free-for-all** — the spawn director's core signal is *team* influence (Part 2.4); FFA
  spawning is a genuinely different algorithm and would ship worse.
- **Objective modes with carried flags** — carrier state is the hardest thing to replicate
  under client authority (E4); a desynced flag is an unloseable match.
- **Ranked / skill-based matchmaking** — see Part 6.3: with a client-authoritative sim
  and no server, a ladder is an invitation, and there is nothing to rank against.
- **Killcams** — require recording and replaying another client's state stream. The
  2.5 s death-cam of Part 5.4 is the honest 90%-of-the-value version.

---

## PART 2 — SPAWN DIRECTOR (the algorithm, not the vibe)

Bad spawns are the number-one way a small-arena shooter dies. This is specified as an
algorithm with numbers because it will otherwise be implemented as "pick the farthest
point," which spawn-traps within three matches.

**Ownership:** the **host** runs the director for every actor including remote humans and
bots. A client never chooses its own spawn point — client-chosen spawns are a free
teleport hack (Part 6). The host sends `spawn{actorId, pointId, t}` reliably; the client
applies it. Host migration re-arms the director on the new host with a fresh influence
grid (2 s of warm-up during which vetoes are widened by ×1.4).

### 2.1 Authored data (per map, `content.json` → `maps[<id>].spawnPoints[]`)

```jsonc
{ "id": "sp_l_s07",
  "pos": [-8.0, 0.0, 14.5], "yaw": 3.14,      // yaw faces INTO the arena, never at a wall
  "cluster": "SC_SOUTH",                       // 3-6 clusters per map
  "cover": 0.8,                                // authored 0..1: solid cover within 4 m
  "zoneHint": "plaza_south" }                  // for the objective-distance term
```

Requirements, gate-checked at bake (Part 9.1): **30–50 points per map**, every point on
walkable nav, every point ≥ 2.0 m from any collider face, every point's `yaw` having ≥ 8 m
of unobstructed forward view, and **every cluster containing ≥ 6 points spread over
≥ 250 m²** (a cluster of 3 tight points is a grenade kill).

### 2.2 Hard vetoes (evaluated first; any hit rejects the point)

| # | Veto | Value |
|---|---|---|
| V1 | Enemy within radius | **22 m** |
| V2 | Any enemy has LOS to the point's head height (1.55 m) | within **60 m** (`world.losBlocked`, the existing THREE-free call, `architecture §3.6`) |
| V3 | Point inside an enemy's view cone even without LOS | **±35° and ≤ 40 m** (they are one step from seeing it) |
| V4 | A friendly spawned at this point recently | **1.5 s** |
| V5 | Live grenade, or an explosion in the last 1.5 s, within | **12 m** |
| V6 | A teammate died within 8 m of this point in the last | **5 s** (a death cluster IS the trap signal) |
| V7 | Mode veto — Foothold: inside the active zone or within 15 m of it | — |

**If every point is vetoed**, relax in this exact order, one step at a time, re-scoring
after each: V3 off → V6 off → V2 radius 60 → 30 m → V1 22 → 14 m. Every relaxation step
increments `counters.spawnStress` (a Part 9 gate reads it: a map whose median
`spawnStress` > 0.5 per match is an under-built map, not a tuning problem). If *still*
nothing survives, spawn at the cluster centroid with **3.0 s** protection instead of 1.5 s
and log it — never fail to spawn.

### 2.3 Score (argmax over survivors)

```
score(p) =  40 * min(1, dNearestEnemy(p) / 55)          // safety, saturating
          + 22 * (1 - min(1, dNearestFriendly(p) / 35)) // spawn WITH your team
          + 18 * influence(p)                            // -1..+1, §2.4
          + 14 * modeTerm(p)                             // §2.4.1
          + 10 * p.cover
          - 20 * recency(p)                              // 1.0 if used <12 s ago, linear to 0 at 24 s
          - 15 * facing(p)                               // max over enemies within 60 m of
                                                          //   cos(angle between aim and p), clamped ≥0
          + 6  * rng.spawn()                             // tie-break jitter; deterministic stream
```

Weights are the tuning surface; the *shape* is not. Two properties are load-bearing and
must survive tuning: safety saturates at 55 m (past that, farther is not better — it just
means a long walk), and the friendly term is a **proximity** term, because a lone spawn
behind the enemy team is not a gift, it is a death.

### 2.4 Influence map + spawn flip (the anti-trap machinery)

- Grid of **4 m cells** over the arena AABB, rebuilt at 5 Hz on the host.
- Each living actor deposits `±1.0` (sign by team) with linear falloff to 0 at **25 m**.
- Each kill deposits `±2.0` at the victim's position, decaying with the grid.
- Whole grid decays **×0.85 per second** toward 0.
- `influence(p)` = the cell value at `p`, normalized to −1..+1.

**Cluster ownership.** Each cluster keeps a 3 s rolling mean of its points' influence.
Team T's *home cluster* is the one it is currently spawning in.

**Flip rule.** If T's home cluster mean < **−0.35 for 3 consecutive seconds**, flip T to
the highest-influence cluster that is not the enemy's home cluster. **Hysteresis: no flip
within 12 s of the last flip** (spawn thrash reads worse than a bad spawn — it teleports
the fight).

**Trap override.** If **≥3 of a team's last 5 spawns died within 6 s of spawning and
within 20 m of their spawn point**, flip immediately, ignoring hysteresis; additionally
widen V1 to 32 m and V2 to 80 m for **20 s**, and post one HUD line to the trapped team:
`SPAWN COMPROMISED — FALLING BACK`. Naming it is part of the design: an unexplained
teleport across the map reads as a bug.

**2.4.1 modeTerm.** Skirmish: 0 (no objective). Foothold: `1 - min(1, dToActiveZone /
mapDiag)` **but clamped to 0 if `dToActiveZone < 25 m`** — the target is a 12–18 s
rotation, not a spawn on top of the point. Blackline: unused (2.6).

### 2.5 Spawn protection

- **1.5 s of full damage immunity**, cancelled early and permanently by: firing, ADS,
  throwing a grenade, or planting/defusing. Movement, sprint, and slide do **not** cancel
  it — you must be able to leave a bad spawn.
- Enemy-visible tell: a thin additive rim shimmer on the protected actor (one shared
  material; no new light — R3 pool is fixed). Hiding protection from the enemy just
  converts it into wasted magazines and a false hitmarker.
- A protected actor does not hold the Foothold zone (1.1) and cannot be a valid target for
  the AI's cover-scoring "threat" term (Part 7.3).

### 2.6 Blackline spawns

The dynamic director is **off**. Each side has one authored spawn *area* (8–10 points)
per map, fixed for the whole round, ≥ 45 m from either site, with no LOS to either site
from any point. This is not laziness: dynamic spawning in a one-life round mode changes
where the enemy can be between rounds, which destroys the mode's entire read.

---

## PART 3 — MAPS

### 3.0 The carve doctrine (applies to every arena, including future ones)

A campaign locale is linear, one-directional, and authored so the player always faces the
next beat. An arena is none of those things. **Eight edits convert one into the other**,
and every arena spec below is written as a delta against them:

1. **BOUND IT — diegetically.** Every arena edge is a physical object with readable "you
   cannot go there" language: stacked freight containers, a collapsed gantry, a jersey-
   barrier line with a burned-out truck, a landslide, a fire door welded shut. **No
   invisible walls, ever** — an invisible wall is an instant amateur read and it also
   voids D7 (`visual_target` "every area has a REASON").
2. **LOOP IT.** No dead ends. Every lane connects at *both* ends; every enclosed room has
   ≥ 2 entrances; the three lanes plus cross-cuts must form at least one complete ring so
   a losing team can rotate rather than push into a grinder.
3. **BALANCE IT — rotationally, not by mirroring.** Mirrored maps read as artificial and
   kill the campaign-locale fiction. The contract is measurable instead: for the two
   primary spawn clusters, (a) distance to the map's centroid within **±8%**, (b) count of
   authored cover pieces within 30 m within **±15%**, (c) the longest sightline available
   from each within **±10 m**, (d) rotation time to each Foothold zone within **±2.0 s**
   at walk speed (4.6 m/s). These four are a gate (Part 9.1), not an aspiration.
4. **REVERSE THE ONE-WAYS.** Campaign geometry is full of one-directional affordances —
   a drop the player takes forward, a mantle that only works from the approach side. Every
   one of them gets a reverse route or is removed.
5. **STRIP THE SCRIPT.** Delete waves, checkpoints, triggers, pickups, set-pieces, radio
   VO, mission colliders. Set-piece *geometry* stays if it reads as architecture; set-piece
   *behaviour* (e.g. the Meridian Ward blackout) does not — a lighting state change
   mid-match is a fairness event with no counterplay.
6. **RE-COVER THE CONNECTORS.** `level_design §2.6` deliberately makes connectors sparse:
   "risk in transit." That is a single-player rule — a bot ambush is survivable, a human
   holding a 20 m bare corridor is not. Arena connectors get cover at **6–9 m** spacing.
7. **RE-LIGHT FOR PVP READABILITY** (§3.1).
8. **RE-PROBE.** New geometry re-runs `tools/probe_props.mjs` (zero floats/clips), the
   nav bake, the content contract gate, and its own shot battery against the
   `visual_target` scorecard. **A PVP arena is held to the same ship bar as the campaign
   map — every dimension ≥ 8, mean ≥ 8.5, blind verdict ≥ borderline.** There is no
   "multiplayer maps can look worse" clause.

### 3.1 The PVP lighting profile (a real balance change, not a mood change)

Meridian Ward is a 6%–12% brightness night storm in most zones (`level_design §3.4`) with
fog density 0.010 and a 0.46 transmittance at 78 m. Against bots that is atmosphere.
Against humans it is an information asymmetry that rewards whoever stands still in the
dark. Every arena, in every biome, ships a **PVP lighting profile** applied at map load:

| Change | Value | Why |
|---|---|---|
| Darkest-zone floor | no playable zone below **18%** relative brightness | a lane the eye cannot resolve is a camper subsidy |
| Key:ambient ratio | **unchanged, ≥ 4:1** — the floor is raised by lifting the KEY (moon/sun intensity) and the practical count, **never by raising ambient** | `visual_target` D1 hard-caps ambient-only lighting at 3 |
| Fog density | **×0.7** of the campaign value (Meridian Ward 0.010 → **0.007**) | 78 m transmittance 0.46 → 0.58: a target at the end of the longest lane is a *silhouette*, not a rumour |
| Team read | **faction rim tint** on all actors: ATTACK team warm `#d9a441` (the HUD accent), DEFEND team cool `#7c9fd0`, applied as a rim term in the existing character material, ≥ 0.35 intensity, visible from behind | this is the single highest-value readability change; friendly fire is off, so mistaking a teammate costs a magazine and a death |
| Practical flicker | **off** in PVP (the tram-platform fluorescent, `level_design §3.3`) | a flickering light is a randomised visibility roll on a duel |
| Dynamic light events | **banned** during a live match (blackout, transformer arc) | see carve rule 5 |

This is applied as a per-map `lightingProfile: 'campaign' | 'pvp'` on the same fixed
light pool (R3: 1 dir + 1 hemi + 8 spot + 4 point). **The pool never changes size** —
intensities and emissive values only. Nothing here costs a shader permutation.

### 3.2 Launch map portfolio

Six maps specified. **Recommended launch set = the first four**; maps 5 and 6 ship in the
first update. The reason is Part 9.2: each arena carries a full critic-loop cost, and four
arenas is the largest set that can plausibly clear the ship bar in one pass.

Portfolio rules (deliberate, so the set is not five versions of one map):

- **Every map owns a different engagement band.** No two launch maps share their dominant
  sightline band.
- **Every map owns a different time of day.** Night rain, dusk fog, night interior, dawn
  overcast, then day and dusk for the update pair.
- **Every map has 3–6 spawn clusters and 1–2 power positions**, each power position with a
  named counterplay route.
- Weapon availability is **identical on every map** — the band mix is the balancing lever,
  not access. Corvus is meant to be a poor pick on Exchange and a great one on Spillway.

| # | Map | Biome / campaign locale | Playable footprint | Dominant band | Modes | Wave |
|---|---|---|---|---|---|---|
| 1 | **LANTERNWALK** | Meridian Ward — night urban rain **(exists on disk)** | 74 × 56 m | mid 20–38 m | all 3 | launch |
| 2 | **HOLLOWPINE** | Forest — logging camp, dusk fog **[BIOMES]** | 90 × 72 m | mixed 12–45 m | all 3 | launch |
| 3 | **EXCHANGE** | Office — corporate floor + atrium, night **[BIOMES]** | 62 × 48 m | CQB 4–16 m | Skirmish, Blackline | launch |
| 4 | **SPILLWAY** | Outdoor — dam service deck + channel, dawn overcast **[BIOMES]** | 96 × 70 m | long 45–85 m | Skirmish, Foothold | launch |
| 5 | **BOXCUT** | Outdoor — quarry pit, midday haze **[BIOMES]** | 46 × 40 m | CQB/mid 6–24 m | Skirmish (3v3), Blackline | update |
| 6 | **SLIPWAY** | Industrial — rail/freight yard, dusk **[BIOMES]** | 88 × 80 m | long + CQB, no mid | all 3 | update |

---

### 3.3 MAP 1 — **LANTERNWALK** (carved from Meridian Ward, night urban rain)

This is the only map whose geometry exists today, so it is specified metre-exact against
the real `layout.js` data. It is also the cheapest possible proof that the whole carve
pipeline works: **build this one first, verify it, then carve the biomes.**

**Arena bounds:** X ∈ [−48, +26], Z ∈ [−34, +22] — **74 × 56 m**.
Source zones (`layout.js` ROADS, verbatim ids): `r_plaza` X[−25,+15] Z[−18,+18],
`r_arcade` X[−39,−26] Z[−19,+5] (two floors, upper at y +4.2), `r_gallery` X[15.5,24.5]
Z[−34,+14], `r_cs1` X[−41,−12.5] Z[−28,−18], `r_alley` X[−58,−41] Z[−30,+42] (stub only),
`r_street` X[−12.5,0] Z[−41,−18] (stub only), `r_cut` X[13,28] Z[−22,−18].

**Three lanes + flank** (arena axis runs N–S, same convention as the campaign):

| Lane | Geometry | Width | Band | Character |
|---|---|---|---|---|
| **West** | alley stub X[−48,−41] + Pale Lantern Arcade interior, 2 floors | 4–6 m / interior | **CQB 5–14 m** | Vesper lane, darkest, the only verticality |
| **Centre** | Meridian Market plaza | 40 × 36 m | **mid 20–38 m** (kiosks cap the diagonal) | Warden lane, the hero space, brightest |
| **East** | Storm Gallery, covered service arcade | 3.5 m | **CQB 8–18 m** | Vesper/Warden, dark, the rotation artery |
| **North cross** | `r_cs1` cross-street + market-street stub | 8–12 m | **mid 16–24 m** | connects west lane to east lane behind the plaza |

**Deliberate omission:** there is no 45 m+ lane. Lanternwalk is the map where Corvus is a
bad pick, and that is the portfolio's job (§3.2). The boulevard (78 m) is *outside* the
arena on purpose — including it would make one map own two bands and leave Spillway with
nothing to be.

**Spawn clusters (4):**

| Cluster | Anchor | Points | Role |
|---|---|---|---|
| `SC_SOUTH` | plaza south edge + ramp head, X[−14,+8] Z[+10,+18] | 11 | Team A default |
| `SC_NORTH` | `r_cs1` + market-street mouth, X[−34,−14] Z[−26,−19] | 10 | Team B default |
| `SC_EAST` | gallery south end + NE cut, X[+16,+25] Z[+2,+13] | 9 | flip target |
| `SC_WEST` | alley stub + arcade west door, X[−47,−37] Z[−10,+4] | 8 | flip target |

Rotational-balance check (carve rule 3), computed against the real geometry: arena
centroid is (−11, 0, −6); `SC_SOUTH` centroid (−3, 0, +14) sits **21.5 m** from it,
`SC_NORTH` centroid (−24, 0, −22.5) sits **21.0 m** — **2.5% apart**, inside the ±8%
contract. Cover counts and sightlines are A3's to equalise during the carve and are
gate-checked, not assumed.

**Power positions (2):**

1. **Arcade balcony**, y +4.2, east windows overlooking the plaza at 22–35 m. Existing
   access: stairs NW (−38, −16) and SE (−27, +4) (`level_design §2.5`). **Counterplay:**
   two stairwells plus the new mantle (edit 6) means three ways in; the balcony sees the
   plaza but **not** the gallery, the cross-street, or its own stairwells.
2. **Plaza kiosk island**, ground level, centre of the map. Not high ground — *cover*
   density (14 pieces at 4–6 m spacing, `level_design §2.6`). Whoever holds it holds the
   Foothold rotation. **Counterplay:** it is overlooked by the balcony and flanked by both
   cross-cuts; nothing about it survives a grenade.

**Carve edits (the specific list A3 executes):**

| # | Edit | Coordinates | Diegetic form |
|---|---|---|---|
| E1 | Seal the south ramp | wall across `r_ramp`, X[−14,−6] at Z = +22 | two stacked freight containers + police tape |
| E2 | Seal the alley south | X[−48,−41] at Z = +22 | collapsed scaffold bay + tarps (asset already in the alley dressing) |
| E3 | Seal the NE cut to the boulevard | X = +26 in `r_cut` | collapsed tram gantry, wires down, sparking (emissive only) |
| E4 | Seal the market street north | X[−12.5,0] at Z = −34 | customs barricade line + burned-out truck |
| E5 | Seal the gallery north door | (+24, 0, −30) | welded fire door (readable, not a blank wall) |
| **E6** | **NEW: north service corridor** — carve a 4 m × 10 m passage through `bld_nea` X[0,13] Z[−24,−20], doors at both ends | connects market street ↔ gallery north | breaker-room corridor, one flickerless strip light (fake practical) |
| **E7** | **NEW: reverse mantle** — kiosk roof (−22, 2.6, −6) → arcade balcony east window (−25, 4.2, −6) | 3rd entry to power position 1 | window frame with the pane already broken |
| E8 | Re-cover the cross-street | `r_cs1`, currently thin | 3 added cover pieces at ~8 m spacing (dumpster, van, planter — existing prop kinds) |
| E9 | Strip the script | — | blackout set-piece, all 44 spawns, waves, CINDERLOCK table, pickups, checkpoints deleted |
| E10 | PVP lighting profile | §3.1 | alleys 12% → 18% floor via +2 fake sodium heads and moon +0.06 intensity; fog 0.010 → 0.007 |

**Edit E6 is the one that makes it a map.** Without it the arena is two loops sharing the
plaza and the north half is a dead end; with it, the full ring is plaza → cross-street →
alley/arcade → plaza and gallery → corridor → market street → cross-street, satisfying
carve rule 2 with a single 40 m² excavation into an existing building mass.

**Foothold zones (5, fixed rotation order):** `Z1` plaza centre (−5, 0, 0) · `Z2` arcade
ground-floor lightwell (−32, 0, −8) · `Z3` cross-street mid (−26, 0, −23) · `Z4` gallery
mid (+20, 0, −10) · `Z5` plaza NE / cut mouth (+12, 0, −16). Rotation walks the ring, so
every 60 s the whole lobby must cross the plaza or the corridor — the two spaces the map
is designed to be watched from.

**Blackline sites:** A = arcade lightwell (−32, 0, −8), B = gallery mid (+20, 0, −10).
Attacker spawn `SC_SOUTH`, defender spawn `SC_NORTH`. Both sites are 43–48 m from the
defender spawn and 46–52 m from the attacker spawn — inside the rule-3 contract.

---

### 3.4 MAP 2 — **HOLLOWPINE** (forest biome — logging camp, dusk fog) **[BIOMES]**

The owner named "forest" explicitly, and forest is the biome most likely to be designed
as a *corridor* in the campaign (trees as walls, a trail as the path). That makes it the
biome most in need of the carve doctrine.

**Arena:** 90 × 72 m. Campaign source: the logging camp and the mill approach.

**Lanes:**
- **West — the cut line:** a felled-timber corridor, **long 40–55 m**, stumps and log
  stacks as chest cover every 7 m. The one long sightline on the map.
- **Centre — the mill:** two-storey open sawmill, catwalk at y +4.0, saw pit below.
  **CQB/mid 8–20 m**, hard vertical read, three ground entrances and two catwalk stairs.
- **East — the treeline trail:** switchbacking dirt trail through dense trunks,
  **CQB 6–14 m**, broken sightlines every 12–15 m.
- **Cross-cuts:** the log flume (a raised timber trough, walkable, connects west lane to
  the mill catwalk — the map's signature route), and the equipment yard behind the mill.

**Spawn clusters (4):** `SC_CAMP` (bunkhouses, south), `SC_LANDING` (log landing, north),
`SC_YARD` (equipment yard, east), `SC_SLASH` (the burn pile, west).

**Power positions:** (1) **mill catwalk** — sees the saw floor and the yard, not the cut
line; counterplay is two stairs plus the flume, plus it is the most grenade-vulnerable
space on the map. (2) **the landing crane cab**, y +5.5, sees the full cut line;
counterplay is a single exposed ladder-stair and total blindness to everything east.

**Carve requirements to hand [BIOMES]:** trees are **not** cover — a trunk the player
cannot shoot through and cannot see past is a wall, so the trunk field must be authored
with ≥ 3.5 m gaps in the trail lane and the collider set must tag bark `soft` (Warden and
Corvus penetrate it, Vesper and Pike do not — an existing, free, biome-defining
interaction, `combat_spec §3.2`). Fog is the biome's atmosphere *and* its readability
risk: PVP profile puts it at 0.007 with the dusk key raised, never higher.

---

### 3.5 MAP 3 — **EXCHANGE** (office biome — corporate floor + atrium, night) **[BIOMES]**

The owner named "office." Interiors are the biome where the campaign's linearity is worst
(a corridor of rooms) and where the arena payoff is highest (fastest, most readable
fights, zero fog, zero weather cost, best frame budget on the whole portfolio).

**Arena:** 62 × 48 m over **two floors** — the smallest and the densest.

**Lanes:**
- **West — open plan:** desk pods, glass partitions (`soft` matClass — wallbang texture is
  the entire personality of this map), **CQB 6–14 m**.
- **Centre — the atrium:** two floors open to each other, escalator pair, **8–18 m with a
  vertical read**; the only place on the map you are exposed to both floors at once.
- **East — the executive ring:** a closed corridor loop of offices and a boardroom,
  **4–10 m**, four doors, one glass wall onto the atrium.
- **Cross-cuts:** service stair (NW), elevator lobby (SE), and the atrium bridge at y +4.0.

**Spawn clusters (3, plus 1 flip):** `SC_LOBBY` (ground south), `SC_FLOOR2N` (upper
north), `SC_SERVICE` (ground west), flip `SC_BOARD` (upper east).

**Power position:** the **atrium bridge** — sees both floors and the escalators.
Counterplay: it is glass-railed (`soft`, shootable through), reachable from four points,
and completely blind to both the open plan and the executive ring.

**Carve requirements [BIOMES]:** the campaign office will have locked doors and scripted
breaches — every one becomes a permanently open doorway or a permanent wall, never a
door that opens. **No moving geometry in PVP** (a door state is replicated state, and
replicated state under client authority is a desync). Glass must be `soft` on the
collider and must *stay* geometry when shot (spider-web decal, not deletion) — deleting a
pane is a state change that clients will disagree about.

---

### 3.6 MAP 4 — **SPILLWAY** (outdoor biome — dam service deck, dawn overcast) **[BIOMES]**

The owner named "outdoor." This is the map that gives Corvus a home and the portfolio its
long band, and dawn overcast gives the set its only high-key lighting — which is also the
hardest lighting to fake (`visual_target §0.1`), so it carries the most visual risk and
should be the map A6 prototypes first.

**Arena:** 96 × 70 m, with **three elevation tiers** (channel floor y 0, service deck
y +6, crest walkway y +12).

**Lanes:**
- **Centre — the spillway channel:** the long lane, **55–85 m**, concrete floor, a
  staggered line of debris and sediment berms as the only cover, deliberately sparse. This
  is the "you may cross it, but choose your moment" space.
- **West — the sluice gallery:** an enclosed machine gallery running the channel's length,
  **CQB 8–16 m**, four windows onto the channel (four DMR/AR firing ports).
- **East — the service deck:** y +6 terrace with generator housings, **mid 20–35 m**,
  looks down into the channel.
- **Crest walkway** y +12: connects both ends **above** everything, fully exposed, no
  cover. A rotation route that costs you your safety.

**Spawn clusters (4):** `SC_INTAKE` (north crest), `SC_OUTFALL` (south channel),
`SC_GALLERY` (west, mid), `SC_PLANT` (east deck).

**Power positions:** (1) **crest walkway centre** — sees everything, has nothing;
counterplay is that it is visible from everywhere and reachable by four stairs.
(2) **gallery firing ports** — the real DMR nest; counterplay is a rear corridor with two
entrances and the fact that a muzzle flash in a dark window at dawn is the most visible
thing on the map.

**Carve requirements [BIOMES]:** the campaign will want the channel to be a set-piece
(water release, a timed crossing). **Water level is static in PVP.** The channel's cover
must be raised from campaign-sparse to the arena minimum (carve rule 6) — 6–9 m spacing —
or the long lane is a no-go zone rather than a decision. This map is also the one that
must be re-checked against the **draw-call budget** (≤ 320 median): three tiers of open
geometry with long sightlines is the worst case in the portfolio.

---

### 3.7 MAP 5 — **BOXCUT** (quarry pit, midday haze) **[BIOMES]** — *update wave*

**Arena:** 46 × 40 m, the small map. Built for **3v3 Skirmish and 4v4 Blackline**, and for
the lobby state a browser game actually spends most of its life in: four people online.
Terraced pit benches give three stacked rings of cover; ramps at opposing corners give the
ring. Two spawn clusters plus two flips. Power position: the **crusher platform**, which
sees two of the three benches and neither ramp.

A small map is not a scaled-down big map: at 46 × 40 m, spawn vetoes V1 (22 m) and V2
(60 m LOS) will veto nearly everything, so BOXCUT ships with a **map-local veto override**
— V1 14 m, V2 30 m — declared in its map data and gate-checked, not discovered at runtime
through `spawnStress`.

### 3.8 MAP 6 — **SLIPWAY** (rail/freight yard, dusk) **[BIOMES]** — *update wave*

**Arena:** 88 × 80 m. Container stacks make **long rail lanes (50–70 m) with zero mid
band** — you are either at 8 m between two containers or at 60 m down a track. The
portfolio's only "two bands, no middle" map, and the natural Foothold map because the
container maze makes zone rotation genuinely navigational. Four spawn clusters at the
yard's corners. Power position: the **gantry crane deck**, y +9, which sees three tracks
and cannot see into any container row.

---

## PART 4 — BALANCE DELTAS vs SINGLE-PLAYER

### 4.0 The mechanism (one fork point, not a forked table)

`weapon_data.js` stays **the** table (A4 owns it, unchanged). A new THREE-free module
`core/pvp/pvp_tuning.js` exports `applyTuning(WEAPONS, mode)` returning a *merged* table,
and `createSim({ …, tuning: 'sp' | 'pvp' })` selects it. Consequences that matter: the sim
stays deterministic and Node-runnable, `sim.selftest.cjs` can assert **both** tables
(a PVP STK battery alongside the existing SP TTK battery), and there is exactly one place
where a number can diverge. **A PVP-only number that lives anywhere else is a bug.**

### 4.1 The core change: player HP 100 → 110 (PVP only)

This is the whole balance philosophy in one scalar, and it was chosen over editing damage
values because of what it does *and does not* touch.

Human reaction anchors: simple visual reaction ~250 ms, choice reaction 300–400 ms. On top
of that, this stack's victim-side lag budget is real and measurable (Part 6.1): 120 ms
interpolation buffer + one-way peer latency. **A TTK below ~250 ms means the victim is
dead before the fight has been presented to them as a fight.**

STK/TTK, all-body-shots, before and after (damage numbers unchanged, from `weapon_data.js`):

| Weapon | SP: 100 HP | PVP: 110 HP | Δ |
|---|---|---|---|
| Warden near (28) | 4 shots → **240 ms** | 4 shots → **240 ms** | **unchanged** |
| Warden far (22) | 5 → 320 ms | 5 → **320 ms** | unchanged |
| Vesper near (25) | 4 → **200 ms** | **5 → 267 ms** | **+33% — the intended fix** |
| Vesper far (17) | 6 → 333 ms | **7 → 400 ms** | +20% |
| Corvus ≤45 m (60) | 2 → **233 ms** | 2 → **233 ms** | unchanged |
| Corvus @60 m (56) | 2 → 233 ms | 2 → **233 ms** | unchanged (112 ≥ 110) |
| Corvus @90 m (48) | 3 → 466 ms | 3 → **466 ms** | unchanged |
| Pike body (30) | 4 → 474 ms | 4 → **474 ms** | unchanged |
| Pike 2-headshot (54) | **2 → 158 ms** | **3 → 316 ms** | **the 158 ms two-tap is gone** |
| Warden 3-headshot (39.2) | 3 → 160 ms | 3 → **160 ms** | unchanged (117.6 ≥ 110) |

Read the Δ column: **110 HP changes exactly the two outcomes that were outside the human
band and nothing else.** Vesper's 200 ms melt and Pike's 158 ms two-tap were both
documented as deliberate SP exemptions (`combat_spec §2.1`: "sidearm exemption") — those
exemptions are safe against a bot with a 500–700 ms reaction roll and lethal against a
human. Warden's 240 ms and Corvus's 233 ms sit above the reaction floor and are the two
identities the game is built on; they are untouched.

It also preserves Corvus's range identity for free: solving `2 × falloff(d) = 110` on the
existing 60→48 ramp over 45→90 m gives **2-shot inside 63.8 m, 3-shot beyond** — the
falloff floor (48) doubled is 96, under 110. That is the map-band lever doing balance work
with no new numbers at all.

**One boundary to watch:** Warden's far floor is 22, and 5 × 22 = **exactly 110**. The
5-shot far kill is therefore exact, not comfortable. It is deterministic today (integer
damage beyond 58 m, and `damage.js` kills at hp ≤ 0), but any future edit to Warden's
`min` or to PVP HP silently turns a 320 ms kill into a 400 ms one. `sim.selftest.cjs --pvp`
asserts this row explicitly so the change cannot land unnoticed.

**Rejected alternative:** a PVP damage table. It doubles the number of values that can
drift, re-opens every TTK assertion in `sim.selftest.cjs`, and breaks the shared
`effectiveSpread`/crosshair truth model if the two tables' spread fields ever diverge.
One scalar is auditable; twelve edited fields are not.

### 4.2 Health, regen, and the punish window

| Value | SP (`core/sim/damage.js:12-14`) | PVP | Why |
|---|---|---|---|
| Max HP | 100 | **110** | §4.1 |
| Regen delay | 4.5 s | **5.0 s** | winning a fight must leave you vulnerable to the next one; this is the rhythm that makes chained engagements a skill instead of a formality |
| Regen rate | 35 HP/s (2.8 s to full) | **28 HP/s (3.9 s to full)** | same reason; total recovery 7.4 s vs 7.3 s SP — the *delay* is where the tension lives, so the split is moved toward the ramp |
| Regen reset | on any damage | **unchanged** | |
| Bot retreat regen | 24.5 HP/s | **unchanged** | Part 7 |

No health pickups, no armour, no perks. A player who won a fight at 20 HP and pushed is
making a real decision, and the enemy who catches them is being rewarded for map sense —
that interaction is worth more than any pickup economy.

### 4.3 Accuracy model deltas

| # | Change | From → To | Reason |
|---|---|---|---|
| B1 | `SPREAD_MODEL.steadyMult` | **0.55 → 1.00** | This is a **camping subsidy**. It grants a 45% accuracy bonus for standing still ≥0.4 s and not firing ≥0.45 s — precisely the behaviour PVP must not reward, and the exact behaviour the campaign's `camper` persona bar exists to punish (`BUILD_PLAN §5.4`). Removing it costs the campaign nothing because PVP has its own tuning table. |
| B2 | Recoil `jitter` | warden .12→**.08**, vesper .18→**.12**, corvus .10→**.06**, pike .15→**.10** | Against bots, jitter hides pattern repetition. Against humans it converts a learnable pattern (the whole point of `WARDEN_PATTERN`'s 16 rows + 4-row loop) into a dice roll. Pattern mastery is the primary skill expression a browser FPS can offer; jitter is its direct tax. Recovery rates, scale, and the patterns themselves are **unchanged** — the pattern stays hard, it stops being random. |
| B3 | Corvus `adsTime` | 340 → **380 ms** | The DMR must not win the peek-and-tap trade it currently wins against every other weapon's ADS time. |
| B4 | Corvus ADS settle | `FEEL.adsSettleS` 0.2 s → **0.35 s, Corvus only** | Taxes the quickscope-peek without a hard gate, exactly as `combat_spec §2.4` intends the settle to work. |
| B5 | **Scoped flinch ×2** | 0.12°/10 dmg (cap 0.5°) → **0.24°/10 dmg (cap 1.0°)** when `adsT ≥ 0.9` on Corvus | Currently the first hit in a long-range duel barely disturbs the return shot, so the DMR duel is decided by who fired first *and nothing else*. Doubling flinch **only while scoped** means landing the first hit at range actually wins the exchange. Hip and non-scoped flinch stay at the deliberately low `combat_spec §3.4` value — getting shot must not remove aim agency in a CQB fight. |
| B6 | **Scope glint** | new | A Corvus at `adsT ≥ 0.9` emits a small additive glint sprite visible to actors within its aimed ±12° cone beyond **35 m**. Cost: one pooled sprite, zero lights. This gives the map's strongest position its counterplay signal, and it is the one piece of information asymmetry the design *adds* deliberately — pointed the right way. |
| B7 | Hip spread, ADS spread, falloff, penetration, headshot multipliers | **unchanged** | The map band mix (§3.2) does this work. |
| B8 | Aim assist | **stays OFF** (`combat_spec §2.4`) — mouse only, no controller support in PVP v1 | Stated so nobody "helpfully" adds it. A magnetism value is a fairness cliff the moment two players have different input devices. |

### 4.4 Movement deltas

| # | Change | From → To | Reason |
|---|---|---|---|
| B9 | Tactical sprint duration | **4.0 s → 2.5 s**; recharge **2.5 s → 4.0 s** | 7.3 m/s crosses Lanternwalk end-to-end in 10 s. Near-permanent tac-sprint collapses every rotation timing the maps are built around, and it makes the spawn director thrash (a player can be 70 m from where the influence grid last saw them). Base sprint (6.4 m/s) is untouched. |
| B10 | Sprint-out times | **unchanged** (AR 210 / SMG 160 / DMR 290 / Pistol 130 ms) | This is the skill line that makes weapon choice matter, and it is the mechanic that punishes the rusher without touching a damage number. |
| B11 | Slide, mantle, bunny-hop | **unchanged** | Slide is "the MW2019 signature verb" (`combat_spec §1.4`) and its 1.6× spread multiplier already prices it. |
| B12 | **Hitstop: banned in PVP** | 45–60 ms dt-scale on kill → **0** | `visual_target §7` grants hitstop because "single-player, so free." In PVP it is not free: scaling sim dt desynchronises this client from every other one and steals aim agency from a player who may be in a second fight. Replaced with view-only feedback (kick + red kill-X + audio) at full strength — the feel is preserved, the dt is not touched. |
| B13 | Grenades per life | **2 → 1** (`cmd.grenade`, R6/v2.1a) | Two frags per life × 12 actors in a 74 × 56 m arena is a grenade fog. Body pickup restores up to a max of 2, so grenade economy becomes something you win rather than something you are issued. |
| B14 | Spawn protection | new: **1.5 s** | Part 2.5 |
| B15 | Friendly fire | **OFF** | With client-authoritative damage (E4) and bots on both teams, friendly fire is a griefing surface with no upside and no server to adjudicate it. |

### 4.5 What the deltas are gate-checked against

`sim.selftest.cjs` gains a `--pvp` battery asserting, THREE-free and deterministically:
every STK in the §4.1 table; that `steadyMult === 1.0` under PVP tuning; that no PVP TTK
falls below **220 ms**; that HP is 110 for every actor including bots (R16's no-HP-
inflation rule now applies *across teams* — a bot and a human have identical HP); and that
the SP table is bit-identical to the untuned `WEAPONS` export. That last assertion is the
one that keeps the fork honest.

---

## PART 5 — PROGRESSION + SOCIAL (what a match feels like, start to finish)

Guiding rule, from the brief: **no monetisation, no fake progression treadmill.** Nothing
is locked. There is no XP, no currency, no battle pass, no unlock tree, no attachment
grind. Every player has every weapon in every match, forever. What persists is a
scoreboard and, at most, a record — the fun has to come from the shooting, and if it does
not, a treadmill would only obscure that.

### 5.1 Lobby (0:00–0:30)

- Entry from the FFG menu: **QUICK MATCH** or **ROOM CODE** (4 characters, the existing
  `ffg:<gameId>:<code>` convention, E3).
- The lobby screen shows: map name + biome still (an in-engine capture, not key art —
  `visual_target §6` wants exactly this), mode, the two team columns with each slot marked
  **human** or **BOT** with a distinct glyph, and a plain-language honesty line:
  *"Casual match — simulated on players' own devices. Unranked."* (Part 6.3.)
- Host starts, or **auto-start 20 s after the second human joins**, or **immediately with
  bots** if the player chose "Play now." **A player is never made to wait for a lobby to
  fill.** A lobby that requires four humans is a lobby that never starts.
- Team assignment: humans balanced first (alternating), bots fill. Late humans replace the
  lowest-score bot on the smaller team (Part 7.4).

### 5.2 Loadout (during the lobby and on every death)

One screen, three rows:

- **Primary:** Warden / Vesper / Corvus.
- **Secondary:** Pike (fixed — it is the fast-swap finisher, and giving it a competitor
  would need a fifth weapon nobody has built).
- **Grenade:** frag ×1 (fixed).

That is the entire loadout. Changes made while dead apply on the next spawn; changes made
alive apply on the next death. **No attachments** — attachments are a progression treadmill
wearing a balance costume, and each one multiplies the tuning surface in §4 by the number
of combinations.

Cosmetics: team faction tint is assigned by team, not chosen (§3.1) — it is a readability
system, so it cannot be a preference.

### 5.3 In match

- **HUD:** the existing `core/hud/*` (A10) unchanged, plus four PVP elements, all built
  from existing HUD primitives and all obeying `visual_target §6` (one family, off-white
  + amber + reserved red, no neon):
  1. **Team score bar**, top-centre, above the compass tape: `US 41 — 38 THEM` plus the
     mode's clock. Foothold adds the zone name and its rotation countdown.
  2. **Killfeed**, top-right, 4 s rows, `<killer> <weapon glyph> <victim>` using
     `WEAPON_NAMES` display names (R4 — never internal ids). Own kills highlighted amber,
     own deaths red. Bots render with the bot glyph — **the feed never pretends a bot is
     a person.**
  3. **Objective marker** (Foothold/Blackline): the existing compass-tape pip system with
     distance in metres; the zone itself gets a low-opacity through-geometry ring.
  4. **Teammate pips**: friendly nameplates through geometry at ≤ 40 m, 45% opacity, no
     health bars. Enemies get **no nameplate at any distance** — enemy position is earned
     with eyes and ears, never granted by UI, and the net layer does not even send it
     (Part 6.2).
- **Scoreboard (hold TAB):** both teams, name, score, kills, deaths, and a ping column
  (round-trip on the DataChannel, or "relay" for a bridged peer). Bots are listed and
  marked. Held, not toggled — a toggled scoreboard is a wallhack-adjacent free look
  away from the game.
- **Death:** 1.2 s fade (the existing SP death path), then a **2.5 s death cam** framing
  the killer's last known position from the victim's body — built from the position the
  host already has, not from a replay stream. Then the respawn timer, then the loadout
  screen is available until spawn.

### 5.4 End of match (~15 s, then the lobby persists)

- 3 s: final score, winner banner, the existing mission-end audio stinger reused.
- 8 s: **one** summary table — per-player score/K/D/assists, and three named callouts drawn
  from real counters: **Most Kills**, **Best Streak**, **Most Zone Time** (Foothold) or
  **Most Plants/Defuses** (Blackline). No grades, no medals, no "MVP" score-fudging.
- 4 s: next map + mode announced from the rotation; the party stays together; anyone can
  leave without breaking the room (their slot becomes a bot mid-rotation).

### 5.5 Persistence — deliberately almost none

- **Local only** (`localStorage`): lifetime matches played, W/L, K/D, favourite weapon,
  best streak. Shown on the PVP menu. Clearable by the player.
- **No server-side stat writes.** Stated as a hard rule for a security reason, not a design
  one: FFG registry writes require the `service_role` key (memory:
  `reference_ffg_registry_service_key`), and **a browser PVP client must never hold a
  service key.** Any future leaderboard needs a server endpoint that does not exist today;
  until it does, leaderboards are out.
- Achievements: at most, reuse of the existing FFG achievement hooks for *participation*
  events (played a match, played all launch maps) that cannot be farmed by cheating. No
  performance achievements — see Part 6.3.

---

## PART 6 — FAIRNESS (the honest version)

### 6.1 What is actually true about this client

Stated plainly, because every mitigation below depends on it:

**There is no server. The client is authoritative over its own position, its own health,
and the hits it claims.** This is not a shortcut — it is the shipped FFG model (E4:
"the victim applies damage to itself (client authority over own HP)"), the transport is a
relay or a P2P mesh (E3), and the entire game is unminified ES modules served from R2
with an open dev-tools console.

Therefore, honestly:

| Exploit | Preventable? | Reality |
|---|---|---|
| Speed / teleport | **No** | The client integrates its own movement and reports the result. |
| Aimbot | **No** | Aim is local; the shooter reports the hit. |
| Wallhack / ESP | **No — but starvable** | Cannot be prevented by hiding code; *can* be defeated by not sending the data (§6.2). |
| Infinite HP / no-recoil / no-spread | **No** | All local state. |
| Fake hits on others | **Partly** | Host-side replay validation rejects the physically impossible ones (§6.3). |
| Spawn manipulation | **Yes** | The host owns spawn selection (Part 2). |
| Score/objective fabrication | **Yes** | Host owns score and objective state (§6.4). |

Anyone who tells the owner that a browser game with no server can be made cheat-proof is
wrong. The design goal is therefore not prevention. It is: **make the common exploits
detectable, make them pointless, and make an honest match the default experience.**

### 6.2 Starve the wallhack (the one exploit design can actually beat)

You cannot render what you were never sent. Every client applies **sender-side relevance
culling** before broadcasting its own state, using the shared, deterministic collider set
(E2 — every client computes identical `world.losBlocked` results because `layout.js` is
data and the version handshake in §6.5 guarantees the same data):

| Recipient's situation w.r.t. me | What I send them |
|---|---|
| Teammate | Full state, 15 Hz (teammate pips are a designed feature) |
| Enemy with LOS to me, or within **28 m** (audible-footstep range) | Full state, 15 Hz, full precision |
| Enemy without LOS beyond 28 m, but within 55 m | **Nothing** for ~500 ms after LOS breaks (the interpolation tail: a target that vanishes the instant it breaks LOS reads as a bug), then nothing |
| Enemy beyond 55 m, no LOS | Nothing |

Additionally, and separately: **coarse adjudication state to the host only** — position
quantised to **2 m** at **5 Hz**. The spawn director (Part 2) and the objective scorer need
enemy positions; a 2 m blob updated every 200 ms is sufficient for spawn scoring
(the smallest veto radius is 12 m) and near-useless as an ESP feed. This split is the
whole trick: the host gets what adjudication needs, and nobody — including the host —
gets a precise picture of an enemy they could not legitimately see.

Cost: one `losBlocked` call per remote peer per state tick, host-side plus client-side —
at 11 remote actors × 15 Hz that is 165 raycasts/s against an AABB set, well inside the
3 ms sim budget (the AI already runs comparable volumes, `combat_spec §5.7`).

**This does not stop a cheater with a modified client from cheating.** It stops them from
seeing anything they were not sent, which is what a downloaded ESP script actually does.

### 6.3 Detection: host-side invariant checks

The host validates every claim it receives. Nothing here *prevents* anything; each
produces a `suspicion` counter and a session log line, and the design's real remedy is
§6.4.

**Movement invariants** (from the coarse adjudication stream, which the cheater must also
send or be invisible to the spawn director — note the asymmetry: a client that suppresses
its adjudication stream can be *detected trivially* by its absence):
- Sustained horizontal speed > **8.5 m/s over a 1.0 s window** (max legitimate: 7.8 m/s
  slide entry, 7.3 m/s tac-sprint).
- Single-tick displacement > **12 m** (teleport).
- Position outside `colliders.bounds` or inside a solid AABB for > 0.5 s.
- Y above the map's max walkable + 3 m without a legitimate mantle/jump trace.

**Fire-rate invariants:** count `fire` events per weapon per second; reject and flag any
exceeding `rpm/60 × 1.15`.

**Hit-claim validation — the strongest check available**, and it works precisely because
the sim is THREE-free and deterministic (E2). For every `hitYou{target, dmg, weapon, isHead,
muzzle, t}`, the host independently replays:
1. **Rewind window:** reject if `t` is older than **300 ms** or in the future.
2. **LOS:** reject if `world.losBlocked(muzzle, targetPosAt(t))` is true and the shot
   claims no penetration (the penetration table is shared data, `combat_spec §3.2`).
3. **Distance/damage consistency:** reject if `dmg` differs from the falloff-computed value
   for that weapon at that range by > 5% (headshot multiplier included).
4. **Position plausibility:** reject if the claimed target position differs from the host's
   own history of that target at time `t` by > **1.5 m**.
5. **Rate:** reject claims exceeding the weapon's rpm (as above).

A rejected claim is dropped (the damage never lands) and counted. The **victim** runs
checks 1 and 4 as well, since the victim has the best record of its own history —
this is the one place where client authority works *for* fairness.

**What is deliberately NOT built:** code obfuscation, anti-debugger traps, bundle integrity
checks, or heuristic aim-analysis. Against a client whose full source ships to the
attacker, these are security theatre; they cost build time, break the harness, and catch
nobody who can read a stack trace.

### 6.4 Make cheating pointless (the actual mitigation)

The design decisions that matter more than every check above:

- **Nothing persistent is earned.** No ranks, no unlocks, no currency, no server-side
  leaderboard, no performance achievements (Part 5.5). **There is nothing to farm.** This
  is the single most effective anti-cheat measure available to this project, and it is
  free.
- **Rooms are the default social unit.** Room codes among friends is the mode where
  cheating is socially self-solving. Quick match is labelled honestly as unverified.
- **Host kick** (host-only, immediate) and **vote-kick** (majority of humans, 20 s
  cooldown, disabled below 3 humans so it cannot be a 2-person grief tool).
- **Local blocklist:** a player you blocked is never matched with you again on this device.
- **Suspicion is surfaced, not punished automatically.** At ≥ 5 rejected hit-claims or any
  movement invariant breach, the host posts one line to all humans: `<name> — inconsistent
  data (rejected claims: N)`. It does not auto-kick: a bad connection produces some of the
  same symptoms, and a false auto-kick is worse than a real cheater in a casual match.
- **Leaving is free and instant.** The strongest remedy the player has is the door; the
  design must never punish using it (no leaver penalty, no rank loss — there is no rank).

### 6.5 Determinism handshake (a fairness issue disguised as a bug class)

Every client must be running the *same* map data or the LOS checks, the spawn vetoes, and
the penetration results all disagree. On join, each peer sends `hello{version, mapId,
mapHash}` where `mapHash` is a cheap FNV-1a over `JSON.stringify(buildColliders(mapId).boxes)`.
**Any mismatch → the joiner is refused with a plain message** ("this match is running a
different version — refresh the page"). `version` is the existing `?v=N` marker
(`architecture §6`), which the harness already fingerprints. This also catches the real
and much more common case: a stale CDN copy after a deploy.

---

## PART 7 — BOT BACKFILL

**Design axiom: the match starts when the player presses Start. Always. With one human,
with three, with eight.** An empty browser lobby is the single most likely way this mode
dies, and the game already contains a complete, fairness-audited AI (A5: `nav.js`,
`perception.js`, `botfsm.js`, `squad.js`) that only needs to be told there is more than
one team.

### 7.1 Composition

- Target: **12 actors** (6v6); Blackline: **8 actors** (4v4); BOXCUT small-map Skirmish:
  **6 actors** (3v3).
- Bots fill every empty slot, rebalancing on every join and leave so the teams are never
  uneven by more than 1 actor.
- All bot brains run **on the host** inside `sim.step` — unchanged from the existing
  architecture (`architecture §3.5` tick order step 3), and unchanged from last-circle's
  proven model (E3: "the HOST simulates all bots"). Guests receive bots as remote actors
  in the host's state envelope and render them with the same `soldiers.js` path as remote
  humans.
- **Budget check:** worst case is one human + 11 bots. `architecture §8` budgets AI at
  ≤1.5 ms with 12 bots and ≤4 brains thinking per tick — the existing round-robin already
  sizes for exactly this. Best case (8 humans + 4 bots) is *cheaper* for the host's AI and
  more expensive for its network fan-out; the two worst cases do not coincide, which is
  fortunate and worth noting in the perf plan.

### 7.2 Difficulty

- Default band: **Regular** (`combat_spec §5.5`: 500–700 ms reaction, σ 0.022).
- Lobby setting: Recruit / Regular / Hardened. **Veteran is not offered in PVP.** Veteran's
  300–420 ms reaction with post-acquisition tracking beats the human median reaction
  (~250 ms choice-reaction under load) often enough that a bot kill stops reading as a
  fair loss — and "the bots feel like cheats" would poison the mode's reputation faster
  than any balance flaw.
- **No adaptive difficulty.** Rubber-banding a bot's reaction roll to a human's performance
  is invisible manipulation, and it breaks `combat_spec §5.6`'s roll-once-and-latch
  guarantee, which is the mechanism that makes the AI *feel* fair.
- R16 holds across teams: **bots have 110 HP in PVP, exactly like humans** (§4.5 asserts
  it). No damage multipliers, no HP inflation, in either direction.

### 7.3 What the AI actually needs (the E1 work)

This is the change list, in dependency order:

1. **Team field on every actor.** `sim.state.player.team`, `bots[].team`. Damage,
   perception, and targeting all consult it. (`core/sim/damage.js` — friendly fire off,
   §4.4 B15.)
2. **`perceive()` generalised from `S.player` to a target list.** Today
   `core/ai/perception.js:69` reads `const player = S.player`. It becomes: iterate enemy-team
   actors, run the existing awareness meter per candidate, keep the **highest-awareness**
   one as `bot.percept.target`, and retain the existing `lastKnown` / hearing semantics
   per target. Everything downstream (light factor, muzzle-flash awareness, stance
   modifiers) is already written against a generic actor and needs only the substitution.
   **This is the single largest sim change in the whole expansion.**
3. **Target switching hysteresis:** a bot does not swap targets unless the new candidate's
   awareness exceeds the current target's by **0.25** *or* the current target has been lost
   ≥ **2 s**. Without this, a bot in a 6v6 twitches between three targets and hits nothing —
   and worse, it re-rolls its reaction latch, which would violate §5.6.
4. **Squad director per team.** `squad.js` becomes two instances. The ≤2 fire tokens and
   ≤3 damaging attackers per 250 ms caps now apply **per human target**, not globally —
   the fairness constant that protects the campaign player must protect every human in
   the lobby. Bots attacking other bots are exempt from the token cap (they are not
   the audience).
5. **Objective behaviour** (Foothold/Blackline): the smallest possible addition — a mode
   supplies a `desiredPosition(bot)` that biases the existing cover-scoring function
   (`combat_spec §5.8`) by adding `+2.5 × inObjectiveBand(node)`. Bots do not get a new
   FSM state; they get a new reason to prefer certain cover. This keeps the entire audited
   fairness surface untouched.
6. **Spawn parity:** bots respawn through the *same* director (Part 2) with the *same*
   protection. A bot that spawns behind a human because "it's just a bot" is the fastest
   way to make the mode feel rigged.

### 7.4 Join, leave, and takeover

- **Human joins mid-match:** the lowest-scoring bot on the smaller team is removed and the
  human spawns fresh via the director (never inherits the bot's position — inheriting a
  bot mid-firefight is a free kill for whoever was shooting it). Joiner starts at 0 score,
  and the scoreboard marks them `joined in progress`.
- **Human leaves mid-match:** a bot brain attaches to their slot within 1.0 s at their last
  position, with 1.5 s of protection — last-circle's proven pattern (E3: "when a guest
  disconnects mid-match the host re-attaches a bot brain to that slot"). The match never
  pauses and never ends early.
- **Host leaves:** the lowest remaining peer id becomes host (existing `ffg_netplay`
  determinism, E3), re-bakes the influence grid, and re-attaches every bot brain. Score and
  objective state transfer in the last reliable snapshot; a **2 s "host migrating"** banner
  is honest and prevents the "why did the bots freeze" read.
- **Last human leaves:** the match ends immediately (no bot-only matches burning a
  Realtime channel).

---

## PART 8 — WHAT MUST GENERALIZE (architecture deltas + lane matrix)

PVP is mostly *new* modules plus **four** generalizations of existing ones. Listing them
as a build plan, because the size of the expansion is dominated by these four.

### 8.1 The four generalizations

| G | Change | Files | Size |
|---|---|---|---|
| **G1** | **Multi-map registry.** `buildLayout(seed)` → `buildLayout(mapId, seed)`; `buildColliders(mapId, seed)`; map modules under `core/level/maps/<id>.js` each exporting the frozen layout shape; Meridian Ward becomes `maps/meridian_ward.js` **unchanged**; `content.json` gains `maps{}` alongside `mission{}`. Every `nodes` key set becomes per-map (R24's 15 keys become Meridian Ward's set). | `core/level/*` (A3), `content.json` (A2) | **large** — it is a refactor of the file the whole build reads |
| **G2** | **Teams.** E1: `team` on every actor; `damage.js` friendly-fire gate; `perception.js` target list + hysteresis; `squad.js` per-team; per-target token caps. | `core/sim/damage.js`, `core/ai/*` (A1/A5) | **large** — the highest-risk change, because it touches the audited fairness surface |
| **G3** | **Tuning fork.** `core/pvp/pvp_tuning.js` + `createSim({tuning})`; `sim.selftest.cjs --pvp` battery. | new + `core/sim/sim.js` | small |
| **G4** | **Lighting profile.** `lightingProfile: 'campaign'\|'pvp'` consumed by `lighting.js`/`weather.js`; **fixed pool size unchanged** (R3). | `core/render/*` (A6) | small |

### 8.2 New lanes

| Lane | Files | Owns |
|---|---|---|
| **N1 — net-transport** | `core/net/session.js`, `core/net/mesh.js`, `core/net/envelope.js` (copies of `ffg_netplay.js` + `ffg_rtc.js` adapted per E3), `core/net/bridge_channel.js` | room/lobby, mesh, relay fallback, version+map handshake (§6.5), relevance culling (§6.2) |
| **N2 — match-rules** | `core/match/match.js`, `core/match/modes/{skirmish,foothold,blackline}.js` | host-authoritative score, timers, round state, win conditions |
| **N3 — spawn-director** | `core/match/spawns.js`, `core/match/influence.js` | Part 2 in full; THREE-free and Node-testable |
| **N4 — pvp-shell** | `core/hud/pvp_hud.js`, `core/hud/lobby.js`, `core/hud/scoreboard.js` | Part 5 UI, built on A10's existing primitives |
| **N5 — arenas** | `core/level/maps/<id>.js` ×6 + per-map content | one lane **per map** — carving is level design, not a config change |

Remote humans are **bot records with `brain:'net'`** — `soldiers.js`, `fx`, `audio`, and
`hud` then need no changes at all, exactly as last-circle's `netRemote` pattern works
(E3/E4). This is the design decision that keeps the blast radius small, and it should be
treated as binding.

### 8.3 Build order

1. **G2 + G3 + N3** against the *existing* map, verified headless (`sim.selftest.cjs`,
   `ai.selftest.cjs`) with **bots on two teams and no networking at all**. If 6v6
   bots-vs-bots on Meridian Ward is not fair and does not end, nothing after this matters.
2. **G1**, then **LANTERNWALK** (§3.3) as the first carve — proving the pipeline on
   geometry that already passed the critic bar.
3. **N1 + N2 + N4**: two humans, room code, Skirmish, Lanternwalk. **Done = two real
   browsers, two real players, a finished match** (doctrine: observed effect).
4. Scale the room 2 → 4 → 8, measuring the §1.0.1 budget at each step before proceeding.
5. **N5 ×3** (Hollowpine, Exchange, Spillway) as biome geometry lands, each with its own
   critic loop.
6. Foothold, then Blackline behind its gate (Part 9.3).

---

## PART 9 — ACCEPTANCE CRITERIA (PVP gates)

The v1 gates (`BUILD_PLAN Part 5`) all still apply — boot, perf, critic ship bar, ship
blockers. These are **additional**, and they are FAIL-class.

### 9.1 Per-map gates (headless, exit-code)

- `probe_props.mjs --map <id>` → exit 0 (zero floats/clips) — unchanged, per map.
- **Loop probe:** from every spawn point, a nav path exists to every other spawn point AND
  to every Foothold zone; no path traverses the same corridor cell twice (dead-end
  detector). Zero unreachable authored positions.
- **Balance probe (carve rule 3):** the four measurements — spawn-centroid distance ±8%,
  cover count ±15%, longest sightline ±10 m, per-zone rotation time ±2.0 s.
- **Spawn-point validity:** 30–50 points, all nav-walkable, ≥2.0 m clearance, ≥6 per
  cluster over ≥250 m², ≥8 m forward view.
- **Boundary probe:** every arena-edge collider has a visible mesh (no invisible walls) —
  raycast every 2 m along the boundary, assert a renderable within 0.5 m.

### 9.2 Per-map visual gate

The full `visual_target` scorecard, per map: **every dimension ≥ 8, mean ≥ 8.5, blind
verdict ≥ borderline from every critic**, ≥2 cold critics per iteration, 3 on the ship
decision (R28). Each arena needs its own 5-shot battery (S1 hip-fire, S2 ADS at the map's
longest band, S3 establishing wide, S4 material close-up, S5 elevated horizon) with fixed
seeds per R21.

**This is the schedule risk, stated plainly** (Part 10): four launch arenas is four critic
loops, and the plateau STOP rule (`BUILD_PLAN §5.6`) applies independently to each.

### 9.3 Mode gates

- **Bot-only battery** (no networking): 6v6 Skirmish on each map, 20 seeds — every match
  **ends**; `stuckBotSeconds == 0`; median `spawnStress` ≤ 0.5; **zero spawn deaths within
  2.0 s of spawning** across all seeds (this is the spawn director's actual pass/fail);
  team score differential distribution not skewed by side (|mean margin| < 8 kills over
  20 seeds, i.e. neither spawn cluster is the winning one).
- **Two-human battery:** a full Skirmish match completed on two real browsers, zero page
  errors both sides, killfeed/scoreboard parity (each client's scoreboard agrees with the
  host's within 1 event at match end).
- **Eight-human budget check:** measured Supabase message rate over a full match stays
  under **60 msg/s** (60% of the documented 100/s ceiling, E3) and the RTC mesh opens for
  ≥ 6 of 8 peers; stranded peers ≤ 2 (§1.0.1).
- **Blackline gate (its ship condition):** in the two-human and bot-fill batteries, median
  dead-time per round ≤ **35 s** and no round exceeds 1:45. If dead time is worse than
  that, Blackline ships in the update instead — with the mode unchanged, because the fix
  is map/rules tuning, not a redesign.

### 9.4 Perf gates (unchanged budgets, new worst case)

`architecture §8` numbers hold, measured in the new worst case: **12 actors visible,
6 shooting, PVP lighting profile, the map's densest space**. Two named risks:
`programs delta == 0` must survive faction-tint material variants (they must be *the same
material* with a uniform, not two materials — a second material is a permutation), and the
draw budget ≤ 320 median must survive Spillway's three-tier open geometry.

---

## PART 10 — RISKS (ranked)

1. **Four arenas × the critic ship bar.** The v1 map took a full critic loop to reach the
   bar; four more at the same bar is the largest single cost in the expansion, and the
   plateau rule can stop any one of them. *Mitigation:* Lanternwalk is carved from geometry
   that already passed (its D-scores start high); the other three inherit their biome's
   material and lighting work from the campaign; ship-wave the portfolio (4 + 2) rather
   than gating the release on six.
2. **G2 (teams) touches the audited fairness surface.** `perception.js` and `squad.js` are
   where the doctrine's fairness constants live; generalizing to N targets risks
   re-rolling latched reactions (§5.6) and breaking the token caps. *Mitigation:* target
   hysteresis (§7.3.3) is specified as part of the change, not left to implementation;
   `ai.selftest.cjs` extends its 30-seed fairness battery to a two-team world **before**
   any networking exists.
3. **NAT traversal without TURN.** E3 says it plainly: a blocked pair never opens.
   *Mitigation:* the bridge-channel fallback (§1.0.1) with a hard cap of 2, and an honest
   message for the third. *Residual risk accepted:* some players will not be able to play
   with some others. A TURN server is the only real fix and it is a paid, hosted
   dependency — flagged to the owner in Part 11, not assumed.
4. **Cheating in a public quick-match.** Unfixable (§6.1). *Mitigation:* nothing to farm,
   room codes as the default social unit, kicks, honest labelling. *Residual risk
   accepted, and the owner should know it before launch, not after.*
5. **G1 is a refactor of the file everything reads.** `layout.js` is the single source for
   colliders, nav, props, and probes (E2). *Mitigation:* Meridian Ward moves to
   `maps/meridian_ward.js` **byte-identical** in content; the refactor is done and gated
   (`probe_props`, contract gate, campaign selftests all green) **before** any new map
   exists, so a regression has exactly one cause.
6. **Actor cap vs. mode design.** 12 actors is an engine budget (E6), not a preference; if
   a map plays badly at 6v6 the answer is a smaller mode on that map, never a 14th actor.
7. **Foothold zone rotation vs. the spawn flip.** A zone arming near a team's home cluster
   can force a flip and a rotation simultaneously — potentially teleporting a team away
   from the point they were about to hold. *Mitigation:* V7's 15 m zone veto plus the
   `modeTerm` clamp at 25 m; needs live tuning and is explicitly on the playtest list.
8. **Victim-side lag on a 233 ms TTK.** Corvus is unchanged at 233 ms while the victim's
   lag budget can reach ~180 ms. *Mitigation:* the 300 ms rewind cap and 1.5 m position
   plausibility check bound the worst case; §4.3's B5/B6 give the *victim* of a DMR the
   counterplay that latency takes away.
9. **Draw calls on Spillway.** Three tiers, long sightlines, 12 actors. *Mitigation:*
   measured at §9.4 before that map ships; it is the map most likely to need a cut.

---

## PART 11 — OPEN QUESTIONS AND DEPENDENCIES

**Needed from the biomes designer [BIOMES]** — this document's map specs are written to
consume these and nothing else:

1. **Confirm the biome set.** This design assumes forest, office/interior, open-outdoor
   (dam/quarry), and industrial rail alongside the existing night-urban. If the campaign
   lands different biomes, maps 2–6 re-target with their lane specs intact; the carve
   doctrine (§3.0) is biome-independent by construction.
2. **Per biome, an arena-carvable locale** of at least the footprint in §3.2, with two
   spaces of genuinely different band (a long one and a tight one) and at least one
   two-storey structure.
3. **Collider `matClass` tags on biome-specific surfaces** — forest bark, office glass and
   partitions, dam grating. The penetration interactions (`combat_spec §3.2`) are free
   PVP texture and cost nothing, but only if the tags exist.
4. **Time-of-day per biome**, so the portfolio's no-two-maps-share-a-lighting rule (§3.2)
   can hold.
5. Confirmation that no biome depends on **moving geometry** (doors, lifts, water level) —
   §3.5 needs those to be static in PVP.

**For the owner:**

6. **TURN server, yes or no.** Without one, some peer pairs will never connect (risk 3).
   A TURN relay is a paid hosted dependency (this is a spend decision, so it is a gate, not
   a build task). The design works without it; it just excludes some players.
7. **Supabase Realtime quota headroom.** The free project quota is 2M msgs/month (E3), and
   this design pushes ~95% of traffic to P2P specifically to protect it — but the signalling
   and bridge-channel traffic is shared with every *other* FFG online game on the same
   project. Worth measuring before launch, and worth a line in the Bible.
8. **Blackline in the launch build or the first update** (§9.3's gate answers this
   empirically, but the owner may simply want a preference).
9. **Publish flip stays the owner's call**, per the established FFG rule — PVP does not
   change `game_meta.json` status.

**Not resolvable here:** whether PVP ships in the same release as the campaign expansion
or after it. This design is written so it can be either — G1–G4 are useful to the campaign
regardless (multi-map is a campaign requirement first), and everything else is additive.

---

*Design sign-off: every on-disk claim in Part 0 traces to a file read this session, and
each design decision that depends on one cites it. Where this stack cannot do something —
prevent cheating, carry eight peers on the relay, guarantee NAT traversal — it says so
rather than designing around a capability it does not have.*
