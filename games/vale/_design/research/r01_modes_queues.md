# R01: Live Modes and Queue List (reference: League of Legends 2026, Dota 2)

Prepared for: VALE (Forgeflow Games), original browser lane-brawler
Research date: 2026-10-07
Status: reference research. All values are calibration ranges, not values to copy.

> **How this was researched.** WebFetch was blocked by the network egress proxy for every reference domain tried (leagueoflegends.com, support.riotgames.com, wiki.leagueoflegends.com, blog.loltheory.gg, nerfplz.com, liquipedia.net, esports.gg). The shared web-search budget for this run also ran out before the Dota 2 section was fully cross-checked. Everything below comes from search-result snippets of the URLs in the Sources list. Claims I could not confirm are marked **[unverified]**. Where sources disagree, both versions are given. A follow-up pass with a fresh search budget should re-check the Dota 2 pick-format details (Section 4).

---

## 1. Vocabulary: "mode" vs "queue"

Both reference games separate two layers, and Vale should keep them apart in data:

- **Mode (ruleset layer):** what the match *is*. That covers the map, starting state (level, gold), economy multipliers, objective schedule, end-of-game rules (surrender, sudden death) and extra systems such as augments.
- **Queue (matchmaking layer):** who you are matched with and under what stakes. That covers the matchmaking pool, rating ladder, allowed party sizes, pick format (blind, draft, random, pre-pick), unlock gates, penalties and the hours the queue is open.

League runs many *queues* on one *mode*: Ranked Solo/Duo, Ranked Flex, Ranked 5s, Normal Draft and Co-op vs AI all use the standard 5v5 rules on the main map. It also runs several genuinely different *modes*: Swiftplay, ARAM, ARAM: Mayhem, Arena, ARURF, Brawl and League Classic [7][8]. In Dota 2, most "game modes" are really pick formats on one map. Turbo is the main matchmade mode that changes the rules themselves [60][62].

---

## 2. League of Legends: what is live (as of early October 2026)

### 2.1 Overview

Sources tracking the live client describe this split. The **permanent queues** are Ranked, Normal, Swiftplay, ARAM and Co-op vs AI. **Rotating featured modes** come and go: Arena, URF/ARURF, ARAM: Mayhem and others [7][8]. A live-mode tracker dated about 6 October 2026 listed four rotating modes as currently live: ARAM: Mayhem, Arena, League Classic and Ranked 5s [8].

### 2.2 Summary table

| Entry | Type | Players | Map | Pick format | Typical length | What differs |
|---|---|---|---|---|---|---|
| Ranked Solo/Duo | Queue | 5v5 | Main 3-lane map | Role select + draft (simultaneous bans, alternating picks) | About 25–35 min [57] | Rated ladder; party of 1–2 [17] |
| Ranked Flex | Queue | 5v5 | Main map | Same draft as Solo/Duo [17] | Same | Separate ladder and MMR; party of 1, 2, 3 or 5 (no 4) [17] |
| Ranked 5s (2026, featured) | Queue | 5v5 | Main map | Tournament draft: 3 bans, 3 picks, 2 bans, 2 picks [20][21] | Same | Exactly 5 premade; weekend windows only; separate individual LP ladder [20] |
| Normal Draft | Queue | 5v5 | Main map | Role select + draft, same as ranked [16] | Same | No LP; was time-windowed in some regions [13][14] |
| Swiftplay | Mode + queue | 5v5 | Main map | Pre-pick role + champion *before* queuing [1][6] | About 8 min shorter than standard, hard cap about 36 min [1][2] | Start level 3 with 1,400 gold, rising gold/XP multipliers, faster objective schedule, sudden death [1][2] |
| Co-op vs AI | Queue | 5 humans vs 5 bots | Main map | Standard select | [unverified] | Three bot difficulty tiers [54] |
| ARAM | Mode | 5v5 | Single-lane maps (3-map rotation) | Random (champion cards + shared bench) [33][36] | About 15–20 min [57] | One lane; random champions |
| ARAM: Mayhem | Mode | 5v5 | ARAM maps | Random | [unverified] | ARAM plus augment picks at levels 7, 11 and 15 [38] |
| Arena | Mode (featured) | 16 (8 duos) | Several small arenas | Duo picks [unverified detail] | [unverified] | Round-based elimination; shop and augment phase between rounds [43] |
| ARURF | Mode (featured) | 5v5 | Main map [unverified] | Random [45] | [unverified] | Ultra-rapid-fire ruleset [unverified details] |
| Brawl | Mode (featured, 2025, returned 2026) | 5v5 | Small custom map, no turrets or nexus | Free pick [48] | About 10 min [48] | Win by draining a 250-point team health pool [48] |
| League Classic (2026) | Mode + own queues | 5v5 | Recreation of the older main map | Draft (single PvP draft queue) [51] | [unverified] | Older ruleset snapshot, 60-champion roster at launch [51] |

### 2.3 Ranked queues

- **Entry gates:** Ranked Solo/Duo and Flex require account level 30 and ownership of at least 20 champions [18]. One wiki also lists 10 completed normal games as a requirement [19] [unverified as current].
- **Placements:** new entrants play provisional matches that set their starting tier and division [18].
- **Solo/Duo vs Flex:** Flex uses the same map, champion pool and draft as Solo/Duo. The differences are party flexibility (1, 2, 3 or 5; four-stacks are not allowed) and a fully separate rank, MMR and season rewards [17]. The four-stack exclusion keeps a near-full premade from being paired with a single random player [17].
- **Ranked 5s (2026):** a full-premade ranked queue. It needs exactly five players but no fixed roster, and has no rank restrictions on who can group [20]. It opens only in weekend windows, reported at launch as 9 PM to 1 AM server time [20]. It uses tournament draft (3 bans, 3 picks, 2 bans, 2 picks) and gives each player an individual rank on a separate LP ladder [20][21]. The first run was June to September 2026. A second run began in patch 26.18 (10 September 2026) with longer weekend windows and a draft phase that shows some opponent information, as the existing tournament mode does [8][20].
- **2026 ranked season changes** [23][24][25]:
  - *Autofill parity.* The matchmaker first tries to put autofilled players against each other in the same position. Failing that, it balances the number of autofilled players per team. Failing that, it gives the team with more autofilled players slightly stronger teammates.
  - *LP protection.* Autofilled players get LP protection or bonus LP. Mains of the roles that are hardest to fill get the same reward at a similar rate, without being told in advance.
  - *Dodging.* Dodging no longer resets your autofill status. At Master and above, a dodge also counts as a full loss on top of the cooldown.
  - *Champ select.* You can no longer ban a champion an ally is hovering. Animations and timers were trimmed by about 30 seconds.

### 2.4 Normal Draft

- Same flow as ranked, without LP: role select, bans and alternating picks [16]. Players pick a primary and secondary position or "Fill". The matchmaker tries the primary role first, then the secondary, and rarely autofills [16].
- Unlocks at account level 10 with access to 20 champions, free rotation included [16].
- **Population signal:** Normal Draft only ran during set hours in lower-population regions. In 2025, OCE and SEA windows were extended (11:00 to 03:00) and JP went full-time [13]. 2026 patch notes report Normal Draft moving to 24/7 in ME, OC and SG after queue times improved. The same notes report last-hit indicators added to Normal Draft queues [14][15].

### 2.5 Swiftplay (what replaced Blind/Quickplay)

- **Lineage:** Swiftplay was announced on 25 November 2024 [12]. It launched in patch 25.S1.1 on a subset of servers, replacing **Quickplay**, which had itself replaced Blind Pick. It reached the remaining servers in patch 25.07, when Quickplay was removed indefinitely [3][12]. Swiftplay reuses Quickplay's queuing and matchmaking but adds in-game rules that make matches faster [12].
- **Pick format, a pre-pick queue:** before queuing, each player chooses a primary and secondary role and a champion for each. You therefore always load in on a role and champion you selected [6][4]. In a full five-player party, each member must take a unique role and champion, and there is no secondary role [4][5].
- **Starting state:** level 3 and 1,400 gold. The normal lane-starter items are disabled and replaced with a mode-specific starter set of four items [1][2].
- **Economy:** gold and XP sources pay more, and the multipliers grow as the game goes on [1].
- **Objective schedule (2026 version):** the major late-game objective spawns at 12:00 and the late "elder" objective from about 15:00 [9][1]. Only two elemental drakes spawn, and the soul bonus needs 2 stacks instead of 4 [9]. The early neutral objectives (the grub-type camp, the herald-type objective and the 2025 mid-game boss) do not spawn [1][9].
- **Sudden death, a staged forced finish:**
  - The 2026 dev blog says sudden death now starts about 5 minutes earlier, at 25 minutes, to pull down the longest games [2].
  - A 2026 guide describes the stages this way: from about 25:00, turrets lose 35% of their armor and magic resist each minute. A warning plays at 27:00. From 30:00, every targetable structure on both teams loses 3.3% of its max HP every 2 seconds [1].
  - Games are effectively capped at about 36 minutes [1][9].
  - The two sources put the stage start times differently. Treat the shape as reliable (defense decay, then a warning, then fast structure decay, then a hard cap) and the exact timestamps as **[conflicting]**.
- **Measured effect:** before the 2026 changes, Swiftplay games ran about 8 minutes shorter than standard games on average. Riot still considered that too long because the mode kept the slower pacing of the standard map [2].
- **Mode or queue?** Both. It is a matchmaking pool (with fast pre-pick) *and* a rules layer on the standard map. That makes it the clearest example of "same map, different rules layer" in League.

### 2.6 ARAM and ARAM: Mayhem

- **ARAM:** a permanent 5v5 mode on a single lane with random champions [7][36].
- **Map rotation:** since patch 25.13 (25 June 2025), each lobby is randomly assigned one of three single-lane maps with equal probability. The pool is the original, a revived older map and a new seasonal map [35][36][37]. Variants add map features such as base launchers that fire players toward a chosen point, and healing plants [35].
- **Champion cards:** champion cards replaced rerolls in 25.13 [33]. Each player gets two cards, keeps one, and sends the other to a shared bench. Sometimes a third card appears. The base chance is 5%, plus 0.15% per champion owned, with a pity timer [33][34]. Riot's reasoning was that rerolls gave anywhere from 5 to 15 choices per game (about 10 on average) and felt inconsistent [33].
- **ARAM penalties:** dodge lockouts of 15 minutes, 30 minutes and 12 hours [26].
- **ARAM: Mayhem:** went live in patch 25.21 (22 October 2025) as a *separate queue alongside regular ARAM* [38][39]. Every player picks an augment at levels 7, 11 and 15. Some augments affect teammates too [38]. Riot has signalled updates into 2027, so it is effectively persistent [40]. By patch 26.19 it had about 201 augments [41], and five more were added in 26.21 [42]. The tracker logs a fresh run or extension from 29 July 2026 [8].

### 2.7 Arena

- 2v2v2v2 with 8 duos (16 players) in a random round-robin bracket on small battlefields. A closing ring of hazard pushes fights together [43].
- No lanes, jungle, minions or objectives. Champions start at level 3. Each duo has a team health pool that drops every time it loses a round, and it is eliminated at zero [43].
- **Round loop:** a 45-second shop phase (items and permanent augments), then combat on one of six small maps, with the ring starting to close 30 seconds into combat. A vote phase comes before some rounds [43].
- **Status:** Riot has said Arena will not be permanent; it is a recurring featured mode. One guide placed it in its 5th run as of patch 26.11 [43], and the live tracker had it continuously live since 25 June 2025 [8]. Status therefore depends on the date **[conflicting]**.

### 2.8 URF / ARURF

- ARURF returned in patch 26.02 (22 January 2026), moved up from the planned 26.03 [45][46]. That edition used random champion assignment, the "All Random" variant [45].
- The detailed rules (cooldown and resource changes) were not confirmed in this pass **[unverified]**.

### 2.9 Brawl (2025, returned 2026)

- 5v5 on a small custom map with no turrets or nexus. It launched in patch 25.10 (14 May 2025) and returned in 2026 [48][50].
- **Win condition:** each team starts with a 250-point health pool. A champion kill costs the victim's team 5 points, a minion kill costs 1, and each minion escorted into the enemy portal costs 1 [48]. Minion-kill damage pauses when a team is critically low [48].
- Boosted gold and XP, free champion pick, and matches of about 10 minutes [48].

### 2.10 League Classic (2026)

- Launched in patch 26.15 (29 July 2026). It is a separate older-era ruleset: an early-2010s rune and mastery system, older items and summoner spells, about 60 champions with pre-rework kits, and a recreated older version of the main map [51][52].
- It has **its own small queue set**: one PvP draft queue, Co-op vs AI and custom games, with balance passes every patch and new champions added over time [51][53].

### 2.11 Co-op vs AI

- Three difficulties: Intro, Beginner and Intermediate [54]. Intro bots stay in their base for the first few minutes, react slowly and use a fixed small roster [54].
- In patch 14.6, bot AI got better itemization, movement and combat, plus a wider champion pool [55].
- **Hidden onboarding use:** since January 2025, new and returning players may get some bots in their first Normal games while the system calibrates their skill [54][56].

### 2.12 Other 2025–2026 queue-adjacent changes

- **2026 season, standard map:** the 2025 mid-game boss objective was removed for the 2026 season [11].
- **Team voice chat:** a 2026 dev update and patch 26.20 coverage describe built-in team voice gated by honor level [58][59]. Details **[unverified]**.

---

## 3. League queue mechanics

### 3.1 Position select and autofill

- **Draft and ranked queues:** players pick a primary and secondary position, or Fill [16].
- **Swiftplay:** players pick a role *and* a champion for both choices [4][6].
- **Autofill (2026):** the matchmaker tries to mirror autofilled players by position, otherwise balances autofill counts between teams, and otherwise compensates with MMR. Autofill carries over through a dodge [23][24].

### 3.2 Ready check

When a match is found, every player must accept within a short window **[exact seconds unverified]**. Three failed ready checks count as one dodge for penalty purposes [26]. Repeated failures escalate into timed lockouts [26][27].

### 3.3 Dodge penalties (ranked, standard map)

- **Tier 1:** 6-minute lockout and −3 LP.
- **Tier 2:** 30-minute lockout and −10 LP.
- **Tier 3:** 12-hour lockout and −10 LP.
- **Decay:** tiers drop by one every 12 hours, replacing a full reset 24 hours after the last dodge [26].
- **What counts as a dodge:** failing to lock in during champ select [26].
- **Why the third tier exists:** it targets the roughly 1% of players who dodged 3+ times a day. At the time, about a third of champ selects in the highest tiers ended in a dodge [26].
- **2026:** Master+ dodges also count as a loss [23].

### 3.4 Champ select timing (draft queues)

- A 15-second declaration phase where players show their intended picks to teammates.
- A 30-second ban phase where all ten players ban at once. Allies' bans are visible during the phase; enemy bans stay hidden.
- A 5-second reveal of the bans [32].
- Alternating pick turns follow [32]; the exact per-turn order is **[unverified]**.
- Tournament and premade draft alternates 3 bans, 3 picks, 2 bans and 2 picks per side [20][32].
- 2026 cut about 30 seconds from champ select [23].

### 3.5 Party size limits

- **Solo/Duo:** 1–2 players [17].
- **Flex:** 1, 2, 3 or 5 players [17].
- **Ranked 5s:** exactly 5 [20].
- **Normal queues:** any size [16].
- **Swiftplay:** 1–5, with special rules for 5 [4].
- **Arena:** duos [43].

### 3.6 Leaver, AFK, remake and surrender (high level)

- **Leaving:** leavers always take a loss, even if their team wins. In ranked they get an LP reduction, and the other players are told the leaver will earn less LP over their next several games [28][29]. Leaver penalties apply to *all* matchmade modes, featured modes included. Repeat offenders go into a low-priority queue with longer waits [28].
- **Remake:** a vote opens at 3 minutes if a player never connected or disconnected. It needs no first blood to have happened. A remade game costs the remaining players no LP [30][31].
- **Surrender:** possible from 15 minutes on the standard map. Early votes must be unanimous; from 20 minutes, 4 of 5 is enough [31]. A team with an AFK player can surrender from about 3:30 with a unanimous vote [31].

---

## 4. Dota 2: mode list and queue structure

*(Weaker verification than Section 2; see the note at the top.)*

### 4.1 Mode list

- **All Pick (ranked and unranked):** the standard mode. Any hero from the full pool, with a ban phase first [60]. Liquipedia snippets describe:
  - a nomination-style ban vote where each nomination has a 50% chance to succeed, and the system auto-rolls extra bans weighted by ban rate at your skill bracket when fewer than 10 heroes get banned;
  - hero selection of about 75 seconds and a shorter pre-creep period of about 75 seconds [74].

  Players can random or swap heroes with teammates [74]. An older description has picks made in hidden simultaneous rounds, one per side per round, with extra time for the second player on a duplicate pick [74]. **[Whether this round structure is still current in 2026 is unverified.]**
- **Turbo:** an accelerated ruleset on the same map [60][62]. Games typically run about 20–30 minutes instead of 40–60 [60]. Rule changes reported, mostly from the 2017 launch and early coverage, so individual numbers may have drifted **[verify vs 2026]** [62][63][64]:
  - Experience and creep bounties are doubled, and gold-generating items and bounty pickups give more.
  - No gold is lost on death.
  - Towers are much weaker: reduced HP, and outer towers have negative armor.
  - Every player gets a personal, permanently fast courier.
  - Items can be sold anywhere, and the hidden-shop items are buyable from the normal shop.
  - Teleport and travel cooldowns are halved.
  - The final structure does not regenerate.
  - The big neutral boss respawns faster.
- **Captains Mode:** the competitive format. One captain per team runs a structured pick-and-ban draft [60]. Patch 7.40 reordered the first and third ban phases [69]. 7.40c added the then-newest hero to Captains Mode, a sign that new heroes are left out of CM for a while [70].
- **Captains Draft:** captain-led draft from a reduced random hero pool [60].
- **Single Draft:** each player chooses from three random heroes [60]. Whether the three are split by attribute is **[unverified]**.
- **All Random:** every player gets a random hero and some bonus starting gold [74].
- **Random Draft:** players take turns picking from a shared random pool. One snippet gives 20 heroes [74]; the current pool size is **[unverified]**.
- **Ability Draft:** each player gets a random hero body with no abilities. They draft 3 regular abilities and 1 ultimate from a pool made of the 10 players' heroes plus 2 extra random heroes [74][75]. In patch 7.41, every drafted hero keeps its innate ability, and the pool was updated for that patch's ability changes [71].
- **Arcade / custom games:** community-made modes in a separate browser [60]. Private custom lobbies with any official mode are standard **[unverified in this pass]**.
- **Bots, co-op vs bots and practice:** **[unverified in this pass]**.
- **Demo Hero / practice:** patch 7.40 made Demo Hero multiplayer. It added the big neutral boss and the mid-game neutral objective, plus menus to spawn any neutral, control time and change global settings [69].

### 4.2 Queue mechanics

- **Ranked roles:** Dota has one MMR per player, adjusted by hidden per-role offsets that the matchmaker uses. Players queue for specific positions out of five numbered roles. This has been in place since March 2020 [67].
- **Role-queue tokens:** players earn priority "role queue" games by searching with all roles selected. Solo players earn 4 per search, up to 60 [77][65]. Two-player parties earn 2 each and three-player parties earn 1 each. Five-stacks always count as role queue because they cover every role [65].
- **Party size:** parties of four cannot queue ranked, and five-stacks may be matched against other five-stacks [65][66].

### 4.3 2025–2026 patch cadence

- Patch 7.40 brought a hero, a talent-system overhaul, CM ban-order changes and the multiplayer Demo Hero [68][69].
- Patch 7.41 shipped on 24 March 2026. Lettered follow-ups ran through 7.41f on 15 September 2026, with 7.41e released ahead of the 2026 world championship [71][72][73][78].
- No new matchmade core mode was confirmed for 2025–2026 in this pass **[unverified]**.

---

## 5. How each game layers "same map, different rules"

**League**

The standard map hosts at least six different matchmaking contexts:

- Solo/Duo, Flex and Ranked 5s: rated, with different party and draft rules.
- Normal Draft: unrated.
- Co-op vs AI: bots.
- Swiftplay: rules overlay plus pre-pick.

Swiftplay shows how far a rules overlay can go without a new map [1][2][9][17][20]:

- start level and gold;
- disabled or substituted starter items;
- time-scaling gold and XP multipliers;
- a different objective spawn table (some objectives removed, others earlier, soul threshold lowered);
- staged structure decay ending in a hard cap.

The ARAM family stacks layers the same way. ARAM is the base single-lane mode, with a random-map roll per lobby. ARAM: Mayhem is ARAM plus an augment layer, shipped as its *own queue* rather than replacing ARAM [36][38]. League Classic goes the other way: a whole older ruleset and content snapshot with its own small queue set [51].

**Dota 2**

Nearly all core modes share one map and one ruleset and differ only in the *pick protocol*: All Pick, Captains Mode, Captains Draft, Single Draft, Random Draft, All Random and Ability Draft. Turbo is the main matchmade *rules overlay*. It doubles the economy, weakens structures, removes logistics friction (personal fast courier, sell anywhere) and removes the gold-loss-on-death risk [60][62][74]. This is a clean two-axis model: **pick protocol × ruleset**.

**Pattern across both games.** Faster casual variants work by:

- raising the starting state;
- multiplying the economy;
- compressing or simplifying the objective schedule;
- weakening or decaying structures over time;
- shortening the logistics loop (shopping, travel);
- lowering the cost of death.

Picking also moves *before* matchmaking or is removed altogether: pre-pick in Swiftplay, random picks in ARAM and All Random.

---

## 6. Implications for Vale

### (a) Public systems worth adopting in original form

1. **Data model: Mode = Map + RulesetOverlay; Queue = Mode + PickProtocol + MatchmakingPool + Stakes + PartyRule + Schedule.** Build each overlay field as data. The Swiftplay overlay is the template for these fields: start level, start gold, starter-item set, gold/XP multiplier curve over time, objective spawn table, structure-decay stages, hard cap, surrender thresholds and remake window. A Turbo-like or ARAM-like variant then costs data, not code.
2. **A fast pre-pick casual queue as the default front door.** Choosing role and character before queuing removes champ-select time and dodges entirely. That suits a browser game, where a long pre-game is a likely drop-off point.
3. **Staged sudden death with a hard cap.** Defense decay first, then a warning, then structure HP decay, then a guaranteed end. For browser sessions, target about 15–25 minutes for the casual mode, with a cap well under League's 36.
4. **Few queues at launch, with Normal Draft-style time windows.** Even League time-limits secondary queues in smaller regions. Start with three queues: one casual, one bots/onboarding and one ranked. Add or open others as population allows, and use scheduled windows (as in Ranked 5s) for premade ranked.
5. **Party-size rules per queue.** For example: solo/duo ranked; a flex queue without four-stacks; full five-stack-only weekend events.
6. **Escalating dodge and ready-check penalties with time decay.** Use several tiers, one tier of decay every N hours, and repeated ready-check failures counting as one dodge. Add a heavier rule at the top of the ladder.
7. **Autofill fairness.** Mirror autofilled players by position, balance autofill counts between teams, compensate the more-autofilled team, and give rating protection to players who fill hard-to-fill roles.
8. **Random-select fairness for the all-random mode.** Use a card-style roll with a guaranteed minimum number of choices, a shared team bench and a pity timer instead of unlimited rerolls.
9. **Augment-style overlays as separate queues.** Keep the base mode stable and ship the chaos variant beside it.
10. **Bots as onboarding scaffolding.** Use bot difficulty tiers, and quietly backfill early casual games with bots while new players are being calibrated.
11. **Turbo-style overlay knobs.** Personal fast logistics, sell-anywhere shopping and no death-gold loss are cheap levers for a casual ruleset.
12. **Rotating featured-mode slot.** Run one or two event slots on a calendar to give a live-service cadence without splitting the core pool.
13. **Remake and early-surrender rules for broken starts.** These matter more in a browser client, where closed tabs and network drops are likely.

### (b) Protected expression that must NOT be copied

- **Mode and queue brand names:** Swiftplay, ARAM, ARAM: Mayhem, Arena, URF/ARURF, Brawl, League Classic, Ranked 5s, Clash, Turbo, Ability Draft, Captains Mode/Draft. Name every Vale mode originally; generic descriptors like "draft" and "all random" are fine as plain words.
- **Map names and layouts:** all League and Dota map names, including the ARAM rotation maps, and their geometry, launchers, portals and plant placements.
- **Item, objective and boss names and identities:** the starter item names, lane-starter items, dragons and soul, the major late boss, the herald and grub-type objectives, the 2025 mid-game boss, and Dota's neutral bosses and courier identity.
- **Arena and Brawl expression:** the presentation of the fire ring, arena themes, the Brawl portal and its homeland theme.
- **Augment names and effects text, in full.** Use original augment concepts.
- **Branded system names:** the 2026 LP-protection system's name, the leaver-system name and honor naming.
- **UI and presentation:** champ-select and card UI layouts, icons, announcer lines, sounds, fonts and music.

### (c) Open questions for Vale

1. **Team size.** 5v5 like both references, or smaller (3v3/4v4) for browser concurrency and shorter matches? This choice drives every queue's population needs.
2. **Launch queue count.** How many concurrent players do we expect per region? Should secondary queues open only in scheduled windows from day one?
3. **Pick protocol.** Do we need draft champ select at all in the casual path? Is pre-pick enough for ranked at launch, with draft added later for premade or top-tier ranked?
4. **Match length targets.** Should the overlay hard-cap the casual mode at about 20 minutes and the standard mode at about 30? What does decay look like at those lengths?
5. **Ranked at launch?** If yes, what gates should apply (account level, roster size, completed games) given a likely smaller roster than League's?
6. **Disconnect policy for browsers.** Tab close or refresh grace period, reconnect window, remake window and whether bots backfill leavers.
7. **Dodge rules without champ select.** If pre-pick replaces champ select, what does a dodge even mean (a declined ready check only)?
8. **Featured-mode cadence.** How many rotating slots, how long each run lasts, and whether event modes get their own rating.
9. **Bots.** How much AI do we need for Co-op vs AI, onboarding backfill and practice (a Demo-Hero-style sandbox)?
10. **Confirm before locking design:** Dota 2's current All Pick pick order and timers, Turbo's current numbers, Random Draft pool size, the bot/co-op mode list (all marked [unverified] above), and the exact Swiftplay sudden-death timestamps, where sources conflict.

---

## Sources

1. https://blog.loltheory.gg/what-is-swiftplay/
2. https://www.leagueoflegends.com/en-us/news/dev/dev-a-swifter-swiftplay/
3. https://www.leagueoflegends.com/en-au/news/dev/dev-introducing-swiftplay/
4. https://wiki.leagueoflegends.com/en-us/Swiftplay
5. https://support.riotgames.com/en-us/league-of-legends/gameplay/swiftplay-game-mode
6. https://www.dodge.gg/lol/news/quick-play-guide-2026
7. https://blog.loltheory.gg/league-of-legends-game-modes/
8. https://www.nerfplz.com/lol-game-modes/
9. https://u.gg/lol/news/leagues-2026-season-quietly-reworks-the-entire-game
10. https://www.altchar.com/game-news/swiftplay-changes-in-league-of-legends-2026-brings-faster-matches-and-new-lane-mechanics-aTWiq4E7FCjl
11. https://www.turtlebeach.com/blog/league-of-legends-season-1-2026-all-objective-changes-atakhan-removed-and-more
12. https://wiki.leagueoflegends.com/en-us/Quickplay
13. https://x.com/LoLDev/status/1907654292946956464
14. https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-12-notes/
15. https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-13-notes/
16. https://www.dodge.gg/en-US/lol/news/normal-draft-guide-2026
17. https://www.dodge.gg/en-US/lol/news/ranked-flex-guide-2026
18. https://wiki.leagueoflegends.com/en-us/Ranked_game
19. https://leagueoflegends.fandom.com/wiki/Ranked
20. https://blog.loltheory.gg/ranked-5s-lol/
21. https://x.com/LeagueOfLeaks/status/2059735191040524525
22. https://support.riotgames.com/en-us/league-of-legends/events/ranked-5s
23. https://www.leagueoflegends.com/en-us/news/dev/dev-ranked-2026/
24. https://www.altchar.com/game-news/league-of-legends-ranked-2026-changes-explained-autofill-updates-aegis-of-valor-dodging-rules-and-faster-queue-times-asZ9b4U04yVM
25. https://x.com/LeagueOfLeaks/status/1995558607107293598
26. https://www.leagueoflegends.com/en-us/news/dev/dev-tackling-queue-dodging/
27. https://blog.loltheory.gg/how-to-dodge-league-of-legends/
28. https://wiki.leagueoflegends.com/en-us/LeaverBuster
29. https://support.riotgames.com/en-us/league-of-legends/penalties/away-from-keyboard-afk-faq
30. https://wiki.leagueoflegends.com/en-us/Remake
31. https://leagueoflegends.fandom.com/wiki/Surrendering
32. https://wiki.leagueoflegends.com/en-us/Draft
33. https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-13-notes/
34. https://esports.gg/news/league-of-legends/aram-rework-champion-cards-map-rotation-featuring-butchers-bridge/
35. https://www.oneesports.gg/league-of-legends/new-aram-map-rotation/
36. https://wiki.leagueoflegends.com/en-us/ARAM
37. https://www.leagueoflegends.com/en-us/news/dev/dev-all-random-all-mid-blind-bridge/
38. https://esports.gg/news/league-of-legends/aram-mayhem-announcement/
39. https://www.leagueoflegends.com/en-gb/news/dev/tldw-aram-mayhem-smurfing--more-dev-update/
40. https://www.gamegrin.com/news/is-aram-mayhem-a-permanent-game-mode-in-league-of-legends/
41. https://arammayhem.com/
42. https://www.altchar.com/game-news/league-of-legends-patch-26.21-adds-five-new-aram-mayhem-augments-atrno7Q1Y4E4
43. https://blog.loltheory.gg/what-is-arena/
44. https://www.dodge.gg/en-US/lol/news/arena-guide-2026
45. https://esports-news.co.uk/2026/01/09/riot-games-confirms-arurf-return-to-lol/
46. https://www.gamegrin.com/news/league-of-legends-brings-forward-arurf-date/
47. https://blog.loltheory.gg/what-is-urf/
48. https://wecoach.gg/blog/article/league-of-legends-brawl-mode-a-simple-guide
49. https://esports.gg/news/league-of-legends/introducing-brawl-the-new-5v5-game-mode-coming-to-league-of-legends/
50. https://www.sheepesports.com/us/lol/articles/lol-brawl-tier-list-of-top-10-best-champions-for-new-brawl-game-mode/en
51. https://www.gamespress.com/LEAGUE-OF-LEGENDS-CLASSIC-RELEASES-IN-PATCH-2615
52. https://blog.loltheory.gg/league-of-legends-classic/
53. https://esports.gg/news/league-of-legends/league-classic-roadmap-2026/
54. https://leagueoflegends.fandom.com/wiki/Co-op_vs._AI
55. https://www.leagueoflegends.com/en-us/news/dev/dev-new-bot-ai-oh-my-coming-14-6/
56. https://riftfeed.gg/lol-news/bots-update
57. https://blog.loltheory.gg/league-of-legends-average-game-time/
58. https://www.leagueoflegends.com/en-us/news/dev/tldw-team-voice-classic-more-dev-update/
59. https://accountshark.net/blog/lol-team-voice-chat-patch-26-20-guide
60. https://guildorder.com/games/dota2/wiki/game-modes
61. https://profilerr.net/matchmaking-game-modes-in-dota-2/
62. https://sportskeeda.com/esports/dota-2-turbo-the-best-game-mode-out-there
63. https://kotaku.com/turbo-mode-makes-a-game-of-dota-2-less-of-a-commitment-1821679132
64. https://www.esportstales.com/dota-2/ability-draft-changes-and-turbo-mode
65. https://liquipedia.net/dota2/Matchmaking
66. https://dota2.fandom.com/wiki/Party
67. https://dota2freaks.com/rank-role-performance/
68. https://www.dota2.com/patches/7.40
69. https://liquipedia.net/dota2/Version_7.40
70. https://www.gosugamers.net/dota2/news/77881-dota-2-patch-7-40c-adds-largo-to-captain-s-mode-nerfs-clinkz-and-broodmother
71. https://www.dota2.com/newsentry/512986184073347348
72. https://www.dota2.com/newsentry/677383425371407609
73. https://www.gosugamers.net/dota2/news/78889-dota-2-drops-patch-7-41e-supporter-bundles-fantasy-and-predictions-ahead-of-the-international-2026
74. https://liquipedia.net/dota2/Ranked_Matchmaking
75. https://liquipedia.net/dota2/Ability_Draft
76. https://www.hotspawn.com/?p=79912
77. https://dota2gamers.gg/what-is-dota-2-ranked-role-queue/
78. https://timesaver.gg/news/dota-2-next-patch-742-silent-update-september-29
