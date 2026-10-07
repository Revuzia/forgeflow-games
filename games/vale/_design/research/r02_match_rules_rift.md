# R02 - Match Rules of the Classic 5v5 Three-Lane Map

**Reference:** League of Legends (LoL) as it stands in 2026, with Dota 2 for contrast
**For:** VALE (an original browser lane-brawler built on Three.js/WebGL2)
**Compiled:** 2026-10-07
**Status:** Systems reference only. These numbers help calibrate our own design. They are not values to copy.

---

## 0. How to read this document and its limits

- Every claim carries a citation [n] to the Sources list at the end. A claim marked **[unverified]** comes from general genre knowledge that I could not confirm in this session. Treat it as a hypothesis to check before any design decision depends on it.
- **Research limits in this run:** the network egress proxy blocked every WebFetch, including leagueoflegends.com, wiki.leagueoflegends.com, sheepesports, escorenews, riftpatchnotes and mobabuilds. The shared web-search budget also ran out partway through. Everything below therefore comes from search-result snippets. The **Dota 2 section and the LoL item, rune and summoner-spell, vision-detail and surrender sections are mostly [unverified]**, and a follow-up pass should confirm them.
- Several community sources disagree on exact breakpoints, for example when siege minions start spawning more often. I report those disagreements rather than picking one side.
- I describe how systems work in my own words. Proper names (champions, monsters, items, buffs, map features) appear only so we can tell what a source means. They are **protected expression and must not be reused in Vale** (see section 14b).

---

## 1. The big picture: what changed in LoL for 2026

The 2026 cycle is the most systemic rework in years, so any reference based on 2024-2025 is partly out of date.

- **Faster start.** Games now start about 35 s sooner. Minions first spawn at **0:30** instead of 1:05, and the first jungle camps come forward by the same amount [4][49][1].
- **Fewer objectives.** Atakhan, the epic monster added in 2025, has been **removed**. So have Feats of Strength, the first-to-X team race, and the blood-rose pickups that came with Atakhan [4][5][6]. Riot said the game had leaned too far into fighting over an objective every couple of minutes, and that earlier trims had not fixed it [4][46].
- **Bonuses restored.** First-blood and first-turret bonus gold are back: +100 g for first blood and +300 g for the first turret [20][21]. Baron returns to a **20:00** first spawn [6][46].
- **Role quests (new).** Each role gets a per-player progression bar tied to the role picked before champion select. Finishing it unlocks a role-specific reward in a dedicated quest slot [7][8][9]. See section 3.
- **Turret economy rework.** Outer-turret plates no longer fall off at 14:00. Tier-2 and tier-3 turrets now have plates too (3 each) [15][16][17]. A new **"Crystalline Overgrowth"** mechanic lets any champion with minions nearby deal burst true damage to turrets [19].
- **Vision rework.** Fixed map spots now amplify a ward placed on them [22][23].
- **Season 2 (patch 26.9, live around April 29, 2026)** made role quests more forgiving, added new starter and boot item options, and brought in a system that detects and ends matches ruined by disruptive play [24][25][26][51].
- **Season 3 (around patch 26.17, Aug 26, 2026)** shows mostly balance tuning in my results. I found no confirmed new map systems [27][50]. Mid-2026 objective timers come from August 2026 guides [36][38].

**Design takeaway:** a mature MOBA, 16+ years in, is actively cutting objective clutter and pre-laning dead time. It is also handing each role a clear, rewarded job. Vale should start from that leaner shape and not from the busier 2024-2025 one.

---

## 2. Roles and positions: the role contract

### 2.1 LoL's five positions
The five positions are **Top, Jungle, Mid, Bot (ranged carry) and Support**. Bot and Support share the bottom lane as a duo. Role queue lets players choose primary and secondary positions **[unverified]**. Since 2026 the chosen role also selects that player's quest [7][8].

| Role | Contract (what the team expects) | How the game enforces or rewards it |
|---|---|---|
| **Top** | Solo side lane, usually durable or duelist champions. Trades waves, applies side pressure, and joins fights via map-wide teleport. | Quest points count double in top lane. Rewards: a free teleport spell, or an upgraded one with a max-HP shield on arrival if already taken, plus a **level cap raised from 18 to 20** [8][9]. |
| **Jungle** | No lane. Farms neutral camps, ganks lanes, controls epic monsters, tracks the enemy jungler. | Needs the smite spell plus a pet companion. The quest completes after **35 large monsters**, upgrading smite damage and granting jungle/river move speed [13]. See section 9. |
| **Mid** | Short central lane, usually burst or control champions. Holds wave priority, roams to side lanes, contests the river. | Quest needs **1,350 points**, with minion, turret and plate points doubled in mid. Rewards: tier-3 boots and an empowered recall every 5 min that halves the recall channel from **8 s to 4 s** [11][12]. |
| **Bot (carry)** | Ranged damage that scales with gold. The team's main late-game DPS. | Quest needs **1,350 points**. Rewards: +300 g at once, **+2 g per minion** and **+50 g per takedown** for the rest of the game, and boots move into the quest slot, which opens a **7th item slot** [7][10]. |
| **Support** | Shares bot lane but does not farm minions. Provides vision, peel, engage and roaming. | Gets income from a quest-style support item and from non-farm actions. The role quest (reported as **800 points**) grants an extra slot for control wards only, cheaper control wards (75 g down to 40 g), and more passive gold [10][11][44][48]. |

### 2.2 Why the contract holds
1. **Lane assignment by convention plus incentives.** In 2026, a laner's quest points are higher in their assigned lane [8][11]. Patch 26.9 also added passive quest points while the player stands anywhere in their lane outside the base (about **1.5 points/s**) [24]. The game now explicitly pays players to be where their role belongs.
2. **Jungle gating.** Only a player holding smite plus a pet can clear camps efficiently. A hidden penalty also cuts a jungler's minion gold **[unverified for 2026]**. This stops two players from both farming lanes and stops laners from farming the jungle.
3. **Support income without farming.** The support starter item pays gold through a "share the wealth" mechanic. After about **400 g** it upgrades and starts granting wards [45][44]. It is generally believed to discourage the support from last-hitting minions **[unverified for 2026 numbers]**. The result is a low-gold role whose items come from a quest rather than from farm.
4. **Penalties for leaving the lane, softened in S2.** Points from CS, turrets and plates taken outside your quest lane carried a penalty. Patch 26.9 raised it to **-75%** but made it shrink as quest progress grows. A **"roaming bank"** keeps progress safe when a player leaves to roam [24].

### 2.3 Dota 2 contrast **[unverified]**
Dota numbers positions **1-5**: 1 = safe-lane carry, 2 = mid, 3 = offlane, 4 = soft (roaming) support, 5 = hard support. The safe lane and offlane mirror each other between the two teams. There is no dedicated jungle role and no smite. Any hero may farm neutral camps, and some carries "jungle" mid-game. The role contract runs on a **farm-priority ladder**, not on enforcement items: lower numbers get more of the team's gold. Supports buy wards and smoke and usually end the game with far fewer items.

---

## 3. Match phases and typical timings

| Phase | LoL 2026 (approximate) | What defines it |
|---|---|---|
| **Pre-laning** | 0:00-0:30 | Shop and setup. About 35 s shorter than before 2026 [4][49]. |
| **Early laning** | 0:30-~8:00 | First minion wave at 0:30. Jungle buffs and some camps spawn at **0:55** [49]. First dragon at **5:00** [36]. Voidgrubs (one camp of 3) at **8:00** [38]. |
| **Late laning / transition** | ~8:00-~15:00 | Grubs despawn at **14:45** [38]. Wave interval shortens at **14:00** [1]. Objective bounties can switch on from **14:00** [34]. Plates on outer turrets now stay up all game, so 14:00 is no longer a plate deadline [15]. |
| **Mid game** | ~15:00-~25:00 | Rift Herald spawns at **15:00** and leaves at **19:45** [38]. Baron spawns at **20:00** [6][40]. Groups form around dragons, Baron and inner turrets. |
| **Late game** | ~25:00+ | Waves every **20 s from 30:00** [1]. Death timers grow with game time and reach their cap at 55:00 [35]. Elder Dragon appears after a team claims soul [36]. |

**Typical match length:** solo-queue LoL games usually end between the mid-20s and low-30s of minutes, and pro games run similar or slightly longer **[unverified]**. The 2026 changes push toward earlier action, more turret pressure and fewer objectives. That suggests a slight shortening, but I found no published average for 2026 **[unverified]**. Dota 2 games usually run longer, roughly 35-45 min **[unverified]**.

---

## 4. Minion waves

**Spawn cadence (LoL 2026)** [1]:
- First wave at **0:30**, then a wave every **30 s**.
- From **14:00**, a wave every **25 s**.
- From **30:00**, a wave every **20 s**.

**Composition:** a standard wave has **3 melee + 3 caster** minions. A siege (cannon) minion joins periodically [28][2].

**Siege cadence:** every third wave early, then every second wave, then every wave. Sources give different breakpoints. One source lists every 3rd wave until 20:00, every 2nd until 35:00, then every wave [3]. Another wave guide describes cannons on every other wave by roughly 14:00 [28]. The 2026 shift of the first spawn to 0:30 almost certainly moved the first cannon earlier than the old 2:05 [2], though the exact new figure is **[unverified]**. Pattern for Vale: **escalate siege density in about three steps over the match**.

**Super minions:** when a lane's inhibitor is down, the attacking team gets **1 super minion per wave in that lane in place of the cannon**. With all three inhibitors down, **2 per wave in every lane** [28][29].

**Minion gold (26.01 figures as reported):** melee **20 g**, caster **15 g**, siege **40 g, plus 1 g per minute of game time**. One source lists super minions at **60 g, rising +3 g every 90 s, capped at 90 g** [28][29]. Older LoL values differed (for example siege minions at 60-90 g) **[unverified]**, so recheck these before treating them as precise. Order of magnitude: an early six-minion wave is worth about **105-150 g** to the player who last-hits all of it [28].

**XP:** minion XP goes to all allied champions within a radius around the dying minion, split among them. No last hit is needed. Gold, by contrast, needs a last hit **[unverified for exact radius and split]**.

**Dota 2 contrast [unverified]:** waves leave every 30 s from 0:00 (usually 3 melee + 1 ranged creep). Siege creeps arrive on a periodic schedule, and waves grow in size over time. **Denies** let a player last-hit their own creep below 50% HP. The enemy then gets no gold, and the XP they receive drops. Lane control becomes a contested resource, not just a farming exercise.

---

## 5. Gold and XP economy

### 5.1 LoL sources of gold
| Source | Value (as confirmed) | Notes |
|---|---|---|
| Starting gold | **500 g** [30] | |
| Passive income | **20.4 g per 10 s** (about 2 g/s), historically from **1:05** [30] | The 2026 retime may have moved the start to 0:30 **[unverified]** |
| Minions | See section 4 | Last hit required |
| Champion kill | **300 g** base, **150 g** assist pool **split evenly** among assisters [31] | |
| Death-streak reduction | Kill value falls from 300 g to about **100 g** after **6+ consecutive deaths** [31] | Feeding is worth less |
| First blood | **+100 g** bonus (restored in 26.1) [20][21] | |
| First turret | **+300 g** bonus (restored in 26.1) [20][21] | |
| Turret plates | **120 g** per plate (cut from 125). Plates now also on T2/T3 (3 each) and outer plates **no longer expire** [15][16] | Rewards gradual pressure |
| Bounties / shutdowns | Bounty grows from gold earned (1 bounty gold per 4 g from kills/assists, 1 per 20 g from farm while positive). The first 100 g of bounty is ignored. Shown at **>=150 g** and announced as a shutdown; above **700 g**, the excess carries over to the next life [32][33] | Built on gold since 14.21 |
| Objective bounties (comeback) | Only from **14:00**. The trailing team (judged on gold, XP, epic monsters and turrets, with gold weighted most) sees marked objectives: Baron/Elder/Dragon/Herald **500 g**, outer turret **250 g**, inner or base turret **400 g**. Bounties can scale up to +60%, gold is split evenly, and a bounty fades within about 15 s once the team catches up [34] | Pays out on top of normal rewards |
| Role-quest gold | Bot: +300 g at once plus extra per CS and per takedown [10]. Jungle: +10 g and +10 XP per large monster after completion [13] | New in 2026 |

### 5.2 Level cap
- **18** is the cap for most players. A finished top-lane quest raises it to **20** [9].
- Dota 2's cap is **30**, with talent choices at levels 10/15/20/25 **[unverified]**.

### 5.3 Dota 2 contrast **[unverified]**
- Gold is split into **reliable** gold (from kills and objectives) and **unreliable** gold (from creeps and passive income). Players lose gold on death, mostly unreliable.
- **Buyback** spends gold to respawn at once, with a cooldown.
- Denies affect both gold and XP (section 4).
- Comeback comes from kill-streak bounties and from extra XP and gold for killing higher-networth heroes.

---

## 6. Death, respawn, recall and base

### 6.1 Respawn timers (LoL) [35]
- **Base wait by level (1-18):** 10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5 s.
- **Time-increase factor:** starts after 15:00 and grows at about 0.425% per minute (15-30), 0.30% per minute (30-45) and 1.45% per minute (45-55). It is **capped at +50%**.
- **Maximum:** **78.75 s** (level 18 at 55:00 or later).
- The timer for levels 19-20, reachable only by top laners, is **[unverified]**.
- Dota 2 respawn also scales with level, reaching roughly 100 s at high levels, and buyback is the counterplay **[unverified]**.

### 6.2 Recall and teleport
- **Recall** is a channel of about **8 s** that returns the player to base. It breaks on damage or movement **[unverified on interruption rules]**. A finished mid quest gives a **4 s** empowered recall every 5 min [11]. Baron's buff also grants an empowered recall [40].
- **Teleport** is a summoner spell with a long cooldown that channels to an allied structure, minion or ward **[unverified on targets]**. A finished top quest grants it free or upgrades it [8][9].
- In Dota 2, every hero carries a dedicated teleport-scroll slot to towers and outposts, and boots can upgrade into a teleport item **[unverified]**.

### 6.3 Fountain and base **[unverified]**
- The fountain heals and restores mana fast and is guarded by a very high-damage defense that makes diving it suicidal.
- The shop is usable only in base (Dota also has side shops and couriers).
- Respawn happens at the fountain.
- Dota's courier delivers items to the hero in lane.

---

## 7. Structures

### 7.1 LoL layout per team **[unverified counts; well established]**
- **3 turrets per lane** (outer/T1, inner/T2, inhibitor/T3), giving 9 lane turrets.
- **3 inhibitors**, one per lane, behind the T3 turret.
- **2 nexus turrets.**
- **1 nexus.** Destroying it wins the game.

### 7.2 Plates and turret economy (2026)
- Outer turrets carry **5 plates** **[unverified count]**. As of 2026 these **no longer fall off at 14:00** [15][16].
- T2 and T3 turrets now have **3 plates each**, paid out plate by plate [15][17]. One source gives claim thresholds of 10/25/45/70/100% missing HP **[unclear which tier this applies to]** [15].
- Each plate pays 120 g [15].
- Turrets take reduced damage when no attacking minions are near ("backdoor protection") **[unverified exact value]**. They also have early-game damage reduction or fortification **[unverified 2026 status]**.

### 7.3 Crystalline Overgrowth (2026) [19]
- A charge builds on each turret after a **90 s** start or cooldown (30 s in the faster mode).
- The next champion hit consumes it for **bonus true damage**, but only with **allied minions nearby**.
- Bonus damage grows with time, up to **500 at 300 s**.
- Effect: low-DPS champions such as tanks and enchanters can now make real tower progress, so split pushing is open to more classes. A rune that used to do this was simplified as a result [19].
- When it shipped is unclear: some sources tie it to Season 1 (January 2026), others to Season 2 [19][24].

### 7.4 Inhibitors, nexus turrets and the nexus
- **Inhibitors respawn 5:00** after being destroyed [37]. While one is down, the attacking side spawns super minions in that lane (section 4) [29].
- **Nexus turrets** respawn about **3:00** after destruction and regenerate in thirds (6 HP/s up to the next 33/67/100% step) [37]. Respawning nexus turrets were added in 2025 [37].
- One 2026 claim says they now return at **40% HP** instead of 100% [18]. That comes from a low-reliability social-media post, so treat it as **[unverified]**.

### 7.5 Dota 2 contrast **[unverified]**
- Each lane has three tiers of towers, plus **two tier-4 towers** guarding the Ancient.
- Each lane has **barracks** (melee and ranged). They **do not respawn**. Destroying them makes that lane's enemy creeps into super creeps, and destroying all six produces **mega creeps**.
- A team-wide **Glyph** ability briefly makes all of a team's buildings invulnerable, on a long cooldown.
- Backdoor protection gives buildings fast regeneration and reduced damage when no enemy creeps are near.
- Dota's high ground is a real terrain advantage (see section 10).

---

## 8. Neutral (epic) objectives

### 8.1 LoL 2026 roster
| Objective | Spawn and respawn | Reward pattern |
|---|---|---|
| **Elemental dragons (drakes)** | First at **5:00**, then **5:00** after each kill [36] | Each kill gives a stacking team buff based on that dragon's element. The map terrain changes element after early dragons ("Elemental Rift"), which also controls which vision spots appear [22][36]. There are six element variants **[unverified count for 2026]**. |
| **Dragon soul** | When one team reaches **4 dragons** [36] | A permanent, strong team buff tied to the soul's element [36] |
| **Elder dragon** | Replaces drakes after soul is claimed. Respawns every **6:00** [36] | A temporary buff that burns enemies and can **execute** low-HP enemies [36] |
| **Voidgrubs** | **One camp of 3 grubs at 8:00**, top-side pit. Despawns permanently at **14:45** (14:55 if in combat). Spawns once per game [38][39] | A stacking team buff for damaging structures **[unverified effect detail]**. Grubs spawn small adds during the fight [38] |
| **Rift Herald** | **15:00** in the same pit. Leaves at **19:45**. Once per game [38][39] | A summonable siege unit that rams turrets **[unverified mechanics]** |
| **Baron** | **20:00**, respawns every **6:00** [40] | Team buff for **180 s**, given only to allies alive at the kill. Grants AD/AP, an empowered recall, and an aura that strongly boosts nearby minions [40] |
| **Atakhan** | **Removed in 2026** [4][5] | (Was a 2025 mid-game monster tied to blood-rose pickups) |
| **Feats of Strength** | **Removed in 2026** [4][6] | (Was a 2025 race for first blood, first turret and first epic monsters) |

**Pattern:** two alternating, quadrant-anchored chains:
- a **bottom-side chain** (repeating dragons, then a soul win condition, then an executing late-game buff), and
- a **top-side chain** (one-time early siege objectives, then a repeating late-game siege-assist buff).

The trailing team can mark these objectives with **objective bounties** (section 5).

### 8.2 Dota 2 neutral objectives (contrast) **[unverified, all items]**
- **Roshan:** a boss in a pit that **moves between two river locations** on the day/night cycle. It drops an extra-life token (Aegis) plus extra consumables on later kills. It respawns on a **randomized timer of about 8-11 min**.
- **Tormentors:** neutral constructs that reflect damage, appear mid-game, and drop a hero upgrade (Aghanim's Shard). They suit team-wide tanking.
- **Watchers:** capturable map points that give vision.
- **Outposts:** capturable structures that give periodic XP and act as teleport targets.
- **Lotus pools:** grow a stack of healing pickups over time.
- **Wisdom runes:** spawn on a long interval at fixed side locations and give a big XP grant, scaled for the team's lowest-level hero.
- **Power runes:** spawn every 2 min from about 6:00 at river spots (haste, double damage, illusion, invisibility, regeneration, arcane, shield). **Bounty runes** give team gold on a periodic timer.

Dota's design spreads many **small, frequent, contestable map pickups** across the map. LoL 2026 is moving the other way, toward **fewer, bigger, timed fights**.

---

## 9. Jungle

- **Camps:** each side has buff camps (blue and red) and four regular camps, plus a river crab that gives vision or speed **[unverified 2026 count]**.
  - The buff camps and some regular camps first spawn at **0:55** in 2026 [49].
  - Regular camps respawn **2:15** after the *last* monster dies [41][42].
  - Buff camps traditionally respawn after **5:00** **[unverified]**.
  - Camps level with the lobby's average level, not the jungler's [41].
  - A minimap timer shows camp respawns once a camp has been seen cleared [41].
- **Smite and pets:**
  - Since 2023, junglers choose one of three companion pets. Each fixes a play pattern (damage-slow, shield, or move-speed) [43].
  - The pet evolves on **treats**, one per large monster.
  - **2026:** the first evolution comes at **15 treats** (smite 1,000 true damage) and full evolution at **35 treats** (smite **1,400**). That is up from the old 600/900/1,200. Completion also gives **+4% / +8%** move speed in jungle and river (in/out of combat) and **+10 g / +10 XP per large monster** [13].
  - Fully evolved smite has historically also dealt splash damage to nearby monsters and given damage reduction against epic monsters when allies are nearby [43].
- **Camp tuning (2026):** regular camps were made **slower to clear**. The goal is to give laners room and to punish early-gank paths [13].
- **Leashing and first clear:** laners help the jungler kill the first buff camp. A full six-camp clear has traditionally reached **level 4 around 3:30**, matching the crab spawn [47]. With 2026's 35 s shift and slower camps, the exact new timing is **[unverified]**.
- **Dota contrast [unverified]:** neutral camps respawn on the minute if the spawn box is clear. Players "stack" camps by pulling monsters out just before the minute, so an extra set spawns. There is no smite and no pet gating.

---

## 10. Vision

### 10.1 LoL **[mostly unverified except where cited]**
- **Fog of war:** every allied unit and structure reveals a radius around itself. Everything else is hidden.
- **Brush:** units inside brush are invisible to enemies outside it unless revealed. Entering a brush gives vision of what is inside it.
- **Wards:**
  - **Trinket stealth wards:** a free item with recharging charges and limited lifetime.
  - **Control wards:** buyable for **75 g** [44]. They reveal and disable enemy wards. Players are limited to one placed at a time.
  - **Sweeper trinket:** finds hidden wards.
  - **Long-range blue trinket:** visible, fragile wards.
- **Support quest:** the support item line stores up to **4 stealth-ward charges**. Completing the role quest adds a control-ward-only slot and cuts control-ward cost to **40 g** [44]. The old vision-focused support item was folded into the quest [44].
- **Faelights (2026):** fixed glowing spots on the map, some present from the start and some appearing once the map changes element.
  - A ward placed on one gets **+25% vision radius** and reveals an extra region for **45 s**.
  - The extra region is hidden from enemies unless they sweep.
  - Purpose: give pushing solo laners easy, legible vision so vision is no longer a support-only job [22][23].

### 10.2 Dota 2 contrast **[unverified]**
- **Observer wards** are long-lived and invisible. **Sentry wards** reveal invisible units and wards. Both come from a shared, restocking supply in the shop.
- A **day/night cycle** shrinks most heroes' night vision.
- **High ground:** units on low ground cannot see up cliffs or ramps without a ward or flying vision. Defending uphill is a real advantage.
- **Trees** block vision and can be cut down.

---

## 11. Items **[mostly unverified; confirm before calibrating]**

- **Slots:** 6 item slots plus a trinket slot. In 2026 boots can move to the quest slot for bot laners (a 7th effective slot) [10].
- **Starters:** low-cost (~400-500 g) lane starters. Season 2 2026 **added new starter options and a new boot option** to widen build variety [25][26].
- **Tiers:**
  - basic components (~300-1,000 g);
  - epic items (~1,000-1,500 g, built from basics);
  - legendary or completed items (~2,500-3,300 g).
  - The mythic tier was removed in 2024 **[unverified]**.
- **Boots:** three tiers. Tier 1 is generic speed. Tier 2 is a specialized pair such as armor, magic resist, attack speed or penetration. Tier 3 is an upgrade on top of T2; the mid-lane quest grants this upgrade for free [11].
- **Consumables:** health potion, refillable potion, control ward [44], elixirs.
- **Support item:** the starter quest item earns **400 g** of support gold, then upgrades and starts holding wards [45], then upgrades again into a chosen finished support item **[unverified exact thresholds]** [44].
- **Typical full build:** 5-6 completed items around 35-40 min, including boots. The late-game cap is 6 items plus a trinket, or 7 for a finished bot quest [10].
- **Sell-back:** items sell back at about **70%** of their cost, with some exceptions **[unverified]**.
- **Dota contrast [unverified]:**
  - No unique-passive limit like LoL's.
  - A backpack and a stash.
  - **Neutral items:** since 2025, players choose crafted neutral items with enchantments per tier, unlocked on a timer. Before that, they were random drops from neutral camps.
  - Couriers deliver items.

---

## 12. Pre-match setup layer

- **LoL runes [unverified]:** one primary path (a keystone plus three minor choices), a secondary path (two minor choices), and three stat shards. Season 2 2026 widened rune and build diversity [24][25]. One rune that dealt turret damage was **simplified** because Crystalline Overgrowth now gives everyone that role [19].
- **LoL summoner spells [unverified list]:** each player picks two utility spells with long cooldowns.
  - Universal picks: a short blink (about 5 min cooldown), a heal, a damage-over-time ignite, a slow/damage-reduction exhaust, a shield, a cleanse, a ghost-speed, and teleport.
  - Junglers must take smite [13].
  - The top quest grants or upgrades teleport [8][9].
- **Dota 2 [unverified]:**
  - **Talents:** a binary choice at levels 10/15/20/25.
  - **Facets:** a pre-match variant pick per hero, added in 2024.
  - **Innate abilities:** always-on hero traits, added in 2024.
  - The current 2026 status of Facets is unconfirmed.

---

## 13. Surrender, remake and match-integrity rules

- **LoL [unverified]:**
  - **Remake** vote available early (about 3:00) if a player never connected or is AFK.
  - **Surrender** vote from about **15:00**, needing all 5 votes.
  - From about **20:00**, it passes with **4 of 5** votes.
- **New in 2026 S2 [25]:** a system that **detects and ends matches hit by disruptive behavior** ("inting"):
  - the victim's allies are **LP-neutral** (no rank points lost);
  - the enemy team still gets full LP for the win;
  - the offender and their premade lose LP and are penalized.
  - A **vote-to-end** option after trolling was also being tested [25].
- **Dota 2 [unverified]:**
  - No standard surrender vote.
  - Teams can **"call GG"** to concede.
  - Players may leave without penalty after a teammate has abandoned or stayed disconnected beyond a threshold.

---

## 14. Implications for Vale

### (a) Public systems worth adopting in original form
1. **A five-role contract with incentives, not rules.** Pay players more for doing their role where it belongs: double points in the assigned lane, passive progress while in lane, and a "roaming bank" so short roams are not punished [8][11][24]. Each role finishes with one distinct power spike that defines it, our own versions of "more range of levels", "more slots", "more tempo", "more jungle mastery" and "more vision" [8][9][10][11][13][44].
2. **Gate the farm-free roles economically.** Use a jungle-only key (spell or companion) that makes neutral farming efficient and lane farming costly. Give the support a quest-item income stream that pays for presence, not last hits [13][45].
3. **Wave cadence that speeds up over time.** Start soon after load (about 30 s), shorten the wave interval at fixed times, and increase siege-unit density in steps [1][3][4]. For a browser match, scale the whole timeline down (see open questions).
4. **Incremental structure rewards.** Plates that pay out partial gold before a tower dies, on every tier, encourage pressure all game [15][16]. Pair this with backdoor protection, a structure-damage boost tied to minions so low-DPS roles can push [19], and respawning last-line defenses so losing teams keep some hope [37].
5. **A layered comeback economy.** Use kill bounties based on gold earned, shutdown carry-over and death-streak devaluation [31][32][33]. Activate objective bounties only after a time gate and only for the trailing side [34]. Keep first-blood and first-tower bonuses small [20].
6. **Respawn timers that scale with level and match time,** capped so late deaths cost about 1.5x their level baseline [35]. Retune the scale for a shorter match.
7. **Two objective chains anchored to quadrants:** a repeating stackable buff chain with a win-condition soul and an execute finisher, and a one-time early siege chain followed by a big late siege buff. LoL's 2026 trim (removing Atakhan and Feats) argues for **fewer, more meaningful** objectives [4][46].
8. **Vision:** fog of war, brush, consumable wards plus a counter-ward and sweeper, and **fixed map spots that amplify wards** so non-supports can take part in vision [22]. Note: fog of war has GPU and CPU cost in a browser.
9. **Recall as a channel plus role-based tempo perks** such as a shorter recall [11]. **Teleport as an earned or role-assigned resource,** not universal [8].
10. **Match-integrity rules:** a remake window, time-gated surrender votes and loss protection when a teammate is detected sabotaging [25].

### (b) Protected expression that must NOT be copied
- **Names:** Summoner's Rift, Nexus, Inhibitor (as a branded term), Baron Nashor, Rift Herald, Voidgrubs, Atakhan, Elder Dragon, Dragon Soul element names, Faelights, Crystalline Overgrowth, Feats of Strength, Elemental Rift, Hand of Baron, every item name (Doran's, World Atlas, Runic Compass, Bounty of Worlds, Stealth Ward, Oracle Lens, Farsight, Control Ward branding), pet names (Scorchclaw, Mosstomper, Gustwalker), rune and keystone names, summoner-spell branding (Flash, Smite, Ignite, Teleport as LoL's iconic set), and season names (Demacia, Pandemonium).
  - Dota: Radiant/Dire, Ancient, Roshan, Aegis, Tormentor, Glyph of Fortification, Wisdom/Bounty/Power rune naming, Aghanim's Shard, Facets.
- **Map geometry:** the exact three-lane diagonal layout with river, pit placement (top/bottom river pits), brush positions, jungle-camp positions and wall shapes. Vale needs its own topology even if it keeps three lanes.
- **Visual and audio identity:** icons, UI layout (scoreboard, minimap framing, shop layout), announcer lines and voice delivery ("First Blood", "Shut Down", "Ace" in LoL's style), sound effects, music, fonts and art style.
- **Ability or item text and exact numeric tables copied wholesale.** Use the ranges above to calibrate, then author our own values.
- **Lore** (regions, characters, factions).

### (c) Open questions for Vale
1. **Target match length for a browser game.** LoL runs roughly 25-35 min **[unverified]**. Do we target about 15-20 min and compress every timer (waves, objective spawns, respawn caps) by a fixed factor?
2. **Team size and role count.** Do we keep 5v5 with a jungle, or use 3v3 or 4v4 to suit browser performance and queue times? If we drop the jungle, who controls the objective clock?
3. **Level cap and per-role cap variation.** Keep a single cap, or copy the pattern of one role exceeding it?
4. **Denies:** do we add a lane-control mechanic in the Dota style, raising the skill ceiling at a cost to accessibility?
5. **Item complexity:** how many slots, whether a component and recipe tree or a simpler upgrade-path model, and whether there is a sell-back rule.
6. **How strong comeback should be.** At what time and deficit do objective bounties switch on? How do we avoid players reading them as "rubber-banding"?
7. **Vision budget:** can we afford fog of war plus brush plus ward vision for 10 players and about 100 minions at 60 fps in WebGL2? Should fog be computed on the server for anti-cheat?
8. **Teleport and recall:** universal, or role-gated as in LoL 2026?
9. **Surrender and disruption detection** thresholds for a smaller, newer player base.
10. **Verification backlog:** before any number above becomes a design spec, re-verify the [unverified] items. In particular, check the Dota 2 systems (current patch, Facets status, neutral-item model, Roshan timers), LoL boot and item prices, siege-minion breakpoints after the 2026 retime, the nexus-turret 40% claim, and the support quest thresholds.

---

## Sources

1. https://wiki.leagueoflegends.com/en-us/Minion
2. https://mobalytics.gg/lol/guides/wave-management
3. https://wiki.leagueoflegends.com/en-us/Siege_Minion
4. https://www.shacknews.com/article/146999/league-of-legends-season-1-2026-changes-feature-atakhan
5. https://esports-news.co.uk/2025/12/01/lol-2026-update-ranked-wasd-atakhan-removed-role-quests/
6. https://www.gosugamers.net/lol/news/77659-league-of-legends-season-1-2026-changes-summoner-s-rift-with-objective-changes-new-items-and-more
7. https://mobalytics.gg/lol/guides/new-role-quests
8. https://gameriv.com/league-of-legends-2026-role-quests-explained/
9. https://esports.gg/news/league-of-legends/league-of-legends-2026-role-quests/
10. https://games.gg/league-of-legends/guides/league-of-legends-season-2026-everything-new-demacia/
11. https://www.altchar.com/game-news/league-of-legends-2026-new-role-quests-explained-am4h80I7pPyE
12. https://dignitas.gg/articles/how-to-complete-the-role-quests-in-season-2026-of-league-of-legends
13. https://www.esports.net/news/lol/league-of-legends-to-introduce-major-jungle-nerfs-with-2026-map-changes/
14. https://www.dodge.gg/en-US/lol/news/jungle-guide-2026
15. https://www.sheepesports.com/en/all/articles/league-of-legends-2026-s1-gameplay-changes-atakhan-removed-new-plates-on-t2-and-t3-nashor-back/en
16. https://esports.gg/news/league-of-legends/lane-turret-changes-lol-2026/
17. https://www.altchar.com/game-news/league-of-legends-2026-is-reworking-turrets-to-reward-pushing-and-split-pushing-afxfK7o4YZ0U
18. https://www.tiktok.com/@brokenleaguee/video/7578945196184833302
19. https://gameriv.com/all-new-turret-changes-coming-to-league-of-legends-in-2026/
20. https://www.sportskeeda.com/esports/league-legends-patch-26-1-notes
21. https://wiki.leagueoflegends.com/en-us/V26.01
22. https://fanstanza.gg/faelights-league-of-legends-explained/
23. https://wecoach.gg/blog/article/biggest-changes-in-lol-season-2026
24. https://patched.gg/games/league-of-legends/league-of-legends-patch-269-notes
25. https://www.sheepesports.com/en/articles/all-gameplay-changes-coming-to-league-of-legends-season-2-of-2026/en
26. https://esports-news.co.uk/2026/04/15/lol-season-2-2026-changes/
27. https://lol.fandom.com/wiki/Patch_26.17
28. https://www.riftpatchnotes.com/lol/system/minions
29. https://lol.fandom.com/wiki/Super_Minion
30. https://wiki.leagueoflegends.com/en-us/Gold
31. https://wiki.leagueoflegends.com/en-us/Assist
32. https://wiki.leagueoflegends.com/en-us/Champion_gold_bounties
33. https://lol.fandom.com/wiki/Patch_14.21
34. https://wiki.leagueoflegends.com/en-us/Objective_bounties
35. https://wiki.leagueoflegends.com/en-us/Death
36. https://www.nerfplz.com/2026/08/every-summoners-rift-objective.html
37. https://guildorder.com/games/league/wiki/objectives-reference
38. https://www.nerfplz.com/2026/11/voidgrubs-and-rift-herald-explained-10.html
39. https://x.com/LeagueOfLeaks/status/1912161090529603625
40. https://wiki.leagueoflegends.com/en-us/Baron_Nashor
41. https://www.nerfplz.com/2026/10/lol-jungle-camps-explained-10-rules.html
42. https://lol.fandom.com/wiki/Greater_Murk_Wolf
43. https://riftfeed.gg/guides/league-of-legends-jungle-pets
44. https://www.dodge.gg/en-US/lol/news/support-items-2026
45. https://wiki.leagueoflegends.com/en-us/World_Atlas
46. https://u.gg/lol/news/leagues-2026-season-quietly-reworks-the-entire-game
47. https://mobalytics.gg/lol/guides/5-tips-to-have-a-strong-early-game
48. https://www.joytify.com/blog/en-us/moba-and-fps/league-of-legends-role-quests/
49. https://www.leagueoflegends.com/en-us/news/dev/dev-2026-season-one-gameplay-preview/
50. https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-17-notes/
51. https://lol.fandom.com/wiki/Patch_26.09
