# Modes, queues, ranks, team buffs, economy and units (content lane, 2026-10-07)

What `content/modes.json`, `queues.json`, `ranks.json`, `team_buffs.json` and `units.json` define, and why. Every record parses against `src/contracts/catalog.ts`. Every `UnitDef.behavior` key comes from `src/sim/units/behavior_keys.ts`, and every `present` id comes from VOCAB. The real `tools/build_content.ts --check` passes with no errors when these files are merged into the `_harness/fixtures/content_min` tree with stub `map_rift`, `map_bridge` and `map_fray` maps. The only warnings are art and icon files that don't exist yet.

A sim smoke run on that catalog checked the following:

- Rift waves arrive at 0:30, 1:00 and 1:30, and a Greatwick joins wave 3.
- Every monster casts its whole kit, and each cast is drawn as an `everyone` telegraph.
- Sunsplinter grants Splinters, and Longshade grants the Long Shade to fighters and Wicks.
- All three Sunmotes grant their effects.
- Fray ends at 12 kills.
- Bridge starts at level 3 with 1,300 Gleam.
- Quick overrides land.
- Practice spawns the Sparring Post.

Numbers marked *(r0N)* were calibrated against `_design/research/r0N_*.md`. They are references, not copies; each Vale value is our own choice.

---

## 1. Session model

- **Local first.** `LocalSession` runs matchmaking (a simulated 2–6 s search and a 10 s ready check), the draft host, loading, the match host and post-game, plus grants, ratings, the store and the profile. Every open seat is a bot. `LocalMatchHost` steps the deterministic sim at 30 Hz with a fixed step; the reference servers tick at about 30 Hz too *(r08 §0.7)*. Bots are in-sim controllers that see the same fogged view a player sees.
- **Dedicated-server seam.** `RemoteSession` (a stub) has the same `Session`/`MatchClient` surface. A socket replaces the local host without any UI, render or audio change. Content never assumes local play: queues carry `partyMax`, `bots.fill` and grants as data, so a matchmaker can read the same records *(r08 §7a.12, §7a.15)*.
- **Content is the rules.** A mode is map + pick format + a complete `RulesParams`. A queue is mode + protocol + stakes + rule overrides, merged key by key; arrays replace *(r01 §6a.1: "Mode = Map + RulesetOverlay; Queue = Mode + PickProtocol + Pool + Stakes")*. Code branches on `kind`, `pick` and `end.kind`, never on an id.

## 2. The three modes as rules layers

| | **RIFT** (Hourfall) | **BRIDGE** (Needlespan) | **FRAY** (Noonplate) |
|---|---|---|---|
| Seats | 2 teams × 5, roles on | 2 × 5, no roles | 10 teams × 1 (every seat its own team, colour = seat) |
| Pick | `draft` (queues override) | `random_bench` (the Lot) | `ffa_pick` (no duplicates, first lock wins) |
| Target length | 22–28 min | 14–20 min | 8–11 min |
| Start | level 1, 480 Gleam | level 3, 1,300 Gleam | level 6 (ultimate ready), 1,400 Gleam |
| Level cap · XP | 18 · table 240 → 1,520 (+80 per level, 14,960 total) | 18 · ×2 XP on 200 → 1,160 (+60) | 16 · same steps as Rift, 15 entries |
| Passive Gleam | 2.2/s from 0:30 | 3.4/s from 0:20 | 4/s from 0:00 |
| Waves | 0:30, every 30 s, level +1 every 90 s | 0:20, every 25 s, level +1 every 60 s | none |
| Structures · jungle | yes · yes | yes · no | no · no |
| Shop · recall · fountain | base · 7 s · 12 %/s | base or while dead · none · 8 %/s, in base only | the Lampwright cart(s) (`shops`) · none · none |
| Respawn | 6 s + 2.4/level, max 50; ×1.25 after 25:00 | 6 s + 1.5/level, max 32; ×1.2 after 14:00 | 4 s + 0.4/level, max 9 |
| Kill bounty | 280; assists share 50 %; streak +70 to 490; shutdown up to 490 | 250; 60 %; +50 to 350; 350 | 200; 50 %; +40 to 320; 320 |
| Surrender · sudden death | 12:00, 4 of 5 · 40:00 | 8:00, 4 of 5 · 20:00 | — · — |
| End | silence the Hourbell (`core`) | silence the Hourbell (`core`) | `last_standing_or_score`: 4 lives, first to 12 kills, else 11:00 |
| Item pool | `rift` | `bridge` | `fray` (the lighter loadout) |

Ability ranks are the same everywhere: a basic ability caps at rank 5, and the ultimate ranks up at levels 6, 11 and 16.

**RIFT calibration** *(r02 §3–6)*:

- *Gold.* Start gold is 480 (reference 500) and passive income is 2.2/s (reference about 2/s). A wave is 3 Shieldwicks (21 Gleam, 56 XP) and 3 Glimwicks (15, 30), worth 108 Gleam. A Greatwick (50, 90) joins every third wave, so perfect farm is about 250 Gleam a minute.
- *XP.* A solo road reaches level 6 at about 4:30 to 5:00, and the shared duo road at about 7:00 to 8:00. That is slightly faster than the reference, to fit a 25-minute target.
- *Respawn.* Death timers run 6 s at level 1 to 47 s at level 18, and reach about 58 s after 25:00. The reference is 10 s to 52.5 s, rising to 78.75 s at 55:00. Ours are shorter on purpose: a browser player who waits a minute leaves.
- *Kills.* A kill pays 280 and the assist pool 140 (reference 300 and 150). Shutdowns are capped at 490 with no carry-over.
- *Sudden death.* Sudden death at 40:00 is a backstop. It removes structure protection and makes respawns ×1.5.
- *Tuning.* `tuning` tightens the assist window to 9 s and XP share to 15 m, and sets fighter-kill XP to 0.55 of a level step. That keeps one early kill from swinging lanes.

**BRIDGE** is the "every second is a fight" layer *(r03 §2.1–2.2)*.

- *One road.* The map's lane id is **`road_span`** (display "Span Road"), from the Dawn Arch to the Lamp Gate across the Snap.
- *No recall.* Health becomes a resource spent across fights. Sustain comes from **Mending Sunmotes** on the span (WORLD: Sunmotes fall in FRAY and BRIDGE).
- *Shopping.* You shop at the base circle or while dead (`base_or_dead`), so dying is partly a tempo tool.
- *Fountain.* It heals only inside the base circle, at 8 %/s, which is a reason not to walk home.
- *XP.* XP is doubled on a cheaper table because five fighters share one wave inside the 18 m share range. A Bridge fighter reaches about level 14–16 by 17:00.
- *Waves.* Faster waves (every 25 s) and 60 s minion upgrades keep the lane pushing.
- *End.* Sudden death at 20:00 ends stalemates.
- *Not adopted.* The reference mode also cuts long-range damage and heals mode-wide *(r03 §2.1)*. `RulesParams` has no such knob, and we don't fake one per fighter. If playtests show poke dominating, that is a SIM request (`tuning.rangedDamageMult`), not a content hack.

**FRAY** is a score race with lives, the second option in *r03 §4a.11*. The paired-rounds model needs a round system the sim doesn't have.

- *Format.* There are 10 seats, each its own team (`teams 10, perTeam 1`), as `session/setup.ts` `isFfaMode` and the fixtures expect.
- *Colours.* `playerColors` are the bible's ten seat colours in seat order: Crimson, Olive, Lime, Green, Cyan, Blue, Indigo, Violet, Plum and Rose.
- *Start.* Everyone starts at level 6 with the ultimate ready and 1,400 Gleam.
- *XP.* XP comes only from kills (`killXpFraction` 0.9 of the victim's level step, split between the killer and assisters). There are no waves or camps.

## 3. Queues

| id | name | mode · kind | pick | bans | timers (ban/pick/finalize) | bots | party | unlock |
|---|---|---|---|---|---|---|---|---|
| `rift_quick` | Quick | rift · quick | `role_preset` | 0 | —/15/6 | all open, adept | 5 | 1 |
| `rift_standard` | Draft | rift · standard | draft | 1 per team | 20/20/15 | all open, adept | 5 | 3 |
| `rift_ranked` | Ranked | rift · ranked | draft | 2 per team | 20/20/15 | all open, `by_rating` | 2 | 20 |
| `rift_coop` | Co-op vs bots | rift · coop | blind | 0 | —/30/10 | opponents only, novice | 5 | 1 |
| `bridge_standard` | Standard | bridge · standard | (mode) the Lot | 0 | Lot window 25 / finalize 10; bench 2, 1 reroll | all open, adept | 5 | 1 |
| `fray_standard` | Standard | fray · standard | (mode) `ffa_pick` | 0 | —/25/10 | all open, adept | 1 | 1 |
| `custom` | Custom game | any (host picks) · custom | the mode's | 1 per team | 20/20/15; bench 2, 1 reroll | host sets per seat | 10 | 1 |
| `practice` | Practice | rift · practice | preset or solo blind | 0 | —/30/5 | none | 1 | 1 |

**Quick, the faster queue** *(r01 §2.5, the reference's pre-pick fast queue, is the calibration)*:

- *Pick.* You choose your role and fighter before you queue, so there is no draft and no dodge.
- *Start.* You start at level 3 with 1,250 Gleam (the reference uses level 3 and 1,400).
- *Economy.* Passive income is 2.6/s, and gold and XP are ×1.15.
- *Waves.* The first wave comes at 0:20, then every 25 s. Wicks upgrade every 75 s, and Brightwicks start at 11:00.
- *Logistics.* Recall takes 5 s. Respawns are 5 s + 2/level, max 38, ×1.2 after 16:00.
- *Ending.* Surrender opens at 9:00. Sudden death comes at 23:00, with a gentler ×1.3 respawn multiplier.

The reference moved its sudden death to about 25:00 and caps games at about 36 min, a shape marked [conflicting] in r01. Ours lands matches at about 18 min, under r01 §6a.3's browser target of 15–25 min.

**Grants** are in Candles, the only `earnedOnly` currency. The table is in §8.

## 4. Draft protocol (RIFT)

The session's draft host implements this; the timers are data *(r03 §1.2, §4a.3, §4a.5)*.

1. **Before queuing:** choose a primary and a secondary role from the five positions in `roles.json` (Shadehold, Grovehunter, Dialcross, Shaftlight, Lampglass).
2. **Ban phase (20 s, simultaneous and hidden).** Allies see each other's bans and enemies don't. Bans reveal together. You cannot ban a fighter an ally is hovering. An empty slot bans its seat's hover if that is valid, otherwise nothing.
3. **Picks, snaking 1-2-2-2-2-1, 20 s per turn.** Hovers are visible to allies, and there are no duplicates in the match. On timeout the seat locks its hover, or a random valid fighter.
4. **Finalize (15 s):** skin (owned only), loadout, and trades between locked teammates.

The full Draft takes 20 + 6 × 20 + 15 = **155 s**. The reference takes about 260 s *(r03 §1.2.9)*, and r03 §4a.3's browser budget was about 140 s for 3v3.

**Bans versus roster** *(r03 §1.6: C = 2T + B)*. With 16 launch fighters:

- Draft uses 1 ban per team, so C = 12 and the last picker still has at least 4 fighters.
- Ranked uses 2 bans per team, so C = 14 and the last picker has at least 2. That margin is thin on purpose: ranked is where bans matter.

All fighters are free to play in this slice, because the profile has no fighter ownership, so no ownership gate is needed. **Raise `bansPerTeam` in data as the roster grows.** The comfortable roster is R ≥ 2C, which means 24 fighters for 1 ban and 28 for 2.

**Dodges.** Leaving a matchmade draft is a dodge. The session locks re-queueing for 5 s × 2^(n−1), capped at 60 s. Recommendation to SESSION: when ranked opens to real matchmaking, move to the reference's three tiers that decay over time *(r01 §3.3)*.

## 5. BRIDGE: the Lot (bench trade)

The fiction: the gorge-keepers send fighters across by lot, never by choice. The rules come from `queues.bridge_standard`, and the session's `random_bench` protocol implements them.

1. **The draw.** Each seat gets one random fighter. Each team gets a shared **Lot** (bench) of **2** more fighters. While the pool lasts, there are no duplicates in the match: 10 + 4 = 14 of 16 fighters are dealt and 2 stay in the pool.
2. **The Lot window (25 s).** Any seat may do either of the following:
   - **Swap** with a fighter on the Lot. Your old fighter takes that spot, so teammates can pass fighters around through the bench.
   - **Draw again** once (`rerolls: 1`). You get a new random fighter from the pool, and your old one joins the Lot. The Lot keeps its 2 newest fighters, and the oldest returns to the pool, so the pool never runs dry.
3. **Finalize (10 s):** skin and loadout, plus direct trades between locked teammates. A trade is a request; the other seat accepts. Bots accept at once.

**Why.** Every player sees at least 4 fighters: their draw, the 2 on the Lot, and one redraw, plus whatever teammates release. The reference replaced unlimited rerolls for the same reason: a guaranteed floor of choices with a ceiling *(r03 §0.6, §2.1)*.

Our mechanism is our own. There are no cards, no keep-one-of-two and no rare third card. Instead there is one shared Lot that the team trades through, and one personal redraw. Bench size and rerolls are data.

Possible later rule: a constrained Lot, guaranteeing a Plinth or Breaker and a Tender across each team's draw plus Lot *(r03 §4a.10)*. That is session code, not content.

## 6. FRAY: lives, score, placement, catch-up

- **Lives and the end.**
  - *Lives.* Every fighter starts with 4 lives; a death costs one.
  - *Elimination.* At 0 lives you are out and placed in reverse elimination order. Seats out on the same tick are ranked by score, then by damage to fighters.
  - *How it ends.* The match ends when one seat is left, when someone reaches **12 kills** (the dial's twelve hours), or at **11:00**. In the last two cases the seats still in are ranked by score, then damage. These are the sim's `last_standing_or_score` semantics.

  At about one kill per minute for a strong player, the 12-kill race usually closes between 8 and 11 minutes. A hard 11:00 cap matches the reference's 10-minute score race *(r03 §3.2)*.
- **Respawn.** You return after 4 s + 0.4 per level (6 s at level 6, capped at 9 s), at the hour-mark farthest from living enemies (`sim/units/fighters.ts`). Short waits keep a third-partied player in the fight *(r03 §3.5.2)*.
- **Catch-up, all as data:**
  1. *Leader bounty.* A kill pays 200 + min(320, 40 × (victim's streak − 1)). A leader on a 5-kill streak is worth 360, and one on a 9-kill streak is worth 520. This is the confirmed team-mode bounty idea moved to FFA: the leader is worth more *(r03 §3.5.3)*.
  2. *Leader XP and respawn.* Kill XP is 0.9 of the *victim's* level step, so killing the leveled-up leader pays the most XP. The leader's own respawn is the longest because it scales with level. That is our version of the reference's leader respawn penalty *(r03 §3.2)*, with no special code.
  3. *Credit sharing.* The 8 s assist window and 50 % assist share take the reward out of stealing a last hit *(r03 §3.5.5)*.
  4. *Sunmotes on fixed timers.* These pull fights to known places at known moments *(r03 §3.5.6)*. A Gleam Sunmote pays a flat 120, which is a bigger share of a trailing player's income. See §9.6 for placement.
  5. *A shared Lampwright.* There is no base to retreat to. Shopping means walking to the cart on the open plate, so the leader shops under the same threat as everyone else *(r03 §3.5.7)*.
- **Placement scoring** is steep at the top with a flat tail, and the top half is positive *(r03 §3.4, §4a.12)*:
  - `placementPoints` 10/8/6/4/2/0/0/0/0/0 feed the Hour Board season tally. The sim does not read them; SESSION/UI keep the tally.
  - `grants.placement` adds 50/35/25/15/10 Candles for 1st to 5th on top of the base grant. 6th to 10th never lose anything.

## 7. Ranked, co-op, custom, practice

- **Ranked** *(r08 §3)*:
  - *Rating.* `rift_ranked` uses Glicko-2 on `rift_rating`, starting at 1500 with RD 350 and volatility 0.06 (τ 0.5). Each match is one rating period, against a composite opponent (mean rating, RMS RD); that is the session's model. We accept r08's caveat that Glicko-2 prefers periods of 10–15 games, because the high starting RD makes the first matches move fast, which doubles as the placement system *(r08 §3.4)*.
  - *Placements.* A new rating is **provisional for 5 matches** and shows no tier, matching the reference's five placement games *(r08 §3.1)*.
  - *Party and bots.* Parties are limited to 2. Bots use `by_rating`: below 1350 novice, below 1650 adept, else veteran.
  - *Gate.* Ranked opens at account level 20, which takes 6,175 account XP, or about 25 matches.
- **Tiers** (`ranks.json`) follow the bible's climb of the sun, with the bible's colours and emblems at `assets/ui/icons/ranks/<id>.svg`. A rating takes the highest tier whose `minRating` it reaches. For a population with a standard deviation of 250 around 1500, the shares work out like this:

  | Tier | minRating | share |
  |---|---|---|
  | Lamplit | 0 | ≈ 10 % |
  | Greylight | 1175 | ≈ 21 % |
  | Rosewake | 1375 | ≈ 23 % |
  | Clearmorn | 1525 | ≈ 22 % |
  | Highsun | 1675 | ≈ 15 % |
  | Noonward | 1825 | ≈ 7 % |
  | Unshadowed | 2000 | ≈ 2 % |

  That is a bell with a thin top, like the reference ladder's distribution *(r08 §3.1)*. A new player sits at 1500, the top of Rosewake: middle-low, with room to climb. There are no divisions; the UI shows the rating's progress to the next threshold.

  Recommendations to SESSION:
  - Add inactivity decay as RD growth only, never a visible point loss below Highsun *(r08 §7a.3)*.
  - Reset the ladder once a year by raising RD, not by moving the rating *(r08 §7a.2)*.
- **Co-op vs bots** (`rift_coop`):
  - *Format.* Your team against five novice bots, with a blind pick and 30 s to choose.
  - *Bots.* Difficulty changes reaction time, aim, last-hitting and decisions, never stats (CONTRACT §5.7). This is the onboarding scaffold *(r08 §4.1, §7a.9)*.
  - *Grants.* Humans earn about 6 Candles a minute, below the PvP queues, so co-op is a classroom, not a farm. Bots never earn.
- **Custom game** (`custom`):
  - *Setup.* The host picks any mode and map, then sets each seat to you, a bot (with a difficulty and optionally a fixed fighter) or open.
  - *Rules.* Optional `rulesOverride` values are sanitized against the mode's rules. Picks use the mode's own protocol, with the queue's timers: 1 ban per team in draft, and a Lot of 2 with 1 redraw for Bridge.
  - *Stakes.* Time scale can run 0–16. There are no rewards and no rating *(r08 §4.2, §7a.10)*.
- **Practice** (`practice`) is a solo seat on Hourfall, with no queue and no stakes *(r08 §4.3, §7a.8)*:
  - *Setup switches:* `startLevel`, `noCooldowns`, `infiniteGold` (at least 50,000 kept) and up to 20 `dummies`.
  - *Commands:* +5,000 Gleam, +1 level, reset or toggle cooldowns, spawn a training dummy 4 m ahead, revive, and reset the match. Time scale runs 0–16.
  - *The dummy* is the **Sparring Post**: 6,000 hp, 30 armor and resist, never attacks, heals to full 4 s after the last hit. It is kind `minion` (the sim's dummy convention), so abilities with a `minionMult` show their wave-clear numbers on it. The UI should say so in the dummy tooltip.
  - *Skin try-on.* Skins can never change stats, so practice is also a safe place to try on a skin before buying it. That is a UI/SESSION follow-up *(r08 §4.3)*.

## 8. Economy

**Currencies.**

- **Candles** are the account currency, earned only by play (`earnedOnly: true`). They buy standard and deluxe skins, and fighter unlocks if a later roster gates fighters.
- **Prisms** are the bought currency for the top skin tier.

There is no paid randomness at all: no chests, no gacha. Free rewards, once shipped, are never quietly removed *(r08 §7a.5)*.

**Grant formula** (SESSION `grants.ts`): `min(cap, win|loss + perMinute × whole minutes)`, plus the Fray placement bonus.

- *First win of the UTC day:* +`grants.win` Candles and +`grants.xpWin` account XP, once a day. The reference dropped its version in 2025 *(r08 §1.1)*; we keep a small one because a browser player's session is short.
- *Account level:* level L to L+1 costs 100 + 25 × (L − 1) XP.
- *No earnings:* practice, custom and bots earn nothing, and leaving a match books a loss with no Candles or XP.

| queue | win | loss | +/min | cap | XP win/loss | typical length | per match (win / loss) | Candles per minute |
|---|---|---|---|---|---|---|---|---|
| rift_standard | 120 | 80 | 4 | 260 | 260/220 | 25 min | 220 / 180 | 8.0 |
| rift_ranked | 130 | 85 | 4 | 270 | 270/230 | 25 min | 230 / 185 | 8.3 |
| rift_quick | 100 | 70 | 4 | 200 | 200/170 | 18 min | 172 / 142 | 8.7 |
| rift_coop | 80 | 60 | 3 | 170 | 210/180 | 22 min | 146 / 126 | 6.2 |
| bridge_standard | 90 | 60 | 4 | 180 | 190/160 | 17 min | 158 / 128 | 8.4 |
| fray_standard | 50 | 40 | 3.5 | 90 | 130/110 | 10 min | 135 (1st) … 85 (5th) … 75 (6th–10th); average 90 | 9.0 |

PvP queues pay the same rate, about **8–9 Candles a minute**. No queue is the efficient farm, so players pick the mode they enjoy. Ranked pays slightly more for the stakes, and co-op slightly less.

**Store prices** (for whoever writes `store.json`). The prices scale with production scope, the middle tier is the default release, and the reference's ladder serves as the shape only *(r08 §2.1, §7a.6)*.

| skin tier | price | how long |
|---|---|---|
| `base` | free (`starterOwnership`) | — |
| `standard` (new model, textures, some VFX) | **900 Candles** | 4.5 Draft matches (3.9 with the first win of the day), 5.7 Quick, 6.3 Bridge, or about 1 h 50 min of any PvP queue |
| `deluxe` (new model, animations, VFX, sounds) | **2,250 Candles** | about 11 Draft matches |
| `legend` (full reimagining) | **1,350 Prisms**, Prisms only | — |

The 1,350 Prisms matches WORLD §5's purchase string.

**Ownership and stats.**

- *Records.* Every wallet change is an append-only `LedgerEntry`, and every owned skin is an `OwnershipRecord` (CONTRACT §8). A purchase checks the offer window, that the skin is not already owned, and funds, then writes ledger, ownership and persist in that order.
- *Equipping.* `equipSkin` accepts owned skins only.
- *Cosmetics never change stats.* `SkinDef` is `.strict()` with no stat keys, and `probe_sim_skin_neutral` requires identical digests across skins. A skin's `vfxTint` recolours its presentation only. The readability colours (ally, enemy, seat) always win over a skin.

## 9. Units

Wicks level up with wave time: level = 1 + floor(wave time / `upgradeEvery`), and growth applies. Camps, structures and pickups always spawn at level 1, so their stats are written for when they matter.

**Art paths.** Models are at `assets/units/<id>.glb`, icons at `assets/units/<id>_icon.png`, and unit ability icons at `assets/ui/icons/abilities/<ability>.svg`. Every unit ability sets `telegraph: "everyone"`, and its area lands 0.5–1.6 s after the wind-up, so a monster's big hit can always be read and walked out of.

### 9.1 Wicks (lane minions)

| id | role | hp (+/lvl) | ad (+/lvl) | armor/resist | range | speed | Gleam / XP | behavior |
|---|---|---|---|---|---|---|---|---|
| `shieldwick` Shieldwick | melee | 460 (+22) | 13 (+0.8), 1.1 attacks/s | 0/0 (+1.5/+1) | 1.4 | 3.25 | 21 / 56 | aggro 7, chase 10, help 9 |
| `glimwick` Glimwick | ranged (`lib_bolt_lumen`) | 290 (+12) | 22 (+1.4), 0.7/s | 0/0 | 5 | 3.25 | 15 / 30 | aggro 8 |
| `greatwick` Greatwick | siege, every 3rd wave (`lib_lob`) | 880 (+40) | 38 (+2) | 15/0 | 6.5 | 3.2 | 50 / 90 | priority: fighterAttacker, **structure**, minion…; `damageMult.structure` 2 |
| `brightwick` Brightwick | late heavy, every 2nd wave from 15:00 (12:00 Bridge, 11:00 Quick) | 1,200 (+45) | 45 (+2.2) | 30/30 | 1.8 | 3.3 | 70 / 110 | `damageMult` structure 1.5, minion 1.25 |

Siege density rises in steps: a Greatwick every third wave, then a Brightwick every second wave on top of it *(r02 §4: "escalate siege density in about three steps")*.

**The empowered Wick is a team buff, not a unit swap.** The sim can't spawn a different unit per road when a gate falls. Instead, breaking an enemy Lantern grants **Lanternwake** (§10): every one of your Wicks on every road gets +120 hp, +10 ad and +10 armor and resist for 4:00, which is exactly how long the Lantern takes to relight. In lore terms: while their Lantern is dark, your Wicks burn brighter.

### 9.2 Structures and the requires chain

| id | hp | attack | armor/resist | Gleam to the killer / to each seat on the team | notes |
|---|---|---|---|---|---|
| `needle_outer` Outer Needle | 3,200 | 150 ad, 0.83/s, 7.5 m "shadow ring" | 40/40 | 120 / 80 | ramp +35 %/hit to +105 %, ×1.4 vs Wicks and summons |
| `needle_inner` Inner Needle | 3,600 | 170 ad | 50/50 | 140 / 100 | same ramp |
| `lantern` Lantern | 3,000 | none | 25/25 | 50 / 60 | `onTakedownTeamBuff: lanternwake`; **relights** (map `respawn`) |
| `needle_bell` Bell Needle | 2,800 | 190 ad, 0.9/s | 60/60 | 50 / 50 | default ramp +40 % to +120 % |
| `hourbell` Hourbell | 4,500, regenerates 6 hp/s | none | 20/20 | — | `end.coreStructure` |

**Counts and `requires` for the MAPS lane.**

*Rift, per team (12 structures).* Each of `road_high`, `road_seat` and `road_low` gets:

- an Outer Needle;
- an Inner Needle (requires that road's Outer Needle);
- a Lantern (requires that road's Inner Needle; `respawn: 240`).

Then **2 Bell Needles** flank the Hourbell at the base, where the three roads converge. Both require the **`road_seat` Lantern**. Finally the **Hourbell** requires both Bell Needles.

In fiction terms, the Seat road runs straight to the bell, and its Lantern holds the bell's light.

- *Why not "any Lantern".* The sim's `requires` means "protected while ANY listed structure stands", so "any one Lantern opens the base" can't be written.
- *How the rule plays.* Side Lanterns still matter. They grant Lanternwake, which pushes every road, including the centre one. The final siege always comes through the centre, which makes the end game legible for players and for bots.
- *Relighting.* A relit centre Lantern protects surviving Bell Needles again, a built-in comeback. In sudden death nothing is protected.
- *If design wants any road to open the base:* SIM would add an additive `requiresAny` on map structures, and the Bell Needles would `requiresAny` all three Lanterns.

*Bridge, per team (5 structures)* on `road_span`, a slimmer chain for a shorter mode:

- Outer Needle;
- Inner Needle;
- Lantern (`respawn: 240`);
- **1** Bell Needle (requires the Lantern);
- Hourbell (requires the Bell Needle).

*Fray:* no structures (`rules.structures` false).

Calibration: three tiers per road and a respawning gate behind the last one *(r02 §7.1, §7.4: inhibitors respawn after 5:00, and gates matter more than towers)*. Ours relights in 4:00 and grants Lanternwake instead of super minions.

### 9.3 The Dialwood (jungle camps)

Monsters have leash 8 m (9 m for the buff camps) and heal 30 %/s of max hp while resetting. A camp respawns `respawn` s after its LAST unit dies. Every big monster has one telegraphed ability.

| camp | units | Gleam / XP (whole camp) | ability | team buff |
|---|---|---|---|---|
| **Glasshorn** (buff) | 1 Glasshorn: 1,700 hp, 55 ad | 90 / 150 | *Glass Bellow*: 70° cone after 0.6 s, 45 magic and a 25 % slow | **Clearglass** |
| **Resinback** (buff) | 1 Resinback: 1,800 hp, 62 ad | 90 / 150 | *Resin Spit*: a 2 m pool lands after 0.5 s and burns 12 magic per 0.5 s for 3 s | **Resinburn** |
| **Gloamoths** | 1 Gloamoth (900 hp, ranged magic) + 3 Little Gloamoths (300 hp) | 81 / 136 | — (a small swarm: kill the little ones with area damage) | — |
| **Stilltusks** | 1 Stilltusk (1,300 hp) + 2 Young Stilltusks (480 hp) | 96 / 150 | *Still Stamp*: 2.5 m stamp after 0.7 s, 40 physical and a 30 % slow | — |
| **Strays** | 1 Stray Numeral (1,500 hp, 35/35 armor and resist) + 2 Stray Ticks (380 hp) | 100 / 150 | *Topple*: 4 × 2 m line after 0.9 s, 70 physical and a 0.5 s stun | — |

Recommended per team, each mirrored across the noon line (a reflection, never a rotation):

- *North quadrant* (Elevenmark for Aubade, Twomark for Serenade): Glasshorn, Gloamoths and Strays. Glasshorn sits near the Seat road, because its Light and cooldown boon serves the Dialcross.
- *South quadrant* (Sevenmark, Fourmark): Resinback, Stilltusks and a second Strays camp. Resinback sits near the duo road and Sunsplinter, because its burn-on-hit boon serves the Shaftlight and the Grovehunter.

Timers: every camp first spawns at **1:00**. Regular camps respawn after **2:30** and buff camps after **4:30** *(r02 §9: 0:55, 2:15, about 5:00)*. A full first clear of one side (2 buffs + 4 camps, about 886 XP) ends just short of level 4 at about 3:30, as in the reference *(r02 §9)*.

### 9.4 Objectives

Both objective pits sit on the Noonline (WORLD §3). **Longshade**'s pit is in the Standing Shadow between the North and Mid roads. **Sunsplinter**'s pit is on the Fallen Shaft between the Mid and South roads. Both camps are `objective: true`.

**Sunsplinter** is a repeatable construct of the needle's broken tip.

- *Stats:* 4,200 hp, 30/30 armor and resist, a 6 m ranged magic shard volley, leash 12 m.
- *Bounty:* 100 Gleam to the killer, 75 to each seat on the team, 250 XP. It grants **Splinters**.
- *Kit, three telegraphed threats that ask for spacing:*
  - *Shard Rain*: a 2.5 m circle under a target lands after 1.0 s for 110 magic. Keep moving.
  - *Noon Glare*: a 1.2 s charge, then a **ring** from 3.5 m to 7 m, 100 magic and a 30 % slow. Stand close or stand clear: the safe spot flips the backline's instinct.
  - *Splinter Spray*: a 60° cone after 0.9 s, 130 physical and a 1.5 m knockback. It punishes the frontline that hugs it during Noon Glare.
- *Timing:* first spawn **6:00**, respawn **4:30** after a kill *(r02 §8.1: the repeating bottom-side chain at 5:00 / 5:00)*. With 5 fighters at about level 5–6, it dies in about 20 s.

**Longshade** is the late siege beast where the shadow ends.

- *Stats:* 14,000 hp, 60/50 armor and resist, 150 melee ad, leash 13 m.
- *Bounty:* 100 Gleam to the killer, 200 to each seat on the team, 500 XP. It grants **the Long Shade**.
- *Kit:*
  - *Lengthening* (passive): every 8 s it spends taking damage, +15 ad and +5 armor for 20 s, stacking 8 times. A slow team fights a 270-ad monster: commit or leave.
  - *Shadow Sweep*: a 120° cone after 1.0 s, 200 physical and a 2.5 m knockback. It scatters the melee ring.
  - *Pooled Shade*: a 3.5 m zone up to 10 m away darkens after 1.0 s, then deals 40 magic every 0.5 s with a 35 % slow for 4 s. It denies the backline's spot.
  - *Full Length*: it rears for 1.6 s, then crashes down for 320 magic and a 1 s stun within 5 m. The big read: run while it rises.
- *Timing:* first spawn **16:00**, respawn **6:00** *(r02 §8.1: the reference's late boss at 20:00 / 6:00; ours comes earlier for a 25-minute match)*. A level-13 team kills it in about 20–25 s.

The sim spawns camps at level 1 and never scales them with time. Monster numbers are therefore set for their first spawn, and a late Sunsplinter is easy. That is acceptable for a repeatable objective. If playtests want scaling, SIM would add `camp.levelFrom: 'lobbyAverage'` *(r02 §9: camps level with the lobby's average)*.

### 9.5 Bridge pickups

There are **Mending Sunmotes** (`sunmote_mend`), the same unit as in Fray, per WORLD's glossary ("Sunmotes: FRAY, BRIDGE").

- *Grant:* heal 120 + 12 % of max hp, and restore 60 + 12 % of the max pool resource. The grant uses `heal` and `resource` ops.
- *Placement:* 4 on the span, 2 per half: one on the north edge by each team's Inner Needle (the outer pair, 34 m from the Snap) and one on the south edge at the Snap's mouth (the inner pair, 12.5 m from the Snap). Each half is the mirror of the other.
- *Timers:* outer pair first spawns at **1:20** and inner pair at **2:00**, then each respawns **80 s** after being taken *(r03 §2.1: 1:45, 2:30, then 90 s)*.

These are the mode's main sustain: no recall, and the fountain heals only in base.

### 9.6 Fray Sunmotes and the cart

| id | grant | count and place | first spawn · respawn |
|---|---|---|---|
| `sunmote_mend` Mending Sunmote | heal 120 + 12 % max hp, resource 60 + 12 % | 5, in every other gap between hour-marks, 15 m from the centre | 0:30 · 40 s |
| `sunmote_quick` Quick Sunmote | `haste` 30 % for 4 s and +20 % attack speed for 4 s | 5, in the other five gaps, 15 m from the centre | 0:45 · 80 s |
| `sunmote_gleam` Gleam Sunmote | `behavior.gold` 120 Gleam (× goldMult) | 2, either side of the centre (7 m) | 1:00 · 60 s |

Mending and Quick Sunmotes alternate around the ring, so every hour-mark has exactly one of each beside it, 12.6 m away. The maps pass replaced the earlier "3 Quick at 120°", which left one seat a Quick Sunmote 2.5 m from its mark and another one 25 m away. Five Quick Sunmotes on an 80 s respawn give about the same haste per minute as three on 50 s. Placement and the probe numbers are in `_design/maps/map_fray_landmarks.md`.

The **Lampwright cart** is one `MapDef.shops` circle at the plate's centre. The cart itself is solid, a ten-sided 1.3 m wall that doubles as a pillar to fight round, so the shop circle is 4 m and leaves a 2 m ring of floor to shop from. `shopAccess: shops` means you shop alive and in the open. Fray has no fountain and no base heal, so Mending Sunmotes are the only healing outside kits and items.

### 9.7 Practice dummy and ward

- **`sparring_post` Sparring Post** (`behavior.dummy: true`): the training dummy. It is the first unit with `dummy` in catalog order, so keep it the only one.
- **`hooded_lamp` Hooded Lamp** (kind `ward`, `invisible: true`): 3 hp, 9 m sight, 20 Gleam for clearing it. It is a shared ward unit for whichever item, spell or Lampglass kit places vision through `summon`.

## 10. Team buffs

| id | from | duration | fighters | Wicks |
|---|---|---|---|---|
| **Clearglass** | Glasshorn | 90 s | +10 ability haste, +1.5 resource regeneration per second | — |
| **Resinburn** | Resinback | 90 s | basic attacks on fighters and monsters burn for 3 × (4 + 2 per level) magic over 2 s and slow 10 % for 1 s, once every 3 s per target | — |
| **Splinters** | Sunsplinter | 4:00, renewed by the next take | +5 % armor and resist penetration, +5 ability haste | — |
| **The Long Shade** | Longshade | 2:30 | +25 ad, +40 ap, +10 % tenacity | +400 hp, +30 ad, +25 armor and resist, +10 % move speed |
| **Lanternwake** | an enemy Lantern | 4:00 (= the Lantern's relight) | — | +120 hp, +10 ad, +10 armor and resist |

**Splinters is designed to stack.** Each Sunsplinter your team takes adds one Splinter, up to **3**, and every take renews the 4:00 timer. Each Splinter gives +5 % armor and resist penetration and +5 ability haste. At 3 Splinters that is +15 % penetration and +15 haste, which is a reason to contest every Sunsplinter rather than trade it.

Today's sim (`core.ts addTeamBuff`) refreshes a held buff instead of stacking it, so the content ships the one-Splinter values, and its text says "renews". The HUD can already count takes, because `TeamView.objectives` gets one `splinters` entry per take.

**Request:**

- LEAD: additive `TeamBuffDef.maxStacks`.
- SIM: `addTeamBuff` adds a stack up to the max, multiplies `stats` and `minionStats` by stacks, and renews the duration.

Then content adds `"maxStacks": 3` and updates the text.

Calibration *(r02 §8.1)*: the repeating objective gives a stacking team boon, and the late objective gives a strong, timed boon that also lifts the minions. The effects, numbers and names are ours.

## 11. Notes for other lanes

- **MAPS:** done. `content/maps/map_rift.json`, `map_bridge.json` and `map_fray.json` carry the chains of §9.2, the camps and timers of §9.3–9.4 and the pickups of §9.5–9.6.
  - Lane ids: `road_high`, `road_seat` and `road_low` for Rift, and **`road_span`** for Bridge.
  - Fray has 10 `spawns` (the hour-marks, in seat order) and one central `shops` circle.
  - `end.coreStructure` is the unit id `hourbell`, so every placement of it is a core.
  - Generator: `_design/tools/map_gen.py`. Previews and art briefs: `_design/maps/`. Probe: `_harness/probe_maps.ts`.
- **ITEMS / SETUP:** pools `rift`, `bridge` and `fray`.
  - Fray is a lighter loadout: 1,400 starting Gleam plus about 4,000 earned in 10 minutes, so it needs finished items under about 2,500 and no wards.
  - Bridge's pool should drop recall-dependent items.
- **STORE:** prices in §8; base skins in `starterOwnership`.
- **SESSION / UI:**
  - Hour Board season tally from `modes.fray.rules.placementPoints`.
  - Show "Splinters ×N" from `TeamView.objectives`.
  - The dummy tooltip should mention that minion multipliers apply.
  - Escalating dodge tiers when ranked opens (§4).
- **SIM:** `TeamBuffDef.maxStacks` (§10), plus the optional `requiresAny` (§9.2), camp level scaling (§9.4) and a mode-wide ranged-damage knob for Bridge (§2). None of these blocks this content.
