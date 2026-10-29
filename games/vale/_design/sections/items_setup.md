# Items and the setup layer (content lane, 2026-10-07)

What `content/items.json` and `content/setup.json` define, and why. Both are generated as plain JSON that parses with `ItemDef` / `SetupDef` in `src/contracts/catalog.ts` (strict keys), and both are checked by **`_harness/probe_items.ts`** (133 checks, all passing), which also plays every build through the real sim shop and casts every active, spell and boon. The real `tools/build_content.ts --check` passes with **0 errors** on a temporary tree made of the `content_min` fixture, every real content family, these two files and stub `map_rift` / `map_bridge` / `map_fray` maps. The only warnings are icon files that do not exist yet. Every name and text passes `tools/names_check.ts`.

Numbers marked *(r0N)* were calibrated against `_design/research/r0N_*.md`. They are references, not copies; every name, effect and number here is our own choice.

> **Re-key, 2026-10-28 (W4, final parity review originality F4). Signed off 2026-10-28 (owner ruling 4, `_design/reviews/fixwaves/owner_rulings.md`).** The systems layer moved to VALE's own stopped-dial rules, so no Hour spell, starter, potion, boots, ward, camp buff or BRIDGE start sits within 10 % of its reference-genre counterpart and no rule maps one to one. The full before/after table with the gauge numbers is `_design/reviews/fixwaves/W4_systems_rekey.md`; `_harness/probe_sim_rekey.ts` measures it (63 headline numbers with the G7 economy rows, none within 10 %) and exercises every new rule in the sim. Headlines:
> - **Hour spells** are light-and-shadow rules. Glint Step (4.5 m, 210 s) leaves your shadow where you stood as a slowing patch. Saplight is a 3 m pool of sap-light that heals 4 % max health a second to whoever stands in it. Hourstrike hits harder the fuller the monster is (250 + 15/level + 12 % of current health; 3 charges, 70 s). Glass Pane's shield sets with a 3 m slow. **Defaults: Glint Step + Glass Pane** (not blink + heal).
> - **Starters grow** (`ItemDef.foldsInto`): the first Gloam core you buy while carrying a starter folds it in at its full price. Starters are 300–360 Gleam.
> - **The dial-slot rule** (`ItemDef.dial`) replaces the one-Noonlit cap: each Noonlit item stands at an hour (Seatstone 12, Sunstring 2, Hourcleaver 4, Noonglass 8, Shelter Lamp 10), and two you carry must stand 4 or more hours apart. One to three fit together; same-family pairs (Sunstring + Hourcleaver, Noonglass + Shelter Lamp) never do.
> - **Potion, ward, boots** re-numbered: Sap Flask 40 Gleam, 150 over 5 s, holds 3; Spare Lamp 60, 3:20, 2 lit, 7.5 m sight, holds 3; Road Sandals 250 (+0.21 m/s), upgrades 800–900 (+0.36 m/s).
> - **BRIDGE** starts at level 2 with 1,050 Gleam and shops at your standing Needles (`shopAccess: needles`); see `modes_economy.md`.
> - The tables below were updated in place; numbers struck from older sections are listed in the re-key table.

> **Finished line, 2026-10-28 (W4, gameplay G7).** The finished line grew from 13 to **31 pieces** (20 Gloam, 11 Noonlit), each with a VALE rule, and the bots' build plan now reads the enemy team. Gauge: a LoL player finishes about three items by 25 minutes and builds counters to the matchup; VALE's numbers and rules are its own.
> - **Counters.** The **Lampblack** family is the anti-heal answer: soot from the stalled lamps turns sap black (the sim's `grievous`, shown as *Wounded*). Lampblack Edge Wounds 50 % on the second hit within 4 s, Lampblack Coat Wounds 30 % in a 4 m ring around you, Lampblack Lens Wounds 50 % whenever you hold an enemy (slow, root, stun …). One Lampblack piece per fighter (shared `uniqueGroup`). **Tank breakers:** Quarry Pick (24 % armor pen, + 3.5 % max health above 60 %), Deepglass Rod (10 % magic pen, + 4 % max health on the first hit per 6 s); Noonglass, Sunstring and Hourstring also read as breakers. **Burst wards:** Glass Veil (casters) and Glintmail (slingers) set a shield and +15 armor/resist on the first fighter hit (18 s), Stillhour's *Hold the Hour* roots you in place with +80 armor and resist, and Hourcleaver's low-health shield.
> - **New roles:** Dawnspur (diver opener), Resin Maul (bruiser heal on ability hits), Shadowpin (every fourth attack pins the shadow), Hourstring (every twelfth attack strikes the hour), Needlefall (takedowns cut cooldowns), Afterlight (the first hit lands again 1 s later), Callstone (a taunting call). **The Lampglass path:** Bellrope (hard CC tolls shields onto allies), Almslamp (+35 Gleam per takedown), Watchbell (reveals and slows enemy fighters within 9 m every 10 s), beside Kindly Lamp and Shelter Lamp.
> - **Price band.** The Gloam and Noonlit line moved about 20 % under the reference band (×0.8 on price and stats, so Gleam efficiency is unchanged): Gloam 1,800–2,300, Noonlit 2,300–2,800. RIFT passive Gleam is 3.2/s and the Shieldwick and Glimwick pay 24 and 17 (`modes_economy.md` §2).
> - **Bots** (`src/sim/bots/knowledge.ts` `buildPlan`, `itemRole`, `readEnemies`): an item's role is read from its data (Wounded, percent pen or target-health damage, one-shot shields, status-triggered passives, support tag). Against two or more healers, front lines or burst threats the plan takes the best answer second or third. Three narrower answers fill the situational pieces (integ systems-18, plan only, no item stat changed): against two or more burst threats a support seat takes a lookout (an item that reveals enemy fighters: Watchbell) and a frontline or warden takes peel (an active that holds the fighters near it: Callstone); a diving or skirmishing jungler facing four or more squishy fighters takes a piece that pays out on takedowns (Needlefall). A support seat takes support pieces first; a per-seat taste breaks near-ties; a Noonlit waits behind a Gloam unless clearly better; the boots upgrade waits for the third finished piece. A stance active that roots its caster is never cast while retreating.
> - **Measured:** `_harness/probe_sim_buildplan.ts` (12 checks: legal plans, counters follow the enemy team, the Lampglass path, every finished item has a buyer), `_harness/probe_items.ts` (every new passive and active fires in the sim) and the bot soak (`_harness/probe_sim_bot_soak.ts`, items group): 40 role-correct RIFT games (20 seeds × adept and veteran, `fw_W4_soak_g7_final`): **2.52 finished pieces held per player at min(25:00, end)** (2.78 in the 17 games that reach 25:00; it was 1.41 before), **28 of 31 finished items bought** (90 %; never Callstone, Needlefall, Watchbell), anti-heal bought by 98.5 % of players facing two or more healers against 30.4 % otherwise, and every fighter's first two finished pieces vary between its games. With the three situational answers (integ run 2, `fw_W4_soak_integ_systems_r2_full1` and `_r2_full21`): **31 of 31 bought on both seed sets** (seeds 1–20: Needlefall 8, Callstone 4, Watchbell 4; seeds 21–40: 14, 4, 8), 2.69 / 2.79 finished pieces held, BRIDGE median 15.5 / 16.2 min (before 15.5 / 16.1) and RIFT adept p90 29.0 / 30.9 min (before 29.0 / 30.9).
> - **Icons:** the 18 new pieces show a related item's icon until W2 paints `assets/ui/icons/items/<id>.webp` (handoff).

---

## 1. Shape of the catalog

**57 items** in four hour-tick frames, plus starters, consumables and boots.

| frame (hour-ticks) | schema `tier` | count | price | what it is |
|---|---|---|---|---|
| Slate (1) | `starter` | 4 | 350–430 | one road start per broad style, plus the jungle start (RIFT only, one per fighter) |
| Slate (1) | `consumable` | 3 | 50–75 | a heal flask, a ward, a FRAY tonic |
| Slate (1) | `basic`, no components | 8 | 280–420 | **one stat** each; the parts everything is built from |
| Verdigris (2) | `basic` with components | 7 | 900–1,050 | **two stats**, built from two Slate parts; FRAY's finished pieces |
| Gloam (3) | `core` | 20 | 1,800–2,300 | stats + **one distinct triggered passive**; unique per fighter |
| Noonlit (4) | `apex` | 11 | 2,300–2,800 | stats + a **strong passive or active**; **stands at an hour on the dial: two carried Noonlit items must be 4+ hours apart** (W4 re-key) |
| boots | `boots` | 1 + 3 | 300 / 1,050–1,100 | a Slate base pair and three Verdigris upgrades |

**Frame rule for the UI** (the schema has no frame field, so it is derived): `core` → Gloam, `apex` → Noonlit, `basic` or `boots` **with** components → Verdigris, everything else → Slate. Frame colours and tick counts come from `tokens.json` (`slate`, `verdigris`, `gloam`, `noonlit` + glow).

**Uniqueness.** Starters share `starter`, boots share `boots`, and each Gloam item is its own group, so its passive never doubles. Slate and Verdigris pieces stack freely. **Noonlit items follow the dial-slot rule instead (W4 re-key, 2026-10-28):** each stands at an hour (`dial.hour`), and two carried Noonlit items must stand at least `dial.apart` = 4 hours apart around the dial (the shop refuses a clash as `unique`). The hours: Seatstone 12, Sunstring 2, Hourcleaver 4, Noonglass 8, Shelter Lamp 10, so the two attack pieces clash, the two power pieces clash, and Seatstone clashes with Sunstring and Shelter Lamp. A fighter carries one, two or (Seatstone + Hourcleaver + Noonglass) three.

**Starters grow (W4 re-key).** Every starter carries `foldsInto: ["core"]`: the first Gloam core bought while a starter is carried consumes it at its full price, exactly like a component, so a road start is never sold for a loss but grows into the role's first core.

**Why Noonlit does not consume a Gloam.** A Noonlit is built from Verdigris and Slate parts with a large fee, the same depth as a Gloam. If it ate a Gloam, a class would need two or three more Gloam items to fill six slots. Building beside the Gloam line gives every class five distinct finished pieces from 13 (§6) and lets a player rush their Noonlit.

## 2. Stat words and Gleam values

Player text uses plain words, not the stat keys:

| key | text | key | text |
|---|---|---|---|
| `ad` | attack | `ap` | power |
| `haste` | ability haste | `resist` | resist |
| `armorPen` · `magicPen` | armor / magic penetration (flat) | `magicPenPct` | % magic penetration |
| `healShieldPower` | heal and shield power | `omnivamp` | healing from all damage dealt |
| `lifesteal` | life steal | `resRegen` | Light regeneration (the resource's name) |
| `moveSpeed` | m/s | `crit` · `tenacity` | critical strike chance · tenacity |

Damage of type `true` is described as "damage that ignores armor and resist". **"True damage" is a deny-list phrase** (a shipped skin line and trademark) and fails the prose check; kit writers should use the same wording.

**Gleam per unit of stat** (the calibration table the probe uses; *r02 §11* reference prices sit within about ±10 %):

| stat | Gleam | stat | Gleam | stat | Gleam |
|---|---|---|---|---|---|
| attack | 35 | power | 21 | health | 2.67 |
| armor | 20 | resist | 19 | ability haste | 27 |
| 1 % attack speed | 25 | 1 % crit | 40 | 1 % life steal | 40 |
| armor pen (flat) | 30 | magic pen (flat) | 32 | 1 % magic pen | 35 |
| 1 % heal & shield power | 50 | 1 % omnivamp | 45 | 1 % tenacity | 15 |
| 1 m/s move speed | 1,200 | 1 Light regen/s | 350 | 1 health regen/s | 120 |

Efficiency bands, checked by the probe: Slate 95–105 % (they are 96–100 %), Verdigris 88–105 % (94–101 %), Gloam 75–102 % (85–97 %; the passive pays the rest), Noonlit 80–102 % (90–101 %), boots upgrades 90–110 %. Lane starters are 107–138 % (W4 re-key); they are cheap and fold into the first Gloam core at full price. The Grove Sickle is all passive.

**No `res` stat and no `resource` restore on items.** The sim adds `res` to the max of *any* resource model. +300 would quadruple a Heat bar (100 max) and triple a Tally bar. A `resource` restore adds Heat to a Heat fighter. Items therefore use `resRegen` only: it refills a Light pool, does nothing for Heat and is negligible for Tally (it decays). See §10.

## 3. The catalog

| id | Name | Frame | Gleam | Stats | Pools |
|---|---|---|---|---|---|
| `notched_blade` | Notched Blade | starter · Slate | 360 | +11 attack; folds into the first Gloam core | RIFT |
| `reading_lens` | Reading Lens | starter · Slate | 350 | +12 power, +30 health, +0.4 Light regen/s; folds into the first Gloam core | RIFT |
| `ironstone_guard` | Ironstone Guard | starter · Slate | 360 | +150 health, +0.8 health regen/s; folds into the first Gloam core | RIFT |
| `grove_sickle` | Grove Sickle | starter · Slate | 300 | +0.8 health regen/s; folds into the first Gloam core | RIFT |
| `sap_flask` | Sap Flask | consumable | 40 | — (3 per slot) | RIFT · BRIDGE |
| `spare_lamp` | Spare Lamp | consumable | 60 | — (3 per slot) | RIFT · BRIDGE |
| `noon_tonic` | Noon Tonic | consumable | 60 | — (3 per slot) | FRAY |
| `chalk_knife` | Chalk Knife | Slate | 350 | +10 attack | RIFT · BRIDGE |
| `glass_lens` | Glass Lens | Slate | 420 | +20 power | RIFT · BRIDGE |
| `ochre_brick` | Ochre Brick | Slate | 400 | +150 health | RIFT · BRIDGE |
| `felt_vest` | Felt Vest | Slate | 300 | +15 armor | RIFT · BRIDGE |
| `linen_wrap` | Linen Wrap | Slate | 380 | +20 resist | RIFT · BRIDGE |
| `taut_cord` | Taut Cord | Slate | 300 | +12 % attack speed | RIFT · BRIDGE |
| `hand_bell` | Hand Bell | Slate | 280 | +10 ability haste | RIFT · BRIDGE |
| `lamp_oil` | Lamp Oil | Slate | 280 | +0.8 Light regen/s | RIFT · BRIDGE |
| `whetted_knife` | Whetted Knife | Verdigris | 900 | +18 attack, +8 armor pen | all three |
| `banded_club` | Banded Club | Verdigris | 1,000 | +15 attack, +180 health | all three |
| `glint_sling` | Glint Sling | Verdigris | 950 | +18 % attack speed, +12 % crit | all three |
| `bellglass` | Bellglass | Verdigris | 900 | +30 power, +10 ability haste | all three |
| `burning_glass` | Burning Glass | Verdigris | 1,050 | +35 power, +8 magic pen | all three |
| `felt_coat` | Felt Coat | Verdigris | 900 | +180 health, +20 armor | all three |
| `linen_hood` | Linen Hood | Verdigris | 950 | +180 health, +22 resist | all three |
| `ironstone_mantle` | Ironstone Mantle | Gloam | 2,100 | +320 health, +48 armor | RIFT · BRIDGE |
| `warning_bell` | Warning Bell | Gloam | 2,100 | +280 health, +44 resist, +8 ability haste | RIFT · BRIDGE |
| `dialcutter` | Dialcutter | Gloam | 2,250 | +32 attack, +240 health, +12 ability haste | RIFT · BRIDGE |
| `shadecut` | Shadecut | Gloam | 2,250 | +40 attack, +14 armor pen, +8 ability haste | RIFT · BRIDGE |
| `splitlight_bow` | Splitlight Bow | Gloam | 2,300 | +32 attack, +20 % crit, +10 % attack speed | RIFT · BRIDGE |
| `focal_lens` | Focal Lens | Gloam | 2,250 | +72 power, +12 ability haste, +0.5 Light regen/s | RIFT · BRIDGE |
| `inkglass_rod` | Inkglass Rod | Gloam | 2,250 | +56 power, +200 health, +8 magic pen | RIFT · BRIDGE |
| `kindly_lamp` | Kindly Lamp | Gloam | 1,900 | +28 power, +8 % heal & shield power, +12 ability haste, +120 health, +0.6 Light regen/s | RIFT · BRIDGE |
| `lampblack_edge` | Lampblack Edge | Gloam | 2,000 | +28 attack, +16 % attack speed, +6 armor pen; one Lampblack piece per fighter | RIFT · BRIDGE |
| `lampblack_coat` | Lampblack Coat | Gloam | 1,950 | +240 health, +24 armor, +20 resist; one Lampblack piece per fighter | RIFT · BRIDGE |
| `lampblack_lens` | Lampblack Lens | Gloam | 2,100 | +56 power, +12 ability haste, +5 magic pen; one Lampblack piece per fighter | RIFT · BRIDGE |
| `quarry_pick` | Quarry Pick | Gloam | 2,150 | +32 attack, +24 % armor pen | RIFT · BRIDGE |
| `deepglass_rod` | Deepglass Rod | Gloam | 2,150 | +56 power, +10 % magic pen, +8 ability haste | RIFT · BRIDGE |
| `glass_veil` | Glass Veil | Gloam | 2,100 | +44 power, +160 health, +20 resist | RIFT · BRIDGE |
| `glintmail` | Glintmail | Gloam | 2,050 | +20 attack, +15 % attack speed, +10 % crit, +15 armor | RIFT · BRIDGE |
| `dawnspur` | Dawnspur | Gloam | 2,250 | +26 attack, +200 health, +12 ability haste, +3 % move speed | RIFT · BRIDGE |
| `resin_maul` | Resin Maul | Gloam | 2,150 | +28 attack, +240 health, +4 % omnivamp | RIFT · BRIDGE |
| `shadowpin` | Shadowpin | Gloam | 2,150 | +24 attack, +20 % attack speed, +12 % crit | RIFT · BRIDGE |
| `bellrope` | Bellrope | Gloam | 1,800 | +220 health, +18 armor, +12 ability haste, +0.4 Light regen/s | RIFT · BRIDGE |
| `almslamp` | Almslamp | Gloam | 1,800 | +24 power, +150 health, +10 ability haste, +6 % heal & shield power | RIFT · BRIDGE |
| `sunstring` | Sunstring | Noonlit | 2,700 | +24 attack, +36 % attack speed, +16 % crit, +5 % life steal; dial 2 | RIFT · BRIDGE |
| `noonglass` | Noonglass | Noonlit | 2,800 | +88 power, +12 ability haste, +12 % magic pen; dial 8 | RIFT · BRIDGE |
| `seatstone` | Seatstone | Noonlit | 2,650 | +480 health, +28 armor, +28 resist, +8 ability haste; dial 12 | RIFT · BRIDGE |
| `hourcleaver` | Hourcleaver | Noonlit | 2,700 | +40 attack, +200 health, +12 ability haste, +4 % omnivamp; dial 4 | RIFT · BRIDGE |
| `shelter_lamp` | Shelter Lamp | Noonlit | 2,400 | +32 power, +12 % heal & shield power, +16 ability haste, +160 health, +16 resist; dial 10 | RIFT · BRIDGE |
| `callstone` | Callstone | Noonlit | 2,500 | +400 health, +24 armor, +24 resist, +8 ability haste; dial 1 | RIFT · BRIDGE |
| `hourstring` | Hourstring | Noonlit | 2,650 | +32 attack, +25 % attack speed, +16 % crit; dial 3 | RIFT · BRIDGE |
| `needlefall` | Needlefall | Noonlit | 2,650 | +40 attack, +250 health, +15 ability haste; dial 5 | RIFT · BRIDGE |
| `stillhour` | Stillhour | Noonlit | 2,500 | +300 health, +32 armor, +32 resist, +8 ability haste; dial 6 | RIFT · BRIDGE |
| `afterlight` | Afterlight | Noonlit | 2,650 | +80 power, +16 ability haste, +0.5 Light regen/s; dial 7 | RIFT · BRIDGE |
| `watchbell` | Watchbell | Noonlit | 2,300 | +32 power, +200 health, +16 ability haste, +8 % heal & shield power; dial 9 | RIFT · BRIDGE |
| `road_sandals` | Road Sandals | boots · Slate | 250 | +0.21 m/s | all three |
| `dust_runners` | Dust Runners | boots · Verdigris | 900 | +0.36 m/s, +19 % attack speed | all three |
| `felt_treads` | Felt Treads | boots · Verdigris | 900 | +0.36 m/s, +10 armor, +10 resist, +10 % tenacity | all three |
| `chalk_slippers` | Chalk Slippers | boots · Verdigris | 800 | +0.36 m/s, +14 ability haste | all three |

Names follow WORLD §4.1: plain English compounds of the Vale's materials and objects (chalk, ochre, felt, linen, lamp, glass, bell, dial, shade, noon), with at most two roots, no possessives and no epithets. The Slate parts are the two sides' materials (Aubade chalk, linen and glass; Serenade ochre, felt and ironstone), so a build reads as gathering from both rims. Every name was grepped against `protected_names.json` and run through `names_check.ts`. Rejected on the way: *Ironstone Buckler* ("Buckler" is a shipped item), *Momentum* (a shipped ability), *Rally Bell* ("Rally" is a shipped spell), and any text containing "true damage".

### 3.1 Build trees

Recipe fees are the total minus the components; every fee is positive. Prices are totals.

**Verdigris** (two Slate parts, fee 170–350):

- **Whetted Knife** 900 — Chalk Knife 350 · Chalk Knife 350 (fee 200)
- **Banded Club** 1,000 — Chalk Knife 350 · Ochre Brick 400 (fee 250)
- **Glint Sling** 950 — Taut Cord 300 · Taut Cord 300 (fee 350)
- **Bellglass** 900 — Glass Lens 420 · Hand Bell 280 (fee 200)
- **Burning Glass** 1,050 — Glass Lens 420 · Glass Lens 420 (fee 210)
- **Felt Coat** 900 — Felt Vest 300 · Ochre Brick 400 (fee 200)
- **Linen Hood** 950 — Linen Wrap 380 · Ochre Brick 400 (fee 170)

**Gloam** (fee 300–800):

- **Ironstone Mantle** 2,100 (fee 300)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
- **Warning Bell** 2,100 (fee 490)
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Linen Wrap 380
  - Hand Bell 280
- **Dialcutter** 2,250 (fee 620)
  - Banded Club 1,000
    - Chalk Knife 350
    - Ochre Brick 400
  - Chalk Knife 350
  - Hand Bell 280
- **Shadecut** 2,250 (fee 450)
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
- **Splitlight Bow** 2,300 (fee 650)
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Chalk Knife 350
  - Chalk Knife 350
- **Focal Lens** 2,250 (fee 650)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Glass Lens 420
  - Lamp Oil 280
- **Inkglass Rod** 2,250 (fee 380)
  - Burning Glass 1,050
    - Glass Lens 420
    - Glass Lens 420
  - Ochre Brick 400
  - Glass Lens 420
- **Kindly Lamp** 1,900 (fee 320)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Lamp Oil 280
  - Ochre Brick 400
- **Lampblack Edge** 2,000 (fee 450)
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Taut Cord 300
  - Chalk Knife 350
- **Lampblack Coat** 1,950 (fee 670)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Linen Wrap 380
- **Lampblack Lens** 2,100 (fee 770)
  - Burning Glass 1,050
    - Glass Lens 420
    - Glass Lens 420
  - Hand Bell 280
- **Quarry Pick** 2,150 (fee 550)
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Chalk Knife 350
  - Chalk Knife 350
- **Deepglass Rod** 2,150 (fee 680)
  - Burning Glass 1,050
    - Glass Lens 420
    - Glass Lens 420
  - Glass Lens 420
- **Glass Veil** 2,100 (fee 730)
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Glass Lens 420
- **Glintmail** 2,050 (fee 800)
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Felt Vest 300
- **Dawnspur** 2,250 (fee 670)
  - Banded Club 1,000
    - Chalk Knife 350
    - Ochre Brick 400
  - Taut Cord 300
  - Hand Bell 280
- **Resin Maul** 2,150 (fee 400)
  - Banded Club 1,000
    - Chalk Knife 350
    - Ochre Brick 400
  - Chalk Knife 350
  - Ochre Brick 400
- **Shadowpin** 2,150 (fee 550)
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Chalk Knife 350
  - Taut Cord 300
- **Bellrope** 1,800 (fee 620)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Hand Bell 280
- **Almslamp** 1,800 (fee 500)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Ochre Brick 400

**Noonlit** (fee 270–570; each stands at a dial hour):

- **Sunstring** 2,700 (fee 450)
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Chalk Knife 350
- **Noonglass** 2,800 (fee 430)
  - Burning Glass 1,050
    - Glass Lens 420
    - Glass Lens 420
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Glass Lens 420
- **Seatstone** 2,650 (fee 400)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Ochre Brick 400
- **Hourcleaver** 2,700 (fee 520)
  - Banded Club 1,000
    - Chalk Knife 350
    - Ochre Brick 400
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Hand Bell 280
- **Shelter Lamp** 2,400 (fee 270)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Lamp Oil 280
- **Callstone** 2,500 (fee 540)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Linen Wrap 380
  - Ochre Brick 400
  - Hand Bell 280
- **Hourstring** 2,650 (fee 500)
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Taut Cord 300
- **Needlefall** 2,650 (fee 570)
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Hand Bell 280
- **Stillhour** 2,500 (fee 370)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Hand Bell 280
- **Afterlight** 2,650 (fee 420)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Burning Glass 1,050
    - Glass Lens 420
    - Glass Lens 420
  - Lamp Oil 280
- **Watchbell** 2,300 (fee 340)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Ochre Brick 400
  - Linen Wrap 380
  - Hand Bell 280

**Boots** (one pair at a time; W4 re-key prices): Road Sandals 250, then one of these (Dust Runners 900, Felt Treads 900, Chalk Slippers 800; the fees below are the pre-re-key ones):

- **Dust Runners** 1,050: Road Sandals + fee 750
- **Felt Treads** 1,100: Road Sandals + fee 800
- **Chalk Slippers** 1,050: Road Sandals + fee 750

## 4. Passives and actives

Every passive and active uses only `PassiveDef` triggers and `AbilityDef` effects in the DSL; there are no scripts. The text in `desc` states the same numbers. Every effect below was seen firing in the sim (probe §7).

| item | trigger | effect |
|---|---|---|
| Notched Blade · *Keep Fed* | `kill` of a Wick or monster | heal 8 |
| Reading Lens · *Steady Glow* | `abilityHit` on a fighter, 6 s cooldown | heal 10 + 1/level |
| Ironstone Guard · *Brace* | `damageTaken` from a fighter, 10 s cooldown | shield 20 + 4/level for 2 s |
| Grove Sickle · *Grove Work* | `attackHit` on a monster | +20 + 3/level magic damage, heal 6 + 1/level |
| Ironstone Mantle · *Stone Patience* | `damageTaken` from a fighter, every 0.5 s at most | +4 armor and +4 resist for 4 s, up to 5 stacks (`buff.maxStacks`) |
| Warning Bell · *Alarm* | `damageTaken` from a fighter, every 0.4 s at most; a counter that resets after 3 s without a hit | 6th hit: enemies within 4 m take 30 + 4 % bonus health magic damage and are slowed 30 % for 1.5 s |
| Dialcutter · *Gathering Pace* | `abilityCast` | +6 attack and +3 % move speed for 5 s, up to 4 stacks |
| Shadecut · *Cut Short* | `damageDealt` to a fighter below 40 %, 6 s per target | +20 + 8 % of missing health physical damage |
| Splitlight Bow · *Count of Three* | `attackHit`, counter 3 within 4 s | +15 + 35 % bonus attack physical damage; this extra hit can crit |
| Focal Lens · *Burning Point* | `abilityHit` on a fighter, 8 s per target | +40 + 3/level + 15 % power magic damage |
| Inkglass Rod · *Ink Shade* | `abilityHit` on a fighter | resist shred 15 % for 4 s |
| Kindly Lamp · *Kind Light* | `abilityCast`, 6 s cooldown | you and allied fighters within 6 m: +15 % move speed and a 20 + 4/level shield for 2 s |
| Sunstring · *Noon Glare* | `attackHit` | +15 + 2.5 % of current health magic damage (×0.6 on Wicks and monsters) |
| Noonglass · *Gather Light* | `abilityHit` on a fighter, one mark per 0.25 s | mark for 6 s, max 3; the 3rd bursts for 50 + 20 % power + 4 % max health magic damage |
| Seatstone · **Hold Ground** (active, 60 s) | cast, 0.2 s wind-up | shield 12 % max health for 3 s; after 0.4 s (telegraphed to everyone) enemies within 4.5 m take 50 + 4 % bonus health magic damage, slowed 40 % fading over 2 s |
| Hourcleaver · *Last Hour* | `lowHp` below 35 %, 60 s cooldown | shield 100 + 35 % bonus health and +30 % tenacity for 3 s |
| Shelter Lamp · **Shelter** (active, 75 s) | cast, 0.15 s wind-up | you and allied fighters within 7 m: shield 60 + 10/level + 25 % power for 2.5 s |
| Lampblack Edge · *Black Sap* (W4 G7) | `damageDealt` to a fighter, a soot mark for 4 s (max 2) | the second hit within 4 s: Wounded 50 % for 3 s (`grievous`) |
| Lampblack Coat · *Soot Ring* (W4 G7) | `interval` 1 s | enemy fighters within 4 m: Wounded 30 % for 1.5 s |
| Lampblack Lens · *Held Sap* (W4 G7) | `statusApplied` to a fighter that is slowed, rooted, stunned, asleep, afraid, silenced, taunted or lifted; 1 s per target | Wounded 50 % for 4 s |
| Quarry Pick · *Split the Stone* (W4 G7) | `damageDealt` to a fighter above 60 %, 4 s per target | +10 + 3.5 % of its max health physical damage |
| Deepglass Rod · *Weight of Light* (W4 G7) | `abilityHit` on a fighter, 6 s per target | +20 + 4 % of its max health magic damage |
| Glass Veil · *Settling Glass* (W4 G7) | `damageTaken` from a fighter, 18 s cooldown | shield 70 + 10/level + 20 % power and +15 armor and resist for 2.5 s |
| Glintmail · *Set Against* (W4 G7) | `damageTaken` from a fighter, 18 s cooldown | shield 60 + 10/level + 30 % attack and +15 armor and resist for 2.5 s |
| Dawnspur · *First Light* (W4 G7) | `damageDealt` to a fighter, 8 s per target | +30 + 3/level + 30 % bonus attack physical damage and a 30 % slow for 1 s |
| Resin Maul · *Warm Through* (W4 G7) | `abilityHit` on a fighter, 3 s cooldown | heal 12 + 2/level + 1.5 % max health |
| Shadowpin · *Pin the Shadow* (W4 G7) | `attackHit` on a fighter, a mark for 4 s (max 4) | the fourth: +20 + 30 % bonus attack physical damage and a 40 % slow for 1 s |
| Bellrope · *Toll Together* (W4 G7) | `statusApplied` hard CC (stun, root, lift, taunt, sleep, fear) on a fighter, 8 s cooldown | you and allied fighters within 7 m: shield 30 + 6/level for 2.5 s and +20 % move speed for 1.5 s |
| Almslamp · *Shared Light* (W4 G7) | `takedown` of an enemy fighter (kill or assist) | +35 Gleam |
| Callstone · **Call Out** (active, 70 s; W4 G7) | cast, 0.15 s wind-up, telegraphed | enemy fighters within 4 m are taunted for 0.75 s; +30 armor and resist for 2.5 s |
| Hourstring · *Strike the Hour* (W4 G7) | `attackHit` on a fighter, counter 12 within 8 s of the last | the twelfth: enemies within 3 m of the target take 60 + 6/level + 6 % of their max health magic damage and a 30 % slow for 1 s |
| Needlefall · *Falling Shadow* (W4 G7) | `takedown` of an enemy fighter | ability cooldowns −30 % of what is left, +30 % move speed for 2 s |
| Stillhour · **Hold the Hour** (active, 80 s; W4 G7) | cast | you are rooted for 1.5 s with +80 armor and resist; you can still attack and cast (bots never cast it while retreating) |
| Afterlight · *Light Lands Twice* (W4 G7) | `abilityHit` on a fighter, 5 s per target | 1 s later, where it stood (telegraphed): 35 + 4/level + 20 % power magic damage within 2.5 m |
| Watchbell · *Watch Hour* (W4 G7) | `interval` 10 s | enemy fighters within 9 m: revealed for 3 s and slowed 15 % for 1 s |
| Sap Flask (active) | drink | heal 25 at once and every second after: 150 over 5 s |
| Spare Lamp (active) | point within 7 m | a `hooded_lamp` ward for 3:20 (7.5 m sight, hidden); 2 per owner, a 3rd puts out the oldest (`summon.maxAlive`) |
| Noon Tonic (active, 6 s) | drink | heal 70 + 6 % max health at once and +25 % move speed for 2 s |

Why these mechanics:

- **Tanks are rewarded for being hit.** Mantle stacks defenses. Bell rings after six fighter hits, which punishes focusing the front line.
- **Bruisers are rewarded for casting**, with Dialcutter's stacks.
- **Strikers finish targets**, with Shadecut's missing-health bonus.
- **Slingers get a rhythm**: Splitlight's third hit, then Sunstring's percent damage on every hit for tanky targets.
- **Casters get burst or team value.** Focal Lens adds a first-hit spike. Inkglass Rod shreds resist for the whole team. Noonglass adds a three-hit burst.
- **Tenders turn every cast into team speed and shields**, with Kindly Lamp, then add a team-wide shield with Shelter Lamp.

There is no crit trigger condition, so the crit item rewards attack cadence. There is no damage-amplify op, so Hairline (§7) uses shred instead.

## 5. Pools

| pool | items | rule |
|---|---|---|
| `rift` | 56 | everything except the FRAY tonic |
| `bridge` | 52 | no starters and no jungle item, no FRAY tonic |
| `fray` | 12 | the 7 Verdigris pieces, the 4 boots and the Noon Tonic |

**BRIDGE.** (W4 re-key) Fighters start at level 2 with 1,050 Gleam and can't recall. The mode has no starters and no jungle. A BRIDGE opening is a Verdigris piece plus flasks (980–1,040); boots come later. Shopping is at base, while dead, or within 6 m of one of your own standing Needles (`shopAccess: needles`), so the shop retreats toward home as your Needles fall.

**FRAY is the lighter loadout.** It has 12 items, no wards (nobody has a side to light the map for), no starters, no Gloam or Noonlit, and every recipe is one step deep. The cart sells **finished pieces only**: Verdigris pieces and boots, all under 1,100 Gleam.

- *Why finished pieces.* FRAY lasts 8–11 minutes, and the one Lampwright cart stands in the open at the plate's centre, so every shopping stop is a risk. With finished pieces each stop completes something, and nobody carries half-built parts.
- *Openings and full bags.* The 1,400 starting Gleam buys boots, one piece and a tonic. A player earns about 400 Gleam a minute (4/s passive, kills at 200, Gleam Sunmotes), so a piece arrives every 2–3 minutes. The leader fills a 6-slot bag (5,750–5,900 Gleam) at about 10–11 minutes.
- *Why no Slate parts.* Without them the cart stays readable, at 12 tiles instead of 20. It also stops the bots' fallback planner, which picks the most efficient `basic` items when a pool has no `core`, from filling bags with single-stat parts.

`rift` and `bridge` are closed under components: every part of a pool item can be bought on its own in that pool. `fray` deliberately is not; the shop prices missing parts into the purchase.

## 6. Class builds and timelines

These are the reference builds per class, checked by the probe for pool, slots, uniqueness, boots, one Noonlit and the class's needs, and bought step by step in the sim:

| class | needs (probe) | RIFT / BRIDGE full build | Gleam |
|---|---|---|---|
| Plinth | health, armor, resist | Felt Treads · Ironstone Mantle · Warning Bell · **Seatstone** · Dialcutter · Kindly Lamp | 11,900 |
| Breaker | attack, health | Felt Treads · Dialcutter · **Hourcleaver** · Shadecut · Ironstone Mantle · Warning Bell | 12,300 |
| Striker | attack, armor pen | Felt Treads · Shadecut · **Needlefall** · Dialcutter · Quarry Pick · Warning Bell | 12,300 |
| Slinger | attack speed, crit, on-hit | Dust Runners · Splitlight Bow · **Sunstring** · Shadecut · Dialcutter · Warning Bell | 12,500 |
| Caster | power, haste, penetration | Chalk Slippers · Focal Lens · **Noonglass** · Inkglass Rod · Warning Bell · Kindly Lamp | 12,100 |
| Tender | heal & shield power, haste, power | Chalk Slippers · Kindly Lamp · **Shelter Lamp** · Warning Bell · Ironstone Mantle · Focal Lens | 11,550 |

| class | RIFT opening (480) | BRIDGE opening (1,300) | FRAY full bag | Gleam |
|---|---|---|---|---|
| Plinth | Ironstone Guard + Sap Flask | Road Sandals, Felt Coat, Sap Flask | Felt Treads · Felt Coat ×2 · Linen Hood ×2 · Banded Club | 5,800 |
| Breaker | Notched Blade + Sap Flask | Road Sandals, Banded Club | Felt Treads · Banded Club ×2 · Whetted Knife · Felt Coat · Linen Hood | 5,850 |
| Striker | Notched Blade + Sap Flask | Road Sandals, Whetted Knife, 2 Sap Flasks | Felt Treads · Whetted Knife ×2 · Banded Club ×2 · Linen Hood | 5,850 |
| Slinger | Notched Blade + Sap Flask | Road Sandals, Glint Sling, Sap Flask | Dust Runners · Glint Sling ×3 · Whetted Knife · Banded Club | 5,800 |
| Caster | Reading Lens + Sap Flask | Road Sandals, Bellglass, 2 Sap Flasks | Chalk Slippers · Bellglass ×2 · Burning Glass ×2 · Linen Hood | 5,900 |
| Tender | Ironstone Guard + Sap Flask | Road Sandals, Bellglass, Spare Lamp | Chalk Slippers · Bellglass ×2 · Felt Coat · Linen Hood · Burning Glass | 5,750 |

The jungle opening is Grove Sickle + 2 Sap Flasks (450). FRAY builds don't ask for on-hit or heal and shield power: there is no Noonlit to carry on-hit and no ally to heal.

**Timelines.** The estimates use the economy in `modes_economy.md` §2.

**RIFT laner** (W4 G7 economy, measured by the bot soak `fw_W4_soak_g7_final`): about 7,700–8,900 Gleam earned by play at 25:00 (or the end), about 340 a minute, plus the 480 start:

| | what the bots hold |
|---|---|
| 7–10 min | boots and the first Gloam (a starter folds in) |
| 15–20 min | the second finished piece |
| 22–25 min | the third finished piece; the boots upgrade after it |

A full build is 11,550–12,500 Gleam, so most matches (22–28 min) end on three finished pieces plus boots: 2.6–3.0 per laner at min(25:00, end) in the soak.

**Tender**, about 6,200–6,500 Gleam by 25:00 from passive Gleam and assists. The Lampglass path is the cheapest (Bellrope and Almslamp 1,800, Kindly Lamp 1,900, Watchbell 2,300, Shelter Lamp 2,400), and Almslamp pays 35 Gleam per takedown: 2.3–2.5 finished pieces at min(25:00, end). The Grovehunter sits lowest (1.8–1.9), because the jungle is still about six levels behind (gameplay G2).

**BRIDGE**, about 375 Gleam a minute. A fighter has about 7,600 Gleam at 17:00, which buys upgraded boots, two Gloam and a Verdigris piece. Only the richest fighters reach a Noonlit.

## 7. The setup layer (`setup.json`)

Before a match each player takes **two Hour spells** and, in RIFT and BRIDGE, **two boons from one path**. That's the whole pre-match layer. It has no pages, tiers or secondary trees, and it takes about 10 seconds in the loadout screen.

### 7.1 Hour spells (`spellSlots: 2`)

Spells have no cost and one rank. They scale with your level through the `level` ratio. Ability haste never shortens them (CONTRACT §5.3).

| id | Name | job | effect | cooldown | pools |
|---|---|---|---|---|---|
| `glint_step` | Glint Step | escape | blink up to 4.5 m toward the point; **your shadow stays where you stood** for 2.5 s and slows enemy fighters who step into it by 30 % for 1 s | 210 s | all |
| `saplight` | Saplight | sustain | a 3 m pool of sap-light at your feet for 4 s: you and allied fighters standing in it heal 4 % of max health each second | 200 s | all |
| `hairline` | Hairline | offense | an enemy fighter within 6 m takes 20 + 8/level damage that ignores armor and resist, plus 20 % armor and resist shred and 30 % weaker healing for 4 s | 140 s | all |
| `hourstrike` | Hourstrike | jungle | a monster or Wick (never a fighter) within 5 m takes 250 + 15/level **+ 12 % of its current health** damage that ignores armor and resist (the fuller it is, the harder it lands: an opener, not a finisher); you heal 4 % of max health | 3 charges, one per 70 s (10 s between uses) | RIFT |
| `running_light` | Running Light | haste | +60 % move speed fading over 4 s | 150 s | all |
| `shake_loose` | Shake Loose | cleanse | breaks roots; immune to stuns, roots and knockbacks for 1 s; +30 % move speed for 2 s (no tenacity) | 150 s | RIFT · BRIDGE |
| `glass_pane` | Glass Pane | shield | shield 50 + 12/level for 4 s; as it sets, enemy fighters within 3 m are slowed 25 % for 1.5 s | 130 s | all |
| `calling_bell` | Calling Bell | team / vision | you and allied fighters within 7 m +20 % move speed for 3 s; enemy fighters within 9 m revealed for 4 s | 150 s | RIFT · BRIDGE |

There are 8 spells in RIFT, 7 in BRIDGE and 5 in FRAY (Glint Step, Saplight, Hairline, Running Light, Glass Pane). FRAY drops the team spell, which has no teammates there, the jungle spell, and the cleanse, to keep its loadout short.

**Defaults:** Glint Step and Glass Pane (W4 re-key: VALE's own pair, a shadow-leaving step and a setting pane; no heal, so never the genre's blink + heal), both legal in every pool.

**Hourstrike is recommended for the Grovehunter, not required.**

- *Why not required.* The Grove Sickle starter makes clearing camps efficient (§4), so a jungler without Hourstrike can still farm. Hourstrike (W4 re-key) opens camps and objectives rather than securing them: on a full monster it lands 250 + 15/level + 12 % of the monster's health, on a nearly dead one little more than the flat part, so last-second steals lean on the team, not the spell.
- *Why that is enough.* The reference genre forces its jungle spell *(r02 §1, "jungle gating")*. We keep the choice open because the role assignment already keeps laners out of the Dialwood.
- *For SESSION.* Suggest Hourstrike + Glint Step for a Grovehunter's first loadout.
- *For UI.* Show a soft "No Hourstrike" note in the draft, not a block.

**The cleanse.** The sim refuses every cast, spells included, while a fighter is stunned, airborne, asleep, taunted or feared. Shake Loose therefore can't break those controls, and it says so in its text. It breaks roots through the `unstoppable` status and ignores new hard control for 1 s (W4 re-key: no tenacity tail). A cleanse for hard control needs a SIM change (§10).

### 7.2 Boons (`boonSlots: 2`) and paths

| path | colour | identity | boons |
|---|---|---|---|
| **Shadeline** `shadeline` | `#8C86C8` (the Standing Shadow's violet-cool) | strike first, finish fights | **First Cut**: your first damage to an enemy fighter adds 12 + 3/level damage that ignores armor and resist (10 s per fighter) · **Keen Edge**: 6 % armor and magic penetration · **Next Hour**: on a takedown, ability cooldowns drop by 20 % of what is left and +25 % move speed for 2 s |
| **Warmstone** `warmstone` | `#C9905E` (ochre that holds heat) | stay standing | **Dense Stone**: +50 health and +10 per level after the first (220 at 18) · **Second Shadow**: below 35 % health, a 50 + 14/level shield for 3 s (75 s) · **Slow Heat**: below 60 % health, heal 3 + 1 % max health every 4 s |
| **Hourturn** `hourturn` | `#6FB7D6` (clear morning sky) | move and cast more often | **Quick Hour**: +6 ability haste, +0.4 per level after the first (12.8 at 18) · **Long Stride**: +4 % move speed · **Echo Bell**: every 4th ability cast, each within 20 s of the last, takes 1.5 s off all ability cooldowns |

Path colours sit at least 60 RGB units away from every readability colour and from brand-gloam (probe-checked). Path icons are `assets/ui/icons/paths/<id>.svg`; spell and boon icons are `assets/ui/icons/setup/<id>.svg`.

**The rule: two boons, both from one path.** A player picks a path, which is the identity, then 2 of its 3 boons. That gives 9 possible loadouts. The rule comes from the design, not from LoL's primary-plus-secondary rune trees, and it keeps the screen to one choice and then two toggles.

- *Not enforced in the sim.* The sim checks only pools, duplicates and slot counts (`effectiveLoadout`). A mixed pair is therefore legal there.
- *Balanced per boon.* Each boon is balanced on its own, so a mixed pair is never stronger than its two halves. If enforcement slips, nothing breaks.
- *Enforcement* belongs to SESSION and UI (§10).

**Defaults:** Dense Stone and Second Shadow (Warmstone), the safe pair for a new player.

**FRAY has no boons.** Every boon's pools are `rift` and `bridge`.

- *Why none.* FRAY starts at level 6 with an ultimate ready and lasts about 10 minutes, so its loadout is two spells and nothing else.
- *How the session handles it.* It fills the boon slots from the pool, which is empty, so FRAY seats carry none.

## 8. Calibration notes

| system | reference *(r0N)* | Vale |
|---|---|---|
| lane starters | about 400–500, bought with the start purse *(r02 §11)* | 430 + a 50 flask = exactly the RIFT purse of 480; jungle 350 + 2 flasks |
| mid components | "epic" 1,000–1,500 *(r02 §11)* | Verdigris 900–1,050 (two stats, cheaper, so FRAY can use them as finished pieces) |
| finished items | 2,500–3,300 *(r02 §11)* | Gloam 1,800–2,300, Noonlit 2,300–2,800 (W4 G7: about 20 % under the reference, so three finish by 25:00) |
| full build | 5–6 completed items at 35–40 min *(r02 §11)* | about 42 min for boots + 5; three items + boots at 25 min |
| sell-back | about 70 % *(r02 §11)* | 70 % (schema default); consumables 40 % so a flask is not a bank |
| boots | three tiers *(r02 §11)* | two: one base pair and three upgrades; no third tier, fewer steps for a browser match |
| support income | quest-style support item *(r02 §1)* | Tenders live on passive Gleam and assists; the Lampglass path is the cheapest, and Almslamp adds 35 Gleam per takedown (W4 G7) |
| single-lane mode | no starters, buy only when dead, mode-only spells *(r03 §2.1)* | BRIDGE: no starters, base or dead shopping, no jungle spell; no mode-only gap-closer (r03 lists the reference's as protected) |
| FFA mode | item drops that favour trailing players *(r03 §4a)* | FRAY: finished pieces at one cart, Gleam Sunmotes (flat 120 matters more to a trailing player) |
| Hour spells | two long-cooldown utility spells, a forced jungle spell *(r02 §11)* | two slots, 90–300 s; the jungle spell is optional (§7.1) |
| pre-match passives | primary + secondary tree, keystones, shards *(r02 §11)* | two boons from one of three paths |

## 9. Verification

`node _harness/probe_items.ts` checks the following.

**As data:**

1. **Schema.** zod strict parse of every item and the setup record.
2. **Catalog.**
   - Unique ids and names; frame counts.
   - Recipes: every component exists, every fee is positive, there are no cycles, and each frame is built from the frame below it.
   - Uniqueness groups.
   - Stat descs: every stat value appears in its item's text.
   - References: VOCAB vfx and cue ids, summoned unit kinds, unique ability and passive ids.
   - Text: the deny-list across 158 names and texts, and no exclamation marks.
   - The efficiency bands.
3. **Pools.**
   - Each pool is non-empty, and RIFT sells everything except FRAY-only items.
   - BRIDGE has no starters and no jungle item.
   - The FRAY rules: no wards, one-step recipes, every piece under 2,500, 10–16 items.
   - RIFT and BRIDGE are closed under components.
4. **Setup.**
   - The spells cover the seven jobs, and every cooldown is 90–300 s.
   - 3 paths × 3 boons, with 2 + 2 slots.
   - The defaults are legal, FRAY is lighter, and the path colours are clear of the readability colours.
5. **Class builds**, per pool and per class, as in §6.

**In the real sim**, with a fixture fighter per class and the real items, setup, units, modes and queues on stub maps:

6. **Shop.** Each of the 18 builds is bought part by part: 6 purchases for a FRAY bag and 30–33 for a RIFT or BRIDGE build, counting the rebuy after each undo.
   - *Prices.* An independent model of the recipe price, the sim's `quoteBuy` and the Gleam actually spent agree on every purchase. One Gleam short is refused with `gold`.
   - *Undo.* Undoing a recipe brings back its parts and the Gleam exactly.
   - *Sells.* A sell refunds `floor(cost × sellRatio × charges)`, and undoing a sell restores the item.
   - *Refusals.* An out-of-pool item is refused with `pool`. A second boots upgrade or Noonlit is refused with `unique`.
   - *Wiring.* The bag's stat sum and passives reach the fighter.
   - *Other cases.* The jungle opening, a second starter, and undo cleared on leaving the shop.
7. **Effects.** Every passive, active and consumable in §4 fires with the right numbers.
8. **Loadouts.**
   - `effectiveLoadout` keeps Hourstrike in RIFT and drops it elsewhere, and drops boons in FRAY.
   - Every spell is cast once and checked:
     - Glint Step moves 4.5 m.
     - Saplight heals you and an ally by the right amounts.
     - Hairline's damage and debuffs land.
     - Hourstrike refuses a fighter, strikes a monster and spends a charge.
     - Running Light fades.
     - Shake Loose breaks a root, and is refused while stunned.
     - Glass Pane's shield is the right size.
     - Calling Bell hastes the ally and reveals the enemy.
   - Every boon's stats and triggers are checked.
9. **Bots.** The real bots (`src/sim/bots`) shop in all three pools with no out-of-pool purchase, no `pool` refusal and no faults.

The real content build also passes: `tools/build_content.ts --check` on a temporary tree, with 0 errors (only missing-icon warnings). It passes with the stub maps and with the MAPS lane's real `content/maps/*.json` as of 14:36. `probe_content_ids` stays clean (no item id in `src/`).

**One-off run on the real maps** (scratch script; real bots, real items, fixture fighters):

- FRAY: 9 of 10 bots shop at the cart.
- BRIDGE: 6 of 10 bots shop.
- RIFT: **0 of 10 bots shop in 7 minutes**, because they never walk to the shop circle (§10, MAPS / BOTS).

The probe keeps its own stub maps, so the item checks don't depend on another lane's work in progress.

## 10. Notes for other lanes

- **UI**
  - Derive the frame from `tier` and `components` (§1).
  - Use the stat words in §2.
  - Loadout screen:
    - Pick a path, then 2 of its 3 boons.
    - Show each Noonlit item's dial hour on its frame and the 4-hour rule on its tooltip (the item `desc` already says it; W4 re-key).
    - Grovehunter: a soft note when Hourstrike is missing.
  - FRAY's cart lists 12 tiles.
- **SESSION**
  - Enforce the one-path rule in `sanitizeLoadout` / `loadoutValid`. If the two boons come from different paths, keep the first and fill from its path.
  - Suggest Hourstrike + Glint Step as a Grovehunter's first loadout.
- **BOTS**
  - `buildPlan.ward` ignores consumables, so bots never buy the Spare Lamp, which is a consumable on purpose. A Tender bot could buy one or two on its first trip.
  - `pickLoadout` gives same-path boons only a +2 bias. Make it a hard rule.
  - In FRAY the bots' fallback planner (no `core` in the pool) picks Verdigris pieces, which is the intended bag.
- **SIM**
  1. *Resource semantics per model.*
     - `res` stats raise the max of Heat and Tally bars too, so items avoid `res`.
     - A positive `resource` op adds Heat to a Heat fighter. This also affects the Mending Sunmote grant in `units.json` (60 + 12 % pool), which today fills a Heat bar.
     - The request: `res` and `resource` should apply only to `pool` resources, or `resource` should vent Heat.
  2. *A real cleanse* needs an optional `AbilityDef` flag that lets an Hour spell be cast while stunned, together with a status-removal op. Shake Loose would then become a full cleanse.
  3. *A crit trigger condition* (`attackHit` with `crit`) and *a damage-taken amplifier op* would allow richer crit and offensive designs. Neither is needed now.
- **MAPS / BOTS (found while testing)**
  - *The problem.* On the real `map_rift` and `map_bridge`, the base shop circle (radius 3 m) sits 7.6–7.9 m from both the spawn point and the fountain circle. `shopAccess: base` needs the fighter inside that circle, and the bots never walk to it: in a 7-minute RIFT run on the real map no bot bought anything, not even its starter. A human must also walk about 8 m after every recall before shopping.
  - *The fix,* one of:
    - MAPS widens or moves the shop circle so that it covers the spawn and the fountain. The reference genre lets you shop anywhere in the fountain area.
    - BOTS makes the shopping mode walk into `bases[].shop` before buying.
- **CONTENT (fighter kits)**
  - Write "damage that ignores armor and resist", never "true damage" (deny-list).
  - Kits that rely on `res` or a `resource` restore should check §2 first.
- **ICONS** (UI icon lane), all SVG:
  - 39 item icons at `assets/ui/icons/items/<id>.svg`. Item passives and actives reuse their item's icon.
  - 17 spell and boon icons at `assets/ui/icons/setup/<id>.svg`.
  - 3 path icons at `assets/ui/icons/paths/<id>.svg`.
- **VOCAB**: no new ids. Everything uses the `lib_*` presets and the existing cues.
