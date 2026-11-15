# DRIFTWAKE — Combat Design Document

**Version 2.0 — Lead Combat Design (post-director-review revision)**
**Scope:** Full combat spec — player frost kit, 30-enemy roster across three realms (Cold / Sand / Ash), archetype AI, aggro & pacing systems, 6 bosses, tuning tables, and implementation architecture mapped to the shipping engine (`sweep.js`, `ribbon.js`, `bloom.js`, `crystallize.js`, `vortex.js`, `spellSystem.js`, `main.js`, `controller.js`).
**Governing companion:** DRIFTWAKE — PROGRESSION & SCALING DESIGN. Its §1 Anchor Contract governs all numbers here: **every stat block in this document is a level-10 snapshot.** In play, `HP = row × 1.10^(L−10)` and `DMG = row × 1.07^(L−10)`, with enemy level set by realm band (Cold 1–10, Sand 8–20, Ash 18–30; progression doc §5–§6). Behavior — telegraphs, tokens, ranges, speeds, poise, pack compositions — is level-invariant. This doc's old §8.3 realm multipliers are superseded (see §8.3).

---

## 0. Design Pillars & Key Mapping

### Pillars

1. **Speed is the player's armor.** Verified against `controller.js` this revision: SURF_MAX = 19.5 m/s is a hard clamp, and **flat ground sustains it** — SURF_THRUST (11.0 m/s²) exceeds quadratic drag at the clamp (0.42·s²·0.02 + 0.9 ≈ 4.1 m/s² at 19.5), so only uphill grades steep enough that `slopeAssist` scrubs ≳7 m/s² (≈15°+) pull the player below top speed. All intercept and kiting math in this doc therefore uses **19.5 m/s flat-ground sustained**, not a downslope-only burst. No enemy sustains that speed. Combat is tuned so *standing still is dangerous, moving is strong, and moving well is mastery* — enemies punish backpedaling (gap-closers) and face-tanking (proximity melee override), and **casting at full carve speed trades damage** (Bolt speed-falloff, §1.1) so kiting is a skill with a cost, never a free win (§4.3).
2. **Enemies are NOT easy.** Assassins open at 3× damage from stealth. Mages cast real projectiles with real patterns. Brutes are damage walls that ignore half the kit. Fairness comes from telegraphs (≥500 ms readable warning, everywhere, no exceptions — see Scorpion Husk, §2.2 #18), not from soft numbers.
3. **Every spell has a job.** Bolt = damage. Wave = space. Mini-vortex = reveal/deny. Spikes = the stun key. Large vortex = pack answer. Every enemy special is a lock for exactly one of these keys.
4. **Packs, pick-offs, and kiting are all first-class.** Attack tokens keep packs readable; long-sight sentinels make pick-off order a puzzle; leash + gap-closer + submerged-pursuit composition makes kiting a skill, not a cheese.

### Owner keys → engine spells

The owner brief and the engine use different key numbers. **This doc uses the owner's binds.** The input layer remaps; no engine spell code changes identity. Unlock order per progression doc §7: Bolt + Wave at L1, Mini-Vortex L2, Spikes L4, Great Vortex L6.

| Owner bind | Fantasy | Engine spell (current key) | Cast delay (STRIKE_DELAY) |
|---|---|---|---|
| **LMB** | Frost Bolt — single-target projectile | Ribbon **thrown phase** (key 2) | none — fires on release; tap = auto-release after 0.15 s wind |
| **1** | Frost Wave — frontal cone + knockback | Sweep (key 1) | 0.71 s |
| **2** | Mini-Vortex — targeted AOE | Bloom (key 3) | 0.66 s |
| **3** | Crystal Spikes — stun + damage | Crystallize (key 4) | 0.95 s |
| **4** | Great Vortex — lift & directional fling | Vortex (key 5) | 0.98 s |

Ribbon's *held-whip* phase remains on hold-LMB as a melee-range channel (light tick damage, see §1.1); a tap quick-casts the throw. All damage keys off `trigger()`/burst events per the engine contract — **never** off `input.spellPressed`.

---

## 1. Player Kit

All player values are **player-level-10 snapshots** (progression doc §1); player HP pool = 100 at L10.

### 1.1 Spells

All ranges/volumes below are the **engine's real volumes** (quoted from code), not invented. Damage is on a scale where player HP = 100 and fodder HP ≈ 24–35.

#### LMB — Frost Bolt (Ribbon throw)

| Property | Value |
|---|---|
| Damage | **12** per hit (±10% variance max) |
| **Speed falloff (anti-kite tax)** | While the player's horizontal speed exceeds **12 m/s** at release: damage **12 → 7** and **no Chill stack applied** (aim wobble at carve speed). Full damage restores 0.4 s after dropping below 12 m/s. Kiting DPS at full surf ≈ **15.6** vs 26.7 planted. HUD: crosshair blooms wide above 12 m/s so the state is readable. |
| Hit volume | Segment-vs-sphere per 1/60 s substep (SUB_DT, SUB_MAX=12); projectile speed 21 m/s (THROW_SPEED); tip snap within 0.6 m of crosshair point |
| Range | 40 m aim leash, 18 m fallback (`aimPoint(..., 40, 18)`) |
| Fire cycle | 0.45 s (tap: 0.15 s wind + recover) → **26.7 DPS** single-target sustained (planted) |
| Mana | **0** — Bolt is the resource-neutral filler (DOOM ethos: pressure is always available) |
| CC | None. Applies **1 Chill stack** (max 5, not applied above 12 m/s): −6% enemy move speed per stack, 3 s refresh. At 5 stacks: **Brittle** — +20% damage taken for 4 s |
| On-hit splash | `_splash()` micro-AoE 0.6–1.2 m — 4 splash damage to adjacent targets only |
| Held-whip mode (hold LMB) | Capsule chain, 46 samples × 0.20 m step, tube radius 0.205 m; 6 damage/tick at 4 ticks/s to touched enemies + 1 m nudge. Panic tool, not a DPS mode. |

#### 1 — Frost Wave (Sweep)

| Property | Value |
|---|---|
| Damage | **20** at arc center, bell-tapered to 0 at the horns (matches `bell(u)` curve); ×env |
| Hit volume | Traveling crescent: circle center at `origin + dir*(reach−5.5)`, CURVE radius 5.5 m, crest thickness ±0.7 m, half-angle 0.52→0.96 rad; born 1.1 m ahead of feet, total reach **13.6 m** over LIFE 2.4 s; leading edge 11.5·e^(−1.15t)+1.2 m/s. Hits enemies whose base is below crest height (PEAK 2.15 m × env). One hit per enemy per cast (hit latch). |
| CC | **Knockback 4 m** (fodder full; medium 70%; heavy 30%; brute/boss 0 — see CC table **§5.2**) + 0.4 s stagger |
| Mana | 15 |
| Cooldown | 4 s |
| Aim | Flattened to ground plane at press (engine rule) |
| Jobs | Scatter imp rings, strip Blizzard Assassin's Whiteout Cloak, delay Glass Revenant regrowth (+2 s), quench Volcanic Knight's fresh cracks (3 s slow) |

#### 2 — Mini-Vortex (Bloom)

| Property | Value |
|---|---|
| Damage | **35** at epicenter → linear falloff to **18** at rim (100% inside inner 40% of radius) |
| Hit volume | One-shot sphere r **2.0 m** at the aimed terrain point, fired in the existing burst block (`t ≥ 0.10`); lingering column: tube r 0.66 m × 5.6 m tall for 1.75 s — **8 DPS** contact |
| Range | Eye-ray terrain point, **22 m cap / 13 m fallback** (engine rule) |
| CC | 0.7 s stagger + 40% slow 1.5 s. **Reveal:** forces submerged/stealthed units out — Powder Dive, Ash-swimming, Sand Shroud, Dune Dive mounds are ripped out **stunned 1.5 s**; covers Mirage Step / Glimmer Blink radii |
| Mana | 25 |
| Cooldown | 6 s |
| Jobs | The anti-stealth / anti-blink key. Collapses the Dune Warden's Sand Ward dome. The counter to submerged pursuit (§4.3). |

#### 3 — Crystal Spikes (Crystallize)

| Property | Value |
|---|---|
| Damage | **30** one-shot per enemy caught by the expanding disc (r 0.18→2.23 m over PLANT_TIME 0.85 s; per-prism test as each of 34 prisms plants — the outward wave is free from planting order) |
| Range | Same eye-ray as Bloom: **22 m cap / 13 m fallback** |
| CC | **Stun 1.5 s** (the kit's only hard stun; DR & tier scaling per **§5.2–5.3**). Deals **60 poise damage** — the stance-break tool |
| Persistent hazard | Prisms stand **34–42 s** (STAND 34 + rand·8): enemies pathing through take 25% slow and 4 damage/prism shattered; flung enemies impacting crystals take +15 and 1 s stun. Hazard collision lives in `crystals.js` (spell object deactivates at t > 2.45 s) |
| Mana | 30 |
| Cooldown | 10 s |
| Jobs | Opens every brute (Anchored Mass, Hailstone Bulwark, Slag Brute); cracks Rime Carapace at 3× rate; interrupts Smoke-step and Rime Ritual; freezes Pack-Ice Golem for core shots |

#### 4 — Great Vortex (Vortex)

| Property | Value |
|---|---|
| Damage | **15 DPS** ×env inside the ring (per-enemy tick accumulator, mirrors the 45 Hz `_strip` throttle) ≈ 55 total over a full hold; **+20 fling impact** on release |
| Hit volume | Player-centred cylinder, follows the player every frame; damage radius = `this.ring` (0.9→**3.1 m** while held, retreat 2.2 m/s on fade); height 4.8 m × env; duration 0.55 ramp + 3.0 hold + 1.1 fade = **4.65 s** |
| CC | **Lift (launch)** — fodder/light enemies caught are airborne inside the column (fully disabled); on release or fade, lifted enemies are **flung 8–12 m along the player's aim direction**. Wall/crystal impact: +15 damage, 1 s stun. Heavy tier: 50% slow only. Brute/boss: immune to lift (engine-canon: "too heavy to fling") |
| Mana | 45 |
| Cooldown | 14 s |
| Jobs | The pack-delete button; a mobile shredder while surfing (cylinder follows the player through a pack); throws imps into Crystal Spike walls |

### 1.2 DPS math & rotation

| Source | Per use | Amortized DPS (single target) |
|---|---|---|
| Frost Bolt (planted) | 12 / 0.45 s | 26.7 |
| Frost Bolt (>12 m/s) | 7 / 0.45 s | 15.6 |
| Wave (cd 4) | 20 | 5.0 |
| Mini-Vortex (cd 6) | 35 (+column) | 5.8–8.0 |
| Spikes (cd 10) | 30 | 3.0 |
| Great Vortex (cd 14) | ~75 total | 5.4 |

- **Tuning DPS (mid-progression, movement-realistic): 35.** All TTK tables (§8.1) use this.
- **Burst combo ("the opener") — order and timing corrected this revision:** **Spikes → Mini-Vortex → 3 Bolts.** Timeline: Spikes cast 0.95 s, stun (1.5 s) starts at impact → Mini-Vortex cast begins immediately, lands ~0.7 s into the stun (35) → 3 Bolts (1.35 s), the first two landing inside the stun/slow window. Total **~101 damage in ~3.0 s**, cost 55 mana. Because the Mini-Vortex and the first bolts connect *while the target is stunned*, on-hit escape tools (Glimmer Blink, Mirage Step — which trigger on hit or proximity while un-stunned) never fire: the combo genuinely deletes light targets and halves a medium. The old Spikes→Bolts→Vortex order let the stun expire before the vortex landed; do not ship that order.
- **Brittle window:** 5 Chill stacks → +20% damage taken: sustained anti-elite loop is Bolt×5 → Spikes → Bolt spam ≈ 42 effective DPS (planted).

### 1.3 Mana

- **Pool 100.** Regen **6/s standing; 18/s while surfing ≥10 m/s** ("speed feeds the storm" — now load-bearing, not flavor).
- **Sustain math (corrected this revision):** full-rotation drain on cooldown = 15/4 + 25/6 + 30/10 + 45/14 ≈ **14.3 mana/s**. At 18/s surfing regen the full kit is sustainable **only while moving fast**; a planted caster running the full rotation starves the 100 pool in ~12 s (100 / (14.3−6)) and must drop to Bolt-plus-one-key. The tradeoff is therefore *mobility vs. rotation*, not a fictional "pick two keys" loadout choice — the previous claim is deleted. The 115-mana full-dump vs 100 pool still forces sequencing inside any single burst window.
- Casts can silently fail on strand starvation (engine: sweep/bolt/bloom take 1 water strand, vortex takes 3, pool of 8). **HUD grays the key icon when strands can't cover the cast**; mana is NOT spent when `trigger()` fails to activate (damage and cost both gate on `active`).

### 1.4 Player health & defense

- **HP 100** (player L10 anchor). Regen 10/s after 6 s without taking damage. Arena/boss fights: no passive regen; kills drop health motes (**+10% max HP** — progression doc anchor: exactly +10 at L10; fodder 35% chance, elite 100%).
- **No block, no dodge-roll.** Defense = movement (5.4 run / 19.5 surf), jump (apex 0.63 m; surf-ollie apex 1.14 m clears ground rings and low sweeps), terrain, and the wave/vortex space-makers.
- **Knockdown i-frames:** 0.75 s on getup (per AAA canon).
- **Enemy CC on the player is token-limited:** max **1 hard CC (knockdown/root/reel) per 6 s across the whole encounter** — no chain-stuns, ever. **Ruling (this revision): enemy and boss attacks consume the token; environmental hazards bypass it** — with two guards: (a) every environmental hard CC is telegraphed by a ≥1.2 s ground decal, and (b) **juggle guard**: no environmental hard CC may land within 2 s after any token CC, and environmental hard CCs are themselves capped at 1 per 4 s. So Dune Warden P3 geysers (§7.4) launch honestly on their marked decals — they are a real routing threat, not decorative — but geyser + khopesh-slam juggles are impossible by rule.
- **Off-screen protection:** any attack committed from outside the camera frustum draws a directional edge-arc indicator + audio stinger ≥300 ms before impact (GoW-2018 lesson).
- **Chill/slows on the player** (assassin needles, Sun Venom, Hamstring) cap at −40% total and never stack past that.

---

## 2. Enemy Roster — 30 Units

### 2.0 Reading the tables — anchor & tier baselines

**Every number below is a FINAL enemy-level-10 snapshot** (progression doc §1 Anchor Contract). No realm multiplier is ever applied on top of these rows — the old "Sand ×1.3 / Ash ×1.7 baked in" language is deleted. In play: `HP = row × 1.10^(L−10)`, `DMG = row × 1.07^(L−10)`, enemy level from the realm band (Cold 1–10, Sand 8–20, Ash 18–30; progression doc §5.1–§6). Realm difficulty comes from **band level, new archetypes, and doctrine density** — not stat bloat. Speed, perception, telegraphs, poise, and ranges are level-invariant.

**Tier baselines (L10)** — the bands every roster row must sit inside; archetype variation *within* a band is deliberate flavor (Cinder Imp 34 vs Rime Imp 24 = a meaner imp at anchor, not a realm multiplier artifact):

| Tier | L10 HP band | L10 per-hit damage band | Budget cost (§6.1) |
|---|---|---|---|
| Fodder (imps; sprites HP-wise) | 24–40 | 3–9 | 1 (sprites budget as casters: 3 — cost keys to pressure, §6.1) |
| Light (stalkers, casters, raiders, assassins) | 40–75 | 4–18 (stealth openers 26–30; fully-channeled nukes to 22, interruptible ≥1.2 s red channels only — Dust Mage glass lance) | 2 (ambusher 3, assassin 4) |
| Medium (scouts, bandits) | 80–110 | 6–14 | 3 |
| Heavy (guards, wardens, automaton, cinder sentinel) | 260–480 | 12–28 | 5 (automaton & sentinels cost 8 — cost keys to encounter pressure, not HP) |
| Elite (brutes, colossus, dune sentinel) | 380–680 | 14–30 | 8 (brutes cost 5 — slow single-threat) |
| Boss (arena variants, §2.4/§7) | 760–3000 | per §7 | 25–40 |

Telegraph = windup ms of the listed primary attacks, **floor 500 ms everywhere**; **red-cue** marks unblockable/must-move attacks (unique color flash 250 ms before commit). Speed = sustained m/s (burst in parens). Poise pools per **§5.1**; CC interactions per **§5.2**.

**Sentinel perception cap (this revision): no enemy perception exceeds 35 m** — 5 m inside Bolt's 40 m aim leash, so "snipe from outside its sight" is always physically possible. The pick-off puzzle is the 5 m margin and the alarm cancel window, not an impossible range.

### 2.1 Cold Realm (Realm 1 — the teaching realm)

| # | Name | Role | HP | Speed m/s | Perc. m | Atk range m | Damage | Telegraph ms | Poise | Signature |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Rime Imp** | swarm-melee | 24 | 6.2 | 25 | 1.2 (pounce 4) | rake 4×3, pounce 8 (+15% slow 1.5 s), spit 3 | 500 / 650 / 600 | 10 | **Pack Call**: first spotter shrieks, aggros all imps in 30 m; +15% atk speed per nearby imp (cap 3) |
| 2 | **Glacier Brute** | tank | 520 (+260 carapace) | 3.2 (enrage 4.0) | 18 | 2.5 (ram 8) | slam 22 (4 m ring), sweep 16 + launch, ram 18 | 1200 / 900 / 1000 red | 120, hyper-armor | **Rime Carapace**: 260 over-health; while up, immune to wave KB & vortex fling; Spikes crack it at 3×. Shatter → flingable but +25% speed |
| 3 | **Frost Stalker** | ambusher / **pursuer** | 50 | 7.0 (**submerged 13**) | 15 | pounce 8 | pounce 18, rake 7×2, backflip 9 | 700 / 550 / 500 | 20 | **Powder Dive**: submerged wake-ripple, bolt-immune; **pursues submerged at 13 m/s, up to 60 m from the pack** — Cold's anti-kite answer (§4.3). Erupts when the player drops below 10 m/s or closes within 8 m. Mini-Vortex on the wake rips her out stunned 1.5 s |
| 4 | **Hoarfrost Sprite** | ranged-caster | 28 | 4.5 | 30 | cast 25 | bolt 5×3 (12 m/s, light homing), shard nova 9 | 600 / 500 | 10 | **Glimmer Blink**: 6 m teleport (chime tell) when aimed at >1 s or approached <5 m; 4 s cd — bait blink, land Mini-Vortex. Death: 2 m slow-field |
| 5 | **Moraine Colossus** | elite | 640 | 3.0 | 22 | 3 (charge 20) | haymaker 26, stomp 18 + pop-up, crush 22 | 1300 / 1000 red / 1100 | 150, hyper-armor | **Avalanche Charge**: 20 m telegraphed line (1500 ms red); steered into rock/ice = 4 s stun — the only fling window. *Field variant; boss variant "Moraine Elder" §7.2 (see §2.4)* |
| 6 | **Rimebound Cultist** | ranged-caster | 55 | 4.6 | 30 | cast 30 | rune bolt 8×2 (16 m/s), glyph snare 14 + root 1.5 s, lash 10 | 700 / decal 1200 / 500 | 25 | **Rime Ritual**: channel shields allies in 15 m (−50% frost dmg taken); kill or Spike-stun mid-channel → shield shatters, all tethered allies stagger 0.7 s. Priority-target puzzle |
| 7 | **Blizzard Assassin** | assassin | 48 | 8.0 (dash 16) | 12 | dash 10, needles 14 | dash slash 16, needles 4×3 + Chill, execution 8×4 = 32 | seam-flicker 500 / 550 / 600 | 15 | **Whiteout Cloak**: near-invisible while circling; cyan seams flicker 0.5 s pre-strike. Wave strips cloak; never cloaks while Chilled |
| 8 | **Glass Revenant** | skirmisher / scout | 45 (+ core 20) | 6.4 | **35** | 1.5 (lance 4) | slash 8×2, shard lance 14, prism flurry 6×4 | 500 / 800 / 700 | 20 | **Refreeze**: on death leaves heart-core, body regrows in 4 s unless core destroyed; wave scatters shards (+2 s). **Living alarm**: pings all enemies in 40 m on spot (broadcast radius, not perception) |
| 9 | **Pack-Ice Golem** | tank / golem | 5 cores × 60 (body invulnerable; field variant — see §2.4) | 2.0 | 16 | punch 3, pound 5 m ring | piston 20, pound 16 + launch, swat 14 | 900 / 1300 / 1000 | construct — no flinch | **Crystal Cores**: bolts deflect off plate; only the 5 crystals damage. Knee → −50% speed; shoulder → arm attacks lost; crown → kill. Spike-stun = aiming window. *Boss variant "Shrinebreaker" §7.1* |
| 10 | **Hail Plate Guard** | warden / tank | 300 | 3.0 | **30** | 1.8 (check 4) | hook 18 + stagger, check 12, hail stomp 14 (3 m ring) | 800 / 700 / 1100 | 100 | **Hailstone Bulwark**: planted stance — immune to KB AND fling; frontal bolts **ricochet as hail chips (3 dmg to player <4 m)**. Breaks from behind or Spike-stun. Chokepoint sentinel |

### 2.2 Sand Realm (Realm 2)

| # | Name | Role | HP | Speed m/s | Perc. m | Atk range m | Damage | Telegraph ms | Poise | Signature |
|---|---|---|---|---|---|---|---|---|---|---|
| 11 | **Dune Imp** | swarm-melee | 30 | 6.2 | 18 | 1.2 (pounce 4) | rake 5×2, pounce 9, grit fling (1 s aim-blur), pack bite +25% w/ 3+ latched | 500 / 650 / 550 | 10 | **Dune Dive**: pack submerges, travels as mounds, resurfaces *surrounding* the player. Wave/Vortex scatters the ring |
| 12 | **Dune Brute** | tank | 680 | 2.2 | 22 | 2.5 (charge 12) | slam 26 (3 m ring), sweep 20, bulldoze 24, grab-hurl 28 | 1300 / 1000 / 1500 red / 900 | 140, hyper-armor | **Anchored Mass**: fully immune to wave KB and vortex fling; Spike-stun is the ONLY opener (visor weak window ×2 dmg, 2.5 s). *Field variant; boss variant "Gatekeeper of Brass" §7.3 (see §2.4)* |
| 13 | **Dust Stalker** | ambusher / **pursuer** | 55 | 7.8 (**submerged 13**) | 12 | pounce 8 | opener 26 (~3×), flurry 6×3, hamstring 10 + 2 s surf-slow | 600 / 500 / 550 | 15 | **Sand Shroud**: dust-ripple stalking; **pursues submerged at 13 m/s, up to 60 m from the pack** — Sand's anti-kite answer (§4.3); goggle-immune to blinds and the player's snow spray while surfing. Mini-Vortex on the ripple rips him out stunned 1.5 s |
| 14 | **Dust Mage** | mage | 60 | 4.6 | 32 | cast 28 | grit bolt 9 (14 m/s), sandblast 12 + KB, dust devil 4/s chase 6 s, glass lance 22 (30 m/s) | 700 / 550 / 800 / channel 1500 red, interruptible | 25 | **Mirage Step**: on hit, blinks 8 m leaving a crumbling clone; 6 s cd — Mini-Vortex covers the blink radius; sustained pressure wins |
| 15 | **Scour Scout** | skirmisher | 95 | 6.5 | 20 | 1.5 (knife 12) | slash 8×2, grit-knife 7, slide kick 10 (ducks under Wave) | 550 / 600 / 700 | 35 | **Wind Sprint**: lateral sand-skating bursts break bolt tracking — lead shots or commit Spikes. Hunts in pairs, one flanking wide. Forearm plate parries 1 bolt/engagement |
| 16 | **Dune Sentinel** | elite | 380 | 3.2 | **35** | halberd 3.5 | sweep 18, chop 30, stomp quake 14 (4 m, interrupts casts) | 900 / 1400 red / 1000 | 110 | **Watchman's Horn**: longest sand sightline (**35 m** from crests — 5 m inside Bolt's 40 m leash); horn pulls every imp/bandit in 30 m. Kill him first, from 36–40 m — the pick-off lesson |
| 17 | **Dune Warden** | **boss** | 2400 (boss, §7.4) | 4.8 | 35 | khopesh 2.5, sand arc 18 | see §7.4 | see §7.4 | stance 220 | **Sand Ward** dome + **Decree** troop command |
| 18 | **Scorpion Husk** | ambusher | 50 | 6.8 | **10** | sting 2 | sting 12 + **Sun Venom** (3/s × 5 s, −25% surf), claws 6×2, grapple-sting 16 (break with Wave) | **persistent buried tell <15 m** + 500 crack-cue / 500 / 700 | 15 | **Buried Ambush (revised to honor the 500 ms floor):** buried and untargetable, but **inside 15 m a persistent tell is visible** — a thin sand-trickle plume + heat-shimmer patch over the burial spot (audio: dry chitin tick). On the 10 m trigger: **500 ms ground-crack cue, then eruption** — total readable warning ≥500 ms with prior visibility, per Pillar 2 and §3.2 rule 3. Venom makes fleeing wrong and Spike-stun right |
| 19 | **Hourglass Automaton** | elite / golem | 420 | 2.8 | 30 | punch 3 | piston 20, gyre flail 12/rev (walking 360), sand jet 8 cone, grind grab 18 (break with Wave) | 800 / 1200 / 700 / 900 | 120, construct | **Reassembly**: at 0 HP collapses to a churning sand pile, rebuilds in 4 s at 50% HP — **bolting the pile freezes it solid: permanent kill.** Signature frost-kit showcase |
| 20 | **Windscour Bandit** | skirmisher | 90 | 5.0 | 26 | scimitar 1.8, grit 10 | slash 9×2, grit blind 1.5 s, boot shove 6 + KB, flank rush +30% dmg from off-camera | 600 / 550 / 500 | 30 | **Pack Doctrine**: never alone — 3–5 strong, one always circling off-camera, one blinding frontally. Great Vortex is the designed wipe |

### 2.3 Ash Realm (Realm 3 — the mastery realm)

| # | Name | Role | HP | Speed m/s | Perc. m | Atk range m | Damage | Telegraph ms | Poise | Signature |
|---|---|---|---|---|---|---|---|---|---|---|
| 21 | **Cinder Imp** | swarm-melee | 34 | 6.2 | 16 | 1.0 (lunge 3.5) | rake 5×2, lunge 8, frenzy bite DoT 2/s (3+ latched) | 500 / 600 | 10 | **Ash-drift pop**: sleeps buried, erupts in packs of 3–6; death cinder puff stings 3 dmg at point-blank — kill at range with Wave/Vortex |
| 22 | **Slag Brute** | tank | 560 | 2.2 | 22 | 2.5 (charge 8) | slam 28 (3 m stagger ring), backhand 22 + hard KB, slag charge 26 | 1300 / 900 / 1200 red | 140, hyper-armor | **Too heavy to fling**: immune to wave KB; Great Vortex only slows 50%. Charge into rock/**Spike wall** = 1.5 s self-stagger; Spike-stun = the damage window |
| 23 | **Scorch Raider** | skirmisher / **pursuer** | 75 | 6.6 (**toboggan 17**) | 30 | blades 1.5, coal knife 12 | combo 7×3 (side-stepping), ember flick 8 + burn 1/s×3, cutting lunge 14 (punishes cast commits) | 550 / 600 / 650 | 25 | **Slope-chaser**: pursues at near-surf speed (bracers-toboggan, 17 m/s downslope), flanking both sides — forces cast-on-the-move. Ash's anti-kite answer (§4.3) |
| 24 | **Smoke Mage** | mage | 65 | 3.4 | 35 | cast 35 | smolder bolt 12 (8 m/s weaving homing — break LoS or detonate with Wave), ash pall 5/s ×6 s (8 m cloud, hides allies), ember lash 14 | 800 / lob decal 1200 / 550 | 20 | **Smoke-step**: at <8 m or on heavy hit, re-forms 12–15 m away (2 s cd, max ×2). Spike-stun interrupts the step: stun → burst |
| 25 | **Cinder Sentinel** | elite-role sentinel (heavy HP band) | 260 | 4.8 | **35** | halberd 4 | sweep 16, advancing thrust 20 (beats backpedal — side-dodge), crest bash 12 (interrupts casts <3 m) | 900 / 800 / 600 | 90 | **Beacon crest**: 3 s visible ignition pings all ash enemies in 40 m (broadcast, not perception); kill or Spike-stun during ignition cancels the call. Fixed patrol routes — the stealth/route-planning enemy. Snipe window: 36–40 m |
| 26 | **Soot Assassin** | assassin | 40 | 8.5 (dash 17) | 12 | dash 8 | **backstab 30 (3×)**, flurry 6×4, soot slip (dodges next projectile) | shimmer 500 / 550 | 12 | **Soot veil**: heat-shimmer-only visibility while stationary/walking; waits for the player's cast/carve commit. Any Wave/Vortex clipping the shimmer strips veil 6 s. Dies to 4 bolts once caught |
| 27 | **Soot Stalker** | ambusher | 70 | 7.0 (submerged 13) | 20 | eruption 0 (point-blank) | eruption pounce 18 + knocks off surf line, hooked rake 8×2 + **Shredded** (+15% dmg taken 4 s) | mound-ripple tell + 550 / 500 | 18 | **Ash-swimming**: travels under the crust as a subtle moving mound; untargetable submerged except Mini-Vortex on the mound (out, stunned). Pairs alternate pounces from opposite sides |
| 28 | **Scorch Warden** | elite-role warden (heavy HP band) | 480 | 3.0 | 35 | mace 2.5, chain 14 | mace slam 26 (2 m splash), chain drag (reels 6 m — break with perpendicular dash), suppression stomp 16 (5 m, interrupts casts) | 1100 / 1000 red / 900 | 130 | **Warding rune field**: 12 m zone, player spell damage −30%, vortex durations halved. Bolts from OUTSIDE the ring hit full — range discipline. Guards camps/objectives |
| 29 | **Volcanic Plate Knight** | **boss** | 3000 (§7.6) | 1.8 | 35 | fists 3, lob 30 | see §7.6 | see §7.6 | stance 300 | **Progressive Fracture** 3-stage enrage; ground-scar arena |
| 30 | **Furnace Guardian** | **boss** | 2200 (§7.5) | 2.0 | 25 | piston 5, vent cone 8 | see §7.5 | see §7.5 | stance 260 | **Furnace core duel** — douse the grate |

### 2.4 Field vs boss variants (double-booking resolved this revision)

Three units exist in **two explicit variants**. Pack tables (§6.2) always use the field variant; boss sections (§7) own the boss stat lines; the TTK table (§8.1) cites both.

| Unit | Field variant (pack tables) | Boss variant (arena) |
|---|---|---|
| Pack-Ice Golem | 5 cores × 60 = **300** total, ambient tank | **Shrinebreaker** (§7.1): crown 200 + 2× shoulder 140 + 2× knee 140 = **760** total, escalation script, masonry mortar |
| Dune Brute | **680** HP tank | **Gatekeeper of Brass** (§7.3): **1500** HP, stance 220, 2 phases, slab throw |
| Moraine Colossus | **640** HP elite | **Moraine Elder** (§7.2): **2000** HP, stance 240, 3 phases, pillar economy, ice mortar |

---

## 3. Archetype AI Briefs

### 3.1 Imps / Swarm (Rime Imp, Dune Imp, Cinder Imp)

- Spawn buried; erupt in packs of **3–6** on trigger (Dune Dive mounds, Ash-drift, Pack Call).
- Movement: orbit at 4–8 m when not token-holding; attack via **melee tokens** only, except the <2 m proximity override.
- Surround logic: pack spreads to ≥60° angular separation around the player; resurfacing packs place 1 imp deliberately behind (with the mandatory spawn cue — 0.5 s mound/VFX + audio).
- Never more than 2 imps mid-attack simultaneously regardless of pack size.
- Chip damage philosophy: individually trivial (4–5/hit), lethal by attrition if ignored — the "clear them or drown" pressure that makes Wave and Great Vortex feel great.

### 3.2 Assassins & Ambushers (Blizzard Assassin, Soot Assassin, Frost/Dust/Soot Stalkers, Scorpion Husk)

**Ambush rules (hard constraints — this is where "hard but fair" lives):**

1. **Commit-window targeting:** stealth openers fire only while the player is mid-cast (STRIKE_DELAY windows), mid-carve at >10 m/s, or facing ≥90° away. Never while the player is idle and watching.
2. **One stealth striker at a time.** A second stealthed unit must wait for the first's recovery + 2 s. (Shares the melee token pool; stealth strike costs a token like any attack.)
3. **Tell before the hit:** every stealth opener has a ≥500 ms readable tell (seam flicker, shimmer, mound ripple, ground crack, wake ripple) + audio stinger — **including the Scorpion Husk**, whose buried state now shows a persistent trickle/shimmer tell inside 15 m plus a 500 ms crack-cue (§2.2 #18). Off-screen: directional indicator per §1.4.
4. **Opener cadence:** after an ambush cycle (opener + 1 combo), disengage to ≥20 m and re-stalk; minimum **6–10 s between stealth openers** per unit.
5. **Reveal states are honest:** once revealed (Wave strip, Mini-Vortex pull, Chill), the unit fights openly for the full reveal duration (6 s) — no instant re-cloak.
6. Opener damage 3× (26–30) is the "NOT easy" spike; HP is fragile (40–70) so the punish is equally decisive.
7. **Pursuit sub-role (this revision):** Frost Stalker and Dust Stalker double as their realm's designated pursuers — submerged travel 13 m/s, leash-extended to 60 m (§4.3). While pursuing they obey all ambush rules above; the eruption at the end of a pursuit is a stealth opener and pays its token.

### 3.3 Mages & Casters (Hoarfrost Sprite, Rimebound Cultist, Dust Mage, Smoke Mage)

- **Standoff band 10–15 m**; reposition-strafe every 2–4 s; lead shots by 0.3–0.5 s of player velocity at mid-range.
- **Projectile catalog (all ≥0.5 s visible flight at their engagement range):** frost-spark 12 m/s light-homing · rune bolt 16 m/s straight · grit bolt 14 m/s straight · smolder bolt 8 m/s weaving-homing (breaks on LoS or Wave detonation) · glass lance 30 m/s (only after a 1.5 s red-cue channel, interruptible by any hit).
- **Cast pattern:** poke (bolt string) → zone (snare/pall/devil decal, 1.2 s ground telegraph) → escape tool on pressure (Blink / Mirage / Smoke-step, all cooldown-gated 4–6 s so pressure eventually wins) → panic melee only when cornered.
- **Escape tools are counter-designed, one per spell:** Blink→Mini-Vortex covers radius; Mirage→Mini-Vortex; Smoke-step→Spike-stun interrupt. HUD does not show this — enemies teach it. Escape tools do not fire while stunned — this is what makes the §1.2 opener order work.
- Ranged tokens: max 2 casters firing at once; non-token casters visibly "charge" (weave hands) — readable as safe.

### 3.4 Brutes & Constructs (Glacier/Slag/Dune Brutes, Moraine Colossus, Pack-Ice Golem, Hourglass Automaton, Hail Plate Guard)

- **Poise:** 120–150 pools, hyper-armor during all windups (never flinch mid-attack). Constructs never flinch at all.
- **Armor grammar (each brute locks a different door, Spikes is always the key):**
  - Glacier Brute: over-health carapace → then vulnerable + enraged.
  - Dune Brute / Slag Brute / Hail Guard: CC-immunity (no KB, no fling) → Spike-stun windows.
  - Pack-Ice Golem: body-invulnerable, 5 crystal weak points.
  - Hourglass Automaton: death-denial (Reassembly) → freeze the pile.
- **Anti-kite:** every brute has exactly one mid-range answer (ram 8 m / bulldoze 12 m / avalanche 20 m), always red-cued at 1000–1500 ms, always exploitable (self-stagger or wall-stun on miss).
- Attack rate is low (1 attack per 3–4 s); threat is damage-per-hit (20–28) and space control, not tempo.

### 3.5 Sentinels & Wardens (Glass Revenant, Dune Sentinel, Hail Plate Guard, Cinder Sentinel, Scorch Warden)

- **They guard; they do not roam.** Fixed posts (Guard/Warden) or fixed patrol routes (Sentinel/Revenant); will not chase beyond **25 m from post** — they return, making them the terrain of the encounter, not the chase.
- **The alarm layer:** perception **30–35 m** (capped 5 m inside Bolt's 40 m leash by design — sniping from outside sight is always physically possible; the 36–40 m window is the skill test). They see the surfing player long before anything else does. Horn / Beacon / facet-ping pulls 30–40 m of allies (broadcast radius is independent of perception). Every alarm has a **cancel window** (kill or Spike-stun during the 3 s ignition/horn-raise).
- The intended macro-loop of open-realm play: *read the sentinel's route → decide: stealth past, snipe from the 36–40 m window, or Spike-cancel the alarm mid-blow.*
- Wardens add area-denial auras (rune field −30% spell dmg) that invert the usual range game: bolts from outside, or dive in and duel.

### 3.6 Skirmishers & Raiders (Scour Scout, Windscour Bandit, Scorch Raider)

- The "honest mid-tier": medium HP, medium damage, fight in 2–5s, built on angles — flank rushes, off-camera circling, lateral dashes that break bolt tracking.
- One anti-spell trick each: slide-kick under Wave (Scout), grit-blind (Bandit), cast-commit-punish lunge (Raider).
- Scorch Raiders are Ash's kiting tax: pursuit at near-surf speed (17 m/s downslope toboggan) — surfing away from an ash pack means casting on the move, not disengaging for free.

---

## 4. Aggro, Attack Tokens, Leash & Alerts

### 4.1 Perception FSM (per enemy)

- **Idle → Alert → Combat.** Sight cone **130°** horizontal, range = per-enemy `perception_m` (roster tables; **10–35 m**, hard-capped at 35). Proximity auto-detect **4 m** 360°. Hearing: sprint footsteps/surf carving 12 m, spell impacts 15 m.
- **Alert:** moves to investigate last stimulus, senses widened +20%, lasts **8–12 s** then returns to Idle.
- **Combat:** confirmed sight → broadcast alert pulse, allies within **12–15 m** join, staggered **0.2–0.6 s** per ally (never turn as one frame). Specials extend this radius: Pack Call 30 m, Watchman's Horn 30 m, Beacon crest 40 m, Revenant ping 40 m — all with cancel windows.
- Spawned-wave enemies (arena/boss adds) skip Idle → enter Combat directly. Ambient realm packs use the full FSM (this is what makes pick-offs and stealth routes real).

### 4.2 Attack tokens

- Shared per-encounter pool: **2 melee + 2 ranged tokens** (4 concurrent attackers max) regardless of alive count (cap 8). Ash realm late waves & bosses-with-adds: **3+3**.
- Token acquire → attack → hold through recovery (**attack duration + 0.75 s**) → release. Non-holders orbit/reposition at 4–8 m, posture, feint — never idle-stand.
- **Proximity override:** any enemy within **2 m** may melee token-free. Face-tanking a crowd is never safe.
- Stealth openers, alarm blows, and boss attacks all consume tokens (bosses hold a permanent virtual token; adds contend for the rest).

### 4.3 Leash, de-aggro & the kiting answer (rebuilt this revision)

- **Ambient packs:** leash anchor = spawn point, radius **40 m** for non-pursuers; **designated pursuers (Frost Stalker, Dust Stalker, Scorch Raider) leash-extend to 60 m.** Player outside a unit's leash radius **6 s** → disengage: sprint home at 1.5× speed, untargetable, full-heal on arrival (prevents leash-edge poke cheese). Guards/wardens use their tighter 25 m post rule.
- **Arenas & bosses: the arena IS the leash** — no reset logic (reset in bounded spaces is pointless and exploitable).
- **The infinite-kite hole is closed by three interlocking rules, and the math is stated against the verified 19.5 m/s flat-ground surf speed (§0):**
  1. **Bolt speed-falloff (§1.1):** above 12 m/s the free Bolt drops to 7 damage and applies no Chill — kiting DPS ≈ 15.6, a real cost, and the Brittle loop is unavailable on the move.
  2. **Submerged pursuit in every realm:** Cold = Frost Stalker, Sand = Dust Stalker (both 13 m/s submerged, bolt-immune while under, 60 m leash), Ash = Scorch Raider (17 m/s downslope). A player kiting at ≤12 m/s to keep full Bolt damage is slower than the 13 m/s pursuers and gets run down; a player at full 19.5 m/s outruns them but shoots at −42% damage and starves the Chill/Brittle engine. Either way kiting is a *tradeoff*, not a solved state. The pursuer's eruption obeys every §3.2 fairness rule; Mini-Vortex on the wake/ripple is the standing counter.
  3. **Orbit-poke is starved, not just discouraged:** the old exploit — orbit the 40 m leash anchor at 30–39 m and plink — now faces pursuers that follow to 60 m, ranged units inside every pack (composition rule, §6.2), and chasers at 5.7–6.2 m/s that force continuous movement (crossing 35 m in ~6 s), which drags the player into the falloff regime. Enemy projectiles (8–16 m/s) still cannot intercept a full-speed tangential surfer — by design; they punish the slow kiter, pursuers punish the fast one.
- Chasers run at 5.7–6.2 m/s (1.05–1.15× player run); nothing sustains surf speed in a straight line — escaping *the board* is always available, but killing from safety is not, and re-engaging is always required (objectives/gates sit inside guard perception).

---

## 5. Poise, Stagger & CC Budget

### 5.1 Reaction tiers & poise

Flinch → Stagger (0.5 s, interrupts) → Knockdown (1.5–2.5 s, getup i-frames) → Launch (vortex lift only).

| Tier | Poise pool | Regen | Notes |
|---|---|---|---|
| Fodder (imps, sprites; assassins share this poise band) | 10–20 | full after 4 s unhit | any bolt flinches; Wave knocks down |
| Light/Medium (stalkers, skirmishers, casters) | 15–35 | 5 s | Wave staggers; Spikes knock down |
| Heavy (guards, wardens, automatons) | 90–140 | 6 s | hyper-armor in windups; stance-break = 2 s vulnerability, ×1.5 dmg |
| Elite (colossus, sentinels) | 110–150 | 8 s | as heavy; stance-break 2.5 s |
| Boss | stance meter 220–300 | **Sekiro model (this revision): the meter drains at 20/s ONLY after 3 s without taking poise damage; any poise hit resets the idle timer; the meter freezes during transition invulnerability** | immune to hard CC; **filling the stance meter IS the CC** — 3–5 s break window, ×1.5–2 dmg, guaranteed-crit feel (no RNG crits in Driftwake; variance ±10%) |

Per-hit poise damage: Bolt 10 · Wave 25 · Mini-Vortex 30 · **Spikes 60** · Vortex 8/tick.

**Break cadence verification (the math the old 10%/s continuous drain failed):** sustained rotation poise output = Bolt 22.2/s + Wave 6.25/s + Mini-Vortex 5/s + Spikes 6/s ≈ **39.5/s** at perfect uptime, ~25/s realistic while dodging. Because the drain never ticks while Bolt cadence (0.45 s) keeps the idle timer at zero, a 220–300 meter fills in **~9–12 s of maintained pressure**; dropping pressure for >3 s bleeds 20/s. A 60–90 s phase therefore yields the promised **1–2 breaks per phase**, earned by sustained aggression rather than impossible arithmetic.

### 5.2 CC permission matrix (player CC vs enemy tier)

| CC | Fodder | Light/Med | Heavy | Elite | Boss |
|---|---|---|---|---|---|
| Spike stun (1.5 s) | 100% | 100% | **50% (0.75 s)** | 50% | immune → 60 stance dmg instead |
| Wave knockback (4 m) | 100% | 70% | 30% | 30% | 0 (stance dmg 25) |
| Vortex lift/fling | full lift + fling | full | 50% slow only | slow only | slow 25% only |
| Slow (Chill) | full | full | full | 70% | 50%, Brittle still applies |

**Per-enemy overrides win** (they're the teaching hooks): Rime Carapace/Anchored Mass/Hailstone Bulwark/Slag mass = KB & fling immune regardless of tier row; Moraine Colossus flingable ONLY during wall-stun; constructs never flinch.

### 5.3 Diminishing returns & the player-side CC token

- Per CC category, per target, rolling **15 s window**: 100% → 50% → 25% → **IMMUNE**, reset after window.
- DR state is **shown**: "RESIST"/"IMMUNE" floater on application (silent DR feels like cheating).
- Enemy CC on player: 1 hard CC per 6 s pack-wide token (§1.4). **Environment ruling (§1.4, restated): enemy/boss attacks consume the token; environmental hazards bypass it but are decal-telegraphed ≥1.2 s, capped at 1 hard CC per 4 s, and juggle-guarded — no environmental hard CC within 2 s of any token CC.** Knockdown getup i-frames 0.75 s.

---

## 6. Pack Composition & Encounter Pacing

### 6.1 Difficulty budget

Costs (shared table with progression doc §3.2 — XP tierMult = cost ÷ 3): **fodder 1 · light 2 · medium/caster 3 · ambusher 3 · assassin 4 · heavy (brutes, guards, wardens) 5 · elite (colossus, sentinels, automaton) 8 · boss 25–40 (arena-only)**. Ambusher and assassin costs are new this revision (they previously had no cost at all); their XP multipliers derive as ×1.0 and ×4/3 respectively. Cost keys to encounter pressure, not HP band — a 260 HP Cinder Sentinel costs 8 because its alarm warps the whole encounter; a 680 HP Dune Brute costs 5 because it is one slow threat.

Alive cap **8** (perf: 13–17 fps harness GPU + readability); attackers capped by tokens. Wave budgets grow 20–30% per wave; encounter = 2–4 waves; **breather 3–5 s minimum between waves**; wave clear target 30–90 s; full arena 2–4 min then a reward beat. Spawn stagger 0.5–2 s per unit, 3–5 s between sub-groups; new archetypes introduced solo or with familiar fodder only.

### 6.2 Realm pack tables (all rows recomputed against §6.1; composition rule: ≥1 gap-closer + ≥1 ranged in every pack)

**Cold** (budgets 6→14)

| Pack | Composition | Budget | Lesson |
|---|---|---|---|
| Imp Warren | 5× Rime Imp (5) + 1 Hoarfrost Sprite (3) | **8** | Wave scatters, Vortex deletes |
| The Hunt | 2× Frost Stalker (6) + 3× Rime Imp (3) | **9** | Mini-Vortex on wakes; first taste of submerged pursuit |
| Ritual Circle | 1 Rimebound Cultist (3) + 1 Hail Plate Guard (5) + 3 imps (3) | **11** | kill-order: cultist first, guard from behind |
| Glacier Line | 1 Glacier Brute (5) + 1 Cultist (3) + 2 Sprites (6) | **14** | Spikes crack carapace while dodging casters |
| Scout Screen | 1 Glass Revenant patrolling (ambient) | **2** | alarm management |
| Elite Hunt (late) | 1 Moraine Colossus (8) + 1 Blizzard Assassin (4) | **12** | wall-bait while watching your back |

**Sand** (budgets 8→17)

| Pack | Composition | Budget | Lesson |
|---|---|---|---|
| Bandit Doctrine | 4× Windscour Bandit (12) + 1 Dust Mage (3) | **15*** | off-camera flankers; Great Vortex wipe (*flagship pack, spawns staggered 2-then-3) |
| Mound Field | 5× Dune Imp (5) + 1 Scorpion Husk (3) | **8** | mounds vs buried-tell ambush — watch the ground |
| Watch Post | 1 Dune Sentinel (8) + 2 Scour Scouts (6) | **14** | snipe the horn from 36–40 m or Spike-cancel |
| Brass Wall | 1 Dune Brute (5) + 2 Bandits (6) + 1 Dust Mage (3) | **14** | anti-tank loop under pressure |
| Glass Patrol | 1 Hourglass Automaton (8) + 2 Dune Imps (2) | **10** | freeze-the-pile execute |

**Ash** (budgets 10→22)

| Pack | Composition | Budget | Lesson |
|---|---|---|---|
| Slope Chase | 3× Scorch Raider (6) + 1 Smoke Mage (3) | **9** (arrival ambient — deliberately below the realm floor, the handshake pack) | cast-on-the-move while pursued |
| Pall Trap | 1 Smoke Mage (3) + 2 Soot Stalkers (6) + 3 Cinder Imps (3) | **12** | the cloud hides the mounds — Mini-Vortex sweeps |
| Beacon Route | 1 Cinder Sentinel (8) + 2 Raiders (4) (patrol) | **12** | route-planning; cancel the crest |
| Jailer Camp | 1 Scorch Warden (5) + 1 Smoke Mage (3) + 4 Cinder Imps (4) | **12** | fight the aura: bolts from outside, or dive |
| Widowmaker (late) | 1 Soot Assassin (4) + 1 Slag Brute (5) + 1 Smoke Mage (3) | **12** | the full triad: tank holds space, mage zones, assassin punishes greed — threat-dense, not budget-dense |

### 6.3 Encounter shapes

- **Triangle** (normal rooms): each wave adds count/tier — e.g. Sand wave 1 (8) → wave 2 (11) → wave 3 (14).
- **Diamond** (climax rooms): fodder screen → fewer-tougher → single elite capstone (Moraine, Sentinel, Warden, Automaton).
- Ambient realm density: 1 pack per ~120 m of surf line, sentinel routes stitching them; picking off from range vs alarm cascade is the open-field game.

---

## 7. Bosses — 2 per Realm

Common structure (all six): HP-gated phases with 2–4 s transition invulnerability + signature beat; adds capped at 2–4 fodder (one stated exemption: Dune Warden P1's Decree wave IS his phase identity — 4 imps + 2 bandits, offset by the −40% boss attack rate), max 1 spawn cadence per phase, ≥25 s respawn, **boss attack rate −40% while adds live**; arena 25–40 m closed; **anti-camp ranged option — now real for all six** (Elder ice mortar, Warden sand arcs, Gatekeeper slab throw, Shrinebreaker masonry lob, Furnace slag spit, Plate Knight basalt lob); anti-hug AoE pulse; stance meter (Sekiro drain, §5.1) = the DPS-window generator on five of six bosses (3–5 s window, 1–2× per phase per the §5.1 cadence math; the Shrinebreaker is core-gated instead — §7.1, no meter); target length 3–5 min (Cold: 2.5–3). Boss attacks consume the player-CC token; arena hazards bypass it under the §1.4 juggle guard.

### 7.1 COLD MID-BOSS — **Pack-Ice Golem, "The Shrinebreaker"** (boss variant, §2.4 — the mechanics-check boss: raw DPS on the body does nothing)

- **Arena:** frozen shrine ring, 28 m, four ice pillars (cover from the *adds* — and from the mortar below).
- **Health (boss variant):** 5 cores — crown 200, shoulders 2×140, knees 2×140 = **760 total**. Body invulnerable, bolts visibly ricochet (teaches instantly). (Field variant is 5×60 = 300, §2.4.)
- **Structure (core-gated, not HP-gated):** any order works and changes the fight — knee break = −50% speed (kite freely), shoulder break = that arm's attacks removed. Crown is armored behind a head-guard posture until **either both shoulders are broken or a Spike hit lands on the head-guard** — the 60 stance damage staggers the guard POSTURE for 0.75 s (a guard-break window, not a stun: bosses remain hard-CC immune per §5.2; enough for 2 bolts on the crown).
- **Anti-camp (this revision — the missing mandatory ranged option):** **Shrine Masonry Lob** — if the player holds >15 m for 4 s, he tears a block from the shrine ring and mortars it: leads the target, 2 s flight, 5 m decal, 18 dmg + 0.5 s stagger (bypasses no rules — decal-marked, token-consuming). Cadence 6 s while the range holds. The knee-break-then-plink line now costs constant repositioning under mortar fire instead of being a zero-threat shooting gallery; mid-range (8–15 m) remains the efficient pocket, which is where his melee threatens — the intended tension.
- **Escalation:** after 2 cores, shrine wakes: 3 Rime Imps per 30 s (max 3 alive). After 4 cores: ground-pound gains a second, delayed shockwave ring (jump the first, jump the second — ollie apex 1.14 m clears both).
- **Unique telegraphs:** each core flashes white 300 ms before the attack that limb powers (within an overall ≥500 ms windup) — the boss literally telegraphs *from his weak points*.
- **Sketch:** patient siege duel under mortar pressure. Speedrun line: Spike-stun → crown-snipe twice. Intended first-clear: knees → kite through mortars → shoulders → crown, ~2 min (see §8.1 uptime note).

### 7.2 COLD REALM BOSS — **Moraine Colossus, "The Moraine Elder"** (boss variant, §2.4)

- **HP 2000, stance 240. Arena:** glacial cirque, 34 m, six breakable ice pillars around the rim.
- **P1 (100–70%):** haymaker (1300 ms), stomp quake pop-up ring (1000 ms red, 6 m). **Avalanche Charge** every ~18 s: 20 m line, 1500 ms red cue, plows a powder trench. Steer it into a pillar → **4 s stun, the only window where fling works on him** — vortex-fling him during stun for +80 bonus (he crashes down, extending the window 1 s). Pillar shatters on use: **6 stuns total in the fight. Spend them wisely** — the fight's core economy.
- **P2 (70–40%):** transition 3 s (roars, frost fog). Adds once: 3 Hoarfrost Sprites (his casters — attack rate −40% while they live). Stomp quake now leaves ice-shard patches (4 dmg/s).
- **P3 (40–0%):** enrage — charges come in pairs (second re-aims mid-run, 1000 ms re-cue), speed 3.0→3.8. No new pillars: if all six are spent, remaining stuns come from stance-breaking — **now arithmetically real under the §5.1 Sekiro drain:** Spikes ×3 (180) + 6–10 bolts woven between Spike cooldowns (60–100) fills the 240 meter across ~20 s, because the 0.45 s bolt cadence keeps the drain's 3 s idle timer at zero throughout. Dropping pressure mid-sequence bleeds 20/s — the fallback rewards commitment, not a spreadsheet.
- **Anti-camp:** player >20 m for 6 s → tears an ice boulder, mortars it (leads target, 2 s flight, 5 m decal).
- **Sketch:** the realm exam — wall-bait economy, add triage, jump-timing, stance math. ~3 min.

### 7.3 SAND MID-BOSS — **Dune Brute, "Gatekeeper of Brass"** (boss variant, §2.4)

- **HP 1500, stance 220. Arena:** gate corridor, 25 m — narrow: kiting room exists but is rationed.
- **P1 (100–50%):** the anti-tank thesis, pure. Immune to knockback and fling, all four attacks (slam 26 / sweep 20 / bulldoze 24 red 1500 ms / grab-hurl 28 with 900 ms grab cue — Wave-break the grab). Spike-stun opens the visor slit: 2.5 s weak window ×2 damage.
- **Anti-camp (this revision):** **Brass Slab Throw** — at >14 m for 4 s, rips a plate from the gate and hurls it flat (14 m/s, 900 ms cue, 20 dmg + knockdown [token]); the corridor walls make the dodge lane readable.
- **P2 (≤50%):** transition 2 s — armor plates shed in a shockwave (8 dmg <4 m). Faster (2.2→3.0), swings chain, windups −20%, clamped at 800 ms (the 900 ms grab cue reduces only to the clamp, not to 720), but shed plates expose flesh: base damage taken +25% and Chill now sticks. No adds.
- **Sketch:** a ~2-minute technique gate: the player who face-checks him fails; the player who runs the Spike→visor→Brittle loop clears clean. Guards the realm's midpoint gate.

### 7.4 SAND REALM BOSS — **Dune Warden, "Warden of the Sundered Gate"** (strongest boss case in the set)

- **HP 2400, stance 220. Arena:** dune bowl, 36 m, two crest ridges (his archers' ground — see P1), sand geyser vents (P3).
- **P1 — The Commander (100–70%):** he does not deign to close. Crescent sand-slashes from range (18 dmg arc projectile, 14 m/s, 800 ms — his anti-camp tool, active from the opening bell) while **Decree** runs his troops: wave of 4 Dune Imps + 2 Windscour Bandits (his attack rate −40% while they live; Decree gives troops +speed 8 s, gold shimmer tell). Respawn 30 s, max 1 wave per phase. Lesson: wipe adds fast (Great Vortex) or drown.
- **P2 — The Duel (70–40%):** transition 3 s — raises the **Sand Ward**: 8 m swirling dome that **eats all bolts from outside**. Choose: surf INTO the dome and duel him at khopesh range (3-hit chains 12/12/16, 700 ms; commander's slam — leaping point-blank AOE knockdown, 1100 ms red, consumes the CC token), or collapse the dome with a **Mini-Vortex** cast onto it (drops it for 12 s). Inside the dome, spells work fully — the dome only gates entry. Anti-kite made literal.
- **P3 — The Storm (40–0%):** dome re-arms once (fight's last third is inside-or-collapse again); geysers erupt on 4 s cycles (marked 1.2 s decals, 10 dmg + launch — **environmental: bypasses the CC token under the §1.4 juggle guard**, so they are a genuine routing hazard but can never chain with his slam's knockdown inside 2 s); khopesh chains gain a fourth hit; Decree now buffs *himself* (+15% speed).
- **Unique telegraphs:** all commands are broadcast — Decree raises the khopesh skyward (gold flash), slam crouch glints the scarab crown, geysers hiss.
- **Sketch:** phase 1 tests crowd control, phase 2 tests courage, phase 3 tests both under hazard pressure. ~3.5–4 min. The realm-gatekeeper.

### 7.5 ASH MID-BOSS — **Furnace Guardian** (forge-gate arena boss)

- **HP 2200, stance 260. Arena:** forge gate, 26 m, anvil blocks (LoS cover vs vent).
- **The core loop (runs across all phases):** the coal core behind the portcullis grate visibly stokes **dim → orange → white** (~30 s cycle). At white: Furnace Vent doubles (8→16 m cone, 2 s sustain, melts dodge timing — get behind an anvil or behind *him*; chimney silhouette makes facing readable at any distance). **Bolts aimed through the grate douse the core** — 3 doused stages snuff it: **5 s stun, grate glows as a ×1.5 weak point.** Then he re-stokes. Spikes hold him still to line up grate shots (heavy resist: 0.75 s).
- **Anti-camp (this revision):** **Slag Spit** — at >12 m for 4 s, hawks a molten glob: leads the target, 1.5 s flight, 4 m decal, 16 dmg + burn 1/s×3. The grate-douse shot is *supposed* to be taken from range — the spit prices the camping, it doesn't forbid the mechanic.
- **Phases:** 100/60/30. P2: Stoke Pulse (10 m heat ring at white, 1000 ms red) + Grate Grapple (grabs <2.5 m, channel 6 dmg/0.5 s, mash out; consumes the CC token). P3: permanent orange floor-glow ribbons (walkable lanes), vent tracks the player slowly during sustain.
- **Sketch:** the frost mage fights a furnace — aim at the chest, never stand in front at white heat. Pure kit-showcase. ~3 min.

### 7.6 ASH REALM BOSS / GAME FINALE — **Volcanic Plate Knight** (strongest single-encounter candidate in the roster)

- **HP 3000, stance 300. Arena:** caldera, 40 m — starts clean, **ends as a fire maze he built**.
- **Moveset (all phases):** Seismic Punch — 12 m traveling fissure (1200 ms, ground line decal); Magma-Vein Sweep — 200° low scythe (1400 ms red — jump it, ollie clears); **Basalt Lob** — anti-kite mortar, **lead math corrected this revision:** leads by the **full 2.0 s flight time against the target's sustained velocity vector** (a 19.5 m/s surfer is aimed 39 m ahead along the carve line, clamped to the 40 m arena), and detonates as an **airburst 2 m over the predicted point** — a converging shadow-ring gives a **1.0 s dodge read**. Counter: change speed or heading after the launch grunt — the prediction is linear, any carve breaks it; a stationary target is led trivially (lead = 0). 30 m range, 5 m burst. The old fixed 0.5 s lead landed 29 m behind a full-speed surfer and could only hit the players it wasn't for; do not ship it.
- **Crack-line Eruption** — both fists down (1500 ms red): **every ground scar left by earlier attacks re-ignites simultaneously** (8 dmg/s lines, 4 s — environmental, no hard CC, so no token interaction).
- **Progressive Fracture (100 / 65 / 35%):** each stage — 3 s invuln beat (stance meter frozen, §5.1), magma veins visibly widen: **+20% damage taken, +12% attack speed, scars burn longer** (4→7→10 s). The arena fills with his history; late fight is a routing problem at surf speed.
- **Frost interplay:** Wave on a *fresh* crack quenches it — slows him 3 s and deletes that scar from future Eruptions (scar economy: aggressive quenching keeps the floor playable). Stance 300: two breaks available across the fight (per the §5.1 cadence math), 5 s windows, ×2 damage into widened veins.
- **Adds:** none — the arena is the add.
- **Sketch:** the mastery exam: telegraph literacy at stage-3 speed, scar management, lob-dodging at full surf, quench discipline. 4–5 min. Colossal silhouette (2.5–3× player), animates entirely from fists — cheap to rig, huge to fight.

---

## 8. TTK & Difficulty Curve

### 8.1 TTK per tier (vs tuning DPS 35, no crits — variance ±10% keeps hit-counts exact; recomputed this revision)

**Explicit uptime assumptions (new):** trash tiers = 100% damage uptime (fights too short for meaningful downtime); heavy/elite = ~85% (repositioning around armor grammar); **bosses = 40% damage uptime** — telegraph dodging, transition invulnerability, add waves, and aim-limited windows (Shrinebreaker cores) eat the rest; stance-break windows (×1.5–2 for 3–5 s) claw back roughly what add-phases cost. Every boss duration below is `HP ÷ 35 ÷ 0.40` plus scripted beats.

| Tier | HP (L10) | TTK | Bolt count check (12 dmg) | Examples (re-filed) |
|---|---|---|---|---|
| Fodder | 24–40 | **0.7–1.1 s** | 2–4 bolts | imps (24–34), sprites (28) |
| Light | 40–75 | **1.1–2.1 s** | 4–7 bolts | assassins (40–48), stalkers (50–70), casters (55–65), raiders (75) |
| Medium | 80–110 | **2.3–3.1 s** | 7–10 bolts | scouts (95), bandits (90) |
| Heavy | 260–480 | raw 7.4–13.7 s → **10–18 s with mechanic** | — | Cinder Sentinel (260), Hail Guard (300), Hourglass (420), Scorch Warden (480) |
| Elite | 380–680 | raw 11–19 s → **15–25 s with mechanic** | — | Dune Sentinel (380), brutes (520–680), Moraine field (640) |
| Mid-boss | 760 (Shrinebreaker cores, §2.4) – 2200 | **~2 min (Shrinebreaker, core-aim-limited) / 90–120 s (Gatekeeper 1500, corridor ≈50% uptime) / ~2.5–3 min (Furnace 2200 at 40%)** | — | Shrinebreaker, Gatekeeper, Furnace |
| Realm boss | 2000–3000 | raw 57–86 s → at 40% uptime **143–214 s** + scripted beats = **3–5 min** | — | Elder (2000), Warden (2400), Plate Knight (3000) |

Wave budget check (honest recompute): flagship sand pack (4 bandits + mage = 420 HP total) at 35 DPS = 12 s raw; spread targets, grit-blinds, and off-camera flankers impose a ×2.5–3 real-fight overhead ⇒ **~30–40 s** — inside the 30–90 s window. A pack with 2 elites would blow the budget; composition tables never ship one.

### 8.2 Realm difficulty curve

Realm stat scaling now comes entirely from **band levels** (progression doc §5–§6), not multipliers — this table carries only the level-invariant knobs:

| Parameter | Cold (R1) | Sand (R2) | Ash (R3) |
|---|---|---|---|
| Enemy level band (progression §6) | 1–10 | 8–20 | 18–30 |
| Stat generation | `row × 1.10^(L−10)` HP, `× 1.07^(L−10)` dmg — all rows are L10 snapshots | same | same |
| Attack tokens | 2+2 | 2+2 | 3+3 (late) |
| Alive cap | 6 | 8 | 8 |
| Wave budget range | 6–14 | 8–17 | 10–22 |
| Telegraph bias | +200 ms over minimums | standard | standard (floor 500 ms holds) |
| New systems taught | tokens, stealth-reveal, carapace/anti-tank, alarms, submerged pursuit | surround-spawns, aim-denial (blind/parry/sprint), auras-lite, death-denial | pursuit-at-speed, vision-denial clouds, spell-suppression aura, compound packs |
| Signature counter drilled | Spikes (stun key) | Mini-Vortex (reveal/collapse) & Great Vortex (packs) | full-kit fluency on the move |

### 8.3 Progression & scaling — governed by the Progression Doc

This section previously carried coarse realm multipliers (HP ×1.3/×1.7, damage ×1.25/×1.5) and "+15% player damage per realm." **All superseded** by the progression doc (its §1 Anchor Contract and §10.2 errata): per-level formulas replace realm multipliers; the +15%/realm player growth is delivered through shrine boons (progression §8.3, six picks ≈ ×1.08 each). The invariants that matter to this doc survive by construction: even-con hit severity is constant at every level (enemy dmg +7%/level = player HP +7%/level), and even-con TTK drifts down ~1.5–2%/level, so every TTK and "X bolts" lesson in §8.1 holds wherever the fight happens at even con.

---

## 9. Implementation Architecture (mapped to the engine brief)

### 9.1 Damageable & CombatSystem — allocation-free SoA

Per the load-bearing contract (`spellSystem.js` header: "Allocation per frame: none"; `main.js`: "the frame closure allocates nothing"): no per-frame objects, closures, or mesh raycasts. Analytic shapes only (arc / sphere / cylinder / segment).

```
CombatSystem (module-scope, preallocated at MAX_ENEMIES = 16):
  posX, posZ, posY, radius, height   : Float32Array   // capsule proxy per enemy
  hp, hpMax, poise, poiseMax         : Float32Array
  chill, ccStun, ccSlow, ccTimers[3] : Float32Array   // DR windows per category
  vortexTick                         : Float32Array   // per-enemy DoT accumulator
  flags                              : Uint8Array     // alive|submerged|cloaked|hyperArmor|kbImmune|flingImmune|construct|decoy
  sweepHitLatch                      : Uint16Array(1) // bitmask, cleared on Sweep.trigger()
API (all take indices/scalars, return counts into preallocated scratch):
  queryArc(cx,cz,dx,dz,curveR,thick,halfAngle,maxH) → hits into _idxScratch
  querySphere(x,z,y,r) / queryCylinder(x,z,r,h) / querySegment(x0,z0,y0,x1,z1,y1,r)
  damage(i, amt, poiseDmg, ccType, ccDur, srcDirX, srcDirZ)  // applies DR, tier gates, floats a number
```

Exposed as `SNOWFLOW.combat` (same convention as `deform`/`crosshair`/`meshChar`); enemy positions mutated in place, never reassigned (harness contract). Playwright autoplay: combat arms with no user gesture.

### 9.2 Frame order (per `main.js` frame(), ~lines 569–624)

```
character.update → figure/meshChar → contact.update
  → [NEW] enemies.update(dt)          // AI + locomotion + ENEMY ATTACKS vs player hurtbox (§9.7) —
                                      //   BEFORE spells so volumes test current-frame positions
  → [NEW] projectiles.update(dt)      // enemy projectile pool (§9.7): integrate, dome/LoS tests, player-capsule substeps
  → rig/post/sky/shadows.update
  → spells.update(dt, camPos, camera) // player damage resolves IN HERE via ctx.combat (nullable, null-guarded per call,
                                      //   same pattern as ctx.deform.brush / ctx.spray.emit)
  → [NEW] enemies.postCombat(dt)      // deaths, knockback integration, brush/spray writes, telegraph/decal pool tick
  → deform.update                     // brush queue drains once — all combat brush writers must land before this
  → terrain → sync → wake → spray.update   // death VFX emitted via spray pool BEFORE this upload
  → drawFrame
```

- `dt === 0` (S.freezeTime): enemies.update, projectiles.update, and all combat are strict no-ops; **no divides by h** (the controller's documented NaN-at-freeze bug: guard `if (h > 0)`).
- `S.showSpells=false` → `cancel()` every frame: damage volumes die with cancel (all tests gate on each spell's `active` / `_burst` state, never on cast attempt or input).

### 9.3 Per-spell hit hooks (exactly the brief's suggested points)

| Spell | Hook | Test |
|---|---|---|
| Frost Bolt | `Ribbon._retire()` after tip integration (~line 449): `querySegment` per 1/60 substep — at 13–17 fps the projectile covers **1.24–1.62 m per rendered frame** (21 m/s ÷ 17…13), which is why point tests tunnel and substeps are mandatory; splash via `querySphere` inside `_splash()` (~515). Speed-falloff check reads `character.speed` at release. Held-whip: capsule ticks in `_writeStrand()` spine walk, 4 Hz throttled | segment-vs-sphere |
| Wave | `Sweep.update()` beside `_plough()/_spray()` (~202), gated `env ≥ 0.05`; per-enemy bit in `sweepHitLatch`; damage ×env ×bell(u) | arc/annulus |
| Mini-Vortex | `Bloom.update()` inside the existing `if (!this._burst && this.t >= 0.10)` block (~93), third call beside `_crater()/_throw()` — inherits burst timing for free. Column: cylinder tick while LIFE. Note Bloom runs crater/throw even at strand<0 — damage rides `_burst`, which is correct either way | sphere one-shot + cylinder DoT |
| Spikes | `Crystallize._plantOne(i)` (~121): small-circle test per prism as it plants — outward wave free from planting order. **Standing hazard (slow/impact-stun for 34–42 s) lives in `crystals.js`** vs the planted list — the spell object deactivates at t > 2.45 s and `cancel()` never retires crystals | growing disc |
| Great Vortex | `Vortex.update()` beside `_strip(dt, env)` (~100): cylinder at `this.ring`, DoT via `vortexTick` accumulator (mirror the 45 Hz `_strip` throttle → frame-rate independent). Lift flag while inside ×env ≥ 0.5; fling on fade/release along aim | player-following cylinder |

Combat quotes the engine's aiming rules verbatim — Sweep ground-flattened at press; Bloom/Crystallize 22 m cap / 13 m fallback; Bolt 40 m leash / 18 m fallback with 0.6 m crosshair snap. No invented ranges.

### 9.4 Game feel

- **Hit-stop — specified in frames, not milliseconds (this revision):** at the 13–17 fps floor a frame is 59–77 ms, so the old 40/90 ms values were sub-frame or quantization noise. Implement as **rendered-frame counts with timeScale 0.05**: light = **1 frame**, medium = **2 frames**, heavy = **2–3 frames**, kill/stance-break = **3 frames** + micro-shake (`rig.addTrauma(0.06–0.12)` — the existing trauma hook). At 60 fps these counts are re-derived from the intended feel times (light ≈ 60 ms → 3–4 frames): the data table stores *frames per fps bucket*, never ms. **Global cap: no new stop within 3 rendered frames of the last; never on vortex DoT ticks or multi-target AoE beyond the first victim.**
- **Damage numbers:** pooled sprite floaters (preallocated 32); Brittle hits tinted; "RESIST/IMMUNE" for DR.
- **Death VFX:** through the existing spray pool, emitted in `enemies.postCombat` (before `spray.update` upload). Terrain scars (brute slams, boss fissures) as deform brushes, staged before `deform.update`.

### 9.5 HUD

- Health + mana bars, DOM overlay (zero canvas allocation): updated via a dirty-flag from `SNOWFLOW.combat.playerHp/mana`, writes throttled to 15 Hz.
- Spell keys row: cooldown radial, gray on insufficient mana, **hatched on strand starvation** (§1.3).
- Crosshair blooms wide above 12 m/s (Bolt speed-falloff state, §1.1).
- Chill-stack pips on enemy target reticle; boss bar with stance sub-meter (freeze state visible during transitions); off-screen attack edge-arcs (§1.4).

### 9.6 Ship order — what exists BEFORE enemies

**Phase 0 (ships first, playable same-day):** `ctx.combat` + full five-spell hit pass + HUD + hit-stop + damage numbers, validated against **three training dummies at the spawn shrine**:
1. *Static dummy* (HP 100, infinite respawn 2 s) — verifies every volume: sweep latch-once, bloom burst frame, per-prism spike hits, vortex tick rate, bolt substep segments.
2. *Drifting dummy* (figure-8 at 5 m/s) — verifies bolt leading, sweep crest timing, fling direction, and the 12 m/s falloff gate (drive the player past it and read the ticker).
3. *Armored dummy* (kbImmune + construct flags, poise 120) — verifies CC gates, DR floaters, stance-break window and the Sekiro idle-drain timer.

Each dummy logs hits to an on-screen ticker (spell, damage, poise, CC applied) — this IS the combat test harness, and it stays in the shrine forever as the player's practice room.

**Phase 1:** Cold fodder trio (Rime Imp, Hoarfrost Sprite, Frost Stalker) + tokens + FSM **+ the §9.7 enemy substrate that these three already require: projectile pool (Sprite bolts), player hurtbox, telegraph/decal pool, submerged locomotion (Stalker).**
**Phase 2:** Glacier Brute + Hail Guard (armor grammar) + alarm layer (Glass Revenant) + grab/reel states + Sekiro stance meter.
**Phase 3:** Shrinebreaker, then the Elder (adds the mortar/airburst projectile kind and the pillar-stun script).
**Sand and Ash are data rows on this substrate PLUS named new code — the old claim that they need "data-table entries, not new code" was false and is withdrawn.** New-code line-items, budgeted per realm: **Sand** — Sand Ward dome (projectile-eating zone volume), Reassembly-freeze death-denial state, Decree buff broadcast, Hourglass walking-360 gyre volume. **Ash** — weaving-homing projectile kind, rune-field aura zone, ash-pall visibility zone, toboggan slope-pursuit locomotion, Plate Knight scar registry (ground-history record + mass re-ignition). Estimate: Sand ≈ 4 systems, Ash ≈ 5, each S–M effort on the pooled substrate below.

### 9.7 Enemy-side combat substrate (new this revision — the other half of the pipeline)

Everything below obeys the allocation-free contract: pools preallocated at module scope, SoA layout, analytic tests only.

- **EnemyProjectilePool** — SoA, prealloc **64**: `posX/Y/Z, velX/Y/Z, kind (Uint8: STRAIGHT | HOMING_LIGHT | HOMING_WEAVE | MORTAR | MORTAR_AIRBURST), homeStrength, dmg, radius, ttl, decalIdx`. Updated in `projectiles.update` (frame order §9.2): integrate, homing steer (weave kind adds a sine perpendicular), **segment-vs-player-capsule per 1/60 s substep** (same tunneling rule as Bolt — a 30 m/s glass lance moves 1.8–2.3 m per rendered frame at floor fps), LoS-break kill for weaving kind, **Sand-Ward dome test** (projectiles from outside the dome sphere are retired at the boundary), mortar kinds follow a ballistic arc to a decal-marked point (airburst variant detonates 2 m above it). All ~15 roster projectile types are rows in a data table over these 5 kinds — no per-type code.
- **Player hurtbox** — capsule (r 0.42, h 1.7) registered in CombatSystem; **all enemy melee resolves as analytic arc/sphere queries in `enemies.update`**, before spells, so player damage lands on current-frame position. Applies the §1.4 CC token, juggle guard, and slow-cap logic in one place.
- **Telegraph/decal system** — pooled ground decals, prealloc **32** (ring / line / cone geometries, transform-only updates): every windup row in the roster tables drives one decal + the red-cue flash channel + an audio stinger hook (audio.js polling contract, ≥300 ms off-screen rule). Decal lifetime = the telegraph ms from the data row — the tables in §2 are literally the tuning file.
- **Grab/reel state machine** — FSM states `GRAB_WINDUP → GRAB_HOLD` with mash-out counter and Wave-break test; used by grab-hurl, grind grab, chain drag, Grate Grapple. One implementation, four data rows.
- **Zone volume list** — pooled, max **4 active**: Sand Ward dome (entry-gating sphere), rune field (player-spell damage multiplier aura), ash pall (visibility flag volume + AI cover), geyser vent (scheduled decal + launch). Zones are tested in `projectiles.update` (dome) and `spells.update` (rune multiplier) via one shared array.
- **Clones/decoys** (Mirage Step) — pooled CombatSystem entries with `decoy` flag: hp 1, no AI tokens, crumble VFX on death; costs an enemy slot from the prealloc 16, never an allocation.
- **Submerged locomotion** — `submerged` flag + heightfield-following y + mound/wake VFX through the existing spray pool; pursuit speed and leash-extension are data fields (§4.3). Untargetable-except-Mini-Vortex is a flag test in the Bloom hook, already in §9.3.

---

## Appendix A — Revision Log (v1.0 → v2.0, director critique)

All 16 review issues were verified against the engine or by arithmetic and **all 16 are resolved in the body above; none warranted rebuttal.** Index: (1) sentinel perception capped at 35 m, snipe window 36–40 m — §2.0/§2.1–2.3/§3.5/§4.1/§6.2. (2) boss stance drain → Sekiro 3-s-idle model, cadence re-verified — §5.1, §7.2 P3. (3) kite hole closed: Bolt speed-falloff >12 m/s, submerged pursuers in Cold/Sand at 13 m/s with 60 m leash, flat-ground 19.5 m/s verified from controller.js and stated — §0/§1.1/§2.1 #3/§2.2 #13/§4.3. (4) realm multipliers deleted; all rows declared final L10 snapshots under the progression Anchor Contract; tier baselines published — §2.0/§8.2/§8.3. (5) TTK table recomputed at 35 DPS with explicit 40% boss-uptime assumption; Cinder Sentinel re-filed to Heavy, Blizzard Assassin to Light — §8.1. (6) field/boss variants declared for Pack-Ice Golem (300/760), Dune Brute (680/1500), Moraine Colossus (640/2000); TTK cites 760 — §2.4/§7.1–7.3/§8.1. (7) Shrinebreaker anti-camp: Shrine Masonry Lob — §7.1 (plus Gatekeeper slab throw and Furnace slag spit so the §7 common-structure claim is true for all six). (8) Basalt Lob: full-flight-time lead + airburst with 1 s marker — §7.6. (9) Scorpion Husk: persistent buried tell <15 m + 500 ms crack-cue — §2.2 #18/§3.2. (10) mana: base regen cut 12→6/s, surf 18/s kept; sustain claim corrected and carried through — §1.3. (11) opener recomputed at ~3.0 s and re-sequenced Spikes → Mini-Vortex → Bolts so the stun covers the escape-tool window — §1.2. (12) ambusher cost 3 / assassin cost 4 added; every pack row recomputed — §6.1/§6.2. (13) §9.7 enemy-side substrate added (projectile pool, hurtbox, telegraphs/decals, grabs, zones, decoys, submerged locomotion); phases re-costed with the Sand/Ash new-code list named and the "no new code" claim withdrawn — §9.2/§9.6/§9.7. (14) hit-stop specified in frames at 13–17 fps; substep figure corrected to 1.24–1.62 m/frame — §9.4/§9.3. (15) bosses renumbered §7.1–7.6; all §6→§5 CC/poise references and roster boss cross-references fixed — throughout. (16) CC token vs environment ruled: attacks consume the token, environment bypasses it under a 2 s juggle guard and 1-per-4 s cap — §1.4/§5.3/§7.4.