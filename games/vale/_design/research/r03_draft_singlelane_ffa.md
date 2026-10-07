# R03: Pick Formats, the Single-Lane Random Mode, and Free-for-All References

Prepared for: VALE (Forgeflow Games), original browser lane-brawler
Research date: 2026-10-07
Status: reference research. All values are calibration ranges, not values to copy.

> **How this was researched (read first).** This pass ran under worse conditions than R01, R02 and R05.
>
> - **No web searches were available.** The shared web-search budget for this run (200 calls per turn, shared by every agent) was already used up when this agent made its first query.
> - **Every direct page fetch was blocked** by the network egress proxy: en.wikipedia.org, liquipedia.net, leagueoflegends.fandom.com, www.leagueoflegends.com and dota2.fandom.com.
> - **The one primary-source repository tried** (a public Dota 2 game-file tracker on GitHub) is not attached to this session. It was not added without the user's say-so.
>
> As a result, **every cited claim below comes from the sibling research notes R01, R02 and R05**, which other agents compiled from search-result snippets earlier in this run. I re-cite their URLs. I did not open those pages myself, so each citation means "a sibling agent saw this in a search result for this URL."
>
> Everything else is general genre knowledge and is marked **[unverified]**. That covers most of Section 3 (free-for-all and placement scoring), the exact Dota 2 Captains Mode sequence, and most ARAM rule details beyond champion selection. **A follow-up pass with a fresh search budget must confirm the [unverified] items before any design number depends on them.**

---

## 0. Key takeaways

1. **Pick protocol is a separate axis from map and ruleset.** Both reference games treat "how characters get chosen" as a pluggable layer: blind, pre-pick, draft with bans, tournament draft, random with a bench, choose-1-of-3, and so on. The same map and rules run under several of these [R01 synthesis; 9][17].
2. **LoL's solo-queue draft runs in fixed stages, each with its own timer:**
   - about 15 s to declare intent;
   - about 30 s of simultaneous bans, with all ten players banning at once;
   - about 5 s to reveal the bans;
   - alternating pick turns of roughly 30–40 s each;
   - a trade and loadout window.

   The 2026 changes cut about 30 s from this flow and stop a player from banning a champion an ally is hovering [1][3][4].
3. **Tournament draft uses phased bans of 3, picks of 3, bans of 2 and picks of 2 per side.** In 2026 it is also a weekend ranked queue for full premades [1][2].
4. **Dota 2 removed the in-match ban phase from ranked All Pick in patch 7.35d.** Players now save up to four heroes on their account as ban preferences, and at least one of them is guaranteed to be banned [11][12]. Captains Mode, with a captain per team and a timed alternating draft, remains the competitive format. Patch 7.40 reordered its ban phases [14][15].
5. **Draft only works with roster depth.** LoL requires ownership of 20 champions for ranked or Normal Draft [6][7]. That number is exactly what guarantees the last picker at least one legal pick after 10 bans and 9 other picks. Section 1.6 turns this into a rule for sizing Vale's roster.
6. **LoL replaced ARAM rerolls with a "cards plus shared bench" scheme in 25.13.** Each player gets two cards, keeps one and sends the other to the team bench. A rare third card has a pity timer. Riot's reason was that rerolls gave anywhere from 5 to 15 choices per game, which felt inconsistent [18][19].
7. **ARAM is now a family of variants.** Since 25.13 there has been a three-map rotation, picked at random with equal odds per lobby [20][21][22]. Since October 2025 there has also been an augment variant (picks at levels 7, 11 and 15), shipped as its own queue beside plain ARAM [23][24].
8. **LoL Arena is a structured free-for-all, not a melee.** Its 8 duos fight paired 2v2 rounds on small maps. Each round is a 45 s shop phase, then combat with a closing ring from 30 s in. A team health pool eliminates duos over time [29].
9. **The genre's main defence against third-party chaos is structural.** Arena and the auto-battlers pair opponents per round [unverified for the auto-battler]. Score-race FFA modes fall back on leader marking, trailing-team bonuses and timed central pickups **[unverified]**. Gold-based bounties [32][33] and objective bounties that only the trailing team gets [34] are the confirmed team-mode versions of the same catch-up idea.

---

## 1. Pick formats

### 1.1 Taxonomy of pick protocols

| Protocol | Who decides | Bans | Info during pick | Same character on both teams? | Typical use | Source |
|---|---|---|---|---|---|---|
| Blind pick | Each player, at the same time | None | None about the enemy | Usually allowed (mirror matches) [unverified] | Old LoL casual queue; removed | [8] |
| Pre-pick (role + character before queuing) | Each player, before matchmaking | None | None | [unverified] | LoL Swiftplay, the default casual front door since 2025 | [9][8] |
| Draft with simultaneous bans | Each player, in turns | 1 per player, hidden from the enemy, at the same time | Allies' intent and bans visible; enemy picks visible as they lock | No [unverified] | LoL Normal Draft and Ranked | [1][7] |
| Tournament draft | Team, in turns | 5 per side in two phases | Full | No | LoL pro play, Ranked 5s | [1][2] |
| Fearless series draft | Team, across a series | Per game, plus a lockout of champions used earlier in the series | Full | No | LoL pro play from 2025 **[unverified]** | none |
| Captains Mode | One captain per team | Several phases | Full | No | Dota 2 competitive | [16] |
| Captains Draft | Captain, from a reduced random pool | Yes | Full | No | Dota 2 | [16] |
| All Pick with ban preferences | Each player | Taken from saved account preferences | [unverified] | No [unverified] | Dota 2 ranked | [11][12] |
| Single Draft | Each player chooses 1 of 3 random heroes | None | [unverified] | No | Dota 2 | [16] |
| Random Draft | Players take turns picking from a shared random pool | None | Full | No | Dota 2 | [13] |
| All Random | Random assignment | None | n/a | No | Dota 2; LoL ARURF edition | [13][28] |
| Random cards + shared bench | Random offer of 2 cards per player; bench shared by the team | None | Team's bench visible | [unverified] | LoL ARAM since 25.13 | [18][19] |
| Ability Draft | Random body; players draft abilities in turns | None | Full | n/a | Dota 2 | [17][27] |

### 1.2 LoL draft (Normal Draft and Ranked Solo/Duo), step by step

1. **Before queuing.** Each player picks a primary and secondary position, or Fill. The matchmaker tries the primary first, then the secondary, and rarely autofills [7]. In 2026, picking a position became **required** for all main-map games [10].
2. **Intent phase, about 15 s.** Players hover the champion they mean to play. Allies see it before anyone locks [1].
3. **Ban phase, about 30 s, simultaneous.** All ten players ban at once. Allies' bans are visible during the phase, and enemy bans stay hidden until a reveal of about 5 s [1]. Since 2026, a player **cannot ban a champion an ally is hovering** [3]. Because bans are hidden, two players on opposite teams can ban the same champion. A lobby can therefore end with fewer than ten unique bans **[unverified]**.
4. **Pick phase.** Teams alternate, and each turn has a timer reported at roughly 30–40 s depending on version and source [4][5]. The usual order is a "snake" of 1-2-2-2-2-1: blue picks 1, red picks 2, blue picks 2, and so on, with red picking last **[unverified]**. Each champion can be picked only once per match **[unverified]**.
5. **Trades.**
   - *Pick-order swap:* before either player has locked, a Swap request next to an ally's portrait lasts about 10 s [4].
   - *Champion trade:* after everyone has locked, a trade request lasts about 30 s [4].
   - *Role swap:* since 25.08, a one-click request [25].
6. **Automation.** Since 25.08, junglers automatically get the jungle summoner spell and supports get the support item. This removes mistakes made under time pressure [25].
7. **Finalization.** Players choose skins and loadouts on the same screen [4]. The finalization timer is about 30 s **[unverified]**.
8. **Failure handling.**
   - Failing to lock in counts as a dodge [26].
   - Ranked dodges escalate through three tiers: 6 min and −3 LP, then 30 min and −10 LP, then 12 h and −10 LP. Each tier decays after 12 h [26].
   - At Master tier and above in 2026, a dodge also counts as a loss [3].
   - A player who is reported and confirmed as griefing in champ select ends the lobby (26.1) [10].
9. **Total time.** Adding up the stages gives roughly 4–5 minutes from match accept to load (15 + 30 + 5 + 6 pick turns × about 30 + finalization). That is a Forgeflow estimate, not a measured value. Riot treats "champ select lock-in time" as a client KPI and trimmed about 30 s from it in 2026 [3][R05].

**Design reading.** Most of the system's weight goes into *coordination*: visible intent, protection for hovered picks, short timed swap requests, and auto-assigned loadout pieces. The adversarial part (bans and counter-picks) is small by comparison. The 2025–2026 changes removed points of friction rather than adding depth.

### 1.3 Tournament draft and fearless

- **Phases:** 3 bans, 3 picks, 2 bans, 2 picks per side [1][2].
- **Usual exact order** **[unverified]:**
  - bans: B-R-B-R-B-R;
  - picks: B, then R-R, then B-B, then R;
  - bans: R-B-R-B (red bans first in the second phase);
  - picks: R, then B-B, then R.

  The second ban phase lets each team respond to the picks it has already seen. Last pick falls to red, which balances blue's first pick.
- **Ranked 5s (2026)** uses this draft for full five-player premades in weekend windows. Its second run (26.18) shows some opponent information, as the existing tournament mode does [2].
- **Fearless draft (pro play, 2025–2026)** **[unverified, none of these points could be confirmed this run]:**
  - From 2025, Riot-sanctioned leagues and international events used "hard fearless" in series.
  - A champion picked in an earlier game of the series cannot be picked again in later games by *either* team. Bans reset each game.
  - Reported variants differ on whether the decisive last game of a best-of-five resets the pool, and on whether the rule bars both teams or only the team that used the champion.
  - A full best-of-five can lock out up to 50 champions through picks alone. Fearless therefore assumes a very large roster.
- **Side vs pick priority.** Pro formats separate *which side you play on* from *who picks first*. One common pattern: the higher seed or the coin-toss winner chooses one, and the other team gets the other **[unverified for LoL 2026; standard in Dota tournament rules, also unverified]**.

### 1.4 Dota 2 formats

- **Captains Mode.**
  - One captain per team runs a structured pick-and-ban draft [16]. Patch 7.40 reordered the first and third ban phases [14]. Brand-new heroes are kept out of Captains Mode for a while; 7.40c added the then-newest hero [15].
  - Exact counts and timers **[unverified]**: 7 bans and 5 picks per team, 24 selections in all, in three ban phases interleaved with pick phases.
  - Each selection has a short per-turn clock of about 30 s. When it expires, the team draws on a per-team **reserve time bank** of about 2 min. When the bank is empty, the system makes a random pick or skips the ban.
  - **The reserve bank is the interesting system here.** A per-turn clock plus a shared overflow pool lets a captain spend extra time on one hard decision without slowing every turn.
- **Captains Draft.** Captains draft from a reduced random hero pool [16]. This is a way to run a captain draft when the full pool is too large or too familiar.
- **All Pick (ranked), 2026.**
  - The in-match ban phase was removed in 7.35d. Players save up to four heroes on their account, and at least one of them is guaranteed to be banned [11][12].
  - An older description from Liquipedia has a nomination vote where each nomination has a 50% chance to succeed, auto-bans weighted by ban rate, about 75 s of hero selection and about 75 s of pre-creep time [13]. **That description is superseded or [conflicting].**
  - Picks happen in hidden rounds, one player per side per round [13] **[unverified as current]**.
  - After picks, a **strategy time** of roughly 30 s lets teammates swap heroes, buy starting items and choose cosmetics before the match loads **[unverified]**.
  - Choosing to random instead of picking gives a small bonus **[unverified]**.
- **Single Draft:** each player chooses 1 of 3 random heroes [16]. Whether the three are split by attribute is **[unverified]**.
- **Random Draft:** players take turns picking from a shared random pool, about 20 heroes in one snippet [13] **[pool size unverified]**.
- **All Random:** a random hero plus some bonus starting gold [13].

### 1.5 Why blind pick fails, and what replaced it

Blind pick failure modes **[unverified as cited facts; general genre knowledge]**:

- **Role collisions.** Several players pick the same role, and the first chat message to "call" a role becomes the real draft. That rewards fast typists and starts fights.
- **Mirror matches and counterpicks happen by accident.** Nobody can respond to the enemy, so lane outcomes are partly a coin flip.
- **Incoherent compositions.** Nothing guarantees a front line, a support or a damage mix.
- **First-time and troll picks have no social brake**, because teammates see nothing until load.

LoL replaced Blind Pick first with Quickplay and then with **Swiftplay**. Players pick a role *and* a champion before queuing, and the matchmaker guarantees role uniqueness. A full five-player party must take five unique roles [8][9]. That keeps blind pick's speed (no champ-select screen) while fixing role collisions. Counterpicking stays random by design.

### 1.6 Minimum roster size for a draft with bans

**Confirmed gates.** LoL Ranked requires owning **20 champions**. Normal Draft requires access to 20 champions, free rotation included [6][7].

**Why 20.** In a 5v5 draft with 10 bans and no duplicate champions:

- the last picker faces up to 10 banned champions and 9 already picked;
- that is 19 removed, so an owned pool of 20 guarantees at least one legal pick.

The gate is a worst-case guarantee, not a comfort level.

**Generalized for Vale** (Forgeflow derivation, not a sourced fact):

- *Selections consumed per match:* **C = 2T + B**, where T is team size and B is total bans.
- *Worst-case ownership gate:* **O_min = C**. That guarantees one legal pick for the last picker.
- *Comfort target for the global roster:* **R ≥ 2C to 3C**. At that size the last picker still has a real choice after a typical ban spread, and ban targets feel like strategy rather than "ban the one good character".

| Format | T | B | C | O_min | Comfortable R |
|---|---|---|---|---|---|
| 3v3, 1 ban per side | 3 | 2 | 8 | 8 | 16–24 |
| 3v3, 2 bans per side | 3 | 4 | 10 | 10 | 20–30 |
| 4v4, 2 bans per side | 4 | 4 | 12 | 12 | 24–36 |
| 5v5, 3 bans per side | 5 | 6 | 16 | 16 | 32–48 |
| 5v5, 5 bans per side (LoL-style) | 5 | 10 | 20 | 20 | 40–60 |
| 5v5 Captains Mode-style (7 bans per side) | 5 | 14 | 24 | n/a | 48–72 |
| Fearless best-of-5, 5v5 | 5 | 10 per game | up to 50 picks + 10 bans | n/a | 60+ |

**Historical calibration** **[unverified]:**

- LoL launched in 2009 with roughly 40 champions and ran draft with fewer bans (3 per side) for years.
- Heroes of the Storm launched in 2015 with a few dozen heroes and 1 ban per team in its draft ladder, later raised.
- Dota 2 inherited 100+ heroes from its predecessor.

The pattern: launch ban counts are small and rise as the roster grows. **Ban count should be a function of roster size, set in data.**

---

## 2. The single-lane random brawl

### 2.1 LoL ARAM rules (2026)

| Aspect | Rule | Source |
|---|---|---|
| Format | 5v5 on a single lane, random champions, permanent queue | [21][R01] |
| Map | Since 25.13 (25 June 2025), each lobby gets one of three single-lane maps with equal probability. Variants add base launchers that fire players toward a chosen point, and healing plants | [20][21][22] |
| Champion assignment | Cards replaced rerolls in 25.13. Each player gets **two cards, keeps one, and sends the other to the shared bench**. Sometimes a third card appears: base chance 5%, plus 0.15% per champion owned, with a pity timer | [18][19] |
| Why cards replaced rerolls | Rerolls gave 5–15 choices per game (about 10 on average) and felt inconsistent. Cards give a guaranteed floor | [18] |
| Old reroll economy | Reroll points were earned per game, with about 2 rerolls bankable **[unverified]** | none |
| Shared bench | The card each player sends away lands on a bench the whole team can see [18][19]. **[Unverified]:** any player can take a bench champion and put theirs back, teammates can also trade directly, and a short per-player swap cooldown stops rapid flipping | [18][19] |
| Champion pool | Owned champions plus the free rotation **[unverified for 2026]** | none |
| Starting state | Level 3 with 1,400 gold **[unverified]**. Swiftplay uses the same values [9a], so the pair is plausibly shared | none |
| Recall, shopping and fountain | No recall. Players can shop only in base, effectively only after death. The base platform does not restore health or mana to living champions once they have left, so attrition carries over between fights **[unverified]** | none |
| Health pickups | Healing relics spawn at fixed points along the lane and respawn on a timer of tens of seconds. They restore health and some mana **[unverified]**. The newer maps add healing plants [20] | [20] |
| Mode-only summoner spells | A long-range skillshot that marks an enemy and can be recast to dash to them, plus a mana-restore spell **[unverified]** | none |
| Per-champion mode balance | Each champion has hidden mode multipliers (damage dealt and taken, healing, shielding and others), tuned each patch **[unverified]** | none |
| Structures | Per side: 2 lane turrets, then an inhibitor turret and inhibitor, then 2 base turrets and the base core **[unverified]** | none |
| Match length | About 15–20 min | [30] |
| Dodge lockouts | 15 min, then 30 min, then 12 h | [26] |

**ARAM: Mayhem (augment overlay).**

- Went live in patch 25.21 (22 October 2025) as a *separate queue alongside regular ARAM* [23][24].
- Every player chooses an augment at levels 7, 11 and 15. Some augments affect teammates as well [23].
- About 201 augments existed by 26.19, and five more were added in 26.21 [27a][31].
- Riot has signalled updates into 2027 [24a], and a live-mode tracker listed it as live in early October 2026 [35].
- Rarity tiers, rerolls and quest-style augments in Mayhem are **[unverified]**.

**ARURF (January 2026)** used the all-random variant of assignment for an ultra-fast ruleset [28].

### 2.2 Why the format works (design analysis)

This is synthesis, not a sourced claim.

- **Every second is a fight.** With one lane there is no rotation, no jungle and no split-push decision. The only questions are when to engage and when to give ground.
- **Randomness removes draft stress.** The bench then gives some control back. The card scheme sets a floor (always at least 2 choices, plus the whole bench) and keeps a ceiling (a rare third card) [18].
- **No recall and no base healing turn health into a currency spent across fights.** That makes sustain kits, healing pickups and well-timed deaths into real decisions. Dying becomes the only way to shop, so death is partly a tempo tool.
- **Healing pickups and launch pads create small objectives** in a mode with no neutral objectives [20].
- **Mode-specific balance multipliers** let a random-assignment mode stay fair without changing the base kits. Tuning lives in a per-mode table **[mechanism unverified]**.
- **The augment overlay ships as a sibling queue.** The calm base mode stays intact for players who prefer it [23].

### 2.3 Comparisons

- **Dota 2 All Random:** random hero plus bonus starting gold [13]. The gold makes up for not choosing.
- **Dota 2 Ability Draft:**
  - Each player gets a random hero body with no abilities.
  - Players draft 3 regular abilities and 1 ultimate in turns, from a pool built from the 10 players' heroes plus 2 extra random heroes [17].
  - Since 7.41, each hero keeps its innate ability [27].
  - This is the deepest "random plus draft" hybrid in the genre. The draft is over *parts* rather than whole characters.
- **Dota 2 All Random Deathmatch (custom or rotating)** **[unverified]:** each death gives you a new random hero and you keep your gold. Each team has a finite hero pool, which works as a shared stock of lives.
- **Heroes of the Storm single-lane random** **[unverified]:** each player chooses from a small random set of heroes that is built to keep a team composition viable (for example, it guarantees a healer option). The "constrained random" idea is worth noting.
- **SMITE Assault** **[unverified]:** a single-lane all-random 5v5 with no recall. Healing and shopping are restricted to base or death. It is the closest structural analogue to ARAM.

---

## 3. Free-for-all and placement in the genre

*(Almost entirely [unverified] this run. See the note at the top. The only sourced items are Arena's round loop, Brawl's score pool, and LoL's bounty math.)*

### 3.1 Reference set

| Reference | Players / teams | Structure | Win or placement | Main anti-chaos lever |
|---|---|---|---|---|
| LoL Arena | 8 duos (16 players) [29] | Rounds of paired 2v2 fights on small maps. 45 s shop and augment phase, then combat. The ring closes from 30 s into combat [29] | Team health pool drops on each round loss; zero means elimination. Final placement 1–8 by elimination order [29] (placement order [unverified]) | **Structural:** only two teams fight at once |
| Dota 2 Overthrow (Valve-made custom game) | Map variants from solo FFA up to teams of five **[unverified]** | Small arena, no towers. Coins and item drops in the center **[unverified]** | First team to a kill target, or the leader when the timer runs out **[unverified]** | Leader marked; bonuses for trailing teams; timed central pickups **[unverified]** |
| LoL Brawl (team mode, used here for its score pool) | 5v5 | Small map, no towers | Each team has a 250-point pool. A champion kill costs the victim's team 5, a minion kill costs 1, and each minion that reaches the enemy portal costs 1. Minion-kill damage pauses when a team is critically low [36] | Score pool with a floor-protection rule |
| SMITE Arena | 5v5 | Colosseum map with minion waves | A ticket pool drained by deaths and by minions entering your portal **[unverified]** | Same pattern as Brawl |
| Heroes of the Storm brawls | Varies | Weekly rotating special maps and rule sets, rewards for playing a few games **[unverified]** | Varies | Rotation keeps novelty without splitting the core queue |
| Battlerite (arena) | 2v2 / 3v3 | Best-of-rounds arena fights. A contested pickup spawns mid-arena during a round, and late in a round the arena shrinks or sudden death begins **[unverified]** | First to a set number of round wins **[unverified]** | Timed central pickup; forced closure |
| Battlerite Royale | About 20–30 players, solo or duo | Battle royale with a ring, loot chests and mounts **[unverified]** | Last standing | Ring |
| Auto-battlers (TFT etc.) | 8 players, or 4 duos | 1v1 rounds against a rotating opponent, sometimes a "ghost" copy **[unverified]** | Elimination order sets places 1–8; top 4 counts as a "win" for ranked **[unverified]** | Structural pairing; shared unit pool |
| Battle royales (Apex, Fortnite, PUBG) | 50–100 players | Shrinking safe zone in rounds | Placement curve plus kill points | Ring, knockdown and revive, respawn systems |

### 3.2 Dota 2 Overthrow (pattern summary, [unverified])

Valve built Overthrow as a showcase custom game when its arcade launched, and has refreshed it since. The rule pattern, as generally described:

- Several small teams share one compact map. The map variant is chosen by team size.
- Win by reaching a kill target that scales with the variant, or by leading when a match timer of roughly 10–15 minutes expires.
- **Gold coins are thrown out from a central point** on a timer. Players fight in the middle to collect them.
- **A flying carrier drops item chests** at spots announced in advance. Item quality rises with match time. Reportedly, **trailing teams get better rolls**.
- **The leading team is revealed or marked**, and killing its members pays extra. Trailing teams get bonus gold and XP from kills.
- Respawns are short, so deaths cost tempo rather than knocking you out.

**Pattern:** a *score race* that uses a timer as a hard cap, a *central pickup* to draw fights into known places, and *catch-up economics* aimed at the leader.

### 3.3 LoL Arena: how placement maps to outcome

- **Sourced** [29]:
  - 8 duos in a random round-robin bracket.
  - A start level of 3.
  - A 45 s shop phase between rounds, with items and permanent augment picks.
  - Combat on one of six small maps, with the ring closing from 30 s into combat.
  - A vote phase before some rounds.
  - Each duo has a team health pool that drops on every round loss. A duo is eliminated at zero.
- **Unverified:**
  - Health lost per defeat grows with the round number, which forces the match to end.
  - Augments come in rarity tiers.
  - Final placement equals reverse elimination order.
  - The mode has its own rating, which rises for high placements and falls for low ones, and the top half of the lobby counts as a "win" for missions.
  - A long-term goal rewards first places across many different characters.
- **Status:** Riot says Arena is not permanent and runs as a recurring featured mode. It was live as of early October 2026 [29][35].

### 3.4 Placement scoring patterns ([unverified] throughout)

| System | Placement curve (shape) | Kills | Notes |
|---|---|---|---|
| Pro BR scoring (Apex-style, 20 teams) | About 12 / 9 / 7 / 5 / 4 / 3 / 3 / 2 / 2 / 2, then 1 for 11th–15th and 0 below | 1 point per kill, uncapped in pro play | Steep at the top, flat tail. Survival dominates |
| Pro BR scoring (PUBG-style, 16 teams) | About 10 / 6 / 5 / 4 / 3 / 2 / 1 / 1, then 0 | 1 point per kill | Same steep-top shape |
| BR ranked ladders (Apex-style) | Entry cost scales with tier; placement gives back points | Kill points scale with placement and are capped | The cap and placement scaling stop "hot drop for kills" play |
| Auto-battler ranked | 8 places. 1st gains the most; gains fall off to about 4th; losses grow toward 8th | n/a | "Top 4 = win" splits the lobby into a winning half and a losing half |

**Ranking eliminated players.** The convention is reverse elimination order. When players or teams are eliminated at the same moment, ties are broken by a secondary stat: health or score before the final hit, damage dealt, or the earlier-remaining resource. In squad BRs, an individual who dies early still takes the *team's* final placement.

**Structure families:**

1. **Last standing:** battle royales, Arena. Strong drama at the end; long wait for players knocked out early.
2. **Score race with a timer:** Overthrow, kill-target arena shooters. Nobody is knocked out early, and players respawn. The risk is a runaway leader.
3. **Hybrid lives pool:** Arena's team health, Brawl's 250 pool [36], respawn while lives remain. Placement is "who ran out last", but nobody sits out a whole round.
4. **Respawn windows:** a BR that allows respawns early and switches them off late, or allows them while a teammate is alive **[unverified]**. Early mistakes become forgivable while the end stays decisive.

**Safe-zone timing.** BR matches typically run about 20–30 minutes. They use 5–8 safe-zone stages, with wait and shrink durations that shorten as the match goes on **[unverified]**. Arena squeezes this into a single per-round ring that starts closing 30 s into combat [29]. That ring is a tempo tool, not a match-length tool.

### 3.5 Keeping FFA from becoming third-party chaos

Ordered from strongest to weakest structural effect:

1. **Pair opponents per round.** Arena runs paired 2v2 fights [29], and auto-battlers do the same with 1v1 rounds **[unverified]**. A third party is impossible by construction. FFA becomes a *bracket of duels plus a shared standings table*.
2. **Score pools and lives instead of instant elimination.** If you are third-partied, you lose a slice of your pool, not the match [29][36].
3. **Leader marking with a bounty.** Show where the leader is and pay extra for killing them, as Overthrow does **[unverified]**. LoL's confirmed team-mode version is a bounty built up from gold earned, shown from 150 gold, with any excess above 700 carried over to the next life [32][33]. The idea transfers to FFA as "the leader is worth more".
4. **Catch-up economics with a time gate.** LoL activates objective bounties only from 14:00 and only for the trailing team. The bounty fades within about 15 s once the gap closes [34]. Overthrow's better chests for trailing teams are the FFA analogue **[unverified]**.
5. **Kill-credit sharing.** LoL splits a 150-gold assist pool evenly among assisters [37]. In FFA, a damage-recency window gives credit to everyone who hit the victim recently. That reduces the "steal the last hit" reward of a third-party.
6. **Timed central pickups.** Overthrow's coins and chests **[unverified]**, Battlerite's mid-round orb **[unverified]**, and ARAM's healing pickups (on the newer maps, plants [20]). Announced spawn times pull fights to known places at known moments, so encounters are scheduled rather than ambushes.
7. **Shared shop and shared pool.** In Arena, everyone shops from the same catalogue between rounds [29]. Auto-battlers add **contention**: a limited shared supply of each unit, so hoarding hurts other players **[unverified]**.
8. **A placement curve that pays survival over kills.** Steep-top placement points with capped kill points make reckless third-partying a poor expected-value play **[unverified]**.

---

## 4. Implications for Vale

### (a) Public systems worth adopting in original form

1. **Make pick protocol a data enum on the queue.** Values: `prePick`, `draft{bansPerSide, banMode: simultaneous|phased, pickOrder, turnSeconds, reserveSeconds}`, `randomCards{cards, thirdCardChance, pity, bench}`, `chooseOneOfN{n, compositionConstraint}`. Add `series{fearless: none|team|global}` for events. Mode and map stay independent, which is the Dota "protocol × ruleset" model [R01].
2. **Casual front door: pre-pick.** Choose role and character before queuing, with guaranteed role uniqueness [8][9]. It gives the shortest time from queue to match, which suits a browser game.
3. **Ranked draft sized to the roster.** Use simultaneous hidden bans followed by snake picks. Set bans per side from the roster formula in 1.6, and gate ownership at `O_min = 2T + B`. With a launch roster of about 16 and 3v3 teams, use 1 ban per side and raise it as the roster grows.
4. **Draft coordination features, which do the most good for the effort:**
   - intent hovers visible to allies [1];
   - no banning a hovered ally pick [3];
   - pick-order swaps (about 10 s) and post-lock trades (about 30 s) [4];
   - one-click role swap and auto-assigned obvious loadout pieces [25].
5. **Ban preferences as a fast-path option.** Saved account bans with "at least one of yours is honored" [11][12] give ban agency with no time added to champ select.
6. **Per-turn clock plus reserve bank** (the Captains Mode pattern) for premade and tournament drafts **[mechanism unverified, pattern sound]**.
7. **Separate side choice from pick priority** in event formats, and offer fearless as a *series option* only once the roster can support it.
8. **Single-lane random mode, built from original parts:**
   - 2 cards per player, keep 1, the other to a shared bench, a rare third card with a pity timer [18];
   - a short bench-swap cooldown;
   - a higher starting level and more starting gold;
   - no recall, and shopping only in base or on death;
   - health pickups on timers;
   - per-hero mode multipliers held in a data table;
   - a hard target of about 12–18 min for browser sessions.

   Ship any augment layer as a **sibling queue** [23].
9. **Constrained random:** guarantee that each random offer can form a viable team composition (at least one frontline-capable and one sustain-capable option across the team's cards plus bench) **[pattern unverified, low cost]**.
10. **If Vale ships an FFA, use the paired-rounds model first.**
    - Duos or solos are paired per round on small arenas.
    - Each round runs a shop phase, then combat, then a ring.
    - A team health pool scales damage per round.
    - Placement is reverse elimination order, with a tiebreak of health before the final round, then damage dealt.

    This avoids third-party chaos by construction [29]. A score-race variant in the Overthrow style is the second option. It needs leader marking, bonuses for the trailing team, timed central pickups and a timer cap.
11. **Placement-to-reward curve:** steep at the top and flat in the tail, with a "top half = win" line for missions and quests, and kill or score bonuses capped. Ladder points should never punish a high finish.

### (b) Protected expression that must NOT be copied

- **Mode and format names:** ARAM, ARAM: Mayhem, ARURF, Arena, Brawl, Swiftplay, Captains Mode, Captains Draft, Ability Draft, Overthrow, Assault, Joust, Battlerite. Also brand names of ladders and modes from TFT, Apex and Fortnite (for example their victory titles). Generic words such as "draft", "ban", "all random", "bench" and "free-for-all" are fine.
- **Map identities:** the snowy single-lane map and the other rotation maps, including geometry, launch-pad placement, plant placement and the bridge theme. Overthrow's arenas and Arena's six small maps.
- **The mark-and-dash and mana-restore summoner spells**, with their names, icons and exact tuning. Vale can have a gap-closer of its own design.
- **Augment names and text** from both augment modes. All augment concepts must be original.
- **Presentation:** the champion-select layout (portrait columns, ban strip, timer bar), the card visuals and pity UI, the bench layout, the ring's fire treatment, Overthrow's coin-throwing centerpiece and carrier, announcer lines, sounds and music.
- **Character identities, names and kits** from any reference title.

### (c) Open questions

1. **Team size and roster at launch.** With about 16 characters, 3v3 with 1 ban per side fits the formula, and 5v5 with any bans does not. Is draft even a launch feature, or do we launch pre-pick plus random-cards only?
2. **Ban model.** Should Vale use simultaneous hidden bans (fast, but allows duplicates), saved ban preferences (fastest), or phased bans (premade only)?
3. **Mirrors.** Should the same character be allowed on both teams in casual pre-pick? LoL's Swiftplay behaviour here is **[unverified]**.
4. **Single-lane economy.** Do we use no-recall attrition, or allow a slow recall to suit browser players who tab away? What starting level and gold fit a match of about 15 minutes?
5. **Is FFA a launch mode or a rotating featured mode?** Both references run their FFA-like modes as recurring events, not permanent queues [29].
6. **FFA lobby size versus browser concurrency.** Eight duos means 16 concurrent players per lobby. Is 4 teams × 2 (8 players) enough for v1?
7. **Rating.** Should FFA placement feed a separate rating, as Arena's own rating does **[unverified]**, or award quest and pass progress only?
8. **To confirm in a follow-up pass with search budget:**
   - the LoL snake pick order and finalization timer;
   - the current fearless rules (both teams or one; game-5 reset);
   - the Captains Mode sequence after 7.40, and its reserve time;
   - ARAM's 2026 start level, gold, structure count, relic timer and mode multipliers;
   - Arena's placement-to-rating mapping and augment cadence;
   - Overthrow's current kill targets, timer and catch-up rules;
   - Battlerite and SMITE mode rules;
   - BR scoring tables and ring timings.

---

## Sources

All URLs below were seen in search-result snippets by sibling research agents in this run (R01, R02, R05) and re-cited here. This agent could not open them (see the note at the top). "R01", "R05" and similar labels in the text refer to those sibling notes' own synthesis.

1. https://wiki.leagueoflegends.com/en-us/Draft
2. https://blog.loltheory.gg/ranked-5s-lol/
3. https://www.leagueoflegends.com/en-us/news/dev/dev-ranked-2026/
4. https://wiki.leagueoflegends.com/en-us/Draft_Pick
5. https://mein-mmo.de/en/lol-pick-rank,133513/
6. https://wiki.leagueoflegends.com/en-us/Ranked_game
7. https://www.dodge.gg/en-US/lol/news/normal-draft-guide-2026
8. https://wiki.leagueoflegends.com/en-us/Quickplay
9. https://www.dodge.gg/lol/news/quick-play-guide-2026
9a. https://blog.loltheory.gg/what-is-swiftplay/
10. https://wiki.leagueoflegends.com/en-us/V26.01
11. https://www.esports.net/news/dota/dota-2-patch-7-35d/
12. https://esports.gg/news/dota-2/how-the-new-bans-work-in-dota-2-ranked-matchmaking
13. https://liquipedia.net/dota2/Ranked_Matchmaking
14. https://liquipedia.net/dota2/Version_7.40
15. https://www.gosugamers.net/dota2/news/77881-dota-2-patch-7-40c-adds-largo-to-captain-s-mode-nerfs-clinkz-and-broodmother
16. https://guildorder.com/games/dota2/wiki/game-modes
17. https://liquipedia.net/dota2/Ability_Draft
18. https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-13-notes/
19. https://esports.gg/news/league-of-legends/aram-rework-champion-cards-map-rotation-featuring-butchers-bridge/
20. https://www.oneesports.gg/league-of-legends/new-aram-map-rotation/
21. https://wiki.leagueoflegends.com/en-us/ARAM
22. https://www.leagueoflegends.com/en-us/news/dev/dev-all-random-all-mid-blind-bridge/
23. https://esports.gg/news/league-of-legends/aram-mayhem-announcement/
24. https://www.leagueoflegends.com/en-gb/news/dev/tldw-aram-mayhem-smurfing--more-dev-update/
24a. https://www.gamegrin.com/news/is-aram-mayhem-a-permanent-game-mode-in-league-of-legends/
25. https://www.altchar.com/game-news/league-of-legends-adds-role-swapping-to-champion-select-in-patch-25.08-a55pL0D58lKN
26. https://www.leagueoflegends.com/en-us/news/dev/dev-tackling-queue-dodging/
27. https://www.dota2.com/newsentry/512986184073347348
27a. https://arammayhem.com/
28. https://esports-news.co.uk/2026/01/09/riot-games-confirms-arurf-return-to-lol/
29. https://blog.loltheory.gg/what-is-arena/
30. https://blog.loltheory.gg/league-of-legends-average-game-time/
31. https://www.altchar.com/game-news/league-of-legends-patch-26.21-adds-five-new-aram-mayhem-augments-atrno7Q1Y4E4
32. https://wiki.leagueoflegends.com/en-us/Champion_gold_bounties
33. https://lol.fandom.com/wiki/Patch_14.21
34. https://wiki.leagueoflegends.com/en-us/Objective_bounties
35. https://www.nerfplz.com/lol-game-modes/
36. https://wecoach.gg/blog/article/league-of-legends-brawl-mode-a-simple-guide
37. https://wiki.leagueoflegends.com/en-us/Assist
