# BLACKRIDGE — PVP MODE SPECIFICATION (3 modes, 1 map, 10 actors, local)

Status: **BUILD SPEC**, written 2026-08-20. This document is written to be implemented
without a single clarifying question. Every rule has a number; every edge case has a
ruling; every "why" that a build agent might re-litigate is answered inline.

Authority order: `pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` >
`_design/combat_spec.md` + `_design/level_design.md` > `_design/expansion/pvp_design.md`
> **this document**. Where this document overrides `pvp_design.md` it says so and gives
the reason (Part 0.2). Where it needs a freeze amendment it says so (Part 12).

**Owner's directive (verbatim):** *"the campaign is not much of a campaign, i fight two
bad guys and then i wandered for 2 minutes and foud nothing. Turn it into a PVP map
instead. the same map can be multiple modes - 1. 5v5 , 2. Capture the Flag, 3. FFA. Each
game will have a maximum of 10 players. At this point thats me, the tester, and 9 ai
(npcs). They need to know the full rules of each game, and fight to win/survive. We will
start with the same MAP for all 3 modes. Campaign is now PVP and this game has no campaign
mode atm. 30fps is fine."*

---

## PART 0 — THE THREE FACTS THAT DECIDE EVERYTHING ELSE

### 0.1 Evidence ledger (verified on disk this session)

| # | Fact | Source |
|---|---|---|
| **F1** | The engine bot cap is **12**; `const ENGINE_BOT_CAP = 12` and the spawn drain honours it. **10 actors leaves 2 actors of headroom** — the population is a design choice, not a ceiling we are pressed against. | `core/sim/mission.js:23`, `:318` |
| **F2** | There is **no team concept in the sim**. `applyDamage(sim, who, amount, attacker, part, src)` has no team parameter (`core/sim/damage.js:28`); `perception.js:69` is literally `const player = S.player;` — the AI has exactly one target in the world. Generalising this is still the single largest change. | `core/sim/damage.js:28`, `core/ai/perception.js:69` |
| **F3** | Bots are dormant unless `state.phase` is `infil`/`assault`/`exfil`: `if (phase !== "infil" && phase !== "assault" && phase !== "exfil") return;` | `core/ai/botfsm.js:164` |
| **F4** | Difficulty bands exist and are numeric, four of them, and change **only** reaction / jitter / forced-miss / burst-pause / headshot-intent — never HP, never damage. | `core/ai/botfsm.js:35-40` |
| **F5** | The engagement referee already guarantees termination: 40 s forced flank, 75 s push, 90 s episode close; fire window 0.25 s / ≤3 authorised. | `core/ai/squad.js:26-32` |
| **F6** | `nav` exposes `findPath(from,to)`, `randomPoint(near,r,rng)`, `reachable(from,to)`, `lightAt(x,z)`, `onNav(pos,maxDy)`, `floorAt(pos)`. Every objective/spawn/flag rule below is expressible with these six calls and `world.losBlocked`. | `core/ai/nav.js:426,475,499,505,509,513` |
| **F7** | `buildColliders()` returns a frozen shape with `boxes / groundY / spawns / cover / nodes / bounds`, plus private `walkRects / refSpawns / zones`. `nodes` is the **R24 frozen 15-key set** (`dock_spawn … exfil`). | `core/level/colliders.js:65-79`, `core/level/layout.js:544-560` |
| **F8** | The regen constants live in one place: delay 4.5 s, 35 HP/s, bot-retreat 24.5 HP/s. | `core/sim/damage.js:11-13` |
| **F9** | `damage.js` already calls a single mission hook on player death — `if (sim.mission) sim.mission.onPlayerDeath(sim);`. The match driver plugs in at exactly this seam. | `core/sim/damage.js:50` |
| **F10** | `pickCover()` is a weighted sum over `colliders.cover` with LOS/band/proximity/claim/aim-cone terms. Objective behaviour is a **new term in this sum**, not a new FSM state. | `core/ai/botfsm.js:557-606` |

### 0.2 Everything runs in one browser tab. State it, then use it.

One human + nine bots = **one process, one sim, one authority**. There is no networking,
no host, no replication, no interpolation buffer, no lag compensation, no client-authority
trust problem, no NAT traversal, no Supabase message budget.

`pvp_design.md` excluded **Free-for-all** and **carried-flag modes** from v1. Its reasons
are quoted and disposed of here, explicitly, because this document's two new modes are
exactly the two it excluded:

| `pvp_design.md` claim | Status now |
|---|---|
| §1.2: *"Objective modes with carried flags — carrier state is the hardest thing to replicate under client authority (E4); a desynced flag is an unloseable match."* | **VOID.** There is nothing to replicate. The flag is a field on one object in one sim. CTF ships (Part 3). |
| §1.2: *"Free-for-all — the spawn director's core signal is team influence (Part 2.4); FFA spawning is a genuinely different algorithm and would ship worse."* | **STILL TRUE as a statement about the algorithm, and it is not an excuse.** FFA does need a different director. It is specified in full in Part 4.4 (unsigned danger map + crowd repulsion + per-actor cluster rotation) instead of being used as a reason to cut the mode. |
| §1.0/§1.0.1: population capped at 8 humans by the Supabase/RTC budget | **VOID.** The only remaining cap is F1 (12 actors). 10 is chosen, with headroom. |
| PART 6 in its entirety (cheating, relevance culling, hit-claim validation, suspicion counters, vote-kick, determinism handshake) | **VOID.** Do not build any of it. The one rule inside Part 6 that survives is *not* an anti-cheat rule: **bots must never read a live enemy transform** — that is an AI-honesty rule from doctrine §2 and it is restated with force in Part 5.1. |
| §7.4 (join/leave/takeover, host migration, bot brain re-attach) | **VOID.** There is one human and they cannot leave mid-match without ending it. |
| Risk #8: *"Victim-side lag on a 233 ms TTK"* | **VOID.** The victim sees every shot at zero latency. This forces the 110 HP decision to be re-justified on reaction time alone — see Part 6.1, where it survives. |
| §4.4 B12 hitstop banned *"because scaling sim dt desynchronises this client from every other one"* | **Conclusion kept, reason replaced.** Hitstop stays banned because scaling sim dt in a 10-actor match slows all nine bots' fights, and because doctrine §4 requires fixed dt. The new reason is stronger than the old one. |
| §4.4 B15 friendly fire OFF *"griefing surface with no upside and no server to adjudicate it"* | **Conclusion kept, reason replaced.** See Part 6.4. |

**And one thing the local build makes newly possible, which this design uses deliberately:**
bots may legitimately consult the *public match state* — score, clock, flag states, flag
world positions when a flag is at a stand, objective markers, the FFA leader marker — because
a human reading the HUD has exactly the same facts. The boundary between public match
state and perception-gated actor state is drawn precisely in Part 5.1 and is a probe gate.

### 0.3 30 fps is the target, and it is not free

The sim is fixed `dt = 1/60` (`core/sim/sim.js:34`). Rendering at 30 fps means **two sim
steps per rendered frame**, so the per-frame AI cost doubles: `architecture §8`'s
"≤1.5 ms AI, ≤4 brains think/tick" becomes **≤3.0 ms AI and ≤8 thinks per rendered frame**.
Budget accordingly:

- Frame budget at 30 fps: 33.3 ms. Sim share (2 steps): **≤6 ms**. Draw budget unchanged
  (≤320 median).
- **Accumulator clamp: at most 3 sim steps per rAF.** On a longer stall, drop the debt and
  log `counters.simStepsDropped`. Without the clamp a hitch spirals (doctrine §5: "discard
  the accumulator during pause or resume fast-forwards the debt").
- 10 actors instead of 12 buys back ~17% of the AI budget. That is the reason 10 is
  comfortable and 12 would not be.
- No design element in this document assumes a 60 fps render. Every timing is expressed in
  seconds and evaluated in the sim, never in frames.

---

## PART 1 — THE SHARED FRAME (applies to all three modes)

### 1.1 Population and identity

| Item | Value |
|---|---|
| Actors per match | **exactly 10** — 1 human (`'P'`) + 9 bots (integer ids) |
| Team modes | 5v5. Human always fills a slot on team **AMBER**. |
| FFA | 10 mutually hostile actors |
| Teams | `AMBER` (rim tint `#d9a441`, warm) and `SLATE` (rim tint `#7c9fd0`, cool) — per `pvp_design §3.1`, applied as a rim uniform on **one shared material** (a second material is a shader permutation; `pvp_design §9.4`) |
| Bot callsigns | deterministic draw of 9 from: `NAVE, HOLT, KESTREL, MARLOW, ODESSA, PRYOR, QUILL, RASK, SABLE, TALLOW, VANE, WREN` (12 originals; draw is `rng.bots`-seeded so a seed reproduces a lobby) |
| Bot honesty | every bot is marked with the bot glyph in the killfeed and on the scoreboard, and its **difficulty band is shown on the scoreboard**. The UI never pretends a bot is a person (`pvp_design §5.3`). |

**FFA is implemented as ten teams of one.** `team = 'ffa:P'`, `'ffa:1'` … `'ffa:9'`.
`sameTeam()` then returns false for every pair, and friendly-fire gating, target selection,
scoring, and the squad director all reuse the team code path with **zero mode branches**.
This is the single highest-leverage implementation decision in the document.

### 1.2 The map: LANTERNWALK, one arena, three modes

Carved from Meridian Ward exactly as `pvp_design §3.3` specifies. That section is the
build order for the geometry and is **not restated here** — build it as written, including
edits E1–E10 (E6, the north service corridor, is the edit that makes the ring exist, and
E7, the reverse mantle). Arena bounds **X ∈ [−48, +26], Z ∈ [−34, +22]** = 74 × 56 m,
carved out of the 120 × 120 m campaign map (`level_design §2.1`).

What this document adds on top of §3.3:

- **All three modes run on this one arena.** No mode gets a sub-arena, a shrink, or a
  different boundary. The only mode-specific geometry data is: flag stands (CTF), the
  overtime COLLAPSE centre (all modes), and the FFA veto override table.
- **Foothold zones Z1–Z5 from §3.3 are not used** — Foothold is not one of the three modes.
  Keep the coordinates in map data as `poi` anchors; the TDM objective director uses Z1
  (plaza centre, `(−5, 0, 0)`) and Z4 (gallery mid, `(+20, 0, −10)`) as ground-value
  anchors, and the COLLAPSE zone uses Z1.
- **Blackline sites are not used.** Blackline is not one of the three modes.

Spawn clusters (from §3.3, unchanged, 38 points total):

| Cluster | Anchor rect | Points | TDM | CTF | FFA |
|---|---|---|---|---|---|
| `SC_SOUTH` | X[−14,+8] Z[+10,+18] | 11 | dynamic | **AMBER home (locked)** | in rotation |
| `SC_NORTH` | X[−34,−14] Z[−26,−19] | 10 | dynamic | **SLATE home (locked)** | in rotation |
| `SC_EAST` | X[+16,+25] Z[+2,+13] | 9 | dynamic | AMBER trap-fallback only | in rotation |
| `SC_WEST` | X[−47,−37] Z[−10,+4] | 8 | dynamic | SLATE trap-fallback only | in rotation |

### 1.3 Shared timings and states

| Constant | Value | Note |
|---|---|---|
| Warm-up | **3.0 s** frozen countdown | look allowed, movement/fire locked, protection active, the mode's rules card is on screen for the full 3 s |
| First spawn of the match | **0 s** delay | |
| Spawn protection | TDM/CTF **1.5 s**, FFA **2.0 s** | cancelled permanently by: firing, ADS, throwing a grenade, touching a flag. **Not** cancelled by movement, sprint, slide or mantle — you must be able to leave a bad spawn (`pvp_design §2.5`) |
| Protection tell | thin additive rim shimmer, one shared material, no new light | visible to enemies. Hidden protection is just wasted magazines and a false hitmarker |
| Death → respawn | fade 1.2 s → death cam 2.5 s → black 0.3 s = **4.0 s** | TDM lands exactly on the respawn delay; CTF holds an extra 1.0 s of black; FFA cuts the cam to 1.5 s to land on 3.0 s |
| Sim phase while live | `state.phase = 'assault'` | **compatibility choice, deliberate:** F3's dormancy gate already accepts `assault`, so bots run with a zero-line change and no freeze amendment. `sim.match.state` is the real state (Part 1.4). |
| Engine caps honoured | ≤12 alive actors, ≤4 brains think per **tick** | F1, `botfsm.js:52` |

### 1.4 Match state machine (the object that owns everything)

```
warmup ──3.0 s──▶ live ──┬─ scoreLimit reached ───▶ ended(result)
                         ├─ timeLimit reached, not tied ──▶ ended(result)
                         ├─ timeLimit reached, tied ──▶ overtime
                         └─ forfeit (ESC → confirm) ──▶ ended('forfeit')
overtime ──┬─ mode's OT resolution ──▶ ended(result)
           └─ OT hard cap 3:00 ──▶ ended('draw')
ended ──12 s scoreboard──▶ postmatch menu (replay / change mode / quit)
```

`sim.match.state ∈ 'warmup' | 'live' | 'overtime' | 'ended'`.
`sim.match.result ∈ 'amber' | 'slate' | 'draw' | 'forfeit'` (team modes) or an actor id /
`'draw'` (FFA).

On `ended`, set `state.phase = 'won'` if the human's side won, `'lost'` otherwise (a draw
maps to `'lost'` with `result:'draw'` — the shell's existing end flow then works untouched;
the HUD reads `match.result`, never `phase`, for the banner text).

**The watchdog.** `watchdogAt = timeLimit + overtimeCapS + 15`. If `state !== 'ended'` at
that sim time, force `end({reason:'watchdog'})` and log it loudly. **A probe asserts the
watchdog never fires across the whole acceptance battery** — it exists so a bug produces a
finished match and a log line instead of a hung game, not as a gameplay rule (doctrine §2:
every engagement must end).

### 1.5 Scoring model (two numbers, never conflated)

- **TEAM SCORE / MATCH SCORE** — the win metric. TDM: kills. CTF: captures. FFA: kills.
  This is what the score limit compares against and what the top-centre HUD shows.
- **PERSONAL POINTS** — a per-actor ledger for the scoreboard only. Never a win condition,
  never persisted to a server, never a currency (`pvp_design §5.5` — nothing is earned, and
  with no server there is nothing to write to anyway: FFG registry writes need the
  `service_role` key and a browser client must never hold one).

**Assist definition (all modes):** any actor other than the killer who dealt **≥ 40 damage**
to the victim within **5.0 s** before the killing blow. Multiple assists per kill are
allowed. The reason from `pvp_design §1.1` survives verbatim and is now stronger: in a
10-actor arena with 4–5-shot TTKs a large fraction of damage is traded, and a kill-only
scoreboard lies about who did the work — and with 9 bots, an unrewarded human who softened
three targets reads the scoreboard as rigged.

**Friendly fire: OFF in every mode.** Self-damage from your own grenade: **ON, full**.
Gate is `if (sim.match.sameTeam(attacker, who) && attacker !== who) return;` — the
`attacker !== who` clause is what keeps self-damage live. Reason, restated on local
grounds (Part 0.2): with 9 bots, FF converts every bot's aiming error into a score swing
the human cannot influence, and grenade splash in a 74 × 56 m arena would make the human's
own team its main threat. **The bots' friendly muzzle-block check stays ON**
(`combat_spec §5.7`: friendly capsule on the ray within 15 m = hold fire + "Move!" bark) —
it is now a *quality-of-fire* rule rather than a damage rule, and removing it would make
bots shoot through each other, which looks broken even when it is harmless.

### 1.6 Balance table (PVP tuning fork) — inherited, with two re-justifications

Implement `core/pvp/pvp_tuning.js` and `createSim({tuning:'pvp'})` exactly as
`pvp_design §4.0` specifies (one merged table, `sim.selftest.cjs --pvp` asserts both).
The deltas are `pvp_design §4.1–4.4` **unchanged**, i.e.:

110 HP (all actors, human and bot alike — F4's no-inflation rule applies across teams) ·
regen delay 5.0 s @ 28 HP/s · `steadyMult 0.55 → 1.00` · recoil jitter reduced
(.12→.08 / .18→.12 / .10→.06 / .15→.10) · Corvus `adsTime` 340→380 ms · Corvus ADS settle
0.35 s · scoped flinch ×2 · scope glint · tac-sprint 4.0→2.5 s with 4.0 s recharge ·
grenades 1 per life (body pickup to max 2) · hitstop 0 · aim assist OFF · friendly fire OFF.

Two entries need their reasoning replaced because the original reasoning was about netcode
(Part 0.2), and both survive:

- **110 HP.** The original argument was *human reaction (~250 ms simple, 300–400 ms choice)
  **plus** a 120 ms interpolation buffer plus peer latency*. The latency half is now zero.
  **The reaction half alone is sufficient and unchanged:** Vesper's 200 ms four-shot melt
  and Pike's 158 ms two-headshot are both below the simple-reaction floor, and 110 HP is
  the one scalar that fixes exactly those two rows and nothing else
  (`pvp_design §4.1` table). Keep 110. Keep the explicit selftest assertion on the Warden
  far row (5 × 22 = exactly 110) — that boundary is still one edit away from silently
  becoming a 400 ms kill.
- **Hitstop banned / FF off** — reasons replaced in Part 0.2 and §1.5 above.

### 1.7 Bot difficulty mix (the lobby is a cast, not a wall)

Bands are `combat_spec §5.5` / F4, verbatim. A lobby where every bot is identical produces
a flat scoreboard and no story, which is precisely the complaint that killed the campaign.

**Default (STANDARD) mixes:**

| Mode | Human's side (4 bots) | Opposing side (5 bots) | Why |
|---|---|---|---|
| **TDM 5v5** | 1 hardened, 2 regular, 1 recruit | 1 hardened, 3 regular, 1 recruit | The enemy team is one regular-band bot stronger in aggregate because **the human is supposed to be the strongest actor on their own team**. If the friendly bots carry the match, the human's play stops mattering. |
| **CTF 5v5** | 1 hardened (**defender role**), 2 regular, 1 recruit | 1 hardened (**defender**), 3 regular, 1 recruit | Band is assigned **by role, not at random**: the hardened bot holds the flag stand, so the mode's antagonist is a real one; the recruit is a runner, so the human's interceptions succeed often enough to teach the verb. |
| **FFA 10** | — | 2 recruit, 4 regular, 3 hardened | FFA's whole payload is the ladder on the scoreboard. Band spread is what produces a ladder; a flat lobby produces a flat list. The human should be able to finish above the recruits on a bad night and below the hardened bots on a good one. |

**Lobby setting (three presets, shown honestly on the mode-select screen):**

| Preset | TDM/CTF per side | FFA (9 bots) |
|---|---|---|
| CASUAL | 2 recruit, 2 regular, 1 hardened | 4 recruit, 4 regular, 1 hardened |
| STANDARD (default) | table above | table above |
| HARD | 3 regular, 2 hardened *(+1 veteran, opt-in — see below)* | 3 regular, 5 hardened, 1 veteran |

**Veteran band.** `pvp_design §7.2` bans veteran in PVP: *"Veteran's 300–420 ms reaction …
beats the human median … and 'the bots feel like cheats' would poison the mode's
reputation."* That reasoning assumed a **public mixed lobby where a losing human cannot
tell whether the loss was fair**. With exactly one human who has just selected HARD, the
informed-consent problem does not exist. Ruling: **veteran is available only inside HARD,
capped at 1 per match, labelled on the mode-select card as
`HARD — includes one VETERAN bot (reacts in 300–420 ms)`, and OFF in every other preset.**
Default remains no veteran. This is a deliberate, narrow amendment to §7.2, logged in
Part 12.

**Non-negotiables that no preset touches:** no adaptive difficulty, no rubber-banding, no
HP or damage multipliers, and roll-once-and-latch stays intact (`combat_spec §5.6`). Band
is fixed at spawn-in for the entire match and is printed on the scoreboard.

**Archetype spread (weapons).** Per team of 5: 1 `cqb` (Vesper), 2 `rifleman` (Warden),
1 `marksman` (Corvus), 1 `rifleman`. FFA's 9 bots: 3 `cqb`, 4 `rifleman`, 2 `marksman`.
Lanternwalk deliberately has no 45 m+ lane (`pvp_design §3.3`), so Corvus is a weak pick —
**one marksman per team, maximum**, and it anchors the plaza diagonal or the gallery.
`heavy` is not used in PVP (it is a cosmetic/band archetype for the campaign's finale).

---

## PART 2 — MODE 1: TEAM DEATHMATCH ("SKIRMISH", 5v5)

Adapted from `pvp_design §1.1 MODE 1` (specced 6v6) to exactly 5v5.

### 2.1 Rule table

| Rule | Value |
|---|---|
| Teams | **5v5** — human + 4 bots on AMBER, 5 bots on SLATE |
| Team score | **kills** (1 per kill; assists do not add to the team score) |
| Score limit | **60 kills** |
| Time limit | **10:00** |
| Respawn delay | **4.0 s** (0 s for the first spawn of the match) |
| Spawn protection | 1.5 s |
| Spawns | fully dynamic, both teams, all four clusters (Part 4.3) |
| Friendly fire | OFF |
| Grenades | 1 per life, body pickup to max 2 |
| Personal points | kill **100**, assist **25**, death 0 |
| Win | first team to 60; else higher score at 0:00 |
| Tie at 0:00 | → **OVERTIME** (§2.3) |

**Why 60 and not 75.** `pvp_design` set 75 for 12 actors. Kill rate scales with population,
so the same match length at 10 actors is `75 × 10/12 = 62.5`. 60 is that number rounded to
a readable one. This is arithmetic, not measurement — **the acceptance battery
(Part 10.2) measures median match length across 20 seeds and the ship condition is a median
inside 6:00–10:00.** If the measurement disagrees, change this number, not the design.

### 2.2 Score-limit edge cases (rule them now, not in code review)

- **Simultaneous kills on the same tick.** Resolve in `applyDamage` call order (which is
  deterministic: projectiles step in spawn order). If both teams cross 60 on the same tick,
  the team with the **higher kill count** wins; if both are exactly 60, it is a **draw** —
  do not run overtime for a both-hit-the-limit tie, it is already a finished match.
- **A kill that lands during the 1.2 s death fade of its own killer** still counts for both
  sides. Death is instantaneous at `hp ≤ 0` (`damage.js:41`,`:70`); the fade is view-side.
- **Suicide** (own grenade): counts as a **death** for the actor and **−1 personal point ×
  0**, i.e. no personal penalty, and **awards the enemy team nothing**. The team score is a
  kill count, and no enemy killed anyone. Do not silently award it — a phantom point on the
  enemy's bar during a close match reads as a bug.
- **Zone (COLLAPSE) deaths** in overtime: same treatment — a death, not a kill.
- **Score-limit reached mid-air**: the match ends at the tick the 60th kill resolves.
  In-flight projectiles are discarded, grenades are despawned without exploding, and no
  further damage resolves. Freeze all actors' input, keep rendering.

### 2.3 Overtime (the mode may not hang, and passivity may not win)

Triggered only by an exact score tie at 0:00.

| Rule | Value |
|---|---|
| Duration cap | **3:00** (hard) |
| Win condition | **the first actor death of overtime ends it; the team that did NOT lose an actor wins** |
| Respawn | **none** — nobody respawns during overtime |
| Spawn protection | none (everyone is already alive) |
| COLLAPSE zone | arms at **OT + 60 s** (§2.4) |
| Still unresolved at 3:00 | tie-break chain: (1) team damage dealt during OT, (2) team damage dealt in regulation, (3) **draw** |

Note the win condition is *first death*, not *first kill*. That is what makes the COLLAPSE
zone a terminator: a player who hides outside the ring dies to the ring and **loses the
match for their team**. Zero-contact therefore rules strictly against the passive side,
which is doctrine §2's explicit requirement (*"a timeout verdict must never reward
passivity … zero-contact rules AGAINST the player"*).

### 2.4 COLLAPSE (shared overtime terminator, used by all three modes)

| Property | Value |
|---|---|
| Arms at | overtime + **60.0 s** |
| Centre | plaza centre `(−5, 0, 0)` (the arena's most-connected space, `pvp_design §3.3`) |
| Radius | **12.0 m** at arm, shrinking linearly to **6.0 m** over 30 s, then held |
| Damage outside | **5 HP/s** at arm, ramping linearly to **15 HP/s** over 20 s; applied every sim tick as `applyDamage(sim, who, rate*dt, null, 'body', 'zone')` |
| Inside | no damage, no regen change |
| Tell | a through-geometry ring at the current radius (one additive shader on one shared material), an amber HUD line `COLLAPSE — MOVE TO THE PLAZA`, and a rising audio bed |
| Bots | receive `obj.role = 'collapse'` with `obj.goal = nav.randomPoint([−5,0,0], radius−2, rng)` and `urgency = 1.0` — they run for the ring like the human does |

At 15 HP/s a 110 HP actor outside the ring dies in 7.3 s. Termination is therefore
guaranteed within `60 + 20 + 7.3 ≈ 88 s` of overtime start, comfortably inside the 3:00 cap.

### 2.5 What the bots must understand about TDM

See Part 5 for the mechanism. TDM-specific role assignment, re-evaluated every **2.0 s**
per team by the team objective director:

| Role | Count (of 5) | Goal | Behaviour delta |
|---|---|---|---|
| `push` | 2 | the **influence frontier**: the highest-value cell of the team influence grid whose neighbour has opposite sign | `objectiveBias` favours cover nodes within 12 m of the goal |
| `flank` | 1 | the ring route that does **not** contain the frontier (plaza → cross-street → arcade, or gallery → E6 corridor → market street) | uses the existing committed `flank` FSM entry; no reactive self-cancel |
| `anchor` | 1 | the nearer of the two ground-value anchors: plaza centre `(−5,0,0)` or gallery mid `(+20,0,−10)` | holds; `objectiveBias` favours nodes with LOS to the anchor |
| `trade` | 1 | position of the most recent friendly death within the last 6 s (a teammate dying is public to their own team) | `urgency = 0.8`; this is the bot that makes the team feel like a team |

Reassignment rules: a role is **latched for at least 4.0 s** before it can change (role
thrash reads as indecision, and it also re-paths a bot mid-route); a bot in `retreat` is
exempt from assignment; a bot holding a fire token never abandons a live engagement for a
role change — the role only steers the *next* cover pick or the *next* goal.

---

## PART 3 — MODE 2: CAPTURE THE FLAG (5v5)

New. `pvp_design.md` excluded it for a reason that no longer exists (Part 0.2). This is the
complete design.

### 3.1 Flag stands

Two stands, both carved from real Lanternwalk geometry, both backing onto a sealed arena
boundary (a flag stand you can be shot from behind at is not a stand), both with **three
approaches** (a one-mouth flag room is a grenade trap and violates carve rule 2).

| Team | Stand id | Position | Room | Boundary at its back | Approaches |
|---|---|---|---|---|---|
| **AMBER** | `flag_amber` | **(−10.0, 0.0, +16.5)** | plaza south mouth, at the head of the sealed ramp | carve edit **E1** (stacked freight containers at Z = +22) | (a) plaza north, open, 20–34 m; (b) plaza SE along the south edge; (c) west along the arcade wall |
| **SLATE** | `flag_slate` | **(−26.0, 0.0, −23.0)** | cross-street depot, `r_cs1` mid | carve edit **E4**'s customs barricade line + the `bld_nea` mass | (a) market-street mouth, east; (b) alley/arcade, west; (c) plaza via the arcade east doors |

**Geometry checks (arithmetic from the coordinates above and `pvp_design §3.3`; these are
derived, not measured — the balance probe in Part 10.1 is what proves them):**

- Stand-to-stand distance: `hypot(16.0, 39.5) = 42.6 m`. At walk 4.6 m/s that is a 9.3 s
  straight line and, along the actual ring routes, a **16–24 s** run. That is the CTF
  heartbeat: long enough that an interception is possible, short enough that a capture
  happens inside a two-minute story.
- Distance from arena centroid `(−11, 0, −6)`: AMBER `hypot(1.0, 22.5) = 22.5 m`,
  SLATE `hypot(15.0, 17.0) = 22.7 m` — **0.9 % apart**, inside carve rule 3's ±8 % contract.
- Stand → own spawn cluster centroid: AMBER `(−3, 0, +14)` → 7.3 m; SLATE `(−24, 0, −22.5)`
  → 2.1 m. **SLATE's stand is too close to its own spawn.** Ruling: SLATE's spawn points are
  authored so that **no spawn point is within 6.0 m of `flag_slate`** and no spawn point has
  LOS to the stand from under 10 m; the same constraint applies to AMBER. This is a
  gate-checked authoring constraint (Part 10.1), not a runtime rule, because a spawn inside
  your own flag room turns a defensive wipe into an instant free re-defence.

**Stand physics.** Each stand is a 1.2 m radius, 2.5 m tall cylinder trigger with a
readable prop (a floodlit equipment pallet with a marker beacon — existing prop kinds,
one emissive, no new light). The flag object itself is a pooled mesh; when carried it is
parented to the carrier's back socket.

### 3.2 Rule table

| Rule | Value |
|---|---|
| Teams | **5v5** |
| Team score | **captures** |
| Score limit | **3 captures** |
| Time limit | **12:00** |
| Respawn delay | **5.0 s** (8.0 s during PRESSURE, §3.6) |
| Spawn protection | 1.5 s; cancelled by touching a flag as well as by firing/ADS/grenade |
| Spawns | **side-locked** to the team's home cluster, with the director choosing the point *inside* that cluster (§4.3.2) |
| Capture condition | carry the enemy flag into your own stand's trigger **while your own flag is AT_STAND** |
| Pickup | **instant on touch**, radius 1.2 m horizontal, `|dy| ≤ 2.0 m`. No channel. |
| Carrier speed | **base speed unchanged**; **tactical sprint disabled** (base sprint 6.4 m/s still allowed) |
| Carrier restrictions | no grenade throw; **no health regen while carrying**; flag drops on death |
| Carrier reveal | after **8.0 s** of continuous carry: enemy team sees a through-geometry flag marker with distance |
| Carry hard cap | **120 s** of continuous carry without a capture → flag force-returns to its stand, HUD line `FLAG RECOVERED — CARRY EXPIRED` |
| Dropped flag | auto-returns after **30.0 s** untouched; own team touch → **instant return**; enemy touch → pickup |
| Stuck-flag reset | validated at 1 Hz; 3 consecutive failures → force return (§3.4) |
| Stalemate | both flags off their stands for 60 s → PRESSURE; 90 s → both force-return (§3.6) |
| Grenades | 1 per life; **carriers cannot throw** |
| Friendly fire | OFF |
| Personal points | capture **500**, grab **50**, return **100**, carrier kill **150**, defend kill **50**, escort assist **50**, kill **100**, assist **25** |
| Win | first team to 3 captures; else more captures at 0:00 |
| Tie at 0:00 | tie-break chain (§3.7), then OVERTIME |

**Term definitions, so the build agent does not have to guess:**
- **grab** — taking the enemy flag from its stand (not from the ground).
- **return** — touching your own dropped flag.
- **carrier kill** — killing an actor who is carrying your flag.
- **defend kill** — a kill made within **12.0 m** of your own flag stand.
- **escort assist** — a kill made within **15.0 m** of your own team's living flag carrier.
- These stack: killing the enemy carrier 8 m from your stand is 150 + 50 + 100 = 300.

**Why "your own flag must be home to capture."** Both options were considered:

- *Capture-anytime* makes the flag a pure footrace. Defence stops being a job, both teams
  run past each other in opposite directions, and the mode collapses into two parallel time
  trials — which is exactly what a lobby with 9 bots would degenerate into, because bots
  are very good at running a route and mediocre at reading a standoff.
- *Flag-at-home* makes **defence a real job**, makes the interceptor role meaningful, and
  has one structural bonus that decides it: **a simultaneous double capture becomes
  impossible.** If both flags are off their stands, neither team can score. That removes an
  entire class of tie/ordering edge case from the code, permanently.

Its cost is the stalemate, which §3.6 solves with a bounded, visible mechanism.

### 3.3 Flag state machine (complete)

Each flag is one object:

```js
flag = {
  id: 'flag_amber' | 'flag_slate',
  team: 'amber' | 'slate',        // the team it BELONGS to (its defenders)
  state: 'AT_STAND' | 'CARRIED' | 'DROPPED',
  pos: [x, y, z],                 // valid in AT_STAND and DROPPED
  carrier: null | 'P' | botId,    // valid in CARRIED
  carryStartT: -1,                // sim time the current carry began
  droppedT: -1,                   // sim time it entered DROPPED
  revealed: false,                // carrier position public to the enemy
  offStandSinceT: -1,             // set on leaving AT_STAND, cleared on returning
  stuckStrikes: 0,
}
```

**Transitions** (evaluated in `match.tick()` after damage resolution, i.e. tick-order slot
6, so a carrier who died this tick has already dropped it):

| From | Trigger | To | Side effects |
|---|---|---|---|
| `AT_STAND` | an **enemy** of `flag.team` enters the stand trigger (r 1.2, dy ≤ 2.0) and is alive and not spawn-protected | `CARRIED` | `carrier = actor`, `carryStartT = t`, `offStandSinceT = t`, cancel that actor's spawn protection, emit `flag:taken`, HUD line to **both** teams (`<name> HAS THE AMBER FLAG` / `YOUR FLAG HAS BEEN TAKEN`), award grab 50 |
| `AT_STAND` | a **teammate** of `flag.team` enters the trigger | `AT_STAND` | nothing. Never pick up your own flag. |
| `CARRIED` | carrier dies (any cause, including COLLAPSE and self-grenade) | `DROPPED` | `pos = dropPoint(carrier.pos)` (§3.4), `droppedT = t`, `carrier = null`, `revealed = false`, emit `flag:dropped` |
| `CARRIED` | `t − carryStartT ≥ 8.0` and `!revealed` | `CARRIED` | `revealed = true`, emit `flag:revealed` |
| `CARRIED` | `t − carryStartT ≥ 120.0` | `AT_STAND` | force return, `offStandSinceT = -1`, HUD `FLAG RECOVERED — CARRY EXPIRED`, emit `flag:returned{reason:'expired'}`. No points. |
| `CARRIED` | carrier enters **their own** stand trigger **and their own flag is `AT_STAND`** | `AT_STAND` | **CAPTURE.** +1 team score, +500 personal, both flags reset to `AT_STAND`, `offStandSinceT = -1` for both, 2.0 s celebration hold (no input lock), emit `flag:captured` |
| `CARRIED` | carrier enters their own stand trigger and **their own flag is not `AT_STAND`** | `CARRIED` | nothing scores. HUD line to the carrier: `RETURN YOUR FLAG TO CAPTURE`. Emit `flag:captureBlocked` at most once per 3 s (it is the mode's single most important teaching moment and it must be unmissable, but it must not spam). |
| `DROPPED` | a **teammate** of `flag.team` touches it (r 1.2, dy ≤ 2.0) | `AT_STAND` | instant return, `offStandSinceT = -1`, +100 personal, emit `flag:returned{reason:'touch'}` |
| `DROPPED` | an **enemy** of `flag.team` touches it | `CARRIED` | `carryStartT = t` (the reveal clock **restarts** — a fresh carrier is a fresh problem), `offStandSinceT` unchanged (the stalemate clock does **not** restart), no grab points (only stand-grabs pay 50) |
| `DROPPED` | `t − droppedT ≥ 30.0` | `AT_STAND` | auto-return, `offStandSinceT = -1`, emit `flag:returned{reason:'timeout'}` |
| `DROPPED` | stuck validation fails 3× (§3.4) | `AT_STAND` | force return, `counters.flagStuckResets++`, emit `flag:returned{reason:'stuck'}` |
| any | match `ended` | frozen | no further transitions |

**Simultaneity rulings:**
- Two enemies touch a `DROPPED` flag on the same tick → the one with the **lower actor
  ordinal** (human `'P'` sorts first, then ascending bot id) takes it. Deterministic, and
  it favours the human, which is the correct bias in a 1-human lobby.
- A teammate and an enemy touch a `DROPPED` flag on the same tick → **the return wins.**
  Defence beats offence on a tie; this stops a body-blocked flag from being farmed.
- A carrier is killed inside their own stand trigger while their own flag is away → the
  enemy flag lands on their stand as `DROPPED` and is picked up again immediately by the
  next teammate. That is the intended tense moment; do not special-case it.

### 3.4 The four classic CTF failure modes, and the machinery that prevents each

| Failure | What it looks like | Prevention (all specified above, gathered here) |
|---|---|---|
| **Flag stuck in unreachable geometry** | a carrier dies on a kiosk roof / inside a prop / off the nav mesh; the flag is unreturnable and the mode deadlocks | `dropPoint(p)`: `if (nav.onNav(p, 1.0)) use p; else q = nav.randomPoint(p, 6.0, rng.match); if (q reachable) use q; else force AT_STAND immediately`. Then **1 Hz validation while `DROPPED`**: `nav.onNav(flag.pos, 1.0)` and inside `colliders.bounds` and inside the arena AABB. Three consecutive failures → force return. Counter `flagStuckResets` is a probe gate: **the acceptance battery requires 0 across 20 seeds** — a nonzero value is a map bug, not a tuning issue. |
| **Carrier hides for the whole match** | a bot (or the human) grabs the flag and sits in the arcade for 10 minutes | Three stacked bounds: **reveal at 8 s** (position becomes public — hiding stops working), **no regen while carrying** (they cannot heal up in the corner), **force return at 120 s** (hard bound). Bots additionally never choose this: the `carrier` role's goal is always its own stand (§5.4). |
| **Stalemate** (both flags out, nobody can score) | the structural cost of the flag-at-home rule | §3.6 PRESSURE, bounded at 60 s / 90 s. |
| **Turtling** (a team never attacks, sits on its own flag) | a 0–0 timeout that the passive side "wins" on a coin flip | The tie-break chain (§3.7) is led by **flag pressure**, which a team that never attacked cannot score on. Turtling is therefore a losing strategy by construction, satisfying doctrine §2. Additionally, the bot role table (§5.4) always assigns **at least 2 runners** whenever the enemy flag is available, so the bot side is structurally incapable of turtling. |

### 3.5 Carrier rules, gathered (the build agent implements exactly this list)

While `flag.carrier === actor`:
1. `tacSprint` input is ignored (base sprint, walk, crouch, slide, mantle all normal).
2. `cmd.grenade` is ignored.
3. Health regen is suppressed (`stepHealth` skips the actor).
4. The actor renders the flag on its back socket, tinted with the flag's team colour,
   visible from behind at any distance the actor is visible at.
5. From `carryStartT + 8.0`, the enemy team gets a through-geometry flag marker with a
   metre readout. **This is a marker on the FLAG, not a nameplate on the player** — the
   `pvp_design §5.3` rule "enemies get no nameplate at any distance" is untouched. The
   distinction is real: a captured objective is public property, a person's location is not.
6. On death: drop (§3.3). On match end: freeze.
7. There is **no** ADS penalty, no accuracy penalty, and no weapon lock. A carrier who
   cannot fight is a prop, and a prop is not fun to be.

### 3.6 PRESSURE (the stalemate breaker)

`bothOffStandS` = the duration for which **both** flags have simultaneously had
`state !== 'AT_STAND'`.

| At | Effect |
|---|---|
| **60.0 s** | Enter **PRESSURE**: both carriers are revealed regardless of the 8 s rule; spawn protection drops to **0.75 s**; respawn delay rises to **8.0 s**; HUD banner `PRESSURE — FLAGS CONTESTED`; music layer escalates |
| **90.0 s** | **Both flags force-return** to their stands, `bothOffStandS` resets to 0, PRESSURE ends, HUD line `FLAGS RESET — STALEMATE`. No points awarded to anyone. |

The 8 s respawn is the load-bearing part: it makes a team wipe decisive, which is the only
thing that reliably breaks a two-flag standoff. The forced reset at 90 s is the guarantee —
it is unsatisfying by design, it is announced honestly, and it makes the mode's termination
provable rather than hopeful.

### 3.7 Ending CTF cleanly

**Regulation tie-break chain**, evaluated in order at 0:00 (and again at the overtime cap):

1. **More captures.**
2. **Flag pressure** — for each team, the **minimum distance the enemy flag ever reached to
   that team's own stand** during the match (tracked every tick while the flag is `CARRIED`
   or `DROPPED`). **Lower is better.** A team that never took the enemy flag out of its
   stand scores the full 42.6 m and loses this comparison to any team that made a single
   real attempt. This is the anti-turtle rule and it is deliberately the *first* tie-break
   after captures.
3. **More flag returns.**
4. **More kills.**
5. **Fewer deaths.**
6. → **OVERTIME.**

**Overtime:** *golden capture.* 3:00 cap. PRESSURE rules are active from the first second
of overtime (0.75 s protection, 8.0 s respawn, permanent reveal). Both flags are force-reset
to their stands at overtime start regardless of state. The both-flags-out 90 s reset still
applies. **COLLAPSE arms at OT + 60 s** and both flag stands are inside... they are not:
`flag_amber` is 22.5 m and `flag_slate` 22.7 m from the plaza centre, both outside the
12 m ring. Ruling: **in CTF overtime, COLLAPSE does not damage a flag carrier or an actor
within 8.0 m of either stand** — the mode's objective must remain playable while the
terminator runs. Everyone else takes the ring damage, which forces the fight to the plaza
and makes a carry through the middle the only viable route.

If overtime expires with no capture: re-run the tie-break chain from step 2. If it is
still tied at step 5 → **draw**.

### 3.8 Additional CTF edge cases (ruled)

- **Human is the carrier when the match ends** — freeze, no capture, no points.
- **A flag is `CARRIED` when the score limit is reached by the other team** — match ends,
  flag freezes. No cleanup animation.
- **Carrier spawn-kills**: a carrier is never spawn-protected (protection is cancelled by
  touching a flag, §1.3), so a carrier cannot walk a protected flag home.
- **A carrier who touches their own dropped flag** — returns it (normal return, +100) and
  keeps carrying the enemy flag. If that return completes their own flag's `AT_STAND`
  condition and they are standing inside their own stand trigger, the capture resolves on
  the **same tick**, in this order: return first, then capture. This is the mode's best
  moment and it must work.
- **A bot carrier whose brain resets** (see §5.6) keeps the flag. The flag is match state,
  not brain state.

---

## PART 4 — MODE 3: FREE-FOR-ALL (10 actors)

### 4.1 Rule table

| Rule | Value |
|---|---|
| Actors | **10**, all mutually hostile (`team = 'ffa:<id>'`, ten teams of one — §1.1) |
| Score | **kills**, per actor |
| Score limit | **25 kills** |
| Time limit | **10:00** |
| Respawn delay | **3.0 s** (0 s for the first spawn) |
| Spawn protection | **2.0 s** (longer than the team modes: there are nine threats, not five) |
| Spawns | FFA director (§4.4) — a genuinely different algorithm |
| Friendly fire | not applicable; **self-damage ON** |
| Grenades | 1 per life, body pickup to max 2 |
| Personal points | kill **100**, assist **25**, **leader kill 150** |
| Leader marker | armed when an outright leader reaches **15 kills** or leads by **≥ 5** (whichever first); see §4.2 |
| Win | first to 25; else most kills at 0:00 |
| Tie at 0:00 | (1) kills, (2) fewer deaths, (3) earliest sim time at which the final kill count was reached → then **OVERTIME** |

**Why 25.** With 10 hostiles in a 74 × 56 m arena and a 3.0 s respawn, the expected total
death rate is 15–20/min, so a 10:00 match produces roughly 150–200 kills spread over 10
actors — a mean of 15–20 each and a leader in the high 20s. 25 therefore lands a
score-limit finish around 7–9 minutes, ahead of the clock most of the time, which is the
correct feel for FFA (the clock should be the backstop, not the referee). **Same rule as
TDM: this is arithmetic and the battery in Part 10.2 is what proves it.**

### 4.2 The leader marker (a termination pressure, not a flourish)

When armed, the current outright leader is marked to **every other actor**: a compass pip,
a through-geometry chevron, and a killfeed prefix. It disarms the moment they are no longer
the outright leader (a tie disarms it).

Three reasons it is a rule and not a nice-to-have:
1. **It stops the endgame becoming a hiding contest.** Without it, the correct play at 24
   kills is to leave the fight, and FFA's failure mode is exactly that.
2. **It is public information**, so a bot targeting the leader preferentially (§5.5) is
   using a fact the human also has. That keeps it inside the AI-honesty boundary.
3. **It gives the human a story**: either you are being hunted, or you know who to hunt.

Marked-leader kills pay 150 personal points. The leader gets no compensation — being ahead
*is* the compensation.

### 4.3 Spawning in team modes (for contrast with §4.4)

The `pvp_design §2` director is implemented as written, with these deltas:

**4.3.1 TDM.** Fully dynamic across all four clusters. Vetoes V1–V6 as written; V7
(Foothold zone) is dropped — there is no zone. Score function as written, including the
`+22 × (1 − min(1, dNearestFriendly/35))` "spawn WITH your team" term. Influence grid,
cluster ownership, flip rule (mean < −0.35 for 3 s, 12 s hysteresis), and the trap override
(≥3 of last 5 spawns died within 6 s and 20 m → immediate flip, V1→32 m, V2→80 m for 20 s,
plus the HUD line `SPAWN COMPROMISED — FALLING BACK`) all apply verbatim.

**4.3.2 CTF.** The director runs, but **restricted to the team's own home cluster**
(`SC_SOUTH` for AMBER, `SC_NORTH` for SLATE). Dynamic *point* selection inside a locked
*cluster*. The reason is `pvp_design §2.6`'s Blackline reasoning, which transfers exactly:
dynamic cluster selection in an objective mode changes where the enemy can come from
between engagements, which destroys the defensive read the mode is built on. The single
exception is the **trap override**: if a team's spawn cluster is being camped (same ≥3-of-5
test), that team flips to its designated fallback for **20.0 s** and then flips back —
AMBER → `SC_EAST`, SLATE → `SC_WEST`. The fallback distances are asymmetric
(`SC_WEST` centroid → `flag_slate` ≈ 25.6 m; `SC_EAST` centroid → `flag_amber` ≈ 31.8 m),
so **the balance probe must measure this and the carve may need to move points**, not
assume it is fine.

**4.3.3 Additional CTF vetoes.** V8: no spawn point within **6.0 m** of either flag stand.
V9: no spawn point with LOS to your own stand from under **10.0 m** (both authoring
constraints, gate-checked at bake — §3.1).

### 4.4 Spawning in FFA — precisely how it differs, and the algorithm

**The team director cannot be reused, and here is exactly why.** Three of its terms are
*polarity* terms — they presume the world divides into "us" and "them":

1. `+22 × (1 − min(1, dNearestFriendly/35))` — *spawn near your team*. In FFA there is no
   team; every nearby actor is a threat. **This term is deleted, not zeroed.** Zeroing it
   would leave a director with no cohesion pressure at all; deleting it and replacing it
   with an explicit *anti*-cohesion rule (the cluster cooldown, below) is the correct shape.
2. `+18 × influence(p)`, where influence is a **signed** grid (±1 by team) — the sign is the
   whole point: it answers *whose ground is this*. In FFA there is no "whose", only **how
   hot**. The signed influence map becomes an **unsigned danger map**.
3. `40 × min(1, dNearestEnemy/55)` — safety measured against the **single nearest** enemy.
   This is the specific term that breaks FFA, and it breaks silently: a point 60 m from one
   actor and 8 m from three others scores a perfect 40. In a 10-actor arena that
   configuration is common, not exotic. Safety must be measured against **all** actors.

**The FFA director:**

```
// --- unsigned danger map (replaces the signed influence grid)
grid: 4 m cells over the arena AABB, rebuilt at 5 Hz
  every LIVING actor deposits +1.0, linear falloff to 0 at 25 m
  every DEATH deposits +2.5 at the victim position, decaying with the grid
  whole grid decays x0.85 per second
danger(p) = grid cell at p, normalised to 0..1   // never signed

// --- crowd repulsion (replaces dNearestEnemy; this is the core change)
crowd(p) = SUM over every living actor a (excluding the spawner) of exp(-d(p,a) / 18)
ffaSafety(p) = 1 / (1 + crowd(p))                // 1.0 = empty arena, -> 0 as it crowds

// --- the score
score(p) = 55 * ffaSafety(p)
         - 26 * danger(p)
         + 12 * p.cover
         - 20 * recency(p)          // 1.0 if used < 12 s ago, linear to 0 at 24 s
         - 18 * facing(p)           // max over ALL actors within 60 m of
                                    //   cos(angle between their aim and p), clamped >= 0
         -  8 * clusterHeat(p)      // 1.0 if any actor spawned in p.cluster < 3.0 s ago
         +  6 * rng.spawn()
```

`ffaSafety` is a soft minimum that counts everyone. Worked values, so the tuning intent is
unambiguous: one actor at 22 m → `exp(−1.222) = 0.295` → safety **0.772**; **three** actors
at 22 m → crowd 0.885 → safety **0.530**; one actor at 60 m → `exp(−3.33) = 0.036` →
safety **0.965**. A point ringed by three distant players now scores worse than a point
with one distant player, which is the exact behaviour the single-nearest term could not
express.

**FFA vetoes** — every veto becomes "any living actor", not "any enemy":

| # | Veto | Lanternwalk FFA value |
|---|---|---|
| V1 | any living actor within | **14.0 m** |
| V2 | any living actor has LOS to head height (1.55 m) within | **30.0 m** |
| V3 | point inside any actor's view cone (±35°) within | **22.0 m** |
| V4 | any actor spawned at this point within | 1.5 s |
| V5 | live grenade / explosion in the last 1.5 s within | 12.0 m |
| V6 | **any** actor died within 8 m of this point in the last | 5.0 s |
| V10 | **cluster cooldown** — any actor spawned in this cluster within | **3.0 s** (FFA-only; the classic "spawned next to the guy who spawned a second ago") |

**Why the radii shrink, and why this is declared rather than discovered.** The arena is
74 × 56 m = 4 144 m². A 22 m veto disc is 1 520 m². Ten actors' worth of 22 m discs cover
the arena several times over, so the team-mode radii would veto every point on essentially
every spawn, and the relaxation ladder would run every time — which means the ladder, not
the scorer, would be choosing spawns. `pvp_design §3.7` set exactly this precedent for the
small map BOXCUT (*"BOXCUT ships with a map-local veto override — V1 14 m, V2 30 m —
declared in its map data and gate-checked, not discovered at runtime through
`spawnStress`"*). Lanternwalk-FFA declares its override the same way, in
`content.pvp.modes.ffa.vetoOverrides`, and the Part 10.1 gate checks it.

**Relaxation ladder (FFA):** V3 off → V6 off → V10 off → V2 30→18 m → V1 14→9 m. Each step
increments `counters.spawnStress`. If nothing survives, spawn at the cluster centroid with
**3.0 s** protection instead of 2.0 s, and log it. Never fail to spawn.

**Spawn flip in FFA.** In team modes the flip moves a *team* to a new home cluster. There is
no team to move, so the flip becomes **per-actor cluster rotation**: each actor tracks its
own last-used cluster and its own `clusterBanned[]` set; on the trap override (that
**actor's** last 5 spawns: ≥3 died within 6 s of spawning and within 20 m of their spawn
point), that actor's current cluster is banned for **20.0 s**, V1 widens to 26 m and V2 to
60 m for 20 s, and the HUD line `SPAWN COMPROMISED` posts to that actor only. Everything in
FFA that was a team property becomes an actor property — that is the one-sentence summary
of the whole difference.

### 4.5 Ending FFA cleanly

**Overtime** triggers on a tie for first place at 0:00 (after the three tie-breaks in §4.1).

| Rule | Value |
|---|---|
| Participants | everyone keeps playing; only the **tied leaders** can win |
| Duration cap | **3:00** |
| Respawn | none |
| Win | the first **tied leader** to score a kill wins. A tied leader who **dies** (to anyone, or to COLLAPSE) is **eliminated from the tie**; when one tied leader remains, they win immediately |
| COLLAPSE | arms at OT + 60 s (§2.4), full damage, no exemptions |
| All tied leaders dead simultaneously, or cap reached with the tie intact | **draw**, recorded as a draw among the tied actors |

This terminates in every branch: kills resolve it, deaths resolve it, and COLLAPSE
guarantees that deaths happen. A non-leader who wins fights during overtime changes nothing
about the win condition but does eliminate leaders, which is exactly the kingmaker dynamic
FFA should have.

---

## PART 5 — MAKING THE BOTS ACTUALLY UNDERSTAND THE MODES

This is the part the owner asked for most directly: *"They need to know the full rules of
each game, and fight to win/survive."*

### 5.1 The honesty boundary (draw it first, then never cross it)

| Class | Contents | Bot access |
|---|---|---|
| **PUBLIC MATCH STATE** | score, clock, match state, mode rules, flag states, flag world positions when `AT_STAND`, flag world position when `DROPPED` **and** the bot's team has seen it or it is within 40 m of a teammate, revealed-carrier position, FFA leader identity, own team's actor positions/HP, own team's deaths and their positions, COLLAPSE ring | **Free.** A human reading the HUD has all of it. |
| **PERCEPTION-GATED ACTOR STATE** | enemy positions, enemy HP, enemy weapon and ammo, enemy stance, an unrevealed carrier's position | **Only through `perceive()`.** A bot may never read `sim.state.player.pos` or an enemy bot's transform directly. |

`core/ai/perception.js:69` is `const player = S.player;` today — **that line is the exact
place the whole expansion turns**, and generalising it (§5.2) must not accidentally hand the
FSM a live enemy transform anywhere else. The `ai.selftest.cjs` battery gains a gate for
this: run a match with a scripted human who never fires and never enters any bot's view
cone; **assert zero bots ever set a goal within 10 m of the human's true position**.
That probe is the difference between "the bots understand the mode" and "the bots cheat and
we called it understanding."

### 5.2 The four sim changes (this is `pvp_design §7.3`, re-scoped for local play)

1. **`team` on every actor.** `state.player.team`, `bot.team`. `damage.js` gains the
   friendly-fire gate (§1.5) and two match hooks beside the existing mission hook (F9):
   `if (sim.match) sim.match.onDamage(sim, who, amount, attacker, part, src)` before the
   death check, and `if (sim.match) sim.match.onDeath(sim, who, attacker, part, src)` in
   both death branches. Two lines, one file.
2. **`perceive()` generalised from `S.player` to a target list.** Iterate enemy-team living
   actors; run the existing awareness meter per candidate; keep the highest-awareness one as
   `bot.percept.target`; retain `lastKnown` / hearing semantics **per target**. Everything
   downstream (light factor, muzzle-flash override, stance/speed modifiers) is already
   written against a generic actor. Cost control: cap the candidate scan at the **6 nearest**
   enemies by horizontal distance before running the meter (in a 10-actor match with 5
   enemies this is never binding, and it bounds the cost if a future mode grows).
3. **Target-switching hysteresis.** A bot does not swap targets unless the new candidate's
   awareness exceeds the current target's by **0.25**, or the current target has been lost
   for **≥ 2.0 s**. Without it a bot twitches between three targets and — far worse —
   re-rolls its latched reaction each time, which would silently void `combat_spec §5.6`
   and turn the difficulty table into decoration (doctrine §2: *"per-tick rerolls turn p
   into 1−(1−p)^12 ≈ certainty"*).
4. **`squad.js` per team.** Two instances in team modes; **ten instances in FFA** (one per
   actor, from the ten-teams-of-one identity in §1.1). The ≤2 fire tokens and 1 suppress
   token are per squad. The mission-wide **≤3 damaging attackers on a human in any 250 ms
   window** (`squad.js:27-28`) applies **per human target** and is the cap that actually
   matters in FFA, where every bot is its own squad and therefore always holds its own
   token. Bot-vs-bot fire is exempt from the attacker cap — bots are not the audience.

### 5.3 The objective layer (above the FSM, never inside it)

New module `core/match/bot_objective.js`, THREE-free and deterministic. It writes exactly
three fields on a bot and nothing else:

```js
bot.obj = {
  role:    '<mode role string>',
  goal:    [x, y, z] | null,   // a world position, always nav-reachable
  urgency: 0.0 .. 1.0,
}
```

The FSM consumes them in exactly **three** places:

| # | Hook | Change |
|---|---|---|
| **H1** | `pickCover()` (`botfsm.js:557`) | add one term: `s += W_OBJ * objectiveScore(bot, c.pos)` where `objectiveScore = clamp(1 − dist(node, bot.obj.goal)/25, 0, 1)` and `W_OBJ = 1.5 + 2.5 × bot.obj.urgency` |
| **H2** | `planCombat()` (`botfsm.js:359`) | when the bot has **no confirmed target** (`!brain.confirmed`) **or** `bot.obj.urgency ≥ 0.6`, call `setGoal(nav, sim, brain, bot, bot.obj.goal, bot.obj.urgency ≥ 0.6)` instead of the cover-band fallback |
| **H3** | `patrol` / `alert` states | `brain.anchor = bot.obj.goal` — idle bots orbit the objective instead of an authored campaign patrol route (there are no campaign patrol routes any more) |

**What the objective layer must NOT touch, ever** (and `probe_fairness.mjs` asserts each):
the reaction latch and its roll, the per-shot jitter σ, the forced first-burst miss, the
fire-token gate, the ≤3-attacker window, the muzzle-block raycast, the burst-counts-blows
rule, and the grenade telegraph. **Objective pressure changes where a bot goes and what it
prefers to stand behind. It never changes when or how accurately it shoots.** That is the
whole reason this design is a scoring term and a goal pointer rather than a new FSM state.

### 5.4 Role tables per mode

**TDM** — Part 2.5, above.

**CTF** — the team objective director re-evaluates every **2.0 s**, driven purely by the two
flag states (public, §5.1):

| Own flag | Enemy flag | Role assignment across 5 bots (or 4, when the human fills a slot) |
|---|---|---|
| `AT_STAND` | `AT_STAND` | 2 `runner`, 1 `support`, 2 `defender` |
| `AT_STAND` | `CARRIED` (by us) | 2 `escort`, 1 `support`, 2 `defender` |
| `AT_STAND` | `DROPPED` | 2 `runner` (goal = the drop point), 1 `support`, 2 `defender` |
| `CARRIED` (by enemy) | `AT_STAND` | 3 `interceptor`, 1 `defender`, 1 `runner` |
| `CARRIED` (by enemy) | `CARRIED` (by us) | 2 `interceptor`, 2 `escort`, 1 `support` — **the standoff** |
| `DROPPED` (ours) | any | the **nearest** bot becomes `returner` (goal = our dropped flag); the rest follow the matching row above with one fewer slot |
| any | our bot is carrying | that bot's role is forced to `carrier`, overriding everything |

Role definitions:

| Role | Goal | Urgency | Behaviour |
|---|---|---|---|
| `runner` | the enemy flag's current position (stand or drop point) | 0.7 | takes the ring route with the lowest team-danger sum; engages only what blocks the route |
| `carrier` | **own stand**, always | 0.9 | never engages voluntarily — fires only at a target inside 12 m with LOS, otherwise breaks contact and keeps moving; no tac-sprint, no grenade (parity with the human, §3.5); re-picks its route every 3 s from the three authored routes, scoring by team-danger sum |
| `escort` | a point 6 m ahead of the friendly carrier along the carrier's path | 0.6 | stays within 12 m of the carrier; prioritises any target that has damaged the carrier in the last 4 s |
| `defender` | own stand | 0.5 | holds cover with LOS to one of the three approaches (H1 handles this naturally: cover nodes near the stand score high); never chases past **20 m** from the stand |
| `interceptor` | **not the carrier's position — the carrier's projected path**: sample the enemy carrier's last-known position, path it to *their* stand with `nav.findPath`, and take the node **40 % of the way along that path** | 0.8 | this is the difference between chasing (always losing, the carrier has the head start) and cutting off (winning). If the carrier is unrevealed and unseen, the projection uses the team blackboard's last-known entry; if there is none, the interceptor falls back to `defender` |
| `returner` | our own dropped flag | 1.0 | shortest path, ignores everything else it can survive ignoring |
| `support` | the midpoint between the two stands, biased 60 % toward the enemy stand | 0.4 | the free slot; takes whatever role the director next finds short |

**FFA** — there is no director because there is no team. Each bot runs its own objective
evaluation every **2.0 s**:

| Condition (evaluated in order) | Role | Goal | Urgency |
|---|---|---|---|
| `hp < 40` | `disengage` | lowest-`danger` cell within 30 m (the FFA danger map from §4.4 is already built) | 0.9 |
| a marked leader is perceived and `hp ≥ 60` | `hunt` | leader's last-known position | 0.8 |
| two other actors are perceived fighting each other within 25 m and `hp ≥ 60` | `thirdparty` | a cover node with LOS to the fight's midpoint at 12–22 m | 0.7 |
| default | `rove` | `nav.randomPoint(<highest-danger cell within 45 m>, 10, rng)` — hunt the noise, not the map | 0.4 |

`thirdparty` is the rule that makes FFA read as FFA rather than as "TDM with nine teams".
Without it, bots simply duel the nearest actor and the mode feels identical to team
deathmatch with the labels changed.

**Target preference in FFA** (a preference, never a perception change): among candidates
that `perceive()` has already surfaced, weight the marked leader's awareness by **×1.5**
before the hysteresis comparison in §5.2.3. Legitimate because the marker is public (§4.2).

### 5.5 The team blackboard (what bots share, and its expiry)

`squad.js` already carries a shared last-known (`noteLastKnown` / `squadLastKnown`). In PVP
it becomes per team and gains three entries:

1. **Enemy last-knowns**, one per enemy actor: `{pos, t, source: 'sight'|'sound'|'hit'}`,
   **dropped when `t` is older than 8.0 s**. Only ever written from a teammate's
   `perceive()` output — never from a live transform (§5.1).
2. **Friendly death positions**, `{pos, t}`, dropped after 6.0 s. A teammate dying is public
   to their own team; this is what feeds the TDM `trade` role.
3. **Objective facts** — flag states, carrier identity, revealed-carrier position, the
   COLLAPSE ring. Public (§5.1), never expires.

FFA bots have a blackboard of one and share nothing. That is not a limitation to work
around; it is the mode.

### 5.6 Bot death and respawn

Bots respawn on the **same timer, through the same director, with the same protection** as
the human. A bot that spawns behind the human because "it's just a bot" is the fastest way
to make the mode feel rigged (`pvp_design §7.3.6`).

**On bot respawn, reset the brain:** `bot._brain = null` and `bot.percept = null`, so
`mkBrain()` and the perception scratch rebuild fresh. Without this the bot carries a latched
reaction, a stale confirmed target, and an 8-second-old `lastKnown` from a life that ended —
which both breaks the roll-once-and-latch semantics of `combat_spec §5.6` and produces the
"the bot knew where I was before it could see me" complaint. `bot.obj` is re-assigned by the
director on its next 2.0 s tick; until then `role = 'rove'` with the team's home anchor as
the goal.

Flag state is **match** state, not brain state — a bot carrier that dies drops the flag via
§3.3 and its brain reset is irrelevant to it.

---

## PART 6 — MATCH FLOW, START TO FINISH

### 6.1 Screens

```
FFG portal
  └─ BLACKRIDGE menu:  [ PLAY ]  [ SETTINGS ]  [ CONTROLS ]        (no CAMPAIGN entry)
       └─ MODE SELECT — three cards, each showing name, one-line pitch, and the RULES CARD
            [ SKIRMISH 5v5 ] [ CAPTURE THE FLAG 5v5 ] [ FREE-FOR-ALL 10 ]
            plus a difficulty row: ( CASUAL ) ( STANDARD ) ( HARD )
            HARD's card reads: "includes one VETERAN bot (reacts in 300-420 ms)"
       └─ LOADOUT — primary: Warden / Vesper / Corvus; secondary: Pike (fixed);
                    grenade: frag x1 (fixed).  [ START MATCH ]
       └─ WARM-UP 3.0 s — actors in place, look enabled, movement and fire locked,
                          rules card on screen for the full 3 s, 3-2-1 count
       └─ LIVE
       └─ ENDED — 3 s result banner, then 12 s scoreboard
       └─ POST-MATCH — [ REPLAY (same mode + difficulty) ] [ CHANGE MODE ] [ QUIT TO MENU ]
                       auto-advance to MODE SELECT after 20 s of no input
```

**Store-copy contract (doctrine §6):** the portal blurb, the menu and `game_meta.json` must
name exactly these three modes and **must not mention a campaign**. The campaign content
stays on disk (`content.json.mission`, `mission.js`) but is not reachable from any menu.

### 6.2 Rules cards (the exact text — the bots know the rules, so the human must too)

> **SKIRMISH — 5 v 5**
> First team to **60 kills** wins. **10 minutes.** Respawn in 4 seconds.
> No friendly fire. Assists count on the scoreboard, not on the team score.
> A tie goes to overtime: **no respawns, first death loses it for their team.**

> **CAPTURE THE FLAG — 5 v 5**
> First team to **3 captures** wins. **12 minutes.**
> **Your own flag must be at your stand to score.** Take theirs, get it home.
> Carriers can't tactical-sprint, can't throw grenades, and don't regenerate health.
> After 8 seconds of carrying, the enemy sees exactly where you are.
> A dropped flag returns in 30 seconds — or instantly if a defender touches it.

> **FREE-FOR-ALL — 10 players**
> First to **25 kills** wins. **10 minutes.** Everyone is hostile. Respawn in 3 seconds.
> Reach 15 kills or a 5-kill lead and **everyone can see you.**

### 6.3 The live loop, per actor

```
alive ──damaged──▶ (regen delay 5.0 s, then 28 HP/s)
      └─ hp <= 0 ──▶ dead
dead:  t+0.0   death event, killfeed row, drop flag if carrying, ledger written
       t+0.0   respawn countdown starts (TDM 4.0 / CTF 5.0 or 8.0 / FFA 3.0)
       t+1.2   death fade completes
       t+1.2   death cam: 2.5 s (TDM/CTF) or 1.5 s (FFA), framing the killer's last
               known position from the victim's body -- reconstructed from state the
               sim already has, never a replay stream
       any     loadout screen available while dead; the change applies on this respawn
       t+delay director picks a point (Part 4.3/4.4), actor spawns, protection arms
```

The human's and every bot's loop is the same object and the same code path. The only
difference is that the human's loadout comes from the UI and a bot's comes from its
archetype.

### 6.4 Pause, forfeit, and the shell contract (doctrine §6)

- `window.__PAUSE__ = {pause, resume, toggle}` — pause is **real and legal here**: it is a
  local single-player-shaped match, so pausing the sim pauses everyone. Gate the step
  function itself, and **discard the accumulator on resume** (doctrine §5: otherwise resume
  fast-forwards the debt).
- ESC opens the pause overlay: Resume / Settings / **Forfeit (confirm)**. ESC must never
  destroy a match silently.
- Forfeit routes through the same `match.end()` path as any other result, with
  `result:'forfeit'`, so the scoreboard, counters and stat write are identical.
- Tab is the scoreboard and is **held, not toggled** — a toggled scoreboard is a free look
  away from the game (`pvp_design §5.3`). Menu/shop hotkeys are gated while a match is live.

### 6.5 Persistence

`localStorage` only: matches played, W/L/D per mode, K/D, favourite weapon, best streak,
best FFA placing. Shown on the mode-select screen. Clearable. **No server-side stat
writes** — FFG registry writes require the `service_role` key and a browser client must
never hold one (memory: `reference_ffg_registry_service_key`). No ranks, no unlocks, no
currency, no XP.

---

## PART 7 — HUD REQUIREMENTS (per mode, exhaustive)

Built on the existing `core/hud/*` primitives (`createHud(ctx)`, `core/hud/hud.js:374`).
One type family, off-white + amber, red reserved for damage and death
(`visual_target §6`).

### 7.1 Shared (all three modes)

| Element | Position | Content | Source |
|---|---|---|---|
| Crosshair | centre | live `effectiveSpread` gap (`combat_spec §4.6`) — the reticle draws the number the bullets use | player weapon state |
| Ammo | bottom-right | `mag / reserve`, reload spinner matching `reloadS` exactly, dry-flash | `reloadStart`/`reloadDone` |
| Health | vignette | existing hurt vignette + audio muffle (`combat_spec §6`), scaled to 110 HP | `hurt` |
| Match clock | top-centre, right of the score | `M:SS`, counts down; turns amber under 1:00; `OT M:SS` in overtime | `match.clock` |
| Killfeed | top-right | 4 rows, 6 s TTL, `<killer> <weapon glyph> <victim>`; display names only, never internal ids; own kills amber, own deaths red; **bots carry the bot glyph** | `death` |
| Damage direction | 48 px ring | existing arc indicator, max 4 concurrent | `hurt` |
| Hit / kill markers | centre | existing (`combat_spec §4.1`) | `hitMarker` |
| Scoreboard (hold TAB) | full overlay | 10 rows: name, **band**, score, K, D, A, plus the mode column (§7.2–7.4); bots marked | `match.ledger` |
| Respawn timer | centre-lower | `RESPAWN IN 2.4` + `[L] LOADOUT` | `match` |
| Spawn-protection tell | rim shimmer on the actor | shared material, no light | `match` |
| COLLAPSE (overtime only) | through-geometry ring + banner | `COLLAPSE — MOVE TO THE PLAZA` + a metre readout to the ring edge | `match` |
| Result banner | centre | `VICTORY` / `DEFEAT` / `DRAW` + the reason line (`SCORE LIMIT` / `TIME` / `OVERTIME` / `FORFEIT`) | `match:end` |

**Enemies get no nameplate at any distance, in any mode.** Enemy position is earned with
eyes and ears. The two deliberate exceptions are objects, not people: the revealed CTF flag
marker (§3.5.5) and the FFA leader marker (§4.2) — and each is announced to the marked
actor so nobody is tracked without knowing it.

### 7.2 SKIRMISH-specific

- **Team score bar**, top-centre above the compass tape: `US 41 — 38 THEM`, AMBER/SLATE
  tinted. Pulses at `scoreLimit − 5`.
- **Teammate pips**: friendly nameplates through geometry at ≤ 40 m, 45 % opacity, **no
  health bars** (a health bar on a teammate makes the human a nurse, not a player).
- Scoreboard extra column: **damage dealt**.
- Objective markers: none.

### 7.3 CAPTURE THE FLAG-specific

- **Team score bar**: `US 1 — 2 THEM` (captures) + clock.
- **Flag strip**, directly under the score bar, two glyphs (AMBER, SLATE), each in exactly
  one of four states, each with its own colour and text:
  | State | Reads |
  |---|---|
  | `AT_STAND` | solid glyph, `HOME` |
  | `CARRIED` by the enemy | pulsing glyph, `TAKEN — <carrier name>` (identity is public the instant the flag leaves the stand; **position is not**, until the 8 s reveal) |
  | `CARRIED` by us | pulsing glyph, `<carrier name> — 34 m TO HOME` |
  | `DROPPED` | hollow glyph, `DROPPED — 22 m`, plus a return countdown `(18)` |
- **Objective markers**, compass-tape pips with metre readouts: your own stand, the enemy
  stand, your own dropped flag, and the enemy carrier **once revealed**.
- **Capture-blocked line** (the mode's teaching moment): `RETURN YOUR FLAG TO CAPTURE`,
  centre-lower, 2.0 s, rate-limited to once per 3 s.
- **PRESSURE banner** when active (§3.6).
- Scoreboard extra columns: **captures, returns, carry time**.

### 7.4 FREE-FOR-ALL-specific

- **Score strip**, top-centre: `YOU 12 · LEADER 17 (KESTREL)` + clock.
- **Leader marker** when armed: compass pip + a through-geometry chevron; if the marked
  leader is the human, the banner reads `YOU ARE MARKED` (nobody is tracked silently).
- **No teammate pips.** There are no teammates, and drawing anything friendly-shaped would
  be a lie about the mode.
- **All actors render with the hostile warm rim** (`#d9a441`). No team tints in FFA;
  "everything that moves is a target" is the mode's whole readability model.
- Scoreboard: 10 rows sorted by kills, the human's row highlighted, placement shown
  (`3 / 10`).

---

## PART 8 — DATA SCHEMA (what the build agent authors)

`content.json` gains a `pvp` block alongside the existing `mission` block. The campaign
block stays and stays valid — the contract gate in `mission.js` still runs against it, so
nothing that exists today breaks.

```jsonc
"pvp": {
  "map": "lanternwalk",
  "bounds": { "min": [-48, -2, -34], "max": [26, 14, 22] },
  "collapse": { "centre": [-5, 0, 0], "r0": 12.0, "r1": 6.0, "shrinkS": 30.0,
                "dps0": 5.0, "dps1": 15.0, "rampS": 20.0, "armsAfterOtS": 60.0 },
  "callsigns": ["NAVE","HOLT","KESTREL","MARLOW","ODESSA","PRYOR","QUILL",
                "RASK","SABLE","TALLOW","VANE","WREN"],

  "clusters": {
    "SC_SOUTH": { "rect": [[-14, 10], [8, 18]] },
    "SC_NORTH": { "rect": [[-34, -26], [-14, -19]] },
    "SC_EAST":  { "rect": [[16, 2], [25, 13]] },
    "SC_WEST":  { "rect": [[-47, -10], [-37, 4]] }
  },

  // 38 points, authored per pvp_design §2.1; every point gate-checked at bake
  "spawnPoints": [
    { "id": "sp_s01", "pos": [-8.0, 0.0, 14.5], "yaw": 3.14,
      "cluster": "SC_SOUTH", "cover": 0.8 }
    // ... 37 more
  ],

  "flags": [
    { "id": "flag_amber", "team": "amber", "stand": [-10.0, 0.0, 16.5],
      "standR": 1.2, "standH": 2.5 },
    { "id": "flag_slate", "team": "slate", "stand": [-26.0, 0.0, -23.0],
      "standR": 1.2, "standH": 2.5 }
  ],

  // three authored ring routes the CTF carrier/runner/interceptor roles score over
  "routes": [
    { "id": "rt_plaza",   "via": [[-10, 0, 10], [-5, 0, 0], [-16, 0, -14], [-26, 0, -23]] },
    { "id": "rt_arcade",  "via": [[-16, 0, 12], [-32, 0, -7], [-33, 0, -18], [-26, 0, -23]] },
    { "id": "rt_gallery", "via": [[4, 0, 12], [20, 0, -4], [20, 0, -18], [-2, 0, -22], [-26, 0, -23]] }
  ],

  "modes": {
    "skirmish": {
      "teams": 2, "perTeam": 5, "scoreLimit": 60, "timeLimitS": 600,
      "respawnS": 4.0, "protectS": 1.5, "spawnMode": "dynamic",
      "overtime": { "capS": 180, "respawn": false, "winOn": "firstDeath" },
      "points": { "kill": 100, "assist": 25 }
    },
    "ctf": {
      "teams": 2, "perTeam": 5, "scoreLimit": 3, "timeLimitS": 720,
      "respawnS": 5.0, "respawnPressureS": 8.0, "protectS": 1.5,
      "protectPressureS": 0.75, "spawnMode": "sideLocked",
      "homeCluster": { "amber": "SC_SOUTH", "slate": "SC_NORTH" },
      "trapFallback": { "amber": "SC_EAST", "slate": "SC_WEST", "durationS": 20.0 },
      "flag": { "pickupR": 1.2, "pickupDy": 2.0, "revealS": 8.0, "carryCapS": 120.0,
                "dropReturnS": 30.0, "stuckStrikes": 3, "stuckCheckHz": 1.0,
                "captureNeedsOwnFlagHome": true, "carrierTacSprint": false,
                "carrierGrenade": false, "carrierRegen": false },
      "pressure": { "enterS": 60.0, "resetS": 90.0 },
      "overtime": { "capS": 180, "winOn": "goldenCapture",
                    "collapseStandExemptM": 8.0 },
      "points": { "capture": 500, "grab": 50, "return": 100, "carrierKill": 150,
                  "defendKill": 50, "defendR": 12.0, "escortAssist": 50,
                  "escortR": 15.0, "kill": 100, "assist": 25 }
    },
    "ffa": {
      "teams": 10, "perTeam": 1, "scoreLimit": 25, "timeLimitS": 600,
      "respawnS": 3.0, "protectS": 2.0, "spawnMode": "ffa",
      "leaderMark": { "atScore": 15, "orLeadBy": 5 },
      "vetoOverrides": { "v1M": 14.0, "v2LosM": 30.0, "v3ConeM": 22.0,
                         "v10ClusterCooldownS": 3.0 },
      "overtime": { "capS": 180, "respawn": false, "winOn": "lastLeaderStanding" },
      "points": { "kill": 100, "assist": 25, "leaderKill": 150 }
    }
  },

  "botMix": {
    "casual":   { "team": ["recruit","recruit","regular","regular","hardened"],
                  "ffa":  ["recruit","recruit","recruit","recruit",
                           "regular","regular","regular","regular","hardened"] },
    "standard": { "teamFriendly": ["hardened","regular","regular","recruit"],
                  "teamEnemy":    ["hardened","regular","regular","regular","recruit"],
                  "ffa": ["recruit","recruit","regular","regular","regular","regular",
                          "hardened","hardened","hardened"] },
    "hard":     { "team": ["hardened","hardened","regular","regular","regular"],
                  "veteranSlots": 1,
                  "ffa": ["regular","regular","regular","hardened","hardened","hardened",
                          "hardened","hardened","veteran"] }
  },

  "archetypeSpread": { "team": ["cqb","rifleman","rifleman","marksman","rifleman"],
                       "ffa":  ["cqb","cqb","cqb","rifleman","rifleman","rifleman",
                                "rifleman","marksman","marksman"] }
}
```

### 8.1 Module map (delta against `pvp_design §8.2`)

| Lane | Files | Status |
|---|---|---|
| **G2 teams** | `core/sim/damage.js`, `core/ai/perception.js`, `core/ai/squad.js`, `core/ai/botfsm.js` | build (§5.2) — the highest-risk change, it touches the audited fairness surface |
| **G3 tuning fork** | `core/pvp/pvp_tuning.js`, `core/sim/sim.js` | build (§1.6) |
| **G4 lighting profile** | `core/render/lighting.js`, `core/render/weather.js` | build (`pvp_design §3.1`) — fixed light pool size, intensities only |
| **N2 match rules** | `core/match/match.js`, `core/match/modes/{skirmish,ctf,ffa}.js` | build — replaces `mission.js` as the driver |
| **N3 spawn director** | `core/match/spawns.js`, `core/match/influence.js`, `core/match/ffa_spawns.js` | build — THREE-free and Node-testable |
| **N4 PVP shell/HUD** | `core/hud/pvp_hud.js`, `core/hud/mode_select.js`, `core/hud/scoreboard.js` | build (Part 7) |
| **N6 bot objectives** | `core/match/bot_objective.js` | build (§5.3) — **new lane, not in `pvp_design`** |
| **N5 arena carve** | `core/level/layout.js` edits E1–E10 | build (`pvp_design §3.3`) |
| ~~**N1 net transport**~~ | ~~`core/net/*`~~ | **DELETED. Do not build.** (Part 0.2) |
| **G1 multi-map registry** | `core/level/maps/<id>.js` | **DEFERRED.** One map, three modes. `buildLayout(seed)` keeps its signature. The registry is only worth its refactor risk when a second arena exists. |
| `core/sim/mission.js` | — | **kept on disk, not wired.** `sim.mission` is null in PVP; PVP constructs `sim.match`. The campaign content and its contract gate stay valid so `sim.selftest.cjs --contract` keeps passing. |

### 8.2 Event vocabulary additions (`combat_spec` Appendix A extension)

`match:start{mode, difficulty, seed}` · `match:end{result, reason, scores}` ·
`match:state{from, to}` · `score{actor, delta, reason}` · `teamScore{amber, slate}` ·
`spawnActor{actor, pointId, clusterId, protectS}` · `spawnStress{actor, steps}` ·
`respawnTimer{actor, remainS}` · `flag:taken{flagId, actor}` · `flag:dropped{flagId, pos}` ·
`flag:returned{flagId, reason}` · `flag:captured{flagId, actor, team}` ·
`flag:revealed{flagId}` · `flag:captureBlocked{actor}` · `pressure{on}` ·
`collapse{armed, radius}` · `leaderMark{actor, on}` · `killfeed{killer, victim, weapon,
isHead, isCarrier}`.

The view subscribes to these and **never reaches into `sim.match`** (doctrine §4).

---

## PART 9 — TERMINATION PROOF (no mode may hang)

Doctrine §2 requires that every engagement ends. Here is every unbounded-looking state in
the design and the bound that closes it:

| State | Bound | Mechanism |
|---|---|---|
| A firefight between two actors | ≤ 90 s | existing referee: 40 s forced flank, 75 s push, 90 s episode close (`squad.js:29-31`, F5) |
| A bot stuck on geometry | ≤ 3 s | existing `brain.stuckT` repath; `stuckBotSeconds == 0` is a battery gate |
| A dead actor | ≤ 8.0 s | respawn delay, worst case CTF PRESSURE |
| A CTF carry | ≤ 120 s | carry cap, force return |
| A dropped CTF flag | ≤ 30 s | auto-return |
| A CTF flag off the nav mesh | ≤ 3 s | 1 Hz validation, 3 strikes, force return |
| A CTF flag standoff (both out) | ≤ 90 s | PRESSURE at 60 s, forced double reset at 90 s |
| A CTF match with no captures | ≤ 12:00 + 3:00 | tie-break chain led by flag pressure (a turtle loses), then overtime, then draw |
| Regulation play | = the mode's time limit | clock |
| Overtime | ≤ 3:00, and in practice ≤ ~88 s | COLLAPSE arms at +60 s and kills an actor outside the ring within 7.3 s at full rate |
| An FFA leader hiding at 24 kills | ≤ time limit | leader marker armed at 15 kills makes hiding non-viable; then the clock; then overtime + COLLAPSE |
| Warm-up | 3.0 s | fixed |
| Post-match | 20 s | auto-advance |
| **Anything not covered above** | `timeLimit + 180 + 15` | **the watchdog** (§1.4), which force-ends the match and logs. A probe asserts it never fires. |

Passivity never wins in any branch: TDM and FFA overtimes are decided by *first death*, and
CTF's first non-capture tie-break is *flag pressure*, which requires an attack to score on.

---

## PART 10 — ACCEPTANCE GATES (FAIL-class, headless, exit-code)

These are additional to the existing v1 gates (`BUILD_PLAN Part 5`), which all still apply.

### 10.1 Map / data gates (per bake)

- `probe_props.mjs` → exit 0 (zero floats, zero clips) after the carve.
- **Spawn-point validity:** 30–50 points; every point nav-walkable (`nav.onNav`); ≥ 2.0 m
  from any collider face; ≥ 8 m of unobstructed forward view along `yaw`; every cluster
  ≥ 6 points spread over ≥ 250 m².
- **CTF stand constraints:** no spawn point within 6.0 m of either stand (V8); no spawn
  point with LOS to its own stand from under 10.0 m (V9); each stand has ≥ 3 distinct
  approach paths (`nav.findPath` from three different clusters produces three
  non-overlapping final 8 m approaches).
- **Loop probe:** a nav path exists between every pair of spawn points and from every spawn
  point to both flag stands; no path traverses the same corridor cell twice.
- **Balance probe (carve rule 3, measured not assumed):** spawn-centroid distance to arena
  centroid within ±8 %; cover count within 30 m within ±15 %; longest sightline within
  ±10 m; **stand-to-stand route time within ±2.0 s at walk speed for the three authored
  routes in each direction**; and the CTF trap-fallback asymmetry (§4.3.2) measured and
  reported — if `|SC_EAST→flag_amber − SC_WEST→flag_slate| > 6.0 m`, points move.
- **Boundary probe:** every arena-edge collider has a visible mesh within 0.5 m (no
  invisible walls), sampled every 2 m along the boundary.
- **FFA veto override declared:** `content.pvp.modes.ffa.vetoOverrides` present and
  non-default, per §4.4.

### 10.2 Mode gates — the bot-only battery (this is the real proof)

Run **1 scripted human persona + 9 bots × 20 seeds × 3 modes**, headless, THREE-free, using
the `combat_spec §8.2` personas (Novice / Tactician / Rusher) plus a fourth, **Idle** (never
moves, never fires) — Idle is the passivity test.

| Gate | Assertion |
|---|---|
| **Termination** | every match reaches `ended`; **the watchdog never fires**; `stuckBotSeconds == 0` |
| **Match length** | median regulation length: SKIRMISH 6:00–10:00, CTF 6:00–12:00, FFA 6:00–10:00 |
| **Spawns** | **zero deaths within 2.0 s of spawning**, all modes, all seeds — this is the spawn director's actual pass/fail; median `spawnStress` ≤ 0.5 |
| **Side balance (TDM/CTF)** | over 20 seeds, `|mean margin|` < 8 kills (TDM) / < 1.0 captures (CTF) — neither spawn cluster is the winning one |
| **CTF comprehension** | **≥ 80 % of seeds contain at least one capture**; `flagStuckResets == 0`; the stalemate forced-reset fires **≤ 1 per match**; `flag:captureBlocked` fires at least once across the battery (proving the rule is reachable and the teaching line works) |
| **CTF roles** | in every seed, at least one bot spends ≥ 20 s as `defender` and at least one completes a `returner` return; the `interceptor` role produces at least one carrier kill across the battery |
| **FFA comprehension** | over 20 seeds, **the hardened bots' mean final placing is better than the regulars', which is better than the recruits'** — band ordering must survive in the scoreboard, or the bots are not playing the mode, they are milling; the `thirdparty` role fires ≥ 3 times per match |
| **Passivity** | with the **Idle** persona: the match still ends; Idle never wins, never draws, and never finishes above last place in FFA |
| **AI honesty** | with a scripted human who never fires and never enters any bot's view cone, **zero bots ever set a goal within 10 m of the human's true position** (§5.1) |
| **Fairness surface intact** | `probe_fairness.mjs` extended to the two-team and ten-team worlds: zero shots before the rolled reaction; latch variance 0; jitter σ within ±10 % of band; ≤ 2 fire tokens per squad; ≤ 3 damaging attackers on a **human** in any 250 ms window; zero muzzle-blocked pulls; burst counts rounds |
| **Tuning fork honest** | `sim.selftest.cjs --pvp`: every STK in `pvp_design §4.1`; `steadyMult === 1.0`; no PVP TTK below 220 ms; **HP is 110 for every actor including bots**; the SP table is bit-identical to the untuned `WEAPONS` export |

### 10.3 Perf gates (30 fps target)

Measured in the new worst case: **10 actors visible, 6 shooting, PVP lighting profile, plaza
centre, rain on**.

- Sim: ≤ 3.0 ms per **tick**, AI share ≤ 1.5 ms per tick — i.e. **≤ 6.0 ms per rendered
  frame at 30 fps** (§0.3).
- `simStepsDropped == 0` over a full match on the reference rig.
- Draw calls ≤ 320 median.
- `programs delta == 0` during the first firefight — the AMBER/SLATE rim tint must be **one
  material with a uniform**, not two materials (a second material is a shader permutation).
- p99 frame time ≤ 40 ms (i.e. no frame worse than 25 fps) during a 10-actor firefight with
  grenades.

### 10.4 Live verification (done = observed effect, doctrine §5)

Not optional and not replaceable by the probes: **play one full match of each mode in a real
browser on the deployed URL**, confirm the version marker and one new-code fingerprint, and
confirm by observation that (a) every match ended with a banner, (b) a CTF capture happened,
(c) the FFA leader marker armed and was visible, (d) the killfeed named bots as bots.
A probe-green build that has never finished a live CTF match is not done.

---

## PART 11 — BUILD ORDER

1. **G2 + G3 + N3 (team spawns) with no modes at all.** 5v5 bots-vs-bots deathmatch on
   Lanternwalk, headless, verified by `sim.selftest.cjs` and `ai.selftest.cjs`. *If 5v5
   bots-versus-bots is not fair and does not end, nothing after this matters.*
2. **N2 SKIRMISH + N4 minimal HUD.** Human plays. Done = a finished match in a real browser
   with a result banner.
3. **N5 carve edits E1–E10** and re-run the map gates (10.1). The arena is not the campaign
   map with a smaller box around it until E6 and E7 exist.
4. **N6 bot objectives + TDM roles.** Measure: does the team read as a team?
5. **CTF** — flags, state machine, roles, PRESSURE, HUD strip. This is the largest single
   mode and it is third on purpose: it needs the objective layer to already work.
6. **FFA** — ten-teams-of-one identity, the FFA director, leader marker, `thirdparty` role.
   Second-largest, and it depends on the danger map which the FFA director introduces.
7. **Overtime + COLLAPSE + the watchdog**, then the full Part 10 battery, then 10.4.

---

## PART 12 — FREEZE AMENDMENTS AND OPEN QUESTIONS

**Amendments requested (each is narrow, each has its reason above):**

1. **`pvp_design §7.2`'s blanket ban on the Veteran band** — narrowed to: veteran available
   only inside the HARD preset, capped at 1, labelled on the mode-select card, off by
   default (§1.7). Reason: the ban's premise was a public mixed lobby where a losing human
   cannot tell whether the loss was fair; with one human who explicitly selected HARD, that
   premise does not hold.
2. **`damage.js` gains two match hooks** beside the existing mission hook (§5.2.1). Additive,
   two lines, one file.
3. **`botfsm.js` gains three objective hooks** H1/H2/H3 (§5.3) — a scoring term, a goal
   source, and a patrol anchor. **No change to any fairness constant**, asserted by 10.2.
4. **`perception.js` target generalisation** (§5.2.2) — the single largest change in the
   expansion and the one most likely to break the audited fairness surface. It ships with
   the hysteresis rule in the same commit, never after.
5. **`sim.state.phase` is left frozen.** PVP uses `'assault'` while live and `'won'`/`'lost'`
   at the end, with `sim.match.result` as the real outcome (§1.3/§1.4). This is a deliberate
   compatibility choice to avoid touching F3's dormancy gate; if a later cleanup wants a
   `'match'` phase, that is a separate amendment with a one-line follow-on in `botfsm.js:164`.

**For the owner:**

6. **Score limits are arithmetic, not measurement.** 60 / 3 / 25 are derived in §2.1, §3.2
   and §4.1 from population scaling and expected kill rates. The Part 10.2 battery measures
   the real match lengths, and **if the medians fall outside the stated windows the numbers
   change, not the design**. Expect one tuning pass after the first battery.
7. **The campaign is not deleted, it is unwired.** `content.json.mission` and
   `core/sim/mission.js` stay on disk and stay contract-valid so the existing selftests keep
   passing; no menu reaches them. Say the word if you want them actually removed — that is a
   deletion decision, not a build task.
8. **Publish flip stays the owner's call** (established FFG rule). This spec does not change
   `game_meta.json` status.
9. **Store copy must be corrected in the same release**: the portal blurb and menu must name
   Skirmish / Capture the Flag / Free-for-all and must not mention a campaign
   (doctrine §6: store copy is a contract).

**Deliberate cuts, so nobody "finds" them missing:** no second map (G1 deferred, §8.1); no
Foothold or Blackline (not among the three modes); no killcams (the 2.5 s death cam is the
honest 90 %-of-the-value version); no attachments, unlocks, XP, currency or leaderboards
(§6.5); no aim assist; no prone; no melee; no multiplayer of any kind — this is a
single-process game with nine bots, and every line of this document depends on that.

---

*Sign-off: every on-disk claim in Part 0.1 traces to a file read while writing this document
and is cited by path and line. Every rule inherited from `pvp_design.md` is either cited or
explicitly overridden with its reason. The two numbers this document invents from arithmetic
rather than measurement — the score limits and the expected match lengths — are labelled as
such in three places and are gated by a battery that measures them.*
