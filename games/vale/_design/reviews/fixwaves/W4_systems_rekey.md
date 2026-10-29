# W4 · Systems re-key: before and after

**Status: signed off 2026-10-28 (owner-delegated ruling 4 in `owner_rulings.md`; the probe_sim_rekey 10 % gate stays on). Block 7, added later the same day, falls under the same ruling and gate (signed off 2026-10-29).** This page covers final parity review item **originality F4**, the systems layer that mapped one to one onto LoL's, and the matching kit hooks in **originality F5**. The owner approves or rejects each row. Nothing ships as final until then.

**The rule.** LoL is a gauge only. Each row below names the LoL system that a LoL player would read into VALE's old version. After the re-key:

- no headline number sits within 10 % of its LoL counterpart;
- no rule maps one to one;
- every new rule comes from VALE's world: the stopped dial, light that stalls, and shadows that stay (`_design/WORLD.md`, `_design/STYLE_BIBLE.md`).

**How it is measured.** `node _harness/probe_sim_rekey.ts` builds the real catalog in memory from `content/`. It checks 53 headline numbers against the gauge and runs every new rule in the sim. Result on 2026-10-28: **30 of 30 checks pass**, and none of the 53 numbers is within 10 %. `node _harness/probe_items.ts` passes 140 of 140, and `node _harness/probe_sim_kit_hooks.ts` passes 22 of 22.

**How to read the LoL column.** Values are the live values as recalled, so they are approximate. Where a value moved between patches, every reading is listed and VALE must clear all of them. Distances assume 1 m = 100 units. Relative move speed uses a base of 335 units (LoL) and 3.45 m/s (VALE). The table holds numbers only. No LoL name, icon or asset entered the game.

---

## 1. Hour spells (`content/setup.json`)

| VALE spell | Reads as | Before | After (VALE rule) | Closest gap |
|---|---|---|---|---|
| **Glint Step** | Flash | Blink 4.5 m. Cooldown 270 s (Flash: 4 m, 300 s). | Blink 4.5 m, and **your shadow stays where you stood** for 2.5 s: an enemy fighter who steps into it is slowed 30 % for 1 s. Cooldown 210 s. A wall-stopped 5 m dash was tried first. The bot soak showed bots dying to Wicks while escaping (alone-death rate 9.2 % against 3.0 % with the blink, same seeds), so the step stays a blink and the shadow carries the VALE rule. | distance +13 % · cooldown −30 % |
| **Saplight** | Heal | Instant heal of 80 + 16/level on yourself and 40 + 8/level on allies within 6 m. Cooldown 220 s (Heal: 80–318, 240 s). | **A pool of stopped sap-light**, 3 m wide, at your feet for 4 s. You and allied fighters standing in it heal 4 % of max health each second. You have to hold the ground to be healed. Cooldown 200 s. | L1 heal +30 % · L18 +26 % · cooldown −17 % |
| **Hairline** | Ignite | 20 + 8/level true damage, then 20 % armor and resist shred and 35 % weaker healing for 4 s. Cooldown 170 s (Ignite: 180 s, 40 % cut). | Same crack-and-shred rule; it was never a burn. 30 % weaker healing. Cooldown 140 s. | cooldown −22 % · healing cut −25 % |
| **Hourstrike** | Smite | 450 + 30/level true damage. 2 charges, 95 s recharge. Heals 60 + 6/level (Smite: 600, 2 charges, 90 s). | **The fuller the monster, the harder it lands:** 250 + 15/level **+ 12 % of its current health** as true damage, and you heal 4 % of your max health. It opens a camp; it does not steal one. 3 charges, 70 s recharge. | flat damage −56 % · charges +50 % · recharge −22 % |
| **Running Light** | Ghost | +45 % move speed, fading over 6 s. Cooldown 200 s (Ghost: 24–48 % over 10 s, 210 or 240 s). | +60 % move speed, fading over 4 s. Cooldown 150 s. | peak +25 % · duration −60 % · cooldown −29 % |
| **Shake Loose** | Cleanse | Unstoppable 0.5 s, then 50 % tenacity for 3 s. Cooldown 210 s (Cleanse: 65 % for 3 s, 210 s). | Unstoppable for 1 s and +30 % move speed for 2 s. **No tenacity tail.** Cooldown 150 s. | tenacity −100 % · cooldown −29 % |
| **Glass Pane** | Barrier | Shield of 90 + 20/level for 3 s. Cooldown 160 s (Barrier: 105–411, 2.5 s, 180 s). | **The pane sets.** Shield of 50 + 12/level for 4 s, and enemy fighters within 3 m are slowed 25 % for 1.5 s. Cooldown 130 s. | L1 −41 % · L18 −35 % · duration +60 % · cooldown −28 % |
| **Calling Bell** | none | Team haste and reveal. | Unchanged; the review found no twin. | — |
| **Defaults** | Flash + Heal | Glint Step + Saplight (blink + heal). | **Glint Step + Glass Pane**: a step that leaves its shadow, plus a pane that sets. There is no heal in the pair. | — |

## 2. Starters, potion, boots and ward (`content/items.json`, `content/units.json`)

| VALE item | Reads as | Before | After | Closest gap |
|---|---|---|---|---|
| **The starter rule** | Doran's line, sold off later | A dead-end lane start. | **Starters grow.** The first Gloam core you buy while carrying a starter folds the starter in at its full price (`ItemDef.foldsInto: ["core"]`, `src/sim/shop.ts` `claimFold`). The road start becomes part of your role's first core instead of being sold at a loss. | rule |
| Notched Blade | Doran's Blade | 430 Gleam, +8 attack, +80 health (450 · 8 · 80). | 360 Gleam, +11 attack, no health. Heals 8 per Wick or monster you finish. Folds into your first core. | price −20 % · attack +38 % · health −100 % |
| Reading Lens | Doran's Ring | 430 Gleam, +12 power, +60 health (400 · 15 or 18 · 70). | 350 Gleam, +12 power, +30 health, +0.4 Light regeneration per second. Folds into your first core. | price −13 % · power −20 % · health −57 % |
| Ironstone Guard | Doran's Shield | 430 Gleam, +120 health (450 · 110). | 360 Gleam, +150 health, +0.8 health regeneration per second. Folds into your first core. | price −20 % · health +36 % |
| Grove Sickle | jungle starter | 350 Gleam (450). | 300 Gleam. Folds into your first core. | price −33 % |
| Sap Flask | Health Potion | 50 Gleam, 120 health over 9 s, stacks to 5 (50 · 120 over 15 s · 5). | 40 Gleam, 150 health over 5 s (25 at once, then 25 each second), stacks to 3. | price −20 % · heal +25 % · duration −67 % · stack −40 % |
| Road Sandals | Boots | 300 Gleam, +0.25 m/s, or 7.2 % of base speed (300 · 25 MS, or 7.5 %). | 250 Gleam, +0.21 m/s (6.1 %). | price −17 % · speed −18 % |
| Dust Runners | Berserker's | 1,050 Gleam, +0.42 m/s, +25 % attack speed (1,100 · 45 MS · 25 or 35 %). | 900 Gleam, +0.36 m/s (10.4 % of base), +19 % attack speed. | price −18 % · attack speed −24 % · speed −22 % |
| Felt Treads | Mercury's / Plated | 1,100 Gleam, +12 armor and resist, +15 % tenacity (1,100–1,250 · 30 %). | 900 Gleam, +10 armor and resist, +10 % tenacity. | price −18 % · tenacity −67 % |
| Chalk Slippers | Sorcerer's / Ionian | 1,050 Gleam, +10 ability haste, +8 magic pen (900–1,100 · 10 or 20 haste). | 800 Gleam, +14 ability haste, no pen. | price −11 % · haste +30 % |
| Spare Lamp and Hooded Lamp | Control / Stealth Ward | 75 Gleam. A hidden lamp for 2:30 with 9 m sight; 3 lit at once; stacks to 2 (75 · 90–150 s · 900 units · 3). | 60 Gleam. A hidden lamp for 3:20 with 7.5 m sight; 2 lit at once; stacks to 3. | price −20 % · life +33 % · sight −17 % · lit −33 % |

## 3. The one-Noonlit rule becomes the dial-slot rule

| | Before (reads as the Mythic rule) | After (VALE) |
|---|---|---|
| Rule | `uniqueGroup: noonlit`: one Noonlit item per fighter. Each item said "You can carry one Noonlit item." | **Each Noonlit item stands at an hour on the dial** (`ItemDef.dial.hour`). Two carried Noonlit items must stand **4 or more hours apart** around the dial (`dial.apart`). The shop refuses a clash (`src/sim/shop.ts` `dialClash`); bots plan around it (`src/sim/bots/knowledge.ts`). |
| Hours | — | Seatstone **12** · Sunstring **2** · Hourcleaver **4** · Noonglass **8** · Shelter Lamp **10** |
| What it does | Exactly one apex. | One to three apexes. The two attack pieces clash (2 and 4), the two power pieces clash (8 and 10), and Seatstone clashes with Sunstring and Shelter Lamp. The largest set that fits together is Seatstone + Hourcleaver + Noonglass. The probe checks that every Noonlit item clashes with at least one other and that at most three fit. |
| Item text | "You can carry one Noonlit item." | "Stands at *N* on the dial: another Noonlit item must stand 4 or more hours away." |

## 4. Camp buffs and the late objective (`content/team_buffs.json`)

| Buff | Reads as | Before | After (map-tied) | Closest gap |
|---|---|---|---|---|
| **Clearglass** (Glasshorn) | blue buff | +10 ability haste and +1.5 resource regeneration for 90 s (10 haste, 120 s). | **Works only on your own side of the Noonline.** While there: +16 ability haste and +2 resource regeneration. The new condition `selfOnSide` checks which team's base you are nearer. | haste +60 % · duration −25 % |
| **Resinburn** (Resinback) | red buff | Every hit burns (3 ticks) and slows 10 %, once every 3 s per target (burn and slow, 120 s). | **Works only on the enemy side of the Noonline.** An attack sticks resin to the target (20 % slow for 1.5 s). Your next attack on that target within 4 s ignites it for 20 + 4/level magic damage. Once every 4 s per target. A two-hit ignite, not a burn over time. | duration −25 % · rule |
| **The Long Shade** (Longshade) | Baron | +25 attack, +40 power, +10 % tenacity for 2:30; empowered Wicks (12–48 attack and power, 180 s). | +20 ability haste and +15 % tenacity for 3:30. **No attack or power.** The siege value stays with the Wicks. | attack −100 % · duration +17 % |

## 5. BRIDGE (`content/modes.json`, `content/queues.json`, `src/session/draft.ts`)

| | Before (reads as ARAM) | After (VALE) | Closest gap |
|---|---|---|---|
| Start | Level 3 with 1,300 Gleam (level 3 with 1,400). | Level 2 with 1,050 Gleam. | level −33 % · Gleam −25 % |
| Shop | `base_or_dead`: shop only at home or while dead. | **`needles`: you shop at home, while dead, or within 6 m of one of your own standing Needles** (`rules.shopAt`). Your forward shop retreats as your Needles fall. | rule |
| Recall | None. | None. In the fiction, the span has no way home. | — |
| The Lot | Bench of 2, plus 1 personal redraw (bench plus reroll). | **The Lot is cast once and burns down.** 3 more fighters per team, face up. Nobody can draw again. Each seat may take one fighter from the Lot (`swaps: 1`). Every 8 s the Lot's first fighter returns to the gorge (`fade: 8`). The roster is 16 fighters: 10 drawn plus 6 on the Lots. | redraws −100 % · rule |

## 6. Kit hooks (originality F5)

| Fighter | Reads as | Before | After |
|---|---|---|---|
| **Ervet** · Whole Again | Riven's ult (a reforged blade that gains reach) | The blade reformed oversized: attacks reached +0.6 m farther (2.6 m) and cleaved a 120° cone of 3.5 m. | **The payoff is the shards.** She leaps, and the shards fly home from 4.5 m: damage, a 2 m drag toward her, and a lodged shard in each enemy for 6 s. Her attacks tear lodged shards out, bursting for 20 + 6/level (+3 % bonus health) magic damage and a 30 % slow within 1.75 m of each target. **Reach stays 2.0 m** and the cleave is gone. |
| **Vashil** · Hum | Brand's ablaze-into-stun | Any two ability hits on one enemy within 3 s stunned it for 0.75 s. | **Chord stun.** Struck while another humming enemy stands within 3.5 m, every humming enemy there is stunned for 1 s together (condition `markedNear`). A lone humming enemy is only slowed 35 %. Morning Toll stuns a pair on its second toll and never stuns a lone target. |

`_design/ROSTER.md` §5 now lists **Riven** and **Brand**, with the differences.

## 7. Economy and the finished line (gameplay G7, added 2026-10-28)

The item package (gameplay G7) moved four economy numbers and added VALE's own counters. **Signed off under owner ruling 4 (`owner_rulings.md`: rows W4 adds after the sign-off fall under the same gate and need no further sign-off unless it fails).** Its headline numbers and rules are in `_harness/probe_sim_rekey.ts` (63 headline numbers, none within 10 %; the conditional anti-heal, the rooted burst ward and the first-hit shields checked; report `_harness/_reports/integ_systems_rekey_gate.txt`, 37 passed, 0 failed, 2026-10-29). Full write-up: `_design/sections/items_setup.md` (the "Finished line" note) and `modes_economy.md` §2.

| | Reads as | Before | After (VALE) | Closest gap |
|---|---|---|---|---|
| RIFT passive Gleam | passive gold, 20.4 per 10 s (2.04/s) | 2.2/s (+8 %) | **3.2/s** from 0:30. Quick queue 3.6/s. | +57 % |
| Shieldwick / Glimwick bounty | melee 21 / caster 14 gold | 21 / 15 (0 % / +7 %) | **24 / 17** | +14 % / +21 % |
| Finished-item band | legendary items, about 2,600–3,300 | Gloam 2,400–2,900, Noonlit 3,000–3,500 | **Gloam 1,800–2,300, Noonlit 2,300–2,800** (price and stats ×0.8; Gleam per stat unchanged) | −31 % / −15 % at the ends |
| Anti-heal | Grievous Wounds, 40 % on any hit | none on items (Hairline 30 %) | **Lampblack:** 50 % only on the second hit within 4 s (Edge) or when you hold the enemy (Lens); 30 % in a 4 m ring around you (Coat). One per fighter. | +25 % / −25 %, and conditional rules |
| Percent armor pen | 18–35 % (several items) | none on items | Quarry Pick **24 %**, plus a max-health bite above 60 % | +20 % vs 20 %, −20 % vs 30 % |
| Burst ward | stasis (untargetable, no actions); low-health shields | Hourcleaver only | Stillhour **roots you in place** with +80 armor and resist (you still attack and cast); Glass Veil / Glintmail shield on the **first** fighter hit, not at low health | rule |

Measured in `fw_W4_soak_g7_final` (bot soak, 40 RIFT games); see the G7 status in the wave report.

---

## Match effect (bot soak, same seeds as the G1 baseline)

`node _harness/probe_sim_bot_soak.ts --full --seeds 10 --diffs adept,veteran --suites rift,bridge --jobs 3 --label rekey3`
(report: `_harness/_reports/fw_W4_soak_rekey3.txt`), against `fw_W4_soak_g1_final2` on seeds 1–10:

| Measure (RIFT, adept / veteran) | Before re-key | After re-key |
|---|---|---|
| Fighter deaths per game | 36.9 / 31.9 | 27.4 / 25.5 |
| Deaths to Wicks or monsters with no enemy fighter, per game | 2.0 / 1.7 | 2.1 / 2.1 |
| Same, as a share of all deaths (the G1 gate, ≤ 5 %) | 5.4 % / 5.3 % | 7.7 % / 8.2 % |
| Solo-laner cs at 10:00 · in-lane share | 59 · 81 % / 57 · 76 % (20 seeds) | 58.6 · 81 % / 58.0 · 77 % |
| Median length | 27.9 / 26.2 min (20 seeds) | 27.1 / 23.1 min |

The lone deaths per game hardly moved. The share rose because fights kill about a quarter fewer fighters: the escapes now come back sooner and leave a slowing shadow, and Glass Pane slows on cast. The next W4 bot package should re-measure the G1 share with this layer in place. A wall-stopped dash version of Glint Step was measured first (`fw_W4_soak_rekey`, 3.3 lone deaths per game) and dropped. The bots' ability reader now treats a top-level blink as the ability, even when a zone is laid at the caster's feet first (`src/sim/bots/knowledge.ts`). BRIDGE on the same 20 games: median 19.3 min, 18 of 20 in sudden death, against 33 of 40 before. The sudden-death share is gameplay G5, the next package.

## What changed in code (W4 files only)

- `src/contracts/catalog.ts`:
  - conditions `markedNear` and `selfOnSide`;
  - `ItemDef.dial` and `ItemDef.foldsInto`;
  - `RulesParams.shopAccess: 'needles'` and `shopAt`;
  - `QueueDef.bench.swaps` and `.fade`.
- `src/contracts/session.ts`: `DraftSeat.swaps`, an additive field.
- `src/sim/effects.ts`: the two new conditions.
- `src/sim/shop.ts`:
  - `dialClash` and `claimFold`;
  - `needles` access.
- `src/sim/bots/knowledge.ts`:
  - `buildPlan` respects the dial rule;
  - a top-level blink defines the delivery.
- `src/session/draft.ts`: Lot takes and the burn-down.
- `src/session/setup.ts`: `needles` added to the rules enum.

## Owner sign-off

| Block | Decision | Note |
|---|---|---|
| 1 · Hour spells and defaults | ☑ approve ☐ change | ruling 4, 2026-10-28 |
| 2 · Starters, potion, boots, ward | ☑ approve ☐ change | ruling 4, 2026-10-28 |
| 3 · Dial-slot rule | ☑ approve ☐ change | ruling 4, 2026-10-28 |
| 4 · Camp buffs and the Long Shade | ☑ approve ☐ change | ruling 4, 2026-10-28 |
| 5 · BRIDGE start, Needle shops, the Lot | ☑ approve ☐ change | ruling 4, 2026-10-28 |
| 6 · Ervet and Vashil hooks | ☑ approve ☐ change | ruling 4, 2026-10-28 |
| 7 · Economy and the finished line (G7) | ☑ approve ☐ change | ruling 4 (rows added after the sign-off fall under the gate); gate extended to block 7 and passing, 2026-10-29 |

Signed: owner-delegated ruling 4 (`owner_rulings.md`), recorded by the systems lane. Date: 2026-10-28 (blocks 1–6), 2026-10-29 (block 7)
