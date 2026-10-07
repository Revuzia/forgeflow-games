# R03: Pick Formats, the Single-Lane Random Mode, and Free-for-All References

Gap-fill pass 2026-10-07: 40 searches, 52 claims verified, 10 corrected, 30 still unverified (2 more marked [conflicting]).

Prepared for: VALE (Forgeflow Games), original browser lane-brawler
Research date: 2026-10-07 (first pass and gap-fill pass)
Status: reference research. All values are calibration ranges, not values to copy.

> **How this was researched (read first).**
>
> **First pass (no search).** The shared web-search budget was used up before this note's first query, and every direct page fetch was blocked by the egress proxy. All first-pass citations [1]–[37] were re-cited from sibling notes R01, R02 and R05, whose agents saw those URLs in search-result snippets. Everything else was general genre knowledge marked **[unverified]**.
>
> **Gap-fill pass (40 web searches, standard mode).** This pass checked the first pass's claims against search-result snippets, with priority on what drives Vale design numbers: LoL draft order and timers, ARAM rules, Overthrow, FFA placement scoring, and Dota All Pick/Turbo. One page fetch was tried (wiki.leagueoflegends.com) and was blocked, so **no page was opened in either pass**. A citation in [38]–[78], or a "confirmed this pass" note on an older citation, means "the claim appeared in a search-result snippet for that URL in this pass." Where two snippets disagreed, the text says **[conflicting]**.
>
> **Labels used below.** *Confirmed* = seen in a snippet this pass. **[unverified]** = still not seen in any snippet. **Corrected** = the first pass said something different; the change is stated inline. *Analysis* = Forgeflow reasoning, not a sourced fact.

---

## 0. Key takeaways

1. **Pick protocol is a separate axis from map and ruleset.** Both reference games treat "how characters get chosen" as a pluggable layer: blind, pre-pick, draft with bans, tournament draft, random with a bench, choose-1-of-N, and so on. The same map and rules run under several of these [R01 synthesis; 9][17].
2. **LoL's solo-queue draft runs in fixed stages, each with its own timer** (confirmed this pass [4]):
   - about 15 s to declare intent [1];
   - 30 s of simultaneous bans, with all ten players banning at once, then a 5 s reveal;
   - six pick turns of 30 s each, in a 1-2-2-2-2-1 order (blue 1, red 2, blue 2, red 2, blue 2, red 1);
   - a 30 s finalization window for trades and loadout.

   The 2026 ranked update cut about 30 s of animations and timers from this flow and stopped a player from banning a champion an ally is hovering [3][42]. The hover-ban block was first trialled in patch 25.20 (8 October 2025) on NA and OCE [41].
3. **Tournament draft uses phased bans of 3, picks of 3, bans of 2 and picks of 2 per side** [1][2][5]. **New for 2026 pro play ("First Selection"):** the team with the advantage no longer gets both side and first pick. It chooses one (side, or draft order) and the other team gets the other [39][40]. In 2026 tournament draft is also a weekend ranked queue for full premades [2].
4. **Dota 2 ranked All Pick has no in-match ban vote since 7.35d.** Players save up to four ban preferences and at least one is guaranteed to be banned [11][12]. Picks happen in **five hidden, simultaneous rounds** (one hero per side per round, revealed next round) [47], followed by **30 s of strategy time** [48]. Turbo uses 30 s picks, 30 s strategy and 10 s bans, with all picks blind [49][77]. Captains Mode gives each team **7 bans and 5 picks** [45]; patch 7.40 changed the first and third ban stages and kept the pick order [14][78].
5. **Draft only works with roster depth.** LoL requires ownership of 20 champions for ranked or Normal Draft [6][7]. That number is exactly what guarantees the last picker at least one legal pick after 10 bans and 9 other picks. Section 1.6 turns this into a rule for sizing Vale's roster.
6. **LoL replaced ARAM rerolls with a "cards plus shared bench" scheme in 25.13.** Each player has **12 s** to keep one of two cards; the other goes to the team bench. A rare third card has a base 5% chance plus 0.15% per champion owned, with a pity timer [18][52][54]. Riot's reason was that rerolls gave anywhere from 5 to 15 choices per game, which felt inconsistent [18].
7. **ARAM is now a family of variants.** Since 25.13 there has been a three-map rotation, picked at random with equal odds per lobby [20][21][22]. Since October 2025 there has also been an augment variant shipped as its own queue beside plain ARAM [23][24]. **Corrected:** its augment picks come at levels **3, 7, 11 and 15** (four picks; players start at level 3), not 7, 11 and 15 [55][56].
8. **LoL Arena is a structured free-for-all, not a melee.** Its 8 duos fight paired 2v2 rounds on small maps: a 45 s shop phase, then combat with a ring closing from 30 s in [29]. Each duo has **100 team health**, and the loss per defeated round rises from 15 to 20, 30, 35 and finally 100 at round 17, which forces an end [29][67]. **Top 4 counts as a win** for rating [67]. 2026 Season 2 added rotating "events", including a 6-team trio format and a 2-team format of four [68][69].
9. **The genre's main defence against third-party chaos is structural.** Arena and TFT pair opponents per round [29][72]. **Confirmed for Overthrow** (Dota 2's FFA kill race): a central zone that pays bonus gold and XP, coin drops in the middle, announced item drops whose quality is *better for teams with fewer kills*, and **longer respawns for a leader who is at least two kills ahead** [62]. A leader *marker or kill bounty* in Overthrow was **not** found and stays [unverified]. LoL's gold bounties [32][33] and trailing-team objective bounties [34] remain the confirmed team-mode versions of the same catch-up idea.
10. **Placement curves in shipped games are steep at the top with a flat tail** (confirmed this pass): ALGS 2026 pays 12/9/7/5/4/3/3/2/2/2 then 1 and 0, plus 1 per kill [73]; PUBG esports pays 10/6/5/4/3/2/1/1 then 0, plus 1 per kill [74]. Both TFT and Arena ladders treat **top 4 of 8 as the winning half** [67][71].

---

## 1. Pick formats

### 1.1 Taxonomy of pick protocols

| Protocol | Who decides | Bans | Info during pick | Same character on both teams? | Typical use | Source |
|---|---|---|---|---|---|---|
| Blind pick | Each player, at the same time | None | None about the enemy | Usually allowed (mirror matches) [unverified] | Old LoL casual queue; removed | [8] |
| Pre-pick (role + character before queuing) | Each player, before matchmaking | None | None | **Yes, mirrors are possible** (confirmed this pass) | LoL Swiftplay, the default casual front door since 2025 | [9][8][57] |
| Draft with simultaneous bans | Each player, in turns (1-2-2-2-2-1) | 1 per player, hidden from the enemy, at the same time | Allies' intent and bans visible; enemy picks visible as they lock | No [unverified] | LoL Normal Draft and Ranked | [1][4][7] |
| Tournament draft | Team, in turns | 5 per side in two phases | Full | No | LoL pro play, Ranked 5s | [1][2][5] |
| Fearless series draft | Team, across a series | Per game, plus a lockout of champions picked earlier in the series | Full | No | LoL tier-1 pro play since 2025, continuing in 2026 | [43][44] |
| Captains Mode | One captain per team | 7 per team, in three phases | Full | No | Dota 2 competitive | [16][45] |
| Captains Draft | Captain, from a reduced random pool | Yes | Full | No | Dota 2 | [16] |
| All Pick with ban preferences | Each player, in 5 simultaneous rounds | Taken from saved account preferences | Each round's picks hidden until the next round | No [unverified] | Dota 2 ranked | [11][12][47] |
| Turbo | Each player, all at once | 10 s ban window, applied immediately | Blind | No [unverified] | Dota 2 casual fast mode | [49][77] |
| Single Draft | Each player chooses 1 of **4** random heroes, one per attribute | None | [unverified] | No | Dota 2 | [50][51] |
| Random Draft | Players take turns picking from a shared random pool of about 20 | None | Full | No | Dota 2 | [13][50] |
| All Random | Random assignment | None | n/a | No | LoL ARURF edition; Dota 2 status **[conflicting]**, see 1.4 | [13][28][50] |
| Random cards + shared bench | Random offer of 2 cards per player (12 s to choose); bench shared by the team | None | Team's bench visible | [unverified] | LoL ARAM since 25.13 | [18][19][52] |
| Ability Draft | Random body; players draft abilities in turns | None | Full | n/a | Dota 2 | [17][27] |

**Corrected this pass:** Single Draft offers four heroes (Strength, Agility, Intelligence and Universal), not three [50][51]. The three-hero version predates the Universal attribute.

### 1.2 LoL draft (Normal Draft and Ranked Solo/Duo), step by step

1. **Before queuing.** Each player picks a primary and secondary position, or Fill. The matchmaker tries the primary first, then the secondary, and rarely autofills [7]. In 2026, picking a position became **required** for all main-map games [10].
2. **Intent phase, about 15 s.** Players hover the champion they mean to play. Allies see it before anyone locks [1].
3. **Ban phase, 30 s, simultaneous** (confirmed this pass [4]). All ten players ban at once. Allies' bans are visible during the phase, and enemy bans stay hidden until a **5 s reveal** [1][4]. A player **cannot ban a champion an ally is hovering**: trialled on NA and OCE in 25.20 (8 October 2025) and applied to every queue with a ban phase, Arena included [41]; part of the 2026 ranked changes [3][42]. Because bans are hidden, two players on opposite teams can ban the same champion, so a lobby can end with fewer than ten unique bans **[unverified]**.
4. **Pick phase: six turns of 30 s each** (confirmed this pass [4]). One team makes the first pick, then teams alternate in pairs until all ten have locked: blue 1, red 2, blue 2, red 2, blue 2, red 1. **Corrected:** the first pass gave "roughly 30–40 s" per turn; the current figure in the snippet is 30 s. Each champion can be picked only once per match **[unverified]**.
5. **Trades.**
   - *Pick-order swap:* before either player has locked, a Swap request next to an ally's portrait lasts about 10 s [4].
   - *Champion trade:* after everyone has locked, a trade request lasts 30 s (confirmed this pass [4]).
   - *Role swap:* since 25.08, a one-click request [25].
6. **Automation.** Since 25.08, junglers automatically get the jungle summoner spell and supports get the support item. This removes mistakes made under time pressure [25].
7. **Finalization, 30 s** (confirmed this pass [4]). A grace period for skins, loadouts and champion trades before load.
8. **Failure handling.**
   - Failing to lock in counts as a dodge [26].
   - Ranked dodges escalate through three tiers: 6 min and −3 LP, then 30 min and −10 LP, then 12 h and −10 LP. Each tier decays after 12 h [26].
   - At Master tier and above in 2026, a dodge counts as a **full loss for both LP and MMR**. Dodging also no longer resets autofill status; the autofill carries to the next match [3][42].
   - A player who is reported and confirmed as griefing in champ select ends the lobby (26.1) [10].
9. **Total time** (*analysis*). Adding up the confirmed stages gives 15 + 30 + 5 + 6 × 30 + 30 = **260 s, about 4.3 minutes** at the maximum, before load and before the 2026 trim of about 30 s [3][42]. Riot treats champ-select time as a client KPI [3][R05].

**Design reading** (*analysis*). Most of the system's weight goes into *coordination*: visible intent, protection for hovered picks, short timed swap requests, and auto-assigned loadout pieces. The adversarial part (bans and counter-picks) is small by comparison. The 2025–2026 changes removed points of friction rather than adding depth.

### 1.3 Tournament draft and fearless

- **Phases:** 3 bans, 3 picks, 2 bans, 2 picks per side [1][2]. Pro play moved from 3 to 5 bans per team (10 total) in 2017 [5][38].
- **Order** (partly confirmed this pass [5]):
  - first bans: the teams alternate one at a time, B-R-B-R-B-R (confirmed);
  - first picks: B, then R-R, then B-B, then R (confirmed);
  - second bans: two more per team, alternating, **red bans first** (confirmed);
  - second picks: R, then B-B, then R **[unverified]**.

  *Analysis:* the second ban phase lets each team respond to the picks it has already seen. Last pick falls to red, which balances blue's first pick.
- **Ranked 5s (2026)** uses this draft for full five-player premades in weekend windows. Its second run (26.18) shows some opponent information, as the existing tournament mode does [2].
- **Fearless draft** (confirmed this pass, except where marked):
  - Standard across tier-1 pro leagues since 2025 (LCK Cup, LTA and LEC from January 2025; international from First Stand 2025) and continuing through 2026 [43].
  - Each game still runs a normal 10-ban tournament draft. Fearless adds one series-wide rule: champions **picked** in earlier games are locked out of later games [43].
  - **Hard (full) fearless:** a pick locks the champion for *both* teams for the rest of the series. **Soft fearless:** it locks only for the team that picked it, so each champion can appear at most twice per series [43]. The LCK used hard fearless in 2026 [44].
  - **[conflicting]:** one 2026 report describes champions "chosen or banned" earlier as locked [44]; the explainer says only picks carry over and bans reset each game [43]. The picks-only reading matches the general description of the format.
  - Whether the deciding game of a best-of-five resets the pool: **[unverified]**, not found in any snippet.
  - *Analysis:* a full best-of-five can lock out up to 50 champions through picks alone, so fearless assumes a very large roster.
- **Side vs pick priority (confirmed for LoL 2026).** Under Riot's **First Selection** rule, used in all major pro regions from the 2026 season, the advantaged team chooses *either* side (blue or red) *or* draft order (first or second pick), and the other team gets the remaining choice. Before 2026 one team got both. Riot's stated aims: measure the real value of each side, reduce first-pick advantage, and get more varied drafts. The change came out of discussion about fearless, which had sharpened blue-side advantage [39][40]. The Dota tournament equivalent remains **[unverified]**.

### 1.4 Dota 2 formats

- **Captains Mode.**
  - One captain per team runs a structured pick-and-ban draft [16]. Each team has **7 bans and 5 picks**, 24 selections in all, spread over phases (confirmed this pass [45]).
  - Patch 7.40 rewrote the first and third ban stages and left the pick order unchanged [14][78]. Brand-new heroes are kept out of Captains Mode for a while; 7.40c added the then-newest hero [15].
  - Patch 7.34 had already reordered the draft and is reported to have shortened the first ban phase's timing from 30 s to 15 s [46].
  - The per-turn clock plus a per-team **reserve time bank** (about 2 min in the first pass) is **[unverified]**: no snippet gave the current reserve value.
  - *Analysis:* the reserve-bank pattern is still the interesting system here. A per-turn clock plus a shared overflow pool lets a captain spend extra time on one hard decision without slowing every turn.
- **Captains Draft.** Captains draft from a reduced random hero pool [16].
- **All Pick (ranked), 2026.**
  - No in-match ban vote since 7.35d. Players save up to four heroes on their account, and at least one of them is guaranteed to be banned [11][12]. The older Liquipedia description of nominations with a 50% success chance [13] is superseded.
  - **Picking: five rounds** (since 7.25). In each round Radiant and Dire each pick one hero at the same time, and each team's pick stays hidden until the next round. If both pick the same hero, the second picker gets a little extra time to choose again (confirmed this pass [47]).
  - One guide reports 20–25 s per round depending on phase, a 2 gold/s penalty once the timer runs out, and no random in the last 10 s [49]. Treat these as approximate.
  - **Strategy time: 30 s** after picks. Teammates can swap heroes, but only until one of them spends gold or levels a skill before the horn (confirmed this pass [48]).
  - A bonus for choosing random is **[unverified]**.
- **Turbo** (confirmed this pass [49][77]): All Pick rules with shorter timers. Picks 30 s, strategy 30 s, bans 10 s. All players pick at once and picks are blind; bans apply immediately instead of being voted.
- **Single Draft:** each player chooses 1 of **4** random heroes, one per attribute (Strength, Agility, Intelligence, Universal) [50][51]. **Corrected** from "1 of 3".
- **Random Draft:** players take turns picking from a shared random pool of about 20 heroes [13][50].
- **All Random: [conflicting].** An older snippet says a random hero plus bonus starting gold [13]; one current guide says All Random is no longer an active matchmaking mode [50]. Do not rely on either for 2026.

### 1.5 Why blind pick fails, and what replaced it

Blind pick failure modes (*analysis*, general genre knowledge, not cited facts):

- **Role collisions.** Several players pick the same role, and the first chat message to "call" a role becomes the real draft. That rewards fast typists and starts fights.
- **Mirror matches and counterpicks happen by accident.** Nobody can respond to the enemy, so lane outcomes are partly a coin flip.
- **Incoherent compositions.** Nothing guarantees a front line, a support or a damage mix.
- **First-time and troll picks have no social brake**, because teammates see nothing until load.

LoL replaced Blind Pick first with Quickplay and then with **Swiftplay**. Players pick a role *and* a champion before queuing, and the matchmaker guarantees role uniqueness. A full five-player party must take five unique roles [8][9]. That keeps blind pick's speed (no champ-select screen) while fixing role collisions. **Confirmed this pass:** with no ban phase and no alternating order, the same champion can appear on both teams [57]. Counterpicking stays random by design.

### 1.6 Minimum roster size for a draft with bans

**Confirmed gates.** LoL Ranked requires owning **20 champions**. Normal Draft requires access to 20 champions, free rotation included [6][7].

**Why 20** (*analysis*). In a 5v5 draft with 10 bans and no duplicate champions:

- the last picker faces up to 10 banned champions and 9 already picked;
- that is 19 removed, so an owned pool of 20 guarantees at least one legal pick.

The gate is a worst-case guarantee, not a comfort level.

**Generalized for Vale** (*analysis*, Forgeflow derivation):

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

**Historical calibration:**

- LoL used **3 bans per team** for years and moved to 5 per team in 2017 (confirmed this pass [5][38]). Its launch roster of roughly 40 champions is **[unverified]**.
- Heroes of the Storm's launch roster and ban count are **[unverified]**.
- Dota 2 inherited 100+ heroes from its predecessor **[unverified]**.

*Analysis:* launch ban counts are small and rise as the roster grows. **Ban count should be a function of roster size, set in data.**

---

## 2. The single-lane random brawl

### 2.1 LoL ARAM rules (2026)

| Aspect | Rule | Source |
|---|---|---|
| Format | 5v5 on a single lane with random champions, no jungle and no wards; permanent queue | [21][52][R01] |
| Map | Since 25.13 (25 June 2025), each lobby gets one of three single-lane maps with equal probability. Variants add base launchers that fire players toward a chosen point, and healing plants | [20][21][22] |
| Champion assignment | Cards replaced rerolls in 25.13. Each player gets **two cards and has 12 s to keep one**; the other goes to the shared bench. Sometimes a third card appears: base chance 5%, plus 0.15% per champion owned, with a pity system (confirmed this pass) | [18][19][52][54] |
| Why cards replaced rerolls | Rerolls gave 5–15 choices per game (about 10 on average) and felt inconsistent. Cards give a guaranteed floor | [18] |
| Old reroll economy | Reroll points were earned per game, with about 2 rerolls bankable **[unverified]** | none |
| Shared bench | The unchosen card lands on a bench all five teammates can see. After the initial picks, any player can take a bench champion instead of their own, and teammates can trade directly (confirmed this pass). A per-player swap cooldown is **[unverified]** | [18][19][52][54] |
| Champion pool | Owned champions plus the free rotation **[unverified for 2026]** | none |
| Starting state | **Level 3** (confirmed this pass). Starting gold of 1,400 is **[unverified]**; no snippet gave a value | [52][53] |
| Recall, shopping and fountain | Recall is disabled (the channel animation still plays). Items can be bought only after dying, and there is no way to return to base to heal (confirmed this pass) | [52][53] |
| Health pickups | **Health relics** on each side: outer relics first appear at 1:45, inner at 2:30, and each respawns 90 s after it is taken. They restore health and mana (confirmed this pass). The newer maps add healing plants [20] | [20][52][53] |
| Mode-only summoner spells | A long-range mark-and-dash snowball spell is available to every player; Teleport is disabled (confirmed this pass). A mana-restore spell is **[unverified]** | [52] |
| Mode-wide balance rules | Reported global rules: damage from champions at 1,000+ range reduced by 15% (ultimates and damage over time excluded), +70 summoner spell haste, outgoing heals reduced by 50%, and +10 magic resist for melee champions | [52] |
| Per-champion mode balance | Hidden per-champion multipliers (damage dealt and taken, healing, shielding and others) tuned each patch **[unverified]**; no snippet confirmed them this pass | none |
| Structures | Per side: 2 lane turrets, then an inhibitor turret and inhibitor, then 2 base turrets and the base core **[unverified]** | none |
| Match length | About 15–20 min [30], or 15–25 min in a 2026 guide [52]. **Corrected:** the range is wider than the first pass stated | [30][52] |
| Dodge lockouts | 15 min, then 30 min, then 12 h | [26] |

**ARAM: Mayhem (augment overlay).**

- Went live in patch 25.21 (22 October 2025) as a *separate queue alongside regular ARAM* [23][24].
- **Corrected:** each player chooses an augment at levels **3, 7, 11 and 15**, four picks in all; the first comes at the start because everyone begins at level 3 [55][56]. The first pass listed only 7, 11 and 15. Some augments affect teammates as well [23].
- Each selection offers 3 random augments with 1 reroll. Augments come in Silver, Gold and Prismatic tiers. **Everyone in the lobby is offered the same tier at a given selection**, and that tier is random each time [55][56]. A fifth slot can be filled by a few special augments [55].
- About 201 augments existed by 26.19, and five more were added in 26.21 [27a][31]. Some Mayhem augments were carried into Arena in 2026 Season 2 [68].
- Riot has signalled updates into 2027 [24a], and a live-mode tracker listed it as live in early October 2026 [35].

**ARURF (January 2026)** used the all-random variant of assignment for an ultra-fast ruleset [28].

### 2.2 Why the format works (design analysis)

This is *analysis*, not a sourced claim, though it now rests on more confirmed rules.

- **Every second is a fight.** With one lane there is no rotation, no jungle and no split-push decision. The only questions are when to engage and when to give ground.
- **Randomness removes draft stress.** The bench then gives some control back. The card scheme sets a floor (always at least 2 choices, plus the whole bench) and keeps a ceiling (a rare third card) [18]. The 12 s card timer keeps the whole selection short [52].
- **No recall and no base healing turn health into a currency spent across fights** [52][53]. Sustain kits, health relics and well-timed deaths become real decisions. Dying is the only way to shop, so death is partly a tempo tool.
- **Health relics and launch pads create small objectives** in a mode with no neutral objectives. Their staggered first spawns (1:45 outer, 2:30 inner) and 90 s respawn put a clock on the lane [20][52].
- **Mode-wide balance rules** keep a random mode fair without changing kits. The confirmed global rules target the two things one lane over-rewards: long-range poke (−15% beyond 1,000 range) and sustain (−50% heals) [52]. Per-champion multipliers on top of that are **[unverified]**.
- **The augment overlay ships as a sibling queue.** The calm base mode stays intact for players who prefer it [23].

### 2.3 Comparisons

- **Dota 2 All Random:** **[conflicting]** current status; see 1.4 [13][50].
- **Dota 2 Ability Draft:**
  - Each player gets a random hero body with no abilities.
  - Players draft 3 regular abilities and 1 ultimate in turns, from a pool built from the 10 players' heroes plus 2 extra random heroes [17].
  - Since 7.41, each hero keeps its innate ability [27].
  - *Analysis:* the deepest "random plus draft" hybrid in the genre. The draft is over *parts* rather than whole characters.
- **Dota 2 All Random Deathmatch** (confirmed this pass from older guides [61], current availability [unverified]): each death gives you a new random hero that no one has used yet, and you keep your level, gold and items. The team shares a finite stock of lives (40 or 45 depending on the guide), and a team wins by destroying the enemy base or reaching 45 kills. A team that runs out of lives stops respawning.
- **Heroes of the Storm single-lane random:** each player picks 1 of 3 random heroes within 30 s; there are no Hearthstones (no recall) [58]. **Corrected:** the first pass said the offer is built to guarantee a viable composition (such as a healer option). No snippet supports that; the sources found describe three random heroes with no stated role guarantee. The "constrained random" idea in 4(a)9 is therefore Vale's own.
- **SMITE Assault** (confirmed this pass [59]): 5v5 on a single lane with towers and phoenixes, a random god per player, no jungle camps. After leaving the fountain a player cannot buy until they die and cannot go back to base to heal. A "healer rule" exists, but its details were not in the snippet. The closest structural analogue to ARAM.

---

## 3. Free-for-all and placement in the genre

*(Gap-fill status: Arena's health and rating rules, Overthrow's core rules, Battlerite's round rules, TFT's ladder and pool, and BR esports scoring are now confirmed. Leader marking, ring timings and tie-breaks remain unverified.)*

### 3.1 Reference set

| Reference | Players / teams | Structure | Win or placement | Main anti-chaos lever |
|---|---|---|---|---|
| LoL Arena | 8 duos (16 players) [29]; 2026 S2 events add a 6 × 3 format and a 2 × 4 fast format [68][69] | Rounds of paired 2v2 fights on small maps. 45 s shop and augment phase, then combat. The ring closes from 30 s into combat [29] | 100 team health per duo; each lost round costs 15 / 20 / 30 / 35 / 100 health depending on the round bracket; zero means elimination [29][67]. Top 4 gain rating [67] | **Structural:** only two teams fight at once |
| Dota 2 Overthrow | Original (2015, Valve): Forest = 10 solo players, Desert = 5 duos, Mines = 3 trios [62][63]. Overthrow 3.0 (2026): solo, duo, 5- and 8-player teams [64] | Small arena, no towers. A central throne zone pays bonus gold and XP; coins are thrown out in the middle; announced item drops [62] | Most kills when the timer ends, or first to the kill limit. Timer 10 min in the guide found; a tie at time-out goes to the next team to pull ahead [62] | Better items for teams with fewer kills; longer respawns for a leader 2+ kills ahead [62] |
| LoL Brawl (team mode, used here for its score pool) | 5v5 | Small map, no towers | Each team has a 250-point pool. A champion kill costs the victim's team 5, a minion kill costs 1, and each minion that reaches the enemy portal costs 1. Minion-kill damage pauses when a team is critically low [36] | Score pool with a floor-protection rule |
| SMITE Arena | 5v5 | Colosseum map with minion waves | A ticket pool drained by deaths and by minions entering your portal **[unverified]** | Same pattern as Brawl |
| Heroes of the Storm brawls | Varies | Weekly rotating special maps and rule sets, rewards for playing a few games **[unverified]** | Varies | Rotation keeps novelty without splitting the core queue |
| Battlerite (arena) | 2v2 / 3v3 | Round-based arena fights. A destructible Middle Orb in the centre grants power and respawns. After about 2 min a sudden-death boundary shrinks the arena toward the centre [60] | First to 3 round wins [60] | Timed central pickup; forced closure |
| Battlerite Royale | About 20–30 players, solo or duo | Battle royale with a ring, loot chests and mounts **[unverified]** | Last standing | Ring |
| Auto-battlers (TFT) | 8 players | Each round, players are paired for a single 1v1 battle [72]. Shared, limited unit pool per cost tier [72]. "Ghost" boards for odd counts **[unverified]** | Top 4 gain LP and cannot lose LP; bottom 4 lose LP [71] | Structural pairing; shared unit pool |
| Battle royales (Apex, Fortnite, PUBG) | 50–100 players | Shrinking safe zone in rounds | Placement curve plus kill points (see 3.4) [73][74][76] | Ring, knockdown and revive, respawn systems |

### 3.2 Dota 2 Overthrow (confirmed this pass, except where marked)

- **Origin.** Overthrow was Valve's first official custom game, released with the Dota 2 Reborn update in 2015; Valve also published its maps, scripts and UI as reference content for modders [63].
- **Current status.** The version players use in 2026 is **Overthrow 3.0**, a separate Workshop item with patch notes through mid-2026 [66]. It vanished from the client in July 2026 and came back within days [65]. **Corrected:** the first pass called the mode "Valve-made" without qualification; that is true of the original, and who maintains 3.0 is **[unverified]**.
- **Maps and teams.** Original: Forest (10-player free-for-all), Desert (5 duos), Mines (3 trios) [62]. Version 3.0 offers solo, duo, 5-player and 8-player team formats [64]. **Corrected:** the first pass said "solo FFA up to teams of five".
- **Scoring and end.** Each kill is worth one point [64]. The player or team with the most kills when time runs out wins, or whoever reaches the kill limit first [62]. The guide found gives a **10-minute** time limit; if teams are tied at time-out, the first to pull ahead wins [62]. **Corrected:** the first pass gave 10–15 min. Current kill limits per format are **[unverified]**.
- **Central zone.** A throne in the middle of each map has a ring around it where heroes gain bonus gold and XP [62].
- **Coin drops.** A character at the centre periodically throws coins around; each coin picked up is worth 300 gold. Couriers cannot pick up coins or chests [62].
- **Item drops.** An announcement warns that an item is about to be delivered; a flying chest then leaves the throne for one of the drop spots [62]. **The fewer kills a player or team has relative to the others, the better the items they get** [62]. (Confirmed; the first pass had this as "reportedly".)
- **Leader penalty.** The leading team gets extra-long respawn times, but only when it is **at least two points ahead**. The threshold was added so players would still fight for first blood early [62].
- **Leader marking and kill bounties.** **[unverified]**: no snippet mentioned a leader marker or extra reward for killing the leader. **Corrected:** the first pass listed these as part of the pattern.

**Pattern** (*analysis*): a *score race* capped by a timer, a *central zone and pickups* that draw fights into known places, and *catch-up* delivered through loot quality and leader respawn time rather than through bounties.

### 3.3 LoL Arena: how placement maps to outcome

- **Sourced** [29], plus confirmed this pass [67][68][69][70]:
  - 8 duos in a random round-robin bracket, playing until one duo remains.
  - A start level of 3.
  - A 45 s shop phase between rounds, with items and augment picks.
  - Combat on small maps, with the ring closing from 30 s into combat.
  - A vote phase before rounds 2 and 8 [67].
  - **Team health:** 100 per duo. A lost round costs 15 health in rounds 1–4, 20 in rounds 5–8, 30 in rounds 9–12, 35 in rounds 13–16, and 100 at round 17, which guarantees an end [67]. (The first pass had "loss grows with round number" as [unverified].)
  - **Rating:** 1st–4th is a "victory" and gains rating, more for higher places; 5th–8th is a "defeat" and loses rating, more for lower places, **but rating is only deducted in the top (Gladiator) tier** [67].
  - **Augments:** Silver, Gold and Prismatic tiers [70].
  - **2026 Season 2:** some augments now level up, reaching a final form at level 3. Players hold up to 4 augments; later offers let them level or replace one. A crafting round on round 8 can add a slot or trade one for a level. More than 30 new augments arrived, some from ARAM: Mayhem. The season launched with four rotating events: standard, 3 × 6 teams, a random-champion event and a two-team 4v4 fast format. It also added a new map and at least 20 more champions as guests [68][69].
- **Still unverified:**
  - The exact augment rounds (snippets disagreed: rounds 1, 5, 8 and 11 in one; guaranteed Prismatic offers on rounds 7 and 10 in another) **[conflicting]**.
  - Final placement equals reverse elimination order. This is implied by "until one duo remains", but no snippet spelled it out.
  - A long-term goal rewarding first places across many different characters.
- **Status:** Riot says Arena is not permanent and runs as a recurring featured mode. It was live as of early October 2026 [29][35].

### 3.4 Placement scoring patterns (confirmed this pass, except where marked)

| System | Placement curve | Kills | Notes | Source |
|---|---|---|---|---|
| ALGS 2026 (Apex esports, 20 teams) | 12 / 9 / 7 / 5 / 4 / 3 / 3 / 2 / 2 / 2, then 1 for 11th–15th and 0 for 16th–20th | 1 per kill | The first pass's numbers were right. Whether kills are capped in pro play is **[unverified]** | [73] |
| PUBG esports "SUPER" point rule (16 teams scored) | 10 / 6 / 5 / 4 / 3 / 2 / 1 / 1, then 0 for 9th–16th | 1 per kill | Also used in PUBG Mobile esports. PGS 2026 circuit standings also score only the top 16 of 24 teams per series | [74][75] |
| Apex ranked ladder (Season 26) | Per-match entry cost by tier: Rookie free, Bronze 10, Silver 20, Gold 38, Platinum 48, Diamond 65, Master/Predator 90 RP. Placement gives RP back | Each kill, assist or participation is worth more at a higher placement; after 8 kills, each further one is worth half | **Corrected:** the first pass called kill points "capped". They are halved past 8, not hard-capped | [76] |
| TFT ranked (8 players) | Top 4 gain LP, with 1st gaining more than 2nd; 4th or better cannot lose LP; bottom 4 lose LP | n/a | Size of gains and losses depends on hidden MMR versus visible rank | [71] |
| LoL Arena rating (8 duos) | 1st–4th gain rating (more for higher), 5th–8th lose (more for lower) | n/a | Losses apply only in the top tier | [67] |

**Ranking eliminated players** (*analysis*, conventions **[unverified]**). The usual convention is reverse elimination order. Simultaneous eliminations are broken by a secondary stat: health or score before the final hit, damage dealt, or remaining resource. In squad BRs, an individual who dies early still takes the *team's* final placement.

**Structure families** (*analysis*):

1. **Last standing:** battle royales, Arena. Strong drama at the end; long wait for players knocked out early.
2. **Score race with a timer:** Overthrow [62]. Nobody is knocked out early, and players respawn. The risk is a runaway leader, which Overthrow answers with leader respawn time and loot quality.
3. **Hybrid lives pool:** Arena's team health [67], Brawl's 250 pool [36], ARDM's team lives [61]. Placement is "who ran out last", but nobody sits out a whole round.
4. **Respawn windows:** a BR that allows respawns early and switches them off late, or allows them while a teammate is alive **[unverified]**.

**Safe-zone timing.** BR match length and ring-stage counts are **[unverified]**. Arena squeezes the ring into a single per-round closure starting 30 s into combat [29], and Battlerite's sudden-death boundary arrives after about 2 min of a round [60]. Both are tempo tools, not match-length tools; Arena's match-length tool is the escalating team-health loss [67].

### 3.5 Keeping FFA from becoming third-party chaos

Ordered from strongest to weakest structural effect (*analysis*, with sourced examples):

1. **Pair opponents per round.** Arena runs paired 2v2 fights [29], and TFT pairs players for one 1v1 battle per round [72]. A third party is impossible by construction. FFA becomes a *bracket of duels plus a shared standings table*.
2. **Score pools and lives instead of instant elimination.** If you are third-partied, you lose a slice of your pool, not the match [29][36][67].
3. **Leader handicap.** Overthrow's confirmed version is a *respawn* penalty for a leader at least two kills ahead [62]. A visible leader marker or a bounty on the leader is **[unverified]** for Overthrow. LoL's confirmed team-mode bounty is built up from gold earned, shown from 150 gold, with any excess above 700 carried over to the next life [32][33]. The idea transfers to FFA as "the leader is worth more".
4. **Catch-up economics with a time gate.** LoL activates objective bounties only from 14:00 and only for the trailing team; the bounty fades within about 15 s once the gap closes [34]. Overthrow gives better item drops to teams with fewer kills (confirmed [62]).
5. **Kill-credit sharing.** LoL splits a 150-gold assist pool evenly among assisters [37]. In FFA, a damage-recency window gives credit to everyone who hit the victim recently. That reduces the "steal the last hit" reward of a third-party.
6. **Timed central pickups.** Overthrow's central throne zone, coins and announced item drops [62]; Battlerite's destructible Middle Orb [60]; ARAM's health relics on fixed timers (first at 1:45 and 2:30, then every 90 s) [52] and plants on the newer maps [20]. Announced or predictable spawns pull fights to known places at known moments, so encounters are scheduled rather than ambushes.
7. **Shared shop and shared pool.** In Arena, everyone shops from the same catalogue between rounds [29]. TFT adds **contention**: each unit has a fixed number of copies shared by the lobby (30 / 25 / 18 / 10 / 9 by cost tier in one 2026-era set), so buying a unit makes it rarer for everyone [72].
8. **A placement curve that pays survival over kills.** ALGS and PUBG use steep-top placement points with a flat tail and 1 point per kill [73][74]. Apex ranked scales kill value by placement and halves it after 8 kills [76]. Reckless third-partying is a poor expected-value play under those rules.

---

## 4. Implications for Vale

All of this section is *analysis*. Citations point to the facts each recommendation rests on.

### (a) Public systems worth adopting in original form

1. **Make pick protocol a data enum on the queue.** Values: `prePick`, `draft{bansPerSide, banMode: simultaneous|phased, pickOrder, turnSeconds, reserveSeconds}`, `roundsHidden{rounds, roundSeconds}`, `randomCards{cards, chooseSeconds, thirdCardChance, pity, bench}`, `chooseOneOfN{n, perArchetype}`. Add `series{fearless: none|soft|hard}` and `firstSelection: bool` for events. Mode and map stay independent, which is the Dota "protocol × ruleset" model [R01].
2. **Casual front door: pre-pick.** Choose role and character before queuing, with guaranteed role uniqueness [8][9]. Allow mirrors across teams, as Swiftplay does [57]. It gives the shortest time from queue to match, which suits a browser game.
3. **Ranked draft sized to the roster.** Use simultaneous hidden bans followed by snake picks. Calibration from LoL's confirmed timers: 30 s bans, 5 s reveal, 30 s per pick turn, 30 s finalization [4]. For 3v3 the snake is 1-2-2-1 (four turns). A browser budget could run 20 s turns, giving about 15 + 20 + 5 + 4 × 20 + 20 = 140 s. Set bans per side from the roster formula in 1.6, and gate ownership at `O_min = 2T + B`. With a launch roster of about 16 and 3v3 teams, use 1 ban per side and raise it as the roster grows.
4. **Faster alternative: hidden simultaneous rounds.** Dota's ranked All Pick runs five rounds in which both sides pick one hero at once, revealed next round [47]. For 3v3 that is three rounds instead of four snake turns, with counterpick information still arriving round by round. Worth prototyping as `roundsHidden`.
5. **Draft coordination features, which do the most good for the effort:**
   - intent hovers visible to allies [1];
   - no banning a hovered ally pick [3][41];
   - pick-order swaps (about 10 s) and post-lock trades (30 s) [4];
   - one-click role swap and auto-assigned obvious loadout pieces [25];
   - a short strategy window after picks where swaps lock once a player commits resources [48].
6. **Ban preferences as a fast-path option.** Saved account bans with "at least one of yours is honored" [11][12] give ban agency with no time added to champ select.
7. **Per-turn clock plus reserve bank** for premade and tournament drafts. The pattern is sound, but Dota's current reserve value is **[unverified]**, so Vale should tune its own.
8. **Event formats:** use a First Selection-style split (the advantaged side picks *either* map side *or* pick order) [39][40]. Offer fearless as a *series option* only once the roster can support it; default to **soft** fearless (locked per team) at small roster sizes, since it consumes half as many characters as hard fearless [43].
9. **Single-lane random mode, built from original parts:**
   - 2 cards per player with a short choice timer (LoL uses 12 s [52]), keep 1, the other to a shared bench; a rare third card whose chance grows with collection size, plus a pity counter [18][52];
   - bench pick-ups and teammate trades after the initial choice [52][54]; add a short per-player bench-swap cooldown of Vale's own (the reference's cooldown is unconfirmed);
   - a higher starting level (LoL uses 3 [52]) and more starting gold (value to be set by Vale's own economy model; the reference figure is unconfirmed);
   - no recall, and shopping only in base or on death [52][53];
   - health-and-mana pickups on timers, with staggered first spawns and a fixed respawn (reference: 1:45 and 2:30, then 90 s [52]);
   - **mode-wide balance rules in a data table**, aimed at what one lane over-rewards: a long-range damage reduction and a healing reduction [52]. Per-hero multipliers can sit on top if playtests need them;
   - a hard target of about 12–18 min for browser sessions (the reference runs 15–25 min [30][52]).

   Ship any augment layer as a **sibling queue** [23]. Calibration from the reference: a pick at the starting level and then every 4 levels, 3 offers with 1 reroll, and the **same rarity tier for the whole lobby at each pick** so no one gets a lucky tier [55][56].
10. **Constrained random:** guarantee that each random offer can form a viable team composition (at least one frontline-capable and one sustain-capable option across the team's cards plus bench). **Corrected:** this is Vale's own idea. The HotS precedent the first pass cited was not confirmed [58]. Dota's Single Draft "one per archetype" offer [50][51] is the nearest confirmed relative.
11. **If Vale ships an FFA, use the paired-rounds model first.**
    - Duos or solos are paired per round on small arenas [29][72].
    - Each round runs a shop phase, then combat, then a closing boundary (Arena: from 30 s [29]; Battlerite: about 2 min [60]).
    - A team health pool with **escalating loss per round and a final round that eliminates outright**, so the match length has a hard ceiling. Arena's 15/20/30/35/100 bracket on 100 health is the calibration point [67].
    - Placement is reverse elimination order, with a tiebreak of health before the final round, then damage dealt.

    This avoids third-party chaos by construction [29]. A **score-race variant** is the second option, with confirmed levers from Overthrow: a central bonus zone, periodic central currency drops, announced item drops whose quality favours trailing players, a respawn penalty for a leader beyond a 2-kill threshold, and a short timer (10 min) with a sudden-death tiebreak [62]. Leader marking is Vale's own optional addition.
12. **Placement-to-reward curve:** steep at the top and flat in the tail, as in ALGS and PUBG scoring [73][74]. Use a "top half = win" line for missions and ladder (TFT and Arena both do this [67][71]), and do not take ladder points from a top-half finish [71]. Consider Arena's rule of only deducting rating in the top tier [67] to keep low-tier FFA players from feeling punished. Cap or taper kill and score bonuses, as Apex halves kill value past 8 [76].

### (b) Protected expression that must NOT be copied

- **Mode and format names:** ARAM, ARAM: Mayhem, ARURF, Arena, Brawl, Swiftplay, Captains Mode, Captains Draft, Ability Draft, Overthrow, Assault, Joust, Battlerite, First Selection, and Arena's event names. Also brand names of ladders, tiers and modes from TFT, Apex, PUBG and Fortnite (for example their victory titles and the "SUPER" points name). Generic words such as "draft", "ban", "all random", "bench", "fearless" as a plain description, and "free-for-all" are fine.
- **Map identities:** the snowy single-lane map and the other rotation maps, including geometry, launch-pad placement, plant placement and the bridge theme. Overthrow's arenas and its central throne set piece. Arena's small maps.
- **The mark-and-dash snowball summoner spell**, with its name, icon and exact tuning. Vale can have a gap-closer of its own design.
- **Augment names and text** from both augment modes, and their tier names. All augment concepts must be original.
- **Presentation:** the champion-select layout (portrait columns, ban strip, timer bar), the card visuals and pity UI, the bench layout, the ring's fire treatment, Overthrow's coin-throwing character and flying chest, Battlerite's orb, announcer lines, sounds and music.
- **Character identities, names and kits** from any reference title.

### (c) Open questions

1. **Team size and roster at launch.** With about 16 characters, 3v3 with 1 ban per side fits the formula, and 5v5 with any bans does not. Is draft even a launch feature, or do we launch pre-pick plus random-cards only?
2. **Ban model.** Simultaneous hidden bans (fast, but allows duplicates), saved ban preferences (fastest), or phased bans (premade only)?
3. **Pick model.** Snake turns (LoL [4]) or hidden simultaneous rounds (Dota [47])? The second is shorter for 3v3; does it feel fair enough without a ban phase?
4. **Mirrors.** *Answered for the reference:* Swiftplay allows the same champion on both teams [57]. Do we want the same in Vale's pre-pick?
5. **Single-lane economy.** No-recall attrition is confirmed as the reference rule [52][53]. Do we allow a slow recall for browser players who tab away? What starting level and gold fit a match of about 15 minutes?
6. **Is FFA a launch mode or a rotating featured mode?** Both references run their FFA-like modes as recurring events rather than permanent queues [29], and Overthrow 3.0's July 2026 disappearance shows a custom-game dependency risk [65].
7. **FFA lobby size versus browser concurrency.** Eight duos means 16 concurrent players per lobby. Arena's own 2026 events also run 3 × 6 and 2 × 4 [68][69]. Is 4 teams × 2 (8 players) enough for v1?
8. **Rating.** Should FFA placement feed a separate rating, as Arena does with top-tier-only losses [67], or award quest and pass progress only?
9. **Still to confirm in a later pass:**
   - LoL tournament draft's second pick phase order;
   - fearless deciding-game reset rule, and whether bans ever carry over;
   - Captains Mode reserve time and the exact post-7.40 sequence;
   - ARAM 2026 starting gold, structure count and per-champion multipliers; any bench-swap cooldown;
   - Arena's exact augment rounds and any long-term placement goal;
   - Overthrow 3.0 kill limits and timer per format, and who maintains it;
   - Dota All Random's current status;
   - BR ring timings and placement tie-break rules.

---

## Sources

**[1]–[37]:** seen in search-result snippets by sibling research agents (R01, R02, R05) and re-cited by the first pass. Several were re-confirmed in this pass's snippets, as marked in the text. **[38]–[78]:** seen in search-result snippets in the 2026-10-07 gap-fill pass. No page was opened in either pass (see the note at the top). "R01", "R05" and similar labels in the text refer to those sibling notes' own synthesis.

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
38. https://www.invenglobal.com/articles/745/lol-spring-split-will-introduce-a-10-ban-system-in-pro-games
39. https://www.sheepesports.com/articles/new-draft-rules-have-been-introduced-with-first-selection-system-aimed-at-rebalancing-the-sides/en
40. https://esports.gg/news/league-of-legends/first-selection-explained/
41. https://wiki.leagueoflegends.com/en-us/V25.20
42. https://www.sheepesports.com/articles/all-changes-coming-to-league-of-legends-ranked-in-s1-of-2026/en
43. https://blog.loltheory.gg/what-is-fearless-draft/
44. https://sports.khan.co.kr/en/article/202609091507007
45. https://esports.ru/dota-2/wiki/kak-rabotaet-captains-mode-v-dota-2/
46. https://esports.gg/news/dota-2/dota-2-patch-7-34-captains-mode-draft-order
47. https://liquipedia.net/dota2/Archive:Version_7.25
48. https://esports.gg/news/dota-2/how-to-swap-heroes-in-dota-2/
49. https://profilerr.net/matchmaking-game-modes-in-dota-2/
50. https://esports.gg/news/dota-2/what-are-all-the-dota-2-game-modes-and-how-do-they-work
51. https://winio.ai/glossary/dota2/single-draft
52. https://www.dodge.gg/en-US/lol/news/aram-guide-2026
53. https://www.esports.net/wiki/guides/what-is-aram-league-of-legends/
54. https://u.gg/articles/lol-patch-25-13-notes
55. https://blog.loltheory.gg/aram-mayhem/
56. https://www.sheepesports.com/articles/aram-mayhem-how-to-play-tips-augment-suggestions-and-more/en
57. https://www.leagueoflegends.com/en-ph/news/dev/dev-introducing-swiftplay/
58. https://www.thegamer.com/hots-heroes-of-the-storm-new-nexus-anomaly-aram-mode-crossover-cosmetics/
59. https://wiki.smite2.com/w/Game_Modes
60. https://en.wikipedia.org/wiki/Battlerite
61. https://www.dotafire.com/dota-2/guide/og-m4s-guide-to-all-random-deathmatch-updated-for-6-84c-9868
62. https://www.dotafire.com/dota-2/guide/how-not-to-throw-in-overthrow-a-detailed-guide-21879
63. https://www.gameskinny.com/news/dota-2s-reborn-update-part-2/
64. https://esports.ru/dota-2/wiki/overthrow-3-0-v-dota-2-chto-eto-za-kastomka/
65. https://esports.ru/dota-2/news/overthrow-3-0-stala-dostupna-v-dota-2/
66. https://steamcommunity.com/sharedfiles/filedetails/changelog/2760533777?p=4
67. https://support.riotgames.com/en-us/league-of-legends/gameplay/league-of-legends-arena-game-mode (team-health table and rating rules appeared in a combined snippet with [29]; attribution between the two is not certain)
68. https://www.sheepesports.com/articles/all-changes-coming-to-arena-in-league-of-legends-2026-season-2/en
69. https://dotesports.com/league-of-legends/news/lol-arena-season-2-events-augment-leveling-new-maps
70. https://mobalytics.gg/lol/guides/augments-in-arena-mode
71. https://support-teamfighttactics.riotgames.com/hc/articles/360050552133
72. https://esportstales.com/teamfight-tactics/champion-pool-size-and-draw-chances
73. https://liquipedia.net/apexlegends/Apex_Legends_Global_Series/2026/Split_1/Challenger_Circuit_1/EMEA
74. https://esports.gg/news/mobile/pubg-mobile-esports-2023-new-points-system
75. https://pubgesports.com/en/news/9870
76. https://help.ea.com/en/articles/apex-legends/ranked/
77. https://sportskeeda.com/esports/dota-2-turbo-the-best-game-mode-out-there
78. https://esports.ru/dota-2/news/v-dota-2-v-patche-7-40-izmenili-poryadok-banov-v-captains-mode/
