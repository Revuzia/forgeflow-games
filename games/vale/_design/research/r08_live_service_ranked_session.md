# R08: Live-Service Model, Economy, Ranked, and the Session/Server Model

Prepared for: VALE (Forgeflow Games), an original browser lane-brawler (custom Three.js/WebGL2 client)
Research date: 2026-10-07
Status: reference research. All numbers are calibration ranges, not values to copy.

> **How this was researched (read first).** The shared web-search budget for this run was already used up when this pass started, so **no new web searches ran for this note**. Direct page fetches were blocked by the egress proxy for leagueoflegends.com, technology.riotgames.com, ddragon.leagueoflegends.com, wikipedia.org, liquipedia.net, trueskill.org, glicko.net, protobuf.dev and gabrielgambetta.com. github.com and microsoft.com could be reached, so the rating-math and infrastructure sections rest on primary pages opened in this pass (sources [1]-[12]).
>
> Sources marked **†** in the list were confirmed from search-result snippets by the sibling research passes in this same run (R01 modes/queues, R02 match rules, R04 HUD/spectator, R05 client flow). This pass reuses their findings and did not reopen those pages.
>
> Many LoL economy specifics (currency names, price points, the 2024-2025 reward controversies, decay numbers, tick rates) come from background knowledge and are marked **[unverified]**. A follow-up pass with a fresh search budget should confirm them before any of them shape a design decision.

---

## 0. Key takeaways

1. **The match is the unit of progress.** Each finished match feeds several meters at once: account XP, a seasonal pass track, mission counters, per-character mastery, and (in ranked) a visible ladder score backed by a hidden rating. LoL's 2025 home screen puts pass level, XP progress, the next reward and the mission list on the landing page [28][29].
2. **There are two currencies: one earned and one bought.** Power is never for sale. Earned currency unlocks characters. Premium currency buys cosmetics and passes. In the genre, cosmetics change only looks. **[Principle widely held; exact LoL currency flows unverified.]**
3. **Ranked is two layers.** A hidden rating (MMR) drives matchmaking. A visible ladder (tiers, divisions, points) drives motivation. The visible layer is designed to drift toward the hidden one over time **[mechanism unverified]**. LoL keeps separate ratings per ranked queue: Flex has its own MMR and rewards apart from Solo/Duo [14].
4. **The rating math should model teams and uncertainty.** TrueSkill-style systems track skill as a mean plus an uncertainty. They show a conservative μ − 3σ score and need far more games to converge in big team matches than in 1v1. Microsoft's figures are 12 games for 1v1 versus 91 for 8v8 teams [1]. OpenSkill gives the same model family under the MIT license, with a JavaScript port [3][4].
5. **Queue integrity rests on timed gates with escalating penalties.** LoL uses a 12 s ready check [19]. Dodges are penalized in three tiers (6 min/−3 LP, 30 min/−10 LP, 12 h/−10 LP), and each tier decays every 12 h [18]. In 2026, a dodge at Master+ also counts as a loss [15][16].
6. **Seasons run on a patch clock.** LoL ships patches about every two weeks. Dated 2026 patches (26.9 around 29 April, 26.15 on 29 July, 26.18 on 10 September) fit that cadence [43][44][45]. A 2026 season boundary fell on 26.1 in January and another on 26.9 [30][45][46].
7. **Servers are authoritative, and the client mainly sends commands.** Dota 2 and LoL are both widely reported to simulate at about 30 Hz **[unverified]**. Spectating is deliberately delayed: about 3 min in LoL [61], and adjustable by the organizer in Dota up to a 15-min tournament option [63][64].
8. **Patches go out through content-addressed chunks on a CDN.** Riot's patcher splits files into zstd-compressed chunks inside bundles and lists them in manifests, so an update downloads only the chunks that changed [9]. Riot keeps separate manifests for the platform client and for each game [11]. Old replays stop playing once the game updates [65]. That shows the cost of not versioning simulation data.
9. **The flow is a state machine.** It runs login, home, party, queue, ready check, draft, load, in-game, post-game, then back to the lobby. Every step has a timer and a fallback [19][24][32]. LoL's client exposes these states through a local REST/WebSocket API [12].

---

## 1. Progression and per-match rewards

### 1.1 Account level and match XP

- **Account level gates ranked.** LoL requires account level 30 and at least 20 owned champions before ranked [13]. The gate holds back smurfs and gives new players time to learn **[design reading]**.
- **XP per match** depends on win or loss and on game length. A first-win-of-the-day bonus has long existed in some form. Exact 2026 values **[unverified]**.
- **Level-up rewards** have historically included earned currency and character unlock tokens. Riot cut and restructured these in 2024-2025 **[unverified; see 1.2]**.
- **Visible level signals.** The loading screen shows a level border on each player's card, and a ranked border from Silver upward [31][69]. Level is a status display, not a power stat.
- **Behaviour score as a progression track.** Honor is LoL's behaviour score. In 2025 everyone was reset to level 3, and the yearly reset stopped [32][33]. Honor level raises the per-player ping allowance [68], and reported 2026 plans gate built-in team voice by Honor **[unverified]**. Good conduct is itself a meter that unlocks features.

### 1.2 League of Legends reward surfaces (2025-2026)

| Surface | What it does | Confidence |
|---|---|---|
| Season pass with free and premium tracks | Pass level, XP bar and next reward shown on the home screen. Pass XP comes from matches and missions | Confirmed shape [28][29] |
| Missions | A list of tasks, each with description, progress and reward. Typical tasks are "play N games", "win N games", "get N takedowns as role X" | Shape confirmed [28]. Task contents **[unverified]** |
| Role quests (in-match, 2026) | A per-match progression bar for each role, separate from account progression | See R02 |
| Earned currency ("Blue Essence") | Unlocks champions and some cosmetics. Comes from missions, the pass and level-ups | **[unverified]** |
| Premium currency ("RP") | Bought with money. Buys skins, passes, bundles. The store has a Buy-currency flow: pick payment method, pick a bundle, balance updates | Store flow confirmed [34][35]. Name **[unverified as current]** |
| Loot chests and keys | Random cosmetic rewards. Riot cut them from honor/mastery/free tracks at the 2025 launch, faced heavy backlash, then put some back | **[unverified]** |
| High-end gacha ("Sanctum") | A paid random-draw system for top-tier skins, launched late 2024. One headline skin reportedly cost about USD 250 in expected spend | **[unverified]** |
| Champion mastery | Uncapped per-champion levels with seasonal milestones and marks (2024 revamp). Shown on the loading screen's alternate view | Loading-screen display confirmed [31]. Revamp details **[unverified]** |

**Design reading.** The 2025 cycle shows the risks of a mature live service. Taking earned free rewards away drew more anger than any price change, and Riot partly reversed the cuts **[unverified narrative]**. The confirmed part is structural. Riot rebuilt the home screen around the season and its pass [28]. Each 2026 season boundary also brought gameplay changes [30][45][46], so the theme, the pass and the patch notes all reset on the same day.

### 1.3 Dota 2 reward surfaces

- **The battle pass era is over.** Dota's yearly championship pass was retired after 2022 **[unverified date]**. It was replaced by smaller, act-based seasonal events built around in-match play and earned tokens. Coverage of patch 7.35d (2024) already mentioned the coming "Crownfall" event [56].
- **2025-2026 monetization is spread across smaller pieces.** Patch 7.41e (2026) came with supporter bundles, fantasy and predictions ahead of the 2026 world championship [59]. The September 2026 update swapped the dashboard background to the current event and moved older events to a smaller banner slot [58].
- **A subscription sells information, not power.** Dota Plus puts a per-source damage breakdown in the post-game behind the subscription [57]. A subscriber-only pre-match screen showed expected skill spread, ping and behaviour scores, with the option to requeue [56]. Hero levelling and its earned currency are part of the same subscription **[unverified details]**.
- **Top-tier cosmetics (Arcana)** are the highest tier of single-hero cosmetic. They are earned through events or bought, and change models, effects and sounds, never stats **[unverified]**.
- **Everything is earned or bought through play and events. No currency buys a hero.** All heroes are free in Dota, while LoL sells or grinds champion unlocks **[unverified as stated, but long-standing and widely known]**.

### 1.4 The "cosmetics never change stats" principle

Both games sell only appearance. Hitboxes, timings, sounds that carry gameplay information, and readability stay the same across cosmetics **[practitioner consensus; no formal policy page confirmed in this pass]**. Paid information is the gray zone. Dota sells post-game breakdowns and pre-match analytics through its subscription [56][57]. Vale should decide on purpose whether analytics are free (better for fairness and learning) or paid (revenue that risks "pay to understand").

---

## 2. Store, collection and entitlements

### 2.1 Skin tiers and variants

LoL sells skins in price tiers that roughly track production scope. From about USD 5-7, you get a recolor plus new textures. From about USD 10-13, new models and effects. From about USD 18-25, a new voice, animations and recall. At the top sit limited "mythic" or prestige skins and gacha-only exclusives **[all price points unverified]**. Chromas are cheap color variants of an owned skin **[unverified price]**. The store has featured items, bundles and rotating sales. Clicking a skin card opens details and an animation preview [34][35]. Collection grids filter by ownership and group skins by champion, set or tier [R05; filter details unverified].

### 2.2 Ownership, refunds and mastery

- **Entitlements.** Each owned item is an account-level record: item id, how it was acquired (purchase, reward, gift, loot), timestamp and price paid. The collection and the draft-screen skin picker read from it **[practitioner model; LoL's internal schema not public]**.
- **Refunds (LoL).** There is a small lifetime pool of refund tokens, plus a time window after purchase, for champions and skins **[unverified numbers]**. A refund has to reverse the entitlement *and* every derived record (equipped loadout, bundle discounts) **[practitioner]**.
- **Mastery** is a per-character progression shown in status displays (loading screen, profile) [31]. It is a display-only counter of use.

---

## 3. Ranked

### 3.1 LoL ladder structure

- **Queues and separate ratings.** Solo/Duo takes parties of 1-2. Flex allows 1, 2, 3 or 5 players (no four-stacks) and has a fully separate rank, MMR and rewards [14]. Ranked 5s (2026) needs an exact five-premade, runs in weekend windows, uses tournament draft and keeps its own individual LP ladder [17][44].
- **Placements.** New entrants play provisional games that set their starting tier and division [13]. The count is about 5 in recent seasons **[unverified]**.
- **Tiers and divisions.** There are ten tiers. The lower seven each have four divisions of 100 LP. The top three (Master and above) are uncapped LP pools, and the very top tiers hold a limited number of players per region. Division promotion series were removed in recent seasons **[structure widely known; exact current rules unverified]**.
- **LP versus MMR.** LP gains and losses are skewed toward the hidden MMR. A player whose MMR sits above their visible rank gains more than they lose until the two meet **[unverified mechanism; widely reported]**.
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
- **Decay.** At Diamond and above, inactivity drains a banked-days counter, and then LP decays daily until the player plays again **[unverified numbers]**. Below that tier, decay does not apply **[unverified]**.
- **A match-integrity system (2026 S2)** detects matches ruined by deliberate feeding and ends them [46]. R02 has the details.

### 3.2 Season and split cadence

- **2023-2025.** Riot moved from one yearly reset to several splits a year, each with a soft reset and its own rewards. 2025 tied those splits to themed seasons [28] **[split count per year unverified]**.
- **2026.** Season 1 launched with patch 26.1 in January [30]. Season 2 launched with patch 26.9 around 29 April 2026, with gameplay changes such as role-quest tuning and new starter items [45][46]. A Season 3 boundary would fit the same roughly 4-month rhythm (late August or September) **[unverified]**.
- **Reading.** One season boundary is one patch: the theme, the pass, the ranked soft reset and a large gameplay patch all change on the same day. That lines up the marketing beat, the meta shake-up and the ladder restart.

### 3.3 Dota 2 ranked

- **One MMR with per-role offsets.** Dota keeps a single MMR per player. Hidden per-role offsets have been used by the matchmaker since March 2020 [47].
- **Role queue.** Players queue for numbered positions. Searching with all roles selected earns priority tokens: 4 per search for solo players (cap 60), 2 each in a two-player party, 1 each in a three-player party. Five-stacks always count as role queue [48][49]. Four-player parties cannot queue ranked [48].
- **Medals.** Visible tiers have several stars each. Above them is a top tier with a numbered leaderboard. New accounts play calibration games and must reach a playtime gate before ranked opens **[unverified specifics]**. A behaviour-score floor is also required **[unverified]**.
- **Draft burden reduced.** The in-match ban phase was replaced (7.35d) with ban preferences saved on the account. Players save up to four heroes they want banned, and at least one is guaranteed to be [55].

### 3.4 Rating math: options and why

| System | State per player | Team support | Notes |
|---|---|---|---|
| Elo | One number | Not natively. Team averages are a hack | Simple and transparent, but no uncertainty, so placements need special-case K-factors **[general knowledge]** |
| Glicko-2 | Rating (default 1500), deviation RD (default 350), volatility (default 0.06) | Not designed for multi-competitor matches. Library add-ons break them into pairwise matches [5] | System constant τ is usually 0.3-1.2. Designed for **rating periods** of about 10-15 games per player, not single-match updates [5] |
| TrueSkill | μ and σ | Yes. Team skill is the sum of member skills, and only the final standing is used [1] | Leaderboard shows μ − 3σ, a conservative floor [1]. Convergence takes 12 games for 1v1, 5 for 4-player FFA, 91 for 8v8 teams, and can be up to 3× more [1]. Owned by Microsoft (Xbox Live since 2005) [1]. Licensing is a known concern, and OpenSkill sells itself as the open-license alternative [3] |
| TrueSkill 2 | Adds experience, squad membership, individual kills, tendency to quit, and skill in other modes | Yes | Predicted Halo 5 outcomes with 68% accuracy versus 52% for TrueSkill [2] |
| OpenSkill (Weng-Lin 2011) | μ (default 25), σ (default 8.333) | Yes, including asymmetric team sizes and partial play | MIT license. Plackett-Luce, Bradley-Terry and Thurstone-Mosteller models. Ordinal score is μ − 3σ. Reported up to 20× faster than TrueSkill in JS benchmarks. Ports exist in JS, Python and others [3][4] |

**Why shipped games use the Bayesian family.**
- *Uncertainty doubles as a placement system.* High σ means big moves early, so no separate "provisional" code path is needed [1][3].
- *Convergence in 5v5 is slow.* The 8v8 figure (91 games) suggests a 5v5 game needs dozens of matches per player to settle [1] **[5v5 figure inferred, not measured]**. Signals beyond win/loss (individual performance, party, quitting) speed this up, as TrueSkill 2 shows [2].
- *Season soft resets* can raise σ instead of moving μ, so returning players re-settle quickly without losing their history **[practitioner]**.
- *Decay* can be modelled as σ growing with inactivity, which is how Glicko's RD works by design [5].

---

## 4. Bots, custom lobbies and practice

### 4.1 Bots and co-op queues

- LoL's co-op vs AI queue has three difficulty levels. The easiest bots stay in base for the first few minutes and react slowly [25]. Patch 14.6 improved bot items, movement and combat and widened the bot champion pool [26].
- **Hidden onboarding.** Since January 2025, new and returning players may get some bots in their first normal games while the system calibrates their skill [25][27]. Bots act as cover for a cold start.
- Dota offers bot matches and lets custom lobbies fill empty slots with bots **[unverified in this pass]**.

### 4.2 Custom lobbies

- **Dota.** A lobby browser with filters for game type, connection quality, open slots and friends or LAN [53][54]. The organizer sets the DotaTV spectator delay, including an automatic 15-min option for tournament lobbies [63][64]. Further settings (server region, cheats, series type, password, bot fill) **[unverified]**.
- **LoL.** Custom games offer a map choice, team size 1-5, a pick format (blind, draft or tournament draft, all random), a spectator policy (none, lobby only, friends, everyone), an optional password, and bots added to either team **[feature list from background knowledge, unverified]**.
- **Common feature set.** Lobby name and password, side and slot assignment with drag-to-swap, team balance or shuffle, bot fill with difficulty, spectator slots and policy, pick format, ruleset toggles, and a host who can kick and start **[practitioner synthesis]**.

### 4.3 Practice sandboxes

- **LoL Practice Tool** **[unverified feature list]**: a solo or small-party game on the main map with a control panel. It can add gold, set or max level, reset cooldowns, lock cooldowns at zero, toggle mana or energy costs, spawn and place target dummies, toggle minion waves and jungle camps, fast-forward and pause the game clock, teleport, and reset the game state. Nothing is at stake and no penalties apply.
- **Dota Demo Hero.** Opened right from any hero page with no queue. It gives instant levels and items, target dummies, and toggles for no cooldowns or infinite mana, and previews equipped cosmetics, including unowned ones [51][52]. Patch 7.40 made it multiplayer and added menus to spawn any neutral, control time and change global settings [50].
- **Reading.** Dota's sandbox does three jobs at once: it teaches the game, previews cosmetics before purchase (a store conversion tool), and replaces a separate "try skin" screen.

### 4.4 Matchmaking infrastructure

Open Match is Google's open-source framework. It shows the standard decomposition: **tickets** (one per searching party), a custom **match function** (who goes together), a **director** (assigns matches to servers), and **backfill** for partly filled games [6]. Agones handles the server side. It runs dedicated game-server processes on Kubernetes in fleets, with health checks, autoscaling and an allocation API that a matchmaker calls to claim a ready server [7].

---

## 5. Session and server model

### 5.1 Authority, tick rate, and the command model

- **Dedicated, authoritative servers.** Both reference games run the match on a server they control. Clients send intent (move here, cast at this point or target, buy item), and the server decides outcomes **[standard genre practice; confirmed indirectly by server-side penalty, remake and termination features [21][22][46]]**.
- **Tick rate.** Dota 2 is widely reported to simulate at 30 ticks/s, and LoL's server also at about 30 Hz **[both unverified in this pass; Riot's determinism engineering article could not be fetched]**. 30 Hz is enough for click-to-move games, where commands are intents rather than twitch aim. Twitch shooters typically run 64-128 Hz **[unverified comparison]**.
- **Prediction versus pure authority.** The MOBA pattern leans server-authoritative with instant local feedback: a click marker, a move or cast animation started at once, and cooldown UI updated optimistically. The client then interpolates entity positions between server snapshots, and full rollback-style prediction is uncommon **[unverified for both titles; practitioner description]**.
- **Transport.** Valve's open-source GameNetworkingSockets shows the expected feature set: a connection-oriented but message-based API with reliable and unreliable messages, automatic fragmentation, AES-GCM-256 per-packet encryption, and ICE-based NAT traversal [8]. In a browser, the matching options are WebSocket (reliable only) and WebTransport/WebRTC data channels (unreliable allowed) **[general knowledge]**.

### 5.2 Disconnects and reconnects

- If a player never connects or drops early, a remake vote opens at 3 min [22]. Otherwise the game goes on with the absent player's character idle, and leaver penalties apply if they do not return [21].
- **Reconnect** in LoL is a client button that rejoins the running match. The client loads the current state and catches up **[mechanism unverified]**. LoL's spectator and replay system works from periodic full-state keyframes plus incremental chunks **[unverified; the community spec page reached in this pass was empty]**, so the same idea can serve reconnect.

### 5.3 Spectating and replays

- **Delay.** LoL's standard spectator delay is about 3 min, to stop live ghosting [61][62]. Dota's DotaTV delay is set per lobby, with a 15-min tournament option. Some events ask for 10 min plus 5 more for community streams [63].
- **Replays.** LoL saves `.rofl` files from match history. They are **tied to a patch** and stop opening after the client updates [65]. The timeline is auto-marked with kills and objectives, and clips can be exported as video [65][66]. Dota replays support DVR rewind and a player-perspective camera. Hiding replay speed in a dropdown drew complaints from video editors [67].
- **Design reading.** Patch-locked replays are what you get when replay playback depends on the exact simulation build. A browser game can do better by storing the sim version with each replay and keeping old sim builds on the CDN, so the replay viewer loads the matching build **[practitioner]**.

### 5.4 Patching, versioning and delivery

- **Cadence.** LoL patches every two weeks, with occasional three-week gaps. The 2026 dates support this: 26.9 around 29 April, 26.15 on 29 July, 26.18 on 10 September [43][44][45]. Patch notes are published per numbered patch, for example 26.12 and 26.13 [41][42].
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
| In progress | The match | Surrender windows [23] | Reconnect. Leaver handling [21] |
| Waiting for stats / pre-end | Short honor vote: commend one teammate, about 40 s [32][33] | Timed | Skippable **[unverified]** |
| End of game | Scoreboard, progression bars, rewards | None | "Play again" goes back to the lobby with the party intact |

---

## 7. Implications for Vale

### (a) Public systems worth adopting in original form

1. **Hidden rating with OpenSkill (Plackett-Luce), a visible ladder on top.** It is MIT-licensed with a JS port [3], handles 5v5 and uneven teams, and treats uncertainty as the placement system. Show a derived tier and points value that moves toward the conservative μ − 3σ score [1][3]. Use one rating per ranked queue [14].
2. **Season soft resets by raising σ, and decay by growing σ.** Add visible display decay only at the top tiers, where ladder squatting matters [5].
3. **Timed gates everywhere, with escalating penalties that decay.** A 10-15 s ready check. Repeated failures count as a dodge. Three dodge tiers that step down every N hours. A harsher rule at the top of the ladder [18][19].
4. **Two currencies, cosmetics only.** An earned currency unlocks characters; plan for a small roster, so unlocks are fast or free. A premium currency buys cosmetics, a seasonal pass and bundles. Free rewards that ship should never be quietly removed later (lesson of 2025, **[unverified narrative]**).
5. **An append-only entitlement ledger.** Grants, revokes, refunds and source records are server-side. The collection, the draft skin picker and the try-on sandbox all read from it.
6. **The season is the clock.** Each season boundary is one patch that changes the theme, the pass, the ladder reset and the meta together [30][45].
7. **A practice sandbox that also previews cosmetics.** It opens straight from the character page with no queue and offers level and gold controls, cooldown reset or lock, dummies, a time control, and a try-on for unowned cosmetics [50][51].
8. **Bots as cold-start cover.** Three bot difficulties, plus quiet bot fill in a new player's first casual games while the rating settles [25][27].
9. **Custom lobbies.** Password, slot drag-and-swap, shuffle or balance, bot fill, a spectator policy and a configurable spectator delay [63][64].
10. **Authoritative server with a command protocol.** A fixed-step server simulation (start at 20-30 Hz, **[unverified reference value]**), client interpolation, and optimistic UI. Use one event stream for live play, reconnect catch-up (periodic full snapshots plus deltas), delayed spectating and replays.
11. **Versioned replays.** Store `simVersion` with each replay and keep old sim bundles on the CDN, so replays don't die with a patch the way LoL's do [65].
12. **Content-addressed delivery.** Hash-named asset chunks behind a manifest let the browser cache handle "patching", which only downloads what changed [9]. Keep separate version tracks for the client shell, the sim/protocol and the content catalog [11][36].
13. **Infrastructure split.** Tickets, match function and director for matchmaking [6]. Fleets with health checks and allocation for servers [7], or a much simpler single-process version of both at launch.

### (b) Protected expression that must NOT be copied

- **Currency and system names:** Blue Essence, RP/Riot Points, Orange or Mythic Essence, Hextech (chests, keys, crafting), Sanctum, Ancient Sparks, Prestige, Mythic/Exalted/Ultimate skin-tier branding, Eternals, Honor (and its categories), Mastery as branded, Practice Tool as a branded name, LP/League Points as a term, the Ranked 5s and Flex queue brands, and the 2026 LP-protection system's name [16].
- **Dota names:** Battle Pass branding, Crownfall, Arcana, Dota Plus, Shards, DotaTV, Demo Hero as a branded name, and the medal names.
- **The exact ladder.** LoL's ten tier names and their order (Iron to Challenger) and the emblem art. Dota's medal names, star art and leaderboard presentation. Vale needs its own tier theme, count and iconography.
- **Visual and audio identity.** Client layouts (Activity Center, Info Hub, champ-select layout, loading-card layout), rank borders, level borders, loot-box opening animations, store card layouts, and the match-found sound.
- Exact prices, refund-token counts and pass reward tracks. These are calibration references only.

### (c) Open questions

1. **Ranked at launch?** In 5v5, ratings converge slowly [1]. With a small population, should ranked open only after N casual games, or in time windows only, as Ranked 5s does [17]?
2. **Monetization at launch.** Do we sell a cosmetic-only store with no paid randomness? Gacha and loot boxes carry legal risk in some regions **[unverified; needs legal review]** and drew backlash for Riot **[unverified]**.
3. **Paid analytics or free.** Dota sells post-game breakdowns and pre-match info [56][57]. For a new competitive game, free analytics may matter more for retention.
4. **Determinism in a browser.** Can the JS simulation be bit-exact across browsers and CPUs for input-log replays (fixed-point maths, no `Math.sin` differences)? If not, replays must store snapshots instead of inputs.
5. **Tick rate and transport.** WebSocket only (head-of-line blocking) or WebTransport where available? What tick rate works on low-end hosts?
6. **Hosting model.** One authoritative Node process per match? How many matches per core at our tick rate? Which regions?
7. **Refund and chargeback policy**, and how the entitlement ledger handles revocation of cosmetics that are equipped.
8. **Season length.** About 4 months per season like LoL 2026 [30][45], or shorter acts for a smaller content team?
9. **Follow-up verification.** Re-check every **[unverified]** item above with a fresh search budget, especially LoL decay, LP/MMR coupling, the 2025 reward changes, both tick rates, and the Practice Tool feature list.

---

## Sources

Opened directly in this pass:

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
