# Items and the setup layer (content lane, 2026-10-07)

What `content/items.json` and `content/setup.json` define, and why. Both are generated as plain JSON that parses with `ItemDef` / `SetupDef` in `src/contracts/catalog.ts` (strict keys), and both are checked by **`_harness/probe_items.ts`** (133 checks, all passing), which also plays every build through the real sim shop and casts every active, spell and boon. The real `tools/build_content.ts --check` passes with **0 errors** on a temporary tree made of the `content_min` fixture, every real content family, these two files and stub `map_rift` / `map_bridge` / `map_fray` maps. The only warnings are icon files that do not exist yet. Every name and text passes `tools/names_check.ts`.

Numbers marked *(r0N)* were calibrated against `_design/research/r0N_*.md`. They are references, not copies; every name, effect and number here is our own choice.

---

## 1. Shape of the catalog

**39 items** in four hour-tick frames, plus starters, consumables and boots.

| frame (hour-ticks) | schema `tier` | count | price | what it is |
|---|---|---|---|---|
| Slate (1) | `starter` | 4 | 350–430 | one road start per broad style, plus the jungle start (RIFT only, one per fighter) |
| Slate (1) | `consumable` | 3 | 50–75 | a heal flask, a ward, a FRAY tonic |
| Slate (1) | `basic`, no components | 8 | 280–420 | **one stat** each; the parts everything is built from |
| Verdigris (2) | `basic` with components | 7 | 900–1,050 | **two stats**, built from two Slate parts; FRAY's finished pieces |
| Gloam (3) | `core` | 8 | 2,400–2,900 | stats + **one distinct triggered passive**; unique per fighter |
| Noonlit (4) | `apex` | 5 | 3,000–3,500 | stats + a **strong passive or active**; **one Noonlit per fighter** |
| boots | `boots` | 1 + 3 | 300 / 1,050–1,100 | a Slate base pair and three Verdigris upgrades |

**Frame rule for the UI** (the schema has no frame field, so it is derived): `core` → Gloam, `apex` → Noonlit, `basic` or `boots` **with** components → Verdigris, everything else → Slate. Frame colours and tick counts come from `tokens.json` (`slate`, `verdigris`, `gloam`, `noonlit` + glow).

**Uniqueness.** Starters share `starter`, boots share `boots`, every Noonlit shares `noonlit` (the noon is one hour: you carry one), and each Gloam item is its own group, so its passive never doubles. Slate and Verdigris pieces stack freely.

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

Efficiency bands, checked by the probe: Slate 95–105 % (they are 96–100 %), Verdigris 88–105 % (94–101 %), Gloam 75–102 % (85–97 %; the passive pays the rest), Noonlit 80–102 % (90–101 %), boots upgrades 90–110 %. Lane starters are 108–116 % because they never build into anything. The Grove Sickle is all passive.

**No `res` stat and no `resource` restore on items.** The sim adds `res` to the max of *any* resource model. +300 would quadruple a Heat bar (100 max) and triple a Tally bar. A `resource` restore adds Heat to a Heat fighter. Items therefore use `resRegen` only: it refills a Light pool, does nothing for Heat and is negligible for Tally (it decays). See §10.

## 3. The catalog

| id | Name | Frame | Gleam | Stats | Pools |
|---|---|---|---|---|---|
| `notched_blade` | Notched Blade | starter · Slate | 430 | +8 attack, +80 health | RIFT |
| `reading_lens` | Reading Lens | starter · Slate | 430 | +12 power, +60 health, +0.25 Light regen/s | RIFT |
| `ironstone_guard` | Ironstone Guard | starter · Slate | 430 | +120 health, +1.2 health regen/s | RIFT |
| `grove_sickle` | Grove Sickle | starter · Slate | 350 | +0.8 health regen/s | RIFT |
| `sap_flask` | Sap Flask | consumable | 50 | — (5 per slot) | RIFT · BRIDGE |
| `spare_lamp` | Spare Lamp | consumable | 75 | — (2 per slot) | RIFT · BRIDGE |
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
| `ironstone_mantle` | Ironstone Mantle | Gloam | 2,600 | +400 health, +60 armor | RIFT · BRIDGE |
| `warning_bell` | Warning Bell | Gloam | 2,650 | +350 health, +55 resist, +10 ability haste | RIFT · BRIDGE |
| `dialcutter` | Dialcutter | Gloam | 2,800 | +40 attack, +300 health, +15 ability haste | RIFT · BRIDGE |
| `shadecut` | Shadecut | Gloam | 2,800 | +50 attack, +18 armor pen, +10 ability haste | RIFT · BRIDGE |
| `splitlight_bow` | Splitlight Bow | Gloam | 2,900 | +40 attack, +25 % crit, +12 % attack speed | RIFT · BRIDGE |
| `focal_lens` | Focal Lens | Gloam | 2,800 | +90 power, +15 ability haste, +0.6 Light regen/s | RIFT · BRIDGE |
| `inkglass_rod` | Inkglass Rod | Gloam | 2,800 | +70 power, +250 health, +10 magic pen | RIFT · BRIDGE |
| `kindly_lamp` | Kindly Lamp | Gloam | 2,400 | +35 power, +10 % heal & shield power, +15 ability haste, +150 health, +0.8 Light regen/s | RIFT · BRIDGE |
| `sunstring` | Sunstring | Noonlit | 3,400 | +30 attack, +45 % attack speed, +20 % crit, +6 % life steal | RIFT · BRIDGE |
| `noonglass` | Noonglass | Noonlit | 3,500 | +110 power, +15 ability haste, +15 % magic pen | RIFT · BRIDGE |
| `seatstone` | Seatstone | Noonlit | 3,300 | +600 health, +35 armor, +35 resist, +10 ability haste | RIFT · BRIDGE |
| `hourcleaver` | Hourcleaver | Noonlit | 3,400 | +50 attack, +250 health, +15 ability haste, +5 % omnivamp | RIFT · BRIDGE |
| `shelter_lamp` | Shelter Lamp | Noonlit | 3,000 | +40 power, +15 % heal & shield power, +20 ability haste, +200 health, +20 resist | RIFT · BRIDGE |
| `road_sandals` | Road Sandals | boots · Slate | 300 | +0.25 m/s | all three |
| `dust_runners` | Dust Runners | boots · Verdigris | 1,050 | +0.42 m/s, +25 % attack speed | all three |
| `felt_treads` | Felt Treads | boots · Verdigris | 1,100 | +0.42 m/s, +12 armor, +12 resist, +15 % tenacity | all three |
| `chalk_slippers` | Chalk Slippers | boots · Verdigris | 1,050 | +0.42 m/s, +10 ability haste, +8 magic pen | all three |

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

**Gloam** (fee 800–1,250):

- **Ironstone Mantle** 2,600 (fee 800)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
- **Warning Bell** 2,650 (fee 1,040)
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Linen Wrap 380
  - Hand Bell 280
- **Dialcutter** 2,800 (fee 1,170)
  - Banded Club 1,000
    - Chalk Knife 350
    - Ochre Brick 400
  - Chalk Knife 350
  - Hand Bell 280
- **Shadecut** 2,800 (fee 1,000)
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
- **Splitlight Bow** 2,900 (fee 1,250)
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Chalk Knife 350
  - Chalk Knife 350
- **Focal Lens** 2,800 (fee 1,200)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Glass Lens 420
  - Lamp Oil 280
- **Inkglass Rod** 2,800 (fee 930)
  - Burning Glass 1,050
    - Glass Lens 420
    - Glass Lens 420
  - Ochre Brick 400
  - Glass Lens 420
- **Kindly Lamp** 2,400 (fee 820)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Lamp Oil 280
  - Ochre Brick 400

**Noonlit** (fee 870–1,220; one per fighter):

- **Sunstring** 3,400 (fee 1,150)
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Glint Sling 950
    - Taut Cord 300
    - Taut Cord 300
  - Chalk Knife 350
- **Noonglass** 3,500 (fee 1,130)
  - Burning Glass 1,050
    - Glass Lens 420
    - Glass Lens 420
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Glass Lens 420
- **Seatstone** 3,300 (fee 1,050)
  - Felt Coat 900
    - Felt Vest 300
    - Ochre Brick 400
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Ochre Brick 400
- **Hourcleaver** 3,400 (fee 1,220)
  - Banded Club 1,000
    - Chalk Knife 350
    - Ochre Brick 400
  - Whetted Knife 900
    - Chalk Knife 350
    - Chalk Knife 350
  - Hand Bell 280
- **Shelter Lamp** 3,000 (fee 870)
  - Bellglass 900
    - Glass Lens 420
    - Hand Bell 280
  - Linen Hood 950
    - Linen Wrap 380
    - Ochre Brick 400
  - Lamp Oil 280

**Boots** (one pair at a time): Road Sandals 300, then one of these:

- **Dust Runners** 1,050: Road Sandals + fee 750
- **Felt Treads** 1,100: Road Sandals + fee 800
- **Chalk Slippers** 1,050: Road Sandals + fee 750

## 4. Passives and actives

Every passive and active uses only `PassiveDef` triggers and `AbilityDef` effects in the DSL; there are no scripts. The text in `desc` states the same numbers. Every effect below was seen firing in the sim (probe §7).

| item | trigger | effect |
|---|---|---|
| Notched Blade · *Keep Fed* | `kill` of a Wick or monster | heal 6 |
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
| Sap Flask (active) | drink | heal 12 at once and every second after: 120 over 9 s |
| Spare Lamp (active) | point within 7 m | a `hooded_lamp` ward for 2:30 (9 m sight, hidden); 3 per owner, a 4th puts out the oldest (`summon.maxAlive`) |
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
| `rift` | 38 | everything except the FRAY tonic |
| `bridge` | 34 | no starters and no jungle item, no FRAY tonic |
| `fray` | 12 | the 7 Verdigris pieces, the 4 boots and the Noon Tonic |

**BRIDGE.** Fighters start at level 3 with 1,300 Gleam and can't recall. A lane starter is meant to be sold on the first trip home, so it only makes sense with recall, and the mode has no jungle. A BRIDGE opening is boots plus a Verdigris piece plus a flask (1,250–1,300). Shopping is at base or while dead, so the Sap Flask stays useful.

**FRAY is the lighter loadout.** It has 12 items, no wards (nobody has a side to light the map for), no starters, no Gloam or Noonlit, and every recipe is one step deep. The cart sells **finished pieces only**: Verdigris pieces and boots, all under 1,100 Gleam.

- *Why finished pieces.* FRAY lasts 8–11 minutes, and the one Lampwright cart stands in the open at the plate's centre, so every shopping stop is a risk. With finished pieces each stop completes something, and nobody carries half-built parts.
- *Openings and full bags.* The 1,400 starting Gleam buys boots, one piece and a tonic. A player earns about 400 Gleam a minute (4/s passive, kills at 200, Gleam Sunmotes), so a piece arrives every 2–3 minutes. The leader fills a 6-slot bag (5,750–5,900 Gleam) at about 10–11 minutes.
- *Why no Slate parts.* Without them the cart stays readable, at 12 tiles instead of 20. It also stops the bots' fallback planner, which picks the most efficient `basic` items when a pool has no `core`, from filling bags with single-stat parts.

`rift` and `bridge` are closed under components: every part of a pool item can be bought on its own in that pool. `fray` deliberately is not; the shop prices missing parts into the purchase.

## 6. Class builds and timelines

These are the reference builds per class, checked by the probe for pool, slots, uniqueness, boots, one Noonlit and the class's needs, and bought step by step in the sim:

| class | needs (probe) | RIFT / BRIDGE full build | Gleam |
|---|---|---|---|
| Plinth | health, armor, resist | Felt Treads · Ironstone Mantle · Warning Bell · **Seatstone** · Dialcutter · Kindly Lamp | 14,850 |
| Breaker | attack, health | Felt Treads · Dialcutter · **Hourcleaver** · Shadecut · Ironstone Mantle · Warning Bell | 15,350 |
| Striker | attack, armor pen | Felt Treads · Shadecut · **Hourcleaver** · Dialcutter · Splitlight Bow · Warning Bell | 15,650 |
| Slinger | attack speed, crit, on-hit | Dust Runners · Splitlight Bow · **Sunstring** · Shadecut · Dialcutter · Warning Bell | 15,600 |
| Caster | power, haste, penetration | Chalk Slippers · Focal Lens · **Noonglass** · Inkglass Rod · Warning Bell · Kindly Lamp | 15,200 |
| Tender | heal & shield power, haste, power | Chalk Slippers · Kindly Lamp · **Shelter Lamp** · Warning Bell · Ironstone Mantle · Focal Lens | 14,500 |

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

**RIFT laner**, about 350 Gleam a minute:

| | Gleam | what it buys |
|---|---|---|
| 10:00 | about 3,800 | boots and the first Gloam |
| 20:00 | about 7,300 | upgraded boots and two Gloam |
| 28:00 | about 10,100 | the Noonlit |

A full build of 14,500–15,650 takes about 42 minutes, so most matches (22–28 min) end on three finished items plus boots. That is the reference genre's pace, which reaches 5–6 completed items at 35–40 minutes *(r02 §11)*.

**Tender**, about 200 Gleam a minute from passive Gleam and assists. Tenders have no income item on purpose, so their items are the cheapest: Kindly Lamp 2,400 and Shelter Lamp 3,000.

**BRIDGE**, about 375 Gleam a minute. A fighter has about 7,600 Gleam at 17:00, which buys upgraded boots, two Gloam and a Verdigris piece. Only the richest fighters reach a Noonlit.

## 7. The setup layer (`setup.json`)

Before a match each player takes **two battle spells** and, in RIFT and BRIDGE, **two boons from one path**. That's the whole pre-match layer. It has no pages, tiers or secondary trees, and it takes about 10 seconds in the loadout screen.

### 7.1 Battle spells (`spellSlots: 2`)

Spells have no cost and one rank. They scale with your level through the `level` ratio. Ability haste never shortens them (CONTRACT §5.3).

| id | Name | job | effect | cooldown | pools |
|---|---|---|---|---|---|
| `glint_step` | Glint Step | escape | blink up to 4.5 m toward the point | 270 s | all |
| `saplight` | Saplight | sustain | heal 80 + 16/level; allied fighters within 6 m heal 40 + 8/level | 220 s | all |
| `hairline` | Hairline | offense | an enemy fighter within 6 m takes 20 + 8/level damage that ignores armor and resist, plus 20 % armor and resist shred and 40 % weaker healing for 4 s | 180 s | all |
| `hourstrike` | Hourstrike | jungle | a monster or Wick (never a fighter) within 5 m takes 450 + 30/level damage that ignores armor and resist; you heal 60 + 6/level | 2 charges, one per 90 s (15 s between uses) | RIFT |
| `running_light` | Running Light | haste | +45 % move speed fading over 6 s | 200 s | all |
| `shake_loose` | Shake Loose | cleanse | breaks roots; immune to stuns, roots and knockbacks for 0.5 s; +50 % tenacity for 3 s; +25 % move speed for 1.5 s | 210 s | RIFT · BRIDGE |
| `glass_pane` | Glass Pane | shield | shield 90 + 20/level for 2.5 s | 180 s | all |
| `calling_bell` | Calling Bell | team / vision | you and allied fighters within 7 m +20 % move speed for 3 s; enemy fighters within 9 m revealed for 4 s | 150 s | RIFT · BRIDGE |

There are 8 spells in RIFT, 7 in BRIDGE and 5 in FRAY (Glint Step, Saplight, Hairline, Running Light, Glass Pane). FRAY drops the team spell, which has no teammates there, the jungle spell, and the cleanse, to keep its loadout short.

**Defaults:** Glint Step and Saplight, which are legal in every pool.

**Hourstrike is recommended for the Grovehunter, not required.**

- *Why not required.* The Grove Sickle starter makes clearing camps efficient (§4), so a jungler without Hourstrike can still farm. Hourstrike secures camps and the two objectives: its strike is 630 at level 6 (15 % of Sunsplinter's health) and 930 at level 16 (7 % of Longshade's).
- *Why that is enough.* The reference genre forces its jungle spell *(r02 §1, "jungle gating")*. We keep the choice open because the role assignment already keeps laners out of the Dialwood.
- *For SESSION.* Suggest Hourstrike + Glint Step for a Grovehunter's first loadout.
- *For UI.* Show a soft "No Hourstrike" note in the draft, not a block.

**The cleanse.** The sim refuses every cast, spells included, while a fighter is stunned, airborne, asleep, taunted or feared. Shake Loose therefore can't break those controls, and it says so in its text. It breaks roots through the `unstoppable` status, ignores new hard control for 0.5 s, and its tenacity shortens the rest. A cleanse for hard control needs a SIM change (§10).

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
| finished items | 2,500–3,300 *(r02 §11)* | Gloam 2,400–2,900, Noonlit 3,000–3,500 |
| full build | 5–6 completed items at 35–40 min *(r02 §11)* | about 42 min for boots + 5; three items + boots at 25 min |
| sell-back | about 70 % *(r02 §11)* | 70 % (schema default); consumables 40 % so a flask is not a bank |
| boots | three tiers *(r02 §11)* | two: one base pair and three upgrades; no third tier, fewer steps for a browser match |
| support income | quest-style support item *(r02 §1)* | none: Tenders live on passive Gleam and assists, and their items are cheaper |
| single-lane mode | no starters, buy only when dead, mode-only spells *(r03 §2.1)* | BRIDGE: no starters, base or dead shopping, no jungle spell; no mode-only gap-closer (r03 lists the reference's as protected) |
| FFA mode | item drops that favour trailing players *(r03 §4a)* | FRAY: finished pieces at one cart, Gleam Sunmotes (flat 120 matters more to a trailing player) |
| battle spells | two long-cooldown utility spells, a forced jungle spell *(r02 §11)* | two slots, 90–300 s; the jungle spell is optional (§7.1) |
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
    - Show "You can carry one Noonlit item" on Noonlit tooltips. The item `desc` already says it.
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
  2. *A real cleanse* needs an optional `AbilityDef` flag that lets a battle spell be cast while stunned, together with a status-removal op. Shake Loose would then become a full cleanse.
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
