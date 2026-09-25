# BLOCKTOOTH — GATEKEEPERS contract (size gates: 3 gatekeepers + the city boss at Size IV)

The build contract for the owner's request: "a COOL way to get past certain levels where you GROW larger
... is by fighting bosses to get to that next stage ... each should require a boss, or miniboss", then
the count he settled on: "it would be 3 mini bosses wouldnt it, level 7 is first miniboss, 16 and 27 and
level 35 is the main boss?".

It uses the same register as `_spec/CONTRACT.md` and `_spec/FEATURES_V2.md` and **extends** both. Every
rule in them still applies: CONTRACT §0 lane rules, §1 IP lock, §2 conventions, §5 sim architecture, §10
boss framework, §15 gates; FEATURES_V2 §0 ground rules, §2.3 tick order, §2.7 pre-wiring discipline,
§15.4 lane gates. Where this file and either of them disagree, **this file wins for the gatekeeper
features only**.

**The agreed structure** (unchanged `RANK_LEVELS = [1, 7, 16, 27, 35]`):

| LV reached | Fight | Guards | Titan size during the fight | On the kill |
|---|---|---|---|---|
| 7 | **STENCIL-1** (gatekeeper 1) | the Size I → II breach | Size I, held at its ceiling (3.1 m) | MASS BREACH to Size II |
| 16 | **CORDON-2** (gatekeeper 2) | Size II → III | Size II, held (10.8 m) | MASS BREACH to Size III |
| 27 | **SWITCHBOARD-5** (gatekeeper 3) | Size III → IV | Size III, held (25.6 m) | MASS BREACH to Size IV |
| 35 | the **city boss** (PARKADE-6 in GRID-EAST, IRON GULLY in WHITE STACKS, CAISSON-4 in LOCKWATER) | Size IV → V | Size IV, held (50 m) | the last MASS BREACH, to Size V, as the **VICTORY FINALE**: a short Size V rampage, then the front page. KEEP GOING continues at Size V |

Read in this order: §1 names, §2 the loop, §3 the three gatekeepers, §4 the city boss at Size IV and the
finale, §5 pacing and GATE 2, §6 interactions, §7 sim/view split and the exact TypeScript, §8 build plan,
§9 owner decisions, §10 evidence.

**Revision 2 (2026-09-25)** answers an independent review: two blockers (a soft-lock loop through
add-soaked auto-attacks; multi-tell volleys with no walkable exit) and seven majors. Every finding and
its resolution is in the **Review log** at the end.

**What was measured for this revision (2026-09-25, tool output in §10)**, not assumed:
* the current tree passes GATE 2 (`probe_sim --det 0`, seed 1337: 10/12 clears, 2 deaths, PASS), with
  LV 7 / 16 / 27 / 35 reached at a median of **106 / 233 / 364 / 437 s**;
* a scratch **hold emulation** on the real sim (the size held at each gate level for a fixed fight time,
  then the real rank-up; the city boss spawned at LV 35 and fought at Size IV with today's
  `BOSS_HP_SCALE[3]`), 12 runs per variant. **The first version predicted a GATE 2 FAIL**: 2 of its 3
  variants had a clear under 480 s (414 s and 451 s), which `probe_sim` hard-fails (§5.1). The design
  was changed (catch-up off during fights, the city boss's spawn floor `mainEarliestS` 440 s, a governed
  XP rate at rank 3 while the city boss is pending or alive), and the **re-run** (4 variants, 48 runs)
  has **0 clears under 480 s** (502–664 s), 10–12 of 12 clears per variant, city-fight medians 126–135 s;
* the gate bot's **single-target DPS at each held size** (a frozen high-HP dummy, 20 s per level):
  median **30 / 137 / 553 / 1 509 per s** at LV 7 / 16 / 27 / 35. Gatekeeper HP is derived from it.

---

## §0 Preconditions and ground rules

1. **Built after the v2 build lands.** The v2 lanes are still editing `titansim.ts`, `director.ts`,
   `bosses/index.ts`, `game.ts`, `hud.ts` and the harness. No gatekeeper lane starts until the v2 final
   battery (FEATURES_V2 §15.5) has passed, as observed by the orchestrator. Numbers here refer to v2 and
   growth constants **by name** (`RANK_LEVELS`, `titanHeightAt`, `spawnRing`, `bossH`, `fairWindup`,
   `BOSS_HP_SCALE`, `ULT.bossCapFrac`) so they survive v2's last tuning.
2. **Lane K0 (SKELETON) runs alone first** (§8.1). It merges the types and config, creates every new
   module as an inert stub, and pre-wires every call site. After K0 the game plays and passes GATE 2
   **exactly as before** (the stub opens every gate), so later lanes only fill their own files.
3. **Sim/view split holds** (CONTRACT §0.3). Gatekeepers, the gate loop and the finale are sim code:
   THREE-free, DOM-free, deterministic, rolls only from `world.rng.boss` (fight AI) and `world.rng.spawn`
   (the adds SWITCHBOARD-5 summons). No new RNG stream, so no existing stream shifts.
4. **Gatekeepers are bosses in the framework.** They live in the single `w.boss` slot and are built from
   the `bosses/index.ts` toolkit (`bossH`, `fairWindup`, `bossTelegraph`, parts, meter, stagger,
   phases, `watchDash`, `keepRange`), so the camera's boss framing, titan targeting, `damageBoss`,
   `bossUltHit`, the nameplate, the bot's boss branch and the boss views all work on them unchanged. What
   differs is carried by one new field, `BossState.role: 'main' | 'gate'` (§7).
5. **Only one fight at a time.** A gatekeeper, the city boss and an EXTENDED COVERAGE rematch never
   overlap. A lock that comes due while another fight is alive waits for it.
6. **Originality (CONTRACT §1, FEATURES_V2 §0.7) is absolute.** §1 lists every new name and the checks
   run. No gatekeeper resembles a main boss, RAMROD, the reference video's siege centipede, or any
   existing kaiju / mech / game design (§3.5).

---

## §1 Name register (all new names; use exactly these)

| Thing | Name | Notes |
|---|---|---|
| The system (docs; never on screen) | **gatekeeper** | on-screen kicker is `GATEKEEPER` |
| The idea on screen | **HEIGHT LIMIT** | HALVARD enforces a height limit at each Size ceiling; beating the enforcer lifts it |
| HUD lock line | `SIZE LOCKED — BEAT <NAME>` · `SIZE LOCKED — <NAME> EN ROUTE` (before it spawns) | on the GROW bar (§6.6) |
| Gatekeeper 1 | **STENCIL-1**, "HALVARD ROAD-MARKING UNIT" | meter **SPILL**, stagger **TIPPED OVER**, weak point **the DRUM** |
| Gatekeeper 2 | **CORDON-2**, "HALVARD CROWD-BARRIER UNIT" | meter **STALL**, stagger **STALLED**, weak point **the PACK** |
| Gatekeeper 3 | **SWITCHBOARD-5**, "HALVARD MOBILE SWITCHBOARD" | meter **FEEDBACK**, stagger **LINES DOWN**, weak points **the DISHES** |
| Kill stamp (fx word) | `LIMIT LIFTED` | over the wreck, before the MASS BREACH banner |
| Hazard | **WET PAINT** | STENCIL-1's slow puddles and stripes |
| Attacks | STRIPE RUN · PAINT BUCKETS · DOUBLE LINE · U-TURN (STENCIL-1); SHIELD SHOVE · SAWHORSE TOSS · BACKFIRE · SQUAD BEHIND THE LINE (CORDON-2); CALL-IN · PUT THROUGH · HOLD MUSIC · RELOCATE (SWITCHBOARD-5) | |
| Finale banner | `THE CITY GOT SMALLER.` | the tabloid masthead line, used once as a live broadcast beat (§4.3) |
| Goals (6) | TIPPED OFF · LINE CROSSED · HANG UP · WITHOUT A DENT · OVER THE LIMIT · REISSUED | §6.5 |
| Cards (5, locked) | Fresh Coat · Sawhorse Stack · Call Waiting · Blanket Exemption · Carbon Copy | §6.5 |
| Perk (locked) | **DEFERRED MAINTENANCE** | every gatekeeper arrives with its meter at 25 % |

**Checked against the current source** (`grep -rilw` over `src/`, 2026-09-25): 0 hits each for cordon,
switchboard, gatekeeper, sawhorse, "wet paint", "height limit", "size locked", "hold music", klaxon,
reissue(d), "call waiting", "lines down", "tipped", "line crossed", "hang up", "without a dent",
"over the limit", exemption, blanket, carbon, deferred (UI code only), maintenance, coat. "stencil",
"spill" and "stalled" appear only in code comments or a renderer option, never as a name.
**Rejected because they repeat an existing name or its distinctive word:** "ORDINANCE" (cards Noise /
Heavy Tread / Tripwire / Overgrowth Ordinance), "VARIANCE" (Zoning Variance, Hinge Variance),
"WAIVER" (Speed Bump Waiver), "APPEAL" (Appeals Process), "PAPERWORK" (goal PAPERWORK), "SIGNAL"
(goal SIGNAL BOOST), "INSPECTION" (perk SAFETY INSPECTION), "REPEALED" (Weed Ordinance Repealed),
"ASPHALT" (an existing card), "CONE" (IRON GULLY's CONE BREATH), "BARRIER" (PARKADE-6's BARRIER ARM),
"PYLON" (a city prop kind), and "DISPATCH" (the title of an existing video game).

---

## §2 The loop

### 2.1 Lock
When a level-up reaches `RANK_LEVELS[s]` for the next Size `s` (`s = gates.unlocked + 1`), the rank-up
does **not** happen. Instead `titansim.grow()` calls `lockGate(w, s, false)`:
* `gates.pending = s`, `lockT = w.t`, `dueT = max(w.t + GATES.summonDelayS, lastBreachT + GATES.chainGapS)`;
* event `gateLocked {slot: s, capped: false}`; alert `gate1` / `gate2` / `gate3` (the city boss uses the
  existing `boss` alert when it spawns);
* the HUD GROW bar turns to `SIZE LOCKED — <NAME> EN ROUTE`.

At `dueT` (and when no fight is alive) `stepGates` spawns the gatekeeper (`spawnGate`) or, for `s = 4`,
the city boss (`spawnBoss(w, BIOMES[biome].boss)`). `gates.active = s`.

### 2.2 What is held while it is alive (decided)
* **The Size is capped at the current tier.** `grow()` never ranks past `gates.unlocked`. `canFlatten`,
  `hpMul`, `dmgMul` and the camera curve stay at the held Size.
* **Per-level growth pauses at the tier's ceiling.** The gate level's own step still lands (for
  example LV 7 takes the body from 2.66 m to the Size I ceiling `titanHeightAt(0, 7)` = 3.125 m =
  `RANKS[1].height / BREACH_JUMP[1]`). Levels gained after that add **no height**:
  `titanHeightAt(rank, level)` already clamps at the ceiling, so no new formula is needed. The view
  plays a "strain" beat instead of the grow pop (§6.7).
  *Why pause:* a body pressing against a visible ceiling is what sells `SIZE LOCKED`; a body that kept
  growing would make the gate feel cosmetic. *Why nothing is wasted:* the breach lands at
  `titanHeightAt(newRank, level)`, so every level banked during the hold is paid back in the jump (LV 9
  at the Size II breach lands at 5.93 m instead of 5.0 m).
* **XP, levels and drafts keep flowing** at the base rate (every level-up still owes a draft).
* **The pacing catch-up is suspended while a fight is alive.** `paceMul` returns 1 while
  `fightAlive(w)`: the rubber band exists to rescue slow eaters, not to flood XP into a locked bar
  mid-fight. After the fight the normal band resumes (§5.2). The one exception is rank 3 with the city
  boss pending or alive: `paceMul` is then `AHEAD_MIN` (0.35) so the climax is not cut into draft
  screens every ~11 s (§4.2).
* The status card shows `LV n · SIZE I` with a padlock chip; the GROW bar is full, hazard-striped and
  reads `SIZE LOCKED — BEAT STENCIL-1`.

### 2.3 Arrival telegraph
1. `gateLocked` (the lock tick): alert banner (copy in §7.4), a padlock-ratchet sting, and the GROW bar
   change.
2. `+GATES.summonDelayS` (1.5 s): the gatekeeper spawns off-screen at `GATES.entryRingMul` (1.15) ×
   `spawnRing(w)` on the titan's heading side (±30°, `rng.boss`; the opposite side when that is out of
   bounds). Event `gateSpawn`; the **nameplate** appears in its GATEKEEPER variant (§6.6); an **edge
   arrow** marker (`MarkerKind 'gate'`) points at it while it is off-screen.
3. Intro `GATES.introS` (3 s, invulnerable): it drives or walks in at 1.4 × the titan's walk until it
   is inside its range band, with its arrival voice (§6.8).

### 2.4 Avoiding it: hunting and containment pressure (no soft-locks)
A player who runs from a gatekeeper does not grow, and the city gets worse. A player who **stays and
fights** is never punished by the same machinery, even when adds soak every auto-attack (that was the
failure the city bosses' `BOSS_FATIGUE` comment in `config.ts` documents: "titans whose auto-attacks were
soaked by adds … dragged fights past 200 s"; it was fixed by running fatigue on fight time, and the
rules below keep that fix for gatekeepers).
* **Engagement is proximity, not damage.** A tick is *engaged* when either
  (a) the titan's centre is within the gatekeeper's **band max + `GATES.engageMarginH` (0.5) × H** of
  the rig's centre (the band is below; SWITCHBOARD-5 measures from the base while it RELOCATEs), or
  (b) the titan damaged the gatekeeper **or one of its adds** (SWITCHBOARD-5's PUT THROUGH crews,
  CORDON-2's SQUAD BEHIND THE LINE) within the last `GATES.engageHitS` (5) s. `damageBoss` writes
  `b.data.lastHitT`; `hitEnemy` writes `w.gates.lastAddHitT` when the enemy's id is in the gatekeeper's
  add list (§3.3). `gates.engagedS` counts engaged seconds; `gates.ignoredS` counts the rest.
* **The band** each gatekeeper hunts from is explicit: STENCIL-1 `[3.0, 6.0] H`, CORDON-2 `[1.6, 3.5] H`,
  SWITCHBOARD-5 `[1.67, 4.5] H` (centre to centre; §3.1–§3.3). "Past its band" = farther than the band's
  max.
* **Hunt.** Past its band a gatekeeper closes at up to `GATES.huntClose` (0.95) × the titan's walk
  speed (the city bosses close at 0.6), and at `huntHot` (1.05) from pressure 2. A titan that stops
  is caught. The hunt uses the stuck rule of §3.0, so buildings cannot pin it.
* **Cut-off.** A titan farther than `repositionRingMul` (2.2) × spawnRing for `repositionS` (4 s) is
  cut off: the gatekeeper re-enters off-screen on the ring ahead of the titan (`gateReposition` event,
  subtitle `CUTTING YOU OFF`, no intro and no invulnerability).
* **Containment pressure** (0–3) rises only while the titan is **not engaged**: +1 per
  `pressure.everyS` (20 s) of accumulated `ignoredS` since the last change; −1 per `decayS` (10 s) of
  engaged time. A titan inside `band max + 0.5 H` of the rig is engaged by rule (a) whatever it hits,
  so pressure **can only fall** while it stands in the fight, however many adds are soaking its
  attacks. (Standing in the band without attacking is not an exploit: fatigue then takes ~101 s and
  the rig keeps attacking.) Per level: director
  budget × (1 + 0.35 p), gatekeeper attack gaps × (1 − 0.1 p), gatekeeper damage × (1 + 0.15 p), PUT
  THROUGH timer × (1 − 0.1 p). Pressure 1 and 3 raise `alert gateEscalate` and the `gateEscalate` event.
* **Fatigue has a floor on fight time.** Gatekeeper fatigue (§3.0) runs on
  `fatigueClock = max(gates.engagedS, 0.5 × gates.liveFightS)`, where `liveFightS` is the time since the intro ended.
  Engaged play wears it down at full rate; a runner still wears it down at half rate, so no pattern of
  play can make a fight unbounded, and waiting it out still costs twice as long plus pressure.
* **Targeting helps the fighter.** While a gatekeeper is alive and one of its weak points is **open**
  (`b.data.weakMask`, §3.0) and within the titan's reach, `findTarget(…, preferEnemies = true)` returns
  that part **before** any enemy (K0 edit in `combat/targeting.ts`; city bosses unchanged). VOLT-KITE's
  fork chain (`voltkite.ts nextTarget`) keeps its order (enemies first): the primary strike lands on
  the weak point and the forks clear the adds, which is the intended read of SWITCHBOARD-5.
* **No soft-lock is possible, by construction:** (1) the gatekeeper always comes to the titan (hunt,
  stuck rule, cut-off); (2) a pending lock with no fight alive always spawns at `dueT`; (3) fatigue's
  clock grows at ≥ 0.5 per fight second, and fatigue alone empties a full-HP rig by a clock of about
  101 s (`GATES.fatigue` §7.2: the ramp sheds 0.0003 × 41.7² ≈ 52 % by clock 81.7 s, when the 2.5 %/s cap
  is reached, and the last 48 % takes 19 s), so a fight lasts at most ~101 s engaged and ~202 s for a
  titan that never engages at all (it is then also at pressure 3); (4) pressure cannot
  climb while the titan is engaged, so adds soaking auto-attacks cannot feed themselves.
  `probe_gatekeepers` asserts all four (§5.4 cases 7 and 7b).

### 2.5 The kill: the breach ON the kill tick, plus rewards
In `bosses/index.ts defeat()`, a gatekeeper (`role 'gate'`, slot s) pushes `gateDefeated` and sets
`gates.breachDue = s`. The breach itself runs in **`flushGateBreach(w)` at the end of `stepWorld`**
(after every system, before `checkRunEnd`), which calls `onGateDefeated(w, b)` on the **same tick**.
*Why at the tick's end:* a kill can land inside a kit's attack loop (`hitTarget` → `damageBoss`), in the
middle of VOLT-KITE's fork chain or a HEARTHBACK multi-hit; breaching there would run `recomputeStats`
mid-attack, so the later forks of that tick would use the new Size's stats. Kills from projectiles and
hazards (stepped after `stepTitan`) land at the same flush. `onGateDefeated`:
1. calls `breachTo(w, s)`: sets `gates.unlocked = s`, tops the level up if it is below `RANK_LEVELS[s]`
   (§2.7), then runs the real rank-up path, so everything today's MASS BREACH does happens on the kill
   tick: `rankUp` event, `recomputeStats`, the +15 % heal, the `GROW_TWEEN_S` tween, the camera punch,
   the `MASS BREACH` banner, the roar and news sting, the 0.25 s app hit-stop, and `rankUp`-trigger cards
   (Certificate of Occupancy, Groundbreaking Ceremony);
2. drops a **chest** pickup at the wreck (the existing chest flow → a rare+ chest draft);
3. adds **+40 UPROAR** (`addUproar(w, GATES.reward.uproar)`, × the `ultCharge` stat);
4. stuns every enemy SWITCHBOARD-5 summoned that is still alive for 3 s (CALL DROPPED);
5. sets `gates.active = 0`, `pending = 0`, `breachDue = 0`, `killT[s]`, `lastBreachT = w.t`, then calls
   **`checkGateLock(w)`** directly (the same check `grow()` runs after its loop, exported from
   `titansim.ts`): if the level is already at or past the next gate level, the next gate locks on this
   tick (its `dueT` honours `chainGapS`, 20 s). *Why:* `grow()` only runs from `addXp` / `growToRank`, so
   a chained lock would otherwise wait for the next level-up.

The city boss's kill uses the same flush (`gates.breachDue = 4` → `onMainDefeated`, §4.3).

**Invariant (asserted, §5.4):** a `rankUp` to rank r ≥ 1 happens only on a tick that also has
`gateDefeated` for slot r (r ≤ 3) or `bossDefeated` of the city boss (r = 4), or on a dev-cheat tick.

### 2.6 Death
A normal run end (`runEnd dead`), unchanged. The dead front page names who held the titan when the death
happened during a gate fight: the sub-head `HELD AT SIZE II BY CORDON-2` (`TabloidExtra.heldBy`, §6.6).

### 2.7 Fallback for an under-levelled titan (time caps)
`stepGates` locks slot `s` at `GATES.capS[s]` = **165 / 320 / 430 s** for the gatekeepers and **540 s**
(`BOSS_AT_S`) for the city boss, even below the gate level (`gateLocked {capped: true}`), when nothing is
pending, no fight is alive and `chainGapS` has passed. The city boss's cap also needs `unlocked === 3`;
if SWITCHBOARD-5 is still alive at 540 s, the city boss comes `chainGapS` after its kill. On a capped
kill `breachTo` **tops the level up** to `RANK_LEVELS[s]` with exact XP (no multipliers, like
`gainGrowth`), so the levels are real and their drafts are owed (`gates.topUpLevels` counts them). This
keeps the invariant "Size r ⇒ LV ≥ RANK_LEVELS[r]" that `titanHeightAt`, `sizeProgress` and the HUD rely
on.

**What the caps are, and are not.** They are a **liveness** guarantee (a starved run always reaches
every fight), not a pacing tool. Each cap sits just outside its own spawn band (165 vs 60–150, 320 vs
170–320, 430 vs 270–450 only through the cap itself), so **a cap firing in the GATE 2 matrix is a GATE 2
failure by design**: it means the XP economy, not the net, delivered the run. Worst case with every cap
firing and every fight at its hard maximum (gate fights 90 s spawn→kill, `chainGapS` 20 s,
`summonDelayS` 1.5 s, the city fight 170 s): G1 locks 165 → dies ≤ 256.5; G2 locks 320 → dies ≤ 411.5;
G3 locks max(430, 411.5 + 20) = 431.5 → dies ≤ 523; the city boss locks max(540, 523 + 20) = 543 →
spawns 544.5 → 4 s intro → dies ≤ **718.5 s**, inside 720. `capS[3]` moved from 460 to **430** for this
(at 460 the same chain ended at 740 s). The measured LV 27 arrivals (≤ 410 s in the re-run emulation, §5.1) stay below 430.

### 2.8 RAMROD stays a separate elite (decided)
RAMROD is an `Enemy` (a charging dozer with a lane tell and a chest), not a parts/meter/phase rig, and a
charge-lane dozer is already STENCIL-1's STRIPE RUN idea at a smaller scale. Keeping it separate keeps
the elite beat and its chest economy. Its schedule changes only by a hold: the director never spawns an
elite while a **gatekeeper** lock (slot 1–3) is pending or any fight is alive
(`!(gates.pending >= 1 && gates.pending <= 3) && !fightAlive(w)`); a pending city-boss lock that is
waiting for `GATES.mainEarliestS` (§4.1) does not hold it. The schedule is **set explicitly** in
`director.ts` (a §7.3 row), replacing today's `min(ELITE_AT_S, Size IV + 30 s)`: on the tick of
SWITCHBOARD-5's kill, `D.eliteT = gates.killT[3] + ELITE_AFTER_RANK_IV_S` (30 s, unchanged constant).
*Why:* with Size IV now at 353–449 s, today's `min(390, …)` is usually already in the past, so RAMROD
would spawn on the tick after the kill, or be skipped entirely when LV 35 is already pending. It then
repeats every 75 s (max 3) until the city boss spawns, as today; the city boss's arrival is not delayed
by a live RAMROD. EXTENDED COVERAGE keeps its RAMROD every 60 s. `probe_gatekeepers` asserts the first
`eliteSpawn` is on the first tick ≥ `killT[3] + 30` on which no fight is alive (§5.4 case 14).

---

## §3 The three gatekeepers

### 3.0 Shared rules (every gatekeeper module; toolkit additions in `bosses/index.ts` by K0)
* **Authored in titan heights.** `H = bossH(w, b)`, which for `role 'gate'` latches
  `max(T.height, titanHeightAt(T.rank, T.level))` (the settled ceiling, never a mid-tween height).
  Every part offset, radius and height, every shape and every range band below is a multiple of H, set
  at `create()`. So the same design works at the home Size and at Size V in EXTENDED COVERAGE, and the
  view scales the rig by `b.data.H / H_authored` (§3.4). Home H: STENCIL-1 **3.125 m**, CORDON-2
  **10.77 m**, SWITCHBOARD-5 **25.6 m** (the Size I / II / III ceilings). R = titan radius = 0.42 H.
* **Windups** are `gateWindup(w, b, escapeH, min, max)`, a new toolkit wrapper over `fairWindup`
  (0.35 s reaction + 0.15 s acceleration + walk-out ÷ the titan's walk speed × `ESCAPE_K[phase]`),
  spawned with `bossTelegraph(w, spec, false)`. Titan walk at home: 7.9 / 15.9 / 28.6 m/s
  (`titanSpeed(H)`), before the `moveSpeed` stat. The wrapper adds two rules `fairWindup` lacks:
  * **Slow-aware.** The walk it divides by is `titanWalk(w) × (T.slowT > 0 ? clamp(T.slowMul, 0.1, 1) : 1)`
    (the same factor `titansim.ts` applies to movement), so a titan standing in WET PAINT (slow 0.35 →
    × 0.65) gets a windup it can walk out of while slowed. Example: HEARTHBACK in paint needs 1.18 s for
    a P1 PAINT BUCKET that `fairWindup` alone clamps to 1.0 s (§10 geometry table).
  * **The max clamp scales with the titan's pace in H.** `max × max(1, vHome / vNow)`, where
    `vNow` = that (slowed) walk ÷ H, and `vHome` = `titanSpeed(Hhome) / Hhome` for the gatekeeper's home
    Size (2.53 / 1.48 / 1.12 H/s for slots 1 / 2 / 3). At home and unslowed it is the authored clamp;
    at Size V a titan covers 0.76–1.03 H/s, so the clamp opens by 1.5–3.3× and the raw fair value
    governs (SHIELD SHOVE P1 for HEARTHBACK at Size V: 2.85 s, which the fixed 2.2 s clamp made
    unwalkable). The `min` clamp is never scaled. With these two rules every table entry below is
    walkable at `ESCAPE_K` from the lead point for all four titans at home, slowed in paint, and at
    Size V H 60–67 (the scratch check in §10; `probe_gatekeepers` case 6b re-asserts it on the real code).
* **Volleys must leave a walkable exit** (PAINT BUCKETS, CALL-IN, SAWHORSE TOSS, DOUBLE LINE, the
  RELOCATE flare trail). Rule, enforced in the toolkit helper `volleyPoints(w, b, lead, count, spacing,
  arc, out)`: the **volley axis** is the unit vector from the rig to the lead point; the lead tell sits
  on the lead point; every secondary tell sits **beyond** the lead (farther from the rig), inside
  ±60° of the axis, at a centre distance of at least `2 × (r + R) + 0.1 H` from the lead and from
  each other. The rig-side half-plane of the lead is then always clear: stepping `r + R` from the lead
  point in any direction within ±90° of "toward the rig" clears the lead tell and keeps ≥ 1.17 H
  (buckets) / 1.23 H (flares) from every secondary's centre, more than the `r + R` needed (§10). The lead's
  windup is computed for that `r + R` escape, so the union of the volley costs no more than the lead.
  The rig side is only open if the rig's keep-out / push-out leaves room, so every volley also needs
  the lead point at least `keepOut + (r + R) + 0.2 H` from the rig's centre; when it is closer, the
  volley axis turns 90° (tangential, toward the side the titan is not moving; `rng.boss` if it is
  still) and the clear half-plane is the opposite tangent. Staggered fires (+0.15 / +0.2 s × i) only
  add time.
* **HP** = `GATE_HP_AT_RANK[titan.rank] × GATE_HP_MUL[id]` (× (1 + `ENDLESS.rematchHpStep` × n) for the
  n-th rematch of that gatekeeper) = **1 000 / 4 500 / 20 000** at home and **100 000** at Size V. Derived
  from the measured median single-target DPS at the held Size (30 / 137 / 553 per s) × about 37–40 s of
  damage time × 0.9 (Size V: the Size IV figure × the damage multiplier ratio 45 / 20) (the city boss at Size IV calibrates the factor: about 150 000 HP in about 100 s at a
  measured 1 509 per s dummy DPS). Weak-point windows (hpMul 2) and one UPROAR bring the median to about
  30–40 s. **These are starting values only.** The dummy DPS was measured on an `Enemy` without
  `BOSS_KIND_MUL` (wire 0.4, arc 0.7, stomp 0.75, magma 0.65, vent 0.9), which gatekeepers inherit through
  `damageBoss`, and without `damageArea`'s equal split across overlapping parts, so the real per-titan
  spread will be wider than the dummy's (VOLT-KITE's wire forks and HEARTHBACK's magma lose most).
  **Calibration step (lane K1b, before any GATE 2 run):** `probe_gatekeepers --calibrate` fights each real
  gatekeeper module with each titan (gate bot, 3 seeds) and prints the per-titan fight medians; K1b sets
  `GATE_HP_MUL[id]` so the **median over the 4 titans** sits in `GATE2_V3.gateFightMedianS` (25–55 s), and
  the case-4 assertion adds a per-titan band: every titan's median fight against every gatekeeper in
  **18–75 s** (the dps cap bounds the fast end, fatigue the slow end). `GATE_HP_MUL` stays per
  gatekeeper; a per-titan HP table is not added (the titans' different curves are the point of choosing
  one).
* **An open weak point takes the whole area hit.** `damageArea` (`combat/damage.ts`) splits one shape's
  damage equally over every overlapping part (the rule that keeps a big AoE at one hit's worth). For a
  `role 'gate'` rig, when the shape overlaps a part whose bit is set in `b.data.weakMask` (the open
  drum, the pack while OVERHEATED or STALLED, the unfolded dishes), the **whole** `c.dmg` goes to the
  weak part(s) (split only among the overlapping weak parts) and the other overlapping parts take
  nothing. *Why:* MOLO's bite behind STENCIL-1's open drum also overlaps the body and both rear wheels, so
  the drum's hpMul 2.0 / strainMul 4 paid about 1.25× in total instead of 2×; the window must pay what it
  promises. The hit is still one hit's worth (no AoE multiplication). K0 edits `damageArea` for this.
* **Per-second damage cap.** Titan damage to a gatekeeper within a **tumbling** 1 s window (the window
  restarts at `dpsWinT + 1` s; not a rolling window, which would need a per-hit history) is capped at
  `GATES.dpsCapFrac` (6 %) of its max HP (`damageBoss`; UPROAR's and DEMOLITION NOTICE's exact
  `bossUltHit` are exempt). *Why:* the measured DPS at LV 16 ranges 34–542 per s (16×), so without a cap a
  strong build deletes a set-piece in 8 s. With it the damage time is at least about 17 s. A burst
  straddling a window boundary can land up to 2 × 6 % = 12 % inside one real second; that is accepted
  (the long-run cap is still 6 %/s) and the probe tests both cases (§5.4 case 11).
* **Fatigue** (§2.4): after `GATES.fatigue.startS` (40 s) of `fatigueClock = max(engagedS, 0.5 × liveFightS)`,
  sheds `rampPerS × (fatigueClock − 40)` of max HP per second, capped at 2.5 % per s. This bounds a weak
  build's fight at about 75 s and any fight at ~101 s of clock (§2.4).
* **Damage** = `min(bossHostile(w, base) × gateDmgMul(w), GATES.hitCap × titan.maxHp)`. Bases are
  **4–14** (the city bosses use 8–42), so a P1 hit costs about 10–25 % of a VOLT-KITE's HP at its Size and
  no hit exceeds 40 %.
* **Phases** at 66 % and 33 % (the shared `checkPhase`), with a 1.2 s `RECONFIGURING` pause; **no**
  full-width phase banner for gatekeepers (the `bossPhase2/3` alerts stay main-only); the nameplate's
  phase pips animate instead.
* **Meter and stagger**: the shared rule (`dealt × strainMul / (0.45 × maxHp)`); a full meter → a stagger
  of `GATES.staggerS` (4.5 s; `addMeter` reads the length by role), ×2 damage taken, and the weak point
  forced open. Perk DEFERRED MAINTENANCE starts the meter at 0.25.
* **City collision (new, gatekeepers only).** Unlike the 60–75 m city bosses, a 7 m cart must not drive
  through a 12 m shop. `parts[0]` is pushed out of buildings of tier > the rig's **crush tier** with
  `resolveCircleVsCity`, like the titan, and `crushUnder` only damages props and buildings up to that
  tier. The crush tier is **indexed by gatekeeper and role, never by `b.slot`**:
  `gateCrushTier(b) = b.slot === 0 ? 4 : GATES.crushTier[b.id]` with
  `GATES.crushTier = { stencil1: 1, cordon2: 2, switchboard5: 3 }`, i.e. one tier above what a titan of
  the same Size flattens (`RANKS[r].canFlatten` 0 / 1 / 2): a rig about 2 H tall crushes what a slightly
  larger titan would. A rematch (slot 0) crushes like the city bosses (tier 4). *Why raised from
  0 / 1 / 2:* the roads are 14 m (`roadW`) on a 72 m pitch, CORDON-2's body is 15 m wide and
  SWITCHBOARD-5's base 41 m, so at the old tiers both were confined to blocks they could not enter.
  A new toolkit helper `laneClearLen(w, x, z, dir, len, r)` ray-marches at 0.5 H steps with
  `buildingsInRect` (buildings above the crush tier only) and returns the free length; every charge or
  lane that the rig drives along is clamped to it.
* **Stuck rule (new toolkit helper `gateUnstick(w, b)`, called by every gatekeeper's move step while it
  hunts, i.e. while the titan is past the band max).** Every `GATES.stuck.checkS` (2 s) it compares the
  centre-to-centre distance with the last checkpoint; if it has not dropped by `stuck.progressH` (0.5) × H:
  1. **DETOUR** (first failure): for `stuck.detourS` (1.5 s) steer along the best of 8 headings, scored by
     `laneClearLen(heading, 2 H) ≥ 1.5 H` first, then the largest cosine toward the titan;
  2. **RAMMING THROUGH** (second consecutive failure): for `stuck.ramS` (1.5 s) the crush tier is 4 and
     `resolveCircleVsCity` is skipped, so the rig flattens whatever is in front (a crash beat: event
     `gateRam`, subtitle `RAMMING THROUGH`, the building collapse fx); it drives straight at the titan;
  3. a third consecutive failure (pathological geometry) triggers the cut-off re-entry of §2.4 if the
     rig is off-screen, else another RAMMING THROUGH.
  Progress resets the counter. Worst case without progress: 2 s + 2 s before the ram, 1.5 s of ram,
  so `probe_gatekeepers` case 15 asserts **no hunting interval longer than 6 s without 0.5 H of
  progress** (4 s as the reviewer suggested would fire before the rule's own second check).
  CUTTING YOU OFF still covers the far case (> 2.2 × spawnRing).
* **Dash answer**: `watchDash(w, b, cd)`, the same anti dash-spam rule as the city bosses.
* **Keep-out**: listed per gatekeeper and chosen so that MOLO's 0.9 H bite reaches the exposed weak
  point from the wall (checked by the geometry test in §5.4).
* Default and attack subtitles are copy in `data/bosses.ts` (a gatekeeper is a `BossDef` with
  `role 'gate'`, `slot` and `kicker`).

### 3.1 STENCIL-1 — gatekeeper 1 (LV 7, the Size I ceiling). Tests: read a LANE, then punish the REFILL

**Concept and look.** HALVARD's first answer to a monster that is getting too tall for the crosswalk is
the road-marking crew. STENCIL-1 is a three-wheeled line-painting cart that has been bolted up to twice
its normal height: a boxy cream chassis (`#f1e4c8`) with safety-yellow bands (`#ffd166`); a bubble cab
at the front with two round headlamp "eyes"; a big white **PAINT DRUM** with a yellow band on the back,
lidded, on a tilting cradle; an articulated **spray boom** on the right with a nozzle head that drips
white; an amber roof beacon (glare bar 3–8×); a rack of spare paint buckets; two fat rear wheels and a
steering caster at the front. 2.3 H tall (7.2 m) and 2.8 H long, so about 2.3 × the baby titan.
Readable from the isometric camera as drum + boom + three wheels.

**Parts** (boss-local, facing +Z, all × H; `makePart(name, ox, oz, r, y0, y1, hpMul, strainMul)`):

| part | ox, oz | r | y | hpMul | strainMul |
|---|---|---|---|---|---|
| body | 0, 0 | 0.85 | 0.3–1.5 | 1 | 0.2 |
| cab | 0, +1.0 | 0.45 | 0.4–1.4 | 1.2 | 0.5 |
| boom | +0.85, +0.7 | 0.3 | 1.2–2.1 | 0.6 | 0.3 |
| **drum** closed | 0, −1.0 | 0.55 | 0.9–1.9 | 0.5 | **0** |
| **drum** open (REFILL, TIPPED OVER) | **0, −1.25** | **0.65** | 0.6–1.6 | **2.0** | **4.0** |
| wheelL / wheelR | ∓0.8, −0.35 | 0.35 | 0–0.7 | 1 | 0.3 |
| wheelF | 0, +1.25 | 0.3 | 0–0.6 | 1 | 0.3 |

`step()` rewrites the drum part every tick from `b.data.drumOpen` (as PARKADE-6 does with its till).
The rear wheels sit forward of the open drum's approach cone so a bite from behind the drum overlaps
the drum only where possible; the weak-point rule of §3.0 pays the full hit to the drum in any case.
Collision: no hard keep-out; the eased body push-out (`parts[0]` r 0.85 H + 0.7 R), so MOLO can stand
behind the drum. Crush tier 1 (it pops street props and tier-1 kiosks and shops; tier-2+ block it).
Footwork: `keepRange(w, b, 3.0 H, 6.0 H, 0.75 × titanWalk, 2.2 rad/s)`; band `[3.0, 6.0] H`; hunt and
stuck rule per §2.4 / §3.0.

**Attacks** (gaps `[_, 2.2, 1.8, 1.5]` s, P3 cadence × 0.8, `repeatMul` anti-spam). In all three tables "fair" means `gateWindup` (§3.0), and a volley's secondaries are placed by `volleyPoints`:

| Phase | Attack | Telegraph | Geometry | Windup | Base | Notes |
|---|---|---|---|---|---|---|
| P1+ | **STRIPE RUN** — "STRIPE RUN — STEP OFF THE LINE" | `lane` | from the nose through `leadPoint`, w **1.7 H** (the cart's own footprint: body r 0.85 H), len clamp(d + 3 H, 5 H, 9 H), then clamped by `laneClearLen` | `gateWindup(0.85 H + R, 1.1, 1.9)` (1.10–1.15 s at home) | 10, knock 0.5 H/s sideways | on fire the cart races the lane end-to-end in 0.4 s along the lane's **centre line** (its sim position moves; the lane's own fire is the damage) and **`pushTitanOut` is suspended for the race** (`b.data.raceT > 0`), so a titan that stepped out of the painted footprint is never shoved by the passing body; the push-out resumes when the cart stops. It leaves **WET PAINT** along the centre (hazard `paint`, capsule r 0.35 H, 5 s, `data.slow` 0.35, no dps): the stripe is narrower than the damage lane, which is drawn as the cart's full-width tyre track with the wet stripe inside it. Then **REFILL** 3.0 / 2.6 / 2.2 s (P1 / P2 / P3): `drumOpen`, no movement, turn rate 0.4 rad/s, subtitle `REFILLING — HIT THE DRUM`. The cart ends past the titan facing away, so **the open drum faces the titan** |
| P1+ | **PAINT BUCKETS** — "PAINT BUCKETS — WATCH THE SPLASH" | `circle` per bucket (lobbed `paintCan` → auto circle tell) | 3 / 4 / 5 buckets, r **0.45 H**: the first on `leadPoint`, the rest placed by `volleyPoints` (§3.0): beyond the lead along the volley axis, within ±60°, ≥ **1.84 H** (2 × (0.45 H + R) + 0.1 H) from the lead and from each other (`rng.boss` angles inside the arc) | `gateWindup(0.45 H + R, 1.0, 1.8)` for the lead, + 0.15 s × i | 6 each | the rig-side half-plane is always clear (the exit is toward the cart, which is where the drum is); each splash leaves a WET PAINT puddle (circle r 0.45 H, 4 s, slow 0.35) |
| P2+ | **DOUBLE LINE** — "DOUBLE LINE — STAY BETWEEN THE LINES" | 2 × `lane` | perpendicular to the cart→titan axis, len 8 H, w 0.5 H: one centred on the lead point, the other **2.0 H** to one side (`rng.boss`); the **1.5 H** strip between them is clear for the 0.84 H body (a 0.66 H band for the titan's centre, 2.1 m at Size I), and the lead line's outer side is open too | `gateWindup(0.25 H + R, 1.0, 1.8)` (step into the median or out the far side) | 8 | both lines stay as WET PAINT (4 s), so the median is the dry way out |
| P3 | **U-TURN** — "U-TURN — IT'S COMING BACK" | 2 × `lane` in sequence | STRIPE RUN, then a second STRIPE RUN re-aimed from the first lane's end | each as STRIPE RUN; the second painted as the first fires | 10 each | the REFILL comes only after the second run |
| any | *dash answer* (`watchDash`, cd `[_, 7, 5, 4]`) | `circle` (one `paintCan`) | r 0.4 H at the dash end + 0.3 (r + R) ahead | `gateWindup`, k 1 (0.9–1.8) | 4 | |

**Weak point and stagger.** SPILL fills almost only from the **open DRUM** (strainMul 4) and a little from
the cab (0.5). Full SPILL → **TIPPED OVER** (4.5 s): the cart lies on its side, the drum is forced open
and gushes a WET PAINT pool (r 0.8 H behind it: punishing it costs some footing), ×2 damage. Default
subtitle `WAIT FOR THE REFILL — HIT THE DRUM`. What it teaches: every gatekeeper and boss after it paints
before it hits, and the opening comes right after the attack.

### 3.2 CORDON-2 — gatekeeper 2 (LV 16, the Size II ceiling). Tests: a SHIELD you go AROUND

**Concept and look.** At Size II HALVARD stops painting lines and starts building walls. CORDON-2 is a
tracked crowd-control unit that carries its own barricade: a wide **curved front wall** of six
interlocking panels (black / safety-yellow chevrons, stencilled `LINE CLOSED`) on twin caterpillar
tracks; behind the wall a squat engine house with two exhaust stacks; on its back the **GENERATOR PACK**,
a cage of glowing coils (teal `#4fb3b0` glow within the glare bar); two swivelling arc-lamp arms on the
wall's top edge. 2.0 H tall (21.5 m), 2.6 H wide, 1.8 H deep. It reads as "a moving roadblock"; it is
not a crab, not a humanoid, not a tank turret.

**Parts** (× H):

| part | ox, oz | r | y | hpMul | strainMul |
|---|---|---|---|---|---|
| body | 0, −0.1 | 0.7 | 0.2–1.4 | 1 | 0.2 |
| wallL / wallR | ∓0.85, +0.55 | 0.45 | 0–2.0 | **0.15** | 0 |
| wallC | 0, +0.7 | 0.5 | 0–2.0 | **0.15** | 0 |
| **pack** | 0, −0.95 | 0.45 | 0.6–1.6 | **1.6** | **3.0** (× 1.25 while OVERHEATED) |
| trackL / trackR | ∓0.85, −0.3 | 0.4 | 0–0.6 | 1 | 0.3 |

Hard keep-out `1.2 H + R` (1.62 H). From behind, the pack's surface is 0.22 H from the wall, inside
MOLO's 0.9 H bite; from the front the wall is 0.42 H away and takes 15 %. With planar targeting
(`nearestBossPart`) the pack is the nearest part within about ±50° of straight behind; the tracks bound
it (the probe computes and asserts ≥ ±40°). Crush tier 2 (§3.0). Footwork: `keepRange(w, b, 1.6 H, 3.5 H,
0.55 × titanWalk, turn)` (band `[1.6, 3.5] H`) with **turn = 0.9 / 1.05 / 1.2 rad/s** by phase. At the wall a titan orbits at
about 0.9 rad/s, so walking round it is a tie; the windows and a dash (about 80° of arc) are how you
get behind. That is the lesson.

**Attacks** (gaps `[_, 2.4, 2.0, 1.7]`):

| Phase | Attack | Telegraph | Geometry | Windup | Base | Notes |
|---|---|---|---|---|---|---|
| P1+ | **SHIELD SHOVE** — "SHIELD SHOVE — GET OUT OF ITS WAY" | `lane` | from the wall face, w **2.4 H**, len 3.2 H (`laneClearLen`) | `gateWindup(1.2 H + R, 1.2, 2.2)` (1.55–1.92 s at home; 1.9–2.9 s at Size V, §10) | 12, knock 1.0 H/s along the lane | the rig lurches 2.4 H forward in 0.35 s; then **OVERHEATED** 2.0 / 1.7 / 1.4 s: turn × 0.15, the stacks vent, pack strain × 1.25, subtitle `OVERHEATED — GET BEHIND IT` |
| P1+ | **SAWHORSE TOSS** — "SAWHORSE TOSS — MIND THE BARRICADES" | `capsule` per sawhorse (lobbed `sawhorse`) | 2 / 3 / 4 sawhorses, len 1.4 H, r 0.25 H, each lying across the volley axis (§3.0): one across the lead point, the rest **beyond** it along the axis at **1.6 H** spacing (≥ 2 × (0.25 H + R) + 0.1 H = 1.44 H, so the 1.1 H gaps also fit the 0.84 H body); never behind the lead. Needs the lead ≥ 2.5 H from the rig's centre (keep-out 1.62 H + 0.67 H + 0.2 H), else the axis turns tangential | `gateWindup(0.25 H + R, 1.1, 2.0)` + 0.2 s × i | 8 each | the rig-side half-plane is always clear: step back toward the wall and go round it. The rig stands still while it throws (turn × 0.3): a flank window |
| P2+ | **BACKFIRE** — "BACKFIRE — STEP OFF THE EXHAUST" | `cone` from the pack, backwards | half 55°, reach 2.4 H | the cheaper walk-out (sideways d·sin 55° + R, or out past the reach), fair (1.0–1.9) | 11 | a response, not in the cycle: fires when the titan has been in the rear arc (> 110° off its facing) for 0.8 s (P3 0.6 s). Hit the pack, then step aside |
| P3 | **SQUAD BEHIND THE LINE** | — (spawns) | a PICKET SQUAD from the pack side every 14 s, at most 2 of its squads alive | — | — | `spawnEnemy(w, 'squad', …)`; positions from `rng.boss`; counts toward the director's caps; ids go in the same add list as SWITCHBOARD-5's (`gateAddIds`, §3.3) |
| any | *dash answer* (cd `[_, 8, 6, 5]`) | `capsule` (one sawhorse) across the dash end | len 1.2 H, r 0.25 H | `gateWindup`, k 1 | 5 | |

**Weak point and stagger.** STALL fills from the **PACK** (strainMul 3, 3.75 while OVERHEATED). Full
STALL → **STALLED** (4.5 s): the tracks stop, turn 0, the wall panels droop, ×2 damage. Default subtitle
`GET BEHIND THE WALL — HIT THE PACK`.

### 3.3 SWITCHBOARD-5 — gatekeeper 3 (LV 27, the Size III ceiling). Tests: ADDS to manage and a CHASE

**Concept and look.** By Size III HALVARD is out of equipment and on the phone. SWITCHBOARD-5 is a mobile
switchboard: a wide **four-track crawler base** with four outrigger feet that plant when it stops; a
tall **lattice mast** (2.6 H, 66 m); a slowly rotating crown carrying **three RELAY DISHES** on arms; a
lit `NOW SERVING 05` number board halfway up the mast; a cluster of horn loudspeakers **on the base
deck** (never on top). *Silhouette rule:* a wide vehicle with a mast and three dishes. It must never
read as a figure with a speaker for a head (that would echo an existing internet creature design), so
there are no horns above the base deck, no limbs, and no head-like crown.

**Parts** (× H; the crown angle θ rotates at 0.35 / 0.45 / 0.55 rad/s by phase):

| part | ox, oz | r | y | hpMul | strainMul |
|---|---|---|---|---|---|
| base | 0, 0 | 0.8 | 0–0.6 | 1 | 0.15 |
| **dishA / dishB / dishC** unfolded | 0.95 H × (sin, cos)(θ + 0°, 120°, 240°) | 0.35 | 2.2–2.7 | **1.5** | **2.5** |
| dish folded (RELOCATE, LINES DOWN droop keeps them out) | 0.25 H at the same angles | 0.12 | 1.9–2.2 | 0.5 | 0 |
| outrigger ×4 (planted) | ±0.85, ±0.85 | 0.2 (0 while lifted) | 0–0.3 | 1 | 0.3 |

Hard keep-out `1.25 H + R` (1.67 H); a dish's surface is then 0.37 H from the wall when it faces the
titan (in MOLO's reach); as the crown turns, each dish is the nearest part for about a third of the
circle. The dishes come round to you, or you step round to them. Crush tier 3 (§3.0; only tier-4 towers
block the 41 m base).

**Footwork band `[1.67, 4.5] H`** (explicit, so §2.4's "past its band" is defined). Inside the band it
stays **planted** (outriggers down, no translation, the crown turns; the base turns toward the titan at
0.6 rad/s). When the titan has been farther than 4.5 H for 1.5 s it **HUNTS**: the RELOCATE pack-up beat
(1.0 s, dishes fold, outriggers lift), then it drives at the titan at `huntClose` × titanWalk (the stuck
rule applies) until the titan is within 3.0 H, then plants in 1.0 s. RELOCATE (below) is the other
direction: it drives *away* to a new spot when the titan camps it.

**Behaviours** (gaps `[_, 2.3, 1.9, 1.6]`):

| Phase | Behaviour | Telegraph | Geometry | Windup | Base | Notes |
|---|---|---|---|---|---|---|
| P1+ | **CALL-IN** — "CALL-IN — CLEAR THE MARKED SPOTS" | `circle` per flare (lobbed `callFlare`) | 3 / 4 / 5, r **0.5 H**: the first on `leadPoint`, the rest by `volleyPoints` (§3.0): beyond the lead along the volley axis, within ±60°, ≥ **1.94 H** (2 × (0.5 H + R) + 0.1 H) from the lead and from each other. Needs the lead ≥ 2.8 H from the base's centre (keep-out 1.67 H + 0.92 H + 0.2 H), else the axis turns tangential | `gateWindup(0.5 H + R, 1.1, 2.0)` + 0.15 s × i (1.29–1.56 s at home) | 12 each | the rig-side half-plane is always clear |
| P1+ | **PUT THROUGH** — subtitle flash `PUTTING YOU THROUGH TO A CREW` | — (spawns) | on its own timer 13 / 11 / 9 s (× (1 − 0.1 p)): P1 one PICKET SQUAD + 3 CROSSING WARDENs; P2 + 3 GNATs; P3 + 1 HOPPER, at the spawn ring on the titan's far side from the tower | — | — | at most **14** of its adds alive; ids kept in a module-private `WeakMap<BossState, number[]>` (deterministic), exposed read-only as `gateAddIds(w)` for `hitEnemy`'s engagement mark (§2.4), CALL DROPPED and RED LIGHT. No add can spawn more bodies (the earlier draft's P3 BULWARK is dropped: a BULWARK deploys up to `APC_MAX_SQUADS` 2 × 5 PICKET members that were outside the list, the cap and CALL DROPPED). The titan's auto-attacks target enemies before boss parts (`findTarget`) unless a dish is **open and in reach** (§2.4), so the adds soak the forks and the misplaced swings, not the whole fight: that is the test. Adds never feed pressure while the titan is in the band (§2.4) |
| P2+ | **HOLD MUSIC** — "HOLD MUSIC — CLEAR THE RING" | `ring` around the base | 0 → 2.0 H | `gateWindup(2.0 H − d + R, 1.0, 1.9)` | 14, knock 0.8 H/s outward | only when the titan is within 2.1 H (anti-camping) |
| P1+ | **RELOCATE** — "RELOCATING — CATCH IT" | a 1.0 s PACKING UP beat (dishes fold, outriggers lift) | drives to the best of 8 points at 7 H around the titan (in bounds by 3 H, reachable along `laneClearLen`, `rng.boss` tie-break) at 0.8 / 0.85 / 0.9 × titanWalk, for at most 6 s; a `callFlare` drops behind it every 1.2 s (r 0.4 H, `gateWindup`; one at a time, ≥ 1.8 H apart along the path, so the trail never closes the chase lane) | — | 10 per flare | triggers when the titan has spent 5 / 4 / 3 s within 2.6 H since the last relocation, at least 12 s ago, with no attack live and no stagger. **CAUGHT**: a titan within 1.5 H of the moving base stops it; it plants in 0.6 s. On arrival it plants in 1.0 s. The dishes are unhittable (strain 0) while folded, so the chase is the price of letting it go |
| any | *dash answer* (cd `[_, 8, 6, 5]`) | `circle` (one `callFlare`) | r 0.45 H past the dash end | `gateWindup`, k 1 | 6 | |

**Weak points and stagger.** FEEDBACK fills from the **DISHES** (strainMul 2.5). Full FEEDBACK → **LINES
DOWN** (4.5 s): the dishes droop, ×2 damage, and every add it summoned that is alive is stunned 3 s
(CALL DROPPED). Default subtitle `HIT THE DISHES AS THEY COME ROUND — BUILD FEEDBACK`.

### 3.4 Model and animation brief (lane K2a: `ai/foemodels_gate.ts` + `ai/bossview.ts`)
* **Build**: the CONTRACT §6.1 look (faceted low poly, non-indexed, flat normals, vertex colours,
  `bakeOutlineNormals`, 3.0 px ink hull), authored facing +Z **in H units at H = 1** and scaled by the
  view to `b.data.H` every spawn (so the Size V rematch is the same model, bigger). ≤ 30 draw calls per
  rig including outlines; no per-frame allocation; one rig live at a time (the fights never overlap).
* **STENCIL-1**: wheels spin with speed; the boom sweeps the nozzle along each lane as it paints (a
  white spray ribbon); the cart pitches forward on a STRIPE RUN and skids to a stop; REFILL: the drum's
  lid swings up, the cradle tilts back 15°, a funnel arm lowers into it, and the drum glows faintly;
  PAINT BUCKETS: the rack arm flings each bucket; TIPPED OVER: it rolls onto its left side with the
  wheels spinning in the air and paint glugging out; defeat: the drum pops its lid, a white paint
  geyser, then the cart settles flat.
* **CORDON-2**: track treads scroll; the wall panels flex slightly per step; SHIELD SHOVE: a crouch,
  then a lurch with the panels locking together; OVERHEATED: the stacks glow orange and puff, the pack
  coils brighten; SAWHORSE TOSS: a wall panel hinges open and the sawhorses are flung from a hopper;
  BACKFIRE: the stacks swing back and blast; STALLED: the panels droop outward like a wilted fence, the
  lamps flicker; defeat: the panels topple outward one by one like dominoes.
* **SWITCHBOARD-5**: the crown rotates; the dishes track the titan by ±10°; the NOW SERVING board ticks
  up by one every PUT THROUGH; RELOCATE: the dishes fold flat, the outriggers lift, the treads race and
  the mast sways; CALL-IN: a dish flashes and a flare arcs out; HOLD MUSIC: the base-deck horns pulse
  with a visible ring; LINES DOWN: the dishes droop and the board shows `--`; defeat: the mast buckles
  at the middle and folds down across the street.
* Projectile looks (`render/projectileview.ts LOOK`): `paintCan` (a tumbling white bucket with a
  splash trail), `sawhorse` (a tumbling striped sawhorse), `callFlare` (a red-and-white flare with a
  smoke trail). Hazard `paint`: a glossy white road-paint decal with yellow edge dashes, fading
  (`render/hazardview.ts`).

### 3.5 Why these are original and distinct
* From the city bosses: CAISSON-4 is a crane (hook lanes, winch oval), IRON GULLY a beast (breath cone,
  paw rings, plates, charge), PARKADE-6 a walking car park (car lobs, arm cone, tow chain, deck rings).
  The gatekeepers are street vehicles and street equipment at street scale, with different verbs: paint
  lanes and a refill window; a turning wall and a rear weak point; summoned adds, a rotating weak-point
  crown and a chase.
* From RAMROD: STENCIL-1 paints and then drives a lane, but RAMROD stays the only elite charger, and
  STENCIL-1's lesson is the REFILL window after it.
* From the reference video: no segmented or multi-car body (no centipede), no copied names, no copied
  screen compositions.
* From existing designs: no humanoid, no dinosaur, no crab, no loudspeaker-headed figure (§3.3).

---

## §4 The city boss at Size IV, the finale, and KEEP GOING

### 4.1 Arrival
The city boss is slot 4. `lockGate(w, 4, …)` happens at LV 35 at Size IV (after SWITCHBOARD-5's kill) or
at the 540 s cap (§2.7). It spawns through the existing `spawnBoss` (4 s intro from `ENTRY_D`, `alert
boss`, `bossSpawn`, `director.bossSpawned`, `run.phase 'boss'`, the boss music), now with `b.role =
'main'`, `b.slot = 4`. The director no longer schedules it: the "Size V + 20 s" rule never fires in
normal play (Size V now only comes from the kill), and the director's boss block moves into `stepGates`.

**Earliest arrival (new, closes the fast tail by design).** The slot-4 `dueT` is
`max(lockT + summonDelayS, lastBreachT + chainGapS, GATES.mainEarliestS)` with **`mainEarliestS` = 440 s**
(= `RANK_SCHEDULE_S[4]` − `AHEAD_GRACE_S[4]`, the pace governor's own target for LV 35). A titan that
reaches LV 35 earlier waits at Size IV with the GROW bar reading `SIZE LOCKED — <BOSS> EN ROUTE · 0:nn`
(a whole-second countdown, event-driven text: one write per second), the city keeps coming (the
director's normal Size IV budget, RAMROD per §2.8), and the XP rate is governed (§4.2). *Why a spawn
floor and not a fight floor:* the clear time is spawn + 4 s intro + fight, and the fight's short tail
comes from strong builds (54 s measured), which a spawn floor bounds without making the median fight
longer; with it the earliest possible clear is 440 + 4 + that tail, and the re-run emulation (§5.1,
48 runs) has **0 clears under 480 s** (earliest 502 s).

### 4.2 Re-scale for a Size IV titan
* **HP: keep `BOSS_HP_SCALE[3]` = 0.8** (CAISSON-4 152 000, IRON GULLY 172 000, PARKADE-6 144 000).
  *Measured* (the re-run emulation with every §5.2 rule, 48 runs, §5.1): fights 62–162 s, per-variant
  medians **126–135 s**, inside `GATE2_V3.mainFightMedianS` (60–150 s) but in its upper half, because the
  governed XP rate below leaves the titan 1–4 levels (not 2–18) stronger by the kill. 0.9 was also run:
  medians 129–137 s, and more deaths (stand 35/40/45: 4 of 12, clears 8/12), so **0.8 stays**; the fast
  tail is closed by `mainEarliestS`, not by HP. The Size IV damage multiplier (20 vs 45) is offset by
  fatigue, UPROAR's HP-fraction hits and the full draft build at LV 35. First knob if the median leaves
  60–150 s: `BOSS_HP_SCALE[3]` (down first: the median sits nearer the top).
* **XP and drafts while the city boss is pending or alive (new rule).** With nothing else changed the
  governor is off at rank 3 once LV 35 is reached (`need < 0`), Size IV loot keeps `xpScale` 0.15, and
  the measured rate is 65 XP/s against `xpToNext(35)` = 737: a level (and a draft screen that freezes the
  fight) every ~11 s; the floor-only re-run (no XP rule) measured 2–18 levels per city fight. **Rule:** `paceMul` returns
  `AHEAD_MIN` (0.35) while `gates.pending === 4 || (gates.active === 4)` (i.e. `sizeLocked(w) && T.rank
  === 3`), before any other branch. Measured with the rule (§5.1): **1–4 levels per city fight** (a draft
  every ~30–40 s) and 0–8 levels during the gate fights; `probe_sim` reports both per run and GATE2_V3
  bands them (§5.3). Drafts are not banked: a draft mid-fight is a v2 feature (the fight pauses, as at
  Size V today); the governed rate keeps them rare.
* **Damage** is unchanged in form: `bossHostile` scales with `RANKS[3].hpMul` (5.5), the same factor as
  the titan's max HP, so each hit is the same fraction of the titan's HP as at Size V. HIT_CAP 0.55 is
  unchanged.
* **Geometry**: `bossH` = 50 m (`titanHeightAt(3, 35)`, the Size IV ceiling), so every attack authored in
  H shrinks to 0.75× in metres with the titan, and `fairWindup` re-derives each windup from the Size IV
  walk speed (`titanSpeed(50)` = 46.6 m/s vs `titanSpeed(60)` = 53.5 m/s at LV 35 Size V; the walk-out in
  H per second is 0.93 vs 0.89, so windups are about 4.5 % shorter, still clamped by each attack's min). The parts sized **in metres** do not scale, so the rig looks bigger against the titan (dramatic,
  and it makes the finale's breach read). Audit of the fixed-metre elements at H 50 m, R 21 m:
  * CAISSON-4: keep-out 41 + 21 + 12 = 74 m; legStomp ring to 41 + 1.0 H = 91 m; walk-out from the wall
    91 − 74 + 21 = 38 m → 0.8 s + reaction, inside its 0.9–2.0 s clamp. OK.
  * PARKADE-6: keep-out 33 + 21 + 10 = 64 m. deckDrop 0 → 33 + 0.9 H = 78 m (walk-out 35 m, OK).
    levelCollapse ring A ends at 63 m, 1 m inside the wall, but the titan's circle at the wall spans
    43–85 m, so A still overlaps it and is walkable (20 m). B (63–98 m) and C (98–133 m) keep their
    0.45 s steps. The till's open windows (±25° at 55 m … ±41° at 130 m) depend only on the titan's
    distance and part geometry, so they are unchanged; at the wall (64 m) straight ahead the open till's
    surface is 13 m away, well inside MOLO's 45 m bite.
  * IRON GULLY: its bands (50–80 m) and rings are in H or metres that stay outside its body; no hard
    keep-out. OK.
  * Required re-measure (probe_gatekeepers, §5.4): `probe_boss3`'s acceptance and the `boss_threat` policy
    port at **LV 35 Size IV** for all three: tells landed on VOLT-KITE / MOLO in 4–16 %, every windup
    ≥ 0.9 s, no hit > 55 %, the till reachability test.
* **Camera framing at Size IV.** The rigs are sized in metres while the camera curve's D follows the 50 m
  titan, so `bossFrameNeed ÷ curve` is about 1.2–1.25× its Size V value and could reach
  `BOSS_FRAME.maxMul` (2.0) with CAISSON-4's boom or PARKADE-6's deck rings live. `probe_gatekeepers`
  case 10 asserts `bossFrameNeed(w).d ≤ BOSS_FRAME.maxMul × curve D` on every tick of each city fight at
  LV 35 Size IV, over all phases (phases forced every 30 s, god), and the orchestrator adds shots
  `boss_caisson_s4 / boss_gully_s4 / boss_parkade_s4` (1280, P3 with a live telegraph). If the assert
  fails, the fix is `BOSS_FRAME.maxMul` for rank 3 only (a per-rank table), never a smaller rig.
* **Phases, meters, staggers, fatigue, UPROAR interplay**: unchanged.

### 4.3 The VICTORY FINALE (kill → Size V → a short rampage → the front page)
`defeat()` for `role 'main'` with `!w.endless` pushes `bossDefeated` and calls `onMainDefeated(w, b)` on
the same tick:
1. `gates.mainKillT = w.t`; `killT[4]`; `active = pending = 0`.
2. `breachTo(w, 4)`: the last MASS BREACH (top-up to LV 35 if capped): `rankUp 4` on the kill tick,
   50 → 60 m over `GROW_TWEEN_S`, the banner with `RANK_SUBS[4]` (`SIZE V CONFIRMED — THE CITY IS NOW MORE
   OF A SUGGESTION`), the camera punch and pull-back to the Size V framing.
3. `gates.finaleT = GATES.finaleS` (10 s); event `finale {on: true}`. For its length: every hostile
   telegraph and projectile is cancelled; every live enemy is stunned for `finaleS + 1` (HALVARD has left
   the building: they stand there, and at Size V almost all of them are crushable); the director spawns
   nothing and banks nothing; the titan is invulnerable (`w.ult.invulnT = finaleS + 0.5`); city
   destruction, pickups and levels continue (the rampage). At `finaleS − 7.5` s (2.5 s in, after the
   MASS BREACH banner) the sim pushes `alert finale`: **`THE CITY GOT SMALLER.`** / `WARD-7 CAN CONFIRM:
   THE SKYLINE NOW COMES UP TO ITS KNEES`.
4. The app: the boss nameplate hides after the defeat stamp (1.5 s); the boss track resolves into a
   brass swell; `civilians.surge(T.x, T.z, 3 × H, 120)` fills the streets around the titan with 120
   fleeing civilians (view-only; the count is fixed so perfcheck (e) measures the real load);
   **draft screens are held** for the finale (level-ups still owe drafts, which stay pending); after
   `finaleSkipS` (3 s) a hint `SKIP [ENTER]` / `SKIP [A]` appears, and Enter / A calls
   `mutate(endFinale)`.
5. At 0 (or skip) `endFinale` sets `finaleDone`, pushes `finale {on: false}`, and **`checkRunEnd` v3**
   clears the run with **`run.endT = gates.mainKillT`** (the clear time for bests, GATE 2 and
   `fastClearS` is the kill, not the end of the finale) and pushes `runEnd clear`. The existing
   aftermath (2.5 s) → the freeze-frame photo (now a Size V titan over the city) → the clear front page.

`checkRunEnd` v3 (K0 replaces the clear branch; the K0 stub makes `onMainDefeated` set `finaleDone`
at once, which is today's behaviour):
```ts
} else if (!w.endless && w.director.bossSpawned && w.boss && !w.boss.alive && w.boss.role === 'main'
           && w.gates.finaleDone) {
  w.run.result = 'clear'; w.run.phase = 'clear';
  w.run.endT = w.gates.mainKillT >= 0 ? w.gates.mainKillT : w.t;
  w.events.push({ type: 'runEnd', result: 'clear' });
}
```
(`stepWorld` returns early only once `run.result` is set, so the sim keeps running through the finale.)

### 4.4 KEEP GOING: EXTENDED COVERAGE at Size V, with gatekeeper rematches (decided)
KEEP GOING is unchanged in flow (FEATURES_V2 §9.1) and continues at Size V. The rematch schedule is
extended so the gatekeepers come back scaled up: `continueEndless` sets the first rematch at `w.t +
ENDLESS_V3.rematchGapS` (75 s), and every rematch's death schedules the next one 75 s later, **alternating
a gatekeeper and a city boss**: STENCIL-1, then the next city boss in `rematchOrder(biome)` (from `bossIx
1`, as today), then CORDON-2, the next city boss, SWITCHBOARD-5, the next city boss, and round again.
City bosses therefore come about every 150 s plus a gatekeeper fight, close to today's
`ENDLESS.bossEveryS` 150 (which `ENDLESS_V3.rematchGapS` replaces).
* A gatekeeper rematch: `spawnGate(w, id, n)` with n = `gates.rematchN[id]` (that gatekeeper's
  rematches defeated so far), HP `GATE_HP_AT_RANK[4] × (1 + 0.5 n)` (100 000 first), `b.slot = 0` (it
  guards nothing), `alert gateRematch` (`HEIGHT LIMIT REISSUED` / `HALVARD HAS REDRAWN THE LIMIT — AND
  ENLARGED THE ENFORCER`), `gateSpawn {rematch: true}`. At Size V `bossH` is 60–67 m, so the rig is about
  20× its home size: a 140 m paint cart. The kill gives a chest, a guaranteed power-up and
  `+ENDLESS_V3.scorePerGateRematch` (1 500); no breach.
* **Everything a rematch looks up is keyed by role and rematch, never by `b.slot`** (slot 0 would index
  the home tables' unused entry): crush tier 4 (`gateCrushTier`, §3.0: it crushes like the city
  bosses, so a 140 m rig is never pinned by tier-1 shops); director budget × `BOSS_SPAWN_MUL` (0.5, the
  city-boss rematch value; `gateSpawnMul` returns it for `slot 0`) and the `BOSS_MIX`; the windup max
  clamps scale with the titan's pace (`gateWindup`, §3.0); no containment pressure and no hunt boost
  (the titan in EXTENDED COVERAGE is not avoiding a gate); fatigue as a home gatekeeper.
* **Damage multiplier** — `meta/endless.ts endlessBossDmgMul` (named change, §7.3) becomes:
  `role 'gate'` → `1 + ENDLESS.rematchDmgStep × gates.rematchN[b.id]`; `role 'main'` → today's
  `1 + rematchDmgStep × E.rematches`. Today it uses `E.rematches` (the city-boss count) for anything in
  `w.boss`.
* **Death branch** — `stepEndless`'s "a rematch that died" block (today: `E.rematches++`, next at
  `+bossEveryS`, power-up + chest) is rewritten: `role 'gate'` → `gates.rematchN[b.id]++`,
  `gates.rematchGates++`, score term, the same power-up + chest, and **no** `E.rematches++`; `role 'main'`
  → `E.rematches++` as today; both schedule the next rematch at `w.t + ENDLESS_V3.rematchGapS` and advance
  the alternation index `gates.rematchSeq`. `probe_gatekeepers` case 12 asserts that gate deaths never
  increment `E.rematches` and that a rematch rig moves more than 5 H (centre) in its first 10 s after
  its intro.
* The tabloid's endless sub-head adds `REISSUED n`; the `rematches` best keeps counting city bosses only.

---

## §5 Pacing and GATE 2

### 5.1 What was measured (seed 1337, the full 4 titans × 3 cities matrix; commands in §10)
**Baseline, current tree (no gates):** LV 7 / 16 / 27 / 35 at 90–125 / 226–254 / 353–399 / 423–500 s
(medians 106 / 233 / 364 / 437); boss spawn (Size V + 20 s) 443–520 s; boss fight 46–120 s; clears at
504–640 s; 10/12 clears, 2 deaths; GATE 2 PASS. XP per second at Size I / II / III / IV: about 2.4 / 11.5
/ 31 / 65.

**Hold emulation** (scratch, read-only on the real sim): at each gate level the rank is held for a fixed
"fight" time, then the real rank-up runs; the city boss spawns at LV 35 and is fought at Size IV. Two
bracketing assumptions for the hold: **eat** (the bot keeps playing: optimistic XP) and **stand** (the
titan stands still, god on: pessimistic XP). Neither models the gatekeeper's danger. Today's catch-up
stays active during the hold in the emulation, which the spec turns off (§5.2), so the real XP during a
fight is lower than in both variants.

| Variant (hold s for G1/G2/G3) | Size II | LV 16 | Size III | LV 27 | Size IV | LV 35 (city boss) | clear (kill) | city fight | clears (in 8–12 min) · deaths |
|---|---|---|---|---|---|---|---|---|---|
| stand 35/40/45 | 125–160 (140) | 225–264 (244) | 265–304 (284) | 323–396 (361) | 368–441 (406) | 419–494 (443) | 496–626 (532) | 58–160 (87) | 12 (12) · 0 |
| eat 35/40/45 | 125–160 (140) | 210–272 (236) | 250–312 (276) | 308–362 (336) | 353–407 (381) | 360–451 (424) | 414–584 (560) | 54–149 (129) | 11 (10) · 1 |
| stand 55/60/65 | 145–180 (160) | 226–258 (246) | 286–318 (306) | 309–383 (360) | 374–448 (425) | 396–451 (426) | 451–597 (542) | 55–154 (104) | 11 (9) · 1 |

(ranges over 12 runs, median in brackets; "clear" is the kill time, the finale is not included.)

**What the first emulation shows — a predicted GATE 2 FAIL for that design.** `probe_sim.ts` hard-fails
any clear under 480 s (`CLEAR_WINDOW_S = [480, 720]`, line 72; the check at line 493). Two of the three
variants had such a clear (eat 35/40/45: 414 s; stand 55/60/65: 451 s; plus 471 s in eat), so **2 of 3
variants would FAIL GATE 2 as measured**. The mechanism: levels banked during the holds (up to LV 33 at
the Size IV breach) put LV 35 within seconds of the breach, the governor (keyed on rank) was not watching
LV 35 while rank was held at III, and a strong build's 54 s city fight did the rest. An earlier draft of
this section called it "watch"; that was wrong. At about 8 % per run, a 12-run matrix would have hit it
about 65 % of the time.

**Re-run with the revised rules** (same scratch harness, extended: `gate_emu3.ts`, §10): the catch-up
suspended during every hold (as §5.2 specifies; the first emulation left it on), the city boss's spawn
floor `mainEarliestS` 440 s (§4.1), and `paceMul` = `AHEAD_MIN` while slot 4 is pending or alive (§4.2);
`BOSS_HP_SCALE[3]` 0.8. Four variants × 12 runs = 48 runs:

| Variant (hold s for G1/G2/G3, seed) | Size II | LV 16 | Size III | LV 27 | Size IV | city boss spawn | clear (kill) | city fight | clears in 8–12 min · deaths | levels in the city fight · in gate fights (max G1/G2/G3) |
|---|---|---|---|---|---|---|---|---|---|---|
| stand 35/40/45, 1337 | 125–160 (140) | 227–264 (248) | 267–304 (288) | 344–402 (387) | 389–447 (432) | 440–513 (482) | 502–657 (591) | 62–161 (130) | 11 · 1 | 1–3 · 1/2/4 |
| eat 35/40/45, 1337 | 125–160 (140) | 225–259 (247) | 265–299 (287) | 332–404 (386) | 377–449 (431) | 440–508 (455) | 564–643 (581) | 74–151 (126) | 10 · 2 | 1–3 · 1/2/8 |
| stand 55/60/65, 1337 | 145–180 (160) | 232–266 (249) | 292–326 (309) | 372–410 (388) | 437–475 (453) | 447–510 (488) | 548–664 (618) | 79–160 (135) | 11 · 1 | 1–4 · 1/3/5 |
| eat 35/40/45, 7 | 119–178 (136) | 223–268 (242) | 263–308 (282) | 322–407 (388) | 367–452 (433) | 440–502 (472) | 560–658 (588) | 115–162 (129) | 12 · 0 | 1–2 · 1/3/5 |

**Result: 0 of 48 clears under 480 s** (earliest 502 s, latest 664 s); every variant ≥ 10/12 clears in
the window; the city-fight median 126–135 s is inside 60–150 s. The same rules with
`BOSS_HP_SCALE[3]` 0.9 also gave 0 clears under 480 (earliest 510 s) but stand 35/40/45 dropped to
8/12 clears with 4 deaths, so 0.8 is kept.

**Remaining risks, stated plainly.** (1) **Deaths ≥ 1**: the optimistic `eat` variant on seed 7 had 0
deaths; the emulation never models gatekeeper damage (every variant holds without a fighting rig), so
the real deaths come from the gate fights too; if the real matrix shows 0 deaths, the first knob is
the gatekeeper damage bases of §3.1–§3.3 (× 1.15 per step), not the city boss. (2) The
city-fight median sits in the upper half of its band (126–135 of 150). (3) LV 27 now lands at a
median of ~387 s (baseline 364) because the catch-up no longer runs during the G1/G2 fights; it is
inside the G3 spawn band (270–450), and Size IV (367–475) inside 300–500. (4) The early draft cadence
(first 180 s) gets one long gap during the STENCIL-1 fight (0–1 levels in it). None of the variants
models the gate bot's real fight lengths; the §5.3 bands are the acceptance test.

### 5.2 The rubber band with gates (decided)
* `RANK_SCHEDULE_S` keeps its values and gets a new meaning: **when the gate LEVEL for Size r is due**
  (LV 7 at 90 s, LV 16 at 210, LV 27 at 360, LV 35 at 480). The catch-up still re-times a slow run
  toward them.
* **The catch-up is suspended while a fight is alive** (`paceMul` returns 1 while `fightAlive(w)` and
  slot 4 is not the one pending or alive). Levels keep coming at the base rate.
* **At rank 3 with the city boss pending or alive, `paceMul` returns `AHEAD_MIN` (0.35)** (§4.2), checked
  first. It governs both the wait for `mainEarliestS` and the city fight.
* The pace governor (`AHEAD_*`, next rank ≥ 4) keeps projecting LV 35, now the city boss's arrival,
  against `RANK_SCHEDULE_S[4]` − 40 s = 440 s, the same number as `mainEarliestS`.
* Tuning order if a band breaks: (1) `GATE_HP_MUL` and `GATES.fatigue` for the gate fight bands; (2)
  `BOSS_HP_SCALE[3]` for the city fight band; (3) `GATES.mainEarliestS` for clears before 480 s (up, never
  down); (4) `RANK_SCHEDULE_S` for the breach bands; (5) `GATES.capS` never (it is a liveness net).
  **The bands are never widened to pass.**

### 5.3 New GATE 2 bands (`probe_sim.ts`, lane K1a). World seconds, every run of the 12-run matrix

| Check | Old | New | Evidence (re-run emulation, 48 runs) |
|---|---|---|---|
| gatekeeper 1 spawns (LV 7 + 1.5 s) | Size II 60–150 | **60–150** | LV 7 at 84–143 |
| Size II reached (G1's kill) | — | **80–210** | 119–180 with 35–55 s holds |
| gatekeeper 2 spawns (LV 16) | Size III 150–300 | **170–320** | LV 16 at 223–268 |
| Size III (G2's kill) | — | **210–380** | 263–326 |
| gatekeeper 3 spawns (LV 27) | Size IV 280–450 | **270–450** | LV 27 at 322–410 |
| Size IV (G3's kill) | — | **300–500** | 367–475 |
| city boss spawns (LV 35 and ≥ `mainEarliestS`, or the 540 s cap) | boss ≤ 560 | **440–560** | 440–513 |
| Size V | 400–560 | **only on the city boss's kill tick**, never before | invariant |
| each gate fight, spawn → kill | — | **15–90 s**, the per-gatekeeper median over the matrix **25–55 s**, and each titan's median per gatekeeper 18–75 s (probe_gatekeepers) | targets (§3.0) |
| city boss fight at Size IV | 70–170 (probe_boss3) | median **60–150 s** | 62–162, medians 126–135 |
| levels gained during the city fight (spawn → kill) | — | **max 6 per run, median ≤ 4** (a draft cadence band for the climax) | 1–4 |
| levels gained during each gate fight | — | reported, not banded | 0–8 |
| clears | ≥ 8/12 in 8–12 min, deaths ≥ 1 | **unchanged**, clear time = the kill (`run.endT`) | 10–12 of 12; deaths 0–2 (see risk 1) |
| clears before 480 s | a violation | **unchanged (hard fail)** | 0 of 48 |
| a time cap firing (`gateLocked {capped: true}`) | — | **a violation** (§2.7) | 0 of 48 |
| early draft cadence (median gap, first 180 s) | 8–30 s hard | **unchanged** | risk: the Size I fight gives 0–1 levels, so one long gap appears in the window; if the median breaks, the first knob is `GATE_HP_MUL.stencil1` |
| v2 §0.6 report lines (UPROAR / OVERLOAD XP share, DEMOLITION kills) | — | unchanged, plus per run: gate spawn / breach / fight times, held time `gates.fightS`, **levels and drafts gained in each gate fight and in the city fight, the wait for `mainEarliestS`**, top-up levels, pressure peaks, RAMMING THROUGH count | |

Must pass with `--meta fresh` and `--meta full`, as in v2.

### 5.4 New probe: `_harness/probe_gatekeepers.ts` (lane K1a; node, THREE-free; exits non-zero on failure)
Runs 4 titans × 3 cities × seeds 1337 / 7 / 99 with the gate bot unless a line says otherwise:
1. **Summon.** Gatekeeper s spawns at `lockT + summonDelayS` (± 1 tick) after the tick LV `RANK_LEVELS[s]`
   is reached, unless a fight is alive or `chainGapS` applies; the city boss likewise at LV 35. Spawn
   bands per §5.3.
2. **Never breach without the kill.** Over every tick of every run: `titan.rank ≤ gates.unlocked`; every
   `rankUp` r is on a tick with `gateDefeated` slot r (r ≤ 3) or the city boss's `bossDefeated` (r = 4).
3. **The breach is on the kill tick.** For each gate kill, `rankUp` is in the same tick's events, and the
   titan's height tween lands at `titanHeightAt(r, level)` within `GROW_TWEEN_S + 1 tick`.
4. **Beatable.** ≥ 34 of 36 runs kill STENCIL-1; each gatekeeper is killed in ≥ 80 % of the runs that
   reach it; fight bands per §5.3, including each titan's median per gatekeeper in 18–75 s. With
   `--calibrate` it prints the per-titan medians for K1b's `GATE_HP_MUL` step (§3.0).
5. **Weak points.** While open (STENCIL-1 drum, CORDON-2 pack while OVERHEATED or from behind,
   SWITCHBOARD-5 dishes), ≥ 30 % of the titan's damage to the rig lands on them, for MOLO (melee) and
   VOLT-KITE (ranged). Geometry unit tests: MOLO at the keep-out / push-out distance behind STENCIL-1's
   open drum, behind CORDON-2's pack, and facing a SWITCHBOARD-5 dish → `findTarget` returns that part;
   CORDON-2's pack is the nearest part over ≥ ±40° behind it.
6. **Fair tells** (the `boss_threat` policy port, god, 5 seeds, phases forced every 30 s): tells landed
   on VOLT-KITE and MOLO in 4–20 %; every windup ≥ 0.9 s (0.8 s in P3); no hit > `GATES.hitCap`; the
   titan is never inside a hard keep-out. Run **twice**: at each gatekeeper's home Size, and at LV 35+
   Size V against each gatekeeper **rematch** (`gatesOpen(3)`, the finale skipped, KEEP GOING, the
   rotation forced to that gatekeeper).
6b. **Volley and windup geometry** (pure, no sim loop). For each gatekeeper, each phase P1–P3, each of
   the four titans' walk speeds (`moveSpeed` 0.95 / 1.15 / 0.85 / 1.0), at the home Size (H ceiling),
   at Size V (H 60 and 67), and slowed (`slowMul` 0.65) for STENCIL-1: build every volley with
   `volleyPoints` from a titan standing on the lead point (100 `rng.boss` seeds), and assert that
   **some straight escape path exists** that (a) leaves the lead tell after walking `r + R`, (b) is not
   inside any secondary tell at that tell's own fire time, and (c) needs no more time than
   `gateWindup(lead) − 0.5 s` at `ESCAPE_K[phase]`; and that DOUBLE LINE's median band for the titan's
   centre is ≥ 0.3 H, SAWHORSE TOSS's gaps are ≥ 0.84 H + 0.2 H, and STRIPE RUN's lane width equals
   2 × `parts[0].r`. Also: `gateWindup` ≥ the fair value (0.5 + escape ÷ walk × k) in every one of
   those cases (no clamp binds below fair).
7. **No soft-lock, avoider** (a bot that always walks directly away from the gatekeeper and never
   attacks, god): pressure reaches 3 by 75 s of fight time (the first seconds inside the band are engaged by proximity); `gateReposition` fires at least once when out-run;
   no tick with `pending > 0`, no fight alive and `w.t > dueT + 1 tick`; `engagedS` stays 0 and the
   fatigue clock is exactly `0.5 × liveFightS`; the gatekeeper dies to fatigue alone by 210 s of fight time.
7b. **No soft-lock, soaked fighter** (the case the avoider cannot catch): VOLT-KITE and HEARTHBACK, **no
   god**, the gate bot, SWITCHBOARD-5 with PUT THROUGH at its 14-add cap from the first tick (cheat:
   the timer forced to 0 each time it is under the cap), pressure unforced, 3 seeds × 3 cities: assert
   a kill (or a titan death, which is a legal outcome and is reported) within `GATE2_V3.gateFightS[1]`
   (90 s), and that **pressure never rises on any tick where the titan is within band max + 0.5 H**,
   and never reaches 3 in any of these runs.
8. **Time caps.** A starved run (the probe deletes every pickup each tick): the gatekeepers lock at 165 /
   320 / 430 s with `capped`; each capped breach tops the level up to `RANK_LEVELS[s]`, and `pendingDrafts`
   rises by exactly the levels granted; the city boss locks at 540 s.
9. **Finale.** On the city boss's kill: `rankUp 4` and `finale on` on the same tick; the titan takes 0
   damage during the finale; no enemy fires; `runEnd clear` comes exactly `finaleS` later (or on the
   `endFinale` skip tick) with `run.endT === gates.mainKillT` and `titan.rank === 4`.
10. **The city boss at Size IV**: `bossH === titanHeightAt(3, 35)` (50 m); `probe_boss3`'s acceptance (all
    three bosses, including PARKADE-6's till test) at LV 35 Size IV; fight median in 60–150 s with the
    gate bot and UPROAR in use; `bossFrameNeed(w).d ≤ BOSS_FRAME.maxMul × curve D` on every tick, all
    phases (§4.2); the spawn is never before `mainEarliestS`; levels gained in the fight ≤ 6.
11. **Interactions.** One UPROAR on a gatekeeper removes exactly 6 % and adds exactly 0.30 meter
    (`bossUltHit`, dps cap exempt); DEMOLITION NOTICE 2 %; RED LIGHT does not freeze a gatekeeper but
    freezes SWITCHBOARD-5's adds; the per-second cap holds: a cheat burst of 50 % in one tick lands as
    6 %, and two 50 % bursts on the last tick of one window and the first tick of the next land as
    12 % in total (tumbling window, §3.0). An open weak point overlapped by an AoE with two other parts
    takes 100 % of that hit and the others 0 (§3.0). With a weak point open and in reach and 5 enemies
    nearer, `findTarget(…, true)` returns the weak point; with it closed, the nearest enemy.
12. **EXTENDED COVERAGE.** After KEEP GOING: rematches alternate gatekeeper and city boss at 75 s gaps in
    the order of §4.4; gatekeeper rematch HP = `GATE_HP_AT_RANK[4] × (1 + 0.5 n)`; `bossH ≥ 60`; no
    breach on a rematch kill; **gate deaths never increment `E.rematches`** and increment
    `gates.rematchN[id]`; `endlessBossDmgMul` during a gate rematch = `1 + 0.1 × rematchN[id]`; the rig's
    crush tier is 4 and it moves > 5 H in its first 10 s after the intro; the director budget multiplier is
    `BOSS_SPAWN_MUL`.
13. **Determinism.** The same seed gives the same state hash with gates on (2 runs, `--det`).
14. **RAMROD.** The first `eliteSpawn` is on the first tick ≥ `killT[3] + ELITE_AFTER_RANK_IV_S` with no
    fight alive (§2.8), never while a slot 1–3 lock is pending or a fight is alive.
15. **Stuck rule.** For each city, the probe finds the densest block (the 3 × 3-block window with the
    most buildings above each gatekeeper's crush tier), places the titan on the far side of it from a
    freshly spawned gatekeeper (all three, home Size, titan standing still, god), and over the whole
    36-run matrix: no hunting interval longer than 6 s without 0.5 H of progress (§3.0); the gatekeeper
    reaches its band within 20 s in the dense-block case; RAMMING THROUGH is reported per run.
16. **Tick-end breach.** A kill landed by the first fork of a VOLT-KITE chain: the chain's later forks on
    that tick use the pre-breach stats (the `recomputeStats` stamp is after them); `rankUp` is still in
    the kill tick's events; a titan whose level is already ≥ the next gate level gets `gateLocked` on the
    kill tick (§2.5 step 5).

`probe_endless.ts` (L5's) is updated by K1a for the alternating rotation; `probe_map.ts`'s "ANNEX = the
number of breaches reached" excludes the finale breach unless the run continues into EXTENDED COVERAGE
(the ANNEX owed 20 s after the Size V breach only appears there).

### 5.5 The bot must fight gatekeepers (`_harness/bot_gate.ts`, lane K1a)
The generic boss branch of `bot.ts` already applies to gatekeepers (w.boss): it holds attack reach from
the nearest part, strafes, and the threat layer steps out of every hostile tell. `botGate(w, out)`
returns a steering point that overrides the reach target while a gatekeeper is alive:
* **STENCIL-1**: during REFILL / TIPPED OVER, the open drum's position (walk behind the cart); treat
  WET PAINT as soft threat (avoid the path when a detour costs < 1 H).
* **CORDON-2**: when in its front arc, circle toward the rear on the side of the shorter arc; dash to
  the rear when OVERHEATED or during SAWHORSE TOSS if a charge is spare; when the BACKFIRE tell is live,
  the threat layer handles it.
* **SWITCHBOARD-5**: the nearest unfolded dish; while it RELOCATEs, its base (chase at full speed,
  dash to close if the gap > 3 H); ignore adds unless they block the path (auto-attacks handle them).
* **Anti-avoid**: when a lock is pending, stop food detours and walk toward the gatekeeper's entry.
The bot never reads RNG and stays deterministic. `bot.ts` calls it through the K0 pre-wired hook.

---

## §6 Interactions

### 6.1 UPROAR (FEATURES_V2 §3)
Unchanged mechanics: `bossUltHit(w, ULT.bossCapFrac / pulses, ULT.bossMeter / pulses)` applies to
whatever is in `w.boss`, so one UPROAR removes **6 % of a gatekeeper** and adds **+0.30 meter**, exactly
as on a city boss; it is exempt from the per-second cap. Charge from hitting it is `150 × dmg /
boss.maxHp`, so a whole fight is worth about 150 points whatever the HP, as for the city bosses. The kill
adds +40. Expected use: about 1 UPROAR per gate fight. The ROAR snaps CORDON-2's knock and any leash as
it does today.

### 6.2 Objectives and power-ups during a fight (FEATURES_V2 §5–§6)
OVERLOAD SITES and RELIEF DEPOTS keep their schedules during gate fights (a RELIEF DEPOT is a legitimate
mid-fight heal). The RECORDS ANNEX still follows each breach by 20 s, so the gate kill's chest and the
ANNEX chest arrive about 20 s apart; that is intended (a breach is a reward beat). Power-up drops use
their "a boss is alive" × 0.5 rule for gatekeepers too. **RED LIGHT** ignores gatekeepers (the "rigs run
their own signals" rule) and freezes their adds. **DEMOLITION NOTICE** hits a gatekeeper for 2 % and
+0.1 meter and kills its non-elite adds.

### 6.3 The director during fights
* Budget × `gateSpawnMul(w)` while a gatekeeper is alive: `GATES.spawnMul[b.id]` (stencil1 0.35 /
  cordon2 0.4 / switchboard5 0.45) × (1 + 0.35 × pressure) at home; **`BOSS_SPAWN_MUL` (0.5) for a
  rematch** (`b.slot === 0`, no pressure). The city boss keeps `BOSS_SPAWN_MUL` and `BOSS_MIX`.
  `BOSS_SPAWN_MUL` and `BOSS_MIX` apply to `role 'main'` and to gate rematches; a home gatekeeper uses
  the rank's normal `MIX` (today both apply to anything in `w.boss`). `GATES.spawnMul` is keyed by
  `GateId`, never by slot.
* Home gatekeeper fights use the rank's normal `MIX` (at Size I that is only androids and squads).
* No elite while a gate is pending or a fight is alive; nothing during the finale.

### 6.4 Camera framing
The boss framing (`bossFrameNeed`, `BOSS_FRAME`) frames whatever is in `w.boss` with its telegraphs, so
gatekeepers get it for free; their rigs and shapes are about 2–9 H, well inside `BOSS_FRAME.maxMul`
2.0. SWITCHBOARD-5's relocation stretches it the most (a 7 H trip). **After a gate kill the framing is
not released while the breach tween runs**: the director keeps `max(held framing, curve(new H))` as a
floor for `GROW_TWEEN_S`, then releases at `BOSS_FRAME.releaseOmega`. Without this, a widened framing
could be released as the body jumps, and the camera would visibly move in during the MASS BREACH (the
run-long rule is that the camera never moves in as the titan grows; the rank-up punch is the only
deliberate dip). While a gate is held the body does not grow, so the curve's D is constant.

### 6.5 Goals, achievements and unlocks (FEATURES_V2 §8; lane K2c)
Six new goals (group `general`, so the GOALS & RECORDS tabs do not change) → **46 goals** and **50 unlock
items**, each unlock referenced by exactly one goal (`probe_meta` counts updated):

| id | Name | Condition (metric · target · scope) | Unlocks |
|---|---|---|---|
| g_gate_tipped_off | TIPPED OFF | tip STENCIL-1 over within 20 s of its arrival (gateTippedFastS · 20 · run, lowerIsBetter) | card Fresh Coat |
| g_gate_line_crossed | LINE CROSSED | stall CORDON-2 twice in one fight (gateStallsBestFight · 2 · run) | card Sawhorse Stack |
| g_gate_hang_up | HANG UP | defeat SWITCHBOARD-5 within 40 s of its arrival (gateSwitchFastS · 40 · run, lowerIsBetter) | card Call Waiting |
| g_gate_without_a_dent | WITHOUT A DENT | defeat a gatekeeper without taking any damage during its fight (gateCleanKills · 1 · run) | perk DEFERRED MAINTENANCE |
| g_gate_over_the_limit | OVER THE LIMIT | defeat all three gatekeepers in one run in under 2:15 of fighting in total (gateTotalFightS · 135 · run, lowerIsBetter) | card Blanket Exemption |
| g_gate_reissued | REISSUED | defeat a gatekeeper rematch in EXTENDED COVERAGE (gateRematchesLife · 1 · life) | card Carbon Copy |

Tally (`meta/tally.ts`, event-derived): `gateSpawn` resets `gateStaggersThisFight` and `gateFightDmg`;
`titanHurt` while `gates.active` is 1–3 adds to `gateFightDmg`; `bossStagger` while a gatekeeper is in the
slot counts to `gateStaggersThisFight` (never to the city-boss stagger metrics, so HAIRLINE FRACTURES is
untouched); `gateDefeated` updates the rest. `life.gateRematches` is a new profile counter
(`sanitizeProfile` coerces it). Existing goals checked: SKYLINE ADJUSTED (reach Size V) now means
reaching the finale; ZONING CHANGE needs CORDON-2's kill; **EARLY CLOSING** (clear LOCKWATER under 9:00)
gets harder: in the re-run emulation (§5.1) 1 of the 16 LOCKWATER clears was under 540 s and 8 were
under 600 s, so the target moves to **10:00 (600 s)**.

New unlock cards (`data/upgrades_gate.ts`, new file, appended to `UPGRADES` by one line in
`data/upgrades.ts`; all `locked: true`; descriptions from `describe()`):

| id | Name | Rarity · stacks · tags | Effects |
|---|---|---|---|
| gate_fresh_coat | Fresh Coat | common · 3 · mobility | `mul('moveSpeed', 0.05)`, `mul('smashRadius', 0.06)` |
| gate_sawhorse_stack | Sawhorse Stack | rare · 2 · survival, trigger | `add('armor', 4)`, `on('hurt', 0.3, 6, 'shield', { amount: 0.06 })` |
| gate_call_waiting | Call Waiting | epic · 2 · ult, trigger | `on('hit', 0.1, 3, 'ultCharge', { amount: 3 })` |
| gate_blanket_exemption | Blanket Exemption | epic · 1 · offense | `mul('damage', 0.12)`, `mul('maxHp', -0.08)` |
| gate_carbon_copy | Carbon Copy | rare · 2 · growth | `add('rerolls', 1)`, `mul('xpGain', 0.04)` |

Perk **DEFERRED MAINTENANCE** (`perk_deferred_maintenance`): every gatekeeper (never the city boss)
arrives with its meter at 0.25. It is checked by `probe_meta`'s per-perk rank bands like the other perks.

### 6.6 HUD, nameplate, tabloid (lane K2b)
* **GROW bar** (`ui/hud.ts`): while `sizeLocked(w)` the bar is full with a hazard-stripe fill (moving by
  transform only), a padlock glyph, and the label `SIZE LOCKED — <NAME> EN ROUTE` (pending) or
  `SIZE LOCKED — BEAT <NAME>` (fight alive); while the city boss waits for `mainEarliestS`,
  `SIZE LOCKED — <BOSS> EN ROUTE · 0:nn` (one text write per second). The "n LV to SIZE x" text is hidden (`levelsToNextSize` is 0
  anyway). Held level-ups pulse the padlock instead of the notch. Text changes are event-driven (no
  per-frame writes).
* **Nameplate** (`ui/bossbar.ts`): the GATEKEEPER variant for a `role 'gate'` def: 0.8 scale, a kicker
  line (`GATEKEEPER · SIZE I HEIGHT LIMIT`, or `REISSUED · SIZE V` for a rematch), name, `PHASE n`, the
  meter with its label (SPILL / STALL / FEEDBACK), and the subtitle as today. It hides 1.5 s after
  `gateDefeated`. The city boss keeps today's nameplate.
* **Markers** (`ui/markers.ts`, `render/markerview.ts`): `gate` (an edge arrow with the `gatekeeper`
  glyph and the name while it is off-screen) and `weakPoint` (`HIT THE DRUM` / `HIT THE PACK` / `HIT THE
  DISH`, at the part's world position while it is open), within the ≤ 12 marker budget.
* **Tabloid** (`ui/broadcast.ts`): `TabloidExtra.heldBy` → the dead front page's sub-head
  `HELD AT SIZE II BY CORDON-2`; the endless sub-head gains `REISSUED n`.
* Copy lives in the new `data/strings_gate.ts`; the six alert entries are added to `strings.ts ALERTS` by
  K0 (it is a `Record<AlertKey, …>`), with this copy:

| key | title | sub |
|---|---|---|
| gate1 | `HEIGHT LIMIT IN FORCE` | `HALVARD HAS SENT STENCIL-1 TO PAINT A LINE. THE SUBJECT MAY NOT EXCEED SIZE I.` |
| gate2 | `CROWD BARRIER ERECTED` | `CORDON-2 IS HOLDING THE LINE AT SIZE II. RESIDENTS ARE ASKED TO STAND BEHIND IT.` |
| gate3 | `ALL LINES ARE BUSY` | `SWITCHBOARD-5 IS PUTTING CREWS THROUGH. THE SUBJECT HAS BEEN PLACED ON HOLD AT SIZE III.` |
| gateEscalate | `HEIGHT LIMIT ENFORCEMENT STEPPED UP` | `THE SUBJECT IS IGNORING THE LIMIT. HALVARD IS SENDING EVERYONE.` |
| gateRematch | `HEIGHT LIMIT REISSUED` | `HALVARD HAS REDRAWN THE LIMIT — AND ENLARGED THE ENFORCER.` |
| finale | `THE CITY GOT SMALLER.` | `WARD-7 CAN CONFIRM: THE SKYLINE NOW COMES UP TO ITS KNEES.` |

### 6.7 Feedback and fx (lane K2a)
* Lock: a padlock-ratchet sting, the titan's glow parts dim to 60 % while held; each held level-up plays
  a **strain** beat (a squash that does not grow, a hazard-yellow ground ring, a creak) instead of the
  grow pop.
* Stagger words `TIPPED OVER` / `STALLED` / `LINES DOWN`; kill stamp `LIMIT LIFTED` over the wreck,
  followed by the MASS BREACH presentation.
* **The shared boss events are sized for 60–75 m rigs, so gates route around them.** Gatekeepers still
  push `bossStagger` (`addMeter`), `bossPhase` (`checkPhase`; only the alert is gated) and `bossHit`.
  Today `render/fx.ts` draws `bossStagger` as a ring out to **70 m** with a word at **y = 60 m**, and
  `bossPhase` as a **110 m** ring (fixed metres); at Size I (a 3.1 m titan, a 7 m cart) the word would sit
  ~20 titan heights above the frame and the rings would flood the screen. Rules (lane K2a):
  * `render/fx.ts`: for `w.boss.role === 'gate'`, `bossStagger` draws the gatekeeper's own stagger word
    (TIPPED OVER / STALLED / LINES DOWN) at `y = 2.6 × b.data.H` with a ring from `0.6 H` to `2.5 H`;
    `bossPhase` draws a ring from `0.5 H` to `3.0 H` (no word); `bossHit` already scales by the titan's
    H. The city-boss branches are unchanged.
  * `render/camera.ts`: trauma displacement is already `trauma² × SHAKE_MAX_H × titan height`
    (camera.ts header), i.e. relative to the titan, so the amounts are **not** rescaled by H; gates use
    `TR.bossStagger × 0.6` for `bossStagger` and **no** trauma for `bossPhase` (the city boss keeps both).
  * `audio/sfx.ts`: `bossPhase` / `bossStagger` route by role: gatekeepers play the gate stagger voices
    (§6.8) and a short phase chirp, never the city boss's `phaseSting`.
  * `ai/bossview.ts`: `resetRun()` also on **`gateSpawn`** (today only on `bossSpawn`, which gates do not
    push, so a new gatekeeper could inherit the last rig's flash / roar state).
  * `ui/hud.ts`: a wire line on `gateSpawn` (`STR.gate.wire.spawn`: `<NAME> IS ENFORCING THE SIZE <n> LIMIT`)
    and on `gateDefeated` (`LIMIT LIFTED — SIZE <n+1>`), next to today's `bossSpawn` line.
  * Shot `gate_stencil_tipped_1280` (TIPPED OVER at Size I); the critic checks the stagger word is on
    screen and inside the upper third, and that no ring covers more than half the frame width.
* Finale: dust and debris at Size V scale, `civilians.surge()`, no extra full-screen layer (the v2 rule of
  at most 2 live full-screen CSS layers holds).

### 6.8 Audio (lane K2a, `audio/sfx.ts` gate section; procedural, voice-limited)
* **Arrival stings** (`gateSpawn`, per id): STENCIL-1: a reversing beeper, an aerosol hiss and a two-tone
  chime; CORDON-2: a klaxon whoop, a track clank and a megaphone crackle; SWITCHBOARD-5: a rising ring
  tone and a four-note procedural hold-music loop fragment, with relay chirps.
* Voices: wheels and spray (STENCIL-1), tread grind, panel slam, stack pops (CORDON-2), dish servo,
  crawler rumble, the hold-music ring (SWITCHBOARD-5); stagger voices (paint glug, engine cough, dial-tone
  drop); `gateLocked` padlock ratchet; `gateEscalate` double klaxon blip; `gateDefeated` a municipal
  "approved" stamp + brass hit (the MASS BREACH stab follows).
* **Music**: gate fights keep the biome track at intensity 1.0 (no track switch; the `boss` track stays
  the city boss's); the finale resolves the boss track into a brass swell; EXTENDED COVERAGE as v2.

---

## §7 Sim/view split, exact types, events, exports and change sites

### 7.1 Split
Sim (THREE-free, deterministic): `meta/gates.ts`, `ai/bosses/stencil1.ts`, `cordon2.ts`,
`switchboard5.ts`, the toolkit changes in `ai/bosses/index.ts`, `titansim.ts`, `director.ts`,
`world.ts`, `meta/tally.ts`, `meta/endless.ts`, `data/bosses.ts`, `data/upgrades_gate.ts`,
`data/goals.ts`, `data/perks.ts`, `meta/perks.ts`, `meta/goals.ts`, `meta/profile.ts`. View / UI / audio
read state and events only: `ai/foemodels_gate.ts`, `ai/bossview.ts`, `render/*`, `ui/*`,
`audio/sfx.ts`, `game.ts`.

### 7.2 TypeScript (the exact additions; typechecked)
Merge rules for K0: a `…V3` union **replaces** the base union of the same name (drop the suffix); an
interface marked ADD FIELDS is merged field by field; `Mod*` / `*Api` interfaces are signatures to
implement, not code to copy. Typecheck used for this revision (the snippet saved to a scratch file with
its two import paths made absolute; exit 0 on 2026-09-25):
`npx tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler
--allowImportingTsExtensions --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --types node <file>`

```ts
import type {
  AlertKey, BossDef, BossState, EnemyKind, GoalMetric, HazardKind, PerkId, ProjectileKind, RankIndex, RunTally, World,
} from '../src/core/types.ts';
import type { GlyphId, MarkerKind } from '../src/v2types.ts';

// ═══════════════════════════════ core/types.ts ═══════════════════════════════
/** The three city bosses (today's BossId). BIOMES[*].boss narrows to this. */
export type MainBossId = 'caisson4' | 'irongully' | 'parkade6';
/** The three gatekeepers (GATEKEEPERS.md §2). */
export type GateId = 'stencil1' | 'cordon2' | 'switchboard5';
/** REPLACES BossId: gatekeepers run on the shared boss framework, in the w.boss slot. */
export type BossIdV3 = MainBossId | GateId;
/** BOSS_IDS keeps its meaning (the city bosses; goals, rematchOrder); its type narrows to MainBossId. */
export const BOSS_IDS_V3: readonly MainBossId[] = ['caisson4', 'irongully', 'parkade6'];
export const GATE_IDS: readonly GateId[] = ['stencil1', 'cordon2', 'switchboard5'];
/** Slot = the Size the fight guards: 1..3 the gatekeeper for the Size 1..3 breach, 4 the city boss
 *  (the Size V finale), 0 none. GATE_OF_SLOT[s] for s 1..3. */
export type GateSlot = 0 | 1 | 2 | 3 | 4;
export const GATE_OF_SLOT: readonly (GateId | null)[] = [null, 'stencil1', 'cordon2', 'switchboard5', null];
export type BossRole = 'main' | 'gate';

/** ADD FIELDS to BossDef. Main bosses: role 'main', slot 4, kicker ''. */
export interface BossDefAddV3 {
  role: BossRole;
  slot: GateSlot;
  /** small line above the nameplate name, e.g. 'GATEKEEPER · SIZE I HEIGHT LIMIT' ('' = none) */
  kicker: string;
}
/** ADD FIELDS to BossState. */
export interface BossStateAddV3 {
  role: BossRole;
  /** the Size this fight guards (1..4); 0 for a rematch in EXTENDED COVERAGE */
  slot: GateSlot;
}

export type HazardKindV3 = HazardKind | 'paint';                                   // WET PAINT (slow only, owner 'boss')
export type ProjectileKindV3 = ProjectileKind | 'paintCan' | 'sawhorse' | 'callFlare';   // hostile lobs, circle/capsule tells
export type AlertKeyV3 = AlertKey | 'gate1' | 'gate2' | 'gate3' | 'gateEscalate' | 'gateRematch' | 'finale';
export type PerkIdV3 = PerkId | 'perk_deferred_maintenance';
export type GoalMetricV3 = GoalMetric
  | 'gateTippedFastS' | 'gateStallsBestFight' | 'gateSwitchFastS' | 'gateCleanKills' | 'gateTotalFightS' | 'gateRematchesLife';

/** World.gates (NEW, meta/gates.ts). Deterministic, THREE-free. */
export interface GatesState {
  /** highest Size rank the titan may hold: 0 at the start; r after gate r's kill; 4 after the city boss's kill */
  unlocked: RankIndex;
  /** the breach the titan is waiting at (level ≥ RANK_LEVELS[slot] or the time cap, rank = slot − 1); 0 = none */
  pending: GateSlot;
  /** the fight alive right now (w.boss is it); 0 = none */
  active: GateSlot;
  capped: boolean;         // the pending lock came from the time cap (level below the gate level)
  lockT: number;           // world.t the pending lock began (-1)
  dueT: number;            // world.t the pending fight spawns (Infinity while nothing is pending)
  lastBreachT: number;     // world.t of the last gate breach (-1) — GATES.chainGapS
  spawnT: number[];        // index = slot 1..4 → spawn world.t (NaN until)
  killT: number[];         // index = slot 1..4 → kill world.t (NaN until)
  fightS: number;          // Σ seconds a gatekeeper or the city boss has been alive this run
  pressure: 0 | 1 | 2 | 3; // containment escalation of the live gate fight
  ignoredS: number;        // seconds since the titan last damaged the live gatekeeper
  engagedS: number;        // seconds of the live gate fight in which the titan damaged it within 5 s (fatigue clock)
  farS: number;            // seconds the titan has been farther than GATES.repositionRingMul × spawnRing
  dpsWin: number;          // titan damage to the gatekeeper in the current TUMBLING 1 s window (GATES.dpsCapFrac; damageBoss writes it)
  dpsWinT: number;         // start of that window (world.t); a hit at w.t >= dpsWinT + 1 starts a new window (dpsWin = 0)
  liveFightS: number;      // seconds since the live gate fight's intro ended (fatigue floor: clock = max(engagedS, 0.5 × liveFightS))
  lastAddHitT: number;     // world.t the titan last damaged one of the live gatekeeper's adds (-Infinity) — engagement rule (b)
  breachDue: GateSlot;     // set by defeat(); flushGateBreach() at the end of stepWorld runs the breach on that tick (0 = none)
  mainEarliestT: number;   // GATES.mainEarliestS (copied at createGates so a cheat/probe can move it)
  rematchN: [number, number, number];  // gatekeeper rematches defeated, by GATE_IDS index (EXTENDED COVERAGE)
  rematchSeq: number;      // alternation index of the EXTENDED COVERAGE rotation (even = gatekeeper, odd = city boss)
  finaleT: number;         // > 0: the Size V finale is running (s left)
  finaleDone: boolean;     // the finale ended → checkRunEnd clears the run
  mainKillT: number;       // world.t of the city boss's kill (-1) — becomes run.endT on clear
  topUpLevels: number;     // levels granted by time-cap top-ups this run (probe telemetry)
  rematchGates: number;    // gatekeeper rematches defeated in EXTENDED COVERAGE
}
/** ADD FIELDS to World. */
export interface WorldAddV3 { gates: GatesState }

/** ADD FIELDS to RunTally (meta/tally.ts; event-derived). */
export interface RunTallyAddV3 {
  gateKills: number;
  gateCleanKills: number;                              // gate kills with gateFightDmg === 0 at the kill
  gateTotalFightS: number;                             // Σ spawn→kill of slots 1..3 (Infinity until all three died)
  gateTippedFastS: number;                             // STENCIL-1: seconds from spawn to its first TIPPED OVER (Infinity)
  gateStallsBestFight: number;                         // CORDON-2: most STALLED in one fight
  gateSwitchFastS: number;                             // SWITCHBOARD-5: fastest spawn→kill (Infinity)
  gateRematches: number;                               // gatekeeper rematches won this run (EXTENDED COVERAGE)
  gateStaggersThisFight: number;                       // bookkeeping (reset on gateSpawn)
  gateFightDmg: number;                                // titan damage taken since the live gate fight spawned (reset on gateSpawn)
}
export type RunTallyV3 = RunTally & RunTallyAddV3;

/** ADD FIELDS to SimEvent. The city boss keeps 'bossSpawn' / 'bossDefeated'. */
export type SimEventAddV3 =
  | { type: 'gateLocked'; slot: GateSlot; capped: boolean }        // size held (SIZE LOCKED); slot 4 = the city boss is due
  | { type: 'gateSpawn'; gate: GateId; slot: GateSlot; rematch: boolean }
  | { type: 'gateDefeated'; gate: GateId; slot: GateSlot; x: number; z: number; fightS: number; rematch: boolean }
  | { type: 'gateEscalate'; level: 1 | 2 | 3 }
  | { type: 'gateReposition'; x: number; z: number }                // the gatekeeper cut the titan off
  | { type: 'gateRam'; x: number; z: number }                       // the stuck rule's RAMMING THROUGH (§3.0)
  | { type: 'finale'; on: boolean };                                // on: same tick as the city boss's kill + rankUp 4

// ═══════════════════════════════ core/config.ts ═══════════════════════════════
/** GATEKEEPERS.md §1, §4, §5. Starting points; probe_gatekeepers + GATE 2 tune them. */
export const GATES = {
  /** lock → spawn (the LV step tween settles; the arrival banner plays) */
  summonDelayS: 1.5,
  /** gatekeeper walk-in, invulnerable (the city boss keeps bosses/index.ts INTRO_S 4) */
  introS: 3,
  /** entry distance = this × spawnRing(w), on the titan's heading side */
  entryRingMul: 1.15,
  /** time caps (world.t): slot s is locked at this time even below its level (index = slot; 4 = the city boss,
   *  which also needs unlocked === 3; it reuses BOSS_AT_S) */
  capS: [0, 165, 320, 430, 540] as readonly number[],
  /** the city boss (slot 4) never spawns before this world.t (= RANK_SCHEDULE_S[4] − AHEAD_GRACE_S[4]); §4.1 */
  mainEarliestS: 440,
  /** minimum seconds between a breach and the next fight's arrival */
  chainGapS: 20,
  /** × director budget while a HOME gatekeeper is alive (keyed by id, never by slot); rematches and the
   *  city boss use BOSS_SPAWN_MUL */
  spawnMul: { stencil1: 0.35, cordon2: 0.4, switchboard5: 0.45 } as Readonly<Record<GateId, number>>,
  /** engagement (§2.4): titan within band max + this × H of the rig, or a hit on it / its adds within engageHitS */
  engageMarginH: 0.5, engageHitS: 5,
  /** stuck rule (§3.0): every checkS the distance must drop by progressH × H, else DETOUR, then RAMMING THROUGH */
  stuck: { checkS: 2, progressH: 0.5, detourS: 1.5, ramS: 1.5 },
  /** hunt: past its band a gatekeeper closes at up to this × the titan's walk (pressure ≥ 2: huntHot) */
  huntClose: 0.95, huntHot: 1.05,
  /** farther than this × spawnRing for repositionS → it re-enters off-screen ahead of the titan */
  repositionRingMul: 2.2, repositionS: 4,
  /** containment pressure: +1 per everyS of NOT-engaged time (max 3), −1 per decayS engaged (§2.4) */
  pressure: { everyS: 20, decayS: 10, budgetPer: 0.35, gapPer: 0.1, dmgPer: 0.15 },
  /** no single gatekeeper hit takes more than this × titan maxHp (the city bosses keep HIT_CAP 0.55) */
  hitCap: 0.4,
  /** titan damage to a gatekeeper per TUMBLING 1 s window ≤ this × its maxHp (UPROAR / DEMOLITION exact hits exempt) */
  dpsCapFrac: 0.06,
  /** fatigue on clock = max(engagedS, 0.5 × liveFightS): engaged play wears it down at full rate, avoidance at half */
  fatigue: { startS: 40, rampPerS: 0.0006, maxPerS: 0.025 },
  /** kill reward on top of the MASS BREACH: a chest at the wreck and UPROAR points */
  reward: { uproar: 40 },
  /** home gatekeepers crush props and buildings up to this tier (keyed by id; a rematch crushes tier 4) */
  crushTier: { stencil1: 1, cordon2: 2, switchboard5: 3 } as Readonly<Record<GateId, 0 | 1 | 2 | 3 | 4>>,
  /** STENCIL-1 / CORDON-2 / SWITCHBOARD-5 stagger length (s) */
  staggerS: 4.5,
  /** Size V finale after the city boss's kill (s); the player may skip after finaleSkipS */
  finaleS: 10, finaleSkipS: 3,
} as const;
/** Gatekeeper HP by the titan's rank at spawn (× GATE_HP_MUL[id], × (1 + ENDLESS.rematchHpStep × n) in
 *  EXTENDED COVERAGE). From the gate-bot's measured single-target DPS at the held Size (median 30 / 137 /
 *  553 / 1 509 /s at LV 7 / 16 / 27 / 35) × ~37–40 s × 0.9. Index 4 = rematches at Size V (× 45/20). */
export const GATE_HP_AT_RANK: readonly number[] = [1000, 4500, 20000, 0, 100000];   // [3] unused: no gatekeeper at Size IV
export const GATE_HP_MUL: Readonly<Record<GateId, number>> = { stencil1: 1, cordon2: 1, switchboard5: 1 };
/** GATE 2 v3 (probe_sim + probe_gatekeepers). World seconds. */
export const GATE2_V3 = {
  /** gatekeeper spawn (index = slot) and breach (Size r reached = gate r's kill) bands */
  spawnBand: [[0, 0], [60, 150], [170, 320], [270, 450]] as readonly (readonly [number, number])[],
  breachBand: [[0, 0], [80, 210], [210, 380], [300, 500]] as readonly (readonly [number, number])[],
  /** the city boss spawns inside this band (LV 35 and ≥ GATES.mainEarliestS, or the cap) */
  mainSpawn: [440, 560] as readonly [number, number],
  /** levels gained from the city boss's spawn to its kill: every run ≤ max, matrix median ≤ median */
  mainFightLevels: { max: 6, median: 4 },
  /** each gate fight spawn→kill; the per-gate median must sit in the median band */
  gateFightS: [15, 90] as readonly [number, number],
  gateFightMedianS: [25, 55] as readonly [number, number],
  /** the city boss fight at Size IV (median band; per-fight hard cap is the run-time window) */
  mainFightMedianS: [60, 150] as readonly [number, number],
} as const;
/** EXTENDED COVERAGE (REPLACES ENDLESS.bossEveryS): after KEEP GOING and after every rematch dies, the next
 *  rematch comes rematchGapS later, alternating gatekeeper (G1 → G2 → G3 …) and city boss (rematchOrder). */
export const ENDLESS_V3 = { rematchGapS: 75, scorePerGateRematch: 1500 } as const;

// ═══════════════════════════════ module signatures (sim) ═══════════════════════════════
/** src/meta/gates.ts (NEW, lane K1a). */
export interface ModGates {
  createGates(): GatesState;
  /** tick order: right after stepDirector */
  stepGates(w: World): void;
  /** titansim grow() calls it when a level reaches RANK_LEVELS[slot] with slot > unlocked (idempotent) */
  lockGate(w: World, slot: GateSlot, capped: boolean): void;
  /** bosses/index.ts defeat() calls exactly one of these on the kill tick */
  onGateDefeated(w: World, b: BossState): void;
  onMainDefeated(w: World, b: BossState): void;
  /** app skip (Enter / A after GATES.finaleSkipS) and the finale timer */
  endFinale(w: World): void;
  /** the GROW bar reads SIZE LOCKED while true */
  sizeLocked(w: World): boolean;
  /** a gatekeeper or the city boss is alive (paceMul suspends the catch-up; director reads it) */
  fightAlive(w: World): boolean;
  /** × director budget (1 outside gate fights; includes pressure) */
  gateSpawnMul(w: World): number;
  /** × gatekeeper hostile damage (pressure); 1 for the city boss */
  gateDmgMul(w: World): number;
  gateHpFor(id: GateId, rank: RankIndex, rematch: number): number;
  /** end of stepWorld, before checkRunEnd: runs onGateDefeated / onMainDefeated for gates.breachDue (§2.5) */
  flushGateBreach(w: World): void;
}
/** titans/titansim.ts additions (lane K0 pre-wire). */
export interface ModTitanAddV3 {
  /** breach to Size `rank` NOW (the kill tick): tops the level up to RANK_LEVELS[rank] with exact XP if it is
   *  below (drafts owed), sets gates.unlocked = rank, then the real rankUp path (stats, heal, events, tween) */
  breachTo(w: World, rank: RankIndex): void;
  /** the lock check grow() runs after its level loop; onGateDefeated calls it after the breach (§2.5 step 5) */
  checkGateLock(w: World): void;
}
/** ai/bosses/index.ts additions (lane K0 pre-wire). spawnBoss stays the city-boss entry point and its
 *  parameter NARROWS to MainBossId (so spawnBoss(w, 'stencil1') is a type error; testsurface's
 *  bossSpawn(id) cheat routes GATE_IDS to spawnGate). */
export interface ModBossesAddV3 {
  spawnBoss(w: World, id: MainBossId): void;
  spawnGate(w: World, id: GateId, rematch: number): void;
  /** fairWindup, slow-aware, with the max clamp × max(1, vHome / vNow) (§3.0); escape in titan heights */
  gateWindup(w: World, b: BossState, escapeH: number, min: number, max: number): number;
  /** secondary tell centres beyond the lead along the rig→lead axis (±60°, ≥ 2(r+R)+0.1H apart), §3.0 */
  volleyPoints(w: World, b: BossState, leadX: number, leadZ: number, count: number, r: number, out: Float32Array): number;
  /** free length along dir before a building above the rig's crush tier (0.5 H steps) */
  laneClearLen(w: World, x: number, z: number, dirX: number, dirZ: number, len: number, r: number): number;
  /** the stuck rule (DETOUR → RAMMING THROUGH → cut-off), §3.0 */
  gateUnstick(w: World, b: BossState): void;
  gateCrushTier(b: BossState): 0 | 1 | 2 | 3 | 4;
  /** read-only view of the live gatekeeper's add ids (SWITCHBOARD-5 crews, CORDON-2 squads) */
  gateAddIds(w: World): readonly number[];
}
/** _harness/bot_gate.ts (NEW, lane K1a): while a gatekeeper is alive, a world point to steer to
 *  (weak point, flank, chase) or null (the generic boss branch). Deterministic, pure. */
export interface ModBotGate {
  botGate(w: World, out: { x: number; z: number }): { x: number; z: number } | null;
}

// ═══════════════════════════════ APP-SIDE (views / UI; lanes K2a / K2b) ═══════════════════════════════
/** src/v2types.ts (app-side unions): an edge arrow for an arriving / off-screen gatekeeper, and a label
 *  on an exposed weak point (HIT THE DRUM / HIT THE PACK / HIT THE DISH). */
export type MarkerKindV3 = MarkerKind | 'gate' | 'weakPoint';
export type GlyphIdV3 = GlyphId | 'gatekeeper';   // a hazard-striped sawhorse (ui/icons.ts GLYPHS)
/** ui/bossbar.ts: show() takes the def; a gate def renders the GATEKEEPER variant (kicker, 0.8 scale). */
export interface BossBarApiV3 { show(def: BossDef & BossDefAddV3): void; update(b: BossState | null): void; hide(): void }
/** ui/broadcast.ts TabloidExtra ADD FIELDS: the dead front page names the gatekeeper that held the titan. */
export interface TabloidExtraAddV3 { heldBy: string | null }
/** render/civilians.ts: the finale crowd surge (view-only, cosmetic randomness allowed). */
export interface CiviliansAddV3 { surge(x: number, z: number, radius: number, count: number): void }

// ── compile-time checks that the additions fit today's types ──
type _A = EnemyKind;       // used by gateSpawnMul docs (adds kinds)
type _B = ProjectileKindV3 extends string ? true : never;
type _C = HazardKindV3 extends string ? true : never;
type _D = AlertKeyV3 extends string ? true : never;
export type _checks = [_A, _B, _C, _D];
```

**Exhaustive records that must gain entries** when the unions grow (K0 fills them so `tsc` stays at 0):
`BossId` → `data/bosses.ts BOSSES` + `BOSS_DEFAULT_SUBTITLE`, `ai/bosses/index.ts MODS`, and the
`ai/bossview.ts` rig build / warm-up / pose dispatch (placeholder branches; the lesson of v2 §2.7: a
missing branch rendered PARKADE-6 as IRON GULLY); `BiomeDef.boss` narrows to `MainBossId`;
`ProjectileKind` → `render/projectileview.ts LOOK`; `HazardKind` → `render/hazardview.ts HKINDS` and its
draw switch (and `combat/hazards.ts`'s kind → damage-kind switch: `'paint'` → `'generic'`, dps 0);
`AlertKey` → `data/strings.ts ALERTS` (§6.6 copy); `PerkId` → `data/perks.ts PERKS_DEF` and
`PERK_IDS`; `GoalMetric` → `meta/goals.ts goalProgress`; `GlyphId` → `ui/icons.ts GLYPHS` (and
`probe_icons`'s count); `MarkerKind` → `ui/markers.ts`. K0 re-greps `Record<BossId|Record<ProjectileKind|
Record<HazardKind|Record<AlertKey|Record<PerkId|Record<GlyphId|Record<MarkerKind` over `src/` and
`_harness/` before merging and completes every hit.

### 7.3 Change sites in existing files (K0 pre-wires; the lane named fills the logic)

| File | Exactly what changes |
|---|---|
| `core/world.ts` | `createWorld`: `gates: createGates()`. **Tick order**: `… stepTitan → stepDirector → stepGates* → stepEndless → stepEnemies → stepBoss …` (the rest as FEATURES_V2 §2.3), then **`flushGateBreach(w)` as the last system step, before `checkRunEnd`** (§2.5). `checkRunEnd` v3 clear branch (§4.3) |
| `core/config.ts` | the §7.2 constants; `frameDistance` / `spawnView` honour the director's post-kill floor (`director.data.postFrameD`, §6.4); the ECONOMY + THREAT table comment gains the gate rows |
| `titans/titansim.ts` | `grow()`: rank up only while `T.rank + 1 <= w.gates.unlocked`; after the loop, `checkGateLock(w)` (new export: `if (T.rank < 4 && T.level >= RANK_LEVELS[T.rank + 1] && w.gates.unlocked <= T.rank) lockGate(w, T.rank + 1, false)`). New export `breachTo(w, rank)`. `paceMul`, first lines: `if (T.rank === 3 && (w.gates.pending === 4 \|\| w.gates.active === 4)) return AHEAD_MIN; if (fightAlive(w)) return 1`. `growToRank` (dev cheat): `w.gates.unlocked = max(unlocked, want)` first, so `cheat.rank` / `cheat.level` still jump Sizes (documented bypass) |
| `ai/bosses/index.ts` | `MODS` + the three modules; `baseBoss` sets `role 'main'`, `slot 4`; `spawnBoss(w, id: MainBossId)` (narrowed) sets `slot = w.endless ? 0 : 4`; new helpers `gateWindup`, `volleyPoints`, `gateUnstick`, `gateCrushTier`, `gateAddIds` (§7.2); `pushTitanOut` skipped while `b.data.raceT > 0` (STRIPE RUN); `defeat()` sets `gates.breachDue` instead of breaching inline; new `spawnGate` (role 'gate', `gateHpFor`, `GATES.introS`, the §2.3 entry point, no `bossSpawned`, no phase change, pushes `gateSpawn`); `bossH` settled-height latch for gates; `bossHostile` × `gateDmgMul(w)`; `damageBoss`: the per-second cap (`w.gates.dpsWin`) and `b.data.lastHitT = w.t` for gates; `addMeter`: stagger length by role; `checkPhase`: the phase alert only for `role 'main'`; fatigue by role (gates on `max(w.gates.engagedS, 0.5 × w.gates.liveFightS)` with `GATES.fatigue`, §2.4); `crushUnder` and the city collision: `gateCrushTier(b)` for gates (by id; 4 for a rematch); gate city collision via `resolveCircleVsCity`; new helper `laneClearLen`; `defeat()`: push `gateDefeated` (gates) or `bossDefeated` (mains) and set `gates.breachDue`; `flushGateBreach` then calls `onGateDefeated` / `onMainDefeated` on the same tick |
| `ai/director.ts` | `budgetRate` / `weightOf`: `BOSS_SPAWN_MUL` / `BOSS_MIX` only when `w.boss.role === 'main'` or a gate rematch (`slot 0`); × `gateSpawnMul(w)`; elites only when no slot 1–3 lock is pending and `!fightAlive(w)` (§2.8); **`D.eliteT = w.t + ELITE_AFTER_RANK_IV_S` on SWITCHBOARD-5's kill** (replaces `min(ELITE_AT_S, rank IV + 30)` at line 285); no spawns and no budget while `gates.finaleT > 0`; the city-boss block moves to `stepGates`; `stepBossFrame` keeps the post-kill floor (§6.4) |
| `meta/endless.ts` (L5's, edited by K1a) | `continueEndless`: first rematch at `+rematchGapS`; the alternating rotation (`gates.rematchSeq`) and gate rematches (§4.4); score term; **`endlessBossDmgMul`**: `role 'gate'` → `1 + rematchDmgStep × gates.rematchN[ix]`, else today's `E.rematches` rule; **`stepEndless` death branch** (today line ~122): by role, a gate death increments `gates.rematchN[ix]` / `rematchGates`, never `E.rematches` (§4.4) |
| `combat/targeting.ts` (K0) | `findTarget(…, preferEnemies = true)`: before `nearestEnemy`, if `w.boss` is a live `role 'gate'` rig with `b.data.weakMask ≠ 0`, return the nearest weak part within `range` (§2.4). City bosses unchanged |
| `combat/damage.ts` (K0) | `damageArea` boss block: for a `role 'gate'` rig, if the shape overlaps a weak part (`weakMask`), the whole `c.dmg` is split among the overlapping weak parts only (§3.0); `hitEnemy`: `w.gates.lastAddHitT = w.t` when the enemy's id is in `gateAddIds(w)` (§2.4) |
| `render/fx.ts` (K2a) | `bossStagger` / `bossPhase` branches by role: gates draw H-scaled rings and their own word at `2.6 × b.data.H` (§6.7) |
| `render/camera.ts` (K2a) | gates: `bossStagger` trauma × 0.6, no `bossPhase` trauma (trauma is already titan-relative, §6.7); `gateRam` adds `TR.bossAttack` |
| `audio/sfx.ts` (K2a) | `bossPhase` / `bossStagger` routed by role; gate section (§6.8) |
| `ai/bossview.ts` (K2a) | `resetRun()` on `gateSpawn` as well as `bossSpawn`; rig scale by `b.data.H` |
| `ui/hud.ts` (K2b) | wire lines on `gateSpawn` / `gateDefeated`; the GROW-bar lock and the `EN ROUTE · 0:nn` countdown (§4.1, §6.6) |
| `meta/tally.ts` (edited by K1a) | the `RunTallyAddV3` fields and event cases (§6.5) |
| `game.ts` (K0, orchestrator) | handlers: `gateLocked` (HUD refresh, sting), `gateSpawn` (nameplate gate variant, music intensity 1), `gateDefeated` (nameplate hide after 1.5 s), `finale` (draft hold, skip hint after `finaleSkipS`, Enter / A → `mutate(endFinale)`, brass swell, `civilians.surge`); `TabloidExtra.heldBy` from `w.gates.active` at death |
| `testsurface.ts` (K0) | `state().gates` (the `GatesState` fields + the live gatekeeper's id, hp, meter, `drumOpen` / OVERHEATED / folded flags); dev cheats `gateLock(slot)`, `gateKill()`, `gateHp(frac)`, `gatesOpen(n)` (unlock through slot n without fights), `finaleSkip()`; the existing `bossSpawn(id)` cheat routes `GATE_IDS` to `spawnGate(w, id, 0)` and `BOSS_IDS` to `spawnBoss` |
| `_harness/bot.ts` (K0) | inside the boss branch: `const g = botGate(w, GATE_OUT); if (g) { steer to g }`; when `gates.pending > 0` and nothing is alive, no food detours |
| `_harness/probe_sim.ts` (K0 report lines; K1a bands) | K0 prints the gate lines; K1a switches the bands to `GATE2_V3` |

---

## §8 Build plan (after the v2 build has landed)

### 8.1 Order and chunks
```
K0  SKELETON (alone; orchestrator)        → tsc 0 · GATE 2 PASS within ±2 s of the pre-K0 run (seed 1337) · all probes ·
                                            bootcheck ×1 · playtest ×1       (the stub opens every gate: nothing changes)
K1  K1a GATE LOOP  ·  K1b GATEKEEPER SIMS (sim only; disjoint files)
    → orchestrator: COMBINED GATE 2 (--meta fresh AND full) · probe_gatekeepers · probe_boss3 · probe_endless · probe_meta
K2  K2a GATE VIEW  ·  K2b GATE UI  ·  K2c META
    → orchestrator: perfcheck ALONE (+ scenarios c, d, e) · bootcheck ×12 · playtest --matrix · playtest_gate
K3  orchestrator final battery (§8.4)
```
The **K0 stub** is inert: `createGates()` returns `unlocked: 4` (every gate open), `stepGates` contains
the director's current city-boss block verbatim, `onMainDefeated` sets `finaleDone = true` and
`mainKillT = w.t` at once, `onGateDefeated` / `lockGate` / `endFinale` are no-ops, `fightAlive` returns
`!!w.boss && w.boss.alive`, `gateSpawnMul` / `gateDmgMul` return 1, `sizeLocked` returns false,
`gateHpFor` returns `GATE_HP_AT_RANK[rank]`, and the three gatekeeper modules are placeholders (stand
still, never attack). K1a's real `createGates()` starts at `unlocked: 0`, the one-line switch that turns
the feature on. K1a and K1b are merged together before any GATE 2 run.

### 8.2 File ownership (a lane edits only these; "§" means only that named part)

| Lane | Owns (new files) | Edits in existing files |
|---|---|---|
| **K0 SKELETON** | stubs of `meta/gates.ts`, `ai/bosses/stencil1.ts`, `cordon2.ts`, `switchboard5.ts`, `ai/foemodels_gate.ts`, `data/upgrades_gate.ts` (empty), `data/strings_gate.ts` (names only), `_harness/bot_gate.ts` (returns null) | `core/types.ts`, `core/config.ts`, `core/world.ts`, `src/v2types.ts`; the Record completions of §7.2; the pre-wires of §7.3 in `titansim.ts`, `bosses/index.ts`, `combat/targeting.ts`, `combat/damage.ts` (both final: small and shared), `director.ts`, `game.ts`, `testsurface.ts`, `bot.ts`, `probe_sim.ts` (report lines); `data/bosses.ts` (role / slot / kicker on the three mains, placeholder gate defs); `data/strings.ts` (the six ALERTS); `ai/bossview.ts` (placeholder branches for the three ids); `meta/tally.ts` and `meta/endless.ts` (field initialisation only) |
| **K1a GATE LOOP** | `meta/gates.ts` (real), `_harness/bot_gate.ts`, `_harness/probe_gatekeepers.ts` | `meta/endless.ts` (§4.4), `meta/tally.ts` (§6.5 fields and cases), `_harness/probe_sim.ts` (GATE2_V3 bands), `_harness/probe_endless.ts` (rotation), `_harness/probe_map.ts` (the ANNEX count note, §5.4) |
| **K1b GATEKEEPER SIMS** | `ai/bosses/stencil1.ts`, `cordon2.ts`, `switchboard5.ts` | `data/bosses.ts` (the three final defs: attacks, subtitles, kickers) |
| **K2a GATE VIEW** | `ai/foemodels_gate.ts` | `ai/bossview.ts` (rig registration, scale by `b.data.H`, poses), `render/projectileview.ts` (`LOOK.paintCan / sawhorse / callFlare`), `render/hazardview.ts` (`paint`), `render/markerview.ts` (`gate`, `weakPoint`), `render/fx.ts` (stagger words, `LIMIT LIFTED`, strain beat, the role-routed `bossStagger` / `bossPhase` branches of §6.7), `render/civilians.ts` (`surge`), `render/camera.ts` (trauma cases for the gate events, §6.7), `titans/titanview.ts` (the held-glow dim + strain squash), `audio/sfx.ts` (gate section; `bossPhase` / `bossStagger` routed by role) |
| **K2b GATE UI** | `data/strings_gate.ts` (full copy) | `ui/hud.ts` (GROW bar lock), `ui/bossbar.ts` (gate variant), `ui/broadcast.ts` (`heldBy`, `REISSUED n`), `ui/markers.ts` (two kinds), `ui/icons.ts` (`gatekeeper` glyph), `_harness/probe_icons.ts` (glyph count) |
| **K2c META** | `data/upgrades_gate.ts` (the five cards) | `data/upgrades.ts` (one append line), `data/goals.ts` (+6, EARLY CLOSING 600 s), `meta/goals.ts` (6 metrics), `meta/profile.ts` (`life.gateRematches`), `data/perks.ts` + `meta/perks.ts` (the perk), `_harness/probe_meta.ts` (46 / 50 counts, reachability), `_harness/probe_upgrades.ts` (coverage if it asserts counts) |
| **orchestrator (K3)** | `_harness/playtest_gate.py` | `game.ts` / `testsurface.ts` cross-lane wires, `_harness/shots.py` (group `gates`), `_harness/perfcheck.py` (scenarios c, d, e), `README.md` (the gates, controls, cheats), `_spec/CONTRACT.md` (§16 rows for K0–K2) |

No two lanes in one chunk share a file. `game.ts` and `testsurface.ts` stay orchestrator-only.

### 8.3 Gates each lane must pass (paste the command and the output tail in the report)

| Gate | K0 | K1a | K1b | K2a | K2b | K2c |
|---|---|---|---|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` → 0 errors | ● | ● | ● | ● | ● | ● |
| `node _harness/probe_gatekeepers.ts` exit 0 | — | ● | ● | — | — | — |
| `node _harness/probe_sim.ts --det 2` → `GATE 2: PASS`, `--meta fresh` **and** `--meta full` | ● (old bands, ±2 s) | ● | ● | — | — | ● |
| every existing probe (`ai city combat econ titan upgrades ult evolutions boss3 map meta endless icons`) exit 0 | ● | ● | ● | — | ● (icons) | ● |
| scratch preview + a harsh self-critique of its own shots (CONTRACT §0.5) | — | — | — | ● | ● | — |
| `python _harness/bootcheck.py --titan T --biome B` (all 12) | ● (×1) | — | — | ● | ● | — |
| `python _harness/playtest.py --matrix` (real keys) | ● (×1) | — | — | ● | ● | — |
| shots added to `_harness/shots.py` and captured | — | — | — | ● | ● | — |
| `python _harness/perfcheck.py`: **run by the orchestrator, alone**, after K2 | | | | ● | ● | |

**Real-input playtest `_harness/playtest_gate.py`** (orchestrator, after K2; cheats only set state, every
action is a real key, pad button or walk):
1. Start a run from the title with real keys; cheat XP to 1 point short of LV 7; eat a prop (real
   **W**) → `gateLocked`; the DOM GROW bar reads `SIZE LOCKED — STENCIL-1 EN ROUTE`, then `… BEAT
   STENCIL-1`; the nameplate shows the GATEKEEPER kicker.
2. Fight with real keys (WASD + Space + Shift), god on; after a STRIPE RUN walk behind the cart and hit
   the open drum → SPILL rises; cheat `gateHp(0.03)`; land the kill with a real attack → the same frame's
   events hold `gateDefeated` and `rankUp 1`; the MASS BREACH banner is visible; `titan.rank === 1`.
2b. **No HP cheat:** a fresh STENCIL-1 fight from its spawn, god on, **no** `gateHp`: steer with real keys
   (the script reads `state().gates` and the rig's position, and presses WASD / Space / Shift only)
   out of each STRIPE RUN lane, behind the cart during REFILL, attacks on the open drum until SPILL
   fills → `bossStagger` with the TIPPED OVER word; budget 120 s of game time; report SPILL per REFILL
   window and the time to TIPPED OVER.
3. Avoidance: cheat to the CORDON-2 lock; hold real keys away from it for 45 s → `gates.pressure ≥ 2`; the
   gatekeeper stays within 2.2 × spawnRing (repositions).
4. Finale: cheat `gatesOpen(3)` + LV 35 → the city boss spawns; cheat its HP to 1 %; kill it with a real
   attack → `finale on`, `titan.rank === 4`, the `THE CITY GOT SMALLER.` banner in the DOM; press real
   **Enter** after 3 s → the tabloid prints (clear variant) and its time equals the kill time.
5. Real **K** on the clear tabloid → EXTENDED COVERAGE at Size V; 75 s later a gatekeeper rematch spawns
   with the `REISSUED · SIZE V` kicker.
6. Gamepad (stubbed standard pad, as in `playtest_v2.py`): pad **A** skips the finale.

**Perfcheck scenario (c)**: a SWITCHBOARD-5 fight at Size III with its adds + 150 enemies, and one UPROAR
in the window: p99 ≤ 22 ms, ≤ 450 draw calls; the gate rig ≤ 0.3 ms main-thread (frameprof mark).
**Scenario (d)**: STENCIL-1 in P3 at Size I with the maximum WET PAINT load held live (a U-TURN's two
stripe lanes, 5 bucket puddles, both DOUBLE LINE lanes and the TIPPED OVER pool: 10 `paint` hazards,
4–5 s each, re-spawned by cheat as they expire) + 150 enemies: the same p99 / draw-call limits, and
`hazardview` ≤ 0.2 ms. **Scenario (e)**: the finale at Size V with a fixed `civilians.surge(x, z,
3 × H, 120)` (120 civilians; the §4.3 call uses the same count), Size V destruction running and the
stunned enemies live: the same limits over the 10 s.
**Shots**: `gate_stencil_intro / _stripe / _refill / _tipped`, `gate_stencil_tipped_1280` (critic: the
stagger word on screen, §6.7), `boss_caisson_s4 / boss_gully_s4 / boss_parkade_s4` (§4.2), `gate_cordon_shove / _flank / _stalled`,
`gate_switch_callin / _relocate / _linesdown`, `grow_locked_1280`, `grow_locked_1920`, `finale_s5`,
`tabloid_heldby`, `gate_rematch_v`. The orchestrator's critic checks telegraph readability at each home
Size, the rig silhouettes against the originality rules of §3.5, and that the GROW bar lock is legible.

### 8.4 Definition of done
All §8.3 gates pass as observed in one final orchestrator battery on a `BT_FROZEN=1` server: `tsc` 0;
GATE 2 PASS (fresh and full) with the §5.3 bands; every probe including `probe_gatekeepers` exits 0;
bootcheck ×12; playtest --matrix; playtest_v2; playtest_gate; leakcheck (newRun × 7 returns to the same
geometries, textures and programs with a gatekeeper rig built); perfcheck alone including scenarios (c), (d), (e);
shots + critic; README updated.

---

## §9 Owner decisions (the defaults above are built unless the owner says otherwise)
1. **Growth pauses at the ceiling while a gate is held**, and the breach pays the held levels back.
   Alternative: keep growing inside the Size (the lock would read weaker).
2. **The rubber band's catch-up is off during fights.** Alternative: leave it on (runs about 20–40 s
   faster, more XP mid-fight).
3. **Time caps** 165 / 320 / 430 / 540 s, with a level top-up on a capped kill. Alternative: no caps (a
   weak run could pass 12 min).
4. **RAMROD stays a separate elite**, now only between SWITCHBOARD-5 and the city boss.
5. **Per-second damage cap on gatekeepers** (6 % of max HP per s), so strong builds still get a fight.
6. **Finale** 10 s, skippable after 3 s, with `THE CITY GOT SMALLER.` as a live banner before the paper.
7. **EXTENDED COVERAGE** alternates gatekeeper and city-boss rematches at Size V every 75 s.
8. **Names**: STENCIL-1, CORDON-2, SWITCHBOARD-5 and the HEIGHT LIMIT framing.
9. **The city boss never arrives before 7:20 (440 s)**, even if LV 35 comes earlier (the bar counts down
   to it; the city keeps coming). Alternative: a floor on the city fight's length instead (a damage cap
   on the city boss), which makes the climax feel artificially armoured.
10. **XP is governed (× 0.35) while the city boss is due or alive**, so the climax gets 1–4 draft screens,
   not 2–18. Alternative: bank those drafts until the kill (the finale holds drafts, so they would
   only matter in KEEP GOING).

---

## §10 Evidence (tool output, 2026-09-25)
* **Baseline GATE 2**, current tree: `node _harness/probe_sim.ts --det 0 --quiet --json <scratch>` →
  `clears 10/12 (in 8–12 min: 10) · deaths 2 · timeouts 0`, `GATE 2: PASS`, wall 70.7 s; per-run rank
  times, boss spawn, end times and XP/s per Size as quoted in §5.1 (LV = Size thresholds 7/16/27/35 on
  every run).
* **Hold emulation**: a scratch script (not repo code) imports `createWorld`, `stepWorld`, the draft
  functions, `botInput` / `botPickUpgrade`, `growToRank`, `recomputeStats`, `spawnBoss`; on each `rankUp`
  to an uncleared Size it sets `titan.rank` back and calls `recomputeStats`, releases with `growToRank`
  after the hold, holds the director's own boss (`bossT = Infinity`) and spawns the city boss at LV 35 at
  Size IV. Variants `stand 35 40 45`, `eat 35 40 45`, `stand 55 60 65`; results in §5.1. One scratch bug
  was found and fixed during the work (a second city-boss spawn when a level-up landed on the kill tick
  overwrote the spawn time); the table uses the fixed runs.
* **DPS at each held size**: a scratch script that, at LV 7 / 16 / 27 / 35, holds the previous rank,
  removes every enemy, turns spawns off, spawns a RAMROD with 1e9 HP frozen by `w.map.redLightT`, drains
  UPROAR, holds the titan at 0.3–0.7 × its attack reach with the hook on cooldown (VOLT-KITE
  strafe-dashing), and sums its `enemyHit` damage over 20 s → `LV 7: min 23 median 30 max 113 ·
  LV 16: 34 / 137 / 542 · LV 27: 124 / 553 / 1 747 · LV 35: 250 / 1 509 / 8 660`. It is a crude
  single-target proxy (no boss kind multipliers, no dodging), calibrated against the emulated city-boss
  fights at Size IV (about 150 000 HP in about 100 s).
* **Code read for the design**: `core/config.ts` (RANKS, RANK_LEVELS, BREACH_JUMP, titanHeightAt,
  RANK_SCHEDULE_S, AHEAD_*, BOSS_* constants, bossFrameNeed / frameDistance / spawnView),
  `titans/titansim.ts` 500–658 (paceMul, gainXp, growToRank, addXp, grow, rankUp, hurtTitan),
  `ai/bosses/index.ts` (the whole toolkit, spawnBoss, stepBoss, damageBoss, defeat, bossUltHit),
  `ai/bosses/caisson4.ts` header and constants, `ai/bosses/parkade6.ts` and `irongully.ts` range / keep-out
  constants, `ai/director.ts` (whole), `ai/enemies.ts` stepElite, `combat/damage.ts killEnemy`,
  `combat/hazards.ts` slow rule, `core/world.ts checkRunEnd` + tick order, `core/types.ts` boss / run /
  event / v2 types, `src/v2types.ts`, `game.ts appEvents`, `meta/endless.ts` scheduling,
  `data/bosses.ts`, `data/strings.ts` ALERTS + RANK_SUBS, `_harness/bot.ts` policy,
  `_harness/probe_sim.ts` bands and run loop.
* **Re-run emulation (revision 2)**: `gate_emu3.ts` = the hold emulation plus `--floor 440` (no city-boss
  spawn before 440 s), `--hp4 x` (sets `BOSS_HP_SCALE[3]` at runtime), and `--paceFix` (an `xpGain` buff
  each tick that makes the net XP multiplier exactly 1 during a hold, cancelling today's `paceMul`, and
  exactly `AHEAD_MIN` from LV 35 at Size IV to the kill); it also records levels gained per hold and per
  city fight. Command: `node gate_emu3.ts <eat|stand> F1 F2 F3 <seed> --floor 440 --hp4 0.8 --paceFix`.
  Output lines (hp4 0.8): stand 35/40/45 `under480 none minClear 502 maxClear 657 fights 62-161` · `clears
  11/12 (8–12 min: 11) deaths 1`; eat 35/40/45 `under480 none minClear 564 maxClear 643 fights 74-151` ·
  `clears 10/12 … deaths 2`; stand 55/60/65 `under480 none minClear 548 maxClear 664 fights 79-160` ·
  `clears 11/12 … deaths 1`; eat 35/40/45 seed 7 `under480 none minClear 560 maxClear 658 fights 115-162`
  · `clears 12/12 … deaths 0`. With hp4 0.9: `minClear` 510 / 553 / 554 / 571, clears 8 / 12 / 10 / 11,
  deaths 4 / 0 / 2 / 1. With only `--floor 440 --hp4 0.9` (no paceFix): 0 clears under 480 (min 506)
  but 2–18 levels gained per city fight. Full tables in §5.1.
* **Geometry check (revision 2)**: `geo_check.py` (scratch) evaluates `gateWindup` for every lead tell at
  home, slowed ×0.65 (STENCIL-1) and Size V H 60 / 67, for moveSpeed 0.95 / 1.15 / 0.85 / 1.0, P1–P3,
  against the fair value `0.5 + escape ÷ walk × min(1, k)`: with the §3.0 rule no case is below fair;
  with the old fixed max clamps, every Size V case of STRIPE RUN and SHIELD SHOVE and the slowed Size V
  cases of PAINT BUCKETS and DOUBLE LINE were below fair (e.g. SHIELD SHOVE P1, HEARTHBACK, H 60: fair
  2.85 s vs the 2.2 s clamp). Volleys: buckets at ≥ 1.84 H keep ≥ 1.17 H between the exit landing
  and any secondary's centre over the ±90° rig-side arc (need 0.87 H); flares at ≥ 1.94 H keep ≥ 1.23 H
  (need 0.92 H); DOUBLE LINE at 1.4 H spacing left a 0.06 H band (0.19 m at Size I), at 2.0 H a 0.66 H
  band (2.06 m); SAWHORSE gaps at 1.0 H spacing were 0.5 H (< the 0.84 H body), at 1.6 H 1.1 H.
* **Code read for revision 2** (each finding checked before it was accepted): `combat/targeting.ts
  findTarget` (enemies first when `preferEnemies`), `titans/kits/voltkite.ts nextTarget` (unhit enemies,
  then one boss part), `core/config.ts` `BOSS_FATIGUE` comment and `BOSS_HP_SCALE`, `titanSpeed`,
  `RANKS[].canFlatten`, `AHEAD_*` / `RANK_SCHEDULE_S`; `_harness/probe_sim.ts:72` `CLEAR_WINDOW_S = [480,
  720]` and `:493` the too-fast violation; `ai/bosses/index.ts` `keepRange`, `fairWindup` / `titanWalk`
  (no slow factor), the eased push-out `p.r + T.radius × 0.7`, `BOSS_FATIGUE` on `fightT`;
  `titans/titansim.ts` `titanMaxSpeed` (no `slowMul`) and the movement's `slowMul` factor, `paceMul`;
  `combat/damage.ts damageArea` (equal split, lines 255–270); `meta/endless.ts` `stepEndless` death
  branch and `endlessBossDmgMul` (`E.rematches`); `ai/director.ts:285` the RAMROD `eliteT` rule;
  `render/fx.ts` `bossStagger` (70 m ring, word at y 60) and `bossPhase` (110 m ring); `render/camera.ts`
  trauma ∝ titan height; `ai/bossview.ts` `resetRun` only on `bossSpawn`; `ui/hud.ts` wire on
  `bossSpawn`; `ai/enemies.ts` `APC_MAX_SQUADS` 2 × `SQUAD_SIZE` 5.
* **Types**: the §7.2 snippet (revision 2) extracted from this file, import paths made absolute, and
  typechecked with the command given there → exit 0.
* **Names**: the `grep -rilw` checks listed in §1. New words in revision 2 (`RAMMING THROUGH`, `gateRam`,
  `mainEarliestS`) are descriptive labels, not titles.

---

## Review log (revision 2, 2026-09-25)

Each finding of the independent review → what changed. Where a design was kept, the rationale is given.

| # | Sev. | Finding | Resolution |
|---|---|---|---|
| B1 | blocker | Soft-lock loop: `findTarget(…, true)` returns enemies before boss parts; adds soak auto-attacks → no gate damage → pressure rises (more adds) and damage-based fatigue never starts; no time bound. The avoider probe cannot see it | §2.4 rewritten. (1) Engagement is proximity (within band max + 0.5 H) **or** a hit on the gatekeeper **or its adds** within 5 s. (2) Fatigue clock = `max(engagedS, 0.5 × liveFightS)`, so every fight is bounded (~101 s engaged, ~202 s for a pure runner). (3) Pressure rises only while not engaged, so it can only fall while the titan stands in the fight. (4) `findTarget` returns an **open weak point in reach** before enemies for gatekeepers (VOLT-KITE forks keep their order; rationale in §2.4). (5) New probe case **7b**: VOLT-KITE and HEARTHBACK, no god, SWITCHBOARD-5 at the 14-add cap, pressure unforced: kill within 90 s, pressure never rises inside the band and never reaches 3. BULWARK removed from PUT THROUGH (m6) |
| B2 | blocker | Multi-tell volleys not escapable at the home Size: PAINT BUCKETS / CALL-IN rings cover 360° in P2/P3; SAWHORSE gaps 0.5 H < 0.84 H body; DOUBLE LINE median slack 0.06 H | §3.0 **volley rule** (`volleyPoints`): secondaries only beyond the lead along the rig→lead axis within ±60°, ≥ 2(r+R)+0.1 H apart, so the rig-side half-plane is always clear and the lead's windup (computed for `r + R`) covers the whole volley; a minimum lead distance from the rig so the exit is not into the keep-out (else the axis turns tangential). Buckets ≥ 1.84 H, flares ≥ 1.94 H, sawhorses at 1.6 H spacing and never behind the lead (1.1 H gaps), DOUBLE LINE spacing 1.4 → **2.0 H** (1.5 H median, 0.66 H band). New probe case **6b**: an escape path exists for every volley, P1–P3, all four walk speeds, home Size, slowed and Size V |
| M1 | major | Pacing evidence read as a pass, but `probe_sim` hard-fails clears < 480 s; 2 of 3 emulated variants had one (414, 451 s) | Reported as a **predicted GATE 2 FAIL** (header, §5.1). Lever chosen: a city-boss **spawn floor** `GATES.mainEarliestS` = 440 s (§4.1), together with the governed XP rate (M6). `BOSS_HP_SCALE[3]` 0.9–1.0 was the suggested alternative; 0.9 was run and gave more deaths and 8/12 clears in one variant, so HP stays 0.8 (rationale in §4.2). Re-run emulation, 48 runs: **0 clears under 480 s** (502–664 s), 10–12/12 per variant (§5.1, §10). The remaining risk (0 deaths in one optimistic variant) is stated in §5.1 |
| M2 | major | Gatekeepers get stuck on buildings: no pathing, no stuck rule; CORDON-2 / SWITCHBOARD-5 wider than roads; SWITCHBOARD-5 had no band | §3.0: crush tiers raised to 1 / 2 / 3 (one above the same Size's `canFlatten`); **stuck rule** `gateUnstick` (2 s progress check → DETOUR → RAMMING THROUGH → cut-off); SWITCHBOARD-5 gets an explicit band `[1.67, 4.5] H` with a HUNT drive (§3.3). Probe case **15**: the densest block per city, no hunting interval > 6 s without 0.5 H of progress (6 s rather than the suggested 4 s, because the rule's own worst case is 2 + 2 + 1.5 s) |
| M3 | major | Rematches index `crushTier` / `spawnMul` by `b.slot = 0`; `endlessBossDmgMul` uses the city-boss count; `stepEndless` would count a gate death as a city rematch | Tables keyed by `GateId` and role (`gateCrushTier`, `gateSpawnMul`): a rematch crushes tier 4 and uses `BOSS_SPAWN_MUL`. §4.4 and §7.3 name the `endlessBossDmgMul` and `stepEndless` death-branch changes; new `gates.rematchN`, `rematchSeq`. Probe case **12**: gate deaths never increment `E.rematches`; the rematch rig moves > 5 H in its first 10 s |
| M4 | major | At Size V the fixed max clamps make SHIELD SHOVE etc. unwalkable; the WET PAINT slow is ignored by `fairWindup` | `gateWindup` (§3.0): a slow-aware walk, and the max clamp × `max(1, vHome / vNow)`. Scratch check (§10): no case below fair at home, slowed or Size V, for all titans. Probe case **6** runs the fairness port twice: home Size, and LV 35+ Size V rematches |
| M5 | major | STRIPE RUN: a 0.7 H lane but a 1.7 H cart body with push-out; a titan that dodged still gets shoved | Lane = the cart's footprint, **1.7 H**, escape `0.85 H + R`; `pushTitanOut` suspended during the 0.4 s race along the centre line; the 0.7 H WET PAINT stripe is drawn inside the tyre track (§3.1) |
| M6 | major | The city fight at Size IV owes 5–12 drafts (a level every ~11 s) | Measured and reported: 2–18 levels per city fight without a rule. Rule: `paceMul` = `AHEAD_MIN` while the city boss is pending or alive at rank 3 (§4.2, §5.2) → 1–4 levels measured. New GATE2_V3 band `mainFightLevels` (max 6, median ≤ 4); per-fight levels and drafts in the report lines (§5.3). Banking drafts was rejected (the finale holds drafts, so banked ones would only matter in KEEP GOING) |
| M7 | major | The shared boss fx / trauma / sfx / bossview reset are sized for 60–75 m rigs or keyed on `bossSpawn` | §6.7 and §7.3 list `render/fx.ts` (H-scaled gate branches), `render/camera.ts` (trauma is already titan-relative, so × 0.6 for stagger and none for phase, with the rationale), `audio/sfx.ts` (role routing), `ai/bossview.ts` (`resetRun` on `gateSpawn`) and `ui/hud.ts` (wire lines), each with its lane; shot `gate_stencil_tipped_1280` with the critic check |
| m1 | minor | HP derived without `BOSS_KIND_MUL` and the AoE split; the drum's 2× pays about 1.25× | §3.0: the numbers are starting values; K1b **calibrates** `GATE_HP_MUL` against the real modules (`probe_gatekeepers --calibrate`) before GATE 2, plus a per-titan fight band (18–75 s). **An open weak point takes the whole AoE hit** (a `damageArea` change); STENCIL-1's rear wheels moved forward out of the drum's approach |
| m2 | minor | "RAMROD 30 s after the Size IV breach" was wrong (`min(390, IV + 30)` is usually already past) | §2.8: `D.eliteT = killT[3] + ELITE_AFTER_RANK_IV_S`, set explicitly in `director.ts` (§7.3); a city-boss lock waiting for `mainEarliestS` does not hold it; probe case **14** |
| m3 | minor | A chained lock would wait for the next level-up; the breach runs mid-attack | §2.5: the breach runs in `flushGateBreach` at the end of `stepWorld` (same tick, after every system), and `onGateDefeated` calls the exported `checkGateLock` directly. Probe case **16** |
| m4 | minor | The caps sit just outside their bands; a capped chain could exceed 720 s | §2.7: a cap firing is a GATE 2 failure by design (a §5.3 row); the worst-case all-capped timeline is shown (718.5 s); `capS[3]` 460 → **430** |
| m5 | minor | The camera at Size IV may reach `BOSS_FRAME.maxMul` | §4.2 and probe case **10**: `bossFrameNeed ≤ maxMul × curve` on every tick of each city fight at LV 35 Size IV; a shot per city boss at Size IV |
| m6 | minor | The P3 BULWARK deploys PICKET squads outside the add list | BULWARK dropped from PUT THROUGH (P3 adds a HOPPER); CORDON-2's squads join the same add list (`gateAddIds`) |
| m7 | minor | Widening `BossId` allows `spawnBoss(w, 'stencil1')`; `GATE_HP_AT_RANK[3]` unused; "rolling" vs tumbling | `spawnBoss` narrowed to `MainBossId`, and the `bossSpawn` cheat routes gate ids to `spawnGate`; index 3 = 0 with a comment; the window is **tumbling**, and the 12 % boundary case is stated and probed (case 11) |
| m8 | minor | "46.7 vs 58 m/s" is wrong | §4.2: `titanSpeed(60)` = 53.5 m/s at LV 35; windups about 4.5 % shorter |
| m9 | minor | Perfcheck covered only SWITCHBOARD-5; the playtest never finishes a fight without an HP cheat | Perfcheck scenarios **(d)** STENCIL-1 P3 with 10 live paint hazards and **(e)** the finale with a fixed 120-civilian surge; playtest step **2b**: STENCIL-1 from spawn, god on, no HP cheat, through a REFILL drum hit to TIPPED OVER |
