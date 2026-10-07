# R09: Bot AI for Lane-Brawlers (how bots can fill every seat in every Vale mode)

**Project:** VALE, an original live-service lane-brawler (modes per `package.json`: Rift 5v5, Bridge, Fray) [38]
**Stack assumed:** TypeScript sim + Three.js r186 client, Vite 8, Blender 5.2 to glTF art pipeline
**Date:** 2026-10-07
**Method and limits.** I confirmed facts with web search. Most primary pages (leagueoflegends.com, the LoL and Dota wikis, Valve's developer wiki, gameaipro.com, arXiv) are blocked by the egress proxy, so those claims rest on search-result excerpts and are cited to the page the excerpt came from. Two sources were read in full: the Open Hyper AI (OHA) Dota 2 bot project's docs and Lua source, fetched from raw.githubusercontent.com, and the npm registry. Partway through, the shared web-search budget for this run ran out. Anything I couldn't confirm after that is marked **[unverified]**. Timing numbers come from a micro-benchmark I ran locally (Appendix A) [39].

---

## 0. TL;DR

- **The two reference designs are close cousins.** Dota 2 bots score every mode on 0..1 each frame and run whichever scores highest. Separate tracks handle ability use, item use, and purchasing alongside the modes, and a team layer publishes *non-authoritative* push/defend/farm/roam/Roshan desires [14][16]. Since 14.6, LoL bots run on a new behaviour-tree framework with priority-ordered subtrees (fight, escape, move, jungle, buy, level up) [3][5].
- **What players notice is human-likeness, not raw skill.** Riot rebuilt its bots because players wanted bots that last-hit, use combos, and judge danger the way people do. An enemy who has just spent all their spells is a chance to attack, not a reason to run [4][6].
- **Difficulty in shipped games mostly comes down to reaction time plus economy cheats.** Dota's ability/item reaction delays run roughly 200-300 ms (Easy), 100-150 ms (Medium), 50-75 ms (Hard), and none on Unfair, which also gets +25% gold and XP [23]. LoL's Intermediate bots get vision and economy leaks: they can target you in brush for a few seconds after you were seen, and they keep their items even when starved of gold [2].
- **Recommendation for Vale:** a **hybrid utility system**. A team brain at 2 Hz publishes intents. Each bot picks a mode by utility at 5 Hz, with hysteresis. Each mode runs a small executor, and a combat-micro layer runs every 30 Hz tick for last-hits, orb-walking, casting, and dodging. Bots issue the **same commands a player can**. Difficulty comes from a perception-delay queue and error models, not stat cheats.
- **CPU fits easily if pathfinding is controlled.** For 15 bots, utility scoring took about 0.08 ms per full pass and a 64x64 influence-map rebuild about 0.4-0.5 ms. Grid A* on a 256x256 map ranged from about 0.4 ms to 4.5 ms per query depending on wall layout [39]. So paths must be **cached and budgeted**: precomputed flow fields for static destinations, plus A* capped at a node-expansion budget per tick.

---

## 1. League of Legends bots

### 1.1 Difficulty tiers

| Tier | What's documented |
|---|---|
| **Intro** | Bots stay locked in their fountain for the first few minutes. They are much slower to flee at low health and slower to use abilities. Historically they always played the same five champions (Nasus, Galio, Ryze, Alistar, Ezreal) [1]. That roster may predate the 14.6 rework **[unverified for 2026]**. |
| **Beginner** | Aimed at players still learning the basics [1]. |
| **Intermediate** | Meant to challenge low-to-mid-rated players [1]. They still get items when gold-starved, which suggests level-based or bonus gold. They use more advanced tactics: lane swaps, frequent ganks, and occasionally an early three-man push. They can target a player in brush for several seconds after the player was seen there. They try to dodge abilities while retreating and actively use Ignite, Heal, Exhaust, and Ghost, but rarely Teleport [2]. |

Across all tiers, bots historically did not jungle or take buffs, and they respawn faster than players [1].

### 1.2 Framework history and known behaviours

- Bots were fully rewritten in 2014. Even after that they supported only a subset of champions, and the lane setup was odd: two top laners and no jungler [5]. A bot AI update in April 2014 improved threat evaluation, added some skillshot dodging (based on enemy facing and recent cooldowns), and refreshed item builds [3].
- Riot's 2023 "/dev: Leveling Up Bots" post announced a dedicated bots team building a *scalable* bot system plus a designer tool suite. The aim was a lower-stress place to learn the game [5]. The first target was new intro bots with jungling, ganking, mutual support, role-correct runes and spells, and objective takes (dragons, Baron), trialled on PBE [8].
- **Patch 14.6 (2024)** shipped the new framework, built around more nuanced definitions and decision-making [3][7]. Excerpts describe it as a **behaviour tree** that checks the highest-priority actions first, grouped into subtrees for fighting, escaping, moving, jungling, buying items, and levelling spells [3][5]. Riot targeted last-hitting with autos (both farming and pushing), less predictable play, and better combos [3][4]. It also reworked how bots judge danger. The old bots measured threat by damage taken, which made them flee exactly when an enemy had just used everything up [4][6]. A press headline at launch said the bots "still can't jungle" [6], which conflicts with the earlier PBE promise [8]. Whether 2026 bots jungle well is **[unverified]**.
- **14.12** brought the new bots to Custom games. **14.18** started a bot trial in Normal queues for new and returning accounts, and **14.22** extended it to ARAM. As of January 2025, new and returning players could still find bots in some Normal lobbies during a calibration period [3].

### 1.3 2025-2026 bot changes (patch pages on the LoL wiki)

- **V25.16:** Anivia, Gragas, Janna, Karma, and Pantheon added to Co-op vs AI and Custom. Elise added to Co-op only. Six more champions added to Custom only [13].
- **V25.18:** bots can now dodge certain skillshots [9]. One search excerpt didn't find this line in the official patch notes, so treat the exact patch as wiki-sourced.
- **V25.24 to V26.04:** more champions added in batches (Udyr; Swain and Teemo; Fiddlesticks, Heimerdinger, Sion, Yunara, Zaahen) [11].
- **V26.06:** the Shyvana bot was removed because the champion was updated [12]. Gameplay updates break bot behaviour, and the fix was to pull the bot.
- **V26.08:** Kog'Maw bot added, and the Fizz bot now uses its ultimate more often [10].

**Lesson:** even Riot adds bot support champion by champion and removes bots when a kit changes [10][11][12][13]. A live-service game that ships heroes regularly needs bot support that is **data-driven per hero**, not hand-coded per hero, or bot coverage will always trail the roster.

---

## 2. The Dota 2 bot framework (public Lua API)

### 2.1 Three levels

Valve's bot scripting runs **server-side in Lua**. Scripts read game state and issue unit orders directly; there is no screen-reading or simulated clicking [14]. Decisions happen at three levels [14]:

1. **Team level.** How much the team wants to push, defend, or farm each lane, and how much it wants Roshan. These desires are explicitly **not authoritative**: they don't order anyone to do anything, and bots can use them as inputs.
2. **Mode level.** High-level goals each bot keeps re-evaluating. The highest-scoring mode is the active one.
3. **Action level.** Moment-to-moment orders such as move, attack, cast, or buy, roughly equivalent to a click or keypress.

### 2.2 Modes and how desires are chosen

- **Mode list:** none, laning, attack, roam, retreat, secret shop, side shop, push tower (top/mid/bot), defend tower (top/mid/bot), assemble, team roam, farm, defend ally, evasive maneuvers, Roshan, item, ward [16]. Runes are handled through rune-location queries and pickup actions [16].
- **Mode script hooks:** `GetDesire()` returns 0..1, `OnStart()` and `OnEnd()` fire on activation and deactivation, and `Think()` runs every frame while the mode is active. `GetDesire()` is evaluated **every frame for every mode**, the top value wins, and only the winner's `Think()` runs [16]. Returning `nil` falls back to Valve's built-in desire for that mode, so a script can override a single mode under specific conditions and leave the rest alone [16].
- **Desire bands:** NONE 0, VERYLOW 0.1, LOW 0.25, MODERATE about 0.4-0.5, HIGH about 0.6-0.75, VERYHIGH about 0.8-0.9, ABSOLUTE 1.0. The reference lists the middle bands as ranges [16].
- **Frame order:** team think, then each bot's mode desires, then the winning mode's `Think()`, then ability/item think [16].
- **Parallel tracks that ignore the active mode:** `AbilityUsageThink`, `ItemUsageThink`, `AbilityLevelUpThink`, `BuybackUsageThink`, `CourierUsageThink`, and a separate `ItemPurchaseThink` all run independently of the mode system [16]. In practice, "where am I going" (the mode) and "what am I casting" (ability use) are decided separately.
- **Team desire hooks:** `UpdatePushLaneDesires`, `UpdateDefendLaneDesires`, `UpdateFarmLaneDesires` (each returns top/mid/bot values), `UpdateRoamDesire` (desire plus target), and `UpdateRoshanDesire`. Individual bots read them back through getters [16].
- **Action queue semantics:** `Action_*` clears the queue and replaces it. `ActionPush_*` puts an action in front and resumes the old one afterwards. `ActionQueue_*` appends. Pathed moves are separate from straight-line moves, which can get stuck on terrain [16].
- **Prediction helpers the engine provides:** `GetExtrapolatedLocation(t)`; `GetMovementDirectionStability()` from 0 (erratic) to 1 (straight-line), documented as a cue for when to lead a skillshot; `FindAoELocation(...)`, which returns the best AoE centre and hit count with a time-ahead option; incoming tracking projectiles, each flagged attack-or-spell and dodgeable; attack point (wind-up) and projectile speed; and estimated damage to a target [16].

### 2.3 How a mature community script scores things (OHA)

OHA claims support for 127 heroes on patch 7.41/7.41a, deterministic position 1-5 lane assignment, and 10+ game modes [15]. Its source shows the practical shape of a desire system:

- **Retreat.** If the bot is below 30% HP, recently damaged by a hero, and facing two or more enemies, retreat desire is remapped from HP onto the HIGH..ABSOLUTE band. A list of protective buffs (death-delay effects and similar) forces retreat desire to zero [18]. Strength comparisons go through a `WeAreStronger(radius)` helper. It sums each side's power as roughly log(1 + offensive power) times the square root of attack damage times attack speed, scales by health, and **caches the result for 0.5 s** to save CPU [21].
- **Last-hitting.** "Will this hit kill?" compares the creep's HP plus regen over the delay (plus a small epsilon) against my damage after mitigation plus **damage already in flight** from other units' projectiles and attack swings landing within the delay [21]. The delay is my remaining wind-up, plus any leftover attack cooldown, plus projectile travel time, plus walk time if out of range [21]. If a creep is not killable yet but would be with about 1.7x my damage, the bot walks toward it to set up the hit [20]. Denies are attempted on allied creeps under 50% HP that one hit would kill [20].
- **Skillshot leading.** The aim point is blended between the target's current and extrapolated positions using the stability value. Low stability aims near the current position, and high stability aims at the full prediction [21].
- **Wards.** Only positions 4-5 ward. They pick the closest open spot from a precomputed list. They don't go if an enemy is closer to that spot than they are, and they drop warding during high-ground pushes or when enemies are at their own base. Ward desire is scaled by current HP [19].
- **Items.** Each hero has ordered buy lists per position, a sell list ("if you buy X, sell Y"), and a never-sell list. Finished items are decomposed into components through the engine's recipe query, and each component is bought at the correct shop [17]. Every active item has a per-item consideration function that returns desire, target, and cast type [17].
- **Drafting.** Each position has a pool of heroes weighted by role fit. Picks prefer heroes ranked strong against the enemies already chosen, using a matchup table. A per-team cap with an exponential penalty limits "weak" heroes, meaning heroes the AI plays badly. Bans and random fallbacks are included [22].
- **Harder difficulty.** The optional "FretBots" mode gives bots extra gold, XP, and stats that scale with difficulty [15][17].

### 2.4 Built-in difficulty levels

The API exposes PASSIVE, EASY, MEDIUM, HARD, and UNFAIR [16]. According to the Dota 2 wiki (via search excerpt) [23]:

| Level | Ability/item reaction | Other differences |
|---|---|---|
| Passive | **[unverified]** | Community descriptions say passive bots don't fight heroes aggressively **[unverified]** |
| Easy | 200-300 ms | |
| Medium | 100-150 ms | |
| Hard | 50-75 ms | |
| Unfair | none | Plays almost the same as Hard; **+25% gold and XP** [23] |

Community reports also say harder bots last-hit almost perfectly, and that easier bots escape ganks worse and stay in fights too long [24] **[unverified attribution]**.

**Lesson:** Valve's levels mostly change *reaction latency* and then *economy*. Decision quality barely changes between Hard and Unfair. Players can tell when difficulty is just a cheat. For PvP backfill, Vale should vary perception and execution, not stats.

---

## 3. Techniques from academia and industry

### 3.1 Choosing an architecture

- **Behaviour trees (BT)** are easy to read and debug, and Riot chose one for its 14.6 bots [3][5]. Their weakness is fixed priority order: "should I fight or farm?" needs weighed context, which you end up hand-tuning as a growing pile of conditions.
- **Utility AI** scores every candidate action with a set of considerations, each mapped through a response curve, and picks the best (or samples from the top few). Dave Mark's Infinite Axis Utility System is a standalone, data-driven utility architecture. He has presented it at the GDC AI Summit, including its use in Guild Wars 2: Heart of Thorns [25]. The GDC AI Summit has also run a talk on practical utility systems [26]. Dota's desire system is essentially a coarse utility selector over modes [14][16].
- **Machine learning.** Large deep-RL efforts have played full MOBA games (Tencent, Honor of Kings) [35] and drafted with neural networks plus Monte-Carlo tree search (JueWu-Draft) [34]. These are research-scale efforts. They don't fit a small studio's live-ops loop, where every patch would need retraining **[my assessment]**.
- **Recommendation:** utility for *choosing* (team intents, modes, targets, ability use) and small hand-written executors (tiny state machines or BTs) for *doing* the chosen thing. JS behaviour-tree libraries exist (`mistreevous` 4.3.1, updated 2025; `behaviortree` 3.0.0-beta.1) [36], but executors this small don't need a library.

**The utility-scoring problem to solve.** When you multiply N considerations together, the score shrinks as N grows, so actions with more considerations lose unfairly. A known fix adds back a share of the shortfall that grows with N. A common form is `mod = 1 - 1/N`, then `score += (1 - score) * mod * score` [unverified attribution to IAUS; the maths is simple]. The local benchmark uses this form [39].

### 3.2 Influence maps for threat and safety

Influence maps project each unit's presence and threat onto a grid so the AI can reason about *where*: tactical positioning, situation analysis, and targeting [27][28]. Mark's modular design builds separate layers (proximity of friend or foe, threat projected by friend or foe) and combines them per question, such as "where is safe and near my lane?" [27][28].

**For Vale:** keep a coarse grid (for example 64x64) per team with an *enemy threat* layer (DPS reach, including towers), an *ally support* layer, and a *vision/last-seen* layer that decays over time. Retreat targets, flank routes, ward spots, and "is this target bait?" become cheap lookups. One full rebuild with 87 stamped units cost about 0.4-0.5 ms locally [39].

### 3.3 Target selection

Neither reference publishes an exact formula. Riot's lesson is that *threat* should account for the enemy's **available** burst, not damage already dealt [4][6]. OHA's power comparison and in-flight damage tracking provide the inputs [21]. A workable score:

```
targetScore(t) =
    wKill   * killability(t)            // my + allies' burst available within ~1.5 s vs t's effective HP
  + wThreat * threatAvailable(t)        // t's burst/CC NOT on cooldown (observed casts)
  + wPrio   * rolePriority(t)           // carry/damage > tank, per hero tag
  + wFocus  * allyFocus(t)              // allies already hitting t (focus-fire bonus)
  - wPath   * pathCost(me, t)
  - wTower  * underEnemyTower(t)
  - wBait   * hiddenThreatNear(t)       // fog/last-seen layer around t
```

Re-score at about 10 Hz. Only switch targets when the new best beats the current one by a margin (for example +15%), so the bot doesn't flicker between targets.

### 3.4 Last-hit and minion damage prediction

Use the OHA approach [21], generalised:

```
impactTime   = remainingWindup + leftoverAttackCooldown + travel(dist, projSpeed) + walkTime(outOfRange)
predictedHP  = hp + regen*impactTime - Σ incomingHits(target) where hit.eta < impactTime
fire if  predictedHP > 0  (it isn't already dead)  and  predictedHP <= myDamageAfterMitigation
```

`incomingHits` includes projectiles in flight *and* melee swings past their wind-up whose damage lands before impact. The sim has exact data, so a bot could be perfect. **Difficulty should add timing noise** (Gaussian error on `impactTime`) and occasional skipped hits. Dota's hard bots are reported near-perfect at last-hitting [24], which is a clear sign of an inhuman bot.

### 3.5 Kiting and orb-walking

The attack cycle is wind-up (damage lands at the attack point), then backswing, then idle until the next attack [16][21]. Orb-walking means issuing a move right after the damage point and coming back in time for the next attack. Kiting is the same thing aimed away from the threat. **Kite when** the target is melee, my range advantage exceeds about one second of their movement, and my move speed is at least theirs. **Don't kite** when pushing a structure or when the target is already fleeing. At low difficulty, kite less often and add backswing slop.

### 3.6 Retreat thresholds

OHA's curve maps HP to retreat desire with clamps and overrides [18]. Riot found that HP-only or damage-taken triggers feel wrong [4][6]. A better trigger compares *time-to-death* with *time-to-safety*:

```
ttd   = effectiveHP / max(ε, incomingDPS_next2s)   // only enemy burst that is OFF cooldown
tts   = pathDist(me, nearestSafe) / mySpeed        // safe = threat layer below a threshold
retreatDesire = curve(tts + margin - ttd)  ⊕  curve(1 - hpFrac)  ⊕  outnumbered(alliesNear, enemiesNear)
```

`⊕` means combine with the utility compensation from §3.1. Disable retreat when a defensive buff is active, or when the team intent is "all-in" and the bot is the designated engager.

### 3.7 Focus fire

Team-level coordination is just target-score sharing: each bot publishes its current target, and `allyFocus` adds a bonus. To avoid every bot piling onto one target, which is unfun for humans, cap the bonus once enough burst is already committed to the kill: `committed > 1.2 × targetEHP` turns it negative.

### 3.8 Skillshot leading and dodging

- **Intercept:** solve `(|v_t|² - s²)t² + 2(d·v_t)t + |d|² = 0` for the smallest positive `t`. Here `d` is the relative position, `v_t` the target velocity, and `s` the projectile speed. Aim at `target + v_t*t`. If there's no positive solution, aim at the current position or hold fire [32][33].
- **Confidence:** weight the lead by movement stability. Dota exposes this directly [16], and OHA uses it in buckets [21]. Add a hit-chance gate: `p ≈ min(1, (projWidth + targetRadius) / (targetSpeed × (castTime + t)))`. Fire when `p` exceeds a per-difficulty threshold **[my heuristic]**.
- **Dodging:** LoL bots dodge skillshots while retreating (Intermediate) [2], and V25.18 widened skillshot dodging [9]. For Vale: on each tick, check hostile projectiles and telegraphs that intersect my predicted footprint before impact. If my *perceived* time (impact minus reaction delay) leaves enough room, sidestep perpendicular, toward the side with lower threat-layer values.

### 3.9 Objective timing and recall

- **Objectives:** Dota keeps Roshan desire as a team-level value [14][16]. In Vale, the team brain should track neutral-objective respawn timers, raise an "objective" intent 30-45 s before spawn, and size the commitment by `contestScore = powerAdvantage(near objective) + aliveDiff + enemiesSeenFarAway` **[design]**.
- **Recall:** raise recall desire when (HP or resource is low) or (gold covers the next build component), *and* no enemy is in threat range, *and* my wave isn't about to crash into my tower while I'm the only defender, *and* no objective spawns within about 40 s **[design]**.

### 3.10 Draft AI

- **What shipped bots do:** pools weighted by role fit, picks ranked against the enemy's choices, a cap on weak heroes, bans, and random fallback [22]. LoL bots pick role-appropriate loadouts [8].
- **Research:** JueWu-Draft treats drafting as a multi-round game. It combines neural value estimates with MCTS and accounts for long-term value across best-of-N series [34]. That's too heavy for Vale's bots, but the framing (score a pick by its effect on predicted win rate given both partial teams) applies.
- **For Vale:** `pickScore = roleNeed × roleFit + counterVsEnemies + synergyWithAllies + botCompetence + noise(temperature)`. The `botCompetence` term is a per-hero rating of how well *our AI* plays that hero, mirroring OHA's weak-hero cap [22]. It keeps bots off kits they play badly. The matchup and synergy tables start as designer-authored values and are later fitted from match telemetry.

### 3.11 Free-for-all (Fray) targeting heuristics

No source covers this; everything here is **[design]**:

- **Prefer the weakest reachable target**, weighted by killability and path cost.
- **Avoid getting third-partied:** subtract a penalty for each *other* hostile player within R of the planned fight. Also predict how long the fight will run: if `timeToKill > 3 s` and another player is approaching, back off.
- **Vulture bonus (Hard+ only):** finish low-HP players who are already busy fighting someone else.
- **No bot collusion:** bots treat other bots exactly like humans. Cap simultaneous bot aggression on any single human (for example at most 2 bots targeting the same human unless that human is the score leader) so FFA doesn't feel like a dogpile.
- **Mild leader bias:** a small bonus for targeting the current score leader keeps the match competitive.

---

## 4. Practical concerns: CPU budget and navigation

### 4.1 Measured costs (local micro-benchmark, indicative only) [39]

Node v22.22.0 on a 2.1 GHz Xeon vCPU. Typed arrays, binary-heap A*, 8-neighbour grid.

| Workload | Time |
|---|---|
| Utility pass: 15 bots × 14 actions × 6 targets × 6 considerations | **0.07-0.08 ms** |
| Influence-map rebuild, 64x64 grid, 87 units stamped (r=6) | **0.41-0.48 ms** |
| Separation steering, O(n²), 115 agents | **0.025-0.03 ms** |
| Grid A*, 256x256, random 18% clutter (avg 1.8k nodes expanded) | **0.42 ms/query** |
| Grid A*, 256x256, serpentine walls (avg 24k nodes expanded) | **4.5 ms/query** |
| Flow-field integration, 256x256, 4-neighbour BFS | **1.6-2.3 ms/field** |

**Takeaways.** At 30 Hz a tick lasts 33.3 ms. Decision logic is almost free. **Pathfinding is the risk:** a few unlucky A* queries in one tick can use the whole AI budget. Spatial queries ("enemies within R") need a spatial hash shared with the sim, not O(n²) scans per bot.

### 4.2 Budget plan (15 bots, 30 Hz)

- **Target:** AI at most about 3 ms average and 6 ms p99 per tick in a browser on mid-range hardware. Offline/practice runs the sim in a Web Worker so the Three.js render thread isn't affected; online play runs the bots inside the server sim **[design]**.
- **Stagger cadences** so work is spread evenly across ticks:

| Layer | Rate | Staggering |
|---|---|---|
| Team brain | 2 Hz (every 15 ticks) | teams offset by 7 ticks |
| Mode selection (utility) | 5 Hz (every 6 ticks) | `botIndex % 6`, so 2-3 bots per tick |
| Target and ability considerations | 10 Hz (every 3 ticks) | `botIndex % 3` |
| Influence maps | 10 Hz | one team per tick, alternating |
| Combat micro (last-hit trigger, orb-walk, dodge) | 30 Hz | O(1) per bot using cached data |
| Path service | every tick | **budget: 4,000 node expansions per tick**, FIFO with priority for retreat |

- **Cache with time-to-live,** as OHA does with its 0.5 s strength cache [21]: power comparisons, nearby-unit lists, and lane-front positions.

### 4.3 Navigation

- **Static destinations go on precomputed flow fields.** Flow-field tiles were built to move very large crowds without rebuilding a path per agent (Supreme Commander 2's hybrid of sector-level pathing and per-tile flow fields) [29]. Vale's common destinations are few and fixed: lane waypoints for each team, fountains, objective pits, shop. Bake about 20 fields at map load (about 50 ms total from §4.1) and store each as a `Uint8Array` direction grid (64 KB at 256x256).
- **Dynamic destinations** (chasing a hero, reaching a ward spot) use **budgeted A*** with an octile heuristic. Run it on a coarse grid (cells of about 0.5-1 hero radius) with string-pulling, and re-plan only when the target has moved more than a threshold.
- **Crowding:** RVO and ORCA have each agent assume the others also avoid collisions. That gives oscillation-free local avoidance for hundreds of agents in real time [30][31]. The RVO2 reference library is Apache-2.0 [31]. For heroes and minions in lanes, a lightweight ORCA-style velocity solve, or plain separation steering (0.03 ms for 115 agents [39]), covers it. Minions can share one flow field per lane and only need separation.
- **Navmesh option:** if the map needs non-grid walkable areas (bridges, ramps), `navcat` is a pure-JS, tree-shakeable navmesh library with crowd-simulation, flow-field, and *custom glTF navmesh* examples [37], currently v0.4.1 [36]. `recast-navigation` (0.43.1) and `@recast-navigation/three` (0.43.1) wrap Recast/Detour for JS and Three.js [36]. `three-pathfinding` (1.3.0) is a lighter navmesh toolkit [36]. `yuka` (0.7.8) is a full JS game-AI library, but its npm metadata hasn't changed since 2022 [36], so use it as a reference rather than a dependency.
- **Blender tie-in (you have Blender 5.2 on the PC):** author a separate low-poly *walkable / blocker* layer in the landmark `.blend` files (for example a collection with a `NAV_` prefix), export it with the glTF, and bake it to the sim's grid (or a navcat mesh [37]) in `tools/build_content.ts`. The bot nav and the art then can't drift apart.

### 4.4 Determinism and testing

- Bots must use the sim's seeded RNG and sim time, never `Math.random` or wall-clock time, so replays and server/client sims reproduce bot decisions **[design]**.
- Add a **headless bot-vs-bot soak** to the existing `npm run probe` harness [38]. Run N accelerated matches per mode and assert ranges for last-hit %, deaths per minute, objective participation, and match length. Fail CI when a content change, such as a new hero kit, breaks bot play. Riot pulling the Shyvana bot after her update shows this failure is real [12].

---

## 5. Recommended architecture for Vale

### 5.1 Layers

```
 ┌───────────────── TEAM BRAIN (2 Hz, per team; FFA: none) ─────────────────┐
 │ reads TeamKnowledge → publishes non-authoritative Intents:               │
 │ laneAssignments, pushDesire[lane], defendDesire[lane], objectiveIntent,  │
 │ groupPoint, gankTarget, recallWindow                                     │
 └──────────────────────────────────────────────────────────────────────────┘
                 │ intents (bonuses, never orders)
 ┌───────────────┴────────── BOT BRAIN (per bot) ───────────────────────────┐
 │ Perception (delayed by reaction profile) → Blackboard                     │
 │ ModeSelector (5 Hz utility + hysteresis)  → active Mode executor          │
 │ CombatMicro (30 Hz): target pick @10 Hz, ability considerations @10 Hz,   │
 │   last-hit trigger, orb-walk, dodge reflex                                 │
 │ Economy track (event-driven): buy, level-up, sell                         │
 └──────────────────────────────────────────────────────────────────────────┘
                 │ Commands (identical to player input)
 ┌───────────────┴────────── MOTOR / NAV SERVICE ───────────────────────────┐
 │ flow-field lookup | budgeted A* | ORCA-lite/separation | path smoothing   │
 └──────────────────────────────────────────────────────────────────────────┘
```

This keeps Dota's three levels [14] and its split between modes and parallel think tracks [16], with LoL-style small subtrees as executors [3][5].

### 5.2 Pseudo-structures (original design, not taken from any game)

```ts
// ---------- Difficulty is perception + execution, not stats ----------
type DifficultyProfile = {
  id: 'sprout' | 'easy' | 'normal' | 'hard' | 'expert';
  reactionMs: [min: number, max: number];   // perception delay sampled per stimulus
  decisionHz: number;                       // mode re-eval rate (cap 5)
  aimErrorDeg: number;                      // σ on skillshot heading
  leadSkill: number;                        // 0..1 weight on intercept vs current pos
  dodgeChance: number;                      // prob. a perceivable telegraph is dodged
  lastHitTimingSigmaMs: number;             // noise on impactTime estimate
  kiteSkill: number;                        // 0..1 prob./quality of orb-walk
  commitBias: number;                       // >0 = stays in fights too long (Dota-like easy) 
  focusDiscipline: number;                  // 0..1 how much allyFocus matters
  knowsCooldowns: boolean;                  // tracks observed enemy cooldowns
  fogHonest: true;                          // never reads hidden units (PvP fill)
  econMultiplier: 1;                        // >1 allowed ONLY in labelled PvE challenge
};

// ---------- What a bot believes (may be stale; that's the point) ----------
type Blackboard = {
  self: { pos: Vec2; hp: number; ehp: number; res: number; gold: number; cds: Record<AbilityId, number> };
  visibleEnemies: PerceivedUnit[];          // released from perception queue after reactionMs
  lastSeen: Map<PlayerId, { pos: Vec2; t: number }>;   // decays into fog layer
  enemyCooldownsObserved: Map<PlayerId, Record<AbilityId, number>>;
  incomingThreats: Threat[];                // projectiles/telegraphs perceived
  laneFront: Record<LaneId, number>;
  teamIntent: TeamIntent | null;            // null in Fray
  currentTarget: UnitId | null;
  cache: TTLCache;                          // e.g. powerCompare(radius) for 0.5 s
};

// ---------- Utility building blocks (data-driven, lives in content catalog) ----------
type Curve = { kind: 'linear'|'logistic'|'quadratic'|'step'; m: number; k: number; b: number; c: number };
type Consideration = { input: InputKey; curve: Curve };        // InputKey e.g. 'hpFrac','ttdOverTts','allyFocus'
type ModeDef = {
  id: ModeId;                                // LANE, FARM, PUSH, DEFEND, ROAM, GROUP, OBJECTIVE,
                                             // FIGHT, RETREAT, RECALL, SHOP, WARD, HUNT, SCAVENGE
  weight: number;                            // band like Dota's LOW..ABSOLUTE
  considerations: Consideration[];
  minDurationMs: number;                     // hysteresis floor
  commitBonus: number;                       // added while active, decays
  intentBonus?: (i: TeamIntent) => number;   // how team intents tilt this mode
  executor: ExecutorId;                      // small FSM/BT that issues Commands
};

// ---------- Per-hero bot data so new heroes ship bot-ready ----------
type AbilityHint = {
  ability: AbilityId;
  use: ('finisher'|'engage'|'escape'|'peel'|'waveclear'|'poke'|'buff'|'zone')[];
  targeting: 'unit'|'point-skillshot'|'point-aoe'|'self'|'direction';
  minTargets?: number;                       // for AoE (cf. Dota FindAoELocation)
  comboAfter?: AbilityId[];                  // sequencing hints
  riskTag?: 'gap-close-in'|'gap-close-out';
};
type HeroBotData = {
  roleFit: Record<RoleId, number>;           // drives draft
  botCompetence: number;                     // 0..1 how well OUR AI plays it (cf. OHA weak cap)
  abilityHints: AbilityHint[];
  levelOrder: AbilityId[];
  builds: Record<RoleId, { core: ItemId[]; swaps: { when: CompTag; replace: ItemId; with: ItemId }[]; sell: [ItemId, ItemId][] }>;
};

// ---------- Team brain output ----------
type TeamIntent = {
  laneAssign: Record<BotId, LaneId | 'roam'>;
  push: Record<LaneId, number>; defend: Record<LaneId, number>;
  objective?: { id: ObjectiveId; rallyPoint: Vec2; at: SimTime; commit: number };
  groupPoint?: Vec2; gankTarget?: PlayerId; recallWindow?: [SimTime, SimTime];
};

// ---------- Commands: same surface as human input ----------
type Command =
  | { t: 'move'; to: Vec2 } | { t: 'attack'; unit: UnitId } | { t: 'attackMove'; to: Vec2 }
  | { t: 'cast'; ability: AbilityId; unit?: UnitId; at?: Vec2 } | { t: 'stop' }
  | { t: 'buy'; item: ItemId } | { t: 'levelUp'; ability: AbilityId } | { t: 'recall' } | { t: 'ping'; kind: PingKind; at: Vec2 };
```

### 5.3 Per-tick scheduler (pseudocode)

```
onSimTick(tick):
  spatialHash = sim.spatialHash                      // shared, built by sim
  if tick % 3 == teamPhase: rebuildInfluence(team)   // threat / support / fog layers
  if tick % 15 == teamOffset[team]: teamBrain.update(team)  // FFA skips
  for bot in bots:
    bot.perception.release(tick)                     // stimuli older than reactionMs become visible
    if (tick + bot.idx) % 6 == 0: bot.selectMode()   // utility + hysteresis
    if (tick + bot.idx) % 3 == 0: bot.pickTarget(); bot.considerAbilities()
    bot.micro(tick)                                  // last-hit, orb-walk, dodge (cheap)
    bot.mode.executor.step(bot)                      // may enqueue path requests
  pathService.run(budgetNodes = 4000)                // retreat requests first
  for bot in bots: sim.submit(bot.drainCommands())   // same queue as players
```

**Mode selection with hysteresis:**

```
selectMode():
  for m in allowedModes(gameMode):
    s = m.weight * compensate(Π curve_i(input_i))
    s += m.intentBonus(teamIntent) + (m == active ? decayingCommitBonus : 0)
  best = argmax s
  if best != active and (now - activeSince < active.minDuration) and s_best < s_active + 0.1: keep active
  else switch (OnEnd/OnStart semantics like Dota)
```

### 5.4 Mode sets per Vale game mode **[design; confirm against mode specs]**

| Mode | Rift 5v5 | Bridge | Fray (FFA) |
|---|---|---|---|
| LANE / PUSH / DEFEND | yes (per lane) | yes (single lane) | no |
| FARM | if jungle exists | no | camps or pickups → SCAVENGE |
| ROAM / GROUP | yes | GROUP only | no |
| OBJECTIVE | yes | if any | contested pickups |
| FIGHT / RETREAT | yes | yes | yes (§3.11 heuristics) |
| RECALL / SHOP | yes | depends on shop rules | depends |
| WARD | if vision items | no | no |
| HUNT | no | no | yes |

### 5.5 Proposed difficulty tiers

Reaction ranges are chosen so they line up with Dota's published tiers [23]. Everything else is a proposal to tune with playtests.

| Tier | Reaction ms | Aim σ | Lead | Dodge | LH σ ms | Kite | Notes |
|---|---|---|---|---|---|---|---|
| Sprout (Intro-like) | 600-900 | 12° | 0.2 | 0.05 | 180 | 0 | Late leave from base, like LoL Intro [1]; no ganks |
| Easy | 300-450 | 8° | 0.5 | 0.2 | 120 | 0.2 | Higher commit bias (stays in bad fights) |
| Normal | 180-280 | 5° | 0.75 | 0.45 | 70 | 0.5 | Uses team intents, focus fire |
| Hard | 110-170 | 3° | 0.9 | 0.65 | 40 | 0.8 | Tracks enemy cooldowns, objective timing |
| Expert | 70-110 | 2° | 1.0 | 0.8 | 25 | 0.95 | Still fog-honest; no economy bonus in PvP |

---

## 6. Implications for Vale

1. **Use a hybrid utility architecture.** A 2 Hz team brain publishes intents that never override bots (as in Dota [14]). A 5 Hz utility mode selector with minimum durations and commitment bonuses avoids Dota's every-frame argmax flicker. Small executors handle each mode, and a 30 Hz micro layer handles combat. Don't put the whole game into one behaviour tree.
2. **Bots send player commands, nothing more.** The same command queue, the same cooldowns, and fog-honest perception, as Dota scripts issue unit orders [14]. That makes bots valid seat-fillers and disconnect replacements, and lets them run identically on server or client.
3. **Make difficulty about humanness, not cheats.** Use a perception-delay queue, aim and timing noise, dodge probability, and kiting skill. Keep economy multipliers (as in Dota's Unfair +25% [23] and FretBots [15]) to clearly labelled PvE challenge modes only. Never use LoL-style brush-vision leaks [2] in PvP fill.
4. **Model threat the way players do.** Count the enemy's *available* burst and CC, from observed cooldowns, not damage already taken. This is exactly where Riot's old bots failed [4][6]. Retreat on time-to-death vs time-to-safety, not raw HP.
5. **Ship per-hero bot data in the content catalog** (`HeroBotData`: role fit, AI competence rating, ability-use tags, combo order, level order, builds with conditional swaps, sell pairs) and validate it with the existing zod schemas. Generic executors read the tags, so a new hero is bot-playable on day one. LoL still adds bots champion by champion and pulls them when kits change [10][11][12][13]; this avoids that.
6. **Last-hitting:** predicted HP at impact, including damage already in flight (OHA pattern [21]), with per-tier timing noise. Avoid perfect last-hits; reports of near-perfect last-hitting are the clearest sign of an unfair bot [24].
7. **Skillshots:** use the intercept quadratic [32][33], weighted by movement stability (as Dota and OHA do [16][21]), and only fire above a hit-chance threshold. Add a reaction-gated sidestep for dodging (LoL added dodging in 2025 [9]).
8. **Draft by roles and competence:** score picks on role need × role fit + counters + synergy + `botCompetence`, sampled with a per-tier temperature, plus a cap on "weak for our AI" heroes (OHA pattern [22]). Bans come from telemetry. Fray drafts ignore roles and favour variety.
9. **Fray (FFA):** target the weakest reachable player, penalise fights other players can reach (third-party risk), allow the vulture bonus only on Hard+, never let bots collude, and cap how many bots can target the same human.
10. **CPU budget:** AI at most about 3 ms average per 30 Hz tick for 15 bots. Stagger cadences (team 2 Hz, modes 5 Hz, targets 10 Hz, micro 30 Hz). Use the sim's spatial hash and TTL caches. **Pathfinding needs a hard budget:** flow fields precomputed at load for static destinations [29], and A* limited to about 4k node expansions per tick, since serpentine layouts cost about 4.5 ms per query locally [39].
11. **Navigation stack:** a hand-written grid A* plus flow fields (small and deterministic) and ORCA-lite or separation for crowding [30][31]. Consider `navcat` (pure JS, glTF navmesh examples) only if Rift geometry needs a real navmesh [36][37]. Use `yuka` as reading material, not a dependency [36].
12. **Blender pipeline:** add a `NAV_` walkable/blocker collection to landmark `.blend` files. Export it with the glTF and bake it to the sim grid in `tools/build_content.ts` so art and bot nav can't drift.
13. **Testing:** run headless bot-vs-bot soaks in `npm run probe` with metric ranges per mode (last-hit %, deaths per minute, objective participation, match length), and run them on every hero or kit change.
14. **Label bots in live service.** Riot publicly announced its bot trials for new accounts in Normal and ARAM queues [3]. Vale should show bot seats as bots on the scoreboard and exclude them from ranked results. That protects player trust, and it's cheap.

---

## 7. Open questions and unverified items

- What exactly Dota's *Passive* tier does, and Valve's own wording for per-difficulty behaviours: **[unverified]**. The primary wiki pages were blocked.
- Whether 2026 LoL bots jungle competently (2023 PBE promise [8] vs launch coverage [6]): **[unverified]**.
- The exact IAUS compensation formula attribution: **[unverified]**.
- OpenAI Five specifics were not verified (the search budget ran out), so they're left out on purpose.
- Vale's mode specs (Bridge and Fray player counts, jungle, shops, vision items) aren't in the repo yet. Table 5.4 is conditional on them.

---

## Appendix A. Benchmark method [39]

A single-file Node ESM script run with Node v22.22.0 on a 4-vCPU Intel Xeon at 2.10 GHz, 2026-10-07. Typed-array 256x256 grid. A* uses a binary heap and generation-stamped open/closed sets, with an octile heuristic over 8 neighbours, averaged over 400 random far pairs. The flow field is a 4-neighbour BFS integration from a random goal, averaged over 100 runs. The influence map is a 64x64 grid with 87 units stamped at r=6 with linear falloff. The utility pass is 15×14×6 actions with 6 logistic considerations each, early-out, and compensation. Separation is O(n²) over 115 agents. There are two map variants: 18% random clutter, and long serpentine walls every 32 rows. Results are indicative only; browsers on low-end laptops can be 2-4x slower **[unverified]**.

---

## Sources

1. LoL Wiki (Fandom), *Co-op vs. AI*: https://leagueoflegends.fandom.com/wiki/Co-op_vs._AI
2. League of Legends Wiki, *Co-op vs. AI*: https://wiki.leagueoflegends.com/en-us/Co-op_vs._AI
3. League of Legends Wiki, *Bots* (framework history, 14.6/14.12/14.18/14.22, 2025 trial, 2014 update): https://wiki.leagueoflegends.com/en-us/Bots (also https://leagueoflegends.fandom.com/wiki/Bots)
4. Riot Games, */dev: New Bot AI, Oh My! (coming 14.6)*: https://www.leagueoflegends.com/en-us/news/dev/dev-new-bot-ai-oh-my-coming-14-6/
5. Riot Games, */dev: Leveling Up Bots*: https://www.leagueoflegends.com/en-us/news/dev/dev-leveling-up-bots/
6. PCGamesN, "Riot have deployed 'more human-like' bots in League of Legends - but they still can't jungle": https://www.pcgamesn.com/leagueoflegends/riot-have-deployed-more-human-bots-league-legends-they-still-cant-jungle
7. Altchar, "Riot introduces new AI bots in League of Legends, coming in LoL Patch 14.6": https://www.altchar.com/game-news/riot-introduces-new-ai-bots-in-league-of-legends-coming-in-lol-patch-14.6-aWxJD5E97BPd
8. RiftFeed, "LoL: Practice Bots Are Ready And They'll Jungle Better…": https://riftfeed.gg/lol-news/lol-practice-bots-are-ready-and-theyll-jungle-better-than-you
9. League of Legends Wiki, *V25.18*: https://wiki.leagueoflegends.com/en-us/V25.18
10. League of Legends Wiki, *V26.08*: https://wiki.leagueoflegends.com/en-us/V26.08
11. League of Legends Wiki, *V26.04* (with V26.03, V25.24 listings): https://wiki.leagueoflegends.com/en-us/V26.04 ; https://wiki.leagueoflegends.com/en-us/V26.03 ; https://wiki.leagueoflegends.com/en-us/V25.24
12. League of Legends Wiki, *V26.06*: https://wiki.leagueoflegends.com/en-us/V26.06
13. League of Legends Wiki, *V25.16*: https://wiki.leagueoflegends.com/en-us/V25.16
14. Valve Developer Community, *Dota Bot Scripting*: https://developer.valvesoftware.com/wiki/Dota_Bot_Scripting
15. forest0xia, *dota2bot-OpenHyperAI* README: https://github.com/forest0xia/dota2bot-OpenHyperAI
16. OHA, *docs/BOT_API_REFERENCE.md* (Valve bot API reference): https://github.com/forest0xia/dota2bot-OpenHyperAI/blob/main/docs/BOT_API_REFERENCE.md
17. OHA, *docs/ARCHITECTURE.md*: https://github.com/forest0xia/dota2bot-OpenHyperAI/blob/main/docs/ARCHITECTURE.md
18. OHA, *bots/mode_retreat_generic.lua*: https://github.com/forest0xia/dota2bot-OpenHyperAI/blob/main/bots/mode_retreat_generic.lua
19. OHA, *bots/mode_ward_generic.lua*: https://github.com/forest0xia/dota2bot-OpenHyperAI/blob/main/bots/mode_ward_generic.lua
20. OHA, *bots/mode_laning_generic.lua*: https://github.com/forest0xia/dota2bot-OpenHyperAI/blob/main/bots/mode_laning_generic.lua
21. OHA, *bots/FunLib/jmz_func.lua* (WillKillTarget, GetAttackProDelayTime, GetCorrectLoc, WeAreStronger): https://github.com/forest0xia/dota2bot-OpenHyperAI/blob/main/bots/FunLib/jmz_func.lua
22. OHA, *bots/hero_selection.lua*: https://github.com/forest0xia/dota2bot-OpenHyperAI/blob/main/bots/hero_selection.lua
23. Dota 2 Wiki (Fandom), *Bots* (difficulty reaction times, Unfair +25% gold/XP; via search excerpt): https://dota2.fandom.com/wiki/Bots
24. Steam Community, "What's the difference between Hard and Unfair bots?" and related threads: https://steamcommunity.com/app/570/discussions/0/558751813247122865 ; https://steamcommunity.com/app/570/discussions/0/616187204086235983
25. Dave Mark / Intrinsic Algorithm, *Infinite Axis Utility System*: https://gameai.com/iaus.php
26. GDC Vault, *AI Summit: Practical Utility*: https://gdcvault.com/play/1034572/AI-Summit-Practical-Utility
27. Dave Mark, "Modular Tactical Influence Maps," *Game AI Pro 2*, Ch. 30: https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter30_Modular_Tactical_Influence_Maps.pdf
28. Dave Mark, *Modular, Scalable Influence Map System*: https://gameai.com/imap.php
29. Elijah Emerson, "Crowd Pathfinding and Steering Using Flow Field Tiles," in *Game AI Pro 360: Guide to Movement and Pathfinding*: https://www.routledge.com/products/9780367151133
30. van den Berg, Lin, Manocha, *Reciprocal Velocity Obstacles for Real-Time Multi-Agent Navigation*: https://gamma.cs.unc.edu/RVO/
31. UNC GAMMA, *RVO2 Library (ORCA)*: https://gamma.cs.unc.edu/RVO2/ ; source: https://github.com/snape/RVO2
32. "Predictive Aim Mathematics for AI Targeting," Game Developer (author not verified): https://www.gamedeveloper.com/programming/predictive-aim-mathematics-for-ai-targeting
33. Bugnet, "How to fix Unity predictive aim lead on a moving target" (intercept quadratic): https://bugnet.io/blog/how-to-fix-unity-predictive-aim-lead-on-a-moving-target ; GameDev.net "Shooting At Stuff": https://www.gamedev.net/tutorials/programming/math-and-physics/shooting-at-stuff-r3884
34. Chen et al., "Which Heroes to Pick? Learning to Draft in MOBA Games with Neural Networks and Tree Search" (JueWu-Draft): https://arxiv.org/abs/2012.10171
35. "Towards Playing Full MOBA Games with Deep Reinforcement Learning," NeurIPS 2020: https://proceedings.neurips.cc/paper/2020/hash/06d5ae105ea1bea4d800bc96491876e9-Abstract.html
36. npm registry (queried 2026-10-07 via `npm view`): https://www.npmjs.com/package/navcat (0.4.1) ; https://www.npmjs.com/package/recast-navigation (0.43.1) ; https://www.npmjs.com/package/@recast-navigation/three (0.43.1) ; https://www.npmjs.com/package/three-pathfinding (1.3.0) ; https://www.npmjs.com/package/pathfinding (0.4.18) ; https://www.npmjs.com/package/yuka (0.7.8, modified 2022-09-17) ; https://www.npmjs.com/package/mistreevous (4.3.1, modified 2025-07-24) ; https://www.npmjs.com/package/behaviortree (3.0.0-beta.1)
37. isaac-mason, *navcat* README (pure JS navmesh; crowd simulation, flow-field and custom glTF navmesh examples): https://github.com/isaac-mason/navcat
38. Vale repo, `games/vale/package.json` (mode names; `probe` and `content` scripts), local file.
39. Local micro-benchmark, Forgeflow dev container, 2026-10-07 (method in Appendix A).
