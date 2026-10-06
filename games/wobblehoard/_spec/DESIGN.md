# WOBBLEHOARD: design decisions (collection, merge, trade, reveal)

Working title. This is the decision document that [`COLLECTION.md`](COLLECTION.md), [`MERGE.md`](MERGE.md), [`TRADE.md`](TRADE.md) and every implementer follow.
Where a module document deliberately refines a rule here, it says so with a numbered deviation (D-T, M, C) and this file carries a "Superseded" note
pointing at it (section 5.13 lists them all); the module document's rule is then the current one.
Slice 1 (poke, squish, pull, release one squishy) is built and runs in the app. The economy logic of section 5 (catalog, rarity, meter, drops, merge) is
built and tested as pure modules but **not wired into the app yet**; the server, the Hoard, merge and trade modules are specification only. The single
status table (built, wired, spec-only, with dates) is [`NEXT_STEPS.md`](NEXT_STEPS.md) section 1; the current build contract is [`CONTRACT.md`](CONTRACT.md).
Numbers marked **[sim]** come from **one saved run** of `_harness/sim_economy.ts`, the canonical run of section 5.0, and carry the sim section they come from
(for example **[sim K]**). The sim **imports the real game logic** (`src/data/catalog.ts`, `src/core/meter.ts`, `drops.ts`, `merge.ts`, `rarity.ts`) instead of
its own copies; `_harness/probe_economy.ts` checks the same rules independently. Player behaviour in that sim is **assumed**, not measured (section 5.12).

**Evidence grades used in this file.** **[O]** = I opened the page. **[S]** = the URL was returned by a web search whose result
summary states the claim; the page itself was NOT opened. **[G]** = general knowledge, unverified. Why so few [O]: during the research for
sections 3 and 4 (2026-10-02) the sandbox egress proxy refused every host tried through `WebFetch` and `curl` (`EGRESS_BLOCKED` / `403 CONNECT`)
except `developer.apple.com` and `github.com`. **The two reference clips were reviewed later, on 2026-10-05, from downloaded copies kept outside the
repo**; that review is [`REFERENCES.md`](REFERENCES.md), and section 2 below follows it.

---

## 1. Pitch and pillars

**WOBBLEHOARD** is a glossy, translucent jelly toy you actually touch. Poke it, squeeze it, pull it and let go; real touching
fills a **Squish meter**, and every full meter drops a **free capsule** holding one random squishy out of **50**, in six visible
rarities. Spare copies are not waste: **two of the same merge into one new random squishy**, and **trading** is how you get the
exact one you are missing.

| Pillar | What it means in practice |
|---|---|
| **Touch is the currency** | Capsules come from varied, real touching (about 3 to 4 minutes of play each), never from a shop, a timer wall or a purchase. |
| **Rarity you can see and feel** | Tier changes the object: material, glow, aura, sparkle, idle motion, sound. Not just a label. |
| **Merge is luck, trade is exact** | Merge gambles with spares. Trade swaps precisely what each side needs. Neither replaces the other. |
| **Free, calm, kid-safe** | No real money, no paid randomness, no free-text chat, no streak punishment, no strobing. |
| **Original everything** | Names, palette, sounds, UI and effects are ours (checklist, section 9). |

## 2. The two reference clips: ideas taken, versions ours

The owner pointed at two short clips on X. They were reviewed on 2026-10-05 from downloaded copies kept outside the repo (frame contact sheets and an
audio spectrogram). **[`REFERENCES.md`](REFERENCES.md) is the only place the clips are read** (beat by beat, with the reviewer's do-not-copy checklist);
this table maps its ideas onto the design and uses its labels: **clip A** = a translucent, glowing jellyfish tech demo (20 s, no audio); **clip B** = a
browser squishy shelf with slime trays, a settings panel and a paid blender (45.7 s, music and effects). Nothing visual or audible is copied (section 9).
Stage B items (B1 to B9) are scheduled in [`NEXT_STEPS.md`](NEXT_STEPS.md) section 4.

| Idea (clip, beat) | Our original version | Status |
|---|---|---|
| A shelf of glossy squishies you poke until they squash (B, "poke.") | The **Hoard**: a dark felt cabinet of lit plinths, one per species, a stack badge for spares. Poking a squishy on its plinth is the slice-1 interaction. | Poking: built. Hoard: spec (COLLECTION.md) |
| Many squishies tossed onto the shelf; they fall, collide, tumble and pile up (B, "mix and match.") | A **play mat with several squishies out at once**, **soft body-to-body contact**, and **pull past the limit to pick one up**, then toss it. (A first draft of this table, written from a description before the clips were seen, read this beat as a "mix-and-match row" and mapped it to the merge pad. That reading is withdrawn: merge answers the blender beat below.) | Stage B items B1 to B3 |
| Slime pull-and-pop with glitter and bubbles (B, "pull. pop.") | **Pull-and-let-go (snap)**: stretch, release, trapped-air bubbles and glitter inside the body (slice 1). It pays the meter. Tacky families also **string and snap** (B6). | Snap: built. Strands: stage B |
| A paid six-input blender that liquifies squishies into hybrids (B, "Premium: the Blender.") | **Free merge** of two of the same species (5.6) with the fold-into-a-ball ceremony. The input count in the clip is not a design number; a capped **Tidy-up** (bulk merge, up to 10 merges a day) is the only descendant (5.6). No paywall, no hybrids. | Rules: built (`core/merge.ts`). Module: spec (MERGE.md) |
| Settings: louder squish ("more squish."), volume, haptics, screen shake, gravity vs float (B) | Same settings, our labels and layout (`CONTRACT.md` section 8) plus **Calm effects** (section 6.6) and an optional **Extra squish** depth. | Built except Calm effects (planned) and Extra squish (B8) |
| A looping music bed (B, audio) | An original, generative, gentle ambient bed with its own volume, ducked under ceremonies. | Audio round 3 in progress; wiring B7 |
| A touch blooms light at the contact point (A, "Touch the light") | **Contact glow**, tinted by the core colour, on top of the pressure blush; obeys the flash budget (6.6). | Stage B item B5 |
| Pulled out 3 to 4 times its length like taffy, then springs back (A, "To the limit") | **Long pulls** for the stretchy families (Sticky Stretch, Slime Goo) to their `maxPull`; firm families resist. | Physics round 2, then B4 |
| Translucent jelly that returns exactly to shape (A, "The form remembers") | The slice-1 soft body (shape matching plus the memory arm of SQUISHY_SCIENCE 3.1). | Built |
| Cut into pieces that each stretch and then reconnect (A, "Each cut, another size" to "Everything reconnects") | **Not in v1**: the *Jelly Lab* stretch module (NEXT_STEPS section 5). | Stretch |
| Folds into a glowing ball, then springs back (A, "All the light in one ball") | The **merge ceremony** (section 6): two bodies converge, fold into one glowing ball, charge, spring open, reveal. Our own timing, colours and sound. | Render and audio: built (procedural fold fallback); physics drivers: round 2, in progress |
| Three colourways of one toy (A, "Aurora. Amber. Abyssal.") | **Open owner decision D-15** (NEXT_STEPS): optional rare colourway variants. Until decided: none in v1 (5.6). | Decision |
| Made to be touched (the owner's brief) | The meter pays for touching in *varied* ways and ignores mashing (5.4). | Logic built; not wired |

## 3. Research summary

### 3.1 Collecting and trading in similar games

| Game | How items are earned, found, unlocked | What makes trading meaningful (or absent) | Failures and lessons | Source |
|---|---|---|---|---|
| **Slime Rancher** | Feed slimes; a pure slime that eats another type's plort becomes a **largo** (two plorts per meal); a largo that eats a third type becomes hostile **Tarr**. Plorts sell at a market. | No player trading (single-player, **[G]**). The **plort market** has saturation: selling raises it, it decays 25% each midnight, price = base, saturation and two noise layers. | Combining with a risk is a strong hook. Market saturation is a clean anti-grind sink. We borrow *diminishing returns on repeating one action*. | **[S]** [Largo](https://slimerancher.fandom.com/wiki/Largo_Slimes), [Plort Market](https://slimerancher.fandom.com/wiki/Plort_Market_(Slime_Rancher_2)) |
| **Adopt Me!** | Eggs hatch pets; **4 Full Grown pets of one species fuse into a Neon, 4 Neons into a Mega Neon**. | Heavy player trading. A 3-question **Trade License** gates Legendary and Ultra-rare trades; 30-day trade history; unfair-trade warning; cross-trades and Robux trades are against the rules. | Scams ("trust trades", quick-switch) persist despite rules. Precedent for same-species merge (deterministic there). | **[S]** [official post](https://www.playadopt.me/news/trade-changes-and-scam-prevention-update), [guide](https://guidebros.com/game-guides/adopt-me/trade-safety-system-update), [Neon](https://adoptme.fandom.com/wiki/Neon_Pets) |
| **Neko Atsume** | Place food and toys; cats visit passively, even app closed; 40+ cats, 17 rare ones need specific items; silver and gold fish. | None needed (solo). | No fail state is calming; waiting is not tactile, so touch is our currency instead. | **[S]** [Wikipedia](https://en.wikipedia.org/wiki/Neko_Atsume), [GeekWire](https://www.geekwire.com/2016/app-of-the-week-tame-your-cat-craving-with-neko-atsume-aka-kitty-collector/) |
| **Pokemon GO** | Exploration, eggs, raids. | Trade needs friends, same place (or "Forever Friends" remotely), costs **Stardust** that falls with friendship level; limited special trades per day; Lucky trades. | Deliberate friction limits abuse and keeps scarcity. No free chat in a trade (**[G]**). | **[S]** [Help: trading](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/96-trading-pokemon/), [remote](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/5312-trading-remotely/), [Lucky](https://pokemongolive.com/post/luckypokemon-update/) |
| **Animal Crossing NH** | Real-time clock; daily events; Sunday turnip market (spoils after a week); villagers. | Villager and item swaps between friends (**[G]**). | Hard time gates invite time-travel workarounds. We use a daily *gift*, never a gate. | **[S]** [clock](https://www.playanimalcrossing.com/animal-crossing-clock/), [turnips](https://game8.co/games/Animal-Crossing-New-Horizons/archives/284591) |
| **Little Alchemy 2** | Start with 4 elements, combine **two at a time**; 720 items; hints. | None (solo). | "Combine two" is the simplest gesture to teach. Their results are deterministic; ours are random, so we need the preview. | **[S]** [wiki](https://little-alchemy.fandom.com/wiki/Little_Alchemy_2) |
| **Monster Rancher** | Combine two monsters; the primary parent passes more traits; same-species parents give (almost) that species; randomness in inherited moves; costs gold. | Not central. | Combination as a long-lived hook. | **[S]** [wiki](https://mymonsterrancher.fandom.com/wiki/Combining), [guide](https://gamefaqs.gamespot.com/ps/197977-monster-rancher-2/faqs/76372/fusion) |
| **Neopets** | Earn Neopoints, buy, auction; Trading Post offers can mix items and points. | Player-driven prices; information asymmetry (closed deals are not public). | Currency **inflation** when sources outrun sinks. We trade item-for-item with no currency, so no price to inflate or fake. | **[S]** [Irpan](https://www.alexirpan.com/2018/11/10/neopets-economy.html), [Neopian Times](https://www.neopets.com/ntimes/index.phtml?section=526352&week=516) |
| **Gacha / loot boxes** | Paid random pulls; "pity" guarantees (Genshin: hard pity at 90 pulls, 50/50 rule). | Often tradeable; that is what Belgium (2018) called gambling. | FTC fined Cognosphere **$20 million** (Jan 2025) over loot boxes sold to under-16s without parental consent and misleading odds. **Netherlands** Council of State overturned the EA fine (Mar 2022). **China** has required odds disclosure since 2017; **Japan** banned "kompu gacha" (collect a full set of random items to unlock a bonus) in 2012; **Brazil** bans loot boxes for minors (2025 law). Apple guideline 3.1.1 (opened, **[O]**): "must disclose the odds of receiving each type of item ... prior to purchase". Google Play and ESRB/PEGI labels follow. | **[O]** [Apple](https://developer.apple.com/app-store/review/guidelines/); **[S]** [pity](https://game8.co/games/Genshin-Impact/archives/305937), [FTC](https://www.ftc.gov/news-events/news/press-releases/2025/01/genshin-impact-game-developer-will-be-banned-selling-lootboxes-teens-under-16-without-parental), [Belgium/NL](https://www.pcgamesn.com/ea-loot-boxes-belgium), [2026 overview](https://blog.promise.legal/lootbox-regulation-2026-game-studios/), [Google](https://www.fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds), [China](https://kotaku.com/china-passes-law-forcing-games-with-loot-boxes-to-discl-1789828850), [Japan](https://www.lexology.com/library/detail.aspx?g=9207df10-a8a2-4f67-81c3-6a148a6100e2), [Brazil](https://cadeproject.org/updates/brazil-approves-first-law-to-protect-childrens-rights-online/), [labels](https://www.reedsmith.com/en/perspectives/2020/04/esrb-and-pegi-introduce-loot-box-warnings) |
| **Duplicates in card/box games** | Overwatch cut duplicate loot ("you cannot get owned items until you own all of that rarity", credits as compensation); Hearthstone **disenchants** spares into dust (crafting costs 4 to 8 times the yield). | Spares become a currency. | The owner chose "repeats allowed, no dupe protection". We make spares useful (merge, same-tier swaps) instead of hiding them. | **[S]** [Overwatch](https://www.pcgamesn.com/overwatch/overwatch-loot-box-duplicate-reduction), [Hearthstone](https://hearthstone.fandom.com/wiki/Crafting) |
| **Idle collector (Capybara Go)** | Idle gains with offline caps, companions with passive buffs, sessions from 90 s to 2 h. | None central. | Capped accrual works; we have no idle accrual because touch is the currency. | **[S]** [BlueStacks](https://www.bluestacks.com/blog/game-guides/capybara-go/cbg-beginners-guide-en.html), [progression](https://www.mobilegamereport.com/articles/capybara-go-progression-2026) |
| **Tamagotchi (1996)** | How well you care (care mistakes in the child and teen stages) decides the adult character. | None. | "How you play shapes what you get" is the ancestor of our *affinity* idea. We tested it (5.5). | **[S]** [characters](https://tamagotchi.fandom.com/wiki/Tamagotchi_(1996_Pet)/Character_list), [care guide](https://thaao.net/tama/p1/) |
| **Physical squishy and blind-box toys** | Squishmallows have a **six-tier rarity scale** with unit caps (Rare silver 75,000, Ultra Rare gold 50,000, Special 20,000, Select 5,000). Blind boxes use common, rare, chase and "secret" tiers; vendor blogs quote secret odds of 1 in 72 to 1 in 144 or worse. | Secondary markets exist for chase pieces (vendor blogs, weak evidence). | Collectors chase sets and secrets; tier is shown on a **tag**, which we replace with a visible material change. | **[S]** [Squishmallow tiers](https://squishmallowsquad.fandom.com/wiki/Rarity_Scale), [chase tiers](https://www.funshop.com/drops/limited-editions-chase-figures-and-rarity-tiers-across-major-blind-box-brands/), [secret odds, vendor blog](https://smartbuy.alibaba.com/popmart/what-are-the-odds-of-getting-the-secret-labubu) |
| **Pokemon TCG Pocket (trading)** | Packs. | Trading launched Jan 2025 needing **Trade Tokens** (burned from duplicate cards) and hourglasses; backlash; reworked 29 Jul 2025 to use an existing currency. | Friction meant to stop multi-account abuse also killed casual trading. | **[S]** [VGC](https://www.videogameschronicle.com/news/pokemon-tcg-pockets-trading-feature-is-changing-after-fan-backlash/), [GameSpot](https://www.gamespot.com/articles/one-of-pokemon-tcg-pockets-worst-features-will-be-revamped-july-29/1100-6533199/) |
| **Roblox (collectible trading)** | Limited items. | Premium required; trading and inventory must be enabled; under-13 accounts need a follow/friend link (devforum); chat for under-9 off by default. | Gating cuts scam surface; scams still happen. | **[S]** [help](https://en.help.roblox.com/hc/en-us/articles/203313310-Trading-on-Roblox), [devforum](https://devforum.roblox.com/t/can-13-players-trade-on-roblox-questions-on-trading/2432708), [chat](https://about.roblox.com/newsroom/2025/11/roblox-requires-age-checks-limits-minor-and-adult-chat) |

### 3.2 Safe-trading patterns

| Pattern | What we learned | Used here | Source |
|---|---|---|---|
| Steam trade hold | 15-day hold unless a mobile authenticator has been on for 7 days; friends of over a year get a 1-day hold. | A short **24 h receive lock** (kids, no 2FA) instead of days. | **[S]** [steamvaults](https://steamvaults.org/blog/why-steam-trade-hold-is-15-days), [forum](https://steamcommunity.com/discussions/forum/1/3279193518770589678/) |
| Pokemon GTS and Wonder Trade | Deposit a Pokemon and **request species and level** by menu; others search; Wonder Trade is a blind swap with **no communication**. | Searchable **wants/offers board built from species icons**, no text. | **[S]** [Newsweek](https://www.newsweek.com/pokemon-home-trading-gts-wonder-friend-trade-room-how-1487046), [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Trade) |
| Club Penguin Ultimate Safe Chat | Players pick phrases from a menu; filtered mode hides blocked lines from others. | **No free text at all**; fixed emotes. | **[S]** [wiki](https://www.clubpenguinwiki.info/wiki/Ultimate_Safe_Chat) |
| UK Children's Code (15 standards) | High-privacy defaults, profiling off, no nudge techniques, geolocation off. | Section 8. | **[S]** [ICO standards](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/code-standards/) |
| COPPA | Verifiable parental consent under 13; rule amended 22 Apr 2025 (retention limits, more data counted as personal). | No personal data collected by the game; consent is the portal's job (open question 1). | **[S]** [FTC FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [2025 rule](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data) |
| Duplication exploits | RuneScape's 2003 party-hat dupe made over two million copies and was never rolled back; Diablo 2 had several dupes. | Single-writer ledger, conservation check, locks, caps (section 8.3). | **[S]** [RuneScape](https://runescape.fandom.com/wiki/Duplication_glitch), [Diablo 2](https://gist.github.com/amtal/bf941bde443eefc7d4626fd439d7f480), [overview](https://en.wikipedia.org/wiki/Duping_(video_games)) |
| Atomic server-side moves | Make every item move one all-or-nothing transaction; never "add before remove"; cooldowns and locks close time windows. | `wh__trade_execute` (called by `wh_confirm_trade`) and `wh__commit_merge` (8.3). | **[S]** [bugnet](https://bugnet.io/blog/how-to-fix-inventory-item-duplication-bug), [gamedev.net](https://gamedev.net/forums/topic/260848-duping/) |
| Dark patterns, daily streaks | Streaks and timers exploit loss aversion and FOMO, worst for children. | No streak punishment, no countdown FOMO (8.4). | **[S]** [arXiv 2207.09928](https://arxiv.org/pdf/2207.09928) |
| Flashing content | WCAG 2.3.1: no more than 3 flashes in any second. 685 viewers were hospitalised after a 1997 broadcast with red/blue flashing. | Flash budget, Calm effects (6.6). | **[S]** [WCAG](https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html), [Porygon episode](https://en.wikipedia.org/wiki/Denn%C5%8D_Senshi_Porygon) |
| Birthday and coupon-collector maths | Expected draws to collect all n equally likely items = n times H(n) (50 items: about 225). | Calibrates every "first pair / first triple" number below. | **[S]** [Wikipedia](https://en.wikipedia.org/wiki/Coupon_collector%27s_problem) |

**In-repo facts read directly (no web):** the portal already has Supabase accounts (`supabase/migrations/0002_user_accounts.sql`, email sign-up), a
`friendships` table and a `find_users(query)` RPC that searches **by email or username** (`0003_achievements_friends_activity.sql`), and a
`postMessage` bridge where "the game never sees a token" (`games/blocktooth/src/net/portal.ts`). Trading reuses the bridge pattern and **must not** reuse `find_users`.

## 4. Options weighed

Score 0 (bad) to 3 (good). "Trade needed" = does the option make players *need* each other, not just allow it.

| Option | Trade **needed** | No paywall, no paid randomness | Fits a 3D **tactile** toy | Kid-safe | Exploit-resistant | Build cost (3 = cheap) | Sum /18 |
|---|---|---|---|---|---|---|---|
| Buy with soft currency | 0 (just buy it) | 2 | 1 | 2 | 2 | 2 | 9 |
| Explore a world to find them | 1 | 3 | 1 | 3 | 3 | 0 | 11 |
| Tasks and quests only | 0 | 3 | 1 | 3 | 3 | 2 | 12 |
| Passive collecting (Neko style) | 1 | 3 | 1 | 3 | 3 | 2 | 13 |
| Deterministic crafting (Little Alchemy style) | 0 | 3 | 2 | 3 | 3 | 1 | 12 |
| Paid gacha | 2 | **0** | 2 | **0** | 1 | 2 | 7 |
| Trade only (no earn loop) | 3 | 3 | 1 | 1 | 1 | 0 | 9 |
| Blender of 2 to 6, genome mix | 1 | 3 | 3 | 3 | 2 | 2 | 14 |
| **Touch meter + restock + tasks + merge 2 + same-tier swaps (chosen mix)** | **3** | **3** | **3** | **3** | **2** | **1** | **15** |

Why the mix wins: touch is the one input only this game has; a free random drop creates *spares and gaps*, which is exactly what makes
a swap worth doing; merge gives spares a purpose (so trade is not the only use of a duplicate); server-authoritative swaps are the
price (build cost 1). The paid-gacha row is shown only to explain what we refuse (3.1).

## 5. THE CHOSEN LOOP

### 5.0 The canonical sim run and the headline numbers

**One saved run is the source of every [sim] number** in this file, in TRADE.md, MERGE.md and NEXT_STEPS.md: `node _harness/sim_economy.ts` with no
flags (5000 players, 60-day and 450-day horizons, seed `0x5eed1234`, `MERGE_COST=2`), run on **2026-10-05** under Node 22.22.0, first against the game
logic of commit `7869499` (290 s, 297 lines), then again the same day against checkpoint `fc60963`, after the CORE lane's audit fixes and a species
rename had changed `src/core`, `src/data` and the sim itself (342 s), and a third time after checkpoint `f14d3b8` (the four pre-launch renames;
430 s): **the outputs are byte-identical**. **Re-quote check:** the SHA-256 of the
output without its last line (the wall-clock "(elapsed ...)" line) is
`855b4a6369bf5dc6d1e564c09c187694fd79eed01197282ccdcb498bfeb151a2`;
`node _harness/sim_economy.ts | grep -v '^(elapsed' | sha256sum` must print the same value, and if it does not, the logic or the sim changed and every
number below must be re-quoted from the new output. The output prints no species names, so renaming a species does not change it.

**Tags.** **[sim K]** = section K of that run, and so on. Sections use **different populations** (K: 5000 players, of whom 1093 are regular willing
traders; O: 3000; P and Q: 2000), so one quantity can differ by a day or two between sections: all 50 for regular willing traders is
205 / 131 days in K, 206 / 130 in O and 201 / 129 in P. **Quote K for the headline and tag every other figure with its section.**

| Headline | Value | Source |
|---|---|---|
| Active minutes per capsule, regular players | **3.1** (median; p10 2.6, p90 3.8) | [sim C, n=5000] |
| First capsule; first pair of any species (regular) | 64 s; after 5 capsules, 10.5 active minutes | [sim C] |
| All 50 species, p50 day, regular willing traders: solo / with trade | **205 / 131** (x1.56; x1.69 at p25, x1.52 at p75, x1.57 at p90) | [sim K, n=1093] |
| Active hours to all 50, same players: solo / with trade | about 50 / about 33 | [sim K] |
| Finished all 50 by day 120: solo / with trade | 8% / 43% | [sim K] |
| First copy of any Rare / Epic / Legendary / Mythic, median day | all players, trade world: 3 / 7 / 15 / 38 [sim K, n=5000]; regular willing traders: 2 / 5 / 11 / 28 [sim Q, n=2000] | |
| Route of Epic+ first copies, willing traders, trade world | capsule 65%, **trade 33%**, merge 1% (solo world: capsule 93%, merge 7%) | [sim L] |
| Last 5 species a finisher completed (any tier) | trade 52%, capsule 44%, merge 4% | [sim L] |
| Last 5 Epic+ species a finisher completed | trade 51%, capsule 45%, merge 3% | [sim L] |
| Frictionless oracle (everyone willing, no friction, cap 20): all 50 solo / trade | 210 / 119 (x1.76) | [sim P, n=2000] |
| Merges per regular player per 100 days | 8.5 | [sim O, n=3000] |
| Mean items held per player at week 9: merging on / off / with Tidy-up | 331 / 338 / 281 | [sim G] |

### 5.1 In nine lines

1. **Touch** (poke, squeeze-and-release, pull-and-let-go, mixed) pays **squish points**; **100 SP = one free capsule** (about **3 to 4 active minutes**).
2. **Open the capsule** (squeeze it until it cracks): one random squishy of **50**, six tiers. Odds are public. Repeats are allowed.
3. **Daily Restock**: once a day, pick 1 of 3 offered Common or Uncommon squishies (a gift, not a gate). **Two small tasks** a day (max 5 a week) each pay one capsule.
4. **Merge**: **2 of the same species -> 1 new random squishy**, never below their tier; a finished row always moves up; after 4 duds in a row the next one moves up.
5. **Trade**: exact same-tier swaps (1 to 3 per side between friends; 1 for 1 on the board, TRADE D-T5), friend code or species-icon board, server-authoritative, 24 h receive lock, no currency, no text.
6. Rarity is **visible in the object** (section 5.3) and **felt** (material families, 5.2).
7. Merge is random, trade is exact, so they do not compete (5.8).
8. Everything is free. There is no real-money path (section 8).
9. Targets: a regular player owns all 50 in about **131 days (33 active hours) with trading vs 205 days (50 hours) solo [sim K]** (5.0).

### 5.2 The catalog: 50 species, 6 tiers, material families

| Tier | Species | Odds per capsule | Per species | Capsules to 1st of one specific species | Capsules to 1st of any in tier | Merge tier-up chance |
|---|---|---|---|---|---|---|
| Common | **14** | 76.3% | 5.45% | 18 | 1.3 | 30% |
| Uncommon | **11** | 13.0% | 1.18% | 85 | 7.7 | 25% |
| Rare | **10** | 6.0% | 0.60% | 167 | 16.7 | 20% |
| Epic | **7** | 2.8% | 0.40% | 250 | 35.7 | 15% |
| Legendary | **5** | 1.4% | 0.28% | 357 | 71.4 | 10% |
| Mythic | **3** | 0.5% | 0.17% | 600 | 200 | cannot merge (top) |
| **Total** | **50** | 100% | | | | |

Room to grow past 60: new species append to the end of `SPECIES` and to the tier of their choice; see risk 3 (seasons). The catalog
agent builds species 0..49 from this table. **Species 0 is Dollop** (the slice squishy), Common.

**Why these counts and odds [sim Q, n=2000]:** the first guess (16/12/10/6/4/2 at 50/25/14/7/3/1) finished all 50 in **45 days with trade** (too easy).
Steeper odds with more Epic-and-above species stretch the tail; the chosen set gives first Rare around day 3, first Epic day 7, first Legendary day 15, first Mythic day 38
(medians over all players in the trade world [sim K]; for regular willing traders day 2 / 5 / 11 / 28 [sim Q]) and 131 days to finish for a regular trader [sim K].

**Material families and lanes (built: `src/data/catalog.ts` assigns them, `src/data/materials.ts` defines each family's feel; the generated view is
[`CATALOG.md`](CATALOG.md) "Family lanes"; the physics of each family is [`SQUISHY_SCIENCE.md`](SQUISHY_SCIENCE.md) section 4):**

* Every species belongs to **exactly one material family**. A family fixes its **touch feel** (firmness, bounce, stretch, damping, recovery time presets
  fed into `SoftBody`), so a collector wants variety in *feel*, not only colour.
* There are **12 families in 6 lanes (A to F)**. A lane pairs an *everyday* family with a *signature* family of the same kind of material:
  A Jelly (Jelly Gel, Sticky Stretch), B Fill (Liquid Core, Bead Squeeze), C Chew (Gummy Jelly, Slime Goo), D Foam (Marshmallow Puff, Slow-Rise Foam),
  E Dough (Mochi Dough, Bounce Putty), F Rubber (Firm Silicone, Pop Dome). In every lane the signature family has the **higher mean tier**
  (higher tiers favour the more distinctive feel).
* The distribution rules apply **per lane** (the columns of the grid below are lanes, not families): each lane has species in **at least 4 tiers** and
  **6 to 10 species**; no tier is more than 40% one lane. A single family holds 3 to 5 species and appears in 3 to 5 tiers.
* `_harness/probe_catalog.ts` checks the grid cell by cell, the lane totals (10/10/9/8/7/6), that every species uses a family of its own lane, and the
  signature rule. A new species (a season, risk 3) picks a lane and one of its two families, is appended to the end of the catalog, and must keep
  these rules; re-run `probe_catalog.ts` and the sim.
* Species per tier and lane (as built; `probe_catalog.ts` holds the same grid):

| Tier (n) | A Jelly | B Fill | C Chew | D Foam | E Dough | F Rubber |
|---|---|---|---|---|---|---|
| Common (14) | 3 | 3 | 2 | 2 | 2 | 2 |
| Uncommon (11) | 2 | 2 | 2 | 2 | 2 | 1 |
| Rare (10) | 2 | 2 | 2 | 2 | 1 | 1 |
| Epic (7) | 1 | 1 | 1 | 1 | 1 | 2 |
| Legendary (5) | 1 | 1 | 1 | 1 | 1 | 0 |
| Mythic (3) | 1 | 1 | 1 | 0 | 0 | 0 |

* Each species also carries a cosmetic **signature touch** tag (poke, squeeze or pull) used for hint text and a small look bias in its genome roll.
  It does **not** change drop odds (5.5).

### 5.3 Rarity you can see: the visual language per tier

Tier is a property of the **species** (catalog), not stored in `Genome`. The render lane layers a **tier FX pass** on top of the genome
look, keyed by `tierOf(species)`; the genome numbers keep their slice-1 meaning. Colours come from the existing palette tokens.
Tier is never colour-only: each also has a **gem shape**, a **text label** and a **sound signature**.

| Tier | Body material | Core and inner light | Aura and floor light | Sparkle | Idle motion | UI gem and frame |
|---|---|---|---|---|---|---|
| **Common** | Plain jelly, matte-gloss, one hue | Dim core | Plain contact shadow | None | Blink, breathe | Circle, cream frame |
| **Uncommon** | A little more translucency (clear-capable families; opaque families: a touch more gloss) | Warm core | Faint tinted light pool | A few glitter flecks inside | Blink, breathe | Diamond, lagoon frame |
| **Rare** | Deeper transmission (clear-capable families; opaque families stay frosted under their family cap), rim glow, speckle or swirl layer | Visible glowing "seed" core | Soft rim halo | Moderate glitter | Core pulses slowly (under 0.5 Hz) | Hexagon, dusk-violet frame |
| **Epic** | Two-tone gradient body, stronger pressure blush | Bloom on the core | 3 to 5 slow orbiting motes; caustic ring on the table | Glitter drifts upward | Motes trail when it moves | Four-point star, ember-coral frame |
| **Legendary** | Slow **aurora** gradient moving inside the body | Bright core, faint light pillar on idle | Ring on the table pulses at 0.25 Hz | Dense glitter, short spark trail | Settles with a visible wobble ring | Six-point star, sodium-amber frame |
| **Mythic** | **Thin-film iridescence** (hue shifts with view angle) | Prism core | Soft light dome; small orbiting satellite sphere(s) | Constellation of fixed star points inside | Own idle hum (audio), slow breathing glow | Eight-point prism, slowly rotating frame |

Audio signature on idle/reveal rises with tier (section 6). Budget note for RENDER: tier FX are per-tier shaders and particle presets, not per-species art;
Epic and above is 15 of 50 species.

### 5.4 Earning: the Squish meter (explicit active-play model)

**Owner direction, 2026-10-06** ([`FUN.md`](FUN.md) section 2): every touch earns visibly, and holding earns while you hold. Two rules changed
that day and the pay was re-tuned with the sim so the pace stayed in its band: **a stretch held out now pays per second held, like a squeeze**
(it paid a flat 1.8 SP), and **ordinary tapping always pays a little** (2 to 4 taps a second paid 0.25 down to 0.06 SP a tap). The numbers in
this section come from the 2026-10-06 run of `node _harness/sim_economy.ts` (no flags; output SHA-256 without the elapsed line
`9d030f8166038689e89c1e9d2e19957d49c1ed35f2aad55d59a9675d7a72b9b6`). **The rest of this document still quotes the 2026-10-05 canonical run of
section 5.0** (whose hash the old rules reproduced exactly on 2026-10-06); the new rules move those figures by a few percent at most (for example
all 50 for regular willing traders 205 / 131 days becomes 203 / 131 [sim K], first capsule 64 s becomes 63 s [sim C]) until 5.0 is re-quoted.

**Meter rule (touch to squish points), as tested [sim A]:**

| Touch | Pays | Notes |
|---|---|---|
| Poke | 0.8 SP | Needs a distinct contact; double taps under 0.25 s do not pay. **Every other poke pays at least 0.2 SP** (a quarter of a fresh poke, the freshness floor below): 2 taps a second pay 0.36 SP each, 2.5 a second 0.23, 3 or 4 a second 0.2 (they paid 0.25, 0.16, 0.11 and 0.06). |
| Squeeze and release | 0.7 SP + 0.45 per second held (hold counted up to 3 s) | **Soft pop** +0.5 SP if held 1.8 s or more. Unchanged. |
| **Stretch and hold, then let go** (snap) | **1.0 SP + 0.55 per second held** (hold counted up to 3 s, the squeeze's cap): 1.55 SP at 1 s, 2.1 at 2 s, 2.65 at 3 s or more | When the pull level at the release is 0.35 or more (a third of the way to the body's own limit). **0.5 SP flat**, whatever the hold, if it never stretched. The hold is the snap's `heldFor`, the seconds from the grab to the release (`softbody.ts`). Was a flat 1.8 SP until 2026-10-06. |
| **Medley** | +2 SP | Three different kinds inside 12 s; then 25 s cooldown. |
| **Freshness** (anti-mash) | pay x clamp((seconds since your last touch of the SAME kind / tau)^2, floor, 1) | tau: poke **0.75 s** (was 0.9), squeeze 2.4 s, pull 3.0 s. Floor: poke **0.25** (was 0.03), squeeze and pull 0.03, so mashing squeezes or pulls stays worthless. |
| **Valve** | at most 40 SP in any rolling minute | Never binds a human playing as modelled (about 28 SP/min). It is what bounds a steady minute of tapping at 2 taps a second or more, a script, or full stretches held 3 s back to back. |
| **Daily cap** | 8 capsules at full rate, then 25% rate, hard stop at 12 a day from play | "Squishies need rest." Not a punishment: nothing is lost, the meter just fills slowly. |
| **Onboarding ramp** | capsule 1, 2, 3 cost 30, 50, 75 SP, then 100 | First capsule in about **63 seconds** [sim C]. |

`SoftEvent` mapping for SHELL (`src/collection/meterfeed.ts`): `poke` -> poke; `release` with `heldFor` >= 0.4 s -> squeeze with that hold;
`snap` -> pull with `amount = intensity` (the pull level) and `heldS = heldFor` (0 to 10 s); the meter applies the 0.35 threshold itself. The play
report carries a pull's hold as a 4th element, `[2, level, dtMs, heldS]` (COLLECTION 7.5).
**Pending arc** (FUN.md 2.2): while a squeeze or a stretch is held, `collection.previewTouch(kind, heldS, level)` returns the SP that touch would
pay if it ended now (pay, freshness, a medley it would complete, the daily rate, the valve's room; core `previewInteraction`), so the ring can show
a growing lighter arc that banks exactly that on the release. It is pure and allocation-free.
The valve, freshness and caps are **server-side** (the client only reports touches).

**Human touch model and what it pays [sim A, 400 five-minute streams per archetype; before -> after the 2026-10-06 rules]:**

| Archetype | Pokes / squeezes / pulls per min | SP per minute | Share of SP poke / squeeze / pull | Active minutes per capsule |
|---|---|---|---|---|
| Poker | 19.9 / 4.4 / 2.7 | 27.3 -> **28.0** | 57 / 26 / 17% | 3.7 -> **3.6** |
| Squeezer | 2.7 / 14.2 / 2.8 | 28.2 -> **28.4** | 9 / 74 / 16% | 3.6 -> **3.5** |
| Puller | 2.7 / 3.0 / 13.5 | 26.2 -> **27.4** | 10 / 18 / 72% | 3.8 -> **3.6** |
| Mixed (varied) | 8.8 / 6.7 / 6.7 | 31.3 -> **31.8** | 26 / 37 / 38% | 3.2 -> **3.1** |
| *Tapper* (bursts of 2 to 3 taps a second; section A only) | 66.3 / 3.7 / 3.3 | 24.9 -> **30.1** | 67 / 18 / 15% | 4.0 -> **3.3** |
| *Holder* (every stretch held 2 to 4 s; section A only) | 2.1 / 2.5 / 10.1 | 22.6 -> **28.8** | 7 / 15 / 78% | 4.4 -> **3.5** |

The pull model is unchanged in timing: a human pull is held 0.8 to 2.4 s (that hold is now paid) plus 1.0 s to reach for it. The tapper and the
holder are the owner's two styles, measured in section A but not added to the population mix (so the macro sections compare like with like).
Under the old rules they were the two slowest ways to play (4.0 and 4.4 minutes a capsule): exactly what the owner reported.
Every single style earns within about 4% of the others (27.4 to 28.4 SP/min; they spread 8% before), the puller is no faster than the poker (x0.98),
and **variety pays about 14% more** (medley). Fast tapping in bursts earns about what varied play earns.

**Bots and fast tapping** [sim A; `probe_economy.ts` section 2]: mashing 8 pokes a second earns **0.1 SP/min** (every poke is a double tap); a poke
every 250 ms (the fastest paid rate), full stretches held 3 s back to back (38.9 SP/min) and a scripted poke-squeeze-pull cycler at the physical
limit are all held to the valve (**40.0 SP/min**, about 1.4 times a human). A steady minute of tapping pays 42.7 SP at 2 taps a second (held to 40),
34.7 at 2.5, 36.6 at 3 and 48 at 4 (held to 40); before 2026-10-06 it paid 29.6, 23.7, 19.7 and 14.8. Every one is stopped by the daily cap at
**12 capsules a day from play, versus about 10 for devoted human players** (9.9 per active day including tasks). Capsules have no cash value (no
currency, same-tier swaps only), which removes most of the reason to farm. Sessions modelled: casual 1 to 2 x 3 to 5 min; regular about 2 x 10 to 15
min; devoted 2 to 3 x 12 to 22 min.

**Result [sim C, 5000 players]:** measured **3.0 active minutes per capsule** for regular players (median 3.04, was 3.08; p10 2.6, p90 3.8;
steady touch time per capsule 3.1 to 3.6 by style; tasks lower it a little). Capsules per active day: casual 2.6, regular 7.2, devoted 9.9 (plus 1
restock pick). **First capsule 63 s** for regular players (poker 64, squeezer 64, puller 66, mixed 58 s). A regular player's first pair of any
species arrives after **5 capsules (10.4 active minutes)**; first triple after 14 capsules (36.5 minutes). Pure capsule birthday maths with these
odds gives about 6.7 capsules to the first repeat (sqrt(pi / (2 x sum of squared odds)) + 2/3, my calculation); the sim's 5 is lower because the
starter Dollop, restock picks and task capsules also create repeats. This is within the owner's band (3.0 to 3.8 minutes per capsule; 2 to 5,
not under 1.5, not over 6), so **MERGE_COST = 2 stands** (5.6: it would flip to 3 only at about 1.5 minutes or less). The re-tune made the pace
about 1.5% quicker, inside the model's own noise; the next lever, if a playtest asks for it, is still the capsule cost (100 SP).

**Restock and tasks.** *Restock:* once per day, 3 random Common or Uncommon species are offered (25 species pool); pick one, new ones shown first. Misses do not accumulate or punish.
*Tasks:* 2 offered a day ("stretch one to 2x", "five soft pops in a row"), each completed task pays one capsule, **max 5 tasks a week**, tasks are style-neutral.

### 5.5 Playstyle affinity: tested, then dropped from the drop odds

The hypothesis: what you drop depends on how you play (tilt which species inside a tier), so your hoard has gaps other styles fill. Implemented as
`weight = exp(beta x recent share of that style)` inside a tier only (tier odds untouched, Legendary and Mythic ignore it), with global supply rebalanced so no style group is scarcer.

| beta | P(random pair has a feasible swap), day 60: different-style / same-style [sim J1] | Trade speed-up, all 50, p50 solo / trade, willing traders of every type [sim J2] | Slowest vs fastest play style, Epic row, trade world [sim J2] | Slowest vs fastest play style, all 50 [sim J2] |
|---|---|---|---|---|
| 0 (off) | 57% / 57% | **1.53x** | 1.07x | 1.15x |
| 2 | 61% / 57% | 1.67x | 1.15x | 1.14x |
| 4 | not shown | 1.86x | 1.22x | 1.18x |

(J2 counts willing traders of every player type, so its speed-up at beta 0 (1.53x) is lower than the regular-trader headline of 1.56x [sim K].)

**Verdict: drop it from species odds.** At beta 2 it adds about 9% to the trade speed-up (1.53x to 1.67x) and 4 points of "different-style pair" matching
(57% to 61%), but it doubles the gap between the slowest and the fastest play style on the Epic row (1.07x to 1.15x); at beta 4 it adds 22% (1.86x) and
the slowest style takes 22% longer on the Epic row, which reads as "my way of playing is penalised". It also needs supply-balancing maths and complicates
odds disclosure. **Honest note:** an earlier version of this table (1.62x to 1.67x at beta 0 to 2, about 3%) does not reproduce from the
canonical run (5.0), which shows about 9%; it came from an older run or another population. This is a closer call than it first looked; the verdict stands
on fairness and odds disclosure.
**Kept as flavour only:** the style of your touching tints the *look and feel traits* of what you roll within a species (more bounce for pokers, etc.), cosmetic, not economic.
Revisit only after a real playtest shows trading is too weak (the knob exists in the sim as `beta`).

### 5.6 Merge: the rules (MERGE_COST = 2)

**One constant, `MERGE_COST = 2`, in `src/core/merge.ts`; the preview, the roll, the probes and the economy sim all read it from there.**

| Rule | Value |
|---|---|
| Inputs | **2 squishies of the same species**, Common to Legendary (Mythic cannot merge: nothing above it). Both are consumed, one new squishy is minted, in one server transaction. |
| Output tier | **Never below the inputs' tier.** Tier-up chance: Common 30%, Uncommon 25%, Rare 20%, Epic 15%, Legendary 10%. |
| **Finished row** | If you own every species of the input tier, **the merge always tiers up** (to a random species of the next tier). Merges are never wasted on a complete row. |
| Pity | After **4 merges in a row from the same tier without a tier-up, the next one tiers up** (so never more than 4 duds in a row). The counter is per input tier, so it cannot be banked on cheap fodder and spent on a Legendary pair. |
| Species roll | Random inside the output tier, **never the input species**; species you do not own are weighted **x1.5** (mild). No "guaranteed new species" rule (it added nothing once finished rows tier up, [sim F vs G]). |
| Look of the result | A normal instance of the result species, **tinted** toward the circular mean of the inputs' hues (a few degrees of jitter), but only as far as it stays recognisably its own species: at most 0.04 OKLab from the species' centre colour and nearer it than any other same-tier species. A parent's pattern is kept only in a same-tier merge into a patterned (Rare and up) species; a tier-up never borrows one, so every Rare-and-up result keeps its tier's pattern layer. Core hue, speckle, glitter and the rest are the species template's. `lineageGenome` in `src/core/merge.ts`; `probe_economy.ts` checks both bounds over random merges with real parents. `origin = { kind: 'blend', parents: [idA, idB] }`. |
| Variants and colourways | **None in v1.** Every instance's genome is already unique. Rare colourway variants per species (an idea from reference clip A) are **open owner decision D-15** in NEXT_STEPS: they add a collecting dimension and change the economy, so the sim must be re-run before any decision. A cosmetic "Prism" colourway (same tier for trade parity) is a possible season addition. |
| Bulk N-input merge | A true multi-input blender (the clip's six) is **deferred**; only the capped Tidy-up below exists in v1. |
| Safety | **Hold to merge** 0.5 s (release early cancels, nothing consumed). **Preview** shows exact tier odds and how many species you still lack in the output and next tier. A warning appears if it uses your **last copy**. **Hearted** squishies are protected. Output **locked 24 h** (cannot trade or merge). Daily cap **10 merges**. |
| **Tidy-up** (bulk merge, the only descendant of the 6-input blender) | One button that runs up to 10 eligible spare-pair merges, never touching hearted copies or your last copy of a species. MERGE.md M-4 narrows the default to Common and Uncommon and keeps shelved items out. |
| **The protection mark** | Called **Heart** wherever a player sees it (a heart icon; "hearted" copies): it protects a copy from merge, Tidy-up and trade and keeps it as the stack's keeper. Every document uses this name. The database column is `wh_items.fav` and the API error code is `favourite`; those wire names stay. |

**Why M = 2 and not 3 (applying the owner's rule).** The rule: if actually earning a squishy takes decent effort (3 minutes or more), merge cost is 2; if it is easy (about 1.5 minutes or less), 3; in between, break the tie with the sim.
At 100 SP per capsule a regular player spends **3.1 to 3.8 active minutes per capsule**, which is the decent-effort band, so **M = 2**. The sim agrees: a pair arrives in the
first one or two sessions for regular players (**91% by 25 minutes, 57% by the first 12**), whereas a triple would take **37 minutes, 27% by 25 minutes**, i.e. three or more sessions.
Trade still wins for the last species at M = 2 (5.8). Side by side [sim O, 3000 players, 450 days, regular players willing to trade; its 206 / 130 differs
from the headline 205 / 131 of section K only by sample]:

| Metric | **100 SP, M=2 (chosen)** | 100 SP, M=3 | 40 SP (about 1.3 to 1.5 min), M=2 | 40 SP, M=3 |
|---|---|---|---|---|
| Active minutes per capsule (measured) | **3.1** | 3.1 | 2.0 | 2.0 |
| First capsule | 64 s | 64 s | 26 s | 26 s |
| Minutes to first mergeable set | **10.4** | 36.6 | 4.7 | 19.7 |
| Have a mergeable set by 12 / 25 active minutes | **57% / 91%** | 8% / 27% | 92% / 99% | 32% / 59% |
| Days to all 50, p50: solo / with trade | 206 / 130 | 216 / 134 | 135 / 90 | 148 / 89 |
| Solo-to-trade time ratio: Epic row / all 50 | 1.77x / 1.58x | 1.95x / 1.61x | 1.77x / 1.50x | 1.92x / 1.66x |
| Epic+ first copies that came by trade / by merge | 32% / 1% | 33% / 1% | 32% / 1% | 33% / 1% |
| Merges per player per 100 days | 8.5 | 8.3 | 8.3 | 8.0 |
| Live merges returning a NEW species / feel-bad | 34% / 12% | 30% / 11% | 33% / 11% | 30% / 10% |
| Capsule repeat rate, first 60 days / whole run | 90% / 98% | 90% / 98% | 92% / 99% | 92% / 99% |

M = 3 has a slightly better trade ratio but fails the "mergeable set in the first one or two sessions" target at the chosen meter, and a faster meter that would fix that (40 SP) is
the "too easy" band (all 50 in about 90 days with trade). **The meter rate and M are a pair: 100 SP and M = 2.**
**Sensitivity** [sim P, 2000 players, regular willing traders, days to all 50 solo / trade]: as modelled 3.1 min/capsule **201 / 129**; players **2x slower** (5.4 min/capsule, the edge of grindy) **365 / 221**
(73% -> 94% finished by day 450); **2x faster** (2.2 min) **150 / 90**; **half the play time** **394 / 255**. The design holds at both extremes.

### 5.7 Trade: the v1 rules

| Rule | Value |
|---|---|
| What moves | Squishy instances, item-for-item. **No currency, no free text.** |
| Parity | **Same tier, same count**: 1 to 3 squishies per side. A Rare can only ever be swapped for a Rare. No lopsided deal is possible by construction. **Refined by TRADE D-T5:** 2 or 3 each way only between friends; a board trade is 1 for 1. |
| Any spare for any spare | A side may take one of your spares even if it already owns that species (a "favour swap"); the server only checks tier and count. ([sim P]: both sides must gain a new species -> 150 days to finish; favour swaps allowed -> 129.) |
| Finding a partner | **Friend code** (mutual accept) or the public **wants/offers board**: a grid of species icons, searchable by species and tier. Anonymous alias, no profile. ~~3 offers and 3 wants per listing~~ **Superseded by TRADE D-T5:** a listing shows up to 3 offered items and up to 3 wanted species (or "any of this tier"), but each board trade is **1 for 1**: one of the offers for one item of a wanted species. |
| Locks and caps | **24 h receive lock** on traded-in and merge-made squishies (cannot trade or merge); **max 3 completed trades a day** (sim value; raise to 5 as headroom), **1 per partner per day**; new accounts need 2 days and 10 capsules opened before trading. **Refined by TRADE D-T4:** "a day" is a rolling 24 hours, not a calendar day. |
| Atomic | One transaction swaps owners, bumps `tradeCount`, writes the ledger. Anything fails: nothing moves. ~~Server holds both offers in escrow, both confirm within 60 s~~ **Superseded by TRADE D-T1 and D-T3:** each side confirms explicitly a numbered version of the terms it was shown at least 5 s earlier (a counter voids the other side's consent); a proposal lives 24 h (async); a `live` trade keeps a 60 s window re-armed by each counter; the waiting party's items are reserved, and a reservation lapses by itself when the trade is no longer live. The swap is `wh__trade_execute`, called by the second `wh_confirm_trade`. |
| Never | Trading a share string, a code or a screenshot. Free-text chat. Currency, tips or bundles of different tiers. |

### 5.8 Why trade stays NEEDED (and merge does not replace it)

* **Merge is random, trade is exact.** Cost of **one specific species by merge only** (a collector who counts only merge outputs, feeding merges from the target's tier and the one below) versus by plain drop [sim M]:

| Target tier | By drop (capsules) | By merge only, M=2: capsules median (mean) / merges median | By merge only, M=3: capsules median (mean) / merges median | By trade |
|---|---|---|---|---|
| Common | 18 | 34 (42) / 13 | 57 (68) / 11 | 0 capsules, 1 swap |
| Uncommon | 85 | 35 (39) / 17 | 66 (76) / 17 | 0, 1 swap |
| Rare | 167 | **131 (160) / 12** | 258 (304) / 13 | 0, 1 swap |
| Epic | 250 | **201 (237) / 8** | 379 (459) / 8 | 0, 1 swap |
| Legendary | 357 | **293 (337) / 5** | 574 (651) / 5 | 0, 1 swap |
| Mythic | 600 | **790 (928) / 7** | 1137 (1406) / 5 | 0, 1 swap |

  At M=2 merge is no better than waiting for the drop (0.9 to 1.0x of the drop cost for Rare to Legendary, 1.5x for Mythic; at M=3 it is 1.8x to 2.3x), and **trade costs zero capsules** when a partner has the spare.
  Merge roughly matches a drop for Rare to Legendary because re-rolling spares of the target's tier turns "any copy" into "that copy" at about the odds a drop would; it is cheaper only for Uncommon
  (it recycles the flood of Common spares), a row that is cheap anyway. So it stays a recycler and a lottery ticket, not a route to a specific Epic or above.
* **Where the last species came from** [sim L, all willing traders who finished, no churn]: of the **last 5 species** a finisher completed, **52% arrived by trade, 44% by capsule, 4% by merge**.
  For the last 5 Epic-and-above: **51% trade, 45% capsule, 3% merge**. Over all Epic+ first copies: capsule 65%, **trade 33%**, merge 1% (solo world: capsule 93%, merge 7%).
* **Trade speeds completion** (regular willing traders, the same players solo vs trade) [sim K, n=1093]: Rare row **68 -> 34 days (2.0x)**, Epic row **102 -> 56 (1.8x)**, Legendary **136 -> 76 (1.8x)**, Mythic **180 -> 118 (1.5x)**, all 50 **205 -> 131 (1.56x at p50; 1.69x at p25, 1.52x at p75, 1.57x at p90)**.
  Finished all 50 by day 120: **8% solo vs 43% with trade**. Casual traders: all 50 by day 450, **1% solo vs 25% with trade**; Epic row **45% vs 92%**.
* **Honest limit: the owner's "at least about 2x" is not reached for the whole shelf (about 1.5 to 1.7x).** Trading moves copies around; it cannot create them, so the rarest species bound both routes. Even a
  frictionless oracle (everyone willing, no friction, cap 20) only reaches **1.76x** [sim P, n=2000: 210 / 119]. The knobs, if the owner wants more: more species in the top tiers, or steeper odds (both tried in [sim Q]: the six catalogs tested land between 1.53x and 1.76x, none at 2x). We chose pacing over a bigger ratio.
* Merge does **not** make trade pointless: switching merge off entirely moves "all 50 with trade" from 129 to 132 days and solo from 201 to 240 [sim P, n=2000] (merge helps solo by about 16%, trade-world by about 2%).

### 5.9 Duplicates and supply [sim D, G, F; 60-day cohort with churn, trade on]

| Week | Capsule repeat rate | Repeat rate of Rare-and-above capsules | Species owned (of 50), mean |
|---|---|---|---|
| 1 | 57% | 10% | 20.1 |
| 2 | 87% | 30% | 27.1 |
| 3 | 92% | 47% | 31.6 |
| 4 | 95% | **61%** | 34.7 |
| 8 | 98% | 84% | 41.3 |

* **Repeat band.** Commons repeat over 90% from week 3 (they are merge fodder and same-tier swap currency), so the useful band is the **Rare+ repeat rate: crossing 50% in week 4**, which is when
  trade fuel (spare Rare, Epic copies) becomes plentiful. Capsule reveals must therefore celebrate **"new"** and compress **"repeat Common"** (section 6).
* **Does merge keep supply from inflating? No, not by itself.** Sources are about 36 items per player per week; the merge sink (each merge destroys 2, mints 1: net minus 1) removes **2 to 3%**; mean items held grows to **331 per
  player by week 9** (338 with merging off). With the capped **Tidy-up** it removes **about 17% of sources** (items held 281 at week 9). Item *count* inflation is harmless to progression value because
  trade parity is by tier, not by price, and Epic+ is only about 4.7% of capsules; but the UI must **stack by species** and offer Tidy-up, and an optional soft cap (for example 150 spare slots)
  is a later knob. Daily caps, not merge, are what bound production.
* **Merge outcomes** [sim F, 60 days]: 6.7 merges per player (casual 3.4, regular 8.1, devoted 10.7); 69% of players ever merge. Because finished rows always tier up, outcomes shift up: Common 12.3%,
  Uncommon 56%, Rare 25.5%, Epic 4.7%, Legendary 1.2%, Mythic 0.2% (capsules: 76 / 13 / 6 / 2.8 / 1.4 / 0.5). Of all merges over 120 days: **95% tier up, 79% return a species the player already owns** (so an owned
  species at a *higher* tier is the usual result, which is still a better trade-currency tier), only about 5% return the same tier. A merge never returns a lower tier.
* **Feel-bad ladder** (120 days, "live" merge = something new was still reachable; feel-bad = returns an owned species AND no tier-up):

| Merge rules (each row adds one) | Live merges: new species | Live: tier-up | **Live feel-bad** | Longest dud streak (p95 / max) |
|---|---|---|---|---|
| A. Floor only | 4% | 0% | 96% | 70 / 120 |
| B. + tier-up chances | 11% | 27% | 71% | 11 / 26 |
| C. + unowned x1.5 | 14% | 27% | 71% | 12 / 25 |
| D. + pity after 4 duds in a row | 16% | 33% | 65% | 4 / 4 |
| E. + finished-row boost x2 (cap 60%) | 22% | 52% | 49% | 4 / 4 |
| **F. finished row always tiers up (chosen)** | **36%** | **89%** | **13%** | **3 / 4** |

### 5.10 How often you own M of the same, and a lock's cost [sim E, I, N]

* **Share of players owning at least 2 / at least 3 / at least 4 of one species of a tier** (merging off so copies accumulate; day 7 / 30 / 60):

| Tier | At least 2 | At least 3 | At least 4 (two spares while keeping one) |
|---|---|---|---|
| Common | 97 / 100 / 100% | 78 / 100 / 100% | 64 / 95 / 100% |
| Uncommon | 68 / 98 / 100% | 26 / 81 / 99% | 6 / 68 / 90% |
| Rare | 19 / 68 / 84% | 2 / 41 / 71% | 0 / 18 / 56% |
| Epic | 8 / 49 / 74% | 1 / 19 / 54% | 0 / 5 / 30% |
| Legendary | 3 / 27 / 58% | 0 / 7 / 29% | 0 / 1 / 10% |
| Mythic | 0 / 8 / 26% | 0 / 1 / 6% | 0 / 0 / 1% |

  At **M = 2** a reckless merge needs the "at least 2" column and a careful one (keeping a copy on the shelf) the "at least 3" column: Common is mergeable in week 1, Uncommon in weeks 2 to 4,
  Rare in weeks 4 to 8, Epic after week 8, and a Mythic pair is the multi-month event it should be. At M = 3 the same columns shift one to the right (careful = "at least 4"), which is why a first triple takes 36 minutes.
* **A 24 h lock costs honest players nothing** (60 days): trades per 1000 players a day 36.1 (no lock) / 36.0 (1 day) / 35.4 (3 days); species owned 44.77 / 44.88 / 44.71.
* **Does the lock stop merge-then-trade laundering?** Toy ring model (6 bot mules, 30 trades/hour each, 25% of hops cash out to innocents; "x/y/z" = extra copies / merge outputs / innocent holders at detection):

| Policy | Dupe bug, detected at 24 h | Stolen 20 items, at 24 h |
|---|---|---|
| No limits | 4233 / 63 / 906 | 4 / 4 / 16 |
| **Receive-and-merge lock 24 h only** | 720 / **0** / 170 | 0 / **0** / 6 |
| Daily cap 5 + 1 per pair only | 37 / 7 / 16 | 2 / 2 / 15 |
| **Lock + cap + pair limit** | **5 / 0 / 1** | 0 / 0 / 10 |

  The lock stops **laundering** (merging tainted copies into clean-looking items: 63 -> 0) and slows **spread** (906 -> 170 innocents). It does **not** stop the raw copying of a giver-side dupe bug
  (4233 -> 720 only because mules wait); **the daily cap and the per-pair limit do that**, and the real fix is atomic transactions. Provenance (`origin.parents`, `tradeCount`, the ledger) lets
  a tainted merge output be recalled even if it slipped through.

### 5.11 Pacing for the median regular player [sim K]

| Milestone | Solo (p50 day) | With trade (p50 day) |
|---|---|---|
| Common row (14) | 9 | 6 |
| Uncommon row (11) | 19 | 12 |
| Rare row (10) | 68 | 34 |
| Epic row (7) | 102 | 56 |
| Legendary row (5) | 136 | 76 |
| Mythic row (3) | 180 | 118 |
| **All 50** | **205 (about 50 active hours)** | **131 (about 33 active hours)** |

A tier row finished is a **fixed cosmetic reward** (shelf light, frame), never an extra random item (the Japanese kompu-gacha lesson). First Rare day 3, Epic day 7, Legendary day 15, Mythic day 38 (medians, all players, trade world [sim K]; regular willing traders 2 / 5 / 11 / 28 [sim Q]).

### 5.12 Limits of the sim (read before trusting a number)

* **Behaviour is assumed:** touch speed, session lengths, active days (0.4 / 0.7 / 0.9), churn, willingness to trade (30 / 55 / 75%), friends (35% have none), when people merge (30% merge even finished rows). **The 3.1 minutes per capsule is a model of human touching, not a measurement**; the first real playtest must
  re-measure it and the capsule cost (100 SP) is the one dial to retune.
* Trading is modelled as same-tier swaps matched daily over friends plus a species-searchable board; real timing, notifications and UI friction are not modelled. The "favour swap" acceptance (50%) is a guess; with
  mutual-need only, trade finishes in 150 days instead of 129 [sim P].
* The population is one cohort in one catalog; no new species arrive, no seasons, no players joining later (veterans would hold spares newcomers cannot afford; risk 3).
* Active hours count only touching time. Bots, multi-accounting and real-money trading are not modelled beyond the toy ring.
* The sim lets a board partner swap up to 3 items per trade (`maxSwapsPerTrade = 3`); TRADE D-T5 makes board trades 1 for 1 (friends may still swap 2 or 3).
  The sim may therefore overstate board trading a little. Not re-run with the restriction [U].
* Sim cost of the tier FX, art and server are out of scope. Everything is deterministic (seeded `mulberry32`), so changing one rule shows its effect exactly.

### 5.13 Where the module documents refine these rules

The module documents were written after this file and refine some rules with numbered deviations. **Where they differ, the module document is current**;
the rows of 5.6 and 5.7 they touch carry a note.

| Rule here | Refinement | Where |
|---|---|---|
| 5.7 "both confirm within 60 s" | Explicit, version-bound consent after a server-checked 5 s review; async proposals live 24 h; `live` mode keeps a 60 s window re-armed by each counter | TRADE D-T1, D-T9 |
| 5.7 escrow | The waiting party's items are reserved; a reservation lapses by itself when the trade stops being live (no cron) | TRADE D-T3 |
| 5.7 "3 trades a day", "1 per partner a day" | Rolling 24 h windows, not calendar days | TRADE D-T4 |
| 5.7 "1 to 3 per side", "3 offers and 3 wants per listing" | Board trades are 1 for 1 (one of up to 3 offers for one item of up to 3 wanted species); 2 or 3 each way only between friends | TRADE D-T5 |
| 5.7 friend code or board | Friends see only an opt-in offer shelf (at most 12 items); WH keeps its own friend graph, not the portal's `friendships` | TRADE D-T2, D-T7 |
| 5.7 confirm | Epic and above need a 1 s hold on the final confirm | TRADE D-T8 |
| 5.7 caps | Caps and the global freeze refuse without killing the trade; other failures end it | TRADE D-T10 |
| 8.2 "trading enabled only for old-enough accounts" | `trade_enabled` is off by default for every account; the same switch (and a moderation hold) closes every social surface | TRADE D-T6, 16.1; COLLECTION C-7 |
| 5.6 preview and odds | The merge request carries an odds digest; stale odds are refused with the new preview | MERGE M-1, M-7 |
| 5.6 "owned" | Owned counts every live item, locked and reserved ones included | MERGE M-2 |
| 5.6 Tidy-up | N sequential atomic merges with derived sub-keys; default tiers Common and Uncommon; shelved items excluded; full ceremony for the best result only | MERGE M-3, M-4, M-5 |
| 5.6 daily cap | Counts merges, not inputs; resets at the UTC day | MERGE M-6 |
| 5.4 meter, server-side | The server takes play time from its own clock with a 5-minute bank; at most 5 unopened capsules wait, then accrual pauses | COLLECTION C-4, C-5 |
| 7.1 local saves | Guests keep a Practice shelf that is never promoted | COLLECTION C-6 |
| 5.4 "a day" | UTC day for meter, restock, tasks and the merge cap | COLLECTION C-8 |

---

## 6. Merge ceremony and capsule reveal

Result first, theatre second: **the server decides the outcome before any animation starts**, so skipping, a closed tab or a crash can never lose or duplicate an item. All visuals are
procedural (Three.js, existing soft body); all sounds are synthesised (WebAudio); nothing here uses a sample or a reference asset.

### 6.1 Duration budgets (skippable by tap after 350 ms)

| Result tier | Capsule open | Merge ceremony | Notes |
|---|---|---|---|
| Common | **1.6 s** (repeat: 0.8 s quick pop) | 2.2 s | repeat Commons never hold the player |
| Uncommon | 2.0 s | 2.6 s | |
| Rare | 2.6 s | 3.2 s | |
| Epic | 3.2 s | 3.8 s | |
| Legendary | 3.9 s | 4.5 s | |
| Mythic | **4.5 s** | **5.2 s** | |

**Tap anywhere after 350 ms** jumps to the final reveal frame (squishy placed, plate shown) with a 120 ms crossfade. The result is never hidden by a skip. Setting **Fast open** compresses
repeat Common and Uncommon to 0.8 s but still plays new species and every Rare+ (skippable). Queued capsules wait on the table (up to 5); the player opens them when ready, never mid-squish.

### 6.2 Meter-full cue

* **Visual:** the meter ring around the HUD gem reaches 100%; one soft ring pulse (400 ms, ease-out, single, not repeating); a **neutral translucent capsule drops from above next to the squishy and lands with a wobble**, staying as a tappable object. No full-screen effect, no interruption of touching.
* **Audio:** two-note rising "plink-plonk" (sine plus short pluck, about 180 ms), quieter when the player is mid-squeeze. **Haptic:** one 10 ms tick on fill, one 18 ms thump on landing.
* Reduced motion: the capsule fades in at the HUD instead of dropping.

### 6.3 Capsule open reveal (beat sheet)

Open by **squeezing the capsule** until it cracks (hold 0.5 s; a tap also works). Beats for a Common; higher tiers stretch B2 and B3 and add pre-roll.

| Beat | Common (1.6 s) | What the player sees | What the player hears |
|---|---|---|---|
| B0 Grab (0 to 0.35 s) | 0.35 | Capsule wobbles; shell stays neutral (**tier is never spoiled by the shell colour**) | soft squeak, rising |
| B1 Crack (0.35 to 0.65 s) | 0.30 | Hairline cracks; **light leaks through them in the tier colour** (the tell) | shell "tick" |
| B2 Burst (0.65 to 1.0 s) | 0.35 | Shell halves fly; squishy drops out and lands (soft-body landing) | `pop` voice plus tier cue |
| B3 Reveal (1.0 to 1.6 s) | 0.60 | Small camera push; name plate slides in; **NEW** badge or **x2 spare** chip | tier motif (6.5) |

**Escalation by tier** (all values per reveal; particles are small, additive, low-area):

| Tier | Pre-roll before B2 | Light tell at B1 | Particles at B2 | Rings | Camera | Time-scale |
|---|---|---|---|---|---|---|
| Common | none | warm cream, faint | 12 round motes | 0 | none | 1.0 |
| Uncommon | none | lagoon, soft | 24 motes + 6 glitter | 0 | push 2% | 1.0 |
| Rare | 0.3 s hum swell | dusk-violet, brighter | 40 motes + 12 glitter | 1 | push 4%, orbit 6 degrees | 1.0 |
| Epic | 0.5 s rising tone | ember-coral core flare (slow ramp, not a pulse) | 70 motes + spiral trails | 2 | push 6%, arc 10 degrees | 0.6 for 250 ms |
| Legendary | 0.8 s choir-like swell | sodium-amber aurora ribbons, light pillar 0.8 s | 120 motes + ribbons | 3 | pull-back reveal, arc 15 degrees | 0.5 for 350 ms |
| Mythic | 1.0 s: **250 ms audio duck**, then swell | prism dome, constellation points converge | 200 particles + 24 star points | 3 | dolly + arc 25 degrees | 0.4 for 500 ms |

### 6.4 Merge ceremony beat sheet (two bodies converge)

Player drags two same-species squishies onto the **merge pad**, presses and holds the pad **0.5 s** (release early cancels; after the hold the server call fires and the outcome is final).
Timings below are for a **Common result (2.2 s total)**; higher tiers lengthen **T2 charge** and **T4 reveal** to the budgets in 6.1.

| Beat | Time | What the player sees | What the player hears | Haptic |
|---|---|---|---|---|
| **T0 Press together** | 0 to 0.4 s | The two bodies slide to the pad centre and **squash against each other**; cores glow brighter where they touch | low hum (80 Hz sine plus 2nd partial) fades in; wet squelch from the existing squish voice | slow rumble pulses (8 ms every 60 ms) |
| **T1 Fold** | 0.4 to 0.9 s | Both bodies **fold toward their shared centre into one translucent glowing ball** (shape-matching target is a sphere); the two parents' colours swirl together | squelch pitch rises with compression | rumble speeds up |
| **T2 Charge** | 0.9 to 1.3 s (longer for higher tiers) | The ball compresses and trembles; **motes spiral inward**; its light drifts toward the **result tier's colour** (the tell); strain blush saturates | hum glides up about a fifth; noise tick rate rises | pulses 8 to 14 ms, closer together |
| **T3 Burst** | 1.3 to 1.5 s | The ball **springs open** (overshoots to 1.25x, settles); shock ring(s) and a **single** light ramp (attack 80 ms, decay 400 ms); camera kick by tier | burst: noise transient plus tier bell (6.5) | one thump by tier (6.7) |
| **T4 Reveal** | 1.5 to 2.2 s | New squishy rises from the burst and lands; name plate; **NEW** or **spare**; a **TIER UP** banner (+0.4 s accent) if it moved up | tier motif | tier pattern |

Escalation by result tier uses the same table as 6.3 (particles, rings, camera, time-scale), plus: **tier-up merges** add a rising ladder glissando on T3 and a banner;
the **lineage tint** of the two parents stays visible in the new body's hue (bounded so the result still reads as its own species, 5.6) for the reveal.

### 6.5 Sound design by tier (synthesised, original; voices go in `src/audio/voices.ts`)

| Tier | Signature |
|---|---|
| Common | single soft "bloop": sine pair gliding 180 to 260 Hz, 180 ms |
| Uncommon | bloop plus a two-note chime (major third) |
| Rare | bell cluster (3 inharmonic partials) with short shimmer; perfect-fifth interval |
| Epic | low filtered-saw swell, 4-note rising arpeggio (octave span), soft whoosh |
| Legendary | formant "choir" pad, rising sweep, bell chord with a major ninth |
| Mythic | **unique 3-note motif per Mythic species** over a sub-bass swell, preceded by the 250 ms duck |
| Meter-full | two-note "plink-plonk" (6.2) |
| Merge T0 to T3 | hum (80 Hz plus partial) gliding up a fifth, squelch voice, noise-tick density rising, burst as above |

### 6.6 Flash-safe, reduced-motion and accessibility variants

* **Flash budget (always on):** never more than **2 luminance flashes in any 1 s** (stricter than the 3 per second in WCAG 2.3.1); the burst is **one ramp**, never a pulse train; screen-wide additive flash alpha **at most 0.25**;
  ring pulses at least **500 ms apart**; **no saturated-red flashing**, and the palette's ember-coral and lagoon-cyan must **never alternate faster than 2 Hz** (the 1997 incident involved red and blue flashing, at roughly 12 Hz, **[G]**).
  Implementation: a `FlashGovernor` in render counts luminance transitions per rolling second and clamps extras; an automated probe renders each reveal headless, computes per-frame mean luminance, and fails if any 1-second window has more than 3 flash transitions.
* **Calm effects** (setting; **on by default when `prefers-reduced-motion` is set**): no camera moves, no slow-motion, no screen shake, particle counts x0.3, rings become fades, all durations x0.65, **no pulses at all**; tier shown by static aura, gem frame and sound.
* **Skip animations** setting jumps straight to the reveal frame (plate and badge). **Sound off** keeps every visual cue. **Haptics off** is a setting; web vibration is unavailable on iOS Safari (**[G]**) so nothing depends on it.
* **Rarity is never colour-only:** gem shape (circle, diamond, hexagon, 4-star, 6-star, prism) plus text label plus sound signature.

### 6.7 Haptics per tier (`navigator.vibrate` patterns, milliseconds, optional)

| Event | Pattern |
|---|---|
| Meter full | [10] then on landing [18] |
| Common | [12] |
| Uncommon | [12, 60, 8] |
| Rare | [10, 50, 14, 50, 18] |
| Epic | [14, 40, 18, 40, 22, 40, 26, 80, 30] |
| Legendary | [10, 20, 14, 20, 18, 20, 22, 20, 26, 20, 30, 120, 45] |
| Mythic | swell [10, 25, 12, 25, 14, 25, 16, 25, 18, 25, 20, 25, 22], gap 250, then [60, 60, 60] |
| Merge T0 to T2 | rumble [8, 52] repeating, tightening to [14, 20]; T3 burst by result tier above |

---

## 7. Module map, build order and the seams the slice already leaves

### 7.1 Seams in the code (as of 2026-10-05)

Status of these seams on 2026-10-05; the module status table is NEXT_STEPS section 1.

| Seam | In the code on 2026-10-05 | What the economy needs |
|---|---|---|
| `Genome.species` (`src/core/genome.ts`) | `SPECIES` is the 50-entry list in the leaf module `src/data/species.ts`, imported by both `genome.ts` and `src/data/catalog.ts` (no import cycle between them); the share string stores the species **index in one byte**; an unknown index decodes to `null` (`probe_genome.ts`) | Done: 50 ids. Stays **append-only** forever (never reorder or reuse an index; up to 256). Tier and family are **not** in `Genome`; they come from the catalog by species. |
| `Genome` numeric traits | quantised to 1/255, `seed` uint32 cosmetic | Capsule genome = species template with jitter; merge genome = the result species' template with a bounded hue tint toward the parents (`lineageGenome`, 5.6). Every instance stays visually unique. |
| Share string `g1.` | lossless, 38 chars, **canonical** (`encodeGenome` quantises first and refuses an unknown species, pattern or eye style; `decodeGenome` refuses alias spellings, so one genome has exactly one string), hostile input returns `null` | **Look-only.** Never a claim ticket for ownership; trade, merge and board accept item ids, not strings. A decoded string is a "ghost" you can view, not own. |
| `SquishyInstance.id` | `crypto.randomUUID()` default | Owned items get a **server-minted** id (unique constraint, never reused). Client ids are local-ghost only. |
| `SquishyInstance.origin` | `{ kind: 'starter' \| 'drop' \| 'task' \| 'blend' \| 'trade'; parents? }` | **Immutable creation record.** `drop` = capsule, `task`, `blend` = merge output (keep the string, avoid touching the frozen type), `parents` = the 2 consumed ids. `trade` is **not written** (provenance of ownership is `tradeCount` plus the ledger). Add `'restock'` as an optional additive later. |
| `SquishyInstance.tradeCount` | `0` at birth | **Server increments only**, never the client; shown as "traded Nx". |
| `SquishyInstance.name` | free string | Catalog name plus optional nickname chosen from a fixed list. **No free text.** |
| Server record (new, not in `genome.ts`) | none | `ItemRecord { instance, ownerId, version, lockedUntil, inTradeId? }` kept server-side; `version` powers optimistic concurrency. |
| `SoftEvent` (`src/contracts.ts`) | `poke`, `press`, `release`, `land`, `grab`, `snap` with `intensity`, `heldFor` | Meter inputs (5.4). **No new physics events needed.** |
| Portal bridge | `postMessage`, game never sees a token (`blocktooth/src/net/portal.ts`) | Add `forgeflow:rpc` request/response for `wh_*` calls; guests stay local. |

### 7.2 Modules and build order

The function names below are owned by the module documents (COLLECTION 7.4, MERGE 4, TRADE 7.2); if they ever differ, those documents win.

| Order | Module | Contents | Depends on |
|---|---|---|---|
| 0 | Slice 1 (built 2026-10-02) | Soft body, audio, render, shell for one squishy | none |
| 1 | **COLLECTION** ([`COLLECTION.md`](COLLECTION.md)) | `src/data/catalog.ts` (50 species: built), `src/core/rarity.ts` (odds, tiers: built), `src/core/meter.ts` and `drops.ts` (rules in 5.4: built), capsule open + reveal (6.3: render and audio built, not wired), Hoard UI with stacks, restock, tasks (spec). Local-only items flagged non-tradeable. | slice 1, `materials.ts` |
| 1b | **SERVER MINT** | Supabase tables, SQL commit functions and a TypeScript host. Host operations `wh_hello`, `wh_report_play`, `wh_open_capsule`, `wh_claim_restock`, `wh_complete_task`; reads `wh_state`, `wh_inventory`, `wh_op_status`. Server owns the meter caps, the RNG and ids. **A local save is never promoted to tradeable.** (spec) | 1, portal bridge |
| 2 | **MERGE** ([`MERGE.md`](MERGE.md)) | `src/core/merge.ts` (`MERGE_COST`, roll, preview: **built and tested**, `probe_economy.ts`); the host operations `wh_merge` and `wh_tidy`, which write through `wh__commit_merge`; ceremony (6.4: render and audio built, not wired); Tidy-up UI (spec) | 1b |
| 3 | **TRADE** ([`TRADE.md`](TRADE.md)) | friend codes, board, `wh_propose_trade` / `wh_counter_trade` / `wh_confirm_trade` (the second confirm runs `wh__trade_execute`) / `wh_cancel_trade`, reservations, locks, ledger, reports, kill-switch (spec) | 1b (parallel with 2) |

Why server mint comes before trade: a forgeable local inventory makes every Mythic suspect. Why trade can start without merge: they share only the lock.

---

## 8. Safety and ethics

### 8.1 Money and randomness
* **No real-money path in v1**: no purchases, no ads, no virtual currency. Capsules, restock and tasks are free, so there is no paid randomness.
  If money ever appears, the rule is fixed now: **direct purchase of cosmetics only, never random, never tradeable for tier items**.
* **Odds are public anyway:** the tier table (5.2) and the merge preview odds are shown in-game, the practice Apple requires for paid random items (**[O]** guideline 3.1.1) and the FTC enforced in 2025.
* Completing a row gives a **fixed cosmetic**, never a random bonus item.

### 8.2 Players and privacy (design for the strictest case)
* **No free text anywhere**: names from lists, trade emotes from a fixed set of 6, reports from fixed reasons. No voice, photos, location or contacts.
* **Friend code or board only.** Codes are 8 characters without look-alike letters, mutual accept, 10 attempts an hour. **Do not use the portal's `find_users`** (searches by email or username).
* Anonymous alias (adjective plus noun) and the player's best squishy as avatar; no profile page.
* Age: the portal account is email-based, so COPPA and UK Children's Code duties sit with the portal. The game collects **no personal data of its own**, keeps high-privacy defaults, profiling off, no nudges.
  Recommended: trading is enabled only for accounts the portal marks as old enough or parent-approved (open question 1). **The same switch closes every
  social surface, not only trading**: an account with trading off (or on a moderation hold) cannot gain friends, has its shelf, friend list and emotes
  hidden, and its pending requests, live trades and listings are cancelled when the switch goes off (TRADE 16.1).
* Block and report on every trade card; blocked players cannot see your board listings.

### 8.3 Dupe-proofing and provenance
* **Single writer:** only server RPCs change ownership. Clients send item ids and an idempotency key, never item data.
* **Trade (`wh_confirm_trade`, whose second confirmation runs `wh__trade_execute`; TRADE.md 8.1 owns the names):** one transaction locks the trade row, both accounts in ascending id, then the items in ascending id (`SELECT ... FOR UPDATE`), re-checks owner, `version`, `lockedUntil` and the reservation, swaps owners, bumps `tradeCount` and `version`, sets `lockedUntil`, writes the ledger rows; any failure rolls back everything. **Merge (the host operation `wh_merge`, which writes through `wh__commit_merge`; MERGE.md 4.5):** consume 2 and mint 1 in one transaction; the roll is made by the host with a CSPRNG and logged.
* **Conservation check** every hour: items minted minus items consumed must equal items held; a mismatch freezes trading. A **kill-switch** freezes trading and merging globally. Ledger plus `origin.parents` let a bad batch be traced and recalled.
* **Locks and caps:** 24 h receive and merge lock, 3 trades a day, 1 per partner a day, new-account gate (5.7). Together they cut a hostile ring's output from thousands of copies to about 5 and its laundering to 0 (5.10).
* **Real-money trading:** no currency, and tier parity means value cannot be moved with lopsided deals; still forbidden in the terms and monitored for one-sided flows.

### 8.4 Pressure and rhythm
* No streaks, no countdown FOMO, no "you lost it", no push notifications by default. Restock offers refresh daily and never accumulate guilt. Caps are framed as rest, not punishment (UK Children's Code: no nudge techniques).
* Merge is never silent: hold to confirm, preview odds, last-copy warning, hearted squishies protected.

### 8.5 Light, motion, sound
* Flash budget and Calm effects (6.6); **photosensitivity** is treated as a safety issue, not polish. Volume ramps on every voice; haptics optional.

---

## 9. Originality checklist (a reviewer ticks each box)

- [ ] **Names:** no species, tier or mechanic name copies a reference or a known franchise; **do not use** plort, largo, Tarr, neon, mega, Squishmallow, Pokemon words, "gacha pull" or any brand. Tier names (Common to Mythic) are generic English; a trademark search on all 50 species names and the title is done before release.
- [ ] **Palette:** only the `CONTRACT.md` tokens (ink-indigo, plum, dusk violet, felt, sodium amber, lagoon, ember coral, cream); no pastel-kawaii shelf; tier colours come from these tokens.
- [ ] **Shapes and faces:** two glossy eyes, no mouth; species shapes are our radial-deformation families, not traced from any toy or game.
- [ ] **Sounds:** every voice is WebAudio synthesis in `src/audio/voices.ts`; no samples, loops or recordings; the Mythic motifs are ours.
- [ ] **UI:** our layout (felt cabinet Hoard, merge pad, capsule drop), our type (system stack, heavy rounded), our wordmark; nothing resembles a reference screen.
- [ ] **Reference assets:** zero files from either clip or any game; `git ls-files` shows no audio, image, font or model binaries except `public/thumbnail.png` rendered from our game.
- [ ] **Copy:** plain, short English; no reference to another game, brand or character in any string.
- [ ] **Effects:** the merge ceremony's fold-and-spring is our soft-body timing and colours, not a recreation of the clip.
- [ ] **Mechanics credited as common practice only:** same-species fusion (Adopt Me's Neon is 4-to-1 and deterministic), combine-two (Little Alchemy), request/offer boards (Pokemon GTS) are generic patterns; our rules and numbers are our own.

---

## 10. Risks and open questions for the owner

| # | Risk or question | Why it matters | Suggested answer |
|---|---|---|---|
| 1 | **Age and consent.** Who is the audience, and does the portal account (email sign-up, `find_users` by email) allow children? | COPPA, UK Children's Code, Apple Kids rules. Trading needs sign-in. | Decide the age bar; trading only for parent-approved or old-enough accounts; guests play locally with no trading. |
| 2 | **Server dependency.** Trade, merge and capsule opening need the Supabase ledger. | A forgeable local save would ruin the economy; offline play cannot be tradeable. | Build 1b before 2 and 3; keep a local "demo shelf" that is never promoted. |
| 3 | **The economy ends.** A regular finishes all 50 in about 131 days with trade. | After that, no new species means no trade, and veterans' spares cannot help newcomers. | Plan **seasons**: about 4 to 6 new species every 8 weeks, appended to tiers; cosmetics for finished rows. |
| 4 | **Solo-to-trade is about 1.5 to 1.7x (1.56x at p50), not 2x.** | Trade cannot mint copies; even a frictionless oracle reaches 1.76x. | Accept, or add more Epic+ species. We chose pacing. |
| 5 | **Every number rests on assumed behaviour.** | 3.1 min per capsule is a model of human touching. | Playtest early; instrument aggregate (not personal) timing; retune `capsuleCost`. Sensitivity: 2x slower is 5.4 min per capsule (edge of grind). |
| 6 | **Dozens of repeat Commons.** 90% of capsules are repeats by week 3. | Could feel flat. | Reveal compresses repeats; Tidy-up; Rare+ repeats are the trade fuel. If it feels flat, raise Uncommon odds before touching the meter. |
| 7 | **Bots and macros.** | A cycler hits 40 SP/min. | Daily cap of 12 capsules, server-side plausibility checks on touches, no cash value. Cannot be zero. |
| 8 | **Grey-market trading** of tier items outside the game. | Happens in every trading game. | Terms; tier-parity makes buying with lopsided deals impossible; monitor one-sided flows. |
| 9 | **Merge preview honesty and last-copy mistakes.** | Regret erodes trust. | Hold-to-confirm, last-copy warning, hearts (5.6), the odds digest (MERGE M-1). |
| 10 | **Art cost.** 15 of 50 species are Epic or above with tier FX. | Time. | FX are per-tier presets, not per-species. |
| 11 | **Trade fuel for Mythics.** Only 3 species; a swap needs a spare of the *other* Mythic. | Mythic swaps are rare events. | Intended. Check in the first month of data. |
| 12 | **Physics lane must emit the touches the meter reads** (`release.heldFor`, `snap.intensity` threshold). | The 3.1 min figure assumes the micro-model's timings. | Done in the contract (2026-10-05): gate **G4m** (CONTRACT section 6) checks that real mouse and touch input produce the `SoftEvent`s the meter maps to touches. It runs once the shell wires the meter (planned); until then it is not run. Meanwhile `probe_economy.ts` (section 2b, informative) prints what the current body gives on scripted pulls: on 2026-10-05 a pull to 1.5 x the rest radius gave snap intensity 0.31 and 2.2 x gave 0.41, against the 0.35 full-pay threshold, so the threshold is **provisional** (`meter.ts`) until physics round 2 lands and it is set from measured gestures (then re-run the sim). |
| 13 | **Sources.** All research is [S] except Apple's guidelines. | Some claims may have drifted. | Re-verify 3.1 and 3.2 once a network without the egress block is available. |
