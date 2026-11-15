# DRIFTWAKE — PROGRESSION & SCALING DESIGN

Companion to **DRIFTWAKE — COMBAT DESIGN** (the combat doc). That doc owns enemy archetypes, telegraphs, attack tokens, packs, and bosses. This doc owns everything that makes numbers move: XP, levels, enemy scaling, realm bands, unlocks, death, saves, and the build plan that closes every audited gap. Where the two docs touch, §10 defines the contract.

Research basis: EverQuest (curve shape, hell-level failure, ZEM, con colors), Diablo 2 (level-band XP penalty, floor, co-op), Diablo 3/4 (session pacing, streaks, Paragon, world-scaling backlash + patch 1.1.0), WoW (kill formula, gray cutoff, con palette, rested XP), Elden Ring (risk currency), Hades (death-as-progression), Oblivion/ESO/GW2 (scaling cautionary tales). Specific lessons are cited inline where they set a number.

---

## 1. The Anchor Contract (read this first)

Every stat in the combat doc is a **level-10 snapshot**. One anchor, everything scales around it:

| Combat doc number | Meaning under this doc |
|---|---|
| Enemy stat blocks (HP, damage, all Cold rows) | Exact stats at **enemy level 10** (Cold's bandMax). A Cold enemy at L10 matches the doc verbatim. |
| Player HP pool = 100 | Player max HP at **player level 10**. |
| Player spell damage (bolt, wave, vortex, spikes) | Player damage at **player level 10**. |
| Health mote +10 | Redefined as **+10% of player max HP** (= exactly +10 at L10; doc holds at anchor, scales cleanly). |
| Assassin opener 26–30, brute slam 22–28 | Fraction of pool at even con: **constant at every level** (see §5.3 invariant). |
| Telegraph timings, token counts (2+2 / 3+3), leash radii (40 m / 25 m / arena), pack compositions, alarm windows, difficulty-budget costs (fodder 1 / light 2 / medium-caster 3 / heavy 5 / elite 8 / boss 25–40) | **Level-invariant.** Stand verbatim at all levels. Behavior never scales; only HP/damage numbers do. |
| §8.3 realm multipliers (HP ×1.3/×1.7, dmg ×1.25/×1.5) and "+15% player damage per realm" | **Superseded / errata** — see §10.2. The per-level formulas below replace the coarse realm multipliers; the +15%/realm player growth is preserved through shrine boons (§8.3 here). |

Level cap: **30**. Three realms of ten (owner directive: Cold ~1–10, then Sand, then Ash). The gap audit's provisional cap-12 sketch is superseded by this; its per-tier XP idea survives as the tier multipliers in §3.2.

---

## 2. XP Curve — Levels 1–30

### 2.1 Formula

```
XP_to_next(1) = 50                      (flat override — first-ding hook)
XP_to_next(L) = round(85 × L^1.9)       for L = 2..29
Level cap = 30 (no XP_to_next at 30; overflow feeds Driftmarks, §9)
```

**Why exponent 1.9:** between WoW's effective quadratic and EQ's cubic. EQ's cubic produced a 500-hour grind and was rejected by the entire successor market; cubic only works when payouts also scale by area (Elden Ring). **No step multipliers anywhere** — EQ's hell levels (level 40 costing 2.25× its neighbors: 5.34 M → 12.02 M → 6.40 M) are the canonical proof that a discontinuous per-level cost reads as *broken*, not *hard*. Our per-level ratio `need(L+1)/need(L)` declines monotonically — the curve is smooth by construction.

**Why the L1 override:** the formula gives L1→2 = 85 XP ≈ 90 s of play; the genre target (D3-derived) is *first ding inside the first minute*. The 50 XP arithmetic, itemized: tutorial dummy first-blood (20, §3.5) + first pack (≈2.2 medium-equivalents × 10 ≈ 22) + first shrine activation (12% of 50 = 6) ≈ 48, and one stray imp dings — ≈ 45–70 s of play. This is a downward exception (cheaper, never costlier) — the hell-level lesson forbids cost *spikes*, not onboarding discounts. **This arithmetic only works because the §3.1 per-kill cap carries a floor at the player's own-level base kill XP**: the bare 12.5% cap at L1 is 6.25 XP, which would cut a medium kill from 10 to 6, push first ding to ~8 medium-equivalents, and kill the hook. The floor exists for exactly this row.

### 2.2 Full table

Assumptions used for the last two columns (stated per evidence rules, tune in playtest): kill income ≈ 70% of leveling (objectives/shrines/bosses ≈ 30%, §3.5); average engaged pack cadence ≈ 33 s (fight + surf between packs at 1 pack per ~120 m of surf line, combat doc density); med-equivalents per pack follow this **explicit level schedule** — the min/level column is fully derivable from it, and P4.4 tests against it:

```
Pack size (medium-equivalents, via §3.2 tier multipliers over the combat doc budget tables):
  L1–3   early Cold  ≈ 2.2      L10–19  Sand  ≈ 6.5
  L4–9   full Cold   ≈ 3.3      L20–29  Ash   ≈ 9.0

min/level = 0.70 × XP_to_next(L) ÷ (medEq(L) × BaseKillXP(L)) × 33 s ÷ 60
```

"Even-con kills" = `XP_to_next(L) ÷ BaseKillXP(L)` — solo medium-tier kills at equal level, no multipliers.

| L | XP to next | Cumulative at L | Base kill XP (medium, even con) | Even-con kills | Est. min/level | Realm (expected) |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 50 | 0 | 10 | 5 | ~0.9 | Cold |
| 2 | 317 | 50 | 24 | 13 | ~2.3 | Cold |
| 3 | 685 | 367 | 39 | 18 | ~3.1 | Cold |
| 4 | 1,184 | 1,052 | 57 | 21 | ~2.4 | Cold |
| 5 | 1,809 | 2,236 | 75 | 24 | ~2.8 | Cold |
| 6 | 2,558 | 4,045 | 94 | 27 | ~3.2 | Cold |
| 7 | 3,429 | 6,603 | 114 | 30 | ~3.5 | Cold |
| 8 | 4,419 | 10,032 | 135 | 33 | ~3.8 | Cold |
| 9 | 5,527 | 14,451 | 156 | 35 | ~4.1 | Cold (boss ~here) |
| 10 | 6,752 | 19,978 | 178 | 38 | ~2.2 | Cold→Sand handoff |
| 11 | 8,092 | 26,730 | 200 | 40 | ~2.4 | Sand |
| 12 | 9,547 | 34,822 | 223 | 43 | ~2.5 | Sand |
| 13 | 11,115 | 44,369 | 247 | 45 | ~2.7 | Sand |
| 14 | 12,796 | 55,484 | 271 | 47 | ~2.8 | Sand |
| 15 | 14,588 | 68,280 | 295 | 49 | ~2.9 | Sand |
| 16 | 16,491 | 82,868 | 320 | 52 | ~3.1 | Sand |
| 17 | 18,504 | 99,359 | 345 | 54 | ~3.2 | Sand |
| 18 | 20,627 | 117,863 | 371 | 56 | ~3.3 | Sand |
| 19 | 22,859 | 138,490 | 397 | 58 | ~3.4 | Sand (boss ~here) |
| 20 | 25,199 | 161,349 | 423 | 60 | ~2.5 | Sand→Ash handoff |
| 21 | 27,646 | 186,548 | 450 | 61 | ~2.6 | Ash |
| 22 | 30,201 | 214,194 | 476 | 63 | ~2.7 | Ash |
| 23 | 32,863 | 244,395 | 504 | 65 | ~2.8 | Ash |
| 24 | 35,630 | 277,258 | 531 | 67 | ~2.9 | Ash |
| 25 | 38,504 | 312,888 | 559 | 69 | ~2.9 | Ash |
| 26 | 41,483 | 351,392 | 587 | 71 | ~3.0 | Ash |
| 27 | 44,567 | 392,875 | 615 | 72 | ~3.1 | Ash |
| 28 | 47,755 | 437,442 | 644 | 74 | ~3.2 | Ash |
| 29 | 51,048 | 485,197 | 673 | 76 | ~3.2 | Ash (boss at 30) |
| 30 | — cap — | 536,245 | 702 | — | — | Finale |

**Pacing check against genre targets:** first ding < 1 min (hook, arithmetic in §2.1), every level thereafter 2–4 min (D3's 1.3–1.6 min/level was for a 70-level warmup; 2–4 fits a 30-level arc where levels matter). Pure kill-time to cap ≈ 84 min; with boss attempts, exploration, deaths, and objectives the core arc lands at **~2.5–4 hours ≈ 5–8 portal sessions of 20–40 min** — inside the 6–10 session research target. No level exceeds ~4 min (L9's ~4.1 is the peak, right before the Cold boss): nothing on the core arc is grind; the grind lives in §9 where it belongs (D3/D4 lesson: never make the core arc pay the retention tax).

The sawtooth at L10 and L20 (min/level drops at realm entry) is intentional: new realm = richer packs = a visible XP surge on arrival. Rewards walking through the door. The smaller dip at L4 is the same effect one octave down — the early-Cold → full-Cold pack-size step (2.2 → 3.3 med-equivalents) as The Hunt / Glacier Line packs come online.

---

## 3. Kill XP — Formula, Tiers, Con Colors

### 3.1 Base kill value

```
BaseKillXP(L) = round(10 × L^1.25)
KillXP = BaseKillXP(min(enemyLevel, playerLevel)) × tierMult × conMult × streakMult × restedMult
Per-kill cap (standard): max(12.5% of XP_to_next at player level, BaseKillXP(playerLevel))
```

**The min() base (why above-level enemies pay YOUR base):** enemies at or below your level pay their own level's base (with the §3.3 taper). Enemies *above* your level pay `BaseKillXP(playerLevel) × conMult` — the con bonus is a bonus on your own-level pay, never a multiplier on the bigger enemy's larger base. This is what makes rushing time-neutral instead of a farm strategy; the math is carried in §3.3.

**The cap (EQ's 1/8 rule, with a floor):** the 12.5% term prevents any single non-first-kill grant from skipping meaningful fractions of a level. The `max()` floor guarantees an even-con medium kill is **never** capped — the same downward-exception logic as the §2.1 L1 override. The floor only binds at L1 (12.5% of 50 = 6.25 < 10); from L2 up the percentage term dominates (39.6 > 24) and behaves exactly as the bare EQ rule. Scope: the cap applies to **every kill resolved through the formula (kills only — objective, training-dummy and boss first-kill grants are §3.5 income, outside this cap), including boss and miniboss repeat kills** (§3.2). The first-kill flat boss grants are the only exemption — they are percentage-defined and bounded below a level by construction.

**Deviation from research, argued:** the leveling research recommended WoW's linear `5L+45`. WoW's linear works because *quests carry the majority of XP*; Driftwake's income is kill-dominant (~70%). Pure linear kill XP against an L^1.9 cost curve balloons late levels to 25+ packs each. Exponent 1.25 (between WoW's linear and EQ's quadratic `mobLevel²`) holds packs-per-level in a ≈4–7.5 band across the arc (realm-entry levels dip to ~4.1 by design; L1's 1.6 is the onboarding override) — per-level *time* still stretches (bigger packs take longer to clear), which is the actual goal of the classic linear/polynomial combo.

### 3.2 Tier multipliers — one table serves two systems

Tier multipliers are the combat doc's **difficulty-budget costs divided by 3** (medium = 1.0). The encounter director's pack-budget table and the XP table are literally the same data — they can never drift apart:

| Tier | Budget cost (combat doc) | tierMult | XP at L10 | XP at L20 |
|---|---:|---:|---:|---:|
| Fodder (imps) | 1 | 1/3 | 59 | 141 |
| Light | 2 | 2/3 | 119 | 282 |
| Medium / caster | 3 | 1.0 | 178 | 423 |
| Heavy | 5 | 5/3 | 297 | 705 |
| Elite | 8 | 8/3 | 475 | 1,128 |
| Miniboss | — | **first kill only:** flat **20% of XP_to_next** (player level) · repeats: tierMult 8/3 via the normal formula | 1,350 | 5,040 |
| Realm boss | 25–40 | **first kill only:** flat **35% of XP_to_next** (player level) · repeats: tierMult 10 via the normal formula | 2,363 | 8,820 |

**Boss XP rules, stated fully (kills the lowbie-farm loop):**

- The flat 20% / 35% grants fire **once per boss, on the first kill only**, tracked in `bossesKilled` (already a P1.2 save field). A boss kill is always a huge, visible chunk — but never skips a level (EQ per-kill-cap lesson), and never fires twice.
- The flat grants are **exempt from the per-kill cap** (they are the only exemption — percentage-defined, bounded by construction).
- **Repeat kills** (respawns, revenge trips) route through the **normal §3.1 formula** — min()-based BaseKillXP × tierMult (miniboss 8/3, realm boss 10, i.e. budget cost ÷ 3) × conMult × streak × rested — **and the standard per-kill cap applies**. So an L25 player re-killing the L10 Cold boss pays 178 × 10 × 0.05 (gray) ≈ 89 XP ≈ 0.2% of a level: exactly the "gray XP" §5.4 promises, trivial by design. Five gray boss kills is ~1% of a level, not a level.
- Shrine boon picks (§8.3) are gated on the same `bossesKilled` first-kill flags — re-kills never mint extra picks.

### 3.3 Con colors and level-difference multiplier — the UI never lies

`diff = enemyLevel − playerLevel`. The color and the multiplier are **one table** (WoW palette, D2 floor). The UI reads the same function the XP grant does — the color can never lie:

| diff | Con color | XP conMult | Read as |
|---|---|---:|---|
| ≥ +5 | **Skull-red** | ×1.50 | Flee or earn it. Warning, not a wall — no hit-chance penalties; the 1.10^N HP wall (§5) is the deterrent |
| +3 to +4 | **Orange** | ×1.25 | Stretch goal |
| +1 to +2 | **Yellow** | ×1.00 | The intended fight |
| 0 to −3 | **White** | ×1.00 | Fair fight, full pay |
| −4 | **Green** | ×0.75 | Outgrowing it |
| −5 | **Green** | ×0.50 | " |
| −6 | **Green** | ×0.25 | " |
| ≤ −7 | **Gray** | ×0.05 | Trivial. **5% floor, never 0** (D2's floor beats WoW's zero: a kill never feels literally worthless, but farming is dead) |

For positive diff, the multiplier applies to the **player-level base** per §3.1's min() rule; for zero/negative diff the enemy's own base and the taper are the same thing (enemyLevel ≤ playerLevel).

Note (deviation from the scaling-research sketch, argued): its bands had green start at −3 while the taper started at −4, so a green enemy could pay full XP — a color/multiplier mismatch. White is widened to 0..−3 so every color maps to exactly one multiplier row, honoring that same research's own "tie the multiplier directly to the color" principle. Five working colors plus skull — EQ's proven limit.

**Gray meshes with the bands by design** (§6): Cold bandMax = 10 → full Cold XP through player L13, taper 14–16, gray at 17 — precisely when the Sand band (8–20) is mid-arc. The XP engine itself herds the player forward; no fence needed.

**Anti-boost — rush economics, math carried:** conMult caps at ×1.5 regardless of diff (D2's ±5 band spirit), and the §3.1 min() base makes the rate honest. Worst case, a player L5 farming pinned L10 Sand-floor mobs: pay = BaseKillXP(5) × 1.5 = 75 × 1.5 ≈ 113 XP per medium; TTK ≈ 1.10^5 ≈ 1.61× the even-con kill time → ≈ 70 XP per even-con-kill-time versus 75 at even con — **×0.93, slightly sub-neutral**. At +3 orange (L5 vs L8): 75 × 1.25 ≈ 94 XP over 1.33× TTK → ≈ 71 — ×0.94. (Under the naive `BaseKillXP(enemyLevel) × conMult` form, that same rush paid ≈ ×1.87 the even-con rate after the cap — an optimal-farm exploit. The min() base is the fix; the ×1.5 cap alone was never enough.) Rushing therefore pays a big, visible per-kill headline but never beats even-con XP/hour. The actual deterrents, stated honestly: the 1.10^N HP wall's time cost, the lethality of under-leveled fights (§5.2), and this mildly sub-neutral rate — danger pay, not a farm.

### 3.4 Session and momentum multipliers

- **Kill streak (tamed D3 Massacre):** +3% XP per kill starting at the 5th consecutive kill, chain window 4 s, cap **×1.5 at 15+ kills**. D3's 4.5× is tuned for its zoom; ×1.5 rewards playing fast and risky without making streaking mandatory. Window expiry resets; taking damage does not (portal audience).
- **Rested (WoW analog for a session game):** while away, bank 50% of XP_to_next per 8 h offline, capped at **150% of the current level**. While the bank has charge, all kill XP is ×2 and drains the bank 1:1. Persisted as `restedBank` + `lastSeenTs` in the P1.2 save blob (accrual computed on load from the timestamp delta). Rewards *coming back*, not binging — the single best retention mechanic in the research set.
- **Co-op (forward-compat; ships only if Driftwake goes multiplayer):** +50% total XP per extra player (D2's proven number), split proportional to member level (WoW's split rule).

Multiplier stacking order: `Base × tier × con × streak × rested`, then the §3.1 per-kill cap.

### 3.5 Objective XP (the non-kill 30%)

| Event | XP grant (of XP_to_next at player level) |
|---|---:|
| Shrine first activation | 12% |
| Objective step complete ("Reach the Shrine of X", "Break the gate") | 15% |
| Miniboss kill | 20% — first kill only (§3.2) |
| Realm boss kill | 35% — first kill only (§3.2) |
| Training dummy first-blood (tutorial, once) | 20 XP flat |

Percent-of-current-level grants (WoW quest-lump lesson) mean objectives stay meaningful at every level and backtracking to old shrines never pays a stale flat number.

---

## 4. The Ding — What a Level Grants

On level-up, all at once, no modal:

| Grant | Value | Rationale |
|---|---|---|
| **Full heal + full mana refill** | 100% | WoW's "ding heal" — free-feeling reward that doubles as a mid-combat comeback mechanic |
| **+9% spell damage** | compounding | See growth model below |
| **+7% max HP** | compounding | Locked to enemy dmg growth (+7%, §5.2) → even-con hits cost a **constant % of your bar forever** — the combat doc's damage fractions (assassin ≈ 28% of pool) hold at every level, not just at the anchor |
| **+5% max mana, +3% mana regen** | compounding | Slight sustain gain per level; casting uptime creeps up with mastery |
| **Unlock check** | per §7 schedule | Spells L2/4/6; augments 9/12/15/20/25 |
| **Presentation** | XP bar flash, level numeral tick, audio note (audio.js), "+LEVEL" floater | No modal, no pause — momentum game |

**Player growth model vs enemy growth (the D4 patch-1.1.0 lesson, without the overshoot):**

| Per level | Player | Enemy (even con) |
|---|---:|---:|
| Damage | +9% stats, ~+1.6% amortized boons (§8.3 — **pick-invariant**: both options in every boon pair are DPS-equal, so this channel holds for any pick path), ~+1% kit augments ≈ **+11.5–12% effective** | HP +10% |
| Survivability | HP +7% | Damage +7% |

Even-con TTK drifts **down ~1.5–2% per level** — the player visibly outgrows content inside a band (anti-Oblivion, anti-ESO), but slowly enough that trivialization coincides with the realm exit (bandMax + gray taper), never before (D4's overshoot capped mobs 5 under and made the world boring). Anchor values: at L10 both columns equal the combat doc verbatim. Player snapshots: L1 = 54 HP, ×0.46 damage; L20 = 197 HP, ×2.37; L30 = 387 HP, ×5.60.

---

## 5. Enemy Scaling — Band-Limited, Player-Tracking

Enemies scale WITH the player inside each realm until the player outgrows the band. The realm, not the player's level, decides what can spawn and what it wears (Oblivion lesson: enemy *type and gear* belong to the zone).

### 5.1 Level assignment

```
Regular spawn:   enemyLevel = clamp(playerLevel + offset, bandMin, bandMax)
                 offset per spawn: −1 (25%) | 0 (50%) | +1 (25%)
Elite spawn:     enemyLevel = clamp(playerLevel + 2, bandMin, bandMax + 2)
                 — the ONLY mobs allowed above bandMax, by at most 2
Miniboss/event:  enemyLevel = clamp(playerLevel + 2, bandMin + 2, bandMax)
                 — tracks the player mid-realm, never exceeds the capstone
Realm boss:      FIXED at bandMax. Never scales. (§5.4)
```

The −1/0/+1 spawn variance keeps a realm from feeling uniformly mirror-matched (the specific Oblivion complaint); a pack reads as a small ecology, not a level-check.

- **Realm entry danger comes from bandMin:** rush Sand at L5 → the floor makes everything L8+ (orange/skull con). Rush Ash at L12 → L18s (+6, skull). Danger is earned, the game never blocks the door.
- **Realm exit reward comes from bandMax:** a L15 player returning to Cold fights L10s and stomps them. Never downscale the player (GW2's mistake for this genre) — stomping your old realm at 20 *is* the §8.3 power-fantasy payoff.

### 5.2 Stat growth per enemy level

```
HP(L)  = HP_doc  × 1.10^(L − 10)      (+10% compounding, anchored L10 = combat doc row)
DMG(L) = DMG_doc × 1.07^(L − 10)      (+7% compounding, same anchor)
```

| Enemy L | HP mult | DMG mult | Where you meet it |
|---:|---:|---:|---|
| 1 | ×0.42 | ×0.54 | Cold entry |
| 5 | ×0.62 | ×0.71 | Cold mid |
| 8 | ×0.83 | ×0.87 | Cold late / Sand floor |
| **10** | **×1.00** | **×1.00** | **Anchor — combat doc verbatim (Cold bandMax, Cold boss)** |
| 14 | ×1.46 | ×1.31 | Sand mid |
| 18 | ×2.14 | ×1.72 | Sand late / Ash floor |
| 20 | ×2.59 | ×1.97 | Sand bandMax, Sand boss |
| 24 | ×3.80 | ×2.58 | Ash mid |
| 30 | ×6.73 | ×3.87 | Ash bandMax, final boss |

Damage grows slower than HP **deliberately**, and the resulting claim is scoped precisely: for **within-realm rushes** — the bandMin floors actually reachable in normal play, diff ≤ +6 — under-leveled fights feel long-and-tense rather than one-shot-lethal. Worked edge: L12 entering Ash meets L18s; the assassin opener 26–30 × 1.72 ≈ 45–52 against a 114 HP pool ≈ 40–45% of the bar — brutal, survivable, readable. **Cross-realm skips are lethal by design:** an L1 walking into Ash meets L18 skulls whose brute slam 22–28 × 1.72 ≈ 38–48 against a 54 HP pool (70–90% per hit) and whose assassin opener lands ≈ 83–96% — functionally one-shot. The door never blocks (open-world philosophy), the con reads skull honestly, and lethality *is* the fence; we do not pretend the tension claim extends there. Over-leveled players still notice trivialization first through incoming chip damage vanishing — the correct order for a momentum game.

### 5.3 Invariants this produces (tuning contracts — do not break)

1. **Even-con hit severity is constant:** enemy dmg +7% = player HP +7%. The combat doc's "assassin opener ≈ 28% of pool" is true at L3, L10, and L28.
2. **Even-con TTK drifts down ~1.5–2%/level** (player ~+11.5–12% effective vs enemy HP +10%). Growth is felt inside a band, trivialization arrives at the exit. The boon channel's contribution is pick-invariant (§8.3) — this invariant holds for every player, not just damage-boon pickers.
3. **Bolt hit-counts stay exact:** the combat doc's no-crit ±10% variance exists so "X bolts kills it" lessons hold. Nothing in this doc adds crit or randomized enemy HP. (This is also why difficulty settings, §8.2, never touch enemy HP.)

### 5.4 Boss rules — hybrid (fixed capstones, banded minibosses)

- **Realm capstone bosses are FIXED:** Cold boss L10, Sand boss L20, Ash boss L30. A fixed summit makes the pre-boss grind meaningful and the kill a real gate — WoW exempts end-of-expansion raids from scaling for exactly this reason; Oblivion's scaled everything is the counterexample. Boss stat multiplier per the combat doc's boss row: **8–12× HP, ~1.5× damage** of a regular enemy of its level.
- **Minibosses band** per §5.1 — mid-realm challenge that tracks the player but never upstages the capstone.
- Under-leveled boss attempts are legal (L8 vs the L10 Cold boss = orange, hard, fair). Over-leveled revenge trips are legal: the first kill's flat grant is already spent (§3.2), so repeats pay through the normal formula at gray con (~89 XP for an L25 vs the Cold boss — trivial, matching the gray promise) but **full drops**.

### 5.5 Over/under-level behavior summary

| Situation | What happens |
|---|---|
| Player above band (revisiting) | Enemies pin at bandMax; XP tapers to 5% gray floor per §3.3; boss re-kills pay formula XP, not flat grants (§3.2); **drops/materials/motes never taper** (GW2 lesson — old realms stay worth visiting; faster TTK is itself the reward, never a penalty) |
| Player below band (rushing) | Enemies pin at bandMin; con reads orange/skull honestly; XP pays the player-level base up to ×1.5 — sub-neutral XP/hour (§3.3); no artificial miss chance — the HP wall and lethality are the deterrents |
| Inside band | Enemies track player ±1 (elites +2); TTK drifts gently down as you level |

---

## 6. Realm Band Table

| Realm | bandMin | bandMax | Capstone boss (fixed) | Expected entry | Full XP until | Gray at | Handoff window |
|---|---:|---:|---:|---|---:|---:|---|
| **Cold** | 1 | 10 | L10 | L1 | player L13 | L17 | 8–10 overlaps Sand |
| **Sand** | 8 | 20 | L20 | L9–11 (post-Cold boss) | player L23 | L27 | 18–20 overlaps Ash |
| **Ash** | 18 | 30 | L30 | L19–21 | never (cap 30) | never | — finale |

The 2–3 level overlaps (8–10, 18–20) are WoW's zone-band overlap made explicit: a player finishing Cold at ~10 meets Sand mobs at ~10 (white con, smooth handoff); a rusher meets the bandMin floor (orange/skull, earned danger). Realm gates = capstone boss kill activates the portal shrine (§8.4); cleared realms stay open forever.

---

## 7. Spell Unlock Schedule

Unlock **just-before-the-teacher**: each spell arrives immediately before the combat doc's enemy that requires it, preserving the Cold-realm curriculum instead of handing the kit up front (current bug: spellbar.js grants all five from frame one).

| Level | Unlock | Teacher it precedes (combat doc) |
|---:|---|---|
| 1 | **Bolt (LMB) + Wave** | Damage + space — enough for imps and sprites |
| 2 | **Mini-Vortex** | First Frost Stalker pack ("The Hunt") |
| 4 | **Spikes** | First Glacier Brute / Hail Guard ("Glacier Line") |
| 6 | **Great Vortex** | First big mixed pack; Sand's flagship bandit doctrine |
| 9 | Augment: Bolt (e.g. pierce +1 target) | Sand caster lines |
| 12 | Augment: Wave (wider arc) | Sand bandit doctrine density |
| 15 | Augment: Spikes (−2 s cooldown) | Sand elite packs |
| 20 | Augment: Mini-Vortex (chill +1 stack cap) | Ash entry |
| 25 | Augment: Great Vortex (radius +20%) | Ash elite doctrine, pre-finale |

Locked slots render dimmed with a level tag (add `.locked` to the existing spellbar CSS state classes); gate enforced in SpellSystem dispatch — one array lookup. Augments are flat kit improvements (~+5% effective each), counted in the §4 growth model. Boons (§8.3) are separate and boss-gated.

---

## 8. Death, Difficulty, Boons, Travel

### 8.1 Death & respawn (closes gap #1)

- **hp ≤ 0** → 1.5 s slow-fade knockdown → respawn at last activated shrine with full HP/mana, **2 s i-frame grace**.
- **The spawn shrine auto-activates on new-game start** — `lastShrineId` defaults to the Cold spawn shrine and is never null. A player who dies to the first pack (or the training dummies' neighbors) before touching any shrine, and the first-load restore path, both have a defined target from frame one.
- **No XP or currency loss.** Portal arcade audience; the cost is the surf back plus pack reset. (The D2/Elden Ring 5%-loss-with-recovery hybrid from the leveling research was considered and rejected for this audience — logged as a revisit knob in §12.)
- Ambient packs the player died to reset via the existing leash full-heal rule. Arena/boss fights restart at the arena entrance, boss full.
- Shrine network: one per ~2–3 packs of surf line + one at each arena gate; activation by touch trigger; the combat doc's spawn-shrine training dummies live at the first one.
- Death streak mercy: 3 deaths to the same arena → offer the §8.2 difficulty drop (offer, never auto-apply).

### 8.2 Difficulty settings (closes gap #12)

Three presets in the existing FFG shell settings panel. Scale **only** enemy damage and tokens — **never enemy HP** (§5.3 invariant 3: HP scaling silently breaks every TTK table and "X bolts" lesson in the combat doc):

| Preset | Enemy damage | Attack tokens |
|---|---:|---|
| Drift | ×0.6 | 2+2 everywhere |
| Wake (default) | ×1.0 | Combat doc values |
| Undertow | ×1.3 | +1 melee token |

Stored in the save blob; changeable anytime outside boss arenas. Must ship **before** tuning playtests so testers play the intended rung.

### 8.3 Shrine boons — the entire reward economy (closes gap #13, argued)

Currency, vendors, inventory, and loot tables are **cut — deliberately and permanently for this game**. A momentum ARPG where speed is the armor cannot afford stop-and-menu inventory screens, and a loot economy is L-tier effort fighting the game's identity. The reward channels are:

1. **Health motes** (combat doc, already specced): +10% max HP; fodder 35% / elite 100% drop.
2. **Shrine boons:** the **first kill** of each miniboss/realm boss (gated on the same `bossesKilled` flags as the §3.2 flat XP — re-kills never mint extra picks) grants one **pick-of-two** fixed, named boon at the shrine — one screen, no inventory. Six picks across the game, curated per realm. **Pairing rule (load-bearing for the §4 growth model): both options in every pair are priced to equal effective DPS, ±2%, in the combat doc §1.2 rotation model** — utility effects are converted at their measured uptime value, so the ~+1.6%/level amortized damage channel (≈ ×1.08 per boon) holds for *any* pick path and invariant §5.3.2 survives every build. Examples, priced: Cold — "+8% frost damage" vs "Chill stacks to 6" (deeper slow + longer Brittle uptime ≈ +8% effective); Sand — "Spikes cooldown −2 s" (more stun/Brittle windows ≈ +8% effective) vs "Wave knockback +30% and Wave damage +8%"; Ash — "+8% damage vs chilled" vs "Great Vortex radius +15%" (pack contact uptime ≈ +8% effective). The six boons supply the combat doc §8.3's "+15% player damage per realm" with designer-controlled balance. The pair-pricing sheet is a P3.3 deliverable; P4.4 validates the measured parity.
3. **Faster TTK in outgrown content** — the explicit over-leveling reward (§5.5).

Boon respec: free at any shrine (Hades lesson — near-free respec means players experiment instead of reading wikis). Revisit loot only if portal analytics prove retention demands a chase layer.

### 8.4 Realm travel (closes gap #11)

Gate = realm capstone kill activates the portal shrine (the combat doc already frames Dune Warden as "the realm-gatekeeper" and Moraine Elder as "the realm exam"). Free backtracking forever — never lock a cleared realm. Realms implement as **parameter sets** over the existing terrain/sky/heightfield systems (palette, heightfield seed/character, fog, roster table, band row from §6) — not three handcrafted maps. Ship Cold complete first; Sand/Ash ride the same code as data.

---

## 9. Post-Cap — Driftmarks (retention tail)

At L30 the core arc is *done*; retention grind lives here and only here (D3/D4 Paragon lesson: split the curve, never tax the core arc).

- Overflow XP converts to **Driftmarks**: `cost(n) = round(20,000 × 1.05^(n−1))`, cap **100** (finite, portal-appropriate — not D3's uncapped treadmill). Total ≈ 52 M XP ≈ a long-tail multiple of the 536 k core arc.
- Each Driftmark grants a pick: +0.5% damage, +0.5% max HP, or +0.3% surf speed (speed capped at +10% total — movement feel is sacred).
- Driftmark XP still obeys con/gray rules and the boss first-kill rules — the tail is earned in Ash, not farmed in Cold.
- UI: the XP bar recolors at cap; numeral shows `30 · Mk n`.

---

## 10. Integration with the Combat Doc

### 10.1 What anchors where (the contract, restated operationally)

- **Enemy stat blocks = enemy level 10.** Implementation stores the doc's rows verbatim as `stats_L10` and derives everything: `HP = row.hp × 1.10^(L−10)`, `DMG = row.dmg × 1.07^(L−10)`. One table, one formula, no per-level hand data.
- **Player spell damage and 100 HP pool = player level 10.** Stored as `player_L10`; derived by §4 growth. At L10 the game *is* the combat doc.
- **Level-invariant sections** (telegraphs, tokens, FSM, leash, alarm, pack compositions, budget costs, wave shapes, spawn stagger, boss phase scripts): consumed unchanged at all levels. Behavior never scales.
- **Sand/Ash rosters:** the combat doc's Sand/Ash archetype rows (behaviors, budget costs) stand; their *absolute HP/damage columns* are now **generated** from Cold-equivalent L10 values × the §5.2 formula at the fight's actual level. The doc's archetype design is the source of truth; this doc is the source of truth for magnitudes.

### 10.2 Errata to combat doc §8.3 (flagged per fix-the-generator rule)

The combat doc's coarse realm multipliers — HP ×1.3/×1.7, damage ×1.25/×1.5, "+15% player damage per realm" — were placeholders written before this progression layer existed. They are **superseded**:

- Under the per-level model, Sand mid (L14) is effectively ×1.46 HP / ×1.31 dmg and Ash mid (L24) ×3.80 / ×2.58 versus the anchor — but the player has grown in step, so the *felt* difficulty at each realm's midpoint matches the doc's intent: even-con hits cost the same % of the bar as the doc's Cold tables (invariant §5.3.1), and even-con TTK at Sand mid is ~0.93× the doc's anchor value, drifting down (invariant §5.3.2). Realm danger now comes from bandMin entry, new archetypes, and doctrine density — not stat bloat.
- The "+15% player damage per realm" is preserved verbatim as the boon channel (§8.3 here, six boons ≈ +15–16%/realm compounded, pick-invariant by the pairing rule).
- **Action item:** patch combat doc §8.3 to reference this doc, and regenerate its Sand/Ash absolute-number examples from the §5.2 formula (do not hand-edit individual rows).

### 10.3 Shared data tables (single source, two consumers)

| Table | Consumed by combat doc systems | Consumed by this doc's systems |
|---|---|---|
| Difficulty-budget costs | Pack budget / encounter director | XP tier multipliers (÷3), boss repeat tierMults |
| Realm band rows (§6) | Spawn director realm config | Con colors, gray taper, gating |
| `stats_L10` enemy rows | Everything | HP/DMG derivation |
| Boon list (+ pair-pricing sheet) | Damage tuning assumptions | Shrine reward UI |

---

## 11. Gap Register → Prioritized Build Plan

Every gap from the audit, sequenced. Effort: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 1–2+ weeks. Phases are strict gates: a phase's acceptance criteria must be *observed* (not "code merged") before the next begins.

### Phase P0 — Foundations & the perf gate (nothing enemy-shaped is written before this passes)

| # | Item | Effort | Spec |
|---|---|---|---|
| P0.1 | **Perf budget for skinned enemies** | L | Render 8 armored training dummies with full skinned rigs at the spawn shrine; measure on the medium preset on Iris Xe. Budget levers in order: (1) shared skeleton + clip library across the roster (Meshy smart-topology retarget keeps bone names identical — one clip set, N instances); (2) fodder/imps as baked VAT (run/attack/die, ~3 clips) instead of live mixers; (3) anim LOD — full rate <20 m, half 20–40 m, frozen off-frustum; (4) enemies shadow-cast in cascade 0 only, fodder never; (5) existing DPR/shadow-res preset floors. Alive cap 8 is a design bound; 30 archetypes = asset variety, never concurrency. **Acceptance: 8 dummies + active spells ≥ 30 fps, medium preset, Iris Xe.** A miss here forces alive-cap cuts that invalidate the combat doc's pack tables — measure first. |
| P0.2 | **Death/respawn + shrine network** | M | Per §8.1, including spawn-shrine auto-activation on new game. Wire hp≤0 in controller, death camera + fade in main.js frame(), shrine touch-trigger activation. Enemy damage can then actually be applied to the 100 HP pool — every TTK number becomes testable. |
| P0.3 | **Target assist** | S | Soft target, no lock-on (lock-on breaks the surf-shooter fantasy): nearest alive enemy within ~3° of crosshair ray, ≤40 m, sticky 0.5 s. Widen the existing 0.6 m bolt tip snap to 1.0 m *against the current target only*. One allocation-free cone test per frame. Upstream of chill pips + target frame. |

### Phase P1 — Progression core (this doc becomes real)

| # | Item | Effort | Spec |
|---|---|---|---|
| P1.1 | **XP + levels + ding** | M | §2–§4 formulas (min() con base, capped-with-floor per-kill rule, first-kill boss flags). HUD: slim XP bar directly above the spellbar, full spellbar width, bottom-center (top-left = health/mana, bottom-left = minimap; bottom-center is the free conventional seam). Level numeral on the left cap; ding = bar flash + audio note + "+LEVEL" floater. |
| P1.2 | **Persistence Tier 1** | M | Versioned localStorage blob `{schemaVer, level, xp, driftmarks, spellsUnlocked, boons, realmsUnlocked, bossesKilled, lastShrineId, restedBank, lastSeenTs, objectiveState, difficulty, settings}`. Field notes: `restedBank` + `lastSeenTs` serve §3.4 rested accrual (P4.3 reads/writes them; the fields ship in schema v1 so P4.3 never forks the blob); `objectiveState` = per-realm chain node index for P3.1 (same rule); `bossesKilled` gates §3.2 flat XP and §8.3 boon picks; `lastShrineId` defaults to the Cold spawn shrine on new game (§8.1 — never null). Written on shrine touch, boss kill, level-up, 30 s interval. Restore at lastShrine, never exact position (no save-inside-hazard). |
| P1.3 | **Spell gating** | S | §7 schedule; `.locked` slot state + level tag; SpellSystem dispatch gate. Must land before Cold encounter placement. |
| P1.4 | **Difficulty presets** | S | §8.2. Before any tuning playtest. |

### Phase P2 — The enemy substrate (largest build in the stack)

| # | Item | Effort | Spec |
|---|---|---|---|
| P2.1 | **Encounter director + combat FSM** | L | Exactly the combat doc §9 architecture: CombatSystem SoA (prealloc 16, alive cap 8), enemies.update before spells.update / enemies.postCombat after (frame-order slots per main.js:577–631), analytic hit volumes, dt===0 no-op. Director on top: pack spawner reading the shared data tables (§10.3), token broker (2+2/3+3), leash anchors (40 m/25 m/arena), alarm broadcast with 0.2–0.6 s stagger, §5.1 level assignment. Ship the combat doc's Phase 1 slice first (Rime Imp + Hoarfrost Sprite + Frost Stalker + tokens + FSM), validate token feel, then widen — Sand/Ash *regular* rosters are data rows on this code, not new systems (bosses are not data rows: see P2.4). |
| P2.2 | **Floaters + enemy health bars** | M | Pooled sprite floaters (prealloc 32, Brittle-tinted, world-to-screen, throttled) including mandatory "RESIST/IMMUNE" (combat doc §5.3: silent DR feels like cheating). Bars tiered: fodder/light = floaters + hit flash only; heavy/elite = slim overhead bars; current target = compact top-center frame with name, hp, chill pips, **con-color border (§3.3)**; bosses = bottom bar + stance sub-meter. hud.js dirty-flag DOM pattern, zero canvas allocation. Minimap enemy pips through the existing ping()/blips seam in the same pass. |
| P2.3 | **Combat audio** | M | Extend audio.js's polling architecture (polls SNOWFLOW.combat edges, no callbacks): hit-confirm tick (pitch by damage tier), kill note, player-hurt grunt, low-HP heartbeat <30%, telegraph stingers (shared "incoming" + per-archetype layer, ≥300 ms before any off-screen attack — combat doc §1.4 hard fairness rule), directional pan for the off-screen arc, alarm horns, stance-break/boss-phase/level-up notes. All synthesized in the existing graph/voices framework. **Not polish — the fairness contract for assassins and off-screen attackers ships inside this.** |
| P2.4 | **Cold miniboss + capstone boss (Shrinebreaker + Moraine Elder)** | L | The boss layer is NOT a data row on P2.1 — it is its own build: combat doc §8.1–8.2 verbatim (28 m shrine-ring arena with core-gated structure and add cadence; 34 m cirque with six pillar-stun economy, three phases, anti-camp mortar), fixed/banded levels per §5.4, stance meters, phase-transition invulnerability beats, arena-as-leash rule. Consumes P2.2's boss bar + stance sub-meter and P2.3's phase/stance audio notes. First-kill XP/boon flags per §3.2/§8.3 land here against `bossesKilled`. **Gated by P2.1 (and P2.2/P2.3 for presentation); gates P3.1 ("Defeat the Warden" steps), P3.2 (portal gate = capstone kill), and P3.3 (boon grants fire on boss kills).** The four Sand/Ash bosses (Gatekeeper, Dune Warden, Furnace Guardian, Plate Knight) reuse this boss framework and are budgeted inside P3.2's content effort as per-boss phase scripts + arenas. |

### Phase P3 — Structure & content

| # | Item | Effort | Spec |
|---|---|---|---|
| P3.1 | **Objective spine** | M | One fixed chain per realm: Reach the Shrine of X → Break the gate (miniboss) → Defeat the Warden (realm boss) → Enter the next realm. One HUD objective line (top-right, the only free corner) + gold minimap marker on the blips seam + optional world-space beacon column. ~6-node state machine per realm off boss-kill/trigger events, persisted in the save blob's `objectiveState` field (in schema v1 per P1.2 — no migration needed). Grants §3.5 objective XP. |
| P3.2 | **Realm gating + Sand/Ash** | L | §8.4: portal shrine on capstone kill; realms as parameter sets over existing terrain/sky systems; §6 band rows; free backtracking. Gating logic is S — the content (two palette/heightfield/roster variants **plus the four Sand/Ash bosses on the P2.4 framework**) is the L. |
| P3.3 | **Shrine boons** | S–M | §8.3: pick-of-two at shrine after each **first** miniboss/boss kill (`bossesKilled`-gated — re-kills mint nothing), six per playthrough, free respec at shrines. Deliverable includes the **pair-pricing sheet** proving both options in each pair sit within ±2% effective DPS in the combat doc §1.2 rotation model (P4.4 validates the measured parity). ~2 days versus a loot economy. |

### Phase P4 — Retention & sync

| # | Item | Effort | Spec |
|---|---|---|---|
| P4.1 | **Persistence Tier 2 (cloud)** | M | Mirror the save blob to the FFG registry (service-key path already exists for games/achievements writes). localStorage = source of truth offline; registry syncs on load/checkpoint, last-write-wins on timestamp. Portal achievements (realm clears, boss kills) nearly free. |
| P4.2 | **Driftmarks** | S | §9. |
| P4.3 | **Rested + streak XP** | S | §3.4, reading/writing the `restedBank` + `lastSeenTs` fields that P1.2 already ships (no schema fork). Streak counter shares the floater pool. |
| P4.4 | **Tuning playtest pass** | M | Validate the §2.2 minutes-per-level column against the stated pack-size schedule (the column is now derivable — that schedule IS the acceptance baseline), the §5.3 invariants, the §3.3 rush-rate sub-neutrality, and the §8.3 boon-pair DPS parity against real play on Wake difficulty; adjust the 85 coefficient, pack cadence, and pack-size assumptions — never the invariants. |

Dependency spine: P0.1 gates P2.1 (perf before AI). P0.2 gates all combat tuning. P1.1+P1.2 gate P3.1/P3.3 (objectives and boons need XP and saves). P2.1 gates P2.2/P2.3/P2.4 content hookup; **P2.4 gates P3.1, P3.2, and P3.3** (all three consume boss kills). Cut line for a first portal-playable: end of P2 — **including P2.4, since the Cold arc without its bosses has no gate, no boons, and no exam** — with Cold only.

---

## 12. Tuning Knobs & Revisit Register

Deliberate decisions with their revisit triggers — labeled, never silently dropped:

| Decision | Revisit if |
|---|---|
| XP coefficient 85 / exponent 1.9 | P4.4 playtest shows min/level off the §2.2 column by >50% |
| Kill exponent 1.25 | Packs-per-level drifts outside 4–8 in play |
| min(enemyLevel, playerLevel) con base (§3.1/§3.3) | Playtest shows rush XP/hour exceeding even-con (target ≈ ×0.93–0.95, never >1.0) |
| Boon pair DPS parity ±2% (§8.3) | P4.4 rotation measurement shows a pair diverging — reprice the utility option, never delete the damage channel |
| No death XP penalty | Portal analytics show deaths feel weightless (then: 5% of XP-to-next, 75% corpse-recoverable — D2/ER hybrid, pre-argued) |
| No loot/currency/inventory | Retention analytics prove a chase layer is needed |
| Streak cap ×1.5 | Streaking feels mandatory (lower) or invisible (raise cap, never past ×2) |
| Enemy +10%/+7% per level | §5.3 invariants break in playtest — fix player growth first, these second |
| Co-op +50%/player | Ships only with a multiplayer mode |

The invariants in §5.3, the anchor contract in §1, and the first-kill-only boss rule in §3.2 are **not** knobs. Everything else is.