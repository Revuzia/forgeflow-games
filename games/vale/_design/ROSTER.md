# VALE · Launch Roster (16 fighters)

Content lane, 2026-10-07. This is the design source for `content/fighters/<id>.json` and `content/skins/<id>.json`. It follows `STYLE_BIBLE.md` (look), `WORLD.md` (names, origins, voice), `VOCAB.md` (ids, calibration), `CONTRACT.md` §5.3 (effect semantics) and `src/contracts/catalog.ts` (schema).

Ids used throughout:
- **Classes:** `class_plinth` · `class_breaker` · `class_striker` · `class_slinger` · `class_caster` · `class_tender`
- **Positions:** `shadehold` · `grovehunter` · `dialcross` · `shaftlight` · `lampglass`
- **Resources:** `res_light` · `res_tally` · `res_heat` · `res_unlit`

Every kit below can be built with the EffectT ops that already exist. No kit needs a `script` and no kit needs a new unit record. Section 7 lists the four places where an author must take care.

---

## 1. Roster at a glance

| # | id | Name | Origin | Class | Position (primary / secondary) | Resource | Attack | Kit damage | Diff | Fight job |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `marund` | Marund | Serenade | Plinth | Lampglass / Shadehold | Light | melee 1.9 m, phys | magic | 1 | Raises a dome no enemy can step into, so the ally who got caught has three safe seconds. |
| 2 | `burdam` | Burdam | Serenade | Breaker | Shadehold / Grovehunter | Tally | melee 2.0 m, phys | phys | 1 | Stays on whoever hurt him and makes every one of them pay it back at once. |
| 3 | `rishal` | Rishal | Aubade | Striker | Dialcross / Grovehunter | Heat | melee 1.7 m, phys | phys | 3 | Cuts lines of glass through the back line and is gone before anyone can answer. |
| 4 | `odrum` | Odrum | Serenade | Slinger | Shaftlight / Shadehold | Light | ranged 5.6 m, phys | phys | 2 | Pours resin under the enemy front line; whoever is still standing in it when it sets is stuck. |
| 5 | `dunsom` | Dunsom | Serenade | Caster | Dialcross / Lampglass | Light | ranged 5.2 m, magic | magic | 3 | Moves the enemy where his team wants them: pulled into the pool, pushed off the carry. |
| 6 | `ilsheta` | Ilsheta | Aubade | Tender | Lampglass / none | Light | ranged 5.4 m, magic | magic | 1 | Hangs a healing lamp on the ally in the most trouble; the light follows them wherever they run. |
| 7 | `hesmi` | Hesmi | Hourless | Plinth | Shadehold / Grovehunter | Unlit | melee 1.8 m, phys | phys | 2 | Plants shards of the fallen needle whose shadows slow the enemy, then fall on them. |
| 8 | `kemdo` | Kemdo | Hourless | Breaker | Grovehunter / Shadehold | Heat | melee 2.1 m, phys | phys + true | 2 | Dives one target, empties her Heat bar in two seconds, vents and goes again. |
| 9 | `ardit` | Ardit | Aubade | Plinth | Grovehunter / Lampglass | Light | melee 1.9 m, phys | magic | 1 | Tilts a pane of dawnglass that disarms the fighters swinging at his team. |
| 10 | `ervet` | Ervet | Aubade | Breaker | Shadehold / Dialcross | Light | melee 2.0 m, phys | magic | 2 | Shatters her own blade into the enemy line, fights fast with the hilt, then swings it whole again. |
| 11 | `nurrow` | Nurrow | Serenade | Striker | Grovehunter / Dialcross | Tally | melee 1.7 m, phys | magic | 3 | Sings everyone around her target to sleep and takes the one left awake. |
| 12 | `lisvel` | Lisvel | Aubade | Slinger | Shaftlight / Lampglass | Light | ranged 5.9 m, phys | phys | 1 | Shoots from far back and leaves lines of morning light her team can run along. |
| 13 | `ulkro` | Ulkro | Hourless | Slinger | Shaftlight / Grovehunter | Tally | ranged 5.4 m, phys | phys | 3 | Never stops moving: every stride she runs loads her next throw. |
| 14 | `tunlan` | Tunlan | Serenade | Caster | Dialcross / Shaftlight | Heat | ranged 5.2 m, magic | magic | 2 | Throws lamp-shadows of beasts over the enemy line and sends them running. |
| 15 | `vashil` | Vashil | Aubade | Caster | Dialcross / Shaftlight | Light | ranged 5.3 m, magic | magic | 1 | Rings wide notes over the enemy front line; anyone struck by two of them stops cold. |
| 16 | `sukri` | Sukri | Hourless | Tender | Lampglass / none | Light | ranged 5.0 m, magic | magic | 2 | Draws a caught ally back to the group; when he falls low, nobody beside him can be touched for a breath. |

UI tags are `Name · Class` (for example "Ardit · Plinth"). The short collection title in each entry below is the `title` field. It is never shown as an epithet.

---

## 2. Why this roster works in every mode

### 2.1 RIFT draft with bans (`rift_ranked`: 2 bans per team)

Each match uses up C = 2·5 + 4 = 14 fighters. The last picker therefore faces 4 bans plus 9 earlier picks and still chooses from **3** fighters. The standard queue has 1 ban per team, which leaves 5.

The task set a floor of 4 fighters per position. I aimed higher: **every position has 5 to 7 listings, and each has at least one difficulty-1 fighter.** A player who has only learned one position can still find a pick after a typical ban spread.

| Position | Primary | Secondary | Total | Difficulty-1 option |
|---|---|---|---|---|
| Shadehold | Burdam, Hesmi, Ervet | Marund, Odrum, Kemdo | **6** | Burdam, Marund |
| Grovehunter | Kemdo, Ardit, Nurrow | Burdam, Rishal, Hesmi, Ulkro | **7** | Ardit, Burdam |
| Dialcross | Rishal, Dunsom, Tunlan, Vashil | Ervet, Nurrow | **6** | Vashil |
| Shaftlight | Odrum, Lisvel, Ulkro | Tunlan, Vashil | **5** | Lisvel, Vashil |
| Lampglass | Marund, Ilsheta, Sukri | Dunsom, Ardit, Lisvel | **6** | Marund, Ilsheta, Ardit, Lisvel |

- **Damage types in every position.** Each position holds both physical and magic damage dealers, so a draft can always balance damage types.
- **Tenders list no secondary.** A healer on a solo road is a trap for new players. Lampglass is still covered six ways because Marund, Ardit, Dunsom and Lisvel can all play it.
- **Shaftlight is the thinnest position at 5.** Locking it out completely would take five of the 13 removals to be Shaftlight-capable fighters. Positions are soft in the draft host anyway: an off-position pick is legal and bots score role fit, not role locks. The next fighter added should be a Shaftlight or Shaftlight-secondary.

### 2.2 BRIDGE (random fighters with a bench of 3, 1 reroll)

- **Every match uses the whole roster.** 10 seats plus two benches of 3 is exactly 16, so the Lot puts every fighter on the field or on a bench each match.
- **Rerolls still work.** `src/session/draft.ts` `drawFor` falls back to "unused by that team" once the pool is empty, so a reroll can hand out a fighter the other team holds. That is a cross-team mirror, and the code allows it.
- **Consequence for kits:** all 16 kits must work on one lane with no recall. Every kit has a wave-clear or area tool, and every Plinth and Breaker has some sustain or damage reduction.
- **Composition odds.** Each team sees 8 of the 16.
  - The chance that a team's 8 holds no Plinth or Breaker is C(10,8)/C(16,8) = **0.35%**.
  - The chance that it holds none of the three team-sustain fighters (Ilsheta, Sukri, Marund) is C(13,8)/C(16,8) = **10%**.
- **Recommendation (SESSION):** apply r03's "constrained random" when dealing the Lot: at least one of Plinth or Breaker, and at least one of {Ilsheta, Sukri, Marund}, in each team's 8.

### 2.3 FRAY (10 players, free-for-all, no duplicates)

- **Picks:** ten unique picks leave 6 fighters spare, so the first lock always wins without starving late pickers.
- **Kits work alone.** Every ability that targets an ally also accepts **self**, so no kit goes dead with no allies:
  - Ilsheta: Hung Lamp, Dawnglass Shell and Every Window Lit
  - Sukri: Draw Near (on himself it is just the shield) and Gather In
  - Ardit: Muster
  - Lisvel: her light lines
  - Marund: Shelter Dome
- **Allies-only filters** state `enemies:false, self:true` (CONTRACT §5.3, filters).
- **FRAY standouts.** Some kits are deliberately good in a crowd and are the expected favourites: Burdam's Settled Account, Dunsom's Driving Hour, Nurrow's Quiet Kill and Lull the Rest, and Tunlan's Shadow Play.
- **Tenders are the weakest FRAY picks.** Their self-casts and damage tools (Glint Bolt; Mote Toss with Wrap Cast) keep them playable.

### 2.4 Spreads

| Axis | Count | Reason for the split |
|---|---|---|
| **Class** (Plinth / Breaker / Striker / Slinger / Caster / Tender) | **3 / 3 / 2 / 3 / 3 / 2** | Kept the suggested split. Strikers stay at 2 because assassins punish new players hardest. Tenders stay at 2 because Lampglass is also covered by a Plinth, a Caster and a Slinger secondary. |
| **Resource** | **Light 9 · Tally 3 · Heat 3 · Unlit 1** | Light is the majority, so most players learn one resource. Tally sits on the attack-driven fighters (Burdam, Nurrow, Ulkro). Heat sits on the burst rhythms (Rishal, Kemdo, Tunlan). Hesmi is the one cooldown-only fighter. |
| **Melee / ranged** | **8 / 8** | Every melee fighter is a Plinth, Breaker or Striker; every ranged fighter is a Slinger, Caster or Tender. |
| **Basic attacks** | melee phys 8 · ranged phys 3 · ranged magic 5 | Casters and Tenders throw light bolts (`attack.damageType: magic`). |
| **Kit damage** | phys 7 · magic 9, with true damage on Kemdo | Among the damage dealers the split is 7 phys to 5 magic. Plinths and Tenders deal magic, so tank items do not collapse onto one resist. |
| **Difficulty** (1 / 2 / 3) | **6 / 6 / 4** | Every position has a difficulty-1 fighter. The four difficulty-3 fighters cover Dialcross, Grovehunter and Shaftlight. |
| **Origin** (Aubade / Serenade / Hourless) | **6 / 6 / 4** | Matches WORLD.md §2. Aubade has one of every class. Serenade doubles Casters. The Hourless are the Plinth, Breaker, Slinger and Tender. |
| **Weapon motion profile** | two_hand 4 · one_hand 3 · staff 4 · focus 2 · dual 1 · bow 1 · none 1 | All seven clip families are used, so ART's shared clip tooling is exercised by launch. |
| **Height** | large 2.3–2.35 (3 Plinths) · 2.0–2.15 (Breakers, Casters) · 1.7–1.9 (Strikers, Slingers) · compact 1.65–1.72 (Tenders) | Role is mass (bible). Heights span the bible's 1.6–2.4 m. |

---

## 3. The fighters

How to read each entry:
- **Kit lines** give the player-facing behaviour, then `[DSL: …]` with the ops that build it.
- **Unique** names the one mechanic no other fighter has.
- **Numbers** are rank-1 or typical values inside VOCAB's calibration ranges. Basic cooldowns are 5–16 s and ultimates 70–130 s.
- **Presentation** lists the VOCAB `lib_*` presets and the bespoke ultimate preset (`<id>_ult_<word>`). Statuses with no lib preset (disarm, sleep, fear, untargetable) get optional bespoke presets, as VOCAB allows.

### 1 · Marund · Plinth (`marund`)
**Title:** Dome mason · **Origin:** Serenade (he) · **Position:** `lampglass` / `shadehold` · `res_light` · melee 1.9 m phys · kit magic · difficulty 1 · bot `warden`, preferredRange 2 · palette `#6E6358` / `#A58A6C`
**Job:** Raises a dome no enemy can step into, so the ally who got caught has three safe seconds.
**Silhouette (block, large 2.35 m):**
- Broad, stooped mason with shoulders 1.6× his hips and a square stance.
- A shallow ironstone dome-cap spans both shoulders, banded like a Lamp Dome and cut flat at the crown.
- A lacquered walnut mask sits under its rim; felt apron.
**Hook at 96 px:** the dome-cap is a 0.9 m flat-topped disc over the shoulders, the only rounded mass among the Plinths. Three lampresin windows in its rim hold the accent.
**Weapon:** short-hafted ironstone maul, `two_hand`. Casts lift the maul overhead.
- **Passive: Hearthside.** Allied fighters within 5 m of him (himself included) regenerate 0.4% of his max health per second. [DSL: trigger `interval` 1 s → `area` circle 5 at self, filter `{enemies:false, allies:true, self:true, minions:false, monsters:false, summons:false}` → `heal` `{base, maxHp:0.004}`]
- **A1: Shoulder In.** Charges 4.5 m and stops at the first enemy: magic damage, knocked back 2 m and slowed 30%. A Mortared target is rooted for 1.25 s instead of slowed. [DSL: `dash` direction, `stopOnFirstHit` → onPass `damage`, `displace` knockback 2, `if targetHasMark mortar` → `consumeMark` + `status root`, else `status slow`]
- **A2: Shelter Dome** (**unique: a no-entry dome**). Raises a 3 m dome around him for 2.5–3.5 s.
  - Enemies inside are shoved to its edge, and no enemy can walk in. Allies come and go freely.
  - Allies inside gain +20–40 armor and magic resist.
  - [DSL: `area` circle 3 at self → `displace` knockback 2.5; `zone` circle 3 at self, `blocks:'enemies'`, onTick (allies and self only) → `buff`]
- **A3: Mortar Pail.** Lobs wet mortar up to 8 m. After 0.5 s, enemies within 2 m take magic damage, are slowed 35% and are Mortared for 4 s. [DSL: `area` delay 0.5 → `damage`, `status slow`, `mark mortar`]
- **Ultimate: Domefall** (100 / 85 / 70 s). Leaps up to 7 m. On landing:
  - Enemies within 3.5 m are flung 2.5 m outward and stunned for 1 s.
  - Allies there gain a shield of 12% of his max health for 3 s.
  - [DSL: `dash` toPoint (leap) → onArrive `area` 3.5 → `displace` knockback, `status stun`; `area` allies → `shield`]
**Presentation:** `lib_dash_trail` · `lib_zone_lumen` · `lib_slam_ground` · `lib_root_bind` · `lib_leap` · ult `marund_ult_domefall` · attack sfx `c_swing_heavy`.
**Skins:**
- *Gorgewalk Mason* (standard). A slate cowl `#6E747C` (hue 214, 11% saturation) with iron bands, rigid gorge-rope `#9A8F7A` wrapped over the shoulders, iron pins. Extra geometry: a rope coil plate on the left shoulder.
- *Long Evening Cowl* (deluxe). Plum lacquer `#5B3A5E` (hue 295) with smoked-amber windows `#9C8566` (35% saturation). Extra geometry: a small lamp finial on the cowl's flat top, within the +5% height limit.

### 2 · Burdam · Breaker (`burdam`)
**Title:** Grudge holder · **Origin:** Serenade (he) · **Position:** `shadehold` / `grovehunter` · `res_tally` · melee 2.0 m phys · kit phys · difficulty 1 · bot `skirmisher`, 2 · palette `#5E4F45` / `#9A7B62`
**Job:** Stays on whoever hurt him and makes every one of them pay it back at once.
**Silhouette (inverted wedge, 2.15 m):**
- Massive oxidised-iron pauldrons narrowing to waxed-leather boots.
- An ironstone cleaver as long as he is tall rests on his right shoulder.
- A lacquered "ledger mask" is scored with vertical tally cuts.
**Hook at 96 px:** the notched cleaver over one shoulder makes a long diagonal bar above his head. The notches along its back hold the accent.
**Weapon:** cleaver, `two_hand`, overhead chops.
- **Passive: Long Memory** (**unique: grudges are written by the enemy**). Each time an enemy fighter damages him, they gain a Grudge stack (max 5, 6 s). His attacks against a Grudge-bearer heal him for 1.5% of max health and give 8 Tally. [DSL: trigger `damageTaken` with a fighters-only filter → `mark grudge` to hit, stacks 1, max 5, 6 s; trigger `attackHit` with `cond targetHasMark grudge` → `heal`, `resource +8`]
- **A1: Bear Down.** Lunges up to 5 m to an enemy and chops for phys damage. A Grudge-bearer is also slowed 40% for 1.5 s. [DSL: unit target → `dash` toTarget → onArrive `damage`, `if targetHasMark` → `status slow`]
- **A2: Stubborn** (30 Tally). For 3 s he gains +25 armor, +25 magic resist and 30% tenacity. When it ends he stamps, dealing phys damage within 3 m. [DSL: `buff` with stats + `onExpire` → `area`]
- **A3: Old Wound** (40 Tally). Cleaves a 4 m, 100° arc for phys damage. Grudge-bearers hit take 30% more damage and are slowed 50%, decaying over 2 s. [DSL: `area` cone → `damage`; `if targetHasMark` → bonus `damage`, `status slow decay:true`]
- **Ultimate: Settled Account** (90 / 75 / 60 s). Every Grudge-bearer within 7 m is dragged 3 m toward him and stunned for 0.5 s.
  - Each pays 60/100/140 (+0.4 bonus AD) phys damage **per Grudge stack**.
  - He heals 3% of max health per stack.
  - [DSL: `area` circle 7 at self, fighters → `if targetHasMark grudge` → `displace` pull 3, `status stun`, `consumeMark` perStack `[damage, heal to:self]`]
**Presentation:** `lib_hit_phys_heavy` · `lib_mark_stack` · `lib_empower` · `lib_cone_sweep` · ult `burdam_ult_account` · `c_swing_heavy`.
**Skins:**
- *Stillwater Cleaver* (standard). Wet basalt `#4D5A5C` armour with river-glass inlays `#8FB3A8` (hue 162, 20% saturation) and rigid reed plates `#7D8460`.
- *Almanac Ledger* (deluxe). Parchment-printed pauldrons `#D8CDB4` ruled with ink ledger lines `#2E2A26`, and day-marks printed down the cleaver's back. Extra geometry: a rigid almanac board hung at the belt.

### 3 · Rishal · Striker (`rishal`)
**Title:** Glass runner · **Origin:** Aubade (he) · **Position:** `dialcross` / `grovehunter` · `res_heat` · melee 1.7 m phys · kit phys · difficulty 3 · bot `diver`, 2 · palette `#9AA6B4` / `#D9D4C8`
**Job:** Cuts lines of glass through the back line and is gone before anyone can answer.
**Silhouette (forward diagonal, 1.8 m):**
- Narrow and leaning 15° into the run.
- A gull-grey feather crest of two hard plates, each at least 30 cm, sweeps back from a blade-shaped dawnglass visor.
- Asymmetric: a long left pauldron point and a short right one.
**Hook at 96 px:** the swept crest plus two reversed glass knives jutting behind his forearms, which read as backward spikes. The accent is in the visor ridge.
**Weapon:** two dawnglass knives, `dual`.
- **Passive: Split Glass.** Enemies who step across his glass tracks are Cut (max 3, 5 s). His next attack on a Cut enemy spends every Cut for +20–60 phys damage each and **vents 8 Heat per Cut**. [DSL: trigger `attackHit` with `cond targetHasMark cut` → `consumeMark` perStack `[damage, resource −8]`]
- **A1: Glass Dash** (**unique: glass tracks**; 2 charges, recharge 9→5 s, +15 Heat). Dashes 5 m and leaves a glass track on the ground for 3 s.
  - Enemies he passes take phys damage.
  - Anyone who later crosses the track takes damage and is Cut.
  - [DSL: `charges {max:2}`; `zone` rect 5×1 at self (laid before the dash) with onEnter `damage`, `mark cut`; `dash` direction 5 → onPass `damage`]
- **A2: Glint Cut** (+25 Heat). A double slash on an adjacent enemy (2 m): phys damage twice. A Cut target is slowed 60%, decaying over 1 s. [DSL: unit target → `repeat` 2 `damage`; `if targetHasMark cut` → `status slow decay`]
- **A3: Feint** (+20 Heat). Springs 4 m away from the cursor and lays a track over the path he covered. [DSL: `dash` away 4 → onArrive `zone` rect 4×1 at self along the aim direction]
- **Ultimate: Long Glint** (100 / 85 / 70 s, +30 Heat). An unstoppable 9 m rush.
  - Every enemy he passes takes phys damage, gains 3 Cuts and is slowed 50% for 1 s.
  - The whole line stays a glass track for 4 s.
  - [DSL: `zone` rect 9×1.5 at self, 4 s, onEnter `mark cut`; `dash` direction 9, `unstoppable`, `passWidth` 1.5 → onPass `damage`, `mark cut stacks:3`, `status slow`]
**Heat rhythm:** two dashes, a Glint Cut and a Feint come to 75 Heat; one more cast overheats him. Cashing Cuts with attacks is how he keeps casting.
**Presentation:** `lib_dash_trail` · `lib_zone_glass` · `lib_mark_stack` · `lib_crit` · ult `rishal_ult_glint` · `c_swing_light`, `c_dash`.
**Skins:**
- *Chalkline Runner* (standard). Ink-grey steel `#3A3F47` with chalk line-work `#E6E0D2` on no more than 20% of the surface; feather crest `#A7A9AC`.
- *Lamplit Visor* (deluxe; the purchase example in WORLD.md §5). The visor is smoked lampresin `#A38C6B` and the armour walnut `#5E4D3E`, both at no more than 35% saturation. Extra geometry: a small lamp cage on the crest.

### 4 · Odrum · Slinger (`odrum`)
**Title:** Amber setter · **Origin:** Serenade (he) · **Position:** `shaftlight` / `shadehold` · `res_light` · ranged 5.6 m phys · kit phys · difficulty 2 · bot `marksman`, 5.6 · palette `#7A6550` / `#BBA27F`
**Job:** Pours resin under the enemy front line; whoever is still standing in it when it sets is stuck.
**Silhouette (horizontal, 1.9 m):**
- A 2.2 m walnut staff-sling is carried level across his shoulders like a yoke, with a rigid resin pot hanging from each end.
- Domed felt cap; carved ochre mask.
**Hook at 96 px:** the yoke is the widest horizontal read in the roster. The accent is in the two glowing pots.
**Weapon:** staff-sling, `staff`.
- **Passive: Cracked Amber.** Enemies rooted by his resin crack, losing 20% armor and 20% magic resist for 2.5 s. [DSL: trigger `statusApplied` with `cond targetHasStatus root` → `status armor_shred`, `status resist_shred`]
- **A1: Resin Shot** (**unique: setting resin**). Lobs resin up to 9 m, making a 2.5 m pool that slows by 35% for 1.5 s. When it sets, enemies still inside take phys damage and are rooted for 1 s. [DSL: `area` delay 0.5 → `zone` circle 2.5, 1.5 s, onTick `status slow`, onExpire `area` at end → `damage`, `status root`]
- **A2: Swing Out.** Whirls the sling: phys damage within 3 m and a 30% slow. He gains 25% move speed for 1.5 s. [DSL: `area` circle at self; `status haste to:self`]
- **A3: Step and Load.** Hops 3.5 m. His next attack within 3 s carries a resin pellet for bonus phys damage and a 25% slow. [DSL: `dash` toPoint; `buff` `empowerAttacks {count:1}`]
- **Ultimate: Amber Hour** (110 / 95 / 80 s). Hurls a great resin ball up to 12 m (edge marker past 10 m).
  - It makes a 5 m pool that slows by 45% for 2 s.
  - When it sets, everyone still inside is rooted for 1.5 s and takes phys damage, so the passive cracks the whole group.
  - [DSL: same shape as Resin Shot, larger]
**Presentation:** `lib_lob` · `lib_zone_glass` · `lib_root_bind` · `lib_ring_pulse` · ult `odrum_ult_amber` · `c_thrown`.
**Skins:**
- *Noon Fair Yoke* (standard). A rose-lilac lacquered yoke `#B48AA6` (hue 320); the pots become painted paper lanterns `#E2D6C4`; rigid ribbons with at most 2 sway bones.
- *Shadeprint Yoke* (deluxe). Ink-wash lower body `#2B2A33` with light-rimmed edges and a pale upper body `#B7B4BE`, so the value gradient holds. The pots become ink pots. `vfxTint` `#7A6BB0` (hue 253).

### 5 · Dunsom · Caster (`dunsom`)
**Title:** Dusk herder · **Origin:** Serenade (he) · **Position:** `dialcross` / `lampglass` · `res_light` · ranged 5.2 m magic · kit magic · difficulty 3 · bot `artillery`, 7 · palette `#4E4A5C` / `#A48F6E`
**Job:** Moves the enemy where his team wants them: pulled into the pool, pushed off the carry.
**Silhouette (line + disc, 2.05 m):** a tall, thin herder with a broad round felt hood-rim (the disc) over a carved mask, and a shepherd's crook taller than he is.
**Hook at 96 px:** the crook's hook rises 0.5 m above the hood with a lampresin lantern hanging in it. The lantern is the accent.
**Weapon:** crook, `staff`.
- **Passive: Settling.** Enemies he displaces are Settled for 3 s, and his abilities deal 15% more damage to Settled enemies. [DSL: trigger `statusApplied` with `cond targetHasStatus airborne` (every displacement applies airborne) → `mark settled`; trigger `abilityHit` with `cond targetHasMark settled` → bonus `damage`]
- **A1: Draw In.** After 0.4 s, enemies within 3 m of a point up to 9 m away take magic damage and are drawn 2 m toward its centre. [DSL: `area` delay 0.4 → `damage`, `displace toward_point 2`]
- **A2: Crook Sweep.** Sweeps a 7 m × 2 m line: enemies on it take magic damage and are pushed 2.5 m toward its far end. [DSL: `area` rect at self → `displace toward_point 2.5` (the aimed point is the far end)]
- **A3: Step Through Dusk.** Blinks 4 m. [DSL: `blink` 4]
- **Ultimate: Driving Hour** (**unique: herding to a point of his choosing**; 120 / 100 / 80 s).
  - Every enemy within 5 m of him is hurled up to 5 m toward a point within 9 m.
  - 0.5 s later the point erupts: magic damage and a 1.25 s root within 2.5 m.
  - [DSL: `area` circle 5 at self → `displace toward_point 5`; `area` at point, delay 0.5, circle 2.5 → `damage`, `status root`]
**Presentation:** `lib_burst_shade` · `lib_line_cleave` · `lib_blink` · `lib_root_bind` · ult `dunsom_ult_drive` · `c_cast_shade`.
**Skins:**
- *Highrim Herder* (standard). Pale wind-carved sandstone hood `#CDBB9C` (24% saturation) and a bleached walnut crook `#BFAE95`.
- *Almanac Crook* (deluxe). Parchment hood printed with tables of the day `#D8CDB4` and an ink crook `#2E2A26`. Extra geometry: folded rigid almanac pages hung from the crook.

### 6 · Ilsheta · Tender (`ilsheta`)
**Title:** Lamp hanger · **Origin:** Aubade (she) · **Position:** `lampglass` · `res_light` · ranged 5.4 m magic · kit magic · difficulty 1 · bot `sustain`, 6 · palette `#C9D3D6` / `#E8E2D2`
**Job:** Hangs a healing lamp on the ally in the most trouble; the light follows them wherever they run.
**Silhouette (round + light vessel, 1.72 m):**
- Round, open stance under a hooded linen mantle (rigid drapery).
- A dawnglass lamp held at her chest on a short hook-staff.
- A tall clear visor shaped like a lamp chimney.
**Hook at 96 px:** the chimney visor reads as a bright vertical cylinder on top. The accent is in the chest lamp.
**Weapon:** lamp, `focus`.
- **Passive: Warm Hands.** Her heals restore 40% more to allies who are stunned, rooted, slowed, asleep, feared or taunted, and give them 15% move speed for 1.5 s (once per 4 s per ally). [DSL: trigger `abilityHit` with an allies-only filter and `cond any[targetHasStatus …]` → `heal`, `status haste`; `perTargetCooldown` 4. See §7.1.]
- **A1: Glint Bolt.** A dawnglass bolt reaching 9 m: magic damage and a 25% slow for 1.5 s. [DSL: `projectile` → `damage`, `status slow`]
- **A2: Hung Lamp** (**unique: a healing light that follows an ally**). Hangs a lamp on an allied fighter or herself for 4 s.
  - Allies within 3 m of that fighter heal every 0.5 s.
  - Enemies in the light are revealed and slowed 10%.
  - [DSL: unit target with an allies-and-self filter; `zone` follow at target, circle 3, 4 s, allies only, onTick `heal`; a second `zone` follow at target for enemies → `reveal`, `status slow`]
- **A3: Dawnglass Shell.** Shields an ally or herself for 2.5 s and gives 20% move speed for 1 s. [DSL: `shield` to target; `status haste`]
- **Ultimate: Every Window Lit** (120 / 100 / 80 s). Hangs a lamp on every allied fighter within 9 m, herself included, for 5 s. Each lamp heals the allies near it. [DSL: `area` circle 9 at self, allies and self, fighters only → onHit `zone` follow at hit]
**Presentation:** `lib_bolt_lumen` · `lib_heal_rise` · `lib_zone_lumen` · `lib_shield_up` · `lib_reveal_mark` · ult `ilsheta_ult_lamps` · `c_heal`.
**Skins:**
- *Stillwater Lamp* (standard). A sea-glass lamp `#8FB3A8` (hue 162, outside the heal band) and a wet-stone mantle `#59666A`; reed plates ring the visor.
- *First Bell Lamp* (deluxe; the FRAY winners' honour). A pale dial-stone mantle `#CFCAC0` carved with ten hour-marks over a dark base `#3A3633`, which keeps the value gradient. Extra geometry: a small glass bell inside the lamp.

### 7 · Hesmi · Plinth (`hesmi`)
**Title:** Shard bearer · **Origin:** Hourless (she) · **Position:** `shadehold` / `grovehunter` · `res_unlit` · melee 1.8 m phys · kit phys · difficulty 2 · bot `frontline`, 2 · palette `#5C5A63` / `#8C8478`
**Job:** Plants shards of the fallen needle whose shadows slow the enemy, then fall on them.
**Silhouette (block, large 2.3 m):**
- A broad hooded wanderer in layered rigid wraps.
- A rack of three needle-stone shards is strapped upright on her back, cut flat at one height 0.3 m above the hood. This keeps the Plinth's flat crown.
- Stone-gauntleted fists.
**Hook at 96 px:** the flat-topped shard rack is a slab wider than her head, with darker stone than any other fighter. The accent is in the shards' cut tops.
**Weapon:** gauntlets, motion `none`.
- **Passive: Shade-Fed.** Her attacks against Shaded enemies deal +3% of the target's max health as phys damage.
  - **Stand Firm hook:** during Stand Firm, enemy fighters who hit her become Shaded.
  - [DSL: trigger `attackHit` with `cond targetHasMark shaded` → `damage {targetMaxHp:0.03}`; trigger `damageTaken` with `cond counterAtLeast standfirm 1` → `mark shaded` to hit]
- **A1: Plant Shard** (**unique: shadow strips that topple**; cooldown 12→8 s). Drives a shard into the ground up to 6 m away.
  - For 3 s it throws a 9 m × 2.5 m shadow away from her: enemies inside are slowed 25% and Shaded.
  - When the shard topples, enemies still in the shadow take phys damage and are stunned for 0.75 s.
  - [DSL: `zone` rect 9×2.5 at point (it extends along the aim, away from her), 3 s, onTick `status slow`, `mark shaded`; onExpire `area` rect at end → `damage`, `status stun`]
- **A2: Shoulder the Stone.** Lunges 4.5 m; enemies she passes are knocked aside 1.5 m and Shaded. [DSL: `dash` direction → onPass `displace` knockback, `mark shaded`]
- **A3: Stand Firm.** For 2.5 s she gains +30 armor, +30 magic resist and 30% tenacity. Attackers are Shaded (see Passive). [DSL: `buff`; `counter standfirm add:1 duration:2.5`]
- **Ultimate: Felled Shard** (110 / 95 / 80 s). Drops a great shard at a point within 9 m.
  - After 0.75 s, enemies under it (2 m) are stunned for 1.25 s and take phys damage.
  - It then throws a 12 m × 5 m shadow for 5 s that slows enemies by 40% and Shades them, while allies in it gain 15% move speed.
  - [DSL: `area` delay 0.75 → `status stun`; `zone` rect for enemies; `zone` rect for allies (`enemies:false`) → `status haste`]
**Presentation:** `lib_zone_shade` · `lib_stun_ring` · `lib_slam_ground` · `lib_dash_trail` · ult `hesmi_ult_shard` · `c_swing_heavy`, `c_slam`.
**Skins:**
- *Gorgewalk Shards* (standard). Slate shards bound with rigid gorge-rope `#9A8F7A`, iron pins and slate wraps `#6E747C`.
- *Shadeprint Shards* (deluxe). Ink shards `#2B2A33` with light rims and pale wraps above `#B7B4BE`. `vfxTint` ink-violet `#6C5BA8` (hue 253).

### 8 · Kemdo · Breaker (`kemdo`)
**Title:** Burning glass · **Origin:** Hourless (she) · **Position:** `grovehunter` / `shadehold` · `res_heat` · melee 2.1 m phys · kit phys + true · difficulty 2 · bot `diver`, 2 · palette `#8A7A66` / `#D7C9A6`
**Job:** Dives one target, empties her Heat bar in two seconds, vents and goes again.
**Silhouette (inverted wedge, 2.1 m):**
- Hood and heavy rigid shoulder wraps narrowing to bound shins.
- A long two-hand glaive carried on her right side; its head is a round burning-glass lens in a wrapped stone frame.
**Hook at 96 px:** the lens is a 40 cm glass disc angled upward, which reads as a bright ellipse from 52°. Its accent ring blooms only during wind-ups.
**Weapon:** glaive, `two_hand`.
- **Passive: Cooling Kill.** A takedown vents all her Heat at once. [DSL: trigger `takedown` → `resource −100`]
- **A1: Long Thrust** (+20 Heat). Thrusts along a 4.5 m line for phys damage. Slowed enemies also take 6% of their max health as true damage. [DSL: `area` rect at self → `damage`; `if targetHasStatus slow` → `damage true {targetMaxHp:0.06}`]
- **A2: Heat Shimmer** (+25 Heat). Dashes 5 m and leaves a shimmer for 2 s that slows enemies inside by 25%. [DSL: `zone` rect 5×1.2 at self, then `dash` direction 5]
- **A3: Vent** (**unique: cooling on demand, castable while overheated**). Releases 50 Heat in a 3 m blast: phys damage and a 1 m knockback, and she takes 20% less damage for 1.5 s. It costs no Heat.
  - [DSL: `costKind:'none'`; `abilities.ts` checks only `costKind:'res'` abilities against the overheat lock, so Vent stays castable while she is overheated. Effects: `resource −50`, `area` → `damage`, `displace` knockback 1; `buff`]
- **Ultimate: Held Focus** (100 / 85 / 70 s, +30 Heat). Focuses the stopped sun on an enemy fighter within 6 m for 3 s.
  - A 2 m spot follows the target and deals true damage every 0.5 s to them and anyone beside them.
  - She gains 25% omnivamp for the duration.
  - [DSL: `zone` follow at target, circle 2, 3 s, interval 0.5 → `damage true`; `buff {omnivamp:0.25}`]
**Presentation:** `lib_line_cleave` · `lib_zone_glass` · `lib_burst_lumen` · `lib_zone_ember` · ult `kemdo_ult_focus` · `c_swing_heavy`, `c_burst_lumen`.
**Skins:**
- *Highrim Glaive* (standard). A wind-scoured sandstone frame `#CDBB9C` and pale wraps `#DCD3C2`.
- *Long Evening Lens* (deluxe). Plum wraps `#5B3A5E`, a smoked-amber frame `#9C8566` and a lilac-tinted lens `#B9A6D6` (hue 264, outside every reserved band). Extra geometry: rigid lacquer tassel plates on the frame.

### 9 · Ardit · Plinth (`ardit`)
**Title:** Pavise bearer · **Origin:** Aubade (he) · **Position:** `grovehunter` / `lampglass` · `res_light` · melee 1.9 m phys · kit magic · difficulty 1 · bot `frontline`, 2 · palette `#CFCAC0` / `#8496A8`
**Job:** Tilts a pane of dawnglass that disarms the fighters swinging at his team.
**Silhouette (block, large 2.35 m):**
- A tall chalk-and-blued-steel knight with square shoulders and a flat-crowned helm with a glass visor.
- A dawnglass pavise (tower shield) taller than his shoulders on the left arm; a short spear in the right.
**Hook at 96 px:** the pavise is a 1.5 m tall pale rectangle beside him, the only shield in the roster. The spire tip on its top edge holds the accent.
**Weapon:** short spear and pavise, `one_hand`.
- **Passive: Turned Blades.** Each enemy fighter he disarms gives him +12 armor and magic resist for 5 s (max 3 stacks). [DSL: trigger `statusApplied` with `cond targetHasStatus disarm` → `buff` with `maxStacks:3`]
- **A1: Lancing Run.** Runs up to 7 m. The first enemy fighter he meets is knocked airborne for 0.75 s and takes magic damage. [DSL: `dash` direction, `stopOnFirstHit`, passFilter fighters → `displace airborne_in_place`, `damage`]
- **A2: Glare** (**unique: disarm**). Tilts the pavise to catch the dawn: enemies in a 5 m, 70° cone take magic damage, are disarmed for 1.25 s and slowed 25%. [DSL: `area` cone → `damage`, `status disarm`, `status slow`]
- **A3: Spire Strike.** Drives the pavise's spire down: magic damage within 2.5 m (+60% to monsters) and a 20% slow. [DSL: `area` → `damage {monsterMult:1.6}`, `status slow`]
- **Ultimate: Muster** (110 / 95 / 80 s). Raises the pavise as a beacon for 5 s.
  - Allied fighters within 6 m of him, himself included, gain 20% move speed and +25 armor and magic resist.
  - Every time an enemy fighter enters the 6 m radius, they are disarmed for 1 s.
  - [DSL: `zone` follow at self for allies and self → `buff`; `zone` follow at self for enemy fighters → onEnter `status disarm`]
**Presentation:** `lib_dash_trail` · `lib_cone_sweep` · `lib_slam_ground` · `lib_empower` · optional `ardit_a2_glare` (disarm has no lib preset) · ult `ardit_ult_muster` · `c_swing_light`, `c_shield`.
**Skins:**
- *Chalkline Pavise* (standard). Ink-grey steel `#3A3F47` with chalk line-work across the pavise frame; the glass stays clear.
- *First Bell Pavise* (deluxe). The pavise is etched with ten hour-marks; pale dial-stone armour over dark greaves keeps the value gradient. Extra geometry: a small glass bell above the spire tip.

### 10 · Ervet · Breaker (`ervet`)
**Title:** Glass blade · **Origin:** Aubade (she) · **Position:** `shadehold` / `dialcross` · `res_light` · melee 2.0 m phys · kit magic · difficulty 2 · bot `skirmisher`, 2 · palette `#B9C4CC` / `#5D6B7C`
**Job:** Shatters her own blade into the enemy line, fights fast with the hilt, then swings it whole again.
**Silhouette (inverted wedge, 2.1 m):**
- A heavy blued-steel shoulder mantle tapering to narrow greaves, and a tall slit glass visor.
- An oversized dawnglass greatsword carried point-low on her right side.
**Hook at 96 px:** a 1.6 m translucent blade. In Hilt form it becomes a short jagged stub, a deliberately different read. The accent is in the crossguard.
**Weapon:** greatsword, `two_hand`. Hilt form reuses the `two_hand` clips with the jab cast clip.

Two forms: `passive.forms.hilt` holds the hilt kit for a1–a3; `passive.forms.great` is the ultimate's oversized blade.

- **Passive: Dawnglass Edge.** Her attacks deal +2% of her max health as magic damage.
  - Whole: +15 armor and magic resist.
  - Hilt: +20% move speed and +30% attack speed, but −15 armor and magic resist.
  - [DSL: trigger `attackHit` → `damage magic {maxHp:0.02}`; stats on the passive; `forms.hilt.stats`]
- **A1: Heavy Arc** (whole) / **Quick Jab** (hilt).
  - Heavy Arc sweeps 3.5 m, 140°: magic damage and a 25% slow.
  - Quick Jab dashes 3 m and stops at the first enemy for magic damage.
- **A2: Glass Guard** (whole) / **Shard Kick** (hilt).
  - Glass Guard shields her for 10% of max health for 2 s.
  - Shard Kick kicks three shards in a 30° fan reaching 6 m: magic damage and a 15% slow each. [DSL: `projectile count:3 spreadDeg:30`]
- **A3: Shatter** (whole) / **Reform** (hilt) (**unique: she breaks her own weapon into a second kit**).
  - Shatter smashes the blade into the ground: magic damage within 3 m and a 40% slow. It leaves a shard field for 2 s that slows by 20%, and switches her to Hilt for up to 6 s.
  - Reform restores the blade early, dealing magic damage within 2 m.
  - [DSL: `form hilt duration:6`; Reform is `form hilt`, which toggles back to whole]
- **Ultimate: Whole Again** (100 / 85 / 70 s). Leaps up to 6 m, and the blade reforms oversized as she lands.
  - Enemies within 3.5 m take magic damage and are airborne for 0.75 s.
  - For 6 s her attacks cleave in a 120° arc and reach 0.6 m farther.
  - [DSL: `dash` toPoint → onArrive `area` → `displace airborne_in_place`; `form great duration:6` (`attackRange` +0.6); trigger `attackHit` with `cond inForm great` → `area` cone]
**Presentation:** `lib_cone_sweep` · `lib_shield_up` · `lib_shard_volley` · `lib_burst_lumen` · `lib_leap` · ult `ervet_ult_whole` · `c_swing_heavy`.
**Skins:**
- *Stillwater Blade* (standard). A river-glass blade `#8FB3A8` (hue 162) and wet-stone armour `#4D5A5C`.
- *Lamplit Blade* (deluxe). A smoked lampresin blade `#A38C6B` (34% saturation) and walnut armour `#5E4D3E`. Extra geometry: a lamp-cage pommel.

### 11 · Nurrow · Striker (`nurrow`)
**Title:** Lull singer · **Origin:** Serenade (she) · **Position:** `grovehunter` / `dialcross` · `res_tally` · melee 1.7 m phys · kit magic · difficulty 3 · bot `burst`, 2 · palette `#3E3440` / `#8C6F5A`
**Job:** Sings everyone around her target to sleep and takes the one left awake.
**Silhouette (forward diagonal, 1.8 m):** lean and crouched forward. A wide conical lacquered hat shaped like a lamp snuffer is tilted forward over a carved sleeping-face mask, and the points of a felt mantle trail behind.
**Hook at 96 px:** the 70 cm snuffer cone tilted forward reads as an off-centre point from above. The accent is on its iron rim.
**Weapon:** a curved snuffer-blade, `one_hand`.
- **Passive: Quiet Kill.** When she gets a takedown, enemy fighters within 5 m of her fall asleep for 1 s. [DSL: trigger `takedown` → `area` circle 5 at self, fighters → `status sleep`]
- **A1: Felt Step.** Lunges up to 4 m toward a point; the first enemy she reaches takes magic damage. [DSL: `dash` toPoint, `stopOnFirstHit` → onPass `damage`]
- **A2: Lullaby Dart.** A dart reaching 8 m puts the first enemy fighter to sleep for 1.25 s; damage wakes them. It deals no bonus damage on waking. [DSL: `projectile` with a fighters filter → `status sleep`]
- **A3: Snuff** (35 Tally). Snuffs an adjacent enemy: magic damage and a 1 s silence. [DSL: unit target → `damage`, `status silence`]
- **Ultimate: Lull the Rest** (**unique: she isolates a target by putting the others to sleep**; 110 / 95 / 80 s).
  - She names an enemy fighter within 6 m and lunges to them, dealing magic damage to them.
  - Every **other** enemy fighter within 5 m of them falls asleep for 2 s.
  - [DSL: `mark chosen` to target; `dash` toTarget → onArrive `damage` to target; `area` circle 5 at target, fighters → `if not targetHasMark chosen` → `status sleep`]
**Presentation:** `lib_dash_trail` · `lib_thrown_blade` · `lib_silence` · optional `nurrow_a2_lullaby` (sleep has no lib preset) · ult `nurrow_ult_lull` · `c_swing_light`, `c_cast_shade`.
**Skins:**
- *Noon Fair Snuffer* (standard). The hat is painted with lacquer moths in rose-lilac `#B48AA6` and chalk; the mask has painted half-lids.
- *Shadeprint Snuffer* (deluxe). An ink hat `#2B2A33` with a light rim and a pale mask `#B7B4BE`. `vfxTint` `#6C5BA8`.

### 12 · Lisvel · Slinger (`lisvel`)
**Title:** Morning archer · **Origin:** Aubade (she) · **Position:** `shaftlight` / `lampglass` · `res_light` · ranged 5.9 m phys · kit phys · difficulty 1 · bot `marksman`, 5.9 · palette `#D8D2C2` / `#8E9AA6`
**Job:** Shoots from far back and leaves lines of morning light her team can run along.
**Silhouette (horizontal, 1.85 m):** a slim archer holding a 1.9 m ash longbow level across her body, with a gull-feather quiver at the hip and a flat glass visor band.
**Hook at 96 px:** the level longbow is the longest thin horizontal in the roster. Its glass tips hold the accent.
**Weapon:** longbow, `bow`.
- **Passive: Reach of Morning.** Each ability that hits an enemy fighter adds +0.4 m attack range for 5 s (max 3 stacks). [DSL: trigger `abilityHit` with a fighters filter → `buff {range:0.4}` with `maxStacks:3`]
- **A1: Dawn Line** (**unique: speed lines for allies**). A piercing arrow reaching 10 m deals phys damage to every enemy on its path, and the path stays lit for 3 s.
  - Allies on the path, herself included, move 25% faster.
  - Enemies crossing it are slowed 15%.
  - [DSL: `projectile` pierce 5; `zone` rect 10×1.2 at self → allies and self `status haste`; a second `zone` for enemies → `status slow`]
- **A2: Backstep.** Hops 3 m away from the cursor. Her next attack within 3 s reaches 2 m farther and slows by 25%. [DSL: `dash` away; `buff empowerAttacks {count:1, rangeBonus:2}`]
- **A3: Morning Draw.** Gains 40% attack speed for 4 s. [DSL: `buff`]
- **Ultimate: Sun Corridor** (100 / 85 / 70 s). After 0.75 s a 14 m × 3 m shaft of light lands (edge marker past 10 m): phys damage and a 40% slow.
  - The corridor stays for 5 s.
  - Allies inside move 30% faster.
  - She gains 20% attack speed while she stands in it.
  - [DSL: `area` rect, delay 0.75; `zone` rect for allies → `status haste`; `zone` filter `{enemies:false, self:true}` → `buff`]
**Presentation:** `lib_arrow` · `lib_haste` · `lib_dash_trail` · `lib_empower` · ult `lisvel_ult_corridor` · `c_shot_bow`.
**Skins:**
- *Gorgewalk Longbow* (standard). Slate-grey limbs bound with rigid gorge-rope and an iron-pinned quiver.
- *Almanac Longbow* (deluxe). Parchment-printed limbs `#D8CDB4` and ink fletching `#2E2A26`. Extra geometry: arrows fletched with rigid page-cut plates.

### 13 · Ulkro · Slinger (`ulkro`)
**Title:** Dart hunter · **Origin:** Hourless (she) · **Position:** `shaftlight` / `grovehunter` · `res_tally` · ranged 5.4 m phys · kit phys · difficulty 3 · bot `marksman`, 5.4 · palette `#6B6052` / `#A39C8C`
**Job:** Never stops moving: every stride she runs loads her next throw.
**Silhouette (horizontal, 1.85 m):** a lean hunter in a deep hood. A long spear-thrower lies across her forearm with a 1.6 m dart laid along it, and a fan of darts stands upright in a back quiver.
**Hook at 96 px:** a crest of five radiating dart shafts behind the hood, over a horizontal thrower. The dart heads hold the accent.
**Weapon:** spear-thrower (atlatl), `one_hand`.
- **Passive: Run-up** (**unique: throws charged by the distance she runs**). Every 4 m she runs adds a Run-up stack (max 4). [DSL: trigger `moveDistance`, interval 4 → `counter runup add:1 max:4`]
- **A1: Hurl.** Throws a long dart along a 10 m line: phys damage, +25% per Run-up stack, and spends the stacks. [DSL: `projectile` → `damage` with `perCounter {counter:runup, per:0.25}` (see §7.3); `counter runup reset`]
- **A2: Bound.** Leaps 4 m and gains 2 Run-up stacks. [DSL: `dash` toPoint; `counter runup add:2`]
- **A3: Hamstring Dart** (35 Tally). A dart into an enemy within 6 m slows them by 40% for 2 s and reveals them for 4 s. [DSL: unit target → `status slow`, `reveal`]
- **Ultimate: Long Run** (40 Tally; 90 / 75 / 60 s). For 5 s she runs 35% faster, and every 3 m she runs a dart flies at the nearest enemy within 7 m. [DSL: `form long_run duration:5` (stats); trigger `moveDistance` interval 3, `cond inForm long_run` → `area` circle 7, `maxTargets:1` → `projectile` homing toward target]
**Presentation:** `lib_arrow` · `lib_leap` · `lib_reveal_mark` · `lib_haste` · ult `ulkro_ult_run` · `c_thrown`.
**Skins:**
- *Highrim Thrower* (standard). Sandstone wraps `#CDBB9C`, a bleached thrower and pale dart shafts.
- *Long Evening Darts* (deluxe). A plum hood `#5B3A5E` and smoked-amber dart heads `#9C8566`. Extra geometry: a rigid lacquered fan behind the quiver.

### 14 · Tunlan · Caster (`tunlan`)
**Title:** Shadow puppeteer · **Origin:** Serenade (she) · **Position:** `dialcross` / `shaftlight` · `res_heat` · ranged 5.2 m magic · kit magic · difficulty 2 · bot `burst`, 6.5 · palette `#463C38` / `#B49A78`
**Job:** Throws lamp-shadows of beasts over the enemy line and sends them running.
**Silhouette (line + disc, 2.05 m):** tall and narrow, under a wide flat lampshade hat 1 m across with a lamp hanging beneath its front brim before her mask. Long jointed fingers make the shadow gestures.
**Hook at 96 px:** a wide flat disc with a bright point at its front edge. The lamp is the accent.
**Weapon:** lamp and hands, `focus`.
- **Passive: Startle.** The first time each 8 s that she hits an enemy fighter with an ability, they are slowed 40% for 1 s. [DSL: trigger `abilityHit` with a fighters filter and `perTargetCooldown` 8 → `status slow`]
- **A1: Hound Shadow** (+20 Heat). A shadow hound runs 9 m along the ground: magic damage to every enemy it touches, and they are feared for 0.6 s. [DSL: `projectile` with pierce → `damage`, `status fear`]
- **A2: Hand Shadow** (+25 Heat). A shadow hand grips an enemy within 7 m: magic damage and a 60% slow fading over 1.5 s. A feared target is stunned for 1 s instead. [DSL: unit target → `if targetHasStatus fear` → `status stun`, else `status slow decay`]
- **A3: Lamp Flare** (+20 Heat). Flares the lamp: enemies within 3 m are pushed back 1.5 m and slowed 30%. [DSL: `area` → `displace` knockback, `status slow`]
- **Ultimate: Shadow Play** (**unique: fear shapes cast by a lamp**; 110 / 95 / 80 s, +30 Heat). After 0.6 s an enormous shadow-beast fills a 9 m, 50° cone: magic damage and fear for 1.5 s. [DSL: `area` cone, delay 0.6 → `damage`, `status fear`]
**Presentation:** `lib_orb_shade` · `lib_burst_shade` · `lib_ring_pulse` · `lib_stun_ring` · optional `tunlan_a1_hound` (fear has no lib preset) · ult `tunlan_ult_play` · `c_cast_shade`.
**Skins:**
- *Noon Fair Puppets* (standard). A painted paper lampshade hat in rose-lilac `#B48AA6` and chalk. Extra geometry: two rigid puppet rods at the belt.
- *Lamplit Shadows* (deluxe). A walnut shade-hat `#5E4D3E` with lampresin panels `#A38C6B`. `vfxTint` `#6A5C7A` (hue 268) keeps her shadows out of the harm band.

### 15 · Vashil · Caster (`vashil`)
**Title:** Bell ringer · **Origin:** Aubade (he) · **Position:** `dialcross` / `shaftlight` · `res_light` · ranged 5.3 m magic · kit magic · difficulty 1 · bot `artillery`, 7 · palette `#E1DCCF` / `#A7B5C2`
**Job:** Rings wide notes over the enemy front line; anyone struck by two of them stops cold.
**Silhouette (line + disc, 2.05 m):** tall and straight, with a halo of seven small glass bells on a chalk ring above his visor, and a long striking rod.
**Hook at 96 px:** the 0.8 m bell halo is a bright ring above the head. The accent is in the clappers.
**Weapon:** striking rod, `staff`.
- **Passive: Hum** (**unique: a two-note stun**). His abilities leave enemies humming for 3 s. Hitting a humming enemy fighter with another ability stuns them for 0.75 s and clears the hum, once per 8 s per enemy.
  - [DSL: trigger A `abilityHit` with `cond targetHasMark hum` and `perTargetCooldown` 8 → `consumeMark` → `status stun`; trigger B `abilityHit` with `cond not targetHasMark hum` → `mark hum 3s`]
- **A1: Peal.** After 0.4 s a ring of sound lands at a point up to 9 m away. Enemies between 1.5 m and 3.5 m from its centre take magic damage and are slowed 30%; the centre stays quiet. [DSL: `area` ring `{radius:3.5, inner:1.5}`, delay 0.4]
- **A2: Glass Chime.** A fast chime-bolt reaching 9 m: magic damage to the first enemy. [DSL: `projectile`]
- **A3: Ring Out.** Swings the rod: enemies in a 3.5 m, 90° cone take magic damage and are pushed back 2 m. [DSL: `area` cone → `displace` knockback]
- **Ultimate: Morning Toll** (100 / 85 / 70 s). Tolls a great bell over a 4.5 m area up to 9 m away, three times 0.75 s apart. Each toll deals magic damage, and the second toll stuns through Hum. [DSL: `repeat` 3, interval 0.75 → `area` circle 4.5 at point]
**Presentation:** `lib_ring_pulse` · `lib_bolt_lumen` · `lib_cone_sweep` · `lib_stun_ring` · ult `vashil_ult_toll` · `c_cast_lumen`.
**Skins:**
- *Chalkline Bells* (standard). An ink-grey robe `#3A3F47` with chalk line-work; the bells stay clear glass.
- *First Bell Halo* (deluxe). Ten bells instead of seven, one per FRAY hour-mark. Pale dial-stone robe over a dark hem keeps the value gradient. Extra geometry: the three extra bells stay inside the halo's footprint.

### 16 · Sukri · Tender (`sukri`)
**Title:** Rim wanderer · **Origin:** Hourless (he) · **Position:** `lampglass` · `res_light` · ranged 5.0 m magic · kit magic · difficulty 2 · bot `sustain`, 5 · palette `#7B7266` / `#D9CDA8`
**Job:** Draws a caught ally back to the group; when he falls low, nobody beside him can be touched for a breath.
**Silhouette (round + light vessel, compact 1.65 m):** a round, hooded wanderer in thick rigid wraps. A glass cup of noon light hangs from the crook of a walking staff at chest height.
**Hook at 96 px:** the swinging cup is a bright low-centre point under a wide round hood. The accent is in the cup.
**Weapon:** walking staff, `staff`.
- **Passive: Spare Hour.** Once every 90 s, when he drops below 30% health, he and allied fighters within 6 m become untargetable for 1 s. [DSL: trigger `lowHp`, cooldown 90 → `area` circle 6 at self, allies and self → `status untargetable 1`]
- **A1: Mote Toss.** Tosses a mote up to 8 m. After 0.5 s, allies within 2.5 m heal and enemies take magic damage. [DSL: two `area`s at point, delay 0.5: one allies-and-self → `heal`, one enemies → `damage`]
- **A2: Draw Near** (**unique: displacing an ally to save them**). Draws an allied fighter up to 5 m toward him and shields them for 2 s. Cast on himself, it only shields. [DSL: unit target, allies and self → `displace pull 5` to target, `shield` to target]
- **A3: Wrap Cast.** Throws a weighted wrap reaching 8 m: the first enemy fighter is rooted for 1.25 s and takes magic damage. [DSL: `projectile` with a fighters filter → `status root`, `damage`]
- **Ultimate: Gather In** (120 / 100 / 80 s). Every allied fighter within 10 m is drawn up to 4 m toward him and shielded for 4 s. A 4 m ring of dust then slows enemies around him by 30% for 2 s. [DSL: `area` circle 10, allies and self → `displace pull 4`, `shield`; `zone` circle 4 at self → `status slow`]
**Presentation:** `lib_lob` · `lib_heal_rise` · `lib_shield_up` · `lib_root_bind` · optional `sukri_passive_spare` (untargetable has no lib preset) · ult `sukri_ult_gather` · `c_heal`, `c_shield`.
**Skins:**
- *Stillwater Wanderer* (standard). Wet-stone wraps `#59666A` and a river-glass cup `#8FB3A8`. Extra geometry: rigid reed plates on the hood.
- *Shadeprint Wanderer* (deluxe). Ink wraps `#2B2A33` with light rims and a pale hood `#B7B4BE`, with a cup of violet light: `vfxTint` `#6C5BA8`.

**Skin rules applied to all 32 skins:**
- **What every skin keeps (bible / tokens `fighter.skins.keep`):** the rig, clips and timing; the silhouette class (height within ±5%, footprint within ±10%); the accent location; the value gradient; the telegraphs.
- **Hue check:** every hex above was checked against the reserved HSV bands (ally 200–225, harm 28–50, heal 125–150, tritan 340–350). Every colour inside a band stays at or below 40% saturation. No skin uses a pure-white body or a single saturated full-body colour.
- **Skin lines:**
  - **Standard** (3–4 fighters each): Gorgewalk (gorge-keepers of Needlespan), Stillwater (the Fallen Shaft shallows), Chalkline (Aubade chalk drawings), Noon Fair (the Shadowless Noon festival) and Highrim (the wind-carved rim).
  - **Deluxe:** Almanac (the season pass), Long Evening (the Serenade dusk festival), Shadeprint (ink with a light rim), First Bell (the FRAY winners' honour) and Lamplit.

---

## 4. Distinctness matrix

| # | Fighter | Core mechanic (DSL signature) | Passive: trigger → effect | Ultimate: shape → effect | Hard CC | Mobility | Plays alone in FRAY with |
|---|---|---|---|---|---|---|---|
| 1 | Marund | no-entry dome (`zone blocks:'enemies'`) | `interval` → ally regen aura | leap; landing flings out + stun | stun, root, knockback | charge, leap | Shelter Dome on himself |
| 2 | Burdam | marks written by attackers | `damageTaken` → Grudge on attacker; `attackHit` vs Grudge → heal + Tally | pull every marked enemy; damage per stack | stun, pull | lunge | Settled Account |
| 3 | Rishal | dash tracks that Cut on crossing (`zone onEnter`) | `attackHit` cashes Cuts → damage + vents Heat | 9 m unstoppable rush leaving a long track | none (slows) | 2-charge dash, back-dash, rush | tracks behind his escape |
| 4 | Odrum | resin pools that root if still standing in them when they set (`onExpire`) | `statusApplied` root → armor/resist shred | big setting pool | root | hop | pools zone off third parties |
| 5 | Dunsom | displacement toward a chosen point (`toward_point`) | `statusApplied` airborne → Settled mark → bonus damage | hurl nearby enemies to a point that erupts | root, displacement | blink | Driving Hour |
| 6 | Ilsheta | healing zone that rides on an ally (`zone follow` at target) | `abilityHit` on a crowd-controlled ally → extra heal + haste | lamps on every nearby ally | none (slows) | none | Hung Lamp on herself |
| 7 | Hesmi | directional shadow strip that topples (`zone rect` + `onExpire`) | `attackHit` vs Shaded → % max-hp damage | great shard: stun + huge shadow field | stun, knockback | lunge | Stand Firm and her shadows |
| 8 | Kemdo | cooling on demand (`costKind:'none'`, castable overheated) | `takedown` → vent all Heat | burning spot that follows one enemy (`zone follow`, true damage) | knockback | dash | Cooling Kill chains fights |
| 9 | Ardit | disarm | `statusApplied` disarm → stacking armor/resist | follow aura: allies buffed, entering enemies disarmed | airborne, disarm | run | Glare and Muster |
| 10 | Ervet | breaks her weapon into a second kit (`form`) | `attackHit` → % own max-hp magic; per-form stats | leap slam + oversized-blade form | airborne | jab dash, leap | two speeds for duels |
| 11 | Nurrow | sleeps everyone except the target (`mark` + `if not`) | `takedown` → sleep nearby enemies | lunge + sleep everyone near the target but the target | sleep, silence | lunge ×2 | Quiet Kill |
| 12 | Lisvel | piercing shots that leave ally haste lines | `abilityHit` → stacking attack range | broad shaft + haste corridor | none (slows) | backstep | lines speed her too |
| 13 | Ulkro | distance run charges the throw (`moveDistance` counter) | `moveDistance` → Run-up stacks | running form auto-fires darts per 3 m | none (slow, reveal) | leap | kiting |
| 14 | Tunlan | fear shapes thrown by a lamp | `abilityHit`, per-target cooldown → slow | cone fear | fear, stun, knockback | none | Shadow Play |
| 15 | Vashil | two-note stun (Hum) | `abilityHit` → hum mark / stun | three tolls on one area | stun, knockback | none | Peal and Toll zone |
| 16 | Sukri | pulls an ally to safety (`displace pull` on ally) | `lowHp` → group untargetable 1 s | team-wide gather + shields | root | none | self-shield, Spare Hour |

Checks:
- **Cores:** no two fighters share one. The roster has one each of no-entry, disarm, sleep, fear, ally displacement, form-shatter, setting pools, toppling shadows, following zone on an enemy, following zone on an ally, counter from distance run, and the two-hit stun. The two "follow" users (Kemdo, Ilsheta) differ in target (enemy versus ally) and in effect (true damage versus heal).
- **Passives:** each passive is unique.
  - Three passives pay off on attacks against a marked enemy: Burdam, Rishal and Hesmi. Each mark has a different source (being hit; stepping across a track; standing in shade). Each payoff also differs (heal plus Tally; damage plus Heat venting; % max-hp damage).
  - Three use `statusApplied` and react to different statuses: root, airborne and disarm.
  - Four use `abilityHit`. Their effects are an ally heal, a range buff, a slow and a mark-then-stun.
- **Ultimates:** each one is unique. Two ultimates pull: Burdam drags enemies toward himself, and only marked ones; Sukri draws allies. Two are cones: Tunlan's fear cone and Vashil's tolls on an area. Two create a field after an impact: Hesmi's is a shadow strip and Odrum's is a pool that sets.

---

## 5. Originality self-audit

The mechanics used are public systems: dash, skillshot, slow, stun, shield, root, sleep, fear, disarm, form switch and zone. The audit below checks **combinations** against the shipped kits I could think of. I name 2–3 neighbours per fighter.

| Fighter | Closest shipped kits | Why it is not a copy |
|---|---|---|
| Marund | **Braum** (LoL), **Galio** (LoL), **Disruptor** (Dota) | **Braum:** blocks projectiles with a raised shield, dashes to an ally and stuns with stacks; Marund has none of these. **Galio:** flies to an ally's position for his ultimate. **Disruptor:** Kinetic Field traps units inside a ring. Marund's dome does the reverse of Disruptor's: it keeps enemies out while allies move freely. His ultimate leaps to ground he picks and flings enemies outward. |
| Burdam | **Darius** (LoL), **Sett** (LoL), **Legion Commander** (Dota) | **Darius:** stacks come from his own hits and his ultimate is a single-target execute with a reset. **Sett:** stores damage taken for one punch. **Legion Commander:** counter-attacks and has a 1v1 Duel. Burdam's marks are written by the enemy who hits him, are spent by his attacks for healing, and his ultimate drags every marked enemy at once, with no execute, reset or duel. |
| Rishal | **Akali** (LoL), **Irelia** (LoL), **Batrider** (Dota) | **Irelia:** her dash resets on marked targets. **Akali:** her kit is a stealth shroud and dashes. **Batrider:** Firefly leaves a fire trail that damages over time. Rishal's tracks fire once on crossing, build Cuts that his attacks cash in for Heat, and have no reset or stealth. |
| Odrum | **Caitlyn** (LoL), **Jhin** (LoL), **Varus** (LoL) | **Caitlyn:** pre-placed traps root on contact, Headshot rewards trapped targets, and her ultimate is a snipe. **Jhin:** traps slow, then detonate. **Varus:** his ultimate root spreads to nearby enemies. Odrum's resin is lobbed and only roots those who stay until it sets. He has no traps, headshot or snipe, and his passive shreds rooted targets for the team. |
| Dunsom | **Orianna** (LoL), **Dark Seer** (Dota), **Magnus** (Dota) | **Orianna:** pulls toward a ball she controls. **Dark Seer:** Vacuum gathers units to a point. **Magnus:** Skewer drags and Reverse Polarity stuns in front of him. Dunsom has no proxy object, and his ultimate throws enemies **from around him to a point he chooses**, which then erupts. The player chooses where the fight goes, rather than pulling everyone toward the caster. |
| Ilsheta | **Yuumi** (LoL), **Juggernaut**'s Healing Ward (Dota), **Karma** (LoL) | **Yuumi:** attaches herself to an ally. **Healing Ward:** a separate unit that the player moves. **Karma:** Inspire shields and speeds an ally, the same generic tool as Ilsheta's A3. Ilsheta stays separate and targetable; her lamp is a timed zone riding on the ally. Her passive rewards healing crowd-controlled allies, and her ultimate lights every nearby ally at once. |
| Hesmi | **Trundle** (LoL), **Earthshaker** (Dota), **Ornn** (LoL) | **Trundle:** his pillar blocks movement and slows nearby units. **Earthshaker:** Fissure makes an impassable line and stuns. **Ornn:** makes terrain pillars. Hesmi's shard blocks nothing. It throws a directional shadow that slows and marks, and later topples along that shadow (a delayed stun). Her passive pays off in her own shade. |
| Kemdo | **Rumble** (LoL), **Huskar** (Dota), **Phoenix** (Dota) | **Rumble:** high Heat empowers his spells, and overheating silences him while empowering his attacks. **Huskar:** abilities cost health. **Phoenix:** Sun Ray is a beam. Kemdo has no empowered Heat state at all. Vent is a free cooldown that dumps Heat and works while overheated, takedowns cool her, and her ultimate pins a burning spot to one enemy. |
| Ardit | **Leona** (LoL), **Keeper of the Light** (Dota), **Alistar** (LoL) | **Leona:** her kit is a stun-on-attack shield, Zenith Blade and Solar Flare. **Keeper of the Light:** Blinding Light knocks back and causes misses. **Alistar:** Headbutt and Pulverize. Ardit's control is disarm in a cone. His dash knocks up the first fighter, and his ultimate is an aura that disarms enemies as they enter. There is no stun-on-attack and no delayed sun-burst. |
| Ervet | **Kled** (LoL), **Gnar** (LoL), **Jayce** (LoL) | **Kled:** loses and regains his mount. **Gnar:** transforms when his rage fills. **Jayce:** switches between melee and ranged at will. Ervet breaks her own weapon on purpose, both her forms are melee, the reform is timed or manual, and her ultimate is a leap slam that oversizes the blade. |
| Nurrow | **Lillia** (LoL), **Zoe** (LoL), **Naga Siren** (Dota), **Mordekaiser** (LoL) | **Lillia and Zoe:** their sleeps add bonus true damage to the hit that wakes the target. **Naga Siren:** her song sleeps everyone around her. **Mordekaiser:** isolates a 1v1 in another realm. Nurrow's sleeps give no wake bonus, and her ultimate sleeps everyone around a target **except** the target. That isolates the target without a separate realm. |
| Lisvel | **Ashe** (LoL), **Ezreal** (LoL), **Varus** (LoL) | **Ashe:** Volley, Hawkshot reveal and a global stun arrow. **Ezreal:** a long Trueshot Barrage line. **Varus:** a charged piercing shot. Lisvel's piercing shots leave speed lines for allies, and her ultimate is a lasting haste corridor. She has no stun arrow, no reveal shot and no frost slow. |
| Ulkro | **Gyrocopter** (Dota), **Zeri** (LoL), **Hoodwink** (Dota) | **Gyrocopter:** Rocket Barrage fires on a timer. **Zeri:** her ultimate chains attacks while she runs fast. **Hoodwink:** a nimble ranged hunter. Ulkro's charge comes from **distance run**, spent in one long throw. Her ultimate fires per 3 m travelled, not per second. |
| Tunlan | **Fiddlesticks** (LoL), **Dark Willow** (Dota), **Vex** (LoL) | **Fiddlesticks:** fear tied to his scarecrow effigies. **Dark Willow:** Bramble Maze roots and Terrorize fears around a point. **Vex:** a fear passive. Tunlan's fears are a line and a cone cast from her own lamp. Her hand turns fear into a stun, and she runs on Heat. I deliberately did not give her a root zone, to keep her away from Dark Willow. |
| Vashil | **Annie** (LoL), **Seraphine** (LoL), **Darius** (LoL) | **Annie:** stuns on every fourth spell she casts. **Seraphine:** her shield-and-haste A3 was the risk; I dropped that tool for Ring Out. **Darius:** his Decimate hits hardest at its edge, like a ring. Vashil's stun needs two hits on the same enemy within 3 s, with an 8 s lockout per enemy. His Peal is a ring cast at range, and his ultimate tolls three times on one area. |
| Sukri | **Kalista** (LoL), **Thresh** (LoL), **Kindred** (LoL) | **Kalista:** her ultimate pulls only her bound ally. **Thresh:** his lantern needs the ally to click it. **Kindred:** Lamb's Respite is a zone where nobody can die. Sukri pulls any ally with a point-click shield, his ultimate gathers the whole team, and Spare Hour is a 1 s untargetable burst at his own low health, not a no-death zone. |

Ability, passive, title and skin names were written for this game and checked (section 6). I renamed four of them on the way:
- **Sanctum**: a LoL UI term (exact deny-list hit).
- **Dart** and **Drive**: these words sit inside longer protected ability or item names. Policy allows that, but I renamed them anyway.
- **Wayfarer**: it sits inside a protected skin phrase.

---

## 6. Name verification (2026-10-07)

**Rules (WORLD.md §4.2), checked by `scratchpad/roster_names.py`:**
- The 16 initials A B D E H I K L M N O R S T U V are each used once.
- Only allowed letters are used.
- 15 names have two syllables and one has three (Ilsheta).
- No two names share their first two letters or their last three letters.
- No banned endings or onsets.
- Each name follows its origin's vowel and ending rules.
- Every name is at least edit distance 3 from every name in `lol_champions`, `dota_heroes`, `other_moba` and `spelling_variants` (each word of a multi-word name checked too).
- `grep -i` finds zero substring hits in `protected_names.json`.
- One name uses w (Nurrow); none uses g or p.

**`node tools/names_check.ts`:** clean (exit 0) on:
- all 16 names;
- 131 other coined strings, checked as names: every passive, ability, form variant, title and skin name in section 3;
- the 16 fight-job sentences, checked as prose.

**Web checks:** 19 of the 20 allowed searches.

| Name | Result |
|---|---|
| Marund, Hesmi, Ardit, Kemdo, Ervet, Nurrow, Lisvel, Ilsheta, Odrum, Burdam, Vashil, Tunlan, Dunsom, Sukri | No game character found. "Ardit" is an Albanian given name. "Rishaal Tamir" is a minor Battlespire NPC, not a match for Rishal. |
| Ulkro | No exact match. The nearest are Ulki (a Fire Emblem side character) and Ultros (FF6), at edit distance 2 from Ulkro. Kept as not a famous match. |

**Rejected after checking:**

| Candidate | Why it was rejected |
|---|---|
| Bulmor | 2 edits from Bulma (Dragon Ball) |
| Visha | Nickname of a lead character in *The Saga of Tanya the Evil* |
| Umbri | 1 edit from Umbra (a Rogue Company hero) |
| Ustro | Near Ultros (FF6) and Ostro (SMB2) |
| Unsho | Given name of a famous voice actor |
| Dunmor | 1 edit from Dunmer (The Elder Scrolls) |

Many more candidates failed the edit-distance rule (for example Avrel ~ Yrel, Bramund ~ Brand, Hendo ~ Hanzo); the full log is in the scratchpad run.

Sources:
- [Ardit (Wikipedia)](https://en.wikipedia.org/wiki/Ardit)
- [Rishaal Tamir (UESP)](https://en.uesp.net/wiki/Battlespire:Rishaal_Tamir)
- [Visha / Viktoriya Serebryakov](https://mywaifulist.moe/waifu/viktoriya-ivanovna-serebryakov)
- [Umbra (Rogue Company)](https://www.thesixthaxis.com/2021/11/17/rogue-company-new-character-umbra-revealed-in-trailer/)
- [Ultros (Giant Bomb)](https://giantbomb.com/wiki/Characters/Ultros)
- [Ulki (Fire Emblem wiki)](https://breezewiki.discard.no/fireemblem/wiki/Ulki)
- [Unshō Ishizuka (JoJo wiki)](https://jojowiki.com/Unsho_Ishizuka)
- [Ostro (Mario wiki)](https://www.mariowiki.com/Ostro)
- [Bulma (Kanzenshuu)](https://kanzenshuu.com/rumor/bulma-playable-character-dragon-ball-z-budokai-3)

---

## 7. Notes for the lanes that build this

### 7.1 SIM: confirm `abilityHit` on ally targets
Ilsheta's Warm Hands needs `abilityHit` to fire when her heal or zone affects an ally. If it fires only on damage, put the bonus inside each heal as `if any[targetHasStatus …]`. The behaviour does not change.

### 7.2 Effect order inside one list
Rishal, Kemdo and Lisvel lay a `zone` at self **before** the `dash` in the same list, so the track starts where the dash starts. Nurrow's `mark chosen` must run before her `area`.

### 7.3 Run-up scaling
`perCounter` multiplies the whole value by `stacks × per` (CONTRACT §5.3). Hurl therefore needs **two** damage effects: a base hit, plus a second `damage` with `perCounter {counter:runup, per:0.25}`. A single scaled damage effect would deal zero at 0 stacks.

### 7.4 Ally displacement
Draw Near and Gather In apply airborne to allies, which interrupts a windup they are casting (CONTRACT §5.3, casting). This is intended, so keep the pull short (≤ 5 m, 0.25 s). Note this in the ability text.

### 7.5 VOCAB lane
Disarm, sleep, fear and untargetable have no `lib_*` status preset. Each fighter uses an optional bespoke `<id>_<slot>_<word>` preset as VOCAB allows. If LEAD prefers shared presets, `lib_disarm`, `lib_sleep`, `lib_fear` and `lib_untargetable` would need a VOCAB note.

### 7.6 SESSION
At 16 fighters, BRIDGE deals the whole roster every match (§2.2). Add the constrained-random check before launch, or drop `bench.size` to 2 to keep a free pool of 2 for rerolls.

### 7.7 ART silhouette pairs to test first (IoU ≤ 0.80 at 64 px)

| Pair | Difference |
|---|---|
| Marund / Ardit | flat dome-cap over the shoulders versus a tall pavise beside the body |
| Ilsheta / Sukri | chimney visor (vertical) versus wide hood with a low cup |
| Vashil / Tunlan | bell ring above the head versus a wide flat lampshade |
| Lisvel / Odrum | thin bow at waist height versus a yoke at shoulder height |

### 7.8 BOTS
`ai.style` and `preferredRange` are given per fighter. Nurrow's ultimate wants `minTargets: 2`, so the bot casts it only when there are bystanders to sleep. Dunsom's ultimate wants an allied area effect or a structure at the point.

### 7.9 CONTENT
- Fighter ids are the lowercase names. None of them appears anywhere in `src/`, `_harness/`, `tools/` or `content/` today (grep), so `probe_content_ids` stays clean.
- Mark, counter, form and zone ids should be prefixed with the fighter id (for example `burdam_grudge`, `ervet_hilt`) to stay unique catalog-wide.

---

## Split

The roster is ordered so that each half is a complete Rift team, one fighter per position, with a similar workload.

| Half | Fighters (# · name · class · difficulty) | Mix | Workload |
|---|---|---|---|
| **A (1–8)** | 1 Marund (Plinth, d1) · 2 Burdam (Breaker, d1) · 3 Rishal (Striker, d3) · 4 Odrum (Slinger, d2) · 5 Dunsom (Caster, d3) · 6 Ilsheta (Tender, d1) · 7 Hesmi (Plinth, d2) · 8 Kemdo (Breaker, d2) | P2 B2 St1 Sl1 C1 T1 · difficulty total 15 · melee 5, ranged 3 · Serenade 4, Aubade 2, Hourless 2 · all four resources | 40 ability records; heavier on zones: Rishal's tracks, Odrum's pools, Hesmi's shadows, Ilsheta's and Kemdo's follow zones, Marund's blocking dome |
| **B (9–16)** | 9 Ardit (Plinth, d1) · 10 Ervet (Breaker, d2) · 11 Nurrow (Striker, d3) · 12 Lisvel (Slinger, d1) · 13 Ulkro (Slinger, d3) · 14 Tunlan (Caster, d2) · 15 Vashil (Caster, d1) · 16 Sukri (Tender, d2) | P1 B1 St1 Sl2 C2 T1 · difficulty total 15 · melee 3, ranged 5 · Aubade 4, Serenade 2, Hourless 2 · Light, Tally, Heat | 43 ability records; heavier on forms (Ervet's hilt and great forms, Ulkro's run form) and conditional statuses (Nurrow's isolation, Vashil's Hum, Tunlan's fear-to-stun) |

Each half can field a full team on its own:
- **Half A:** Burdam or Hesmi at Shadehold · Kemdo at Grovehunter · Rishal or Dunsom at Dialcross · Odrum at Shaftlight · Marund or Ilsheta at Lampglass.
- **Half B:** Ervet at Shadehold · Ardit or Nurrow at Grovehunter · Tunlan or Vashil at Dialcross · Lisvel or Ulkro at Shaftlight · Sukri at Lampglass.

Either half can therefore be built, played with bots and probed before the other is finished.
