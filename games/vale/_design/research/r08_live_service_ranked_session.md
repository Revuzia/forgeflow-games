# R08: Live-Service Model, Economy, Ranked, and the Session/Server Model

Gap-fill pass 2026-10-07: 38 searches, 45 claims verified, 6 corrected, 12 still unverified.

Prepared for: VALE (Forgeflow Games), an original browser lane-brawler (custom Three.js/WebGL2 client)
Research date: 2026-10-07
Status: reference research. All numbers are calibration ranges, not values to copy.

> **How this was researched (read first).** The first pass ran with no web-search budget left. Direct page fetches were blocked by the egress proxy for leagueoflegends.com, technology.riotgames.com, ddragon.leagueoflegends.com, wikipedia.org, liquipedia.net, trueskill.org, glicko.net, protobuf.dev and gabrielgambetta.com. github.com and microsoft.com could be reached, so the rating-math and infrastructure sections rest on primary pages opened in that pass (sources [1]-[12]).
>
> Sources marked **†** in the list were confirmed from search-result snippets by the sibling research passes in this same run (R01 modes/queues, R02 match rules, R04 HUD/spectator, R05 client flow). This note reuses their findings and did not reopen those pages.
>
> **Gap-fill pass (same day).** A second pass ran 38 web searches. It made no page fetches, so every claim it added rests on search-result snippets (sources [70]-[128], marked **‡**). Where a snippet came only from a community guide or an aggregator rather than Riot, Valve or a primary paper, the text says **(secondary)**. Claims that are still **[unverified]** are listed in 7(c) item 9. Corrections from this pass are marked **Corrected:** inline.

---

## 0. Key takeaways

1. **The match is the unit of progress.** Each finished match feeds several meters at once: account XP, a seasonal pass track, mission counters, per-character mastery, and (in ranked) a visible ladder score backed by a hidden rating. LoL's 2025 home screen puts pass level, XP progress, the next reward and the mission list on the landing page [28][29].
2. **There are two currencies: one earned and one bought.** Power is never for sale. In LoL the earned currency (Blue Essence) unlocks champions, and Riot halved every champion's Blue Essence price in patch 25.05 (March 2025) [89][91]. The bought currency (RP) is sold in fixed bundles, from 575 RP for USD 4.99 to 13,500 RP for USD 99.99 in North America [95]. Cosmetics change only looks.
3. **Ranked is two layers.** A hidden rating (MMR) drives matchmaking. A visible ladder (tiers, divisions, LP) drives motivation. **Verified:** when MMR sits above the visible rank, wins give more LP and losses take less, and the reverse applies when MMR sits below, so the ladder drifts toward the hidden rating [77]. LoL keeps separate ratings per ranked queue: Flex has its own MMR and rewards apart from Solo/Duo [14].
4. **The rating math should model teams and uncertainty.** TrueSkill-style systems track skill as a mean plus an uncertainty. They show a conservative μ − 3σ score and need far more games to converge in big team matches than in 1v1. Microsoft's figures are 12 games for 1v1 versus 91 for 8v8 teams [1]. OpenSkill gives the same model family under the MIT license, with a JavaScript port [3][4].
5. **Queue integrity rests on timed gates with escalating penalties.** LoL uses a 12 s ready check [19]. Dodges are penalized in three tiers (6 min/−3 LP, 30 min/−10 LP, 12 h/−10 LP), and each tier decays every 12 h [18]. In 2026, a dodge at Master+ also counts as a loss [15][16].
6. **Content seasons run on a patch clock, but the ladder resets once a year.** LoL ships patches about every two weeks [43][44][45][85]. 2026 has three themed seasons: Season 1 on patch 26.1 (January), Season 2 on 26.9 (29 April) and Season 3 on 26.17 (26 August), with the year closing around 9 December [45][85]. **Corrected:** the first pass assumed each season boundary also soft-resets ranked. In 2026 the ranked ladder resets only once a year, in January. At the Season 2 and 3 boundaries, rank and MMR carry over while themes, missions and ranked rewards refresh [82][83].
7. **Servers are authoritative, and the client mainly sends commands.** **Verified:** LoL's server targets one tick every ~33 ms (30.30 Hz), and the rate can sag under load [70]. Riot also says the LoL server does not use a fixed step: it measures each frame's delta and throttles to a target frame rate [71]. Dota 2's server runs at 30 ticks/s [72] (secondary). Spectating is deliberately delayed: about 3 min in LoL [61], and set by the organizer in Dota, up to a 15-min tournament option [63][64].
8. **Patches go out through content-addressed chunks on a CDN.** Riot's patcher splits files into zstd-compressed chunks inside bundles and lists them in manifests, so an update downloads only the chunks that changed [9]. Riot keeps separate manifests for the platform client and for each game [11]. **Verified:** a LoL `.rofl` replay re-simulates the match in the client, so it plays only on the patch that recorded it [65][123]. That shows the cost of not versioning simulation data.
9. **The flow is a state machine.** It runs login, home, party, queue, ready check, draft, load, in-game, post-game, then back to the lobby. Every step has a timer and a fallback [19][24][32]. LoL's client exposes these states through a local REST/WebSocket API [12].

---

## 1. Progression and per-match rewards

### 1.1 Account level and match XP

- **Account level gates ranked.** LoL requires account level 30 and at least 20 owned champions before ranked [13]. The gate holds back smurfs and gives new players time to learn **[design reading]**.
- **XP per match** depends on win or loss and on game length. **Corrected:** the first pass assumed a first-win-of-the-day bonus still exists. LoL removed it in January 2025 (V25.S1.1). It had given 400 XP and 50 Blue Essence. Riot raised account XP by about 40% in 25.S1.2 to compensate and replaced the daily mission with one that pays pass XP [93][94]. The result is that play is no longer rewarded for being spread across days [94] (secondary). Exact 2026 XP values **[unverified]**.
- **Level-up rewards** have historically included earned currency and champion unlock tokens. Riot restructured rewards in 2025, and headlines report that it admitted getting the first version of the change wrong [128]. The exact current level-up table is still **[unverified]**.
- **Visible level signals.** The loading screen shows a level border on each player's card, and a ranked border from Silver upward [31][69]. Level is a status display, not a power stat.
- **Behaviour score as a progression track.** Honor is LoL's behaviour score. In 2025 everyone was reset to level 3, and the yearly reset stopped [32][33]. Honor level raises the per-player ping allowance [68]. **Verified and sharpened:** LoL Team Voice launches today (7 October 2026) on NA and OCE, with Korea, Brazil and LATAM next. Players below Honor level 3 can listen but cannot speak, and push-to-talk is required [104][105]. Good conduct is itself a meter that unlocks features.

### 1.2 League of Legends reward surfaces (2025-2026)

| Surface | What it does | Confidence |
|---|---|---|
| Season pass with free and premium tracks | Pass level, XP bar and next reward shown on the home screen. Pass XP comes from matches and missions | Confirmed shape [28][29] |
| Missions | A list of tasks, each with description, progress and reward. Typical tasks are "play N games", "win N games", "get N takedowns as role X" | Shape confirmed [28]. Task contents **[unverified]** |
| Role quests (in-match, 2026) | A per-match progression bar for each role, separate from account progression | See R02 |
| Earned currency ("Blue Essence") | Unlocks champions. Patch 25.05 (5 March 2025) halved every champion price: the 450/1350/3150/4800/6300 BE tiers became 225/675/1575/2400/3150, and a new champion dropped from 7800 to 3900 BE [89][91] | **Verified** ‡. Full list of BE sources (missions, pass, level-ups) **[partly unverified]** |
| Premium currency ("RP") | Bought with money. Buys skins, passes, bundles. NA bundles: 575 RP for USD 4.99, 1380 for 10.99, 2800 for 21.99, 4500 for 34.99, 6500 for 49.99, 13,500 for 99.99 [95]. The store has a Buy-currency flow: pick payment method, pick a bundle, balance updates [34][35] | **Verified** ‡ (price list secondary) |
| Loot chests and keys | Random cosmetic rewards. For Season 2025 Riot removed every way to earn free chests and moved chests into the paid store [87][90]. Riot's stated reason was that free chests had become the main way players unlocked skins, which cut skin purchases [87]. Players called for a boycott [88]. Chests came back from Act 2 (patch 25.05): 10 per act, 8 on the free pass and 2 through Honor, about 60 a year over six acts [89][90] | **Verified** ‡ |
| High-end gacha ("Sanctum") | A paid random-draw system for Exalted-tier skins and mythic variants. Its currency (Ancient Sparks) costs 400 RP each, and players can buy up to 250 a day (100,000 RP) [97] | **Verified** ‡. Launch date (late 2024) **[unverified]** |
| Premium direct bundles | **Corrected:** the "about USD 250" headline price belongs to the 2024 Faker Hall of Legends Ahri collection, a direct-purchase bundle, not to Sanctum spend. It came in three tiers: 5,430 RP (about USD 46), 32,430 RP (about USD 250) and a signature tier at 59,260 RP (about USD 450) [98][99] | **Verified** ‡ |
| Champion mastery | 2024 revamp: mastery is uncapped. Each level needs a mastery score plus a Mark of Mastery, earned through high match grades. A seasonal milestone track resets every split, and the last milestone grants the champion's title for that split. Mastery Sets reward players who spread across champions [102][103]. Shown on the loading screen's alternate view [31] | **Verified** ‡ |

**Design reading.** The 2025 cycle shows the risks of a mature live service. **Now verified:** Riot removed earned free rewards (chests), defended the cut on revenue grounds, faced a boycott call and a petition, and then partly reversed within about two months. It brought chests back and halved champion prices at the same time [87][88][89][90]. One player's estimate of 882 hours to unlock a champion under the interim system circulated widely [92] (a player claim, not a Riot figure). The structural part is unchanged: Riot rebuilt the home screen around the season and its pass [28], and each 2026 season boundary brought gameplay changes [30][45][46].

### 1.3 Dota 2 reward surfaces

- **The battle pass era is over.** **Verified:** Valve announced in 2023 that there would be no Battle Pass for that year's International, so the 2022 pass was the last. Valve said most players never bought a pass and never got rewards from it, and that it would spend the effort on updates every player gets, while still shipping some cosmetics [115][116]. It was replaced by smaller, act-based seasonal events built around in-match play and earned tokens. Coverage of patch 7.35d (2024) already mentioned the coming "Crownfall" event [56].
- **2025-2026 monetization is spread across smaller pieces.** Patch 7.41e (2026) came with supporter bundles, fantasy and predictions ahead of the 2026 world championship [59]. The September 2026 update swapped the dashboard background to the current event and moved older events to a smaller banner slot [58].
- **A subscription sells information and progression, not power.** Dota Plus puts a per-source damage breakdown in the post-game behind the subscription [57]. A subscriber-only pre-match screen showed expected skill spread, ping and behaviour scores, with the option to requeue [56]. **Verified:** Dota Plus also carries hero levelling with badge tiers, hero challenges at three difficulties, an in-match assistant that suggests picks, items and skill order, and Shards, a currency earned through levels and challenges and spent on cosmetics [117]. Reported price: USD 3.99 a month, 22.99 for six months, 41.99 for twelve [118] (secondary).
- **Top-tier cosmetics (Arcana)** are the highest tier of single-hero cosmetic. They are earned through events or bought, and change models, effects and sounds, never stats **[unverified]**.
- **Everything is earned or bought through play and events. No currency buys a hero.** All heroes are free in Dota, while LoL sells or grinds champion unlocks **[unverified in either pass, but long-standing and widely known]**.

### 1.4 The "cosmetics never change stats" principle

Both games sell only appearance. Hitboxes, timings, sounds that carry gameplay information, and readability stay the same across cosmetics **[practitioner consensus; no formal policy page confirmed]**. Paid information is the gray zone. Dota sells post-game breakdowns, pre-match analytics and an in-match pick and build assistant through its subscription [56][57][117]. Vale should decide on purpose whether analytics are free (better for fairness and learning) or paid (revenue that risks "pay to understand").

---

## 2. Store, collection and entitlements

### 2.1 Skin tiers and variants

**Verified (secondary) [96]:** LoL prices skins in RP tiers that track production scope:

| Tier | RP | Approx. USD (analysis) | Scope |
|---|---|---|---|
| Chroma | 290 | ~2.1-2.5 | Color variant of an owned skin |
| Timeworn | 520 | ~3.9-4.5 | Small texture changes, new splash |
| Budget | 750 | ~5.6-6.5 | Simple costume, some model change |
| Standard | 975 | ~7.2-8.5 | New model and textures, some new animations, effects or sounds |
| Epic | 1350 | ~10-11.7 | New model, textures, animations, effects and sounds. Most new releases sit here |
| Legendary | 1820 | ~13.5-15.8 | Full reimagining, with new versions of everything |
| Ultimate | 2775-3250 | ~20.5-28 | Evolving models and textures, plus bonus content |

Above these sit a Mythic tier priced in a separate currency (reported at 100 Mythic Essence [96], secondary), Exalted skins from Sanctum [97], and one-off direct bundles priced in the hundreds of dollars [98]. **Corrected:** the first pass put the bands at USD 5-7, 10-13 and 18-25. The USD column above is this pass's arithmetic from the NA bundle rates [95] (about 115-135 RP per dollar, depending on bundle size), and the low end of each range assumes the largest bundle. The store has featured items, bundles and rotating sales. Clicking a skin card opens details and an animation preview [34][35]. Collection grids filter by ownership and group skins by champion, set or tier [R05; filter details unverified].

### 2.2 Ownership, refunds and mastery

- **Entitlements.** Each owned item is an account-level record: item id, how it was acquired (purchase, reward, gift, loot), timestamp and price paid. The collection and the draft-screen skin picker read from it **[practitioner model; LoL's internal schema not public]**.
- **Refunds (LoL).** **Verified:** every account has three refund tokens. They cover champions, skins and other cosmetics bought with RP or Blue Essence, inside a window of up to 90 days after purchase, with separate rules for used and unused content. A player who no longer holds all three tokens can claim a replacement through support [100][101]. The exact window rules for used versus unused content are worded inconsistently in the snippets, so check the policy page before relying on them. A refund has to reverse the entitlement *and* every derived record (equipped loadout, bundle discounts) **[practitioner]**.
- **Mastery** is a per-character progression shown in status displays (loading screen, profile) [31][102]. It is a display-only counter of use and performance.

---

## 3. Ranked

### 3.1 LoL ladder structure

- **Queues and separate ratings.** Solo/Duo takes parties of 1-2. Flex allows 1, 2, 3 or 5 players (no four-stacks) and has a fully separate rank, MMR and rewards [14]. Ranked 5s (2026) needs an exact five-premade, runs in weekend windows, uses tournament draft and keeps its own individual LP ladder [17][44].
- **Placements.** **Verified (secondary):** in 2026 each ranked queue has five placement games. A win adds LP, and a loss adds nothing instead of costing LP [80][81]. One guide also says Diamond III is the highest possible starting placement [81] (single source).
- **Tiers and divisions.** **Verified:** there are ten tiers, Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster and Challenger. Iron through Diamond each have four divisions (IV to I). Master and above are apex tiers without divisions. Grandmaster and Challenger are capped pools, filled by the top LP players on each server with daily cutoff updates. Challenger is typically the top 300 per region [78]. Promotion series are gone: reaching 100 LP moves you up [77].
- **Distribution (August 2026, secondary) [79]:** Iron 2.5%, Bronze 17%, Silver 23%, Gold 24%, Platinum 18%, Emerald 11%, Diamond 3.7%, Master 1.1%, Grandmaster 0.077%, Challenger 0.032%. The middle four tiers hold about 82% of players, and Master+ about 1.2%.
- **LP versus MMR.** **Verified:** LP gains and losses are skewed toward the hidden MMR. A player whose MMR sits above their visible rank gains more and loses less until the two meet, and the reverse applies too [77].
- **2026 changes** [15][16]:
  - *Autofill parity.* The matchmaker tries to mirror autofilled players by position. Failing that, it balances autofill counts between teams. Failing that, it gives the more-autofilled team slightly stronger teammates.
  - *LP protection.* Autofilled players, and mains of hard-to-fill roles, get LP protection or bonus LP.
  - *Dodging.* A dodge no longer resets autofill status. At Master+, a dodge also counts as a full loss.
- **Dodges** [18][20]:
  - Tier 1: 6-min lockout and −3 LP.
  - Tier 2: 30-min lockout and −10 LP.
  - Tier 3: 12-h lockout and −10 LP.
  - Tiers step down every 12 h.
  - Three failed ready checks count as one dodge.
  - Tier 3 targets about 1% of players who dodged 3 or more times a day. At the time, about a third of top-tier champ selects ended in a dodge [18].
- **Leaving.** Leavers always take a loss. In ranked they also lose LP, and repeat leavers go to a low-priority queue [21]. A remake vote opens at 3 min if a player never connected or dropped, and remade games cost no LP [22]. Surrender opens at 15 min and needs a unanimous vote early, 4 of 5 from 20 min [23].
- **Decay.** **Verified from Riot support snippets [75][76]:** decay applies only from Diamond up. Players there hold "banked days", and one decay check runs each night. When the bank is empty, each check removes LP until the player plays again.
  - Diamond: 28 days to start, +7 days per ranked game, capped at 28, and −50 LP per decay.
  - Master, Grandmaster and Challenger: 14 days to start, +1 day per game, capped at 14, and −75 LP per day.
  - Below Diamond there is no decay.
- **A match-integrity system (2026 S2)** detects matches ruined by deliberate feeding and ends them [46]. R02 has the details.

### 3.2 Season and split cadence

- **2023-2025.** **Verified:** 2023 had two ranked splits, and 2024 had three, each with a reset and its own rewards, about four months apart [86]. 2025 replaced splits with three themed seasons of two acts each (six acts a year) [28][90].
- **2026.** **Verified:** three themed seasons. Season 1 started on patch 26.1. The ranked reset ran on 8 January, with queues down for about twelve hours, followed by placements [83]. Season 2 started on 26.9 (29 April) with gameplay changes such as role-quest tuning and new starter items [45][46]. Season 3 started on 26.17 (26 August) and runs through 26.24, with the season finale around 9 December [85]. **Corrected:** the first pass assumed every season boundary is a ranked soft reset. In 2026 rank and MMR carry across the Season 2 and 3 boundaries, and only themes, missions and ranked reward tracks refresh; the ladder resets once a year in January [82][83]. The one exception was a hard reset of Master+ in six regions at 26.9, made because of matchmaking problems [84].
- **Reading.** The content season (theme, pass, missions, a large gameplay patch) and the ladder season (the reset) are now on different clocks: about every four months for content, once a year for the ladder. Rewards refresh per content season, so there is still a fresh goal three times a year without wiping progress three times a year **[analysis]**.

### 3.3 Dota 2 ranked

- **One MMR with per-role offsets.** Dota keeps a single MMR per player. Hidden per-role offsets have been used by the matchmaker since March 2020 [47].
- **Role queue.** Players queue for numbered positions. Searching with all roles selected earns priority tokens: 4 per search for solo players (cap 60), 2 each in a two-player party, 1 each in a three-player party. Five-stacks always count as role queue [48][49]. Four-player parties cannot queue ranked [48].
- **Medals.** **Verified (secondary):** eight medals: Herald, Guardian, Crusader, Archon, Legend, Ancient, Divine and Immortal. The first seven have five stars each, and Immortal uses a numbered regional leaderboard instead [112].
- **Gates and calibration.** **Verified:** ranked needs 100 hours played on the account, a unique phone number linked to the Steam account (a removed number waits three months before another account can reuse it), and a behaviour score that is not extremely low [48][113]. New players then play 10 calibration games, and the medal keeps settling until the rank confidence rises above 30% [112][114]. The exact behaviour-score floor is not public in the snippets.
- **Draft burden reduced.** The in-match ban phase was replaced (7.35d) with ban preferences saved on the account. Players save up to four heroes they want banned, and at least one is guaranteed to be [55].

### 3.4 Rating math: options and why

| System | State per player | Team support | Notes |
|---|---|---|---|
| Elo | One number | Not natively. Team averages are a hack | Simple and transparent, but no uncertainty, so placements need special-case K-factors **[general knowledge]** |
| Glicko-2 | Rating (default 1500), deviation RD (default 350 for a new player), volatility (default 0.06) [5][119][121] | Not designed for multi-competitor matches. Library add-ons break them into pairwise matches [5] | **Verified against Glickman's paper as quoted in snippets [119][120]:** the system constant τ should be 0.3-1.2 (implementations commonly default to 0.5), and the system works best when players average at least 10-15 games per **rating period**. It is not meant for single-match updates. Ratings update after each period, not during it [120] |
| TrueSkill | μ and σ | Yes. Team skill is the sum of member skills, and only the final standing is used [1] | Leaderboard shows μ − 3σ, a conservative floor [1]. Convergence takes 12 games for 1v1, 5 for 4-player FFA, 91 for 8v8 teams, and can be up to 3× more [1]. Owned by Microsoft (Xbox Live since 2005) [1]. Licensing is a known concern, and OpenSkill sells itself as the open-license alternative [3] |
| TrueSkill 2 | Adds experience, squad membership, individual kills, tendency to quit, and skill in other modes | Yes | Predicted Halo 5 outcomes with 68% accuracy versus 52% for TrueSkill [2] |
| OpenSkill (Weng-Lin 2011) | μ (default 25), σ (default 8.333) | Yes, including asymmetric team sizes and partial play | MIT license. Plackett-Luce, Bradley-Terry and Thurstone-Mosteller models. Ordinal score is μ − 3σ. Reported up to 20× faster than TrueSkill in JS benchmarks. Ports exist in JS, Python and others [3][4] |

**Why shipped games use the Bayesian family.**
- *Uncertainty doubles as a placement system.* High σ means big moves early, so no separate "provisional" code path is needed [1][3]. Dota's visible "rank confidence" is the same idea shown to the player [114].
- *Convergence in 5v5 is slow.* The 8v8 figure (91 games) suggests a 5v5 game needs dozens of matches per player to settle [1] **[5v5 figure inferred, not measured]**. Signals beyond win/loss (individual performance, party, quitting) speed this up, as TrueSkill 2 shows [2].
- *Season soft resets* can raise σ instead of moving μ, so returning players re-settle quickly without losing their history **[practitioner]**. LoL now resets visible rank only once a year and keeps MMR across seasons [82][83].
- *Decay* can be modelled as σ growing with inactivity, which is how Glicko's RD works by design [5]. LoL's visible decay is a separate banked-days layer on top [75][76].

---

## 4. Bots, custom lobbies and practice

### 4.1 Bots and co-op queues

- LoL's co-op vs AI queue has three difficulty levels. The easiest bots stay in base for the first few minutes and react slowly [25]. Patch 14.6 improved bot items, movement and combat and widened the bot champion pool [26].
- **Hidden onboarding.** Since January 2025, new and returning players may get some bots in their first normal games while the system calibrates their skill [25][27]. Bots act as cover for a cold start.
- **Verified:** Dota lobbies can fill empty slots with bots (off by default), with a chosen difficulty, including custom bot scripts downloaded from the Workshop [53][110].

### 4.2 Custom lobbies

- **Dota.** A lobby browser with filters for game type, connection quality, open slots and friends or LAN [53][54]. The organizer sets the DotaTV spectator delay, including an automatic 15-min option for tournament lobbies [63][64]. **Verified:** further settings are lobby name, password and visibility, server region, game mode, series type (best of 3 or 5), first pick, all-chat, spectator permission, league id, cheats (which need a local-host server), and bot fill with difficulty [53][110][111].
- **LoL.** **Verified [109]:** custom games are non-matchmade lobbies where the host invites players to teams or spectator slots and can add bots. Pick types are Blind Pick, Draft Mode, All Random and Tournament Draft. Spectators can be set to none, lobby only, or all. **Corrected:** the first pass also listed a "friends" spectator option, which the snippet does not show. Map choice, team size 1-5 and an optional password are still **[unverified]**.
- **Common feature set.** Lobby name and password, side and slot assignment with drag-to-swap, team balance or shuffle, bot fill with difficulty, spectator slots and policy, pick format, ruleset toggles, a series type, and a host who can kick and start **[practitioner synthesis, now backed by the Dota list above]**.

### 4.3 Practice sandboxes

- **LoL Practice Tool.** **Verified, from the launch feature set (patch 7.3, early 2017) [106][107]:** it is a solo game on the main map with an optional bot and a command panel. Player commands: auto-refresh cooldowns, health and mana (or energy), add gold, level up, lock level, teleport to the cursor target, and revive. Game commands: invulnerable turrets, turret fire off, minion waves on or off, fast-forward the clock 30 s, reset the game, spawn enemy or allied target dummies, and clear dummies. Jungle commands: respawn camps and spawn a chosen dragon. **Corrected:** the first pass listed a pause and "lock cooldowns at zero". Pause is not in the confirmed list, and the cooldown control is an auto-refresh. Riot has added little since launch, players keep asking for a better tool, and multiplayer team drills are not planned [108]. Nothing is at stake and no penalties apply.
- **Dota Demo Hero.** Opened right from any hero page with no queue. It gives instant levels and items, target dummies, and toggles for no cooldowns or infinite mana, and previews equipped cosmetics, including unowned ones [51][52]. Patch 7.40 made it multiplayer and added menus to spawn any neutral, control time and change global settings [50].
- **Reading.** Dota's sandbox does three jobs at once: it teaches the game, previews cosmetics before purchase (a store conversion tool), and replaces a separate "try skin" screen. LoL's tool has stood still since 2017, and its players say so [108].

### 4.4 Matchmaking infrastructure

Open Match is Google's open-source framework. It shows the standard decomposition: **tickets** (one per searching party), a custom **match function** (who goes together), a **director** (assigns matches to servers), and **backfill** for partly filled games [6]. Agones handles the server side. It runs dedicated game-server processes on Kubernetes in fleets, with health checks, autoscaling and an allocation API that a matchmaker calls to claim a ready server [7].

---

## 5. Session and server model

### 5.1 Authority, tick rate, and the command model

- **Dedicated, authoritative servers.** Both reference games run the match on a server they control. Clients send intent (move here, cast at this point or target, buy item), and the server decides outcomes **[standard genre practice; confirmed indirectly by server-side penalty, remake and termination features [21][22][46]]**. The LoL wiki describes each server tick as processing player inputs, AI, pathing, positions, stats and damage [70].
- **Tick rate.** **Verified:**
  - *LoL.* The server targets a 33 ms tick (30.30 Hz). The rate is a target, not a guarantee: a tick that overruns slows the next ones, and players feel compounding lag [70]. Riot's determinism series adds that the server uses a measured frame delta throttled to a target frame rate rather than a fixed step. That makes it resilient to load spikes, but determinism became harder, and Riot had to refactor its clocks into a "Unified Clock" starting in 2016 [71].
  - *Dota 2.* 30 ticks/s [72] (secondary; no Valve page found).
  - *Shooters, for comparison.* VALORANT runs at 128 ticks/s, which needs each server frame done in 7.8125 ms. Riot rebuilt engine systems to cut the frame time from 50 ms to under 2 ms to get there [73]. CS2 runs at 64 Hz with sub-tick timestamps, and Apex Legends at 20 Hz [74].
  - *Reading.* 30 Hz is enough for click-to-move games, where commands are intents rather than twitch aim.
- **Prediction versus pure authority.** The MOBA pattern leans server-authoritative with instant local feedback: a click marker, a move or cast animation started at once, and cooldown UI updated optimistically. The client then interpolates entity positions between server snapshots, and full rollback-style prediction is uncommon **[still unverified for both titles; the search returned only generic netcode documentation]**.
- **Transport.** Valve's open-source GameNetworkingSockets shows the expected feature set: a connection-oriented but message-based API with reliable and unreliable messages, automatic fragmentation, AES-GCM-256 per-packet encryption, and ICE-based NAT traversal [8]. In a browser, the matching options are WebSocket (reliable only) and WebTransport/WebRTC data channels (unreliable allowed) **[general knowledge]**.

### 5.2 Disconnects and reconnects

- If a player never connects or drops early, a remake vote opens at 3 min [22]. Otherwise the game goes on with the absent player's character idle, and leaver penalties apply if they do not return [21].
- **Reconnect** in LoL is a client button that rejoins the running match. The client loads the current state and catches up **[mechanism unverified]**.
- **Verified (community spec) [122]:** LoL's spectator stream is split into chunks of about 30 s of play, each holding only changes, plus periodic keyframes that hold the full game state. A late joiner, or a viewer skipping back, loads the keyframe before the target time and then applies the following chunks. The data is gzip-compressed and then encrypted per game. The same keyframe-plus-delta idea can serve reconnect.

### 5.3 Spectating and replays

- **Delay.** LoL's standard spectator delay is about 3 min, to stop live ghosting [61][62]. Dota's DotaTV delay is set per lobby, with a 15-min tournament option. Some events ask for 10 min plus 5 more for community streams [63].
- **Replays.** LoL saves `.rofl` files from match history. **Verified:** a `.rofl` is not video. It re-simulates the match inside the game client, so it plays only on the patch that made it, and old files can never be opened again once the client updates [65][123]. The only way to keep a replay is to record it as video before the next patch [123]. The system dates from the 2016 preseason [124]. The timeline is auto-marked with kills and objectives, and clips can be exported as video [65][66]. Dota replays support DVR rewind and a player-perspective camera. Hiding replay speed in a dropdown drew complaints from video editors [67].
- **Design reading.** Patch-locked replays are what you get when replay playback depends on the exact simulation build. A browser game can do better by storing the sim version with each replay and keeping old sim builds on the CDN, so the replay viewer loads the matching build **[practitioner]**.

### 5.4 Patching, versioning and delivery

- **Cadence.** LoL patches every two weeks, with occasional three-week gaps. The 2026 dates support this: 26.9 around 29 April, 26.15 on 29 July, 26.17 on 26 August, 26.18 on 10 September [43][44][45][85]. Patch notes are published per numbered patch, for example 26.12 and 26.13 [41][42].
- **Numbering.** 2025 started with a season-scoped label (V25.S1.1) [29]. 2026 uses year-plus-sequence numbers (V26.01, 26.12, ...) [30][41]. Community tools also track internal game build numbers separately from the marketed patch name [10] **[exact mapping unverified]**.
- **Dota cadence.** Dota ships fewer, bigger numbered patches with lettered follow-ups. 7.41 shipped on 24 March 2026 and the follow-ups ran through 7.41f in September 2026 [59][60].
- **Client versus content.** The LoL client is a web-tech front end (Chromium Embedded Framework) built from separately deployable plugins that declare API changes with semantic versioning [36][37]. Riot keeps separate manifests for its platform client and for each game [11]. Game archives hold game data alongside the client UI files [10]. Riot's 2020 client cleanup cut 57% of plugins and brought boot time from 29.5 s to 16 s [38]. Riot has confirmed a new merged "around-game" client for 2027 [39][40].
- **CDN delivery.** Riot's patcher splits files into chunks and packs them into zstd-compressed bundles listed in manifests. A diff between two manifests downloads only the chunks that changed. The downloader runs many parallel workers with retry logic [9].
- **Feature flags and old-client compatibility.** The common practice, not confirmed for LoL or Dota specifically, is server-side flags for queues and features. These allow a queue to be time-windowed or dark-launched; LoL's region-specific queue hours [R01] fit this pattern. On the protocol side, a version handshake at connect lets the server reject or upgrade stale clients. Schemas only grow: field ids are never reused, and unknown fields are ignored **[practitioner; protobuf docs blocked]**.

---

## 6. Session flow as a state machine

LoL's client exposes its state through a local REST plus WebSocket API, which community tools document by reading it live [12]. The phase names below come from community knowledge of that API **[unverified]**.

| Phase | Player-facing step | Timer or gate | Fallback or penalty |
|---|---|---|---|
| Login / boot | Authenticate. Client loads. Home shows the season, pass and missions [28] | Boot time tracked as a KPI [38] | Version check, forced update |
| Lobby | Party invites. Position selection is required on the main map in 2026 [30] | Party-size rules per queue [14][17] | Can't queue until valid |
| Matchmaking | Searching. Shows the estimated wait | Autofill and role-queue logic [15][48] | Leave queue at any time |
| Ready check | Accept or decline | **12 s** [19] | A decline or timeout requeues the others. Repeated failures count as dodges [18] |
| Champ select | Intent, then bans, then picks, then trades | 15 s intent, 30 s simultaneous bans, 5 s reveal, then timed picks. Riot cut about 30 s from it in 2026 [15][24] | Failing to lock is a dodge [18]. A confirmed griefer ends the lobby (26.1) [30] |
| Loading / game start | Player cards with rank and level borders and mastery [31] | Waits for all clients | No-shows lead to a remake vote [22] |
| In progress | The match. Team Voice (from 26.20 on NA/OCE) needs Honor 3 to speak [104] | Surrender windows [23] | Reconnect. Leaver handling [21] |
| Waiting for stats / pre-end | Short honor vote: commend one teammate, about 40 s [32][33] | Timed | Skippable **[unverified]** |
| End of game | Scoreboard, progression bars, rewards | None | "Play again" goes back to the lobby with the party intact |

---

## 7. Implications for Vale

All items here are **analysis**. Where an item rests on a verified fact, the citation is given.

### (a) Public systems worth adopting in original form

1. **Hidden rating with OpenSkill (Plackett-Luce), a visible ladder on top.** It is MIT-licensed with a JS port [3], handles 5v5 and uneven teams, and treats uncertainty as the placement system. Show a derived tier and points value that moves toward the conservative μ − 3σ score [1][3], and skew point gains and losses toward the hidden rating the way LoL does [77]. Use one rating per ranked queue [14]. Avoid Glicko-2 for per-match updates: it is designed for rating periods of 10-15+ games per player [119][120].
2. **Decouple the content season from the ladder reset.** Run content seasons (theme, pass, missions, big patch) on a roughly 3-4 month clock. Reset the visible ladder less often, once a year as LoL 2026 does, and refresh ranked rewards each content season instead [82][83]. Do a reset by raising σ rather than moving μ. Keep a short placement run (LoL uses 5 games with no LP loss on a defeat [80][81]).
3. **Decay only at the top, as a banked-days counter.** LoL's model is cheap to build and easy to explain: a bank of days that games refill and that drains one day each night, with a flat point loss once it is empty. LoL uses 28 days and +7 per game for its upper non-apex tier, and 14 days and +1 per game for apex tiers [75][76]. Under the hood, also grow σ with inactivity [5].
4. **Timed gates everywhere, with escalating penalties that decay.** A 10-15 s ready check. Repeated failures count as a dodge. Three dodge tiers that step down every N hours. A harsher rule at the top of the ladder [18][19].
5. **Two currencies, cosmetics only, and no paid randomness.** An earned currency unlocks characters. With a small roster, keep unlocks fast or free: LoL halved its champion prices after players complained about the grind [89][91]. A premium currency buys cosmetics, a seasonal pass and bundles, sold in a few fixed bundles with a modest bulk bonus (LoL's ranges from about 115 to 135 RP per dollar [95]). **Never quietly remove a free reward once it has shipped:** Riot's 2025 chest removal led to a boycott call and a reversal within one act [87][88][89][90]. **Ship no paid random items.** Belgium's gaming regulator treats paid loot boxes as illegal gambling [125], and Brazil's Law 15,211/2025 bars selling loot boxes to under-18s from March 2026 [126][127]. Sanctum-style gacha and USD 250+ bundles [97][98] are the opposite of what a new browser game should open with.
6. **Price cosmetics by scope, not by hype.** A small ladder of tiers (color variant, re-texture, new model, full rework) priced in proportion to production cost, with the middle tier as the default release [96]. Exact prices are a calibration reference only.
7. **An append-only entitlement ledger.** Grants, revokes, refunds and source records are server-side. The collection, the draft skin picker and the try-on sandbox all read from it. A small, replenishing refund allowance like LoL's three tokens [100][101] is player-friendly, and the ledger makes it cheap.
8. **A practice sandbox that also previews cosmetics.** It opens straight from the character page with no queue. Use LoL's command list as the minimum checklist (gold, level and level lock, cooldown, health and mana refresh, dummies on both teams, minions and camps on or off, time skip, reset, teleport) [106][107]. Add Dota-style cosmetic try-on, time control and multiplayer [50][51]. LoL's tool going stale since 2017 is a known complaint [108], so treat the sandbox as a living feature.
9. **Bots as cold-start cover.** Three bot difficulties, plus quiet bot fill in a new player's first casual games while the rating settles [25][27].
10. **Custom lobbies.** Name, password and visibility, region, mode and pick format, series type, slot drag-and-swap, shuffle or balance, bot fill with difficulty, a spectator policy and a configurable spectator delay, and a sandbox-cheats toggle [53][63][64][109][110][111].
11. **Behaviour gates features.** Like Honor 3 for voice [104] and Dota's behaviour-score floor for ranked [48], tie chat, voice and ranked access to a behaviour meter. Start new accounts in the middle so they have something to lose.
12. **Authoritative server with a command protocol, on a fixed step.** Both reference games simulate at about 30 Hz [70][72], so 20-30 Hz is a safe start for Vale. Unlike LoL's measured-delta server [71], use a **fixed step** from day one. Riot's own write-up shows how costly it was to retrofit determinism onto a variable clock [71]. Use client interpolation and optimistic UI. Use one event stream for live play, reconnect catch-up, delayed spectating and replays, built like LoL's spectator feed: full-state keyframes every ~30 s plus delta chunks between them [122].
13. **Versioned replays.** Store `simVersion` with each replay and keep old sim bundles on the CDN, so replays don't die with a patch the way LoL's do [65][123].
14. **Content-addressed delivery.** Hash-named asset chunks behind a manifest let the browser cache handle "patching", which only downloads what changed [9]. Keep separate version tracks for the client shell, the sim/protocol and the content catalog [11][36].
15. **Infrastructure split.** Tickets, match function and director for matchmaking [6]. Fleets with health checks and allocation for servers [7], or a much simpler single-process version of both at launch.

### (b) Protected expression that must NOT be copied

- **Currency and system names:** Blue Essence, RP/Riot Points, Orange or Mythic Essence, Hextech (chests, keys, crafting), Sanctum, Ancient Sparks, Prestige, Mythic/Exalted/Ultimate/Legendary/Epic/Timeworn skin-tier branding, Eternals, Honor (and its categories), Mastery and Marks of Mastery as branded, Practice Tool as a branded name, LP/League Points as a term, banked days as a term, the Ranked 5s and Flex queue brands, Team Voice and "voice skins", Hall of Legends, and the 2026 LP-protection system's name [16].
- **Dota names:** Battle Pass branding, Crownfall, Arcana, Dota Plus, Shards, Plus Assistant, DotaTV, Demo Hero as a branded name, and the medal names (Herald to Immortal).
- **The exact ladder.** LoL's ten tier names and their order (Iron to Challenger) and the emblem art. Dota's medal names, star art and leaderboard presentation. Vale needs its own tier theme, count and iconography.
- **Visual and audio identity.** Client layouts (Activity Center, Info Hub, champ-select layout, loading-card layout), rank borders, level borders, loot-box opening animations, store card layouts, and the match-found sound.
- Exact prices, decay numbers, refund-token counts and pass reward tracks. These are calibration references only.

### (c) Open questions

1. **Ranked at launch?** In 5v5, ratings converge slowly [1]. With a small population, should ranked open only after N casual games or a playtime gate (Dota uses 100 hours [48]), or in time windows only, as Ranked 5s does [17]?
2. **Monetization at launch.** A cosmetic-only store with no paid randomness is now the recommendation (see (a)5). Belgium and Brazil restrict paid loot boxes [125][126]. Still open: do we sell a premium pass at launch, or only direct cosmetics? Have legal confirm the target regions.
3. **Paid analytics or free.** Dota sells post-game breakdowns, pre-match info and an in-match assistant [56][57][117]. For a new competitive game, free analytics may matter more for retention.
4. **Determinism in a browser.** Can the JS simulation be bit-exact across browsers and CPUs for input-log replays (fixed-point maths, no `Math.sin` differences)? If not, replays must store keyframes and deltas instead of inputs [122].
5. **Tick rate and transport.** WebSocket only (head-of-line blocking) or WebTransport where available? What tick rate works on low-end hosts? The reference value is now confirmed at about 30 Hz [70][72].
6. **Hosting model.** One authoritative Node process per match? How many matches per core at our tick rate? Which regions?
7. **Refund and chargeback policy**, and how the entitlement ledger handles revocation of cosmetics that are equipped.
8. **Season length.** Content seasons of about 4 months like LoL 2026 [85], or shorter acts for a smaller content team? Ladder reset yearly [82] or per season?
9. **Still unverified after the gap-fill (12):** current LoL level-up reward table; mission task contents; the full list of Blue Essence sources; Sanctum launch date; Arcana details; "all Dota heroes free" (not searched); LoL client prediction and interpolation; LoL reconnect mechanism; LoL client phase names; whether the honor vote can be skipped; LoL custom-game map choice, team size and password; and the internal build-to-patch mapping. Also single-sourced: the Diamond III placement cap [81] and the Dota 2 tick rate [72].

---

## Sources

Opened directly in the first pass:

1. https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/
2. https://www.microsoft.com/en-us/research/publication/trueskill-2-improved-bayesian-skill-rating-system/
3. https://github.com/philihp/openskill.js
4. https://github.com/vivekjoshy/openskill.py
5. https://github.com/mmai/glicko2js
6. https://github.com/googleforgames/open-match
7. https://github.com/googleforgames/agones
8. https://github.com/ValveSoftware/GameNetworkingSockets
9. https://github.com/moonshadow565/rman
10. https://github.com/CommunityDragon/CDTB
11. https://github.com/Morilli/riot-manifests
12. https://github.com/Pupix/rift-explorer

† Confirmed from search snippets by sibling passes R01, R02, R04 and R05 in this run (not reopened here):

13. https://wiki.leagueoflegends.com/en-us/Ranked_game
14. https://www.dodge.gg/en-US/lol/news/ranked-flex-guide-2026
15. https://www.leagueoflegends.com/en-us/news/dev/dev-ranked-2026/
16. https://www.altchar.com/game-news/league-of-legends-ranked-2026-changes-explained-autofill-updates-aegis-of-valor-dodging-rules-and-faster-queue-times-asZ9b4U04yVM
17. https://blog.loltheory.gg/ranked-5s-lol/
18. https://www.leagueoflegends.com/en-us/news/dev/dev-tackling-queue-dodging/
19. https://wiki.leagueoflegends.com/en-us/Queuing_and_Matchmaking
20. https://support.riotgames.com/en-us/league-of-legends/gameplay/queue-dodging
21. https://wiki.leagueoflegends.com/en-us/LeaverBuster
22. https://wiki.leagueoflegends.com/en-us/Remake
23. https://leagueoflegends.fandom.com/wiki/Surrendering
24. https://wiki.leagueoflegends.com/en-us/Draft
25. https://leagueoflegends.fandom.com/wiki/Co-op_vs._AI
26. https://www.leagueoflegends.com/en-us/news/dev/dev-new-bot-ai-oh-my-coming-14-6/
27. https://riftfeed.gg/lol-news/bots-update
28. https://www.leagueoflegends.com/en-us/news/dev/dev-seasons-in-2025/
29. https://wiki.leagueoflegends.com/en-us/V25.S1.1
30. https://wiki.leagueoflegends.com/en-us/V26.01
31. https://wiki.leagueoflegends.com/en-us/Loading_Screen
32. https://leagueoflegends.fandom.com/wiki/Honor
33. https://blog.loltheory.gg/honor-system-lol/
34. https://wiki.leagueoflegends.com/en-us/Store
35. https://blog.usro.net/2025/06/buying-league-of-legends-stuff/
36. https://www.riotgames.com/en/news/under-hood-league-client%E2%80%99s-hextech-ui
37. https://technology.riotgames.com/node/40
38. https://www.leagueoflegends.com/en-au/news/dev/client-cleanup-2020-recap-what-s-ahead/
39. https://www.dexerto.com/league-of-legends/riot-confirms-plans-for-lol-shakeup-in-2027-with-new-visuals-client-3296182/
40. https://www.gamesradar.com/games/league-of-legends/league-of-legends-is-getting-a-new-client-entirely-new-visuals-and-a-bit-of-new-gameplay-in-a-massive-2027-update-reportedly-codenamed-league-next/
41. https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-12-notes/
42. https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-13-notes/
43. https://www.gamespress.com/LEAGUE-OF-LEGENDS-CLASSIC-RELEASES-IN-PATCH-2615
44. https://www.nerfplz.com/lol-game-modes/
45. https://patched.gg/games/league-of-legends/league-of-legends-patch-269-notes
46. https://esports-news.co.uk/2026/04/15/lol-season-2-2026-changes/
47. https://dota2freaks.com/rank-role-performance/
48. https://liquipedia.net/dota2/Matchmaking
49. https://dota2gamers.gg/what-is-dota-2-ranked-role-queue/
50. https://liquipedia.net/dota2/Version_7.40
51. https://www.dota2.com/reborn/part1?l=english
52. https://jeu.video/en/guide/dota-2-progression-steps-before-matchmaking
53. https://esports.gg/news/dota-2/how-to-create-a-lobby-in-dota-2/
54. https://gosugamers.net/dota2/news/31418-reborn-part-2-custom-games-are-here
55. https://www.esports.net/news/dota/dota-2-patch-7-35d/
56. https://www.gosugamers.net/dota2/news/70900-dota-2-patch-7-35d-arrives-with-new-matchmaking-features-with-a-hint-about-the-crownfall-update
57. https://www.oneesports.gg/dota2/how-to-view-post-game-analytics-in-dota-2/
58. https://www.cgmagonline.com/articles/dota-2-september-updates-bundles/
59. https://www.gosugamers.net/dota2/news/78889-dota-2-drops-patch-7-41e-supporter-bundles-fantasy-and-predictions-ahead-of-the-international-2026
60. https://timesaver.gg/news/dota-2-next-patch-742-silent-update-september-29
61. https://www.surrenderat20.net/2012/04/full-spectator-mode-included-in-next.html
62. https://wiki.leagueoflegends.com/en-us/Spectator
63. https://digistatement.com/dota-2-valve-adds-15-minute-delay-on-dota-tv/
64. https://liquipedia.net/dota2/Spectating
65. https://clip.dor.gg/en/blog/league-of-legends-replay-guide
66. https://mein-mmo.de/en/league-of-legends-replay-system,119869
67. https://esports.gg/news/dota-2/replay-revulsion-editor-unhappy-with-changes-to-dota-2-replay-system/
68. https://wiki.leagueoflegends.com/en-us/Ping
69. https://www.esports.net/wiki/guides/lol-level-borders/

‡ Confirmed from search-result snippets in the gap-fill pass, 2026-10-07 (pages not opened):

70. https://wiki.leagueoflegends.com/en-us/Tick_and_updates (LoL tick 33 ms / 30.30 Hz)
71. https://technology.riotgames.com/node/68 (Riot, Determinism in League of Legends: Implementation; see also /node/73, Unified Clock)
72. https://diamondlobby.com/server-tick-rates/ (secondary; Dota 2 and LoL at 30 Hz)
73. https://technology.riotgames.com/node/112 (Riot, VALORANT's 128-Tick Servers)
74. https://edgegap.com/blog/game-server-tick-rate-explained-gameplay-precision-vs-infrastructure-cost
75. https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4405783687443 (Riot support: Placements, Promotions, Series, Demotions, and Decay)
76. https://support.riotgames.com/league-of-legends/gameplay/master-grandmaster-and-challenger-the-apex-tiers
77. https://www.dodge.gg/en-US/lol/news/how-ranked-system-works-2026
78. https://blog.loltheory.gg/league-of-legends-ranks
79. https://www.nerfplz.com/2026/08/league-of-legends-rank-distribution.html
80. https://www.thespike.gg/league-of-legends/beginner-guides/rank-reset-2026-guide
81. https://tapin.gg/blogs/league-of-legends-placement-games-tips-b2ac1a00-55de-11f1-96dd-b7eebea4cd9d
82. https://gamespace.com/all-articles/news/league-of-legends-runs-three-seasons-a-year-now-and-only-one-of-them-resets-your-rank/
83. https://www.esports.net/news/lol/lol-seasons-start-end-dates/
84. https://u.gg/lol/news/league-players-are-about-to-lose-every-master-rank-in-patch-26-9
85. https://www.esports.net/wiki/guides/lol-patch-schedule/
86. https://www.shacknews.com/article/136822/league-of-legends-ranked-splits-2024
87. https://www.gosugamers.net/lol/news/74286-riot-stands-firm-on-hextech-chest-removal-amid-growing-player-frustration
88. https://www.gosugamers.net/lol/news/74192-league-of-legend-players-urge-boycott-of-game-over-removal-of-free-hextech-chests
89. https://www.gosugamers.net/lol/news/74401-riot-brings-back-hextech-chests-in-lol-and-more-cuts-cost-of-all-champions-in-half
90. https://insider-gaming.com/hextech-chests-will-return-to-league-of-legends-after-mass-player-backlash
91. https://www.esports.net/news/lol/riot-games-to-lower-blue-essence-costs-of-all-lol-champions
92. https://gosugamers.net/lol/news/74152-league-of-legends-players-claims-882-hours-needed-to-unlock-a-champion-under-new-system
93. https://wiki.leagueoflegends.com/en-us/First_Win_of_the_Day
94. https://blog.loltheory.gg/how-to-level-up-league-of-legends/
95. https://blog.loltheory.gg/riot-points-prices/
96. https://ggrecon.com/guides/how-many-skins-are-in-league-of-legends/
97. https://wiki.leagueoflegends.com/en-us/Sanctum
98. https://www.ggrecon.com/articles/fakers-hall-of-fame-bundle-is-here-but-its-extortionate-price-is-putting-lol-players-off
99. https://www.gosugamers.net/lol/news/71535-everything-you-need-to-know-about-the-faker-hall-of-legends-collection-event
100. https://support.riotgames.com/league-of-legends/billing/lol-refund-policy
101. https://www.ggrecon.com/articles/how-to-claim-the-free-league-of-legends-refund
102. https://www.leagueoflegends.com/en-us/news/dev/dev-updating-champion-mastery/
103. https://videogames.si.com/news/league-of-legends-mastery-cap-season-2024
104. https://esports.gg/news/league-of-legends/team-voice-chat/
105. https://rdy.gg/en/lol/news/lol-dev-update-september-2026
106. https://www.surrenderat20.net/2017/01/red-post-collection-practice-tool.html
107. https://www.player.one/league-legends-practice-tool-guide-everything-you-can-do-sandbox-mode-579168
108. https://riftfeed.gg/lol-news/players-still-want-a-practice-tool-update
109. https://wiki.leagueoflegends.com/en-us/Custom_game
110. https://liquipedia.net/dota2/Lobby
111. https://dota2.readthedocs.io/en/latest/dota2.features.lobby.html
112. https://www.exitlag.com/blog/dota-2-ranks/
113. https://www.gamespot.com/articles/dota-2-now-requires-your-phone-number-to-play-rank/1100-6449519/
114. https://esports.gg/news/dota-2/unlock-dota-rank-medal/
115. https://www.esports.net/news/dota/no-dota-battlepass-2023/
116. https://www.gosugamers.net/dota2/news/68520-valve-drops-the-international-battle-pass-concept
117. https://rdy.gg/en/dota2/news/dota-plus-a-guide-to-dota-2-s-weird-and-wonderful-subscription-based-service
118. https://subger.com/en/service/dota-plus (secondary; pricing)
119. http://www.glicko.net/glicko/glicko2.pdf (Glickman, "Example of the Glicko-2 system"; the primary source, not opened, with its parameters quoted via [120][121])
120. https://metricgate.com/docs/glicko-2-rating/
121. https://www.rdocumentation.org/packages/PlayerRatings/versions/1.1-0/topics/glicko2
122. https://github.com/loldevs/leaguespec/wiki/REST-Service (unofficial community spec of the LoL spectator protocol)
123. https://insights.gg/blog/lol-replay-how-to-watch-download-keep-league-replays
124. https://www.surrenderat20.net/2016/10/road-to-pre-season-replays-on-horizon.html
125. https://cms.law/en/int/publication/loot-boxes-a-treasure-trove-of-gambling-regulatory-issues
126. https://wnhub.io/news/legal/item-48938
127. https://www.jurist.org/news/2025/09/brazil-passes-new-law-to-protect-childrens-online-privacy/
128. https://www.gosugamers.net/lol/news/74155-league-of-legends-riot-admits-they-screwed-up-on-rewards-system-changes-promised-next-patch (headline only)
